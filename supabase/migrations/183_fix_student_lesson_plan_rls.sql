-- ============================================================================
-- Migration: 183 — Fix Student Lesson Plan RLS Policy via Security Definer Helper
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Purpose:
--   1. Create a SECURITY DEFINER helper function public.student_can_access_lesson_plan_slot
--      to evaluate student batch access to timetable slot lesson plans without
--      being broken by nested table-level RLS policies on joined tables.
--   2. Recreate the SELECT policy on public.lesson_plans using this helper.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Helper Function: student_can_access_lesson_plan_slot
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.student_can_access_lesson_plan_slot(
  p_timetable_slot_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.timetable_slots ts
    JOIN public.batch_subjects bs
      ON bs.batch_subject_id = ts.batch_subject_id
    JOIN public.batch_students bst
      ON bst.batch_id = bs.batch_id
    WHERE ts.timetable_slot_id = p_timetable_slot_id
      AND bst.student_id = public.get_my_student_id()
      AND bst.status = 'active'
  );
$$;

COMMENT ON FUNCTION public.student_can_access_lesson_plan_slot(uuid) IS
'Returns true if the authenticated student is actively enrolled in the batch subject corresponding to the timetable slot. Executes as SECURITY DEFINER to avoid recursive RLS evaluation failure.';

REVOKE ALL ON FUNCTION public.student_can_access_lesson_plan_slot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_can_access_lesson_plan_slot(uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Recreate Student Read Policy on public.lesson_plans
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Students can read lesson plans for their active batches"
  ON public.lesson_plans;

CREATE POLICY "Students can read lesson plans for their active batches"
  ON public.lesson_plans
  FOR SELECT
  TO authenticated
  USING (
    public.student_can_access_lesson_plan_slot(
      lesson_plans.timetable_slot_id
    )
  );

COMMENT ON POLICY "Students can read lesson plans for their active batches"
  ON public.lesson_plans IS
  'Students may read lesson plans linked to timetable slots for batches where they have an active batch_students membership, evaluated via security definer helper.';
