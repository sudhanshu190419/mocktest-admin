-- ============================================================================
-- Migration: 241 — Fix Recording Playback Access Schema Column References
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready | Idempotent
--
-- ## Context & Purpose:
-- Migration 240 decoupled recording playback authorization from student_subscriptions,
-- but introduced invalid database column references in `public.verify_recording_playback_access()`:
--   1. `r.created_by` on `public.recordings` (actual schema column: `teacher_id`).
--   2. `r.live_class_id` on `public.recordings` (actual schema column: `class_id`).
--   3. `bt.is_active` on `public.batch_teachers` (column does not exist on `batch_teachers`).
--   4. `bs.teacher_id` on `public.batch_subjects` (column does not exist on `batch_subjects`;
--      teacher assignment is via `batch_teachers` and `batch_subject_teachers`).
--
-- These invalid references triggered PostgreSQL runtime error 42703 (undefined_column),
-- causing the `recording-playback-url` Edge Function to return:
--   { error: "Failed to verify recording playback access." } (HTTP 500).
--
-- ## Corrections in this Migration:
-- 1. Corrects `public.recordings` lookup to select `r.teacher_id` and `r.class_id`.
-- 2. Uses `recordings.teacher_id` and `live_classes.teacher_id` via `recordings.class_id`
--    for authoritative teacher ownership verification.
-- 3. Preserves batch-level teacher assignment via `public.batch_teachers` (without invalid `bt.is_active`).
-- 4. Preserves subject-level teacher assignment via `public.batch_subject_teachers`.
-- 5. Prevents enum coercion error: replaces `coalesce(v_rec.status, '') <> 'completed'`
--    with safe enum comparison `v_rec.status::text IS DISTINCT FROM 'completed'`, avoiding
--    invalid enum input syntax on empty string coercion.
-- 6. Preserves all student access control, manual batch assignment requirements, permanent course
--    ownership rules, installment agreement validations, arrears gates, and lockout semantics
--    established in Migration 240.
--
-- ## Security:
-- - STABLE, SECURITY DEFINER with SET search_path = ''
-- - Execution granted to authenticated, service_role, and anon.
-- ============================================================================

create or replace function public.verify_recording_playback_access(
  p_recording_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id                   uuid;
  v_role                      text;
  v_caller_institute_id       uuid;
  v_rec                       record;
  v_teacher_id                uuid;
  v_owns_recording            boolean := false;
  v_student_id                uuid;
  v_institute_timezone        text := 'Asia/Kolkata';
  v_current_local_date        date;
  v_course_rec                record;
  v_agr                       record;
  v_effective_overdue         numeric(10,2) := 0.00;
  v_course_blocked            boolean := false;
  v_course_block_code         text := null;
  v_has_arrears_block         boolean := false;
  v_has_review_block          boolean := false;
  v_has_pending_initial_block boolean := false;
  v_has_ineligible_block      boolean := false;
begin
  -- 1. Validate caller identity (derive strictly from auth.uid())
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object(
      'allowed', false,
      'status_code', 401,
      'http_status', 401,
      'error_code', 'UNAUTHORIZED',
      'error_message', 'Authentication required. Provide a valid Bearer token.'
    );
  end if;

  -- 2. Fetch authoritative user profile and role
  select p.role, p.institute_id
  into v_role, v_caller_institute_id
  from public.profiles p
  where p.profile_id = v_user_id;

  if not found or v_role is null then
    return jsonb_build_object(
      'allowed', false,
      'status_code', 403,
      'http_status', 403,
      'error_code', 'UNAUTHORIZED_ROLE',
      'error_message', 'Unauthorized role. Access denied.'
    );
  end if;

  if v_role not in ('admin', 'super_admin', 'teacher', 'faculty', 'student') then
    return jsonb_build_object(
      'allowed', false,
      'status_code', 403,
      'http_status', 403,
      'error_code', 'UNAUTHORIZED_ROLE',
      'error_message', 'Unauthorized role. Access denied.'
    );
  end if;

  -- 3. Resolve target recording
  select
    r.recording_id,
    r.institute_id,
    r.storage_path,
    r.storage_bucket,
    r.duration_seconds,
    r.status,
    r.is_deleted,
    r.teacher_id,
    r.class_id
  into v_rec
  from public.recordings r
  where r.recording_id = p_recording_id;

  if not found or v_rec.recording_id is null then
    return jsonb_build_object(
      'allowed', false,
      'status_code', 404,
      'http_status', 404,
      'error_code', 'RECORDING_NOT_FOUND',
      'error_message', 'Recording not found.'
    );
  end if;

  -- 4. Cross-tenant isolation check
  if v_caller_institute_id is not null and v_rec.institute_id is not null and v_caller_institute_id <> v_rec.institute_id then
    return jsonb_build_object(
      'allowed', false,
      'status_code', 403,
      'http_status', 403,
      'error_code', 'CROSS_INSTITUTE_DENIED',
      'error_message', 'Access denied across institute boundaries.'
    );
  end if;

  -- 5. Soft-delete check
  if coalesce(v_rec.is_deleted, false) = true then
    return jsonb_build_object(
      'allowed', false,
      'status_code', 404,
      'http_status', 404,
      'error_code', 'RECORDING_DELETED',
      'error_message', 'This recording has been deleted.'
    );
  end if;

  -- 6. Recording status check
  if v_rec.status::text IS DISTINCT FROM 'completed' then
    return jsonb_build_object(
      'allowed', false,
      'status_code', 400,
      'http_status', 400,
      'error_code', 'RECORDING_NOT_COMPLETED',
      'error_message', 'This recording is not ready for playback.'
    );
  end if;

  -- 7. Storage path check
  if v_rec.storage_path is null or trim(v_rec.storage_path) = '' then
    return jsonb_build_object(
      'allowed', false,
      'status_code', 404,
      'http_status', 404,
      'error_code', 'RECORDING_FILE_MISSING',
      'error_message', 'Recording media file path is missing.'
    );
  end if;

  -- 8. Role-based routing: Admin and Teacher access
  if v_role in ('admin', 'super_admin') then
    return jsonb_build_object(
      'allowed', true,
      'status_code', 200,
      'http_status', 200,
      'role', 'admin',
      'storage_bucket', v_rec.storage_bucket,
      'storage_path', v_rec.storage_path,
      'duration_seconds', v_rec.duration_seconds
    );
  end if;

  if v_role in ('teacher', 'faculty') then
    select t.teacher_id
    into v_teacher_id
    from public.teacher_details t
    where t.profile_id = v_user_id;

    if v_teacher_id is not null then
      -- Direct recording teacher ownership
      if v_rec.teacher_id is not null and v_rec.teacher_id = v_teacher_id then
        v_owns_recording := true;
      -- Source live class teacher ownership
      elsif v_rec.class_id is not null then
        select exists (
          select 1
          from public.live_classes lc
          where lc.class_id = v_rec.class_id
            and lc.teacher_id = v_teacher_id
        ) into v_owns_recording;
      end if;

      -- Batch-level teacher assignment
      if not v_owns_recording then
        select exists (
          select 1
          from public.batch_subject_recordings bsr
          join public.batch_subjects bs on bs.batch_subject_id = bsr.batch_subject_id
          join public.batch_teachers bt on bt.batch_id = bs.batch_id
          where bsr.recording_id = p_recording_id
            and bt.teacher_id = v_teacher_id
            and bs.is_active = true
        ) into v_owns_recording;
      end if;

      -- Batch-subject-level teacher assignment (Domain 17)
      if not v_owns_recording then
        select exists (
          select 1
          from public.batch_subject_recordings bsr
          join public.batch_subjects bs on bs.batch_subject_id = bsr.batch_subject_id
          join public.batch_subject_teachers bst on bst.batch_subject_id = bs.batch_subject_id
          where bsr.recording_id = p_recording_id
            and bst.teacher_id = v_teacher_id
            and bs.is_active = true
        ) into v_owns_recording;
      end if;
    end if;

    if v_owns_recording then
      return jsonb_build_object(
        'allowed', true,
        'status_code', 200,
        'http_status', 200,
        'role', 'teacher',
        'storage_bucket', v_rec.storage_bucket,
        'storage_path', v_rec.storage_path,
        'duration_seconds', v_rec.duration_seconds
      );
    else
      return jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'http_status', 403,
        'error_code', 'TEACHER_NOT_ASSIGNED',
        'error_message', 'You are not assigned to conduct or manage this recording.'
      );
    end if;
  end if;

  -- 9. Student authorization pipeline
  if v_role = 'student' then
    select s.student_id
    into v_student_id
    from public.student_details s
    where s.profile_id = v_user_id;

    if not found or v_student_id is null then
      return jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'http_status', 403,
        'error_code', 'STUDENT_NOT_FOUND',
        'error_message', 'Student profile not found.'
      );
    end if;

    -- Verify active batch mapping exists
    if not exists (
      select 1
      from public.batch_subject_recordings bsr
      join public.batch_subjects bs on bs.batch_subject_id = bsr.batch_subject_id
      where bsr.recording_id = p_recording_id
        and bs.is_active = true
    ) then
      return jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'http_status', 403,
        'error_code', 'NO_ACTIVE_BATCH',
        'error_message', 'This recording is not assigned to any active batch.'
      );
    end if;

    -- Verify student active batch membership OR permanent course ownership
    if not exists (
      select 1
      from public.batch_subject_recordings bsr
      join public.batch_subjects bs on bs.batch_subject_id = bsr.batch_subject_id
      join public.batch_students bstud on bstud.batch_id = bs.batch_id
      where bsr.recording_id = p_recording_id
        and bs.is_active = true
        and bstud.student_id = v_student_id
        and bstud.status = 'active'
    ) and not exists (
      select 1
      from public.batch_subject_recordings bsr
      join public.batch_subjects bs on bs.batch_subject_id = bsr.batch_subject_id
      join public.course_batches cb on cb.batch_id = bs.batch_id
      where bsr.recording_id = p_recording_id
        and bs.is_active = true
        and public.is_permanent_course_owner(cb.course_id)
    ) then
      return jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'http_status', 403,
        'error_code', 'NOT_ASSIGNED_TO_RECORDING',
        'error_message', 'You are not assigned to this recording.'
      );
    end if;

    -- Resolve institute timezone & current local calendar date
    if v_rec.institute_id is not null then
      select coalesce(timezone, 'Asia/Kolkata')
      into v_institute_timezone
      from public.institutes
      where institute_id = v_rec.institute_id;
    end if;
    v_current_local_date := (now() at time zone coalesce(v_institute_timezone, 'Asia/Kolkata'))::date;

    -- ========================================================================
    -- INSTALLMENT ARREARS & MULTI-COURSE APPLICABILITY GATE
    -- ========================================================================
    for v_course_rec in
      select distinct cb.course_id
      from public.batch_subject_recordings bsr
      join public.batch_subjects bs on bs.batch_subject_id = bsr.batch_subject_id
      join public.course_batches cb on cb.batch_id = bs.batch_id
      where bsr.recording_id = p_recording_id
        and bs.is_active = true
        and (
          exists (
            select 1 from public.batch_students bstud
            where bstud.batch_id = bs.batch_id
              and bstud.student_id = v_student_id
              and bstud.status = 'active'
          )
          or public.is_permanent_course_owner(cb.course_id)
        )
    loop
      v_course_blocked := false;
      v_course_block_code := null;

      -- 1. Evaluate Installment Agreement Obligations for this specific course
      for v_agr in
        select sca.*
        from public.student_course_agreements sca
        where sca.course_id = v_course_rec.course_id
          and sca.student_id = v_student_id
        order by sca.created_at desc
      loop
        -- Terminal agreement handling:
        -- If student holds independent permanent course ownership, the dead agreement does not block.
        -- If student lacks permanent ownership, the terminated agreement cannot grant access.
        if v_agr.agreement_status in ('cancelled_by_admin', 'withdrawn', 'defaulted') then
          if public.is_permanent_course_owner(v_course_rec.course_id) then
            continue;
          else
            v_course_blocked := true;
            v_course_block_code := 'AGREEMENT_INELIGIBLE';
            exit;
          end if;
        end if;

        -- A. Administrative review queue check (fail-closed financial safety guard)
        if coalesce(v_agr.requires_admin_review, false) = true then
          v_course_blocked := true;
          v_course_block_code := 'AGREEMENT_UNDER_REVIEW';
          exit;
        end if;

        -- B. Pending initial payment verification
        if v_agr.agreement_status = 'pending_initial_payment' then
          v_course_blocked := true;
          v_course_block_code := 'INITIAL_PAYMENT_PENDING';
          exit;
        end if;

        -- C. Explicit in_arrears status
        if v_agr.agreement_status = 'in_arrears' then
          v_course_blocked := true;
          v_course_block_code := 'INSTALLMENT_ARREARS_BLOCKED';
          exit;
        end if;

        -- D. Active or Completed: dynamic overdue calculation & schedule check
        if v_agr.agreement_status in ('active', 'completed') then
          v_effective_overdue := public.calculate_effective_overdue_balance(v_agr.agreement_id, v_current_local_date);
          if v_effective_overdue > 0.00 then
            v_course_blocked := true;
            v_course_block_code := 'INSTALLMENT_ARREARS_BLOCKED';
            exit;
          end if;

          -- Dynamic schedule check: effective due date strictly before current local calendar day
          if exists (
            select 1 from public.student_installment_schedule sis
            where sis.agreement_id = v_agr.agreement_id
              and sis.status <> 'waived'
              and coalesce(sis.revised_due_date, sis.due_date) < v_current_local_date
              and (sis.amount_paid + sis.waiver_amount) < sis.amount_due
          ) then
            v_course_blocked := true;
            v_course_block_code := 'INSTALLMENT_ARREARS_BLOCKED';
            exit;
          end if;
        else
          -- Any unrecognized non-terminal status fails closed
          v_course_blocked := true;
          v_course_block_code := 'AGREEMENT_INELIGIBLE';
          exit;
        end if;
      end loop;

      -- Record specific blocker encountered for downstream reporting
      if v_course_block_code = 'INSTALLMENT_ARREARS_BLOCKED' then
        v_has_arrears_block := true;
      elsif v_course_block_code = 'AGREEMENT_UNDER_REVIEW' then
        v_has_review_block := true;
      elsif v_course_block_code = 'INITIAL_PAYMENT_PENDING' then
        v_has_pending_initial_block := true;
      elsif v_course_block_code = 'AGREEMENT_INELIGIBLE' then
        v_has_ineligible_block := true;
      end if;

      -- 2. If this course is not blocked by installment obligations, check content access
      if not v_course_blocked then
        if public.can_student_access_content(v_course_rec.course_id) = true then
          return jsonb_build_object(
            'allowed', true,
            'status_code', 200,
            'http_status', 200,
            'role', 'student',
            'storage_bucket', v_rec.storage_bucket,
            'storage_path', v_rec.storage_path,
            'duration_seconds', v_rec.duration_seconds
          );
        end if;
      end if;
    end loop;

    -- If no candidate course granted clear access, return authoritative denial reason
    if v_has_arrears_block then
      return jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'http_status', 403,
        'error_code', 'INSTALLMENT_ARREARS_BLOCKED',
        'error_message', 'Your installment is overdue. Please complete the pending payment to access recorded classes.'
      );
    elsif v_has_review_block then
      return jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'http_status', 403,
        'error_code', 'AGREEMENT_UNDER_REVIEW',
        'error_message', 'Installment agreement is pending administrative review. Recorded classes are suspended.'
      );
    elsif v_has_pending_initial_block then
      return jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'http_status', 403,
        'error_code', 'INITIAL_PAYMENT_PENDING',
        'error_message', 'Initial installment payment has not been verified. Recorded classes are suspended.'
      );
    elsif v_has_ineligible_block then
      return jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'http_status', 403,
        'error_code', 'AGREEMENT_INELIGIBLE',
        'error_message', 'Installment agreement is not in good standing. Recorded classes are suspended.'
      );
    else
      return jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'http_status', 403,
        'error_code', 'RECORDING_ACCESS_EXPIRED',
        'error_message', 'Your course content access window has expired. Please enroll or clear pending installments to continue watching.'
      );
    end if;
  end if;

  return jsonb_build_object(
    'allowed', false,
    'status_code', 403,
    'http_status', 403,
    'error_code', 'UNAUTHORIZED_ROLE',
    'error_message', 'Unauthorized role.'
  );
end;
$$;

comment on function public.verify_recording_playback_access(uuid) is
  'Phase 4A Corrective Migration 241: Authoritative dynamic recording playback access verification completely independent of student_subscriptions. Repaired schema column references (recordings.teacher_id, recordings.class_id, batch_teachers, and batch_subject_teachers). Gated by installment arrears lockout and decoupled can_student_access_content().';

revoke all on function public.verify_recording_playback_access(uuid) from public;
grant execute on function public.verify_recording_playback_access(uuid) to authenticated, service_role, anon;
