-- ============================================================================
-- Migration: 069 — Domain 17 Batch Subject Mock Tests
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Tables: batch_subject_mock_tests
--
-- Depends on: Domain 01 (institutes, profiles)
--             Domain 02 (batches)
--             Domain 05 (mock_tests)
--             Migration 031 (batch_mock_tests — for data migration)
--             Migration 066 (batch_subjects)
--             Migration 068 (batch_subject_contents — for pattern reference)
--             Existing functions (set_updated_at, get_my_institute_id, is_admin,
--               is_teacher, is_student, get_my_teacher_id, get_my_student_id,
--               get_student_batch_ids, get_teacher_batch_ids)
--
-- ## Purpose
--
-- Move mock test assignment from batch-level to batch_subject-level.
--
-- The old `batch_mock_tests` table (migration 031) assigned mock tests to an
-- entire batch. The new `batch_subject_mock_tests` table assigns mock tests
-- to a specific batch_subject (a subject within a batch).
--
-- This enables:
--   1. Students see mock tests filtered by subject within a batch
--   2. Teachers manage mock tests for specific subjects they teach
--   3. Subject-level mock test analytics and progress tracking
--   4. Correct data model matching the "Batch → Subjects" architecture
--   5. Full Syllabus tests are distinguished by subjects.code = 'FULL_SYLL'
--      (a real subject in the subjects table, not a NULL sentinel)
--
-- ## Full Syllabus Tests
--
-- Tests that cover a full syllabus (multi-subject) have a `subject_id`
-- pointing to the "Full Syllabus" subject (code: FULL_SYLL) rather than
-- being NULL. These tests are assigned to the batch_subject for that batch
-- that references the FULL_SYLL subject. This eliminates all NULL-sentinel
-- logic from the schema.
--
-- ## Backfill Strategy
--
-- Existing `batch_mock_tests` records are migrated by matching the test's
-- subject_id + batch_id to a batch_subject. For each (batch_id, test_id):
--   1. Get the test's subject_id from mock_tests
--   2. Find the batch_subject for that batch with the matching subject_id
--   3. Create a batch_subject_mock_tests row with all assignment metadata
--   4. If no matching batch_subject exists, skip (edge case)
--
-- Full-syllabus tests naturally match the "Full Syllabus" batch_subject
-- because mock_tests.subject_id = (FULL_SYLL subject_id) and a batch_subject
-- exists for that subject in every batch.
--
-- ## Relationship to batch_mock_tests
--
-- The old `batch_mock_tests` table is NOT dropped. It remains as a read-only
-- archive. The new `batch_subject_mock_tests` table becomes the primary
-- mechanism for mock test assignment. Applications should read from
-- batch_subject_mock_tests and only reference batch_mock_tests for historical
-- migration audit purposes.
--
-- ## New Enum Types
--
-- None. No new enums are required for this table.
--
-- ## Order
--
--   1. Create batch_subject_mock_tests table
--   2. Create indexes
--   3. Enable RLS and create policies
--   4. Create updated_at trigger
--   5. Backfill data from batch_mock_tests (idempotent)
--   6. Add comments
--
-- Reference: MIGRATION_CHECKLIST.md (Section A4)
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — CREATE TABLE: batch_subject_mock_tests
-- ════════════════════════════════════════════════════════════════════════════
--
-- Assigns mock tests to specific batch_subjects (subject within a batch).
-- Replaces the old batch_mock_tests table with a subject-scoped model.
--
-- Column design mirrors batch_mock_tests (available_from, available_until,
-- attempt_limit) for feature parity and straightforward migration.
--
-- A surrogate PK (assignment_id) follows the same pattern as batch_mock_tests
-- because this table supports mutable assignment-level overrides that are
-- referenced by assignment_id in edit/remove operations.
--
-- The unique constraint on (batch_subject_id, test_id) prevents a mock test
-- from being assigned to the same subject twice within a batch.
--
-- institute_id is denormalized for RLS performance, following the same
-- pattern as all Domain 17 tables.

create table public.batch_subject_mock_tests (
  -- Primary Key (surrogate UUID — same pattern as batch_mock_tests)
  assignment_id         uuid            not null  default gen_random_uuid(),

  -- References the batch_subject (subject within a batch)
  batch_subject_id      uuid            not null,

  -- References the mock test
  test_id               uuid            not null,

  -- Denormalized for RLS performance and multi-tenant isolation
  institute_id          uuid            not null,

  -- UTC timestamp when this assignment was created. Immutable.
  assigned_at           timestamptz     not null  default now(),

  -- Optional override: earliest datetime students can attempt this test.
  -- Takes precedence over mock_tests.available_from when non-null.
  available_from        timestamptz     null      default null,

  -- Optional override: latest datetime students can attempt this test.
  -- Takes precedence over mock_tests.available_until when non-null.
  -- Must be strictly after available_from when both are set.
  available_until       timestamptz     null      default null,

  -- Optional override: maximum attempts per student.
  -- Takes precedence over mock_tests.attempt_limit when non-null.
  -- Must be positive.
  attempt_limit         smallint        null      default null,

  -- Admin who created this assignment. SET NULL on profile soft-delete.
  assigned_by           uuid            null      default null,

  -- Audit fields
  created_at            timestamptz     not null  default now(),
  updated_at            timestamptz     not null  default now(),

  -- ── Primary Key ───────────────────────────────────────────────────────
  constraint pk_batch_subject_mock_tests primary key (assignment_id),

  -- ── Foreign Keys ──────────────────────────────────────────────────────
  -- FK to batch_subjects: the subject-within-batch this test is assigned to
  -- CASCADE on delete — removing a batch_subject removes its test assignments
  constraint fk_bsmt_batch_subject
    foreign key (batch_subject_id) references public.batch_subjects (batch_subject_id)
    on delete cascade
    on update restrict,

  -- FK to mock_tests: the mock test being assigned
  -- RESTRICT on delete — prevents orphaned assignments
  constraint fk_bsmt_test
    foreign key (test_id) references public.mock_tests (test_id)
    on delete restrict
    on update restrict,

  -- FK to institutes: denormalized for RLS performance and multi-tenant isolation
  -- RESTRICT on delete — prevents cascade deletion of institute data
  constraint fk_bsmt_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  -- FK to profiles: admin who created this assignment
  -- SET NULL on profile soft-delete preserves the assignment record
  constraint fk_bsmt_assigned_by
    foreign key (assigned_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- ── Unique Constraints ────────────────────────────────────────────────
  -- Enforces: a mock test can be assigned to a batch_subject at most once.
  -- The unique constraint also creates a backing B-tree index for fast
  -- lookups by (batch_subject_id, test_id).
  constraint uq_bsmt_batch_subject_test unique (batch_subject_id, test_id),

  -- ── CHECK Constraints ────────────────────────────────────────────────
  -- availability_until must be strictly after available_from when both set
  constraint ck_bsmt_availability check (
    available_until is null
    or available_from is null
    or available_until > available_from
  ),

  -- attempt_limit must be positive when set
  constraint ck_bsmt_attempt_limit check (
    attempt_limit is null or attempt_limit > 0
  )
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Indexes
-- ════════════════════════════════════════════════════════════════════════════
-- All indexes are created after the table exists.
-- No duplicate indexes on columns already covered by UNIQUE constraints.

-- Batch-subject-scoped queries: "Which mock tests are assigned to Physics in
-- NEET 2026 Morning Batch?" Primary student/teacher dashboard query.
create index if not exists idx_bsmt_batch_subject_id
  on public.batch_subject_mock_tests (batch_subject_id);

-- Reverse lookup: "Which batch_subjects include this mock test?"
create index if not exists idx_bsmt_test_id
  on public.batch_subject_mock_tests (test_id);

-- Institute-scoped queries: admin dashboard, test reporting
create index if not exists idx_bsmt_institute_id
  on public.batch_subject_mock_tests (institute_id);

-- Batch-subject + assigned_at sorting for chronological display
create index if not exists idx_bsmt_batch_subject_assigned
  on public.batch_subject_mock_tests (batch_subject_id, assigned_at desc);

-- Assigned_by lookups for admin audit
create index if not exists idx_bsmt_assigned_by
  on public.batch_subject_mock_tests (assigned_by);

-- Composite index for batch-subject-scoped queries with availability filtering.
-- Supports WHERE batch_subject_id = ? AND (available_until IS NULL OR
-- available_until > ?) efficiently via an index seek on batch_subject_id.
-- Unlike the original design, this avoids NOW() in a partial index predicate
-- (volatile functions are not allowed in partial index WHERE clauses).
-- The full index on all rows is still very effective because the planner can
-- seek to the matching batch_subject_id range with minimal overhead.
create index if not exists idx_bsmt_batch_subject_availability
  on public.batch_subject_mock_tests (batch_subject_id, available_until);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Row Level Security
-- ════════════════════════════════════════════════════════════════════════════

-- 3a. Enable RLS
alter table public.batch_subject_mock_tests enable row level security;

-- 3b. Admin: full CRUD within their institute
--      Admins can manage all test assignments in their institute.
create policy "Admins have full access to batch_subject_mock_tests"
  on public.batch_subject_mock_tests
  for all
  to authenticated
  using (institute_id = public.get_my_institute_id() and public.is_admin())
  with check (institute_id = public.get_my_institute_id() and public.is_admin());

-- 3c. Teacher: read test assignments for batch_subjects they are assigned to
--      Teachers can see tests for subjects they teach.
--      Uses batch_subject_teachers (migration 067) to scope to their subjects.
create policy "Teachers can read batch_subject_mock_tests for their subjects"
  on public.batch_subject_mock_tests
  for select
  to authenticated
  using (
    institute_id = public.get_my_institute_id()
    and public.is_teacher()
    and exists (
      select 1 from public.batch_subject_teachers bst
      where bst.batch_subject_id = batch_subject_mock_tests.batch_subject_id
      and bst.teacher_id = public.get_my_teacher_id()
    )
  );

-- 3d. Student: read test assignments for batch_subjects in batches they are
--      enrolled in. Students can see tests for all subjects in their batches.
--      Uses get_student_batch_ids() (from migration 066) to resolve batch
--      membership, then checks the batch_subject belongs to one of those batches.
create policy "Students can read batch_subject_mock_tests for their batches"
  on public.batch_subject_mock_tests
  for select
  to authenticated
  using (
    institute_id = public.get_my_institute_id()
    and public.is_student()
    and exists (
      select 1 from public.batch_subjects bs
      where bs.batch_subject_id = batch_subject_mock_tests.batch_subject_id
      and bs.batch_id = any (public.get_student_batch_ids())
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Trigger
-- ════════════════════════════════════════════════════════════════════════════
-- Maintains updated_at for mutable assignment fields (available_from,
-- available_until, attempt_limit).

create trigger trg_batch_subject_mock_tests_set_updated_at
  before update on public.batch_subject_mock_tests
  for each row
  execute function public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — Backfill: Migrate Existing Test Assignments
-- ════════════════════════════════════════════════════════════════════════════
--
-- Strategy: PRECISE MATCH — use mock_tests.subject_id to find the correct
-- batch_subject.
--
-- For every existing row in batch_mock_tests:
--   1. Find the mock test's subject_id
--   2. Find the batch_subject for the same batch with the matching subject_id
--   3. Create a batch_subject_mock_tests row with the same assignment metadata
--   4. Skip if no matching batch_subject exists (edge case)
--
-- Full-syllabus tests (where subject_id = FULL_SYLL subject) will naturally
-- match the "Full Syllabus" batch_subject in that batch, because the FULL_SYLL
-- subject was seeded in migration 066 and batch_subjects were created for it.
--
-- Edge cases handled:
--   - Test with subject_id not in batch's subjects: skipped (rare — occurs
--     if a subject was removed from the batch after test creation). Admin
--     must manually assign.
--   - Duplicate batch_mock_tests rows: skipped via ON CONFLICT DO NOTHING
--
-- The backfill uses ON CONFLICT DO NOTHING for full idempotency.

do $$
declare
  v_batch_test record;
  v_matching_batch_subject_id uuid;
  v_total integer := 0;
  v_skipped integer := 0;
begin
  -- Iterate over every existing batch_mock_tests row
  for v_batch_test in
    select
      bmt.batch_id,
      bmt.test_id,
      bmt.assigned_at,
      bmt.available_from,
      bmt.available_until,
      bmt.attempt_limit,
      bmt.assigned_by,
      bmt.created_at,
      bmt.updated_at,
      mt.subject_id
    from public.batch_mock_tests bmt
    join public.mock_tests mt on mt.test_id = bmt.test_id
  loop
    -- Find the batch_subject for this batch with the matching subject_id
    select bs.batch_subject_id into v_matching_batch_subject_id
    from public.batch_subjects bs
    where bs.batch_id = v_batch_test.batch_id
      and bs.subject_id = v_batch_test.subject_id;

    -- Skip if no matching batch_subject exists (edge case)
    if v_matching_batch_subject_id is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Get the institute_id from the batch_subject
    -- (denormalized for RLS performance, so we join to get it)
    declare
      v_institute_id uuid;
    begin
      select institute_id into v_institute_id
      from public.batch_subjects
      where batch_subject_id = v_matching_batch_subject_id;

      -- Insert batch_subject_mock_tests row — idempotent via ON CONFLICT
      insert into public.batch_subject_mock_tests (
        batch_subject_id,
        test_id,
        institute_id,
        assigned_at,
        available_from,
        available_until,
        attempt_limit,
        assigned_by,
        created_at,
        updated_at
      ) values (
        v_matching_batch_subject_id,
        v_batch_test.test_id,
        v_institute_id,
        v_batch_test.assigned_at,
        v_batch_test.available_from,
        v_batch_test.available_until,
        v_batch_test.attempt_limit,
        v_batch_test.assigned_by,
        v_batch_test.created_at,
        v_batch_test.updated_at
      )
      on conflict (batch_subject_id, test_id) do nothing;

      v_total := v_total + 1;
    end;
  end loop;

  raise notice 'batch_subject_mock_tests backfill complete: % assigned, % skipped (no matching batch_subject)', v_total, v_skipped;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — COMMENT Statements
-- ════════════════════════════════════════════════════════════════════════════

-- 6a. Table comments
comment on table public.batch_subject_mock_tests is
  'Subject-scoped mock test assignment. Links mock tests to batch_subjects '
  '(a subject within a batch). Replaces the old batch_mock_tests pattern of '
  'batch-level assignment. A mock test assigned to "Physics in NEET 2026 '
  'Morning Batch" is only visible to that specific batch_subject. Full-syllabus '
  'tests (covering multiple subjects) are assigned to the "Full Syllabus" '
  'batch_subject (subjects.code = FULL_SYLL). The unique constraint on '
  '(batch_subject_id, test_id) prevents duplicate assignments.' ;

-- 6b. Column comments
comment on column public.batch_subject_mock_tests.assignment_id is
  'Surrogate primary key for mutable assignment record. Referenced by '
  'edit/remove operations. Generated via gen_random_uuid().' ;

comment on column public.batch_subject_mock_tests.batch_subject_id is
  'FK to batch_subjects.batch_subject_id. The subject-within-batch this '
  'mock test is assigned to. CASCADE on delete — removing a batch_subject '
  'removes all its test assignments.' ;

comment on column public.batch_subject_mock_tests.test_id is
  'FK to mock_tests.test_id. The mock test being assigned. RESTRICT on '
  'delete — prevents orphaned assignments.' ;

comment on column public.batch_subject_mock_tests.institute_id is
  'Denormalized for RLS performance and multi-tenant isolation. Populated '
  'from the batch_subject institute_id at creation time.' ;

comment on column public.batch_subject_mock_tests.assigned_at is
  'UTC timestamp when this assignment was created. Defaults to NOW(). '
  'Immutable after creation.' ;

comment on column public.batch_subject_mock_tests.available_from is
  'Optional override: earliest datetime students can attempt this test. '
  'Takes precedence over mock_tests.available_from when non-null.' ;

comment on column public.batch_subject_mock_tests.available_until is
  'Optional override: latest datetime students can attempt this test. '
  'Takes precedence over mock_tests.available_until when non-null. '
  'Must be strictly after available_from when both are set.' ;

comment on column public.batch_subject_mock_tests.attempt_limit is
  'Optional override: maximum attempts per student. Takes precedence over '
  'mock_tests.attempt_limit when non-null. Must be positive.' ;

comment on column public.batch_subject_mock_tests.assigned_by is
  'FK to profiles.profile_id. The admin who created this assignment. '
  'SET NULL on profile soft-delete preserves the assignment record.' ;

comment on column public.batch_subject_mock_tests.created_at is
  'UTC timestamp of row creation. Immutable.' ;

comment on column public.batch_subject_mock_tests.updated_at is
  'UTC timestamp of last update. Maintained by set_updated_at trigger.' ;

-- 6c. Constraint comments
comment on constraint uq_bsmt_batch_subject_test on public.batch_subject_mock_tests is
  'Enforces the business rule: a mock test can be assigned to a batch_subject '
  'at most once. Prevents duplicate test assignments to the same subject.' ;

comment on constraint ck_bsmt_availability on public.batch_subject_mock_tests is
  'available_until must be strictly after available_from when both are set. '
  'Prevents impossible availability windows.' ;

comment on constraint ck_bsmt_attempt_limit on public.batch_subject_mock_tests is
  'attempt_limit must be positive when set. Zero or negative limits are '
  'meaningless in the domain.' ;

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 069 Domain 17 Batch Subject Mock Tests
-- ════════════════════════════════════════════════════════════════════════════
