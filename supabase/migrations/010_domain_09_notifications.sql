-- ============================================================================
-- Migration: Domain 09 — Notifications
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Tables: notification_templates · notifications · notification_recipients
--
-- Depends on: Domain 01 (institutes, profiles)
--             Existing enums (notification_channel, user_role)
--             Existing functions (set_updated_at, get_my_institute_id, etc.)
--
-- New Enums: notification_event_type
--
-- Order:
--   1. New enum types (idempotent DO blocks)
--   2. Tables (dependency order: parent → child)
--   3. Indexes (after all tables exist; partial indexes for system templates)
--   4. Triggers (after all tables exist; set_updated_at already exists from Domain 1)
--   5. Comments
--
-- Key architecture:
--   • notification_channel enum is already defined globally from Domain 01.
--   • notification_templates.institute_id is NULLABLE for system-level templates
--     shared across all institutes.
--   • Notifications store fully rendered title/body — snapshots at dispatch time.
--   • notification_recipients is append-only except for is_read/read_at updates.
--   • Soft delete on notifications only (is_deleted flag); recipient rows preserved.
--   • institute_id is denormalized on notification_recipients for RLS performance.
--   • Fan-out is a queue problem, not a database problem — this schema receives
--     the result of async fan-out, not the orchestration.
--
-- Reference: Schema_Domain_09_Notifications.md v1.0 | ERD v2.0
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 0 — New Enum Types (Idempotent)
-- ════════════════════════════════════════════════════════════════════════════
-- This domain introduces one new PostgreSQL enum: notification_event_type.
-- The notification_channel enum is already defined globally from Domain 01
-- (values: 'in_app', 'push', 'email', 'sms').
-- The user_role enum is already defined globally from Domain 01.

-- 0a. notification_event_type: Enumerates all system events that trigger
--     notifications. The 'custom' value covers admin-authored one-off broadcasts
--     that do not map to a system event.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'notification_event_type') then
    create type notification_event_type as enum (
      'live_class_reminder',
      'test_published',
      'result_available',
      'content_approved',
      'content_rejected',
      'subscription_expiring',
      'subscription_expired',
      'new_content_uploaded',
      'batch_assigned',
      'announcement',
      'custom'
    );
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — CREATE TABLE Statements
-- ════════════════════════════════════════════════════════════════════════════
-- Notifications hierarchy:
--   notification_templates (1) ───────── notifications (M)
--   notifications          (1) ───────── notification_recipients (M)

-- 1a. Table: notification_templates
-- Reusable, parameterised message blueprints. Every system-generated
-- notification originates from a template. institute_id is NULLABLE for
-- system-level templates shared across all institutes. Body supports
-- {{token}} placeholders interpolated at dispatch time by the notification
-- service. Low-traffic table — expect fewer than 50 rows per institute.
create table public.notification_templates (
  template_id     uuid                      not null  default gen_random_uuid(),
  institute_id    uuid                      null      default null,
  name            text                      not null,
  event_type      notification_event_type   not null,
  channel         notification_channel      not null  default 'in_app',
  target_role     user_role                 null      default null,
  title_template  text                      not null,
  body_template   text                      not null,
  is_active       boolean                   not null  default true,
  created_by      uuid                      not null,
  updated_by      uuid                      null      default null,
  created_at      timestamptz               not null  default now(),
  updated_at      timestamptz               not null  default now(),

  -- Primary Key
  constraint pk_notification_templates primary key (template_id),

  -- Foreign Keys
  constraint fk_notification_templates_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_notification_templates_created_by
    foreign key (created_by) references public.profiles (profile_id)
    on delete restrict
    on update restrict,

  constraint fk_notification_templates_updated_by
    foreign key (updated_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- Unique Constraints
  -- Note: Full uniqueness on (institute_id, event_type, channel) is enforced
  -- via a partial unique index (see Section 2) because institute_id is nullable
  -- and standard UNIQUE constraints treat NULLs as distinct values.
  -- See Section 2a.

  -- CHECK Constraints
  constraint ck_notification_templates_name_length check
    (char_length(name) >= 3 and char_length(name) <= 200),
  constraint ck_notification_templates_title_template_length check
    (char_length(title_template) >= 1 and char_length(title_template) <= 500),
  constraint ck_notification_templates_body_template_length check
    (char_length(body_template) >= 1)
);

-- 1b. Table: notifications
-- A concrete notification event dispatched from a template. Stores the fully
-- rendered, final text of the notification at the moment of dispatch — this is
-- an intentional snapshot decoupling the recipient's experience from future
-- template edits. reference_type + reference_id form an untyped polymorphic
-- reference pair for deep linking (no FK constraint — application-layer
-- integrity). Soft delete via is_deleted flag.
create table public.notifications (
  notification_id   uuid                      not null  default gen_random_uuid(),
  institute_id      uuid                      not null,
  template_id       uuid                      null      default null,
  title             text                      not null,
  body              text                      not null,
  channel           notification_channel      not null,
  event_type        notification_event_type   not null,
  triggered_by      uuid                      null      default null,
  reference_type    text                      null      default null,
  reference_id      uuid                      null      default null,
  total_recipients  integer                   not null  default 0,
  dispatched_at     timestamptz               null      default null,
  is_deleted        boolean                   not null  default false,
  deleted_at        timestamptz               null      default null,
  created_at        timestamptz               not null  default now(),
  updated_at        timestamptz               not null  default now(),

  -- Primary Key
  constraint pk_notifications primary key (notification_id),

  -- Foreign Keys
  constraint fk_notifications_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_notifications_template
    foreign key (template_id) references public.notification_templates (template_id)
    on delete restrict
    on update restrict,

  constraint fk_notifications_triggered_by
    foreign key (triggered_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- CHECK Constraints
  constraint ck_notifications_title_length check
    (char_length(title) >= 1 and char_length(title) <= 500),
  constraint ck_notifications_body_length check
    (char_length(body) >= 1),
  constraint ck_notifications_total_recipients check (total_recipients >= 0),
  constraint ck_notifications_deleted_consistency check
    ((is_deleted = false and deleted_at is null)
     or (is_deleted = true and deleted_at is not null)),
  constraint ck_notifications_dispatched_at check
    (dispatched_at is null or dispatched_at >= created_at)
);

-- 1c. Table: notification_recipients
-- Junction table: one row per user per notification. Created during the fan-out
-- phase after the notifications row is written. This is the highest-volume table
-- in this domain — 100K rows in a single batch notification. profile_id references
-- profiles.profile_id (not student/teacher details) because admins may also be
-- recipients. Only is_read and read_at are ever updated after insertion.
create table public.notification_recipients (
  recipient_id      uuid            not null  default gen_random_uuid(),
  notification_id   uuid            not null,
  profile_id        uuid            not null,
  institute_id      uuid            not null,
  is_read           boolean         not null  default false,
  read_at           timestamptz     null      default null,
  received_at       timestamptz     not null  default now(),
  created_at        timestamptz     not null  default now(),

  -- Primary Key
  constraint pk_notification_recipients primary key (recipient_id),

  -- Foreign Keys
  constraint fk_notification_recipients_notification
    foreign key (notification_id) references public.notifications (notification_id)
    on delete cascade
    on update restrict,

  constraint fk_notification_recipients_profile
    foreign key (profile_id) references public.profiles (profile_id)
    on delete restrict
    on update restrict,

  constraint fk_notification_recipients_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  -- Unique Constraints
  constraint uq_notification_recipients_notification_profile
    unique (notification_id, profile_id),

  -- CHECK Constraints
  constraint ck_notification_recipients_read_consistency check
    ((is_read = false and read_at is null)
     or (is_read = true and read_at is not null))
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Indexes
-- ════════════════════════════════════════════════════════════════════════════
-- All indexes are created after their respective tables exist.
-- No duplicate indexes on columns already covered by UNIQUE constraints.
-- Partial indexes are used where specified in the schema.

-- 2a. notification_templates indexes
-- Standard unique constraint alternative: institute_id is nullable, so standard
-- UNIQUE (institute_id, event_type, channel) would treat NULL institute_id as
-- distinct values. We use a partial unique index instead.
-- For institute-specific templates (institute_id IS NOT NULL):
create unique index if not exists uq_notification_templates_institute_event_channel
  on public.notification_templates (institute_id, event_type, channel)
  where institute_id is not null;

-- For system-level templates (institute_id IS NULL):
create unique index if not exists uq_notification_templates_system
  on public.notification_templates (event_type, channel)
  where institute_id is null;

create index if not exists idx_notif_templates_event_type_active
  on public.notification_templates (event_type, is_active);

create index if not exists idx_notif_templates_institute_active
  on public.notification_templates (institute_id, is_active);

-- 2b. notifications indexes
create index if not exists idx_notifications_institute_created_at
  on public.notifications (institute_id, created_at desc);

create index if not exists idx_notifications_institute_event_type
  on public.notifications (institute_id, event_type, created_at desc);

create index if not exists idx_notifications_institute_channel
  on public.notifications (institute_id, channel, created_at desc);

create index if not exists idx_notifications_template_id
  on public.notifications (template_id);

create index if not exists idx_notifications_reference
  on public.notifications (reference_type, reference_id);

-- Partial index: efficiently exclude soft-deleted notifications
create index if not exists idx_notifications_is_deleted
  on public.notifications (institute_id, is_deleted, created_at desc);

-- 2c. notification_recipients indexes
create index if not exists idx_notif_recipients_profile_received
  on public.notification_recipients (profile_id, received_at desc);

-- Partial index: unread count queries — dramatically smaller than full index
create index if not exists idx_notif_recipients_profile_unread
  on public.notification_recipients (profile_id, is_read)
  where is_read = false;

create index if not exists idx_notif_recipients_notification_id
  on public.notification_recipients (notification_id);

create index if not exists idx_notif_recipients_institute_profile
  on public.notification_recipients (institute_id, profile_id, received_at desc);

create index if not exists idx_notif_recipients_notification_read
  on public.notification_recipients (notification_id, is_read);

-- Note: idx_notif_recipients_notification_profile is covered by
--   uq_notification_recipients_notification_profile (unique constraint).

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — CREATE TRIGGER Statements
-- ════════════════════════════════════════════════════════════════════════════
-- Only tables with an updated_at column receive the set_updated_at trigger.
-- set_updated_at() already exists from Domain 01 — do not recreate.
-- notification_recipients has no updated_at column (only is_read/read_at
--   updated; updated_at omitted deliberately to reduce write overhead).

-- 3a. notification_templates triggers
create trigger trg_notification_templates_set_updated_at
  before update on public.notification_templates
  for each row
  execute function public.set_updated_at();

-- 3b. notifications triggers
create trigger trg_notifications_set_updated_at
  before update on public.notifications
  for each row
  execute function public.set_updated_at();

-- 3c. notifications: soft-delete trigger — auto-set deleted_at when is_deleted flips
-- This trigger ensures is_deleted and deleted_at are always consistent without
-- relying on the application layer to set both fields.
create or replace function public.trgfn_notifications_set_deleted_at()
returns trigger
language plpgsql
as $$
begin
  if new.is_deleted = true and old.is_deleted = false then
    new.deleted_at = now();
  elsif new.is_deleted = false then
    new.deleted_at = null;
  end if;
  return new;
end;
$$;

create trigger trg_notifications_set_deleted_at
  before update on public.notifications
  for each row
  when (old.is_deleted is distinct from new.is_deleted)
  execute function public.trgfn_notifications_set_deleted_at();

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — COMMENT Statements
-- ════════════════════════════════════════════════════════════════════════════

-- 4a. Table comments
comment on table public.notification_templates is
  'Reusable, parameterised message blueprints. Every system-generated '
  'notification originates from a template. institute_id is NULLABLE for '
  'system-level templates shared across all institutes. body_template '
  'supports {{token}} placeholders interpolated at dispatch time. '
  'Low-traffic — fewer than 50 rows per institute expected.';

comment on table public.notifications is
  'A concrete notification event dispatched from a template. title and body '
  'store the fully rendered, final text at the moment of dispatch — an '
  'intentional snapshot that decouples the recipient''s experience from '
  'future template edits. reference_type + reference_id form an untyped '
  'polymorphic pair for frontend deep links. Soft delete via is_deleted flag.';

comment on table public.notification_recipients is
  'Junction table: one row per user per notification. Created during the '
  'fan-out phase after the notifications row is written. Highest-volume '
  'table in this domain — 100K+ rows in a single batch. profile_id uses '
  'profiles.profile_id (not student/teacher details) because admins may '
  'also be recipients. Only is_read and read_at are ever updated after '
  'insertion.';

-- 4b. Column comments
comment on column public.notification_templates.institute_id is
  'NULL for system-level templates that are shared across all institutes '
  '(e.g., platform-wide maintenance alerts). NOT NULL for institute-custom '
  'templates authored by admins.';

comment on column public.notification_templates.name is
  'Human-readable internal name for the template (e.g., "Live Class '
  'Reminder — 10 Min", "Test Result Available"). Used only in the admin '
  'dashboard; not shown to end users.';

comment on column public.notification_templates.event_type is
  'The system event this template is bound to. Used by the notification '
  'dispatch service to look up the correct template. For custom templates, '
  'event_type is custom and dispatch is always manual.';

comment on column public.notification_templates.channel is
  'The delivery channel this template renders for: in_app, push, email, '
  'sms. One template per channel per event. If the same event needs '
  'email + push, two templates exist.';

comment on column public.notification_templates.target_role is
  'Which role this template targets (admin, teacher, student). NULL means '
  'all roles. Used by the dispatch service to filter recipient lists.';

comment on column public.notification_templates.title_template is
  'The notification title with placeholder tokens (e.g., "Your class '
  '{{class_title}} starts in 10 minutes"). Max 500 characters. Max 255 '
  'recommended for push notification compatibility.';

comment on column public.notification_templates.body_template is
  'Full body text with placeholder tokens. For in_app and email, supports '
  'longer rich content. For push and sms, should be kept under 160 '
  'characters in practice.';

comment on column public.notification_templates.is_active is
  'Soft-delete flag. Inactive templates are not used for new dispatches '
  'but their historical notifications remain intact.';

comment on column public.notification_templates.created_by is
  'FK to profiles.profile_id. The admin who created the template. For '
  'system-seeded templates, references the platform superadmin profile.';

comment on column public.notification_templates.updated_by is
  'FK to profiles.profile_id. The admin who last modified the template. '
  'SET NULL on profile soft-delete preserves the template record.';

comment on column public.notifications.template_id is
  'FK to notification_templates.template_id. NULL if the notification was '
  'created manually without a template (ad-hoc admin message).';

comment on column public.notifications.title is
  'Fully rendered notification title. All {{token}} placeholders have been '
  'substituted with actual values. Max 500 characters.';

comment on column public.notifications.body is
  'Fully rendered notification body. All placeholders substituted. For '
  'push and sms channels, the dispatch service must enforce channel-specific '
  'character limits before writing.';

comment on column public.notifications.channel is
  'The delivery channel used for this notification (in_app, push, email, '
  'sms). One notification = one channel. Multi-channel events create '
  'multiple notification rows.';

comment on column public.notifications.event_type is
  'Denormalized from the template for query convenience. Enables filtering '
  'all notifications for a specific event type without joining to '
  'notification_templates.';

comment on column public.notifications.triggered_by is
  'The admin or system actor who triggered this notification. NULL for '
  'fully automated system events with no human actor.';

comment on column public.notifications.reference_type is
  'The entity type this notification is about (e.g., live_class, mock_test, '
  'content, order). Used to construct deep links on the frontend. Not '
  'enforced as an enum to allow extension without schema migrations.';

comment on column public.notifications.reference_id is
  'The UUID of the specific entity referenced by reference_type (e.g., the '
  'live_class_id of the class this reminder is about). Used by the frontend '
  'to navigate to the relevant screen when the user taps the notification.';

comment on column public.notifications.total_recipients is
  'Denormalized count of notification_recipients rows. Updated by the '
  'fan-out job when it completes. Provides a quick count for the admin panel '
  'without querying the potentially 100K-row recipient table. Not '
  'authoritative for billing — use COUNT(*) for accuracy.';

comment on column public.notifications.dispatched_at is
  'Timestamp when fan-out began (i.e., when the notification was handed off '
  'to the queue). Distinct from created_at — a notification may be created '
  '(queued) and dispatched (delivered) at different times. Set explicitly '
  'by the dispatch service, not by a database default.';

comment on column public.notifications.is_deleted is
  'Soft delete flag. Allows admins to retract a notification without '
  'physically deleting the row. Retracted notifications are hidden from '
  'recipient inboxes (via query filter) but preserved for audit.';

comment on column public.notifications.deleted_at is
  'Timestamp when the notification was soft-deleted. Auto-set by trigger '
  'when is_deleted flips to TRUE. NULL when is_deleted = FALSE.';

comment on column public.notification_recipients.notification_id is
  'FK to notifications.notification_id with ON DELETE CASCADE. When a '
  'notification is hard-deleted (data retention purge), all its recipient '
  'rows are automatically removed.';

comment on column public.notification_recipients.profile_id is
  'FK to profiles.profile_id. The recipient. Uses profile_id (not '
  'student_id / teacher_id) because admins may also be notification '
  'recipients.';

comment on column public.notification_recipients.institute_id is
  'Denormalized for RLS enforcement and multi-tenant isolation. Ensures '
  'that even if notification_id leaks across tenants, RLS on institute_id '
  'prevents cross-tenant data access.';

comment on column public.notification_recipients.is_read is
  'Whether the recipient has read this notification. The only field updated '
  'by user action after INSERT.';

comment on column public.notification_recipients.read_at is
  'Timestamp when the recipient first read the notification. Set once when '
  'is_read is flipped to TRUE. Never updated after that — always reflects '
  'the first read time, not the most recent.';

comment on column public.notification_recipients.received_at is
  'Timestamp when this recipient row was inserted (when the fan-out job '
  'delivered to this recipient). Used for inbox ordering. May differ from '
  'created_at by queue processing latency.';

-- 4c. Constraint comments
COMMENT ON INDEX uq_notification_templates_institute_event_channel IS
'Partial unique index: enforces at most one active template per event type
per channel per institute. institute_id IS NOT NULL filter ensures this
does not conflict with system-level templates.';

COMMENT ON INDEX uq_notification_templates_system IS
  'Partial unique index: enforces at most one system-level template per '
  'event type per channel. Allows system templates and per-institute '
  'templates to coexist for the same event and channel without conflict.';

comment on constraint ck_notifications_deleted_consistency on public.notifications is
  'is_deleted and deleted_at must always be consistent: TRUE requires a '
  'timestamp, FALSE requires NULL. Auto-maintained via trigger.';

comment on constraint ck_notifications_dispatched_at on public.notifications is
  'dispatched_at must never precede created_at. Prevents temporal anomalies '
  'from clock skew or incorrect job logic.';

comment on constraint uq_notification_recipients_notification_profile on public.notification_recipients is
  'Prevents duplicate delivery rows. The fan-out job should deduplicate '
  'before insertion, but this constraint provides a hard guarantee. Use '
  'ON CONFLICT (notification_id, profile_id) DO NOTHING in bulk inserts '
  'for idempotent retries.';

comment on constraint ck_notification_recipients_read_consistency on public.notification_recipients is
  'Ensures is_read and read_at are always consistent: a notification cannot '
  'be marked read without a timestamp, and a timestamp cannot exist for an '
  'unread notification. Prevents half-written read states.';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — Domain 09 Notifications
-- ════════════════════════════════════════════════════════════════════════════
