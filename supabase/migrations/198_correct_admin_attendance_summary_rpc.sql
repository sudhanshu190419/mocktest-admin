-- ============================================================================
-- Migration: 198 - Correct Admin Attendance Summary Expected-Attendance Logic
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Purpose:
--   Corrects the Overall Attendance % and Students Below Threshold calculations
--   in public.get_admin_attendance_summary to use the verified expected-attendance
--   model rather than naive Cartesian products or attendance-table-only rows.
--
-- Business Rules Enforced:
--   1. Expected Attendance Denominator:
--      Deduplicated (class_id, student_id) pairs where:
--        - Class is 'completed' and belongs to caller's institute
--        - Class is linked to a non-deleted batch via live_class_batch OR
--          batch_subject_live_classes -> batch_subjects
--        - Student is actively enrolled in that batch (status = 'active')
--        - Student enrolled on or before the class took place (enrolled_on <= scheduled_at::date)
--   2. Attendance Evaluations:
--        - Present = 100%
--        - Partial = 50%
--        - Absent (or missing attendance row) = 0%
--   3. Below Threshold Calculation:
--      Only students with >= 1 expected attendance opportunity are evaluated.
--      Students with calculated average < p_threshold (default 75) are counted.
--   4. Preserves existing Total Students and Total Live Classes definitions.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_admin_attendance_summary(
  p_institute_id uuid DEFAULT NULL,
  p_threshold integer DEFAULT 75
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id                 uuid;
  v_is_super_admin          boolean;
  v_caller_institute_id     uuid;
  v_target_institute_id     uuid;
  v_total_students          bigint := 0;
  v_total_live_classes      bigint := 0;
  v_overall_attendance_pct  integer := 0;
  v_below_threshold_count   bigint := 0;
BEGIN
  -- 1. Validate caller identity (derive strictly from auth.uid())
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  -- 2. Verify admin authorization
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: only administrators can access attendance analytics.' USING ERRCODE = '42501';
  END IF;

  -- 3. Determine super admin status & institute scope
  v_is_super_admin := public.is_super_admin();

  SELECT institute_id INTO v_caller_institute_id
  FROM public.profiles
  WHERE profile_id = v_user_id;

  IF v_is_super_admin THEN
    v_target_institute_id := p_institute_id;
  ELSE
    IF p_institute_id IS NOT NULL AND p_institute_id IS DISTINCT FROM v_caller_institute_id THEN
      RAISE EXCEPTION 'Forbidden: cannot access attendance analytics for another institute.' USING ERRCODE = '42501';
    END IF;
    v_target_institute_id := v_caller_institute_id;
    IF v_target_institute_id IS NULL THEN
      RAISE EXCEPTION 'Forbidden: institute-scoped admin is missing an institute association.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 4. Count total students in target institute (preserved existing behavior)
  SELECT count(*)
  INTO v_total_students
  FROM public.student_details
  WHERE (v_target_institute_id IS NULL OR institute_id = v_target_institute_id);

  -- 5. Count total completed live classes (preserved existing behavior)
  SELECT count(*)
  INTO v_total_live_classes
  FROM public.live_classes
  WHERE status = 'completed'
    AND (v_target_institute_id IS NULL OR institute_id = v_target_institute_id);

  -- 6. Compute attendance metrics using the verified expected-attendance model
  IF v_total_live_classes > 0 AND v_total_students > 0 THEN
    WITH target_batches AS (
      SELECT batch_id, institute_id
      FROM public.batches
      WHERE deleted_at IS NULL
        AND (v_target_institute_id IS NULL OR institute_id = v_target_institute_id)
    ),
    batch_class_mappings AS (
      SELECT sub.batch_id, bslc.class_id
      FROM public.batch_subjects sub
      JOIN public.batch_subject_live_classes bslc ON bslc.batch_subject_id = sub.batch_subject_id
      UNION
      SELECT lcb.batch_id, lcb.class_id
      FROM public.live_class_batch lcb
    ),
    completed_linked_classes AS (
      SELECT DISTINCT
        bcm.batch_id,
        bcm.class_id,
        lc.scheduled_at::date AS class_date
      FROM batch_class_mappings bcm
      JOIN target_batches tb ON tb.batch_id = bcm.batch_id
      JOIN public.live_classes lc ON lc.class_id = bcm.class_id
      WHERE lc.status = 'completed'
        AND (v_target_institute_id IS NULL OR lc.institute_id = v_target_institute_id)
        AND lc.institute_id = tb.institute_id
    ),
    expected_student_class_pairs AS (
      SELECT DISTINCT
        clc.class_id,
        bs.student_id
      FROM completed_linked_classes clc
      JOIN public.batch_students bs ON bs.batch_id = clc.batch_id
      WHERE bs.status = 'active'
        AND bs.enrolled_on <= clc.class_date
    ),
    evaluated_attendance AS (
      SELECT
        ep.class_id,
        ep.student_id,
        COALESCE(a.attendance_status, 'absent') AS attendance_status
      FROM expected_student_class_pairs ep
      LEFT JOIN public.attendance a
        ON a.class_id = ep.class_id AND a.student_id = ep.student_id
    ),
    overall_stats AS (
      SELECT
        COALESCE(
          ROUND(
            ((count(*) FILTER (WHERE attendance_status = 'present') * 100.0) +
             (count(*) FILTER (WHERE attendance_status = 'partial') * 50.0)) /
            NULLIF(count(*), 0)
          )::integer,
          0
        ) AS overall_pct
      FROM evaluated_attendance
    ),
    student_stats AS (
      SELECT
        student_id,
        count(*) AS expected_opportunities,
        count(*) FILTER (WHERE attendance_status = 'present') AS present_count,
        count(*) FILTER (WHERE attendance_status = 'partial') AS partial_count
      FROM evaluated_attendance
      GROUP BY student_id
    ),
    below_threshold AS (
      SELECT
        count(*) AS below_count
      FROM (
        SELECT
          ROUND(
            ((present_count * 100.0) + (partial_count * 50.0)) / expected_opportunities
          ) AS student_pct
        FROM student_stats
        WHERE expected_opportunities > 0
      ) sub
      WHERE sub.student_pct < COALESCE(p_threshold, 75)
    )
    SELECT
      COALESCE(os.overall_pct, 0),
      COALESCE(bt.below_count, 0)
    INTO
      v_overall_attendance_pct,
      v_below_threshold_count
    FROM overall_stats os
    CROSS JOIN below_threshold bt;
  END IF;

  RETURN jsonb_build_object(
    'totalStudents', COALESCE(v_total_students, 0),
    'totalLiveClasses', COALESCE(v_total_live_classes, 0),
    'overallAttendancePercent', COALESCE(v_overall_attendance_pct, 0),
    'studentsBelowThreshold', COALESCE(v_below_threshold_count, 0)
  );
END;
$$;

COMMENT ON FUNCTION public.get_admin_attendance_summary(uuid, integer) IS
  'Returns consolidated admin attendance summary using verified expected-attendance model based on batch enrollment and scheduled dates.';

REVOKE ALL ON FUNCTION public.get_admin_attendance_summary(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_attendance_summary(uuid, integer) TO authenticated;
