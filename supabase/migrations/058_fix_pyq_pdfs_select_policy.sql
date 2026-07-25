-- ============================================================================
-- Migration: 058 — Fix pyq-pdfs SELECT RLS Policy
--
-- PostgreSQL 16 | Supabase Storage Compatible | Idempotent
--
-- Updates the `pyq_pdfs_select_authenticated` policy on storage.objects
-- to allow ALL authenticated users (teachers, students, admins) to SELECT
-- objects in the `pyq-pdfs` bucket.
--
-- ## Why this change is needed
--
-- The original policy restricted SELECT to `owner = auth.uid()`, which means
-- only the teacher who uploaded the PDF could read it. However, both
-- `supabase.storage.from('pyq-pdfs').list()` and `createSignedUrl()` require
-- SELECT permission on the storage.objects rows.
--
-- Students need to:
--   1. `list()` the folder contents to verify the PDF exists
--   2. Call `createSignedUrl()` to generate a temporary download URL
--
-- Since PYQ PDF access is already gated at the application layer via the
-- `student_pyq_purchases` table, the storage-level policy can safely allow
-- all authenticated users to SELECT objects. The bucket itself remains
-- private — anonymous users cannot access it.
--
-- ## What is NOT changed
--
-- All other policies remain untouched:
--   - `pyq_pdfs_insert_teacher`  — unchanged (INSERT: teachers/admins only)
--   - `pyq_pdfs_update_own`      — unchanged (UPDATE: owner only)
--   - `pyq_pdfs_delete_own`      — unchanged (DELETE: owner only)
--   - `pyq_pdfs_admin_all`       — unchanged (ALL: admins only)
--
-- Idempotent — safe to run multiple times.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- Fix: pyq_pdfs SELECT policy — allow all authenticated users
-- ════════════════════════════════════════════════════════════════════════════
-- Old policy: (bucket_id = 'pyq-pdfs' and owner = auth.uid())
--   → Only the uploading teacher can SELECT. Blocks students from listing
--     or generating signed URLs.
--
-- New policy: (bucket_id = 'pyq-pdfs')
--   → Any authenticated user (teacher, student, admin) can SELECT.
--     Access is controlled by the application layer (student_pyq_purchases).
-- ============================================================================

drop policy if exists "pyq_pdfs_select_authenticated" on storage.objects;

create policy "pyq_pdfs_select_authenticated"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'pyq-pdfs');

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 058 Fix pyq-pdfs SELECT RLS Policy
-- ════════════════════════════════════════════════════════════════════════════
