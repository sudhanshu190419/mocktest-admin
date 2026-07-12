-- ============================================================================
-- Migration: Domain 12 — File & Media Management
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Tables: media_files · media_versions · media_usage · media_processing_jobs
--
-- Depends on: Domain 01 (institutes, profiles)
--             Existing functions (set_updated_at, get_my_institute_id, etc.)
--
-- New enums: media_asset_type · media_status_type · media_access_type ·
--            job_category_type · job_status_type
--
-- Order:
--   1. New Enum Types (idempotent)
--   2. Tables (dependency order: parent → child)
--   3. Indexes (after all tables exist)
--   4. Functions (table-referencing functions for triggers)
--   5. Triggers (after all tables and functions exist)
--   6. Comments
--
-- Reference: Schema_Domain_12_File_&_Media_Management.md v1.0
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — New Enum Types (Idempotent)
-- ════════════════════════════════════════════════════════════════════════════
-- These enums are defined in this domain and used by the media management
-- tables. Each creation is wrapped in an idempotent DO block.

-- 1a. media_asset_type
-- Categorizes the media for UI handling and player selection.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'media_asset_type') then
    create type media_asset_type as enum ('video', 'image', 'document', 'audio', 'archive');
  end if;
end $$;

-- 1b. media_status_type
-- Tracks the lifecycle of the logical media asset.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'media_status_type') then
    create type media_status_type as enum ('pending', 'processing', 'ready', 'failed', 'archived');
  end if;
end $$;

-- 1c. media_access_type
-- Defines storage bucket routing and URL generation rules.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'media_access_type') then
    create type media_access_type as enum ('public', 'private', 'requires_signature');
  end if;
end $$;

-- 1d. job_category_type
-- Classifies the worker queue task for media processing.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'job_category_type') then
    create type job_category_type as enum (
      'video_transcode', 'image_compress', 'pdf_watermark', 'thumbnail_extract'
    );
  end if;
end $$;

-- 1e. job_status_type
-- State machine for asynchronous media processing workers.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'job_status_type') then
    create type job_status_type as enum ('queued', 'running', 'completed', 'failed', 'retrying');
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — CREATE TABLE Statements
-- ════════════════════════════════════════════════════════════════════════════
-- Media management: media_files (logical asset catalog)
--                   media_versions (physical storage pointers, CASCADE from parent)
--                   media_usage (polymorphic junction, RESTRICT on delete)
--                   media_processing_jobs (async job tracking, CASCADE from parent)

-- 2a. Table: media_files
-- Master catalog of all media assets uploaded to the platform.
-- Represents the logical file — the anchor point for permissions, ownership,
-- and tracking, independent of the actual storage bucket or renditions.
-- total_size_bytes is maintained via a trigger on media_versions.
create table public.media_files (
  media_id           uuid               not null  default gen_random_uuid(),
  institute_id       uuid               not null,
  uploaded_by        uuid               not null,
  original_filename  text               not null,
  media_type         media_asset_type   not null,
  status             media_status_type  not null  default 'pending',
  access_level       media_access_type  not null  default 'requires_signature',
  total_size_bytes   bigint             not null  default 0,
  duration_seconds   integer            null      default null,
  is_active          boolean            not null  default true,
  created_at         timestamptz        not null  default now(),
  updated_at         timestamptz        not null  default now(),

  -- Primary Key
  constraint pk_media_files primary key (media_id),

  -- Foreign Keys
  constraint fk_media_files_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_media_files_uploaded_by
    foreign key (uploaded_by) references public.profiles (profile_id)
    on delete restrict
    on update restrict,

  -- CHECK Constraints
  constraint ck_media_files_total_size check (total_size_bytes >= 0),
  constraint ck_media_files_duration_seconds check (
    duration_seconds is null or duration_seconds >= 0
  ),
  constraint ck_media_files_original_filename_length check (
    char_length(original_filename) > 0 and char_length(original_filename) <= 255
  )
);

-- 2b. Table: media_versions
-- Tracks the physical files stored in buckets (e.g. Supabase Storage, AWS S3)
-- that belong to a logical media_id. A single video upload might have four
-- versions: original, 1080p, 720p, and a thumbnail.
-- No updated_at column — versions are immutable (if a file changes, a new
-- version is created rather than updating an existing one).
create table public.media_versions (
  version_id        uuid          not null  default gen_random_uuid(),
  media_id          uuid          not null,
  version_label     text          not null,
  storage_bucket    text          not null,
  storage_path      text          not null,
  mime_type         text          not null,
  file_size_bytes   bigint        not null,
  checksum          text          null      default null,
  created_at        timestamptz   not null  default now(),

  -- Primary Key
  constraint pk_media_versions primary key (version_id),

  -- Foreign Keys
  constraint fk_media_versions_media
    foreign key (media_id) references public.media_files (media_id)
    on delete cascade
    on update restrict,

  -- Unique Constraints
  constraint uq_media_versions_media_label unique (media_id, version_label),
  constraint uq_media_versions_storage unique (storage_bucket, storage_path),

  -- CHECK Constraints
  constraint ck_media_versions_file_size check (file_size_bytes >= 0),
  constraint ck_media_versions_version_label_length check (
    char_length(version_label) > 0
  )
);

-- 2c. Table: media_usage
-- Polymorphic junction table that tracks exactly where every media file is
-- being used across the platform. Critical for data hygiene — you cannot
-- safely delete a media file if it is linked to a Mock Test, a Question,
-- or a Course. RESTRICT on delete from media_files prevents orphaned usage.
-- No updated_at column — insert-only junction table.
create table public.media_usage (
  usage_id        uuid          not null  default gen_random_uuid(),
  media_id        uuid          not null,
  resource_type   text          not null,
  resource_id     uuid          not null,
  usage_context   text          null      default null,
  created_at      timestamptz   not null  default now(),

  -- Primary Key
  constraint pk_media_usage primary key (usage_id),

  -- Foreign Keys
  constraint fk_media_usage_media
    foreign key (media_id) references public.media_files (media_id)
    on delete restrict
    on update restrict,

  -- Unique Constraints
  constraint uq_media_usage_media_resource_context
    unique (media_id, resource_type, resource_id, usage_context),

  -- CHECK Constraints
  constraint ck_media_usage_resource_type_length check (
    char_length(resource_type) > 0
  )
);

-- 2d. Table: media_processing_jobs
-- Tracks the state of asynchronous media tasks like transcoding, compression,
-- or thumbnail extraction. Provides visibility into the media pipeline.
-- No updated_at column — uses started_at and completed_at for lifecycle tracking.
create table public.media_processing_jobs (
  job_id            uuid              not null  default gen_random_uuid(),
  media_id          uuid              not null,
  job_type          job_category_type not null,
  status            job_status_type   not null  default 'queued',
  worker_id         text              null      default null,
  progress_percent  smallint          not null  default 0,
  error_log         text              null      default null,
  started_at        timestamptz       null      default null,
  completed_at      timestamptz       null      default null,
  created_at        timestamptz       not null  default now(),

  -- Primary Key
  constraint pk_media_processing_jobs primary key (job_id),

  -- Foreign Keys
  constraint fk_media_processing_jobs_media
    foreign key (media_id) references public.media_files (media_id)
    on delete cascade
    on update restrict,

  -- CHECK Constraints
  constraint ck_media_processing_jobs_progress check (
    progress_percent >= 0 and progress_percent <= 100
  ),
  constraint ck_media_processing_jobs_completed_at check (
    (status in ('completed', 'failed') and completed_at is not null)
    or (status not in ('completed', 'failed'))
  )
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Indexes
-- ════════════════════════════════════════════════════════════════════════════
-- All indexes are created after their respective tables exist.
-- No duplicate indexes on columns already covered by UNIQUE constraints.
-- Partial indexes used where specified in the schema.

-- 3a. media_files indexes
-- Admin media library filtering by institute and type.
create index if not exists idx_media_files_institute_type
  on public.media_files (institute_id, media_type, status);

-- Filtering "My Uploads" for the current user.
create index if not exists idx_media_files_uploader
  on public.media_files (uploaded_by, created_at desc);

-- 3b. media_versions indexes
-- Lookup versions by media_id. Partially covered by uq_media_versions_media_label.
create index if not exists idx_media_versions_media_id
  on public.media_versions (media_id);

-- Note: uq_media_versions_storage covers (storage_bucket, storage_path) lookups.

-- 3c. media_usage indexes
-- Polymorphic reverse lookup: find all media attached to a specific resource.
create index if not exists idx_media_usage_polymorphic
  on public.media_usage (resource_type, resource_id);

-- Orphan checking: find where a specific media file is used.
create index if not exists idx_media_usage_media_id
  on public.media_usage (media_id);

-- 3d. media_processing_jobs indexes
-- Worker processes polling for queued or retrying jobs.
create index if not exists idx_media_jobs_status
  on public.media_processing_jobs (status, created_at);

-- Quick lookup to check if a specific media file has pending operations.
create index if not exists idx_media_jobs_media
  on public.media_processing_jobs (media_id, status);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Functions That Reference Tables
-- ════════════════════════════════════════════════════════════════════════════
-- These functions are created after all tables exist because they reference
-- tables in their implementations.

-- 4a. Update media_files.total_size_bytes when media_versions changes
-- Maintains the running total of all version file sizes on the parent
-- media_files row. Fires on INSERT, UPDATE, and DELETE of media_versions.
-- Computes the sum from scratch for correctness (avoids drift from
-- incremental updates in edge cases like concurrent transactions).
create or replace function public.trgfn_media_maintain_total_size()
returns trigger
language plpgsql
as $$
begin
  update public.media_files
     set total_size_bytes = (
       select coalesce(sum(file_size_bytes), 0)
         from public.media_versions
        where media_id = coalesce(new.media_id, old.media_id)
     )
   where media_id = coalesce(new.media_id, old.media_id);
  return coalesce(new, old);
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — CREATE TRIGGER Statements
-- ════════════════════════════════════════════════════════════════════════════
-- Only tables with an updated_at column receive the set_updated_at trigger.
-- set_updated_at() already exists from Domain 01 — do not recreate.
-- media_versions has no updated_at column (immutable versions).
-- media_usage has no updated_at column (insert-only junction).
-- media_processing_jobs has no updated_at column (uses started_at/completed_at).

-- 5a. media_files triggers
create trigger trg_media_files_set_updated_at
  before update on public.media_files
  for each row
  execute function public.set_updated_at();

-- 5b. media_versions triggers
create trigger trg_media_versions_maintain_total_size_insert
  after insert on public.media_versions
  for each row
  execute function public.trgfn_media_maintain_total_size();

create trigger trg_media_versions_maintain_total_size_update
  after update on public.media_versions
  for each row
  execute function public.trgfn_media_maintain_total_size();

create trigger trg_media_versions_maintain_total_size_delete
  after delete on public.media_versions
  for each row
  execute function public.trgfn_media_maintain_total_size();

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — COMMENT Statements
-- ════════════════════════════════════════════════════════════════════════════

-- 6a. Table comments
comment on table public.media_files is
  'Master catalog of all media assets uploaded to the platform. Represents the '
  'logical file — the anchor point for permissions, ownership, and tracking, '
  'independent of the actual storage bucket or renditions. total_size_bytes is '
  'maintained via trigger on media_versions. Soft-delete via is_active = FALSE.';

comment on table public.media_versions is
  'Tracks the physical files stored in buckets (e.g. Supabase Storage, AWS S3) '
  'that belong to a logical media_id. A single video may have multiple versions: '
  'original, 1080p, 720p, thumbnail. Immutable — if a file changes, a new version '
  'is created rather than updating an existing row. CASCADE deletes with parent.';

comment on table public.media_usage is
  'Polymorphic junction table tracking where every media file is used across the '
  'platform. RESTRICT on delete from media_files prevents deleting media that is '
  'actively in use. Referential integrity on resource_id is enforced at the '
  'application layer (polymorphic FK not natively supported in PostgreSQL).';

comment on table public.media_processing_jobs is
  'Tracks the state of asynchronous media tasks like transcoding, compression, '
  'and thumbnail extraction. Provides visibility into the media processing '
  'pipeline. status drives the job lifecycle: queued → running → completed/failed. '
  'CASCADE deletes with parent media_files.';

-- 6b. Column comments — media_files
comment on column public.media_files.original_filename is
  'The name of the file as uploaded by the user (e.g. physics_ch1_final.mp4). '
  'Used for display in the media library. Maximum 255 characters.';

comment on column public.media_files.media_type is
  'Categorizes the media for UI handling and player selection: video, image, '
  'document, audio, or archive.';

comment on column public.media_files.status is
  'Current readiness state: pending (upload started), processing (transcoding), '
  'ready (available for use), failed (processing error), archived (retired).';

comment on column public.media_files.access_level is
  'Security context for URL generation: public (no auth required), private '
  '(auth required), requires_signature (signed, time-limited URLs). Default '
  'requires_signature as the safest default.';

comment on column public.media_files.total_size_bytes is
  'Sum of all associated media_versions file sizes. Maintained automatically '
  'via trigger on media_versions INSERT, UPDATE, and DELETE.';

comment on column public.media_files.duration_seconds is
  'Applicable for video and audio media. Total duration in seconds. NULL for '
  'documents and images.';

comment on column public.media_files.is_active is
  'Soft delete flag. When FALSE, the file is hidden in the UI but the record '
  'is preserved until a backend cron job physically deletes the underlying '
  'bucket objects and hard-deletes the record.';

-- 6c. Column comments — media_versions
comment on column public.media_versions.version_label is
  'Identifies the rendition type (e.g. original, 1080p, 720p, thumbnail, '
  'watermarked). One row per label per media_id. version_label = original is '
  'the sacred source — if deleted, the file cannot be recovered.';

comment on column public.media_versions.storage_bucket is
  'The name of the storage bucket containing the physical file (e.g. '
  'institute_private_assets, public_media).';

comment on column public.media_versions.storage_path is
  'The exact path or key inside the storage bucket. Together with '
  'storage_bucket forms a globally unique reference (enforced via UNIQUE).';

comment on column public.media_versions.mime_type is
  'IANA media type of this rendition (e.g. application/pdf, video/mp4, '
  'image/webp). Used for Content-Type headers on signed URLs.';

comment on column public.media_versions.file_size_bytes is
  'Exact size of this specific rendition in bytes.';

comment on column public.media_versions.checksum is
  'MD5 or SHA256 hash of the file for data integrity verification. Populated '
  'by the upload or processing pipeline.';

-- 6d. Column comments — media_usage
comment on column public.media_usage.resource_type is
  'Target entity table name (e.g. content, question, profile, live_class). '
  'Free-text to support polymorphic references without schema changes.';

comment on column public.media_usage.resource_id is
  'The UUID of the target entity row. No FK constraint — referential integrity '
  'enforced at the application layer via triggers or service-level validation.';

comment on column public.media_usage.usage_context is
  'Describes how the media is used in the context of the resource (e.g. avatar, '
  'video_lecture, question_diagram, thumbnail). NULL if the usage is implicit.';

-- 6e. Column comments — media_processing_jobs
comment on column public.media_processing_jobs.job_type is
  'Type of processing job: video_transcode, image_compress, pdf_watermark, '
  'or thumbnail_extract. Determines which worker queue handles the task.';

comment on column public.media_processing_jobs.status is
  'Current job state: queued (waiting for worker), running (in progress), '
  'completed (successfully finished), failed (fatal error), retrying '
  '(scheduled for retry after transient failure).';

comment on column public.media_processing_jobs.worker_id is
  'ID of the external worker or service handling the job (e.g. AWS MediaConvert '
  'Job ID, FFmpeg process ID). NULL until a worker picks up the job.';

comment on column public.media_processing_jobs.progress_percent is
  'Progress indicator from 0 to 100. Updated by the worker during processing. '
  'Useful for display in the admin media management UI.';

comment on column public.media_processing_jobs.error_log is
  'Stack trace, API error message, or failure reason if the job fails. NULL '
  'for successful jobs and jobs still in progress.';

comment on column public.media_processing_jobs.started_at is
  'UTC timestamp when the worker picked up the job. NULL until the job leaves '
  'the queued state.';

comment on column public.media_processing_jobs.completed_at is
  'UTC timestamp when the job successfully finished or fatally failed. NULL '
  'until the job reaches a terminal state (completed or failed).';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — Domain 12 File & Media Management
-- ════════════════════════════════════════════════════════════════════════════
