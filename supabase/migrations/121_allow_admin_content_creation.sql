-- ============================================================================
-- Migration: 121 — Allow Super Admin and Academic Admin Content Creation
-- Description:
--   1. Adds `created_by` column to `public.content` referencing `profiles(profile_id)`.
--   2. Makes `public.content.teacher_id` nullable for admin-created content.
--   3. Backfills `created_by` for all existing content rows from `teacher_details`.
--   4. Updates column comments.
-- ============================================================================

-- 1. Add created_by column
alter table public.content
  add column if not exists created_by uuid null;

-- Add foreign key constraint if not exists
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'fk_content_created_by' and conrelid = 'public.content'::regclass
  ) then
    alter table public.content
      add constraint fk_content_created_by
      foreign key (created_by) references public.profiles (profile_id)
      on delete set null
      on update cascade;
  end if;
end $$;

-- 2. Make teacher_id nullable
alter table public.content
  alter column teacher_id drop not null;

-- 3. Backfill created_by for existing rows from teacher_details
update public.content c
set created_by = td.profile_id
from public.teacher_details td
where c.teacher_id = td.teacher_id
  and c.created_by is null;

-- 4. Create index on created_by for efficient queries
create index if not exists idx_content_created_by
  on public.content (created_by);

-- 5. Column comments
comment on column public.content.teacher_id is
  'Optional authoring faculty/teacher in teacher_details. Nullable for admin-created content.';

comment on column public.content.created_by is
  'Profile ID of the authenticated user (teacher or admin) who created this content record.';
