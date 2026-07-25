-- ============================================================================
-- Migration: 060 — Add Teacher Subject Insert Policy
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Adds an INSERT policy on public.subjects that allows teachers to create
-- new subjects within their institute's streams. Previously only admins
-- could insert into the subjects table (via the "Admins have full access
-- to subjects" policy).
--
-- Depends on:
--   Migration 021 (existing admin-only policy on subjects)
--   public.is_teacher(), public.is_admin() (helper functions from 021)
--   public.get_my_institute_id() (helper function from 021)
--
-- The policy verifies that the stream being referenced belongs to the
-- teacher's institute, preventing cross-institute subject creation.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- Policy: "Teachers can create subjects in their institute"
-- ════════════════════════════════════════════════════════════════════════════
-- Allows teachers (and admins) to insert a subject into any stream that
-- belongs to their institute. The WITH CHECK clause verifies the stream's
-- institute matches the user's institute via get_my_institute_id().

-- Drop first to make the migration idempotent (safe to re-run).
drop policy if exists "Teachers can create subjects in their institute" on public.subjects;

create policy "Teachers can create subjects in their institute"
  on public.subjects
  for insert
  to authenticated
  with check (
    -- User must be a teacher or admin
    (public.is_teacher() or public.is_admin())
    and
    -- The subject's stream must belong to the user's institute
    exists (
      select 1 from public.streams s
      where s.stream_id = subjects.stream_id
      and s.institute_id = public.get_my_institute_id()
    )
  );
