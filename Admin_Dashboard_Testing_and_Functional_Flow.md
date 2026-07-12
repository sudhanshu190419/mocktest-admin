# Admin Dashboard — Testing & Functional Flow

> **Document Version:** 1.0
> **Prepared for:** QA Team, Developers, Product Managers
> **Last Updated:** July 8, 2026
> **Scope:** Complete Admin Dashboard — all modules, workflows, test cases, and acceptance criteria
> **Derived From:** Admin_Dashboard_Functional_Specification.md v2.0, Supabase Migrations 001–025, Teacher Dashboard Phase 1

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Module-by-Module Functional Flow](#2-module-by-module-functional-flow)
3. [Screen Flow](#3-screen-flow)
4. [User Journeys](#4-user-journeys)
5. [Manual Test Cases](#5-manual-test-cases)
6. [Validation Checklist](#6-validation-checklist)
7. [Business Rule Verification](#7-business-rule-verification)
8. [Database Verification Checklist](#8-database-verification-checklist)
9. [UI Testing Checklist](#9-ui-testing-checklist)
10. [Security Testing Checklist](#10-security-testing-checklist)
11. [Performance Testing Checklist](#11-performance-testing-checklist)
12. [Error Scenarios](#12-error-scenarios)
13. [Acceptance Criteria](#13-acceptance-criteria)
14. [Module Completion Matrix](#14-module-completion-matrix)
15. [Production Readiness Report](#15-production-readiness-report)
16. [Phase 2 Roadmap](#16-phase-2-roadmap)

---

## 1. Project Overview

### 1.1 What is the Admin Dashboard?

The Admin Dashboard is a web-based management interface built with Next.js (App Router), React, TypeScript, and Tailwind CSS, backed by Supabase (PostgreSQL + Auth + Storage). It enables institute administrators to manage every aspect of their educational institute from a single, unified console.

The Admin Dashboard is the **administrative backbone** of the EdTech platform, providing complete visibility and control over teachers, students, academic content, assessments, finances, and system configuration.

### 1.2 Primary Users

| User Type | Description | Scope |
|-----------|-------------|-------|
| **Super Admin** | System-level administrator | Access across all institutes, system-level configuration |
| **Institute Admin** | Per-institute administrator | Full access within their own institute's scope |

### 1.3 System Responsibilities

The Admin Dashboard is responsible for:

1. **Institute Management** — Configure institute settings, branding, plan tier
2. **User Management** — Create, manage, activate/deactivate teachers and students
3. **Academic Structure** — Define streams, subjects, chapters, and topics
4. **Batch Management** — Create batches, assign teachers, enroll students
5. **Content Oversight** — Approve/reject teacher-uploaded content, manage tags
6. **Question Bank** — Create, approve, edit, and manage questions
7. **Mock Test Management** — Create, publish, archive tests; release results
8. **Assessment Oversight** — View results, generate reports, manage leaderboards
9. **Teacher HR** — Manage employment, documents, qualifications, leave, payroll
10. **Student Services** — View performance, manage subscriptions, handle issues
11. **Commerce** — Manage orders, payments, refunds, invoices
12. **Subscription Management** — Create plans, manage student subscriptions
13. **PYQ Management** — Create packages, upload papers, manage sales
14. **Live Classes** — View across all teachers, manage recordings
15. **Notifications** — Create broadcasts, manage templates
16. **Analytics & Reports** — Generate revenue, performance, and growth reports
17. **System Configuration** — Manage settings, feature flags, API keys, webhooks
18. **Audit & Compliance** — View immutable audit trail
19. **Support** — Manage support tickets and student doubts

### 1.4 Relationship with Other Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Admin Dashboard                          │
│              (Single Institute Console)                     │
└────────────────────┬────────────────────────────────────┘
                     │ Manages
     ┌───────────────┼───────────────┐
     ▼               ▼               ▼
┌─────────┐   ┌───────────┐   ┌──────────┐
│Teachers │   │ Students  │   │ Content  │
│Dashboard│   │   App     │   │  Library │
└─────────┘   └───────────┘   └──────────┘
     │               │               │
     └───────────────┼───────────────┘
                     ▼
          ┌──────────────────┐
          │   Supabase DB    │
          │ (All 15 Domains) │
          └──────────────────┘
```

- **Teacher Dashboard**: Teachers create content, questions, mock tests, and conduct live classes. Admin approves/rejects their work, manages their HR records, and monitors their performance.
- **Student App**: Students attempt mock tests, view results, attend live classes, and purchase subscriptions. Admin manages their lifecycle, monitors performance, and handles support.
- **Database**: All 15 Domains are managed through the Admin Dashboard. The admin has full CRUD permissions on all tables within their institute scope.

### 1.5 High-Level Business Workflow

```
Super Admin creates Institute
         │
         ▼
Admin configures Institute Settings (branding, plan tier)
         │
         ▼
Admin creates Academic Structure (Streams → Subjects → Chapters → Topics)
         │
         ▼
Admin creates Teachers → Assign subjects → Assign batches → Teacher onboarded
         │
         ▼
Admin creates Students → Enroll in batches → Grant subscriptions
         │
         ▼
Teachers create Content → Admin approves/rejects → Content visible to students
         │
         ▼
Teachers create Questions → Admin approves → Questions in bank
         │
         ▼
Teachers create Mock Tests → Admin approves/publishes → Students attempt
         │
         ▼
Results computed → Admin releases results → Students view scores
         │
         ▼
Analytics & Reports generated → Revenue tracking → System monitoring
```

### 1.6 Module Summary

| # | Module | Purpose | Priority |
|---|--------|---------|----------|
| 1 | **Dashboard** | Aggregate overview of institute health | Critical |
| 2 | **Institute Management** | Configure institute settings and branding | Critical |
| 3 | **Teacher Management** | Full lifecycle management of teachers | Critical |
| 4 | **Student Management** | Full lifecycle management of students | Critical |
| 5 | **Academic Structure** | Define streams, subjects, chapters, topics | Critical |
| 6 | **Batch Management** | Create and manage student batches | Critical |
| 7 | **Content Management** | Oversee and approve educational content | Critical |
| 8 | **Question Bank** | Manage assessment questions | Critical |
| 9 | **Mock Test Management** | Create and manage assessments | Critical |
| 10 | **Results & Analytics** | View and release test results | High |
| 11 | **Approval Center** | Unified approval queue | Critical |
| 12 | **PYQ Management** | Manage previous year question papers | High |
| 13 | **Live Classes** | Oversee live class delivery | Medium |
| 14 | **Attendance** | Monitor class attendance | Medium |
| 15 | **Subscription Plans** | Create and manage subscription tiers | High |
| 16 | **Student Subscriptions** | Manage student plan enrollments | High |
| 17 | **Orders & Payments** | View and manage financial transactions | High |
| 18 | **Notifications** | Create and manage communications | High |
| 19 | **Teacher HR** | Manage HR records, KYC, leave, payroll | High |
| 20 | **Student Services** | Doubts, support tickets, feedback | Medium |
| 21 | **System Settings** | Configure platform settings | Critical |
| 22 | **Feature Flags** | Toggle feature availability | High |
| 23 | **API Keys & Webhooks** | Manage integrations | Medium |
| 24 | **Audit Logs** | View platform activity trail | Critical |
| 25 | **Reports** | Generate and export reports | High |
| 26 | **Support Tickets** | Manage student support requests | Medium |
| 27 | **Media Library** | Browse and manage uploaded media | Medium |

---

## 2. Module-by-Module Functional Flow

### 2.1 Dashboard

**Purpose:** Provide at-a-glance overview of institute health with key metrics and quick actions.

**Business Objective:** Enable quick decision-making by surfacing the most important metrics and pending actions in one place.

**Workflow:**
```
Admin logs in
     │
     ▼
Dashboard loads
     │
     ├── Fetch Total Students count
     ├── Fetch Total Teachers count
     ├── Fetch Total Revenue (MTD)
     ├── Fetch Active Subscriptions count
     ├── Fetch Published Mock Tests count
     ├── Fetch Active Batches count
     ├── Fetch Live Classes Today count
     ├── Fetch Pending Approvals (content, questions, tests)
     ├── Fetch Pending Teacher KYC count
     ├── Fetch Pending Leave Requests count
     ├── Fetch Recent Registrations
     ├── Fetch Recent Payments
     ├── Fetch System Health status
     ├── Render Quick Stats Row
     ├── Render Pending Approvals Panel
     ├── Render Quick Actions Grid
     ├── Render Revenue Trend Chart (6-month)
     ├── Render Student Growth Chart (6-month)
     ├── Render Recent Activity Feed
     ├── Render Upcoming Live Classes
     └── Render System Health Banner
```

**Dependencies:** All modules (data sources), Authentication.

**Expected Result:**
- All widgets display accurate data within 2 seconds
- Quick actions navigate to correct management screens
- Charts render with correct data and formatting
- System health banner shows green/red status

---

### 2.2 Institute Management

**Purpose:** Configure institute profile, branding, and plan tier.

**Business Objective:** Maintain institute identity and ensure compliance with plan limitations.

**Workflow:**
```
Admin navigates to Institute Settings
     │
     ├── View current institute profile
     │     ├── Institute name, slug, domain
     │     ├── Logo URL
     │     ├── Plan tier (starter / growth / enterprise)
     │     ├── Contact information
     │     └── is_active status
     │
     ├── Edit institute settings
     │     ├── Update name, slug, domain
     │     ├── Upload new logo
     │     ├── Change plan tier
     │     └── Toggle active/inactive
     │
     └── Save changes
           │
           ├── Success → Toast confirmation, profile updated
           └── Error → Error message displayed
```

**Dependencies:** Authentication, Super Admin privileges.

**Expected Result:**
- Institute settings updated immediately
- Plan tier change affects feature availability
- Logo update appears across all institute-facing pages
- Status change (active/inactive) takes effect immediately

---

### 2.3 Teacher Management

**Purpose:** Full lifecycle management of teachers — creation, HR, verification, assignments, and monitoring.

**Business Objective:** Build and maintain a quality teaching workforce with compliant HR records.

**Workflow:**
```
Teacher List
     │
     ├── View all teachers (search, filter by status/department/batch)
     │
     ├── Create Teacher
     │     ├── Fill personal details (name, phone, email)
     │     ├── Set department and designation
     │     ├── Set employment type and salary
     │     ├── Assign subject specializations
     │     ├── Assign to batches
     │     └── Save → Teacher created + auth credentials
     │
     ├── Teacher Profile
     │     ├── View full profile with stats
     │     ├── View employment record
     │     ├── View specializations
     │     ├── View qualifications (verify)
     │     ├── View experience (verify)
     │     ├── View documents (verify/reject)
     │     ├── View bank details (verify)
     │     ├── View availability calendar
     │     ├── View leave requests (approve/reject)
     │     ├── View analytics and performance
     │     ├── View batch assignments
     │     └── View activity log
     │
     ├── Edit Teacher
     │     ├── Update personal details
     │     ├── Update employment terms
     │     └── Save changes
     │
     ├── Activate/Deactivate
     │     ├── Confirm action
     │     └── Status updated immediately
     │
     └── Reset Password
           ├── Confirm action
           └── New credentials generated
```

**Dependencies:** Authentication, Institute, Academic Structure, Batches.

**Expected Result:**
- Teacher created successfully with working credentials
- HR records fully visible and editable
- KYC documents verifiable with status tracking
- Leave requests reviewable with approval/rejection workflow
- Teacher deactivation prevents login immediately

---

### 2.4 Student Management

**Purpose:** Full lifecycle management of students — creation, enrollment, performance monitoring, and services.

**Business Objective:** Grow and serve the student population with efficient management tools.

**Workflow:**
```
Student List
     │
     ├── View all students (search, filter by batch/status/date)
     │
     ├── Create Student
     │     ├── Fill personal details (name, phone)
     │     ├── Set enrollment number
     │     ├── Set target year and stream
     │     └── Save → Student created
     │
     ├── Bulk Import Students
     │     ├── Download CSV template
     │     ├── Upload CSV/Excel file
     │     ├── Validate all rows
     │     ├── Preview results
     │     └── Confirm import
     │
     ├── Student Profile
     │     ├── View personal details
     │     ├── View batch enrollments
     │     ├── View performance reports
     │     ├── View subject/chapter breakdown
     │     ├── View progress history
     │     ├── View attendance records
     │     ├── View order/subscription history
     │     ├── View PYQ purchases
     │     ├── View doubts and support tickets
     │     └── View bookmarks and downloads
     │
     ├── Edit Student
     │     └── Update personal details
     │
     ├── Enroll in Batch
     │     ├── Select batch
     │     ├── Verify capacity available
     │     └── Confirm enrollment
     │
     ├── Transfer Batch
     │     ├── Select new batch
     │     └── Confirm transfer
     │
     └── Activate/Deactivate
```

**Dependencies:** Authentication, Institute, Academic Structure, Batches.

**Expected Result:**
- Student created with unique enrollment number
- Batch enrollment respects capacity limits
- Performance data displays correctly
- Bulk import processes 1000+ students successfully

---

### 2.5 Academic Structure

**Purpose:** Define and manage the 4-level academic hierarchy.

**Business Objective:** Organize curriculum in a structured, searchable hierarchy.

**Workflow:**
```
Academic Structure Page
     │
     ├── Streams
     │     ├── List all streams
     │     ├── Create stream (name, code, description)
     │     ├── Edit stream
     │     ├── Reorder streams (display_order)
     │     └── Delete stream (soft-delete)
     │
     ├── Subjects (per stream)
     │     ├── List subjects filtered by stream
     │     ├── Create subject (name, code, stream)
     │     ├── Edit subject
     │     ├── Reorder subjects
     │     └── Delete subject
     │
     ├── Chapters (per subject)
     │     ├── List chapters filtered by subject
     │     ├── Create chapter (name, subject)
     │     ├── Edit chapter
     │     ├── Reorder chapters
     │     └── Delete chapter
     │
     └── Topics (per chapter)
           ├── List topics filtered by chapter
           ├── Create topic (name, chapter)
           ├── Edit topic
           ├── Reorder topics
           └── Delete topic
```

**Dependencies:** Institute.

**Expected Result:**
- Full 4-level hierarchy created and editable
- Unique naming enforced per level
- Display order updates correctly
- Deletion cascades or blocks as appropriate

---

### 2.6 Batch Management

**Purpose:** Create and manage student batches with teacher assignments.

**Business Objective:** Group students for efficient content delivery and assessment management.

**Workflow:**
```
Batch List
     │
     ├── View all batches (filter by stream/status)
     │
     ├── Create Batch
     │     ├── Set name, code, stream
     │     ├── Set max capacity
     │     ├── Set dates (start, end)
     │     └── Save → Batch created
     │
     ├── Batch Details
     │     ├── View batch info and stats
     │     ├── Manage student roster
     │     │     ├── Enroll students
     │     │     ├── Transfer students
     │     │     ├── Drop students
     │     │     └── View enrollment history
     │     ├── Manage teacher assignments
     │     │     ├── Assign teachers (lead/co/doubt_solver)
     │     │     └── Remove assignments
     │     ├── View attendance summary
     │     └── View performance summary
     │
     ├── Edit Batch
     └── Update Status (upcoming → active → completed → archived)
```

**Dependencies:** Academic Structure, Teachers, Students.

**Expected Result:**
- Batch created with correct capacity
- Capacity enforcement works (cannot exceed max_seats)
- Teacher and student assignments persist
- Status transitions are valid

---

### 2.7 Content Management

**Purpose:** Oversee and approve educational content uploaded by teachers.

**Business Objective:** Ensure content quality and appropriateness before student access.

**Workflow:**
```
Content Library
     │
     ├── Browse all content (filter by status, type, teacher, chapter, date)
     │
     ├── Content Detail
     │     ├── View content preview
     │     ├── View metadata (type, size, duration)
     │     ├── View uploader info
     │     ├── View approval history
     │     └── View view/download stats
     │
     ├── Approve Content
     │     ├── Review content
     │     ├── Add approval remarks
     │     └── Confirm → Status = 'approved'
     │
     ├── Reject Content
     │     ├── Add rejection reason
     │     └── Confirm → Status = 'draft' (returned to teacher)
     │
     ├── Publish Content (directly by admin)
     └── Archive Content
```

**Dependencies:** Academic Structure, Teachers.

**Expected Result:**
- Content lifecycle transitions work correctly
- Approval makes content visible to students
- Rejection returns content to teacher with feedback
- Filtering and search return correct results

---

### 2.8 Question Bank

**Purpose:** Manage the complete question repository.

**Business Objective:** Build a reusable, high-quality question bank for assessments.

**Workflow:**
```
Question Bank
     │
     ├── Browse questions (filter by type, difficulty, status, subject, chapter)
     │
     ├── Create Question
     │     ├── Select subject, chapter
     │     ├── Choose type (MCQ/MSQ/Numerical/TrueFalse)
     │     ├── Write question text
     │     ├── Add options (type-dependent)
     │     ├── Mark correct answer(s)
     │     ├── Add explanation
     │     ├── Upload images (optional)
     │     ├── Set difficulty, marks, negative marks
     │     └── Save as Draft or Publish directly
     │
     ├── Edit Question
     │     └── Update fields → Version incremented
     │
     ├── Approve Question
     │     └── Set status = 'published', set approved_by, approved_at
     │
     ├── Reject Question
     │     └── Send back to draft with reason
     │
     ├── Delete Question
     │     └── Only if times_attempted = 0
     │
     └── Bulk Import Questions
           ├── Upload CSV/Excel
           └── Validate and import
```

**Dependencies:** Academic Structure.

**Expected Result:**
- All 4 question types creatable with correct validation
- Status lifecycle works correctly
- Version history preserved
- Bulk import processes 500+ questions

---

### 2.9 Mock Test Management

**Purpose:** Create, publish, and manage mock tests.

**Business Objective:** Deliver practice and evaluation assessments to students.

**Workflow:**
```
Mock Test List
     │
     ├── Browse tests (filter by status, stream, teacher)
     │
     ├── Create Mock Test
     │     ├── Basic info: title, description, stream, subject
     │     ├── Timing: duration, total marks, passing marks
     │     ├── Settings: negative marking, attempt limit, shuffle
     │     ├── Availability: from/to dates
     │     ├── Result mode: immediate/scheduled/manual
     │     └── Create → Draft status
     │
     ├── Manage Questions
     │     ├── Add questions from bank
     │     ├── Set per-question marks
     │     ├── Reorder questions
     │     └── Remove questions
     │
     ├── Publish Test
     │     ├── Validate (questions exist, all published)
     │     ├── Generate question snapshots
     │     └── Status → 'published'
     │
     ├── Archive Test
     ├── View Results
     ├── Release Results
     └── View Leaderboard
```

**Dependencies:** Question Bank, Batches, Teachers.

**Expected Result:**
- Test created in draft with all settings
- Questions can be added/reordered/removed
- Publishing freezes snapshots
- Results release works as configured

---

### 2.10 Results & Analytics

**Purpose:** View and manage test results with detailed breakdowns.

**Business Objective:** Provide performance insights to drive academic improvement.

**Workflow:**
```
Results Dashboard
     │
     ├── View stats (total results, released, avg score, highest)
     │
     ├── Browse Results (filter by test, batch, student, date range)
     │
     ├── Result Detail
     │     ├── Score card: percentage, score, rank, accuracy
     │     ├── Subject breakdown
     │     ├── Chapter breakdown
     │     ├── Question-wise analysis
     │     └── Performance trends
     │
     ├── Release/Hide Results
     │     └── Toggle is_released flag
     │
     ├── View Leaderboard
     │     └── Ranked by total_score DESC
     │
     └── Export Results (CSV/Excel/PDF)
```

**Dependencies:** Mock Tests, Students.

**Expected Result:**
- Results computed correctly from answers
- Subject and chapter breakdowns visible
- Release toggle works immediately
- Export generates correct data

---

### 2.11 Approval Center

**Purpose:** Unified queue for all pending approvals across resource types.

**Business Objective:** Streamline the approval workflow for content, tests, and teacher KYC.

**Workflow:**
```
Approval Center
     │
     ├── View unified queue (all pending items)
     │     ├── Pending content approvals
     │     ├── Pending mock test approvals
     │     ├── Pending question approvals
     │     ├── Pending teacher KYC
     │     └── Pending leave requests
     │
     ├── Filter by resource type, date range, teacher
     │
     ├── Approve Item
     │     ├── Review details
     │     ├── Add remarks (optional)
     │     └── Confirm → Resource status updated
     │
     └── Reject Item
           ├── Add rejection reason (required)
           └── Confirm → Resource status updated
```

**Dependencies:** Content, Mock Tests, Questions, Teacher Management.

**Expected Result:**
- All pending items visible in unified queue
- Approval updates resource status immediately
- Rejection returns resource with reason
- Filtering works correctly

---

### 2.12 PYQ Management

**Purpose:** Manage previous year question paper packages.

**Business Objective:** Generate revenue by selling curated PYQ packages to students.

**Workflow:**
```
PYQ Packages
     │
     ├── List packages (filter by status)
     │
     ├── Create Package
     │     ├── Set name, description, price
     │     ├── Set year range
     │     ├── Upload thumbnail
     │     ├── Configure unlock types (PDF, solutions, mock test)
     │     └── Save
     │
     ├── Add Papers
     │     ├── Upload PDF
     │     ├── Set year, session
     │     ├── Map questions to paper
     │     ├── Add solutions
     │     └── Publish/Unpublish paper
     │
     ├── Manage Sales
     │     ├── View purchase history
     │     ├── Grant access to student
     │     └── Revoke access
     │
     └── Activate/Deactivate Package
```

**Dependencies:** Question Bank, Students.

**Expected Result:**
- Package created with correct pricing
- Paper upload succeeds with question mapping
- Student grant/revoke works immediately
- Purchase history accurate

---

### 2.13 Live Classes (Oversight)

**Purpose:** View and manage live classes across all teachers.

**Business Objective:** Ensure smooth live class operations and monitor teacher activity.

**Workflow:**
```
Live Classes List
     │
     ├── View all classes (filter by status, teacher, batch, date)
     │
     ├── Class Detail
     │     ├── View class info
     │     ├── View attendance
     │     ├── View recordings
     │     ├── View participants
     │     └── View stats
     │
     ├── Create Live Class (for any teacher)
     ├── Cancel Live Class
     └── Override Attendance
```

**Dependencies:** Teachers, Batches.

**Expected Result:**
- All teachers' classes visible
- Cancellation notifies affected students
- Attendance data accurate

---

### 2.14 Attendance

**Purpose:** Monitor class attendance across batches.

**Business Objective:** Track student engagement and identify attendance issues.

**Workflow:**
```
Attendance Dashboard
     │
     ├── View attendance across all classes/batches
     ├── View per-batch summary
     ├── View per-student records
     ├── Override attendance (with reason)
     └── Export reports
```

**Dependencies:** Live Classes, Students.

**Expected Result:**
- Attendance data displays correctly
- Override updates with reason tracked
- Export generates correctly

---

### 2.15 Subscription Plans

**Purpose:** Create and manage subscription tiers with feature unlocks.

**Business Objective:** Monetize platform access through tiered subscription plans.

**Workflow:**
```
Subscription Plans
     │
     ├── List plans
     │
     ├── Create Plan
     │     ├── Set name, description, price
     │     ├── Select billing cycle (monthly/quarterly/etc.)
     │     ├── Set duration days and trial days
     │     ├── Configure feature unlocks
     │     └── Set display order
     │
     ├── Edit Plan
     ├── Activate/Deactivate
     └── View active subscribers
```

**Dependencies:** Institute.

**Expected Result:**
- Plan created with correct billing and features
- Deactivation prevents new purchases
- Existing subscribers retain access

---

### 2.16 Student Subscriptions

**Purpose:** Manage student subscription lifecycle.

**Business Objective:** Handle subscription enrollment, cancellations, and refunds.

**Workflow:**
```
Student Subscriptions
     │
     ├── View all subscriptions (filter by status, plan, date)
     ├── View subscription detail (history, renewals, grace period, usage)
     ├── Activate subscription manually
     ├── Cancel subscription (with reason)
     └── Process refund
```

**Dependencies:** Subscription Plans, Students.

**Expected Result:**
- Subscription lifecycle visible
- Manual activation works
- Cancellation and refund process correctly

---

### 2.17 Orders & Payments

**Purpose:** View and manage financial transactions.

**Business Objective:** Ensure revenue integrity and handle financial operations.

**Workflow:**
```
Orders List
     │
     ├── View all orders (filter by status, date, student)
     ├── View order details with line items
     ├── View payments and invoices
     ├── Cancel order
     └── Process refund (partial/full)
```

**Dependencies:** Subscriptions, PYQ.

**Expected Result:**
- Order financials correct (total = subtotal - discount + tax)
- Refund processes correctly
- Invoice data accurate

---

### 2.18 Notifications

**Purpose:** Create and manage communications across the platform.

**Business Objective:** Keep users informed of important events and announcements.

**Workflow:**
```
Notifications
     │
     ├── Create Notification Template
     │     ├── Set name, event type, channel
     │     ├── Write title/body with {{placeholders}}
     │     └── Activate template
     │
     ├── Send Broadcast
     │     ├── Compose message
     │     ├── Select target (role, specific users)
     │     ├── Select channel
     │     ├── Schedule (immediate or future)
     │     └── Send
     │
     ├── View Sent History
     ├── View Read Status
     └── Soft-Delete Notification
```

**Dependencies:** All modules (for event types).

**Expected Result:**
- Templates created with placeholders
- Broadcast sends to correct audience
- Read status tracked correctly

---

### 2.19 Teacher HR

**Purpose:** Manage teacher HR records, KYC, leave, and payroll.

**Business Objective:** Maintain a compliant, verified teacher workforce.

**Workflow:**
```
Teacher HR Profile
     │
     ├── Employment Record
     │     ├── View/edit type, salary, joining date
     │     └── Manage employment status
     │
     ├── Qualifications
     │     ├── List qualifications
     │     └── Verify qualification
     │
     ├── Experience
     │     ├── List experience
     │     └── Verify experience
     │
     ├── Documents (KYC)
     │     ├── List uploaded documents
     │     ├── Verify document
     │     └── Reject document (with reason)
     │
     ├── Bank Details
     │     ├── View bank details
     │     └── Verify/reject bank details
     │
     ├── Availability
     │     ├── View weekly availability
     │     └── Manage slots
     │
     └── Leave Requests
           ├── View pending/approved/rejected
           ├── Approve leave
           └── Reject leave (with reason)
```

**Dependencies:** Teacher Management.

**Expected Result:**
- Full HR record visible
- Document verification workflow works
- Leave approval/rejection updates correctly
- Availability calendar accurate

---

### 2.20 Student Services

**Purpose:** Manage student doubts, support tickets, and feedback.

**Business Objective:** Improve student experience through timely support.

**Workflow:**
```
Student Services
     │
     ├── Doubts Oversight
     │     ├── View all doubts
     │     └── Monitor resolution status
     │
     ├── Support Tickets
     │     ├── View all tickets (filter by status, priority)
     │     ├── Assign ticket to staff
     │     ├── Reply to ticket
     │     └── Resolve/Close ticket
     │
     └── Feedback
           └── View ratings and feedback
```

**Dependencies:** Students, Teachers.

**Expected Result:**
- Tickets visible and assignable
- Replies delivered to student
- Resolution tracking accurate

---

### 2.21 System Settings

**Purpose:** Configure platform settings.

**Business Objective:** Maintain system integrity and configuration.

**Workflow:**
```
System Settings
     │
     ├── View all configuration keys
     ├── Update setting value
     └── View change history (via audit logs)
```

**Dependencies:** Authentication.

**Expected Result:**
- Setting updates take effect immediately
- Changes logged in audit trail
- Immutable keys protected

---

### 2.22 Feature Flags

**Purpose:** Toggle feature availability globally or per-institute.

**Business Objective:** Control feature rollout without deployment.

**Workflow:**
```
Feature Flags
     │
     ├── List all flags
     ├── Create flag (key, description)
     ├── Enable/Disable globally
     ├── Create per-institute override
     └── Delete flag
```

**Dependencies:** System Settings.

**Expected Result:**
- Flag toggle takes effect within 1 minute
- Institute override takes precedence
- Flag deletion allowed at 100% rollout

---

### 2.23 API Keys & Webhooks

**Purpose:** Manage programmatic access and event integrations.

**Business Objective:** Enable secure third-party integrations.

**Workflow:**
```
API Keys
     ├── Create key (with scopes, expiry)
     ├── Revoke key
     └── View usage

Webhooks
     ├── Create endpoint (URL, secret, event types)
     ├── Test delivery
     ├── View delivery logs
     └── Deactivate endpoint
```

**Dependencies:** System Settings.

**Expected Result:**
- API key created with selected scopes
- Webhook delivery logs visible
- Failed deliveries tracked

---

### 2.24 Audit Logs

**Purpose:** View immutable platform activity trail.

**Business Objective:** Ensure compliance and security monitoring.

**Workflow:**
```
Audit Logs
     │
     ├── View all activity (filter by user, action, resource, date)
     ├── View before/after values
     └── Export logs
```

**Dependencies:** All modules.

**Expected Result:**
- All significant actions logged
- Search and filter return correct results
- Export generates correctly

---

### 2.25 Reports

**Purpose:** Generate and export business reports.

**Business Objective:** Support data-driven decision-making.

**Workflow:**
```
Reports
     │
     ├── Revenue Reports
     │     ├── Daily/Weekly/Monthly/Custom range
     │     └── Export CSV/Excel/PDF
     │
     ├── Performance Reports
     │     ├── Student performance
     │     ├── Teacher performance
     │     └── Batch performance
     │
     ├── Subscription Reports
     ├── Attendance Reports
     └── Schedule Recurring Reports
```

**Dependencies:** All modules.

**Expected Result:**
- Reports generate within 30 seconds
- Exports contain correct data
- PDF reports are branded and print-ready

---

### 2.26 Support Tickets

**Purpose:** Manage student support requests.

**Business Objective:** Resolve student issues efficiently.

**Workflow:**
```
Support Tickets
     │
     ├── View all tickets (filter by status, priority, category)
     ├── Assign ticket to staff
     ├── Reply to ticket
     ├── Resolve/Close ticket
     └── View ticket history
```

**Dependencies:** Students.

**Expected Result:**
- Ticket assignment works
- Responses delivered to student
- Resolution status tracked

---

### 2.27 Media Library

**Purpose:** Browse and manage uploaded media files.

**Business Objective:** Organize storage assets and monitor usage.

**Workflow:**
```
Media Library
     │
     ├── Browse media (filter by type, date, uploader)
     ├── View media detail
     ├── Upload new media
     ├── Delete media
     └── View storage usage
```

**Dependencies:** Content, Questions.

**Expected Result:**
- Media files browsable with filters
- Uploads succeed with validation
- Storage usage accurate

---

## 3. Screen Flow

### 3.1 Dashboard Flow

```
Login
  │
  ▼
Admin Dashboard (/admin/dashboard)
  │
  ├── Click any Quick Action → respective management page
  ├── Click Pending Approval count → Approval Center
  ├── Click Teacher count → Teacher List
  ├── Click Student count → Student List
  ├── Click Revenue → Revenue Reports
  ├── Click Upcoming Class → Live Class Detail
  └── Click Notification → Notification History
```

### 3.2 Teacher Management Flow

```
Teacher List (/admin/teachers)
  │
  ├── Click "Create Teacher" → Create Teacher (/admin/teachers/create)
  │    └── Save → Teacher Profile (/admin/teachers/{id})
  │
  ├── Click Teacher Row → Teacher Profile (/admin/teachers/{id})
  │    ├── Click "Edit" → Edit Teacher (/admin/teachers/{id}/edit)
  │    ├── Click "HR" → Teacher HR (/admin/teachers/{id}/hr)
  │    │    ├── Click "Documents" → Documents tab
  │    │    ├── Click "Leave" → Leave tab
  │    │    ├── Click "Qualifications" → Qualifications tab
  │    │    └── Click "Bank Details" → Bank tab
  │    ├── Click "Batches" → Batch Assignments (/admin/teachers/{id}/batches)
  │    ├── Click "Analytics" → Teacher Analytics (/admin/teachers/{id}/analytics)
  │    └── Click "Activity" → Activity Log (/admin/teachers/{id}/activity)
  │
  └── Search/Filter → Filtered list
```

### 3.3 Student Management Flow

```
Student List (/admin/students)
  │
  ├── Click "Create Student" → Create Student (/admin/students/create)
  │    └── Save → Student Profile (/admin/students/{id})
  │
  ├── Click "Bulk Import" → Import (/admin/students/import)
  │
  ├── Click Student Row → Student Profile (/admin/students/{id})
  │    ├── Click "Edit" → Edit Student (/admin/students/{id}/edit)
  │    ├── Click "Batches" → Batch Enrollments (/admin/students/{id}/batches)
  │    ├── Click "Performance" → Performance (/admin/students/{id}/performance)
  │    ├── Click "Results" → Results (/admin/students/{id}/results)
  │    ├── Click "Analytics" → Analytics (/admin/students/{id}/analytics)
  │    ├── Click "Orders" → Order History (/admin/students/{id}/orders)
  │    ├── Click "Subscriptions" → Subscriptions (/admin/students/{id}/subscriptions)
  │    ├── Click "Attendance" → Attendance (/admin/students/{id}/attendance)
  │    ├── Click "Doubts" → Doubts (/admin/students/{id}/doubts)
  │    └── Click "Tickets" → Support Tickets (/admin/students/{id}/tickets)
  │
  └── Search/Filter → Filtered list
```

### 3.4 Academic Structure Flow

```
Academic Structure (/admin/academic/streams)
  │
  ├── Click Stream → Subject List (/admin/academic/subjects?streamId={id})
  │    ├── Click Subject → Chapter List (/admin/academic/chapters?subjectId={id})
  │    │    ├── Click Chapter → Topic List (/admin/academic/topics?chapterId={id})
  │    │    └── Back to Subjects
  │    └── Back to Streams
  │
  └── Each level: Create/Edit/Delete/Reorder actions
```

### 3.5 Batch Management Flow

```
Batch List (/admin/batches)
  │
  ├── Click "Create Batch" → Create Batch (/admin/batches/create)
  │    └── Save → Batch Detail (/admin/batches/{id})
  │
  └── Click Batch Row → Batch Detail (/admin/batches/{id})
       ├── Click "Edit" → Edit Batch
       ├── Click "Students" → Student Roster (/admin/batches/{id}/students)
       │    ├── Enroll Student
       │    └── Drop/Transfer Student
       ├── Click "Teachers" → Teacher Assignments (/admin/batches/{id}/teachers)
       │    ├── Assign Teacher
       │    └── Remove Teacher
       ├── Click "Attendance" → Attendance Summary
       └── Click "Performance" → Performance Summary
```

### 3.6 Question Bank Flow

```
Question Bank (/admin/questions)
  │
  ├── Click "Create Question" → Create Question (/admin/questions/create)
  │    ├── Select type → Dynamic form
  │    └── Save → Question Detail (/admin/questions/{id})
  │
  ├── Click "Bulk Import" → Import (/admin/questions/import)
  │
  ├── Click Question Row → Question Detail (/admin/questions/{id})
  │    ├── Click "Edit" → Edit Question
  │    ├── Click "Options" → Manage options
  │    ├── Click "Explanation" → Edit explanation
  │    ├── Click "Images" → Manage images
  │    ├── Click "Approve" → Confirm → Status updated
  │    └── Click "Archive" → Confirm → Archived
  │
  └── Search/Filter → Filtered list
```

### 3.7 Mock Test Flow

```
Mock Test List (/admin/mock-tests)
  │
  ├── Click "Create Test" → Create Mock Test (/admin/mock-tests/create)
  │    └── Save → Test Questions (/admin/mock-tests/{id}/questions)
  │         ├── Add questions from bank
  │         └── Click "Publish" → Publish (/admin/mock-tests/{id}/publish)
  │
  ├── Click Test Row → Mock Test Detail (/admin/mock-tests/{id})
  │    ├── Click "Edit" → Edit Test
  │    ├── Click "Questions" → Manage questions
  │    ├── Click "Results" → View results (/admin/mock-tests/{id}/results)
  │    │    ├── Click Result Row → Result Detail
  │    │    └── Click "Release Results" → Confirm
  │    ├── Click "Analytics" → Test analytics
  │    ├── Click "Publish" → Confirm
  │    └── Click "Archive" → Confirm
  │
  └── Search/Filter → Filtered list
```

### 3.8 Approval Center Flow

```
Approval Center (/admin/approvals)
  │
  ├── Filter by resource type → Filtered list
  │
  └── Click Approval Item → Approval Detail (/admin/approvals/{id})
       ├── Preview resource
       ├── Click "Approve" → Confirm → Status updated
       └── Click "Reject" → Enter reason → Confirm → Status updated
```

### 3.9 PYQ Flow

```
PYQ Packages (/admin/pyq/packages)
  │
  ├── Click "Create Package" → Create Package (/admin/pyq/packages/create)
  │    └── Save → Package Detail (/admin/pyq/packages/{id})
  │         ├── Click "Add Paper" → Paper upload
  │         │    ├── Upload PDF
  │         │    └── Map questions
  │         └── Click "Activate" → Confirm
  │
  ├── Click "PYQ Sales" → Sales (/admin/pyq/sales)
  │    ├── View purchase history
  │    └── Grant/Revoke access
  │
  └── Search/Filter → Filtered list
```

### 3.10 Subscriptions Flow

```
Subscription Plans (/admin/subscriptions/plans)
  │
  ├── Click "Create Plan" → Create Plan (/admin/subscriptions/plans/create)
  │    ├── Configure features
  │    └── Save → Plan Detail (/admin/subscriptions/plans/{id})
  │
  └── Click Plan Row → Plan Detail
       ├── Click "Edit" → Edit Plan
       └── Click "Features" → Manage unlocks

Student Subscriptions (/admin/subscriptions/students)
  │
  ├── Click Subscription Row → Subscription Detail
  │    ├── View history
  │    ├── Click "Cancel" → Confirm
  │    └── Click "Activate" → Confirm
  │
  └── Search/Filter → Filtered list
```

### 3.11 Notifications Flow

```
Notifications (/admin/notifications)
  │
  ├── Click "Create Template" → Template form (/admin/notifications/templates/create)
  ├── Click "Send Notification" → Compose (/admin/notifications/create)
  │    ├── Select target audience
  │    ├── Write message
  │    └── Send/Schedule
  │
  └── Click Notification Row → Detail
       └── View read status
```

### 3.12 System Settings Flow

```
System Settings (/admin/system/settings)
  │
  ├── Click Setting → Edit value
  └── Save → Value updated

Feature Flags (/admin/system/feature-flags)
  ├── Toggle flag → Enabled/Disabled
  └── Create override → Per-institute

API Keys (/admin/system/api-keys)
  ├── Click "Create Key" → Generate key
  └── Click "Revoke" → Confirm

Webhooks (/admin/system/webhooks)
  ├── Click "Create Endpoint" → Form
  └── Click Endpoint → View logs

Audit Logs (/admin/system/audit-logs)
  ├── Filter by user, action, date
  └── Click Row → View detail (before/after)

Media Library (/admin/system/media)
  ├── Click file → Media detail
  └── Upload/Delete
```

---

## 4. User Journeys

### Journey 1: Set Up a New Institute

```
1. Super Admin logs in
2. Creates a new institute (name, slug, plan tier)
3. Configures institute settings (branding, domain)
4. Creates academic structure:
   a. Adds stream "NEET UG"
   b. Adds subjects: Physics, Chemistry, Biology
   c. Adds chapters under each subject
   d. Adds topics under key chapters
5. Creates 5 teachers:
   a. Fills name, phone, department
   b. Sets employment type and salary
   c. Assigns subject specializations
   d. Assigns to batches (created next)
6. Creates 3 batches:
   a. "NEET 2026 Morning" (capacity: 60)
   b. "NEET 2026 Evening" (capacity: 60)
   c. "NEET 2027 Weekend" (capacity: 40)
7. Assigns lead teachers and co-teachers to each batch
8. Imports 200 students via CSV:
   a. Downloads template
   b. Uploads filled CSV
   c. Validates and confirms import
9. Enrolls students into batches
10. Institute is operational
```

**Expected Result:** Full institute setup complete with working teachers, students, batches, and academic structure.

---

### Journey 2: Create and Publish a Mock Test

```
1. Admin navigates to Approval Center
2. Sees a pending mock test from a teacher
3. Reviews the test (title, duration, marks, questions)
4. Clicks "Preview" to see the test as a student would
5. Verifies question selection is appropriate
6. Clicks "Approve" with remarks: "Excellent coverage of syllabus"
7. Test is published and visible to students
8. Admin navigates to Mock Tests to verify status
9. Sees test status = "published"
```

**Alternative Flow (Admin Creates Directly):**
```
1. Admin navigates to Mock Tests > Create
2. Sets title: "NEET 2026 Full Mock #1"
3. Configures: duration=180min, marks=720, negative=1
4. Adds 180 questions from bank (50 Physics, 50 Chem, 80 Bio)
5. Sets per-question marks (4 each)
6. Configures sections (Physics Section A/B, etc.)
7. Sets availability: 1 month window
8. Sets result release: manual
9. Publishes directly (bypassing approval)
10. Test appears in student dashboard
```

**Expected Result:** Mock test published and available to targeted students.

---

### Journey 3: Approve Content from Teachers

```
1. Admin navigates to Approval Center
2. Sees "12 Pending Content" items
3. Filters by content type "Video"
4. Reviews first video: "Chapter 5 - Laws of Motion"
   a. Previews the video
   b. Checks metadata
   c. Verifies chapter mapping
   d. Clicks "Approve"
5. Reviews second item: "Physics Notes - Thermodynamics"
   a. Reviews PDF preview
   b. Clicks "Approve"
6. Reviews third item (low quality):
   a. Identifies poor audio quality
   b. Clicks "Reject"
   c. Provides reason: "Audio quality too low, please re-record"
7. Teacher receives rejection notification
8. Content status updated
```

**Expected Result:** Content approval workflow functions correctly. Approved content visible to students. Rejected content returned to teacher with feedback.

---

### Journey 4: Manage Teacher HR and Leave

```
1. Admin navigates to Teacher Management
2. Searches for teacher "Dr. Sharma"
3. Opens teacher profile
4. Clicks "HR" tab
5. Views employment record:
   - Employment type: Full Time
   - Salary: ₹1,50,000/month
   - Joining date: June 2025
6. Views pending documents:
   - Aadhaar: Pending → Clicks "Verify"
   - PAN Card: Pending → Clicks "Verify"
   - Degree Certificate: Pending → Clicks "Verify"
7. Views pending leave request:
   - Type: Sick Leave
   - Dates: Aug 15-17
   - Reason: "Medical appointment"
   - Clicks "Approve" with remarks: "Get well soon"
8. Notifications sent to teacher for document verification and leave approval
```

**Expected Result:** Teacher HR records updated. Documents verified. Leave approved. Teacher notified.

---

### Journey 5: Process Student Refund

```
1. Admin navigates to Orders & Payments
2. Searches for student "Priya Singh"
3. Views her order history
4. Finds order: "NEET 2026 Pro Plan - ₹9,999"
5. Sees payment status: "captured"
6. Student requests refund via support ticket
7. Admin reviews:
   a. Checks refund policy (30-day window)
   b. Verifies student hasn't used premium features
   c. Confirms eligibility
8. Clicks "Process Refund"
9. Selects "Full Refund"
10. Enters reason: "Student requested cancellation within 7 days"
11. Confirms → Payment status = "refunded"
12. Subscription cancelled
13. Student notified of refund
```

**Expected Result:** Refund processed successfully. Payment status updated. Subscription cancelled. Student notified.

---

### Journey 6: Generate and Send Notifications

```
1. Admin navigates to Notifications
2. Clicks "Create Template"
3. Sets:
   - Name: "Test Published Alert"
   - Event: test_published
   - Channel: in_app
   - Title: "New Test: {{test_title}}"
   - Body: "A new test {{test_title}} has been published. Available from {{available_from}}. Good luck!"
4. Saves template
5. Clicks "Send Notification"
6. Selects:
   - Title: "Holiday Notice - Independence Day"
   - Message: "Institute will remain closed on August 15th for Independence Day. Regular classes resume on August 16th."
   - Target: All Students
   - Channel: in_app + email
   - Schedule: Immediate
7. Clicks "Send Now"
8. Notification appears in student inboxes
9. Admin can view delivery and read status
```

**Expected Result:** Notification created, sent, and delivered to all targeted students. Read status tracked.

---

### Journey 7: Release Exam Results

```
1. Admin navigates to Mock Tests
2. Selects "NEET 2026 Full Mock #1"
3. Clicks "Results"
4. Views:
   - 145 attempts
   - Average score: 523/720 (72.6%)
   - Highest score: 698/720
   - Passing rate: 78%
5. Reviews leaderboard (sorted by score)
6. Verifies a specific student's result detail
7. Confirms results are correct
8. Clicks "Release Results"
9. Confirms in dialog
10. All students can now view their scores
```

**Expected Result:** Results released correctly. Students can view detailed results with breakdowns.

---

### Journey 8: Configure System Settings

```
1. Admin navigates to System Settings
2. Updates:
   - Default timezone: Asia/Kolkata
   - Grace period days: 3 → 5
   - Max students per batch: 60 → 80
3. Saves each setting
4. Verifies audit log shows changes
5. Navigates to Feature Flags
6. Disables "live_classes" for maintenance
7. Navigates to API Keys
8. Creates new key for integration partner
   - Scope: read_only
   - Expiry: 30 days
9. Copies key (shown once)
10. Navigates to Webhooks
11. Creates endpoint for student registration events
    - URL: https://partner.com/webhook
    - Events: student.created, student.updated
12. Tests webhook → success
```

**Expected Result:** All system changes applied immediately. Audit trail recorded. API key generated. Webhook tested successfully.

---

### Journey 9: Suspend Teacher

```
1. Admin navigates to Teacher Management
2. Searches for teacher violating policy
3. Opens teacher profile
4. Clicks "Deactivate"
5. Confirmation dialog: "Are you sure? The teacher will lose access immediately."
6. Selects reason: "Policy violation"
7. Adds notes: "Repeated late arrivals to scheduled classes"
8. Confirms
9. Teacher account deactivated
10. Teacher cannot log in
11. Active classes reassigned or cancelled
```

**Expected Result:** Teacher account deactivated immediately. Login blocked. Sessions ended.

---

### Journey 10: Reset Student Password

```
1. Admin navigates to Student Management
2. Searches for student who forgot password
3. Opens student profile
4. Clicks "Reset Password"
5. Confirmation dialog: "A password reset link will be sent to the student's registered phone number."
6. Confirms
7. System sends SMS with reset link
8. Student receives SMS and resets password
9. Status: "Password reset sent"
```

**Expected Result:** Password reset initiated. Student receives reset instructions via SMS. Student can log in with new password.

---

## 5. Manual Test Cases

### 5.1 Authentication

| Test ID | Feature | Preconditions | Steps | Expected Result | Priority |
|---------|---------|---------------|-------|-----------------|----------|
| ADM-AUTH-001 | Admin Login | Admin account exists | 1. Open login page<br>2. Enter valid phone<br>3. Enter password<br>4. Click Login | Redirected to Admin Dashboard. Session created. | High |
| ADM-AUTH-002 | Login with invalid credentials | No matching account | 1. Enter invalid phone<br>2. Enter wrong password<br>3. Click Login | Error: "Invalid login credentials" | High |
| ADM-AUTH-003 | Login with empty fields | Fresh login page | 1. Click Login without entering anything | Validation errors shown. Button disabled. | Medium |
| ADM-AUTH-004 | Unauthorized teacher access | Teacher account | 1. Login as teacher<br>2. Navigate to /admin/* | Redirected to Teacher Dashboard. 403 error. | High |
| ADM-AUTH-005 | Unauthorized student access | Student account | 1. Login as student<br>2. Navigate to /admin/* | Redirected to Student App. 403 error. | High |
| ADM-AUTH-006 | Session expiry | Active session | 1. Wait for token expiry<br>2. Click any navigation item | Redirected to login page. | High |
| ADM-AUTH-007 | Logout | Authenticated | 1. Click logout<br>2. Confirm | Session cleared. Redirected to login. | High |
| ADM-AUTH-008 | Password reset | Admin account | 1. Click "Forgot Password"<br>2. Enter phone<br>3. Receive OTP<br>4. Set new password | Password updated. Can login with new password. | High |

### 5.2 Dashboard

| Test ID | Feature | Preconditions | Steps | Expected Result | Priority |
|---------|---------|---------------|-------|-----------------|----------|
| ADM-DASH-001 | View dashboard | Authenticated as admin | 1. Navigate to /admin/dashboard | All widgets display with correct data. Loading skeletons replaced. | High |
| ADM-DASH-002 | Stat cards accuracy | Test/Student/Teacher data exists | 1. Count records manually<br>2. Compare with dashboard widgets | Numbers match exactly. | High |
| ADM-DASH-003 | Quick actions navigation | Any state | 1. Click each Quick Action button | Navigates to correct route for each action. | High |
| ADM-DASH-004 | Pending approvals count | Pending items exist | 1. View pending count widget<br>2. Navigate to Approval Center<br>3. Count pending items | Numbers match. Click navigates to filtered view. | High |
| ADM-DASH-005 | Revenue chart | Orders exist | 1. View revenue trend chart | 6-month line chart renders with correct data. | Medium |
| ADM-DASH-006 | Student growth chart | Student signups over time | 1. View student growth chart | Bar chart shows monthly signups. | Medium |
| ADM-DASH-007 | Recent activity feed | Activity exists | 1. Scroll to Recent Activity | Shows latest events with correct timestamps. | Medium |
| ADM-DASH-008 | Upcoming classes | Scheduled classes exist | 1. View upcoming classes widget | Next 5 classes listed with correct times. | Medium |
| ADM-DASH-009 | System health | Webhooks and jobs exist | 1. View system health widget | Shows correct status. Green = all OK. | Medium |
| ADM-DASH-010 | Empty state (new institute) | No data | 1. View dashboard | Shows zero counts gracefully. Charts may be empty. | Low |

### 5.3 Institute Management

| Test ID | Feature | Preconditions | Steps | Expected Result | Priority |
|---------|---------|---------------|-------|-----------------|----------|
| ADM-INS-001 | View institute settings | Admin authenticated | 1. Navigate to Institute Settings | Current institute profile displayed correctly. | High |
| ADM-INS-002 | Update institute name | Edit screen | 1. Change institute name<br>2. Save | Name updated. Changes reflected across platform. | High |
| ADM-INS-003 | Upload logo | Edit screen | 1. Click logo upload<br>2. Select image file<br>3. Save | Logo updated. Displayed in header. | High |
| ADM-INS-004 | Change plan tier | Super Admin | 1. Select different plan tier<br>2. Save | Plan tier updated. Features reflect new tier. | High |
| ADM-INS-005 | Deactivate institute | Institute active | 1. Toggle is_active to false<br>2. Save<br>3. Attempt to access as another user | Institute no longer accessible. Users redirected. | High |
| ADM-INS-006 | Validation: empty name | Edit screen | 1. Clear name field<br>2. Save | Error: "Institute name is required" | Medium |

### 5.4 Teacher Management

| Test ID | Feature | Preconditions | Steps | Expected Result | Priority |
|---------|---------|---------------|-------|-----------------|----------|
| ADM-TCH-001 | Create teacher | Valid data | 1. Navigate to Teachers > Create<br>2. Fill all required fields<br>3. Set employment details<br>4. Click Save | Teacher created. Auth credentials generated. Redirected to profile. | High |
| ADM-TCH-002 | Create teacher (duplicate phone) | Existing teacher with same phone | 1. Enter existing phone number<br>2. Click Save | Error: "Phone number already registered" | High |
| ADM-TCH-003 | Create teacher (missing required fields) | Form loaded | 1. Leave name empty<br>2. Click Save | Validation errors shown for each required field. | High |
| ADM-TCH-004 | View teacher list | Teachers exist | 1. Navigate to /admin/teachers | All teachers displayed. Columns: Name, Department, Status, Batches. | High |
| ADM-TCH-005 | Search teachers | Multiple teachers | 1. Type name in search bar | List filters to matching teachers. | High |
| ADM-TCH-006 | Filter teachers by department | Teachers in multiple departments | 1. Select department filter | Only teachers from that department shown. | Medium |
| ADM-TCH-007 | Filter teachers by status | Active and inactive teachers | 1. Select "Active" filter | Only active teachers shown. | Medium |
| ADM-TCH-008 | View teacher profile | Teacher selected | 1. Click teacher row | Full profile with personal info, stats, and tab navigation. | High |
| ADM-TCH-009 | Edit teacher | Teacher exists | 1. Navigate to edit<br>2. Change name/department<br>3. Save | Changes saved. Profile updated. | High |
| ADM-TCH-010 | Deactivate teacher | Active teacher | 1. Click Deactivate<br>2. Confirm<br>3. Provide reason | Teacher deactivated. Cannot log in. | High |
| ADM-TCH-011 | Activate teacher | Inactive teacher | 1. Click Activate<br>2. Confirm | Teacher reactivated. Can log in. | High |
| ADM-TCH-012 | Assign subject specialization | Teacher exists, subjects exist | 1. Click Specializations<br>2. Add subject + proficiency level | Specialization saved. | High |
| ADM-TCH-013 | Assign batch | Teacher exists, batches exist | 1. Click Batch Assignments<br>2. Assign batch with role | Teacher assigned to batch. | High |
| ADM-TCH-014 | Verify document | Teacher uploaded document | 1. Go to Documents tab<br>2. Click "Verify" on pending document | Document status = 'verified'. Timestamp recorded. | High |
| ADM-TCH-015 | Reject document | Pending document | 1. Click "Reject"<br>2. Enter reason | Document status = 'rejected'. Teacher notified. | High |
| ADM-TCH-016 | Approve leave request | Pending leave | 1. Go to Leave tab<br>2. Click "Approve" | Leave status = 'approved'. Teacher notified. | High |
| ADM-TCH-017 | Reject leave request | Pending leave | 1. Click "Reject"<br>2. Enter reason | Leave status = 'rejected'. Teacher notified. | High |
| ADM-TCH-018 | View teacher analytics | Teacher has activity | 1. Click Analytics tab | Charts and stats displayed correctly. | Medium |
| ADM-TCH-019 | View teacher activity log | Teacher has activity | 1. Click Activity tab | Timeline of actions displayed. | Medium |
| ADM-TCH-020 | Reset teacher password | Teacher exists | 1. Click Reset Password<br>2. Confirm | Password reset initiated. Credentials communicated. | Medium |
| ADM-TCH-021 | Pagination | >20 teachers | 1. Navigate to page 2 | Next page loaded. Count correct. | Medium |
| ADM-TCH-022 | Empty state (no teachers) | New institute | 1. Navigate to teacher list | Empty state with "Create Teacher" CTA. | Low |

### 5.5 Student Management

| Test ID | Feature | Preconditions | Steps | Expected Result | Priority |
|---------|---------|---------------|-------|-----------------|----------|
| ADM-STU-001 | Create student | Valid data | 1. Navigate to Students > Create<br>2. Fill all required fields<br>3. Click Save | Student created. Redirected to profile. | High |
| ADM-STU-002 | Create student (duplicate enrollment) | Existing enrollment number | 1. Enter existing enrollment number<br>2. Click Save | Error: "Enrollment number already exists" | High |
| ADM-STU-003 | Bulk import students | CSV file ready | 1. Navigate to Import<br>2. Download template<br>3. Upload filled CSV<br>4. Confirm preview | All students imported. Correct count shown. | High |
| ADM-STU-004 | Bulk import (invalid data) | CSV with errors | 1. Upload CSV with missing fields | Validation errors shown per row. No rows imported. | High |
| ADM-STU-005 | View student list | Students exist | 1. Navigate to /admin/students | All students displayed with search/filter. | High |
| ADM-STU-006 | Search students | Multiple students | 1. Type name or enrollment number | List filters correctly. | High |
| ADM-STU-007 | View student profile | Student selected | 1. Click student row | Full profile with personal info, performance, tabs. | High |
| ADM-STU-008 | Edit student | Student exists | 1. Navigate to edit<br>2. Update details<br>3. Save | Changes saved. | High |
| ADM-STU-009 | Enroll in batch | Student exists, batch has capacity | 1. Click Enroll in Batch<br>2. Select batch<br>3. Confirm | Student enrolled in batch. Roster updated. | High |
| ADM-STU-010 | Enroll in full batch | Batch at capacity | 1. Try to enroll in a full batch | Error: "Batch is at full capacity" | High |
| ADM-STU-011 | Transfer batch | Student in Batch A | 1. Select transfer<br>2. Choose Batch B<br>3. Confirm | Student transferred. Old batch status = 'transferred'. | High |
| ADM-STU-012 | Drop from batch | Student in batch | 1. Click Drop<br>2. Confirm | Student removed from batch. Status = 'dropped'. | Medium |
| ADM-STU-013 | View performance | Student has results | 1. Click Performance tab | Charts and breakdowns displayed. | High |
| ADM-STU-014 | View attendance | Student has class records | 1. Click Attendance tab | Attendance records displayed. | Medium |
| ADM-STU-015 | View orders | Student has purchases | 1. Click Orders tab | Order history displayed. | Medium |
| ADM-STU-016 | View subscriptions | Student has subscription | 1. Click Subscriptions tab | Subscription details and history shown. | Medium |
| ADM-STU-017 | Grant PYQ access | Student exists | 1. Click Grant PYQ Access<br>2. Select package<br>3. Confirm | Student can access PYQ content. | Medium |
| ADM-STU-018 | Revoke PYQ access | Student has access | 1. Click Revoke<br>2. Enter reason<br>3. Confirm | Access removed. | Medium |
| ADM-STU-019 | Deactivate student | Active student | 1. Click Deactivate<br>2. Confirm | Student cannot log in. | High |
| ADM-STU-020 | Pagination | >25 students | 1. Navigate to page 2 | Next page loaded. | Medium |
| ADM-STU-021 | Empty state (no students) | New institute | 1. Navigate to student list | Empty state with "Create Student" and "Import" CTAs. | Low |

### 5.6 Academic Structure

| Test ID | Feature | Preconditions | Steps | Expected Result | Priority |
|---------|---------|---------------|-------|-----------------|----------|
| ADM-ACA-001 | Create stream | Valid data | 1. Navigate to Streams<br>2. Click Create<br>3. Enter name, code<br>4. Save | Stream created. Appears in list. | High |
| ADM-ACA-002 | Create subject | Stream exists | 1. Click stream<br>2. Click Create Subject<br>3. Enter name, code<br>4. Save | Subject created under stream. | High |
| ADM-ACA-003 | Create chapter | Subject exists | 1. Click subject<br>2. Click Create Chapter<br>3. Enter name<br>4. Save | Chapter created under subject. | High |
| ADM-ACA-004 | Create topic | Chapter exists | 1. Click chapter<br>2. Click Create Topic<br>3. Enter name<br>4. Save | Topic created under chapter. | High |
| ADM-ACA-005 | Duplicate subject name | Same stream | 1. Create subject with existing name | Error: "Subject name already exists in this stream" | High |
| ADM-ACA-006 | Duplicate chapter name | Same subject | 1. Create chapter with existing name | Error: "Chapter name already exists in this subject" | High |
| ADM-ACA-007 | Reorder items | Multiple items exist | 1. Change display order | Order updates correctly. | Medium |
| ADM-ACA-008 | Delete stream with children | Stream has subjects | 1. Delete stream<br>2. Confirm | All children deleted/archived. | High |
| ADM-ACA-009 | Edit hierarchy item | Item exists | 1. Click Edit<br>2. Change name<br>3. Save | Name updated. | Medium |
| ADM-ACA-010 | Navigate hierarchy | Streams exist | 1. Click through stream → subject → chapter → topic | Correct items shown at each level. Breadcrumb updates. | Medium |

### 5.7 Batch Management

| Test ID | Feature | Preconditions | Steps | Expected Result | Priority |
|---------|---------|---------------|-------|-----------------|----------|
| ADM-BAT-001 | Create batch | Stream exists | 1. Navigate to Batches > Create<br>2. Fill name, code, stream, capacity<br>3. Save | Batch created in 'upcoming' status. | High |
| ADM-BAT-002 | Create batch (missing fields) | Form loaded | 1. Leave required fields empty<br>2. Click Save | Validation errors for each missing field. | High |
| ADM-BAT-003 | View batch list | Batches exist | 1. Navigate to /admin/batches | All batches listed with status, capacity, teacher count. | High |
| ADM-BAT-004 | View batch detail | Batch selected | 1. Click batch | Detail view with info, roster, assignments. | High |
| ADM-BAT-005 | Assign teacher to batch | Teacher and batch exist | 1. Click Teachers tab<br>2. Assign teacher with role | Teacher assigned. Appears in batch roster. | High |
| ADM-BAT-006 | Remove teacher from batch | Teacher assigned | 1. Click Remove on assigned teacher | Teacher removed from batch. | High |
| ADM-BAT-007 | Enroll student in batch | Student and batch exist | 1. Click Students tab<br>2. Search/add student<br>3. Confirm | Student enrolled. Count updated. | High |
| ADM-BAT-008 | Enroll beyond capacity | Batch at capacity | 1. Try to add student to full batch | Error: "Batch is at maximum capacity." | High |
| ADM-BAT-009 | Drop student from batch | Student enrolled | 1. Click Drop on enrolled student<br>2. Confirm | Student removed. Status = 'dropped'. | High |
| ADM-BAT-010 | Update batch status | Batch exists | 1. Change status from upcoming to active | Status updated. | Medium |
| ADM-BAT-011 | Soft-delete batch | Batch exists | 1. Delete batch<br>2. Confirm | Batch hidden. Data preserved. | Medium |
| ADM-BAT-012 | Empty state (no batches) | New institute | 1. Navigate to batches | Empty state with "Create Batch" CTA. | Low |

### 5.8 Content Management

| Test ID | Feature | Preconditions | Steps | Expected Result | Priority |
|---------|---------|---------------|-------|-----------------|----------|
| ADM-CNT-001 | View content library | Content exists | 1. Navigate to /admin/content | All content listed. Filters available. | High |
| ADM-CNT-002 | Filter by status | Multiple statuses | 1. Select "pending_review" filter | Only pending items shown. | High |
| ADM-CNT-003 | Filter by content type | Multiple types | 1. Select "Video" filter | Only videos shown. | Medium |
| ADM-CNT-004 | View content detail | Content selected | 1. Click content item | Detail view with preview, metadata, uploader info. | High |
| ADM-CNT-005 | Approve content | Pending content | 1. Click Approve<br>2. Add remarks (optional)<br>3. Confirm | Status = 'approved'. Content visible to students. | High |
| ADM-CNT-006 | Reject content | Pending content | 1. Click Reject<br>2. Enter reason<br>3. Confirm | Status = 'draft'. Returned to teacher with reason. | High |
| ADM-CNT-007 | Approve without remarks | Pending content | 1. Click Approve<br>2. Leave remarks empty<br>3. Confirm | Approval succeeds. Remarks optional. | Medium |
| ADM-CNT-008 | Reject without reason | Pending content | 1. Click Reject<br>2. Leave reason empty<br>3. Attempt confirm | Validation: "Rejection reason is required" | High |
| ADM-CNT-009 | Search content | Multiple items | 1. Type search term | List filters to matching items. | Medium |
| ADM-CNT-010 | Empty state (no content) | Institute without content | 1. Navigate to content library | Empty state displayed. Content pending from teachers. | Low |

### 5.9 Question Bank

| Test ID | Feature | Preconditions | Steps | Expected Result | Priority |
|---------|---------|---------------|-------|-----------------|----------|
| ADM-QB-001 | Create MCQ question | Valid data | 1. Navigate to Questions > Create<br>2. Select subject, chapter<br>3. Type: MCQ<br>4. Enter question text (10+ chars)<br>5. Add 4 options<br>6. Mark 1 correct<br>7. Set difficulty, marks<br>8. Click Save | Question created. Appears in bank. | High |
| ADM-QB-002 | Create MSQ question | Valid data | 1. Type: MSQ<br>2. Add 5 options<br>3. Mark 3 correct | Question created with multiple correct options. | High |
| ADM-QB-003 | Create Numerical question | Valid data | 1. Type: Numerical<br>2. Enter answer: 9.8<br>3. Tolerance: 0.1 | Question created without options. | High |
| ADM-QB-004 | Create True/False question | Valid data | 1. Type: True/False<br>2. Two options auto-generated<br>3. Mark correct | Question created with 2 options. | High |
| ADM-QB-005 | Validation: short question text | Create form | 1. Enter < 10 characters | Error: "Question text must be at least 10 characters" | High |
| ADM-QB-006 | Validation: no correct option (MCQ) | MCQ form | 1. Add options<br>2. Mark none correct<br>3. Click Save | Error: "Exactly one option must be correct" | High |
| ADM-QB-007 | Validation: no correct option (MSQ) | MSQ form | 1. Add options<br>2. Mark none correct<br>3. Click Save | Error: "At least one option must be correct" | High |
| ADM-QB-008 | Validation: marks = 0 | Create form | 1. Set marks = 0<br>2. Click Save | Error: "Marks must be greater than 0" | High |
| ADM-QB-009 | View question list | Questions exist | 1. Navigate to /admin/questions | All questions displayed. Filterable. | High |
| ADM-QB-010 | Filter by status | Various statuses | 1. Select "pending_approval" filter | Only pending questions shown. | High |
| ADM-QB-011 | Approve question | Pending question | 1. Click Approve on a question | Status = 'published'. approved_by and approved_at set. | High |
| ADM-QB-012 | Reject question | Pending question | 1. Click Reject<br>2. Enter reason | Status = 'draft'. Returned to teacher. | High |
| ADM-QB-013 | Edit question | Draft question | 1. Click Edit<br>2. Change question text<br>3. Save | Version incremented. Changes saved. | High |
| ADM-QB-014 | Delete question (unused) | Draft, times_attempted=0 | 1. Click Delete<br>2. Confirm | Question deleted. | High |
| ADM-QB-015 | Delete question (used) | times_attempted > 0 | 1. Attempt to delete | Error: "Cannot delete question that has been attempted" | High |
| ADM-QB-016 | Bulk import questions | CSV file | 1. Navigate to Import<br>2. Upload CSV<br>3. Validate and confirm | Questions imported. Correct count. | High |
| ADM-QB-017 | Search questions | Multiple questions | 1. Type search term | List filters to matching questions. | Medium |
| ADM-QB-018 | Pagination | >20 questions | 1. Navigate to page 2 | Next page loaded. | Medium |
| ADM-QB-019 | Empty state (no questions) | New institute | 1. Navigate to questions | Empty state with "Create Question" and "Import" CTAs. | Low |

### 5.10 Mock Tests

| Test ID | Feature | Preconditions | Steps | Expected Result | Priority |
|---------|---------|---------------|-------|-----------------|----------|
| ADM-MT-001 | Create mock test | Valid data | 1. Navigate to Mock Tests > Create<br>2. Fill title, duration, marks<br>3. Configure settings<br>4. Save | Test created in 'draft' status. | High |
| ADM-MT-002 | Validation: empty title | Create form | 1. Leave title empty<br>2. Click Save | Error: "Title is required" | High |
| ADM-MT-003 | Validation: duration > 600 | Create form | 1. Set duration to 601 | Error: "Duration cannot exceed 600 minutes" | High |
| ADM-MT-004 | View test list | Tests exist | 1. Navigate to /admin/mock-tests | All tests listed. Filter by status. | High |
| ADM-MT-005 | Add question to test | Draft test, questions exist | 1. Navigate to test questions page<br>2. Add question from bank | Question appears in test. | High |
| ADM-MT-006 | Remove question from test | Question added | 1. Click Remove on test question | Question removed. | High |
| ADM-MT-007 | Reorder questions | Multiple questions | 1. Change order_sequence | Order updated. | Medium |
| ADM-MT-008 | Publish test (with validation) | Complete draft test | 1. Click Publish<br>2. Validation passes<br>3. Confirm | Status = 'published'. Snapshot generated. | High |
| ADM-MT-009 | Publish test (without questions) | Empty draft | 1. Attempt to publish | Error: "Test must have at least one question" | High |
| ADM-MT-010 | Archive test | Published test | 1. Click Archive<br>2. Confirm | Status = 'archived'. Preserved. | High |
| ADM-MT-011 | View results | Attempts exist | 1. Click Results tab | All results displayed. Leaderboard. | High |
| ADM-MT-012 | Release results | Manual mode test | 1. Click Release Results<br>2. Confirm | Results visible to students. | High |
| ADM-MT-013 | Filter tests by status | Various statuses | 1. Select filter | Only matching tests shown. | Medium |
| ADM-MT-014 | Empty state (no tests) | No tests created | 1. Navigate to mock tests | Empty state with "Create Test" CTA. | Low |

### 5.11 Approval Center

| Test ID | Feature | Preconditions | Steps | Expected Result | Priority |
|---------|---------|---------------|-------|-----------------|----------|
| ADM-APR-001 | View approval center | Pending items exist | 1. Navigate to /admin/approvals | All pending items shown in unified queue. | High |
| ADM-APR-002 | Filter by resource type | Multiple types | 1. Select "Content" filter | Only content approvals shown. | High |
| ADM-APR-003 | Filter by teacher | Multiple teachers | 1. Select teacher filter | Only that teacher's pending items shown. | Medium |
| ADM-APR-004 | Approve content | Pending content | 1. Click Approve<br>2. Confirm | Content approved. Queue updated. | High |
| ADM-APR-005 | Reject content | Pending content | 1. Click Reject<br>2. Enter reason<br>3. Confirm | Content rejected. Returns to teacher. | High |
| ADM-APR-006 | Approve mock test | Pending test | 1. Click Approve<br>2. Confirm | Test published. Queue updated. | High |
| ADM-APR-007 | Approve question | Pending question | 1. Click Approve<br>2. Confirm | Question published. | High |
| ADM-APR-008 | Empty state (no pending) | All approved | 1. Navigate to approvals | "No pending approvals" message with green checkmark. | Low |

### 5.12 PYQ Management

| Test ID | Feature | Preconditions | Steps | Expected Result | Priority |
|---------|---------|---------------|-------|-----------------|----------|
| ADM-PYQ-001 | Create PYQ package | Valid data | 1. Navigate to PYQ > Create<br>2. Set name, price, year range<br>3. Save | Package created. Draft status. | High |
| ADM-PYQ-002 | Add paper to package | Package exists | 1. Click Add Paper<br>2. Upload PDF<br>3. Set year, session<br>4. Save | Paper added to package. | High |
| ADM-PYQ-003 | Map question to paper | Paper and question exist | 1. Click Map Questions<br>2. Select question<br>3. Set order_sequence | Question mapped to paper. | High |
| ADM-PYQ-004 | Publish paper | Draft paper | 1. Click Publish<br>2. Confirm | Paper published. | High |
| ADM-PYQ-005 | Activate package | Package with published papers | 1. Click Activate | Package visible in student store. | High |
| ADM-PYQ-006 | View PYQ sales | Purchases exist | 1. Navigate to Sales | Purchase history displayed. Revenue totals. | High |
| ADM-PYQ-007 | Grant PYQ access | Student and package exist | 1. Click Grant Access<br>2. Select student + package | Student can access package. | High |
| ADM-PYQ-008 | Revoke PYQ access | Student has access | 1. Click Revoke<br>2. Enter reason | Access removed. | Medium |
| ADM-PYQ-009 | Deactivate package | Active package | 1. Click Deactivate | Package hidden from store. Purchases preserved. | Medium |

### 5.13 Subscription Plans

| Test ID | Feature | Preconditions | Steps | Expected Result | Priority |
|---------|---------|---------------|-------|-----------------|----------|
| ADM-SUB-001 | Create subscription plan | Valid data | 1. Navigate to Plans > Create<br>2. Set name, price, billing cycle<br>3. Configure features<br>4. Save | Plan created. Listed. | High |
| ADM-SUB-002 | Deactivate plan | Active plan | 1. Click Deactivate | Plan hidden from purchase. Existing subs active. | High |
| ADM-SUB-003 | Edit plan price | Plan exists | 1. Change price<br>2. Save | Price updated. New purchases use new price. | High |
| ADM-SUB-004 | Configure feature unlocks | Plan exists, features exist | 1. Click Features<br>2. Toggle feature access<br>3. Set usage limits | Feature unlocks saved. | High |
| ADM-SUB-005 | View student subscriptions | Subscriptions exist | 1. Navigate to Student Subscriptions | All subscriptions listed. Filterable. | High |
| ADM-SUB-006 | Cancel subscription | Active subscription | 1. Click Cancel<br>2. Enter reason | Subscription cancelled. | High |
| ADM-SUB-007 | Activate subscription manually | Student, plan exist | 1. Click Activate<br>2. Select student + plan<br>3. Confirm | Subscription activated. | High |

### 5.14 Orders & Payments

| Test ID | Feature | Preconditions | Steps | Expected Result | Priority |
|---------|---------|---------------|-------|-----------------|----------|
| ADM-ORD-001 | View orders | Orders exist | 1. Navigate to Orders | All orders listed. Search/filter. | High |
| ADM-ORD-002 | View order detail | Order exists | 1. Click order | Line items, payment, invoice shown. | High |
| ADM-ORD-003 | Cancel order | Pending order | 1. Click Cancel<br>2. Confirm | Order cancelled. | High |
| ADM-ORD-004 | Process refund | Captured payment | 1. Click Refund<br>2. Select full/partial<br>3. Enter amount<br>4. Confirm | Refund processed. Payment status updated. | High |
| ADM-ORD-005 | View payments | Payments exist | 1. Navigate to Payments | All payments listed with status. | Medium |
| ADM-ORD-006 | View invoices | Invoices exist | 1. Navigate to Invoices | Invoice details displayed. | Medium |

### 5.15 Notifications

| Test ID | Feature | Preconditions | Steps | Expected Result | Priority |
|---------|---------|---------------|-------|-----------------|----------|
| ADM-NOT-001 | Create notification template | Valid data | 1. Navigate to Templates > Create<br>2. Set name, event type, channel<br>3. Write template with {{placeholders}}<br>4. Save | Template created. | High |
| ADM-NOT-002 | Send broadcast notification | Valid message | 1. Click Send Notification<br>2. Write title and body<br>3. Select target role<br>4. Click Send | Notification sent. Recipients receive it. | High |
| ADM-NOT-003 | Schedule notification | Future date | 1. Set schedule date/time<br>2. Click Schedule | Scheduled. Dispatches at correct time. | High |
| ADM-NOT-004 | Send to specific user | Message ready | 1. Select individual user as target | Only that user receives notification. | High |
| ADM-NOT-005 | View sent history | Notifications exist | 1. Navigate to History | All sent notifications listed. | Medium |
| ADM-NOT-006 | View read status | Notification sent | 1. Click notification row | Read/unread status per recipient shown. | Medium |
| ADM-NOT-007 | Delete notification | Sent notification | 1. Click Delete<br>2. Confirm | Soft-deleted. Hidden from recipients. | Medium |

### 5.16 Teacher HR

| Test ID | Feature | Preconditions | Steps | Expected Result | Priority |
|---------|---------|---------------|-------|-----------------|----------|
| ADM-HR-001 | View employment record | Teacher exists | 1. Navigate to HR tab<br>2. View employment | Type, salary, dates displayed correctly. | High |
| ADM-HR-002 | Update employment type | HR record exists | 1. Change type from full_time to part_time<br>2. Save | Employment type updated. | High |
| ADM-HR-003 | Verify qualification | Qualification exists | 1. Click Verify on pending qualification | is_verified = true. verified_by and verified_at set. | High |
| ADM-HR-004 | Verify document | Pending document | 1. Click Verify | Document verified. Status updated. | High |
| ADM-HR-005 | Reject document | Pending document | 1. Click Reject<br>2. Enter reason | Document rejected. Reason recorded. | High |
| ADM-HR-006 | Approve leave request | Pending leave | 1. Click Approve | Leave approved. Teacher notified. | High |
| ADM-HR-007 | Reject leave request | Pending leave | 1. Click Reject<br>2. Enter reason | Leave rejected. | High |
| ADM-HR-008 | View bank details | Bank details exist | 1. View Bank Details tab | Account info displayed (masked). | High |
| ADM-HR-009 | Verify bank details | Pending bank details | 1. Click Verify | Bank details verified. | High |

### 5.17 System Settings

| Test ID | Feature | Preconditions | Steps | Expected Result | Priority |
|---------|---------|---------------|-------|-----------------|----------|
| ADM-SYS-001 | View system settings | Any state | 1. Navigate to System Settings | All settings listed with current values. | High |
| ADM-SYS-002 | Update setting value | Setting exists | 1. Change value<br>2. Save | Value updated. Audit log created. | High |
| ADM-SYS-003 | Toggle feature flag | Flag exists | 1. Toggle enable/disable | Flag state changes within 1 minute. | High |
| ADM-SYS-004 | Create API key | Valid data | 1. Click Create Key<br>2. Set name, scopes, expiry<br>3. Save | Key generated. Shown once. | High |
| ADM-SYS-005 | Revoke API key | Active key | 1. Click Revoke<br>2. Confirm | Key revoked. Cannot be used. | High |
| ADM-SYS-006 | Create webhook endpoint | Valid URL | 1. Click Create Webhook<br>2. Enter URL, secret, events<br>3. Save | Endpoint created. Test delivery sent. | High |
| ADM-SYS-007 | View webhook logs | Events triggered | 1. Click endpoint<br>2. View logs | Delivery logs displayed with status. | Medium |
| ADM-SYS-008 | View audit logs | Activity exists | 1. Navigate to Audit Logs | All actions logged. Filterable. | High |
| ADM-SYS-009 | Filter audit logs | Logs exist | 1. Filter by action type | Only matching logs shown. | Medium |
| ADM-SYS-010 | Export audit logs | Logs exist | 1. Click Export<br>2. Select format | File generated with correct data. | Medium |

### 5.18 Support Tickets

| Test ID | Feature | Preconditions | Steps | Expected Result | Priority |
|---------|---------|---------------|-------|-----------------|----------|
| ADM-SUP-001 | View support tickets | Tickets exist | 1. Navigate to Support Tickets | All tickets listed. Filter by status/priority. | High |
| ADM-SUP-002 | Assign ticket | Open ticket | 1. Click Assign<br>2. Select staff member | Ticket assigned. Status updated. | High |
| ADM-SUP-003 | Reply to ticket | Ticket exists | 1. Click Reply<br>2. Write message<br>3. Send | Response sent to student. | High |
| ADM-SUP-004 | Resolve ticket | In progress ticket | 1. Click Resolve | Ticket closed. Student notified. | High |
| ADM-SUP-005 | Filter by priority | Various priorities | 1. Select "urgent" filter | Only urgent tickets shown. | Medium |

---

## 6. Validation Checklist

### 6.1 Authentication

| Field | Required | Rules | Max Length | Error Message |
|-------|----------|-------|------------|---------------|
| Phone | Yes | Must be valid E.164 format | 15 | "Please enter a valid phone number" |
| Password | Yes | Min 6 characters | 100 | "Password must be at least 6 characters" |

### 6.2 Teacher Form

| Field | Required | Rules | Max Length | Error Message |
|-------|----------|-------|------------|---------------|
| Full Name | Yes | Non-empty | 100 | "Full name is required" |
| Phone | Yes | Unique, valid E.164 | 15 | "Phone number is required" |
| Department | Yes | Non-empty | 100 | "Department is required" |
| Employment Type | Yes | Must be valid enum | — | "Employment type is required" |
| Salary Amount | Conditional | > 0 if set | — | "Salary must be greater than 0" |

### 6.3 Student Form

| Field | Required | Rules | Max Length | Error Message |
|-------|----------|-------|------------|---------------|
| Full Name | Yes | Non-empty | 100 | "Full name is required" |
| Phone | Yes | Valid E.164 | 15 | "Phone number is required" |
| Enrollment No | Yes | Unique per institute | 50 | "Enrollment number is required" |
| Date of Birth | No | Must be in past, > 1900 | — | "Invalid date of birth" |
| Target Year | No | Must be future year | 4 | "Invalid target year" |

### 6.4 Question Form

| Field | Required | Rules | Max Length | Error Message |
|-------|----------|-------|------------|---------------|
| Subject | Yes | Must exist | — | "Subject is required" |
| Chapter | Yes | Must exist | — | "Chapter is required" |
| Question Type | Yes | mcq/msq/numerical/true_false | — | "Question type is required" |
| Question Text | Yes | Min 10 characters | — | "Question text must be at least 10 characters" |
| Difficulty | Yes | easy/medium/hard | — | "Difficulty is required" |
| Marks | Yes | > 0 | — | "Marks must be greater than 0" |
| Options (MCQ) | Yes | At least 2, exactly 1 correct | — | "MCQ must have at least 2 options with exactly 1 correct" |
| Options (MSQ) | Yes | At least 2, at least 1 correct | — | "MSQ must have at least 1 correct option" |
| Numerical Answer | Yes (numerical type) | Must be valid number | — | "Correct numerical answer is required" |

### 6.5 Mock Test Form

| Field | Required | Rules | Error Message |
|-------|----------|-------|---------------|
| Title | Yes | Min 3 characters | "Title must be at least 3 characters" |
| Stream | Yes | Must exist | "Stream is required" |
| Duration | Yes | 1-600 minutes | "Duration must be between 1 and 600 minutes" |
| Total Marks | Yes | > 0 | "Total marks must be greater than 0" |
| Passing Marks | No | Must be ≤ total marks | "Passing marks cannot exceed total marks" |
| Negative Marking | No | ≥ 0 | "Negative marking cannot be negative" |
| Attempt Limit | No | ≥ 1 when set | "Attempt limit must be at least 1" |
| Available Until | Conditional | Must be after available_from | "End date must be after start date" |
| Result Release At | Conditional | Required for scheduled mode | "Release date is required for scheduled mode" |

### 6.6 Batch Form

| Field | Required | Rules | Error Message |
|-------|----------|-------|---------------|
| Batch Name | Yes | Non-empty | "Batch name is required" |
| Stream | Yes | Must exist | "Stream is required" |
| Max Seats | Yes | > 0 | "Max seats must be greater than 0" |
| Start Date | Yes | Must be valid date | "Start date is required" |
| End Date | Yes | Must be after start date | "End date must be after start date" |

### 6.7 PYQ Package Form

| Field | Required | Rules | Error Message |
|-------|----------|-------|---------------|
| Package Name | Yes | Non-empty | "Package name is required" |
| Price | Yes | ≥ 0 | "Price is required (0 for free)" |
| Year From | Yes | 1990-2100 | "Invalid start year" |
| Year To | Yes | ≥ year_from | "End year must be ≥ start year" |

### 6.8 Subscription Plan Form

| Field | Required | Rules | Error Message |
|-------|----------|-------|---------------|
| Plan Name | Yes | Non-empty | "Plan name is required" |
| Price | Yes | ≥ 0 | "Price is required" |
| Billing Cycle | Yes | Must be valid enum | "Billing cycle is required" |
| Duration Days | Yes | > 0 | "Duration is required" |
| Trial Days | No | Must be 0 for lifetime plans | "Lifetime plans cannot have trial days" |

### 6.9 Notification Form

| Field | Required | Rules | Error Message |
|-------|----------|-------|---------------|
| Title | Yes | 1-500 characters | "Title is required" |
| Body | Yes | Min 1 character | "Message body is required" |
| Target Audience | Yes | Must be specified | "Target audience is required" |
| Channel | Yes | Must be valid | "Channel is required" |
| Schedule Date | Conditional | Required for scheduled | "Schedule date is required" |

---

## 7. Business Rule Verification

| Rule ID | Rule | Test | Expected Result |
|---------|------|------|-----------------|
| BR-001 | Institute-scoped data visibility | Admin from Institute A tries to view Institute B's data | Can see only Institute A's data. RLS enforced. |
| BR-002 | Soft-delete preferred | Delete a teacher | Teacher deactivated (`is_active = false`). Data preserved. |
| BR-003 | Audit trail on state changes | Create/update/delete any entity | Corresponding audit_log entry created with actor, action, timestamp. |
| BR-004 | Only active teachers can create content | Deactivate a teacher, attempt to login | Teacher cannot log in. RLS blocks access. |
| BR-005 | Archived questions cannot be used | Try to add archived question to mock test | Question not available in bank. Filtered out. |
| BR-006 | Only published tests are visible to students | Create test in draft, check student view | Test not visible. Only published tests shown. |
| BR-007 | Students cannot access unpublished results | Release results = false, login as student | Result not visible. Only released results shown. |
| BR-008 | Only admins can suspend teachers | Login as teacher, attempt to deactivate another teacher | RLS blocks: permission denied. |
| BR-009 | Only admins can approve content | Login as teacher, attempt to approve content | RLS blocks: permission denied. |
| BR-010 | Students cannot belong to another institute | Create student in Institute A, check Institute B | Student not visible in Institute B. |
| BR-011 | Batch capacity cannot be exceeded | Attempt to enroll 61st student in batch with max=60 | Error: "Batch is at full capacity" |
| BR-012 | Question text minimum 10 characters | Create question with 5 characters | Validation error. |
| BR-013 | Published questions have approved_by set | Approve a question | approved_by and approved_at populated. |
| BR-014 | One pending approval per resource | Teacher submits content, admin views pending | Only one pending request per resource. |
| BR-015 | Mock test duration limit | Create test with 601 minutes | Validation error: "Duration cannot exceed 600 minutes" |
| BR-016 | Question snapshot freezes at publish | Publish test, edit question used in test | Test uses snapshot. Question changes don't affect published test. |
| BR-017 | Subscription status transitions valid | Attempt to go from pending → expired directly | Blocked by validation. Valid path: pending → active → grace → expired. |
| BR-018 | Orders immutable after 24 hours | Try to edit order older than 24h | Cannot modify. Financial integrity enforced. |
| BR-019 | One captured payment per order | Attempt to capture second payment | Blocked by unique constraint. |
| BR-020 | Audit logs are immutable | Attempt to UPDATE or DELETE audit_log | Trigger blocks. Permission denied. |
| BR-021 | Webhooks with pending logs cannot be deleted | Delete webhook with undelivered deliveries | Blocked by trigger. |
| BR-022 | Leave overlap prevention | Create overlapping leave for same teacher | Trigger blocks. Error: "Overlapping leave exists" |
| BR-023 | Performance reports computed after result release | Release results, check performance_reports | Reports updated automatically. |
| BR-024 | Grace period active after failed renewal | Simulate failed renewal | Subscription enters grace period (3 days). |
| BR-025 | Institute slug must be unique | Create institute with existing slug | Error: "Slug already exists" |

---

## 8. Database Verification Checklist

### 8.1 Create Teacher

| Table | Expected Change | Verification |
|-------|----------------|--------------|
| `profiles` | 1 new row (role = 'teacher') | `SELECT * FROM profiles WHERE profile_id = '{id}'` |
| `teacher_details` | 1 new row (1:1 with profile) | `SELECT * FROM teacher_details WHERE teacher_id = '{id}'` |
| `teacher_employment_records` | 1 new row (if set) | `SELECT * FROM teacher_employment_records WHERE teacher_id = '{id}'` |
| Auth | 1 new auth user | Supabase Auth admin API |

### 8.2 Approve Question

| Table | Expected Change | Verification |
|-------|----------------|--------------|
| `questions` | status → 'published' | `SELECT status FROM questions WHERE question_id = '{id}'` |
| `questions` | approved_by set | `SELECT approved_by FROM questions WHERE question_id = '{id}'` |
| `questions` | approved_at set | `SELECT approved_at FROM questions WHERE question_id = '{id}'` |
| `audit_logs` | 1 new log | `SELECT * FROM audit_logs WHERE resource_id = '{id}'` |

### 8.3 Publish Mock Test

| Table | Expected Change | Verification |
|-------|----------------|--------------|
| `mock_tests` | status → 'published' | `SELECT status FROM mock_tests WHERE test_id = '{id}'` |
| `mock_tests` | published_at set | `SELECT published_at FROM mock_tests WHERE test_id = '{id}'` |
| `mock_test_questions` | question_snapshot populated | `SELECT question_snapshot FROM mock_test_questions WHERE test_id = '{id}'` |

### 8.4 Approve Content

| Table | Expected Change | Verification |
|-------|----------------|--------------|
| `approval_requests` | status → 'approved' | `SELECT status FROM approval_requests WHERE approval_id = '{id}'` |
| `approval_requests` | reviewed_by set | `SELECT reviewed_by FROM approval_requests WHERE approval_id = '{id}'` |
| `approval_requests` | reviewed_at set | `SELECT reviewed_at FROM approval_requests WHERE approval_id = '{id}'` |
| `content` | status → 'approved' | `SELECT status FROM content WHERE content_id = '{resource_id}'` |

### 8.5 Create Order

| Table | Expected Change | Verification |
|-------|----------------|--------------|
| `orders` | 1 new row | `SELECT * FROM orders WHERE order_id = '{id}'` |
| `order_items` | 1+ new rows | `SELECT * FROM order_items WHERE order_id = '{id}'` |
| `payments` | 1 new row (pending) | `SELECT * FROM payments WHERE order_id = '{id}'` |
| `invoices` | 1 new row | `SELECT * FROM invoices WHERE order_id = '{id}'` |

### 8.6 Process Refund

| Table | Expected Change | Verification |
|-------|----------------|--------------|
| `orders` | status → 'refunded', refunded_at set | `SELECT status, refunded_at FROM orders WHERE order_id = '{id}'` |
| `payments` | status → 'refunded' or 'partially_refunded' | `SELECT status FROM payments WHERE payment_id = '{id}'` |
| `student_subscriptions` | status → 'cancelled' (if subscription) | `SELECT status FROM student_subscriptions WHERE order_id = '{id}'` |

### 8.7 Send Notification

| Table | Expected Change | Verification |
|-------|----------------|--------------|
| `notifications` | 1 new row | `SELECT * FROM notifications WHERE notification_id = '{id}'` |
| `notification_recipients` | N new rows | `SELECT COUNT(*) FROM notification_recipients WHERE notification_id = '{id}'` |

### 8.8 Create Subscription Plan

| Table | Expected Change | Verification |
|-------|----------------|--------------|
| `subscription_plans` | 1 new row | `SELECT * FROM subscription_plans WHERE plan_id = '{id}'` |
| `plan_unlocks` | N new rows (one per feature) | `SELECT * FROM plan_unlocks WHERE plan_id = '{id}'` |

### 8.9 Cancel Student Subscription

| Table | Expected Change | Verification |
|-------|----------------|--------------|
| `student_subscriptions` | status → 'cancelled' | `SELECT status FROM student_subscriptions WHERE subscription_id = '{id}'` |
| `subscription_cancellations` | 1 new row | `SELECT * FROM subscription_cancellations WHERE subscription_id = '{id}'` |
| `subscription_history` | 1 new row (auto-trigger) | `SELECT * FROM subscription_history WHERE subscription_id = '{id}'` |

### 8.10 Create API Key

| Table | Expected Change | Verification |
|-------|----------------|--------------|
| `api_keys` | 1 new row | `SELECT * FROM api_keys WHERE key_id = '{id}'` |
| Key returned | 1 key shown once | Verify key is masked after page reload |

---

## 9. UI Testing Checklist

### 9.1 Responsive Design

| Test | Breakpoint | Expected Behavior |
|------|------------|-------------------|
| Desktop | ≥ 1024px | Full layout: sidebar visible, multi-column grids, table actions visible |
| Tablet | 768px - 1023px | Sidebar collapses to icons, grids reduce to 2 columns |
| Mobile | < 768px | Hamburger menu, single-column layout, hidden table columns |
| XL Desktop | ≥ 1440px | Max-width containers, extra white space utilized |

### 9.2 Dark Mode

| Test | Expected Behavior |
|------|-------------------|
| Theme toggle | Light/Dark toggle works (via settings or system preference) |
| All pages | Consistent dark backgrounds across all modules |
| Text contrast | WCAG AA contrast ratio (4.5:1 normal text) |
| Borders/separators | Visible in dark mode (e.g., `dark:border-gray-700`) |
| Cards/modals | Dark background with proper contrast |
| Charts | Colors remain distinguishable in dark mode |
| Tables | Alternating rows visible |
| Forms | Input backgrounds readable |

### 9.3 Loading States

| Component | Expected Behavior |
|-----------|-------------------|
| Stat cards | Skeleton animation during data fetch |
| Data tables | Row skeletons preserving table structure |
| Charts | Placeholder rectangle until data loads |
| Profile | Avatar + text line skeletons |
| Detail views | Content area skeleton |

### 9.4 Empty States

| Page | Empty State Message | Action |
|------|---------------------|--------|
| Teacher List | "No teachers found" | "Create Teacher" button |
| Student List | "No students found" | "Create Student" + "Import" buttons |
| Question Bank | "No questions found" | "Create Question" + "Import" buttons |
| Mock Tests | "No mock tests found" | "Create Test" button |
| Batches | "No batches found" | "Create Batch" button |
| Content Library | "No content pending" | Informational |
| Approval Center | "No pending approvals" | Informational (green checkmark) |
| Results | "No results yet" | Informational |
| Notifications | "No notifications sent" | "Create Notification" |
| Orders | "No orders found" | Informational |

### 9.5 Pagination

| Test | Expected Behavior |
|------|-------------------|
| Page click | Loads that page |
| Previous/Next | Navigates one page |
| Count display | Shows "Showing 1-20 of N" |
| Last page | "Next" disabled |
| First page | "Previous" disabled |
| Filter change | Resets to page 1 |

### 9.6 Modals & Dialogs

| Test | Expected Behavior |
|------|-------------------|
| Close via X | Dialog closes |
| Close via backdrop | Dialog closes (configurable) |
| Confirm action | Action executes, dialog closes |
| Cancel action | Dialog closes, no action |
| Escape key | Dialog closes |
| Focus trap | Tab cycles within dialog |
| ARIA | `role="dialog"`, `aria-modal` |

### 9.7 Accessibility

| Test | Expected Behavior |
|------|-------------------|
| Keyboard navigation | All interactive elements Tab-reachable |
| Tab order | Logical order following visual layout |
| Form labels | All inputs have `<label>` elements |
| ARIA labels | Icons/buttons have `aria-label` |
| Switch role | Toggles use `role="switch"` with `aria-checked` |
| Focus indicators | Visible focus ring on all interactive elements |
| Color contrast | WCAG AA (4.5:1 for normal text) |

### 9.8 Form Feedback

| Test | Expected Behavior |
|------|-------------------|
| Validation error | Red border + error message below field |
| API error | Error banner at top of form |
| Success message | Green success toast/banner |
| Loading state | Button shows spinner, inputs disabled |

---

## 10. Security Testing Checklist

### 10.1 Authentication

| Test | Expected Behavior |
|------|-------------------|
| Brute force protection | Multiple failed attempts trigger rate limiting |
| Session management | JWT tokens auto-refresh, secure storage |
| Session expiry | Expired tokens redirect to login |
| No direct DB access | All operations go through Supabase anon key |
| Password requirements | Min 6 characters enforced |

### 10.2 Authorization (RLS)

| Test | Expected Behavior |
|------|-------------------|
| Cross-institute isolation | Admin A cannot see Institute B's data |
| Admin cannot access other institute's teachers | RLS: institute_id scoped |
| Teacher cannot access admin screens | RLS blocks audit_logs, system_settings, etc. |
| Student cannot access admin screens | RLS blocks all admin operations |
| Deactivated users blocked | is_active = false prevents login |
| API key scopes enforced | Read-only key cannot write |

### 10.3 Data Protection

| Test | Expected Behavior |
|------|-------------------|
| Sensitive data masking | Bank account numbers masked |
| Password storage | Hashed (Supabase Auth managed) |
| No plaintext secrets | Webhook secrets encrypted |
| XSS prevention | User content sanitized before rendering |
| SQL injection | Parameterized queries via Supabase client |

### 10.4 Session Management

| Test | Expected Behavior |
|------|-------------------|
| Logout clears session | Supabase session destroyed |
| Token refresh | Refresh token used on expiry |
| No sensitive data in localStorage | Only preferences cached |
| Auto-logout | Session expires after inactivity (configurable) |

---

## 11. Performance Testing Checklist

### 11.1 Large Dataset Testing

| Test | Dataset Size | Expected Behavior |
|------|-------------|-------------------|
| Teacher List | 500 teachers | Pagination renders 20/page. Search under 2 seconds. |
| Student List | 10,000 students | Pagination + server-side search. Filters < 3 seconds. |
| Question Bank | 10,000 questions | Pagination + indexed search. Filters < 2 seconds. |
| Mock Tests | 500 tests | Pagination loads quickly. Status filter works. |
| Results | 50,000 results | Aggregated queries use denormalized fields. |
| Orders | 10,000 orders | Pagination + date filtering essential. |
| Audit Logs | 100,000 entries | Date range filtering critical. Export aggregates. |

### 11.2 Loading Time Targets

| Page | Target Load Time | Notes |
|------|-----------------|-------|
| Dashboard | < 2 seconds | Multiple parallel queries, widgets render progressively |
| Teacher List | < 1.5 seconds | Paginated query |
| Student List | < 2 seconds | Paginated query with joins |
| Question Bank | < 1.5 seconds | Paginated query |
| Mock Test List | < 1.5 seconds | Paginated query |
| Result Detail | < 1 second | Single result query |
| Approval Center | < 2 seconds | Multiple union queries |
| Reports | < 30 seconds | Async generation for large datasets |
| Settings | < 1 second | Simple reads |

### 11.3 API Response Targets

| Endpoint Type | Target | Notes |
|---------------|--------|-------|
| List endpoints | < 500ms | Paginated, indexed |
| Detail endpoints | < 200ms | Single record fetch |
| Create/Update | < 500ms | With validation |
| Export | < 30s / 1000 records | Async generation |
| Dashboard aggregations | < 2s | Multiple count queries |

---

## 12. Error Scenarios

### 12.1 Network & Server Errors

| Scenario | Expected UI Behavior | Recovery |
|----------|---------------------|----------|
| Supabase connection lost | Error banner: "Connection lost. Retrying..." | Auto-retry 3 times. "Retry Now" button. |
| API returns 500 | Toast: "Something went wrong. Please try again." | Log error. User retries. |
| API returns 403 | Error: "You don't have permission to perform this action." | Contact admin message. |
| API returns 429 (rate limited) | "Too many requests. Please wait a moment." | Exponential backoff. |
| Network timeout | "Request timed out. Check your connection." | Retry button. |
| File upload failure | "Upload failed. Please try again." | Retry/resume upload. |

### 12.2 Validation Errors

| Scenario | Expected UI Behavior |
|----------|---------------------|
| Required field missing | Red border + error message below field |
| Duplicate entry | Toast: "A record with this [field] already exists." |
| Invalid format | Specific format error (e.g., "Invalid phone number format") |
| Max length exceeded | Character counter turns red. "Maximum N characters" |
| Min length not met | "Must be at least N characters" |
| FK constraint violation | "Referenced record not found. Please refresh and try again." |

### 12.3 Business Logic Errors

| Scenario | Expected UI Behavior |
|----------|---------------------|
| Delete question with attempts | "Cannot delete: Question has been used in {N} attempts." |
| Publish empty test | "Test must contain at least one question before publishing." |
| Enroll in full batch | "Batch is at full capacity ({max}/{max}). Contact admin." |
| Archive active subscription plan | "N active subscriptions will not be affected. Proceed?" |
| Cancel with no reason | "Cancellation reason is required." |
| Duplicate enrollment in batch | "Student is already enrolled in this batch." |

### 12.4 Session Errors

| Scenario | Expected UI Behavior |
|----------|---------------------|
| Expired session | Redirect to login. Toast: "Session expired. Please login again." |
| Invalid token | Redirect to login. "Authentication failed. Please login." |
| Account deactivated mid-session | Next API call returns 403. Redirect to login. "Account deactivated." |
| Multiple tabs logout | All tabs detect session loss and redirect. |

### 12.5 Permission Errors

| Scenario | Expected UI Behavior |
|----------|---------------------|
| Teacher tries admin route | 403 page: "Access denied. Admin privileges required." |
| Admin tries other institute | Error: "Cross-institute access not permitted." |
| View sensitive data without permission | Field masked or hidden. "Contact admin for access." |
| Edit locked resource | Action disabled. Tooltip: "This resource is locked." |

---

## 13. Acceptance Criteria

### 13.1 Dashboard

**Done when:**
- ☐ All widgets display accurate aggregated data within 2 seconds
- ☐ Quick Stats row shows: Students, Teachers, Revenue, Mock Tests, Batches, Questions
- ☐ Pending Approvals panel shows correct counts for content, questions, tests, KYC, leave
- ☐ Quick Actions navigate to correct management screens
- ☐ Revenue Trend chart (6-month) renders correctly
- ☐ Student Growth chart (6-month) renders correctly
- ☐ Recent Activity feed shows latest 10 events with timestamps
- ☐ Upcoming Live Classes widget shows next 5 scheduled classes
- ☐ System Health indicator shows correct status
- ☐ All counts match actual database records

### 13.2 Institute Management

**Done when:**
- ☐ Institute profile viewable and editable
- ☐ Institute name, slug, domain configurable
- ☐ Logo can be uploaded
- ☐ Plan tier changeable (Super Admin)
- ☐ Institute can be activated/deactivated
- ☐ Changes reflected across the platform

### 13.3 Teacher Management

**Done when:**
- ☐ Teacher can be created with all required fields
- ☐ Duplicate phone is prevented
- ☐ Teacher list viewable with search and filters
- ☐ Teacher profile shows personal info, HR records, analytics
- ☐ Teacher can be edited
- ☐ Teacher can be activated/deactivated
- ☐ Subject specializations assignable
- ☐ Batch assignments manageable
- ☐ KYC documents verifiable/rejectable
- ☐ Qualifications verifyable
- ☐ Experience verifyable
- ☐ Bank details verifyable
- ☐ Leave requests approvable/rejectable
- ☐ Teacher analytics viewable
- ☐ Activity log viewable
- ☐ Password resettable
- ☐ Pagination works

### 13.4 Student Management

**Done when:**
- ☐ Student can be created with all required fields
- ☐ Duplicate enrollment number prevented
- ☐ Bulk import works (CSV/Excel)
- ☐ Bulk import validates all rows
- ☐ Student list viewable with search and filters
- ☐ Student profile shows personal info, performance, history
- ☐ Batch enrollment works
- ☐ Batch capacity respected
- ☐ Batch transfer works
- ☐ Performance, attendance, orders, subscriptions viewable
- ☐ PYQ access grantable/revocable
- ☐ Student activatable/deactivatable

### 13.5 Academic Structure

**Done when:**
- ☐ Streams CRUD works
- ☐ Subjects CRUD works (per stream)
- ☐ Chapters CRUD works (per subject)
- ☐ Topics CRUD works (per chapter)
- ☐ Reordering works at all levels
- ☐ Unique naming enforced (subject per stream, chapter per subject)
- ☐ Navigation hierarchy (drill-down) works correctly

### 13.6 Batch Management

**Done when:**
- ☐ Batch CRUD works
- ☐ Capacity enforcement works
- ☐ Teacher assignments work
- ☐ Student enrollment works
- ☐ Batch transfer works
- ☐ Student drop works
- ☐ Status transitions valid
- ☐ Batch roster viewable

### 13.7 Content Management

**Done when:**
- ☐ Content library browsable with filters
- ☐ Content detail viewable with preview
- ☐ Content approvable with optional remarks
- ☐ Content rejectable (reason required)
- ☐ Approval updates content status
- ☐ Rejection returns content to teacher
- ☐ Filters (status, type, teacher, chapter, date) work

### 13.8 Question Bank

**Done when:**
- ☐ All 4 question types (MCQ, MSQ, Numerical, True/False) creatable
- ☐ MCQ validation: exactly 1 correct option
- ☐ MSQ validation: at least 1 correct option
- ☐ Numerical answer with tolerance supported
- ☐ Question text minimum 10 characters enforced
- ☐ Marks > 0 enforced
- ☐ Negative marks ≥ 0 enforced
- ☐ Question status lifecycle works (draft → pending_approval → published → archived)
- ☐ Questions approvable/rejectable
- ☐ Questions deletable (if unused) / non-deletable (if used)
- ☐ Version increments on edit
- ☐ Options, explanations, images manageable
- ☐ Bulk import works (CSV/Excel)
- ☐ Search and filters work
- ☐ Pagination works (20 per page)

### 13.9 Mock Test Management

**Done when:**
- ☐ Mock test CRUD works
- ☐ Questions can be added, removed, reordered
- ☐ Per-question marks/negative marks configurable
- ☐ Test publishable with validation
- ☐ Publishing freezes question snapshot
- ☐ Tests archivable/restorable
- ☐ Results viewable with leaderboard
- ☐ Results releasable/hideable
- ☐ Filters (status) work
- ☐ Pagination works

### 13.10 Results & Analytics

**Done when:**
- ☐ Result detail shows: percentage, score, accuracy, correct/wrong/skipped, time, rank
- ☐ Subject breakdown shown (when available)
- ☐ Chapter breakdown shown (when available)
- ☐ Results releasable/hideable
- ☐ Leaderboard viewable
- ☐ Exports generate (CSV/Excel/PDF)
- ☐ Filters (test, batch, student, date) work

### 13.11 Approval Center

**Done when:**
- ☐ Unified queue shows all pending items
- ☐ Content approvable/rejectable
- ☐ Mock tests approvable/rejectable
- ☐ Questions approvable/rejectable
- ☐ Teacher KYC pending items shown
- ☐ Leave pending items shown
- ☐ Filters (resource type, date, teacher) work
- ☐ Empty state shown when no pending items

### 13.12 PYQ Management

**Done when:**
- ☐ Package CRUD works
- ☐ Papers can be added to packages
- ☐ Questions can be mapped to papers
- ☐ Solutions manageable
- ☐ Packages activatable/deactivatable
- ☐ Student access grantable/revocable
- ☐ Sales/purchase history viewable

### 13.13 Notifications

**Done when:**
- ☐ Templates creatable with placeholders
- ☐ Broadcasts can be sent to target audience
- ☐ Notifications can be scheduled
- ☐ Sent history viewable
- ☐ Read/delivery status viewable
- ☐ Notifications soft-deletable

### 13.14 Teacher HR

**Done when:**
- ☐ Employment record viewable/editable
- ☐ Qualifications viewable/verifiable
- ☐ Experience viewable/verifiable
- ☐ Documents viewable/verifiable/rejectable
- ☐ Bank details viewable/verifiable
- ☐ Availability viewable/manageable
- ☐ Leave requests viewable/approvable/rejectable

### 13.15 Orders & Payments

**Done when:**
- ☐ Orders list viewable with filters
- ☐ Order detail shows line items, payments, invoices
- ☐ Orders cancellable
- ☐ Refunds processable (full/partial)
- ☐ Payment history viewable

### 13.16 Subscription Plans

**Done when:**
- ☐ Plan CRUD works
- ☐ Feature unlocks configurable
- ☐ Plans activatable/deactivatable
- ☐ Active subscribers count shown

### 13.17 Student Subscriptions

**Done when:**
- ☐ All subscriptions viewable with filters
- ☐ Subscription lifecycle (history, renewals, grace period, usage) visible
- ☐ Manual activation works
- ☐ Cancellation works (with reason)
- ☐ Refund processing works

### 13.18 System Settings

**Done when:**
- ☐ Settings viewable and editable
- ☐ Changes take effect immediately
- ☐ Changes logged in audit trail
- ☐ Feature flags toggleable
- ☐ API keys creatable/revocable
- ☐ Webhooks creatable/testable/deactivatable
- ☐ Audit logs viewable with filters
- ☐ Audit logs exportable
- ☐ Media library browsable with upload/delete

### 13.19 Support Tickets

**Done when:**
- ☐ All tickets viewable with filters
- ☐ Tickets assignable to staff
- ☐ Replies can be sent
- ☐ Tickets resolvable/closable

### 13.20 Navigation

**Done when:**
- ☐ Sidebar contains all modules with correct routes
- ☐ Active item highlighted
- ☐ Breadcrumbs show current location
- ☐ Quick actions navigate correctly
- ☐ Cross-module links work (student → profile, etc.)

---

## 14. Module Completion Matrix

| Module | Frontend | Backend | Database | QA | Priority | Dependencies |
|--------|:--------:|:-------:|:--------:|:--:|:--------:|--------------|
| **Dashboard** | ❌ Pending | ❌ Pending | ✅ Ready | ❌ Pending | Critical | All modules |
| **Institute Management** | ❌ Pending | ❌ Pending | ✅ Ready | ❌ Pending | Critical | Auth |
| **Teacher Management** | ❌ Pending | ❌ Pending | ✅ Ready | ❌ Pending | Critical | Auth, Institute |
| **Student Management** | ❌ Pending | ❌ Pending | ✅ Ready | ❌ Pending | Critical | Auth, Institute |
| **Academic Structure** | ❌ Pending | ❌ Pending | ✅ Ready | ❌ Pending | Critical | Institute |
| **Batch Management** | ❌ Pending | ❌ Pending | ✅ Ready | ❌ Pending | Critical | Academic, Teachers, Students |
| **Content Management** | ❌ Pending | ❌ Pending | ✅ Ready | ❌ Pending | Critical | Academic, Teachers |
| **Question Bank** | ❌ Pending | ❌ Pending | ✅ Ready | ❌ Pending | Critical | Academic |
| **Mock Test Management** | ❌ Pending | ❌ Pending | ✅ Ready | ❌ Pending | Critical | Ques. Bank, Batches |
| **Results & Analytics** | ❌ Pending | ❌ Pending | ✅ Ready | ❌ Pending | High | Mock Tests, Students |
| **Approval Center** | ❌ Pending | ❌ Pending | ✅ Ready | ❌ Pending | Critical | Content, Tests, Questions |
| **PYQ Management** | ❌ Pending | ❌ Pending | ✅ Ready | ❌ Pending | High | Ques. Bank |
| **Live Classes** | ❌ Pending | ❌ Pending | ✅ Ready | ❌ Pending | Medium | Teachers, Batches |
| **Attendance** | ❌ Pending | ❌ Pending | ✅ Ready | ❌ Pending | Medium | Live Classes, Students |
| **Subscription Plans** | ❌ Pending | ❌ Pending | ✅ Ready | ❌ Pending | High | Institute |
| **Student Subscriptions** | ❌ Pending | ❌ Pending | ✅ Ready | ❌ Pending | High | Plans, Students |
| **Orders & Payments** | ❌ Pending | ❌ Pending | ✅ Ready | ❌ Pending | High | Subscriptions, PYQ |
| **Notifications** | ❌ Pending | ❌ Pending | ✅ Ready | ❌ Pending | High | All modules |
| **Teacher HR** | ❌ Pending | ❌ Pending | ✅ Ready | ❌ Pending | High | Teacher Management |
| **Student Services** | ❌ Pending | ❌ Pending | ✅ Ready | ❌ Pending | Medium | Students |
| **System Settings** | ❌ Pending | ❌ Pending | ✅ Ready | ❌ Pending | Critical | Auth |
| **Feature Flags** | ❌ Pending | ❌ Pending | ✅ Ready | ❌ Pending | High | System Settings |
| **API Keys & Webhooks** | ❌ Pending | ❌ Pending | ✅ Ready | ❌ Pending | Medium | System Settings |
| **Audit Logs** | ❌ Pending | ❌ Pending | ✅ Ready | ❌ Pending | Critical | All modules |
| **Reports** | ❌ Pending | ❌ Pending | ✅ Ready | ❌ Pending | High | All modules |
| **Support Tickets** | ❌ Pending | ❌ Pending | ✅ Ready | ❌ Pending | Medium | Students |
| **Media Library** | ❌ Pending | ❌ Pending | ✅ Ready | ❌ Pending | Medium | Content, Questions |

**Legend:**
- ✅ **Ready** — Database, services, and RLS policies fully implemented
- ⚠️ **Partial** — Some implementation done, gaps remain
- ❌ **Pending** — Not yet implemented

---

## 15. Production Readiness Report

### 15.1 Module Scores

| Module | Business Readiness | Frontend Readiness | Backend Readiness | Risk Level | QA Complexity | Criticality |
|--------|:------------------:|:------------------:|:-----------------:|:----------:|:-------------:|:-----------:|
| **Dashboard** | 100% | 0% | 0% | Medium | Medium | Critical |
| **Institute Management** | 100% | 0% | 0% | Low | Low | Critical |
| **Teacher Management** | 100% | 0% | 0% | High | High | Critical |
| **Student Management** | 100% | 0% | 0% | High | High | Critical |
| **Academic Structure** | 100% | 0% | 0% | Low | Low | Critical |
| **Batch Management** | 100% | 0% | 0% | Medium | Medium | Critical |
| **Content Management** | 100% | 0% | 0% | Medium | Medium | Critical |
| **Question Bank** | 100% | 0% | 0% | High | High | Critical |
| **Mock Test Management** | 100% | 0% | 0% | High | High | Critical |
| **Results & Analytics** | 100% | 0% | 0% | High | High | High |
| **Approval Center** | 100% | 0% | 0% | Medium | Medium | Critical |
| **PYQ Management** | 100% | 0% | 0% | Medium | Medium | High |
| **Live Classes** | 100% | 0% | 0% | Medium | Medium | Medium |
| **Attendance** | 100% | 0% | 0% | Low | Low | Medium |
| **Subscription Plans** | 100% | 0% | 0% | Medium | Medium | High |
| **Student Subscriptions** | 100% | 0% | 0% | High | High | High |
| **Orders & Payments** | 100% | 0% | 0% | High | High | High |
| **Notifications** | 100% | 0% | 0% | Medium | Medium | High |
| **Teacher HR** | 100% | 0% | 0% | High | High | High |
| **Student Services** | 100% | 0% | 0% | Medium | Medium | Medium |
| **System Settings** | 100% | 0% | 0% | Low | Low | Critical |
| **Feature Flags** | 100% | 0% | 0% | Low | Low | High |
| **API Keys & Webhooks** | 100% | 0% | 0% | Medium | Medium | Medium |
| **Audit Logs** | 100% | 0% | 0% | Low | Low | Critical |
| **Reports** | 100% | 0% | 0% | Medium | Medium | High |
| **Support Tickets** | 100% | 0% | 0% | Medium | Medium | Medium |
| **Media Library** | 100% | 0% | 0% | Low | Low | Medium |

### 15.2 Overall Readiness

| Area | Score | Notes |
|------|:----:|-------|
| **Business Specification** | 100% | Complete functional spec v2.0 |
| **Database Schema** | 100% | All 15 domains implemented across 25 migrations |
| **RLS Policies** | 100% | Full admin access on all tables within institute scope |
| **Frontend Implementation** | 0% | Admin Dashboard not yet built |
| **Backend Services** | 0% | Admin-specific services not yet built |
| **API Layer** | 0% | Admin API endpoints not yet built |
| **Test Coverage** | 0% | No automated tests yet |
| **Documentation** | 100% | Spec + Testing/Flow document complete |

### 15.3 Must-Complete Before Phase 1 Launch

1. **🔴 Build Admin Frontend** — All 75+ screens need to be built (see Screen List in functional spec)
2. **🔴 Build Admin API Layer** — REST endpoints for all modules
3. **🔴 Build Admin Services** — Service layer connecting frontend to Supabase
4. **🔴 Authentication Flow for Admin** — Admin-specific login redirection and session handling
5. **🟡 Cross-Institute RLS Testing** — Verify Super Admin can access multiple institutes
6. **🟡 Large Dataset Performance Testing** — Test with production-scale data
7. **🟡 Error Handling & Loading States** — Implement across all screens
8. **🟡 Dark Mode Implementation** — Ensure consistent dark mode across admin screens

---

## 16. Phase 2 Roadmap

### 16.1 Future Modules (Post-Phase 1)

| Module | Effort | Dependencies | Description |
|--------|--------|--------------|-------------|
| **Live Class Management** (Full) | Large | Jitsi integration | Full live class CRUD for admin |
| **AI Question Generator** | Extra Large | Question Bank | Auto-generate questions from chapter content |
| **AI Analytics** | Large | Analytics data | Predictive student performance insights |
| **Payment Gateway** | Large | Commerce | Razorpay/Stripe integration |
| **Certificate Generation** | Medium | Results | Auto-generate completion certificates |
| **Attendance System** (Full) | Medium | Live Classes | Advanced attendance reports |
| **Parent Portal** | Large | Students | Parent access to student performance |
| **CRM** | Extra Large | Students, Orders | Student acquisition and retention |
| **Help Desk** | Medium | Support Tickets | Knowledge base + automated responses |
| **WhatsApp Integration** | Medium | Notifications | WhatsApp notification channel |
| **Email Campaigns** | Medium | Notifications | Bulk email marketing |
| **Push Notifications** | Medium | Notifications | Mobile push integration |
| **Coupon Management** | Medium | Orders | Discount code management |
| **Scheduled Reports** | Medium | Reports | Automated email delivery |
| **Two-Factor Auth** | Medium | Auth | 2FA for admin accounts |
| **Backup & Restore** | Medium | Infrastructure | Automated database backups |
| **System Monitoring** | Medium | Infrastructure | Advanced monitoring with alerts |

### 16.2 Phase 2 Timeline Estimate

| Phase | Duration | Focus |
|-------|----------|-------|
| **Phase 1** | 10-12 weeks | Core operations (MVP): Teacher/Student management, Academic, Question Bank, Mock Tests, Dashboard, Approvals |
| **Phase 2** | 8-10 weeks | Commerce & Analytics: Subscriptions, Payments, PYQ, Notifications, Reports, Teacher HR |
| **Phase 3** | 10-14 weeks | Advanced: Live Classes, AI, Automation, Monitoring, Support |

---

## Appendix A: Key Database Tables

| Table | Purpose | Key Admin Columns |
|-------|---------|-------------------|
| `institutes` | Institute configuration | institute_id, name, slug, plan_tier, is_active |
| `profiles` | User profiles (all roles) | profile_id, institute_id, name, phone, role, is_active |
| `teacher_details` | Teacher-specific data | teacher_id, profile_id, specialization, qualification, rating |
| `student_details` | Student-specific data | student_id, profile_id, enrollment_no, target_year |
| `streams` | Academic streams | stream_id, institute_id, name, code, display_order, is_active |
| `subjects` | Subjects within streams | subject_id, stream_id, name, code, display_order |
| `chapters` | Chapters within subjects | chapter_id, subject_id, name, display_order |
| `topics` | Topics within chapters | topic_id, chapter_id, name, display_order |
| `batches` | Student batches | batch_id, stream_id, name, code, max_seats, status |
| `batch_teachers` | Teacher-batch assignment | batch_id, teacher_id, role_in_batch |
| `batch_students` | Student-batch enrollment | batch_id, student_id, status, enrolled_at |
| `questions` | Question bank | question_id, subject_id, chapter_id, question_type, difficulty, status, marks |
| `question_options` | Answer options | option_id, question_id, option_text, is_correct, order_sequence |
| `question_explanations` | Solution explanations | explanation_id, question_id, explanation_text, correct_numerical_answer |
| `mock_tests` | Test configurations | test_id, teacher_id, stream_id, title, duration_min, total_marks, status |
| `mock_test_questions` | Test-question junction | test_id, question_id, marks, order_sequence, question_snapshot |
| `mock_attempts` | Student attempts | attempt_id, test_id, student_id, status, started_at |
| `mock_results` | Computed results | result_id, attempt_id, total_score, percentage, rank, is_released |
| `content` | Learning materials | content_id, teacher_id, chapter_id, title, content_type, status |
| `approval_requests` | Approval workflow | approval_id, resource_type, resource_id, status, requested_by, reviewed_by |
| `orders` | Purchase orders | order_id, student_id, total_amount, status, confirmed_at |
| `payments` | Payment transactions | payment_id, order_id, amount, status, gateway |
| `invoices` | GST invoices | invoice_id, order_id, invoice_number, pdf_url |
| `subscription_plans` | Subscription tiers | plan_id, institute_id, name, price, billing_cycle, duration_days |
| `student_subscriptions` | Active subscriptions | subscription_id, student_id, plan_id, status, start_date, end_date |
| `notifications` | Notification events | notification_id, institute_id, title, body, event_type, channel |
| `notification_recipients` | Per-user notification status | recipient_id, notification_id, profile_id, is_read |
| `teacher_employment_records` | Teacher HR | teacher_id, employment_type, salary_basis, base_salary |
| `teacher_documents` | KYC documents | document_id, teacher_id, document_type, status, verified_by |
| `teacher_leave_requests` | Leave management | leave_id, teacher_id, leave_category, status, start_date, end_date |
| `support_tickets` | Student support | ticket_id, student_id, subject, status, priority |
| `audit_logs` | Immutable activity trail | log_id, profile_id, action, resource_type, resource_id, before, after |
| `system_settings` | System configuration | setting_key, setting_value, data_type, is_active |
| `feature_flags` | Feature toggles | flag_id, key, description, is_enabled |
| `api_keys` | Programmatic access | key_id, profile_id, name, key_hash, scopes, expires_at |
| `webhook_endpoints` | Event integrations | endpoint_id, url, secret, event_types, is_active |

---

## Appendix B: Document Change Log

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | July 8, 2026 | Senior QA Engineer / Product Manager | Initial comprehensive testing and functional flow document |
