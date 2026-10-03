-- ============================================================================
-- Migration: 184 — Fix Recording RLS Teacher Assignment and Student Access
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Purpose:
--   1. Allow authorized teachers to INSERT/DELETE on public.batch_subject_recordings
--      for recordings and batch subjects they own/teach.
--   2. Create SECURITY DEFINER helper public.student_can_access_recording(uuid)
--      to authorize student access to completed, non-deleted recordings linked to
--      their active batch subjects.
--   3. Replace legacy recordings RLS policy on public.recordings that depended
--      on obsolete recordings.batch_id column.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 1 — Teacher INSERT/DELETE policies on batch_subject_recordings
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Teachers can insert into batch_subject_recordings"
  ON public.batch_subject_recordings;

CREATE POLICY "Teachers can insert into batch_subject_recordings"
  ON public.batch_subject_recordings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_teacher()
    AND (
      -- Case A: Teacher owns the recording directly
      EXISTS (
        SELECT 1
        FROM public.recordings r
        WHERE r.recording_id = batch_subject_recordings.recording_id
          AND r.teacher_id = public.get_my_teacher_id()
      )
      -- Case B: Teacher owns the source live class
      OR EXISTS (
        SELECT 1
        FROM public.recordings r
        JOIN public.live_classes lc
          ON lc.class_id = r.class_id
        WHERE r.recording_id = batch_subject_recordings.recording_id
          AND lc.teacher_id = public.get_my_teacher_id()
      )
    )
    AND (
      -- And teacher is assigned to this batch_subject
      EXISTS (
        SELECT 1
        FROM public.batch_subject_teachers bst
        WHERE bst.batch_subject_id = batch_subject_recordings.batch_subject_id
          AND bst.teacher_id = public.get_my_teacher_id()
      )
      -- Or batch_subject is linked to the recording's source live class
      OR EXISTS (
        SELECT 1
        FROM public.recordings r
        JOIN public.batch_subject_live_classes bslc
          ON bslc.class_id = r.class_id
        WHERE r.recording_id = batch_subject_recordings.recording_id
          AND bslc.batch_subject_id = batch_subject_recordings.batch_subject_id
      )
    )
  );

COMMENT ON POLICY "Teachers can insert into batch_subject_recordings"
  ON public.batch_subject_recordings IS
  'Allows teachers to assign recordings they created/taught to batch subjects they teach or that are attached to the source live class.';

DROP POLICY IF EXISTS "Teachers can delete from batch_subject_recordings"
  ON public.batch_subject_recordings;

CREATE POLICY "Teachers can delete from batch_subject_recordings"
  ON public.batch_subject_recordings
  FOR DELETE
  TO authenticated
  USING (
    public.is_teacher()
    AND (
      EXISTS (
        SELECT 1
        FROM public.recordings r
        WHERE r.recording_id = batch_subject_recordings.recording_id
          AND r.teacher_id = public.get_my_teacher_id()
      )
      OR EXISTS (
        SELECT 1
        FROM public.recordings r
        JOIN public.live_classes lc
          ON lc.class_id = r.class_id
        WHERE r.recording_id = batch_subject_recordings.recording_id
          AND lc.teacher_id = public.get_my_teacher_id()
      )
    )
  );

COMMENT ON POLICY "Teachers can delete from batch_subject_recordings"
  ON public.batch_subject_recordings IS
  'Allows teachers to remove assignments for recordings they own or taught.';

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 2 — Student Recording Access Helper Function
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.student_can_access_recording(
  p_recording_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.recordings r
    JOIN public.batch_subject_recordings bsr
      ON bsr.recording_id = r.recording_id
    JOIN public.batch_subjects bs
      ON bs.batch_subject_id = bsr.batch_subject_id
    JOIN public.batch_students bst
      ON bst.batch_id = bs.batch_id
    WHERE r.recording_id = p_recording_id
      AND r.status = 'completed'
      AND r.is_deleted = false
      AND bs.is_active = true
      AND bst.student_id = public.get_my_student_id()
      AND bst.status = 'active'
  );
$$;

COMMENT ON FUNCTION public.student_can_access_recording(uuid) IS
'Returns true if the authenticated student is actively enrolled in any batch linked to the completed recording via batch_subject_recordings. Executes as SECURITY DEFINER to avoid recursive RLS evaluation failure.';

REVOKE ALL ON FUNCTION public.student_can_access_recording(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_can_access_recording(uuid) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 3 — Recreate Student Read Policy on public.recordings
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Students view batch recordings"
  ON public.recordings;

DROP POLICY IF EXISTS "Students can view assigned batch recordings"
  ON public.recordings;

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
