# Teacher Dashboard — API Contracts & Service Documentation

> **Document Version:** 1.0  
> **Prepared for:** Developers, Architects, AI Assistants  
> **Last Updated:** July 2026  
> **Scope:** Complete Teacher Dashboard Phase 1 — all services, hooks, types, and integrations

---

## Table of Contents

1. [Project Architecture](#1-project-architecture)
2. [Service Inventory](#2-service-inventory)
3. [React Query Hooks](#3-react-query-hooks)
4. [API Contracts](#4-api-contracts)
5. [Database Mapping](#5-database-mapping)
6. [Permission Matrix](#6-permission-matrix)
7. [Error Contract](#7-error-contract)
8. [Validation Rules](#8-validation-rules)
9. [React Query Cache Strategy](#9-react-query-cache-strategy)
10. [File Upload Contracts](#10-file-upload-contracts)
11. [Authentication Contracts](#11-authentication-contracts)
12. [Module Dependency Diagram](#12-module-dependency-diagram)
13. [Sequence Diagrams](#13-sequence-diagrams)
14. [Integration Checklist](#14-integration-checklist)
15. [Backend TODO List](#15-backend-todo-list)
16. [Production Readiness](#16-production-readiness)
17. [Phase 2 API Roadmap](#17-phase-2-api-roadmap)

---

## 1. Project Architecture

### Layer Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                      FRONTEND (Next.js)                        │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │  Pages  │ │Components│ │ Context  │ │   Utilities      │  │
│  │ App Rtr │ │  (UI)    │ │(Auth,    │ │  (formatters,    │  │
│  │         │ │          │ │ Theme)   │ │   validators)    │  │
│  └────┬────┘ └────┬─────┘ └────┬─────┘ └────────┬─────────┘  │
│       │           │            │                 │            │
│       ▼           ▼            ▼                 ▼            │
│  ┌────────────────────────────────────────────────────────┐   │
│  │                    REACT QUERY LAYER                     │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │   │
│  │  │ useQues- │ │useMock-  │ │useResults│ │useAuth() │   │   │
│  │  │ tions()  │ │ Tests()  │ │  ()      │ │ ...      │   │   │
│  │  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘   │   │
│  │       │            │            │             │          │   │
│  │       ▼            ▼            ▼             ▼          │   │
│  │              REACT QUERY CACHE (QueryClient)             │   │
│  └────────────────────────────────────────────────────────┘   │
│                              │                                 │
└──────────────────────────────┼─────────────────────────────────┘
                               │
                               ▼
┌───────────────────────────────────────────────────────────────┐
│                    SERVICE LAYER                               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐   │
│  │  auth    │ │ mockTest │ │ question │ │  notification │   │
│  │ Service  │ │ Services │ │ Services │ │   Services    │   │
│  ├──────────┤ ├──────────┤ ├──────────┤ ├───────────────┤   │
│  │ teacher  │ │ academic │ │ content  │ │    storage    │   │
│  │ Service  │ │ Services │ │ Services │ │   Service    │   │
│  ├──────────┤ ├──────────┤ ├──────────┤ ├───────────────┤   │
│  │  profile │ │ settings │ │analytics │ │   approval   │   │
│  │  Service │ │ Services │ │ Services │ │   Services   │   │
│  └──────────┘ └──────────┘ └──────────┘ └───────────────┘   │
│  Every method returns: ApiResponse<T> or AuthResponse<T>     │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌───────────────────────────────────────────────────────────────┐
│                    SUPABASE CLIENT                             │
│  ┌────────────────────────────────────────────────────────┐   │
│  │  anon key · RLS (Row-Level Security)                    │   │
│  │  Auth: signIn, signUp, verifyOtp, refreshSession       │   │
│  │  Database: SELECT/INSERT/UPDATE/DELETE via JS client   │   │
│  │  Storage: upload, download, delete, signed URLs         │   │
│  └────────────────────────────────────────────────────────┘   │
└──────────────────────────────┬─────────────────────────────────┘
                               │
                               ▼
┌───────────────────────────────────────────────────────────────┐
│                    POSTGRESQL (Supabase)                       │
│  ┌────────────────────────────────────────────────────────┐   │
│  │  Tables: 40+ tables across 15 schema domains            │   │
│  │  RLS Policies: Row-level security on every table        │   │
│  │  Triggers: auto-creation of profiles, updated_at        │   │
│  │  Enums: question_type, difficulty, status, etc.         │   │
│  └────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────┘
```

### Layer Responsibilities

| Layer | Responsibility |
|-------|---------------|
| **Pages (Next.js App Router)** | Route definitions, page-level composition, layout, breadcrumbs. Server components where possible, `'use client'` for interactive pages. |
| **Components** | Reusable UI building blocks: `PageHeader`, `DataTable`, `StatusBadge`, `EmptyState`, `Skeleton`, `ConfirmDialog`, `SearchBar`, `FilterPanel`, and domain-specific components (profile, analytics, etc.). |
| **Context** | `AuthContext` provides session, user profile, teacher profile, institute ID, and auth actions (signIn, signUp, verifyOtp, signOut) to the entire component tree. |
| **React Query Hooks** | Custom hooks wrapping service functions with TanStack React Query. Provide caching, deduplication, loading/error states, and automatic refetching. Every hook returns standard query/mutation result shapes. |
| **Service Layer** | Clean-architecture abstraction over Supabase. All functions return `ApiResponse<T>` or `AuthResponse<T>`. No raw Supabase errors escape. Handles validation, UUID validation, error extraction, and response mapping (snake_case ↔ camelCase). |
| **Supabase Client** | Pre-configured Supabase JS client with anon key. All queries respect RLS. Never uses service_role key in frontend code. |
| **PostgreSQL** | Supabase-hosted Postgres with 40+ tables, RLS policies, database triggers, and enum types. The single source of truth for all data. |

### Key Architectural Decisions

1. **RLS-only security** — The frontend uses the anon key exclusively. All access control is enforced at the database level via RLS policies. No backend API gateway exists.
2. **Service pattern** — Every domain has a dedicated service file. Services never call each other directly except for orchestration services (e.g., `mockTestPublishService` calls `mockTestService` and `questionService`).
3. **CamelCase ↔ snake_case** — The database uses snake_case. Every service maps to camelCase TypeScript interfaces via dedicated `map*` helper functions.
4. **Standardised response types** — All services return `ApiResponse<T>` (for data operations) or `AuthResponse<T>` (for auth operations). Both have `{ success, data?, error?, warning? }` shape.
5. **No backend API** — There is no REST/GraphQL API server. The frontend communicates directly with Supabase via the JS client. This means no API versioning, no request/response middleware — just direct database queries.

---

## 2. Service Inventory

### 2.1 Auth Service

| Property | Value |
|----------|-------|
| **File** | `src/services/authService.ts` |
| **Purpose** | Encapsulates all Supabase Auth operations — sign in, sign up, OTP verification, password management, session management. |
| **Dependencies** | `@supabase/supabase-js`, `src/config/supabase.ts`, `src/types/auth.ts` |
| **Tables Used** | `profiles` (SELECT), `auth.users` (via Supabase Auth API) |
| **Who Uses It** | `AuthContext.tsx`, `useAuth.ts` hook, `LoginView.tsx` |
| **Key Pattern** | Returns `AuthResponse<T>` for all methods. Fetches `profiles` table after auth to get authoritative role. |

### 2.2 Teacher Service

| Property | Value |
|----------|-------|
| **File** | `src/services/teacherService.ts` |
| **Purpose** | Fetch teacher's assigned batches, student rosters, overview data, HR data, leave management, and live class operations. |
| **Dependencies** | `src/config/supabase.ts`, `src/data/mockData.ts` |
| **Tables Used** | `batch_teachers`, `batches`, `batch_students`, `student_details`, `profiles`, `teacher_details`, `teacher_analytics`, `live_classes`, `live_class_batch`, `live_sessions`, `session_participants`, `teacher_employment_records`, `teacher_bank_details`, `teacher_qualifications`, `teacher_experiences`, `teacher_documents`, `teacher_leave_requests`, `teacher_specializations`, `assessments`, `student_attempts` |
| **Who Uses It** | Dashboard page, Student pages, teacher sidebar, Profile module |
| **Key Pattern** | Most methods have offline/fallback to mock data when Supabase is unreachable. |

### 2.3 Question Service

| Property | Value |
|----------|-------|
| **File** | `src/services/mockTest/questionService.ts` |
| **Purpose** | CRUD operations on the `questions` table — create, read, update, delete, and status transitions (publish, archive, restore). |
| **Dependencies** | `src/config/supabase.ts`, `src/utils/supabase.ts`, `src/utils/response.ts`, `src/services/content/teacherResolver.ts` |
| **Tables Used** | `questions` (RW), `subjects` (R), `chapters` (R) |
| **Who Uses It** | `useQuestions()` hook, `useQuestionFilters()` hook, Question Create/Edit/List pages |
| **Key Pattern** | Teacher ID resolved via `resolveCurrentTeacherId()` for RLS compliance. Snake_case → camelCase mapping. |

### 2.4 Question Option Service

| Property | Value |
|----------|-------|
| **File** | `src/services/mockTest/questionOptionService.ts` |
| **Purpose** | CRUD operations on `question_options` — create, read, update, delete options for a question. |
| **Dependencies** | `src/config/supabase.ts`, `src/utils/supabase.ts`, `src/utils/response.ts` |
| **Tables Used** | `question_options` (RW), `questions` (R for FK validation) |
| **Who Uses It** | Question Create/Edit pages (via `QuestionForm` component) |

### 2.5 Question Explanation Service

| Property | Value |
|----------|-------|
| **File** | `src/services/mockTest/questionExplanationService.ts` |
| **Purpose** | CRUD operations on `question_explanations` — the 1:1 solution walkthrough for each question. |
| **Dependencies** | `src/config/supabase.ts`, `src/utils/supabase.ts` |
| **Tables Used** | `question_explanations` (RW), `questions` (R) |
| **Who Uses It** | Question Create/Edit pages (ExplanationEditor component) |

### 2.6 Question Image Service

| Property | Value |
|----------|-------|
| **File** | `src/services/mockTest/questionImageService.ts` |
| **Purpose** | CRUD operations on `question_images` — manage diagrams, figures, and graphs attached to questions. |
| **Dependencies** | `src/config/supabase.ts`, `src/utils/supabase.ts` |
| **Tables Used** | `question_images` (RW), `questions` (R) |
| **Who Uses It** | Question Create/Edit pages (ImageUploader component) |

### 2.7 Mock Test Service

| Property | Value |
|----------|-------|
| **File** | `src/services/mockTest/mockTestService.ts` |
| **Purpose** | CRUD and lifecycle management for `mock_tests` — create, read, update, delete, and status transitions (publish, archive, restore). |
| **Dependencies** | `src/config/supabase.ts`, `src/utils/supabase.ts`, `src/utils/response.ts`, `src/services/content/teacherResolver.ts` |
| **Tables Used** | `mock_tests` (RW) |
| **Who Uses It** | `useMockTests()` hook, Mock Test Create/Edit/List pages |
| **Key Pattern** | Strict state machine validation for status transitions. Teacher ID resolved for RLS. |

### 2.8 Mock Test Question Service

| Property | Value |
|----------|-------|
| **File** | `src/services/mockTest/mockTestQuestionService.ts` |
| **Purpose** | Manages the `mock_test_questions` junction table — add, remove, reorder, and bulk replace questions in a test. |
| **Dependencies** | `src/config/supabase.ts`, `src/utils/supabase.ts`, `mockTestService.ts`, `questionService.ts` |
| **Tables Used** | `mock_test_questions` (RW), `mock_tests` (R), `questions` (R) |
| **Who Uses It** | `useMockTestQuestions()` hook, Mock Test Questions page |
| **Key Pattern** | Compound identifier `testId::questionId` for API calls. Full validation before bulk operations. |

### 2.9 Mock Test Publish Service

| Property | Value |
|----------|-------|
| **File** | `src/services/mockTest/mockTestPublishService.ts` |
| **Purpose** | Orchestrates the publish workflow — validates test readiness, generates question snapshots (placeholder), and transitions status. |
| **Dependencies** | `mockTestService.ts`, `mockTestQuestionService.ts`, `questionService.ts`, `src/config/supabase.ts` |
| **Tables Used** | `mock_tests` (RW), `mock_test_questions` (R), `questions` (R), `mock_attempts` (R for unpublish guard) |
| **Who Uses It** | Mock Test Publish page |
| **Key Pattern** | Returns `ValidationReport` with 11 checks. Snapshot generation is reserved but not implemented. |

### 2.10 Mock Attempt Service

| Property | Value |
|----------|-------|
| **File** | `src/services/mockTest/mockAttemptService.ts` |
| **Purpose** | Manages the attempt engine — create/read/update/delete attempts, answers, answer options, and results (read-only). |
| **Dependencies** | `src/config/supabase.ts`, `src/utils/supabase.ts`, `src/utils/response.ts`, `studentResolver.ts`, `mockTestService.ts` |
| **Tables Used** | `mock_attempts` (RW), `mock_answers` (RW), `mock_answer_options` (RW), `mock_results` (R) |
| **Who Uses It** | Dev debug pages, evaluation pipeline |
| **Key Pattern** | Student ID resolution via `resolveCurrentStudentId()`. Attempt limit enforcement. |

### 2.11 Mock Result Service

| Property | Value |
|----------|-------|
| **File** | `src/services/mockTest/mockResultService.ts` |
| **Purpose** | CRUD and lifecycle for `mock_results` — read, release, hide, delete. Also provides aggregated queries (student results, test results, institute results). |
| **Dependencies** | `src/config/supabase.ts`, `src/utils/supabase.ts`, `src/utils/response.ts` |
| **Tables Used** | `mock_results` (RW) |
| **Who Uses It** | `useResults()` hook, `useStudentResults()` hook, Results pages |
| **Key Pattern** | Console.group/groupEnd debug logging on all operations. Paginated queries with full filter support. |

### 2.12 Mock Evaluation Service

| Property | Value |
|----------|-------|
| **File** | `src/services/mockTest/mockEvaluationService.ts` |
| **Purpose** | The scoring engine — evaluates a submitted attempt by comparing answers against question snapshots, computing scores, and inserting mock_results. |
| **Dependencies** | `mockAttemptService.ts`, `mockTestService.ts`, `mockTestQuestionService.ts`, `src/config/supabase.ts` |
| **Tables Used** | `mock_answers` (RW), `mock_results` (RW), `mock_attempts` (R), `mock_test_questions` (R), `mock_answer_options` (R) |
| **Who Uses It** | Triggered programmatically after attempt submission |
| **Key Pattern** | Duplicate prevention check before evaluation. Supports MCQ, MSQ, True/False, and Numerical scoring. Updates `is_correct` and `marks_awarded` on each mock_answer. |

### 2.13 Notification Service

| Property | Value |
|----------|-------|
| **File** | `src/services/notification/notificationService.ts` |
| **Purpose** | CRUD and lifecycle for `notifications` and `notification_recipients` — create, read, mark read, mark all read, soft delete, and bulk notification creation. |
| **Dependencies** | `src/config/supabase.ts`, `src/utils/supabase.ts`, `src/utils/response.ts`, `src/utils/notification.ts` |
| **Tables Used** | `notifications` (RW), `notification_recipients` (RW), `notification_templates` (R) |
| **Who Uses It** | `useNotifications()` hook, Notification pages |
| **Key Pattern** | Joined query pattern (notifications + notification_recipients). Helper methods for automatic notifications (mock test published, result published, content uploaded). |

### 2.14 Academic Services (Stream, Subject, Chapter, Topic)

| Service | File | Tables Used |
|---------|------|-------------|
| **Stream Service** | `src/services/academic/streamService.ts` | `streams` (RW) |
| **Subject Service** | `src/services/academic/subjectService.ts` | `subjects` (RW) |
| **Chapter Service** | `src/services/academic/chapterService.ts` | `chapters` (RW) |
| **Topic Service** | `src/services/academic/topicService.ts` | `topics` (RW) |

Each follows the same pattern: paginated filtered queries, CRUD with validation, snake_case mapping.

### 2.15 Content Service

| Property | Value |
|----------|-------|
| **File** | `src/services/content/contentService.ts` |
| **Purpose** | CRUD and lifecycle for the `content` table — create, read, update, delete, and status transitions (publish, approve, reject, archive, restore). Integrates with `storageService` for file uploads. |
| **Dependencies** | `src/config/supabase.ts`, `src/utils/supabase.ts`, `src/utils/response.ts`, `storageService.ts`, `teacherResolver.ts` |
| **Tables Used** | `content` (RW), `chapters` (R), `subjects` (R) |
| **Who Uses It** | Not directly used by teacher-facing pages yet (Phase 2) |

### 2.16 Tag Service

| Property | Value |
|----------|-------|
| **File** | `src/services/content/tagService.ts` |
| **Purpose** | CRUD for `tags` and `content_tag` junction — create, read, update, delete tags, attach/detach/replace tags on content. |
| **Dependencies** | `src/config/supabase.ts`, `src/utils/supabase.ts`, `src/utils/response.ts` |
| **Tables Used** | `tags` (RW), `content_tag` (RW) |
| **Who Uses It** | Not directly used by teacher-facing pages yet (Phase 2) |

### 2.17 Approval Service

| Property | Value |
|----------|-------|
| **File** | `src/services/content/approvalService.ts` |
| **Purpose** | Manages the `approval_requests` table — create approval requests, assign reviewers, approve/reject, reopen, cancel. |
| **Dependencies** | `src/config/supabase.ts`, `src/utils/supabase.ts`, `src/utils/response.ts`, `contentService.ts` |
| **Tables Used** | `approval_requests` (RW), `content` (RW for lifecycle transitions) |
| **Who Uses It** | Admin pages, Dev debug pages |

### 2.18 Storage Service

| Property | Value |
|----------|-------|
| **File** | `src/services/storage/storageService.ts` |
| **Purpose** | Generalised Supabase Storage layer — upload, download, delete, replace files, generate signed URLs, check file existence, upload thumbnails. Supports retry with exponential backoff. |
| **Dependencies** | `src/config/supabase.ts`, `src/utils/supabase.ts`, `src/utils/storage.ts`, `src/config/storage.ts` |
| **Tables Used** | No direct table access (stores files in Storage buckets) |
| **Who Uses It** | `contentService.ts`, Profile module (avatar upload), Question Image upload |
| **Key Pattern** | Two upload APIs: `uploadFile()` (content-type based, backward compatible) and `uploadResource()` (resource-type based, generalised). Retry with exponential backoff for transient errors. |

### 2.19 Profile Service

| Property | Value |
|----------|-------|
| **File** | `src/services/profileService.ts` |
| **Purpose** | Manage teacher profile data — fetch full profile, update personal info, update professional info, upload avatar, manage notification preferences, and aggregate activity timeline. |
| **Dependencies** | `src/config/supabase.ts`, `src/types/profile.ts`, `authService.ts` |
| **Tables Used** | `profiles` (RW), `teacher_details` (RW), `mock_tests` (R), `questions` (R), `notifications` (R), `notification_recipients` (R) |
| **Who Uses It** | Profile View/Edit/Activity pages |
| **Key Pattern** | Aggregates activity from multiple tables. Notification preferences stored in localStorage (server sync pending). |

### 2.20 Settings Service

| Property | Value |
|----------|-------|
| **File** | `src/services/settings/settingsService.ts` |
| **Purpose** | Persist and apply teacher settings — appearance theme, language, timezone, dashboard preferences, privacy, session management, data/storage preferences. |
| **Dependencies** | `src/types/settings/index.ts`, `src/utils/supabase.ts` |
| **Tables Used** | No database tables (all stored in localStorage) |
| **Who Uses It** | Settings page |
| **Key Pattern** | Settings stored in localStorage under key `teacher_settings`. Theme applied via DOM class toggling on `<html>` element. |

### 2.21 Assessment Service

| Property | Value |
|----------|-------|
| **File** | `src/services/assessmentService.ts` |
| **Purpose** | Legacy service for assessment dashboard, question bank listing, and grading operations. Wraps some mock_test queries. |
| **Dependencies** | `src/config/supabase.ts`, `src/data/mockData.ts` |
| **Tables Used** | `mock_tests` (R), `mock_test_questions` (R), `mock_attempts` (R), `mock_results` (R), `questions` (R), `streams` (R), `subjects` (R), `teacher_details` (R) |
| **Who Uses It** | Early dev pages (being replaced by domain-specific services) |

### 2.22 Teacher Resolver (Internal)

| Property | Value |
|----------|-------|
| **File** | `src/services/content/teacherResolver.ts` |
| **Purpose** | Resolves the authenticated user's Supabase Auth profile ID to the corresponding `teacher_details.teacher_id`. Required for RLS compliance because RLS policies check against `teacher_details.teacher_id`, not `auth.users.id`. |
| **Dependencies** | `src/config/supabase.ts` |
| **Tables Used** | `teacher_details` (R) |
| **Who Uses It** | `questionService.ts`, `mockTestService.ts`, `contentService.ts` |
| **Key Pattern** | Caches the resolved teacher ID in-memory for the session duration. |

### 2.23 Student Resolver (Internal)

| Property | Value |
|----------|-------|
| **File** | `src/services/mockTest/studentResolver.ts` |
| **Purpose** | Resolves authenticated user's profile ID to `student_details.student_id`. Required for attempt creation RLS compliance. |
| **Dependencies** | `src/config/supabase.ts` |
| **Tables Used** | `student_details` (R) |
| **Who Uses It** | `mockAttemptService.ts` |

---

## 3. React Query Hooks

### 3.1 Auth Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useAuth()` | `src/hooks/useAuth.ts` | Orchestrates all auth actions (login, register, verifyOtp, resendOtp, logout, refreshSession). Returns `{ user, loading, error, isAuthenticated }` from Redux store. |
| `useAppDispatch()` | `src/store/hooks.ts` | Typed Redux dispatch hook |
| `useAppSelector()` | `src/store/hooks.ts` | Typed Redux selector hook |

### 3.2 Question Hooks

| Hook | File | Cache Key | Stale Time | Mutations |
|------|------|-----------|------------|-----------|
| `useQuestions()` | `src/hooks/mockTest/useQuestions.ts` | `['questions', filters, sort, pagination]` | 30s | — |
| `useQuestion()` | `src/hooks/mockTest/useQuestions.ts` | `['questions', questionId]` | 30s | — |
| `useCreateQuestion()` | `src/hooks/mockTest/useQuestions.ts` | — | — | invalidates `['questions']` |
| `useUpdateQuestion()` | `src/hooks/mockTest/useQuestions.ts` | — | — | invalidates `['questions']` |
| `useDeleteQuestion()` | `src/hooks/mockTest/useQuestions.ts` | — | — | invalidates `['questions']` |
| `usePublishQuestion()` | `src/hooks/mockTest/useQuestions.ts` | — | — | invalidates `['questions']` |
| `useArchiveQuestion()` | `src/hooks/mockTest/useQuestions.ts` | — | — | invalidates `['questions']` |
| `useRestoreQuestion()` | `src/hooks/mockTest/useQuestions.ts` | — | — | invalidates `['questions']` |
| `useQuestionFilters()` | `src/features/question-bank/hooks/useQuestionFilters.ts` | — | — | Local state only (not via React Query) |
| `useQuestionBulkActions()` | `src/features/question-bank/hooks/useQuestionBulkActions.ts` | — | — | Local state only (selection state) |

**Returns (queries):** `{ data: PaginatedResponse<Question>, isLoading, error }`

**Returns (mutations):** `{ mutate, isPending, isError, error }`

### 3.3 Mock Test Hooks

| Hook | File | Cache Key | Stale Time | Mutations |
|------|------|-----------|------------|-----------|
| `useMockTests()` | `src/hooks/mockTest/useMockTests.ts` | `['mockTests', filters, sort, pagination]` | 30s | — |
| `useMockTest()` | `src/hooks/mockTest/useMockTests.ts` | `['mockTests', testId]` | 30s | — |
| `useCreateMockTest()` | `src/hooks/mockTest/useMockTests.ts` | — | — | invalidates `['mockTests']` |
| `useUpdateMockTest()` | `src/hooks/mockTest/useMockTests.ts` | — | — | invalidates `['mockTests']` |
| `useDeleteMockTest()` | `src/hooks/mockTest/useMockTests.ts` | — | — | invalidates `['mockTests']` |
| `usePublishMockTest()` | `src/hooks/mockTest/useMockTests.ts` | — | — | invalidates `['mockTests']` |
| `useArchiveMockTest()` | `src/hooks/mockTest/useMockTests.ts` | — | — | invalidates `['mockTests']` |
| `useRestoreMockTest()` | `src/hooks/mockTest/useMockTests.ts` | — | — | invalidates `['mockTests']` |

### 3.4 Mock Test Question Hooks

| Hook | File | Cache Key | Stale Time | Mutations |
|------|------|-----------|------------|-----------|
| `useMockTestQuestions()` | `src/hooks/mockTest/useMockTestQuestions.ts` | `['mockTestQuestions', testId]` | 30s | — |
| `useAddQuestionsToTest()` | `src/hooks/mockTest/useMockTestQuestions.ts` | — | — | invalidates `['mockTestQuestions']` |
| `useRemoveQuestionFromTest()` | `src/hooks/mockTest/useMockTestQuestions.ts` | — | — | invalidates `['mockTestQuestions']` |
| `useReorderQuestions()` | `src/hooks/mockTest/useMockTestQuestions.ts` | — | — | invalidates `['mockTestQuestions']` |

### 3.5 Mock Attempt Hooks

| Hook | File | Cache Key | Stale Time |
|------|------|-----------|------------|
| `useMockAttempts()` | `src/hooks/mockTest/useMockAttempts.ts` | `['mockAttempts', filters, sort, pagination]` | 30s |
| `useMockAttempt()` | `src/hooks/mockTest/useMockAttempts.ts` | `['mockAttempts', attemptId]` | 30s |
| `useCreateMockAttempt()` | `src/hooks/mockTest/useMockAttempts.ts` | — | 30s |
| `useSubmitMockAttempt()` | `src/hooks/mockTest/useMockAttempts.ts` | — | 30s |

### 3.6 Result Hooks

| Hook | File | Cache Key | Stale Time | Mutations |
|------|------|-----------|------------|-----------|
| `useResults()` | `src/hooks/mockTest/useMockResults.ts` | `['mockResults', filters, sort, pagination]` | 30s | — |
| `useMockResult()` | `src/hooks/mockTest/useMockResults.ts` | `['mockResults', resultId]` | 30s | — |
| `useStudentResults()` | `src/hooks/mockTest/useMockResults.ts` | `['mockResults', 'student', studentId]` | 30s | — |
| `useReleaseResult()` | `src/hooks/mockTest/useMockResults.ts` | — | — | invalidates `['mockResults']` |
| `useHideResult()` | `src/hooks/mockTest/useMockResults.ts` | — | — | invalidates `['mockResults']` |

### 3.7 Academic Hooks

| Hook | File | Cache Key | Stale Time | Dependencies |
|------|------|-----------|------------|--------------|
| `useStreams()` | `src/hooks/academic/useStreams.ts` | `['streams', filters, sort, pagination]` | 5 min | None |
| `useSubjects()` | `src/hooks/academic/useSubjects.ts` | `['subjects', filters, sort, pagination]` | 5 min | None |
| `useChapters()` | `src/hooks/academic/useChapters.ts` | `['chapters', filters, sort, pagination]` | 5 min | `subjectId` filter |
| `useTopics()` | `src/hooks/academic/useTopics.ts` | `['topics', filters, sort, pagination]` | 5 min | `chapterId` filter |
| `useBatches()` | `src/hooks/academic/useBatches.ts` | `['batches', filters, sort, pagination]` | 30s | None |

**Note:** Academic structure changes rarely. 5-minute stale times prevent unnecessary refetches.

### 3.8 Notification Hooks

| Hook | File | Cache Key | Stale Time | Mutations |
|------|------|-----------|------------|-----------|
| `useNotifications()` | `src/hooks/notification/useNotifications.ts` | `['notifications', userId, filters, sort, pagination]` | 10s | — |
| `useNotificationDashboard()` | `src/hooks/notification/useNotifications.ts` | `['notifications', 'dashboard', userId]` | 10s | — |
| `useCreateNotification()` | `src/hooks/notification/useNotifications.ts` | — | — | invalidates `['notifications']` |
| `useMarkAllAsRead()` | `src/hooks/notification/useNotifications.ts` | — | — | invalidates `['notifications']` |
| `usePublishAnnouncement()` | `src/hooks/notification/useNotifications.ts` | — | — | invalidates `['notifications']` |

### 3.9 Analytics Hooks

| Hook | File | Cache Key | Stale Time |
|------|------|-----------|------------|
| `useTeacherAnalytics()` | `src/hooks/analytics/useAnalytics.ts` | `['analytics', 'teacher', teacherId]` | 60s |
| `useStudentAnalytics()` | `src/hooks/analytics/useAnalytics.ts` | `['analytics', 'student', studentId]` | 60s |
| `useMockTestAnalytics()` | `src/hooks/analytics/useAnalytics.ts` | `['analytics', 'mockTest', testId]` | 60s |
| `useSubjectAnalytics()` | `src/hooks/analytics/useAnalytics.ts` | `['analytics', 'subjects', filters]` | 60s |
| `useChapterAnalytics()` | `src/hooks/analytics/useAnalytics.ts` | `['analytics', 'chapters', filters]` | 60s |
| `usePerformanceTrends()` | `src/hooks/analytics/useAnalytics.ts` | `['analytics', 'trends', filters]` | 60s |
| `useLeaderboard()` | `src/hooks/analytics/useAnalytics.ts` | `['analytics', 'leaderboard', filters]` | 60s |
| `useInsights()` | `src/hooks/analytics/useAnalytics.ts` | `['analytics', 'insights']` | 60s |

**Cache key pattern:** All analytics hooks use `['analytics', <type>, ...params]` prefix for targeted invalidation.

### 3.10 Other Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useQuestionOptions()` | `src/hooks/mockTest/useQuestionOptions.ts` | Fetch/create/update/delete options for a specific question |
| `useQuestionExplanations()` | `src/hooks/mockTest/useQuestionExplanations.ts` | Fetch/create/update explanations for a specific question |
| `useQuestionImages()` | `src/hooks/mockTest/useQuestionImages.ts` | Fetch/create/delete images for a specific question |
| `useMockTestPublish()` | `src/hooks/mockTest/useMockTestPublish.ts` | Validate and execute the publish workflow |

---

## 4. API Contracts

### 4.1 Auth Service (`authService.ts`)

#### `signIn(input: SignInInput): Promise<AuthResponse<UserProfile>>`

| Field | Type | Description |
|-------|------|-------------|
| **Purpose** | — | Authenticate an existing user with phone + password |
| **Input** | `{ phone: string, password: string }` | Phone must include country code (e.g., +919876543210) |
| **Success** | `{ success: true, data: UserProfile }` | Returns merged profile from auth + profiles table |
| **Failure** | `{ success: false, error: string }` | "Invalid login credentials", "Please enter a valid mobile number" |
| **Validation** | Phone: required, must start with +, 7-15 digits. Password: required, min 6 chars |
| **Permission** | Public (any unauthenticated user) |
| **DB Tables** | `profiles` (SELECT) |
| **Side Effects** | Creates Supabase auth session |

#### `signUp(input: SignUpInput): Promise<AuthResponse<{ phone: string, password: string }>>`

| Field | Type | Description |
|-------|------|-------------|
| **Purpose** | — | Register a new user account with phone + password. Sends SMS OTP. |
| **Input** | `{ phone: string, password: string, name: string }` | |
| **Success** | `{ success: true, data: { phone, password } }` | Returns phone/password for OTP flow continuation |
| **Failure** | `{ success: false, error: string }` | Validation errors, user already exists |
| **Validation** | Phone: E.164 format. Password: min 6 chars. Name: required |
| **Permission** | Public |
| **DB Tables** | `profiles` (via DB trigger on auth user creation) |
| **Side Effects** | Creates auth user. DB trigger creates profile row. |

#### `verifyOtp(input: VerifyOtpInput): Promise<AuthResponse<UserProfile>>`

| Field | Type | Description |
|-------|------|-------------|
| **Purpose** | — | Verify an SMS OTP to complete phone verification or forgot-password flow |
| **Input** | `{ phone: string, token: string }` | OTP token is 4-8 characters |
| **Success** | `{ success: true, data: UserProfile }` | User authenticated, session established |
| **Failure** | `{ success: false, error: string }` | "Invalid OTP", expired token |
| **Permission** | Public |
| **DB Tables** | `profiles` (SELECT) |
| **Side Effects** | Creates Supabase auth session |

#### `updatePassword(newPassword: string): Promise<AuthResponse<null>>`

| Field | Type | Description |
|-------|------|-------------|
| **Purpose** | — | Update the current user's password |
| **Input** | `newPassword: string` | Min 6 characters |
| **Success** | `{ success: true, data: null }` | |
| **Failure** | `{ success: false, error: string }` | "Password must be at least 6 characters" |
| **Permission** | Authenticated user only |
| **DB Tables** | None (Supabase Auth API) |
| **Side Effects** | Auth user's password updated |

#### `signOut(): Promise<AuthResponse<null>>`

| Field | Type | Description |
|-------|------|-------------|
| **Purpose** | — | Sign out the current user, clear session |
| **Success** | `{ success: true, data: null }` | |
| **Permission** | Authenticated user |
| **Side Effects** | Supabase session cleared, refresh token invalidated |

#### `getSession(): Promise<AuthResponse<SessionData>>`

| Field | Type | Description |
|-------|------|-------------|
| **Purpose** | — | Retrieve current session from local cache (fast, no server verification) |
| **Success** | `{ success: true, data: SessionData }` | Contains `isAuthenticated`, `user: UserProfile`, tokens |
| **Permission** | Any | |

### 4.2 Teacher Service (`teacherService.ts`)

#### `getAssignedBatches(teacherId: string): Promise<AcademicBatch[]>`

| Field | Type | Description |
|-------|------|-------------|
| **Purpose** | — | Fetch all batches assigned to a teacher |
| **Input** | `teacherId: string` | Teacher's UUID |
| **Success** | `AcademicBatch[]` | Array of `{ id, name, code, stream, studentsCount, ... }` |
| **Failure** | `[]` (empty array) | Returns empty array on any error |
| **Permission** | Teacher (RLS: `teacher_id = get_my_teacher_id()`) |
| **DB Tables** | `batch_teachers` (R), `batches` (R) |

#### `getStudentRoster(batchId: string): Promise<StudentRosterItem[]>`

| Field | Type | Description |
|-------|------|-------------|
| **Purpose** | — | Fetch student roster and performance for a specific batch |
| **Input** | `batchId: string` | Batch UUID |
| **Success** | `StudentRosterItem[]` | Array of `{ id, name, rollNumber, avgScore, attendanceRate, rank, status, strongChapter, weakChapter }` |
| **Failure** | `[]` | Empty array on error |
| **Permission** | Teacher (RLS: batch must be assigned to teacher) |
| **DB Tables** | `batch_students` (R), `student_details` (R), `profiles` (R) |

#### `getTeacherOverviewData(teacherId: string): Promise<any>`

| Field | Type | Description |
|-------|------|-------------|
| **Purpose** | — | Fetch comprehensive teacher dashboard data including stats, next class, analytics |
| **Input** | `teacherId: string` | Teacher UUID |
| **Success** | Object with `{ rating, specialization, activeBatches, totalStudents, analytics: {...}, nextClass, activeTest }` |
| **Failure** | `null` | On error |
| **Permission** | Teacher (RLS) |
| **DB Tables** | `teacher_details`, `batch_teachers`, `batch_students`, `teacher_analytics`, `live_classes`, `live_class_batch`, `assessments`, `student_attempts` |

### 4.3 Mock Test Service (`mockTestService.ts`)

#### `getMockTests(filters?, sort?, pagination?): Promise<ApiResponse<PaginatedResponse<MockTest>>>`

| Field | Type | Description |
|-------|------|-------------|
| **Purpose** | — | Fetch paginated, filtered, sorted list of mock tests |
| **Input** | `filters?: MockTestServiceFilters`, `sort?: MockTestServiceSortOptions`, `pagination?: PaginationParams` | |
| **Success** | `{ success: true, data: { data: MockTest[], count: number } }` | |
| **Failure** | `{ success: false, error: string }` | |
| **Validation** | UUID validation on all filter IDs |
| **Permission** | Teacher (RLS: `teacher_id = get_my_teacher_id()`) |
| **DB Tables** | `mock_tests` (R) |

#### `getMockTestById(testId: string): Promise<ApiResponse<MockTest>>`

| Field | Type | Description |
|-------|------|-------------|
| **Purpose** | — | Fetch a single mock test by its UUID |
| **Input** | `testId: string` | UUID |
| **Success** | `{ success: true, data: MockTest }` | |
| **Failure** | `{ success: false, error: "Mock test not found: {id}" }` | PGRST116 code |
| **Permission** | Teacher (RLS: owns the test or has access) |

#### `createMockTest(input: CreateMockTestInput): Promise<ApiResponse<MockTest>>`

| Field | Type | Description |
|-------|------|-------------|
| **Purpose** | — | Create a new mock test with status "draft" |
| **Input** | `CreateMockTestInput` | `{ instituteId, teacherId, streamId, title, durationMin, totalMarks, ... }` |
| **Success** | `{ success: true, data: MockTest }` | |
| **Failure** | `{ success: false, error: string }` | Various validation errors, FK violation |
| **Validation** | instituteId, streamId required. Title min 3 chars. durationMin > 0. totalMarks > 0. passingMarks ≤ totalMarks. |
| **Permission** | Teacher (RLS: teacher_id resolved from session) |
| **Side Effects** | Teacher ID resolved via `resolveCurrentTeacherId()` |

#### `publishMockTest(testId: string): Promise<ApiResponse<MockTest>>`

| Field | Type | Description |
|-------|------|-------------|
| **Purpose** | — | Transition test status from `pending_approval` → `published` |
| **Input** | `testId: string` | |
| **Success** | `{ success: true, data: MockTest }` | `publishedAt` timestamp set |
| **Failure** | `{ success: false, error: "Invalid status transition..." }` | |
| **Permission** | Teacher (RLS: owns the test) |
| **DB Tables** | `mock_tests` (UPDATE) |

#### `archiveMockTest(testId: string): Promise<ApiResponse<MockTest>>`

| Field | Type | Description |
|-------|------|-------------|
| **Purpose** | — | Transition `published` → `archived` |
| **Permission** | Teacher | |

#### `restoreMockTest(testId: string): Promise<ApiResponse<MockTest>>`

| Field | Type | Description |
|-------|------|-------------|
| **Purpose** | — | Transition `archived` → `draft` |
| **Permission** | Teacher | |

#### `deleteMockTest(testId: string): Promise<ApiResponse<void>>`

| Field | Type | Description |
|-------|------|-------------|
| **Purpose** | — | Hard delete a draft mock test |
| **Failure** | FK error if test has questions or attempts | Use `archiveMockTest()` instead |
| **Permission** | Teacher | |

### 4.4 Mock Test Question Service (`mockTestQuestionService.ts`)

#### `getMockTestQuestions(testId: string, sortBy?, sortDir?): Promise<ApiResponse<MockTestQuestion[]>>`

| Purpose | Fetch all questions assigned to a mock test |
|---------|---------|
| **Tables** | `mock_test_questions` (R) |

#### `addQuestionToMockTest(input: {...}): Promise<ApiResponse<MockTestQuestion>>`

| Purpose | Add a single question to a mock test |
|---------|---------|
| **Validation** | testId exists, question exists, question is `published`, institute match, no duplicate, max questions not exceeded |
| **Tables** | `mock_test_questions` (INSERT) |

#### `removeQuestionFromMockTest(id: string): Promise<ApiResponse<void>>`

| Purpose | Remove a question from a mock test (hard delete of junction row) |
|---------|---------|
| **Input format** | `testId::questionId` (compound) |
| **Tables** | `mock_test_questions` (DELETE) |

#### `addQuestionsToMockTest(testId: string, assignments: QuestionAssignment[], maxQuestions?): Promise<ApiResponse<MockTestQuestion[]>>`

| Purpose | Bulk add multiple questions. Validates all before inserting any. |
|---------|---------|
| **Validation** | No duplicates, institute match, all questions published, max limit |
| **Tables** | `mock_test_questions` (BULK INSERT) |

#### `replaceMockTestQuestions(testId: string, assignments: QuestionAssignment[], maxQuestions?): Promise<ApiResponse<MockTestQuestion[]>>`

| Purpose | Replace ALL questions in a test with a new set. Delete all existing + insert new. |
|---------|---------|
| **Tables** | `mock_test_questions` (DELETE ALL + BULK INSERT) |

#### `reorderMockTestQuestions(testId: string, items: ReorderItem[]): Promise<ApiResponse<MockTestQuestion[]>>`

| Purpose | Update display order for questions in a test |
|---------|---------|
| **Tables** | `mock_test_questions` (UPDATE per row) |

### 4.5 Mock Test Publish Service (`mockTestPublishService.ts`)

#### `validateMockTestReady(testId: string): Promise<ApiResponse<ValidationReport>>`

| Purpose | Runs 11 pre-publish validation checks |
|---------|---------|
| **Returns** | `{ isValid: boolean, errors: string[], warnings: string[], details: ValidationDetails }` |
| **Checks** | Test exists, status is draft/pending_approval, has questions, all questions exist, all questions published, no duplicate orders, no duplicate questions, institute match, valid availability dates, valid duration, valid total marks |

#### `publishMockTestWorkflow(testId: string): Promise<ApiResponse<PublishSummary>>`

| Purpose | Full publish workflow: validate → generate snapshots (placeholder) → transition status |
|---------|---------|
| **Returns** | `{ testId, previousStatus, newStatus: 'published', publishedAt, questionCount, totalMarks }` |

### 4.6 Mock Result Service (`mockResultService.ts`)

#### `getResults(filters?, sort?, pagination?): Promise<ApiResponse<PaginatedResponse<MockResult>>>`

| Field | Value |
|-------|-------|
| **Purpose** | Fetch paginated, filtered results. Supports filtering by testId, studentId, instituteId, isReleased, score range, rank range, percentage range, date range. |
| **Tables** | `mock_results` (R) |
| **Permission** | Teacher (RLS: sees results for own tests) |

#### `getResult(resultId: string): Promise<ApiResponse<MockResult>>`

| Purpose | Fetch a single result by its UUID |
|---------|---------|

#### `getStudentResults(studentId: string, filters?, sort?, pagination?): Promise<ApiResponse<PaginatedResponse<MockResult>>>`

| Purpose | Fetch all results for a specific student |
|---------|---------|

#### `getMockTestResults(testId: string, filters?, sort?, pagination?): Promise<ApiResponse<PaginatedResponse<MockResult>>>`

| Purpose | Fetch all results for a specific test (leaderboard data) |
|---------|---------|

#### `releaseResult(resultId: string): Promise<ApiResponse<MockResult>>`

| Purpose | Set `is_released = true`, `released_at = NOW()` |
|---------|---------|
| **Tables** | `mock_results` (UPDATE) |

#### `hideResult(resultId: string): Promise<ApiResponse<MockResult>>`

| Purpose | Set `is_released = false`, `released_at = null` |
|---------|---------|
| **Tables** | `mock_results` (UPDATE) |

### 4.7 Mock Attempt Service (`mockAttemptService.ts`)

#### `createMockAttempt(input: CreateMockAttemptInput): Promise<ApiResponse<MockAttempt>>`

| Purpose | Start a new attempt. Validates attempt limit, increments attempt number, creates attempt + pre-populates mock_answers. |
|---------|---------|
| **Tables** | `mock_attempts` (INSERT), `mock_answers` (INSERT for each question) |
| **Validation** | testId, studentId, instituteId required. Attempt limit enforced. |

#### `getMockAttempts(filters?, sort?, pagination?): Promise<ApiResponse<PaginatedResponse<MockAttempt>>>`

| Purpose | Fetch attempts with filters (testId, studentId, status, date range) |
|---------|---------|

### 4.8 Mock Evaluation Service (`mockEvaluationService.ts`)

#### `evaluateAttempt(attemptId: string): Promise<ApiResponse<MockResult>>`

| Purpose | Full scoring engine. Compares answers against question snapshots, computes scores, inserts result. |
|---------|---------|
| **Steps** | 1. Duplicate prevention → 2. Load attempt, test, questions, answers → 3. Score each answer → 4. Update mock_answers with is_correct/marks_awarded → 5. Insert mock_results |
| **Scoring** | MCQ/MSQ: compare selected option IDs against correct ones. Numerical: check within tolerance. Negative marking applied for wrong answers. |
| **Tables** | `mock_answers` (UPDATE), `mock_results` (INSERT) |

### 4.9 Notification Service (`notificationService.ts`)

#### `getNotifications(userId: string, filters?, sort?, pagination?): Promise<ApiResponse<NotificationListResult>>`

| Purpose | Fetch paginated notifications for a user (joined query with notification_recipients + notifications) |
|---------|---------|
| **Returns** | `{ notifications: Notification[], total, page, pageSize, pageCount, unreadCount }` |
| **Tables** | `notification_recipients` (R), `notifications` (R) |

#### `getNotificationDashboardStats(userId: string, instituteId?): Promise<ApiResponse<NotificationDashboardStats>>`

| Purpose | Aggregate stats: total, unread, read, today, announcements, high priority |
|---------|---------|
| **Tables** | `notification_recipients` (R), `notifications` (R) |

#### `markAllAsRead(userId: string): Promise<ApiResponse<number>>`

| Purpose | Mark all unread notifications as read for a user |
|---------|---------|
| **Tables** | `notification_recipients` (UPDATE) |

#### `createNotification(input: CreateNotificationInput): Promise<ApiResponse<Notification>>`

| Purpose | Create a single notification event + recipient rows |
|---------|---------|
| **Tables** | `notifications` (INSERT), `notification_recipients` (INSERT) |

#### `createBulkNotification(input: CreateBulkNotificationInput): Promise<ApiResponse<{ notificationId, recipientCount }>>`

| Purpose | Create one notification + bulk recipient rows (chunked inserts of 100) |
|---------|---------|
| **Tables** | `notifications` (INSERT), `notification_recipients` (BULK INSERT) |

#### `publishAnnouncement(input: PublishAnnouncementInput): Promise<ApiResponse<{ notificationId }>>`

| Purpose | Create an announcement notification event |
|---------|---------|
| **Tables** | `notifications` (INSERT) |

### 4.10 Academic Services

#### Stream Service

| Method | Purpose | Tables |
|--------|---------|--------|
| `getStreams(filters?, sort?, pagination?)` | Paginated list of streams | `streams` (R) |
| `getStreamById(streamId)` | Single stream by UUID | `streams` (R) |
| `createStream(input)` | Create new stream | `streams` (INSERT) |
| `updateStream(streamId, input)` | Update stream fields | `streams` (UPDATE) |
| `deleteStream(streamId)` | Hard delete (blocked if subjects/batches exist) | `streams` (DELETE) |

#### Subject Service

| Method | Purpose | Tables |
|--------|---------|--------|
| `getSubjects(filters?, sort?, pagination?)` | Paginated list, filterable by streamId | `subjects` (R) |
| `getSubjectById(subjectId)` | Single subject | `subjects` (R) |
| `createSubject(input)` | Create new subject | `subjects` (INSERT) |
| `updateSubject(subjectId, input)` | Update subject | `subjects` (UPDATE) |
| `deleteSubject(subjectId)` | Hard delete (blocked if chapters exist) | `subjects` (DELETE) |

#### Chapter Service

| Method | Purpose | Tables |
|--------|---------|--------|
| `getChapters(filters?, sort?, pagination?)` | Paginated list, filterable by subjectId | `chapters` (R) |
| `getChapterById(chapterId)` | Single chapter | `chapters` (R) |
| `createChapter(input)` | Create new chapter | `chapters` (INSERT) |
| `updateChapter(chapterId, input)` | Update chapter | `chapters` (UPDATE) |
| `deleteChapter(chapterId)` | Hard delete (blocked if topics exist) | `chapters` (DELETE) |

#### Topic Service

| Method | Purpose | Tables |
|--------|---------|--------|
| `getTopics(filters?, sort?, pagination?)` | Paginated list, filterable by chapterId | `topics` (R) |
| `getTopicById(topicId)` | Single topic | `topics` (R) |
| `createTopic(input)` | Create new topic | `topics` (INSERT) |
| `updateTopic(topicId, input)` | Update topic | `topics` (UPDATE) |
| `deleteTopic(topicId)` | Hard delete (blocked if content/questions exist) | `topics` (DELETE) |

### 4.11 Content Service (`contentService.ts`)

| Method | Purpose | Tables |
|--------|---------|--------|
| `getContents(filters?, sort?, pagination?)` | Paginated content list | `content` (R) |
| `getContentById(contentId)` | Single content item | `content` (R) |
| `createContent(params)` | Create + upload file to storage + insert DB row | `content` (INSERT), Storage |
| `updateContent(contentId, params)` | Update metadata + optional file replacement | `content` (UPDATE), Storage |
| `deleteContent(contentId)` | Hard delete + delete storage files | `content` (DELETE), Storage |
| `publishContent(contentId)` | Status: draft → pending_review | `content` (UPDATE) |
| `approveContent(contentId)` | Status: pending_review → approved | `content` (UPDATE) |
| `rejectContent(contentId)` | Status: pending_review → rejected | `content` (UPDATE) |
| `archiveContent(contentId)` | Status: approved → archived | `content` (UPDATE) |
| `restoreContent(contentId)` | Status: archived → draft | `content` (UPDATE) |

### 4.12 Tag Service (`tagService.ts`)

| Method | Purpose | Tables |
|--------|---------|--------|
| `getTags(filters?, sort?, pagination?)` | Paginated tag list | `tags` (R) |
| `createTag(input)` | Create tag (lowercased) | `tags` (INSERT) |
| `updateTag(tagId, input)` | Update tag name | `tags` (UPDATE) |
| `deleteTag(tagId)` | Hard delete (cascade removes content_tag rows) | `tags` (DELETE) |
| `attachTag(contentId, tagId)` | Attach tag to content | `content_tag` (INSERT) |
| `detachTag(contentId, tagId)` | Remove tag from content | `content_tag` (DELETE) |
| `replaceTags(contentId, tagIds)` | Replace all tags on content | `content_tag` (DELETE ALL + INSERT) |
| `getContentTags(contentId)` | Get all tags for a content item | `content_tag` + `tags` (R) |

### 4.13 Approval Service (`approvalService.ts`)

| Method | Purpose | Tables |
|--------|---------|--------|
| `getApprovalRequests(filters?, sort?, pagination?)` | Paginated list | `approval_requests` (R) |
| `createApprovalRequest(params)` | Create request + transition content to pending_review | `approval_requests` (INSERT), `content` (UPDATE) |
| `assignReviewer(approvalId, reviewerId)` | Assign admin reviewer | `approval_requests` (UPDATE) |
| `approveRequest(params)` | Approve + transition content to approved | `approval_requests` (UPDATE), `content` (UPDATE) |
| `rejectRequest(params)` | Reject + transition content to rejected | `approval_requests` (UPDATE), `content` (UPDATE) |
| `cancelRequest(approvalId)` | Delete pending request + revert content to draft | `approval_requests` (DELETE), `content` (UPDATE) |

### 4.14 Storage Service (`storageService.ts`)

| Method | Purpose | Buckets |
|--------|---------|---------|
| `uploadFile(params)` | Content-type-based upload (backward compatible) | Determined by content type |
| `uploadResource(params)` | Resource-type-based upload (generalised) | Determined by resource config |
| `deleteFile(bucket, paths)` | Delete one or more files | Any |
| `replaceFile(params, oldBucket, oldPath)` | Delete old + upload new | Any |
| `generateSignedUrl(params)` | Generate temporary download URL | Any |
| `fileExists(bucket, path)` | Check if file exists | Any |
| `uploadThumbnail(file, instituteId, contentId)` | Upload thumbnail to public bucket | `content-thumbnails` |
| `deleteThumbnail(instituteId, contentId)` | Delete thumbnail | `content-thumbnails` |

### 4.15 Profile Service (`profileService.ts`)

| Method | Purpose | Tables |
|--------|---------|--------|
| `getFullTeacherProfile(teacherId)` | Fetch complete profile (profile + teacher_details) | `profiles` (R), `teacher_details` (R) |
| `updatePersonalInfo(teacherId, data)` | Update name, email, phone, bio | `profiles` (UPDATE), `teacher_details` (UPDATE) |
| `updateProfessionalInfo(teacherId, data)` | Update qualification, experience, specialization | `teacher_details` (UPDATE) |
| `uploadAvatar(teacherId, file)` | Upload profile photo to storage | Storage + `profiles` (UPDATE avatar_url) |
| `getActivityTimeline(teacherId)` | Aggregate activity from multiple tables | `mock_tests`, `questions`, `notifications`, `teacher_details` (R) |
| `getNotificationPreferences(teacherId)` | Read notification preferences from localStorage | None (localStorage) |
| `updateNotificationPreferences(teacherId, prefs)` | Save notification preferences | None (localStorage) |

### 4.16 Settings Service (`settingsService.ts`)

| Method | Purpose | Storage |
|--------|---------|---------|
| `getSettings()` | Load settings from localStorage | `localStorage` key `teacher_settings` |
| `updateSettings(settings)` | Save settings to localStorage | `localStorage` |
| `applyTheme(theme)` | Apply theme to DOM (light/dark/system class) | DOM `<html>` element |
| `initializeTheme()` | Apply saved theme on page load, listen for system changes | DOM + `matchMedia` |
| `clearAllLocalData()` | Clear all localStorage keys | `localStorage` |

---

## 5. Database Mapping

### 5.1 Question Domain

| Service | Reads | Writes |
|---------|-------|--------|
| **Question Service** | `questions`, `subjects`, `chapters` | `questions` |
| **Question Option Service** | `question_options`, `questions` | `question_options` |
| **Question Explanation Service** | `question_explanations`, `questions` | `question_explanations` |
| **Question Image Service** | `question_images`, `questions` | `question_images` |

### 5.2 Mock Test Domain

| Service | Reads | Writes |
|---------|-------|--------|
| **Mock Test Service** | `mock_tests` | `mock_tests` |
| **Mock Test Question Service** | `mock_test_questions`, `mock_tests`, `questions` | `mock_test_questions` |
| **Mock Test Publish Service** | `mock_tests`, `mock_test_questions`, `questions`, `mock_attempts` | `mock_tests` |
| **Mock Attempt Service** | `mock_attempts`, `mock_answers`, `mock_answer_options`, `mock_results` | `mock_attempts`, `mock_answers`, `mock_answer_options` |
| **Mock Result Service** | `mock_results` | `mock_results` |
| **Mock Evaluation Service** | `mock_attempts`, `mock_tests`, `mock_test_questions`, `mock_answers`, `mock_answer_options` | `mock_answers`, `mock_results` |

### 5.3 Teacher Domain

| Service | Reads | Writes |
|---------|-------|--------|
| **Teacher Service** | `batch_teachers`, `batches`, `batch_students`, `student_details`, `profiles`, `teacher_details`, `teacher_analytics`, `live_classes`, `live_class_batch`, `live_sessions`, `session_participants`, `teacher_employment_records`, `teacher_bank_details`, `teacher_qualifications`, `teacher_experiences`, `teacher_documents`, `teacher_leave_requests`, `teacher_specializations` | `student_doubts`, `live_classes`, `live_sessions`, `session_participants`, `teacher_leave_requests`, `teacher_availability` |

### 5.4 Notification Domain

| Service | Reads | Writes |
|---------|-------|--------|
| **Notification Service** | `notifications`, `notification_recipients` | `notifications`, `notification_recipients` |

### 5.5 Academic Domain

| Service | Reads | Writes |
|---------|-------|--------|
| **Stream Service** | `streams` | `streams` |
| **Subject Service** | `subjects` | `subjects` |
| **Chapter Service** | `chapters` | `chapters` |
| **Topic Service** | `topics` | `topics` |

### 5.6 Content Domain

| Service | Reads | Writes |
|---------|-------|--------|
| **Content Service** | `content`, `chapters` | `content`, Storage |
| **Tag Service** | `tags`, `content_tag` | `tags`, `content_tag` |
| **Approval Service** | `approval_requests`, `content` | `approval_requests`, `content` |
| **Storage Service** | Storage API (no tables) | Storage buckets |

### 5.7 Auth Domain

| Service | Reads | Writes |
|---------|-------|--------|
| **Auth Service** | `profiles` | Auth API (users table)
 | |

---

## 6. Permission Matrix

### 6.1 Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Full access (SELECT, INSERT, UPDATE, DELETE) |
| ✅* | Full access to own resources only (RLS enforced) |
| 👁 | Read-only access |
| 👁* | Read-only to own resources or batch-assigned resources |
| ❌ | No access (blocked by RLS) |
| N/A | Not applicable / feature not built |

### 6.2 Permission Matrix

| Method | Teacher | Student | Admin | Notes |
|--------|---------|---------|-------|-------|
| **Auth: signIn** | ✅ Public | ✅ Public | ✅ Public | Unauthenticated |
| **Auth: signUp** | ✅ Public | ✅ Public | ✅ Public | Unauthenticated |
| **Auth: verifyOtp** | ✅ Public | ✅ Public | ✅ Public | Unauthenticated |
| **Auth: updatePassword** | ✅ | ✅ | ✅ | Authenticated only |
| **Teacher: getAssignedBatches** | ✅* | ❌ | 👁 | Own batches |
| **Teacher: getStudentRoster** | ✅* | ❌ | 👁 | Own batches only |
| **Teacher: getTeacherOverviewData** | ✅* | ❌ | 👁 | Own data |
| **Question: createQuestion** | ✅* | ❌ | ✅ | Own institute |
| **Question: updateQuestion** | ✅* | ❌ | ✅ | Own questions only |
| **Question: deleteQuestion** | ✅* (unused) | ❌ | ✅ | Only if `timesAttempted = 0` |
| **Question: publishQuestion** | ✅* | ❌ | ✅ | Own published: pending_approval |
| **Question: archiveQuestion** | ✅* | ❌ | ✅ | Own questions |
| **MockTest: createMockTest** | ✅* | ❌ | ✅ | Own institute |
| **MockTest: publishMockTest** | ✅* | ❌ | ✅ | Own tests |
| **MockTest: archiveMockTest** | ✅* | ❌ | ✅ | Own tests |
| **MockTest: deleteMockTest** | ✅* (draft) | ❌ | ✅ | Own draft tests |
| **MockTestQuestion: add** | ✅* | ❌ | ✅ | Own draft tests |
| **MockTestQuestion: remove** | ✅* | ❌ | ✅ | Own draft tests |
| **MockTestQuestion: reorder** | ✅* | ❌ | ✅ | Own draft tests |
| **MockAttempt: create** | ❌ | ✅ | ✅ | Student only |
| **MockAttempt: view** | 👁* | ✅* | 👁 | Own tests (teacher), own attempts (student) |
| **MockResult: view** | 👁* | 👁* | 👁 | Own tests (teacher), own results (student) |
| **MockResult: release** | ✅* | ❌ | ✅ | Own tests' results |
| **Notification: view** | 👁* | 👁* | 👁 | Own notifications only |
| **Notification: create** | ❌ (RLS) | ❌ | ✅ | RLS blocks teacher INSERT |
| **Notification: markRead** | ✅* | ✅* | ✅ | Own notifications |
| **Stream: view** | 👁 | 👁 | 👁 | Institute-scoped |
| **Subject: view** | 👁 | 👁 | 👁 | Institute-scoped |
| **Chapter: view** | 👁 | 👁 | 👁 | Institute-scoped |
| **Topic: view** | 👁 | 👁 | 👁 | Institute-scoped |
| **Content: create** | ✅* | ❌ | ✅ | Own content |
| **Content: view** | ✅* | ✅* | 👁 | Teacher: own, Student: approved |
| **Content: approve** | ❌ | ❌ | ✅ | Admin only |
| **Approval: create** | ✅* | ❌ | ✅ | Teacher: submit own content |
| **Approval: approve/reject** | ❌ | ❌ | ✅ | Admin only |
| **Profile: view/update** | ✅* | ✅* | ✅ | Own profile |
| **Settings: read/write** | ✅ | ✅ | ✅ | localStorage only |

---

## 7. Error Contract

### 7.1 Standardised Error Codes

| Error Type | HTTP Equiv | Service Origin | Example Message |
|------------|------------|---------------|-----------------|
| **VALIDATION_ERROR** | 400 | All services | "Title is required." |
| **UUID_INVALID** | 400 | `utils/supabase.ts` | "Invalid UUID format for field: testId" |
| **NOT_FOUND** | 404 | All services | "Mock test not found: {id}" |
| **NOT_FOUND_PGRST** | 404 | Supabase (PGRST116) | "The result contains 0 rows" |
| **FORBIDDEN** | 403 | Supabase RLS | "new row violates row-level security policy" |
| **FK_VIOLATION** | 409 | Supabase (23503) | "Cannot create attempt. The referenced test or student does not exist." |
| **UNIQUE_VIOLATION** | 409 | Supabase (23505) | "A tag named \"physics\" already exists in this institute." |
| **CHECK_VIOLATION** | 409 | Supabase (23514) | "A database constraint was violated. Ensure orderSequence >= 1 and marks > 0." |
| **INVALID_TRANSITION** | 409 | Service layer | "Invalid status transition: \"draft\" → \"published\". Allowed: pending_approval, archived" |
| **NETWORK_ERROR** | 0 | Supabase client | "Failed to fetch" |
| **STORAGE_PERMISSION** | 403 | Storage service | "Permission denied. You do not have access to this storage resource." |
| **STORAGE_NOT_FOUND** | 404 | Storage service | "The requested file was not found in storage." |
| **STORAGE_CONFLICT** | 409 | Storage service | "A file with the same name already exists in storage." |
| **STORAGE_TOO_LARGE** | 413 | Storage service | "The file exceeds the maximum allowed size." |
| **MIME_INVALID** | 400 | Storage validation | "MIME type \"text/plain\" is not allowed for content type pdf." |
| **FILE_SIZE_EXCEEDED** | 400 | Storage validation | "File size 15000000 bytes exceeds maximum of 10485760 bytes." |

### 7.2 Error Handling Flow

```
Service Method
    │
    ├── Success → { success: true, data: T }
    │
    └── Error
         │
         ├── Validation error (client-side)
         │   └── { success: false, error: "Title is required." }
         │
         ├── Supabase error (database)
         │   └── extractErrorMessage() → human-readable string
         │
         ├── Network error
         │   └── { success: false, error: "Failed to fetch" }
         │
         └── Unexpected error
             └── { success: false, error: "An unexpected authentication error occurred." }
```

### 7.3 Expected UI Behaviour per Error

| Error | UI Behaviour | Recovery |
|-------|-------------|----------|
| **Validation Error** | Red border on field + error message below | User corrects input and resubmits |
| **Not Found** | "Not found" empty state or inline error | Navigate back to list |
| **Forbidden (RLS)** | "You don't have permission" message | Contact admin |
| **Network Error** | Error banner with retry button | Retry or check connection |
| **FK Violation** | Descriptive error message | Fix referenced entity |
| **Unique Violation** | "Already exists" message | Use different name/value |
| **Invalid Transition** | Informational error | Follow correct workflow order |
| **Storage Error** | "Upload failed" message with reason | Retry or use different file |

---

## 8. Validation Rules

### 8.1 Authentication

| Field | Rule | Error Message |
|-------|------|---------------|
| Phone | Required, pattern: `^\+[1-9]\d{6,14}$` | "Please enter a valid mobile number with country code (e.g. +919876543210)" |
| Password (sign-up) | Required, min 6 chars | "Password must be at least 6 characters" |
| Password (sign-in) | Required | "Password is required" |
| Name | Required | "Full name is required" |
| OTP Token | Required, 4-8 chars | "Please enter a valid OTP" |

### 8.2 Questions

| Field | Rule | Error Message |
|-------|------|---------------|
| subjectId | Required, valid UUID | "Subject is required" |
| chapterId | Required, valid UUID | "Chapter is required" |
| questionType | Required, enum: mcq/msq/numerical/true_false | "Question type is required" |
| difficulty | Required, enum: easy/medium/hard | "Difficulty is required" |
| questionText | Required, min 10 chars | "Question text must be at least 10 characters" |
| marks | Required, > 0 | "Marks must be greater than 0" |
| negativeMarks | Optional, >= 0 | "Negative marks cannot be negative" |
| Options (non-numerical) | At least 2 non-empty | "At least 2 non-empty options required" |
| Correct option (MCQ/TF) | Exactly 1 | "MCQ questions must have exactly one correct answer" |
| Correct options (MSQ) | At least 1 | "At least one option must be marked as correct" |
| Numerical answer | Required when type=numerical | "Correct numerical answer is required" |
| instituteId | Required, valid UUID | — |
| createdBy | Required (resolved server-side) | — |

### 8.3 Mock Tests

| Field | Rule | Error Message |
|-------|------|---------------|
| Title | Required, min 3 chars | "Title must be at least 3 characters" |
| Description | Optional | — |
| Stream | Required, valid UUID | "Stream is required" |
| Duration | Required, 1-600 | "Duration must be greater than 0" / max 600 |
| Total Marks | Required, > 0 | "Total marks must be greater than 0" |
| Passing Marks | Optional, ≤ total marks | "Passing marks cannot exceed total marks" |
| Negative Marking | Optional, >= 0, ≤ total marks | "Negative marking cannot exceed total marks" |
| Attempt Limit | Optional, ≥ 1 when set | "Attempt limit must be at least 1" |
| Result Release (scheduled) | Required when mode=scheduled | "Release date is required for scheduled release" |
| Available Date Range | availableFrom < availableUntil | "End date must be after start date" |

### 8.4 Mock Test Questions

| Field | Rule | Error Message |
|-------|------|---------------|
| questionId | Valid UUID | — |
| orderSequence | Required, integer >= 1 | "orderSequence must be a positive integer >= 1" |
| marks | Optional, > 0 when provided | "marks must be greater than 0" |
| negativeMarksOverride | Optional, >= 0 when set | "negativeMarksOverride cannot be negative" |
| Duplicate questions | No duplicate questionId in same test | "This question is already assigned to the mock test" |
| Max questions | ≤ 200 (configurable) | "Maximum question limit reached" |

### 8.5 Results

| Field | Rule |
|-------|------|
| Release | Any result can be released. No validation beyond existence. |
| Hide | Any released result can be hidden. No validation beyond existence. |

### 8.6 Notifications

| Field | Rule | Error Message |
|-------|------|---------------|
| Title | Required, min 3 chars | "Title is required" / min 3 chars |
| Message (body) | Required, min 10 chars | "Body is required" / min 10 chars |
| Institute ID | Required | "instituteId is required" |
| Recipients (bulk) | At least 1 | "At least one recipient is required" |

### 8.7 Content

| Field | Rule | Error Message |
|-------|------|---------------|
| Title | Required, min 3 chars | "Title is required" / "Title cannot be empty" |
| File | Required (create) | "File is required." |
| instituteId | Required, valid UUID | — |
| teacherId | Required, valid UUID | — |
| chapterId | Required, valid UUID | — |

### 8.8 Tags

| Field | Rule | Error Message |
|-------|------|---------------|
| Name | Required, lowercase | "Tag name is required" |
| Duplicate | Unique per institute | "A tag named \"...\" already exists in this institute" |

### 8.9 Storage

| Resource Type | Allowed MIME Types | Max Size |
|---------------|-------------------|----------|
| PDF content | `application/pdf` | 50 MB |
| Video content | `video/mp4`, `video/webm` | 500 MB |
| Notes content | `application/pdf`, `application/msword` | 50 MB |
| Assignment content | `application/pdf`, `application/msword` | 50 MB |
| Question images | `image/jpeg`, `image/png`, `image/webp` | 10 MB |
| Profile avatars | `image/jpeg`, `image/png`, `image/webp` | 5 MB |
| Thumbnails | `image/jpeg`, `image/png`, `image/webp` | 10 MB |

---

## 9. React Query Cache Strategy

### 9.1 Cache Configuration

| Query Group | Cache Key Pattern | staleTime | gcTime | Refetch On Window Focus | Refetch On Reconnect |
|-------------|------------------|-----------|--------|------------------------|----------------------|
| Questions | `['questions', ...filters, sort, pagination]` | 30,000ms | 5 min | Yes | Yes |
| Single Question | `['questions', questionId]` | 30,000ms | 5 min | Yes | Yes |
| Mock Tests | `['mockTests', ...filters, sort, pagination]` | 30,000ms | 5 min | Yes | Yes |
| Single Mock Test | `['mockTests', testId]` | 30,000ms | 5 min | Yes | Yes |
| Test Questions | `['mockTestQuestions', testId]` | 30,000ms | 5 min | Yes | Yes |
| Results | `['mockResults', ...filters, sort, pagination]` | 30,000ms | 5 min | Yes | Yes |
| Single Result | `['mockResults', resultId]` | 30,000ms | 5 min | Yes | Yes |
| Student Results | `['mockResults', 'student', studentId]` | 30,000ms | 5 min | Yes | Yes |
| Attempts | `['mockAttempts', ...filters, sort, pagination]` | 30,000ms | 5 min | Yes | Yes |
| Notifications | `['notifications', userId, ...filters, sort, pagination]` | 10,000ms | 5 min | Yes | Yes |
| Notification Dashboard | `['notifications', 'dashboard', userId]` | 10,000ms | 5 min | Yes | Yes |
| Streams | `['streams', ...filters, sort, pagination]` | 5 min | 30 min | No | Yes |
| Subjects | `['subjects', ...filters, sort, pagination]` | 5 min | 30 min | No | Yes |
| Chapters | `['chapters', ...filters, sort, pagination]` | 5 min | 30 min | No | Yes |
| Topics | `['topics', ...filters, sort, pagination]` | 5 min | 30 min | No | Yes |
| Batches | `['batches', ...filters, sort, pagination]` | 30,000ms | 5 min | Yes | Yes |
| Teacher Overview | `['teacher', 'overview', teacherId]` | 30,000ms | 5 min | Yes | Yes |
| Teacher Analytics | `['analytics', 'teacher', teacherId]` | 60,000ms | 5 min | Yes | Yes |
| Student Analytics | `['analytics', 'student', studentId]` | 60,000ms | 5 min | Yes | Yes |
| Mock Test Analytics | `['analytics', 'mockTest', testId]` | 60,000ms | 5 min | Yes | Yes |
| Subject Analytics | `['analytics', 'subjects', ...filters]` | 60,000ms | 5 min | Yes | Yes |
| Chapter Analytics | `['analytics', 'chapters', ...filters]` | 60,000ms | 5 min | Yes | Yes |
| Trends | `['analytics', 'trends', ...filters]` | 60,000ms | 5 min | Yes | Yes |
| Leaderboard | `['analytics', 'leaderboard', ...filters]` | 60,000ms | 5 min | Yes | Yes |
| Insights | `['analytics', 'insights']` | 60,000ms | 5 min | Yes | Yes |

### 9.2 Mutation Invalidation Map

| Mutation | Invalidates |
|----------|-------------|
| `useCreateQuestion` | `['questions']` |
| `useUpdateQuestion` | `['questions']` |
| `useDeleteQuestion` | `['questions']` |
| `usePublishQuestion` | `['questions']` |
| `useArchiveQuestion` | `['questions']` |
| `useRestoreQuestion` | `['questions']` |
| `useCreateMockTest` | `['mockTests']` |
| `useUpdateMockTest` | `['mockTests']` |
| `useDeleteMockTest` | `['mockTests']` |
| `usePublishMockTest` | `['mockTests']` |
| `useArchiveMockTest` | `['mockTests']` |
| `useRestoreMockTest` | `['mockTests']` |
| `useAddQuestionsToTest` | `['mockTestQuestions', testId]` |
| `useRemoveQuestionFromTest` | `['mockTestQuestions', testId]` |
| `useReorderQuestions` | `['mockTestQuestions', testId]` |
| `useReleaseResult` | `['mockResults']` |
| `useHideResult` | `['mockResults']` |
| `useCreateNotification` | `['notifications']` |
| `useMarkAllAsRead` | `['notifications']` |
| `usePublishAnnouncement` | `['notifications']` |

### 9.3 Cache Invalidation Notes

- All mutations invalidate the **entire query group** (e.g., `['questions']`), not specific pages. This ensures lists refetch with fresh data after any mutation.
- Analytics queries use a separate prefix (`['analytics', ...]`) and are **not** invalidated by data mutations. Analytics may show stale data until their `staleTime` (60s) expires. This is intentional — analytics are expensive to compute.
- Academic structure queries (streams, subjects, chapters, topics) have a **5-minute stale time** because this data changes infrequently. They are not invalidated by any mutation.
- The `enabled` option is used extensively: queries only fire when the required parameters (e.g., `teacherId`, `testId`) are truthy.

---

## 10. File Upload Contracts

### 10.1 Avatar Upload

| Property | Value |
|----------|-------|
| **Service** | `profileService.uploadAvatar()` |
| **Storage Bucket** | `profile-images` (from config) |
| **Path Template** | `{instituteId}/{teacherId}/{sanitizedFileName}` |
| **Allowed MIME Types** | `image/jpeg`, `image/png`, `image/webp` |
| **Max File Size** | 5 MB |
| **Signed URL** | Generated dynamically when displaying |
| **Validation** | MIME type check, file size check |
| **Error Handling** | Returns `ApiResponse<UploadResult>` with structured error |

### 10.2 Question Image Upload

| Property | Value |
|----------|-------|
| **Service** | `questionImageService.createQuestionImage()` (DB record) + `storageService.uploadResource()` (file) |
| **Storage Bucket** | `question-images` (from config) |
| **Path Template** | `{instituteId}/{questionId}/{imageId}.{ext}` |
| **Allowed MIME Types** | `image/jpeg`, `image/png`, `image/webp` |
| **Max File Size** | 10 MB |
| **Image Roles** | `stem`, `option_a`–`option_d`, `explanation` |
| **Alt Text** | Required for WCAG compliance (nullable in DB) |

### 10.3 Content File Upload

| Property | Value |
|----------|-------|
| **Service** | `contentService.createContent()` → `storageService.uploadFile()` |
| **Buckets** | Determined by content type (pdf, video, notes, assignment) |
| **Path Template** | `institutes/{instituteId}/content/{contentId}/{sanitizedFileName}` |
| **Allowed MIME Types** | Per content type (see validation rules section) |
| **Max File Size** | Per content type (50 MB PDF, 500 MB video, etc.) |

### 10.4 Thumbnail Upload

| Property | Value |
|----------|-------|
| **Service** | `storageService.uploadThumbnail()` |
| **Storage Bucket** | `content-thumbnails` (public bucket) |
| **Path Template** | `{instituteId}/{contentId}` |
| **Allowed MIME Types** | `image/jpeg`, `image/png`, `image/webp` |
| **Max File Size** | 10 MB |
| **Upsert** | Yes (can replace existing thumbnail) |

### 10.5 General Upload Architecture

```
Upload Flow:
  1. Caller provides file + metadata
  2. storageService.extractFileMetadata() → ArrayBuffer + metadata
  3. Validation: MIME type, extension, file size (via config)
  4. Determine destination: bucket + path (via config templates)
  5. Upload with retry: supabase.storage.from(bucket).upload(path, bytes)
  6. On transient error (5xx, network): retry with exponential backoff
  7. On success: return UploadResult { bucket, storagePath, fileSize, mimeType }
  8. Caller stores bucket/path in database row

Retry Strategy:
  - Max retries: 3 (configurable)
  - Delay: 1000ms, 2000ms, 4000ms (capped at 10000ms)
  - Only retries: 5xx server errors, 429 rate limits, network errors
  - Does NOT retry: 403, 404, 409, 413 (client errors)
```

---

## 11. Authentication Contracts

### 11.1 Login Flow

```
[User]             [LoginView]            [useAuth]              [authService]           [Supabase]            [Profiles Table]
  │                     │                     │                      │                      │                      │
  │  Enter phone+pwd    │                     │                      │                      │                      │
  │────────────────────>│                     │                      │                      │                      │
  │                     │  login(phone, pwd)  │                      │                      │                      │
  │                     │────────────────────>│                      │                      │                      │
  │                     │                     │  signIn({phone,pwd}) │                      │                      │
  │                     │                     │─────────────────────>│                      │                      │
  │                     │                     │                      │  signInWithPassword() │                      │
  │                     │                     │                      │─────────────────────>│                      │
  │                     │                     │                      │                      │                      │
  │                     │                     │                      │  ┌─ On error ─────────┤                      │
  │                     │                     │                      │  │ Check demo mode    │                      │
  │                     │                     │                      │  │ Fallback to mock   │                      │
  │                     │                     │                      │  └────────────────────│                      │
  │                     │                     │                      │                      │                      │
  │                     │                     │                      │  ┌─ On success ───────┤                      │
  │                     │                     │                      │  │ Fetch profile      │─────────────────────>│
  │                     │                     │                      │  │                    │                      │
  │                     │                     │                      │  │<─ UserProfile ─────│<─────────────────────│
  │                     │                     │                      │<─ AuthResponse ──────│                      │
  │                     │                     │                      │                      │                      │
  │                     │                     │<─ AuthHookResult ────│                      │                      │
  │                     │                     │                      │                      │                      │
  │                     │  Show dashboard     │                      │                      │                      │
  │                     │<────────────────────│                      │                      │                      │
  │<─ Redirect to /teacher                     │                      │                      │                      │
```

### 11.2 Registration + OTP Flow

```
[User]           [RegisterForm]         [useAuth]           [authService]          [Supabase Auth]         [Profiles Trigger]
  │                    │                    │                     │                      │                      │
  │ Fill phone+pwd+name│                    │                     │                      │                      │
  │───────────────────>│                    │                     │                      │                      │
  │                    │ register(phone,    │                     │                      │                      │
  │                    │   pwd, name)       │                     │                      │                      │
  │                    │───────────────────>│                     │                      │                      │
  │                    │                    │  signUp(input)      │                      │                      │
  │                    │                    │────────────────────>│                      │                      │
  │                    │                    │                     │  auth.signUp()       │                      │
  │                    │                    │                     │─────────────────────>│                      │
  │                    │                    │                     │                      │  SMS OTP sent        │
  │                    │                    │                     │<─ AuthResponse ──────│                      │
  │                    │                    │<─ {success, phone}  │                      │                      │
  │                    │                    │                     │                      │                      │
  │  Show OTP screen   │                    │                     │                      │                      │
  │<───────────────────│                    │                     │                      │                      │
  │                    │                    │                     │                      │                      │
  │ Enter OTP token    │                    │                     │                      │                      │
  │───────────────────>│                    │                     │                      │                      │
  │                    │ verifyOtp(phone,   │                     │                      │                      │
  │                    │   token)           │                     │                      │                      │
  │                    │───────────────────>│                     │                      │                      │
  │                    │                    │  verifyOtp(input)   │                      │                      │
  │                    │                    │────────────────────>│                      │                      │
  │                    │                    │                     │  auth.verifyOtp()    │                      │
  │                    │                    │                     │─────────────────────>│                      │
  │                    │                    │                     │                      │                      │
  │                    │                    │                     │  Fetch profile       │───────────┬──────────>│
  │                    │                    │                     │                      │           │          │
  │                    │                    │                     │<─ UserProfile ───────│<──────────┴──────────│
  │                    │                    │<─ AuthHookResult ───│                      │                      │
  │                    │                    │                     │                      │                      │
  │                    │  Redirect to       │                     │                      │                      │
  │                    │  dashboard         │                     │                      │                      │
  │<───────────────────│                    │                     │                      │                      │
```

### 11.3 Session Management

| Phase | Action | Description |
|-------|--------|-------------|
| **App Initialization** | `getSession()` | Check cached session on app load |
| **Auth Check** | `getCurrentUser()` | Server-verified auth status (network request) |
| **Token Refresh** | `refreshSession()` | Force-refresh tokens on 401 |
| **Logout** | `signOut()` | Clear session + invalidate refresh token |
| **Session Recovery** | Auto | Supabase client auto-refreshes tokens |

### 11.4 Role Resolution

```
auth.users (id, email, phone)
    │
    ▼ (database trigger: on_auth_user_created)
profiles (profile_id, name, role, institute_id)
    │
    ├── role = 'teacher'
    │      ▼
    │   teacher_details (teacher_id, profile_id, specialization)
    │      │
    │      ▼
    │   Resolved: UserProfile.role = 'teacher'
    │             Teacher loaded via teacherService
    │
    └── role = 'student'
           ▼
        student_details (student_id, profile_id)
           │
           ▼
        Resolved: UserProfile.role = 'student'
```

---

## 12. Module Dependency Diagram

### 12.1 Module Dependencies

```
                    ┌──────────────────┐
                    │  Authentication  │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
               ┌───│    Dashboard     │◄─────────────────────┐
               │   └────────┬─────────┘                      │
               │            │                                │
               │            ▼                                │
               │   ┌──────────────────┐                      │
               │   │  Question Bank   │                      │
               │   └────────┬─────────┘                      │
               │            │                                │
               │            ▼                                │
               │   ┌──────────────────┐                      │
               │   │   Mock Tests     │                      │
               │   └────────┬─────────┘                      │
               │            │                                │
               │            ├──────────────────┐             │
               │            ▼                  ▼             │
               │   ┌──────────────────┐  ┌──────────┐       │
               │   │    Results       │  │ Students │       │
               │   └────────┬─────────┘  └────┬─────┘       │
               │            │                  │             │
               │            ▼                  ▼             │
               │   ┌──────────────────┐  ┌──────────┐       │
               │   │  Notifications   │  │Analytics │       │
               │   └────────┬─────────┘  └────┬─────┘       │
               │            │                  │             │
               │            ▼                  ▼             │
               │   ┌──────────────────┐  ┌──────────┐       │
               │   │    Profile       │  │ Settings │       │
               │   └────────┬─────────┘  └──────────┘       │
               │            │                               │
               └────────────┘                               │
                          (sidebar/header navigation)        │
                             ▲                               │
                             └───────────────────────────────┘
                                    (uses teacherService for
                                     batches + students data)
```

### 12.2 Service Dependencies

```
                    ┌──────────────────────┐
                    │   authService.ts     │
                    └──────────────────────┘
                             │
                             ▼
     ┌─────────────────────────────────────────────┐
     │             teacherService.ts                │
     │  (batches, students, overview, live class)   │
     └────────┬────────────────────────┬────────────┘
              │                        │
              ▼                        ▼
 ┌──────────────────────┐  ┌──────────────────────┐
 │  questionService.ts  │  │  mockTestService.ts  │
 │  (questions CRUD)    │  │  (mock tests CRUD)   │
 └──────────────────────┘  └──────────┬───────────┘
              │                       │
              ▼                       ▼
 ┌──────────────────────┐  ┌──────────────────────┐
 │  questionOption.ts   │  │ mockTestQuestion.ts  │
 │  questionExplain.ts  │  │ (junction management) │
 │  questionImage.ts    │  └──────────┬───────────┘
 └──────────────────────┘             │
                                      ▼
                             ┌──────────────────────┐
                             │mockTestPublishService│
                             │ (validation + publish)│
                             └──────────────────────┘
                                      │
                                      ▼
 ┌──────────────────────┐  ┌──────────────────────┐
 │  mockAttemptService  │  │  mockResultService   │
 │  (attempts, answers) │  │  (results CRUD)      │
 └──────────┬───────────┘  └──────────────────────┘
            │
            ▼
 ┌──────────────────────┐
 │mockEvaluationService │
 │ (scoring engine)     │
 └──────────────────────┘

 ┌──────────────────────┐  ┌──────────────────────┐
 │  notificationService │  │   storageService.ts  │
 │  (notification CRUD)  │  │   (file operations)  │
 └──────────────────────┘  └──────────┬───────────┘
                                      │
                                      ▼
 ┌──────────────────────┐  ┌──────────────────────┐
 │  contentService.ts   │  │   tagService.ts      │
 │  (content management) │  │   (tags CRUD)        │
 └──────────┬───────────┘  └──────────────────────┘
            │
            ▼
 ┌──────────────────────┐
 │  approvalService.ts  │
 │  (approval workflow)  │
 └──────────────────────┘

 ┌──────────────────────┐  ┌──────────────────────┐
 │  streamService.ts    │  │   subjectService.ts  │
 │  (streams CRUD)      │  │   (subjects CRUD)    │
 └──────────────────────┘  └──────────┬───────────┘
                                      │
                                      ▼
                      ┌──────────────────────┐      ┌──────────────────────┐
                      │  chapterService.ts   │─────▶│   topicService.ts    │
                      │  (chapters CRUD)     │      │   (topics CRUD)      │
                      └──────────────────────┘      └──────────────────────┘

 ┌──────────────────────┐  ┌──────────────────────┐
 │  profileService.ts   │  │   settingsService.ts │
 │  (profile CRUD)      │  │   (localStorage prefs)│
 └──────────────────────┘  └──────────────────────┘
```

---

## 13. Sequence Diagrams

### 13.1 Teacher Creates Question

```
[Teacher]        [CreateQuestionPage]     [useCreateQuestion]     [questionService]      [teacherResolver]      [Supabase]
    │                     │                       │                      │                      │                    │
    │  Fill form          │                       │                      │                      │                    │
    │────────────────────>│                       │                      │                      │                    │
    │                     │                       │                      │                      │                    │
    │  Click Save         │                       │                      │                      │                    │
    │────────────────────>│                       │                      │                      │                    │
    │                     │  validate()           │                      │                      │                    │
    │                     │  (client-side)        │                      │                      │                    │
    │                     │                       │                      │                      │                    │
    │                     │  createQuestion(data) │                      │                      │                    │
    │                     │──────────────────────>│                      │                      │                    │
    │                     │                       │                      │                      │                    │
    │                     │                       │  createQuestion()    │                      │                    │
    │                     │                       │─────────────────────>│                      │                    │
    │                     │                       │                      │                      │                    │
    │                     │                       │                      │ resolveCurrent       │                    │
    │                     │                       │                      │ TeacherId()          │                    │
    │                     │                       │                      │─────────────────────>│                    │
    │                     │                       │                      │                      │                    │
    │                     │                       │                      │  teacher_details     │                    │
    │                     │                       │                      │<─────────────────────│                    │
    │                     │                       │                      │                      │                    │
    │                     │                       │                      │  INSERT questions    │                    │
    │                     │                       │                      │──────────────────────────────────────────>│
    │                     │                       │                      │                      │                    │
    │                     │                       │                      │<─ Question ──────────│<───────────────────│
    │                     │                       │                      │                      │                    │
    │                     │                       │<─ ApiResponse ───────│                      │                    │
    │                     │                       │                      │                      │                    │
    │                     │  Redirect to edit     │                      │                      │                    │
    │                     │<──────────────────────│                      │                      │                    │
    │                     │                       │                      │                      │                    │
    │<─ See edit page ────│                       │                      │                      │                    │
```

### 13.2 Teacher Publishes Mock Test

```
[Teacher]        [PublishPage]         [useMockTestPublish]    [mockTestPublishSvc]     [mockTestService]      [Supabase]
    │                   │                       │                      │                      │                    │
    │  Click Publish    │                       │                      │                      │                    │
    │──────────────────>│                       │                      │                      │                    │
    │                   │  publishWorkflow(id)  │                      │                      │                    │
    │                   │──────────────────────>│                      │                      │                    │
    │                   │                       │                      │                      │                    │
    │                   │                       │  validateReady(id)   │                      │                    │
    │                   │                       │─────────────────────>│                      │                    │
    │                   │                       │                      │                      │                    │
    │                   │                       │  1. getMockTestById  │─────────────────────>│                    │
    │                   │                       │                      │<─ MockTest ──────────│                    │
    │                   │                       │                      │                      │                    │
    │                   │                       │  2. getMockTestQues. │─────────────────────>│                    │
    │                   │                       │                      │<─ Questions[] ───────│                    │
    │                   │                       │                      │                      │                    │
    │                   │                       │  3. getQuestions(ids)│─────────────────────>│                    │
    │                   │                       │                      │<─ Questions[] ───────│                    │
    │                   │                       │                      │                      │                    │
    │                   │                       │  ┌─ Validation ──────┤                      │                    │
    │                   │                       │  │ ✓ Test exists     │                      │                    │
    │                   │                       │  │ ✓ Status is draft │                      │                    │
    │                   │                       │  │ ✓ Has questions   │                      │                    │
    │                   │                       │  │ ✓ All published   │                      │                    │
    │                   │                       │  │ ✓ No duplicates   │                      │                    │
    │                   │                       │  │ ✓ Valid duration  │                      │                    │
    │                   │                       │  └───────────────────┤                      │                    │
    │                   │                       │                      │                      │                    │
    │                   │                       │  ValidationReport    │                      │                    │
    │                   │                       │<─────────────────────│                      │                    │
    │                   │                       │                      │                      │                    │
    │                   │                       │  (if isValid)        │                      │                    │
    │                   │                       │  publishMockTest(id) │                      │                    │
    │                   │                       │─────────────────────>│                      │                    │
    │                   │                       │                      │  UPDATE status         │                    │
    │                   │                       │                      │  = 'published'       │                    │
    │                   │                       │                      │─────────────────────>│                    │
    │                   │                       │                      │<─ MockTest ──────────│<───────────────────│
    │                   │                       │                      │                      │                    │
    │                   │                       │<─ PublishSummary ────│                      │                    │
    │                   │<─ Success ────────────│                      │                      │                    │
    │                   │                       │                      │                      │                    │
    │  See success      │                       │                      │                      │                    │
    │<──────────────────│                       │                      │                      │                    │
```

### 13.3 Teacher Views Student Result

```
[Teacher]        [ResultDetailPage]      [useMockResult]         [mockResultService]      [Supabase]
    │                   │                       │                      │                      │
    │  Click result     │                       │                      │                      │
    │──────────────────>│                       │                      │                      │
    │                   │  getResult(id)        │                      │                      │
    │                   │  (via React Query)    │                      │                      │
    │                   │──────────────────────>│                      │                      │
    │                   │                       │                      │                      │
    │                   │                       │  getResult(id)       │                      │
    │                   │                       │─────────────────────>│                      │
    │                   │                       │                      │                      │
    │                   │                       │                      │  SELECT * FROM       │
    │                   │                       │                      │  mock_results        │
    │                   │                       │                      │─────────────────────>│
    │                   │                       │                      │                      │
    │                   │                       │                      │<─ DbMockResult ──────│
    │                   │                       │                      │                      │
    │                   │                       │<─ ApiResponse ───────│                      │
    │                   │                       │                      │                      │
    │                   │<─ MockResult ─────────│                      │                      │
    │                   │                       │                      │                      │
    │  ┌─────────────── │                       │                      │                      │
    │  │ Display:       │                       │                      │                      │
    │  │ - Score 493/720│                       │                      │                      │
    │  │ - 68.5% (green)│                       │                      │                      │
    │  │ - Rank #12     │                       │                      │                      │
    │  │ - 45 min       │                       │                      │                      │
    │  │ - Subject BD   │                       │                      │                      │
    │  │   Physics: 67% │                       │                      │                      │
    │  │   Chemistry:88%│                       │                      │                      │
    │  │ - Chapter BD   │                       │                      │                      │
    │  └─────────────── │                       │                      │                      │
    │                   │                       │                      │                      │
    │  Click Release    │                       │                      │                      │
    │──────────────────>│                       │                      │                      │
    │                   │  releaseResult(id)    │                      │                      │
    │                   │  (mutation)           │                      │                      │
    │                   │──────────────────────>│                      │                      │
    │                   │                       │  releaseResult(id)   │                      │
    │                   │                       │─────────────────────>│                      │
    │                   │                       │                      │  UPDATE mock_results │
    │                   │                       │                      │  is_released = true  │
    │                   │                       │                      │─────────────────────>│
    │                   │                       │                      │                      │
    │                   │                       │  Invalidate:         │                      │
    │                   │                       │  ['mockResults']     │                      │
    │                   │  Status updates       │                      │                      │
    │                   │<──────────────────────│                      │                      │
    │<─ See "Released"──│                       │                      │                      │
```

### 13.4 Teacher Updates Profile

```
[Teacher]        [EditProfilePage]        [profileService]         [Supabase]          [Storage]
    │                   │                       │                      │                    │
    │  Change bio       │                       │                      │                    │
    │──────────────────>│                       │                      │                    │
    │                   │                       │                      │                    │
    │  Upload photo     │                       │                      │                    │
    │──────────────────>│                       │                      │                    │
    │                   │  uploadAvatar(file)   │                      │                    │
    │                   │──────────────────────>│                      │                    │
    │                   │                       │  Storage upload      │                    │
    │                   │                       │──────────────────────────────────────────>│
    │                   │                       │                      │                    │
    │                   │                       │<─ UploadResult ──────│<───────────────────│
    │                   │                       │                      │                    │
    │                   │                       │  UPDATE profiles     │                    │
    │                   │                       │  avatar_url = ...    │                    │
    │                   │                       │─────────────────────>│                    │
    │                   │                       │                      │                    │
    │  Click Save       │                       │                      │                    │
    │──────────────────>│                       │                      │                    │
    │                   │  updatePersonalInfo(  │                      │                    │
    │                   │    { bio, ... })      │                      │                    │
    │                   │──────────────────────>│                      │                    │
    │                   │                       │  UPDATE profiles     │                    │
    │                   │                       │  bio = ...           │                    │
    │                   │                       │─────────────────────>│                    │
    │                   │                       │                      │                    │
    │                   │                       │<─ Success ───────────│                    │
    │                   │<─ Success ────────────│                      │                    │
    │                   │                       │                      │                    │
    │  Redirect to view │                       │                      │                    │
    │<──────────────────│                       │                      │                    │
```

### 13.5 Teacher Changes Password

```
[Teacher]        [SecurityPage]           [useAuth]               [authService]           [Supabase Auth]
    │                   │                       │                      │                      │
    │  Click "Change    │                       │                      │                      │
    │  Password"        │                       │                      │                      │
    │──────────────────>│                       │                      │                      │
    │                   │                       │                      │                      │
    │  Enter new pwd    │                       │                      │                      │
    │  + confirm        │                       │                      │                      │
    │──────────────────>│                       │                      │                      │
    │                   │                       │                      │                      │
    │                   │  updatePassword(pwd)  │                      │                      │
    │                   │──────────────────────>│                      │                      │
    │                   │                       │  updatePassword(pwd) │                      │
    │                   │                       │─────────────────────>│                      │
    │                   │                       │                      │  auth.updateUser()   │
    │                   │                       │                      │─────────────────────>│
    │                   │                       │                      │                      │
    │                   │                       │                      │<─ Success ───────────│
    │                   │                       │<─ AuthResponse ──────│                      │
    │                   │<─ Success ────────────│                      │                      │
    │                   │                       │                      │                      │
    │  See success msg  │                       │                      │                      │
    │<──────────────────│                       │                      │                      │
```

### 13.6 Settings Save

```
[Teacher]        [SettingsPage]           [settingsService]        [localStorage]
    │                   │                       │                      │
    │  Toggle dark mode │                       │                      │
    │──────────────────>│                       │                      │
    │                   │                       │                      │
    │                   │  updateSettings({     │                      │
    │                   │    theme: 'dark' })    │                      │
    │                   │──────────────────────>│                      │
    │                   │                       │  localStorage.setItem│
    │                   │                       │  ('teacher_settings',│
    │                   │                       │   JSON.stringify())  │
    │                   │                       │─────────────────────>│
    │                   │                       │                      │
    │                   │                       │  applyTheme('dark')  │
    │                   │                       │  (toggle dark class  │
    │                   │                       │   on <html> element) │
    │                   │                       │                      │
    │                   │                       │<─ Success ───────────│
    │                   │<─ Success ────────────│                      │
    │                   │                       │                      │
    │  Dark mode applied│                       │                      │
    │<──────────────────│                       │                      │
```

---

## 14. Integration Checklist

### 14.1 Authentication

| Area | Status | Notes |
|------|--------|-------|
| Backend | ✅ Complete | Supabase Auth fully configured |
| Frontend | ✅ Complete | LoginView, AuthContext, useAuth hook |
| Service | ✅ Complete | authService.ts with full OTP flow |
| React Query | ✅ Complete | useAuth hook wraps Redux + authService |
| Database | ✅ Complete | `profiles` table, DB trigger, RLS policies |
| **Remaining** | None | — |

### 14.2 Dashboard

| Area | Status | Notes |
|------|--------|-------|
| Backend | ✅ Complete | teacherService provides all dashboard data |
| Frontend | ✅ Complete | Stat cards, charts, widgets, activity feed |
| Service | ✅ Complete | teacherService.getTeacherOverviewData() |
| React Query | ✅ Complete | useQuery with 30s staleTime |
| Database | ✅ Complete | All required tables exist + RLS |
| **Remaining** | None | — |

### 14.3 Question Bank

| Area | Status | Notes |
|------|--------|-------|
| Backend | ✅ Complete | Full CRUD, status machine, options, explanations, images |
| Frontend | ✅ Complete | Create, edit, list, preview, bulk actions, filters |
| Service | ✅ Complete | questionService.ts, option/explanation/image services |
| React Query | ✅ Complete | 8 hooks, cache invalidation on all mutations |
| Database | ✅ Complete | `questions`, `question_options`, `question_explanations`, `question_images` |
| **Remaining** | Bulk import (Phase 2) | UI route exists, import logic not implemented |

### 14.4 Mock Tests

| Area | Status | Notes |
|------|--------|-------|
| Backend | ✅ Complete | Full CRUD, status machine, junction management |
| Frontend | ✅ Complete | Create, edit, list, questions, publish workflow |
| Service | ✅ Complete | mockTestService.ts, mockTestQuestionService.ts |
| React Query | ✅ Complete | 8 hooks, cache invalidation |
| Database | ✅ Complete | `mock_tests`, `mock_test_questions` + RLS |
| **Remaining** | Question snapshots | Architecture reserved, not implemented |

### 14.5 Results

| Area | Status | Notes |
|------|--------|-------|
| Backend | ✅ Complete | Full CRUD, release/hide, filtered queries |
| Frontend | ✅ Complete | Dashboard, list, detail with breakdowns |
| Service | ✅ Complete | mockResultService.ts |
| React Query | ✅ Complete | 5 hooks, cache invalidation |
| Database | ✅ Complete | `mock_results` + RLS |
| **Remaining** | Export (Phase 2) | UI has placeholder buttons |

### 14.6 Students

| Area | Status | Notes |
|------|--------|-------|
| Backend | ✅ Complete | teacherService provides batches + rosters |
| Frontend | ✅ Complete | Dashboard, list, profile with strong/weak subjects |
| Service | ✅ Complete | teacherService.ts |
| React Query | ✅ Complete | useQuery with 30s staleTime |
| Database | ✅ Complete | `batch_teachers`, `batch_students`, `student_details` + RLS |
| **Remaining** | None | — |

### 14.7 Notifications

| Area | Status | Notes |
|------|--------|-------|
| Backend | ⚠️ Partial | RLS blocks teacher INSERT. Notification creation may fail. |
| Frontend | ✅ Complete | Dashboard, create, history, scheduled |
| Service | ✅ Complete | notificationService.ts |
| React Query | ✅ Complete | 5 hooks |
| Database | ✅ Complete | `notifications`, `notification_recipients` + RLS |
| **Remaining** | RLS policy update | Teachers need INSERT permission on `notifications` |

### 14.8 Analytics

| Area | Status | Notes |
|------|--------|-------|
| Backend | ⚠️ Partial | Analytics services exist. Data pipeline relies on mock_results population. |
| Frontend | ✅ Complete | 9 pages, filter components, ScoreCard, ProgressRing |
| Service | ✅ Complete | Analytics services in src/services/analytics/ |
| React Query | ✅ Complete | 8 hooks with analytics cache key prefix |
| Database | ✅ Complete | All source tables exist |
| **Remaining** | Analytics data pipeline | Server-side aggregation for large datasets |

### 14.9 Profile

| Area | Status | Notes |
|------|--------|-------|
| Backend | ✅ Complete | profileService.ts reads/writes profiles + teacher_details |
| Frontend | ✅ Complete | View, edit, activity, security, notification prefs |
| Service | ✅ Complete | profileService.ts |
| React Query | ✅ Complete | Direct queries (no React Query wrapper — uses direct service calls) |
| Database | ✅ Complete | `profiles`, `teacher_details` + RLS |
| **Remaining** | Activity timeline server sync | Login history, device tracking need new tables |

### 14.10 Settings

| Area | Status | Notes |
|------|--------|-------|
| Backend | ⚠️ Partial | localStorage only. No server sync. |
| Frontend | ✅ Complete | 10+ sections, theme toggle, all preferences |
| Service | ✅ Complete | settingsService.ts |
| React Query | ✅ Complete | Direct service calls (no React Query — settings are not server-state) |
| Database | ❌ Not used | Settings stored in localStorage only |
| **Remaining** | Server-side sync | Need `teacher_settings` table if cross-device sync required |

---

## 15. Backend TODO List

### 15.1 High Priority

| Feature | Status | Why Needed | Estimated Effort |
|---------|--------|------------|------------------|
| **Teacher INSERT on notifications** | ❌ Pending | Teachers cannot send notifications due to RLS. Need new policy or service_role proxy. | 1 day |
| **Question snapshot generation** | ❌ Pending | Without snapshots, editing a question after it's in a published test can cause data inconsistency. | 3 days |
| **Analytics aggregation pipeline** | ❌ Pending | Current analytics queries are performed client-side. A server-side Edge Function or materialized view is needed for scale. | 5 days |
| **Login history table** | ❌ Pending | Profile security page shows "Recent Devices" and "Login History" as UI-ready — no backend table exists. | 2 days |
| **Device tracking** | ❌ Pending | Security page "Recent Devices" section has no backend. | 2 days |

### 15.2 Medium Priority

| Feature | Status | Why Needed | Estimated Effort |
|---------|--------|------------|------------------|
| **Scheduled notification dispatch** | ❌ Pending | UI exists for scheduling. Backend job to dispatch at scheduled time not implemented. | 3 days |
| **Notification preferences table** | ❌ Pending | Currently stored in localStorage. `teacher_notification_prefs` table needed for server sync. | 1 day |
| **Teacher settings table** | ❌ Pending | Settings stored only in localStorage. `teacher_settings` table needed for cross-device sync. | 1 day |
| **Export service (CSV/Excel/PDF)** | ❌ Pending | UI has placeholder buttons. Backend export logic not implemented. | 5 days |
| **Two-factor authentication** | ❌ Pending | UI-ready with "Coming Soon" badge. Supabase 2FA setup needed. | 3 days |
| **Content management pages** | ❌ Pending | Content service exists. Teacher-facing UI pages not built. | 5 days |

### 15.3 Lower Priority

| Feature | Status | Notes |
|---------|--------|-------|
| **Live classes + Jitsi integration** | ❌ Pending | Full module for scheduling and conducting live classes |
| **PYQ management UI** | ❌ Pending | Requires RLS updates + UI pages |
| **Doubts module UI** | ❌ Pending | Student Q&A interface |
| **Bulk question import** | ❌ Pending | Route exists, no backend logic |
| **Audit logs** | ❌ Pending | Currently admin-only. Teacher-facing audit log needed. |
| **Connected accounts (OAuth)** | ❌ Pending | UI-ready placeholders |
| **Password policy configuration** | ❌ Pending | Minimum length, complexity rules |

### 15.4 Database Functions Needed

| Function | Purpose | Priority |
|----------|---------|----------|
| `fn_compute_mock_result(attempt_id)` | Server-side evaluation function for production use | High |
| `fn_compute_teacher_analytics(teacher_id)` | Nightly aggregation of teacher analytics | Medium |
| `fn_compute_student_analytics(student_id)` | Nightly aggregation of student analytics | Medium |
| `fn_dispatch_scheduled_notifications()` | Background job to dispatch scheduled notifications | Medium |
| `fn_generate_question_snapshot(test_id)` | Generate frozen question snapshots at publish time | High |
| `fn_compute_rankings(test_id)` | Compute rank and percentile after result release | Medium |

---

## 16. Production Readiness

### 16.1 Service Ratings

| Service | Architecture (/10) | Error Handling (/10) | Validation (/10) | Performance (/10) | Caching (/10) | Security (/10) | Documentation (/10) | Overall |
|---------|:------------------:|:--------------------:|:-----------------:|:------------------:|:-------------:|:---------------:|:-------------------:|:-------:|
| **Auth Service** | 9 | 9 | 9 | 9 | 8 | 10 | 10 | **9.1** |
| **Teacher Service** | 7 | 7 | 6 | 7 | 8 | 8 | 8 | **7.3** |
| **Question Service** | 10 | 9 | 10 | 9 | 10 | 10 | 10 | **9.7** |
| **Question Option Service** | 10 | 9 | 9 | 9 | 10 | 10 | 9 | **9.4** |
| **Question Explanation Service** | 10 | 9 | 9 | 9 | 10 | 10 | 9 | **9.4** |
| **Question Image Service** | 10 | 9 | 9 | 9 | 10 | 10 | 9 | **9.4** |
| **Mock Test Service** | 10 | 10 | 10 | 9 | 10 | 10 | 10 | **9.9** |
| **Mock Test Question Service** | 10 | 9 | 10 | 8 | 10 | 10 | 10 | **9.6** |
| **Mock Test Publish Service** | 10 | 9 | 10 | 8 | — | 10 | 10 | **9.5** |
| **Mock Attempt Service** | 8 | 8 | 8 | 8 | 9 | 9 | 9 | **8.4** |
| **Mock Result Service** | 9 | 9 | 9 | 9 | 10 | 10 | 9 | **9.3** |
| **Mock Evaluation Service** | 9 | 8 | 8 | 7 | — | 9 | 9 | **8.3** |
| **Notification Service** | 9 | 8 | 8 | 7 | 9 | 8 | 9 | **8.3** |
| **Stream Service** | 10 | 9 | 9 | 9 | 10 | 10 | 9 | **9.4** |
| **Subject Service** | 10 | 9 | 9 | 9 | 10 | 10 | 9 | **9.4** |
| **Chapter Service** | 10 | 9 | 9 | 9 | 10 | 10 | 9 | **9.4** |
| **Topic Service** | 10 | 9 | 9 | 9 | 10 | 10 | 9 | **9.4** |
| **Content Service** | 9 | 9 | 9 | 8 | 9 | 9 | 9 | **8.9** |
| **Tag Service** | 10 | 9 | 9 | 9 | 10 | 10 | 9 | **9.4** |
| **Approval Service** | 9 | 9 | 9 | 8 | 9 | 9 | 9 | **8.9** |
| **Storage Service** | 9 | 9 | 9 | 8 | — | 9 | 9 | **8.8** |
| **Profile Service** | 8 | 8 | 7 | 8 | 8 | 8 | 8 | **7.9** |
| **Settings Service** | 7 | 7 | 7 | 10 | — | 7 | 7 | **7.5** |

### 16.2 Overall Architecture Assessment

| Criterion | Score | Notes |
|-----------|-------|-------|
| **Service Layer Architecture** | 9/10 | Clean separation of concerns. Consistent `ApiResponse<T>` pattern. |
| **TypeScript Coverage** | 9/10 | Strong typing throughout. Some legacy types need cleanup. |
| **Error Handling Consistency** | 8/10 | Services consistently use `extractErrorMessage()`. Some edge cases in mock evaluation. |
| **Validation** | 9/10 | Client-side + service-side validation. UUID validation in all critical paths. |
| **Caching Strategy** | 9/10 | React Query with appropriate stale times. Analytics have longer stale times. |
| **Security (Frontend)** | 9/10 | RLS respected. No service_role key. No sensitive data in localStorage. |
| **Accessibility** | 7/10 | ARIA labels, roles, keyboard navigation present. Full audit recommended. |
| **Performance** | 7/10 | Pagination implemented. Large dataset testing needed. |
| **Documentation** | 9/10 | Extensive JSDoc comments. Functional spec exists. |
| **Test Coverage** | 2/10 | No automated test suite. Manual test cases documented. |

---

## 17. Phase 2 API Roadmap

### 17.1 Live Classes Module

| Future API | Purpose | Tables Needed |
|------------|---------|---------------|
| `liveClassService.createLiveClass()` | Schedule a new live class | `live_classes` |
| `liveClassService.getLiveClasses()` | List teacher's live classes | `live_classes` |
| `liveClassService.startSession()` | Start a live session (go live) | `live_sessions` |
| `liveClassService.endSession()` | End a live session | `live_sessions` |
| `liveClassService.getAttendance()` | View class attendance | `attendance` |
| `liveClassService.markAttendance()` | Manual attendance override | `attendance` |
| `liveClassService.getRecordings()` | View class recordings | `recordings` |
| `liveClassService.assignBatch()` | Assign class to batch | `live_class_batch` |

### 17.2 Meeting Service (Jitsi)

| Future API | Purpose |
|------------|---------|
| `meetingService.generateRoomUrl()` | Generate Jitsi meeting URL |
| `meetingService.createRoom()` | Create a meeting room |
| `meetingService.endRoom()` | End an active meeting |
| `meetingService.getParticipants()` | Get current participants |
| `meetingService.recordSession()` | Start/stop recording |
| `meetingService.streamToPlatform()` | Stream to external platform |

### 17.3 Recording Service

| Future API | Purpose |
|------------|---------|
| `recordingService.uploadRecording()` | Upload recorded class video |
| `recordingService.getSignedUrl()` | Generate playback URL |
| `recordingService.deleteRecording()` | Delete recording |
| `recordingService.updateMetadata()` | Update recording title/description |

### 17.4 Attendance Service

| Future API | Purpose |
|------------|---------|
| `attendanceService.getAttendance()` | Get attendance for a class |
| `attendanceService.markAttendance()` | Mark attendance for a student |
| `attendanceService.overrideAttendance()` | Manual override |
| `attendanceService.getAttendanceReport()` | Attendance summary per batch |

### 17.5 PYQ Module

| Future API | Purpose |
|------------|---------|
| `pyqService.createPackage()` | Create PYQ package |
| `pyqService.addPaper()` | Add paper to package |
| `pyqService.mapQuestion()` | Map question to paper |
| `pyqService.uploadSolution()` | Upload solution PDF |
| `pyqService.linkToMockTest()` | Link PYQ paper to mock test |

### 17.6 Doubts Module

| Future API | Purpose |
|------------|---------|
| `doubtService.getDoubts()` | List doubts for teacher's subjects |
| `doubtService.getDoubtDetail()` | Get doubt with replies |
| `doubtService.replyToDoubt()` | Reply to a student doubt |
| `doubtService.acceptAnswer()` | Mark reply as accepted |

### 17.7 Admin APIs

| Future API | Purpose |
|------------|---------|
| `adminService.getInstituteOverview()` | Institute-level dashboard |
| `adminService.manageTeachers()` | Teacher CRUD |
| `adminService.manageStudents()` | Student management |
| `adminService.approveContent()` | Content approval dashboard |
| `adminService.approveMockTests()` | Mock test approval dashboard |
| `adminService.viewAuditLogs()` | System audit log viewer |

### 17.8 Student APIs

| Future API | Purpose |
|------------|---------|
| `studentService.getAvailableTests()` | List available mock tests |
| `studentService.startAttempt()` | Start a new attempt |
| `studentService.submitAttempt()` | Submit an attempt |
| `studentService.getResults()` | View own results |
| `studentService.getPerformance()` | View own analytics |
| `studentService.viewContent()` | Access study material |
| `studentService.postDoubt()` | Ask a question |

### 17.9 Payment & Commerce

| Future API | Purpose |
|------------|---------|
| `paymentService.createOrder()` | Create payment order |
| `paymentService.verifyPayment()` | Verify payment callback |
| `paymentService.getInvoice()` | Generate/download invoice |
| `subscriptionService.getPlans()` | List subscription plans |
| `subscriptionService.subscribe()` | Create subscription |
| `subscriptionService.cancel()` | Cancel subscription |

### 17.10 Push Notification APIs

| Future API | Purpose |
|------------|---------|
| `pushService.registerDevice()` | Register device for push |
| `pushService.sendPush()` | Send push notification |
| `pushService.unregisterDevice()` | Remove device registration |
| `pushService.getDeliveryStatus()` | Check push delivery status |

### 17.11 Export APIs

| Future API | Purpose |
|------------|---------|
| `exportService.exportResultsCSV()` | Export results as CSV |
| `exportService.exportResultsExcel()` | Export results as Excel |
| `exportService.exportResultsPDF()` | Export results as PDF |
| `exportService.exportStudentListCSV()` | Export student list |
| `exportService.exportAnalyticsPDF()` | Export analytics report |

---

## Appendix: Key Type Interfaces

### ApiResponse

```typescript
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  warning?: string;  // Non-fatal side-effect warnings
}
```

### AuthResponse

```typescript
interface AuthResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  warning?: string;
}
```

### PaginatedResponse

```typescript
interface PaginatedResponse<T> {
  data: T[];
  count: number;
  page: number;
  pageSize: number;
  pageCount: number;
}
```

### PaginationParams

```typescript
interface PaginationParams {
  page?: number;     // default: 1
  pageSize?: number; // default: 20
}
```

### UserProfile

```typescript
interface UserProfile {
  id: string;
  email: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  name: string;
  role: 'student' | 'teacher' | 'admin';
  instituteId: string | null;
  phone: string | null;
  avatarUrl: string | null;
  createdAt: string;
}
```

### ValidationResult

```typescript
interface ValidationResult {
  valid: boolean;
  error?: string;
}
```

---

*End of Teacher Dashboard API Contracts Document*
