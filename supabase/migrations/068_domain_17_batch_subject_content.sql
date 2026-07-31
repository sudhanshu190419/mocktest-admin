-- ============================================================================
-- Migration: 068 — Domain 17 Batch Subject Content
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Tables: batch_subject_contents
--
-- Depends on: Domain 01 (institutes, profiles)
--             Domain 02 (batches)
--             Domain 03 (content)
--             Migration 056 (batch_contents — for data migration)
--             Migration 066 (batch_subjects)
--             Existing functions (set_updated_at, get_my_institute_id, is_admin,
--               is_teacher, is_student, get_my_teacher_id, get_my_student_id,
--               get_student_batch_ids, get_teacher_batch_ids)
--
-- ## Purpose
--
-- Move content assignment from batch-level to batch_subject-level.
--
-- The old `batch_contents` table (migration 056) assigned content items to a
-- batch. The new `batch_subject_contents` table assigns content items to a
-- specific batch_subject (a subject within a batch).
--
-- This enables:
--   1. Students see content filtered by subject within a batch
--   2. Teachers manage content for specific subjects they teach
--   3. Subject-level content analytics and progress tracking
--   4. Correct data model matching the "Batch → Subjects" architecture
--
-- ## Backfill Strategy
--
-- Existing `batch_contents` records are migrated precisely using the content's
-- existing `subject_id` column. For each (batch_id, content_id) pair:
--   1. Find the content's subject_id (content already has this FK)
--   2. Find the batch_subject for that batch with the matching subject_id
--   3. Create a batch_subject_contents row
--   4. If no matching batch_subject exists (edge case), the content is skipped
--      and must be manually assigned by an admin
--
-- This is more precise than the previous conservative backfill strategies
-- because content items already carry their subject_id.
--
-- ## Relationship to batch_contents
--
-- The old `batch_contents` table is NOT dropped. It remains as a read-only
-- archive. The new `batch_subject_contents` table becomes the primary
-- mechanism for content assignment. Applications should read from
-- batch_subject_contents and only reference batch_contents for historical
-- migration audit purposes.
--
-- ## New Enum Types
--
-- None. No new enums are required for this table.
--
-- ## Order
--
--   1. Create batch_subject_contents table
--   2. Create indexes
--   3. Enable RLS and create policies
--   4. Backfill data from batch_contents (idempotent)
--   5. Add comments
--
-- Reference: Architecture_Migration_Analysis.md | MIGRATION_CHECKLIST.md
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — CREATE TABLE: batch_subject_contents
-- ════════════════════════════════════════════════════════════════════════════
--
-- Maps content items to specific batch_subjects (subject within a batch).
-- Replaces the old batch_contents table (which assigned content to a whole
-- batch) with a more granular subject-scoped assignment model.
--
-- Column design mirrors batch_contents (order_sequence, section_name,
-- is_optional) for feature parity.
--
-- A surrogate PK (batch_subject_content_id) is used following the same
-- pattern as batch_subjects and batch_subject_teachers.
-- The unique constraint on (batch_subject_id, content_id) ensures a content
-- item is assigned to a batch_subject at most once.
--
-- institute_id is denormalized for RLS performance, following the same
-- pattern as all Domain 17 tables.

create table public.batch_subject_contents (
  -- Primary Key (surrogate UUID)
  batch_subject_content_id  uuid          not null  default gen_random_uuid(),

  -- References the batch_subject (subject within a batch)
  batch_subject_id          uuid          not null,

  -- References the content item
  content_id                uuid          not null,

  -- Denormalized for RLS performance and multi-tenant isolation
  institute_id              uuid          not null,

  -- Display order of this content item within the batch_subject curriculum
  -- Mirrors batch_contents.order_sequence for feature parity
  order_sequence            integer       not null,

  -- Optional section or module label (e.g. Week 1, Module A: Kinematics)
  section_name              varchar(100)  null      default null,

  -- When TRUE, this content item is supplementary/enrichment material
  is_optional               boolean       not null  default false,

  -- Audit fields
  assigned_at               timestamptz   not null  default now(),
  assigned_by               uuid          null      default null,

  -- ── Primary Key ───────────────────────────────────────────────────────
  constraint pk_batch_subject_contents primary key (batch_subject_content_id),

  -- ── Foreign Keys ──────────────────────────────────────────────────────
  -- FK to batch_subjects: the subject-within-batch this content is assigned to
  -- CASCADE on delete — removing a batch_subject removes its content assignments
  constraint fk_bsc_batch_subject
    foreign key (batch_subject_id) references public.batch_subjects (batch_subject_id)
    on delete cascade
    on update restrict,

  -- FK to content: the content item being assigned
  -- RESTRICT on delete — prevents orphaned assignments
  constraint fk_bsc_content
    foreign key (content_id) references public.content (content_id)
    on delete restrict
    on update restrict,

  -- FK to institutes: denormalized for RLS performance and multi-tenant isolation
  -- RESTRICT on delete — prevents cascade deletion of institute data
  constraint fk_bsc_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  -- FK to profiles: admin who created this assignment
  -- SET NULL on profile soft-delete preserves the assignment record
  constraint fk_bsc_assigned_by
    foreign key (assigned_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- ── Unique Constraints ────────────────────────────────────────────────
  -- Enforces: a content item can be assigned to a batch_subject at most once.
  -- The unique constraint also creates a backing B-tree index for fast
  -- lookups by (batch_subject_id, content_id).
  constraint uq_bsc_batch_subject_content unique (batch_subject_id, content_id),

  -- ── CHECK Constraints ────────────────────────────────────────────────
  -- Order sequence must be positive (1-indexed)
  constraint ck_bsc_order_sequence check (order_sequence >= 1)
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Indexes
-- ════════════════════════════════════════════════════════════════════════════
-- All indexes are created after the table exists.
-- No duplicate indexes on columns already covered by UNIQUE constraints.

-- Batch-subject-scoped queries: "Which content items belong to Physics in NEET
-- 2026 Morning Batch?" This is the primary student/teacher dashboard query.
create index if not exists idx_bsc_batch_subject_id
  on public.batch_subject_contents (batch_subject_id);

-- Ordered content listing within a batch_subject for curriculum display
create index if not exists idx_bsc_batch_subject_order
  on public.batch_subject_contents (batch_subject_id, order_sequence);

-- Reverse lookup: "Which batch_subjects include this content item?"
create index if not exists idx_bsc_content_id
  on public.batch_subject_contents (content_id);

-- Institute-scoped queries: admin dashboard, content reporting
create index if not exists idx_bsc_institute_id
  on public.batch_subject_contents (institute_id);

-- Assigned_by lookups for admin audit
create index if not exists idx_bsc_assigned_by
  on public.batch_subject_contents (assigned_by);

-- Partial index: only non-optional (required) content items within a subject
-- Used for progress tracking — required content determines completion
create index if not exists idx_bsc_required_content
  on public.batch_subject_contents (batch_subject_id, order_sequence)
  where is_optional = false;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Row Level Security
-- ════════════════════════════════════════════════════════════════════════════

-- 3a. Enable RLS
alter table public.batch_subject_contents enable row level security;

-- 3b. Admin: full CRUD within their institute
--      Admins can manage all content assignments in their institute.
create policy "Admins have full access to batch_subject_contents"
  on public.batch_subject_contents
  for all
  to authenticated
  using (institute_id = public.get_my_institute_id() and public.is_admin())
  with check (institute_id = public.get_my_institute_id() and public.is_admin());

-- 3c. Teacher: read content for batch_subjects they are assigned to
--      Teachers can see content for subjects they teach.
--      Uses get_teacher_batch_ids() (updated in migration 067 to use
--      batch_subject_teachers) to scope to their assigned batch_subjects.
create policy "Teachers can read batch_subject_contents for their subjects"
  on public.batch_subject_contents
  for select
  to authenticated
  using (
    institute_id = public.get_my_institute_id()
    and public.is_teacher()
    and exists (
      select 1 from public.batch_subject_teachers bst
      where bst.batch_subject_id = batch_subject_contents.batch_subject_id
      and bst.teacher_id = public.get_my_teacher_id()
    )
  );

-- 3d. Student: read content for batch_subjects in batches they are enrolled in
--      Students can see content for subjects in batches they belong to.
--      Uses get_student_batch_ids() (from migration 066) to resolve batch
--      membership, then checks the batch_subject belongs to one of those batches.
create policy "Students can read batch_subject_contents for their batches"
  on public.batch_subject_contents
  for select
  to authenticated
  using (
    institute_id = public.get_my_institute_id()
    and public.is_student()
    and exists (
      select 1 from public.batch_subjects bs
      where bs.batch_subject_id = batch_subject_contents.batch_subject_id
      and bs.batch_id = any (public.get_student_batch_ids())
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Backfill: Migrate Existing Content Assignments
-- ════════════════════════════════════════════════════════════════════════════
--
-- Strategy: PRECISE MATCH — use content.subject_id to find the correct
-- batch_subject.
--
-- For every existing row in batch_contents:
--   1. Find the content item's subject_id (content already has this FK)
--   2. Find the batch_subject for the same batch with the matching subject_id
--   3. Create a batch_subject_contents row with the same metadata
--   4. Skip if no matching batch_subject exists (edge case — content has a
--      subject not present in the batch's stream)
--
-- This is precise rather than conservative because content items already
-- carry their subject_id. There's no ambiguity about which batch_subject a
-- content item belongs to.
--
-- Edge cases handled:
--   - Content with subject_id not in batch's stream: skipped (rare — occurs
--     if subject was removed from stream after content was created). Admin
--     must manually assign.
--   - Content with inactive batch_subject: still assigned (the is_active flag
--     on batch_subjects controls visibility, not assignment validity)
--   - Duplicate batch_contents rows: skipped via ON CONFLICT DO NOTHING
--
-- The backfill uses ON CONFLICT DO NOTHING for full idempotency.

do $$
declare
  v_batch_content record;
  v_matching_batch_subject_id uuid;
begin
  -- Iterate over every existing batch_contents row
  for v_batch_content in
    select bc.batch_id, bc.content_id, bc.institute_id,
           bc.order_sequence, bc.section_name, bc.is_optional,
           bc.assigned_at, bc.assigned_by,
           c.subject_id
    from public.batch_contents bc
    join public.content c on c.content_id = bc.content_id
  loop
    -- Find the batch_subject for this batch with the matching subject_id
    select bs.batch_subject_id into v_matching_batch_subject_id
    from public.batch_subjects bs
    where bs.batch_id = v_batch_content.batch_id
      and bs.subject_id = v_batch_content.subject_id;

    -- Skip if no matching batch_subject exists (edge case)
    if v_matching_batch_subject_id is null then
      continue;
    end if;

    -- Insert batch_subject_contents row — idempotent via ON CONFLICT
    insert into public.batch_subject_contents (
      batch_subject_id,
      content_id,
      institute_id,
      order_sequence,
      section_name,
      is_optional,
      assigned_at,
      assigned_by
    ) values (
      v_matching_batch_subject_id,
      v_batch_content.content_id,
      v_batch_content.institute_id,
      v_batch_content.order_sequence,
      v_batch_content.section_name,
      v_batch_content.is_optional,
      v_batch_content.assigned_at,
      v_batch_content.assigned_by
    )
    on conflict (batch_subject_id, content_id) do nothing;

  end loop;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — COMMENT Statements
-- ════════════════════════════════════════════════════════════════════════════

-- 5a. Table comments
comment on table public.batch_subject_contents is
  'Subject-scoped content assignment. Links content items to batch_subjects '
  '(a subject within a batch). Replaces the old batch_contents pattern of '
  'batch-level assignment. A content item assigned to "Physics in NEET 2026 '
  'Morning Batch" is only visible to that specific batch_subject (not to '
  'Chemistry or Biology in the same batch) unless separately assigned to '
  'those batch_subjects. The unique constraint on (batch_subject_id, '
  'content_id) prevents duplicate assignments.' ;

-- 5b. Column comments
comment on column public.batch_subject_contents.batch_subject_content_id is
  'Surrogate primary key. Generated via gen_random_uuid().' ;

comment on column public.batch_subject_contents.batch_subject_id is
  'FK to batch_subjects.batch_subject_id. The subject-within-batch this '
  'content item is assigned to. CASCADE on delete — removing a batch_subject '
  'removes all its content assignments.' ;

comment on column public.batch_subject_contents.content_id is
  'FK to content.content_id. The content item assigned to this batch_subject. '
  'RESTRICT on delete — prevents orphaned assignments.' ;

comment on column public.batch_subject_contents.institute_id is
  'Denormalized for RLS performance and multi-tenant isolation. Populated '
  'from the batch_subject institute_id at creation time.' ;

comment on column public.batch_subject_contents.order_sequence is
  'Display order of this content item within the batch_subject curriculum. '
  '1-indexed. Must be >= 1. Mirrors batch_contents.order_sequence.' ;

comment on column public.batch_subject_contents.section_name is
  'Optional section or module label (e.g. Week 1, Module A: Kinematics, '
  'Chapter 1: Laws of Motion). NULL for single-section curricula.' ;

comment on column public.batch_subject_contents.is_optional is
  'When TRUE, this content item is supplementary/enrichment material. '
  'Does not affect progress tracking. Required content (is_optional = FALSE) '
  'determines subject completion.' ;

comment on column public.batch_subject_contents.assigned_at is
  'UTC timestamp when this content item was added to the batch_subject. '
  'Preserved from batch_contents during backfill.' ;

comment on column public.batch_subject_contents.assigned_by is
  'FK to profiles.profile_id. The admin who assigned this content to the '
  'batch_subject. SET NULL on profile soft-delete preserves the record.' ;

-- 5c. Constraint comments
comment on constraint uq_bsc_batch_subject_content on public.batch_subject_contents is
  'Enforces the business rule: a content item can be assigned to a '
  'batch_subject at most once. Prevents duplicate content assignments.' ;

comment on constraint ck_bsc_order_sequence on public.batch_subject_contents is
  'Order sequence must be 1-indexed (>= 1). Prevents zero or negative '
  'sequence values that would break curriculum ordering.' ;

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 068 Domain 17 Batch Subject Content
-- ════════════════════════════════════════════════════════════════════════════
