# Live Classes — Architecture Analysis

> **Date:** July 21, 2026
> **Scope:** Teacher/Admin Website (`mocktest-admin`) · Student App (`MockTestApp`) · Supabase · LiveKit Cloud
> **Status:** Pre-implementation analysis

---

## 1. Current Architecture Overview

```
┌──────────────────────┐     ┌──────────────────────┐     ┌──────────────────────┐
│  Teacher/Admin Web   │     │   Student Mobile App │     │   LiveKit Cloud      │
│  (Next.js)           │     │   (React Native)     │     │   (WebRTC/SFU)       │
│                      │     │                      │     │                      │
│  LiveStudioView      │     │  LiveClassesTabScreen│     │  Room management     │
│  useLiveClass        │     │  useLiveKit          │     │  Token verification  │
│  useLiveClasses      │     │  JoinRoomScreen      │     │  Media relay         │
│  teacherService      │     │  LiveRoomScreen      │     │                      │
│                      │     │  tokenService        │     │                      │
└────────┬─────────────┘     └─────────┬────────────┘     └────────┬─────────────┘
         │                             │                          │
         │        ┌────────────────────┴──────────────────┐       │
         │        │           Supabase                    │       │
         │        │                                       │       │
         │        │  livekit-token Edge Function          │◄──────┘
         │        │  live_classes table                   │
         │        │  live_sessions table                  │
         │        │  live_class_batch table               │
         │        │  session_participants table           │
         │        │  RLS Policies                         │
         └────────┤                                       │
                  └───────────────────────────────────────┘
```

### Key Finding: Asymmetric Implementation

The **teacher side is fully implemented** (Go Live → Broadcast → End Class), while the **student side has only a POC/test screen** with no real integration to the database. The student app has LiveKit dependencies installed and basic components built, but no connection to the actual class data.

---

## 2. Current Database Design

### 2.1 Tables

#### `live_classes` (Domain 04 — Live Learning)
| Column | Type | Notes |
|--------|------|-------|
| `class_id` | `uuid PK` | Default `gen_random_uuid()` |
| `institute_id` | `uuid FK` → institutes |
| `teacher_id` | `uuid FK` → teacher_details |
| `subject_id` | `uuid FK` → subjects |
| `chapter_id` | `uuid FK nullable` → chapters |
| `title` | `varchar(500)` | Min 3 chars |
| `description` | `text nullable` |
| `scheduled_at` | `timestamptz` | **Currently set to `now()` — no future scheduling** |
| `duration_min` | `integer` | 1–480 |
| `status` | `live_class_status` | `draft` → `scheduled` → `live` → `completed` → `cancelled` |
| `is_recorded` | `boolean` | Default `false` |
| `recording_url` | `text nullable` | Denormalized convenience |
| `max_participants` | `integer nullable` |
| `cancelled_at` | `timestamptz nullable` |
| `cancelled_reason` | `text nullable` |
| `room_name` | **Not in migration** | **Added dynamically by teacherService (implicit column)** |
| `created_at` / `updated_at` | `timestamptz` |

#### `live_sessions`
| Column | Type | Notes |
|--------|------|-------|
| `session_id` | `uuid PK` |
| `class_id` | `uuid FK` → live_classes | **UNIQUE (1:1)** |
| `institute_id` | `uuid FK` |
| `provider` | `varchar(50)` | Currently `'livekit'` |
| `provider_session_id` | `varchar(500) nullable` |
| `room_url` | `text nullable` | Set to `window.location.href` |
| `host_token` | `text nullable` | Not populated |
| `participant_token` | `text nullable` | Not populated |
| `status` | `live_session_status` | `waiting` → `live` → `ended` |
| `started_at` | `timestamptz` |
| `ended_at` | `timestamptz nullable` |
| `peak_participants` | `integer nullable` | Not populated |
| `provider_metadata` | `jsonb nullable` |
| `ended_reason` | `varchar(50) nullable` | Set to `'host_ended'` |

#### `live_class_batch` (Junction)
| Column | Type | Notes |
|--------|------|-------|
| `class_id` | `uuid PK` | → live_classes ON DELETE CASCADE |
| `batch_id` | `uuid PK` | → batches ON DELETE RESTRICT |
| `assigned_at` | `timestamptz` |
| `assigned_by` | `uuid nullable` | → profiles |

#### `session_participants`
| Column | Type | Notes |
|--------|------|-------|
| `participant_id` | `uuid PK` |
| `session_id` | `uuid FK` |
| `class_id` | `uuid FK` |
| `student_id` | `uuid FK` | → student_details |
| `institute_id` | `uuid FK` |
| `joined_at` | `timestamptz` |
| `left_at` | `timestamptz nullable` |
| `camera_enabled` | `boolean` |
| `mic_enabled` | `boolean` |
| `screen_shared` | `boolean` |
| `network_quality` | `varchar(20) nullable` |
| `device_type` | `varchar(50) nullable` |

### 2.2 Enums

```sql
live_class_status: 'draft', 'scheduled', 'live', 'completed', 'cancelled'
live_session_status: 'waiting', 'live', 'ended'
recording_status: 'queued', 'processing', 'completed', 'failed'
```

### 2.3 RLS Policies

- **Teachers**: Full CRUD on their own `live_classes` (WHERE teacher_id = auth.uid())
- **Students**: SELECT on `live_classes` WHERE batch is linked via `live_class_batch`
- **Admins**: Full CRUD on all `live_classes`
- **`live_class_batch`**: Teachers can read for their classes

### 2.4 Indexes

Comprehensive coverage for queries by:
- `institute_id + status` (dashboard widgets)
- `teacher_id + status` (teacher's class list)
- `status + scheduled_at` (upcoming classes)
- `session_id + student_id` (participant lookup)

---

## 3. Current LiveKit Flow

### 3.1 Token Generation

**Edge Function:** `livekit-token` (Supabase Edge Function)

**Client call** (both apps have nearly identical implementations):
```
supabase.functions.invoke('livekit-token', {
  body: {
    roomName: string,
    participantName: string,
    role: 'teacher' | 'student' | 'admin'
  }
})
→ { token: string, url: string }
```

**Token Service files:**
- Teacher: `src/lib/livekit/tokenService.ts`
- Student: `src/features/livekit/services/tokenService.ts`

Both are functionally identical — call the same Edge Function with the same request/response contract.

### 3.2 Room Name Convention

**Current:** `class-{classId}` where classId is the first 8 hex chars of the UUID with dashes removed.

```typescript
function buildRoomName(classId: string): string {
  const short = classId.replace(/-/g, '').slice(0, 8);
  return `class-${short}`;
}
```

**Note:** The SDD specifies a longer pattern (`{institute_slug}-{teacher_id_short}-{class_id_short}`) but the simpler pattern was chosen for Phase 1.

### 3.3 Room Lifecycle

1. Room name is **deterministic** from classId — no explicit LiveKit API call to create a room
2. LiveKit Cloud auto-creates rooms when the first participant connects
3. Rooms are not explicitly deleted — LiveKit Cloud automatically cleans up empty rooms (configurable TTL)

---

## 4. Current Teacher Workflow

### 4.1 Flow Diagram

```
┌──────────┐    ┌──────────────┐    ┌────────────┐    ┌───────────┐    ┌──────────┐
│ Dashboard │───▶│ LiveStudio   │───▶│ StartLive  │───▶│LiveKitRoom│───▶│ End      │
│ (Go Live) │    │ (Camera      │    │ Dialog     │    │ (Connect) │    │ Class    │
│           │    │  Preview)    │    │            │    │           │    │          │
└──────────┘    └──────────────┘    └────────────┘    └───────────┘    └──────────┘
                                         │                   │              │
                                         ▼                   ▼              ▼
                                  ┌──────────────┐    ┌───────────┐    ┌──────────┐
                                  │ DB: INSERT   │    │ LiveKit   │    │ DB:      │
                                  │ live_classes │    │ connects  │    │ status=  │
                                  │ status=      │    │ (auto)    │    │ completed│
                                  │ 'scheduled'  │    │           │    │ +session │
                                  │              │    │           │    │ ended    │
                                  └──────────────┘    └───────────┘    └──────────┘
```

### 4.2 Detailed Steps

**Step 1: Teacher clicks "Go Live"**
- Entry points: Header button, OverviewView, ScheduleView, AdminOverviewView
- `LiveStudioView` modal opens with `getUserMedia` camera preview
- `useLiveClass(teacherId, teacherName)` hook initializes (status: `idle`)

**Step 2: Teacher clicks "GO LIVE" → `StartLiveDialog`**
- Fetches assigned batches via `teacherService.getAssignedBatches()`
- Teacher selects batch (required) and optional title
- Subject auto-selected (first authorized subject — no subject picker in UI)

**Step 3: `useLiveClass.startClass(selections)` → status: `loading`**

**Step 4: `teacherService.getOrCreateActiveLiveClass()`**
- Validates batch assignment
- Checks for existing `scheduled`/`live` class for this teacher (reuses if found)
- If not found, **INSERT** into `live_classes` with:
  - `status: 'scheduled'`
  - `scheduled_at: new Date().toISOString()` (immediate)
  - `duration_min: 90` (hardcoded)
- **INSERT** into `live_class_batch` (linking class to batch)

**Step 5: Room name generation**
- `buildRoomName(classId)` → `class-{8chars}`

**Step 6: Token fetching**
- `getLiveKitToken({ roomName, participantName: teacherName, role: 'teacher' })` → `{ token, url }`

**Step 7: `teacherService.startLiveClass()`**
- UPDATE `live_classes.status = 'live'`, sets `room_name`
- INSERT `live_sessions` (provider: 'livekit', status: 'live')
- INSERT `session_participants` (teacher as participant)

**Step 8: UI renders `<LiveKitRoom>`** which auto-connects using token+url

**Step 9: Teacher broadcasts**
- `ControlBar` (rendered inside LiveKitRoom) provides camera/mic toggle + "END SESSION"

**Step 10: `useLiveClass.endClass()`**
- `teacherService.endLiveClass()` updates `live_classes.status = 'completed'`
- Updates `live_sessions.status = 'ended'`, sets `ended_at`, `ended_reason: 'host_ended'`
- Status transitions from `live → ending → ended`

### 4.3 Key Observations

- **No scheduling UI exists.** Classes are created and started in the same flow.
- `scheduled_at` is always set to `now()` — no future-date scheduling.
- `duration_min` is hardcoded to 90 minutes — no teacher input.
- Subject is auto-selected (first authorized) — no subject picker in StartLiveDialog.
- The `room_name` column is referenced in the code but **not defined in the migration** — it was likely added as a separate migration or is implicitly added.
- `session_participants.student_id` in the migration references `student_details`, but the code inserts with `profile_id` — there's an inconsistency. The code uses `profile_id` because the teacher's ID is a profile_id, not a student_id.

---

## 5. Current Student Workflow

### 5.1 Existing Implementation

The student app has:

| File | Status | Description |
|------|--------|-------------|
| `package.json` | ✅ Installed | `@livekit/react-native`, `livekit-client`, `@livekit/react-native-webrtc` |
| `features/livekit/services/tokenService.ts` | ✅ Complete | `getLiveKitToken()` — calls Edge Function |
| `features/livekit/hooks/useLiveKit.ts` | ✅ Complete | Room management: connect, disconnect, toggleCamera, toggleMicrophone, audio diagnostics |
| `features/livekit/screens/JoinRoomScreen.tsx` | ✅ Complete | POC form: room name, participant name, role selector |
| `features/livekit/screens/LiveRoomScreen.tsx` | ✅ Complete | POC room: video grid, controls, participant tracking |
| `features/livekit/components/ControlBar.tsx` | ✅ Complete | Camera, mic, leave buttons |
| `features/livekit/components/VideoView.tsx` | ✅ Complete | Participant video tile with fallback avatar |
| `features/livekit/types/index.ts` | ✅ Complete | All types defined |
| `features/livekit/diagnostics/` | ✅ Complete | Audio diagnostics utilities |
| `hooks/useLiveClasses.ts` | ⚠️ Mock only | Returns 3 hardcoded LiveClass objects with mock data |
| `screens/tabs/LiveClassesTabScreen.tsx` | ⚠️ Placeholder | "Coming soon" message + "Join LiveKit Room" POC button |
| `navigation/MainTabNavigator.tsx` | ✅ Configured | LiveClasses tab registered with video icon |
| `navigation/AppNavigator.tsx` | ✅ Configured | JoinRoom and LiveRoom routes registered |

### 5.2 Current Student Flow

```
┌──────────┐    ┌─────────────────┐    ┌───────────────┐
│ Live Tab │───▶│ JoinRoomScreen  │───▶│ LiveRoomScreen│
│          │    │ (manual room    │    │ (Full video   │
│          │    │  name input)    │    │  + controls)  │
└──────────┘    └─────────────────┘    └───────────────┘
```

The current flow is a **manual POC** — students must:
1. Know the room name (e.g., "class-a1b2c3d4")
2. Enter it manually on the JoinRoomScreen
3. Enter their display name and select role

**There is NO integration with:**
- The `live_classes` database table
- The student's enrolled batches
- Scheduled class times or "Live Now" status
- Any auto-join or "Join Class" button for specific classes

---

## 6. Missing Features

### 6.1 Critical Gaps

| # | Feature | Teacher Side | Student Side | Priority |
|---|---------|-------------|--------------|----------|
| 1 | **Scheduled classes** (future date/time) | ❌ Missing UI | ❌ Missing | High |
| 2 | **Student live classes list** (from DB) | N/A | ❌ Missing | High |
| 3 | **Student join flow** (auto-token + room) | N/A | ❌ Missing | High |
| 4 | **"Live Now" indicator** | ✅ Exists | ❌ Missing | High |
| 5 | **Realtime status updates** | ❌ Missing (no subscription) | ❌ Missing | High |
| 6 | **Push notifications** for live class start | N/A | ❌ Missing | High |
| 7 | **Student session_participants logging** | ⚠️ Teacher only | ❌ Missing | High |
| 8 | **End class handling** (student disconnect) | ✅ Done | ❌ Missing | Medium |
| 9 | **Recording playback** | ❌ Missing | ❌ Missing | Medium |

### 6.2 Detailed Gap Analysis

#### Gap 1: Scheduled Classes UI
- **Current state:** Teachers can only start instant classes. No calendar/scheduling UI.
- **Required:** A form/calendar to set `scheduled_at` to a future date, with duration.
- **Database impact:** None — the column already exists. Just needs UI.

#### Gap 2: Student Live Classes List
- **Current state:** `useLiveClasses.ts` returns mock data. Tab shows placeholder.
- **Required:** Query `live_classes` joined with `live_class_batch` → `batch_students` where student is enrolled. Filter by status (`scheduled` or `live`).
- **Database:** Need a service that queries with RLS permissions.

#### Gap 3: Student Join Flow
- **Current state:** Manual room name entry on JoinRoomScreen.
- **Required:** "Join Class" button on each class card → auto-fetches token with role='student' → connects to LiveKit room.

#### Gap 4: Live Now Indicator
- **Current state:** Teacher sees `status === 'live'`. Student has no awareness.
- **Required:** Student sees which classes are currently live with a red indicator badge.

#### Gap 5: Realtime Updates
- **Current state:** No Supabase Realtime subscriptions.
- **Required:** Subscribe to `live_classes` changes (status transitions) so students see when a class goes live in realtime.

#### Gap 6: Push Notifications
- **Current state:** Notification system exists for other types (`live_class_reminder` is in the enum) but no trigger for live class start.
- **Required:** When teacher starts a class (status → 'live'), trigger a push notification to enrolled students.

#### Gap 7: Student Participant Logging
- **Current state:** Only the teacher is logged in `session_participants` when the session starts.
- **Required:** When student joins a LiveKit room, log their join in `session_participants`. When they leave, update `left_at`.

#### Gap 8: End Class Handling
- **Current state:** Student side has no awareness that a class has ended.
- **Required:** Show "Class Ended" screen, track duration, compute attendance.

#### Gap 9: Recording Playback
- **Current state:** No recordings are being captured or stored.
- **Required:** LiveKit Cloud recording integration → populate `recordings` table → playback UI.

---

## 7. Recommended Architecture

### 7.1 Teacher Flow (Enhanced)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        TEACHER APP                                  │
│                                                                     │
│  ┌──────────────┐    ┌───────────────┐    ┌───────────────────────┐ │
│  │ Schedule      │───▶│ LiveStudio    │───▶│ LiveKit Broadcast    │ │
│  │ Classes       │    │ (launch/manage)│   │ (video + audio)      │ │
│  │ (future date) │    └───────────────┘   └───────────┬───────────┘ │
│  └──────────────┘                                     │             │
│                                                       │             │
│  ┌──────────────┐    ┌───────────────┐               │             │
│  │ Upcoming     │───▶│ Start Live    │               │             │
│  │ Classes List │    │ (Go Live now) │               │             │
│  └──────────────┘    └───────────────┘               │             │
│                                                       │             │
│  ┌──────────────┐    ┌───────────────┐               │             │
│  │ Past Classes │───▶│ Recording     │               │             │
│  │ & Recordings │    │ Playback      │               │             │
│  └──────────────┘    └───────────────┘               │             │
└──────────────────────────────────────────────────────┼──────────────┘
                                                       │
                                                       ▼
                                              ┌─────────────────┐
                                              │   LiveKit Cloud  │
                                              └─────────────────┘
                                                       │
                                                       ▼
┌──────────────────────────────────────────────────────┼──────────────┐
│                      STUDENT APP                     │             │
│                                                       │             │
│  ┌──────────────┐    ┌───────────────┐    ┌──────────┴───────────┐ │
│  │ Live Tab     │───▶│ Class Card    │───▶│ Live Room           │ │
│  │ (upcoming +   │    │ (Join button) │   │ (video + controls)  │ │
│  │  live now)    │    └───────────────┘   └──────────────────────┘ │
│  └──────────────┘                                                 │
│                                                                    │
│  ┌──────────────┐    ┌───────────────┐                            │
│  │ Notification │───▶│ Deep Link →   │                            │
│  │ (class live)  │   │ Live Room     │                            │
│  └──────────────┘    └───────────────┘                            │
└────────────────────────────────────────────────────────────────────┘
```

### 7.2 Recommended Data Flow

```
Teacher creates class:
  INSERT live_classes (scheduled_at = future, status = 'scheduled')
  INSERT live_class_batch (class_id, batch_id)

Teacher goes live:
  UPDATE live_classes SET status = 'live', room_name = ...
  INSERT live_sessions (provider = 'livekit', status = 'live')
  → Supabase Realtime broadcasts the status change
  → Edge Function triggers push notification to enrolled students

Student receives notification:
  → Opens app → Live tab shows "LIVE NOW" badge
  → Taps "Join" → fetches token → connects to LiveKit room
  → Logs session_participants entry

Teacher ends class:
  UPDATE live_classes SET status = 'completed'
  UPDATE live_sessions SET status = 'ended'
  → Realtime notifies students → room disconnects

Attendance computed:
  → From session_participants data at class end
```

---

## 8. Recommended Database Changes

### 8.1 No Structural Changes Required

The existing `live_classes`, `live_sessions`, `live_class_batch`, and `session_participants` tables are well-designed for all planned features. **No schema migrations are needed.**

### 8.2 Minor Additions

1. **Confirm `room_name` column exists** on `live_classes` (referenced in code but not in the original migration — may have been added in a later migration).

2. **Student enrollment query path:** The RLS already allows students to SELECT `live_classes` via `live_class_batch`. The student app needs a query like:
   ```sql
   SELECT lc.* FROM live_classes lc
   JOIN live_class_batch lcb ON lc.class_id = lcb.class_id
   JOIN batch_students bs ON lcb.batch_id = bs.batch_id
   WHERE bs.student_id = :student_id
   AND lc.status IN ('scheduled', 'live')
   ORDER BY lc.scheduled_at ASC
   ```

3. **Consider adding `enrolled_students_count`** as a denormalized counter on `live_classes` for display convenience (avoiding COUNT queries on every class card render).

---

## 9. Recommended API Changes

### 9.1 New Service Functions Required

#### Student App (`MockTestApp`)

| Service | Description |
|---------|-------------|
| `getStudentLiveClasses(studentId)` | Fetch scheduled + live classes for student's enrolled batches |
| `getLiveClassDetails(classId)` | Fetch single class with batch info, teacher name, status |
| `joinLiveSession(classId, studentId)` | Log student as participant in `session_participants` |
| `leaveLiveSession(classId, studentId)` | Update `left_at` in `session_participants` |
| `subscribeToClassStatus(classId, callback)` | Supabase Realtime subscription for status changes |

#### Teacher App (Enhancements)

| Service | Description |
|---------|-------------|
| `scheduleLiveClass()` | Create `live_classes` row with future `scheduled_at` |
| `getScheduledClasses(teacherId)` | List upcoming scheduled classes for teacher |
| `getPastClasses(teacherId)` | List completed classes for teacher |

### 9.2 Edge Function Changes

The `livekit-token` Edge Function already works for both roles. No changes needed unless role-based permissions need to be tightened (e.g., students can only subscribe, not publish).

---

## 10. Step-by-Step Implementation Plan

### Phase 1: Student Live Class List & Join (Core)

**Goal:** Students can see their enrolled classes and join live ones.

| Step | Task | Files | Dependencies |
|------|------|-------|-------------|
| 1 | Create `studentLiveClassService.ts` with `getStudentLiveClasses()` querying `live_classes` + `live_class_batch` + `batch_students` | `src/services/studentLiveClassService.ts` | — |
| 2 | Create `useStudentLiveClasses()` hook using the service | `src/hooks/useStudentLiveClasses.ts` | Step 1 |
| 3 | Update `LiveClassesTabScreen.tsx` to fetch real data, show class cards | `screens/tabs/LiveClassesTabScreen.tsx` | Step 2 |
| 4 | Implement "Join Class" button → fetch token + navigate to LiveRoom | `LiveClassesTabScreen.tsx`, `JoinRoomScreen.tsx` | Step 3 |
| 5 | Log student as participant on join | `studentLiveClassService.ts` | Step 1 |
| 6 | Log student departure on leave | `LiveRoomScreen.tsx` | Step 4 |

### Phase 2: Realtime Updates & Notifications

| Step | Task | Files | Dependencies |
|------|------|-------|-------------|
| 7 | Add Supabase Realtime subscription for `live_classes` status changes | `useStudentLiveClasses.ts` | Phase 1 |
| 8 | Add "LIVE NOW" badge to class cards | `LiveClassesTabScreen.tsx` | Step 7 |
| 9 | Create Edge Function or DB trigger to send push notifications when class goes live | Supabase, `dispatch-notification` | — |
| 10 | Handle notification tap → deep link to Live Room | `notifications/` | Step 9 |

### Phase 3: Teacher Scheduling UI

| Step | Task | Files | Dependencies |
|------|------|-------|-------------|
| 11 | Update `StartLiveDialog` or create separate "Schedule Class" dialog with date/time picker | `StartLiveDialog.tsx` | — |
| 12 | Pass `scheduled_at` to `teacherService.getOrCreateActiveLiveClass()` | `teacherService.ts`, `useLiveClass.ts` | Step 11 |
| 13 | Remove hardcoded `duration_min: 90`, let teacher input | `StartLiveDialog.tsx`, `teacherService.ts` | Step 11 |
| 14 | Create "Upcoming Classes" list view for teacher | New view component | Step 12 |

### Phase 4: Recording & Playback

| Step | Task | Files | Dependencies |
|------|------|-------|-------------|
| 15 | Enable LiveKit recording in teacher studio | `LiveStudioView.tsx`, `teacherService.ts` | — |
| 16 | Store recording metadata in `recordings` table | Webhook or Edge Function | Step 15 |
| 17 | Create student recording playback UI | New screen | Step 16 |

### Phase 5: Attendance & Analytics

| Step | Task | Files | Dependencies |
|------|------|-------|-------------|
| 18 | Compute attendance from `session_participants` | Edge Function or DB function | Phase 1 |
| 19 | Show attendance in teacher dashboard | `ScheduleView.tsx` | Step 18 |
| 20 | Show student attendance history | Student profile | Step 18 |

---

## Appendix A: File Inventory

### Teacher/Admin Website (`mocktest-admin`)

| File | Purpose |
|------|---------|
| `src/services/teacherService.ts` | Core service: getOrCreateActiveLiveClass, startLiveClass, endLiveClass |
| `src/hooks/useLiveClass.ts` | Live class lifecycle hook (idle → loading → live → ending → ended) |
| `src/lib/livekit/tokenService.ts` | LiveKit token fetching from Edge Function |
| `src/components/live-studio/LiveStudioView.tsx` | Full-screen live studio modal with preview + LiveKit room |
| `src/components/live-studio/StartLiveDialog.tsx` | Pre-start dialog (batch select, title input) |
| `src/components/live-studio/ControlBar.tsx` | Camera/mic controls + end class button |
| `src/components/dashboard/FacultyDashboard.tsx` | Main dashboard with Live Studio trigger |
| `src/components/Header.tsx` | Header with "Go Live" button |
| `src/views/ScheduleView.tsx` | Schedule view with upcoming class card + Go Live |
| `src/views/OverviewView.tsx` | Overview with upcoming class card |
| `src/services/admin/dashboardService.ts` | Admin dashboard: lists upcoming live classes |
| `src/data/mockData.ts` | Mock data for LiveClassSession type |

### Student App (`MockTestApp`)

| File | Purpose |
|------|---------|
| `src/features/livekit/services/tokenService.ts` | LiveKit token fetching (same contract as teacher) |
| `src/features/livekit/hooks/useLiveKit.ts` | Full LiveKit room management hook |
| `src/features/livekit/screens/JoinRoomScreen.tsx` | POC join form (manual room name entry) |
| `src/features/livekit/screens/LiveRoomScreen.tsx` | POC live room with video grid |
| `src/features/livekit/components/ControlBar.tsx` | Camera/mic/leave buttons |
| `src/features/livekit/components/VideoView.tsx` | Participant video tile |
| `src/features/livekit/types/index.ts` | Types: TokenRequest, TokenResponse, ConnectionState, ParticipantInfo, etc. |
| `src/hooks/useLiveClasses.ts` | MOCK data hook (3 hardcoded classes) |
| `src/screens/tabs/LiveClassesTabScreen.tsx` | Placeholder tab screen |
| `src/navigation/MainTabNavigator.tsx` | Tab navigator with LiveClasses tab |
| `src/navigation/AppNavigator.tsx` | Stack navigator with JoinRoom + LiveRoom routes |

---

## Appendix B: API Contracts

### Teacher → Edge Function: `livekit-token`

```
POST /functions/v1/livekit-token
Request: {
  roomName: string,       // e.g. "class-a1b2c3d4"
  participantName: string, // e.g. "Dr. Arvind Sharma"
  role: "teacher" | "student" | "admin"
}
Response: {
  token: string,  // LiveKit JWT
  url: string     // wss://*.livekit.cloud
}
```

### Teacher DB Operations

```
getOrCreateActiveLiveClass(teacherId, subjectId, batchId, chapterId, title)
  → { classId, title, institute_id }

startLiveClass(classId, profileId, roomName, instituteId)
  → void

endLiveClass(classId)
  → void
```

### Student DB Operations (TO BE IMPLEMENTED)

```
getStudentLiveClasses(studentId)
  → LiveClass[]  // with batch info, teacher name, status

joinLiveSession(sessionId, classId, studentId)
  → void  // INSERT into session_participants

leaveLiveSession(participantId)
  → void  // UPDATE left_at
```

---

## Appendix C: Key Observations & Risks

1. **Database inconsistency:** `session_participants.student_id` references `student_details` (FK), but the code inserts `profile_id` (teacher's profile ID). Either the FK needs to allow profiles or separate the teacher's participant logging from students'.

2. **`room_name` column:** Referenced in `teacherService.ts` but not in the `005_domain_04_live_learning.sql` migration. Check if it was added in a later migration.

3. **No room cleanup:** LiveKit Cloud rooms are not explicitly deleted after class ends. This may lead to stale rooms accumulating.

4. **Token expiry:** LiveKit tokens have an expiry. Student tokens fetched before the class starts may expire. Need to handle token refresh or fetch token at connection time.

5. **Realtime subscription cost:** Supabase Realtime has connection limits. Decide whether to use Realtime subscriptions or periodic polling.

6. **Recording:** The `recordings` table exists but is not populated. LiveKit Cloud supports egress recording but needs configuration.

7. **Attendance is not computed:** The `attendance` and `attendance_events` tables exist but are never populated from `session_participants` data.
