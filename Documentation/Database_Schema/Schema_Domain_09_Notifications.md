# EdTech Platform — Database Schema Specification
## Domain 9: Notifications
### Tables: `notification_templates` · `notifications` · `notification_recipients`

**Document version:** 1.0
**ERD reference:** ERD v2.0 (Relationships R62–R63; Domain 13 — Notifications)
**PostgreSQL target:** 16
**Supabase compatibility:** Yes
**Domain sequence:** Phase 9 of 15

---

## Domain Overview

The Notifications domain is the communication broadcast layer of the platform. It is responsible for the full lifecycle of every system-generated and admin-initiated message sent to users — class reminders, test result alerts, new content published notifications, subscription expiry warnings, and approval status updates.

At the scale this platform targets (hundreds of thousands of users), the Notifications domain is one of the highest fan-out write surfaces in the entire system. A single "Live class starting in 10 minutes" notification may generate 100,000 `notification_recipients` rows in one operation. This architectural reality defines every design decision in this domain.

**Tables in this domain (in dependency order):**

| # | Table | Role | Write Pattern |
|---|-------|------|---------------|
| 1 | `notification_templates` | Reusable, parameterised message blueprints | Admin-managed; low-frequency INSERT / UPDATE |
| 2 | `notifications` | A concrete notification event dispatched from a template | Written once per event trigger; never updated |
| 3 | `notification_recipients` | Junction table: one row per user per notification | High-volume INSERT via queue; `is_read` / `read_at` updated by the user |

---

## Key Architectural Principles for This Domain

**1. Fan-out is a queue problem, not a database problem.** Writing 100,000 `notification_recipients` rows in a single database transaction will cause lock contention, connection exhaustion, and timeouts. Fan-out from a `notification` event to individual recipients must be processed asynchronously via a message queue (Supabase Realtime + Postgres triggers, AWS SQS, BullMQ, or equivalent). The database schema is designed to receive the result of fan-out, not to orchestrate it.

**2. Templates are the single source of truth for message content.** Message body text lives only in `notification_templates`. The `notifications` table stores rendered snapshots of the title and body at dispatch time — this is intentional. If a template is later edited, previously dispatched notifications retain their original text. This is the correct product behaviour (a user should see the message they received, not a retroactively edited version).

**3. `notification_recipients` is append-only except for `is_read` / `read_at`.** After a row is inserted, only two columns are ever updated: `is_read` (boolean flip) and `read_at` (timestamp set once). No other column in this table is ever written after initial INSERT. Enforce this at the application layer and via RLS.

**4. Channel is recorded at the notification level, not the recipient level.** One notification event goes out on one channel (e.g., `in_app`, `push`, `email`, `sms`). If the same event must broadcast on multiple channels, a separate `notification` row per channel is created from the same template. This keeps queries simple and delivery tracking unambiguous.

**5. Soft delete is applied only on `notifications`.** Templates are never deleted — they are deactivated. Recipient rows are never deleted — the read/unread history is a permanent user interaction record.

---

## Enum Types Referenced

| Enum Name | Values | Used By |
|-----------|--------|---------|
| `user_role_type` | `admin`, `teacher`, `student` | `notification_templates.target_role` |

---

## New Enum Types Defined in This Domain

| Enum Name | Values | Used By | Reason |
|-----------|--------|---------|--------|
| `notification_channel_type` | `in_app`, `push`, `email`, `sms` | `notifications.channel` | Defines the delivery mechanism for a notification. Allows channel-specific delivery tracking and filtering without free-text string comparisons |
| `notification_event_type` | `live_class_reminder`, `test_published`, `result_available`, `content_approved`, `content_rejected`, `subscription_expiring`, `subscription_expired`, `new_content_uploaded`, `batch_assigned`, `announcement`, `custom` | `notification_templates.event_type` | Enumerates all system events that trigger notifications. The `custom` value covers admin-authored one-off broadcasts that do not map to a system event |

---

## Table 1: `notification_templates`

### Purpose

Stores reusable, parameterised message blueprints. Every system-generated notification originates from a template. Templates define the structure — title format, body format, which channel to use, which role it targets — while individual `notifications` rows store the rendered output for a specific event.

Templates are authored and managed by platform admins (or seeded at deploy time for system events). The `body_template` field supports named placeholder tokens (e.g., `{{student_name}}`, `{{class_title}}`, `{{test_name}}`) that are interpolated at dispatch time by the notification service before writing the rendered text to the `notifications` table.

This table is low-traffic. Expect fewer than 50 rows across the entire lifetime of the platform for any single institute, plus shared system-level templates seeded at install time.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `template_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `institute_id` | `UUID` | NULL | `NULL` | FK → `institutes.institute_id`. NULL for system-level templates that are shared across all institutes (e.g., platform-wide maintenance alerts). NOT NULL for institute-custom templates authored by admins |
| `name` | `TEXT` | NOT NULL | — | Human-readable internal name for the template (e.g., `"Live Class Reminder — 10 Min"`, `"Test Result Available"`). Used only in the admin dashboard template manager; not shown to end users |
| `event_type` | `notification_event_type` | NOT NULL | — | The system event this template is bound to. Used by the notification dispatch service to look up the correct template for a given event. For `custom` templates, the event_type is `custom` and dispatch is always manual |
| `channel` | `notification_channel_type` | NOT NULL | `'in_app'` | The delivery channel this template renders for. One template per channel per event. If the same event needs email + push, two templates exist |
| `target_role` | `user_role_type` | NULL | `NULL` | Which role this template targets (`admin`, `teacher`, `student`). NULL means all roles. Used by the dispatch service to filter recipient lists |
| `title_template` | `TEXT` | NOT NULL | — | The notification title with placeholder tokens (e.g., `"Your class {{class_title}} starts in 10 minutes"`). Maximum 255 characters recommended for push notification compatibility |
| `body_template` | `TEXT` | NOT NULL | — | Full body text with placeholder tokens. For `in_app` and `email`, supports longer rich content. For `push` and `sms`, should be kept under 160 characters in practice |
| `is_active` | `BOOLEAN` | NOT NULL | `TRUE` | Soft-delete flag. Inactive templates are not used for new dispatches but their historical notifications remain intact |
| `created_by` | `UUID` | NOT NULL | — | FK → `profiles.profile_id`. The admin who created the template. For system-seeded templates, this references the platform superadmin profile |
| `updated_by` | `UUID` | NULL | `NULL` | FK → `profiles.profile_id`. The admin who last modified the template |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Row creation timestamp. Always UTC |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Last modification timestamp. Trigger-maintained. Always UTC |

---

### Primary Key

```
PRIMARY KEY (template_id)
```

---

### Foreign Keys

```
institute_id → institutes.institute_id   ON DELETE RESTRICT   ON UPDATE RESTRICT
created_by   → profiles.profile_id       ON DELETE RESTRICT   ON UPDATE RESTRICT
updated_by   → profiles.profile_id       ON DELETE SET NULL   ON UPDATE RESTRICT
```

> **`institute_id` NULLABLE FK note:** PostgreSQL FK constraints correctly allow NULL values on a nullable FK column — the constraint is only enforced when the value is NOT NULL. A NULL `institute_id` on a template row indicates a system-level template and does not violate referential integrity.

> **`ON DELETE RESTRICT` on `institute_id`:** An institute cannot be deleted while it owns notification templates. Deactivate templates first (set `is_active = FALSE`), then archive the institute. This prevents orphaned templates.

> **`ON DELETE SET NULL` on `updated_by`:** If the admin who last edited a template is deactivated, the `updated_by` reference degrades gracefully to NULL rather than blocking the admin deactivation.

---

### Composite Keys

None. `template_id` is the sole primary key.

---

### Unique Constraints

```
UNIQUE (institute_id, event_type, channel)
```

> Enforces that for any given institute, there is at most one active template per event type per channel. For system-level templates (`institute_id IS NULL`), this partial uniqueness is enforced via a partial unique index:
>
> `CREATE UNIQUE INDEX uq_notification_templates_system ON notification_templates (event_type, channel) WHERE institute_id IS NULL;`
>
> This allows system templates and per-institute templates to coexist for the same event and channel without conflict.

---

### CHECK Constraints

```
CHECK (char_length(name) >= 3 AND char_length(name) <= 200)
CHECK (char_length(title_template) >= 1 AND char_length(title_template) <= 500)
CHECK (char_length(body_template) >= 1)
```

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_notif_templates_institute_event_channel` | `(institute_id, event_type, channel)` | B-tree (covered by UNIQUE) | Primary lookup: dispatch service queries by institute + event + channel to find the correct template at event trigger time |
| `idx_notif_templates_event_type_active` | `(event_type, is_active)` | B-tree | Filter active templates per event type across all institutes; used during platform-level template management |
| `idx_notif_templates_institute_active` | `(institute_id, is_active)` | B-tree | Admin dashboard: list all active templates for an institute |

---

### Soft Delete Strategy

`is_active = FALSE` is the soft delete mechanism. Inactive templates are never physically deleted because:

1. Historical `notifications` rows reference `template_id` and must remain intact for audit purposes.
2. The template's content (title and body at time of dispatch) is snapshotted on the `notifications` table, so deactivating a template does not affect previously sent notifications — but the FK relationship must be preserved.

Physically deactivated templates do not appear in admin template lists (`WHERE is_active = TRUE`) and are not selected by the dispatch service.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `updated_at` | ✅ | Trigger-maintained |
| `created_by` | ✅ | Templates are admin-authored; authorship attribution is required for compliance and debugging |
| `updated_by` | ✅ | Template edits change the content of all future notifications; editor attribution is important |
| `deleted_at` | ❌ | `is_active` flag is sufficient; templates are never hard-deleted |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE notification_template | `RESTRICT` (cannot delete while notifications reference it) | Historical notifications must retain their template reference |
| DELETE institute | `RESTRICT` | Cannot delete institute while it owns templates |
| UPDATE template_id | `RESTRICT` | PK must not change; notifications reference this |
| DELETE admin (created_by) | `RESTRICT` | Template attribution must be preserved |
| DELETE admin (updated_by) | `SET NULL` | Graceful degradation for last-editor reference |

---

### Supabase RLS Considerations

```
Table: notification_templates
RLS: ENABLED

SELECT:
  - Admins may read all templates scoped to their institute and all system templates.
    USING: (institute_id = get_my_institute_id()
            OR institute_id IS NULL)
      AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')

  - Teachers and Students: no direct access to template rows. They interact with
    rendered notifications, not templates.

INSERT:
  - Admins only. institute_id must equal get_my_institute_id().
    WITH CHECK: institute_id = get_my_institute_id()
      AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')

  - System-level templates (institute_id IS NULL) are INSERT-only via service_role.
    Client-side INSERT of system templates is blocked.

UPDATE:
  - Admins may update templates belonging to their own institute only.
    USING: institute_id = get_my_institute_id()
    WITH CHECK: institute_id = get_my_institute_id()

  - System-level templates: blocked for all client roles; only service_role.

DELETE:
  - Blocked for all client roles. Use is_active = FALSE instead.
  - Hard deletes are service_role only and should never be performed in production
    while live notification rows reference the template.
```

---

### Backend Developer Notes

1. **Token interpolation is the notification service's responsibility, not the database's.** The `body_template` column stores raw template strings with `{{token}}` placeholders. The notification dispatch service (an Edge Function or backend worker) is responsible for fetching the template, substituting all tokens with the event's runtime context values, and writing the rendered strings to `notifications.title` and `notifications.body`. The database never stores partially rendered templates.

2. **Template lookup at dispatch time must be fast.** The dispatch service performs a single lookup: `SELECT * FROM notification_templates WHERE institute_id = $1 AND event_type = $2 AND channel = $3 AND is_active = TRUE`. The composite unique index ensures this is a sub-millisecond index scan.

3. **System templates vs institute templates — precedence rule.** If both a system-level template and an institute-specific template exist for the same `(event_type, channel)`, the dispatch service must prefer the institute-specific template. Implement this as: `ORDER BY (institute_id IS NULL) ASC LIMIT 1`. Document this precedence rule in the dispatch service code; it is a business rule, not a database constraint.

4. **`target_role` is advisory for the dispatch service, not enforced at the DB level.** The dispatch service uses `target_role` to determine which recipient list to build (all students in a batch, all teachers in an institute, etc.). The database does not enforce role filtering on `notification_recipients` rows — that logic belongs in the application. RLS ensures that once a notification is delivered, each user can only read their own recipient row.

5. **Template versioning is out of scope for v1.** If the business requires tracking template edit history, add a separate `notification_template_versions` audit table in a future iteration. For v1, `updated_at` and `updated_by` are sufficient.

---

## Table 2: `notifications`

### Purpose

Stores one concrete notification event per dispatch. A `notification` row is created when a system event fires (e.g., a live class is about to start, a test result is available) and the dispatch service has resolved the correct template, interpolated all tokens, and is ready to fan-out to recipients.

The `title` and `body` columns on this table store the **fully rendered, final text** of the notification at the moment of dispatch. This is an intentional snapshot — it decouples the recipient's experience from any future changes to the template. A student who reads their notification two weeks later sees exactly what was sent, even if the template was subsequently edited.

The `notifications` table is the audit record for every message sent by the system. It answers: "On this date, this event triggered a notification with this content on this channel."

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `notification_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. The institute context in which this notification was dispatched. All recipient lookups are scoped to this institute |
| `template_id` | `UUID` | NULL | `NULL` | FK → `notification_templates.template_id`. The template used to generate this notification. NULL if the notification was created manually without a template (ad-hoc admin message). Nullable to support future one-off notifications authored directly in the admin panel |
| `title` | `TEXT` | NOT NULL | — | Fully rendered notification title. All `{{token}}` placeholders from the template have been substituted with actual values. Maximum 500 characters |
| `body` | `TEXT` | NOT NULL | — | Fully rendered notification body. All placeholders substituted. For `push` and `sms` channels, the dispatch service must enforce channel-specific character limits before writing |
| `channel` | `notification_channel_type` | NOT NULL | — | The delivery channel used for this notification (`in_app`, `push`, `email`, `sms`) |
| `event_type` | `notification_event_type` | NOT NULL | — | Denormalized from the template for query convenience. Enables filtering all notifications for a specific event type without joining to `notification_templates` |
| `triggered_by` | `UUID` | NULL | `NULL` | FK → `profiles.profile_id`. The admin or system actor who triggered this notification. NULL for fully automated system events with no human actor |
| `reference_type` | `TEXT` | NULL | `NULL` | The entity type this notification is about (e.g., `'live_class'`, `'mock_test'`, `'content'`, `'order'`). Used to construct deep links on the frontend. Not enforced as an enum to allow extension without schema migrations |
| `reference_id` | `UUID` | NULL | `NULL` | The UUID of the specific entity referenced by `reference_type` (e.g., the `live_class_id` of the class this reminder is about). Used by the frontend to navigate to the relevant screen when the user taps the notification |
| `total_recipients` | `INTEGER` | NOT NULL | `0` | The number of `notification_recipients` rows created for this notification. Updated by the fan-out job when it completes. Provides a quick count without querying the `notification_recipients` table |
| `dispatched_at` | `TIMESTAMPTZ` | NULL | `NULL` | The timestamp when fan-out began (i.e., when the notification was handed off to the queue). NULL until the dispatch job starts. Distinct from `created_at` — a notification may be created (queued) and dispatched (delivered) at different times |
| `is_deleted` | `BOOLEAN` | NOT NULL | `FALSE` | Soft delete flag. Allows admins to retract a notification from the admin panel without physically deleting the row. Retracted notifications are hidden from recipient inboxes but preserved for audit |
| `deleted_at` | `TIMESTAMPTZ` | NULL | `NULL` | Timestamp when the notification was soft-deleted. NULL when `is_deleted = FALSE`. Set by trigger when `is_deleted` is flipped to TRUE |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Row creation timestamp (when the notification was queued). Always UTC |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Last modification timestamp. Trigger-maintained. Updated when `total_recipients` is written and when `is_deleted` is set |

---

### Primary Key

```
PRIMARY KEY (notification_id)
```

---

### Foreign Keys

```
institute_id  → institutes.institute_id              ON DELETE RESTRICT   ON UPDATE RESTRICT
template_id   → notification_templates.template_id   ON DELETE RESTRICT   ON UPDATE RESTRICT
triggered_by  → profiles.profile_id                  ON DELETE SET NULL   ON UPDATE RESTRICT
```

> **`ON DELETE RESTRICT` on `template_id`:** A template cannot be deactivated or hard-deleted while live notification rows reference it. This enforces the soft-delete-only rule on templates.

> **`ON DELETE SET NULL` on `triggered_by`:** If the admin who triggered a notification is deactivated, the trigger attribution degrades to NULL rather than blocking the deactivation. The notification record and its recipients are unaffected.

> **`reference_type` / `reference_id` are not FK-constrained.** They are a polymorphic reference pair (similar to Rails polymorphic associations). PostgreSQL cannot enforce FK constraints on polymorphic reference columns without triggers. Referential integrity for these columns is the responsibility of the dispatch service, which must validate that `reference_id` exists in the table implied by `reference_type` before writing.

---

### Composite Keys

None. `notification_id` is the sole primary key.

---

### Unique Constraints

None at the table level. A notification may legitimately be dispatched multiple times for the same event if the admin re-triggers it (e.g., a reminder sent twice). Uniqueness is a business rule enforced at the application layer, not a database constraint.

---

### CHECK Constraints

```
CHECK (char_length(title) >= 1 AND char_length(title) <= 500)
CHECK (char_length(body) >= 1)
CHECK (total_recipients >= 0)
CHECK (
  (is_deleted = FALSE AND deleted_at IS NULL)
  OR
  (is_deleted = TRUE AND deleted_at IS NOT NULL)
)
CHECK (dispatched_at IS NULL OR dispatched_at >= created_at)
```

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_notifications_institute_created_at` | `(institute_id, created_at DESC)` | B-tree | Admin panel: list all recent notifications for an institute, newest first |
| `idx_notifications_institute_event_type` | `(institute_id, event_type, created_at DESC)` | B-tree | Admin filter: all notifications of a specific event type within an institute |
| `idx_notifications_institute_channel` | `(institute_id, channel, created_at DESC)` | B-tree | Admin filter: notifications by delivery channel |
| `idx_notifications_template_id` | `(template_id)` | B-tree | Support FK constraint check; join from template to all notifications sent from it |
| `idx_notifications_reference` | `(reference_type, reference_id)` | B-tree | Fetch all notifications related to a specific entity (e.g., all notifications about live class X) |
| `idx_notifications_is_deleted` | `(institute_id, is_deleted, created_at DESC)` | B-tree (partial: `WHERE is_deleted = FALSE`) | Efficiently exclude soft-deleted notifications in admin and service queries |

---

### Soft Delete Strategy

`is_deleted = TRUE` + `deleted_at = NOW()` is the soft delete mechanism for notifications. When an admin retracts a notification:

- `is_deleted` is set to `TRUE`.
- `deleted_at` is set to the current timestamp (via trigger or application code).
- The corresponding `notification_recipients` rows are **not** deleted, but the frontend must check the parent `notifications.is_deleted` flag before rendering a notification in the user's inbox. This is enforced via a database view or RLS join condition (see Supabase RLS section below).
- The `deleted_at` CHECK constraint ensures both columns are always consistent.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `updated_at` | ✅ | Trigger-maintained |
| `dispatched_at` | ✅ | Business-level delivery timestamp; distinct from creation time |
| `triggered_by` | ✅ | Attribution for manually triggered notifications |
| `deleted_at` | ✅ | Soft delete timestamp for retraction audit trail |
| `updated_by` | ❌ | Notifications are never edited after dispatch; retraction is the only mutation |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE notifications | `CASCADE` to `notification_recipients` | Recipients are meaningless without the notification; cascade delete is correct for hard deletes (which should only happen in data purge jobs) |
| DELETE institute | `RESTRICT` | Cannot delete institute while notifications exist |
| DELETE template | `RESTRICT` | Cannot delete template while notifications reference it |
| UPDATE notification_id | `RESTRICT` | PK must not change |
| DELETE admin (triggered_by) | `SET NULL` | Attribution degrades gracefully |

---

### Supabase RLS Considerations

```
Table: notifications
RLS: ENABLED

SELECT:
  - Admins may read all notifications within their institute.
    USING: institute_id = get_my_institute_id()
      AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')

  - Teachers and Students: no direct SELECT access to the notifications table.
    They access notifications exclusively through notification_recipients, which
    joins back to notifications. This avoids recipients seeing notifications they
    were not included in.

  - To support recipient inbox queries efficiently, expose a view:
    CREATE VIEW my_notifications AS
      SELECT n.*, nr.is_read, nr.read_at, nr.received_at
      FROM notifications n
      INNER JOIN notification_recipients nr ON nr.notification_id = n.notification_id
      WHERE nr.profile_id = auth.uid()
        AND n.is_deleted = FALSE
        AND n.institute_id = get_my_institute_id()
      ORDER BY nr.received_at DESC;
    Apply RLS on the underlying tables; the view inherits it.

INSERT:
  - Blocked for all client roles. Written only by service_role (dispatch service /
    Edge Function).

UPDATE:
  - Admins only: may set is_deleted = TRUE (soft retraction).
    USING: institute_id = get_my_institute_id()
    WITH CHECK: institute_id = get_my_institute_id()
      AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  - The update must be restricted to the is_deleted column only at the application
    layer. No other column should be mutable post-dispatch.

DELETE:
  - Blocked for all client roles. Hard deletes are service_role only, used exclusively
    for data retention purge jobs (e.g., purge notifications older than 1 year).
```

---

### Backend Developer Notes

1. **Never update `notifications` rows after dispatch except for `is_deleted` and `total_recipients`.** Once dispatched, the notification content is immutable. `total_recipients` is the one field that is legitimately written after creation (by the fan-out job when it completes). All other fields are write-once.

2. **`total_recipients` is a convenience counter, not authoritative.** The ground truth count of recipients is always `SELECT COUNT(*) FROM notification_recipients WHERE notification_id = $1`. The `total_recipients` field is a denormalized cache for the admin panel's list view. Update it at the end of the fan-out job with `UPDATE notifications SET total_recipients = $count WHERE notification_id = $id`. Do not rely on it for billing or compliance calculations.

3. **`reference_type` + `reference_id` deep link pattern.** The frontend notification list renders each notification with a tap target. When tapped, the app reads `reference_type` and `reference_id` to navigate: `live_class` → live class detail screen; `mock_test` → test screen; `order` → order history. Document the full list of valid `reference_type` values as an application-level enum in the frontend codebase and keep it in sync with the dispatch service.

4. **`dispatched_at` is set by the dispatch service, not by the database default.** The database `created_at` records when the notification row was written (which may happen before the fan-out queue is triggered). The dispatch service sets `dispatched_at` explicitly when it begins processing: `UPDATE notifications SET dispatched_at = NOW() WHERE notification_id = $id`. This two-timestamp design allows monitoring for stalled notifications (rows where `created_at` is old but `dispatched_at` IS NULL).

5. **Retraction propagation.** When an admin sets `is_deleted = TRUE`, the frontend must hide the notification from all recipient inboxes immediately. Because `notification_recipients` rows are not deleted, the recommended approach is to use Supabase Realtime to broadcast the retraction event to connected clients, who then filter the notification from their local state. For offline-first mobile clients, include `WHERE n.is_deleted = FALSE` in all inbox queries.

---

## Table 3: `notification_recipients`

### Purpose

The junction table between `notifications` and `profiles`. One row per user per notification, created during the fan-out phase after the `notifications` row is written.

This is the highest-volume table in the Notifications domain and one of the highest-volume tables in the entire platform. At 100,000 students receiving one batch notification, 100,000 rows are inserted in a single fan-out operation. The schema must be lean, indexes must be selective, and writes must go through a queue — never directly from a synchronous API request.

Each row tracks exactly two pieces of per-recipient state: whether the user has read the notification (`is_read`) and when they read it (`read_at`). These are the only two fields that are ever updated after insertion.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `recipient_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key. Surrogate key to simplify FK references and Supabase RLS policies |
| `notification_id` | `UUID` | NOT NULL | — | FK → `notifications.notification_id`. The notification this row belongs to |
| `profile_id` | `UUID` | NOT NULL | — | FK → `profiles.profile_id`. The recipient. Uses `profile_id` (not `student_id` / `teacher_id`) because admins may also be notification recipients |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS enforcement and multi-tenant isolation. Ensures that even if `notification_id` leaks across tenants, RLS on `institute_id` prevents cross-tenant data access |
| `is_read` | `BOOLEAN` | NOT NULL | `FALSE` | Whether the recipient has read this notification. The only field updated by user action after INSERT |
| `read_at` | `TIMESTAMPTZ` | NULL | `NULL` | Timestamp when the recipient first read the notification. Set once when `is_read` is flipped to TRUE. Never updated after that — always reflects the first read time, not the most recent |
| `received_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Timestamp when this recipient row was inserted (i.e., when the fan-out job delivered to this recipient). Always UTC. Used for inbox ordering |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Row creation timestamp. Equivalent to `received_at` in most cases; kept separate per audit convention |

---

### Primary Key

```
PRIMARY KEY (recipient_id)
```

---

### Foreign Keys

```
notification_id → notifications.notification_id   ON DELETE CASCADE    ON UPDATE RESTRICT
profile_id      → profiles.profile_id             ON DELETE RESTRICT   ON UPDATE RESTRICT
institute_id    → institutes.institute_id          ON DELETE RESTRICT   ON UPDATE RESTRICT
```

> **`ON DELETE CASCADE` on `notification_id`:** When a notification is hard-deleted (data retention purge), all its recipient rows are automatically removed. This is correct — a recipient row for a non-existent notification is meaningless. Note that soft-delete (`is_deleted = TRUE`) does NOT trigger this cascade; only a physical DELETE does.

> **`ON DELETE RESTRICT` on `profile_id`:** A user profile cannot be physically deleted while it has unread notifications. The correct deactivation flow is: mark the profile `is_active = FALSE`, which hides it from all active lookups, then run a data retention job that cleans up recipient rows for deactivated users before hard-deleting the profile.

---

### Composite Keys

No composite PK. `recipient_id` is the surrogate primary key. The natural candidate `(notification_id, profile_id)` is enforced via a unique constraint.

---

### Unique Constraints

```
UNIQUE (notification_id, profile_id)
```

> Prevents duplicate delivery rows. The fan-out job must deduplicate its recipient list before insertion, but this constraint provides a hard guarantee at the database level. Use `ON CONFLICT (notification_id, profile_id) DO NOTHING` in the fan-out INSERT to make bulk inserts idempotent.

---

### CHECK Constraints

```
CHECK (
  (is_read = FALSE AND read_at IS NULL)
  OR
  (is_read = TRUE AND read_at IS NOT NULL)
)
```

> Ensures `is_read` and `read_at` are always in a consistent state. A notification cannot be marked read without a timestamp, and a timestamp cannot exist for an unread notification.

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_notif_recipients_profile_received` | `(profile_id, received_at DESC)` | B-tree | **Primary inbox query:** fetch all notifications for a user, newest first. The most critical query in this domain |
| `idx_notif_recipients_profile_unread` | `(profile_id, is_read)` WHERE `is_read = FALSE` | B-tree (partial) | Unread count badge: `SELECT COUNT(*) FROM notification_recipients WHERE profile_id = $1 AND is_read = FALSE`. Partial index on `is_read = FALSE` is dramatically smaller than a full index on the column |
| `idx_notif_recipients_notification_id` | `(notification_id)` | B-tree | Support FK constraint checks; admin query for all recipients of a specific notification |
| `idx_notif_recipients_institute_profile` | `(institute_id, profile_id, received_at DESC)` | B-tree | Multi-tenant safety: ensures all inbox queries include institute_id even when RLS is bypassed in migrations or service_role jobs |
| `idx_notif_recipients_notification_read` | `(notification_id, is_read)` | B-tree | Analytics query: how many recipients have read notification X? |

> **Partitioning note:** When `notification_recipients` exceeds 50 million rows (estimated: ~6 months at 100K active users with daily notifications), implement range partitioning by `received_at` (monthly partitions). Design all queries to include `received_at` range filters from Day 1 to ensure the partition pruning works when partitioning is eventually applied.

---

### Soft Delete Strategy

`notification_recipients` rows are **never soft-deleted at the recipient level**. The retraction mechanism is on the parent `notifications` table (`is_deleted = TRUE`). When a notification is retracted:

- The `notification_recipients` rows remain intact.
- All inbox queries filter `WHERE n.is_deleted = FALSE` via the view layer or application query.
- This preserves the delivery record for audit purposes while hiding the notification from the user inbox.

Physical deletion of `notification_recipients` rows happens only via:
1. CASCADE DELETE when the parent `notifications` row is hard-deleted (data retention purge).
2. A direct data retention job that purges recipient rows older than the configured retention window (e.g., 1 year) for deactivated user profiles.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `received_at` | ✅ | Business-level delivery timestamp; may differ from `created_at` by queue processing latency |
| `read_at` | ✅ | User interaction timestamp; key for engagement analytics |
| `updated_at` | ❌ | Only `is_read` and `read_at` are ever updated; maintaining a separate `updated_at` adds write overhead on every mark-as-read action across millions of rows. Omitted deliberately |
| `created_by` | ❌ | Always the fan-out service (service_role). No user attribution at recipient row level |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE notification_recipients | `RESTRICT` (no downstream FKs) | No tables reference this table |
| DELETE parent notification | `CASCADE` | Recipient rows are meaningless without the notification |
| DELETE profile | `RESTRICT` | Profile must be deactivated; data retention job cleans up recipient rows before hard delete |
| DELETE institute | `RESTRICT` | Cannot delete institute while recipient rows exist |
| UPDATE recipient_id | `RESTRICT` | PK must not change |

---

### Supabase RLS Considerations

```
Table: notification_recipients
RLS: ENABLED

SELECT:
  - Users (students, teachers, admins) may read only their own recipient rows.
    USING: profile_id = auth.uid()
      AND institute_id = get_my_institute_id()

  - This is the core inbox policy. Combined with the my_notifications view
    (defined in the notifications table RLS section), this gives each user a
    clean, isolated view of their notification inbox.

  - Admins may additionally read all recipient rows within their institute
    for delivery analytics and read-receipt reporting.
    USING: institute_id = get_my_institute_id()
      AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')

INSERT:
  - Blocked for all client roles. Written only by service_role (fan-out job).
  - This is critical: client-side INSERT into notification_recipients would allow
    users to inject arbitrary notifications into their own or others' inboxes.

UPDATE:
  - Users may update only their own recipient rows, and only the is_read column.
    USING: profile_id = auth.uid()
    WITH CHECK: profile_id = auth.uid()
      AND institute_id = get_my_institute_id()
  - Column-level restriction (only is_read and read_at may be updated) must be
    enforced at the application layer and via a Postgres trigger that rejects
    updates to any column other than is_read and read_at.

DELETE:
  - Blocked for all client roles.
```

---

### Backend Developer Notes

1. **Fan-out must be asynchronous and queued.** The sequence for sending a notification to 100,000 students must be: (a) INSERT one row into `notifications` synchronously in the API request, (b) enqueue a fan-out job to a message queue (Supabase Edge Functions + pg_notify, AWS SQS, BullMQ, etc.), (c) the job runs asynchronously and inserts `notification_recipients` rows in batches of 500–1,000 using `INSERT ... ON CONFLICT DO NOTHING`. Never block an API response on the fan-out write.

2. **Batch INSERT with ON CONFLICT for idempotency.** Fan-out jobs may be retried on failure. Use `INSERT INTO notification_recipients (...) VALUES (...), (...), ... ON CONFLICT (notification_id, profile_id) DO NOTHING` to make all fan-out inserts safe to retry without creating duplicates.

3. **Mark-as-read is a high-frequency write path.** Every time a user opens a notification, a `UPDATE notification_recipients SET is_read = TRUE, read_at = NOW() WHERE recipient_id = $1 AND is_read = FALSE` fires. At 100K users, this is a significant update volume. Optimise by: (a) using the `WHERE is_read = FALSE` condition to skip already-read rows (no-op on re-open), (b) debouncing on the client (only fire the UPDATE once per session, not on every scroll-past), (c) batch-updating with `WHERE profile_id = $1 AND is_read = FALSE` for "mark all as read" actions.

4. **Unread count must be cached.** The unread notification badge count (`SELECT COUNT(*) FROM notification_recipients WHERE profile_id = $1 AND is_read = FALSE`) must not run on every page load at scale. Cache this count in Supabase Realtime or a Redis/Upstash cache keyed by `profile_id`. Invalidate the cache when a new `notification_recipients` row is inserted for the user, or when a mark-as-read update fires.

5. **`received_at` vs `created_at` for inbox ordering.** Always order the inbox by `received_at DESC`, not `created_at DESC`. In the fan-out batch, all rows in one batch share the same `NOW()` for `created_at` (database transaction timestamp), but `received_at` can be set to the exact moment the fan-out job processed each recipient, giving more accurate ordering within the same batch. In practice, use `received_at` as the ORDER BY column and index accordingly.

6. **Data retention.** Notification recipient rows accumulate quickly. Implement a `pg_cron` job that runs weekly to: (a) hard-delete `notifications` rows (and cascade-delete their recipients) where `created_at < NOW() - INTERVAL '1 year'` and `is_deleted = TRUE`, (b) hard-delete `notification_recipients` rows for profiles where `is_active = FALSE` and `received_at < NOW() - INTERVAL '90 days'`. Define the retention window in `system_settings` (Domain 15) per institute.

---

## Domain 9 — Design Decisions Summary

| Decision | Choice | Reason |
|----------|--------|--------|
| Template content snapshot on `notifications` | `title` and `body` stored rendered at dispatch time | Decouples recipient experience from future template edits; immutable delivery record |
| Fan-out model | Queue-based async, not synchronous DB write | Synchronous fan-out to 100K rows in one request is not viable; queue absorbs burst |
| `notification_recipients` primary key | Surrogate UUID (`recipient_id`) | Simpler RLS policies and FK references than composite PK on `(notification_id, profile_id)` |
| Soft delete on `notifications` only | `is_deleted` flag on parent; recipient rows preserved | Retraction is a business action; recipient delivery records must be preserved for audit |
| No soft delete on `notification_recipients` | Rows preserved until hard-delete purge | Delivery receipt is an audit record; recipient-level retraction managed via parent flag |
| `institute_id` denormalized on `notification_recipients` | Added | Enables RLS to filter by tenant without joining through `notifications`; critical for multi-tenant isolation at scale |
| `is_read` + `read_at` CHECK constraint | Enforced in DB | Prevents inconsistent read state; a timing issue in the application layer cannot create a row with `is_read = TRUE` but `read_at = NULL` |
| `total_recipients` counter on `notifications` | Denormalized count | Avoids `COUNT(*)` on `notification_recipients` (potentially 100K rows) for every admin panel list query |
| Partial index on `is_read = FALSE` | Applied to `notification_recipients` | Unread notification queries are dramatically faster; the partial index is a fraction of the size of a full index |
| `reference_type` + `reference_id` polymorphic pair | Untyped text + UUID | Avoids separate FK columns per entity type; supports deep links without schema changes when new entity types are added |
| Channel defined at template and notification level | NOT at recipient level | One notification = one channel; multi-channel events create multiple notification rows. Simplifies delivery tracking |
| Partitioning | Deferred to future | Recommended when `notification_recipients` exceeds 50M rows; design queries with `received_at` filter from Day 1 |

---

## Domain 9 — Relationships to Other Domains

| This Table | References | Via Column | Domain |
|------------|-----------|------------|--------|
| `notification_templates` | `institutes` | `institute_id` | Domain 2 (Institute) |
| `notification_templates` | `profiles` | `created_by` | Domain 1 (Identity) |
| `notification_templates` | `profiles` | `updated_by` | Domain 1 (Identity) |
| `notifications` | `institutes` | `institute_id` | Domain 2 (Institute) |
| `notifications` | `notification_templates` | `template_id` | This domain |
| `notifications` | `profiles` | `triggered_by` | Domain 1 (Identity) |
| `notification_recipients` | `notifications` | `notification_id` | This domain |
| `notification_recipients` | `profiles` | `profile_id` | Domain 1 (Identity) |
| `notification_recipients` | `institutes` | `institute_id` | Domain 2 (Institute) |

| This Table | Referenced By | Via Column | Domain |
|------------|--------------|------------|--------|
| `notifications` | `notification_recipients` | `notification_id` | This domain |
| `notifications` | `audit_logs` | `resource_id` | Domain 15 (Administration) |
| `notification_templates` | `notifications` | `template_id` | This domain |

---

## Domain 9 — Entity Relationship Summary (Textual)

```
notification_templates (1) ─────────────────────── (M) notifications
                                                            │
                                                            │ (1:M)
                                                            │
                                              (M) notification_recipients
                                                            │
                                                            │ (M:1)
                                                            │
                                                     profiles (user inbox)
```

---

*Domain 9 — Notifications is complete.*
*Awaiting your approval before proceeding to the next domain.*
