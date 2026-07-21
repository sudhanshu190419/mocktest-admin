-- ============================================================================
-- Migration: 050 — Add Teacher INSERT/DELETE Policies on live_class_batch
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Problem
-- -------
-- The existing RLS policies on `live_class_batch` only allow teachers to
-- SELECT rows. Two critical flows require INSERT and DELETE:
--
--   1. `scheduleLiveClass()`  → INSERT batch links for the new class
--   2. `updateScheduledClass()` → DELETE old links, INSERT new ones
--
-- Without these policies, both operations fail with an RLS policy violation.
-- The existing "Admins have full access" policy already covers admins.
--
-- Security
-- --------
-- Each policy uses a correlated subquery that verifies the teacher owns the
-- related live_classes row via `public.get_my_teacher_id()`. This ensures:
--   - Teachers can only link batches to classes they own
--   - Teachers can only remove batch links from classes they own
--   - No teacher can modify another teacher's classes
--   - Students have no INSERT/DELETE access (no policies for student role)
--   - Admins continue to have unrestricted access via the existing FOR ALL policy
--
-- Depends on:
--   Migration 021 (RLS policies — contains helper functions and existing policies)
--   Helper function: public.get_my_teacher_id() (defined in migration 021)
--
-- Order:
--   1. INSERT policy for teachers
--   2. DELETE policy for teachers
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. INSERT — Teachers can link batches to their own live classes
-- ════════════════════════════════════════════════════════════════════════════
--
-- Allows teachers to create batch assignments (link a batch to a live class)
-- but ONLY if they own the class being linked.
--
-- The WITH CHECK clause validates the row being inserted. It uses the
-- same ownership pattern as the existing SELECT policy: an EXISTS subquery
-- against live_classes filtered by the current teacher's ID.
--
-- This also ensures teachers cannot assign the same batch twice (the
-- composite PK (class_id, batch_id) enforces uniqueness).

create policy "Teachers can insert into live_class_batch for their classes"
  on public.live_class_batch
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.live_classes lc
      where lc.class_id = live_class_batch.class_id
        and lc.teacher_id = public.get_my_teacher_id()
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 2. DELETE — Teachers can remove batch links from their own live classes
-- ════════════════════════════════════════════════════════════════════════════
--
-- Allows teachers to remove existing batch assignments (e.g., when updating
-- which batches a scheduled class targets), but ONLY if they own the class.
--
-- The USING clause filters which rows are eligible for deletion. It verifies
-- ownership via the same subquery pattern as above.
--
-- Note: The FK on live_class_batch.class_id → live_classes.class_id is
-- ON DELETE CASCADE, so deleting the batch link row here is safe and does
-- not affect the live_classes row itself.

create policy "Teachers can delete from live_class_batch for their classes"
  on public.live_class_batch
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.live_classes lc
      where lc.class_id = live_class_batch.class_id
        and lc.teacher_id = public.get_my_teacher_id()
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 050
-- ════════════════════════════════════════════════════════════════════════════
