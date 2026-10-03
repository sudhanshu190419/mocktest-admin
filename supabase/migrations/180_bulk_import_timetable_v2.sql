CREATE OR REPLACE FUNCTION public.bulk_import_timetable(
    p_institute_id uuid,
    p_slots jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_bs_ids uuid[];
    v_bs_id uuid;
    v_lock_key bigint;
    v_slot_id uuid;
    v_recurring_slot_id uuid;
    r record;
    v_lp_a record;
    v_lp_b record;
BEGIN
    -- 1. Authorization Guard
    IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'Only administrators or service role can execute bulk timetable import.';
    END IF;

    IF auth.role() <> 'service_role' AND p_institute_id IS DISTINCT FROM public.get_my_institute_id() THEN
        RAISE EXCEPTION 'Bulk import can only be executed for your own institute.';
    END IF;

    -- 2. Server-side conflict detection: reject conflicting teachers for same slot in payload
    IF EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_slots) AS x(
            batch_subject_id uuid,
            occurrence_date date,
            start_time time,
            end_time time,
            teacher_id uuid,
            is_recurring boolean
        )
        WHERE is_recurring = false AND occurrence_date IS NOT NULL
        GROUP BY batch_subject_id, occurrence_date, start_time, end_time
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

    -- 5. Process Date-Specific Slots
    FOR r IN 
        WITH raw_date_rows AS (
            SELECT *, ROW_NUMBER() OVER () as raw_idx
            FROM jsonb_to_recordset(p_slots) AS x(
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
            WHERE is_recurring = false
        )
        SELECT DISTINCT ON (batch_subject_id, occurrence_date, start_time, end_time) *
        FROM raw_date_rows
        ORDER BY batch_subject_id, occurrence_date, start_time, end_time, raw_idx DESC
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
          AND r.occurrence_date BETWEEN valid_from AND valid_until;

        -- Live/Completed class guard
        IF EXISTS (
            SELECT 1 FROM public.live_classes
            WHERE (timetable_slot_id = v_recurring_slot_id)
              AND (scheduled_at AT TIME ZONE 'UTC')::date = r.occurrence_date
              AND status IN ('live', 'completed')
        ) THEN
            RAISE EXCEPTION 'Cannot substitute teacher on %: A class session is currently live or already completed.', r.occurrence_date;
        END IF;

        -- Upsert Date-Specific Slot (is_recurring = false)
        INSERT INTO public.timetable_slots (
            institute_id, batch_subject_id, teacher_id, day_of_week,
            start_time, end_time, valid_from, valid_until, is_recurring, status, created_by
        )
        VALUES (
            p_institute_id, r.batch_subject_id, r.teacher_id, r.day_of_week,
            r.start_time, r.end_time, r.occurrence_date, r.occurrence_date, false, 'active', auth.uid()
        )
        ON CONFLICT (institute_id, batch_subject_id, valid_from, start_time, end_time)
        WHERE is_recurring = false AND status = 'active'
        DO UPDATE SET teacher_id = EXCLUDED.teacher_id, updated_at = now()
        RETURNING timetable_slot_id INTO v_slot_id;

        -- Reassign scheduled live classes
        IF v_recurring_slot_id IS NOT NULL THEN
            UPDATE public.live_classes
            SET timetable_slot_id = v_slot_id,
                teacher_id = r.teacher_id,
                updated_at = now()
            WHERE timetable_slot_id = v_recurring_slot_id
              AND (scheduled_at AT TIME ZONE 'UTC')::date = r.occurrence_date
              AND status = 'scheduled';
        END IF;

        -- Merge lesson plans onto date-specific slot
        SELECT * INTO v_lp_a FROM public.lesson_plans 
        WHERE timetable_slot_id = v_recurring_slot_id AND occurrence_date = r.occurrence_date;
        
        SELECT * INTO v_lp_b FROM public.lesson_plans 
        WHERE timetable_slot_id = v_slot_id AND occurrence_date = r.occurrence_date;

        IF v_lp_b.lesson_plan_id IS NOT NULL THEN
            UPDATE public.lesson_plans
            SET topic_id = COALESCE(r.topic_id, v_lp_b.topic_id, v_lp_a.topic_id),
                chapter_id = COALESCE(r.chapter_id, v_lp_b.chapter_id, v_lp_a.chapter_id),
                notes = COALESCE(r.notes, v_lp_b.notes, v_lp_a.notes),
                updated_at = now()
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
                updated_at = now()
            WHERE lesson_plan_id = v_lp_a.lesson_plan_id;
        ELSIF r.topic_id IS NOT NULL OR r.notes IS NOT NULL THEN
            INSERT INTO public.lesson_plans (
                timetable_slot_id, occurrence_date, topic_id, chapter_id, notes, created_by, updated_at
            )
            VALUES (
                v_slot_id, r.occurrence_date, r.topic_id, r.chapter_id, r.notes, auth.uid(), now()
            );
        END IF;
    END LOOP;

    -- 6. Process Explicit Recurring Slots
    FOR r IN 
        WITH raw_rec_rows AS (
            SELECT *, ROW_NUMBER() OVER () as raw_idx
            FROM jsonb_to_recordset(p_slots) AS x(
                batch_subject_id uuid,
                teacher_id uuid,
                day_of_week int,
                start_time time,
                end_time time,
                valid_from date,
                valid_until date,
                is_recurring boolean
            )
            WHERE is_recurring = true
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
            r.start_time, r.end_time, r.valid_from, r.valid_until, true, 'active', auth.uid()
        )
        ON CONFLICT (institute_id, batch_subject_id, day_of_week, start_time, end_time, valid_from, valid_until)
        WHERE is_recurring = true AND status = 'active'
        DO UPDATE SET teacher_id = EXCLUDED.teacher_id, updated_at = now();
    END LOOP;

    RETURN jsonb_build_object('success', true, 'count', jsonb_array_length(p_slots));
END;
$$;
