-- ============================================================================
-- Migration: Domain 10 — Administration
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Tables: audit_logs · system_settings
--
-- Depends on: Domain 01 (institutes, profiles, teacher_details, student_details)
--             Existing enums (user_role)
--             Existing functions (set_updated_at, get_my_institute_id, etc.)
--
-- New enums:  audit_action_type · setting_data_type
--
-- Order:
--   1. New Enum Types (idempotent)
--   2. Tables (dependency order: parent → child)
--   3. Indexes (after all tables exist)
--   4. Functions (table-referencing functions for triggers)
--   5. Triggers (after all tables and functions exist)
--   6. Comments
--
-- Partitioning note: audit_logs is one of the two highest-growth tables on the
--   platform (alongside notification_recipients). At 100K active users performing
--   an average of 10 auditable actions per day, this table grows by ~1M rows per
--   day — 365M rows per year. Implement monthly RANGE partitioning by performed_at
--   before go-live. For the initial migration, audit_logs is created as a regular
--   table. Partitioning DDL should be added in a dedicated migration once the
--   volume justifies it.
--
-- Reference: Schema_Domain_10_Administration.md v1.0 | ERD v3.0
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — New Enum Types (Idempotent)
-- ════════════════════════════════════════════════════════════════════════════
-- These enums are defined in this domain and used by audit_logs and
-- system_settings. Each creation is wrapped in an idempotent DO block.

-- 1a. audit_action_type
-- Enumerates every category of action that must be audit-logged.
-- Using an enum instead of free-text enables structured filtering and
-- prevents log pollution from inconsistent action naming across services.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'audit_action_type') then
    create type audit_action_type as enum (
      'create', 'update', 'delete', 'soft_delete', 'restore',
      'publish', 'unpublish', 'approve', 'reject',
      'login', 'logout',
      'enroll', 'unenroll',
      'purchase', 'refund',
      'export', 'import',
      'view_sensitive'
    );
  end if;
end $$;

-- 1b. setting_data_type
-- Tells the application how to deserialize the setting_value string at runtime.
-- All settings values are stored as TEXT; data_type is the schema contract
-- for type-safe reading.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'setting_data_type') then
    create type setting_data_type as enum ('string', 'integer', 'decimal', 'boolean', 'json', 'uuid', 'date');
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — CREATE TABLE Statements
-- ════════════════════════════════════════════════════════════════════════════
-- Administration: audit_logs (append-only immutable event log)
--                 system_settings (per-institute key-value configuration store)

-- 2a. Table: audit_logs
-- An immutable, append-only record of every significant action performed by
-- any actor (admin, teacher, student, or system process) across the platform.
-- This is the compliance backbone and primary debugging surface.
--
-- Write pattern: INSERT only — never UPDATE, never DELETE (until archival purge).
-- No row in audit_logs is ever updated or deleted by application code.
-- The only permitted deletion is a scheduled archival purge job that moves
-- rows older than the configured retention window to cold storage.
--
-- RLS: SELECT filtered by institute; INSERT/UPDATE/DELETE blocked for all
--   client roles. Written exclusively by the backend logging service using
--   service_role key.
--
-- Partitioning: Implement monthly range partitioning by performed_at before
--   go-live. At 100K active users, this table grows ~1M rows/day.
create table public.audit_logs (
  log_id          uuid               not null  default gen_random_uuid(),
  institute_id    uuid               not null,
  profile_id      uuid               null      default null,
  actor_role      user_role          null      default null,
  action          audit_action_type  not null,
  resource_type   text               not null,
  resource_id     uuid               null      default null,
  old_value       jsonb              null      default null,
  new_value       jsonb              null      default null,
  ip_address      inet               null      default null,
  user_agent      text               null      default null,
  session_id      text               null      default null,
  metadata        jsonb              null      default null,
  performed_at    timestamptz        not null  default now(),
  created_at      timestamptz        not null  default now(),

  -- Primary Key
  constraint pk_audit_logs primary key (log_id),

  -- Foreign Keys
  constraint fk_audit_logs_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_audit_logs_profile
    foreign key (profile_id) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- CHECK Constraints
  constraint ck_audit_logs_resource_type_length check (
    char_length(resource_type) >= 1 and char_length(resource_type) <= 100
  ),
  constraint ck_audit_logs_create_old_value_null check (
    (action in ('create', 'login') and old_value is null)
    or (action not in ('create', 'login'))
  ),
  constraint ck_audit_logs_delete_new_value_null check (
    (action in ('delete', 'soft_delete', 'logout') and new_value is null)
    or (action not in ('delete', 'soft_delete', 'logout'))
  ),
  constraint ck_audit_logs_actor_consistency check (
    profile_id is not null or actor_role is null
  )
);

-- 2b. Table: system_settings
-- A per-institute key-value configuration store that externalises business
-- rules (thresholds, limits, toggles, retention windows) from application code.
-- Changing a platform behaviour for an institute does not require a code
-- deployment — it requires updating a setting row.
--
-- All values are stored as TEXT regardless of logical data type. The backend
-- service casts to the correct type using the data_type column.
-- Rows are never deleted — only deactivated (is_active = FALSE) or overwritten.
-- is_system = TRUE marks platform-seeded settings protected from admin deletion.
--
-- Every change to setting_value must also generate a row in audit_logs
-- (responsibility of the backend service or a Postgres trigger).
create table public.system_settings (
  setting_id      uuid               not null  default gen_random_uuid(),
  institute_id    uuid               not null,
  setting_key     text               not null,
  setting_value   text               not null,
  data_type       setting_data_type  not null,
  display_name    text               not null,
  description     text               null      default null,
  category        text               not null  default 'general',
  is_active       boolean            not null  default true,
  is_system       boolean            not null  default false,
  updated_by      uuid               null      default null,
  created_at      timestamptz        not null  default now(),
  updated_at      timestamptz        not null  default now(),

  -- Primary Key
  constraint pk_system_settings primary key (setting_id),

  -- Foreign Keys
  constraint fk_system_settings_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_system_settings_updated_by
    foreign key (updated_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- Unique Constraints
  constraint uq_system_settings_institute_key unique (institute_id, setting_key),

  -- CHECK Constraints
  constraint ck_system_settings_key_length check (
    char_length(setting_key) >= 1 and char_length(setting_key) <= 200
  ),
  constraint ck_system_settings_key_format check (
    setting_key ~ '^[a-z][a-z0-9_]*$'
  ),
  constraint ck_system_settings_value_length check (
    char_length(setting_value) >= 1
  ),
  constraint ck_system_settings_display_name_length check (
    char_length(display_name) >= 1 and char_length(display_name) <= 300
  ),
  constraint ck_system_settings_category_length check (
    char_length(category) >= 1 and char_length(category) <= 100
  ),
  constraint ck_system_settings_boolean_value check (
    data_type != 'boolean' or setting_value in ('true', 'false')
  ),
  constraint ck_system_settings_integer_value check (
    data_type != 'integer' or setting_value ~ '^-?[0-9]+$'
  ),
  constraint ck_system_settings_decimal_value check (
    data_type != 'decimal' or setting_value ~ '^-?[0-9]+(\.[0-9]+)?$'
  )
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Indexes
-- ════════════════════════════════════════════════════════════════════════════
-- All indexes are created after their respective tables exist.
-- No duplicate indexes on columns already covered by UNIQUE constraints.
-- Partial indexes used where specified in the schema.

-- 3a. audit_logs indexes
-- Primary query pattern: admin audit log list, filtered by institute, newest first.
create index if not exists idx_audit_logs_institute_performed_at
  on public.audit_logs (institute_id, performed_at desc);

-- Actor-specific audit trail: "show all actions by this user."
create index if not exists idx_audit_logs_profile_performed_at
  on public.audit_logs (profile_id, performed_at desc);

-- Entity-specific audit trail: "show all actions on a specific resource."
create index if not exists idx_audit_logs_resource
  on public.audit_logs (resource_type, resource_id, performed_at desc);

-- Action-type filter: "show all publish events in this institute this week."
create index if not exists idx_audit_logs_institute_action
  on public.audit_logs (institute_id, action, performed_at desc);

-- Role-scoped audit: "show all teacher actions in the last 7 days."
create index if not exists idx_audit_logs_institute_actor_role
  on public.audit_logs (institute_id, actor_role, performed_at desc);

-- Security investigation: "show all actions from this IP."
create index if not exists idx_audit_logs_ip_address
  on public.audit_logs (ip_address, performed_at desc);

-- JSONB containment search on old_value for compliance and data recovery queries.
create index if not exists idx_audit_logs_old_value_gin
  on public.audit_logs using gin (old_value);

-- JSONB containment search on new_value for post-action state queries.
create index if not exists idx_audit_logs_new_value_gin
  on public.audit_logs using gin (new_value);

-- 3b. system_settings indexes
-- Admin panel: fetch all settings for an institute grouped by category, active only.
create index if not exists idx_system_settings_institute_category
  on public.system_settings (institute_id, category, is_active);

-- Runtime bulk fetch: load all active settings for an institute into cache.
create index if not exists idx_system_settings_institute_active
  on public.system_settings (institute_id, is_active)
  where is_active = true;

-- Note: idx_system_settings_institute_key is covered by uq_system_settings_institute_key.

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Functions That Reference Tables
-- ════════════════════════════════════════════════════════════════════════════
-- These functions are created after all tables exist because they reference
-- tables in their implementations.

-- 4a. Prevent UPDATE on audit_logs (immutability enforcement)
-- Audit log rows must never be updated. This trigger function blocks any
-- UPDATE attempt on the audit_logs table regardless of role.
--
-- Rationale: RLS policies block UPDATE for client roles, but service_role
-- bypasses RLS. This trigger is the last line of defence — even service_role
-- cannot UPDATE audit_logs rows. The only legitimate mutation is a hard
-- DELETE by the archival purge job, which is handled separately.
create or replace function public.trgfn_audit_logs_prevent_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_logs rows are immutable — UPDATE is not permitted';
end;
$$;

-- 4b. Prevent DELETE on audit_logs (immutability enforcement)
-- Blocks DELETE for all roles except the archival purge job.
-- The archival purge job uses a dedicated function with a security check
-- to hard-delete rows after verified cold-storage export.
--
-- Note: The archival function (purge_audit_logs) is not created here because
-- it depends on pg_cron or Edge Function infrastructure that is configured
-- at deployment level, not in schema migrations.
create or replace function public.trgfn_audit_logs_prevent_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_logs rows are immutable — DELETE is not permitted. Use the archival purge job instead.';
end;
$$;

-- 4c. system_settings protection trigger
-- Prevents updates to setting_key, data_type, or is_system after creation.
-- is_system = TRUE settings: prevents setting_key, data_type, is_system from
-- being changed. Admins may still update setting_value on system settings.
create or replace function public.trgfn_system_settings_protect()
returns trigger
language plpgsql
as $$
begin
  -- Block changes to setting_key, data_type, is_system after creation
  if old.setting_key is distinct from new.setting_key then
    raise exception 'setting_key is immutable after creation';
  end if;

  if old.data_type is distinct from new.data_type then
    raise exception 'data_type is immutable after creation';
  end if;

  -- For system settings, is_system cannot be changed
  if old.is_system is distinct from new.is_system then
    raise exception 'is_system is immutable after creation';
  end if;

  return new;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — CREATE TRIGGER Statements
-- ════════════════════════════════════════════════════════════════════════════
-- Only tables with an updated_at column receive the set_updated_at trigger.
-- set_updated_at() already exists from Domain 01 — do not recreate.
-- audit_logs has no updated_at column (rows are never updated).

-- 5a. audit_logs triggers (immutability enforcement)
create trigger trg_audit_logs_prevent_update
  before update on public.audit_logs
  for each row
  execute function public.trgfn_audit_logs_prevent_update();

create trigger trg_audit_logs_prevent_delete
  before delete on public.audit_logs
  for each row
  execute function public.trgfn_audit_logs_prevent_delete();

-- 5b. system_settings triggers
create trigger trg_system_settings_set_updated_at
  before update on public.system_settings
  for each row
  execute function public.set_updated_at();

create trigger trg_system_settings_protect
  before update on public.system_settings
  for each row
  execute function public.trgfn_system_settings_protect();

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — COMMENT Statements
-- ════════════════════════════════════════════════════════════════════════════

-- 6a. Table comments
comment on table public.audit_logs is
  'An immutable, append-only record of every significant action performed by '
  'any actor (admin, teacher, student, or system process) across the platform. '
  'This is the compliance backbone and primary debugging surface. '
  'INSERT only — never UPDATE, never DELETE until archival purge. '
  'Implement monthly range partitioning by performed_at before go-live.';

comment on table public.system_settings is
  'A per-institute key-value configuration store that externalises business '
  'rules from application code. All values stored as TEXT; data_type tells '
  'the backend how to deserialize. Rows are never deleted — only deactivated '
  '(is_active = FALSE) or overwritten via UPSERT.';

-- 6b. Column comments — audit_logs
comment on column public.audit_logs.log_id is
  'Primary key. Generated via gen_random_uuid().';

comment on column public.audit_logs.institute_id is
  'FK to institutes. The institute context in which the action occurred. '
  'All queries are filtered by this column for multi-tenant RLS enforcement.';

comment on column public.audit_logs.profile_id is
  'FK to profiles. The human actor who performed the action. '
  'NULL for system-initiated actions (background jobs, scheduled tasks, '
  'webhook callbacks) where there is no human actor. '
  'SET NULL on profile soft-delete preserves the audit record.';

comment on column public.audit_logs.actor_role is
  'Denormalized role of the actor at the time of the action (admin, teacher, '
  'student). NULL for system actors. Stored so that role-based audit filtering '
  'works even after the actor role has changed.';

comment on column public.audit_logs.action is
  'The category of action performed. Enum value from audit_action_type: '
  'create, update, delete, soft_delete, restore, publish, unpublish, approve, '
  'reject, login, logout, enroll, unenroll, purchase, refund, export, import, '
  'view_sensitive.';

comment on column public.audit_logs.resource_type is
  'The entity type that was acted upon (e.g. profiles, mock_tests, live_classes, '
  'orders, system_settings). Matches the table name by convention. Free-text '
  '(not enum) to allow new entity types without schema migrations.';

comment on column public.audit_logs.resource_id is
  'The UUID of the specific entity that was acted upon. NULL for actions that '
  'do not target a single entity (e.g. bulk exports, login events). Polymorphic '
  'reference — the target table is determined by resource_type. No FK constraint.';

comment on column public.audit_logs.old_value is
  'JSON snapshot of the relevant fields of the entity BEFORE the action. '
  'NULL for create and login actions. Contains only changed fields for update '
  'actions — not the full row.';

comment on column public.audit_logs.new_value is
  'JSON snapshot of the relevant fields of the entity AFTER the action. '
  'NULL for delete, soft_delete, and logout actions. Contains only new field '
  'values for update actions.';

comment on column public.audit_logs.ip_address is
  'The IP address of the client that initiated the request. Uses PostgreSQL '
  'INET type for native IP validation and CIDR range queries. '
  'NULL for server-side / background job actions.';

comment on column public.audit_logs.user_agent is
  'The HTTP User-Agent header from the client request. NULL for server-side '
  'actions. Useful for security investigation — identify bot traffic, detect '
  'credential stuffing from headless browsers.';

comment on column public.audit_logs.session_id is
  'The Supabase Auth session ID associated with this action. Allows grouping '
  'all actions from a single login session. NULL for background jobs.';

comment on column public.audit_logs.metadata is
  'Freeform additional context that does not fit the standard columns '
  '(e.g. bulk action item count, export format, search query that led to a '
  'sensitive view). Schema is action-dependent.';

comment on column public.audit_logs.performed_at is
  'UTC timestamp when the action was performed. The primary ordering and '
  'filtering column — all audit log queries include a time range on this column.';

comment on column public.audit_logs.created_at is
  'Row insertion timestamp. Equivalent to performed_at in most cases; kept '
  'separate per audit convention. If a log row is written asynchronously, '
  'performed_at reflects the action time and created_at reflects the write time.';

-- 6c. Column comments — system_settings
comment on column public.system_settings.setting_id is
  'Primary key. Generated via gen_random_uuid().';

comment on column public.system_settings.institute_id is
  'FK to institutes. The institute this setting belongs to. Every institute '
  'has its own copy of each setting, allowing different values for the same key.';

comment on column public.system_settings.setting_key is
  'The machine-readable name of the setting, in snake_case. Used by backend '
  'services to look up the setting at runtime. Must be stable — changing a key '
  'name breaks all code that references it. Examples: weak_chapter_accuracy_threshold, '
  'max_batch_students, audit_log_retention_days.';

comment on column public.system_settings.setting_value is
  'The setting value, always stored as TEXT regardless of the logical data type. '
  'The backend service casts to the correct type using data_type. '
  'For boolean settings, store as true or false. For json, store as valid JSON.';

comment on column public.system_settings.data_type is
  'The logical type of setting_value. Tells the backend how to deserialize. '
  'Enum values: string, integer, decimal, boolean, json, uuid, date.';

comment on column public.system_settings.display_name is
  'Human-readable label shown in the admin settings panel '
  '(e.g. Weak Chapter Accuracy Threshold (%), Maximum Students Per Batch). '
  'Not used by backend logic — for UI only.';

comment on column public.system_settings.description is
  'Longer explanation of what this setting controls and the impact of changing '
  'it. Shown as tooltip or help text in the admin panel.';

comment on column public.system_settings.category is
  'Grouping key for the admin settings panel UI. Examples: analytics, '
  'notifications, commerce, live_classes, content, general. Free-text to allow '
  'new categories without schema changes.';

comment on column public.system_settings.is_active is
  'Soft delete / disable flag. An inactive setting is ignored by the backend '
  '(which falls back to the hardcoded default). Used to temporarily disable a '
  'setting without deleting it.';

comment on column public.system_settings.is_system is
  'If TRUE, this is a platform-level setting seeded at install time and should '
  'not be deletable or renameable by institute admins. If FALSE, it is an '
  'institute-custom setting that the admin created.';

comment on column public.system_settings.updated_by is
  'FK to profiles. The admin who last changed this setting value. '
  'NULL for system-seeded settings not yet modified by any admin. '
  'SET NULL on profile soft-delete preserves the setting record.';

comment on column public.system_settings.created_at is
  'UTC timestamp of row creation.';

comment on column public.system_settings.updated_at is
  'UTC timestamp of last modification. Trigger-maintained.';


-- 6e. Trigger comments
comment on trigger trg_audit_logs_prevent_update on public.audit_logs is
  'Last-line-of-defence immutability enforcement. Blocks UPDATE for all roles '
  'including service_role. Audit log rows are never updated.';

comment on trigger trg_audit_logs_prevent_delete on public.audit_logs is
  'Blocks DELETE for all roles. Hard deletes are performed only by the archival '
  'purge job (outside this migration) after a verified export to cold storage.';

comment on trigger trg_system_settings_protect on public.system_settings is
  'Protects setting_key, data_type, and is_system from modification after creation. '
  'System settings (is_system = TRUE) additionally block changes to is_system itself.';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — Domain 10 Administration
-- ════════════════════════════════════════════════════════════════════════════
