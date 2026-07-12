-- ============================================================================
-- Migration: Domain 14 — Student Services
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Tables: student_bookmarks · student_downloads · student_viewing_history ·
--         student_personal_notes · student_doubts · doubt_replies ·
--         support_tickets · support_ticket_messages · student_feedback_ratings
--
-- Depends on: Domain 01 (student_details, profiles)
--             Domain 02 (subjects, chapters)
--             Existing functions (set_updated_at, get_my_institute_id, etc.)
--
-- New enums: resource_category_type · doubt_status_type ·
--            ticket_category_type · ticket_status_type · ticket_priority_type
--
-- Order:
--   1. New Enum Types (idempotent)
--   2. Tables (dependency order: parent → child)
--   3. Indexes (after all tables exist)
--   4. Functions (table-referencing functions for triggers)
--   5. Triggers (after all tables and functions exist)
--   6. Comments
--
-- Reference: Schema_Domain_14_Student_Services.md v1.0
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — New Enum Types (Idempotent)
-- ════════════════════════════════════════════════════════════════════════════
-- These enums are defined in this domain and used by the student services
-- tables. Each creation is wrapped in an idempotent DO block.

-- 1a. resource_category_type
-- Standardises polymorphic references across the student services domain:
-- bookmarks, notes, history, ratings, and doubts all use this enum to
-- identify the type of resource being referenced.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'resource_category_type') then
    create type resource_category_type as enum (
      'content', 'question', 'live_class', 'pyq_paper', 'mock_test', 'teacher'
    );
  end if;
end $$;

-- 1b. doubt_status_type
-- Workflow state for the academic doubt resolution engine.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'doubt_status_type') then
    create type doubt_status_type as enum ('open', 'in_progress', 'resolved', 'archived');
  end if;
end $$;

-- 1c. ticket_category_type
-- Routes customer support issues to the right admin queues.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'ticket_category_type') then
    create type ticket_category_type as enum ('billing', 'technical', 'academic', 'account', 'other');
  end if;
end $$;

-- 1d. ticket_status_type
-- Standard helpdesk state machine for support tickets.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'ticket_status_type') then
    create type ticket_status_type as enum ('open', 'in_progress', 'waiting_on_student', 'resolved', 'closed');
  end if;
end $$;

-- 1e. ticket_priority_type
-- SLA management for support tickets.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'ticket_priority_type') then
    create type ticket_priority_type as enum ('low', 'medium', 'high', 'urgent');
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — CREATE TABLE Statements
-- ════════════════════════════════════════════════════════════════════════════
-- Student services: bookmarks (favorites with folder organization)
--                    downloads (DRM offline tracking)
--                    viewing_history (resume playback tracking)
--                    personal_notes (timestamp-linked annotations)
--                    doubts (academic Q&A thread root)
--                    doubt_replies (threaded Q&A replies)
--                    support_tickets (helpdesk ticket root)
--                    support_ticket_messages (helpdesk conversation)
--                    feedback_ratings (1-5 star reviews)

-- 2a. Table: student_bookmarks
-- Allows students to save Questions, Live Classes, PDF Notes, or PYQ Papers
-- for quick access later. Supports lightweight organization via folders.
-- CASCADE deletes with parent student to clean up on account removal.
create table public.student_bookmarks (
  bookmark_id   uuid                  not null  default gen_random_uuid(),
  student_id    uuid                  not null,
  resource_type resource_category_type not null,
  resource_id   uuid                  not null,
  folder_name   text                  not null  default 'General',
  notes         text                  null      default null,
  created_at    timestamptz           not null  default now(),

  -- Primary Key
  constraint pk_student_bookmarks primary key (bookmark_id),

  -- Foreign Keys
  constraint fk_student_bookmarks_student
    foreign key (student_id) references public.student_details (student_id)
    on delete cascade
    on update restrict,

  -- Unique Constraints
  constraint uq_student_bookmarks_student_resource
    unique (student_id, resource_type, resource_id),

  -- CHECK Constraints
  constraint ck_student_bookmarks_folder_name check (
    char_length(folder_name) > 0 and char_length(folder_name) <= 50
  )
);

-- 2b. Table: student_downloads
-- Tracks DRM and offline media usage. When a student downloads a video or PDF
-- to their mobile app for offline viewing, it is logged here to enforce device
-- limits and offline expiry. Supports remote revocation via is_revoked.
create table public.student_downloads (
  download_id   uuid                  not null  default gen_random_uuid(),
  student_id    uuid                  not null,
  resource_type resource_category_type not null,
  resource_id   uuid                  not null,
  device_id     text                  not null,
  downloaded_at timestamptz           not null  default now(),
  expires_at    timestamptz           null      default null,
  is_revoked    boolean               not null  default false,
  created_at    timestamptz           not null  default now(),

  -- Primary Key
  constraint pk_student_downloads primary key (download_id),

  -- Foreign Keys
  constraint fk_student_downloads_student
    foreign key (student_id) references public.student_details (student_id)
    on delete cascade
    on update restrict,

  -- Unique Constraints
  constraint uq_student_downloads_student_resource_device
    unique (student_id, resource_type, resource_id, device_id),

  -- CHECK Constraints
  constraint ck_student_downloads_expires_at check (
    expires_at is null or expires_at > downloaded_at
  )
);

-- 2c. Table: student_viewing_history
-- High-volume UPSERT table for "Recently Viewed" and "Resume Playback"
-- functionality. Tracks exactly where a student left off in a video or the
-- last time they opened a PDF. Uses ON CONFLICT DO UPDATE for efficient
-- position updates during video playback.
create table public.student_viewing_history (
  history_id            uuid                  not null  default gen_random_uuid(),
  student_id            uuid                  not null,
  resource_type         resource_category_type not null,
  resource_id           uuid                  not null,
  last_position_seconds integer               not null  default 0,
  is_completed          boolean               not null  default false,
  viewed_at             timestamptz           not null  default now(),

  -- Primary Key
  constraint pk_student_viewing_history primary key (history_id),

  -- Foreign Keys
  constraint fk_student_viewing_history_student
    foreign key (student_id) references public.student_details (student_id)
    on delete cascade
    on update restrict,

  -- Unique Constraints
  constraint uq_student_viewing_history_student_resource
    unique (student_id, resource_type, resource_id),

  -- CHECK Constraints
  constraint ck_student_viewing_history_last_position check (last_position_seconds >= 0)
);

-- 2d. Table: student_personal_notes
-- Allows students to write rich-text personal notes attached to a specific
-- video or document. Includes timestamp integration so clicking the note
-- jumps the video player to the correct time. Multiple notes allowed per
-- resource. CASCADE deletes with parent student.
create table public.student_personal_notes (
  note_id                 uuid                  not null  default gen_random_uuid(),
  student_id              uuid                  not null,
  resource_type           resource_category_type not null,
  resource_id             uuid                  not null,
  video_timestamp_seconds integer               null      default null,
  note_content            text                  not null,
  created_at              timestamptz           not null  default now(),
  updated_at              timestamptz           not null  default now(),

  -- Primary Key
  constraint pk_student_personal_notes primary key (note_id),

  -- Foreign Keys
  constraint fk_student_personal_notes_student
    foreign key (student_id) references public.student_details (student_id)
    on delete cascade
    on update restrict,

  -- CHECK Constraints
  constraint ck_student_personal_notes_video_timestamp check (
    video_timestamp_seconds is null or video_timestamp_seconds >= 0
  ),
  constraint ck_student_personal_notes_content_length check (
    char_length(note_content) > 0
  )
);

-- 2e. Table: student_doubts
-- The core of the academic Q&A engine. Students ask doubts related to a
-- subject, chapter, or a specific piece of content. Forms the top level of
-- a threaded discussion. Supports context linking (related_resource) for
-- questions raised from specific mock test questions or content items.
create table public.student_doubts (
  doubt_id              uuid                  not null  default gen_random_uuid(),
  student_id            uuid                  not null,
  subject_id            uuid                  not null,
  chapter_id            uuid                  null      default null,
  related_resource_type resource_category_type null     default null,
  related_resource_id   uuid                  null      default null,
  title                 text                  not null,
  description           text                  not null,
  image_url             text                  null      default null,
  status                doubt_status_type     not null  default 'open',
  resolved_by           uuid                  null      default null,
  created_at            timestamptz           not null  default now(),
  updated_at            timestamptz           not null  default now(),

  -- Primary Key
  constraint pk_student_doubts primary key (doubt_id),

  -- Foreign Keys
  constraint fk_student_doubts_student
    foreign key (student_id) references public.student_details (student_id)
    on delete cascade
    on update restrict,

  constraint fk_student_doubts_subject
    foreign key (subject_id) references public.subjects (subject_id)
    on delete restrict
    on update restrict,

  constraint fk_student_doubts_chapter
    foreign key (chapter_id) references public.chapters (chapter_id)
    on delete restrict
    on update restrict,

  constraint fk_student_doubts_resolved_by
    foreign key (resolved_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- CHECK Constraints
  constraint ck_student_doubts_title_length check (
    char_length(title) >= 5 and char_length(title) <= 200
  ),
  constraint ck_student_doubts_resolved_consistency check (
    (status = 'resolved' and resolved_by is not null)
    or (status != 'resolved')
  )
);

-- 2f. Table: doubt_replies
-- The replies and comments on a student_doubt. Can be posted by the original
-- student, peer students, or a teacher. Supports marking the accepted answer
-- to highlight the best response. CASCADE deletes with parent doubt.
create table public.doubt_replies (
  reply_id           uuid          not null  default gen_random_uuid(),
  doubt_id           uuid          not null,
  author_profile_id  uuid          not null,
  reply_text         text          not null,
  image_url          text          null      default null,
  is_accepted_answer boolean       not null  default false,
  created_at         timestamptz   not null  default now(),
  updated_at         timestamptz   not null  default now(),

  -- Primary Key
  constraint pk_doubt_replies primary key (reply_id),

  -- Foreign Keys
  constraint fk_doubt_replies_doubt
    foreign key (doubt_id) references public.student_doubts (doubt_id)
    on delete cascade
    on update restrict,

  constraint fk_doubt_replies_author
    foreign key (author_profile_id) references public.profiles (profile_id)
    on delete cascade
    on update restrict,

  -- CHECK Constraints
  constraint ck_doubt_replies_text_length check (char_length(reply_text) > 0)
);

-- 2g. Table: support_tickets
-- A formal helpdesk for non-academic issues (e.g., billing disputes, technical
-- problems, account management). Each ticket has a category for routing and a
-- priority for SLA management. CASCADE deletes with parent student.
create table public.support_tickets (
  ticket_id     uuid                 not null  default gen_random_uuid(),
  student_id    uuid                 not null,
  category      ticket_category_type not null,
  priority      ticket_priority_type not null  default 'medium',
  status        ticket_status_type   not null  default 'open',
  subject       text                 not null,
  assigned_to   uuid                 null      default null,
  created_at    timestamptz          not null  default now(),
  updated_at    timestamptz          not null  default now(),

  -- Primary Key
  constraint pk_support_tickets primary key (ticket_id),

  -- Foreign Keys
  constraint fk_support_tickets_student
    foreign key (student_id) references public.student_details (student_id)
    on delete cascade
    on update restrict,

  constraint fk_support_tickets_assigned_to
    foreign key (assigned_to) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- CHECK Constraints
  constraint ck_support_tickets_subject_length check (char_length(subject) > 0)
);

-- 2h. Table: support_ticket_messages
-- The conversational back-and-forth log for a support_ticket.
-- Messages cannot be deleted to ensure an immutable customer service audit
-- trail. CASCADE deletes with parent ticket.
create table public.support_ticket_messages (
  message_id        uuid          not null  default gen_random_uuid(),
  ticket_id         uuid          not null,
  sender_profile_id uuid          not null,
  message_body      text          not null,
  attachment_url    text          null      default null,
  created_at        timestamptz   not null  default now(),

  -- Primary Key
  constraint pk_support_ticket_messages primary key (message_id),

  -- Foreign Keys
  constraint fk_support_ticket_messages_ticket
    foreign key (ticket_id) references public.support_tickets (ticket_id)
    on delete cascade
    on update restrict,

  constraint fk_support_ticket_messages_sender
    foreign key (sender_profile_id) references public.profiles (profile_id)
    on delete cascade
    on update restrict,

  -- CHECK Constraints
  constraint ck_support_ticket_messages_body_length check (char_length(message_body) > 0)
);

-- 2i. Table: student_feedback_ratings
-- Collects 1-to-5 star ratings and reviews for platform entities (Live Classes,
-- Teachers, Mock Tests, Content). One rating per student per target entity
-- (UPSERT-able). Fuels aggregate ratings on teacher profiles and dashboards.
-- Ratings are computed into cached averages via nightly CRON jobs.
create table public.student_feedback_ratings (
  feedback_id   uuid                  not null  default gen_random_uuid(),
  student_id    uuid                  not null,
  target_type   resource_category_type not null,
  target_id     uuid                  not null,
  rating        smallint              not null,
  review_text   text                  null      default null,
  is_public     boolean               not null  default true,
  created_at    timestamptz           not null  default now(),
  updated_at    timestamptz           not null  default now(),

  -- Primary Key
  constraint pk_student_feedback_ratings primary key (feedback_id),

  -- Foreign Keys
  constraint fk_student_feedback_ratings_student
    foreign key (student_id) references public.student_details (student_id)
    on delete cascade
    on update restrict,

  -- Unique Constraints
  constraint uq_student_feedback_ratings_student_target
    unique (student_id, target_type, target_id),

  -- CHECK Constraints
  constraint ck_student_feedback_ratings_rating check (
    rating >= 1 and rating <= 5
  )
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Indexes
-- ════════════════════════════════════════════════════════════════════════════
-- All indexes are created after their respective tables exist.
-- No duplicate indexes on columns already covered by UNIQUE constraints.

-- 3a. student_bookmarks indexes
-- Render the student bookmark directory grouped by folder.
create index if not exists idx_bookmarks_student_folder
  on public.student_bookmarks (student_id, folder_name);

-- 3b. student_downloads indexes
-- Validate DRM device limits: count distinct devices per student.
create index if not exists idx_downloads_student_device
  on public.student_downloads (student_id, device_id);

-- 3c. student_viewing_history indexes
-- Load the Continue Learning / Recently Viewed carousel on the dashboard.
create index if not exists idx_history_student_viewed
  on public.student_viewing_history (student_id, viewed_at desc);

-- 3d. student_personal_notes indexes
-- Fetch all personal notes for the currently active video or document.
create index if not exists idx_notes_student_resource
  on public.student_personal_notes (student_id, resource_type, resource_id);

-- 3e. student_doubts indexes
-- Teachers find open doubts for their assigned subjects.
create index if not exists idx_doubts_subject_status
  on public.student_doubts (subject_id, status);

-- Student dashboard My Doubts section, newest first.
create index if not exists idx_doubts_student
  on public.student_doubts (student_id, created_at desc);

-- 3f. doubt_replies indexes
-- Fetch threaded replies in chronological order for a doubt.
create index if not exists idx_doubt_replies_doubt
  on public.doubt_replies (doubt_id, created_at);

-- 3g. support_tickets indexes
-- Admin support dashboard: triage urgent tickets by status and priority.
create index if not exists idx_tickets_status_priority
  on public.support_tickets (status, priority);

-- Student support history, newest first.
create index if not exists idx_tickets_student
  on public.support_tickets (student_id, created_at desc);

-- 3h. support_ticket_messages indexes
-- Load conversation history for a ticket in chronological order.
create index if not exists idx_ticket_messages_ticket
  on public.support_ticket_messages (ticket_id, created_at);

-- 3i. student_feedback_ratings indexes
-- Aggregate average ratings quickly for a target entity.
create index if not exists idx_feedback_target
  on public.student_feedback_ratings (target_type, target_id, rating);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Functions That Reference Tables
-- ════════════════════════════════════════════════════════════════════════════
-- These functions are created after all tables exist because they reference
-- tables in their implementations.

-- 4a. Auto-resolve doubt when reply is marked as accepted answer
-- When a reply is marked is_accepted_answer = TRUE, automatically update
-- the parent student_doubts row to set status = 'resolved' and
-- resolved_by = the reply's author.
create or replace function public.trgfn_doubt_auto_resolve()
returns trigger
language plpgsql
as $$
begin
  if new.is_accepted_answer = true then
    update public.student_doubts
       set status = 'resolved',
           resolved_by = new.author_profile_id
     where doubt_id = new.doubt_id
       and status != 'resolved';
  end if;
  return new;
end;
$$;

-- 4b. Auto-update support ticket status on message
-- When an admin sends a message, set ticket status to waiting_on_student.
-- When a student sends a message, set ticket status to in_progress.
-- Only updates if the ticket is not already resolved or closed.
create or replace function public.trgfn_ticket_auto_status()
returns trigger
language plpgsql
as $$
declare
  v_student_id uuid;
  v_ticket_status ticket_status_type;
begin
  -- Get the ticket's student_id and current status
  select student_id, status into v_student_id, v_ticket_status
    from public.support_tickets
   where ticket_id = new.ticket_id;

  -- Only auto-update if the ticket is still active (not resolved/closed)
  if v_ticket_status not in ('resolved', 'closed') then
    if new.sender_profile_id = v_student_id then
      -- Student replied → set to in_progress
      update public.support_tickets
         set status = 'in_progress'
       where ticket_id = new.ticket_id;
    else
      -- Admin replied → set to waiting_on_student
      update public.support_tickets
         set status = 'waiting_on_student'
       where ticket_id = new.ticket_id;
    end if;
  end if;
  return new;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — CREATE TRIGGER Statements
-- ════════════════════════════════════════════════════════════════════════════
-- Only tables with an updated_at column receive the set_updated_at trigger.
-- set_updated_at() already exists from Domain 01 — do not recreate.
-- student_bookmarks has no updated_at column (insert-only).
-- student_downloads has no updated_at column (insert-only; revocation uses
--   direct UPDATE on is_revoked).
-- student_viewing_history has no updated_at column (uses viewed_at).

-- 5a. student_personal_notes triggers
create trigger trg_student_personal_notes_set_updated_at
  before update on public.student_personal_notes
  for each row
  execute function public.set_updated_at();

-- 5b. student_doubts triggers
create trigger trg_student_doubts_set_updated_at
  before update on public.student_doubts
  for each row
  execute function public.set_updated_at();

-- 5c. doubt_replies triggers
create trigger trg_doubt_replies_set_updated_at
  before update on public.doubt_replies
  for each row
  execute function public.set_updated_at();

create trigger trg_doubt_replies_auto_resolve
  after insert or update on public.doubt_replies
  for each row
  when (new.is_accepted_answer = true)
  execute function public.trgfn_doubt_auto_resolve();

-- 5d. support_tickets triggers
create trigger trg_support_tickets_set_updated_at
  before update on public.support_tickets
  for each row
  execute function public.set_updated_at();

-- 5e. support_ticket_messages triggers
create trigger trg_support_ticket_messages_auto_status
  after insert on public.support_ticket_messages
  for each row
  execute function public.trgfn_ticket_auto_status();

-- 5f. student_feedback_ratings triggers
create trigger trg_student_feedback_ratings_set_updated_at
  before update on public.student_feedback_ratings
  for each row
  execute function public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — COMMENT Statements
-- ════════════════════════════════════════════════════════════════════════════

-- 6a. Table comments
comment on table public.student_bookmarks is
  'Allows students to save Questions, Live Classes, PDF Notes, or PYQ Papers '
  'for quick access later. Supports lightweight organization via folders. '
  'Hard deleted when a student un-bookmarks an item. CASCADE with parent student.';

comment on table public.student_downloads is
  'Tracks DRM and offline media usage for enforcing device limits and offline '
  'expiry. Supports remote revocation via is_revoked flag. One row per unique '
  'student-resource-device combination. CASCADE with parent student.';

comment on table public.student_viewing_history is
  'High-volume UPSERT table for Recently Viewed and Resume Playback. Tracks '
  'where a student left off in a video or the last time they opened a PDF. '
  'Use ON CONFLICT DO UPDATE for efficient position updates. Viewing progress '
  'should be buffered and flushed periodically, not written on every ping.';

comment on table public.student_personal_notes is
  'Rich-text personal notes attached to a specific video or document. Includes '
  'video_timestamp_seconds for timestamp-linked playback jumping. Multiple '
  'notes per resource are allowed. CASCADE with parent student.';

comment on table public.student_doubts is
  'Core of the academic Q&A engine. Students ask doubts related to a subject, '
  'chapter, or specific content item. Supports threaded discussions via '
  'doubt_replies. Status drives the workflow: open → in_progress → resolved/archived.';

comment on table public.doubt_replies is
  'Replies and comments on a student_doubt. Can be posted by the original '
  'student, peer students, or a teacher. Marking is_accepted_answer = TRUE '
  'triggers auto-resolve of the parent doubt via database trigger.';

comment on table public.support_tickets is
  'Formal helpdesk for non-academic issues (billing, technical, account). '
  'Each ticket has a category for routing and a priority for SLA management. '
  'Status auto-updates when messages are exchanged. CASCADE with parent student.';

comment on table public.support_ticket_messages is
  'Conversational back-and-forth log for a support_ticket. Messages cannot be '
  'deleted to ensure an immutable customer service audit trail. Sending a '
  'message auto-updates the parent ticket status via trigger.';

comment on table public.student_feedback_ratings is
  '1-to-5 star ratings and reviews for platform entities (Live Classes, '
  'Teachers, Mock Tests, Content). One rating per student per target entity. '
  'Aggregate ratings should be computed via nightly CRON jobs into cached '
  'average_rating fields on target tables, not queried live over millions of rows.';

-- 6b. Column comments — student_bookmarks
comment on column public.student_bookmarks.folder_name is
  'Allows students to group bookmarks (e.g. Hard Physics Questions, Review '
  'Before Exam). Default folder is General. Maximum 50 characters.';

comment on column public.student_bookmarks.notes is
  'Brief reminder of why the resource was saved (e.g. Review before exam).';

-- 6c. Column comments — student_downloads
comment on column public.student_downloads.device_id is
  'Unique identifier of the mobile device (used for DRM device-limit enforcement). '
  'Should be a device-scoped UUID generated by the mobile app, not a hardware ID.';

comment on column public.student_downloads.expires_at is
  'When the offline DRM lease expires (e.g. 30 days after download). NULL for '
  'permanent downloads. Must be after downloaded_at when set.';

comment on column public.student_downloads.is_revoked is
  'Allows admins to remotely wipe downloaded content access. When TRUE, the '
  'mobile app should remove the local copy on its next sync.';

-- 6d. Column comments — student_viewing_history
comment on column public.student_viewing_history.last_position_seconds is
  'Where to resume playback (in seconds from start). 0 for non-video content '
  'or content not yet started.';

comment on column public.student_viewing_history.is_completed is
  'Set to TRUE when progress exceeds approximately 90%. Used to filter '
  'completed items from the Continue Learning carousel.';

comment on column public.student_viewing_history.viewed_at is
  'Last interaction timestamp. Updated on every UPSERT for ordering the '
  'Recently Viewed carousel.';

-- 6e. Column comments — student_personal_notes
comment on column public.student_personal_notes.video_timestamp_seconds is
  'If the note is for a video, the exact time it references. Clicking the '
  'note in the UI should jump the video player to this timestamp. NULL for '
  'notes on PDFs, documents, or non-video content.';

comment on column public.student_personal_notes.note_content is
  'Rich text or Markdown content of the note. Minimum 1 character. Protect '
  'against large payload abuse at the application layer (recommended max 10000 chars).';

-- 6f. Column comments — student_doubts
comment on column public.student_doubts.subject_id is
  'FK to subjects. The academic subject context for the doubt. Required — '
  'all doubts must be categorised to a subject for routing to the correct teachers.';

comment on column public.student_doubts.chapter_id is
  'Optional FK to chapters for deeper syllabus context. NULL for doubts that '
  'span multiple chapters or are general subject-level questions.';

comment on column public.student_doubts.related_resource_type is
  'Optional polymorphic reference: did the student ask this doubt from a '
  'specific mock test question, content item, or live class? NULL if the '
  'doubt was asked without a specific resource context.';

comment on column public.student_doubts.related_resource_id is
  'The UUID of the related resource when related_resource_type is set. No FK '
  'constraint due to polymorphic nature.';

comment on column public.student_doubts.title is
  'Short summary of the doubt. Must be 5-200 characters.';

comment on column public.student_doubts.description is
  'Detailed explanation of the doubt. Supports Markdown and LaTeX math '
  'notation (e.g. $\\int x dx$) for mathematical content.';

comment on column public.student_doubts.image_url is
  'Optional attached screenshot or diagram (references Domain 12 Media for '
  'storage, but stored as a URL string for simplicity).';

comment on column public.student_doubts.resolved_by is
  'FK to profiles. The teacher or admin who resolved the doubt. Populated '
  'automatically when a reply is marked as the accepted answer.';

-- 6g. Column comments — doubt_replies
comment on column public.doubt_replies.author_profile_id is
  'FK to profiles. The author of this reply — can be a student, teacher, '
  'or admin. CASCADE on delete to preserve thread integrity.';

comment on column public.doubt_replies.reply_text is
  'The response content. Supports Markdown and LaTeX for mathematical content. '
  'Minimum 1 character.';

comment on column public.doubt_replies.is_accepted_answer is
  'Marked TRUE by the original student or a teacher to highlight the best '
  'answer. Setting this triggers auto-resolve of the parent doubt via trigger. '
  'Only one accepted answer should exist per doubt (enforced at application layer).';

-- 6h. Column comments — support_tickets
comment on column public.support_tickets.category is
  'Routes the ticket to the correct admin queue: billing, technical, academic, '
  'account, or other.';

comment on column public.support_tickets.priority is
  'Dictates SLA and response time: low, medium, high, urgent. Default medium. '
  'Auto-escalation rules should be implemented at the application layer.';

comment on column public.support_tickets.status is
  'Helpdesk state machine: open → in_progress ↔ waiting_on_student → resolved → closed. '
  'Auto-advanced when messages are exchanged.';

comment on column public.support_tickets.subject is
  'Summary of the issue. Minimum 1 character. Should be concise for the '
  'admin dashboard queue view.';

comment on column public.support_tickets.assigned_to is
  'FK to profiles. The admin or support agent currently handling this ticket. '
  'SET NULL on profile soft-delete preserves the ticket record.';

-- 6i. Column comments — support_ticket_messages
comment on column public.support_ticket_messages.sender_profile_id is
  'FK to profiles. The sender of this message — can be a student or an admin. '
  'CASCADE on delete preserves the conversation audit trail.';

comment on column public.support_ticket_messages.message_body is
  'The actual text of the message. Minimum 1 character. Supports formatted '
  'text; rich formatting is handled at the application layer.';

comment on column public.support_ticket_messages.attachment_url is
  'Optional link to an attachment (screenshot, receipt, document). References '
  'Domain 12 Media or an external URL. NULL for text-only messages.';

-- 6j. Column comments — student_feedback_ratings
comment on column public.student_feedback_ratings.target_type is
  'The type of entity being rated: content, question, live_class, pyq_paper, '
  'mock_test, or teacher.';

comment on column public.student_feedback_ratings.target_id is
  'The UUID of the entity being rated. No FK constraint due to polymorphic '
  'nature. Referential integrity enforced at the application layer.';

comment on column public.student_feedback_ratings.rating is
  'Numeric score from 1 to 5. 1 = worst, 5 = best. Enforced via CHECK constraint.';

comment on column public.student_feedback_ratings.review_text is
  'Optional written feedback accompanying the rating. NULL for ratings without '
  'a written review.';

comment on column public.student_feedback_ratings.is_public is
  'When TRUE, the rating and review can be displayed publicly as a testimonial. '
  'When FALSE, the rating is used only for internal analytics. Default TRUE.';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — Domain 14 Student Services
-- ════════════════════════════════════════════════════════════════════════════
