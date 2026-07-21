-- ============================================================================
-- Migration: Add room_name column to live_classes
--
-- The `room_name` column was referenced in the application code but was
-- missing from the original Domain 04 migration (005_domain_04_live_learning.sql).
-- This migration adds it if it does not already exist.
--
-- Safe to run even if the column already exists (idempotent).
-- ============================================================================

-- 1a. Add room_name column if it does not exist
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_name = 'live_classes'
      and column_name = 'room_name'
  ) then
    alter table public.live_classes
      add column room_name varchar(500) null default null;

    comment on column public.live_classes.room_name is
      'LiveKit room name for this class. Set when the class goes live. '
      'Pattern: class-{class_id_prefix}. Deterministic from class_id.';
  end if;
end $$;

-- 1b. Add index on room_name for lookup (useful for student join by room name)
do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where tablename = 'live_classes'
      and indexname = 'idx_live_classes_room_name'
  ) then
    create index idx_live_classes_room_name
      on public.live_classes (room_name)
      where room_name is not null;
  end if;
end $$;
