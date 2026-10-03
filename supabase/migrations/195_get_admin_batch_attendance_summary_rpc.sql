-- ============================================================================
-- Migration: 195 - Consolidate Admin Batch Attendance Summary RPC
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Purpose:
--   Consolidates the 5-step sequential HTTP waterfall
--   (batches -> batch_students -> batch_subject_live_classes -> live_classes -> attendance)
--   executed by Admin Attendance Management (Tab 1) into a single,
--   highly-optimized SECURITY DEFINER RPC function.
--
-- Performance:
--   Eliminates round-trips, duplicate batch queries, and heavy client-side
--   array manipulations by performing relational aggregation in SQL.
--
-- Security:
--   - SECURITY DEFINER with SET search_path = '' (prevents search-path hijacking)
--   - Caller identity derived strictly from auth.uid()
--   - Requires caller to have role = 'admin' (via public.is_admin())
--   - Preserves institute / tenant isolation:
--       * Super Admin: can query platform-wide (p_institute_id IS NULL)
--         or filter by a specific institute UUID.
--       * Institute Admin: strictly scoped to caller's profiles.institute_id.
--         Cannot view platform-wide data; passing foreign institute is rejected.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_admin_batch_attendance_summary(
  p_institute_id uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_teacher_id uuid DEFAULT NULL
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
  v_result                  jsonb;
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
      RAISE EXCEPTION 'Forbidden: cannot access batch attendance for another institute.' USING ERRCODE = '42501';
    END IF;
    v_target_institute_id := v_caller_institute_id;
    IF v_target_institute_id IS NULL THEN
      RAISE EXCEPTION 'Forbidden: institute-scoped admin is missing an institute association.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 4. Aggregate batch attendance metrics
  WITH target_batches AS (
    SELECT batch_id, name
    FROM public.batches
    WHERE deleted_at IS NULL
      AND (v_target_institute_id IS NULL OR institute_id = v_target_institute_id)
    ORDER BY name ASC
  ),
  batch_student_counts AS (
    SELECT
      bs.batch_id,
      count(DISTINCT bs.student_id) AS student_count
    FROM public.batch_students bs
    JOIN target_batches tb ON tb.batch_id = bs.batch_id
    GROUP BY bs.batch_id
  ),
  batch_completed_classes AS (
    SELECT DISTINCT
      sub.batch_id,
      bslc.class_id
    FROM public.batch_subjects sub
    JOIN public.batch_subject_live_classes bslc ON bslc.batch_subject_id = sub.batch_subject_id
    JOIN public.live_classes lc ON lc.class_id = bslc.class_id
    WHERE lc.status = 'completed'
      AND (p_teacher_id IS NULL OR lc.teacher_id = p_teacher_id)
      AND (p_date_from IS NULL OR lc.scheduled_at >= p_date_from)
      AND (p_date_to IS NULL OR lc.scheduled_at <= p_date_to)
      AND (v_target_institute_id IS NULL OR lc.institute_id = v_target_institute_id)
  ),
  batch_class_counts AS (
    SELECT
      batch_id,
      count(class_id) AS class_count
    FROM batch_completed_classes
    GROUP BY batch_id
  ),
  batch_attendance_records AS (
    SELECT
      bcc.batch_id,
      a.attendance_status
    FROM batch_completed_classes bcc
    JOIN public.batch_students bs ON bs.batch_id = bcc.batch_id
    JOIN public.attendance a ON a.class_id = bcc.class_id AND a.student_id = bs.student_id
  ),
  batch_att_stats AS (
    SELECT
      batch_id,
      count(*) FILTER (WHERE attendance_status = 'present') AS present_count,
      count(*) FILTER (WHERE attendance_status = 'partial') AS partial_count
    FROM batch_attendance_records
    GROUP BY batch_id
  ),
  batch_results AS (
    SELECT
      tb.batch_id,
      tb.name AS batch_name,
      COALESCE(bsc.student_count, 0) AS student_count,
      COALESCE(bas.present_count, 0) AS present_count,
      COALESCE(bas.partial_count, 0) AS partial_count,
      CASE
        WHEN COALESCE(bcc.class_count, 0) > 0 AND COALESCE(bsc.student_count, 0) > 0 THEN
          (COALESCE(bcc.class_count, 0) * COALESCE(bsc.student_count, 0))
          - COALESCE(bas.present_count, 0)
          - COALESCE(bas.partial_count, 0)
        ELSE 0
      END AS absent_count,
      CASE
        WHEN COALESCE(bcc.class_count, 0) > 0 AND COALESCE(bsc.student_count, 0) > 0 THEN
          ROUND(
            ((COALESCE(bas.present_count, 0) * 100.0) + (COALESCE(bas.partial_count, 0) * 50.0)) /
            (COALESCE(bcc.class_count, 0) * COALESCE(bsc.student_count, 0))
          )::integer
        ELSE 0
      END AS average_attendance_percent
    FROM target_batches tb
    LEFT JOIN batch_student_counts bsc ON bsc.batch_id = tb.batch_id
    LEFT JOIN batch_class_counts bcc ON bcc.batch_id = tb.batch_id
    LEFT JOIN batch_att_stats bas ON bas.batch_id = tb.batch_id
    ORDER BY tb.name ASC
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'batchId', batch_id,
      'batchName', batch_name,
      'studentCount', student_count,
      'averageAttendancePercent', average_attendance_percent,
      'presentCount', present_count,
      'partialCount', partial_count,
      'absentCount', absent_count
    )
  )
  INTO v_result
  FROM batch_results;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_admin_batch_attendance_summary(uuid, timestamptz, timestamptz, uuid) IS
  'Returns batch attendance summary per active batch in a single SQL operation, eliminating 5-step client-side waterfall.';

REVOKE ALL ON FUNCTION public.get_admin_batch_attendance_summary(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_batch_attendance_summary(uuid, timestamptz, timestamptz, uuid) TO authenticated;
