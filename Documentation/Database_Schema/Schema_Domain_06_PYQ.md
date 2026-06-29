# EdTech Platform — Database Schema Specification
## Domain 6: PYQ (Previous Year Questions)
### Tables: PYQPackage · PYQPackageUnlock · PYQPaper · PYQQuestionMapping · PYQSolution · PYQMockMapping · StudentPYQPurchase

**Document version:** 1.0
**ERD reference:** ERD v2.0 (Frozen)
**PostgreSQL target:** 16
**Supabase compatibility:** Yes

---

## Domain Context

Domain 6 covers the Previous Year Question (PYQ) product line — the most commercially significant content asset in the Indian competitive exam coaching market. NEET, JEE, and other entrance exam aspirants routinely purchase PYQ papers from 5–15 years of past exams as standalone preparation tools. This domain models how those papers are packaged, sold, linked to the question bank, and made available for timed practice.

The domain sits at the intersection of three other domains and its design must satisfy all three simultaneously.

**Commerce intersection (Domain 7):** PYQ content is gated behind a purchase. A student who has not bought the package must see paper metadata (year, title, question count) but not the content. Access control is the primary design constraint on every table in this domain.

**Question Bank intersection (Domain 5):** PYQ questions are not a separate question type — they are `questions` rows in the shared bank, tagged via `pyq_question_mappings`. This means PYQ questions benefit from the same versioning, approval workflow, and chapter/subject analytics as teacher-authored questions. A question from NEET 2022 that also appears in a teacher's mock test is one row, not two.

**Mock Test intersection (Domain 5):** A PYQ paper can be attempted as a timed mock test via `pyq_mock_mappings`. When this mapping exists, the student experiences the paper identically to any other `mock_test` — timer, auto-save, scoring, result — with no special-case code in the attempt engine. The PYQ domain is responsible for creating and owning that `mock_test` row; the attempt engine treats it as opaque.

### What this domain does NOT contain

Student attempt history for PYQ papers lives entirely in `mock_attempts` and `mock_results` (Domain 5). This domain contains no attempt or answer tables. The `pyq_mock_mappings` join is the only bridge.

---

## Table 1: `pyq_packages`

### Purpose

The top-level sellable unit of PYQ content. A package groups one or more PYQ papers under a single price point and access grant. Students buy a package, not individual papers.

Examples of packages as sold by coaching institutes:

- *NEET 2015–2024 Complete PYQ Bundle* — 10 papers, PDF + solutions + mock attempts
- *JEE Mains Physics PYQ 2018–2024* — 7 papers, subject-filtered
- *NEET 2023 Official Paper* — single paper, PDF only

`pyq_packages` scopes access. A student who has purchased a package gains access to all papers inside it, with the specific asset types (PDF, solutions, mock test) governed by `pyq_package_unlocks`.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `package_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS and multi-tenant isolation. An institute owns its PYQ catalogue |
| `stream_id` | `UUID` | NOT NULL | — | FK → `streams.stream_id`. The exam stream this package covers (e.g., NEET, JEE Mains, JEE Advanced). A package is scoped to exactly one stream; multi-stream content requires separate packages |
| `name` | `VARCHAR(300)` | NOT NULL | — | Display name shown to students in the store and library. Examples: `NEET PYQ 2015–2024 Complete Bundle`, `JEE Mains Physics 2019–2024` |
| `description` | `TEXT` | NULL | `NULL` | Marketing description shown on the package detail page. May include paper count, year range, what assets are included, and exam-day tips |
| `price` | `NUMERIC(10,2)` | NOT NULL | — | Listed price in the institute's configured currency. `0.00` for free packages (e.g., single sample paper). Actual transaction amount is recorded in `order_items` (Domain 7) |
| `currency` | `VARCHAR(3)` | NOT NULL | `'INR'` | ISO 4217 currency code. Stored on the package for display; authoritative transaction currency is on `orders`. Default INR — the platform's primary market |
| `thumbnail_path` | `TEXT` | NULL | `NULL` | Supabase Storage path for the package cover image shown in the store. Signed URL generated dynamically. NULL until uploaded |
| `year_from` | `INTEGER` | NULL | `NULL` | Earliest exam year covered by papers in this package. NULL if not applicable (e.g., a subject-filtered bundle with papers from non-contiguous years). Derived from the papers inside but stored here for fast store-listing display without aggregating child rows |
| `year_to` | `INTEGER` | NULL | `NULL` | Latest exam year covered. Same derivation note as `year_from` |
| `total_papers` | `INTEGER` | NOT NULL | `0` | Denormalized count of published papers in this package. Updated by a trigger or background job when papers are added or their status changes. Used for store display without a COUNT query |
| `is_active` | `BOOLEAN` | NOT NULL | `TRUE` | When FALSE, the package is hidden from the store and no new purchases are allowed. Existing purchases retain access. Use for sunset/seasonal packages |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC last-modified timestamp. Trigger-maintained |
| `published_at` | `TIMESTAMPTZ` | NULL | `NULL` | UTC timestamp when the package was first made active and available for purchase. NULL until published |

---

### Primary Key

```sql
PRIMARY KEY (package_id)
```

---

### Foreign Keys

```sql
institute_id → institutes.institute_id             ON DELETE RESTRICT   ON UPDATE RESTRICT
stream_id    → streams.stream_id                   ON DELETE RESTRICT   ON UPDATE RESTRICT
```

> Both use `RESTRICT`. A package anchors content and purchase history; neither its institute nor its stream can be deleted while packages reference them.

---

### Unique Constraints

None at DB level. An institute may publish multiple packages for the same stream (e.g., a full bundle and a recent-years-only bundle). Name uniqueness within an institute is a UX suggestion enforced with a warning at the application layer, not a DB constraint.

---

### CHECK Constraints

```sql
CHECK (char_length(name) >= 3)
CHECK (price >= 0)
CHECK (char_length(currency) = 3)
CHECK (year_from IS NULL OR (year_from >= 1990 AND year_from <= 2100))
CHECK (year_to   IS NULL OR (year_to   >= 1990 AND year_to   <= 2100))
CHECK (year_from IS NULL OR year_to IS NULL OR year_to >= year_from)
CHECK (total_papers >= 0)
CHECK (
  (is_active = TRUE  AND published_at IS NOT NULL)
  OR (is_active = FALSE)
)
```

> The `year_from <= year_to` CHECK prevents data entry errors where the range is inverted.

> The `is_active / published_at` CHECK ensures a package cannot become active without a publication timestamp. It allows `is_active = FALSE` with a NULL `published_at` (a package that was configured but never published).

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_pyq_packages_institute_active` | `(institute_id, is_active)` | B-tree | Store listing: all active packages within an institute |
| `idx_pyq_packages_stream_active` | `(stream_id, is_active)` | B-tree | Stream-filtered store browsing — primary student discovery pattern |
| `idx_pyq_packages_price` | `(institute_id, price)` WHERE `is_active = TRUE` | Partial B-tree | Price-sorted store listing |

---

### Soft Delete Strategy

`pyq_packages` does not use `deleted_at`. Set `is_active = FALSE` to delist a package from the store. The row is permanently retained because `student_pyq_purchases` and `order_items` reference it. Hard deletion is blocked at the RLS level.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `updated_at` | ✅ | Required; trigger-maintained |
| `published_at` | ✅ | Business-critical: when did this package go on sale |
| `created_by` | ❌ | Always an admin action; track via `audit_logs` (Domain 8) |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE pyq_package | `RESTRICT` | Referenced by `pyq_papers`, `pyq_package_unlocks`, `student_pyq_purchases`, `order_items` |
| DELETE stream | `RESTRICT` | Cannot delete a stream with packages assigned to it |
| UPDATE package_id | `RESTRICT` | PK must not change |

---

### Supabase RLS Considerations

```
Table: pyq_packages
RLS: ENABLED

Policies:

SELECT:
  - All authenticated users within the institute may read active packages
    (store browsing is open to all; access to paper content is gated separately).
    USING: institute_id = get_my_institute_id()
      AND is_active = TRUE

  - Admins may read all packages within their institute regardless of is_active
    (management view).
    USING: institute_id = get_my_institute_id()
      AND (SELECT role FROM profiles WHERE profile_id = auth.uid()) = 'admin'

INSERT:
  - Admins only. Via Edge Function to ensure published_at is set correctly.

UPDATE:
  - Admins only. Includes toggling is_active and updating price/description.

DELETE:
  - Blocked at RLS level for all roles.
```

---

### Backend Developer Notes

1. **`total_papers` maintenance:** Update `total_papers` via a `AFTER INSERT OR UPDATE OR DELETE` trigger on `pyq_papers` that recomputes `COUNT(*) WHERE package_id = ? AND is_published = TRUE`. Do not rely on application-layer updates — they create race conditions under concurrent admin edits.

2. **`year_from` / `year_to` maintenance:** These are convenience denormalizations for store display. Recompute them in the same trigger as `total_papers`: `MIN(year) / MAX(year) FROM pyq_papers WHERE package_id = ? AND is_published = TRUE`. Accept stale-by-one-trigger values.

3. **Free packages:** A `price = 0.00` package still requires a `student_pyq_purchases` row for access control. The checkout flow should auto-create the purchase row for free packages without requiring payment. This keeps the access control model uniform — always check `student_pyq_purchases`, never special-case free packages at the permission layer.

4. **Currency:** INR is the default but the platform is designed multi-currency. The `currency` column on `pyq_packages` is for display only. The authoritative transaction currency and exchange rate are on `orders` and `payments` in Domain 7.

---

## Table 2: `pyq_package_unlocks`

### Purpose

Explicit enumeration of which asset types a package grants access to. A purchased package does not automatically unlock everything — the unlock type controls which content is accessible.

The three asset types in scope for v1:

- `pdf` — the original question paper as a downloadable PDF
- `solutions` — the answer key and solution PDF
- `mock_test` — the ability to attempt the paper as a timed mock test (requires a `pyq_mock_mappings` row to exist for the paper)

This explicit model is more maintainable than boolean columns on `pyq_packages`. Adding a new asset type (e.g., `video_solutions`, `chapter_notes`) requires no schema change — only a new `unlock_type` value and the relevant asset row.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `unlock_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `package_id` | `UUID` | NOT NULL | — | FK → `pyq_packages.package_id`. The package this unlock belongs to |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS |
| `unlock_type` | `VARCHAR(50)` | NOT NULL | — | The asset type unlocked. Values: `pdf`, `solutions`, `mock_test`. Not an enum — new asset types must not require a migration |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC creation timestamp |

---

### Primary Key

```sql
PRIMARY KEY (unlock_id)
```

---

### Foreign Keys

```sql
package_id   → pyq_packages.package_id            ON DELETE CASCADE    ON UPDATE RESTRICT
institute_id → institutes.institute_id            ON DELETE RESTRICT   ON UPDATE RESTRICT
```

> `package_id` uses `CASCADE`. Unlock rows are a configuration detail of their package and have no independent value.

---

### Unique Constraints

```sql
UNIQUE (package_id, unlock_type)
```

> A package can unlock each asset type at most once. Prevents duplicate unlock rows from concurrent admin edits.

---

### CHECK Constraints

```sql
CHECK (char_length(unlock_type) >= 1)
```

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_pyq_package_unlocks_package_id` | `(package_id)` | B-tree | Fetch all unlocks for a package — primary access-check query |
| `idx_pyq_package_unlocks_package_type` | `(package_id, unlock_type)` | B-tree | Covered by UNIQUE constraint |

---

### Soft Delete Strategy

No soft delete. Unlock rows are inserted and deleted as the package configuration changes. Removing an unlock type from a package revokes that asset access for all future requests; existing download sessions (signed URLs) continue until their TTL expires.

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE pyq_package | `CASCADE` | Unlock configuration has no value without the package |
| UPDATE package_id | `RESTRICT` | Cannot move unlocks between packages |

---

### Supabase RLS Considerations

```
Table: pyq_package_unlocks
RLS: ENABLED

Policies:

SELECT:
  - Any authenticated user within the institute may read unlock rows for active packages
    (needed to display what a package includes in the store, before purchase).
    USING: institute_id = get_my_institute_id()
      AND EXISTS (
        SELECT 1 FROM pyq_packages pp
        WHERE pp.package_id = pyq_package_unlocks.package_id
          AND pp.is_active = TRUE
      )

  - Admins may read all unlock rows within their institute.

INSERT / UPDATE / DELETE:
  - Admins only.
```

---

### Backend Developer Notes

1. **Access check pattern:** When a student requests a gated asset (e.g., clicks "Download PDF"), the Edge Function must verify two things:
   - `student_pyq_purchases` has a row for `(student_id, package_id)` — the student has purchased
   - `pyq_package_unlocks` has a row for `(package_id, 'pdf')` — the package includes PDF access

   Both conditions must be true. Checking only the purchase is insufficient.

2. **`mock_test` unlock dependency:** The `mock_test` unlock type is meaningful only if a `pyq_mock_mappings` row exists for the paper. At package configuration time, admins should be warned if they add a `mock_test` unlock to a package that contains papers with no mock mapping. Enforce as a pre-save validation at the application layer, not a DB constraint.

---

## Table 3: `pyq_papers`

### Purpose

One row per official exam paper — a single sitting of an exam in a given year. Every paper belongs to exactly one `pyq_package` and one `stream`. Papers are the primary content unit of the PYQ domain.

A paper has two delivery modes that coexist independently:

**PDF mode:** The original question paper is stored in Supabase Storage as a PDF (`pdf_storage_path`). Students download it for offline reading. A separate solutions PDF is optionally stored (`solution_pdf_storage_path`).

**Mock mode:** When a `pyq_mock_mappings` row links this paper to a `mock_test`, the paper can be attempted as a timed test using the full Domain 5 attempt engine. The two modes are independent — a paper can have a PDF without a mock test, a mock test without a PDF, or both.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `paper_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `package_id` | `UUID` | NOT NULL | — | FK → `pyq_packages.package_id`. The package this paper belongs to. A paper belongs to exactly one package; if the same official exam paper needs to appear in two packages, create two rows (they may share the same `question` rows via `pyq_question_mappings`) |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS |
| `stream_id` | `UUID` | NOT NULL | — | FK → `streams.stream_id`. The exam stream this paper is from. Must match the parent package's `stream_id`. Stored here for direct joins without going through the package |
| `title` | `VARCHAR(300)` | NOT NULL | — | Display title. Examples: `NEET 2023 Official Paper`, `JEE Mains 2022 — January Session 1`, `NEET 2019 — Code P1` |
| `exam_year` | `INTEGER` | NOT NULL | — | The calendar year the exam was held. Used for chronological display and year-range filtering in the store |
| `exam_date` | `DATE` | NULL | `NULL` | The specific date the exam was held, if known. NULL for older papers where only the year is available. More precise than `exam_year` alone for exams held on multiple dates in a year |
| `exam_session` | `VARCHAR(100)` | NULL | `NULL` | Session or shift identifier for exams held in multiple shifts. Examples: `January Session 1`, `April Session 2`, `Morning Shift`. NULL for single-session exams |
| `total_questions` | `INTEGER` | NOT NULL | `0` | Denormalized count of questions mapped to this paper via `pyq_question_mappings`. Updated by trigger. Used for display without a COUNT join |
| `total_marks` | `INTEGER` | NULL | `NULL` | Total marks of the official paper. Used for display and for populating the linked `mock_test.total_marks` when a mock mapping is created |
| `duration_min` | `INTEGER` | NULL | `NULL` | Official exam duration in minutes. Used for display and for the linked `mock_test.duration_min` |
| `pdf_storage_bucket` | `VARCHAR(100)` | NULL | `NULL` | Supabase Storage bucket for the question paper PDF. NULL if no PDF asset has been uploaded |
| `pdf_storage_path` | `TEXT` | NULL | `NULL` | Storage path within `pdf_storage_bucket`. Signed URL generated dynamically at download time. NULL if no PDF |
| `solution_pdf_storage_bucket` | `VARCHAR(100)` | NULL | `NULL` | Supabase Storage bucket for the solutions PDF. NULL if no solutions PDF has been uploaded |
| `solution_pdf_storage_path` | `TEXT` | NULL | `NULL` | Storage path within `solution_pdf_storage_bucket`. NULL if no solutions PDF |
| `is_published` | `BOOLEAN` | NOT NULL | `FALSE` | When TRUE, the paper is visible to students who have purchased the package. When FALSE, it is in preparation (admin can see it, students cannot). Draft papers are common during initial package setup |
| `published_at` | `TIMESTAMPTZ` | NULL | `NULL` | UTC timestamp when this paper was first published. NULL until published |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC last-modified timestamp. Trigger-maintained |

---

### Primary Key

```sql
PRIMARY KEY (paper_id)
```

---

### Foreign Keys

```sql
package_id   → pyq_packages.package_id            ON DELETE RESTRICT   ON UPDATE RESTRICT
institute_id → institutes.institute_id            ON DELETE RESTRICT   ON UPDATE RESTRICT
stream_id    → streams.stream_id                  ON DELETE RESTRICT   ON UPDATE RESTRICT
```

> All three use `RESTRICT`. Papers reference purchase history and question mappings; none of their parents can be deleted while papers exist.

---

### Unique Constraints

```sql
UNIQUE (package_id, exam_year, exam_session)
```

> Prevents duplicate papers within a package for the same year and session. `exam_session` is included because an exam may have multiple shifts in the same year. NULL `exam_session` values are treated as a distinct value per PostgreSQL semantics — if two rows have the same `package_id` and `exam_year` but both have `exam_session = NULL`, the UNIQUE constraint will not catch them. Enforce single-session year uniqueness at the application layer when `exam_session IS NULL`.

---

### CHECK Constraints

```sql
CHECK (char_length(title) >= 3)
CHECK (exam_year >= 1990 AND exam_year <= 2100)
CHECK (total_questions >= 0)
CHECK (total_marks IS NULL OR total_marks > 0)
CHECK (duration_min IS NULL OR (duration_min > 0 AND duration_min <= 600))
CHECK (
  (pdf_storage_bucket IS NULL) = (pdf_storage_path IS NULL)
)
CHECK (
  (solution_pdf_storage_bucket IS NULL) = (solution_pdf_storage_path IS NULL)
)
CHECK (
  (is_published = TRUE  AND published_at IS NOT NULL)
  OR (is_published = FALSE)
)
```

> The paired NULL CHECKs on bucket/path columns ensure both are always set together, matching the storage pattern established in Domain 4 (`recordings`) and Domain 5 (`question_images`).

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_pyq_papers_package_published` | `(package_id, is_published)` | B-tree | All published papers in a package — primary student library query |
| `idx_pyq_papers_package_year` | `(package_id, exam_year DESC)` WHERE `is_published = TRUE` | Partial B-tree | Chronological paper listing within a package |
| `idx_pyq_papers_stream_year` | `(stream_id, exam_year DESC)` WHERE `is_published = TRUE` | Partial B-tree | Cross-package stream-level paper timeline (admin analytics) |

---

### Soft Delete Strategy

`pyq_papers` does not use `deleted_at`. Set `is_published = FALSE` to hide a paper from students. The row is retained because `pyq_question_mappings`, `pyq_solutions`, and `pyq_mock_mappings` reference it.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `updated_at` | ✅ | Required; trigger-maintained |
| `published_at` | ✅ | Business-significant: when did students gain access |
| `created_by` | ❌ | Always an admin action; track via `audit_logs` |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE pyq_paper | `RESTRICT` | Referenced by `pyq_question_mappings`, `pyq_solutions`, `pyq_mock_mappings` |
| DELETE pyq_package | `RESTRICT` | Papers cannot exist without their package |
| UPDATE paper_id | `RESTRICT` | PK must not change |

---

### Supabase RLS Considerations

```
Table: pyq_papers
RLS: ENABLED

Policies:

SELECT:
  - Students may read published papers only if they have purchased the parent package.
    USING: is_published = TRUE
      AND EXISTS (
        SELECT 1 FROM student_pyq_purchases sp
        JOIN student_details sd ON sd.student_id = sp.student_id
        WHERE sp.package_id = pyq_papers.package_id
          AND sd.profile_id = auth.uid()
      )

  NOTE: Paper metadata (title, exam_year, total_questions) may be exposed to all
  students in store-browsing context via a separate restricted view that excludes
  pdf_storage_path and solution_pdf_storage_path. Only purchased papers expose storage paths.

  - Admins may read all papers within their institute regardless of is_published.
    USING: institute_id = get_my_institute_id()
      AND (SELECT role FROM profiles WHERE profile_id = auth.uid()) = 'admin'

INSERT / UPDATE:
  - Admins only. PDF upload paths are set by the storage webhook after upload,
    never by direct client input.

DELETE:
  - Blocked at RLS level.
```

---

### Backend Developer Notes

1. **PDF storage path convention:** Follow `pyq/{institute_id}/{package_id}/{paper_id}/paper.pdf` and `pyq/{institute_id}/{package_id}/{paper_id}/solutions.pdf`. This structure makes institute-scoped storage quota queries trivial and cleanup straightforward.

2. **Signed URL TTL:** PYQ PDFs are long documents — students may read them for 30–60 minutes. Set signed URL TTL to 90 minutes minimum. For solutions PDFs, TTL can be shorter (15 minutes) since they are typically used as a quick reference after attempt review.

3. **`total_questions` trigger:** Maintain via `AFTER INSERT OR DELETE` on `pyq_question_mappings`: `UPDATE pyq_papers SET total_questions = (SELECT COUNT(*) FROM pyq_question_mappings WHERE paper_id = ?) WHERE paper_id = ?`.

4. **Package stream consistency:** At paper insert time, the Edge Function must verify that `pyq_papers.stream_id = pyq_packages.stream_id` for the parent package. This cross-entity check cannot be expressed as a simple FK constraint and must be enforced at the application layer.

---

## Table 4: `pyq_question_mappings`

### Purpose

Junction table linking `pyq_papers` to `questions`. Each row records that a specific question from the shared question bank appeared in a specific PYQ paper at a specific position.

The shared question bank model — where a question row is reused across PYQ papers and mock tests — is what enables cross-domain analytics: "this chapter has appeared in NEET 17 times over the last 10 years." That statistic is computed by joining `pyq_question_mappings` → `questions` → `chapters`, with no special PYQ-specific analytics tables needed.

The mapping is also what enables per-question solution authoring: `pyq_solutions` rows reference both a `paper_id` and a `question_id`, meaning solutions are scoped per paper (NEET 2022's solution for this question may differ from NEET 2021's solution for the same question if it appeared in both).

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `mapping_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key. A surrogate PK is used instead of the composite `(paper_id, question_id)` to simplify FK references from `pyq_solutions` |
| `paper_id` | `UUID` | NOT NULL | — | FK → `pyq_papers.paper_id`. The paper this question appeared in |
| `question_id` | `UUID` | NOT NULL | — | FK → `questions.question_id`. The question bank row for this question |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS |
| `order_sequence` | `INTEGER` | NOT NULL | — | The question's position within the paper (question number as it appeared in the official exam). 1-indexed. Used for ordered display in the PDF viewer and mock test delivery |
| `section_name` | `VARCHAR(100)` | NULL | `NULL` | Section label if the paper was divided into sections (e.g., Physics, Chemistry, Biology for NEET; Section A, Section B for JEE). NULL for single-section papers |
| `official_marks` | `NUMERIC(5,2)` | NULL | `NULL` | Marks awarded for a correct answer in the official exam. May differ from `questions.marks` (the default). Used when creating the linked `mock_test` to correctly populate `mock_test_questions.marks` |
| `official_negative_marks` | `NUMERIC(5,2)` | NULL | `NULL` | Official negative marks per wrong answer. May differ from `questions.negative_marks`. Same use case as `official_marks` |
| `added_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC timestamp when this mapping was created |

---

### Primary Key

```sql
PRIMARY KEY (mapping_id)
```

---

### Foreign Keys

```sql
paper_id     → pyq_papers.paper_id                ON DELETE RESTRICT   ON UPDATE RESTRICT
question_id  → questions.question_id              ON DELETE RESTRICT   ON UPDATE RESTRICT
institute_id → institutes.institute_id            ON DELETE RESTRICT   ON UPDATE RESTRICT
```

> Both `paper_id` and `question_id` use `RESTRICT`. A mapping is the record that a question appeared in a paper — this historical fact cannot be deleted. Use `is_published = FALSE` on the paper to hide it, not deletion of mappings.

---

### Unique Constraints

```sql
UNIQUE (paper_id, question_id)
UNIQUE (paper_id, order_sequence)
```

> First UNIQUE: a question may appear at most once per paper.

> Second UNIQUE: no two questions in the same paper share the same position number.

---

### CHECK Constraints

```sql
CHECK (order_sequence >= 1)
CHECK (official_marks IS NULL OR official_marks > 0)
CHECK (official_negative_marks IS NULL OR official_negative_marks >= 0)
```

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_pyq_question_mappings_paper_id` | `(paper_id, order_sequence)` | B-tree | Fetch all questions for a paper in order — primary paper delivery query |
| `idx_pyq_question_mappings_question_id` | `(question_id)` | B-tree | "Which papers contain this question?" — chapter frequency analytics |
| `idx_pyq_question_mappings_paper_section` | `(paper_id, section_name, order_sequence)` WHERE `section_name IS NOT NULL` | Partial B-tree | Section-filtered question delivery for multi-section papers |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE pyq_paper | `RESTRICT` | Mappings are the historical record of question appearance |
| DELETE question | `RESTRICT` | A question that has been mapped to a paper cannot be deleted |
| UPDATE mapping_id | `RESTRICT` | PK must not change |

---

### Supabase RLS Considerations

```
Table: pyq_question_mappings
RLS: ENABLED

Policies:

SELECT:
  - Students may read mappings for published papers they have purchased access to.
    USING: EXISTS (
      SELECT 1 FROM pyq_papers pp
      JOIN student_pyq_purchases sp ON sp.package_id = pp.package_id
      JOIN student_details sd ON sd.student_id = sp.student_id
      WHERE pp.paper_id = pyq_question_mappings.paper_id
        AND pp.is_published = TRUE
        AND sd.profile_id = auth.uid()
    )

  - Admins may read all mappings within their institute.
    USING: institute_id = get_my_institute_id()

INSERT / UPDATE / DELETE:
  - Admins only. Question mapping is an admin content-management operation.
  - DELETE is blocked at RLS level (use paper unpublish to hide content).
```

---

### Backend Developer Notes

1. **Question bank requirement:** Questions must be `status = 'published'` in the question bank before they can be mapped to a PYQ paper. The admin content tool must enforce this at the application layer. Mapping an unapproved question is a data integrity error.

2. **Mock test population:** When a `pyq_mock_mappings` row is created (linking a paper to a mock test), the Edge Function should auto-populate `mock_test_questions` from `pyq_question_mappings`, using `official_marks` and `official_negative_marks` if set, falling back to `questions.marks` and `questions.negative_marks` if NULL.

3. **Chapter frequency analytics:** The "how many times has this chapter appeared in NEET in the last 5 years?" query — a core selling point of the PYQ product — is:
   ```sql
   SELECT q.chapter_id, COUNT(*) AS appearances
   FROM pyq_question_mappings pqm
   JOIN questions q ON q.question_id = pqm.question_id
   JOIN pyq_papers pp ON pp.paper_id = pqm.paper_id
   JOIN pyq_packages pkg ON pkg.package_id = pp.package_id
   WHERE pkg.stream_id = :stream_id
     AND pp.exam_year >= EXTRACT(YEAR FROM NOW()) - 5
     AND pp.is_published = TRUE
   GROUP BY q.chapter_id
   ORDER BY appearances DESC
   ```
   This query scans `pyq_question_mappings` with `paper_id` → `pyq_papers` → filter. The `idx_pyq_question_mappings_paper_id` index covers it. For dashboard use, materialise this in `Domain 11 Analytics` rather than running it on every page load.

---

## Table 5: `pyq_solutions`

### Purpose

Per-question, per-paper solution records. One row per `(paper_id, question_id)` pair, storing the text explanation and optional video walkthrough for that question's official answer.

Solutions are intentionally scoped to a `(paper_id, question_id)` pair rather than just a `question_id` because the same question may appear in multiple papers and coaching institutes may want paper-specific solution context ("In the NEET 2022 official answer key, this question was controversially marked incorrect; see the official correction note below").

The relationship to `question_explanations` (Domain 5): `question_explanations` stores the canonical teacher-authored explanation for the question in general. `pyq_solutions` stores the official exam answer and paper-specific context. They serve different purposes and are shown in different UI contexts.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `solution_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `paper_id` | `UUID` | NOT NULL | — | FK → `pyq_papers.paper_id`. The paper this solution is for |
| `question_id` | `UUID` | NOT NULL | — | FK → `questions.question_id`. The specific question this solution covers. Must have a corresponding `pyq_question_mappings` row for this `(paper_id, question_id)` pair |
| `mapping_id` | `UUID` | NOT NULL | — | FK → `pyq_question_mappings.mapping_id`. Direct reference to the mapping row. Enforces that solutions can only exist for questions that are actually mapped to the paper. Eliminates the need for a dual-column uniqueness check |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS |
| `solution_text` | `TEXT` | NULL | `NULL` | Step-by-step solution in plain text or Markdown with LaTeX support. NULL if a text solution has not been authored yet |
| `solution_video_url` | `TEXT` | NULL | `NULL` | URL to a video solution walkthrough. May be a Supabase Storage signed URL path or an external video link. NULL if no video solution |
| `official_answer` | `TEXT` | NULL | `NULL` | The answer as published in the official answer key (e.g., `(B)`, `42`, `True`). Useful for disputed questions where the official key may differ from the correct answer in the question bank |
| `is_disputed` | `BOOLEAN` | NOT NULL | `FALSE` | When TRUE, the question's official answer was disputed or corrected after the exam. Used to display a disclaimer to students |
| `dispute_note` | `TEXT` | NULL | `NULL` | Explanation of the dispute or official correction. NULL unless `is_disputed = TRUE` |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC last-modified timestamp. Trigger-maintained |

---

### Primary Key

```sql
PRIMARY KEY (solution_id)
```

---

### Foreign Keys

```sql
paper_id     → pyq_papers.paper_id                ON DELETE RESTRICT   ON UPDATE RESTRICT
question_id  → questions.question_id              ON DELETE RESTRICT   ON UPDATE RESTRICT
mapping_id   → pyq_question_mappings.mapping_id   ON DELETE RESTRICT   ON UPDATE RESTRICT
institute_id → institutes.institute_id            ON DELETE RESTRICT   ON UPDATE RESTRICT
```

> All four use `RESTRICT`. Solutions are content that cannot be orphaned.

---

### Unique Constraints

```sql
UNIQUE (mapping_id)
```

> Enforces one solution per `(paper, question)` pair via the `mapping_id` reference. More precise than `UNIQUE (paper_id, question_id)` because it also validates the mapping exists.

---

### CHECK Constraints

```sql
CHECK (
  solution_text IS NOT NULL OR solution_video_url IS NOT NULL
  OR is_disputed = TRUE
)
CHECK (
  (is_disputed = TRUE  AND dispute_note IS NOT NULL)
  OR (is_disputed = FALSE AND dispute_note IS NULL)
)
```

> The first CHECK ensures a solution row always carries some substantive content — either text, a video, or a dispute flag. An empty solution row is not permitted.

> The second CHECK ensures `dispute_note` is always accompanied by `is_disputed = TRUE`.

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_pyq_solutions_mapping_id` | `(mapping_id)` | B-tree | Covered by UNIQUE constraint. Fetch solution for a specific paper-question pair |
| `idx_pyq_solutions_paper_id` | `(paper_id)` | B-tree | Fetch all solutions for a paper (batch load for solution viewer) |
| `idx_pyq_solutions_disputed` | `(paper_id)` WHERE `is_disputed = TRUE` | Partial B-tree | Admin review: all disputed questions in a paper |

---

### Soft Delete Strategy

`pyq_solutions` rows are never deleted. Update `solution_text` or `solution_video_url` to revise. Use `is_disputed` + `dispute_note` to annotate corrections rather than replacing the row.

---

### Supabase RLS Considerations

```
Table: pyq_solutions
RLS: ENABLED

Policies:

SELECT:
  - Students may read solutions for papers they have purchased access to,
    AND the package unlocks 'solutions'.
    USING: EXISTS (
      SELECT 1 FROM pyq_papers pp
      JOIN student_pyq_purchases sp ON sp.package_id = pp.package_id
      JOIN student_details sd ON sd.student_id = sp.student_id
      JOIN pyq_package_unlocks ppu ON ppu.package_id = pp.package_id
      WHERE pp.paper_id = pyq_solutions.paper_id
        AND ppu.unlock_type = 'solutions'
        AND sd.profile_id = auth.uid()
    )

  NOTE: Solutions must NOT be served to students who have only purchased PDF access.
  The 'solutions' unlock type is checked explicitly here.

  - Admins may read all solutions within their institute.

INSERT / UPDATE:
  - Admins only.

DELETE:
  - Blocked at RLS level.
```

---

### Backend Developer Notes

1. **Solution completeness tracking:** An admin dashboard query for "papers with incomplete solutions" is a common ops need:
   ```sql
   SELECT pp.paper_id, pp.title,
     COUNT(pqm.mapping_id) AS total_questions,
     COUNT(ps.solution_id) AS solutions_authored,
     COUNT(pqm.mapping_id) - COUNT(ps.solution_id) AS missing
   FROM pyq_papers pp
   JOIN pyq_question_mappings pqm ON pqm.paper_id = pp.paper_id
   LEFT JOIN pyq_solutions ps ON ps.mapping_id = pqm.mapping_id
   WHERE pp.institute_id = :institute_id
   GROUP BY pp.paper_id, pp.title
   HAVING COUNT(pqm.mapping_id) > COUNT(ps.solution_id)
   ORDER BY missing DESC
   ```

2. **Solution access timing:** Unlike Domain 5 where explanations are blocked during an active attempt, PYQ solutions may be shown any time after purchase (subject to the `solutions` unlock). The PDF solution booklet is a reference document, not an attempt-gated asset.

3. **`official_answer` vs question bank correct option:** If `official_answer` contradicts `question_options.is_correct`, flag this discrepancy in the admin tool. This situation arises when an official answer key correction was issued after the question was mapped. The question bank should be treated as authoritative for mock test scoring; `official_answer` is informational context for the student.

---

## Table 6: `pyq_mock_mappings`

### Purpose

Links a `pyq_paper` to a `mock_test`, enabling the paper to be attempted as a timed, scored test through the Domain 5 attempt engine.

This is a 1:1 junction. One paper maps to at most one mock test; one mock test is linked to at most one paper (enforced via unique constraints on both sides). The `mock_test` row is owned and managed by the PYQ admin workflow, but once created it is a fully standard `mock_tests` row — the attempt engine has no knowledge of PYQ.

The mapping is optional. Not every paper needs a mock test version. A paper may exist with PDF and solutions but no mock mode, or with PDF and mock mode but no solutions, depending on what the package's `pyq_package_unlocks` configuration includes.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `mapping_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `paper_id` | `UUID` | NOT NULL | — | FK → `pyq_papers.paper_id`. The paper being mapped |
| `test_id` | `UUID` | NOT NULL | — | FK → `mock_tests.test_id`. The mock test that delivers this paper as an attempt |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC creation timestamp |
| `created_by` | `UUID` | NULL | `NULL` | FK → `profiles.profile_id`. The admin who created this mapping. NULL for system-generated mappings |

---

### Primary Key

```sql
PRIMARY KEY (mapping_id)
```

---

### Foreign Keys

```sql
paper_id     → pyq_papers.paper_id                ON DELETE RESTRICT   ON UPDATE RESTRICT
test_id      → mock_tests.test_id                 ON DELETE RESTRICT   ON UPDATE RESTRICT
institute_id → institutes.institute_id            ON DELETE RESTRICT   ON UPDATE RESTRICT
created_by   → profiles.profile_id               ON DELETE SET NULL   ON UPDATE RESTRICT
```

> `paper_id` and `test_id` both use `RESTRICT`. Once a mock test has been attempted by students, neither the paper nor the test can be deleted. The mapping is the record of this relationship.

> `created_by` uses `SET NULL`. If the admin's profile is deactivated, the mapping row is preserved.

---

### Unique Constraints

```sql
UNIQUE (paper_id)
UNIQUE (test_id)
```

> `UNIQUE (paper_id)` — one paper maps to at most one mock test.

> `UNIQUE (test_id)` — one mock test is the delivery mechanism for at most one paper. This prevents a `mock_test` row from being shared across two papers (which would produce incoherent attempt results).

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_pyq_mock_mappings_paper_id` | `(paper_id)` | B-tree | Covered by UNIQUE constraint |
| `idx_pyq_mock_mappings_test_id` | `(test_id)` | B-tree | Covered by UNIQUE constraint |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE pyq_paper | `RESTRICT` | Mapping must be manually removed before paper deletion |
| DELETE mock_test | `RESTRICT` | Mapping must be manually removed before test deletion |
| UPDATE mapping_id | `RESTRICT` | PK must not change |

---

### Supabase RLS Considerations

```
Table: pyq_mock_mappings
RLS: ENABLED

Policies:

SELECT:
  - Students may read the mapping for papers they have purchased with 'mock_test' unlock.
    USING: EXISTS (
      SELECT 1 FROM pyq_papers pp
      JOIN student_pyq_purchases sp ON sp.package_id = pp.package_id
      JOIN student_details sd ON sd.student_id = sp.student_id
      JOIN pyq_package_unlocks ppu ON ppu.package_id = pp.package_id
      WHERE pp.paper_id = pyq_mock_mappings.paper_id
        AND ppu.unlock_type = 'mock_test'
        AND sd.profile_id = auth.uid()
    )
  Students need this to resolve which test_id to use when starting an attempt.

  - Admins may read all mappings within their institute.

INSERT / UPDATE / DELETE:
  - Admins only. Managed via the PYQ admin tool.
```

---

### Backend Developer Notes

1. **Mock test creation workflow:** When an admin creates a mock test from a PYQ paper, the Edge Function must:
   - Create a `mock_tests` row with `test_type = 'pyq_paper'`, copying `title`, `duration_min`, `total_marks` from the paper
   - Populate `mock_test_questions` from `pyq_question_mappings`, using `official_marks` / `official_negative_marks` where set
   - Set `mock_tests.published_at` and `status = 'published'` atomically (PYQ mocks bypass the `pending_approval` step since the paper content is admin-managed, not teacher-submitted)
   - Insert the `pyq_mock_mappings` row linking the two

   All steps are atomic in a single transaction. If any step fails, the whole creation is rolled back.

2. **Access check at attempt creation:** When a student clicks "Attempt as Mock Test", the attempt creation Edge Function must verify:
   - `student_pyq_purchases` row exists for the student + package
   - `pyq_package_unlocks` row exists for `(package_id, 'mock_test')`
   - `pyq_mock_mappings` row exists for the paper
   - The linked `mock_test.status = 'published'`

   Only after all four checks pass should a `mock_attempt` row be created.

3. **Attempt limit for PYQ mocks:** PYQ papers are practice material, not graded assessments. Set `mock_tests.attempt_limit = NULL` (unlimited) for PYQ-linked mock tests unless the institute explicitly wants to cap retakes.

---

## Table 7: `student_pyq_purchases`

### Purpose

Records each student's purchase of a PYQ package. One row per student per package. This is the access-control anchor for the entire PYQ domain — every gated query in every other table checks against this table.

`student_pyq_purchases` records that access was granted, not how it was paid for. The payment details live in `orders`, `order_items`, and `payments` (Domain 7). The purchase row may be created by a completed payment, a manual admin grant, or an automatic grant from a subscription plan that includes PYQ access.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `purchase_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `student_id` | `UUID` | NOT NULL | — | FK → `student_details.student_id`. The student who has been granted access |
| `package_id` | `UUID` | NOT NULL | — | FK → `pyq_packages.package_id`. The package this student has access to |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS |
| `order_item_id` | `UUID` | NULL | `NULL` | FK → `order_items.item_id`. The specific order line item that created this purchase. NULL for admin-granted or subscription-derived access. Used for refund processing and purchase history linkage |
| `granted_by` | `UUID` | NULL | `NULL` | FK → `profiles.profile_id`. The admin who manually granted this access. NULL for payment-triggered purchases. Set to admin profile_id for complimentary or corrective grants |
| `access_type` | `VARCHAR(20)` | NOT NULL | `'purchase'` | How access was obtained. Values: `purchase` (paid via order), `admin_grant` (manual), `subscription` (included in an active subscription plan). Not an enum |
| `purchased_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC timestamp when access was granted. For payment-triggered purchases, this is set when the payment is confirmed, not when the order was placed |
| `expires_at` | `TIMESTAMPTZ` | NULL | `NULL` | UTC timestamp when access expires. NULL means perpetual access (the typical case for one-time PYQ purchases). Set for time-limited access granted via subscription |
| `is_active` | `BOOLEAN` | NOT NULL | `TRUE` | When FALSE, access is revoked. Used for refunds, subscription lapses, or admin revocation. FALSE does not delete the row — the purchase history is retained |
| `revoked_at` | `TIMESTAMPTZ` | NULL | `NULL` | UTC timestamp when access was revoked. NULL unless `is_active = FALSE` |
| `revoked_reason` | `TEXT` | NULL | `NULL` | Reason for revocation. Examples: `refund_processed`, `subscription_lapsed`, `admin_revoke`. NULL unless `is_active = FALSE` |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC last-modified timestamp. Trigger-maintained |

---

### Primary Key

```sql
PRIMARY KEY (purchase_id)
```

---

### Foreign Keys

```sql
student_id   → student_details.student_id         ON DELETE RESTRICT   ON UPDATE RESTRICT
package_id   → pyq_packages.package_id            ON DELETE RESTRICT   ON UPDATE RESTRICT
institute_id → institutes.institute_id            ON DELETE RESTRICT   ON UPDATE RESTRICT
order_item_id → order_items.item_id               ON DELETE SET NULL   ON UPDATE RESTRICT
granted_by   → profiles.profile_id               ON DELETE SET NULL   ON UPDATE RESTRICT
```

> `order_item_id` uses `SET NULL`. If the order item row is ever deleted (a rare, service_role-only operation), the purchase record is preserved but the order linkage is nulled.

> `granted_by` uses `SET NULL`. If the admin's profile is deactivated, the purchase record is preserved.

---

### Unique Constraints

```sql
UNIQUE (student_id, package_id)
```

> One purchase record per student per package. Multiple purchases of the same package (e.g., re-purchase after refund) are handled by updating `is_active` on the existing row, not by inserting a new row. Prevents duplicate access records.

---

### CHECK Constraints

```sql
CHECK (
  (is_active = FALSE AND revoked_at IS NOT NULL AND revoked_reason IS NOT NULL)
  OR (is_active = TRUE  AND revoked_at IS NULL  AND revoked_reason IS NULL)
)
CHECK (expires_at IS NULL OR expires_at > purchased_at)
```

> The revocation consistency CHECK ensures `revoked_at` and `revoked_reason` are always set together when and only when `is_active = FALSE`.

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_student_pyq_purchases_student_id` | `(student_id, is_active)` | B-tree | Student's purchased packages list — primary access-check query |
| `idx_student_pyq_purchases_package_id` | `(package_id, is_active)` | B-tree | Package-level purchase count (admin analytics) |
| `idx_student_pyq_purchases_student_package` | `(student_id, package_id)` | B-tree | Covered by UNIQUE constraint |
| `idx_student_pyq_purchases_expires` | `(expires_at)` WHERE `expires_at IS NOT NULL AND is_active = TRUE` | Partial B-tree | Background job: find purchases that have expired and need is_active set to FALSE |

---

### Soft Delete Strategy

`student_pyq_purchases` rows are never hard-deleted. Revoke access by setting `is_active = FALSE` with `revoked_at` and `revoked_reason`. The row is retained for purchase history, refund audit, and financial reporting.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `updated_at` | ✅ | Required; trigger-maintained |
| `purchased_at` | ✅ | Business-significant: when access was granted |
| `revoked_at` | ✅ | Business-significant: when access was removed |
| `granted_by` | ✅ | Admin accountability for manual grants |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE student | `RESTRICT` | Student is soft-deleted; purchase history must be retained |
| DELETE pyq_package | `RESTRICT` | Purchase records reference the package |
| UPDATE purchase_id | `RESTRICT` | PK must not change |

---

### Supabase RLS Considerations

```
Table: student_pyq_purchases
RLS: ENABLED

Policies:

SELECT:
  - Students may read their own purchase rows only.
    USING: student_id = (
      SELECT student_id FROM student_details WHERE profile_id = auth.uid()
    )

  - Admins may read all purchases within their institute.
    USING: institute_id = get_my_institute_id()

INSERT:
  - Via Edge Function only. Purchase creation is server-side after payment confirmation
    or admin grant. Never a direct client insert.

UPDATE:
  - Via Edge Function only (revocation, expiry processing).
  - Students may not update any purchase field.

DELETE:
  - Blocked at RLS level.
```

---

### Backend Developer Notes

1. **Payment webhook flow:** When a payment for a PYQ package is confirmed (Domain 7 payment webhook), the Edge Function must:
   - Verify the `order_item` references the correct `package_id`
   - Check for an existing `student_pyq_purchases` row for `(student_id, package_id)`:
     - If none exists → INSERT with `access_type = 'purchase'`, `order_item_id = ?`, `is_active = TRUE`
     - If one exists with `is_active = FALSE` (prior refund) → UPDATE: set `is_active = TRUE`, clear `revoked_at` / `revoked_reason`, set `purchased_at = NOW()`, update `order_item_id`
     - If one exists with `is_active = TRUE` → log a warning and do nothing (duplicate webhook)

2. **Subscription-derived access:** If a student's active subscription plan includes PYQ access (via `subscription_plan_unlocks`), the subscription activation Edge Function should create `student_pyq_purchases` rows with `access_type = 'subscription'` and `expires_at = subscription.end_date`. On subscription lapse, a background job sets `is_active = FALSE` on all `subscription`-type purchase rows where `expires_at < NOW()`.

3. **Access check performance:** The access check query — "does student X have active access to package Y?" — runs on every gated asset request. Index `(student_id, package_id)` is covered by the UNIQUE constraint and should resolve in O(1). Cache this result in a short-lived token (5-minute TTL) at the Edge Function layer rather than hitting the DB on every signed URL generation request.

4. **Refund processing:** To process a refund: set `is_active = FALSE`, `revoked_at = NOW()`, `revoked_reason = 'refund_processed'`. Also invalidate any active signed URLs for the student's PDFs by rotating the Supabase Storage signed URL secret for that storage path (if the provider supports it), or accept that existing signed URLs remain valid until their TTL expires (simpler, and acceptable for most use cases given short TTLs).

---

## Domain 6 — Design Decisions Summary

| Decision | Choice | Reason |
|----------|--------|--------|
| PYQ questions in shared question bank | `questions` rows via `pyq_question_mappings` | Single source of truth for question content, versioning, and chapter/subject analytics. Cross-domain analytics (chapter frequency) work without special PYQ tables |
| `pyq_package_unlocks` as explicit rows | Explicit junction vs boolean columns on `pyq_packages` | Adding new asset types (`video_solutions`, `chapter_notes`) requires no schema change — only a new `unlock_type` value. Boolean columns would require a migration for each new asset type |
| `pyq_solutions` scoped to `(paper, question)` | Yes — `mapping_id` FK enforces the scope | Same question in two papers may have different official answers (disputed questions, code variants). Paper-scoped solutions support this correctly |
| `mapping_id` surrogate PK on `pyq_question_mappings` | Surrogate UUID rather than composite `(paper_id, question_id)` | `pyq_solutions` needs a single FK to the mapping; a surrogate PK makes that FK clean and avoids a composite FK |
| `pyq_mock_mappings` as a separate table | 1:1 junction table rather than `test_id` FK on `pyq_papers` | Keeps PYQ paper table clean. A paper may never have a mock test; a nullable FK on `pyq_papers` would always be NULL for simple PDF-only papers. The junction also makes it easy to enforce bidirectional uniqueness |
| Mock test creation for PYQ papers bypasses approval workflow | `status = 'published'` set directly | PYQ papers are official government exam papers; they do not need a teacher-authored approval cycle. Admins directly publish |
| `student_pyq_purchases.is_active` boolean + revocation fields | Explicit revoke rather than hard delete | Purchase history is required for financial audit, refund processing, and customer support. Rows are never deleted |
| `access_type` on `student_pyq_purchases` | VARCHAR, not enum | `purchase`, `admin_grant`, `subscription` covers v1; future access types (e.g., `bundle`, `trial`) can be added without a migration |
| `expires_at` on `student_pyq_purchases` | Nullable timestamp | Perpetual access (the standard PYQ purchase model) is expressed as NULL. Time-limited access (subscription-derived) sets a specific timestamp. No separate expiry table needed |
| `institute_id` on all tables | Denormalized everywhere | Consistent RLS performance pattern across all domains; mandatory for multi-tenant isolation |

---

## Domain 6 — Enum Types Used

All enums are defined globally in the pre-domain migration (see Domain 1 Pre-Domain Notes).

This domain introduces no new PostgreSQL enums. All variable fields use `VARCHAR` intentionally:

| Field | Type | Values | Reason not an enum |
|-------|------|--------|--------------------|
| `pyq_package_unlocks.unlock_type` | `VARCHAR(50)` | `pdf`, `solutions`, `mock_test` | New asset types must not require a migration |
| `pyq_papers.exam_session` | `VARCHAR(100)` | Free-form | Exam session names vary by exam board and year |
| `student_pyq_purchases.access_type` | `VARCHAR(20)` | `purchase`, `admin_grant`, `subscription` | Future access models must not require a migration |

---

## Domain 6 — Relationships to Other Domains

| This Table | References | Via Column | Domain |
|------------|-----------|------------|--------|
| `pyq_packages` | `institutes` | `institute_id` | Domain 1 (Identity) |
| `pyq_packages` | `streams` | `stream_id` | Domain 2 (Academic Structure) |
| `pyq_papers` | `pyq_packages` | `package_id` | This domain |
| `pyq_papers` | `streams` | `stream_id` | Domain 2 (Academic Structure) |
| `pyq_question_mappings` | `pyq_papers` | `paper_id` | This domain |
| `pyq_question_mappings` | `questions` | `question_id` | Domain 5 (Assessment) |
| `pyq_solutions` | `pyq_question_mappings` | `mapping_id` | This domain |
| `pyq_solutions` | `questions` | `question_id` | Domain 5 (Assessment) |
| `pyq_mock_mappings` | `pyq_papers` | `paper_id` | This domain |
| `pyq_mock_mappings` | `mock_tests` | `test_id` | Domain 5 (Assessment) |
| `student_pyq_purchases` | `student_details` | `student_id` | Domain 1 (Identity) |
| `student_pyq_purchases` | `pyq_packages` | `package_id` | This domain |
| `student_pyq_purchases` | `order_items` | `order_item_id` | Domain 7 (Commerce) |

| This Table | Referenced By | Via Column | Domain |
|------------|--------------|------------|--------|
| `pyq_packages` | `order_items` | `package_id` | Domain 7 (Commerce) |
| `pyq_packages` | `student_pyq_purchases` | `package_id` | This domain |
| `pyq_mock_mappings` | (accessed via `test_id` on mock_attempts) | — | Domain 5 (Assessment) |

---

*Domain 6 complete — v1.0. Awaiting approval before proceeding to Domain 7 — Commerce (Order · OrderItem · Payment · Invoice).*
