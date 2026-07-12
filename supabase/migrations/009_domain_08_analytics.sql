-- ============================================================================
-- Migration: Domain 08 — Analytics
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Tables: performance_reports · subject_performances · chapter_performances ·
--         progress_history · teacher_analytics
--
-- Depends on: Domain 01 (institutes, profiles, student_details, teacher_details)
--             Domain 02 (subjects, chapters)
--             Existing functions (set_updated_at, get_my_institute_id, etc.)
--
-- New Enums: report_period_type
--
-- Order:
--   1. New enum types (idempotent DO blocks)
--   2. Tables (dependency order: parent → child)
--   3. Indexes (after all tables exist; GIN indexes on UUID arrays)
--   4. Triggers (after all tables exist; set_updated_at already exists from Domain 1)
--   5. Comments
--
-- Key architecture:
--   • Read-optimised reporting layer, not live transactional system.
--   • All tables are either computed on a schedule (nightly background jobs)
--     or are append-only event logs (progress_history).
--   • performance_reports uses UPSERT on (student_id, period_type).
--   • progress_history is immutable after INSERT — no row is ever updated or deleted.
--   • teacher_analytics is 1:1 with teacher_details, overwritten nightly.
--   • subject_performances and chapter_performances cascade-delete with parent report.
--   • Arrays (weak_chapters, strong_chapters, suggested_tests) use GIN indexes.
--   • institute_id is denormalized on all tables for RLS performance.
--
-- Reference: Schema_Domain_08_Analytics.md v1.0 | ERD v2.0
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 0 — New Enum Types (Idempotent)
-- ════════════════════════════════════════════════════════════════════════════
-- This domain introduces one new PostgreSQL enum: report_period_type.
-- All other enums referenced are defined globally in Domain 01.

-- 0a. report_period_type: Defines the time window over which a performance report
--     was computed. Allows the system to generate and store multiple report windows
--     per student simultaneously without ambiguity.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'report_period_type') then
    create type report_period_type as enum ('weekly', 'monthly', 'all_time');
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — CREATE TABLE Statements
-- ════════════════════════════════════════════════════════════════════════════
-- Analytics hierarchy:
--   performance_reports (1) ───────── subject_performances (M)
--   performance_reports (1) ───────── chapter_performances (M)
--   progress_history     (independent, append-only event log)
--   teacher_analytics    (1:1 with teacher_details, singleton per teacher)

-- 1a. Table: performance_reports
-- One aggregated performance snapshot per student per reporting period.
-- This is the top-level analytics entity — the "report card" that drives the
-- student dashboard. A student may have multiple rows, one per period_type
-- (weekly, monthly, all-time). The background job UPSERTs the row for each
-- period on each run. weak_chapters, strong_chapters, and suggested_tests are
-- stored as UUID[] arrays (intentional denormalisation for read models).
create table public.performance_reports (
  report_id                 uuid                not null  default gen_random_uuid(),
  student_id                uuid                not null,
  institute_id              uuid                not null,
  period_type               report_period_type  not null,
  period_start              date                null      default null,
  period_end                date                null      default null,
  total_tests_attempted     smallint            not null  default 0,
  total_questions_attempted integer             not null  default 0,
  total_correct             integer             not null  default 0,
  total_incorrect           integer             not null  default 0,
  total_skipped             integer             not null  default 0,
  overall_score             numeric(6,2)        not null  default 0.00,
  overall_accuracy          numeric(5,2)        not null  default 0.00,
  rank                      integer             null      default null,
  percentile                numeric(5,2)        null      default null,
  avg_time_per_question     numeric(8,2)        null      default null,
  weak_chapters             uuid[]              not null  default '{}',
  strong_chapters           uuid[]              not null  default '{}',
  suggested_tests           uuid[]              not null  default '{}',
  generated_at              timestamptz         not null  default now(),
  created_at                timestamptz         not null  default now(),
  updated_at                timestamptz         not null  default now(),

  -- Primary Key
  constraint pk_performance_reports primary key (report_id),

  -- Foreign Keys
  constraint fk_performance_reports_student
    foreign key (student_id) references public.student_details (student_id)
    on delete restrict
    on update restrict,

  constraint fk_performance_reports_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  -- Unique Constraints
  constraint uq_performance_reports_student_period unique (student_id, period_type),

  -- CHECK Constraints
  constraint ck_performance_reports_total_tests_attempted check (total_tests_attempted >= 0),
  constraint ck_performance_reports_total_questions_attempted check (total_questions_attempted >= 0),
  constraint ck_performance_reports_total_correct check (total_correct >= 0),
  constraint ck_performance_reports_total_incorrect check (total_incorrect >= 0),
  constraint ck_performance_reports_total_skipped check (total_skipped >= 0),
  constraint ck_performance_reports_attempted_consistency check
    (total_correct + total_incorrect + total_skipped <= total_questions_attempted),
  constraint ck_performance_reports_overall_score check
    (overall_score >= 0.00 and overall_score <= 100.00),
  constraint ck_performance_reports_overall_accuracy check
    (overall_accuracy >= 0.00 and overall_accuracy <= 100.00),
  constraint ck_performance_reports_rank check (rank is null or rank >= 1),
  constraint ck_performance_reports_percentile check
    (percentile is null or (percentile >= 0.00 and percentile <= 100.00)),
  constraint ck_performance_reports_avg_time check
    (avg_time_per_question is null or avg_time_per_question >= 0),
  constraint ck_performance_reports_period_consistency check
    ((period_type = 'all_time' and period_start is null and period_end is null)
     or (period_type != 'all_time' and period_start is not null
         and period_end is not null and period_end >= period_start))
);

-- 1b. Table: subject_performances
-- Subject-level breakdown of a performance_report. For each report, one row
-- exists per subject in which the student has attempted at least one question
-- during the report period. Powers the per-subject bar chart / breakdown
-- section of the student dashboard.
create table public.subject_performances (
  subject_perf_id        uuid            not null  default gen_random_uuid(),
  report_id              uuid            not null,
  student_id             uuid            not null,
  institute_id           uuid            not null,
  subject_id             uuid            not null,
  questions_attempted    smallint        not null  default 0,
  correct                smallint        not null  default 0,
  incorrect              smallint        not null  default 0,
  skipped                smallint        not null  default 0,
  score                  numeric(6,2)    not null  default 0.00,
  accuracy               numeric(5,2)    not null  default 0.00,
  avg_time_per_question  numeric(8,2)    null      default null,
  created_at             timestamptz     not null  default now(),

  -- Primary Key
  constraint pk_subject_performances primary key (subject_perf_id),

  -- Foreign Keys
  constraint fk_subject_performances_report
    foreign key (report_id) references public.performance_reports (report_id)
    on delete cascade
    on update restrict,

  constraint fk_subject_performances_student
    foreign key (student_id) references public.student_details (student_id)
    on delete restrict
    on update restrict,

  constraint fk_subject_performances_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_subject_performances_subject
    foreign key (subject_id) references public.subjects (subject_id)
    on delete restrict
    on update restrict,

  -- Unique Constraints
  constraint uq_subject_performances_report_subject unique (report_id, subject_id),

  -- CHECK Constraints
  constraint ck_subject_performances_questions_attempted check (questions_attempted >= 0),
  constraint ck_subject_performances_correct check (correct >= 0),
  constraint ck_subject_performances_incorrect check (incorrect >= 0),
  constraint ck_subject_performances_skipped check (skipped >= 0),
  constraint ck_subject_performances_attempted_consistency check
    (correct + incorrect + skipped <= questions_attempted),
  constraint ck_subject_performances_score check
    (score >= 0.00 and score <= 100.00),
  constraint ck_subject_performances_accuracy check
    (accuracy >= 0.00 and accuracy <= 100.00),
  constraint ck_subject_performances_avg_time check
    (avg_time_per_question is null or avg_time_per_question >= 0)
);

-- 1c. Table: chapter_performances
-- Chapter-level breakdown of a performance_report. More granular than
-- subject_performances — one row per chapter per report. Powers the chapter-level
-- drill-down view on the student dashboard. is_weak/is_strong flags are
-- pre-computed boolean conveniences for faster filtering.
create table public.chapter_performances (
  chapter_perf_id       uuid            not null  default gen_random_uuid(),
  report_id             uuid            not null,
  student_id            uuid            not null,
  institute_id          uuid            not null,
  subject_id            uuid            not null,
  chapter_id            uuid            not null,
  questions_attempted   smallint        not null  default 0,
  correct               smallint        not null  default 0,
  incorrect             smallint        not null  default 0,
  skipped               smallint        not null  default 0,
  score                 numeric(6,2)    not null  default 0.00,
  accuracy              numeric(5,2)    not null  default 0.00,
  avg_time_per_question numeric(8,2)    null      default null,
  is_weak               boolean         not null  default false,
  is_strong             boolean         not null  default false,
  created_at            timestamptz     not null  default now(),

  -- Primary Key
  constraint pk_chapter_performances primary key (chapter_perf_id),

  -- Foreign Keys
  constraint fk_chapter_performances_report
    foreign key (report_id) references public.performance_reports (report_id)
    on delete cascade
    on update restrict,

  constraint fk_chapter_performances_student
    foreign key (student_id) references public.student_details (student_id)
    on delete restrict
    on update restrict,

  constraint fk_chapter_performances_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_chapter_performances_subject
    foreign key (subject_id) references public.subjects (subject_id)
    on delete restrict
    on update restrict,

  constraint fk_chapter_performances_chapter
    foreign key (chapter_id) references public.chapters (chapter_id)
    on delete restrict
    on update restrict,

  -- Unique Constraints
  constraint uq_chapter_performances_report_chapter unique (report_id, chapter_id),

  -- CHECK Constraints
  constraint ck_chapter_performances_questions_attempted check (questions_attempted >= 0),
  constraint ck_chapter_performances_correct check (correct >= 0),
  constraint ck_chapter_performances_incorrect check (incorrect >= 0),
  constraint ck_chapter_performances_skipped check (skipped >= 0),
  constraint ck_chapter_performances_attempted_consistency check
    (correct + incorrect + skipped <= questions_attempted),
  constraint ck_chapter_performances_score check
    (score >= 0.00 and score <= 100.00),
  constraint ck_chapter_performances_accuracy check
    (accuracy >= 0.00 and accuracy <= 100.00),
  constraint ck_chapter_performances_avg_time check
    (avg_time_per_question is null or avg_time_per_question >= 0),
  -- is_weak and is_strong cannot both be true simultaneously
  constraint ck_chapter_performances_weak_strong check
    (not (is_weak = true and is_strong = true))
);

-- 1d. Table: progress_history
-- Append-only event log recording a student's score and rank immediately after
-- each mock test attempt is evaluated. This is the foundation for trend charts
-- on the student dashboard and the source data for nightly performance_reports
-- background job. This table is immutable after INSERT — no row is ever updated
-- or deleted. This is an architectural invariant enforced at the RLS layer.
create table public.progress_history (
  history_id          uuid            not null  default gen_random_uuid(),
  student_id          uuid            not null,
  institute_id        uuid            not null,
  test_id             uuid            not null,
  attempt_id          uuid            not null,
  score               numeric(8,2)    not null,
  max_score           numeric(8,2)    not null,
  percentage          numeric(5,2)    not null,
  rank                integer         null      default null,
  total_questions     smallint        not null,
  correct             smallint        not null  default 0,
  incorrect           smallint        not null  default 0,
  skipped             smallint        not null  default 0,
  time_taken_seconds  integer         null      default null,
  recorded_at         timestamptz     not null  default now(),

  -- Primary Key
  constraint pk_progress_history primary key (history_id),

  -- Foreign Keys
  constraint fk_progress_history_student
    foreign key (student_id) references public.student_details (student_id)
    on delete restrict
    on update restrict,

  constraint fk_progress_history_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_progress_history_test
    foreign key (test_id) references public.mock_tests (test_id)
    on delete restrict
    on update restrict,

  constraint fk_progress_history_attempt
    foreign key (attempt_id) references public.mock_attempts (attempt_id)
    on delete restrict
    on update restrict,

  -- Unique Constraints
  constraint uq_progress_history_attempt_id unique (attempt_id),

  -- CHECK Constraints
  constraint ck_progress_history_score check (score >= 0),
  constraint ck_progress_history_max_score check (max_score > 0),
  constraint ck_progress_history_score_consistency check (score <= max_score),
  constraint ck_progress_history_percentage check
    (percentage >= 0.00 and percentage <= 100.00),
  constraint ck_progress_history_rank check (rank is null or rank >= 1),
  constraint ck_progress_history_total_questions check (total_questions > 0),
  constraint ck_progress_history_correct check (correct >= 0),
  constraint ck_progress_history_incorrect check (incorrect >= 0),
  constraint ck_progress_history_skipped check (skipped >= 0),
  constraint ck_progress_history_attempted_consistency check
    (correct + incorrect + skipped <= total_questions),
  constraint ck_progress_history_time_taken check
    (time_taken_seconds is null or time_taken_seconds >= 0)
);

-- 1e. Table: teacher_analytics
-- Aggregated dashboard metrics for a single teacher. 1:1 with teacher_details
-- — one row per teacher, refreshed nightly by a background job. Powers the
-- teacher dashboard: total students taught, classes conducted, average attendance
-- rate, question bank contribution, and test creation count.
create table public.teacher_analytics (
  analytics_id             uuid            not null  default gen_random_uuid(),
  teacher_id               uuid            not null,
  institute_id             uuid            not null,
  total_students           integer         not null  default 0,
  total_classes_conducted  integer         not null  default 0,
  total_classes_scheduled  integer         not null  default 0,
  avg_attendance_rate      numeric(5,2)    not null  default 0.00,
  total_content_uploaded   integer         not null  default 0,
  questions_created        integer         not null  default 0,
  tests_created            integer         not null  default 0,
  avg_student_score        numeric(5,2)    null      default null,
  top_chapter_id           uuid            null      default null,
  last_class_at            timestamptz     null      default null,
  last_updated             timestamptz     not null  default now(),
  created_at               timestamptz     not null  default now(),
  updated_at               timestamptz     not null  default now(),

  -- Primary Key
  constraint pk_teacher_analytics primary key (analytics_id),

  -- Foreign Keys
  constraint fk_teacher_analytics_teacher
    foreign key (teacher_id) references public.teacher_details (teacher_id)
    on delete restrict
    on update restrict,

  constraint fk_teacher_analytics_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_teacher_analytics_top_chapter
    foreign key (top_chapter_id) references public.chapters (chapter_id)
    on delete set null
    on update restrict,

  -- Unique Constraints
  constraint uq_teacher_analytics_teacher_id unique (teacher_id),

  -- CHECK Constraints
  constraint ck_teacher_analytics_total_students check (total_students >= 0),
  constraint ck_teacher_analytics_total_classes_conducted check (total_classes_conducted >= 0),
  constraint ck_teacher_analytics_total_classes_scheduled check (total_classes_scheduled >= 0),
  constraint ck_teacher_analytics_avg_attendance_rate check
    (avg_attendance_rate >= 0.00 and avg_attendance_rate <= 100.00),
  constraint ck_teacher_analytics_total_content_uploaded check (total_content_uploaded >= 0),
  constraint ck_teacher_analytics_questions_created check (questions_created >= 0),
  constraint ck_teacher_analytics_tests_created check (tests_created >= 0),
  constraint ck_teacher_analytics_avg_student_score check
    (avg_student_score is null or (avg_student_score >= 0.00 and avg_student_score <= 100.00))
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Indexes
-- ════════════════════════════════════════════════════════════════════════════
-- All indexes are created after their respective tables exist.
-- No duplicate indexes on columns already covered by UNIQUE constraints.
-- GIN indexes are used on UUID array columns for containment queries.

-- 2a. performance_reports indexes
-- Note: idx_perf_reports_student_period is covered by
--   uq_performance_reports_student_period (unique constraint).

create index if not exists idx_perf_reports_institute_rank
  on public.performance_reports (institute_id, period_type, rank asc nulls last);

create index if not exists idx_perf_reports_institute_percentile
  on public.performance_reports (institute_id, period_type, percentile desc nulls last);

create index if not exists idx_perf_reports_institute_generated_at
  on public.performance_reports (institute_id, generated_at desc);

-- GIN indexes: enable array containment queries (@> operator) on weak_chapters
-- and suggested_tests. B-tree indexes cannot accelerate array containment.
create index if not exists idx_perf_reports_weak_chapters
  on public.performance_reports using gin (weak_chapters);

create index if not exists idx_perf_reports_strong_chapters
  on public.performance_reports using gin (strong_chapters);

create index if not exists idx_perf_reports_suggested_tests
  on public.performance_reports using gin (suggested_tests);

-- 2b. subject_performances indexes
create index if not exists idx_subject_perf_report_id
  on public.subject_performances (report_id);

create index if not exists idx_subject_perf_student_subject
  on public.subject_performances (student_id, subject_id);

create index if not exists idx_subject_perf_institute_subject_score
  on public.subject_performances (institute_id, subject_id, score desc);

-- Note: idx_subject_perf_report_subject is covered by
--   uq_subject_performances_report_subject (unique constraint).

-- 2c. chapter_performances indexes
create index if not exists idx_chapter_perf_report_id
  on public.chapter_performances (report_id);

create index if not exists idx_chapter_perf_student_chapter
  on public.chapter_performances (student_id, chapter_id);

-- Partial index: admin/teacher query — "How many students are weak in Chapter X?"
create index if not exists idx_chapter_perf_institute_chapter_weak
  on public.chapter_performances (institute_id, chapter_id)
  where is_weak = true;

create index if not exists idx_chapter_perf_subject_accuracy
  on public.chapter_performances (subject_id, accuracy desc);

-- Note: idx_chapter_perf_report_chapter is covered by
--   uq_chapter_performances_report_chapter (unique constraint).

-- 2d. progress_history indexes
create index if not exists idx_progress_history_student_recorded
  on public.progress_history (student_id, recorded_at desc);

create index if not exists idx_progress_history_student_test
  on public.progress_history (student_id, test_id, recorded_at desc);

create index if not exists idx_progress_history_institute_test_rank
  on public.progress_history (institute_id, test_id, rank asc nulls last);

-- Note: idx_progress_history_attempt_id is covered by
--   uq_progress_history_attempt_id (unique constraint).

create index if not exists idx_progress_history_institute_recorded
  on public.progress_history (institute_id, recorded_at desc);

-- 2e. teacher_analytics indexes
-- Note: idx_teacher_analytics_teacher_id is covered by
--   uq_teacher_analytics_teacher_id (unique constraint).

create index if not exists idx_teacher_analytics_institute_avg_score
  on public.teacher_analytics (institute_id, avg_student_score desc nulls last);

create index if not exists idx_teacher_analytics_institute_attendance
  on public.teacher_analytics (institute_id, avg_attendance_rate desc);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — CREATE TRIGGER Statements
-- ════════════════════════════════════════════════════════════════════════════
-- Only tables with an updated_at column receive the set_updated_at trigger.
-- set_updated_at() already exists from Domain 01 — do not recreate.
-- subject_performances has no updated_at column (rows are deleted and recreated
--   each report cycle, not updated in place).
-- chapter_performances has no updated_at column (same pattern).
-- progress_history has no updated_at column (immutable — append-only event log).

-- 3a. performance_reports triggers
create trigger trg_performance_reports_set_updated_at
  before update on public.performance_reports
  for each row
  execute function public.set_updated_at();

-- 3b. teacher_analytics triggers
create trigger trg_teacher_analytics_set_updated_at
  before update on public.teacher_analytics
  for each row
  execute function public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — COMMENT Statements
-- ════════════════════════════════════════════════════════════════════════════

-- 4a. Table comments
comment on table public.performance_reports is
  'One aggregated performance snapshot per student per reporting period '
  '(weekly, monthly, all-time). The "report card" that drives the student '
  'dashboard. Computed by nightly background job using UPSERT on '
  '(student_id, period_type). weak_chapters, strong_chapters, and '
  'suggested_tests are UUID arrays (intentional denormalisation for '
  'read models).';

comment on table public.subject_performances is
  'Subject-level score breakdown of a performance_report. One row per subject '
  'per report where the student attempted at least one question. Powers the '
  'per-subject bar chart / breakdown section of the student dashboard. '
  'Rows cascade-delete when the parent performance_report is regenerated.';

comment on table public.chapter_performances is
  'Chapter-level score breakdown of a performance_report. One row per chapter '
  'per report. More granular than subject_performances. is_weak/is_strong '
  'flags are pre-computed boolean conveniences for faster filtering. '
  'subject_id is denormalized to avoid a join through chapters for '
  'subject-scoped chapter queries. Rows cascade-delete with parent report.';

comment on table public.progress_history is
  'Append-only event log recording a student''s score and rank immediately '
  'after each mock test attempt is evaluated. Foundation for trend charts '
  'on the student dashboard and source data for the nightly performance_reports '
  'background job. This table is immutable after INSERT — no row is ever '
  'updated or deleted. Architectural invariant enforced at the RLS layer.';

comment on table public.teacher_analytics is
  'Aggregated dashboard metrics for a single teacher. 1:1 with teacher_details '
  '— one row per teacher, refreshed nightly by a background job. Powers the '
  'teacher dashboard: total students taught, classes conducted, average '
  'attendance rate, question bank contribution, and test creation count. '
  'Singleton per teacher — no history of metric changes is maintained in v1.';

-- 4b. Column comments
comment on column public.performance_reports.period_type is
  'PostgreSQL enum: weekly, monthly, all_time. Defines the time window over '
  'which the report was computed. Allows multiple report windows per student.' ;

comment on column public.performance_reports.period_start is
  'Inclusive start date of the reporting window. NULL for all_time reports.';

comment on column public.performance_reports.period_end is
  'Inclusive end date of the reporting window. NULL for all_time reports.';

comment on column public.performance_reports.total_tests_attempted is
  'Number of mock tests the student attempted in this period.';

comment on column public.performance_reports.total_questions_attempted is
  'Total questions answered across all tests in this period.';

comment on column public.performance_reports.total_correct is
  'Total correct answers in this period.';

comment on column public.performance_reports.total_incorrect is
  'Total incorrect answers (including negative-marking penalties) in this period.';

comment on column public.performance_reports.total_skipped is
  'Total questions skipped (unattempted) in this period.';

comment on column public.performance_reports.overall_score is
  'Weighted aggregate score across all tests in the period. Stored as a '
  'normalised percentage (0.00–100.00) for cross-test comparability.';

comment on column public.performance_reports.overall_accuracy is
  '(total_correct / total_questions_attempted) * 100. 0.00 when no '
  'questions attempted.';

comment on column public.performance_reports.rank is
  'Student''s rank within their institute for this period. Computed across '
  'all students in the same institute and stream. NULL if fewer than 2 '
  'students have data.';

comment on column public.performance_reports.percentile is
  'Percentile score (0.00–100.00) within the institute and stream. '
  'NULL if insufficient cohort data.';

comment on column public.performance_reports.avg_time_per_question is
  'Average time in seconds spent per question across all attempts in the '
  'period. Derived from mock_attempts.time_taken_seconds / questions_attempted.';

comment on column public.performance_reports.weak_chapters is
  'Array of chapter_id values where the student scored below a configured '
  'threshold (e.g., < 40% accuracy). Used by the frontend recommendation '
  'engine. Empty array when no weak chapters detected. GIN-indexed for '
  'containment queries.';

comment on column public.performance_reports.strong_chapters is
  'Array of chapter_id values where the student scored above a configured '
  'threshold (e.g., > 80% accuracy). Empty array when no strong chapters '
  'detected. GIN-indexed for containment queries.';

comment on column public.performance_reports.suggested_tests is
  'Array of mock_test_id values recommended for the student based on weak '
  'chapter analysis. Populated by the recommendation algorithm. Capped at '
  '5 entries in the background job. GIN-indexed for containment queries.';

comment on column public.performance_reports.generated_at is
  'Timestamp when this report row was last computed and written. Always UTC. '
  'Displayed to students as "Last updated". May differ from updated_at.';

comment on column public.performance_reports.updated_at is
  'Trigger-maintained. Updated on each nightly UPSERT.';

comment on column public.subject_performances.report_id is
  'FK to performance_reports.report_id with ON DELETE CASCADE. Child rows '
  'are automatically cleaned up when the parent report is regenerated.';

comment on column public.subject_performances.student_id is
  'Denormalized from the parent report to allow direct student-scoped queries '
  'without joining through performance_reports.';

comment on column public.subject_performances.institute_id is
  'Denormalized for RLS performance.';

comment on column public.subject_performances.subject_id is
  'FK to subjects.subject_id. The subject this row measures.';

comment on column public.subject_performances.questions_attempted is
  'Number of questions from this subject attempted in the period.';

comment on column public.subject_performances.score is
  'Normalised score for this subject (0.00–100.00).';

comment on column public.subject_performances.accuracy is
  '(correct / questions_attempted) * 100. 0.00 when questions_attempted = 0.';

comment on column public.subject_performances.avg_time_per_question is
  'Average seconds per question for this subject. NULL when no questions attempted.';

comment on column public.chapter_performances.subject_id is
  'Denormalized from chapters.subject_id to enable subject-scoped chapter '
  'queries without joining through chapters at read time.';

comment on column public.chapter_performances.chapter_id is
  'FK to chapters.chapter_id. The chapter this row measures.';

comment on column public.chapter_performances.questions_attempted is
  'Questions from this chapter attempted in the period.';

comment on column public.chapter_performances.score is
  'Normalised score for this chapter (0.00–100.00).';

comment on column public.chapter_performances.accuracy is
  'Percentage accuracy within this chapter.';

comment on column public.chapter_performances.is_weak is
  'TRUE if accuracy is below the configured weak threshold. Pre-computed '
  'flag for faster filtering than range comparison on numeric accuracy. '
  'Cannot be TRUE simultaneously with is_strong.';

comment on column public.chapter_performances.is_strong is
  'TRUE if accuracy is above the configured strong threshold. Pre-computed '
  'flag. Cannot be TRUE simultaneously with is_weak.';

comment on column public.progress_history.student_id is
  'FK to student_details.student_id. The student who attempted the test.';

comment on column public.progress_history.test_id is
  'FK to mock_tests.mock_test_id. The test that was attempted.';

comment on column public.progress_history.attempt_id is
  'FK to mock_attempts.attempt_id. The specific attempt that produced this '
  'record. Unique constraint enforces one row per attempt (idempotency backstop).';

comment on column public.progress_history.score is
  'Raw score achieved in this attempt (not normalised — stored in the test''s '
  'own scoring unit for fidelity). Use performance_reports.overall_score for '
  'normalised cross-test comparisons.';

comment on column public.progress_history.max_score is
  'Maximum possible score for this test at the time of the attempt. Snapshot '
  'preserves historical accuracy even if test max_score changes post-publication.';

comment on column public.progress_history.percentage is
  '(score / max_score) * 100. Computed and stored on INSERT for trend chart '
  'rendering without recalculation. Range: 0.00–100.00.';

comment on column public.progress_history.rank is
  'Student''s rank within their institute on this specific test at result '
  'generation time. NULL if not yet computed (live competitions) or for '
  'solo practice tests.';

comment on column public.progress_history.total_questions is
  'Total questions in the test at time of attempt. Snapshot for historical accuracy.';

comment on column public.progress_history.time_taken_seconds is
  'Total time taken for the attempt in seconds. NULL if the student abandoned '
  'without submitting.';

comment on column public.progress_history.recorded_at is
  'UTC timestamp when this history row was written (immediately after result '
  'calculation). The sole and authoritative timestamp — doubles as both '
  'business event time and audit time.';

comment on column public.teacher_analytics.teacher_id is
  'FK to teacher_details.teacher_id. Unique constraint enforces the 1:1 '
  'relationship.';

comment on column public.teacher_analytics.total_students is
  'Total unique students currently enrolled in any active batch taught by '
  'this teacher.';

comment on column public.teacher_analytics.total_classes_conducted is
  'Total live classes conducted (status = completed) across all time.';

comment on column public.teacher_analytics.total_classes_scheduled is
  'Total upcoming live classes scheduled by this teacher.';

comment on column public.teacher_analytics.avg_attendance_rate is
  'Average attendance percentage across all completed live classes. '
  'Computed as AVG(actual_attendees / enrolled_students * 100) per class. '
  'Range: 0.00–100.00.';

comment on column public.teacher_analytics.total_content_uploaded is
  'Total content items (PDFs, videos, notes, assignments) uploaded with status = approved.';

comment on column public.teacher_analytics.questions_created is
  'Total questions created with status = published.';

comment on column public.teacher_analytics.tests_created is
  'Total mock tests created with status = published.';

comment on column public.teacher_analytics.avg_student_score is
  'Average percentage from progress_history for all students in this teacher''s '
  'batches across all tests created by this teacher. NULL if no test data available.';

comment on column public.teacher_analytics.top_chapter_id is
  'FK to chapters.chapter_id. The chapter with the most questions created by '
  'this teacher. Used for the dashboard''s "Your Specialty" card. '
  'ON DELETE SET NULL if the chapter is deleted.';

comment on column public.teacher_analytics.last_class_at is
  'Timestamp of the most recently completed live class. NULL if no classes conducted.';

comment on column public.teacher_analytics.last_updated is
  'Timestamp of the last background job refresh. Displayed to teachers as '
  '"Last updated" on the dashboard. Distinct from updated_at for display purposes.';

-- 4c. Constraint comments
comment on constraint uq_performance_reports_student_period on public.performance_reports is
  'Enforces that exactly one current report exists per student per period type. '
  'The background job uses this as the UPSERT target (ON CONFLICT DO UPDATE).';

comment on constraint ck_performance_reports_period_consistency on public.performance_reports is
  'For all_time reports, period_start and period_end must be NULL. For weekly '
  'and monthly reports, both must be set and period_end must be >= period_start.';

comment on constraint ck_performance_reports_attempted_consistency on public.performance_reports is
  'The sum of correct, incorrect, and skipped cannot exceed the total questions '
  'attempted. Prevents data integrity errors in the background job.';

comment on constraint fk_subject_performances_report on public.subject_performances is
  'ON DELETE CASCADE: When the parent performance_report is deleted during a '
  'nightly UPSERT cycle, all child subject_performances rows cascade-delete '
  'automatically. Correct because both are derived data.';

comment on constraint uq_subject_performances_report_subject on public.subject_performances is
  'One subject breakdown row per subject per report. The background job uses '
  'this for its UPSERT target.';

comment on constraint fk_chapter_performances_report on public.chapter_performances is
  'ON DELETE CASCADE: Same pattern as subject_performances — child rows are '
  'recreated on each report cycle.';

comment on constraint uq_chapter_performances_report_chapter on public.chapter_performances is
  'One chapter breakdown row per chapter per report. Background job UPSERT target.';

comment on constraint ck_chapter_performances_weak_strong on public.chapter_performances is
  'is_weak and is_strong cannot both be true simultaneously. A chapter cannot '
  'be both above the strong threshold AND below the weak threshold.';

comment on constraint uq_progress_history_attempt_id on public.progress_history is
  'One progress_history row per attempt. Prevents double-recording if the '
  'result calculation job runs twice for the same attempt (idempotency backstop).';

comment on constraint ck_progress_history_score_consistency on public.progress_history is
  'The score achieved must not exceed the maximum possible score for this attempt.';

comment on constraint ck_progress_history_attempted_consistency on public.progress_history is
  'The sum of correct, incorrect, and skipped cannot exceed the total questions '
  'in the test at time of attempt.';

comment on constraint uq_teacher_analytics_teacher_id on public.teacher_analytics is
  'Enforces the 1:1 relationship — one analytics row per teacher. The background '
  'job uses ON CONFLICT (teacher_id) DO UPDATE for its UPSERT.';

comment on constraint fk_teacher_analytics_top_chapter on public.teacher_analytics is
  'ON DELETE SET NULL: If a chapter is ever deleted (unlikely but possible), '
  'the analytics row should not be orphaned. NULL the reference and let the '
  'next nightly job recompute it.';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — Domain 08 Analytics
-- ════════════════════════════════════════════════════════════════════════════
