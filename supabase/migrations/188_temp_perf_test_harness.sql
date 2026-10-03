-- ============================================================================
-- Migration: 093 — Temporary Performance Testing Harness for Recorded Classes
--
-- Target Environment: Staging / Testing Database ONLY
-- Idempotency: FULLY IDEMPOTENT (Safe to execute repeatedly)
-- Security: SECURITY DEFINER with empty search_path
--
-- Features:
--   1. public.seed_perf_test_recordings(p_target_count int, p_student_id uuid)
--      Generates isolated synthetic recording metadata (10k, 25k, 50k)
--      distributed proportionally across 8 synthetic subjects within a dedicated
--      test batch: 'PERF_TEST_Recorded Classes Performance Test'.
--      Enrolls student in this batch with status = 'active'.
--      ZERO R2 requests, ZERO video uploads.
--
--   2. public.cleanup_perf_test_recordings(p_confirm_delete boolean)
--      Safely reports or removes ONLY rows with 'PERF_TEST_' prefix.
--      Requires explicit p_confirm_delete = true.
--
--   3. public.explain_perf_test_level1(p_batch_id uuid)
--      Returns EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) for Level 1 RPC.
--
--   4. public.explain_perf_test_level2(p_batch_id uuid, p_subject_id uuid, p_page_size int)
--      Returns EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) for Level 2 query.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. SEED FUNCTION
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.seed_perf_test_recordings(
  p_target_count integer,
  p_student_id   uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_institute_id       uuid;
  v_stream_id          uuid;
  v_teacher_id         uuid;
  v_teacher_profile_id uuid;
  v_student_id         uuid;
  v_batch_id           uuid := 'a0000000-0000-0000-0000-000000000001'::uuid;
  v_current_count      integer := 0;
  v_needed             integer := 0;
  
  -- Subject UUIDs (Deterministic for clean isolation)
  v_subj_physics    uuid := 'b0000000-0000-0000-0000-000000000001'::uuid;
  v_subj_chem       uuid := 'b0000000-0000-0000-0000-000000000002'::uuid;
  v_subj_bio        uuid := 'b0000000-0000-0000-0000-000000000003'::uuid;
  v_subj_maths      uuid := 'b0000000-0000-0000-0000-000000000004'::uuid;
  v_subj_english    uuid := 'b0000000-0000-0000-0000-000000000005'::uuid;
  v_subj_cs         uuid := 'b0000000-0000-0000-0000-000000000006'::uuid;
  v_subj_history    uuid := 'b0000000-0000-0000-0000-000000000007'::uuid;
  v_subj_gs         uuid := 'b0000000-0000-0000-0000-000000000008'::uuid;

  -- Batch Subject UUIDs
  v_bs_physics    uuid := 'c0000000-0000-0000-0000-000000000001'::uuid;
  v_bs_chem       uuid := 'c0000000-0000-0000-0000-000000000002'::uuid;
  v_bs_bio        uuid := 'c0000000-0000-0000-0000-000000000003'::uuid;
  v_bs_maths      uuid := 'c0000000-0000-0000-0000-000000000004'::uuid;
  v_bs_english    uuid := 'c0000000-0000-0000-0000-000000000005'::uuid;
  v_bs_cs         uuid := 'c0000000-0000-0000-0000-000000000006'::uuid;
  v_bs_history    uuid := 'c0000000-0000-0000-0000-000000000007'::uuid;
  v_bs_gs         uuid := 'c0000000-0000-0000-0000-000000000008'::uuid;

  -- Live Class UUIDs
  v_lc_physics    uuid := 'd0000000-0000-0000-0000-000000000001'::uuid;
  v_lc_chem       uuid := 'd0000000-0000-0000-0000-000000000002'::uuid;
  v_lc_bio        uuid := 'd0000000-0000-0000-0000-000000000003'::uuid;
  v_lc_maths      uuid := 'd0000000-0000-0000-0000-000000000004'::uuid;
  v_lc_english    uuid := 'd0000000-0000-0000-0000-000000000005'::uuid;
  v_lc_cs         uuid := 'd0000000-0000-0000-0000-000000000006'::uuid;
  v_lc_history    uuid := 'd0000000-0000-0000-0000-000000000007'::uuid;
  v_lc_gs         uuid := 'd0000000-0000-0000-0000-000000000008'::uuid;
BEGIN
  -- 1. Resolve Institute
  SELECT institute_id INTO v_institute_id FROM public.institutes LIMIT 1;
  IF v_institute_id IS NULL THEN
    RAISE EXCEPTION 'No institute found in database';
  END IF;

  -- 2. Resolve Stream
  SELECT stream_id INTO v_stream_id FROM public.streams WHERE institute_id = v_institute_id LIMIT 1;
  IF v_stream_id IS NULL THEN
    SELECT stream_id INTO v_stream_id FROM public.streams LIMIT 1;
  END IF;

  -- 3. Resolve or Create Synthetic Teacher
  SELECT teacher_id INTO v_teacher_id FROM public.teacher_details LIMIT 1;
  IF v_teacher_id IS NULL THEN
    -- Create synthetic teacher profile
    v_teacher_profile_id := 'e0000000-0000-0000-0000-000000000001'::uuid;
    INSERT INTO public.profiles (profile_id, institute_id, name, email, role, is_active)
    VALUES (v_teacher_profile_id, v_institute_id, 'PERF_TEST_Dr. Verma', 'perf_test_teacher@staging.test', 'teacher', true)
    ON CONFLICT (profile_id) DO NOTHING;

    v_teacher_id := 'f0000000-0000-0000-0000-000000000001'::uuid;
    INSERT INTO public.teacher_details (teacher_id, profile_id)
    VALUES (v_teacher_id, v_teacher_profile_id)
    ON CONFLICT (teacher_id) DO NOTHING;
  END IF;

  -- 4. Resolve Student ID
  v_student_id := p_student_id;
  IF v_student_id IS NULL THEN
    SELECT student_id INTO v_student_id
    FROM public.student_details
    WHERE profile_id = auth.uid()
    LIMIT 1;
  END IF;
  IF v_student_id IS NULL THEN
    SELECT student_id INTO v_student_id FROM public.student_details LIMIT 1;
  END IF;

  -- 5. Create Dedicated Synthetic Performance Batch
  INSERT INTO public.batches (
    batch_id, institute_id, stream_id, name, batch_code,
    start_date, academic_year, status
  ) VALUES (
    v_batch_id, v_institute_id, v_stream_id,
    'PERF_TEST_Recorded Classes Performance Test', 'PERF_TEST_BATCH',
    CURRENT_DATE - INTERVAL '90 days', '2025-26', 'active'
  ) ON CONFLICT (batch_id) DO NOTHING;

  -- 6. Enroll Student in this Performance Batch
  IF v_student_id IS NOT NULL THEN
    INSERT INTO public.batch_students (batch_id, student_id, enrolled_on, status)
    VALUES (v_batch_id, v_student_id, CURRENT_DATE - INTERVAL '90 days', 'active')
    ON CONFLICT (batch_id, student_id) DO UPDATE SET status = 'active';
  END IF;

  -- 7. Create 8 Synthetic Subjects
  INSERT INTO public.subjects (subject_id, stream_id, name, code, display_order)
  VALUES
    (v_subj_physics, v_stream_id, 'PERF_TEST_Physics', 'PT_PHYS', 1),
    (v_subj_chem,    v_stream_id, 'PERF_TEST_Chemistry', 'PT_CHEM', 2),
    (v_subj_bio,     v_stream_id, 'PERF_TEST_Biology', 'PT_BIO', 3),
    (v_subj_maths,   v_stream_id, 'PERF_TEST_Mathematics', 'PT_MATH', 4),
    (v_subj_english, v_stream_id, 'PERF_TEST_English', 'PT_ENG', 5),
    (v_subj_cs,      v_stream_id, 'PERF_TEST_Computer Science', 'PT_CS', 6),
    (v_subj_history, v_stream_id, 'PERF_TEST_History', 'PT_HIST', 7),
    (v_subj_gs,      v_stream_id, 'PERF_TEST_General Studies', 'PT_GS', 8)
  ON CONFLICT (subject_id) DO NOTHING;

  -- 8. Create 8 Batch Subjects
  INSERT INTO public.batch_subjects (batch_subject_id, batch_id, subject_id, institute_id, name, is_active)
  VALUES
    (v_bs_physics, v_batch_id, v_subj_physics, v_institute_id, 'PERF_TEST_Physics', true),
    (v_bs_chem,    v_batch_id, v_subj_chem,    v_institute_id, 'PERF_TEST_Chemistry', true),
    (v_bs_bio,     v_batch_id, v_subj_bio,     v_institute_id, 'PERF_TEST_Biology', true),
    (v_bs_maths,   v_batch_id, v_subj_maths,   v_institute_id, 'PERF_TEST_Mathematics', true),
    (v_bs_english, v_batch_id, v_subj_english, v_institute_id, 'PERF_TEST_English', true),
    (v_bs_cs,      v_batch_id, v_subj_cs,      v_institute_id, 'PERF_TEST_Computer Science', true),
    (v_bs_history, v_batch_id, v_subj_history, v_institute_id, 'PERF_TEST_History', true),
    (v_bs_gs,      v_batch_id, v_subj_gs,      v_institute_id, 'PERF_TEST_General Studies', true)
  ON CONFLICT (batch_subject_id) DO NOTHING;

  -- 9. Create 8 Synthetic Live Classes
  INSERT INTO public.live_classes (
    class_id, institute_id, teacher_id, subject_id, title,
    scheduled_at, duration_min, status, is_recorded
  ) VALUES
    (v_lc_physics, v_institute_id, v_teacher_id, v_subj_physics, 'PERF_TEST_Live_Physics', now() - interval '90 days', 60, 'ended', true),
    (v_lc_chem,    v_institute_id, v_teacher_id, v_subj_chem,    'PERF_TEST_Live_Chemistry', now() - interval '90 days', 60, 'ended', true),
    (v_lc_bio,     v_institute_id, v_teacher_id, v_subj_bio,     'PERF_TEST_Live_Biology', now() - interval '90 days', 60, 'ended', true),
    (v_lc_maths,   v_institute_id, v_teacher_id, v_subj_maths,   'PERF_TEST_Live_Mathematics', now() - interval '90 days', 60, 'ended', true),
    (v_lc_english, v_institute_id, v_teacher_id, v_subj_english, 'PERF_TEST_Live_English', now() - interval '90 days', 60, 'ended', true),
    (v_lc_cs,      v_institute_id, v_teacher_id, v_subj_cs,      'PERF_TEST_Live_Computer Science', now() - interval '90 days', 60, 'ended', true),
    (v_lc_history, v_institute_id, v_teacher_id, v_subj_history, 'PERF_TEST_Live_History', now() - interval '90 days', 60, 'ended', true),
    (v_lc_gs,      v_institute_id, v_teacher_id, v_subj_gs,      'PERF_TEST_Live_General Studies', now() - interval '90 days', 60, 'ended', true)
  ON CONFLICT (class_id) DO NOTHING;

  -- 10. Check Current Count of PERF_TEST Recordings
  SELECT count(*) INTO v_current_count
  FROM public.recordings
  WHERE title LIKE 'PERF_TEST_%';

  v_needed := p_target_count - v_current_count;

  -- 11. Generate remaining recordings if needed
  IF v_needed > 0 THEN
    WITH series AS (
      SELECT
        s.i,
        -- Proportional modulo mapping:
        -- 0..21 (22%): Physics
        -- 22..39 (18%): Chemistry
        -- 40..55 (16%): Biology
        -- 56..70 (15%): Maths
        -- 71..80 (10%): English
        -- 81..88 (8%): CS
        -- 89..94 (6%): History
        -- 95..99 (5%): GS
        (s.i % 100) AS pct,
        gen_random_uuid() AS rec_id,
        now() - ((p_target_count - s.i) * interval '2 minutes') AS created_ts
      FROM generate_series(v_current_count + 1, p_target_count) AS s(i)
    ),
    categorized AS (
      SELECT
        rec_id,
        i,
        created_ts,
        CASE
          WHEN pct < 22 THEN v_bs_physics
          WHEN pct < 40 THEN v_bs_chem
          WHEN pct < 56 THEN v_bs_bio
          WHEN pct < 71 THEN v_bs_maths
          WHEN pct < 81 THEN v_bs_english
          WHEN pct < 89 THEN v_bs_cs
          WHEN pct < 95 THEN v_bs_history
          ELSE v_bs_gs
        END AS bs_id,
        CASE
          WHEN pct < 22 THEN v_lc_physics
          WHEN pct < 40 THEN v_lc_chem
          WHEN pct < 56 THEN v_lc_bio
          WHEN pct < 71 THEN v_lc_maths
          WHEN pct < 81 THEN v_lc_english
          WHEN pct < 89 THEN v_lc_cs
          WHEN pct < 95 THEN v_lc_history
          ELSE v_lc_gs
        END AS lc_id
      FROM series
    ),
    ins_recordings AS (
      INSERT INTO public.recordings (
        recording_id, class_id, institute_id, teacher_id,
        title, description, duration_seconds, status,
        is_deleted, created_at, updated_at
      )
      SELECT
        rec_id,
        lc_id,
        v_institute_id,
        v_teacher_id,
        'PERF_TEST_' || lpad(i::text, 6, '0'),
        'Synthetic performance test recording ' || i::text,
        1800 + ((i * 37) % 3600),
        'completed'::public.recording_status,
        false,
        created_ts,
        created_ts
      FROM categorized
    )
    INSERT INTO public.batch_subject_recordings (
      assignment_id, batch_subject_id, recording_id, institute_id, assigned_at
    )
    SELECT
      gen_random_uuid(),
      bs_id,
      rec_id,
      v_institute_id,
      created_ts
    FROM categorized;
  END IF;

  -- 12. Return Summary of State
  RETURN jsonb_build_object(
    'status', 'success',
    'target_count', p_target_count,
    'total_perf_recordings', (SELECT count(*) FROM public.recordings WHERE title LIKE 'PERF_TEST_%'),
    'batch_id', v_batch_id,
    'student_id', v_student_id,
    'subjects_distribution', (
      SELECT jsonb_object_agg(sub.name, count(r.recording_id))
      FROM public.batch_subject_recordings bsr
      JOIN public.batch_subjects bs ON bs.batch_subject_id = bsr.batch_subject_id
      JOIN public.subjects sub ON sub.subject_id = bs.subject_id
      JOIN public.recordings r ON r.recording_id = bsr.recording_id
      WHERE bs.batch_id = v_batch_id
      GROUP BY sub.name
    )
  );
END;
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- 2. SAFE CLEANUP FUNCTION
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cleanup_perf_test_recordings(
  p_confirm_delete boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_batch_id        uuid := 'a0000000-0000-0000-0000-000000000001'::uuid;
  v_bsr_count       integer;
  v_rec_count       integer;
  v_lc_count        integer;
  v_bs_count        integer;
  v_bst_count       integer;
  v_batch_count     integer;
  v_subj_count      integer;
BEGIN
  -- Count matching rows
  SELECT count(*) INTO v_bsr_count
  FROM public.batch_subject_recordings
  WHERE batch_subject_id IN (
    SELECT batch_subject_id FROM public.batch_subjects WHERE batch_id = v_batch_id
  );

  SELECT count(*) INTO v_rec_count
  FROM public.recordings
  WHERE title LIKE 'PERF_TEST_%';

  SELECT count(*) INTO v_lc_count
  FROM public.live_classes
  WHERE title LIKE 'PERF_TEST_%';

  SELECT count(*) INTO v_bs_count
  FROM public.batch_subjects
  WHERE batch_id = v_batch_id;

  SELECT count(*) INTO v_bst_count
  FROM public.batch_students
  WHERE batch_id = v_batch_id;

  SELECT count(*) INTO v_batch_count
  FROM public.batches
  WHERE batch_id = v_batch_id;

  SELECT count(*) INTO v_subj_count
  FROM public.subjects
  WHERE name LIKE 'PERF_TEST_%';

  IF p_confirm_delete THEN
    -- Delete in reverse FK dependency order
    DELETE FROM public.batch_subject_recordings
    WHERE batch_subject_id IN (
      SELECT batch_subject_id FROM public.batch_subjects WHERE batch_id = v_batch_id
    );

    DELETE FROM public.recordings
    WHERE title LIKE 'PERF_TEST_%';

    DELETE FROM public.live_classes
    WHERE title LIKE 'PERF_TEST_%';

    DELETE FROM public.batch_subjects
    WHERE batch_id = v_batch_id;

    DELETE FROM public.batch_students
    WHERE batch_id = v_batch_id;

    DELETE FROM public.batches
    WHERE batch_id = v_batch_id;

    DELETE FROM public.subjects
    WHERE name LIKE 'PERF_TEST_%';

    RETURN jsonb_build_object(
      'status', 'DELETED',
      'batch_subject_recordings_deleted', v_bsr_count,
      'recordings_deleted', v_rec_count,
      'live_classes_deleted', v_lc_count,
      'batch_subjects_deleted', v_bs_count,
      'batch_students_deleted', v_bst_count,
      'batches_deleted', v_batch_count,
      'subjects_deleted', v_subj_count
    );
  ELSE
    RETURN jsonb_build_object(
      'status', 'DRY_RUN (pass p_confirm_delete => true to execute)',
      'batch_subject_recordings_to_delete', v_bsr_count,
      'recordings_to_delete', v_rec_count,
      'live_classes_to_delete', v_lc_count,
      'batch_subjects_to_delete', v_bs_count,
      'batch_students_to_delete', v_bst_count,
      'batches_to_delete', v_batch_count,
      'subjects_to_delete', v_subj_count
    );
  END IF;
END;
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- 3. EXPLAIN LEVEL 1 QUERY
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.explain_perf_test_level1(
  p_batch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_plan jsonb;
BEGIN
  -- Execute EXPLAIN ANALYZE on Level 1 RPC logic
  EXECUTE '
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT
      bs.subject_id,
      COALESCE(s.name, bs.name, ''General Subject'')::text AS subject_name,
      COUNT(DISTINCT r.recording_id)::integer AS recording_count,
      MAX(r.created_at) AS latest_recording_at
    FROM public.batch_subjects bs
    JOIN public.subjects s ON s.subject_id = bs.subject_id AND s.deleted_at IS NULL
    JOIN public.batch_subject_recordings bsr ON bsr.batch_subject_id = bs.batch_subject_id
    JOIN public.recordings r ON r.recording_id = bsr.recording_id
    WHERE bs.batch_id = ' || quote_literal(p_batch_id::text) || '::uuid
      AND bs.is_active = true
      AND r.status = ''completed''
      AND r.is_deleted = false
    GROUP BY bs.subject_id, COALESCE(s.name, bs.name, ''General Subject'')
    HAVING COUNT(DISTINCT r.recording_id) > 0
    ORDER BY subject_name ASC
  ' INTO v_plan;

  RETURN v_plan;
END;
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- 4. EXPLAIN LEVEL 2 QUERY
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.explain_perf_test_level2(
  p_batch_id   uuid,
  p_subject_id uuid,
  p_limit      integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_plan jsonb;
BEGIN
  EXECUTE '
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT
      bsr.recording_id,
      bsr.batch_subject_id,
      r.title,
      r.duration_seconds,
      r.created_at
    FROM public.batch_subject_recordings bsr
    JOIN public.batch_subjects bs ON bs.batch_subject_id = bsr.batch_subject_id
    JOIN public.recordings r ON r.recording_id = bsr.recording_id
    WHERE bs.batch_id = ' || quote_literal(p_batch_id::text) || '::uuid
      AND bs.subject_id = ' || quote_literal(p_subject_id::text) || '::uuid
      AND bs.is_active = true
      AND r.status = ''completed''
      AND r.is_deleted = false
    ORDER BY r.created_at DESC, r.recording_id DESC
    LIMIT ' || p_limit || '
  ' INTO v_plan;

  RETURN v_plan;
END;
$$;

-- Permissions
GRANT EXECUTE ON FUNCTION public.seed_perf_test_recordings(integer, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_perf_test_recordings(boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.explain_perf_test_level1(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.explain_perf_test_level2(uuid, uuid, integer) TO authenticated, service_role;
