-- ============================================================================
-- Migration: 070 — Domain 17 Batch Subject Live Classes
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Tables: batch_subject_live_classes
--
-- Depends on: Domain 01 (institutes, profiles)
--             Domain 02 (batches)
--             Domain 04 (live_classes)
--             Migration 066 (batch_subjects)
--             Migration 067 (batch_subject_teachers — for RLS pattern)
--             Migration 068 (batch_subject_contents — for pattern reference)
--             Migration 069 (batch_subject_mock_tests — for pattern reference)
--             Existing functions (set_updated_at, get_my_institute_id, is_admin,
--               is_teacher, is_student, get_my_teacher_id, get_my_student_id,
--               get_student_batch_ids, get_teacher_batch_ids)
--
-- ## Purpose
--
-- Create the assignment layer between live classes and batch subjects.
--
-- Live classes remain independent entities (unchanged from migration 005).
-- A single live class can be broadcast to multiple batch subjects via this
-- new junction table. This replaces the old batch-level broadcast model
-- (live_class_batch) with a subject-scoped model.
--
-- The key architectural decision: a Live Class is NOT owned by a Batch Subject.
-- Instead, it is ASSIGNED to one or more Batch Subjects via the junction table.
-- This enables:
--   1. A single live class (e.g. "Physics — Motion in One Dimension") to be
--      assigned to Physics in NEET Morning + Physics in NEET Evening + Physics
--      in JEE Weekend — without duplicating the live class record.
--   2. Students see live classes filtered by subject within their batch.
--   3. Teachers manage live classes for specific subjects they teach.
--   4. Subject-level live class analytics and attendance tracking.
--   5. Correct data model matching the "Batch → Subjects" architecture.
--
-- ## New Enum Types
--
-- None. No new enums are required for this table.
--
-- ## Order
--
--   1. Create batch_subject_live_classes table
--   2. Create indexes
--   3. Enable RLS and create policies
--   4. Create updated_at trigger
--   5. Add comments
--
-- Reference: MIGRATION_CHECKLIST.md (Section A5)
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — CREATE TABLE: batch_subject_live_classes
-- ════════════════════════════════════════════════════════════════════════════
--
-- Assigns live classes to specific batch_subjects (subject within a batch).
-- Replaces the old live_class_batch table with a subject-scoped model.
--
-- A surrogate PK (assignment_id) is used so that dependent tables can
-- reference this assignment. The old live_class_batch used a composite PK
-- (class_id, batch_id); the new table follows the same surrogate PK pattern
-- as batch_subject_contents and batch_subject_mock_tests for consistency.
--
-- The unique constraint on (batch_subject_id, class_id) prevents a live class
-- from being assigned to the same subject within a batch more than once.
--
-- institute_id is denormalized for RLS performance, following the same
-- pattern as all Domain 17 tables.

create table public.batch_subject_live_classes (
  -- Primary Key (surrogate UUID — consistent with all Domain 17 junction tables)
  assignment_id       uuid            not null  default gen_random_uuid(),

  -- References the batch_subject (subject within a batch)
  batch_subject_id    uuid            not null,

  -- References the live class
  class_id            uuid            not null,

  -- Denormalized for RLS performance and multi-tenant isolation
  institute_id        uuid            not null,

  -- UTC timestamp when this assignment was created. Immutable.
  assigned_at         timestamptz     not null  default now(),

  -- Admin who created this assignment. SET NULL on profile soft-delete.
  assigned_by         uuid            null      default null,

  -- Audit fields
  created_at          timestamptz     not null  default now(),
  updated_at          timestamptz     not null  default now(),

  -- ── Primary Key ───────────────────────────────────────────────────────
  constraint pk_batch_subject_live_classes primary key (assignment_id),

  -- ── Foreign Keys ──────────────────────────────────────────────────────
  -- FK to batch_subjects: the subject-within-batch this class is assigned to
  -- CASCADE on delete — removing a batch_subject removes its live class
  -- assignments (the live class itself is NOT deleted, only the assignment)
  constraint fk_bslc_batch_subject
    foreign key (batch_subject_id) references public.batch_subjects (batch_subject_id)
    on delete cascade
    on update restrict,

  -- FK to live_classes: the live class being assigned
  -- RESTRICT on delete — prevents orphaned assignments
  constraint fk_bslc_class
    foreign key (class_id) references public.live_classes (class_id)
    on delete restrict
    on update restrict,

  -- FK to institutes: denormalized for RLS performance and multi-tenant isolation
  -- RESTRICT on delete — prevents cascade deletion of institute data
  constraint fk_bslc_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  -- FK to profiles: admin who created this assignment
  -- SET NULL on profile soft-delete preserves the assignment record
  constraint fk_bslc_assigned_by
    foreign key (assigned_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- ── Unique Constraints ────────────────────────────────────────────────
  -- Enforces: a live class can be assigned to a batch_subject at most once.
  -- The unique constraint also creates a backing B-tree index for fast
  -- lookups by (batch_subject_id, class_id).
  constraint uq_bslc_batch_subject_class unique (batch_subject_id, class_id)
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Indexes
-- ════════════════════════════════════════════════════════════════════════════
-- All indexes are created after the table exists.
-- No duplicate indexes on columns already covered by UNIQUE constraints.

-- Batch-subject-scoped queries: "Which live classes are assigned to Physics
-- in NEET 2026 Morning Batch?" Primary student/teacher dashboard query.
create index if not exists idx_bslc_batch_subject_id
  on public.batch_subject_live_classes (batch_subject_id);

-- Reverse lookup: "Which batch_subjects include this live class?"
create index if not exists idx_bslc_class_id
  on public.batch_subject_live_classes (class_id);

-- Institute-scoped queries: admin dashboard, live class reporting
create index if not exists idx_bslc_institute_id
  on public.batch_subject_live_classes (institute_id);

-- Batch-subject + assigned_at sorting for chronological display
create index if not exists idx_bslc_batch_subject_assigned
  on public.batch_subject_live_classes (batch_subject_id, assigned_at desc);

-- Assigned_by lookups for admin audit
create index if not exists idx_bslc_assigned_by
  on public.batch_subject_live_classes (assigned_by);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Row Level Security
-- ════════════════════════════════════════════════════════════════════════════

-- 3a. Enable RLS
alter table public.batch_subject_live_classes enable row level security;

-- 3b. Admin: full CRUD within their institute
--      Admins can manage all live class assignments in their institute.
create policy "Admins have full access to batch_subject_live_classes"
  on public.batch_subject_live_classes
  for all
  to authenticated
  using (institute_id = public.get_my_institute_id() and public.is_admin())
  with check (institute_id = public.get_my_institute_id() and public.is_admin());

-- 3c. Teacher: read live class assignments for batch_subjects they teach
--      Teachers can see live classes for subjects they teach.
--      Uses batch_subject_teachers (migration 067) to scope to their subjects.
create policy "Teachers can read batch_subject_live_classes for their subjects"
  on public.batch_subject_live_classes
  for select
  to authenticated
  using (
    institute_id = public.get_my_institute_id()
    and public.is_teacher()
    and exists (
      select 1 from public.batch_subject_teachers bst
      where bst.batch_subject_id = batch_subject_live_classes.batch_subject_id
      and bst.teacher_id = public.get_my_teacher_id()
    )
  );

-- 3d. Student: read live class assignments for batch_subjects in batches
--      they are enrolled in.
--      Uses get_student_batch_ids() (from migration 066) to resolve batch
--      membership, then checks the batch_subject belongs to one of those batches.
create policy "Students can read batch_subject_live_classes for their batches"
  on public.batch_subject_live_classes
  for select
  to authenticated
  using (
    institute_id = public.get_my_institute_id()
    and public.is_student()
    and exists (
      select 1 from public.batch_subjects bs
      where bs.batch_subject_id = batch_subject_live_classes.batch_subject_id
      and bs.batch_id = any (public.get_student_batch_ids())
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Trigger
-- ════════════════════════════════════════════════════════════════════════════
-- Maintains updated_at for the assignment record.

create trigger trg_batch_subject_live_classes_set_updated_at
  before update on public.batch_subject_live_classes
  for each row
  execute function public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — COMMENT Statements
-- ════════════════════════════════════════════════════════════════════════════

-- 6a. Table comments
comment on table public.batch_subject_live_classes is
  'Subject-scoped live class assignment. Links live classes to batch_subjects '
  '(a subject within a batch). Replaces the old live_class_batch pattern of '
  'batch-level assignment. A live class assigned to "Physics in NEET 2026 '
  'Morning Batch" is only visible to that specific batch_subject (not to '
  'Chemistry or Biology in the same batch) unless separately assigned to '
  'those batch_subjects. A live class remains an independent entity — it can '
  'be assigned to multiple batch_subjects across batches without being '
  'duplicated. The unique constraint on (batch_subject_id, class_id) prevents '
  'duplicate assignments.' ;

-- 6b. Column comments
comment on column public.batch_subject_live_classes.assignment_id is
  'Surrogate primary key for the assignment record. Generated via '
  'gen_random_uuid(). Consistent with all Domain 17 junction tables.' ;

comment on column public.batch_subject_live_classes.batch_subject_id is
  'FK to batch_subjects.batch_subject_id. The subject-within-batch this '
  'live class is assigned to. CASCADE on delete — removing a batch_subject '
  'removes all its live class assignments (the live class itself is '
  'preserved).' ;

comment on column public.batch_subject_live_classes.class_id is
  'FK to live_classes.class_id. The live class being assigned. RESTRICT on '
  'delete — prevents orphaned assignments.' ;

comment on column public.batch_subject_live_classes.institute_id is
  'Denormalized for RLS performance and multi-tenant isolation. Populated '
  'from the batch_subject institute_id at creation time.' ;

comment on column public.batch_subject_live_classes.assigned_at is
  'UTC timestamp when this assignment was created. Defaults to NOW(). '
  'Immutable after creation.' ;

comment on column public.batch_subject_live_classes.assigned_by is
  'FK to profiles.profile_id. The admin or teacher who created this '
  'assignment. SET NULL on profile soft-delete preserves the record.' ;

comment on column public.batch_subject_live_classes.created_at is
  'UTC timestamp of row creation. Immutable.' ;

comment on column public.batch_subject_live_classes.updated_at is
  'UTC timestamp of last update. Maintained by set_updated_at trigger.' ;

-- 6c. Constraint comments
comment on constraint uq_bslc_batch_subject_class on public.batch_subject_live_classes is
  'Enforces the business rule: a live class can be assigned to a batch_subject '
  'at most once. Prevents duplicate live class assignments to the same subject '
  'within a batch.' ;

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 070 Domain 17 Batch Subject Live Classes
-- ════════════════════════════════════════════════════════════════════════════
