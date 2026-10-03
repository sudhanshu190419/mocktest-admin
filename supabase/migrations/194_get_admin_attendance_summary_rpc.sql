-- ============================================================================
-- Migration: 194 - Consolidate Admin Attendance Summary RPC
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Purpose:
--   Consolidates the 3 sequential HTTP queries (student_details, live_classes,
--   attendance) executed by Admin Attendance Management into a single,
--   highly-optimized SECURITY DEFINER RPC function.
--
-- Performance:
--   Replaces client-side fetching and in-memory aggregation of thousands of
--   raw attendance rows with server-side SQL aggregation.
--
-- Security:
--   - SECURITY DEFINER with SET search_path = '' (prevents search-path hijacking)
--   - Caller identity derived strictly from auth.uid()
--   - Requires caller to have role = 'admin' (via public.is_admin())
--   - Preserves institute / tenant isolation:
--       * Super Admin: can query platform-wide (p_institute_id IS NULL)
--         or filter by a specific institute UUID.
--       * Institute Admin: strictly scoped to caller's profiles.institute_id.
--         Cannot view platform-wide summary; passing foreign institute is rejected.
--   - Returns predictable typed JSONB matching AdminAttendanceSummary.
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

  -- 6. If both completed classes and students exist, compute attendance metrics
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
        count(*) AS total_records,
        count(*) FILTER (WHERE attendance_status = 'present') AS present_count,
        count(*) FILTER (WHERE attendance_status = 'partial') AS partial_count
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
    )
    SELECT
      COALESCE(
        ROUND(
          ((present_count * 100.0) + (partial_count * 50.0)) / NULLIF(total_records, 0)
        )::integer,
        0
      )
    INTO v_overall_attendance_pct
    FROM overall_stats;

    SELECT
      count(*)
    INTO v_below_threshold_count
    FROM (
      SELECT
        ROUND(
          ((present_count * 100.0) + (partial_count * 50.0)) / total
        ) AS student_pct
      FROM student_stats
      WHERE total > 0
    ) sub
    WHERE sub.student_pct < COALESCE(p_threshold, 75);
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
