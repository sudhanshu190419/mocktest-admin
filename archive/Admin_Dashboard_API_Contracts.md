# Admin Dashboard — API Contracts & Service Architecture

> **Document Version:** 1.0
> **Author:** Senior Software Architect
> **Status:** Final — Approved for Development
> **Scope:** Complete API contracts, service architecture, React Query hooks, validation, permissions, and integration plan for the Admin Dashboard
> **Derived From:** Supabase Migrations 001–025, ERD v3, Teacher Dashboard Phase 1 Implementation, Admin_Dashboard_Functional_Specification.md, Admin_Dashboard_Testing_and_Functional_Flow.md
> **Date:** July 8, 2026

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Service Inventory](#2-service-inventory)
3. [Existing Services to Reuse](#3-existing-services-to-reuse)
4. [React Query Hooks](#4-react-query-hooks)
5. [API / Service Contracts](#5-api--service-contracts)
6. [Database Mapping](#6-database-mapping)
7. [Permission Matrix](#7-permission-matrix)
8. [Validation Contracts](#8-validation-contracts)
9. [Error Contracts](#9-error-contracts)
10. [React Query Cache Strategy](#10-react-query-cache-strategy)
11. [Authentication Contracts](#11-authentication-contracts)
12. [Sequence Diagrams](#12-sequence-diagrams)
13. [Module Dependency Diagram](#13-module-dependency-diagram)
14. [Integration Checklist](#14-integration-checklist)
15. [Backend TODO List](#15-backend-todo-list)
16. [Production Readiness](#16-production-readiness)
17. [Phase 2 API Roadmap](#17-phase-2-api-roadmap)
18. [Service Reuse Summary](#18-service-reuse-summary)

---

## 1. System Architecture

### 1.1 Layered Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        React (Next.js) App Router                    │
├──────────────────────────────────────────────────────────────────────┤
│                    React Query (TanStack Query)                       │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │              Admin React Query Hooks Layer                      │  │
│  │  useTeachers()│useStudents()│useInstitutes()│useApprovals()...  │  │
│  └────────────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────────┤
│                    Admin Service Layer (NEW)                          │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  AdminDashboardService  │  InstituteManagementService           │  │
│  │  TeacherManagementSvc   │  StudentManagementService             │  │
│  │  QuestionApprovalSvc    │  MockTestManagementService            │  │
│  │  ResultManagementSvc    │  NotificationManagementService        │  │
│  │  AnalyticsMgmtService   │  ReportService                        │  │
│  │  PaymentMgmtService     │  CourseManagementService              │  │
│  │  CouponService          │  RolePermissionService                │  │
│  │  SettingsService        │  AuditLogService                      │  │
│  │  SupportService         │  MediaService         │  SystemHealth │  │
│  └────────────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────────┤
│                   Existing Service Layer (REUSED)                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  authService      │ teacherService     │ profileService        │  │
│  │  batchService     │ chapterService     │ streamService         │  │
│  │  subjectService   │ topicService       │ contentService        │  │
│  │  approvalService  │ tagService         │ mockTestService       │  │
│  │  questionService  │ questionOptionSvc  │ questionImageSvc      │  │
│  │  mockAttemptSvc   │ mockResultSvc      │ mockTestQuestionSvc   │  │
│  │  notificationSvc  │ storageService     │ adminService          │  │
│  │  teacherIdentity  │ ocrIngestionSvc    │ classService          │  │
│  └────────────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────────┤
│                     Supabase Client (anon key)                        │
├──────────────────────────────────────────────────────────────────────┤
│                  PostgreSQL + RLS Policies                            │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.2 Data Flow

1. **Admin UI** → React Query hook → Admin Service → Existing Service → Supabase Client → PostgreSQL
2. **Admin UI** → React Query hook → Existing Service directly (for reused CRUD)
3. **Admin UI** → React Query hook → Admin Service → Multiple Existing Services (orchestration)

### 1.3 Security

- All queries use the **anon key** — RLS policies control access.
- `adminService.ts` uses the anon key with `profiles.role = 'admin'` RLS checks.
- Sessions are managed by Supabase Auth. Admin role is verified via `profiles.role` column.
- Institute isolation is enforced by `institute_id` column filters + RLS on every table.

### 1.4 Caching

- React Query manages all client-side caching.
- Admin hooks have longer stale times (5-30 minutes) than teacher hooks.
- Manual invalidation on mutations ensures data consistency.
- Dashboard stats are refetched on window focus with `refetchOnWindowFocus: true`.

### 1.5 Error Handling

- Every service method returns `ApiResponse<T>` — never throws raw exceptions.
- `extractErrorMessage()` normalises `AuthError`, `PostgrestError`, and `Error` types.
- The UI layer handles `!success` paths with toast notifications and error banners.

---

## 2. Service Inventory

The Admin Dashboard requires the following services. Some are **NEW** (need implementation), others are **REUSED** from the Teacher Dashboard.

### 2.1 New Admin Services (Need Implementation)

| # | Service | Purpose | Business Responsibility | Dependencies |
|---|---------|---------|------------------------|--------------|
| 1 | `AdminInstituteService` | Institute CRUD & configuration | Create/edit/suspend institutes | authService |
| 2 | `AdminTeacherService` | Teacher lifecycle management | Create/suspend/assign teachers | teacherService, batchService |
| 3 | `AdminStudentService` | Student lifecycle management | Create/suspend/reset students | studentService, batchService |
| 4 | `AdminAcademicService` | Stream/subject/chapter/topic CRUD | Manage academic hierarchy | streamService, subjectService, chapterService, topicService |
| 5 | `AdminBatchService` | Batch lifecycle management | Create/edit/close/archive batches | batchService, streamService |
| 6 | `AdminApprovalService` | Approval orchestration + admin review | Approve/reject content & mock tests | approvalService, contentService, notificationService |
| 7 | `AdminMockTestService` | Mock test lifecycle (admin view) | Publish/unpublish/archive tests | mockTestService, mockTestQuestionService |
| 8 | `AdminResultService` | Result release/hide/override | Batch release results | mockResultService |
| 9 | `AdminNotificationService` | Broadcast & manage notifications | Send bulk notifications, manage templates | notificationService |
| 10 | `AdminAnalyticsService` | Institute-wide analytics | Dashboard stats, reports, trends | analyticsService, mockResultService |
| 11 | `AdminPaymentService` | Payment & subscription management | View payments, manage coupons | subscription tables |
| 12 | `AdminRoleService` | Role & permission management | Assign roles, manage access | profiles table |
| 13 | `AdminSettingsService` | System configuration | Manage settings, branding | settingsService |
| 14 | `AdminAuditLogService` | Activity audit trail | View admin/teacher/student activity | audit log tables |
| 15 | `AdminSupportService` | Support ticket management | View/resolve support tickets | support tables |
| 16 | `AdminMediaService` | Media library management | Upload/delete/manage media | storageService |
| 17 | `AdminSystemHealthService` | System monitoring dashboard | View health metrics, storage usage | storageService, supabase admin |

### 2.2 Services Reused Directly from Teacher Dashboard

| # | Service | Admin Module That Uses It | How It's Called |
|---|---------|---------------------------|-----------------|
| 1 | `teacherService` | Teacher Management | Reused as-is |
| 2 | `batchService` | Batch Management | Reused as-is (CRUD methods already exist) |
| 3 | `streamService` | Academic Management | Reused as-is |
| 4 | `subjectService` | Academic Management | Reused as-is |
| 5 | `chapterService` | Academic Management | Reused as-is |
| 6 | `topicService` | Academic Management | Reused as-is |
| 7 | `contentService` | Content Management, Approval | Reused as-is (including lifecycle methods) |
| 8 | `approvalService` | Approval Center | Reused as-is (including approveRequest, rejectRequest) |
| 9 | `tagService` | Content Management | Reused as-is |
| 10 | `mockTestService` | Mock Test Management | Reused as-is (including getMockTests, publishMockTest) |
| 11 | `mockTestQuestionService` | Mock Test Management | Reused as-is |
| 12 | `mockResultService` | Results Management | Reused as-is (including releaseResult, getResults) |
| 13 | `mockAttemptService` | Results Management | Reused as-is (read-only for admin) |
| 14 | `questionService` | Question Bank | Reused as-is (including publishQuestion, archiveQuestion) |
| 15 | `questionOptionService` | Question Bank | Reused as-is |
| 16 | `questionImageService` | Question Bank | Reused as-is |
| 17 | `questionExplanationService` | Question Bank | Reused as-is |
| 18 | `notificationService` | Notification Management | Reused as-is (including createBulkNotification) |
| 19 | `storageService` | Media Management | Reused as-is |
| 20 | `authService` | Authentication | Reused as-is |
| 21 | `profileService` | Teacher/Student Profiles | Reused as-is |
| 22 | `teacherIdentity` | Identity Resolution | Reused as-is |
| 23 | `ocrIngestionService` | Question Bank (bulk import) | Reused as-is |

---

## 3. Existing Services to Reuse

The following table details exactly how each existing Teacher Dashboard service should be reused in the Admin Dashboard.

### 3.1 Question Service (`questionService.ts`)

| Admin Feature | Reuse Method | Arguments | Notes |
|---------------|-------------|-----------|-------|
| Question Approval | `questionService.publishQuestion(questionId)` | Single UUID | Already handles status transition `pending_approval → published` |
| Question Rejection | `questionService.transitionStatus()` via approvalService | Delegated via approvalService | Already handles `pending_approval → draft` |
| Question Archive | `questionService.archiveQuestion(questionId)` | Single UUID | Already handles `published → archived` |
| Question Restore | `questionService.restoreQuestion(questionId)` | Single UUID | Already handles `archived → draft` |
| Question Delete | `questionService.deleteQuestion(questionId)` | Single UUID | Already handles hard delete with FK checks |
| Question List | `questionService.getQuestions(filters, sort, pagination)` | Full filter/sort/pagination | Reuse with `instituteId` filter |
| Question Detail | `questionService.getQuestion(questionId)` | Single UUID | Returns nested options with images |

### 3.2 Mock Test Service (`mockTestService.ts`)

| Admin Feature | Reuse Method | Arguments | Notes |
|---------------|-------------|-----------|-------|
| Mock Test List | `mockTestService.getMockTests(filters, sort, pagination)` | Full filter/sort/pagination | Reuse with `instituteId` filter |
| Mock Test Publish | `mockTestService.publishMockTest(testId)` | Single UUID | Already handles `pending_approval → published` |
| Mock Test Archive | `mockTestService.archiveMockTest(testId)` | Single UUID | Already handles `published → archived` |
| Mock Test Restore | `mockTestService.restoreMockTest(testId)` | Single UUID | Already handles `archived → draft` |
| Mock Test Delete | `mockTestService.deleteMockTest(testId)` | Single UUID | Hard delete with FK checks |
| Mock Test Detail | `mockTestService.getMockTestById(testId)` | Single UUID | Returns single mock test |

### 3.3 Mock Test Publish Service (`mockTestPublishService.ts`)

| Admin Feature | Reuse Method | Notes |
|---------------|-------------|-------|
| Validate Test | `mockTestPublishService.validateMockTestReady(testId)` | Returns comprehensive validation report |
| Publish Workflow | `mockTestPublishService.publishMockTestWorkflow(testId)` | Full orchestration (validate → snapshot → publish) |
| Unpublish | `mockTestPublishService.unpublishMockTest(testId)` | Admin-only action with attempt guard |

### 3.4 Mock Result Service (`mockResultService.ts`)

| Admin Feature | Reuse Method | Notes |
|---------------|-------------|-------|
| Release Result | `mockResultService.releaseResult(resultId)` | Sets `is_released = TRUE` |
| Hide Result | `mockResultService.hideResult(resultId)` | Sets `is_released = FALSE` |
| Get Test Results | `mockResultService.getMockTestResults(testId, filters, sort, pagination)` | Leaderboard view |
| Get Institute Results | `mockResultService.getInstituteResults(instituteId, filters, sort, pagination)` | All results for institute |
| Get Student Results | `mockResultService.getStudentResults(studentId, filters, sort, pagination)` | Student's results |
| Get All Results | `mockResultService.getResults(filters, sort, pagination)` | Cross-cutting query |

### 3.5 Approval Service (`approvalService.ts`)

| Admin Feature | Reuse Method | Notes |
|---------------|-------------|-------|
| Approve Request | `approvalService.approveRequest({ approvalId, reviewedBy, remarks })` | Records decision + transitions resource |
| Reject Request | `approvalService.rejectRequest({ approvalId, reviewedBy, remarks })` | Remarks required |
| Assign Reviewer | `approvalService.assignReviewer(approvalId, reviewerId)` | Assign admin to review |
| Get Pending | `approvalService.getPendingApprovals(instituteId?, pagination?)` | FIFO ordered pending requests |
| Get History | `approvalService.getApprovalHistory(resourceId, resourceType?)` | Full audit trail for a resource |
| Cancel Request | `approvalService.cancelRequest(approvalId)` | Cancel before review begins |
| Reopen Request | `approvalService.reopenRequest(approvalId)` | Reopen rejected request |

### 3.6 Notification Service (`notificationService.ts`)

| Admin Feature | Reuse Method | Notes |
|---------------|-------------|-------|
| Send Bulk Notification | `notificationService.createBulkNotification(input)` | Sends to multiple recipients |
| Publish Announcement | `notificationService.publishAnnouncement(input)` | Creates announcement |
| Soft-Delete Notification | `notificationService.deleteNotification(notificationId)` | Sets `is_deleted = TRUE` |
| Get Announcements | `notificationService.getAnnouncements(instituteId, pagination?)` | Scoped to institute |
| Auto-Notify: Test Published | `notificationService.notifyMockTestPublished(...)` | Creates notification for test publish |
| Auto-Notify: Result Released | `notificationService.notifyResultPublished(...)` | Creates notification for result |
| Auto-Notify: Content Uploaded | `notificationService.notifyContentUploaded(...)` | Creates notification for content |
| Auto-Notify: Announcement | `notificationService.notifyAnnouncement(...)` | Creates announcement notification |

### 3.7 Auth Service (`authService.ts`)

| Admin Feature | Reuse Method | Notes |
|---------------|-------------|-------|
| Admin Login | `authService.signIn({ phone, password })` | Phone-based auth |
| Verify OTP | `authService.verifyOtp({ phone, token })` | SMS OTP verification |
| Session Check | `authService.getSession()` | Get current session |
| Force Refresh | `authService.refreshSession()` | Refresh tokens |
| Password Update | `authService.updatePassword(newPassword)` | Update password |
| Logout | `authService.signOut()` | Clear session |

---

## 4. React Query Hooks

### 4.1 Hook Map

| Hook | Purpose | Cache Key | Stale Time | Dependent Modules |
|------|---------|-----------|------------|-------------------|
| `useInstitutes()` | List institutes | `['institutes', filters]` | 5 min | Dashboard, Institute Mgmt |
| `useInstitute(id)` | Single institute | `['institute', id]` | 5 min | Institute Edit |
| `useTeachers(filters)` | List teachers | `['teachers', filters]` | 2 min | Teacher Mgmt |
| `useTeacher(id)` | Single teacher | `['teacher', id]` | 5 min | Teacher Profile |
| `useStudents(filters)` | List students | `['students', filters]` | 2 min | Student Mgmt |
| `useStudent(id)` | Single student | `['student', id]` | 5 min | Student Profile |
| `useStreams(filters)` | List streams | `['streams', filters]` | 10 min | Academic Mgmt |
| `useStream(id)` | Single stream | `['stream', id]` | 10 min | Stream Edit |
| `useSubjects(filters)` | List subjects | `['subjects', filters]` | 10 min | Academic Mgmt |
| `useSubject(id)` | Single subject | `['subject', id]` | 10 min | Subject Edit |
| `useChapters(filters)` | List chapters | `['chapters', filters]` | 10 min | Academic Mgmt |
| `useTopics(filters)` | List topics | `['topics', filters]` | 10 min | Academic Mgmt |
| `useBatches(filters)` | List batches | `['batches', filters]` | 5 min | Batch Mgmt |
| `useBatch(id)` | Single batch | `['batch', id]` | 5 min | Batch Edit |
| `useQuestions(filters)` | List questions | `['questions', filters]` | 2 min | Question Bank |
| `useQuestion(id)` | Single question detail | `['question', id]` | 5 min | Question View |
| `usePendingQuestions(filters)` | Pending approval Qs | `['questions', 'pending', filters]` | 1 min | Approval Center |
| `useMockTests(filters)` | List mock tests | `['mockTests', filters]` | 2 min | Mock Test Mgmt |
| `useMockTest(id)` | Single mock test | `['mockTest', id]` | 5 min | Mock Test View |
| `useResults(filters)` | List results | `['results', filters]` | 1 min | Results Mgmt |
| `useResult(id)` | Single result | `['result', id]` | 5 min | Result View |
| `useApprovalRequests(filters)` | List approval requests | `['approvals', filters]` | 1 min | Approval Center |
| `useApprovalRequest(id)` | Single approval request | `['approval', id]` | 2 min | Approval View |
| `useNotifications(filters)` | List notifications | `['notifications', filters]` | 1 min | Notification Mgmt |
| `useNotification(id)` | Single notification | `['notification', id]` | 2 min | Notification View |
| `useDashboardStats(instituteId)` | Dashboard stats | `['dashboard', instituteId]` | 5 min | Dashboard |
| `useInstituteAnalytics(instituteId)` | Institute analytics | `['analytics', 'institute', instituteId]` | 10 min | Analytics |
| `useTeacherAnalytics(teacherId)` | Teacher analytics | `['analytics', 'teacher', teacherId]` | 10 min | Teacher View |
| `useStudentAnalytics(studentId)` | Student analytics | `['analytics', 'student', studentId]` | 10 min | Student View |
| `useReports(filters)` | Downloadable reports | `['reports', filters]` | 30 min | Reports |
| `usePayments(filters)` | Payment history | `['payments', filters]` | 5 min | Payments |
| `useCoupons(filters)` | List coupons | `['coupons', filters]` | 10 min | Coupon Mgmt |
| `useSettings(instituteId?)` | System settings | `['settings', instituteId]` | 10 min | Settings |
| `useAuditLogs(filters)` | Audit logs | `['auditLogs', filters]` | 2 min | Audit Logs |
| `useMedia(filters)` | Media library | `['media', filters]` | 5 min | Media |
| `useSystemHealth()` | System health | `['systemHealth']` | 30 min | System Health |
| `useSupportTickets(filters)` | Support tickets | `['tickets', filters]` | 2 min | Support |

### 4.2 Hook Contract Detail

```typescript
// ============================================================
// Institute Hooks
// ============================================================

/** List institutes with filtering and pagination. */
export function useInstitutes(filters?: InstituteFilters, pagination?: PaginationParams) {
  // Cache key: ['institutes', filters]
  // Stale time: 5 min
  // Calls: adminInstituteService.getInstitutes(filters, pagination)
}

/** Single institute by ID. */
export function useInstitute(instituteId: string) {
  // Cache key: ['institute', instituteId]
  // Stale time: 5 min
  // Calls: adminInstituteService.getInstitute(instituteId)
}

/** Create institute mutation. */
export function useCreateInstitute() {
  // Invalidates: ['institutes']
  // Calls: adminInstituteService.createInstitute(input)
}

/** Update institute mutation. */
export function useUpdateInstitute() {
  // Invalidates: ['institutes', 'institute', instituteId]
  // Calls: adminInstituteService.updateInstitute(instituteId, input)
}

// ============================================================
// Teacher Hooks (reuse existing teacherService)
// ============================================================

/** List teachers with filtering and pagination. */
export function useTeachers(filters?: TeacherFilters, pagination?: PaginationParams) {
  // Cache key: ['teachers', filters]
  // Stale time: 2 min
  // Calls: teacherService.getTeachers(filters, pagination)
  // NOTE: teacherService may need a getTeachers method — currently only has getTeacherById
}

/** Single teacher by ID. */
export function useTeacher(teacherId: string) {
  // Cache key: ['teacher', teacherId]
  // Stale time: 5 min
  // Calls: teacherService.getTeacherById(teacherId)
}

/** Create teacher — combines auth + profile + teacher_details. */
export function useCreateTeacher() {
  // Invalidates: ['teachers']
  // Mutation calls: adminTeacherService.createTeacher(input)
  // Orchestrates: authService.signUp() + profiles insert + teacher_details insert
}

/** Suspend teacher mutation. */
export function useSuspendTeacher() {
  // Invalidates: ['teachers', 'teacher', teacherId]
  // Calls: adminTeacherService.suspendTeacher(teacherId)
}

// ============================================================
// Student Hooks
// ============================================================

/** List students with filtering and pagination. */
export function useStudents(filters?: StudentFilters, pagination?: PaginationParams) {
  // Cache key: ['students', filters]
  // Stale time: 2 min
  // Calls: adminStudentService.getStudents(filters, pagination)
  // NOTE: New service needed — no existing studentService in Teacher Dashboard
}

/** Single student by ID. */
export function useStudent(studentId: string) {
  // Cache key: ['student', studentId]
  // Stale time: 5 min
  // Calls: adminStudentService.getStudent(studentId)
}

// ============================================================
// Academic Hooks (reuse existing academic services)
// ============================================================

/** List streams — reuses streamService.getStreams(). */
export function useStreams(filters?: StreamFilters, pagination?: PaginationParams) {
  // Cache key: ['streams', filters]
  // Stale time: 10 min
}

/** List subjects — reuses subjectService.getSubjects(). */
export function useSubjects(filters?: SubjectFilters, pagination?: PaginationParams) {
  // Cache key: ['subjects', filters]
  // Stale time: 10 min
}

/** List chapters — reuses chapterService.getChapters(). */
export function useChapters(filters?: ChapterFilters, pagination?: PaginationParams) {
  // Cache key: ['chapters', filters]
  // Stale time: 10 min
}

/** List topics — reuses topicService.getTopics(). */
export function useTopics(filters?: TopicFilters, pagination?: PaginationParams) {
  // Cache key: ['topics', filters]
  // Stale time: 10 min
}

// ============================================================
// Batch Hooks (reuse existing batchService)
// ============================================================

/** List batches — reuses batchService.getBatches(). */
export function useBatches(filters?: BatchFilters, pagination?: PaginationParams) {
  // Cache key: ['batches', filters]
  // Stale time: 5 min
}

// ============================================================
// Question Bank Hooks (reuse existing questionService)
// ============================================================

/** List questions — reuses questionService.getQuestions(). */
export function useQuestions(filters?: QuestionFilters, sort?: QuestionSortOptions, pagination?: PaginationParams) {
  // Cache key: ['questions', filters, sort, pagination]
  // Stale time: 2 min
}

/** Single question detail — reuses questionService.getQuestion(). */
export function useQuestion(questionId: string) {
  // Cache key: ['question', questionId]
  // Stale time: 5 min
}

/** Pending approval questions — reuses questionService.getQuestions({ status: 'pending_approval' }). */
export function usePendingQuestions(instituteId?: string, pagination?: PaginationParams) {
  // Cache key: ['questions', 'pending', instituteId]
  // Stale time: 1 min (high priority for admin review)
}

// ============================================================
// Mock Test Hooks (reuse existing mockTestService)
// ============================================================

/** List mock tests — reuses mockTestService.getMockTests(). */
export function useMockTests(filters?: MockTestServiceFilters, sort?: MockTestServiceSortOptions, pagination?: PaginationParams) {
  // Cache key: ['mockTests', filters, sort, pagination]
  // Stale time: 2 min
}

// ============================================================
// Result Hooks (reuse existing mockResultService)
// ============================================================

/** List results — reuses mockResultService.getResults(). */
export function useResults(filters?: MockResultFilters, sort?: MockResultSortOptions, pagination?: PaginationParams) {
  // Cache key: ['results', filters, sort, pagination]
  // Stale time: 1 min (results change frequently)
}

// ============================================================
// Approval Hooks (reuse existing approvalService)
// ============================================================

/** List approval requests — reuses approvalService.getApprovalRequests(). */
export function useApprovalRequests(filters?: ApprovalQueryFilters, sort?: ApprovalRequestSortOptions, pagination?: PaginationParams) {
  // Cache key: ['approvals', filters, sort, pagination]
  // Stale time: 1 min (high priority)
}

/** Approve mutation — calls approvalService.approveRequest(). */
export function useApproveRequest() {
  // Invalidates: ['approvals', 'questions', 'mockTests', 'content']
  // Optimistic update: update the approval status in cache
}

/** Reject mutation — calls approvalService.rejectRequest(). */
export function useRejectRequest() {
  // Invalidates: ['approvals', 'questions', 'mockTests', 'content']
  // Optimistic update: update the approval status in cache
}

// ============================================================
// Dashboard Hooks (NEW)
// ============================================================

/** Dashboard overview stats. */
export function useDashboardStats(instituteId: string) {
  // Cache key: ['dashboard', instituteId]
  // Stale time: 5 min
  // Calls: adminAnalyticsService.getDashboardStats(instituteId)
  // Returns: { totalTeachers, totalStudents, totalQuestions, totalMockTests,
  //            revenue, todayActivity, pendingApprovals, systemHealth }
}

// ============================================================
// Notification Hooks (reuse existing notificationService)
// ============================================================

/** List notifications (admin view — all notifications for institute). */
export function useAdminNotifications(instituteId: string, filters?: NotificationFilters, pagination?: PaginationParams) {
  // Cache key: ['adminNotifications', instituteId, filters]
  // Stale time: 1 min
  // NOTE: notificationService.getNotifications() queries by userId.
  //       Admin needs a new method or direct supabase query for institute-scoped notifications.
}

/** Send bulk notification mutation. */
export function useSendBulkNotification() {
  // Invalidates: ['adminNotifications']
  // Calls: notificationService.createBulkNotification(input)
}

// ============================================================
// Analytics Hooks (NEW)
// ============================================================

/** Institute-wide analytics. */
export function useInstituteAnalytics(instituteId: string) {
  // Cache key: ['analytics', 'institute', instituteId]
  // Stale time: 10 min
  // Calls: adminAnalyticsService.getInstituteAnalytics(instituteId)
}
```

---

## 5. API / Service Contracts

### 5.1 AdminInstituteService (NEW)

```typescript
// ─── Types ────────────────────────────────────────────────────────

interface Institute {
  instituteId: string;
  name: string;
  slug: string;
  code: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  logo: string | null;
  website: string | null;
  isActive: boolean;
  subscriptionPlan: string | null;
  subscriptionEnd: string | null;
  maxTeachers: number | null;
  maxStudents: number | null;
  createdAt: string;
  updatedAt: string;
}

interface CreateInstituteInput {
  name: string;
  slug: string;
  code: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  logo?: string | null;
  website?: string | null;
  maxTeachers?: number | null;
  maxStudents?: number | null;
}

interface UpdateInstituteInput {
  name?: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  logo?: string | null;
  website?: string | null;
  isActive?: boolean;
  subscriptionPlan?: string | null;
  subscriptionEnd?: string | null;
  maxTeachers?: number | null;
  maxStudents?: number | null;
}

interface InstituteFilters {
  isActive?: boolean;
  search?: string;
  ids?: string[];
}

// ─── Method Contracts ─────────────────────────────────────────────

/**
 * CREATE INSTITUTE
 * Creates a new institute and sets up its initial configuration.
 *
 * Arguments: input: CreateInstituteInput
 * Validation: name required (min 2 chars), slug required (unique, lowercase),
 *             code required (min 2 chars, uppercase)
 * Permission: Super Admin only
 * Side Effects: Creates institute row, optionally creates default admin profile
 * Tables: institutes
 * Response: ApiResponse<Institute>
 */

/**
 * GET INSTITUTES
 * Paginated list of all institutes.
 *
 * Arguments: filters?: InstituteFilters, sort?, pagination?
 * Permission: Super Admin only
 * Tables: institutes
 * Response: ApiResponse<PaginatedResponse<Institute>>
 */

/**
 * GET INSTITUTE
 * Single institute by ID.
 *
 * Arguments: instituteId: string
 * Permission: Super Admin or Institute Admin (own institute)
 * Tables: institutes
 * Response: ApiResponse<Institute>
 */

/**
 * UPDATE INSTITUTE
 * Update institute configuration.
 *
 * Arguments: instituteId: string, input: UpdateInstituteInput
 * Permission: Super Admin only
 * Tables: institutes
 * Response: ApiResponse<Institute>
 */

/**
 * SUSPEND INSTITUTE
 * Deactivate an institute, preventing all access.
 *
 * Arguments: instituteId: string
 * Permission: Super Admin only
 * Side Effects: Sets isActive = false. All teachers/students lose access via RLS.
 * Tables: institutes
 * Response: ApiResponse<void>
 */

/**
 * ACTIVATE INSTITUTE
 * Reactivate a suspended institute.
 *
 * Arguments: instituteId: string
 * Permission: Super Admin only
 * Tables: institutes
 * Response: ApiResponse<void>
 */

/**
 * DELETE INSTITUTE
 * Hard delete institute (Super Admin only — use with extreme caution).
 *
 * Arguments: instituteId: string
 * Permission: Super Admin only
 * Tables: institutes (cascades to all dependent tables)
 * Response: ApiResponse<void>
 */
```

### 5.2 AdminTeacherService (NEW — orchestrates existing services)

```typescript
// ─── Method Contracts ─────────────────────────────────────────────

/**
 * CREATE TEACHER
 * Creates a new teacher account and profile.
 *
 * Orchestrates:
 *   1. authService.signUp({ phone, password, name })
 *     - Creates auth user with Supabase
 *     - Database trigger creates profiles row
 *   2. Update profiles: set role = 'teacher', institute_id
 *   3. Insert into teacher_details: profile_id, department, designation, etc.
 *   4. Optionally insert into teacher_specializations
 *   5. Optionally link to batches via batch_teachers
 *
 * Arguments: {
 *   phone: string;
 *   password: string;
 *   fullName: string;
 *   instituteId: string;
 *   department?: string;
 *   designation?: string;
 *   specialization?: string;
 *   qualification?: string;
 *   batchIds?: string[];
 *   subjectIds?: string[];
 * }
 *
 * Validation:
 * - Phone must be valid format (+911234567890)
 * - Password minimum 6 characters
 * - Full name required (min 2 chars)
 * - Institute must exist and be active
 *
 * Permission: Super Admin or Institute Admin
 *
 * Success Response: ApiResponse<{
 *   profileId: string;
 *   teacherId: string;
 *   credentials: { phone: string; temporaryPassword: string }
 * }>
 *
 * Failure Response: ApiResponse<null> with error string
 *
 * Related Tables: profiles, teacher_details, teacher_specializations, batch_teachers
 */

/**
 * UPDATE TEACHER
 * Update teacher profile and assignments.
 *
 * Arguments: teacherId: string, input: UpdateTeacherInput
 *   (fullName, department, designation, specialization, qualification,
 *    isActive, batchIds, subjectIds, streamIds)
 *
 * Permission: Super Admin or Institute Admin
 *
 * Tables: profiles, teacher_details, teacher_specializations, batch_teachers
 */

/**
 * SUSPEND TEACHER
 * Deactivate a teacher account.
 *
 * Arguments: teacherId: string
 * Permission: Super Admin or Institute Admin
 * Tables: profiles (is_active = false)
 * Response: ApiResponse<void>
 */

/**
 * ACTIVATE TEACHER
 * Reactivate a suspended teacher.
 *
 * Arguments: teacherId: string
 * Permission: Super Admin or Institute Admin
 * Tables: profiles (is_active = true)
 * Response: ApiResponse<void>
 */

/**
 * RESET TEACHER PASSWORD
 * Reset teacher's password to a temporary one.
 *
 * Arguments: teacherId: string
 * Permission: Super Admin only
 * Tables: uses authService.updatePassword()
 * Response: ApiResponse<{ temporaryPassword: string }>
 */

/**
 * ASSIGN TEACHER SUBJECTS
 * Assign subjects to a teacher.
 *
 * Arguments: teacherId: string, subjectIds: string[]
 * Orchestrates: teacher_specializations insert/delete
 * Permission: Super Admin or Institute Admin
 * Tables: teacher_specializations
 */

/**
 * ASSIGN TEACHER BATCHES
 * Assign batches to a teacher.
 *
 * Arguments: teacherId: string, batchIds: string[]
 * Orchestrates: batch_teachers insert/delete
 * Permission: Super Admin or Institute Admin
 * Tables: batch_teachers
 */

/**
 * GET TEACHER ACTIVITY
 * View teacher's recent activity log.
 *
 * Arguments: teacherId: string, pagination?
 * Uses: profileService.getTeacherActivity(teacherId)
 * Permission: Super Admin or Institute Admin
 */

/**
 * GET TEACHER ANALYTICS
 * View teacher's performance analytics.
 *
 * Arguments: teacherId: string
 * Uses: analyticsService / teacherAnalyticsService
 * Permission: Super Admin or Institute Admin
 */

/**
 * GET TEACHERS (list)
 * Paginated list of teachers with filters.
 *
 * Arguments: filters?: { instituteId, isActive, search, department, batchId,
 *             subjectId, status }, pagination?
 * Permission: Super Admin or Institute Admin
 * Tables: profiles (joined with teacher_details)
 * Response: ApiResponse<PaginatedResponse<TeacherSummary>>
 */
```

### 5.3 AdminStudentService (NEW)

```typescript
// ─── Method Contracts ─────────────────────────────────────────────

/**
 * CREATE STUDENT
 * Creates a new student account.
 *
 * Orchestrates:
 *   1. authService.signUp({ phone, password, name })
 *   2. Update profiles: set role = 'student', institute_id
 *   3. Insert into student_details
 *   4. Optionally link to batches via batch_students
 *
 * Permission: Super Admin or Institute Admin
 */

/**
 * GET STUDENTS
 * Paginated list of students with filters.
 *
 * Filters: { instituteId, batchId, streamId, search, isActive }
 * Tables: profiles (joined with student_details)
 * Permission: Super Admin or Institute Admin
 */

/**
 * SUSPEND STUDENT
 * Deactivate a student account.
 *
 * Tables: profiles (is_active = false)
 * Permission: Super Admin or Institute Admin
 */

/**
 * ACTIVATE STUDENT
 * Reactivate a suspended student.
 *
 * Permission: Super Admin or Institute Admin
 */

/**
 * RESET STUDENT PASSWORD
 * Reset student's password.
 *
 * Permission: Super Admin or Institute Admin
 */

/**
 * ASSIGN STUDENT BATCHES
 * Enroll student in batches.
 *
 * Tables: batch_students
 * Permission: Super Admin or Institute Admin
 */

/**
 * GET STUDENT RESULTS
 * View all results for a student.
 *
 * Uses: mockResultService.getStudentResults(studentId)
 * Permission: Super Admin or Institute Admin
 */

/**
 * GET STUDENT ANALYTICS
 * View student's performance analytics.
 *
 * Permission: Super Admin or Institute Admin
 */
```

### 5.4 AdminApprovalService (NEW — orchestration wrapper)

```typescript
// ─── Method Contracts ─────────────────────────────────────────────

/**
 * GET PENDING APPROVALS (Dashboard)
 * Returns pending approvals grouped by resource type for the dashboard.
 *
 * Returns: { content: ApprovalRequest[], mockTests: ApprovalRequest[], total: number }
 * Uses: approvalService.getPendingApprovals(instituteId)
 */

/**
 * APPROVE CONTENT
 * Orchestrates content approval workflow.
 *
 * Steps:
 *   1. approvalService.approveRequest({ approvalId, reviewedBy, remarks })
 *   2. notificationService.notifyContentUploaded(...content info...)
 *
 * Invalidates: ['approvals', 'content', 'questions']
 */

/**
 * REJECT CONTENT
 * Orchestrates content rejection workflow.
 *
 * Steps:
 *   1. approvalService.rejectRequest({ approvalId, reviewedBy, remarks })
 *   2. Send rejection notification to teacher
 *
 * Invalidates: ['approvals', 'content']
 */

/**
 * APPROVE MOCK TEST
 * Orchestrates mock test approval workflow.
 *
 * Steps:
 *   1. mockTestPublishService.publishMockTestWorkflow(testId)
 *   2. Optionally notify students
 *
 * Invalidates: ['approvals', 'mockTests']
 */

/**
 * BATCH APPROVE
 * Approve multiple pending items at once.
 *
 * Arguments: items: Array<{ approvalId: string }>
 * Orchestrates: loops approveRequest() — future use database RPC
 */

/**
 * ASSIGN REVIEWER
 * Assign an admin to review a pending item.
 *
 * Uses: approvalService.assignReviewer(approvalId, reviewerId)
 */
```

### 5.5 AdminAnalyticsService (NEW)

```typescript
// ─── Method Contracts ─────────────────────────────────────────────

/**
 * GET DASHBOARD STATS
 * Aggregate stats for the admin home dashboard.
 *
 * Computes:
 *   - totalInstitutes (Super Admin only)
 *   - totalTeachers (institute-scoped)
 *   - totalStudents (institute-scoped)
 *   - totalMockTests
 *   - totalQuestions
 *   - pendingApprovals (count)
 *   - todayActivity (today's attempts, registrations)
 *   - recentRegistrations (last 10 students)
 *   - upcomingLiveClasses (future scheduled classes)
 *   - recentNotifications
 *   - systemHealth (storage usage, API status)
 *
 * Tables: mock_results, mock_attempts, mock_tests, questions,
 *          profiles, approval_requests, notifications
 *
 * Permission: Super Admin or Institute Admin
 */

/**
 * GET INSTITUTE ANALYTICS
 * Comprehensive analytics for single institute.
 *
 * Returns:
 *   - totalStudents, totalTeachers
 *   - totalMockTests, totalAttempts
 *   - averageScore, averageAccuracy
 *   - topStudents, topTeachers
 *   - subjectWisePerformance
 *   - monthlyGrowth
 *
 * Uses aggregations over mock_results, profiles, subjects
 */

/**
 * GET TEACHER ANALYTICS (Admin View)
 * Teacher performance from admin perspective.
 *
 * Returns:
 *   - testsCreated, questionsCreated
 *   - totalStudentsReached
 *   - averageStudentScore
 *   - completionRate
 *   - subjectPerformance
 */

/**
 * GET STUDENT ANALYTICS (Admin View)
 * Student performance from admin perspective.
 *
 * Returns:
 *   - testsAttempted, averageScore
 *   - strongSubjects, weakSubjects
 *   - performanceTrend
 *   - recentActivity
 */

/**
 * GENERATE REPORT
 * Generate a downloadable report in CSV/PDF format.
 *
 * Arguments: { type: 'teacher' | 'student' | 'payment' | 'attendance',
 *              dateRange, instituteId, format: 'csv' | 'pdf' }
 *
 * Returns: { downloadUrl: string }
 */

/**
 * EXPORT DATA
 * Export filtered data as CSV.
 *
 * Arguments: { module: 'teachers' | 'students' | 'questions' | 'results',
 *              filters, dateRange }
 *
 * Returns: { downloadUrl: string }
 */
```

### 5.6 AdminNotificationService (NEW — orchestration wrapper)

```typescript
// ─── Method Contracts ─────────────────────────────────────────────

/**
 * SEND BROADCAST
 * Send notification to all users in an institute.
 *
 * Orchestrates:
 *   1. Fetch all student/teacher profile IDs for the institute
 *   2. notificationService.createBulkNotification()
 *
 * Target roles: 'all' | 'students' | 'teachers'
 */

/**
 * SEND CUSTOM NOTIFICATION
 * Send notification to specific users.
 *
 * Arguments: { recipientIds, title, body, eventType, referenceType, referenceId }
 * Uses: notificationService.createBulkNotification()
 */

/**
 * SEND ANNOUNCEMENT
 * Publish an announcement to all users.
 *
 * Uses: notificationService.publishAnnouncement()
 */

/**
 * SCHEDULE NOTIFICATION
 * Schedule a notification for future delivery.
 *
 * NOTE: Requires a background job infrastructure (future).
 *       For Phase 1, notifications are sent immediately.
 */

/**
 * DELETE NOTIFICATION
 * Soft-delete a notification event.
 *
 * Uses: notificationService.deleteNotification(notificationId)
 */

/**
 * GET NOTIFICATION TEMPLATES
 * List available notification templates.
 *
 * Tables: notification_templates
 * Permission: Super Admin or Institute Admin
 */

/**
 * CREATE/UPDATE NOTIFICATION TEMPLATE
 * Manage notification templates.
 *
 * Tables: notification_templates
 */
```

### 5.7 AdminPaymentService (NEW)

```typescript
// ─── Method Contracts ─────────────────────────────────────────────

/**
 * GET PAYMENTS
 * List subscription payments with filters.
 *
 * Filters: { instituteId, dateRange, status, paymentMethod }
 * Tables: payments / subscriptions
 */

/**
 * GET SUBSCRIPTIONS
 * List institute subscriptions.
 *
 * Tables: subscriptions
 */

/**
 * CREATE COUPON
 * Create a discount coupon.
 *
 * Tables: coupons
 */

/**
 * GET COUPONS
 * List discount coupons.
 *
 * Tables: coupons
 */

/**
 * UPDATE COUPON
 * Update coupon configuration.
 *
 * Tables: coupons
 */

/**
 * GET INVOICES
 * List invoices for an institute.
 *
 * Tables: invoices
 */

/**
 * MANUAL REFUND
 * Process a manual refund.
 *
 * NOTE: Payment gateway integration required for automatic refunds.
 *       Phase 1: manual flag in database.
 * Tables: payments
 */
```

### 5.8 AdminRoleService (NEW)

```typescript
// ─── Method Contracts ─────────────────────────────────────────────

/**
 * GET USERS BY ROLE
 * List users filtered by role.
 *
 * Arguments: { role: 'admin' | 'teacher' | 'student', instituteId, pagination }
 * Tables: profiles
 */

/**
 * CHANGE USER ROLE
 * Change a user's role.
 *
 * Arguments: { profileId: string, newRole: UserRole }
 * Tables: profiles (role column)
 * Permission: Super Admin only
 */

/**
 * GET PERMISSIONS
 * List all permissions for a role.
 *
 * NOTE: Phase 1 uses RLS policies directly.
 *       Future: custom permission table.
 */
```

### 5.9 AdminSettingsService (NEW — wraps existing)

```typescript
// ─── Method Contracts ─────────────────────────────────────────────

/**
 * GET INSTITUTE SETTINGS
 * Fetch configuration for an institute.
 *
 * Uses: settingsService
 * Tables: institute_settings or similar
 */

/**
 * UPDATE INSTITUTE SETTINGS
 * Update institute configuration.
 *
 * Fields: branding, notificationDefaults, featureFlags, etc.
 * Tables: institute_settings
 */

/**
 * GET SYSTEM SETTINGS
 * Global system configuration (Super Admin only).
 */

/**
 * UPDATE SYSTEM SETTINGS
 * Update global system settings.
 */
```

### 5.10 AdminAuditLogService (NEW)

```typescript
// ─── Method Contracts ─────────────────────────────────────────────

/**
 * GET AUDIT LOGS
 * Paginated audit trail with filters.
 *
 * Filters: { userId, action, resourceType, resourceId, dateRange, instituteId }
 *
 * NOTE: Phase 1 uses existing table audit columns (created_at, updated_by).
 *       Future: dedicated audit_logs table with triggers.
 */
```

### 5.11 AdminSupportService (NEW)

```typescript
// ─── Method Contracts ─────────────────────────────────────────────

/**
 * GET TICKETS
 * List support tickets.
 *
 * Filters: { status, priority, instituteId, dateRange }
 * Tables: support_tickets
 */

/**
 * GET TICKET
 * Single support ticket with messages.
 */

/**
 * UPDATE TICKET STATUS
 * Change ticket status (open → in_progress → resolved → closed).
 */

/**
 * ADD TICKET NOTE
 * Internal admin note on a ticket.
 */

/**
 * ASSIGN TICKET
 * Assign ticket to an admin.
 */
```

### 5.12 AdminMediaService (NEW — wraps storageService)

```typescript
// ─── Method Contracts ─────────────────────────────────────────────

/**
 * UPLOAD MEDIA
 * Upload a file to the institute's media library.
 *
 * Uses: storageService.uploadResource()
 */

/**
 * GET MEDIA
 * List uploaded media files.
 */

/**
 * DELETE MEDIA
 * Delete a media file from storage.
 *
 * Uses: storageService.deleteFile()
 */

/**
 * GENERATE SIGNED URL
 * Get a signed URL for a media file.
 *
 * Uses: storageService.generateSignedUrl()
 */
```

### 5.13 AdminSystemHealthService (NEW)

```typescript
// ─── Method Contracts ─────────────────────────────────────────────

/**
 * GET SYSTEM HEALTH
 * Check system health metrics.
 *
 * Returns: {
 *   storage: { used, available, percentageUsed },
 *   apiLatency: number,
 *   activeUsers: number,
 *   databaseSize: string,
 *   lastBackup: string | null,
 *   serviceStatus: 'healthy' | 'degraded' | 'down'
 * }
 *
 * NOTE: Phase 1 — basic metrics. Phase 2 — comprehensive monitoring.
 */
```

---

## 6. Database Mapping

### 6.1 Tables Read by Admin Dashboard (without modification)

| Table | Admin Module | Key Columns |
|-------|-------------|-------------|
| `institutes` | Institute Management, Dashboard | institute_id, name, slug, is_active |
| `profiles` | Teacher/Student Management | profile_id, institute_id, role, name, email, phone, is_active |
| `teacher_details` | Teacher Management | teacher_id, profile_id, department, designation, specialization |
| `student_details` | Student Management | student_id, profile_id, batch_id |
| `streams` | Academic Management | stream_id, institute_id, name, code |
| `subjects` | Academic Management | subject_id, stream_id, name, code |
| `chapters` | Academic Management | chapter_id, subject_id, name |
| `topics` | Academic Management | topic_id, chapter_id, name |
| `batches` | Batch Management | batch_id, institute_id, stream_id, name, status |
| `batch_teachers` | Teacher Assignment | batch_id, teacher_id |
| `batch_students` | Student Assignment | batch_id, student_id |
| `teacher_specializations` | Teacher Assignment | teacher_id, subject_id |
| `questions` | Question Bank, Approval | question_id, institute_id, status, created_by |
| `question_options` | Question Bank | option_id, question_id, option_text, is_correct |
| `question_images` | Question Bank | image_id, question_id, storage_path |
| `question_explanations` | Question Bank | explanation_id, question_id, explanation_text |
| `mock_tests` | Mock Test Management | test_id, institute_id, teacher_id, status |
| `mock_test_questions` | Mock Test Management | test_id, question_id, marks |
| `mock_attempts` | Results | attempt_id, test_id, student_id, status |
| `mock_results` | Results, Analytics | result_id, attempt_id, total_score, is_released |
| `mock_answers` | Results, Analytics | answer_id, attempt_id, is_correct |
| `notifications` | Notification Management | notification_id, institute_id, title, event_type |
| `notification_recipients` | Notification Management | recipient_id, notification_id, profile_id, is_read |
| `approval_requests` | Approval Center | approval_id, institute_id, resource_type, status |
| `content` | Content Management | content_id, institute_id, teacher_id, status |
| `content_tag` | Content Management | content_id, tag_id |
| `tags` | Content Management | tag_id, institute_id, name |
| `subscriptions` | Payments | subscription_id, institute_id, plan, end_date |
| `payments` | Payments | payment_id, institute_id, amount, status |
| `coupons` | Payments | coupon_id, code, discount, expires_at |
| `live_classes` | Live Classes (future) | class_id, institute_id, teacher_id, scheduled_at |
| `support_tickets` | Support | ticket_id, institute_id, user_id, status |
| `audit_logs` | Audit (future) | log_id, user_id, action, resource_type, timestamp |

### 6.2 Tables Modified by Admin Dashboard

| Table | Admin Action | Columns Modified |
|-------|-------------|------------------|
| `institutes` | Create, Update, Suspend | All columns, is_active |
| `profiles` | Create, Update Role, Suspend | name, role, is_active |
| `teacher_details` | Create, Update | department, designation, specialization |
| `student_details` | Create, Update | batch_id, enrollment_date |
| `questions` | Approve, Archive, Restore | status, approved_by, approved_at |
| `mock_tests` | Publish, Archive, Restore | status, published_at |
| `mock_results` | Release, Hide | is_released, released_at |
| `approval_requests` | Approve, Reject | status, reviewed_by, reviewed_at, remarks |
| `notifications` | Send, Delete | Insert + soft-delete |
| `notification_recipients` | Broadcast | Bulk insert |
| `batches` | Create, Close, Archive | All columns, status |
| `streams` | Create, Update | All columns |
| `subjects` | Create, Update | All columns |
| `chapters` | Create, Update | All columns |
| `topics` | Create, Update | All columns |

### 6.3 Audit Columns Convention

Every table follows this pattern for audit:

- `created_at`: TIMESTAMPTZ — set on INSERT (DB default `NOW()`)
- `updated_at`: TIMESTAMPTZ — set on UPDATE (DB trigger `update_updated_at_column()`)
- `created_by`: FK → `profiles.profile_id` — set on INSERT
- `updated_by`: FK → `profiles.profile_id` — set on UPDATE

Additional audit columns for approval workflow:

- `approved_by`: FK → `profiles.profile_id` — set when status changes to 'published' or 'approved'
- `approved_at` / `published_at`: TIMESTAMPTZ — set at approval time

---

## 7. Permission Matrix

### 7.1 Role Definitions

| Role | Description |
|------|-------------|
| `super_admin` | Platform-level admin (accesses all institutes, manages system config) |
| `institute_admin` | Institute-level admin (manages a single institute) |
| `teacher` | Content creator (creates questions, mock tests, content) |
| `student` | End-user (takes tests, views results) |

> **Note:** The current schema uses `profiles.role = 'admin'` for both Super Admin and Institute Admin. The distinction is made via `institute_id`:
> - Super Admin: `institute_id IS NULL`
> - Institute Admin: `institute_id IS NOT NULL` and belongs to that institute

### 7.2 Permission Matrix

| Module / Operation | Super Admin | Institute Admin | Teacher | Student |
|-------------------|-------------|-----------------|---------|---------|
| **Institutes** | | | | |
| View All | ✅ | ❌ | ❌ | ❌ |
| View Own | ✅ | ✅ | ✅ | ✅ |
| Create | ✅ | ❌ | ❌ | ❌ |
| Update | ✅ | ❌ | ❌ | ❌ |
| Suspend | ✅ | ❌ | ❌ | ❌ |
| **Teachers** | | | | |
| View All (Institute) | ✅ | ✅ | ❌ | ❌ |
| View Profile | ✅ | ✅ | Own | ❌ |
| Create | ✅ | ✅ | ❌ | ❌ |
| Update | ✅ | ✅ | Own | ❌ |
| Suspend | ✅ | ✅ | ❌ | ❌ |
| Assign Subjects | ✅ | ✅ | ❌ | ❌ |
| Assign Batches | ✅ | ✅ | ❌ | ❌ |
| Reset Password | ✅ | ✅ | ❌ | ❌ |
| **Students** | | | | |
| View All (Institute) | ✅ | ✅ | ❌ | ❌ |
| View Profile | ✅ | ✅ | ❌ | Own |
| Create | ✅ | ✅ | ❌ | ❌ |
| Update | ✅ | ✅ | ❌ | Own |
| Suspend | ✅ | ✅ | ❌ | ❌ |
| Assign Batches | ✅ | ✅ | ❌ | ❌ |
| Reset Password | ✅ | ✅ | ❌ | ❌ |
| View Results | ✅ | ✅ | ❌ | Own |
| View Analytics | ✅ | ✅ | ❌ | Own |
| **Academic** | | | | |
| View Streams | ✅ | ✅ | ✅ | ✅ |
| Create/Update Streams | ✅ | ✅ | ❌ | ❌ |
| Delete Streams | ✅ | ❌ | ❌ | ❌ |
| View Subjects | ✅ | ✅ | ✅ | ✅ |
| Create/Update Subjects | ✅ | ✅ | ❌ | ❌ |
| Delete Subjects | ✅ | ❌ | ❌ | ❌ |
| View Chapters | ✅ | ✅ | ✅ | ✅ |
| Create/Update Chapters | ✅ | ✅ | ❌ | ❌ |
| View Topics | ✅ | ✅ | ✅ | ✅ |
| Create/Update Topics | ✅ | ✅ | ❌ | ❌ |
| **Batches** | | | | |
| View All | ✅ | ✅ | Assigned | Enrolled |
| Create | ✅ | ✅ | ❌ | ❌ |
| Update | ✅ | ✅ | ❌ | ❌ |
| Close/Archive | ✅ | ✅ | ❌ | ❌ |
| **Question Bank** | | | | |
| View All | ✅ | ✅ | ✅ | ❌ |
| View Individual | ✅ | ✅ | Own | During/After attempt |
| Create | ✅ | ❌ | ✅ | ❌ |
| Submit for Approval | ✅ | ❌ | ✅ | ❌ |
| Approve | ✅ | ✅ | ❌ | ❌ |
| Reject | ✅ | ✅ | ❌ | ❌ |
| Archive | ✅ | ✅ | Own (drafts) | ❌ |
| Restore | ✅ | ✅ | ❌ | ❌ |
| Delete | ✅ | ❌ | Draft only | ❌ |
| **Mock Tests** | | | | |
| View All | ✅ | ✅ | ✅ | ❌ |
| View Published | ✅ | ✅ | Own | ✅ |
| Create | ✅ | ❌ | ✅ | ❌ |
| Update | ✅ | ❌ | Own (draft) | ❌ |
| Publish | ✅ | ✅ | ❌ | ❌ |
| Unpublish | ✅ | ✅ | ❌ | ❌ |
| Archive | ✅ | ✅ | Own | ❌ |
| Delete | ✅ | ❌ | Draft only | ❌ |
| **Results** | | | | |
| View All | ✅ | ✅ | ✅ | Own |
| Release | ✅ | ✅ | ❌ | ❌ |
| Hide | ✅ | ✅ | ❌ | ❌ |
| Export | ✅ | ✅ | ✅ | Own |
| **Approvals** | | | | |
| View Pending | ✅ | ✅ | ❌ | ❌ |
| Approve | ✅ | ✅ | ❌ | ❌ |
| Reject | ✅ | ✅ | ❌ | ❌ |
| Assign Reviewer | ✅ | ✅ | ❌ | ❌ |
| View History | ✅ | ✅ | Own | ❌ |
| **Notifications** | | | | |
| View All | ✅ | ✅ | Own | Own |
| Send Broadcast | ✅ | ✅ | ❌ | ❌ |
| Send Custom | ✅ | ✅ | ❌ | ❌ |
| Create Templates | ✅ | ❌ | ❌ | ❌ |
| Delete | ✅ | ✅ | ❌ | ❌ |
| **Analytics** | | | | |
| Institute Dashboard | ✅ | ✅ | ❌ | ❌ |
| Teacher Analytics | ✅ | ✅ | Own | ❌ |
| Student Analytics | ✅ | ✅ | ❌ | Own |
| Export Reports | ✅ | ✅ | ❌ | ❌ |
| **Payments** | | | | |
| View Payments | ✅ | ✅ | ❌ | ❌ |
| Manage Coupons | ✅ | ✅ | ❌ | ❌ |
| Process Refund | ✅ | ❌ | ❌ | ❌ |
| **Content Library** | | | | |
| View All | ✅ | ✅ | ✅ | Assigned |
| Approve | ✅ | ✅ | ❌ | ❌ |
| Archive | ✅ | ✅ | Own | ❌ |
| Delete | ✅ | ❌ | Draft only | ❌ |
| **Settings** | | | | |
| Institute Settings | ✅ | ✅ | ❌ | ❌ |
| System Settings | ✅ | ❌ | ❌ | ❌ |
| **Audit Logs** | | | | |
| View All | ✅ | Institute | ❌ | ❌ |
| Export | ✅ | ✅ | ❌ | ❌ |
| **Support Tickets** | | | | |
| View All | ✅ | ✅ | Own | Own |
| Update Status | ✅ | ✅ | ❌ | ❌ |
| Assign | ✅ | ✅ | ❌ | ❌ |
| **Media Library** | | | | |
| View | ✅ | ✅ | ✅ | ❌ |
| Upload | ✅ | ✅ | ✅ | ❌ |
| Delete | ✅ | ✅ | Own | ❌ |
| **System Health** | | | | |
| View | ✅ | ❌ | ❌ | ❌ |
| **Manage Admins** | | | | |
| Create Institute Admin | ✅ | ❌ | ❌ | ❌ |
| View All Admins | ✅ | ❌ | ❌ | ❌ |
| Suspend Admin | ✅ | ❌ | ❌ | ❌ |

### 7.3 RLS Policy Pattern

The existing RLS policies (Migration 021) are the primary access control mechanism. Admin Dashboard queries are subject to the same RLS policies as all other queries. The admin service layer adds `institute_id` filters as a secondary safeguard.

Key RLS patterns:

```sql
-- Institute isolation (applied to most tables)
CREATE POLICY "Users can view their own institute's data" ON questions
  FOR SELECT USING (
    institute_id IN (
      SELECT institute_id FROM profiles WHERE profile_id = auth.uid()
    )
  );

-- Admin write access
CREATE POLICY "Admins can update any question status" ON questions
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profile_id = auth.uid()
      AND role IN ('admin', 'super_admin')
    )
  );
```

---

## 8. Validation Contracts

### 8.1 Entity Validation Rules

```typescript
// ─── Institute ─────────────────────────────────────────────────────

const instituteValidation = {
  name: {
    required: true,
    minLength: 2,
    maxLength: 200,
    error: 'Institute name is required (2-200 characters).'
  },
  slug: {
    required: true,
    minLength: 2,
    maxLength: 100,
    pattern: /^[a-z0-9-]+$/,
    unique: true,
    error: 'Slug must be lowercase alphanumeric with hyphens only.'
  },
  code: {
    required: true,
    minLength: 2,
    maxLength: 20,
    pattern: /^[A-Z0-9-]+$/,
    error: 'Code must be uppercase alphanumeric (2-20 characters).'
  },
  email: {
    required: false,
    maxLength: 255,
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    error: 'Please enter a valid email address.'
  },
  phone: {
    required: false,
    pattern: /^\+[1-9]\d{6,14}$/,
    error: 'Phone must be in international format (e.g. +911234567890).'
  },
  maxTeachers: {
    required: false,
    minValue: 0,
    type: 'integer',
    error: 'maxTeachers must be a positive integer or empty for unlimited.'
  },
  maxStudents: {
    required: false,
    minValue: 0,
    type: 'integer',
    error: 'maxStudents must be a positive integer or empty for unlimited.'
  }
};

// ─── Teacher ───────────────────────────────────────────────────────

const teacherValidation = {
  phone: {
    required: true,
    pattern: /^\+[1-9]\d{6,14}$/,
    unique: true,
    error: 'Please enter a valid mobile number with country code (e.g. +919876543210).'
  },
  fullName: {
    required: true,
    minLength: 2,
    maxLength: 200,
    error: 'Full name is required (2-200 characters).'
  },
  password: {
    required: true,
    minLength: 6,
    maxLength: 100,
    error: 'Password must be at least 6 characters.'
  },
  department: {
    required: false,
    maxLength: 100,
    error: 'Department must not exceed 100 characters.'
  },
  designation: {
    required: false,
    maxLength: 100,
    error: 'Designation must not exceed 100 characters.'
  },
  specialization: {
    required: false,
    maxLength: 200,
    error: 'Specialization must not exceed 200 characters.'
  },
  qualification: {
    required: false,
    maxLength: 500,
    error: 'Qualification must not exceed 500 characters.'
  }
};

// ─── Student ───────────────────────────────────────────────────────

const studentValidation = {
  phone: {
    required: true,
    pattern: /^\+[1-9]\d{6,14}$/,
    unique: true,
    error: 'Please enter a valid mobile number with country code.'
  },
  fullName: {
    required: true,
    minLength: 2,
    maxLength: 200,
    error: 'Full name is required (2-200 characters).'
  },
  password: {
    required: true,
    minLength: 6,
    error: 'Password must be at least 6 characters.'
  },
  enrollmentNumber: {
    required: false,
    maxLength: 50,
    error: 'Enrollment number must not exceed 50 characters.'
  }
};

// ─── Batch ─────────────────────────────────────────────────────────

const batchValidation = {
  name: {
    required: true,
    minLength: 3,
    maxLength: 200,
    error: 'Batch name is required (3-200 characters).'
  },
  batchCode: {
    required: true,
    minLength: 2,
    maxLength: 30,
    error: 'Batch code is required (2-30 characters).'
  },
  academicYear: {
    required: true,
    pattern: /^\d{4}-\d{2}$/,
    error: 'Academic year must be in YYYY-YY format (e.g. 2025-26).'
  },
  startDate: {
    required: true,
    type: 'date',
    error: 'Start date is required.'
  },
  endDate: {
    required: true,
    type: 'date',
    validation: 'endDate must be after startDate.',
    error: 'End date is required and must be after start date.'
  },
  maxSeats: {
    required: false,
    minValue: 1,
    type: 'integer',
    error: 'Max seats must be a positive integer or null (unlimited).'
  }
};

// ─── Subject / Stream / Chapter / Topic ────────────────────────────

const academicValidation = {
  name: {
    required: true,
    minLength: 2,
    maxLength: 200,
    error: 'Name is required (2-200 characters).'
  },
  code: {
    required: true,
    minLength: 2,
    maxLength: 20,
    pattern: /^[A-Z][A-Z0-9-]*$/,
    error: 'Code must be uppercase alphanumeric starting with a letter.'
  },
  displayOrder: {
    required: false,
    minValue: 0,
    type: 'integer',
    error: 'Display order must be a non-negative integer.'
  }
};
```

---

## 9. Error Contracts

### 9.1 Common Error Types

```typescript
// Every service method returns ApiResponse<T>:
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  warning?: string;
}

// All errors are string messages, never raw exception objects.
// extractErrorMessage() normalizes the error shape.
```

### 9.2 Error Categories

| Category | Example | HTTP Equivalent | Recovery Strategy |
|----------|---------|-----------------|-------------------|
| Validation | "Name is required (2-200 characters)." | 400 | Show inline form error |
| Authentication | "No authenticated user found." | 401 | Redirect to login |
| Authorization | "Only Super Admins can create institutes." | 403 | Show permission denied toast |
| Not Found | "Institute not found: uuid-here" | 404 | Show "not found" page |
| Duplicate | "A teacher with this phone number already exists." | 409 | Show duplicate field error |
| FK Constraint | "Cannot delete stream: it has associated subjects." | 409 | Show dependency error |
| Business Rule | "Cannot publish a test with status 'published'." | 422 | Show state machine error |
| Storage | "File size exceeds maximum of 10 MB." | 413 | Show upload error |
| Network | "Database connection failed." | 500 | Show retry toast |
| Rate Limit | "Too many requests. Please try again later." | 429 | Show rate limit message |

### 9.3 Validation Error Handling

```
UI Layer:
  1. Form validation (client-side):
     - Required fields: Red border + error text below field
     - Pattern validation: Error text explaining correct format
     - Min/max length: Character counter + validation on blur
  
  2. Server validation (service layer):
     - Service returns ApiResponse with success: false + error string
     - Hook returns the error to the component
     - Component shows toast notification with error message
     - For field-level errors: set individual field errors from the message

  3. Business rule validation:
     - Service returns specific error explaining the rule violation
     - E.g., "Cannot delete this stream because it has associated subjects."
     - UI shows a dialog with the explanation and suggests actions
```

### 9.4 Permission Error Handling

```
When a user performs an action they don't have permission for:

  1. React Query mutation returns error
  2. RLS policy blocks the operation (PostgrestError with code 42501)
  3. Service's extractErrorMessage normalises to:
     "You do not have permission to perform this action."
  4. UI shows a toast: "Access Denied — You don't have permission to X"
  5. For navigation-based restrictions, the sidebar route guard redirects
     with a message: "This section is not available for your role."
```

### 9.5 Network Error Handling

```
When a network request fails:

  1. React Query detects the network error
  2. Service returns: { success: false, error: "Network error. Please check your connection." }
  3. If RetryPolicy.pending in React Query config:
     - Auto-retry up to 3 times with exponential backoff
     - Show "Retrying..." indicator
  4. If all retries exhausted:
     - Show full-page error state with "Retry" button
     - Or inline banner: "Unable to load data. [Retry]"
  5. For mutations:
     - Show error toast with "Retry" action
     - Keep optimistic update (don't roll back until user confirms)
```

---

## 10. React Query Cache Strategy

### 10.1 Cache Configuration

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
      refetchOnWindowFocus: false, // Admin dashboard: don't refetch on focus
      staleTime: 5 * 60 * 1000,   // 5 minutes default stale time
      gcTime: 30 * 60 * 1000,     // 30 minutes garbage collection
    },
    mutations: {
      retry: 1,
    },
  },
});
```

### 10.2 Per-Hook Cache Configuration

| Hook Group | Stale Time | GC Time | Refetch on Window Focus | Refetch Interval |
|------------|-----------|---------|------------------------|------------------|
| Dashboard Stats | 5 min | 30 min | true | None |
| List Hooks (teachers, students) | 2 min | 30 min | false | None |
| Detail Hooks (single entity) | 5 min | 30 min | false | None |
| Academic Hooks (streams, subjects) | 10 min | 60 min | false | None |
| Approval Hooks | 1 min | 10 min | true | 30 sec (polling) |
| Notification Hooks | 1 min | 10 min | true | None |
| Result Hooks | 1 min | 10 min | true | None |
| Analytics Hooks | 10 min | 60 min | false | None |
| Settings Hooks | 10 min | 60 min | false | None |
| Audit Log Hooks | 2 min | 30 min | false | None |
| System Health | 30 min | 60 min | false | None (manual refresh) |

### 10.3 Mutation Invalidation Rules

| Mutation | Invalidates |
|----------|-------------|
| Create Institute | `['institutes']` |
| Update Institute | `['institutes', 'institute', id]` |
| Create Teacher | `['teachers']` |
| Update Teacher | `['teachers', 'teacher', id]` |
| Suspend Teacher | `['teachers', 'teacher', id]` |
| Create Student | `['students']` |
| Update Student | `['students', 'student', id]` |
| Approve Question | `['questions', 'approvals']` |
| Reject Question | `['questions', 'approvals']` |
| Publish Mock Test | `['mockTests', 'approvals']` |
| Release Result | `['results']` |
| Send Notification | `['notifications']` |
| Create Stream | `['streams']` |
| Update Stream | `['streams', 'stream', id]` |
| Create Batch | `['batches']` |
| Update Batch | `['batches', 'batch', id]` |
| Update Settings | `['settings']` |

### 10.4 Optimistic Update Examples

```typescript
// Approval optimistic update
const approveMutation = useMutation({
  mutationFn: (approvalId: string) => approvalService.approveRequest({
    approvalId,
    reviewedBy: currentAdminId,
    remarks,
  }),
  onMutate: async (approvalId) => {
    // Cancel outgoing queries
    await queryClient.cancelQueries({ queryKey: ['approvals'] });
    
    // Snapshot previous value
    const previous = queryClient.getQueriesData({ queryKey: ['approvals'] });
    
    // Optimistically update cache
    queryClient.setQueriesData({ queryKey: ['approvals'] }, (old: any) => {
      if (!old?.data) return old;
      return {
        ...old,
        data: old.data.map((req: any) =>
          req.approvalId === approvalId
            ? { ...req, status: 'approved', reviewedBy: currentAdminId }
            : req
        ),
      };
    });
    
    return { previous };
  },
  onError: (err, approvalId, context) => {
    // Rollback on error
    if (context?.previous) {
      context.previous.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
    }
  },
  onSettled: () => {
    // Always refetch
    queryClient.invalidateQueries({ queryKey: ['approvals'] });
    queryClient.invalidateQueries({ queryKey: ['questions'] });
  },
});
```

---

## 11. Authentication Contracts

### 11.1 Admin Login Flow

```
1. Admin enters phone (+919876543210) and password
2. Frontend calls authService.signIn({ phone, password })
3. Service validates input format
4. Service calls supabase.auth.signInWithPassword({ phone, password })
5. On success, service fetches profiles row to verify role === 'admin'
6. If role !== 'admin', return error: "Access denied: Admin privileges required."
7. On success, AuthContext updates user state with admin profile
8. App router redirects to /admin/dashboard
```

### 11.2 Session Validation

```
On app load:
  1. AuthProvider reads session via authService.getSession()
  2. If session exists and role === 'admin':
     - Load admin profile
     - Redirect to admin dashboard (if on login page)
  3. If session exists but role !== 'admin':
     - Show error: "This account does not have admin access."
     - Redirect to appropriate dashboard based on role
  4. If no session:
     - Show login page
```

### 11.3 Role Resolution

```
Resolution flow for every admin action:
  1. React component checks role from AuthContext
  2. For route access: middleware checks profiles.role from session
  3. For API access: Supabase RLS checks profiles.role directly in SQL
  4. For UI elements: conditional rendering based on role
```

### 11.4 Password Reset

```
Admin Password Reset:
  1. Admin clicks "Forgot Password" on login page
  2. Enter phone number
  3. Supabase sends SMS OTP
  4. Admin enters OTP
  5. authService.verifyOtp({ phone, token }) confirms identity
  6. authService.updatePassword(newPassword) sets new password
  7. Admin redirected to login
```

---

## 12. Sequence Diagrams

### 12.1 Create Teacher

```
Admin UI                  AdminTeacherSvc         authService         profiles        teacher_details
  │                          │                      │                   │                  │
  │──createTeacher(data)─────│                      │                   │                  │
  │                          │──signUp(input)───────│                   │                  │
  │                          │                      │──auth.signUp()────│                  │
  │                          │                      │<──user + session──│                  │
  │                          │                      │ (DB trigger       │                  │
  │                          │                      │  creates profiles)│                  │
  │                          │<──{ user }───────────│                   │                  │
  │                          │                                          │                  │
  │                          │──update profile role──────────────────>│                  │
  │                          │  to 'teacher', institute_id             │                  │
  │                          │<──success────────────────────────────────│                  │
  │                          │                                          │                  │
  │                          │──insert teacher_details──────────────────────────────>│
  │                          │  (department, designation, etc.)        │                  │
  │                          │<──success──────────────────────────────────────────────│
  │                          │                                          │                  │
  │                          │──assign subjects (if provided)           │                  │
  │                          │──assign batches (if provided)            │                  │
  │                          │                                          │                  │
  │<──{ teacherId,           │                                          │                  │
  │     credentials }────────│                                          │                  │
  │                                                                                      │
  │  [Show success toast: "Teacher created successfully.                                │
  │   Credentials sent to their phone."]                                                 │
```

### 12.2 Approve Content

```
Admin UI                AdminApprovalSvc     approvalService      contentService     notificationSvc
  │                          │                    │                    │                    │
  │──approveContent(id)──────│                    │                    │                    │
  │                          │──approveRequest()─>│                    │                    │
  │                          │                    │──update status      │                    │
  │                          │                    │  to 'approved'      │                    │
  │                          │                    │<──success           │                    │
  │                          │                    │                    │                    │
  │                          │<──{ request }──────│                    │                    │
  │                          │                                         │                    │
  │                          │──approveContent()────────────────────>│                    │
  │                          │  (content lifecycle)                    │                    │
  │                          │  status: pending_review → approved      │                    │
  │                          │  sets published_at                     │                    │
  │                          │<──success───────────────────────────────│                    │
  │                          │                                         │                    │
  │                          │──notifyContentUploaded()─────────────────────────────>│
  │                          │                                         │                    │
  │                          │<──success──────────────────────────────────────────────│
  │                          │                                         │                    │
  │<──{ request }────────────│                                         │                    │
  │                                                                                      │
  │  [Invalidate queries: ['approvals'], ['content'], ['dashboard']]                     │
  │  [Show success toast: "Content approved and published."]                              │
```

### 12.3 Publish Mock Test

```
Admin UI            AdminMockTestSvc     mockTestPublishSvc     mockTestService     notificationSvc
  │                      │                      │                     │                    │
  │──publishTest(id)─────│                      │                     │                    │
  │                      │──validateTest(id)───>│                     │                    │
  │                      │                      │──getMockTestById()─>│                    │
  │                      │                      │<──test──────────────│                    │
  │                      │                      │──getQuestions()────>│                    │
  │                      │                      │<──questions────────│                    │
  │                      │                      │                     │                    │
  │                      │<──{ isValid, errors }│                     │                    │
  │                      │                      │                     │                    │
  │                      │──publishWorkflow()──>│                     │                    │
  │                      │                      │──generateSnapshots()│                    │
  │                      │                      │──publishMockTest()─>│                    │
  │                      │                      │  (draft → published)│                    │
  │                      │                      │<──updated test─────│                    │
  │                      │<──{ summary }────────│                     │                    │
  │                      │                      │                     │                    │
  │                      │──notifyStudents()────────────────────────────────────────>│
  │                      │                      │                     │                    │
  │<──{ summary }────────│                      │                     │                    │
  │                                                                                      │
  │  [Invalidate: ['mockTests'], ['approvals'], ['dashboard']]                           │
  │  [Show toast: "Mock test published with ${count} questions."]                        │
```

---

## 13. Module Dependency Diagram

```
                          ┌──────────────────┐
                          │  Authentication  │
                          └────────┬─────────┘
                                   │
                                   ▼
                          ┌──────────────────┐
                          │    Dashboard     │
                          │  (Overview +     │
                          │   Quick Actions) │
                          └────────┬─────────┘
                                   │
            ┌──────────────────────┼──────────────────────┐
            │                      │                      │
            ▼                      ▼                      ▼
    ┌───────────────┐    ┌──────────────────┐    ┌──────────────────┐
    │   Institute   │    │     Teacher      │    │     Student      │
    │  Management   │───>│   Management     │───>│   Management     │
    └───────┬───────┘    └────────┬─────────┘    └────────┬─────────┘
            │                     │                       │
            ▼                     ▼                       │
    ┌───────────────┐    ┌──────────────────┐             │
    │  Academic     │    │    Approval      │             │
    │  Management   │    │    Center        │             │
    │               │    │                  │             │
    │  ┌─────────┐  │    │  ┌────────────┐  │             │
    │  │ Streams │  │    │  │ Content    │  │             │
    │  ├─────────┤  │    │  │ Approval   │  │             │
    │  │Subjects │  │    │  ├────────────┤  │             │
    │  ├─────────┤  │    │  │ Question   │  │             │
    │  │Chapters │  │    │  │ Approval   │  │             │
    │  ├─────────┤  │    │  ├────────────┤  │             │
    │  │ Topics  │  │    │  │ Mock Test  │  │             │
    │  └─────────┘  │    │  │ Approval   │  │             │
    └───────┬───────┘    └────────┬─────────┘             │
            │                     │                       │
            ▼                     ▼                       ▼
    ┌───────────────┐    ┌──────────────────┐    ┌──────────────────┐
    │    Batch      │    │   Question Bank  │    │     Results      │
    │  Management   │    │                  │    │                  │
    │               │    │  ┌────────────┐  │    │  ┌────────────┐  │
    │  ┌─────────┐  │    │  │ Questions  │  │    │  │  View      │  │
    │  │ Create  │  │    │  ├────────────┤  │    │  ├────────────┤  │
    │  ├─────────┤  │    │  │ Options    │  │    │  │ Release    │  │
    │  │ Edit    │  │    │  ├────────────┤  │    │  ├────────────┤  │
    │  ├─────────┤  │    │  │ Images     │  │    │  │ Export     │  │
    │  │ Close   │  │    │  ├────────────┤  │    │  └────────────┘  │
    │  └─────────┘  │    │  │ Explan.    │  │    └──────────────────┘
    └───────┬───────┘    │  └────────────┘  │
            │            └────────┬─────────┘
            ▼                     │
    ┌───────────────┐             │
    │  Mock Test    │◄────────────┘
    │  Management   │
    │               │
    │  ┌─────────┐  │
    │  │ Create  │  │
    │  ├─────────┤  │
    │  │ Publish │  │
    │  ├─────────┤  │
    │  │ Archive │  │
    │  └─────────┘  │
    └───────┬───────┘
            │
            ▼
    ┌───────────────┐    ┌──────────────────┐
    │ Notifications │───>│    Analytics     │
    │               │    │                  │
    │  ┌─────────┐  │    │  ┌────────────┐  │
    │  │ Send    │  │    │  │ Dashboard  │  │
    │  ├─────────┤  │    │  ├────────────┤  │
    │  │Templates│  │    │  │ Reports    │  │
    │  └─────────┘  │    │  ├────────────┤  │
    └───────┬───────┘    │  │ Export     │  │
            │            │  └────────────┘  │
            │            └──────────────────┘
            │
            ▼
    ┌───────────────┐    ┌──────────────────┐
    │  Payments /   │    │     Settings     │
    │  Subscriptions│    │                  │
    │               │    │  ┌────────────┐  │
    │  ┌─────────┐  │    │  │ Institute  │  │
    │  │ View    │  │    │  ├────────────┤  │
    │  ├─────────┤  │    │  │ System     │  │
    │  │Coupons  │  │    │  │ (Super)    │  │
    │  ├─────────┤  │    │  └────────────┘  │
    │  │ Refund  │  │    └──────────────────┘
    │  └─────────┘  │
    └───────┬───────┘
            │
            ▼
    ┌───────────────┐
    │   Support     │
    │               │
    │  ┌─────────┐  │
    │  │ Tickets │  │
    │  └─────────┘  │
    └───────────────┘
```

### 13.1 Module Dependencies (Tabular)

| Module | Depends On | Required By |
|--------|-----------|-------------|
| Authentication | — | All modules |
| Dashboard | All modules (for stats) | — |
| Institute Management | Authentication | Teacher, Student, Academic |
| Teacher Management | Institute, Authentication | Approval Center, Mock Tests |
| Student Management | Institute, Authentication | Results, Analytics |
| Academic Management | Institute | Question Bank, Mock Tests, Content |
| Batch Management | Academic (Stream) | Teacher, Student |
| Question Bank | Academic (Subject, Chapter) | Mock Tests, Approval Center |
| Approval Center | Question Bank, Content | Notifications |
| Mock Test Management | Question Bank, Academic | Results, Notifications |
| Results | Mock Tests | Analytics, Notifications |
| Notifications | All modules | Dashboard |
| Analytics | Results, Mock Tests | Dashboard, Reports |
| Payments | Institute | — |
| Settings | Authentication | — |

---

## 14. Integration Checklist

### 14.1 Module Readiness Matrix

| Module | Frontend Ready | Backend Ready | Database Ready | Services Reused | New Services Need | Dependencies |
|--------|---------------|--------------|---------------|----------------|-------------------|--------------|
| Dashboard | Pending | Pending | Ready | analyticsService (partial) | AdminAnalyticsService | All modules |
| Institute Management | Pending | Pending | Ready | — | AdminInstituteService | Auth |
| Teacher Management | Pending | Pending | Ready | teacherService, authService, profileService | AdminTeacherService | Institute |
| Student Management | Pending | Pending | Ready | authService | AdminStudentService | Institute, Batch |
| Academic Management | Pending | Pending | Ready | streamService, subjectService, chapterService, topicService | AdminAcademicService | Institute |
| Batch Management | Pending | Pending | Ready | batchService | AdminBatchService | Academic |
| Question Bank | Pending | Pending | Ready | questionService, questionOptionService, questionImageService, questionExplanationService | — | Academic |
| Approval Center | Pending | Pending | Ready | approvalService, contentService, questionService | AdminApprovalService | Question Bank, Content |
| Mock Test Management | Pending | Pending | Ready | mockTestService, mockTestQuestionService, mockTestPublishService | AdminMockTestService | Question Bank |
| Results | Pending | Pending | Ready | mockResultService, mockAttemptService | AdminResultService | Mock Tests |
| Notifications | Pending | Pending | Ready | notificationService | AdminNotificationService | All modules |
| Analytics | Pending | Pending | Ready | analyticsService (partial) | AdminAnalyticsService | Results, Mock Tests |
| Reports | Pending | Pending | Pending | — | AdminAnalyticsService | Analytics |
| Payments | Pending | Pending | Ready | — | AdminPaymentService | Institute |
| Coupons | Pending | Pending | Ready | — | AdminCouponService | Institute |
| Settings | Pending | Pending | Ready | settingsService (partial) | AdminSettingsService | Auth |
| Audit Logs | Pending | Pending | Pending | — | AdminAuditLogService | Auth |
| Support | Pending | Pending | Pending | — | AdminSupportService | Auth |
| Media | Pending | Pending | Ready | storageService | AdminMediaService | Storage |
| System Health | Pending | Pending | Ready | storageService | AdminSystemHealthService | Storage, Auth |

### 14.2 Integration Status Key

- **Frontend Ready:** ✅ = Pages exist, 🔄 = Needs work, Pending = Not started
- **Backend Ready:** ✅ = Service exists, 🔄 = Needs extension, Pending = Not started
- **Database Ready:** ✅ = Migrations exist, 🔄 = Needs changes, Pending = Not in schema
- **Services Reused:** Names of existing services that can be reused
- **New Services Need:** Services that need to be created
- **Dependencies:** Other modules that must be ready first

---

## 15. Backend TODO List

### 15.1 Already Available (No Work Needed)

- ✅ Authentication service (`authService.ts`) — phone-based auth, OTP, session management
- ✅ Teacher service (`teacherService.ts`) — teacher CRUD
- ✅ Academic services (`streamService`, `subjectService`, `chapterService`, `topicService`) — full CRUD
- ✅ Batch service (`batchService.ts`) — full CRUD (including soft delete)
- ✅ Question service (`questionService.ts`) — full CRUD with status transitions
- ✅ Question option service (`questionOptionService.ts`) — full CRUD with replace
- ✅ Question image service (`questionImageService.ts`) — full CRUD with replace
- ✅ Question explanation service (`questionExplanationService.ts`) — full CRUD with upsert
- ✅ Question option image service (`questionOptionImageService.ts`) — full CRUD
- ✅ Mock test service (`mockTestService.ts`) — full CRUD with status transitions
- ✅ Mock test question service (`mockTestQuestionService.ts`) — full CRUD with replace
- ✅ Mock test publish service (`mockTestPublishService.ts`) — validation + publish workflow
- ✅ Mock attempt service (`mockAttemptService.ts`) — CRUD for attempts
- ✅ Mock result service (`mockResultService.ts`) — read, release, hide
- ✅ Content service (`contentService.ts`) — full CRUD with lifecycle
- ✅ Approval service (`approvalService.ts`) — full approval workflow
- ✅ Tag service (`tagService.ts`) — full tag CRUD
- ✅ Notification service (`notificationService.ts`) — send, read, bulk, announce
- ✅ Storage service (`storageService.ts`) — upload, delete, signed URLs
- ✅ Profile service (`profileService.ts`) — profile read/update
- ✅ Teacher identity resolver (`teacherIdentity.ts`) — identity resolution
- ✅ Admin service (`adminService.ts`) — existing admin functionality

### 15.2 Needs Extension (Modify Existing Services)

- 🔄 **teacherService.ts** — Needs `getTeachers()` method (currently only has `getTeacherById()`)
- 🔄 **analyticsService.ts** — Needs institute-wide analytics methods
- 🔄 **analyticsService.ts** — Needs dashboard stats aggregation
- 🔄 **notificationService.ts** — Needs institute-scoped notification listing for admins
- 🔄 **profiles queries** — Need efficient queries for listing users by role

### 15.3 Needs New Development

| # | Service | Priority | Effort Estimate | Notes |
|---|---------|----------|----------------|-------|
| 1 | `AdminInstituteService` | Critical | 2-3 days | Institute CRUD plus validation |
| 2 | `AdminTeacherService` | Critical | 3-4 days | Orchestration wrapper + batch operations |
| 3 | `AdminStudentService` | Critical | 3-4 days | Student CRUD (no existing student service) |
| 4 | `AdminBatchService` | High | 1-2 days | Wrapper for batch close/archive |
| 5 | `AdminApprovalService` | Critical | 2-3 days | Orchestration + batch approve |
| 6 | `AdminMockTestService` | High | 1-2 days | Admin-specific mock test operations |
| 7 | `AdminResultService` | Critical | 1-2 days | Batch result release |
| 8 | `AdminAnalyticsService` | High | 4-5 days | Dashboard stats, reports, export |
| 9 | `AdminNotificationService` | Medium | 2-3 days | Broadcast, templates |
| 10 | `AdminPaymentService` | Medium | 2-3 days | Payment management |
| 11 | `AdminRoleService` | Medium | 1 day | Role management |
| 12 | `AdminSettingsService` | Medium | 1-2 days | Settings management |
| 13 | `AdminAuditLogService` | Low | 2-3 days | Audit trail |
| 14 | `AdminSupportService` | Low | 3-4 days | Support tickets |
| 15 | `AdminMediaService` | Low | 1 day | Media library |
| 16 | `AdminSystemHealthService` | Low | 1-2 days | Health monitoring |

### 15.4 Phase 2 Backend (Future)

| # | Feature | Effort | Dependencies |
|---|---------|--------|-------------|
| 1 | Live Class APIs (Jitsi integration) | 5-7 days | Jitsi setup |
| 2 | Meeting Recording APIs | 3-4 days | Live Classes |
| 3 | Attendance APIs | 2-3 days | Live Classes |
| 4 | Certificate Generation APIs | 3-4 days | Results |
| 5 | Payment Gateway Integration | 5-7 days | Payment provider |
| 6 | AI Question Review APIs | 5-7 days | AI service |
| 7 | AI Analytics APIs | 5-7 days | AI service |
| 8 | Parent Portal APIs | 3-4 days | Auth |
| 9 | WhatsApp Integration | 3-4 days | WhatsApp API |
| 10 | Email Campaign APIs | 3-4 days | Email service |
| 11 | Push Notification APIs | 3-4 days | Push service |
| 12 | System Monitoring APIs | 3-4 days | Infrastructure |

---

## 16. Production Readiness

### 16.1 Service Readiness Scoring

| Service | Architecture | Validation | Performance | Caching | Security | Documentation | Maintainability | Reusability | **Avg** |
|---------|-------------|-----------|-------------|---------|----------|--------------|----------------|-------------|---------|
| Existing Academic Srvs | 9/10 | 9/10 | 8/10 | 8/10 | 9/10 | 9/10 | 9/10 | 9/10 | **8.8** |
| Existing Question Srvs | 9/10 | 9/10 | 8/10 | 8/10 | 9/10 | 9/10 | 9/10 | 9/10 | **8.8** |
| Existing Mock Test Srvs | 9/10 | 9/10 | 8/10 | 8/10 | 9/10 | 9/10 | 9/10 | 9/10 | **8.8** |
| Existing Notification | 9/10 | 8/10 | 7/10 | 7/10 | 9/10 | 9/10 | 8/10 | 9/10 | **8.3** |
| Existing Approval | 9/10 | 9/10 | 8/10 | 8/10 | 9/10 | 9/10 | 9/10 | 9/10 | **8.8** |
| Existing Content Srv | 9/10 | 9/10 | 8/10 | 8/10 | 9/10 | 9/10 | 9/10 | 9/10 | **8.8** |
| Existing Storage Srv | 9/10 | 9/10 | 9/10 | 9/10 | 9/10 | 9/10 | 9/10 | 9/10 | **9.0** |
| New Admin Services | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | **TBD** |

### 16.2 Pre-Launch Checklist

- [ ] All admin services implemented and tested
- [ ] All admin React Query hooks implemented
- [ ] Permission matrix enforced via both UI guards and RLS
- [ ] Institute isolation verified (no cross-institute data leakage)
- [ ] All forms have proper validation (client + server)
- [ ] Error states handled for all service calls
- [ ] Loading states (skeletons) for all list/detail views
- [ ] Empty states for all list views
- [ ] Pagination tested with large datasets (1000+ records)
- [ ] Search functionality tested with edge cases
- [ ] Dark mode tested across all admin screens
- [ ] Responsive layout tested (desktop primary, tablet secondary)
- [ ] All mutation operations show success/error toasts
- [ ] Optimistic updates working correctly with rollback
- [ ] Cache invalidation verified on all mutations
- [ ] Performance tested with realistic data volumes
- [ ] Security audit: RLS policies verified for all new query patterns
- [ ] Accessibility: ARIA labels, keyboard navigation, screen reader support

---

## 17. Phase 2 API Roadmap

| API | Description | Effort | Priority |
|-----|-------------|--------|----------|
| **Live Classes** | | | |
| `AdminLiveClassService` | Create/manage live classes | 5 days | High |
| `MeetingRecordingService` | Upload/manage recordings | 3 days | Medium |
| `AttendanceService` | Track student attendance | 2 days | Medium |
| **AI Features** | | | |
| `AIQuestionReviewService` | AI-assisted question approval | 5 days | Medium |
| `AIAnalyticsService` | AI-powered insights | 5 days | Low |
| `AIContentRecommendation` | Content recommendations | 3 days | Low |
| **Payments** | | | |
| `PaymentGatewayService` | Stripe/Razorpay integration | 7 days | High |
| `InvoiceService` | Automated invoice generation | 3 days | Medium |
| `SubscriptionAutomation` | Auto-renew/cancel subscriptions | 4 days | Medium |
| **Parent Portal** | | | |
| `ParentAuthService` | Parent authentication | 3 days | Medium |
| `ParentDashboardService` | Parent dashboard | 4 days | Medium |
| **Communication** | | | |
| `WhatsAppService` | WhatsApp notification integration | 4 days | Medium |
| `EmailCampaignService` | Bulk email campaigns | 4 days | Medium |
| `PushNotificationService` | Push notification integration | 3 days | Medium |
| **Infrastructure** | | | |
| `AuditLogService` (full) | Comprehensive audit trail with triggers | 5 days | Low |
| `SystemMonitoringService` | Full system monitoring | 5 days | Low |
| `BackupService` | Automated backup management | 3 days | Low |
| `AnalyticsExportService` | Scheduled report generation | 3 days | Low |
| `CertificateService` | Certificate generation | 4 days | Low |
| **CRM** | | | |
| `CRMDashboardService` | Lead/enquiry management | 5 days | Low |
| `SupportTicketAutomation` | Ticket auto-assignment | 3 days | Low |

---

## 18. Service Reuse Summary

### 18.1 Reuse Statistics

| Metric | Count | Percentage |
|--------|-------|------------|
| **Existing services reused** | 23 | 72% |
| **New admin services needed** | 9 | 28% |
| Total service modules | 32 | 100% |

### 18.2 Existing Services Reused (23)

| # | Service | Admin Module |
|---|---------|-------------|
| 1 | `authService.ts` | Authentication |
| 2 | `teacherService.ts` | Teacher Management |
| 3 | `profileService.ts` | Profile Management |
| 4 | `teacherIdentity.ts` | Identity Resolution |
| 5 | `batchService.ts` | Batch Management |
| 6 | `streamService.ts` | Academic Management |
| 7 | `subjectService.ts` | Academic Management |
| 8 | `chapterService.ts` | Academic Management |
| 9 | `topicService.ts` | Academic Management |
| 10 | `questionService.ts` | Question Bank |
| 11 | `questionOptionService.ts` | Question Bank |
| 12 | `questionImageService.ts` | Question Bank |
| 13 | `questionExplanationService.ts` | Question Bank |
| 14 | `questionOptionImageService.ts` | Question Bank |
| 15 | `mockTestService.ts` | Mock Test Management |
| 16 | `mockTestQuestionService.ts` | Mock Test Management |
| 17 | `mockTestPublishService.ts` | Mock Test Management |
| 18 | `mockAttemptService.ts` | Results |
| 19 | `mockResultService.ts` | Results |
| 20 | `approvalService.ts` | Approval Center |
| 21 | `notificationService.ts` | Notification Management |
| 22 | `storageService.ts` | Media Management |
| 23 | `tagService.ts` | Content Management |

### 18.3 Existing React Query Hooks Reused

| Hook | Admin Module | Reuse Type |
|------|-------------|------------|
| `useMockTests()` | Mock Test Management | Direct reuse |
| `useQuestions()` | Question Bank | Direct reuse |
| `useQuestion()` | Question Bank | Direct reuse |
| `useApprovalRequests()` | Approval Center | Direct reuse |
| `useBatches()` | Batch Management | Direct reuse |
| `useStreams()` | Academic Management | Direct reuse |
| `useSubjects()` | Academic Management | Direct reuse |
| `useChapters()` | Academic Management | Direct reuse |
| `useTopics()` | Academic Management | Direct reuse |

**Existing hooks reused:** 11 (all need admin-specific wrapper with `instituteId` filter)

### 18.4 Existing Components Reusable

| Component | Admin Module | Notes |
|-----------|-------------|-------|
| Header | All pages | Needs role-aware navigation |
| Sidebar | All pages | Needs admin-specific menu |
| FilterPanel | All list pages | Reusable filter component |
| DataTable | All list pages | Reusable table with pagination |
| Pagination | All list pages | Reusable pagination |
| SearchInput | All list pages | Reusable search |
| ConfirmDialog | All pages | Delete/archive confirmations |
| Toast | All pages | Success/error notifications |
| LoadingSkeleton | All pages | Loading states |
| EmptyState | All pages | Empty list states |
| ErrorBoundary | All pages | Error fallback |
| StatusBadge | Question Bank, Approvals | Status display |

### 18.5 New Services Required (9)

| # | Service | Effort Estimate |
|---|---------|----------------|
| 1 | `AdminInstituteService` | 2-3 days |
| 2 | `AdminTeacherService` | 3-4 days |
| 3 | `AdminStudentService` | 3-4 days |
| 4 | `AdminBatchService` | 1-2 days |
| 5 | `AdminApprovalService` | 2-3 days |
| 6 | `AdminAnalyticsService` | 4-5 days |
| 7 | `AdminNotificationService` | 2-3 days |
| 8 | `AdminPaymentService` | 2-3 days |
| 9 | `AdminSettingsService` | 1-2 days |

**Total new service effort:** ~20-29 days

### 18.6 Summary

```
╔══════════════════════════════════════════════════════════════╗
║              SERVICE REUSE SUMMARY                          ║
╠══════════════════════════════════════════════════════════════╣
║  Existing services reused:       23  (72%)                  ║
║  New admin services needed:       9  (28%)                  ║
║  Existing hooks reused:          11  (100% of applicable)   ║
║  Existing components reusable:   12                          ║
║                                                             ║
║  Backend reuse percentage:       72%                        ║
║  Frontend reuse percentage:      ~60%                       ║
║  Estimated new development:      20-29 days                 ║
╚══════════════════════════════════════════════════════════════╝
```

---

## Appendices

### A. Code Locations

| Artifact | Location |
|----------|----------|
| Admin Functional Spec | `Admin_Dashboard_Functional_Specification.md` |
| Admin Testing/Flow Doc | `Admin_Dashboard_Testing_and_Functional_Flow.md` |
| Admin Service Layer (NEW) | `src/services/admin/` |
| Admin React Query Hooks (NEW) | `src/hooks/admin/` |
| Admin Pages (NEW) | `src/app/admin/` |
| Admin Components (NEW) | `src/components/admin/` |
| Teacher Dashboard | `src/app/teacher/` |
| Existing Services | `src/services/` |
| Existing Hooks | `src/hooks/` |
| Supabase Migrations | `supabase/migrations/` |
| Auth Context | `src/context/AuthContext.tsx` |
| Redux Store | `src/store/` |

### B. Key Patterns to Follow

1. **Service pattern:** Every method returns `ApiResponse<T>`. Never throw. Always catch.
2. **Hook pattern:** `useQuery` for reads, `useMutation` for writes. Optimistic updates for high-priority mutations.
3. **Error pattern:** `extractErrorMessage()` from `@/utils/supabase` for all error normalisation.
4. **Identity pattern:** Use `resolveTeacherIdentity()` / `resolveCurrentTeacherId()` for teacher-related operations.
5. **Pagination pattern:** Use `buildPagination()` from `@/utils/supabase` and `buildPaginatedResponse()` from `@/utils/response`.
6. **Validation pattern:** Use existing validation helpers from services. Extend with Zod in future.
7. **Cache pattern:** Invalidate list queries on mutations. Use optimistic updates for approvals and status changes.

### C. Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (admin operations) | Future |
| `NEXT_PUBLIC_APP_URL` | Application URL | Yes |
