-- ============================================================================
-- Migration: 064 — Add Teacher Stream Insert Policy
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Adds an INSERT policy on public.streams that allows teachers to create
-- new streams within their institute. Previously only admins could insert
-- into the streams table (via the "Admins have full access to streams"
-- policy).
--
-- Depends on:
--   Migration 021 (existing admin-only policy on streams)
--   public.is_teacher(), public.is_admin() (helper functions from 021)
--   public.get_my_institute_id() (helper function from 021)
--
-- The stream table has a direct institute_id column, so the policy simply
-- verifies that the new stream's institute matches the user's institute.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- Policy: "Teachers can create streams in their institute"
-- ════════════════════════════════════════════════════════════════════════════
-- Allows teachers (and admins) to insert a stream that belongs to their
-- institute. The WITH CHECK clause verifies the stream's institute_id
-- matches the user's institute via get_my_institute_id().

-- Drop first to make the migration idempotent (safe to re-run).
drop policy if exists "Teachers can create streams in their institute" on public.streams;

create policy "Teachers can create streams in their institute"
  on public.streams
  for insert
  to authenticated
  with check (
    -- User must be a teacher or admin
    (public.is_teacher() or public.is_admin())
    and
    -- The stream must belong to the user's institute
    institute_id = public.get_my_institute_id()
  );
