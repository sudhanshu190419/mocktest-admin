-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 024: Storage Policies for question-images Bucket
--
-- Adds the `question-images` bucket and its Storage-level RLS policies,
-- following the exact same pattern established by the other teacher-uploaded
-- asset buckets (mock-test-assets, content-pdfs, recordings, etc.) in
-- migration 022.
--
-- ## Design Principles (from 022)
--
-- - Policies use ONLY bucket_id, owner, and role helper functions
-- - No path-parsing, no business logic joins, no custom helper functions
-- - owner = auth.uid() is the sole ownership check
-- - public.is_teacher() / public.is_admin() for role checks
-- - Fully qualified public.* helper references to avoid search_path issues
--   in the storage schema context
-- - Idempotent: DROP POLICY IF EXISTS, INSERT ON CONFLICT DO NOTHING
--
-- ## Bucket
--
-- Stores question stem images, explanation images, and option images.
-- Private — access controlled by signed URLs and storage policies.
-- Folder structure: questions/{instituteId}/{questionId}/.../{filename}
-- Max file size: 10 MB
-- Allowed types: JPEG, PNG, WebP, GIF, SVG
--
-- ## Policies
--
-- Teachers:  Full CRUD on their own uploads (owner = auth.uid())
-- Admins:    Full access to all objects in the bucket
-- Students:  No direct SELECT — access via signed URLs
--
-- Dependencies:
--   Migration 022 (established helper functions: public.is_admin(),
--                  public.is_teacher())
--   Supabase auth.uid() (built-in)
--
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
--  1. CREATE / UPDATE BUCKET
-- ═══════════════════════════════════════════════════════════════════════════
-- Idempotent: if the bucket already exists, configuration is updated.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types, avif_autodetection)
VALUES ('question-images', 'question-images', FALSE, 10485760, ARRAY[
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml'
], FALSE)
ON CONFLICT (id) DO NOTHING;

UPDATE storage.buckets
SET public = FALSE,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY[
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/svg+xml'
    ],
    avif_autodetection = FALSE
WHERE id = 'question-images';


-- ═══════════════════════════════════════════════════════════════════════════
--  2. DROP OLD POLICIES (complex business-logic version)
-- ═══════════════════════════════════════════════════════════════════════════
-- These were introduced in the initial draft of this migration and used
-- path-parsing helper functions and table joins. They are being replaced
-- by the simple owner + role pattern consistent with all other buckets.

DROP POLICY IF EXISTS "Teachers can select question images within their institute" ON storage.objects;
DROP POLICY IF EXISTS "Admins can select all question images" ON storage.objects;
DROP POLICY IF EXISTS "Students can select question images for published questions" ON storage.objects;
DROP POLICY IF EXISTS "Teachers can insert images for own draft questions" ON storage.objects;
DROP POLICY IF EXISTS "Admins can insert question images" ON storage.objects;
DROP POLICY IF EXISTS "Teachers can update own images for draft questions" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update question images" ON storage.objects;
DROP POLICY IF EXISTS "Teachers can delete own images for draft questions" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete question images" ON storage.objects;


-- ═══════════════════════════════════════════════════════════════════════════
--  3. DROP PATH-PARSING HELPER FUNCTIONS (no longer needed)
-- ═══════════════════════════════════════════════════════════════════════════
-- These were introduced alongside the old complex policies. The new
-- simplified policies use only bucket_id, owner, and public.* helpers,
-- so these storage schema functions are unnecessary.

DROP FUNCTION IF EXISTS storage.get_institute_id_from_path(path text);
DROP FUNCTION IF EXISTS storage.get_question_id_from_path(path text);


-- ═══════════════════════════════════════════════════════════════════════════
--  4. ENABLE RLS ON storage.objects
-- ═══════════════════════════════════════════════════════════════════════════
-- If RLS is already enabled, this is a no-op. Defensive check to ensure
-- the storage.objects table has RLS active.

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;


-- ═══════════════════════════════════════════════════════════════════════════
--  5. NEW RLS POLICIES for question-images
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Pattern matched exactly from mock-test-assets (migration 022, section 2g):
--   - Row-level ownership via `owner = auth.uid()`
--   - Role checks via `public.is_teacher()` / `public.is_admin()`
--   - Fully qualified helper names (`public.*`) for storage schema safety
--
-- Policy naming convention: {bucket}_{operation}_{scope}
--
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 5a. SELECT (Download / Read) ─────────────────────────────────────────
-- Teachers: can read their own uploaded images.
-- Admins:  can read all images (via admin_all policy).

CREATE POLICY "question_images_select_teacher_own"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'question-images' AND owner = auth.uid());


-- ── 5b. INSERT (Upload) ───────────────────────────────────────────────────
-- Teachers: can upload when authenticated as teacher or admin.
-- Owner is set to auth.uid() automatically by Storage.

CREATE POLICY "question_images_insert_teacher"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'question-images'
    AND (public.is_teacher() OR public.is_admin())
    AND owner = auth.uid()
  );


-- ── 5c. UPDATE (Replace file / modify metadata) ───────────────────────────
-- Teachers: can update their own uploads.
-- Admins:   can update all images (via admin_all policy).

CREATE POLICY "question_images_update_own"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'question-images' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'question-images' AND owner = auth.uid());


-- ── 5d. DELETE ─────────────────────────────────────────────────────────────
-- Teachers: can delete their own uploads.
-- Admins:   can delete all images (via admin_all policy).

CREATE POLICY "question_images_delete_own"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'question-images' AND owner = auth.uid());


-- ── 5e. ADMIN ALL ──────────────────────────────────────────────────────────
-- Admins have full CRUD on all objects in the bucket regardless of owner.

CREATE POLICY "question_images_admin_all"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (bucket_id = 'question-images' AND public.is_admin())
  WITH CHECK (bucket_id = 'question-images' AND public.is_admin());


-- ═══════════════════════════════════════════════════════════════════════════
--  Migration complete — 024_storage_rls_question_images.sql
-- ═══════════════════════════════════════════════════════════════════════════
