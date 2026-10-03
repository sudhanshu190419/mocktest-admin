-- ============================================================================
-- Migration: 092 — Get Student Recording Subjects RPC
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Purpose:
--   Returns subject summaries (subject_id, subject_name, recording_count,
--   latest_recording_at) for all subjects that have >= 1 completed, non-deleted
--   recording accessible to the authenticated student through their active batches.
--
-- Security:
--   - SECURITY DEFINER with empty search_path
--   - Authenticated student resolution via auth.uid() and student_details
--   - Scopes strictly to batches where the student has batch_students.status = 'active'
--   - Does NOT trust client-supplied batch IDs arbitrarily
--   - Enforces institute isolation, batch active status, and soft-delete exclusions
--   - Deduplicates count via COUNT(DISTINCT recordings.recording_id)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_student_recording_subjects(
  p_batch_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  subject_id uuid,
  subject_name text,
  recording_count integer,
  latest_recording_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id      uuid;
  v_student_id   uuid;
  v_institute_id uuid;
BEGIN
  -- 1. Caller authentication check
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  -- 2. Resolve student profile and institute (fails closed for non-students)
  -- Note: student_details has no account_status column in the deployed schema.
  SELECT sd.student_id, p.institute_id
  INTO v_student_id, v_institute_id
  FROM public.student_details sd
  JOIN public.profiles p ON p.profile_id = sd.profile_id
  WHERE sd.profile_id = v_user_id
  LIMIT 1;

  IF v_student_id IS NULL OR v_institute_id IS NULL THEN
    RETURN;
  END IF;

  -- 3. Return aggregated subject summaries for student's active batches
  RETURN QUERY
  WITH student_active_batches AS (
    SELECT bs_enroll.batch_id
    FROM public.batch_students bs_enroll
    JOIN public.batches b ON b.batch_id = bs_enroll.batch_id
    WHERE bs_enroll.student_id = v_student_id
      AND bs_enroll.status = 'active'
      AND b.institute_id = v_institute_id
      AND b.deleted_at IS NULL
      AND (
        p_batch_ids IS NULL
        OR array_length(p_batch_ids, 1) IS NULL
        OR bs_enroll.batch_id = ANY(p_batch_ids)
      )
  )
  SELECT
    bs.subject_id,
    COALESCE(s.name, bs.name, 'General Subject')::text AS subject_name,
    COUNT(DISTINCT r.recording_id)::integer AS recording_count,
    MAX(r.created_at) AS latest_recording_at
  FROM public.batch_subjects bs
  JOIN student_active_batches sab ON sab.batch_id = bs.batch_id
  JOIN public.subjects s ON s.subject_id = bs.subject_id AND s.deleted_at IS NULL
  JOIN public.batch_subject_recordings bsr ON bsr.batch_subject_id = bs.batch_subject_id
  JOIN public.recordings r ON r.recording_id = bsr.recording_id
  WHERE bs.institute_id = v_institute_id
    AND bs.is_active = true
    AND r.status = 'completed'
    AND r.is_deleted = false
  GROUP BY bs.subject_id, COALESCE(s.name, bs.name, 'General Subject')
  HAVING COUNT(DISTINCT r.recording_id) > 0
  ORDER BY subject_name ASC;
END;
$$;

COMMENT ON FUNCTION public.get_student_recording_subjects(uuid[]) IS
  'Returns subject-level recording count and latest recording date for active batches of the authenticated student. SECURITY DEFINER; enforces student identity, active batch membership, completed/non-deleted recordings, and institute multi-tenant isolation.';

REVOKE ALL ON FUNCTION public.get_student_recording_subjects(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_recording_subjects(uuid[]) TO authenticated, service_role;
