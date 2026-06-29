# EdTech Platform — Database Schema Specification
## Domain 4: Live Learning
### Tables: LiveClass · LiveSession · SessionParticipants · Recording · Attendance · AttendanceEvents · LiveClassBatch

**Document version:** 2.0
**ERD reference:** ERD v2.0 (Frozen)
**PostgreSQL target:** 16
**Supabase compatibility:** Yes

---

## Domain Context

Domain 4 covers the real-time teaching infrastructure. A teacher schedules a `live_class`, which is broadcast to one or more batches via the `live_class_batch` junction. At the moment the teacher starts the class, a `live_session` row is created to represent the active WebRTC or third-party video session. The class may be recorded, producing one or more `recording` rows. Student attendance — join time, leave time, and computed duration — is captured per student per class in `attendance`.

This domain sits at the operational heart of the product. Live class state transitions are time-sensitive and high-volume. `attendance` in particular will grow to tens of millions of rows and requires partitioning planning from day one.

The ERD v2 renames `MeetingRoom` to `LiveSession` to correctly anticipate a WebRTC-native architecture (room identity, ICE signalling, participant management) rather than a simple meeting URL stored in one field.

---

## Table 1: `live_classes`

### Purpose

The schedulable unit of live teaching. A `live_class` row represents one scheduled teaching event: a teacher, a time slot, an academic topic (subject + chapter), a duration, and a broadcast configuration. It is the anchor record that all other tables in this domain reference.

`live_classes` manages its own lifecycle via `status`. The status drives the UI state for both teachers (join controls, start/end buttons) and students (upcoming banner, live indicator, watch recording link).

A single `live_class` can be broadcast to multiple batches simultaneously via `live_class_batch`. This is the standard operating mode in large coaching institutes — one master class for Physics is broadcast to Batch A, Batch B, and Batch C at the same time.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `class_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS performance and multi-tenant index isolation |
| `teacher_id` | `UUID` | NOT NULL | — | FK → `teacher_details.teacher_id`. The teacher conducting this class. Exactly one teacher per class |
| `subject_id` | `UUID` | NOT NULL | — | FK → `subjects.subject_id`. The subject this class covers. Required for teacher analytics dashboard grouping |
| `chapter_id` | `UUID` | NULL | `NULL` | FK → `chapters.chapter_id`. Optional — a class may cover multiple chapters or be introductory with no chapter mapping yet. Nullable to support stream-level orientation classes |
| `title` | `VARCHAR(500)` | NOT NULL | — | Display title shown to students. Example: `Thermodynamics — Laws 1 & 2 Deep Dive` |
| `description` | `TEXT` | NULL | `NULL` | Optional class description, agenda, or pre-read instructions shown to students before the class |
| `scheduled_at` | `TIMESTAMPTZ` | NOT NULL | — | UTC timestamp of the scheduled start time. Must be in the future at insert time (enforced at application layer) |
| `duration_min` | `INTEGER` | NOT NULL | — | Planned class duration in minutes. Used for calendar display and to compute the expected end time (`scheduled_at + duration_min * interval '1 minute'`). Actual duration is derived from `live_session.ended_at - started_at` |
| `status` | `live_class_status` | NOT NULL | `'draft'` | PostgreSQL enum: `draft`, `scheduled`, `live`, `completed`, `cancelled`. See state machine in Backend Developer Notes |
| `is_recorded` | `BOOLEAN` | NOT NULL | `FALSE` | When TRUE, the session is configured to record. Does not guarantee a recording exists — recording may fail. Check `recordings` table for actual recording rows |
| `recording_url` | `TEXT` | NULL | `NULL` | Convenience denormalization: the primary playback URL of the completed recording. Populated by the recording completion webhook. NULL until recording is processed. For multi-part recordings, this holds the first/primary segment URL; use `recordings` table for all segments |
| `max_participants` | `INTEGER` | NULL | `NULL` | Soft cap on concurrent attendees enforced at the session/WebRTC layer, not at the DB layer. NULL means no configured cap. Used for capacity planning and provider seat limits |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC last-modified timestamp. Trigger-maintained |
| `cancelled_at` | `TIMESTAMPTZ` | NULL | `NULL` | UTC timestamp when the class was cancelled. NULL unless `status = 'cancelled'`. Retained for audit and student notification history |
| `cancelled_reason` | `TEXT` | NULL | `NULL` | Optional admin/teacher-supplied reason for cancellation. Shown to students in the cancellation notification |

---

### Primary Key

```
PRIMARY KEY (class_id)
```

---

### Foreign Keys

```
institute_id → institutes.institute_id         ON DELETE RESTRICT   ON UPDATE RESTRICT
teacher_id   → teacher_details.teacher_id      ON DELETE RESTRICT   ON UPDATE RESTRICT
subject_id   → subjects.subject_id             ON DELETE RESTRICT   ON UPDATE RESTRICT
chapter_id   → chapters.chapter_id             ON DELETE RESTRICT   ON UPDATE RESTRICT
```

---

### Unique Constraints

None. A teacher may schedule multiple classes for the same chapter on the same day. Scheduling conflict detection (overlapping time slots for the same teacher) is enforced at the application layer, not via a unique constraint.

---

### CHECK Constraints

```
CHECK (char_length(title) >= 3)
CHECK (duration_min > 0 AND duration_min <= 480)
CHECK (max_participants IS NULL OR max_participants > 0)
CHECK (
  (status = 'cancelled' AND cancelled_at IS NOT NULL)
  OR (status != 'cancelled' AND cancelled_at IS NULL)
)
CHECK (cancelled_at IS NULL OR cancelled_at >= created_at)
```

> `duration_min <= 480` caps classes at 8 hours. This is a sanity guard against data entry errors — no coaching class legitimately runs longer than 8 hours. Adjust if the product supports extended marathon sessions.

> The cancellation consistency CHECK ensures `cancelled_at` is always set when and only when the status is `'cancelled'`. This prevents half-written cancellation states.

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_live_classes_institute_status` | `(institute_id, status)` | B-tree | Student homepage: all scheduled/live classes for this institute |
| `idx_live_classes_institute_scheduled_at` | `(institute_id, scheduled_at)` | B-tree | Calendar view: classes ordered by time within an institute |
| `idx_live_classes_teacher_status` | `(teacher_id, status)` | B-tree | Teacher dashboard: my upcoming and past classes |
| `idx_live_classes_teacher_scheduled_at` | `(teacher_id, scheduled_at DESC)` | B-tree | Teacher history ordered by recency |
| `idx_live_classes_subject` | `(subject_id)` | B-tree | Teacher analytics: classes grouped by subject |
| `idx_live_classes_chapter` | `(chapter_id)` | B-tree | Chapter-level class listing (nullable; partial index `WHERE chapter_id IS NOT NULL`) |
| `idx_live_classes_status_scheduled_at` | `(status, scheduled_at)` | B-tree | Scheduler background job: find all `scheduled` classes whose `scheduled_at` has passed to auto-transition |

---

### Soft Delete Strategy

`live_classes` does not use `deleted_at`. Use `status = 'cancelled'` to remove a class from student-facing views. The row is permanently retained for audit, attendance history, and analytics.

Hard deletion is forbidden because:
- `live_session.class_id` references this row
- `recordings.class_id` references this row
- `attendance.class_id` references this row
- `live_class_batch.class_id` references this row

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `updated_at` | ✅ | Required; trigger-maintained |
| `cancelled_at` | ✅ | Business-critical event timestamp |
| `created_by` | ❌ | Equivalent to `teacher_id`; redundant |
| `updated_by` | ❌ | Track admin edits via `audit_logs` |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE live_class | `RESTRICT` | Session, recordings, attendance, and batch mappings all reference this row |
| UPDATE class_id | `RESTRICT` | PK must not change |
| Teacher deleted (soft) | No cascade | Teacher is soft-deleted via `profiles.is_active`; class rows are retained for attendance history |
| Subject deleted | `RESTRICT` | Cannot delete a subject with scheduled or completed classes |
| Institute deleted | `RESTRICT` | Root entity; cannot delete with class rows present |

---

### Supabase RLS Considerations

```
Table: live_classes
RLS: ENABLED

Policies:

SELECT:
  - Students may read live_classes where status IN ('scheduled', 'live', 'completed')
    within their institute AND the class is linked to at least one of their enrolled batches.
    USING: institute_id = get_my_institute_id()
      AND status IN ('scheduled', 'live', 'completed')
      AND EXISTS (
        SELECT 1 FROM live_class_batch lcb
        JOIN batch_student bs ON bs.batch_id = lcb.batch_id
        JOIN student_details sd ON sd.student_id = bs.student_id
        WHERE lcb.class_id = live_classes.class_id
          AND sd.profile_id = auth.uid()
      )

  NOTE: For performance at scale, materialise student-batch membership in a cached
  layer (Redis or a denormalized table) rather than evaluating this subquery on every
  row read. Benchmark this policy with EXPLAIN ANALYZE before shipping to production.

  - Teachers may read all live_classes they own regardless of status.
    USING: teacher_id = (
      SELECT teacher_id FROM teacher_details WHERE profile_id = auth.uid()
    )

  - Admins may read all live_classes within their institute regardless of status.
    USING: institute_id = get_my_institute_id()
      AND (SELECT role FROM profiles WHERE profile_id = auth.uid()) = 'admin'

INSERT:
  - Teachers may create live_classes within their own institute.
    WITH CHECK: institute_id = get_my_institute_id()
      AND teacher_id = (
        SELECT teacher_id FROM teacher_details WHERE profile_id = auth.uid()
      )
  - status must default to 'draft' or 'scheduled' on insert.

UPDATE:
  - Teachers may update their own classes when status IN ('draft', 'scheduled').
    Live, completed, and cancelled classes are immutable via teacher action.
    USING: teacher_id = (
      SELECT teacher_id FROM teacher_details WHERE profile_id = auth.uid()
    )
    WITH CHECK: status IN ('draft', 'scheduled')

  - Admins may update any field on any class within their institute, including
    cancellation (status → 'cancelled').

DELETE:
  - Blocked at RLS level. Use status = 'cancelled' instead.
```

---

### Backend Developer Notes

1. **Status state machine:** Valid transitions:
   - `draft` → `scheduled` (teacher publishes the class to students)
   - `scheduled` → `live` (teacher clicks "Start Class"; live_session row is created atomically)
   - `scheduled` → `cancelled` (teacher or admin cancels before it starts)
   - `live` → `completed` (teacher ends the class; live_session.ended_at is set atomically)
   - `live` → `cancelled` (emergency cancellation mid-class; rare but must be supported)
   - `draft` → `cancelled` (teacher discards draft)
   
   All other transitions are invalid. Enforce via a BEFORE UPDATE trigger that checks `OLD.status → NEW.status`. Any invalid transition must raise an exception rather than silently succeeding.

2. **Scheduled → Live transition:** When a teacher starts a class, the following must happen atomically in a single transaction:
   - `live_classes.status` → `'live'`
   - `live_session` row is inserted with `status = 'waiting'` and `started_at = NOW()`
   - Notification dispatched to all enrolled students (via Domain 13)
   
   Never allow a `live_session` to exist without the parent `live_class` being in `'live'` status.

3. **Auto-transition via scheduler:** A background job (pg_cron or Edge Function, run every 5 minutes) should scan for `live_classes` where `status = 'scheduled'` AND `scheduled_at < NOW() - interval '30 minutes'` (grace period). These are classes where the teacher never clicked Start. Transition them to `'cancelled'` automatically and notify enrolled students. Adjust the grace period per product requirements.

4. **recording_url denormalization:** `recording_url` on `live_classes` is a convenience field for the single most common query: "give me the playback URL for this completed class." It avoids a join to `recordings` for the primary use case. It must be populated by the recording completion webhook, not by the teacher or admin directly. For multi-part recordings (classes with segments), the `recordings` table is the source of truth.

5. **Overlap detection:** Before inserting a `live_class`, the API must check whether the teacher already has a `scheduled` or `live` class overlapping the requested time window (`scheduled_at` to `scheduled_at + duration_min`). This cannot be expressed as a simple unique constraint. Implement as an application-layer query with a serializable transaction or advisory lock per teacher.

6. **institute_id denormalization:** Always derive from `teacher_id → teacher_details → profiles.institute_id` at insert time. Never accept `institute_id` as client-supplied input — validate that the resolved institute matches the authenticated user's institute.

---

## Table 2: `live_sessions`

### Purpose

Represents the active technical session underlying a `live_class`. Where `live_classes` is the schedulable teaching event (title, time, topic), `live_session` is the WebRTC or third-party provider session (room URL, token, connection state, actual start/end timestamps).

The 1:1 relationship with `live_classes` is strictly enforced — a session row only exists while the class is `'live'` or `'completed'`. It is created when the teacher starts the class and closed when the teacher ends it.

This table is designed to be WebRTC-provider-agnostic. The `provider` column identifies which service (Daily.co, LiveKit, Agora, Twilio, etc.) is handling the session, and `provider_session_id` is the external identifier returned by that provider. All provider-specific metadata that does not fit these columns should be stored in `provider_metadata` as JSONB.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `session_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `class_id` | `UUID` | NOT NULL | — | FK → `live_classes.class_id`. 1:1 relationship enforced via UNIQUE constraint |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS. Copied from parent `live_class` at insert time |
| `provider` | `VARCHAR(50)` | NOT NULL | — | Video provider identifier. Examples: `daily`, `livekit`, `agora`, `twilio`, `zoom`. Not an enum — providers change without DB migrations |
| `provider_session_id` | `VARCHAR(500)` | NULL | `NULL` | The session or room ID assigned by the external provider. Used to correlate webhooks from the provider back to this row |
| `room_url` | `TEXT` | NULL | `NULL` | Provider-generated join URL for this session. May be a short-lived signed URL — do not cache beyond the session. NULL for WebRTC-native implementations where join is token-based |
| `host_token` | `TEXT` | NULL | `NULL` | Token or credential used by the teacher to start and control the session. Must be treated as a secret — never returned to student-role API calls. Consider storing encrypted if provider tokens are long-lived |
| `participant_token` | `TEXT` | NULL | `NULL` | Token or credential for student participants. Scoped to read-only/participant access. Rotated per session |
| `status` | `live_session_status` | NOT NULL | `'waiting'` | PostgreSQL enum: `waiting`, `live`, `ended`. Tracks the provider session state independently of the parent `live_class.status` |
| `started_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC timestamp when the session row was created (teacher initiated the start). Set at insert time |
| `ended_at` | `TIMESTAMPTZ` | NULL | `NULL` | UTC timestamp when the teacher ended the session. NULL while the session is active |
| `peak_participants` | `INTEGER` | NULL | `NULL` | Maximum concurrent participant count observed during the session. Populated by the provider webhook on session end or computed from `attendance` records. Used for analytics |
| `provider_metadata` | `JSONB` | NULL | `NULL` | Arbitrary provider-specific metadata returned by the session creation API. Stored for debugging and future provider migrations. Examples: ICE server config, recording webhook URLs, provider-side room settings |
| `ended_reason` | `VARCHAR(50)` | NULL | `NULL` | Machine-readable reason the session ended. NULL while session is active. Populated at session close. Example values: `teacher_end`, `timeout`, `network_failure`, `server_shutdown`, `crash`, `admin_stop`. Not an enum — new reasons may be added without a migration. Invaluable for debugging unexpected session terminations |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC last-modified timestamp. Trigger-maintained |

---

### Primary Key

```
PRIMARY KEY (session_id)
```

---

### Foreign Keys

```
class_id     → live_classes.class_id           ON DELETE RESTRICT   ON UPDATE RESTRICT
institute_id → institutes.institute_id          ON DELETE RESTRICT   ON UPDATE RESTRICT
```

> `class_id` uses `RESTRICT` on delete. A session row must not be orphaned. Since `live_classes` are never hard-deleted in this system, this constraint is a safety net against direct deletes via service_role.

---

### Unique Constraints

```
UNIQUE (class_id)
UNIQUE (provider, provider_session_id) WHERE provider_session_id IS NOT NULL
```

> `UNIQUE (class_id)` enforces the 1:1 relationship. Only one session may exist per class.

> The partial unique index on `(provider, provider_session_id)` ensures provider session IDs are not duplicated within the same provider, enabling safe webhook correlation. The `WHERE provider_session_id IS NOT NULL` partial condition allows rows to be inserted before the provider has assigned a session ID.

---

### CHECK Constraints

```
CHECK (char_length(provider) >= 2)
CHECK (ended_at IS NULL OR ended_at > started_at)
CHECK (peak_participants IS NULL OR peak_participants >= 0)
CHECK (
  (status = 'ended' AND ended_at IS NOT NULL)
  OR (status != 'ended' AND ended_at IS NULL)
)
```

> The final CHECK enforces that `ended_at` is always set when and only when the session status is `'ended'`. This prevents the common bug of a session marked ended without a timestamp, or a timestamp set without the status being updated.

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_live_sessions_class_id` | `(class_id)` | B-tree (covered by UNIQUE) | Already covered by unique constraint |
| `idx_live_sessions_institute_status` | `(institute_id, status)` | B-tree | Admin monitoring: all currently live sessions in an institute |
| `idx_live_sessions_provider_session_id` | `(provider, provider_session_id)` WHERE `provider_session_id IS NOT NULL` | B-tree (partial, covered by UNIQUE) | Webhook correlation: look up session by provider ID |
| `idx_live_sessions_started_at` | `(started_at DESC)` | B-tree | Analytics: session timeline; recent sessions first |

---

### Soft Delete Strategy

`live_sessions` does not use soft delete. Sessions are permanent records. Once a session is `'ended'`, it remains in the table as the historical record of that class's technical session. No archival or deletion is needed.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required; equivalent to session start initiation |
| `updated_at` | ✅ | Required; trigger-maintained |
| `started_at` | ✅ | Business-significant: when the teacher actually initiated the session |
| `ended_at` | ✅ | Business-significant: actual end time (vs scheduled end) |
| `created_by` | ❌ | Always the teacher who owns the parent `live_class` — redundant |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE live_session | `RESTRICT` | `recordings` reference `class_id` (not session_id, but session existence implies class existence); treat as immutable audit record |
| DELETE parent class | `RESTRICT` | Class is never deleted; safety net |
| UPDATE session_id | `RESTRICT` | PK must not change |

---

### Supabase RLS Considerations

```
Table: live_sessions
RLS: ENABLED

Policies:

SELECT:
  - Students may read live_sessions for classes they are enrolled in (via batch membership),
    but ONLY the non-sensitive fields. host_token and participant_token must NEVER be
    returned to student-role queries.
    
    Implementation: Create a VIEW or use column-level security for token fields.
    Supabase does not natively support column-level RLS — implement via a Postgres VIEW
    that excludes host_token and participant_token, and expose only the view to students.
    
    USING: institute_id = get_my_institute_id()
      AND EXISTS (
        SELECT 1 FROM live_class_batch lcb
        JOIN batch_student bs ON bs.batch_id = lcb.batch_id
        JOIN student_details sd ON sd.student_id = bs.student_id
        WHERE lcb.class_id = live_sessions.class_id
          AND sd.profile_id = auth.uid()
      )

  - Teachers may read their own session rows in full (including tokens).
    USING: EXISTS (
      SELECT 1 FROM live_classes lc
      WHERE lc.class_id = live_sessions.class_id
        AND lc.teacher_id = (
          SELECT teacher_id FROM teacher_details WHERE profile_id = auth.uid()
        )
    )

  - Admins may read all session rows within their institute.
    USING: institute_id = get_my_institute_id()
      AND (SELECT role FROM profiles WHERE profile_id = auth.uid()) = 'admin'

INSERT:
  - Via Edge Function only. Session creation is a server-side action triggered by the
    teacher's "Start Class" button — never a direct client insert.

UPDATE:
  - Via Edge Function only. Status transitions and ended_at are set server-side.

DELETE:
  - Blocked at RLS level.
```

---

### Backend Developer Notes

1. **Token security:** `host_token` and `participant_token` must never be exposed to student-role API callers. The recommended implementation is a Postgres VIEW (`live_sessions_student_view`) that excludes both token columns, with RLS applied to the view rather than the base table for student access. Alternatively, the Edge Function serving student requests can strip these fields before returning the response.

2. **Session creation flow:** When the teacher clicks "Start Class", an Edge Function must:
   - Call the video provider API to create a room/session → receive `provider_session_id`, `room_url`, `host_token`, `participant_token`
   - Insert the `live_sessions` row with all provider fields
   - Update `live_classes.status = 'live'` in the same transaction
   - Dispatch student notifications
   
   All three steps are atomic. If the provider call fails, neither the session row nor the status update should be committed.

3. **provider_metadata for debugging:** Store the full provider API response in `provider_metadata`. When provider-side issues occur (dropped participants, recording failures), this field enables post-hoc debugging without relying on provider dashboards. Index `provider_metadata` with a GIN index only if you need to query inside it — for pure debugging storage, no GIN index is needed.

4. **peak_participants source of truth:** Prefer computing `peak_participants` from the `attendance` table (MAX of concurrent attendees within the session window) rather than relying on provider webhooks, which can be delayed or dropped. The provider value can be used as a cross-check.

5. **Session recovery:** If a teacher's browser crashes mid-class, the session may be in `'live'` status with no `ended_at`. A background health-check job should detect sessions where `status = 'live'` AND `started_at < NOW() - interval '6 hours'` (or the `live_class.duration_min` threshold) and auto-transition them to `'ended'`. Notify the admin when this occurs.

---

## Table 2b: `session_participants`

### Purpose

The real-time event log of every participant's presence within a live session. Where `attendance` stores a computed end-of-class summary (one row per student per class), `session_participants` stores the granular per-connection record: when a participant joined, their device state, their network quality, and when they left.

A student who joins, drops, and rejoins creates multiple rows — one per connection attempt. This is exactly the information needed to debug streaming issues, investigate student complaints ("I was there but not marked present"), and understand device and network patterns across the platform.

`attendance` is generated from `session_participants` at class end. `session_participants` is the source of truth during a live session.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `participant_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key. Unique per connection attempt, not per student — a student who reconnects gets a new row |
| `session_id` | `UUID` | NOT NULL | — | FK → `live_sessions.session_id`. The session this participant joined |
| `class_id` | `UUID` | NOT NULL | — | FK → `live_classes.class_id`. Denormalized for direct queries and partition pruning |
| `student_id` | `UUID` | NOT NULL | — | FK → `student_details.student_id`. The participant. May reference the teacher's profile in future if teacher presence is also tracked here |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS |
| `joined_at` | `TIMESTAMPTZ` | NOT NULL | — | UTC timestamp when this connection was established, as reported by the provider webhook |
| `left_at` | `TIMESTAMPTZ` | NULL | `NULL` | UTC timestamp when this connection ended. NULL if the participant is still connected or the leave event has not yet arrived |
| `camera_enabled` | `BOOLEAN` | NOT NULL | `FALSE` | Whether the participant had their camera on at join time. May be updated by subsequent provider events if the student toggles camera mid-session. Reflects last-known state |
| `mic_enabled` | `BOOLEAN` | NOT NULL | `FALSE` | Whether the participant had their microphone on at join time. Updated on toggle events |
| `screen_shared` | `BOOLEAN` | NOT NULL | `FALSE` | Whether the participant was sharing their screen. Primarily relevant for teachers, but tracked for all participants |
| `network_quality` | `VARCHAR(20)` | NULL | `NULL` | Last-known network quality signal from the provider. Example values: `excellent`, `good`, `poor`, `unstable`. Provider-reported; not an enum |
| `device_type` | `VARCHAR(50)` | NULL | `NULL` | Device category at join time. Example values: `desktop`, `mobile`, `tablet`. Derived from User-Agent or provider-reported. Used for device mix analytics |
| `ip_address` | `INET` | NULL | `NULL` | Participant IP address at join time. Used for geo-analytics and fraud detection. Store with care — treat as PII. NULL if the provider does not report it or if data minimisation policy requires omitting it |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Row creation timestamp |

---

### Primary Key

```
PRIMARY KEY (participant_id)
```

---

### Foreign Keys

```
session_id   → live_sessions.session_id           ON DELETE RESTRICT   ON UPDATE RESTRICT
class_id     → live_classes.class_id              ON DELETE RESTRICT   ON UPDATE RESTRICT
student_id   → student_details.student_id         ON DELETE RESTRICT   ON UPDATE RESTRICT
institute_id → institutes.institute_id            ON DELETE RESTRICT   ON UPDATE RESTRICT
```

---

### Unique Constraints

None. A student may have multiple rows per session (one per connection attempt). Uniqueness is at the connection level, not the student level.

---

### CHECK Constraints

```
CHECK (left_at IS NULL OR left_at > joined_at)
```

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_session_participants_session_id` | `(session_id)` | B-tree | All participants in a given session — the primary real-time query |
| `idx_session_participants_session_student` | `(session_id, student_id)` | B-tree | All connection attempts by a specific student within a session |
| `idx_session_participants_student_id` | `(student_id, joined_at DESC)` | B-tree | Per-student connection history across sessions |
| `idx_session_participants_class_id` | `(class_id)` | B-tree | Class-level participant log (without session join) |
| `idx_session_participants_active` | `(session_id)` WHERE `left_at IS NULL` | Partial B-tree | Real-time active participants: count of currently connected students per session |

---

### Soft Delete Strategy

`session_participants` rows are never deleted. They are the permanent real-time event log. A participant forcibly removed by the teacher is recorded by the teacher setting `left_at` via an Edge Function — the row is retained.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `joined_at` | ✅ | Business-significant: connection start time |
| `left_at` | ✅ | Business-significant: connection end time |
| `created_at` | ✅ | Row insertion time; useful to detect webhook delivery lag |
| `updated_at` | ❌ | Omitted. Updates to this table (camera toggle, network quality, left_at) can be tracked via `attendance_events` if fine-grained state changes are required; otherwise the row reflects last-known state |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE session | `RESTRICT` | Participant records outlive the session for analytics |
| DELETE student | `RESTRICT` | Student is soft-deleted; participation history must be retained |
| UPDATE participant_id | `RESTRICT` | PK must not change |

---

### Supabase RLS Considerations

```
Table: session_participants
RLS: ENABLED

Policies:

SELECT:
  - Students may read their own participant rows only.
    USING: student_id = (
      SELECT student_id FROM student_details WHERE profile_id = auth.uid()
    )

  - Teachers may read all participant rows for their own sessions.
    USING: EXISTS (
      SELECT 1 FROM live_classes lc
      WHERE lc.class_id = session_participants.class_id
        AND lc.teacher_id = (
          SELECT teacher_id FROM teacher_details WHERE profile_id = auth.uid()
        )
    )

  - Admins may read all participant rows within their institute.
    USING: institute_id = get_my_institute_id()

INSERT:
  - Via Edge Function only. Rows are created from provider webhook join events.

UPDATE:
  - Via Edge Function only. left_at, camera_enabled, mic_enabled, network_quality
    are updated by provider webhook state-change events.

DELETE:
  - Blocked at RLS level.
```

> **IP address privacy note:** If your product serves users in GDPR-regulated jurisdictions, `ip_address` is personal data. Either omit it, apply a data-retention deletion schedule, or store a hashed/anonymised form. Document your legal basis for storing raw IP addresses.

---

### Backend Developer Notes

1. **Relationship to `attendance`:** `session_participants` is the source. `attendance` is the summary. At class end, the attendance finalisation job computes `attendance.duration_seconds` by summing `(left_at - joined_at)` across all rows for that student × class, using `live_session.ended_at` as a synthetic `left_at` for any rows where `left_at IS NULL` at finalization time.

2. **Real-time active count:** The partial index on `(session_id) WHERE left_at IS NULL` supports the real-time participant count query (`SELECT COUNT(*) FROM session_participants WHERE session_id = ? AND left_at IS NULL`) without a full table scan. This query runs on every teacher dashboard refresh.

3. **Teacher removal:** When a teacher removes a student from the session, the provider fires a leave event. The Edge Function writes `left_at` on the participant's row and also sets a `removed_by_teacher = TRUE` flag if you choose to add it. Consider adding a `removal_reason` column (future iteration) to distinguish voluntary leaves from teacher-initiated removals for conduct analytics.

---

### Purpose

Stores metadata for recordings produced from a live class. A single `live_class` may generate multiple recording rows — for example, if the class was paused and restarted, if the provider splits recordings by file size limit, or if a retry recording was triggered after a failed first attempt.

This table stores recording metadata only. The actual video file lives in Supabase Storage (or an external CDN/provider storage), referenced via `storage_bucket` + `storage_path` (consistent with the storage model established in Domain 3) or `provider_recording_url` for provider-hosted recordings.

Students access recordings only after `status = 'completed'` and the parent class's `is_recorded = TRUE`. Access URLs are generated dynamically — never stored in this table.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `recording_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `class_id` | `UUID` | NOT NULL | — | FK → `live_classes.class_id`. The class this recording belongs to |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS and storage quota queries |
| `storage_bucket` | `VARCHAR(100)` | NULL | `NULL` | Supabase Storage bucket name. NULL if the recording is provider-hosted and not yet transferred to platform storage |
| `storage_path` | `TEXT` | NULL | `NULL` | Object path within `storage_bucket`. NULL if provider-hosted. When populated, signed URLs are generated dynamically from this path |
| `provider_recording_url` | `TEXT` | NULL | `NULL` | External recording URL from the video provider (e.g., Daily.co recording URL). Used as the playback source until the recording is transferred to platform storage. NULL once `storage_path` is populated |
| `duration_seconds` | `INTEGER` | NULL | `NULL` | Actual recorded duration in seconds. Populated by the recording completion webhook. NULL until processing is complete |
| `file_size_bytes` | `BIGINT` | NULL | `NULL` | File size in bytes. Used for storage quota tracking. NULL until processing is complete |
| `segment_number` | `INTEGER` | NOT NULL | `1` | Segment index for multi-part recordings. `1` for single-segment recordings. Allows multiple ordered parts to be stored and played back in sequence |
| `status` | `recording_status` | NOT NULL | `'queued'` | PostgreSQL enum: `queued`, `processing`, `completed`, `failed`. Tracks processing pipeline state |
| `failure_reason` | `TEXT` | NULL | `NULL` | Provider or pipeline error message when `status = 'failed'`. Used for debugging and admin alerts |
| `recorded_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC timestamp when this recording segment was initiated. Corresponds to the provider's recording start time |
| `completed_at` | `TIMESTAMPTZ` | NULL | `NULL` | UTC timestamp when the recording reached `status = 'completed'`. NULL until processing finishes |
| `thumbnail_path` | `TEXT` | NULL | `NULL` | Storage path of the auto-generated video thumbnail (first frame or provider-generated preview image). NULL until processing completes. Used for the recording library grid view. Generate signed URL dynamically — do not store raw URLs |
| `transcript_path` | `TEXT` | NULL | `NULL` | Storage path of the auto-generated transcript file (VTT or JSON format). NULL until transcript processing completes. Enables full-text search within recordings and AI-generated summaries in a future Domain 11 feature |
| `captions_path` | `TEXT` | NULL | `NULL` | Storage path of the captions/subtitles file (VTT or SRT format). NULL until captions are generated. Enables accessibility compliance (WCAG 2.1 Level AA) for recorded content |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC creation timestamp of this row |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC last-modified timestamp. Trigger-maintained |

---

### Primary Key

```
PRIMARY KEY (recording_id)
```

---

### Foreign Keys

```
class_id     → live_classes.class_id           ON DELETE RESTRICT   ON UPDATE RESTRICT
institute_id → institutes.institute_id          ON DELETE RESTRICT   ON UPDATE RESTRICT
```

---

### Unique Constraints

```
UNIQUE (class_id, segment_number)
```

> Ensures segment numbers are unique per class. Prevents duplicate segment entries from webhook retries.

---

### CHECK Constraints

```
CHECK (duration_seconds IS NULL OR duration_seconds > 0)
CHECK (file_size_bytes IS NULL OR file_size_bytes > 0)
CHECK (segment_number >= 1)
CHECK (completed_at IS NULL OR completed_at >= recorded_at)
CHECK (
  (status = 'completed' AND completed_at IS NOT NULL)
  OR (status != 'completed' AND completed_at IS NULL)
)
CHECK (
  (storage_bucket IS NULL) = (storage_path IS NULL)
)
CHECK (
  storage_path IS NOT NULL OR provider_recording_url IS NOT NULL
  OR status IN ('queued', 'processing')
)
```

> The `(storage_bucket IS NULL) = (storage_path IS NULL)` CHECK ensures bucket and path are always set together — never one without the other.

> The final CHECK ensures that a completed or failed recording always has at least one of `storage_path` or `provider_recording_url`. `queued` and `processing` rows are exempt — they may have neither until the provider assigns a URL.

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_recordings_class_id` | `(class_id)` | B-tree | All recordings for a given class (student playback, admin management) |
| `idx_recordings_class_segment` | `(class_id, segment_number)` | B-tree (covered by UNIQUE) | Already covered by unique constraint |
| `idx_recordings_institute_status` | `(institute_id, status)` | B-tree | Admin dashboard: all failed or processing recordings in the institute |
| `idx_recordings_status` | `(status)` | B-tree | Background pipeline: find all `queued` or `processing` recordings to poll for completion |

---

### Soft Delete Strategy

`recordings` does not use soft delete. A failed recording remains as a `status = 'failed'` row for debugging and retry tracking. A superseded recording (e.g., re-recorded after failure) is handled by inserting a new row with a new `segment_number` — the failed row is retained.

Physical storage object deletion (when a class is retired) is a separate data-retention workflow outside the normal product flow.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `updated_at` | ✅ | Required; trigger-maintained |
| `recorded_at` | ✅ | Provider-reported recording start time; distinct from row creation |
| `completed_at` | ✅ | Processing completion timestamp |
| `created_by` | ❌ | Recording creation is automated via webhook; no human actor |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE recording | `RESTRICT` | Treat as audit record; physical cleanup is a separate workflow |
| DELETE parent class | `RESTRICT` | Class is never deleted; safety net |
| UPDATE recording_id | `RESTRICT` | PK must not change |

---

### Supabase RLS Considerations

```
Table: recordings
RLS: ENABLED

Policies:

SELECT:
  - Students may read completed recordings for classes they are enrolled in.
    USING: institute_id = get_my_institute_id()
      AND status = 'completed'
      AND EXISTS (
        SELECT 1 FROM live_classes lc
        JOIN live_class_batch lcb ON lcb.class_id = lc.class_id
        JOIN batch_student bs ON bs.batch_id = lcb.batch_id
        JOIN student_details sd ON sd.student_id = bs.student_id
        WHERE lc.class_id = recordings.class_id
          AND sd.profile_id = auth.uid()
      )

  - Teachers may read all recordings for their own classes regardless of status.
    USING: EXISTS (
      SELECT 1 FROM live_classes lc
      WHERE lc.class_id = recordings.class_id
        AND lc.teacher_id = (
          SELECT teacher_id FROM teacher_details WHERE profile_id = auth.uid()
        )
    )

  - Admins may read all recordings within their institute.
    USING: institute_id = get_my_institute_id()
      AND (SELECT role FROM profiles WHERE profile_id = auth.uid()) = 'admin'

INSERT:
  - Via Edge Function / webhook handler only. Never from a client directly.

UPDATE:
  - Via Edge Function / webhook handler only (processing pipeline updates status,
    storage_path, duration_seconds, file_size_bytes, completed_at).

DELETE:
  - Blocked at RLS level.
```

---

### Backend Developer Notes

1. **Two-phase storage model:** Recordings typically exist in two phases:
   - **Phase 1 (provider-hosted):** `provider_recording_url` is set; `storage_bucket`/`storage_path` are NULL. The platform streams from the provider URL.
   - **Phase 2 (platform-hosted):** An async job downloads the recording from the provider, uploads to Supabase Storage, sets `storage_bucket`/`storage_path`, and nulls `provider_recording_url`. Playback switches to a dynamically generated signed URL.
   
   Phase 2 is optional but recommended — it removes dependency on provider URL stability and enables offline download features.

2. **Webhook idempotency:** The recording completion webhook from the provider may be delivered more than once. Use `INSERT ... ON CONFLICT (class_id, segment_number) DO UPDATE` with idempotent field updates to handle duplicate deliveries safely. Never process duplicate webhooks blindly.

3. **recording_url on live_classes:** When the first (or only) recording segment reaches `status = 'completed'`, the background job must also update `live_classes.recording_url` with the playback URL for that segment. This is the convenience denormalization described in Table 1.

4. **Retry on failure:** When `status = 'failed'`, the admin dashboard should surface a "retry recording" action. This does not update the existing row — it inserts a new `recording` row with `status = 'queued'` and an incremented `segment_number`, triggering the recording pipeline again.

---

## Table 4: `attendance`

### Purpose

Records each student's participation in a live class: when they joined, when they left, and how long they were present. One row per student per class. A student who joins and leaves multiple times within one class still has a single `attendance` row — the `duration_seconds` is the aggregate of all presence intervals, and `joined_at` / `left_at` represent the first join and final leave respectively.

This is the highest-volume table in Domain 4 and one of the fastest-growing in the entire system. At 1,000 students per class and 20 classes per day across 500 institutes, attendance grows at ~10 million rows per month. Range partitioning by `joined_at` (monthly or quarterly) is required from day one.

`attendance` feeds the teacher analytics dashboard (average attendance rate, per-class headcount), student performance reports (attendance percentage per subject), and the `teacher_analytics` table in Domain 11.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `attendance_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key. For partitioned tables, include the partition key (`joined_at`) in the PK if using declarative partitioning |
| `class_id` | `UUID` | NOT NULL | — | FK → `live_classes.class_id`. The class attended |
| `student_id` | `UUID` | NOT NULL | — | FK → `student_details.student_id`. The attending student |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized. Required for multi-tenant partitioned queries and RLS |
| `joined_at` | `TIMESTAMPTZ` | NULL | `NULL` | UTC timestamp of the student's first join event. NULL if the student was marked present manually (offline attendance) but no session join was recorded |
| `left_at` | `TIMESTAMPTZ` | NULL | `NULL` | UTC timestamp of the student's final leave event. NULL if the session ended before the student explicitly left (common — students often close the tab without clicking "Leave") |
| `duration_seconds` | `INTEGER` | NOT NULL | `0` | Total seconds the student was present. Computed from all join/leave events during the session. Set to 0 if the student joined but left immediately or if the presence duration cannot be computed. Never NULL |
| `is_present` | `BOOLEAN` | NOT NULL | `FALSE` | Computed attendance flag. TRUE if `duration_seconds >= minimum_presence_threshold` (e.g., 5 minutes = 300 seconds). The threshold is a business rule enforced at the application layer, not hardcoded in this column |
| `is_manual_override` | `BOOLEAN` | NOT NULL | `FALSE` | When TRUE, `is_present` was set manually by the teacher or admin, overriding the computed value. Used for edge cases: student had technical issues, teacher grants attendance credit |
| `override_by` | `UUID` | NULL | `NULL` | FK → `profiles.profile_id`. The admin or teacher who performed the manual override. NULL unless `is_manual_override = TRUE` |
| `override_reason` | `TEXT` | NULL | `NULL` | Free-text reason for the manual override. NULL unless `is_manual_override = TRUE` |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC timestamp of row creation |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC last-modified timestamp. Trigger-maintained |

---

### Primary Key

```
PRIMARY KEY (attendance_id, joined_at)
```

> The composite PK includes `joined_at` because `attendance` is range-partitioned by `joined_at`. PostgreSQL declarative partitioning requires the partition key to be part of the primary key.

---

### Foreign Keys

```
class_id    → live_classes.class_id             ON DELETE RESTRICT   ON UPDATE RESTRICT
student_id  → student_details.student_id        ON DELETE RESTRICT   ON UPDATE RESTRICT
institute_id → institutes.institute_id           ON DELETE RESTRICT   ON UPDATE RESTRICT
override_by → profiles.profile_id               ON DELETE SET NULL   ON UPDATE RESTRICT
```

> `override_by` uses `SET NULL` on delete. If the overriding admin's profile is deactivated, the attendance record and override flag are preserved; only the actor identity is nulled.

---

### Unique Constraints

```
UNIQUE (class_id, student_id)
```

> One attendance row per student per class. Prevents duplicate attendance records from join/leave event race conditions. Because the table is partitioned, this unique constraint must be scoped per partition — or enforced at the application layer with an `ON CONFLICT` clause. See Backend Developer Notes.

---

### CHECK Constraints

```
CHECK (duration_seconds >= 0)
CHECK (left_at IS NULL OR joined_at IS NULL OR left_at >= joined_at)
CHECK (
  (is_manual_override = TRUE AND override_by IS NOT NULL)
  OR (is_manual_override = FALSE AND override_by IS NULL AND override_reason IS NULL)
)
```

> The override consistency CHECK ensures `override_by` is always present when and only when `is_manual_override = TRUE`. This prevents orphaned override records (override flag set but no actor recorded).

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_attendance_class_id` | `(class_id)` | B-tree | Class-level attendance list: all students who attended a given class |
| `idx_attendance_student_id` | `(student_id)` | B-tree | Student attendance history across all their classes |
| `idx_attendance_institute_joined_at` | `(institute_id, joined_at DESC)` | B-tree | Institute-wide attendance timeline; analytics dashboard |
| `idx_attendance_class_is_present` | `(class_id, is_present)` | B-tree | Attendance rate computation: count present vs total per class |
| `idx_attendance_student_is_present` | `(student_id, is_present)` | B-tree | Per-student attendance percentage computation |

> All indexes should be created on each partition individually (PostgreSQL propagates them automatically with declarative partitioning). Confirm index propagation behaviour for your PostgreSQL 16 + Supabase version.

---

### Partitioning Strategy

```
Partition type: RANGE
Partition key:  joined_at
Partition size: Monthly (recommended) or Quarterly
Naming:         attendance_2025_01, attendance_2025_02, ...

Default partition: attendance_default
  — catches rows with joined_at = NULL (manual-override attendance with no session join).
  — Monitor the default partition; it should remain small.
```

> Partition maintenance (creating future month partitions) must be automated via pg_cron or a migration job run at the start of each month. Never rely on manual partition creation in production.

> Queries that do not include `joined_at` in the WHERE clause will scan all partitions (partition pruning cannot apply). The most common such query is "all attendance for a student" (filtered by `student_id` only). For this query pattern, either:
> - Accept the full partition scan (tolerable for dozens of partitions with per-partition B-tree indexes on `student_id`), or
> - Maintain a separate `student_attendance_summary` materialized view that pre-aggregates per-student attendance statistics.

---

### Soft Delete Strategy

`attendance` rows are never deleted or soft-deleted. They are the permanent record of student participation. If a row must be corrected (wrong student, wrong class), use `is_manual_override = TRUE` to flag and document the correction — do not delete and reinsert.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `updated_at` | ✅ | Required; trigger-maintained |
| `joined_at` | ✅ | Business-significant: actual join timestamp |
| `left_at` | ✅ | Business-significant: actual leave timestamp |
| `override_by` | ✅ | Audit trail for manual overrides |
| `override_reason` | ✅ | Context for override decisions |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE attendance | `RESTRICT` | Permanent participation record; cannot be deleted |
| DELETE parent class | `RESTRICT` | Class is never deleted; safety net |
| DELETE student | `RESTRICT` | Student is soft-deleted; attendance history must be retained |
| UPDATE attendance_id | `RESTRICT` | PK must not change |

---

### Supabase RLS Considerations

```
Table: attendance
RLS: ENABLED

Policies:

SELECT:
  - Students may read their own attendance rows only.
    USING: student_id = (
      SELECT student_id FROM student_details WHERE profile_id = auth.uid()
    )
  - Students must NOT read other students' attendance.

  - Teachers may read attendance for classes they own.
    USING: EXISTS (
      SELECT 1 FROM live_classes lc
      WHERE lc.class_id = attendance.class_id
        AND lc.teacher_id = (
          SELECT teacher_id FROM teacher_details WHERE profile_id = auth.uid()
        )
    )

  - Admins may read all attendance within their institute.
    USING: institute_id = get_my_institute_id()
      AND (SELECT role FROM profiles WHERE profile_id = auth.uid()) = 'admin'

INSERT:
  - Via Edge Function only. Attendance rows are created server-side from session join/leave
    events, never from direct client inserts.

UPDATE:
  - Teachers may update is_present, is_manual_override, override_by, override_reason
    for attendance rows on their own classes.
    USING: EXISTS (
      SELECT 1 FROM live_classes lc
      WHERE lc.class_id = attendance.class_id
        AND lc.teacher_id = (
          SELECT teacher_id FROM teacher_details WHERE profile_id = auth.uid()
        )
    )
  - Admins may update any field within their institute.
  - Students may NOT update any attendance field.

DELETE:
  - Blocked at RLS level.
```

> **Partition + RLS note:** RLS policies apply to each partition individually in PostgreSQL declarative partitioning. Verify that your RLS policies are evaluated correctly on partitioned tables in your Supabase version. As of PostgreSQL 16, RLS on partitioned tables is fully supported and policies propagate to child partitions.

---

### Backend Developer Notes

1. **Upsert on join/leave events:** The session provider sends join and leave webhook events in real time. The attendance Edge Function must use `INSERT ... ON CONFLICT (class_id, student_id) DO UPDATE` to accumulate presence. On each `leave` event, add the interval `(leave_time - join_time)` to `duration_seconds`. This requires the current join timestamp to be stored in a transient session-side store (Redis or Edge Function memory) between join and leave events.

2. **Unique constraint on partitioned table:** PostgreSQL requires the partition key (`joined_at`) to be part of any unique constraint on a partitioned table. `UNIQUE (class_id, student_id)` alone is not valid — it must be `UNIQUE (class_id, student_id, joined_at)`, which means the uniqueness is only guaranteed within a partition. Enforce true cross-partition uniqueness at the application layer by checking for an existing row before insert (within a serializable transaction or with a distributed lock per `(class_id, student_id)` pair).

3. **is_present threshold:** The minimum presence duration to count as "attended" is a configurable business rule (e.g., ≥ 50% of class duration, or ≥ 300 seconds absolute). Store this configuration in `system_settings` (Domain 15) per institute rather than hardcoding it. The Edge Function computes `is_present` when finalising attendance at class end.

4. **Late finalization:** After a class ends (`live_class.status = 'completed'`), there is a finalization window (recommended: 15 minutes) during which straggling leave events from the provider may still arrive. The attendance finalisation job should run after this window. Until finalization, `is_present` may be `FALSE` for students who are still technically in the session at end time — handle this by treating "still joined at class end" as a leave event at `live_session.ended_at`.

5. **Analytics aggregation:** Do not compute attendance rates live from this table on every dashboard request. Maintain aggregated statistics in `teacher_analytics` (total students, avg attendance rate) via a background job (Domain 11). Reserve direct queries on this table for drill-down views and exports.

---

## Table 4b: `attendance_events`

### Purpose

Stores the raw join/leave event log underlying each `attendance` summary row. A single `attendance` row captures the computed summary (first join, final leave, total duration, is_present flag) — but a student may join and leave a class multiple times in a single session due to network drops, browser refreshes, or deliberate mid-class exits.

`attendance` is the **summary** (one row per student per class, used by dashboards and reports). `attendance_events` is the **event log** (one row per join or leave event, used for debugging, dispute resolution, and fine-grained analytics).

This split follows the pattern used by large LMS platforms (Canvas, Moodle, Google Classroom) and telemetry systems (event sourcing): computed summaries are fast to query; raw events are the source of truth.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `event_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `attendance_id` | `UUID` | NOT NULL | — | FK → `attendance.attendance_id`. The summary row this event belongs to. All events for the same student × class share one attendance parent |
| `class_id` | `UUID` | NOT NULL | — | FK → `live_classes.class_id`. Denormalized for partition pruning and direct queries without the attendance join |
| `student_id` | `UUID` | NOT NULL | — | FK → `student_details.student_id`. Denormalized for the same reason |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS and multi-tenant partitioned queries |
| `event_type` | `VARCHAR(20)` | NOT NULL | — | `join` or `leave`. Not an enum to accommodate future values (e.g., `camera_on`, `mic_off`) without a migration |
| `event_timestamp` | `TIMESTAMPTZ` | NOT NULL | — | UTC timestamp of the event as reported by the session provider webhook. Use provider-reported time, not server receipt time, for accuracy |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC timestamp of row insertion. May differ from `event_timestamp` if provider webhook delivery is delayed |

---

### Primary Key

```
PRIMARY KEY (event_id, event_timestamp)
```

> Composite PK includes `event_timestamp` because this table is range-partitioned by `event_timestamp` (same monthly strategy as `attendance`). PostgreSQL declarative partitioning requires the partition key in the PK.

---

### Foreign Keys

```
attendance_id → attendance.attendance_id          ON DELETE RESTRICT   ON UPDATE RESTRICT
class_id      → live_classes.class_id             ON DELETE RESTRICT   ON UPDATE RESTRICT
student_id    → student_details.student_id        ON DELETE RESTRICT   ON UPDATE RESTRICT
institute_id  → institutes.institute_id           ON DELETE RESTRICT   ON UPDATE RESTRICT
```

> All FKs use `RESTRICT`. Event records are permanent. The parent `attendance` row must exist before events are inserted.

---

### Unique Constraints

```
UNIQUE (attendance_id, event_type, event_timestamp)
```

> Prevents duplicate event delivery from provider webhooks. If the same join event arrives twice (idempotency scenario), the second insert will conflict and be discarded via `ON CONFLICT DO NOTHING`.

---

### CHECK Constraints

```
CHECK (event_type IN ('join', 'leave'))
```

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_attendance_events_attendance_id` | `(attendance_id)` | B-tree | Fetch all events for a specific student × class pair |
| `idx_attendance_events_class_id` | `(class_id, event_timestamp)` | B-tree | Replay all events for a given class in order; session timeline reconstruction |
| `idx_attendance_events_student_id` | `(student_id, event_timestamp DESC)` | B-tree | Per-student event history |

---

### Partitioning Strategy

```
Partition type: RANGE
Partition key:  event_timestamp
Partition size: Monthly (aligned with the attendance table)
Naming:         attendance_events_2025_01, attendance_events_2025_02, ...

Default partition: attendance_events_default
```

> Keep partition strategy aligned with `attendance` so month-boundary queries are consistent across both tables.

---

### Soft Delete Strategy

`attendance_events` rows are never deleted. They are the immutable event log. If a provider sends a spurious event, flag it at the application layer — do not delete the row.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Row insertion time; useful to detect webhook delivery lag |
| `event_timestamp` | ✅ | Provider-reported event time; the authoritative timestamp |
| `updated_at` | ❌ | Event rows are insert-only; they are never updated |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE attendance | `RESTRICT` | Events cannot outlive their summary parent; summary is also never deleted |
| DELETE attendance_event | `RESTRICT` | Immutable event log; no deletion permitted |
| UPDATE event_id | `RESTRICT` | PK must not change |

---

### Supabase RLS Considerations

```
Table: attendance_events
RLS: ENABLED

Policies:

SELECT:
  - Students may read their own attendance events only.
    USING: student_id = (
      SELECT student_id FROM student_details WHERE profile_id = auth.uid()
    )

  - Teachers may read events for classes they own.
    USING: EXISTS (
      SELECT 1 FROM live_classes lc
      WHERE lc.class_id = attendance_events.class_id
        AND lc.teacher_id = (
          SELECT teacher_id FROM teacher_details WHERE profile_id = auth.uid()
        )
    )

  - Admins may read all events within their institute.
    USING: institute_id = get_my_institute_id()

INSERT:
  - Via Edge Function only. Event rows are written server-side from provider webhooks.

UPDATE:
  - Blocked at RLS level. Event rows are immutable.

DELETE:
  - Blocked at RLS level.
```

---

### Backend Developer Notes

1. **Event → summary flow:** On each provider webhook event:
   - Insert a row into `attendance_events` (idempotent via `ON CONFLICT DO NOTHING`)
   - Upsert the parent `attendance` row: on `join`, set `joined_at = MIN(joined_at, event_timestamp)`; on `leave`, accumulate `duration_seconds += (event_timestamp - last_join_timestamp)`
   - Track `last_join_timestamp` in a transient store (Redis or Edge Function memory) between join and leave events

2. **Recomputing the summary:** Because all raw events are retained, `attendance` can be fully recomputed from `attendance_events` at any time. This is the recovery path if a bug is discovered in the accumulation logic — reprocess all events for a class and regenerate the summary rows.

3. **Ordering guarantee:** Do not assume provider webhook delivery order matches event chronology. Always use `event_timestamp` (provider-reported) rather than `created_at` (insert time) for duration calculations. Sort by `event_timestamp` when replaying events.

---

### Purpose

Many-to-many junction table linking `live_classes` to `batches`. A single live class can be broadcast to multiple batches simultaneously; one batch can have many live classes over its lifetime. This junction table records which batches a class is broadcast to.

No attributes beyond the relationship and a lightweight audit timestamp. Batch assignment is set at class creation time and can be modified while the class is in `draft` or `scheduled` status.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `class_id` | `UUID` | NOT NULL | — | FK → `live_classes.class_id`. Part of composite primary key |
| `batch_id` | `UUID` | NOT NULL | — | FK → `batches.batch_id`. Part of composite primary key |
| `assigned_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC timestamp when this batch was assigned to this class. Lightweight audit field |
| `assigned_by` | `UUID` | NULL | `NULL` | FK → `profiles.profile_id`. The teacher or admin who made this assignment. NULL for system-created assignments |

---

### Primary Key

```
PRIMARY KEY (class_id, batch_id)
```

---

### Foreign Keys

```
class_id    → live_classes.class_id             ON DELETE CASCADE    ON UPDATE RESTRICT
batch_id    → batches.batch_id                  ON DELETE RESTRICT   ON UPDATE RESTRICT
assigned_by → profiles.profile_id               ON DELETE SET NULL   ON UPDATE RESTRICT
```

> `class_id` uses `CASCADE` on delete because if a `live_class` row were ever removed (which does not happen in normal operation, but could via service_role), the batch assignments have no standalone value. This is a safety net.

> `batch_id` uses `RESTRICT` to prevent a batch from being deleted while it has active class assignments. A batch must be unassigned from all classes before it can be archived or deleted.

---

### Unique Constraints

Enforced by the composite primary key.

---

### CHECK Constraints

None beyond FK and PK constraints.

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_live_class_batch_batch_id` | `(batch_id)` | B-tree | All classes assigned to a given batch — reverse direction of the composite PK |
| `idx_live_class_batch_class_id` | `(class_id)` | B-tree | Covered by the composite PK (leading column) — no additional index needed |

---

### Soft Delete Strategy

None. Rows in this table are either present (batch is assigned) or absent (batch is not assigned). To remove a batch from a class, delete the row. The operation is only permitted while `live_class.status IN ('draft', 'scheduled')` — enforce at the application layer.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `assigned_at` | ✅ | Lightweight audit; useful for "when was this batch added" |
| `assigned_by` | ✅ | Identifies who made the batch assignment |
| `updated_at` | ❌ | Junction rows are not updated; they are inserted and deleted |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE live_class | `CASCADE` to `live_class_batch` | Batch assignments have no value without the class |
| DELETE batch | `RESTRICT` | Cannot delete a batch with active class assignments |
| UPDATE class_id / batch_id | `RESTRICT` | PKs must not change |

---

### Supabase RLS Considerations

```
Table: live_class_batch
RLS: ENABLED

Policies:

SELECT:
  - Any authenticated user within the same institute may read live_class_batch rows
    for classes within their institute. Used by students to verify batch membership,
    and by teachers to see which batches their class is assigned to.
    USING: EXISTS (
      SELECT 1 FROM live_classes lc
      WHERE lc.class_id = live_class_batch.class_id
        AND lc.institute_id = get_my_institute_id()
    )

INSERT:
  - Teachers may assign batches to their own classes when status IN ('draft', 'scheduled').
    WITH CHECK: EXISTS (
      SELECT 1 FROM live_classes lc
      WHERE lc.class_id = live_class_batch.class_id
        AND lc.teacher_id = (
          SELECT teacher_id FROM teacher_details WHERE profile_id = auth.uid()
        )
        AND lc.status IN ('draft', 'scheduled')
    )
  - Admins may assign any batch within their institute.

UPDATE:
  - Blocked. Batch assignments are insert-or-delete only.

DELETE:
  - Teachers may remove batch assignments from their own classes when status IN ('draft', 'scheduled').
  - Admins may remove any batch assignment within their institute.
  - Blocked once the class is 'live' or 'completed'.
```

---

### Backend Developer Notes

1. **Assignment validation:** Before inserting a `live_class_batch` row, validate that the `batch_id` belongs to the same institute as the `live_class`. This cross-entity consistency check cannot be expressed as a FK constraint and must be enforced at the application layer.

2. **Minimum batch assignment:** A class must have at least one batch assigned before it can be transitioned from `draft` to `scheduled`. Enforce this as a pre-condition in the "Publish Class" Edge Function — check `COUNT(*) FROM live_class_batch WHERE class_id = ?` before allowing the status transition.

3. **Batch modification after scheduling:** Once a class is `'live'` or `'completed'`, batch assignments must be frozen. Any attempt to add or remove a batch from a live/completed class must return a 409 Conflict. Enforce at the RLS level (INSERT/DELETE blocked by status check) and at the application layer.

4. **Student visibility derivation:** Student access to a `live_class` is derived entirely from this junction table: a student can see a class if and only if they are enrolled in at least one batch that is assigned to that class (via `batch_student`). This join is the foundation of the student-facing class RLS policy described in Table 1.

---

## Domain 4 — Design Decisions Summary

| Decision | Choice | Reason |
|----------|--------|--------|
| `live_class` vs `live_session` split | Yes — two tables | Separates the schedulable event (title, time, topic) from the technical session (provider, tokens, room). One can exist without the other |
| `chapter_id` nullable on `live_class` | Yes | Teachers may hold orientation or cross-chapter revision classes not mapped to a single chapter |
| `recording_url` on `live_class` | Denormalized convenience field | Avoids a join to `recordings` for the primary "get playback URL" use case |
| Storage model for recordings | `storage_bucket` + `storage_path` (consistent with Domain 3) | Same pattern as content; signed URLs generated dynamically |
| `provider_recording_url` on recordings | Yes — transitional field | Provider-hosted recordings are available immediately; platform storage transfer is async |
| `thumbnail_path` / `transcript_path` / `captions_path` on recordings | Yes — nullable until populated | Enables future AI summaries, full-text search, and accessibility compliance without schema changes |
| `provider_metadata` JSONB on `live_session` | Yes | Provider APIs return opaque metadata; JSONB avoids schema changes on provider upgrades |
| `ended_reason` on `live_session` | VARCHAR(50), not enum | Debugging-critical field; free-form string avoids migrations when new termination reasons are discovered |
| `host_token` / `participant_token` on `live_session` | Stored in DB | Required for session recovery and multi-device join; access restricted to teacher role via VIEW or Edge Function |
| `session_participants` as separate table | Yes — new table | `attendance` cannot store multiple join/leave cycles, device state, or network quality. `session_participants` is the real-time log; `attendance` is the computed summary |
| `attendance` + `attendance_events` split | Yes — summary + event log | Follows event-sourcing pattern. `attendance` is fast to query for reports; `attendance_events` retains full history for debugging, dispute resolution, and recomputation |
| `attendance` partitioning | Monthly RANGE on `joined_at` | Volume justifies partitioning from day one; monthly granularity balances partition count with query efficiency |
| `attendance_events` partitioning | Monthly RANGE on `event_timestamp` (aligned with `attendance`) | Same rationale; aligned boundaries simplify cross-table month-scoped queries |
| `is_manual_override` on `attendance` | Explicit boolean + actor + reason | Manual overrides are auditable business decisions; must be distinguishable from computed attendance |
| `live_class_batch` cascade | `CASCADE` on class delete | Batch assignments have no standalone value; consistent with `content_tag` pattern in Domain 3 |
| `institute_id` on all tables | Denormalized on every table | Consistent RLS performance pattern across all Domain 4 tables; mandatory for multi-tenant isolation |

---

## Domain 4 — Relationships to Other Domains

| This Table | References | Via Column | Domain |
|------------|-----------|------------|--------|
| `live_classes` | `institutes` | `institute_id` | Domain 1 |
| `live_classes` | `teacher_details` | `teacher_id` | Domain 1 |
| `live_classes` | `subjects` | `subject_id` | Domain 2 (Academic Structure) |
| `live_classes` | `chapters` | `chapter_id` | Domain 2 (Academic Structure) |
| `live_class_batch` | `batches` | `batch_id` | Domain 5 (Batch Management) |
| `attendance` | `student_details` | `student_id` | Domain 1 |
| `attendance` | `live_classes` | `class_id` | This domain |
| `attendance_events` | `attendance` | `attendance_id` | This domain |
| `attendance_events` | `student_details` | `student_id` | Domain 1 |
| `session_participants` | `live_sessions` | `session_id` | This domain |
| `session_participants` | `student_details` | `student_id` | Domain 1 |

| This Table | Referenced By | Via Column | Domain |
|------------|--------------|------------|--------|
| `live_classes` | `live_sessions` | `class_id` | This domain |
| `live_classes` | `recordings` | `class_id` | This domain |
| `live_classes` | `attendance` | `class_id` | This domain |
| `live_classes` | `live_class_batch` | `class_id` | This domain |
| `live_classes` | `session_participants` | `class_id` | This domain |
| `live_classes` | `teacher_analytics` | (aggregate source) | Domain 11 (Analytics) |
| `live_sessions` | `session_participants` | `session_id` | This domain |
| `attendance` | `attendance_events` | `attendance_id` | This domain |
| `attendance` | `teacher_analytics` | (aggregate source) | Domain 11 (Analytics) |
| `attendance` | `performance_report` | (aggregate source) | Domain 11 (Analytics) |

---

## Domain 4 — Enum Types Used

All enums are defined globally in the pre-domain migration (see Domain 1 Pre-Domain Notes).

| Enum | Values Used in This Domain |
|------|--------------------------|
| `live_class_status` | `draft`, `scheduled`, `live`, `completed`, `cancelled` |
| `live_session_status` | `waiting`, `live`, `ended` |
| `recording_status` | `queued`, `processing`, `completed`, `failed` |

> `attendance_events.event_type` and `live_sessions.ended_reason` intentionally use `VARCHAR` rather than enums to allow new values to be added at the application layer without database migrations.

---

---

## Domain 4 — Future Domains

The following capabilities are not in scope for v1 but are architecturally anticipated. They are listed here so dependent teams can plan ahead and schema changes in future sprints don't require redesigning existing tables.

### Live Chat (`session_messages`)

A complete streaming platform requires in-session chat. The table would anchor to `session_id` and `class_id`, with a `sender_id` (teacher or student), `message_type` (`text`, `image`, `system`), `created_at`, and a `deleted` flag for teacher moderation. At high volume, this is a write-heavy append-only table and a candidate for an external message broker (Redis Pub/Sub, Pusher, or Ably) with async persistence rather than direct Postgres writes per message.

### Whiteboard (`whiteboard_actions`)

If the platform replaces Zoom rather than wrapping it, a native whiteboard is required. Actions (`stroke`, `erase`, `shape`, `text`, `image`) anchored to `session_id` with a `sequence_number` for ordering. This is a separate domain due to volume — a busy whiteboard session generates thousands of events per minute. Vector-based storage (SVG snapshots + delta events) is likely more practical than raw stroke arrays.

### Polls (`polls` · `poll_options` · `poll_votes`)

Teachers frequently run in-session polls ("Which law applies here? A/B/C/D"). The domain needs three tables: `polls` (question, session, created_at, closed_at), `poll_options` (text, poll_id), and `poll_votes` (student_id, option_id, voted_at). `poll_votes` is write-heavy and time-sensitive (all students vote within seconds). Index on `(poll_id, option_id)` for real-time vote count aggregation.

### Waiting Room (`live_session_settings`)

For classes where students arrive before the teacher starts (e.g., 9:50 for a 10:00 class), a waiting room feature is required. This implies a `live_session_settings` table or a JSONB `settings` column on `live_sessions` with fields like `waiting_room_enabled` (BOOLEAN), `admit_policy` (`auto` or `manual`), and `max_wait_minutes`. Individual admit/deny events could be logged in `session_participants` with a `waiting_room_status` column (`waiting`, `admitted`, `denied`).

### Raise Hand (`raise_hand_events`)

Students need a way to signal the teacher without unmuting. The event log would store `student_id`, `session_id`, `raised_at`, `lowered_at`, and `resolved_by` (teacher who acknowledged it). Low-volume table; no partitioning needed. Can be combined with a presence/state field on `session_participants` if the feature scope is limited to simple yes/no state.

---

*Domain 4 complete — v2.0. Awaiting approval before proceeding to Domain 5 — Batch Management (Batch · BatchStudent · BatchTeacher).*
