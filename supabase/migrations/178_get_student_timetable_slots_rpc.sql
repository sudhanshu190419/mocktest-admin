-- ============================================================================
-- Migration: 178 — Get Student Timetable Slots RPC
--
-- Replaces the heavy student timetable_slots PostgREST query with a dedicated
-- SECURITY DEFINER RPC that performs an efficient, student-scoped query across
-- active batches and returns flattened slot data.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_student_timetable_slots(
  p_batch_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  timetable_slot_id uuid,
  batch_subject_id  uuid,
  batch_id          uuid,
  batch_name        text,
  subject_id        uuid,
  subject_name      text,
  day_of_week       integer,
  start_time        text,
  end_time          text,
  valid_from        text,
  valid_until       text,
  status            text
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
  -- 1. Authentication Check
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  -- 2. Resolve student_id and institute_id
  SELECT
    sd.student_id,
    p.institute_id
  INTO
    v_student_id,
    v_institute_id
  FROM public.student_details sd
  JOIN public.profiles p
    ON p.profile_id = sd.profile_id
  WHERE sd.profile_id = v_user_id
  LIMIT 1;

  IF v_student_id IS NULL OR v_institute_id IS NULL THEN
    RETURN;
  END IF;

  -- 3. Return active timetable slots for the student's active batches
  RETURN QUERY
  SELECT
    ts.timetable_slot_id,
    ts.batch_subject_id,
    bs.batch_id,
    b.name::text AS batch_name,
    s.subject_id,
    s.name::text AS subject_name,
    ts.day_of_week::integer,
    ts.start_time::text,
    ts.end_time::text,
    ts.valid_from::text,
    ts.valid_until::text,
    ts.status::text
  FROM public.timetable_slots ts
  JOIN public.batch_subjects bs
    ON bs.batch_subject_id = ts.batch_subject_id
  JOIN public.batch_students bst
    ON bst.batch_id = bs.batch_id
  JOIN public.batches b
    ON b.batch_id = bs.batch_id
  JOIN public.subjects s
    ON s.subject_id = bs.subject_id
  WHERE bst.student_id = v_student_id
  AND bst.status = 'active'
  AND b.institute_id = v_institute_id
  AND b.deleted_at IS NULL
  AND s.deleted_at IS NULL
  AND bs.institute_id = v_institute_id
  AND bs.is_active = true
  AND ts.institute_id = v_institute_id
  AND ts.status = 'active'
    AND (
      p_batch_ids IS NULL
      OR array_length(p_batch_ids, 1) IS NULL
      OR bs.batch_id = ANY(p_batch_ids)
    )
  ORDER BY
    ts.day_of_week ASC,
    ts.start_time ASC;
END;
$$;

COMMENT ON FUNCTION public.get_student_timetable_slots(uuid[]) IS
'Fetches recurring timetable slots for the authenticated student scoped to their active batches with flattened batch and subject metadata.';

-- Revoke default public execution; grant to authenticated only
REVOKE ALL ON FUNCTION public.get_student_timetable_slots(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_timetable_slots(uuid[]) TO authenticated;
