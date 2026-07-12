-- ============================================================================
-- Migration: 032 — Domain 16 Course Management — Core
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Tables: courses
--
-- Depends on: Domain 01 (institutes, profiles)
--             Domain 02 (streams)
--             Existing enums (difficulty_level, user_role, lifecycle_status)
--             Existing functions (set_updated_at, get_my_institute_id, etc.)
--
-- New Enums: course_status
--
-- Order:
--   1. New enum types (idempotent DO blocks)
--   2. Tables (dependency order: parent → child)
--   3. Indexes (after all tables exist)
--   4. Triggers (after all tables exist; set_updated_at already exists from Domain 1)
--   5. Comments
--
-- Reference: Domain 16 — Course Management Architecture
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 0 — New Enum Types (Idempotent)
-- ════════════════════════════════════════════════════════════════════════════
-- This domain introduces one new PostgreSQL enum: course_status.
-- All other enums referenced are defined globally in Domain 01 or 05.

-- 0a. course_status: Lifecycle for courses in the course catalog.
--     draft → pending_approval → approved → published → archived
--     pending_approval → draft (admin rejects)
do $$
begin
  if not exists (select 1 from pg_type where typname = 'course_status') then
    create type course_status as enum (
      'draft', 'pending_approval', 'approved', 'published', 'archived'
    );
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — CREATE TABLE Statements
-- ════════════════════════════════════════════════════════════════════════════
-- Course management: courses (core entity — one row per purchasable product)

-- 1a. Table: courses
-- The central record — one row per purchasable educational product. A course
-- is the top-level entity that organises batches, teachers, content, and
-- student enrollments into a coherent educational offering. Courses are
-- scoped to an institute and a stream. Soft-delete via deleted_at.
create table public.courses (
  course_id          uuid              not null  default gen_random_uuid(),
  institute_id       uuid              not null,
  stream_id          uuid              not null,
  title              varchar(300)      not null,
  slug               varchar(300)      not null,
  short_description  text              null      default null,
  description        text              null      default null,
  thumbnail_bucket   varchar(100)      null      default null,
  thumbnail_path     text              null      default null,
  banner_bucket      varchar(100)      null      default null,
  banner_path        text              null      default null,
  language           varchar(50)       null      default null,
  difficulty_level   difficulty_level  null      default null,
  duration           integer           null      default null,
  original_price     numeric(10,2)     not null  default 0.00,
  discounted_price   numeric(10,2)     null      default null,
  currency           varchar(3)        not null  default 'INR',
  status             course_status     not null  default 'draft',
  featured           boolean           not null  default false,
  trending           boolean           not null  default false,
  sort_order         smallint          not null  default 0,
  published_at       timestamptz       null      default null,
  created_at         timestamptz       not null  default now(),
  updated_at         timestamptz       not null  default now(),
  created_by         uuid              null      default null,
  updated_by         uuid              null      default null,
  deleted_at         timestamptz       null      default null,

  -- Primary Key
  constraint pk_courses primary key (course_id),

  -- Foreign Keys
  constraint fk_courses_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_courses_stream
    foreign key (stream_id) references public.streams (stream_id)
    on delete restrict
    on update restrict,

  constraint fk_courses_created_by
    foreign key (created_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  constraint fk_courses_updated_by
    foreign key (updated_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- Unique Constraints
  constraint uq_courses_institute_slug unique (institute_id, slug),

  -- CHECK Constraints
  constraint ck_courses_title_length check (char_length(title) >= 3),
  constraint ck_courses_slug_length check (char_length(slug) >= 3),
  constraint ck_courses_slug_format check (slug ~ '^[a-z0-9][a-z0-9\-]*[a-z0-9]$'),
  constraint ck_courses_original_price check (original_price >= 0),
  constraint ck_courses_discounted_price check
    (discounted_price is null or discounted_price >= 0),
  constraint ck_courses_price_consistency check
    (discounted_price is null or discounted_price <= original_price),
  constraint ck_courses_currency_length check (char_length(currency) = 3),
  constraint ck_courses_duration check
    (duration is null or duration > 0),
  constraint ck_courses_sort_order check (sort_order >= 0),
  constraint ck_courses_language_length check
    (language is null or char_length(language) >= 2),
  constraint ck_courses_thumbnail_storage check
    ((thumbnail_bucket is null) = (thumbnail_path is null)),
  constraint ck_courses_banner_storage check
    ((banner_bucket is null) = (banner_path is null)),
  constraint ck_courses_published_at check
    ((status = 'published'::course_status and published_at is not null)
     or (status != 'published'::course_status and published_at is null))
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Indexes
-- ════════════════════════════════════════════════════════════════════════════
-- All indexes are created after their respective tables exist.
-- No duplicate indexes on columns already covered by UNIQUE constraints.
-- Partial indexes are used where specified in the schema.

-- 2a. courses indexes
-- Primary catalog listing: published courses, newest first
create index if not exists idx_courses_institute_published
  on public.courses (institute_id, published_at desc)
  where status = 'published'::course_status;

-- Featured courses for homepage carousels
create index if not exists idx_courses_institute_featured
  on public.courses (institute_id, featured)
  where featured = true and status = 'published'::course_status;

-- Trending courses sorted by sort_order (admin-configurable)
create index if not exists idx_courses_institute_trending
  on public.courses (institute_id, sort_order)
  where trending = true and status = 'published'::course_status;

-- Admin listing: all courses for an institute, newest first
create index if not exists idx_courses_institute_created
  on public.courses (institute_id, created_at desc);

-- Partial index: exclude soft-deleted rows from all active queries
create index if not exists idx_courses_deleted_at
  on public.courses (deleted_at)
  where deleted_at is null;

-- Catalog search by title (B-tree for exact match and prefix ILIKE)
-- Note: Consider installing pg_trgm extension for fuzzy text search if needed
create index if not exists idx_courses_title
  on public.courses (title);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — CREATE TRIGGER Statements
-- ════════════════════════════════════════════════════════════════════════════
-- Only tables with an updated_at column receive the set_updated_at trigger.
-- set_updated_at() already exists from Domain 01 — do not recreate.

-- 3a. courses triggers
create trigger trg_courses_set_updated_at
  before update on public.courses
  for each row
  execute function public.set_updated_at();

-- 3b. Published-at auto-setter
-- Automatically sets published_at when status transitions to 'published'.
-- Clears published_at when status moves away from 'published'.
-- Mirrors the notification soft-delete trigger pattern (Domain 09).
create or replace function public.trgfn_courses_set_published_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'published'::course_status
     and (old.status is distinct from 'published'::course_status) then
    new.published_at = coalesce(new.published_at, now());
  elsif new.status is distinct from 'published'::course_status then
    new.published_at = null;
  end if;
  return new;
end;
$$;

create trigger trg_courses_set_published_at
  before update on public.courses
  for each row
  when (old.status is distinct from new.status)
  execute function public.trgfn_courses_set_published_at();

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — COMMENT Statements
-- ════════════════════════════════════════════════════════════════════════════

-- 4a. Table comments
comment on table public.courses is
  'Central record for purchasable educational products. A course is the '
  'top-level entity that organises batches, teachers, content, and student '
  'enrollments into a coherent educational offering. Scoped to an institute '
  'and stream. Soft-delete via deleted_at. Status lifecycle: draft → '
  'pending_approval → approved → published → archived. Only published '
  'courses appear in the student-facing catalog.' ;

-- 4b. Column comments
comment on column public.courses.course_id is
  'Primary key. Generated via gen_random_uuid().';

comment on column public.courses.institute_id is
  'FK to institutes. The institute that owns this course. All queries '
  'are filtered by this column for multi-tenant RLS enforcement.';

comment on column public.courses.stream_id is
  'FK to streams. The examination or academic programme this course belongs '
  'to (e.g. NEET, JEE). Courses are scoped to exactly one stream.';

comment on column public.courses.title is
  'Display name shown to students in the catalog and course detail page. '
  'Examples: "NEET 2026 Complete Preparation", "JEE Advanced Rank Booster". '
  'Minimum 3 characters.';

comment on column public.courses.slug is
  'URL-safe identifier auto-generated from title (e.g. neet-2026-complete). '
  'Unique within the institute. Used in marketing URLs and deep links.';

comment on column public.courses.short_description is
  'One-line summary shown in catalog cards and search results. Kept separate '
  'from the full description for performant list rendering.';

comment on column public.courses.description is
  'Full marketing description shown on the course detail page. May include '
  'HTML or Markdown formatting for rich content display.';

comment on column public.courses.thumbnail_bucket is
  'Supabase Storage bucket for the course thumbnail image. NULL if no '
  'thumbnail has been uploaded. Paired with thumbnail_path.';

comment on column public.courses.thumbnail_path is
  'Storage path within thumbnail_bucket. Signed URL generated dynamically '
  'at request time. NULL if no thumbnail has been uploaded.';

comment on column public.courses.banner_bucket is
  'Supabase Storage bucket for the course hero/banner image. NULL if no '
  'banner has been uploaded. Paired with banner_path.';

comment on column public.courses.banner_path is
  'Storage path within banner_bucket. Used as the hero image on the course '
  'detail page. Signed URL generated dynamically.';

comment on column public.courses.language is
  'Primary language of instruction for this course (e.g. English, Hindi, '
  'Bilingual). Free-text to accommodate regional language variants. '
  'Minimum 2 characters when set.';

comment on column public.courses.difficulty_level is
  'PostgreSQL enum from Domain 01: easy, medium, hard. Helps students gauge '
  'the course rigour. NULL until classified.';

comment on column public.courses.duration is
  'Expected duration of the course in days. Used for display and filtering. '
  'Not a hard expiry — student access duration is governed by the '
  'enrollment record. Positive integer when set.';

comment on column public.courses.original_price is
  'Listed price of the course in the institute currency. 0.00 for free '
  'courses. Must be >= 0.';

comment on column public.courses.discounted_price is
  'Current selling price after discount. NULL if no discount is active. '
  'Must be <= original_price when set. 0.00 is valid for free courses.';

comment on column public.courses.currency is
  'ISO 4217 currency code (e.g. INR, USD). Default INR — the platform''s '
  'primary market. Three-character fixed length enforced via CHECK.';

comment on column public.courses.status is
  'PostgreSQL enum: draft (invisible), pending_approval (submitted for '
  'review), approved (ready to publish), published (visible in catalog), '
  'archived (hidden from catalog, existing enrollments preserved).';

comment on column public.courses.featured is
  'When TRUE, the course appears in the Featured/Recommended section on '
  'the home page and catalog. UI-only flag — does not affect access control.';

comment on column public.courses.trending is
  'When TRUE, the course appears in the Trending section on the home page. '
  'May be set manually by admins or via an automated popularity algorithm '
  'in a future phase.';

comment on column public.courses.sort_order is
  'Display order for featured and trending listings. Lower values appear '
  'first. Use increments of 10 for gap-friendly sequencing. Must be >= 0.';

comment on column public.courses.published_at is
  'UTC timestamp when the course status transitioned to published. '
  'Auto-set by trigger when status becomes published. NULL for all other '
  'statuses.';

comment on column public.courses.created_at is
  'UTC timestamp of row creation.';

comment on column public.courses.updated_at is
  'UTC timestamp of last modification. Trigger-maintained.';

comment on column public.courses.created_by is
  'FK to profiles. The admin who created this course. SET NULL on profile '
  'soft-delete preserves the course record.';

comment on column public.courses.updated_by is
  'FK to profiles. The admin who last modified this course. SET NULL on '
  'profile soft-delete preserves the course record.';

comment on column public.courses.deleted_at is
  'Soft-delete timestamp. NULL = active. Non-null = soft-deleted. Courses '
  'with active enrollments must never be hard-deleted.';

-- 4c. Constraint comments
comment on constraint uq_courses_institute_slug on public.courses is
  'Enforces unique slugs within an institute. Prevents two courses from '
  'having the same URL-friendly identifier.';

comment on constraint ck_courses_title_length on public.courses is
  'Course title must be at least 3 characters. Prevents placeholder or '
  'accidental empty titles.';

comment on constraint ck_courses_slug_format on public.courses is
  'Slug must start and end with an alphanumeric character and may contain '
  'lowercase letters, digits, and hyphens. Prevents malformed URLs.';

comment on constraint ck_courses_price_consistency on public.courses is
  'Discounted price must never exceed the original price. Prevents display '
  'errors where the discounted price appears higher than the original.';

comment on constraint ck_courses_thumbnail_storage on public.courses is
  'Thumbnail bucket and path must be either both set or both NULL. Prevents '
  'orphaned storage references.';

comment on constraint ck_courses_banner_storage on public.courses is
  'Banner bucket and path must be either both set or both NULL. Same paired '
  'storage pattern as thumbnails and all other storage columns.';

comment on constraint ck_courses_published_at on public.courses is
  'published_at must be set when and only when status = published. '
  'Prevents half-written publish states. Auto-maintained via trigger.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — Row Level Security
-- ════════════════════════════════════════════════════════════════════════════
-- RLS policies for the courses table follow the same role-based pattern as
-- all existing domains (mock_tests, content, pyq_packages, etc.).

-- 5a. Enable RLS
alter table public.courses enable row level security;

-- 5b. Policies
-- Admins: full CRUD within their institute
create policy "Admins have full access to courses"
  on public.courses
  for all
  to authenticated
  using (institute_id = public.get_my_institute_id() and public.is_admin())
  with check (institute_id = public.get_my_institute_id() and public.is_admin());

-- Teachers: read published courses in their institute
create policy "Teachers can read published courses"
  on public.courses
  for select
  to authenticated
  using (status = 'published'::course_status
    and institute_id = public.get_my_institute_id()
    and public.is_teacher());

-- Students: read published courses in their institute (catalog)
create policy "Students can read published courses"
  on public.courses
  for select
  to authenticated
  using (status = 'published'::course_status
    and institute_id = public.get_my_institute_id()
    and public.is_student());

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 032 Domain 16 Course Management Core
-- ════════════════════════════════════════════════════════════════════════════
