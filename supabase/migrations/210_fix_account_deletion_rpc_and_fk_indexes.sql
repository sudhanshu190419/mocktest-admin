-- ============================================================================
-- Migration: 210 — Fix Account Deletion Stored Procedure & Add Missing FK Indexes
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Root Cause Addressed:
--   1. Statement timeout (PostgreSQL error 57014) during account deletion.
--   2. Missing foreign-key indexes on high-volume tables referencing profiles(profile_id):
--      - public.mock_answers(evaluated_by) [~128k rows in prod, ON DELETE SET NULL]
--      - public.recordings(deleted_by)     [~50k rows in prod, ON DELETE SET NULL]
--      These indexes eliminate full-table scans during profile referential integrity checks.
--   3. Foreign-key deletion ordering defect:
--      - public.progress_history has fk_progress_history_attempt referencing
--        mock_attempts(attempt_id) with ON DELETE RESTRICT.
--      - In earlier revisions, mock_attempts was deleted before progress_history.
--      - In this revision, progress_history is strictly deleted BEFORE mock_attempts.
--   4. Validated session_participants cleanup:
--      - session_participants.profile_id was added in migration 053 with
--        idx_session_participants_profile_id. Restores 'or profile_id = p_target_profile_id'
--        so non-student/teacher participant rows are completely cleaned up.
--   5. Invalid column filters removed:
--      - Removes non-existent 'profile_id' filters from mock_answers, course_enrollments,
--        and student_pyq_purchases (which are linked exclusively via student_id).
--   6. Column names aligned with canonical domain schemas:
--      - support_ticket_messages: sender_profile_id (aligned with 015)
--      - doubt_replies: author_profile_id (aligned with 015)
--      - messages: sender_profile_id (aligned with 060)
--   7. Audit log immutability preservation:
--      - Drops fk_audit_logs_profile. Table audit_logs is protected by trigger
--        trg_audit_logs_prevent_update which prohibits all UPDATE mutations.
--        The ON DELETE SET NULL constraint on fk_audit_logs_profile attempts to
--        update audit_logs upon profile deletion, violating the immutability trigger.
--        Dropping the FK constraint preserves historical profile UUIDs in the audit log
--        without violating immutability or blocking legitimate account deletions.
--   8. Durable account deletion outbox:
--      - Creates public.account_deletion_records to durably persist student_id,
--        teacher_id, and deletion status across partial failures and retries.
--   9. Role-guarded catalog unlinking:
--      - Catalog updates (streams, subjects, chapters, etc.) are only executed if
--        the account role is 'admin' or 'teacher', eliminating 14 redundant full-table
--        updates for student/user deletions.
--
-- @module migrations/210
-- ============================================================================

-- ─── SECTION 1: Missing Foreign-Key Indexes ──────────────────────────────────
-- OPERATOR NOTE (locking):
-- These index-creation statements use IF NOT EXISTS. On tables of this size
-- (~128k rows / ~30MB for mock_answers; ~50k rows / ~17MB for recordings),
-- standard non-concurrent index creation takes < 250ms with minimal table lock.
-- If applying manually outside a migration transaction during peak traffic,
-- CREATE INDEX CONCURRENTLY can optionally be used.

create index if not exists idx_mock_answers_evaluated_by
  on public.mock_answers (evaluated_by);

create index if not exists idx_recordings_deleted_by
  on public.recordings (deleted_by);

-- ─── SECTION 2: Schema Adjustments for Audit Integrity ───────────────────────
-- Drop fk_audit_logs_profile if present so immutable audit_logs (protected by
-- trg_audit_logs_prevent_update) preserve historical profile UUIDs without
-- triggering ON DELETE SET NULL update violations during profile deletion.
alter table public.audit_logs
  drop constraint if exists fk_audit_logs_profile;

-- ─── SECTION 3: Durable Deletion Outbox & Recovery Table ─────────────────────
-- Tracks account deletion lifecycle to support durable recovery from partial
-- failures (e.g. database commits but storage cleanup fails or auth deletion fails).
create table if not exists public.account_deletion_records (
  profile_id        uuid          not null,
  student_id        uuid          null,
  teacher_id        uuid          null,
  user_role         text          null,
  status            text          not null default 'db_completed',
  storage_clean     boolean       not null default false,
  auth_deleted      boolean       not null default false,
  storage_details   jsonb         null default null,
  error_message     text          null default null,
  created_at        timestamptz   not null default now(),
  updated_at        timestamptz   not null default now(),
  completed_at      timestamptz   null default null,

  constraint pk_account_deletion_records primary key (profile_id)
);

alter table public.account_deletion_records enable row level security;
revoke all on public.account_deletion_records from public;
revoke all on public.account_deletion_records from anon, authenticated;
grant all on public.account_deletion_records to service_role;

-- ─── SECTION 4: Corrected Atomic Account Deletion Stored Procedure ───────────

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
  v_role       user_role;
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
    select student_id, teacher_id
    into v_student_id, v_teacher_id
    from public.account_deletion_records
    where profile_id = p_target_profile_id;

    return jsonb_build_object(
      'success', true,
      'profile_id', p_target_profile_id,
      'student_id', v_student_id,
      'teacher_id', v_teacher_id,
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

  -- Durably record child identifiers before rows are removed so recovery from storage failure is guaranteed
  insert into public.account_deletion_records (
    profile_id, student_id, teacher_id, user_role, status, updated_at
  )
  values (
    p_target_profile_id, v_student_id, v_teacher_id, v_role::text, 'db_in_progress', now()
  )
  on conflict (profile_id) do update
  set student_id = coalesce(excluded.student_id, public.account_deletion_records.student_id),
      teacher_id = coalesce(excluded.teacher_id, public.account_deletion_records.teacher_id),
      user_role  = coalesce(excluded.user_role, public.account_deletion_records.user_role),
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

    delete from public.subscription_cancellations
    where student_id = v_student_id
       or created_by = p_target_profile_id;

    delete from public.subscription_renewals
    where student_id = v_student_id;

    delete from public.subscription_history
    where student_id = v_student_id
       or created_by = p_target_profile_id;

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

    delete from public.support_tickets
    where student_id = v_student_id
       or created_by = p_target_profile_id;

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

    -- Unlink teacher references in shared academic resources
    update public.timetable_slots set teacher_id = null where teacher_id = v_teacher_id;
    update public.live_classes set teacher_id = null where teacher_id = v_teacher_id;
    update public.recordings set teacher_id = null where teacher_id = v_teacher_id;
    update public.questions set created_by = null where created_by = v_teacher_id;
    update public.mock_tests set teacher_id = null, created_by = null where teacher_id = v_teacher_id;
    update public.content set teacher_id = null, created_by = null where teacher_id = v_teacher_id;
    update public.student_doubts set assigned_to = null where assigned_to = v_teacher_id;
    update public.class_resolution_events set new_teacher_id = null where new_teacher_id = v_teacher_id;
    update public.class_resolution_events set prev_teacher_id = null where prev_teacher_id = v_teacher_id;
    update public.approval_requests set teacher_id = null where teacher_id = v_teacher_id;

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
  update public.notifications set created_by = null where created_by = p_target_profile_id;
  update public.notification_templates set created_by = null where created_by = p_target_profile_id;

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
    update public.pyq_packages set created_by = null where created_by = p_target_profile_id;
    update public.pyq_papers set created_by = null where created_by = p_target_profile_id;
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
    'teacher_id', v_teacher_id
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
  'Persists durable child IDs in account_deletion_records for reliable storage recovery. '
  'Callable strictly by backend service-role in response to an authenticated account-deletion request.';
