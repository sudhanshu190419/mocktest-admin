-- ============================================================================
-- Migration: Domain 15 — Infrastructure & Operations
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Tables: api_keys · webhook_endpoints · webhook_delivery_logs · async_jobs ·
--         feature_flags · feature_flag_overrides · system_events_outbox
--
-- Depends on: Domain 01 (institutes, profiles)
--             Existing functions (set_updated_at, get_my_institute_id, etc.)
--             Domain 12 (job_status_type for media_processing_jobs)
--
-- New enums: async_job_status_type · webhook_status_type · outbox_status_type
--
-- Note: Domain 12 already defines job_status_type for media processing with
--   values (queued, running, completed, failed, retrying). Domain 15's
--   async_jobs requires a broader set including 'processing' and 'cancelled',
--   so a new async_job_status_type enum is created to avoid collision.
--
-- Order:
--   1. New Enum Types (idempotent)
--   2. Tables (dependency order: parent → child)
--   3. Indexes (after all tables exist)
--   4. Functions (table-referencing functions for triggers)
--   5. Triggers (after all tables and functions exist)
--   6. Comments
--
-- Reference: Schema_Domain_15_Infrastructure.md v1.0
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — New Enum Types (Idempotent)
-- ════════════════════════════════════════════════════════════════════════════
-- These enums are defined in this domain and used by the infrastructure
-- tables. Each creation is wrapped in an idempotent DO block.

-- 1a. async_job_status_type
-- State machine for background workers processing application-level jobs.
-- Uses a distinct name from Domain 12's media_processing job_status_type
-- because the values differ (processing and cancelled vs running).
do $$
begin
  if not exists (select 1 from pg_type where typname = 'async_job_status_type') then
    create type async_job_status_type as enum (
      'queued', 'processing', 'completed', 'failed', 'retrying', 'cancelled'
    );
  end if;
end $$;

-- 1b. webhook_status_type
-- Tracks outbound HTTP delivery requests to external webhook endpoints.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'webhook_status_type') then
    create type webhook_status_type as enum ('pending', 'success', 'failed', 'retrying');
  end if;
end $$;

-- 1c. outbox_status_type
-- State machine for the transactional outbox pattern used for cache
-- invalidation and event bus bridging.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'outbox_status_type') then
    create type outbox_status_type as enum ('pending', 'published', 'failed');
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — CREATE TABLE Statements
-- ════════════════════════════════════════════════════════════════════════════
-- Infrastructure: api_keys (programmatic access tokens)
--                 webhook_endpoints → webhook_delivery_logs
--                 async_jobs (application-level job queue)
--                 feature_flags → feature_flag_overrides
--                 system_events_outbox (transactional outbox pattern)

-- 2a. Table: api_keys
-- Allows Institutes or internal microservices to generate programmatic access
-- tokens. Raw keys are never stored — only their SHA-256 hashes. The raw key
-- is returned to the user exactly once on creation; if lost, a new key must
-- be rolled. Soft-delete via is_active = FALSE.
-- No updated_at column — keys are immutable after creation (update only
-- affects is_active, expires_at, and last_used_at).
create table public.api_keys (
  key_id        uuid          not null  default gen_random_uuid(),
  institute_id  uuid          null      default null,
  name          text          not null,
  key_prefix    text          not null,
  key_hash      text          not null,
  scopes        text[]        not null  default '{read_only}',
  expires_at    timestamptz   null      default null,
  last_used_at  timestamptz   null      default null,
  is_active     boolean       not null  default true,
  created_by    uuid          null      default null,
  created_at    timestamptz   not null  default now(),

  -- Primary Key
  constraint pk_api_keys primary key (key_id),

  -- Foreign Keys
  constraint fk_api_keys_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete cascade
    on update restrict,

  constraint fk_api_keys_created_by
    foreign key (created_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- Unique Constraints
  constraint uq_api_keys_hash unique (key_hash),

  -- CHECK Constraints
  constraint ck_api_keys_name_length check (char_length(name) > 0),
  constraint ck_api_keys_key_prefix_length check (char_length(key_prefix) >= 4)
);

-- 2b. Table: webhook_endpoints
-- Stores the destination HTTPS URLs where external systems want to be
-- notified about platform events (e.g. student.enrolled, payment.succeeded).
-- Secrets are used for HMAC SHA-256 payload signing via X-EdTech-Signature.
-- Soft-delete via is_active = FALSE.
create table public.webhook_endpoints (
  endpoint_id   uuid          not null  default gen_random_uuid(),
  institute_id  uuid          not null,
  url           text          not null,
  secret        text          not null,
  event_types   text[]        not null  default '{"*"}',
  description   text          null      default null,
  is_active     boolean       not null  default true,
  created_at    timestamptz   not null  default now(),

  -- Primary Key
  constraint pk_webhook_endpoints primary key (endpoint_id),

  -- Foreign Keys
  constraint fk_webhook_endpoints_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete cascade
    on update restrict,

  -- Unique Constraints
  constraint uq_webhook_endpoints_institute_url unique (institute_id, url),

  -- CHECK Constraints
  constraint ck_webhook_endpoints_url_https check (url ~ '^https://'),
  constraint ck_webhook_endpoints_secret_length check (char_length(secret) >= 16)
);

-- 2c. Table: webhook_delivery_logs
-- Audit log for webhook deliveries. Tracks payloads, HTTP responses, and
-- retry scheduling. Essential for debugging delivery failures. Rows older
-- than 30 days should be purged by a background job to prevent table bloat.
-- No updated_at column — append-only event log.
create table public.webhook_delivery_logs (
  log_id           uuid               not null  default gen_random_uuid(),
  endpoint_id      uuid               not null,
  event_type       text               not null,
  payload          jsonb              not null,
  status           webhook_status_type not null default 'pending',
  http_status_code smallint            null      default null,
  response_body    text                null      default null,
  attempt_count    smallint            not null  default 0,
  next_retry_at    timestamptz         null      default null,
  created_at       timestamptz         not null  default now(),

  -- Primary Key
  constraint pk_webhook_delivery_logs primary key (log_id),

  -- Foreign Keys
  constraint fk_webhook_delivery_logs_endpoint
    foreign key (endpoint_id) references public.webhook_endpoints (endpoint_id)
    on delete cascade
    on update restrict,

  -- CHECK Constraints
  constraint ck_webhook_delivery_logs_attempt_count check (attempt_count >= 0)
);

-- 2d. Table: async_jobs
-- A robust, application-level job queue. While pg_cron handles scheduling,
-- this table handles execution tracking for heavy tasks: PDF report generation,
-- bulk email fan-outs, media transcoding polling, and file cleanup.
-- Workers use SELECT ... FOR UPDATE SKIP LOCKED for safe concurrent processing.
-- No updated_at column — uses started_at and completed_at for lifecycle tracking.
create table public.async_jobs (
  job_id        uuid                  not null  default gen_random_uuid(),
  queue_name    text                  not null  default 'default',
  task_name     text                  not null,
  payload       jsonb                 not null  default '{}',
  status        async_job_status_type not null  default 'queued',
  priority      smallint              not null  default 0,
  run_at        timestamptz           not null  default now(),
  started_at    timestamptz           null      default null,
  completed_at  timestamptz           null      default null,
  attempts      smallint              not null  default 0,
  max_attempts  smallint              not null  default 3,
  last_error    text                  null      default null,
  created_at    timestamptz           not null  default now(),

  -- Primary Key
  constraint pk_async_jobs primary key (job_id),

  -- CHECK Constraints
  constraint ck_async_jobs_attempts check (attempts <= max_attempts),
  constraint ck_async_jobs_priority check (priority >= 0),
  constraint ck_async_jobs_task_name check (char_length(task_name) > 0)
);

-- 2e. Table: feature_flags
-- Centralised control for releasing new application capabilities. Allows the
-- engineering team to turn features on/off globally without deploying code.
-- Per-institute overrides are managed via feature_flag_overrides.
-- Hard-deleted when a feature is 100% rolled out.
create table public.feature_flags (
  flag_id           uuid          not null  default gen_random_uuid(),
  flag_key          text          not null,
  description       text          not null,
  is_global_enabled boolean       not null  default false,
  created_at        timestamptz   not null  default now(),

  -- Primary Key
  constraint pk_feature_flags primary key (flag_id),

  -- Unique Constraints
  constraint uq_feature_flags_key unique (flag_key),

  -- CHECK Constraints
  constraint ck_feature_flags_key_length check (char_length(flag_key) > 0),
  constraint ck_feature_flags_description_length check (char_length(description) > 0)
);

-- 2f. Table: feature_flag_overrides
-- Allows canary releases, beta testing, or premium gating by enabling or
-- disabling a feature flag for specific institutes regardless of the
-- is_global_enabled setting. One override per flag per institute.
create table public.feature_flag_overrides (
  override_id   uuid          not null  default gen_random_uuid(),
  flag_id       uuid          not null,
  institute_id  uuid          not null,
  is_enabled    boolean       not null  default true,
  created_at    timestamptz   not null  default now(),

  -- Primary Key
  constraint pk_feature_flag_overrides primary key (override_id),

  -- Foreign Keys
  constraint fk_feature_flag_overrides_flag
    foreign key (flag_id) references public.feature_flags (flag_id)
    on delete cascade
    on update restrict,

  constraint fk_feature_flag_overrides_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete cascade
    on update restrict,

  -- Unique Constraints
  constraint uq_feature_flag_overrides_flag_institute unique (flag_id, institute_id)
);

-- 2g. Table: system_events_outbox
-- Implements the Transactional Outbox Pattern for reliable cache invalidation
-- and cross-service event propagation. When a DB row changes, a Postgres
-- trigger inserts an event here in the same transaction. A background relay
-- worker reads pending events and pushes them to Redis, Elasticsearch, or
-- the message bus. Published rows are hard-deleted by a cron job.
create table public.system_events_outbox (
  event_id        uuid              not null  default gen_random_uuid(),
  aggregate_type  text              not null,
  aggregate_id    uuid              not null,
  event_type      text              not null,
  payload         jsonb             not null  default '{}',
  status          outbox_status_type not null default 'pending',
  error_log       text              null      default null,
  created_at      timestamptz       not null  default now(),

  -- Primary Key
  constraint pk_system_events_outbox primary key (event_id),

  -- CHECK Constraints
  constraint ck_system_events_outbox_aggregate_type check (char_length(aggregate_type) > 0),
  constraint ck_system_events_outbox_event_type check (char_length(event_type) > 0)
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Indexes
-- ════════════════════════════════════════════════════════════════════════════
-- All indexes are created after their respective tables exist.
-- No duplicate indexes on columns already covered by UNIQUE constraints.
-- Partial indexes used where specified in the schema.

-- 3a. api_keys indexes
-- Dashboard listing for admins filtering by institute.
create index if not exists idx_api_keys_institute
  on public.api_keys (institute_id, is_active);

-- Critical lookup index for the API gateway middleware (covered by UNIQUE).
-- Note: uq_api_keys_hash covers key_hash lookups.

-- 3b. webhook_endpoints indexes
-- Used by the event dispatcher to find active subscribers.
create index if not exists idx_webhook_endpoints_events
  on public.webhook_endpoints (institute_id, is_active);

-- Note: uq_webhook_endpoints_institute_url covers (institute_id, url) lookups.

-- 3c. webhook_delivery_logs indexes
-- Background worker polling for webhooks to resend.
create index if not exists idx_webhook_logs_retry
  on public.webhook_delivery_logs (status, next_retry_at)
  where status = 'retrying';

-- Admin UI delivery history for a specific endpoint.
create index if not exists idx_webhook_logs_endpoint
  on public.webhook_delivery_logs (endpoint_id, created_at desc);

-- 3d. async_jobs indexes
-- Critical performance index: used by workers pulling the next job via
-- SELECT ... FOR UPDATE SKIP LOCKED.
create index if not exists idx_async_jobs_poll
  on public.async_jobs (queue_name, status, run_at, priority);

-- Admin dashboard monitoring failed jobs.
create index if not exists idx_async_jobs_status
  on public.async_jobs (status, created_at);

-- 3e. feature_flags indexes
-- Fast lookups during frontend initialization (covered by UNIQUE).
-- Note: uq_feature_flags_key covers flag_key lookups.

-- 3f. feature_flag_overrides indexes
-- Resolve flags for a specific tenant.
create index if not exists idx_ff_overrides_institute
  on public.feature_flag_overrides (institute_id, is_enabled);

-- Note: uq_feature_flag_overrides_flag_institute covers (flag_id, institute_id).

-- 3g. system_events_outbox indexes
-- Used by the outbox relay worker to grab pending events in FIFO order.
create index if not exists idx_outbox_polling
  on public.system_events_outbox (status, created_at);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Functions That Reference Tables
-- ════════════════════════════════════════════════════════════════════════════
-- These functions are created after all tables exist because they reference
-- tables in their implementations.

-- 4a. Prevent deletion of webhook endpoints with undelivered logs
-- Ensures that webhook endpoints active in the delivery log pipeline are not
-- accidentally deleted. The FK CASCADE already handles this, but this
-- trigger provides a clearer error message for the admin UI.
create or replace function public.trgfn_webhook_prevent_active_deletion()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from public.webhook_delivery_logs
    where endpoint_id = old.endpoint_id
      and status in ('pending', 'retrying')
  ) then
    raise exception 'Cannot delete webhook endpoint % — it has undelivered messages. Deactivate it instead using is_active = FALSE.', old.endpoint_id;
  end if;
  return old;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — CREATE TRIGGER Statements
-- ════════════════════════════════════════════════════════════════════════════
-- Most tables in this domain have no updated_at column by design:
--   api_keys is immutable (only is_active/expires_at/last_used_at mutate)
--   webhook_endpoints created once, deactivated via is_active
--   webhook_delivery_logs append-only
--   async_jobs uses started_at/completed_at
--   feature_flags immutable after creation
--   feature_flag_overrides immutable after creation
--   system_events_outbox append-only

-- 5a. webhook_endpoints triggers
create trigger trg_webhook_endpoints_prevent_active_deletion
  before delete on public.webhook_endpoints
  for each row
  execute function public.trgfn_webhook_prevent_active_deletion();

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — COMMENT Statements
-- ════════════════════════════════════════════════════════════════════════════

-- 6a. Table comments
comment on table public.api_keys is
  'Programmatic access tokens for institutes and internal microservices. Raw '
  'keys are never stored — only their SHA-256 hashes. The raw key is returned '
  'to the user exactly once on creation. Soft-delete via is_active = FALSE.';

comment on table public.webhook_endpoints is
  'Destination HTTPS URLs where external systems receive platform event '
  'notifications (e.g. student.enrolled, payment.succeeded). Payloads are '
  'HMAC SHA-256 signed using the stored secret. Soft-delete via is_active = FALSE.';

comment on table public.webhook_delivery_logs is
  'Audit log for webhook deliveries. Tracks payloads, HTTP responses, and '
  'retry scheduling. Rows older than 30 days should be purged by a background '
  'file_cleanup job to prevent table bloat. Append-only event log.';

comment on table public.async_jobs is
  'Application-level job queue for heavy background tasks: PDF report generation, '
  'bulk email fan-outs, media transcoding polling, and file cleanup. Workers '
  'use SELECT ... FOR UPDATE SKIP LOCKED for safe concurrent processing. '
  'Completed/failed jobs should be auto-purged after 7 days.';

comment on table public.feature_flags is
  'Centralised control for releasing new application capabilities. Allows the '
  'engineering team to turn features on/off globally without deploying code. '
  'Per-institute overrides are managed via feature_flag_overrides. Hard-deleted '
  'when a feature reaches 100% rollout and legacy code is removed.';

comment on table public.feature_flag_overrides is
  'Per-institute overrides for feature flags. Enables canary releases, beta '
  'testing cohorts, or premium feature gating. An override takes precedence '
  'over the global is_global_enabled setting.';

comment on table public.system_events_outbox is
  'Transactional Outbox pattern implementation for reliable cache invalidation '
  'and cross-service event propagation. Postgres triggers insert events here '
  'in the same transaction as the data change. A background relay worker reads '
  'pending events and pushes them to Redis, search indexes, or the message bus. '
  'Published rows are hard-deleted by a daily cron job to keep the table small.';

-- 6b. Column comments — api_keys
comment on column public.api_keys.institute_id is
  'FK to institutes. NULL if this is a global platform-level key (e.g. for '
  'internal microservices). CASCADE delete — removing an institute revokes '
  'all its API keys instantly.';

comment on column public.api_keys.name is
  'Human-readable identifier for the key (e.g. Zapier Integration, ERP Sync).';

comment on column public.api_keys.key_prefix is
  'The first 8 characters of the raw key (e.g. edtech_live_a1b2...). Used for '
  'UI identification without exposing the full key. Minimum 4 characters.';

comment on column public.api_keys.key_hash is
  'SHA-256 hash of the full raw API key. Used for authentication validation. '
  'The raw key is never stored — if lost, a new key must be generated. '
  'UNIQUE constraint prevents hash collisions.';

comment on column public.api_keys.scopes is
  'Array of permission scopes granted to this key (e.g. read:students, '
  'write:attendance). Defaults to read-only access for safety.';

comment on column public.api_keys.expires_at is
  'Optional expiration timestamp for automatic key rotation. NULL keys never '
  'expire. Set this for short-lived integration tokens.';

comment on column public.api_keys.last_used_at is
  'Periodically updated timestamp of last key usage. Useful for identifying '
  'unused keys for cleanup.';

comment on column public.api_keys.is_active is
  'Quick toggle to revoke access without deleting the record. Inactive keys '
  'are rejected by the API gateway middleware.';

comment on column public.api_keys.created_by is
  'FK to profiles. The admin who generated the key. SET NULL on profile '
  'soft-delete preserves the key record.';

-- 6c. Column comments — webhook_endpoints
comment on column public.webhook_endpoints.url is
  'The destination HTTPS URL for webhook payload delivery. Must use HTTPS '
  '(enforced via CHECK constraint).';

comment on column public.webhook_endpoints.secret is
  'Cryptographic secret used to sign the webhook payload via HMAC SHA-256. '
  'The receiving server verifies the X-EdTech-Signature header against this '
  'secret. Minimum 16 characters enforced via CHECK.';

comment on column public.webhook_endpoints.event_types is
  'Array of event topics this endpoint subscribes to (e.g. payment.succeeded, '
  'student.enrolled). Default {"*"} subscribes to all events.';

comment on column public.webhook_endpoints.is_active is
  'Whether the platform should dispatch events to this endpoint. Set to FALSE '
  'to temporarily pause delivery without deleting the configuration.';

-- 6d. Column comments — webhook_delivery_logs
comment on column public.webhook_delivery_logs.event_type is
  'The event topic that triggered this delivery (e.g. payment.failed, '
  'student.enrolled).';

comment on column public.webhook_delivery_logs.payload is
  'The exact JSON payload that was sent to the endpoint. Stored for debugging '
  'and replay capability.';

comment on column public.webhook_delivery_logs.http_status_code is
  'HTTP response status code from the external server (e.g. 200 for success, '
  '500 for server error, 410 for missing endpoint).';

comment on column public.webhook_delivery_logs.response_body is
  'Truncated response body from the external server for debugging purposes. '
  'May contain sensitive data — restrict access via RLS.';

comment on column public.webhook_delivery_logs.attempt_count is
  'Number of delivery attempts made so far. Used for exponential backoff '
  'retry logic (stop after 5 attempts).';

comment on column public.webhook_delivery_logs.next_retry_at is
  'Scheduled time for the next exponential backoff retry. NULL for successful '
  'deliveries or terminal failures.';

-- 6e. Column comments — async_jobs
comment on column public.async_jobs.queue_name is
  'Logical queue for worker partitioning (e.g. high_priority, video_processing, '
  'default). Workers subscribe to specific queues.';

comment on column public.async_jobs.task_name is
  'Identifier for the worker function to execute (e.g. generate_student_report, '
  'send_bulk_email, file_cleanup_job). Maps to a handler in the worker codebase.';

comment on column public.async_jobs.payload is
  'JSON arguments for the task. Schema varies by task_name. The worker '
  'deserialises and validates this payload before execution.';

comment on column public.async_jobs.priority is
  'Job priority — lower numbers are processed first. Default 0 (highest). '
  'Used in the ORDER BY clause of the worker polling query.';

comment on column public.async_jobs.run_at is
  'Scheduled execution time. Allows future scheduling of jobs. Jobs with '
  'run_at <= NOW() are eligible for worker pickup.';

comment on column public.async_jobs.attempts is
  'Current retry count. Must never exceed max_attempts. Reset to 0 on '
  'successful completion.';

comment on column public.async_jobs.max_attempts is
  'Maximum allowed retries before the job is marked as failed. Default 3. '
  'Configurable per job for fine-grained control.';

comment on column public.async_jobs.last_error is
  'Stack trace or error message from the most recent failure. NULL for '
  'successful jobs or jobs not yet attempted.';

-- 6f. Column comments — feature_flags
comment on column public.feature_flags.flag_key is
  'Developer-facing identifier for the feature flag (e.g. enable_new_mock_ui, '
  'new_onboarding_flow). Used in application code to check feature state. '
  'snake_case recommended.';

comment on column public.feature_flags.description is
  'Human-readable context for product managers and engineers (e.g. Enables '
  'the redesigned mock test interface for A/B testing).';

comment on column public.feature_flags.is_global_enabled is
  'Global on/off switch. When TRUE, the feature is live for everyone unless '
  'an institute-level override exists. Default FALSE for safety.';

-- 6g. Column comments — feature_flag_overrides
comment on column public.feature_flag_overrides.flag_id is
  'FK to feature_flags. CASCADE delete — removing a flag removes all its '
  'overrides.';

comment on column public.feature_flag_overrides.institute_id is
  'FK to institutes. CASCADE delete — removing an institute removes all its '
  'flag overrides.';

comment on column public.feature_flag_overrides.is_enabled is
  'Overrides the global is_global_enabled setting for this institute. When '
  'TRUE, the feature is enabled for this institute even if globally disabled. '
  'When FALSE, the feature is disabled for this institute even if globally enabled.';

-- 6h. Column comments — system_events_outbox
comment on column public.system_events_outbox.aggregate_type is
  'The entity type that was changed (e.g. LiveClass, Question, StudentDetails). '
  'Used by the relay worker to route events to the correct handler.';

comment on column public.system_events_outbox.aggregate_id is
  'The UUID of the affected entity. Used by the relay worker to construct '
  'cache invalidation keys or re-index queries.';

comment on column public.system_events_outbox.event_type is
  'What happened to the entity (e.g. cache.invalidate, question.updated, '
  'search.reindex). Determines how the relay worker processes the event.';

comment on column public.system_events_outbox.payload is
  'Data needed by the event consumer (e.g. {"cache_key": "student:123", '
  '"reindex_model": "Question"}). Schema varies by event_type.';

comment on column public.system_events_outbox.status is
  'Processing state: pending (awaiting relay), published (successfully '
  'dispatched), or failed (relay error after retries).';

comment on column public.system_events_outbox.error_log is
  'Error message from the relay worker if publication failed. NULL until '
  'the first failure.';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — Domain 15 Infrastructure & Operations
-- ════════════════════════════════════════════════════════════════════════════
