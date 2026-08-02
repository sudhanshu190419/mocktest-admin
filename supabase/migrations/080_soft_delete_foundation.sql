-- ============================================================================
-- Migration: 080 — Soft Delete Foundation (Phase 8A)
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- ## Purpose
--
-- Prepare the database infrastructure for the Enterprise Soft Delete &
-- Recovery system (Phase 8). This migration ONLY prepares the database —
-- NOTHING begins using soft delete yet. No service, hook, page, edge
-- function, or business logic is changed.
--
-- ## What this migration delivers
--
--   1. Adds `deleted_at`, `deleted_by`, `delete_reason` to the 14 hard-delete
--      resource tables approved in the Phase 8 analysis.
--   2. Adds the same full column set to `recordings`. Migration 065 intended
--      a soft-deletable recordings table, but its `CREATE TABLE IF NOT
--      EXISTS` was a no-op against the recordings table created by migration
--      005 (which has NO `deleted_at` / `is_deleted` columns) — so the live
--      schema lacks `deleted_at` on recordings and all three columns are
--      added here (idempotently via ADD COLUMN IF NOT EXISTS).
--   3. Adds `deleted_by`, `delete_reason` (only the missing metadata columns)
--      to the 2 tables that truly already carry `deleted_at`: batches (003)
--      and courses (032). No existing column is renamed or modified.
--   4. Adds partial indexes `(deleted_at) WHERE deleted_at IS NULL` matching
--      the existing idx_batches_deleted_at / idx_courses_deleted_at pattern,
--      so every normal query stays fast and Recycle Bin queries are cheap.
--   5. Adds the `permanent_delete` action to the existing `audit_action_type`
--      enum (standalone ALTER TYPE ... ADD VALUE IF NOT EXISTS, exactly as
--      migrations 047 and 076).
--   6. Makes NO RLS changes. This is a pure schema foundation: it creates
--      no policies, modifies no permissions, and contains no business logic.
--      Permission enforcement ("only Super Admin can soft delete", restore,
--      permanent purge) belongs to the Phase 8B service layer and later
--      phases — the database enforces data integrity, NOT business rules.
--
-- ## What this migration does NOT do
--
--   • Does NOT convert any service delete to soft delete      (Phase 8B)
--   • Does NOT build restore / Recycle Bin / permanent purge (Phase 8C)
--   • Does NOT create the trashService / useTrash layers     (Phase 8C)
--   • Does NOT add soft-delete columns to tables that were EXPLICITLY
--     excluded by the analysis: audit_logs, trusted_devices,
--     approval_requests, orders, financial tables, junction/link tables
--     (batch_subject_*, course_*, mock_test_questions, pyq_*_mappings,
--     content_tag, ...), notifications.
--   • Does NOT create or modify any RLS policy or DELETE permission.
--   • Does NOT alter any existing trigger, constraint, or policy.
--
-- ## Tables touched (17 total)
--
--   NEW columns (deleted_at, deleted_by, delete_reason) — 15 tables:
--     questions · question_options · question_images · question_explanations
--     question_option_images · mock_tests · content · tags · subjects
--     chapters · topics · streams · pyq_packages · pyq_papers · recordings
--
--   Metadata columns only (deleted_by, delete_reason) — 2 tables:
--     batches · courses
--
--   recordings joins the NEW-column group: migration 065's CREATE TABLE IF
--   NOT EXISTS no-oped against the recordings table created by 005 (which
--   has NO deleted_at), so the live schema lacks deleted_at on recordings.
--
-- ## Depends on
--
--   Migration 002 — public.profiles (profile_id PK)
--   Migration 011 — public.audit_action_type (extended by 076)
--
-- ## Idempotency
--
--   • ALTER TYPE ... ADD VALUE IF NOT EXISTS  (standalone statements)
--   • ALTER TABLE ... ADD COLUMN IF NOT EXISTS
--   • DROP CONSTRAINT IF EXISTS before recreating constraints
--   • CREATE INDEX IF NOT EXISTS
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Extend audit_action_type Enum (Idempotent)
-- ════════════════════════════════════════════════════════════════════════════
-- Adds the single missing action identified in the Phase 8 audit analysis.
-- Standalone ALTER TYPE ... ADD VALUE IF NOT EXISTS (PostgreSQL 16), matching
-- migrations 047 and 076. Appends at the END of the enum sort order, so
-- existing rows and enumsortorder ordering remain fully compatible.

alter type public.audit_action_type add value if not exists 'permanent_delete';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — New Soft-Delete Columns (14 hard-delete tables)
-- ════════════════════════════════════════════════════════════════════════════
-- Every column is nullable with no default — a row is visible while
-- deleted_at IS NULL and enters the Recycle Bin once it is set. The
-- deleted_by FK (Section 5) preserves the actor even if the actor profile is
-- later removed (SET NULL), matching the fk_admin_roles_granted_by pattern.
-- delete_reason is a plain-text free-form note; never store secrets here.
--
-- NOTE: Writing these columns is intentionally NOT gated at the database
-- level (no triggers). The database enforces data integrity only; who may
-- set these columns is a business-permission rule handled in later phases.

alter table public.questions
  add column if not exists deleted_at     timestamptz,
  add column if not exists deleted_by     uuid,
  add column if not exists delete_reason  text;

alter table public.question_options
  add column if not exists deleted_at     timestamptz,
  add column if not exists deleted_by     uuid,
  add column if not exists delete_reason  text;

alter table public.question_images
  add column if not exists deleted_at     timestamptz,
  add column if not exists deleted_by     uuid,
  add column if not exists delete_reason  text;

alter table public.question_explanations
  add column if not exists deleted_at     timestamptz,
  add column if not exists deleted_by     uuid,
  add column if not exists delete_reason  text;

alter table public.question_option_images
  add column if not exists deleted_at     timestamptz,
  add column if not exists deleted_by     uuid,
  add column if not exists delete_reason  text;

alter table public.mock_tests
  add column if not exists deleted_at     timestamptz,
  add column if not exists deleted_by     uuid,
  add column if not exists delete_reason  text;

alter table public.content
  add column if not exists deleted_at     timestamptz,
  add column if not exists deleted_by     uuid,
  add column if not exists delete_reason  text;

alter table public.tags
  add column if not exists deleted_at     timestamptz,
  add column if not exists deleted_by     uuid,
  add column if not exists delete_reason  text;

alter table public.subjects
  add column if not exists deleted_at     timestamptz,
  add column if not exists deleted_by     uuid,
  add column if not exists delete_reason  text;

alter table public.chapters
  add column if not exists deleted_at     timestamptz,
  add column if not exists deleted_by     uuid,
  add column if not exists delete_reason  text;

alter table public.topics
  add column if not exists deleted_at     timestamptz,
  add column if not exists deleted_by     uuid,
  add column if not exists delete_reason  text;

alter table public.streams
  add column if not exists deleted_at     timestamptz,
  add column if not exists deleted_by     uuid,
  add column if not exists delete_reason  text;

alter table public.pyq_packages
  add column if not exists deleted_at     timestamptz,
  add column if not exists deleted_by     uuid,
  add column if not exists delete_reason  text;

alter table public.pyq_papers
  add column if not exists deleted_at     timestamptz,
  add column if not exists deleted_by     uuid,
  add column if not exists delete_reason  text;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Columns on Already-Soft-Deletable Tables + recordings
-- ════════════════════════════════════════════════════════════════════════════
-- batches (003) and courses (032) already carry deleted_at — only the
-- missing metadata columns (deleted_by, delete_reason) are added.
--
-- recordings: migration 065 intended a soft-deletable recordings table, but
-- its `CREATE TABLE IF NOT EXISTS` was a NO-OP against the recordings table
-- created by migration 005 (which has NO deleted_at / is_deleted columns).
-- The live schema therefore has NO deleted_at on recordings, so the FULL
-- column set (deleted_at, deleted_by, delete_reason) is added here — before
-- any index or FK referencing deleted_at is created (Sections 4-5). ADD
-- COLUMN IF NOT EXISTS keeps this safe in any environment.
--
-- Existing columns and their triggers are untouched — full backward
-- compatibility; existing write paths continue to work unchanged.

alter table public.batches
  add column if not exists deleted_by     uuid,
  add column if not exists delete_reason  text;

alter table public.courses
  add column if not exists deleted_by     uuid,
  add column if not exists delete_reason  text;

alter table public.recordings
  add column if not exists deleted_at     timestamptz,
  add column if not exists deleted_by     uuid,
  add column if not exists delete_reason  text;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Partial Indexes (WHERE deleted_at IS NULL)
-- ════════════════════════════════════════════════════════════════════════════
-- Matches the existing project pattern (idx_batches_deleted_at from 003,
-- idx_courses_deleted_at from 032). These partial indexes keep every normal
-- query fast and make Recycle Bin lookups (deleted_at IS NOT NULL) cheap.
-- CREATE INDEX IF NOT EXISTS makes this idempotent.
--
-- batches and courses already have the EXACT same partial index from their
-- original migrations — they are intentionally NOT recreated here to avoid
-- duplicate indexes.

create index if not exists idx_questions_deleted_at
  on public.questions (deleted_at)
  where deleted_at is null;

create index if not exists idx_question_options_deleted_at
  on public.question_options (deleted_at)
  where deleted_at is null;

create index if not exists idx_question_images_deleted_at
  on public.question_images (deleted_at)
  where deleted_at is null;

create index if not exists idx_question_explanations_deleted_at
  on public.question_explanations (deleted_at)
  where deleted_at is null;

create index if not exists idx_question_option_images_deleted_at
  on public.question_option_images (deleted_at)
  where deleted_at is null;

create index if not exists idx_mock_tests_deleted_at
  on public.mock_tests (deleted_at)
  where deleted_at is null;

create index if not exists idx_content_deleted_at
  on public.content (deleted_at)
  where deleted_at is null;

create index if not exists idx_tags_deleted_at
  on public.tags (deleted_at)
  where deleted_at is null;

create index if not exists idx_subjects_deleted_at
  on public.subjects (deleted_at)
  where deleted_at is null;

create index if not exists idx_chapters_deleted_at
  on public.chapters (deleted_at)
  where deleted_at is null;

create index if not exists idx_topics_deleted_at
  on public.topics (deleted_at)
  where deleted_at is null;

create index if not exists idx_streams_deleted_at
  on public.streams (deleted_at)
  where deleted_at is null;

create index if not exists idx_pyq_packages_deleted_at
  on public.pyq_packages (deleted_at)
  where deleted_at is null;

create index if not exists idx_pyq_papers_deleted_at
  on public.pyq_papers (deleted_at)
  where deleted_at is null;

-- recordings: deleted_at is created in Section 3 (065 was a no-op against
-- the 005 table, so recordings has no deleted_at and no purge index). The
-- standard convention index below is required for Phase 8C Recycle Bin
-- lookups (deleted_at IS NOT NULL scans) and normal-query filtering.
create index if not exists idx_recordings_deleted_at
  on public.recordings (deleted_at)
  where deleted_at is null;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — Foreign Keys: deleted_by → profiles(profile_id)
-- ════════════════════════════════════════════════════════════════════════════
-- Uses the project's existing FK style (see fk_admin_roles_granted_by in
-- migration 074): ON DELETE SET NULL preserves the soft-deleted row's record
-- when the actor profile is later removed; ON UPDATE RESTRICT. DROP
-- CONSTRAINT IF EXISTS before ADD keeps the migration idempotent.

alter table public.questions
  drop constraint if exists fk_questions_deleted_by;
alter table public.questions
  add constraint fk_questions_deleted_by
  foreign key (deleted_by) references public.profiles (profile_id)
  on delete set null
  on update restrict;

alter table public.question_options
  drop constraint if exists fk_question_options_deleted_by;
alter table public.question_options
  add constraint fk_question_options_deleted_by
  foreign key (deleted_by) references public.profiles (profile_id)
  on delete set null
  on update restrict;

alter table public.question_images
  drop constraint if exists fk_question_images_deleted_by;
alter table public.question_images
  add constraint fk_question_images_deleted_by
  foreign key (deleted_by) references public.profiles (profile_id)
  on delete set null
  on update restrict;

alter table public.question_explanations
  drop constraint if exists fk_question_explanations_deleted_by;
alter table public.question_explanations
  add constraint fk_question_explanations_deleted_by
  foreign key (deleted_by) references public.profiles (profile_id)
  on delete set null
  on update restrict;

alter table public.question_option_images
  drop constraint if exists fk_question_option_images_deleted_by;
alter table public.question_option_images
  add constraint fk_question_option_images_deleted_by
  foreign key (deleted_by) references public.profiles (profile_id)
  on delete set null
  on update restrict;

alter table public.mock_tests
  drop constraint if exists fk_mock_tests_deleted_by;
alter table public.mock_tests
  add constraint fk_mock_tests_deleted_by
  foreign key (deleted_by) references public.profiles (profile_id)
  on delete set null
  on update restrict;

alter table public.content
  drop constraint if exists fk_content_deleted_by;
alter table public.content
  add constraint fk_content_deleted_by
  foreign key (deleted_by) references public.profiles (profile_id)
  on delete set null
  on update restrict;

alter table public.tags
  drop constraint if exists fk_tags_deleted_by;
alter table public.tags
  add constraint fk_tags_deleted_by
  foreign key (deleted_by) references public.profiles (profile_id)
  on delete set null
  on update restrict;

alter table public.subjects
  drop constraint if exists fk_subjects_deleted_by;
alter table public.subjects
  add constraint fk_subjects_deleted_by
  foreign key (deleted_by) references public.profiles (profile_id)
  on delete set null
  on update restrict;

alter table public.chapters
  drop constraint if exists fk_chapters_deleted_by;
alter table public.chapters
  add constraint fk_chapters_deleted_by
  foreign key (deleted_by) references public.profiles (profile_id)
  on delete set null
  on update restrict;

alter table public.topics
  drop constraint if exists fk_topics_deleted_by;
alter table public.topics
  add constraint fk_topics_deleted_by
  foreign key (deleted_by) references public.profiles (profile_id)
  on delete set null
  on update restrict;

alter table public.streams
  drop constraint if exists fk_streams_deleted_by;
alter table public.streams
  add constraint fk_streams_deleted_by
  foreign key (deleted_by) references public.profiles (profile_id)
  on delete set null
  on update restrict;

alter table public.pyq_packages
  drop constraint if exists fk_pyq_packages_deleted_by;
alter table public.pyq_packages
  add constraint fk_pyq_packages_deleted_by
  foreign key (deleted_by) references public.profiles (profile_id)
  on delete set null
  on update restrict;

alter table public.pyq_papers
  drop constraint if exists fk_pyq_papers_deleted_by;
alter table public.pyq_papers
  add constraint fk_pyq_papers_deleted_by
  foreign key (deleted_by) references public.profiles (profile_id)
  on delete set null
  on update restrict;

alter table public.batches
  drop constraint if exists fk_batches_deleted_by;
alter table public.batches
  add constraint fk_batches_deleted_by
  foreign key (deleted_by) references public.profiles (profile_id)
  on delete set null
  on update restrict;

alter table public.courses
  drop constraint if exists fk_courses_deleted_by;
alter table public.courses
  add constraint fk_courses_deleted_by
  foreign key (deleted_by) references public.profiles (profile_id)
  on delete set null
  on update restrict;

alter table public.recordings
  drop constraint if exists fk_recordings_deleted_by;
alter table public.recordings
  add constraint fk_recordings_deleted_by
  foreign key (deleted_by) references public.profiles (profile_id)
  on delete set null
  on update restrict;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — RLS: intentionally untouched
-- ════════════════════════════════════════════════════════════════════════════
-- This migration makes NO row-level-security changes. No policy is created,
-- dropped, or modified — existing SELECT / INSERT / UPDATE / DELETE access
-- for every role is unchanged. Permission enforcement ("only Super Admin can
-- soft delete / restore / purge") is implemented in the Phase 8B service
-- layer, not at the database level. A future migration may add super-admin
-- DELETE policies when the permanent-purge path is implemented.

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 7 — COMMENT Statements
-- ════════════════════════════════════════════════════════════════════════════
-- Per-column comments for the new soft-delete columns. The wording is shared
-- across all tables; comments exist so the schema documents the convention
-- even before Phase 8B starts writing to these columns.

comment on column public.questions.deleted_at is
  'Soft-delete timestamp. NULL = active row. Rows with a value are hidden '
  'from normal queries and appear in the Recycle Bin.';
comment on column public.questions.deleted_by is
  'FK to profiles.profile_id — the user who soft-deleted this row. '
  'SET NULL on profile deletion preserves the record.';
comment on column public.questions.delete_reason is
  'Optional plain-text reason captured at soft-delete time. Never store '
  'secrets or credentials here.';

comment on column public.question_options.deleted_at is
  'Soft-delete timestamp. NULL = active row.';
comment on column public.question_options.deleted_by is
  'FK to profiles.profile_id — the user who soft-deleted this row.';
comment on column public.question_options.delete_reason is
  'Optional plain-text reason captured at soft-delete time.';

comment on column public.question_images.deleted_at is
  'Soft-delete timestamp. NULL = active row.';
comment on column public.question_images.deleted_by is
  'FK to profiles.profile_id — the user who soft-deleted this row.';
comment on column public.question_images.delete_reason is
  'Optional plain-text reason captured at soft-delete time.';

comment on column public.question_explanations.deleted_at is
  'Soft-delete timestamp. NULL = active row.';
comment on column public.question_explanations.deleted_by is
  'FK to profiles.profile_id — the user who soft-deleted this row.';
comment on column public.question_explanations.delete_reason is
  'Optional plain-text reason captured at soft-delete time.';

comment on column public.question_option_images.deleted_at is
  'Soft-delete timestamp. NULL = active row.';
comment on column public.question_option_images.deleted_by is
  'FK to profiles.profile_id — the user who soft-deleted this row.';
comment on column public.question_option_images.delete_reason is
  'Optional plain-text reason captured at soft-delete time.';

comment on column public.mock_tests.deleted_at is
  'Soft-delete timestamp. NULL = active row.';
comment on column public.mock_tests.deleted_by is
  'FK to profiles.profile_id — the user who soft-deleted this row.';
comment on column public.mock_tests.delete_reason is
  'Optional plain-text reason captured at soft-delete time.';

comment on column public.content.deleted_at is
  'Soft-delete timestamp. NULL = active row.';
comment on column public.content.deleted_by is
  'FK to profiles.profile_id — the user who soft-deleted this row.';
comment on column public.content.delete_reason is
  'Optional plain-text reason captured at soft-delete time.';

comment on column public.tags.deleted_at is
  'Soft-delete timestamp. NULL = active row.';
comment on column public.tags.deleted_by is
  'FK to profiles.profile_id — the user who soft-deleted this row.';
comment on column public.tags.delete_reason is
  'Optional plain-text reason captured at soft-delete time.';

comment on column public.subjects.deleted_at is
  'Soft-delete timestamp. NULL = active row.';
comment on column public.subjects.deleted_by is
  'FK to profiles.profile_id — the user who soft-deleted this row.';
comment on column public.subjects.delete_reason is
  'Optional plain-text reason captured at soft-delete time.';

comment on column public.chapters.deleted_at is
  'Soft-delete timestamp. NULL = active row.';
comment on column public.chapters.deleted_by is
  'FK to profiles.profile_id — the user who soft-deleted this row.';
comment on column public.chapters.delete_reason is
  'Optional plain-text reason captured at soft-delete time.';

comment on column public.topics.deleted_at is
  'Soft-delete timestamp. NULL = active row.';
comment on column public.topics.deleted_by is
  'FK to profiles.profile_id — the user who soft-deleted this row.';
comment on column public.topics.delete_reason is
  'Optional plain-text reason captured at soft-delete time.';

comment on column public.streams.deleted_at is
  'Soft-delete timestamp. NULL = active row.';
comment on column public.streams.deleted_by is
  'FK to profiles.profile_id — the user who soft-deleted this row.';
comment on column public.streams.delete_reason is
  'Optional plain-text reason captured at soft-delete time.';

comment on column public.pyq_packages.deleted_at is
  'Soft-delete timestamp. NULL = active row.';
comment on column public.pyq_packages.deleted_by is
  'FK to profiles.profile_id — the user who soft-deleted this row.';
comment on column public.pyq_packages.delete_reason is
  'Optional plain-text reason captured at soft-delete time.';

comment on column public.pyq_papers.deleted_at is
  'Soft-delete timestamp. NULL = active row.';
comment on column public.pyq_papers.deleted_by is
  'FK to profiles.profile_id — the user who soft-deleted this row.';
comment on column public.pyq_papers.delete_reason is
  'Optional plain-text reason captured at soft-delete time.';

comment on column public.batches.deleted_by is
  'FK to profiles.profile_id — the user who soft-deleted this row. '
  'Migration 003 already defines deleted_at on batches.';
comment on column public.batches.delete_reason is
  'Optional plain-text reason captured at soft-delete time.';

comment on column public.courses.deleted_by is
  'FK to profiles.profile_id — the user who soft-deleted this row. '
  'Migration 032 already defines deleted_at on courses.';
comment on column public.courses.delete_reason is
  'Optional plain-text reason captured at soft-delete time.';

comment on column public.recordings.deleted_at is
  'Soft-delete timestamp. NULL = active row. Rows with a value are hidden '
  'from normal queries and appear in the Recycle Bin. Added by this '
  'migration — the 005 recordings table had no deleted_at (065 no-op).';
comment on column public.recordings.deleted_by is
  'FK to profiles.profile_id — the user who soft-deleted this row.';
comment on column public.recordings.delete_reason is
  'Optional plain-text reason captured at soft-delete time.';

comment on constraint fk_questions_deleted_by on public.questions is
  'deleted_by references profiles(profile_id). ON DELETE SET NULL preserves '
  'the soft-deleted row when the actor profile is removed; ON UPDATE RESTRICT.';

comment on constraint fk_question_options_deleted_by on public.question_options is
  'deleted_by references profiles(profile_id). SET NULL on actor removal.';

comment on constraint fk_question_images_deleted_by on public.question_images is
  'deleted_by references profiles(profile_id). SET NULL on actor removal.';

comment on constraint fk_question_explanations_deleted_by on public.question_explanations is
  'deleted_by references profiles(profile_id). SET NULL on actor removal.';

comment on constraint fk_question_option_images_deleted_by on public.question_option_images is
  'deleted_by references profiles(profile_id). SET NULL on actor removal.';

comment on constraint fk_mock_tests_deleted_by on public.mock_tests is
  'deleted_by references profiles(profile_id). SET NULL on actor removal.';

comment on constraint fk_content_deleted_by on public.content is
  'deleted_by references profiles(profile_id). SET NULL on actor removal.';

comment on constraint fk_tags_deleted_by on public.tags is
  'deleted_by references profiles(profile_id). SET NULL on actor removal.';

comment on constraint fk_subjects_deleted_by on public.subjects is
  'deleted_by references profiles(profile_id). SET NULL on actor removal.';

comment on constraint fk_chapters_deleted_by on public.chapters is
  'deleted_by references profiles(profile_id). SET NULL on actor removal.';

comment on constraint fk_topics_deleted_by on public.topics is
  'deleted_by references profiles(profile_id). SET NULL on actor removal.';

comment on constraint fk_streams_deleted_by on public.streams is
  'deleted_by references profiles(profile_id). SET NULL on actor removal.';

comment on constraint fk_pyq_packages_deleted_by on public.pyq_packages is
  'deleted_by references profiles(profile_id). SET NULL on actor removal.';

comment on constraint fk_pyq_papers_deleted_by on public.pyq_papers is
  'deleted_by references profiles(profile_id). SET NULL on actor removal.';

comment on constraint fk_batches_deleted_by on public.batches is
  'deleted_by references profiles(profile_id). SET NULL on actor removal.';

comment on constraint fk_courses_deleted_by on public.courses is
  'deleted_by references profiles(profile_id). SET NULL on actor removal.';

comment on constraint fk_recordings_deleted_by on public.recordings is
  'deleted_by references profiles(profile_id). SET NULL on actor removal.';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION QUERIES (run manually after applying the migration)
-- ════════════════════════════════════════════════════════════════════════════
--
-- 1. Columns added (expect 3 columns × 15 tables, 2 columns × 2 tables):
--    select table_name, column_name
--    from information_schema.columns
--    where table_schema = 'public'
--      and column_name in ('deleted_at', 'deleted_by', 'delete_reason')
--    order by table_name, column_name;
--    → Expect deleted_at on the 15 tables created by this migration (the
--      original 14 + recordings) plus the pre-existing deleted_at on
--      batches and courses; deleted_by + delete_reason on all 17 tables.
--      audit_logs / trusted_devices / approval_requests / orders must NOT
--      appear.
--
-- 2. Partial indexes (expect 15 new + the 2 pre-existing on batches/courses):
--    select indexname, indexdef
--    from pg_indexes
--    where schemaname = 'public'
--      and indexname like 'idx_%_deleted_at'
--    order by indexname;
--    → Expect idx_questions_deleted_at ... idx_pyq_papers_deleted_at,
--      idx_recordings_deleted_at, plus the pre-existing idx_batches_deleted_at
--      and idx_courses_deleted_at. Every new index must end with
--      "WHERE deleted_at IS NULL".
--
-- 3. FK constraints (expect exactly 17):
--    select conrelid::regclass::text as table, conname, pg_get_constraintdef(oid)
--    from pg_constraint
--    where contype = 'f' and conname like 'fk_%_deleted_by'
--    order by 1;
--    → Expect fk_<table>_deleted_by on all 17 tables, each referencing
--      public.profiles (profile_id) ON DELETE SET NULL.
--
-- 4. Enum extended with permanent_delete:
--    select enumlabel from pg_enum
--    join pg_type on pg_type.oid = pg_enum.enumtypid
--    where pg_type.typname = 'audit_action_type'
--    order by enumsortorder;
--    → Expect the previous 31 actions plus permanent_delete (32 total).
--
-- 5. RLS unchanged (this migration creates no policies):
--    select count(*) from pg_policies
--    where schemaname = 'public';
--    → Expect the SAME count as before applying migration 080 — this
--      migration creates, drops, or modifies NO RLS policy.
--
-- 6. Backward compatibility spot-checks:
--    -- ordinary updates (no soft-delete column) pass for any role
--    update public.questions set question_text = question_text
--     where false;
--    -- existing read/write policies unchanged
--    select count(*) from pg_policies
--    where schemaname = 'public' and tablename in
--      ('questions', 'mock_tests', 'content', 'batches', 'courses',
--       'recordings');
--    → Expect the same count as before applying migration 080.

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK SQL (NOT executed by this migration — copy & run manually only if
-- Migration 080 must be reverted):
--
--   -- 1. Drop the 17 FK constraints
--   alter table public.questions drop constraint if exists fk_questions_deleted_by;
--   alter table public.question_options drop constraint if exists fk_question_options_deleted_by;
--   alter table public.question_images drop constraint if exists fk_question_images_deleted_by;
--   alter table public.question_explanations drop constraint if exists fk_question_explanations_deleted_by;
--   alter table public.question_option_images drop constraint if exists fk_question_option_images_deleted_by;
--   alter table public.mock_tests drop constraint if exists fk_mock_tests_deleted_by;
--   alter table public.content drop constraint if exists fk_content_deleted_by;
--   alter table public.tags drop constraint if exists fk_tags_deleted_by;
--   alter table public.subjects drop constraint if exists fk_subjects_deleted_by;
--   alter table public.chapters drop constraint if exists fk_chapters_deleted_by;
--   alter table public.topics drop constraint if exists fk_topics_deleted_by;
--   alter table public.streams drop constraint if exists fk_streams_deleted_by;
--   alter table public.pyq_packages drop constraint if exists fk_pyq_packages_deleted_by;
--   alter table public.pyq_papers drop constraint if exists fk_pyq_papers_deleted_by;
--   alter table public.batches drop constraint if exists fk_batches_deleted_by;
--   alter table public.courses drop constraint if exists fk_courses_deleted_by;
--   alter table public.recordings drop constraint if exists fk_recordings_deleted_by;
--
--   -- 2. Drop the 15 new partial indexes (batches/courses indexes pre-date 080)
--   drop index if exists idx_questions_deleted_at;
--   drop index if exists idx_question_options_deleted_at;
--   drop index if exists idx_question_images_deleted_at;
--   drop index if exists idx_question_explanations_deleted_at;
--   drop index if exists idx_question_option_images_deleted_at;
--   drop index if exists idx_mock_tests_deleted_at;
--   drop index if exists idx_content_deleted_at;
--   drop index if exists idx_tags_deleted_at;
--   drop index if exists idx_subjects_deleted_at;
--   drop index if exists idx_chapters_deleted_at;
--   drop index if exists idx_topics_deleted_at;
--   drop index if exists idx_streams_deleted_at;
--   drop index if exists idx_pyq_packages_deleted_at;
--   drop index if exists idx_pyq_papers_deleted_at;
--   drop index if exists idx_recordings_deleted_at;
--
--   -- 3. Drop the columns. recordings is treated as a NEW-column table
--   --      (3 columns): migration 005 created it without deleted_at and 065
--   --      was a CREATE TABLE IF NOT EXISTS no-op, so deleted_at there is
--   --      080-created and safe to drop. batches/courses keep their
--   --      pre-existing deleted_at (2 columns each).
--   alter table public.questions drop column if exists deleted_at, drop column if exists deleted_by, drop column if exists delete_reason;
--   alter table public.question_options drop column if exists deleted_at, drop column if exists deleted_by, drop column if exists delete_reason;
--   alter table public.question_images drop column if exists deleted_at, drop column if exists deleted_by, drop column if exists delete_reason;
--   alter table public.question_explanations drop column if exists deleted_at, drop column if exists deleted_by, drop column if exists delete_reason;
--   alter table public.question_option_images drop column if exists deleted_at, drop column if exists deleted_by, drop column if exists delete_reason;
--   alter table public.mock_tests drop column if exists deleted_at, drop column if exists deleted_by, drop column if exists delete_reason;
--   alter table public.content drop column if exists deleted_at, drop column if exists deleted_by, drop column if exists delete_reason;
--   alter table public.tags drop column if exists deleted_at, drop column if exists deleted_by, drop column if exists delete_reason;
--   alter table public.subjects drop column if exists deleted_at, drop column if exists deleted_by, drop column if exists delete_reason;
--   alter table public.chapters drop column if exists deleted_at, drop column if exists deleted_by, drop column if exists delete_reason;
--   alter table public.topics drop column if exists deleted_at, drop column if exists deleted_by, drop column if exists delete_reason;
--   alter table public.streams drop column if exists deleted_at, drop column if exists deleted_by, drop column if exists delete_reason;
--   alter table public.pyq_packages drop column if exists deleted_at, drop column if exists deleted_by, drop column if exists delete_reason;
--   alter table public.pyq_papers drop column if exists deleted_at, drop column if exists deleted_by, drop column if exists delete_reason;
--   alter table public.batches drop column if exists deleted_by, drop column if exists delete_reason;
--   alter table public.courses drop column if exists deleted_by, drop column if exists delete_reason;
--   alter table public.recordings drop column if exists deleted_at, drop column if exists deleted_by, drop column if exists delete_reason;
--
--   -- 4. Enum value CANNOT be removed (PostgreSQL limitation). permanent_delete
--   --    remains in audit_action_type but is unused after rollback — harmless.
--
-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 080 Soft Delete Foundation
-- ════════════════════════════════════════════════════════════════════════════
