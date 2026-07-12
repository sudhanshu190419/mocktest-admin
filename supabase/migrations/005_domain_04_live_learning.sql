-- ============================================================================
-- Migration: Domain 04 — Live Learning
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Tables: live_classes · live_sessions · session_participants · recordings ·
--         attendance · attendance_events · live_class_batch
--
-- Depends on: Domain 01 (institutes, profiles, teacher_details, student_details)
--             Domain 02 (streams, subjects, chapters, topics, batches)
--             Existing enums (live_class_status, live_session_status,
--               recording_status)
--             Existing functions (set_updated_at, get_my_institute_id, etc.)
--
-- Order:
--   1. Tables (dependency order: parent → child → junction)
--   2. Indexes (after all tables exist)
--   3. Triggers (after all tables exist; set_updated_at already exists from Domain 1)
--   4. Comments
--
-- Partitioning note: attendance and attendance_events are designed for monthly
--   RANGE partitioning by joined_at / event_timestamp at scale. For the initial
--   migration they are created as regular tables. Partitioning DDL should be
--   added in a future migration once volume justifies it.
--
-- Reference: Schema_Domain_04_Live_Learning_v2.md v2.0 | ERD v3.0
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — CREATE TABLE Statements
-- ════════════════════════════════════════════════════════════════════════════
-- Live teaching: live_classes → live_sessions (1:1), recordings,
--                session_participants, attendance, attendance_events
-- Junction:       live_class_batch (live_classes ↔ batches)

-- 1a. Table: live_classes
-- The schedulable unit of live teaching. One teacher, one time slot, one
-- academic topic. Broadcast to multiple batches via live_class_batch.
-- Manages its own lifecycle via live_class_status enum.
create table public.live_classes (
  class_id          uuid               not null  default gen_random_uuid(),
  institute_id      uuid               not null,
  teacher_id        uuid               not null,
  subject_id        uuid               not null,
  chapter_id        uuid               null      default null,
  title             varchar(500)       not null,
  description       text               null      default null,
  scheduled_at      timestamptz        not null,
  duration_min      integer            not null,
  status            live_class_status  not null  default 'draft',
  is_recorded       boolean            not null  default false,
  recording_url     text               null      default null,
  max_participants  integer            null      default null,
  created_at        timestamptz        not null  default now(),
  updated_at        timestamptz        not null  default now(),
  cancelled_at      timestamptz        null      default null,
  cancelled_reason  text               null      default null,

  -- Primary Key
  constraint pk_live_classes primary key (class_id),

  -- Foreign Keys
  constraint fk_live_classes_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_live_classes_teacher
    foreign key (teacher_id) references public.teacher_details (teacher_id)
    on delete restrict
    on update restrict,

  constraint fk_live_classes_subject
    foreign key (subject_id) references public.subjects (subject_id)
    on delete restrict
    on update restrict,

  constraint fk_live_classes_chapter
    foreign key (chapter_id) references public.chapters (chapter_id)
    on delete restrict
    on update restrict,

  -- CHECK Constraints
  constraint ck_live_classes_title_length check (char_length(title) >= 3),
  constraint ck_live_classes_duration_min check
    (duration_min > 0 and duration_min <= 480),
  constraint ck_live_classes_max_participants check
    (max_participants is null or max_participants > 0),
  constraint ck_live_classes_cancellation check
    ((status = 'cancelled' and cancelled_at is not null)
     or (status != 'cancelled' and cancelled_at is null)),
  constraint ck_live_classes_cancelled_at check
    (cancelled_at is null or cancelled_at >= created_at)
);

-- 1b. Table: live_sessions
-- The active WebRTC or third-party provider session underlying a live class.
-- Strict 1:1 relationship with live_classes. Created when the teacher starts
-- the class and closed when the teacher ends it. Provider-agnostic design.
create table public.live_sessions (
  session_id           uuid               not null  default gen_random_uuid(),
  class_id             uuid               not null,
  institute_id         uuid               not null,
  provider             varchar(50)        not null,
  provider_session_id  varchar(500)       null      default null,
  room_url             text               null      default null,
  host_token           text               null      default null,
  participant_token    text               null      default null,
  status               live_session_status not null default 'waiting',
  started_at           timestamptz        not null  default now(),
  ended_at             timestamptz        null      default null,
  peak_participants    integer            null      default null,
  provider_metadata    jsonb              null      default null,
  ended_reason         varchar(50)        null      default null,
  created_at           timestamptz        not null  default now(),
  updated_at           timestamptz        not null  default now(),

  -- Primary Key
  constraint pk_live_sessions primary key (session_id),

  -- Foreign Keys
  constraint fk_live_sessions_class
    foreign key (class_id) references public.live_classes (class_id)
    on delete restrict
    on update restrict,

  constraint fk_live_sessions_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  -- Unique Constraints
  constraint uq_live_sessions_class_id unique (class_id),

  -- CHECK Constraints
  constraint ck_live_sessions_provider_length check (char_length(provider) >= 2),
  constraint ck_live_sessions_ended_at check
    (ended_at is null or ended_at > started_at),
  constraint ck_live_sessions_peak_participants check
    (peak_participants is null or peak_participants >= 0),
  constraint ck_live_sessions_status_ended check
    ((status = 'ended' and ended_at is not null)
     or (status != 'ended' and ended_at is null))
);

-- 1c. Table: live_class_batch
-- Many-to-many junction table linking live_classes to batches.
-- A single live class can be broadcast to multiple batches simultaneously.
-- Batch assignment is set at class creation and can be modified while
-- the class is in draft or scheduled status.
create table public.live_class_batch (
  class_id     uuid          not null,
  batch_id     uuid          not null,
  assigned_at  timestamptz   not null  default now(),
  assigned_by  uuid          null      default null,

  -- Primary Key (composite)
  constraint pk_live_class_batch primary key (class_id, batch_id),

  -- Foreign Keys
  constraint fk_live_class_batch_class
    foreign key (class_id) references public.live_classes (class_id)
    on delete cascade
    on update restrict,

  constraint fk_live_class_batch_batch
    foreign key (batch_id) references public.batches (batch_id)
    on delete restrict
    on update restrict,

  constraint fk_live_class_batch_assigned_by
    foreign key (assigned_by) references public.profiles (profile_id)
    on delete set null
    on update restrict
);

-- 1d. Table: recordings
-- Stores metadata for recordings produced from a live class.
-- A single class may generate multiple recording segments.
-- Follows the same storage model as Domain 3: storage_bucket + storage_path.
create table public.recordings (
  recording_id          uuid              not null  default gen_random_uuid(),
  class_id              uuid              not null,
  institute_id          uuid              not null,
  storage_bucket        varchar(100)      null      default null,
  storage_path          text              null      default null,
  provider_recording_url text             null      default null,
  duration_seconds      integer           null      default null,
  file_size_bytes       bigint            null      default null,
  segment_number        integer           not null  default 1,
  status                recording_status  not null  default 'queued',
  failure_reason        text              null      default null,
  recorded_at           timestamptz       not null  default now(),
  completed_at          timestamptz       null      default null,
  thumbnail_path        text              null      default null,
  transcript_path       text              null      default null,
  captions_path         text              null      default null,
  created_at            timestamptz       not null  default now(),
  updated_at            timestamptz       not null  default now(),

  -- Primary Key
  constraint pk_recordings primary key (recording_id),

  -- Foreign Keys
  constraint fk_recordings_class
    foreign key (class_id) references public.live_classes (class_id)
    on delete restrict
    on update restrict,

  constraint fk_recordings_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  -- Unique Constraints
  constraint uq_recordings_class_segment unique (class_id, segment_number),

  -- CHECK Constraints
  constraint ck_recordings_duration_seconds check
    (duration_seconds is null or duration_seconds > 0),
  constraint ck_recordings_file_size_bytes check
    (file_size_bytes is null or file_size_bytes > 0),
  constraint ck_recordings_segment_number check (segment_number >= 1),
  constraint ck_recordings_completed_at check
    (completed_at is null or completed_at >= recorded_at),
  constraint ck_recordings_status_completed check
    ((status = 'completed' and completed_at is not null)
     or (status != 'completed' and completed_at is null)),
  constraint ck_recordings_storage_pair check
    ((storage_bucket is null) = (storage_path is null)),
  constraint ck_recordings_storage_or_provider check
    (storage_path is not null or provider_recording_url is not null
     or status in ('queued', 'processing'))
);

-- 1e. Table: session_participants
-- Real-time event log of every participant's connection within a live session.
-- A student who joins, drops, and rejoins creates multiple rows.
-- This is the source of truth during a live session; attendance is computed
-- from this log at class end.
create table public.session_participants (
  participant_id  uuid           not null  default gen_random_uuid(),
  session_id      uuid           not null,
  class_id        uuid           not null,
  student_id      uuid           not null,
  institute_id    uuid           not null,
  joined_at       timestamptz    not null,
  left_at         timestamptz    null      default null,
  camera_enabled  boolean        not null  default false,
  mic_enabled     boolean        not null  default false,
  screen_shared   boolean        not null  default false,
  network_quality varchar(20)    null      default null,
  device_type     varchar(50)    null      default null,
  ip_address      inet           null      default null,
  created_at      timestamptz    not null  default now(),

  -- Primary Key
  constraint pk_session_participants primary key (participant_id),

  -- Foreign Keys
  constraint fk_session_participants_session
    foreign key (session_id) references public.live_sessions (session_id)
    on delete restrict
    on update restrict,

  constraint fk_session_participants_class
    foreign key (class_id) references public.live_classes (class_id)
    on delete restrict
    on update restrict,

  constraint fk_session_participants_student
    foreign key (student_id) references public.student_details (student_id)
    on delete restrict
    on update restrict,

  constraint fk_session_participants_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  -- CHECK Constraints
  constraint ck_session_participants_left_at check
    (left_at is null or left_at > joined_at)
);

-- 1f. Table: attendance
-- Per-student per-class attendance summary. One row per student per class.
-- duration_seconds is the aggregate of all presence intervals.
-- This is the highest-volume table in the domain — see partitioning note
-- at the top of this migration.
create table public.attendance (
  attendance_id       uuid          not null  default gen_random_uuid(),
  class_id            uuid          not null,
  student_id          uuid          not null,
  institute_id        uuid          not null,
  joined_at           timestamptz   null      default null,
  left_at             timestamptz   null      default null,
  duration_seconds    integer       not null  default 0,
  is_present          boolean       not null  default false,
  is_manual_override  boolean       not null  default false,
  override_by         uuid          null      default null,
  override_reason     text          null      default null,
  created_at          timestamptz   not null  default now(),
  updated_at          timestamptz   not null  default now(),

  -- Primary Key
  constraint pk_attendance primary key (attendance_id),

  -- Foreign Keys
  constraint fk_attendance_class
    foreign key (class_id) references public.live_classes (class_id)
    on delete restrict
    on update restrict,

  constraint fk_attendance_student
    foreign key (student_id) references public.student_details (student_id)
    on delete restrict
    on update restrict,

  constraint fk_attendance_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_attendance_override_by
    foreign key (override_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- Unique Constraints
  constraint uq_attendance_class_student unique (class_id, student_id),

  -- CHECK Constraints
  constraint ck_attendance_duration_seconds check (duration_seconds >= 0),
  constraint ck_attendance_left_at check
    (left_at is null or joined_at is null or left_at >= joined_at),
  constraint ck_attendance_override_consistency check
    ((is_manual_override = true and override_by is not null)
     or (is_manual_override = false and override_by is null and override_reason is null))
);

-- 1g. Table: attendance_events
-- Raw join/leave event log underlying each attendance summary row.
-- A single attendance row captures the computed summary; this table stores
-- the individual join and leave events that produced that summary.
create table public.attendance_events (
  event_id         uuid          not null  default gen_random_uuid(),
  attendance_id    uuid          not null,
  class_id         uuid          not null,
  student_id       uuid          not null,
  institute_id     uuid          not null,
  event_type       varchar(20)   not null,
  event_timestamp  timestamptz   not null,
  created_at       timestamptz   not null  default now(),

  -- Primary Key
  constraint pk_attendance_events primary key (event_id),

  -- Foreign Keys
  constraint fk_attendance_events_attendance
    foreign key (attendance_id) references public.attendance (attendance_id)
    on delete restrict
    on update restrict,

  constraint fk_attendance_events_class
    foreign key (class_id) references public.live_classes (class_id)
    on delete restrict
    on update restrict,

  constraint fk_attendance_events_student
    foreign key (student_id) references public.student_details (student_id)
    on delete restrict
    on update restrict,

  constraint fk_attendance_events_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  -- Unique Constraints
  constraint uq_attendance_events_event
    unique (attendance_id, event_type, event_timestamp),

  -- CHECK Constraints
  constraint ck_attendance_events_event_type check
    (event_type in ('join', 'leave'))
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Indexes
-- ════════════════════════════════════════════════════════════════════════════
-- All indexes are created after their respective tables exist.
-- No duplicate indexes on columns already covered by UNIQUE constraints.
-- Partial indexes are used where specified in the schema.

-- 2a. live_classes indexes
create index if not exists idx_live_classes_institute_status
  on public.live_classes (institute_id, status);

create index if not exists idx_live_classes_institute_scheduled_at
  on public.live_classes (institute_id, scheduled_at);

create index if not exists idx_live_classes_teacher_status
  on public.live_classes (teacher_id, status);

create index if not exists idx_live_classes_teacher_scheduled_at
  on public.live_classes (teacher_id, scheduled_at desc);

create index if not exists idx_live_classes_subject
  on public.live_classes (subject_id);

-- Partial index: chapter_id is nullable
create index if not exists idx_live_classes_chapter
  on public.live_classes (chapter_id)
  where chapter_id is not null;

create index if not exists idx_live_classes_status_scheduled_at
  on public.live_classes (status, scheduled_at);

-- 2b. live_sessions indexes
create index if not exists idx_live_sessions_institute_status
  on public.live_sessions (institute_id, status);

-- Partial unique index: provider_session_id may be null initially
create unique index if not exists uq_live_sessions_provider_session
  on public.live_sessions (provider, provider_session_id)
  where provider_session_id is not null;

create index if not exists idx_live_sessions_started_at
  on public.live_sessions (started_at desc);

-- Note: idx_live_sessions_class_id is covered by uq_live_sessions_class_id.

-- 2c. live_class_batch indexes
create index if not exists idx_live_class_batch_batch_id
  on public.live_class_batch (batch_id);

-- Note: idx_live_class_batch_class_id is covered by the composite PK leading column.

-- 2d. recordings indexes
create index if not exists idx_recordings_class_id
  on public.recordings (class_id);

create index if not exists idx_recordings_institute_status
  on public.recordings (institute_id, status);

create index if not exists idx_recordings_status
  on public.recordings (status);

-- Note: idx_recordings_class_segment is covered by uq_recordings_class_segment.

-- 2e. session_participants indexes
create index if not exists idx_session_participants_session_id
  on public.session_participants (session_id);

create index if not exists idx_session_participants_session_student
  on public.session_participants (session_id, student_id);

create index if not exists idx_session_participants_student_id
  on public.session_participants (student_id, joined_at desc);

create index if not exists idx_session_participants_class_id
  on public.session_participants (class_id);

-- Partial index: only currently connected participants
create index if not exists idx_session_participants_active
  on public.session_participants (session_id)
  where left_at is null;

-- 2f. attendance indexes
create index if not exists idx_attendance_class_id
  on public.attendance (class_id);

create index if not exists idx_attendance_student_id
  on public.attendance (student_id);

create index if not exists idx_attendance_institute_joined_at
  on public.attendance (institute_id, joined_at desc);

create index if not exists idx_attendance_class_is_present
  on public.attendance (class_id, is_present);

create index if not exists idx_attendance_student_is_present
  on public.attendance (student_id, is_present);

-- Note: uq_attendance_class_student covers (class_id, student_id) lookups.

-- 2g. attendance_events indexes
create index if not exists idx_attendance_events_attendance_id
  on public.attendance_events (attendance_id);

create index if not exists idx_attendance_events_class_id
  on public.attendance_events (class_id, event_timestamp);

create index if not exists idx_attendance_events_student_id
  on public.attendance_events (student_id, event_timestamp desc);

-- Note: uq_attendance_events_event covers (attendance_id, event_type, event_timestamp).

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — CREATE TRIGGER Statements
-- ════════════════════════════════════════════════════════════════════════════
-- Only tables with an updated_at column receive the set_updated_at trigger.
-- set_updated_at() already exists from Domain 01 — do not recreate.
-- session_participants has no updated_at column (append-only event log).
-- attendance_events has no updated_at column (append-only event log).
-- live_class_batch has no updated_at column (insert-or-delete only).

-- 3a. live_classes triggers
create trigger trg_live_classes_set_updated_at
  before update on public.live_classes
  for each row
  execute function public.set_updated_at();

-- 3b. live_sessions triggers
create trigger trg_live_sessions_set_updated_at
  before update on public.live_sessions
  for each row
  execute function public.set_updated_at();

-- 3c. recordings triggers
create trigger trg_recordings_set_updated_at
  before update on public.recordings
  for each row
  execute function public.set_updated_at();

-- 3d. attendance triggers
create trigger trg_attendance_set_updated_at
  before update on public.attendance
  for each row
  execute function public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — COMMENT Statements
-- ════════════════════════════════════════════════════════════════════════════

-- 4a. Table comments
comment on table public.live_classes is
  'The schedulable unit of live teaching. One teacher, one time slot, one '
  'academic topic. Broadcast to multiple batches via live_class_batch. '
  'Lifecycle: draft → scheduled → live → completed → cancelled.';

comment on table public.live_sessions is
  'The active WebRTC or third-party provider session underlying a live class. '
  'Strict 1:1 relationship with live_classes via UNIQUE (class_id). '
  'Provider-agnostic design — provider column identifies the service.';

comment on table public.live_class_batch is
  'Many-to-many junction table linking live_classes to batches. A single '
  'live class can be broadcast to multiple batches simultaneously.';

comment on table public.recordings is
  'Stores metadata for recordings produced from a live class. A single class '
  'may generate multiple recording segments (segment_number). Follows the '
  'Domain 3 storage model: storage_bucket + storage_path with signed URLs.';

comment on table public.session_participants is
  'Real-time event log of every participant connection within a live session. '
  'A student who joins, drops, and rejoins creates multiple rows. This is the '
  'source of truth during a live session; attendance is computed from this log.';

comment on table public.attendance is
  'Per-student per-class attendance summary. One row per student per class. '
  'duration_seconds aggregates all presence intervals. is_present is computed '
  'against a configurable threshold. Manual overrides are audited via '
  'is_manual_override, override_by, and override_reason.';

comment on table public.attendance_events is
  'Raw join/leave event log underlying each attendance summary row. Follows '
  'the event-sourcing pattern: attendance is the fast-summary view; '
  'attendance_events is the immutable source of truth for recomputation.';

-- 4b. Column comments
comment on column public.live_classes.chapter_id is
  'Optional FK — a class may cover multiple chapters or be an orientation '
  'class with no chapter mapping. Nullable to support stream-level classes.';

comment on column public.live_classes.duration_min is
  'Planned duration in minutes. Capped at 480 (8 hours) as a sanity guard. '
  'Actual duration is derived from live_sessions.ended_at - started_at.';

comment on column public.live_classes.is_recorded is
  'When TRUE, the session is configured to record. Does not guarantee a '
  'recording exists — check the recordings table for actual rows.';

comment on column public.live_classes.recording_url is
  'Convenience denormalization: primary playback URL for the completed '
  'recording. Populated by the recording completion webhook. For multi-part '
  'recordings, this holds the first segment URL; use recordings table for all.';

comment on column public.live_classes.cancelled_at is
  'UTC timestamp when the class was cancelled. NULL unless status = cancelled.';

comment on column public.live_classes.cancelled_reason is
  'Optional reason for cancellation. Shown to students in notifications.';

comment on column public.live_sessions.provider is
  'Video provider identifier (e.g. daily, livekit, agora, twilio). Not an '
  'enum — providers change without DB migrations.';

comment on column public.live_sessions.provider_session_id is
  'Session or room ID assigned by the external provider. Used to correlate '
  'provider webhooks back to this row. NULL until provider assigns an ID.';

comment on column public.live_sessions.host_token is
  'Token used by the teacher to start and control the session. Must be '
  'treated as a secret — never returned to student-role API calls.';

comment on column public.live_sessions.participant_token is
  'Token for student participants. Scoped to read-only/participant access.';

comment on column public.live_sessions.provider_metadata is
  'Arbitrary provider-specific metadata from the session creation API. '
  'Stored for debugging and future provider migrations.';

comment on column public.live_sessions.ended_reason is
  'Machine-readable reason the session ended (e.g. teacher_end, timeout, '
  'network_failure). Invaluable for debugging unexpected terminations.';

comment on column public.live_sessions.peak_participants is
  'Maximum concurrent participant count. Populated by provider webhook or '
  'computed from session_participants data.';

comment on column public.live_class_batch.assigned_by is
  'The teacher or admin who made this batch assignment. NULL for '
  'system-created assignments.';

comment on column public.recordings.storage_bucket is
  'Supabase Storage bucket name. NULL if provider-hosted and not yet '
  'transferred to platform storage.';

comment on column public.recordings.provider_recording_url is
  'External recording URL from the video provider. Used as playback source '
  'until the recording is transferred to platform storage.';

comment on column public.recordings.segment_number is
  'Segment index for multi-part recordings. 1 for single-segment recordings.';

comment on column public.recordings.failure_reason is
  'Provider or pipeline error message when status = failed. Used for '
  'debugging and admin alerts.';

comment on column public.recordings.thumbnail_path is
  'Storage path of the auto-generated video thumbnail. Signed URL generated '
  'dynamically — do not store raw URLs.';

comment on column public.recordings.transcript_path is
  'Storage path of the auto-generated transcript file (VTT/JSON). Enables '
  'full-text search within recordings.';

comment on column public.recordings.captions_path is
  'Storage path of the captions/subtitles file (VTT/SRT). Enables '
  'accessibility compliance (WCAG 2.1 Level AA).';

comment on column public.session_participants.left_at is
  'UTC timestamp when this connection ended. NULL if still connected or '
  'the leave event has not yet arrived.';

comment on column public.session_participants.network_quality is
  'Last-known network quality (e.g. excellent, good, poor, unstable). '
  'Provider-reported; free text.';

comment on column public.session_participants.ip_address is
  'Participant IP address at join time. Used for geo-analytics. Treat as '
  'PII — comply with GDPR/data minimisation requirements.';

comment on column public.attendance.joined_at is
  'UTC timestamp of the student''s first join event. NULL if attendance was '
  'marked manually with no session join recorded.';

comment on column public.attendance.left_at is
  'UTC timestamp of the student''s final leave event. NULL if the session '
  'ended before the student explicitly left.';

comment on column public.attendance.duration_seconds is
  'Total seconds the student was present. Computed from all join/leave '
  'events. Never NULL — defaults to 0.';

comment on column public.attendance.is_present is
  'Computed attendance flag. TRUE if duration_seconds meets the minimum '
  'presence threshold (business rule, not hardcoded).';

comment on column public.attendance.is_manual_override is
  'When TRUE, is_present was set manually by teacher or admin, overriding '
  'the computed value.';

comment on column public.attendance.override_by is
  'Admin or teacher who performed the manual override. NULL unless '
  'is_manual_override = TRUE.';

comment on column public.attendance.override_reason is
  'Free-text reason for the manual override. NULL unless is_manual_override = TRUE.';

comment on column public.attendance_events.event_type is
  'join or leave. Not an enum to accommodate future values (e.g. camera_on).';

comment on column public.attendance_events.event_timestamp is
  'UTC timestamp of the event as reported by the session provider webhook. '
  'Use provider-reported time, not server receipt time, for accuracy.';

-- 4c. Constraint comments
comment on constraint ck_live_classes_duration_min on public.live_classes is
  'Duration must be positive and capped at 480 minutes (8 hours). Sanity '
  'guard against data entry errors.';

comment on constraint ck_live_classes_cancellation on public.live_classes is
  'cancelled_at must be set when and only when status = cancelled. Prevents '
  'half-written cancellation states.';

comment on constraint uq_live_sessions_class_id on public.live_sessions is
  'Enforces the 1:1 relationship — only one session may exist per class.';

comment on constraint ck_live_sessions_status_ended on public.live_sessions is
  'ended_at must be set when and only when status = ended. Prevents sessions '
  'marked ended without a timestamp.';

comment on constraint ck_recordings_storage_pair on public.recordings is
  'storage_bucket and storage_path must always be set together — never one '
  'without the other.';

comment on constraint ck_recordings_storage_or_provider on public.recordings is
  'Completed or failed recordings must have at least storage_path or '
  'provider_recording_url. queued/processing rows may have neither.';

comment on constraint ck_attendance_override_consistency on public.attendance is
  'override_by must be present when and only when is_manual_override = TRUE. '
  'Prevents orphaned override flags without an actor.';

comment on constraint uq_attendance_class_student on public.attendance is
  'One attendance row per student per class. Prevents duplicate records from '
  'join/leave event race conditions.';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — Domain 04 Live Learning
-- ════════════════════════════════════════════════════════════════════════════
