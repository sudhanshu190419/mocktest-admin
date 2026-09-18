-- ============================================================================
-- Migration: 155 — get_courses_content_summary RPC
--
-- Consolidated, batched RPC that replaces per-course content summary waterfalls
-- (getCourseContentSummary) with a single, high-performance database round-trip.
--
-- Key features:
--   1. Batch resolution: Scopes queries strictly to the authenticated student's
--      active batch memberships via public.get_student_batch_ids().
--   2. Course-to-Subject mapping: Follows the authoritative Domain 16/17 schema:
--      course_batches -> batch_subjects -> batch_subject_contents / batch_subject_mock_tests.
--   3. Pre-aggregated counts: Performs GROUP BY and COUNT aggregations inside PostgreSQL
--      for content types and mock test questions without transferring raw rows over the wire.
--   4. Status derivation: Computes mock test availability status ('available', 'upcoming',
--      'expired') from batch_subject_mock_tests and mock_tests availability windows.
--   5. Response shape: Returns a JSONB object keyed by course_id string, mapping to an
--      array of CourseContentSummaryItem objects matching the existing UI contract.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_courses_content_summary(
  p_course_ids UUID[],
  p_batch_ids UUID[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id             UUID;
  v_student_id          UUID;
  v_authorized_batches  UUID[];
  v_now                 TIMESTAMPTZ := clock_timestamp();
  v_result              JSONB := '{}'::JSONB;
BEGIN
  -- 1. Security Check: Authenticated session required
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: active session required'
    );
  END IF;

  -- 2. Resolve student_details.student_id
  SELECT student_id INTO v_student_id
  FROM public.student_details
  WHERE profile_id = v_user_id
  LIMIT 1;

  IF v_student_id IS NULL THEN
    v_student_id := public.get_my_student_id();
  END IF;

  IF v_student_id IS NULL THEN
    -- Non-student callers receive empty map
    RETURN '{}'::JSONB;
  END IF;

  -- 3. Resolve student's active batch memberships
  v_authorized_batches := public.get_student_batch_ids();

  IF v_authorized_batches IS NULL OR array_length(v_authorized_batches, 1) IS NULL THEN
    -- Student has no active batches — return empty arrays for each requested course
    RETURN (
      SELECT COALESCE(
        jsonb_object_agg(c_id::text, '[]'::jsonb),
        '{}'::jsonb
      )
      FROM unnest(p_course_ids) AS c_id
    );
  END IF;

  -- 4. If client passed specific batch IDs, intersect with authorized batches
  IF p_batch_ids IS NOT NULL AND array_length(p_batch_ids, 1) > 0 THEN
    SELECT COALESCE(array_agg(b_id), '{}') INTO v_authorized_batches
    FROM unnest(v_authorized_batches) AS b_id
    WHERE b_id = ANY(p_batch_ids);
  END IF;

  IF v_authorized_batches IS NULL OR array_length(v_authorized_batches, 1) IS NULL THEN
    RETURN (
      SELECT COALESCE(
        jsonb_object_agg(c_id::text, '[]'::jsonb),
        '{}'::jsonb
      )
      FROM unnest(p_course_ids) AS c_id
    );
  END IF;

  -- 5. Build consolidated summaries for requested courses
  WITH target_courses AS (
    SELECT DISTINCT c_id
    FROM unnest(p_course_ids) AS c_id
    WHERE c_id IS NOT NULL
  ),
  course_scoped_batches AS (
    SELECT DISTINCT
      tc.c_id AS course_id,
      cb.batch_id
    FROM target_courses tc
    JOIN public.course_batches cb ON cb.course_id = tc.c_id
    WHERE cb.batch_id = ANY(v_authorized_batches)
  ),
  scoped_batch_subjects AS (
    SELECT
      csb.course_id,
      bs.batch_subject_id,
      bs.batch_id,
      bs.subject_id,
      s.name AS subject_name,
      bs.sort_order
    FROM course_scoped_batches csb
    JOIN public.batch_subjects bs ON bs.batch_id = csb.batch_id
    JOIN public.subjects s ON s.subject_id = bs.subject_id
    WHERE bs.is_active = true
  ),
  -- Content counts and first available content per batch_subject
  content_aggregates AS (
    SELECT
      sbs.course_id,
      sbs.batch_subject_id,
      COALESCE(
        jsonb_object_agg(cnt.content_type, cnt.type_count) FILTER (WHERE cnt.content_type IS NOT NULL),
        '{}'::jsonb
      ) AS content_counts_by_type,
      (
        SELECT bsc_first.content_id
        FROM public.batch_subject_contents bsc_first
        JOIN public.content c_first ON c_first.content_id = bsc_first.content_id
        WHERE bsc_first.batch_subject_id = sbs.batch_subject_id
          AND c_first.status = 'approved'
        ORDER BY bsc_first.order_sequence ASC
        LIMIT 1
      ) AS first_available_content_id,
      SUM(cnt.type_count)::int AS total_content_count
    FROM scoped_batch_subjects sbs
    LEFT JOIN LATERAL (
      SELECT
        c.content_type::text AS content_type,
        COUNT(*)::int AS type_count
      FROM public.batch_subject_contents bsc
      JOIN public.content c ON c.content_id = bsc.content_id
      WHERE bsc.batch_subject_id = sbs.batch_subject_id
        AND c.status = 'approved'
      GROUP BY c.content_type
    ) cnt ON true
    GROUP BY sbs.course_id, sbs.batch_subject_id
  ),
  -- Mock tests per batch_subject
  mock_test_items AS (
    SELECT
      sbs.course_id,
      sbs.batch_subject_id,
      mt.test_id,
      mt.title,
      CASE
        WHEN COALESCE(bsmt.available_from, mt.available_from) IS NOT NULL
             AND COALESCE(bsmt.available_from, mt.available_from) > v_now THEN 'upcoming'
        WHEN COALESCE(bsmt.available_until, mt.available_until) IS NOT NULL
             AND COALESCE(bsmt.available_until, mt.available_until) < v_now THEN 'expired'
        ELSE 'available'
      END AS status,
      COALESCE(
        (SELECT COUNT(*)::int FROM public.mock_test_questions mtq WHERE mtq.test_id = mt.test_id),
        0
      ) AS question_count,
      bsmt.assigned_at
    FROM scoped_batch_subjects sbs
    JOIN public.batch_subject_mock_tests bsmt ON bsmt.batch_subject_id = sbs.batch_subject_id
    JOIN public.mock_tests mt ON mt.test_id = bsmt.test_id
    WHERE mt.status = 'published'
  ),
  mock_test_aggregates AS (
    SELECT
      sbs.course_id,
      sbs.batch_subject_id,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', mti.test_id,
            'title', mti.title,
            'status', mti.status,
            'questionCount', mti.question_count
          )
          ORDER BY mti.assigned_at ASC
        ) FILTER (WHERE mti.test_id IS NOT NULL),
        '[]'::jsonb
      ) AS mock_tests,
      (
        SELECT mti_avail.test_id
        FROM mock_test_items mti_avail
        WHERE mti_avail.course_id = sbs.course_id
          AND mti_avail.batch_subject_id = sbs.batch_subject_id
          AND mti_avail.status = 'available'
        ORDER BY mti_avail.assigned_at ASC
        LIMIT 1
      ) AS first_available_test_id,
      COUNT(mti.test_id)::int AS total_test_count
    FROM scoped_batch_subjects sbs
    LEFT JOIN mock_test_items mti
      ON mti.course_id = sbs.course_id AND mti.batch_subject_id = sbs.batch_subject_id
    GROUP BY sbs.course_id, sbs.batch_subject_id
  ),
  -- Assembled subject rows
  subject_rows AS (
    SELECT
      sbs.course_id,
      sbs.batch_subject_id,
      sbs.subject_id,
      sbs.subject_name,
      sbs.sort_order,
      COALESCE(ca.content_counts_by_type, '{}'::jsonb) AS content_counts_by_type,
      COALESCE(mta.mock_tests, '[]'::jsonb) AS mock_tests,
      ca.first_available_content_id,
      mta.first_available_test_id,
      COALESCE(ca.total_content_count, 0) AS total_content_count,
      COALESCE(mta.total_test_count, 0) AS total_test_count
    FROM scoped_batch_subjects sbs
    LEFT JOIN content_aggregates ca
      ON ca.course_id = sbs.course_id AND ca.batch_subject_id = sbs.batch_subject_id
    LEFT JOIN mock_test_aggregates mta
      ON mta.course_id = sbs.course_id AND mta.batch_subject_id = sbs.batch_subject_id
    -- Omit subjects with no content and no mock tests (matches getCourseContentSummary)
    WHERE COALESCE(ca.total_content_count, 0) > 0 OR COALESCE(mta.total_test_count, 0) > 0
  ),
  -- Group by course_id
  course_summaries AS (
    SELECT
      tc.c_id AS course_id,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'subjectId', sr.subject_id,
            'subjectName', sr.subject_name,
            'batchSubjectId', sr.batch_subject_id,
            'contentCountsByType', sr.content_counts_by_type,
            'mockTests', sr.mock_tests,
            'firstAvailableContentId', sr.first_available_content_id,
            'firstAvailableTestId', sr.first_available_test_id
          )
          ORDER BY sr.sort_order ASC, sr.subject_name ASC
        ) FILTER (WHERE sr.batch_subject_id IS NOT NULL),
        '[]'::jsonb
      ) AS summary_items
    FROM target_courses tc
    LEFT JOIN subject_rows sr ON sr.course_id = tc.c_id
    GROUP BY tc.c_id
  )
  SELECT COALESCE(
    jsonb_object_agg(cs.course_id::text, cs.summary_items),
    '{}'::jsonb
  )
  INTO v_result
  FROM course_summaries cs;

  RETURN v_result;
END;
$$;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.get_courses_content_summary(UUID[], UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_courses_content_summary(UUID[], UUID[]) TO anon;
GRANT EXECUTE ON FUNCTION public.get_courses_content_summary(UUID[], UUID[]) TO service_role;

COMMENT ON FUNCTION public.get_courses_content_summary(UUID[], UUID[]) IS
  'Batched course content summary RPC. Returns a JSON map of course_id -> CourseContentSummaryItem[] scoped strictly to the student active batch memberships.';
