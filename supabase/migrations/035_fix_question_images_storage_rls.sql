-- ============================================================================
-- Migration: 035 — Fix question-images Storage RLS (SELECT for students)
--
-- PostgreSQL 16 | Supabase Storage Compatible | Production Ready
--
-- Issue:
--   The current Storage SELECT policy `question_images_select_teacher_own`
--   restricts SELECT to `owner = auth.uid()`. Since images are uploaded by
--   teachers, the `owner` column contains the teacher's UUID. When a student
--   (whose `auth.uid()` differs) calls `createSignedUrl()` for a question
--   image, Supabase evaluates the SELECT policy, finds no matching row
--   (student UUID ≠ teacher UUID), and returns "Object not found" (404)
--   instead of the signed URL — even though the object exists in storage.
--
-- Fix:
--   1. Drops the overly restrictive `question_images_select_teacher_own` policy.
--   2. Creates a new SELECT policy that allows any authenticated user who is
--      a student, teacher, or admin to read objects in the `question-images`
--      bucket.
--
-- Why this is safe:
--   - The bucket remains PRIVATE (public = false). Only authenticated users
--     can interact with it.
--   - The table-level RLS on `public.question_images` (migration 021, policy
--     "Students can read images for published questions") already restricts
--     which specific question image database rows a student can query:
--       bucket_id = 'question-images'
--       AND institute_id = current_user's institute
--       AND question is published
--     The Storage-level policy does NOT need to duplicate this logic.
--   - INSERT/UPDATE/DELETE policies are completely untouched — teachers and
--     admins retain exclusive upload/edit/delete access.
--   - `createSignedUrl()` produces a time-limited URL (default 300s) which
--     further limits exposure.
--
-- Depends on:
--   Migration 022 (storage buckets and base policies)
--   Migration 021 (helper functions: public.is_student(), public.is_teacher(),
--                   public.is_admin())
--
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 0 — Ensure the `question-images` bucket exists with correct config
-- ════════════════════════════════════════════════════════════════════════════
-- The bucket was likely created manually (it is NOT in migration 022).
-- This ensures it exists and has the expected private, image-only config
-- in all environments.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types, avif_autodetection)
values ('question-images', 'question-images', false, 10485760, array[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'
], false)
on conflict (id) do nothing;

update storage.buckets
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'],
    avif_autodetection = false
where id = 'question-images';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Drop the restrictive owner-only SELECT policy
-- ════════════════════════════════════════════════════════════════════════════
-- This policy was causing createSignedUrl() to return 404 for any user who
-- is not the storage object owner (i.e., any student).

drop policy if exists "question_images_select_teacher_own" on storage.objects;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Create an inclusive SELECT policy for all authenticated roles
-- ════════════════════════════════════════════════════════════════════════════
-- Allows SELECT for:
--   - The uploader (teacher/admin matching owner = auth.uid())
--   - Any authenticated student (public.is_student())
--   - Any authenticated teacher (public.is_teacher())
--   - Any authenticated admin (public.is_admin())
--
-- This is intentionally not open to `to public` (anonymous users cannot read).
-- Fine-grained access control is enforced at the table level on
-- `public.question_images` (see migration 021, section 7d).

create policy "question_images_select_authenticated"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'question-images'
    and (
      owner = auth.uid()
      or public.is_student()
      or public.is_teacher()
      or public.is_admin()
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 035 Fix question-images Storage RLS
-- ════════════════════════════════════════════════════════════════════════════
