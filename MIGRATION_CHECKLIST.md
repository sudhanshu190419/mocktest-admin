# 🗺️ Batch → Subject Migration Checklist

> **Purpose:** Track every single file that needs to change during the Batch-to-Subject architecture migration.
> **Instructions:** Tick ☐ boxes as each item is completed. Cross-reference with `ARCHITECTURE_MIGRATION_ANALYSIS.md` for details.

---

# Architecture Principles

## Ownership Model

Every entity in the platform has exactly ONE owner. The ownership model drives the entire database schema and RLS policy design.

| Entity | Owned By | Rationale |
|---|---|---|
| **Students** | **Batch** | A student enrolls in a batch, not in individual subjects. The batch is their academic container. Subject access is derived from batch membership. |
| **Teachers** | **Batch Subject** | Teacher A teaches Physics in Batch X. Teacher B teaches Chemistry in Batch X. Subject-scoping prevents a Physics teacher from inadvertently accessing Chemistry data. |
| **Content** | **Batch Subject** | A PDF uploaded for "Physics in Batch X" is only relevant to that subject within that batch. Content filtering becomes deterministic. |
| **Mock Tests** | **Batch Subject** | A "Electrostatics Test" belongs to Physics in Batch X. Students in Batch X who want Chemistry tests don't see irrelevant tests. |
| **Live Classes** | **Batch Subject** | A live class on "Organic Chemistry" belongs to Chemistry in Batch X. Students filter by subject. Teachers schedule within their assigned subject. |
| **Recordings** | **Batch Subject** | Recordings are always scoped to a subject within a batch — whether auto-generated from a live class or manually uploaded. |
| **Courses** | **Batches only** | Courses are a commerce/grouping layer. A course groups batches together for purchase. Courses do NOT own subjects, teachers, content, or any educational resource. |
| **Streams** | **Academic hierarchy only** | Streams (NEET, JEE, etc.) are pure academic classification. They define the subject catalog (Physics, Chemistry, Biology) that batches and courses reference. |
| **Subjects** | **Stream (Academic hierarchy)** | Subjects are globally defined per stream. They are NOT owned by batches or courses. Batch Subjects are the linking layer. |
| **Batch Subjects** | **Assignment layer** | A new entity that links a global Subject to a specific Batch. This is the atomic delivery unit. All resource assignment happens here. |

## Why This Architecture?

1. **Teacher specialization** — A Physics teacher only sees Physics content, Physics live classes, Physics student analytics
2. **Deterministic filtering** — Students in a multi-subject batch can filter by subject without ambiguity
3. **Analytics granularity** — Per-subject-per-batch performance analytics become trivially queryable
4. **Access control** — RLS policies become simple: "teacher X can access batch_subject Y" instead of complex multi-table joins
5. **Scalability** — As institutes grow, adding a new subject to a batch doesn't require restructuring existing assignments

---

# Domain Rules

These rules are PERMANENT. Every design decision must comply with them.

### Batch Subjects

| Question | Answer | Rationale |
|---|---|---|
| Can a batch contain the same subject twice? | **NO.** Each batch has at most one instance of a subject. UNIQUE constraint on `(batch_id, subject_id)`. | A batch covers Physics once. Duplicate subjects would create ambiguity in scheduling, analytics, and access control. |
| Can a batch exist without subjects? | **NO.** Every batch must have at least one batch_subject. Validation enforced at application layer (DB can't enforce cross-table MIN count). | A batch with no subjects delivers nothing. Students cannot be assigned to a contentless batch. |

### Teachers

| Question | Answer | Rationale |
|---|---|---|
| Can a teacher teach the same subject in multiple batches? | **YES.** A Physics teacher can teach Physics in Batch X AND Physics in Batch Y. This is a 1:N relationship (teacher → batch_subjects). | Teachers commonly teach across multiple batches. The `batch_subject_teachers` junction supports this. |
| Can multiple teachers teach the same subject in one batch? | **YES.** Physics in Batch X can have Teacher A (lectures) and Teacher B (doubt-solving). This is a M:N relationship (batch_subject → teachers). | Large batches may have multiple teachers per subject. `role_in_subject` distinguishes their function. |
| Can a teacher be assigned to a batch_subject without being specialized in that subject? | **NO.** Enforced by CHECK constraint referencing `teacher_specializations`. A Physics teacher can only be assigned to Physics batch_subjects. | Prevents misassignment. If a teacher isn't specialized in the subject, they shouldn't teach it. |

### Content

| Question | Answer | Rationale |
|---|---|---|
| Can content belong to multiple subjects? | **YES** (technically — content already has a single `subject_id` but can be assigned to multiple batch_subjects via the M:M junction). However, a single content item is authored for ONE subject. Cross-subject assignments should be rare. | A physics diagram could theoretically be reused in a mathematics context, but this is an edge case. The junction table supports it without data duplication. |

### Mock Tests

| Question | Answer | Rationale |
|---|---|---|
| Can a mock test belong to multiple subjects? | **NO.** A mock test has exactly one `subject_id`. If it covers multiple subjects, it's a "Full Syllabus" test that references a real "Full Syllabus" subject in the `subjects` table. | A test's subject determines which subject analytics it feeds into. The "Full Syllabus" is a real subject, not a NULL sentinel. |
| How do Full Syllabus tests work? | They get assigned to a batch_subject that references a real "Full Syllabus" subject (FK to `subjects.subject_id`). This subject is seeded in every institute's stream automatically. | Every FK is a real FK. No NULL special cases anywhere. |

### Live Classes

| Question | Answer | Rationale |
|---|---|---|
| Can a live class belong to multiple batch subjects? | **NO.** A live class belongs to exactly ONE batch subject. Stored as a direct FK `live_classes.batch_subject_id` (NOT NULL). If the same session needs to be delivered to multiple subjects, create separate live classes. | Simplicity wins. A junction table adds complexity for a rare use case. Multiple live classes can be created for multi-subject sessions. This simplifies schema, RLS, queries, indexing, and maintenance. |

### Recordings

| Question | Answer | Rationale |
|---|---|---|
| Can uploaded recordings exist without live classes? | **YES.** Workflow B (teacher uploads directly) creates recordings with `class_id = NULL`. These recordings MUST still have a `batch_subject_id`. | A recording's subject context is mandatory regardless of its source. |

### Students

| Question | Answer | Rationale |
|---|---|---|
| Can students opt out of subjects? | **NO** (in v1). Students belong to the entire batch and inherit access to all subjects within it. Opt-out is a future feature. | Adding subject-level opt-out requires enrollment granularity that is out of scope for this migration. |

---

## 🔷 Category A — New SQL Migrations (6 migrations)

### A1 — Migration: Create `batch_subjects` table (Core Foundation)

> This is the FOUNDATION of the entire migration. Every other migration depends on this table existing.

- [ ] Create file `supabase/migrations/066_domain_17_batch_subject_core.sql`
- [ ] Create `batch_subjects` table with surrogate PK `batch_subject_id`
- [ ] Add FK to `batches.batch_id`
- [ ] Add FK to `subjects.subject_id`
- [ ] Add FK to `institutes.institute_id`
- [ ] Add unique constraint on `(batch_id, subject_id)`
- [ ] Add `name` column (display name override, defaults to `subjects.name`)
- [ ] Add `is_active`, `sort_order`, `created_by`, `updated_by` columns
- [ ] Add indexes (institute_id, batch_id, subject_id, is_active)
- [ ] Add RLS (enable + admin full access, teacher read assigned, student read enrolled)
- [ ] Add `set_updated_at` trigger
- [ ] Add comments
- [ ] Seed data: For every existing batch, auto-create batch_subjects for ALL subjects in the batch's stream (including the "Full Syllabus" subject). Admins can deactivate unused ones later.
- [ ] Seed the "Full Syllabus" subject in `subjects` table for every stream if it doesn't exist (code: `FULL_SYLL`, name: `'Full Syllabus'`, display_order: 999)

**Migration Metadata:**
- **Purpose:** Create the core linking entity between batches and subjects. All resource assignment flows through this table.
- **Creates:** `batch_subjects` table, indexes, triggers, RLS policies
- **Backfills:** 
  - Seed the "Full Syllabus" subject in `subjects` table for every stream (code: `FULL_SYLL`, name: `'Full Syllabus'`, display_order: 999)
  - For every existing batch, create batch_subjects for ALL subjects in the batch's stream (including "Full Syllabus"). Admins can deactivate unused ones later.
- **Validation:** Every batch has at least one batch_subject; unique constraint `(batch_id, subject_id)` is enforced; "Full Syllabus" subject exists for every stream
- **Rollback:** `DROP TABLE IF EXISTS public.batch_subjects CASCADE` — **DESTRUCTIVE** (drops all dependent tables too)
- **Risk Level:** HIGH (foundation table — rollback cascades)
- **Dependencies:** None (only depends on `batches` and `subjects` which already exist)
- **Completion Criteria:** Table created, indexes in place, RLS policies validated, every batch has at least one batch_subject
- [ ] **COMPLETED** ☐

### A2 — Migration: Create `batch_subject_teachers` table

> **Data migration challenge:** Existing `batch_teachers` has NO subject information. A teacher assigned to "NEET Batch A" could teach Physics, Chemistry, OR Biology.
> **Strategy:** Use `teacher_specializations` to determine the correct subject. If a teacher specializes in Physics AND Chemistry, assign them to BOTH batch_subjects. If the teacher has no specializations, flag for manual admin review.

- [ ] Create file `supabase/migrations/067_domain_17_batch_subject_teachers.sql`
- [ ] Create `batch_subject_teachers` table with surrogate PK
- [ ] FK to `batch_subjects.batch_subject_id`
- [ ] FK to `teacher_details.teacher_id`
- [ ] FK to `institutes.institute_id`
- [ ] Unique constraint on `(batch_subject_id, teacher_id)`
- [ ] `role_in_subject` column (free text, like old `role_in_batch`)
- [ ] Check constraint: teacher must have matching `teacher_specializations` entry
- [ ] Indexes (batch_subject_id, teacher_id, institute_id)
- [ ] RLS policies (admin full, teacher read own, student read for batch)
- [ ] Data migration: migrate `batch_teachers` rows → `batch_subject_teachers`
- [ ] Data migration heuristic 1: match teacher's `teacher_specializations` with batch's stream subjects → assign to matching batch_subjects
- [ ] Data migration heuristic 2: if teacher has no specializations, assign to ALL batch_subjects in the batch (over-broad but safe — admin can prune)
- [ ] Log teachers flagged for manual review (no specializations = needs admin attention)
- [ ] Create backward-compatible view for `batch_teachers`

**Migration Metadata:**
- **Purpose:** Subject-scope teacher assignments. Replace `batch_teachers`.
- **Creates:** `batch_subject_teachers` table, indexes, RLS policies, backward-compatible view
- **Backfills:** `batch_teachers` → `batch_subject_teachers` using `teacher_specializations` heuristic
- **Validation:** `COUNT(batch_teachers) <= COUNT(batch_subject_teachers)` — valid migration may produce MORE rows (teacher assigned to multiple subjects)
- **Rollback:** Migrate data back to `batch_teachers`, drop new table — **non-destructive** if old table is preserved
- **Risk Level:** MEDIUM — heuristic-based data migration may produce incorrect subject assignments that need admin review
- **Dependencies:** A1 (batch_subjects must exist)
- **Completion Criteria:** All teachers have subject-scoped assignments, backward-compatible view works, flagged rows reviewed
- [ ] **COMPLETED** ☐

### A3 — Migration: Create `batch_subject_contents` table

> **Data migration is deterministic here:** `content` already has a `subject_id`. For every `batch_contents` row, we can directly derive the `batch_subject_id` by matching `(content.subject_id, batch_contents.batch_id)` against `batch_subjects`.

- [ ] Create file `supabase/migrations/068_domain_17_batch_subject_contents.sql`
- [ ] Create `batch_subject_contents` table
- [ ] FK to `batch_subjects.batch_subject_id`
- [ ] FK to `content.content_id`
- [ ] FK to `institutes.institute_id`
- [ ] Unique constraint on `(batch_subject_id, content_id)`
- [ ] `order_sequence`, `section_name`, `is_optional` columns (mirror `batch_contents`)
- [ ] Indexes (batch_subject_id, content_id, institute_id, is_optional)
- [ ] RLS policies (admin full, teacher read for their subjects, student read for enrolled batches)
- [ ] Data migration: migrate `batch_contents` → `batch_subject_contents`
- [ ] Data migration: JOIN `batch_contents` with `content` on `content_id`, match `content.subject_id` + `batch_contents.batch_id` → `batch_subjects.batch_subject_id`
- [ ] Handle edge case: content.subject_id doesn't match any batch_subject for this batch → log for manual review
- [ ] Create backward-compatible view `batch_contents` for old queries
- [ ] Add `uq_batch_subject_contents_sequence` unique constraint on `(batch_subject_id, order_sequence)`

**Migration Metadata:**
- **Purpose:** Subject-scope content assignments. Replace `batch_contents`.
- **Creates:** `batch_subject_contents` table, indexes, RLS policies, backward-compatible view
- **Backfills:** `batch_contents` → `batch_subject_contents` via deterministic content.subject_id JOIN
- **Validation:** `COUNT(batch_contents) = COUNT(batch_subject_contents)` — exact row parity expected
- **Rollback:** Migrate data back to `batch_contents`, drop new table — **non-destructive**
- **Risk Level:** LOW — data migration is deterministic; edge cases (orphaned content) are logged, not blocking
- **Dependencies:** A1 (batch_subjects must exist)
- **Completion Criteria:** All content assignments migrated, row parity confirmed, orphaned rows reviewed
- [ ] **COMPLETED** ☐

### A4 — Migration: Create `batch_subject_mock_tests` table

> **Full Syllabus Decision (FINAL):**
> Multi-subject mock tests (tests covering an entire stream syllabus, e.g., "NEET Full Mock #1") are treated as having a subject. A real "Full Syllabus" subject is seeded in the `subjects` table for every stream (code: `FULL_SYLL`, name: `"Full Syllabus"`). This subject:
> - Is a real row in `subjects` with a real `subject_id`
> - Is auto-created when the institute's first stream is set up
> - Has `display_order = 999` (always last in dropdowns)
> - Is hidden from per-subject analytics (these tests feed into overall batch analytics)
> - Cannot be used for per-chapter questions or content
>
> **Why this approach?**
> 1. Every FK is a real FK — no nullable columns, no NULL sentinels, no special-case query logic
> 2. Consistent assignment mechanism — every test goes through `batch_subject_mock_tests` with a real FK
> 3. A simple JOIN covers all tests: `SELECT * FROM batch_subject_mock_tests WHERE batch_subject_id = ?`
> 4. Full-syllabus tests are distinguished by `subjects.code = 'FULL_SYLL'`, not by `IS NULL` checks
> 5. Scalable — no schema changes needed for any test type

- [ ] Create file `supabase/migrations/069_domain_17_batch_subject_mock_tests.sql`
- [ ] Create `batch_subject_mock_tests` table
- [ ] FK to `batch_subjects.batch_subject_id`
- [ ] FK to `mock_tests.test_id`
- [ ] FK to `institutes.institute_id`
- [ ] Unique constraint on `(batch_subject_id, test_id)`
- [ ] `available_from`, `available_until`, `attempt_limit` override columns (mirror `batch_mock_tests`)
- [ ] Indexes (batch_subject_id, test_id, institute_id)
- [ ] RLS policies (admin full, teacher read for their subjects, student read for enrolled batches)
- [ ] Data migration: migrate `batch_mock_tests` → `batch_subject_mock_tests`
- [ ] Data migration: for tests WITH `subject_id`, infer `batch_subject_id` from `mock_tests.subject_id` + `batch_id`
- [ ] Data migration: for tests with `subject_id` pointing to the "Full Syllabus" subject, find the matching "Full Syllabus" batch_subject for that batch
- [ ] Verify the "Full Syllabus" subject exists in `subjects` (seeded during A1 migration)
- [ ] Add application-layer validation: when creating a test with `subject_id = FULL_SYLL`, auto-link to the "Full Syllabus" batch_subject(s) for the batch

**Migration Metadata:**
- **Purpose:** Replace `batch_mock_tests` with subject-scoped test assignment. Full-syllabus tests use a real "Full Syllabus" subject in the `subjects` table.
- **Creates:** `batch_subject_mock_tests` table, indexes, RLS policies
- **Backfills:** `batch_mock_tests` → `batch_subject_mock_tests` with subject inference; "Full Syllabus" batch_subjects for tests with `subject_id = (FULL_SYLL subject_id)`
- **Validation:** `COUNT(batch_mock_tests) = COUNT(batch_subject_mock_tests)` — row parity; no test loses its batch assignment
- **Rollback:** Migrate data back to `batch_mock_tests`, drop new table
- **Risk Level:** LOW — data migration is straightforward since all subject_ids are real FKs; no NULL special cases
- **Dependencies:** A1 (batch_subjects must exist)
- **Completion Criteria:** All mock tests have valid batch_subject assignments, including full-syllabus tests
- [ ] **COMPLETED** ☐

### A5 — Migration: Add `batch_subject_id` to `live_classes` table

> **Live Class Design Decision (FINAL):**
> A live class ALWAYS belongs to exactly ONE batch subject. The FK is stored directly on `live_classes` as `batch_subject_id` (NOT NULL).
>
> **Why NOT a junction table:**
> 1. A live class NEVER belongs to multiple subjects. This is a firm business rule.
> 2. A direct FK eliminates a JOIN for every live class query — critical for real-time scheduling
> 3. RLS policies become simpler: `live_classes.batch_subject_id IN (teacher's batch_subjects)`
> 4. The existing `live_class_batch` table (which maps a class to multiple batches) already handles broadcasting. Subject is a separate dimension.
> 5. If the same session needs to be delivered to Physics AND Chemistry, create TWO live classes
>
> **SQL Pattern:**
> ```sql
> -- Find all live classes for Physics in Batch X
> SELECT * FROM live_classes
> WHERE batch_subject_id = '<physics_in_batch_x_uuid>';
> ```

- [ ] Create file `supabase/migrations/070_domain_17_add_batch_subject_id_to_live_classes.sql`
- [ ] Add `batch_subject_id` column to `live_classes` (FK to `batch_subjects.batch_subject_id`, NOT NULL)
- [ ] Add FK constraint: `fk_live_classes_batch_subject` → `batch_subjects.batch_subject_id`
- [ ] Add index on `live_classes.batch_subject_id`
- [ ] Keep `live_classes.subject_id` column (still used for question/chapter tagging) — subject is both academic hierarchy AND batch assignment
- [ ] Data migration: infer `batch_subject_id` from `live_classes.subject_id` + `live_class_batch.batch_id` for existing rows
- [ ] Data migration: for any row where the inference fails (no matching batch_subject), prompt for manual assignment
- [ ] Add check constraint: `live_classes.batch_subject_id IS NOT NULL` (all new and existing classes must have a subject)
- [ ] Add trigger or application validation: `batch_subject_id` must belong to a batch that is linked to this class via `live_class_batch`

**Migration Metadata:**
- **Purpose:** Add subject-scoped FK to `live_classes`. Each class belongs to exactly one batch subject.
- **Creates:** `live_classes.batch_subject_id` column, FK constraint, index
- **Backfills:** Infer from `live_classes.subject_id` + `live_class_batch.batch_id` → `batch_subjects.batch_subject_id`
- **Validation:** `COUNT(*) WHERE batch_subject_id IS NULL = 0`; every class has a valid FK
- **Rollback:** `ALTER TABLE live_classes DROP COLUMN batch_subject_id, DROP CONSTRAINT fk_live_classes_batch_subject` — **non-destructive**
- **Risk Level:** MEDIUM — adding NOT NULL column to existing table requires backfill first
- **Dependencies:** A1 (batch_subjects must exist)
- **Completion Criteria:** All live classes have valid batch_subject_id, RLS updated, queries refactored
- [ ] **COMPLETED** ☐

### A6 — Migration: Create `batch_subject_recordings` (Recordings Architecture Rewrite)

> **Context:** Recordings support TWO independent workflows:
> - **Workflow A:** Teacher creates Live Class → Recording automatically generated by LiveKit Egress
> - **Workflow B:** Teacher uploads recorded lecture directly → No live class exists
>
> The `batch_subject_id` is the PRIMARY access control mechanism for BOTH workflows.
> `class_id` is NULLABLE for Workflow B recordings.

**Migration Design:**
- New `batch_subject_id` column on `recordings` (NOT NULL — every recording must have a subject context)
- `source_type` ENUM: `'live_class' | 'uploaded'` — replaces the need to check `class_id IS NULL`
- `class_id` remains NULLABLE (only populated for Workflow A)
- `batch_subject_id` is set at creation time (not derived from class_id after the fact)
- Keep `batch_id` column during transition phase (will be dropped in Phase 5)

- [ ] Create file `supabase/migrations/071_domain_17_batch_subject_recordings.sql`
- [ ] Add `batch_subject_id` column to `recordings` (FK to `batch_subjects`, NOT NULL)
- [ ] Add `source_type` ENUM column: `'live_class' | 'uploaded'`
- [ ] Add NOT NULL constraint on `batch_subject_id` — every recording must have a subject context
- [ ] Add FK constraint: `fk_recordings_batch_subject` → `batch_subjects.batch_subject_id`
- [ ] Add index on `batch_subject_id`
- [ ] Backfill Workflow A rows: for recordings WITH class_id, derive batch_subject_id from `live_classes.class_id → live_classes.subject_id + recording.batch_id`
- [ ] Backfill Workflow B rows: for recordings WITHOUT class_id, batch_subject_id must be manually set or prompted during migration
- [ ] Backfill `source_type`: `class_id IS NOT NULL → 'live_class'`, `class_id IS NULL → 'uploaded'`
- [ ] Keep `batch_id` column (don't drop yet — backward compatibility)
- [ ] Add index on `source_type` for filtered queries
- [ ] Add check constraint: `(source_type = 'live_class' AND class_id IS NOT NULL) OR (source_type = 'uploaded' AND class_id IS NULL)`
- [ ] Update RLS policies to use `batch_subject_id` for student access check
- [ ] Update student view policy: student can view recording if `batch_subject_id` belongs to a batch they are enrolled in

**Migration Metadata:**
- **Purpose:** Add subject-scoped access control to recordings. Support both auto-generated and uploaded workflows.
- **Creates:** `recordings.batch_subject_id` column, `recordings.source_type` column, indexes, FK, check constraint
- **Backfills:** Workflow A via `live_classes` join; Workflow B requires manual input
- **Validation:** `COUNT(*) WHERE batch_subject_id IS NULL = 0`, `COUNT(*) WHERE source_type = 'live_class' AND class_id IS NULL = 0`
- **Rollback:** `ALTER TABLE recordings DROP COLUMN batch_subject_id, DROP COLUMN source_type, DROP CONSTRAINT ...` — non-destructive
- **Risk Level:** MEDIUM — adding NOT NULL column requires data to be present first
- **Dependencies:** A1 (batch_subjects must exist)
- **Completion Criteria:** All recordings have batch_subject_id, source_type is accurate, RLS works for both workflows
- [ ] **COMPLETED** ☐

---

## 🔷 Category B — SQL Migration: RLS Policy Rewrite

- [ ] Create file `supabase/migrations/072_domain_17_rls_policies.sql`
- [ ] Rewrite policy: `batches` teacher read (Section 4e in 021) — use `batch_subject_teachers`
- [ ] Rewrite policy: `batch_students` teacher read (Section 4f in 021) — use `batch_subject_teachers`
- [ ] Rewrite policy: `batch_teachers` → `batch_subject_teachers` (Section 4g in 021)
- [ ] Rewrite policy: `live_classes` student read (Section 6a in 021) — use `live_classes.batch_subject_id` directly (JOIN to `batch_subjects → batch_students`)
- [ ] Rewrite policy: `live_class_batch` teacher INSERT/DELETE (migration 050) — remains mostly unchanged (still maps classes to batches), but add validation that the class's `batch_subject_id` is compatible with the batch
- [ ] Rewrite policy: `recordings` student read (Section 6d in 021) — use `recordings.batch_subject_id` (direct FK, no `live_class_batch` involved)
- [ ] Rewrite policy: `performance_reports` teacher read (Section 10a in 021) — use `batch_subject_teachers`
- [ ] Rewrite policy: `progress_history` teacher read (Section 10d in 021) — use `batch_subject_teachers`
- [ ] Rewrite policy: `batch_mock_tests` → `batch_subject_mock_tests` (migration 031)
- [ ] Rewrite policy: `batch_contents` → `batch_subject_contents` (migration 056)
- [ ] Rewrite helper function: `is_teacher_assigned_to_batch()` → `is_teacher_assigned_to_batch_subject()`
- [ ] Rewrite helper function: `is_student_in_live_class_batches()` → `is_student_in_subject_live_classes()` — now uses `live_classes.batch_subject_id` instead of `live_class_batch`
- [ ] Update `get_my_teacher_id()` — check if still needed (it's fine, references `teacher_details`)
- [ ] **COMPLETED** ☐

---

## 🔷 Category C — Existing SQL Migrations to Update

- [ ] **`021_rls_policies.sql`** — Add note/migration pointer: "Sections 4e, 4f, 4g, 6a, 6c, 6d, 10a, 10d are superseded by migration 072"
- [ ] **`031_batch_mock_tests.sql`** — Add note: "Superseded by batch_subject_mock_tests"
- [ ] **`050_add_live_class_batch_teacher_policies.sql`** — Add note: "Still in use — live_class_batch retains batch-to-class mapping. New `live_classes.batch_subject_id` column added in migration 070"
- [ ] **`051_fix_live_class_batch_rls_recursion.sql`** — Add note: "Helper functions updated in migration 072 to also check `live_classes.batch_subject_id`"
- [ ] **`056_batch_contents.sql`** — Add note: "Superseded by batch_subject_contents"
- [ ] **`065_create_recordings_table.sql`** — Add note: "batch_subject_id column added in migration 071"
- [ ] **COMPLETED** ☐

---

## 🔷 Category D — SQL: Cleanup (Phase 5 — after stabilization)

- [ ] Create file `supabase/migrations/073_domain_17_cleanup.sql`
- [ ] Convert `batch_teachers` → view for backward compatibility
- [ ] Convert `batch_contents` → view for backward compatibility
- [ ] Convert `batch_mock_tests` → view for backward compatibility
- [ ] Convert `live_class_batch` → remains as-is (still used for batch-to-class mapping; `batch_subject_id` is the subject dimension, not a replacement for `live_class_batch`)
- [ ] Mark old tables as deprecated in comments
- [ ] Drop `recordings.batch_id` (after verifying no queries reference it)
- [ ] Schedule hard-drop of old tables after 1-month deprecation
- [ ] **COMPLETED** ☐

---

## 🔷 Category E — New TypeScript Types

- [ ] **`src/types/academic.ts`** — Add `BatchSubject` interface
  ```ts
  export interface BatchSubject {
    batchSubjectId: string;
    batchId: string;
    subjectId: string;
    instituteId: string;
    name: string;
    sortOrder: number;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
  }
  ```
- [ ] **`src/types/academic.ts`** — Add `BatchSubjectTeacher` interface
- [ ] **`src/types/academic.ts`** — Add `CreateBatchSubjectInput`, `UpdateBatchSubjectInput`
- [ ] **`src/types/academic.ts`** — Add `BatchSubjectFilters`, `BatchSubjectSortOptions`
- [ ] **`src/types/academic.ts`** — Add `BatchSubjectContent` interface
- [ ] **`src/types/academic.ts`** — Add `BatchSubjectMockTest` interface
- [ ] **`src/types/academic.ts`** — Update `LiveClass` interface to include `batchSubjectId` field
- [ ] **`src/types/recording.ts`** — Add `batchSubjectId` field to recording interfaces
- [ ] **`src/types/recording.ts`** — Add `sourceType` field: `RecordingSourceType = 'live_class' | 'uploaded'`
- [ ] **`src/types/academic.ts`** — Add `RecordingSourceType` enum type
- [ ] **`src/types/recording.ts`** — Update `CreateRecordingInput` to require `batchSubjectId` (NOT optional)
- [ ] **`src/types/recording.ts`** — Make `classId` optional in recording types (for Workflow B)
- [ ] **`src/types/mockTest.ts`** — Update assignment types to include `batchSubjectId`
- [ ] **`src/types/content.ts`** — Update content assignment types to include `batchSubjectId`
- [ ] **COMPLETED** ☐

---

## 🔷 Category F — New Service Files

- [ ] **`src/services/academic/batchSubjectService.ts`** — CRUD for `batch_subjects`
  - `listBatchSubjects(filters)`
  - `getBatchSubject(id)`
  - `createBatchSubject(input)`
  - `updateBatchSubject(id, input)`
  - `deleteBatchSubject(id)` (soft-delete is_active=false)
  - **COMPLETED** ☐
- [ ] **`src/services/academic/batchSubjectTeacherService.ts`** — CRUD for `batch_subject_teachers`
  - `listTeachersForBatchSubject(batchSubjectId)`
  - `assignTeacherToBatchSubject(batchSubjectId, teacherId)`
  - `removeTeacherFromBatchSubject(batchSubjectId, teacherId)`
  - `getTeacherBatchSubjects(teacherId)` — all subjects a teacher teaches across batches
  - **COMPLETED** ☐
- [ ] **`src/services/academic/batchSubjectContentService.ts`** — CRUD for `batch_subject_contents`
  - **COMPLETED** ☐
- [ ] **`src/services/academic/batchSubjectMockTestService.ts`** — CRUD for `batch_subject_mock_tests`
  - **COMPLETED** ☐
- [ ] **REMOVED** — No `batchSubjectLiveClassService.ts` needed. Live class subject is handled directly via `live_classes.batch_subject_id`. Update `teacherLiveClassService.ts` instead (see Category G2).
- [ ] **`src/services/academic/batchSubjectRecordingService.ts`** — CRUD for recordings by batch_subject
  - `listRecordingsByBatchSubject(batchSubjectId)` — all recordings for a subject within a batch
  - `createUploadedRecording(input)` — Workflow B: create recording with batch_subject_id, source_type='uploaded'
  - `getRecordingAccess(recordingId, userId)` — check access using batch_subject_id (not class_id)
  - **COMPLETED** ☐

---

## 🔷 Category G — Service Files to Rewrite/Update

### G1 — Complete Rewrites (3 files)

- [ ] **`src/services/admin/batchTeacherAssignmentService.ts`**
  - [ ] Methods to rewrite: `getBatchTeachers()` → `getBatchSubjectTeachers()`, `assignTeacher()` → `assignTeacherToSubject()`, `removeTeacher()` → `removeTeacherFromSubject()`
  - [ ] All `supabase.from('batch_teachers')` → `supabase.from('batch_subject_teachers')`
  - [ ] Add `batchSubjectId` parameter to: `getAvailableTeachers()`, `assignTeacher()`, `getTeacherCount()`
  - [ ] Update TypeScript return types to match new schema
  - [ ] Update JSDoc comments
  - **COMPLETED** ☐

- [ ] **`src/services/admin/batchContentAssignmentService.ts`**
  - [ ] Methods to rewrite: `getBatchContent()` → `getSubjectContent()`, `assignContent()` → `assignContentToSubject()`, `removeContent()` → `removeContentFromSubject()`
  - [ ] All `supabase.from('batch_contents')` → `supabase.from('batch_subject_contents')`
  - [ ] Add `batchSubjectId` parameter to: `getUnassignedContent()`, `assignContent()`, `reorderContent()`, `getContentCount()`
  - [ ] Update the `getContentWithSubjectInfo()` method to join through `batch_subject_contents`
  - [ ] Update JSDoc comments
  - **COMPLETED** ☐

- [ ] **`src/services/admin/mockTestAssignmentService.ts`**
  - [ ] Methods to rewrite: `getBatchMockTests()` → `getSubjectMockTests()`, `assignMockTest()` → `assignMockTestToSubject()`
  - [ ] All `supabase.from('batch_mock_tests')` → `supabase.from('batch_subject_mock_tests')`
  - [ ] Add `batchSubjectId` parameter to: `getUnassignedMockTests()`, `assignMockTest()`, `updateAssignment()`, `removeAssignment()`
  - [ ] Handle full-syllabus tests: when `subject_id = NULL`, assign to synthetic "Full Syllabus" batch_subject
  - [ ] Update JSDoc comments
  - **COMPLETED** ☐

### G2 — Significant Updates (8 files)

- [ ] **`src/services/teacherLiveClassService.ts`**
  - [ ] Method `scheduleLiveClass()`: Add `batchSubjectId` to INSERT. Validate that the teacher is assigned to the batch_subject before creating the class.
  - [ ] Method `updateScheduledClass()`: Allow updating `batch_subject_id`. Add validation.
  - [ ] Method `getTeacherClasses()`: Add filter/sort by `batch_subject_id`
  - [ ] `live_class_batch` operations remain UNCHANGED (still maps class to batches for broadcasting)
  - [ ] **COMPLETED** ☐

- [ ] **`src/services/teacherService.ts`**
  - [ ] Method `getTeacherBatches()`: Replace `batch_teachers` SELECT with `batch_subject_teachers` JOIN
  - [ ] Method `getAuthorizedSubjects()`: Already returns subjects, but scope to batch_subject assignments
  - [ ] Method `scheduleLiveClass()`: Add `batchSubjectId` parameter — stored directly on `live_classes.batch_subject_id`
  - [ ] Method `getTeacherClasses()`: Add filter by `batch_subject_id`
  - [ ] All `supabase.from('batch_teachers')` → `supabase.from('batch_subject_teachers')`
  - [ ] **COMPLETED** ☐

- [ ] **`src/services/liveClassAttendanceService.ts`**
  - [ ] Method `getBatchStudentsForClass()`: Use `live_classes.batch_subject_id` → `batch_subjects.batch_id` → `batch_students` for student resolution
  - [ ] Method `getClassBatchIds()`: UNCHANGED — still uses `live_class_batch`
  - [ ] **COMPLETED** ☐

- [ ] **`src/services/attendanceAnalyticsService.ts`**
  - [ ] Method `getTeacherBatchIds()`: Replace `batch_teachers` SELECT with `batch_subject_teachers` SELECT
  - [ ] Method `getLiveClassBatchIds()`: UNCHANGED — still uses `live_class_batch`
  - [ ] Method `getStudentBatchMap()`: Replace JOINs through `batch_teachers` with `batch_subject_teachers`
  - [ ] Method `getBatchNames()`: Replace queries to use new table structures
  - [ ] All `supabase.from('batch_teachers')` → `supabase.from('batch_subject_teachers')`
  - [ ] **COMPLETED** ☐

- [ ] **`src/services/recording/recordingService.ts`**
  - [ ] Method `createRecording()`: Set `batch_subject_id` directly (from input), set `source_type` based on workflow
  - [ ] Method `resolveBatchIdForRecording()`: Remove — batch_subject_id is now set at creation time, not derived
  - [ ] Method `getRecording()`: Read `batch_subject_id` instead of `batch_id` from recordings
  - [ ] Method `filterRecordings()`: Filter by `batch_subject_id` instead of `batch_id`
  - [ ] Method `updateRecording()`: Update `source_type` logic for Workflow A vs B
  - [ ] Method `getTeacherRecordings()`: Workflow A recordings derive batch_subject_id from the live class (via `live_classes.batch_subject_id`); Workflow B recordings have it directly
  - [ ] **COMPLETED** ☐

- [ ] **`src/services/admin/batchManagementService.ts`**
  - [ ] Method `listBatches()`: Update JOINs from `batch_teachers` to `batch_subject_teachers` (include subject info)
  - [ ] Method `getBatchDetail()`: Include `batch_subjects` in the response with teacher/content/test counts per subject
  - [ ] Method `getBatchStats()`: Aggregate stats per subject within each batch
  - [ ] Method `deleteBatch()`: Validate no batch_subject_teachers/batch_subject_contents/batch_subject_mock_tests references
  - [ ] All `batch_teachers` inline JOINs in Supabase queries → `batch_subject_teachers` JOINs
  - [ ] Add subject information to `BatchListItem` interface
  - [ ] Update `BatchDetailResponse` to include `subjects: BatchSubject[]`
  - [ ] **COMPLETED** ☐

- [ ] **`src/services/profileService.ts`**
  - [ ] Method `getTeacherProfile()`: Replace `batch_teachers` JOIN with `batch_subject_teachers` JOIN
  - [ ] Add subject info to each batch in teacher profile response (subjects the teacher teaches within each batch)
  - [ ] **COMPLETED** ☐

- [ ] **`src/services/adminService.ts`**
  - [ ] Method `getDashboardCounts()`: Replace `batch_teachers` count query with `batch_subject_teachers`
  - [ ] **COMPLETED** ☐

### G3 — Minor Updates (3 files)

- [ ] **`src/services/admin/courseBatchAssignmentService.ts`**
  - [ ] Lines 130, 142: Update teacher count query from `batch_teachers` to `batch_subject_teachers`
  - [ ] **COMPLETED** ☐

- [ ] **`src/services/admin/teacherLifecycleService.ts`**
  - [ ] Line 357: Update `batch_teachers` query to `batch_subject_teachers`
  - [ ] **COMPLETED** ☐

- [ ] **`src/services/admin/dashboardService.ts`**
  - [ ] Line 114: Consider adding subject breakdown to batch counts
  - [ ] **COMPLETED** ☐

---

## 🔷 Category H — React Hooks to Update

- [ ] **`src/hooks/admin/useBatchManagement.ts`**
  - [ ] Update to return `subjects` array within each batch
  - [ ] Add new functions: `useBatchSubjects()`, `useBatchSubjectDetail()`
  - [ ] **COMPLETED** ☐

- [ ] **`src/hooks/admin/useBatchTeacherAssignment.ts`**
  - [ ] Add `batchSubjectId` parameter to all functions
  - [ ] Update API calls from `batch_teachers` to `batch_subject_teachers`
  - [ ] **COMPLETED** ☐

- [ ] **`src/hooks/admin/useBatchContentAssignment.ts`**
  - [ ] Add `batchSubjectId` parameter to all functions
  - [ ] Update API calls from `batch_contents` to `batch_subject_contents`
  - [ ] **COMPLETED** ☐

- [ ] **`src/hooks/admin/useMockTestAssignment.ts`**
  - [ ] Add `batchSubjectId` parameter to all functions
  - [ ] Update API calls from `batch_mock_tests` to `batch_subject_mock_tests`
  - [ ] **COMPLETED** ☐

- [ ] **`src/hooks/useLiveClass.ts`**
  - [ ] Add `batchSubjectId` to create/update live class payloads
  - [ ] Add subject selection UI state to live class creation flow
  - [ ] `live_class_batch` queries remain UNCHANGED (still maps classes to batches)
  - [ ] **COMPLETED** ☐

- [ ] **New hook:** `src/hooks/academic/useBatchSubject.ts`
  - [ ] Create new hook for batch subject CRUD
  - [ ] **COMPLETED** ☐

---

## 🔷 Category I — Edge Functions to Update

### I1 — Must update (2 functions)

- [ ] **`supabase/functions/dispatch-notification/index.ts`**
  - [ ] Function `resolveAudience()` for 'batch' type: Replace `batch_teachers` query with `batch_subject_teachers`
  - [ ] Function `validateTeacherBatchAssignment()`: Replace `batch_teachers` query with `batch_subject_teachers`
  - [ ] Function `resolveStudentsInBatch()`: JOIN path changes through batch_subjects instead of direct batch_students
  - [ ] All `supabase.from('batch_teachers')` → `supabase.from('batch_subject_teachers')`
  - [ ] **COMPLETED** ☐

- [ ] **`supabase/functions/recording-playback-url/index.ts`**
  - [ ] Function `verifyAccess()` for student role: Read `batch_subject_id` from recording instead of `batch_id`
  - [ ] Function `verifyAccess()`: Student access check changes from `batch_students.batch_id = recordings.batch_id` to `batch_students IN (batch_subjects WHERE batch_subject_id = recordings.batch_subject_id)`
  - [ ] Function `verifyAccess()` for teacher role: Verify teacher is assigned to the recording's `batch_subject_id` via `batch_subject_teachers`
  - [ ] Consider: uploaded recordings (Workflow B) have no class_id — access is purely through batch_subject_id
  - [ ] **COMPLETED** ☐

### I2 — Review (3 functions — may need updates)

- [ ] **`supabase/functions/livekit-webhook/index.ts`**
  - [ ] Review: Does attendance recording need batch_subject_id?
  - [ ] **COMPLETED** ☐

- [ ] **`supabase/functions/recording-egress-start/index.ts`**
  - [ ] Review: Does recording creation need batch_subject_id?
  - [ ] **COMPLETED** ☐

- [ ] **`supabase/functions/recording-egress-stop/index.ts`**
  - [ ] Review: Does recording status update need batch_subject_id?
  - [ ] **COMPLETED** ☐

---

## 🔷 Category J — React Pages to Update

### J1 — High Impact (5 pages)

- [ ] **`src/app/admin/batches/page.tsx`** — Batch list
  - [ ] Show subjects per batch in the list view
  - [ ] Add "Subjects" column
  - [ ] **COMPLETED** ☐

- [ ] **`src/app/admin/batches/[id]/page.tsx`** — Batch detail
  - [ ] Add "Subjects" tab showing all auto-created subjects
  - [ ] Allow admin to DEACTIVATE (not delete) unused subjects
  - [ ] Per-subject teacher management section
  - [ ] Per-subject content assignment section
  - [ ] Per-subject mock test assignment section
  - [ ] Per-subject live class listing
  - [ ] **COMPLETED** ☐

- [ ] **`src/app/admin/batches/create/page.tsx`** — Create batch
  - [ ] **No subject selection step needed.** Subjects are auto-created from the batch's stream (all subjects + Full Syllabus).
  - [ ] After batch creation, redirect to batch detail page where admin can deactivate unused subjects.
  - [ ] **COMPLETED** ☐

- [ ] **`src/app/teacher/live-classes/create/page.tsx`** — Create live class
  - [ ] When selecting a batch, also show subject selection
  - [ ] Subject dropdown filtered to subjects available in the selected batch
  - [ ] **COMPLETED** ☐

- [ ] **`src/app/teacher/live-classes/[id]/edit/page.tsx`** — Edit live class
  - [ ] Update batch-subject selection
  - [ ] **COMPLETED** ☐

### J2 — Medium Impact (5 pages)

- [ ] **`src/app/teacher/content/create/page.tsx`** — Upload content
  - [ ] Add subject-within-batch selector
  - [ ] **COMPLETED** ☐

- [ ] **`src/app/teacher/mock-tests/create/page.tsx`** — Create mock test
  - [ ] Add subject-within-batch selector for assignment
  - [ ] **COMPLETED** ☐

- [ ] **`src/app/teacher/analytics/page.tsx`** — Teacher analytics
  - [ ] Add per-subject-per-batch breakdown in analytics views
  - [ ] **COMPLETED** ☐

- [ ] **`src/app/teacher/dashboard/page.tsx`** — Teacher dashboard
  - [ ] Show subjects within batches on dashboard cards
  - [ ] **COMPLETED** ☐

- [ ] **`src/app/teacher/recordings/page.tsx`** — Teacher recordings list
  - [ ] Filter recordings by batch_subject (show subject context for each recording)
  - [ ] Show whether recording is auto-generated (Workflow A) or uploaded (Workflow B) via source_type
  - [ ] **COMPLETED** ☐

- [ ] **`src/app/admin/recordings/page.tsx`** — Admin recordings management
  - [ ] Show batch_subject context for each recording
  - [ ] **COMPLETED** ☐

### J3 — Low Impact (3 pages — verify)

- [ ] **`src/app/teacher/content/page.tsx`** — Content list
  - [ ] Verify content filtering works with new subject structure
  - [ ] **COMPLETED** ☐

- [ ] **`src/app/teacher/mock-tests/page.tsx`** — Mock test list
  - [ ] Verify test listing shows subject-scoped data
  - [ ] **COMPLETED** ☐

- [ ] **`src/app/admin/commerce/courses/page.tsx`** — Course management
  - [ ] Verify course→batch→subject chain is intact
  - [ ] **COMPLETED** ☐

---

## 🔷 Category K — New UI Components

- [ ] **BatchSubjectSelector** — Dropdown/combobox to pick a subject within a batch
- [ ] **BatchSubjectList** — List of subjects within a batch with CRUD
- [ ] **BatchSubjectCard** — Card showing subject name, teacher count, content count
- [ ] **BatchSubjectTeacherList** — Teacher list per batch-subject with assign/remove
- [ ] **BatchSubjectContentList** — Content list per batch-subject
- [ ] **BatchSubjectMockTestList** — Mock test list per batch-subject
- [ ] **REMOVED** — No separate component needed. Live class listing already exists; add `batchSubjectId` filter to existing components.

---

## 🔷 Category L — Database Views for Backward Compatibility

- [ ] Create view: `batch_teachers` → reads from `batch_subject_teachers` + `batch_subjects`
- [ ] Create view: `batch_contents` → reads from `batch_subject_contents` + `batch_subjects`
- [ ] Create view: `batch_mock_tests` → reads from `batch_subject_mock_tests` + `batch_subjects`
- [ ] **REMOVED** — `live_class_batch` table remains unchanged (still maps classes to batches). No backward-compatibility view needed.
- [ ] Verify views are UPDATEable (if not, add INSTEAD OF triggers)
- [ ] Verify views have same column names as original tables
- [ ] Verify views are indexed properly (push-down predicates work)
- [ ] **COMPLETED** ☐

---

# Rollback Strategy

Every migration must have a tested rollback path. This section documents the rollback strategy for each phase.

## Rollback by Migration

| Migration | Rollback SQL | Data Rollback | Destructive? | Backup Required? |
|---|---|---|---|---|
| **M1** (batch_subjects) | `DROP TABLE IF EXISTS public.batch_subjects CASCADE` | Full loss of all batch_subject data | ✅ YES — drops all dependent junction tables too | ✅ YES — full DB backup before execution |
| **M2** (batch_subject_teachers) | `DROP TABLE IF EXISTS public.batch_subject_teachers; RESTORE batch_teachers from backup view` | Old data preserved in `batch_teachers` (not yet dropped) | ❌ NO — old table still exists | ⚠️ RECOMMENDED |
| **M3** (batch_subject_contents) | `DROP TABLE IF EXISTS public.batch_subject_contents; RESTORE batch_contents from backup view` | Old data preserved in `batch_contents` | ❌ NO | ⚠️ RECOMMENDED |
| **M4** (batch_subject_mock_tests) | `DROP TABLE IF EXISTS public.batch_subject_mock_tests; RESTORE batch_mock_tests from backup view` | Old data preserved in `batch_mock_tests` | ❌ NO | ⚠️ RECOMMENDED |
| **M5** (live_classes.batch_subject_id) | `ALTER TABLE live_classes DROP COLUMN batch_subject_id; DROP CONSTRAINT fk_live_classes_batch_subject` | Original `subject_id` column preserved; no data loss | ❌ NO — non-destructive column drop | ⚠️ RECOMMENDED |
| **M6** (recordings) | `ALTER TABLE recordings DROP COLUMN batch_subject_id, DROP COLUMN source_type` | Original `batch_id` column preserved | ❌ NO — non-destructive column drop | ⚠️ RECOMMENDED |
| **M7** (RLS rewrite) | `RESTORE RLS policies from 021_rls_policies.sql backup` | No data loss (policies are metadata) | ❌ NO | ⚠️ RECOMMENDED |
| **M8** (cleanup — Phase 5) | `RESTORE old tables from backup views; DROP compatibility views` | Old table data preserved in views | ❌ NO (if views exist) / ✅ YES (if views were dropped) | ✅ YES |

## Rollback Procedure

### Emergency Rollback (within 1 hour of deployment)
```sql
-- 1. Disable new RLS policies
-- 2. Drop M6 changes (recordings)
ALTER TABLE recordings DROP COLUMN IF EXISTS batch_subject_id;
ALTER TABLE recordings DROP COLUMN IF EXISTS source_type;
-- 3. Drop M5 (live_classes.batch_subject_id)
ALTER TABLE live_classes DROP COLUMN IF EXISTS batch_subject_id;
ALTER TABLE live_classes DROP CONSTRAINT IF EXISTS fk_live_classes_batch_subject;
-- 4. Drop M4
DROP TABLE IF EXISTS public.batch_subject_mock_tests CASCADE;
-- 5. Drop M3
DROP TABLE IF EXISTS public.batch_subject_contents CASCADE;
-- 6. Drop M2
DROP TABLE IF EXISTS public.batch_subject_teachers CASCADE;
-- 7. Restore old RLS policies from backup
-- 8. Restore old views if they were dropped
-- 9. Only drop M1 last (foundation)
DROP TABLE IF EXISTS public.batch_subjects CASCADE;
```

### Safe Rollback (after 1 day, with dual-write active)
1. Remove code changes that READ from new tables (revert to reading from old tables)
2. Stop DUAL-WRITE to new tables
3. Drop new tables
4. Restore old RLS policies

## Rollback Testing Requirements
- [ ] Each migration's rollback SQL is tested in a staging environment before production
- [ ] Rollback of M2-M4 does NOT lose data (old tables still exist)
- [ ] Rollback of M5 (live_classes.batch_subject_id) does NOT lose data (column drop is non-destructive)
- [ ] Rollback of M6 does NOT lose data (batch_id column preserved)
- [ ] Rollback of M1 requires full DB restore from backup
- [ ] Full rollback procedure is documented and timed (< 30 minutes)
- [ ] **COMPLETED** ☐

---

# Performance Checklist

After EVERY migration, verify the following before proceeding to the next phase.

## M1 — batch_subjects
- [ ] Indexes present: `(batch_id)`, `(subject_id)`, `(institute_id)`, `(is_active)`
- [ ] Execution plan: `SELECT * FROM batch_subjects WHERE batch_id = ?` uses index scan
- [ ] Execution plan: `SELECT * FROM batch_subjects WHERE institute_id = ?` uses index scan
- [ ] Composite index: `(batch_id, subject_id)` — unique constraint creates backing index
- [ ] RLS overhead: policy subquery execution plan checked (no sequential scans)
- [ ] **COMPLETED** ☐

## M2 — batch_subject_teachers
- [ ] Indexes present: `(batch_subject_id)`, `(teacher_id)`, `(institute_id)`
- [ ] Execution plan: `SELECT * FROM batch_subject_teachers WHERE teacher_id = ?` uses index scan
- [ ] RLS query: teacher reads own assignments — verify index usage
- [ ] RLS query: admin reads all — verify institute_id index usage
- [ ] RLS query: student reads batch teachers — verify join path uses indexes
- [ ] **COMPLETED** ☐

## M3 — batch_subject_contents
- [ ] Indexes present: `(batch_subject_id)`, `(content_id)`, `(institute_id)`
- [ ] Execution plan: content list for a batch_subject — verify index-only scan
- [ ] Edge case: batch with 500 content items — query time < 50ms
- [ ] **COMPLETED** ☐

## M4 — batch_subject_mock_tests
- [ ] Indexes present: `(batch_subject_id)`, `(test_id)`, `(institute_id)`
- [ ] Execution plan: test list for batch_subject — verify index usage
- [ ] Full-syllabus test query: check for synthetic "Full Syllabus" batch_subject — verify no sequential scan
- [ ] **COMPLETED** ☐

## M5 — live_classes.batch_subject_id
- [ ] Index present: `(batch_subject_id)` on `live_classes` table
- [ ] FK constraint: `fk_live_classes_batch_subject` → `batch_subjects.batch_subject_id` verified
- [ ] Execution plan: `SELECT * FROM live_classes WHERE batch_subject_id = ?` uses index scan
- [ ] Execution plan: `SELECT lc.* FROM live_classes lc JOIN batch_subjects bs ON bs.batch_subject_id = lc.batch_subject_id WHERE bs.batch_id = ?` uses indexes (nested loop, not seq scan)
- [ ] Execution plan: student live class listing — verify path `live_classes.batch_subject_id → batch_subjects.batch_id → batch_students.student_id` is fully indexed
- [ ] Performance test: batch with 1000 live classes across 5 subjects — query time per subject < 20ms
- [ ] **COMPLETED** ☐

## M6 — Recordings
- [ ] Indexes present: `(batch_subject_id)`, `(source_type)`, composite `(batch_subject_id, status)`
- [ ] Execution plan: student recordings list — verify JOIN chain `recordings → batch_subjects → batch_students` uses indexes
- [ ] Execution plan: uploaded recordings filter by `source_type = 'uploaded'` — verify partial index usage
- [ ] **COMPLETED** ☐

## M7 — RLS Rewrite
- [ ] Every rewritten policy's subquery execution plan is checked (no nested loop joins on large tables)
- [ ] The `batch_subject_teachers` policy performs better than the old `batch_teachers` policy
- [ ] The `live_classes.batch_subject_id` policy performs as well as or better than the old `live_class_batch` policy (fewer JOINs)
- [ ] **COMPLETED** ☐

## System-Level Performance
- [ ] Concurrent query test: 100 simultaneous teacher dashboard requests — all complete within 2s
- [ ] Concurrent query test: 100 simultaneous student content list requests — all complete within 1s
- [ ] Migration dual-write overhead: write latency increase < 10% during dual-write phase
- [ ] **COMPLETED** ☐

---

# Definition of Done

Every phase must meet ALL completion criteria before the next phase begins.

## Phase 1 — Database Migration Complete
- [ ] All 6 migrations (M1–M6) run successfully with 0 errors
- [ ] Data backfill complete: every row in old tables has a corresponding row in new tables
- [ ] Row parity verified: `COUNT(old_table) <= COUNT(new_table)` for all migrations
- [ ] All FKs and constraints are in place and validated
- [ ] All indexes exist and are used by query planner
- [ ] No orphaned references (every FK points to a valid row)
- [ ] Rollback tested: each migration can be rolled back without data loss
- [ ] **COMPLETED** ☐

## Phase 2 — Dual Write Verified
- [ ] All 6 new service files created and unit-tested
- [ ] All 3 rewritten services (teacher, content, mock test assignment) dual-write to both old AND new tables
- [ ] All 8 updated services dual-write where applicable
- [ ] Dual-write produces identical data in old and new tables (automated comparison query passes)
- [ ] Dual-write does NOT increase request latency by more than 10%
- [ ] Old table data is NOT modified by new code (new code writes to both, reads from old)
- [ ] **COMPLETED** ☐

## Phase 3 — Read New Tables
- [ ] All services switched to READ from new tables
- [ ] Read queries produce IDENTICAL results to old queries (regression tested against production snapshot)
- [ ] Old tables are still being written to (dual-write continues)
- [ ] No increase in query latency after switching to new tables
- [ ] All 9 affected React pages rendering correctly with new data structure
- [ ] **COMPLETED** ☐

## Phase 4 — Edge Functions Updated
- [ ] `dispatch-notification` tested: teacher can send notifications to their batch subjects
- [ ] `dispatch-notification` tested: admin can send to any batch subject
- [ ] `recording-playback-url` tested: Workflow A (auto-generated) recordings play for enrolled students
- [ ] `recording-playback-url` tested: Workflow B (uploaded) recordings play for enrolled students
- [ ] `recording-playback-url` tested: teachers can access their own recordings
- [ ] **COMPLETED** ☐

## Phase 5 — Monitoring & Stabilization
- [ ] All services running in production for 7+ days with 0 data integrity issues
- [ ] Error rates unchanged from pre-migration baseline
- [ ] Query latency unchanged or improved
- [ ] No increase in support tickets related to batch/subject management
- [ ] All flagged data migration issues (e.g., teachers without specializations) resolved
- [ ] **COMPLETED** ☐

## Phase 6 — Cleanup
- [ ] Old tables converted to compatibility views
- [ ] No production queries reference old table names (all go through views)
- [ ] Views perform within 10% of direct table access
- [ ] Old tables deprecated in schema comments
- [ ] Hard-drop of old tables scheduled after 30-day deprecation window
- [ ] **COMPLETED** ☐

---

# Dual Write Strategy

Dual-write is the CRITICAL safety mechanism. It ensures zero-downtime migration by writing to both old and new tables simultaneously.

## Phase Diagram

```
Phase 1    Phase 2        Phase 3         Phase 4       Phase 5         Phase 6       Phase 7        Phase 8      Phase 9
CREATE  →  DUAL WRITE  →  READ NEW  →  EDGE FN →  MONITOR  →  COMPAT VIEWS →  ARCHIVE  →  DROP OLD
              (both)                    UPDATE        (7 days)

Old Tables:  WRITE ✓       WRITE ✓       WRITE ✓     WRITE ✓      → VIEW ←        READ ONLY    DROPPED
             READ  ✓       READ  ✓       READ  ✗     READ  ✗       READ ✗         READ ✗       READ ✗
New Tables:  (empty)       WRITE ✓       WRITE ✓     WRITE ✓      WRITE ✓        WRITE ✓      WRITE ✓
                           READ  ✗       READ  ✓     READ  ✓       READ ✓         READ ✓       READ ✓
```

## Phase Details

### Phase 1 — Create Tables
Create all 6 new tables. Tables are empty. No code changes yet. Data migration backfills the new tables from old data.

### Phase 2 — Dual Write (BACKUP PHASE)
**Duration:** 3–5 days
**What happens:** All CREATE/UPDATE/DELETE operations write to BOTH old and new tables.
**Reads:** Still from old tables.
**Verification:** Automated comparison query runs hourly to verify old = new data parity.
**Why:** If something goes wrong with the new tables, we can revert to reading from old tables instantly.

### Phase 3 — Read New Tables
**Duration:** 1–2 days
**What happens:** All READ operations switch to new tables. Writes continue to BOTH.
**Verification:** A/B comparison of query results from old vs new tables for 24 hours.
**Why:** Catches any data discrepancies that didn't surface during dual-write.

### Phase 4 — Edge Functions Update
**Duration:** 1 day
**What happens:** `dispatch-notification` and `recording-playback-url` are updated to use new schema.
**Why:** Edge functions run in isolation — they can be updated independently of the main application.

### Phase 5 — Monitor Production
**Duration:** 7 days minimum
**What happens:** Everything runs on new tables. Dual-write to old tables continues as safety net.
**Why:** 7 days covers a full weekly cycle of institute operations.

### Phase 6 — Compatibility Views
**Duration:** 1 day
**What happens:** Old tables are converted to views that SELECT from new tables.
**Why:** Any lingering queries or reports referencing old table names continue to work.

### Phase 7 — Archive
**Duration:** 30 days
**What happens:** Old tables are kept but NOT written to (writes go only to new tables). Old data is read-only.
**Why:** Provides a safety window for any missed edge cases.

### Phase 8 — Disable Old Writes
**Duration:** After Phase 7
**What happens:** Dual-write code removed from services. Writes go ONLY to new tables.
**Why:** Simplifies codebase and eliminates write amplification.

### Phase 9 — Drop Old Tables
**Duration:** After Phase 7
**What happens:** Old tables dropped. Compatibility views remain if needed.
**Why:** Final cleanup. Schema is now fully migrated.

## Dual Write Implementation Pattern
```typescript
// Example: Dual-write pattern for batchTeacherAssignmentService.ts
async function assignTeacherToSubject(input: AssignTeacherInput) {
  const oldTableResult = await supabase.from('batch_teachers').insert({
    batch_id: input.batchId,        // Derive from batch_subject_id
    teacher_id: input.teacherId,
    role_in_batch: input.role,
  });

  const newTableResult = await supabase.from('batch_subject_teachers').insert({
    batch_subject_id: input.batchSubjectId,
    teacher_id: input.teacherId,
    role_in_subject: input.role,
  });

  // If new table fails but old table succeeds: log error, continue (old data is safe)
  // If old table fails but new table succeeds: throw (new data is accurate)
  if (oldTableResult.error && !newTableResult.error) {
    console.warn('Dual-write warning: old table insert failed, new table succeeded', oldTableResult.error);
  }
  if (newTableResult.error) throw newTableResult.error;
}
```

## Dual Write Verification Queries
```sql
-- Verify teacher assignment parity
SELECT 
  bt.batch_id, bt.teacher_id,
  bst.batch_subject_id, bst.teacher_id
FROM batch_teachers bt
FULL OUTER JOIN batch_subject_teachers bst 
  ON bst.teacher_id = bt.teacher_id
  AND bst.batch_subject_id IN (
    SELECT batch_subject_id FROM batch_subjects WHERE batch_id = bt.batch_id
  )
WHERE bt.teacher_id IS NULL OR bst.teacher_id IS NULL;

-- Expected: 0 rows (all teachers present in both tables)
```

---

# Final Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        PLATFORM ARCHITECTURE                    │
│                     (Batch → Subject Model)                      │
└─────────────────────────────────────────────────────────────────┘

                           ┌────────────┐
                           │  INSTITUTE  │
                           └──────┬──────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
              ┌─────┴──────┐            ┌───────┴────────┐
              │   STREAMS   │            │    COURSES      │
              │ (NEET/JEE)  │            │ (Purchasable)   │
              └─────┬──────┘            └───────┬────────┘
                    │                           │
           ┌────────┴────────┐                  │
           │                 │                  │
     ┌─────┴─────┐    ┌──────┴──────┐           │
     │  SUBJECTS  │    │   BATCHES   │◄──────────┘
     │ (Physics,  │    │             │    (course_batches)
     │  Chemistry,│    │  batch_id   │
     │  Biology)  │    └──────┬──────┘
     └────────────┘           │
                              │
                    ┌─────────┴─────────┐
                    │  BATCH SUBJECTS    │  ← NEW: Linking layer
                    │  (batch_subject_id)│
                    └──┬──┬──┬──┬──┬────┘
                       │  │  │  │  │
         ┌─────────────┘  │  │  │  └──────────────┐
         │                │  │  │                 │
   ┌─────┴──────┐   ┌─────┴──┴──┴──────┐   ┌─────┴──────┐
   │  STUDENTS  │   │                  │   │  COURSES   │
   │ (batch_id) │   │   RESOURCES      │   │ (via batch)│
   └────────────┘   │                  │   └────────────┘
                     │ ┌──────────────┐│
                     │ │  TEACHERS    ││  batch_subject_teachers
                     │ ├──────────────┤│
                     │ │  CONTENT     ││  batch_subject_contents
                     │ ├──────────────┤│
                     │ │  MOCK TESTS  ││  batch_subject_mock_tests
                     │ ├──────────────┤│
                     │ │ LIVE CLASSES ││  live_classes.batch_subject_id (DIRECT FK)
                     │ ├──────────────┤│
                     │ │ RECORDINGS   ││  recordings.batch_subject_id
                     │ └──────────────┘│
                     └──────────────────┘

                    ┌─────────────────────────────┐
                    │   ACCESS CONTROL MODEL       │
                    ├─────────────────────────────┤
                    │ Student → batch_students     │
                    │ Teacher → batch_subject_tch  │
                    │ Content → batch_subject_cnt  │
                    │ MockTest → batch_subject_mt  ││  LiveClass → live_classes.batch_subject_id (direct FK) │
                    │ Recording → batch_subject_id │
                    └─────────────────────────────┘
```

## Key Benefits of This Architecture

1. **Single source of truth** — `batch_subject_id` is the atomic unit for all resource assignment
2. **Deterministic access control** — RLS policies are simple `batch_subject_id` checks
3. **Per-subject analytics** — Trivially queryable without complex joins
4. **Teacher specialization** — Enforced at DB level via FK to `teacher_specializations`
5. **Full-syllabus support** — Synthetic batch subjects handle multi-subject content
6. **Backward compatible** — Old tables preserved as views during transition
7. **Scalable** — All junction tables are narrow (3–5 columns), indexed for fast joins

---

---

## 🔷 Category M — Testing Checklist

### M1 — Database Testing
- [ ] Migration M1 runs successfully (batch_subjects created)
- [ ] Migration M2 runs successfully (batch_subject_teachers, data migrated)
- [ ] Migration M3 runs successfully (batch_subject_contents, data migrated)
- [ ] Migration M4 runs successfully (batch_subject_mock_tests, data migrated)
- [ ] Migration M5 runs successfully (batch_subject_live_classes, data migrated)
- [ ] Migration M6 runs successfully (recordings updated)
- [ ] Migration M7 runs successfully (RLS policies work)
- [ ] Verify all RLS policies: admin full access
- [ ] Verify all RLS policies: teacher reads own data only
- [ ] Verify all RLS policies: student reads batch data only
- [ ] Rollback test: can restore from backup
- [ ] **COMPLETED** ☐

### M2 — Backend Testing
- [ ] All 3 rewritten services return correct data from new tables
- [ ] All 8 updated services return correct data
- [ ] `dispatch-notification` edge function works with new schema
- [ ] `recording-playback-url` edge function works with new schema
- [ ] Batch creation → ALL stream subjects auto-created as batch_subjects (including Full Syllabus)
- [ ] Teacher assignment → subject-specific
- [ ] Content assignment → subject-specific
- [ ] Mock test assignment → subject-specific
- [ ] Live class creation → subject-specific
- [ ] **COMPLETED** ☐

### M3 — Frontend Testing
- [ ] Admin batch list shows subjects
- [ ] Admin batch detail has subject tabs (all stream subjects auto-created)
- [ ] Admin batch create flow — subjects auto-created from stream (no manual selection needed)
- [ ] Teacher live class create has subject selector
- [ ] Teacher content upload has subject selector
- [ ] Teacher mock test create has subject selector
- [ ] Teacher dashboard shows subject breakdown
- [ ] Student view: same content, just filtered by subject
- [ ] **COMPLETED** ☐

---

## 🔷 Category N — Data Migration Integrity Checks

- [ ] Count check: `batch_teachers` rows = `batch_subject_teachers` rows (after migration)
- [ ] Count check: `batch_contents` rows = `batch_subject_contents` rows
- [ ] Count check: `batch_mock_tests` rows = `batch_subject_mock_tests` rows
- [ ] Count check: `live_class_batch` rows = `batch_subject_live_classes` rows
- [ ] No orphaned `batch_subject_id` references (all FKs valid)
- [ ] No NULL `batch_subject_id` in recordings where class_id is set
- [ ] **COMPLETED** ☐

---

## 📊 Progress Summary

| Category | Total Items | Completed | Remaining |
|---|---|---|---|
| A — New SQL Migrations | 6 | ☐ | 6 |
| B — RLS Rewrite | 13 | ☐ | 13 |
| C — Existing Migrations to Update | 6 | ☐ | 6 |
| D — Cleanup (Phase 5) | 6 | ☐ | 6 |
| E — New TypeScript Types | 13 | ☐ | 13 |
| F — New Service Files | 5 | ☐ | 5 |
| G — Service Files to Rewrite/Update | 14 | ☐ | 14 |
| H — React Hooks | 6 | ☐ | 6 |
| I — Edge Functions | 5 | ☐ | 5 |
| J — React Pages | 14 | ☐ | 14 |
| K — New UI Components | 6 | ☐ | 6 |
| L — Database Views | 6 | ☐ | 6 |
| M — Testing | 20 | ☐ | 20 |
| N — Data Integrity | 6 | ☐ | 6 |
| O — Rollback Strategy | 5 | ☐ | 5 |
| P — Performance Checks | 20 | ☐ | 20 |
| Q — Definition of Done | 6 phases | ☐ | 6 |
| R — Dual Write Verification | 10 | ☐ | 10 |
| **TOTAL** | **~161** | **0** | **~161** |

---

*Last updated: July 28, 2026*
*Created by Buffy (DeepSeek v4 Flash)*
