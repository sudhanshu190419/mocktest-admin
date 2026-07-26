-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 065_create_recordings_table
--
-- Creates the `recordings` table for the Recorded Classes Module.
--
-- This table stores metadata for all live class recordings, including
-- processing status, storage paths (Cloudflare R2), and access control
-- via batch membership.
--
-- Requirements:
--   - Reuses the existing `live_classes` FK for source class association
--   - Supports LiveKit Cloud Egress → Cloudflare R2 export pipeline
--   - RLS: teachers manage their own recordings; students read completed
--          recordings in their batches
--   - Soft delete only (no hard delete from application layer)
--   - Indexed for scale (millions of recordings)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. Create recording_type enum ───────────────────────────────────────────

do $$ begin
  create type public.recording_type as enum ('live_class', 'practice', 'demo');
exception
  when duplicate_object then null;
end $$;

-- ─── 2. Create recording_status enum ─────────────────────────────────────────

do $$ begin
  create type public.recording_status as enum (
    'recording',   -- LiveKit Egress is actively recording
    'processing',  -- LiveKit is exporting to R2
    'completed',   -- Ready for playback
    'failed',      -- Processing error, teacher can retry
    'partial'      -- Short clip (<30s), teacher can keep or retry
  );
exception
  when duplicate_object then null;
end $$;

-- ─── 3. Create recordings table ─────────────────────────────────────────────

create table if not exists public.recordings (
    -- Primary key
    recording_id           uuid primary key default gen_random_uuid(),

    -- Ownership & Scoping
    institute_id           uuid not null references public.institutes(institute_id),
    teacher_id             uuid not null references public.teacher_details(teacher_id),

    -- Source live class (nullable for standalone/practice recordings)
    class_id               uuid references public.live_classes(class_id) on delete set null,

    -- Recording metadata
    title                  text not null check (char_length(title) >= 3),
    description            text,
    recording_type         public.recording_type not null default 'live_class',

    -- Status tracking (uses enum)
    status                 public.recording_status not null default 'processing',

    -- Duration & size (populated by webhook on completion)
    duration_seconds       integer check (duration_seconds > 0),
    file_size_bytes        bigint check (file_size_bytes > 0),

    -- Storage paths (Cloudflare R2 — LiveKit Egress destination)
    storage_bucket         text,        -- R2 bucket name (e.g. 'recorded-classes')
    storage_path           text,        -- R2 object key
    playback_url           text,        -- Cached signed URL (regenerated on demand)

    -- Thumbnail
    thumbnail_url          text,

    -- LiveKit Egress tracking
    livekit_egress_id      text unique, -- LiveKit Egress API identifier
    error_message          text,
    retry_count            integer not null default 0,
    last_retried_at        timestamptz,

    -- Batch membership (denormalized for RLS — recordings visible to batch students)
    batch_id               uuid references public.batches(batch_id) on delete set null,

    -- Soft delete
    is_deleted             boolean not null default false,
    deleted_at             timestamptz,

    -- Audit timestamps
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now()
);

-- ─── 4. Indexes for query performance ────────────────────────────────────────

-- Institute-scoped queries (admin dashboard, institute-level analytics)
create index if not exists idx_recordings_institute
    on public.recordings(institute_id, status);

-- Teacher-scoped queries (teacher recordings list)
create index if not exists idx_recordings_teacher
    on public.recordings(teacher_id, status);

-- Batch-scoped queries (student recordings list)
create index if not exists idx_recordings_batch
    on public.recordings(batch_id, status);

-- Source class lookup
create index if not exists idx_recordings_class
    on public.recordings(class_id);

-- Active recordings filter (common query pattern: show only active, non-deleted)
create index if not exists idx_recordings_active
    on public.recordings(institute_id)
    where is_deleted = false and status = 'completed';

-- Pending recordings filter (for processing monitor)
create index if not exists idx_recordings_pending
    on public.recordings(status)
    where status in ('recording', 'processing');

-- Soft-delete cleanup (admin hard-delete job scans this)
create index if not exists idx_recordings_deleted
    on public.recordings(deleted_at)
    where is_deleted = true;

-- ─── 5. Updated_at trigger ──────────────────────────────────────────────────

create trigger trg_recordings_updated_at
    before update on public.recordings
    for each row
    execute function public.trigger_set_updated_at();

-- ─── 6. Enable RLS ──────────────────────────────────────────────────────────

alter table public.recordings enable row level security;

-- ─── 7. RLS Policies ────────────────────────────────────────────────────────

-- 7a. Teachers: full CRUD on their own recordings
create policy "Teachers manage their recordings"
    on public.recordings
    for all
    to authenticated
    using (
        teacher_id in (
            select teacher_id from public.teacher_details
            where profile_id = auth.uid()
        )
    )
    with check (
        teacher_id in (
            select teacher_id from public.teacher_details
            where profile_id = auth.uid()
        )
    );

-- 7b. Students: read-only access to completed, non-deleted recordings
--     that belong to batches they are enrolled in
create policy "Students view batch recordings"
    on public.recordings
    for select
    to authenticated
    using (
        status = 'completed'
        and is_deleted = false
        and batch_id in (
            select batch_id from public.batch_students
            where student_id in (
                select student_id from public.student_details
                where profile_id = auth.uid()
            )
        )
    );

-- 7c. Admins: full access for administration
create policy "Admins have full access to recordings"
    on public.recordings
    for all
    to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- ─── 8. Comments ────────────────────────────────────────────────────────────

comment on table public.recordings is
    'Stores metadata for live class recordings. Recordings are captured via '
    'LiveKit Cloud Egress, exported to Cloudflare R2, and made available for '
    'student streaming. Supports soft delete and processing lifecycle.';

comment on column public.recordings.institute_id is
    'FK to institutes. Denormalized for RLS performance. Populated from the '
    'live_classes join at creation time.';

comment on column public.recordings.teacher_id is
    'FK to teacher_details. The teacher who owned the live class when '
    'recording started. Used for ownership-based RLS.';

comment on column public.recordings.class_id is
    'FK to live_classes. Nullable for standalone/practice recordings that are '
    'not linked to a specific live class. ON DELETE SET NULL preserves the '
    'recording even if the class record is cleaned up.';

comment on column public.recordings.livekit_egress_id is
    'LiveKit Egress API identifier. Used to poll egress status and map '
    'webhook callbacks to the correct recordings row. Unique per recording.';

comment on column public.recordings.storage_bucket is
    'Cloudflare R2 bucket name where the recording file is stored. '
    'Example: "recorded-classes". Stored as plain text for provider flexibility.';

comment on column public.recordings.storage_path is
    'Cloudflare R2 object key (path within the bucket). Together with '
    'storage_bucket, uniquely identifies the recording file for signed URL generation.';

comment on column public.recordings.playback_url is
    'Cached signed URL for streaming. May expire — clients should call '
    'getPlaybackUrl() to regenerate if playback fails.';

comment on column public.recordings.batch_id is
    'Denormalized batch ID for efficient student-scoped queries. '
    'Populated from live_class_batch at creation time. NULL for practice recordings.';
