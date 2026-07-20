# Teacher Dashboard vs Admin Dashboard — Feature Matrix

> **Prepared for:** Client Review  
> **Date:** July 2026  
> **Purpose:** This document maps every feature identified in the MockTest Admin Platform codebase across both dashboards, enabling the client to decide which features belong exclusively to Admin, exclusively to Teacher, or should be shared.

---

## Table of Contents

- [1. Authentication & Account Management](#1-authentication--account-management)
- [2. Dashboard & Overview](#2-dashboard--overview)
- [3. Profile Management](#3-profile-management)
- [4. Academic Structure (Streams, Subjects, Chapters, Topics)](#4-academic-structure-streams-subjects-chapters-topics)
- [5. Batch Management](#5-batch-management)
- [6. Teacher Management (HR & Faculty)](#6-teacher-management-hr--faculty)
- [7. Student Management](#7-student-management)
- [8. Question Bank](#8-question-bank)
- [9. Mock Tests](#9-mock-tests)
- [10. Content Management](#10-content-management)
- [11. Results & Evaluation](#11-results--evaluation)
- [12. Analytics & Reports](#12-analytics--reports)
- [13. Previous Year Questions (PYQ)](#13-previous-year-questions-pyq)
- [14. Course Management](#14-course-management)
- [15. Live Classes & Schedule](#15-live-classes--schedule)
- [16. Notifications](#16-notifications)
- [17. Commerce & Payments](#17-commerce--payments)
- [18. Settings & Configuration](#18-settings--configuration)
- [19. Storage & File Management](#19-storage--file-management)
- [20. System Security & Audit](#20-system-security--audit)
- [Suggested Dashboard Permissions](#suggested-dashboard-permissions)

---

## 1. Authentication & Account Management

| Feature | Description | Teacher | Admin | Both | Notes |
|---|---|---|---|---|---|
| Phone-based Sign Up | Register using phone number + OTP | ☐ | ☐ | ☐ | Shared auth flow |
| Phone-based Sign In | Login using phone number + password | ☐ | ☐ | ☐ | Shared auth flow |
| OTP Verification | SMS OTP verification during registration | ☐ | ☐ | ☐ | Shared auth flow |
| OTP Resend | Resend SMS OTP | ☐ | ☐ | ☐ | Shared auth flow |
| Password-based Login | Login using phone + password (alternative) | ☐ | ☐ | ☐ | Shared auth flow |
| Forgot Password | Reset password via OTP | ☐ | ☐ | ☐ | Shared auth flow |
| Session Management | JWT session refresh and management | ☐ | ☐ | ☐ | Backend-only |
| Sign Out | Logout and session clear | ☐ | ☐ | ☐ | Shared |
| Role-Based Access Control | Route guards per user role | ☐ | ☐ | ☐ | Shared; enforced via RoleGuard component |
| Account Status Checks | Redirect based on pending/rejected/suspended/approved status | ☐ | ☐ | ☐ | Shared; admin bypasses status checks |
| Pending Approval Page | Redirect page for unapproved accounts | ☐ | ☐ | ☐ | Implemented in `/pending-approval` |
| Account Inactive Page | Redirect page for inactive accounts | ☐ | ☐ | ☐ | Implemented in `/account-inactive` |
| Account Rejected Page | Redirect page for rejected accounts | ☐ | ☐ | ☐ | Implemented in `/account-rejected` |
| Account Suspended Page | Redirect page for suspended accounts | ☐ | ☐ | ☐ | Implemented in `/account-suspended` |

---

## 2. Dashboard & Overview

| Feature | Description | Teacher | Admin | Both | Notes |
|---|---|---|---|---|---|
| Dashboard Landing | Main dashboard view with summary stats | ☐ | ☐ | ☐ | Separate implementations per role |
| Total Students Count | Quick stat card showing total enrolled students | ☐ | ☐ | ☐ | Both dashboards show this |
| Total Teachers Count | Quick stat card showing total faculty | ☐ | ☐ | ☐ | Admin-only stat |
| Active Batches Count | Quick stat card showing active batches | ☐ | ☐ | ☐ | Both dashboards show this |
| Published Mock Tests Count | Quick stat card showing published tests | ☐ | ☐ | ☐ | Both dashboards show this |
| Pending Approvals Summary | Quick stat for pending questions/content/mock tests | ☐ | ☐ | ☐ | Admin dashboard shows detailed breakdown |
| Monthly Revenue | Quick stat card showing monthly revenue | ☐ | ☐ | ☐ | Admin-only commerce stat |
| Recent Registrations | List of recently registered users | ☐ | ☐ | ☐ | Admin-specific |
| Upcoming Live Classes | Dashboard widget showing next scheduled classes | ☐ | ☐ | ☐ | Both dashboards show this |
| Institute Snapshot | Summary of institute-level metrics | ☐ | ☐ | ☐ | Admin-only |
| System Status | Database, Storage, Auth system status indicators | ☐ | ☐ | ☐ | Admin-only; partially implemented |
| Weekly Activity Chart | Bar chart showing weekly test results | ☐ | ☐ | ☐ | Teacher-only |
| Difficulty Distribution | Chart showing question difficulty breakdown | ☐ | ☐ | ☐ | Teacher-only |
| Quick Actions Grid | Shortcut buttons to common tasks | ☐ | ☐ | ☐ | Separate sets per role |
| Pending Work Summary | Summary of items needing attention | ☐ | ☐ | ☐ | Both dashboards show this |
| Recent Activity Feed | Latest test results and actions | ☐ | ☐ | ☐ | Teacher-only |
| Top Performers Widget | List of top-scoring students | ☐ | ☐ | ☐ | Teacher-only |
| Weak Students Widget | Students needing additional attention | ☐ | ☐ | ☐ | Teacher-only |
| Notification Dashboard Widget | Recent unread notifications summary | ☐ | ☐ | ☐ | Both dashboards show this |
| Schedule / Calendar Widget | Upcoming schedule overview | ☐ | ☐ | ☐ | Teacher-only |

---

## 3. Profile Management

| Feature | Description | Teacher | Admin | Both | Notes |
|---|---|---|---|---|---|
| View Profile | View personal profile information | ☐ | ☐ | ☐ | Teacher has `/teacher/profile` |
| Edit Profile | Edit profile fields (name, contact, etc.) | ☐ | ☐ | ☐ | Teacher has `/teacher/profile/edit` |
| Profile Activity Log | View recent account activity | ☐ | ☐ | ☐ | Teacher-only; `/teacher/profile/activity` |
| Profile Preferences | Manage notification preferences and settings | ☐ | ☐ | ☐ | Teacher-only; `/teacher/profile/preferences` |
| Security Settings | Password change, security settings | ☐ | ☐ | ☐ | Teacher-only; `/teacher/profile/security` |
| Avatar / Profile Picture | Upload and manage profile photo | ☐ | ☐ | ☐ | Implemented via storage service |
| Profile Completion Card | Display profile completion progress | ☐ | ☐ | ☐ | Reusable component |

---

## 4. Academic Structure (Streams, Subjects, Chapters, Topics)

| Feature | Description | Teacher | Admin | Both | Notes |
|---|---|---|---|---|---|
| View Streams | List all academic streams | ☐ | ☐ | ☐ | Admins manage; teachers reference |
| Create Stream | Add new academic stream | ☐ | ☐ | ☐ | Admin-only service |
| Edit Stream | Modify existing stream | ☐ | ☐ | ☐ | Admin-only service |
| Delete Stream | Remove an academic stream | ☐ | ☐ | ☐ | Admin-only service |
| View Subjects | List subjects within streams | ☐ | ☐ | ☐ | Shared via `useSubjects` hook |
| Create Subject | Add new subject | ☐ | ☐ | ☐ | Admin-only service |
| Edit Subject | Modify existing subject | ☐ | ☐ | ☐ | Admin-only; has `subjectService` |
| Delete Subject | Remove a subject | ☐ | ☐ | ☐ | Admin-only |
| View Chapters | List chapters within subjects | ☐ | ☐ | ☐ | Shared via `useChapters` hook |
| Create Chapter | Add new chapter | ☐ | ☐ | ☐ | Admin-only via `chapterService` |
| Edit Chapter | Modify existing chapter | ☐ | ☐ | ☐ | Admin-only |
| Delete Chapter | Remove a chapter | ☐ | ☐ | ☐ | Admin-only |
| View Topics | List topics within chapters | ☐ | ☐ | ☐ | Shared via `useTopics` hook |
| Create Topic | Add new topic | ☐ | ☐ | ☐ | Admin-only via `topicService` |
| Edit Topic | Modify existing topic | ☐ | ☐ | ☐ | Admin-only |
| Delete Topic | Remove a topic | ☐ | ☐ | ☐ | Admin-only |
| Dev Panel for Academic | Dev-only interface for academic CRUD testing | ☐ | ☐ | ☐ | Development-only; not for production |

---

## 5. Batch Management

| Feature | Description | Teacher | Admin | Both | Notes |
|---|---|---|---|---|---|
| View Batches | List all batches | ☐ | ☐ | ☐ | Teacher sees assigned batches only |
| View Batch Details | Detailed view of a batch | ☐ | ☐ | ☐ | Both can view |
| Create Batch | Add new batch | ☐ | ☐ | ☐ | Admin-only via `batchManagementService` |
| Edit Batch | Modify batch details | ☐ | ☐ | ☐ | Admin-only |
| Delete Batch | Remove a batch | ☐ | ☐ | ☐ | Admin-only |
| Assign Students to Batch | Add students to a batch | ☐ | ☐ | ☐ | Admin-only via `batchStudentAssignmentService` |
| Remove Students from Batch | Remove students from a batch | ☐ | ☐ | ☐ | Admin-only |
| Assign Teachers to Batch | Assign teacher to a batch | ☐ | ☐ | ☐ | Admin-only via `batchTeacherAssignmentService` |
| Remove Teachers from Batch | Remove teacher from a batch | ☐ | ☐ | ☐ | Admin-only |
| View Batch Roster | See student roster of a batch | ☐ | ☐ | ☐ | Teacher can view assigned batch rosters |
| Import Students (Batch) | Bulk import students into batch | ☐ | ☐ | ☐ | Admin-only; partially implemented |
| Export Batch Roster | Export batch student list | ☐ | ☐ | ☐ | Not fully implemented |

---

## 6. Teacher Management (HR & Faculty)

| Feature | Description | Teacher | Admin | Both | Notes |
|---|---|---|---|---|---|
| View Teachers List | List all teachers/faculty | ☐ | ☐ | ☐ | Admin-only |
| View Teacher Details | Detailed teacher view with profile | ☐ | ☐ | ☐ | Admin-only; `/admin/teachers/[id]` |
| Add Teacher | Register new teacher account | ☐ | ☐ | ☐ | Admin-only via `teacherLifecycleService` |
| Edit Teacher | Modify teacher profile/details | ☐ | ☐ | ☐ | Admin-only |
| Delete Teacher | Remove teacher from institute | ☐ | ☐ | ☐ | Admin-only |
| Activate Teacher | Enable a teacher account | ☐ | ☐ | ☐ | Admin-only |
| Deactivate Teacher | Disable a teacher account | ☐ | ☐ | ☐ | Admin-only |
| Approve Teacher | Approve pending teacher registration | ☐ | ☐ | ☐ | Admin-only |
| Reject Teacher | Reject teacher registration | ☐ | ☐ | ☐ | Admin-only |
| View Teacher HR Data | Employment records, bank details, qualifications | ☐ | ☐ | ☐ | Teacher can view own HR data |
| View Teacher Qualifications | Degrees, certifications | ☐ | ☐ | ☐ | Teacher can view own |
| View Teacher Experience | Previous employment history | ☐ | ☐ | ☐ | Teacher can view own |
| View Teacher Documents | Uploaded KYC and HR documents | ☐ | ☐ | ☐ | Teacher can view own |
| Teacher Leave Application | Apply for leave | ☐ | ☐ | ☐ | Teacher-only; submits to admin |
| View Leave Requests Queue | Pending leave requests from teachers | ☐ | ☐ | ☐ | Admin-only; approval workflow |
| Approve / Reject Leave | Process leave requests | ☐ | ☐ | ☐ | Admin-only |
| Verify KYC Documents | Verify teacher identity documents | ☐ | ☐ | ☐ | Admin-only via `adminService.verifyDocument` |
| View Teacher Bank Details | Bank account information for payroll | ☐ | ☐ | ☐ | Admin can view; teacher can view own |
| Teacher Employment Record | Employment type, joining date, compensation | ☐ | ☐ | ☐ | Both can view own/related records |
| View Teacher Specializations | Subject expertise and proficiency | ☐ | ☐ | ☐ | Both can view |
| Update Availability Slots | Set available teaching time slots | ☐ | ☐ | ☐ | Teacher-only |
| Allot Batch to Teacher | Assign batch/course to teacher | ☐ | ☐ | ☐ | Admin-only; triggers notification |

---

## 7. Student Management

| Feature | Description | Teacher | Admin | Both | Notes |
|---|---|---|---|---|---|
| View Students List | List all students | ☐ | ☐ | ☐ | Teacher sees assigned batch students only |
| View Student Details | Detailed student profile view | ☐ | ☐ | ☐ | Both have detail pages |
| View Student Activity | Student login/activity history | ☐ | ☐ | ☐ | Teacher-only; `/teacher/students/[id]/activity` |
| View Student Analytics | Student performance analytics | ☐ | ☐ | ☐ | Teacher-only; `/teacher/students/[id]/analytics` |
| View Student Results | Student's test results | ☐ | ☐ | ☐ | Teacher-only; `/teacher/students/[id]/results` |
| Create Student | Register new student | ☐ | ☐ | ☐ | Admin-only via `studentLifecycleService` |
| Edit Student | Modify student profile | ☐ | ☐ | ☐ | Admin-only |
| Delete Student | Remove student from system | ☐ | ☐ | ☐ | Admin-only |
| Activate Student | Enable student account | ☐ | ☐ | ☐ | Admin-only |
| Deactivate Student | Disable student account | ☐ | ☐ | ☐ | Admin-only |
| Import Students (Bulk) | Bulk import via CSV/Excel | ☐ | ☐ | ☐ | Admin-only; partially implemented |
| Export Students | Export student list to file | ☐ | ☐ | ☐ | Admin-only; partially implemented |
| Assign Student to Batch | Enroll student in a batch | ☐ | ☐ | ☐ | Admin-only |
| Remove Student from Batch | Unenroll student from batch | ☐ | ☐ | ☐ | Admin-only |
| Reset Student Password | Force password reset for student | ☐ | ☐ | ☐ | Admin-only |
| View Student Roster | See students with attendance, scores, ranking | ☐ | ☐ | ☐ | Teacher sees batch rosters |
| Student Guardian Info | Guarding/parent contact management | ☐ | ☐ | ☐ | Schema has guardian fields; not fully exposed in UI |
| Student Enrollment No. | Auto-generate enrollment number on purchase | ☐ | ☐ | ☐ | Backend RPC; admin views |

---

## 8. Question Bank

| Feature | Description | Teacher | Admin | Both | Notes |
|---|---|---|---|---|---|
| View All Questions | Browse question bank with filters | ☐ | ☐ | ☐ | Separate lists per role |
| View Question Detail | Full question view with options, images, explanation | ☐ | ☐ | ☐ | Both have detail pages |
| Create Question | Add new question (MCQ, MSQ, Numerical, True/False) | ☐ | ☐ | ☐ | Teacher creates; admin can also create |
| Edit Question | Modify existing question | ☐ | ☐ | ☐ | Teacher edits own; admin edits any |
| Delete Question | Remove a question permanently | ☐ | ☐ | ☐ | Teacher can delete own; admin can delete any |
| Preview Question | View question as student would see it | ☐ | ☐ | ☐ | Both have preview |
| Save as Draft | Save question without submitting for approval | ☐ | ☐ | ☐ | Teacher flow |
| Submit for Approval | Submit question to admin for review | ☐ | ☐ | ☐ | Teacher-only |
| Approve Question | Approve pending question (publish) | ☐ | ☐ | ☐ | Admin-only |
| Reject Question | Reject question (return to draft) | ☐ | ☐ | ☐ | Admin-only |
| Publish Question | Publish approved question to students | ☐ | ☐ | ☐ | Admin-only; also teacher can publish own |
| Archive Question | Remove question from active use | ☐ | ☐ | ☐ | Both can archive |
| Restore Question | Restore archived question to published | ☐ | ☐ | ☐ | Both can restore |
| Bulk Approve Questions | Approve multiple questions at once | ☐ | ☐ | ☐ | Admin-only |
| Bulk Reject Questions | Reject multiple questions | ☐ | ☐ | ☐ | Admin-only |
| Bulk Publish Questions | Publish multiple questions | ☐ | ☐ | ☐ | Admin-only |
| Bulk Archive Questions | Archive multiple questions | ☐ | ☐ | ☐ | Both; admin and teacher have bulk actions |
| Bulk Delete Questions | Delete multiple questions permanently | ☐ | ☐ | ☐ | Teacher-only in question list |
| Import Questions (Bulk) | Bulk import questions from CSV/JSON/XLSX | ☐ | ☐ | ☐ | Teacher-only; `/teacher/questions/import` — parsing built but DB import pending |
| Download Import Template | Download sample CSV for question import | ☐ | ☐ | ☐ | Teacher-only |
| Filter by Subject/Chapter | Filter questions by academic structure | ☐ | ☐ | ☐ | Both |
| Filter by Difficulty | Filter by easy/medium/hard | ☐ | ☐ | ☐ | Both |
| Filter by Question Type | Filter by MCQ/MSQ/Numerical/True-False | ☐ | ☐ | ☐ | Both |
| Filter by Status | Filter by draft/pending/published/archived | ☐ | ☐ | ☐ | Both |
| Search Questions | Search by question text | ☐ | ☐ | ☐ | Both |
| Question Images | Upload images to question stem | ☐ | ☐ | ☐ | Supported in question creation |
| Option Images | Upload images to individual options | ☐ | ☐ | ☐ | Supported via `questionOptionImageService` |
| Question Explanations | Add text/video explanations to questions | ☐ | ☐ | ☐ | Both create/edit |
| Approval Stats Dashboard | Summary cards with approval status counts | ☐ | ☐ | ☐ | Admin-only |
| View Approval Queue | List of questions pending admin approval | ☐ | ☐ | ☐ | Admin-only |
| Question Detail for Approval | Full question review with options, images, teacher info | ☐ | ☐ | ☐ | Admin-only |

---

## 9. Mock Tests

| Feature | Description | Teacher | Admin | Both | Notes |
|---|---|---|---|---|---|
| View Mock Tests List | Browse all mock tests | ☐ | ☐ | ☐ | Separate lists per role |
| View Mock Test Detail | Detailed test view with settings | ☐ | ☐ | ☐ | Both |
| Create Mock Test | Create new mock test with settings | ☐ | ☐ | ☐ | Teacher creates; admin may also create |
| Edit Mock Test | Modify test settings | ☐ | ☐ | ☐ | Both |
| Delete Mock Test | Remove a test | ☐ | ☐ | ☐ | Admin-only; admin has `deleteMockTest` |
| Duplicate Mock Test | Clone an existing test | ☐ | ☐ | ☐ | Admin-only |
| Preview Mock Test | Preview test as student | ☐ | ☐ | ☐ | Both have `/preview` |
| Publish Mock Test | Make test available to students | ☐ | ☐ | ☐ | Teacher submits for approval; admin publishes |
| Archive Mock Test | Remove test from active use | ☐ | ☐ | ☐ | Both can archive |
| Restore Mock Test | Restore archived test | ☐ | ☐ | ☐ | Admin-only |
| Submit Mock Test for Approval | Teacher submits test for admin review | ☐ | ☐ | ☐ | Teacher-only; partial implementation |
| Approve Mock Test | Admin approves pending test | ☐ | ☐ | ☐ | Admin-only; partial implementation |
| Manage Questions in Test | Add/remove/reorder questions in a test | ☐ | ☐ | ☐ | Teacher-only; `/teacher/mock-tests/[id]/questions` |
| Configure Test Settings | Duration, marks, negative marking, shuffle | ☐ | ☐ | ☐ | Teacher creates; admin edits |
| Set Result Release Mode | Immediate, scheduled, or manual release | ☐ | ☐ | ☐ | Teacher-only |
| Set Test Availability Window | Available from/until dates | ☐ | ☐ | ☐ | Teacher-only |
| Configure Attempt Limit | Max attempts per student | ☐ | ☐ | ☐ | Teacher-only |
| Calculator Allowed Toggle | Enable/disable on-screen calculator | ☐ | ☐ | ☐ | Teacher-only |
| Shuffle Questions Toggle | Randomize question order per student | ☐ | ☐ | ☐ | Teacher-only |
| Shuffle Options Toggle | Randomize option order | ☐ | ☐ | ☐ | Teacher-only |
| Filter Tests by Status/Subject/Teacher | Advanced filtering of test list | ☐ | ☐ | ☐ | Both have filtering |
| Mock Test Stats Summary | Counts by status (draft/pending/published/archived) | ☐ | ☐ | ☐ | Admin has detailed stats; teacher has derived stats |

---

## 10. Content Management

| Feature | Description | Teacher | Admin | Both | Notes |
|---|---|---|---|---|---|
| View Content List | Browse uploaded content | ☐ | ☐ | ☐ | Both have content pages |
| Upload Content | Upload study material (docs, PDFs, videos, etc.) | ☐ | ☐ | ☐ | Teacher-only; `/teacher/content` |
| Edit Content | Modify content metadata | ☐ | ☐ | ☐ | Teacher-only |
| Delete Content | Remove content | ☐ | ☐ | ☐ | Teacher-only |
| Preview Content | View content before publishing | ☐ | ☐ | ☐ | Teacher-only; `/teacher/content/[id]/preview` |
| Submit Content for Review | Send content to admin for approval | ☐ | ☐ | ☐ | Teacher-only; status transitions |
| Approve Content | Admin approves teacher content | ☐ | ☐ | ☐ | Admin-only via `approvalService` |
| Reject Content | Admin rejects content | ☐ | ☐ | ☐ | Admin-only |
| Archive Content | Remove content from active use | ☐ | ☐ | ☐ | Both (via status) |
| Review Content Queue | Queue of content pending admin review | ☐ | ☐ | ☐ | Admin-only; `/admin/content/review` |
| Content Stats Dashboard | Summary with approved/pending/rejected/draft counts | ☐ | ☐ | ☐ | Admin-only dashboard |
| Content Tags Management | Add/manage tags on content | ☐ | ☐ | ☐ | Via `tagService` |

---

## 11. Results & Evaluation

| Feature | Description | Teacher | Admin | Both | Notes |
|---|---|---|---|---|---|
| View Results Dashboard | Summary of all test results | ☐ | ☐ | ☐ | Teacher-only |
| View All Results | List of all results with filters | ☐ | ☐ | ☐ | Teacher-only; `/teacher/results/list` |
| View Result Detail | Detailed result breakdown with stats | ☐ | ☐ | ☐ | Teacher-only |
| Subject Breakdown | Per-subject score breakdown in result | ☐ | ☐ | ☐ | Teacher-only |
| Chapter Breakdown | Per-chapter score breakdown | ☐ | ☐ | ☐ | Teacher-only |
| Question Analysis | Per-question analysis of student responses | ☐ | ☐ | ☐ | Teacher-only; `/teacher/results/[id]/questions` |
| Release Result | Make result visible to student | ☐ | ☐ | ☐ | Teacher-only |
| Hide Result | Hide result from student | ☐ | ☐ | ☐ | Teacher-only |
| Filter Results by Test | Filter results by specific mock test | ☐ | ☐ | ☐ | Teacher-only |
| Filter Results by Status | Filter by released/hidden | ☐ | ☐ | ☐ | Teacher-only |
| Result Stats Cards | Avg score, highest, questions answered, etc. | ☐ | ☐ | ☐ | Teacher-only |
| Auto Evaluation | Auto-evaluate MCQ/numerical answers | ☐ | ☐ | ☐ | Backend; partially implemented |
| Manual Evaluation | Teacher reviews and scores subjective answers | ☐ | ☐ | ☐ | Not implemented in current codebase |

---

## 12. Analytics & Reports

| Feature | Description | Teacher | Admin | Both | Notes |
|---|---|---|---|---|---|
| Analytics Dashboard | Main analytics view with summary | ☐ | ☐ | ☐ | Teacher-only |
| Total Students Analytics | Student count analytics | ☐ | ☐ | ☐ | Teacher-only |
| Total Tests/Attempts Analytics | Test attempt metrics | ☐ | ☐ | ☐ | Teacher-only |
| Average Score Analytics | Mean student score | ☐ | ☐ | ☐ | Teacher-only |
| Average Accuracy Analytics | Response accuracy metrics | ☐ | ☐ | ☐ | Teacher-only |
| Completion Rate Analytics | Test completion rate | ☐ | ☐ | ☐ | Teacher-only |
| Pass Percentage | Percentage of students passing | ☐ | ☐ | ☐ | Teacher-only; progress ring chart |
| Average Time Analytics | Average time spent per attempt | ☐ | ☐ | ☐ | Teacher-only |
| Student Analytics | Individual student performance deep dive | ☐ | ☐ | ☐ | Teacher-only; `/teacher/analytics/students` |
| Mock Test Analytics | Per-test performance metrics | ☐ | ☐ | ☐ | Teacher-only; `/teacher/analytics/mock-tests` |
| Subject Performance | Performance breakdown by subject | ☐ | ☐ | ☐ | Teacher-only; `/teacher/analytics/subjects` |
| Chapter Analysis | Performance breakdown by chapter | ☐ | ☐ | ☐ | Teacher-only; `/teacher/analytics/chapters` |
| Question Analysis Analytics | Question-level performance stats | ☐ | ☐ | ☐ | Teacher-only; `/teacher/analytics/questions` |
| Trends Analytics | Score trends over time | ☐ | ☐ | ☐ | Teacher-only; `/teacher/analytics/trends` |
| Leaderboards | Student ranking and leaderboard | ☐ | ☐ | ☐ | Teacher-only; `/teacher/analytics/leaderboards` |
| Insights Page | AI/generated insights on performance | ☐ | ☐ | ☐ | Teacher-only; `/teacher/analytics/insights`; partially implemented |
| Analytics Filters | Date range, batch, subject filter for analytics | ☐ | ☐ | ☐ | Teacher-only |
| Export Analytics | Export analytic reports to file | ☐ | ☐ | ☐ | Filter component has `showExport` flag; partially implemented |
| Student Score Trend RPC | Backend RPC for score trend data | ☐ | ☐ | ☐ | Database RPC: `get_student_score_trend` |
| Subject/Chapter Analytics RPCs | Backend RPCs for detailed performance data | ☐ | ☐ | ☐ | Database RPCs: `get_student_subject_analytics`, `get_student_chapter_analytics`, etc. |
| Student Dashboard Summary RPC | Backend RPC for student dashboard aggregation | ☐ | ☐ | ☐ | Database RPC: `get_student_dashboard_summary` |

---

## 13. Previous Year Questions (PYQ)

| Feature | Description | Teacher | Admin | Both | Notes |
|---|---|---|---|---|---|
| View PYQ Packages | List all PYQ packages | ☐ | ☐ | ☐ | Teacher manages; admin may view in commerce |
| View PYQ Package Detail | Detailed package view | ☐ | ☐ | ☐ | Teacher-only |
| Create PYQ Package | Create new PYQ package with stream, pricing | ☐ | ☐ | ☐ | Teacher-only |
| Edit PYQ Package | Modify package settings | ☐ | ☐ | ☐ | Teacher-only |
| Delete PYQ Package | Remove package (only if no papers) | ☐ | ☐ | ☐ | Teacher-only |
| Publish PYQ Package | Make package active and available for purchase | ☐ | ☐ | ☐ | Teacher-only |
| Unpublish PYQ Package | Hide package from store | ☐ | ☐ | ☐ | Teacher-only |
| View Papers in Package | List all papers in a package | ☐ | ☐ | ☐ | Teacher-only |
| Create Paper | Add new paper to a package | ☐ | ☐ | ☐ | Teacher-only |
| Edit Paper | Modify paper settings | ☐ | ☐ | ☐ | Teacher-only |
| Delete Paper | Remove a paper from package | ☐ | ☐ | ☐ | Teacher-only; only if no questions |
| Publish Paper | Make paper visible to purchasing students | ☐ | ☐ | ☐ | Teacher-only |
| Unpublish Paper | Hide paper from students | ☐ | ☐ | ☐ | Teacher-only |
| Upload Paper PDF | Upload question paper PDF file | ☐ | ☐ | ☐ | Teacher-only; storage service |
| Upload Solution PDF | Upload solution paper PDF | ☐ | ☐ | ☐ | Teacher-only |
| Manage Paper Questions | Map questions to paper | ☐ | ☐ | ☐ | Teacher-only; `/papers/[paperId]/questions` |
| PYQ-Mock Test Mapping | Link PYQ papers to mock tests | ☐ | ☐ | ☐ | Not exposed in UI; service exists |
| View PYQ Purchases (Admin) | Audit PYQ package purchases | ☐ | ☐ | ☐ | Admin-only in commerce module |

---

## 14. Course Management

| Feature | Description | Teacher | Admin | Both | Notes |
|---|---|---|---|---|---|
| View Courses List | Browse courses | ☐ | ☐ | ☐ | Admin-only; `/admin/courses` |
| View Course Detail | Detailed course view | ☐ | ☐ | ☐ | Admin-only |
| Create Course | Add new course | ☐ | ☐ | ☐ | Admin-only via `courseManagementService` |
| Edit Course | Modify course settings | ☐ | ☐ | ☐ | Admin-only |
| Delete Course | Remove a course | ☐ | ☐ | ☐ | Admin-only |
| Assign Teachers to Course | Link teachers to course | ☐ | ☐ | ☐ | Admin-only via `courseTeacherAssignmentService` |
| Assign Batches to Course | Link batches to course | ☐ | ☐ | ☐ | Admin-only via `courseBatchAssignmentService` |
| Assign Content to Course | Link study content to course | ☐ | ☐ | ☐ | Admin-only via `courseContentAssignmentService` |
| Assign Mock Tests to Course | Link mock tests to course | ☐ | ☐ | ☐ | Admin-only via `mockTestAssignmentService` |
| Course Enrollments | View/audit course enrollments | ☐ | ☐ | ☐ | Admin-only in commerce |
| Course Create Modal | UI modal for quick course creation | ☐ | ☐ | ☐ | Reusable component |

---

## 15. Live Classes & Schedule

| Feature | Description | Teacher | Admin | Both | Notes |
|---|---|---|---|---|---|
| View Schedule | View class schedule/timetable | ☐ | ☐ | ☐ | View-only in existing UI |
| Create Live Class | Schedule a new live class | ☐ | ☐ | ☐ | Teacher-only via `teacherService`; quick action |
| Launch Live Studio | Start/join live streaming session | ☐ | ☐ | ☐ | Teacher-only; Header "Launch Studio" button |
| Start Live Class | Mark class as live (status transition) | ☐ | ☐ | ☐ | Teacher-only |
| End Live Class | End live session | ☐ | ☐ | ☐ | Teacher-only |
| View Live Sessions Log | Database tracks live sessions with participants | ☐ | ☐ | ☐ | Backend-only; not exposed in UI |
| Session Participants | Track who joined live session | ☐ | ☐ | ☐ | Backend-only |
| View Upcoming Classes | See list of future scheduled classes | ☐ | ☐ | ☐ | Both dashboards have this widget |

---

## 16. Notifications

| Feature | Description | Teacher | Admin | Both | Notes |
|---|---|---|---|---|---|
| View Notifications Dashboard | Overview with read/unread counts | ☐ | ☐ | ☐ | Both have notification dashboards |
| View Notification List | Browse all notifications | ☐ | ☐ | ☐ | Both have `/list` |
| View Notification Detail | Detailed notification view | ☐ | ☐ | ☐ | Both have `/[id]` |
| Create Notification | Compose and send new notification | ☐ | ☐ | ☐ | Both can create; `/create` |
| Schedule Notification | Schedule notification for future delivery | ☐ | ☐ | ☐ | Both have `/scheduled` pages |
| View Scheduled Notifications | View future-scheduled notifications | ☐ | ☐ | ☐ | Both can view |
| Notification History | Archive of sent notifications | ☐ | ☐ | ☐ | Both have `/history` |
| Mark as Read | Mark individual notification as read | ☐ | ☐ | ☐ | Both |
| Mark All as Read | Bulk mark all notifications read | ☐ | ☐ | ☐ | Both |
| Notification Types | Different notification types with icons | ☐ | ☐ | ☐ | Shared utility |
| Priority Levels | High/normal/low priority tagging | ☐ | ☐ | ☐ | Shared utility |
| Filter Notifications | Filter by read/unread/type/priority | ☐ | ☐ | ☐ | Both |
| Notification Dispatch Edge Function | Server-side notification sending | ☐ | ☐ | ☐ | Edge function: `dispatch-notification` |
| Push Notifications | Send push to mobile devices | ☐ | ☐ | ☐ | Shared utility in `_shared/pushNotification.ts` |
| In-App Notification Service | Real-time in-app notification delivery | ☐ | ☐ | ☐ | Via `notificationService` |
| Notification Stats Dashboard | Total/unread/today/announcements/high priority counts | ☐ | ☐ | ☐ | Both have stats cards |

---

## 17. Commerce & Payments

| Feature | Description | Teacher | Admin | Both | Notes |
|---|---|---|---|---|---|
| Commerce Dashboard | High-level commerce metrics | ☐ | ☐ | ☐ | Admin-only; `/admin/commerce` |
| View Total Orders | Total purchase orders count | ☐ | ☐ | ☐ | Admin-only |
| View Total Revenue | Aggregate revenue across all products | ☐ | ☐ | ☐ | Admin-only |
| View Captured Payments | Successful payment count | ☐ | ☐ | ☐ | Admin-only |
| View Pending Payments | Uncaptured/pending payment count | ☐ | ☐ | ☐ | Admin-only |
| View Course Enrollments | Enrollment metrics | ☐ | ☐ | ☐ | Admin-only |
| View PYQ Purchases | PYQ package purchase metrics | ☐ | ☐ | ☐ | Admin-only |
| Orders List | View and filter all orders | ☐ | ☐ | ☐ | Admin-only; `/admin/commerce/orders` |
| Payments List | View payment attempts/failures | ☐ | ☐ | ☐ | Admin-only; `/admin/commerce/payments` |
| Course Purchase Verification | Audit course enrollments | ☐ | ☐ | ☐ | Admin-only; `/admin/commerce/courses` |
| PYQ Purchase Verification | Audit PYQ purchases | ☐ | ☐ | ☐ | Admin-only; `/admin/commerce/pyq` |
| Create Payment Order (Backend) | Edge function for Razorpay order creation | ☐ | ☐ | ☐ | Backend: `create-payment-order` |
| Razorpay Webhook | Payment confirmation webhook handler | ☐ | ☐ | ☐ | Backend: `razorpay-webhook` |
| Complete Course Purchase Flow | Post-purchase student creation + enrollment | ☐ | ☐ | ☐ | Backend: `complete-course-purchase` edge function |
| Complete PYQ Purchase Flow | Post-purchase PYQ access grant | ☐ | ☐ | ☐ | Backend: `complete-pyq-purchase` edge function |
| Create Student After Purchase RPC | Database function for student creation | ☐ | ☐ | ☐ | Backend RPC: `create_student_after_purchase` |

---

## 18. Settings & Configuration

| Feature | Description | Teacher | Admin | Both | Notes |
|---|---|---|---|---|---|
| System Settings | Global platform settings | ☐ | ☐ | ☐ | Admin-only; `/admin/settings` |
| Teacher Settings | Personal teacher preferences | ☐ | ☐ | ☐ | Teacher-only; `/teacher/settings` |
| Email Templates | Manage email notification templates | ☐ | ☐ | ☐ | Not implemented in current codebase |
| Certificate Templates | Manage certificate designs | ☐ | ☐ | ☐ | Not implemented in current codebase |

---

## 19. Storage & File Management

| Feature | Description | Teacher | Admin | Both | Notes |
|---|---|---|---|---|---|
| File Upload | Upload files to Supabase Storage | ☐ | ☐ | ☐ | Shared via `storageService` |
| Question Image Upload | Upload images for questions/stem | ☐ | ☐ | ☐ | Teacher creates; admin reviews |
| Option Image Upload | Upload images for question options | ☐ | ☐ | ☐ | Teacher creates; admin reviews |
| Content File Upload | Upload study material files | ☐ | ☐ | ☐ | Teacher-only |
| PYQ PDF Upload | Upload question/solution PDFs | ☐ | ☐ | ☐ | Teacher-only |
| Profile Avatar Upload | Upload profile picture | ☐ | ☐ | ☐ | Both |
| Storage Explorer (Dev) | Dev panel for storage debugging | ☐ | ☐ | ☐ | Development-only |
| Image Storage RLS Policies | Row-level security for question image buckets | ☐ | ☐ | ☐ | Database-level; migration 035 |

---

## 20. System Security & Audit

| Feature | Description | Teacher | Admin | Both | Notes |
|---|---|---|---|---|---|
| Row Level Security (RLS) | Database-level access control per user | ☐ | ☐ | ☐ | Implemented across all tables |
| RoleGuard Component | Frontend route-level access control | ☐ | ☐ | ☐ | Shared component |
| Audit Logs (Admin Domain 10) | Database schema for audit trails | ☐ | ☐ | ☐ | Schema exists; not fully exposed in UI |
| Account Status Lifecycle | Account pending/approved/rejected/suspended flow | ☐ | ☐ | ☐ | Migration 026 |
| Teacher Account Approval | Admin approves teacher registration | ☐ | ☐ | ☐ | Admin-only workflow |
| Admin Account Bypass | Admin bypasses account status checks | ☐ | ☐ | ☐ | Implemented in RoleGuard |
| Database Migration Suite | Versioned schema migrations for 16 domains | ☐ | ☐ | ☐ | 40+ migration files |
| Edge Function Auth | Authenticated edge function invocations | ☐ | ☐ | ☐ | Backend |

---

## Suggested Dashboard Permissions

Based on the full codebase analysis, here are the recommended feature assignments:

### 👨‍🏫 Teacher Dashboard — Recommended Permissions

| Module | Access Level |
|---|---|
| Dashboard | Full access to own dashboard |
| Profile | Full CRUD on own profile |
| Question Bank | Create, Edit Own, Delete Own, Submit for Approval, Preview, Bulk Actions |
| Mock Tests | Create, Edit Own, Delete Own, Manage Questions, Configure Settings, Submit for Approval |
| Content | Upload, Edit Own, Delete Own, Submit for Review |
| Results | View All, Release/Hide, Subject/Chapter Breakdown, Question Analysis |
| Analytics | Full access to analytics dashboards, filters, leaderboards |
| PYQ Packages | Full CRUD: Create, Edit, Publish/Unpublish Packages & Papers, Upload PDFs |
| Students | View Assigned Batch Students, View Student Details, Analytics, Results |
| Notifications | View, Create, Schedule, Mark Read |
| Live Classes | Schedule, Start, End Live Sessions |
| Settings | Personal settings, preferences, security |

### 🛡️ Admin Dashboard — Recommended Permissions

| Module | Access Level |
|---|---|
| Dashboard | Full access with institute-wide stats |
| Academic Structure | Full CRUD: Streams, Subjects, Chapters, Topics |
| Batch Management | Full CRUD + Student/Teacher Assignment |
| Teacher Management | Full CRUD: Activate/Deactivate, Approve/Reject, Leave Management, KYC Verification, Bank Details, Batch Allotment |
| Student Management | Full CRUD: Activate/Deactivate, Import/Export, Batch Assignment, Password Reset |
| Question Bank | Review & Approve/Reject All, Publish/Archive, Bulk Operations, View Stats |
| Mock Tests | Review & Approve/Reject, Publish/Archive, Duplicate, Delete |
| Content | Review & Approve/Reject All Content |
| Course Management | Full CRUD + Teacher/Batch/Content Assignment |
| Commerce | Full access: Orders, Payments, Revenue, Enrollments, PYQ Purchases |
| Notifications | View, Create, Schedule, Broadcast to All |
| Settings | Full system settings & configuration |
| Approvals | Central approval queue for questions, content, mock tests |

### ✅ Both Dashboards — Shared Features

| Feature | Notes |
|---|---|
| Authentication (Login/Signup/Logout) | Unified auth flow |
| Profile View | Both can view their own |
| Notifications (View/Mark Read) | Both can manage |
| Question Bank (View/Search/Filter) | Separate filtered views |
| Mock Tests (View) | Separate filtered views |
| Students (View) | Teacher sees own; admin sees all |
| Academic Structure (View) | Teacher references; admin manages |
| Live Classes (View Upcoming) | Both dashboard widgets |
| File Upload | Shared storage services |

---

*This document was generated by comprehensive analysis of the entire codebase including routes, pages, components, services, hooks, types, Supabase migrations, database schema, edge functions, and UI screens across both the Admin and Teacher dashboards.*

*☐ = Feature available (unchecked — client to tick)*  
*☑ = Feature available and pre-selected*
