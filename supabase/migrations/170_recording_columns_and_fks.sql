-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 170 — Recordings Column, FK, Index & RLS Completion
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Depends on:
--   Migration 005 (Domain 04) — public.recordings table (live-class schema)
--   Migration 065 (intended recordings table that NO-OPed against 005)
--   Migration 072 (recordings class_id nullable + source_type)
--   Migration 080 (recordings deleted_at / deleted_by / delete_reason)
--   Migration 169 (public.recording_type enum, public.recording_source_type enum,
--                  public.recording_status values 'recording' & 'partial')
--
-- ## Purpose
--
-- Complete the recordings table so it matches the application contract expected
-- by recordingService, mapRecording(), getRecordings(), and the teacher
-- recordings-management UI. Migration 065 intended these columns, but its
-- `CREATE TABLE IF NOT EXISTS` was a NO-OP against the table created by
-- migration 005, so the live schema never received them.
--
-- Migration 169 must be applied first: this migration REFERENCES
-- public.recording_type in a DEFAULT expression. PostgreSQL allows a
-- transactional CREATE TABLE to reference a newly created enum type, but
-- ALTER TABLE ... ADD COLUMN ... DEFAULT referencing a type created earlier
-- in the same transaction is safe here because the type already exists
-- before this migration begins (169 commits it first under the project's
-- one-migration-per-transaction runner).
--
-- ## Scope — columns, indexes, foreign keys, backfill, NOT NULL, one RLS policy
--
-- This file is deliberately limited to:
--   1. Add the missing recordings columns.
--   2. Add the required indexes for those new columns.
--   3. Add the required foreign keys for those new columns.
--   4. Backfill existing rows safely (defensive; production currently has 0 rows).
--   5. Set the required NOT NULL constraints after backfill validation.
--   6. Add the missing teacher recording-management RLS policy.
--
-- ## What this migration does NOT do
--
--   • Does NOT alter, create, or drop any enum (done in 169).
--   • Does NOT alter recording_status.
--   • Does NOT alter class_id nullability (done in 072).
--   • Does NOT alter or drop any existing CHECK constraint.
--   • Does NOT modify uq_recordings_class_segment.
--   • Does NOT modify existing triggers (trg_recordings_set_updated_at from 005).
--   • Does NOT modify existing SELECT policies.
--   • Does NOT modify Edge Functions, recordingService, LiveKit, Egress, R2,
--     Supabase secrets, webhook configuration, or UI.
--   • Does NOT create File 3 work (CHECK reconciliation, etc.).
--
-- ## Existing columns (untouched)
--
-- recording_id · class_id · institute_id · storage_bucket · storage_path
-- provider_recording_url · duration_seconds · file_size_bytes · segment_number
-- status · failure_reason · recorded_at · completed_at · thumbnail_path
-- transcript_path · captions_path · created_at · updated_at · source_type
-- deleted_at · deleted_by · delete_reason
--
-- Existing CHECK constraints (untouched, reserved for File 3):
--   ck_recordings_status_completed
--   ck_recordings_storage_or_provider
--   ck_recordings_storage_pair
--
-- Existing unique constraint (untouched):
--   uq_recordings_class_segment (class_id, segment_number)
--
-- Existing indexes (untouched):
--   idx_recordings_class_id · idx_recordings_institute_status · idx_recordings_status
--
-- Existing trigger (untouched):
--   trg_recordings_set_updated_at
--
-- Existing RLS policies (untouched):
--   The table currently has RLS enabled (005/065/072/080 pattern) — this
--   migration adds ONLY the teacher-management policy. It does not touch any
--   existing policy. NOTE: if the current production state has no recordings
--   SELECT policies yet, this migration still does not create them — that is
--   out of scope here.
--
-- ## Idempotency
--
--   • ALTER TABLE ... ADD COLUMN IF NOT EXISTS
--   • CREATE INDEX IF NOT EXISTS
--   • DO-block guarded constraint creation for CHECK/FK/UNIQUE constraints where
--     needed
--   • UPDATE ... WHERE ... uses stable predicates so re-runs are harmless
--
-- ## Transactional safety
--
-- The runner wraps each migration file in a single transaction. All DDL here
-- is transactional in PostgreSQL 16 (adding columns, altering nullability,
-- creating indexes, adding FKs, creating policies). The defensive backfill
-- is a normal DML statement inside the same transaction, so if anything fails
-- the whole migration rolls back and no partial schema is left behind.
--
-- Because production currently has ZERO rows in public.recordings, the
-- backfill and NOT NULL validation steps are effectively no-ops — but they
-- are written to be safe on any non-empty clone, as required.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. Add missing columns ───────────────────────────────────────────────────

alter table public.recordings
  add column if not exists teacher_id         uuid,
  add column if not exists title              text,
  add column if not exists description        text,
  add column if not exists recording_type     public.recording_type
    default 'live_class',
  add column if not exists livekit_egress_id  text,
  add column if not exists error_message       text,
  add column if not exists retry_count         integer default 0,
  add column if not exists last_retried_at     timestamptz,
  add column if not exists batch_id           uuid,
  add column if not exists playback_url        text,
  add column if not exists thumbnail_url       text,
  add column if not exists is_deleted          boolean default false;

-- ─── 2. Defensive backfill for existing rows ────────────────────────────────

-- Production currently has ZERO rows in public.recordings. These statements
-- are therefore effectively no-ops in production, but they are written to be
-- safe on any non-empty clone, as required by the migration contract.
--
-- teacher_id: derive from live_classes.teacher_id using recordings.class_id.
-- title: derive from live_classes.title.
-- recording_type: 'live_class' for existing recordings (they were all created
--   from a live class under the original 005 schema).
-- retry_count: 0 (default already applied, but be explicit for rows that
--   existed before this migration).
-- is_deleted: false (default already applied, but be explicit).

update public.recordings
set
  teacher_id     = lc.teacher_id,
  title          = lc.title,
  recording_type = 'live_class',
  retry_count    = 0,
  is_deleted     = false
from public.live_classes lc
where public.recordings.class_id = lc.class_id
  and (
    public.recordings.teacher_id is null
    or public.recordings.title is null
    or public.recordings.recording_type is null
  );

-- For any remaining rows that still have a NULL teacher_id or title after the
-- above (for example rows whose class_id is NULL or whose live_classes row was
-- removed), leave them NULL for now. We will NOT invent fallback data — see
-- the NOT NULL validation below. If these columns cannot be populated safely,
-- the migration must report the problem rather than write fabricated values.

-- ─── 3. Backfill validation before NOT NULL ──────────────────────────────────

-- Before setting teacher_id NOT NULL, validate that every existing row has a
-- valid teacher_id. If any row still has NULL, the migration must stop and
-- report the problem rather than inventing fallback data.

do $$
declare
  v_null_teacher_id_count integer;
  v_null_title_count      integer;
  v_short_title_count     integer;
begin
  select count(*)
    into v_null_teacher_id_count
  from public.recordings
  where teacher_id is null;

  if v_null_teacher_id_count > 0 then
    raise exception
      'Migration 170 aborted: % recordings row(s) still have NULL teacher_id after backfill. Cannot set teacher_id NOT NULL safely. Investigate recordings rows with NULL class_id or missing live_classes parent.',
      v_null_teacher_id_count;
  end if;

  select count(*)
    into v_null_title_count
  from public.recordings
  where title is null;

  if v_null_title_count > 0 then
    raise exception
      'Migration 170 aborted: % recordings row(s) still have NULL title after backfill. Cannot set title NOT NULL safely. Investigate recordings rows with NULL class_id or missing live_classes parent.',
      v_null_title_count;
  end if;

  select count(*)
    into v_short_title_count
  from public.recordings
  where char_length(title) < 3;

  if v_short_title_count > 0 then
    raise exception
      'Migration 170 aborted: % recordings row(s) have title with char_length < 3 after backfill. Existing application requires title length >= 3. Cannot set title NOT NULL safely.',
      v_short_title_count;
  end if;
end $$;

-- ─── 4. Add title CHECK constraint ───────────────────────────────────────────

-- The intended 065 recordings schema requires:
--   title TEXT NOT NULL
--   CHECK (char_length(title) >= 3)
--
-- Migration 065 expressed the same business rule for live_classes using the
-- constraint name ck_live_classes_title_length. We apply the matching name
-- here: ck_recordings_title_length.
--
-- This is a new CHECK constraint for the new title column, not reconciliation
-- of an existing 005 CHECK constraint, so it belongs in File 2. Production
-- recordings contains 0 rows, so no existing data is affected.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ck_recordings_title_length'
      and conrelid = 'public.recordings'::regclass
  ) then
    alter table public.recordings
      add constraint ck_recordings_title_length
      check (char_length(title) >= 3);
  end if;
end $$;

-- ─── 5. Set required NOT NULL constraints ────────────────────────────────────

alter table public.recordings
  alter column teacher_id   set not null,
  alter column title        set not null,
  alter column recording_type set not null,
  alter column retry_count  set not null,
  alter column is_deleted   set not null;

-- ─── 6. Add required indexes ─────────────────────────────────────────────────

-- teacher_id index (teacher-scoped queries, recordings list, RLS)
create index if not exists idx_recordings_teacher_id
  on public.recordings (teacher_id);

-- batch_id index (batch-scoped queries)
create index if not exists idx_recordings_batch_id
  on public.recordings (batch_id)
  where batch_id is not null;

-- recording_type index (dashboard filters / getRecordings by type)
create index if not exists idx_recordings_recording_type
  on public.recordings (recording_type);

-- ─── 7. Enforce livekit_egress_id uniqueness ────────────────────────────────

-- Add ONLY the UNIQUE constraint. Do not also create a separate partial index
-- on livekit_egress_id because the UNIQUE constraint already creates a unique
-- backing index and enforces uniqueness for non-NULL egress IDs. Multiple
-- NULLs remain valid because the column is nullable and a UNIQUE constraint on
-- a nullable column allows any number of NULL values.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'uq_recordings_livekit_egress_id'
      and conrelid = 'public.recordings'::regclass
  ) then
    alter table public.recordings
      add constraint uq_recordings_livekit_egress_id
      unique (livekit_egress_id);
  end if;
end $$;

-- ─── 8. Add required foreign keys ────────────────────────────────────────────

-- teacher_id → teacher_details(teacher_id)
-- Uses the project's existing guarded-constraint convention (see constraint
-- creation patterns in 073, 080, and the idempotent FK creation in 080
-- Section 5). These constraints are new objects and should not exist before
-- Migration 170, so we create them only when they are missing instead of
-- unconditionally dropping and recreating them.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'fk_recordings_teacher'
      and conrelid = 'public.recordings'::regclass
  ) then
    alter table public.recordings
      add constraint fk_recordings_teacher
      foreign key (teacher_id) references public.teacher_details (teacher_id)
      on delete restrict
      on update restrict;
  end if;
end $$;

-- batch_id → batches(batch_id) ON DELETE SET NULL
-- Nullable FK, so SET NULL is appropriate: removing a batch preserves the
-- recording row but clears its batch association.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'fk_recordings_batch'
      and conrelid = 'public.recordings'::regclass
  ) then
    alter table public.recordings
      add constraint fk_recordings_batch
      foreign key (batch_id) references public.batches (batch_id)
      on delete set null
      on update restrict;
  end if;
end $$;

-- ─── 9. Teacher recording-management RLS policy ─────────────────────────────

-- Add ONLY this policy. Do not create or modify any other recordings policy.
-- Guarded so the migration is safe if the runner ever re-executes this file:
-- PostgreSQL will error on a bare CREATE POLICY if a policy with the same name
-- already exists on the table, so we create it only when it is missing.

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'recordings'
      and policyname = 'Teachers manage their recordings'
  ) then
    create policy "Teachers manage their recordings"
      on public.recordings
      for all
      to authenticated
      using (
        teacher_id in (
          select teacher_id
          from public.teacher_details
          where profile_id = auth.uid()
        )
      )
      with check (
        teacher_id in (
          select teacher_id
          from public.teacher_details
          where profile_id = auth.uid()
        )
      );
  end if;
end $$;

-- ─── 10. Comments for new columns ─────────────────────────────────────────────

comment on column public.recordings.teacher_id is
  'FK to teacher_details. The teacher who owned the live class when the '
  'recording started. Populated from live_classes.teacher_id via class_id '
  'during backfill; used for ownership-based RLS.';

comment on column public.recordings.title is
  'Human-readable recording title. Required, minimum 3 characters. Enforced '
  'by ck_recordings_title_length. Derived from live_classes.title during '
  'backfill for existing rows.';

comment on column public.recordings.description is
  'Optional free-text description for the recording.';

comment on column public.recordings.recording_type is
  'Content nature of the recording: live_class | practice | demo. '
  'Distinct from source_type (live_class | uploaded). Default live_class '
  'for existing rows.';

comment on column public.recordings.livekit_egress_id is
  'LiveKit Egress API identifier. Unique per recording (uq_recordings_'
  'livekit_egress_id). NULL for recordings that were not produced via a '
  'LiveKit Egress session.';

comment on column public.recordings.error_message is
  'Processing or retry failure message. Populated when status indicates a '
  'failure path; cleared on successful retry.';

comment on column public.recordings.retry_count is
  'Number of times the recording pipeline has retried this recording. '
  'Defaults to 0.';

comment on column public.recordings.last_retried_at is
  'UTC timestamp of the most recent retry attempt. NULL until the first '
  'retry.';

comment on column public.recordings.batch_id is
  'Denormalized batch ID for batch-scoped queries. FK to batches(batch_id) '
  'with ON DELETE SET NULL (fk_recordings_batch). Nullable for recordings '
  'not assigned to a batch.';

comment on column public.recordings.playback_url is
  'Cached signed playback URL. May expire — clients should call '
  'getPlaybackUrl() to regenerate if playback fails.';

comment on column public.recordings.thumbnail_url is
  'Cached signed thumbnail URL. May expire — regenerate on demand if needed.';

comment on column public.recordings.is_deleted is
  'Soft-delete flag. FALSE for active recordings; TRUE once the recording '
  'has been soft-deleted by a teacher or admin.';

comment on constraint fk_recordings_teacher on public.recordings is
  'teacher_id references teacher_details(teacher_id). RESTRICT on delete '
  'preserves referential integrity — a teacher record cannot be removed '
  'while recordings reference it.';

comment on constraint fk_recordings_batch on public.recordings is
  'batch_id references batches(batch_id). ON DELETE SET NULL clears the '
  'batch association when a batch is removed, preserving the recording row.';

comment on constraint uq_recordings_livekit_egress_id on public.recordings is
  'LiveKit Egress identifiers are unique per recording. NULLs are allowed '
  'for recordings not produced via LiveKit Egress.';

comment on constraint ck_recordings_title_length on public.recordings is
  'Recording title must be at least 3 characters. Matches the application '
  'contract used by recording creation/editing flows.';

-- ═══════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 170 Recordings Column, FK, Index & RLS Completion
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════
-- VALIDATION QUERIES (run manually after applying the migration)
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. New columns present:
--    select column_name, data_type, is_nullable, column_default
--    from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'recordings'
--      and column_name in (
--        'teacher_id', 'title', 'description', 'recording_type',
--        'livekit_egress_id', 'error_message', 'retry_count',
--        'last_retried_at', 'batch_id', 'playback_url',
--        'thumbnail_url', 'is_deleted'
--      )
--    order by ordinal_position;
--    → Expect all 12 columns present with the types/nullability/defaults above.

-- 2. NOT NULL constraints:
--    select column_name, is_nullable
--    from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'recordings'
--      and column_name in ('teacher_id', 'title', 'recording_type', 'retry_count', 'is_deleted');
--    → Expect is_nullable = 'NO' for all five.

-- 3. Indexes:
--    select indexname, indexdef
--    from pg_indexes
--    where schemaname = 'public'
--      and tablename = 'recordings'
--      and indexname in (
--        'idx_recordings_teacher_id',
--        'idx_recordings_batch_id',
--        'idx_recordings_recording_type'
--      )
--    order by indexname;
--    → Expect exactly the three new non-unique indexes above. The UNIQUE
--      constraint uq_recordings_livekit_egress_id creates its own unique
--      backing index, so there is no separate non-unique idx_recordings_
--      livekit_egress_id object to expect.
--      Existing indexes (idx_recordings_class_id,
--      idx_recordings_institute_status, idx_recordings_status) must still be
--      present and untouched.

-- 4. Constraints created by this migration (new objects):
--    select conname, contype, pg_get_constraintdef(oid)
--    from pg_constraint
--    where conrelid = 'public.recordings'::regclass
--      and conname in (
--        'ck_recordings_title_length',
--        'uq_recordings_livekit_egress_id',
--        'fk_recordings_teacher',
--        'fk_recordings_batch'
--      );
--    → Expect:
--        ck_recordings_title_length            CHECK  (char_length(title) >= 3)
--        uq_recordings_livekit_egress_id      UNIQUE (livekit_egress_id)
--        fk_recordings_teacher                FOREIGN KEY → teacher_details(teacher_id)
--                                             ON DELETE RESTRICT ON UPDATE RESTRICT
--        fk_recordings_batch                  FOREIGN KEY → batches(batch_id)
--                                             ON DELETE SET NULL ON UPDATE RESTRICT

-- 5. Existing constraints untouched:
--    select conname
--    from pg_constraint
--    where conrelid = 'public.recordings'::regclass
--      and conname in (
--        'pk_recordings',
--        'fk_recordings_class',
--        'fk_recordings_institute',
--        'uq_recordings_class_segment',
--        'ck_recordings_duration_seconds',
--        'ck_recordings_file_size_bytes',
--        'ck_recordings_segment_number',
--        'ck_recordings_completed_at',
--        'ck_recordings_status_completed',
--        'ck_recordings_storage_pair',
--        'ck_recordings_storage_or_provider'
--      )
--    order by conname;
--    → Expect all existing 005 constraints still present and unchanged.
--      This migration must not add or drop any of those names.

-- 6. Foreign keys:
--    select conname, pg_get_constraintdef(oid)
--    from pg_constraint
--    where contype = 'f'
--      and conrelid = 'public.recordings'::regclass
--      and conname in ('fk_recordings_teacher', 'fk_recordings_batch');
--    → Expect fk_recordings_teacher → teacher_details(teacher_id) RESTRICT/RESTRICT
--      and fk_recordings_batch → batches(batch_id) SET NULL/RESTRICT.
--      Do NOT expect any new FK referencing recording_status or any enum.

-- 7. RLS policy added (and no other policy modified):
--    select policyname, cmd, qual
--    from pg_policies
--    where schemaname = 'public'
--      and tablename = 'recordings'
--      and policyname = 'Teachers manage their recordings';
--    → Expect exactly one row with FOR ALL, TO authenticated.
--    → Run the same query before and after applying this migration; the delta
--      must be exactly this one policy, with no other recordings policy changed.

-- 8. Enum usage is valid:
--    select recording_type, count(*)
--    from public.recordings
--    group by recording_type
--    order by recording_type;
--    → Expect rows only for values that exist in public.recording_type
--      (live_class, practice, demo). Since 169 added the enum first and this
--      migration references it only after 169 commits, no enum-mismatch error
--      should occur.

-- 9. Backfill sanity (zero-row production contract):
--    select count(*) as recordings_count from public.recordings;
--    → Expect 0 in production. If > 0, re-run the validation block mentally:
--      every row must have a non-NULL teacher_id, a non-NULL title with
--      char_length >= 3, and a valid recording_type. If any row violates
--      that, the migration would have aborted — so a successful migration
--      guarantees the table is in that state.

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK SQL (NOT executed by this migration — copy & run manually only if
-- Migration 170 must be reverted):
--
--   -- 1. Drop the teacher RLS policy (only policy added by this migration)
--   drop policy if exists "Teachers manage their recordings" on public.recordings;
--
--   -- 2. Drop the new CHECK constraint on title
--   alter table public.recordings drop constraint if exists ck_recordings_title_length;
--
--   -- 3. Drop the new foreign keys
--   alter table public.recordings drop constraint if exists fk_recordings_batch;
--   alter table public.recordings drop constraint if exists fk_recordings_teacher;
--
--   -- 4. Drop the new unique constraint on livekit_egress_id
--   alter table public.recordings drop constraint if exists uq_recordings_livekit_egress_id;
--
--   -- 5. Drop the new indexes
--   drop index if exists idx_recordings_recording_type;
--   drop index if exists idx_recordings_batch_id;
--   drop index if exists idx_recordings_teacher_id;
--
--   -- 6. Drop the NOT NULL constraints by setting nullable again
--   alter table public.recordings alter column is_deleted drop not null;
--   alter table public.recordings alter column retry_count drop not null;
--   alter table public.recordings alter column recording_type drop not null;
--   alter table public.recordings alter column title drop not null;
--   alter table public.recordings alter column teacher_id drop not null;
--
--   -- 7. Drop the new columns (idempotent DROP COLUMN IF EXISTS)
--   alter table public.recordings
--     drop column if exists is_deleted,
--     drop column if exists thumbnail_url,
--     drop column if exists playback_url,
--     drop column if exists batch_id,
--     drop column if exists last_retried_at,
--     drop column if exists retry_count,
--     drop column if exists error_message,
--     drop column if exists livekit_egress_id,
--     drop column if exists recording_type,
--     drop column if exists description,
--     drop column if exists title,
--     drop column if exists teacher_id;
--
--   -- 8. Verify recordings is back to its 005/072/080 shape (no new columns):
--   --    select column_name
--   --    from information_schema.columns
--   --    where table_schema = 'public'
--   --      and table_name = 'recordings'
--   --    order by ordinal_position;
--   --    → Expect exactly the pre-170 column set (no teacher_id/title/etc.).
--
--   -- 9. RLS policies must be restored to their pre-170 state manually if
--   --      this migration was the first to add any policy (this file only
--   --      adds one policy; it does not touch existing ones).
--
--   -- NOTE: Migration 169 (enum foundation) is NOT reverted by this rollback.
--   --       Enum values cannot be removed in PostgreSQL; permanent_delete on
--   --       audit_action_type is the same class of harmless leftover.
-- ═══════════════════════════════════════════════════════════════════════════════
