-- ============================================================================
-- Migration: 039 — Course Mock Tests Assignment Table
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Creates the junction table that connects courses to mock tests, enabling
-- the Mock Test Assignment feature in the Course Management module.
--
-- This migration is fully backward-compatible. The existing batch_mock_tests
-- table is unchanged — both assignment models can coexist during transition.
--
-- Depends on:
--   Migration 032 — courses (course_id)
--   Domain 05    — mock_tests (test_id)
--   Domain 01    — institutes (institute_id), profiles (profile_id for assigned_by)
--   Existing functions: set_updated_at(), is_admin(), get_my_institute_id(),
--                       get_my_teacher_id()
--
-- Order:
--   1. Create course_mock_tests table
--   2. Create indexes
--   3. Enable RLS and create policies
--   4. Add comments
--
-- Reference: Architectural Investigation — Content Assignment & Access-Control Model
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — CREATE TABLE
-- ════════════════════════════════════════════════════════════════════════════
-- Junction table: M:M relationship between courses and mock tests.
--
-- Design decisions:
--   • Surrogate PK (id) for consistency with the mutable-assignment pattern
--     established by batch_mock_tests.assignment_id — allows future mutable
--     columns (e.g. available_from override) to be referenced by id.
--   • Unique constraint on (course_id, test_id) prevents duplicate assignments.
--   • institute_id is denormalized for RLS performance and multi-tenant
--     isolation, following the pattern established by all course junction
--     tables (course_teachers, course_batches, course_content).
--   • No updated_at column — this is initially an append-only junction.
--     The assigned_at timestamp captures when the relationship was created.
--     An updated_at column can be added in a future migration if mutable
--     assignment fields are introduced.
--   • No row-level overrides (available_from, available_until, attempt_limit)
--     are included. Those remain on the mock_tests table and batch_mock_tests
--     overrides. If course-level overrides are needed later, they can be added
--     as nullable columns without breaking existing data.

create table public.course_mock_tests (
  id              uuid            not null  default gen_random_uuid(),
  course_id       uuid            not null,
  test_id         uuid            not null,
  institute_id    uuid            not null,
  assigned_by     uuid            null      default null,
  assigned_at     timestamptz     not null  default now(),
  created_at      timestamptz     not null  default now(),

  -- Primary Key
  constraint pk_course_mock_tests primary key (id),

  -- Foreign Keys
  constraint fk_course_mock_tests_course
    foreign key (course_id) references public.courses (course_id)
    on delete restrict
    on update restrict,

  constraint fk_course_mock_tests_test
    foreign key (test_id) references public.mock_tests (test_id)
    on delete restrict
    on update restrict,

  constraint fk_course_mock_tests_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_course_mock_tests_assigned_by
    foreign key (assigned_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- Unique Constraints
  constraint uq_course_mock_tests_course_test unique (course_id, test_id)
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Indexes
-- ════════════════════════════════════════════════════════════════════════════
-- All indexes are created after the table exists.
-- No duplicate indexes on columns already covered by UNIQUE constraints.

-- Primary access pattern: "all mock tests assigned to course X"
-- Note: uq_course_mock_tests_course_test already provides a B-tree index on
-- (course_id, test_id), but we add a dedicated index on course_id alone for
-- queries that do not reference test_id (e.g. JOINs, count aggregations).
create index if not exists idx_course_mock_tests_course_id
  on public.course_mock_tests (course_id);

-- Reverse lookup: "which courses use test Y?"
create index if not exists idx_course_mock_tests_test_id
  on public.course_mock_tests (test_id);

-- Institute-wide mock test assignment listing for admin dashboards
create index if not exists idx_course_mock_tests_institute_id
  on public.course_mock_tests (institute_id);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Row Level Security
-- ════════════════════════════════════════════════════════════════════════════
-- RLS policies follow the same role-based pattern as the existing course
-- junction tables (course_teachers, course_batches, course_content).

-- 3a. Enable RLS
alter table public.course_mock_tests enable row level security;

-- 3b. Policies

-- Admins: full CRUD within their institute
-- Follows the same institute-scoped pattern as course_content and course_batches.
create policy "Admins have full access to course_mock_tests"
  on public.course_mock_tests
  for all
  to authenticated
  using (institute_id = public.get_my_institute_id() and public.is_admin())
  with check (institute_id = public.get_my_institute_id() and public.is_admin());

-- Teachers: read only — can see mock tests assigned to courses they teach
-- Teachers do not have INSERT/UPDATE/DELETE on this table. Assignment is an
-- admin responsibility. Read access follows the same course_teachers junction
-- pattern used by course_content and course_batches.
create policy "Teachers can read course_mock_tests for their courses"
  on public.course_mock_tests
  for select
  to authenticated
  using (exists (
    select 1 from public.course_teachers ct
    where ct.course_id = course_mock_tests.course_id
    and ct.teacher_id = public.get_my_teacher_id()
  ));

-- Students: NO direct access to this table.
-- Students will access mock tests through existing service-layer or RPC
-- logic that checks course_enrollments and joins through this table.
-- No student SELECT policy is created — RLS will block all student queries
-- against this table by default.

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Comments
-- ════════════════════════════════════════════════════════════════════════════

-- 4a. Table comments
comment on table public.course_mock_tests is
  'Junction table: M:M relationship between courses and mock tests. Each row '
  'represents a mock test assigned to a course. A course may have multiple '
  'mock tests; a mock test may belong to multiple courses. This table is the '
  'sole source of truth for course-to-mock-test relationships — the existing '
  'mock_tests table is not modified. Students access assigned mock tests '
  'through course enrollment, not directly through this table.' ;

-- 4b. Column comments
comment on column public.course_mock_tests.id is
  'Surrogate primary key. Generated via gen_random_uuid(). Referenced by '
  'future edit/remove operations.' ;

comment on column public.course_mock_tests.course_id is
  'FK to courses.course_id. The course receiving the mock test assignment. '
  'RESTRICT on delete — courses with active mock test assignments cannot '
  'be deleted.' ;

comment on column public.course_mock_tests.test_id is
  'FK to mock_tests.test_id. The mock test being assigned to the course. '
  'RESTRICT on delete — mock tests assigned to courses cannot be deleted '
  'until unassigned.' ;

comment on column public.course_mock_tests.institute_id is
  'Denormalized for RLS performance and multi-tenant isolation. Follows the '
  'same pattern as course_teachers, course_batches, and course_content.' ;

comment on column public.course_mock_tests.assigned_by is
  'FK to profiles.profile_id. The admin who created this assignment. '
  'SET NULL on profile soft-delete preserves the assignment record.' ;

comment on column public.course_mock_tests.assigned_at is
  'UTC timestamp when this assignment was created. Defaults to NOW(). '
  'Immutable after creation.' ;

comment on column public.course_mock_tests.created_at is
  'UTC timestamp of row creation. Immutable.' ;

-- 4c. Constraint comments
comment on constraint uq_course_mock_tests_course_test on public.course_mock_tests is
  'Prevents duplicate assignments — the same mock test cannot be assigned '
  'to the same course more than once. Unassign and re-assign operations '
  'should update the existing row rather than inserting a new one.' ;

comment on constraint fk_course_mock_tests_course on public.course_mock_tests is
  'Ensures referential integrity with the courses table. A course must exist '
  'before mock tests can be assigned to it.' ;

comment on constraint fk_course_mock_tests_test on public.course_mock_tests is
  'Ensures referential integrity with the mock_tests table. Only existing '
  'mock tests can be assigned to courses.' ;

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 039 Course Mock Tests Assignment Table
-- ════════════════════════════════════════════════════════════════════════════
