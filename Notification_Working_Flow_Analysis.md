# Notification Working Flow Analysis

> **Status:** Complete — Analysis of all three working notification flows
> **Date:** 2026-07-23
> **Audit Reference:** `Notification_System_Audit.md`

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Flow 1 — Course Purchase Notification](#2-flow-1--course-purchase-notification)
3. [Flow 2 — PYQ Purchase Notification](#3-flow-2--pyq-purchase-notification)
4. [Flow 3 — Manual Notification (Admin/Teacher Dashboard)](#4-flow-3--manual-notification-adminteacher-dashboard)
5. [Student App Notification Reception](#5-student-app-notification-reception)
6. [Cross-Flow Comparison](#6-cross-flow-comparison)
7. [Shared Architecture](#7-shared-architecture)
8. [Recommended Reusable Entry Point](#8-recommended-reusable-entry-point)
9. [Complete File Inventory](#9-complete-file-inventory)

---

## 1. Architecture Overview

### High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        NOTIFICATION ARCHITECTURE                        │
│                              PROJECT WIDE                               │
└─────────────────────────────────────────────────────────────────────────┘

                                  │
          ┌───────────────────────┼───────────────────────┐
          ▼                       ▼                       ▼
  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────────┐
  │  Course Purchase  │   │   PYQ Purchase   │   │   Manual Notification  │
  │  (Flow 1)        │   │   (Flow 2)       │   │   (Flow 3)            │
  │                  │   │                  │   │                       │
  │ complete-course- │   │ complete-pyq-    │   │ dispatch-notification │
  │ purchase         │   │ purchase         │   │ (Edge Function)      │
  │ (Edge Function)  │   │ (Edge Function)  │   │                       │
  └────────┬─────────┘   └────────┬─────────┘   └───────────┬───────────┘
           │                      │                         │
           │     DUPLICATED       │                         │
           │     ┌──────────────┐ │                         │
           └─────┤createCommerce├─┘                         │
                 │Notification()│                           │
                 │ (inline in   │     ┌──────────────────┐  │
                 │  each Edge   │     │createNotifWith   │  │
                 │  Function)   │     │Recipients()      │  │
                 └──────┬───────┘     │ (inline in       │  │
                        │             │  dispatch-notif)  │  │
                        │             └────────┬──────────┘  │
                        │                      │             │
                        └──────────┬───────────┘             │
                                   │                         │
                                   ▼                         │
                    ┌────────────────────────────┐           │
                    │        notifications        │           │
                    │      (database table)       │           │
                    └────────────┬───────────────┘           │
                                 │                           │
                                 ▼                           │
                    ┌────────────────────────────┐           │
                    │   notification_recipients   │           │
                    │      (database table)       │           │
                    └────────────┬───────────────┘           │
                                 │                           │
                                 └───────────┬───────────────┘
                                             │
                                             ▼
                              ┌─────────────────────────────┐
                              │   _shared/pushNotification  │
                              │   sendPushNotification()    │
                              └─────────────┬───────────────┘
                                            │
                                            ▼
                              ┌─────────────────────────────┐
                              │   FCM HTTP v1 API            │
                              │   (Firebase Cloud Messaging) │
                              └─────────────┬───────────────┘
                                            │
                                            ▼
                              ┌─────────────────────────────┐
                              │   Student App                │
                              │   (React Native)            │
                              │                              │
                              │   ⚠️ NOT IMPLEMENTED         │
                              │   No FCM listeners           │
                              │   No notification screen     │
                              │   No unread badge            │
                              └─────────────────────────────┘
```

### Key Tables Involved

| Table | Created In | Purpose | Used By |
|-------|-----------|---------|---------|
| `notifications` | Migration 010 | Single event record per notification | All 3 flows |
| `notification_recipients` | Migration 010 | One row per recipient per notification | All 3 flows |
| `notification_templates` | Migration 010 | Reusable message blueprints | Not currently used |
| `device_tokens` | Migration 048 | FCM device registration tokens | All 3 flows (for push) |

### Key Edge Functions

| Edge Function | Location | Purpose |
|--------------|----------|---------|
| `complete-course-purchase` | `supabase/functions/complete-course-purchase/` | Course purchase + notification |
| `complete-pyq-purchase` | `supabase/functions/complete-pyq-purchase/` | PYQ purchase + notification |
| `dispatch-notification` | `supabase/functions/dispatch-notification/` | Manual/admin notification dispatch |
| `_shared/pushNotification` | `supabase/functions/_shared/pushNotification.ts` | Shared FCM push helper |

### Key Enums & Notification Types

Defined in Migration 010:
```
notification_event_type:
  live_class_reminder, test_published, result_available,
  content_approved, content_rejected, subscription_expiring,
  subscription_expired, new_content_uploaded, batch_assigned,
  announcement, custom
```

Added in Migration 047:
```
  course_purchased, course_enrolled, pyq_purchased, pyq_access_granted
```

**Current `NotificationType` in TypeScript** (`src/types/notification.ts`):
```typescript
type NotificationType =
  | 'mock_test_assigned'
  | 'mock_test_reminder'
  | 'mock_test_submitted'
  | 'result_published'
  | 'new_content_uploaded'
  | 'chapter_added'
  | 'subject_added'
  | 'new_mock_test_available'
  | 'announcement'
  | 'general_message'
  | 'warning' | 'success' | 'error'
  | 'live_class_reminder'
  | 'content_approved' | 'content_rejected'
  | 'subscription_expiring' | 'subscription_expired'
  | 'batch_assigned'
  | 'custom';
```

---

## 2. Flow 1 — Course Purchase Notification

### Complete Sequence

```
Student App                         complete-course-purchase           Supabase DB              FCM
   │                                       │                              │                      │
   │  1. POST /functions/v1/               │                              │                      │
   │     complete-course-purchase          │                              │                      │
   │──────────────────────────────────────►│                              │                      │
   │                                       │                              │                      │
   │  2. Authenticate (JWT or internal)    │                              │                      │
   │  3. Validate request body             │                              │                      │
   │  4. Verify course exists              │                              │                      │
   │                              ────────►│ SELECT from courses          │                      │
   │                                       │◄────── course data ─────────│                      │
   │                                       │                              │                      │
   │  5. Upgrade profile role              │                              │                      │
   │                              ────────►│ UPDATE profiles SET role=student│                    │
   │                                       │◄────── success ─────────────│                      │
   │                                       │                              │                      │
   │  6. Check existing student            │                              │                      │
   │  7. Create student (RPC)              │                              │                      │
   │  8. Create enrollment                 │                              │                      │
   │                                       │                              │                      │
   │  ═══ NOTIFICATION PHASE ═══           │                              │                      │
   │                                       │                              │                      │
   │  9. createCommerceNotification()      │                              │                      │
   │     (course_purchased)                │                              │                      │
   │                                       │                              │                      │
   │     a. Idempotency check              │                              │                      │
   │                              ────────►│ SELECT notifications +       │                      │
   │                                       │   notification_recipients    │                      │
   │                                       │   WHERE event_type=          │                      │
   │                                       │   'course_purchased'         │                      │
   │                                       │   AND reference_id=courseId  │                      │
   │                                       │◄────── existing? ───────────│                      │
   │                                       │                              │                      │
   │     b. Insert notification            │                              │                      │
   │                              ────────►│ INSERT INTO notifications    │                      │
   │                                       │   (institute_id, title,      │                      │
   │                                       │   body, channel='in_app',    │                      │
   │                                       │   event_type, reference,     │                      │
   │                                       │   total_recipients=1)        │                      │
   │                                       │◄────── notification_id ─────│                      │
   │                                       │                              │                      │
   │     c. Insert recipient               │                              │                      │
   │                              ────────►│ INSERT INTO                  │                      │
   │                                       │   notification_recipients    │                      │
   │                                       │   (notification_id,          │                      │
   │                                       │   profile_id, institute_id)  │                      │
   │                                       │◄────── success ─────────────│                      │
   │                                       │                              │                      │
   │ 10. sendCoursePurchasedPushNotif()    │                              │                      │
   │                              ────────►│ SELECT device_tokens         │                      │
   │                                       │   WHERE profile_id=?         │                      │
   │                                       │   AND is_active=true         │                      │
   │                                       │◄────── tokens[] ────────────│                      │
   │                                       │                              │                      │
   │                                       │  ─────► FCM v1 API           │                      │
   │                                       │         (for each device)    │                      │
   │                                       │◄──── success/failure per device                  │                      │
   │                                       │                              │                      │
   │  11. createCommerceNotification()     │                              │                      │
   │      (course_enrolled)                │                              │                      │
   │                              ────────►│ INSERT notification +        │                      │
   │                                       │   recipient (same pattern)   │                      │
   │                                       │                              │                      │
   │ 12. Return success                    │                              │                      │
   │◄─────── { success, studentId, ────────│                              │                      │
   │           enrollmentId, ... }         │                              │                      │
```

### Files Involved (Flow 1)

| File | Function | Role |
|------|----------|------|
| `supabase/functions/complete-course-purchase/index.ts` | `Deno.serve()` | Main handler — orchestrates the entire flow |
| `supabase/functions/complete-course-purchase/index.ts` | `createCommerceNotification()` | **Inline helper** — creates notification + recipient rows |
| `supabase/functions/complete-course-purchase/index.ts` | `sendCoursePurchasedPushNotification()` | **Inline helper** — dispatches FCM push |
| `supabase/functions/_shared/pushNotification.ts` | `sendPushNotification()` | **Shared** — FCM v1 push delivery to device tokens |
| `supabase/functions/_shared/pushNotification.ts` | `getAccessToken()` | OAuth 2.0 JWT bearer token exchange with Google |
| `supabase/functions/_shared/pushNotification.ts` | `sendToDevice()` | Sends to a single FCM device token |
| `supabase/functions/_shared/pushNotification.ts` | `signRsaSha256()` | RS256 signing for JWT assertion |
| `supabase/migrations/010_domain_09_notifications.sql` | — | Creates `notifications`, `notification_recipients` tables |
| `supabase/migrations/047_add_commerce_notification_types.sql` | — | Adds `course_purchased`, `course_enrolled` to enum |
| `supabase/migrations/048_device_tokens.sql` | — | Creates `device_tokens` table for FCM tokens |

### Data Flow Summary

```
Trigger:     Razorpay webhook (internal) OR Student App (direct POST)
Endpoint:    POST /functions/v1/complete-course-purchase
Notif Type:  course_purchased (event_type = 'course_purchased')
              course_enrolled (event_type = 'course_enrolled')
Recipient:   1 student (the purchaser)
Push:        YES — FCM via _shared/pushNotification.ts
In-App:      YES — notifications + notification_recipients rows
```

---

## 3. Flow 2 — PYQ Purchase Notification

### Complete Sequence

```
Student App                         complete-pyq-purchase              Supabase DB           FCM
   │                                       │                              │                      │
   │  1. POST /functions/v1/               │                              │                      │
   │     complete-pyq-purchase              │                              │                      │
   │──────────────────────────────────────►│                              │                      │
   │                                       │                              │                      │
   │  [Steps 2–7: Identical to Flow 1,     │                              │                      │
   │   but with pyq_packages instead       │                              │                      │
   │   of courses]                         │                              │                      │
   │                                       │                              │                      │
   │  8. Create student_pyq_purchases      │                              │                      │
   │                                       │                              │                      │
   │  ═══ NOTIFICATION PHASE ═══           │                              │                      │
   │                                       │                              │                      │
   │  9. createCommerceNotification()      │                              │                      │
   │     (pyq_purchased)                   │                              │                      │
   │                              ────────►│ Notification + recipient     │                      │
   │                                       │   (idempotent check)         │                      │
   │                                       │                              │                      │
   │ 10. createCommerceNotification()      │                              │                      │
   │     (pyq_access_granted)              │                              │                      │
   │                              ────────►│ Notification + recipient     │                      │
   │                                       │                              │                      │
   │ 11. ⚠️ NO PUSH NOTIFICATION           │                              │                      │
   │     (sendCoursePurchasedPushNotif     │                              │                      │
   │      does NOT exist in this function) │                              │                      │
   │                                       │                              │                      │
   │ 12. Return success                    │                              │                      │
   │◄────────── { success } ───────────────│                              │                      │
```

### Files Involved (Flow 2)

| File | Function | Role |
|------|----------|------|
| `supabase/functions/complete-pyq-purchase/index.ts` | `Deno.serve()` | Main handler |
| `supabase/functions/complete-pyq-purchase/index.ts` | `createCommerceNotification()` | **Duplicate inline helper** — identical to Flow 1's version |
| `supabase/functions/_shared/pushNotification.ts` | `sendPushNotification()` | Available but ⚠️ not called by this flow |
| `supabase/migrations/047_add_commerce_notification_types.sql` | — | Adds `pyq_purchased`, `pyq_access_granted` to enum |

### Critical Finding — Flow 2 vs Flow 1

| Aspect | Flow 1 (Course) | Flow 2 (PYQ) |
|--------|----------------|--------------|
| `createCommerceNotification()` | Inline in Edge Function | **Duplicated** inline (identical code) |
| In-app notification | ✅ Yes (2: course_purchased + course_enrolled) | ✅ Yes (2: pyq_purchased + pyq_access_granted) |
| Push notification (FCM) | ✅ Yes (`sendCoursePurchasedPushNotification()`) | ⚠️ **NOT IMPLEMENTED** |
| `sendPushNotification()` import | ✅ Imported | ❌ **Not imported** |

---

## 4. Flow 3 — Manual Notification (Admin/Teacher Dashboard)

### Complete Sequence

```
Teacher/Admin Dashboard            dispatch-notification               Supabase DB           FCM
   │                                       │                              │                      │
   │  1. User fills form in                │                              │                      │
   │     Create Notification page           │                              │                      │
   │                                       │                              │                      │
   │  2. useSendAudienceNotification()     │                              │                      │
   │     (React Query mutation)            │                              │                      │
   │                                       │                              │                      │
   │  3. POST /functions/v1/               │                              │                      │
   │     dispatch-notification             │                              │                      │
   │──────────────────────────────────────►│                              │                      │
   │                                       │                              │                      │
   │  4. authenticateCaller()              │                              │                      │
   │     - Verify JWT                      │                              │                      │
   │     - Query profiles table            │                              │                      │
   │     - Determine role (admin|teacher)  │                              │                      │
   │                                       │                              │                      │
   │  5. validatePermissions()             │                              │                      │
   │     - Admin: any audience             │                              │                      │
   │     - Teacher: batch|specific_students│                              │                      │
   │                                       │                              │                      │
   │  6. resolveAudience()                 │                              │                      │
   │                              ────────►│ Query audience based on type  │                      │
   │                                       │   (profiles, batch_students, │                      │
   │                                       │    student_details, etc.)    │                      │
   │                                       │◄────── profile_ids[] ───────│                      │
   │                                       │                              │                      │
   │  7. createNotificationWithRecipients()│                              │                      │
   │                              ────────►│ INSERT INTO notifications    │                      │
   │                                       │   (one row)                  │                      │
   │                                       │◄────── notification_id ─────│                      │
   │                                       │                              │                      │
   │                              ────────►│ INSERT INTO                  │                      │
   │                                       │   notification_recipients    │                      │
   │                                       │   (chunked, 100 per batch)   │                      │
   │                                       │◄────── success ─────────────│                      │
   │                                       │                              │                      │
   │  8. dispatchPushToRecipients()        │                              │                      │
   │     (if sendPush=true)                │                              │                      │
   │                              ────────►│ For each profile_id:         │                      │
   │                                       │   SELECT device_tokens       │                      │
   │                                       │◄────── tokens[] ────────────│                      │
   │                                       │                              │                      │
   │                                       │  ─────► FCM v1 API           │                      │
   │                                       │         (for each device)    │                      │
   │                                       │                              │                      │
   │  9. Return summary                    │                              │                      │
   │◄──── { success, notificationId,       │                              │                      │
   │        totalRecipients, pushResults }  │                              │                      │
   │                                       │                              │                      │
   │ 10. React Query invalidates cache     │                              │                      │
   │     → UI updates                      │                              │                      │
```

### Files Involved (Flow 3)

| File | Function | Role |
|------|----------|------|
| **Frontend (Dashboard)** | | |
| `src/app/admin/notifications/create/page.tsx` | `AdminCreateNotificationPage()` | Admin create notification form |
| `src/app/teacher/notifications/create/page.tsx` | `TeacherCreateNotificationPage()` | Teacher create notification form |
| `src/hooks/notification/useSendNotification.ts` | `useSendAudienceNotification()` | React Query mutation → calls Edge Function |
| `src/hooks/notification/queryKeys.ts` | `notificationKeys` | Query key factory for cache invalidation |
| `src/hooks/notification/useNotificationPermissions.ts` | `useNotificationPermissions()` | Role-based permission data |
| `src/types/notification.ts` | — | TypeScript types for all notification flows |
| **Edge Function** | | |
| `supabase/functions/dispatch-notification/index.ts` | `authenticateCaller()` | JWT verification + role resolution |
| `supabase/functions/dispatch-notification/index.ts` | `validatePermissions()` | Role-based audience checks |
| `supabase/functions/dispatch-notification/index.ts` | `resolveAudience()` | Audience → profile IDs resolution |
| `supabase/functions/dispatch-notification/index.ts` | `createNotificationWithRecipients()` | Creates notification + recipient rows |
| `supabase/functions/dispatch-notification/index.ts` | `dispatchPushToRecipients()` | FCM push per recipient |
| `supabase/functions/_shared/pushNotification.ts` | `sendPushNotification()` | FCM v1 push delivery |
| **Dashboard Notification Pages** | | |
| `src/app/admin/notifications/page.tsx` | — | Admin notification dashboard |
| `src/app/admin/notifications/list/page.tsx` | — | Admin notification list |
| `src/app/admin/notifications/[id]/page.tsx` | — | Admin notification detail |
| `src/app/admin/notifications/history/page.tsx` | — | Admin notification history |
| `src/app/admin/notifications/scheduled/page.tsx` | — | Admin scheduled notifications |
| `src/app/teacher/notifications/page.tsx` | — | Teacher notification dashboard |
| `src/app/teacher/notifications/list/page.tsx` | — | Teacher notification list |
| `src/app/teacher/notifications/[id]/page.tsx` | — | Teacher notification detail |
| `src/app/teacher/notifications/history/page.tsx` | — | Teacher notification history |
| `src/app/teacher/notifications/scheduled/page.tsx` | — | Teacher scheduled notifications |
| **Dashboard Components** | | |
| `src/components/admin/AdminHeader.tsx` | — | Notification bell with dropdown |
| `src/components/teacher/Header.tsx` | — | Notification bell with badge |
| `src/components/ui/NotificationBell.tsx` | — | Reusable notification bell component |

### Audience Resolution Types

| Audience Type | Admin | Teacher |
|--------------|-------|---------|
| `all_users` | ✅ All profiles in institute | ❌ Denied |
| `students` | ✅ All students | ❌ Denied |
| `teachers` | ✅ All teachers | ❌ Denied |
| `batch` | ✅ Specific batch | ✅ Only own assigned batches |
| `specific_students` | ✅ Any students | ✅ Only students in own batches |
| `specific_teachers` | ✅ Any teachers | ❌ Denied |

### Data Flow Summary

```
Trigger:     Admin/Teacher clicks "Send" on create notification form
Frontend:    useSendAudienceNotification() → fetch() to Edge Function
Endpoint:    POST /functions/v1/dispatch-notification
Audience:    Resolved server-side via resolveAudience()
Push:        Conditional — based on `sendPush` checkbox in form
In-App:      Always — creates notification + recipient rows
Cache:       React Query invalidates notification list + dashboard on success
```

---

## 5. Student App Notification Reception

### ⚠️ CRITICAL FINDING: Student App Has Zero Notification Implementation

After exhaustive search, the Student App (React Native at `C:\Projects\MockTestApp`) contains **no notification-related code whatsoever**:

| Feature | Status | Location |
|---------|--------|----------|
| FCM initialization | ❌ **Not implemented** | — |
| Firebase configuration | ❌ **Not implemented** | — |
| `onMessage` foreground handler | ❌ **Not implemented** | — |
| `onBackgroundMessage` handler | ❌ **Not implemented** | — |
| Notification permission request | ❌ **Not implemented** | — |
| Device token registration | ❌ **Not implemented** | — |
| In-app notification screen | ❌ **Not implemented** | — |
| Unread notification badge | ❌ **Not implemented** | — |
| Notification deep linking | ❌ **Not implemented** | — |
| `@react-native-firebase/messaging` | ❌ **Not installed** | — |
| `expo-notifications` | ❌ **Not installed** | — |
| FCM service worker (Web) | ❌ **Not implemented** | — |

### What This Means

- **Push notifications ARE being sent** from the server (Flows 1 & 3)
- `device_tokens` table IS being queried for active tokens
- FCM v1 API IS being called successfully
- **But no device is registering tokens** → `device_tokens` is empty
- **No app is listening for incoming pushes** → FCM messages are silently dropped
- **No in-app notification display exists** → even if `notification_recipients` has data, the student can't see it

### Student App Data Flow (Intended)

```
Server Edge Function ──► FCM v1 API ──► Google FCM Servers ──► Student App
                                                                     │
                                                    ┌──────────────────┘
                                                    ▼
                                          ┌─────────────────────┐
                                          │   NOT IMPLEMENTED    │
                                          │                     │
                                          │  ❌ onMessage()      │
                                          │  ❌ onBackground()   │
                                          │  ❌ Notification     │
                                          │     Screen           │
                                          │  ❌ Badge count      │
                                          │  ❌ Deep links       │
                                          └─────────────────────┘
```

---

## 6. Cross-Flow Comparison

| Aspect | Flow 1 (Course) | Flow 2 (PYQ) | Flow 3 (Manual) |
|--------|----------------|--------------|-----------------|
| **Trigger** | Purchase webhook/API | Purchase webhook/API | Admin/Teacher form submit |
| **Called by** | razorpay-webhook or Student App | razorpay-webhook or Student App | Dashboard (useSendAudienceNotification) |
| **Edge Function** | `complete-course-purchase` | `complete-pyq-purchase` | `dispatch-notification` |
| **Auth** | JWT or internal (webhook) | JWT or internal (webhook) | JWT only |
| **Audience Resolution** | N/A (single recipient) | N/A (single recipient) | Server-side (6 audience types) |
| **Permission Check** | N/A | N/A | Role-based (admin vs teacher) |
| **Notif Creation** | `createCommerceNotification()` (inline) | `createCommerceNotification()` (inline, **duplicate**) | `createNotificationWithRecipients()` (inline) |
| **Idempotency** | ✅ Yes (checks existing notification) | ✅ Yes (checks existing notification) | ❌ No idempotency |
| **Push Delivery** | ✅ Yes (`sendCoursePurchasedPushNotif()`) | ⚠️ **NOT IMPLEMENTED** | ✅ Yes (`dispatchPushToRecipients()`) |
| **Push per recipient** | To 1 purchaser | To 1 purchaser | To ALL recipients (in loop) |
| **Chunked Recipients** | N/A (1 recipient) | N/A (1 recipient) | ✅ Yes (100 per chunk) |
| **Error Handling** | Errors logged, never thrown | Errors logged, never thrown | Errors logged, partial failure OK |
| **React Query Cache** | N/A (server-side) | N/A (server-side) | ✅ Auto-invalidated on success |
| **Student App UI** | ❌ Not implemented | ❌ Not implemented | ❌ Not implemented |

---

## 7. Shared Architecture

### What IS Shared

```
                    ┌──────────────────────────────┐
                    │  _shared/pushNotification.ts │
                    │  sendPushNotification()      │
                    │                              │
                    │  Imported by:                │
                    │  • complete-course-purchase  │
                    │  • dispatch-notification     │
                    │                              │
                    │  NOT imported by:            │
                    │  • complete-pyq-purchase ⚠️  │
                    └──────────────────────────────┘

                    ┌──────────────────────────────┐
                    │  Database Tables              │
                    │                              │
                    │  notifications (shared)      │
                    │  notification_recipients     │
                    │  device_tokens                │
                    └──────────────────────────────┘
```

### What is NOT Shared (Duplicated)

```
                    ╔══════════════════════════════╗
                    ║   createCommerceNotification ║
                    ║                              ║
                    ║  Duplicated in:              ║
                    ║  • complete-course-purchase  ║
                    ║    (lines 114-242)           ║
                    ║  • complete-pyq-purchase     ║
                    ║    (lines 117-245)           ║
                    ║                              ║
                    ║  ~130 lines each, identical  ║
                    ╚══════════════════════════════╝
```

### Shared Notification Pipeline (Same for All 3 Flows)

```
Step 1: INSERT INTO notifications (institute_id, title, body, channel,
                                     event_type, reference_type, reference_id,
                                     total_recipients)
Step 2: INSERT INTO notification_recipients (notification_id, profile_id,
                                              institute_id)
Step 3: SELECT fcm_token FROM device_tokens WHERE profile_id = ?
         AND is_active = true
Step 4: For each device:
          POST https://fcm.googleapis.com/v1/projects/{projectId}/messages:send
          with { message: { token, notification: { title, body }, data } }
Step 5: If token invalid → UPDATE device_tokens SET is_active = false
```

---

## 8. Recommended Reusable Entry Point

### Best Candidate: `dispatch-notification` Edge Function

The `dispatch-notification` Edge Function at `supabase/functions/dispatch-notification/index.ts` is the best foundation for all future notification events because:

1. **Already handles bulk audience resolution** — queries profiles, batches, student_details
2. **Already handles chunked recipient insertion** — 100 recipients per batch
3. **Already handles push dispatch** — per-recipient FCM delivery
4. **Already has permission validation** — admin vs teacher role checks
5. **Already returns structured results** — notificationId, recipient count, push results
6. **Single POST endpoint** — easy to call from any Edge Function or backend service

### Recommended Pattern for Future Notifications

Rather than embedding `createCommerceNotification()` in each new Edge Function (the current pattern that led to duplication), all future notification events should call `dispatch-notification` internally:

```
┌──────────────────────┐
│  New Event Handler    │       POST /functions/v1/dispatch-notification
│  (e.g. notify-mock-   │──────────────────────────────────────────────►
│   test-published)      │                                              │
│                       │                                              │
│  - Create the event   │   { instituteId, title, body,                │
│  - Call dispatch-     │     eventType: 'mock_test_published',        │
│    notification       │     audience: { type: 'batch',               │
│    instead of         │       batchId: '...' },                      │
│    embedding notif    │     sendPush: true }                         │
│    logic              │                                              │
└──────────────────────┘                                              │
                                                                       │
                                                      dispatch-notification
                                                        (reuse for ALL)
                                                ┌──────────────────────┐
                                                │                      │
                                                │  • Auth              │
                                                │  • Permission        │
                                                │  • Audience          │
                                                │  • Notification      │
                                                │  • Recipients        │
                                                │  • Push (FCM)        │
                                                │                      │
                                                └──────────────────────┘
```

### Refactoring Priority

1. **Extract `createCommerceNotification()`** into a shared utility in `supabase/functions/_shared/`
2. **Add push notification** to Flow 2 (PYQ purchase) by importing and calling `sendPushNotification()`
3. **Implement Student App notification reception** (highest priority — without it, no student sees notifications)
4. **Create future event handlers** that call `dispatch-notification` rather than embedding notification logic

---

## 9. Complete File Inventory

### Supabase Edge Functions

| File | Lines | Purpose |
|------|-------|---------|
| `supabase/functions/complete-course-purchase/index.ts` | ~1150 | Course purchase orchestration + notifications |
| `supabase/functions/complete-pyq-purchase/index.ts` | ~1100 | PYQ purchase orchestration + notifications |
| `supabase/functions/dispatch-notification/index.ts` | ~700 | Manual notification dispatch with audience resolution |
| `supabase/functions/_shared/pushNotification.ts` | ~670 | Shared FCM v1 push notification service |

### Supabase Migrations

| File | Purpose |
|------|---------|
| `supabase/migrations/010_domain_09_notifications.sql` | Core notification tables + enums + indexes + RLS |
| `supabase/migrations/047_add_commerce_notification_types.sql` | Adds course_purchased, course_enrolled, pyq_purchased, pyq_access_granted to enum |
| `supabase/migrations/048_device_tokens.sql` | Device tokens table for FCM targeting |

### Dashboard — Services

| File | Functions |
|------|-----------|
| `src/services/notification/notificationService.ts` | `getNotifications()`, `getUnreadNotifications()`, `getNotification()`, `markAsRead()`, `markAllAsRead()`, `deleteNotification()`, `createNotification()`, `createBulkNotification()`, `getNotificationDashboardStats()`, `notifyMockTestPublished()`, `notifyResultPublished()`, `notifyContentUploaded()`, `notifyAnnouncement()` |
| `src/services/notificationService.ts` (legacy) | `getNotifications()`, `markAsRead()` (legacy — used by Header.tsx) |
| `src/services/adminService.ts` | Creates notification on batch allotment |
| `src/services/profileService.ts` | `getNotificationPreferences()`, `saveNotificationPreferences()` |

### Dashboard — Hooks

| File | Exports |
|------|---------|
| `src/hooks/notification/useNotifications.ts` | `useNotifications()`, `useUnreadNotifications()`, `useNotification()`, `useMarkAsRead()`, `useMarkAllAsRead()`, `useDeleteNotification()`, `useCreateNotification()`, `useCreateBulkNotification()`, `useNotificationDashboard()` |
| `src/hooks/notification/useSendNotification.ts` | `useSendAudienceNotification()` |
| `src/hooks/notification/useNotificationPermissions.ts` | `useNotificationPermissions()`, `AUDIENCE_LABELS` |
| `src/hooks/notification/queryKeys.ts` | `notificationKeys` — factory for React Query cache keys |

### Dashboard — Types

| File | Purpose |
|------|---------|
| `src/types/notification.ts` | All notification types: `Notification`, `NotificationType`, `NotificationPriority`, `NotificationChannel`, `NotificationFilters`, `NotificationDashboardStats`, `NotificationAudience`, `RoleNotificationPermissions`, etc. |
| `src/types/profile.ts` | `NotificationPreferences`, `NOTIFICATION_PREFERENCE_ITEMS` |

### Dashboard — Utils

| File | Exports |
|------|---------|
| `src/utils/notification.ts` | `formatNotificationTime()`, `priorityColor()`, `priorityLabel()`, `notificationIcon()`, `notificationTypeLabel()`, `groupNotificationsByDate()`, `unreadCount()`, `inferPriority()`, `buildActionUrl()` |

### Dashboard — Pages (Admin)

| File | Purpose |
|------|---------|
| `src/app/admin/notifications/page.tsx` | Notification dashboard with stats + recent list |
| `src/app/admin/notifications/list/page.tsx` | Full paginated notification list with filters |
| `src/app/admin/notifications/[id]/page.tsx` | Notification detail view |
| `src/app/admin/notifications/create/page.tsx` | Create notification form with audience selector |
| `src/app/admin/notifications/history/page.tsx` | Sent notification history |
| `src/app/admin/notifications/scheduled/page.tsx` | Scheduled notifications |

### Dashboard — Pages (Teacher)

| File | Purpose |
|------|---------|
| `src/app/teacher/notifications/page.tsx` | Teacher notification dashboard |
| `src/app/teacher/notifications/list/page.tsx` | Teacher notification list |
| `src/app/teacher/notifications/[id]/page.tsx` | Teacher notification detail |
| `src/app/teacher/notifications/create/page.tsx` | Teacher create notification (batch-restricted) |
| `src/app/teacher/notifications/history/page.tsx` | Teacher notification history |
| `src/app/teacher/notifications/scheduled/page.tsx` | Teacher scheduled notifications |

### Dashboard — Components

| File | Purpose |
|------|---------|
| `src/components/admin/AdminHeader.tsx` | Notification bell with dropdown for admin |
| `src/components/teacher/Header.tsx` | Notification bell with badge for teacher |
| `src/components/ui/NotificationBell.tsx` | Reusable notification bell component |
| `src/components/profile/NotificationToggle.tsx` | Notification preference toggle |
| `src/components/profile/ActivityTimeline.tsx` | Activity timeline (includes notification_sent type) |
| `src/components/dev/notifications/NotificationsPanel.tsx` | Dev console notification debug panel |
| `src/components/dev/DevSidebar.tsx` | Dev sidebar with Notifications link |

### Student App (React Native) — `C:\Projects\MockTestApp`

| Feature | Status |
|---------|--------|
| Notification service | ❌ **Not implemented** |
| FCM initialization | ❌ **Not implemented** |
| Firebase configuration | ❌ **Not implemented** |
| `@react-native-firebase/messaging` | ❌ Not installed |
| `expo-notifications` | ❌ Not installed |
| Device token registration | ❌ **Not implemented** |
| Foreground notification handler | ❌ **Not implemented** |
| Background notification handler | ❌ **Not implemented** |
| In-app notification screen | ❌ **Not implemented** |
| Unread notification badge | ❌ **Not implemented** |
| Notification deep linking | ❌ **Not implemented** |

---

## Key Technical Debt Summary

| Issue | Severity | Impact |
|-------|----------|--------|
| `createCommerceNotification()` duplicated across 2 Edge Functions | 🔴 High | Maintenance burden; fixes must be applied twice |
| PYQ purchase has NO push notification | 🔴 High | Students get no push notification for PYQ purchases |
| Student App has NO notification reception | 🔴 High | All notifications (server-side) are invisible to students |
| Notification preferences stored only in localStorage | 🟡 Medium | No server-side sync; cleared on logout/cache wipe |
| Legacy `notificationService.ts` still in use by `Header.tsx` | 🟡 Medium | Two parallel service layers for same operations |
| `notification_templates` table has no management UI | 🟡 Medium | Feature unused despite schema being complete |
| No Realtime subscription for notifications (Dashboard) | 🟢 Low | Dashboard requires page refresh to see new notifications |
| No automatic event triggers for any notification type | 🔴 High | No notification fires automatically for any system event |
