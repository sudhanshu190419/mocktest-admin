-- ============================================================================
-- Migration: 123 — Allow Super Admin and Academic Admin Question Creation & Auto-Publish
--
-- Description:
--   1. Drops old FK constraint `fk_questions_created_by` (which referenced `teacher_details.teacher_id`).
--   2. Backfills existing questions.created_by from teacher_details.teacher_id
--      to teacher_details.profile_id (profiles.profile_id).
--   3. Adds new FK constraint `fk_questions_created_by` referencing public.profiles (profile_id).
--   4. Updates Teacher RLS policies on questions and child tables (question_options,
--      question_explanations, question_images, question_option_images) to evaluate
--      against auth.uid() (profile_id) while preserving is_teacher() checks.
--   5. Preserves all existing check constraints (including ck_questions_approval_consistency).
-- ============================================================================

-- ── 1. Drop old Foreign Key Constraint on questions.created_by first ────────
alter table public.questions
  drop constraint if exists fk_questions_created_by;

-- ── 2. Backfill existing questions.created_by to profile_id ─────────────────
update public.questions q
set created_by = td.profile_id
from public.teacher_details td
where q.created_by = td.teacher_id;

-- ── 3. Add new Foreign Key Constraint referencing public.profiles ───────────
alter table public.questions
  add constraint fk_questions_created_by
  foreign key (created_by) references public.profiles (profile_id)
  on delete restrict
  on update cascade;

comment on constraint fk_questions_created_by on public.questions is
  'FK to profiles.profile_id of the creator (teacher or academic/super admin).';

-- ── 4. Update Teacher RLS on public.questions ───────────────────────────────
drop policy if exists "Teachers have full access to their own questions" on public.questions;
create policy "Teachers have full access to their own questions"
  on public.questions
  for all
  to authenticated
  using (
    created_by = auth.uid()
    and institute_id = public.get_my_institute_id()
    and public.is_teacher()
  )
  with check (
    created_by = auth.uid()
    and institute_id = public.get_my_institute_id()
    and public.is_teacher()
  );

-- ── 5. Update Teacher RLS on child tables ───────────────────────────────────

-- 5a. question_options
drop policy if exists "Teachers can manage options for their questions" on public.question_options;
create policy "Teachers can manage options for their questions"
  on public.question_options
  for all
  to authenticated
  using (exists (
    select 1 from public.questions q
    where q.question_id = question_options.question_id
      and q.created_by = auth.uid()
      and public.is_teacher()
  ))
  with check (exists (
    select 1 from public.questions q
    where q.question_id = question_options.question_id
      and q.created_by = auth.uid()
      and public.is_teacher()
  ));

-- 5b. question_explanations
drop policy if exists "Teachers can manage explanations for their questions" on public.question_explanations;
create policy "Teachers can manage explanations for their questions"
  on public.question_explanations
  for all
  to authenticated
  using (exists (
    select 1 from public.questions q
    where q.question_id = question_explanations.question_id
      and q.created_by = auth.uid()
      and public.is_teacher()
  ))
  with check (exists (
    select 1 from public.questions q
    where q.question_id = question_explanations.question_id
      and q.created_by = auth.uid()
      and public.is_teacher()
  ));

-- 5c. question_images
drop policy if exists "Teachers can manage images for their questions" on public.question_images;
create policy "Teachers can manage images for their questions"
  on public.question_images
  for all
  to authenticated
  using (exists (
    select 1 from public.questions q
    where q.question_id = question_images.question_id
      and q.created_by = auth.uid()
      and public.is_teacher()
  ))
  with check (exists (
    select 1 from public.questions q
    where q.question_id = question_images.question_id
      and q.created_by = auth.uid()
      and public.is_teacher()
  ));

-- 5d. question_option_images
drop policy if exists "Teachers can manage option images for their questions" on public.question_option_images;
create policy "Teachers can manage option images for their questions"
  on public.question_option_images
  for all
  to authenticated
  using (exists (
    select 1 from public.questions q
    join public.question_options qo on qo.question_id = q.question_id
    where qo.option_id = question_option_images.option_id
      and q.created_by = auth.uid()
      and public.is_teacher()
  ))
  with check (exists (
    select 1 from public.questions q
    join public.question_options qo on qo.question_id = q.question_id
    where qo.option_id = question_option_images.option_id
      and q.created_by = auth.uid()
      and public.is_teacher()
  ));
