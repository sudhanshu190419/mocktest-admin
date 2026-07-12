-- ============================================================================
-- Migration: Domain 02 — Academic Structure & Batch Management
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Tables: streams · subjects · chapters · topics · batches ·
--         batch_students · batch_teachers
--
-- Depends on: Domain 01 (institutes, profiles, teacher_details, student_details)
--             Existing enums (user_role, batch_status, etc.)
--             Existing functions (set_updated_at, get_my_institute_id, etc.)
--
-- Order:
--   1. Tables (dependency order: parent → child → junction)
--   2. Indexes (after all tables exist)
--   3. Triggers (after all tables exist; set_updated_at already exists from Domain 1)
--   4. Comments
--
-- Reference: Schema_Domain_02_Academic.md v1.0 | ERD v3.0
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — CREATE TABLE Statements
-- ════════════════════════════════════════════════════════════════════════════
-- Academic hierarchy: streams → subjects → chapters → topics
-- Batch management:   batches  → batch_students, batch_teachers
--
-- Every table references existing Domain 01 objects only.
-- Audit fields (created_by, updated_by) are added to tables where the schema
-- recommends them, following the same pattern as batches.

-- 1a. Table: streams
-- A stream represents a major examination or academic programme (e.g. NEET, JEE).
-- Each institute defines its own streams. Top node of the academic hierarchy.
-- Soft-disable via is_active = FALSE. Hard deletion is forbidden.
-- Direct FK to institutes for RLS.
create table public.streams (
  stream_id      uuid          not null  default gen_random_uuid(),
  institute_id   uuid          not null,
  name           varchar(100)  not null,
  code           varchar(20)   not null,
  description    text          null      default null,
  is_active      boolean       not null  default true,
  display_order  smallint      not null  default 0,
  created_at     timestamptz   not null  default now(),
  updated_at     timestamptz   not null  default now(),
  created_by     uuid          null      default null,
  updated_by     uuid          null      default null,

  -- Primary Key
  constraint pk_streams primary key (stream_id),

  -- Foreign Keys
  constraint fk_streams_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_streams_created_by
    foreign key (created_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  constraint fk_streams_updated_by
    foreign key (updated_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- Unique Constraints
  constraint uq_streams_institute_code unique (institute_id, code),

  -- CHECK Constraints
  constraint ck_streams_name_length check (char_length(name) >= 2),
  constraint ck_streams_code_length check (char_length(code) >= 2),
  constraint ck_streams_code_format check (code ~ '^[A-Z0-9_-]+$'),
  constraint ck_streams_display_order check (display_order >= 0)
);

-- 1b. Table: subjects
-- A subject belongs to exactly one stream (e.g. Physics within NEET).
-- Second level of the content hierarchy. No direct institute_id — resolved via stream FK.
create table public.subjects (
  subject_id     uuid          not null  default gen_random_uuid(),
  stream_id      uuid          not null,
  name           varchar(100)  not null,
  code           varchar(20)   not null,
  display_order  smallint      not null  default 0,
  created_at     timestamptz   not null  default now(),
  updated_at     timestamptz   not null  default now(),
  created_by     uuid          null      default null,
  updated_by     uuid          null      default null,

  -- Primary Key
  constraint pk_subjects primary key (subject_id),

  -- Foreign Keys
  constraint fk_subjects_stream
    foreign key (stream_id) references public.streams (stream_id)
    on delete restrict
    on update restrict,

  constraint fk_subjects_created_by
    foreign key (created_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  constraint fk_subjects_updated_by
    foreign key (updated_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- Unique Constraints
  constraint uq_subjects_stream_code unique (stream_id, code),

  -- CHECK Constraints
  constraint ck_subjects_name_length check (char_length(name) >= 2),
  constraint ck_subjects_code_length check (char_length(code) >= 2),
  constraint ck_subjects_code_format check (code ~ '^[A-Z0-9_-]+$'),
  constraint ck_subjects_display_order check (display_order >= 0)
);

-- 1c. Table: chapters
-- A chapter belongs to exactly one subject (e.g. Laws of Motion within Physics).
-- Primary content-tagging unit. Content, questions, live classes reference chapters.
create table public.chapters (
  chapter_id     uuid          not null  default gen_random_uuid(),
  subject_id     uuid          not null,
  name           varchar(150)  not null,
  description    text          null      default null,
  display_order  smallint      not null  default 0,
  created_at     timestamptz   not null  default now(),
  updated_at     timestamptz   not null  default now(),
  created_by     uuid          null      default null,
  updated_by     uuid          null      default null,

  -- Primary Key
  constraint pk_chapters primary key (chapter_id),

  -- Foreign Keys
  constraint fk_chapters_subject
    foreign key (subject_id) references public.subjects (subject_id)
    on delete restrict
    on update restrict,

  constraint fk_chapters_created_by
    foreign key (created_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  constraint fk_chapters_updated_by
    foreign key (updated_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- Unique Constraints
  constraint uq_chapters_subject_name unique (subject_id, name),

  -- CHECK Constraints
  constraint ck_chapters_name_length check (char_length(name) >= 2),
  constraint ck_chapters_display_order check (display_order >= 0)
);

-- 1d. Table: topics
-- Optional fourth level of the academic hierarchy, below chapters.
-- Provides sub-chapter granularity for content tagging.
-- Not all institutes will use topics.
create table public.topics (
  topic_id       uuid          not null  default gen_random_uuid(),
  chapter_id     uuid          not null,
  name           varchar(150)  not null,
  display_order  smallint      not null  default 0,
  created_at     timestamptz   not null  default now(),
  updated_at     timestamptz   not null  default now(),
  created_by     uuid          null      default null,
  updated_by     uuid          null      default null,

  -- Primary Key
  constraint pk_topics primary key (topic_id),

  -- Foreign Keys
  constraint fk_topics_chapter
    foreign key (chapter_id) references public.chapters (chapter_id)
    on delete restrict
    on update restrict,

  constraint fk_topics_created_by
    foreign key (created_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  constraint fk_topics_updated_by
    foreign key (updated_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- Unique Constraints
  constraint uq_topics_chapter_name unique (chapter_id, name),

  -- CHECK Constraints
  constraint ck_topics_name_length check (char_length(name) >= 2),
  constraint ck_topics_display_order check (display_order >= 0)
);

-- 1e. Table: batches
-- The operational unit of student delivery within a stream.
-- Students receive live classes, content, and mock tests through batch membership.
-- Soft-delete via deleted_at. created_by/updated_by track admin actions.
create table public.batches (
  batch_id       uuid            not null  default gen_random_uuid(),
  institute_id   uuid            not null,
  stream_id      uuid            not null,
  name           varchar(150)    not null,
  batch_code     varchar(30)     not null,
  academic_year  varchar(10)     not null,
  start_date     date            not null,
  end_date       date            not null,
  max_seats      smallint        null      default null,
  status         batch_status    not null  default 'upcoming',
  created_at     timestamptz     not null  default now(),
  updated_at     timestamptz     not null  default now(),
  created_by     uuid            null      default null,
  updated_by     uuid            null      default null,
  deleted_at     timestamptz     null      default null,

  -- Primary Key
  constraint pk_batches primary key (batch_id),

  -- Foreign Keys
  constraint fk_batches_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_batches_stream
    foreign key (stream_id) references public.streams (stream_id)
    on delete restrict
    on update restrict,

  constraint fk_batches_created_by
    foreign key (created_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  constraint fk_batches_updated_by
    foreign key (updated_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- Unique Constraints
  constraint uq_batches_institute_code unique (institute_id, batch_code),

  -- CHECK Constraints
  constraint ck_batches_end_date_after_start check (end_date > start_date),
  constraint ck_batches_max_seats_positive check (max_seats is null or max_seats > 0),
  constraint ck_batches_name_length check (char_length(name) >= 3),
  constraint ck_batches_code_length check (char_length(batch_code) >= 2),
  constraint ck_batches_code_format check (batch_code ~ '^[A-Z0-9_-]+$'),
  constraint ck_batches_academic_year_format check (academic_year ~ '^\d{4}-\d{2}$')
);

-- 1f. Table: batch_students
-- Junction table implementing the M:M relationship between batches and students.
-- Composite PK prevents duplicate enrollment. Enrollment status tracked via VARCHAR + CHECK.
-- Enrollment record is permanent — never physically deleted.
create table public.batch_students (
  batch_id      uuid            not null,
  student_id    uuid            not null,
  enrolled_on   date            not null  default current_date,
  status        varchar(20)     not null  default 'active',
  created_at    timestamptz     not null  default now(),
  updated_at    timestamptz     null      default null,
  updated_by    uuid            null      default null,

  -- Primary Key (composite — also enforces uniqueness)
  constraint pk_batch_students primary key (batch_id, student_id),

  -- Foreign Keys
  constraint fk_batch_students_batch
    foreign key (batch_id) references public.batches (batch_id)
    on delete restrict
    on update restrict,

  constraint fk_batch_students_student
    foreign key (student_id) references public.student_details (student_id)
    on delete restrict
    on update restrict,

  constraint fk_batch_students_updated_by
    foreign key (updated_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- CHECK Constraints
  constraint ck_batch_students_status check (
    status in ('active', 'inactive', 'transferred', 'dropped')
  ),
  constraint ck_batch_students_enrolled_on check (enrolled_on <= current_date)
);

-- 1g. Table: batch_teachers
-- Junction table implementing the M:M relationship between batches and teachers.
-- A teacher can be assigned to multiple batches; a batch can have multiple teachers.
-- role_in_batch is advisory free text (not an enum).
create table public.batch_teachers (
  batch_id       uuid          not null,
  teacher_id     uuid          not null,
  role_in_batch  varchar(50)   null      default null,
  assigned_on    date          not null  default current_date,
  created_at     timestamptz   not null  default now(),
  created_by     uuid          null      default null,

  -- Primary Key (composite)
  constraint pk_batch_teachers primary key (batch_id, teacher_id),

  -- Foreign Keys
  constraint fk_batch_teachers_batch
    foreign key (batch_id) references public.batches (batch_id)
    on delete restrict
    on update restrict,

  constraint fk_batch_teachers_teacher
    foreign key (teacher_id) references public.teacher_details (teacher_id)
    on delete restrict
    on update restrict,

  constraint fk_batch_teachers_created_by
    foreign key (created_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- CHECK Constraints
  constraint ck_batch_teachers_assigned_on check (assigned_on <= current_date)
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Indexes
-- ════════════════════════════════════════════════════════════════════════════
-- All indexes are created after their respective tables exist.
-- No duplicate indexes on columns already covered by UNIQUE constraints.

-- 2a. streams indexes
create index if not exists idx_streams_institute_active
  on public.streams (institute_id, is_active);

create index if not exists idx_streams_institute_display_order
  on public.streams (institute_id, display_order);

create index if not exists idx_streams_created_by
  on public.streams (created_by);

create index if not exists idx_streams_updated_by
  on public.streams (updated_by);

-- Note: idx_streams_institute_code is covered by uq_streams_institute_code.

-- 2b. subjects indexes
create index if not exists idx_subjects_stream_order
  on public.subjects (stream_id, display_order);

create index if not exists idx_subjects_created_by
  on public.subjects (created_by);

create index if not exists idx_subjects_updated_by
  on public.subjects (updated_by);

-- Note: idx_subjects_stream_code is covered by uq_subjects_stream_code.

-- 2c. chapters indexes
create index if not exists idx_chapters_subject_order
  on public.chapters (subject_id, display_order);

create index if not exists idx_chapters_created_by
  on public.chapters (created_by);

create index if not exists idx_chapters_updated_by
  on public.chapters (updated_by);

-- Note: idx_chapters_subject_name is covered by uq_chapters_subject_name.

-- 2d. topics indexes
create index if not exists idx_topics_chapter_order
  on public.topics (chapter_id, display_order);

create index if not exists idx_topics_created_by
  on public.topics (created_by);

create index if not exists idx_topics_updated_by
  on public.topics (updated_by);

-- Note: idx_topics_chapter_name is covered by uq_topics_chapter_name.

-- 2e. batches indexes
create index if not exists idx_batches_institute_status
  on public.batches (institute_id, status);

create index if not exists idx_batches_institute_stream
  on public.batches (institute_id, stream_id);

create index if not exists idx_batches_institute_academic_year
  on public.batches (institute_id, academic_year);

-- Partial index: covers only non-deleted rows for active queries
create index if not exists idx_batches_deleted_at
  on public.batches (deleted_at)
  where deleted_at is null;

-- Note: uq_batches_institute_code covers (institute_id, batch_code) lookups.

-- 2f. batch_students indexes
create index if not exists idx_batch_students_student_id
  on public.batch_students (student_id);

create index if not exists idx_batch_students_batch_status
  on public.batch_students (batch_id, status);

create index if not exists idx_batch_students_batch_enrolled_on
  on public.batch_students (batch_id, enrolled_on);

create index if not exists idx_batch_students_updated_by
  on public.batch_students (updated_by);

-- Note: composite PK (batch_id, student_id) already covers "all students in batch X".

-- 2g. batch_teachers indexes
create index if not exists idx_batch_teachers_teacher_id
  on public.batch_teachers (teacher_id);

create index if not exists idx_batch_teachers_created_by
  on public.batch_teachers (created_by);

-- Note: composite PK (batch_id, teacher_id) already covers "all teachers in batch X".


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — CREATE TRIGGER Statements
-- ════════════════════════════════════════════════════════════════════════════
-- Only tables with an updated_at column receive the set_updated_at trigger.
-- set_updated_at() already exists from Domain 01 — do not recreate.

-- 3a. streams triggers
create trigger trg_streams_set_updated_at
  before update on public.streams
  for each row
  execute function public.set_updated_at();

-- 3b. subjects triggers
create trigger trg_subjects_set_updated_at
  before update on public.subjects
  for each row
  execute function public.set_updated_at();

-- 3c. chapters triggers
create trigger trg_chapters_set_updated_at
  before update on public.chapters
  for each row
  execute function public.set_updated_at();

-- 3d. topics triggers
create trigger trg_topics_set_updated_at
  before update on public.topics
  for each row
  execute function public.set_updated_at();

-- 3e. batches triggers
create trigger trg_batches_set_updated_at
  before update on public.batches
  for each row
  execute function public.set_updated_at();

-- 3f. batch_students triggers
-- Added because batch_students now has an updated_at column (audit requirement).
create trigger trg_batch_students_set_updated_at
  before update on public.batch_students
  for each row
  execute function public.set_updated_at();

-- Note: batch_teachers has no updated_at column — no trigger needed.

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — COMMENT Statements
-- ════════════════════════════════════════════════════════════════════════════

-- 4a. Table comments
comment on table public.streams is
  'A major examination or academic programme offered by an institute (e.g. NEET, JEE). '
  'Top node of the academic hierarchy. Soft-disabled via is_active = FALSE.';

comment on table public.subjects is
  'An academic discipline within a stream (e.g. Physics within NEET). '
  'Second level of the content hierarchy. Resolves institute_id via stream FK.';

comment on table public.chapters is
  'A named unit of the syllabus within a subject (e.g. Laws of Motion). '
  'Primary content-tagging unit — content, questions, and live classes reference chapters.';

comment on table public.topics is
  'Optional sub-chapter granularity for content tagging (e.g. Newton''s First Law under '
  'Laws of Motion). Fourth level of the academic hierarchy. Not all institutes use topics.';

comment on table public.batches is
  'Operational unit of student delivery within a stream. Students receive live classes, '
  'content, and mock tests through batch membership. Soft-delete via deleted_at.';

comment on table public.batch_students is
  'Junction table: M:M relationship between batches and students. Composite PK prevents '
  'duplicate enrollment. Enrollment history is permanent — never physically deleted.';

comment on table public.batch_teachers is
  'Junction table: M:M relationship between batches and teachers. A teacher can be '
  'assigned to multiple batches; a batch can have multiple teachers.';

-- 4b. Column comments
comment on column public.streams.code is
  'Short uppercase identifier (e.g. NEET, JEE-M). Unique per institute. Immutable once assigned.';

comment on column public.streams.display_order is
  'Controls dropdown/navigation order. Use increments of 10 for gap-friendly sequencing.';

comment on column public.streams.is_active is
  'Inactive streams are hidden from students/teachers. Historical data preserved.';

comment on column public.streams.description is
  'Optional longer description shown in the admin interface.';

comment on column public.streams.created_by is
  'Admin who created this stream. SET NULL on profile soft-delete preserves the record.';

comment on column public.streams.updated_by is
  'Admin who last modified this stream.';

comment on column public.subjects.code is
  'Short identifier (e.g. PHY, CHEM, BIO). Unique within a stream. Uppercase enforced.';

comment on column public.subjects.display_order is
  'Controls subject ordering within a stream. Lower number appears first.';

comment on column public.subjects.created_by is
  'Admin who created this subject. SET NULL on profile soft-delete preserves the record.';

comment on column public.subjects.updated_by is
  'Admin who last modified this subject.';

comment on column public.chapters.description is
  'Optional syllabus description or learning objectives for this chapter.';

comment on column public.chapters.display_order is
  'Controls chapter ordering within a subject. Follows standard syllabus sequence.';

comment on column public.chapters.created_by is
  'Admin who created this chapter. SET NULL on profile soft-delete preserves the record.';

comment on column public.chapters.updated_by is
  'Admin who last modified this chapter.';

comment on column public.topics.display_order is
  'Controls topic ordering within a chapter.';

comment on column public.topics.created_by is
  'Admin who created this topic. SET NULL on profile soft-delete preserves the record.';

comment on column public.topics.updated_by is
  'Admin who last modified this topic.';

comment on column public.batches.batch_code is
  'Short admin-facing code (e.g. NEET26-MOR-A). Unique per institute. Uppercase enforced.';

comment on column public.batches.academic_year is
  'Academic year in YYYY-YY format (e.g. 2025-26). Enables year-over-year reporting.';

comment on column public.batches.start_date is
  'First day of the batch session.';

comment on column public.batches.end_date is
  'Last day of the batch session. Must be strictly after start_date.';

comment on column public.batches.max_seats is
  'Maximum student capacity. NULL means unlimited. Application enforces this limit on enrollment.';

comment on column public.batches.status is
  'Batch lifecycle: upcoming → active → completed → archived. Auto-advanced by pg_cron.';

comment on column public.batches.deleted_at is
  'Soft delete timestamp. NULL = active. Non-null = soft-deleted. Never hard-delete batches.';

comment on column public.batches.created_by is
  'Admin who created this batch. SET NULL on profile soft-delete preserves the batch record.';

comment on column public.batches.updated_by is
  'Admin who last modified this batch.';

comment on column public.batch_students.status is
  'Enrollment status: active, inactive, transferred, dropped. VARCHAR + CHECK for evolutionary flexibility.';

comment on column public.batch_students.enrolled_on is
  'Date the student was enrolled in this batch.';

comment on column public.batch_students.updated_at is
  'UTC timestamp of last status change. Trigger-maintained.';

comment on column public.batch_students.updated_by is
  'Admin who last changed the enrollment status.';

comment on column public.batch_teachers.role_in_batch is
  'Advisory teaching role (e.g. lead_teacher, co_teacher, doubt_solver). Free text — not permission-enforced.';

comment on column public.batch_teachers.assigned_on is
  'Date the teacher was assigned to this batch.';

comment on column public.batch_teachers.created_by is
  'Admin who made the teacher assignment.';



-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — Domain 02 Academic Structure & Batch Management
-- ════════════════════════════════════════════════════════════════════════════
