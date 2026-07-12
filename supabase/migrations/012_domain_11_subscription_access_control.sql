-- ============================================================================
-- Migration: Domain 11 — Subscription & Access Control
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Tables: subscription_plans · subscription_features · plan_unlocks ·
--         student_subscriptions · subscription_history ·
--         subscription_renewals · subscription_cancellations ·
--         subscription_grace_periods · subscription_usage
--
-- Depends on: Domain 01 (institutes, profiles, student_details)
--             Domain 02 (streams)
--             Domain 08/Commerce (orders)
--             Existing enums (user_role)
--             Existing functions (set_updated_at, get_my_institute_id, etc.)
--
-- New enums: subscription_status_type · subscription_change_reason_type ·
--            cancellation_reason_type · grace_period_resolution_type ·
--            plan_billing_cycle_type · feature_category_type
--
-- Order:
--   1. New Enum Types (idempotent)
--   2. Tables (dependency order: parent → child → junction)
--   3. Indexes (after all tables exist)
--   4. Functions (table-referencing functions for triggers)
--   5. Triggers (after all tables and functions exist)
--   6. Comments
--
-- Reference: Schema_Domain_11_Subscription_Access_Control.md v1.0 | ERD v3.0
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — New Enum Types (Idempotent)
-- ════════════════════════════════════════════════════════════════════════════
-- These enums are defined in this domain and used by the subscription tables.
-- Each creation is wrapped in an idempotent DO block.

-- 1a. subscription_status_type
-- Defines the complete lifecycle of a subscription.
-- Valid lifecycle: pending → active → grace → expired/cancelled → refunded.
-- Only active and grace statuses grant feature access.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'subscription_status_type') then
    create type subscription_status_type as enum (
      'pending', 'active', 'grace', 'expired', 'cancelled', 'refunded'
    );
  end if;
end $$;

-- 1b. subscription_change_reason_type
-- Categorises why a subscription changed state.
-- Enables revenue analytics: how many students churned due to payment_failure
-- vs cancellation?
do $$
begin
  if not exists (select 1 from pg_type where typname = 'subscription_change_reason_type') then
    create type subscription_change_reason_type as enum (
      'new_purchase', 'renewal', 'upgrade', 'downgrade',
      'manual_activation', 'payment_failure', 'payment_recovery',
      'admin_action', 'expiry', 'cancellation', 'refund'
    );
  end if;
end $$;

-- 1c. cancellation_reason_type
-- Structured cancellation reasons for churn analysis and refund eligibility.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'cancellation_reason_type') then
    create type cancellation_reason_type as enum (
      'student_request', 'admin_action', 'payment_failure_unresolved',
      'fraud_detected', 'institute_deactivated', 'plan_discontinued'
    );
  end if;
end $$;

-- 1d. grace_period_resolution_type
-- How the grace period ended. Determines whether the subscription moved
-- back to active or forward to expired/cancelled.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'grace_period_resolution_type') then
    create type grace_period_resolution_type as enum (
      'payment_recovered', 'expired_no_payment', 'admin_waived', 'cancelled'
    );
  end if;
end $$;

-- 1e. plan_billing_cycle_type
-- The billing frequency of the plan.
-- lifetime means one-time payment, never expires.
-- custom uses duration_days directly.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'plan_billing_cycle_type') then
    create type plan_billing_cycle_type as enum (
      'monthly', 'quarterly', 'half_yearly', 'yearly', 'lifetime', 'custom'
    );
  end if;
end $$;

-- 1f. feature_category_type
-- Groups features for plan builder UI and access-check routing.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'feature_category_type') then
    create type feature_category_type as enum (
      'live_classes', 'recorded_classes', 'mock_tests', 'pyq_papers',
      'notes', 'assignments', 'analytics', 'downloads',
      'premium_support', 'batch_access', 'api_access'
    );
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — CREATE TABLE Statements
-- ════════════════════════════════════════════════════════════════════════════
-- Subscription domain: plans → plan_unlocks (junction with features)
--                      student_subscriptions → history, renewals,
--                        cancellations, grace_periods, usage
-- Reference table: subscription_features (seeded at install time)

-- 2a. Table: subscription_features
-- Master catalogue of every feature on the platform that can be gated behind
-- a subscription. This is the single source of truth for what can be unlocked.
-- Every gatable feature must have a row here before it can be referenced in
-- plan_unlocks. Seeded by the platform at install time; effectively static.
create table public.subscription_features (
  feature_id        uuid                 not null  default gen_random_uuid(),
  feature_key       text                 not null,
  display_name      text                 not null,
  description       text                 null      default null,
  category          feature_category_type not null,
  is_quantifiable   boolean              not null  default false,
  unit_label        text                 null      default null,
  is_active         boolean              not null  default true,
  sort_order        smallint             not null  default 0,
  created_at        timestamptz          not null  default now(),
  updated_at        timestamptz          not null  default now(),

  -- Primary Key
  constraint pk_subscription_features primary key (feature_id),

  -- Unique Constraints
  constraint uq_subscription_features_key unique (feature_key),

  -- CHECK Constraints
  constraint ck_subscription_features_key_length check (
    char_length(feature_key) >= 3 and char_length(feature_key) <= 100
  ),
  constraint ck_subscription_features_key_format check (
    feature_key ~ '^[a-z][a-z0-9_]*$'
  ),
  constraint ck_subscription_features_display_name_length check (
    char_length(display_name) >= 2 and char_length(display_name) <= 200
  ),
  constraint ck_subscription_features_sort_order check (sort_order >= 0),
  constraint ck_subscription_features_unit_label check (
    is_quantifiable = true or unit_label is null
  )
);

-- 2b. Table: subscription_plans
-- Master catalogue of all subscription plans offered by an institute.
-- A plan is a named, priced product that, when purchased by a student, grants
-- access to a defined set of features (via plan_unlocks) for a defined duration.
-- Plans are scoped to an institute and optionally to a stream.
create table public.subscription_plans (
  plan_id         uuid                    not null  default gen_random_uuid(),
  institute_id    uuid                    not null,
  stream_id       uuid                    null      default null,
  name            text                    not null,
  slug            text                    not null,
  description     text                    null      default null,
  price           numeric(10,2)           not null,
  currency_code   character(3)            not null  default 'INR',
  billing_cycle   plan_billing_cycle_type not null,
  duration_days   smallint                not null,
  trial_days      smallint                not null  default 0,
  max_students    integer                 null      default null,
  is_active       boolean                 not null  default true,
  is_featured     boolean                 not null  default false,
  sort_order      smallint                not null  default 0,
  created_by      uuid                    not null,
  updated_by      uuid                    null      default null,
  created_at      timestamptz             not null  default now(),
  updated_at      timestamptz             not null  default now(),

  -- Primary Key
  constraint pk_subscription_plans primary key (plan_id),

  -- Foreign Keys
  constraint fk_subscription_plans_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_subscription_plans_stream
    foreign key (stream_id) references public.streams (stream_id)
    on delete restrict
    on update restrict,

  constraint fk_subscription_plans_created_by
    foreign key (created_by) references public.profiles (profile_id)
    on delete restrict
    on update restrict,

  constraint fk_subscription_plans_updated_by
    foreign key (updated_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- Unique Constraints
  constraint uq_subscription_plans_institute_name unique (institute_id, name),
  constraint uq_subscription_plans_institute_slug unique (institute_id, slug),

  -- CHECK Constraints
  constraint ck_subscription_plans_price check (price >= 0.00),
  constraint ck_subscription_plans_duration_days check (duration_days >= 1),
  constraint ck_subscription_plans_trial_days check (trial_days >= 0),
  constraint ck_subscription_plans_max_students check (
    max_students is null or max_students >= 1
  ),
  constraint ck_subscription_plans_sort_order check (sort_order >= 0),
  constraint ck_subscription_plans_name_length check (
    char_length(name) >= 2 and char_length(name) <= 200
  ),
  constraint ck_subscription_plans_slug_length check (
    char_length(slug) >= 2 and char_length(slug) <= 200
  ),
  constraint ck_subscription_plans_slug_format check (
    slug ~ '^[a-z0-9][a-z0-9\-]*[a-z0-9]$'
  ),
  constraint ck_subscription_plans_lifetime_no_trial check (
    billing_cycle != 'lifetime' or (billing_cycle = 'lifetime' and trial_days = 0)
  )
);

-- 2c. Table: plan_unlocks
-- Junction table between subscription_plans and subscription_features.
-- One row per feature unlocked by a plan. Defines what each plan includes
-- and at what usage limits. When a student's access check fires, the
-- middleware resolves whether the student's active plan has a plan_unlocks
-- row for the requested feature_key.
create table public.plan_unlocks (
  unlock_id         uuid          not null  default gen_random_uuid(),
  plan_id           uuid          not null,
  feature_id        uuid          not null,
  is_enabled        boolean       not null  default true,
  limit_value       integer       null      default null,
  limit_period_days smallint      null      default null,
  notes             text          null      default null,
  created_at        timestamptz   not null  default now(),
  updated_at        timestamptz   not null  default now(),

  -- Primary Key
  constraint pk_plan_unlocks primary key (unlock_id),

  -- Foreign Keys
  constraint fk_plan_unlocks_plan
    foreign key (plan_id) references public.subscription_plans (plan_id)
    on delete restrict
    on update restrict,

  constraint fk_plan_unlocks_feature
    foreign key (feature_id) references public.subscription_features (feature_id)
    on delete restrict
    on update restrict,

  -- Unique Constraints
  constraint uq_plan_unlocks_plan_feature unique (plan_id, feature_id),

  -- CHECK Constraints
  constraint ck_plan_unlocks_limit_value check (limit_value is null or limit_value >= 0),
  constraint ck_plan_unlocks_limit_period_days check (
    limit_period_days is null or limit_period_days >= 1
  ),
  constraint ck_plan_unlocks_limit_pair check (
    (limit_value is null and limit_period_days is null)
    or (limit_value is not null and limit_period_days is not null)
  )
);

-- 2d. Table: student_subscriptions
-- The core subscription record. One row per subscription per student.
-- This is the table the access-check middleware queries on every protected
-- request to determine if a student has active access.
-- A student may have multiple rows (one per purchase/renewal cycle), but at
-- most one should have status = 'active' or 'grace' at any given time.
create table public.student_subscriptions (
  subscription_id   uuid                    not null  default gen_random_uuid(),
  student_id        uuid                    not null,
  plan_id           uuid                    not null,
  institute_id      uuid                    not null,
  order_id          uuid                    null      default null,
  status            subscription_status_type not null default 'pending',
  start_date        date                    not null,
  end_date          date                    not null,
  grace_end_date    date                    null      default null,
  is_trial          boolean                 not null  default false,
  is_auto_renew     boolean                 not null  default true,
  payment_method_id text                    null      default null,
  renewal_attempts  smallint                not null  default 0,
  cancelled_at      timestamptz             null      default null,
  created_at        timestamptz             not null  default now(),
  updated_at        timestamptz             not null  default now(),

  -- Primary Key
  constraint pk_student_subscriptions primary key (subscription_id),

  -- Foreign Keys
  constraint fk_student_subscriptions_student
    foreign key (student_id) references public.student_details (student_id)
    on delete restrict
    on update restrict,

  constraint fk_student_subscriptions_plan
    foreign key (plan_id) references public.subscription_plans (plan_id)
    on delete restrict
    on update restrict,

  constraint fk_student_subscriptions_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_student_subscriptions_order
    foreign key (order_id) references public.orders (order_id)
    on delete set null
    on update restrict,

  -- Unique Constraints
  constraint uq_student_subscriptions_student_plan_start
    unique (student_id, plan_id, start_date),

  -- CHECK Constraints
  constraint ck_student_subscriptions_end_date check (end_date > start_date),
  constraint ck_student_subscriptions_grace_end_date check (
    grace_end_date is null or grace_end_date >= end_date
  ),
  constraint ck_student_subscriptions_renewal_attempts check (renewal_attempts >= 0),
  constraint ck_student_subscriptions_cancelled_at check (
    (status = 'cancelled' and cancelled_at is not null)
    or (status != 'cancelled' and cancelled_at is null)
  ),
  constraint ck_student_subscriptions_grace_status check (
    (status = 'grace' and grace_end_date is not null)
    or (status != 'grace')
  ),
  constraint ck_student_subscriptions_trial_auto_renew check (
    is_trial = false or (is_trial = true and is_auto_renew = false)
  )
);

-- 2e. Table: subscription_history
-- Immutable, append-only log of every status transition that a
-- student_subscriptions row has passed through. One row per state change.
-- Consumed by the admin subscription management panel, customer support
-- tools, and automated refund eligibility calculations.
create table public.subscription_history (
  history_id        uuid                          not null  default gen_random_uuid(),
  subscription_id   uuid                          not null,
  student_id        uuid                          not null,
  institute_id      uuid                          not null,
  status_before     subscription_status_type      null      default null,
  status_after      subscription_status_type      not null,
  change_reason     subscription_change_reason_type not null,
  changed_by        uuid                          null      default null,
  changed_by_role   user_role                     null      default null,
  payment_reference text                          null      default null,
  metadata          jsonb                         null      default null,
  occurred_at       timestamptz                   not null  default now(),
  created_at        timestamptz                   not null  default now(),

  -- Primary Key
  constraint pk_subscription_history primary key (history_id),

  -- Foreign Keys
  constraint fk_subscription_history_subscription
    foreign key (subscription_id) references public.student_subscriptions (subscription_id)
    on delete cascade
    on update restrict,

  constraint fk_subscription_history_student
    foreign key (student_id) references public.student_details (student_id)
    on delete restrict
    on update restrict,

  constraint fk_subscription_history_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_subscription_history_changed_by
    foreign key (changed_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- CHECK Constraints
  constraint ck_subscription_history_status_change check (
    status_before is null or status_before != status_after
  ),
  constraint ck_subscription_history_actor_consistency check (
    changed_by is not null or changed_by_role is null
  )
);

-- 2f. Table: subscription_renewals
-- Records every successful or attempted renewal event for a subscription.
-- One row per renewal attempt. Provides a detailed renewal ledger separate
-- from the history log — history captures status transitions, while renewals
-- capture the financial specifics of each renewal cycle.
create table public.subscription_renewals (
  renewal_id        uuid            not null  default gen_random_uuid(),
  subscription_id   uuid            not null,
  student_id        uuid            not null,
  institute_id      uuid            not null,
  order_id          uuid            null      default null,
  attempted_at      timestamptz     not null  default now(),
  succeeded_at      timestamptz     null      default null,
  amount_charged    numeric(10,2)   null      default null,
  currency_code     character(3)    not null  default 'INR',
  payment_reference text            null      default null,
  failure_code      text            null      default null,
  failure_message   text            null      default null,
  attempt_number    smallint        not null  default 1,
  new_end_date      date            null      default null,
  created_at        timestamptz     not null  default now(),

  -- Primary Key
  constraint pk_subscription_renewals primary key (renewal_id),

  -- Foreign Keys
  constraint fk_subscription_renewals_subscription
    foreign key (subscription_id) references public.student_subscriptions (subscription_id)
    on delete cascade
    on update restrict,

  constraint fk_subscription_renewals_student
    foreign key (student_id) references public.student_details (student_id)
    on delete restrict
    on update restrict,

  constraint fk_subscription_renewals_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_subscription_renewals_order
    foreign key (order_id) references public.orders (order_id)
    on delete set null
    on update restrict,

  -- CHECK Constraints
  constraint ck_subscription_renewals_amount_charged check (
    amount_charged is null or amount_charged >= 0.00
  ),
  constraint ck_subscription_renewals_attempt_number check (attempt_number >= 1),
  constraint ck_subscription_renewals_success_consistency check (
    (succeeded_at is not null and failure_code is null and amount_charged is not null and new_end_date is not null)
    or (succeeded_at is null and new_end_date is null)
  )
);

-- 2g. Table: subscription_cancellations
-- Records the details of every subscription cancellation event.
-- One row per cancellation (UNIQUE subscription_id). Captures the reason,
-- refund eligibility, and whether a partial refund was issued.
create table public.subscription_cancellations (
  cancellation_id   uuid                      not null  default gen_random_uuid(),
  subscription_id   uuid                      not null,
  student_id        uuid                      not null,
  institute_id      uuid                      not null,
  cancelled_by      uuid                      null      default null,
  cancelled_by_role user_role                 null      default null,
  reason            cancellation_reason_type  not null,
  reason_detail     text                      null      default null,
  effective_date    date                      not null,
  days_used         smallint                  not null  default 0,
  days_remaining    smallint                  not null  default 0,
  refund_eligible   boolean                   not null  default false,
  refund_amount     numeric(10,2)             null      default null,
  refund_processed_at timestamptz             null      default null,
  cancelled_at      timestamptz               not null  default now(),
  created_at        timestamptz               not null  default now(),

  -- Primary Key
  constraint pk_subscription_cancellations primary key (cancellation_id),

  -- Foreign Keys
  constraint fk_subscription_cancellations_subscription
    foreign key (subscription_id) references public.student_subscriptions (subscription_id)
    on delete cascade
    on update restrict,

  constraint fk_subscription_cancellations_student
    foreign key (student_id) references public.student_details (student_id)
    on delete restrict
    on update restrict,

  constraint fk_subscription_cancellations_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_subscription_cancellations_cancelled_by
    foreign key (cancelled_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- Unique Constraints
  constraint uq_subscription_cancellations_subscription unique (subscription_id),

  -- CHECK Constraints
  constraint ck_subscription_cancellations_days_used check (days_used >= 0),
  constraint ck_subscription_cancellations_days_remaining check (days_remaining >= 0),
  constraint ck_subscription_cancellations_refund_amount check (
    refund_amount is null or refund_amount >= 0.00
  ),
  constraint ck_subscription_cancellations_reason_detail_length check (
    reason_detail is null or char_length(reason_detail) <= 1000
  )
);

-- 2h. Table: subscription_grace_periods
-- Tracks active grace period windows. When a subscription's end_date passes
-- without a successful renewal, the subscription enters status = 'grace' and
-- a grace_periods row is created. The student retains access during the window.
create table public.subscription_grace_periods (
  grace_id              uuid                        not null  default gen_random_uuid(),
  subscription_id       uuid                        not null,
  student_id            uuid                        not null,
  institute_id          uuid                        not null,
  grace_start_date      date                        not null,
  grace_end_date        date                        not null,
  trigger_reason        text                        not null,
  resolution            grace_period_resolution_type null     default null,
  resolved_at           timestamptz                 null      default null,
  reminders_sent        smallint                    not null  default 0,
  last_reminder_sent_at timestamptz                 null      default null,
  created_at            timestamptz                 not null  default now(),
  updated_at            timestamptz                 not null  default now(),

  -- Primary Key
  constraint pk_subscription_grace_periods primary key (grace_id),

  -- Foreign Keys
  constraint fk_subscription_grace_periods_subscription
    foreign key (subscription_id) references public.student_subscriptions (subscription_id)
    on delete cascade
    on update restrict,

  constraint fk_subscription_grace_periods_student
    foreign key (student_id) references public.student_details (student_id)
    on delete restrict
    on update restrict,

  constraint fk_subscription_grace_periods_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  -- CHECK Constraints
  constraint ck_subscription_grace_periods_end_date check (grace_end_date > grace_start_date),
  constraint ck_subscription_grace_periods_reminders check (reminders_sent >= 0),
  constraint ck_subscription_grace_periods_trigger_reason check (
    trigger_reason in ('payment_failure', 'auto_renewal_failed', 'manual_expiry')
  ),
  constraint ck_subscription_grace_periods_resolution check (
    (resolution is null and resolved_at is null)
    or (resolution is not null and resolved_at is not null)
  )
);

-- 2i. Table: subscription_usage
-- Rolling usage counters per student per feature per billing period.
-- Tracks how many times a student has consumed a quantifiable feature
-- against the limit defined in plan_unlocks. High-frequency write target.
-- Periods are subscription-relative, not calendar-month-aligned.
create table public.subscription_usage (
  usage_id          uuid          not null  default gen_random_uuid(),
  subscription_id   uuid          not null,
  student_id        uuid          not null,
  institute_id      uuid          not null,
  feature_id        uuid          not null,
  period_start      date          not null,
  period_end        date          not null,
  used_count        integer       not null  default 0,
  limit_snapshot    integer       null      default null,
  last_used_at      timestamptz   null      default null,
  created_at        timestamptz   not null  default now(),
  updated_at        timestamptz   not null  default now(),

  -- Primary Key
  constraint pk_subscription_usage primary key (usage_id),

  -- Foreign Keys
  constraint fk_subscription_usage_subscription
    foreign key (subscription_id) references public.student_subscriptions (subscription_id)
    on delete cascade
    on update restrict,

  constraint fk_subscription_usage_student
    foreign key (student_id) references public.student_details (student_id)
    on delete restrict
    on update restrict,

  constraint fk_subscription_usage_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_subscription_usage_feature
    foreign key (feature_id) references public.subscription_features (feature_id)
    on delete restrict
    on update restrict,

  -- Unique Constraints
  constraint uq_subscription_usage_subscription_feature_period
    unique (subscription_id, feature_id, period_start),

  -- CHECK Constraints
  constraint ck_subscription_usage_used_count check (used_count >= 0),
  constraint ck_subscription_usage_period_end check (period_end >= period_start),
  constraint ck_subscription_usage_limit_snapshot check (
    limit_snapshot is null or limit_snapshot >= 0
  ),
  constraint ck_subscription_usage_used_count_cap check (
    used_count <= coalesce(limit_snapshot, 2147483647)
  )
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Indexes
-- ════════════════════════════════════════════════════════════════════════════
-- All indexes are created after their respective tables exist.
-- No duplicate indexes on columns already covered by UNIQUE constraints.
-- Partial indexes used where specified in the schema.

-- 3a. subscription_features indexes
create index if not exists idx_subscription_features_category_active
  on public.subscription_features (category, is_active, sort_order);

-- Note: idx_subscription_features_key is covered by uq_subscription_features_key.

-- 3b. subscription_plans indexes
create index if not exists idx_subscription_plans_institute_active
  on public.subscription_plans (institute_id, is_active, sort_order);

create index if not exists idx_subscription_plans_institute_stream
  on public.subscription_plans (institute_id, stream_id, is_active);

create index if not exists idx_subscription_plans_billing_cycle
  on public.subscription_plans (institute_id, billing_cycle, is_active);

create index if not exists idx_subscription_plans_created_by
  on public.subscription_plans (created_by);

create index if not exists idx_subscription_plans_updated_by
  on public.subscription_plans (updated_by)
  where updated_by is not null;

-- Note: uq_subscription_plans_institute_name and uq_subscription_plans_institute_slug
--   cover their respective lookups.

-- 3c. plan_unlocks indexes
create index if not exists idx_plan_unlocks_plan_id
  on public.plan_unlocks (plan_id, is_enabled);

create index if not exists idx_plan_unlocks_feature_id
  on public.plan_unlocks (feature_id);

-- Note: uq_plan_unlocks_plan_feature covers (plan_id, feature_id) lookups.

-- 3d. student_subscriptions indexes
-- Primary access-check query: does this student have an active subscription?
create index if not exists idx_student_subs_student_status
  on public.student_subscriptions (student_id, status);

-- Partial: further optimised access check — only rows that can grant access.
create index if not exists idx_student_subs_student_active
  on public.student_subscriptions (student_id, status, end_date)
  where status in ('active', 'grace');

-- Renewal job: find all active auto-renew subscriptions expiring within N days.
create index if not exists idx_student_subs_expiry_autorenew
  on public.student_subscriptions (end_date, is_auto_renew, status)
  where status = 'active';

-- Admin dashboard: active subscriber count and churn tracking per institute.
create index if not exists idx_student_subs_institute_status
  on public.student_subscriptions (institute_id, status, end_date desc);

-- Plan-level capacity check: count active subscribers vs max_students.
create index if not exists idx_student_subs_plan_active
  on public.student_subscriptions (plan_id, status)
  where status = 'active';

-- Grace expiry job: find all grace-period subscriptions whose window has passed.
create index if not exists idx_student_subs_grace_end_date
  on public.student_subscriptions (grace_end_date)
  where status = 'grace';

-- 3e. subscription_history indexes
create index if not exists idx_sub_history_subscription_occurred
  on public.subscription_history (subscription_id, occurred_at desc);

create index if not exists idx_sub_history_student_occurred
  on public.subscription_history (student_id, occurred_at desc);

create index if not exists idx_sub_history_institute_reason
  on public.subscription_history (institute_id, change_reason, occurred_at desc);

-- 3f. subscription_renewals indexes
create index if not exists idx_renewals_subscription_id
  on public.subscription_renewals (subscription_id, attempted_at desc);

create index if not exists idx_renewals_institute_succeeded
  on public.subscription_renewals (institute_id, succeeded_at desc)
  where succeeded_at is not null;

create index if not exists idx_renewals_failure_code
  on public.subscription_renewals (institute_id, failure_code, attempted_at desc)
  where failure_code is not null;

-- 3g. subscription_cancellations indexes
create index if not exists idx_cancellations_institute_reason
  on public.subscription_cancellations (institute_id, reason, cancelled_at desc);

create index if not exists idx_cancellations_refund_eligible
  on public.subscription_cancellations (institute_id, refund_eligible, refund_processed_at)
  where refund_eligible = true and refund_processed_at is null;

-- 3h. subscription_grace_periods indexes
-- A subscription can only have one active (unresolved) grace period at a time.
-- Once resolved, a new grace period can be created if the subscription re-enters grace.
create unique index if not exists uq_grace_periods_active_subscription
  on public.subscription_grace_periods (subscription_id)
  where resolution is null;

-- Grace expiry job: find all unresolved grace periods whose window has passed.
create index if not exists idx_grace_periods_expiry_job
  on public.subscription_grace_periods (grace_end_date, resolution)
  where resolution is null;

-- Reminder job: find active grace periods due for a reminder.
create index if not exists idx_grace_periods_reminder_job
  on public.subscription_grace_periods (last_reminder_sent_at, resolution)
  where resolution is null;

-- 3i. subscription_usage indexes
-- Note: uq_subscription_usage_subscription_feature_period covers the primary
--   access-check read pattern (subscription_id, feature_id, period_start).

create index if not exists idx_usage_student_feature_period
  on public.subscription_usage (student_id, feature_id, period_end desc);

create index if not exists idx_usage_feature_institute
  on public.subscription_usage (institute_id, feature_id, period_start desc);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Functions That Reference Tables
-- ════════════════════════════════════════════════════════════════════════════
-- These functions are created after all tables exist because they reference
-- tables in their implementations.

-- 4a. Validate subscription status transitions
-- Enforces valid status transitions on student_subscriptions:
--   pending → active, pending → cancelled
--   active → grace, active → expired, active → cancelled
--   grace → active, grace → expired, grace → cancelled
--   expired → active (admin re-activation)
--   cancelled → refunded
-- Any other transition raises an exception.
create or replace function public.trgfn_subscription_validate_status()
returns trigger
language plpgsql
as $$
begin
  if old.status is distinct from new.status then
    if not (
      (old.status = 'pending' and new.status in ('active', 'cancelled'))
      or (old.status = 'active' and new.status in ('grace', 'expired', 'cancelled'))
      or (old.status = 'grace' and new.status in ('active', 'expired', 'cancelled'))
      or (old.status = 'expired' and new.status = 'active')
      or (old.status = 'cancelled' and new.status = 'refunded')
    ) then
      raise exception 'Invalid subscription status transition: % → %', old.status, new.status;
    end if;
  end if;
  return new;
end;
$$;

-- 4b. Auto-write subscription_history on status change
-- Whenever student_subscriptions.status changes, automatically insert a
-- corresponding row into subscription_history. This ensures the audit trail
-- is always complete and eliminates the risk of missing history rows.
create or replace function public.trgfn_subscription_auto_history()
returns trigger
language plpgsql
as $$
begin
  if old.status is distinct from new.status then
    insert into public.subscription_history (
      subscription_id,
      student_id,
      institute_id,
      status_before,
      status_after,
      change_reason,
      changed_by,
      changed_by_role,
      metadata,
      occurred_at
    ) values (
      new.subscription_id,
      new.student_id,
      new.institute_id,
      old.status,
      new.status,
      -- TODO: backend service should populate change_reason, changed_by, and changed_by_role
      --       via a post-update operation using service_role. This auto-history trigger
      --       captures the state transition; the backend should enrich it immediately after.
      'system_action',
      null,
      null,
      '{}'::jsonb,
      now()
    );
  end if;
  return new;
end;
$$;

-- 4c. Enforce max_students capacity on subscription_plans
-- Prevents overselling a capacity-limited plan by checking the active subscriber
-- count against max_students before allowing a new subscription to become active.
-- This is a safety net; the primary enforcement is in the backend service using
-- SELECT ... FOR UPDATE within a transaction.
create or replace function public.trgfn_subscription_check_capacity()
returns trigger
language plpgsql
as $$
declare
  v_max_students integer;
  v_active_count integer;
begin
  if new.status = 'active' then
    select max_students into strict v_max_students
      from public.subscription_plans
     where plan_id = new.plan_id;

    if v_max_students is not null then
      select count(*) into v_active_count
        from public.student_subscriptions
       where plan_id = new.plan_id
         and status = 'active'
         and subscription_id != coalesce(new.subscription_id, '00000000-0000-0000-0000-000000000000');

      if v_active_count >= v_max_students then
        raise exception 'Plan % has reached maximum capacity (%)', new.plan_id, v_max_students;
      end if;
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
-- subscription_history has no updated_at column (append-only).
-- subscription_renewals has no updated_at column (append-only event log).
-- subscription_cancellations has no updated_at column (append-only).

-- 5a. subscription_features triggers
create trigger trg_subscription_features_set_updated_at
  before update on public.subscription_features
  for each row
  execute function public.set_updated_at();

-- 5b. subscription_plans triggers
create trigger trg_subscription_plans_set_updated_at
  before update on public.subscription_plans
  for each row
  execute function public.set_updated_at();

-- 5c. plan_unlocks triggers
create trigger trg_plan_unlocks_set_updated_at
  before update on public.plan_unlocks
  for each row
  execute function public.set_updated_at();

-- 5d. student_subscriptions triggers
create trigger trg_student_subscriptions_set_updated_at
  before update on public.student_subscriptions
  for each row
  execute function public.set_updated_at();

create trigger trg_student_subscriptions_validate_status
  before update on public.student_subscriptions
  for each row
  when (old.status is distinct from new.status)
  execute function public.trgfn_subscription_validate_status();

create trigger trg_student_subscriptions_auto_history
  after update on public.student_subscriptions
  for each row
  when (old.status is distinct from new.status)
  execute function public.trgfn_subscription_auto_history();

create trigger trg_student_subscriptions_check_capacity
  before insert or update on public.student_subscriptions
  for each row
  when (new.status = 'active')
  execute function public.trgfn_subscription_check_capacity();

-- 5e. subscription_grace_periods triggers
create trigger trg_subscription_grace_periods_set_updated_at
  before update on public.subscription_grace_periods
  for each row
  execute function public.set_updated_at();

-- 5f. subscription_usage triggers
create trigger trg_subscription_usage_set_updated_at
  before update on public.subscription_usage
  for each row
  execute function public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — COMMENT Statements
-- ════════════════════════════════════════════════════════════════════════════

-- 6a. Table comments
comment on table public.subscription_features is
  'Master catalogue of every feature on the platform that can be gated behind '
  'a subscription. Single source of truth for what can be unlocked. Seeded by '
  'the platform at install time and effectively static. Referenced by plan_unlocks.';

comment on table public.subscription_plans is
  'Master catalogue of all subscription plans offered by an institute. A plan '
  'is a named, priced product that grants access to a defined set of features '
  '(via plan_unlocks) for a defined duration. Plans are scoped to an institute '
  'and optionally to a stream. Soft-disabled via is_active = FALSE.';

comment on table public.plan_unlocks is
  'Junction table between subscription_plans and subscription_features. One row '
  'per feature unlocked by a plan. Defines what each plan includes and at what '
  'usage limits. The access-check middleware resolves access by checking whether '
  'the student active plan has a plan_unlocks row for the requested feature.';

comment on table public.student_subscriptions is
  'The core subscription record. One row per subscription per student. This is '
  'the table the access-check middleware queries on every protected request to '
  'determine if a student has active access. A student may have multiple rows '
  'over their lifetime (one per purchase/renewal cycle), but at most one should '
  'have status = active or grace at any given time.';

comment on table public.subscription_history is
  'Immutable, append-only log of every status transition that a '
  'student_subscriptions row has passed through. One row per state change. '
  'This is the commercial audit trail — it answers when, who, and why a '
  'subscription changed state.';

comment on table public.subscription_renewals is
  'Records every successful or attempted renewal event for a subscription. '
  'One row per renewal attempt. Provides a detailed renewal ledger separate '
  'from the history log — history captures status transitions, while renewals '
  'capture the financial specifics of each renewal cycle.';

comment on table public.subscription_cancellations is
  'Records the details of every subscription cancellation event. One row per '
  'cancellation (UNIQUE subscription_id). Captures the reason, refund eligibility, '
  'and whether a partial refund was issued. Primary data source for churn analysis '
  'and refund processing.';

comment on table public.subscription_grace_periods is
  'Tracks active grace period windows. When a subscription end_date passes '
  'without a successful renewal, the subscription enters status = grace and a '
  'grace_periods row is created. The student retains access during the grace '
  'window. Queried by the grace expiry job to find expired windows.';

comment on table public.subscription_usage is
  'Rolling usage counters per student per feature per billing period. Tracks '
  'how many times a student has consumed a quantifiable feature against the '
  'limit defined in plan_unlocks. High-frequency write target — uses atomic '
  'UPSERT for race-safe increments. Periods are subscription-relative, not '
  'calendar-month-aligned.';

-- 6b. Column comments — subscription_features
comment on column public.subscription_features.feature_key is
  'Machine-readable identifier for the feature (e.g. live_classes_access, '
  'mock_tests_access, pyq_download). Used in backend middleware for access checks. '
  'snake_case format. Globally unique across the platform.';

comment on column public.subscription_features.display_name is
  'Human-readable name shown in the plan builder UI (e.g. Live Classes, Mock Tests).';

comment on column public.subscription_features.category is
  'Groups the feature for UI display and backend routing. Enum values: '
  'live_classes, recorded_classes, mock_tests, pyq_papers, notes, assignments, '
  'analytics, downloads, premium_support, batch_access, api_access.';

comment on column public.subscription_features.is_quantifiable is
  'When TRUE, this feature has a usage limit configurable per plan in plan_unlocks. '
  'When FALSE, the feature is binary — either unlocked or not.';

comment on column public.subscription_features.unit_label is
  'Human-readable unit for quantifiable features (e.g. tests per month, '
  'downloads per day). NULL for non-quantifiable features.';

comment on column public.subscription_features.is_active is
  'Soft delete for features. Inactive features are hidden from the plan builder '
  'and are not evaluated in access checks.';

-- 6c. Column comments — subscription_plans
comment on column public.subscription_plans.name is
  'Display name shown to students (e.g. NEET Gold — Monthly). Must be unique '
  'within the institute. Maximum 200 characters.';

comment on column public.subscription_plans.slug is
  'URL-safe identifier auto-generated from name (e.g. neet-gold-monthly). Used '
  'in marketing URLs and deep links. Unique within the institute.';

comment on column public.subscription_plans.price is
  'Listed price in the institute currency. Must be >= 0.00. 0.00 is valid for '
  'free plans. NUMERIC(10,2) supports up to 99,99,999.99 in INR.';

comment on column public.subscription_plans.currency_code is
  'ISO 4217 currency code (e.g. INR, USD, AED). Default INR. Three-character '
  'fixed-length to enforce ISO standard.';

comment on column public.subscription_plans.billing_cycle is
  'How frequently the plan recurs: monthly, quarterly, half_yearly, yearly, '
  'lifetime, or custom. Billing cycle is for display/analytics only — duration_days '
  'is what the system uses for expiry calculations.';

comment on column public.subscription_plans.duration_days is
  'Exact validity in days from the subscription start_date. For monthly: 30. '
  'For yearly: 365. For lifetime: a large value (e.g. 36500). This is the field '
  'the system uses for expiry calculations — not billing_cycle.';

comment on column public.subscription_plans.trial_days is
  'Number of free trial days before billing begins. 0 means no trial. Lifetime '
  'plans cannot have trial days.';

comment on column public.subscription_plans.max_students is
  'Maximum number of concurrent active subscribers. NULL means unlimited. Used '
  'for capacity-limited cohort plans. Enforced via trigger on subscription creation.';

comment on column public.subscription_plans.is_featured is
  'Whether the plan appears in the Featured/Recommended section on the pricing '
  'page. UI-only flag — no effect on access control.';

comment on column public.subscription_plans.sort_order is
  'Display order on the pricing page. Lower values appear first.';

comment on column public.subscription_plans.created_by is
  'FK to profiles. The admin who created the plan. RESTRICT on delete — plans '
  'cannot be orphaned.';

comment on column public.subscription_plans.updated_by is
  'FK to profiles. The admin who last modified the plan. SET NULL on profile '
  'soft-delete preserves the plan record.';

-- 6d. Column comments — plan_unlocks
comment on column public.plan_unlocks.is_enabled is
  'When FALSE, temporarily disables a feature on a plan without deleting the '
  'unlock row. Useful for maintenance windows or feature rollbacks.';

comment on column public.plan_unlocks.limit_value is
  'The usage cap for quantifiable features. NULL means unlimited. For non-'
  'quantifiable features, must be NULL. For quantifiable features, 0 means the '
  'feature is unlocked but immediately exhausted.';

comment on column public.plan_unlocks.limit_period_days is
  'The rolling window in days over which limit_value is counted. NULL for non-'
  'quantifiable features. Common values: 1 (daily), 7 (weekly), 30 (monthly), '
  '365 (yearly). Must be set together with limit_value.';

comment on column public.plan_unlocks.notes is
  'Internal admin notes about this specific unlock (e.g. reduced from 20 to 10 '
  'on 2025-01-15 per pricing review). Not shown to students.';

-- 6e. Column comments — student_subscriptions
comment on column public.student_subscriptions.status is
  'The current lifecycle state. Default pending on row creation. Only active '
  'and grace statuses grant feature access. Valid transitions enforced via trigger.';

comment on column public.student_subscriptions.start_date is
  'The date from which access begins. For paid subscriptions: payment confirmation '
  'date. For trials: trial start date. For admin-gifted: admin-specified date.';

comment on column public.student_subscriptions.end_date is
  'The date on which access expires. Computed as start_date + plan.duration_days. '
  'For lifetime plans: far-future date (e.g. 2099-12-31).';

comment on column public.student_subscriptions.grace_end_date is
  'The date on which the grace period (if active) ends. Set when status becomes '
  'grace. NULL when no grace period is active.';

comment on column public.student_subscriptions.is_trial is
  'Whether this subscription started as a free trial. Trial subscriptions cannot '
  'auto-renew — the student must actively convert to paid.';

comment on column public.student_subscriptions.is_auto_renew is
  'Whether the student has opted in to automatic renewal. Defaults to TRUE '
  '(opt-out model). When TRUE, the renewal service attempts renewal before end_date.';

comment on column public.student_subscriptions.payment_method_id is
  'Payment gateway stored payment method token. Never store raw card numbers — '
  'always store the gateway token. NULL for one-time/trial/non-auto-renew subscriptions.';

comment on column public.student_subscriptions.renewal_attempts is
  'Number of times the auto-renewal service has attempted to charge for the '
  'current renewal cycle. Reset to 0 on successful renewal.';

comment on column public.student_subscriptions.cancelled_at is
  'UTC timestamp when the subscription was cancelled. Set when status transitions '
  'to cancelled. NULL for all other statuses.';

-- 6f. Column comments — subscription_history
comment on column public.subscription_history.status_before is
  'The subscription status immediately before this change. NULL for the first '
  'history row (new_purchase event with no prior status).';

comment on column public.subscription_history.status_after is
  'The subscription status immediately after this change.';

comment on column public.subscription_history.change_reason is
  'Why the status changed. Enum: new_purchase, renewal, upgrade, downgrade, '
  'manual_activation, payment_failure, payment_recovery, admin_action, expiry, '
  'cancellation, refund.';

comment on column public.subscription_history.changed_by is
  'FK to profiles. The human actor who triggered the change. NULL for automated '
  'system events (renewal job, expiry job, payment webhook).';

comment on column public.subscription_history.changed_by_role is
  'Denormalized role of changed_by at the time of change. NULL for system events.';

comment on column public.subscription_history.payment_reference is
  'Payment gateway transaction ID associated with this event. NULL for non-payment '
  'related changes.';

comment on column public.subscription_history.metadata is
  'Additional context (e.g. {"renewal_attempt": 2, "failure_code": "insufficient_funds"} '
  'for a payment failure, or {"admin_note": "Manually activated"} for an admin action).';

comment on column public.subscription_history.occurred_at is
  'UTC timestamp when the state change occurred. The ordering column for '
  'history display.';

-- 6g. Column comments — subscription_renewals
comment on column public.subscription_renewals.attempted_at is
  'UTC timestamp when the renewal was attempted.';

comment on column public.subscription_renewals.succeeded_at is
  'UTC timestamp when the renewal payment was confirmed. NULL for failed attempts.';

comment on column public.subscription_renewals.amount_charged is
  'The amount actually charged. May differ from plan.price if a discount was '
  'applied. NULL for failed attempts.';

comment on column public.subscription_renewals.failure_code is
  'Payment gateway failure code (e.g. insufficient_funds, card_expired). '
  'NULL for successful renewals.';

comment on column public.subscription_renewals.failure_message is
  'Human-readable failure description from the gateway. Used in customer support. '
  'NULL for successful renewals.';

comment on column public.subscription_renewals.attempt_number is
  'Which attempt number for the current renewal cycle. First attempt is 1. Reset '
  'to 1 on a new billing period.';

comment on column public.subscription_renewals.new_end_date is
  'The new end_date set on student_subscriptions after a successful renewal. '
  'NULL for failed attempts.';

-- 6h. Column comments — subscription_cancellations
comment on column public.subscription_cancellations.reason is
  'Structured reason: student_request, admin_action, payment_failure_unresolved, '
  'fraud_detected, institute_deactivated, plan_discontinued.';

comment on column public.subscription_cancellations.reason_detail is
  'Free-text elaboration. For student_request: optional comment. For admin_action: '
  'mandatory note. Maximum 1000 characters.';

comment on column public.subscription_cancellations.effective_date is
  'The date from which access is revoked. For immediate: today. For end-of-period: '
  'the subscription end_date (student retains paid-period access).';

comment on column public.subscription_cancellations.days_used is
  'Number of days the student used the subscription before cancellation. Computed '
  'as effective_date - start_date. Used for prorated refund calculations.';

comment on column public.subscription_cancellations.days_remaining is
  'Number of days remaining at cancellation. Computed as end_date - effective_date.';

comment on column public.subscription_cancellations.refund_eligible is
  'Whether the student is eligible for a refund based on institute refund policy. '
  'Computed at cancellation time from system_settings.';

comment on column public.subscription_cancellations.refund_amount is
  'The refund amount to be issued. NULL until the refund is computed and approved. '
  'May be 0.00 if eligible but no refund is due.';

comment on column public.subscription_cancellations.refund_processed_at is
  'UTC timestamp when the refund was processed via the payment gateway. NULL '
  'until processed.';

-- 6i. Column comments — subscription_grace_periods
comment on column public.subscription_grace_periods.grace_start_date is
  'The date the grace period began. Typically the day after subscription end_date.';

comment on column public.subscription_grace_periods.grace_end_date is
  'The last date of the grace period. After this date the grace expiry job '
  'transitions the subscription to expired.';

comment on column public.subscription_grace_periods.trigger_reason is
  'Why the grace period was triggered: payment_failure, auto_renewal_failed, '
  'or manual_expiry.';

comment on column public.subscription_grace_periods.resolution is
  'How the grace period ended. NULL while active. Set when resolved: '
  'payment_recovered, expired_no_payment, admin_waived, cancelled.';

comment on column public.subscription_grace_periods.reminders_sent is
  'Count of payment reminder notifications sent during this grace period. Used '
  'to avoid sending excessive reminders.';

-- 6j. Column comments — subscription_usage
comment on column public.subscription_usage.period_start is
  'Start of the usage counting period. For monthly limits: the subscription '
  'billing cycle start date. For daily limits: today date. Periods are '
  'subscription-relative, not calendar-month-aligned.';

comment on column public.subscription_usage.period_end is
  'End of the usage counting period (inclusive). period_start + limit_period_days - 1.';

comment on column public.subscription_usage.used_count is
  'The number of times this feature has been consumed in this period. Incremented '
  'atomically on each feature use via UPSERT with cap check.';

comment on column public.subscription_usage.limit_snapshot is
  'Snapshot of plan_unlocks.limit_value at the time this usage period row was '
  'created. Ensures that if the plan limit changes mid-period, existing usage '
  'rows reflect the correct limit for that period.';

comment on column public.subscription_usage.last_used_at is
  'UTC timestamp of the most recent feature consumption event. NULL until first use.';


-- 6l. Trigger comments
comment on trigger trg_student_subscriptions_validate_status on public.student_subscriptions is
  'Enforces valid subscription status transitions. Rejects invalid transitions '
  'like pending → refunded or expired → cancelled.';

comment on trigger trg_student_subscriptions_auto_history on public.student_subscriptions  is
  'Automatically inserts a subscription_history row whenever student_subscriptions '
  'status changes. Ensures the commercial audit trail is always complete.';

comment on trigger trg_student_subscriptions_check_capacity on public.student_subscriptions is
  'Safety-net enforcement of plan max_students capacity. Prevents overselling '
  'capacity-limited plans at the database level. Primary enforcement is in the '
  'backend service using SELECT ... FOR UPDATE.';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — Domain 11 Subscription & Access Control
-- ════════════════════════════════════════════════════════════════════════════
