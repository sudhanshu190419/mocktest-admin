-- ============================================================================
-- Migration: 181 — Fix Timetable Recurring Propagation & Bulk Import Plans
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Purpose:
--   1. Fix public.get_student_timetable_slots RPC to return is_recurring boolean.
--   2. Fix public.bulk_import_timetable RPC to:
--      - Correctly process date-specific slots (is_recurring = false) using
--        valid_from / valid_until from p_slots (and x.occurrence_date if passed).
--      - Consume p_plans and upsert lesson_plans linked to the exact generated
--        date-specific timetable_slot_id with institute_id.
--      - Preserve all conflict checks, advisory locks, substitution rules,
--        and live/completed class safety guards.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Update get_student_timetable_slots RPC
-- ════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_student_timetable_slots(uuid[]);

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
  status            text,
  is_recurring      boolean
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
    ts.status::text,
    ts.is_recurring::boolean
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
'Fetches timetable slots for the authenticated student scoped to their active batches with is_recurring and flattened metadata.';

REVOKE ALL ON FUNCTION public.get_student_timetable_slots(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_timetable_slots(uuid[]) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Update bulk_import_timetable RPC
-- ════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.bulk_import_timetable(uuid, jsonb);
DROP FUNCTION IF EXISTS public.bulk_import_timetable(uuid, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.bulk_import_timetable(uuid, jsonb, jsonb, uuid);

CREATE OR REPLACE FUNCTION public.bulk_import_timetable(
    p_institute_id uuid,
    p_slots jsonb,
    p_plans jsonb DEFAULT '[]'::jsonb,
    p_actor uuid DEFAULT null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor             uuid;
    v_bs_ids            uuid[];
    v_bs_id             uuid;
    v_lock_key          bigint;
    v_slot_id           uuid;
    v_recurring_slot_id uuid;
    r                   record;
    p                   record;
    v_lp_a              record;
    v_lp_b              record;
    v_target_slot_id    uuid;
    v_slots_created     integer := 0;
    v_plans_created     integer := 0;
BEGIN
    -- 1. Authorization Guard
    IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'Only administrators or service role can execute bulk timetable import.';
    END IF;

    IF auth.role() <> 'service_role' AND p_institute_id IS DISTINCT FROM public.get_my_institute_id() THEN
        RAISE EXCEPTION 'Bulk import can only be executed for your own institute.';
    END IF;

    v_actor := COALESCE(p_actor, auth.uid());

    -- 2. Server-side conflict detection: reject conflicting teachers for same slot in payload
    IF EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_slots) AS x(
            batch_subject_id uuid,
            valid_from date,
            occurrence_date date,
            start_time time,
            end_time time,
            teacher_id uuid,
            is_recurring boolean
        )
        WHERE (is_recurring = false OR is_recurring IS NULL)
        GROUP BY batch_subject_id, COALESCE(x.valid_from, x.occurrence_date), start_time, end_time
        HAVING count(DISTINCT teacher_id) > 1
    ) THEN
        RAISE EXCEPTION 'Payload conflict: multiple conflicting teachers assigned to the same date-specific class at the same date/time.';
    END IF;

    -- 3. Extract unique batch_subject_ids and sort deterministically (Deadlock-Free)
    SELECT ARRAY(
        SELECT DISTINCT (item->>'batch_subject_id')::uuid
        FROM jsonb_array_elements(p_slots) AS item
        ORDER BY 1
    ) INTO v_bs_ids;

    -- 4. Acquire 64-bit Advisory Locks in sorted order
    FOREACH v_bs_id IN ARRAY v_bs_ids LOOP
        v_lock_key := ('x' || substr(md5('timetable_slot_lock:' || p_institute_id::text || ':' || v_bs_id::text), 1, 16))::bit(64)::bigint;
        PERFORM pg_advisory_xact_lock(v_lock_key);
    END LOOP;

    -- 5. Temporary mapping table: key -> slot_id
    CREATE TEMP TABLE temp_slot_map (
        key text,
        slot_id uuid,
        occurrence_date date
    ) ON COMMIT DROP;

    -- 6. Process Date-Specific Slots (is_recurring = false)
    FOR r IN 
        WITH raw_date_rows AS (
            SELECT 
                x.key,
                x.batch_subject_id,
                x.teacher_id,
                x.day_of_week,
                x.start_time,
                x.end_time,
                COALESCE(x.valid_from, x.occurrence_date) as eff_date,
                x.topic_id,
                x.chapter_id,
                x.notes,
                ROW_NUMBER() OVER () as raw_idx
            FROM jsonb_to_recordset(p_slots) AS x(
                key text,
                batch_subject_id uuid,
                teacher_id uuid,
                day_of_week int,
                start_time time,
                end_time time,
                valid_from date,
                valid_until date,
                is_recurring boolean,
                occurrence_date date,
                topic_id uuid,
                chapter_id uuid,
                notes text
            )
            WHERE x.is_recurring = false OR x.is_recurring IS NULL
        )
        SELECT DISTINCT ON (batch_subject_id, eff_date, start_time, end_time) *
        FROM raw_date_rows
        WHERE eff_date IS NOT NULL
        ORDER BY batch_subject_id, eff_date, start_time, end_time, raw_idx DESC
    LOOP
        -- Exact recurring slot lookup for override/substitution
        SELECT timetable_slot_id INTO v_recurring_slot_id
        FROM public.timetable_slots
        WHERE institute_id = p_institute_id
          AND batch_subject_id = r.batch_subject_id
          AND day_of_week = r.day_of_week
          AND start_time = r.start_time
          AND end_time = r.end_time
          AND is_recurring = true
          AND status = 'active'
          AND r.eff_date BETWEEN valid_from AND valid_until;

        -- Live/Completed class guard
        IF EXISTS (
            SELECT 1 FROM public.live_classes
            WHERE (timetable_slot_id = v_recurring_slot_id)
              AND (scheduled_at AT TIME ZONE 'UTC')::date = r.eff_date
              AND status IN ('live', 'completed')
        ) THEN
            RAISE EXCEPTION 'Cannot substitute teacher on %: A class session is currently live or already completed.', r.eff_date;
        END IF;

        -- Upsert Date-Specific Slot (is_recurring = false, valid_from = eff_date, valid_until = eff_date)
        INSERT INTO public.timetable_slots (
            institute_id, batch_subject_id, teacher_id, day_of_week,
            start_time, end_time, valid_from, valid_until, is_recurring, status, created_by
        )
        VALUES (
            p_institute_id, r.batch_subject_id, r.teacher_id, r.day_of_week,
            r.start_time, r.end_time, r.eff_date, r.eff_date, false, 'active', v_actor
        )
        ON CONFLICT (institute_id, batch_subject_id, valid_from, start_time, end_time)
        WHERE is_recurring = false AND status = 'active'
        DO UPDATE SET teacher_id = EXCLUDED.teacher_id, updated_at = now()
        RETURNING timetable_slot_id INTO v_slot_id;

        v_slots_created := v_slots_created + 1;

        -- Record slot mapping for p_plans lookup
        IF r.key IS NOT NULL THEN
            INSERT INTO temp_slot_map (key, slot_id, occurrence_date)
            VALUES (r.key, v_slot_id, r.eff_date);
        END IF;

        -- Reassign scheduled live classes
        IF v_recurring_slot_id IS NOT NULL THEN
            UPDATE public.live_classes
            SET timetable_slot_id = v_slot_id,
                teacher_id = r.teacher_id,
                updated_at = now()
            WHERE timetable_slot_id = v_recurring_slot_id
              AND (scheduled_at AT TIME ZONE 'UTC')::date = r.eff_date
              AND status = 'scheduled';
        END IF;

        -- Merge lesson plans from recurring slot if existing
        SELECT * INTO v_lp_a FROM public.lesson_plans 
        WHERE timetable_slot_id = v_recurring_slot_id AND occurrence_date = r.eff_date;
        
        SELECT * INTO v_lp_b FROM public.lesson_plans 
        WHERE timetable_slot_id = v_slot_id AND occurrence_date = r.eff_date;

        IF v_lp_b.lesson_plan_id IS NOT NULL THEN
            UPDATE public.lesson_plans
            SET topic_id = COALESCE(r.topic_id, v_lp_b.topic_id, v_lp_a.topic_id),
                chapter_id = COALESCE(r.chapter_id, v_lp_b.chapter_id, v_lp_a.chapter_id),
                notes = COALESCE(r.notes, v_lp_b.notes, v_lp_a.notes),
                updated_at = now(),
                updated_by = v_actor
            WHERE lesson_plan_id = v_lp_b.lesson_plan_id;

            IF v_lp_a.lesson_plan_id IS NOT NULL THEN
                DELETE FROM public.lesson_plans WHERE lesson_plan_id = v_lp_a.lesson_plan_id;
            END IF;
        ELSIF v_lp_a.lesson_plan_id IS NOT NULL THEN
            UPDATE public.lesson_plans
            SET timetable_slot_id = v_slot_id,
                topic_id = COALESCE(r.topic_id, v_lp_a.topic_id),
                chapter_id = COALESCE(r.chapter_id, v_lp_a.chapter_id),
                notes = COALESCE(r.notes, v_lp_a.notes),
                updated_at = now(),
                updated_by = v_actor
            WHERE lesson_plan_id = v_lp_a.lesson_plan_id;
        ELSIF r.topic_id IS NOT NULL OR r.chapter_id IS NOT NULL OR r.notes IS NOT NULL THEN
            INSERT INTO public.lesson_plans (
                institute_id, timetable_slot_id, occurrence_date, topic_id, chapter_id, notes, created_by, updated_at
            )
            VALUES (
                p_institute_id, v_slot_id, r.eff_date, r.topic_id, r.chapter_id, r.notes, v_actor, now()
            )
            ON CONFLICT (timetable_slot_id, occurrence_date)
            DO UPDATE SET
                topic_id = EXCLUDED.topic_id,
                chapter_id = EXCLUDED.chapter_id,
                notes = EXCLUDED.notes,
                updated_at = now(),
                updated_by = v_actor;
            v_plans_created := v_plans_created + 1;
        END IF;
    END LOOP;

    -- 7. Process Explicit Recurring Slots (is_recurring = true)
    FOR r IN 
        WITH raw_rec_rows AS (
            SELECT *, ROW_NUMBER() OVER () as raw_idx
            FROM jsonb_to_recordset(p_slots) AS x(
                key text,
                batch_subject_id uuid,
                teacher_id uuid,
                day_of_week int,
                start_time time,
                end_time time,
                valid_from date,
                valid_until date,
                is_recurring boolean
            )
            WHERE x.is_recurring = true
        )
        SELECT DISTINCT ON (batch_subject_id, day_of_week, start_time, end_time, valid_from, valid_until) *
        FROM raw_rec_rows
        ORDER BY batch_subject_id, day_of_week, start_time, end_time, valid_from, valid_until, raw_idx DESC
    LOOP
        -- Check Overlaps (Including overnight and term overlaps)
        IF EXISTS (
            SELECT 1 FROM public.timetable_slots s
            WHERE s.institute_id = p_institute_id
              AND s.batch_subject_id = r.batch_subject_id
              AND s.day_of_week = r.day_of_week
              AND s.is_recurring = true
              AND s.status = 'active'
              AND (s.valid_from, s.valid_until) OVERLAPS (r.valid_from, r.valid_until)
              AND public.check_timetable_interval_overlap(CURRENT_DATE, s.start_time, s.end_time, r.start_time, r.end_time)
        ) THEN
            RAISE EXCEPTION 'Overlapping recurring schedule detected for batch_subject % on weekday %', r.batch_subject_id, r.day_of_week;
        END IF;

        -- Upsert Recurring Slot
        INSERT INTO public.timetable_slots (
            institute_id, batch_subject_id, teacher_id, day_of_week,
            start_time, end_time, valid_from, valid_until, is_recurring, status, created_by
        )
        VALUES (
            p_institute_id, r.batch_subject_id, r.teacher_id, r.day_of_week,
            r.start_time, r.end_time, r.valid_from, r.valid_until, true, 'active', v_actor
        )
        ON CONFLICT (institute_id, batch_subject_id, day_of_week, start_time, end_time, valid_from, valid_until)
        WHERE is_recurring = true AND status = 'active'
        DO UPDATE SET teacher_id = EXCLUDED.teacher_id, updated_at = now()
        RETURNING timetable_slot_id INTO v_slot_id;

        v_slots_created := v_slots_created + 1;

        IF r.key IS NOT NULL THEN
            INSERT INTO temp_slot_map (key, slot_id, occurrence_date)
            VALUES (r.key, v_slot_id, null);
        END IF;
    END LOOP;

    -- 8. Process Lesson Plans from p_plans payload
    IF p_plans IS NOT NULL AND jsonb_array_length(p_plans) > 0 THEN
        FOR p IN
            SELECT * FROM jsonb_to_recordset(p_plans) AS x(
                slot_key text,
                occurrence_date date,
                chapter_id uuid,
                topic_id uuid,
                notes text
            )
        LOOP
            SELECT slot_id INTO v_target_slot_id
            FROM temp_slot_map
            WHERE key = p.slot_key
            LIMIT 1;

            IF v_target_slot_id IS NOT NULL AND p.occurrence_date IS NOT NULL THEN
                IF p.chapter_id IS NOT NULL OR p.topic_id IS NOT NULL OR p.notes IS NOT NULL THEN
                    INSERT INTO public.lesson_plans (
                        institute_id, timetable_slot_id, occurrence_date, topic_id, chapter_id, notes, created_by, updated_at
                    )
                    VALUES (
                        p_institute_id, v_target_slot_id, p.occurrence_date, p.topic_id, p.chapter_id, p.notes, v_actor, now()
                    )
                    ON CONFLICT (timetable_slot_id, occurrence_date)
                    DO UPDATE SET
                        topic_id = EXCLUDED.topic_id,
                        chapter_id = EXCLUDED.chapter_id,
                        notes = EXCLUDED.notes,
                        updated_at = now(),
                        updated_by = v_actor;
                    v_plans_created := v_plans_created + 1;
                END IF;
            END IF;
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'slotsCreated', v_slots_created,
        'plansCreated', v_plans_created,
        'count', jsonb_array_length(p_slots)
    );
END;
$$;

COMMENT ON FUNCTION public.bulk_import_timetable(uuid, jsonb, jsonb, uuid) IS
'Atomic bulk timetable and lesson-plan importer supporting one-off and recurring schedules.';

REVOKE ALL ON FUNCTION public.bulk_import_timetable(uuid, jsonb, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_import_timetable(uuid, jsonb, jsonb, uuid) TO authenticated;
