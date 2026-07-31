-- ============================================================================
-- Migration: 071 — Add Teacher INSERT/DELETE Policies on batch_subject_live_classes
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Problem
-- -------
-- Migration 070 created the `batch_subject_live_classes` table but only added
-- `FOR SELECT` policies for teachers. Two critical flows require INSERT:
--
--   1. `scheduleLiveClass()`  → INSERT assignment rows for each selected
--      batch subject when creating a new scheduled live class
--   2. `updateScheduledClass()` → DELETE old assignments, INSERT new ones
--
-- Without these policies, teachers see this error:
--   "new row violates row-level security policy for table
--    'batch_subject_live_classes'"
--
-- The existing "Admins have full access" policy already covers admins.
--
-- Security
-- --------
-- Each policy uses a correlated subquery that verifies:
--   a) The teacher owns the related live_classes row (class ownership)
--   b) For INSERT: the teacher is also assigned to the batch_subject being
--      linked (via batch_subject_teachers)
--
-- This ensures:
--   - Teachers can only link batch subjects to classes they own
--   - Teachers can only link batch subjects they are actually assigned to teach
--   - Teachers can only remove batch subject links from classes they own
--   - Students have no INSERT/DELETE access (no policies for student role)
--   - Admins continue to have unrestricted access via the existing FOR ALL policy
--
-- Depends on:
--   Migration 070 (batch_subject_live_classes table)
--   Helper functions: public.get_my_teacher_id(), public.is_teacher()
--
-- Order:
--   1. INSERT policy for teachers
--   2. DELETE policy for teachers
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. INSERT — Teachers can assign batch subjects to their own live classes
-- ════════════════════════════════════════════════════════════════════════════
--
-- Allows teachers to create batch subject assignments but ONLY if:
--   a) They own the live class (teacher_id matches get_my_teacher_id())
--   b) They are assigned to the batch_subject (via batch_subject_teachers)
--
-- The WITH CHECK clause validates every row being inserted. It uses two
-- correlated subqueries — one for class ownership and one for subject
-- assignment — to ensure both conditions are met.
--
-- This is more restrictive than the old live_class_batch INSERT policy
-- (migration 050) because it also verifies batch_subject_teachers membership.
-- This extra check prevents a teacher from assigning a class to a subject
-- they don't teach.

create policy "Teachers can insert into batch_subject_live_classes"
  on public.batch_subject_live_classes
  for insert
  to authenticated
  with check (
    public.is_teacher()
    and exists (
      -- Verify the teacher owns the live class
      select 1
      from public.live_classes lc
      where lc.class_id = batch_subject_live_classes.class_id
        and lc.teacher_id = public.get_my_teacher_id()
    )
    and exists (
      -- Verify the teacher is assigned to this batch_subject
      select 1
      from public.batch_subject_teachers bst
      where bst.batch_subject_id = batch_subject_live_classes.batch_subject_id
        and bst.teacher_id = public.get_my_teacher_id()
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 2. DELETE — Teachers can remove batch subject links from their own classes
-- ════════════════════════════════════════════════════════════════════════════
--
-- Allows teachers to remove existing batch subject assignments (e.g., when
-- updating which subjects a scheduled class targets), but ONLY if they own
-- the class.
--
-- The USING clause filters which rows are eligible for deletion. It verifies
-- ownership via a subquery against live_classes.
--
-- Unlike the INSERT policy, this does NOT verify batch_subject_teachers
-- membership. This is intentional: a teacher who was removed from a batch
-- subject should still be able to clean up their old assignments. The class
-- ownership check is sufficient security.
--
-- Note: The FK on batch_subject_live_classes.class_id → live_classes.class_id
-- is ON DELETE RESTRICT, so deleting the assignment row here does not affect
-- the live_classes row itself.

create policy "Teachers can delete from batch_subject_live_classes"
  on public.batch_subject_live_classes
  for delete
  to authenticated
  using (
    public.is_teacher()
    and exists (
      select 1
      from public.live_classes lc
      where lc.class_id = batch_subject_live_classes.class_id
        and lc.teacher_id = public.get_my_teacher_id()
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 071
-- ════════════════════════════════════════════════════════════════════════════
