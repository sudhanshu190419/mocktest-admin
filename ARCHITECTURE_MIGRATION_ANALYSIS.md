# Architecture Migration Analysis: Batch → Subject-Based Resource Assignment

> **Date:** July 28, 2026
> **Project:** mocktest-admin (Coaching Platform)
> **Scope:** Complete production architecture analysis

---

## SECTION 1 — CURRENT DATABASE ANALYSIS

### Complete Table Inventory

| # | Table | PK | Foreign Keys | Purpose | Module | batch_id | subject_id | teacher_id | student_id | course_id | stream_id |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `institutes` | institute_id | — | Root tenant entity | Foundation | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| 2 | `profiles` | profile_id | institute_id | User identity | Foundation | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| 3 | `teacher_details` | teacher_id | profile_id | Teacher profile ext. | Foundation, Teachers | ✗ | ✗ | ✓ (PK) | ✗ | ✗ | ✗ |
| 4 | `student_details` | student_id | profile_id, institute_id | Student profile ext. | Foundation, Students | ✗ | ✗ | ✗ | ✓ (PK) | ✗ | ✗ |
| 5 | `streams` | stream_id | institute_id | Exam programme (NEET/JEE) | Academic | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| 6 | `subjects` | subject_id | stream_id | Discipline (Physics/Chem) | Academic | ✗ | ✓ (PK) | ✗ | ✗ | ✗ | ✓ |
| 7 | `chapters` | chapter_id | subject_id | Syllabus unit | Academic | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |
| 8 | `topics` | topic_id | chapter_id | Sub-chapter | Academic | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| 9 | **`batches`** | batch_id | institute_id, stream_id | Operational delivery unit | Batch Management | ✓ (PK) | ✗ | ✗ | ✗ | ✗ | ✓ |
| 10 | **`batch_students`** | (batch_id, student_id) | batch_id, student_id | Student enrollment | Batch, Students | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| 11 | **`batch_teachers`** | (batch_id, teacher_id) | batch_id, teacher_id | Teacher assignment | Batch, Teachers | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| 12 | `content` | content_id | institute_id, teacher_id, chapter_id, subject_id | Learning materials | Content | ✗ | ✓ (denormalized) | ✓ | ✗ | ✗ | ✗ |
| 13 | **`batch_contents`** | (batch_id, content_id) | batch_id, content_id, institute_id | Content→Batch assignment | Content, Batch | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| 14 | `live_classes` | class_id | institute_id, teacher_id, subject_id, chapter_id | Live teaching unit | Live Classes | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ |
| 15 | **`live_class_batch`** | (class_id, batch_id) | class_id, batch_id | LC→Batch assignment | Live Classes, Batch | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| 16 | `recordings` (Domain 04) | recording_id | class_id, institute_id | Recording metadata | Live Classes | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ |
| 17 | **`recordings` (Migration 065)** | recording_id | institute_id, teacher_id, class_id, **batch_id** | Recording metadata (new) | Recordings | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| 18 | **`batch_mock_tests`** | assignment_id | batch_id, test_id | MT→Batch assignment | Mock Tests, Batch | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| 19 | `questions` | question_id | institute_id, subject_id, chapter_id | Question bank | Question Bank | ✗ | ✓ | ✗ (created_by) | ✗ | ✗ | ✗ |
| 20 | `mock_tests` | test_id | institute_id, teacher_id, stream_id, subject_id | Test configuration | Mock Tests | ✗ | ✓ (nullable) | ✓ | ✗ | ✗ | ✓ |
| 21 | `mock_attempts` | attempt_id | test_id, student_id, institute_id | Student attempt | Mock Tests | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |
| 22 | `courses` | course_id | institute_id, stream_id | Purchasable product | Course Management | ✗ | ✗ | ✗ | ✗ | ✓ (PK) | ✓ |
| 23 | `course_teachers` | (course_id, teacher_id) | course_id, teacher_id, institute_id | Teacher→Course | Course Mgmt | ✗ | ✗ | ✓ | ✗ | ✓ | ✗ |
| 24 | `course_batches` | (course_id, batch_id) | course_id, batch_id, institute_id | Batch→Course | Course Mgmt | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ |
| 25 | `course_content` | (course_id, content_id) | course_id, content_id, institute_id | Content→Course | Course Mgmt | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| 26 | `course_enrollments` | enrollment_id | course_id, student_id, institute_id | Student→Course | Course Mgmt, Commerce | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ |
| 27 | `course_mock_tests` | id | course_id, test_id, institute_id | MT→Course | Course Mgmt | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| 28 | `teacher_specializations` | (teacher_id, subject_id) | teacher_id, subject_id | Subject expertise | Teacher Management | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ |
| 29 | `attendance` | attendance_id | class_id, student_id, institute_id | Attendance record | Live Classes | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |
| 30 | `session_participants` | participant_id | session_id, class_id, student_id | Session log | Live Classes | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |

### Key Observations

1. **batch_id appears in 8 tables** as FK: `batches` (self-PK), `batch_students`, `batch_teachers`, `batch_contents`, `live_class_batch`, `batch_mock_tests`, `recordings`, `course_batches`
2. **subject_id already exists** in `content`, `live_classes`, `mock_tests`, `questions`, `question_explanations`, `teacher_specializations`, and analytics tables
3. **student_id NEVER references subject_id** — students belong only to batches
4. **No `batch_subjects` junction table exists** — subjects are globally defined per stream, not per batch

---

## SECTION 2 — SUBJECT SUPPORT

### Current State

**Subjects exist in the database** and are used as follows:

| Context | How subjects are used |
|---|---|
| **Academic hierarchy** | Stream → **Subject** → Chapter → Topic (defined in migration 003) |
| **Content** | `content.subject_id` — every content item is tagged to a subject (denormalized FK) |
| **Live Classes** | `live_classes.subject_id` — every live class has a subject FK |
| **Mock Tests** | `mock_tests.subject_id` — nullable; NULL = full-syllabus/full-subject test |
| **Questions** | `questions.subject_id` — every question belongs to a subject |
| **Teachers** | `teacher_specializations` — M:M junction, links teachers to subjects they can teach |
| **Chapter Performances** | Analytics table has subject_id denormalized |

### What does NOT exist

| Missing Feature | Why it matters |
|---|---|
| ❌ `batch_subjects` table | No junction linking batches to subjects. Subjects are global per stream, not scoped to a batch. |
| ❌ `subject_contents` table | Content is assigned to batches broadly, not to specific subjects within batches. |
| ❌ `subject_live_classes` | Live classes have subject_id but are linked to batches via `live_class_batch` directly. |
| ❌ `subject_mock_tests` | Mock tests have subject_id but are assigned to batches via `batch_mock_tests`. |
| ❌ `subject_recordings` | Recordings are linked to batches, not batch-subject combinations. |
| ❌ `subject_teachers` | Teachers are assigned to batches via `batch_teachers`, not to subjects within batches. |

---

## SECTION 3 — BATCH DEPENDENCY ANALYSIS

### Every Table with `batch_id` and Migration Recommendation

| Table | Why batch_id exists | Data linked through it | Continue using batch_id? | Should use batch_subject_id? | Recommendation |
|---|---|---|---|---|---|
| **`batches`** | Self-PK | The batch itself | ✓ Yes | ❌ No | Keep as-is. Parent entity. |
| **`batch_students`** | Students enroll in batches | Which students are in which batch | ✓ Yes | ❌ No | Students belong to batches, NOT subjects. No change needed. |
| **`batch_teachers`** | Teachers are assigned to batches | Which teachers teach which batch | ❌ Migrate | ✓ Yes | Replace with `batch_subject_teachers`. Teachers should be assigned to a subject within a batch. |
| **`batch_contents`** | Content is delivered to batches | Which content a batch receives | ❌ Migrate | ✓ Yes | Replace with `batch_subject_contents`. Content is subject-specific. |
| **`batch_mock_tests`** | Tests are assigned to batches | Which tests a batch can attempt | ❌ Migrate | ✓ Yes | Replace with `batch_subject_mock_tests`. Tests are subject-specific. |
| **`live_class_batch`** | Live classes target batches | Which batches see a live class | ❌ Migrate | ✓ Yes | Replace with `batch_subject_live_classes`. Live classes are subject-specific. |
| **`recordings` (065)** | Recordings visible to batch students | Which batch can view a recording | ❌ Migrate | ✓ Yes | Replace `batch_id` with `batch_subject_id`. Recordings are subject-scoped. |
| **`course_batches`** | Courses contain batches | Which batches are in a course | ✓ Yes | ❌ No | Course-to-batch relationship stays. Courses group batches. |

### Critical Finding

The `batch_teachers` table currently has NO subject scoping. A teacher assigned to a batch can theoretically teach ALL subjects in that batch. The client's request to scope teachers to subjects within batches is a fundamentally correct requirement for any serious coaching platform.

---

## SECTION 4 — COURSE ANALYSIS

### Current Course Architecture

```
Course (course_id)
  ├── Teachers (course_teachers)
  ├── Batches (course_batches)
  ├── Content (course_content)
  ├── Mock Tests (course_mock_tests)
  └── Students (course_enrollments)
```

### How Batches Connect to Courses

- `course_batches` is the M:M junction connecting courses to batches
- A batch can belong to multiple courses
- Course enrollments give students access to batches within a course

### Subjects Within Courses

Courses are linked to streams (e.g., NEET, JEE) but NOT directly to subjects. The `courses.stream_id` FK connects a course to a stream, and subjects belong to streams via the `subjects.stream_id` FK. So subjects are already implicitly part of courses through the stream hierarchy.

### Do courses solve the problem?

**Partially, but not adequately.**

Courses provide an additional grouping layer (beyond batches) for commerce and student access control, but they do NOT solve the core problem: **within a single batch, resources (teachers, content, tests, live classes) are not scoped to subjects.**

A batch named "NEET 2026 Morning Batch" might cover Physics, Chemistry, and Biology. Under the current architecture:
- **Content items** are tagged by `subject_id` but assigned to batches broadly via `batch_contents`
- **Teachers** are assigned to the batch, not to specific subjects within it
- **Mock tests** have `subject_id` but are assigned to the batch, not to a subject within it
- **Live classes** have `subject_id` but are linked to the batch, not to a subject within it

### Recommendation: Subjects Should Belong to BOTH Course and Batch

| Subject belongs to... | Relationship |
|---|---|
| **Course** | Via `courses.stream_id → streams → subjects`. Courses have implicit subjects through their stream. |
| **Batch** | Via a new `batch_subjects` junction. This is what should be created. |
| **Neither** | Subjects exist in the academic hierarchy independently. They are neither course-specific nor batch-specific. |

---

## SECTION 5 — MODULE IMPACT ANALYSIS

### 1. Question Bank

| Aspect | Detail |
|---|---|
| Current | Questions have `subject_id`. Assigned to tests. Tests assigned to batches. |
| Future | Unchanged. Questions already have `subject_id`. The change is in how tests are assigned. |
| Complexity | **Low** |
| Risk | **Low** — Queries on questions remain identical |

### 2. Mock Tests

| Aspect | Detail |
|---|---|
| Current | Tests assigned to batches via `batch_mock_tests`. Tests have `subject_id` (nullable). |
| Future | Tests assigned to batch-subjects via `batch_subject_mock_tests`. Need to ensure `subject_id` is required (not nullable). |
| Complexity | **Medium** — Requires new junction table, data migration, updated queries |
| Risk | **Medium** — Existing `batch_mock_tests` data must be migrated; `subject_id` constraint change |

### 3. Content Management

| Aspect | Detail |
|---|---|
| Current | Content assigned to batches via `batch_contents`. Content has `subject_id`. |
| Future | Content assigned to batch-subjects via `batch_subject_contents`. |
| Complexity | **Medium** — New junction table, migration from `batch_contents` |
| Risk | **Medium** — Course→batch→content chain is complex |

### 4. Teachers

| Aspect | Detail |
|---|---|
| Current | Teachers assigned to batches via `batch_teachers`. Subject specializations exist in `teacher_specializations`. |
| Future | Teachers assigned to batch-subjects via `batch_subject_teachers`. Must validate teacher's specialization matches the batch-subject. |
| Complexity | **High** — This is a fundamental RLS/access control change |
| Risk | **High** — Teacher dashboards, class creation, analytics all depend on the batch→teacher relationship |

### 5. Students

| Aspect | Detail |
|---|---|
| Current | Students assigned to batches via `batch_students`. No subject relationship (correct). |
| Future | **Unchanged.** Students still belong to batches only. Access to subject resources determined by batch membership + resource's batch_subject. |
| Complexity | **Low** |
| Risk | **Low** — Students remain batch-scoped |

### 6. Live Classes

| Aspect | Detail |
|---|---|
| Current | Live classes have `subject_id`. Linked to batches via `live_class_batch`. |
| Future | Live classes linked to batch-subjects via `live_class_batch_subject` (or similar). |
| Complexity | **Medium** — New junction table, scheduling UI changes |
| Risk | **Medium** — Live class creation flow must be updated |

### 7. Recordings

| Aspect | Detail |
|---|---|
| Current | Recordings have `batch_id` (Migration 065). Linked via live class or directly. |
| Future | Recordings reference `batch_subject_id` instead of `batch_id`. |
| Complexity | **Medium** — Schema change, RLS updates |
| Risk | **Medium** — Recording playback URL function uses `batch_id` directly |

### 8. Analytics

| Aspect | Detail |
|---|---|
| Current | Analytics reference `subject_id` extensively. Batch analytics aggregate students. |
| Future | Subject-per-batch analytics become possible. Student analytics remain batch-scoped. |
| Complexity | **Medium** — New aggregation queries benefit from the change |
| Risk | **Low** — Change improves analytics granularity |

### 9. Dashboard

| Aspect | Detail |
|---|---|
| Current | Teacher dashboard shows batch-level data aggregated. |
| Future | Teacher dashboard shows subject-within-batch level data. |
| Complexity | **High** — UI restructuring, new data fetching patterns |
| Risk | **High** — Teacher dashboard is the primary user-facing impact |

### 10. Batch Management

| Aspect | Detail |
|---|---|
| Current | CRUD for batches, assign teachers/students/content/tests/live classes. |
| Future | New "Subjects" tab within each batch. Subject-specific resource assignment. |
| Complexity | **High** — Major UI changes, new workflows |
| Risk | **High** — Core admin workflow changes |

### 11. Course Management

| Aspect | Detail |
|---|---|
| Current | Courses group batches. Resources assigned to courses or batches. |
| Future | Courses unchanged. But resource assignment moves from batch-level to subject-within-batch. |
| Complexity | **Medium** — Course→batch relationship preserved, but internal batch structure changes |
| Risk | **Medium** — May affect course content mapping |

---

## SECTION 6 — CODE IMPACT ANALYSIS

### Occurrence Counts Across the Project

| Identifier | Database (SQL) | Services (TS) | Hooks (TS) | Types (TS) | Pages/Views | Functions/Edge | Total (approx) |
|---|---|---|---|---|---|---|---|
| **`batch_id`** | ~40 | ~140 | ~15 | ~10 | ~15 | ~15 | **~235** |
| **`subject_id`** | ~50 | ~80 | ~5 | ~15 | ~5 | ~5 | **~160** |
| **`stream_id`** | ~25 | ~65 | ~5 | ~10 | ~5 | ~5 | **~115** |
| **`course_id`** | ~45 | ~100 | ~10 | ~5 | ~5 | ~15 | **~180** |
| **`teacher_id`** | ~55 | ~100 | ~5 | ~5 | ~10 | ~20 | **~195** |
| **`student_id`** | ~100 | ~55 | ~5 | ~5 | ~5 | ~20 | **~190** |
| **`test_id`** | ~50 | ~120 | ~5 | ~10 | ~5 | ~5 | **~195** |
| **`recording_id`** | ~3 | ~25 | ~2 | ~2 | ~2 | ~15 | **~49** |

### Breakdown by Layer

#### Database (Supabase SQL Migrations)
- **33 migration files** contain relevant ID references
- **21 RLS policies** reference `batch_id`, `teacher_id`, or `student_id`
- **8 RPC functions** (student analytics, score trends, test release)
- **6 Edge Functions** (recordings, webhooks, payments, notifications)
- **Triggers** on content, mock tests, live classes

#### Services (TypeScript — 28+ service files)
- `batchService.ts` — CRUD + queries (batch_id as primary filter)
- `batchManagementService.ts` — Admin batch management
- `batchStudentAssignmentService.ts` — Student enrollment
- `batchTeacherAssignmentService.ts` — Teacher assignment
- `batchContentAssignmentService.ts` — Content assignment
- `mockTestAssignmentService.ts` — Test assignment
- `teacherService.ts` — Teacher data access
- `teacherLiveClassService.ts` — Live class scheduling
- `recordingService.ts` — Recording management
- `analyticsService.ts` / `teacherAnalyticsService.ts` — Analytics

#### React Components & Pages (Frontend)
- **Batch Management pages** (`/admin/batches/`, `/teacher/batches/`) — 5+ pages
- **Live Class pages** (`/teacher/live-classes/`) — Scheduling, editing
- **Content pages** (`/teacher/content/`) — Upload, manage
- **Mock Test pages** (`/teacher/mock-tests/`) — Create, manage, assign
- **Dashboard pages** (`/teacher/dashboard/`, `/admin/dashboard/`)
- **Course Management pages** (`/admin/commerce/courses/`)

---

## SECTION 7 — RECOMMENDED DATABASE DESIGN

### Should the project introduce these tables?

| Table | Should we create? | Why |
|---|---|---|
| **`batch_subjects`** | ✅ **YES** | This is the core new entity — links subjects to batches. A single batch can have "Physics", "Chemistry", "Biology" subjects. |
| **`batch_subject_teachers`** | ✅ **YES** | Replaces `batch_teachers`. A teacher is assigned to teach "Physics in NEET 2026 Morning Batch", not just "NEET 2026 Morning Batch". |
| **`batch_subject_contents`** | ✅ **YES** | Replaces `batch_contents`. Content is assigned to "Physics in NEET 2026 Morning Batch". |
| **`batch_subject_mock_tests`** | ✅ **YES** | Replaces `batch_mock_tests`. Tests are assigned to "Physics in NEET 2026 Morning Batch". |
| **`batch_subject_live_classes`** | ✅ **YES** | Replaces/extends `live_class_batch`. Live classes are linked to "Physics in NEET 2026 Morning Batch". |
| **`batch_subject_recordings`** | ✅ **YES** | Replaces `recordings.batch_id`. Recordings scoped to subject within batch. |
| **`course_subjects`** | ❌ **NO** | Subjects are already implicitly part of courses through the stream hierarchy (`course.stream_id → stream → subjects`). |

### Complete ER Relationship (Proposed)

```
institutes
  └── streams
        ├── subjects (global academic hierarchy)
        ├── batches
        │     ├── batch_students (students → batches only)
        │     ├── batch_subjects ← NEW
        │     │     ├── batch_subject_teachers ← NEW (replaces batch_teachers)
        │     │     ├── batch_subject_contents ← NEW (replaces batch_contents)
        │     │     ├── batch_subject_mock_tests ← NEW (replaces batch_mock_tests)
        │     │     ├── batch_subject_live_classes ← NEW (replaces live_class_batch)
        │     │     └── batch_subject_recordings ← NEW (replaces recordings.batch_id)
        │     └── students (via batch_students)
        └── courses
              ├── course_batches (unchanged)
              ├── course_teachers (unchanged)
              ├── course_content (unchanged)
              ├── course_mock_tests (unchanged)
              └── course_enrollments (unchanged)
```

### `batch_subjects` Table Design

```sql
create table public.batch_subjects (
  batch_subject_id uuid not null default gen_random_uuid(),  -- Surrogate PK
  batch_id         uuid not null,
  subject_id       uuid not null,
  institute_id     uuid not null,
  name             varchar(100) not null,  -- Display name override
  sort_order       smallint not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid null,
  updated_by       uuid null,

  constraint pk_batch_subjects primary key (batch_subject_id),
  constraint uq_batch_subjects_batch_subject unique (batch_id, subject_id),
  constraint fk_bs_batch foreign key (batch_id) references batches (batch_id),
  constraint fk_bs_subject foreign key (subject_id) references subjects (subject_id),
  constraint fk_bs_institute foreign key (institute_id) references institutes (institute_id)
);
```

---

## SECTION 8 — MIGRATION STRATEGY

### Phase 1: Database (Estimated: 5–7 days)

**Tasks:**
1. Create `batch_subjects` table ✅
2. Create `batch_subject_teachers` table
3. Create `batch_subject_contents` table
4. Create `batch_subject_mock_tests` table
5. Create `batch_subject_live_classes` table (or extend `live_class_batch`)
6. Add `batch_subject_id` column to `recordings` table
7. Data migration: populate `batch_subjects` from existing batch-stream-subject relationships
8. Data migration: migrate `batch_teachers` → `batch_subject_teachers`
9. Data migration: migrate `batch_contents` → `batch_subject_contents`
10. Data migration: migrate `batch_mock_tests` → `batch_subject_mock_tests`
11. Data migration: migrate `live_class_batch` → `batch_subject_live_classes`
12. Update RLS policies for all new tables
13. Add indexes and performance tuning
14. Add check constraints (e.g., teacher must be specialized in the subject)

**Tables affected:** 6 new + 5 old (batch_teachers, batch_contents, batch_mock_tests, live_class_batch, recordings)
**Risk:** **High** — Data migration must be transactionally consistent; rollback plan required
**Dependencies:** None

### Phase 2: Backend / Services (Estimated: 5–7 days)

**Tasks:**
1. Create new service files: `batchSubjectService.ts`, `batchSubjectTeacherService.ts`, etc.
2. Update `batchService.ts` to expose subjects within batches
3. Update `teacherService.ts` for subject-scoped batch queries
4. Update `contentService.ts` for subject-scoped content queries
5. Update `mockTestService.ts` for subject-scoped test queries
6. Update `teacherLiveClassService.ts` for subject-scoped live classes
7. Update `recordingService.ts` for subject-scoped recordings
8. Update `analyticsService.ts` for per-subject-per-batch analytics
9. Update notification dispatch functions
10. Create backwards-compatible API endpoints (deprecation path)

**Files affected:** 15+ service files, 10+ hook files
**Risk:** **Medium** — Service layer is modular; each service can be migrated independently
**Dependencies:** Phase 1

### Phase 3: Admin Dashboard (Estimated: 5–7 days)

**Tasks:**
1. Add "Subjects" tab to Batch Detail page
2. Redesign teacher assignment UI — pick subject within batch
3. Redesign content assignment UI — pick subject within batch
4. Redesign mock test assignment UI — pick subject within batch
5. Update live class scheduling UI — pick subject within batch
6. Update recording management UI
7. Update batch creation wizard (select which subjects the batch covers)
8. Update course management (ensure course→batch→subject consistency)

**Files affected:** 10+ page components, 15+ UI components
**Risk:** **High** — Major UI restructuring; user experience must remain intuitive
**Dependencies:** Phases 1, 2

### Phase 4: Teacher Dashboard (Estimated: 3–5 days)

**Tasks:**
1. Update teacher dashboard to show subject-scoped data within batches
2. Update live class creation flow for subject-scoped batch selection
3. Update content upload flow for subject-scoped batch selection
4. Update mock test creation for subject-scoped batch selection
5. Update analytics views to show per-subject-per-batch breakdowns

**Files affected:** 8+ pages, 10+ components
**Risk:** **Medium** — Teacher views primarily read data; query changes are the main impact
**Dependencies:** Phases 1, 2

### Phase 5: Student App (Estimated: 2–3 days)

**Tasks:**
1. Update student home screen to show batch subjects
2. Update content listing to show subject-scoped content
3. Update live class listing to show subject-scoped classes
4. Update recordings list to show subject-scoped recordings
5. Update analytics to show per-subject performance

**Files affected:** 5+ pages, 5+ hooks/services
**Risk:** **Low** — Student app reads through RLS; data model changes are transparent
**Dependencies:** Phases 1, 2

### Total Estimated Effort: **20–29 days** (4–6 weeks with 1 developer)

---

## SECTION 9 — BREAKING CHANGES

### Database

| Change | Impact |
|---|---|
| `batch_teachers` deprecated in favor of `batch_subject_teachers` | All queries against `batch_teachers` break |
| `batch_contents` deprecated in favor of `batch_subject_contents` | Content assignment queries break |
| `batch_mock_tests` deprecated in favor of `batch_subject_mock_tests` | Test assignment queries break |
| `live_class_batch` deprecated or restructured | Live class scheduling queries break |
| `recordings.batch_id` replaced by `recordings.batch_subject_id` | Recording queries break |
| `mock_tests.subject_id` made NOT NULL (currently nullable) | Existing full-syllabus tests with NULL subject_id break |

### RLS Policies

| Policy | Impact |
|---|---|
| All `batch_teachers` policies | Must be rewritten for `batch_subject_teachers` |
| All `batch_contents` policies | Must be rewritten for `batch_subject_contents` |
| `live_class_batch` teacher INSERT/DELETE policies | Restructured for subject scope |
| Recording RLS (student view by batch) | Must reference `batch_subject_id` instead of `batch_id` |
| Content RLS (student view by batch) | Must reference `batch_subject_contents` |
| Mock test RLS (student view by batch) | Must reference `batch_subject_mock_tests` |

### RPCs & Edge Functions

| Function | Impact |
|---|---|
| `get_my_teacher_id()` | Unchanged (still returns teacher_details.teacher_id) |
| `release_test_results()` | Unchanged (references test_id, not batch) |
| `recording-playback-url` | Must resolve batch_subject_id for access control |
| `dispatch-notification` | Must resolve batch_subject for targeting |
| `livekit-webhook` | Attendance recording must resolve batch_subject |
| `complete-course-purchase` | Unchanged (course-level, not batch-level) |

### Types (Frontend + Backend)

| Type File | Impact |
|---|---|
| `src/types/academic.ts` | Add `BatchSubject`, `BatchSubjectTeacher` etc. interfaces |
| `src/types/mockTest.ts` | Update assignment types |
| `src/types/content.ts` | Update batch content assignment types |
| `src/types/recording.ts` | Update to reference `batchSubjectId` |
| `src/types/auth.ts` | May need updates for subject-scoped permissions |

### Frontend Pages

| Page | Impact |
|---|---|
| `/admin/batches/` | Major — subject tabs, assignment UIs |
| `/teacher/live-classes/create` | Medium — subject-within-batch selection |
| `/teacher/content/create` | Medium — subject-within-batch selection |
| `/teacher/mock-tests/create` | Medium — subject-within-batch selection |
| `/admin/commerce/courses/` | Low — courses reference batches, not subjects |

### Teacher Dashboard

| Feature | Impact |
|---|---|
| Batch listing | Shows subjects within each batch |
| Content management | Must select subject within batch |
| Live class scheduling | Must select subject within batch |
| Mock test management | Must select subject within batch |
| Analytics | Per-subject-per-batch breakdowns |

---

## SECTION 10 — FINAL RECOMMENDATION

### 1. Is this architecture change recommended?

**✅ YES, with caveats.**

The proposed change solves a real architectural deficiency. In any serious coaching platform, a batch covers multiple subjects (e.g., Physics, Chemistry, Biology for NEET). Each subject needs:
- A dedicated teacher (or team of teachers)
- Subject-specific content
- Subject-specific mock tests
- Subject-specific live classes
- Subject-specific recordings

The current flat-batch architecture cannot support:
- "Physics is taught by Teacher A, Chemistry by Teacher B" within the same batch
- "Show me only Physics live classes" within a batch
- "Generate analytics for Physics in Batch X"
- Content/tests accidentally visible across subjects within the same batch

### 2. Is it scalable for millions of students?

**✅ YES.** The proposed design scales well:

- `batch_subjects` is a narrow junction table (bounded by `batches × subjects`)
- `batch_subject_teachers` is bounded by `batch_subjects × teachers`
- Student access is still scoped through `batch_students` — the highest-volume table
- Indexes on `(batch_subject_id, ...)` will be efficient
- RLS policies can use the same `batch_id → institute_id` chain

### 3. Is there a better design than the client's proposal?

**The client's proposal is good, but here are refinements:**

1. **Surrogate PK for `batch_subjects`**: Instead of a composite PK `(batch_id, subject_id)`, use a surrogate `batch_subject_id uuid PK`. This makes all junction tables simpler and avoids composite FK chains.

2. **Keep old tables as views**: Don't drop `batch_teachers`, `batch_contents`, etc. immediately. Create database views with the old names that UNION or join the new tables for backward compatibility during a transition period.

3. **Batch_subject name/alias**: Allow admins to rename the subject within a batch context (e.g., "Physics Hons" vs just "Physics") via a `display_name` column.

4. **Course-Subject override**: Some courses may want to include or exclude specific subjects from a batch. Add an `is_included` flag on `batch_subjects` or handle at the course level.

### 4. What architecture would you recommend for a production coaching platform from scratch?

```
Institute
  └── Stream (NEET, JEE, etc.)
        ├── Subject (Physics, Chemistry, Biology) — global academic hierarchy
        │     └── Chapter → Topic
        ├── Batch
        │     ├── Batch_Subject (link)
        │     │     ├── Batch_Subject_Teacher
        │     │     ├── Batch_Subject_Content
        │     │     ├── Batch_Subject_MockTest
        │     │     ├── Batch_Subject_LiveClass
        │     │     └── Batch_Subject_Recording
        │     └── Batch_Student
        ├── Course (purchasable)
        │     ├── Course_Batch (which batches are included)
        │     ├── Course_Student (enrollment)
        │     └── Course_MockTest (tests included in course)
        └── Teacher (global)
```

**Key design principles:**
- **Subjects are global** — defined once per stream, reused across batches and courses
- **Batch_Subject is the atomic delivery unit** — all resource assignment happens at the batch_subject level
- **Students belong to batches** — they inherit access to all subjects in their batch
- **Teachers own subjects** — not entire batches

### 5. Estimates

| Category | Effort | Confidence |
|---|---|---|
| **Phase 1: Database** | 5–7 days | High — schema changes are straightforward |
| **Phase 2: Backend** | 5–7 days | Medium — many service files to update |
| **Phase 3: Admin Dashboard** | 5–7 days | Medium — UI complexity, UX design needed |
| **Phase 4: Teacher Dashboard** | 3–5 days | Medium-High — workflow changes |
| **Phase 5: Student App** | 2–3 days | Low — mostly data-fetching changes |
| **Testing** | 5–7 days | High — regression testing across all modules |
| **Data Migration** | 2–3 days | High — must be atomic with rollback |
| **Code Review + QA** | 3–5 days | Medium — cross-team effort |
| **Documentation** | 1–2 days | Low — API docs, migration guide |
| **TOTAL** | **31–46 days** (6–9 weeks) | Overall risk: **MEDIUM-HIGH** |
| **Single developer** | 8–10 weeks | |
| **Two developers (parallel DB + UI)** | 5–7 weeks | |

### Overall Risk Assessment

```
BREAKING CHANGES  ████████████████░░░░  HIGH (60% of modules affected)
DATA LOSS RISK    ████░░░░░░░░░░░░░░░░  LOW (old data preserved, new tables added)
ROLLBACK COMPLEX  ████████████████░░░░  HIGH (cannot easily revert schema changes)
SECURITY RISK     ██░░░░░░░░░░░░░░░░░░  LOW (RLS patterns are well-established)
PERFORMANCE       █░░░░░░░░░░░░░░░░░░░  VERY LOW (narrow junction tables, indexed)
UI/UX IMPACT      ██████████████░░░░░░  HIGH (fundamental workflow changes)
```

**Recommendation:** Proceed with the migration, but:
1. ✅ Do Phase 1 (Database) first and thoroughly test before proceeding
2. ✅ Keep old tables as views for backward compatibility during Phase 2–4
3. ✅ Implement a feature flag system to roll out the new UI gradually
4. ⚠️ Ensure QA has a dedicated testing environment for the data migration
5. ⚠️ Plan for a 1-week stabilization period after the migration

---

# SUPPLEMENT: EXACT MIGRATION IMPACT (File-by-File Analysis)

> This supplement provides the exact, file-level breakdown for every `batch_id` reference, every service, every RLS policy, every edge function, and every React page that will be affected.

---

## S1 — WHICH batch_id REFERENCES MUST CHANGE vs STAY

### ✅ References that STAY AS-IS (safe to keep)

| Table/File | Why it stays |
|---|---|
| **`batches.batch_id`** (PK) | The batch entity itself. No change. |
| **`batch_students.batch_id`** | Students belong to batches, not subjects. This is correct. |
| **`course_batches.batch_id`** | Courses group batches. The course→batch relationship is a commerce/grouping concern, not a subject-scoping concern. |
| **`course_enrollments`** (via batch_students) | Students enroll in courses, which include batches. Unchanged. |
| **`batches.stream_id`** | Each batch belongs to a stream. Unchanged. |
| **Supabase RPCs** that only reference `batch_students` for student counting | Student counting via batch_id remains valid. |

### ❌ References that MUST CHANGE (replace with batch_subject_id)

These 5 tables hold batch-scoped resource assignments that must become subject-scoped:

| Old Table | New Table | Reason |
|---|---|---|
| **`batch_teachers`** | `batch_subject_teachers` | A teacher teaches "Physics in Batch X", not "Batch X" |
| **`batch_contents`** | `batch_subject_contents` | Content belongs to "Physics in Batch X", not "Batch X" |
| **`batch_mock_tests`** | `batch_subject_mock_tests` | Tests belong to "Physics in Batch X", not "Batch X" |
| **`live_class_batch`** | `batch_subject_live_classes` | Live classes belong to "Physics in Batch X", not "Batch X" |
| **`recordings.batch_id`** | `recordings.batch_subject_id` | Recordings belong to "Physics in Batch X", not "Batch X" |

### ❌ RLS Policies that reference these tables (all must change)

Every RLS policy that references `batch_teachers` or `live_class_batch` or `batch_mock_tests` or `batch_contents` must be rewritten.

---

## S2 — WHICH SQL MIGRATIONS ARE REQUIRED

### New migrations to create (in order)

| # | Migration Name | Purpose |
|---|---|---|
| **M1** | `066_domain_17_batch_subject_core.sql` | Create `batch_subjects` table. Seed initial data from existing batch+subject relationships. |
| **M2** | `067_domain_17_batch_subject_teachers.sql` | Create `batch_subject_teachers`. Migrate data from `batch_teachers`. |
| **M3** | `068_domain_17_batch_subject_contents.sql` | Create `batch_subject_contents`. Migrate data from `batch_contents`. |
| **M4** | `069_domain_17_batch_subject_mock_tests.sql` | Create `batch_subject_mock_tests`. Migrate data from `batch_mock_tests`. |
| **M5** | `070_domain_17_batch_subject_live_classes.sql` | Create `batch_subject_live_classes`. Migrate data from `live_class_batch`. |
| **M6** | `071_domain_17_batch_subject_recordings.sql` | Add `batch_subject_id` to `recordings`. Migrate data. |
| **M7** | `072_domain_17_rls_policies.sql` | Replace all RLS policies that reference old junction tables. |
| **M8** | `073_domain_17_cleanup.sql` | (Optional — after stabilization) Drop old tables. Create backward-compatible views. |

### Existing migrations that must be updated

| Migration | Change needed |
|---|---|
| **`021_rls_policies.sql`** | Major rewrite of Sections 4 (batches), 6 (live classes), 10 (analytics) — 15+ policies |
| **`031_batch_mock_tests.sql`** | Replace with new `batch_subject_mock_tests` migration |
| **`050_add_live_class_batch_teacher_policies.sql`** | Replace with `batch_subject_live_classes` INSERT/DELETE policies |
| **`051_fix_live_class_batch_rls_recursion.sql`** | Add new helper functions for batch_subject access checks |
| **`056_batch_contents.sql`** | Replace with new `batch_subject_contents` migration |
| **`065_create_recordings_table.sql`** | Update to use `batch_subject_id` instead of `batch_id` |

---

## S3 — WHICH RLS POLICIES MUST CHANGE

### Policies in `021_rls_policies.sql` that MUST change

| Section | Policy Name | Reason | Action |
|---|---|---|---|
| **4e** | `"Teachers can read batches they are assigned to"` | Uses `batch_teachers` subquery | Rewrite to use `batch_subject_teachers` |
| **4f** | `"Teachers can read batch_students for their batches"` | Uses `batch_teachers` subquery | Rewrite to use `batch_subject_teachers` |
| **4g** | `"Teachers can read their own batch_teachers assignments"` | Direct `batch_teachers` table | Rewrite for `batch_subject_teachers` |
| **4g** | `"Admins have full access to batch_teachers"` | Direct `batch_teachers` table | Rewrite for `batch_subject_teachers` |
| **6a** | `"Students can read live_classes for their batches"` | Uses `live_class_batch` | Rewrite to use `batch_subject_live_classes` |
| **6c** | `"Teachers can read live_class_batch for their classes"` | Direct `live_class_batch` | Rewrite for `batch_subject_live_classes` |
| **6c** | `"Admins have full access to live_class_batch"` | Direct `live_class_batch` | Rewrite for `batch_subject_live_classes` |
| **6d** | `"Students can read recordings for their batch classes"` | Uses `live_class_batch` | Update to reference `batch_subject_id` |
| **6d** | `"Teachers can read recordings for their classes"` | Uses `live_classes` directly | Unchanged (still teacher_id) |
| **10a** | `"Teachers can read performance_reports for their students"` | Uses `batch_teachers` subquery | Rewrite to use `batch_subject_teachers` |
| **10d** | `"Teachers can read progress_history for their students"` | Uses `batch_teachers` subquery | Rewrite to use `batch_subject_teachers` |

### Policies in other migrations that MUST change

| Migration | Policy | Action |
|---|---|---|
| **031** | `"Teachers can read batch_mock_tests for their batches"` | Rewrite for `batch_subject_mock_tests` |
| **031** | `"Students can read batch_mock_tests for their batches"` | Rewrite for `batch_subject_mock_tests` |
| **050** | `"Teachers can insert into live_class_batch for their classes"` | Rewrite for `batch_subject_live_classes` |
| **050** | `"Teachers can delete from live_class_batch for their classes"` | Rewrite for `batch_subject_live_classes` |
| **056** | `"Teachers can read batch_contents for their batches"` | Rewrite for `batch_subject_contents` |
| **056** | `"Students can read batch_contents for their batches"` | Rewrite for `batch_subject_contents` |
| **065** | `"Students view batch recordings"` | Rewrite to use `batch_subject_id` |

### Total: **20+ RLS policies** must be rewritten

---

## S4 — WHICH RPCs WILL BREAK

| RPC Name | Location | Will it break? | Why |
|---|---|---|---|
| `get_my_institute_id()` | 021_rls_policies.sql | **NO** | Only references `profiles` |
| `is_admin()` | 021_rls_policies.sql | **NO** | Only references `profiles` |
| `is_teacher()` | 021_rls_policies.sql | **NO** | Only references `profiles` |
| `is_student()` | 021_rls_policies.sql | **NO** | Only references `profiles` |
| `get_my_teacher_id()` | 021_rls_policies.sql | **NO** | Only references `teacher_details` |
| `get_my_student_id()` | 021_rls_policies.sql | **NO** | Only references `student_details` |
| `release_test_results(p_test_id)` | 035_mock_test_result_release.sql | **NO** | References only `mock_results` and `mock_attempts` by test_id |
| `unrelease_test_results(p_test_id)` | 035_mock_test_result_release.sql | **NO** | Same as above |
| `get_test_release_status(p_test_id)` | 035_mock_test_result_release.sql | **NO** | Same as above |
| `get_student_dashboard_summary()` | 036_student_dashboard_summary_rpc.sql | **NO** | References `batch_students` (unchanged) and `mock_results` |
| `get_subject_chapter_analytics()` | 037_student_subject_chapter_analytics_rpcs.sql | **NO** | References `questions.subject_id` and `chapters.subject_id` (unchanged) |
| `get_score_trend()` | 038_student_score_trend_rpc.sql | **NO** | References `mock_results` |
| `is_student_enrolled_in_course()` | 034_domain_16_course_enrollments.sql | **NO** | References `course_enrollments` (unchanged) |
| `calculate_class_attendance()` | 053_live_class_attendance.sql | **NO** | References `attendance` and `live_sessions` (unchanged) |
| `trgfn_courses_set_published_at()` | 032_domain_16_course_management_core.sql | **NO** | Only references `courses` table |

**Conclusion: NO existing RPCs will break directly.** However, several RPCs will return different/richer data once the underlying tables change. For example, `get_student_dashboard_summary()` could be enhanced to include per-subject breakdowns within each batch, but the existing query will continue working.

---

## S5 — WHICH EDGE FUNCTIONS WILL BREAK

### Edge Functions that reference `batch_teachers` — WILL BREAK

| Function | File | Lines affected | What fails |
|---|---|---|---|
| **`dispatch-notification`** | `supabase/functions/dispatch-notification/index.ts` | **Lines 341, 356, 396, 410** | Queries `batch_teachers` to validate teacher's batch assignment and fetch students. Will fail when `batch_teachers` is deprecated. |

### Edge Functions that reference `recordings.batch_id` — WILL BREAK

| Function | File | Lines affected | What fails |
|---|---|---|---|
| **`recording-playback-url`** | `supabase/functions/recording-playback-url/index.ts` | **Line 205**: `const batchId = recording.batch_id` | Reads `batch_id` from recordings to check student access. Will return null/undefined. |
| | | **Lines 238-240**: Queries `batch_students` by `batch_id` | The batch_id won't exist in the new schema. |

### Edge Functions that reference `live_class_batch` — WILL BREAK

| Function | File | Lines affected | What fails |
|---|---|---|---|
| **`dispatch-notification`** | (same as above) | **Line 359**: validates batch assignment | No longer directly uses live_class_batch for audience targeting, but uses batch_students |
| **`livekit-webhook`** | `supabase/functions/livekit-webhook/index.ts` | Possible attendance recording path | May reference live_class_batch to resolve student enrollment |

### Edge Functions that are UNCHANGED (safe)

| Function | Why safe |
|---|---|
| **`recording-egress-start`** | References `live_classes.teacher_id` and `live_classes.class_id` — both unchanged |
| **`recording-egress-stop`** | References `recordings.recording_id` and `live_classes.class_id` — both unchanged |
| **`recording-timeout`** | References `recordings.recording_id` — unchanged |
| **`recording-webhook`** | References `recordings.recording_id` — unchanged |
| **`recording-delete`** | References `recordings.recording_id` — unchanged |
| **`create-payment-order`** | References `courses.course_id` and `student_details` — unchanged |
| **`complete-course-purchase`** | References `courses.course_id` and `student_details` — unchanged |
| **`complete-pyq-purchase`** | References `pyq_packages` and `student_details` — unchanged |
| **`razorpay-webhook`** | References `orders` and `order_items` — unchanged |
| **`livekit-token`** | Generates LiveKit tokens — no DB dependency |

### Total: **2 Edge Functions** will break: `dispatch-notification` and `recording-playback-url`

---

## S6 — WHICH REACT PAGES NEED UPDATES

### By Route

| Route | Module | Impact Level | What changes |
|---|---|---|---|
| **`/admin/batches/`** | Batch Management | 🔴 **HIGH** | New "Subjects" tab. Teacher/content/test/live class assignment UIs must allow subject selection. |
| **`/admin/batches/[id]`** | Batch Detail | 🔴 **HIGH** | Subject listing, per-subject teacher management, per-subject content management |
| **`/admin/batches/create`** | Batch Create | 🟡 **MEDIUM** | New step: select which subjects this batch covers |
| **`/admin/commerce/courses/`** | Course Management | 🟢 **LOW** | Minor — courses reference batches, subjects are transparent |
| **`/admin/content/`** | Content (Admin) | 🟡 **MEDIUM** | Content assignment flow must include subject picker |
| **`/admin/questions/`** | Questions (Admin) | 🟢 **LOW** | No batch_id reference — only subject_id (unchanged) |
| **`/admin/mock-tests/`** | Mock Tests (Admin) | 🟡 **MEDIUM** | Test assignment to batches — add subject scoping |
| **`/admin/students/`** | Students (Admin) | 🟢 **LOW** | Students still belong to batches — no change |
| **`/admin/teachers/`** | Teachers (Admin) | 🟡 **MEDIUM** | Teacher assignment to batches — add subject scoping |
| **`/teacher/live-classes/`** | Live Classes | 🔴 **HIGH** | Create/edit live class: must select subject WITHIN batch |
| **`/teacher/content/`** | Content (Teacher) | 🔴 **HIGH** | Upload content: must select subject WITHIN batch |
| **`/teacher/mock-tests/`** | Mock Tests (Teacher) | 🔴 **HIGH** | Create test: must select subject WITHIN batch |
| **`/teacher/analytics/`** | Analytics | 🟡 **MEDIUM** | Per-subject-per-batch breakdowns |
| **`/teacher/dashboard/`** | Dashboard | 🟡 **MEDIUM** | Cards/statistics for subjects within batches |
| **`/teacher/recordings/`** | Recordings | 🟡 **MEDIUM** | Recording listing scoped to subjects within batches |

### React Hook Files Affected

| Hook File | Impact | What changes |
|---|---|---|
| `src/hooks/admin/useBatchManagement.ts` | 🔴 HIGH | Must return subjects within each batch |
| `src/hooks/admin/useBatchTeacherAssignment.ts` | 🔴 HIGH | Must assign teacher to subject within batch |
| `src/hooks/admin/useBatchStudentAssignment.ts` | 🟢 LOW | Students → batches only — unchanged |
| `src/hooks/admin/useBatchContentAssignment.ts` | 🔴 HIGH | Must assign content to subject within batch |
| `src/hooks/admin/useMockTestAssignment.ts` | 🔴 HIGH | Must assign test to subject within batch |
| `src/hooks/useLiveClass.ts` | 🔴 HIGH | Must link live class to subject within batch |
| `src/hooks/admin/useCourseBatchAssignment.ts` | 🟢 LOW | Courses → batches — unchanged |

---

## S7 — WHICH SERVICES NEED UPDATES

### Services that MUST be rewritten (complete replacement of junction table logic)

| Service File | Existing Table(s) | New Table | Impact |
|---|---|---|---|
| **`src/services/admin/batchTeacherAssignmentService.ts`** | `batch_teachers` | `batch_subject_teachers` | 🔴 **COMPLETE REWRITE** — 13 functions, entire file references `batch_teachers` |
| **`src/services/admin/batchContentAssignmentService.ts`** | `batch_contents` | `batch_subject_contents` | 🔴 **COMPLETE REWRITE** — 11 queries, entire file references `batch_contents` |
| **`src/services/admin/mockTestAssignmentService.ts`** | `batch_mock_tests` | `batch_subject_mock_tests` | 🔴 **COMPLETE REWRITE** — 15+ queries, entire file references `batch_mock_tests` |

### Services that need SIGNIFICANT updates (JOINs, subqueries)

| Service File | What changes | Impact |
|---|---|---|
| **`src/services/teacherLiveClassService.ts`** | All `live_class_batch` queries (lines 344, 556, 761, 951, 972) must reference `batch_subject_live_classes` | 🔴 **HIGH** — 10+ queries |
| **`src/services/teacherService.ts`** | `batch_teachers` queries (lines 30, 143, 573) + `live_class_batch` (lines 362, 614) | 🟡 **MEDIUM** — 5+ queries |
| **`src/services/liveClassAttendanceService.ts`** | `live_class_batch` queries (lines 443, 677, 878, 1222, 1254) | 🟡 **MEDIUM** — 5+ queries |
| **`src/services/attendanceAnalyticsService.ts`** | `batch_teachers` (lines 133, 240, 276, 453, 568, 985) + `live_class_batch` (lines 677, 878, 1222, 1254) | 🟡 **MEDIUM** — 10+ queries |
| **`src/services/recording/recordingService.ts`** | `live_class_batch` query (line 220) to resolve batch_id | 🟡 **MEDIUM** — resolve `batch_subject_id` instead |
| **`src/services/admin/batchManagementService.ts`** | `batch_teachers` JOINS (lines 380, 414, 463, 556, 1082, 1111, 1137) + `live_class_batch` (line 1008) | 🔴 **HIGH** — 10+ JOINs must include subject scoping |
| **`src/services/admin/courseBatchAssignmentService.ts`** | `batch_teachers` for teacher counts (lines 130, 142) | 🟢 **LOW** — update aggregation queries |
| **`src/services/admin/teacherLifecycleService.ts`** | `batch_teachers` query (line 357) | 🟢 **LOW** — update query |
| **`src/services/profileService.ts`** | `batch_teachers` query (line 80-82) | 🟢 **LOW** — update query |
| **`src/services/adminService.ts`** | `batch_teachers` count query (line 182) | 🟢 **LOW** — update query |
| **`src/services/admin/dashboardService.ts`** | Batch count (line 114) — only uses `batches` table | 🟢 **LOW** — may add subject breakdown |

### Services that are UNCHANGED (safe)

| Service File | Why safe |
|---|---|
| `src/services/academic/batchService.ts` | Core batch CRUD — references `batches` table (unchanged) |
| `src/services/academic/streamService.ts` | Stream CRUD — references `streams` table |
| `src/services/academic/subjectService.ts` | Subject CRUD — references `subjects` table |
| `src/services/academic/chapterService.ts` | Chapter CRUD — references `chapters` table |
| `src/services/mockTest/mockTestService.ts` | Mock test CRUD — references `mock_tests` table |
| `src/services/mockTest/questionService.ts` | Question CRUD — references `questions` table |
| `src/services/mockTest/resultService.ts` | Result CRUD — references `mock_results` table |
| `src/services/content/contentService.ts` | Content CRUD — references `content` table |
| `src/services/analytics/analyticsService.ts` | Analytics — uses `tests`, `questions`, `student_id` |
| `src/services/analytics/teacherAnalyticsService.ts` | Teacher analytics — uses `tests`, `mock_results` |
| `src/services/pyq/*` | PYQ module — independent of batches |
| `src/services/auth/*` | Auth — independent of batches |
| `src/services/notification/*` | Notifications — references `notifications` table |
| `src/services/admin/courseManagementService.ts` | Course CRUD — references `courses` |
| `src/services/admin/courseTeacherAssignmentService.ts` | `course_teachers` — unchanged |
| `src/services/admin/courseContentAssignmentService.ts` | `course_content` — unchanged (but will be deprecated per 056) |
| `src/services/admin/commerceService.ts` | Commerce — references `orders`, `payments` |

### Types files affected

| Type File | Impact |
|---|---|
| `src/types/academic.ts` | Add `BatchSubject`, `BatchSubjectTeacher`, `BatchSubjectContent`, `BatchSubjectMockTest`, `BatchSubjectLiveClass` interfaces |
| `src/types/mockTest.ts` | Update `MockTestAssignment` to include `batchSubjectId` |
| `src/types/content.ts` | Update content assignment types to include `batchSubjectId` |
| `src/types/recording.ts` | Replace `batchId` with `batchSubjectId` |

---

## S8 — MIGRATION ORDER (Safe, Non-Breaking Sequence)

The key strategy is: **ADD FIRST, MIGRATE SECOND, REMOVE THIRD**.

```
Phase 1 ───────────────► Phase 2 ──────────────► Phase 3 ──────────────► Phase 4 ──────────────► Phase 5
Database (add new)      Services (dual-write)   Services (read new)     UI (use new)            Cleanup
────────────────────────────────────────────────────────────────────────────────────────────────────
M1: batch_subjects      batchSubjectService     batchService            Admin pages              Drop old tables
M2: batch_subject_tch   batchSubjectTchSvc      teacherService          Teacher pages            (optional)
M3: batch_subject_cnt   batchSubjectCntSvc      contentService          Student pages
M4: batch_subject_mt    batchSubjectMtSvc       mockTestService
M5: batch_subject_lc    batchSubjectLcSvc       liveClassService
M6: batch_subject_rec   batchSubjectRecSvc      recordingService
M7: RLS policies        (dual-write: old + new)  attendanceService
                        dispatch-notification    analyticsService
                        recording-playback-url   recording-playback-url
```

### Detailed Step-by-Step Order

#### Step 1 — Phase 1A: Add new tables (safe — no dependency)
Execute migrations M1–M6. None of these migrations drop or modify existing tables. They only create new tables and seed data.

#### Step 2 — Phase 1B: Seed batch_subjects (safe — read-only)
Populate `batch_subjects` from existing batch+subject relationships. Since each batch belongs to a stream, and subjects belong to streams, we can infer which subjects a batch might cover. However, **this requires admin input** — not all subjects from a stream may be relevant to a given batch.

**Recommended approach:** Add a "Subjects" step to the batch creation/edit UI. For existing batches, seed with ALL subjects from the batch's stream, then let admins remove irrelevant ones.

#### Step 3 — Phase 2A: New services (safe — no read traffic)
Create new service files:
- `src/services/academic/batchSubjectService.ts`
- `src/services/academic/batchSubjectTeacherService.ts`
- `src/services/academic/batchSubjectContentService.ts`
- `src/services/academic/batchSubjectMockTestService.ts`
- `src/services/academic/batchSubjectLiveClassService.ts`
- `src/services/academic/batchSubjectRecordingService.ts`

#### Step 4 — Phase 2B: Dual-write services (safe — non-breaking)
Update existing services to write to BOTH old and new tables. This is the critical safety step:
- `batchTeacherAssignmentService.ts` → writes to both `batch_teachers` AND `batch_subject_teachers`
- `batchContentAssignmentService.ts` → writes to both `batch_contents` AND `batch_subject_contents`
- `mockTestAssignmentService.ts` → writes to both `batch_mock_tests` AND `batch_subject_mock_tests`
- `teacherLiveClassService.ts` → writes to both `live_class_batch` AND `batch_subject_live_classes`
- `recordingService.ts` → writes to both `recordings.batch_id` AND `recordings.batch_subject_id`

**During this phase:** Old queries continue reading from old tables. New queries can start reading from new tables.

#### Step 5 — Phase 2C: Read from new tables (safe — data is now populated)
Update services to read from the new tables instead of (or in addition to) the old ones. The old tables still have complete data because of dual-writes.

#### Step 6 — Phase 3: UI updates (safe — services already work with new schema)
Update admin and teacher pages. The backend services have been fully migrated and read from the new tables.

#### Step 7 — Phase 4: Edge Functions update (safe — no downtime)
Update `dispatch-notification` and `recording-playback-url` to use the new schema.

#### Step 8 — Phase 5: Cleanup (safe — after 1-week stabilization)
Only after verifying that no queries reference the old tables:
- Drop dual-write logic from services
- Drop old tables or convert to views
- Remove old RLS policies

### What NOT to do

1. **❌ Don't migrate all at once** — The dual-write phase is essential for zero-downtime migration
2. **❌ Don't drop old tables immediately** — Keep them for 1+ week as a safety net
3. **❌ Don't make `mock_tests.subject_id` NOT NULL yet** — This breaks existing full-syllabus tests. Either set NULL to 'full_syllabus' or handle in the application layer
4. **❌ Don't modify `batch_students`** — Students belong to batches, not subjects. This is correct as-is

---

## SUMMARY: WHAT BREAKS vs WHAT DOESN'T

| Category | Total affected | Breaks immediately? |
|---|---|---|
| **Database tables to CREATE** | 6 new tables | ✅ No — new tables are additive |
| **Database tables to MODIFY** | 1 (recordings — add column) | ✅ No — adding a column is safe |
| **Database tables to DEPRECATE** | 5 old tables | ❌ Yes — queries against old tables break when they're dropped |
| **RLS Policies** | 20+ must be rewritten | ❌ Yes — if old tables are dropped without new policies |
| **RPCs** | 0 will break | ✅ No — all RPCs read from tables that stay unchanged |
| **Edge Functions** | 2 will break | ❌ Yes — dispatch-notification and recording-playback-url |
| **Services (complete rewrite)** | 3 | ❌ Yes — teacher, content, mock test assignment services |
| **Services (significant update)** | 8 | ❌ Yes — live class, attendance, batch management, analytics |
| **Services (unchanged)** | 17 | ✅ No |
| **React pages (high impact)** | 5 | ❌ Yes — batch management, live classes, content, mock tests |
| **React pages (medium impact)** | 4 | ❌ Yes — analytics, dashboard, recordings |
| **React pages (low/no impact)** | 5+ | ✅ No |
| **React hooks (high impact)** | 5 | ❌ Yes |
| **React hooks (unchanged)** | 2 | ✅ No |
| **Type files** | 4 | ❌ Yes — new interfaces needed |

### Key Numbers
- **6** new database tables to create
- **5** existing tables to deprecate
- **20+** RLS policies to rewrite
- **2** Edge Functions to update
- **11** service files to rewrite or significantly update
- **9** React pages to update
- **~235** total `batch_id` references (mostly in service files)
- **0** RPCs will break (best-case scenario)

---

*Report generated by Buffy (DeepSeek v4 Flash) — July 28, 2026*
