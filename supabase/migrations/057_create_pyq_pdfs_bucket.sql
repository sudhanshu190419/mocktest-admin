-- ============================================================================
-- Migration: 057 — PYQ PDFs Storage Bucket
--
-- PostgreSQL 16 | Supabase Storage Compatible | Production Ready
--
-- Creates the 'pyq-pdfs' storage bucket and duplicates all RLS policies
-- from the existing 'content-pdfs' bucket so that PYQ paper PDFs (question
-- papers and solutions) can be uploaded and managed with the same access
-- control model as content PDFs.
--
-- Depends on:
--   Migration 022 (storage configuration — parent bucket and policy patterns)
--   Existing helper functions: public.is_admin(), public.is_teacher()
--   Supabase auth.uid() and auth.role() (built-in)
--
-- Idempotent — safe to run multiple times:
--   - Bucket creation uses ON CONFLICT DO NOTHING + UPDATE to sync config
--   - Policies use DROP POLICY IF EXISTS before creation
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Create Bucket: pyq-pdfs
-- ════════════════════════════════════════════════════════════════════════════
-- Private bucket storing PYQ question paper PDFs and solution PDFs uploaded
-- by teachers. Mirrors the content-pdfs bucket configuration exactly.
--
-- Folder structure (defined in config/storage.ts):
--   institutes/{instituteId}/pyq-packages/{packageId}/papers/{paperId}/question-paper.pdf
--   institutes/{instituteId}/pyq-packages/{packageId}/papers/{paperId}/solution.pdf
--
-- Max file size: 100 MB (same as content-pdfs)
-- Allowed types: PDF only
-- Access control: Managed by RLS policies below; actual downloads go through
--   signed URLs (generated server-side via generateSignedUrl).
-- ════════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types, avif_autodetection)
values ('pyq-pdfs', 'pyq-pdfs', false, 104857600, array[
  'application/pdf'
], false)
on conflict (id) do nothing;

update storage.buckets
set public = false,
    file_size_limit = 104857600,
    allowed_mime_types = array['application/pdf'],
    avif_autodetection = false
where id = 'pyq-pdfs';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — RLS Policies for: pyq-pdfs
-- ════════════════════════════════════════════════════════════════════════════
-- These policies exactly mirror the content-pdfs policies from migration 022,
-- adapted only to target the 'pyq-pdfs' bucket_id.
--
-- Permissions model:
--   SELECT:  Authenticated users can only read objects they own (uploaded).
--            Students access PDFs via server-generated signed URLs, not direct
--            SELECT — this policy is intentionally restrictive.
--   INSERT:  Teachers and admins only; owner must match auth.uid().
--   UPDATE:  Owner can update own objects; admins can update all.
--   DELETE:  Owner can delete own objects; admins can delete all.
--   ADMIN:   Admins have full access (ALL) on all objects in the bucket.
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists "pyq_pdfs_select_authenticated" on storage.objects;
drop policy if exists "pyq_pdfs_insert_teacher" on storage.objects;
drop policy if exists "pyq_pdfs_update_own" on storage.objects;
drop policy if exists "pyq_pdfs_delete_own" on storage.objects;
drop policy if exists "pyq_pdfs_admin_all" on storage.objects;

-- ── SELECT: Owner can read own uploads ─────────────────────────────────────
-- Students and other users access PYQ PDFs via server-generated signed URLs,
-- which bypass RLS. Direct SELECT is restricted to the uploading user.
create policy "pyq_pdfs_select_authenticated"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'pyq-pdfs' and owner = auth.uid());

-- ── INSERT: Teachers and admins can upload ─────────────────────────────────
-- Owner is automatically set to auth.uid() by Supabase.
create policy "pyq_pdfs_insert_teacher"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'pyq-pdfs'
    and (public.is_teacher() or public.is_admin())
    and owner = auth.uid()
  );

-- ── UPDATE: Owner can update own uploads ───────────────────────────────────
create policy "pyq_pdfs_update_own"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'pyq-pdfs' and owner = auth.uid())
  with check (bucket_id = 'pyq-pdfs' and owner = auth.uid());

-- ── DELETE: Owner can delete own uploads ───────────────────────────────────
create policy "pyq_pdfs_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'pyq-pdfs' and owner = auth.uid());

-- ── ADMIN: Admins have full access ────────────────────────────────────────
create policy "pyq_pdfs_admin_all"
  on storage.objects
  for all
  to authenticated
  using (bucket_id = 'pyq-pdfs' and public.is_admin())
  with check (bucket_id = 'pyq-pdfs' and public.is_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 057 PYQ PDFs Storage Bucket
-- ════════════════════════════════════════════════════════════════════════════
