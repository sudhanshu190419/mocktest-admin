-- ============================================================================
-- Migration: Domain 01 — Foundation
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Tables: institutes · profiles · teacher_details · student_details
--
-- Note: This migration has been reordered into strict dependency order.
--   Functions that reference tables (get_my_institute_id, check_teacher_role,
--   check_student_role, handle_new_user) are placed after all tables and
--   indexes exist. Triggers are placed after all functions exist.
--
-- Reference: Schema_Domain_01_Foundation.md v1.0 | ERD v3.0
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 0 — PostgreSQL Extension
-- ════════════════════════════════════════════════════════════════════════════
-- pgcrypto: Required for gen_random_uuid() across all domains.
-- PostgreSQL 16 has gen_random_uuid() in pg_catalog, but pgcrypto is
-- explicitly required by safety-critical extensions and Supabase dependencies.
create extension if not exists pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Enum Types (Idempotent)
-- ════════════════════════════════════════════════════════════════════════════
-- All enums are defined here. These are referenced throughout every domain.
-- Each creation is wrapped in an idempotent DO block so re-running the
-- migration never fails with "type already exists".
-- Defined globally before any table creation as specified in the schema doc.

-- 1a. Identity & Access
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type user_role as enum ('admin', 'teacher', 'student');
  end if;
end $$;

-- 1b. Content & Lifecycle
do $$
begin
  if not exists (select 1 from pg_type where typname = 'lifecycle_status') then
    create type lifecycle_status as enum ('draft', 'pending_review', 'approved', 'rejected', 'archived');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'content_type') then
    create type content_type as enum ('pdf', 'video', 'notes', 'assignment');
  end if;
end $$;

-- 1c. Question Bank
do $$
begin
  if not exists (select 1 from pg_type where typname = 'question_type') then
    create type question_type as enum ('mcq', 'msq', 'numerical', 'true_false');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'question_source_type') then
    create type question_source_type as enum ('teacher', 'pyq', 'imported');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'difficulty_level') then
    create type difficulty_level as enum ('easy', 'medium', 'hard');
  end if;
end $$;

-- 1d. Batch Management
do $$
begin
  if not exists (select 1 from pg_type where typname = 'batch_status') then
    create type batch_status as enum ('upcoming', 'active', 'completed', 'archived');
  end if;
end $$;

-- 1e. Subscriptions & Commerce
do $$
begin
  if not exists (select 1 from pg_type where typname = 'subscription_status') then
    create type subscription_status as enum ('active', 'expired', 'cancelled');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type payment_status as enum ('pending', 'captured', 'failed', 'refunded', 'partially_refunded');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'order_status') then
    create type order_status as enum ('pending', 'confirmed', 'cancelled', 'refunded');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'invoice_status') then
    create type invoice_status as enum ('draft', 'issued', 'cancelled');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'item_type') then
    create type item_type as enum ('subscription_plan', 'pyq_package');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_gateway') then
    create type payment_gateway as enum ('razorpay', 'stripe', 'payu', 'cashfree');
  end if;
end $$;

-- 1f. Live Learning
do $$
begin
  if not exists (select 1 from pg_type where typname = 'live_class_status') then
    create type live_class_status as enum ('draft', 'scheduled', 'live', 'completed', 'cancelled');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'live_session_status') then
    create type live_session_status as enum ('waiting', 'live', 'ended');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'recording_status') then
    create type recording_status as enum ('queued', 'processing', 'completed', 'failed');
  end if;
end $$;

-- 1g. Mock Test Engine
do $$
begin
  if not exists (select 1 from pg_type where typname = 'attempt_status') then
    create type attempt_status as enum ('in_progress', 'submitted', 'abandoned', 'timed_out');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'platform_type') then
    create type platform_type as enum ('web', 'android', 'ios');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'device_type') then
    create type device_type as enum ('mobile', 'tablet', 'desktop');
  end if;
end $$;

-- 1h. Approval System
do $$
begin
  if not exists (select 1 from pg_type where typname = 'approval_resource_type') then
    create type approval_resource_type as enum ('content', 'mock_test');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'approval_status') then
    create type approval_status as enum ('pending', 'approved', 'rejected');
  end if;
end $$;

-- 1i. Notifications
do $$
begin
  if not exists (select 1 from pg_type where typname = 'notification_channel') then
    create type notification_channel as enum ('in_app', 'push', 'email', 'sms');
  end if;
end $$;

-- 1j. Media
do $$
begin
  if not exists (select 1 from pg_type where typname = 'image_role') then
    create type image_role as enum ('question', 'option', 'explanation');
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Helper Function (No Table References)
-- ════════════════════════════════════════════════════════════════════════════
-- Only set_updated_at() is defined here because it does not reference any
-- table. Functions that reference tables are placed after all tables exist.

-- 2a. set_updated_at()
-- Reusable trigger function that sets updated_at = NOW() on any table.
-- Apply to every table that has an updated_at column (DRY pattern).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — CREATE TABLE Statements
-- ════════════════════════════════════════════════════════════════════════════
-- All tables are created before any indexes, table-referencing functions, or
-- triggers. Order respects foreign-key dependencies:
--   institutes → profiles → teacher_details, student_details

-- 3a. Table: institutes
-- Root entity of the multi-tenant SaaS platform.
-- Every piece of data belongs to exactly one institute.
-- Soft-disable via is_active = FALSE. Hard deletion is forbidden.

create table if not exists public.institutes (
  institute_id  uuid          not null  default gen_random_uuid(),
  name          varchar(255)  not null,
  slug          varchar(100)  not null,
  domain        varchar(255)  null      default null,
  logo_url      text          null      default null,
  plan_tier     varchar(50)   not null  default 'starter',
  is_active     boolean       not null  default true,
  created_at    timestamptz   not null  default now(),
  updated_at    timestamptz   not null  default now(),

  -- Primary Key
  constraint pk_institutes primary key (institute_id),

  -- Unique Constraints
  constraint uq_institutes_slug unique (slug),
  constraint uq_institutes_domain unique (domain),

  -- CHECK Constraints
  constraint ck_institutes_slug_length check (char_length(slug) >= 3),
  constraint ck_institutes_slug_format check (slug ~ '^[a-z0-9-]+$'),
  constraint ck_institutes_plan_tier check (plan_tier in ('starter', 'growth', 'enterprise'))
);

-- 3b. Table: profiles
-- Central identity table. profile_id = auth.users.id (1:1 relationship).
-- role determines which detail table is populated (teacher_details or student_details).

create table if not exists public.profiles (
  profile_id    uuid          not null,
  institute_id  uuid          not null,
  name          varchar(255)  not null,
  email         varchar(255)  not null,
  phone         varchar(20)   null      default null,
  avatar_url    text          null      default null,
  role          user_role     not null,
  is_active     boolean       not null  default true,
  created_at    timestamptz   not null  default now(),
  updated_at    timestamptz   not null  default now(),

  -- Primary Key
  constraint pk_profiles primary key (profile_id),

  -- Foreign Keys
  constraint fk_profiles_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  -- Unique Constraints
  constraint uq_profiles_email unique (email),

  -- CHECK Constraints
  constraint ck_profiles_name_length check (char_length(name) >= 2),
  constraint ck_profiles_phone_format check (
    phone is null or phone ~ '^\+[1-9]\d{6,14}$'
  ),
  constraint ck_profiles_email_format check (
    email ~* '^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$'
  )
);

-- 3c. Table: teacher_details
-- Teacher-specific profile extension. Table-per-type pattern.
-- Every profile with role = 'teacher' has exactly one row here.

create table if not exists public.teacher_details (
  teacher_id      uuid          not null  default gen_random_uuid(),
  profile_id      uuid          not null,
  specialization  varchar(255)  null      default null,
  qualification   varchar(255)  null      default null,
  bio             text          null      default null,
  rating          numeric(3,2)  null      default null,
  created_at      timestamptz   not null  default now(),
  updated_at      timestamptz   not null  default now(),

  -- Primary Key
  constraint pk_teacher_details primary key (teacher_id),

  -- Foreign Keys
  constraint fk_teacher_details_profile
    foreign key (profile_id) references public.profiles (profile_id)
    on delete restrict
    on update restrict,

  -- Unique Constraints
  constraint uq_teacher_details_profile_id unique (profile_id),

  -- CHECK Constraints
  constraint ck_teacher_details_rating check (
    rating is null or (rating >= 0.00 and rating <= 5.00)
  )
);

-- 3d. Table: student_details
-- Student-specific profile extension. Table-per-type pattern.
-- Every profile with role = 'student' has exactly one row here.
-- Referenced by MockAttempt, BatchStudent, StudentSubscription, Order, etc.

-- Note: institute_id is denormalized here as recommended in the schema doc
-- (see "Unique Constraints" section). This enables direct RLS without a join,
-- supports the partial unique constraint on enrollment_no per institute,
-- and optimises analytics queries.

create table if not exists public.student_details (
  student_id      uuid          not null  default gen_random_uuid(),
  profile_id      uuid          not null,
  institute_id    uuid          not null,
  enrollment_no   varchar(50)   null      default null,
  dob             date          null      default null,
  target_year     varchar(10)   null      default null,
  enrolled_on     date          null      default null,
  created_at      timestamptz   not null  default now(),
  updated_at      timestamptz   not null  default now(),

  -- Primary Key
  constraint pk_student_details primary key (student_id),

  -- Foreign Keys
  constraint fk_student_details_profile
    foreign key (profile_id) references public.profiles (profile_id)
    on delete restrict
    on update restrict,

  constraint fk_student_details_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  -- Unique Constraints
  constraint uq_student_details_profile_id unique (profile_id),

  -- CHECK Constraints
  constraint ck_student_details_dob_future check (dob is null or dob < current_date),
  constraint ck_student_details_dob_range check (dob is null or dob > '1900-01-01'),
  constraint ck_student_details_enrollment_length check (
    enrollment_no is null or char_length(enrollment_no) >= 2
  )
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Indexes
-- ════════════════════════════════════════════════════════════════════════════
-- All indexes are created after their respective tables exist.

-- 4a. institutes indexes
create index if not exists idx_institutes_is_active
  on public.institutes (is_active);

-- Note: idx_institutes_slug is covered by uq_institutes_slug (unique constraint creates index automatically).
-- No additional indexes needed given expected low cardinality (hundreds, not millions).

-- 4b. profiles indexes
create index if not exists idx_profiles_institute_role
  on public.profiles (institute_id, role);

create index if not exists idx_profiles_institute_is_active
  on public.profiles (institute_id, is_active);

-- Note: idx_profiles_email is covered by uq_profiles_email (unique constraint).

-- 4c. teacher_details indexes
create index if not exists idx_teacher_details_rating
  on public.teacher_details (rating desc nulls last);

-- Note: idx_teacher_details_profile_id is covered by uq_teacher_details_profile_id.

-- 4d. student_details indexes
-- Partial Unique Index: enrollment_no is unique per institute, but nullable
-- (the WHERE clause allows multiple NULL enrollment_no values).
create unique index if not exists uq_student_details_institute_enrollment
  on public.student_details (institute_id, enrollment_no)
  where enrollment_no is not null;

create index if not exists idx_student_details_institute_target_year
  on public.student_details (institute_id, target_year);

-- Note: idx_student_details_profile_id is covered by uq_student_details_profile_id.

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — Functions That Reference Tables
-- ════════════════════════════════════════════════════════════════════════════
-- These functions are created after all tables exist because they reference
-- public.profiles (or other tables) in their implementations.

-- 5a. get_my_institute_id()
-- Returns the institute_id for the currently authenticated user.
-- Used by all RLS policies across all 14 domains to enforce multi-tenancy.
-- SECURITY DEFINER prevents infinite recursion when called from profile RLS.
-- SET search_path = '' hardens against search-path hijacking (Supabase best practice).
create or replace function public.get_my_institute_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select institute_id from public.profiles where profile_id = auth.uid() limit 1
$$;

-- 5b. Teacher role check function
-- Used by triggers that enforce teacher_details rows only reference profiles
-- with role = 'teacher'. Prevents data corruption.
create or replace function public.check_teacher_role()
returns trigger
language plpgsql
as $$
declare
  v_role user_role;
begin
  select role into strict v_role
    from public.profiles
   where profile_id = new.profile_id;

  if v_role is distinct from 'teacher' then
    raise exception 'Profile % has role % — teacher_details requires role = teacher',
      new.profile_id, v_role;
  end if;

  return new;
exception
  when no_data_found then
    raise exception 'Profile % does not exist — cannot create teacher_details', new.profile_id;
end;
$$;

-- 5c. Student role check function
-- Used by triggers that enforce student_details rows only reference profiles
-- with role = 'student'. Prevents data corruption.
create or replace function public.check_student_role()
returns trigger
language plpgsql
as $$
declare
  v_role user_role;
begin
  select role into strict v_role
    from public.profiles
   where profile_id = new.profile_id;

  if v_role is distinct from 'student' then
    raise exception 'Profile % has role % — student_details requires role = student',
      new.profile_id, v_role;
  end if;

  return new;
exception
  when no_data_found then
    raise exception 'Profile % does not exist — cannot create student_details', new.profile_id;
end;
$$;

-- 5d. handle_new_user()
-- Automatically creates a profiles row when a new user signs up via
-- Supabase Auth (auth.users insert).
--
-- Design decisions:
--   • Uses raw_user_meta_data to extract role and institute_id.
--     The application must pass these in the sign-up metadata payload.
--   • SECURITY DEFINER + SET search_path = '' prevents privilege escalation.
--   • Idempotent: skips insert if a profile for this user already exists
--     (safe for re-runs and concurrent webhook invocations).
--   • Coalesce name with email so the profile is always valid even when
--     full_name is not provided in metadata.
--
-- Compatible with: Supabase Auth webhooks, trigger-based sync.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_institute_id uuid;
  v_role         public.user_role;
begin
  -- institute_id is mandatory — must be provided in sign-up metadata
  v_institute_id := (new.raw_user_meta_data ->> 'institute_id')::uuid;
  if v_institute_id is null then
    raise exception 'institute_id is required in raw_user_meta_data during sign-up';
  end if;

  -- Default role to student if not explicitly provided
  v_role := coalesce(
    (new.raw_user_meta_data ->> 'role')::public.user_role,
'student'::public.user_role
  );

  insert into public.profiles (
    profile_id,
    email,
    name,
    role,
    institute_id
  ) values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    ),
    v_role,
    v_institute_id
  )
  on conflict (profile_id) do nothing;
  return new;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — CREATE TRIGGER Statements
-- ════════════════════════════════════════════════════════════════════════════
-- All triggers are created after all functions exist.

-- 6a. institutes triggers
create trigger trg_institutes_set_updated_at
  before update on public.institutes
  for each row
  execute function public.set_updated_at();

-- 6b. profiles triggers
create trigger trg_profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- 6c. teacher_details triggers
create trigger trg_teacher_details_check_role
  before insert or update on public.teacher_details
  for each row
  execute function public.check_teacher_role();

create trigger trg_teacher_details_set_updated_at
  before update on public.teacher_details
  for each row
  execute function public.set_updated_at();

-- 6d. student_details triggers
create trigger trg_student_details_check_role
  before insert or update on public.student_details
  for each row
  execute function public.check_student_role();

create trigger trg_student_details_set_updated_at
  before update on public.student_details
  for each row
  execute function public.set_updated_at();

-- 6e. Auth triggers
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — Domain 01 Foundation
-- ════════════════════════════════════════════════════════════════════════════
