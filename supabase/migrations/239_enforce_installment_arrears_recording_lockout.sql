-- ============================================================================
-- Migration: 239_enforce_installment_arrears_recording_lockout.sql
--
-- Replaces public.verify_recording_playback_access(p_recording_id uuid)
--
-- Security:
--   - SECURITY DEFINER with SET search_path = ''
--   - Preserves Admin, Teacher, and Student role-based access
--   - Preserves institute / tenant isolation
--   - Preserves recording lifecycle checks (completed, non-deleted, storage path)
--   - Authoritative dynamic installment arrears lockout matching live-class
--     due-date semantics and public.authorize_live_class_access (Quad-Check Condition 4)
--   - Enforces arrears check BEFORE can_student_access_content()
--   - Ensures overdue installments return INSTALLMENT_ARREARS_BLOCKED even when
--     the 30-day content access window has elapsed
--   - Blocks ALL recorded classes for the relevant course when an installment is overdue
--   - Preserves non-recording content access policy (can_student_access_content)
--   - Fixes historical terminal agreement false lockouts: agreements with status
--     'cancelled_by_admin', 'withdrawn', or 'defaulted' do NOT block students who
--     hold independent permanent course ownership (is_permanent_course_owner)
--   - Prevents terminal agreement entitlement leaks: terminated agreements without
--     independent course ownership cannot leech access via orphaned subscription rows
--   - Evaluates linked courses without arbitrary LIMIT 1
--   - Preserves administrative review fail-closed protection (AGREEMENT_UNDER_REVIEW)
--   - Returns status_code and http_status consistently for Edge Function compatibility
-- ============================================================================

set search_path = '';

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
    r.class_id,
    r.status,
    r.storage_bucket,
    r.storage_path,
    r.is_deleted,
    r.teacher_id,
    r.duration_seconds
  into v_rec
  from public.recordings r
  where r.recording_id = p_recording_id;

  if not found then
    return jsonb_build_object(
      'allowed', false,
      'status_code', 404,
      'http_status', 404,
      'error_code', 'RECORDING_NOT_FOUND',
      'error_message', 'Recording not found.'
    );
  end if;

  -- 4. Cross-institute isolation check
  if v_rec.institute_id is not null and v_caller_institute_id is not null and v_rec.institute_id <> v_caller_institute_id then
    return jsonb_build_object(
      'allowed', false,
      'status_code', 403,
      'http_status', 403,
      'error_code', 'CROSS_INSTITUTE_DENIED',
      'error_message', 'Access denied. Cross-institute recording access is prohibited.'
    );
  end if;

  -- 5. Lifecycle status check: must be completed
  if v_rec.status <> 'completed' then
    return jsonb_build_object(
      'allowed', false,
      'status_code', 403,
      'http_status', 403,
      'error_code', 'RECORDING_NOT_READY',
      'error_message', 'Recording is not ready for playback. Current status: ' || coalesce(v_rec.status::text, 'unknown')
    );
  end if;

  -- 6. Soft-delete check: must not be deleted
  if coalesce(v_rec.is_deleted, false) = true then
    return jsonb_build_object(
      'allowed', false,
      'status_code', 410,
      'http_status', 410,
      'error_code', 'RECORDING_DELETED',
      'error_message', 'Recording has been deleted.'
    );
  end if;

  -- 7. Storage path check: must have a non-empty storage path
  if v_rec.storage_path is null or trim(v_rec.storage_path) = '' then
    return jsonb_build_object(
      'allowed', false,
      'status_code', 500,
      'http_status', 500,
      'error_code', 'MISSING_STORAGE_PATH',
      'error_message', 'Recording has no storage path.'
    );
  end if;

  -- 8. Role-based authorization
  -- Case A: Admin (full bypass)
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

  -- Case B: Teacher (ownership or conducts source live class)
  elsif v_role in ('teacher', 'faculty') then
    select td.teacher_id
    into v_teacher_id
    from public.teacher_details td
    where td.profile_id = v_user_id;

    if v_teacher_id is null then
      return jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'http_status', 403,
        'error_code', 'TEACHER_NOT_FOUND',
        'error_message', 'Teacher profile not found.'
      );
    end if;

    if v_rec.teacher_id is not null and v_rec.teacher_id = v_teacher_id then
      v_owns_recording := true;
    elsif v_rec.class_id is not null then
      select exists (
        select 1
        from public.live_classes lc
        where lc.class_id = v_rec.class_id
          and lc.teacher_id = v_teacher_id
      ) into v_owns_recording;
    end if;

    if not v_owns_recording then
      return jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'http_status', 403,
        'error_code', 'NOT_OWNER',
        'error_message', 'You do not own this recording.'
      );
    end if;

    return jsonb_build_object(
      'allowed', true,
      'status_code', 200,
      'http_status', 200,
      'role', 'teacher',
      'storage_bucket', v_rec.storage_bucket,
      'storage_path', v_rec.storage_path,
      'duration_seconds', v_rec.duration_seconds
    );

  -- Case C: Student
  elsif v_role = 'student' then
    select sd.student_id
    into v_student_id
    from public.student_details sd
    where sd.profile_id = v_user_id;

    if v_student_id is null then
      return jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'http_status', 403,
        'error_code', 'STUDENT_NOT_FOUND',
        'error_message', 'Student profile not found.'
      );
    end if;

    -- Verify recording is assigned to active batch subjects
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

    -- Resolve institute timezone & current local calendar date (matching live classes)
    if v_rec.institute_id is not null then
      select coalesce(timezone, 'Asia/Kolkata')
      into v_institute_timezone
      from public.institutes
      where institute_id = v_rec.institute_id;
    end if;
    v_current_local_date := (now() at time zone coalesce(v_institute_timezone, 'Asia/Kolkata'))::date;

    -- ========================================================================
    -- INSTALLMENT ARREARS & MULTI-COURSE APPLICABILITY GATE
    --
    -- 1. Evaluates all genuinely applicable courses linked to the recording's
    --    active batch subjects where the student has active batch enrollment
    --    or permanent course ownership.
    -- 2. Evaluates installment obligations BEFORE content access checks so that
    --    an overdue installment returns INSTALLMENT_ARREARS_BLOCKED even when
    --    the 30-day content window has elapsed.
    -- 3. Terminal agreements ('cancelled_by_admin', 'withdrawn', 'defaulted')
    --    do not block students who hold independent permanent course ownership,
    --    but cannot leech access through un-revoked subscription rows without ownership.
    -- 4. If the student has at least one entitled course free of installment arrears,
    --    access is granted immediately (preserves non-arrears course access).
    -- 5. Fail-closed on administrative review ('AGREEMENT_UNDER_REVIEW').
    -- 6. Matches live-class dynamic overdue calculations without stale column dependence.
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

    -- If no candidate course granted clear access, return the authoritative denial reason
    -- Prioritize financial arrears lockout over generic content access expiration
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
        'error_message', 'Initial installment payment has not been verified. Access is suspended.'
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
        'error_code', 'CONTENT_ACCESS_EXPIRED',
        'error_message', 'Your content access period has ended. Renew your subscription to continue.'
      );
    end if;

  else
    return jsonb_build_object(
      'allowed', false,
      'status_code', 403,
      'http_status', 403,
      'error_code', 'UNAUTHORIZED_ROLE',
      'error_message', 'Access denied.'
    );
  end if;
end;
$$;

comment on function public.verify_recording_playback_access(uuid) is
  'Verifies recording playback authorization. Preserves batch isolation, permanent course ownership, and admin/teacher roles while locking recorded classes for students with overdue installment obligations matching live-class Quad-Check Condition 4 rules. Prioritizes arrears lockout over 30-day content window expiry, protects against terminal agreement subscription leaks, and supports independent course ownership.';

revoke all on function public.verify_recording_playback_access(uuid) from public, anon;
grant execute on function public.verify_recording_playback_access(uuid) to authenticated;
grant execute on function public.verify_recording_playback_access(uuid) to service_role;
