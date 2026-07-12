# Teacher Dashboard — Testing & Functional Flow

> **Document Version:** 1.0  
> **Prepared for:** QA Team, Developers, Product Managers  
> **Last Updated:** July 2026  
> **Scope:** Complete Teacher Dashboard (Phase 1)

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Module-by-Module Functional Flow](#2-module-by-module-functional-flow)
3. [Screen Flow](#3-screen-flow)
4. [User Journeys](#4-user-journeys)
5. [Manual Test Cases](#5-manual-test-cases)
6. [Validation Checklist](#6-validation-checklist)
7. [API Testing Checklist](#7-api-testing-checklist)
8. [Database Verification Checklist](#8-database-verification-checklist)
9. [UI Testing Checklist](#9-ui-testing-checklist)
10. [Performance Checklist](#10-performance-checklist)
11. [Security Checklist](#11-security-checklist)
12. [Remaining Backend Dependencies](#12-remaining-backend-dependencies)
13. [Acceptance Criteria](#13-acceptance-criteria)
14. [Production Readiness Report](#14-production-readiness-report)
15. [Phase 2 Roadmap](#15-phase-2-roadmap)

---

## 1. Project Overview

### What is the Teacher Dashboard?

The Teacher Dashboard is a web application built with Next.js (App Router), React, TypeScript, and Tailwind CSS, backed by Supabase (PostgreSQL + Auth + Storage). It enables teachers at educational institutes to manage their entire academic workflow: authoring questions, creating mock tests, viewing student performance, sending notifications, managing their profile, and accessing analytics.

### Primary Users

- **Teachers** — The sole user role for this dashboard. Each teacher is mapped to a `teacher_details` record in the database, with RLS (Row-Level Security) enforcing access to their own resources and their assigned students.

### Purpose

To provide a single, unified interface where teachers can:
- Monitor class performance via dashboard widgets
- Create and manage a question bank (MCQ, MSQ, Numerical, True/False)
- Compose and publish mock tests
- View student results with subject/chapter-level breakdowns
- Track student lists with filters and performance data
- Send announcements and notifications
- View analytics across tests, subjects, chapters, and student cohorts
- Manage their professional profile and account settings

### Overall Workflow

```
Teacher Login (Phone + Password / OTP)
         │
         ▼
    ┌──────────────────────────────────────────────┐
    │                 DASHBOARD                     │
    │  ┌──────┬──────┬──────┬──────┬──────┬──────┐  │
    │  │Stats │Quick │Recent│Top/  │Active│Notif.│  │
    │  │Cards │Action │Activ.│Weak  │Class │Feed  │  │
    │  └──────┴──────┴──────┴──────┴──────┴──────┘  │
    └─────────────────────┬──────────────────────────┘
                          │
                          ▼
    ┌──────────┐  ┌──────────────┐  ┌──────────────┐
    │QUESTION  │→│  MOCK TESTS  │→│   RESULTS    │
    │  BANK    │  │(Create/Manage)│  │(View/Release)│
    └──────────┘  └──────────────┘  └──────────────┘
         │               │                 │
         ▼               ▼                 ▼
    ┌──────────┐  ┌──────────────┐  ┌──────────────┐
    │ STUDENTS │→│ NOTIFICATIONS│→│  ANALYTICS   │
    │(List/View)│  │(Send/History)│  │(Dashboard &  │
    └──────────┘  └──────────────┘  │  Per-Test)   │
                                    └──────────────┘
         │
         ▼
    ┌──────────┐  ┌──────────┐
    │ PROFILE  │→│ SETTINGS │
    │(View/Edit)│  │(Appearance,│
    │(Security)│  │  Privacy,  │
    │(Activity)│  │  Data, etc.│
    │(Notif.   │  └──────────┘
    │  Prefs)  │
    └──────────┘
```

### Module Summary

| Module | Routes | Purpose |
|--------|--------|---------|
| **Authentication** | `/login` | Phone + password login/register with OTP verification |
| **Dashboard** | `/teacher` | Home page with stats, widgets, recent activity |
| **Question Bank** | `/teacher/questions/*` | Create, list, preview, import questions |
| **Mock Tests** | `/teacher/mock-tests/*` | Create, configure, publish, manage tests |
| **Results** | `/teacher/results/*` | View individual and aggregate results |
| **Students** | `/teacher/students/*` | List students, view profiles and performance |
| **Notifications** | `/teacher/notifications/*` | View, send, schedule notifications |
| **Analytics** | `/teacher/analytics/*` | 9 pages: dashboard, students, tests, subjects, chapters, questions, trends, leaderboards, insights |
| **Profile** | `/teacher/profile/*` | View/edit profile, activity, security, notification prefs |
| **Settings** | `/teacher/settings` | Appearance, language, timezone, privacy, data |

---

## 2. Module-by-Module Functional Flow

### 2.1 Authentication

**Purpose:** Teachers authenticate using phone number + password. Registration requires OTP verification via SMS.

**Business Logic:**
- Login: Phone (+ country code) + password → Supabase Auth → fetch profile
- Register: Phone + password + name → Supabase signUp → SMS OTP → verify OTP → create teacher_details → auto-login
- Demo mode: Offline fallback using `t-sim-101` / `a-sim-001` credentials when Supabase is unreachable
- Session management: JWT tokens, auto-refresh via Supabase client

**Dependencies:**
- `authService.ts` — encapsulates all Supabase Auth operations
- `AuthContext.tsx` — React context providing session, user, teacherProfile, instituteId
- `useAuth.ts` — hook wrapping Redux dispatch for auth actions

**Output:**
- Authenticated session stored in Supabase client
- `UserProfile` and `TeacherProfile` loaded into global state
- Redirect to `/teacher/dashboard`

---

### 2.2 Dashboard

**Purpose:** Home page showing key metrics, quick actions, recent activity, top/weak performers, and notifications at a glance.

**Workflow:**
```
Page Load
   │
   ├── Fetch teacher overview data → teacherService.getTeacherOverviewData()
   ├── Fetch mock tests → useMockTests() → mockTestService.getMockTests()
   ├── Fetch questions → useQuestions() → questionService.getQuestions()
   ├── Fetch results → useResults() → mockResultService.getResults()
   ├── Fetch teacher analytics → useTeacherAnalytics()
   ├── Fetch notifications → useNotifications()
   ├── Fetch batches → teacherService.getAssignedBatches()
   └── Fetch student rosters → teacherService.getStudentRoster()
```

**Expected Result:**
- 8 stat cards: Total Students, Mock Tests, Questions, Published Tests, Avg Score, Avg Accuracy, Active Students, Pending Reviews
- Weekly Activity bar chart
- Difficulty Distribution bars
- Quick Actions grid (6 items)
- Pending Work summary (4 items)
- Recent Activity feed
- Upcoming Classes widget
- Top Performers list
- Need Attention (weak students) list
- Recent Students list
- Notification widget
- Schedule widget
- Teacher Overview (rating, specialization, stats)

---

### 2.3 Question Bank

**Purpose:** Teachers create, edit, manage, and organize questions (MCQ, MSQ, Numerical, True/False).

**Workflow:**
```
Question Bank Dashboard
   │
   ├── View stats (total, published, draft, pending, archived)
   │
   ├── Create Question
   │    ├── Select subject, chapter, topic
   │    ├── Choose question type (MCQ/MSQ/Numerical/TrueFalse)
   │    ├── Set difficulty, marks, negative marks
   │    ├── Write question text
   │    ├── Add options (MCQ/MSQ/TrueFalse) with correct answer(s)
   │    ├── Add explanation text/video URL
   │    ├── Add numerical answer + tolerance (if numerical)
   │    ├── Upload images (optional)
   │    └── Save as Draft or Submit for Approval
   │
   ├── Browse Questions (list view with filters)
   │    ├── Filter by subject, chapter, difficulty, type, status
   │    ├── Search by text
   │    ├── Sort by any column
   │    ├── Bulk select → Publish / Archive / Restore / Delete
   │    └── Pagination (20 per page)
   │
   ├── Import Questions (from Excel/CSV/JSON)
   │
   └── Preview Question
```

**Expected Result:**
- Question appears in the bank after creation
- Status lifecycle: draft → pending_approval → published → archived
- Published questions become selectable during mock test creation
- Bulk actions work on selected questions

---

### 2.4 Mock Tests

**Purpose:** Teachers create, configure, and publish mock tests for students.

**Workflow:**
```
Mock Test Dashboard
   │
   ├── View stats (total, published, draft, pending, archived)
   │
   ├── Create Mock Test
   │    ├── Basic Info: title, description, stream, test type, subject
   │    ├── Timing & Scoring: duration, total marks, passing marks, negative marking, attempt limit
   │    ├── Test Settings: shuffle questions, shuffle options, calculator
   │    ├── Availability & Results: result release mode, date/time windows
   │    └── Create → redirect to Questions page
   │
   ├── Manage Questions (per test)
   │    ├── Add questions from question bank (filtered by subject/chapter)
   │    ├── Set per-question marks and negative marks override
   │    ├── Reorder questions
   │    ├── Section management (multi-section tests)
   │    └── Remove questions
   │
   ├── Publish Workflow
   │    ├── Validate test readiness (questions exist, all published, etc.)
   │    ├── Generate question snapshots (immutable freeze)
   │    └── Transition to published status
   │
   ├── Browse Tests (list view with filters)
   │    ├── Filter by status
   │    ├── Search by title
   │    └── Pagination (20 per page)
   │
   └── Preview Test
```

**Expected Result:**
- Test created in draft status
- Questions can be added/removed/reordered while in draft
- Publishing freezes the question set via snapshots
- Published tests become available to students within their stream

---

### 2.5 Results

**Purpose:** Teachers view student test results with detailed breakdowns, release/hide results.

**Workflow:**
```
Results Dashboard
   │
   ├── View stats (total results, released, avg score, highest, questions answered)
   │
   ├── Browse All Results (list view)
   │    ├── Filter by test, status (released/hidden)
   │    ├── Sort by score, percentage, rank, time, date
   │    └── View individual result
   │
   └── Result Detail
        ├── Score card: percentage, score, accuracy, correct/wrong/skipped, time, rank
        ├── Subject Breakdown (if multi-subject)
        │    └── Per subject: correct/wrong/skipped, score, progress bar
        ├── Chapter Breakdown
        │    └── Per chapter: correct/wrong/skipped, score, progress bar
        ├── Release / Hide result toggle
        └── Link to Question Analysis
```

**Expected Result:**
- Results appear after students submit attempts
- Teachers can release results to make them visible to students
- Subject/chapter breakdowns are displayed when available
- Score color coding: green (≥60%), amber (40-59%), red (<40%)

---

### 2.6 Students

**Purpose:** Teachers view students in their assigned batches, monitor performance and activity.

**Workflow:**
```
Student Dashboard
   │
   ├── View stats (total, active, avg score, avg attendance, batches)
   │
   ├── View All Students (list with filters)
   │    ├── Filter by batch, status
   │    ├── Search by name or roll number
   │    ├── Sort by score, attendance, rank
   │    └── Links to View / Results / Analytics per student
   │
   └── Student Detail
        ├── Profile card (name, roll, rank, score, attendance, status)
        ├── Strong/Weak chapter
        ├── Stats cards (avg score, highest, accuracy, attempts, rank, completion)
        ├── Strong Subjects list
        ├── Weak Subjects list
        ├── Recent Tests list
        └── Links to Analytics, Results, Activity tabs
```

**Expected Result:**
- Students are fetched from teacher's assigned batches only (RLS enforced)
- Full performance data from analytics hooks
- Strong/weak subject identification from chapter breakdowns

---

### 2.7 Notifications

**Purpose:** Teachers view incoming notifications and send announcements to students.

**Workflow:**
```
Notifications Dashboard
   │
   ├── View stats (total, unread, today, announcements, high priority, read rate)
   │
   ├── Create Notification
   │    ├── Select type (announcement, general, live class reminder, mock test reminder, result, custom)
   │    ├── Write title + message
   │    ├── Set priority (low, normal, high, critical)
   │    ├── Target audience (all, specific batch, specific students)
   │    ├── Schedule (immediate or scheduled)
   │    └── Preview → Send
   │
   ├── Recent Notifications list
   │
   ├── Notification History (full list with search/filter/date range)
   │
   ├── Scheduled Notifications list
   │
   └── Individual Notification detail
```

**Expected Result:**
- Notifications from system events appear automatically
- Teachers can create and send announcements (RLS permitting)
- Unread count displayed in dashboard sidebar
- Mark all as read functionality

---

### 2.8 Analytics

**Purpose:** 9-page analytics suite providing deep performance insights.

**Workflow (all 9 pages):**
```
Analytics Dashboard (overview)
   │
   ├── Student Analytics → per-student performance metrics
   ├── Mock Test Analytics → per-test statistics
   ├── Subject Analytics → subject-wise comparison
   ├── Chapter Analytics → chapter-wise breakdown
   ├── Question Analytics → question-level difficulty/accuracy
   ├── Performance Trends → time-series score progression
   ├── Leaderboards → top students, most consistent, most improved
   └── Insights → AI-powered recommendations (future)
```

**Pages implementation:**

| Page | Route | Filter Options | Key Components |
|------|-------|---------------|----------------|
| **Analytics Dashboard** | `/teacher/analytics` | showExport, showBatch | ProgressRing, ScoreCard, ComparisonCard, MetricCards |
| **Student Analytics** | `/teacher/analytics/students` | showExport, showBatch | ProgressRing, ScoreCard (top/weak/needs attention) |
| **Mock Test Analytics** | `/teacher/analytics/mock-tests` | showExport, showMockTest, showBatch | ScoreCard, ComparisonCard |
| **Subject Analytics** | `/teacher/analytics/subjects` | showExport, showBatch, showSubject | ScoreCards (best/weakest subject) |
| **Chapter Analytics** | `/teacher/analytics/chapters` | showExport, showSubject, showBatch | ScoreCards (easiest/hardest chapter) |
| **Question Analytics** | `/teacher/analytics/questions` | showExport, showSubject, showMockTest | ProgressRing, ScoreCard (avg time) |
| **Performance Trends** | `/teacher/analytics/trends` | showExport, showBatch | ComparisonCard, ScoreCards |
| **Leaderboards** | `/teacher/analytics/leaderboards` | showExport, showBatch | ScoreCards (top/most consistent/most improved) |
| **Insights** | `/teacher/analytics/insights` | showExport, showSubject, showBatch | Insights cards (future-ready) |

**Filter Component (`AnalyticsFilter`):**
- `showBatch` — batch dropdown selector
- `showMockTest` — mock test dropdown selector
- `showSubject` — subject dropdown selector
- `showExport` — 3 disabled export buttons (CSV, Excel, PDF) with TODO badge
- `showDateRange` — date range picker

---

### 2.9 Profile

**Purpose:** Teachers view and edit their professional profile, security, activity, and notification preferences.

**Workflow:**
```
Profile View
   │
   ├── Profile Header (photo, name, ID, designation, institute, verification badge)
   ├── Statistics (classes conducted, students, tests, questions, avg score, attendance)
   ├── Personal Information section
   ├── Professional Information section
   ├── Teaching Information section
   ├── Contact Information section
   └── Biography section
   │
   ├── Edit Profile
   │    ├── Full name, display name, profile picture (upload)
   │    ├── Mobile number, email (read-only)
   │    ├── Bio, qualification, experience, specialization, languages
   │    ├── Professional: department, designation, employee code, joining date
   │    └── Academic: assigned subjects, batches, streams
   │
   ├── Account Activity (timeline)
   │    ├── Login history, password changes, profile updates
   │    ├── Mock tests created, questions added, notifications sent, results released
   │    ├── Filter by date range
   │    └── Search activity
   │
   ├── Security
   │    ├── Current login sessions (UI-ready)
   │    ├── Recent devices list
   │    ├── Password last changed indicator
   │    ├── Security status (secure/warning/danger)
   │    └── Actions: change password, logout all devices, 2FA (UI-ready)
   │
   └── Notification Preferences
        ├── In-app / Email / SMS toggle switches
        ├── Mock test alerts, result alerts, student activity alerts
        ├── Live class alerts, marketing notifications
        └── Each with accessible switch role="switch"
```

---

### 2.10 Settings

**Purpose:** Teachers configure application preferences.

**Sections:**
| Section | Options |
|---------|---------|
| **Appearance** | Light / Dark / System (theme toggle cards with immediate apply) |
| **Language & Locale** | 7 languages (English + 6 Indian languages), 10 timezones, 3 date formats, 2 time formats |
| **Dashboard Preferences** | Default view, show stats, show charts, show activity, show notifications |
| **Privacy** | 5 toggle switches (profile visibility, email, phone, messages, analytics) |
| **Session Management** | Remember me, login notifications, auto-logout timer (15/30/60 min) |
| **Connected Accounts** | Google, Microsoft 365, Zoom — all marked "Coming Soon" |
| **Keyboard Shortcuts** | Enable/disable toggle + 12 shortcut reference cards |
| **About & Version** | App name, version, build number, environment |
| **Support & Feedback** | Email link, documentation link, report issue link |
| **Data & Storage** | Cache toggle, auto-download, cache duration selector |
| **Danger Zone** | Reset all settings + clear local data (with confirm dialogs) |

---

## 3. Screen Flow

### 3.1 Dashboard Flow

```
Login
  │
  ▼
Teacher Dashboard (/teacher)
  │
  ├── Click "Create Question" → Question Create (/teacher/questions/create)
  ├── Click "Create Mock Test" → Mock Test Create (/teacher/mock-tests/create)
  ├── Click "View Students" → Students Dashboard (/teacher/students)
  ├── Click "Release Results" → Results List (/teacher/results/list)
  ├── Click "Create Live Class" → Schedule (/teacher/schedule)
  ├── Click "Upload Content" → Content Dashboard (/teacher/content)
  ├── Click any result item → Result Detail (/teacher/results/{id})
  ├── Click any student → Student Profile (/teacher/students/{id})
  └── Click notification → Notification Detail (/teacher/notifications/{id})
```

### 3.2 Question Bank Flow

```
Question Bank Dashboard (/teacher/questions)
  │
  ├── Click "Create Question" → Create Question (/teacher/questions/create)
  │    └── Save as Draft or Submit
  │         └── Redirect to Edit (/teacher/questions/{id}/edit)
  │
  ├── Click "Browse Questions" → Question List (/teacher/questions/list)
  │    ├── Click row → Edit (/teacher/questions/{id}/edit)
  │    ├── Click "Preview" → Preview (/teacher/questions/{id}/preview)
  │    └── Click "Publish" / "Archive" / "Restore" → inline action
  │
  └── Click "Bulk Import" → Import (/teacher/questions/import)
```

### 3.3 Mock Test Flow

```
Mock Test Dashboard (/teacher/mock-tests)
  │
  ├── Click "Create Mock Test" → Create (/teacher/mock-tests/create)
  │    └── Success → Questions Page (/teacher/mock-tests/{id}/questions)
  │         ├── Add questions from bank
  │         └── Click "Publish" → Publish Page (/teacher/mock-tests/{id}/publish)
  │
  └── Click "Browse Tests" → List (/teacher/mock-tests/list)
       ├── Click row → Edit (/teacher/mock-tests/{id}/edit)
       ├── Click "Questions" → Questions (/teacher/mock-tests/{id}/questions)
       ├── Click "Preview" → Preview (/teacher/mock-tests/{id}/preview)
       └── Click "Publish" → Publish Page (/teacher/mock-tests/{id}/publish)
```

### 3.4 Results Flow

```
Results Dashboard (/teacher/results)
  │
  ├── Click "View All Results" → Results List (/teacher/results/list)
  │    └── Click row → Result Detail (/teacher/results/{id})
  │         ├── Click "Release" / "Hide" → toggle visibility
  │         └── Click "Question Analysis" → (/teacher/results/{id}/questions)
  │
  └── Click recent result → Result Detail directly
```

### 3.5 Students Flow

```
Student Dashboard (/teacher/students)
  │
  ├── Click "View All Students" → Student List (/teacher/students/list)
  │    └── Click student → Student Profile (/teacher/students/{id})
  │         ├── Click "Analytics" → (/teacher/students/{id}/analytics)
  │         ├── Click "Results" → (/teacher/students/{id}/results)
  │         └── Click "Activity" → (/teacher/students/{id}/activity)
  │
  └── Click recent student → Student Profile directly
```

### 3.6 Notifications Flow

```
Notifications Dashboard (/teacher/notifications)
  │
  ├── Click "Create Announcement" → Create Notification (/teacher/notifications/create)
  ├── Click "View All" → Notification List (/teacher/notifications/list)
  ├── Click "Scheduled" → Scheduled (/teacher/notifications/scheduled)
  ├── Click "History" → History (/teacher/notifications/history)
  │    └── Click notification → Detail (/teacher/notifications/{id})
  │
  └── Click recent notification → Detail directly
```

### 3.7 Analytics Flow

```
Analytics Dashboard (/teacher/analytics)
  │
  ├── Click any section → respective analytics page
  │    ├── Students (/teacher/analytics/students)
  │    ├── Mock Tests (/teacher/analytics/mock-tests)
  │    ├── Subjects (/teacher/analytics/subjects)
  │    ├── Chapters (/teacher/analytics/chapters)
  │    ├── Questions (/teacher/analytics/questions)
  │    ├── Trends (/teacher/analytics/trends)
  │    ├── Leaderboards (/teacher/analytics/leaderboards)
  │    └── Insights (/teacher/analytics/insights)
  │
  └── Each page has filter controls (batch, subject, mock test, date range, export)
```

### 3.8 Profile Flow

```
Profile View (/teacher/profile)
  │
  ├── Click "Edit Profile" → Edit (/teacher/profile/edit)
  │    └── Save → redirect to View
  │
  ├── Click "Activity" → Account Activity (/teacher/profile/activity)
  ├── Click "Security" → Security (/teacher/profile/security)
  │    ├── Click "Change Password" → opens password change form
  │    └── Click "Logout All Devices" → confirmation
  │
  └── Click "Preferences" → Notification Prefs (/teacher/profile/preferences)
       └── Toggle switches → auto-save to localStorage
```

### 3.9 Settings Flow

```
Settings (/teacher/settings)
  │
  ├── Tab: Appearance → toggle Light/Dark/System
  ├── Tab: Language → select language, timezone, date/time format
  ├── Tab: Dashboard → toggle widgets preferences
  ├── Tab: Privacy → toggle visibility settings
  ├── Tab: Session → set auto-logout, remember me
  ├── Tab: Accounts → view connected accounts (coming soon)
  ├── Tab: Shortcuts → toggle keyboard shortcuts
  ├── Tab: About → app info
  ├── Tab: Support → links
  └── Tab: Data → toggle cache, clear data, danger zone
```

---

## 4. User Journeys

### Journey 1: Teacher Creates and Publishes a Mock Test

```
1. Teacher logs in via phone + password
2. Lands on Dashboard → sees overview stats
3. Clicks "Create Mock Test" quick action
4. Fills in:
   - Title: "NEET 2025 Full Syllabus Mock #5"
   - Description: "Full syllabus mock as per latest NEET pattern"
   - Stream: "NEET UG"
   - Test Type: "Mock Test"
   - Subject: "All Subjects"
   - Duration: 180 min
   - Total Marks: 720
   - Passing Marks: 360
   - Negative Marking: 1
   - Attempt Limit: 3
   - Shuffle Questions: Yes
   - Shuffle Options: No
   - Calculator: No
   - Result Release: Immediate
   - Available From: Now
5. Clicks "Create Test"
6. Redirected to Questions page for the new test
7. Navigates to Question Bank, filters by subject "Physics"
8. Selects 50 Physics questions, adds them with marks=4 each
9. Repeats for Chemistry (50 questions) and Biology (50 questions)
10. Clicks "Publish"
11. Validation passes (150 questions, all published, valid marks)
12. Test published → available to NEET UG students
13. Teacher returns to Dashboard
```

### Journey 2: Teacher Views Student Results

```
1. Teacher clicks "Results" in sidebar
2. Sees Results Dashboard with stats: 45 total, 30 released, 68.5% avg
3. Clicks "View All Results"
4. Filters by a specific test
5. Sorts by percentage descending
6. Clicks a result row
7. Sees detailed result: 68.5% (493/720), Rank #12, 45 min time
8. Scrolls to Subject Breakdown:
   - Physics: 120/180 (67%) — progress bar
   - Chemistry: 158/180 (88%) — progress bar
   - Biology: 215/360 (60%) — progress bar
9. Scrolls to Chapter Breakdown:
   - Electrostatics: 14/20 (70%)
   - Thermodynamics: 8/20 (40%)
   - Organic Chemistry: 18/20 (90%)
10. Decides result looks correct → clicks "Release"
11. Confirms in dialog → result now visible to student
```

### Journey 3: Teacher Views Student Analytics

```
1. Teacher clicks "Students" in sidebar
2. Sees Student Dashboard with 145 total students
3. Clicks "View All Students"
4. Searches by student name "Priya"
5. Finds student → clicks name
6. Sees Student Profile with stats
7. Clicks "Analytics" button
8. Sees detailed analytics page with:
   - Performance trend chart
   - Subject-wise comparison
   - Chapter-wise breakdown
   - Accuracy over time
   - Recommender: "Focus on Wave Optics (42%) and Thermodynamics (38%)"
9. Clicks "Results" to see individual test results
```

### Journey 4: Teacher Sends a Notification

```
1. Teacher clicks "Notifications" in sidebar
2. Sees dashboard: 5 unread, 23 total
3. Clicks "Create Announcement"
4. Selects type: "Announcement"
5. Title: "Holiday Notice - Jan 26"
6. Message: "Institute will remain closed on 26th January. Regular classes resume on 27th."
7. Priority: "Normal"
8. Audience: "All Students & Teachers"
9. Schedule: "Send Immediately"
10. Reviews preview → clicks "Send Now"
11. Redirects to Notifications Dashboard
12. New notification appears in recent list
```

### Journey 5: Teacher Updates Profile

```
1. Teacher clicks profile avatar/name in sidebar header
2. Navigates to Profile page
3. Views current profile: name, photo, designation, stats
4. Clicks "Edit Profile"
5. Updates bio: "Senior Physics faculty with 12+ years of JEE/NEET teaching experience"
6. Uploads new profile photo
7. Updates languages: "Hindi, English"
8. Adds LinkedIn profile URL
9. Clicks "Save Changes"
10. Redirects to Profile View with updated information
11. Navigates to Security tab
12. Clicks "Change Password"
13. Enters current password + new password + confirm
14. Clicks "Update Password"
15. Sees success confirmation
```

---

## 5. Manual Test Cases

### 5.1 Authentication

| Test ID | Feature | Preconditions | Steps | Expected Result | Priority |
|---------|---------|---------------|-------|-----------------|----------|
| TD-AUTH-001 | Login with valid phone | Teacher account exists | 1. Open login page<br>2. Enter phone +919876543210<br>3. Enter password<br>4. Click Login | Redirected to Dashboard. User profile loaded. | High |
| TD-AUTH-002 | Login with invalid phone | No account exists | 1. Enter phone +910000000000<br>2. Enter any password<br>3. Click Login | Error message: "Invalid login credentials" | High |
| TD-AUTH-003 | Login with empty fields | Fresh login page | 1. Click Login without entering anything | Validation error shown. Button disabled. | Medium |
| TD-AUTH-004 | Register new teacher | User not registered | 1. Open register form<br>2. Enter phone +919999999999<br>3. Enter password (6+ chars)<br>4. Enter name<br>5. Click Register | OTP sent via SMS. OTP verification screen shown. | High |
| TD-AUTH-005 | Verify OTP | After registration | 1. Enter OTP received via SMS<br>2. Click Verify | Account created. Auto-login. Redirect to Dashboard. | High |
| TD-AUTH-006 | Demo mode login | No Supabase connection | 1. Enter "t-sim-101" as faculty ID<br>2. Enter any password<br>3. Click Login | Logged in with demo teacher profile. Banner shown. | Medium |
| TD-AUTH-007 | Logout | Authenticated | 1. Click logout button<br>2. Confirm | Session cleared. Redirect to login page. | High |

### 5.2 Dashboard

| Test ID | Feature | Preconditions | Steps | Expected Result | Priority |
|---------|---------|---------------|-------|-----------------|----------|
| TD-DASH-001 | View dashboard | Authenticated as teacher | 1. Navigate to /teacher | 8 stat cards displayed with correct counts. No loading skeletons visible. | High |
| TD-DASH-002 | Stat cards data accuracy | Tests and questions exist | 1. Count published tests manually<br>2. Compare with dashboard "Published Tests" card | Numbers match. | High |
| TD-DASH-003 | Quick actions navigation | Any state | 1. Click each quick action button | Navigates to correct route for each action. | High |
| TD-DASH-004 | Weekly activity chart | Results exist | 1. View weekly chart | Bars rendered for weeks with results. Height proportional to count. | Medium |
| TD-DASH-005 | Pending work items | Draft tests exist | 1. View "Draft Tests" count | Matches actual draft test count. Click navigates to filtered list. | Medium |
| TD-DASH-006 | Recent activity feed | Results exist | 1. Scroll to Recent Activity section | Shows recent test results with correct score, time, and status. | Medium |
| TD-DASH-007 | Empty state (no data) | New teacher, no activity | 1. View dashboard | Shows empty states gracefully. No broken UI. | Medium |
| TD-DASH-008 | Notification widget | Unread notifications exist | 1. Check notification widget | Shows correct unread count. Click "View all" navigates correctly. | Low |

### 5.3 Question Bank

| Test ID | Feature | Preconditions | Steps | Expected Result | Priority |
|---------|---------|---------------|-------|-----------------|----------|
| TD-QB-001 | Create MCQ question | Authenticated teacher | 1. Click Questions → Create<br>2. Select subject + chapter<br>3. Type: MCQ<br>4. Difficulty: Medium<br>5. Enter question text (10+ chars)<br>6. Add 4 options, mark 1 correct<br>7. Add explanation<br>8. Click "Save as Draft" | Question created with status "draft". Redirected to edit page. | High |
| TD-QB-002 | Create Numerical question | Authenticated teacher | 1. Create question → type: Numerical<br>2. Set correct numerical answer: 9.8<br>3. Tolerance: 0.1<br>4. Save as Draft | Question created without options. Numerical answer stored. | High |
| TD-QB-003 | Create MSQ question | Authenticated teacher | 1. Type: MSQ<br>2. Add 5 options, mark 3 correct<br>3. Save as Draft | Question created. Multiple correct options allowed. | High |
| TD-QB-004 | Validation: missing subject | Create question form | 1. Leave subject empty<br>2. Click Save | Error: "Subject is required" | High |
| TD-QB-005 | Validation: short question text | Create question form | 1. Enter < 10 chars in question text<br>2. Click Save | Error: "Question text must be at least 10 characters" | High |
| TD-QB-006 | Validation: no correct option | MCQ question | 1. Add options, mark none correct<br>2. Click Save | Error: "At least one option must be marked as correct" | High |
| TD-QB-007 | List questions | Questions exist | 1. Navigate to /teacher/questions/list | Questions displayed in table. Columns: Question, Type, Difficulty, Marks, Status, Updated. | High |
| TD-QB-008 | Filter by subject | Questions in multiple subjects | 1. Select a subject filter | List filtered to show only questions from that subject. | Medium |
| TD-QB-009 | Filter by status | Questions in various statuses | 1. Filter by "published" | Only published questions shown. | Medium |
| TD-QB-010 | Search questions | Questions with varied text | 1. Type search term in search bar | List filtered to matching questions. | Medium |
| TD-QB-011 | Bulk publish | Draft questions selected | 1. Select multiple draft questions<br>2. Click "Publish All" | All selected questions transition to published. | High |
| TD-QB-012 | Bulk archive | Published questions selected | 1. Select multiple published questions<br>2. Click "Archive All" | All selected questions archived. Confirmation before delete. | High |
| TD-QB-013 | Archive question | Published question | 1. Click "Archive" on a published question | Confirmation dialog shown. On confirm, status changes to archived. | Medium |
| TD-QB-014 | Restore archived | Archived question | 1. Click "Restore" on archived question | Status changes back to draft without confirmation. | Medium |
| TD-QB-015 | Pagination | >20 questions exist | 1. Navigate to page 2 | Next page of questions loaded. Page count correct. | Medium |
| TD-QB-016 | Submit for approval | Draft question complete | 1. Click "Submit for Approval"<br>2. All validations pass | Question status changes to "pending_approval". | High |
| TD-QB-017 | Empty state (no questions) | No questions created | 1. Navigate to questions list | Empty state displayed with "Create Question" CTA. | Low |

### 5.4 Mock Tests

| Test ID | Feature | Preconditions | Steps | Expected Result | Priority |
|---------|---------|---------------|-------|-----------------|----------|
| TD-MT-001 | Create mock test | Authenticated teacher | 1. Click Mock Tests → Create<br>2. Fill title, description<br>3. Select stream<br>4. Set duration: 180 min<br>5. Set total marks: 720<br>6. Configure settings<br>7. Click "Create Test" | Test created with status "draft". Redirected to questions page. | High |
| TD-MT-002 | Validation: empty title | Create form | 1. Leave title empty<br>2. Click Create | Error: "Title is required" | High |
| TD-MT-003 | Validation: duration > 600 | Create form | 1. Set duration to 601 | Error: "Duration cannot exceed 600 minutes" | High |
| TD-MT-004 | Validation: negative marks > total | Create form | 1. Set negative marking > total marks | Error displayed. | Medium |
| TD-MT-005 | Add question to test | Draft test exists, questions exist | 1. Navigate to test questions page<br>2. Select a question from bank<br>3. Set marks override<br>4. Add to test | Question appears in test question list. | High |
| TD-MT-006 | Remove question from test | Question already added | 1. Click remove on a test question | Question removed from test. | High |
| TD-MT-007 | Reorder questions | Multiple questions in test | 1. Drag/reorder questions | Order updates. Persists on reload. | Medium |
| TD-MT-008 | List mock tests | Tests exist | 1. Navigate to /teacher/mock-tests/list | Tests displayed in table. Status, marks, duration shown. | High |
| TD-MT-009 | Filter by status | Tests in various statuses | 1. Select a status filter | Only matching tests shown. | Medium |
| TD-MT-010 | Publish test | Draft with questions | 1. Navigate to publish page<br>2. Click "Publish" | Test status changes to "published". Question snapshots generated. | High |
| TD-MT-011 | Archive published test | Published test exists | 1. Click "Archive" on a published test<br>2. Confirm | Test status changes to "archived". Data preserved. | High |
| TD-MT-012 | Restore archived test | Archived test exists | 1. Click "Restore" on archived test | Test status back to "draft". Re-editable. | Medium |
| TD-MT-013 | Empty state (no tests) | No tests created | 1. Navigate to mock tests list | Empty state with "Create Test" CTA. | Low |

### 5.5 Results

| Test ID | Feature | Preconditions | Steps | Expected Result | Priority |
|---------|---------|---------------|-------|-----------------|----------|
| TD-RES-001 | View results dashboard | Results exist | 1. Navigate to /teacher/results | Stats cards show correct totals. Recent results listed. | High |
| TD-RES-002 | View result detail | Result exists | 1. Click a result row<br>2. View stats and breakdowns | Percentage, score, accuracy, breakdowns displayed correctly. | High |
| TD-RES-003 | Release result | Unreleased result | 1. Click "Release" on result<br>2. Confirm | Result marked as released. Student can now view it. | High |
| TD-RES-004 | Hide result | Released result | 1. Click "Hide" on released result<br>2. Confirm | Result hidden from student view. | High |
| TD-RES-005 | View subject breakdown | Multi-subject test result | 1. View result detail | Subject breakdown cards shown with scores and progress bars. | High |
| TD-RES-006 | View chapter breakdown | Result has chapter data | 1. Scroll to chapter breakdown | Chapter-level scores in a grid with progress bars. | Medium |
| TD-RES-007 | Filter results by test | Multiple tests | 1. Select test filter | Only results for that test shown. | Medium |
| TD-RES-008 | Filter results by release status | Mix of released/hidden | 1. Filter by "Released" | Only released results shown. | Medium |
| TD-RES-009 | Empty state (no results) | No student attempts | 1. Navigate to results | Empty state displayed. | Low |

### 5.6 Students

| Test ID | Feature | Preconditions | Steps | Expected Result | Priority |
|---------|---------|---------------|-------|-----------------|----------|
| TD-STU-001 | View student dashboard | Teacher has batches | 1. Navigate to /teacher/students | Stats cards correct. Recent students listed. Quick actions visible. | High |
| TD-STU-002 | View all students list | Students exist | 1. Navigate to /teacher/students/list | Students displayed in table with name, score, attendance, rank. | High |
| TD-STU-003 | Search students by name | Multiple students | 1. Type name in search bar | List filters to matching students. | High |
| TD-STU-004 | Filter students by batch | Multiple batches | 1. Select a batch from dropdown | Only students in that batch shown. | Medium |
| TD-STU-005 | Filter students by status | Various statuses | 1. Select "Present Live" | Only active students shown. | Medium |
| TD-STU-006 | View student profile | Student exists | 1. Click student name | Profile card, stats, strong/weak subjects, recent tests displayed. | High |
| TD-STU-007 | Student strong subjects | Analytics data exists | 1. View student profile<br>2. Scroll to Strong Subjects | Subjects sorted by performance. Progress bars shown. | High |
| TD-STU-008 | Student weak subjects | Analytics data exists | 1. View student profile<br>2. Scroll to Weak Subjects | Weakest subjects listed. Progress bars shown. | High |
| TD-STU-009 | Student recent tests | Results exist | 1. View student profile<br>2. Scroll to Recent Tests | Last 5 results shown with scores and links. | Medium |
| TD-STU-010 | Navigate to student analytics | Student exists | 1. Click "Analytics" button | Redirect to /teacher/students/{id}/analytics | Medium |
| TD-STU-011 | Empty state (no students) | No batch assignments | 1. Navigate to students list | Empty state: "No students are assigned to your batches yet." | Low |

### 5.7 Notifications

| Test ID | Feature | Preconditions | Steps | Expected Result | Priority |
|---------|---------|---------------|-------|-----------------|----------|
| TD-NOT-001 | View notifications dashboard | User has notifications | 1. Navigate to /teacher/notifications | Stats cards correct. Recent notifications listed. | High |
| TD-NOT-002 | Create announcement | Authenticated | 1. Click "Create Announcement"<br>2. Select type<br>3. Write title and message<br>4. Set priority<br>5. Choose audience<br>6. Click "Send Now" | Notification sent. Redirect to dashboard. | High |
| TD-NOT-003 | Validation: empty title | Create form | 1. Leave title empty<br>2. Click Send | Error: "Title is required" | High |
| TD-NOT-004 | Validation: short message | Create form | 1. Enter < 10 characters in message<br>2. Click Send | Error: "Message must be at least 10 characters" | High |
| TD-NOT-005 | Mark all as read | Unread notifications | 1. Click "Mark All Read" | All notifications marked as read. Count updates. | Medium |
| TD-NOT-006 | View notification history | Past notifications | 1. Navigate to /teacher/notifications/history | Full list with search, type filter, date range filter. | Medium |
| TD-NOT-007 | Filter history by type | Multiple notification types | 1. Select type filter | Only matching notifications shown. | Medium |
| TD-NOT-008 | Filter history by date | Notifications over time | 1. Select "Today" / "This Week" | Notifications within date range shown. | Medium |
| TD-NOT-009 | Notification delivery summary | Notifications exist | 1. Scroll to bottom of history page | Summary cards: Total Sent, Delivered, Read, Avg Read Rate. | Low |
| TD-NOT-010 | Empty state (no notifications) | No notifications | 1. Navigate to notifications | Empty state displayed. | Low |

### 5.8 Analytics

| Test ID | Feature | Preconditions | Steps | Expected Result | Priority |
|---------|---------|---------------|-------|-----------------|----------|
| TD-ANA-001 | View analytics dashboard | Analytics data exists | 1. Navigate to /teacher/analytics | Dashboard renders with ProgressRing, ScoreCards, ComparisonCard. | High |
| TD-ANA-002 | Filter controls render | Any state | 1. View any analytics page | Filters (batch, subject, export, date range) render correctly. | Medium |
| TD-ANA-003 | Export buttons (placeholder) | Any state | 1. Enable showExport filter | CSV, Excel, PDF buttons rendered with TODO badge. Disabled. | Low |
| TD-ANA-004 | Student analytics page | Student data exists | 1. Navigate to /teacher/analytics/students | ScoreCards for top/weak/needs attention displayed. | High |
| TD-ANA-005 | Mock test analytics page | Test data exists | 1. Navigate to /teacher/analytics/mock-tests | ComparisonCard + ScoreCard displayed. | High |
| TD-ANA-006 | Subject analytics page | Subject data exists | 1. Navigate to /teacher/analytics/subjects | Best/weakest subject ScoreCards shown. | Medium |
| TD-ANA-007 | Chapter analytics page | Chapter data exists | 1. Navigate to /teacher/analytics/chapters | Easiest/hardest chapter ScoreCards shown. | Medium |
| TD-ANA-008 | Question analytics page | Question data exists | 1. Navigate to /teacher/analytics/questions | ProgressRing for accuracy, ScoreCard for avg time. | Medium |
| TD-ANA-009 | Trends page | Trend data exists | 1. Navigate to /teacher/analytics/trends | ComparisonCard + ScoreCards for current vs previous period. | Medium |
| TD-ANA-010 | Leaderboards page | Student scores exist | 1. Navigate to /teacher/analytics/leaderboards | ScoreCards for top student, most consistent, most improved. | Medium |
| TD-ANA-011 | Insights page | Any data | 1. Navigate to /teacher/analytics/insights | Insights cards (placeholder) displayed. | Low |
| TD-ANA-012 | ScoreCard loading state | Data loading | 1. Observe ScoreCard during load | Skeleton animation displayed. | Low |
| TD-ANA-013 | ProgressRing animation | Data loaded | 1. Observe ProgressRing | Animated arc from 0 to target percentage. | Low |

### 5.9 Profile

| Test ID | Feature | Preconditions | Steps | Expected Result | Priority |
|---------|---------|---------------|-------|-----------------|----------|
| TD-PRO-001 | View profile | Authenticated teacher | 1. Navigate to /teacher/profile | Profile header, stats, sections all displayed. | High |
| TD-PRO-002 | Edit profile | Authenticated teacher | 1. Navigate to /teacher/profile/edit<br>2. Change name, bio, etc.<br>3. Click Save | Changes saved. Redirect to profile view with updated data. | High |
| TD-PRO-003 | Upload profile photo | Edit page | 1. Click avatar upload<br>2. Select image file<br>3. Save | Photo uploaded and displayed. | High |
| TD-PRO-004 | Change password | Security page | 1. Navigate to /teacher/profile/security<br>2. Click "Change Password"<br>3. Enter new password<br>4. Confirm | Password updated successfully. | High |
| TD-PRO-005 | View activity timeline | Teacher has activity | 1. Navigate to /teacher/profile/activity | Timeline shows events grouped by date. | High |
| TD-PRO-006 | Filter activity by date | Activity exists | 1. Use date range filter on activity page | Only events in date range shown. | Medium |
| TD-PRO-007 | Notification preferences | Profile page | 1. Navigate to /teacher/profile/preferences | Toggle switches render. Role="switch" accessible. | Medium |
| TD-PRO-008 | Toggle notification preference | Preferences page | 1. Toggle "Email Notifications" off | Preference saved. Toggle reflects new state. | Medium |
| TD-PRO-009 | Empty activity | No activity | 1. View activity page on new account | Empty state displayed. | Low |
| TD-PRO-010 | Profile layout tabs | Any state | 1. Navigate between profile tabs | Tab navigation works. Active tab highlighted. | Medium |

### 5.10 Settings

| Test ID | Feature | Preconditions | Steps | Expected Result | Priority |
|---------|---------|---------------|-------|-----------------|----------|
| TD-SET-001 | Change appearance | Settings page | 1. Navigate to /teacher/settings<br>2. Click "Dark" theme<br>3. Observe | Theme changes to dark mode immediately. Persists on reload. | High |
| TD-SET-002 | Change language | Settings page | 1. Select a different language | Language changes. (Note: i18n may be placeholder) | Medium |
| TD-SET-003 | Change timezone | Settings page | 1. Select a different timezone | Timezone preference saved. | Medium |
| TD-SET-004 | Toggle dashboard preferences | Settings page | 1. Toggle "Show Charts" off<br>2. Navigate to dashboard | Charts not displayed. | Medium |
| TD-SET-005 | Toggle privacy settings | Settings page | 1. Toggle "Profile Visibility" off | Privacy preference saved. | Medium |
| TD-SET-006 | Set auto-logout timer | Settings page | 1. Select 30 minutes<br>2. Wait 30 minutes of inactivity | Session expires after 30 min. | Medium |
| TD-SET-007 | Reset all settings | Settings page | 1. Click "Reset All Settings"<br>2. Confirm | All settings revert to defaults. | High |
| TD-SET-008 | Clear local data | Settings page | 1. Click "Clear Local Data"<br>2. Confirm | localStorage cleared. Settings reset. | High |
| TD-SET-009 | View keyboard shortcuts | Settings page | 1. Scroll to Keyboard Shortcuts section | 12 shortcut cards displayed. Toggle works. | Low |
| TD-SET-010 | Connected accounts (placeholder) | Settings page | 1. Scroll to Connected Accounts | 3 account cards with "Coming Soon" badge. | Low |

### 5.11 Navigation & Layout

| Test ID | Feature | Preconditions | Steps | Expected Result | Priority |
|---------|---------|---------------|-------|-----------------|----------|
| TD-NAV-001 | Sidebar navigation | Any page | 1. Click each sidebar item | Navigates to correct route. Active item highlighted. | High |
| TD-NAV-002 | Breadcrumb navigation | Nested page | 1. Click breadcrumb link | Navigates to parent route. | Medium |
| TD-NAV-003 | Dark mode toggle | Any page | 1. Toggle dark mode in settings<br>2. Navigate across pages | Dark mode consistent across all pages. | Medium |
| TD-NAV-004 | Responsive layout | Desktop browser | 1. Resize browser to tablet width | Sidebar collapses. Content responsive. | Medium |
| TD-NAV-005 | Mobile view | Phone-width viewport | 1. View at 375px width | Hamburger menu. Content stacks vertically. | Medium |
| TD-NAV-006 | Page header renders | Any page | 1. Verify PageHeader | Title, description, breadcrumbs, actions all present. | Low |

---

## 6. Validation Checklist

### 6.1 Authentication

| Field | Required | Validation Rules | Max Length | Error Message |
|-------|----------|-----------------|------------|---------------|
| Phone | Yes | Must start with +, 7-15 digits | 15 | "Please enter a valid mobile number with country code" |
| Password | Yes | Min 6 characters | 100 | "Password must be at least 6 characters" |
| Name (Register) | Yes | Non-empty | 100 | "Full name is required" |
| OTP Token | Yes | 4-8 characters | 8 | "Please enter a valid OTP" |

### 6.2 Question

| Field | Required | Validation Rules | Max Length | Error Message |
|-------|----------|-----------------|------------|---------------|
| Subject | Yes | Must be selected | — | "Subject is required" |
| Chapter | Yes | Must be selected | — | "Chapter is required" |
| Question Type | Yes | mcq/msq/numerical/true_false | — | "Question type is required" |
| Difficulty | Yes | easy/medium/hard | — | "Difficulty is required" |
| Question Text | Yes | Min 10 characters | — | "Question text must be at least 10 characters" |
| Marks | Yes | > 0 | — | "Marks must be greater than 0" |
| Options (non-numerical) | Yes | At least 2 non-empty | — | "At least 2 non-empty options required" |
| Correct Options (MCQ/TF) | Yes | Exactly 1 correct | — | "MCQ questions must have exactly one correct answer" |
| Correct Options (MSQ) | Yes | At least 1 correct | — | "At least one option must be marked as correct" |
| Numerical Answer | Yes (numerical) | Non-empty | — | "Correct numerical answer is required" |

### 6.3 Mock Test

| Field | Required | Validation Rules | Max Length | Error Message |
|-------|----------|-----------------|------------|---------------|
| Title | Yes | Min 3 characters | — | "Title must be at least 3 characters" |
| Duration | Yes | 1-600 minutes | — | "Duration must be greater than 0" / max 600 |
| Total Marks | Yes | > 0 | — | "Total marks must be greater than 0" |
| Passing Marks | No | Must be ≤ total marks | — | "Passing marks cannot exceed total marks" |
| Negative Marking | No | ≥ 0, must be ≤ total marks | — | "Negative marking cannot exceed total marks" |
| Attempt Limit | No | ≥ 1 when set | — | "Attempt limit must be at least 1" |
| Stream | Yes | Must be selected | — | "Stream is required" |
| Release Date | Conditional | Required if scheduled mode | — | "Release date is required for scheduled release" |
| Available Until | Conditional | Must be after Available From | — | "End date must be after start date" |

### 6.4 Notification

| Field | Required | Validation Rules | Max Length | Error Message |
|-------|----------|-----------------|------------|---------------|
| Title | Yes | Min 3 characters | — | "Title must be at least 3 characters" |
| Message | Yes | Min 10 characters | — | "Message must be at least 10 characters" |
| Institute ID | Yes | Must exist | — | "Institute not found" |
| Schedule Date | Conditional | Required for scheduled mode | — | "Date is required for scheduled notifications" |

### 6.5 Profile Edit

| Field | Required | Validation Rules | Max Length | Error Message |
|-------|----------|-----------------|------------|---------------|
| Full Name | Yes | Non-empty | — | "Full name is required" |
| Mobile Number | Yes | Must be valid E.164 | — | "Please enter a valid mobile number" |
| Email | Yes | Read-only (if auth restricts) | — | — |
| New Password | Yes (change password) | Min 6 characters | — | "Password must be at least 6 characters" |
| Confirm Password | Yes (change password) | Must match new password | — | "Passwords do not match" |

---

## 7. API Testing Checklist

### 7.1 Authentication

| API/Service | Input | Output | Success Response | Failure Response | Edge Cases |
|-------------|-------|--------|-----------------|------------------|------------|
| `authService.signIn()` | SignInInput (phone, password) | AuthResponse\<UserProfile\> | `{ success: true, data: UserProfile }` | `{ success: false, error: "..." }` | Invalid phone, wrong password, network error |
| `authService.signUp()` | SignUpInput (phone, password, name) | AuthResponse\<{ phone, password }\> | `{ success: true, data: { phone, password } }` | `{ success: false, error: "..." }` | Existing user, invalid phone format |
| `authService.verifyOtp()` | VerifyOtpInput (phone, token) | AuthResponse\<UserProfile\> | `{ success: true, data: UserProfile }` | `{ success: false, error: "..." }` | Expired OTP, wrong OTP, invalid phone |
| `authService.updatePassword()` | newPassword: string | AuthResponse\<null\> | `{ success: true, data: null }` | `{ success: false, error: "..." }` | Weak password, no session |

### 7.2 Mock Tests

| API/Service | Input | Output | Success Response | Failure Response | Permission Check |
|-------------|-------|--------|-----------------|------------------|-----------------|
| `mockTestService.getMockTests()` | filters, sort, pagination | ApiResponse\<PaginatedResponse\<MockTest\>\> | `{ success: true, data: { data: MockTest[], count: N } }` | `{ success: false, error: "..." }` | RLS: teacher sees own tests |
| `mockTestService.getMockTestById()` | testId: string | ApiResponse\<MockTest\> | `{ success: true, data: MockTest }` | `{ success: false, error: "Not found" }` | RLS: teacher can only access own tests |
| `mockTestService.createMockTest()` | CreateMockTestInput | ApiResponse\<MockTest\> | `{ success: true, data: MockTest }` | `{ success: false, error: "..." }` | Requires valid institute, stream, teacher |
| `mockTestService.publishMockTest()` | testId: string | ApiResponse\<MockTest\> | `{ success: true, data: MockTest }` | `{ success: false, error: "Invalid transition" }` | Only draft/pending_approval can publish |
| `mockTestService.archiveMockTest()` | testId: string | ApiResponse\<MockTest\> | `{ success: true, data: MockTest }` | `{ success: false, error: "Invalid transition" }` | Only published can archive |

### 7.3 Questions

| API/Service | Input | Output | Success Response | Failure Response | Permission Check |
|-------------|-------|--------|-----------------|------------------|-----------------|
| `questionService.getQuestions()` | filters, sort, pagination | ApiResponse\<PaginatedResponse\<Question\>\> | `{ success: true, data: { data: Question[], count: N } }` | `{ success: false, error: "..." }` | RLS: teacher sees own questions |
| `questionService.createQuestion()` | CreateQuestionInput | ApiResponse\<Question\> | `{ success: true, data: Question }` | `{ success: false, error: "..." }` | Requires valid subject, chapter |
| `questionService.publishQuestion()` | questionId: string | ApiResponse\<Question\> | `{ success: true, data: Question }` | `{ success: false, error: "Invalid transition" }` | Only pending_approval can be published |

### 7.4 Results

| API/Service | Input | Output | Success Response | Failure Response | Permission Check |
|-------------|-------|--------|-----------------|------------------|-----------------|
| `mockResultService.getResults()` | filters, sort, pagination | ApiResponse\<PaginatedResponse\<MockResult\>\> | `{ success: true, data: { data: MockResult[], count: N } }` | `{ success: false, error: "..." }` | RLS: teacher sees own tests' results |
| `mockResultService.getResult()` | resultId: string | ApiResponse\<MockResult\> | `{ success: true, data: MockResult }` | `{ success: false, error: "Not found" }` | RLS: teacher can access |
| `mockResultService.releaseResult()` | resultId: string | ApiResponse\<MockResult\> | `{ success: true, data: MockResult }` | `{ success: false, error: "Not found" }` | RLS: teacher can update own tests' results |
| `mockResultService.hideResult()` | resultId: string | ApiResponse\<MockResult\> | `{ success: true, data: MockResult }` | `{ success: false, error: "Not found" }` | RLS: teacher can update |

### 7.5 Notifications

| API/Service | Input | Output | Success Response | Failure Response | Permission Check |
|-------------|-------|--------|-----------------|------------------|-----------------|
| `notificationService.getNotifications()` | userId, filters, sort, pagination | ApiResponse\<NotificationListResult\> | `{ success: true, data: { notifications: Notification[], total: N } }` | `{ success: false, error: "..." }` | RLS: user sees own notifications |
| `notificationService.markAllAsRead()` | userId: string | ApiResponse\<number\> | `{ success: true, data: count }` | `{ success: false, error: "..." }` | RLS: user can mark own as read |
| `notificationService.publishAnnouncement()` | PublishAnnouncementInput | ApiResponse\<{ notificationId }\> | `{ success: true, data: { notificationId } }` | `{ success: false, error: "..." }` | Requires valid institute |

### 7.6 Teacher Service

| API/Service | Input | Output | Success Response | Failure Response | Permission Check |
|-------------|-------|--------|-----------------|------------------|-----------------|
| `teacherService.getAssignedBatches()` | teacherId: string | AcademicBatch[] | `Array of batches` | `[]` (empty array on error) | RLS: teacher only sees own batches |
| `teacherService.getStudentRoster()` | batchId: string | StudentRosterItem[] | `Array of students` | `[]` (empty array on error) | RLS: only batches assigned to teacher |
| `teacherService.getTeacherOverviewData()` | teacherId: string | Overview data object | `{ rating, specialization, analytics, nextClass }` | `null` | RLS: teacher only sees own data |

### 7.7 Academic Structure

| API/Service | Input | Output | Success Response | Failure Response | Edge Cases |
|-------------|-------|--------|-----------------|------------------|------------|
| `streamService.getStreams()` | filters, sort, pagination | ApiResponse\<PaginatedResponse\<Stream\>\> | `{ success: true, data: { data: Stream[], count: N } }` | `{ success: false, error: "..." }` | Empty result, invalid UUID |
| `subjectService.getSubjects()` | streamId filter | ApiResponse\<PaginatedResponse\<Subject\>\> | `{ success: true, data: { data: Subject[], count: N } }` | `{ success: false, error: "..." }` | Filter by stream, empty response |
| `chapterService.getChapters()` | subjectId filter | ApiResponse\<PaginatedResponse\<Chapter\>\> | `{ success: true, data: { data: Chapter[], count: N } }` | `{ success: false, error: "..." }` | Filter by subject, empty response |

### 7.8 Storage

| API/Service | Input | Output | Success Response | Failure Response | Edge Cases |
|-------------|-------|--------|-----------------|------------------|------------|
| `storageService.uploadFile()` | UploadFileParams | ApiResponse\<UploadResult\> | `{ success: true, data: { bucket, storagePath, fileSize, mimeType } }` | `{ success: false, error: "..." }` | Invalid MIME, file too large, network error |
| `storageService.generateSignedUrl()` | SignedUrlParams | ApiResponse\<{ signedUrl, expiresAt }\> | `{ success: true, data: { signedUrl, expiresAt } }` | `{ success: false, error: "..." }` | Expired, file not found, permission denied |
| `storageService.deleteFile()` | bucket, storagePaths | ApiResponse\<void\> | `{ success: true }` | `{ success: false, error: "..." }` | File not found (idempotent) |

---

## 8. Database Verification Checklist

### 8.1 Create Question

| Table | Expected Change | Verification |
|-------|----------------|--------------|
| `questions` | 1 new row | `SELECT * FROM questions WHERE question_id = '{id}'` |
| `question_options` | 2-6 new rows | `SELECT * FROM question_options WHERE question_id = '{id}'` |
| `question_explanations` | 1 new row (if explanation provided) | `SELECT * FROM question_explanations WHERE question_id = '{id}'` |
| **Validations** | | |
| Foreign keys | FK → `subjects.subject_id` must be valid | Verify subject exists |
| Foreign keys | FK → `chapters.chapter_id` must be valid | Verify chapter exists |
| Audit columns | `created_at`, `updated_at` should be set | Verify timestamps are not null |
| Status default | `status` should be `'draft'` | `SELECT status FROM questions WHERE question_id = '{id}'` |

### 8.2 Publish Question

| Table | Expected Change | Verification |
|-------|----------------|--------------|
| `questions` | `status` → `'published'` | `SELECT status FROM questions WHERE question_id = '{id}'` |
| `questions` | `approved_by` should be set | `SELECT approved_by FROM questions WHERE question_id = '{id}'` |
| `questions` | `approved_at` should be set | `SELECT approved_at FROM questions WHERE question_id = '{id}'` |
| **Validations** | | |
| Status transition | Must go from `pending_approval` → `published` | Attempting to publish from `draft` should fail |
| Immutability | Published questions block edits to stem/options | Attempt UPDATE on `question_text` → rejection |

### 8.3 Create Mock Test

| Table | Expected Change | Verification |
|-------|----------------|--------------|
| `mock_tests` | 1 new row | `SELECT * FROM mock_tests WHERE test_id = '{id}'` |
| **Validations** | | |
| Foreign keys | FK → `streams.stream_id` must be valid | Verify stream exists |
| Foreign keys | FK → `teacher_details.teacher_id` must be resolved | Verify teacher_id matches session |
| Status default | `status` should be `'draft'` | `SELECT status FROM mock_tests WHERE test_id = '{id}'` |
| Immutable fields after publish | UPDATE on published test title allowed | Check RLS: published tests should be teacher-editable only for non-breaking fields |

### 8.4 Add Questions to Test

| Table | Expected Change | Verification |
|-------|----------------|--------------|
| `mock_test_questions` | N new rows (one per question) | `SELECT COUNT(*) FROM mock_test_questions WHERE test_id = '{id}'` |
| **Validations** | | |
| Composite PK | Same `(test_id, question_id)` cannot be inserted twice | Attempt duplicate insert → 23505 error |
| Order sequence | Must be ≥ 1 | Attempt order_sequence = 0 → constraint violation |
| Institute match | Question institute must match test institute | Cross-institute insertion blocked |

### 8.5 Publish Mock Test

| Table | Expected Change | Verification |
|-------|----------------|--------------|
| `mock_tests` | `status` → `'published'` | `SELECT status FROM mock_tests WHERE test_id = '{id}'` |
| `mock_tests` | `published_at` should be set | `SELECT published_at FROM mock_tests WHERE test_id = '{id}'` |
| **Validations** | | |
| Pre-conditions | Test must have ≥1 question | Attempt to publish empty test → error |
| Pre-conditions | All questions must be `published` | Attempt to publish with draft questions → error |
| Pre-conditions | No duplicate orders | Attempt to publish with duplicate order_sequence → error |
| Snapshot | `question_snapshot` should be populated (future) | Check JSONB column |
| Immutability | After publish, mock_test_questions cannot be modified | Attempt INSERT/UPDATE/DELETE on junction → trigger rejection |

### 8.6 Submit Attempt & Generate Result

| Table | Expected Change | Verification |
|-------|----------------|--------------|
| `mock_attempts` | 1 new row, status = `'in_progress'` | `SELECT * FROM mock_attempts WHERE attempt_id = '{id}'` |
| `mock_answers` | N new rows (one per test question) | `SELECT COUNT(*) FROM mock_answers WHERE attempt_id = '{id}'` |
| `mock_attempts` | Status → `'submitted'` on submission | `SELECT status FROM mock_attempts WHERE attempt_id = '{id}'` |
| `mock_results` | 1 new row (after evaluation) | `SELECT * FROM mock_results WHERE attempt_id = '{id}'` |
| `mock_answers` | `is_correct`, `marks_awarded` populated | `SELECT is_correct FROM mock_answers WHERE attempt_id = '{id}'` |
| **Validations** | | |
| Duplicate prevention | Re-evaluating same attempt returns existing result | Call evaluateAttempt twice → same result, no duplicate insert |
| Attempt limit | Exceeding attemptLimit for a test is blocked | Attempt to create 4th attempt when limit=3 → error |
| Attempt number | Incremented correctly | Verify attempt_number = previous + 1 |

### 8.7 Release/Hide Result

| Table | Expected Change | Verification |
|-------|----------------|--------------|
| `mock_results` | `is_released` → `true`, `released_at` set | `SELECT is_released, released_at FROM mock_results WHERE result_id = '{id}'` |
| `mock_results` | `is_released` → `false`, `released_at` → `null` (hide) | `SELECT is_released, released_at FROM mock_results WHERE result_id = '{id}'` |

### 8.8 Send Notification

| Table | Expected Change | Verification |
|-------|----------------|--------------|
| `notifications` | 1 new row | `SELECT * FROM notifications WHERE notification_id = '{id}'` |
| `notification_recipients` | N new rows (one per recipient) | `SELECT COUNT(*) FROM notification_recipients WHERE notification_id = '{id}'` |
| **Validations** | | |
| FK → `profiles` | `notification_recipients.profile_id` must exist | Verify each recipient profile exists |

### 8.9 Profile Update

| Table | Expected Change | Verification |
|-------|----------------|--------------|
| `profiles` | Updated fields (name, avatar_url, etc.) | `SELECT * FROM profiles WHERE profile_id = '{id}'` |
| `teacher_details` | Updated fields (bio, qualification, etc.) | `SELECT * FROM teacher_details WHERE teacher_id = '{id}'` |

---

## 9. UI Testing Checklist

### 9.1 Responsive Design

| Test | Breakpoint | Expected Behavior |
|------|------------|-------------------|
| Desktop | ≥ 1024px | Full layout: sidebar visible, multi-column grids, table row actions visible |
| Tablet | 768px - 1023px | Sidebar may collapse to icons, grids reduce columns, tables scrollable |
| Mobile | < 768px | Hamburger menu, single-column layout, stacks, hidden table columns |
| XL Desktop | ≥ 1440px | Max-width containers, extra white space, multi-column grids |

### 9.2 Dark Mode

| Test | Expected Behavior |
|------|-------------------|
| Theme toggle | Toggle between Light/Dark/System |
| All pages | Consistent dark backgrounds (`bg-gray-900`, `dark:bg-gray-900`) |
| Text contrast | Dark mode text meets WCAG AA contrast ratio |
| Borders | Subtle dark borders (`dark:border-gray-700`) |
| Cards | Dark card backgrounds with proper contrast |
| Charts/Graphs | Colors remain distinguishable in dark mode |
| Tables | Alternating row colors visible in dark mode |
| Forms | Input backgrounds readable |
| Modals | Dark overlay + dark modal background |

### 9.3 Loading States

| Component | Skeleton Type | Expected Behavior |
|-----------|---------------|-------------------|
| Stat Cards | Rectangular skeleton with 3 lines | `<Skeleton className="h-3 w-20" />` layout |
| DataTable | Row skeletons | Table structure maintained during loading |
| Charts | Placeholder rectangle | Gray placeholder until data loads |
| Profile Header | Avatar + text skeletons | Circular avatar skeleton + text lines |
| Activity Timeline | Timeline item skeletons | Gray bars in timeline layout |

### 9.4 Empty States

| Page | Empty State Message | Action |
|------|---------------------|--------|
| Questions List | "No questions found" | "Create Question" button |
| Mock Tests List | "No mock tests found" | "Create Test" button |
| Results Dashboard | "No results yet" | None (informational) |
| Students List | "No students found" | None (informational) |
| Notifications | "No notifications yet" | None (informational) |
| Recent Activity | "No activity yet" | None (informational) |
| Activity Timeline | Placeholder text | None |

### 9.5 Pagination

| Test | Expected Behavior |
|------|-------------------|
| Page navigation (click) | Click page number → loads that page |
| Previous/Next buttons | Navigate one page at a time |
| Page size indicator | Shows N results per page |
| Total count | Shows total number of items |
| Last page | "Next" button disabled on last page |
| First page | "Previous" button disabled on first page |
| Page reset on filter | Changing filter resets to page 1 |

### 9.6 Search & Filters

| Test | Expected Behavior |
|------|-------------------|
| Search input | Filters results as user types (debounced) |
| Search clear | Clear button resets search |
| Dropdown filters | Selecting a value filters the list |
| Multi-filter | Multiple filters combine (AND logic) |
| Clear filters | "Clear Filters" resets all filters |
| No results | Shows "No results" empty state |
| Filter persistence | Filters may persist in URL state |

### 9.7 Modals & Dialogs

| Test | Expected Behavior |
|------|-------------------|
| Open dialog | Modal overlay + centered dialog appears |
| Close via X | Click X → dialog closes |
| Close via backdrop | Click overlay → dialog closes (configurable) |
| Confirm action | Click confirm → action executes → dialog closes |
| Cancel action | Click cancel → dialog closes, no action |
| Keyboard (Escape) | Press Escape → dialog closes |
| Trap focus | Tab cycles within dialog, not behind it |
| ARIA attributes | `role="dialog"`, `aria-modal="true"`, `aria-labelledby` |

### 9.8 Accessibility

| Test | Expected Behavior |
|------|-------------------|
| Keyboard navigation | All interactive elements reachable via Tab |
| Tab order | Logical tab order follows visual order |
| Skip to main content | Visible skip link (optional) |
| Form labels | All inputs have associated `<label>` elements |
| ARIA labels | Icons and buttons have `aria-label` |
| Switch role | Toggles use `role="switch"` with `aria-checked` |
| Tab role | Tab navigation uses `role="tablist"` and `role="tab"` |
| Progressbar role | Progress indicators use `role="progressbar"` |
| Focus indicators | Visible focus ring on all interactive elements |
| Color contrast | Meets WCAG AA (4.5:1 for normal text) |
| Screen reader | `aria-live` regions for dynamic content |

### 9.9 Error & Success States

| Test | Expected Behavior |
|------|-------------------|
| Form validation error | Red border + error message below field |
| API error | Error banner at top of form/page |
| Success message | Green/positive feedback after action |
| Toast (future) | Temporary notification for non-blocking actions |
| Network error | Graceful error message with retry option |

---

## 10. Performance Checklist

### 10.1 Large Dataset Testing

| Test | Dataset Size | Expected Behavior |
|------|-------------|-------------------|
| Question Bank | 10,000 questions | Pagination loads 20 at a time. Filtering is responsive. |
| Question Bank | 100,000 questions | Search + filter must be indexed. Server-side pagination. |
| Mock Tests | 500 tests | Pagination loads quickly. Filter by status works. |
| Students | 5,000 students | Server-side search. Pagination essential. Batch filtering. |
| Results | 50,000 results | Aggregate queries should use `mock_results` denormalized fields. |
| Notifications | 10,000 events | Pagination + date filtering critical. |

### 10.2 React Query Caching

| Query | Cache Duration (staleTime) | Notes |
|-------|---------------------------|-------|
| Teacher overview | 30 seconds | Dashboard data refreshes frequently |
| Questions list | 30 seconds | Changes when teacher creates/edits |
| Mock tests list | 30 seconds | Changes when teacher creates/publishes |
| Results list | 30 seconds | New results when students submit |
| Students list | 30 seconds | Relatively static |
| Streams/Subjects/Chapters | 5+ minutes | Academic structure changes rarely |
| Notifications | 10 seconds | New notifications arrive frequently |

### 10.3 Loading Time Targets

| Page | Target Load Time | Notes |
|------|-----------------|-------|
| Dashboard | < 2 seconds | Multiple parallel queries |
| Question List | < 1.5 seconds | Paginated query |
| Question Create | < 1 second | Simple form |
| Mock Test Create | < 1.5 seconds | Stream + subject dropdowns |
| Result Detail | < 1 second | Single result query + breakdowns |
| Student Profile | < 1.5 seconds | Profile + analytics + results |
| Analytics Pages | < 2 seconds | Aggregation queries |
| Profile | < 1.5 seconds | Auth data + profile data |
| Settings | < 1 second | localStorage reads only |

### 10.4 Memory & Rendering

| Test | Expected Behavior |
|------|-------------------|
| Large DataTable (10,000 rows) | Should NOT attempt to render all rows DOM — must paginate |
| Infinite scroll (future) | Virtualization required for large lists |
| Image heavy pages | Lazy loading for all images |
| Re-renders | Components should use `useMemo`/`useCallback` appropriately |
| Memoized selectors | Redux selectors should be memoized |
| Debounced search | Search inputs should debounce requests |

---

## 11. Security Checklist

### 11.1 Authentication

| Test | Expected Behavior |
|------|-------------------|
| Session persistence | JWT token stored securely, auto-refresh |
| Session expiry | Expired session redirects to login |
| No direct DB access | All DB operations go through Supabase anon key (RLS enforced) |
| No service_role key | Frontend never uses service_role key |
| Phone-based auth | Phone number validated with country code |
| Password requirements | Min 6 characters enforced |
| OTP verification | OTP required for phone verification |

### 11.2 Authorization (RLS)

| Test | Expected Behavior |
|------|-------------------|
| Teacher cannot view another teacher's questions | RLS: `created_by = get_my_teacher_id()` enforced |
| Teacher cannot view another teacher's tests | RLS: `teacher_id = get_my_teacher_id()` enforced |
| Teacher cannot access admin tables | RLS blocks `audit_logs`, `system_settings`, `api_keys` |
| Teacher cannot view students from other batches | RLS: teacher only sees students in own batches |
| Teacher cannot modify other teachers' content | RLS: `teacher_id` check on content table |
| Teacher cannot access student subscriptions | Admin/student only tables |
| Cross-institute isolation | Institute-scoped RLS policies |

### 11.3 Session Management

| Test | Expected Behavior |
|------|-------------------|
| Logout clears session | Supabase session cleared, redirect to login |
| Token refresh | Refresh token used when access token expires |
| No localStorage for tokens | Supabase manages this internally |
| Auto-logout (Settings) | Session expires after configured idle time |

### 11.4 Profile & Data

| Test | Expected Behavior |
|------|-------------------|
| Password change | Requires old password, minimum length |
| Profile photo upload | Validated by MIME type and file size |
| Data Privacy | Profile visibility controlled by privacy settings |
| Local storage data | Cache, preferences stored in localStorage (not sensitive data) |

---

## 12. Remaining Backend Dependencies

### 12.1 Completed

| Feature | Status | Notes |
|---------|--------|-------|
| Authentication (phone + password) | ✅ Complete | OTP verification flow fully implemented |
| Question CRUD | ✅ Complete | All types (MCQ, MSQ, Numerical, True/False) |
| Question options CRUD | ✅ Complete | |
| Question explanations CRUD | ✅ Complete | |
| Question images CRUD | ✅ Complete | Storage integration via signed URLs |
| Mock Test CRUD | ✅ Complete | Full lifecycle with status transitions |
| Mock Test Questions (junction) | ✅ Complete | Add, remove, reorder, replace, bulk |
| Mock Attempt CRUD | ✅ Complete | Start, update, submit |
| Mock Answer CRUD | ✅ Complete | Auto-save, option selection |
| Mock Answer Options CRUD | ✅ Complete | MCQ/MSQ option tracking |
| Mock Result CRUD | ✅ Complete | Generate, release, hide |
| Mock Evaluation Engine | ✅ Complete | Score computation, duplicate prevention |
| Mock Test Publish Workflow | ✅ Complete | Validation pipeline, snapshots (placeholder) |
| Stream CRUD | ✅ Complete | |
| Subject CRUD | ✅ Complete | |
| Chapter CRUD | ✅ Complete | |
| Topic CRUD | ✅ Complete | |
| Content CRUD | ✅ Complete | With storage orchestration |
| Tag CRUD | ✅ Complete | |
| Approval Workflow | ✅ Complete | Content approval lifecycle |
| Notification CRUD | ✅ Complete | Create, read, mark read, delete |
| Notification Bulk | ✅ Complete | Bulk creation with recipient fan-out |
| Storage Upload | ✅ Complete | With retry, progress, validation |
| Storage Signed URLs | ✅ Complete | |
| Teacher Service (Batches, Students, Overview) | ✅ Complete | |
| Auth Service | ✅ Complete | Full phone-based auth with OTP |
| Profile Service | ✅ Complete | Full CRUD on teacher profiles |

### 12.2 Partially Complete

| Feature | Status | Gap |
|---------|--------|-----|
| **Notification Sending** | ⚠️ Partial | RLS restricts teacher INSERT on `notifications`. Backend service_role proxy or new RLS needed. |
| **Export (CSV/Excel/PDF)** | ⚠️ Placeholder UI | UI buttons rendered with TODO badge. Export logic not implemented. |
| **Question Snapshots** | ⚠️ Placeholder | Architecture reserved in publish workflow. Actual snapshot generation not implemented. |
| **Activity Timeline** | ⚠️ Partial | Profile activity page built. Login history, device tracking need backend. |
| **Session Management (Settings)** | ⚠️ Placeholder | UI-ready: active sessions, device list, "logout all" — backend not implemented. |
| **Notification Preferences** | ⚠️ Partial | Stored in localStorage only. Server-side sync needs `teacher_notification_prefs` table. |
| **Image Upload** | ⚠️ Partial | Storage service ready. Integration with question images may need testing. |
| **Profile Photo Upload** | ⚠️ Partial | Upload path in profileService created. Should verify full flow with avatar_url update. |

### 12.3 Pending / Not Implemented

| Feature | Status | Notes |
|---------|--------|-------|
| **Live Classes** | ❌ Pending | Jitsi integration not started. Schedule page placeholder. |
| **Jitsi Integration** | ❌ Pending | Video conferencing not implemented. |
| **Live Session Management** | ❌ Pending | Start/end class, attendance tracking, recordings. |
| **Content Module UI** | ❌ Pending | Services exist, but teacher-facing UI pages not built. |
| **PYQ Management** | ❌ Pending | RLS restricts teacher CRUD. Schema exists but no UI. |
| **Doubts Module** | ❌ Pending | RLS allows teacher replies, but no UI built. |
| **Schedule / Calendar** | ❌ Pending | Placeholder route exists, no implementation. |
| **Bulk Question Import** | ❌ Pending | Route exists, import logic not implemented. |
| **Two-Factor Authentication (2FA)** | ❌ Pending | UI-ready with "Coming Soon" badge. |
| **Login History / Device Tracking** | ❌ Pending | No backend tables for this. |
| **Connected Accounts** | ❌ Pending | UI-ready placeholder. No backend integration. |
| **Notification Scheduling** | ❌ Pending | UI for schedule mode exists. Backend dispatch job not implemented. |
| **Analytics Recommendations / Insights** | ❌ Pending | Insights page placeholder. AI suggestions not implemented. |
| **Email/SMS Notification Gateways** | ❌ Pending | No SMTP/SMS provider integration. |
| **Student App Integration** | ❌ Pending | No student-facing app. |
| **Admin Dashboard** | ❌ Pending | Dev console exists but no production admin UI. |
| **Payment Gateway** | ❌ Pending | Commerce module requires payment integration. |
| **Batch Assignment for Mock Tests** | ❌ Pending | No junction table. Tests assigned to streams only. |

---

## 13. Acceptance Criteria

### 13.1 Question Bank

**Done when:**
- ☐ Teachers can create questions of all 4 types (MCQ, MSQ, Numerical, True/False)
- ☐ Teachers can edit draft questions
- ☐ Teachers can delete unused questions
- ☐ Teachers can submit questions for approval
- ☐ Teachers can publish approved questions
- ☐ Teachers can archive published questions
- ☐ Teachers can restore archived questions
- ☐ Teachers can search questions by text
- ☐ Teachers can filter by subject, chapter, difficulty, type, status
- ☐ Teachers can sort by any column
- ☐ Teachers can perform bulk actions (publish, archive, restore, delete)
- ☐ Teachers can add explanations and images
- ☐ Validation enforces correct option counts per type
- ☐ Pagination works (20 per page)

### 13.2 Mock Tests

**Done when:**
- ☐ Teachers can create mock tests with all settings
- ☐ Teachers can edit draft tests
- ☐ Teachers can delete draft tests
- ☐ Teachers can add/remove/reorder questions
- ☐ Teachers can set per-question marks and negative marks override
- ☐ Teachers can organize questions into sections
- ☐ Teachers can publish tests (with validation)
- ☐ Teachers can archive published tests
- ☐ Teachers can restore archived tests
- ☐ Published tests frozen (snapshots generated)
- ☐ Teachers can search and filter test list
- ☐ Pagination works (20 per page)

### 13.3 Results

**Done when:**
- ☐ Teachers can view results dashboard with aggregate stats
- ☐ Teachers can browse all results with filters (test, released status)
- ☐ Teachers can view individual result details
- ☐ Result detail shows: percentage, score, accuracy, correct/wrong/skipped, time, rank
- ☐ Subject breakdown shown when available
- ☐ Chapter breakdown shown when available
- ☐ Teachers can release results to students
- ☐ Teachers can hide released results
- ☐ Score color coding applied
- ☐ Pagination works (20 per page)

### 13.4 Students

**Done when:**
- ☐ Teachers can view student dashboard with stats
- ☐ Teachers can browse all students with search and filters
- ☐ Teachers can view individual student profiles
- ☐ Student profile shows: stats, strong/weak subjects, recent tests
- ☐ Teachers can navigate to student analytics and results
- ☐ Pagination works (25 per page)

### 13.5 Notifications

**Done when:**
- ☐ Teachers can view notification dashboard with stats
- ☐ Teachers can view recent notifications
- ☐ Teachers can create notifications with type, priority, audience
- ☐ Teachers can schedule notifications (UI only)
- ☐ Teachers can mark all notifications as read
- ☐ Teachers can view notification history with search and filters
- ☐ Delivery summary shown in history page

### 13.6 Analytics

**Done when:**
- ☐ All 9 analytics pages render with data
- ☐ Filter controls (batch, subject, mock test, date range) work
- ☐ ProgressRing animated correctly
- ☐ ScoreCard displays with correct data and trends
- ☐ ComparisonCard shows side-by-side comparison
- ☐ Export buttons present (placeholder)
- ☐ Loading skeletons shown during data fetch
- ☐ Empty states handled gracefully

### 13.7 Profile

**Done when:**
- ☐ Profile view shows all sections (header, stats, personal, professional, contact, bio)
- ☐ Edit profile allows updating all fields
- ☐ Profile photo can be uploaded
- ☐ Password can be changed
- ☐ Activity timeline shows events
- ☐ Security page shows status and actions
- ☐ Notification preferences can be toggled
- ☐ Tab navigation between profile sections works

### 13.8 Settings

**Done when:**
- ☐ Appearance setting applies theme immediately
- ☐ Language selection saved
- ☐ Timezone selection saved
- ☐ Dashboard preferences toggle visibility
- ☐ Privacy settings saved
- ☐ Session management options functional
- ☐ Keyboard shortcuts toggle works
- ☐ About & Version information displayed
- ☐ Support & Feedback links provided
- ☐ Data & Storage preferences toggle
- ☐ Reset all settings works with confirmation
- ☐ Clear local data works with confirmation

### 13.9 Navigation

**Done when:**
- ☐ Sidebar has all navigation items with correct routes
- ☐ Active sidebar item highlighted
- ☐ Breadcrumbs show page hierarchy
- ☐ Quick actions navigate correctly
- ☐ Links between modules work (student → profile, result → student, etc.)

---

## 14. Production Readiness Report

### 14.1 Module Scores

| Module | Frontend | Backend | QA Status | Risk | Notes |
|--------|----------|---------|-----------|------|-------|
| **Authentication** | 95% | 95% | ✅ Ready | Low | OTP flow tested. Demo mode fallback needs hardening. |
| **Dashboard** | 95% | 90% | ✅ Ready | Low | Uses multiple queries. Caching optimized. |
| **Question Bank** | 95% | 95% | ✅ Ready | Low | Full CRUD, bulk actions, filters. Import pending. |
| **Mock Tests** | 90% | 90% | ✅ Ready | Low | Publish workflow validated. Snapshots pending. |
| **Results** | 95% | 95% | ✅ Ready | Low | Full CRUD, release/hide, breakdowns. |
| **Students** | 90% | 85% | ✅ Ready | Low | Roster fetching works. Performance data via analytics hooks. |
| **Notifications** | 90% | 80% | ⚠️ Conditional | Medium | RLS for teacher send needs resolution. |
| **Analytics (9 pages)** | 90% | 85% | ⚠️ Conditional | Medium | Visualization components built. Needs analytics data pipeline. |
| **Profile** | 90% | 85% | ✅ Ready | Low | Full CRUD. Activity timeline aggregated from services. |
| **Settings** | 95% | 85% | ✅ Ready | Low | localStorage persistence. Needs sync with backend. |

### 14.2 Overall Readiness

| Area | Score | Notes |
|------|-------|-------|
| **Frontend** | 92% | All pages render. Components reusable. Dark mode consistent. Accessibility good. |
| **Backend Integration** | 88% | Most services connected to Supabase. Some areas need RLS updates. |
| **Error Handling** | 85% | Loading/empty states present. Error boundaries may need additional coverage. |
| **Performance** | 80% | Pagination implemented. Large dataset testing recommended. |
| **Accessibility** | 85% | ARIA attributes, keyboard nav, roles present. Audit recommended. |
| **Security (Frontend)** | 90% | RLS respected. No service_role key. No sensitive data in localStorage. |
| **Documentation** | 85% | Functional spec exists. Code comments thorough. |
| **Test Coverage** | 40% | No automated test suite yet. Manual test cases documented above. |

### 14.3 Must-Complete Before Production Launch

1. **🔴 RLS Policy for Teacher Notifications** — Teachers cannot currently INSERT into `notifications` table. Required for notification sending feature.
2. **🔴 XSS Prevention** — Ensure all user-generated content (question text, options, explanations) is sanitized before rendering.
3. **🔴 Large Dataset Performance Testing** — Test with 10K+ questions, 50K+ results to validate pagination and query performance.
4. **🟡 Snapshots Implementation** — Question snapshots are placeholder. Without them, editing a published question affects existing attempts.
5. **🟡 Seed Data for Analytics** — Analytics pages need underlying data from `mock_results` to render meaningful visualizations.
6. **🟡 Automated Test Suite** — No unit/integration tests exist. Critical paths should have test coverage before production.
7. **🟡 Error Boundary Coverage** — Ensure every route has a React error boundary to prevent blank screens.
8. **🟡 Loading State Audit** — Verify every data-fetching screen shows appropriate loading state.

---

## 15. Phase 2 Roadmap

### 15.1 Immediate (Next Sprint)

| Task | Effort | Dependencies |
|------|--------|-------------|
| Implement question snapshot generation | 3 days | Mock test publish workflow (done) |
| Add RLS policy for teacher notification INSERT | 1 day | Schema migration |
| Build Content Management UI pages | 5 days | Content service (done) |
| Implement bulk question import (CSV/Excel) | 3 days | Question service (done) |
| Add automated test suite (Jest + RTL) | 10 days | None |

### 15.2 Short Term (Next 2 Sprints)

| Task | Effort | Dependencies |
|------|--------|-------------|
| Live Classes module UI | 8 days | Jitsi integration |
| Jitsi Integration | 5 days | Live classes service |
| Export functionality (CSV/Excel/PDF) | 5 days | Results service |
| Schedule/Calendar view | 5 days | Live classes |
| Doubts module UI | 5 days | Doubts service exists |

### 15.3 Medium Term (Next Month)

| Task | Effort | Dependencies |
|------|--------|-------------|
| PYQ management UI | 5 days | Updated RLS for teachers |
| Notification scheduling backend | 3 days | Notification service |
| Analytics recommendations/insights | 8 days | Analytics data pipeline |
| Session tracking (login history, devices) | 5 days | New DB tables |
| Notification preferences server sync | 3 days | New DB table |

### 15.4 Long Term (Future)

| Task | Notes |
|------|-------|
| Student App Development | Full student-facing application |
| Admin Dashboard | Admin panel for institute management |
| Two-Factor Authentication | 2FA setup UI exists, backend needed |
| Connected Accounts (Google, M365, Zoom) | OAuth integrations |
| Payment Gateway Integration | Commerce module |
| Multi-Institute Assignment | Extend teacher profile for multiple institutes |
| Teacher Certifications & Awards | Extend profile module |
| Performance Optimization | CDN caching, query optimization, Redis |
| Monitoring & Alerting | Production monitoring setup |
| Deployment & CI/CD Pipeline | Production deployment automation |

---

## Appendix: Key Database Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `profiles` | User profiles (all roles) | profile_id, institute_id, name, email, phone, role, avatar_url |
| `teacher_details` | Teacher-specific data | teacher_id, profile_id, specialization, qualification, bio, rating |
| `questions` | Question bank | question_id, subject_id, chapter_id, question_type, difficulty, status |
| `question_options` | Answer options | option_id, question_id, option_text, is_correct, order_sequence |
| `question_explanations` | Solution explanations | explanation_id, question_id, explanation_text, correct_numerical_answer |
| `mock_tests` | Test configurations | test_id, teacher_id, stream_id, title, duration_min, status |
| `mock_test_questions` | Test-question junction | test_id, question_id, marks, order_sequence, question_snapshot |
| `mock_attempts` | Student attempts | attempt_id, test_id, student_id, status, started_at |
| `mock_answers` | Per-question answers | answer_id, attempt_id, question_id, is_correct, marks_awarded |
| `mock_results` | Computed results | result_id, attempt_id, total_score, percentage, rank, is_released |
| `notifications` | Notification events | notification_id, institute_id, title, body, event_type |
| `notification_recipients` | Per-user notification status | recipient_id, notification_id, profile_id, is_read |
| `streams` | Academic streams | stream_id, institute_id, name, code |
| `subjects` | Academic subjects | subject_id, stream_id, name, code |
| `chapters` | Chapter hierarchy | chapter_id, subject_id, name, display_order |
| `topics` | Topic hierarchy | topic_id, chapter_id, name, display_order |
| `batches` | Student batches | batch_id, stream_id, name, code |
| `batch_teachers` | Teacher-batch assignment | batch_id, teacher_id |
| `batch_students` | Student-batch assignment | batch_id, student_id |
| `content` | Learning materials | content_id, teacher_id, chapter_id, title, content_type, storage_path |
| `approval_requests` | Content/test approval workflow | approval_id, resource_type, resource_id, status, requested_by |
| `teacher_analytics` | Precomputed teacher metrics | teacher_id, total_students, avg_student_score, tests_created |

---

*End of Teacher Dashboard Testing & Functional Flow Document*
