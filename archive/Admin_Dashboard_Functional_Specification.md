# Admin Dashboard — Functional Specification

> **Derived from Supabase Migrations 001–025**
> **Prepared for:** Frontend Development Team
> **Generated:** July 6, 2026
> **Scope:** Complete analysis of all tables, enums, views, functions, triggers, constraints, RLS policies, foreign keys, storage buckets, edge functions, relationships, and business logic across all 15 Domains + global migrations

**Document Version:** 1.0
**Author:** Senior Software Architect
**Status:** Final

---

## Section 1: Admin Dashboard Overview

### 1.1 Who is the Admin

The Admin is an authenticated user whose `profiles.role = 'admin'` (Migration 002, Section 3b — `profiles` table, `user_role` enum). The system recognises two kinds of admins:

1. **Platform Admin** (`admin@demo.com` in seed data, Migration 023) — Has access across all institutes, manages system-level configurations.
2. **Institute Admin** (`institute@demo.com` in seed data, Migration 023) — Has full access within their own institute's scope, managed via `get_my_institute_id()` RLS enforcement (Migration 021, Section 2a).

**Source:** Migration 002 (Domain 01 — Foundation), Migration 021 (RLS Policies), Migration 023 (Seed Data)

### 1.2 What the Admin Controls

Based on the schema, the Admin has **full CRUD (`FOR ALL`)** on every table within their institute scope. The following domains are fully controlled by the Admin:

| Domain | Tables Admin Controls |
|--------|----------------------|
| **Foundation** (Domain 01) | `institutes`, `profiles`, `teacher_details`, `student_details` |
| **Academic Structure** (Domain 02) | `streams`, `subjects`, `chapters`, `topics`, `batches`, `batch_students`, `batch_teachers` |
| **Content Management** (Domain 03) | `content`, `tags`, `content_tag`, `approval_requests` |
| **Live Learning** (Domain 04) | `live_classes`, `live_sessions`, `live_class_batch`, `recordings`, `session_participants`, `attendance`, `attendance_events` |
| **Assessment** (Domain 05) | `questions`, `question_options`, `question_explanations`, `question_images`, `mock_tests`, `mock_test_questions`, `mock_attempts`, `mock_answers`, `mock_answer_options`, `mock_results` |
| **PYQ** (Domain 06) | `pyq_packages`, `pyq_package_unlocks`, `pyq_papers`, `pyq_question_mappings`, `pyq_solutions`, `pyq_mock_mappings`, `student_pyq_purchases` |
| **Commerce** (Domain 07) | `orders`, `order_items`, `payments`, `invoices` |
| **Analytics** (Domain 08) | `performance_reports`, `subject_performances`, `chapter_performances`, `progress_history`, `teacher_analytics` |
| **Notifications** (Domain 09) | `notification_templates`, `notifications`, `notification_recipients` |
| **Administration** (Domain 10) | `audit_logs`, `system_settings` |
| **Subscription & Access Control** (Domain 11) | `subscription_features`, `subscription_plans`, `plan_unlocks`, `student_subscriptions`, `subscription_history`, `subscription_renewals`, `subscription_cancellations`, `subscription_grace_periods`, `subscription_usage` |
| **File & Media Management** (Domain 12) | `media_files`, `media_versions`, `media_usage`, `media_processing_jobs` |
| **Teacher Management (HR)** (Domain 13) | `teacher_employment_records`, `teacher_specializations`, `teacher_qualifications`, `teacher_experiences`, `teacher_documents`, `teacher_bank_details`, `teacher_availability`, `teacher_leave_requests` |
| **Student Services** (Domain 14) | `student_bookmarks`, `student_downloads`, `student_viewing_history`, `student_personal_notes`, `student_doubts`, `doubt_replies`, `support_tickets`, `support_ticket_messages`, `student_feedback_ratings` |
| **Infrastructure** (Domain 15) | `api_keys`, `webhook_endpoints`, `webhook_delivery_logs`, `async_jobs`, `feature_flags`, `feature_flag_overrides`, `system_events_outbox` |

**Source:** Migration 021 (RLS Policies) — every table has an "Admins have full access" policy

### 1.3 What Admin Can Create

- **Institutes** (Migration 002, Section 3a — `institutes` table with `plan_tier` enum: `starter`, `growth`, `enterprise`)
- **Profiles** for teachers and students (Migration 002, Section 3b — `profiles` table)
- **Teacher records** including `teacher_details`, `teacher_employment_records`, `teacher_specializations` (Migration 014, Domain 13)
- **Student records** including `student_details` (Migration 002, Section 3d)
- **Academic hierarchy**: Streams, Subjects, Chapters, Topics (Migration 003, Domain 02)
- **Batches** with teacher assignments and student enrollment (Migration 003, Sections 1e-1g)
- **Content** and tags (Migration 004, Domain 03)
- **Questions** of all types: MCQ, MSQ, Numerical, True/False (Migration 006, Section 1a)
- **Mock Tests** with question mappings (Migration 006, Sections 1e-1f)
- **PYQ Packages** and papers (Migration 007, Domain 06)
- **Subscription Plans** with feature unlocks (Migration 012, Domain 11)
- **Notification Templates** (Migration 010, Domain 09)
- **System Settings** (Migration 011, Domain 10)
- **API Keys** for programmatic access (Migration 016, Domain 15)
- **Webhook Endpoints** (Migration 016, Domain 15)
- **Feature Flags** and overrides (Migration 016, Domain 15)
- **Coupons / Discounts** (via `orders.coupon_code` — Migration 008, Section 1a)
- **Invoice generation** (via `invoices` — Migration 008, Section 1d)

### 1.4 What Admin Can Update

- **Institute profile**: name, slug, domain, logo_url, plan_tier, is_active (Migration 002, Section 3a)
- **Any profile**: name, email, phone, avatar_url, role, is_active (Migration 002, Section 3b)
- **Teacher HR data**: employment records, salary, bank details, documents verification status (Migration 014, Domain 13)
- **Academic structure**: stream/subject/chapter/topic names, display_order, is_active (Migration 003, Domain 02)
- **Batch details**: name, status, dates, max_seats, teacher assignments, student enrollment status (Migration 003, Sections 1e-1g)
- **Content**: lifecycle status, approval decisions, metadata (Migration 004, Domain 03)
- **Questions**: status (approve/reject), difficulty, marks, negative marks (Migration 006, Section 1a)
- **Mock Tests**: status (publish/archive), configuration, result release (Migration 006, Section 1e)
- **PYQ Packages**: pricing, active status, paper publication (Migration 007, Domain 06)
- **Subscription Plans**: pricing, features, active status, duration (Migration 012, Domain 11)
- **Student Subscriptions**: status transitions (activate, cancel, refund), manual grants (Migration 012, Domain 11)
- **System Settings**: any configuration value (Migration 011, Domain 10)
- **Notification Templates**: content, channels, active status (Migration 010, Domain 09)
- **Feature Flags**: global enable/disable, per-institute overrides (Migration 016, Domain 15)
- **API Keys**: active status, expiration, scopes (Migration 016, Domain 15)
- **Webhook Endpoints**: URL, secret, event types, active status (Migration 016, Domain 15)

### 1.5 What Admin Can Delete

- **Soft-delete**: Most entities support soft-deletion via `is_active = false` or `deleted_at` timestamps:
  - `institutes.is_active` (Migration 002, Section 3a)
  - `profiles.is_active` (Migration 002, Section 3b)
  - `batches.deleted_at` (soft delete — Migration 003, Section 1e)
  - `batch_students.status = 'dropped'` (Migration 003, Section 1f)
  - `notifications.is_deleted` (soft delete — Migration 010, Section 1b)
  - `subscription_plans.is_active` (Migration 012, Section 2b)
  - `media_files.is_active` (Migration 013, Section 2a)
  - `teacher_employment_records.is_active_employee` (Migration 014, Section 2a)
  - `teacher_bank_details.is_active` (Migration 014, Section 2f)
  - `teacher_availability.is_available` (Migration 014, Section 2g)
- **Hard-delete**: Admin can physically delete certain entities:
  - `questions` (if `times_attempted = 0` — not used in any submitted attempt) (Migration 006, Section 1a)
  - `tags` (admin-only — Migration 021, Section 5b)
  - `feature_flags` (when 100% rolled out — Migration 016, Section 2e)
  - `approval_requests` (historical records can be purged — no FK cascade concerns)
- **Restricted deletion** (blocked by triggers/constraints):
  - `audit_logs` — immutable, DELETE blocked by trigger (Migration 011, Section 5a)
  - `webhook_endpoints` with undelivered logs — blocked by trigger (Migration 016, Section 5a)

### 1.6 What Admin Can Approve

- **Content approval**: `approval_requests` with `resource_type = 'content'` — Admin sets status to `approved` or `rejected` (Migration 004, Section 1d)
- **Mock Test approval**: `approval_requests` with `resource_type = 'mock_test'` — Admin approves or rejects (Migration 004, Section 1d)
- **Question approval**: Set `questions.status = 'published'` with `approved_by` and `approved_at` (Migration 006, Section 1a)
- **Teacher qualification verification**: `teacher_qualifications.is_verified`, `verified_by`, `verified_at` (Migration 014, Section 2c)
- **Teacher experience verification**: `teacher_experiences.is_verified`, `verified_by`, `verified_at` (Migration 014, Section 2d)
- **Teacher document KYC verification**: `teacher_documents.status` — `pending` → `verified` or `rejected` (Migration 014, Section 2e)
- **Teacher bank details verification**: `teacher_bank_details.status` — `pending` → `verified` or `rejected` (Migration 014, Section 2f)
- **Teacher leave request review**: `teacher_leave_requests.status` — `pending` → `approved` or `rejected` (Migration 014, Section 2h)
- **Subscription cancellations**: Admin-initiated cancellations with refund eligibility (Migration 012, Section 2g)
- **Refund processing**: `payments` status → `refunded` or `partially_refunded` (Migration 008, Section 1c)

### 1.7 What Admin Can Monitor

- **Audit Logs**: `audit_logs` — every significant action across the platform (Migration 011, Section 2a)
- **System Settings**: configuration values and changes (Migration 011, Section 2b)
- **Async Jobs**: `async_jobs` — background task status and failures (Migration 016, Section 2d)
- **Webhook Deliveries**: `webhook_delivery_logs` — delivery success/failure tracking (Migration 016, Section 2c)
- **Subscription Health**: active/expired/cancelled counts, renewal failures, grace periods (Migration 012, Domain 11)
- **Payment Status**: payment attempts, failures, refunds (Migration 008, Section 1c)
- **Revenue Analytics**: via `orders`, `order_items`, `payments` (Migration 008, Domain 07)
- **Teacher Analytics**: `teacher_analytics` — per-teacher performance metrics (Migration 009, Section 1e)
- **Student Performance**: `performance_reports`, `progress_history` (Migration 009, Sections 1a, 1d)
- **Storage Usage**: `media_files` size tracking, `content` file sizes (Migration 013, Domain 12)
- **API Key Usage**: `api_keys.last_used_at` (Migration 016, Section 2a)
- **System Events**: `system_events_outbox` — transactional event propagation (Migration 016, Section 2g)

### 1.8 What Admin Cannot Do (System Restrictions)

- **Modify `audit_logs`**: Even admins cannot UPDATE or DELETE audit log rows — the table is append-only with triggers blocking all mutations (Migration 011, Section 5a)
- **Modify immutable system setting fields**: `setting_key`, `data_type`, `is_system` are immutable after creation (Migration 011, Section 4c)
- **Delete system settings**: `system_settings` rows are only deactivated (`is_active = false`), never physically deleted (Migration 011, Section 2b)
- **Change system setting keys/types**: Protected by trigger (Migration 011, Section 4c)
- **Delete webhook endpoints with pending deliveries**: Blocked by trigger (Migration 016, Section 4a)
- **Hard-delete orders**: Orders are financial source of truth — retained for 7+ years (GST compliance) (Migration 008, Section 1a)
- **Hard-delete HR records**: `teacher_employment_records` soft-deletes via `is_active_employee` (Migration 014, Section 2a)
- **Directly modify storage objects**: Storage bucket policies enforce folder-level access (Migration 022)

**Source:** Migration 011 (Domain 10 — Administration), Migration 008 (Domain 07 — Commerce), Migration 014 (Domain 13 — Teacher Management), Migration 022 (Storage Configuration)

---

## Section 2: Dashboard Pages

### 2.1 Page Inventory

| # | Page Name | Purpose | Required APIs | Primary Tables | RLS/Permissions | Priority |
|---|-----------|---------|---------------|----------------|-----------------|----------|
| 1 | **Dashboard** | Aggregate overview: revenue, users, tests, health | `GET /admin/dashboard` | orders, payments, profiles, student_details, teacher_details, mock_tests, audit_logs | Admin full access | CRITICAL |
| 2 | **Institute Management** | Manage institute settings, plan tier, branding | `GET/PUT /admin/institutes/{id}` | institutes | Admin full access | CRITICAL |
| 3 | **Users / Profiles** | Manage all users (students, teachers, admins) | `GET /admin/users`, `PATCH /admin/users/{id}`, `POST /admin/users` | profiles, student_details, teacher_details | Admin full access | CRITICAL |
| 4 | **Academic Structure** | Manage streams, subjects, chapters, topics | `GET/POST/PATCH/DELETE /admin/streams`, `/admin/subjects`, `/admin/chapters`, `/admin/topics` | streams, subjects, chapters, topics | Admin full access | CRITICAL |
| 5 | **Batch Management** | CRUD batches, assign teachers/students | `GET/POST/PATCH/DELETE /admin/batches`, `/admin/batches/{id}/teachers`, `/admin/batches/{id}/students` | batches, batch_teachers, batch_students | Admin full access | CRITICAL |
| 6 | **Teacher Management** | CRUD teachers, HR records, verification, payroll | `GET/POST/PATCH/DELETE /admin/teachers/{id}/*` | teacher_details, teacher_employment_records, teacher_specializations, teacher_qualifications, teacher_experiences, teacher_documents, teacher_bank_details, teacher_availability, teacher_leave_requests | Admin full access (HR is admin-only) | CRITICAL |
| 7 | **Student Management** | CRUD students, batch transfers, performance | `GET/POST/PATCH/DELETE /admin/students/{id}/*` | student_details, batch_students, performance_reports, progress_history | Admin full access | CRITICAL |
| 8 | **Content Management** | Browse, approve/reject, publish content | `GET /admin/content`, `PATCH /admin/content/{id}/approve`, `PATCH /admin/content/{id}/reject` | content, approval_requests, tags | Admin full access | CRITICAL |
| 9 | **Approval Center** | Unified approval queue for content, mock tests | `GET /admin/approvals`, `POST /admin/approvals/{id}/approve`, `POST /admin/approvals/{id}/reject` | approval_requests, content, mock_tests | Admin full access | CRITICAL |
| 10 | **Question Bank** | Browse, approve, edit, delete questions | `GET/POST/PATCH/DELETE /admin/questions/{id}/*` | questions, question_options, question_explanations, question_images | Admin full access | CRITICAL |
| 11 | **Mock Test Management** | CRUD, publish, archive, result release | `GET/POST/PATCH/DELETE /admin/mock-tests/{id}/*`, `POST /admin/mock-tests/{id}/release-results` | mock_tests, mock_test_questions, mock_results | Admin full access | CRITICAL |
| 12 | **PYQ Management** | Manage packages, papers, questions, pricing | `GET/POST/PATCH/DELETE /admin/pyq-packages/{id}/*`, `/admin/pyq-papers/{id}/*` | pyq_packages, pyq_papers, pyq_question_mappings, pyq_solutions, pyq_mock_mappings, student_pyq_purchases | Admin full access (PYQ is admin-only CRUD) | HIGH |
| 13 | **Live Classes** | View all classes, manage recordings | `GET /admin/live-classes`, `PATCH /admin/live-classes/{id}/cancel` | live_classes, live_sessions, recordings, attendance, session_participants | Admin full access | MEDIUM |
| 14 | **Attendance Dashboard** | View attendance across all classes/batches | `GET /admin/attendance`, `GET /admin/attendance/summary` | attendance, attendance_events, live_classes | Admin full access | MEDIUM |
| 15 | **Subscription Plans** | CRUD plans, features, pricing, unlocks | `GET/POST/PATCH/DELETE /admin/subscription-plans/{id}/*`, `/admin/subscription-features` | subscription_plans, subscription_features, plan_unlocks | Admin full access | HIGH |
| 16 | **Student Subscriptions** | View/manage all student subscriptions | `GET /admin/student-subscriptions`, `POST /admin/student-subscriptions/{id}/cancel`, `POST /admin/student-subscriptions/{id}/refund` | student_subscriptions, subscription_history, subscription_renewals, subscription_cancellations, subscription_grace_periods, subscription_usage | Admin full access | HIGH |
| 17 | **Orders & Payments** | View orders, process refunds, invoices | `GET /admin/orders`, `GET /admin/payments`, `POST /admin/orders/{id}/refund` | orders, order_items, payments, invoices | Admin full access | HIGH |
| 18 | **Coupons / Discounts** | Manage coupon codes | `GET/POST/PATCH/DELETE /admin/coupons` | orders (coupon_code column) + recommended new `coupons` table | Admin full access | MEDIUM |
| 19 | **Revenue Analytics** | Charts: MRR, revenue by plan, PYQ sales | `GET /admin/analytics/revenue` | orders, order_items, payments, invoices, student_pyq_purchases | Admin full access | HIGH |
| 20 | **Teacher Payouts** | Manage salary records, commission | `GET /admin/teacher-payouts`, recommended future `teacher_payouts` table | teacher_employment_records, teacher_bank_details | Admin full access | MEDIUM |
| 21 | **Support Tickets** | Manage student support tickets | `GET /admin/support-tickets`, `POST /admin/support-tickets/{id}/messages` | support_tickets, support_ticket_messages | Admin full access | MEDIUM |
| 22 | **Doubts** | Oversee student doubts, teacher responses | `GET /admin/doubts` | student_doubts, doubt_replies | Admin full access | LOW |
| 23 | **Notifications** | Create/send notifications, manage templates | `GET/POST/PATCH/DELETE /admin/notifications`, `/admin/notification-templates` | notifications, notification_templates, notification_recipients | Admin full access (INSERT/UPDATE only admins) | HIGH |
| 24 | **System Settings** | Manage institute configuration | `GET/PUT /admin/system-settings/{key}` | system_settings | Admin full access (admin-only RLS) | CRITICAL |
| 25 | **Feature Flags** | Toggle features, per-institute overrides | `GET/POST/PATCH/DELETE /admin/feature-flags`, `/admin/feature-flags/{id}/overrides` | feature_flags, feature_flag_overrides | Admin full access (admin-only RLS) | HIGH |
| 26 | **API Keys** | Manage programmatic access tokens | `GET/POST/PATCH/DELETE /admin/api-keys` | api_keys | Admin full access (admin-only RLS) | MEDIUM |
| 27 | **Webhooks** | Manage webhook endpoints, view delivery logs | `GET/POST/PATCH/DELETE /admin/webhooks`, `GET /admin/webhooks/{id}/logs` | webhook_endpoints, webhook_delivery_logs | Admin full access (admin-only RLS) | MEDIUM |
| 28 | **Audit Logs** | View immutable audit trail | `GET /admin/audit-logs` | audit_logs | Admin-only SELECT | CRITICAL |
| 29 | **Async Jobs** | Monitor background jobs | `GET /admin/async-jobs` | async_jobs | Admin full access (admin-only RLS) | MEDIUM |
| 30 | **Media Library** | Browse all uploaded media | `GET /admin/media` | media_files, media_versions, media_usage, media_processing_jobs | Admin full access | MEDIUM |
| 31 | **Reports** | Generate and download reports | `GET /admin/reports/*` | All tables (aggregated) + recommended `async_jobs` for report generation | Admin full access | HIGH |
| 32 | **Analytics Dashboard** | Charts: student growth, teacher perf, content usage | `GET /admin/analytics/*` | All Domain 08 tables + commerce tables | Admin full access | HIGH |
| 33 | **Feedback & Ratings** | View student feedback for teachers, classes, content | `GET /admin/feedback` | student_feedback_ratings | Admin full access | LOW |
| 34 | **Profile** | Admin's own profile management | `GET/PATCH /admin/profile` | profiles | Own profile access | MEDIUM |

---

## Section 3: Dashboard Widgets

### 3.1 Widget Inventory (Home Dashboard)

| # | Widget Name | Data Source | SQL / Query Pattern | Refresh | Migration Source |
|---|-------------|-------------|---------------------|---------|-----------------|
| 1 | **Total Students** | `SELECT COUNT(*) FROM profiles WHERE role = 'student' AND institute_id = X` | Live count (or cached) | Real-time / 5 min | Migration 002 |
| 2 | **Total Teachers** | `SELECT COUNT(*) FROM profiles WHERE role = 'teacher' AND institute_id = X` | Live count | Real-time / 5 min | Migration 002 |
| 3 | **Total Admins** | `SELECT COUNT(*) FROM profiles WHERE role = 'admin' AND institute_id = X` | Live count | Real-time / 5 min | Migration 002 |
| 4 | **Total Revenue (All Time)** | `SELECT SUM(total_amount) FROM orders WHERE status = 'confirmed' AND institute_id = X` | Aggregate | Nightly / live | Migration 008 |
| 5 | **Today's Revenue** | `SELECT SUM(total_amount) FROM orders WHERE status = 'confirmed' AND institute_id = X AND confirmed_at >= today` | Live aggregate | Real-time | Migration 008 |
| 6 | **Monthly Revenue (MTD)** | `SELECT SUM(total_amount) FROM orders WHERE status = 'confirmed' AND institute_id = X AND confirmed_at >= month_start` | Live aggregate | Real-time | Migration 008 |
| 7 | **Active Subscriptions** | `SELECT COUNT(*) FROM student_subscriptions WHERE status IN ('active', 'grace') AND institute_id = X` | Live count | Real-time | Migration 012 |
| 8 | **Expired Subscriptions** | `SELECT COUNT(*) FROM student_subscriptions WHERE status = 'expired' AND institute_id = X` | Live count | Real-time | Migration 012 |
| 9 | **Total Mock Tests** | `SELECT COUNT(*) FROM mock_tests WHERE institute_id = X` | Live count | Real-time | Migration 006 |
| 10 | **Published Mock Tests** | `SELECT COUNT(*) FROM mock_tests WHERE status = 'published' AND institute_id = X` | Live count | Real-time | Migration 006 |
| 11 | **Active Batches** | `SELECT COUNT(*) FROM batches WHERE status = 'active' AND institute_id = X` | Live count | Real-time | Migration 003 |
| 12 | **Live Classes Today** | `SELECT COUNT(*) FROM live_classes WHERE institute_id = X AND scheduled_at::date = CURRENT_DATE` | Live count | Real-time | Migration 005 |
| 13 | **Upcoming Live Classes** | `SELECT * FROM live_classes WHERE status = 'scheduled' AND institute_id = X AND scheduled_at > NOW() ORDER BY scheduled_at LIMIT 5` | Live list | Real-time | Migration 005 |
| 14 | **Pending Approvals (Content)** | `SELECT COUNT(*) FROM approval_requests WHERE status = 'pending' AND resource_type = 'content' AND institute_id = X` | Live count | Real-time | Migration 004 |
| 15 | **Pending Approvals (Mock Tests)** | `SELECT COUNT(*) FROM approval_requests WHERE status = 'pending' AND resource_type = 'mock_test' AND institute_id = X` | Live count | Real-time | Migration 004 |
| 16 | **Pending Question Approvals** | `SELECT COUNT(*) FROM questions WHERE status = 'pending_approval' AND institute_id = X` | Live count | Real-time | Migration 006 |
| 17 | **Pending Teacher KYC** | `SELECT COUNT(*) FROM teacher_documents WHERE status = 'pending' AND institute_id = X` (unique teachers) | Live count | Real-time | Migration 014 |
| 18 | **Pending Leave Requests** | `SELECT COUNT(*) FROM teacher_leave_requests WHERE status = 'pending' AND institute_id = X` | Live count | Real-time | Migration 014 |
| 19 | **Pending Support Tickets** | `SELECT COUNT(*) FROM support_tickets WHERE status IN ('open', 'in_progress') AND priority IN ('urgent', 'high')` | Live count | Real-time | Migration 015 |
| 20 | **Recent Payments** | `SELECT * FROM payments WHERE status = 'captured' AND institute_id = X ORDER BY paid_at DESC LIMIT 10` | Live list | Real-time | Migration 008 |
| 21 | **Failed Payments (Today)** | `SELECT COUNT(*) FROM payments WHERE status = 'failed' AND institute_id = X AND created_at >= today` | Live count | Real-time | Migration 008 |
| 22 | **Recent Orders** | `SELECT * FROM orders WHERE institute_id = X ORDER BY placed_at DESC LIMIT 10` | Live list | Real-time | Migration 008 |
| 23 | **Recent Registrations** | `SELECT * FROM profiles WHERE institute_id = X ORDER BY created_at DESC LIMIT 10` | Live list | Real-time | Migration 002 |
| 24 | **Daily Signups (This Week)** | `SELECT DATE(created_at), COUNT(*) FROM profiles WHERE institute_id = X AND created_at >= week_start GROUP BY 1 ORDER BY 1` | Live aggregate | Real-time | Migration 002 |
| 25 | **Top Selling PYQ Package** | `SELECT si.package_id, pp.name, COUNT(*) FROM student_pyq_purchases si JOIN pyq_packages pp ... WHERE is_active = true GROUP BY ... ORDER BY COUNT(*) DESC LIMIT 5` | Live aggregate | Nightly | Migration 007 |
| 26 | **Most Active Teacher** | `SELECT teacher_id, COUNT(*) FROM live_classes WHERE status = 'completed' AND institute_id = X GROUP BY teacher_id ORDER BY COUNT(*) DESC LIMIT 5` | Live aggregate | Nightly | Migration 005 |
| 27 | **System Health** | Check recent `async_jobs` failures, `webhook_delivery_logs` retries | Status check | Real-time | Migration 016 |
| 28 | **Notification Queue** | `SELECT COUNT(*) FROM notifications WHERE dispatched_at IS NULL AND institute_id = X` | Live count | Real-time | Migration 010 |
| 29 | **Storage Usage** | `SELECT SUM(total_size_bytes) FROM media_files WHERE institute_id = X` | Aggregate | Nightly | Migration 013 |
| 30 | **Content Uploads (This Month)** | `SELECT COUNT(*), content_type FROM content WHERE institute_id = X AND created_at >= month_start GROUP BY content_type` | Live aggregate | Real-time | Migration 004 |
| 31 | **Questions Created (This Month)** | `SELECT COUNT(*) FROM questions WHERE institute_id = X AND created_at >= month_start` | Live count | Real-time | Migration 006 |
| 32 | **PYQ Purchases (This Month)** | `SELECT COUNT(*) FROM student_pyq_purchases WHERE institute_id = X AND purchased_at >= month_start` | Live count | Real-time | Migration 007 |
| 33 | **Renewal Success Rate** | `SELECT COUNT(*) FILTER(WHERE succeeded_at IS NOT NULL) / COUNT(*)::float * 100 FROM subscription_renewals WHERE institute_id = X AND attempted_at >= month_start` | Aggregate | Nightly | Migration 012 |
| 34 | **Cancellation Rate (Churn)** | `SELECT COUNT(*) FROM subscription_cancellations WHERE institute_id = X AND cancelled_at >= month_start` | Live count | Nightly | Migration 012 |
| 35 | **Grace Periods Active** | `SELECT COUNT(*) FROM subscription_grace_periods WHERE resolution IS NULL AND institute_id = X` | Live count | Real-time | Migration 012 |
| 36 | **Open Support Tickets** | `SELECT COUNT(*) FROM support_tickets WHERE status NOT IN ('resolved', 'closed')` | Live count | Real-time | Migration 015 |

---

## Section 4: Teacher Management

### 4.1 Feature Inventory

| # | Feature | Justification | Migration Source | RLS |
|---|---------|---------------|-----------------|-----|
| 1 | **Create Teacher Profile** | `INSERT` into `profiles` (admin sets role = 'teacher') + `teacher_details` (1:1) | Migration 002, Sections 3b-3c | Admin full access (Migration 021, Section 3b) |
| 2 | **Approve Teacher** | No explicit approval status on `teacher_details` — approval is implicit via employment record creation and document verification | Migration 014, Sections 2a, 2e | Admin full access |
| 3 | **Deactivate Teacher** | `UPDATE profiles.is_active = false` + `UPDATE teacher_employment_records.is_active_employee = false` | Migration 002, Section 3b; Migration 014, Section 2a | Admin full access |
| 4 | **Assign Subjects (Specializations)** | `INSERT` on `teacher_specializations` (M:M teacher ↔ subject) with proficiency_level (1-5) | Migration 014, Section 2b | Admin full access (Migration 021, Section 15b) |
| 5 | **Assign Streams** | Inferred via `teacher_specializations.subject_id → subjects.stream_id` — no direct stream assignment table | Migration 014, Section 2b; Migration 003, Section 1b | Admin full access |
| 6 | **Assign Batches** | `INSERT` on `batch_teachers` (M:M) with `role_in_batch` (free text: lead_teacher, co_teacher, doubt_solver) | Migration 003, Section 1g | Admin full access (Migration 021, Section 4g) |
| 7 | **Assign Salary** | `INSERT`/`UPDATE` on `teacher_employment_records` — `base_salary`, `salary_basis` (monthly_fixed, hourly_rate, revenue_share, per_class), `revenue_share_percent` | Migration 014, Section 2a | Admin-only RLS (Migration 021, Section 15a) |
| 8 | **Set Employment Type** | `employment_type` enum: `full_time`, `part_time`, `contract`, `freelance` | Migration 014, Section 1a, 2a | Admin-only RLS |
| 9 | **Upload Documents** | `INSERT` on `teacher_documents` with category (identity_proof, address_proof, education_cert, contract, cancelled_cheque), storage bucket pointer, verification status | Migration 014, Section 2e | Admin full access (Migration 021, Section 15e) |
| 10 | **Verify Documents** | `UPDATE teacher_documents SET status = 'verified' OR 'rejected', verified_by, verified_at` | Migration 014, Section 2e | Admin full access |
| 11 | **Verify Qualifications** | `UPDATE teacher_qualifications SET is_verified = true, verified_by, verified_at` | Migration 014, Section 2c | Admin full access |
| 12 | **Verify Experience** | `UPDATE teacher_experiences SET is_verified = true, verified_by, verified_at` | Migration 014, Section 2d | Admin full access |
| 13 | **Verify Bank Details** | `UPDATE teacher_bank_details SET status = 'verified' OR 'rejected', verified_by, verified_at` | Migration 014, Section 2f | Admin-only RLS (Migration 021, Section 15f) |
| 14 | **Manage Bank Details** | `CRUD` on `teacher_bank_details` — account_holder_name, bank_name, account_number (encrypted), ifsc_code, account_type | Migration 014, Section 2f | Admin-only RLS |
| 15 | **Teacher Analytics** | `SELECT` from `teacher_analytics` — total_students, total_classes_conducted, avg_attendance_rate, total_content_uploaded, questions_created, tests_created, avg_student_score, top_chapter_id, last_class_at | Migration 009, Section 1e | Admin full access (Migration 021, Section 10e) |
| 16 | **Teacher Availability** | `CRUD` on `teacher_availability` — day_of_week (monday-sunday), start_time, end_time, is_available | Migration 014, Section 2g | Admin full access (Migration 021, Section 15g) |
| 17 | **Teacher Leave Approval** | `UPDATE teacher_leave_requests SET status = 'approved' OR 'rejected', reviewed_by, reviewed_at, reviewer_remarks` | Migration 014, Section 2h | Admin full access (Migration 021, Section 15h) |
| 18 | **Teacher Ratings** | `SELECT AVG(rating) FROM student_feedback_ratings WHERE target_type = 'teacher' AND target_id = X` — aggregated via `teacher_details.rating` (denormalized) | Migration 015, Section 2i; Migration 002, Section 3c | Admin full access |
| 19 | **Teacher Activity Log** | `SELECT FROM audit_logs WHERE profile_id = X` — filter audit trail by teacher | Migration 011, Section 2a | Admin-only SELECT |
| 20 | **Teacher Scheduling Conflicts** | Detect overlapping availability, conflicting leave, double-booked live classes via SQL queries across `teacher_availability`, `teacher_leave_requests`, `live_classes` | Migration 014; Migration 005 | Admin full access |

### 4.2 Employment Types (Enum)

```
full_time   → Leave eligible, monthly_fixed salary basis
part_time   → Pro-rata leave, hourly_rate or per_class basis
contract    → Fixed-term, no leave, per_class or monthly_fixed
freelance   → No benefits, revenue_share or per_class basis
```

**Source:** Migration 014, Section 1a

### 4.3 Salary Basis Types (Enum)

```
monthly_fixed  → Base salary paid monthly (fixed amount)
hourly_rate    → Paid per hour of teaching
revenue_share  → Percentage of collected student fees
per_class      → Fixed amount per class conducted
```

**Source:** Migration 014, Section 1b

### 4.4 Document Category Types (Enum)

```
identity_proof   → Aadhaar, PAN, Passport, Voter ID
address_proof    → Utility bills, bank statement, rent agreement
education_cert   → Degree certificates, mark sheets, diplomas
contract         → Signed employment/teaching contract
cancelled_cheque → Bank account verification
```

**Source:** Migration 014, Section 1d

### 4.5 Leave Category Types (Enum)

```
casual              → Planned personal leave (paid)
sick                → Medical leave (paid)
unpaid              → Leave without pay
maternity_paternity → Parental leave (as per law)
compensatory        → Compensatory off for extra work
```

**Source:** Migration 014, Section 1f

### 4.6 Leave Status Workflow

```
pending → approved (by admin)
pending → rejected (by admin)
pending → cancelled (by teacher — status in RLS allows teacher update on own)
```

**Source:** Migration 014, Section 2h

### 4.7 Business Logic & Constraints

- **Availability overlap prevention**: Trigger on `teacher_availability` prevents overlapping time slots for the same teacher on the same day (Migration 014, Section 4a)
- **Leave overlap prevention**: Trigger on `teacher_leave_requests` prevents overlapping approved/pending leave for the same teacher (Migration 014, Section 4c)
- **1:1 employment record**: `uq_teacher_employment_records_teacher` enforces one employment record per teacher (Migration 014, Section 2a)
- **Unique bank details**: `uq_teacher_bank_details_teacher` enforces one active bank record per teacher (Migration 014, Section 2f)
- **Unique specialization**: `uq_teacher_specializations_teacher_subject` prevents duplicate subject assignments (Migration 014, Section 2b)
- **Proficiency range**: 1-5 scale with CHECK constraint (Migration 014, Section 2b)
- **Verification consistency**: CHECK constraints ensure `is_verified = true` always has `verified_by` and `verified_at` populated (Migration 014, Sections 2c, 2d, 2e, 2f)
- **Review consistency on leave**: `approved`/`rejected` status requires `reviewed_by` and `reviewed_at` (Migration 014, Section 2h)

---

## Section 5: Student Management

### 5.1 Feature Inventory

| # | Feature | Justification | Migration Source |
|---|---------|---------------|-----------------|
| 1 | **Create Student** | `INSERT` into `profiles` (role = 'student') + `student_details` (1:1) with enrollment_no, dob, target_year | Migration 002, Sections 3b, 3d |
| 2 | **Import Students (Bulk)** | Schema supports bulk INSERT into `profiles` + `student_details`. No import function exists in schema — would need backend Edge Function | Migration 002 |
| 3 | **Assign Batch** | `INSERT` on `batch_students` with active status | Migration 003, Section 1f |
| 4 | **Transfer Batch** | `UPDATE` current `batch_students.status = 'transferred'`, `INSERT` new `batch_students` with active | Migration 003, Section 1f |
| 5 | **Deactivate Student** | `UPDATE profiles.is_active = false` | Migration 002, Section 3b |
| 6 | **View Student Profile** | `SELECT` from `profiles` + `student_details` (name, email, phone, avatar, enrollment_no, dob, target_year, enrolled_on) | Migration 002 |
| 7 | **View Student Performance** | `SELECT` from `performance_reports` — overall_score, overall_accuracy, rank, percentile, weak_chapters, strong_chapters | Migration 009, Section 1a |
| 8 | **View Subject Performance** | `SELECT` from `subject_performances` — per-subject scores, accuracy, avg_time | Migration 009, Section 1b |
| 9 | **View Chapter Performance** | `SELECT` from `chapter_performances` — per-chapter scores, accuracy, is_weak, is_strong | Migration 009, Section 1c |
| 10 | **View Progress History** | `SELECT` from `progress_history` — score trend over time across attempts | Migration 009, Section 1d |
| 11 | **View Attendance** | `SELECT` from `attendance` WHERE student_id = X — class-wise attendance, duration, present/absent | Migration 005, Section 1f |
| 12 | **View Purchases** | `SELECT` from `orders` + `order_items` + `student_pyq_purchases` — all financial transactions | Migration 008, Section 1a; Migration 007, Section 1g |
| 13 | **View Subscriptions** | `SELECT` from `student_subscriptions` + `subscription_history` + `subscription_renewals` + `subscription_cancellations` — full subscription lifecycle | Migration 012, Sections 2d-2g |
| 14 | **View Doubts** | `SELECT` from `student_doubts` WHERE student_id = X — all doubts asked | Migration 015, Section 2e |
| 15 | **View Support Tickets** | `SELECT` from `support_tickets` WHERE student_id = X — all support interactions | Migration 015, Section 2g |
| 16 | **View Bookmarks** | `SELECT` from `student_bookmarks` WHERE student_id = X — saved content | Migration 015, Section 2a |
| 17 | **View Downloads** | `SELECT` from `student_downloads` WHERE student_id = X — DRM offline records | Migration 015, Section 2b |
| 18 | **View Feedback/Ratings** | `SELECT` from `student_feedback_ratings` WHERE student_id = X — all ratings given | Migration 015, Section 2i |
| 19 | **Grant PYQ Access** | `INSERT` on `student_pyq_purchases` with `access_type = 'admin_grant'` for manual access | Migration 007, Section 1g |
| 20 | **Revoke PYQ Access** | `UPDATE student_pyq_purchases SET is_active = false, revoked_at, revoked_reason` | Migration 007, Section 1g |
| 21 | **Generate Certificate** | Schema has `certificates` storage bucket (Migration 022, Section 1i) — certificate generation would use async_jobs | Migration 022; Migration 016 |
| 22 | **View Viewing History** | `SELECT` from `student_viewing_history` WHERE student_id = X — resume playback positions | Migration 015, Section 2c |
| 23 | **View Personal Notes** | `SELECT` from `student_personal_notes` WHERE student_id = X — student's own notes | Migration 015, Section 2d |

### 5.2 Business Logic & Constraints

- **Unique enrollment number per institute**: Partial unique index `uq_student_details_institute_enrollment` WHERE enrollment_no IS NOT NULL (Migration 002, Section 4d)
- **Enrollment format**: `enrollment_no` VARCHAR(50), minimum 2 characters (Migration 002, Section 3d)
- **Date of birth validation**: Must be in the past, after 1900-01-01 (Migration 002, Section 3d)
- **Batch enrollment status**: `active`, `inactive`, `transferred`, `dropped` — enrollment history is permanent (Migration 003, Section 1f)
- **Enrolled_on constraint**: Must be today or earlier (Migration 003, Section 1f)
- **CASCADE rules**: Student bookmarks, downloads, viewing history, personal notes, doubts, support tickets all CASCADE on student delete (Migration 015, Domain 14)

---

## Section 6: Course Management

### 6.1 Important Finding

The schema does **not** have a dedicated `courses` table. Course management is represented through:

1. **Streams → Subjects → Chapters → Topics** (academic hierarchy — Migration 003, Domain 02)
2. **Content** items (PDFs, videos, notes, assignments) mapped to chapters (Migration 004, Domain 03)
3. **Batches** (delivery groups) mapped to streams (Migration 003, Section 1e)
4. **Live Classes** mapped to subjects/chapters and batches (Migration 005, Domain 04)

### 6.2 What Admin Controls

| # | Feature | Justification | Migration Source |
|---|---------|---------------|-----------------|
| 1 | **Create/Edit/Delete Streams** | Full CRUD on `streams` (institute-scoped, is_active flag) | Migration 003, Section 1a |
| 2 | **Create/Edit/Delete Subjects** | Full CRUD on `subjects` (stream-scoped, code unique within stream) | Migration 003, Section 1b |
| 3 | **Create/Edit/Delete Chapters** | Full CRUD on `chapters` (subject-scoped, name unique within subject) | Migration 003, Section 1c |
| 4 | **Create/Edit/Delete Topics** | Full CRUD on `topics` (chapter-scoped, optional 4th level) | Migration 003, Section 1d |
| 5 | **Reorder Academic Hierarchy** | `display_order` column on streams, subjects, chapters, topics (smallint, increments of 10 recommended) | Migration 003, Domain 02 |
| 6 | **Approve/Reject Content** | `approval_requests` with resource_type = 'content' — admin reviews teacher-uploaded content | Migration 004, Section 1d |
| 7 | **Publish/Unpublish Content** | `UPDATE content.status` — `draft` → `pending_review` → `approved` → `rejected` → `archived` | Migration 004, Section 1a |
| 8 | **Manage Tags** | CRUD on `tags` (institute-scoped, lowercase, case-insensitive) | Migration 004, Section 1b |
| 9 | **Set Free Preview** | `UPDATE content.is_free_preview` — accessible without subscription | Migration 004, Section 1a |
| 10 | **View Content Analytics** | `view_count`, `download_count` on `content` — auto-incrementing counters | Migration 004, Section 1a |
| 11 | **Content Version History** | `parent_content_id` self-reference — traverse version lineage via recursive CTE | Migration 004, Section 1a |
| 12 | **Map Content to Chapters** | `content.chapter_id` FK + denormalized `content.subject_id` | Migration 004, Section 1a |
| 13 | **Bulk Content Operations** | Schema supports bulk UPDATE on content.status, content.is_free_preview via SQL | Migration 004 |

### 6.3 Content Lifecycle

```
draft → pending_review → approved → archived
                       → rejected (can return to draft)
```

**Source:** Migration 002, Section 1b (`lifecycle_status` enum), Migration 004, Section 1a

### 6.4 Content Type Validation

- **PDF**: `page_count` required, `duration_seconds` must be NULL
- **Video**: `duration_seconds` required, `page_count` must be NULL
- **Notes**: No type-specific requirements beyond title and storage path
- **Assignment**: `duration_seconds` must be NULL

**Source:** Migration 004, Section 1a — `ck_content_type_specific` CHECK constraint

### 6.5 Academicy Hierarchy Depth

```
Institute (1)
  └── Streams (M) — e.g., NEET, JEE, CBSE
        └── Subjects (M) — e.g., Physics, Chemistry, Biology
              └── Chapters (M) — e.g., Laws of Motion, Thermodynamics
                    └── Topics (M, optional) — e.g., Newton's First Law
```

**Source:** Migration 003, Domain 02

---

## Section 7: Mock Test Management

### 7.1 Feature Inventory

| # | Feature | Justification | Migration Source |
|---|---------|---------------|-----------------|
| 1 | **Create Mock Test** | `INSERT` on `mock_tests` — admin can create tests for any teacher (no teacher_id restriction) | Migration 006, Section 1e |
| 2 | **Edit Mock Test** | `UPDATE` on `mock_tests` (while in draft or pending_approval) | Migration 006, Section 1e |
| 3 | **Delete Mock Test** | `DELETE` on `mock_tests` (draft only — FK constraints protect published tests) | Migration 006, Section 1e |
| 4 | **Publish Mock Test** | `UPDATE mock_tests.status = 'published'`, set `published_at` — freezes question_snapshot | Migration 006, Section 1e |
| 5 | **Archive Mock Test** | `UPDATE mock_tests.status = 'archived'` | Migration 006, Section 0b |
| 6 | **Approve Mock Test** | Via `approval_requests` or directly set `status = 'published'` | Migration 004, Section 1d; Migration 006, Section 1e |
| 7 | **Reject Mock Test** | Via `approval_requests` with remarks | Migration 004, Section 1d |
| 8 | **Add Questions to Test** | `INSERT` on `mock_test_questions` with per-test marks, negative_marks_override, section_name | Migration 006, Section 1f |
| 9 | **Remove Questions from Test** | `DELETE` on `mock_test_questions` (CASCADE with mock_tests) | Migration 006, Section 1f |
| 10 | **Reorder Questions** | `UPDATE order_sequence` on `mock_test_questions` | Migration 006, Section 1f |
| 11 | **Configure Test Settings** | duration_min, total_marks, passing_marks, negative_marking, attempt_limit, shuffle_questions, shuffle_options, calculator_allowed, test_type, result_release_mode | Migration 006, Section 1e |
| 12 | **Set Availability Window** | available_from, available_to timestamps | Migration 006, Section 1e |
| 13 | **Release Results** | `UPDATE mock_results SET is_released = true, released_at = NOW()` | Migration 006, Section 1j |
| 14 | **View All Results** | `SELECT` from `mock_results` — all students, all tests | Migration 021, Section 7j |
| 15 | **View Attempt Details** | `SELECT` from `mock_attempts`, `mock_answers`, `mock_answer_options` | Migration 021, Sections 7g, 7h, 7i |
| 16 | **Export Results** | No export function in schema — build at API layer using `mock_results` + `mock_answers` | Migration 006 |
| 17 | **Leaderboard** | `SELECT FROM mock_results ORDER BY total_score DESC` for a test | Migration 006, Section 1j |
| 18 | **Re-evaluate Attempt** | Re-run scoring for a specific attempt (no trigger — application-level function) | Migration 006 |
| 19 | **Manual Result Entry** | Schema doesn't support this — results are computed from answers | Migration 006 |
| 20 | **Question Snapshot View** | `question_snapshot` JSONB on `mock_test_questions` — frozen question data at publish time | Migration 006, Section 1f |

### 7.2 Test Type Options (VARCHAR, not enum)

```
practice      → No ranking, instant result, unlimited attempts
mock          → Full exam simulation, ranked, leaderboard
chapter_test  → Single chapter focused assessment
pyq_paper     → Previous year question paper (linked via pyq_mock_mappings)
```

**Source:** Migration 006, Section 1e

### 7.3 Result Release Modes (VARCHAR, not enum)

```
immediate  → Results shown to student right after submission
scheduled  → Results released at result_release_at timestamp
manual     → Admin manually triggers release via is_released flag
```

**Source:** Migration 006, Section 1e

### 7.4 Business Logic & Constraints

- **duration_min**: 1-600 minutes (Migration 006, Section 1e — `ck_mock_tests_duration_min`)
- **total_marks > 0**: Positive total marks required (Migration 006, Section 1e)
- **passing_marks**: Must be between 0 and total_marks, nullable (Migration 006, Section 1e)
- **attempt_limit**: Minimum 1, nullable for unlimited (Migration 006, Section 1e)
- **available_window**: `available_until`, if set with `available_from`, must be after `available_from` (Migration 006, Section 1e)
- **published_at**: Must be set when status = 'published' (Migration 006, Section 1e)
- **Question snapshot freezes at publish**: `question_snapshot` JSONB populated by publish Edge Function (Migration 006, Section 1f)
- **Scheduled release**: `result_release_at` must be set when mode = 'scheduled' (Migration 006, Section 1e)
- **Attempt numbering**: `uq_mock_attempts_test_student_number` enforces sequential attempt numbers per student per test (Migration 006, Section 1g)
- **1:1 result per attempt**: `uq_mock_results_attempt_id` (Migration 006, Section 1j)
- **Result release consistency**: `is_released = true` always has `released_at` (Migration 006, Section 1j)

---

## Section 8: Question Bank

### 8.1 Feature Inventory

| # | Feature | Justification | Migration Source |
|---|---------|---------------|-----------------|
| 1 | **Create Question** | `INSERT` on `questions` — admin can create for any subject/chapter | Migration 006, Section 1a |
| 2 | **Edit Question** | `UPDATE` on `questions` (version increments on substantive edits) | Migration 006, Section 1a |
| 3 | **Delete Question** | `DELETE` on `questions` (only if `times_attempted = 0` — not used in submitted attempts) | Migration 006, Section 1a |
| 4 | **Approve Question** | `UPDATE questions.status = 'published'`, set `approved_by`, `approved_at` | Migration 006, Section 1a |
| 5 | **Reject Question** | `UPDATE questions.status = 'pending_approval' → 'draft'` (admin can send back for revision) | Migration 006, Section 0a |
| 6 | **MCQ Type** | `question_type = 'mcq'` — exactly one correct option | Migration 006, Section 0 |
| 7 | **MSQ Type** | `question_type = 'msq'` — one or more correct options | Migration 006, Section 0 |
| 8 | **Numerical Type** | `question_type = 'numerical'` — answer in `question_explanations.correct_numerical_answer` | Migration 006, Section 0 |
| 9 | **True/False Type** | `question_type = 'true_false'` — exactly two options, one correct | Migration 006, Section 0 |
| 10 | **Set Difficulty** | `difficulty` enum: `easy`, `medium`, `hard` | Migration 002, Section 1c |
| 11 | **Set Marks** | `marks` NUMERIC(5,2) — default marks | Migration 006, Section 1a |
| 12 | **Set Negative Marks** | `negative_marks` NUMERIC(5,2) — default negative marks | Migration 006, Section 1a |
| 13 | **Manage Options** | CRUD on `question_options` — option_text, is_correct, order_sequence | Migration 006, Section 1b |
| 14 | **Manage Explanation** | CRUD on `question_explanations` (1:1) — explanation_text, explanation_video_url | Migration 006, Section 1c |
| 15 | **Manage Images** | CRUD on `question_images` — storage_bucket, storage_path, image_role, alt_text, order_sequence | Migration 006, Section 1d |
| 16 | **Tag by Subject/Chapter** | `subject_id` FK + `chapter_id` FK on questions | Migration 006, Section 1a |
| 17 | **View Version History** | `parent_question_id` self-reference + `version` integer — traverse lineage | Migration 006, Section 1a |
| 18 | **Bulk Import Questions** | No import function in schema — recommended Edge Function | Migration 006 |
| 19 | **Question Statistics** | `times_attempted`, `average_time_seconds` — computed from actual attempts | Migration 006, Section 1a |
| 20 | **Question Source Tracking** | `question_source_type` enum: `teacher`, `pyq`, `imported` | Migration 002, Section 1c |

### 8.2 Question Types

| Type | Options | Correct Answer Storage | Scoring |
|------|---------|----------------------|---------|
| `mcq` | 2+ options, exactly 1 correct | `question_options.is_correct = true` (exactly one) | Full marks if selected, negative if wrong |
| `msq` | 2+ options, 1+ correct | `question_options.is_correct = true` (one or more) | Partial marks possible |
| `numerical` | No options | `question_explanations.correct_numerical_answer` with `numerical_tolerance` | Exact match or within tolerance |
| `true_false` | 2 options (True/False), exactly 1 correct | `question_options.is_correct = true` (exactly one) | Full marks if correct, negative if wrong |

**Source:** Migration 006, Sections 0, 1a-1d

### 8.3 Question Image Roles (Enum)

```
question    → Image embedded in the question stem text
option      → Image used within a specific option
explanation → Image used in the solution walkthrough
```

**Source:** Migration 002, Section 1j

### 8.4 Business Logic & Constraints

- **Question text**: Minimum 10 characters (Migration 006, Section 1a — `ck_questions_question_text_length`)
- **Marks**: Must be > 0 (Migration 006, Section 1a)
- **Negative marks**: Must be >= 0 (Migration 006, Section 1a)
- **Version**: Starting at 1, incremented on substantive edits (Migration 006, Section 1a)
- **Approval consistency**: `published` status requires `approved_by` and `approved_at` (Migration 006, Section 1a — `ck_questions_approval_consistency`)
- **No self-parent**: CHECK prevents A.parent = A (Migration 006, Section 1a)
- **Option ordering**: `order_sequence` enforced unique per question via `uq_question_options_question_sequence` (Migration 006, Section 1b)
- **1:1 explanation**: `uq_question_explanations_question_id` (Migration 006, Section 1c)
- **Numerical validation**: `correct_numerical_answer` may exist without `numerical_tolerance`, but `numerical_tolerance` cannot exist without `correct_numerical_answer` (Migration 006, Section 1c)
- **CASCADE**: Options, explanations, images all CASCADE on question delete (Migration 006, Sections 1b-1d)
- **Created_by FK**: References `teacher_details.teacher_id`, not `profiles.profile_id` (Migration 006, Section 1a)

---

## Section 9: PYQ Management

### 9.1 Feature Inventory

| # | Feature | Justification | Migration Source |
|---|---------|---------------|-----------------|
| 1 | **Create PYQ Package** | `INSERT` on `pyq_packages` — name, description, price, currency, year range, thumbnail | Migration 007, Section 1a |
| 2 | **Edit PYQ Package** | `UPDATE` on `pyq_packages` — price, description, is_active, thumbnail | Migration 007, Section 1a |
| 3 | **Activate/Deactivate Package** | `UPDATE pyq_packages.is_active` — hides from store, preserves existing purchases | Migration 007, Section 1a |
| 4 | **Set Unlock Types** | INSERT on `pyq_package_unlocks` — pdf, solutions, mock_test access grants | Migration 007, Section 1b |
| 5 | **Create PYQ Paper** | `INSERT` on `pyq_papers` — title, exam_year, exam_session, total_questions, total_marks, duration_min | Migration 007, Section 1c |
| 6 | **Upload Paper PDF** | Storage bucket `content-pdfs` + `pyq_papers.pdf_storage_bucket`, `pdf_storage_path` | Migration 007, Section 1c; Migration 022 |
| 7 | **Upload Solution PDF** | `pyq_papers.solution_pdf_storage_bucket`, `solution_pdf_storage_path` | Migration 007, Section 1c |
| 8 | **Publish/Unpublish Paper** | `UPDATE pyq_papers.is_published`, `published_at` | Migration 007, Section 1c |
| 9 | **Map Question to Paper** | `INSERT` on `pyq_question_mappings` — links questions to pyq_papers with order_sequence, section_name, official_marks | Migration 007, Section 1d |
| 10 | **Remove Question Mapping** | `DELETE` on `pyq_question_mappings` | Migration 007, Section 1d |
| 11 | **Manage Solutions** | CRUD on `pyq_solutions` — solution_text, solution_video_url, official_answer | Migration 007, Section 1e |
| 12 | **Flag Disputed Question** | `UPDATE pyq_solutions.is_disputed = true`, set dispute_note | Migration 007, Section 1e |
| 13 | **Link to Mock Test** | `INSERT` on `pyq_mock_mappings` (1:1 — paper → mock_test) | Migration 007, Section 1f |
| 14 | **Remove Mock Mapping** | `DELETE` on `pyq_mock_mappings` | Migration 007, Section 1f |
| 15 | **View PYQ Purchases** | `SELECT` from `student_pyq_purchases` — who bought what | Migration 007, Section 1g |
| 16 | **Grant PYQ Access** | `INSERT` on `student_pyq_purchases` with `access_type = 'admin_grant'` | Migration 007, Section 1g |
| 17 | **Revoke PYQ Access** | `UPDATE student_pyq_purchases.is_active = false`, set `revoked_at`, `revoked_reason` | Migration 007, Section 1g |
| 18 | **View PYQ Analytics** | Count of purchases, revenue per package, most popular papers | Migration 007 |
| 19 | **Bulk Upload Papers** | No bulk function in schema — recommended Edge Function | Migration 007 |

### 9.2 Business Logic & Constraints

- **Price**: Must be >= 0 (0.00 for free packages) (Migration 007, Section 1a)
- **Year range**: `year_from` and `year_to` must be 1990-2100, `year_to >= year_from` (Migration 007, Section 1a)
- **Active requires published**: `is_active = true` requires `published_at` (Migration 007, Section 1a)
- **Unique paper per package/year/session**: `uq_pyq_papers_package_year_session` (Migration 007, Section 1c)
- **Paired storage**: PDF storage bucket + path must be both NULL or both set (Migration 007, Section 1c)
- **Unique question per paper**: `uq_pyq_question_mappings_paper_question` (Migration 007, Section 1d)
- **Unique sequence per paper**: `uq_pyq_question_mappings_paper_sequence` (Migration 007, Section 1d)
- **1:1 solution per mapping**: `uq_pyq_solutions_mapping_id` (Migration 007, Section 1e)
- **Solution content required**: At least one of solution_text, solution_video_url, or is_disputed = true (Migration 007, Section 1e)
- **Dispute consistency**: `is_disputed = true` requires `dispute_note` (Migration 007, Section 1e)
- **1:1 mock mapping both sides**: `uq_pyq_mock_mappings_paper_id` + `uq_pyq_mock_mappings_test_id` (Migration 007, Section 1f)
- **One purchase per student per package**: `uq_student_pyq_purchases_student_package` (Migration 007, Section 1g)
- **Revocation consistency**: `is_active = false` requires `revoked_at` + `revoked_reason` (Migration 007, Section 1g)
- **Deferred FK**: `student_pyq_purchases.order_item_id → order_items.item_id` (Migration 017, Section 1a)

---

## Section 10: Live Classes

### 10.1 Feature Inventory

| # | Feature | Justification | Migration Source |
|---|---------|---------------|-----------------|
| 1 | **View All Live Classes** | `SELECT` from `live_classes` — across all teachers | Migration 005, Section 1a |
| 2 | **Create Live Class** | `INSERT` on `live_classes` — admin can create for any teacher | Migration 005, Section 1a |
| 3 | **Edit Live Class** | `UPDATE` on `live_classes` (while in draft or scheduled) | Migration 005, Section 1a |
| 4 | **Cancel Live Class** | `UPDATE status = 'cancelled'`, set `cancelled_at`, `cancelled_reason` | Migration 005, Section 1a |
| 5 | **Assign to Batches** | `INSERT` on `live_class_batch` (M:M junction) | Migration 005, Section 1c |
| 6 | **View Attendance** | `SELECT` from `attendance` — across all classes | Migration 021, Section 6f |
| 7 | **Override Attendance** | `UPDATE attendance SET is_manual_override = true, override_by, override_reason` | Migration 005, Section 1f |
| 8 | **View Recordings** | `SELECT` from `recordings` — across all classes | Migration 021, Section 6d |
| 9 | **View Session Participants** | `SELECT` from `session_participants` — across all classes | Migration 021, Section 6e |
| 10 | **View Live Sessions** | `SELECT` from `live_sessions` — active provider sessions | Migration 021, Section 6b |
| 11 | **Class Statistics** | Peak participants, duration, attendance rate | Migration 005, Sections 1b, 1f |
| 12 | **Recording Management** | CRUD on `recordings` — storage, transcripts, captions | Migration 005, Section 1d |

### 10.2 Live Class Status Lifecycle

```
draft → scheduled → live → completed → cancelled
```

**Source:** Migration 005, Section 1a — `live_class_status` enum

### 10.3 Session Status Lifecycle

```
waiting → live → ended
```

**Source:** Migration 005, Section 1b — `live_session_status` enum

### 10.4 Recording Status

```
queued → processing → completed → failed
```

**Source:** Migration 005, Section 1d — `recording_status` enum

### 10.5 Business Logic & Constraints

- **Title**: Minimum 3 characters (Migration 005, Section 1a)
- **Duration**: 1-480 minutes (Migration 005, Section 1a — `ck_live_classes_duration_min`)
- **Cancellation consistency**: `status = 'cancelled'` requires `cancelled_at` (Migration 005, Section 1a)
- **1:1 session per class**: `uq_live_sessions_class_id` (Migration 005, Section 1b)
- **Session-end consistency**: `status = 'ended'` requires `ended_at` (Migration 005, Section 1b)
- **Unique class+batch**: Composite PK `(class_id, batch_id)` (Migration 005, Section 1c)
- **Unique segment per class**: `uq_recordings_class_segment` (Migration 005, Section 1d)
- **One attendance per student per class**: `uq_attendance_class_student` (Migration 005, Section 1f)
- **Attendance override consistency**: `is_manual_override = true` requires `override_by` (Migration 005, Section 1f)

---

## Section 11: Commerce

### 11.1 Feature Inventory

| # | Feature | Justification | Migration Source |
|---|---------|---------------|-----------------|
| 1 | **View All Orders** | `SELECT` from `orders` — master list of all purchases | Migration 008, Section 1a |
| 2 | **View Order Details** | `SELECT` from `orders` + `order_items` — line items, amounts | Migration 008, Sections 1a-1b |
| 3 | **Cancel Order** | `UPDATE orders.status = 'cancelled'`, set `cancelled_at` | Migration 008, Section 1a |
| 4 | **Refund Order** | `UPDATE orders.status = 'refunded'`, set `refunded_at` + `UPDATE payments.status = 'refunded'` | Migration 008, Sections 1a, 1c |
| 5 | **View Payments** | `SELECT` from `payments` — per-order payment attempts, gateway info | Migration 008, Section 1c |
| 6 | **View Invoices** | `SELECT` from `invoices` — GST-compliant invoices | Migration 008, Section 1d |
| 7 | **Generate Invoice PDF** | `invoices.pdf_url` — path to generated PDF in storage | Migration 008, Section 1d |
| 8 | **Create Subscription Plan** | `INSERT` on `subscription_plans` — name, price, billing_cycle, duration_days, trial_days | Migration 012, Section 2b |
| 9 | **Edit Subscription Plan** | `UPDATE` on `subscription_plans` — price, description, is_active, sort_order | Migration 012, Section 2b |
| 10 | **Manage Plan Features** | CRUD on `plan_unlocks` — link features to plans with usage limits | Migration 012, Section 2c |
| 11 | **Manage Subscription Features** | CRUD on `subscription_features` — feature_key, category, is_quantifiable, unit_label | Migration 012, Section 2a |
| 12 | **View All Subscriptions** | `SELECT` from `student_subscriptions` — across all students | Migration 012, Section 2d |
| 13 | **Activate Subscription (Manual)** | `INSERT`/`UPDATE student_subscriptions.status = 'active'` — enrollment via admin | Migration 012, Section 2d |
| 14 | **Cancel Subscription (Admin)** | `UPDATE student_subscriptions.status = 'cancelled'` + INSERT into `subscription_cancellations` | Migration 012, Sections 2d, 2g |
| 15 | **Refund Subscription** | `UPDATE student_subscriptions.status = 'refunded'` + update `subscription_cancellations` | Migration 012, Section 2d |
| 16 | **View Subscription History** | `SELECT` from `subscription_history` — complete status transition audit | Migration 012, Section 2e |
| 17 | **View Renewal Attempts** | `SELECT` from `subscription_renewals` — success/failure per cycle | Migration 012, Section 2f |
| 18 | **View Grace Periods** | `SELECT` from `subscription_grace_periods` — active and resolved | Migration 012, Section 2h |
| 19 | **Monitor Usage** | `SELECT` from `subscription_usage` — feature consumption per billing period | Migration 012, Section 2i |
| 20 | **Apply Coupon/Discount** | `orders.coupon_code` VARCHAR — coupon validation at API layer | Migration 008, Section 1a |
| 21 | **Revenue Reports** | Aggregated by day/week/month from `orders` + `payments` | Migration 008 |
| 22 | **GST Report** | `invoices` with GSTIN details, tax amounts | Migration 008, Section 1d |

### 11.2 Subscription Status Lifecycle

```
pending → active → grace → expired
                   → cancelled → refunded
grace    → active (payment recovered)
         → expired (no recovery)
```

**Source:** Migration 012, Section 1a — `subscription_status_type` enum + Migration 012, Section 4a (validate_status trigger)

### 11.3 Billing Cycle Types (Enum)

```
monthly       → 30 days
quarterly     → 90 days
half_yearly   → 180 days
yearly        → 365 days
lifetime      → Large fixed duration (e.g., 36500 days), no trial
custom        → Uses duration_days directly
```

**Source:** Migration 012, Section 1e

### 11.4 Feature Categories (Enum)

```
live_classes      → Access to live class streaming
recorded_classes  → Access to recorded lecture library
mock_tests        → Access to mock test engine
pyq_papers        → Access to PYQ content
notes             → Access to study notes
assignments       → Access to assignment submissions
analytics         → Access to performance analytics
downloads         → Offline content access
premium_support   → Priority support queue
batch_access      → Batch enrollment entitlement
api_access        → API access
```

**Source:** Migration 012, Section 1f

### 11.5 Business Logic & Constraints

- **Order financial integrity**: `total_amount = subtotal_amount - discount_amount + tax_amount` (enforced at API layer, not DB) (Migration 008, Section 1a)
- **Discount limit**: `discount_amount <= subtotal_amount` on orders and order_items (Migration 008, Sections 1a-1b)
- **Order status consistency**: `confirmed` requires `confirmed_at`, `cancelled` requires `cancelled_at`, `refunded` requires `refunded_at` (Migration 008, Section 1a)
- **Polymorphic item type**: `order_items.item_type` controls whether `plan_id` or `package_id` is populated (Migration 008, Section 1b)
- **One captured payment per order**: Partial unique index `uq_payments_order_captured WHERE status = 'captured'` (Migration 008, Section 2c)
- **Unique gateway payment**: `uq_payments_gateway_payment_id` prevents duplicate webhook processing (Migration 008, Section 2c)
- **1:1 invoice per order**: `uq_invoices_order_id` (Migration 008, Section 1d)
- **GSTIN format validation**: Regex CHECK on `billing_gstin` and `institute_gstin` (Migration 008, Section 1d)
- **Valid subscription transitions**: Enforced by trigger `trgfn_subscription_validate_status` (Migration 012, Section 4a)
- **Auto-history on status change**: Trigger auto-writes `subscription_history` (Migration 012, Section 4b)
- **Plan capacity enforcement**: Trigger prevents overselling `max_students` (Migration 012, Section 4c)
- **Usage limit enforcement**: `ck_subscription_usage_used_count_cap` caps usage at `limit_snapshot` (Migration 012, Section 2i)
- **Lifetime plan cannot have trial**: `ck_subscription_plans_lifetime_no_trial` (Migration 012, Section 2b)
- **Deferred FK**: `order_items.plan_id → subscription_plans.plan_id` (Migration 017, Section 1b)

---

## Section 12: Notifications

### 12.1 Feature Inventory

| # | Feature | Justification | Migration Source |
|---|---------|---------------|-----------------|
| 1 | **Create Notification Template** | `INSERT` on `notification_templates` — name, title_template, body_template, event_type, channel, target_role | Migration 010, Section 1a |
| 2 | **Edit Notification Template** | `UPDATE` on `notification_templates` — templates are mutable (historical notifications use snapshots) | Migration 010, Section 1a |
| 3 | **Deactivate Template** | `UPDATE notification_templates.is_active = false` | Migration 010, Section 1a |
| 4 | **Create Broadcast Notification** | `INSERT` on `notifications` — fully rendered title, body, event_type, channel | Migration 010, Section 1b |
| 5 | **Schedule Notification** | `dispatched_at` timestamp — future-dated dispatch | Migration 010, Section 1b |
| 6 | **Target Recipients by Role** | `notification_templates.target_role` (admin, teacher, student) + application-level filtering | Migration 010, Section 1a |
| 7 | **Target via Deep Link** | `reference_type + reference_id` — navigate to specific resource on tap | Migration 010, Section 1b |
| 8 | **Multi-Channel Support** | `notification_channel` enum: `in_app`, `push`, `email`, `sms` | Migration 002, Section 1i |
| 9 | **View Sent Notifications** | `SELECT` from `notifications` — list of all dispatches | Migration 021, Section 11b |
| 10 | **View Recipient Status** | `SELECT` from `notification_recipients` — per-user read status | Migration 021, Section 11c |
| 11 | **Soft-Delete Notification** | `UPDATE notifications.is_deleted = true` — hides from recipient inboxes | Migration 010, Section 1b |
| 12 | **Track Read Status** | `notification_recipients.is_read`, `read_at` | Migration 010, Section 1c |
| 13 | **Template Placeholders** | `{{token}}` syntax in title_template, body_template — interpolated at dispatch | Migration 010, Section 1a |
| 14 | **Multi-Channel Dispatch** | One notification per channel — same event_type can create in_app + email + push rows | Migration 010, Section 1b |

### 12.2 Event Types (Enum)

```
live_class_reminder       → Scheduled class starting soon
test_published            → New mock test available
result_available          → Test results released
content_approved          → Uploaded content approved by admin
content_rejected          → Uploaded content rejected
subscription_expiring     → Subscription about to expire
subscription_expired      → Subscription has expired
new_content_uploaded      → New content uploaded to student's batch
batch_assigned            → Student assigned to a batch
announcement              → General announcement
custom                    → Admin-authored one-off message
```

**Source:** Migration 010, Section 0a

### 12.3 Business Logic & Constraints

- **Title length**: 1-500 characters (Migration 010, Section 1b)
- **Body length**: Minimum 1 character (Migration 010, Section 1b)
- **Delete consistency**: `is_deleted = true` auto-sets `deleted_at` via trigger (Migration 010, Section 3c)
- **Read consistency**: `is_read = true` requires `read_at` (Migration 010, Section 1c)
- **Unique recipient per notification**: `uq_notification_recipients_notification_profile` (Migration 010, Section 1c)
- **Admin-only templates**: `notification_templates` RLS is admin-only for all operations (Migration 021, Section 11a)
- **Fan-out model**: `notifications` row is created first, then `notification_recipients` rows are bulk-inserted by fan-out job (Migration 010, Section 1c)
- **Template uniqueness**: System-level templates unique per (event_type, channel) where institute_id is NULL; institute templates unique per (institute_id, event_type, channel) (Migration 010, Section 2a)

---

## Section 13: Analytics

### 13.1 Chart Inventory

| # | Chart Name | Data Source | Description | Migration Source |
|---|------------|-------------|-------------|-----------------|
| 1 | **Monthly Recurring Revenue (MRR)** | `orders` WHERE status = 'confirmed' + `subscription_renewals.succeeded_at` | Monthly subscription revenue trend | Migration 008, 012 |
| 2 | **One-Time Revenue** | `orders` WHERE status = 'confirmed' AND item_type = 'pyq_package' + `student_pyq_purchases` | PYQ package purchase revenue | Migration 008, 007 |
| 3 | **Total Revenue (Cumulative)** | `orders.total_amount` aggregated over time | Cumulative revenue line chart | Migration 008 |
| 4 | **Revenue by Plan** | `order_items` GROUP BY `plan_id` | Which plans generate most revenue | Migration 008 |
| 5 | **Revenue by PYQ Package** | `student_pyq_purchases` GROUP BY `package_id` | PYQ sales breakdown | Migration 007 |
| 6 | **Student Growth (Cumulative)** | `profiles` WHERE role = 'student' GROUP BY DATE(created_at) | Student signups over time | Migration 002 |
| 7 | **Teacher Growth (Cumulative)** | `teacher_details` GROUP BY DATE(created_at) | Teacher additions over time | Migration 002 |
| 8 | **Active vs Expired Subscriptions** | `student_subscriptions` GROUP BY status | Subscription health pie chart | Migration 012 |
| 9 | **Subscription Churn Rate** | `subscription_cancellations` per month / total active at start of month | Monthly churn percentage | Migration 012 |
| 10 | **Renewal Success Rate** | `subscription_renewals` — succeeded vs failed per month | Auto-renewal reliability | Migration 012 |
| 11 | **Mock Tests Created per Month** | `mock_tests` GROUP BY DATE(created_at) | Test creation volume | Migration 006 |
| 12 | **Mock Tests Attempted per Month** | `mock_attempts` GROUP BY DATE(created_at) | Student engagement with tests | Migration 006 |
| 13 | **Average Test Score Over Time** | `mock_results` AVG(percentage) per test per month | Aggregate student performance | Migration 006 |
| 14 | **Questions Created per Month** | `questions` GROUP BY DATE(created_at) | Question bank growth | Migration 006 |
| 15 | **Questions by Type** | `questions` GROUP BY `question_type` | Question type distribution | Migration 006 |
| 16 | **Questions by Difficulty** | `questions` GROUP BY `difficulty` | Difficulty distribution | Migration 006 |
| 17 | **Content Uploads per Month** | `content` GROUP BY DATE(created_at), content_type | Content creation volume by type | Migration 004 |
| 18 | **Content Approval Rate** | `approval_requests` WHERE resource_type = 'content' — approved vs rejected ratio | Content quality metric | Migration 004 |
| 19 | **Teacher Performance** | `teacher_analytics` — avg_student_score, avg_attendance_rate, classes conducted | Per-teacher metrics | Migration 009 |
| 20 | **Top Performing Teachers** | `teacher_analytics` ORDER BY avg_student_score DESC | Teacher ranking | Migration 009 |
| 21 | **Attendance Rate Over Time** | `attendance` AVG(is_present) per month | Overall attendance trend | Migration 005 |
| 22 | **Live Classes Conducted per Month** | `live_classes` WHERE status = 'completed' GROUP BY DATE(scheduled_at) | Class delivery volume | Migration 005 |
| 23 | **PYQ Purchases per Month** | `student_pyq_purchases` GROUP BY DATE(purchased_at) | PYQ sales trend | Migration 007 |
| 24 | **Top Selling PYQ Packages** | `student_pyq_purchases` GROUP BY package_id ORDER BY COUNT(*) DESC | Best-selling bundles | Migration 007 |
| 25 | **Student Weak Chapters (Top N)** | `chapter_performances` WHERE is_weak = true GROUP BY chapter_id ORDER BY COUNT(*) DESC | Most difficult chapters across all students | Migration 009 |
| 26 | **Student Strong Chapters (Top N)** | `chapter_performances` WHERE is_strong = true GROUP BY chapter_id | Easiest chapters | Migration 009 |
| 27 | **Daily Active Users** | `session_participants` + `mock_attempts` + `student_viewing_history` per day | Platform engagement | Migration 005, 006, 015 |
| 28 | **Storage Usage by Category** | `media_files` GROUP BY media_type + `content` GROUP BY content_type | Storage consumption | Migration 013, 004 |
| 29 | **Support Ticket Volume** | `support_tickets` GROUP BY DATE(created_at), category | Support workload | Migration 015 |
| 30 | **Support Ticket Resolution Time** | `support_tickets` AVG(updated_at - created_at) WHERE status = 'resolved' | Average resolution time | Migration 015 |
| 31 | **Doubt Resolution Rate** | `student_doubts` — resolved vs total ratio | Academic Q&A effectiveness | Migration 015 |
| 32 | **Refund Rate** | `payments` WHERE status IN ('refunded', 'partially_refunded') / total payments | Financial metric | Migration 008 |
| 33 | **Payment Gateway Success Rate** | `payments` GROUP BY gateway — captured vs failed | Gateway reliability | Migration 008 |
| 34 | **Student Retention** | `progress_history` — students who attempted 2+ tests vs 1 test | Engagement retention | Migration 009 |

---

## Section 14: Approval Center

### 14.1 Approval Workflow Inventory

| # | Resource Type | Approval Table | How Approval Works | Admin Action | Migration Source |
|---|--------------|----------------|-------------------|--------------|-----------------|
| 1 | **Content** | `approval_requests` WHERE resource_type = 'content' | Teacher submits → `status = 'pending'` → Admin approves/rejects → `content.status` updated by application | Approve/Reject with remarks | Migration 004, Section 1d |
| 2 | **Mock Tests** | `approval_requests` WHERE resource_type = 'mock_test' | Teacher submits → `status = 'pending'` → Admin approves/rejects → `mock_tests.status` updated | Approve/Reject with remarks | Migration 004, Section 1d |
| 3 | **Questions** | Direct `questions.status` field | Teacher sets `status = 'pending_approval'` → Admin sets `status = 'published'` with `approved_by`/`approved_at` | Approve (set published) / Send back to draft | Migration 006, Section 1a |
| 4 | **Teacher Documents (KYC)** | `teacher_documents.status` | Teacher uploads → `status = 'pending'` → Admin verifies/rejects | Verify / Reject with reason | Migration 014, Section 2e |
| 5 | **Teacher Qualifications** | `teacher_qualifications.is_verified` | Teacher adds → `is_verified = false` → Admin verifies | Verify | Migration 014, Section 2c |
| 6 | **Teacher Experience** | `teacher_experiences.is_verified` | Teacher adds → `is_verified = false` → Admin verifies | Verify | Migration 014, Section 2d |
| 7 | **Teacher Bank Details** | `teacher_bank_details.status` | Teacher adds → `status = 'pending'` → Admin verifies/rejects | Verify / Reject with reason | Migration 014, Section 2f |
| 8 | **Teacher Leave Requests** | `teacher_leave_requests.status` | Teacher submits → `status = 'pending'` → Admin approves/rejects | Approve / Reject with remarks | Migration 014, Section 2h |

### 14.2 Approval Queue Queries

**All Pending Items:**
```sql
-- Unified approval queue
SELECT 'content' AS resource_type, a.approval_id, a.resource_id, a.teacher_id,
       a.requested_at, a.version, c.title AS resource_name
FROM approval_requests a
JOIN content c ON c.content_id = a.resource_id
WHERE a.status = 'pending' AND a.institute_id = X

UNION ALL

SELECT 'mock_test' AS resource_type, a.approval_id, a.resource_id, a.teacher_id,
       a.requested_at, a.version, mt.title AS resource_name
FROM approval_requests a
JOIN mock_tests mt ON mt.test_id = a.resource_id
WHERE a.status = 'pending' AND a.institute_id = X

UNION ALL

SELECT 'question' AS resource_type, q.question_id AS approval_id, q.question_id AS resource_id,
       q.created_by AS teacher_id, q.updated_at AS requested_at, q.version,
       LEFT(q.question_text, 100) AS resource_name
FROM questions q
WHERE q.status = 'pending_approval' AND q.institute_id = X

ORDER BY requested_at;
```

**Pending Teacher KYC Items:**
```sql
SELECT DISTINCT ON (td.teacher_id) td.teacher_id, p.name AS teacher_name,
       COUNT(doc.document_id) FILTER(WHERE doc.status = 'pending') AS pending_docs,
       COUNT(doc.document_id) FILTER(WHERE doc.status = 'verified') AS verified_docs,
       td.rating
FROM teacher_documents doc
JOIN teacher_details td ON td.teacher_id = doc.teacher_id
JOIN profiles p ON p.profile_id = td.profile_id
WHERE doc.institute_id = X
GROUP BY td.teacher_id, p.name, td.rating;
```

### 14.3 Approval Business Logic

- **One pending request per resource**: Partial unique index `uq_approval_pending_resource WHERE status = 'pending'` (Migration 004, Section 2d)
- **Version tracking**: `approval_requests.version` increments on each resubmission (Migration 004, Section 1d)
- **Review consistency**: `approved`/`rejected` status requires `reviewed_by` + `reviewed_at` (Migration 004, Section 1d)
- **Question approval consistency**: `published` status requires `approved_by` + `approved_at` (Migration 006, Section 1a)
- **Teacher document consistency**: `verified`/`rejected` status requires `verified_at` (Migration 014, Section 2e)
- **Leave review consistency**: `approved`/`rejected` requires `reviewed_by` + `reviewed_at` (Migration 014, Section 2h)

---

## Section 15: Profile

### 15.1 Feature Inventory

| # | Feature | Justification | Migration Source |
|---|---------|---------------|-----------------|
| 1 | **Edit Name** | `UPDATE profiles.name` | Migration 002, Section 3b |
| 2 | **Edit Email** | `UPDATE profiles.email` | Migration 002, Section 3b |
| 3 | **Edit Phone** | `UPDATE profiles.phone` (E.164 without leading +) | Migration 024, 025 |
| 4 | **Upload Avatar** | Storage bucket `profile-images` — admin uploads to own folder | Migration 022, Section 2a |
| 5 | **Edit Role** | `UPDATE profiles.role` (`admin`, `teacher`, `student`) | Migration 002, Section 3b |
| 6 | **Activate/Deactivate Account** | `UPDATE profiles.is_active` | Migration 002, Section 3b |
| 7 | **Change Password** | Handled by Supabase Auth, not profiles table | N/A |
| 8 | **View Audit Log** | Admin can see own actions via `audit_logs` | Migration 011, Section 2a |
| 9 | **API Key Management** | Admin can create/manage own API keys | Migration 016, Section 2a |

---

## Section 16: Permission Matrix

### 16.1 Admin Permissions by Module

| Module | View | Create | Edit | Delete | Publish | Approve | Export | Source |
|--------|------|--------|------|--------|---------|--------|--------|--------|
| **Dashboard** | ✅ | - | - | - | - | - | - | Migration 021 |
| **Institute Settings** | ✅ | ✅ | ✅ | ❌ (soft-disable only) | - | - | - | Migration 021, Section 3a |
| **Users (Profiles)** | ✅ | ✅ | ✅ | ✅ (soft) | - | - | ✅ | Migration 021, Section 3 |
| **Academic Structure** | ✅ | ✅ | ✅ | ✅ | - | - | ✅ | Migration 021, Section 4 |
| **Batches** | ✅ | ✅ | ✅ | ✅ (soft) | ✅ (status) | - | ✅ | Migration 021, Section 4e |
| **Batch Enrollments** | ✅ | ✅ | ✅ (transfer) | ✅ (drop) | - | - | ✅ | Migration 021, Section 4f |
| **Teacher Assignments** | ✅ | ✅ | ✅ | ✅ | - | - | - | Migration 021, Section 4g |
| **Teacher HR** | ✅ | ✅ | ✅ | ✅ (soft) | - | ✅ (KYC) | ✅ | Migration 021, Section 15 |
| **Teacher Leave** | ✅ | ✅ | ✅ (review) | - | - | ✅ | - | Migration 021, Section 15h |
| **Student Profiles** | ✅ | ✅ | ✅ | ✅ (soft) | - | - | ✅ | Migration 021, Section 3c |
| **Student Performance** | ✅ | - | - | - | - | - | ✅ | Migration 021, Section 10 |
| **Content** | ✅ | ✅ | ✅ | ✅ | ✅ (publish) | ✅ (approve) | ✅ | Migration 021, Section 5a |
| **Tags** | ✅ | ✅ | ✅ | ✅ | - | - | - | Migration 021, Section 5b |
| **Approvals** | ✅ | - | - | - | - | ✅ | ✅ | Migration 021, Section 5d |
| **Questions** | ✅ | ✅ | ✅ | ✅ (unused) | ✅ (publish) | ✅ (approve) | ✅ | Migration 021, Section 7a |
| **Mock Tests** | ✅ | ✅ | ✅ | ✅ (draft) | ✅ (publish) | ✅ (approve) | ✅ | Migration 021, Section 7e |
| **Mock Results** | ✅ | - | ✅ (release) | - | - | - | ✅ | Migration 021, Section 7j |
| **PYQ Packages** | ✅ | ✅ | ✅ | ✅ (soft) | ✅ (publish) | - | ✅ | Migration 021, Section 8a |
| **PYQ Papers** | ✅ | ✅ | ✅ | ✅ | ✅ (publish) | - | ✅ | Migration 021, Section 8c |
| **PYQ Purchases** | ✅ | ✅ (grant) | ✅ (revoke) | - | - | - | ✅ | Migration 021, Section 8g |
| **Subscription Plans** | ✅ | ✅ | ✅ | ✅ (soft) | - | - | ✅ | Migration 021, Section 13b |
| **Student Subscriptions** | ✅ | ✅ (activate) | ✅ (cancel/refund) | - | - | - | ✅ | Migration 021, Section 13d |
| **Orders** | ✅ | - | ✅ (cancel/refund) | ❌ (financial) | - | - | ✅ | Migration 021, Section 9a |
| **Payments** | ✅ | - | ✅ (refund) | ❌ (financial) | - | - | ✅ | Migration 021, Section 9c |
| **Invoices** | ✅ | ✅ (generate) | - | ❌ (immutable) | - | - | ✅ | Migration 021, Section 9d |
| **Live Classes** | ✅ | ✅ | ✅ (cancel) | ✅ (draft) | - | - | ✅ | Migration 021, Section 6a |
| **Attendance** | ✅ | - | ✅ (override) | - | - | - | ✅ | Migration 021, Section 6f |
| **Recordings** | ✅ | ✅ | ✅ | ✅ | - | - | - | Migration 021, Section 6d |
| **Notifications** | ✅ | ✅ | ✅ | ✅ (soft) | ✅ (dispatch) | - | - | Migration 021, Section 11 |
| **Notification Templates** | ✅ | ✅ | ✅ | ✅ (soft) | - | - | - | Migration 021, Section 11a |
| **System Settings** | ✅ | ✅ | ✅ | ❌ (deactivate only) | - | - | - | Migration 021, Section 12b |
| **Feature Flags** | ✅ | ✅ | ✅ | ✅ (hard) | - | - | - | Migration 021, Section 17e |
| **API Keys** | ✅ | ✅ | ✅ (revoke) | ✅ | - | - | - | Migration 021, Section 17a |
| **Webhooks** | ✅ | ✅ | ✅ (deactivate) | ✅ (restricted) | - | - | - | Migration 021, Section 17b |
| **Webhook Logs** | ✅ | - | - | - | - | - | - | Migration 021, Section 17c |
| **Async Jobs** | ✅ | ✅ | ✅ (cancel) | - | - | - | - | Migration 021, Section 17d |
| **Support Tickets** | ✅ | - | ✅ (assign, status) | - | - | - | ✅ | Migration 021, Section 16g |
| **Doubts** | ✅ | ✅ (reply) | ✅ (resolve) | - | - | - | - | Migration 021, Section 16e |
| **Media Library** | ✅ | ✅ | ✅ | ✅ (soft) | - | - | - | Migration 021, Section 14 |
| **Support Messages** | ✅ | ✅ | - | - | - | - | - | Migration 021, Section 16h |
| **Feedback/Ratings** | ✅ | - | ✅ (hide) | ✅ | - | - | ✅ | Migration 021, Section 16i |
| **Audit Logs** | ✅ | - | - | - | - | - | ✅ | Migration 021, Section 12a |
| **System Events Outbox** | ✅ | - | - | - | - | - | - | Migration 021, Section 17g |

---

## Section 17: Required APIs

### 17.1 Complete REST API Endpoint Inventory

#### Dashboard
| Method | Endpoint | Description | Tables |
|--------|----------|-------------|--------|
| GET | `/admin/dashboard` | Aggregate dashboard widget data | Multiple (see Widgets) |
| GET | `/admin/dashboard/realtime` | Real-time metrics (active users, today's revenue) | Multiple |

#### Institute Management
| Method | Endpoint | Description | Tables |
|--------|----------|-------------|--------|
| GET | `/admin/institutes` | List all institutes | institutes |
| GET | `/admin/institutes/{id}` | Get institute details | institutes |
| PATCH | `/admin/institutes/{id}` | Update institute settings | institutes |
| PATCH | `/admin/institutes/{id}/plan` | Change plan tier | institutes |

#### User Management
| Method | Endpoint | Description | Tables |
|--------|----------|-------------|--------|
| GET | `/admin/users` | List all users (filter by role, status, institute) | profiles |
| POST | `/admin/users` | Create user (with role, institute) | profiles + auth |
| GET | `/admin/users/{id}` | Get user profile | profiles |
| PATCH | `/admin/users/{id}` | Update user profile | profiles |
| PATCH | `/admin/users/{id}/activate` | Activate user | profiles |
| PATCH | `/admin/users/{id}/deactivate` | Deactivate user | profiles |

#### Teacher Management
| Method | Endpoint | Description | Tables |
|--------|----------|-------------|--------|
| GET | `/admin/teachers` | List all teachers | teacher_details, profiles |
| POST | `/admin/teachers` | Create teacher profile | teacher_details |
| GET | `/admin/teachers/{id}` | Get teacher full profile (with HR data) | teacher_details + all child tables |
| PATCH | `/admin/teachers/{id}` | Update teacher profile | teacher_details |
| GET | `/admin/teachers/{id}/employment` | Get employment record | teacher_employment_records |
| PATCH | `/admin/teachers/{id}/employment` | Update employment record | teacher_employment_records |
| GET | `/admin/teachers/{id}/specializations` | List subject specializations | teacher_specializations |
| POST | `/admin/teachers/{id}/specializations` | Add specialization | teacher_specializations |
| DELETE | `/admin/teachers/{id}/specializations/{sid}` | Remove specialization | teacher_specializations |
| GET | `/admin/teachers/{id}/qualifications` | List qualifications | teacher_qualifications |
| PATCH | `/admin/teachers/{id}/qualifications/{qid}/verify` | Verify qualification | teacher_qualifications |
| GET | `/admin/teachers/{id}/experiences` | List experience | teacher_experiences |
| PATCH | `/admin/teachers/{id}/experiences/{eid}/verify` | Verify experience | teacher_experiences |
| GET | `/admin/teachers/{id}/documents` | List documents | teacher_documents |
| PATCH | `/admin/teachers/{id}/documents/{did}/verify` | Verify document | teacher_documents |
| PATCH | `/admin/teachers/{id}/documents/{did}/reject` | Reject document | teacher_documents |
| GET | `/admin/teachers/{id}/bank-details` | Get bank details | teacher_bank_details |
| PATCH | `/admin/teachers/{id}/bank-details/{bid}/verify` | Verify bank details | teacher_bank_details |
| GET | `/admin/teachers/{id}/availability` | Get availability | teacher_availability |
| POST | `/admin/teachers/{id}/availability` | Add availability slot | teacher_availability |
| DELETE | `/admin/teachers/{id}/availability/{aid}` | Remove availability slot | teacher_availability |
| GET | `/admin/teachers/{id}/leave-requests` | List leave requests | teacher_leave_requests |
| PATCH | `/admin/teachers/{id}/leave-requests/{lid}/approve` | Approve leave | teacher_leave_requests |
| PATCH | `/admin/teachers/{id}/leave-requests/{lid}/reject` | Reject leave | teacher_leave_requests |
| GET | `/admin/teachers/{id}/analytics` | Get teacher analytics | teacher_analytics |
| GET | `/admin/teachers/{id}/batches` | Get batch assignments | batch_teachers |

#### Student Management
| Method | Endpoint | Description | Tables |
|--------|----------|-------------|--------|
| GET | `/admin/students` | List all students | student_details, profiles |
| POST | `/admin/students` | Create student | student_details |
| GET | `/admin/students/{id}` | Get student full profile | student_details + all child |
| PATCH | `/admin/students/{id}` | Update student profile | student_details |
| PATCH | `/admin/students/{id}/activate` | Activate student | profiles |
| PATCH | `/admin/students/{id}/deactivate` | Deactivate student | profiles |
| GET | `/admin/students/{id}/batches` | Get batch enrollments | batch_students |
| POST | `/admin/students/{id}/batches` | Enroll in batch | batch_students |
| PATCH | `/admin/students/{id}/batches/{bid}/transfer` | Transfer batch | batch_students |
| PATCH | `/admin/students/{id}/batches/{bid}/drop` | Drop student from batch | batch_students |
| GET | `/admin/students/{id}/performance` | Get performance reports | performance_reports |
| GET | `/admin/students/{id}/progress` | Get progress history | progress_history |
| GET | `/admin/students/{id}/attendance` | Get attendance records | attendance |
| GET | `/admin/students/{id}/orders` | Get order history | orders, order_items |
| GET | `/admin/students/{id}/subscriptions` | Get subscription history | student_subscriptions + history |
| GET | `/admin/students/{id}/pyq-purchases` | Get PYQ purchases | student_pyq_purchases |
| POST | `/admin/students/{id}/pyq-grant` | Grant PYQ access | student_pyq_purchases |
| PATCH | `/admin/students/{id}/pyq-grant/{pid}/revoke` | Revoke PYQ access | student_pyq_purchases |
| GET | `/admin/students/{id}/doubts` | Get student doubts | student_doubts |
| GET | `/admin/students/{id}/support-tickets` | Get support tickets | support_tickets |
| GET | `/admin/students/{id}/downloads` | Get offline downloads | student_downloads |
| GET | `/admin/students/{id}/bookmarks` | Get bookmarks | student_bookmarks |

#### Academic Structure
| Method | Endpoint | Description | Tables |
|--------|----------|-------------|--------|
| GET | `/admin/streams` | List streams | streams |
| POST | `/admin/streams` | Create stream | streams |
| PATCH | `/admin/streams/{id}` | Update stream | streams |
| DELETE | `/admin/streams/{id}` | Delete/disable stream | streams |
| GET | `/admin/subjects` | List subjects (filter by stream) | subjects |
| POST | `/admin/subjects` | Create subject | subjects |
| PATCH | `/admin/subjects/{id}` | Update subject | subjects |
| DELETE | `/admin/subjects/{id}` | Delete subject | subjects |
| GET | `/admin/chapters` | List chapters (filter by subject) | chapters |
| POST | `/admin/chapters` | Create chapter | chapters |
| PATCH | `/admin/chapters/{id}` | Update chapter | chapters |
| DELETE | `/admin/chapters/{id}` | Delete chapter | chapters |
| GET | `/admin/topics` | List topics (filter by chapter) | topics |
| POST | `/admin/topics` | Create topic | topics |
| PATCH | `/admin/topics/{id}` | Update topic | topics |
| DELETE | `/admin/topics/{id}` | Delete topic | topics |

#### Batch Management
| Method | Endpoint | Description | Tables |
|--------|----------|-------------|--------|
| GET | `/admin/batches` | List batches | batches |
| POST | `/admin/batches` | Create batch | batches |
| GET | `/admin/batches/{id}` | Get batch details | batches |
| PATCH | `/admin/batches/{id}` | Update batch | batches |
| DELETE | `/admin/batches/{id}` | Soft-delete batch | batches |
| PATCH | `/admin/batches/{id}/status` | Update batch status | batches |
| GET | `/admin/batches/{id}/teachers` | List teacher assignments | batch_teachers |
| POST | `/admin/batches/{id}/teachers` | Assign teacher | batch_teachers |
| DELETE | `/admin/batches/{id}/teachers/{tid}` | Remove teacher assignment | batch_teachers |
| GET | `/admin/batches/{id}/students` | List student enrollments | batch_students |
| POST | `/admin/batches/{id}/students` | Enroll student | batch_students |
| PATCH | `/admin/batches/{id}/students/{sid}` | Update enrollment status | batch_students |

#### Content Management
| Method | Endpoint | Description | Tables |
|--------|----------|-------------|--------|
| GET | `/admin/content` | List all content | content |
| POST | `/admin/content` | Create content | content |
| GET | `/admin/content/{id}` | Get content details | content |
| PATCH | `/admin/content/{id}` | Update content | content |
| DELETE | `/admin/content/{id}` | Delete content | content |
| PATCH | `/admin/content/{id}/publish` | Publish content | content |
| PATCH | `/admin/content/{id}/archive` | Archive content | content |

#### Approval Center
| Method | Endpoint | Description | Tables |
|--------|----------|-------------|--------|
| GET | `/admin/approvals` | List pending approvals | approval_requests |
| GET | `/admin/approvals/{id}` | Get approval details | approval_requests + resource |
| POST | `/admin/approvals/{id}/approve` | Approve resource | approval_requests + target |
| POST | `/admin/approvals/{id}/reject` | Reject resource with remarks | approval_requests + target |
| GET | `/admin/approvals/pending/questions` | List pending question approvals | questions |
| PATCH | `/admin/approvals/questions/{id}/approve` | Approve question | questions |
| PATCH | `/admin/approvals/questions/{id}/reject` | Reject question | questions |

#### Question Bank
| Method | Endpoint | Description | Tables |
|--------|----------|-------------|--------|
| GET | `/admin/questions` | List all questions | questions |
| POST | `/admin/questions` | Create question | questions + options + explanation |
| GET | `/admin/questions/{id}` | Get question with children | questions + options + explanation + images |
| PATCH | `/admin/questions/{id}` | Update question | questions |
| DELETE | `/admin/questions/{id}` | Delete question (if unused) | questions |
| POST | `/admin/questions/{id}/options` | Add option | question_options |
| PATCH | `/admin/questions/{id}/options/{oid}` | Update option | question_options |
| DELETE | `/admin/questions/{id}/options/{oid}` | Delete option | question_options |
| PATCH | `/admin/questions/{id}/explanation` | Update explanation | question_explanations |
| POST | `/admin/questions/{id}/images` | Add image | question_images |
| DELETE | `/admin/questions/{id}/images/{iid}` | Delete image | question_images |
| GET | `/admin/questions/analytics` | Question statistics | questions |

#### Mock Tests
| Method | Endpoint | Description | Tables |
|--------|----------|-------------|--------|
| GET | `/admin/mock-tests` | List all mock tests | mock_tests |
| POST | `/admin/mock-tests` | Create mock test | mock_tests |
| GET | `/admin/mock-tests/{id}` | Get mock test details | mock_tests + questions |
| PATCH | `/admin/mock-tests/{id}` | Update mock test | mock_tests |
| DELETE | `/admin/mock-tests/{id}` | Delete draft test | mock_tests |
| POST | `/admin/mock-tests/{id}/questions` | Add question | mock_test_questions |
| DELETE | `/admin/mock-tests/{id}/questions/{qid}` | Remove question | mock_test_questions |
| PATCH | `/admin/mock-tests/{id}/reorder` | Reorder questions | mock_test_questions |
| PATCH | `/admin/mock-tests/{id}/publish` | Publish test | mock_tests |
| PATCH | `/admin/mock-tests/{id}/archive` | Archive test | mock_tests |
| GET | `/admin/mock-tests/{id}/results` | Get all results | mock_results |
| PATCH | `/admin/mock-tests/{id}/release-results` | Release results | mock_results |

#### PYQ Management
| Method | Endpoint | Description | Tables |
|--------|----------|-------------|--------|
| GET | `/admin/pyq-packages` | List PYQ packages | pyq_packages |
| POST | `/admin/pyq-packages` | Create PYQ package | pyq_packages |
| GET | `/admin/pyq-packages/{id}` | Get package details | pyq_packages + papers |
| PATCH | `/admin/pyq-packages/{id}` | Update package | pyq_packages |
| PATCH | `/admin/pyq-packages/{id}/activate` | Activate package | pyq_packages |
| PATCH | `/admin/pyq-packages/{id}/deactivate` | Deactivate package | pyq_packages |
| GET | `/admin/pyq-packages/{id}/papers` | List papers in package | pyq_papers |
| POST | `/admin/pyq-packages/{id}/papers` | Add paper to package | pyq_papers |
| PATCH | `/admin/pyq-papers/{id}` | Update paper | pyq_papers |
| PATCH | `/admin/pyq-papers/{id}/publish` | Publish/Unpublish paper | pyq_papers |
| POST | `/admin/pyq-papers/{id}/questions` | Map question to paper | pyq_question_mappings |
| DELETE | `/admin/pyq-papers/{id}/questions/{qid}` | Remove question mapping | pyq_question_mappings |
| PATCH | `/admin/pyq-papers/{id}/solutions` | Update solution | pyq_solutions |
| POST | `/admin/pyq-papers/{id}/link-mock-test` | Link mock test | pyq_mock_mappings |
| DELETE | `/admin/pyq-papers/{id}/unlink-mock-test` | Unlink mock test | pyq_mock_mappings |
| GET | `/admin/pyq-purchases` | List all PYQ purchases | student_pyq_purchases |
| POST | `/admin/pyq-purchases/grant` | Admin grant PYQ access | student_pyq_purchases |
| PATCH | `/admin/pyq-purchases/{id}/revoke` | Revoke PYQ access | student_pyq_purchases |

#### Live Classes
| Method | Endpoint | Description | Tables |
|--------|----------|-------------|--------|
| GET | `/admin/live-classes` | List all live classes | live_classes |
| POST | `/admin/live-classes` | Create live class | live_classes |
| GET | `/admin/live-classes/{id}` | Get class details | live_classes + batches |
| PATCH | `/admin/live-classes/{id}` | Update class | live_classes |
| PATCH | `/admin/live-classes/{id}/cancel` | Cancel class | live_classes |
| GET | `/admin/live-classes/{id}/attendance` | Get attendance | attendance |
| GET | `/admin/live-classes/{id}/recordings` | Get recordings | recordings |
| GET | `/admin/live-classes/{id}/participants` | Get participants | session_participants |

#### Subscription & Plans
| Method | Endpoint | Description | Tables |
|--------|----------|-------------|--------|
| GET | `/admin/subscription-features` | List features | subscription_features |
| POST | `/admin/subscription-features` | Create feature | subscription_features |
| PATCH | `/admin/subscription-features/{id}` | Update feature | subscription_features |
| GET | `/admin/subscription-plans` | List plans | subscription_plans |
| POST | `/admin/subscription-plans` | Create plan | subscription_plans |
| GET | `/admin/subscription-plans/{id}` | Get plan with features | subscription_plans + plan_unlocks |
| PATCH | `/admin/subscription-plans/{id}` | Update plan | subscription_plans |
| PATCH | `/admin/subscription-plans/{id}/activate` | Activate plan | subscription_plans |
| PATCH | `/admin/subscription-plans/{id}/deactivate` | Disable plan | subscription_plans |
| GET | `/admin/subscription-plans/{id}/unlocks` | List feature unlocks | plan_unlocks |
| POST | `/admin/subscription-plans/{id}/unlocks` | Add feature unlock | plan_unlocks |
| PATCH | `/admin/subscription-plans/{id}/unlocks/{uid}` | Update unlock | plan_unlocks |
| DELETE | `/admin/subscription-plans/{id}/unlocks/{uid}` | Remove unlock | plan_unlocks |
| GET | `/admin/student-subscriptions` | List all subscriptions | student_subscriptions |
| GET | `/admin/student-subscriptions/{id}` | Get subscription details | student_subscriptions + history |
| POST | `/admin/student-subscriptions/{id}/cancel` | Cancel subscription | student_subscriptions + cancellations |
| POST | `/admin/student-subscriptions/{id}/activate` | Activate subscription | student_subscriptions |
| GET | `/admin/student-subscriptions/{id}/history` | Get subscription history | subscription_history |
| GET | `/admin/student-subscriptions/{id}/renewals` | Get renewal attempts | subscription_renewals |
| GET | `/admin/student-subscriptions/{id}/grace-period` | Get grace period | subscription_grace_periods |
| GET | `/admin/student-subscriptions/{id}/usage` | Get usage records | subscription_usage |

#### Commerce
| Method | Endpoint | Description | Tables |
|--------|----------|-------------|--------|
| GET | `/admin/orders` | List all orders | orders |
| GET | `/admin/orders/{id}` | Get order with items | orders + order_items |
| PATCH | `/admin/orders/{id}/cancel` | Cancel order | orders |
| POST | `/admin/orders/{id}/refund` | Process refund | orders + payments |
| GET | `/admin/payments` | List all payments | payments |
| GET | `/admin/payments/{id}` | Get payment details | payments |
| GET | `/admin/invoices` | List all invoices | invoices |
| GET | `/admin/invoices/{id}` | Get invoice details | invoices |

#### Notifications
| Method | Endpoint | Description | Tables |
|--------|----------|-------------|--------|
| GET | `/admin/notification-templates` | List templates | notification_templates |
| POST | `/admin/notification-templates` | Create template | notification_templates |
| PATCH | `/admin/notification-templates/{id}` | Update template | notification_templates |
| PATCH | `/admin/notification-templates/{id}/activate` | Activate template | notification_templates |
| PATCH | `/admin/notification-templates/{id}/deactivate` | Deactivate template | notification_templates |
| GET | `/admin/notifications` | List sent notifications | notifications |
| POST | `/admin/notifications` | Create + dispatch notification | notifications + recipients |
| PATCH | `/admin/notifications/{id}/delete` | Soft-delete notification | notifications |

#### System & Infrastructure
| Method | Endpoint | Description | Tables |
|--------|----------|-------------|--------|
| GET | `/admin/system-settings` | List all settings | system_settings |
| GET | `/admin/system-settings/{key}` | Get setting value | system_settings |
| PUT | `/admin/system-settings/{key}` | Update setting value | system_settings |
| GET | `/admin/feature-flags` | List all flags | feature_flags |
| POST | `/admin/feature-flags` | Create flag | feature_flags |
| PATCH | `/admin/feature-flags/{id}` | Update global flag | feature_flags |
| DELETE | `/admin/feature-flags/{id}` | Delete flag | feature_flags |
| GET | `/admin/feature-flags/{id}/overrides` | List overrides | feature_flag_overrides |
| POST | `/admin/feature-flags/{id}/overrides` | Create override | feature_flag_overrides |
| PATCH | `/admin/feature-flags/{id}/overrides/{oid}` | Update override | feature_flag_overrides |
| DELETE | `/admin/feature-flags/{id}/overrides/{oid}` | Delete override | feature_flag_overrides |
| GET | `/admin/api-keys` | List API keys | api_keys |
| POST | `/admin/api-keys` | Create API key | api_keys |
| PATCH | `/admin/api-keys/{id}` | Update key (revoke) | api_keys |
| DELETE | `/admin/api-keys/{id}` | Delete key | api_keys |
| GET | `/admin/webhooks` | List webhook endpoints | webhook_endpoints |
| POST | `/admin/webhooks` | Create webhook | webhook_endpoints |
| PATCH | `/admin/webhooks/{id}` | Update webhook | webhook_endpoints |
| DELETE | `/admin/webhooks/{id}` | Delete webhook | webhook_endpoints |
| GET | `/admin/webhooks/{id}/logs` | Get delivery logs | webhook_delivery_logs |
| GET | `/admin/async-jobs` | List async jobs | async_jobs |
| POST | `/admin/async-jobs` | Create job | async_jobs |
| PATCH | `/admin/async-jobs/{id}/cancel` | Cancel job | async_jobs |
| GET | `/admin/audit-logs` | List audit logs | audit_logs |
| GET | `/admin/media` | List media files | media_files |

#### Support & Doubts
| Method | Endpoint | Description | Tables |
|--------|----------|-------------|--------|
| GET | `/admin/support-tickets` | List tickets | support_tickets |
| GET | `/admin/support-tickets/{id}` | Get ticket with messages | support_tickets + messages |
| POST | `/admin/support-tickets/{id}/messages` | Send admin message | support_ticket_messages |
| PATCH | `/admin/support-tickets/{id}/assign` | Assign to admin | support_tickets |
| PATCH | `/admin/support-tickets/{id}/status` | Update ticket status | support_tickets |
| GET | `/admin/doubts` | List all doubts | student_doubts |
| PATCH | `/admin/doubts/{id}/resolve` | Resolve doubt | student_doubts |
| GET | `/admin/feedback` | List feedback/ratings | student_feedback_ratings |

#### Analytics
| Method | Endpoint | Description | Tables |
|--------|----------|-------------|--------|
| GET | `/admin/analytics/revenue` | Revenue analytics | orders, payments |
| GET | `/admin/analytics/revenue/monthly` | Monthly revenue breakdown | orders |
| GET | `/admin/analytics/revenue/by-plan` | Revenue by subscription plan | order_items |
| GET | `/admin/analytics/revenue/by-pyq` | Revenue by PYQ package | student_pyq_purchases |
| GET | `/admin/analytics/students/growth` | Student signup trend | profiles |
| GET | `/admin/analytics/teachers/growth` | Teacher addition trend | teacher_details |
| GET | `/admin/analytics/subscriptions` | Subscription metrics | student_subscriptions |
| GET | `/admin/analytics/subscriptions/churn` | Churn analysis | subscription_cancellations |
| GET | `/admin/analytics/tests` | Mock test engagement | mock_attempts, mock_results |
| GET | `/admin/analytics/questions` | Question bank stats | questions |
| GET | `/admin/analytics/content` | Content upload stats | content |
| GET | `/admin/analytics/attendance` | Attendance analytics | attendance |
| GET | `/admin/analytics/classes` | Live class analytics | live_classes |
| GET | `/admin/analytics/teachers/top` | Top performing teachers | teacher_analytics |
| GET | `/admin/analytics/chapters/weak` | Most difficult chapters | chapter_performances |
| GET | `/admin/analytics/support` | Support ticket analytics | support_tickets |
| GET | `/admin/analytics/storage` | Storage usage analytics | media_files |

---

## Section 18: Folder Structure

### 18.1 Recommended React Native Feature Architecture

```
src/
└── features/
    ├── admin-dashboard/
    │   ├── pages/
    │   │   └── AdminDashboardPage.tsx
    │   ├── components/
    │   │   ├── StatCard.tsx
    │   │   ├── RevenueChart.tsx
    │   │   ├── UserGrowthChart.tsx
    │   │   ├── PendingApprovalsWidget.tsx
    │   │   ├── RecentPaymentsWidget.tsx
    │   │   ├── SubscriptionHealthWidget.tsx
    │   │   └── SystemHealthWidget.tsx
    │   ├── hooks/
    │   │   └── useAdminDashboard.ts
    │   └── services/
    │       └── dashboardService.ts
    │
    ├── institutes/
    │   ├── pages/
    │   │   ├── InstituteListPage.tsx
    │   │   └── InstituteSettingsPage.tsx
    │   ├── components/
    │   │   ├── InstituteCard.tsx
    │   │   ├── InstituteForm.tsx
    │   │   └── PlanTierSelector.tsx
    │   ├── hooks/
    │   │   └── useInstitutes.ts
    │   └── services/
    │       └── instituteService.ts
    │
    ├── users/
    │   ├── pages/
    │   │   ├── UserListPage.tsx
    │   │   ├── UserCreatePage.tsx
    │   │   └── UserDetailPage.tsx
    │   ├── components/
    │   │   ├── UserTable.tsx
    │   │   ├── UserForm.tsx
    │   │   ├── UserFilter.tsx
    │   │   └── UserRoleBadge.tsx
    │   ├── hooks/
    │   │   └── useUsers.ts
    │   └── services/
    │       └── userService.ts
    │
    ├── academic/
    │   ├── pages/
    │   │   ├── StreamListPage.tsx
    │   │   ├── SubjectListPage.tsx
    │   │   ├── ChapterListPage.tsx
    │   │   └── TopicListPage.tsx
    │   ├── components/
    │   │   ├── StreamForm.tsx
    │   │   ├── SubjectForm.tsx
    │   │   ├── ChapterForm.tsx
    │   │   ├── TopicForm.tsx
    │   │   ├── HierarchyTree.tsx
    │   │   └── DragDropReorder.tsx
    │   ├── hooks/
    │   │   └── useAcademicHierarchy.ts
    │   └── services/
    │       └── academicService.ts
    │
    ├── batches/
    │   ├── pages/
    │   │   ├── BatchListPage.tsx
    │   │   ├── BatchCreatePage.tsx
    │   │   └── BatchDetailPage.tsx
    │   ├── components/
    │   │   ├── BatchCard.tsx
    │   │   ├── BatchForm.tsx
    │   │   ├── StudentEnrollmentTable.tsx
    │   │   ├── TeacherAssignmentPanel.tsx
    │   │   └── BatchStatusBadge.tsx
    │   ├── hooks/
    │   │   └── useBatches.ts
    │   └── services/
    │       └── batchService.ts
    │
    ├── teachers/
    │   ├── pages/
    │   │   ├── TeacherListPage.tsx
    │   │   ├── TeacherCreatePage.tsx
    │   │   ├── TeacherDetailPage.tsx
    │   │   ├── TeacherEmploymentPage.tsx
    │   │   ├── TeacherKYCPage.tsx
    │   │   ├── TeacherLeavePage.tsx
    │   │   └── TeacherPayoutPage.tsx
    │   ├── components/
    │   │   ├── TeacherTable.tsx
    │   │   ├── TeacherProfileForm.tsx
    │   │   ├── EmploymentForm.tsx
    │   │   ├── SpecializationEditor.tsx
    │   │   ├── QualificationVerification.tsx
    │   │   ├── DocumentViewer.tsx
    │   │   ├── DocumentVerification.tsx
    │   │   ├── BankDetailsForm.tsx
    │   │   ├── AvailabilityGrid.tsx
    │   │   ├── LeaveRequestReview.tsx
    │   │   └── TeacherAnalyticsCard.tsx
    │   ├── hooks/
    │   │   ├── useTeachers.ts
    │   │   ├── useTeacherEmployment.ts
    │   │   ├── useTeacherKYC.ts
    │   │   ├── useTeacherLeave.ts
    │   │   └── useTeacherAnalytics.ts
    │   └── services/
    │       ├── teacherService.ts
    │       ├── employmentService.ts
    │       ├── kycService.ts
    │       └── leaveService.ts
    │
    ├── students/
    │   ├── pages/
    │   │   ├── StudentListPage.tsx
    │   │   ├── StudentCreatePage.tsx
    │   │   ├── StudentDetailPage.tsx
    │   │   ├── StudentPerformancePage.tsx
    │   │   └── StudentSubscriptionPage.tsx
    │   ├── components/
    │   │   ├── StudentTable.tsx
    │   │   ├── StudentProfileForm.tsx
    │   │   ├── BatchEnrollmentPanel.tsx
    │   │   ├── PerformanceChart.tsx
    │   │   ├── ProgressHistoryChart.tsx
    │   │   ├── AttendanceTable.tsx
    │   │   ├── SubscriptionCard.tsx
    │   │   ├── PYQAccessPanel.tsx
    │   │   └── OrderHistoryTable.tsx
    │   ├── hooks/
    │   │   ├── useStudents.ts
    │   │   ├── useStudentPerformance.ts
    │   │   └── useStudentSubscriptions.ts
    │   └── services/
    │       ├── studentService.ts
    │       ├── performanceService.ts
    │       └── subscriptionService.ts
    │
    ├── content/
    │   ├── pages/
    │   │   ├── ContentListPage.tsx
    │   │   ├── ContentUploadPage.tsx
    │   │   └── ContentApprovalPage.tsx
    │   ├── components/
    │   │   ├── ContentTable.tsx
    │   │   ├── ContentApprovalCard.tsx
    │   │   ├── ContentPreview.tsx
    │   │   └── TagEditor.tsx
    │   ├── hooks/
    │   │   └── useContent.ts
    │   └── services/
    │       └── contentService.ts
    │
    ├── approvals/
    │   ├── pages/
    │   │   └── ApprovalCenterPage.tsx
    │   ├── components/
    │   │   ├── ApprovalQueue.tsx
    │   │   ├── ApprovalCard.tsx
    │   │   ├── ApprovalActions.tsx
    │   │   └── ApprovalHistory.tsx
    │   ├── hooks/
    │   │   └── useApprovals.ts
    │   └── services/
    │       └── approvalService.ts
    │
    ├── question-bank/
    │   ├── pages/
    │   │   ├── QuestionListPage.tsx
    │   │   ├── QuestionCreatePage.tsx
    │   │   ├── QuestionEditPage.tsx
    │   │   └── QuestionApprovalPage.tsx
    │   ├── components/
    │   │   ├── QuestionTable.tsx
    │   │   ├── QuestionForm.tsx
    │   │   ├── OptionEditor.tsx
    │   │   ├── ExplanationEditor.tsx
    │   │   ├── ImageUploader.tsx
    │   │   ├── QuestionPreview.tsx
    │   │   └── QuestionApprovalActions.tsx
    │   ├── hooks/
    │   │   └── useQuestions.ts
    │   └── services/
    │       └── questionService.ts
    │
    ├── mock-tests/
    │   ├── pages/
    │   │   ├── MockTestListPage.tsx
    │   │   ├── MockTestCreatePage.tsx
    │   │   ├── MockTestEditPage.tsx
    │   │   ├── MockTestResultsPage.tsx
    │   │   └── MockTestReviewPage.tsx
    │   ├── components/
    │   │   ├── MockTestTable.tsx
    │   │   ├── MockTestForm.tsx
    │   │   ├── QuestionSelector.tsx
    │   │   ├── SectionEditor.tsx
    │   │   ├── ResultTable.tsx
    │   │   ├── ResultReleasePanel.tsx
    │   │   └── LeaderboardTable.tsx
    │   ├── hooks/
    │   │   └── useMockTests.ts
    │   └── services/
    │       └── mockTestService.ts
    │
    ├── pyq/
    │   ├── pages/
    │   │   ├── PYQPackageListPage.tsx
    │   │   ├── PYQPackageCreatePage.tsx
    │   │   ├── PYQPaperListPage.tsx
    │   │   ├── PYQPaperDetailPage.tsx
    │   │   └── PYQPurchasesPage.tsx
    │   ├── components/
    │   │   ├── PackageCard.tsx
    │   │   ├── PackageForm.tsx
    │   │   ├── PaperForm.tsx
    │   │   ├── QuestionMappingPanel.tsx
    │   │   ├── SolutionEditor.tsx
    │   │   ├── MockTestLinkPanel.tsx
    │   │   └── PYQAccessGrantPanel.tsx
    │   ├── hooks/
    │   │   └── usePYQ.ts
    │   └── services/
    │       └── pyqService.ts
    │
    ├── live-classes/
    │   ├── pages/
    │   │   ├── LiveClassListPage.tsx
    │   │   └── LiveClassDetailPage.tsx
    │   ├── components/
    │   │   ├── LiveClassTable.tsx
    │   │   ├── AttendanceTable.tsx
    │   │   └── RecordingList.tsx
    │   ├── hooks/
    │   │   └── useLiveClasses.ts
    │   └── services/
    │       └── liveClassService.ts
    │
    ├── commerce/
    │   ├── pages/
    │   │   ├── OrderListPage.tsx
    │   │   ├── OrderDetailPage.tsx
    │   │   ├── PaymentListPage.tsx
    │   │   ├── InvoiceListPage.tsx
    │   │   ├── SubscriptionPlanListPage.tsx
    │   │   ├── SubscriptionPlanCreatePage.tsx
    │   │   ├── StudentSubscriptionListPage.tsx
    │   │   └── RevenueDashboardPage.tsx
    │   ├── components/
    │   │   ├── OrderTable.tsx
    │   │   ├── OrderDetailCard.tsx
    │   │   ├── RefundPanel.tsx
    │   │   ├── InvoiceTable.tsx
    │   │   ├── PlanCard.tsx
    │   │   ├── PlanForm.tsx
    │   │   ├── FeatureUnlockEditor.tsx
    │   │   ├── SubscriptionTable.tsx
    │   │   ├── SubscriptionDetail.tsx
    │   │   ├── CancellationPanel.tsx
    │   │   ├── RevenueChart.tsx
    │   │   └── RevenueTable.tsx
    │   ├── hooks/
    │   │   ├── useOrders.ts
    │   │   ├── useSubscriptionPlans.ts
    │   │   ├── useStudentSubscriptions.ts
    │   │   └── useRevenue.ts
    │   └── services/
    │       ├── orderService.ts
    │       ├── planService.ts
    │       ├── subscriptionService.ts
    │       └── revenueService.ts
    │
    ├── notifications/
    │   ├── pages/
    │   │   ├── NotificationListPage.tsx
    │   │   ├── NotificationCreatePage.tsx
    │   │   └── NotificationTemplateListPage.tsx
    │   ├── components/
    │   │   ├── NotificationTable.tsx
    │   │   ├── NotificationForm.tsx
    │   │   ├── TemplateCard.tsx
    │   │   ├── TemplateForm.tsx
    │   │   └── RecipientSelector.tsx
    │   ├── hooks/
    │   │   └── useNotifications.ts
    │   └── services/
    │       └── notificationService.ts
    │
    ├── analytics/
    │   ├── pages/
    │   │   └── AnalyticsDashboardPage.tsx
    │   ├── components/
    │   │   ├── RevenueChart.tsx
    │   │   ├── UserGrowthChart.tsx
    │   │   ├── SubscriptionChart.tsx
    │   │   ├── TestEngagementChart.tsx
    │   │   ├── AttendanceChart.tsx
    │   │   ├── TopTeachersTable.tsx
    │   │   ├── WeakChaptersTable.tsx
    │   │   └── StorageChart.tsx
    │   ├── hooks/
    │   │   └── useAnalytics.ts
    │   └── services/
    │       └── analyticsService.ts
    │
    ├── settings/
    │   ├── pages/
    │   │   ├── SystemSettingsPage.tsx
    │   │   ├── FeatureFlagsPage.tsx
    │   │   └── APIKeysPage.tsx
    │   ├── components/
    │   │   ├── SettingEditor.tsx
    │   │   ├── FeatureFlagCard.tsx
    │   │   ├── FeatureFlagOverrideForm.tsx
    │   │   ├── APIKeyTable.tsx
    │   │   └── APIKeyCreateForm.tsx
    │   ├── hooks/
    │   │   ├── useSystemSettings.ts
    │   │   ├── useFeatureFlags.ts
    │   │   └── useAPIKeys.ts
    │   └── services/
    │       ├── settingsService.ts
    │       ├── featureFlagService.ts
    │       └── apiKeyService.ts
    │
    ├── webhooks/
    │   ├── pages/
    │   │   ├── WebhookListPage.tsx
    │   │   └── WebhookDetailPage.tsx
    │   ├── components/
    │   │   ├── WebhookForm.tsx
    │   │   ├── WebhookDeliveryLogTable.tsx
    │   │   └── EventTypeSelector.tsx
    │   ├── hooks/
    │   │   └── useWebhooks.ts
    │   └── services/
    │       └── webhookService.ts
    │
    ├── support/
    │   ├── pages/
    │   │   ├── SupportTicketListPage.tsx
    │   │   └── SupportTicketDetailPage.tsx
    │   ├── components/
    │   │   ├── TicketTable.tsx
    │   │   ├── TicketDetail.tsx
    │   │   ├── MessageThread.tsx
    │   │   ├── MessageComposer.tsx
    │   │   └── TicketStatusBadge.tsx
    │   ├── hooks/
    │   │   └── useSupportTickets.ts
    │   └── services/
    │       └── supportService.ts
    │
    ├── doubts/
    │   ├── pages/
    │   │   └── DoubtListPage.tsx
    │   ├── components/
    │   │   ├── DoubtTable.tsx
    │   │   └── DoubtThread.tsx
    │   ├── hooks/
    │   │   └── useDoubts.ts
    │   └── services/
    │       └── doubtService.ts
    │
    ├── media/
    │   ├── pages/
    │   │   └── MediaLibraryPage.tsx
    │   ├── components/
    │   │   ├── MediaGrid.tsx
    │   │   ├── MediaPreview.tsx
    │   │   └── MediaUsagePanel.tsx
    │   ├── hooks/
    │   │   └── useMedia.ts
    │   └── services/
    │       └── mediaService.ts
    │
    ├── reports/
    │   ├── pages/
    │   │   └── ReportGeneratorPage.tsx
    │   ├── components/
    │   │   ├── ReportTypeSelector.tsx
    │   │   ├── ReportFilterPanel.tsx
    │   │   └── ReportDownloadButton.tsx
    │   ├── hooks/
    │   │   └── useReports.ts
    │   └── services/
    │       └── reportService.ts
    │
    └── audit/
        ├── pages/
        │   └── AuditLogPage.tsx
        ├── components/
        │   ├── AuditLogTable.tsx
        │   ├── AuditLogFilter.tsx
        │   └── AuditLogDetail.tsx
        ├── hooks/
        │   └── useAuditLogs.ts
        └── services/
            └── auditService.ts

src/
├── shared/
│   ├── components/
│   │   ├── DataTable.tsx
│   │   ├── SearchBar.tsx
│   │   ├── FilterPanel.tsx
│   │   ├── Pagination.tsx
│   │   ├── ConfirmDialog.tsx
│   │   ├── EmptyState.tsx
│   │   ├── ErrorBoundary.tsx
│   │   ├── LoadingSpinner.tsx
│   │   ├── StatusBadge.tsx
│   │   ├── DateRangePicker.tsx
│   │   └── ExportButton.tsx
│   ├── hooks/
│   │   ├── useDebounce.ts
│   │   ├── usePagination.ts
│   │   ├── useFileUpload.ts
│   │   └── useSupabaseQuery.ts
│   ├── services/
│   │   ├── apiClient.ts
│   │   └── supabaseClient.ts
│   ├── types/
│   │   ├── admin.ts
│   │   ├── teacher.ts
│   │   ├── student.ts
│   │   ├── batch.ts
│   │   ├── question.ts
│   │   ├── mockTest.ts
│   │   ├── pyq.ts
│   │   ├── subscription.ts
│   │   ├── order.ts
│   │   ├── content.ts
│   │   ├── liveClass.ts
│   │   ├── notification.ts
│   │   ├── analytics.ts
│   │   ├── setting.ts
│   │   └── support.ts
│   └── utils/
│       ├── formatters.ts
│       ├── validators.ts
│       └── constants.ts
│
├── store/
│   ├── adminSlice.ts
│   └── hooks.ts
│
└── navigation/
    └── AdminTabNavigator.tsx
```

---

## Section 19: Development Priority

### 19.1 Priority Rankings

| Rank | Module | Priority | Rationale |
|------|--------|----------|-----------|
| 1 | **Dashboard** | CRITICAL | Landing page after login. Without it, admins cannot see metrics. All other modules depend on navigation from here. |
| 2 | **Academic Structure** | CRITICAL | Foundation for everything — streams, subjects, chapters must exist before teachers can create content or tests. |
| 3 | **User Management** | CRITICAL | Admins need to create/manage teachers and students before anything else. Authentication dependency. |
| 4 | **Batch Management** | CRITICAL | Delivery grouping structure. Teachers must be assigned to batches, students must be enrolled. |
| 5 | **Teacher Management** | CRITICAL | Core HR onboarding. Teachers must be hired, assigned specializations, and verified before they can teach. |
| 6 | **Student Management** | CRITICAL | Students must be created and enrolled before they can access content or attempt tests. |
| 7 | **Subscription Plans** | CRITICAL | Pricing and access control. Plans must be configured before subscriptions can be sold. Required for revenue. |
| 8 | **Orders & Payments** | CRITICAL | Financial operations. Order processing, refunds, invoice generation are core business functions. |
| 9 | **Student Subscriptions** | HIGH | Access control implementation. Must work with plans and orders. |
| 10 | **Content Management** | HIGH | Content approval workflow. Admins must review teacher-uploaded content. |
| 11 | **Approval Center** | HIGH | Unified approval queue. Central to admin workflow — content, tests, KYC all flow through here. |
| 12 | **Question Bank** | HIGH | Question approval and management. Prerequisite for mock tests. |
| 13 | **Mock Tests** | HIGH | Core product offering. Test management, publishing, result release. |
| 14 | **System Settings** | HIGH | Configuration management. Settings control thresholds, limits, and platform behavior. |
| 15 | **Analytics Dashboard** | HIGH | Data-driven decision making. Revenue, user growth, engagement metrics. |
| 16 | **PYQ Management** | MEDIUM | PYQ is a revenue stream but depends on questions and mock tests being built first. |
| 17 | **Live Classes** | MEDIUM | Admin oversight of live classes is important but teachers can self-manage their classes. Admin needs cancel and attendance override. |
| 18 | **Notifications** | MEDIUM | Admin can create broadcasts and manage templates. Important but not blocking. |
| 19 | **Feature Flags** | MEDIUM | Feature rollout management. Important for engineering but not business-critical. |
| 20 | **Reports** | MEDIUM | Data export and report generation. Needed for management but can be built after core modules. |
| 21 | **Support Tickets** | MEDIUM | Student support. Important for operations but not blocking. |
| 22 | **Doubts** | LOW | Academic Q&A oversight. Low priority — teachers handle day-to-day. |
| 23 | **Audit Logs** | LOW | Read-only view of immutable logs. Critical for compliance but low build priority. |
| 24 | **API Keys** | LOW | Developer tooling. Required for integrations but not for MVP. |
| 25 | **Webhooks** | LOW | External system integration. For future extensibility. |
| 26 | **Media Library** | LOW | Browse uploaded media. Nice-to-have but not blocking. |
| 27 | **Async Jobs** | LOW | Background job monitoring. For ops team, not business-critical. |
| 28 | **Institute Settings** | LOW | Changes infrequently. Plan tier management. |

---

## Section 20: Missing Features & Recommendations

### 20.1 Missing Tables

| # | Missing Table | Why It's Missing | Recommendation |
|---|---------------|------------------|----------------|
| 1 | `coupons` | Schema has `orders.coupon_code` VARCHAR but no dedicated table for coupon definition, validation rules, or usage tracking | Create `coupons` table: coupon_id, institute_id, code, discount_type (percentage/fixed), discount_value, max_uses, current_uses, valid_from, valid_until, min_order_amount, is_active |
| 2 | `teacher_payouts` | `teacher_employment_records` stores compensation configuration but no actual payout transaction record | Create `teacher_payouts` table: payout_id, teacher_id, employment_id, amount, period_start, period_end, status (pending/processed/failed), paid_at, bank_detail_id |
| 3 | `student_certificates` | `certificates` storage bucket exists but no DB table to track certificate metadata, generation status, or verifier | Create `student_certificates` table: certificate_id, student_id, template_id, metadata JSONB, generated_at, pdf_storage_path, verification_code |
| 4 | `notification_fanout_queue` | No queue table — fan-out is mentioned in comments but not implemented | Create or use `async_jobs` with task_name = 'notification_fanout' instead of a separate table |
| 5 | `mock_test_batches` | No junction table linking `mock_tests` to `batches` — tests are assigned by stream_id only | Create `mock_test_batches` table: test_id, batch_id, assigned_at, assigned_by |
| 6 | `dashboard_widget_preferences` | No table for admin dashboard widget configuration | Create `admin_dashboard_preferences` table: preference_id, profile_id, widget_config JSONB |

### 20.2 Missing RLS Policies

| # | Table | Issue | Recommendation |
|---|-------|-------|----------------|
| 1 | `audit_logs` | Only admin SELECT — no INSERT policy for system processes | Backend service_role bypass works, but explicit INSERT policy for system processes would be cleaner |
| 2 | `system_events_outbox` | Only admin access — outbox should allow INSERT from triggers for all roles | Add INSERT policy for authenticated users — triggers insert into outbox |
| 3 | `media_files` | Students can upload to media_files — but should only be for their own submissions | Current policy is adequate; ensure student uploads are scoped to `student-submissions` bucket only |
| 4 | `live_sessions` | Teachers can only SELECT, not INSERT — but teachers need to create sessions when starting a class | Add INSERT policy for teachers on live_sessions with check (teacher_id via live_classes join) |

### 20.3 Missing Relationships

| # | Missing Relationship | Tables | Recommendation |
|---|---------------------|--------|----------------|
| 1 | `mock_tests` → `batches` | No direct batch assignment | Create `mock_test_batches` junction table |
| 2 | `content` → `streams` | Content references `subject_id` (indirectly through chapter_id → subject_id → stream_id) but no direct stream FK | Denormalized `stream_id` on `content` for faster RLS and queries |
| 3 | `questions` → `teacher_details` via `created_by` | `created_by` references `teacher_details.teacher_id` — but admin-created questions would have no teacher reference | Allow `created_by` to also reference `profiles.profile_id` (NULL for system) or use a polymorphic reference |
| 4 | `notifications` → `batches` | No direct batch targeting on notifications | Add `target_batch_id` column for batch-scoped notifications |

### 20.4 Recommended Edge Functions

| # | Edge Function | Purpose | Tables Involved | Trigger |
|---|--------------|---------|-----------------|---------|
| 1 | `result-generation` | Compute mock results after submission | mock_attempts → mock_answers → mock_results | After INSERT/UPDATE on mock_attempts (status → submitted) |
| 2 | `notification-fanout` | Bulk create notification_recipients after notification created | notifications → notification_recipients | After INSERT on notifications |
| 3 | `subscription-renewal` | Process auto-renewal before end_date | student_subscriptions → payments → subscription_renewals | Cron job (nightly) |
| 4 | `grace-period-expiry` | Auto-expire grace period subscriptions | student_subscriptions → subscription_grace_periods | Cron job (daily) |
| 5 | `report-generation` | Generate PDF reports via async_jobs | All tables → async_jobs → storage | On INSERT to async_jobs |
| 6 | `analytics-nightly` | Refresh performance_reports, teacher_analytics, progress_history | All Domain 08 tables | Cron job (nightly) |
| 7 | `content-approval-update` | Update content.status when approval_requests is approved/rejected | approval_requests → content | After UPDATE on approval_requests |
| 8 | `question-approval-update` | Update questions.status when admin approves | questions | After UPDATE on questions (status → published) |
| 9 | `invoice-generation` | Generate invoice PDF after order confirmation | orders → invoices → storage | After UPDATE on orders (status → confirmed) |
| 10 | `media-transcoding` | Process video transcoding jobs | media_files → media_versions → media_processing_jobs | On INSERT to media_processing_jobs |
| 11 | `pyq-download` | Generate signed URLs for PYQ PDFs with access checks | student_pyq_purchases → pyq_papers → storage | On demand (GET request) |
| 12 | `teacher-analytics-refresh` | Recompute teacher_analytics for a specific teacher | Multiple tables → teacher_analytics | On demand or scheduled |
| 13 | `bulk-user-import` | Import users from CSV/Excel | profiles + student_details/teacher_details | On demand (admin upload) |
| 14 | `bulk-question-import` | Import questions from CSV/Excel | questions + question_options + question_explanations | On demand (admin upload) |
| 15 | `support-ticket-auto-assign` | Automatically assign tickets based on category/load | support_tickets | On INSERT to support_tickets |

### 20.5 Recommended APIs (Backend Services)

| # | Service | Purpose | Technology |
|---|---------|---------|------------|
| 1 | **Payment Gateway Integration** | Integrate with Razorpay/Stripe for payment processing | Edge Function + Webhook |
| 2 | **SMS Gateway** | Send SMS via MSG91 or similar (Edge Function exists at supabase/functions/send-msg91-otp/) | Edge Function |
| 3 | **Email Service** | Send transactional emails (SendGrid, Resend, etc.) | Edge Function |
| 4 | **Push Notification Service** | Send push notifications to mobile devices (Firebase FCM) | Edge Function |
| 5 | **Video Provider Integration** | Integrate with Daily/LiveKit/Agora for live classes | Edge Function |
| 6 | **Media Transcoding Service** | Video transcoding (FFmpeg, AWS MediaConvert) | Background Job |
| 7 | **PDF Generation Service** | Generate invoice PDFs, report PDFs, certificates | Edge Function |
| 8 | **Analytics Computation** | Nightly batch jobs for performance_reports, teacher_analytics | Cron + Edge Function |
| 9 | **Search Service** | Full-text search across content, questions, users | Meilisearch / Typesense |
| 10 | **Cache Layer** | Redis for caching RLS checks, settings, feature flags | Redis / Supabase Realtime |

### 20.6 Recommended Analytics

| # | Analytics Feature | Description | Implementation |
|---|------------------|-------------|----------------|
| 1 | **Real-time Dashboard** | Live metrics using Supabase Realtime subscriptions | Realtime on key tables |
| 2 | **Revenue Forecasting** | ML-based revenue prediction | External service |
| 3 | **Student Churn Prediction** | Identify at-risk students based on engagement patterns | ML model |
| 4 | **Teacher Performance Scoring** | Composite score from attendance, student scores, content quality | SQL view or materialized view |
| 5 | **Content Popularity Scoring** | Rank content by views, downloads, ratings | SQL aggregation |
| 6 | **Question Difficulty Calibration** | Auto-calibrate difficulty based on actual attempt data | Background job |
| 7 | **PYQ Chapter Frequency Analysis** | Show how often each chapter appears in actual exams | SQL aggregation on pyq_question_mappings |
| 8 | **Mock Test Comparison** | Compare class average vs national average per test | External benchmarking |
| 9 | **Custom Report Builder** | Admin can select metrics, date ranges, filters | Frontend + Edge Function |
| 10 | **Automated Email Reports** | Scheduled email delivery of key metrics | Cron + Email service |

### 20.7 Missing Admin Features (Not Directly in Schema)

| # | Feature | Recommendation | Rationale |
|---|---------|---------------|-----------|
| 1 | **Bulk User Import/Export** | Edge Function + File Upload | Required for onboarding large institutes |
| 2 | **Bulk Question Import** | CSV/Excel parser → INSERT into questions + options + explanations | Required for question bank population |
| 3 | **Coupon/Discount Management** | New `coupons` table + API | Currently only coupon_code VARCHAR on orders |
| 4 | **Teacher Payout Processing** | New `teacher_payouts` table + payment gateway integration | Payroll management |
| 5 | **Certificate Generation** | New `student_certificates` table + PDF generation | Completion certificates |
| 6 | **Custom Report Builder** | Edge Function + async_jobs for PDF generation | Admin reporting requirements |
| 7 | **Data Export (CSV/Excel)** | Backend service for all table exports | Admin data portability |
| 8 | **Scheduled Reports** | Cron-powered automated report generation | Management reporting |
| 9 | **Email Template Management** | Extend notification_templates with email-specific fields | Operational emails |
| 10 | **SMS Template Management** | Extend notification_templates with SMS-specific fields | SMS notifications |
| 11 | **IP Restriction for API Keys** | Add ip_allowlist to api_keys | Security hardening |
| 12 | **Rate Limiting** | Add rate_limits to api_keys or system_settings | Abuse prevention |
| 13 | **Maintenance Mode** | Add system_setting for maintenance mode toggle | Emergency downtime control |
| 14 | **Environment Switching** | Sandbox/Live mode toggle | Testing in production |

### 20.8 Future Improvements

| # | Improvement | Description | Timeline |
|---|-------------|-------------|----------|
| 1 | **Multi-Region Deployment** | Deploy Supabase project to multiple regions for low latency | Long-term |
| 2 | **Read Replicas** | Use Supabase read replicas for analytics queries | Medium-term |
| 3 | **Table Partitioning** | Implement RANGE partitioning on `audit_logs`, `mock_attempts`, `mock_answers`, `attendance_events`, `notification_recipients` | Medium-term (at scale) |
| 4 | **Materialized Views** | Create materialized views for common dashboard queries | Short-term |
| 5 | **Full-Text Search** | Add GIN indexes + tsvector columns for full-text search on questions, content, student_doubts | Short-term |
| 6 | **Event Sourcing** | Replace some audit patterns with full event sourcing | Long-term |
| 7 | **GraphQL API** | Expose PostGraphile or Hasura for frontend flexibility | Medium-term |
| 8 | **WebSocket/Realtime** | Use Supabase Realtime for live dashboard updates | Short-term |
| 9 | **Caching Layer** | Redis cache for RLS lookups, feature flags, settings | Short-term |
| 10 | **CDN for Media** | Integrate CDN for video streaming and large file distribution | Medium-term |

---

## Appendix A: Complete Table Inventory

| # | Table | Domain | Purpose | RLS | Admin Access |
|---|-------|--------|---------|-----|-------------|
| 1 | `institutes` | 01 — Foundation | Multi-tenant institute root entity | Yes | Full |
| 2 | `profiles` | 01 — Foundation | Central identity table (all roles) | Yes | Full |
| 3 | `teacher_details` | 01 — Foundation | Teacher-specific profile extension | Yes | Full |
| 4 | `student_details` | 01 — Foundation | Student-specific profile extension | Yes | Full |
| 5 | `streams` | 02 — Academic | Major exam/academic programme | Yes | Full |
| 6 | `subjects` | 02 — Academic | Academic discipline within a stream | Yes | Full |
| 7 | `chapters` | 02 — Academic | Named unit of syllabus | Yes | Full |
| 8 | `topics` | 02 — Academic | Sub-chapter granularity | Yes | Full |
| 9 | `batches` | 02 — Academic | Student delivery group | Yes | Full |
| 10 | `batch_students` | 02 — Academic | Batch-student enrollment junction | Yes | Full |
| 11 | `batch_teachers` | 02 — Academic | Batch-teacher assignment junction | Yes | Full |
| 12 | `content` | 03 — Content | Teacher-uploaded learning materials | Yes | Full |
| 13 | `tags` | 03 — Content | Flat vocabulary labels for content | Yes | Full |
| 14 | `content_tag` | 03 — Content | Content-tag junction | Yes | Full |
| 15 | `approval_requests` | 03 — Content | Polymorphic approval workflow | Yes | Full |
| 16 | `live_classes` | 04 — Live Learning | Schedulable live teaching unit | Yes | Full |
| 17 | `live_sessions` | 04 — Live Learning | Active provider session (1:1) | Yes | Full |
| 18 | `live_class_batch` | 04 — Live Learning | Live class-batch junction | Yes | Full |
| 19 | `recordings` | 04 — Live Learning | Recording metadata | Yes | Full |
| 20 | `session_participants` | 04 — Live Learning | Participant connection log | Yes | Full |
| 21 | `attendance` | 04 — Live Learning | Per-student per-class summary | Yes | Full |
| 22 | `attendance_events` | 04 — Live Learning | Raw join/leave event log | Yes | Full |
| 23 | `questions` | 05 — Assessment | Central question bank | Yes | Full |
| 24 | `question_options` | 05 — Assessment | Answer choices | Yes | Full |
| 25 | `question_explanations` | 05 — Assessment | Solution walkthrough (1:1) | Yes | Full |
| 26 | `question_images` | 05 — Assessment | Associated images | Yes | Full |
| 27 | `mock_tests` | 05 — Assessment | Configured test entity | Yes | Full |
| 28 | `mock_test_questions` | 05 — Assessment | Test-question junction | Yes | Full |
| 29 | `mock_attempts` | 05 — Assessment | Student test attempt | Yes | Full |
| 30 | `mock_answers` | 05 — Assessment | Per-question answer record | Yes | Full |
| 31 | `mock_answer_options` | 05 — Assessment | Selected options for an answer | Yes | Full |
| 32 | `mock_results` | 05 — Assessment | Computed result (1:1) | Yes | Full |
| 33 | `pyq_packages` | 06 — PYQ | Sellable PYQ bundle | Yes | Full |
| 34 | `pyq_package_unlocks` | 06 — PYQ | Asset type unlock enumeration | Yes | Full |
| 35 | `pyq_papers` | 06 — PYQ | Individual exam paper | Yes | Full |
| 36 | `pyq_question_mappings` | 06 — PYQ | Paper-question junction | Yes | Full |
| 37 | `pyq_solutions` | 06 — PYQ | Per-paper per-question solution | Yes | Full |
| 38 | `pyq_mock_mappings` | 06 — PYQ | Paper-mocktest 1:1 junction | Yes | Full |
| 39 | `student_pyq_purchases` | 06 — PYQ | Student PYQ access control | Yes | Full |
| 40 | `orders` | 07 — Commerce | Root financial entity | Yes | Full |
| 41 | `order_items` | 07 — Commerce | Order line items (polymorphic) | Yes | Full |
| 42 | `payments` | 07 — Commerce | Payment gateway attempts | Yes | Full |
| 43 | `invoices` | 07 — Commerce | GST/tax invoice (1:1) | Yes | Full |
| 44 | `performance_reports` | 08 — Analytics | Student performance snapshot | Yes | Full |
| 45 | `subject_performances` | 08 — Analytics | Subject-level breakdown | Yes | Full |
| 46 | `chapter_performances` | 08 — Analytics | Chapter-level breakdown | Yes | Full |
| 47 | `progress_history` | 08 — Analytics | Append-only attempt log | Yes | Full |
| 48 | `teacher_analytics` | 08 — Analytics | Teacher dashboard metrics (1:1) | Yes | Full |
| 49 | `notification_templates` | 09 — Notifications | Reusable message blueprints | Yes | Full |
| 50 | `notifications` | 09 — Notifications | Concrete dispatched notification | Yes | Full |
| 51 | `notification_recipients` | 09 — Notifications | Per-user notification (junction) | Yes | Full |
| 52 | `audit_logs` | 10 — Administration | Immutable action audit trail | Yes | SELECT only |
| 53 | `system_settings` | 10 — Administration | Per-institute key-value config | Yes | Full |
| 54 | `subscription_features` | 11 — Subscription | Master feature catalogue | Yes | Full |
| 55 | `subscription_plans` | 11 — Subscription | Priced subscription products | Yes | Full |
| 56 | `plan_unlocks` | 11 — Subscription | Plan-feature junction | Yes | Full |
| 57 | `student_subscriptions` | 11 — Subscription | Student subscription core | Yes | Full |
| 58 | `subscription_history` | 11 — Subscription | Status transition audit trail | Yes | Full |
| 59 | `subscription_renewals` | 11 — Subscription | Renewal attempt records | Yes | Full |
| 60 | `subscription_cancellations` | 11 — Subscription | Cancellation details | Yes | Full |
| 61 | `subscription_grace_periods` | 11 — Subscription | Grace period tracking | Yes | Full |
| 62 | `subscription_usage` | 11 — Subscription | Feature usage counters | Yes | Full |
| 63 | `media_files` | 12 — Media | Logical media asset catalog | Yes | Full |
| 64 | `media_versions` | 12 — Media | Physical file renditions | Yes | Full |
| 65 | `media_usage` | 12 — Media | Polymorphic media usage tracking | Yes | Full |
| 66 | `media_processing_jobs` | 12 — Media | Async processing job tracking | Yes | Full |
| 67 | `teacher_employment_records` | 13 — Teacher HR | Core HR/compensation record (1:1) | Yes | Full (admin-only RLS) |
| 68 | `teacher_specializations` | 13 — Teacher HR | Subject authorizations (M:N) | Yes | Full |
| 69 | `teacher_qualifications` | 13 — Teacher HR | Academic credentials | Yes | Full |
| 70 | `teacher_experiences` | 13 — Teacher HR | Work history | Yes | Full |
| 71 | `teacher_documents` | 13 — Teacher HR | KYC document metadata | Yes | Full |
| 72 | `teacher_bank_details` | 13 — Teacher HR | Payout bank info (1:1) | Yes | Full (admin-only RLS) |
| 73 | `teacher_availability` | 13 — Teacher HR | Weekly schedule | Yes | Full |
| 74 | `teacher_leave_requests` | 13 — Teacher HR | Time-off workflow | Yes | Full |
| 75 | `student_bookmarks` | 14 — Student Services | Saved content | Yes | Full |
| 76 | `student_downloads` | 14 — Student Services | DRM offline tracking | Yes | Full |
| 77 | `student_viewing_history` | 14 — Student Services | Resume playback tracking | Yes | Full |
| 78 | `student_personal_notes` | 14 — Student Services | Timestamp-linked annotations | Yes | Full |
| 79 | `student_doubts` | 14 — Student Services | Academic Q&A core | Yes | Full |
| 80 | `doubt_replies` | 14 — Student Services | Threaded Q&A replies | Yes | Full |
| 81 | `support_tickets` | 14 — Student Services | Helpdesk tickets | Yes | Full |
| 82 | `support_ticket_messages` | 14 — Student Services | Ticket conversation log | Yes | Full |
| 83 | `student_feedback_ratings` | 14 — Student Services | 1-5 star ratings | Yes | Full |
| 84 | `api_keys` | 15 — Infrastructure | Programmatic access tokens | Yes | Full (admin-only RLS) |
| 85 | `webhook_endpoints` | 15 — Infrastructure | Outbound webhook config | Yes | Full (admin-only RLS) |
| 86 | `webhook_delivery_logs` | 15 — Infrastructure | Delivery audit log | Yes | Full (admin-only RLS) |
| 87 | `async_jobs` | 15 — Infrastructure | App-level job queue | Yes | Full (admin-only RLS) |
| 88 | `feature_flags` | 15 — Infrastructure | Global feature toggles | Yes | Full (admin-only RLS) |
| 89 | `feature_flag_overrides` | 15 — Infrastructure | Per-institute overrides | Yes | Full (admin-only RLS) |
| 90 | `system_events_outbox` | 15 — Infrastructure | Transactional outbox | Yes | Full (admin-only RLS) |

---

## Appendix B: Complete Enum Reference

| Enum Name | Values | Used In | Migration |
|-----------|--------|---------|-----------|
| `user_role` | admin, teacher, student | profiles | 002 |
| `lifecycle_status` | draft, pending_review, approved, rejected, archived | content | 002 |
| `content_type` | pdf, video, notes, assignment | content | 002 |
| `question_type` | mcq, msq, numerical, true_false | questions | 002 |
| `question_source_type` | teacher, pyq, imported | questions | 002 |
| `difficulty_level` | easy, medium, hard | questions | 002 |
| `batch_status` | upcoming, active, completed, archived | batches | 002 |
| `subscription_status` | active, expired, cancelled | (deprecated — replaced by subscription_status_type) | 002 |
| `payment_status` | pending, captured, failed, refunded, partially_refunded | payments | 002 |
| `order_status` | pending, confirmed, cancelled, refunded | orders | 002 |
| `invoice_status` | draft, issued, cancelled | invoices | 002 |
| `item_type` | subscription_plan, pyq_package | order_items | 002 |
| `payment_gateway` | razorpay, stripe, payu, cashfree | payments | 002 |
| `live_class_status` | draft, scheduled, live, completed, cancelled | live_classes | 002 |
| `live_session_status` | waiting, live, ended | live_sessions | 002 |
| `recording_status` | queued, processing, completed, failed | recordings | 002 |
| `attempt_status` | in_progress, submitted, abandoned, timed_out | mock_attempts | 002 |
| `platform_type` | web, android, ios | (device tracking) | 002 |
| `device_type` | mobile, tablet, desktop | (device tracking) | 002 |
| `approval_resource_type` | content, mock_test | approval_requests | 002 |
| `approval_status` | pending, approved, rejected | approval_requests | 002 |
| `notification_channel` | in_app, push, email, sms | notifications, notification_templates | 002 |
| `image_role` | question, option, explanation | question_images | 002 |
| `question_status` | draft, pending_approval, published, archived | questions | 006 |
| `mock_test_status` | draft, pending_approval, published, archived | mock_tests | 006 |
| `currency_code` | INR, USD, AED, GBP | orders, payments, invoices, subscription_plans | 008 |
| `report_period_type` | weekly, monthly, all_time | performance_reports | 009 |
| `notification_event_type` | live_class_reminder, test_published, result_available, content_approved, content_rejected, subscription_expiring, subscription_expired, new_content_uploaded, batch_assigned, announcement, custom | notifications, notification_templates | 010 |
| `audit_action_type` | create, update, delete, soft_delete, restore, publish, unpublish, approve, reject, login, logout, enroll, unenroll, purchase, refund, export, import, view_sensitive | audit_logs | 011 |
| `setting_data_type` | string, integer, decimal, boolean, json, uuid, date | system_settings | 011 |
| `subscription_status_type` | pending, active, grace, expired, cancelled, refunded | student_subscriptions | 012 |
| `subscription_change_reason_type` | new_purchase, renewal, upgrade, downgrade, manual_activation, payment_failure, payment_recovery, admin_action, expiry, cancellation, refund | subscription_history | 012 |
| `cancellation_reason_type` | student_request, admin_action, payment_failure_unresolved, fraud_detected, institute_deactivated, plan_discontinued | subscription_cancellations | 012 |
| `grace_period_resolution_type` | payment_recovered, expired_no_payment, admin_waived, cancelled | subscription_grace_periods | 012 |
| `plan_billing_cycle_type` | monthly, quarterly, half_yearly, yearly, lifetime, custom | subscription_plans | 012 |
| `feature_category_type` | live_classes, recorded_classes, mock_tests, pyq_papers, notes, assignments, analytics, downloads, premium_support, batch_access, api_access | subscription_features | 012 |
| `media_asset_type` | video, image, document, audio, archive | media_files | 013 |
| `media_status_type` | pending, processing, ready, failed, archived | media_files | 013 |
| `media_access_type` | public, private, requires_signature | media_files | 013 |
| `job_category_type` | video_transcode, image_compress, pdf_watermark, thumbnail_extract | media_processing_jobs | 013 |
| `job_status_type` | queued, running, completed, failed, retrying | media_processing_jobs | 013 |
| `employment_type` | full_time, part_time, contract, freelance | teacher_employment_records | 014 |
| `salary_basis_type` | monthly_fixed, hourly_rate, revenue_share, per_class | teacher_employment_records | 014 |
| `verification_status_type` | pending, verified, rejected | teacher_documents, teacher_bank_details | 014 |
| `document_category_type` | identity_proof, address_proof, education_cert, contract, cancelled_cheque | teacher_documents | 014 |
| `day_of_week_type` | monday, tuesday, wednesday, thursday, friday, saturday, sunday | teacher_availability | 014 |
| `leave_category_type` | casual, sick, unpaid, maternity_paternity, compensatory | teacher_leave_requests | 014 |
| `leave_status_type` | pending, approved, rejected, cancelled | teacher_leave_requests | 014 |
| `resource_category_type` | content, question, live_class, pyq_paper, mock_test, teacher | student_bookmarks, student_downloads, student_viewing_history, student_personal_notes, student_doubts, student_feedback_ratings | 015 |
| `doubt_status_type` | open, in_progress, resolved, archived | student_doubts | 015 |
| `ticket_category_type` | billing, technical, academic, account, other | support_tickets | 015 |
| `ticket_status_type` | open, in_progress, waiting_on_student, resolved, closed | support_tickets | 015 |
| `ticket_priority_type` | low, medium, high, urgent | support_tickets | 015 |
| `async_job_status_type` | queued, processing, completed, failed, retrying, cancelled | async_jobs | 016 |
| `webhook_status_type` | pending, success, failed, retrying | webhook_delivery_logs | 016 |
| `outbox_status_type` | pending, published, failed | system_events_outbox | 016 |

---

## Appendix C: Key Triggers Summary

| Trigger Name | Table | Function | Purpose | Migration |
|-------------|-------|----------|---------|-----------|
| `trg_institutes_set_updated_at` | institutes | set_updated_at | Auto-update updated_at on change | 002 |
| `trg_profiles_set_updated_at` | profiles | set_updated_at | Auto-update updated_at on change | 002 |
| `trg_teacher_details_check_role` | teacher_details | check_teacher_role | Ensure FK profile has role = 'teacher' | 002 |
| `trg_student_details_check_role` | student_details | check_student_role | Ensure FK profile has role = 'student' | 002 |
| `on_auth_user_created` | auth.users | handle_new_user | Auto-create profile on signup | 002 |
| `trg_content_set_updated_at` | content | set_updated_at | Auto-update updated_at on change | 004 |
| `trg_approval_validate_resource` | approval_requests | trgfn_approval_validate_resource | Verify resource_id exists in correct table | 004 |
| `trg_live_classes_set_updated_at` | live_classes | set_updated_at | Auto-update updated_at on change | 005 |
| `trg_questions_set_updated_at` | questions | set_updated_at | Auto-update updated_at on change | 006 |
| `trg_mock_tests_set_updated_at` | mock_tests | set_updated_at | Auto-update updated_at on change | 006 |
| `trg_orders_set_updated_at` | orders | set_updated_at | Auto-update updated_at on change | 008 |
| `trg_payments_set_updated_at` | payments | set_updated_at | Auto-update updated_at on change | 008 |
| `trg_performance_reports_set_updated_at` | performance_reports | set_updated_at | Auto-update updated_at on change | 009 |
| `trg_notification_templates_set_updated_at` | notification_templates | set_updated_at | Auto-update updated_at on change | 010 |
| `trg_notifications_set_deleted_at` | notifications | trgfn_notifications_set_deleted_at | Auto-set deleted_at on is_deleted toggle | 010 |
| `trg_audit_logs_prevent_update` | audit_logs | trgfn_audit_logs_prevent_update | Block UPDATE (immutability enforcement) | 011 |
| `trg_audit_logs_prevent_delete` | audit_logs | trgfn_audit_logs_prevent_delete | Block DELETE (immutability enforcement) | 011 |
| `trg_system_settings_protect` | system_settings | trgfn_system_settings_protect | Protect key, data_type, is_system from change | 011 |
| `trg_student_subscriptions_validate_status` | student_subscriptions | trgfn_subscription_validate_status | Enforce valid status transitions | 012 |
| `trg_student_subscriptions_auto_history` | student_subscriptions | trgfn_subscription_auto_history | Auto-write history on status change | 012 |
| `trg_student_subscriptions_check_capacity` | student_subscriptions | trgfn_subscription_check_capacity | Prevent overselling max_students | 012 |
| `trg_media_versions_maintain_total_size` | media_versions | trgfn_media_maintain_total_size | Update media_files.total_size_bytes | 013 |
| `trg_teacher_availability_no_overlap` | teacher_availability | trgfn_teacher_availability_no_overlap | Prevent overlapping time slots | 014 |
| `trg_teacher_leave_requests_no_overlap` | teacher_leave_requests | trgfn_teacher_leave_no_overlap | Prevent overlapping leave dates | 014 |
| `trg_doubt_replies_auto_resolve` | doubt_replies | trgfn_doubt_auto_resolve | Auto-resolve doubt on accepted answer | 015 |
| `trg_support_ticket_messages_auto_status` | support_ticket_messages | trgfn_ticket_auto_status | Auto-update ticket status on message | 015 |
| `trg_webhook_endpoints_prevent_active_deletion` | webhook_endpoints | trgfn_webhook_prevent_active_deletion | Prevent delete with undelivered logs | 016 |

---

## Appendix D: Storage Buckets Summary

| Bucket | Public | Max File Size | Allowed MIME Types | Access Pattern | Migration |
|--------|--------|---------------|-------------------|----------------|-----------|
| `profile-images` | No | 10 MB | image/jpeg, image/png, image/webp | Signed URLs | 022 |
| `teacher-documents` | No | 25 MB | PDF, JPEG, PNG, WebP, DOC, DOCX | Signed URLs (admin/self) | 022 |
| `content-pdfs` | No | 100 MB | application/pdf | Signed URLs (auth required) | 022 |
| `content-videos` | No | 5 GB | video/mp4, video/webm, video/quicktime | Signed URLs (auth required) | 022 |
| `content-thumbnails` | **Yes** | 10 MB | image/jpeg, image/png, image/webp | Public access | 022 |
| `student-submissions` | No | 100 MB | PDF, DOC, DOCX, XLSX, JPEG, PNG, WebP | Signed URLs (self/admin) | 022 |
| `mock-test-assets` | No | 25 MB | image/jpeg, image/png, image/webp | Signed URLs (auth required) | 022 |
| `recordings` | No | 10 GB | video/mp4, video/webm, video/quicktime | Signed URLs (enrolled students) | 022 |
| `certificates` | No | 20 MB | PDF, JPEG, PNG, WebP | Signed URLs (student/admin) | 022 |
| `system-assets` | **Yes** | 10 MB | JPEG, PNG, WebP, SVG | Public access | 022 |

---

## Appendix E: Edge Function Inventory (Existing)

| Function | Location | Purpose | Runtime |
|---------|----------|---------|---------|
| `send-msg91-otp` | supabase/functions/send-msg91-otp/ | Send OTP via MSG91 SMS gateway | Deno |
| Config files: `config.ts`, `sms-provider.ts` | supabase/functions/send-msg91-otp/ | SMS provider configuration | Deno |

**Source:** supabase/functions directory (migration 024 mentions `send-msg91-otp`)

---

## Appendix F: RLS Policy Count by Domain

| Domain | Tables | Total Policies | Admin Policies |
|--------|--------|---------------|----------------|
| 01 — Foundation | 4 | 10 | 3 |
| 02 — Academic Structure | 7 | 13 | 7 |
| 03 — Content Management | 4 | 11 | 4 |
| 04 — Live Learning | 7 | 20 | 7 |
| 05 — Assessment | 10 | 30 | 10 |
| 06 — PYQ | 7 | 12 | 7 |
| 07 — Commerce | 4 | 8 | 4 |
| 08 — Analytics | 5 | 11 | 5 |
| 09 — Notifications | 3 | 7 | 3 |
| 10 — Administration | 2 | 6 | 2 |
| 11 — Subscription & Access Control | 9 | 18 | 9 |
| 12 — File & Media Management | 4 | 10 | 4 |
| 13 — Teacher Management (HR) | 8 | 16 | 8 |
| 14 — Student Services | 9 | 20 | 9 |
| 15 — Infrastructure | 7 | 8 | 7 |

**Total:** 90 tables, 200+ RLS policies, every table has exactly 1 admin policy granting `FOR ALL` to `public.is_admin()`.

---

## Appendix G: Helper Functions Summary

| Function | Purpose | Returns | Used By | Migration |
|----------|---------|---------|---------|-----------|
| `set_updated_at()` | Auto-set updated_at on UPDATE | TRIGGER | All tables with updated_at | 002 |
| `get_my_institute_id()` | Get current user's institute_id | UUID | All RLS policies | 002 |
| `check_teacher_role()` | Validate profile has role = 'teacher' | TRIGGER | teacher_details trigger | 002 |
| `check_student_role()` | Validate profile has role = 'student' | TRIGGER | student_details trigger | 002 |
| `handle_new_user()` | Auto-create profile on auth.users INSERT | TRIGGER | auth.users trigger | 002, 024 |
| `is_admin()` | Check current user is admin | BOOLEAN | All admin RLS policies | 021 |
| `is_teacher()` | Check current user is teacher | BOOLEAN | Teacher RLS policies | 021 |
| `is_student()` | Check current user is student | BOOLEAN | Student RLS policies | 021 |
| `get_my_teacher_id()` | Get current user's teacher_id | UUID | Teacher RLS policies | 021 |
| `get_my_student_id()` | Get current user's student_id | UUID | Student RLS policies | 021 |
| `trgfn_approval_validate_resource()` | Validate polymorphic resource_id | TRIGGER | approval_requests | 004 |
| `trgfn_notifications_set_deleted_at()` | Auto-set deleted_at | TRIGGER | notifications | 010 |
| `trgfn_audit_logs_prevent_update()` | Block audit_log UPDATE | TRIGGER | audit_logs | 011 |
| `trgfn_audit_logs_prevent_delete()` | Block audit_log DELETE | TRIGGER | audit_logs | 011 |
| `trgfn_system_settings_protect()` | Protect immutable settings fields | TRIGGER | system_settings | 011 |
| `trgfn_subscription_validate_status()` | Validate status transitions | TRIGGER | student_subscriptions | 012 |
| `trgfn_subscription_auto_history()` | Auto-write subscription_history | TRIGGER | student_subscriptions | 012 |
| `trgfn_subscription_check_capacity()` | Prevent overselling max_students | TRIGGER | student_subscriptions | 012 |
| `trgfn_media_maintain_total_size()` | Update total_size_bytes | TRIGGER | media_versions | 013 |
| `trgfn_teacher_availability_no_overlap()` | Prevent overlapping slots | TRIGGER | teacher_availability | 014 |
| `trgfn_teacher_leave_no_overlap()` | Prevent overlapping leave | TRIGGER | teacher_leave_requests | 014 |
| `trgfn_doubt_auto_resolve()` | Auto-resolve on accepted answer | TRIGGER | doubt_replies | 015 |
| `trgfn_ticket_auto_status()` | Auto-update ticket status | TRIGGER | support_ticket_messages | 015 |
| `trgfn_webhook_prevent_active_deletion()` | Protect webhooks with pending logs | TRIGGER | webhook_endpoints | 016 |

---

**End of Admin Dashboard Functional Specification**
