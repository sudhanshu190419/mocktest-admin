-- ============================================================================
-- Migration: 033 — Domain 16 Course Management — Relationships
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Tables: course_teachers · course_batches · course_content
--
-- Depends on: Migration 032 (courses table)
--             Domain 01 (institutes, profiles, teacher_details)
--             Domain 02 (batches)
--             Domain 03 (content)
--             Existing functions (set_updated_at, get_my_institute_id, etc.)
--             Existing trigger functions (trgfn_courses_set_published_at from 032)
--
-- New Enums: None
--
-- Order:
--   1. Tables (dependency order: parent → child → junction)
--   2. Indexes (after all tables exist)
--   3. Comments
--
-- Reference: Domain 16 — Course Management Architecture
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — CREATE TABLE Statements
-- ════════════════════════════════════════════════════════════════════════════
-- Course relationships are implemented as junction tables to avoid modifying
-- existing domains. Each represents a many-to-many relationship between
-- courses and existing entities (teachers, batches, content).

-- 1a. Table: course_teachers
-- Many-to-many junction table linking teachers to courses. A course may have
-- multiple teachers; a teacher may teach multiple courses. Mirrors the
-- batch_teachers pattern from Domain 02. The role column identifies the
-- teacher's function within the course (e.g. lead_instructor, co_teacher).
create table public.course_teachers (
  course_id     uuid          not null,
  teacher_id    uuid          not null,
  institute_id  uuid          not null,
  role          varchar(50)   null      default null,
  assigned_at   timestamptz   not null  default now(),
  assigned_by   uuid          null      default null,

  -- Primary Key (composite — also enforces uniqueness)
  constraint pk_course_teachers primary key (course_id, teacher_id),

  -- Foreign Keys
  constraint fk_course_teachers_course
    foreign key (course_id) references public.courses (course_id)
    on delete restrict
    on update restrict,

  constraint fk_course_teachers_teacher
    foreign key (teacher_id) references public.teacher_details (teacher_id)
    on delete restrict
    on update restrict,

  constraint fk_course_teachers_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_course_teachers_assigned_by
    foreign key (assigned_by) references public.profiles (profile_id)
    on delete set null
    on update restrict
);

-- 1b. Table: course_batches
-- Many-to-many junction table linking batches to courses. A course may contain
-- multiple batches (e.g. a NEET course may have a Morning Batch and an Evening
-- Batch). A batch belongs to one or more courses if needed. Do NOT modify the
-- existing batches table — all course-to-batch relationships live here.
create table public.course_batches (
  course_id     uuid          not null,
  batch_id      uuid          not null,
  institute_id  uuid          not null,
  assigned_at   timestamptz   not null  default now(),
  assigned_by   uuid          null      default null,

  -- Primary Key (composite — also enforces uniqueness)
  constraint pk_course_batches primary key (course_id, batch_id),

  -- Foreign Keys
  constraint fk_course_batches_course
    foreign key (course_id) references public.courses (course_id)
    on delete restrict
    on update restrict,

  constraint fk_course_batches_batch
    foreign key (batch_id) references public.batches (batch_id)
    on delete restrict
    on update restrict,

  constraint fk_course_batches_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_course_batches_assigned_by
    foreign key (assigned_by) references public.profiles (profile_id)
    on delete set null
    on update restrict
);

-- 1c. Table: course_content
-- Many-to-many junction table linking content to courses. Maps individual
-- content items (PDFs, videos, notes, assignments) into a course curriculum
-- with explicit ordering. A content item may be part of multiple courses
-- or exist independently. Do NOT modify the existing content table.
create table public.course_content (
  course_id       uuid          not null,
  content_id      uuid          not null,
  institute_id    uuid          not null,
  order_sequence  integer       not null,
  section_name    varchar(100)  null      default null,
  is_optional     boolean       not null  default false,
  assigned_at     timestamptz   not null  default now(),
  assigned_by     uuid          null      default null,

  -- Primary Key (composite — also enforces uniqueness)
  constraint pk_course_content primary key (course_id, content_id),

  -- Foreign Keys
  constraint fk_course_content_course
    foreign key (course_id) references public.courses (course_id)
    on delete restrict
    on update restrict,

  constraint fk_course_content_content
    foreign key (content_id) references public.content (content_id)
    on delete restrict
    on update restrict,

  constraint fk_course_content_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_course_content_assigned_by
    foreign key (assigned_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- Unique Constraints
  constraint uq_course_content_course_sequence unique (course_id, order_sequence),

  -- CHECK Constraints
  constraint ck_course_content_order_sequence check (order_sequence >= 1)
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Indexes
-- ════════════════════════════════════════════════════════════════════════════
-- All indexes are created after their respective tables exist.
-- No duplicate indexes on columns already covered by UNIQUE constraints.
-- Partial indexes are used where specified in the schema.

-- 2a. course_teachers indexes
-- Reverse lookup: find all courses taught by a teacher
create index if not exists idx_course_teachers_teacher_id
  on public.course_teachers (teacher_id);

-- Institute-wide teacher assignment listing
create index if not exists idx_course_teachers_institute
  on public.course_teachers (institute_id);

-- Note: idx_course_teachers_course_id is covered by the composite PK leading column.

-- 2b. course_batches indexes
-- Reverse lookup: find all courses associated with a batch
create index if not exists idx_course_batches_batch_id
  on public.course_batches (batch_id);

-- Institute-wide batch-to-course mapping
create index if not exists idx_course_batches_institute
  on public.course_batches (institute_id);

-- Note: idx_course_batches_course_id is covered by the composite PK leading column.

-- 2c. course_content indexes
-- Reverse lookup: find all courses that include a specific content item
create index if not exists idx_course_content_content_id
  on public.course_content (content_id);

-- Ordered content listing for a course curriculum
create index if not exists idx_course_content_course_sequence
  on public.course_content (course_id, order_sequence);

-- Institute-wide content mapping listing
create index if not exists idx_course_content_institute
  on public.course_content (institute_id);

-- Partial index: only non-optional (required) content items
create index if not exists idx_course_content_required
  on public.course_content (course_id)
  where is_optional = false;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — COMMENT Statements
-- ════════════════════════════════════════════════════════════════════════════

-- 3a. Table comments
comment on table public.course_teachers is
  'Many-to-many junction table linking teachers to courses. A course may '
  'have multiple teachers; a teacher may teach multiple courses. Mirrors '
  'the batch_teachers pattern from Domain 02.' ;

comment on table public.course_batches is
  'Many-to-many junction table linking batches to courses. A course may '
  'contain multiple batches (e.g. a NEET course may have a Morning Batch '
  'and an Evening Batch). A batch may belong to multiple courses. This '
  'table is the sole source of truth — the existing batches table is not '
  'modified.' ;

comment on table public.course_content is
  'Many-to-many junction table linking content items to courses with '
  'explicit ordering. Maps individual content items (PDFs, videos, notes, '
  'assignments) into a course curriculum. A content item may be part of '
  'multiple courses or exist independently. The existing content table is '
  'not modified.' ;

-- 3b. Column comments — course_teachers
comment on column public.course_teachers.course_id is
  'FK to courses.course_id. The course the teacher is assigned to.';

comment on column public.course_teachers.teacher_id is
  'FK to teacher_details.teacher_id. The teacher assigned to the course.';

comment on column public.course_teachers.institute_id is
  'Denormalized for RLS performance and multi-tenant isolation.';

comment on column public.course_teachers.role is
  'Advisory teaching role within the course (e.g. lead_instructor, '
  'co_teacher, mentor, doubt_solver). Free text — not permission-enforced.';

comment on column public.course_teachers.assigned_at is
  'UTC timestamp when this teacher was assigned to the course.';

comment on column public.course_teachers.assigned_by is
  'FK to profiles. The admin who made the teacher assignment. SET NULL on '
  'profile soft-delete preserves the assignment record.';

-- 3c. Column comments — course_batches
comment on column public.course_batches.course_id is
  'FK to courses.course_id. The course the batch belongs to.';

comment on column public.course_batches.batch_id is
  'FK to batches.batch_id. The batch assigned to the course.';

comment on column public.course_batches.institute_id is
  'Denormalized for RLS performance and multi-tenant isolation.';

comment on column public.course_batches.assigned_at is
  'UTC timestamp when this batch was assigned to the course.';

comment on column public.course_batches.assigned_by is
  'FK to profiles. The admin who made the batch assignment. SET NULL on '
  'profile soft-delete preserves the assignment record.';

-- 3d. Column comments — course_content
comment on column public.course_content.course_id is
  'FK to courses.course_id. The course the content belongs to.';

comment on column public.course_content.content_id is
  'FK to content.content_id. The content item assigned to the course.';

comment on column public.course_content.institute_id is
  'Denormalized for RLS performance and multi-tenant isolation.';

comment on column public.course_content.order_sequence is
  'Display order of this content item within the course curriculum. '
  '1-indexed. Canonical ordering for the course syllabus. Must be >= 1.';

comment on column public.course_content.section_name is
  'Optional section or module label (e.g. Week 1, Module A: Kinematics, '
  'Chapter 1: Laws of Motion). NULL for single-section courses.';

comment on column public.course_content.is_optional is
  'When TRUE, this content item is supplementary/enrichment material and '
  'is not required for course completion. Does not affect progress tracking.';

comment on column public.course_content.assigned_at is
  'UTC timestamp when this content item was added to the course.';

comment on column public.course_content.assigned_by is
  'FK to profiles. The admin who added this content to the course. SET NULL '
  'on profile soft-delete preserves the assignment record.';

-- 3e. Constraint comments
comment on constraint pk_course_teachers on public.course_teachers is
  'Composite primary key prevents duplicate teacher assignments. A teacher '
  'can only be assigned to a course once.';

comment on constraint pk_course_batches on public.course_batches is
  'Composite primary key prevents duplicate batch assignments. The same '
  'batch cannot be assigned to the same course multiple times.';

comment on constraint uq_course_content_course_sequence on public.course_content is
  'No two content items in the same course may share the same order sequence '
  'number. Enforces clean curriculum ordering.';

comment on constraint ck_course_content_order_sequence on public.course_content is
  'Order sequence must be 1-indexed. Zero or negative values are not permitted.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Row Level Security
-- ════════════════════════════════════════════════════════════════════════════
-- RLS policies for junction tables follow the same role-based pattern as all
-- existing junction tables (batch_teachers, batch_students, content_tag, etc.).

-- 4a. Enable RLS on all tables
alter table public.course_teachers enable row level security;
alter table public.course_batches enable row level security;
alter table public.course_content enable row level security;

-- 4b. course_teachers policies
-- Admins: full CRUD within their institute
create policy "Admins have full access to course_teachers"
  on public.course_teachers
  for all
  to authenticated
  using (institute_id = public.get_my_institute_id() and public.is_admin())
  with check (institute_id = public.get_my_institute_id() and public.is_admin());

-- Teachers: read their own course assignments
create policy "Teachers can read their own course_teachers"
  on public.course_teachers
  for select
  to authenticated
  using (teacher_id = public.get_my_teacher_id());

-- Note: Student-read policies for all three tables are defined in Migration 034
-- after course_enrollments exists, because they reference course_enrollments.

-- 4c. course_batches policies
-- Admins: full CRUD within their institute
create policy "Admins have full access to course_batches"
  on public.course_batches
  for all
  to authenticated
  using (institute_id = public.get_my_institute_id() and public.is_admin())
  with check (institute_id = public.get_my_institute_id() and public.is_admin());

-- Teachers: read batches for courses they teach
create policy "Teachers can read course_batches for their courses"
  on public.course_batches
  for select
  to authenticated
  using (exists (
    select 1 from public.course_teachers ct
    where ct.course_id = course_batches.course_id
    and ct.teacher_id = public.get_my_teacher_id()
  ));

-- Note: Student-read policy for course_batches is defined in Migration 034.

-- 4d. course_content policies
-- Admins: full CRUD within their institute
create policy "Admins have full access to course_content"
  on public.course_content
  for all
  to authenticated
  using (institute_id = public.get_my_institute_id() and public.is_admin())
  with check (institute_id = public.get_my_institute_id() and public.is_admin());

-- Teachers: read content for courses they teach
create policy "Teachers can read course_content for their courses"
  on public.course_content
  for select
  to authenticated
  using (exists (
    select 1 from public.course_teachers ct
    where ct.course_id = course_content.course_id
    and ct.teacher_id = public.get_my_teacher_id()
  ));

-- Note: Student-read policy for course_content is defined in Migration 034.

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 033 Domain 16 Course Management Relationships
-- ════════════════════════════════════════════════════════════════════════════
