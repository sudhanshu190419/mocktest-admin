-- ============================================================================
-- Migration: 066 — Domain 17 Batch Subject Core
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Tables: batch_subjects
--
-- Depends on: Domain 01 (institutes, profiles)
--             Domain 02 (streams, subjects, batches)
--             Existing enums (batch_status)
--             Existing functions (set_updated_at, get_my_institute_id, is_admin,
--               is_teacher, is_student, get_my_teacher_id, get_my_student_id)
--
-- ## Purpose
--
-- Create the core linking entity between batches and subjects. The `batch_subjects`
-- table is the atomic delivery unit for all resource assignment (teachers, content,
-- mock tests, live classes, recordings).
--
-- Also seeds the "Full Syllabus" subject in the `subjects` table for every stream.
-- This subject (code: FULL_SYLL) is referenced by multi-subject mock tests and
-- is a real FK target — no NULL sentinels anywhere.
--
-- ## Auto-Creation Rule
--
-- When a batch is created, batch_subjects are automatically created for EVERY
-- subject in the batch's stream (including "Full Syllabus"). Admins can later
-- deactivate unused subjects via `is_active = FALSE`.
--
-- ## New Enum Types
--
-- None. No new enums are required for this table.
--
-- ## Order
--
--   1. Create helper function: get_student_batch_ids() — used by RLS
--   2. Create batch_subjects table
--   3. Create indexes
--   4. Enable RLS and create policies
--   5. Create trigger
--   6. Seed the "Full Syllabus" subject (idempotent)
--   7. Backfill batch_subjects for existing batches (idempotent)
--   8. Add comments
--
-- Reference: Architecture_Migration_Analysis.md | MIGRATION_CHECKLIST.md
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Helper Function: get_student_batch_ids()
-- ════════════════════════════════════════════════════════════════════════════
-- Returns the batch_ids for all batches the current student is actively enrolled in.
-- Used by RLS policies to resolve batch_subject access for students.
-- SECURITY DEFINER prevents infinite recursion from RLS policies.

create or replace function public.get_student_batch_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(bs.batch_id), '{}')
  from public.batch_students bs
  where bs.student_id = public.get_my_student_id()
    and bs.status = 'active'
$$;

comment on function public.get_student_batch_ids() is
  'Returns the batch_ids for all batches the current student is actively enrolled in. '
  'Used by RLS policies on batch_subjects to scope student access. '
  'SECURITY DEFINER prevents recursive RLS evaluation.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Helper Function: get_teacher_batch_ids()
-- ════════════════════════════════════════════════════════════════════════════
-- Returns the batch_ids for all batches the current teacher is assigned to.
-- Uses the existing batch_teachers table (which will be replaced by
-- batch_subject_teachers in migration 067 — the RLS policy will be updated then).
-- SECURITY DEFINER prevents infinite recursion from RLS policies.

create or replace function public.get_teacher_batch_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(bt.batch_id), '{}')
  from public.batch_teachers bt
  where bt.teacher_id = public.get_my_teacher_id()
$$;

comment on function public.get_teacher_batch_ids() is
  'Returns the batch_ids for all batches the current teacher is assigned to. '
  'Uses batch_teachers during the transition period. Will be updated to use '
  'batch_subject_teachers after migration 067. '
  'SECURITY DEFINER prevents recursive RLS evaluation.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — CREATE TABLE: batch_subjects
-- ════════════════════════════════════════════════════════════════════════════
--
-- The core linking entity between batches and subjects. Every resource
-- (teachers, content, mock tests, live classes, recordings) is assigned
-- to a batch_subject, not directly to a batch.
--
-- A surrogate PK (batch_subject_id) is used instead of a composite PK so that
-- all dependent junction tables (batch_subject_teachers, batch_subject_contents,
-- etc.) reference a single FK column rather than a composite key.
--
-- The unique constraint on (batch_id, subject_id) enforces the business rule:
-- a batch can contain at most one instance of each subject.

create table public.batch_subjects (
  -- Primary Key (surrogate UUID — referenced by all dependent junction tables)
  batch_subject_id  uuid          not null  default gen_random_uuid(),

  -- Ownership & Scoping
  batch_id          uuid          not null,
  subject_id        uuid          not null,
  institute_id      uuid          not null,

  -- Display name override. Defaults to subjects.name when NULL.
  -- Allows admins to rename a subject within a batch context
  -- (e.g. "Physics Hons" vs "Physics") without affecting the global subject.
  name              varchar(100)  null      default null,

  -- Controls subject ordering within a batch. Lower values appear first.
  -- The "Full Syllabus" subject always gets display_order = 999.
  sort_order        smallint      not null  default 0,

  -- Soft-disable flag. Deactivating a batch_subject hides all its resources
  -- from students without deleting any data. Deactivation is reversible.
  is_active         boolean       not null  default true,

  -- Audit fields
  created_at        timestamptz   not null  default now(),
  updated_at        timestamptz   not null  default now(),
  created_by        uuid          null      default null,
  updated_by        uuid          null      default null,

  -- ── Primary Key ───────────────────────────────────────────────────────
  constraint pk_batch_subjects primary key (batch_subject_id),

  -- ── Foreign Keys ──────────────────────────────────────────────────────
  -- FK to batches: the batch that contains this subject
  -- RESTRICT on delete — batches with active batch_subjects cannot be deleted
  constraint fk_batch_subjects_batch
    foreign key (batch_id) references public.batches (batch_id)
    on delete restrict
    on update restrict,

  -- FK to subjects: the globally-defined academic subject
  -- RESTRICT on delete — subjects with active batch_subjects cannot be deleted
  constraint fk_batch_subjects_subject
    foreign key (subject_id) references public.subjects (subject_id)
    on delete restrict
    on update restrict,

  -- FK to institutes: denormalized for RLS performance and multi-tenant isolation
  -- RESTRICT on delete — prevents cascade deletion of institute data
  constraint fk_batch_subjects_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  -- FK to profiles: admin who created this batch_subject
  -- SET NULL on profile soft-delete preserves the batch_subject record
  constraint fk_batch_subjects_created_by
    foreign key (created_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- FK to profiles: admin who last updated this batch_subject
  constraint fk_batch_subjects_updated_by
    foreign key (updated_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- ── Unique Constraints ────────────────────────────────────────────────
  -- Enforces: a batch can contain at most one instance of each subject.
  -- The unique constraint also creates a backing B-tree index for fast
  -- lookups by (batch_id, subject_id).
  constraint uq_batch_subjects_batch_subject unique (batch_id, subject_id),

  -- ── CHECK Constraints ────────────────────────────────────────────────
  -- Display name override must be at least 2 characters when provided
  constraint ck_batch_subjects_name_length check (
    name is null or char_length(name) >= 2
  ),

  -- Sort order must be non-negative
  constraint ck_batch_subjects_sort_order check (sort_order >= 0)
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Indexes
-- ════════════════════════════════════════════════════════════════════════════
-- All indexes are created after the table exists.
-- No duplicate indexes on columns already covered by UNIQUE constraints.

-- Institute-scoped queries: admin dashboard, institute-wide subject listing
create index if not exists idx_batch_subjects_institute
  on public.batch_subjects (institute_id, is_active);

-- Batch-scoped queries: all subjects within a specific batch
-- Note: covered by uq_batch_subjects_batch_subject for (batch_id, subject_id),
-- but this index supports queries that only reference batch_id.
create index if not exists idx_batch_subjects_batch_id
  on public.batch_subjects (batch_id);

-- Subject-scoped reverse lookup: which batches contain a specific subject
create index if not exists idx_batch_subjects_subject_id
  on public.batch_subjects (subject_id);

-- Created_by / updated_by lookups for admin audit
create index if not exists idx_batch_subjects_created_by
  on public.batch_subjects (created_by);

create index if not exists idx_batch_subjects_updated_by
  on public.batch_subjects (updated_by);

-- Partial index: only active batch_subjects (common query pattern)
create index if not exists idx_batch_subjects_active
  on public.batch_subjects (batch_id, sort_order)
  where is_active = true;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — Row Level Security
-- ════════════════════════════════════════════════════════════════════════════

-- 5a. Enable RLS
alter table public.batch_subjects enable row level security;

-- 5b. Admin: full CRUD within their institute
--      Admins can see and manage all batch_subjects in their institute.
create policy "Admins have full access to batch_subjects"
  on public.batch_subjects
  for all
  to authenticated
  using (institute_id = public.get_my_institute_id() and public.is_admin())
  with check (institute_id = public.get_my_institute_id() and public.is_admin());

-- 5c. Teacher: read batch_subjects for batches they are assigned to
--      Teachers can see the subject structure of batches they teach.
--      During transition, uses batch_teachers. Will be updated in migration 072.
create policy "Teachers can read batch_subjects for their batches"
  on public.batch_subjects
  for select
  to authenticated
  using (
    institute_id = public.get_my_institute_id()
    and public.is_teacher()
    and batch_id = any (public.get_teacher_batch_ids())
  );

-- 5d. Student: read batch_subjects for batches they are enrolled in
--      Students can see the subject structure of batches they belong to.
create policy "Students can read batch_subjects for their batches"
  on public.batch_subjects
  for select
  to authenticated
  using (
    institute_id = public.get_my_institute_id()
    and public.is_student()
    and batch_id = any (public.get_student_batch_ids())
  );

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — Trigger: set_updated_at
-- ════════════════════════════════════════════════════════════════════════════
-- Uses the existing set_updated_at() function defined in migration 002.

create trigger trg_batch_subjects_set_updated_at
  before update on public.batch_subjects
  for each row
  execute function public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 7 — Seed the "Full Syllabus" Subject
-- ════════════════════════════════════════════════════════════════════════════
--
-- The "Full Syllabus" subject (code: FULL_SYLL) is a real subject in the
-- `subjects` table. It exists so that full-syllabus mock tests (e.g.
-- "NEET Full Mock #1") have a real FK target instead of a NULL subject_id.
--
-- This subject:
--   - Is seeded once per stream (idempotent — ON CONFLICT DO NOTHING)
--   - Has display_order = 999 (always last in dropdowns)
--   - Has no chapters (content/questions cannot be tagged to FULL_SYLL)
--   - Is excluded from per-subject analytics
--
-- The seed logic is idempotent. If a FULL_SYLL subject already exists for
-- a stream (from a previous run), it is left unchanged.

do $$
declare
  v_stream record;
  v_existing_subject_id uuid;
begin
  -- Iterate over every stream in every institute
  for v_stream in
    select stream_id, name from public.streams
    where is_active = true
  loop
    -- Check if a FULL_SYLL subject already exists for this stream
    select subject_id into v_existing_subject_id
    from public.subjects
    where stream_id = v_stream.stream_id
      and code = 'FULL_SYLL';

    -- Skip if already exists
    if v_existing_subject_id is not null then
      continue;
    end if;

    -- Insert the Full Syllabus subject
    insert into public.subjects (
      stream_id,
      name,
      code,
      display_order
    ) values (
      v_stream.stream_id,
      'Full Syllabus',
      'FULL_SYLL',
      999
    )
    on conflict (stream_id, code) do nothing;

  end loop;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 8 — Backfill: Auto-Create Batch Subjects for Existing Batches
-- ════════════════════════════════════════════════════════════════════════════
--
-- For every existing batch, auto-create batch_subjects for:
--   a) Every active subject in the batch's stream
--   b) The "Full Syllabus" subject (if not already covered by (a))
--
-- This ensures that existing batches have the same subject structure as
-- newly created batches. Admins can later deactivate unused subjects via
-- `is_active = FALSE`.
--
-- The insert uses ON CONFLICT DO NOTHING for idempotency.

do $$
declare
  v_batch record;
  v_subject record;
  v_institute_id uuid;
begin
  -- Iterate over every non-deleted batch
  for v_batch in
    select batch_id, stream_id, institute_id
    from public.batches
    where deleted_at is null
  loop
    -- Iterate over every subject in the batch's stream
    -- (including the FULL_SYLL subject we just seeded)
    -- Note: the subjects table does NOT have an is_active column.
    -- All subjects are considered active. Admins deactivate batch_subjects
    -- directly via batch_subjects.is_active = FALSE.
    for v_subject in
      select subject_id, name, display_order
      from public.subjects
      where stream_id = v_batch.stream_id
    loop
      -- Insert batch_subject — idempotent via ON CONFLICT
      insert into public.batch_subjects (
        batch_id,
        subject_id,
        institute_id,
        name,
        sort_order,
        is_active
      ) values (
        v_batch.batch_id,
        v_subject.subject_id,
        v_batch.institute_id,
        v_subject.name,            -- Default to subject name (admin can override)
        v_subject.display_order,   -- Inherit the subject's display order
        true                       -- Active by default
      )
      on conflict (batch_id, subject_id) do nothing;

    end loop;
  end loop;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 9 — COMMENT Statements
-- ════════════════════════════════════════════════════════════════════════════

-- 9a. Table comments
comment on table public.batch_subjects is
  'Core linking entity between batches and subjects. Each row represents a '
  'subject as taught within a specific batch (e.g. "Physics in NEET 2026 '
  'Morning Batch"). All resource assignment (teachers, content, mock tests, '
  'live classes, recordings) flows through this table. A surrogate PK '
  '(batch_subject_id) is used so all dependent junction tables reference a '
  'single FK column. Soft-disable via is_active = FALSE. The unique constraint '
  'on (batch_id, subject_id) prevents duplicate subjects within a batch.' ;

-- 9b. Column comments
comment on column public.batch_subjects.batch_subject_id is
  'Surrogate primary key. Generated via gen_random_uuid(). Referenced by all '
  'dependent junction tables (batch_subject_teachers, batch_subject_contents, '
  'batch_subject_mock_tests, batch_subject_live_classes) and by '
  'recordings.batch_subject_id and live_classes.batch_subject_id.' ;

comment on column public.batch_subjects.batch_id is
  'FK to batches.batch_id. The batch that contains this subject. RESTRICT on '
  'delete — batches with active batch_subjects cannot be deleted.' ;

comment on column public.batch_subjects.subject_id is
  'FK to subjects.subject_id. The globally-defined academic subject (e.g. '
  'Physics, Chemistry, Biology, or Full Syllabus). RESTRICT on delete — '
  'subjects referenced by batch_subjects cannot be deleted.' ;

comment on column public.batch_subjects.institute_id is
  'Denormalized for RLS performance and multi-tenant isolation. Populated '
  'from the batch''s institute_id at creation time.' ;

comment on column public.batch_subjects.name is
  'Optional display name override. When NULL, defaults to the global subject '
  'name. Allows admins to rename subjects within a batch context (e.g. '
  '"Physics Hons" vs "Physics") without affecting the global subject. '
  'Minimum 2 characters when set.' ;

comment on column public.batch_subjects.sort_order is
  'Controls subject ordering within a batch. Lower values appear first. '
  'The Full Syllabus subject always gets display_order 999. Must be >= 0.' ;

comment on column public.batch_subjects.is_active is
  'When TRUE, this batch_subject and all its assigned resources are visible '
  'to students. When FALSE, the subject is hidden without deleting any data. '
  'Deactivation is reversible. Use this to remove irrelevant subjects from '
  'a batch without losing assignments.' ;

comment on column public.batch_subjects.created_by is
  'FK to profiles.profile_id. The admin who created this batch_subject. '
  'SET NULL on profile soft-delete preserves the record. NULL for system-'
  'created batch_subjects (auto-created during backfill).' ;

comment on column public.batch_subjects.updated_by is
  'FK to profiles.profile_id. The admin who last modified this batch_subject. '
  'SET NULL on profile soft-delete preserves the record.' ;

-- 9c. Constraint comments
comment on constraint uq_batch_subjects_batch_subject on public.batch_subjects is
  'Enforces the business rule: a batch can contain at most one instance of '
  'each subject. Prevents duplicate subject assignments within a batch.' ;

comment on constraint ck_batch_subjects_name_length on public.batch_subjects is
  'Display name override must be at least 2 characters when provided. '
  'Prevents single-character or empty overrides.' ;

comment on constraint ck_batch_subjects_sort_order on public.batch_subjects is
  'Sort order must be non-negative. Zero is valid (appears first). Full '
  'Syllabus uses 999 to appear last.' ;

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 066 Domain 17 Batch Subject Core
-- ════════════════════════════════════════════════════════════════════════════
