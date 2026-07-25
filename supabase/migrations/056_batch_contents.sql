-- ============================================================================
-- Migration: 056 — Batch Contents (Content Assignment to Batches)
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Tables: batch_contents
--
-- Depends on: Migration 003 (batches, batch_students, batch_teachers)
--             Domain 03 (content)
--             Migration 033 (course_content — for data migration)
--
-- ## Purpose
--
-- This migration moves content assignment from Courses to Batches.
--
-- Previously, content was assigned to courses via the `course_content` junction
-- table (migration 033). Now, content is assigned to batches directly via the
-- new `batch_contents` table.
--
-- This makes the Batch the single delivery unit for all student-facing
-- resources: teachers, students, mock tests, live classes, attendance, and
-- now content.
--
-- ## Migration Path
--
-- Phase 1 (this migration):
--   1. Create `batch_contents` table (mirrors `course_content` columns)
--   2. Copy existing `course_content` data into `batch_contents` via
--      the `course_batches` junction (each course's content goes to
--      each of its linked batches)
--   3. Add RLS policies for all roles
--   4. Add indexes
--   5. DO NOT drop `course_content` — it remains as a read-only archive
--
-- Phase 2 (future — after verification):
--   - Drop `course_content` table
--   - Remove `courseContentAssignmentService` and related hooks
--   - Remove content assignment UI from Course Management pages
--
-- Reference: Schema_Domain_02_Academic.md | Admin_Dashboard_Functional_Specification.md
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — CREATE TABLE: batch_contents
-- ════════════════════════════════════════════════════════════════════════════
--
-- Junction table implementing the M:M relationship between batches and content.
-- A batch may have multiple content items; a content item may belong to
-- multiple batches.
--
-- Column design mirrors `course_content` from migration 033 for feature
-- parity (order_sequence, section_name, is_optional).
--
-- Naming follows the existing convention: batch_students, batch_teachers,
-- batch_mock_tests → batch_contents.

create table public.batch_contents (
  batch_id        uuid          not null,
  content_id      uuid          not null,
  institute_id    uuid          not null,
  order_sequence  integer       not null,
  section_name    varchar(100)  null      default null,
  is_optional     boolean       not null  default false,
  assigned_at     timestamptz   not null  default now(),
  assigned_by     uuid          null      default null,

  -- Primary Key (composite — also enforces uniqueness)
  constraint pk_batch_contents primary key (batch_id, content_id),

  -- Foreign Keys
  constraint fk_batch_contents_batch
    foreign key (batch_id) references public.batches (batch_id)
    on delete restrict
    on update restrict,

  constraint fk_batch_contents_content
    foreign key (content_id) references public.content (content_id)
    on delete restrict
    on update restrict,

  constraint fk_batch_contents_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_batch_contents_assigned_by
    foreign key (assigned_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- Unique Constraints
  constraint uq_batch_contents_batch_sequence unique (batch_id, order_sequence),

  -- CHECK Constraints
  constraint ck_batch_contents_order_sequence check (order_sequence >= 1)
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Indexes
-- ════════════════════════════════════════════════════════════════════════════

-- Reverse lookup: find all batches that include a specific content item
create index if not exists idx_batch_contents_content_id
  on public.batch_contents (content_id);

-- Ordered content listing for a batch curriculum
create index if not exists idx_batch_contents_batch_sequence
  on public.batch_contents (batch_id, order_sequence);

-- Institute-wide content mapping listing
create index if not exists idx_batch_contents_institute
  on public.batch_contents (institute_id);

-- Partial index: only non-optional (required) content items
create index if not exists idx_batch_contents_required
  on public.batch_contents (batch_id)
  where is_optional = false;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Row Level Security
-- ════════════════════════════════════════════════════════════════════════════

alter table public.batch_contents enable row level security;

-- Admins: full CRUD within their institute
create policy "Admins have full access to batch_contents"
  on public.batch_contents
  for all
  to authenticated
  using (institute_id = public.get_my_institute_id() and public.is_admin())
  with check (institute_id = public.get_my_institute_id() and public.is_admin());

-- Teachers: read content for batches they teach
create policy "Teachers can read batch_contents for their batches"
  on public.batch_contents
  for select
  to authenticated
  using (exists (
    select 1 from public.batch_teachers bt
    where bt.batch_id = batch_contents.batch_id
    and bt.teacher_id = public.get_my_teacher_id()
  ));

-- Students: read content for batches they are enrolled in
create policy "Students can read batch_contents for their batches"
  on public.batch_contents
  for select
  to authenticated
  using (exists (
    select 1 from public.batch_students bs
    where bs.batch_id = batch_contents.batch_id
    and bs.student_id = public.get_my_student_id()
    and bs.status = 'active'
  ));

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Data Migration from course_content
-- ════════════════════════════════════════════════════════════════════════════
--
-- For each course that has content assigned via course_content, copy that
-- content to every batch linked to that course via course_batches.
--
-- This ensures existing course-content assignments are preserved and
-- available through the new batch_contents architecture.
--
-- This migration is idempotent — if run multiple times, ON CONFLICT DO
-- NOTHING prevents duplicate entries.

insert into public.batch_contents (
  batch_id,
  content_id,
  institute_id,
  order_sequence,
  section_name,
  is_optional,
  assigned_at,
  assigned_by
)
select
  cb.batch_id,
  cc.content_id,
  cc.institute_id,
  cc.order_sequence,
  cc.section_name,
  cc.is_optional,
  cc.assigned_at,
  cc.assigned_by
from public.course_content cc
join public.course_batches cb on cb.course_id = cc.course_id
on conflict (batch_id, content_id) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — Comments
-- ════════════════════════════════════════════════════════════════════════════

comment on table public.batch_contents is
  'Junction table: M:M relationship between batches and content items. A batch '
  'may have multiple content items; a content item may belong to multiple '
  'batches. Follows the same pattern as batch_students, batch_teachers, and '
  'batch_mock_tests. Replaces course_content as the mechanism for content '
  'delivery to students.' ;

comment on column public.batch_contents.batch_id is
  'FK to batches.batch_id. The batch the content is assigned to.' ;

comment on column public.batch_contents.content_id is
  'FK to content.content_id. The content item assigned to the batch.' ;

comment on column public.batch_contents.institute_id is
  'Denormalized for RLS performance and multi-tenant isolation.' ;

comment on column public.batch_contents.order_sequence is
  'Display order of this content item within the batch curriculum. '
  '1-indexed. Must be >= 1.' ;

comment on column public.batch_contents.section_name is
  'Optional section or module label (e.g. Week 1, Module A: Kinematics, '
  'Chapter 1: Laws of Motion). NULL for single-section curricula.' ;

comment on column public.batch_contents.is_optional is
  'When TRUE, this content item is supplementary/enrichment material. '
  'Does not affect progress tracking.' ;

comment on column public.batch_contents.assigned_at is
  'UTC timestamp when this content item was added to the batch.' ;

comment on column public.batch_contents.assigned_by is
  'FK to profiles. The admin who added this content to the batch. SET NULL on '
  'profile soft-delete preserves the assignment record.' ;

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 056 Batch Contents
-- ════════════════════════════════════════════════════════════════════════════
