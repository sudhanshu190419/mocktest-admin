-- 1. Add is_recurring column to timetable_slots
ALTER TABLE public.timetable_slots 
ADD COLUMN IF NOT EXISTS is_recurring boolean NOT NULL DEFAULT true;

-- 2. Create Cross-Midnight Timestamp Overlap Function
CREATE OR REPLACE FUNCTION public.check_timetable_interval_overlap(
    p_date date,
    p_start_1 time,
    p_end_1 time,
    p_start_2 time,
    p_end_2 time
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT (
        (p_date + p_start_1, 
         p_date + (CASE WHEN p_end_1 <= p_start_1 THEN interval '1 day' ELSE interval '0' END) + p_end_1)
        OVERLAPS
        (p_date + p_start_2, 
         p_date + (CASE WHEN p_end_2 <= p_start_2 THEN interval '1 day' ELSE interval '0' END) + p_end_2)
    );
$$;

-- 3. Create Unique Indexes (Safe after demo reset)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_date_slot 
ON public.timetable_slots (
    institute_id, batch_subject_id, valid_from, start_time, end_time
)
WHERE is_recurring = false AND status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_recurring_slot 
ON public.timetable_slots (
    institute_id, batch_subject_id, day_of_week, start_time, end_time, valid_from, valid_until
)
WHERE is_recurring = true AND status = 'active';

-- 4. Create reset_demo_timetable_data RPC (Defined in Section 2)
