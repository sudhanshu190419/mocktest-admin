# Notification System Audit

> **Date:** 2026-07-23
> **Scope:** Teacher/Admin Dashboard + Student App (React Native)
> **Type:** Analysis only — no code changes

---

## 1. Current Architecture

### 1.1 Database Layer (PostgreSQL — Supabase)

**Core tables** (created in `010_domain_09_notifications.sql`):

| Table | Role | Key Columns |
|-------|------|-------------|
| `notification_templates` | Reusable message blueprints | `template_id`, `institute_id`, `event_type`, `title_template`, `body_template`, `channel`, `is_active` |
| `notifications` | Concrete dispatched notification events | `notification_id`, `institute_id`, `template_id`, `title`, `body`, `channel`, `event_type`, `reference_type`, `reference_id`, `is_deleted` |
| `notification_recipients` | Per-user per-notification delivery rows | `recipient_id`, `notification_id`, `profile_id`, `institute_id`, `is_read`, `read_at`, `received_at` |

**Supporting tables:**

| Table | Purpose |
|-------|---------|
| `device_tokens` (migration 048) | FCM registration tokens for push notification targeting |
| `webhook_endpoints` / `webhook_delivery_logs` | Webhook-based notification dispatch for external integrations |

**Enums:**

| Enum | Values | Defined in |
|------|--------|------------|
| `notification_channel` | `in_app`, `push`, `email`, `sms` | Domain 01 (foundation) |
| `notification_event_type` | Base: `live_class_reminder`, `test_published`, `result_available`, `content_approved`, `content_rejected`, `subscription_expiring`, `subscription_expired`, `new_content_uploaded`, `batch_assigned`, `announcement`, `custom` | Domain 09 |
| Extended types (JS/TS only) | `mock_test_assigned`, `mock_test_reminder`, `mock_test_submitted`, `chapter_added`, `subject_added`, `new_mock_test_available`, `general_message`, `warning`, `success`, `error` | `src/types/notification.ts` |
| Commerce types (migration 047) | `course_purchased`, `pyq_purchased`, `course_enrolled`, `pyq_access_granted` | Migration 047 |

**Triggers:**
- `trg_notifications_set_updated_at` — auto-updates `updated_at` on notifications
- `trg_notifications_set_deleted_at` — auto-sets `deleted_at` when `is_deleted` flips to true
- `trg_notification_templates_set_updated_at` — auto-updates `updated_at` on templates

**Key indexes:**
- `idx_notif_recipients_profile_unread` — partial index on `(profile_id, is_read)` where `is_read = false` (optimized unread count queries)
- `idx_notif_recipients_profile_received` — covers inbox ordering
- `uq_notification_recipients_notification_profile` — unique constraint prevents duplicate deliveries

**RLS Policies** (migration 021):
- Users can READ notifications addressed to them (via `notification_recipients`)
- Users can UPDATE `is_read` / `read_at` on their own recipient rows
- Admins have full CRUD on all notification tables
- `notification_templates` are admin-only

### 1.2 Backend / Edge Functions

| Function | File | Purpose | Status |
|----------|------|---------|--------|
| `dispatch-notification` | `supabase/functions/dispatch-notification/index.ts` | **Single entry point** for creating notifications + resolving audience + inserting recipient rows + optional FCM push | ✅ Built |
| `_shared/pushNotification.ts` | Shared helper | Sends FCM push notifications to user's active devices via Firebase Cloud Messaging HTTP v1 API | ✅ Built |
| `complete-course-purchase` | Edge Function | Creates `course_purchased` + `course_enrolled` notifications after purchase | ✅ Built |
| `complete-pyq-purchase` | Edge Function | Creates `pyq_purchased` + `pyq_access_granted` notifications after purchase | ✅ Built |

### 1.3 Teacher Dashboard (Next.js)

**Service Layer:**

| File | Exports | Purpose | Status |
|------|---------|---------|--------|
| `src/services/notification/notificationService.ts` | `getNotifications`, `getUnreadNotifications`, `getNotification`, `markAsRead`, `markAllAsRead`, `deleteNotification`, `createNotification`, `createBulkNotification`, `getAnnouncements`, `publishAnnouncement`, `getNotificationDashboardStats`, `notifyMockTestPublished`, `notifyResultPublished`, `notifyContentUploaded`, `notifyAnnouncement` | Full CRUD + helper functions | ✅ Built |
| `src/services/notificationService.ts` (legacy) | `getNotifications`, `markAsRead` (localStorage fallback) | OLD service — used by `src/components/Header.tsx` | ⚠️ Legacy / used by one component |

**React Query Hooks:**

| File | Exports | Status |
|------|---------|--------|
| `src/hooks/notification/useNotifications.ts` | `useNotifications`, `useUnreadNotifications`, `useNotification`, `useMarkAsRead`, `useMarkAllAsRead`, `useDeleteNotification`, `useCreateNotification`, `useCreateBulkNotification`, `useAnnouncements`, `usePublishAnnouncement`, `useNotificationDashboard` | ✅ Built |
| `src/hooks/notification/useSendNotification.ts` | `useSendAudienceNotification` — calls `dispatch-notification` Edge Function | ✅ Built |
| `src/hooks/notification/useNotificationPermissions.ts` | `useNotificationPermissions` — role-based audience/permission model | ✅ Built |
| `src/hooks/notification/queryKeys.ts` | `notificationKeys` — centralized React Query key factory | ✅ Built |

**Routes / Pages:**

| Route | File | Purpose | Status |
|-------|------|---------|--------|
| `/teacher/notifications` | Sidebar link | Teacher notification list page | ⚠️ Missing page file (link exists in sidebar) |
| `/teacher/notifications/[id]` | `src/app/teacher/notifications/[id]/page.tsx` | Notification detail + mark-as-read + delete | ✅ Built |
| `/admin/notifications` | `src/app/admin/notifications/page.tsx` | Admin notification dashboard | ✅ Built |
| `/admin/notifications/list` | `src/app/admin/notifications/list/page.tsx` | Full notification list with filters | ✅ Built |
| `/admin/notifications/create` | `src/app/admin/notifications/create/page.tsx` | Create notification + audience + push toggle | ✅ Built |
| `/admin/notifications/[id]` | `src/app/admin/notifications/[id]/page.tsx` | Notification detail | ✅ Built |
| `/admin/notifications/history` | `src/app/admin/notifications/history/page.tsx` | Sent notification history | ✅ Built |
| `/admin/notifications/scheduled` | `src/app/admin/notifications/scheduled/page.tsx` | Scheduled notifications view (synthetic data) | ⚠️ Partial |
| `/dev/notifications` | `src/app/dev/notifications/page.tsx` | Dev debug panel for testing all notification features | ✅ Built |
| `/teacher/profile/preferences` | `src/app/teacher/profile/preferences/page.tsx` | Notification preference toggles (localStorage only) | ⚠️ Local only |

**UI Components:**

| Component | Location | Purpose | Status |
|-----------|----------|---------|--------|
| `AdminHeader.tsx` | Bell icon + unread badge + dropdown | Notification bell with count + recent items dropdown | ✅ Built |
| `TeacherHeader.tsx` | Bell icon + unread badge | Notification bell with count (no dropdown) | ✅ Built |
| `Header.tsx` (legacy) | Bell icon + unread badge + dropdown | Old notification component using legacy service | ⚠️ Legacy |
| `NotificationToggle.tsx` | Profile settings | Toggle switches for notification preferences | ✅ Built |
| `NotificationsPanel.tsx` | Dev console | Full debug panel — list, create, bulk, dashboard stats | ✅ Built |
| Teacher Dashboard page | Widget | Recent notifications on teacher dashboard | ✅ Built |
| Admin Dashboard page | Stats card | Notification stats on admin dashboard | ✅ Built |

### 1.4 Admin Notification Support

**Admins DO receive notifications.** The following is fully implemented:
- Admin notification list page (`/admin/notifications`)
- Admin notification detail + mark-as-read + delete
- Admin notification creation with audience selection + push notification toggle
- Admin notification history
- Admin notification bell dropdown in `AdminHeader.tsx`
- "Scheduled" notifications tab (displays unread notifications as "scheduled" — synthetic, not true scheduling)

### 1.5 Student App (React Native)

**No notification implementation found.** The Student App at `C:\Projects\MockTestApp` does not contain any notification-related code:
- No notification screens
- No notification badges
- No realtime notification subscriptions
- No push notification setup (Firebase/Expo)
- No notification service or hooks

The student side has zero notification capability — neither in-app nor push.

---

## 2. Notification Types — Status Matrix

| Notification Type | DB Enum | Backend Service | Teacher UI | Admin UI | Student App | Edge Function |
|-------------------|---------|-----------------|------------|----------|-------------|---------------|
| `live_class_reminder` | ✅ `notification_event_type` | ❌ No helper | ❌ Not wired | ❌ Not wired | ❌ Missing | ❌ No trigger |
| `test_published` / `new_mock_test_available` | ✅ `notification_event_type` | ✅ `notifyMockTestPublished()` | ❌ Not wired | ❌ Not wired | ❌ Missing | ❌ No trigger |
| `result_available` / `result_published` | ✅ `notification_event_type` | ✅ `notifyResultPublished()` | ❌ Not wired | ❌ Not wired | ❌ Missing | ❌ No trigger |
| `content_approved` | ✅ `notification_event_type` | ❌ No helper | ❌ Not wired | ❌ Not wired | ❌ Missing | ❌ No trigger |
| `content_rejected` | ✅ `notification_event_type` | ❌ No helper | ❌ Not wired | ❌ Not wired | ❌ Missing | ❌ No trigger |
| `new_content_uploaded` | ✅ `notification_event_type` | ✅ `notifyContentUploaded()` | ❌ Not wired | ❌ Not wired | ❌ Missing | ❌ No trigger |
| `batch_assigned` | ✅ `notification_event_type` | ❌ No helper (manual insert in adminService.ts) | ❌ Not wired | ❌ Not wired | ❌ Missing | ❌ No trigger |
| `announcement` | ✅ `notification_event_type` | ✅ `notifyAnnouncement()` + `publishAnnouncement()` | ❌ Not wired | ✅ Create UI | ❌ Missing | ❌ No trigger |
| `subscription_expiring` | ✅ `notification_event_type` | ❌ No helper | ❌ Not wired | ❌ Not wired | ❌ Missing | ❌ No trigger |
| `subscription_expired` | ✅ `notification_event_type` | ❌ No helper | ❌ Not wired | ❌ Not wired | ❌ Missing | ❌ No trigger |
| `course_purchased` | ✅ (migration 047) | ✅ In edge function | ❌ Not wired | ❌ Not wired | ❌ Missing | ✅ `complete-course-purchase` |
| `pyq_purchased` | ✅ (migration 047) | ✅ In edge function | ❌ Not wired | ❌ Not wired | ❌ Missing | ✅ `complete-pyq-purchase` |
| `course_enrolled` | ✅ (migration 047) | ✅ In edge function | ❌ Not wired | ❌ Not wired | ❌ Missing | ✅ `complete-course-purchase` |
| `pyq_access_granted` | ✅ (migration 047) | ✅ In edge function | ❌ Not wired | ❌ Not wired | ❌ Missing | ✅ `complete-pyq-purchase` |
| `general_message` | ⚠️ TypeScript only | ❌ No helper | ❌ Not wired | ❌ Not wired | ❌ Missing | ❌ No trigger |
| `warning` | ⚠️ TypeScript only | ❌ No helper | ❌ Not wired | ❌ Not wired | ❌ Missing | ❌ No trigger |
| `success` | ⚠️ TypeScript only | ❌ No helper | ❌ Not wired | ❌ Not wired | ❌ Missing | ❌ No trigger |
| `error` | ⚠️ TypeScript only | ❌ No helper | ❌ Not wired | ❌ Not wired | ❌ Missing | ❌ No trigger |
| `mock_test_assigned` | ⚠️ TypeScript only | ❌ No helper | ❌ Not wired | ❌ Not wired | ❌ Missing | ❌ No trigger |
| `mock_test_reminder` | ⚠️ TypeScript only | ❌ No helper | ❌ Not wired | ❌ Not wired | ❌ Missing | ❌ No trigger |
| `mock_test_submitted` | ⚠️ TypeScript only | ❌ No helper | ❌ Not wired | ❌ Not wired | ❌ Missing | ❌ No trigger |
| `custom` | ✅ | ✅ Via `dispatch-notification` | ❌ Not wired | ✅ Create UI | ❌ Missing | ✅ Direct |

---

## 3. Event Sources — What Currently Creates Notifications

| Source | What it creates | Mechanism |
|--------|----------------|-----------|
| `adminService.ts` | `batch_assigned` notification | Manual `supabase.from('notifications').insert(...)` + localStorage fallback |
| `complete-course-purchase` Edge Function | `course_purchased` + `course_enrolled` | Server-side — creates notification + recipient + optional push |
| `complete-pyq-purchase` Edge Function | `pyq_purchased` + `pyq_access_granted` | Server-side — creates notification + recipient + optional push |
| `dispatch-notification` Edge Function | Any type with audience resolution | Called from `useSendAudienceNotification` hook in admin panel |
| `notificationService.ts` helpers | Mock test, result, content, announcement | Ready but NOT called from anywhere in production code |
| Dev Console (`NotificationsPanel.tsx`) | Any type, bulk, announcement | Debug tool — manually triggered from dev UI |
| **Database triggers** | **None** | No `CREATE TRIGGER` for automatic notification creation exists |

---

## 4. Missing Pieces / Technical Debt

### 4.1 Critical Gaps

| Gap | Impact | Priority |
|-----|--------|----------|
| **Student App has zero notification support** | Students cannot receive any notifications (in-app or push) | 🔴 High |
| **No automatic notification triggers** | Notification helpers exist but nothing calls them when events occur (mock test published, result available, etc.) | 🔴 High |
| **`batch_assigned` notification uses raw Supabase insert + localStorage fallback** | Bypasses the clean `dispatch-notification` edge function; inconsistent | 🟡 Medium |
| **Notification preferences are localStorage only** | Preferences are not synced to server; lost on browser clear / device change | 🟡 Medium |

### 4.2 Duplicate Implementations

| Duplicate | Details |
|-----------|---------|
| **Two notification services** | `src/services/notification/notificationService.ts` (clean, full-featured) vs `src/services/notificationService.ts` (legacy, localStorage-based). The legacy service is still used by `src/components/Header.tsx`. |
| **Two headers with notification bells** | `src/components/Header.tsx` (legacy, uses old service) and `src/components/teacher/Header.tsx` (new, uses proper hooks). The legacy Header is still rendered somewhere. |
| **Manual notification insert in adminService.ts** | `adminService.ts` manually inserts rows into `notifications` + `notification_recipients` using raw Supabase calls + localStorage fallback, bypassing the `dispatch-notification` edge function. |

### 4.3 Dead / Unused Code

| File | Why dead |
|------|----------|
| `src/components/dev/notifications/NotificationsPanel.tsx` | Only accessible via `/dev/notifications` route — debug tool, no production value |
| `src/services/notification/notificationService.ts` helper functions (`notifyMockTestPublished`, `notifyResultPublished`, etc.) | Built and exported but **never called** from any production code path |
| `src/types/profile.ts` → notification preferences | Stored in localStorage, no server-side persistence |

### 4.4 Incomplete Hooks / UI

| Item | Issue |
|------|-------|
| `/admin/notifications/scheduled` | Uses synthetic data — shows unread notifications as "scheduled". No actual scheduling exists. |
| Teacher notification list page (`/teacher/notifications`) | Sidebar link exists but the page file may be incomplete or missing |
| `useNotificationPermissions` | Built and exported but role detection uses hardcoded role string — always returns admin permissions |

### 4.5 Unused Tables

| Table | Status |
|-------|--------|
| `notification_templates` | Table exists + triggers + indexes + RLS. **No UI to manage templates.** No code reads from this table. |
| `device_tokens` | Table exists. **No API endpoint** to register/unregister device tokens from the Student App (since the Student App has no notification code). |

---

## 5. Recommended Implementation Order

### Phase 1 — Foundation (Student App + Edge Function Integration)
1. **Implement Student App notification service** — Create notification service, hooks, and in-app notification screen for React Native
2. **Wire up device token registration** — Create API endpoint + Student App registration flow for FCM push
3. **Integrate existing Edge Functions** — Connect `complete-course-purchase` and `complete-pyq-purchase` to the Student App
4. **Add realtime subscription** — Let students receive notifications in realtime via Supabase Realtime

### Phase 2 — Automatic Event Notifications
5. **Wire up notification helpers** — Call `notifyMockTestPublished()` when a mock test is published, `notifyResultPublished()` when results are released, etc.
6. **Create database trigger for high-volume events** — Use PG triggers to create notifications for events like live class reminders
7. **Add batch_assigned to dispatch-notification** — Replace manual insert in `adminService.ts` with proper Edge Function call

### Phase 3 — Admin & Polish
8. **Implement notification template management UI** — CRUD for `notification_templates` table
9. **Add server-side notification preferences** — Sync preferences to DB, remove localStorage dependency
10. **Clean up duplicates** — Migrate `Header.tsx` to use the new hooks, remove legacy `notificationService.ts`
11. **Scheduled notifications** — Add proper scheduling (cron or delayed dispatch)

### Phase 4 — Student App UI
12. **Build Student notification screen** — Full in-app notification list with read/unread/detail
13. **Add push notification handling** — FCM integration in the React Native app
14. **Add notification badge to Student tab bar** — Unread count badge

---

## 6. Architecture Diagram (Text)

```
┌─────────────────────────────────────────────────────────┐
│                    Event Sources                         │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ Mock Test│  │ Live Class   │  │ Purchase/Course  │   │
│  │ Published│  │ Started      │  │ Webhook         │   │
│  └────┬─────┘  └──────┬───────┘  └────────┬─────────┘   │
│       │               │                    │             │
│       ▼               ▼                    ▼             │
│  ┌────────────────────────────────────────────────────┐  │
│  │          dispatch-notification Edge Function        │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │  │
│  │  │ Auth +   │  │ Audience │  │ Notification +   │  │  │
│  │  │ Validate │  │ Resolve  │  │ Recipient Insert │  │  │
│  │  └──────────┘  └──────────┘  └────────┬─────────┘  │  │
│  │                                       │             │  │
│  │                              ┌────────▼────────┐   │  │
│  │                              │ Optional FCM    │   │  │
│  │                              │ Push Dispatch   │   │  │
│  │                              └─────────────────┘   │  │
│  └────────────────────────────────────────────────────┘  │
│                           │                              │
└───────────────────────────┼──────────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────────────┐
│                     Database (PostgreSQL)                      │
│                                                                │
│  ┌─────────────────────┐     ┌──────────────────────────────┐ │
│  │   notifications     │◄────│  notification_recipients     │ │
│  │  (event snapshot)   │     │  (per-user delivery rows)    │ │
│  └─────────────────────┘     └─────────────┬────────────────┘ │
│                                            │                  │
│  ┌─────────────────────┐                   │                  │
│  │ notification_       │  (reference)      │                  │
│  │ templates           │───────────────────┘                  │
│  └─────────────────────┘                                      │
│                                                                │
│  ┌─────────────────────┐                                      │
│  │ device_tokens       │  (used by FCM push)                  │
│  └─────────────────────┘                                      │
└───────────────────────────────────────────────────────────────┘
                            │
              ┌─────────────┼──────────────┐
              ▼             ▼              ▼
┌──────────────────┐ ┌────────────┐ ┌──────────────┐
│  Teacher Dashboard│ │Admin Panel │ │ Student App  │
│  (Next.js)        │ │(Next.js)   │ │ (React Native│
│                   │ │            │ │  — MISSING)  │
│ • Bell + badge    │ │ • Bell +   │ │              │
│ • Notif list      │ │   badge    │ │ • No notif   │
│ • Mark read       │ │ • Full CRUD│ │   screens    │
│ • Create (admin)  │ │ • Audience │ │ • No push    │
│                   │ │ • History  │ │ • No badge   │
└──────────────────┘ └────────────┘ └──────────────┘
```

---

## 7. Key Findings Summary

### What Works Well
- ✅ Clean database schema with proper indexes, RLS, and constraints
- ✅ Robust `dispatch-notification` Edge Function with audience resolution + push
- ✅ Well-structured React Query hooks with proper cache invalidation
- ✅ Admin notification UI is comprehensive (create, list, detail, history, scheduled view)
- ✅ Commerce notification flow via Edge Functions (course/PYQ purchase)
- ✅ Partial index on unread notifications for performance

### What's Missing
- ❌ **Student App has zero notification support** — biggest gap
- ❌ No automatic event-to-notification wiring (helpers exist but aren't called)
- ❌ Teacher notification list page may be incomplete
- ❌ Notification scheduling is synthetic (not real)
- ❌ Notification template management UI
- ❌ No server-side notification preference sync
- ❌ Device token registration API (FCM) has no frontend integration

### Technical Debt
- ⚠️ Two notification services (legacy + new) — `Header.tsx` still uses old one
- ⚠️ Manual notification insert in `adminService.ts` bypasses Edge Function
- ⚠️ Notification preferences in localStorage only
- ⚠️ `notification_templates` table has no management UI
- ⚠️ `useNotificationPermissions` uses hardcoded role instead of actual auth role
- ⚠️ Several notification types exist in TypeScript types but not in DB enum
