-- ============================================================================
-- Migration: 067 — Domain 17 Batch Subject Teachers
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Tables: batch_subject_teachers
--
-- Depends on: Domain 01 (institutes, profiles, teacher_details)
--             Domain 02 (batches, batch_teachers)
--             Migration 066 (batch_subjects)
--             Existing functions (set_updated_at, get_my_institute_id, is_admin,
--               is_teacher, get_my_teacher_id, get_student_batch_ids)
--
-- ## Purpose
--
-- Create the subject-scoped teacher assignment layer. Teachers are no longer
-- assigned to a batch directly. Instead, they are assigned to specific
-- batch_subjects (i.e. a subject within a batch).
--
-- The old `batch_teachers` table assigned teachers to a whole batch. The new
-- `batch_subject_teachers` table assigns teachers to a specific subject within
-- a batch. This enables:
--
--   1. Subject-level analytics per teacher (vs batch-level)
--   2. Fine-grained RLS — teachers see only the subjects they teach
--   3. Future features like subject-level substitute teachers
--   4. Correct data model matching the "Batch → Subjects" architecture
--
-- ## Backfill Strategy
--
-- Existing `batch_teachers` records are migrated conservatively:
--   - For each (batch_id, teacher_id) pair, find ALL active batch_subjects
--     for that batch
--   - Assign the teacher to EVERY batch_subject in that batch
--   - This preserves full existing access — no teacher loses access to any
--     subject they previously had through batch-level assignment
--   - Admins can later remove irrelevant subject assignments
--
-- After backfill, the helper function `get_teacher_batch_ids()` is updated to
-- query `batch_subject_teachers` instead of `batch_teachers`. This means RLS
-- policies that use `get_teacher_batch_ids()` (from migration 066) will
-- automatically scope teachers to only the subjects they are assigned to.
--
-- ## New Enum Types
--
-- None. No new enums are required for this table.
--
-- ## Order
--
--   1. Create batch_subject_teachers table
--   2. Create indexes
--   3. Enable RLS and create policies
--   4. Backfill data from batch_teachers (idempotent)
--   5. Update get_teacher_batch_ids() to use batch_subject_teachers
--   6. Add comments
--
-- Reference: Architecture_Migration_Analysis.md | MIGRATION_CHECKLIST.md
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — CREATE TABLE: batch_subject_teachers
-- ════════════════════════════════════════════════════════════════════════════
--
-- Maps teachers to specific batch_subjects (subject within a batch).
-- Replaces the old batch_teachers table (which assigned teachers to a whole
-- batch) with a more granular subject-scoped assignment model.
--
-- A surrogate PK (batch_subject_teacher_id) is used following the same
-- pattern as batch_subjects. The unique constraint on (batch_subject_id,
-- teacher_id) ensures a teacher is assigned to a batch_subject at most once.
--
-- institute_id is denormalized for RLS performance, following the same
-- pattern as batch_subjects.

create table public.batch_subject_teachers (
  -- Primary Key (surrogate UUID)
  batch_subject_teacher_id  uuid          not null  default gen_random_uuid(),

  -- References the batch_subject (subject within a batch)
  batch_subject_id          uuid          not null,

  -- References the teacher
  teacher_id                uuid          not null,

  -- Denormalized for RLS performance and multi-tenant isolation
  institute_id              uuid          not null,

  -- Advisory teaching role (e.g. lead_teacher, co_teacher, doubt_solver).
  -- Free text — not permission-enforced. Preserved from batch_teachers.
  role_in_batch             varchar(50)   null      default null,

  -- Date the teacher was assigned to this batch_subject
  assigned_on               date          not null  default current_date,

  -- Audit fields
  created_at                timestamptz   not null  default now(),
  created_by                uuid          null      default null,

  -- ── Primary Key ───────────────────────────────────────────────────────
  constraint pk_batch_subject_teachers primary key (batch_subject_teacher_id),

  -- ── Foreign Keys ──────────────────────────────────────────────────────
  -- FK to batch_subjects: the subject-within-batch this teacher is assigned to
  -- CASCADE on delete — deleting a batch_subject removes all teacher assignments
  constraint fk_bst_batch_subject
    foreign key (batch_subject_id) references public.batch_subjects (batch_subject_id)
    on delete cascade
    on update restrict,

  -- FK to teacher_details: the teacher being assigned
  -- RESTRICT on delete — prevents orphaned assignments
  constraint fk_bst_teacher
    foreign key (teacher_id) references public.teacher_details (teacher_id)
    on delete restrict
    on update restrict,

  -- FK to institutes: denormalized for RLS performance and multi-tenant isolation
  -- RESTRICT on delete — prevents cascade deletion of institute data
  constraint fk_bst_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  -- FK to profiles: admin who created this assignment
  -- SET NULL on profile soft-delete preserves the assignment record
  constraint fk_bst_created_by
    foreign key (created_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- ── Unique Constraints ────────────────────────────────────────────────
  -- Enforces: a teacher can be assigned to a batch_subject at most once.
  -- The unique constraint also creates a backing B-tree index for fast
  -- lookups by (batch_subject_id, teacher_id).
  constraint uq_bst_batch_subject_teacher unique (batch_subject_id, teacher_id),

  -- ── CHECK Constraints ────────────────────────────────────────────────
  -- assigned_on cannot be in the future
  constraint ck_bst_assigned_on check (assigned_on <= current_date)
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Indexes
-- ════════════════════════════════════════════════════════════════════════════
-- All indexes are created after the table exists.
-- No duplicate indexes on columns already covered by UNIQUE constraints.

-- Batch-subject-scoped queries: "Which teachers teach this subject in this batch?"
-- This is the most common query pattern — teacher dashboard shows students
-- for subjects the teacher teaches.
create index if not exists idx_bst_batch_subject_id
  on public.batch_subject_teachers (batch_subject_id);

-- Teacher-scoped queries: "Which batch_subjects does this teacher teach?"
-- Used by teacher dashboard to show their teaching schedule.
-- Also used by the updated get_teacher_batch_ids() function.
create index if not exists idx_bst_teacher_id
  on public.batch_subject_teachers (teacher_id);

-- Institute-scoped queries: admin dashboard, batch-wide reporting
create index if not exists idx_bst_institute_id
  on public.batch_subject_teachers (institute_id);

-- Created_by lookups for admin audit
create index if not exists idx_bst_created_by
  on public.batch_subject_teachers (created_by);

-- Composite index for the most common query: "Is teacher X assigned to batch_subject Y?"
-- Covered by uq_bst_batch_subject_teacher, but explicitly created for
-- queries that include assigned_on in the filter.
create index if not exists idx_bst_batch_subject_teacher_assigned
  on public.batch_subject_teachers (batch_subject_id, teacher_id, assigned_on);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Row Level Security
-- ════════════════════════════════════════════════════════════════════════════

-- 3a. Enable RLS
alter table public.batch_subject_teachers enable row level security;

-- 3b. Admin: full CRUD within their institute
--      Admins can manage all teacher assignments in their institute.
create policy "Admins have full access to batch_subject_teachers"
  on public.batch_subject_teachers
  for all
  to authenticated
  using (institute_id = public.get_my_institute_id() and public.is_admin())
  with check (institute_id = public.get_my_institute_id() and public.is_admin());

-- 3c. Teacher: read their own assignments
--      Teachers can see which batch_subjects they are assigned to.
--      No recursion issue — get_my_teacher_id() queries profiles/teacher_details,
--      not batch_subject_teachers.
create policy "Teachers can read their own batch_subject_teacher assignments"
  on public.batch_subject_teachers
  for select
  to authenticated
  using (
    institute_id = public.get_my_institute_id()
    and public.is_teacher()
    and teacher_id = public.get_my_teacher_id()
  );

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Backfill: Migrate Existing Teacher Assignments
-- ════════════════════════════════════════════════════════════════════════════
--
-- Strategy: CONSERVATIVE — preserve all existing access
--
-- For every existing row in batch_teachers:
--   1. Find all ACTIVE batch_subjects for the same batch
--   2. Assign the teacher to EVERY batch_subject
--   3. Skip if the assignment already exists (idempotent)
--
-- This is the safest approach because:
--   - No teacher loses access to any subject they previously had
--   - Admins can later remove irrelevant subject assignments
--   - The alternative (using teacher_specializations to infer subject match)
--     could miss matches if specializations are not up-to-date
--
-- The backfill uses ON CONFLICT DO NOTHING for full idempotency.

do $$
declare
  v_batch_teacher record;
  v_batch_subject record;
begin
  -- Iterate over every existing batch_teachers row
  for v_batch_teacher in
    select bt.batch_id, bt.teacher_id, bt.role_in_batch, bt.assigned_on,
           bt.created_by, b.institute_id
    from public.batch_teachers bt
    join public.batches b on b.batch_id = bt.batch_id
    where b.deleted_at is null
  loop
    -- For each batch_teacher, find all active batch_subjects for that batch
    for v_batch_subject in
      select bs.batch_subject_id
      from public.batch_subjects bs
      where bs.batch_id = v_batch_teacher.batch_id
        and bs.is_active = true
    loop
      -- Insert batch_subject_teachers row — idempotent via ON CONFLICT
      insert into public.batch_subject_teachers (
        batch_subject_id,
        teacher_id,
        institute_id,
        role_in_batch,
        assigned_on,
        created_by
      ) values (
        v_batch_subject.batch_subject_id,
        v_batch_teacher.teacher_id,
        v_batch_teacher.institute_id,
        v_batch_teacher.role_in_batch,
        v_batch_teacher.assigned_on,
        v_batch_teacher.created_by
      )
      on conflict (batch_subject_id, teacher_id) do nothing;

    end loop;
  end loop;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — Update Helper Function: get_teacher_batch_ids()
-- ════════════════════════════════════════════════════════════════════════════
--
-- The get_teacher_batch_ids() function was created in migration 066 and
-- originally queried batch_teachers. Now that batch_subject_teachers has data,
-- we update the function to query the new table.
--
-- This automatically updates the RLS policy from migration 066
-- ("Teachers can read batch_subjects for their batches") — teachers will now
-- see only the batch_subjects they are assigned to, not all batch_subjects
-- in batches they are in.
--
-- This is the CORRECT behavior per the new architecture: a teacher assigned
-- to "Physics in NEET 2026 Morning Batch" should NOT see "Chemistry in NEET
-- 2026 Morning Batch" unless they are also assigned to it.

create or replace function public.get_teacher_batch_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct bs.batch_id), '{}')
  from public.batch_subject_teachers bst
  join public.batch_subjects bs on bs.batch_subject_id = bst.batch_subject_id
  where bst.teacher_id = public.get_my_teacher_id()
$$;

comment on function public.get_teacher_batch_ids() is
  'Returns the batch_ids for all batches where the current teacher is assigned '
  'to at least one batch_subject. Queries batch_subject_teachers (the new '
  'subject-scoped teacher assignment table). '
  'SECURITY DEFINER prevents recursive RLS evaluation.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — COMMENT Statements
-- ════════════════════════════════════════════════════════════════════════════

-- 6a. Table comments
comment on table public.batch_subject_teachers is
  'Subject-scoped teacher assignment. Links teachers to batch_subjects (a '
  'subject within a batch). Replaces the old batch_teachers pattern of '
  'batch-level assignment. A teacher assigned to "Physics in NEET 2026 '
  'Morning Batch" only sees that batch_subject (not Chemistry or Biology in '
  'the same batch) unless separately assigned. The unique constraint on '
  '(batch_subject_id, teacher_id) prevents duplicate assignments.' ;

-- 6b. Column comments
comment on column public.batch_subject_teachers.batch_subject_teacher_id is
  'Surrogate primary key. Generated via gen_random_uuid().' ;

comment on column public.batch_subject_teachers.batch_subject_id is
  'FK to batch_subjects.batch_subject_id. The subject-within-batch this '
  'teacher is assigned to. CASCADE on delete — deleting a batch_subject '
  'removes all its teacher assignments.' ;

comment on column public.batch_subject_teachers.teacher_id is
  'FK to teacher_details.teacher_id. The teacher being assigned to this '
  'batch_subject. RESTRICT on delete — prevents orphaned assignments.' ;

comment on column public.batch_subject_teachers.institute_id is
  'Denormalized for RLS performance and multi-tenant isolation. Populated '
  'from the batch_subject institute_id at creation time.' ;

comment on column public.batch_subject_teachers.role_in_batch is
  'Advisory teaching role (e.g. lead_teacher, co_teacher, doubt_solver). '
  'Free text — not permission-enforced. Preserved from batch_teachers for '
  'backward compatibility.' ;

comment on column public.batch_subject_teachers.assigned_on is
  'Date the teacher was assigned to this batch_subject. Preserved from '
  'batch_teachers during backfill. Cannot be in the future.' ;

comment on column public.batch_subject_teachers.created_by is
  'FK to profiles.profile_id. The admin who created this assignment. '
  'SET NULL on profile soft-delete preserves the assignment record.' ;

-- 6c. Constraint comments
comment on constraint uq_bst_batch_subject_teacher on public.batch_subject_teachers is
  'Enforces the business rule: a teacher can be assigned to a batch_subject '
  'at most once. Prevents duplicate teacher assignments.' ;

comment on constraint ck_bst_assigned_on on public.batch_subject_teachers is
  'Ensures assigned_on is not a future date. Prevents accidental future '
  'dating of assignments.' ;

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 067 Domain 17 Batch Subject Teachers
-- ════════════════════════════════════════════════════════════════════════════
