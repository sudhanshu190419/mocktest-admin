-- ============================================================================
-- Migration: 061 — Add Teacher Chapter Insert Policy
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Adds an INSERT policy on public.chapters that allows teachers to create
-- new chapters within their institute's subjects. Previously only admins
-- could insert into the chapters table (via the "Admins have full access
-- to chapters" policy).
--
-- Depends on:
--   Migration 021 (existing admin-only policy on chapters)
--   public.is_teacher(), public.is_admin() (helper functions from 021)
--   public.get_my_institute_id() (helper function from 021)
--
-- The policy verifies that the subject being referenced belongs to the
-- teacher's institute (resolved via subject -> stream -> institute),
-- preventing cross-institute chapter creation.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- Policy: "Teachers can create chapters in their institute"
-- ════════════════════════════════════════════════════════════════════════════
-- Allows teachers (and admins) to insert a chapter into any subject that
-- belongs to their institute. The WITH CHECK clause verifies the subject's
-- stream -> institute chain matches the user's institute.

-- Drop first to make the migration idempotent (safe to re-run).
drop policy if exists "Teachers can create chapters in their institute" on public.chapters;

create policy "Teachers can create chapters in their institute"
  on public.chapters
  for insert
  to authenticated
  with check (
    -- User must be a teacher or admin
    (public.is_teacher() or public.is_admin())
    and
    -- The chapter's subject must belong to the user's institute
    -- Resolves: chapters.subject_id -> subjects.stream_id -> streams.institute_id
    exists (
      select 1 from public.subjects sub
      join public.streams s on s.stream_id = sub.stream_id
      where sub.subject_id = chapters.subject_id
      and s.institute_id = public.get_my_institute_id()
    )
  );
