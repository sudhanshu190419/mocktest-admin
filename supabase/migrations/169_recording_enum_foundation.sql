-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 169 — Recording Enum Foundation
--
-- Creates the two recording enum types required by the existing Recorded
-- Classes application code, and adds the two missing values to the existing
-- public.recording_status enum.
--
-- ## Why this migration exists
--
-- Migration 065 (065_create_recordings_table.sql) was intended to create both
-- enums, but its `create table if not exists public.recordings` was a NO-OP
-- against the recordings table created by migration 005, and the migration then
-- aborted at `create index ... on public.recordings (teacher_id, status)`.
-- Because the migration runner executes each migration file inside a single
-- transaction, the entire file rolled back — including its two CREATE TYPE
-- statements.
--
-- Live production therefore has:
--   • no public.recording_type          (required by the recordingService inserts)
--   • no public.recording_source_type   (required by uploadRecording)
--   • public.recording_status containing only
--     ('queued','processing','completed','failed')
--     i.e. missing 'recording' and 'partial', both of which the application reads.
--
-- ## Scope — enum foundation ONLY
--
-- This file is deliberately limited to enum DDL. It must not (and does not):
--   • add, alter, or drop any column
--   • add defaults, CHECK constraints, foreign keys, indexes, or RLS policies
--   • modify the existing recording_status default or any existing constraint
--   • alter any existing table
--   • reference any newly added enum value (see the transaction note below)
--
-- ## Transactional safety
--
-- The runner wraps each migration file in a single transaction. PostgreSQL
-- permits ALTER TYPE ... ADD VALUE inside a transaction block, but the new
-- value may not be USED until that transaction commits. This file therefore
-- references none of the newly added values — the same convention used by
-- migrations 047/054/055/076/080/115/117/133, which all keep enum value
-- additions standalone.
--
-- The dependent work (missing columns, defaults, CHECK reconciliation, foreign
-- keys, indexes, RLS) belongs in a LATER migration that runs only after this
-- one has committed.
--
-- ## Depends on
--
--   Migration 002 — public.recording_status enum
--   Migration 005 — public.recordings table (live-class schema)
--   Migration 065 — enum definitions that never applied (see above)
--   Migration 072 — recording_source_type intent that never applied
--
-- ## Idempotency
--
--   • CREATE TYPE is guarded by a duplicate_object exception handler
--   • ALTER TYPE ... ADD VALUE IF NOT EXISTS
--   Re-running this file is a no-op.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. public.recording_type ─────────────────────────────────────────────────
-- Content nature of a recording. Expected by:
--   recordingService.startRecording  → recording_type: input.recordingType ?? 'live_class'
--   recordingService.uploadRecording → recording_type: input.recordingType ?? 'live_class'
--   mapRecording()                   → recordingType: db.recording_type
--   getRecordings()                  → .eq('recording_type', filters.recordingType)

do $$ begin
  create type public.recording_type as enum ('live_class', 'practice', 'demo');
exception
  when duplicate_object then null;
end $$;

-- ─── 2. public.recording_source_type ──────────────────────────────────────────
-- Origin of a recording (live class vs uploaded file). Distinct from
-- recording_type, which describes content nature. Expected by:
--   recordingService.uploadRecording → source_type: 'uploaded'
--   mapRecording()                   → sourceType: db.source_type

do $$ begin
  create type public.recording_source_type as enum ('live_class', 'uploaded');
exception
  when duplicate_object then null;
end $$;

-- ─── 3. public.recording_status — add the two missing values ──────────────────
-- Standalone single statements (no surrounding DO block), matching the
-- convention in migrations 076/080/133. Appending to an enum preserves the sort
-- order of all existing values, so no existing row or comparison changes.
--
--   'recording' — written by recordingService.startRecording / retryRecording;
--                 read by stopRecording, getRecordingStatus, the teacher
--                 recordings-list status filter, recording-timeout and
--                 live-class-watchdog.
--   'partial'   — read by the teacher recordings-list status filter and included
--                 in the RecordingStatus union. No writer exists yet.

alter type public.recording_status add value if not exists 'recording';
alter type public.recording_status add value if not exists 'partial';

-- ═══════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 169 Recording Enum Foundation
-- ═══════════════════════════════════════════════════════════════════════════════
