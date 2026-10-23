-- ============================================================================
-- Migration: 212 — Durable Storage Path Capture for Doubt Attachments in Account Deletion
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready | Idempotent
--
-- ## Root Cause Context
-- In production, doubt attachments are stored following the Migration 117 folder convention:
--   {institute_id}/{doubt_id}/{filename}
-- in the private bucket 'doubt-attachments'.
--
-- The previous account deletion RPC deleted the metadata from public.doubt_attachments
-- and public.student_doubts BEFORE Storage cleanup occurred.
-- The Edge Function subsequently attempted to clean:
--   doubt-attachments/{student_id}/...
-- Because files were stored under {institute_id}/{doubt_id}/, listing with prefix {student_id}
-- returned 0 files, falsely reporting clean=true while the actual storage objects remained orphaned.
--
-- ## Remediation
-- 1. Extend public.account_deletion_records with pending_storage_paths (jsonb).
-- 2. In delete_user_account_data(uuid), BEFORE deleting public.doubt_attachments metadata:
--    Durably snapshot the exact storage paths of:
--    a) All attachments uploaded by the target profile (uploaded_by = p_target_profile_id).
--    b) All attachments belonging to doubts owned by the target student
--       (doubt_id in (select doubt_id from public.student_doubts where student_id = v_student_id)).
-- 3. Persist pending_storage_paths into public.account_deletion_records during the transaction.
-- 4. Return pending_storage_paths in the RPC response so the Edge Function can clean
--    the exact object paths from 'doubt-attachments'.
-- 5. On idempotent retries (when profile is already deleted), retrieve pending_storage_paths
--    from account_deletion_records and return them.
-- ============================================================================

-- ─── SECTION 1: Extend Outbox Table with Durable Storage Paths ───────────────
alter table public.account_deletion_records
add column if not exists pending_storage_paths jsonb null default '[]'::jsonb;

comment on column public.account_deletion_records.pending_storage_paths is
  'Durable snapshot of exact storage paths (e.g. doubt-attachments {institute_id}/{doubt_id}/{filename}) '
  'captured before database metadata deletion so Storage cleanup and retries can reliably remove them.';

-- ─── SECTION 2: Updated Atomic Account Deletion Stored Procedure ─────────────
create or replace function public.delete_user_account_data(
  p_target_profile_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student_id uuid;
  v_teacher_id uuid;
  v_role                  user_role;
  v_pending_storage_paths jsonb := '[]'::jsonb;
begin
  -- 1. Validate Input
  if p_target_profile_id is null then
    return jsonb_build_object('success', false, 'error', 'target_profile_id cannot be null');
  end if;

  -- 2. Inspect Target Profile
  select role
  into v_role
  from public.profiles
  where profile_id = p_target_profile_id;

  -- If profile already does not exist (idempotent retry), retrieve child IDs from durable record
  if not found then
    select student_id, teacher_id, pending_storage_paths
    into v_student_id, v_teacher_id, v_pending_storage_paths
    from public.account_deletion_records
    where profile_id = p_target_profile_id;

    return jsonb_build_object(
      'success', true,
      'profile_id', p_target_profile_id,
      'student_id', v_student_id,
      'teacher_id', v_teacher_id,
      'pending_storage_paths', coalesce(v_pending_storage_paths, '[]'::jsonb),
      'message', 'Profile row already deleted or does not exist.'
    );
  end if;

  -- 3. Resolve Child Identity IDs (student_id, teacher_id)
  select student_id
  into v_student_id
  from public.student_details
  where profile_id = p_target_profile_id;

  select teacher_id
  into v_teacher_id
  from public.teacher_details
  where profile_id = p_target_profile_id;

  -- 4. Durably Snapshot Pending Storage Paths BEFORE metadata is deleted
  -- Captures:
  --   a) Attachments uploaded by target profile
  --   b) Attachments belonging to doubts owned by target student (including teacher/admin replies)
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'bucket', t.bucket,
        'storage_path', t.storage_path
      )
    ),
    '[]'::jsonb
  )
  into v_pending_storage_paths
  from (
    select distinct da.bucket, da.storage_path
    from public.doubt_attachments da
    where da.uploaded_by = p_target_profile_id
       or (v_student_id is not null and da.doubt_id in (
         select sd.doubt_id
         from public.student_doubts sd
         where sd.student_id = v_student_id
       ))
  ) t;

  -- Durably record child identifiers and pending storage paths before rows are removed
  insert into public.account_deletion_records (
    profile_id, student_id, teacher_id, user_role, status, pending_storage_paths, updated_at
  )
  values (
    p_target_profile_id, v_student_id, v_teacher_id, v_role::text, 'db_in_progress', v_pending_storage_paths, now()
  )
  on conflict (profile_id) do update
  set student_id = coalesce(excluded.student_id, public.account_deletion_records.student_id),
      teacher_id = coalesce(excluded.teacher_id, public.account_deletion_records.teacher_id),
      user_role  = coalesce(excluded.user_role, public.account_deletion_records.user_role),
      pending_storage_paths = case
        when public.account_deletion_records.pending_storage_paths is not null
             and jsonb_array_length(public.account_deletion_records.pending_storage_paths) > 0
          then public.account_deletion_records.pending_storage_paths
        else excluded.pending_storage_paths
      end,
      status     = 'db_in_progress',
      updated_at = now();

  -- ─── 4. Anonymize Financial Records (Invoices & Orders) ────────────────────
  -- Redact PII in invoices for any orders linked to this user
  update public.invoices
  set billing_name = 'Deleted User',
      billing_email = 'deleted@makemetopper.com',
      billing_address = 'REDACTED',
      billing_gstin = null
  where order_id in (
    select order_id
    from public.orders
    where profile_id = p_target_profile_id
       or (v_student_id is not null and student_id = v_student_id)
  );

  -- Unlink orders from the user profile & student record
  update public.orders
  set profile_id = null,
      student_id = null,
      notes = case
        when notes is not null then notes || ' [Account Deleted]'
        else '[Account Deleted]'
      end
  where profile_id = p_target_profile_id
     or (v_student_id is not null and student_id = v_student_id);

  -- ─── 5. Student-Specific Dependent Cleanup (Strict Bottom-Up Order) ────────
  if v_student_id is not null then
    -- A. Assessment details (answers & options)
    delete from public.mock_answer_options
    where answer_id in (
      select ma.answer_id
      from public.mock_answers ma
      join public.mock_attempts mat on ma.attempt_id = mat.attempt_id
      where mat.student_id = v_student_id
    );

    delete from public.mock_answers
    where attempt_id in (
      select attempt_id
      from public.mock_attempts
      where student_id = v_student_id
    );

    -- B. Student analytics & progress history
    -- CRITICAL ORDERING: progress_history has fk_progress_history_attempt referencing
    -- mock_attempts(attempt_id) with ON DELETE RESTRICT.
    -- progress_history MUST be deleted BEFORE mock_attempts!
    delete from public.progress_history
    where student_id = v_student_id
       or attempt_id in (
         select attempt_id
         from public.mock_attempts
         where student_id = v_student_id
       );

    delete from public.chapter_performances
    where student_id = v_student_id;

    delete from public.subject_performances
    where student_id = v_student_id;

    delete from public.performance_reports
    where student_id = v_student_id;

    -- C. Assessment results & attempts (now safe to delete)
    delete from public.mock_results
    where student_id = v_student_id
       or attempt_id in (
         select attempt_id
         from public.mock_attempts
         where student_id = v_student_id
       );

    delete from public.mock_attempts
    where student_id = v_student_id;

    -- D. Batches, Enrollments, and Attendance
    delete from public.batch_students
    where student_id = v_student_id;

    delete from public.course_enrollments
    where student_id = v_student_id;

    delete from public.session_participants
    where (v_student_id is not null and student_id = v_student_id)
       or profile_id = p_target_profile_id;

    delete from public.attendance_events
    where student_id = v_student_id;

    delete from public.attendance
    where student_id = v_student_id;

    -- E. Subscriptions & PYQ purchases
    delete from public.student_pyq_purchases
    where student_id = v_student_id;

    delete from public.subscription_usage
    where student_id = v_student_id;

    delete from public.subscription_grace_periods
    where student_id = v_student_id;

    -- Corrected: subscription_cancellations uses cancelled_by (replaces invalid created_by)
    delete from public.subscription_cancellations
    where student_id = v_student_id
       or cancelled_by = p_target_profile_id;

    delete from public.subscription_renewals
    where student_id = v_student_id;

    -- Corrected: subscription_history uses changed_by (replaces invalid created_by)
    delete from public.subscription_history
    where student_id = v_student_id
       or changed_by = p_target_profile_id;

    delete from public.student_subscriptions
    where student_id = v_student_id;

    -- F. Notes, Bookmarks, Downloads, Doubts & Live Chat
    delete from public.student_personal_notes
    where student_id = v_student_id;

    delete from public.student_bookmarks
    where student_id = v_student_id;

    delete from public.student_downloads
    where student_id = v_student_id;

    delete from public.student_viewing_history
    where student_id = v_student_id;

    delete from public.student_feedback_ratings
    where student_id = v_student_id;

    delete from public.support_ticket_messages
    where sender_profile_id = p_target_profile_id
       or ticket_id in (
         select ticket_id
         from public.support_tickets
         where student_id = v_student_id
       );

    -- Corrected: support_tickets has NO created_by; student tickets deleted by student_id
    delete from public.support_tickets
    where student_id = v_student_id;

    delete from public.doubt_attachments
    where uploaded_by = p_target_profile_id
       or doubt_id in (
         select doubt_id
         from public.student_doubts
         where student_id = v_student_id
       );

    delete from public.doubt_replies
    where author_profile_id = p_target_profile_id
       or doubt_id in (
         select doubt_id
         from public.student_doubts
         where student_id = v_student_id
       );

    delete from public.student_doubts
    where student_id = v_student_id;

    delete from public.messages
    where sender_profile_id = p_target_profile_id
       or conversation_id in (
         select conversation_id
         from public.conversations
         where student_id = v_student_id
       );

    delete from public.conversations
    where student_id = v_student_id;

    -- G. Delete the student_details row
    delete from public.student_details
    where student_id = v_student_id
       or profile_id = p_target_profile_id;
  end if;

  -- ─── 6. Teacher-Specific Dependent Cleanup ─────────────────────────────────
  if v_teacher_id is not null then
    delete from public.teacher_analytics where teacher_id = v_teacher_id;
    delete from public.teacher_availability where teacher_id = v_teacher_id;
    delete from public.teacher_bank_details where teacher_id = v_teacher_id;
    delete from public.teacher_documents where teacher_id = v_teacher_id;
    delete from public.teacher_employment_records where teacher_id = v_teacher_id;
    delete from public.teacher_experiences where teacher_id = v_teacher_id;
    delete from public.teacher_leave_requests where teacher_id = v_teacher_id;
    delete from public.teacher_leaves where teacher_id = v_teacher_id;
    delete from public.teacher_qualifications where teacher_id = v_teacher_id;
    delete from public.teacher_specializations where teacher_id = v_teacher_id;
    delete from public.batch_teachers where teacher_id = v_teacher_id;
    delete from public.batch_subject_teachers where teacher_id = v_teacher_id;
    delete from public.course_teachers where teacher_id = v_teacher_id;

    -- Corrected: Delete live chat conversations for teacher (prevents fk_conversations_teacher RESTRICT violation)
    delete from public.messages
    where conversation_id in (
      select conversation_id
      from public.conversations
      where teacher_id = v_teacher_id
    );

    delete from public.conversations
    where teacher_id = v_teacher_id;

    -- Unlink assigned faculty in nullable academic resources (mock_tests & content)
    -- Only unassigns the departing teacher; strictly preserves creator attribution (created_by)
    -- for resources created by other users (e.g. academic/super admins)
    update public.mock_tests
    set teacher_id = null
    where teacher_id = v_teacher_id;

    update public.content
    set teacher_id = null
    where teacher_id = v_teacher_id;

    -- Corrected: Set assigned_to = null AND assigned_at = null to satisfy ck_student_doubts_assigned_consistency
    update public.student_doubts
    set assigned_to = null,
        assigned_at = null
    where assigned_to = v_teacher_id;

    update public.class_resolution_events set new_teacher_id = null where new_teacher_id = v_teacher_id;
    update public.class_resolution_events set prev_teacher_id = null where prev_teacher_id = v_teacher_id;

    -- Corrected: Delete approval_requests for teacher (teacher_id is NOT NULL with RESTRICT, cannot set to null)
    delete from public.approval_requests
    where teacher_id = v_teacher_id
       or requested_by = p_target_profile_id;

    -- Delete teacher_details row
    delete from public.teacher_details
    where teacher_id = v_teacher_id
       or profile_id = p_target_profile_id;
  end if;

  -- ─── 7. Unlink Created_by / Reviewed_by in Institutional Content ───────────
  update public.trusted_devices set approved_by = null where approved_by = p_target_profile_id;
  update public.teacher_bank_details set verified_by = null where verified_by = p_target_profile_id;
  update public.teacher_documents set verified_by = null where verified_by = p_target_profile_id;
  update public.teacher_experiences set verified_by = null where verified_by = p_target_profile_id;
  update public.teacher_qualifications set verified_by = null where verified_by = p_target_profile_id;
  update public.teacher_leave_requests set reviewed_by = null where reviewed_by = p_target_profile_id;
  update public.approval_requests set reviewed_by = null where reviewed_by = p_target_profile_id;

  -- Corrected: Safely unassign deleted staff/teacher from support tickets
  update public.support_tickets set assigned_to = null where assigned_to = p_target_profile_id;

  -- Corrected: notifications uses triggered_by (replaces invalid created_by)
  update public.notifications set triggered_by = null where triggered_by = p_target_profile_id;

  -- Corrected: notification_templates uses updated_by (created_by is NOT NULL)
  update public.notification_templates set updated_by = null where updated_by = p_target_profile_id;

  -- Unlink created_by on nullable institutional content (content & mock_tests for admin/teacher creators)
  -- Only unlinks creator attribution for the target profile; strictly preserves assigned faculty (teacher_id)
  -- Note: fk_content_created_by and fk_mock_tests_created_by already specify ON DELETE SET NULL on profiles(profile_id)
  update public.content set created_by = null where created_by = p_target_profile_id;
  update public.mock_tests set created_by = null where created_by = p_target_profile_id;

  -- Defensive check for catalog tables: only execute if the actor had admin or teacher roles
  if v_role in ('admin', 'teacher') then
    update public.streams set created_by = null where created_by = p_target_profile_id;
    update public.streams set updated_by = null where updated_by = p_target_profile_id;
    update public.subjects set created_by = null where created_by = p_target_profile_id;
    update public.subjects set updated_by = null where updated_by = p_target_profile_id;
    update public.chapters set created_by = null where created_by = p_target_profile_id;
    update public.chapters set updated_by = null where updated_by = p_target_profile_id;
    update public.topics set created_by = null where created_by = p_target_profile_id;
    update public.topics set updated_by = null where updated_by = p_target_profile_id;
    update public.batches set created_by = null where created_by = p_target_profile_id;
    update public.batches set updated_by = null where updated_by = p_target_profile_id;
    update public.courses set created_by = null where created_by = p_target_profile_id;
    update public.courses set updated_by = null where updated_by = p_target_profile_id;
    -- Note: pyq_packages has NO created_by column (institute-owned); removed invalid statement
    update public.pyq_papers set created_by = null where created_by = p_target_profile_id;
    update public.pyq_papers set updated_by = null where updated_by = p_target_profile_id;
  end if;

  -- ─── 8. Session, Tokens, Roles & Devices ───────────────────────────────────
  -- Delete session participant record for any role if not already deleted
  delete from public.session_participants where profile_id = p_target_profile_id;
  delete from public.trusted_devices where profile_id = p_target_profile_id;
  delete from public.notification_recipients where profile_id = p_target_profile_id;
  delete from public.device_tokens where profile_id = p_target_profile_id;
  delete from public.user_device_sessions where profile_id = p_target_profile_id;
  delete from public.admin_roles where profile_id = p_target_profile_id;

  -- ─── 9. Delete the User Profile ───────────────────────────────────────────
  delete from public.profiles
  where profile_id = p_target_profile_id;

  -- Finalize the database phase in the durable outbox record
  update public.account_deletion_records
  set status = 'db_completed',
      updated_at = now()
  where profile_id = p_target_profile_id;

  return jsonb_build_object(
    'success', true,
    'profile_id', p_target_profile_id,
    'student_id', v_student_id,
    'teacher_id', v_teacher_id,
    'pending_storage_paths', coalesce(v_pending_storage_paths, '[]'::jsonb)
  );
end;
$$;

-- Revoke execute from public/anon/authenticated; only service_role can call
revoke all on function public.delete_user_account_data(uuid) from public;
revoke all on function public.delete_user_account_data(uuid) from anon, authenticated;
grant execute on function public.delete_user_account_data(uuid) to service_role;

comment on function public.delete_user_account_data(uuid) is
  'Performs atomic, cascade deletion and legal anonymization of all user-owned data. '
  'Enforces strict dependency order: progress_history before mock_attempts. '
  'Persists durable child IDs and pending doubt storage paths in account_deletion_records for reliable storage recovery. '
  'Aligned with canonical domain schemas: cancelled_by, changed_by, triggered_by, assigned_at. '
  'Callable strictly by backend service-role in response to an authenticated account-deletion request.';
