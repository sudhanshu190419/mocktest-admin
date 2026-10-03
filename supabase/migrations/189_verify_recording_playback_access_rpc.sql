-- ============================================================================
-- Migration: 189 - Verify Recording Playback Access RPC
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Purpose:
--   Consolidates the sequential authorization and database queries in the
--   recording-playback-url Edge Function into a single SECURITY DEFINER RPC.
--   Verifies whether an authenticated caller (Admin, Teacher, or Student) has
--   permission to play back a given recording and returns the storage bucket
--   and storage path required for local AWS SigV4 URL presigning.
--
-- Security:
--   - SECURITY DEFINER with SET search_path = '' (bypasses RLS recursion safely)
--   - Caller identity derived strictly from auth.uid()
--   - Rejects unauthenticated callers (401)
--   - Never accepts profile_id, student_id, or user_id from client parameters
--   - Preserves institute / tenant isolation
--   - Preserves recording lifecycle checks (completed status, non-deleted, valid storage_path)
--   - Preserves role-based authorization:
--       * Admin: full bypass
--       * Teacher: owns recording directly or via source live class
--       * Student: active batch assignment, active batch membership, and
--                  course content entitlement via public.can_student_access_content()
-- ============================================================================

CREATE OR REPLACE FUNCTION public.verify_recording_playback_access(
  p_recording_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id             uuid;
  v_role                text;
  v_caller_institute_id uuid;
  v_rec                 record;
  v_teacher_id          uuid;
  v_owns_recording      boolean := false;
  v_student_id          uuid;
  v_has_linked_courses  boolean := false;
  v_has_content_access  boolean := false;
BEGIN
  -- 1. Validate caller identity (derive strictly from auth.uid())
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'status_code', 401,
      'error_code', 'UNAUTHORIZED',
      'error_message', 'Authentication required. Provide a valid Bearer token.'
    );
  END IF;

  -- 2. Fetch authoritative user profile and role
  SELECT p.role, p.institute_id
  INTO v_role, v_caller_institute_id
  FROM public.profiles p
  WHERE p.profile_id = v_user_id;

  IF NOT FOUND OR v_role IS NULL THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'status_code', 403,
      'error_code', 'UNAUTHORIZED_ROLE',
      'error_message', 'Unauthorized role. Access denied.'
    );
  END IF;

  -- Verify role is one of the recognized application roles
  IF v_role NOT IN ('admin', 'super_admin', 'teacher', 'faculty', 'student') THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'status_code', 403,
      'error_code', 'UNAUTHORIZED_ROLE',
      'error_message', 'Unauthorized role. Access denied.'
    );
  END IF;

  -- 3. Resolve target recording
  SELECT
    r.recording_id,
    r.institute_id,
    r.class_id,
    r.status,
    r.storage_bucket,
    r.storage_path,
    r.is_deleted,
    r.teacher_id
  INTO v_rec
  FROM public.recordings r
  WHERE r.recording_id = p_recording_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'status_code', 404,
      'error_code', 'RECORDING_NOT_FOUND',
      'error_message', 'Recording not found.'
    );
  END IF;

  -- 4. Cross-institute isolation check
  IF v_rec.institute_id IS NOT NULL AND v_caller_institute_id IS NOT NULL AND v_rec.institute_id <> v_caller_institute_id THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'status_code', 403,
      'error_code', 'CROSS_INSTITUTE_DENIED',
      'error_message', 'Access denied. Cross-institute recording access is prohibited.'
    );
  END IF;

  -- 5. Lifecycle status check: must be completed
  IF v_rec.status <> 'completed' THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'status_code', 403,
      'error_code', 'RECORDING_NOT_READY',
      'error_message', 'Recording is not ready for playback. Current status: ' || coalesce(v_rec.status::text, 'unknown')
    );
  END IF;

  -- 6. Soft-delete check: must not be deleted
  IF coalesce(v_rec.is_deleted, false) = true THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'status_code', 410,
      'error_code', 'RECORDING_DELETED',
      'error_message', 'Recording has been deleted.'
    );
  END IF;

  -- 7. Storage path check: must have a non-empty storage path
  IF v_rec.storage_path IS NULL OR trim(v_rec.storage_path) = '' THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'status_code', 500,
      'error_code', 'MISSING_STORAGE_PATH',
      'error_message', 'Recording has no storage path.'
    );
  END IF;

  -- 8. Role-based authorization
  -- Case A: Admin (full bypass)
  IF v_role IN ('admin', 'super_admin') THEN
    RETURN jsonb_build_object(
      'allowed', true,
      'status_code', 200,
      'role', 'admin',
      'storage_bucket', v_rec.storage_bucket,
      'storage_path', v_rec.storage_path
    );

  -- Case B: Teacher (ownership check)
  ELSIF v_role IN ('teacher', 'faculty') THEN
    SELECT td.teacher_id
    INTO v_teacher_id
    FROM public.teacher_details td
    WHERE td.profile_id = v_user_id;

    IF v_teacher_id IS NULL THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'error_code', 'TEACHER_NOT_FOUND',
        'error_message', 'Teacher profile not found.'
      );
    END IF;

    -- Teacher ownership via recordings.teacher_id OR live_classes.teacher_id
    IF v_rec.teacher_id IS NOT NULL AND v_rec.teacher_id = v_teacher_id THEN
      v_owns_recording := true;
    ELSIF v_rec.class_id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.live_classes lc
        WHERE lc.class_id = v_rec.class_id
          AND lc.teacher_id = v_teacher_id
      ) INTO v_owns_recording;
    END IF;

    IF NOT v_owns_recording THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'error_code', 'NOT_OWNER',
        'error_message', 'You do not own this recording.'
      );
    END IF;

    RETURN jsonb_build_object(
      'allowed', true,
      'status_code', 200,
      'role', 'teacher',
      'storage_bucket', v_rec.storage_bucket,
      'storage_path', v_rec.storage_path
    );

  -- Case C: Student (batch assignment + active membership + course content entitlement)
  ELSIF v_role = 'student' THEN
    SELECT sd.student_id
    INTO v_student_id
    FROM public.student_details sd
    WHERE sd.profile_id = v_user_id;

    IF v_student_id IS NULL THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'error_code', 'STUDENT_NOT_FOUND',
        'error_message', 'Student profile not found.'
      );
    END IF;

    -- Check if recording is assigned to any batch subjects
    IF NOT EXISTS (
      SELECT 1
      FROM public.batch_subject_recordings bsr
      WHERE bsr.recording_id = p_recording_id
    ) THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'error_code', 'NO_BATCH_ASSIGNED',
        'error_message', 'This recording is not assigned to any batch.'
      );
    END IF;

    -- Check if recording is assigned to any ACTIVE batch subjects
    IF NOT EXISTS (
      SELECT 1
      FROM public.batch_subject_recordings bsr
      JOIN public.batch_subjects bs ON bs.batch_subject_id = bsr.batch_subject_id
      WHERE bsr.recording_id = p_recording_id
        AND bs.is_active = true
    ) THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'error_code', 'NO_ACTIVE_BATCH',
        'error_message', 'This recording is not assigned to any active batch.'
      );
    END IF;

    -- Check student's active batch membership
    IF NOT EXISTS (
      SELECT 1
      FROM public.batch_subject_recordings bsr
      JOIN public.batch_subjects bs ON bs.batch_subject_id = bsr.batch_subject_id
      JOIN public.batch_students bstud ON bstud.batch_id = bs.batch_id
      WHERE bsr.recording_id = p_recording_id
        AND bs.is_active = true
        AND bstud.student_id = v_student_id
        AND bstud.status = 'active'
    ) THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'error_code', 'NOT_ASSIGNED_TO_RECORDING',
        'error_message', 'You are not assigned to this recording.'
      );
    END IF;

    -- Check if any courses are linked to the recording's active batches
    SELECT EXISTS (
      SELECT 1
      FROM public.batch_subject_recordings bsr
      JOIN public.batch_subjects bs ON bs.batch_subject_id = bsr.batch_subject_id
      JOIN public.course_batches cb ON cb.batch_id = bs.batch_id
      WHERE bsr.recording_id = p_recording_id
        AND bs.is_active = true
    ) INTO v_has_linked_courses;

    IF NOT v_has_linked_courses THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'error_code', 'NO_LINKED_COURSE',
        'error_message', 'Your content access period has ended. Renew your subscription to continue.'
      );
    END IF;

    -- Check course content entitlement using migration 091 can_student_access_content()
    -- Evaluates TRUE if ANY course linked to the recording's active batches satisfies entitlement
    SELECT EXISTS (
      SELECT 1
      FROM (
        SELECT DISTINCT cb.course_id
        FROM public.batch_subject_recordings bsr
        JOIN public.batch_subjects bs ON bs.batch_subject_id = bsr.batch_subject_id
        JOIN public.course_batches cb ON cb.batch_id = bs.batch_id
        WHERE bsr.recording_id = p_recording_id
          AND bs.is_active = true
      ) courses
      WHERE public.can_student_access_content(courses.course_id) = true
    ) INTO v_has_content_access;

    IF NOT v_has_content_access THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'error_code', 'CONTENT_ACCESS_EXPIRED',
        'error_message', 'Your content access period has ended. Renew your subscription to continue.'
      );
    END IF;

    RETURN jsonb_build_object(
      'allowed', true,
      'status_code', 200,
      'role', 'student',
      'storage_bucket', v_rec.storage_bucket,
      'storage_path', v_rec.storage_path
    );

  ELSE
    RETURN jsonb_build_object(
      'allowed', false,
      'status_code', 403,
      'error_code', 'UNAUTHORIZED_ROLE',
      'error_message', 'Unauthorized role. Access denied.'
    );
  END IF;
END;
$$;

COMMENT ON FUNCTION public.verify_recording_playback_access(uuid) IS
  'Consolidated recording playback access authorization RPC. Replaces sequential Edge Function queries with a single SECURITY DEFINER database verification enforcing recording status, deletion, storage path, institute isolation, and role-based access for Admin, Teacher, and Student roles.';

REVOKE ALL ON FUNCTION public.verify_recording_playback_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_recording_playback_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_recording_playback_access(uuid) TO service_role;
