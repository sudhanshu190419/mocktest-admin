-- ============================================================================
-- Migration: 073 — Domain 17 Batch Subject Recordings
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Tables: batch_subject_recordings
--
-- Depends on: Domain 01 (institutes, profiles)
--             Domain 02 (batches)
--             Domain 04 (live_classes)
--             Migration 065 (recordings — the recordings table itself)
--             Migration 066 (batch_subjects)
--             Migration 067 (batch_subject_teachers — for RLS pattern)
--             Migration 068 (batch_subject_contents — for pattern reference)
--             Migration 069 (batch_subject_mock_tests — for pattern reference)
--             Migration 070 (batch_subject_live_classes — for pattern reference)
--             Migration 072 (recordings schema fix — source_type, nullable class_id)
--             Existing functions (set_updated_at, get_my_institute_id, is_admin,
--               is_teacher, is_student, get_my_teacher_id, get_my_student_id,
--               get_student_batch_ids, get_teacher_batch_ids)
--
-- ## Purpose
--
-- Create the assignment layer between recordings and batch subjects.
--
-- Recordings are independent reusable entities. A recording can be:
--   1. Generated automatically from a Live Class (source_type = 'live_class',
--      recordings.class_id IS NOT NULL)
--   2. Uploaded directly by a teacher or admin (source_type = 'uploaded',
--      recordings.class_id IS NULL)
--   3. Reassigned to additional Batch Subjects by an admin
--      (no duplicate recording — only another assignment row)
--
-- The recordings table (migration 065, fixed in 072) already supports both
-- workflows via the source_type column and nullable class_id.
--
-- This new junction table batch_subject_recordings replaces the old
-- denormalized recordings.batch_id pattern with a proper subject-scoped
-- assignment model, enabling:
--   1. A recording to be assigned to multiple batch subjects without
--      duplicating the recording record.
--   2. Students see recordings filtered by subject within their batch.
--   3. Teachers manage recordings for specific subjects they teach.
--   4. Admin re-assign an existing recording to additional batch subjects.
--   5. Correct data model matching the "Batch → Subjects" architecture.
--
-- ## New Enum Types
--
-- None. No new enums are required for this table. The recording_source_type
-- enum was already added in migration 072.
--
-- ## Relationship to recordings.batch_id
--
-- The old recordings.batch_id column is NOT dropped. It remains as a
-- denormalized fallback for legacy integrations. The new
-- batch_subject_recordings table becomes the primary mechanism for
-- recording-to-batch-subject assignment. Applications should read from
-- batch_subject_recordings and only reference recordings.batch_id for
-- historical migration audit purposes.
--
-- ## Order
--
--   1. Create batch_subject_recordings table
--   2. Create indexes
--   3. Enable RLS and create policies
--   4. Create updated_at trigger
--   5. Add comments
--
-- Reference: MIGRATION_CHECKLIST.md
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — CREATE TABLE: batch_subject_recordings
-- ════════════════════════════════════════════════════════════════════════════
--
-- Assigns recordings to specific batch_subjects (subject within a batch).
-- Replaces the old denormalized recordings.batch_id pattern with a
-- subject-scoped assignment model.
--
-- A surrogate PK (assignment_id) is used, consistent with all Domain 17
-- junction tables (batch_subject_contents, batch_subject_mock_tests,
-- batch_subject_live_classes).
--
-- The unique constraint on (batch_subject_id, recording_id) prevents a
-- recording from being assigned to the same batch_subject more than once.
--
-- institute_id is denormalized for RLS performance, following the same
-- pattern as all Domain 17 tables.
--
-- Columns are ordered: identifiers first, then FK references, then
-- denormalized fields, then audit fields, then timestamps (consistent
-- with Domain 17 conventions).

create table public.batch_subject_recordings (
  -- Primary Key (surrogate UUID — consistent with all Domain 17 junction tables)
  assignment_id       uuid            not null  default gen_random_uuid(),

  -- References the batch_subject (subject within a batch)
  batch_subject_id    uuid            not null,

  -- References the recording
  recording_id        uuid            not null,

  -- Denormalized for RLS performance and multi-tenant isolation
  institute_id        uuid            not null,

  -- UTC timestamp when this assignment was created. Immutable.
  assigned_at         timestamptz     not null  default now(),

  -- Admin or teacher who created this assignment. SET NULL on profile
  -- soft-delete preserves the assignment record.
  assigned_by         uuid            null      default null,

  -- Audit fields
  created_at          timestamptz     not null  default now(),
  updated_at          timestamptz     not null  default now(),

  -- ── Primary Key ───────────────────────────────────────────────────────
  constraint pk_batch_subject_recordings primary key (assignment_id),

  -- ── Foreign Keys ──────────────────────────────────────────────────────
  -- FK to batch_subjects: the subject-within-batch this recording is
  -- assigned to. CASCADE on delete — removing a batch_subject removes its
  -- recording assignments (the recording itself is NOT deleted, only the
  -- assignment).
  constraint fk_bsr_batch_subject
    foreign key (batch_subject_id) references public.batch_subjects (batch_subject_id)
    on delete cascade
    on update restrict,

  -- FK to recordings: the recording being assigned. RESTRICT on delete —
  -- prevents orphaned assignments.
  constraint fk_bsr_recording
    foreign key (recording_id) references public.recordings (recording_id)
    on delete restrict
    on update restrict,

  -- FK to institutes: denormalized for RLS performance and multi-tenant
  -- isolation. RESTRICT on delete — prevents cascade deletion of institute
  -- data.
  constraint fk_bsr_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  -- FK to profiles: admin or teacher who created this assignment.
  -- SET NULL on profile soft-delete preserves the assignment record.
  constraint fk_bsr_assigned_by
    foreign key (assigned_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- ── Unique Constraints ────────────────────────────────────────────────
  -- Enforces: a recording can be assigned to a batch_subject at most once.
  -- The unique constraint also creates a backing B-tree index for fast
  -- lookups by (batch_subject_id, recording_id).
  constraint uq_bsr_batch_subject_recording unique (batch_subject_id, recording_id)
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Indexes
-- ════════════════════════════════════════════════════════════════════════════
-- All indexes are created after the table exists.
-- No duplicate indexes on columns already covered by UNIQUE constraints.

-- Batch-subject-scoped queries: "Which recordings are assigned to Physics
-- in NEET 2026 Morning Batch?" Primary student/teacher dashboard query.
create index if not exists idx_bsr_batch_subject_id
  on public.batch_subject_recordings (batch_subject_id);

-- Reverse lookup: "Which batch_subjects is this recording assigned to?"
create index if not exists idx_bsr_recording_id
  on public.batch_subject_recordings (recording_id);

-- Institute-scoped queries: admin dashboard, recording reporting
create index if not exists idx_bsr_institute_id
  on public.batch_subject_recordings (institute_id);

-- Batch-subject + assigned_at sorting for chronological display
create index if not exists idx_bsr_batch_subject_assigned
  on public.batch_subject_recordings (batch_subject_id, assigned_at desc);

-- Assigned_by lookups for admin audit
create index if not exists idx_bsr_assigned_by
  on public.batch_subject_recordings (assigned_by);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Row Level Security
-- ════════════════════════════════════════════════════════════════════════════

-- 3a. Enable RLS
alter table public.batch_subject_recordings enable row level security;

-- 3b. Admin: full CRUD within their institute
--      Admins can manage all recording assignments in their institute.
create policy "Admins have full access to batch_subject_recordings"
  on public.batch_subject_recordings
  for all
  to authenticated
  using (institute_id = public.get_my_institute_id() and public.is_admin())
  with check (institute_id = public.get_my_institute_id() and public.is_admin());

-- 3c. Teacher: read recording assignments for batch_subjects they teach
--      Teachers can see recordings for subjects they teach.
--      Uses batch_subject_teachers (migration 067) to scope to their subjects.
create policy "Teachers can read batch_subject_recordings for their subjects"
  on public.batch_subject_recordings
  for select
  to authenticated
  using (
    institute_id = public.get_my_institute_id()
    and public.is_teacher()
    and exists (
      select 1 from public.batch_subject_teachers bst
      where bst.batch_subject_id = batch_subject_recordings.batch_subject_id
      and bst.teacher_id = public.get_my_teacher_id()
    )
  );

-- 3d. Student: read recording assignments for batch_subjects in batches
--      they are enrolled in.
--      Uses get_student_batch_ids() (from migration 066) to resolve batch
--      membership, then checks the batch_subject belongs to one of those
--      batches.
create policy "Students can read batch_subject_recordings for their batches"
  on public.batch_subject_recordings
  for select
  to authenticated
  using (
    institute_id = public.get_my_institute_id()
    and public.is_student()
    and exists (
      select 1 from public.batch_subjects bs
      where bs.batch_subject_id = batch_subject_recordings.batch_subject_id
      and bs.batch_id = any (public.get_student_batch_ids())
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Trigger
-- ════════════════════════════════════════════════════════════════════════════
-- Maintains updated_at for the assignment record.

create trigger trg_batch_subject_recordings_set_updated_at
  before update on public.batch_subject_recordings
  for each row
  execute function public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — COMMENT Statements
-- ════════════════════════════════════════════════════════════════════════════
-- Consistent with the documentation style of all Domain 17 migrations (066-070).

-- 5a. Table comments
comment on table public.batch_subject_recordings is
  'Subject-scoped recording assignment. Links recordings to batch_subjects '
  '(a subject within a batch). Replaces the old denormalized '
  'recordings.batch_id pattern with a proper assignment model. A recording '
  'assigned to "Physics in NEET 2026 Morning Batch" is only visible to that '
  'specific batch_subject (not to Chemistry or Biology in the same batch) '
  'unless separately assigned to those batch_subjects. Recordings remain '
  'independent entities — they can be assigned to multiple batch_subjects '
  'without being duplicated. Supports both live-generated recordings '
  '(source_type = ''live_class'', recordings.class_id IS NOT NULL) and '
  'standalone uploaded recordings (source_type = ''uploaded'', '
  'recordings.class_id IS NULL). The unique constraint on '
  '(batch_subject_id, recording_id) prevents duplicate assignments.' ;

-- 5b. Column comments
comment on column public.batch_subject_recordings.assignment_id is
  'Surrogate primary key for the assignment record. Generated via '
  'gen_random_uuid(). Consistent with all Domain 17 junction tables.' ;

comment on column public.batch_subject_recordings.batch_subject_id is
  'FK to batch_subjects.batch_subject_id. The subject-within-batch this '
  'recording is assigned to. CASCADE on delete — removing a batch_subject '
  'removes all its recording assignments (the recording itself is '
  'preserved).' ;

comment on column public.batch_subject_recordings.recording_id is
  'FK to recordings.recording_id. The recording being assigned. RESTRICT on '
  'delete — prevents orphaned assignments.' ;

comment on column public.batch_subject_recordings.institute_id is
  'Denormalized for RLS performance and multi-tenant isolation. Populated '
  'from the batch_subject institute_id at creation time.' ;

comment on column public.batch_subject_recordings.assigned_at is
  'UTC timestamp when this assignment was created. Defaults to NOW(). '
  'Immutable after creation.' ;

comment on column public.batch_subject_recordings.assigned_by is
  'FK to profiles.profile_id. The admin or teacher who created this '
  'assignment. SET NULL on profile soft-delete preserves the record.' ;

comment on column public.batch_subject_recordings.created_at is
  'UTC timestamp of row creation. Immutable.' ;

comment on column public.batch_subject_recordings.updated_at is
  'UTC timestamp of last update. Maintained by set_updated_at trigger.' ;

-- 5c. Constraint comments
comment on constraint uq_bsr_batch_subject_recording on public.batch_subject_recordings is
  'Enforces the business rule: a recording can be assigned to a batch_subject '
  'at most once. Prevents duplicate recording assignments to the same subject '
  'within a batch.' ;

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 073 Domain 17 Batch Subject Recordings
-- ════════════════════════════════════════════════════════════════════════════
