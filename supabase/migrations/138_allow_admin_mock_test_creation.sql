-- ============================================================================
-- Migration: 138 - Allow Super Admin and Academic Admin Mock Test Creation
--
-- Description:
--   1. Adds `created_by` column to `public.mock_tests` referencing `profiles(profile_id)`.
--   2. Makes `public.mock_tests.teacher_id` nullable for admin-created mock tests.
--   3. Backfills `created_by` for all existing mock_tests rows from `teacher_details`.
--   4. Adds index on `created_by` for query performance.
--   5. Updates/preserves RLS policies:
--      - Teachers have full access to their own mock tests (teacher_id = get_my_teacher_id() OR created_by = auth.uid())
--      - Super Admin and Academic Admin have full access (is_super_admin() OR is_academic_admin())
--      - Finance Admin remains blocked from mock test creation and management
--      - Updates admin RLS policy on public.mock_test_questions to is_super_admin() OR is_academic_admin()
-- ============================================================================

-- 1. Add created_by column
alter table public.mock_tests
  add column if not exists created_by uuid null;

-- Add foreign key constraint if not exists
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'fk_mock_tests_created_by' and conrelid = 'public.mock_tests'::regclass
  ) then
    alter table public.mock_tests
      add constraint fk_mock_tests_created_by
      foreign key (created_by) references public.profiles (profile_id)
      on delete set null
      on update cascade;
  end if;
end $$;

-- 2. Make teacher_id nullable
alter table public.mock_tests
  alter column teacher_id drop not null;

-- 3. Backfill created_by for existing rows from teacher_details
update public.mock_tests mt
set created_by = td.profile_id
from public.teacher_details td
where mt.teacher_id = td.teacher_id
  and mt.created_by is null;

-- 4. Create index on created_by for efficient queries
create index if not exists idx_mock_tests_created_by
  on public.mock_tests (created_by);

-- 5. Column comments
comment on column public.mock_tests.teacher_id is
  'Optional authoring faculty/teacher in teacher_details. Nullable for admin-created mock tests.';

comment on column public.mock_tests.created_by is
  'Profile ID of the authenticated user (teacher or academic/super admin) who created this mock test.';

-- 6. Update Teacher & Admin RLS policies on public.mock_tests
drop policy if exists "Teachers have full access to their own mock_tests" on public.mock_tests;
create policy "Teachers have full access to their own mock_tests"
  on public.mock_tests
  for all
  to authenticated
  using (
    (teacher_id = public.get_my_teacher_id() or (created_by = auth.uid() and public.is_teacher()))
    and institute_id = public.get_my_institute_id()
    and public.is_teacher()
  )
  with check (
    (teacher_id = public.get_my_teacher_id() or (created_by = auth.uid() and public.is_teacher()))
    and institute_id = public.get_my_institute_id()
    and public.is_teacher()
  );

drop policy if exists "Admins have full access to mock_tests" on public.mock_tests;
create policy "Admins have full access to mock_tests"
  on public.mock_tests
  for all
  to authenticated
  using (
    (public.is_super_admin() or public.is_academic_admin())
    and institute_id = public.get_my_institute_id()
  )
  with check (
    (public.is_super_admin() or public.is_academic_admin())
    and institute_id = public.get_my_institute_id()
  );

comment on policy "Admins have full access to mock_tests" on public.mock_tests is
  'Full CRUD on mock tests for approved super/academic admins only within their institute. Finance admins cannot create or manage mock tests.';

-- 7. Update Admin RLS policy on public.mock_test_questions
drop policy if exists "Admins have full access to mock_test_questions" on public.mock_test_questions;
create policy "Admins have full access to mock_test_questions"
  on public.mock_test_questions
  for all
  to authenticated
  using (public.is_super_admin() or public.is_academic_admin())
  with check (public.is_super_admin() or public.is_academic_admin());

comment on policy "Admins have full access to mock_test_questions" on public.mock_test_questions is
  'Full CRUD on mock test questions for approved super/academic admins only. Finance admins cannot manage mock test questions.';
