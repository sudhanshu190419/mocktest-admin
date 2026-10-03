-- ============================================================================
-- Migration: 196 - Fix Admin Attendance Summary RPC CTE Scoping
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Purpose:
--   Fixes the SQL syntax error (42P01: relation "student_stats" does not exist)
--   in public.get_admin_attendance_summary by unifying overall attendance
--   and below-threshold student count aggregations into a single CTE query.
--
-- Performance & Reliability:
--   - Solves the HTTP 404 error returned by PostgREST due to internal 42P01.
--   - Calculates overall_pct and below_threshold in one query pass.
--   - Preserves exact same JSON structure, arguments, scoping, and security.
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

  -- 4. Count total students in target institute (or platform-wide for super admin if null)
  SELECT count(*)
  INTO v_total_students
  FROM public.student_details
  WHERE (v_target_institute_id IS NULL OR institute_id = v_target_institute_id);

  -- 5. Count total completed live classes
  SELECT count(*)
  INTO v_total_live_classes
  FROM public.live_classes
  WHERE status = 'completed'
    AND (v_target_institute_id IS NULL OR institute_id = v_target_institute_id);

  -- 6. If both completed classes and students exist, compute attendance metrics in a single unified CTE
  IF v_total_live_classes > 0 AND v_total_students > 0 THEN
    WITH completed_classes AS (
      SELECT class_id
      FROM public.live_classes
      WHERE status = 'completed'
        AND (v_target_institute_id IS NULL OR institute_id = v_target_institute_id)
    ),
    class_attendance AS (
      SELECT a.student_id, a.attendance_status
      FROM public.attendance a
      JOIN completed_classes cc ON cc.class_id = a.class_id
    ),
    overall_stats AS (
      SELECT
        COALESCE(
          ROUND(
            ((count(*) FILTER (WHERE attendance_status = 'present') * 100.0) +
             (count(*) FILTER (WHERE attendance_status = 'partial') * 50.0)) / NULLIF(count(*), 0)
          )::integer,
          0
        ) AS overall_pct
      FROM class_attendance
    ),
    student_stats AS (
      SELECT
        student_id,
        count(*) AS total,
        count(*) FILTER (WHERE attendance_status = 'present') AS present_count,
        count(*) FILTER (WHERE attendance_status = 'partial') AS partial_count
      FROM class_attendance
      GROUP BY student_id
    ),
    below_threshold AS (
      SELECT
        count(*) AS below_count
      FROM (
        SELECT
          ROUND(
            ((present_count * 100.0) + (partial_count * 50.0)) / total
          ) AS student_pct
        FROM student_stats
        WHERE total > 0
      ) sub
      WHERE sub.student_pct < COALESCE(p_threshold, 75)
    )
    SELECT
      os.overall_pct,
      bt.below_count
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
  'Returns consolidated admin attendance summary (totalStudents, totalLiveClasses, overallAttendancePercent, studentsBelowThreshold) in a single database aggregation with multi-tenant scoping.';

REVOKE ALL ON FUNCTION public.get_admin_attendance_summary(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_attendance_summary(uuid, integer) TO authenticated;
