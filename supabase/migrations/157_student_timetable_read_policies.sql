-- ============================================================================
-- Migration: 157 — Student Timetable Read Policies (Phase 2 Cross-Platform)
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- ════════════════════════════════════════════════════════════════════════════
-- PURPOSE
-- ════════════════════════════════════════════════════════════════════════════
-- Grants authenticated students read-only SELECT access to recurring
-- timetable_slots and lesson_plans strictly scoped to the student's active
-- batch memberships (batch_students.status = 'active').
--
-- Admin/Teacher write and management policies remain 100% untouched.
-- All writes to timetable_slots continue to be enforced through SECURITY DEFINER
-- RPCs (create_timetable_slot, update_timetable_slot, set_timetable_slot_status).
--
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. timetable_slots Student Read Policy ───────────────────────────────────

drop policy if exists "Students can read timetable slots for their active batches"
  on public.timetable_slots;

create policy "Students can read timetable slots for their active batches"
  on public.timetable_slots
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.batch_subjects bs
      join public.batch_students bst on bst.batch_id = bs.batch_id
      where bs.batch_subject_id = timetable_slots.batch_subject_id
        and bst.student_id = public.get_my_student_id()
        and bst.status = 'active'
    )
  );

comment on policy "Students can read timetable slots for their active batches"
  on public.timetable_slots is
  'Students may read recurring timetable slots belonging to batch subjects of batches where the student has an active batch_students membership.';

-- ── 2. lesson_plans Student Read Policy ──────────────────────────────────────

drop policy if exists "Students can read lesson plans for their active batches"
  on public.lesson_plans;

create policy "Students can read lesson plans for their active batches"
  on public.lesson_plans
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.timetable_slots ts
      join public.batch_subjects bs on bs.batch_subject_id = ts.batch_subject_id
      join public.batch_students bst on bst.batch_id = bs.batch_id
      where ts.timetable_slot_id = lesson_plans.timetable_slot_id
        and bst.student_id = public.get_my_student_id()
        and bst.status = 'active'
    )
  );

comment on policy "Students can read lesson plans for their active batches"
  on public.lesson_plans is
  'Students may read lesson plans linked to timetable slots belonging to batch subjects of batches where the student has an active batch_students membership.';
