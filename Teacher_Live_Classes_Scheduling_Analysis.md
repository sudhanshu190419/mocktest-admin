# Teacher Live Classes — Scheduling Workflow Analysis

> **Date:** July 21, 2026
> **Scope:** Teacher/Admin Website only (`mocktest-admin`)
> **Status:** Pre-implementation analysis — no code changed

---

## Table of Contents

1. [Current Architecture Summary](#1-current-architecture-summary)
2. [Instant Go Live — Complete Flow Map](#2-instant-go-live--complete-flow-map)
3. [Scheduling Analysis: What Exists vs What's Needed](#3-scheduling-analysis-what-exists-vs-whats-needed)
4. [Component Analysis: Keep, Extend, or Create](#4-component-analysis-keep-extend-or-create)
5. [Database & API Analysis](#5-database--api-analysis)
6. [Proposed UX Flows](#6-proposed-ux-flows)
7. [Implementation Plan: Exact Files & Changes](#7-implementation-plan-exact-files--changes)

---

## 1. Current Architecture Summary

### 1.1 Entry Points for "Go Live"

There are **5 entry points** that all converge on the same `LiveStudioView` modal:

| # | Entry Point | Location | Trigger |
|---|-------------|----------|---------|
| 1 | **Header** | `src/components/Header.tsx` (line 173) | "Go Live" button in top bar |
| 2 | **OverviewView** | `src/views/OverviewView.tsx` (lines 127, 238) | "Go Live" / "Start Live Broadcast" buttons |
| 3 | **ScheduleView** | `src/views/ScheduleView.tsx` (line 216) | "Start Live Broadcast" button in live studio launchpad |
| 4 | **AdminOverviewView** | `src/views/admin/AdminOverviewView.tsx` (line 68) | "Go Live" button |
| 5 | **FacultyDashboard** | `src/components/dashboard/FacultyDashboard.tsx` (lines 96-118) | All above views passed via `onLaunchLive` prop |

All pass `onLaunchLive={() => setShowLiveStudio(true)}` → `LiveStudioView(isOpen, onClose)`.

### 1.2 Instant Go Live — End-to-End Sequence

```
LiveStudioView opens (isOpen=true)
  │
  ├─ getUserMedia starts camera/mic preview
  │
  ├─ Teacher clicks "GO LIVE"
  │   └─ StartLiveDialog opens
  │       ├─ Fetches assigned batches
  │       ├─ Teacher selects batch + optional title
  │       └─ Teacher clicks "Start Live"
  │
  ├─ useLiveClass.startClass(selections)
  │   ├─ teacherService.getOrCreateActiveLiveClass()
  │   │   ├─ Validates batch assignment
  │   │   ├─ Checks for existing scheduled/live class (reuses if found)
  │   │   ├─ INSERT live_classes (scheduled_at=now(), duration_min=90, status='scheduled')
  │   │   └─ INSERT live_class_batch (class_id, batch_id)
  │   ├─ buildRoomName(classId) → "class-{8chars}"
  │   ├─ getLiveKitToken(roomName, teacherName, role='teacher')
  │   ├─ teacherService.startLiveClass()
  │   │   ├─ UPDATE live_classes (status='live', room_name)
  │   │   ├─ INSERT live_sessions (provider='livekit', status='live')
  │   │   └─ INSERT session_participants (teacher profile)
  │   └─ setState({ status: 'live', classId, roomName, token, url })
  │
  ├─ LiveKitRoom renders (auto-connects)
  │   ├─ Video stage with camera tracks
  │   ├─ ControlBar (camera/mic toggle + END SESSION)
  │   └─ onDisconnected → endClass()
  │
  ├─ Teacher clicks "END SESSION"
  │   └─ useLiveClass.endClass()
  │       ├─ teacherService.endLiveClass()
  │       │   ├─ UPDATE live_classes (status='completed')
  │       │   └─ UPDATE live_sessions (status='ended', ended_reason='host_ended')
  │       └─ setState({ status: 'ended' })
  │
  └─ Teacher clicks "CLOSE STUDIO"
      └─ onClose() → reset()
```

### 1.3 Key Files Involved in Current Flow

| File | Role | Lines |
|------|------|-------|
| `src/services/teacherService.ts` | DB operations for live classes | ~300 lines total, ~100 for live class |
| `src/hooks/useLiveClass.ts` | Lifecycle orchestrator | ~190 lines |
| `src/lib/livekit/tokenService.ts` | LiveKit token from Edge Function | ~170 lines |
| `src/components/live-studio/LiveStudioView.tsx` | Full-screen modal (preview + live) | ~460 lines |
| `src/components/live-studio/StartLiveDialog.tsx` | Pre-start dialog (batch + title) | ~180 lines |
| `src/components/live-studio/ControlBar.tsx` | Camera/mic + end class | ~80 lines |
| `src/components/dashboard/FacultyDashboard.tsx` | Main layout, toggles LiveStudio | ~130 lines |
| `src/components/Header.tsx` | Header with Go Live button | ~180 lines |
| `src/views/OverviewView.tsx` | Teacher overview with Go Live CTA | ~280 lines |
| `src/views/ScheduleView.tsx` | Schedule view with Go Live CTA | ~540 lines |
| `src/views/admin/AdminOverviewView.tsx` | Admin overview with Go Live | ~80 lines |

---

## 2. Instant Go Live — Complete Flow Map

### 2.1 Call Chain

```
Header.onLaunchLive
  → FacultyDashboard.setShowLiveStudio(true)
  → LiveStudioView(isOpen=true)
      → getUserMedia() camera preview
      → StartLiveDialog(teacherId, onStart, onCancel)
          → teacherService.getAssignedBatches(teacherId)
          → user selects batch + title
          → StartLiveDialog.onStart({ batchId, batchName, title })
              → LiveStudioView: startClass(selections)
              → useLiveClass.startClass(selections)
                  → teacherService.getOrCreateActiveLiveClass(teacherId, '', batchId, null, title)
                  → buildRoomName(classId) → "class-{short}"
                  → teacherService.getTeacherProfileId(teacherId)
                  → getLiveKitToken({ roomName, participantName, role: 'teacher' })
                  → teacherService.startLiveClass(classId, profileId, roomName, instituteId)
                  → setState({ status: 'live', token, url, roomName })
              → LiveKitRoom renders (connect=true), auto-connects
```

### 2.2 State Machine

```
                    startClass()
  ┌────────┐     ──────────────▶    ┌─────────┐     connect()      ┌────────┐
  │ idle   │          │             │ loading │     ───────────▶    │  live  │
  │        │◀─────────│      ─────▶ │         │                    │        │
  └────────┘   reset  │             └─────────┘                    └───┬────┘
      ▲                                                               │
      │                                                               │ endClass()
      │                                                               ▼
      │                         reset()                          ┌────────┐
      │◀──────────────────────────────────────────────────────    │ ended  │
      │                    (after close)                         └────────┘
      │                                                               ▲
      │                                                               │
      │                                                        ┌───────────┐
      └─────────────────────────────────────────────────────────│  ending   │
                                  endClass()                    └───────────┘
```

### 2.3 Database States During Flow

```
CREATE: live_classes { status: 'scheduled', scheduled_at: now(), duration_min: 90 }
        live_class_batch { class_id, batch_id }

GO LIVE: live_classes { status: 'live', room_name: 'class-...' }
         live_sessions { status: 'live', provider: 'livekit' }
         session_participants { teacher profile }

END CLASS: live_classes { status: 'completed' }
           live_sessions { status: 'ended', ended_reason: 'host_ended' }
```

### 2.4 Critical Finding: `room_name` column

The `room_name` column is **NOT defined in any migration file**. It is referenced in `teacherService.ts` (line 389) as:

```typescript
.update({ status: 'live', room_name: roomName, ... })
```

This means either:
- The column was added manually (outside migrations), or
- The query silently fails on this column update

**Action needed**: Verify column existence and add migration if missing.

---

## 3. Scheduling Analysis: What Exists vs What's Needed

### 3.1 Database Readiness

| Feature | DB Column | Exists? | Ready? |
|---------|-----------|---------|--------|
| Class title | `live_classes.title` | ✅ | ✅ |
| Scheduled date/time | `live_classes.scheduled_at` | ✅ | ✅ (currently set to `now()`) |
| Duration | `live_classes.duration_min` | ✅ | ✅ (currently hardcoded to 90) |
| Status | `live_classes.status` | ✅ | ✅ (draft→scheduled→live→completed→cancelled) |
| Batch link | `live_class_batch` | ✅ | ✅ |
| Subject | `live_classes.subject_id` | ✅ | ✅ (currently auto-selected) |
| Chapter | `live_classes.chapter_id` | ✅ | ✅ (nullable) |
| Room name | `live_classes.room_name` | ❓ Missing from migrations | ❓ Must verify |
| Description | `live_classes.description` | ✅ | ✅ (nullable) |
| Cancellation | `live_classes.cancelled_at/reason` | ✅ | ✅ (with CHECK constraints) |
| Recording flag | `live_classes.is_recorded` | ✅ | ✅ |

**Conclusion: No database migrations are required for scheduling.** All columns already exist.

### 3.2 API Readiness

| Operation | Method | Exists? | Status |
|-----------|--------|---------|--------|
| Create class (immediate) | `getOrCreateActiveLiveClass()` | ✅ | **Reuses existing scheduled/live classes** |
| Start class (go live) | `startLiveClass()` | ✅ | Sets status='live', creates session |
| End class | `endLiveClass()` | ✅ | Sets status='completed', ends session |
| **Schedule class (future date)** | — | ❌ | **Needs new method** |
| **Get teacher's class list** | `getTeacherOverviewData()` | ⚠️ | Returns only **1** upcoming class |
| **Get all scheduled classes** | — | ❌ | **Needs new method** |
| **Get completed classes** | — | ❌ | **Needs new method** |
| **Update scheduled class** | — | ❌ | **Needs new method** |
| **Cancel scheduled class** | — | ❌ | **Needs new method** |

### 3.3 Component Readiness

| Component | Purpose | Exists? | Status |
|-----------|---------|---------|--------|
| LiveStudioView | Live broadcast modal | ✅ | **Keep as-is** |
| StartLiveDialog | Pre-start config | ✅ | **Keep for Instant Go Live only** |
| ControlBar | In-session controls | ✅ | **Keep as-is** |
| **ScheduleDialog** | **Schedule a future class** | ❌ | **New component needed** |
| **ClassListView** | **List scheduled/live/completed** | ❌ | **New component/view needed** |
| **ClassCard** | **Single class display card** | ❌ | **New component needed** |
| **ScheduleView enhancement** | Add class management tabs | ⚠️ | **Extend existing view** |

---

## 4. Component Analysis: Keep, Extend, or Create

### 4.1 Components to Keep UNCHANGED

These components serve the **Instant Go Live** flow only and should not be modified:

| Component | Reason to Keep |
|-----------|---------------|
| `ControlBar.tsx` | Pure in-session control. Works for both scheduled and instant. |
| `LiveStudioView.tsx` | Full-screen broadcast modal. The core live experience should not change. |
| `useLiveClass.ts` | Lifecycle orchestrator (idle→loading→live→ending→ended). Instant Go Live only. |
| `StartLiveDialog.tsx` | Pre-start dialog for instant Go Live. Should NOT be reused for scheduling. |

### 4.2 Components to EXTEND

| Component | Extension | Justification |
|-----------|-----------|---------------|
| `ScheduleView.tsx` | Add tab navigation: "Upcoming" / "Live" / "Completed" / "Schedule New" | This view already shows batches and live classes. Natural home for scheduling. |
| `teacherService.ts` | Add new methods: `scheduleLiveClass()`, `getTeacherClasses()`, `updateScheduledClass()`, `cancelScheduledClass()` | Central service for all teacher DB operations. Keep live class methods alongside. |
| `Header.tsx` | Add "Schedule" button alongside "Go Live" | Teachers need a fast way to schedule from anywhere. |

### 4.3 NEW Components Needed

| Component | Purpose | Parent/Route |
|-----------|---------|-------------|
| `ScheduleClassDialog.tsx` | Form to create a future-dated class (date, time, duration, batch, title, subject, chapter) | Opened from ScheduleView or standalone |
| `ClassCard.tsx` | Reusable card showing class info + context-sensitive actions (Go Live, Edit, Cancel, View Recording) | Used inside list views |
| `ClassListView.tsx` | Tabbed list view showing Upcoming / Live / Completed classes | ScheduleView |
| `EditScheduledClassDialog.tsx` | Edit an existing scheduled class (same fields as creation) | Opened from ClassCard |
| `teacherLiveClassService.ts` | **Optional** — Extract live class operations from bloated `teacherService.ts` | New service file |

---

## 5. Database & API Analysis

### 5.1 CRUD Matrix

| Operation | SQL | Status | New Method |
|-----------|-----|--------|-----------|
| **C**reate scheduled | INSERT live_classes + live_class_batch | ⚠️ `getOrCreateActiveLiveClass()` only does instant | `scheduleLiveClass()` |
| **R**ead all (teacher) | SELECT * FROM live_classes WHERE teacher_id = X | ⚠️ Only returns 1 class in `getTeacherOverviewData()` | `getTeacherClasses()` |
| **R**ead single | SELECT * FROM live_classes WHERE class_id = X | ❌ Missing | `getTeacherClassById()` |
| **U**pdate scheduled | UPDATE live_classes SET ... WHERE class_id = X | ❌ Missing | `updateScheduledClass()` |
| **C**ancel scheduled | UPDATE live_classes SET status='cancelled' WHERE class_id = X | ❌ Missing | `cancelScheduledClass()` |
| **D**elete draft | DELETE FROM live_classes WHERE class_id = X AND status='draft' | ❌ Missing | (consider if needed) |
| **S**tart scheduled | UPDATE live_classes SET status='live' + create live_sessions | ✅ `startLiveClass()` | Reuse as-is |
| **E**nd live | UPDATE live_classes SET status='completed' + end session | ✅ `endLiveClass()` | Reuse as-is |

### 5.2 New Method Signatures

```typescript
// ─── Scheduling ───────────────────────────────────────────────────────

/**
 * Schedule a live class for a future date/time.
 * Unlike getOrCreateActiveLiveClass(), this ALWAYS creates a new row
 * and NEVER reuses existing classes.
 */
async scheduleLiveClass(params: {
  teacherId: string;
  batchIds: string[];        // Support multiple batches (the DB supports it)
  title: string;
  subjectId: string;
  chapterId: string | null;
  scheduledAt: string;       // ISO date string (future)
  durationMin: number;
  description?: string;
  isRecorded?: boolean;
}): Promise<{ classId: string; title: string }>;

// ─── Listing ──────────────────────────────────────────────────────────

/**
 * Get all live classes for a teacher, optionally filtered by status.
 * Used for Upcoming / Live / Completed / Cancelled tabs.
 */
async getTeacherClasses(teacherId: string, filters?: {
  status?: ('scheduled' | 'live' | 'completed' | 'cancelled')[];
  fromDate?: string;
  toDate?: string;
  batchId?: string;
  page?: number;
  pageSize?: number;
}): Promise<{
  classes: LiveClassListItem[];
  total: number;
}>;

/**
 * Get a single live class with full details (including batch names,
 * teacher name, session info, student count).
 */
async getTeacherClassById(classId: string): Promise<LiveClassDetail | null>;

// ─── Update / Cancel ──────────────────────────────────────────────────

/**
 * Update a scheduled class (only allowed if status is 'draft' or 'scheduled').
 */
async updateScheduledClass(classId: string, updates: {
  title?: string;
  scheduledAt?: string;
  durationMin?: number;
  description?: string;
  subjectId?: string;
  chapterId?: string | null;
  batchIds?: string[];
  isRecorded?: boolean;
}): Promise<void>;

/**
 * Cancel a scheduled class. Sets status to 'cancelled', records reason.
 * Only allowed if status is 'scheduled' (not 'live' or 'completed').
 */
async cancelScheduledClass(classId: string, reason?: string): Promise<void>;
```

### 5.3 New Types Needed

```typescript
// ─── For lists ────────────────────────────────────────────────────────

export interface LiveClassListItem {
  classId: string;
  title: string;
  status: 'draft' | 'scheduled' | 'live' | 'completed' | 'cancelled';
  scheduledAt: string;           // ISO
  durationMin: number;
  batchName: string;
  batchId: string;
  subjectName: string;
  chapterName?: string;
  teacherName: string;
  enrolledStudentCount: number;
  isRecorded: boolean;
  createdAt: string;
}

// ─── For detail view ──────────────────────────────────────────────────

export interface LiveClassDetail extends LiveClassListItem {
  description?: string;
  cancelledAt?: string;
  cancelledReason?: string;
  recordingUrl?: string;
  session?: {
    sessionId: string;
    status: 'waiting' | 'live' | 'ended';
    startedAt?: string;
    endedAt?: string;
    peakParticipants?: number;
  };
  batches: { batchId: string; batchName: string }[];
}
```

### 5.4 No Database Migration Required

The existing `live_classes` table schema already supports:
- Future `scheduled_at` timestamps
- All required statuses (`draft`, `scheduled`, `live`, `completed`, `cancelled`)
- Duration, subject, chapter, description, recording flag
- Cancellation tracking (`cancelled_at`, `cancelled_reason`)
- Multiple batch delivery (`live_class_batch` junction table)

**The only database concern is the `room_name` column**, which is referenced in code but missing from migrations. Verify and add if needed.

---

## 6. Proposed UX Flows

### 6.1 Entry Points & Navigation

```
┌─────────────────────────────────────────────────────────────┐
│                    TEACHER DASHBOARD                         │
│                                                             │
│  Header:  [Schedule Class ↓]  [Go Live →]  [Bell] [Avatar]  │
│                            ┌──────┘                         │
│                            ▼                                 │
│                ┌───────────────────────┐                     │
│                │ Schedule Class Dialog │                     │
│                │ ───────────────────── │                     │
│                │ Date: [____] Time:[_]  │                     │
│                │ Duration: [___] min   │                     │
│                │ Batch: [dropdown]     │                     │
│                │ Subject: [dropdown]   │                     │
│                │ Title: [__________]   │                     │
│                │ ───────────────────── │                     │
│                │ [Schedule] [Cancel]   │                     │
│                └───────────────────────┘                     │
│                                                             │
│  Main Content Area:                                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ [Upcoming] [Live Now] [Completed] [+ Schedule New]   │   │
│  │                                                      │   │
│  │  ┌─────────────────┐  ┌─────────────────┐           │   │
│  │  │ Rotational Dyn  │  │ Electrostatics   │           │   │
│  │  │ Today 2:00 PM   │  │ Tomorrow 10:30AM │           │   │
│  │  │ JEE Alpha       │  │ NEET Prime       │           │   │
│  │  │ [Go Live] [Edit] │  │ [Go Live] [Edit] │           │   │
│  │  │ [Cancel]         │  │ [Cancel]         │           │   │
│  │  └─────────────────┘  └─────────────────┘           │   │
│  │                                                      │   │
│  │  ┌─────────────────┐                                │   │
│  │  │ Kinematics      │                                │   │
│  │  │ Jul 25, 4:00 PM │                                │   │
│  │  │ Foundation      │                                │   │
│  │  │ [Go Live] [Edit]│                                │   │
│  │  │ [Cancel]        │                                │   │
│  │  └─────────────────┘                                │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 Flow: Schedule Class

```
Teacher clicks "Schedule Class" (Header or +Schedule New tab)
  │
  ▼
ScheduleClassDialog opens
  │
  ├─ Teacher fills:
  │   ├─ Title (required)
  │   ├─ Batch (required, single-select for now)
  │   ├─ Date (required, date picker)
  │   ├─ Time (required, time picker)
  │   ├─ Duration (required, default 60 min, 15-480)
  │   ├─ Subject (auto-selected, or dropdown if multiple)
  │   ├─ Chapter (optional dropdown)
  │   ├─ Record class? (checkbox, default off)
  │   └─ Description (optional textarea)
  │
  ├─ Teacher clicks "Schedule"
  │
  ▼
teacherService.scheduleLiveClass({
  teacherId, batchIds: [batchId], title, subjectId,
  chapterId, scheduledAt, durationMin, description, isRecorded
})
  │
  ├─ INSERT live_classes (status='scheduled')
  ├─ INSERT live_class_batch (class, batch)
  │
  ▼
Toast: "Class scheduled successfully"
→ Class appears in "Upcoming" tab
```

### 6.3 Flow: Start Scheduled Class

```
Teacher is in "Upcoming" tab, sees their scheduled class
  │
  ├─ Teacher clicks "Go Live" on class card
  │
  ▼
LiveStudioView opens (same as Instant Go Live)
  │
  ├─ Camera preview starts
  │
  ├─ Teacher clicks "GO LIVE"
  │   └─ StartLiveDialog opens (pre-filled with batch + title from scheduled class)
  │       └─ Teacher clicks "Start Live"
  │
  ├─ useLiveClass.startClass() is called
  │   ├─ BUT: Instead of getOrCreateActiveLiveClass(), we do:
  │   │   └─ teacherService.startScheduledClass(classId)
  │   │       ├─ Validates: exists, status='scheduled', belongs to teacher
  │   │       ├─ buildRoomName(classId)
  │   │       ├─ getLiveKitToken()
  │   │       └─ teacherService.startLiveClass()  ← REUSE EXISTING
  │   └─ Continues as normal (LiveKitRoom, ControlBar, End Class)
  │
  └─ Live broadcast proceeds as before
```

### 6.4 Flow: End Class

**UNCHANGED from current flow.** The `endClass()` flow in `useLiveClass` → `teacherService.endLiveClass()` works for both scheduled and instant classes.

### 6.5 Flow: Edit Scheduled Class

```
Teacher clicks "Edit" on a scheduled class card
  │
  ▼
EditScheduledClassDialog opens (same fields as creation, pre-filled)
  │
  ├─ Teacher modifies fields
  │
  ├─ Teacher clicks "Save"
  │
  ▼
teacherService.updateScheduledClass(classId, updates)
  │
  ├─ UPDATE live_classes SET ... WHERE class_id = classId AND status = 'scheduled'
  │
  ▼
Toast: "Class updated"
→ Card updates in list
```

### 6.6 Flow: Cancel Scheduled Class

```
Teacher clicks "Cancel" on a scheduled class card
  │
  ▼
Confirm dialog: "Are you sure you want to cancel this class? Students will be notified."
  │
  ├─ Teacher clicks "Yes, Cancel"
  │
  ▼
teacherService.cancelScheduledClass(classId, reason?)
  │
  ├─ UPDATE live_classes SET status='cancelled', cancelled_at=now(), cancelled_reason=?
  │
  ▼
Toast: "Class cancelled"
→ Class moves to "Completed" tab (or hidden, depending on design)
```

### 6.7 Flow: Instant Go Live (PRESERVED UNCHANGED)

The entire existing flow remains identical:

```
Header "Go Live" → LiveStudioView → StartLiveDialog → useLiveClass.startClass()
  → getOrCreateActiveLiveClass() → buildRoomName() → getLiveKitToken()
  → startLiveClass() → LiveKitRoom
```

**No changes to Instant Go Live flow.**

---

## 7. Implementation Plan: Exact Files & Changes

### 7.1 Summary of Changes

| Action | Count |
|--------|-------|
| **KEEP (no changes)** | 3 files |
| **EXTEND (add methods)** | 2 files |
| **CREATE (new components)** | 4 files |
| **TOTAL** | **9 files affected** |

### 7.2 Files to KEEP (No Changes)

| File | Reason |
|------|--------|
| `src/components/live-studio/ControlBar.tsx` | Works for all live sessions |
| `src/components/live-studio/LiveStudioView.tsx` | The broadcast modal is flow-agnostic |
| `src/hooks/useLiveClass.ts` | Lifecycle management for the Go Live→End flow |

### 7.3 Files to CREATE

#### New File 1: `src/services/teacherLiveClassService.ts`

**Purpose:** New service for scheduling and listing live classes. Keeping this separate from the bloated `teacherService.ts` (which also handles batches, students, leaves, etc.).

**Methods:**
- `scheduleLiveClass(params)` — Create future-dated class
- `getTeacherClasses(teacherId, filters)` — List with pagination
- `getTeacherClassById(classId)` — Single class detail
- `startScheduledClass(classId)` — Start a pre-scheduled class
- `updateScheduledClass(classId, updates)` — Edit scheduled
- `cancelScheduledClass(classId, reason?)` — Cancel scheduled

**Reuses from teacherService:**
- `startLiveClass()` (after startScheduledClass updates status)
- `endLiveClass()`

#### New File 2: `src/components/live-studio/ScheduleClassDialog.tsx`

**Purpose:** Modal dialog for scheduling a future live class.

**Fields:**
- Title (text input, required)
- Batch (dropdown, loaded from `teacherService.getAssignedBatches()`, required)
- Date (date picker or formatted text input, required)
- Time (time picker, required)
- Duration (number input, default 60, required)
- Subject (dropdown, loaded from `teacherService.getAuthorizedSubjects()`, auto-select if 1)
- Chapter (dropdown, optional, loaded after subject selection)
- Record class? (checkbox)
- Description (textarea, optional)

**Props:**
```typescript
interface ScheduleClassDialogProps {
  teacherId: string;
  onScheduled: (classId: string) => void;  // Called after successful scheduling
  onCancel: () => void;
}
```

#### New File 3: `src/components/live-studio/ClassCard.tsx`

**Purpose:** Reusable card component for displaying a live class in any list.

**States:** Scheduled / Live / Completed / Cancelled

**Context-sensitive actions:**
- Scheduled: "Go Live" | "Edit" | "Cancel"
- Live: "Open Studio" (links to LiveStudioView for this class)
- Completed: "View Details" | "View Recording" (if recorded)

**Props:**
```typescript
interface ClassCardProps {
  class: LiveClassListItem;
  onGoLive?: (classId: string) => void;
  onEdit?: (classId: string) => void;
  onCancel?: (classId: string) => void;
  onViewDetails?: (classId: string) => void;
}
```

#### New File 4: `src/components/live-studio/EditScheduledClassDialog.tsx`

**Purpose:** Edit an existing scheduled class. Same fields as `ScheduleClassDialog`, but pre-filled.

**Props:**
```typescript
interface EditScheduledClassDialogProps {
  teacherId: string;
  classId: string;
  onUpdated: (classId: string) => void;
  onCancel: () => void;
}
```

### 7.4 Files to EXTEND

#### Extension 1: `src/views/ScheduleView.tsx`

**Current:** Shows batches, student roster, availability, and an upcoming class CTA.

**Extension needed:**
- Add tab navigation at top:
  - `[Upcoming] [Live Now] [Completed] [+ Schedule New]`
- "Upcoming" tab: List of scheduled classes using `ClassCard`
- "Live Now" tab: Currently live classes with prominent "Open Studio" button
- "Completed" tab: Past classes with recording links
- "+ Schedule New" tab: Opens `ScheduleClassDialog`
- Keep existing batch/roster functionality below (or in a separate section)

**Specific changes:**
- Import new components
- Add new state variables (activeTab, classes, loading)
- Fetch data from `teacherLiveClassService.getTeacherClasses()`
- Wire up Go Live action to open `LiveStudioView` (reusing existing `onLaunchLive` prop)

#### Extension 2: `src/services/teacherService.ts`

**Current:** Contains `getOrCreateActiveLiveClass()`, `startLiveClass()`, `endLiveClass()`.

**Extension needed:**
- Add a `getTeacherProfileId()` helper (already present, keep)
- Add `getBatchDetails(batchId)` for displaying batch info
- No changes to existing methods — new scheduling methods go in `teacherLiveClassService.ts`

#### Extension 3: `src/components/Header.tsx`

**Current:** Has a single "Go Live" button.

**Extension needed:**
- Add a "Schedule Class" button next to "Go Live" (or a dropdown: "Schedule Class" / "Go Live")
- Wire it to open `ScheduleClassDialog` or navigate to `ScheduleView` schedule tab

### 7.5 Files That MAY Need Changes (Investigate Further)

| File | Reason | Likelihood |
|------|--------|-----------|
| `FacultyDashboard.tsx` | May need to pass `classId` to LiveStudioView for editing existing scheduled classes | Low |
| `src/app/teacher/page.tsx` | Teacher dashboard page shows upcoming class card — may need enhancement | Low |
| `src/app/teacher/schedule/page.tsx` | If a dedicated schedule page exists, needs updating | Check if exists |

### 7.6 Implementation Order

```
Phase 1: Foundation (No UI changes)
────────────────────────────────────
  1. CREATE teacherLiveClassService.ts with all new methods
  2. Verify room_name column exists in database; add migration if not

Phase 2: Scheduling UI
────────────────────────
  3. CREATE ScheduleClassDialog.tsx
  4. EXTEND Header.tsx — add Schedule Class button
  5. EXTEND ScheduleView.tsx — add class list tabs

Phase 3: Class Management
──────────────────────────
  6. CREATE ClassCard.tsx
  7. CREATE EditScheduledClassDialog.tsx
  8. Wire Start Scheduled Class flow (reuse LiveStudioView)

Phase 4: Polish
────────────────
  9. Add toast notifications for schedule/create/cancel actions
  10. Wire up completed classes with recording links
```

---

## Appendix A: Verify `room_name` Column

The `teacherService.ts` file (line 389) does:

```typescript
.update({ status: 'live', room_name: roomName, ... })
```

But no migration file contains `room_name` in the `live_classes` table definition. **Before implementing any scheduling feature, verify:**

```
SELECT column_name FROM information_schema.columns
WHERE table_name = 'live_classes' AND column_name = 'room_name';
```

If missing, create migration:
```sql
ALTER TABLE public.live_classes
ADD COLUMN room_name varchar(500) null default null;

COMMENT ON COLUMN public.live_classes.room_name IS
  'LiveKit room name for this class. Set when the class goes live.';
```

---

## Appendix B: Complete File Change List

```
FILES TO CREATE (4):
  src/services/teacherLiveClassService.ts        (NEW - scheduling + listing)
  src/components/live-studio/ScheduleClassDialog.tsx  (NEW - scheduling form)
  src/components/live-studio/ClassCard.tsx        (NEW - reusable card)
  src/components/live-studio/EditScheduledClassDialog.tsx (NEW - edit form)

FILES TO EXTEND (3):
  src/views/ScheduleView.tsx                      (ADD tabs + class list)
  src/services/teacherService.ts                  (ADD getBatchDetails helper)
  src/components/Header.tsx                       (ADD Schedule Class button)

FILES TO KEEP UNCHANGED (3):
  src/components/live-studio/ControlBar.tsx
  src/components/live-studio/LiveStudioView.tsx
  src/hooks/useLiveClass.ts

POSSIBLE ADDITIONAL FILES:
  supabase/migrations/xxx_add_room_name_to_live_classes.sql  (if column missing)

TOTAL: 7-8 files affected (4 new + 3 extended + 0-1 migrations)
```

---

## Appendix C: Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| `room_name` column missing | DB writes fail silently | High | Verify before starting |
| Reusing scheduled class in Instant Go Live | Teacher sees old pre-filled data | Medium | `scheduleLiveClass()` always creates new |
| Existing `getOrCreateActiveLiveClass()` reuses scheduled class | Teacher can't have both instant + scheduled simultaneously | Medium | Fix the method to NOT reuse — or deprecate for new flow |
| StartLiveDialog still needed for scheduled classes | Confusing to have two dialogs | Low | Two dialogs is fine: one for config, one for schedule |
