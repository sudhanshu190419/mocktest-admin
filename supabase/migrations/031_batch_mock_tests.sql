-- ============================================================================
-- Migration: 031 — Batch Mock Tests Assignment Table
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Creates the junction table that connects batches to mock tests, enabling
-- the Mock Test Assignment feature in the Admin Batch Management module.
--
-- Depends on:
--   Domain 02 — batches (batch_id)
--   Domain 05 — mock_tests (test_id)
--   Domain 01 — profiles (profile_id for assigned_by)
--   Existing functions: set_updated_at(), is_admin(), get_my_teacher_id(),
--                       get_my_student_id()
--
-- Order:
--   1. Create batch_mock_tests table
--   2. Create indexes
--   3. Enable RLS and create policies
--   4. Create updated_at trigger
--   5. Add comments
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — CREATE TABLE
-- ════════════════════════════════════════════════════════════════════════════
-- Junction table: M:M relationship between batches and mock tests.
--
-- Design decisions:
--   • Surrogate PK (assignment_id) instead of composite PK because this table
--     supports mutable fields (available_from, available_until, attempt_limit)
--     that are updated by reference to assignment_id.
--   • Unique constraint on (batch_id, test_id) prevents duplicate assignments.
--   • assigned_by tracks the admin who performed the assignment.
--   • Row-level overrides (available_from, available_until, attempt_limit)
--     take precedence over the mock_test's own defaults when non-null.
--   • updated_at is trigger-maintained (set_updated_at).

create table public.batch_mock_tests (
  assignment_id    uuid            not null  default gen_random_uuid(),
  batch_id         uuid            not null,
  test_id          uuid            not null,
  assigned_at      timestamptz     not null  default now(),
  available_from   timestamptz     null      default null,
  available_until  timestamptz     null      default null,
  attempt_limit    smallint        null      default null,
  assigned_by      uuid            null      default null,
  created_at       timestamptz     not null  default now(),
  updated_at       timestamptz     not null  default now(),

  -- Primary Key
  constraint pk_batch_mock_tests primary key (assignment_id),

  -- Foreign Keys
  constraint fk_batch_mock_tests_batch
    foreign key (batch_id) references public.batches (batch_id)
    on delete restrict
    on update restrict,

  constraint fk_batch_mock_tests_test
    foreign key (test_id) references public.mock_tests (test_id)
    on delete restrict
    on update restrict,

  constraint fk_batch_mock_tests_assigned_by
    foreign key (assigned_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- Unique Constraints
  constraint uq_batch_mock_tests_batch_test unique (batch_id, test_id),

  -- CHECK Constraints
  constraint ck_batch_mock_tests_availability check (
    available_until is null
    or available_from is null
    or available_until > available_from
  ),
  constraint ck_batch_mock_tests_attempt_limit check (
    attempt_limit is null or attempt_limit > 0
  )
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Indexes
-- ════════════════════════════════════════════════════════════════════════════

-- Index on batch_id for "all tests assigned to batch X" queries
create index if not exists idx_batch_mock_tests_batch_id
  on public.batch_mock_tests (batch_id);

-- Index on test_id for reverse lookup (which batches use test Y)
create index if not exists idx_batch_mock_tests_test_id
  on public.batch_mock_tests (test_id);

-- Composite index covering the unique constraint for fast duplicate checks
-- Note: uq_batch_mock_tests_batch_test already provides this, but we add an
-- explicit index for queries that filter by batch_id and order by assigned_at.
create index if not exists idx_batch_mock_tests_batch_assigned
  on public.batch_mock_tests (batch_id, assigned_at desc);

-- Index for assigned_by lookups
create index if not exists idx_batch_mock_tests_assigned_by
  on public.batch_mock_tests (assigned_by);

-- Partial index for active assignments (where available_until is in the future
-- or null). Useful for student-facing "upcoming/active mock tests" queries.


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Row Level Security
-- ════════════════════════════════════════════════════════════════════════════

-- 3a. Enable RLS
alter table public.batch_mock_tests enable row level security;

-- 3b. Policies

-- Admins: full CRUD access
create policy "Admins have full access to batch_mock_tests"
  on public.batch_mock_tests
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Teachers: read assignments for batches they are assigned to
create policy "Teachers can read batch_mock_tests for their batches"
  on public.batch_mock_tests
  for select
  to authenticated
  using (exists (
    select 1 from public.batch_teachers bt
    where bt.batch_id = batch_mock_tests.batch_id
    and bt.teacher_id = public.get_my_teacher_id()
  ));

-- Students: read assignments for batches they are enrolled in
create policy "Students can read batch_mock_tests for their batches"
  on public.batch_mock_tests
  for select
  to authenticated
  using (exists (
    select 1 from public.batch_students bs
    where bs.batch_id = batch_mock_tests.batch_id
    and bs.student_id = public.get_my_student_id()
  ));

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Trigger
-- ════════════════════════════════════════════════════════════════════════════

create trigger trg_batch_mock_tests_set_updated_at
  before update on public.batch_mock_tests
  for each row
  execute function public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — Comments
-- ════════════════════════════════════════════════════════════════════════════

comment on table public.batch_mock_tests is
  'Junction table: M:M relationship between batches and mock tests. Each row '
  'represents a mock test assigned to a batch. Row-level overrides (available_from, '
  'available_until, attempt_limit) take precedence over the mock_test defaults.';

comment on column public.batch_mock_tests.assignment_id is
  'Surrogate PK for mutable assignment record. Referenced by edit/remove operations.';

comment on column public.batch_mock_tests.batch_id is
  'FK → batches.batch_id. The batch receiving the mock test assignment.';

comment on column public.batch_mock_tests.test_id is
  'FK → mock_tests.test_id. The mock test being assigned.';

comment on column public.batch_mock_tests.assigned_at is
  'UTC timestamp when this assignment was created. Defaults to NOW(). Immutable.';

comment on column public.batch_mock_tests.available_from is
  'Optional override: earliest datetime students can attempt this test. '
  'Takes precedence over mock_tests.available_from when non-null.';

comment on column public.batch_mock_tests.available_until is
  'Optional override: latest datetime students can attempt this test. '
  'Takes precedence over mock_tests.available_until when non-null. '
  'Must be strictly after available_from when both are set.';

comment on column public.batch_mock_tests.attempt_limit is
  'Optional override: maximum attempts per student. Takes precedence over '
  'mock_tests.attempt_limit when non-null. Must be positive.';

comment on column public.batch_mock_tests.assigned_by is
  'Admin who created this assignment. FK → profiles.profile_id. '
  'SET NULL on profile soft-delete preserves the assignment record.';

comment on column public.batch_mock_tests.created_at is
  'UTC timestamp of row creation. Immutable.';

comment on column public.batch_mock_tests.updated_at is
  'UTC timestamp of last update. Maintained by set_updated_at trigger.';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 031 Batch Mock Tests Assignment Table
-- ════════════════════════════════════════════════════════════════════════════
