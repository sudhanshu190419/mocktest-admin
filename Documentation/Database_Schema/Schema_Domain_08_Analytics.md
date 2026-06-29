# EdTech Platform — Database Schema Specification
## Domain 8: Analytics
### Tables: `performance_reports` · `subject_performances` · `chapter_performances` · `progress_history` · `teacher_analytics`

**Document version:** 1.0
**ERD reference:** ERD v2.0 (Relationships R51–R55; P9, P12 from Change Log)
**PostgreSQL target:** 16
**Supabase compatibility:** Yes
**Domain sequence:** Phase 8 of 15

---

## Domain Overview

The Analytics domain is the intelligence layer of the platform. It answers the two most commercially critical questions the product must answer:

- **For students:** "How am I performing, and what should I do next?"
- **For teachers:** "How are my students doing, and am I effective?"

This domain is deliberately a **read-optimised reporting layer**, not a live transactional system. All tables here are either computed on a schedule (nightly background jobs) or are append-only event logs. No row in this domain is ever updated in response to a real-time student action. The source data lives in the Mock Test Engine (Domain 9), the Live Learning domain, and the Question Bank. Analytics tables are downstream consumers of that data.

**Tables in this domain (in dependency order):**

| # | Table | Role | Write Pattern |
|---|-------|------|---------------|
| 1 | `performance_reports` | One aggregated report per student per generation cycle | Overwritten nightly by background job |
| 2 | `subject_performances` | Subject-level score breakdown per report | Overwritten with parent report |
| 3 | `chapter_performances` | Chapter-level score breakdown per report | Overwritten with parent report |
| 4 | `progress_history` | Append-only score timeline per student per test attempt | INSERT only — never UPDATE |
| 5 | `teacher_analytics` | One aggregated dashboard row per teacher | Overwritten nightly by background job |

---

## Key Architectural Principles for This Domain

**1. Read model, not source of truth.** These tables are materialised summaries. The raw data is in `mock_attempts`, `mock_answers`, `attendance`, and `live_classes`. If the analytics tables were dropped and rebuilt from scratch, no data would be lost. This distinction is critical — it means schema changes here do not require the same caution as transactional tables.

**2. No live calculation on read.** At hundreds of thousands of students, calculating percentiles, chapter scores, and rank on every API call is not viable. Pre-compute on a schedule. All student-facing analytics endpoints read from this domain, not from raw attempt data.

**3. `progress_history` is the one exception.** Unlike the computed tables, `progress_history` is an event-sourced append-only log. A row is written immediately after each mock attempt is evaluated. It is the foundation for trend charts (score over time) and must never be modified after insertion.

**4. `teacher_analytics` is a singleton per teacher.** One row per teacher, refreshed nightly. Not a history table — use `progress_history` on the student side for trend data. Teacher-level trend analytics (if required in future) would be a separate table.

---

## Enum Types Referenced

These enums are defined globally (see Domain 1 — Pre-Domain Notes).

| Enum Name | Values | Used By |
|-----------|--------|---------|
| *(none new)* | — | All columns use standard PostgreSQL types or types defined below |

---

## New Enum Types Defined in This Domain

| Enum Name | Values | Used By | Reason |
|-----------|--------|---------|--------|
| `report_period_type` | `weekly`, `monthly`, `all_time` | `performance_reports.period_type` | Defines the time window over which the report was computed. Allows the system to generate and store multiple report windows per student simultaneously without ambiguity |

---

## Table 1: `performance_reports`

### Purpose

Stores one aggregated performance snapshot per student per reporting period. This is the top-level analytics entity — the "report card" that drives the student dashboard.

A student may have multiple rows in this table, one per `period_type` (weekly, monthly, all-time). The background job overwrites (DELETE + INSERT, or UPSERT) the row for each period on each run. This means the table always contains the most recent computed report for each period — it is not a history of report generations.

Fields like `weak_chapters`, `strong_chapters`, and `suggested_tests` are stored as `UUID[]` arrays. These are arrays of foreign key references to `chapters.chapter_id` and `mock_tests.test_id`. Storing them as arrays (not junction rows) is an intentional denormalisation — analytics read models prioritise query simplicity over perfect normalisation.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `report_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `student_id` | `UUID` | NOT NULL | — | FK → `student_details.student_id`. The student this report belongs to |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS and per-institute analytics aggregation |
| `period_type` | `report_period_type` | NOT NULL | — | Enum: `weekly`, `monthly`, `all_time`. One report row per student per period type |
| `period_start` | `DATE` | NULL | `NULL` | Inclusive start date of the reporting window. NULL for `all_time` reports |
| `period_end` | `DATE` | NULL | `NULL` | Inclusive end date of the reporting window. NULL for `all_time` reports |
| `total_tests_attempted` | `SMALLINT` | NOT NULL | `0` | Number of mock tests the student attempted in this period |
| `total_questions_attempted` | `INTEGER` | NOT NULL | `0` | Total questions answered across all tests in this period |
| `total_correct` | `INTEGER` | NOT NULL | `0` | Total correct answers in this period |
| `total_incorrect` | `INTEGER` | NOT NULL | `0` | Total incorrect answers (including negative-marking penalties) in this period |
| `total_skipped` | `INTEGER` | NOT NULL | `0` | Total questions skipped (unattempted) in this period |
| `overall_score` | `NUMERIC(6, 2)` | NOT NULL | `0.00` | Weighted aggregate score across all tests in the period. Scale is test-dependent; stored as a normalised percentage (0.00–100.00) for cross-test comparability |
| `overall_accuracy` | `NUMERIC(5, 2)` | NOT NULL | `0.00` | `(total_correct / total_questions_attempted) * 100`. Stored as percentage. NULL-safe: 0.00 when no questions attempted |
| `rank` | `INTEGER` | NULL | `NULL` | Student's rank within their institute for this period. Computed across all students in the same institute and stream. NULL if fewer than 2 students have data |
| `percentile` | `NUMERIC(5, 2)` | NULL | `NULL` | Percentile score (0.00–100.00) within the institute and stream. NULL if insufficient cohort data |
| `avg_time_per_question` | `NUMERIC(8, 2)` | NULL | `NULL` | Average time in seconds spent per question across all attempts in the period. Derived from `mock_attempts.time_taken_seconds / questions_attempted` |
| `weak_chapters` | `UUID[]` | NOT NULL | `'{}'` | Array of `chapter_id` values where the student scored below a configured threshold (e.g., < 40% accuracy). Used by the frontend recommendation engine. Empty array when no weak chapters detected |
| `strong_chapters` | `UUID[]` | NOT NULL | `'{}'` | Array of `chapter_id` values where the student scored above a configured threshold (e.g., > 80% accuracy). Empty array when no strong chapters detected |
| `suggested_tests` | `UUID[]` | NOT NULL | `'{}'` | Array of `mock_test_id` values recommended for the student based on weak chapter analysis. Populated by the recommendation algorithm in the background job. Empty array when no suggestions available |
| `generated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Timestamp when this report row was last computed and written. Always UTC. Displayed to students as "Last updated" |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Row creation timestamp. Always UTC |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Last modification timestamp. Trigger-maintained. Updated on each nightly UPSERT |

---

### Primary Key

```
PRIMARY KEY (report_id)
```

---

### Foreign Keys

```
student_id   → student_details.student_id   ON DELETE RESTRICT   ON UPDATE RESTRICT
institute_id → institutes.institute_id       ON DELETE RESTRICT   ON UPDATE RESTRICT
```

> **Array FK note:** `weak_chapters`, `strong_chapters`, and `suggested_tests` store UUID arrays that logically reference `chapters.chapter_id` and `mock_tests.test_id`. PostgreSQL does not natively enforce FK constraints on array elements. This is an accepted denormalisation for read models. Referential integrity for these arrays is the responsibility of the background job that writes them — it must only write IDs that currently exist.

---

### Composite Keys

None. `report_id` is the sole primary key. The natural candidate `(student_id, period_type)` is enforced via a unique constraint below, not as a composite PK, to keep FK references to this table simple.

---

### Unique Constraints

```
UNIQUE (student_id, period_type)
```

> Enforces that exactly one current report exists per student per period type. The background job uses this constraint as the target of its UPSERT (`ON CONFLICT (student_id, period_type) DO UPDATE`).

---

### CHECK Constraints

```
CHECK (total_tests_attempted >= 0)
CHECK (total_questions_attempted >= 0)
CHECK (total_correct >= 0)
CHECK (total_incorrect >= 0)
CHECK (total_skipped >= 0)
CHECK (total_correct + total_incorrect + total_skipped <= total_questions_attempted)
CHECK (overall_score >= 0.00 AND overall_score <= 100.00)
CHECK (overall_accuracy >= 0.00 AND overall_accuracy <= 100.00)
CHECK (rank IS NULL OR rank >= 1)
CHECK (percentile IS NULL OR (percentile >= 0.00 AND percentile <= 100.00))
CHECK (avg_time_per_question IS NULL OR avg_time_per_question >= 0)
CHECK (
  (period_type = 'all_time' AND period_start IS NULL AND period_end IS NULL)
  OR
  (period_type != 'all_time' AND period_start IS NOT NULL AND period_end IS NOT NULL AND period_end >= period_start)
)
```

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_perf_reports_student_period` | `(student_id, period_type)` | B-tree (covered by UNIQUE) | Already covered |
| `idx_perf_reports_institute_rank` | `(institute_id, period_type, rank ASC NULLS LAST)` | B-tree | Institute-wide leaderboard queries sorted by rank |
| `idx_perf_reports_institute_percentile` | `(institute_id, period_type, percentile DESC NULLS LAST)` | B-tree | Top-percentile student identification per institute per period |
| `idx_perf_reports_institute_generated_at` | `(institute_id, generated_at DESC)` | B-tree | Admin: confirm all reports refreshed after last job run |
| `idx_perf_reports_weak_chapters` | `USING GIN (weak_chapters)` | GIN | Array containment queries: `WHERE weak_chapters @> ARRAY['chapter_uuid']` — find all students weak in a specific chapter |
| `idx_perf_reports_suggested_tests` | `USING GIN (suggested_tests)` | GIN | Array containment: find all students recommended a specific test |

> **GIN index rationale:** B-tree indexes cannot accelerate array containment operators (`@>`, `&&`). The GIN indexes on `weak_chapters` and `suggested_tests` enable efficient queries like "which students are weak in Chapter X?" — a key input for targeted remedial content assignment by teachers and admins.

---

### Soft Delete Strategy

`performance_reports` rows are overwritten on each job run (UPSERT), not accumulated. There is no soft delete. A student's report always reflects the most recent computation. If a student has no attempts in a period, their report row shows zeroes — it is not deleted.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `updated_at` | ✅ | Trigger-maintained; shows when the row was last overwritten |
| `generated_at` | ✅ | Business-level timestamp: when the computation completed (may differ from `updated_at` by milliseconds; kept separate for clarity and display) |
| `created_by` | ❌ | Always the background job (service_role). No meaningful user attribution |
| `updated_by` | ❌ | Same reason |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE performance_report | `CASCADE` to `subject_performances`, `chapter_performances` | Child breakdown rows are meaningless without the parent report. Cascade delete is correct here — both are computed and can be regenerated |
| DELETE student | `RESTRICT` | Student data must be retained even if analytics are stale |
| UPDATE report_id | `RESTRICT` | PK must not change |

---

### Supabase RLS Considerations

```
Table: performance_reports
RLS: ENABLED

SELECT:
  - Students may read their own reports only.
    USING: student_id = (
      SELECT student_id FROM student_details WHERE profile_id = auth.uid()
    )

  - Teachers may read performance_reports for students in their batches.
    USING: institute_id = get_my_institute_id()
      AND student_id IN (
        SELECT bs.student_id FROM batch_students bs
        INNER JOIN batch_teachers bt ON bs.batch_id = bt.batch_id
        WHERE bt.teacher_id = (
          SELECT teacher_id FROM teacher_details WHERE profile_id = auth.uid()
        )
      )
    (This subquery is acceptable given nightly-refresh semantics — not executed on every
     transaction. Consider a Postgres function wrapper if the planner struggles.)

  - Admins may read all performance_reports within their institute.
    USING: institute_id = get_my_institute_id()
      AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')

INSERT / UPDATE:
  - Blocked for all authenticated client roles.
  - Written exclusively by the background job using service_role.

DELETE:
  - Blocked for all client roles.
  - The background job may DELETE + INSERT (or UPSERT) using service_role.
```

---

### Backend Developer Notes

1. **UPSERT is the correct write pattern.** The background job should use `INSERT INTO performance_reports (...) ON CONFLICT (student_id, period_type) DO UPDATE SET ...`. This is atomic and avoids DELETE + INSERT transaction complexity. All child rows (`subject_performances`, `chapter_performances`) must be deleted and re-inserted within the same transaction, since CASCADE DELETE on the parent report will handle cleanup.

2. **`weak_chapters` threshold is configurable, not hardcoded.** The accuracy threshold below which a chapter is classified as "weak" (e.g., 40%) should be stored in `system_settings` (Domain 15), not hardcoded in the background job. This allows institutes to tune the sensitivity of the recommendation engine without a code deployment.

3. **Rank computation.** `rank` is computed as `RANK() OVER (PARTITION BY institute_id, period_type ORDER BY overall_score DESC)` across all students in the institute with at least one test attempt. Students with zero attempts receive `rank = NULL`. Use `DENSE_RANK()` if the institute prefers no gaps in rank sequence.

4. **`overall_score` normalisation.** Mock tests have different total marks (100, 200, 360). Before aggregating across tests, normalise each attempt score to a percentage: `(raw_score / max_score) * 100`. Average the normalised percentages, weighted by `total_questions_attempted` in each test, to produce `overall_score`. Document this formula in the background job code — it is a business rule, not a technical detail.

5. **`suggested_tests` array size limit.** Cap `suggested_tests` at 5 entries in the background job. The frontend will display at most 3 recommended tests. Storing more than 5 wastes storage and complicates frontend logic.

6. **Do not query raw attempt tables from the API.** All student-facing analytics endpoints must read from `performance_reports`, `subject_performances`, and `chapter_performances`. Never join to `mock_attempts` or `mock_answers` on a student dashboard request — those tables will have billions of rows.

---

## Table 2: `subject_performances`

### Purpose

Stores the subject-level breakdown of a `performance_report`. For each report, one row exists per subject in which the student has attempted at least one question during the report period.

This table exists to power the per-subject bar chart / breakdown section of the student dashboard. It answers: "Within this period, how did the student perform in Physics vs Chemistry vs Biology?"

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `subject_perf_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `report_id` | `UUID` | NOT NULL | — | FK → `performance_reports.report_id`. Parent report |
| `student_id` | `UUID` | NOT NULL | — | FK → `student_details.student_id`. Denormalized to allow direct student-scoped queries without joining through the parent report |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS |
| `subject_id` | `UUID` | NOT NULL | — | FK → `subjects.subject_id`. The subject this row measures |
| `questions_attempted` | `SMALLINT` | NOT NULL | `0` | Number of questions from this subject attempted in the period |
| `correct` | `SMALLINT` | NOT NULL | `0` | Correct answers in this subject |
| `incorrect` | `SMALLINT` | NOT NULL | `0` | Incorrect answers in this subject |
| `skipped` | `SMALLINT` | NOT NULL | `0` | Skipped questions in this subject |
| `score` | `NUMERIC(6, 2)` | NOT NULL | `0.00` | Normalised score for this subject (0.00–100.00) |
| `accuracy` | `NUMERIC(5, 2)` | NOT NULL | `0.00` | `(correct / questions_attempted) * 100`. 0.00 when `questions_attempted = 0` |
| `avg_time_per_question` | `NUMERIC(8, 2)` | NULL | `NULL` | Average seconds per question for this subject. NULL when questions_attempted = 0 |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Row creation timestamp |

---

### Primary Key

```
PRIMARY KEY (subject_perf_id)
```

---

### Foreign Keys

```
report_id    → performance_reports.report_id   ON DELETE CASCADE    ON UPDATE RESTRICT
student_id   → student_details.student_id      ON DELETE RESTRICT   ON UPDATE RESTRICT
institute_id → institutes.institute_id          ON DELETE RESTRICT   ON UPDATE RESTRICT
subject_id   → subjects.subject_id             ON DELETE RESTRICT   ON UPDATE RESTRICT
```

> **`ON DELETE CASCADE` on `report_id`:** When the parent `performance_report` is deleted (during a nightly UPSERT cycle), all child `subject_performances` rows cascade-delete automatically. This is correct — they are derived data.

---

### Composite Keys

None. `subject_perf_id` is the sole primary key.

---

### Unique Constraints

```
UNIQUE (report_id, subject_id)
```

> Ensures one subject breakdown row per subject per report. The background job uses this for its UPSERT target.

---

### CHECK Constraints

```
CHECK (questions_attempted >= 0)
CHECK (correct >= 0)
CHECK (incorrect >= 0)
CHECK (skipped >= 0)
CHECK (correct + incorrect + skipped <= questions_attempted)
CHECK (score >= 0.00 AND score <= 100.00)
CHECK (accuracy >= 0.00 AND accuracy <= 100.00)
CHECK (avg_time_per_question IS NULL OR avg_time_per_question >= 0)
```

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_subject_perf_report_id` | `(report_id)` | B-tree | Fetch all subject rows for a given report (primary access pattern) |
| `idx_subject_perf_student_subject` | `(student_id, subject_id)` | B-tree | Student's history across subjects across all their reports |
| `idx_subject_perf_institute_subject_score` | `(institute_id, subject_id, score DESC)` | B-tree | Institute-level subject leaderboards; top scorers per subject |

---

### Soft Delete Strategy

None. Child rows are deleted via CASCADE when the parent report is regenerated. Append-only historical subject performance is tracked via `progress_history`, not this table.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `updated_at` | ❌ | Rows are deleted and recreated on each report cycle, not updated in place |
| `created_by` | ❌ | Always the background job |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE subject_perf | `RESTRICT` (no downstream FKs) | No tables reference this table |
| DELETE parent report | `CASCADE` | Derived data; automatically cleaned up |
| DELETE subject | `RESTRICT` | Cannot delete a subject that has performance data |
| UPDATE subject_perf_id | `RESTRICT` | PK must not change |

---

### Supabase RLS Considerations

```
Table: subject_performances
RLS: ENABLED

SELECT:
  - Students may read their own subject performance rows.
    USING: student_id = (
      SELECT student_id FROM student_details WHERE profile_id = auth.uid()
    )

  - Teachers may read subject performances for their batch students.
    USING: institute_id = get_my_institute_id()
      AND student_id IN (
        SELECT bs.student_id FROM batch_students bs
        INNER JOIN batch_teachers bt ON bs.batch_id = bt.batch_id
        WHERE bt.teacher_id = (
          SELECT teacher_id FROM teacher_details WHERE profile_id = auth.uid()
        )
      )

  - Admins may read all rows within their institute.
    USING: institute_id = get_my_institute_id()
      AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')

INSERT / UPDATE / DELETE:
  - Blocked for all client roles. Background job only (service_role).
```

---

### Backend Developer Notes

1. **Rows are recreated, not updated.** The correct write pattern for `subject_performances` on each job cycle is: delete all existing rows for `report_id` (handled by CASCADE on the parent report UPSERT), then bulk-insert the new rows in a single `INSERT INTO ... VALUES (...)` statement. Do not UPDATE existing rows — the cascade + re-insert pattern is simpler and avoids partial-update anomalies.

2. **Only include subjects with attempts.** Do not insert a row for a subject where `questions_attempted = 0`. The frontend should treat the absence of a row as "no data" rather than rendering a zero-score entry. This keeps the table lean.

3. **`accuracy` formula is NULL-safe at the job level.** Compute `accuracy` as `CASE WHEN questions_attempted = 0 THEN 0.00 ELSE (correct::NUMERIC / questions_attempted) * 100 END` in the background job SQL before writing. Do not store NULL for accuracy — store 0.00. This avoids NULL-handling complexity in every downstream query.

---

## Table 3: `chapter_performances`

### Purpose

Stores the chapter-level breakdown of a `performance_report`. More granular than `subject_performances` — one row per chapter per report. Powers the chapter-level drill-down view on the student dashboard and directly feeds the `weak_chapters` and `strong_chapters` arrays on the parent report.

This is typically the most-read analytics table per student session: the student dashboard renders the chapter breakdown prominently for targeted revision guidance.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `chapter_perf_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `report_id` | `UUID` | NOT NULL | — | FK → `performance_reports.report_id`. Parent report |
| `student_id` | `UUID` | NOT NULL | — | FK → `student_details.student_id`. Denormalized for direct student-scoped queries |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS |
| `subject_id` | `UUID` | NOT NULL | — | FK → `subjects.subject_id`. Denormalized — the chapter's parent subject — to enable subject-chapter filtering without an extra join |
| `chapter_id` | `UUID` | NOT NULL | — | FK → `chapters.chapter_id`. The chapter this row measures |
| `questions_attempted` | `SMALLINT` | NOT NULL | `0` | Questions from this chapter attempted in the period |
| `correct` | `SMALLINT` | NOT NULL | `0` | Correct answers for this chapter |
| `incorrect` | `SMALLINT` | NOT NULL | `0` | Incorrect answers for this chapter |
| `skipped` | `SMALLINT` | NOT NULL | `0` | Skipped questions for this chapter |
| `score` | `NUMERIC(6, 2)` | NOT NULL | `0.00` | Normalised score for this chapter (0.00–100.00) |
| `accuracy` | `NUMERIC(5, 2)` | NOT NULL | `0.00` | `(correct / questions_attempted) * 100`. 0.00 when no questions attempted |
| `avg_time_per_question` | `NUMERIC(8, 2)` | NULL | `NULL` | Average time in seconds per question for this chapter. NULL when `questions_attempted = 0` |
| `is_weak` | `BOOLEAN` | NOT NULL | `FALSE` | TRUE if `accuracy` is below the configured weak threshold. Pre-computed flag to avoid threshold logic in every query. Synced with `performance_reports.weak_chapters` array |
| `is_strong` | `BOOLEAN` | NOT NULL | `FALSE` | TRUE if `accuracy` is above the configured strong threshold. Synced with `performance_reports.strong_chapters` array |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Row creation timestamp |

---

### Primary Key

```
PRIMARY KEY (chapter_perf_id)
```

---

### Foreign Keys

```
report_id    → performance_reports.report_id   ON DELETE CASCADE    ON UPDATE RESTRICT
student_id   → student_details.student_id      ON DELETE RESTRICT   ON UPDATE RESTRICT
institute_id → institutes.institute_id          ON DELETE RESTRICT   ON UPDATE RESTRICT
subject_id   → subjects.subject_id             ON DELETE RESTRICT   ON UPDATE RESTRICT
chapter_id   → chapters.chapter_id             ON DELETE RESTRICT   ON UPDATE RESTRICT
```

---

### Composite Keys

None.

---

### Unique Constraints

```
UNIQUE (report_id, chapter_id)
```

> One chapter breakdown row per chapter per report. Background job UPSERT target.

---

### CHECK Constraints

```
CHECK (questions_attempted >= 0)
CHECK (correct >= 0)
CHECK (incorrect >= 0)
CHECK (skipped >= 0)
CHECK (correct + incorrect + skipped <= questions_attempted)
CHECK (score >= 0.00 AND score <= 100.00)
CHECK (accuracy >= 0.00 AND accuracy <= 100.00)
CHECK (avg_time_per_question IS NULL OR avg_time_per_question >= 0)
-- is_weak and is_strong cannot both be true simultaneously
CHECK (NOT (is_weak = TRUE AND is_strong = TRUE))
```

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_chapter_perf_report_id` | `(report_id)` | B-tree | Fetch all chapter rows for a report (primary access pattern) |
| `idx_chapter_perf_student_chapter` | `(student_id, chapter_id)` | B-tree | Track one student's history across a specific chapter across all reports |
| `idx_chapter_perf_institute_chapter_weak` | `(institute_id, chapter_id)` | B-tree | Partial: `WHERE is_weak = TRUE`. Admin/teacher query: "How many students are weak in Chapter X?" |
| `idx_chapter_perf_subject_accuracy` | `(subject_id, accuracy DESC)` | B-tree | Subject-level chapter ranking for teacher dashboard: weakest chapters within a subject |

---

### Soft Delete Strategy

None. Same as `subject_performances` — rows cascade-delete when the parent report is regenerated.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `updated_at` | ❌ | Rows deleted and recreated each cycle |
| `created_by` | ❌ | Always the background job |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE chapter_perf | No downstream FKs | Safe to delete |
| DELETE parent report | `CASCADE` | Derived data |
| DELETE chapter | `RESTRICT` | Cannot delete a chapter with performance history |
| UPDATE chapter_perf_id | `RESTRICT` | PK must not change |

---

### Supabase RLS Considerations

```
Table: chapter_performances
RLS: ENABLED

SELECT:
  - Students may read their own chapter performance rows.
    USING: student_id = (
      SELECT student_id FROM student_details WHERE profile_id = auth.uid()
    )

  - Teachers may read chapter performances for their batch students.
    USING: institute_id = get_my_institute_id()
      AND student_id IN (
        SELECT bs.student_id FROM batch_students bs
        INNER JOIN batch_teachers bt ON bs.batch_id = bt.batch_id
        WHERE bt.teacher_id = (
          SELECT teacher_id FROM teacher_details WHERE profile_id = auth.uid()
        )
      )

  - Admins may read all rows within their institute.
    USING: institute_id = get_my_institute_id()
      AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')

INSERT / UPDATE / DELETE:
  - Blocked for all client roles. Background job only (service_role).
```

---

### Backend Developer Notes

1. **`is_weak` / `is_strong` flags are redundant by design.** They duplicate what can be derived from `accuracy` vs the configured threshold. They exist purely as query-time conveniences — boolean columns filter faster than range conditions on NUMERIC, especially at scale. Keep them in sync with `performance_reports.weak_chapters` and `strong_chapters` arrays. If the threshold configuration changes, a recomputation job must regenerate both.

2. **`subject_id` denormalization.** The `subject_id` column on `chapter_performances` is deliberately denormalized from `chapters.subject_id`. It enables the query "show me all chapter breakdowns for Physics in this report" without joining through `chapters`. At analytics read volume this join savings is meaningful.

3. **Volume awareness.** A student in a full-year coaching programme may attempt questions across 60+ chapters. For an institute with 50,000 active students and 3 report periods, `chapter_performances` could hold 50,000 × 3 × 60 = 9,000,000 rows. The `idx_chapter_perf_report_id` index is essential. Monitor table bloat after each nightly job run.

---

## Table 4: `progress_history`

### Purpose

An append-only event log recording a student's score and rank immediately after each mock test attempt is evaluated. Unlike the computed report tables above, `progress_history` is written in near real-time — one row is inserted when a `mock_attempt` transitions to `submitted` and its result is calculated.

This table is the foundation for trend charts on the student dashboard: "Your score over the last 10 tests", "Your rank trend this month". It is also the source data from which the background job computes `performance_reports`.

**This table is immutable after INSERT. No row is ever updated or deleted.** This is an architectural invariant enforced at the RLS layer and documented here so no future developer accidentally adds an UPDATE path.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `history_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `student_id` | `UUID` | NOT NULL | — | FK → `student_details.student_id`. The student who attempted the test |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS and institute-level trend aggregation |
| `test_id` | `UUID` | NOT NULL | — | FK → `mock_tests.mock_test_id`. The test that was attempted |
| `attempt_id` | `UUID` | NOT NULL | — | FK → `mock_attempts.attempt_id`. The specific attempt that produced this record. Enables joining back to full attempt detail if needed |
| `score` | `NUMERIC(8, 2)` | NOT NULL | — | Raw score achieved in this attempt (not normalised — stored in the test's own scoring unit for fidelity). Use `performance_reports.overall_score` for normalised cross-test comparisons |
| `max_score` | `NUMERIC(8, 2)` | NOT NULL | — | Maximum possible score for this test at the time of the attempt. Stored as a snapshot — the test's max_score could theoretically change if questions are removed post-publication |
| `percentage` | `NUMERIC(5, 2)` | NOT NULL | — | `(score / max_score) * 100`. Computed and stored on INSERT for trend chart rendering without recalculation. Range: 0.00–100.00 |
| `rank` | `INTEGER` | NULL | `NULL` | Student's rank within their institute on this specific test at the time of result generation. May be NULL immediately after submission and backfilled once all students have submitted (for live competitions); NULL for solo practice tests |
| `total_questions` | `SMALLINT` | NOT NULL | — | Total questions in the test at time of attempt. Snapshot |
| `correct` | `SMALLINT` | NOT NULL | `0` | Correct answers in this attempt |
| `incorrect` | `SMALLINT` | NOT NULL | `0` | Incorrect answers in this attempt |
| `skipped` | `SMALLINT` | NOT NULL | `0` | Skipped questions in this attempt |
| `time_taken_seconds` | `INTEGER` | NULL | `NULL` | Total time taken for the attempt in seconds. NULL if the student abandoned the attempt without submitting |
| `recorded_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Timestamp when this history row was written (immediately after result calculation). Always UTC |

---

### Primary Key

```
PRIMARY KEY (history_id)
```

---

### Foreign Keys

```
student_id   → student_details.student_id   ON DELETE RESTRICT   ON UPDATE RESTRICT
institute_id → institutes.institute_id       ON DELETE RESTRICT   ON UPDATE RESTRICT
test_id      → mock_tests.mock_test_id      ON DELETE RESTRICT   ON UPDATE RESTRICT
attempt_id   → mock_attempts.attempt_id     ON DELETE RESTRICT   ON UPDATE RESTRICT
```

> **`RESTRICT` on all FKs.** A `progress_history` row is a permanent academic record — the immutable proof that a student took a test on a given date and scored a given amount. No upstream deletion should cascade into this table.

---

### Composite Keys

None.

---

### Unique Constraints

```
UNIQUE (attempt_id)
```

> One `progress_history` row per attempt. Prevents double-recording if the result calculation job runs twice for the same attempt (idempotency backstop).

---

### CHECK Constraints

```
CHECK (score >= 0)
CHECK (max_score > 0)
CHECK (score <= max_score)
CHECK (percentage >= 0.00 AND percentage <= 100.00)
CHECK (rank IS NULL OR rank >= 1)
CHECK (total_questions > 0)
CHECK (correct >= 0)
CHECK (incorrect >= 0)
CHECK (skipped >= 0)
CHECK (correct + incorrect + skipped <= total_questions)
CHECK (time_taken_seconds IS NULL OR time_taken_seconds >= 0)
```

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_progress_history_student_recorded` | `(student_id, recorded_at DESC)` | B-tree | Student trend chart: most recent N attempts. Primary access pattern |
| `idx_progress_history_student_test` | `(student_id, test_id, recorded_at DESC)` | B-tree | Student's history on a specific test across multiple attempts |
| `idx_progress_history_institute_test_rank` | `(institute_id, test_id, rank ASC NULLS LAST)` | B-tree | Leaderboard for a specific test within an institute |
| `idx_progress_history_attempt_id` | `(attempt_id)` | B-tree (covered by UNIQUE) | Already covered |
| `idx_progress_history_institute_recorded` | `(institute_id, recorded_at DESC)` | B-tree | Institute-wide activity feed; admin overview of recent test completions |

> **Partitioning future note:** `progress_history` is the fastest-growing table in this domain. At 100K students each taking 20 tests per month, it accumulates 2M rows/month = 24M rows/year. Consider declarative range partitioning by `recorded_at` (monthly) when the table exceeds 20M rows. Design the partition key into your queries from Day 1.

---

### Soft Delete Strategy

**Never soft-delete or hard-delete.** `progress_history` is an academic and audit record. An institute may be asked to prove a student's test history for exam eligibility disputes or regulatory compliance. The correct approach if a record is erroneous is to add a `is_voided BOOLEAN` column in a future amendment (with admin-only SET policy) — not to delete.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `recorded_at` | ✅ | The sole and authoritative timestamp. Doubles as both business event time and audit time — they are the same moment for this table |
| `created_at` | ❌ | `recorded_at` serves this purpose. Adding both would be redundant for an INSERT-only table |
| `updated_at` | ❌ | Immutable table. No updates. Adding this column would imply updates are expected — misleading |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE progress_history | `RESTRICT` | Immutable academic record |
| DELETE student | `RESTRICT` | Student history must be retained |
| DELETE test | `RESTRICT` | Cannot delete a test with attempt history |
| DELETE attempt | `RESTRICT` | Attempt is the source event; must not be deleted while history exists |
| UPDATE history_id | `RESTRICT` | PK must not change |

---

### Supabase RLS Considerations

```
Table: progress_history
RLS: ENABLED

SELECT:
  - Students may read their own progress history.
    USING: student_id = (
      SELECT student_id FROM student_details WHERE profile_id = auth.uid()
    )

  - Teachers may read progress history for students in their batches.
    USING: institute_id = get_my_institute_id()
      AND student_id IN (
        SELECT bs.student_id FROM batch_students bs
        INNER JOIN batch_teachers bt ON bs.batch_id = bt.batch_id
        WHERE bt.teacher_id = (
          SELECT teacher_id FROM teacher_details WHERE profile_id = auth.uid()
        )
      )

  - Admins may read all progress history within their institute.
    USING: institute_id = get_my_institute_id()
      AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')

INSERT:
  - Via Edge Function (service_role) only. Triggered immediately after mock_result is calculated.
    Direct client-side INSERT is blocked.

UPDATE:
  - BLOCKED for ALL roles including admin. This table is immutable.

DELETE:
  - BLOCKED for all roles.
```

> **Immutability note:** The UPDATE block is the most important policy on this table. It must be explicitly stated in the RLS policy, not merely absent — an absent policy defaults to `DENY`, but an explicit `DENY` makes the intent clear to future developers and prevents accidental permissive policy additions.

---

### Backend Developer Notes

1. **Write immediately after result calculation, not after submission.** The `progress_history` row should be inserted inside the same transaction as `mock_results` creation — not in a separate background job. The result and the history record must be atomic. If the result is recorded but the history row fails (or vice versa), the trend chart and the result page would show inconsistent data.

2. **`rank` may be NULL at write time and backfilled.** For competitive tests where all students submit within a window (e.g., a live mock test), the rank cannot be computed until the window closes. Insert the row with `rank = NULL` immediately after the student's result is calculated. The background job computes final ranks after the window closes and updates `rank` via service_role. This is the one permitted UPDATE on this table — rank backfill — and must be a scoped, documented operation.

3. **`percentage` is computed and stored.** Do not rely on the API to compute `(score / max_score) * 100` at read time. Store it on INSERT. The trend chart queries `percentage` from hundreds of rows per student — doing arithmetic on every row at read time is wasteful.

4. **Source for background job.** The nightly `performance_reports` background job queries `progress_history` (filtered by `recorded_at` within the period) to compute `overall_score`, `rank`, `percentile`, and all breakdown metrics. The background job must never query `mock_attempts` or `mock_answers` directly — `progress_history` is the pre-aggregated source for report generation.

5. **Partitioning.** When implementing partitioning, partition by `recorded_at` (not `student_id`). Analytics queries filter by time window far more often than by student. A time-based partition means the nightly background job (which processes the last 7 or 30 days) only scans the relevant partition(s).

---

## Table 5: `teacher_analytics`

### Purpose

Stores the aggregated dashboard metrics for a single teacher. The relationship is 1:1 with `teacher_details` — one row per teacher, refreshed nightly by a background job.

This table powers the teacher dashboard: total students taught, classes conducted, average attendance rate, question bank contribution, and test creation count. It is a singleton — there is no history of how these metrics changed over time (that would require a separate `teacher_analytics_history` table, which is out of scope for v1).

Per the ERD Change Log (P12): this table was introduced in v2 specifically to support the teacher analytics dashboard that was missing from v1.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `analytics_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `teacher_id` | `UUID` | NOT NULL | — | FK → `teacher_details.teacher_id`. The teacher this analytics row belongs to. UNIQUE constraint enforces 1:1 |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS |
| `total_students` | `INTEGER` | NOT NULL | `0` | Total unique students currently enrolled in any active batch taught by this teacher |
| `total_classes_conducted` | `INTEGER` | NOT NULL | `0` | Total live classes conducted by this teacher (status = `completed`) across all time |
| `total_classes_scheduled` | `INTEGER` | NOT NULL | `0` | Total upcoming live classes scheduled by this teacher |
| `avg_attendance_rate` | `NUMERIC(5, 2)` | NOT NULL | `0.00` | Average attendance percentage across all completed live classes conducted by this teacher. Computed as `AVG(actual_attendees / enrolled_students * 100)` per class. Range: 0.00–100.00 |
| `total_content_uploaded` | `INTEGER` | NOT NULL | `0` | Total content items (PDFs, videos, notes, assignments) uploaded by this teacher with status = `approved` |
| `questions_created` | `INTEGER` | NOT NULL | `0` | Total questions created by this teacher with status = `published` |
| `tests_created` | `INTEGER` | NOT NULL | `0` | Total mock tests created by this teacher with status = `published` |
| `avg_student_score` | `NUMERIC(5, 2)` | NULL | `NULL` | Average `percentage` from `progress_history` for all students in this teacher's batches across all tests created by this teacher. NULL if no test data available |
| `top_chapter_id` | `UUID` | NULL | `NULL` | FK → `chapters.chapter_id`. The chapter with the most questions created by this teacher. A quick reference for the dashboard's "Your Specialty" card. NULL if no questions created |
| `last_class_at` | `TIMESTAMPTZ` | NULL | `NULL` | Timestamp of the most recently completed live class conducted by this teacher. NULL if no classes conducted |
| `last_updated` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Timestamp of the last background job refresh. Displayed to teachers as "Last updated" on the dashboard |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Row creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Last modification timestamp. Trigger-maintained |

---

### Primary Key

```
PRIMARY KEY (analytics_id)
```

---

### Foreign Keys

```
teacher_id   → teacher_details.teacher_id   ON DELETE RESTRICT   ON UPDATE RESTRICT
institute_id → institutes.institute_id       ON DELETE RESTRICT   ON UPDATE RESTRICT
top_chapter_id → chapters.chapter_id        ON DELETE SET NULL   ON UPDATE RESTRICT
```

> **`ON DELETE SET NULL` for `top_chapter_id`:** If a chapter is ever deleted (unlikely but possible), the analytics row should not be orphaned or blocked. Silently NULL the reference and let the next nightly job recompute it.

---

### Composite Keys

None.

---

### Unique Constraints

```
UNIQUE (teacher_id)
```

> Enforces the 1:1 relationship. One analytics row per teacher. The background job uses `ON CONFLICT (teacher_id) DO UPDATE` for its UPSERT.

---

### CHECK Constraints

```
CHECK (total_students >= 0)
CHECK (total_classes_conducted >= 0)
CHECK (total_classes_scheduled >= 0)
CHECK (avg_attendance_rate >= 0.00 AND avg_attendance_rate <= 100.00)
CHECK (total_content_uploaded >= 0)
CHECK (questions_created >= 0)
CHECK (tests_created >= 0)
CHECK (avg_student_score IS NULL OR (avg_student_score >= 0.00 AND avg_student_score <= 100.00))
```

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_teacher_analytics_teacher_id` | `(teacher_id)` | B-tree (covered by UNIQUE) | Already covered |
| `idx_teacher_analytics_institute_avg_score` | `(institute_id, avg_student_score DESC NULLS LAST)` | B-tree | Institute admin: rank teachers by average student performance |
| `idx_teacher_analytics_institute_attendance` | `(institute_id, avg_attendance_rate DESC)` | B-tree | Institute admin: rank teachers by class attendance rates |

---

### Soft Delete Strategy

None. When a teacher is deactivated (`profiles.is_active = FALSE`), their `teacher_analytics` row remains for historical record. The background job should skip deactivated teachers when refreshing, so the row becomes stale — this is acceptable. Add a check at the API layer: if `profiles.is_active = FALSE`, do not serve the teacher analytics row to the frontend.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `updated_at` | ✅ | Trigger-maintained |
| `last_updated` | ✅ | Business-level: when the background job last refreshed this row. Distinct from `updated_at` for display purposes |
| `created_by` | ❌ | Always the background job or system |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE teacher_analytics | Safe (no downstream FKs) | — |
| DELETE teacher | `RESTRICT` | Teacher must be deactivated, not deleted |
| UPDATE analytics_id | `RESTRICT` | PK must not change |
| DELETE chapter (top_chapter_id) | `SET NULL` | Graceful degradation; job recomputes next cycle |

---

### Supabase RLS Considerations

```
Table: teacher_analytics
RLS: ENABLED

SELECT:
  - Teachers may read their own analytics row only.
    USING: teacher_id = (
      SELECT teacher_id FROM teacher_details WHERE profile_id = auth.uid()
    )

  - Admins may read all teacher analytics within their institute.
    USING: institute_id = get_my_institute_id()
      AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')

  - Students: no access. Student-facing views of teacher information use
    teacher_details.rating and profiles.name — not this table.

INSERT / UPDATE:
  - Blocked for all client roles. Background job only (service_role).

DELETE:
  - Blocked for all client roles.
```

---

### Backend Developer Notes

1. **Nightly refresh, not real-time.** `teacher_analytics` is computed once per night by a scheduled Edge Function or `pg_cron` job. The `last_updated` timestamp tells teachers when the data was last refreshed. Do not attempt real-time incremental updates — the fan-out of one class attendance event affecting thousands of student records and one teacher's metrics is a batch problem, not a transactional one.

2. **UPSERT pattern.** The background job uses `INSERT INTO teacher_analytics (...) ON CONFLICT (teacher_id) DO UPDATE SET total_students = excluded.total_students, ...`. Create the `teacher_analytics` row when the teacher profile is first created (with all zeroes), so the UPSERT never needs to INSERT on subsequent job runs — it always UPDATEs.

3. **`avg_student_score` computation scope.** This field is specifically the average score of the teacher's *own students* on *the teacher's own tests* — not all tests. The formula is: find all `mock_tests` where `teacher_id = this teacher`, find all `progress_history` rows for students in the teacher's batches for those tests, then `AVG(percentage)`. This is intentionally scoped: it measures teacher impact, not general student performance.

4. **`total_students` counts enrolled, not registered.** Count students currently in active `batch_students` rows for batches where `batch_teachers.teacher_id = this teacher`. Do not count historical students from completed or archived batches — the metric should reflect the teacher's current teaching load.

5. **`top_chapter_id` is a UX convenience, not analytics.** It answers "what is this teacher's primary content area?" for display on the teacher profile card. It is derived from `SELECT chapter_id, COUNT(*) FROM questions WHERE created_by = teacher_id GROUP BY chapter_id ORDER BY COUNT(*) DESC LIMIT 1`. If the teacher has created questions across many chapters evenly, it may change nightly — which is fine.

---

## Domain 8 — Design Decisions Summary

| Decision | Choice | Reason |
|----------|--------|--------|
| Read model architecture | Separate pre-computed tables | At 100K+ users, live analytics calculation on request is not viable. Background jobs write; APIs read |
| `performance_reports` write pattern | UPSERT on `(student_id, period_type)` | Always reflects the current state; no report history accumulation in this table |
| `progress_history` write pattern | Append-only INSERT | Every attempt result is a permanent academic record; never overwritten |
| Array storage for `weak_chapters` / `strong_chapters` / `suggested_tests` | `UUID[]` on `performance_reports` | Denormalisation acceptable for read models; avoids junction tables for dashboard rendering |
| GIN indexes on UUID arrays | Applied to `weak_chapters`, `suggested_tests` | Enables `@>` containment queries ("which students are weak in Chapter X?") that B-tree cannot serve |
| `is_weak` / `is_strong` boolean flags | Added to `chapter_performances` | Pre-computed boolean faster at query time than `accuracy < threshold` comparison; threshold stored in `system_settings` |
| `teacher_analytics` cardinality | 1:1 with teacher, overwritten nightly | Singleton dashboard metric; no history required in v1 |
| `subject_id` denormalized on `chapter_performances` | Added | Avoids join through `chapters` for subject-scoped chapter queries |
| `max_score` snapshot on `progress_history` | Stored on INSERT | Test scoring may change if questions are removed post-publication; snapshot preserves the historical record |
| CASCADE delete from `performance_reports` → children | Applied to `subject_performances`, `chapter_performances` | Both are derived; regenerated on next job cycle |
| RESTRICT on all `progress_history` FKs | Applied | Immutable academic record; no upstream deletion must cascade into it |
| Partitioning | Deferred to future | Recommended when `progress_history` exceeds 20M rows; design queries with `recorded_at` in WHERE clause from Day 1 |

---

## Domain 8 — Relationships to Other Domains

| This Table | References | Via Column | Domain |
|------------|-----------|------------|--------|
| `performance_reports` | `student_details` | `student_id` | Domain 1 (Foundation) |
| `performance_reports` | `institutes` | `institute_id` | Domain 1 (Foundation) |
| `subject_performances` | `performance_reports` | `report_id` | This domain |
| `subject_performances` | `subjects` | `subject_id` | Domain 3 (Academic Structure) |
| `chapter_performances` | `performance_reports` | `report_id` | This domain |
| `chapter_performances` | `chapters` | `chapter_id` | Domain 3 (Academic Structure) |
| `chapter_performances` | `subjects` | `subject_id` | Domain 3 (Academic Structure) |
| `progress_history` | `student_details` | `student_id` | Domain 1 (Foundation) |
| `progress_history` | `mock_tests` | `test_id` | Domain 9 (Mock Test Engine) |
| `progress_history` | `mock_attempts` | `attempt_id` | Domain 9 (Mock Test Engine) |
| `teacher_analytics` | `teacher_details` | `teacher_id` | Domain 1 (Foundation) |
| `teacher_analytics` | `chapters` | `top_chapter_id` | Domain 3 (Academic Structure) |

| This Table | Referenced By | Via Column | Domain |
|------------|--------------|------------|--------|
| `performance_reports` | `audit_logs` | `resource_id` | Domain 15 (Administration) |
| `progress_history` | Background job (reads only) | `student_id`, `test_id` | Background system |

---

## Domain 8 — Entity Relationship Summary (Textual)

```
student_details (1) ───────────────────────────────── (M) performance_reports
                                                               │
                                              ┌────────────────┼────────────────┐
                                              │                                 │
                               (M) subject_performances         (M) chapter_performances

student_details (1) ───────────────────────────────── (M) progress_history
                                                               │
                                              ┌────────────────┘
                                       mock_attempts (1:1 via attempt_id)

teacher_details (1) ──────────────────────────────── (1) teacher_analytics
```

---

*Domain 8 — Analytics is complete.*
*Awaiting your approval before proceeding to the next domain.*
