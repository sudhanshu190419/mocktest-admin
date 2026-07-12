-- ============================================================================
-- Migration: Domain 05 — Assessment (Question Bank & Test Engine)
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Tables: questions · question_options · question_explanations · question_images ·
--         mock_tests · mock_test_questions · mock_attempts · mock_answers ·
--         mock_answer_options · mock_results
--
-- Depends on: Domain 01 (institutes, profiles, teacher_details, student_details)
--             Domain 02 (streams, subjects, chapters)
--             Existing enums (question_type, difficulty_level, attempt_status,
--               image_role, lifecycle_status, etc.)
--             Existing functions (set_updated_at, get_my_institute_id, etc.)
--
-- New Enums: question_status, mock_test_status
--
-- Order:
--   1. New enum types (idempotent DO blocks)
--   2. Tables (dependency order: parent → child → junction)
--   3. Indexes (after all tables exist)
--   4. Triggers (after all tables exist; set_updated_at already exists from Domain 1)
--   5. Comments
--
-- Partitioning note: mock_attempts and mock_answers are designed for monthly
--   RANGE partitioning by started_at at scale. For the initial migration they
--   are created as regular tables. Partitioning DDL should be added in a future
--   migration once volume justifies it.
--
-- Reference: Schema_Domain_05_Assessment.md v1.0 | ERD v3.0
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 0 — New Enum Types (Idempotent)
-- ════════════════════════════════════════════════════════════════════════════
-- These enums are specific to Domain 05 and are not defined in the global
-- Domain 01 migration. Each creation is wrapped in an idempotent DO block.

-- 0a. question_status: Lifecycle for questions in the question bank.
--     draft → pending_approval → published → archived
--     pending_approval → draft (admin rejects)
do $$
begin
  if not exists (select 1 from pg_type where typname = 'question_status') then
    create type question_status as enum ('draft', 'pending_approval', 'published', 'archived');
  end if;
end $$;

-- 0b. mock_test_status: Lifecycle for mock tests.
--     Same state machine as question_status.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'mock_test_status') then
    create type mock_test_status as enum ('draft', 'pending_approval', 'published', 'archived');
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — CREATE TABLE Statements
-- ════════════════════════════════════════════════════════════════════════════
-- Question Bank:     questions → question_options, question_explanations,
--                    question_images
-- Test Engine:       mock_tests → mock_test_questions (junction),
--                    mock_attempts → mock_answers → mock_answer_options,
--                    mock_results

-- 1a. Table: questions
-- The central content unit of the assessment system. A question row represents
-- a single assessable item: a stem, a type, a difficulty, a chapter/subject
-- mapping, and a lifecycle state. All other question-related tables are
-- children of this table.
-- Questions are versioned, stateful, and immutable once used in a submitted
-- attempt. The versioning model uses an integer version and parent_question_id
-- self-reference for lineage tracking.
create table public.questions (
  question_id           uuid              not null  default gen_random_uuid(),
  institute_id          uuid              not null,
  subject_id            uuid              not null,
  chapter_id            uuid              not null,
  created_by            uuid              not null,
  approved_by           uuid              null      default null,
  parent_question_id    uuid              null      default null,
  question_type         question_type     not null,
  difficulty            difficulty_level  not null,
  status                question_status   not null  default 'draft',
  version               integer           not null  default 1,
  question_text         text              not null,
  marks                 numeric(5,2)      not null  default 1,
  negative_marks        numeric(5,2)      not null  default 0,
  average_time_seconds  integer           null      default null,
  times_attempted       integer           not null  default 0,
  created_at            timestamptz       not null  default now(),
  updated_at            timestamptz       not null  default now(),
  approved_at           timestamptz       null      default null,

  -- Primary Key
  constraint pk_questions primary key (question_id),

  -- Foreign Keys
  constraint fk_questions_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_questions_subject
    foreign key (subject_id) references public.subjects (subject_id)
    on delete restrict
    on update restrict,

  constraint fk_questions_chapter
    foreign key (chapter_id) references public.chapters (chapter_id)
    on delete restrict
    on update restrict,

  constraint fk_questions_created_by
    foreign key (created_by) references public.teacher_details (teacher_id)
    on delete restrict
    on update restrict,

  constraint fk_questions_approved_by
    foreign key (approved_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  constraint fk_questions_parent
    foreign key (parent_question_id) references public.questions (question_id)
    on delete restrict
    on update restrict,

  -- CHECK Constraints
  constraint ck_questions_version check (version >= 1),
  constraint ck_questions_question_text_length check (char_length(question_text) >= 10),
  constraint ck_questions_marks check (marks > 0),
  constraint ck_questions_negative_marks check (negative_marks >= 0),
  constraint ck_questions_average_time check
    (average_time_seconds is null or average_time_seconds > 0),
  constraint ck_questions_times_attempted check (times_attempted >= 0),
  constraint ck_questions_approval_consistency check
    ((status = 'published' and approved_by is not null and approved_at is not null)
     or (status != 'published' and approved_by is null and approved_at is null)),
  constraint ck_questions_approved_at check
    (approved_at is null or approved_at >= created_at),
  constraint ck_questions_no_self_parent check
    (parent_question_id is null or parent_question_id != question_id)
);

-- 1b. Table: question_options
-- Answer choices for mcq, msq, and true_false questions. Each row is one
-- selectable option. For numerical questions this table has no rows — the
-- answer is stored in question_explanations.correct_numerical_answer.
-- Option rows are referenced directly by mock_answer_options during an attempt.
create table public.question_options (
  option_id       uuid          not null  default gen_random_uuid(),
  question_id     uuid          not null,
  institute_id    uuid          not null,
  option_text     text          not null,
  is_correct      boolean       not null  default false,
  order_sequence  integer       not null,
  created_at      timestamptz   not null  default now(),

  -- Primary Key
  constraint pk_question_options primary key (option_id),

  -- Foreign Keys
  constraint fk_question_options_question
    foreign key (question_id) references public.questions (question_id)
    on delete cascade
    on update restrict,

  constraint fk_question_options_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  -- Unique Constraints
  constraint uq_question_options_question_sequence unique (question_id, order_sequence),

  -- CHECK Constraints
  constraint ck_question_options_option_text_length check (char_length(option_text) >= 1),
  constraint ck_question_options_order_sequence check (order_sequence >= 1)
);

-- 1c. Table: question_explanations
-- Solution walkthrough for a question. 1:1 relationship enforced via UNIQUE
-- on question_id. Separate from questions to keep the stem table lean and to
-- allow the explanation to be fetched only after a submitted attempt.
-- For numerical questions, correct_numerical_answer and numerical_tolerance
-- store the accepted answer and margin of error.
create table public.question_explanations (
  explanation_id            uuid            not null  default gen_random_uuid(),
  question_id               uuid            not null,
  institute_id              uuid            not null,
  explanation_text          text            null      default null,
  explanation_video_url     text            null      default null,
  correct_numerical_answer  numeric(15,6)   null      default null,
  numerical_tolerance       numeric(10,6)   null      default null,
  created_at                timestamptz     not null  default now(),
  updated_at                timestamptz     not null  default now(),

  -- Primary Key
  constraint pk_question_explanations primary key (explanation_id),

  -- Foreign Keys
  constraint fk_question_explanations_question
    foreign key (question_id) references public.questions (question_id)
    on delete cascade
    on update restrict,

  constraint fk_question_explanations_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  -- Unique Constraints
  constraint uq_question_explanations_question_id unique (question_id),

  -- CHECK Constraints
  constraint ck_question_explanations_numerical_check check
    ((correct_numerical_answer is null) = (numerical_tolerance is null)
     or (correct_numerical_answer is not null and numerical_tolerance is null)),
  constraint ck_question_explanations_numerical_tolerance check
    (numerical_tolerance is null or numerical_tolerance >= 0)
);

-- 1d. Table: question_images
-- Images associated with a question — diagrams, figures, graphs, etc.
-- 1:M relationship allows multiple images per question. image_role
-- distinguishes where each image is used (stem, option, explanation).
-- Images are stored in Supabase Storage; this table stores only metadata
-- and the storage path.
create table public.question_images (
  image_id         uuid           not null  default gen_random_uuid(),
  question_id      uuid           not null,
  institute_id     uuid           not null,
  storage_bucket   varchar(100)   not null,
  storage_path     text           not null,
  image_role       image_role     not null,
  alt_text         text           null      default null,
  order_sequence   integer        not null  default 1,
  created_at       timestamptz    not null  default now(),

  -- Primary Key
  constraint pk_question_images primary key (image_id),

  -- Foreign Keys
  constraint fk_question_images_question
    foreign key (question_id) references public.questions (question_id)
    on delete cascade
    on update restrict,

  constraint fk_question_images_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  -- CHECK Constraints
  constraint ck_question_images_storage_bucket_length check (char_length(storage_bucket) >= 1),
  constraint ck_question_images_storage_path_length check (char_length(storage_path) >= 1),
  constraint ck_question_images_order_sequence check (order_sequence >= 1)
);

-- 1e. Table: mock_tests
-- Represents one configured test that students can attempt. A mock_test has a
-- title, time limit, scoring configuration, lifecycle state, and a set of
-- questions assembled via mock_test_questions. Once published, the test
-- configuration and question list are frozen.
create table public.mock_tests (
  test_id               uuid               not null  default gen_random_uuid(),
  institute_id          uuid               not null,
  teacher_id            uuid               not null,
  stream_id             uuid               not null,
  subject_id            uuid               null      default null,
  title                 varchar(500)       not null,
  description           text               null      default null,
  duration_min          integer            not null,
  total_marks           integer            not null,
  passing_marks         integer            null      default null,
  negative_marking      numeric(5,2)       not null  default 0,
  attempt_limit         integer            null      default null,
  shuffle_questions     boolean            not null  default false,
  shuffle_options       boolean            not null  default false,
  calculator_allowed    boolean            not null  default false,
  status                mock_test_status   not null  default 'draft',
  test_type             varchar(50)        not null  default 'practice',
  result_release_mode   varchar(20)        not null  default 'immediate',
  result_release_at     timestamptz        null      default null,
  available_from        timestamptz        null      default null,
  available_until       timestamptz        null      default null,
  created_at            timestamptz        not null  default now(),
  updated_at            timestamptz        not null  default now(),
  published_at          timestamptz        null      default null,

  -- Primary Key
  constraint pk_mock_tests primary key (test_id),

  -- Foreign Keys
  constraint fk_mock_tests_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_mock_tests_teacher
    foreign key (teacher_id) references public.teacher_details (teacher_id)
    on delete restrict
    on update restrict,

  constraint fk_mock_tests_stream
    foreign key (stream_id) references public.streams (stream_id)
    on delete restrict
    on update restrict,

  constraint fk_mock_tests_subject
    foreign key (subject_id) references public.subjects (subject_id)
    on delete restrict
    on update restrict,

  -- CHECK Constraints
  constraint ck_mock_tests_title_length check (char_length(title) >= 3),
  constraint ck_mock_tests_duration_min check
    (duration_min > 0 and duration_min <= 600),
  constraint ck_mock_tests_total_marks check (total_marks > 0),
  constraint ck_mock_tests_passing_marks check
    (passing_marks is null or (passing_marks >= 0 and passing_marks <= total_marks)),
  constraint ck_mock_tests_negative_marking check (negative_marking >= 0),
  constraint ck_mock_tests_attempt_limit check
    (attempt_limit is null or attempt_limit >= 1),
  constraint ck_mock_tests_available_window check
    (available_until is null or available_from is null or available_until > available_from),
  constraint ck_mock_tests_result_release check
    (result_release_at is null or result_release_mode = 'scheduled'),
  constraint ck_mock_tests_published_at check
    ((status = 'published' and published_at is not null)
     or (status != 'published' and published_at is null))
);

-- 1f. Table: mock_test_questions
-- Junction table linking mock_tests to questions. Each row carries the
-- per-test scoring configuration and the frozen JSONB question_snapshot
-- at publish time — the immutability mechanism for the test engine.
create table public.mock_test_questions (
  test_id                  uuid            not null,
  question_id              uuid            not null,
  order_sequence           integer         not null,
  marks                    numeric(5,2)    not null,
  negative_marks_override  numeric(5,2)    null      default null,
  section_name             varchar(100)    null      default null,
  question_snapshot        jsonb           null      default null,
  added_at                 timestamptz     not null  default now(),

  -- Primary Key (composite)
  constraint pk_mock_test_questions primary key (test_id, question_id),

  -- Foreign Keys
  constraint fk_mock_test_questions_test
    foreign key (test_id) references public.mock_tests (test_id)
    on delete cascade
    on update restrict,

  constraint fk_mock_test_questions_question
    foreign key (question_id) references public.questions (question_id)
    on delete restrict
    on update restrict,

  -- CHECK Constraints
  constraint ck_mock_test_questions_order_sequence check (order_sequence >= 1),
  constraint ck_mock_test_questions_marks check (marks > 0),
  constraint ck_mock_test_questions_negative_marks_override check
    (negative_marks_override is null or negative_marks_override >= 0)
);

-- 1g. Table: mock_attempts
-- Represents one student's single attempt at a mock test. Each attempt has its
-- own timer, answer set, and result. This is the highest-write table in the
-- domain — partition planning by started_at is required at scale.
create table public.mock_attempts (
  attempt_id            uuid             not null  default gen_random_uuid(),
  test_id               uuid             not null,
  student_id            uuid             not null,
  institute_id          uuid             not null,
  attempt_number        integer          not null,
  status                attempt_status   not null  default 'in_progress',
  started_at            timestamptz      not null  default now(),
  submitted_at          timestamptz      null      default null,
  time_remaining_seconds integer         null      default null,
  ip_address            inet             null      default null,
  device_fingerprint    text             null      default null,
  created_at            timestamptz      not null  default now(),
  updated_at            timestamptz      not null  default now(),

  -- Primary Key
  constraint pk_mock_attempts primary key (attempt_id),

  -- Foreign Keys
  constraint fk_mock_attempts_test
    foreign key (test_id) references public.mock_tests (test_id)
    on delete restrict
    on update restrict,

  constraint fk_mock_attempts_student
    foreign key (student_id) references public.student_details (student_id)
    on delete restrict
    on update restrict,

  constraint fk_mock_attempts_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  -- Unique Constraints
  constraint uq_mock_attempts_test_student_number unique (test_id, student_id, attempt_number),

  -- CHECK Constraints
  constraint ck_mock_attempts_attempt_number check (attempt_number >= 1),
  constraint ck_mock_attempts_time_remaining check
    (time_remaining_seconds is null or time_remaining_seconds >= 0),
  constraint ck_mock_attempts_submitted_at check
    (submitted_at is null or submitted_at >= started_at),
  constraint ck_mock_attempts_status_submitted check
    ((status in ('submitted', 'timed_out') and submitted_at is not null)
     or (status in ('in_progress', 'abandoned') and submitted_at is null))
);

-- 1h. Table: mock_answers
-- One answer record per question per attempt. Every question in the test gets
-- a mock_answer row when the attempt is created (pre-populated with
-- is_answered = FALSE). This is the highest-write table — every option
-- selection and auto-save hits this table.
create table public.mock_answers (
  answer_id              uuid            not null  default gen_random_uuid(),
  attempt_id             uuid            not null,
  question_id            uuid            not null,
  institute_id           uuid            not null,
  is_answered            boolean         not null  default false,
  is_marked_for_review   boolean         not null  default false,
  numerical_answer       numeric(15,6)   null      default null,
  is_correct             boolean         null      default null,
  marks_awarded          numeric(7,2)    null      default null,
  time_spent_seconds     integer         not null  default 0,
  answered_at            timestamptz     null      default null,
  created_at             timestamptz     not null  default now(),
  updated_at             timestamptz     not null  default now(),

  -- Primary Key
  constraint pk_mock_answers primary key (answer_id),

  -- Foreign Keys
  constraint fk_mock_answers_attempt
    foreign key (attempt_id) references public.mock_attempts (attempt_id)
    on delete cascade
    on update restrict,

  constraint fk_mock_answers_question
    foreign key (question_id) references public.questions (question_id)
    on delete restrict
    on update restrict,

  constraint fk_mock_answers_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  -- Unique Constraints
  constraint uq_mock_answers_attempt_question unique (attempt_id, question_id),

  -- CHECK Constraints
  constraint ck_mock_answers_time_spent check (time_spent_seconds >= 0),
  constraint ck_mock_answers_marks_awarded check
    (marks_awarded is null or (is_correct is not null)),
  constraint ck_mock_answers_answered_at check
    (answered_at is null or is_answered = true)
);

-- 1i. Table: mock_answer_options
-- Junction table linking mock_answers to question_options. Each row records
-- that a student selected a specific option. For MCQ, exactly one row per
-- answered mock_answer. For MSQ, one row per selected option.
-- Replaces the selected_option_ids TEXT field from ERD v2.
create table public.mock_answer_options (
  answer_option_id  uuid          not null  default gen_random_uuid(),
  answer_id         uuid          not null,
  option_id         uuid          not null,
  selected_at       timestamptz   not null  default now(),

  -- Primary Key
  constraint pk_mock_answer_options primary key (answer_option_id),

  -- Foreign Keys
  constraint fk_mock_answer_options_answer
    foreign key (answer_id) references public.mock_answers (answer_id)
    on delete cascade
    on update restrict,

  constraint fk_mock_answer_options_option
    foreign key (option_id) references public.question_options (option_id)
    on delete restrict
    on update restrict,

  -- Unique Constraints
  constraint uq_mock_answer_options_answer_option unique (answer_id, option_id)
);

-- 1j. Table: mock_results
-- The computed result record for one submitted attempt. One row per attempt,
-- created by the result-generation job after submission. Stores aggregate
-- scores, rankings, time analytics, and subject/chapter breakdowns in
-- denormalized form for fast dashboard rendering.
create table public.mock_results (
  result_id            uuid            not null  default gen_random_uuid(),
  attempt_id           uuid            not null,
  test_id              uuid            not null,
  student_id           uuid            not null,
  institute_id         uuid            not null,
  total_score          numeric(8,2)    not null,
  max_score            numeric(8,2)    not null,
  percentage           numeric(5,2)    not null,
  rank                 integer         null      default null,
  percentile           numeric(5,2)    null      default null,
  correct_count        integer         not null,
  wrong_count          integer         not null,
  skipped_count        integer         not null,
  total_time_seconds   integer         not null,
  avg_time_per_question numeric(8,2)   not null,
  subject_breakdown    jsonb           null      default null,
  chapter_breakdown    jsonb           null      default null,
  is_released          boolean         not null  default false,
  generated_at         timestamptz     not null  default now(),
  released_at          timestamptz     null      default null,

  -- Primary Key
  constraint pk_mock_results primary key (result_id),

  -- Foreign Keys
  constraint fk_mock_results_attempt
    foreign key (attempt_id) references public.mock_attempts (attempt_id)
    on delete restrict
    on update restrict,

  constraint fk_mock_results_test
    foreign key (test_id) references public.mock_tests (test_id)
    on delete restrict
    on update restrict,

  constraint fk_mock_results_student
    foreign key (student_id) references public.student_details (student_id)
    on delete restrict
    on update restrict,

  constraint fk_mock_results_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  -- Unique Constraints
  constraint uq_mock_results_attempt_id unique (attempt_id),

  -- CHECK Constraints
  constraint ck_mock_results_total_score check (total_score <= max_score),
  constraint ck_mock_results_percentage check (percentage >= 0 and percentage <= 100),
  constraint ck_mock_results_correct_count check (correct_count >= 0),
  constraint ck_mock_results_wrong_count check (wrong_count >= 0),
  constraint ck_mock_results_skipped_count check (skipped_count >= 0),
  constraint ck_mock_results_rank check (rank is null or rank >= 1),
  constraint ck_mock_results_percentile check
    (percentile is null or (percentile >= 0 and percentile <= 100)),
  constraint ck_mock_results_total_time check (total_time_seconds >= 0),
  constraint ck_mock_results_released_at check
    (released_at is null or released_at >= generated_at),
  constraint ck_mock_results_is_released check
    ((is_released = true and released_at is not null)
     or (is_released = false and released_at is null))
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Indexes
-- ════════════════════════════════════════════════════════════════════════════
-- All indexes are created after their respective tables exist.
-- No duplicate indexes on columns already covered by UNIQUE constraints.
-- Partial indexes are used where specified in the schema.

-- 2a. questions indexes
create index if not exists idx_questions_institute_status
  on public.questions (institute_id, status);

create index if not exists idx_questions_chapter_status
  on public.questions (chapter_id, status);

create index if not exists idx_questions_subject_status
  on public.questions (subject_id, status);

create index if not exists idx_questions_created_by
  on public.questions (created_by);

create index if not exists idx_questions_difficulty_status
  on public.questions (difficulty, status);

create index if not exists idx_questions_type_status
  on public.questions (question_type, status);

-- Partial index: only rows with a parent reference (version history traversal)
create index if not exists idx_questions_parent
  on public.questions (parent_question_id)
  where parent_question_id is not null;

-- 2b. question_options indexes
create index if not exists idx_question_options_question_id
  on public.question_options (question_id);

-- Partial index: answer key lookup for scoring — find correct options quickly
create index if not exists idx_question_options_question_correct
  on public.question_options (question_id, is_correct)
  where is_correct = true;

-- Note: idx_question_options_question_sequence is covered by
--   uq_question_options_question_sequence (unique constraint).

-- 2c. question_explanations indexes
-- Note: idx_question_explanations_question_id is covered by
--   uq_question_explanations_question_id (unique constraint).

-- 2d. question_images indexes
create index if not exists idx_question_images_question_id
  on public.question_images (question_id);

create index if not exists idx_question_images_question_role
  on public.question_images (question_id, image_role);

-- 2e. mock_tests indexes
create index if not exists idx_mock_tests_institute_status
  on public.mock_tests (institute_id, status);

create index if not exists idx_mock_tests_stream_status
  on public.mock_tests (stream_id, status);

create index if not exists idx_mock_tests_teacher_status
  on public.mock_tests (teacher_id, status);

-- Partial index: find tests with open attempt windows
create index if not exists idx_mock_tests_available_window
  on public.mock_tests (available_from, available_until)
  where status = 'published';

-- Partial index: scheduler — find tests whose result release time has passed
create index if not exists idx_mock_tests_result_release
  on public.mock_tests (result_release_at)
  where result_release_mode = 'scheduled';

-- 2f. mock_test_questions indexes
create index if not exists idx_mock_test_questions_test_order
  on public.mock_test_questions (test_id, order_sequence);

create index if not exists idx_mock_test_questions_question_id
  on public.mock_test_questions (question_id);

-- Partial index: section-filtered question fetch for multi-section tests
create index if not exists idx_mock_test_questions_section
  on public.mock_test_questions (test_id, section_name)
  where section_name is not null;

-- 2g. mock_attempts indexes
create index if not exists idx_mock_attempts_test_id
  on public.mock_attempts (test_id, started_at desc);

create index if not exists idx_mock_attempts_student_id
  on public.mock_attempts (student_id, started_at desc);

create index if not exists idx_mock_attempts_student_test
  on public.mock_attempts (student_id, test_id);

-- Partial index: background job — find in-progress attempts for auto-timeout
create index if not exists idx_mock_attempts_status_inprogress
  on public.mock_attempts (status, started_at)
  where status = 'in_progress';

-- 2h. mock_answers indexes
create index if not exists idx_mock_answers_attempt_id
  on public.mock_answers (attempt_id);

-- Note: idx_mock_answers_attempt_question is covered by
--   uq_mock_answers_attempt_question (unique constraint).

create index if not exists idx_mock_answers_question_id
  on public.mock_answers (question_id);

-- Partial index: result-generation job — find unscored answers
create index if not exists idx_mock_answers_unscored
  on public.mock_answers (attempt_id)
  where is_correct is null;

-- 2i. mock_answer_options indexes
create index if not exists idx_mock_answer_options_answer_id
  on public.mock_answer_options (answer_id);

create index if not exists idx_mock_answer_options_option_id
  on public.mock_answer_options (option_id);

-- Note: idx_mock_answer_options_answer_option is covered by
--   uq_mock_answer_options_answer_option (unique constraint).

-- 2j. mock_results indexes
-- Note: idx_mock_results_attempt_id is covered by uq_mock_results_attempt_id.

create index if not exists idx_mock_results_test_id_score
  on public.mock_results (test_id, total_score desc);

create index if not exists idx_mock_results_student_id
  on public.mock_results (student_id, generated_at desc);

create index if not exists idx_mock_results_test_released
  on public.mock_results (test_id, is_released);

-- Partial index: percentile distribution queries for analytics
create index if not exists idx_mock_results_percentile
  on public.mock_results (test_id, percentile desc)
  where percentile is not null;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — CREATE TRIGGER Statements
-- ════════════════════════════════════════════════════════════════════════════
-- Only tables with an updated_at column receive the set_updated_at trigger.
-- set_updated_at() already exists from Domain 01 — do not recreate.
-- question_options has no updated_at column (immutable after insert).
-- question_images has no updated_at column (immutable after insert).
-- mock_test_questions has no updated_at column (immutable after publish).
-- mock_answer_options has no updated_at column (append-only event log).

-- 3a. questions triggers
create trigger trg_questions_set_updated_at
  before update on public.questions
  for each row
  execute function public.set_updated_at();

-- 3b. question_explanations triggers
create trigger trg_question_explanations_set_updated_at
  before update on public.question_explanations
  for each row
  execute function public.set_updated_at();

-- 3c. mock_tests triggers
create trigger trg_mock_tests_set_updated_at
  before update on public.mock_tests
  for each row
  execute function public.set_updated_at();

-- 3d. mock_attempts triggers
create trigger trg_mock_attempts_set_updated_at
  before update on public.mock_attempts
  for each row
  execute function public.set_updated_at();

-- 3e. mock_answers triggers
create trigger trg_mock_answers_set_updated_at
  before update on public.mock_answers
  for each row
  execute function public.set_updated_at();

-- Note: mock_results uses generated_at / released_at instead of updated_at —
--   no set_updated_at trigger needed.

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — COMMENT Statements

-- 4za. Cross-table validation note
-- The schema doc specifies a CHECK constraint on mock_results:
--   correct_count + wrong_count + skipped_count = (
--     SELECT COUNT(*) FROM mock_test_questions WHERE test_id = mock_results.test_id
--   )
-- This is intentionally NOT implemented as a DB CHECK because cross-table
-- CHECK constraints are expensive (re-evaluated on every row modification)
-- and can cause locking issues at scale. Validation of the counts consistency
-- must be enforced at the application layer (in the result-generation Edge
-- Function) instead.

-- Similarly, the percentage column check (percentage >= 0) means the
-- application must compute percentage = GREATEST(0, total_score / max_score
-- * 100) before insert, since total_score can be negative due to negative
-- marking.

-- ════════════════════════════════════════════════════════════════════════════

-- 4a. Table comments
comment on table public.questions is
  'Central content unit of the assessment system. Each row is a single '
  'assessable item with a stem, type, difficulty, chapter/subject mapping, '
  'and a lifecycle state. Versioned via integer version + parent_question_id '
  'self-reference. Immutable once used in a submitted attempt (times_attempted > 0).';

comment on table public.question_options is
  'Answer choices for mcq, msq, and true_false questions. One row per '
  'selectable option. For numerical questions this table has no rows — the '
  'answer is in question_explanations.correct_numerical_answer. Referenced '
  'directly by mock_answer_options during an attempt.';

comment on table public.question_explanations is
  'Solution walkthrough for a question. 1:1 relationship enforced via UNIQUE '
  'on question_id. Kept separate from questions so explanations are only '
  'fetched after a submitted attempt (never during an active attempt). '
  'correct_numerical_answer and numerical_tolerance are for numerical type questions.';

comment on table public.question_images is
  'Images associated with a question — diagrams, figures, graphs, etc. '
  '1:M relationship allows multiple images per question. image_role '
  'distinguishes whether the image belongs to the stem, an option, or the '
  'explanation. Physical files stored in Supabase Storage; this table '
  'holds only metadata and the storage path.';

comment on table public.mock_tests is
  'A configured test that students can attempt. Has a title, time limit, '
  'scoring configuration, lifecycle state, and a set of questions assembled '
  'via mock_test_questions. Once published, the test configuration and '
  'question list are frozen. Lifecycle: draft → pending_approval → '
  'published → archived.';

comment on table public.mock_test_questions is
  'Junction table linking mock_tests to questions. Each row carries per-test '
  'scoring configuration and the frozen JSONB question_snapshot at publish '
  'time — the immutability mechanism for the test engine. question_snapshot '
  'ensures live question edits do not affect existing tests.';

comment on table public.mock_attempts is
  'One student''s single attempt at a mock test. Each attempt has its own '
  'timer, answer set, and result. The highest-write table in the domain — '
  'partition by started_at (monthly RANGE) is required at scale.';

comment on table public.mock_answers is
  'One answer record per question per attempt. Pre-populated at attempt '
  'creation with is_answered = FALSE. Updated on every option selection '
  'and auto-save. is_correct and marks_awarded are set by the result-'
  'generation job after submission.';

comment on table public.mock_answer_options is
  'Junction table linking mock_answers to question_options. Each row records '
  'that a student selected a specific option. For MCQ: exactly one row per '
  'answered mock_answer. For MSQ: one row per selected option. Replaces '
  'selected_option_ids TEXT from ERD v2 — enables proper referential integrity '
  'and SQL-queryable scoring.';

comment on table public.mock_results is
  'Computed result record for one submitted attempt. One row per attempt '
  '(1:1 with mock_attempts). Stores aggregate scores, rankings, time analytics, '
  'and subject/chapter breakdowns in denormalized form for fast dashboard '
  'rendering. This is a read-optimised materialised summary.';

-- 4b. Column comments
comment on column public.questions.question_type is
  'PostgreSQL enum: mcq (single correct), msq (multiple correct), numerical, '
  'true_false. Determines how options are rendered and answers are scored.';

comment on column public.questions.difficulty is
  'PostgreSQL enum: easy, medium, hard. Used for test composition analytics '
  'and adaptive filtering.';

comment on column public.questions.status is
  'PostgreSQL enum: draft, pending_approval, published, archived. Only '
  'published questions may be added to a mock_test.';

comment on column public.questions.version is
  'Monotonically increasing integer starting at 1. Incremented on each '
  'substantive edit. Editing a published question creates a new row with '
  'version = old + 1.';

comment on column public.questions.parent_question_id is
  'Self-referencing FK to the previous version. NULL for original questions. '
  'Allows full lineage chain traversal via recursive CTE.';

comment on column public.questions.question_text is
  'The question stem in plain text or Markdown. LaTeX math expressions '
  'supported via client-side renderer (e.g. KaTeX). Min length 10 characters.';

comment on column public.questions.marks is
  'Default marks for this question when added to a test. May be overridden '
  'per-test in mock_test_questions.marks.';

comment on column public.questions.negative_marks is
  'Default negative marks deducted for a wrong answer. May be overridden '
  'in mock_test_questions. 0 means no negative marking.';

comment on column public.questions.average_time_seconds is
  'Computed from mock_answers.time_spent_seconds across all attempts. '
  'Updated by nightly analytics job. NULL until sufficient data exists.';

comment on column public.questions.times_attempted is
  'Denormalized count of how many times this question has been answered in '
  'a submitted attempt. Updated by the result-generation job.';

comment on column public.questions.approved_by is
  'Admin who approved this question. NULL until status = published.';

comment on column public.questions.approved_at is
  'UTC timestamp when the question was approved. NULL unless status = published.';

comment on column public.question_options.is_correct is
  'TRUE if this option is a correct answer. For mcq, exactly one option per '
  'question should be TRUE. For msq, one or more may be TRUE. For true_false, '
  'exactly one of the two options is TRUE. Count enforcement is at application layer.';

comment on column public.question_options.order_sequence is
  'Display order within the question. 1-indexed. When shuffle_options = TRUE, '
  'the test engine randomizes order at render time.';

comment on column public.question_explanations.explanation_text is
  'Step-by-step solution in plain text or Markdown with LaTeX support. '
  'NULL if not yet written. Required before a question can be published.';

comment on column public.question_explanations.explanation_video_url is
  'Optional URL to a video solution walkthrough. May be a Supabase Storage '
  'signed URL or external video link.';

comment on column public.question_explanations.correct_numerical_answer is
  'The correct answer value for numerical type questions. NULL for mcq, msq, '
  'true_false.';

comment on column public.question_explanations.numerical_tolerance is
  'Acceptable margin of error for numerical questions. NULL means exact match '
  'required. NULL for non-numerical questions.';

comment on column public.question_images.storage_bucket is
  'Supabase Storage bucket name. Consistent with Domain 3 and Domain 4 '
  'storage model.';

comment on column public.question_images.image_role is
  'Describes where this image is used: stem (embedded in question text), '
  'option (embedded in a specific option), explanation (used in solution '
  'walkthrough).';

comment on column public.question_images.alt_text is
  'Accessibility description of the image. Required for WCAG 2.1 Level AA '
  'compliance. Should be populated before publication.';

comment on column public.mock_tests.title is
  'Display title shown to students. Examples: "NEET 2025 Full Syllabus Mock #3", '
  '"Physics — Thermodynamics Chapter Test".';

comment on column public.mock_tests.duration_min is
  'Total test duration in minutes. The attempt timer counts down from this '
  'value. Range: 1–600.';

comment on column public.mock_tests.total_marks is
  'Sum of all question marks. Computed and frozen at publish time. Stored '
  'here for fast display without aggregating mock_test_questions.';

comment on column public.mock_tests.passing_marks is
  'Minimum score to be marked as "passed". NULL if no pass/fail threshold applies.';

comment on column public.mock_tests.negative_marking is
  'Default negative marks per wrong answer for this test. Applied to questions '
  'without a per-question override in mock_test_questions.negative_marks_override.';

comment on column public.mock_tests.attempt_limit is
  'Maximum number of times a student may attempt this test. NULL means unlimited.';

comment on column public.mock_tests.shuffle_questions is
  'When TRUE, questions are presented in randomized order per attempt. '
  'Seeded by attempt_id for consistency on resume.';

comment on column public.mock_tests.shuffle_options is
  'When TRUE, MCQ/MSQ options are randomized per attempt. Seeded by '
  'attempt_id + question_id.';

comment on column public.mock_tests.calculator_allowed is
  'When TRUE, the test UI shows an on-screen scientific calculator.';

comment on column public.mock_tests.test_type is
  'Categorizes the test: practice (no ranking, instant result), mock (ranked), '
  'chapter_test, pyq_paper. Not an enum — types may expand.';

comment on column public.mock_tests.result_release_mode is
  'Controls when the result is shown: immediate (on submission), scheduled '
  '(at result_release_at), manual (admin releases). Not an enum.';

comment on column public.mock_tests.available_from is
  'UTC timestamp from which students can start the test. NULL means immediately '
  'available upon publication.';

comment on column public.mock_tests.available_until is
  'UTC timestamp after which new attempts are blocked. NULL means no expiry.';

comment on column public.mock_tests.published_at is
  'UTC timestamp when the test was published. NULL until published.';

comment on column public.mock_test_questions.order_sequence is
  'Display order within the test. 1-indexed. Canonical order when '
  'shuffle_questions = FALSE. Global (not per-section).';

comment on column public.mock_test_questions.marks is
  'Marks awarded for a correct answer in this test. May differ from '
  'questions.marks (the default).';

comment on column public.mock_test_questions.negative_marks_override is
  'Per-question negative marks override. NULL = use test-level '
  'mock_tests.negative_marking.';

comment on column public.mock_test_questions.section_name is
  'Optional section grouping (e.g. Physics, Chemistry, Biology). NULL for '
  'single-section tests.';

comment on column public.mock_test_questions.question_snapshot is
  'Frozen copy of the question at publish time. Populated by the publish '
  'Edge Function. NULL for draft tests. Note: add snapshot_version integer '
  'inside this JSON from day one to allow future schema evolution.';

comment on column public.mock_attempts.attempt_number is
  '1-indexed attempt counter per student per test. 1 for first attempt, '
  '2 for second, etc. Computed at insert time.';

comment on column public.mock_attempts.status is
  'PostgreSQL enum: in_progress, submitted, timed_out, abandoned. '
  'Background job auto-transitions in_progress → timed_out on timer expiry.';

comment on column public.mock_attempts.time_remaining_seconds is
  'Seconds remaining on the timer at the last sync. Updated by client '
  'heartbeat. Used to resume timer correctly if browser crashes.';

comment on column public.mock_attempts.ip_address is
  'Client IP address at attempt start. Used for exam integrity monitoring. '
  'Treat as PII — comply with data minimisation requirements.';

comment on column public.mock_attempts.device_fingerprint is
  'Hashed device fingerprint at attempt start. Used for exam integrity '
  'monitoring. Hashed at Edge Function layer — never store raw fingerprint data.';

comment on column public.mock_answers.is_answered is
  'TRUE once the student has selected at least one option or entered a '
  'numerical value. FALSE for skipped/unattempted questions.';

comment on column public.mock_answers.is_marked_for_review is
  'TRUE if the student flagged this question for review before submitting. '
  'Does not affect scoring. Used by the test navigation panel.';

comment on column public.mock_answers.numerical_answer is
  'Student''s entered value for numerical type questions. NULL for mcq, msq, '
  'true_false (those use mock_answer_options).';

comment on column public.mock_answers.is_correct is
  'NULL until scored. TRUE if all correct options selected and no incorrect '
  'options. For numerical: TRUE if within tolerance.';

comment on column public.mock_answers.marks_awarded is
  'NULL until scored. Positive for correct, negative for wrong (negative '
  'marking), 0 for skipped. Set by result-generation job.';

comment on column public.mock_answers.time_spent_seconds is
  'Cumulative seconds the student spent with this question visible. Updated '
  'on each auto-save.';

comment on column public.mock_answer_options.selected_at is
  'UTC timestamp when this option was selected. For MSQ, rows accumulate '
  'over time as the student selects/deselects options.';

comment on column public.mock_results.total_score is
  'Aggregate of all mock_answers.marks_awarded for this attempt. Can be '
  'negative if negative marking is severe.';

comment on column public.mock_results.max_score is
  'Copied from mock_tests.total_marks at result generation time. Makes the '
  'result self-contained even if the test is later edited.';

comment on column public.mock_results.percentage is
  '(total_score / max_score) * 100. Computed and stored. Capped at 0 in '
  'display if negative.';

comment on column public.mock_results.rank is
  'Student''s rank among all submitted attempts for this test. NULL until '
  'rankings are computed.';

comment on column public.mock_results.percentile is
  'Percentage of students the student scored higher than. NULL until rankings '
  'computed. Formula: (students_below / total_students) * 100.';

comment on column public.mock_results.correct_count is
  'Count of mock_answers where is_correct = TRUE.';

comment on column public.mock_results.wrong_count is
  'Count of mock_answers where is_correct = FALSE AND is_answered = TRUE.';

comment on column public.mock_results.skipped_count is
  'Count of mock_answers where is_answered = FALSE.';

comment on column public.mock_results.subject_breakdown is
  'Per-subject score breakdown JSON. Structure: [{ subject_id, subject_name, '
  'correct, wrong, skipped, score, max_score }]. NULL for single-subject tests.';

comment on column public.mock_results.chapter_breakdown is
  'Per-chapter score breakdown JSON. Same structure as subject_breakdown but '
  'keyed by chapter_id. Used to identify weak chapters for PerformanceReport.';

comment on column public.mock_results.is_released is
  'FALSE until results are visible to the student. For immediate release, set '
  'to TRUE at generation time. For scheduled/manual, set by release job.';

comment on column public.mock_results.generated_at is
  'UTC timestamp when the result was computed.';

comment on column public.mock_results.released_at is
  'UTC timestamp when the result was made visible to the student. NULL until released.';

-- 4c. Constraint comments
comment on constraint ck_questions_approval_consistency on public.questions is
  'approved_by and approved_at must be set together when and only when '
  'status = published. Prevents half-written approval states.';

comment on constraint ck_questions_no_self_parent on public.questions is
  'Prevents a question from being its own parent. Longer cycles (A→B→A) must '
  'be detected at the application layer.';

comment on constraint uq_question_options_question_sequence on public.question_options is
  'Prevents duplicate sequence numbers within a question. Enforces clean ordering.';

comment on constraint uq_question_explanations_question_id on public.question_explanations is
  'Enforces the 1:1 relationship — only one explanation may exist per question.';

comment on constraint ck_question_explanations_numerical_check on public.question_explanations is
  'correct_numerical_answer may exist without numerical_tolerance (exact match), '
  'but numerical_tolerance must not exist without correct_numerical_answer.';

comment on constraint ck_mock_tests_published_at on public.mock_tests is
  'published_at must be set when and only when status = published. Prevents '
  'half-written publish states.';

comment on constraint ck_mock_attempts_status_submitted on public.mock_attempts is
  'submitted_at must be set when and only when status is submitted or timed_out. '
  'Prevents half-written terminal states.';

comment on constraint ck_mock_answers_marks_awarded on public.mock_answers is
  'marks_awarded can only be set when is_correct has been determined (non-NULL). '
  'Prevents marks from being assigned without a correctness verdict.';

comment on constraint uq_mock_answers_attempt_question on public.mock_answers is
  'One answer row per question per attempt. Pre-population at attempt creation '
  'ensures this holds from the start.';

comment on constraint uq_mock_answer_options_answer_option on public.mock_answer_options is
  'A student cannot select the same option twice within one answer. On '
  'deselect + reselect, the old row is deleted and a new one inserted.';

comment on constraint uq_mock_results_attempt_id on public.mock_results is
  'Enforces the 1:1 relationship — only one result per attempt.';

comment on constraint ck_mock_results_is_released on public.mock_results is
  'is_released and released_at must always be consistent: TRUE requires a '
  'timestamp, FALSE requires NULL. Prevents half-written release states.';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — Domain 05 Assessment (Question Bank & Test Engine)
-- ════════════════════════════════════════════════════════════════════════════
