-- ============================================================================
-- Migration: 107 — Demo Class Video Storage RLS
--
-- PostgreSQL 16 | Supabase Storage Compatible | Idempotent
--
-- ## Problem
--
-- `content-videos` is a PRIVATE bucket. Its only SELECT policies are:
--   - `content_videos_select_teacher_own`  → owner = auth.uid() (uploader only)
--   - `content_videos_admin_all`           → admins only
--
-- Students have NO SELECT permission on any `content-videos` object, and
-- Supabase Storage's `createSignedUrl()` enforces the same storage RLS as a
-- direct read. When the caller lacks SELECT permission, Storage returns
-- `404 Object not found` (deliberately, to avoid leaking object existence).
--
-- Result: the student app cannot generate a signed URL for a published
-- demo-class video, even though the object exists and the path is correct.
--
-- ## Fix
--
-- Add ONE narrowly scoped SELECT policy on storage.objects that permits
-- students to read ONLY objects that are the video of a PUBLISHED demo
-- class belonging to the student's own institute:
--
--   storage.objects.name == demo_classes.storage_path
--   AND demo_classes.status = 'published'
--   AND demo_classes.institute_id = public.get_my_institute_id()
--
-- The EXISTS subquery is evaluated under the invoking user's own RLS on
-- `public.demo_classes` (whose student SELECT policy already requires
-- published + own institute), so this is defense in depth, not a bypass.
--
-- ## What is NOT changed
--
--   - `content_videos_select_teacher_own` — unchanged (owner SELECT)
--   - `content_videos_insert_teacher`     — unchanged (teacher/admin INSERT)
--   - `content_videos_update_own`         — unchanged (owner UPDATE)
--   - `content_videos_delete_own`         — unchanged (owner DELETE)
--   - `content_videos_admin_all`          — unchanged (admin ALL)
--   - All premium course videos, recordings, and PYQ files stay protected
--     because they are not referenced by any `demo_classes` row.
--   - Migration 106 (`demo_classes`) is NOT modified.
--   - No service-role credentials. No application code changes.
--
-- Idempotent — safe to run multiple times.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- Demo-class video SELECT policy — students may sign ONLY published demos
-- of their own institute (path matched exactly against demo_classes).
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists "content_videos_select_demo_student" on storage.objects;

create policy "content_videos_select_demo_student"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'content-videos'
    and exists (
      select 1
      from public.demo_classes d
      where d.storage_bucket = 'content-videos'
        and d.storage_path = name
        and d.status = 'published'::public.demo_class_status
        and d.institute_id = public.get_my_institute_id()
    )
  );

comment on policy "content_videos_select_demo_student" on storage.objects is
  'Students can SELECT (and therefore sign URLs for) content-videos objects '
  'only when the object is the exact storage_path of a PUBLISHED demo class '
  'for their own institute. Drafts, archived demos, and all premium course '
  'videos remain inaccessible to students.';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 107 Demo Class Video Storage RLS
-- ════════════════════════════════════════════════════════════════════════════
