-- ============================================================================
-- Migration: 199 - Paginated & Aggregated Admin Live Class Attendance RPC
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Purpose:
--   High-performance server-side paginated & aggregated query for the Admin
--   Live Class Attendance table (Tab 4).
--
-- Architecture & Scalability:
--   1. Replaces the client-side 7-query mega-fetch with a single SQL RPC.
--   2. Evaluates filters (institute, dates, teacher, batch, search) at the database level.
--   3. Calculates total_count and paginates with LIMIT/OFFSET.
--   4. Computes expected students and attendance counts (present, partial, absent)
--      ONLY for the classes on the active page.
--   5. Unifies batch relationships from BOTH paths:
--      - batch_subject_live_classes -> batch_subjects -> batch_id
--      - live_class_batch -> batch_id
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_admin_live_class_attendance_paginated(
  p_institute_id  uuid DEFAULT NULL,
  p_page          integer DEFAULT 1,
  p_page_size     integer DEFAULT 10,
  p_date_from     timestamptz DEFAULT NULL,
  p_date_to       timestamptz DEFAULT NULL,
  p_teacher_id    uuid DEFAULT NULL,
  p_batch_id      uuid DEFAULT NULL,
  p_search        text DEFAULT NULL
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
  v_page                    integer;
  v_page_size               integer;
  v_offset                  integer;
  v_total_count             bigint := 0;
  v_result                  jsonb;
BEGIN
  -- 1. Validate caller identity (derive strictly from auth.uid())
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  -- 2. Verify admin authorization
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: only administrators can access live class attendance analytics.' USING ERRCODE = '42501';
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

  -- 4. Sanitize pagination parameters
  v_page := GREATEST(COALESCE(p_page, 1), 1);
  v_page_size := LEAST(GREATEST(COALESCE(p_page_size, 10), 1), 100);
  v_offset := (v_page - 1) * v_page_size;

  -- 5. Execute query and aggregate
  WITH all_batch_class_mappings AS (
    SELECT sub.batch_id, bslc.class_id
    FROM public.batch_subjects sub
    JOIN public.batch_subject_live_classes bslc ON bslc.batch_subject_id = sub.batch_subject_id
    UNION
    SELECT lcb.batch_id, lcb.class_id
    FROM public.live_class_batch lcb
  ),
  filtered_classes AS (
    SELECT
      lc.class_id,
      lc.title,
      lc.scheduled_at,
      lc.duration_min,
      lc.teacher_id,
      COALESCE(tp.name, 'Unknown') AS teacher_name
    FROM public.live_classes lc
    LEFT JOIN public.teacher_details td ON td.teacher_id = lc.teacher_id
    LEFT JOIN public.profiles tp ON tp.profile_id = td.profile_id
    WHERE lc.status = 'completed'
      AND (v_target_institute_id IS NULL OR lc.institute_id = v_target_institute_id)
      AND (p_date_from IS NULL OR lc.scheduled_at >= p_date_from)
      AND (p_date_to IS NULL OR lc.scheduled_at <= p_date_to)
      AND (p_teacher_id IS NULL OR lc.teacher_id = p_teacher_id)
      AND (
        p_batch_id IS NULL OR
        lc.class_id IN (
          SELECT abcm.class_id
          FROM all_batch_class_mappings abcm
          WHERE abcm.batch_id = p_batch_id
        )
      )
      AND (
        p_search IS NULL OR TRIM(p_search) = '' OR
        lc.title ILIKE '%' || TRIM(p_search) || '%' OR
        tp.name ILIKE '%' || TRIM(p_search) || '%'
      )
  ),
  total_metrics AS (
    SELECT count(*) AS total_count FROM filtered_classes
  ),
  page_classes AS (
    SELECT
      fc.class_id,
      fc.title,
      fc.scheduled_at,
      fc.duration_min,
      fc.teacher_id,
      fc.teacher_name
    FROM filtered_classes fc
    ORDER BY fc.scheduled_at DESC
    LIMIT v_page_size OFFSET v_offset
  ),
  page_class_batches AS (
    SELECT DISTINCT
      pc.class_id,
      b.batch_id,
      b.name AS batch_name
    FROM page_classes pc
    JOIN all_batch_class_mappings abcm ON abcm.class_id = pc.class_id
    JOIN public.batches b ON b.batch_id = abcm.batch_id
    WHERE b.deleted_at IS NULL
      AND (v_target_institute_id IS NULL OR b.institute_id = v_target_institute_id)
  ),
  page_batch_summaries AS (
    SELECT
      pcb.class_id,
      string_agg(pcb.batch_name, ', ' ORDER BY pcb.batch_name) AS batch_name_str
    FROM page_class_batches pcb
    GROUP BY pcb.class_id
  ),
  expected_students AS (
    SELECT DISTINCT
      pc.class_id,
      bs.student_id
    FROM page_classes pc
    JOIN page_class_batches pcb ON pcb.class_id = pc.class_id
    JOIN public.batch_students bs ON bs.batch_id = pcb.batch_id
    WHERE bs.status = 'active'
      AND bs.enrolled_on <= pc.scheduled_at::date
  ),
  attendance_counts AS (
    SELECT
      pc.class_id,
      count(es.student_id) AS total_students,
      count(es.student_id) FILTER (WHERE a.attendance_status = 'present') AS present_count,
      count(es.student_id) FILTER (WHERE a.attendance_status = 'partial') AS partial_count,
      count(es.student_id) FILTER (WHERE a.attendance_status = 'absent' OR a.attendance_status IS NULL) AS absent_count
    FROM page_classes pc
    LEFT JOIN expected_students es ON es.class_id = pc.class_id
    LEFT JOIN public.attendance a ON a.class_id = es.class_id AND a.student_id = es.student_id
    GROUP BY pc.class_id
  )
  SELECT
    tm.total_count,
    jsonb_build_object(
      'classes', COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'classId', pc.class_id,
              'date', pc.scheduled_at,
              'durationMin', pc.duration_min,
              'title', pc.title,
              'teacherId', pc.teacher_id,
              'teacherName', pc.teacher_name,
              'batchName', COALESCE(pbs.batch_name_str, 'No Batch Assigned'),
              'totalStudents', COALESCE(ac.total_students, 0),
              'presentCount', COALESCE(ac.present_count, 0),
              'partialCount', COALESCE(ac.partial_count, 0),
              'absentCount', COALESCE(ac.absent_count, 0)
            )
            ORDER BY pc.scheduled_at DESC
          )
          FROM page_classes pc
          LEFT JOIN page_batch_summaries pbs ON pbs.class_id = pc.class_id
          LEFT JOIN attendance_counts ac ON ac.class_id = pc.class_id
        ),
        '[]'::jsonb
      ),
      'total', tm.total_count,
      'page', v_page,
      'pageSize', v_page_size,
      'totalPages', CEIL(tm.total_count::numeric / NULLIF(v_page_size, 0))::integer
    )
  INTO
    v_total_count,
    v_result
  FROM total_metrics tm;

  RETURN COALESCE(v_result, jsonb_build_object(
    'classes', '[]'::jsonb,
    'total', 0,
    'page', v_page,
    'pageSize', v_page_size,
    'totalPages', 0
  ));
END;
$$;

COMMENT ON FUNCTION public.get_admin_live_class_attendance_paginated(uuid, integer, integer, timestamptz, timestamptz, uuid, uuid, text) IS
  'Returns server-side paginated and aggregated live class attendance data for Tab 4 with unified batch mapping and date/teacher/batch/search filtering.';

REVOKE ALL ON FUNCTION public.get_admin_live_class_attendance_paginated(uuid, integer, integer, timestamptz, timestamptz, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_live_class_attendance_paginated(uuid, integer, integer, timestamptz, timestamptz, uuid, uuid, text) TO authenticated;
