# EdTech Platform — Database Schema Specification
## Domain 2: Academic Structure & Batch Management
### Tables: Stream · Subject · Chapter · Topic · Batch · BatchStudent · BatchTeacher

**Document version:** 1.0
**ERD reference:** ERD v3.0 (Frozen)
**Depends on:** Domain 1 (institutes, profiles, teacher_details, student_details)
**PostgreSQL target:** 16
**Supabase compatibility:** Yes

---

## Domain Overview

This domain covers two closely related concerns that are deliberately grouped together:

**Academic Structure** (`streams → subjects → chapters → topics`) forms the content taxonomy of the platform. Every piece of content, every question, every live class, and every mock test is anchored to a node in this hierarchy. Getting the hierarchy right is critical — it underpins navigation, filtering, analytics, and RLS across every other domain.

**Batch Management** (`batch`, `batch_student`, `batch_teacher`) is the operational grouping of students and teachers within a stream. A batch is the primary unit of teaching delivery. Live classes are scheduled to batches. Subscriptions gate access by batch. Analytics are sliced by batch.

The two concerns are grouped here because `Batch` has a direct FK to `Stream` — they share the same parent and are documented together.

---

## Domain 2 — Inheritance Note

Following the decision approved in Domain 1: **`institute_id` is carried directly on every table in this domain** where it is architecturally relevant. This enables single-column RLS policies on every table without joins.

The propagation is as follows:

| Table | institute_id Source |
|-------|---------------------|
| `streams` | Direct FK to `institutes` |
| `subjects` | Inherited via `stream_id` — **no direct `institute_id`** (see rationale below) |
| `chapters` | Inherited via `subject_id → stream_id` — **no direct `institute_id`** |
| `topics` | Inherited via `chapter_id → subject_id → stream_id` — **no direct `institute_id`** |
| `batches` | Direct FK to `institutes` (confirmed in ERD v3) |
| `batch_students` | Inherits via `batch_id` |
| `batch_teachers` | Inherits via `batch_id` |

**Rationale for not denormalizing `institute_id` onto subjects/chapters/topics:**

`subjects`, `chapters`, and `topics` are low-write, heavily-cached reference tables. An institute with 5 streams, 10 subjects per stream, 20 chapters per subject, and 10 topics per chapter yields roughly 10,000 rows total — tiny by database standards. They are almost always queried via their parent FK (`stream_id`, `subject_id`, `chapter_id`), which is already indexed. Adding `institute_id` to each would introduce a redundant column that could theoretically diverge from the parent's `institute_id` if migration logic is wrong.

The correct approach for these tables: RLS policies resolve institute context through the parent FK, and the query pattern is always scoped by stream/subject/chapter anyway.

**Exception:** If query performance on `chapters` or `subjects` proves inadequate in staging, add `institute_id` as a denormalized column at that point. Do not add it prematurely.

---

## Table 1: `streams`

### Purpose

A stream represents a major examination or academic programme offered by an institute. Examples: `NEET`, `JEE Mains`, `JEE Advanced`, `UPSC`, `CA Foundation`. Streams are the highest node in the academic hierarchy — they own subjects, batches, mock tests, and PYQ packages.

Each institute defines its own streams. Two institutes can both have a `NEET` stream, but they are completely separate entities with no shared data.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `stream_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Direct for RLS |
| `name` | `VARCHAR(100)` | NOT NULL | — | Display name. Example: `NEET 2026`, `JEE Mains` |
| `code` | `VARCHAR(20)` | NOT NULL | — | Short uppercase identifier. Example: `NEET`, `JEE-M`. Unique per institute |
| `description` | `TEXT` | NULL | `NULL` | Optional longer description shown in the admin interface |
| `is_active` | `BOOLEAN` | NOT NULL | `TRUE` | Inactive streams are hidden from students and teachers. Their historical data (batches, content, results) remains intact |
| `display_order` | `SMALLINT` | NOT NULL | `0` | Controls the order in which streams appear in dropdowns and navigation. Lower number appears first |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC last-update timestamp. Trigger-maintained |

---

### Primary Key

```
PRIMARY KEY (stream_id)
```

---

### Foreign Keys

```
institute_id → institutes.institute_id   ON DELETE RESTRICT   ON UPDATE RESTRICT
```

---

### Unique Constraints

```
UNIQUE (institute_id, code)
```

> Two institutes may both have a stream coded `NEET`. The constraint is scoped per institute. `code` alone is not globally unique.

---

### CHECK Constraints

```
CHECK (char_length(name) >= 2)
CHECK (char_length(code) >= 2)
CHECK (code ~ '^[A-Z0-9_-]+$')
CHECK (display_order >= 0)
```

> `code` is enforced as uppercase alphanumeric with hyphens and underscores. This keeps codes consistent and avoids case-sensitivity bugs in reporting queries. Enforce uppercase conversion at the application layer before insert.

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_streams_institute_active` | `(institute_id, is_active)` | B-tree | All stream listing queries filter by institute + active status |
| `idx_streams_institute_display_order` | `(institute_id, display_order)` | B-tree | Ordered stream lists for navigation dropdowns |

> The UNIQUE constraint on `(institute_id, code)` already creates a B-tree index on those two columns, covering lookup-by-code queries.

---

### Soft Delete Strategy

`streams` uses `is_active = FALSE` for deactivation, not `deleted_at`. Streams are long-lived reference entities that accumulate years of content and attempt history. Hard-deleting a stream would cascade-destroy subjects, chapters, batches, content, questions, and mock tests — never acceptable in production.

When deactivating a stream:
- Set `is_active = FALSE`
- All child subjects, chapters, and topics remain — their data is preserved
- The stream no longer appears in student/teacher interfaces
- The admin can re-activate it at any time

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `updated_at` | ✅ | Trigger-maintained |
| `created_by` | ✅ Recommended | Add `created_by UUID FK → profiles.profile_id`. Admin who created the stream. Useful for audit trail |
| `updated_by` | ✅ Recommended | Add `updated_by UUID FK → profiles.profile_id NULLABLE`. Admin who last modified |

> **Note:** The ERD v3 does not explicitly list `created_by`/`updated_by` on `streams`. However, since streams are admin-created configuration entities (not system-generated), these fields provide meaningful audit value. Add them. They follow the same pattern used in Domain 1's decision to track admin operations via `audit_logs`.

---

### Cascade Rules

| Action | Behaviour | Applies To | Reason |
|--------|-----------|------------|--------|
| DELETE stream | `RESTRICT` | Self | Streams own subjects, batches, mock tests, PYQ papers |
| UPDATE stream_id | `RESTRICT` | Self | PKs must never change |
| Institute deleted | `RESTRICT` (from institutes) | Parent | Already blocked at institute level |

---

### Supabase RLS Considerations

```
Table: streams
RLS: ENABLED

SELECT:
  - All authenticated users within the institute may read active streams.
    USING: institute_id = get_my_institute_id()
    (Students and teachers see all active streams; admin sees all including inactive)

  - Differentiate active/inactive visibility at the application query layer:
    Students/teachers: WHERE is_active = TRUE
    Admins: no is_active filter

INSERT:
  - Admins only.
    WITH CHECK:
      institute_id = get_my_institute_id()
      AND (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'

UPDATE:
  - Admins only. Same institute.
    USING: institute_id = get_my_institute_id()
    WITH CHECK: (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'

DELETE:
  - Blocked at RLS level. Deactivate via is_active instead.
```

---

### Backend Developer Notes

1. **Stream code immutability:** Once a stream code is assigned and content is tagged to it, treat `code` as immutable. Changing it requires updating denormalized references in reporting queries. If a rename is needed, change `name` only — `code` stays fixed.

2. **display_order gaps:** Use increments of 10 (10, 20, 30...) for `display_order` to allow insertion between existing values without resequencing. Provide a bulk-reorder API endpoint that updates `display_order` for all streams in a single transaction.

3. **is_active cascade to children:** The database does not cascade `is_active = FALSE` to subjects/chapters/topics — they remain active at the DB level. The application query layer is responsible for filtering children by parent active status. Document this in the API layer to prevent subtle bugs where a chapter appears active while its parent stream is not.

4. **Stream as the mock test scope:** `mock_tests.stream_id` references `streams.stream_id`. When querying available mock tests for a student, always filter by the streams they are enrolled in (via their batches).

---

## Table 2: `subjects`

### Purpose

A subject belongs to exactly one stream and represents an academic discipline within that exam. Examples: `Physics`, `Chemistry`, `Biology` within `NEET`; `Mathematics`, `Physics` within `JEE Mains`.

Subjects are the second level of the content hierarchy. All chapters, content, questions, and live classes are ultimately grouped under a subject for analytics and navigation.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `subject_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `stream_id` | `UUID` | NOT NULL | — | FK → `streams.stream_id`. The stream this subject belongs to |
| `name` | `VARCHAR(100)` | NOT NULL | — | Display name. Example: `Physics`, `Organic Chemistry` |
| `code` | `VARCHAR(20)` | NOT NULL | — | Short identifier. Example: `PHY`, `CHEM`, `BIO`. Unique within a stream |
| `display_order` | `SMALLINT` | NOT NULL | `0` | Controls subject ordering within a stream |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC last-update timestamp. Trigger-maintained |

---

### Primary Key

```
PRIMARY KEY (subject_id)
```

---

### Foreign Keys

```
stream_id → streams.stream_id   ON DELETE RESTRICT   ON UPDATE RESTRICT
```

---

### Unique Constraints

```
UNIQUE (stream_id, code)
```

> Subject code is unique within a stream. Two different streams (NEET and JEE) may both have a subject coded `PHY`.

---

### CHECK Constraints

```
CHECK (char_length(name) >= 2)
CHECK (char_length(code) >= 2)
CHECK (code ~ '^[A-Z0-9_-]+$')
CHECK (display_order >= 0)
```

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_subjects_stream_order` | `(stream_id, display_order)` | B-tree | Ordered subject listing per stream — primary navigation query |
| `idx_subjects_stream_id` | `(stream_id)` | B-tree | Covered by UNIQUE (stream_id, code) — no separate index needed; UNIQUE index suffices |

---

### Soft Delete Strategy

`subjects` has no soft delete mechanism. Subjects are reference data. If a subject must be removed, it should only be possible when it has no active chapters, content, questions, or live classes referencing it. Enforce via `RESTRICT` cascade — the database will block deletion if any child records exist.

If a subject needs to be hidden without deleting it, add `is_active BOOLEAN NOT NULL DEFAULT TRUE` at the next schema iteration. Do not add it now unless the product requirement exists.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `updated_at` | ✅ | Trigger-maintained |
| `created_by` | ✅ Recommended | Admin who created the subject |
| `updated_by` | ✅ Recommended | Admin who last modified |

---

### Cascade Rules

| Action | Behaviour | Applies To | Reason |
|--------|-----------|------------|--------|
| DELETE subject | `RESTRICT` | Self | Has chapters, content, questions, live classes as children |
| UPDATE subject_id | `RESTRICT` | Self | PK must not change |
| Stream deleted | `RESTRICT` (from streams) | Parent | Already blocked |

---

### Supabase RLS Considerations

```
Table: subjects
RLS: ENABLED

SELECT:
  - All authenticated users within the institute may read subjects.
    RLS resolves via stream_id → streams.institute_id.
    USING: EXISTS (
      SELECT 1 FROM streams s
      WHERE s.stream_id = subjects.stream_id
      AND s.institute_id = get_my_institute_id()
    )

  - Performance note: if this join is measured as slow at scale,
    add institute_id directly to subjects (denormalization upgrade path).

INSERT / UPDATE:
  - Admins only, within the same institute.
    Validate stream_id belongs to the admin's institute in the application layer
    before insert.

DELETE:
  - Blocked if chapters exist (RESTRICT cascade).
  - Blocked at RLS level for non-admins.
```

---

### Backend Developer Notes

1. **Subject-level analytics:** `live_classes.subject_id` and `questions.subject_id` carry direct subject references for analytics aggregation (teacher performance by subject, accuracy by subject). Subject is therefore both a hierarchical entity and an analytics dimension — keep it clean and avoid renaming subjects after content is tagged to them.

2. **Subject code consistency:** Standardise subject codes at platform level where possible (e.g. always `PHY` for Physics across institutes). This simplifies cross-institute reporting if ever needed. Document recommended codes in the admin interface.

3. **No cross-stream subjects:** The architecture decision (v2, P3) confirmed that subjects belong to exactly one stream with a direct FK — no junction table. This means if NEET Physics and JEE Physics have different syllabi (which they do), they are separate subject rows. This is the correct decision for coaching institutes.

---

## Table 3: `chapters`

### Purpose

A chapter belongs to exactly one subject and represents a named unit of the syllabus. Examples: `Laws of Motion`, `Thermodynamics`, `Electrochemistry`, `Cell Biology`.

Chapters are the primary content-tagging unit. Content uploads, questions, live classes, and analytics are all tagged at the chapter level. The `ChapterPerformance` analytics table tracks student accuracy per chapter. Performance reports identify weak and strong chapters by UUID.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `chapter_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `subject_id` | `UUID` | NOT NULL | — | FK → `subjects.subject_id`. The subject this chapter belongs to |
| `name` | `VARCHAR(150)` | NOT NULL | — | Chapter name. Example: `Laws of Motion`, `Coordination Compounds` |
| `description` | `TEXT` | NULL | `NULL` | Optional syllabus description or learning objectives for this chapter |
| `display_order` | `SMALLINT` | NOT NULL | `0` | Controls chapter ordering within a subject. Follows standard syllabus sequence |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC last-update timestamp. Trigger-maintained |

---

### Primary Key

```
PRIMARY KEY (chapter_id)
```

---

### Foreign Keys

```
subject_id → subjects.subject_id   ON DELETE RESTRICT   ON UPDATE RESTRICT
```

---

### Unique Constraints

```
UNIQUE (subject_id, name)
```

> Chapter names are unique within a subject. Two subjects may have a chapter named `Introduction` without conflict.

---

### CHECK Constraints

```
CHECK (char_length(name) >= 2)
CHECK (display_order >= 0)
```

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_chapters_subject_order` | `(subject_id, display_order)` | B-tree | Primary chapter listing query — ordered chapters within a subject |
| `idx_chapters_subject_id` | `(subject_id)` | B-tree | Covered by the above composite index |

---

### Soft Delete Strategy

Same as `subjects` — no soft delete at this stage. Deletion blocked by `RESTRICT` cascade if any content, questions, or live classes reference the chapter. If hiding chapters is required, add `is_active` at the next iteration.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `updated_at` | ✅ | Trigger-maintained |
| `created_by` | ✅ Recommended | Admin who created the chapter |
| `updated_by` | ✅ Recommended | Admin who last modified |

---

### Cascade Rules

| Action | Behaviour | Applies To | Reason |
|--------|-----------|------------|--------|
| DELETE chapter | `RESTRICT` | Self | Content, questions, live classes, chapter_performance all reference chapter_id |
| UPDATE chapter_id | `RESTRICT` | Self | PK must not change |
| Subject deleted | `RESTRICT` (from subjects) | Parent | Already blocked |

---

### Supabase RLS Considerations

```
Table: chapters
RLS: ENABLED

SELECT:
  - All authenticated users within the institute may read chapters.
    Resolve via subject_id → streams.institute_id.
    USING: EXISTS (
      SELECT 1 FROM subjects sub
      JOIN streams s ON s.stream_id = sub.stream_id
      WHERE sub.subject_id = chapters.subject_id
      AND s.institute_id = get_my_institute_id()
    )

  - Two-level join is acceptable at this table's cardinality (~10K rows max per institute).
    If denormalization is added (institute_id on subjects), simplify to a one-level join.

INSERT / UPDATE:
  - Admins only.

DELETE:
  - Blocked by RESTRICT cascade and RLS.
```

---

### Backend Developer Notes

1. **Chapter is the analytics anchor:** `chapter_performance.chapter_id`, `content.chapter_id`, `questions.chapter_id`, and `live_class.chapter_id` all point here. Renaming a chapter after these records exist is safe — the UUID reference does not change. However, communicate chapter name changes clearly in the admin interface to avoid confusion in existing reports.

2. **display_order matches syllabus sequence:** Populate `display_order` based on the standard exam syllabus order (e.g. NCERT chapter order for NEET). This is not an arbitrary sort — it has pedagogical meaning. Provide a bulk-reorder API.

3. **Chapter uniqueness within subject:** The `UNIQUE (subject_id, name)` constraint prevents duplicate chapter names within a subject. If an institute wants two chapters named similarly (e.g., `Organic Chemistry – Part 1` and `Organic Chemistry – Part 2`), they must use distinct names. Enforce this clearly in the UI.

---

## Table 4: `topics`

### Purpose

Topics are the optional fourth level of the academic hierarchy, below chapters. Examples: under `Laws of Motion` — `Newton's First Law`, `Friction`, `Circular Motion`. Under `Electrochemistry` — `Galvanic Cells`, `Nernst Equation`.

Topics provide sub-chapter granularity for content tagging and are marked as optional in the ERD. Not all institutes will use them. The schema must support them without requiring them.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `topic_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `chapter_id` | `UUID` | NOT NULL | — | FK → `chapters.chapter_id`. The chapter this topic belongs to |
| `name` | `VARCHAR(150)` | NOT NULL | — | Topic name. Example: `Newton's First Law`, `Redox Reactions` |
| `display_order` | `SMALLINT` | NOT NULL | `0` | Controls topic ordering within a chapter |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC last-update timestamp. Trigger-maintained |

---

### Primary Key

```
PRIMARY KEY (topic_id)
```

---

### Foreign Keys

```
chapter_id → chapters.chapter_id   ON DELETE RESTRICT   ON UPDATE RESTRICT
```

---

### Unique Constraints

```
UNIQUE (chapter_id, name)
```

---

### CHECK Constraints

```
CHECK (char_length(name) >= 2)
CHECK (display_order >= 0)
```

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_topics_chapter_order` | `(chapter_id, display_order)` | B-tree | Ordered topic listing within a chapter |

---

### Soft Delete Strategy

None. Same rationale as chapters. If no content references a topic, it can be hard-deleted. `RESTRICT` cascade blocks deletion if any content is tagged to it (future: if `content.topic_id` FK is added).

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `updated_at` | ✅ | Trigger-maintained |
| `created_by` | ✅ Recommended | Admin who created the topic |
| `updated_by` | ✅ Recommended | Nullable — may be left untracked |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE topic | `RESTRICT` if referenced | Safe to delete only if no content references this topic |
| Chapter deleted | `RESTRICT` (from chapters) | Already blocked |

---

### Supabase RLS Considerations

```
Table: topics
RLS: ENABLED

SELECT:
  - Resolve via chapter_id → subjects → streams → institute_id.
    USING: EXISTS (
      SELECT 1 FROM chapters ch
      JOIN subjects sub ON sub.subject_id = ch.subject_id
      JOIN streams s ON s.stream_id = sub.stream_id
      WHERE ch.chapter_id = topics.chapter_id
      AND s.institute_id = get_my_institute_id()
    )

  - Three-level join is acceptable given the tiny cardinality of this table.
    Topics are heavily cacheable at the application layer.
    Consider caching the full stream → subject → chapter → topic tree in Redis/memory
    and bypassing RLS for read operations on this reference data.

INSERT / UPDATE:
  - Admins only.
```

---

### Backend Developer Notes

1. **Topics are optional — design for nullable topic_id everywhere:** Any table that could reference `topic_id` (future: content, questions) should make `topic_id` nullable. Not all content or questions will be tagged to a topic — only to a chapter.

2. **Application-layer caching recommended:** The full academic hierarchy (streams → subjects → chapters → topics) is near-static data that changes infrequently (a few times per semester). Cache the entire tree per institute in the application layer (memory cache or Redis, TTL: 1 hour). This eliminates the three-level RLS join on topics entirely for read operations.

3. **Topics are Phase 2 usage:** Expect most Phase 1 installs to not use topics at all. Build the topic management UI as a collapsible optional section in the admin interface. Do not make `topic_id` required on any downstream entity.

---

## Table 5: `batches`

### Purpose

A batch is the operational unit of student delivery within a stream. It is the primary grouping through which students receive live classes, access content, and take mock tests. Examples: `NEET 2026 – Morning Batch`, `JEE Drop Batch – Section A`.

Every student is enrolled in one or more batches. Live classes are assigned to batches. Batch membership determines what a student can access.

`batches` is the junction between the academic hierarchy (via `stream_id`) and the student delivery operation.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `batch_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Direct for RLS. Also required for the `UNIQUE (institute_id, batch_code)` constraint |
| `stream_id` | `UUID` | NOT NULL | — | FK → `streams.stream_id`. Every batch targets exactly one exam stream |
| `name` | `VARCHAR(150)` | NOT NULL | — | Human-readable batch name. Example: `NEET 2026 – Morning Batch A` |
| `batch_code` | `VARCHAR(30)` | NOT NULL | — | Short admin-facing code. Example: `NEET26-MOR-A`. Unique per institute |
| `academic_year` | `VARCHAR(10)` | NOT NULL | — | Academic year this batch belongs to. Format: `2025-26`. Used to separate batches across years even if names are reused |
| `start_date` | `DATE` | NOT NULL | — | First day of the batch |
| `end_date` | `DATE` | NOT NULL | — | Last day of the batch. Must be strictly after `start_date` |
| `max_seats` | `SMALLINT` | NULL | `NULL` | Maximum student capacity. NULL means unlimited. When set, the application enforces this limit on enrollment |
| `status` | `batch_status` | NOT NULL | `'upcoming'` | PostgreSQL enum: `upcoming`, `active`, `completed`, `archived` |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC last-update timestamp. Trigger-maintained |
| `created_by` | `UUID` | NULL | `NULL` | FK → `profiles.profile_id`. Admin who created this batch |
| `updated_by` | `UUID` | NULL | `NULL` | FK → `profiles.profile_id`. Admin who last modified this batch |
| `deleted_at` | `TIMESTAMPTZ` | NULL | `NULL` | Soft delete timestamp. NULL = active. Non-null = soft-deleted |

---

### Primary Key

```
PRIMARY KEY (batch_id)
```

---

### Foreign Keys

```
institute_id → institutes.institute_id   ON DELETE RESTRICT   ON UPDATE RESTRICT
stream_id    → streams.stream_id         ON DELETE RESTRICT   ON UPDATE RESTRICT
created_by   → profiles.profile_id       ON DELETE SET NULL   ON UPDATE RESTRICT
updated_by   → profiles.profile_id       ON DELETE SET NULL   ON UPDATE RESTRICT
```

> `SET NULL` on `created_by`/`updated_by` when a profile is soft-deleted ensures the batch record is not orphaned. The batch itself is unaffected.

---

### Unique Constraints

```
UNIQUE (institute_id, batch_code)
```

> `batch_code` must be unique within an institute. Across institutes, duplicate codes are permitted (different institutes may use `NEET26-A` independently).

---

### CHECK Constraints

```
CHECK (end_date > start_date)
CHECK (max_seats IS NULL OR max_seats > 0)
CHECK (char_length(name) >= 3)
CHECK (char_length(batch_code) >= 2)
CHECK (batch_code ~ '^[A-Z0-9_-]+$')
CHECK (academic_year ~ '^\d{4}-\d{2}$')
```

> `academic_year` format is validated as `YYYY-YY` (e.g. `2025-26`). This prevents free-text variations like `2025`, `2025/26`, `25-26` that would break grouping queries.

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_batches_institute_status` | `(institute_id, status)` | B-tree | Admin dashboard: list active/upcoming batches per institute |
| `idx_batches_institute_stream` | `(institute_id, stream_id)` | B-tree | Filter batches by stream within an institute |
| `idx_batches_institute_academic_year` | `(institute_id, academic_year)` | B-tree | Historical batch filtering by year |
| `idx_batches_deleted_at` | `(deleted_at)` | B-tree | Partial index: `WHERE deleted_at IS NULL` — all live queries add this filter |

> **Partial index recommendation:** Create the `deleted_at` index as a partial index `WHERE deleted_at IS NULL`. This index is small, fast, and only covers the rows that matter for active queries.

---

### Soft Delete Strategy

`batches` uses `deleted_at TIMESTAMPTZ DEFAULT NULL`.

A soft-deleted batch:
- Is excluded from all student and teacher queries via `WHERE deleted_at IS NULL`
- Retains all `batch_student` and `batch_teacher` junction rows (for historical records)
- Retains all `live_class` and `attendance` references
- Can be queried by admins with a specific "show deleted" filter

**Never hard-delete a batch** that has live class history, student enrollment records, or attendance data.

All RLS policies on `batches` include `AND deleted_at IS NULL` in the USING clause for student and teacher roles. Admins may query with or without this filter.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `updated_at` | ✅ | Trigger-maintained |
| `created_by` | ✅ | Batches are admin-created; authorship matters |
| `updated_by` | ✅ | Track who changed batch parameters (dates, capacity) |

---

### Cascade Rules

| Action | Behaviour | Applies To | Reason |
|--------|-----------|------------|--------|
| DELETE batch | `RESTRICT` — use soft delete only | Self | Has enrollment history, attendance, live class assignments |
| UPDATE batch_id | `RESTRICT` | Self | PK must not change |
| Institute deleted | `RESTRICT` (from institutes) | Parent | Already blocked |
| Stream deleted | `RESTRICT` (from streams) | Parent | Cannot remove a stream with active batches |

---

### Supabase RLS Considerations

```
Table: batches
RLS: ENABLED

SELECT:
  - Students: may see batches they are enrolled in (via batch_students join).
    USING:
      institute_id = get_my_institute_id()
      AND deleted_at IS NULL
      AND EXISTS (
        SELECT 1 FROM batch_students bs
        JOIN student_details sd ON sd.student_id = bs.student_id
        WHERE bs.batch_id = batches.batch_id
        AND sd.profile_id = auth.uid()
      )

  - Teachers: may see batches they are assigned to (via batch_teachers join).
    USING:
      institute_id = get_my_institute_id()
      AND deleted_at IS NULL
      AND EXISTS (
        SELECT 1 FROM batch_teachers bt
        JOIN teacher_details td ON td.teacher_id = bt.teacher_id
        WHERE bt.batch_id = batches.batch_id
        AND td.profile_id = auth.uid()
      )

  - Admins: may see all batches in their institute, including soft-deleted.
    USING: institute_id = get_my_institute_id()

  - Implementation note: Use a combined policy or separate policies per role.
    Role is retrieved via: (SELECT role FROM profiles WHERE id = auth.uid())
    Cache the role in the JWT custom claims to avoid repeated lookups.

INSERT:
  - Admins only.
    WITH CHECK:
      institute_id = get_my_institute_id()
      AND (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'

UPDATE:
  - Admins only.

DELETE:
  - Blocked at RLS. Use soft delete (set deleted_at).
```

---

### Backend Developer Notes

1. **Batch status transitions:** Implement status as a state machine in the application layer:
   - `upcoming` → `active` (on or after `start_date`)
   - `active` → `completed` (on or after `end_date`, or manually by admin)
   - `completed` → `archived` (manual admin action)
   - No backward transitions allowed

   A pg_cron job should run nightly to auto-advance `upcoming` → `active` and `active` → `completed` based on dates.

2. **Seat capacity enforcement:** When `max_seats` is set, check `(SELECT COUNT(*) FROM batch_students WHERE batch_id = ?)` before inserting a new enrollment. This check must be done inside a transaction with a row-level lock on the batch row to prevent race conditions when two students enroll simultaneously.

3. **Batch code format:** Recommend a convention to institutes: `{STREAM_CODE}-{YEAR_SHORT}-{BATCH_LABEL}`. Example: `NEET-26-MOR-A`. Provide a code auto-generator in the admin UI that builds this from the form fields.

4. **academic_year for historical queries:** This field is critical for year-over-year reporting. "Show me all batches from 2024-25" is a common admin query. The `YYYY-YY` format ensures lexicographic sort works correctly.

---

## Table 6: `batch_students`

### Purpose

Junction table implementing the M:M relationship between batches and students. A student can be enrolled in multiple batches simultaneously (e.g., a NEET theory batch and a NEET test series batch). A batch contains many students.

This table is also the enrollment record — it documents when a student joined a batch and their current enrollment status.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `batch_id` | `UUID` | NOT NULL | — | FK → `batches.batch_id`. Part of composite PK |
| `student_id` | `UUID` | NOT NULL | — | FK → `student_details.student_id`. Part of composite PK |
| `enrolled_on` | `DATE` | NOT NULL | `CURRENT_DATE` | Date the student was enrolled in this batch |
| `status` | `VARCHAR(20)` | NOT NULL | `'active'` | Enrollment status. Values: `active`, `inactive`, `transferred`, `dropped`. See note below on enum vs VARCHAR |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC timestamp of enrollment record creation |

---

### Primary Key

```
PRIMARY KEY (batch_id, student_id)
```

> Composite PK. Prevents a student from being enrolled in the same batch twice. No separate surrogate PK is needed on this junction table.

---

### Foreign Keys

```
batch_id    → batches.batch_id             ON DELETE RESTRICT   ON UPDATE RESTRICT
student_id  → student_details.student_id   ON DELETE RESTRICT   ON UPDATE RESTRICT
```

> `RESTRICT` on both FKs. An enrollment record must not be deleted when a batch or student is removed — it is a historical record. Soft-delete the batch or student instead.

---

### Unique Constraints

Enforced by the composite PK `(batch_id, student_id)`.

---

### CHECK Constraints

```
CHECK (status IN ('active', 'inactive', 'transferred', 'dropped'))
CHECK (enrolled_on <= CURRENT_DATE)
```

> `status` is implemented as `VARCHAR(20)` with a CHECK constraint rather than a PostgreSQL enum. Enrollment status values are likely to evolve (e.g., adding `on_leave`, `fee_defaulter`) without requiring an `ALTER TYPE` migration. This is a deliberate exception to the "use enums" rule — justified by the evolutionary nature of enrollment states.

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_batch_students_student_id` | `(student_id)` | B-tree | "Which batches is this student enrolled in?" — student portal query |
| `idx_batch_students_batch_status` | `(batch_id, status)` | B-tree | "How many active students in this batch?" — admin/teacher dashboard |
| `idx_batch_students_batch_enrolled_on` | `(batch_id, enrolled_on)` | B-tree | Enrollment timeline queries; batch fill-rate over time |

> The composite PK `(batch_id, student_id)` already creates a B-tree index that efficiently handles "all students in batch X" queries. The additional `student_id` index handles the reverse: "all batches for student Y".

---

### Soft Delete Strategy

`batch_students` has no soft delete. To remove a student from a batch, set `status = 'inactive'` or `status = 'dropped'`. The enrollment record is never physically deleted — it is a permanent historical record of who was enrolled in what batch, when, and for how long.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `enrolled_on` | ✅ | Serves as the creation audit date |
| `created_at` | ✅ | UTC timestamp of record creation (may differ from `enrolled_on` if backfilled) |
| `updated_at` | ✅ Recommended | Add `updated_at TIMESTAMPTZ` to track when status changes (e.g., when a student was marked as dropped) |
| `updated_by` | ✅ Recommended | Add `updated_by UUID FK → profiles.profile_id NULLABLE` — who changed the enrollment status |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE batch | `RESTRICT` | Enrollment history must survive batch soft-delete |
| DELETE student | `RESTRICT` | Enrollment history must survive student deactivation |
| UPDATE batch_id | `RESTRICT` | FK column in PK — must not change |
| UPDATE student_id | `RESTRICT` | FK column in PK — must not change |

---

### Supabase RLS Considerations

```
Table: batch_students
RLS: ENABLED

SELECT:
  - Students: may see their own enrollments only.
    USING: EXISTS (
      SELECT 1 FROM student_details sd
      WHERE sd.student_id = batch_students.student_id
      AND sd.profile_id = auth.uid()
    )

  - Teachers: may see enrollments for their assigned batches.
    USING: EXISTS (
      SELECT 1 FROM batch_teachers bt
      JOIN teacher_details td ON td.teacher_id = bt.teacher_id
      WHERE bt.batch_id = batch_students.batch_id
      AND td.profile_id = auth.uid()
    )

  - Admins: may see all enrollments within their institute.
    USING: EXISTS (
      SELECT 1 FROM batches b
      WHERE b.batch_id = batch_students.batch_id
      AND b.institute_id = get_my_institute_id()
    )

INSERT:
  - Admins only. Application must check max_seats before inserting.

UPDATE:
  - Admins only. (status changes, e.g., marking a student as dropped)

DELETE:
  - Blocked at RLS level.
```

---

### Backend Developer Notes

1. **Enrollment uniqueness is enforced by the composite PK**, not by the application. If the frontend accidentally submits a duplicate enrollment, the database will reject it with a unique violation error. Catch this and return a user-friendly message.

2. **Transferred students:** If a student transfers from Batch A to Batch B: set `batch_students (batch_a_id, student_id).status = 'transferred'`, then insert a new row `(batch_b_id, student_id)`. The history of both enrollments is preserved.

3. **Batch capacity check — concurrency:** As noted in the `batches` table, capacity checks must be done inside a transaction with a row lock:
   ```
   BEGIN;
   SELECT max_seats FROM batches WHERE batch_id = ? FOR UPDATE;
   SELECT COUNT(*) FROM batch_students WHERE batch_id = ? AND status = 'active';
   -- If count < max_seats, proceed with INSERT
   COMMIT;
   ```
   This prevents double-enrollment when two admins enroll students simultaneously.

4. **Counting enrolled students:** The query `SELECT COUNT(*) FROM batch_students WHERE batch_id = ? AND status = 'active'` is run frequently. The `(batch_id, status)` index makes this efficient.

---

## Table 7: `batch_teachers`

### Purpose

Junction table implementing the M:M relationship between batches and teachers. A teacher can be assigned to multiple batches. A batch can have multiple teachers (e.g., one for Physics, one for Chemistry).

Unlike `batch_students`, this is a purely operational assignment record — there is no enrollment timeline or fee implication. It answers the question: "Who teaches what batch?"

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `batch_id` | `UUID` | NOT NULL | — | FK → `batches.batch_id`. Part of composite PK |
| `teacher_id` | `UUID` | NOT NULL | — | FK → `teacher_details.teacher_id`. Part of composite PK |
| `role_in_batch` | `VARCHAR(50)` | NULL | `NULL` | Optional teaching role within this batch. Examples: `lead_teacher`, `co_teacher`, `doubt_solver`. Free text — not an enum; roles are institute-specific |
| `assigned_on` | `DATE` | NOT NULL | `CURRENT_DATE` | Date the teacher was assigned to this batch |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC timestamp of assignment record creation |

---

### Primary Key

```
PRIMARY KEY (batch_id, teacher_id)
```

> Composite PK. A teacher cannot be assigned to the same batch twice. If the `role_in_batch` needs to change, UPDATE the existing row — do not insert a duplicate.

---

### Foreign Keys

```
batch_id   → batches.batch_id             ON DELETE RESTRICT   ON UPDATE RESTRICT
teacher_id → teacher_details.teacher_id   ON DELETE RESTRICT   ON UPDATE RESTRICT
```

---

### Unique Constraints

Enforced by composite PK.

---

### CHECK Constraints

```
CHECK (assigned_on <= CURRENT_DATE)
```

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_batch_teachers_teacher_id` | `(teacher_id)` | B-tree | "Which batches is this teacher assigned to?" — teacher portal homepage |
| `idx_batch_teachers_batch_id` | `(batch_id)` | B-tree | Covered by composite PK leading column — no separate index needed |

---

### Soft Delete Strategy

No soft delete. To remove a teacher from a batch, hard-delete the assignment row. This is safe because `batch_teachers` does not own any child data. Historical attribution of content and classes is on the `content.teacher_id` and `live_class.teacher_id` columns — those are unaffected by removing a batch assignment.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `assigned_on` | ✅ | Assignment date |
| `created_at` | ✅ | UTC creation timestamp |
| `updated_at` | ❌ | Not needed — if assignment changes, delete and re-insert |
| `created_by` | ✅ Recommended | Admin who made the assignment |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE batch | `RESTRICT` | Cannot delete a batch with teacher assignments |
| DELETE teacher_details | `RESTRICT` | Cannot remove a teacher who has active batch assignments |

> **Note:** If a teacher must be removed urgently (e.g., resigned), first remove their `batch_teachers` rows, then set their `profiles.is_active = FALSE`. Enforce this two-step process in the admin UI.

---

### Supabase RLS Considerations

```
Table: batch_teachers
RLS: ENABLED

SELECT:
  - Teachers: may see their own batch assignments.
    USING: EXISTS (
      SELECT 1 FROM teacher_details td
      WHERE td.teacher_id = batch_teachers.teacher_id
      AND td.profile_id = auth.uid()
    )

  - Students: may see which teachers are assigned to their batches.
    USING: EXISTS (
      SELECT 1 FROM batches b
      JOIN batch_students bs ON bs.batch_id = b.batch_id
      JOIN student_details sd ON sd.student_id = bs.student_id
      WHERE b.batch_id = batch_teachers.batch_id
      AND sd.profile_id = auth.uid()
    )

  - Admins: may see all batch_teacher assignments within their institute.
    USING: EXISTS (
      SELECT 1 FROM batches b
      WHERE b.batch_id = batch_teachers.batch_id
      AND b.institute_id = get_my_institute_id()
    )

INSERT / DELETE:
  - Admins only.
```

---

### Backend Developer Notes

1. **Teacher portal — "My Batches":** The teacher's home screen shows their assigned batches. This query hits `batch_teachers WHERE teacher_id = ?` then joins `batches`. The `(teacher_id)` index makes this a fast index scan. This is a high-frequency query — ensure the index is in place before launch.

2. **role_in_batch is advisory:** The `role_in_batch` field is not enforced by the platform. It is informational — shown to admins in the batch management interface. Do not build permission logic on top of it.

3. **A teacher assigned to a batch can teach any subject:** `batch_teachers` does not carry a `subject_id`. The teaching scope is defined at the `live_class.subject_id` level, not the batch assignment level. This is correct — a teacher might teach multiple subjects in one batch.

---

## Domain 2 — Design Decisions Summary

| Decision | Choice | Reason |
|----------|--------|--------|
| Academic hierarchy depth | 4 levels: Stream → Subject → Chapter → Topic | Matches Indian coaching institute syllabus structure |
| institute_id on hierarchy | Direct on Stream and Batch; inherited on Subject/Chapter/Topic | Cardinality too low on hierarchy tables to justify denormalization; direct on Batch for RLS + unique constraint |
| Subject sharing across streams | NOT supported (direct FK) | Coaching institutes have distinct syllabi per stream |
| Batch ↔ Stream relationship | Many batches per stream (1:M) | One institute can run multiple batches of the same exam stream |
| Junction PKs | Composite `(batch_id, student_id)` and `(batch_id, teacher_id)` | No surrogate PK needed; composite enforces the relationship constraint |
| batch_students.status | VARCHAR + CHECK (not enum) | Enrollment states are expected to evolve; ALTER TYPE avoided |
| Soft delete — Batch | `deleted_at TIMESTAMPTZ` | Batches have operational history; must be recoverable |
| Soft delete — hierarchy | None (is_active on Stream only) | Hierarchy tables are reference data; RESTRICT cascade prevents accidental deletion |
| display_order type | `SMALLINT` | Max 32,767 values — more than sufficient for subject/chapter counts |
| academic_year format | `VARCHAR(10)` with `YYYY-YY` regex | Enforces consistency; enables lexicographic sort |

---

## Domain 2 — Relationships to Other Domains

| This Table | Referenced By | Via Column | Domain |
|------------|--------------|------------|--------|
| `streams` | `subjects`, `batches`, `mock_tests`, `pyq_papers`, `pyq_packages` | `stream_id` | Domains 3, 4, 5, 9, 10 |
| `subjects` | `chapters`, `live_classes`, `questions` | `subject_id` | Domains 7, 8 |
| `chapters` | `topics`, `content`, `live_classes`, `questions`, `chapter_performance` | `chapter_id` | Domains 6, 7, 8, 11 |
| `topics` | (future: `content.topic_id`, `questions.topic_id`) | `topic_id` | Domains 6, 8 (future) |
| `batches` | `batch_students`, `batch_teachers`, `live_class_batches` | `batch_id` | Domains 2, 7 |
| `batch_students` | (used for: student access checks, attendance correlation) | `batch_id`, `student_id` | Domain 7 |
| `batch_teachers` | (used for: teacher dashboard, live class scheduling) | `batch_id`, `teacher_id` | Domain 7 |

---

*Domain 2 complete. Awaiting approval before proceeding to Domain 3 — Subscription & Packages (SubscriptionPlan, SubscriptionPlanUnlock, StudentSubscription, PYQPackage, PYQPackageUnlock, StudentPYQPurchase).*
