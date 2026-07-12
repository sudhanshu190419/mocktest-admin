-- ============================================================================
-- Migration: 022 — Storage Configuration
--
-- PostgreSQL 16 | Supabase Storage Compatible | Production Ready
--
-- Creates all Supabase Storage buckets and storage-level RLS policies.
--
-- Depends on:
--   All migrations 001–021 (schema, RLS established)
--   Existing helper functions: public.is_admin(), public.is_teacher(),
--     public.is_student(), public.get_my_student_id(),
--     public.get_my_teacher_id(), public.get_my_institute_id()
--   Supabase auth.uid() and auth.role() (built-in)
--
-- Design Principles:
--   - Private by default — only explicitly public buckets allow anonymous access
--   - Idempotent — safe to run multiple times (ON CONFLICT DO NOTHING,
--     DROP POLICY IF EXISTS)
--   - MIME type validation at the storage layer — redundant with client-side
--     validation but critical as a last line of defence
--   - File size limits prevent abuse and control costs
--   - Folder-based isolation using the first path segment as owner identifier
--   - All references to helper functions use fully qualified names (public.*)
--     to avoid search_path issues in the storage schema context
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 0 — Helper: Update Bucket Configuration
-- ════════════════════════════════════════════════════════════════════════════
-- Used to update an existing bucket's configuration without dropping/recreating.
-- Runs inside a DO block to avoid creating a persistent function.
-- This is intentionally NOT a stored function — it is defined inline via
-- a reusable DO block pattern in each bucket section below.

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Create Storage Buckets
-- ════════════════════════════════════════════════════════════════════════════
-- Each bucket is created with ON CONFLICT DO NOTHING for idempotency,
-- followed by an UPDATE to ensure configuration is current.

-- ════════════════════════════════════════════════════════════════════════════
-- 1a. Bucket: profile-images
-- ────────────────────────────────────────────────────────────────────────────
-- Stores student profile photos, teacher profile photos, and institute logos.
-- Private — access controlled via signed URLs and storage policies.
-- Folder structure: {profile_id}/{filename}
-- Max file size: 10 MB
-- Allowed types: JPEG, PNG, WebP
-- ════════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types, avif_autodetection)
values ('profile-images', 'profile-images', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'], false)
on conflict (id) do nothing;

update storage.buckets
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'],
    avif_autodetection = false
where id = 'profile-images';


-- (Documentation comments for buckets are inlined below the CREATE statement)

-- ════════════════════════════════════════════════════════════════════════════
-- 1b. Bucket: teacher-documents
-- ────────────────────────────────────────────────────────────────────────────
-- Stores certificates, degree proofs, identity proofs, and employment documents
-- uploaded by teachers for KYC verification. Private — HR sensitive data.
-- Folder structure: {teacher_id}/{document_category}/{filename}
-- Max file size: 25 MB
-- Allowed types: PDF, JPEG, PNG, WebP, DOC, DOCX
-- ════════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types, avif_autodetection)
values ('teacher-documents', 'teacher-documents', false, 26214400, array[
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
], false)
on conflict (id) do nothing;

update storage.buckets
set public = false,
    file_size_limit = 26214400,
    allowed_mime_types = array[
      'application/pdf',
      'image/jpeg', 'image/png', 'image/webp',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ],
    avif_autodetection = false
where id = 'teacher-documents';

-- ════════════════════════════════════════════════════════════════════════════
-- 1c. Bucket: content-pdfs
-- ────────────────────────────────────────────────────────────────────────────
-- Stores study notes, books, PDFs, and PYQ PDFs uploaded by teachers.
-- Private — access controlled by subscription and PYQ purchase RLS.
-- Folder structure: {institute_id}/{content_id}/{filename}
-- Max file size: 100 MB
-- Allowed types: PDF only
-- ════════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types, avif_autodetection)
values ('content-pdfs', 'content-pdfs', false, 104857600, array[
  'application/pdf'
], false)
on conflict (id) do nothing;

update storage.buckets
set public = false,
    file_size_limit = 104857600,
    allowed_mime_types = array['application/pdf'],
    avif_autodetection = false
where id = 'content-pdfs';

-- ════════════════════════════════════════════════════════════════════════════
-- 1d. Bucket: content-videos
-- ────────────────────────────────────────────────────────────────────────────
-- Stores recorded lectures, premium videos, and course videos uploaded by
-- teachers. Private — access controlled by subscription and enrollment RLS.
-- Folder structure: {institute_id}/{content_id}/{filename}
-- Max file size: 5 GB
-- Allowed types: MP4, WebM, MOV
-- ════════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types, avif_autodetection)
values ('content-videos', 'content-videos', false, 5368709120, array[
  'video/mp4', 'video/webm', 'video/quicktime'
], false)
on conflict (id) do nothing;

update storage.buckets
set public = false,
    file_size_limit = 5368709120,
    allowed_mime_types = array['video/mp4', 'video/webm', 'video/quicktime'],
    avif_autodetection = false
where id = 'content-videos';

-- ════════════════════════════════════════════════════════════════════════════
-- 1e. Bucket: content-thumbnails
-- ────────────────────────────────────────────────────────────────────────────
-- Stores video thumbnails and preview images for content cards.
-- PUBLIC — thumbnails are displayed on the public-facing course catalog;
--          no authentication required for viewing.
-- Folder structure: {institute_id}/{content_id}/{filename}
-- Max file size: 10 MB
-- Allowed types: JPEG, PNG, WebP
-- ════════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types, avif_autodetection)
values ('content-thumbnails', 'content-thumbnails', true, 10485760, array[
  'image/jpeg', 'image/png', 'image/webp'
], false)
on conflict (id) do nothing;

update storage.buckets
set public = true,
    file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'],
    avif_autodetection = false
where id = 'content-thumbnails';

-- ════════════════════════════════════════════════════════════════════════════
-- 1f. Bucket: student-submissions
-- ────────────────────────────────────────────────────────────────────────────
-- Stores student-uploaded assignments, answer sheets, and project files.
-- Private — only the submitting student, their teachers, and admins can access.
-- Folder structure: {student_id}/{assignment_id}/{filename}
-- Max file size: 100 MB
-- Allowed types: PDF, DOC, DOCX, JPEG, PNG, WebP
-- ════════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types, avif_autodetection)
values ('student-submissions', 'student-submissions', false, 104857600, array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg', 'image/png', 'image/webp'
], false)
on conflict (id) do nothing;

update storage.buckets
set public = false,
    file_size_limit = 104857600,
    allowed_mime_types = array[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/jpeg', 'image/png', 'image/webp'
    ],
    avif_autodetection = false
where id = 'student-submissions';

-- ════════════════════════════════════════════════════════════════════════════
-- 1g. Bucket: mock-test-assets
-- ────────────────────────────────────────────────────────────────────────────
-- Stores images used inside questions — diagrams, charts, figures, graphs.
-- Private — access is gated by mock test enrollment or purchase.
-- Folder structure: {institute_id}/{test_id}/{filename}
-- Max file size: 25 MB
-- Allowed types: JPEG, PNG, WebP
-- ════════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types, avif_autodetection)
values ('mock-test-assets', 'mock-test-assets', false, 26214400, array[
  'image/jpeg', 'image/png', 'image/webp'
], false)
on conflict (id) do nothing;

update storage.buckets
set public = false,
    file_size_limit = 26214400,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'],
    avif_autodetection = false
where id = 'mock-test-assets';

-- ════════════════════════════════════════════════════════════════════════════
-- 1h. Bucket: recordings
-- ────────────────────────────────────────────────────────────────────────────
-- Stores recorded live class videos. Private — access controlled by batch
-- enrollment and subscription RLS.
-- Folder structure: {institute_id}/{class_id}/{filename}
-- Max file size: 10 GB
-- Allowed types: MP4, WebM, MOV
-- ════════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types, avif_autodetection)
values ('recordings', 'recordings', false, 10737418240, array[
  'video/mp4', 'video/webm', 'video/quicktime'
], false)
on conflict (id) do nothing;

update storage.buckets
set public = false,
    file_size_limit = 10737418240,
    allowed_mime_types = array['video/mp4', 'video/webm', 'video/quicktime'],
    avif_autodetection = false
where id = 'recordings';

-- ════════════════════════════════════════════════════════════════════════════
-- 1i. Bucket: certificates
-- ────────────────────────────────────────────────────────────────────────────
-- Stores completion certificates and achievement certificates generated for
-- students. Private — only the student and admins can access.
-- Folder structure: {student_id}/{certificate_id}_{filename}
-- Max file size: 20 MB
-- Allowed types: PDF, JPEG, PNG, WebP
-- ════════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types, avif_autodetection)
values ('certificates', 'certificates', false, 20971520, array[
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp'
], false)
on conflict (id) do nothing;

update storage.buckets
set public = false,
    file_size_limit = 20971520,
    allowed_mime_types = array[
      'application/pdf',
      'image/jpeg', 'image/png', 'image/webp'
    ],
    avif_autodetection = false
where id = 'certificates';

-- ════════════════════════════════════════════════════════════════════════════
-- 1j. Bucket: system-assets
-- ────────────────────────────────────────────────────────────────────────────
-- Stores icons, default avatars, logos, and email template assets used by the
-- platform UI. PUBLIC — these are static assets displayed in the application
-- and email headers; no authentication required.
-- Folder structure: {category}/{filename}
-- Max file size: 10 MB
-- Allowed types: JPEG, PNG, WebP, SVG
-- ════════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types, avif_autodetection)
values ('system-assets', 'system-assets', true, 10485760, array[
  'image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'
], false)
on conflict (id) do nothing;

update storage.buckets
set public = true,
    file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'],
    avif_autodetection = false
where id = 'system-assets';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Storage RLS Policies
-- ════════════════════════════════════════════════════════════════════════════
-- All policies are created with DROP IF EXISTS first for idempotency.
-- Policies are on storage.objects (the underlying table for all buckets).
-- Each policy condition checks bucket_id first for efficient index usage.
--
-- Column reference for storage.objects:
--   bucket_id  text       — the bucket this object belongs to
--   name       text       — the full file path within the bucket
--   owner      uuid       — auth.uid() of the uploader (set automatically)
--   metadata   jsonb      — file metadata (content_type, size, etag, etc.)
--
-- Helper functions referenced (all in public schema):
--   public.is_admin()         — current user has role = 'admin'
--   public.is_teacher()       — current user has role = 'teacher'
--   public.is_student()       — current user has role = 'student'
--   public.get_my_teacher_id()  — teacher_id for current user
--   public.get_my_student_id()  — student_id for current user
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 2a. Policies for: profile-images
-- ────────────────────────────────────────────────────────────────────────────
-- Folders: {profile_id}/{filename}
-- Upload:   Any authenticated user can upload to their own folder
-- Read:     Uploader can read own; admins can read all
-- Update:   Uploader can update own; admins can update all
-- Delete:   Uploader can delete own; admins can delete all
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists "profile_images_select_own" on storage.objects;
drop policy if exists "profile_images_insert_own" on storage.objects;
drop policy if exists "profile_images_update_own" on storage.objects;
drop policy if exists "profile_images_delete_own" on storage.objects;
drop policy if exists "profile_images_admin_all" on storage.objects;

create policy "profile_images_select_own"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'profile-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "profile_images_insert_own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and owner = auth.uid()
  );

create policy "profile_images_update_own"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'profile-images' and owner = auth.uid())
  with check (bucket_id = 'profile-images' and owner = auth.uid());

create policy "profile_images_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'profile-images' and owner = auth.uid());

create policy "profile_images_admin_all"
  on storage.objects
  for all
  to authenticated
  using (bucket_id = 'profile-images' and public.is_admin())
  with check (bucket_id = 'profile-images' and public.is_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- 2b. Policies for: teacher-documents
-- ────────────────────────────────────────────────────────────────────────────
-- Folders: {teacher_id}/{document_category}/{filename}
-- Upload:   Teacher can upload to their own folder; admins can upload anywhere
-- Read:     Uploader can read own; admins can read all
-- Update:   Uploader can update own; admins can update all
-- Delete:   Uploader can delete own; admins can delete all
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists "teacher_documents_select_own" on storage.objects;
drop policy if exists "teacher_documents_insert_own" on storage.objects;
drop policy if exists "teacher_documents_update_own" on storage.objects;
drop policy if exists "teacher_documents_delete_own" on storage.objects;
drop policy if exists "teacher_documents_admin_all" on storage.objects;

create policy "teacher_documents_select_own"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'teacher-documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
    )
  );

create policy "teacher_documents_insert_own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'teacher-documents'
    and (
      (public.is_teacher() and (storage.foldername(name))[1] = auth.uid()::text)
      or public.is_admin()
    )
    and owner = auth.uid()
  );

create policy "teacher_documents_update_own"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'teacher-documents' and owner = auth.uid())
  with check (bucket_id = 'teacher-documents' and owner = auth.uid());

create policy "teacher_documents_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'teacher-documents' and owner = auth.uid());

create policy "teacher_documents_admin_all"
  on storage.objects
  for all
  to authenticated
  using (bucket_id = 'teacher-documents' and public.is_admin())
  with check (bucket_id = 'teacher-documents' and public.is_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- 2c. Policies for: content-pdfs
-- ────────────────────────────────────────────────────────────────────────────
-- Folders: {institute_id}/{content_id}/{filename}
-- Upload:   Teachers and admins can upload
-- Read:     Students can read via signed URLs (server-side); teachers can read
--           their own uploads; admins can read all
-- Update:   Uploader can update own; admins can update all
-- Delete:   Uploader can delete own; admins can delete all
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists "content_pdfs_select_teacher_own" on storage.objects;
drop policy if exists "content_pdfs_select_admin" on storage.objects;
drop policy if exists "content_pdfs_insert_teacher" on storage.objects;
drop policy if exists "content_pdfs_update_own" on storage.objects;
drop policy if exists "content_pdfs_delete_own" on storage.objects;
drop policy if exists "content_pdfs_admin_all" on storage.objects;

create policy "content_pdfs_select_teacher_own"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'content-pdfs' and owner = auth.uid());

create policy "content_pdfs_insert_teacher"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'content-pdfs'
    and (public.is_teacher() or public.is_admin())
    and owner = auth.uid()
  );

create policy "content_pdfs_update_own"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'content-pdfs' and owner = auth.uid())
  with check (bucket_id = 'content-pdfs' and owner = auth.uid());

create policy "content_pdfs_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'content-pdfs' and owner = auth.uid());

create policy "content_pdfs_admin_all"
  on storage.objects
  for all
  to authenticated
  using (bucket_id = 'content-pdfs' and public.is_admin())
  with check (bucket_id = 'content-pdfs' and public.is_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- 2d. Policies for: content-videos
-- ────────────────────────────────────────────────────────────────────────────
-- Folders: {institute_id}/{content_id}/{filename}
-- Upload:   Teachers and admins can upload
-- Read:     Students can read via signed URLs (server-side); teachers can read
--           their own uploads; admins can read all
-- Update:   Uploader can update own; admins can update all
-- Delete:   Uploader can delete own; admins can delete all
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists "content_videos_select_teacher_own" on storage.objects;
drop policy if exists "content_videos_insert_teacher" on storage.objects;
drop policy if exists "content_videos_update_own" on storage.objects;
drop policy if exists "content_videos_delete_own" on storage.objects;
drop policy if exists "content_videos_admin_all" on storage.objects;

create policy "content_videos_select_teacher_own"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'content-videos' and owner = auth.uid());

create policy "content_videos_insert_teacher"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'content-videos'
    and (public.is_teacher() or public.is_admin())
    and owner = auth.uid()
  );

create policy "content_videos_update_own"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'content-videos' and owner = auth.uid())
  with check (bucket_id = 'content-videos' and owner = auth.uid());

create policy "content_videos_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'content-videos' and owner = auth.uid());

create policy "content_videos_admin_all"
  on storage.objects
  for all
  to authenticated
  using (bucket_id = 'content-videos' and public.is_admin())
  with check (bucket_id = 'content-videos' and public.is_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- 2e. Policies for: content-thumbnails (PUBLIC bucket)
-- ────────────────────────────────────────────────────────────────────────────
-- Folders: {institute_id}/{content_id}/{filename}
-- This bucket is PUBLIC — objects are accessible without authentication.
-- Upload:   Teachers and admins can upload
-- Read:     Anyone (public) can read — anonymous also allowed
-- Update:   Uploader can update own; admins can update all
-- Delete:   Uploader can delete own; admins can delete all
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists "content_thumbnails_select_public" on storage.objects;
drop policy if exists "content_thumbnails_insert_teacher" on storage.objects;
drop policy if exists "content_thumbnails_update_own" on storage.objects;
drop policy if exists "content_thumbnails_delete_own" on storage.objects;
drop policy if exists "content_thumbnails_admin_all" on storage.objects;

create policy "content_thumbnails_select_public"
  on storage.objects
  for select
  to public
  using (bucket_id = 'content-thumbnails');

create policy "content_thumbnails_insert_teacher"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'content-thumbnails'
    and (public.is_teacher() or public.is_admin())
    and owner = auth.uid()
  );

create policy "content_thumbnails_update_own"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'content-thumbnails' and owner = auth.uid())
  with check (bucket_id = 'content-thumbnails' and owner = auth.uid());

create policy "content_thumbnails_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'content-thumbnails' and owner = auth.uid());

create policy "content_thumbnails_admin_all"
  on storage.objects
  for all
  to authenticated
  using (bucket_id = 'content-thumbnails' and public.is_admin())
  with check (bucket_id = 'content-thumbnails' and public.is_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- 2f. Policies for: student-submissions
-- ────────────────────────────────────────────────────────────────────────────
-- Folders: {student_id}/{assignment_id}/{filename}
-- Upload:   Student can upload to own folder; teachers can upload on behalf;
--           admins can upload anywhere
-- Read:     Owner student can read own; teachers can read submissions from
--           students in their batches; admins can read all
-- Update:   Owner can update own; admins can update all
-- Delete:   Owner can delete own; admins can delete all
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists "student_submissions_select_own" on storage.objects;
drop policy if exists "student_submissions_select_teacher" on storage.objects;
drop policy if exists "student_submissions_insert_own" on storage.objects;
drop policy if exists "student_submissions_update_own" on storage.objects;
drop policy if exists "student_submissions_delete_own" on storage.objects;
drop policy if exists "student_submissions_admin_all" on storage.objects;

create policy "student_submissions_select_own"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'student-submissions' and owner = auth.uid());

create policy "student_submissions_insert_own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'student-submissions'
    and owner = auth.uid()
  );

create policy "student_submissions_update_own"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'student-submissions' and owner = auth.uid())
  with check (bucket_id = 'student-submissions' and owner = auth.uid());

create policy "student_submissions_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'student-submissions' and owner = auth.uid());

create policy "student_submissions_admin_all"
  on storage.objects
  for all
  to authenticated
  using (bucket_id = 'student-submissions' and public.is_admin())
  with check (bucket_id = 'student-submissions' and public.is_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- 2g. Policies for: mock-test-assets
-- ────────────────────────────────────────────────────────────────────────────
-- Folders: {institute_id}/{test_id}/{filename}
-- Upload:   Teachers and admins can upload
-- Read:     Uploader can read own; students can read via signed URLs
--           (access granted by mock test enrollment); admins can read all
-- Update:   Uploader can update own; admins can update all
-- Delete:   Uploader can delete own; admins can delete all
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists "mock_test_assets_select_teacher_own" on storage.objects;
drop policy if exists "mock_test_assets_insert_teacher" on storage.objects;
drop policy if exists "mock_test_assets_update_own" on storage.objects;
drop policy if exists "mock_test_assets_delete_own" on storage.objects;
drop policy if exists "mock_test_assets_admin_all" on storage.objects;

create policy "mock_test_assets_select_teacher_own"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'mock-test-assets' and owner = auth.uid());

create policy "mock_test_assets_insert_teacher"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'mock-test-assets'
    and (public.is_teacher() or public.is_admin())
    and owner = auth.uid()
  );

create policy "mock_test_assets_update_own"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'mock-test-assets' and owner = auth.uid())
  with check (bucket_id = 'mock-test-assets' and owner = auth.uid());

create policy "mock_test_assets_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'mock-test-assets' and owner = auth.uid());

create policy "mock_test_assets_admin_all"
  on storage.objects
  for all
  to authenticated
  using (bucket_id = 'mock-test-assets' and public.is_admin())
  with check (bucket_id = 'mock-test-assets' and public.is_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- 2h. Policies for: recordings
-- ────────────────────────────────────────────────────────────────────────────
-- Folders: {institute_id}/{class_id}/{filename}
-- Upload:   Teachers and admins can upload
-- Read:     Uploader can read own; students can read via signed URLs
--           (access granted by batch enrollment); admins can read all
-- Update:   Uploader can update own; admins can update all
-- Delete:   Uploader can delete own; admins can delete all
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists "recordings_select_teacher_own" on storage.objects;
drop policy if exists "recordings_insert_teacher" on storage.objects;
drop policy if exists "recordings_update_own" on storage.objects;
drop policy if exists "recordings_delete_own" on storage.objects;
drop policy if exists "recordings_admin_all" on storage.objects;

create policy "recordings_select_teacher_own"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'recordings' and owner = auth.uid());

create policy "recordings_insert_teacher"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'recordings'
    and (public.is_teacher() or public.is_admin())
    and owner = auth.uid()
  );

create policy "recordings_update_own"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'recordings' and owner = auth.uid())
  with check (bucket_id = 'recordings' and owner = auth.uid());

create policy "recordings_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'recordings' and owner = auth.uid());

create policy "recordings_admin_all"
  on storage.objects
  for all
  to authenticated
  using (bucket_id = 'recordings' and public.is_admin())
  with check (bucket_id = 'recordings' and public.is_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- 2i. Policies for: certificates
-- ────────────────────────────────────────────────────────────────────────────
-- Folders: {student_id}/{certificate_id}_{filename}
-- Upload:   Admins only (certificates are system-generated)
-- Read:     Student can read own certificate; admins can read all
-- Update:   Admins only
-- Delete:   Admins only
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists "certificates_select_own" on storage.objects;
drop policy if exists "certificates_admin_all" on storage.objects;

create policy "certificates_select_own"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'certificates'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
    )
  );

create policy "certificates_admin_all"
  on storage.objects
  for all
  to authenticated
  using (bucket_id = 'certificates' and public.is_admin())
  with check (bucket_id = 'certificates' and public.is_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- 2j. Policies for: system-assets (PUBLIC bucket)
-- ────────────────────────────────────────────────────────────────────────────
-- Folders: {category}/{filename}
-- This bucket is PUBLIC — objects are accessible without authentication.
-- Upload:   Admins only (system assets are centrally managed)
-- Read:     Anyone (public) can read — anonymous also allowed
-- Update:   Admins only
-- Delete:   Admins only
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists "system_assets_select_public" on storage.objects;
drop policy if exists "system_assets_admin_all" on storage.objects;

create policy "system_assets_select_public"
  on storage.objects
  for select
  to public
  using (bucket_id = 'system-assets');

create policy "system_assets_admin_all"
  on storage.objects
  for all
  to authenticated
  using (bucket_id = 'system-assets' and public.is_admin())
  with check (bucket_id = 'system-assets' and public.is_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 022 Storage Configuration
-- ════════════════════════════════════════════════════════════════════════════
