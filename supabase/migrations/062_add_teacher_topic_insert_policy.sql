-- ============================================================================
-- Migration: 062 — Add Teacher Topic Insert Policy
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Adds an INSERT policy on public.topics that allows teachers to create
-- new topics within their institute's chapters. Previously only admins
-- could insert into the topics table (via the "Admins have full access
-- to topics" policy).
--
-- Depends on:
--   Migration 021 (existing admin-only policy on topics)
--   public.is_teacher(), public.is_admin() (helper functions from 021)
--   public.get_my_institute_id() (helper function from 021)
--
-- The policy verifies that the chapter being referenced belongs to the
-- teacher's institute (resolved via chapter -> subject -> stream -> institute),
-- preventing cross-institute topic creation.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- Policy: "Teachers can create topics in their institute"
-- ════════════════════════════════════════════════════════════════════════════
-- Allows teachers (and admins) to insert a topic into any chapter that
-- belongs to their institute. The WITH CHECK clause verifies the chapter's
-- subject -> stream -> institute chain matches the user's institute.

-- Drop first to make the migration idempotent (safe to re-run).
drop policy if exists "Teachers can create topics in their institute" on public.topics;

create policy "Teachers can create topics in their institute"
  on public.topics
  for insert
  to authenticated
  with check (
    -- User must be a teacher or admin
    (public.is_teacher() or public.is_admin())
    and
    -- The topic's chapter must belong to the user's institute
    -- Resolves: topics.chapter_id -> chapters.subject_id -> subjects.stream_id -> streams.institute_id
    exists (
      select 1 from public.chapters ch
      join public.subjects sub on sub.subject_id = ch.subject_id
      join public.streams s on s.stream_id = sub.stream_id
      where ch.chapter_id = topics.chapter_id
      and s.institute_id = public.get_my_institute_id()
    )
  );
