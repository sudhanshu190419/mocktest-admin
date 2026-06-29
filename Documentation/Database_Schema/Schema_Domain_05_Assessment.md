# EdTech Platform — Database Schema Specification
## Domain 5: Assessment
### Tables: Question · QuestionOption · QuestionExplanation · QuestionImage · MockTest · MockTestQuestion · MockAttempt · MockAnswer · MockAnswerOption · MockResult

**Document version:** 1.0
**ERD reference:** ERD v2.0 (Frozen)
**PostgreSQL target:** 16
**Supabase compatibility:** Yes

---

## Domain Context

Domain 5 covers the entire assessment infrastructure — the question bank, test configuration, and attempt engine that underpin every assessed learning activity on the platform.

The domain splits cleanly into two sub-systems that share the `questions` table as their junction point.

**Question Bank** (`questions`, `question_options`, `question_explanations`, `question_images`) is the content layer. Teachers author questions, admins approve them, and the bank is shared across Mock Tests and PYQ papers. Questions are versioned, stateful, and immutable once they have been used in a submitted attempt.

**Test Engine** (`mock_tests`, `mock_test_questions`, `mock_attempts`, `mock_answers`, `mock_answer_options`, `mock_results`) is the runtime layer. A teacher assembles questions into a test, configures scoring rules, and publishes it. Students take attempts, submit answers, and receive computed results.

The critical design constraint throughout this domain is **immutability of in-flight data**. Once a student starts an attempt, the snapshot of which questions exist, what their options are, and what the correct answers are must be stable — even if a teacher edits the underlying question afterward. This is handled via `mock_test_questions.question_snapshot` (the frozen copy at test-publish time) and `mock_answer_options` (explicit FK to the `question_options` row rather than a serialized string of IDs).

This domain is the highest-write domain in the system after `attendance`. `mock_answers` is updated on every auto-save during an attempt, and `mock_attempts` tracks live timer state. Partition planning is required from day one.

---

## Table 1: `questions`

### Purpose

The central content unit of the assessment system. A `question` row represents a single assessable item: a stem, a type, a difficulty, a chapter/subject mapping, and a lifecycle state. All other question-related tables (`question_options`, `question_explanations`, `question_images`) are children of this table.

Questions are authored by teachers, reviewed by admins, and shared across Mock Tests (`mock_test_questions`) and PYQ papers (`pyq_question_mappings`). A question may appear in hundreds of tests; deleting or mutating it after use is forbidden.

The versioning model is explicit: `version` is an integer incremented on each substantive edit, and `status` drives the approval lifecycle. The `parent_question_id` self-reference allows a revised question to trace lineage back to the original while keeping the old version available for historical attempts.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `question_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS and multi-tenant index isolation. Copied from teacher's institute at insert time |
| `subject_id` | `UUID` | NOT NULL | — | FK → `subjects.subject_id`. Required. Drives subject-level analytics in `MockResult` and `PerformanceReport` |
| `chapter_id` | `UUID` | NOT NULL | — | FK → `chapters.chapter_id`. Required. Drives chapter-level analytics. A question must be mapped to exactly one chapter; cross-chapter questions should use the primary chapter |
| `created_by` | `UUID` | NOT NULL | — | FK → `teacher_details.teacher_id`. The teacher who authored this question version |
| `approved_by` | `UUID` | NULL | `NULL` | FK → `profiles.profile_id`. The admin who approved this question. NULL until approved |
| `parent_question_id` | `UUID` | NULL | `NULL` | Self-referencing FK → `questions.question_id`. NULL for original questions. Set to the previous question's `question_id` when a new version is created. Allows the lineage chain to be traversed |
| `question_type` | `question_type` | NOT NULL | — | PostgreSQL enum: `mcq` (single correct), `msq` (multiple correct), `numerical`, `true_false`. Determines how options are rendered and how `mock_answers` are scored |
| `difficulty` | `difficulty_level` | NOT NULL | — | PostgreSQL enum: `easy`, `medium`, `hard`. Used for test composition analytics and adaptive filtering |
| `status` | `question_status` | NOT NULL | `'draft'` | PostgreSQL enum: `draft`, `pending_approval`, `published`, `archived`. Only `published` questions may be added to a `mock_test`. See state machine in Backend Developer Notes |
| `version` | `INTEGER` | NOT NULL | `1` | Monotonically increasing integer. Starts at 1 for new questions. Incremented each time the stem, options, or explanation is substantively edited. Editing a `draft` or `pending_approval` question increments in place; editing a `published` question creates a new row with `version = old + 1` and `parent_question_id = old question_id` |
| `question_text` | `TEXT` | NOT NULL | — | The question stem in plain text or Markdown. LaTeX math expressions supported via a client-side renderer (e.g. KaTeX). Min length 10 characters enforced at application layer |
| `marks` | `NUMERIC(5,2)` | NOT NULL | `1` | Default marks for this question when added to a test. May be overridden per-test in `mock_test_questions.marks`. Stored here as the canonical default for quick test construction |
| `negative_marks` | `NUMERIC(5,2)` | NOT NULL | `0` | Default negative marks deducted for a wrong answer. May be overridden in `mock_test_questions`. `0` means no negative marking for this question |
| `average_time_seconds` | `INTEGER` | NULL | `NULL` | Computed from `mock_answers.time_spent_seconds` across all attempts. Updated by a nightly analytics job. NULL until sufficient data exists. Used for test-composition time estimation |
| `times_attempted` | `INTEGER` | NOT NULL | `0` | Denormalized count of how many times this question has been answered in a submitted attempt. Updated by the result-generation job. Used for difficulty calibration and "question usage" admin view |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC last-modified timestamp. Trigger-maintained |
| `approved_at` | `TIMESTAMPTZ` | NULL | `NULL` | UTC timestamp when the question was approved. NULL unless `status = 'published'`. Set atomically with the `approved_by` field by the approval Edge Function |

---

### Primary Key

```
PRIMARY KEY (question_id)
```

---

### Foreign Keys

```
institute_id        → institutes.institute_id          ON DELETE RESTRICT   ON UPDATE RESTRICT
subject_id          → subjects.subject_id              ON DELETE RESTRICT   ON UPDATE RESTRICT
chapter_id          → chapters.chapter_id              ON DELETE RESTRICT   ON UPDATE RESTRICT
created_by          → teacher_details.teacher_id       ON DELETE RESTRICT   ON UPDATE RESTRICT
approved_by         → profiles.profile_id              ON DELETE SET NULL   ON UPDATE RESTRICT
parent_question_id  → questions.question_id            ON DELETE RESTRICT   ON UPDATE RESTRICT
```

> `approved_by` uses `SET NULL` on delete. If an admin's profile is deactivated, the question's approval record is preserved; only the actor identity is nulled.

> `parent_question_id` uses `RESTRICT`. The lineage chain must not be broken by deleting a parent version. Use `status = 'archived'` to retire questions.

---

### Unique Constraints

None at the DB level. Teacher + chapter + question_text uniqueness is enforced at the application layer (fuzzy duplicate detection), not via a DB constraint, because question stems may differ by a single word or formatting change.

---

### CHECK Constraints

```sql
CHECK (char_length(question_text) >= 10)
CHECK (version >= 1)
CHECK (marks > 0)
CHECK (negative_marks >= 0)
CHECK (average_time_seconds IS NULL OR average_time_seconds > 0)
CHECK (times_attempted >= 0)
CHECK (
  (status IN ('published') AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
  OR (status NOT IN ('published') AND approved_by IS NULL AND approved_at IS NULL)
)
CHECK (approved_at IS NULL OR approved_at >= created_at)
CHECK (parent_question_id IS NULL OR parent_question_id != question_id)
```

> The approval consistency CHECK ensures `approved_by` and `approved_at` are always set together when and only when the question is `published`. Prevents half-written approval states.

> The self-reference CHECK ensures a question cannot be its own parent.

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_questions_institute_status` | `(institute_id, status)` | B-tree | Question bank browser: all published questions in an institute |
| `idx_questions_chapter_status` | `(chapter_id, status)` | B-tree | Filter published questions by chapter — primary question selection UI |
| `idx_questions_subject_status` | `(subject_id, status)` | B-tree | Subject-level question analytics and test composition by subject |
| `idx_questions_created_by` | `(created_by)` | B-tree | Teacher's "my questions" dashboard |
| `idx_questions_difficulty_status` | `(difficulty, status)` | B-tree | Balanced test composition by difficulty level |
| `idx_questions_type_status` | `(question_type, status)` | B-tree | Filter by question type during test composition |
| `idx_questions_parent` | `(parent_question_id)` WHERE `parent_question_id IS NOT NULL` | Partial B-tree | Version history traversal |

---

### Soft Delete Strategy

`questions` does not use `deleted_at`. Use `status = 'archived'` to retire a question. A question that has been used in a `mock_attempt` (i.e., `times_attempted > 0`) must never be hard-deleted — the attempt history references it. Hard deletion is blocked at the RLS level.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `updated_at` | ✅ | Required; trigger-maintained |
| `approved_at` | ✅ | Business-critical approval timestamp |
| `created_by` | ✅ | Equivalent to authorship — domain-meaningful, not redundant |
| `approved_by` | ✅ | Admin accountability for published content |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE question | `RESTRICT` | Referenced by `mock_test_questions`, `mock_answers`, and `pyq_question_mappings` |
| DELETE chapter | `RESTRICT` | Cannot delete a chapter with questions mapped to it |
| DELETE subject | `RESTRICT` | Cannot delete a subject with questions mapped to it |
| UPDATE question_id | `RESTRICT` | PK must not change |

---

### Supabase RLS Considerations

```
Table: questions
RLS: ENABLED

Policies:

SELECT:
  - Teachers may read all questions they created, regardless of status.
    USING: created_by = (
      SELECT teacher_id FROM teacher_details WHERE profile_id = auth.uid()
    )

  - Teachers may read all published questions within their institute
    (to browse the shared bank when composing a test).
    USING: institute_id = get_my_institute_id()
      AND status = 'published'

  - Admins may read all questions within their institute regardless of status
    (approval review queue).
    USING: institute_id = get_my_institute_id()
      AND (SELECT role FROM profiles WHERE profile_id = auth.uid()) = 'admin'

  - Students may read published questions only when they appear in a test
    the student is actively attempting (via mock_attempts). Direct question
    bank browsing is blocked for students.
    Implementation: Expose questions to students only via the attempt Edge
    Function response; do not grant students a direct SELECT policy on this table.

INSERT:
  - Teachers may create questions within their own institute.
    WITH CHECK: institute_id = get_my_institute_id()
      AND created_by = (
        SELECT teacher_id FROM teacher_details WHERE profile_id = auth.uid()
      )
      AND status IN ('draft', 'pending_approval')

UPDATE:
  - Teachers may update their own questions when status IN ('draft', 'pending_approval').
    Published and archived questions are immutable via teacher action — a new version
    must be created instead.
    USING: created_by = (
      SELECT teacher_id FROM teacher_details WHERE profile_id = auth.uid()
    )
    WITH CHECK: status IN ('draft', 'pending_approval')

  - Admins may update status (approve/reject), approved_by, approved_at.
    USING: institute_id = get_my_institute_id()

DELETE:
  - Blocked at RLS level for all roles. Use status = 'archived'.
```

---

### Backend Developer Notes

1. **Status state machine:** Valid transitions:
   - `draft` → `pending_approval` (teacher submits for review)
   - `pending_approval` → `published` (admin approves)
   - `pending_approval` → `draft` (admin rejects; teacher must revise)
   - `published` → `archived` (admin or teacher retires the question)
   - `draft` → `archived` (teacher discards without submitting)

   All other transitions are invalid. Enforce via a BEFORE UPDATE trigger.

2. **Versioning on edit of published question:** When a teacher edits a `published` question, the flow is:
   - Insert a new `questions` row with `version = old.version + 1`, `parent_question_id = old.question_id`, `status = 'draft'`
   - The old row stays `published` and continues to serve existing tests
   - The new row goes through the approval lifecycle
   - On approval of the new row, the old row is optionally archived

   Never mutate a `published` question row directly. The old version must remain stable for historical `mock_attempt` scoring.

3. **Immutability guard:** A BEFORE UPDATE trigger should block changes to `question_text`, `question_type`, `marks`, and `negative_marks` on any question where `times_attempted > 0`. These fields affect scoring of historical attempts.

4. **`times_attempted` and `average_time_seconds`:** Computed by a nightly background job from `mock_answers`. Do not update them inline during the attempt submission flow — it would add write contention to every submission. Accept stale-by-one-day values on these fields.

5. **institute_id derivation:** At insert time, derive `institute_id` from `created_by → teacher_details → profiles.institute_id`. Never accept it as a client-supplied value.

---

## Table 2: `question_options`

### Purpose

Stores the answer choices for `mcq`, `msq`, and `true_false` questions. Each row is one selectable option. For `numerical` questions this table has no rows — the answer is a free-form numeric value stored in `question_explanations.correct_numerical_answer`.

Option rows are referenced directly by `mock_answer_options` during an attempt. This FK relationship is what makes answer storage correct and queryable — rather than serializing a comma-separated list of selected option IDs into a string (the ERD v2's `selected_option_ids` field, which is replaced by `mock_answer_options` in this implementation).

Option rows for a `published` question are immutable. If the teacher needs to correct an option, they must create a new question version.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `option_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `question_id` | `UUID` | NOT NULL | — | FK → `questions.question_id`. The question this option belongs to |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS. Copied from parent question at insert time |
| `option_text` | `TEXT` | NOT NULL | — | The option content in plain text or Markdown. LaTeX supported. Examples: `(A) Newton's First Law`, `True`, `42.5 m/s²` |
| `is_correct` | `BOOLEAN` | NOT NULL | `FALSE` | TRUE if this option is a correct answer. For `mcq`, exactly one option should have `is_correct = TRUE`. For `msq`, one or more options have `is_correct = TRUE`. For `true_false`, exactly one of the two options is TRUE. The DB does not enforce the count — enforce at application layer |
| `order_sequence` | `INTEGER` | NOT NULL | — | Display order of this option within the question. 1-indexed. When `mock_test.shuffle_options = TRUE`, the test engine randomizes order at render time; this column stores the canonical authoring order |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC creation timestamp |

---

### Primary Key

```
PRIMARY KEY (option_id)
```

---

### Foreign Keys

```
question_id  → questions.question_id              ON DELETE CASCADE    ON UPDATE RESTRICT
institute_id → institutes.institute_id            ON DELETE RESTRICT   ON UPDATE RESTRICT
```

> `question_id` uses `CASCADE` on delete. If a `draft` question is discarded (archived then hard-deleted via service_role), its options have no standalone value. In normal operation, questions are archived not deleted — this CASCADE is a safety net.

---

### Unique Constraints

```sql
UNIQUE (question_id, order_sequence)
```

> Prevents duplicate sequence numbers within a question. Enforces clean ordering.

---

### CHECK Constraints

```sql
CHECK (char_length(option_text) >= 1)
CHECK (order_sequence >= 1)
```

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_question_options_question_id` | `(question_id)` | B-tree | Fetch all options for a question — the primary read pattern |
| `idx_question_options_question_correct` | `(question_id, is_correct)` WHERE `is_correct = TRUE` | Partial B-tree | Answer key lookup during scoring: find the correct option(s) for a question without scanning all options |

---

### Soft Delete Strategy

`question_options` rows are never soft-deleted. They are deleted (via CASCADE) only when the parent question is hard-deleted by service_role. In normal operation, options for a published question are immutable; corrections are handled by creating a new question version.

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE question | `CASCADE` | Options are a structural part of the question; they have no value without it |
| UPDATE option_id | `RESTRICT` | PK must not change |
| UPDATE question_id | `RESTRICT` | Options cannot be moved between questions |

---

### Supabase RLS Considerations

```
Table: question_options
RLS: ENABLED

Policies:

SELECT:
  - Teachers may read options for questions they created or for any published
    question within their institute (for test composition).
    USING: institute_id = get_my_institute_id()

  - Admins may read all options within their institute.
    USING: institute_id = get_my_institute_id()

  - Students: options are served via Edge Function during an active attempt only.
    No direct SELECT policy for students.

INSERT / UPDATE / DELETE:
  - Teachers may manage options for their own draft/pending_approval questions only.
  - Blocked for published questions (immutability rule).
  - Blocked for students at RLS level.
```

---

### Backend Developer Notes

1. **MCQ correct-option enforcement:** Enforce at application layer that exactly one option has `is_correct = TRUE` for `mcq` and `true_false` questions. For `msq`, enforce that at least one option is correct and at least one is incorrect. This cannot be expressed as a DB CHECK without a deferrable constraint or trigger — use a pre-publish validation step.

2. **Shuffle at render time:** When `mock_test.shuffle_options = TRUE`, the test delivery Edge Function must shuffle options at render time using a seeded randomizer (seed = `attempt_id + question_id`) so that the same student always sees the same shuffle on resume, but different students see different orders.

3. **Option snapshot in `mock_test_questions`:** When a test is published, the question snapshot in `mock_test_questions.question_snapshot` should include the full array of option texts and their `option_id` values. This ensures that even if a new question version is created and the old question is archived, the answer key for in-progress attempts remains resolvable.

---

## Table 3: `question_explanations`

### Purpose

Stores the solution walkthrough for a question. The 1:1 relationship is enforced via a UNIQUE constraint on `question_id` — every question has at most one explanation row.

The explanation is authored alongside the question but may be added after the initial draft. It is intentionally separate from `questions` to keep the question stem table lean and to allow the explanation to be fetched only when a student has submitted an attempt (never during an active attempt, which would be cheating).

For `numerical` questions, `correct_numerical_answer` stores the accepted answer value and `numerical_tolerance` stores the acceptable margin of error.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `explanation_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `question_id` | `UUID` | NOT NULL | — | FK → `questions.question_id`. 1:1 relationship enforced via UNIQUE constraint |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS |
| `explanation_text` | `TEXT` | NULL | `NULL` | Step-by-step solution in plain text or Markdown with LaTeX support. NULL if the explanation has not been written yet (allowed for draft questions; required before a question can be published) |
| `explanation_video_url` | `TEXT` | NULL | `NULL` | Optional URL to a video solution walkthrough. May be a Supabase Storage path (signed URL generated dynamically) or an external video link. NULL if no video explanation exists |
| `correct_numerical_answer` | `NUMERIC(15,6)` | NULL | `NULL` | The correct answer value for `numerical` type questions. NULL for `mcq`, `msq`, `true_false`. Required for `numerical` questions before publication |
| `numerical_tolerance` | `NUMERIC(10,6)` | NULL | `NULL` | Acceptable margin of error for `numerical` questions. A student answer is marked correct if `ABS(answer - correct_numerical_answer) <= numerical_tolerance`. NULL means exact match required. NULL for non-numerical questions |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC last-modified timestamp. Trigger-maintained |

---

### Primary Key

```
PRIMARY KEY (explanation_id)
```

---

### Foreign Keys

```
question_id  → questions.question_id              ON DELETE CASCADE    ON UPDATE RESTRICT
institute_id → institutes.institute_id            ON DELETE RESTRICT   ON UPDATE RESTRICT
```

---

### Unique Constraints

```sql
UNIQUE (question_id)
```

> Enforces the 1:1 relationship. Only one explanation per question.

---

### CHECK Constraints

```sql
CHECK (
  (correct_numerical_answer IS NULL) = (numerical_tolerance IS NULL)
  OR (correct_numerical_answer IS NOT NULL AND numerical_tolerance IS NULL)
)
CHECK (numerical_tolerance IS NULL OR numerical_tolerance >= 0)
```

> The first CHECK allows `correct_numerical_answer` to exist with `numerical_tolerance = NULL` (exact match required) but prevents `numerical_tolerance` from existing without `correct_numerical_answer`.

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_question_explanations_question_id` | `(question_id)` | B-tree | Covered by UNIQUE constraint |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE question | `CASCADE` | Explanation has no value without its question |
| UPDATE question_id | `RESTRICT` | Cannot move an explanation between questions |

---

### Supabase RLS Considerations

```
Table: question_explanations
RLS: ENABLED

Policies:

SELECT:
  - Teachers may read explanations for questions they created or any published
    question within their institute.
    USING: institute_id = get_my_institute_id()

  - Admins may read all within their institute.

  - Students may read explanations ONLY for questions in a submitted attempt.
    Implementation: The attempt-result Edge Function fetches explanations server-side
    and includes them in the result payload. No direct student SELECT policy on this table.
    Exposing explanations during an active attempt is forbidden.

INSERT / UPDATE:
  - Teachers may manage explanations for their own draft/pending_approval questions.
  - Blocked for published questions (immutability rule; new version required).

DELETE:
  - Blocked at RLS level.
```

---

### Backend Developer Notes

1. **Publication gate:** Before a question can be transitioned from `pending_approval` to `published`, the admin approval Edge Function must verify that an `explanation` row exists with a non-null `explanation_text` (and `correct_numerical_answer` for numerical questions). A question without an explanation must not be publishable.

2. **Numerical scoring:** For `numerical` questions, the scoring logic in the result-generation Edge Function evaluates: `is_correct = ABS(student_answer - correct_numerical_answer) <= numerical_tolerance`. If `numerical_tolerance IS NULL`, exact equality is required (with appropriate floating-point epsilon handling).

3. **Explanation access timing:** The `explanation_text` and `explanation_video_url` are served to students only after `mock_attempt.status = 'submitted'`. The attempt delivery Edge Function must never include explanation data in the question payload served during an active attempt.

---

## Table 4: `question_images`

### Purpose

Stores the images associated with a question — diagrams, figures, chemical structures, graphs, and any other visual content embedded in the question stem or options. The 1:M relationship allows multiple images per question (e.g., a diagram for the stem plus a second diagram for an option).

`image_role` distinguishes where each image is used so the renderer knows which image belongs in the stem versus an option. Images are stored in Supabase Storage; this table stores only the metadata and path.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `image_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `question_id` | `UUID` | NOT NULL | — | FK → `questions.question_id`. The question this image belongs to |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS and storage quota tracking |
| `storage_bucket` | `VARCHAR(100)` | NOT NULL | — | Supabase Storage bucket name. Consistent with the storage model in Domain 3 (Content) and Domain 4 (Recordings) |
| `storage_path` | `TEXT` | NOT NULL | — | Object path within `storage_bucket`. Signed URLs are generated dynamically from this path — never stored here |
| `image_role` | `VARCHAR(50)` | NOT NULL | — | Describes where this image is used. Values: `stem` (embedded in question text), `option_a` through `option_d` (embedded in a specific option), `explanation` (used in the solution walkthrough). Not an enum — roles may expand. Used by the renderer to place images correctly |
| `alt_text` | `TEXT` | NULL | `NULL` | Accessibility description of the image. Required for WCAG 2.1 Level AA compliance. NULL during draft authoring but should be populated before publication |
| `order_sequence` | `INTEGER` | NOT NULL | `1` | Display order for questions with multiple stem images. 1-indexed |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC creation timestamp |

---

### Primary Key

```
PRIMARY KEY (image_id)
```

---

### Foreign Keys

```
question_id  → questions.question_id              ON DELETE CASCADE    ON UPDATE RESTRICT
institute_id → institutes.institute_id            ON DELETE RESTRICT   ON UPDATE RESTRICT
```

---

### CHECK Constraints

```sql
CHECK (char_length(storage_bucket) >= 1)
CHECK (char_length(storage_path) >= 1)
CHECK (order_sequence >= 1)
```

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_question_images_question_id` | `(question_id)` | B-tree | Fetch all images for a question — primary read pattern |
| `idx_question_images_question_role` | `(question_id, image_role)` | B-tree | Fetch images by role (e.g. all stem images) for the renderer |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE question | `CASCADE` | Images are structural content of the question |
| UPDATE question_id | `RESTRICT` | Cannot move images between questions |

> **Note:** Cascading the DB row does not delete the Supabase Storage object. Physical file deletion must be handled by a separate cleanup job that reads the `storage_path` before or after deletion.

---

### Backend Developer Notes

1. **Storage path convention:** Follow the pattern `questions/{institute_id}/{question_id}/{image_id}.{ext}`. This path structure enables efficient institute-scoped storage quota queries and simplifies cleanup.

2. **Pre-signed URL generation:** Never store signed URLs in this table. The question delivery Edge Function generates short-lived signed URLs from `storage_path` at serve time. Signed URL TTL should be set to the test duration plus a 30-minute buffer.

3. **Alt text enforcement:** The publication gate (admin approval step) should warn if any image has `alt_text IS NULL`. Enforce as a soft block (warning, not hard fail) initially, then upgrade to a hard block once teachers are trained.

---

## Table 5: `mock_tests`

### Purpose

Represents one configured test that students can attempt. A `mock_test` is the product: it has a title, a time limit, a scoring configuration, a lifecycle state, and a set of questions assembled via `mock_test_questions`.

The design supports the full range of test types used in coaching institute operations — standard chapter tests, full syllabus mocks, sectional tests, and PYQ-mapped practice papers (via `pyq_mock_mappings`). All of these share the same `mock_tests` table; the distinction is in the questions assembled and the metadata provided.

Once published, the test configuration and question list are frozen. Students attempting the test will always see the same questions and scoring rules, even if the underlying question bank is updated afterward. This freeze is implemented via `mock_test_questions.question_snapshot`.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `test_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS and multi-tenant isolation |
| `teacher_id` | `UUID` | NOT NULL | — | FK → `teacher_details.teacher_id`. The teacher who authored and owns this test |
| `stream_id` | `UUID` | NOT NULL | — | FK → `streams.stream_id`. The exam stream this test is designed for (e.g. NEET, JEE Mains). Required for stream-level analytics and student access control |
| `subject_id` | `UUID` | NULL | `NULL` | FK → `subjects.subject_id`. Optional. NULL for full-syllabus or multi-subject tests. Set for single-subject chapter tests |
| `title` | `VARCHAR(500)` | NOT NULL | — | Display title shown to students. Examples: `NEET 2025 Full Syllabus Mock #3`, `Physics — Thermodynamics Chapter Test` |
| `description` | `TEXT` | NULL | `NULL` | Optional instructions shown to students on the test overview screen before they start |
| `duration_min` | `INTEGER` | NOT NULL | — | Total test duration in minutes. The attempt timer counts down from this value. Range: 1–600 |
| `total_marks` | `INTEGER` | NOT NULL | — | Sum of all question marks. Computed and frozen at publish time from `SUM(mock_test_questions.marks)`. Stored here for fast display without aggregating the junction table |
| `passing_marks` | `INTEGER` | NULL | `NULL` | Minimum score to be marked as "passed". NULL if no pass/fail threshold applies |
| `negative_marking` | `NUMERIC(5,2)` | NOT NULL | `0` | Default negative marks per wrong answer for this test. Applied to questions that do not have a per-question override in `mock_test_questions.negative_marks_override`. `0` means no negative marking |
| `attempt_limit` | `INTEGER` | NULL | `NULL` | Maximum number of times a student may attempt this test. NULL means unlimited. Enforced at the application layer before creating a new `mock_attempt` |
| `shuffle_questions` | `BOOLEAN` | NOT NULL | `FALSE` | When TRUE, questions are presented in a randomized order per attempt. Order is seeded by `attempt_id` for consistency on resume |
| `shuffle_options` | `BOOLEAN` | NOT NULL | `FALSE` | When TRUE, MCQ/MSQ options are randomized per attempt. Seeded by `attempt_id + question_id` |
| `calculator_allowed` | `BOOLEAN` | NOT NULL | `FALSE` | When TRUE, the test UI shows an on-screen scientific calculator |
| `status` | `mock_test_status` | NOT NULL | `'draft'` | PostgreSQL enum: `draft`, `pending_approval`, `published`, `archived`. Only `published` tests are visible to students |
| `test_type` | `VARCHAR(50)` | NOT NULL | `'practice'` | Categorizes the test. Values: `practice` (no ranking, instant result), `mock` (ranked, result after window closes), `chapter_test`, `pyq_paper`. Not an enum — types may expand |
| `result_release_mode` | `VARCHAR(20)` | NOT NULL | `'immediate'` | Controls when the result is shown. Values: `immediate` (on submission), `scheduled` (at `result_release_at`), `manual` (admin releases). Not an enum |
| `result_release_at` | `TIMESTAMPTZ` | NULL | `NULL` | UTC timestamp for scheduled result release. NULL unless `result_release_mode = 'scheduled'` |
| `available_from` | `TIMESTAMPTZ` | NULL | `NULL` | UTC timestamp from which students can start the test. NULL means immediately available upon publication |
| `available_until` | `TIMESTAMPTZ` | NULL | `NULL` | UTC timestamp after which new attempts are blocked. NULL means no expiry |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC last-modified timestamp. Trigger-maintained |
| `published_at` | `TIMESTAMPTZ` | NULL | `NULL` | UTC timestamp when the test was published. NULL until published |

---

### Primary Key

```
PRIMARY KEY (test_id)
```

---

### Foreign Keys

```
institute_id → institutes.institute_id             ON DELETE RESTRICT   ON UPDATE RESTRICT
teacher_id   → teacher_details.teacher_id          ON DELETE RESTRICT   ON UPDATE RESTRICT
stream_id    → streams.stream_id                   ON DELETE RESTRICT   ON UPDATE RESTRICT
subject_id   → subjects.subject_id                 ON DELETE RESTRICT   ON UPDATE RESTRICT
```

---

### Unique Constraints

None. A teacher may create multiple tests with the same title. Title uniqueness within an institute is a UX concern enforced with a warning at the application layer, not a DB constraint.

---

### CHECK Constraints

```sql
CHECK (char_length(title) >= 3)
CHECK (duration_min > 0 AND duration_min <= 600)
CHECK (total_marks > 0)
CHECK (passing_marks IS NULL OR (passing_marks >= 0 AND passing_marks <= total_marks))
CHECK (negative_marking >= 0)
CHECK (attempt_limit IS NULL OR attempt_limit >= 1)
CHECK (available_until IS NULL OR available_from IS NULL OR available_until > available_from)
CHECK (result_release_at IS NULL OR result_release_mode = 'scheduled')
CHECK (
  (status = 'published' AND published_at IS NOT NULL)
  OR (status != 'published' AND published_at IS NULL)
)
```

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_mock_tests_institute_status` | `(institute_id, status)` | B-tree | Student test library: all published tests in the institute |
| `idx_mock_tests_stream_status` | `(stream_id, status)` | B-tree | Stream-filtered test listing — primary student browse pattern |
| `idx_mock_tests_teacher_status` | `(teacher_id, status)` | B-tree | Teacher's test dashboard |
| `idx_mock_tests_available_window` | `(available_from, available_until)` WHERE `status = 'published'` | Partial B-tree | Background job: find tests that just opened or just closed their attempt window |
| `idx_mock_tests_result_release` | `(result_release_at)` WHERE `result_release_mode = 'scheduled'` | Partial B-tree | Scheduler: find tests whose result release time has passed |

---

### Soft Delete Strategy

`mock_tests` does not use `deleted_at`. Use `status = 'archived'` to hide a test from students. A published test with existing attempts is never hard-deleted — the attempt history references it.

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE mock_test | `RESTRICT` | Referenced by `mock_test_questions`, `mock_attempts` |
| DELETE stream | `RESTRICT` | Cannot delete a stream with tests assigned to it |
| UPDATE test_id | `RESTRICT` | PK must not change |

---

### Supabase RLS Considerations

```
Table: mock_tests
RLS: ENABLED

Policies:

SELECT:
  - Students may read published tests within their institute that are within their
    stream and within the available_from/available_until window (if set).
    USING: institute_id = get_my_institute_id()
      AND status = 'published'
      AND stream_id IN (
        SELECT s.stream_id FROM streams s
        JOIN batches b ON b.stream_id = s.stream_id
        JOIN batch_student bs ON bs.batch_id = b.batch_id
        JOIN student_details sd ON sd.student_id = bs.student_id
        WHERE sd.profile_id = auth.uid()
      )

  - Teachers may read all tests they own regardless of status.
    USING: teacher_id = (
      SELECT teacher_id FROM teacher_details WHERE profile_id = auth.uid()
    )

  - Admins may read all tests within their institute.
    USING: institute_id = get_my_institute_id()

INSERT:
  - Teachers may create tests within their own institute.

UPDATE:
  - Teachers may update their own tests when status IN ('draft', 'pending_approval').
  - Published and archived tests are immutable via teacher action.
  - Admins may update any test within their institute.

DELETE:
  - Blocked at RLS level.
```

---

### Backend Developer Notes

1. **Status state machine:** Mirrors `questions`:
   - `draft` → `pending_approval` → `published` → `archived`
   - `pending_approval` → `draft` (admin rejects)
   - Enforce via BEFORE UPDATE trigger.

2. **Publish-time freeze:** When a test transitions to `published`, an Edge Function must:
   - Compute and write `total_marks = SUM(mock_test_questions.marks)`
   - Write `published_at = NOW()`
   - For each row in `mock_test_questions`, write `question_snapshot` (see Table 6)
   - Block any further changes to `mock_test_questions` for this test

   All steps are atomic in a single transaction.

3. **Attempt limit enforcement:** Before inserting a `mock_attempt`, the Edge Function must count existing attempts for `(test_id, student_id)`. If `attempt_limit IS NOT NULL AND count >= attempt_limit`, reject with 409.

4. **Availability window enforcement:** At attempt creation time, verify `NOW() >= available_from` (if set) and `NOW() <= available_until` (if set). Do not rely solely on the RLS SELECT policy — enforce again in the Edge Function.

---

## Table 6: `mock_test_questions`

### Purpose

Junction table linking `mock_tests` to `questions`. Each row represents one question's inclusion in one test, carrying the per-test scoring configuration and the frozen snapshot of the question at publish time.

The `question_snapshot` JSONB column is the immutability mechanism for the test engine. At publish time, the full question is serialized into this field — stem, options, correct answers, and explanation. During an attempt, the engine reads from `question_snapshot`, not from the live `questions` and `question_options` tables. This means a teacher can edit a question after a test is published without affecting in-progress or future attempts on that test.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `test_id` | `UUID` | NOT NULL | — | FK → `mock_tests.test_id`. Part of composite primary key |
| `question_id` | `UUID` | NOT NULL | — | FK → `questions.question_id`. Part of composite primary key. References the live question row for analytics joins; `question_snapshot` is the authoritative source for attempt delivery |
| `order_sequence` | `INTEGER` | NOT NULL | — | Display order of this question within the test. 1-indexed. Canonical order when `shuffle_questions = FALSE` |
| `marks` | `NUMERIC(5,2)` | NOT NULL | — | Marks awarded for a correct answer in this test. May differ from `questions.marks` (the default). Allows the same question to be worth 4 marks in a NEET mock and 3 marks in a chapter test |
| `negative_marks_override` | `NUMERIC(5,2)` | NULL | `NULL` | Per-question negative marks override. When NULL, the test-level `mock_tests.negative_marking` applies. When set, this value takes precedence for this question in this test |
| `section_name` | `VARCHAR(100)` | NULL | `NULL` | Optional section grouping for multi-section tests (e.g., NEET has Physics, Chemistry, Biology sections). NULL for single-section tests |
| `question_snapshot` | `JSONB` | NULL | `NULL` | Frozen copy of the question at publish time. Populated by the publish Edge Function. NULL for draft tests (before publish). Structure: `{ question_id, question_text, question_type, marks, negative_marks, options: [{option_id, option_text, is_correct, order_sequence}], correct_numerical_answer, numerical_tolerance }`. Does NOT include explanation — that is served post-submission |
| `added_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC timestamp when this question was added to the test |

---

### Primary Key

```
PRIMARY KEY (test_id, question_id)
```

---

### Foreign Keys

```
test_id     → mock_tests.test_id                  ON DELETE CASCADE    ON UPDATE RESTRICT
question_id → questions.question_id               ON DELETE RESTRICT   ON UPDATE RESTRICT
```

> `test_id` uses `CASCADE` on delete. If a draft test is hard-deleted (service_role only), its question list is removed. Published tests are never deleted.

> `question_id` uses `RESTRICT`. A question that has been placed in a test cannot be deleted.

---

### Unique Constraints

Enforced by the composite primary key — a question may appear at most once per test.

---

### CHECK Constraints

```sql
CHECK (order_sequence >= 1)
CHECK (marks > 0)
CHECK (negative_marks_override IS NULL OR negative_marks_override >= 0)
```

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_mock_test_questions_test_id` | `(test_id, order_sequence)` | B-tree | Fetch the ordered question list for a test — the primary read pattern |
| `idx_mock_test_questions_question_id` | `(question_id)` | B-tree | "Which tests contain this question?" — admin question-usage view |
| `idx_mock_test_questions_section` | `(test_id, section_name)` WHERE `section_name IS NOT NULL` | Partial B-tree | Section-filtered question fetch for multi-section tests |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE mock_test | `CASCADE` | Question list has no value without the test |
| DELETE question | `RESTRICT` | Question cannot be removed if it is in any test |
| UPDATE test_id / question_id | `RESTRICT` | Junction PKs must not change |

---

### Backend Developer Notes

1. **Snapshot schema:** The `question_snapshot` JSON structure must be agreed and documented as a contract. Any change to the schema of this JSON requires a migration of all existing snapshots or a version field within the JSON itself. Recommended: add a `snapshot_version` integer field inside the JSON from day one.

2. **Post-publish immutability:** Once `mock_tests.status = 'published'`, all rows in `mock_test_questions` for that test must be immutable. Block INSERT, UPDATE, and DELETE on this junction table via a BEFORE trigger that checks the parent test status. Reject with an exception if the test is published.

3. **Section ordering:** For multi-section tests, `order_sequence` is global (not per-section). The renderer groups by `section_name` and sorts by `order_sequence` within each section.

---

## Table 7: `mock_attempts`

### Purpose

Represents one student's single attempt at a mock test. A student who takes the same test twice has two `mock_attempt` rows. Each attempt has its own timer, its own answer set, and its own result.

This is a very high-write table. During an active attempt, the timer state is periodically synced (every 30–60 seconds) and auto-save events trigger `mock_answer` writes. At scale (50,000 concurrent students in an exam window), write throughput is significant. Partition planning by `started_at` is required.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `attempt_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `test_id` | `UUID` | NOT NULL | — | FK → `mock_tests.test_id`. The test being attempted |
| `student_id` | `UUID` | NOT NULL | — | FK → `student_details.student_id`. The student taking the attempt |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS and partitioned queries |
| `attempt_number` | `INTEGER` | NOT NULL | — | 1-indexed attempt counter per student per test. `1` for the first attempt, `2` for the second, etc. Computed at insert time: `SELECT COUNT(*) + 1 FROM mock_attempts WHERE test_id = ? AND student_id = ?` |
| `status` | `attempt_status` | NOT NULL | `'in_progress'` | PostgreSQL enum: `in_progress`, `submitted`, `timed_out`, `abandoned`. See state machine in Backend Developer Notes |
| `started_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC timestamp when the attempt was created (student clicked "Start Test") |
| `submitted_at` | `TIMESTAMPTZ` | NULL | `NULL` | UTC timestamp when the attempt was finalised. Set for `submitted` and `timed_out` statuses. NULL while in progress |
| `time_remaining_seconds` | `INTEGER` | NULL | `NULL` | Seconds remaining on the timer at the last sync. Updated periodically by the client heartbeat. Used to resume the timer correctly if the student's browser crashes. NULL after submission |
| `ip_address` | `INET` | NULL | `NULL` | Client IP address at attempt start. Used for exam integrity monitoring (same IP across accounts) and geo-analytics. Treat as PII |
| `device_fingerprint` | `TEXT` | NULL | `NULL` | Hashed device fingerprint at attempt start. Used for exam integrity monitoring. Hashed at the Edge Function layer — never store raw fingerprint data |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC creation timestamp. Intentionally same as `started_at` in most cases; maintained separately for consistency with platform-wide conventions |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC last-modified timestamp. Trigger-maintained. Updated on every auto-save |

---

### Primary Key

```
PRIMARY KEY (attempt_id, started_at)
```

> Composite PK includes `started_at` because this table is range-partitioned by `started_at`. PostgreSQL declarative partitioning requires the partition key in the PK.

---

### Foreign Keys

```
test_id      → mock_tests.test_id                 ON DELETE RESTRICT   ON UPDATE RESTRICT
student_id   → student_details.student_id         ON DELETE RESTRICT   ON UPDATE RESTRICT
institute_id → institutes.institute_id            ON DELETE RESTRICT   ON UPDATE RESTRICT
```

---

### Unique Constraints

```sql
UNIQUE (test_id, student_id, attempt_number)
```

> Prevents duplicate attempt numbers for the same student on the same test. Because the table is partitioned, this constraint is scoped per partition — enforce cross-partition uniqueness at the application layer with a serializable transaction or advisory lock.

---

### CHECK Constraints

```sql
CHECK (attempt_number >= 1)
CHECK (time_remaining_seconds IS NULL OR time_remaining_seconds >= 0)
CHECK (submitted_at IS NULL OR submitted_at >= started_at)
CHECK (
  (status IN ('submitted', 'timed_out') AND submitted_at IS NOT NULL)
  OR (status IN ('in_progress', 'abandoned') AND submitted_at IS NULL)
)
```

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_mock_attempts_test_id` | `(test_id, started_at DESC)` | B-tree | All attempts for a test — leaderboard and result release queries |
| `idx_mock_attempts_student_id` | `(student_id, started_at DESC)` | B-tree | Student's attempt history across all tests |
| `idx_mock_attempts_student_test` | `(student_id, test_id)` | B-tree | Attempt limit check: how many times has this student attempted this test? |
| `idx_mock_attempts_status_inprogress` | `(status, started_at)` WHERE `status = 'in_progress'` | Partial B-tree | Background job: find in-progress attempts that have exceeded the time limit for auto-timeout |

---

### Partitioning Strategy

```
Partition type: RANGE
Partition key:  started_at
Partition size: Monthly
Naming:         mock_attempts_2025_01, mock_attempts_2025_02, ...

Default partition: mock_attempts_default
```

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE mock_test | `RESTRICT` | Attempts reference the test |
| DELETE student | `RESTRICT` | Student is soft-deleted; attempt history must be retained |
| UPDATE attempt_id | `RESTRICT` | PK must not change |

---

### Supabase RLS Considerations

```
Table: mock_attempts
RLS: ENABLED

Policies:

SELECT:
  - Students may read their own attempts only.
    USING: student_id = (
      SELECT student_id FROM student_details WHERE profile_id = auth.uid()
    )

  - Teachers may read all attempts for tests they own.
    USING: EXISTS (
      SELECT 1 FROM mock_tests mt
      WHERE mt.test_id = mock_attempts.test_id
        AND mt.teacher_id = (
          SELECT teacher_id FROM teacher_details WHERE profile_id = auth.uid()
        )
    )

  - Admins may read all attempts within their institute.
    USING: institute_id = get_my_institute_id()

INSERT:
  - Students may create attempts for published, available tests within their stream.
    Via Edge Function only (attempt limit check, availability window check, attempt_number
    computation happen server-side).

UPDATE:
  - Students may update time_remaining_seconds on their own in_progress attempts.
  - Via Edge Function for status transitions and submitted_at.
  - Teachers and admins: read-only.

DELETE:
  - Blocked at RLS level.
```

---

### Backend Developer Notes

1. **Status state machine:**
   - `in_progress` → `submitted` (student clicks Submit)
   - `in_progress` → `timed_out` (background job detects timer expired)
   - `in_progress` → `abandoned` (student closed without submitting; no explicit action — detected by the timeout job after a grace period)

2. **Timer sync:** The client sends a heartbeat every 60 seconds updating `time_remaining_seconds`. On browser close/crash, the background job uses `started_at + mock_tests.duration_min * 60 - time_remaining_seconds` to determine if the attempt has expired. Set `status = 'timed_out'` and trigger result generation for expired in-progress attempts.

3. **Auto-submit on timeout:** When `time_remaining_seconds` reaches 0 (or the background job detects the attempt has exceeded `duration_min`), the system must auto-submit the attempt using the answers saved so far. Generate a `mock_result` from the answers present at that moment. Do not wait for the student to click submit.

4. **Attempt creation atomicity:** Creating an attempt must be atomic: increment `attempt_number`, write the `mock_attempts` row, and pre-populate `mock_answers` rows (one per question in the test, all with `is_answered = FALSE`) in a single transaction. Pre-populating answers ensures the result-generation job always has a complete answer set to score, even if the student abandons without touching some questions.

---

## Table 8: `mock_answers`

### Purpose

Stores one answer record per question per attempt. Every question in the test gets a `mock_answer` row when the attempt is created (pre-populated with `is_answered = FALSE`). As the student selects options, the row is updated in place.

This is the highest-write table in the domain. Every option selection, every review flag toggle, and every auto-save hits this table. At 100 questions per test and 50,000 concurrent attempts, updates arrive at approximately 5 million rows/minute during peak exam windows.

The ERD v2 stores `selected_option_ids` as a string on this table. This implementation replaces that with a FK-based design using the `mock_answer_options` child table, which makes answer storage correct (proper FK to `question_options`), queryable without string parsing, and auditable.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `answer_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `attempt_id` | `UUID` | NOT NULL | — | FK → `mock_attempts.attempt_id`. The attempt this answer belongs to |
| `question_id` | `UUID` | NOT NULL | — | FK → `questions.question_id`. Which question was answered. Denormalized from `mock_test_questions` for direct query |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS |
| `is_answered` | `BOOLEAN` | NOT NULL | `FALSE` | TRUE once the student has selected at least one option (or entered a numerical value). FALSE for skipped/unattempted questions. Computed from `mock_answer_options` count > 0 OR `numerical_answer IS NOT NULL`, but stored explicitly for fast "skipped count" queries |
| `is_marked_for_review` | `BOOLEAN` | NOT NULL | `FALSE` | TRUE if the student has flagged this question for review before submitting. Does not affect scoring. Used by the test navigation panel to highlight flagged questions |
| `numerical_answer` | `NUMERIC(15,6)` | NULL | `NULL` | Student's entered value for `numerical` type questions. NULL for `mcq`, `msq`, `true_false`. The selected options for those types are stored in `mock_answer_options` |
| `is_correct` | `BOOLEAN` | NULL | `NULL` | NULL until scored. Set by the result-generation job. TRUE if all correct options were selected and no incorrect options, FALSE otherwise. For `numerical`, TRUE if within tolerance |
| `marks_awarded` | `NUMERIC(7,2)` | NULL | `NULL` | NULL until scored. Positive for correct, negative for wrong (negative marking), 0 for skipped/unattempted. Set by the result-generation job |
| `time_spent_seconds` | `INTEGER` | NOT NULL | `0` | Cumulative seconds the student spent with this question visible. Updated on each auto-save as the client tracks active question time. Used for per-question time analytics in `MockResult` and `TeacherAnalytics` |
| `answered_at` | `TIMESTAMPTZ` | NULL | `NULL` | UTC timestamp of the student's last interaction with this question (last option selection or numerical entry). NULL for unattempted questions |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC row creation timestamp. Set at attempt creation time |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC last-modified timestamp. Trigger-maintained. Updated on every auto-save |

---

### Primary Key

```
PRIMARY KEY (answer_id)
```

---

### Foreign Keys

```
attempt_id   → mock_attempts.attempt_id           ON DELETE CASCADE    ON UPDATE RESTRICT
question_id  → questions.question_id              ON DELETE RESTRICT   ON UPDATE RESTRICT
institute_id → institutes.institute_id            ON DELETE RESTRICT   ON UPDATE RESTRICT
```

> `attempt_id` uses `CASCADE`. If an attempt is ever deleted (service_role only; never in normal operation), its answer rows are removed.

---

### Unique Constraints

```sql
UNIQUE (attempt_id, question_id)
```

> One answer row per question per attempt. Pre-population at attempt creation ensures this holds from the start.

---

### CHECK Constraints

```sql
CHECK (time_spent_seconds >= 0)
CHECK (marks_awarded IS NULL OR (is_correct IS NOT NULL))
CHECK (answered_at IS NULL OR is_answered = TRUE)
```

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_mock_answers_attempt_id` | `(attempt_id)` | B-tree | Fetch all answers for an attempt — scoring and result display |
| `idx_mock_answers_attempt_question` | `(attempt_id, question_id)` | B-tree | Covered by UNIQUE constraint |
| `idx_mock_answers_question_id` | `(question_id)` | B-tree | Per-question analytics: accuracy rate, average time, across all attempts |
| `idx_mock_answers_unscored` | `(attempt_id)` WHERE `is_correct IS NULL` | Partial B-tree | Result-generation job: find all answers that have not been scored yet |

---

### Partitioning Strategy

Consider co-partitioning with `mock_attempts`. Because `mock_answers` always joins to its parent `mock_attempt`, partition by `attempt_id` range is impractical (UUIDs are random). Partition by a denormalized `started_at` column (copied from `mock_attempts.started_at` at insert time) to align partitions with `mock_attempts`.

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE mock_attempt | `CASCADE` | Answers have no value without their attempt |
| DELETE question | `RESTRICT` | A question with answers cannot be deleted |
| UPDATE answer_id | `RESTRICT` | PK must not change |

---

### Backend Developer Notes

1. **Auto-save pattern:** The client sends an auto-save payload every 30 seconds and on every question navigation. The Edge Function performs `UPDATE mock_answers SET is_answered = ?, numerical_answer = ?, is_marked_for_review = ?, time_spent_seconds = ?, answered_at = ?, updated_at = NOW() WHERE answer_id = ? AND attempt_id = ?`. The WHERE clause includes `attempt_id` to prevent cross-attempt contamination.

2. **Scoring:** Scoring runs in the result-generation Edge Function after submission. For each `mock_answer` row: fetch the correct options from the `question_snapshot` in `mock_test_questions`; compare with selected options in `mock_answer_options`; compute `is_correct` and `marks_awarded`; write both fields. All scoring for one attempt is done in a single transaction.

3. **Skipped question handling:** Questions pre-populated at attempt creation have `is_answered = FALSE`, `numerical_answer = NULL`, no `mock_answer_options` rows, and `marks_awarded = 0` after scoring. These count as "skipped" in the result.

---

## Table 9: `mock_answer_options`

### Purpose

Junction table linking `mock_answers` to `question_options`. Each row records that a student selected a specific option in a specific answer. For MCQ (single correct), this table has exactly one row per answered `mock_answer`. For MSQ (multiple correct), it has one row per selected option.

This table replaces the `selected_option_ids TEXT` field from the ERD v2. Storing selections as FK rows rather than a serialized string enables: proper referential integrity to `question_options`, direct SQL queries for answer correctness (JOIN to `is_correct` on the option), and clean audit history of exactly which options were selected and in what order.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `answer_option_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `answer_id` | `UUID` | NOT NULL | — | FK → `mock_answers.answer_id`. The answer this option selection belongs to |
| `option_id` | `UUID` | NOT NULL | — | FK → `question_options.option_id`. The specific option the student selected |
| `selected_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC timestamp when this option was selected. For MSQ, rows accumulate over time as the student selects/deselects. When the student deselects an option, the row is deleted — the absence of a row means the option is not currently selected |

---

### Primary Key

```
PRIMARY KEY (answer_option_id)
```

---

### Foreign Keys

```
answer_id → mock_answers.answer_id                ON DELETE CASCADE    ON UPDATE RESTRICT
option_id → question_options.option_id            ON DELETE RESTRICT   ON UPDATE RESTRICT
```

> `answer_id` uses `CASCADE`. When an answer row is deleted (via attempt cascade), its option selections are removed.

> `option_id` uses `RESTRICT`. An option that has been selected by a student cannot be deleted.

---

### Unique Constraints

```sql
UNIQUE (answer_id, option_id)
```

> A student cannot select the same option twice within one answer. On deselect + reselect, the old row is deleted and a new one inserted (with a fresh `selected_at`), maintaining an implicit selection history if needed.

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_mock_answer_options_answer_id` | `(answer_id)` | B-tree | Fetch all selected options for an answer — primary read pattern during scoring and display |
| `idx_mock_answer_options_option_id` | `(option_id)` | B-tree | Option-level analytics: how often was a specific distractor chosen? |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE mock_answer | `CASCADE` | Option selections have no value without their parent answer |
| DELETE question_option | `RESTRICT` | An option selected in an attempt cannot be deleted |

---

### Backend Developer Notes

1. **MCQ toggle behaviour:** For MCQ, selecting a new option must atomically delete any existing `mock_answer_options` row for this `answer_id` (deselecting the old choice) and insert the new row. Use `DELETE FROM mock_answer_options WHERE answer_id = ? THEN INSERT` in a single transaction, or `INSERT ... ON CONFLICT DO UPDATE` with a trigger that enforces the single-selection rule for `mcq` type.

2. **MSQ toggle behaviour:** For MSQ, selecting an option inserts a row; deselecting deletes the row. The client manages the selection state; the server stores the current state as the set of rows present.

3. **Scoring query:** The scoring Edge Function evaluates correctness by joining `mock_answer_options` to `question_options.is_correct`:
   ```sql
   -- All selected options are correct AND all correct options are selected
   SELECT
     COUNT(*) FILTER (WHERE qo.is_correct = FALSE) = 0 AS no_wrong_selections,
     COUNT(*) FILTER (WHERE qo.is_correct = TRUE)
       = (SELECT COUNT(*) FROM question_options WHERE question_id = ? AND is_correct = TRUE)
       AS all_correct_selected
   FROM mock_answer_options mao
   JOIN question_options qo ON qo.option_id = mao.option_id
   WHERE mao.answer_id = ?
   ```

---

## Table 10: `mock_results`

### Purpose

The computed result record for one submitted attempt. One row per attempt, created by the result-generation job after submission. Stores aggregate scores, rankings, time analytics, and subject/chapter breakdowns in denormalized form for fast dashboard rendering.

`mock_results` is a read-optimised materialised summary. All fields are computed from `mock_answers` and `mock_answer_options` at generation time and stored here to avoid recomputing them on every dashboard request. This is the intentional 3NF deviation documented in the ERD v2 normalization notes.

Ranking and percentile are computed relative to all submitted attempts for the same test within the same `result_release` window. They are set when results are released (not at submission time for `mock` and `scheduled` type tests).

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `result_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `attempt_id` | `UUID` | NOT NULL | — | FK → `mock_attempts.attempt_id`. 1:1 relationship enforced via UNIQUE constraint |
| `test_id` | `UUID` | NOT NULL | — | FK → `mock_tests.test_id`. Denormalized for direct dashboard queries without joining through `mock_attempts` |
| `student_id` | `UUID` | NOT NULL | — | FK → `student_details.student_id`. Denormalized for the same reason |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS |
| `total_score` | `NUMERIC(8,2)` | NOT NULL | — | Aggregate of all `mock_answers.marks_awarded` for this attempt. Can be negative if negative marking is severe |
| `max_score` | `NUMERIC(8,2)` | NOT NULL | — | Copied from `mock_tests.total_marks` at result generation time. Stored here so the result is self-contained even if the test is later edited |
| `percentage` | `NUMERIC(5,2)` | NOT NULL | — | `(total_score / max_score) * 100`. Computed and stored. Capped at 0 in display if negative |
| `rank` | `INTEGER` | NULL | `NULL` | Student's rank among all submitted attempts for this test. NULL until rankings are computed (after result release window closes for `mock`/`scheduled` tests). Immediately set for `practice`/`immediate` release tests |
| `percentile` | `NUMERIC(5,2)` | NULL | `NULL` | Percentage of students the student scored higher than. NULL until rankings are computed. Formula: `(students_below / total_students) * 100` |
| `correct_count` | `INTEGER` | NOT NULL | — | Count of `mock_answers` where `is_correct = TRUE` |
| `wrong_count` | `INTEGER` | NOT NULL | — | Count of `mock_answers` where `is_correct = FALSE AND is_answered = TRUE` |
| `skipped_count` | `INTEGER` | NOT NULL | — | Count of `mock_answers` where `is_answered = FALSE` |
| `total_time_seconds` | `INTEGER` | NOT NULL | — | Total time spent on the attempt in seconds. `= SUM(mock_answers.time_spent_seconds)`. May differ from the test duration if the student submitted early |
| `avg_time_per_question` | `NUMERIC(8,2)` | NOT NULL | — | `total_time_seconds / total_questions`. Used in the student performance report |
| `subject_breakdown` | `JSONB` | NULL | `NULL` | Per-subject score breakdown. Structure: `[{ subject_id, subject_name, correct, wrong, skipped, score, max_score }]`. Generated from the subject mapping of each question in the attempt. NULL for single-subject tests where the top-level scores suffice |
| `chapter_breakdown` | `JSONB` | NULL | `NULL` | Per-chapter score breakdown. Same structure as `subject_breakdown` but keyed by `chapter_id`. Used to identify weak chapters for the `PerformanceReport` |
| `is_released` | `BOOLEAN` | NOT NULL | `FALSE` | FALSE until results are released to the student. For `immediate` release, set to TRUE at generation time. For `scheduled` or `manual` release, set to TRUE by the release job/admin action |
| `generated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC timestamp when the result was computed |
| `released_at` | `TIMESTAMPTZ` | NULL | `NULL` | UTC timestamp when the result was made visible to the student. NULL until released |

---

### Primary Key

```
PRIMARY KEY (result_id)
```

---

### Foreign Keys

```
attempt_id   → mock_attempts.attempt_id           ON DELETE RESTRICT   ON UPDATE RESTRICT
test_id      → mock_tests.test_id                 ON DELETE RESTRICT   ON UPDATE RESTRICT
student_id   → student_details.student_id         ON DELETE RESTRICT   ON UPDATE RESTRICT
institute_id → institutes.institute_id            ON DELETE RESTRICT   ON UPDATE RESTRICT
```

---

### Unique Constraints

```sql
UNIQUE (attempt_id)
```

> One result per attempt. Enforces the 1:1 relationship.

---

### CHECK Constraints

```sql
CHECK (total_score <= max_score)
CHECK (percentage >= 0 AND percentage <= 100)
CHECK (correct_count >= 0)
CHECK (wrong_count >= 0)
CHECK (skipped_count >= 0)
CHECK (correct_count + wrong_count + skipped_count = (
  SELECT COUNT(*) FROM mock_test_questions WHERE test_id = mock_results.test_id
))
CHECK (rank IS NULL OR rank >= 1)
CHECK (percentile IS NULL OR (percentile >= 0 AND percentile <= 100))
CHECK (total_time_seconds >= 0)
CHECK (released_at IS NULL OR released_at >= generated_at)
CHECK (
  (is_released = TRUE AND released_at IS NOT NULL)
  OR (is_released = FALSE AND released_at IS NULL)
)
```

> The counts consistency CHECK ensures `correct + wrong + skipped = total questions`. This guards against bugs in the scoring job.

> `total_score <= max_score` is correct; score can be negative (negative marking), but cannot exceed the maximum.

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_mock_results_attempt_id` | `(attempt_id)` | B-tree | Covered by UNIQUE constraint |
| `idx_mock_results_test_id_score` | `(test_id, total_score DESC)` | B-tree | Leaderboard: ranked results for a test |
| `idx_mock_results_student_id` | `(student_id, generated_at DESC)` | B-tree | Student's result history across all tests |
| `idx_mock_results_test_released` | `(test_id, is_released)` | B-tree | Release job: find unreleased results for a test |
| `idx_mock_results_percentile` | `(test_id, percentile DESC)` WHERE `percentile IS NOT NULL` | Partial B-tree | Percentile distribution queries for analytics |

---

### Soft Delete Strategy

`mock_results` rows are never deleted. They are the permanent performance record. Results are hidden from students via `is_released = FALSE`, not via deletion.

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE mock_attempt | `RESTRICT` | Result must not be orphaned |
| DELETE student | `RESTRICT` | Student is soft-deleted; results must be retained |
| UPDATE result_id | `RESTRICT` | PK must not change |

---

### Supabase RLS Considerations

```
Table: mock_results
RLS: ENABLED

Policies:

SELECT:
  - Students may read their own results where is_released = TRUE.
    USING: student_id = (
      SELECT student_id FROM student_details WHERE profile_id = auth.uid()
    )
    AND is_released = TRUE

  - Teachers may read all results for tests they own, regardless of is_released.
    USING: EXISTS (
      SELECT 1 FROM mock_tests mt
      WHERE mt.test_id = mock_results.test_id
        AND mt.teacher_id = (
          SELECT teacher_id FROM teacher_details WHERE profile_id = auth.uid()
        )
    )

  - Admins may read all results within their institute.
    USING: institute_id = get_my_institute_id()

INSERT:
  - Via Edge Function only (result-generation job). Never from a client directly.

UPDATE:
  - Via Edge Function only (ranking job sets rank and percentile; release job
    sets is_released and released_at).
  - Students and teachers may not update results.

DELETE:
  - Blocked at RLS level.
```

---

### Backend Developer Notes

1. **Generation trigger:** The result-generation Edge Function is invoked by:
   - `mock_attempt.status` transitioning to `submitted` or `timed_out`
   - The timeout background job after auto-submission

2. **Ranking computation:** For tests with `result_release_mode = 'scheduled'` or `'manual'`, ranking runs as a batch job after the result release time or admin trigger:
   ```sql
   UPDATE mock_results
   SET rank = sub.rank, percentile = sub.percentile
   FROM (
     SELECT result_id,
       RANK() OVER (PARTITION BY test_id ORDER BY total_score DESC) AS rank,
       ROUND(
         (COUNT(*) FILTER (WHERE total_score < mr.total_score)::NUMERIC
           / COUNT(*)::NUMERIC) * 100, 2
       ) AS percentile
     FROM mock_results mr
     WHERE test_id = ? AND is_released = FALSE
   ) sub
   WHERE mock_results.result_id = sub.result_id
   ```

3. **JSONB breakdown generation:** The `subject_breakdown` and `chapter_breakdown` JSONB fields are generated by the scoring job by grouping `mock_answers` by `questions.subject_id` and `questions.chapter_id` respectively. These breakdowns feed the `PerformanceReport` and `ChapterPerformance` tables in Domain 11 (Analytics).

4. **PerformanceReport feed:** After result release, a background job reads `mock_results.chapter_breakdown` and upserts into `chapter_performance` and `subject_performance` for the student's active `performance_report`. This keeps Domain 11 updated without requiring Domain 11 to query Domain 5 directly on every dashboard load.

---

## Domain 5 — Design Decisions Summary

| Decision | Choice | Reason |
|----------|--------|--------|
| `question_options` as FK rows vs serialized string | FK rows in `mock_answer_options` | Proper referential integrity, SQL-queryable, eliminates string parsing in scoring logic |
| `question_snapshot` on `mock_test_questions` | JSONB frozen at publish time | Immutability: live question edits do not affect in-progress or future attempts on the published test |
| `mock_answer_options` as a separate table | Yes — replaces `selected_option_ids TEXT` | MCQ selections are a proper M:M relationship; a separate table is the only correct normal form |
| `question.version` + `parent_question_id` | Integer version + self-FK lineage | Full version history traversable; new version is a new row (old row stays stable for historical scoring) |
| `mock_results` denormalization | Intentional — computed summary | Read-optimised for dashboard; avoids re-aggregating millions of `mock_answers` rows per request |
| `subject_breakdown` / `chapter_breakdown` as JSONB | Yes — on `mock_results` | Analytics read-model; structure changes without schema migrations; feeds Domain 11 |
| `total_marks` on `mock_tests` | Denormalized from `SUM(mock_test_questions.marks)` | Frozen at publish time for fast display; eliminates aggregation query on every test listing |
| `times_attempted` / `average_time_seconds` on `questions` | Denormalized, updated nightly | Stale-by-one-day is acceptable for these analytics fields; avoids write contention on hot attempt paths |
| Partitioning for `mock_attempts` and `mock_answers` | Monthly RANGE on `started_at` | Volume justifies partitioning from day one |
| `attempt_status` enum | `in_progress`, `submitted`, `timed_out`, `abandoned` | Covers all real-world terminal states; enables background job to target each correctly |
| `is_released` on `mock_results` | Explicit boolean + `released_at` timestamp | Supports all three release modes (immediate, scheduled, manual) without separate state tables |
| `institute_id` on all tables | Denormalized everywhere | Consistent RLS performance pattern; mandatory for multi-tenant isolation |

---

## Domain 5 — Enum Types Used

All enums are defined globally in the pre-domain migration (see Domain 1 Pre-Domain Notes).

| Enum | Values Used in This Domain |
|------|--------------------------|
| `question_type` | `mcq`, `msq`, `numerical`, `true_false` |
| `difficulty_level` | `easy`, `medium`, `hard` |
| `question_status` | `draft`, `pending_approval`, `published`, `archived` |
| `mock_test_status` | `draft`, `pending_approval`, `published`, `archived` |
| `attempt_status` | `in_progress`, `submitted`, `timed_out`, `abandoned` |

> `mock_tests.test_type`, `mock_tests.result_release_mode`, `question_images.image_role`, and `live_sessions.ended_reason` intentionally use `VARCHAR` rather than enums to allow new values without database migrations.

---

## Domain 5 — Relationships to Other Domains

| This Table | References | Via Column | Domain |
|------------|-----------|------------|--------|
| `questions` | `institutes` | `institute_id` | Domain 1 |
| `questions` | `teacher_details` | `created_by` | Domain 1 |
| `questions` | `profiles` | `approved_by` | Domain 1 |
| `questions` | `subjects` | `subject_id` | Domain 2 (Academic Structure) |
| `questions` | `chapters` | `chapter_id` | Domain 2 (Academic Structure) |
| `mock_tests` | `teacher_details` | `teacher_id` | Domain 1 |
| `mock_tests` | `streams` | `stream_id` | Domain 2 (Academic Structure) |
| `mock_tests` | `subjects` | `subject_id` | Domain 2 (Academic Structure) |
| `mock_attempts` | `student_details` | `student_id` | Domain 1 |

| This Table | Referenced By | Via Column | Domain |
|------------|--------------|------------|--------|
| `questions` | `pyq_question_mappings` | `question_id` | Domain 10 (PYQ System) |
| `mock_tests` | `pyq_mock_mappings` | `test_id` | Domain 10 (PYQ System) |
| `mock_results` | `performance_report` | (aggregate source) | Domain 11 (Analytics) |
| `mock_results` | `chapter_performance` | (aggregate source) | Domain 11 (Analytics) |
| `mock_results` | `subject_performance` | (aggregate source) | Domain 11 (Analytics) |
| `mock_results` | `progress_history` | (aggregate source) | Domain 11 (Analytics) |
| `mock_tests` | `approval_request` | `resource_id` | Domain 14 (Approval Workflow) |

---

*Domain 5 complete — v1.0. Awaiting approval before proceeding to Domain 6 — Batch Management (Batch · BatchStudent · BatchTeacher).*
