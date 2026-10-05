-- ============================================================================
-- Migration: 097 — User Account Deletion Stored Procedure & Schema Cleanup
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Implements the atomic, secure database deletion procedure required for
-- Google Play account deletion compliance.
--
-- Features:
--   1. Drops the restrictive check constraint ck_orders_identifier_present
--      on public.orders so anonymized / unlinked orders can persist legally
--      without violating constraints when profile_id and student_id are NULL.
--   2. Updates FK fk_orders_profile and fk_orders_student on public.orders
--      to ON DELETE SET NULL to prevent foreign-key lockouts during deletion.
--   3. Creates the SECURITY DEFINER function public.delete_user_account_data(p_target_profile_id uuid)
--      which executes dependent cascade deletions and unlinking in strictly
--      ordered bottom-up foreign key order.
--   4. Preserves financial and audit records (orders, payments, order_items,
--      invoices) by redacting PII and unlinking user IDs instead of deleting
--      financial transaction history.
--   5. Handles student, teacher, user, and admin account roles safely and idempotently.
--   6. Grants execution EXCLUSIVELY to service_role (callable from Supabase Edge Functions).
--
-- @module migrations/097
-- ============================================================================

-- ─── SECTION 1: Orders Schema Adjustment for Safe Anonymization ──────────────

-- Drop restrictive check constraint if present so orders can exist with profile_id = NULL & student_id = NULL
alter table public.orders
  drop constraint if exists ck_orders_identifier_present;

-- Update foreign key constraints on orders to ON DELETE SET NULL
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'fk_orders_profile'
  ) then
    alter table public.orders drop constraint fk_orders_profile;
  end if;

  alter table public.orders
    add constraint fk_orders_profile
      foreign key (profile_id) references public.profiles (profile_id)
      on delete set null
      on update cascade;

  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'fk_orders_student'
  ) then
    alter table public.orders drop constraint fk_orders_student;
  end if;

  alter table public.orders
    add constraint fk_orders_student
      foreign key (student_id) references public.student_details (student_id)
      on delete set null
      on update cascade;
end $$;

-- ─── SECTION 2: Atomic Account Deletion Stored Procedure ──────────────────────

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
  v_count      int;
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

  -- If profile already does not exist (idempotent retry), return early success
  if not found then
    return jsonb_build_object(
      'success', true,
      'profile_id', p_target_profile_id,
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

  -- ─── 4. Anonymize Financial Records (Orders & Invoices) ───────────────────
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

  -- ─── 5. Student-Specific Dependent Cleanup (Bottom-Up) ─────────────────────
  if v_student_id is not null then
    -- A. Assessment data (mock answers, options, results, attempts)
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
    ) or profile_id = p_target_profile_id;

    delete from public.mock_results
    where student_id = v_student_id
       or attempt_id in (
         select attempt_id
         from public.mock_attempts
         where student_id = v_student_id
       );

    delete from public.mock_attempts
    where student_id = v_student_id;

    -- B. Student analytics & performances
    delete from public.chapter_performances
    where student_id = v_student_id;

    delete from public.subject_performances
    where student_id = v_student_id;

    delete from public.performance_reports
    where student_id = v_student_id;

    delete from public.progress_history
    where student_id = v_student_id;

    -- C. Batches, Enrollments, and Attendance
    delete from public.batch_students
    where student_id = v_student_id;

    delete from public.course_enrollments
    where student_id = v_student_id
       or profile_id = p_target_profile_id;

    delete from public.session_participants
    where student_id = v_student_id
       or profile_id = p_target_profile_id;

    delete from public.attendance_events
    where student_id = v_student_id;

    delete from public.attendance
    where student_id = v_student_id;

    -- D. Subscriptions & PYQ purchases
    delete from public.student_pyq_purchases
    where student_id = v_student_id
       or profile_id = p_target_profile_id;

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

    -- E. Notes, Bookmarks, Downloads, Doubts & Live Chat
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
    where sender_id = p_target_profile_id
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
    where author_id = p_target_profile_id
       or doubt_id in (
         select doubt_id
         from public.student_doubts
         where student_id = v_student_id
       );

    delete from public.student_doubts
    where student_id = v_student_id;

    delete from public.messages
    where sender_id = p_target_profile_id
       or conversation_id in (
         select conversation_id
         from public.conversations
         where student_id = v_student_id
       );

    delete from public.conversations
    where student_id = v_student_id;

    -- F. Delete the student_details row
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

  -- Defensive check for soft-delete/audit columns on catalog tables
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

  -- ─── 8. Session, Tokens, Roles & Devices ───────────────────────────────────
  delete from public.trusted_devices where profile_id = p_target_profile_id;
  delete from public.notification_recipients where profile_id = p_target_profile_id;
  delete from public.device_tokens where profile_id = p_target_profile_id;
  delete from public.user_device_sessions where profile_id = p_target_profile_id;
  delete from public.admin_roles where profile_id = p_target_profile_id;

  -- ─── 9. Delete the User Profile ───────────────────────────────────────────
  delete from public.profiles
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
revoke execute on function public.delete_user_account_data(uuid) from public, anon, authenticated;
grant execute on function public.delete_user_account_data(uuid) to service_role;

comment on function public.delete_user_account_data(uuid) is
  'Performs atomic, cascade deletion and legal anonymization of all user-owned data. '
  'Callable strictly by backend service-role in response to an authenticated account-deletion request.';
