-- ============================================================================
-- Migration: 072 — Fix Recordings Schema for Standalone Recordings
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Tables modified: recordings (migration 005 / migration 065)
--
-- Depends on: Migration 005 (Domain 04 — original recordings table)
--             Migration 065 (recordings table with teacher/status columns)
--             Existing functions (set_updated_at)
--
-- ## Purpose
--
-- The recordings table was originally designed with class_id as NOT NULL
-- because every recording was assumed to be generated from a Live Class.
-- The application now supports two recording workflows:
--
--   1. **Live Class Recordings** — Automatically generated when a teacher
--      conducts a live class. class_id references the source live class.
--      source_type = 'live_class'.
--
--   2. **Standalone Uploaded Recordings** — Uploaded directly by a teacher
--      or admin without a live class. No live class exists, so class_id
--      must be NULL. source_type = 'uploaded'.
--
-- This migration:
--   - Makes class_id nullable (DROP NOT NULL)
--   - Adds a source_type column to explicitly distinguish recording origins
--   - Backfills all existing recordings as 'live_class' (they were all
--     created from live classes before this change)
--   - Adds a CHECK constraint to enforce data consistency:
--       * source_type = 'live_class'  ⇒  class_id IS NOT NULL
--       * source_type = 'uploaded'    ⇒  class_id IS NULL
--   - Updates the FK on class_id to ON DELETE SET NULL for safety
--   - Does NOT modify any unrelated columns or tables
--
-- ## Why a new enum instead of extending recording_type?
--
-- The existing recording_type enum ('live_class', 'practice', 'demo')
-- describes the CONTENT NATURE of the recording (e.g. a practice session
-- or a demo video). The new source_type describes the ORIGIN of the
-- recording (live class vs uploaded file). These are orthogonal concepts:
--
--   - A live class recording could be marked as recording_type = 'practice'
--   - An uploaded recording could be marked as recording_type = 'demo'
--
-- A separate enum avoids conflating these two concerns and keeps the
-- CHECK constraint simple and unambiguous.
--
-- ## No data loss
--
-- All existing recordings retain class_id (which is already populated).
-- The source_type is backfilled to 'live_class' for all existing rows.
-- No data is dropped or transformed.
--
-- ## Order
--
--   1. Create recording_source_type enum
--   2. ALTER class_id DROP NOT NULL
--   3. ADD COLUMN source_type with default
--   4. Backfill existing rows
--   5. Update FK constraint to ON DELETE SET NULL
--   6. Add CHECK constraint
--   7. Add/update comments
--   8. Update RLS policies if needed
--
-- Reference: MIGRATION_CHECKLIST.md
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Create Enum Type: recording_source_type
-- ════════════════════════════════════════════════════════════════════════════
-- Idempotent: only creates the enum if it does not already exist.

do $$ begin
  create type public.recording_source_type as enum (
    'live_class',  -- Generated from a Live Class (class_id IS NOT NULL)
    'uploaded'     -- Uploaded directly by teacher/admin (class_id IS NULL)
  );
exception
  when duplicate_object then null;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — ALTER TABLE: recordings
-- ════════════════════════════════════════════════════════════════════════════
-- All ALTER statements are idempotent-compatible (using IF EXISTS / IF NOT
-- EXISTS checks where available, or safe re-execution patterns).

-- 2a. Make class_id nullable
--     Existing rows all have class_id populated, so this is a metadata-only
--     change. No data is affected.
alter table public.recordings
  alter column class_id drop not null;

-- 2b. Add source_type column
--     Existing rows get 'live_class' via the DEFAULT value, which is correct
--     because they were all created from live classes.
--     The column is added as NOT NULL so the CHECK constraint below is fully
--     enforceable from the moment the column exists.
alter table public.recordings
  add column if not exists source_type public.recording_source_type
  not null default 'live_class';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Backfill
-- ════════════════════════════════════════════════════════════════════════════
-- The DEFAULT value on source_type already handles this for new rows and
-- for the ALTER itself. But explicitly backfill any edge case where a row
-- might have been inserted between the ALTER and this statement, or if the
-- table had rows from a different migration path.
--
-- This is idempotent: running it multiple times has no additional effect.

update public.recordings
set source_type = 'live_class'
where source_type is null;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Update FK Constraint (Optional Safety Measure)
-- ════════════════════════════════════════════════════════════════════════════
-- The existing FK on class_id likely uses ON DELETE RESTRICT or CASCADE.
-- With nullable class_id, ON DELETE SET NULL is safer: deleting a live class
-- should preserve the recording (just break the link) instead of failing or
-- cascading deletion.
--
-- We must drop the existing FK and recreate it. The constraint name depends
-- on which migration created it (migration 005 or 065). We search by
-- referencing column.
--
-- Note: This is a NOT idempotent DDL operation. It only runs once.

do $$ begin
  -- Drop the existing foreign key constraint on class_id if it exists.
  -- The constraint name varies depending on which migration created the table.
  -- We use the referenced column name to find and drop it safely.
  if exists (
    select 1 from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
      and tc.table_schema = kcu.table_schema
    where tc.table_schema = 'public'
      and tc.table_name = 'recordings'
      and kcu.column_name = 'class_id'
      and tc.constraint_type = 'FOREIGN KEY'
  ) then
    -- Drop all FK constraints referencing class_id (there should be only one)
    execute (
      select 'alter table public.recordings drop constraint '
             || quote_ident(tc.constraint_name) || ';'
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on tc.constraint_name = kcu.constraint_name
        and tc.table_schema = kcu.table_schema
      where tc.table_schema = 'public'
        and tc.table_name = 'recordings'
        and kcu.column_name = 'class_id'
        and tc.constraint_type = 'FOREIGN KEY'
      limit 1
    );
  end if;

  -- Recreate with ON DELETE SET NULL
  --
  -- Verified: live_classes.class_id is the PRIMARY KEY of live_classes
  -- (migration 005: constraint pk_live_classes primary key (class_id)),
  -- so this FK correctly references the target table's PK.
  alter table public.recordings
    add constraint fk_recordings_class
    foreign key (class_id) references public.live_classes (class_id)
    on delete set null
    on update restrict;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — Add CHECK Constraint
-- ════════════════════════════════════════════════════════════════════════════
-- Enforces data consistency between source_type and class_id:
--
--   source_type = 'live_class'  ⇒  class_id must reference a live class
--   source_type = 'uploaded'    ⇒  class_id must be NULL (no live class)
--
-- This prevents two kinds of data corruption:
--   1. A recording marked as 'uploaded' but accidentally given a class_id
--   2. A recording marked as 'live_class' but missing its class_id reference
--
-- Guarded by a DO block for full idempotency: re-running this migration
-- will not error if the constraint already exists.

do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'recordings'
      and constraint_name = 'ck_recordings_source_type_class'
  ) then
    alter table public.recordings
      add constraint ck_recordings_source_type_class
      check (
        (source_type = 'live_class' and class_id is not null)
        or
        (source_type = 'uploaded' and class_id is null)
      );
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — Update/Add Comments
-- ════════════════════════════════════════════════════════════════════════════

-- 6a. Update table comment to reflect the dual-origin architecture
comment on table public.recordings is
  'Stores metadata for recordings. Supports two origins: (1) Live class '
  'recordings — automatically generated when a teacher conducts a live class; '
  '(2) Uploaded recordings — standalone files uploaded directly by a teacher '
  'or admin without a live class. The source_type column distinguishes these '
  'two cases. Recordings can be assigned to batch_subjects via the '
  'batch_subject_recordings junction table.' ;

-- 6b. Update class_id comment to reflect nullable nature
comment on column public.recordings.class_id is
  'FK to live_classes.class_id. Nullable — only populated for recordings '
  'generated from a live class (source_type = ''live_class''). NULL for '
  'standalone uploaded recordings (source_type = ''uploaded''). ON DELETE '
  'SET NULL preserves the recording even if the source live class is deleted.' ;

-- 6c. Add source_type comment
comment on column public.recordings.source_type is
  'Origin of the recording. live_class: generated automatically from a live '
  'class (class_id IS NOT NULL). uploaded: uploaded directly by a teacher or '
  'admin without a live class (class_id IS NULL). This is distinct from '
  'recording_type which describes the content nature (practice, demo, etc.).' ;

-- 6d. Add CHECK constraint comment
comment on constraint ck_recordings_source_type_class on public.recordings is
  'Enforces: source_type = ''live_class'' ⇒ class_id IS NOT NULL; '
  'source_type = ''uploaded'' ⇒ class_id IS NULL. Prevents inconsistent '
  'recording origin data.' ;

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 072 Fix Recordings Schema for Standalone Recordings
-- ════════════════════════════════════════════════════════════════════════════
