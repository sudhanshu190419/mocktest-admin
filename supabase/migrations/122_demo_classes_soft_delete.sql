-- ============================================================================
-- Migration: 122 — Demo Classes Soft Delete & Recycle Bin Integration
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Adds enterprise soft-delete (deleted_at, deleted_by, delete_reason) to
-- public.demo_classes and updates Student RLS & Storage RLS policies to
-- ensure soft-deleted videos are immediately excluded from active student feeds.
-- ============================================================================

-- 1. Add soft-delete columns
alter table public.demo_classes
  add column if not exists deleted_at timestamptz null default null,
  add column if not exists deleted_by uuid null default null,
  add column if not exists delete_reason text null default null;

-- 2. Add foreign key for deleted_by
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'fk_demo_classes_deleted_by' and conrelid = 'public.demo_classes'::regclass
  ) then
    alter table public.demo_classes
      add constraint fk_demo_classes_deleted_by
      foreign key (deleted_by) references public.profiles (profile_id)
      on delete set null
      on update cascade;
  end if;
end $$;

-- 3. Indexes for soft-delete queries
create index if not exists idx_demo_classes_deleted_at
  on public.demo_classes (institute_id, deleted_at desc)
  where deleted_at is not null;

-- 4. Update Student RLS policy on demo_classes
drop policy if exists "Students can read published demo classes" on public.demo_classes;

create policy "Students can read published demo classes"
  on public.demo_classes
  for select
  to authenticated
  using (
    institute_id = public.get_my_institute_id()
    and status = 'published'::public.demo_class_status
    and deleted_at is null
  );

comment on policy "Students can read published demo classes" on public.demo_classes is
  'Students can only read published and non-deleted demo classes for their own institute. '
  'Drafts, archived, and soft-deleted demos are never exposed.';

-- 5. Update Student Storage RLS policy on storage.objects for content-videos
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
      where d.storage_bucket = storage.objects.bucket_id
        and d.storage_path = storage.objects.name
        and d.status = 'published'::public.demo_class_status
        and d.deleted_at is null
        and d.institute_id = public.get_my_institute_id()
    )
  );

comment on policy "content_videos_select_demo_student" on storage.objects is
  'Students can read (stream) demo class video files from the private content-videos bucket '
  'only when the file belongs to a published, non-deleted demo class of their own institute.';
