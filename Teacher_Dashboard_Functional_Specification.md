# Teacher Dashboard — Functional Specification

> **Derived from Supabase Migrations 001–025**
> **Prepared for:** Amar (Frontend Developer)
> **Generated:** July 6, 2026
> **Scope:** Full analysis of tables, enums, relationships, RLS policies, triggers, constraints, and business logic

---

## Section 1: Teacher Dashboard Overview

### What the Teacher Can Do

Based on the schema, a teacher (identified by `profiles.role = 'teacher'`) is mapped to `teacher_details` (1:1). Through this identity, a teacher has full CRUD access to their own resources across the following domains:

| Domain | What the Teacher Owns |
|--------|----------------------|
| **Content Management** (Domain 03) | Upload and manage PDFs, videos, notes, assignments |
| **Live Classes** (Domain 04) | Schedule, conduct, and manage live classes |
| **Question Bank** (Domain 05) | Create, edit, and manage questions (MCQ, MSQ, Numerical, True/False) |
| **Mock Tests** (Domain 05) | Create, configure, publish, and manage mock tests |
| **PYQ Management** (Domain 06) | Manage PYQ papers, question mappings, solutions |
| **Analytics** (Domain 08) | View personal analytics (teacher_analytics) and student performance |
| **Profile** (Domain 01, 13) | Manage own qualifications, experience, availability, leave requests |
| **Doubts** (Domain 14) | Read and reply to student doubts for subjects they specialise in |

**Source:** Migration 002 (Domain 01 — `teacher_details`), Migration 021 (RLS policies — teachers get `FOR ALL` on own resources)

### What the Teacher Cannot Do

The following are explicitly **blocked** by RLS policies:

- **Access admin-only tables:** `audit_logs`, `system_settings`, `api_keys`, `webhook_endpoints`, `feature_flags` (Migration 021, Sections 12, 17)
- **Access student HR data:** `teacher_employment_records`, `teacher_bank_details` (Migration 021, Section 15)
- **Modify other teachers' resources:** RLS enforces `teacher_id = get_my_teacher_id()` on content, questions, mock_tests, live_classes
- **Access orders / payments / invoices directly:** Only students (own) and admins (all) can access commerce tables (Migration 021, Section 9)
- **Delete or update student_subscriptions:** Only students and admins have access (Migration 021, Section 13)
- **Modify notification_templates:** Admin-only (Migration 021, Section 11)

### How the Teacher Interacts with Students

- **Batch membership:** Teachers are assigned to batches via `batch_teachers` (Migration 003). They can see all students enrolled in those batches via `batch_students`.
- **Student performance:** Teachers can read `performance_reports`, `progress_history` for students in their batches (Migration 021, Section 10).
- **Attendance:** Teachers can read attendance and session_participants for their live classes (Migration 021, Section 6).
- **Doubts:** Teachers can read and reply to student doubts for subjects they specialise in via `teacher_specializations` (Migration 021, Section 16; Migration 014).
- **Feedback:** Teachers receive ratings via `student_feedback_ratings` (target_type = 'teacher').

### How the Teacher Interacts with Mock Tests

- **Full ownership:** Teachers have full CRUD on mock_tests they created (`teacher_id = get_my_teacher_id()`).
- **Question linking:** Teachers manage `mock_test_questions` (which questions go into a test).
- **Results access:** Teachers can read `mock_results` and `mock_attempts` for their tests (Migration 021, Section 7).
- **Answer analysis:** Teachers can read `mock_answers` and `mock_answer_options` for their tests.
- **Approval workflow:** Teachers submit tests for approval via `approval_requests` (resource_type = 'mock_test').

### How the Teacher Interacts with Courses

Note: The schema does **not** have a dedicated `courses` table. Content management is done through the `content` table which stores PDFs, videos, notes, and assignments mapped to chapters. Teachers upload content, set its lifecycle status, and submit for approval.

---

## Section 2: Dashboard Pages

### Page Inventory

| # | Page Name | Purpose | Menu Position | Description | Required APIs | Required Tables | Permissions | Priority |
|---|-----------|---------|---------------|-------------|---------------|----------------|-------------|----------|
| 1 | **Dashboard** | Overview of key metrics at a glance | 1st (Home) | Widgets showing total students, upcoming classes, pending approvals, recent activity | `GET /teacher/dashboard`, `GET /teacher/analytics` | teacher_analytics, live_classes, approval_requests, batch_teachers, batch_students | teacher (SELECT own teacher_analytics, own resources) | CRITICAL |
| 2 | **Live Classes** | Schedule and manage live classes | 2nd | Calendar/grid view of scheduled, live, completed classes | `GET/POST/PATCH/DELETE /teacher/live-classes` | live_classes, live_sessions, live_class_batch, recordings, attendance | teacher (full CRUD on own) | CRITICAL |
| 3 | **Question Bank** | Create and manage all question types | 3rd | CRUD questions with options, explanations, images | `GET/POST/PATCH/DELETE /teacher/questions` | questions, question_options, question_explanations, question_images | teacher (full CRUD on own) | CRITICAL |
| 4 | **Mock Tests** | Create and manage mock tests | 4th | Test configuration, question selection, publishing | `GET/POST/PATCH/DELETE /teacher/mock-tests` | mock_tests, mock_test_questions, approval_requests | teacher (full CRUD on own) | CRITICAL |
| 5 | **Content** | Upload and manage learning materials | 5th | Upload PDFs, videos, notes, assignments; tag and submit for approval | `GET/POST/PATCH/DELETE /teacher/content` | content, tags, content_tag, approval_requests | teacher (full CRUD on own) | CRITICAL |
| 6 | **PYQ Papers** | Manage previous year question papers | 6th | Upload papers, map to questions, manage solutions | `GET/POST/PATCH/DELETE /teacher/pyq-papers` | pyq_packages, pyq_papers, pyq_question_mappings, pyq_solutions, pyq_mock_mappings | teacher (via admin — no teacher RLS; inferred from PYQ domain needing teacher contribution) | HIGH |
| 7 | **Student Results** | View student performance data | 7th | Scores, rankings, subject/chapter analysis per test | `GET /teacher/students/{id}/results` | mock_results, mock_attempts, progress_history, performance_reports | teacher (for students in own batches) | HIGH |
| 8 | **Students** | View and manage students in batches | 8th | Student list with filters, profiles, batch info | `GET /teacher/batches/{id}/students` | batch_students, student_details, profiles | teacher (for own batches) | HIGH |
| 9 | **Attendance** | View and manage live class attendance | 9th | Attendance summary per class, manual override | `GET/PATCH /teacher/attendance` | attendance, session_participants, live_classes | teacher (for own classes) | MEDIUM |
| 10 | **Doubts** | Answer student questions | 10th | Doubt list filtered by subjects teacher specialises in | `GET/POST /teacher/doubts`, `POST /teacher/doubt-replies` | student_doubts, doubt_replies, teacher_specializations | teacher (SELECT for specialisation subjects, INSERT replies) | MEDIUM |
| 11 | **Notifications** | Create and send announcements | 11th | Send notifications to students in own batches | `POST /teacher/notifications` | notifications, notification_recipients | teacher (limited — must use backend service) | MEDIUM |
| 12 | **My Analytics** | View personal teaching analytics | 12th | Charts: students taught, classes conducted, attendance rate, content uploaded | `GET /teacher/analytics/me` | teacher_analytics | teacher (SELECT own) | MEDIUM |
| 13 | **Profile** | Manage personal and professional profile | 13th (Settings) | Edit name, avatar, bio; manage qualifications, experience, availability | `GET/PATCH /teacher/profile`, `GET/POST/PATCH/DELETE /teacher/qualifications`, `GET/POST/PATCH/DELETE /teacher/experience`, `GET/POST/PATCH/DELETE /teacher/availability`, `GET/POST/PATCH/DELETE /teacher/leave-requests` | profiles, teacher_details, teacher_qualifications, teacher_experiences, teacher_availability, teacher_leave_requests | teacher (full access to own) | MEDIUM |

---

## Section 3: Dashboard Widgets

### Widget Inventory (Home Dashboard)

| # | Widget Name | Data Source | Description | RLS Check |
|---|-------------|-------------|-------------|-----------|
| 1 | **Total Students** | `teacher_analytics.total_students` | Unique students in teacher's active batches | `teacher_id = get_my_teacher_id()` |
| 2 | **Upcoming Live Classes** | `live_classes` WHERE `teacher_id = X` AND `status = 'scheduled'` | Next 5 scheduled classes | `teacher_id = get_my_teacher_id()` |
| 3 | **Today's Classes** | `live_classes` WHERE `teacher_id = X` AND `scheduled_at` is today | Classes happening today | `teacher_id = get_my_teacher_id()` |
| 4 | **Pending Approvals** | `approval_requests` WHERE `teacher_id = X` AND `status = 'pending'` | Content and tests awaiting admin approval | `teacher_id = get_my_teacher_id()` |
| 5 | **Tests Created** | `teacher_analytics.tests_created` | Total published mock tests | `teacher_id = get_my_teacher_id()` |
| 6 | **Questions Added** | `teacher_analytics.questions_created` | Total published questions | `teacher_id = get_my_teacher_id()` |
| 7 | **Content Uploaded** | `teacher_analytics.total_content_uploaded` | Total approved content items | `teacher_id = get_my_teacher_id()` |
| 8 | **Avg Attendance Rate** | `teacher_analytics.avg_attendance_rate` | Average attendance percentage across all completed live classes | `teacher_id = get_my_teacher_id()` |
| 9 | **Avg Student Score** | `teacher_analytics.avg_student_score` | Average percentage from progress_history for students in teacher's batches | `teacher_id = get_my_teacher_id()` |
| 10 | **Classes Conducted** | `teacher_analytics.total_classes_conducted` | Total completed live classes | `teacher_id = get_my_teacher_id()` |
| 11 | **Recent Activity** | `live_classes` + `content` + `mock_tests` + `approval_requests` UNION ordered by `updated_at` | Timeline of recent teacher actions | Own resources only |
| 12 | **My Specialty** | `teacher_analytics.top_chapter_id` → `chapters.name` | Chapter with most questions created by teacher | `teacher_id = get_my_teacher_id()` |
| 13 | **Last Class** | `teacher_analytics.last_class_at` | Timestamp of most recently completed live class | `teacher_id = get_my_teacher_id()` |
| 14 | **Leave Balance / Status** | `teacher_leave_requests` WHERE `status = 'pending'` | Pending leave requests overview | `teacher_id = get_my_teacher_id()` |

**Source:** Migration 009 (Domain 08 — Analytics), specifically `teacher_analytics` table

---

## Section 4: Mock Test Management

### Feature Inventory

| # | Feature | Justification | Migration Source |
|---|---------|---------------|-----------------|
| 1 | **Create Mock Test** | `INSERT` on `mock_tests` | Migration 006, Section 1e — `mock_tests` table |
| 2 | **Edit Mock Test** | `UPDATE` on `mock_tests` (while status = draft or pending_approval) | Migration 006, Section 1e |
| 3 | **Delete Mock Test** | `DELETE` on `mock_tests` (while in draft) — RLS allows teacher full access | Migration 021, Section 7e |
| 4 | **Save as Draft** | `mock_tests.status = 'draft'` is the default | Migration 006, Section 0b — `mock_test_status` enum |
| 5 | **Submit for Approval** | INSERT into `approval_requests` with `resource_type = 'mock_test'` | Migration 004, Section 1d; Migration 021, Section 5d |
| 6 | **Publish Test** | Set `status = 'published'` and `published_at = NOW()` | Migration 006, Section 1e |
| 7 | **Archive Test** | Set `status = 'archived'` | Migration 006, Section 0b |
| 8 | **Add Questions to Test** | INSERT/UPDATE on `mock_test_questions` | Migration 006, Section 1f |
| 9 | **Remove Questions from Test** | DELETE on `mock_test_questions` | Migration 006, Section 1f |
| 10 | **Reorder Questions** | UPDATE `order_sequence` on `mock_test_questions` | Migration 006, Section 1f |
| 11 | **Configure Test Settings** | UPDATE `duration_min`, `total_marks`, `passing_marks`, `negative_marking`, `attempt_limit`, `shuffle_questions`, `shuffle_options`, `calculator_allowed` | Migration 006, Section 1e |
| 12 | **Set Availability Window** | UPDATE `available_from` and `available_until` | Migration 006, Section 1e |
| 13 | **Set Result Release Mode** | UPDATE `result_release_mode` (`immediate`, `scheduled`, `manual`) and `result_release_at` | Migration 006, Section 1e |
| 14 | **Preview Test** | SELECT from `mock_test_questions` with `question_snapshot` (JSONB) | Migration 006, Section 1f |
| 15 | **Section Management** | `section_name` column on `mock_test_questions` (e.g., Physics, Chemistry, Biology) | Migration 006, Section 1f |
| 16 | **Per-Question Marks Override** | `marks` and `negative_marks_override` columns on `mock_test_questions` | Migration 006, Section 1f |
| 17 | **Question Randomization** | `shuffle_questions` boolean on `mock_tests` | Migration 006, Section 1e |
| 18 | **Option Randomization** | `shuffle_options` boolean on `mock_tests` | Migration 006, Section 1e |
| 19 | **Test Type Selection** | `test_type` VARCHAR: `practice`, `mock`, `chapter_test`, `pyq_paper` | Migration 006, Section 1e |
| 20 | **Result Release** | Toggle `mock_results.is_released` and set `released_at` | Migration 006, Section 1j |
| 21 | **View Test Analytics** | SELECT from `mock_results` for teacher's tests — aggregate scores, rank, percentile, subject/chapter breakdown | Migration 021, Section 7j |
| 22 | **View Attempt Details** | SELECT from `mock_attempts`, `mock_answers`, `mock_answer_options` for teacher's tests | Migration 021, Section 7g, 7h, 7i |
| 23 | **Question Snapshot (Freeze)** | `question_snapshot` JSONB on `mock_test_questions` populated at publish time | Migration 006, Section 1f |

### Important Note on Batch/Course Assignment

The schema does **not** have a direct `mock_test_batch` or `mock_test_course` junction table. Mock tests are assigned to **streams** (via `stream_id` FK). The schema implies that access is controlled via `available_from`/`available_until` and students enrolled in the associated stream can attempt the test. If batch-level or student-level assignment is required, a new junction table would be needed, or the application layer must enforce this logic.

---

## Section 5: PYQ Management

### Feature Inventory

| # | Feature | Justification | Migration Source |
|---|---------|---------------|-----------------|
| 1 | **Create PYQ Package** | `INSERT` on `pyq_packages` (name, price, year range, description) | Migration 007, Section 1a |
| 2 | **Edit PYQ Package** | `UPDATE` on `pyq_packages` | Migration 007, Section 1a |
| 3 | **Delete PYQ Package** | `UPDATE is_active = false` (soft delete) or hard delete | Migration 007, Section 1a |
| 4 | **Upload Paper PDF** | `UPDATE pdf_storage_bucket`, `pdf_storage_path` on `pyq_papers` | Migration 007, Section 1c |
| 5 | **Upload Solution PDF** | `UPDATE solution_pdf_storage_bucket`, `solution_pdf_storage_path` on `pyq_papers` | Migration 007, Section 1c |
| 6 | **Add Paper to Package** | `INSERT` on `pyq_papers` with `package_id` FK | Migration 007, Section 1c |
| 7 | **Map Question to Paper** | `INSERT` on `pyq_question_mappings` (links `questions` to `pyq_papers`) | Migration 007, Section 1d |
| 8 | **Manage Solution** | `INSERT`/`UPDATE` on `pyq_solutions` (text, video URL, official answer) | Migration 007, Section 1e |
| 9 | **Flag Disputed Question** | `UPDATE is_disputed = true` on `pyq_solutions` with dispute note | Migration 007, Section 1e |
| 10 | **Link to Mock Test** | `INSERT` on `pyq_mock_mappings` (1:1: paper → mock_test) | Migration 007, Section 1f |
| 11 | **Set Exam Metadata** | `exam_year`, `exam_date`, `exam_session`, `total_questions`, `total_marks`, `duration_min` | Migration 007, Section 1c |
| 12 | **Publish/Unpublish Paper** | `UPDATE is_published`, `published_at` | Migration 007, Section 1c |
| 13 | **View PYQ Analytics** | Count of attempts via linked mock_test results | Migration 007, Section 1f + Migration 006 |

### Important Limitation

The current RLS policies (Migration 021, Section 8) restrict full CRUD on PYQ tables to **admins only**. Teachers can read PYQ packages and papers if they are published, but there is **no teacher-level INSERT/UPDATE policy** on `pyq_packages`, `pyq_papers`, `pyq_question_mappings`, or `pyq_solutions`. If teachers need to manage PYQ content, new RLS policies must be added granting teachers `FOR ALL` on these tables.

---

## Section 6: Question Bank

### Feature Inventory

| # | Feature | Justification | Migration Source |
|---|---------|---------------|-----------------|
| 1 | **Create Question** | `INSERT` on `questions` | Migration 006, Section 1a |
| 2 | **Edit Question** | `UPDATE` on `questions` (increments `version`, creates new row if published) | Migration 006, Section 1a |
| 3 | **Delete Question** | `DELETE` on `questions` (only if not used in any submitted attempt — `times_attempted = 0`) | Migration 006, Section 1a |
| 4 | **MCQ Type** | `question_type = 'mcq'` — single correct option | Migration 006, Section 0 |
| 5 | **MSQ Type** | `question_type = 'msq'` — multiple correct options | Migration 006, Section 0 |
| 6 | **Numerical Type** | `question_type = 'numerical'` — answer stored in `question_explanations.correct_numerical_answer` | Migration 006, Section 0 |
| 7 | **True/False Type** | `question_type = 'true_false'` — two options | Migration 006, Section 0 |
| 8 | **Set Difficulty** | `difficulty` enum: `easy`, `medium`, `hard` | Migration 002, Section 1c |
| 9 | **Set Marks** | `marks` NUMERIC(5,2) — default marks | Migration 006, Section 1a |
| 10 | **Set Negative Marks** | `negative_marks` NUMERIC(5,2) — default negative marks | Migration 006, Section 1a |
| 11 | **Add Options** | `INSERT` on `question_options` (MCQ: 4+ options, MSQ: 2+ options) | Migration 006, Section 1b |
| 12 | **Add Explanation** | `INSERT`/`UPDATE` on `question_explanations` (1:1 with question) | Migration 006, Section 1c |
| 13 | **Add Images** | `INSERT` on `question_images` with `image_role` (question, option, explanation) | Migration 006, Section 1d |
| 14 | **Tag by Subject** | `subject_id` FK on `questions` | Migration 006, Section 1a |
| 15 | **Tag by Chapter** | `chapter_id` FK on `questions` | Migration 006, Section 1a |
| 16 | **Question Status Lifecycle** | `draft` → `pending_approval` → `published` → `archived` | Migration 006, Section 0a |
| 17 | **Submit for Approval** | INSERT into `approval_requests` with `resource_type = 'content'` (note: questions use question_status, NOT approval_requests directly — the question_status replaces the polymorphic approval for questions) | Migration 006, Section 0a |
| 18 | **Approve Question** | Set `status = 'published'`, `approved_by`, `approved_at` | Migration 006, Section 1a |
| 19 | **Version History** | `version` integer + `parent_question_id` self-reference for lineage | Migration 006, Section 1a |
| 20 | **Rich Text (LaTeX)** | `question_text` supports Markdown with LaTeX notation | Migration 006, Section 1a |
| 21 | **Average Time Stats** | `average_time_seconds` — computed from actual attempts | Migration 006, Section 1a |
| 22 | **Times Attempted Count** | `times_attempted` — denormalized counter | Migration 006, Section 1a |

**Source:** Migration 006 (Domain 05 — Assessment, Question Bank section)

---

## Section 7: Course Management

### Important Finding

The schema does **not** have a `courses` table. The concept of "courses" is represented through:

1. **Streams** → **Subjects** → **Chapters** → **Topics** (academic hierarchy)
2. **Content** items (PDFs, videos, notes, assignments) mapped to chapters
3. **Batches** (delivery groups) mapped to streams
4. **Live Classes** mapped to subjects/chapters and batches

### What Teachers Can Do

| # | Feature | Justification | Migration Source |
|---|---------|---------------|-----------------|
| 1 | **Upload Content** | `INSERT` on `content` with `content_type` (pdf, video, notes, assignment) | Migration 004, Section 1a |
| 2 | **Edit Content** | `UPDATE` on `content` (version history via `parent_content_id`) | Migration 004, Section 1a |
| 3 | **Delete Content** | `DELETE` on `content` (own content only — RLS enforced) | Migration 021, Section 5a |
| 4 | **Set Content Metadata** | `title`, `description`, `mime_type`, `file_size_bytes`, `page_count`, `duration_seconds` | Migration 004, Section 1a |
| 5 | **Add Tags** | `INSERT` on `tags` + `content_tag` junction | Migration 004, Section 1b, 1c |
| 6 | **Set Free Preview** | `is_free_preview` boolean — accessible without subscription | Migration 004, Section 1a |
| 7 | **Submit for Approval** | INSERT into `approval_requests` with `resource_type = 'content'` | Migration 004, Section 1d |
| 8 | **Track Views/Downloads** | `view_count` and `download_count` (auto-incremented) | Migration 004, Section 1a |
| 9 | **Upload Thumbnail** | `thumbnail_bucket` + `thumbnail_path` | Migration 004, Section 1a |

### What is Missing

- **Pricing / Commerce:** Content pricing is not stored on the `content` table. Commerce is handled through `subscription_plans` and `pyq_packages`. Content is gated by subscription features.
- **Visibility / Publish State:** Content lifecycle is `draft` → `pending_review` → `approved` → `rejected` → `archived` (using `lifecycle_status` enum).
- **Assign to Batch:** Content is assigned to chapters, not batches. Batch-level content assignment would need application-layer filtering.

---

## Section 8: Student Management

### Feature Inventory

| # | Feature | Justification | Migration Source |
|---|---------|---------------|-----------------|
| 1 | **View Students in My Batches** | `batch_students` joined with `student_details` and `profiles` WHERE batch_id IN (teacher's batches from `batch_teachers`) | Migration 003, Section 1f, 1g; Migration 021, Section 4f |
| 2 | **Search Students** | Filter by `profiles.name`, `student_details.enrollment_no`, etc. | Migration 002, Section 3d |
| 3 | **Filter by Batch** | `batch_students.batch_id` filter | Migration 003, Section 1f |
| 4 | **View Student Profile** | SELECT from `profiles` + `student_details` (name, email, phone, avatar, enrollment_no, dob, target_year) | Migration 002 |
| 5 | **View Student Performance** | SELECT from `performance_reports` WHERE student is in teacher's batches | Migration 009; Migration 021, Section 10a |
| 6 | **View Student Subject Analysis** | `subject_performances` for student in teacher's batches | Migration 009, Section 1b |
| 7 | **View Student Chapter Analysis** | `chapter_performances` showing weak/strong chapters | Migration 009, Section 1c |
| 8 | **View Mock Test Results** | `mock_results` + `progress_history` for student in teacher's batches | Migration 006, Section 1j; Migration 009, Section 1d |
| 9 | **View Attendance** | `attendance` for student in teacher's batches → teacher's classes | Migration 005, Section 1f; Migration 021, Section 6f |
| 10 | **View Purchased Courses/PYQ** | `student_pyq_purchases` (teacher can see if admin) | Migration 007, Section 1g |

### What is NOT Available to Teachers (RLS Restricted)

| Feature | Reason |
|---------|--------|
| **Reset Student Progress** | No API/trigger for this exists in the schema |
| **Deactivate Student** | `student_details` and `profiles.is_active` are admin-only via RLS |
| **View Student Subscription** | `student_subscriptions` RLS only allows students (own) and admins |
| **View Orders/Payments** | `orders`, `payments`, `invoices` — admin-only except student's own |
| **Enroll/Unenroll Students** | `batch_students` INSERT/UPDATE/DELETE — only admins have `FOR ALL`; teachers have only SELECT |

**Source:** Migration 021, Sections 4f (batch_students), 7g-j (attempts, answers, results), 10 (analytics)

---

## Section 9: Results

### Feature Inventory

| # | Feature | Justification | Migration Source |
|---|---------|---------------|-----------------|
| 1 | **View Test Results** | SELECT from `mock_results` for teacher's tests | Migration 021, Section 7j |
| 2 | **View Per-Student Result** | `mock_results` filtered by `test_id` + `student_id` | Migration 006, Section 1j |
| 3 | **Export Results (CSV/PDF)** | Schema provides data; export must be built at API layer | N/A |
| 4 | **Class Ranking** | `mock_results.rank` (integer) — rank within institute for that test | Migration 006, Section 1j |
| 5 | **All India Rank (AIR)** | `mock_results.percentile` (numeric) — percentile within institute | Migration 006, Section 1j |
| 6 | **Subject Analysis** | `mock_results.subject_breakdown` — JSONB with per-subject scores | Migration 006, Section 1j |
| 7 | **Chapter Analysis** | `mock_results.chapter_breakdown` — JSONB with per-chapter scores | Migration 006, Section 1j |
| 8 | **Question-Level Analysis** | `mock_answers` per attempt: is_correct, marks_awarded, time_spent | Migration 006, Section 1h |
| 9 | **Weak Areas Identification** | `performance_reports.weak_chapters` — UUID array of weak chapter IDs | Migration 009, Section 1a |
| 10 | **Strong Areas Identification** | `performance_reports.strong_chapters` — UUID array of strong chapter IDs | Migration 009, Section 1a |
| 11 | **Leaderboard** | `mock_results` ordered by `total_score DESC` per test | Migration 006, Section 1j |
| 12 | **Time Analysis** | `mock_results.total_time_seconds`, `avg_time_per_question` | Migration 006, Section 1j |
| 13 | **Score Distribution** | `correct_count`, `wrong_count`, `skipped_count` | Migration 006, Section 1j |
| 14 | **Performance Trend** | `progress_history` — append-only log per attempt per student | Migration 009, Section 1d |

**Source:** Migration 006 (Domain 05 — `mock_results`), Migration 009 (Domain 08 — `performance_reports`, `progress_history`)

---

## Section 10: Live Classes

### Feature Inventory

| # | Feature | Justification | Migration Source |
|---|---------|---------------|-----------------|
| 1 | **Schedule Live Class** | `INSERT` on `live_classes` with teacher_id, subject_id, chapter_id, scheduled_at, duration_min, title | Migration 005, Section 1a |
| 2 | **Edit Scheduled Class** | `UPDATE` on `live_classes` (while in draft or scheduled status) | Migration 005, Section 1a |
| 3 | **Cancel Class** | `UPDATE status = 'cancelled'`, set `cancelled_at`, `cancelled_reason` | Migration 005, Section 1a |
| 4 | **Assign to Batches** | `INSERT` on `live_class_batch` (M:M junction: class → batches) | Migration 005, Section 1c |
| 5 | **Start Class (Go Live)** | `INSERT` on `live_sessions` (1:1 with live_class) when teacher starts | Migration 005, Section 1b |
| 6 | **End Class** | `UPDATE` on `live_sessions`: set `ended_at`, `status = 'ended'` | Migration 005, Section 1b |
| 7 | **View Attendance** | SELECT from `attendance` for own classes | Migration 021, Section 6f |
| 8 | **Mark Attendance Manually** | `UPDATE` on `attendance`: set `is_manual_override = true`, `override_by`, `override_reason` | Migration 005, Section 1f |
| 9 | **View Recording** | SELECT from `recordings` for own classes | Migration 021, Section 6d |
| 10 | **View Live Participants** | SELECT from `session_participants` for own classes | Migration 021, Section 6e |
| 11 | **Class Statistics** | `peak_participants` on `live_sessions`, `duration_seconds` on `recordings` | Migration 005, Section 1b, 1d |
| 12 | **Record Class** | `is_recorded` boolean on `live_classes` | Migration 005, Section 1a |
| 13 | **Set Max Participants** | `max_participants` on `live_classes` | Migration 005, Section 1a |

### Status Lifecycle

`draft` → `scheduled` → `live` → `completed` → `cancelled`

**Source:** Migration 005 (Domain 04 — Live Learning)

---

## Section 11: Notifications

### Feature Inventory

| # | Feature | Justification | Migration Source |
|---|---------|---------------|-----------------|
| 1 | **Create Announcement** | Teachers can create notifications (INSERT) — RLS for notifications is admin-only currently | Migration 021, Section 11b |
| 2 | **Schedule Notification** | `notifications.dispatched_at` — timestamp when fan-out begins | Migration 010, Section 1b |
| 3 | **Target Batch** | No direct batch FK on notifications. `reference_type` + `reference_id` polymorphic pair can store batch_id | Migration 010, Section 1b |
| 4 | **Target Course** | Same polymorphic approach via `reference_type` + `reference_id` | Migration 010, Section 1b |
| 5 | **Target Students** | `notification_recipients` — one row per student per notification | Migration 010, Section 1c |
| 6 | **Event Type** | `event_type` enum: `announcement`, `custom`, `live_class_reminder`, `test_published`, etc. | Migration 010, Section 0a |
| 7 | **Channels** | `notification_channel` enum: `in_app`, `push`, `email`, `sms` | Migration 002, Section 1i |
| 8 | **Template-Based** | `notification_templates` with `{{token}}` placeholders | Migration 010, Section 1a |
| 9 | **Track Read Status** | `notification_recipients.is_read`, `read_at` | Migration 010, Section 1c |
| 10 | **Deep Linking** | `reference_type` + `reference_id` for navigation on tap | Migration 010, Section 1b |

### Important RLS Limitation

Currently (Migration 021, Section 11), `notifications` table has **admin-only INSERT/UPDATE/DELETE**. Only SELECT is available to users (via `notification_recipients`). If teachers need to create/send announcements, new RLS policies must be added, or a backend service must proxy the request using `service_role`.

---

## Section 12: Analytics

### Chart Inventory (Teacher Dashboard)

| # | Chart Name | Data Source | Description |
|---|------------|-------------|-------------|
| 1 | **Student Growth Over Time** | `teacher_analytics.total_students` (snapshot) or aggregate `batch_students` by `enrolled_on` date | Number of students over time |
| 2 | **Average Score Trend** | `progress_history.percentage` averaged per test for students in teacher's batches | Student performance over time |
| 3 | **Class Completion Rate** | `live_classes` GROUP BY status (completed vs scheduled vs cancelled) | Teacher's class delivery rate |
| 4 | **Most Difficult Questions** | `mock_answers.is_correct = false` count per question in teacher's tests | Questions students get wrong most often |
| 5 | **Chapter Performance (Class Avg)** | `chapter_performances.accuracy` averaged across students in teacher's batches | Which chapters students struggle with |
| 6 | **Teacher Activity Timeline** | `live_classes.scheduled_at` + `content.created_at` + `mock_tests.created_at` UNION | Activity calendar/heatmap |
| 7 | **Mock Test Statistics** | Per-test: avg score, avg time, highest score, pass rate | Summary stats per mock test |
| 8 | **Subject-Wise Comparison** | `mock_results.subject_breakdown` JSONB aggregated across all results | Per-subject performance |
| 9 | **Attendance Rate Over Time** | `attendance.is_present` per class per student, aggregated by date/month | Attendance trends |
| 10 | **Top Performing Students** | `mock_results.percentage` DESC per test | Student leaderboard for each test |
| 11 | **Content Upload Summary** | `content` GROUP BY `content_type` (pdf, video, notes, assignment) | Content type distribution |
| 12 | **Question Bank Composition** | `questions` GROUP BY `question_type`, `difficulty` | Question type and difficulty distribution |

**Source:** Migration 009 (Domain 08 — Analytics), Migration 006 (Domain 05 — Assessment)

---

## Section 13: Profile

### Feature Inventory

| # | Feature | Justification | Migration Source |
|---|---------|---------------|-----------------|
| 1 | **Edit Name** | `UPDATE` on `profiles.name` | Migration 002, Section 3b |
| 2 | **Edit Email** | `UPDATE` on `profiles.email` | Migration 002, Section 3b |
| 3 | **Edit Phone** | `UPDATE` on `profiles.phone` (E.164 format) | Migration 024, 025 |
| 4 | **Upload Avatar** | Storage bucket `profile-images` — teacher can upload to own folder | Migration 022, Section 2a |
| 5 | **Edit Bio** | `UPDATE` on `teacher_details.bio` | Migration 002, Section 3c |
| 6 | **Edit Specialization** | `UPDATE` on `teacher_details.specialization` | Migration 002, Section 3c |
| 7 | **Edit Qualification** | `UPDATE` on `teacher_details.qualification` | Migration 002, Section 3c |
| 8 | **Add/Edit Qualifications** | CRUD on `teacher_qualifications` (degree_name, institution, field_of_study, year_completed) | Migration 014, Section 2c |
| 9 | **Add/Edit Experience** | CRUD on `teacher_experiences` (institution_name, role, subject_taught, start_date, end_date) | Migration 014, Section 2d |
| 10 | **Upload Documents** | CRUD on `teacher_documents` + Storage bucket `teacher-documents` | Migration 014, Section 2e; Migration 022, Section 2b |
| 11 | **Manage Availability** | CRUD on `teacher_availability` (day_of_week, start_time, end_time) | Migration 014, Section 2g |
| 12 | **Request Leave** | CRUD on `teacher_leave_requests` (category, start_date, end_date, reason) | Migration 014, Section 2h |
| 13 | **Change Password** | Handled by Supabase Auth, not profiles table | N/A |
| 14 | **View Rating** | `teacher_details.rating` | Migration 002, Section 3c |

---

## Section 14: Permissions Matrix

### Teacher Permissions by Page

| Page | View | Create | Edit | Delete | Publish | Assign | Export | Approve |
|------|------|--------|------|--------|---------|--------|--------|---------|
| Dashboard | ✅ | - | - | - | - | - | - | - |
| Live Classes | ✅ Own | ✅ | ✅ Own | ✅ Own (draft) | ✅ (mark live/complete) | ✅ (batch) | - | - |
| Question Bank | ✅ Own | ✅ | ✅ Own | ✅ Own (unused) | ✅ (submit for approval) | - | - | ❌ (admin) |
| Mock Tests | ✅ Own | ✅ | ✅ Own | ✅ Own (draft) | ✅ (publish) | ❌ (no batch FK) | - | ❌ (admin) |
| Content | ✅ Own | ✅ | ✅ Own | ✅ Own | ✅ (submit for approval) | - | - | ❌ (admin) |
| PYQ Papers | ✅ (read) | ❌ (admin) | ❌ (admin) | ❌ (admin) | ❌ (admin) | - | - | ❌ (admin) |
| Students | ✅ (own batches) | - | - | - | - | ❌ (admin) | - | - |
| Results | ✅ (own tests) | - | - | - | - | - | ✅ (API) | - |
| Attendance | ✅ (own classes) | - | ✅ (manual override) | - | - | - | - | - |
| Doubts | ✅ (specialised subjects) | ✅ (replies) | - | - | - | - | - | - |
| Notifications | ✅ (own) | ❌ (admin) | - | - | - | ❌ (admin) | - | - |
| My Analytics | ✅ Own | - | - | - | - | - | - | - |
| Profile | ✅ Own | ✅ (qualifications, experience, availability, leave) | ✅ Own | ✅ Own | - | - | - | - |
| Employment Records | ❌ (admin) | ❌ (admin) | ❌ (admin) | ❌ (admin) | - | - | - | - |
| Bank Details | ❌ (admin) | ❌ (admin) | ❌ (admin) | ❌ (admin) | - | - | - | - |

**Source:** Migration 021 (RLS Policies) — comprehensive role-based access control

---

## Section 15: APIs Needed

### API Endpoints Required for Teacher Dashboard

#### Dashboard
| Method | Endpoint | Description | Tables |
|--------|----------|-------------|--------|
| GET | `/teacher/dashboard` | Aggregate dashboard widgets data | teacher_analytics, live_classes, approval_requests |
| GET | `/teacher/analytics/me` | Personal teacher analytics | teacher_analytics |

#### Live Classes
| Method | Endpoint | Description | Tables |
|--------|----------|-------------|--------|
| GET | `/teacher/live-classes` | List teacher's live classes | live_classes |
| POST | `/teacher/live-classes` | Create a new live class | live_classes |
| GET | `/teacher/live-classes/{id}` | Get a single live class | live_classes |
| PATCH | `/teacher/live-classes/{id}` | Update a live class | live_classes |
| DELETE | `/teacher/live-classes/{id}` | Delete a draft live class | live_classes |
| PATCH | `/teacher/live-classes/{id}/cancel` | Cancel a live class | live_classes |
| POST | `/teacher/live-classes/{id}/batches` | Assign batches to a class | live_class_batch |
| DELETE | `/teacher/live-classes/{id}/batches/{batchId}` | Remove batch assignment | live_class_batch |
| GET | `/teacher/live-classes/{id}/attendance` | Get attendance for a class | attendance |
| PATCH | `/teacher/attendance/{id}` | Manual attendance override | attendance |
| GET | `/teacher/live-classes/{id}/recordings` | Get recordings for a class | recordings |

#### Question Bank
| Method | Endpoint | Description | Tables |
|--------|----------|-------------|--------|
| GET | `/teacher/questions` | List teacher's questions | questions, question_options, question_explanations, question_images |
| POST | `/teacher/questions` | Create a new question | questions |
| GET | `/teacher/questions/{id}` | Get question with options, explanation, images | questions + children |
| PATCH | `/teacher/questions/{id}` | Update question | questions |
| DELETE | `/teacher/questions/{id}` | Delete question (if unused) | questions |
| POST | `/teacher/questions/{id}/options` | Add option | question_options |
| PATCH | `/teacher/questions/{id}/options/{optionId}` | Update option | question_options |
| DELETE | `/teacher/questions/{id}/options/{optionId}` | Delete option | question_options |
| PATCH | `/teacher/questions/{id}/explanation` | Update explanation | question_explanations |
| POST | `/teacher/questions/{id}/images` | Add image | question_images |
| DELETE | `/teacher/questions/{id}/images/{imageId}` | Delete image | question_images |
| PATCH | `/teacher/questions/{id}/submit` | Submit for approval | questions (status → pending_approval) |
| GET | `/teacher/questions/analytics` | Question stats (times_attempted, avg_time) | questions |

#### Mock Tests
| Method | Endpoint | Description | Tables |
|--------|----------|-------------|--------|
| GET | `/teacher/mock-tests` | List teacher's mock tests | mock_tests |
| POST | `/teacher/mock-tests` | Create a new mock test | mock_tests |
| GET | `/teacher/mock-tests/{id}` | Get mock test with questions | mock_tests, mock_test_questions |
| PATCH | `/teacher/mock-tests/{id}` | Update mock test config | mock_tests |
| DELETE | `/teacher/mock-tests/{id}` | Delete draft mock test | mock_tests |
| POST | `/teacher/mock-tests/{id}/questions` | Add question to test | mock_test_questions |
| DELETE | `/teacher/mock-tests/{id}/questions/{questionId}` | Remove question from test | mock_test_questions |
| PATCH | `/teacher/mock-tests/{id}/questions/reorder` | Reorder questions | mock_test_questions |
| PATCH | `/teacher/mock-tests/{id}/publish` | Publish mock test | mock_tests |
| PATCH | `/teacher/mock-tests/{id}/archive` | Archive mock test | mock_tests |
| POST | `/teacher/mock-tests/{id}/submit-for-approval` | Submit for approval | approval_requests |
| GET | `/teacher/mock-tests/{id}/results` | Get all results for a test | mock_results, mock_attempts |
| GET | `/teacher/mock-tests/{id}/results/{studentId}` | Get student's result for test | mock_results, mock_answers |

#### Content
| Method | Endpoint | Description | Tables |
|--------|----------|-------------|--------|
| GET | `/teacher/content` | List teacher's content | content |
| POST | `/teacher/content` | Create content record | content |
| GET | `/teacher/content/{id}` | Get content details | content |
| PATCH | `/teacher/content/{id}` | Update content | content |
| DELETE | `/teacher/content/{id}` | Delete content | content |
| POST | `/teacher/content/{id}/tags` | Add tags | content_tag |
| DELETE | `/teacher/content/{id}/tags/{tagId}` | Remove tag | content_tag |
| PATCH | `/teacher/content/{id}/submit` | Submit for approval | approval_requests |
| POST | `/teacher/content/upload-url` | Get signed upload URL | Storage |

#### PYQ Papers
| Method | Endpoint | Description | Tables |
|--------|----------|-------------|--------|
| GET | `/teacher/pyq-packages` | List PYQ packages | pyq_packages |
| GET | `/teacher/pyq-packages/{id}/papers` | List papers in a package | pyq_papers |
| GET | `/teacher/pyq-papers/{id}` | Get paper details | pyq_papers |

#### Students
| Method | Endpoint | Description | Tables |
|--------|----------|-------------|--------|
| GET | `/teacher/batches` | List teacher's assigned batches | batch_teachers, batches |
| GET | `/teacher/batches/{id}/students` | List students in batch | batch_students, student_details, profiles |
| GET | `/teacher/students/{id}` | Get student profile | student_details, profiles |
| GET | `/teacher/students/{id}/performance` | Student performance reports | performance_reports |
| GET | `/teacher/students/{id}/progress` | Student progress history | progress_history |
| GET | `/teacher/students/{id}/results` | Student mock test results | mock_results |
| GET | `/teacher/students/{id}/attendance` | Student attendance | attendance |

#### Doubts
| Method | Endpoint | Description | Tables |
|--------|----------|-------------|--------|
| GET | `/teacher/doubts` | List doubts for teacher's subjects | student_doubts |
| GET | `/teacher/doubts/{id}` | Get doubt with replies | student_doubts, doubt_replies |
| POST | `/teacher/doubts/{id}/replies` | Reply to a doubt | doubt_replies |
| PATCH | `/teacher/doubts/{id}/replies/{replyId}/accept` | Mark as accepted answer | doubt_replies |

#### Notifications
| Method | Endpoint | Description | Tables |
|--------|----------|-------------|--------|
| GET | `/teacher/notifications` | Get teacher's notifications | notifications, notification_recipients |
| PATCH | `/teacher/notifications/{id}/read` | Mark notification as read | notification_recipients |

#### Profile
| Method | Endpoint | Description | Tables |
|--------|----------|-------------|--------|
| GET | `/teacher/profile` | Get teacher's full profile | profiles, teacher_details |
| PATCH | `/teacher/profile` | Update profile | profiles, teacher_details |
| GET | `/teacher/qualifications` | List qualifications | teacher_qualifications |
| POST | `/teacher/qualifications` | Add qualification | teacher_qualifications |
| PATCH | `/teacher/qualifications/{id}` | Update qualification | teacher_qualifications |
| DELETE | `/teacher/qualifications/{id}` | Delete qualification | teacher_qualifications |
| GET | `/teacher/experiences` | List work experience | teacher_experiences |
| POST | `/teacher/experiences` | Add experience | teacher_experiences |
| PATCH | `/teacher/experiences/{id}` | Update experience | teacher_experiences |
| DELETE | `/teacher/experiences/{id}` | Delete experience | teacher_experiences |
| GET | `/teacher/availability` | Get weekly availability | teacher_availability |
| POST | `/teacher/availability` | Add availability slot | teacher_availability |
| DELETE | `/teacher/availability/{id}` | Remove availability slot | teacher_availability |
| GET | `/teacher/leave-requests` | List leave requests | teacher_leave_requests |
| POST | `/teacher/leave-requests` | Create leave request | teacher_leave_requests |
| PATCH | `/teacher/leave-requests/{id}` | Update leave request | teacher_leave_requests |
| DELETE | `/teacher/leave-requests/{id}` | Cancel leave request | teacher_leave_requests |

---

## Section 16: Recommended Folder Structure

```
src/
├── features/
│   ├── dashboard/
│   │   ├── pages/
│   │   │   └── TeacherDashboardPage.tsx
│   │   ├── components/
│   │   │   ├── DashboardWidget.tsx
│   │   │   ├── StatCard.tsx
│   │   │   ├── RecentActivity.tsx
│   │   │   └── PendingApprovals.tsx
│   │   ├── hooks/
│   │   │   └── useTeacherDashboard.ts
│   │   └── services/
│   │       └── dashboardService.ts
│   │
│   ├── live-classes/
│   │   ├── pages/
│   │   │   ├── LiveClassesListPage.tsx
│   │   │   ├── LiveClassDetailPage.tsx
│   │   │   └── LiveClassFormPage.tsx
│   │   ├── components/
│   │   │   ├── ClassCard.tsx
│   │   │   ├── ClassForm.tsx
│   │   │   ├── AttendanceTable.tsx
│   │   │   ├── RecordingList.tsx
│   │   │   └── CalendarView.tsx
│   │   ├── hooks/
│   │   │   └── useLiveClasses.ts
│   │   └── services/
│   │       └── liveClassService.ts
│   │
│   ├── question-bank/
│   │   ├── pages/
│   │   │   ├── QuestionListPage.tsx
│   │   │   ├── QuestionCreatePage.tsx
│   │   │   └── QuestionEditPage.tsx
│   │   ├── components/
│   │   │   ├── QuestionCard.tsx
│   │   │   ├── QuestionForm.tsx
│   │   │   ├── OptionEditor.tsx
│   │   │   ├── ExplanationEditor.tsx
│   │   │   ├── ImageUploader.tsx
│   │   │   └── QuestionPreview.tsx
│   │   ├── hooks/
│   │   │   └── useQuestions.ts
│   │   └── services/
│   │       └── questionService.ts
│   │
│   ├── mock-tests/
│   │   ├── pages/
│   │   │   ├── MockTestListPage.tsx
│   │   │   ├── MockTestCreatePage.tsx
│   │   │   ├── MockTestEditPage.tsx
│   │   │   ├── MockTestResultsPage.tsx
│   │   │   └── MockTestQuestionSelectionPage.tsx
│   │   ├── components/
│   │   │   ├── MockTestCard.tsx
│   │   │   ├── MockTestForm.tsx
│   │   │   ├── QuestionSelector.tsx
│   │   │   ├── SectionEditor.tsx
│   │   │   └── ResultTable.tsx
│   │   ├── hooks/
│   │   │   └── useMockTests.ts
│   │   └── services/
│   │       └── mockTestService.ts
│   │
│   ├── content/
│   │   ├── pages/
│   │   │   ├── ContentListPage.tsx
│   │   │   └── ContentUploadPage.tsx
│   │   ├── components/
│   │   │   ├── ContentCard.tsx
│   │   │   ├── ContentUploader.tsx
│   │   │   └── TagSelector.tsx
│   │   ├── hooks/
│   │   │   └── useContent.ts
│   │   └── services/
│   │       └── contentService.ts
│   │
│   ├── students/
│   │   ├── pages/
│   │   │   ├── StudentListPage.tsx
│   │   │   └── StudentDetailPage.tsx
│   │   ├── components/
│   │   │   ├── StudentTable.tsx
│   │   │   ├── StudentProfile.tsx
│   │   │   └── PerformanceChart.tsx
│   │   ├── hooks/
│   │   │   └── useStudents.ts
│   │   └── services/
│   │       └── studentService.ts
│   │
│   ├── doubts/
│   │   ├── pages/
│   │   │   ├── DoubtListPage.tsx
│   │   │   └── DoubtDetailPage.tsx
│   │   ├── components/
│   │   │   ├── DoubtCard.tsx
│   │   │   ├── ReplyEditor.tsx
│   │   │   └── DoubtThread.tsx
│   │   ├── hooks/
│   │   │   └── useDoubts.ts
│   │   └── services/
│   │       └── doubtService.ts
│   │
│   ├── pyq/
│   │   ├── pages/
│   │   │   └── PYQListPage.tsx
│   │   ├── components/
│   │   │   └── PaperCard.tsx
│   │   └── services/
│   │       └── pyqService.ts
│   │
│   ├── analytics/
│   │   ├── pages/
│   │   │   └── TeacherAnalyticsPage.tsx
│   │   ├── components/
│   │   │   ├── StatCard.tsx
│   │   │   ├── ScoreChart.tsx
│   │   │   ├── AttendanceChart.tsx
│   │   │   └── SubjectBreakdownChart.tsx
│   │   ├── hooks/
│   │   │   └── useTeacherAnalytics.ts
│   │   └── services/
│   │       └── analyticsService.ts
│   │
│   └── profile/
│       ├── pages/
│       │   ├── TeacherProfilePage.tsx
│       │   ├── QualificationsPage.tsx
│       │   ├── ExperiencePage.tsx
│       │   ├── AvailabilityPage.tsx
│       │   └── LeaveRequestsPage.tsx
│       ├── components/
│       │   ├── ProfileForm.tsx
│       │   ├── QualificationForm.tsx
│       │   ├── ExperienceForm.tsx
│       │   ├── AvailabilityGrid.tsx
│       │   └── LeaveRequestForm.tsx
│       ├── hooks/
│       │   ├── useProfile.ts
│       │   ├── useQualifications.ts
│       │   ├── useExperiences.ts
│       │   ├── useAvailability.ts
│       │   └── useLeaveRequests.ts
│       └── services/
│           ├── profileService.ts
│           ├── qualificationService.ts
│           ├── experienceService.ts
│           ├── availabilityService.ts
│           └── leaveRequestService.ts
│
├── shared/
│   ├── components/
│   │   ├── AnimatedPressable.tsx
│   │   ├── SkeletonLoader.tsx
│   │   ├── Toast.tsx
│   │   ├── DataTable.tsx
│   │   ├── SearchBar.tsx
│   │   ├── FilterPanel.tsx
│   │   ├── Pagination.tsx
│   │   ├── ConfirmDialog.tsx
│   │   ├── EmptyState.tsx
│   │   ├── ErrorBoundary.tsx
│   │   └── LoadingSpinner.tsx
│   ├── hooks/
│   │   ├── useDebounce.ts
│   │   ├── usePagination.ts
│   │   └── useMediaUpload.ts
│   ├── services/
│   │   ├── apiClient.ts
│   │   └── supabaseClient.ts
│   ├── types/
│   │   ├── teacher.ts
│   │   ├── liveClass.ts
│   │   ├── question.ts
│   │   ├── mockTest.ts
│   │   ├── content.ts
│   │   ├── student.ts
│   │   ├── doubt.ts
│   │   ├── pyq.ts
│   │   ├── analytics.ts
│   │   └── notification.ts
│   └── utils/
│       ├── formatters.ts
│       ├── validators.ts
│       └── constants.ts
│
├── store/
│   ├── teacherSlice.ts
│   └── hooks.ts
│
└── navigation/
    └── TeacherTabNavigator.tsx
```

---

## Section 17: Development Priority

### Priority Rankings

| Rank | Module | Priority | Rationale |
|------|--------|----------|-----------|
| 1 | **Dashboard** | CRITICAL | The landing page after login. Without it, teachers cannot see any metrics. All other modules depend on navigation from here. |
| 2 | **Live Classes** | CRITICAL | Core daily workflow — teachers need to schedule, start, and manage live classes every day. Highest frequency of use. |
| 3 | **Question Bank** | CRITICAL | Prerequisite for Mock Tests. Questions must exist before tests can be created. Also the building block for the entire assessment system. |
| 4 | **Mock Tests** | CRITICAL | Core product offering. Teachers create tests for students. Requires Question Bank to be built first. |
| 5 | **Students** | CRITICAL | Teachers need to see their students from day one. Drives all other student-facing features (results, attendance, performance). |
| 6 | **Content** | HIGH | Teachers upload PDFs, videos, notes. Important but less time-sensitive than live classes. |
| 7 | **Results** | HIGH | Required immediately after first mock test is published. Teachers must see student performance. |
| 8 | **Profile** | HIGH | Teachers need to set up their profile, qualifications, and availability before they can teach. |
| 9 | **Attendance** | MEDIUM | Needed after live classes start. Can be built in parallel with Results. |
| 10 | **PYQ Papers** | MEDIUM | Important for exam preparation but admin-dependent. RLS currently blocks teacher CRUD — requires schema update. |
| 11 | **Doubts** | MEDIUM | Student Q&A feature. Important for engagement but not a blocking dependency for other features. |
| 12 | **Analytics** | MEDIUM | Teacher analytics page uses `teacher_analytics` which is populated by nightly jobs. Dashboard widgets cover immediate needs. |
| 13 | **Notifications** | LOW | Teachers can see their own notifications. Sending notifications requires RLS updates and backend service. |

---

## Section 18: Missing Features & Recommendations

### Features NOT Supported by Current Schema

| # | Missing Feature | Why It's Missing | Recommendation |
|---|-----------------|------------------|----------------|
| 1 | **Teacher CRUD on PYQ** | No RLS policies for teacher INSERT/UPDATE/DELETE on `pyq_packages`, `pyq_papers`, `pyq_question_mappings`, `pyq_solutions` | Add RLS policies in a future migration: `teacher_id = get_my_teacher_id()` or `created_by` column |
| 2 | **Batch Assignment for Mock Tests** | No junction table linking `mock_tests` to `batches` | Create `mock_test_batches` table: `(test_id, batch_id, assigned_at, assigned_by)` |
| 3 | **Student-Level Test Assignment** | No table for individually assigning tests to specific students | Create `student_test_assignments` table OR use existing `batch_students` with app-level logic |
| 4 | **Teacher-Initiated Notifications** | RLS restricts notifications INSERT to admins only | Either add teacher INSERT policy on `notifications` or create a backend Edge Function |
| 5 | **Question Approval by Admins** | `questions.status` uses `question_status` enum (draft/pending_approval/published/archived) but no dedicated `approval_requests` for questions — the status field handles it directly. This means there's no audit trail for question approval/rejection. | Add `approval_requests` with `resource_type = 'question'` or extend the existing approval workflow |
| 6 | **Bulk Question Import** | No table or function for bulk importing questions | Build an import service that reads CSV/Excel and creates questions via API |
| 7 | **Course Entity** | No `courses` table | If needed, create a `courses` table with modules, pricing, thumbnail, and teacher assignments |
| 8 | **Teacher Revenue/Commission Tracking** | `teacher_employment_records` stores base_salary and revenue_share_percent but no actual payout ledger | Create `teacher_payouts` or `commission_records` table |
| 9 | **Teacher Dashboard Customization** | No table for widget preferences, layout configuration | Add `teacher_dashboard_preferences` table (JSONB config) |
| 10 | **Student-Personalized Content Recommendations** | `performance_reports.suggested_tests` exists for students, but no teacher-facing recommendation engine | Build an Edge Function that suggests content/mock_tests to students based on weak areas |
| 11 | **Export Functionality** | No dedicated export tables or functions | Build export service at API layer for results, attendance, student lists |
| 12 | **Content Version History (Teacher-facing)** | `parent_content_id` supports version lineage but no UI for comparing versions | Build version comparison UI using recursive CTE queries |
| 13 | **Teacher Activity Log** | `audit_logs` is admin-only. Teachers cannot see their own activity history | Either relax RLS on `audit_logs` for teachers (SELECT own) or build a dedicated `teacher_activity_log` |
| 14 | **Offline Content Delivery Tracking** | `student_downloads` exists but no teacher view of how many students downloaded their content | Build a teacher-facing analytics query: COUNT downloads WHERE resource is teacher's content |
| 15 | **Email/SMS Notification Sending** | Schema has `notification_channel` enum (email, sms) but no SMTP/SMS gateway integration | Integrate with external email/SMS provider and build dispatch service |

### Recommended New Tables

| Table Name | Purpose | Suggested Columns |
|------------|---------|-------------------|
| `mock_test_batches` | Assign mock tests to specific batches | `test_id`, `batch_id`, `assigned_at`, `assigned_by` |
| `teacher_payouts` | Track commission/salary payments | `payout_id`, `teacher_id`, `amount`, `period_start`, `period_end`, `status`, `paid_at` |
| `teacher_dashboard_preferences` | Dashboard widget config | `preference_id`, `teacher_id`, `widget_config` (JSONB) |
| `question_approval_requests` | Dedicated question approval workflow | `approval_id`, `question_id`, `requested_by`, `reviewed_by`, `status`, `remarks` |

### Recommended New RLS Policies

| Policy | Table | Purpose |
|--------|-------|---------|
| `Teachers have full access to PYQ packages` | `pyq_packages` | Allow teachers to create/manage PYQ packages |
| `Teachers have full access to PYQ papers` | `pyq_papers` | Allow teachers to create/manage PYQ papers |
| `Teachers have full access to PYQ question mappings` | `pyq_question_mappings` | Allow teachers to map questions to papers |
| `Teachers have full access to PYQ solutions` | `pyq_solutions` | Allow teachers to create/manage solutions |
| `Teachers can create notifications` | `notifications` | Allow teachers to send announcements to students |

---

## Appendix A: Key Schema Relationships (Teacher-Facing)

```
profiles (role = 'teacher')
    │
    ├── teacher_details (1:1)
    │       ├── teacher_qualifications (1:M)
    │       ├── teacher_experiences (1:M)
    │       ├── teacher_documents (1:M)
    │       ├── teacher_availability (1:M)
    │       ├── teacher_leave_requests (1:M)
    │       ├── teacher_analytics (1:1)
    │       └── batch_teachers (M:M → batches)
    │               └── batch_students (M:M → students)
    │
    ├── content (1:M — own uploads)
    ├── questions (1:M — created_by = teacher_id)
    │       ├── question_options (1:M)
    │       ├── question_explanations (1:1)
    │       └── question_images (1:M)
    ├── mock_tests (1:M — own tests)
    │       └── mock_test_questions (M:M → questions)
    │               ├── mock_attempts (1:M)
    │               │       ├── mock_answers (1:M)
    │               │       │       └── mock_answer_options (M:M → options)
    │               │       └── mock_results (1:1)
    │               └── approval_requests (polymorphic)
    ├── live_classes (1:M — own classes)
    │       ├── live_sessions (1:1)
    │       ├── live_class_batch (M:M → batches)
    │       ├── recordings (1:M)
    │       ├── session_participants (1:M → students)
    │       └── attendance (1:M → students)
    └── approval_requests (1:M — own submissions)
            └── resource: content | mock_test (polymorphic)
```

---

## Appendix B: Enum Values Reference

| Enum Name | Values | Used In |
|-----------|--------|---------|
| `user_role` | admin, teacher, student | profiles |
| `question_type` | mcq, msq, numerical, true_false | questions |
| `difficulty_level` | easy, medium, hard | questions |
| `question_status` | draft, pending_approval, published, archived | questions |
| `mock_test_status` | draft, pending_approval, published, archived | mock_tests |
| `attempt_status` | in_progress, submitted, abandoned, timed_out | mock_attempts |
| `live_class_status` | draft, scheduled, live, completed, cancelled | live_classes |
| `live_session_status` | waiting, live, ended | live_sessions |
| `lifecycle_status` | draft, pending_review, approved, rejected, archived | content |
| `approval_resource_type` | content, mock_test | approval_requests |
| `approval_status` | pending, approved, rejected | approval_requests |
| `notification_channel` | in_app, push, email, sms | notifications |
| `notification_event_type` | live_class_reminder, test_published, result_available, content_approved, content_rejected, subscription_expiring, subscription_expired, new_content_uploaded, batch_assigned, announcement, custom | notifications |
| `batch_status` | upcoming, active, completed, archived | batches |
| `employment_type` | full_time, part_time, contract, freelance | teacher_employment_records |
| `salary_basis_type` | monthly_fixed, hourly_rate, revenue_share, per_class | teacher_employment_records |
| `leave_category_type` | casual, sick, unpaid, maternity_paternity, compensatory | teacher_leave_requests |
| `leave_status_type` | pending, approved, rejected, cancelled | teacher_leave_requests |
| `doubt_status_type` | open, in_progress, resolved, archived | student_doubts |
| `report_period_type` | weekly, monthly, all_time | performance_reports |
| `content_type` | pdf, video, notes, assignment | content |
| `image_role` | question, option, explanation | question_images |

---

**End of Teacher Dashboard Functional Specification**
