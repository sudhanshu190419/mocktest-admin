# WEBSITE DEVELOPER KNOWLEDGE BASE

> **Version:** 1.0.0  
> **Generated from:** Actual source code (commit `main`, July 11, 2026)  
> **Purpose:** Complete technical reference for senior developers to understand, maintain, and extend the MockTest Admin website.  
> **Status:** 🟡 In Development — Active feature addition across Teacher & Admin dashboards.

---

# 1. Project Overview

## 1.1 Purpose

The **MockTest Admin** website is a role-based education technology platform that enables educational institutions to manage their examination lifecycle digitally. The platform supports three distinct user roles (admin, teacher, student) with role-specific dashboards, workflows, and access controls.

Core capabilities:
- **Question Bank Management**: Create, approve, publish, archive questions with options, images, and explanations
- **Mock Test Management**: Create, publish, and assign full-length mock tests to batches
- **Batch Management**: Create batches, assign teachers and students, track capacity
- **Academic Structure**: Manage streams, subjects, chapters, and topics
- **User Lifecycle Management**: Approve/reject/suspend teacher and student accounts
- **Analytics & Insights**: Performance tracking, leaderboards, trends
- **Content Management**: Upload, approve, and manage learning content
- **Notifications**: In-app notification system
- **Live Classes**: Schedule and manage live sessions

## 1.2 Supported User Roles

| Role | Description | Status |
|------|-------------|--------|
| **Admin** | Full platform control — user management, approvals, batch management, mock test oversight | 🟡 Partial Implementation |
| **Teacher** | Question creation, mock test authoring, batch management, student analytics | 🟡 Partial Implementation |
| **Student** | Attempt mock tests, view results, track performance | 🔴 Not Implemented |

## 1.3 Overall Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        UI Layer (Next.js App Router)             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │ Admin Pages  │  │ Teacher     │  │ Dev Console / Auth      │ │
│  │ (/admin/*)   │  │ Pages       │  │ (/dev/*, /, /pending*) │ │
│  └──────┬──────┘  │ (/teacher/*)│  └───────────┬─────────────┘ │
│         │         └──────┬──────┘              │                │
│         │                │                      │                │
│  ┌──────┴────────────────┴──────────────────────┴─────────────┐ │
│  │                React Query Hooks Layer                       │ │
│  │  (TanStack Query — caching, invalidation, staleTime)        │ │
│  └──────────────────────────┬──────────────────────────────────┘ │
│                             │                                    │
│  ┌──────────────────────────┴──────────────────────────────────┐ │
│  │                    Services Layer                            │ │
│  │  (Business logic, validation, Supabase queries, mapping)    │ │
│  └──────────────────────────┬──────────────────────────────────┘ │
│                             │                                    │
│  ┌──────────────────────────┴──────────────────────────────────┐ │
│  │              Supabase Client (Database + Auth + Storage)     │ │
│  └──────────────────────────┬──────────────────────────────────┘ │
│                             │                                    │
└─────────────────────────────┼────────────────────────────────────┘
                              │
                  ┌───────────┴───────────┐
                  │   PostgreSQL Database │
                  │   (15 Domains)        │
                  └───────────────────────┘
```

## 1.4 Folder Organization

```
mocktest-admin/
├── src/
│   ├── app/                   # Next.js App Router — pages & layouts
│   │   ├── admin/             # Admin dashboard pages
│   │   ├── teacher/           # Teacher dashboard pages
│   │   ├── dev/               # Developer console (testing)
│   │   ├── account-inactive/  # Account status pages
│   │   ├── account-rejected/
│   │   ├── account-suspended/
│   │   ├── pending-approval/
│   │   ├── api/               # API routes
│   │   ├── layout.tsx         # Root layout
│   │   └── page.tsx           # Root page (auth redirector)
│   ├── components/            # Reusable React components
│   │   ├── admin/             # Admin-specific components
│   │   ├── analytics/         # Chart & analytics components
│   │   ├── auth/              # Auth guard components
│   │   ├── dashboard/         # Faculty dashboard
│   │   ├── dev/               # Dev console components
│   │   ├── features/          # Feature-specific components (question-bank)
│   │   ├── profile/           # Profile page components
│   │   ├── teacher/           # Teacher-specific components
│   │   └── ui/                # Generic reusable UI components
│   ├── config/                # Configuration (supabase, storage)
│   ├── context/               # React contexts (AuthContext)
│   ├── data/                  # Mock data & type definitions
│   ├── hooks/                 # React Query hooks (organized by domain)
│   │   ├── academic/          # Streams, subjects, chapters, topics, batches
│   │   ├── admin/             # Dashboard, lifecycle, assignments, management
│   │   ├── analytics/         # Analytics queries
│   │   ├── content/           # Content management
│   │   ├── mockTest/          # Questions, options, images, attempts, results
│   │   ├── notification/      # Notifications
│   │   └── useAuth.ts         # Auth hook (bridges service → Redux)
│   ├── lib/                   # Library utilities
│   │   └── auth/              # Auth routing helpers
│   ├── services/              # Business logic & Supabase queries
│   │   ├── academic/          # Stream, subject, chapter, topic, batch services
│   │   ├── admin/             # Dashboard, lifecycle, management, assignment services
│   │   ├── analytics/         # Analytics services
│   │   ├── content/           # Content, approval, tag services
│   │   ├── mockTest/          # Question, option, image, attempt, result services
│   │   ├── notification/      # Notification services
│   │   ├── settings/          # Settings services
│   │   └── storage/           # Storage services
│   ├── store/                 # Redux store (authSlice)
│   ├── theme/                 # Design system tokens
│   ├── types/                 # TypeScript type definitions
│   ├── utils/                 # Utility functions
│   └── views/                 # Legacy view components
├── supabase/
│   └── migrations/            # SQL migration files
├── Documentation/             # Project documentation
│   └── Database_Schema/       # Schema domain documentation
└── *.md                       # Spec & contract documents
```

## 1.5 Implementation Status

| Module | Status | Completion % |
|--------|--------|-------------|
| Authentication | ✅ Implemented | 90% |
| Admin Dashboard | 🟡 Partially Implemented | 40% |
| Teacher Dashboard | 🟡 Partially Implemented | 60% |
| Student Dashboard | 🔴 Not Implemented | 0% |
| Question Bank | 🟡 Partially Implemented | 70% |
| Mock Test Engine | 🟡 Partially Implemented | 50% |
| Batch Management | 🟡 Partially Implemented | 60% |
| Academic Structure | 🟡 Partially Implemented | 50% |
| Analytics | 🟡 Partially Implemented | 40% |
| Notifications | 🟡 Partially Implemented | 30% |
| Content Management | 🟡 Partially Implemented | 30% |
| Profile/Settings | 🟡 Partially Implemented | 40% |
| Storage Integration | 🟡 Partially Implemented | 40% |
| HR Portal | 🟡 Partially Implemented | 30% |

---

# 2. Complete Technology Stack

## 2.1 Core Framework

| Technology | Version | Purpose |
|------------|---------|---------|
| **Next.js** | 19.2.x | React framework with App Router for SSR, RSC, file-based routing |
| **React** | 19.x | UI component library |
| **TypeScript** | ~5.x | Type safety across the entire codebase |

## 2.2 Styling & UI

| Technology | Purpose |
|------------|---------|
| **TailwindCSS** | Utility-first CSS framework for rapid styling |
| **@phosphor-icons/react** | Phosphor icon set (used in auth components, loading states) |

## 2.3 State Management & Data Fetching

| Technology | Purpose |
|------------|---------|
| **TanStack React Query** | Server state management — caching, invalidation, staleTime, retry |
| **Redux Toolkit** | Client state management (auth slice only) |
| **react-redux** | Redux React bindings |

## 2.4 Backend & Database

| Technology | Purpose |
|------------|---------|
| **Supabase JS Client** | Database queries, authentication, storage, realtime |
| **PostgreSQL** | Relational database (15 domain schemas, 50+ tables) |
| **Supabase Auth** | Authentication — phone-based with OTP, session management |
| **Supabase Storage** | File storage for images, documents, content |

## 2.5 Font & Typography

| Technology | Purpose |
|------------|---------|
| **Geist (Geist Sans + Geist Mono)** | Primary font family from Vercel |

## 2.6 Development Tools

| Tool | Purpose |
|------|---------|
| **ESLint** | Code linting with Next.js config |
| **PostCSS** | CSS processing (via next.config.ts) |

## 2.7 Not Used (Available in package.json but not in source)

The following packages are in `package.json` but are NOT yet imported/used in the source code:
- `react-hook-form` — Form validation (available for future use)
- `zod` — Schema validation (available for future use — referenced in comments)
- `lucide-react` — Icon library (not imported anywhere)

---

# 3. Complete Folder Structure

## 3.1 `src/app` — Next.js App Router Pages

```
src/app/
├── account-inactive/page.tsx          # Teacher account: status = inactive
├── account-rejected/page.tsx           # Teacher account: status = rejected
├── account-suspended/page.tsx          # Teacher account: status = suspended
├── pending-approval/page.tsx           # Teacher account: status = pending
├── admin/
│   ├── layout.tsx                      # Admin layout (AdminHeader + AdminSidebar)
│   ├── page.tsx                        # Admin dashboard overview
│   ├── batches/
│   │   ├── page.tsx                    # Batch management list
│   │   └── [id]/page.tsx               # Batch detail page
│   ├── mock-tests/
│   │   ├── page.tsx                    # Mock test management list
│   │   └── [id]/page.tsx              # Mock test detail page
│   ├── questions/
│   │   ├── page.tsx                    # Question approval list
│   │   └── [id]/page.tsx              # Question approval detail
│   ├── students/
│   │   ├── page.tsx                    # Student management list
│   │   └── [id]/page.tsx              # Student detail page
│   └── teachers/
│       ├── page.tsx                    # Teacher management list
│       └── [id]/page.tsx              # Teacher detail page
├── api/debug/student-data/route.ts     # Debug API route
├── dev/
│   ├── layout.tsx                      # Dev console layout
│   ├── page.tsx                        # Dev console home
│   ├── academic/page.tsx               # Academic structure debug
│   ├── analytics/page.tsx              # Analytics debug
│   ├── attempts/page.tsx               # Attempts debug
│   ├── authentication/page.tsx         # Auth testing
│   ├── content/page.tsx                # Content management debug
│   ├── mock-tests/page.tsx             # Mock tests debug
│   ├── notifications/page.tsx          # Notifications debug
│   ├── question-bank/page.tsx          # Question bank debug
│   ├── results/page.tsx                # Results debug
│   ├── settings/page.tsx               # Settings debug
│   └── storage/page.tsx               # Storage debug
├── teacher/
│   ├── layout.tsx                      # Teacher layout (Header + Sidebar)
│   ├── page.tsx                        # Teacher dashboard overview
│   ├── analytics/
│   │   ├── layout.tsx                  # Analytics layout
│   │   ├── page.tsx                    # Analytics dashboard
│   │   ├── chapters/page.tsx           # Chapter analytics
│   │   ├── insights/page.tsx           # Data-driven insights
│   │   ├── leaderboards/page.tsx       # Leaderboard
│   │   ├── mock-tests/page.tsx         # Mock test analytics
│   │   ├── questions/page.tsx          # Question analytics
│   │   ├── students/page.tsx           # Student analytics
│   │   ├── subjects/page.tsx           # Subject analytics
│   │   └── trends/page.tsx             # Performance trends
│   ├── mock-tests/
│   │   ├── page.tsx                    # Mock tests home
│   │   ├── create/page.tsx             # Create mock test
│   │   ├── list/page.tsx               # Mock test list
│   │   ├── [id]/edit/page.tsx          # Edit mock test
│   │   ├── [id]/preview/page.tsx       # Preview mock test
│   │   ├── [id]/publish/page.tsx       # Publish workflow
│   │   └── [id]/questions/page.tsx     # Manage test questions
│   ├── notifications/
│   │   ├── page.tsx                    # Notifications home
│   │   ├── create/page.tsx             # Create notification
│   │   ├── history/page.tsx            # Notification history
│   │   ├── list/page.tsx               # Notification list
│   │   ├── scheduled/page.tsx          # Scheduled notifications
│   │   └── [id]/page.tsx              # Notification detail
│   ├── profile/
│   │   ├── layout.tsx                  # Profile layout
│   │   ├── page.tsx                    # Profile home
│   │   ├── activity/page.tsx           # Activity timeline
│   │   ├── edit/page.tsx              # Edit profile
│   │   ├── preferences/page.tsx        # Preferences
│   │   └── security/page.tsx           # Security settings
│   ├── questions/
│   │   ├── page.tsx                    # Questions home
│   │   ├── create/page.tsx             # Create question
│   │   ├── import/page.tsx             # Bulk import
│   │   ├── list/page.tsx               # Question bank list
│   │   ├── [id]/edit/page.tsx          # Edit question
│   │   └── [id]/preview/page.tsx       # Preview question
│   ├── results/
│   │   ├── page.tsx                    # Results home
│   │   ├── list/page.tsx               # Results list
│   │   ├── [id]/page.tsx              # Result detail
│   │   └── [id]/questions/page.tsx    # Result questions
│   ├── settings/
│   │   ├── layout.tsx                  # Settings layout
│   │   └── page.tsx                    # Settings page
│   └── students/
│       ├── page.tsx                    # Students home
│       ├── list/page.tsx               # Student roster
│       ├── [id]/page.tsx              # Student detail
│       ├── [id]/activity/page.tsx      # Student activity
│       ├── [id]/analytics/page.tsx     # Student analytics
│       └── [id]/results/page.tsx       # Student results
├── globals.css                         # Global TailwindCSS styles
├── layout.tsx                          # Root layout
└── page.tsx                            # Root page (auth redirector)
```

## 3.2 `src/components` — Reusable Components

```
src/components/
├── admin/
│   ├── AdminHeader.tsx                 # Admin dashboard header
│   └── AdminSidebar.tsx               # Admin dashboard sidebar navigation
├── analytics/
│   ├── AnalyticsFilter.tsx             # Analytics date/filter controls
│   ├── BarChart.tsx                    # Bar chart visualization
│   ├── ComparisonCard.tsx              # Side-by-side comparison card
│   ├── InsightCard.tsx                 # AI-driven insight display
│   ├── LeaderboardCard.tsx             # Student ranking leaderboard
│   ├── LineChart.tsx                   # Line chart visualization
│   ├── MetricCard.tsx                  # Single metric display card
│   ├── PieChart.tsx                    # Pie chart visualization
│   ├── ProgressRing.tsx                # Circular progress indicator
│   ├── ScoreCard.tsx                   # Score display card
│   └── TrendCard.tsx                   # Trend indicator card
├── auth/
│   └── RoleGuard.tsx                   # Route protection component
├── dashboard/
│   └── FacultyDashboard.tsx            # Main teacher dashboard
├── dev/
│   ├── academic/                       # Academic structure dev panels
│   │   ├── AcademicDashboard.tsx
│   │   ├── BatchPanel.tsx
│   │   ├── ChapterPanel.tsx
│   │   ├── StreamPanel.tsx
│   │   ├── SubjectPanel.tsx
│   │   └── TopicPanel.tsx
│   ├── analytics/
│   │   └── AnalyticsPanel.tsx
│   ├── attempt/                        # Mock attempt dev panels
│   │   ├── AttemptsPanel.tsx
│   │   ├── AutoSavePanel.tsx
│   │   ├── EvaluationPanel.tsx
│   │   ├── QuestionNavPanel.tsx
│   │   ├── ResponsesPanel.tsx
│   │   ├── ResultSummaryPanel.tsx
│   │   └── SubmitPanel.tsx
│   ├── content/                        # Content management dev panels
│   │   ├── ApprovalPanel.tsx
│   │   ├── ContentDashboard.tsx
│   │   ├── ContentPanel.tsx
│   │   ├── StorageInspector.tsx
│   │   └── TagsPanel.tsx
│   ├── mock-test/                      # Mock test dev panels
│   │   ├── MockTestsPanel.tsx
│   │   ├── PublishWorkflowPanel.tsx
│   │   └── TestQuestionsPanel.tsx
│   ├── notifications/
│   │   └── NotificationsPanel.tsx
│   ├── question-bank/                  # Question bank dev panels
│   │   ├── ExplanationsPanel.tsx
│   │   ├── ImagesPanel.tsx
│   │   ├── QuestionOptionsPanel.tsx
│   │   └── QuestionsPanel.tsx
│   ├── results/
│   │   └── ResultsPanel.tsx
│   ├── ApiResponseCard.tsx             # API response display
│   ├── DebugPanel.tsx                  # Generic debug panel
│   ├── DevHeader.tsx                   # Dev console header
│   ├── DevModuleCard.tsx               # Dev module card
│   ├── DevSidebar.tsx                  # Dev console sidebar
│   ├── JsonViewer.tsx                  # JSON display component
│   ├── LoadingIndicator.tsx            # Loading states
│   ├── SectionCard.tsx                 # Section wrapper
│   ├── SessionInfo.tsx                 # Auth session info
│   └── StatusBadge.tsx                 # Status badge
├── profile/
│   ├── ActivityTimeline.tsx            # Activity feed
│   ├── NotificationToggle.tsx          # Notification toggle
│   ├── ProfileCompletionCard.tsx       # Profile completion progress
│   ├── ProfileHeader.tsx               # Profile header
│   ├── ProfileSection.tsx              # Profile section wrapper
│   └── SecurityCard.tsx               # Security settings card
├── teacher/
│   ├── Header.tsx                      # Teacher dashboard header
│   └── Sidebar.tsx                     # Teacher dashboard sidebar
├── ui/                                 # Generic reusable UI components
│   ├── ConfirmDialog.tsx               # Confirmation modal
│   ├── DataTable.tsx                   # Sortable, paginated table
│   ├── EmptyState.tsx                  # Empty state placeholder
│   ├── FilterPanel.tsx                 # Filter controls
│   ├── LoadingSkeleton.tsx             # Loading skeleton
│   ├── PageHeader.tsx                  # Page header with breadcrumbs
│   ├── SearchBar.tsx                   # Search input
│   ├── Select.tsx                      # Select dropdown
│   └── StatusBadge.tsx                 # Status badge
├── Header.tsx                          # Legacy header
└── Sidebar.tsx                         # Legacy sidebar
```

## 3.3 `src/hooks` — React Query Hooks

All hooks are organized by domain module:

```
src/hooks/
├── academic/                           # Academic structure hooks
│   ├── queryKeys.ts                    # Academic query key factory
│   ├── useBatches.ts                   # Batch CRUD hooks (5 exports)
│   ├── useChapters.ts                  # Chapter CRUD hooks (5 exports)
│   ├── useStreams.ts                   # Stream CRUD hooks (5 exports)
│   ├── useSubjects.ts                  # Subject CRUD hooks (5 exports)
│   └── useTopics.ts                    # Topic CRUD hooks (5 exports)
├── admin/                              # Admin dashboard hooks
│   ├── queryKeys.ts                    # Admin query key factory
│   ├── useAdminDashboard.ts            # Dashboard stats hooks
│   ├── useBatchManagement.ts           # Batch management (12 exports)
│   ├── useBatchStudentAssignment.ts    # Student assignment (7 exports)
│   ├── useBatchTeacherAssignment.ts    # Teacher assignment (6 exports)
│   ├── useMockTestAssignment.ts        # Mock test assignment (7 exports)
│   ├── useMockTestManagement.ts        # Mock test management (12 exports)
│   ├── useQuestionApproval.ts          # Question approval (14 exports)
│   ├── useStudentLifecycle.ts          # Student lifecycle (13 exports)
│   └── useTeacherLifecycle.ts          # Teacher lifecycle (13 exports)
├── analytics/                          # Analytics hooks
│   ├── queryKeys.ts                    # Analytics query key factory
│   ├── queryKeys-extended.ts           # Extended teacher analytics keys
│   ├── useAnalytics.ts                 # Analytics queries (10 exports)
│   └── useTeacherAnalyticsService.ts   # Teacher analytics (9 exports)
├── content/                            # Content management hooks
│   ├── queryKeys.ts                    # Content query keys
│   ├── useApproval.ts                  # Content approval hooks
│   ├── useContent.ts                   # Content CRUD hooks
│   └── useTags.ts                      # Tag management hooks
├── mockTest/                           # Mock test & question hooks
│   ├── queryKeys.ts                    # Mock test query key factory
│   ├── useMockAttempts.ts              # Attempts & answers (16 exports)
│   ├── useMockResults.ts               # Result queries (9 exports)
│   ├── useMockTestPublish.ts           # Publish workflow (3 exports)
│   ├── useMockTestQuestions.ts         # Test questions (8 exports)
│   ├── useMockTests.ts                 # Mock tests CRUD (8 exports)
│   ├── useQuestionExplanations.ts      # Explanations (5 exports)
│   ├── useQuestionImages.ts            # Question images (6 exports)
│   ├── useQuestionOptions.ts           # Question options (6 exports)
│   └── useQuestions.ts                 # Questions CRUD (8 exports)
├── notification/
│   ├── queryKeys.ts                    # Notification query keys
│   └── useNotifications.ts             # Notification hooks
└── useAuth.ts                          # Auth orchestration hook
```

## 3.4 `src/services` — Service Layer

```
src/services/
├── academic/
│   ├── batchService.ts                 # Batch CRUD (admin-academic)
│   ├── chapterService.ts               # Chapter CRUD
│   ├── streamService.ts                # Stream CRUD
│   ├── subjectService.ts               # Subject CRUD
│   └── topicService.ts                 # Topic CRUD
├── admin/
│   ├── batchManagementService.ts       # Admin batch lifecycle management
│   ├── batchStudentAssignmentService.ts # Student-batch assignment
│   ├── batchTeacherAssignmentService.ts # Teacher-batch assignment
│   ├── dashboardService.ts             # Admin dashboard aggregation
│   ├── mockTestAssignmentService.ts    # Mock test-batch assignment
│   ├── mockTestManagementService.ts    # Admin mock test lifecycle
│   ├── questionApprovalService.ts      # Admin question approval
│   ├── studentLifecycleService.ts      # Student account lifecycle
│   └── teacherLifecycleService.ts      # Teacher account lifecycle
├── analytics/
│   ├── analyticsService.ts             # Analytics data queries
│   └── teacherAnalyticsService.ts      # Teacher analytics
├── content/
│   ├── approvalService.ts              # Content approval
│   ├── contentService.ts               # Content CRUD
│   ├── tagService.ts                   # Tag management
│   └── teacherResolver.ts              # Teacher identity for content
├── mockTest/
│   ├── mockAttemptService.ts           # Mock test attempt operations
│   ├── mockEvaluationService.ts        # Attempt evaluation
│   ├── mockResultService.ts            # Mock test results
│   ├── mockTestPublishService.ts       # Publish workflow
│   ├── mockTestQuestionService.ts      # Test-question assignments
│   ├── mockTestService.ts              # Mock test CRUD
│   ├── questionExplanationService.ts   # Question explanations
│   ├── questionImageService.ts         # Question images (storage + DB)
│   ├── questionOptionService.ts        # Question options
│   └── questionService.ts              # Question CRUD
├── notification/
│   └── notificationService.ts          # Notification operations
├── settings/
│   └── settingsService.ts              # Settings operations
├── storage/
│   ├── questionImageService.ts         # Storage operations for images
│   └── storageService.ts               # Generic storage operations
├── adminService.ts                     # Legacy admin service
├── assessmentService.ts                # Assessment operations
├── authService.ts                      # Authentication service
├── classService.ts                     # Live class operations
├── notificationService.ts              # Legacy notification service
├── ocrIngestionService.ts              # OCR for question ingestion
├── profileService.ts                   # Teacher profile operations
├── questionOptionImageService.ts       # Option image operations
├── teacherIdentity.ts                  # Teacher ID resolution
└── teacherService.ts                   # Legacy teacher service
```

## 3.5 `src/types` — Type Definitions

```
src/types/
├── academic.ts              # Academic entities: Stream, Subject, Chapter, Topic, Batch, PaginatedResponse, ApiResponse
├── analytics.ts             # Analytics types: StudentAnalytics, TeacherAnalytics, DashboardAnalytics, etc.
├── analytics-extended.ts    # Extended teacher analytics types
├── auth.ts                  # Auth types: UserProfile, DbProfile, AccountStatus, UserRole, AuthResponse, etc.
├── content.ts               # Content management types
├── mockTest.ts              # Mock test types: Question, MockTest, MockAttempt, MockResult, QuestionOption, etc.
├── notification.ts          # Notification types
├── profile.ts               # Profile types: TeacherProfileData, BasicInfo, ProfessionalInfo, etc.
└── settings/
    └── index.ts             # Settings types
```

## 3.6 Other Key Files

| Path | Purpose |
|------|---------|
| `src/config/supabase.ts` | Supabase client initialization |
| `src/config/storage.ts` | Storage bucket configuration, path templates, MIME types |
| `src/context/AuthContext.tsx` | Auth context provider — session, profile, OTP flow |
| `src/data/mockData.ts` | Mock data: TeacherProfile, batches, students, analytics |
| `src/lib/providers.tsx` | App providers: Redux + React Query + AuthContext |
| `src/lib/auth/routing.ts` | Role-based post-login routing matrix |
| `src/lib/utils.ts` | `cn()` utility for class merging |
| `src/store/index.ts` | Redux store configuration |
| `src/store/authSlice.ts` | Auth Redux slice |
| `src/store/hooks.ts` | Typed Redux hooks |
| `src/theme/colors.ts` | Design system colors |
| `src/theme/typography.ts` | Typography tokens |
| `src/theme/spacing.ts` | Spacing tokens |
| `src/theme/shadows.ts` | Shadow tokens |
| `src/theme/radius.ts` | Border radius tokens |
| `src/theme/sizes.ts` | Size tokens |
| `src/theme/components.ts` | Component-specific tokens |
| `src/theme/icons.ts` | Icon configuration |
| `src/theme/index.ts` | Theme barrel export |
| `src/theme/utils.ts` | Theme utility helpers |
| `src/utils/supabase.ts` | Supabase utilities: pagination, error extraction, UUID validation |
| `src/utils/response.ts` | `buildPaginatedResponse()` helper |
| `src/utils/analytics.ts` | Analytics utility functions |
| `src/utils/mockResults.ts` | Mock result generation |
| `src/utils/notification.ts` | Notification utilities |
| `src/utils/storage.ts` | Storage utilities |

---

# 4. Application Architecture

## 4.1 Layer Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  UI Layer                                                           │
│  (Next.js Pages & Components)                                       │
│                                                                     │
│  · Pages consume hooks → render UI                                  │
│  · Components receive props → render markup                         │
│  · Auth guards (RoleGuard) protect routes                           │
│  · Toast/notifications show errors & success                        │
└──────────────────────┬──────────────────────────────────────────────┘
                       │ calls hooks
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  React Query Hooks Layer                                           │
│  (TanStack Query — useQuery, useMutation)                          │
│                                                                     │
│  · Manages caching (query keys, staleTime, gcTime)                  │
│  · Handles cache invalidation on mutations                         │
│  · Transforms service responses into typed data                    │
│  · Handles loading/error states via Query status                   │
└──────────────────────┬──────────────────────────────────────────────┘
                       │ calls services
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Services Layer                                                     │
│  (Business Logic & Data Access)                                     │
│                                                                     │
│  · ALL business logic lives here                                    │
│  · Input validation (phone format, UUID format, date ranges)        │
│  · Business rules (status transitions, capacity checks)            │
│  · Database queries (via Supabase client)                          │
│  · Data mapping (snake_case → camelCase)                           │
│  · Error handling (normalised to ApiResponse<T>)                   │
│  · UUID validation before DB queries                               │
│  · File upload to Supabase Storage                                 │
└──────────────────────┬──────────────────────────────────────────────┘
                       │ calls supabase
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Supabase Client                                                    │
│  (Database + Auth + Storage)                                        │
│                                                                     │
│  · Handles all database operations via PostgREST                    │
│  · Authentication via Supabase Auth (phone + OTP)                   │
│  · File storage via Supabase Storage (images, documents)            │
│  · RLS policies control row-level access                           │
└──────────────────────┬──────────────────────────────────────────────┘
                       │ queries
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PostgreSQL Database                                                │
│  (15 Domain Schemas, 50+ tables)                                    │
│                                                                     │
│  · Foundation (Domain 01): profiles, institutes                     │
│  · Academic (Domain 02): streams, subjects, chapters, topics       │
│  · Content (Domain 03): content, tags, approval_requests           │
│  · Live Learning (Domain 04): live_classes, attendance             │
│  · Assessment (Domain 05): questions, options, mock_tests, results │
│  · PYQ (Domain 06): previous year questions                        │
│  · Commerce (Domain 07): orders, payments                          │
│  · Analytics (Domain 08): teacher_analytics, performance data      │
│  · Notifications (Domain 09): notifications, recipients            │
│  · Administration (Domain 10): audit logs, settings                │
│  · Subscription (Domain 11): plans, access control                 │
│  · File/Media (Domain 12): storage metadata                        │
│  · Teacher (Domain 13): teacher_details, qualifications, documents │
│  · Student (Domain 14): student_details, doubts, services          │
│  · Infrastructure (Domain 15): system config, jobs                 │
└─────────────────────────────────────────────────────────────────────┘
```

## 4.2 Why Business Logic Exists Only Inside Services

The architecture enforces a strict **Service Layer pattern** for these reasons:

1. **Single Responsibility**: Services own data access + business logic. Hooks only handle caching. Components only handle rendering.

2. **Testability**: Services can be unit-tested independently of React. No mock providers needed.

3. **Consistency**: Every service method returns `ApiResponse<T>` — a standardised `{ success, data, error, warning }` shape. Consumers never handle raw Supabase errors.

4. **Validation Centralization**: UUID validation, date range checks, and business rules (e.g., status transitions) are defined in one place and reused everywhere.

5. **Mapping Layer**: The service layer converts snake_case DB columns to camelCase TypeScript interfaces. Components never see `question_id`.

6. **Error Normalisation**: `extractErrorMessage()` normalises AuthError, PostgrestError, Error, and unknown error types into a single human-readable string.

## 4.3 Standard Response Pattern

Every service method returns:
```typescript
interface ApiResponse<T> {
  success: boolean;
  data?: T;           // Present when success = true
  error?: string;     // Human-readable error message when success = false
  warning?: string;   // Non-fatal warning alongside a successful response
}
```

Paginated responses use:
```typescript
interface PaginatedResponse<T> {
  data: T[];          // Array of items for the current page
  count: number;      // Total number of items (for pagination UI)
  page: number;       // Current page number
  pageSize: number;   // Items per page
}
```

Built via `buildPaginatedResponse(items, count, page, pageSize)` in `src/utils/response.ts`.

---

# 5. Routing Structure

## 5.1 Complete Route Map

### Status Route Pages

| Route | Type | Purpose | Access |
|-------|------|---------|--------|
| `/` | Page | Root page — auth redirector or FacultyDashboard | Public |
| `/pending-approval` | Page | Teacher account pending approval | Teacher (pending) |
| `/account-rejected` | Page | Teacher account rejected | Teacher (rejected) |
| `/account-suspended` | Page | Teacher account suspended | Teacher (suspended) |
| `/account-inactive` | Page | Teacher account inactive | Teacher (inactive) |

### Admin Routes

| Route | Type | Purpose |
|-------|------|---------|
| `/admin` | Layout + Page | Admin dashboard — overview stats |
| `/admin/teachers` | Page | Teacher lifecycle management list |
| `/admin/teachers/[id]` | Page | Teacher detail page |
| `/admin/students` | Page | Student lifecycle management list |
| `/admin/students/[id]` | Page | Student detail page |
| `/admin/batches` | Page | Batch management list |
| `/admin/batches/[id]` | Page | Batch detail page |
| `/admin/questions` | Page | Question approval list |
| `/admin/questions/[id]` | Page | Question approval detail |
| `/admin/mock-tests` | Page | Mock test management list |
| `/admin/mock-tests/[id]` | Page | Mock test detail page |

### Teacher Routes

| Route | Type | Purpose |
|-------|------|---------|
| `/teacher` | Layout + Page | Teacher dashboard overview |
| `/teacher/questions` | Page | Questions home |
| `/teacher/questions/create` | Page | Create new question |
| `/teacher/questions/[id]/edit` | Page | Edit question |
| `/teacher/questions/[id]/preview` | Page | Preview question |
| `/teacher/questions/list` | Page | Question bank list |
| `/teacher/questions/import` | Page | Bulk import questions |
| `/teacher/mock-tests` | Page | Mock tests home |
| `/teacher/mock-tests/create` | Page | Create mock test |
| `/teacher/mock-tests/list` | Page | Mock test list |
| `/teacher/mock-tests/[id]/edit` | Page | Edit mock test |
| `/teacher/mock-tests/[id]/preview` | Page | Preview mock test |
| `/teacher/mock-tests/[id]/publish` | Page | Publish workflow |
| `/teacher/mock-tests/[id]/questions` | Page | Manage test questions |
| `/teacher/students` | Page | Students home |
| `/teacher/students/list` | Page | Student roster |
| `/teacher/students/[id]` | Page | Student detail |
| `/teacher/students/[id]/activity` | Page | Student activity |
| `/teacher/students/[id]/analytics` | Page | Student analytics |
| `/teacher/students/[id]/results` | Page | Student results |
| `/teacher/results` | Page | Results home |
| `/teacher/results/list` | Page | Results list |
| `/teacher/results/[id]` | Page | Result detail |
| `/teacher/results/[id]/questions` | Page | Result questions |
| `/teacher/analytics` | Layout + Page | Analytics dashboard |
| `/teacher/analytics/chapters` | Page | Chapter analytics |
| `/teacher/analytics/insights` | Page | Data-driven insights |
| `/teacher/analytics/leaderboards` | Page | Leaderboard |
| `/teacher/analytics/mock-tests` | Page | Mock test analytics |
| `/teacher/analytics/questions` | Page | Question analytics |
| `/teacher/analytics/students` | Page | Student analytics |
| `/teacher/analytics/subjects` | Page | Subject analytics |
| `/teacher/analytics/trends` | Page | Performance trends |
| `/teacher/profile` | Layout + Page | Profile home |
| `/teacher/profile/edit` | Page | Edit profile |
| `/teacher/profile/activity` | Page | Activity timeline |
| `/teacher/profile/preferences` | Page | Preferences |
| `/teacher/profile/security` | Page | Security settings |
| `/teacher/settings` | Layout + Page | Settings |
| `/teacher/notifications` | Page | Notifications home |
| `/teacher/notifications/create` | Page | Create notification |
| `/teacher/notifications/list` | Page | Notification list |
| `/teacher/notifications/history` | Page | Notification history |
| `/teacher/notifications/scheduled` | Page | Scheduled notifications |
| `/teacher/notifications/[id]` | Page | Notification detail |

### Dev Console Routes

| Route | Type | Purpose |
|-------|------|---------|
| `/dev` | Layout + Page | Dev console home |
| `/dev/authentication` | Page | Auth testing |
| `/dev/academic` | Page | Academic structure |
| `/dev/question-bank` | Page | Question bank testing |
| `/dev/mock-tests` | Page | Mock tests testing |
| `/dev/attempts` | Page | Attempts testing |
| `/dev/results` | Page | Results testing |
| `/dev/analytics` | Page | Analytics testing |
| `/dev/content` | Page | Content testing |
| `/dev/notifications` | Page | Notifications testing |
| `/dev/settings` | Page | Settings testing |
| `/dev/storage` | Page | Storage testing |

### API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/debug/student-data` | GET | Debug student data endpoint |

## 5.2 Navigation Flow

### Authentication Flow

```
/ (root)
│
├── Not Authenticated → FacultyDashboard (login/register)
│       │
│       └── Authenticated
│           │
│           ├── role=admin → /admin
│           │
│           ├── role=teacher, status=approved → /teacher
│           │
│           ├── role=teacher, status=pending → /pending-approval
│           │
│           ├── role=teacher, status=rejected → /account-rejected
│           │
│           ├── role=teacher, status=suspended → /account-suspended
│           │
│           └── role=teacher, status=inactive → /account-inactive
```

### Admin Navigation

```
/admin
├── Overview (stats dashboard)
├── Teachers → /admin/teachers → /admin/teachers/[id]
├── Students → /admin/students → /admin/students/[id]
├── Batches  → /admin/batches  → /admin/batches/[id]
├── Questions → /admin/questions → /admin/questions/[id]
└── Mock Tests → /admin/mock-tests → /admin/mock-tests/[id]
```

### Teacher Navigation

```
/teacher
├── Overview (dashboard)
├── Questions → create, list, [id]/edit, [id]/preview, import
├── Mock Tests → create, list, [id]/edit, [id]/preview, [id]/publish, [id]/questions
├── Students → list, [id]/, [id]/activity, [id]/analytics, [id]/results
├── Results → list, [id]/, [id]/questions
├── Analytics → chapters, insights, leaderboards, mock-tests, questions, students, subjects, trends
├── Profile → edit, activity, preferences, security
├── Settings
└── Notifications → create, list, history, scheduled, [id]
```

---

# 6. Authentication

## 6.1 Authentication Flow

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  Login   │────▶│ Supabase │────▶│  Auth    │────▶│ Redirect │
│  View    │     │ Auth     │     │ Context  │     │ to Role  │
│  (Phone) │     │ API      │     │ Load     │     │ Dashboard│
└──────────┘     └──────────┘     │ Profile  │     └──────────┘
                                  └──────────┘
```

## 6.2 Auth Implementation Details

**Core Components:**
- `src/context/AuthContext.tsx` — AuthProvider with all auth state and methods
- `src/hooks/useAuth.ts` — Redux-based auth orchestration hook
- `src/services/authService.ts` — Clean architecture auth operations
- `src/types/auth.ts` — Auth type definitions
- `src/lib/auth/routing.ts` — Post-login routing matrix
- `src/store/authSlice.ts` — Redux auth state management

**Authentication Method:** Phone + Password with optional SMS OTP verification.

**Auth State:**
```typescript
interface AuthState {
  initialized: boolean;
  loading: boolean;
  user: UserProfile | null;
  isAuthenticated: boolean;
  error: string | null;
  session: SessionData | null;
}
```

**Auth Provider State:**
```typescript
interface AuthContextType {
  session: Session | null;
  user: User | null;
  teacherProfile: TeacherProfile | null;
  instituteId: string | null;
  loading: boolean;
  isDemoMode: boolean;
  needsOtpVerification: boolean;
  pendingPhone: string | null;
  signIn: (phone: string, pass: string) => Promise<{ error: string | null }>;
  registerTeacher: (phone: string, pass: string, facultyId: string, fullName: string, department: string) => Promise<{ error: string | null }>;
  verifyRegistrationOtp: (token: string) => Promise<{ error: string | null }>;
  resendRegistrationOtp: () => Promise<{ error: string | null }>;
  cancelOtpVerification: () => void;
  signInAsDemo: () => void;
  signOut: () => Promise<void>;
  updateSpecialization: (specialization: string) => void;
  completeOnboarding: (data) => Promise<void>;
  skipOnboarding: () => void;
}
```

## 6.3 Registration Flow

```
Register (Phone, Password, Name, Faculty ID)
    │
    ├── Input Validation (phone format, password >= 6 chars)
    │
    ├── supabase.auth.signUp({ phone, password })
    │       │
    │       └── Success → Store pendingRegistration in AuthContext
    │                     Set needsOtpVerification = true
    │                     Show OTP verification screen
    │
    ├── verifyRegistrationOtp(token)
    │       │
    │       ├── supabase.auth.verifyOtp({ phone, token, type: 'sms' })
    │       │
    │       └── Success → Insert teacher_details row
    │                     Load teacher profile
    │                     Redirect to /teacher
    │
    └── cancelOtpVerification()
            │
            └── Clear pending state → Back to registration form
```

## 6.4 Login Flow

```
signIn(phone, password)
    │
    ├── supabase.auth.signInWithPassword({ phone, password })
    │       │
    │       ├── Success → Load profile from profiles + teacher_details
    │       │             Cache teacher identity
    │       │             Redirect via getPostLoginDestination()
    │       │
    │       └── Error → Check for demo mode keywords ("teacher", "admin", "demo")
    │                    If demo mode → Set isDemoMode = true, use mock profile
    │                    Otherwise → Return error message
```

## 6.5 Session Management

- **Session persistence**: Supabase client configured with `persistSession: true`, `autoRefreshToken: true`, `detectSessionInUrl: true`
- **On mount**: `AuthProvider` checks `supabase.auth.getSession()` and restores the session
- **On auth state change**: `supabase.auth.onAuthStateChange()` listener updates session, user, and profile
- **On sign out**: Clears session, user, teacherProfile, localStorage flags, and teacher identity cache
- **Demo mode**: Uses `localStorage` flags (`EDTECH_DEMO_MODE`, `EDTECH_SIM_ROLE`, `EDTECH_CUSTOM_FACULTY`) to persist mock state

## 6.6 Role-Based Routing

Defined in `src/lib/auth/routing.ts`:

```typescript
function getPostLoginDestination(role: string, accountStatus?: string): string {
  // Admin → /admin regardless of status
  // Teacher + approved → /teacher
  // Teacher + pending → /pending-approval
  // Teacher + rejected → /account-rejected
  // Teacher + suspended → /account-suspended
  // Teacher + inactive → /account-inactive
  // Student / Unknown → / (root / FacultyDashboard)
}
```

## 6.7 Protected Routes with RoleGuard

The `RoleGuard` component (`src/components/auth/RoleGuard.tsx`) protects routes:

```tsx
// Admin-only route:
<RoleGuard allowedRoles={['admin']}>
  <AdminDashboard />
</RoleGuard>

// Teacher route (approved teachers + admins):
<RoleGuard allowedRoles={['teacher', 'admin']} allowedAccountStatuses={['approved']}>
  <TeacherDashboard />
</RoleGuard>
```

**Behaviour:**
- Auth loading → Shows loading spinner
- Not authenticated → Redirects to `/`
- Role not in allowedRoles → Redirects via `getPostLoginDestination()`
- Admin users bypass account status checks
- All checks pass → Renders children

## 6.8 Permission Model

Currently, permissions are handled via:
1. **Route-level**: `RoleGuard` component checks `allowedRoles` and `allowedAccountStatuses`
2. **Component-level**: Components check `teacherProfile.role` for conditional rendering
3. **Database-level**: PostgreSQL RLS (Row-Level Security) policies in migrations control data access

There is NO fine-grained permission system (e.g., "can_edit_questions", "can_view_results"). This is a future enhancement.

---

# 7. Complete Component Library

## 7.1 UI Components (`src/components/ui/`)

### PageHeader

**Purpose:** Standardised page header with title, optional description, breadcrumbs, and action buttons.

**Props:**
```typescript
interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumbs?: BreadcrumbItem[];  // { label: string; href?: string }
  actions?: React.ReactNode;
}
```

**Where used:** Every admin and teacher page.

### DataTable

**Purpose:** Generic sortable, paginated data table with optional row selection.

**Props:**
```typescript
interface DataTableProps<T> {
  columns: Column<T>[];         // { key, header, sortable?, render?, className?, headerClassName? }
  data: T[];
  keyExtractor: (item: T) => string;
  onRowClick?: (item: T) => void;
  isLoading?: boolean;
  emptyState?: React.ReactNode;
  sortable?: boolean;
  page?: number;
  pageSize?: number;
  totalCount?: number;
  onPageChange?: (page: number) => void;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  className?: string;
}
```

**Features:**
- Column sorting with sort direction indicators
- Row selection with "select all" checkbox
- Loading skeleton state (5 rows)
- Empty state fallback
- Pagination with Previous/Next buttons and "Showing X–Y of Z" label
- Dark mode support via TailwindCSS classes
- Click-to-expand row handler via `onRowClick`

### StatusBadge

**Purpose:** Standardised status badge with colour coding and optional dot indicator.

**Props:**
```typescript
interface StatusBadgeProps {
  status: BadgeStatus;       // string (draft, pending_approval, published, archived, etc.)
  showDot?: boolean;          // default true
  className?: string;
}
```

**Status Colours:**
| Status | Background | Text | Dot |
|--------|-----------|------|-----|
| draft | gray | gray-700 | gray-400 |
| pending_approval | amber-50 | amber-700 | amber-500 |
| published | emerald-50 | emerald-700 | emerald-500 |
| archived | rose-50 | rose-700 | rose-500 |

**Where used:** Question lists, mock test lists, approval views.

### EmptyState

**Purpose:** Centered placeholder for empty lists with icon, title, description, and optional action button.

**Props:**
```typescript
interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}
```

**Where used:** DataTable when no data, filter results empty.

### SearchBar

**Purpose:** Search input with search icon, clear button, and dark mode support.

**Props:**
```typescript
interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}
```

**Where used:** All list pages with search functionality.

### ConfirmDialog

**Purpose:** Modal confirmation dialog with variant support (danger, warning, default).

**Props:**
```typescript
interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;      // default 'Confirm'
  cancelLabel?: string;       // default 'Cancel'
  variant?: 'danger' | 'warning' | 'default';
  loading?: boolean;
}
```

**Features:**
- Click-outside-to-close (backdrop)
- Escape key to close
- Loading state with "Processing..." text
- Dark mode support
- Animated entry

### LoadingSkeleton

**Purpose:** Loading placeholder components.

**Exports:**
```typescript
export function Skeleton({ className }): JSX.Element;
export function TableSkeleton({ rows, cols }): JSX.Element;
export function StatsCardSkeleton({ count }): JSX.Element;
export function FormSkeleton(): JSX.Element;
```

**Where used:** DataTable loading state, dashboard loading states.

### FilterPanel

**Purpose:** Horizontal filter group with labelled dropdowns.

**Props:**
```typescript
interface FilterPanelProps {
  groups: FilterGroup[];      // { key, label, options[], value, onChange }
  className?: string;
}
```

**Where used:** List pages with filtering needs.

### Select

**Purpose:** Labelled single-select dropdown.

**Props:**
```typescript
interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];    // { value, label }
  placeholder?: string;
  className?: string;
  label?: string;
}
```

**Where used:** Forms, filter panels.

## 7.2 Auth Components

### RoleGuard

**Purpose:** Route protection wrapper — checks role and account status before rendering children.

**Props:**
```typescript
interface RoleGuardProps {
  allowedRoles: string[];
  allowedAccountStatuses?: string[];
  children: React.ReactNode;
}
```

**Where used:** Admin and teacher layout pages.

## 7.3 Analytics Components

| Component | Purpose | Props |
|-----------|---------|-------|
| `MetricCard` | Single metric display with label, value, trend | `label`, `value`, `trend?`, `icon?`, `color?` |
| `BarChart` | Bar chart visualization | `data`, `categories`, `height?` |
| `LineChart` | Line chart visualization | `data`, `xKey`, `yKey`, `height?` |
| `PieChart` | Pie chart visualization | `data`, `valueKey`, `labelKey` |
| `ScoreCard` | Score display with progress | `score`, `maxScore`, `label` |
| `TrendCard` | Trend indicator | `value`, `label`, `direction`, `percentage` |
| `ComparisonCard` | Side-by-side comparison | `left`, `right`, `title` |
| `InsightCard` | AI-driven insight display | `title`, `description`, `type`, `action?` |
| `LeaderboardCard` | Student ranking | `rankings[]`, `limit?` |
| `ProgressRing` | Circular progress | `progress`, `size?`, `strokeWidth?`, `color?` |
| `AnalyticsFilter` | Filter controls for analytics | `dateRange`, `onChange`, `presets?` |

## 7.4 Admin Components

| Component | Purpose |
|-----------|---------|
| `AdminHeader` | Admin dashboard header with navigation, search, notifications |
| `AdminSidebar` | Admin sidebar with links to all admin modules |

## 7.5 Teacher Components

| Component | Purpose |
|-----------|---------|
| `Header` | Teacher dashboard header |
| `Sidebar` | Teacher sidebar with navigation links |

## 7.6 Profile Components

| Component | Purpose |
|-----------|---------|
| `ProfileHeader` | Teacher profile header with avatar, name, role |
| `ProfileSection` | Section wrapper for profile content |
| `ProfileCompletionCard` | Profile completion progress with checklist |
| `ActivityTimeline` | Chronological activity feed |
| `SecurityCard` | Security settings card (password change, 2FA) |
| `NotificationToggle` | Notification preference toggle |

## 7.7 Dev Components

| Component | Purpose |
|-----------|---------|
| `DevHeader` | Dev console header |
| `DevSidebar` | Dev console sidebar navigation |
| `DevModuleCard` | Dev module navigation card |
| `DebugPanel` | Generic debug panel wrapper |
| `ApiResponseCard` | Displays API response (JSON) |
| `JsonViewer` | Formatted JSON viewer |
| `SectionCard` | Section wrapper for dev panels |
| `SessionInfo` | Auth session info display |
| `LoadingIndicator` | Loading spinner/indicator |
| `StatusBadge` | Status badge for dev panels |

---

# 8. Services Layer

## 8.1 Service Architecture Pattern

Every service follows this pattern:

```typescript
export const serviceName = {
  async methodName(params): Promise<ApiResponse<ReturnType>> {
    try {
      // 1. Validate inputs (UUID, required fields, business rules)
      // 2. Build database query
      // 3. Execute query via supabase client
      // 4. Map results (snake_case → camelCase)
      // 5. Return ApiResponse with success/data or error
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  }
};
```

## 8.2 Service Catalog

### Academic Services

#### `batchService.ts`
**Purpose:** Core Batch CRUD (academic module).

| Method | Description | Tables Accessed |
|--------|-------------|-----------------|
| `getBatches(filters?, sort?, pagination?)` | Paginated batch list with filters | `batches` |
| `getBatchById(batchId)` | Single batch by ID | `batches` |
| `createBatch(input)` | Create batch (validates fields, date range) | `batches` |
| `updateBatch(batchId, input)` | Partial update (validates date consistency) | `batches` |
| `deleteBatch(batchId)` | Soft-delete (sets deleted_at) | `batches` |

**Business rules:**
- Soft delete via `deleted_at` column
- `batch_code` auto-uppercased
- Date range validated (start < end)
- `maxSeats` must be positive integer or null

#### `streamService.ts`, `subjectService.ts`, `chapterService.ts`, `topicService.ts`
**Purpose:** CRUD for academic hierarchy entities.

Each service provides: `getList`, `getById`, `create`, `update`, `delete` operations following the same pattern.

**Hierarchy:** Institute → Streams → Subjects → Chapters → Topics

### Admin Management Services

#### `teacherLifecycleService.ts`
**Purpose:** Teacher account lifecycle management.

| Method | Description | Tables |
|--------|-------------|--------|
| `getCounts(instituteId?)` | Dashboard counts by status | `profiles` |
| `getList(filters?, sort?, pagination?)` | Paginated teacher list | `profiles` JOIN `teacher_details` |
| `getDetail(profileId)` | Full teacher detail with counts | `profiles`, `teacher_details`, `batch_teachers`, `questions`, `mock_tests` |
| `approve(profileId)` | pending → approved | `profiles` |
| `reject(profileId)` | pending → rejected | `profiles` |
| `suspend(profileId)` | approved → suspended | `profiles` |
| `activate(profileId)` | suspended/inactive → approved | `profiles` |
| `deactivate(profileId)` | approved → inactive | `profiles` |
| `bulkApprove(profileIds)` | Bulk approve | `profiles` |
| `bulkReject(profileIds)` | Bulk reject | `profiles` |
| `bulkSuspend(profileIds)` | Bulk suspend | `profiles` |
| `bulkActivate(profileIds)` | Bulk activate | `profiles` |
| `getStats(instituteId?)` | Statistics (by dept, by status, newest) | `profiles`, `teacher_details` |

**Business rules:**
- Filtered to `role = 'teacher'` on all queries
- Status transitions are validated (basic — no complex state machine)

**Status Transitions:**
```
pending → approved, rejected
approved → suspended, inactive
suspended → approved
inactive → approved
```

#### `studentLifecycleService.ts`
**Purpose:** Student account lifecycle management.

Same pattern as `teacherLifecycleService.ts` but for `role = 'student'`.

| Method | Description | Tables |
|--------|-------------|--------|
| `getCounts(instituteId?)` | Dashboard counts | `profiles` |
| `getList(filters?, sort?, pagination?)` | Paginated student list | `profiles` JOIN `student_details`, `batch_students` |
| `getDetail(profileId)` | Full student detail | `profiles`, `student_details`, `batch_students`, `mock_attempts` |
| `approve/reject/suspend/activate/deactivate` | Status mutations | `profiles` |
| `bulkApprove/bulkReject/bulkSuspend/bulkActivate` | Bulk operations | `profiles` |
| `getStats(instituteId?)` | Statistics | `profiles`, `student_details` |

#### `questionApprovalService.ts`
**Purpose:** Admin question approval lifecycle.

| Method | Description | Tables |
|--------|-------------|--------|
| `getCounts(instituteId?)` | Question counts by status | `questions` |
| `getList(filters?, sort?, pagination?)` | Paginated approval list | `questions` JOIN `subjects`, `chapters`, `profiles` |
| `getDetail(questionId)` | Full question detail for review | `questions`, `question_options`, `question_images`, `question_explanations`, `question_option_images`, `teacher_details`, `profiles` |
| `approve(questionId, approvedBy?)` | pending_approval → published | `questions` |
| `reject(questionId)` | pending_approval → draft | `questions` |
| `publish(questionId, approvedBy?)` | Alias for approve | `questions` |
| `archive(questionId)` | published → archived | `questions` |
| `bulkApprove/bulkReject/bulkPublish/bulkArchive` | Bulk operations | `questions` |
| `getStats(instituteId?)` | Statistics | `questions`, `subjects` |

**Business rules:**
- Valid transitions: `pending_approval → published(draft)`, `published → archived`, `archived → published`
- `approved_by` and `approved_at` are set on approve, cleared on reject
- Archived/published transitions preserve approval metadata
- Bulk operations guard against invalid pre-transition statuses

#### `batchManagementService.ts`
**Purpose:** Admin batch lifecycle management.

| Method | Description | Tables |
|--------|-------------|--------|
| `getCounts(instituteId?)` | Batch counts by status | `batches` |
| `getList(filters?, sort?, pagination?)` | Paginated batch list | `batches` JOIN `streams`, `batch_teachers`, `batch_students` |
| `getDetail(batchId)` | Full batch detail | `batches`, `batch_teachers`, `batch_students` |
| `createBatch(input)` | Create batch | `batches` |
| `updateBatch(batchId, input)` | Update batch | `batches` |
| `archive(batchId)` | active → archived | `batches` |
| `restore(batchId)` | archived → active | `batches` |
| `activate(batchId)` | → active | `batches` |
| `deactivate(batchId)` | active → completed | `batches` |
| `delete(batchId)` | Soft-delete (checks for dependencies) | `batches` |
| `getStats(instituteId?)` | Statistics | `batches`, `batch_teachers`, `batch_students` |

**Business rules:**
- Status transitions: `upcoming → active`, `active → completed|archived`, `completed → active`, `archived → active`
- Delete only allowed when no active students and no scheduled live classes
- Soft delete via `deleted_at` column

#### `batchStudentAssignmentService.ts`
**Purpose:** Student enrollment in batches.

| Method | Description | Tables |
|--------|-------------|--------|
| `getAssignedStudents(batchId)` | Students in a batch | `batch_students` JOIN `student_details` JOIN `profiles` |
| `getAvailableStudents(batchId, search?)` | Students not in batch | `profiles` JOIN `student_details` (excludes assigned) |
| `assignStudents(batchId, studentIds)` | Bulk assign | `batch_students` |
| `removeStudent(batchId, studentId)` | Remove single | `batch_students` |
| `removeStudents(batchId, studentIds)` | Bulk remove | `batch_students` |
| `getAssignmentStats(batchId)` | Assignment statistics | `batches`, `batch_students` |

#### `batchTeacherAssignmentService.ts`
**Purpose:** Teacher assignment to batches.

| Method | Description | Tables |
|--------|-------------|--------|
| `getAssignedTeacher(batchId)` | Teacher of a batch | `batch_teachers` JOIN `teacher_details` JOIN `profiles` |
| `getAvailableTeachers(batchId, search?)` | Available teachers | `profiles` JOIN `teacher_details` |
| `assignTeacher(batchId, teacherId)` | Assign/replace teacher | `batch_teachers` |
| `removeTeacher(batchId)` | Remove teacher assignment | `batch_teachers` |
| `getAssignmentStats()` | Assignment statistics | `batches`, `batch_teachers` |

**Business rules:**
- A batch can have at most ONE teacher
- Assigning replaces existing assignment

#### `mockTestManagementService.ts`
**Purpose:** Admin mock test lifecycle management.

| Method | Description | Tables |
|--------|-------------|--------|
| `getCounts(instituteId?)` | Counts by status | `mock_tests` |
| `getList(filters?, sort?, pagination?)` | Paginated list | `mock_tests` JOIN `streams`, `subjects`, `teacher_details` |
| `getDetail(testId)` | Full detail with stats | `mock_tests`, `mock_test_questions`, `mock_attempts`, `mock_results` |
| `publish(testId)` | → published | `mock_tests` |
| `unpublish(testId)` | → draft | `mock_tests` |
| `archive(testId)` | → archived | `mock_tests` |
| `restore(testId)` | → published | `mock_tests` |
| `duplicate(testId)` | Create draft copy | `mock_tests` |
| `delete(testId)` | Hard delete | `mock_tests` |
| `getTestQuestions(testId)` | Questions in test | `mock_test_questions` JOIN `questions` |
| `getStats(instituteId?)` | Statistics | `mock_tests`, `mock_attempts` |

#### `mockTestAssignmentService.ts`
**Purpose:** Mock test to batch assignment.

| Method | Description | Tables |
|--------|-------------|--------|
| `getAssignedMockTests(batchId)` | Tests assigned to batch | `batch_mock_tests` JOIN `mock_tests` |
| `getAvailableMockTests(batchId, search?)` | Tests not assigned | `mock_tests` (excludes assigned) |
| `assignMockTests(batchId, testIds, options?)` | Bulk assign | `batch_mock_tests` |
| `removeMockTest(batchId, assignmentId)` | Remove single | `batch_mock_tests` |
| `removeMockTests(batchId, assignmentIds)` | Bulk remove | `batch_mock_tests` |
| `updateAssignment(assignmentId, input)` | Update config | `batch_mock_tests` |
| `getAssignmentStats(batchId)` | Assignment statistics | `batch_mock_tests` |

#### `dashboardService.ts`
**Purpose:** Admin dashboard aggregation.

| Method | Description | Tables |
|--------|-------------|--------|
| `getDashboardData(instituteId?)` | Aggregate widget data | `profiles`, `batches`, `mock_tests`, `questions`, `approval_requests`, `live_classes` |

**Data Sources:**
- Total Students: `profiles WHERE role = 'student'`
- Total Teachers: `profiles WHERE role = 'teacher'`
- Active Batches: `batches WHERE status = 'active'`
- Published Mock Tests: `mock_tests WHERE status = 'published'`
- Pending Approvals: `questions WHERE status = 'pending_approval'`, `approval_requests WHERE status = 'pending'`
- Recent Registrations: `profiles ORDER BY created_at DESC LIMIT 10`
- Upcoming Live Classes: `live_classes WHERE status = 'scheduled'`

### Mock Test Services

#### `questionService.ts`
**Purpose:** Question CRUD and lifecycle.

| Method | Description | Tables |
|--------|-------------|--------|
| `getQuestions(filters?, sort?, pagination?)` | Paginated question list | `questions` |
| `getQuestionById(questionId)` | Single question | `questions` |
| `createQuestion(input)` | Create question | `questions` |
| `updateQuestion(questionId, input)` | Update question | `questions` |
| `deleteQuestion(questionId)` | Hard delete | `questions` |
| `publishQuestion(questionId)` | → published | `questions` |
| `archiveQuestion(questionId)` | → archived | `questions` |
| `restoreQuestion(questionId)` | → draft | `questions` |

#### `questionOptionService.ts`
**Purpose:** Question option management.

| Method | Description |
|--------|-------------|
| `getQuestionOptions(questionId)` | All options for a question |
| `createQuestionOption(input)` | Create single option |
| `updateQuestionOption(optionId, input)` | Update option |
| `deleteQuestionOption(optionId)` | Delete option |
| `replaceQuestionOptions(questionId, instituteId, options, questionType)` | Atomically replace all options |
| `reorderQuestionOptions(items)` | Reorder options |

**Business rules:**
- MCQ: exactly one isCorrect = true
- MSQ: at least one isCorrect = true, max = count - 1
- Min 2 options, max 10

#### `questionImageService.ts`
**Purpose:** Question image management (storage + DB).

| Method | Description |
|--------|-------------|
| `getQuestionImages(questionId)` | All images for a question |
| `uploadQuestionImage(params)` | Upload file + insert DB record |
| `updateQuestionImage(imageId, input)` | Update metadata or replace file |
| `deleteQuestionImage(imageId)` | Delete DB row + storage file |
| `replaceQuestionImages(questionId, instituteId, entries)` | Synchronise image collection |
| `reorderQuestionImages(items)` | Reorder images |

#### `questionExplanationService.ts`
**Purpose:** Question explanation management.

| Method | Description |
|--------|-------------|
| `getQuestionExplanation(questionId)` | Get explanation for a question |
| `createQuestionExplanation(input)` | Create explanation |
| `updateQuestionExplanation(explanationId, input)` | Update explanation |
| `deleteQuestionExplanation(explanationId)` | Delete explanation |
| `upsertQuestionExplanation(questionId, instituteId, input)` | Create or update (recommended) |

#### `mockTestService.ts`
**Purpose:** Mock test CRUD.

| Method | Description |
|--------|-------------|
| `getMockTests(filters?, sort?, pagination?)` | Paginated list |
| `getMockTestById(testId)` | Single test |
| `createMockTest(input)` | Create |
| `updateMockTest(testId, input)` | Update |
| `deleteMockTest(testId)` | Delete |
| `publishMockTest(testId)` | Publish |
| `archiveMockTest(testId)` | Archive |
| `restoreMockTest(testId)` | Restore |

#### `mockTestQuestionService.ts`
**Purpose:** Question assignment to mock tests.

| Method | Description |
|--------|-------------|
| `getMockTestQuestions(testId, sortBy?, sortDir?)` | All questions in a test |
| `getMockTestQuestionById(compoundId)` | Single assignment |
| `addQuestionToMockTest(input)` | Add single question |
| `updateMockTestQuestion(compoundId, input)` | Update assignment |
| `removeQuestionFromMockTest(compoundId)` | Remove question |
| `addQuestionsToMockTest(testId, assignments, maxQuestions?)` | Bulk add |
| `replaceMockTestQuestions(testId, assignments, maxQuestions?)` | Replace all |
| `reorderMockTestQuestions(testId, items)` | Reorder |

#### `mockAttemptService.ts`
**Purpose:** Mock test attempt operations.

| Method | Description |
|--------|-------------|
| `getMockAttempts(filters?, sort?, pagination?)` | Paginated attempt list |
| `getMockAttemptById(attemptId)` | Single attempt |
| `createMockAttempt(input)` | Create attempt |
| `updateMockAttempt(attemptId, input)` | Update attempt |
| `deleteMockAttempt(attemptId)` | Delete draft attempt |
| `getMockAnswers(filters)` | Answers for an attempt |
| `getMockAnswerById(answerId)` | Single answer |
| `updateMockAnswer(answerId, input)` | Update/save answer |
| `deleteMockAnswer(answerId)` | Delete answer |
| `getMockAnswerOptions(filters)` | Selected options for an answer |
| `createMockAnswerOption(input)` | Add selected option |
| `deleteMockAnswerOption(optionId)` | Remove selected option |
| `deleteMockAnswerOptionsByAnswerId(answerId)` | Clear all options for answer |
| `getMockResults(filters?, sort?)` | Result list |
| `getMockResultByAttemptId(attemptId)` | Result for attempt |

#### `mockEvaluationService.ts`
**Purpose:** Attempt evaluation.

| Method | Description |
|--------|-------------|
| `evaluateAttempt(attemptId)` | Evaluate a completed attempt |

#### `mockResultService.ts`
**Purpose:** Mock test result operations.

| Method | Description |
|--------|-------------|
| `getResult(resultId)` | Single result |
| `getResultByAttemptId(attemptId)` | Result for attempt |
| `getStudentResults(studentId, filters?, sort?, pagination?)` | Student's results |
| `getMockTestResults(testId, filters?, sort?, pagination?)` | Test leaderboard |
| `getInstituteResults(instituteId, filters?, sort?, pagination?)` | Institute results |
| `getResults(filters?, sort?, pagination?)` | General results list |
| `releaseResult(resultId)` | Set is_released = true |
| `hideResult(resultId)` | Set is_released = false |
| `deleteResult(resultId)` | Delete result |

#### `mockTestPublishService.ts`
**Purpose:** Publish workflow operations.

| Method | Description |
|--------|-------------|
| `validateMockTestReady(testId)` | Pre-publish validation checklist |
| `publishMockTestWorkflow(testId)` | Full publish workflow |
| `unpublishMockTest(testId)` | Unpublish (published → draft) |

**Validation Checks:**
- At least 1 question assigned
- All questions are published
- Test has a title
- Duration and marks are set
- No duplicate questions
- No circular dependencies

### Other Services

#### `authService.ts`
**Purpose:** Authentication operations.

| Method | Description |
|--------|-------------|
| `signUp(input)` | Register new account (phone + password) |
| `verifyOtp(input)` | Verify SMS OTP |
| `resendOtp(phone)` | Resend OTP |
| `signIn(input)` | Authenticate with phone + password |
| `updatePassword(newPassword)` | Change password |
| `signOut()` | Sign out |
| `getCurrentUser()` | Get authenticated user |
| `getSession()` | Get current session |
| `refreshSession()` | Force-refresh session tokens |

#### `teacherIdentity.ts`
**Purpose:** Resolves teacher identity (profileId vs teacherId).

| Method | Description |
|--------|-------------|
| `resolveTeacherIdentity()` | Resolve IDs from session |
| `getCachedIdentity()` | Get cached identity (sync) |
| `setCachedIdentity(identity)` | Pre-populate cache |
| `clearTeacherIdentityCache()` | Clear cache on logout |

#### `profileService.ts`
**Purpose:** Teacher profile operations.

| Method | Description |
|--------|-------------|
| `getFullTeacherProfile(teacherId, instituteId?)` | Get full teacher profile |
| `updateTeacherProfile(teacherId, input)` | Update profile info |
| `uploadProfileAvatar(teacherId, file)` | Upload avatar |
| `getTeacherActivity(teacherId)` | Get activity timeline |
| `getNotificationPreferences()` | Get notification prefs |
| `saveNotificationPreferences(prefs)` | Save notification prefs |

#### `teacherService.ts`
**Purpose:** Legacy teacher service (teacher dashboard).

| Method | Description |
|--------|-------------|
| `getAssignedBatches(teacherId)` | Get assigned batches |
| `getStudentRoster(batchId)` | Get student roster |
| `getCourseChapters(batchId)` | Get course chapters |
| `resolveStudentDoubt(doubtId, answerText)` | Resolve student doubt |
| `getOrCreateActiveLiveClass(teacherId)` | Get or create live class |
| `startLiveClass(classId)` | Start live class |
| `endLiveClass(classId)` | End live class |
| `getTeacherOverviewData(teacherId)` | Overview dashboard data |
| `getTeacherHrData(teacherId)` | HR portal data |
| `applyForLeave(teacherId, category, startDate, endDate, reason)` | Submit leave request |
| `updateAvailability(teacherId, availabilityId, isAvailable)` | Update availability |
| `getTeacherAvailability(teacherId)` | Get availability slots |

#### `adminService.ts`
**Purpose:** Legacy admin service.

| Method | Description |
|--------|-------------|
| `getAdminOverviewStats()` | Overview statistics |
| `getAllTeachers()` | All teachers list |
| `getLeaveRequests()` | Leave requests |
| `updateLeaveStatus(requestId, newStatus)` | Approve/reject leave |
| `verifyDocument(docId)` | Verify KYC document |
| `allotBatchToTeacher(teacherId, batchId, batchName, teacherProfileId)` | Assign batch + notify |

---

# 9. React Query Architecture

## 9.1 Global Query Client Configuration

Defined in `src/lib/providers.tsx`:

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,       // 30 seconds — data is fresh
      gcTime: 5 * 60 * 1000,      // 5 minutes — unused data kept in cache
      retry: 1,                   // Retry once before surfacing error
      refetchOnWindowFocus: true, // Refetch when user returns
    },
  },
});
```

## 9.2 Query Key Factory Pattern

Every domain module has a dedicated `queryKeys.ts` file that follows a consistent hierarchical pattern:

```
<keys>.<entity>.all        → root for the entity
<keys>.<entity>.lists()     → all list-type queries (broad invalidation)
<keys>.<entity>.list(f,s,p) → specific list query (keyed by params)
<keys>.<entity>.details()   → all detail-type queries
<keys>.<entity>.detail(id)  → single item query
```

### Query Key Factories

| File | Keys Object | Root |
|------|-------------|------|
| `hooks/academic/queryKeys.ts` | `academicKeys` | `['academic']` |
| `hooks/admin/queryKeys.ts` | `adminKeys` | `['admin']` |
| `hooks/analytics/queryKeys.ts` | `analyticsKeys` | `['analytics']` |
| `hooks/analytics/queryKeys-extended.ts` | `teacherAnalyticsKeys` | `['analytics', 'teacher']` |
| `hooks/mockTest/queryKeys.ts` | `questionKeys`, `mockTestKeys` | `['questions']`, `['mockTests']` |
| `hooks/content/queryKeys.ts` | `contentKeys` | `['content']` |
| `hooks/notification/queryKeys.ts` | `notificationKeys` | `['notifications']` |

### Admin Keys Hierarchy

```
['admin']
├── ['admin', 'dashboard']
│   └── ['admin', 'dashboard', 'list', instituteId]
├── ['admin', 'teachers']
│   ├── ['admin', 'teachers', 'list', filters]
│   └── ['admin', 'teachers', 'detail', id]
├── ['admin', 'students']
│   ├── ['admin', 'students', 'list', filters]
│   └── ['admin', 'students', 'detail', id]
├── ['admin', 'approvals']
│   └── ['admin', 'approvals', 'list', filters]
├── ['admin', 'liveClasses']
│   └── ['admin', 'liveClasses', 'list', filters]
├── ['admin', 'questionApproval']
│   ├── ['admin', 'questionApproval', 'list', filters, pagination]
│   ├── ['admin', 'questionApproval', 'detail', questionId]
│   ├── ['admin', 'questionApproval', 'counts', instituteId]
│   └── ['admin', 'questionApproval', 'stats', instituteId]
├── ['admin', 'teacherLifecycle']
│   ├── (same pattern as questionApproval)
│   └── ...
├── ['admin', 'studentLifecycle']
│   ├── (same pattern)
│   └── ...
├── ['admin', 'batchManagement']
│   ├── (same pattern)
│   └── ...
├── ['admin', 'batchStudentAssignment']
│   ├── ['admin', 'batchStudentAssignment', 'assigned', batchId]
│   ├── ['admin', 'batchStudentAssignment', 'available', batchId]
│   └── ['admin', 'batchStudentAssignment', 'stats', batchId]
├── ['admin', 'batchTeacherAssignment']
│   ├── (similar to batchStudentAssignment)
│   └── ...
├── ['admin', 'mockTestAssignment']
│   ├── ['admin', 'mockTestAssignment', 'assigned', batchId]
│   ├── ['admin', 'mockTestAssignment', 'available', batchId]
│   └── ['admin', 'mockTestAssignment', 'stats', batchId]
└── ['admin', 'mockTestManagement']
    ├── ['admin', 'mockTestManagement', 'list', filters, pagination]
    ├── ['admin', 'mockTestManagement', 'detail', testId]
    ├── ['admin', 'mockTestManagement', 'detail', testId, 'questions']
    ├── ['admin', 'mockTestManagement', 'counts', instituteId]
    └── ['admin', 'mockTestManagement', 'stats', instituteId]
```

## 9.3 Hook Catalog

### Academic Hooks

| Hook | Type | Description | Stale Time |
|------|------|-------------|------------|
| `useStreams(filters?, sort?, pagination?)` | Query | Paginated stream list | Default (30s) |
| `useStream(streamId)` | Query | Single stream | Default |
| `useCreateStream()` | Mutation | Create stream | — |
| `useUpdateStream()` | Mutation | Update stream | — |
| `useDeleteStream()` | Mutation | Delete stream | — |
| `useSubjects(filters?, sort?, pagination?)` | Query | Paginated subject list | Default |
| `useSubject(subjectId)` | Query | Single subject | Default |
| `useCreateSubject()` | Mutation | Create subject | — |
| `useUpdateSubject()` | Mutation | Update subject | — |
| `useDeleteSubject()` | Mutation | Delete subject | — |
| `useChapters(filters?, sort?, pagination?)` | Query | Paginated chapter list | Default |
| `useChapter(chapterId)` | Query | Single chapter | Default |
| `useCreateChapter()` | Mutation | Create chapter | — |
| `useUpdateChapter()` | Mutation | Update chapter | — |
| `useDeleteChapter()` | Mutation | Delete chapter | — |
| `useTopics(filters?, sort?, pagination?)` | Query | Paginated topic list | Default |
| `useTopic(topicId)` | Query | Single topic | Default |
| `useCreateTopic()` | Mutation | Create topic | — |
| `useUpdateTopic()` | Mutation | Update topic | — |
| `useDeleteTopic()` | Mutation | Delete topic | — |
| `useBatches(filters?, sort?, pagination?)` | Query | Paginated batch list | Default |
| `useBatch(batchId)` | Query | Single batch | Default |
| `useCreateBatch()` | Mutation | Create batch | — |
| `useUpdateBatch()` | Mutation | Update batch | — |
| `useDeleteBatch()` | Mutation | Soft-delete batch | — |

### Admin Hooks

| Hook | Type | Description | Stale Time |
|------|------|-------------|------------|
| `useAdminDashboardStats(instituteId?)` | Query | Dashboard widget data | 5 min |
| `useTeacherLifecycleCounts(instituteId?)` | Query | Teacher counts by status | 2 min |
| `useTeacherList(filters?, sort?, pagination?)` | Query | Paginated teacher list | 1 min |
| `useTeacherDetail(profileId)` | Query | Single teacher detail | 1 min |
| `useTeacherStats(instituteId?)` | Query | Teacher statistics | 5 min |
| `useApproveTeacher()` | Mutation | Approve teacher (pending→approved) | — |
| `useRejectTeacher()` | Mutation | Reject teacher (pending→rejected) | — |
| `useSuspendTeacher()` | Mutation | Suspend teacher | — |
| `useActivateTeacher()` | Mutation | Activate teacher | — |
| `useDeactivateTeacher()` | Mutation | Deactivate teacher | — |
| `useBulkApproveTeachers()` | Mutation | Bulk approve | — |
| `useBulkRejectTeachers()` | Mutation | Bulk reject | — |
| `useBulkSuspendTeachers()` | Mutation | Bulk suspend | — |
| `useBulkActivateTeachers()` | Mutation | Bulk activate | — |
| `useStudentLifecycleCounts(instituteId?)` | Query | Student counts by status | 2 min |
| `useStudentList(filters?, sort?, pagination?)` | Query | Paginated student list | 1 min |
| `useStudentDetail(profileId)` | Query | Single student detail | 1 min |
| `useStudentStats(instituteId?)` | Query | Student statistics | 5 min |
| `useApproveStudent()` | Mutation | Approve student | — |
| `useRejectStudent()` | Mutation | Reject student | — |
| `useSuspendStudent()` | Mutation | Suspend student | — |
| `useActivateStudent()` | Mutation | Activate student | — |
| `useDeactivateStudent()` | Mutation | Deactivate student | — |
| `useBulkApproveStudents()` | Mutation | Bulk approve | — |
| `useBulkRejectStudents()` | Mutation | Bulk reject | — |
| `useBulkSuspendStudents()` | Mutation | Bulk suspend | — |
| `useBulkActivateStudents()` | Mutation | Bulk activate | — |
| `useQuestionApprovalCounts(instituteId?)` | Query | Question counts by status | 2 min |
| `useQuestionApprovalList(filters?, sort?, pagination?)` | Query | Paginated approval list | 1 min |
| `useQuestionApprovalDetail(questionId)` | Query | Single question detail | 1 min |
| `useQuestionApprovalStats(instituteId?)` | Query | Approval statistics | 5 min |
| `useApproveQuestion()` | Mutation | Approve question | — |
| `useRejectQuestion()` | Mutation | Reject question | — |
| `usePublishQuestion()` | Mutation | Publish question | — |
| `useArchiveQuestion()` | Mutation | Archive question | — |
| `useBulkApproveQuestions()` | Mutation | Bulk approve | — |
| `useBulkRejectQuestions()` | Mutation | Bulk reject | — |
| `useBulkPublishQuestions()` | Mutation | Bulk publish | — |
| `useBulkArchiveQuestions()` | Mutation | Bulk archive | — |
| `useBatchManagementCounts(instituteId?)` | Query | Batch counts by status | 2 min |
| `useBatchList(filters?, sort?, pagination?)` | Query | Paginated batch list | 1 min |
| `useBatchDetail(batchId)` | Query | Single batch detail | 1 min |
| `useBatchStats(instituteId?)` | Query | Batch statistics | 5 min |
| `useCreateBatch()` | Mutation | Create batch | — |
| `useUpdateBatch()` | Mutation | Update batch | — |
| `useArchiveBatch()` | Mutation | Archive batch | — |
| `useRestoreBatch()` | Mutation | Restore batch | — |
| `useActivateBatch()` | Mutation | Activate batch | — |
| `useDeactivateBatch()` | Mutation | Deactivate batch | — |
| `useDeleteBatch()` | Mutation | Delete batch | — |
| `useMockTestManagementCounts(instituteId?)` | Query | Mock test counts | 2 min |
| `useMockTestList(filters?, sort?, pagination?)` | Query | Paginated mock test list | 1 min |
| `useMockTestDetail(testId)` | Query | Single test detail | 1 min |
| `useMockTestQuestions(testId)` | Query | Test questions list | 1 min |
| `useMockTestStats(instituteId?)` | Query | Mock test statistics | 5 min |
| `usePublishMockTest()` | Mutation | Publish test | — |
| `useUnpublishMockTest()` | Mutation | Unpublish test | — |
| `useArchiveMockTest()` | Mutation | Archive test | — |
| `useRestoreMockTest()` | Mutation | Restore test | — |
| `useDuplicateMockTest()` | Mutation | Duplicate test | — |
| `useDeleteMockTest()` | Mutation | Delete test | — |
| `useAssignedStudents(batchId)` | Query | Students in batch | 1 min |
| `useAvailableStudents(batchId, search?)` | Query | Available students | 30s |
| `useBatchAssignmentStats(batchId)` | Query | Assignment stats | 1 min |
| `useAssignStudents()` | Mutation | Assign students | — |
| `useRemoveStudent()` | Mutation | Remove student | — |
| `useRemoveStudents()` | Mutation | Bulk remove | — |
| `useAssignedTeacher(batchId)` | Query | Teacher of batch | 1 min |
| `useAvailableTeachers(batchId, search?)` | Query | Available teachers | 30s |
| `useTeacherAssignmentStats()` | Query | Teacher assignment stats | 2 min |
| `useAssignTeacher()` | Mutation | Assign teacher | — |
| `useRemoveTeacher()` | Mutation | Remove teacher | — |
| `useAssignedMockTests(batchId)` | Query | Tests assigned to batch | 1 min |
| `useAvailableMockTests(batchId, search?)` | Query | Available tests | 30s |
| `useMockTestAssignmentStats(batchId)` | Query | Assignment stats | 1 min |
| `useAssignMockTests()` | Mutation | Assign tests | — |
| `useRemoveMockTest()` | Mutation | Remove test assignment | — |
| `useRemoveMockTests()` | Mutation | Bulk remove | — |
| `useUpdateMockTestAssignment()` | Mutation | Update assignment config | — |

### Analytics Hooks

| Hook | Type | Description | Stale Time |
|------|------|-------------|------------|
| `useStudentAnalytics(studentId)` | Query | Student analytics | 1 min |
| `useTeacherAnalytics(teacherId)` | Query | Teacher analytics | 1 min |
| `useInstituteAnalytics(instituteId)` | Query | Institute analytics | 1 min |
| `useMockTestAnalytics(testId)` | Query | Mock test analytics | 1 min |
| `useDashboardAnalytics()` | Query | Dashboard overview | 30s |
| `useSubjectAnalytics(studentId)` | Query | Subject analytics | 1 min |
| `useChapterAnalytics(studentId)` | Query | Chapter analytics | 1 min |
| `usePerformanceTrend(studentId)` | Query | Performance trend | 1 min |
| `useRecentActivity(studentId, limit?)` | Query | Recent activity | 30s |
| `useTeacherAnalyticsDashboard(instituteId, filters?)` | Query | Teacher dashboard | 30s |
| `useStudentAggregateAnalytics(instituteId, filters?)` | Query | Student aggregate | 1 min |
| `useTeacherMockTestAnalytics(instituteId, filters?)` | Query | Mock test analytics | 1 min |
| `useTeacherSubjectAnalytics(instituteId, filters?)` | Query | Subject analytics | 1 min |
| `useTeacherChapterAnalytics(instituteId, filters?)` | Query | Chapter analytics | 1 min |
| `useTeacherQuestionAnalytics(instituteId, filters?)` | Query | Question analytics | 1 min |
| `useTeacherPerformanceTrends(instituteId, filters?)` | Query | Performance trends | 1 min |
| `useTeacherLeaderboard(instituteId, filters?)` | Query | Leaderboard | 1 min |
| `useTeacherInsights(instituteId, filters?)` | Query | Data insights | 2 min |

### Mock Test Hooks

| Hook | Type | Description |
|------|------|-------------|
| `useQuestions(filters?, sort?, pagination?)` | Query | Paginated question list |
| `useQuestion(questionId)` | Query | Single question |
| `useCreateQuestion()` | Mutation | Create question |
| `useUpdateQuestion()` | Mutation | Update question |
| `useDeleteQuestion()` | Mutation | Delete question |
| `usePublishQuestion()` | Mutation | Publish question |
| `useArchiveQuestion()` | Mutation | Archive question |
| `useRestoreQuestion()` | Mutation | Restore question |
| `useQuestionImages(questionId)` | Query | Question images |
| `useUploadQuestionImage()` | Mutation | Upload image |
| `useUpdateQuestionImage()` | Mutation | Update image |
| `useDeleteQuestionImage()` | Mutation | Delete image |
| `useReplaceQuestionImages()` | Mutation | Replace all images |
| `useReorderQuestionImages()` | Mutation | Reorder images |
| `useQuestionOptions(questionId)` | Query | Question options |
| `useCreateQuestionOption()` | Mutation | Create option |
| `useUpdateQuestionOption()` | Mutation | Update option |
| `useDeleteQuestionOption()` | Mutation | Delete option |
| `useReplaceQuestionOptions()` | Mutation | Replace all options |
| `useReorderQuestionOptions()` | Mutation | Reorder options |
| `useQuestionExplanation(questionId)` | Query | Question explanation |
| `useCreateQuestionExplanation()` | Mutation | Create explanation |
| `useUpdateQuestionExplanation()` | Mutation | Update explanation |
| `useDeleteQuestionExplanation()` | Mutation | Delete explanation |
| `useUpsertQuestionExplanation()` | Mutation | Create or update |
| `useMockTests(filters?, sort?, pagination?)` | Query | Paginated mock tests |
| `useMockTest(testId)` | Query | Single mock test |
| `useCreateMockTest()` | Mutation | Create mock test |
| `useUpdateMockTest()` | Mutation | Update mock test |
| `useDeleteMockTest()` | Mutation | Delete mock test |
| `usePublishMockTest()` | Mutation | Publish test |
| `useArchiveMockTest()` | Mutation | Archive test |
| `useRestoreMockTest()` | Mutation | Restore test |
| `useMockTestQuestions(testId, sortBy?, sortDir?)` | Query | Questions in a test |
| `useMockTestQuestion(testId, questionId)` | Query | Single question assignment |
| `useAddQuestionToMockTest()` | Mutation | Add question to test |
| `useUpdateMockTestQuestion()` | Mutation | Update question assignment |
| `useRemoveQuestionFromMockTest()` | Mutation | Remove question |
| `useAddQuestionsToMockTest()` | Mutation | Bulk add questions |
| `useReplaceMockTestQuestions()` | Mutation | Replace all questions |
| `useReorderMockTestQuestions()` | Mutation | Reorder questions |
| `useValidateMockTestReady(testId)` | Query | Pre-publish validation |
| `usePublishMockTestWorkflow()` | Mutation | Publish workflow |
| `useUnpublishMockTest()` | Mutation | Unpublish |
| `useMockAttempts(filters?, sort?, pagination?)` | Query | Attempt list |
| `useMockAttempt(attemptId)` | Query | Single attempt |
| `useCreateMockAttempt()` | Mutation | Create attempt |
| `useUpdateMockAttempt()` | Mutation | Update attempt |
| `useEvaluateAttempt()` | Mutation | Evaluate attempt |
| `useDeleteMockAttempt()` | Mutation | Delete attempt |
| `useMockAnswers(attemptId)` | Query | Answers for attempt |
| `useMockAnswer(answerId)` | Query | Single answer |
| `useUpdateMockAnswer()` | Mutation | Update answer |
| `useDeleteMockAnswer()` | Mutation | Delete answer |
| `useMockAnswerOptions(answerId)` | Query | Answer options |
| `useCreateMockAnswerOption()` | Mutation | Add answer option |
| `useDeleteMockAnswerOption()` | Mutation | Remove answer option |
| `useMockResults(filters?, sort?)` | Query | Result list |
| `useMockResultByAttempt(attemptId)` | Query | Result for attempt |
| `useMockResult(resultId)` | Query | Single result |
| `useStudentResults(studentId, filters?, sort?, pagination?)` | Query | Student results |
| `useMockTestResults(testId, filters?, sort?, pagination?)` | Query | Test results |
| `useInstituteResults(instituteId, filters?, sort?, pagination?)` | Query | Institute results |
| `useResults(filters?, sort?, pagination?, enabled?)` | Query | General results |
| `useReleaseResult()` | Mutation | Release result |
| `useHideResult()` | Mutation | Hide result |
| `useDeleteResult()` | Mutation | Delete result |

## 9.4 Cache Invalidation Strategy

All mutations follow a consistent invalidation pattern:

```typescript
onSuccess: async () => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: entityKeys.all() }),     // Invalidate entity
    queryClient.invalidateQueries({ queryKey: adminKeys.dashboard.all() }), // Invalidate dashboard
  ]);
}
```

**Invalidation rules:**
- **Create/Update/Delete**: Invalidates all list queries for the entity + dashboard counts
- **Status mutations**: Invalidates entity lists + details + dashboard
- **Assignment mutations**: Invalidates assignment queries + batch management + dashboard
- **Bulk operations**: Same as single operations
- **Detail mutations**: Invalidates specific detail + all lists

---

# 10. Admin Dashboard

## 10.1 Overview

The Admin Dashboard is built with Next.js App Router at `/admin/*`. It provides:
- User lifecycle management (teachers & students)
- Batch lifecycle management
- Mock test lifecycle management
- Question approval workflow
- Aggregate dashboard statistics

## 10.2 Pages & Modules

### Admin Layout (`/admin/layout.tsx`)
- Wraps all admin pages with `AdminHeader` and `AdminSidebar`
- Uses `RoleGuard` with `allowedRoles={['admin']}`

### Admin Overview (`/admin/page.tsx`)
- Aggregates dashboard widget data via `useAdminDashboardStats()`
- Displays: total students, teachers, active batches, published tests, pending approvals

### Teacher Management (`/admin/teachers/`)
- **List** (`page.tsx`): Paginated list of teacher profiles with filters and status badges
  - Hooks: `useTeacherList()`, `useTeacherLifecycleCounts()`, `useTeacherStats()`
  - Services: `teacherLifecycleService`
  - Features: Search, status filter, bulk approve/reject/suspend/activate
- **Detail** (`[id]/page.tsx`): Full teacher profile with batch count, question count, mock test count, last activity

### Student Management (`/admin/students/`)
- **List** (`page.tsx`): Paginated list of student profiles
  - Hooks: `useStudentList()`, `useStudentLifecycleCounts()`, `useStudentStats()`
  - Services: `studentLifecycleService`
  - Features: Search, status filter, batch filter, bulk operations
- **Detail** (`[id]/page.tsx`): Full student profile with batch info, attempt count, last activity

### Batch Management (`/admin/batches/`)
- **List** (`page.tsx`): Paginated batch list with capacity, teacher, student count
  - Hooks: `useBatchList()`, `useBatchManagementCounts()`, `useBatchStats()`
  - Services: `batchManagementService`
  - Features: Search, status filter, stream filter, teacher filter, pagination
- **Detail** (`[id]/page.tsx`): Full batch detail with teacher info, student list, capacity stats

### Question Approval (`/admin/questions/`)
- **List** (`page.tsx`): Paginated question list for approval review
  - Hooks: `useQuestionApprovalList()`, `useQuestionApprovalCounts()`, `useQuestionApprovalStats()`
  - Services: `questionApprovalService`
  - Features: Search, status/subject/chapter/teacher filters, bulk approve/reject/publish/archive
- **Detail** (`[id]/page.tsx`): Full question detail with options, images, explanation, teacher info, approval metadata

### Mock Test Management (`/admin/mock-tests/`)
- **List** (`page.tsx`): Paginated mock test list
  - Hooks: `useMockTestList()`, `useMockTestManagementCounts()`, `useMockTestStats()`
  - Services: `mockTestManagementService`
  - Features: Search, status/stream/subject/type filters, bulk publish/archive
- **Detail** (`[id]/page.tsx`): Full test detail with question count, attempt count, average score, unique students

## 10.3 Navigation

Admin sidebar includes links to:
- Dashboard (overview)
- Teachers (`/admin/teachers`)
- Students (`/admin/students`)
- Batches (`/admin/batches`)
- Questions (`/admin/questions`)
- Mock Tests (`/admin/mock-tests`)

## 10.4 Workflow: Teacher Approval

```
1. Teacher registers → status = "pending"
2. Admin views list at /admin/teachers
3. Admin reviews teacher detail at /admin/teachers/[id]
4. Admin clicks "Approve" → status = "approved" → teacher can access /teacher
   OR
   Admin clicks "Reject" → status = "rejected" → teacher sees /account-rejected
```

## 10.5 Workflow: Question Approval

```
1. Teacher creates question → status = "pending_approval"
2. Admin views pending questions at /admin/questions
3. Admin reviews full question detail at /admin/questions/[id]
4. Admin clicks "Approve" → status = "published", approved_at set
   OR
   Admin clicks "Reject" → status = "draft", approval metadata cleared
5. Published questions can be Archived later (published → archived)
6. Archived questions can be Restored (archived → published)
```

## 10.6 Implementation Status

| Page | Page Content | Hooks Implemented | Services Implemented |
|------|-------------|-------------------|---------------------|
| `/admin` | ✅ | ✅ | ✅ |
| `/admin/teachers` | ⬜ | ✅ | ✅ |
| `/admin/teachers/[id]` | ⬜ | ✅ | ✅ |
| `/admin/students` | ⬜ | ✅ | ✅ |
| `/admin/students/[id]` | ⬜ | ✅ | ✅ |
| `/admin/batches` | ⬜ | ✅ | ✅ |
| `/admin/batches/[id]` | ⬜ | ✅ | ✅ |
| `/admin/questions` | ⬜ | ✅ | ✅ |
| `/admin/questions/[id]` | ⬜ | ✅ | ✅ |
| `/admin/mock-tests` | ⬜ | ✅ | ✅ |
| `/admin/mock-tests/[id]` | ⬜ | ✅ | ✅ |

> **Note:** All hooks and services for admin modules are fully implemented. The page UI components are under development.

---

# 11. Teacher Dashboard

## 11.1 Overview

The Teacher Dashboard is built with Next.js App Router at `/teacher/*`. It provides:
- Question creation, editing, and management
- Mock test creation and publishing
- Student roster viewing and analytics
- Performance analytics and trends
- Profile and settings management
- Notification creation and sending

## 11.2 Pages & Modules

### Teacher Layout (`/teacher/layout.tsx`)
- Wraps all teacher pages with `Header` and `Sidebar`
- Uses `RoleGuard` with `allowedRoles={['teacher', 'admin']}` and `allowedAccountStatuses={['approved']}`

### Teacher Dashboard (`/teacher/page.tsx`)
- Overview of teaching activity: batches, students, upcoming classes, recent results
- Uses `useAuth()` for teacher identity
- Legacy component: `FacultyDashboard`

### Questions (`/teacher/questions/`)
- **Create** (`create/page.tsx`): Rich question creation form
- **List** (`list/page.tsx`): Question bank list with filters
- **Edit** (`[id]/edit/page.tsx`): Full question editor
- **Preview** (`[id]/preview/page.tsx`): Question preview
- **Import** (`import/page.tsx`): Bulk question import via OCR

### Mock Tests (`/teacher/mock-tests/`)
- **Create** (`create/page.tsx`): Mock test creation
- **List** (`list/page.tsx`): Mock test list with filters
- **Edit** (`[id]/edit/page.tsx`): Edit test configuration
- **Preview** (`[id]/preview/page.tsx`): Test preview
- **Publish** (`[id]/publish/page.tsx`): Publish workflow with validation
- **Questions** (`[id]/questions/page.tsx`): Manage questions in test

### Students (`/teacher/students/`)
- **List** (`list/page.tsx`): Student roster
- **Detail** (`[id]/page.tsx`): Student profile
- **Activity** (`[id]/activity/page.tsx`): Student activity feed
- **Analytics** (`[id]/analytics/page.tsx`): Student performance
- **Results** (`[id]/results/page.tsx`): Student results

### Results (`/teacher/results/`)
- **List** (`list/page.tsx`): Results list
- **Detail** (`[id]/page.tsx`): Result summary
- **Questions** (`[id]/questions/page.tsx`): Per-question breakdown

### Analytics (`/teacher/analytics/`)
- **Dashboard** (`page.tsx`): Overview analytics
- **Chapters** (`chapters/page.tsx`): Chapter-level performance
- **Insights** (`insights/page.tsx`): Data-driven insights
- **Leaderboards** (`leaderboards/page.tsx`): Student rankings
- **Mock Tests** (`mock-tests/page.tsx`): Test-specific analytics
- **Questions** (`questions/page.tsx`): Question difficulty analytics
- **Students** (`students/page.tsx`): Student-level analytics
- **Subjects** (`subjects/page.tsx`): Subject-level analytics
- **Trends** (`trends/page.tsx`): Performance trends

### Profile (`/teacher/profile/`)
- **Home** (`page.tsx`): Profile summary with completion checklist
- **Edit** (`edit/page.tsx`): Edit profile info
- **Activity** (`activity/page.tsx`): Activity timeline
- **Preferences** (`preferences/page.tsx`): Notification preferences
- **Security** (`security/page.tsx`): Password change, session management

### Notifications (`/teacher/notifications/`)
- **Create** (`create/page.tsx`): Create notification
- **List** (`list/page.tsx`): Notification list
- **History** (`history/page.tsx`): Sent notification history
- **Scheduled** (`scheduled/page.tsx`): Scheduled notifications
- **Detail** (`[id]/page.tsx`): Notification detail

### Settings (`/teacher/settings/`)
- **Home** (`page.tsx`): Application settings

## 11.3 Navigation

Teacher sidebar includes links to:
- Dashboard
- Questions (create, list)
- Mock Tests (create, list)
- Students (list)
- Results (list)
- Analytics (overview, chapters, insights, leaderboards, mock-tests, questions, students, subjects, trends)
- Profile (edit, activity, preferences, security)
- Settings
- Notifications (create, list, history, scheduled)

## 11.4 Workflow: Question Creation

```
1. Teacher navigates to /teacher/questions/create
2. Fills in: question text, question type (MCQ/MSQ/Numerical), difficulty, subject, chapter, marks
3. Adds options (text + isCorrect flag)
4. Optionally adds images (stem, options, explanation)
5. Optionally adds explanation text
6. Saves → status = "draft"
7. Optionally submits for approval → status = "pending_approval"
8. Admin approves → status = "published"
9. Question is available for mock tests
```

## 11.5 Workflow: Mock Test Publishing

```
1. Teacher creates mock test at /teacher/mock-tests/create
2. Adds questions at /teacher/mock-tests/[id]/questions
3. Reviews at /teacher/mock-tests/[id]/preview
4. Validates readiness at /teacher/mock-tests/[id]/publish
   - Validation checks: at least 1 question, all questions published, title set, etc.
5. Publishes → status = "published"
6. Test is available for assignment to batches (admin function)
```

---

# 12. Student Dashboard

## 12.1 Status: 🔴 NOT IMPLEMENTED

There are **no student pages, components, hooks, or services** in the current codebase. The student role is defined in the type system (`UserRole = 'student' | 'teacher' | 'admin'`) and in the database schema, but no frontend has been built.

The `getPostLoginDestination()` function redirects students to `/` (root), which shows `FacultyDashboard` — but the FacultyDashboard is designed for teachers/logins, not student-specific content.

**What would need to be built:**
- `/student` layout and pages
- Student-specific components
- Student attempt flow (taking mock tests)
- Student results viewing
- Student profile

---

# 13. Question Management

## 13.1 Complete Lifecycle

```
                    ┌──────────────┐
                    │    Draft     │  ← Teacher creates/edit
                    └──────┬───────┘
                           │ Submit for approval
                           ▼
                    ┌──────────────┐
                    │  Pending     │  ← Awaiting admin review
                    │  Approval    │
                    └──────┬───────┘
                    ┌──────┴──────┐
                    ▼             ▼
             ┌──────────┐  ┌──────────┐
             │ Published │  │  Draft   │  ← Rejected by admin
             │ (Active)  │  │ (Revise) │
             └─────┬─────┘  └──────────┘
                   │ Archive          │ Re-submit
                   ▼                  ▼
             ┌──────────┐      ┌──────────────┐
             │ Archived  │      │  Pending     │
             └─────┬─────┘      │  Approval    │
                   │ Restore    └──────────────┘
                   ▼
             ┌──────────┐
             │ Published │
             └──────────┘
```

## 13.2 Business Rules

- **MCQ**: Must have exactly 1 correct option. Min 2 options, max 10.
- **MSQ**: Must have at least 1 correct option. Max correct = total - 1. Min 2 options, max 10.
- **Numerical**: Must have a correct numerical answer with tolerance.
- **Explanation**: 1:1 relationship with questions. Upsert pattern for editor.
- **Images**: Can be attached to stem (question), options, explanation. Stored in Supabase Storage.
- **Delete**: Hard delete from DB. Use archive for safe retirement.

## 13.3 Question Status Transitions

```
draft → pending_approval       (submit for approval)
pending_approval → published   (admin approves)
pending_approval → draft       (admin rejects — clears approval metadata)
published → archived           (admin archives — preserves approval metadata)
archived → published           (admin restores — preserves approval metadata)
```

## 13.4 Tables Accessed

| Table | Purpose |
|-------|---------|
| `questions` | Core question data |
| `question_options` | MCQ/MSQ options |
| `question_option_images` | Images attached to options |
| `question_images` | Images attached to stem/explanation |
| `question_explanations` | Detailed explanation text/video |
| `question_image_storage` | Storage metadata for images |
| `profiles` | Teacher/approver names |
| `teacher_details` | Teacher info |
| `subjects` | Subject names |
| `chapters` | Chapter names |

---

# 14. Mock Test Management

## 14.1 Complete Lifecycle

```
                    ┌──────────────┐
                    │    Draft     │  ← Teacher creates
                    └──────┬───────┘
                           │ Add questions
                           ▼
                    ┌──────────────┐
                    │  Has         │  ← Questions assigned
                    │  Questions   │
                    └──────┬───────┘
                           │ Publish (validate + publish)
                           ▼
                    ┌──────────────┐
                    │  Published   │  ← Available for batch assignment
                    └──────┬───────┘
                    ┌──────┴──────┐
                    ▼             ▼
             ┌──────────┐  ┌──────────┐
             │ Archived  │  │  Draft   │  ← Unpublish
             └─────┬─────┘  │ (Revise) │
                   │Restore └──────────┘
                   ▼
             ┌──────────┐
             │ Published │
             └──────────┘
```

## 14.2 Business Rules

- **Publishing**: Validates readiness (at least 1 question, all questions published, title set, duration set)
- **Unpublishing**: Only allowed when NO student attempts exist
- **Archiving**: Preserves `published_at` for audit trail
- **Duplicating**: Creates draft copy with "(Copy)" suffix. Does NOT copy questions.
- **Deleting**: Hard delete. Prevented by FK constraints if attempts/results exist.

## 14.3 Tables Accessed

| Table | Purpose |
|-------|---------|
| `mock_tests` | Core test data |
| `mock_test_questions` | Question assignments |
| `mock_attempts` | Student attempts |
| `mock_results` | Evaluation results |
| `mock_answers` | Per-question answers |
| `mock_answer_options` | Selected options for MSQ |
| `batch_mock_tests` | Batch assignments |
| `streams` | Stream names |
| `subjects` | Subject names |
| `teacher_details` | Teacher info |

---

# 15. Batch Management

## 15.1 Complete Lifecycle

```
                    ┌──────────────┐
                    │   Upcoming   │  ← Created by admin
                    └──────┬───────┘
                           ▼
                    ┌──────────────┐
                    │    Active    │  ← Students enrolled, classes running
                    └──────┬───────┘
                    ┌──────┴──────┐
                    ▼             ▼
             ┌──────────┐  ┌──────────┐
             │ Completed│  │ Archived │
             └─────┬─────┘  └─────┬────┘
                   │ Restore      │ Restore
                   ▼              ▼
             ┌──────────┐  ┌──────────┐
             │  Active  │  │  Active  │
             └──────────┘  └──────────┘
```

## 15.2 Business Rules

- **Delete**: Only allowed when NO active students AND NO scheduled live classes
- **Teacher assignment**: Max 1 teacher per batch. Assigning replaces existing.
- **Capacity**: `maxSeats` must be positive integer or null (unlimited)
- **Soft delete**: `deleted_at` column — list queries exclude by default
- **Batch code**: Auto-uppercased, unique within institute

## 15.3 Tables Accessed

| Table | Purpose |
|-------|---------|
| `batches` | Core batch data |
| `batch_teachers` | Teacher assignments |
| `batch_students` | Student enrollments |
| `batch_mock_tests` | Mock test assignments |
| `streams` | Stream hierarchy |
| `profiles` | User names |
| `teacher_details` | Teacher info |
| `student_details` | Student info |

## 15.4 Workflow: Batch Creation → Student Assignment

```
1. Admin creates batch → /admin/batches
   - Set name, code, stream, academic year, dates, capacity
2. Admin assigns teacher → uses available teachers list
3. Admin assigns students → uses available students list (searchable)
4. Batch becomes active → students can take assigned mock tests
```

---

# 16. Detail Pages

## 16.1 Admin Teacher Detail (`/admin/teachers/[id]`)

**Sections:**
- Profile header (name, email, phone, avatar)
- Account status badge
- Statistics cards (batches, questions, mock tests, last activity)
- Department and designation info

**Hooks used:** `useTeacherDetail(profileId)`

**Service:** `teacherLifecycleService.getDetail(profileId)`

**Data returned:**
```typescript
interface TeacherDetail {
  profileId, teacherId, name, email, phone, department, designation,
  instituteId, instituteName, accountStatus, createdAt, avatarUrl,
  isActive, updatedAt, batchCount, questionCount, mockTestCount, lastActivityAt
}
```

## 16.2 Admin Student Detail (`/admin/students/[id]`)

**Hooks used:** `useStudentDetail(profileId)`

**Service:** `studentLifecycleService.getDetail(profileId)`

**Data returned:**
```typescript
interface StudentDetail {
  profileId, studentId, name, email, phone, avatarUrl, instituteId,
  instituteName, accountStatus, isActive, enrollmentNo, targetYear,
  batchInfo, createdAt, updatedAt, dob, enrolledOn, batchCount,
  mockAttemptCount, lastActivityAt
}
```

## 16.3 Admin Batch Detail (`/admin/batches/[id]`)

**Hooks used:** `useBatchDetail(batchId)`, `useAssignedStudents(batchId)`, `useAssignedTeacher(batchId)`

**Service:** `batchManagementService.getDetail(batchId)`

**Data returned:**
- Batch info (name, code, status, dates)
- Teacher info (name, email, phone, assigned date)
- Student list (name, email, enrollment date)
- Capacity stats (student count, available seats, utilization %)
- Mock test count

## 16.4 Admin Mock Test Detail (`/admin/mock-tests/[id]`)

**Hooks used:** `useMockTestDetail(testId)`, `useMockTestQuestions(testId)`

**Service:** `mockTestManagementService.getDetail(testId)`

**Data returned:**
- Test info (title, description, type, duration, marks)
- Status, stream, subject, teacher
- Attempt count, average score, unique student count
- Question list with order, marks, subject, chapter

## 16.5 Admin Question Detail (`/admin/questions/[id]`)

**Hooks used:** `useQuestionApprovalDetail(questionId)`

**Service:** `questionApprovalService.getDetail(questionId)`

**Data returned:**
- Question text, type, difficulty, marks, negative marks
- Subject, chapter
- Options with isCorrect flag and images
- Stem images
- Explanation (text + video URL)
- Teacher info
- Approval metadata (approvedBy, approvedAt)

---

# 17. Database Interaction

## 17.1 Module-to-Table Mapping

| Module | Primary Tables | Relationship Type |
|--------|---------------|-------------------|
| Auth | `profiles`, `auth.users` | Auth → Profile (1:1 via profile_id) |
| Academic - Streams | `streams` | Insitute → Streams (1:N) |
| Academic - Subjects | `subjects` | Stream → Subjects (1:N) |
| Academic - Chapters | `chapters` | Subject → Chapters (1:N) |
| Academic - Topics | `topics` | Chapter → Topics (1:N) |
| Academic - Batches | `batches` | Stream → Batches (1:N) |
| Question Bank | `questions`, `question_options`, `question_images`, `question_explanations`, `question_option_images` | Question → Options (1:N), Question → Images (1:N), Question → Explanation (1:1) |
| Mock Tests | `mock_tests`, `mock_test_questions` | Test → Questions (N:M via junction) |
| Mock Attempts | `mock_attempts`, `mock_answers`, `mock_answer_options` | Test → Attempts (1:N), Attempt → Answers (1:N), Answer → Options (N:M) |
| Mock Results | `mock_results` | Attempt → Result (1:1) |
| Teacher Management | `profiles`, `teacher_details`, `batch_teachers` | Profile → Teacher Details (1:1), Teacher → Batches (N:M) |
| Student Management | `profiles`, `student_details`, `batch_students` | Profile → Student Details (1:1), Student → Batches (N:M) |
| Batch Assignment | `batch_teachers`, `batch_students`, `batch_mock_tests` | Junction tables for N:M relationships |
| Live Classes | `live_classes`, `live_class_batch`, `live_sessions`, `session_participants` | Classes → Batches (N:M) |
| Teacher HR | `teacher_employment_records`, `teacher_bank_details`, `teacher_qualifications`, `teacher_experiences`, `teacher_documents`, `teacher_leave_requests`, `teacher_specializations` | Teacher → HR Data (1:N) |
| Notifications | `notifications`, `notification_recipients` | Notification → Recipients (1:N) |
| Content | `content`, `tags`, `approval_requests` | Content → Tags (N:M) |
| Analytics | `teacher_analytics`, `student_performances`, `chapter_performances` | Aggregated analytics data |

## 17.2 Key Foreign Key Relationships

```
auth.users.id → profiles.profile_id (1:1 via DB trigger on_auth_user_created)
profiles.institute_id → institutes.institute_id (N:1)
profiles.profile_id → teacher_details.profile_id (1:1)
profiles.profile_id → student_details.profile_id (1:1)
teacher_details.teacher_id → questions.created_by (1:N)
teacher_details.teacher_id → mock_tests.teacher_id (1:N)
teacher_details.teacher_id → batch_teachers.teacher_id (1:N)
student_details.student_id → batch_students.student_id (1:N)
batches.batch_id → batch_teachers.batch_id (1:N)
batches.batch_id → batch_students.batch_id (1:N)
batches.batch_id → batch_mock_tests.batch_id (1:N)
mock_tests.test_id → mock_test_questions.test_id (1:N)
mock_tests.test_id → mock_attempts.test_id (1:N)
questions.question_id → question_options.question_id (1:N)
questions.question_id → question_images.question_id (1:N)
questions.question_id → question_explanations.question_id (1:1)
mock_attempts.attempt_id → mock_results.attempt_id (1:1)
mock_attempts.attempt_id → mock_answers.attempt_id (1:N)
streams.stream_id → batches.stream_id (1:N)
streams.stream_id → subjects.stream_id (1:N)
subjects.subject_id → chapters.subject_id (1:N)
chapters.chapter_id → topics.chapter_id (1:N)
```

---

# 18. Error Handling

## 18.1 Service Layer Error Handling

Every service method wraps logic in `try/catch` and returns `ApiResponse<T>`:

```typescript
try {
  // Business logic
  return { success: true, data: result };
} catch (err) {
  return { success: false, error: extractErrorMessage(err) };
}
```

The `extractErrorMessage()` utility (`src/utils/supabase.ts`) normalises:
- `AuthError` → `.message`
- `PostgrestError` → `.message`
- `Error` → `.message`
- Unknown/object errors → JSON.stringify or custom fallback

## 18.2 Hook Layer Error Handling

React Query hooks convert service errors into thrown errors:

```typescript
queryFn: async () => {
  const result = await serviceMethod();
  if (!result.success) {
    throw new Error(result.error ?? 'Failed to fetch data.');
  }
  return result.data!;
}
```

React Query's `error` property is then available to components:
```typescript
const { data, isLoading, error } = useQuery(...);
if (error) return <ErrorMessage message={error.message} />;
```

## 18.3 UI Error States

- **Loading state**: `DataTable` shows skeleton rows (5 rows simulated). `LoadingSkeleton` components for stats cards, forms, tables.
- **Empty state**: `EmptyState` component with icon, title, description, optional action button.
- **Error state**: Notifications/toast system (planned, not fully implemented).
- **Retry logic**: React Query default: 1 retry before surfacing error.

## 18.4 Specific Error Codes Handled

| Error Code | Meaning | Handling |
|-----------|---------|----------|
| `PGRST116` | 0 rows returned | "Not found" error message (distinct from connection errors) |
| `23503` | Foreign key violation | "Cannot delete because dependencies exist" |
| `23505` | Unique constraint violation | "Already exists" with context-specific message |
| `42P01` | Table doesn't exist | Caught gracefully, logged to console |

---

# 19. Security

## 19.1 RLS (Row-Level Security)

RLS policies are defined in SQL migrations (`supabase/migrations/021_rls_policies.sql`). They control row-level access for:

- **Profiles**: Users can read their own profile; admins can read all
- **Questions**: Teachers can CRUD their own questions; admins can approve all
- **Mock Tests**: Teachers can manage their own; admins can manage all
- **Batches**: Access based on institute membership
- **Storage**: Images accessible via authenticated bucket policies

## 19.2 Frontend Permission Checks

- **Route-level**: `RoleGuard` component checks `allowedRoles` and optionally `allowedAccountStatuses`
- **Component-level**: Components check `teacherProfile.role` for conditional rendering (e.g., admin-specific buttons)
- **No fine-grained permissions**: No "can_edit_questions" type permissions exist

## 19.3 Input Validation

- **UUID validation**: `validateUUID()` in `src/utils/supabase.ts` — validates format before DB queries
- **Phone validation**: `validateSignUpInput()` — validates E.164 format (+919876543210)
- **Password validation**: Minimum 6 characters
- **Date validation**: `validateDateRange()` — startDate must be ≤ endDate
- **Status transitions**: Validated in service methods before updating

## 19.4 Safe Mutations

- **Soft delete**: `batches` table uses `deleted_at` timestamp instead of hard delete
- **Hard delete guards**: Foreign key violations prevent deletion of referenced rows
- **Bulk operation guards**: Status-specific filters prevent accidental overwrites (e.g., only update `pending_approval` questions when rejecting)

## 19.5 Role Constraint on Mutations

Teacher lifecycle/student lifecycle services filter by `role = 'teacher'` / `role = 'student'` on all mutations, ensuring admin cannot accidentally modify a non-target profile.

---

# 20. Testing Status

## 20.1 Module-by-Module Report

| Module | Code Implemented | Tests | Known Issues | Production Readiness |
|--------|-----------------|-------|-------------|---------------------|
| **Authentication** | ✅ 90% | ⬜ No tests | Demo mode fallback can be confusing | 🟡 Usable with Supabase but needs polish |
| **Admin Dashboard** | 🟡 40% | ⬜ No tests | Page UI components not wired to hooks | 🔴 Not production-ready |
| **Teacher Dashboard** | 🟡 60% | ⬜ No tests | Some pages have minimal content | 🟡 Core flows work |
| **Question Bank** | 🟡 70% | ⬜ No tests | Image upload race conditions possible | 🟡 Functional for basic use |
| **Mock Test Engine** | 🟡 50% | ⬜ No tests | Evaluation logic needs verification | 🔴 Not production-ready |
| **Batch Management** | 🟡 60% | ⬜ No tests | Batch-sync with live classes incomplete | 🟡 Core CRUD works |
| **Academic Structure** | 🟡 50% | ⬜ No tests | Hierarchy navigation in UI not built | 🟡 Services are ready |
| **Analytics** | 🟡 40% | ⬜ No tests | Data aggregation not verified | 🔴 Not production-ready |
| **Notifications** | 🟡 30% | ⬜ No tests | Push notification not implemented | 🔴 Early stage |
| **Content Management** | 🟡 30% | ⬜ No tests | Most of UI not built | 🔴 Early stage |
| **Profile/Settings** | 🟡 40% | ⬜ No tests | Avatar upload needs refinement | 🟡 Basic profile works |
| **HR Portal** | 🟡 30% | ⬜ No tests | Legacy service, needs modernisation | 🔴 Early stage |
| **Storage Integration** | 🟡 40% | ⬜ No tests | Error handling for large files | 🟡 Basic upload works |
| **Student Dashboard** | 🔴 0% | ⬜ No tests | Not started | 🔴 Not started |

## 20.2 Key Gaps

1. **No unit tests** exist anywhere in the project (0 test files found)
2. **No integration tests** for Supabase queries
3. **No E2E tests** for user workflows
4. Several admin pages have hooks + services but no UI components wired to them
5. The student-facing flow is completely unimplemented
6. Payment/commerce integration not started
7. Real-time features (live classes, attendance) partially implemented

---

# 21. Development Guidelines

## 21.1 Architecture Conventions

1. **Service Layer Pattern**: All business logic must live in services. Hooks only handle caching. Components only handle rendering.
2. **Standardised Responses**: Every service method returns `ApiResponse<T>`.
3. **Query Key Factory**: Every domain module must have a `queryKeys.ts` file.
4. **Consistent Invalidation**: Mutations invalidate both entity caches AND dashboard caches.
5. **Error Normalisation**: Use `extractErrorMessage()` for all error handling.

## 21.2 Naming Conventions

| Concept | Convention | Example |
|---------|-----------|---------|
| Service files | camelCase with domain prefix | `teacherLifecycleService.ts` |
| Hook files | `use[Entity]` prefix | `useTeacherLifecycle.ts` |
| Query key files | `queryKeys.ts` per domain | `hooks/admin/queryKeys.ts` |
| Types | PascalCase | `TeacherProfile`, `ApiResponse` |
| DB column mapping | snake_case → camelCase | `question_id` → `questionId` |
| API responses | Standard `ApiResponse<T>` | `{ success, data, error, warning }` |
| Mutations | `use[Action][Entity]` | `useApproveTeacher()` |
| Queries | `use[Entity]` or `use[Entity][Detail]` | `useTeacherList()`, `useTeacherDetail()` |

## 21.3 File Organization Conventions

- **Hooks**: One file per entity/domain, co-located with `queryKeys.ts`
- **Services**: One file per major feature, in domain-specific subdirectory
- **Components**: Feature-specific in `components/<domain>/`, shared UI in `components/ui/`
- **Pages**: Match the role structure: `app/<role>/<module>/[action]/page.tsx`
- **Types**: Domain-specific types in `types/<domain>.ts`
- **Utils**: Shared utilities in `utils/<domain>.ts`

## 21.4 Hook Conventions

```typescript
// Query pattern
export function useEntity(filters?, sort?, pagination?) {
  return useQuery<ReturnType>({
    queryKey: entityKeys.entity.list(filters, sort, pagination),
    queryFn: async () => {
      const result = await service.method(params);
      if (!result.success) throw new Error(result.error);
      return result.data!;
    },
    staleTime: 1 * 60 * 1000,  // Optional: override default
    enabled: !!requiredParam,   // For dependent queries
  });
}

// Mutation pattern
export function useEntityMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input) => {
      const result = await service.method(input);
      if (!result.success) throw new Error(result.error);
      return result.data!;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: entityKeys.all() });
    },
  });
}
```

## 21.5 Service Conventions

```typescript
export const serviceName = {
  async methodName(params): Promise<ApiResponse<ReturnType>> {
    try {
      // 1. Validate inputs
      validateUUID(id, 'id');

      // 2. Build query
      const { data, error } = await supabase
        .from('table_name')
        .select('*')
        .eq('column_name', value);

      // 3. Handle errors
      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      // 4. Map results (snake_case → camelCase)
      const result = mapToCamelCase(data);

      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  }
};
```

## 21.6 Component Conventions

- **UI components**: Pure presentation, accept props, no direct data fetching
- **Container components**: Use hooks to fetch data, pass to UI components
- **Page components**: Top-level route components, compose containers and UI
- **Dark mode**: All UI components must support dark mode via TailwindCSS `dark:` variants
- **Loading states**: Use `LoadingSkeleton` components; `DataTable` has built-in skeleton

## 21.7 Code Reuse Strategy

1. **UI Components**: `components/ui/*` for generic reusable UI
2. **Services**: Centralised service layer — never duplicate DB queries
3. **Hooks**: React Query hooks with consistent patterns — never duplicate cache logic
4. **Query Keys**: Centralised factories — never hardcode query key strings
5. **Types**: Shared type definitions in `types/*` — never inline type definitions
6. **Utilities**: `utils/*` for shared helper functions — never inline utility logic
7. **Auth Routing**: `getPostLoginDestination()` is the ONLY source of truth for post-login routing

---

# 22. Statistics

## 22.1 Project Statistics

| Metric | Count |
|--------|-------|
| Total TypeScript/TSX files | 283 |
| Total lines of code | 88,263 |
| Total directories | 132 |
| Supabase migrations | 26 |

## 22.2 Pages & Routes

| Category | Count |
|----------|-------|
| Total route pages | 73 |
| Admin pages | 11 |
| Teacher pages | 50 |
| Dev console pages | 12 |
| Status/account pages | 5 |
| API routes | 1 |
| Theme files | 10 |
| Store files | 3 |

## 22.3 Services

| Category | Count |
|----------|-------|
| Total service files | 34 |
| Academic services | 5 |
| Admin management services | 7 |
| Mock test services | 10 |
| Analytics services | 2 |
| Content services | 4 |
| Storage services | 2 |
| Other services | 4 |

## 22.4 React Query Hooks

| Category | Count |
|----------|-------|
| Total hook files | 21 |
| Total hook exports (queries + mutations) | ~170+ |
| Academic hooks | 20 |
| Admin hooks | ~80 |
| Mock test hooks | ~60 |
| Analytics hooks | 19 |
| Content hooks | ~10 |
| Query key factories | 7 |

## 22.5 Components

| Category | Count |
|----------|-------|
| UI components (reusable) | 9 |
| Analytics chart components | 11 |
| Dev console components | 30+ |
| Profile components | 6 |
| Admin components | 2 |
| Teacher components | 2 |
| Auth components | 1 |
| Feature components (question-bank) | 8 |

## 22.6 Database Tables Used

| Module | Tables |
|--------|--------|
| Auth/Profiles | 2 |
| Academic | 4 |
| Content | 3 |
| Live Learning | 4 |
| Assessment | 12 |
| Teacher Management | 8 |
| Student Management | 3 |
| Notifications | 2 |
| Administration | 3 |
| **Total unique tables** | **~35** |

## 22.7 Completion Summary

| Area | Completion % |
|------|-------------|
| **Services Layer** | 65% |
| **Hooks Layer** | 60% |
| **UI Components** | 40% |
| **Admin Pages** | 25% |
| **Teacher Pages** | 45% |
| **Student Pages** | 0% |
| **Authentication** | 90% |
| **Storage Integration** | 40% |
| **Testing** | 0% |
| **Overall** | **35%** |

---

# 23. Future Roadmap

## 23.1 Not Yet Implemented

The following features are documented in specifications (see Documentation/, Admin_Dashboard_*.md, Teacher_Dashboard_*.md) but are NOT yet implemented in the codebase:

### High Priority
- **Student Dashboard**: Complete student-facing flow (attempt mock tests, view results)
- **Admin Page UIs**: Wire existing hooks + services to page components
- **Payment/Commerce Integration**: Orders, payments, subscription management (Domain 07)
- **Question Bulk Import**: OCR-based question ingestion (spec complete, implementation partial)
- **Real-time Live Classes**: WebRTC integration, attendance tracking

### Medium Priority
- **Analytics Dashboard**: Full chart visualizations wired to analytics hooks
- **Push Notifications**: Real-time notification delivery
- **Content Management**: Full content CRUD, approval workflow
- **Employee HR Portal**: Complete HR workflows (payroll, attendance)
- **Fine-grained Permissions**: Role-based access control for specific actions
- **Activity & Audit Logging**: Track all admin/teacher actions
- **Performance Optimization**: Server-side rendering, caching improvements

### Low Priority
- **Internationalization (i18n)**: Multi-language support
- **Accessibility (a11y)**: WCAG compliance
- **Mobile Responsive Design**: Mobile-friendly layouts
- **Dark Mode Refinement**: Complete dark mode coverage
- **E2E Testing**: Playwright/Cypress test suite
- **Component Storybook**: Component documentation
- **CI/CD Pipeline**: Automated build, test, deploy
- **Monitoring & Error Tracking**: Sentry/LogRocket integration
- **API Rate Limiting**: Prevent abuse of API routes

## 23.2 Separating Implemented vs Planned

### ✅ IMPLEMENTED
- Phone-based authentication with OTP verification
- Question CRUD with options, images, explanations
- Mock test CRUD with question assignment
- Batch CRUD (soft delete)
- Teacher lifecycle management (approve/reject/suspend)
- Student lifecycle management (approve/reject/suspend)
- Batch-student assignment
- Batch-teacher assignment
- Mock test-batch assignment
- Question approval workflow
- Mock test publish workflow
- Mock attempt, evaluation, and result processing
- Teacher analytics service layer
- Profile management
- Notification system (basic)
- Academic structure CRUD (streams, subjects, chapters, topics)
- Demo mode for offline testing

### 🔴 NOT YET IMPLEMENTED
- Student dashboard/portal
- Full admin page UIs (hooks + services exist but pages not wired)
- Payment processing
- OCR question import
- WebRTC live classes
- Push notifications
- Content management UI
- Complete HR portal
- Performance analytics visualizations
- User activity monitoring
- Internationalization
- Accessibility compliance
- Mobile responsive design
- Testing infrastructure

---

> **Document generated from actual source code on July 11, 2026.**  
> This document should be regenerated when significant architectural changes occur.
