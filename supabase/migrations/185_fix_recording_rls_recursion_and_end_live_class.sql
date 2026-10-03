-- ============================================================================
-- Migration: 185_fix_recording_rls_recursion_and_end_live_class.sql
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Purpose:
--   1. Break RLS infinite recursion on batch_subject_recordings by:
--      - Creating SECURITY DEFINER helper public.teacher_can_assign_recording_to_batch_subject()
--      - Creating SECURITY DEFINER helper public.teacher_can_delete_recording_assignment()
--      - Dropping legacy un-scoped policy "Students can read recordings for accessible batch subjects" on public.recordings
--      - Updating teacher INSERT/DELETE policies on public.batch_subject_recordings
--   2. Fix function ambiguity for end_live_class by:
--      - Dropping redundant 1-argument overload public.end_live_class(uuid)
--      - Reaffirming canonical 2-argument public.end_live_class(uuid, text DEFAULT 'host_ended')
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 1 - Teacher Assignment SECURITY DEFINER Helpers
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.teacher_can_assign_recording_to_batch_subject(
  p_recording_id uuid,
  p_batch_subject_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_teacher_id uuid;
BEGIN
  IF NOT public.is_teacher() THEN
    RETURN false;
  END IF;

  v_teacher_id := public.get_my_teacher_id();
  IF v_teacher_id IS NULL THEN
    RETURN false;
  END IF;

  -- 1. Ensure teacher owns the recording directly OR owns the source live class
  IF NOT EXISTS (
    SELECT 1
    FROM public.recordings r
    LEFT JOIN public.live_classes lc
      ON lc.class_id = r.class_id
    WHERE r.recording_id = p_recording_id
      AND (r.teacher_id = v_teacher_id OR lc.teacher_id = v_teacher_id)
  ) THEN
    RETURN false;
  END IF;

  -- 2. Ensure the batch_subject is legitimately associated:
  --    - Teacher is assigned to teach this batch subject in batch_subject_teachers
  --    - OR the batch subject is attached to the recording's source live class
  IF NOT EXISTS (
    SELECT 1
    FROM public.batch_subjects bs
    WHERE bs.batch_subject_id = p_batch_subject_id
      AND bs.is_active = true
      AND (
        EXISTS (
          SELECT 1
          FROM public.batch_subject_teachers bst
          WHERE bst.batch_subject_id = p_batch_subject_id
            AND bst.teacher_id = v_teacher_id
        )
        OR EXISTS (
          SELECT 1
          FROM public.recordings r
          JOIN public.batch_subject_live_classes bslc
            ON bslc.class_id = r.class_id
          WHERE r.recording_id = p_recording_id
            AND bslc.batch_subject_id = p_batch_subject_id
        )
      )
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.teacher_can_assign_recording_to_batch_subject(uuid, uuid) IS
'Evaluates teacher recording assignment eligibility via SECURITY DEFINER to avoid RLS recursion.';

REVOKE ALL ON FUNCTION public.teacher_can_assign_recording_to_batch_subject(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_can_assign_recording_to_batch_subject(uuid, uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.teacher_can_delete_recording_assignment(
  p_recording_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_teacher_id uuid;
BEGIN
  IF NOT public.is_teacher() THEN
    RETURN false;
  END IF;

  v_teacher_id := public.get_my_teacher_id();
  IF v_teacher_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.recordings r
    LEFT JOIN public.live_classes lc
      ON lc.class_id = r.class_id
    WHERE r.recording_id = p_recording_id
      AND (r.teacher_id = v_teacher_id OR lc.teacher_id = v_teacher_id)
  );
END;
$$;

COMMENT ON FUNCTION public.teacher_can_delete_recording_assignment(uuid) IS
'Evaluates teacher recording deletion eligibility via SECURITY DEFINER to avoid RLS recursion.';

REVOKE ALL ON FUNCTION public.teacher_can_delete_recording_assignment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_can_delete_recording_assignment(uuid) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 2 - Clean Up Legacy & Conflicting Policies on public.recordings
-- ────────────────────────────────────────────────────────────────────────────

-- Drop legacy 094 policy that caused the circular cross-table join
DROP POLICY IF EXISTS "Students can read recordings for accessible batch subjects"
  ON public.recordings;

DROP POLICY IF EXISTS "Students can read recordings for their batch classes"
  ON public.recordings;

DROP POLICY IF EXISTS "Students view batch recordings"
  ON public.recordings;

DROP POLICY IF EXISTS "Students can view assigned batch recordings"
  ON public.recordings;

-- Re-apply canonical student SELECT policy using student_can_access_recording helper
CREATE POLICY "Students can view assigned batch recordings"
  ON public.recordings
  FOR SELECT
  TO authenticated
  USING (
    public.is_student()
    AND public.student_can_access_recording(recordings.recording_id)
  );

COMMENT ON POLICY "Students can view assigned batch recordings"
  ON public.recordings IS
  'Students may view completed recordings assigned to their active enrolled batches via batch_subject_recordings, evaluated via security definer helper.';

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 3 - Recreate Teacher Policies on public.batch_subject_recordings
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Teachers can insert into batch_subject_recordings"
  ON public.batch_subject_recordings;

CREATE POLICY "Teachers can insert into batch_subject_recordings"
  ON public.batch_subject_recordings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_teacher()
    AND public.teacher_can_assign_recording_to_batch_subject(
      batch_subject_recordings.recording_id,
      batch_subject_recordings.batch_subject_id
    )
  );

COMMENT ON POLICY "Teachers can insert into batch_subject_recordings"
  ON public.batch_subject_recordings IS
  'Allows teachers to assign recordings they created/taught to authorized batch subjects using a security definer helper to prevent RLS recursion.';

DROP POLICY IF EXISTS "Teachers can delete from batch_subject_recordings"
  ON public.batch_subject_recordings;

CREATE POLICY "Teachers can delete from batch_subject_recordings"
  ON public.batch_subject_recordings
  FOR DELETE
  TO authenticated
  USING (
    public.is_teacher()
    AND public.teacher_can_delete_recording_assignment(
      batch_subject_recordings.recording_id
    )
  );

COMMENT ON FUNCTION public.teacher_can_delete_recording_assignment(uuid) IS
'Allows teachers to remove assignments for recordings they own or taught using a security definer helper to prevent RLS recursion.';

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 4 - Resolve end_live_class Ambiguity
-- ────────────────────────────────────────────────────────────────────────────

-- 1. Drop the redundant 1-argument overload
DROP FUNCTION IF EXISTS public.end_live_class(uuid);

-- 2. Preserve and reaffirm the canonical 2-argument implementation
CREATE OR REPLACE FUNCTION public.end_live_class(
  p_class_id     uuid,
  p_ended_reason text DEFAULT 'host_ended'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now           timestamptz := clock_timestamp();
  v_teacher_id    uuid;
  v_class_teacher uuid;
  v_class_status  public.live_class_status;
  v_session_id    uuid;
  v_claimed       int;
BEGIN
  -- 0. Validate ended_reason
  IF p_ended_reason IS NULL
     OR p_ended_reason NOT IN ('host_ended', 'watchdog_timeout') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_END_REASON',
      'message', 'Invalid ended_reason. Allowed values: host_ended, watchdog_timeout.'
    );
  END IF;

  -- 1. Authorization
  IF auth.role() = 'service_role' THEN
    v_teacher_id := null;
  ELSIF auth.role() = 'authenticated' AND public.is_teacher() THEN
    v_teacher_id := public.get_my_teacher_id();
    IF v_teacher_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'NOT_AUTHORIZED',
        'message', 'Teacher identity could not be resolved.'
      );
    END IF;
  ELSE
    RETURN jsonb_build_object(
      'success', false,
      'code', 'NOT_AUTHORIZED',
      'message', 'Only teachers may end live classes.'
    );
  END IF;

  -- 2. Load the class
  SELECT teacher_id, status INTO v_class_teacher, v_class_status
    FROM public.live_classes
   WHERE class_id = p_class_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'NOT_FOUND',
      'message', 'Live class not found.'
    );
  END IF;

  -- 3. Ownership
  IF v_teacher_id IS NOT NULL
     AND v_class_teacher IS DISTINCT FROM v_teacher_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'NOT_AUTHORIZED',
      'message', 'You do not own this live class.'
    );
  END IF;

  -- 4. Idempotent class transition: live -> completed
  UPDATE public.live_classes
     SET status     = 'completed'::public.live_class_status,
         updated_at = v_now
   WHERE class_id = p_class_id
     AND status = 'live'::public.live_class_status;

  GET DIAGNOSTICS v_claimed = row_count;

  IF v_claimed = 0 THEN
    SELECT status INTO v_class_status
      FROM public.live_classes
     WHERE class_id = p_class_id;

    IF v_class_status = 'completed'::public.live_class_status THEN
      RETURN jsonb_build_object(
        'success', true,
        'code', 'ALREADY_ENDED',
        'message', 'This class is already completed.',
        'class_id', p_class_id
      );
    END IF;

    IF v_class_status = 'cancelled'::public.live_class_status THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'CLASS_CANCELLED',
        'message', 'This class has been cancelled.'
      );
    END IF;

    IF v_class_status = 'scheduled'::public.live_class_status THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'CLASS_NOT_LIVE',
        'message', 'This class has not started yet.'
      );
    END IF;

    RETURN jsonb_build_object(
      'success', false,
      'code', 'NOT_FOUND',
      'message', 'Live class not found.'
    );
  END IF;

  -- 5. End the active session (idempotent)
  UPDATE public.live_sessions
     SET status       = 'ended'::public.live_session_status,
         ended_at     = v_now,
         ended_reason = p_ended_reason,
         updated_at   = v_now
   WHERE class_id = p_class_id
     AND status = 'live'::public.live_session_status
  RETURNING session_id INTO v_session_id;

  -- 6. Return structured result
  RETURN jsonb_build_object(
    'success',      true,
    'code',         'ENDED',
    'transitioned', true,
    'class_id',     p_class_id,
    'session_id',   v_session_id
  );
END;
$$;

COMMENT ON FUNCTION public.end_live_class(uuid, text) IS
'Ends a live class idempotently, transitions active session, and signals attendance finalization.';

REVOKE ALL ON FUNCTION public.end_live_class(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_live_class(uuid, text) TO authenticated, service_role;
