-- ============================================================================
-- Migration: Domain 13 — Teacher Management (HR & Business Operations)
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Tables: teacher_employment_records · teacher_specializations ·
--         teacher_qualifications · teacher_experiences ·
--         teacher_documents · teacher_bank_details ·
--         teacher_availability · teacher_leave_requests
--
-- Depends on: Domain 01 (institutes, profiles, teacher_details)
--             Domain 02 (subjects)
--             Existing functions (set_updated_at, get_my_institute_id, etc.)
--
-- New enums: employment_type · salary_basis_type ·
--            verification_status_type · document_category_type ·
--            day_of_week_type · leave_category_type · leave_status_type
--
-- Order:
--   1. New Enum Types (idempotent)
--   2. Tables (dependency order: parent → child)
--   3. Indexes (after all tables exist)
--   4. Functions (table-referencing functions for triggers)
--   5. Triggers (after all tables and functions exist)
--   6. Comments
--
-- Reference: Schema_Domain_13_Teacher_Management.md v1.0
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — New Enum Types (Idempotent)
-- ════════════════════════════════════════════════════════════════════════════
-- These enums are defined in this domain and used by the teacher management
-- tables. Each creation is wrapped in an idempotent DO block.

-- 1a. employment_type
-- Determines leave eligibility and payroll logic for teacher employment.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'employment_type') then
    create type employment_type as enum ('full_time', 'part_time', 'contract', 'freelance');
  end if;
end $$;

-- 1b. salary_basis_type
-- Defines the compensation model for teacher employment.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'salary_basis_type') then
    create type salary_basis_type as enum ('monthly_fixed', 'hourly_rate', 'revenue_share', 'per_class');
  end if;
end $$;

-- 1c. verification_status_type
-- Standardized KYC workflow states for documents and bank details.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'verification_status_type') then
    create type verification_status_type as enum ('pending', 'verified', 'rejected');
  end if;
end $$;

-- 1d. document_category_type
-- Classifies sensitive uploads for teacher KYC.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'document_category_type') then
    create type document_category_type as enum (
      'identity_proof', 'address_proof', 'education_cert', 'contract', 'cancelled_cheque'
    );
  end if;
end $$;

-- 1e. day_of_week_type
-- Standardised weekly scheduling for teacher availability.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'day_of_week_type') then
    create type day_of_week_type as enum (
      'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
    );
  end if;
end $$;

-- 1f. leave_category_type
-- Categorizes time-off for payroll deductions and policy enforcement.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'leave_category_type') then
    create type leave_category_type as enum (
      'casual', 'sick', 'unpaid', 'maternity_paternity', 'compensatory'
    );
  end if;
end $$;

-- 1g. leave_status_type
-- Tracks the workflow of a leave request.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'leave_status_type') then
    create type leave_status_type as enum ('pending', 'approved', 'rejected', 'cancelled');
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — CREATE TABLE Statements
-- ════════════════════════════════════════════════════════════════════════════
-- Teacher management: employment_records (core HR)
--                      specializations (subject authorizations)
--                      qualifications (academic credentials)
--                      experiences (work history)
--                      documents (KYC uploads)
--                      bank_details (payment info)
--                      availability (weekly schedule)
--                      leave_requests (time-off)

-- 2a. Table: teacher_employment_records
-- Core HR and business record for a teacher. Stores sensitive compensation
-- details, notice periods, and hiring dates. Acts as the single source of
-- truth for payroll calculation. One employment record per teacher (UNIQUE).
-- Soft-delete via is_active_employee = FALSE — never physically delete HR
-- records due to compliance and historical payroll integrity.
create table public.teacher_employment_records (
  employment_id         uuid              not null  default gen_random_uuid(),
  teacher_id            uuid              not null,
  institute_id          uuid              not null,
  emp_type              employment_type   not null  default 'contract',
  salary_basis          salary_basis_type not null,
  base_salary           numeric(10,2)     null      default null,
  revenue_share_percent numeric(5,2)      null      default null,
  date_of_joining       date              not null,
  notice_period_days    smallint          not null  default 30,
  is_active_employee    boolean           not null  default true,
  created_at            timestamptz       not null  default now(),
  updated_at            timestamptz       not null  default now(),

  -- Primary Key
  constraint pk_teacher_employment_records primary key (employment_id),

  -- Foreign Keys
  constraint fk_teacher_employment_records_teacher
    foreign key (teacher_id) references public.teacher_details (teacher_id)
    on delete restrict
    on update restrict,

  constraint fk_teacher_employment_records_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  -- Unique Constraints
  constraint uq_teacher_employment_records_teacher unique (teacher_id),

  -- CHECK Constraints
  constraint ck_teacher_employment_records_base_salary check (
    base_salary is null or base_salary >= 0
  ),
  constraint ck_teacher_employment_records_revenue_share check (
    revenue_share_percent is null
    or (revenue_share_percent >= 0 and revenue_share_percent <= 100)
  ),
  constraint ck_teacher_employment_records_notice_period check (
    notice_period_days >= 0
  )
);

-- 2b. Table: teacher_specializations
-- M:N junction linking a teacher to the specific academic subjects they are
-- authorised to teach. Powers the scheduling system to prevent assigning a
-- Physics teacher to a Biology live class. Replaces flat comma-separated
-- specialisation strings with structured, verifiable data.
create table public.teacher_specializations (
  specialization_id  uuid          not null  default gen_random_uuid(),
  teacher_id         uuid          not null,
  subject_id         uuid          not null,
  proficiency_level  smallint      not null  default 3,
  created_at         timestamptz   not null  default now(),
  updated_at         timestamptz   not null  default now(),

  -- Primary Key
  constraint pk_teacher_specializations primary key (specialization_id),

  -- Foreign Keys
  constraint fk_teacher_specializations_teacher
    foreign key (teacher_id) references public.teacher_details (teacher_id)
    on delete restrict
    on update restrict,

  constraint fk_teacher_specializations_subject
    foreign key (subject_id) references public.subjects (subject_id)
    on delete restrict
    on update restrict,

  -- Unique Constraints
  constraint uq_teacher_specializations_teacher_subject unique (teacher_id, subject_id),

  -- CHECK Constraints
  constraint ck_teacher_specializations_proficiency check (
    proficiency_level >= 1 and proficiency_level <= 5
  )
);

-- 2c. Table: teacher_qualifications
-- Structured record of a teacher's academic degrees, certifications, and
-- professional credentials. Each row represents one qualification earned.
-- Supports verification workflow for admin review.
create table public.teacher_qualifications (
  qualification_id  uuid          not null  default gen_random_uuid(),
  teacher_id        uuid          not null,
  degree_name       text          not null,
  institution       text          not null,
  field_of_study    text          not null,
  year_completed    smallint      null      default null,
  is_verified       boolean       not null  default false,
  verified_by       uuid          null      default null,
  verified_at       timestamptz   null      default null,
  created_at        timestamptz   not null  default now(),
  updated_at        timestamptz   not null  default now(),

  -- Primary Key
  constraint pk_teacher_qualifications primary key (qualification_id),

  -- Foreign Keys
  constraint fk_teacher_qualifications_teacher
    foreign key (teacher_id) references public.teacher_details (teacher_id)
    on delete restrict
    on update restrict,

  constraint fk_teacher_qualifications_verified_by
    foreign key (verified_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- CHECK Constraints
  constraint ck_teacher_qualifications_degree_name check (
    char_length(degree_name) >= 2
  ),
  constraint ck_teacher_qualifications_institution check (
    char_length(institution) >= 2
  ),
  constraint ck_teacher_qualifications_year_completed check (
    year_completed is null or year_completed >= 1950
  ),
  constraint ck_teacher_qualifications_verification_consistency check (
    (is_verified = true and verified_by is not null and verified_at is not null)
    or (is_verified = false and verified_by is null and verified_at is null)
  )
);

-- 2d. Table: teacher_experiences
-- Records a teacher's professional work history across different institutions.
-- Multiple rows per teacher representing different roles or employers.
-- end_date is NULL for the current/active position.
create table public.teacher_experiences (
  experience_id     uuid          not null  default gen_random_uuid(),
  teacher_id        uuid          not null,
  institution_name  text          not null,
  role              text          not null,
  subject_taught    text          null      default null,
  start_date        date          not null,
  end_date          date          null      default null,
  description       text          null      default null,
  is_verified       boolean       not null  default false,
  verified_by       uuid          null      default null,
  verified_at       timestamptz   null      default null,
  created_at        timestamptz   not null  default now(),
  updated_at        timestamptz   not null  default now(),

  -- Primary Key
  constraint pk_teacher_experiences primary key (experience_id),

  -- Foreign Keys
  constraint fk_teacher_experiences_teacher
    foreign key (teacher_id) references public.teacher_details (teacher_id)
    on delete restrict
    on update restrict,

  constraint fk_teacher_experiences_verified_by
    foreign key (verified_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- CHECK Constraints
  constraint ck_teacher_experiences_institution_name check (
    char_length(institution_name) >= 2
  ),
  constraint ck_teacher_experiences_role check (
    char_length(role) >= 2
  ),
  constraint ck_teacher_experiences_date_range check (
    end_date is null or end_date >= start_date
  ),
  constraint ck_teacher_experiences_verification_consistency check (
    (is_verified = true and verified_by is not null and verified_at is not null)
    or (is_verified = false and verified_by is null and verified_at is null)
  )
);

-- 2e. Table: teacher_documents
-- Stores metadata about sensitive KYC and contract documents uploaded by
-- or for a teacher. The actual file content is stored in Supabase Storage
-- or equivalent object storage; this table tracks the pointer and
-- verification state. Documents are classified by category for policy
-- enforcement (e.g., identity_proof is mandatory before payout).
create table public.teacher_documents (
  document_id       uuid                    not null  default gen_random_uuid(),
  teacher_id        uuid                    not null,
  institute_id      uuid                    not null,
  category          document_category_type  not null,
  storage_bucket    text                    not null,
  storage_path      text                    not null,
  original_filename text                    not null,
  mime_type         text                    not null,
  status            verification_status_type not null default 'pending',
  verified_by       uuid                    null      default null,
  verified_at       timestamptz             null      default null,
  rejection_reason  text                    null      default null,
  created_at        timestamptz             not null  default now(),
  updated_at        timestamptz             not null  default now(),

  -- Primary Key
  constraint pk_teacher_documents primary key (document_id),

  -- Foreign Keys
  constraint fk_teacher_documents_teacher
    foreign key (teacher_id) references public.teacher_details (teacher_id)
    on delete restrict
    on update restrict,

  constraint fk_teacher_documents_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_teacher_documents_verified_by
    foreign key (verified_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- CHECK Constraints
  constraint ck_teacher_documents_original_filename check (
    char_length(original_filename) > 0
  ),
  constraint ck_teacher_documents_status_consistency check (
    (status in ('verified', 'rejected') and verified_at is not null)
    or (status = 'pending' and verified_at is null)
  )
);

-- 2f. Table: teacher_bank_details
-- Stores teacher payout bank account information. One active bank detail
-- record per teacher (enforced via partial unique index). Account numbers
-- should be encrypted at the application layer before storage. Status
-- tracks KYC verification for compliance purposes.
create table public.teacher_bank_details (
  bank_detail_id      uuid                     not null  default gen_random_uuid(),
  teacher_id          uuid                     not null,
  institute_id        uuid                     not null,
  account_holder_name text                     not null,
  bank_name           text                     not null,
  account_number      text                     not null,
  ifsc_code           text                     not null,
  account_type        varchar(20)              not null  default 'savings',
  status              verification_status_type not null  default 'pending',
  verified_by         uuid                     null      default null,
  verified_at         timestamptz              null      default null,
  rejection_reason    text                     null      default null,
  is_active           boolean                  not null  default true,
  created_at          timestamptz              not null  default now(),
  updated_at          timestamptz              not null  default now(),

  -- Primary Key
  constraint pk_teacher_bank_details primary key (bank_detail_id),

  -- Foreign Keys
  constraint fk_teacher_bank_details_teacher
    foreign key (teacher_id) references public.teacher_details (teacher_id)
    on delete restrict
    on update restrict,

  constraint fk_teacher_bank_details_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_teacher_bank_details_verified_by
    foreign key (verified_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- Unique Constraints
  constraint uq_teacher_bank_details_teacher unique (teacher_id),

  -- CHECK Constraints
  constraint ck_teacher_bank_details_account_holder check (
    char_length(account_holder_name) >= 2
  ),
  constraint ck_teacher_bank_details_bank_name check (
    char_length(bank_name) >= 2
  ),
  constraint ck_teacher_bank_details_account_number check (
    char_length(account_number) >= 6
  ),
  constraint ck_teacher_bank_details_ifsc_code check (
    char_length(ifsc_code) >= 8 and char_length(ifsc_code) <= 11
  ),
  constraint ck_teacher_bank_details_account_type check (
    account_type in ('savings', 'current')
  ),
  constraint ck_teacher_bank_details_status_consistency check (
    (status in ('verified', 'rejected') and verified_at is not null)
    or (status = 'pending' and verified_at is null)
  )
);

-- 2g. Table: teacher_availability
-- Defines a teacher's recurring weekly schedule for live class scheduling.
-- Each row represents a time slot on a specific day of the week.
-- Multiple slots per day are supported (e.g., 9AM-12PM and 2PM-5PM).
-- The scheduling system uses this table to find available teachers
-- when assigning new live classes.
create table public.teacher_availability (
  availability_id  uuid            not null  default gen_random_uuid(),
  teacher_id       uuid            not null,
  day_of_week      day_of_week_type not null,
  start_time       time            not null,
  end_time         time            not null,
  is_available     boolean         not null  default true,
  created_at       timestamptz     not null  default now(),
  updated_at       timestamptz     not null  default now(),

  -- Primary Key
  constraint pk_teacher_availability primary key (availability_id),

  -- Foreign Keys
  constraint fk_teacher_availability_teacher
    foreign key (teacher_id) references public.teacher_details (teacher_id)
    on delete restrict
    on update restrict,

  -- Unique Constraints
  constraint uq_teacher_availability_slot unique (teacher_id, day_of_week, start_time),

  -- CHECK Constraints
  constraint ck_teacher_availability_time_range check (end_time > start_time)
);

-- 2h. Table: teacher_leave_requests
-- Tracks teacher time-off requests with approval workflow. Leave is
-- categorised by type for payroll deduction policy enforcement. A leave
-- request covers a date range (start_date to end_date inclusive). The
-- scheduling system checks this table before assigning live classes
-- to avoid conflicts with planned absences.
create table public.teacher_leave_requests (
  leave_id          uuid               not null  default gen_random_uuid(),
  teacher_id        uuid               not null,
  institute_id      uuid               not null,
  leave_category    leave_category_type not null,
  start_date        date               not null,
  end_date          date               not null,
  reason            text               null      default null,
  status            leave_status_type  not null  default 'pending',
  reviewed_by       uuid               null      default null,
  reviewed_at       timestamptz        null      default null,
  reviewer_remarks  text               null      default null,
  created_at        timestamptz        not null  default now(),
  updated_at        timestamptz        not null  default now(),

  -- Primary Key
  constraint pk_teacher_leave_requests primary key (leave_id),

  -- Foreign Keys
  constraint fk_teacher_leave_requests_teacher
    foreign key (teacher_id) references public.teacher_details (teacher_id)
    on delete restrict
    on update restrict,

  constraint fk_teacher_leave_requests_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_teacher_leave_requests_reviewed_by
    foreign key (reviewed_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- CHECK Constraints
  constraint ck_teacher_leave_requests_date_range check (end_date >= start_date),
  constraint ck_teacher_leave_requests_reason_length check (
    reason is null or char_length(reason) <= 2000
  ),
  constraint ck_teacher_leave_requests_review_consistency check (
    (status in ('approved', 'rejected') and reviewed_at is not null and reviewed_by is not null)
    or (status in ('pending', 'cancelled') and reviewed_at is null and reviewed_by is null)
  )
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Indexes
-- ════════════════════════════════════════════════════════════════════════════
-- All indexes are created after their respective tables exist.
-- No duplicate indexes on columns already covered by UNIQUE constraints.
-- Partial indexes used where specified in the schema.

-- 3a. teacher_employment_records indexes
create index if not exists idx_teacher_emp_institute_active
  on public.teacher_employment_records (institute_id, is_active_employee);

-- Note: uq_teacher_employment_records_teacher covers teacher_id lookups.

-- 3b. teacher_specializations indexes
create index if not exists idx_teacher_specializations_teacher
  on public.teacher_specializations (teacher_id);

create index if not exists idx_teacher_specializations_subject
  on public.teacher_specializations (subject_id);

-- Note: uq_teacher_specializations_teacher_subject covers (teacher_id, subject_id) lookups.

-- 3c. teacher_qualifications indexes
create index if not exists idx_teacher_qualifications_teacher
  on public.teacher_qualifications (teacher_id);

create index if not exists idx_teacher_qualifications_verified_by
  on public.teacher_qualifications (verified_by)
  where verified_by is not null;

-- 3d. teacher_experiences indexes
create index if not exists idx_teacher_experiences_teacher
  on public.teacher_experiences (teacher_id);

create index if not exists idx_teacher_experiences_verified_by
  on public.teacher_experiences (verified_by)
  where verified_by is not null;

-- 3e. teacher_documents indexes
create index if not exists idx_teacher_documents_teacher
  on public.teacher_documents (teacher_id, category);

create index if not exists idx_teacher_documents_institute_status
  on public.teacher_documents (institute_id, status);

create index if not exists idx_teacher_documents_verified_by
  on public.teacher_documents (verified_by)
  where verified_by is not null;

-- 3f. teacher_bank_details indexes
-- Note: uq_teacher_bank_details_teacher covers teacher_id lookups.

create index if not exists idx_teacher_bank_details_institute_status
  on public.teacher_bank_details (institute_id, status);

create index if not exists idx_teacher_bank_details_verified_by
  on public.teacher_bank_details (verified_by)
  where verified_by is not null;

-- 3g. teacher_availability indexes
create index if not exists idx_teacher_availability_teacher
  on public.teacher_availability (teacher_id, is_available);

-- Note: uq_teacher_availability_slot covers (teacher_id, day_of_week, start_time).

-- 3h. teacher_leave_requests indexes
create index if not exists idx_teacher_leave_requests_teacher
  on public.teacher_leave_requests (teacher_id, status);

create index if not exists idx_teacher_leave_requests_institute_status
  on public.teacher_leave_requests (institute_id, status);

create index if not exists idx_teacher_leave_requests_reviewed_by
  on public.teacher_leave_requests (reviewed_by)
  where reviewed_by is not null;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Functions That Reference Tables
-- ════════════════════════════════════════════════════════════════════════════
-- These functions are created after all tables exist because they reference
-- tables in their implementations.

-- 4a. Prevent overlap in teacher_availability time slots
-- When inserting or updating a teacher's availability, checks that the
-- new time slot does not overlap with any existing slots for the same
-- teacher on the same day. Uses range-based overlap detection:
--   existing.start_time < new.end_time AND new.start_time < existing.end_time
create or replace function public.trgfn_teacher_availability_no_overlap()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
      from public.teacher_availability
     where teacher_id = new.teacher_id
       and day_of_week = new.day_of_week
       and availability_id != coalesce(new.availability_id, '00000000-0000-0000-0000-000000000000')
       and start_time < new.end_time
       and new.start_time < end_time
  ) then
    raise exception 'Teacher % already has an overlapping time slot on %', new.teacher_id, new.day_of_week;
  end if;
  return new;
end;
$$;

-- 4c. Prevent leave overlap
-- When inserting or updating a leave request (status = pending or approved),
-- checks that the date range does not overlap with any existing non-cancelled
-- leave requests for the same teacher.
create or replace function public.trgfn_teacher_leave_no_overlap()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('pending', 'approved') then
    if exists (
      select 1
        from public.teacher_leave_requests
       where teacher_id = new.teacher_id
         and leave_id != coalesce(new.leave_id, '00000000-0000-0000-0000-000000000000')
         and status in ('pending', 'approved')
         and new.start_date <= end_date
         and new.end_date >= start_date
    ) then
      raise exception 'Teacher % already has a leave request overlapping the period % to %', new.teacher_id, new.start_date, new.end_date;
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

-- 5a. teacher_employment_records triggers
create trigger trg_teacher_employment_records_set_updated_at
  before update on public.teacher_employment_records
  for each row
  execute function public.set_updated_at();

-- 5b. teacher_specializations triggers
create trigger trg_teacher_specializations_set_updated_at
  before update on public.teacher_specializations
  for each row
  execute function public.set_updated_at();

-- 5c. teacher_qualifications triggers
create trigger trg_teacher_qualifications_set_updated_at
  before update on public.teacher_qualifications
  for each row
  execute function public.set_updated_at();

-- 5d. teacher_experiences triggers
create trigger trg_teacher_experiences_set_updated_at
  before update on public.teacher_experiences
  for each row
  execute function public.set_updated_at();

-- 5e. teacher_documents triggers
create trigger trg_teacher_documents_set_updated_at
  before update on public.teacher_documents
  for each row
  execute function public.set_updated_at();

-- 5f. teacher_bank_details triggers
create trigger trg_teacher_bank_details_set_updated_at
  before update on public.teacher_bank_details
  for each row
  execute function public.set_updated_at();

-- 5g. teacher_availability triggers
create trigger trg_teacher_availability_set_updated_at
  before update on public.teacher_availability
  for each row
  execute function public.set_updated_at();

create trigger trg_teacher_availability_no_overlap
  before insert or update on public.teacher_availability
  for each row
  execute function public.trgfn_teacher_availability_no_overlap();

-- 5h. teacher_leave_requests triggers
create trigger trg_teacher_leave_requests_set_updated_at
  before update on public.teacher_leave_requests
  for each row
  execute function public.set_updated_at();

create trigger trg_teacher_leave_requests_no_overlap
  before insert or update on public.teacher_leave_requests
  for each row
  execute function public.trgfn_teacher_leave_no_overlap();

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — COMMENT Statements
-- ════════════════════════════════════════════════════════════════════════════

-- 6a. Table comments
comment on table public.teacher_employment_records is
  'Core HR and business record for a teacher. Stores sensitive compensation '
  'details, notice periods, and hiring dates. Acts as the single source of '
  'truth for payroll calculation. One employment record per teacher (UNIQUE). '
  'Soft-delete via is_active_employee = FALSE — never physically delete HR records.';

comment on table public.teacher_specializations is
  'M:N junction linking a teacher to the specific academic subjects they are '
  'authorised to teach. Powers the scheduling system to prevent assigning a '
  'Physics teacher to a Biology live class.';

comment on table public.teacher_qualifications is
  'Structured record of a teacher academic degrees, certifications, and '
  'professional credentials. Each row represents one qualification earned. '
  'Supports verification workflow for admin review.';

comment on table public.teacher_experiences is
  'Records a teacher professional work history across different institutions. '
  'Multiple rows per teacher for different roles or employers. end_date is '
  'NULL for the current/active position.';

comment on table public.teacher_documents is
  'Metadata for sensitive KYC and contract documents uploaded for a teacher. '
  'Actual file content is stored in Supabase Storage; this table tracks the '
  'pointer and verification state. Documents are classified by category for '
  'policy enforcement (e.g. identity_proof is mandatory before payout).';

comment on table public.teacher_bank_details is
  'Stores teacher payout bank account information. One active record per '
  'teacher (UNIQUE). Account numbers should be encrypted at the application '
  'layer before storage. Status tracks KYC verification for compliance.';

comment on table public.teacher_availability is
  'Defines a teacher recurring weekly schedule for live class scheduling. '
  'Each row represents a time slot on a specific day. Multiple slots per '
  'day are supported. Time range overlap is prevented via trigger.';

comment on table public.teacher_leave_requests is
  'Tracks teacher time-off requests with approval workflow. Leave is '
  'categorised by type for payroll deduction policy enforcement. The '
  'scheduling system checks this table before assigning live classes '
  'to avoid conflicts with planned absences.';

-- 6b. Column comments — teacher_employment_records
comment on column public.teacher_employment_records.emp_type is
  'Nature of employment: full_time, part_time, contract, or freelance. '
  'Determines leave eligibility and payroll logic.';

comment on column public.teacher_employment_records.salary_basis is
  'How compensation is calculated: monthly_fixed, hourly_rate, revenue_share, '
  'or per_class. Backend payroll services must validate which numeric field '
  'to pull based on this enum.';

comment on column public.teacher_employment_records.base_salary is
  'Fixed amount in the institute currency. Interpretation depends on '
  'salary_basis: monthly_fixed → monthly amount, hourly_rate → per-hour rate, '
  'per_class → per-class rate. NULL when salary_basis = revenue_share.';

comment on column public.teacher_employment_records.revenue_share_percent is
  'Percentage of collected revenue paid to the teacher when salary_basis = '
  'revenue_share (e.g. 30.00 for 30%). Must be 0-100. NULL for other salary bases.';

comment on column public.teacher_employment_records.date_of_joining is
  'Official start date of employment at the institute.';

comment on column public.teacher_employment_records.notice_period_days is
  'Required days of notice before resignation or termination. Default 30 days.';

comment on column public.teacher_employment_records.is_active_employee is
  'Soft delete / separation flag. FALSE indicates the teacher has left the '
  'institute. Never physically delete HR records for compliance.';

-- 6c. Column comments — teacher_specializations
comment on column public.teacher_specializations.proficiency_level is
  'Self-reported or admin-assessed proficiency on a 1-5 scale. Default 3. '
  'Higher values indicate greater expertise in the subject.';

-- 6d. Column comments — teacher_qualifications
comment on column public.teacher_qualifications.degree_name is
  'Name of the degree or certification (e.g. B.Sc., M.Sc., Ph.D., B.Ed.).';

comment on column public.teacher_qualifications.institution is
  'Name of the educational institution that awarded the qualification.';

comment on column public.teacher_qualifications.field_of_study is
  'Academic discipline or major (e.g. Physics, Mathematics, Education).';

comment on column public.teacher_qualifications.year_completed is
  'Year the qualification was awarded. Must be 1950 or later. NULL if year '
  'is unknown or not yet completed.';

comment on column public.teacher_qualifications.is_verified is
  'Whether an admin has verified the original certificate. When TRUE, '
  'verified_by and verified_at must be populated.';

-- 6e. Column comments — teacher_experiences
comment on column public.teacher_experiences.institution_name is
  'Name of the institution or organisation where the teacher worked.';

comment on column public.teacher_experiences.role is
  'Job title or role held (e.g. Senior Physics Faculty, Academic Coordinator).';

comment on column public.teacher_experiences.subject_taught is
  'Subject(s) taught during this role. Free text for flexibility across '
  'different institutions with varying subject naming conventions.';

comment on column public.teacher_experiences.start_date is
  'Date the teacher began this role.';

comment on column public.teacher_experiences.end_date is
  'Date the teacher left this role. NULL indicates the current position.';

-- 6f. Column comments — teacher_documents
comment on column public.teacher_documents.category is
  'Type of document: identity_proof, address_proof, education_cert, contract, '
  'or cancelled_cheque. Determines which verification policy applies.';

comment on column public.teacher_documents.storage_bucket is
  'Supabase Storage bucket name where the document file is stored.';

comment on column public.teacher_documents.storage_path is
  'Object path within the storage bucket. Together with storage_bucket '
  'uniquely identifies the file.';

comment on column public.teacher_documents.mime_type is
  'IANA media type of the uploaded document (e.g. application/pdf, image/jpeg).';

comment on column public.teacher_documents.status is
  'KYC verification state: pending, verified, or rejected. Only verified '
  'documents are accepted for compliance and payout processing.';

comment on column public.teacher_documents.rejection_reason is
  'Admin-provided reason when status = rejected. Should include guidance '
  'on how to fix and resubmit.';

-- 6g. Column comments — teacher_bank_details
comment on column public.teacher_bank_details.account_holder_name is
  'Full name of the account holder as registered with the bank.';

comment on column public.teacher_bank_details.bank_name is
  'Name of the bank (e.g. State Bank of India, HDFC Bank).';

comment on column public.teacher_bank_details.account_number is
  'Bank account number. Must be encrypted at the application layer before '
  'storage. Minimum 6 characters for basic format validation.';

comment on column public.teacher_bank_details.ifsc_code is
  'Indian Financial System Code (11 characters for Indian banks). Used for '
  'NEFT/RTGS payments. Stored as TEXT to accommodate international formats.';

comment on column public.teacher_bank_details.account_type is
  'Type of bank account: savings or current. VARCHAR with CHECK for flexibility.';

comment on column public.teacher_bank_details.is_active is
  'Whether this bank detail is the active payout destination. Only one active '
  'record is allowed per teacher (enforced via UNIQUE on teacher_id).';

-- 6h. Column comments — teacher_availability
comment on column public.teacher_availability.day_of_week is
  'Day of the week for this availability slot. Enum: monday through sunday.';

comment on column public.teacher_availability.start_time is
  'Start time of the availability slot (e.g. 09:00:00 for 9 AM). Time-only, '
  'no date component.';

comment on column public.teacher_availability.end_time is
  'End time of the availability slot (e.g. 12:00:00 for 12 PM). Must be '
  'strictly after start_time. Overlapping slots are prevented via trigger.';

comment on column public.teacher_availability.is_available is
  'Whether this slot is currently active for scheduling. Set to FALSE to '
  'temporarily block a recurring slot without deleting it.';

-- 6i. Column comments — teacher_leave_requests
comment on column public.teacher_leave_requests.leave_category is
  'Type of leave: casual, sick, unpaid, maternity_paternity, or compensatory. '
  'Determines payroll deduction policy and entitlement tracking.';

comment on column public.teacher_leave_requests.start_date is
  'First date of the leave period (inclusive).';

comment on column public.teacher_leave_requests.end_date is
  'Last date of the leave period (inclusive). Must be >= start_date.';

comment on column public.teacher_leave_requests.reason is
  'Teacher-provided reason for the leave request. Maximum 2000 characters.';

comment on column public.teacher_leave_requests.status is
  'Current state: pending (awaiting review), approved, rejected, or cancelled. '
  'Only pending and approved leaves block scheduling overlaps.';

comment on column public.teacher_leave_requests.reviewer_remarks is
  'Admin notes or comments on the review decision. Optional.';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — Domain 13 Teacher Management (HR & Business Operations)
-- ════════════════════════════════════════════════════════════════════════════
