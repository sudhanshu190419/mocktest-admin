-- ============================================================================
-- Migration: 211 — Fix Account Deletion RPC Schema Alignment
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready | Idempotent
--
-- ## Incident Context
--
-- In production, the account-deletion Edge Function failed with PostgreSQL error
-- 42703 (column "created_by" does not exist) inside delete_user_account_data:
--   Hint: "Perhaps you meant to reference the column subscription_cancellations.created_at"
--
-- ## Root Causes & Defects Resolved in this Forward Migration
--
--   1. subscription_cancellations (Error 42703):
--      - Replaces nonexistent 'or created_by = p_target_profile_id' with canonical
--        actor column 'or cancelled_by = p_target_profile_id' (Domain 11, Migration 012).
--
--   2. subscription_history (Latent Error 42703):
--      - Replaces nonexistent 'or created_by = p_target_profile_id' with canonical
--        actor column 'or changed_by = p_target_profile_id' (Domain 11, Migration 012).
--
--   3. support_tickets (Latent Error 42703):
--      - Table has no created_by column (Domain 14, Migration 015). Student tickets
--        are owned by student_id. Removes invalid 'created_by' filter. Added explicit
--        unassignment for staff: 'update support_tickets set assigned_to = null'.
--
--   4. notifications (Latent Error 42703):
--      - Replaces nonexistent 'set created_by = null' with canonical actor column
--        'set triggered_by = null where triggered_by = p_target_profile_id' (Domain 09, Migration 010).
--
--   5. pyq_packages (Latent Error 42703):
--      - Packages are institute-owned and have no created_by column (Phase 9A, Migration 081).
--        Removes invalid 'update pyq_packages set created_by = null'. (pyq_papers
--        retains created_by and updated_by unlinking as defined in Migration 081).
--
--   6. approval_requests (Latent Error 23502 NOT NULL Violation):
--      - teacher_id is defined as 'UUID NOT NULL' with ON DELETE RESTRICT (Domain 03, Migration 004).
--        Executing 'set teacher_id = null' violates NOT NULL. Replaced with clean
--        cascade deletion: 'delete from approval_requests where teacher_id = v_teacher_id
--        or requested_by = p_target_profile_id' (aligned with original Migration 097).
--
--   7. student_doubts (Latent Error 23514 CHECK Constraint Violation):
--      - Migration 117 enforces ck_student_doubts_assigned_consistency:
--        ((assigned_to is not null and assigned_at is not null) or (assigned_to is null and assigned_at is null)).
--        Setting assigned_to = null without clearing assigned_at violates this CHECK constraint.
--        Now clears both: 'set assigned_to = null, assigned_at = null'.
--
--   8. live_chat conversations teacher cleanup (Latent Error 23503 FK RESTRICT Violation):
--      - fk_conversations_teacher has ON DELETE RESTRICT to teacher_details(teacher_id).
--        When a teacher is deleted, their live class conversations and messages are
--        now cleanly deleted prior to teacher_details row removal.
--
--   9. notification_templates (Latent Error 23502 NOT NULL Violation):
--      - created_by is 'UUID NOT NULL' on notification_templates (Domain 09, Migration 010).
--        Replaced invalid 'set created_by = null' with nullable 'set updated_by = null'.
--
--  10. questions author reference (Latent Error 23502 & ID Mismatch):
--      - questions.created_by references profiles(profile_id) (Migration 123) and is
--        'UUID NOT NULL' with ON DELETE RESTRICT (Domain 05, Migration 006).
--        Setting created_by = null violated NOT NULL, and comparing against v_teacher_id
--        was an ID mismatch. Removed invalid 'set created_by = null'. Questions in the
--        shared question bank are protected from being orphaned by fk_questions_created_by RESTRICT.
--
--  11. timetable_slots, live_classes, recordings (Latent Error 23502 NOT NULL Violation):
--      - teacher_id on timetable_slots (Migration 108), live_classes (Migration 005), and
--        recordings (Migration 170) is 'UUID NOT NULL' with ON DELETE RESTRICT.
--        Setting teacher_id = null violated NOT NULL. Removed invalid updates; FK RESTRICT
--        protects institutional classes and recordings from being orphaned.
--
--  12. mock_tests and content decoupled cleanup:
--      - Decouples faculty assignment cleanup from creator-attribution cleanup.
--      - In Section 6: When deleting a departing teacher, updates ONLY teacher_id = null
--        where teacher_id = v_teacher_id. Preserves creator attribution (created_by)
--        for tests and content authored by another user (e.g. academic admins).
--      - In Section 7: When deleting a creator profile, updates ONLY created_by = null
--        where created_by = p_target_profile_id. Preserves assigned faculty (teacher_id).
--      - Note: fk_mock_tests_created_by (Migration 138) and fk_content_created_by (Migration 121)
--        already specify ON DELETE SET NULL referencing profiles(profile_id).
--
--  13. Explicit Teacher/Admin Deletion Boundary (Institutional Assets Protected):
--      - Self-service account deletion (SMS OTP verified) is strictly student-facing.
--      - Teachers and Admins are managed via the Admin Portal via deactivation or role
--        revocation. Full profile deletion is intentionally blocked by database foreign key
--        constraints (ON DELETE RESTRICT) on non-nullable columns: questions.created_by,
--        timetable_slots.teacher_id, live_classes.teacher_id, recordings.teacher_id, and
--        notification_templates.created_by. These institutional assets cannot be deleted
--        or set to NULL automatically without causing catastrophic data loss or schedule collapse.
--        Reassignment requires explicit administrative action.
--
-- @module migrations/211
-- ============================================================================

-- ─── SECTION 1: Ensure Durable Recovery Outbox Table Exists ──────────────────
create table if not exists public.account_deletion_records (
  profile_id        uuid          not null,
  student_id        uuid          null default null,
  teacher_id        uuid          null default null,
  user_role         text          null default null,
  status            text          not null default 'pending',
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

-- ─── SECTION 2: Schema-Aligned Atomic Account Deletion Stored Procedure ──────

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
  'Aligned with canonical domain schemas: cancelled_by, changed_by, triggered_by, assigned_at. '
  'Callable strictly by backend service-role in response to an authenticated account-deletion request.';
