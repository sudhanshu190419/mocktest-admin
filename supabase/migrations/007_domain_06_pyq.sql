-- ============================================================================
-- Migration: Domain 06 — PYQ (Previous Year Questions)
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Tables: pyq_packages · pyq_package_unlocks · pyq_papers ·
--         pyq_question_mappings · pyq_solutions · pyq_mock_mappings ·
--         student_pyq_purchases
--
-- Depends on: Domain 01 (institutes, profiles, teacher_details, student_details)
--             Domain 02 (streams)
--             Domain 05 (questions, mock_tests)
--             Existing enums (user_role, lifecycle_status, etc.)
--             Existing functions (set_updated_at, get_my_institute_id, etc.)
--             Existing types (item_type for order_items FK)
--
-- New Enums: None — this domain uses VARCHAR for all extensible fields
--            (unlock_type, exam_session, access_type)
--
-- Order:
--   1. Tables (dependency order: parent → child → junction)
--   2. Indexes (after all tables exist)
--   3. Triggers (after all tables exist; set_updated_at already exists from Domain 1)
--   4. Comments
--
-- Reference: Schema_Domain_06_PYQ.md v1.0 | ERD v3.0
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 0 — New Enum Types (Idempotent)
-- ════════════════════════════════════════════════════════════════════════════
-- This domain introduces no new PostgreSQL enums. All variable fields use
-- VARCHAR explicitly to allow new values without requiring a migration:
--   pyq_package_unlocks.unlock_type  — 'pdf', 'solutions', 'mock_test'
--   pyq_papers.exam_session          — free-form session identifiers
--   student_pyq_purchases.access_type — 'purchase', 'admin_grant', 'subscription'

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — CREATE TABLE Statements
-- ════════════════════════════════════════════════════════════════════════════
-- PYQ Commerce:  pyq_packages → pyq_package_unlocks
-- PYQ Content:   pyq_papers → pyq_question_mappings → pyq_solutions
-- PYQ Mock:      pyq_mock_mappings (links pyq_papers → mock_tests)
-- PYQ Access:    student_pyq_purchases

-- 1a. Table: pyq_packages
-- The top-level sellable unit of PYQ content. A package groups one or more
-- PYQ papers under a single price point and access grant. Students buy a
-- package, not individual papers.
create table public.pyq_packages (
  package_id        uuid              not null  default gen_random_uuid(),
  institute_id      uuid              not null,
  stream_id         uuid              not null,
  name              varchar(300)      not null,
  description       text              null      default null,
  price             numeric(10,2)     not null,
  currency          varchar(3)        not null  default 'INR',
  thumbnail_path    text              null      default null,
  year_from         integer           null      default null,
  year_to           integer           null      default null,
  total_papers      integer           not null  default 0,
  is_active         boolean           not null  default true,
  created_at        timestamptz       not null  default now(),
  updated_at        timestamptz       not null  default now(),
  published_at      timestamptz       null      default null,

  -- Primary Key
  constraint pk_pyq_packages primary key (package_id),

  -- Foreign Keys
  constraint fk_pyq_packages_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_pyq_packages_stream
    foreign key (stream_id) references public.streams (stream_id)
    on delete restrict
    on update restrict,

  -- CHECK Constraints
  constraint ck_pyq_packages_name_length check (char_length(name) >= 3),
  constraint ck_pyq_packages_price check (price >= 0),
  constraint ck_pyq_packages_currency_length check (char_length(currency) = 3),
  constraint ck_pyq_packages_year_from check
    (year_from is null or (year_from >= 1990 and year_from <= 2100)),
  constraint ck_pyq_packages_year_to check
    (year_to is null or (year_to >= 1990 and year_to <= 2100)),
  constraint ck_pyq_packages_year_range check
    (year_from is null or year_to is null or year_to >= year_from),
  constraint ck_pyq_packages_total_papers check (total_papers >= 0),
  constraint ck_pyq_packages_active_published check
    ((is_active = true and published_at is not null)
     or (is_active = false))
);

-- 1b. Table: pyq_package_unlocks
-- Explicit enumeration of which asset types a package grants access to.
-- A purchased package does not automatically unlock everything — the unlock
-- type controls which content is accessible (pdf, solutions, mock_test).
create table public.pyq_package_unlocks (
  unlock_id       uuid            not null  default gen_random_uuid(),
  package_id      uuid            not null,
  institute_id    uuid            not null,
  unlock_type     varchar(50)     not null,
  created_at      timestamptz     not null  default now(),

  -- Primary Key
  constraint pk_pyq_package_unlocks primary key (unlock_id),

  -- Foreign Keys
  constraint fk_pyq_package_unlocks_package
    foreign key (package_id) references public.pyq_packages (package_id)
    on delete cascade
    on update restrict,

  constraint fk_pyq_package_unlocks_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  -- Unique Constraints
  constraint uq_pyq_package_unlocks_package_type unique (package_id, unlock_type),

  -- CHECK Constraints
  constraint ck_pyq_package_unlocks_unlock_type_length check (char_length(unlock_type) >= 1)
);

-- 1c. Table: pyq_papers
-- One row per official exam paper — a single sitting of an exam in a given
-- year. Every paper belongs to exactly one pyq_package and one stream. Papers
-- are the primary content unit of the PYQ domain.
create table public.pyq_papers (
  paper_id                    uuid            not null  default gen_random_uuid(),
  package_id                  uuid            not null,
  institute_id                uuid            not null,
  stream_id                   uuid            not null,
  title                       varchar(300)    not null,
  exam_year                   integer         not null,
  exam_date                   date            null      default null,
  exam_session                varchar(100)    null      default null,
  total_questions             integer         not null  default 0,
  total_marks                 integer         null      default null,
  duration_min                integer         null      default null,
  pdf_storage_bucket          varchar(100)    null      default null,
  pdf_storage_path            text            null      default null,
  solution_pdf_storage_bucket varchar(100)    null      default null,
  solution_pdf_storage_path   text            null      default null,
  is_published                boolean         not null  default false,
  published_at                timestamptz     null      default null,
  created_at                  timestamptz     not null  default now(),
  updated_at                  timestamptz     not null  default now(),

  -- Primary Key
  constraint pk_pyq_papers primary key (paper_id),

  -- Foreign Keys
  constraint fk_pyq_papers_package
    foreign key (package_id) references public.pyq_packages (package_id)
    on delete restrict
    on update restrict,

  constraint fk_pyq_papers_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_pyq_papers_stream
    foreign key (stream_id) references public.streams (stream_id)
    on delete restrict
    on update restrict,

  -- Unique Constraints
  constraint uq_pyq_papers_package_year_session unique (package_id, exam_year, exam_session),

  -- CHECK Constraints
  constraint ck_pyq_papers_title_length check (char_length(title) >= 3),
  constraint ck_pyq_papers_exam_year check (exam_year >= 1990 and exam_year <= 2100),
  constraint ck_pyq_papers_total_questions check (total_questions >= 0),
  constraint ck_pyq_papers_total_marks check (total_marks is null or total_marks > 0),
  constraint ck_pyq_papers_duration_min check
    (duration_min is null or (duration_min > 0 and duration_min <= 600)),
  constraint ck_pyq_papers_pdf_storage check
    ((pdf_storage_bucket is null) = (pdf_storage_path is null)),
  constraint ck_pyq_papers_solution_pdf_storage check
    ((solution_pdf_storage_bucket is null) = (solution_pdf_storage_path is null)),
  constraint ck_pyq_papers_published check
    ((is_published = true and published_at is not null)
     or (is_published = false))
);

-- 1d. Table: pyq_question_mappings
-- Junction table linking pyq_papers to questions. Each row records that a
-- specific question from the shared question bank appeared in a specific PYQ
-- paper at a specific position. Enables cross-domain analytics (chapter
-- frequency) without special PYQ-specific analytics tables.
create table public.pyq_question_mappings (
  mapping_id                uuid            not null  default gen_random_uuid(),
  paper_id                  uuid            not null,
  question_id               uuid            not null,
  institute_id              uuid            not null,
  order_sequence            integer         not null,
  section_name              varchar(100)    null      default null,
  official_marks            numeric(5,2)    null      default null,
  official_negative_marks   numeric(5,2)    null      default null,
  added_at                  timestamptz     not null  default now(),

  -- Primary Key
  constraint pk_pyq_question_mappings primary key (mapping_id),

  -- Foreign Keys
  constraint fk_pyq_question_mappings_paper
    foreign key (paper_id) references public.pyq_papers (paper_id)
    on delete restrict
    on update restrict,

  constraint fk_pyq_question_mappings_question
    foreign key (question_id) references public.questions (question_id)
    on delete restrict
    on update restrict,

  constraint fk_pyq_question_mappings_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  -- Unique Constraints
  constraint uq_pyq_question_mappings_paper_question unique (paper_id, question_id),
  constraint uq_pyq_question_mappings_paper_sequence unique (paper_id, order_sequence),

  -- CHECK Constraints
  constraint ck_pyq_question_mappings_order_sequence check (order_sequence >= 1),
  constraint ck_pyq_question_mappings_official_marks check
    (official_marks is null or official_marks > 0),
  constraint ck_pyq_question_mappings_official_negative_marks check
    (official_negative_marks is null or official_negative_marks >= 0)
);

-- 1e. Table: pyq_solutions
-- Per-question, per-paper solution records. One row per (paper_id, question_id)
-- pair, storing the text explanation and optional video walkthrough for that
-- question's official answer. Solutions are intentionally scoped to a
-- (paper_id, question_id) pair rather than just a question_id.
create table public.pyq_solutions (
  solution_id           uuid            not null  default gen_random_uuid(),
  paper_id              uuid            not null,
  question_id           uuid            not null,
  mapping_id            uuid            not null,
  institute_id          uuid            not null,
  solution_text         text            null      default null,
  solution_video_url    text            null      default null,
  official_answer       text            null      default null,
  is_disputed           boolean         not null  default false,
  dispute_note          text            null      default null,
  created_at            timestamptz     not null  default now(),
  updated_at            timestamptz     not null  default now(),

  -- Primary Key
  constraint pk_pyq_solutions primary key (solution_id),

  -- Foreign Keys
  constraint fk_pyq_solutions_paper
    foreign key (paper_id) references public.pyq_papers (paper_id)
    on delete restrict
    on update restrict,

  constraint fk_pyq_solutions_question
    foreign key (question_id) references public.questions (question_id)
    on delete restrict
    on update restrict,

  constraint fk_pyq_solutions_mapping
    foreign key (mapping_id) references public.pyq_question_mappings (mapping_id)
    on delete restrict
    on update restrict,

  constraint fk_pyq_solutions_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  -- Unique Constraints
  constraint uq_pyq_solutions_mapping_id unique (mapping_id),

  -- CHECK Constraints
  constraint ck_pyq_solutions_content check
    (solution_text is not null or solution_video_url is not null
     or is_disputed = true),
  constraint ck_pyq_solutions_dispute check
    ((is_disputed = true and dispute_note is not null)
     or (is_disputed = false and dispute_note is null))
);

-- 1f. Table: pyq_mock_mappings
-- Links a pyq_paper to a mock_test, enabling the paper to be attempted as a
-- timed, scored test through the Domain 5 attempt engine. 1:1 junction —
-- one paper maps to at most one mock test; one mock test is linked to at
-- most one paper.
create table public.pyq_mock_mappings (
  mapping_id      uuid          not null  default gen_random_uuid(),
  paper_id        uuid          not null,
  test_id         uuid          not null,
  institute_id    uuid          not null,
  created_at      timestamptz   not null  default now(),
  created_by      uuid          null      default null,

  -- Primary Key
  constraint pk_pyq_mock_mappings primary key (mapping_id),

  -- Foreign Keys
  constraint fk_pyq_mock_mappings_paper
    foreign key (paper_id) references public.pyq_papers (paper_id)
    on delete restrict
    on update restrict,

  constraint fk_pyq_mock_mappings_test
    foreign key (test_id) references public.mock_tests (test_id)
    on delete restrict
    on update restrict,

  constraint fk_pyq_mock_mappings_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_pyq_mock_mappings_created_by
    foreign key (created_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- Unique Constraints
  constraint uq_pyq_mock_mappings_paper_id unique (paper_id),
  constraint uq_pyq_mock_mappings_test_id unique (test_id)
);

-- 1g. Table: student_pyq_purchases
-- Records each student's purchase of a PYQ package. One row per student per
-- package. This is the access-control anchor for the entire PYQ domain —
-- every gated query in every other table checks against this table.
create table public.student_pyq_purchases (
  purchase_id       uuid            not null  default gen_random_uuid(),
  student_id        uuid            not null,
  package_id        uuid            not null,
  institute_id      uuid            not null,
  order_item_id     uuid            null      default null,
  granted_by        uuid            null      default null,
  access_type       varchar(20)     not null  default 'purchase',
  purchased_at      timestamptz     not null  default now(),
  expires_at        timestamptz     null      default null,
  is_active         boolean         not null  default true,
  revoked_at        timestamptz     null      default null,
  revoked_reason    text            null      default null,
  created_at        timestamptz     not null  default now(),
  updated_at        timestamptz     not null  default now(),

  -- Primary Key
  constraint pk_student_pyq_purchases primary key (purchase_id),

  -- Foreign Keys
  constraint fk_student_pyq_purchases_student
    foreign key (student_id) references public.student_details (student_id)
    on delete restrict
    on update restrict,

  constraint fk_student_pyq_purchases_package
    foreign key (package_id) references public.pyq_packages (package_id)
    on delete restrict
    on update restrict,

  constraint fk_student_pyq_purchases_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  -- TODO: Add FK to order_items.item_id after Domain 07 (Commerce) migration has been applied.
  --   constraint fk_student_pyq_purchases_order_item
  --     foreign key (order_item_id) references public.order_items (item_id)
  --     on delete set null
  --     on update restrict

  constraint fk_student_pyq_purchases_granted_by
    foreign key (granted_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- Unique Constraints
  constraint uq_student_pyq_purchases_student_package unique (student_id, package_id),

  -- CHECK Constraints
  constraint ck_student_pyq_purchases_revocation check
    ((is_active = false and revoked_at is not null and revoked_reason is not null)
     or (is_active = true and revoked_at is null and revoked_reason is null)),
  constraint ck_student_pyq_purchases_expires check
    (expires_at is null or expires_at > purchased_at)
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Indexes
-- ════════════════════════════════════════════════════════════════════════════
-- All indexes are created after their respective tables exist.
-- No duplicate indexes on columns already covered by UNIQUE constraints.
-- Partial indexes are used where specified in the schema.

-- 2a. pyq_packages indexes
create index if not exists idx_pyq_packages_institute_active
  on public.pyq_packages (institute_id, is_active);

create index if not exists idx_pyq_packages_stream_active
  on public.pyq_packages (stream_id, is_active);

-- Partial index: price-sorted store listing for active packages
create index if not exists idx_pyq_packages_price_active
  on public.pyq_packages (institute_id, price)
  where is_active = true;

-- 2b. pyq_package_unlocks indexes
create index if not exists idx_pyq_package_unlocks_package_id
  on public.pyq_package_unlocks (package_id);

-- Note: idx_pyq_package_unlocks_package_type is covered by
--   uq_pyq_package_unlocks_package_type (unique constraint).

-- 2c. pyq_papers indexes
create index if not exists idx_pyq_papers_package_published
  on public.pyq_papers (package_id, is_published);

-- Partial index: chronological paper listing within a package
create index if not exists idx_pyq_papers_package_year
  on public.pyq_papers (package_id, exam_year desc)
  where is_published = true;

-- Partial index: cross-package stream-level paper timeline (admin analytics)
create index if not exists idx_pyq_papers_stream_year
  on public.pyq_papers (stream_id, exam_year desc)
  where is_published = true;

-- 2d. pyq_question_mappings indexes
create index if not exists idx_pyq_question_mappings_paper_order
  on public.pyq_question_mappings (paper_id, order_sequence);

create index if not exists idx_pyq_question_mappings_question_id
  on public.pyq_question_mappings (question_id);

-- Partial index: section-filtered question delivery for multi-section papers
create index if not exists idx_pyq_question_mappings_paper_section
  on public.pyq_question_mappings (paper_id, section_name, order_sequence)
  where section_name is not null;

-- 2e. pyq_solutions indexes
-- Note: idx_pyq_solutions_mapping_id is covered by
--   uq_pyq_solutions_mapping_id (unique constraint).

create index if not exists idx_pyq_solutions_paper_id
  on public.pyq_solutions (paper_id);

-- Partial index: admin review — all disputed questions in a paper
create index if not exists idx_pyq_solutions_disputed
  on public.pyq_solutions (paper_id)
  where is_disputed = true;

-- 2f. pyq_mock_mappings indexes
-- Note: idx_pyq_mock_mappings_paper_id is covered by
--   uq_pyq_mock_mappings_paper_id (unique constraint).
-- Note: idx_pyq_mock_mappings_test_id is covered by
--   uq_pyq_mock_mappings_test_id (unique constraint).

-- 2g. student_pyq_purchases indexes
create index if not exists idx_student_pyq_purchases_student_active
  on public.student_pyq_purchases (student_id, is_active);

create index if not exists idx_student_pyq_purchases_package_active
  on public.student_pyq_purchases (package_id, is_active);

-- Note: idx_student_pyq_purchases_student_package is covered by
--   uq_student_pyq_purchases_student_package (unique constraint).

-- Partial index: background job — find purchases that have expired
create index if not exists idx_student_pyq_purchases_expires
  on public.student_pyq_purchases (expires_at)
  where expires_at is not null and is_active = true;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — CREATE TRIGGER Statements
-- ════════════════════════════════════════════════════════════════════════════
-- Only tables with an updated_at column receive the set_updated_at trigger.
-- set_updated_at() already exists from Domain 01 — do not recreate.
-- pyq_package_unlocks has no updated_at column (immutable after insert).
-- pyq_question_mappings has no updated_at column (immutable after insert).
-- pyq_mock_mappings has no updated_at column (immutable after insert).

-- 3a. pyq_packages triggers
create trigger trg_pyq_packages_set_updated_at
  before update on public.pyq_packages
  for each row
  execute function public.set_updated_at();

-- 3b. pyq_papers triggers
create trigger trg_pyq_papers_set_updated_at
  before update on public.pyq_papers
  for each row
  execute function public.set_updated_at();

-- 3c. pyq_solutions triggers
create trigger trg_pyq_solutions_set_updated_at
  before update on public.pyq_solutions
  for each row
  execute function public.set_updated_at();

-- 3d. student_pyq_purchases triggers
create trigger trg_student_pyq_purchases_set_updated_at
  before update on public.student_pyq_purchases
  for each row
  execute function public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — COMMENT Statements
-- ════════════════════════════════════════════════════════════════════════════

-- 4za. Cross-table validation notes
-- The schema doc specifies a CHECK constraint on pyq_papers that ensures
-- stream_id matches the parent package's stream_id. This is intentionally
-- NOT implemented as a DB constraint because cross-table CHECK constraints
-- are expensive and can cause locking issues at scale. Validation must be
-- enforced at the application layer (Edge Function) instead.
--
-- TODO — Denormalized count triggers (to be implemented in a dedicated
-- migration after all domains are created):
--
--   pyq_papers (AFTER INSERT OR UPDATE OR DELETE):
--     Recompute pyq_packages.total_papers = COUNT(*) WHERE is_published = TRUE
--     Recompute pyq_packages.year_from = MIN(exam_year)
--     Recompute pyq_packages.year_to = MAX(exam_year)
--
--   pyq_question_mappings (AFTER INSERT OR DELETE):
--     Recompute pyq_papers.total_questions = COUNT(*) as a trigger
--     UPDATE pyq_papers SET total_questions = ... WHERE paper_id = ?
--
-- TODO — FK to order_items.item_id on student_pyq_purchases:
--   Add after Domain 07 (Commerce) migration has been applied.
--   ALTER TABLE student_pyq_purchases ADD CONSTRAINT
--     fk_student_pyq_purchases_order_item
--     FOREIGN KEY (order_item_id) REFERENCES order_items (item_id)
--     ON DELETE SET NULL ON UPDATE RESTRICT;

-- 4a. Table comments
comment on table public.pyq_packages is
  'Top-level sellable unit of PYQ content. Groups one or more PYQ papers '
  'under a single price point and access grant. Students buy a package, '
  'not individual papers. Scoped to one stream per package. Examples: '
  '"NEET 2015–2024 Complete PYQ Bundle", "JEE Mains Physics PYQ 2018–2024".';

comment on table public.pyq_package_unlocks is
  'Explicit enumeration of which asset types a package grants access to. '
  'Values: pdf (downloadable PDF), solutions (answer key PDF), mock_test '
  '(timed mock attempt via Domain 5 engine). New asset types (e.g. '
  'video_solutions, chapter_notes) require only a new unlock_type value, '
  'not a schema migration.';

comment on table public.pyq_papers is
  'One row per official exam paper — a single sitting of an exam in a given '
  'year. Each paper belongs to exactly one pyq_package and one stream. '
  'Supports two independent delivery modes: PDF (via storage paths) and '
  'mock test (via pyq_mock_mappings).';

comment on table public.pyq_question_mappings is
  'Junction table linking pyq_papers to the shared question bank (questions). '
  'Each row records that a specific published question appeared in a PYQ '
  'paper at a specific position. Enables cross-domain chapter frequency '
  'analytics (e.g. "this chapter has appeared in NEET 17 times over 10 years") '
  'without separate PYQ analytics tables.';

comment on table public.pyq_solutions is
  'Per-question, per-paper solution records. One row per (paper_id, question_id) '
  'pair via the mapping_id FK. Stores text explanation, optional video '
  'walkthrough, official answer key value, and dispute tracking. Separate '
  'from question_explanations (Domain 5) which stores the canonical '
  'teacher-authored explanation — PYQ solutions are paper-specific and '
  'may contain exam-context notes.';

comment on table public.pyq_mock_mappings is
  '1:1 junction linking a pyq_paper to a mock_test. Enables the paper to be '
  'attempted as a timed, scored test through the Domain 5 attempt engine. '
  'The mock_test row is fully standard — the attempt engine has no knowledge '
  'of PYQ. Both sides of the 1:1 are enforced via unique constraints.';

comment on table public.student_pyq_purchases is
  'Access-control anchor for the PYQ domain. One row per student per package. '
  'Records that access was granted, not how it was paid for (payment details '
  'live in Domain 7 orders/order_items). Supports purchase, admin_grant, and '
  'subscription access types. Revocation is explicit (is_active = false) '
  'rather than hard delete — purchase history is retained for audit and '
  'refund processing.';

-- 4b. Column comments
comment on column public.pyq_packages.name is
  'Display name shown to students in the store and library. Examples: '
  '"NEET PYQ 2015–2024 Complete Bundle", "JEE Mains Physics 2019–2024".';

comment on column public.pyq_packages.description is
  'Marketing description shown on the package detail page. May include paper '
  'count, year range, what assets are included, and exam-day tips.';

comment on column public.pyq_packages.price is
  'Listed price in the institute''s configured currency. 0.00 for free packages. '
  'Actual transaction amount is recorded in order_items (Domain 7).';

comment on column public.pyq_packages.currency is
  'ISO 4217 currency code. Default INR — the platform''s primary market. '
  'Stored on the package for display; authoritative transaction currency is on orders.';

comment on column public.pyq_packages.thumbnail_path is
  'Supabase Storage path for the package cover image shown in the store. '
  'Signed URL generated dynamically. NULL until uploaded.';

comment on column public.pyq_packages.year_from is
  'Earliest exam year covered by papers in this package. Derived from child '
  'papers but stored here for fast store-listing display.';

comment on column public.pyq_packages.year_to is
  'Latest exam year covered by papers in this package. Same derivation as year_from.';

comment on column public.pyq_packages.total_papers is
  'Denormalized count of published papers in this package. Updated by trigger '
  'on pyq_papers insert/update/delete. Used for store display without a COUNT query.';

comment on column public.pyq_packages.is_active is
  'When FALSE, the package is hidden from the store and no new purchases are '
  'allowed. Existing purchases retain access. Use for sunset/seasonal packages.';

comment on column public.pyq_packages.published_at is
  'UTC timestamp when the package was first made active and available for '
  'purchase. NULL until published.';

comment on column public.pyq_package_unlocks.unlock_type is
  'The asset type unlocked. Values: pdf (downloadable question paper PDF), '
  'solutions (answer key and solution PDF), mock_test (timed mock attempt). '
  'VARCHAR intentionally — new asset types must not require a migration.';

comment on column public.pyq_papers.title is
  'Display title. Examples: "NEET 2023 Official Paper", '
  '"JEE Mains 2022 — January Session 1".';

comment on column public.pyq_papers.exam_year is
  'The calendar year the exam was held. Used for chronological display and '
  'year-range filtering in the store.';

comment on column public.pyq_papers.exam_date is
  'The specific date the exam was held, if known. NULL for older papers where '
  'only the year is available.';

comment on column public.pyq_papers.exam_session is
  'Session or shift identifier for exams held in multiple shifts. Examples: '
  '"January Session 1", "April Session 2", "Morning Shift". NULL for '
  'single-session exams.';

comment on column public.pyq_papers.total_questions is
  'Denormalized count of questions mapped to this paper via '
  'pyq_question_mappings. Updated by trigger.';

comment on column public.pyq_papers.total_marks is
  'Total marks of the official paper. Used for display and for populating '
  'the linked mock_test.total_marks when a mock mapping is created.';

comment on column public.pyq_papers.duration_min is
  'Official exam duration in minutes. Used for display and for the linked '
  'mock_test.duration_min.';

comment on column public.pyq_papers.pdf_storage_bucket is
  'Supabase Storage bucket for the question paper PDF. NULL if no PDF asset '
  'has been uploaded. Paired with pdf_storage_path.';

comment on column public.pyq_papers.pdf_storage_path is
  'Storage path within pdf_storage_bucket. Convention: '
  'pyq/{institute_id}/{package_id}/{paper_id}/paper.pdf. Signed URL '
  'generated dynamically at download time.';

comment on column public.pyq_papers.solution_pdf_storage_bucket is
  'Supabase Storage bucket for the solutions PDF. NULL if no solutions PDF '
  'has been uploaded. Paired with solution_pdf_storage_path.';

comment on column public.pyq_papers.solution_pdf_storage_path is
  'Storage path within solution_pdf_storage_bucket. Convention: '
  'pyq/{institute_id}/{package_id}/{paper_id}/solutions.pdf.';

comment on column public.pyq_papers.is_published is
  'When TRUE, the paper is visible to students who have purchased the '
  'package. When FALSE, it is in preparation (admin can see it, students cannot).';

comment on column public.pyq_papers.published_at is
  'UTC timestamp when this paper was first published. NULL until published.';

comment on column public.pyq_question_mappings.order_sequence is
  'The question''s position within the paper (question number as it appeared '
  'in the official exam). 1-indexed. Used for ordered display in the PDF '
  'viewer and mock test delivery.';

comment on column public.pyq_question_mappings.section_name is
  'Section label if the paper was divided into sections (e.g. Physics, '
  'Chemistry, Biology for NEET; Section A, Section B for JEE). NULL for '
  'single-section papers.';

comment on column public.pyq_question_mappings.official_marks is
  'Marks awarded for a correct answer in the official exam. May differ from '
  'questions.marks (the default). Used when creating the linked mock_test.';

comment on column public.pyq_question_mappings.official_negative_marks is
  'Official negative marks per wrong answer. May differ from '
  'questions.negative_marks. Same use case as official_marks.';

comment on column public.pyq_question_mappings.added_at is
  'UTC timestamp when this mapping was created.';

comment on column public.pyq_solutions.solution_text is
  'Step-by-step solution in plain text or Markdown with LaTeX support. '
  'NULL if a text solution has not been authored yet.';

comment on column public.pyq_solutions.solution_video_url is
  'URL to a video solution walkthrough. May be a Supabase Storage signed '
  'URL path or an external video link. NULL if no video solution.';

comment on column public.pyq_solutions.official_answer is
  'The answer as published in the official answer key (e.g. "(B)", "42", '
  '"True"). Useful for disputed questions where the official key may differ '
  'from the correct answer in the question bank.';

comment on column public.pyq_solutions.is_disputed is
  'When TRUE, the question''s official answer was disputed or corrected '
  'after the exam. Used to display a disclaimer to students.';

comment on column public.pyq_solutions.dispute_note is
  'Explanation of the dispute or official correction. NULL unless '
  'is_disputed = TRUE.';

comment on column public.pyq_mock_mappings.created_by is
  'FK to profiles.profile_id. The admin who created this mapping. NULL for '
  'system-generated mappings.';

comment on column public.student_pyq_purchases.order_item_id is
  'FK to order_items.item_id. The specific order line item that created this '
  'purchase. NULL for admin-granted or subscription-derived access.';

comment on column public.student_pyq_purchases.granted_by is
  'FK to profiles.profile_id. The admin who manually granted this access. '
  'NULL for payment-triggered purchases.';

comment on column public.student_pyq_purchases.access_type is
  'How access was obtained. Values: purchase (paid via order), admin_grant '
  '(manual), subscription (included in active subscription plan). VARCHAR '
  'intentionally — future access models must not require a migration.';

comment on column public.student_pyq_purchases.purchased_at is
  'UTC timestamp when access was granted. For payment-triggered purchases, '
  'this is set when the payment is confirmed, not when the order was placed.';

comment on column public.student_pyq_purchases.expires_at is
  'UTC timestamp when access expires. NULL means perpetual access (typical '
  'for one-time PYQ purchases). Set for time-limited subscription-derived access.';

comment on column public.student_pyq_purchases.is_active is
  'When FALSE, access is revoked. Used for refunds, subscription lapses, or '
  'admin revocation. FALSE does not delete the row — purchase history is retained.';

comment on column public.student_pyq_purchases.revoked_at is
  'UTC timestamp when access was revoked. NULL unless is_active = FALSE.';

comment on column public.student_pyq_purchases.revoked_reason is
  'Reason for revocation. Examples: refund_processed, subscription_lapsed, '
  'admin_revoke. NULL unless is_active = FALSE.';

-- 4c. Constraint comments
comment on constraint ck_pyq_packages_year_range on public.pyq_packages is
  'Prevents data entry errors where the year range is inverted '
  '(year_from > year_to).';

comment on constraint ck_pyq_packages_active_published on public.pyq_packages is
  'A package cannot become active (is_active = TRUE) without a publication '
  'timestamp. Allows is_active = FALSE with NULL published_at for packages '
  'configured but never published.';

comment on constraint uq_pyq_package_unlocks_package_type on public.pyq_package_unlocks is
  'A package can unlock each asset type at most once. Prevents duplicate '
  'unlock rows from concurrent admin edits.';

comment on constraint ck_pyq_papers_pdf_storage on public.pyq_papers is
  'PDF storage bucket and path must be either both NULL or both set. '
  'Consistent with the paired storage pattern used across all domains.';

comment on constraint ck_pyq_papers_solution_pdf_storage on public.pyq_papers is
  'Solution PDF storage bucket and path must be either both NULL or both set.';

comment on constraint ck_pyq_papers_published on public.pyq_papers is
  'published_at must be set when and only when is_published = TRUE. '
  'Prevents half-written publish states.';

comment on constraint uq_pyq_question_mappings_paper_question on public.pyq_question_mappings is
  'A question may appear at most once per paper. Prevents duplicate mappings.';

comment on constraint uq_pyq_question_mappings_paper_sequence on public.pyq_question_mappings is
  'No two questions in the same paper share the same position number. '
  'Enforces correct ordering.';

comment on constraint uq_pyq_solutions_mapping_id on public.pyq_solutions is
  'Enforces one solution per (paper, question) pair via the mapping_id '
  'reference. More precise than UNIQUE (paper_id, question_id) because it '
  'also validates the mapping exists.';

comment on constraint ck_pyq_solutions_content on public.pyq_solutions is
  'A solution row must always carry substantive content — either text, a '
  'video, or a dispute flag. Empty solution rows are not permitted.';

comment on constraint ck_pyq_solutions_dispute on public.pyq_solutions is
  'dispute_note must always be accompanied by is_disputed = TRUE. Prevents '
  'orphaned dispute notes.';

comment on constraint uq_pyq_mock_mappings_paper_id on public.pyq_mock_mappings is
  'One paper maps to at most one mock test. Enforces the 1:1 relationship '
  'from the paper side.';

comment on constraint uq_pyq_mock_mappings_test_id on public.pyq_mock_mappings is
  'One mock test is the delivery mechanism for at most one paper. Prevents '
  'a mock_test row from being shared across two papers.';

comment on constraint uq_student_pyq_purchases_student_package on public.student_pyq_purchases is
  'One purchase record per student per package. Multiple purchases of the '
  'same package (e.g. re-purchase after refund) update the existing row '
  'rather than inserting a new one. Prevents duplicate access records.';

comment on constraint ck_student_pyq_purchases_revocation on public.student_pyq_purchases is
  'revoked_at and revoked_reason must be set together when and only when '
  'is_active = FALSE. Prevents half-written revocation states.';

comment on constraint ck_student_pyq_purchases_expires on public.student_pyq_purchases is
  'Expiry timestamp must always be after the purchase timestamp. Prevents '
  'data entry errors where a purchase expires before it was granted.';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — Domain 06 PYQ (Previous Year Questions)
-- ════════════════════════════════════════════════════════════════════════════
