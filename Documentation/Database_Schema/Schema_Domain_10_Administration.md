# EdTech Platform — Database Schema Specification
## Domain 10: Administration
### Tables: `audit_logs` · `system_settings`

**Document version:** 1.0
**ERD reference:** ERD v2.0 (Relationships R69–R70; Domain 15 — Administration)
**PostgreSQL target:** 16
**Supabase compatibility:** Yes
**Domain sequence:** Phase 10 of 15

---

## Domain Overview

The Administration domain is the governance and configuration layer of the platform. It serves two distinct but equally critical purposes:

- **`audit_logs`** — An immutable, append-only record of every significant action performed by any actor (admin, teacher, student, or system process) across the entire platform. This is the platform's compliance backbone and its primary debugging surface.
- **`system_settings`** — A per-institute, key-value configuration store that externalises business rules (thresholds, limits, toggles, retention windows) from application code. Changing a platform behaviour for an institute does not require a code deployment — it requires updating a setting row.

Together these two tables make the platform auditable, configurable, and operationally transparent without modifying any domain-level schema.

**Tables in this domain (in dependency order):**

| # | Table | Role | Write Pattern |
|---|-------|------|---------------|
| 1 | `audit_logs` | Append-only immutable event log of all actor actions | INSERT only — never UPDATE, never DELETE (until archival purge) |
| 2 | `system_settings` | Per-institute key-value configuration store | Admin-managed; low-frequency UPSERT |

---

## Key Architectural Principles for This Domain

**1. `audit_logs` is append-only — no exceptions.** No row in `audit_logs` is ever updated or deleted by application code. The only permitted deletion is a scheduled archival purge job that moves rows older than the configured retention window (default: 90 days) to cold storage (S3, BigQuery, or equivalent) and then hard-deletes them from the database. This principle must be enforced at the RLS layer — UPDATE and DELETE are blocked for all client roles, including admins.

**2. `audit_logs` is not a debug log — it is a compliance record.** Every row represents a business-significant action: a user created, a test published, a payment processed, a content item approved, a setting changed. Routine read operations (GET requests, dashboard loads) are NOT logged here. Only mutations and sensitive reads (e.g., admin viewing another user's profile) are audit-worthy. Volume discipline is essential — at 100K users, logging every request produces billions of rows and destroys query performance.

**3. `system_settings` is the configuration contract between backend and admin.** Every hardcoded threshold, limit, or toggle in the application codebase is a technical debt item. As each domain is built, its configurable parameters (e.g., `weak_chapter_accuracy_threshold`, `notification_retention_days`, `max_mock_attempts_per_day`) must be externalised to `system_settings`. The backend reads settings at runtime; the admin changes them via the settings panel without requiring a deployment.

**4. Multi-tenant isolation is absolute.** `audit_logs` rows carry `institute_id` and all queries from client roles are filtered to the caller's institute. An admin at Institute A cannot read audit logs from Institute B. This is enforced at the RLS layer, not just the application layer.

**5. `system_settings` rows are never deleted — only deactivated or overwritten.** Deleting a setting row could silently break a feature that reads it (the application would fall back to a hardcoded default, which may be wrong). Instead, settings are overwritten (UPSERT on `(institute_id, setting_key)`) or soft-deactivated with `is_active = FALSE`.

---

## Enum Types Referenced

| Enum Name | Values | Used By |
|-----------|--------|---------|
| `user_role_type` | `admin`, `teacher`, `student` | `audit_logs.actor_role` (denormalized) |

---

## New Enum Types Defined in This Domain

| Enum Name | Values | Used By | Reason |
|-----------|--------|---------|--------|
| `audit_action_type` | `create`, `update`, `delete`, `soft_delete`, `restore`, `publish`, `unpublish`, `approve`, `reject`, `login`, `logout`, `enroll`, `unenroll`, `purchase`, `refund`, `export`, `import`, `view_sensitive` | `audit_logs.action` | Enumerates every category of action that must be audit-logged. Using an enum instead of a free-text string enables structured filtering, analytics on action distribution, and prevents log pollution from inconsistent action naming across services |
| `setting_data_type` | `string`, `integer`, `decimal`, `boolean`, `json`, `uuid`, `date` | `system_settings.data_type` | Tells the application how to deserialize the `setting_value` string at runtime. All settings values are stored as TEXT; the `data_type` column is the schema contract for type-safe reading |

---

## Table 1: `audit_logs`

### Purpose

Stores an immutable, chronological record of every significant state-changing or security-sensitive action performed on the platform. Each row represents one discrete event: who did it, what they did, what entity they acted on, from which IP, and when.

This table is consumed by:

- **Admin compliance panel** — "Show me all actions performed by Teacher X in the last 30 days."
- **Security monitoring** — "Show me all login events from IP ranges outside India in the last 24 hours."
- **Debugging** — "Which admin changed the subscription plan for Student Y, and when?"
- **Data recovery** — "What was the state of Mock Test Z before it was soft-deleted?"

The `old_value` and `new_value` columns store a JSON snapshot of the entity's relevant fields before and after the action. For `create` actions, `old_value` is NULL. For `delete` actions, `new_value` is NULL. For `update` actions, both are populated with only the changed fields (not the full row — this reduces storage and makes diffs readable).

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `log_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. The institute context in which the action occurred. All queries are filtered by this column. Denormalized from the actor's profile for query performance and RLS enforcement |
| `profile_id` | `UUID` | NULL | `NULL` | FK → `profiles.profile_id`. The human actor who performed the action. NULL for system-initiated actions (background jobs, scheduled tasks, webhook callbacks) where there is no human actor |
| `actor_role` | `user_role_type` | NULL | `NULL` | Denormalized role of the actor at the time of the action (`admin`, `teacher`, `student`). NULL for system actors. Stored on the log row so that role-based audit filtering works even after the actor's role has changed |
| `action` | `audit_action_type` | NOT NULL | — | The category of action performed. Enum value from `audit_action_type` |
| `resource_type` | `TEXT` | NOT NULL | — | The entity type that was acted upon (e.g., `'profiles'`, `'mock_tests'`, `'live_classes'`, `'orders'`, `'system_settings'`, `'notification_templates'`). Matches the table name by convention. Free-text (not enum) to allow new entity types without schema migrations |
| `resource_id` | `UUID` | NULL | `NULL` | The UUID of the specific entity that was acted upon. NULL for actions that do not target a single entity (e.g., bulk exports, login events where the resource is the session rather than a row) |
| `old_value` | `JSONB` | NULL | `NULL` | JSON snapshot of the relevant fields of the entity **before** the action. NULL for `create` and `login` actions. Contains only changed fields for `update` actions — not the full row |
| `new_value` | `JSONB` | NULL | `NULL` | JSON snapshot of the relevant fields of the entity **after** the action. NULL for `delete`, `soft_delete`, and `logout` actions. Contains only new field values for `update` actions |
| `ip_address` | `INET` | NULL | `NULL` | The IP address of the client that initiated the request. NULL for server-side / background job actions. Uses PostgreSQL `INET` type for native IP validation and CIDR range queries |
| `user_agent` | `TEXT` | NULL | `NULL` | The HTTP User-Agent header from the client request. NULL for server-side actions. Useful for security investigation (identify bot traffic, detect credential stuffing from headless browsers) |
| `session_id` | `TEXT` | NULL | `NULL` | The Supabase Auth session ID associated with this action. Allows grouping all actions from a single login session. NULL for background jobs |
| `metadata` | `JSONB` | NULL | `NULL` | Freeform additional context that does not fit the standard columns (e.g., bulk action item count, export format, search query that led to a sensitive view). Schema is action-dependent and documented per action type in the backend service |
| `performed_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Timestamp when the action was performed. Always UTC. This is the primary ordering and filtering column — all audit log queries include a time range on this column |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Row insertion timestamp. Equivalent to `performed_at` in most cases; kept separate per audit convention. If a log row is written slightly after the action (e.g., via async post-request hook), `performed_at` reflects the action time and `created_at` reflects the write time |

---

### Primary Key

```
PRIMARY KEY (log_id)
```

---

### Foreign Keys

```
institute_id → institutes.institute_id   ON DELETE RESTRICT   ON UPDATE RESTRICT
profile_id   → profiles.profile_id       ON DELETE SET NULL   ON UPDATE RESTRICT
```

> **`ON DELETE RESTRICT` on `institute_id`:** An institute cannot be hard-deleted while audit log rows reference it. Institute decommissioning must include an archival step that exports and purges audit logs first.

> **`ON DELETE SET NULL` on `profile_id`:** If a user profile is hard-deleted (only after data retention purge), the audit log rows they generated are preserved with `profile_id = NULL`. The log record of their actions must never be erased — only the attribution link degrades. The `actor_role` denormalization ensures role-based filtering still works after the profile is gone.

> **`resource_id` is NOT a FK-constrained column.** It is a polymorphic UUID reference — the table it points to is determined by `resource_type`. PostgreSQL cannot enforce FK constraints on polymorphic references without triggers. Referential integrity for `resource_id` is not enforced at the database level; it is the responsibility of the logging service to write the correct UUID.

---

### Composite Keys

None. `log_id` is the sole primary key.

---

### Unique Constraints

None. Audit log rows are not unique in any business sense. The same actor may perform the same action on the same resource multiple times (e.g., edit a test twice), and each event is a distinct, valid row.

---

### CHECK Constraints

```
CHECK (char_length(resource_type) >= 1 AND char_length(resource_type) <= 100)
CHECK (
  (action IN ('create', 'login') AND old_value IS NULL)
  OR (action NOT IN ('create', 'login'))
)
CHECK (
  (action IN ('delete', 'soft_delete', 'logout') AND new_value IS NULL)
  OR (action NOT IN ('delete', 'soft_delete', 'logout'))
)
CHECK (
  profile_id IS NOT NULL OR actor_role IS NULL
)
```

> **CHECK constraint rationale:**
> - The `old_value IS NULL` constraint for `create` / `login` actions enforces the data model convention: there is no "before state" when an entity is first created.
> - The `new_value IS NULL` constraint for `delete` / `soft_delete` / `logout` enforces: there is no "after state" for a deletion or logout event.
> - The `actor_role IS NULL` when `profile_id IS NULL` enforces that a role cannot be attributed without an identified actor.

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_audit_logs_institute_performed_at` | `(institute_id, performed_at DESC)` | B-tree | **Primary query pattern:** admin audit log list, filtered by institute, ordered newest first. All admin audit queries must include `institute_id` |
| `idx_audit_logs_profile_performed_at` | `(profile_id, performed_at DESC)` | B-tree | Actor-specific audit trail: "show all actions by this user" |
| `idx_audit_logs_resource` | `(resource_type, resource_id, performed_at DESC)` | B-tree | Entity-specific audit trail: "show all actions on Mock Test X" — the deep-link audit view from any entity's detail page |
| `idx_audit_logs_institute_action` | `(institute_id, action, performed_at DESC)` | B-tree | Action-type filter: "show all `publish` events in this institute this week" |
| `idx_audit_logs_institute_actor_role` | `(institute_id, actor_role, performed_at DESC)` | B-tree | Role-scoped audit: "show all teacher actions in the last 7 days" |
| `idx_audit_logs_ip_address` | `(ip_address, performed_at DESC)` | B-tree | Security investigation: "show all actions from this IP" — CIDR range queries supported natively by PostgreSQL `INET` type with this index |
| `idx_audit_logs_old_value_gin` | `USING GIN (old_value)` | GIN | JSONB containment search: "find all audit rows where old_value contained status = 'published'" — used by compliance and data recovery queries |
| `idx_audit_logs_new_value_gin` | `USING GIN (new_value)` | GIN | JSONB containment search on new_value for post-action state queries |

> **Partitioning note (mandatory, not deferred):** `audit_logs` is one of the two highest-growth tables on the platform (alongside `notification_recipients`). At 100K active users performing an average of 10 auditable actions per day, this table grows by 1 million rows per day — 365 million rows per year. **Implement range partitioning by `performed_at` (monthly partitions) before go-live.** All queries already include `performed_at` range filters, so partition pruning will be maximally effective from Day 1. The ERD scalability notes (v2, note 2) explicitly require: "Archive to cold storage after 90 days."

---

### Soft Delete Strategy

`audit_logs` has **no soft delete**. Audit log rows are immutable records of fact. They cannot be deactivated, hidden, or marked as deleted. The only permitted removal mechanism is the archival purge job:

1. Export rows where `performed_at < NOW() - INTERVAL '{retention_days} days'` to cold storage (S3 Parquet, BigQuery, etc.).
2. Verify the export is complete and checksummed.
3. Hard-DELETE the exported rows from the PostgreSQL table.

The retention window is configurable per institute via `system_settings` with key `audit_log_retention_days` (default: `90`).

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `performed_at` | ✅ | The authoritative timestamp of the action. Used for all ordering and time-range filtering |
| `created_at` | ✅ | Row insertion timestamp; may differ from `performed_at` by async write latency |
| `updated_at` | ❌ | Audit log rows are never updated. Including `updated_at` would be misleading |
| `created_by` | ❌ | The `profile_id` column serves this purpose. No separate `created_by` field needed |

> **Note:** `audit_logs` is itself an audit table. It does not need to be audited. Do not create audit log entries for INSERT actions on the `audit_logs` table — this creates an infinite loop and has no compliance value.

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE audit_logs row | No downstream cascade (no tables reference this) | Audit rows are leaf nodes |
| DELETE institute | `RESTRICT` | Cannot delete institute while audit logs exist; archival must run first |
| DELETE profile | `SET NULL` on `profile_id` | Log record preserved; actor attribution degrades to NULL |
| UPDATE log_id | `RESTRICT` | PK must not change |
| UPDATE any other column | Not permitted (application layer + RLS) | Audit logs are immutable |

---

### Supabase RLS Considerations

```
Table: audit_logs
RLS: ENABLED

SELECT:
  - Admins may read all audit_logs rows within their institute.
    USING: institute_id = get_my_institute_id()
      AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')

  - Teachers may read audit_logs rows where profile_id = their own profile.
    (They can view their own action history, not others'.)
    USING: profile_id = auth.uid()
      AND institute_id = get_my_institute_id()

  - Students: no SELECT access to audit_logs. Students do not have an audit
    history view in v1. If required in future, implement a separate
    student_activity_log table with appropriate fields.

INSERT:
  - Blocked for all client roles.
  - Written exclusively by the backend logging service using service_role.
  - Client-side INSERT into audit_logs would allow actors to falsify their
    own audit trail. This must be blocked at the RLS layer, not just the
    application layer.

UPDATE:
  - Blocked for ALL roles including admin.
  - Audit log immutability is a compliance requirement. No role may alter a
    log row after it is written, including service_role in normal operation.
  - If a correction is ever needed (e.g., a system bug wrote incorrect data),
    the fix is to INSERT a corrective log row with action = 'create' and
    metadata documenting the correction — not to UPDATE the original row.

DELETE:
  - Blocked for all client roles including admin.
  - Hard deletes are performed only by the archival purge job running as
    service_role, and only after a verified export to cold storage.
```

---

### Backend Developer Notes

1. **Write audit logs asynchronously, after the main transaction commits.** The audit log write must never be in the same database transaction as the action it records. If the action transaction rolls back, a committed audit row for a rolled-back action is a false record — worse than no record. Write audit rows in a post-commit hook, a Supabase Edge Function, or via a `pg_notify` → queue → INSERT pipeline. Accept that a tiny fraction of audit rows may be lost in the event of a crash between commit and log write. This is the correct tradeoff.

2. **Only log the changed fields in `old_value` / `new_value`, not the full row.** For an `update` action on a `profiles` row, if only `avatar_url` changed, `old_value` should be `{"avatar_url": "https://old.url"}` and `new_value` should be `{"avatar_url": "https://new.url"}`. Logging the full row on every update wastes storage and makes diffs unreadable. The logging service must diff the before/after state and write only changed keys.

3. **`resource_type` must match the table name exactly.** Enforce this convention strictly in the logging service. Use the PostgreSQL table name (snake_case plural) as the `resource_type` value (e.g., `'mock_tests'` not `'MockTest'`, `'live_classes'` not `'LiveClass'`). This convention enables the admin panel to construct the correct deep link: `/{resource_type}/{resource_id}`.

4. **Login and logout events have no `resource_id`.** For `action = 'login'` or `action = 'logout'`, set `resource_type = 'auth_sessions'` and `resource_id = NULL`. Log `session_id` in the `session_id` column. The `metadata` column may include the authentication method (e.g., `{"method": "email", "provider": "supabase"}`).

5. **Implement partitioning before launch, not after.** The cost of partitioning an existing 100M-row table is enormous (full table lock, hours of downtime, or a complex live migration). Use declarative range partitioning on `performed_at` from Day 1. Create monthly partitions for the next 12 months at launch and automate partition creation 3 months in advance via `pg_cron`.

6. **Cold storage export format.** Export to Apache Parquet (columnar format) partitioned by `institute_id` and `performed_at` month. Store in S3 with a predictable key pattern: `audit_logs/institute_{id}/year={YYYY}/month={MM}/part-{n}.parquet`. This enables efficient replay and compliance queries against cold data using Athena, BigQuery, or Redshift Spectrum without importing back into PostgreSQL.

7. **`view_sensitive` action type.** When an admin views a student's PII (phone number, date of birth, payment details), log it with `action = 'view_sensitive'`, `resource_type = 'profiles'` (or `'orders'`, etc.), and `resource_id` = the viewed entity's ID. This is required for GDPR Article 15 compliance (the right to know who has accessed your data).

---

## Table 2: `system_settings`

### Purpose

Stores per-institute configuration key-value pairs that govern platform behaviour. Every business rule that might need to vary between institutes, or that a platform admin might need to change without a code deployment, is stored here.

`system_settings` is the runtime configuration contract between the backend services and the administrative layer. When the backend reads a setting, it does so at request time (with caching) — not at build time. This means behaviour changes take effect immediately after an admin updates a setting, without restarts or deployments.

Examples of settings stored here:

| `setting_key` | `setting_value` | `data_type` | Purpose |
|---|---|---|---|
| `weak_chapter_accuracy_threshold` | `40` | `integer` | % accuracy below which a chapter is flagged as weak in Analytics |
| `max_mock_attempts_per_day` | `5` | `integer` | Daily attempt cap per student per test |
| `notification_retention_days` | `365` | `integer` | How long notification_recipients rows are kept |
| `audit_log_retention_days` | `90` | `integer` | Audit log archival window |
| `live_class_reminder_minutes` | `10` | `integer` | Minutes before class start to trigger reminder notification |
| `subscription_expiry_warning_days` | `7` | `integer` | Days before expiry to send subscription warning notification |
| `max_batch_students` | `200` | `integer` | Maximum students per batch |
| `allow_student_self_enroll` | `false` | `boolean` | Whether students can enroll themselves in batches |
| `invoice_prefix` | `INV` | `string` | Prefix for auto-generated invoice numbers |
| `institute_timezone` | `Asia/Kolkata` | `string` | Timezone for scheduling and display |
| `currency_code` | `INR` | `string` | Default currency for orders and payments |
| `strong_chapter_accuracy_threshold` | `80` | `integer` | % accuracy above which a chapter is flagged as strong |
| `suggested_tests_max_count` | `5` | `integer` | Maximum number of tests in performance_reports.suggested_tests |
| `pyq_download_enabled` | `true` | `boolean` | Whether students can download PYQ PDFs |

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `setting_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. The institute this setting belongs to. Every institute has its own copy of each setting, allowing different institutes to have different values for the same key |
| `setting_key` | `TEXT` | NOT NULL | — | The machine-readable name of the setting, in `snake_case`. Used by backend services to look up the setting at runtime. Must be stable — changing a key name breaks all code that references it. Examples: `weak_chapter_accuracy_threshold`, `max_batch_students` |
| `setting_value` | `TEXT` | NOT NULL | — | The setting's value, always stored as TEXT regardless of the logical data type. The backend service casts to the correct type using `data_type`. For `boolean` settings, store as `'true'` or `'false'`. For `json` settings, store as a valid JSON string |
| `data_type` | `setting_data_type` | NOT NULL | — | The logical type of `setting_value`. Tells the backend how to deserialize. Enum: `string`, `integer`, `decimal`, `boolean`, `json`, `uuid`, `date` |
| `display_name` | `TEXT` | NOT NULL | — | Human-readable label shown in the admin settings panel (e.g., `"Weak Chapter Accuracy Threshold (%)"`, `"Maximum Students Per Batch"`). Not used by backend logic — for UI only |
| `description` | `TEXT` | NULL | `NULL` | Longer explanation of what this setting controls and the impact of changing it. Shown as tooltip or help text in the admin panel. Helps admins make informed changes without consulting developers |
| `category` | `TEXT` | NOT NULL | `'general'` | Grouping key for the admin settings panel UI. Examples: `'analytics'`, `'notifications'`, `'commerce'`, `'live_classes'`, `'content'`, `'general'`. Free-text to allow new categories without schema changes |
| `is_active` | `BOOLEAN` | NOT NULL | `TRUE` | Soft delete / disable flag. An inactive setting is ignored by the backend (which falls back to the hardcoded default). Used to temporarily disable a setting without deleting it |
| `is_system` | `BOOLEAN` | NOT NULL | `FALSE` | If TRUE, this is a platform-level setting seeded at install time and should not be deletable or renameable by institute admins. If FALSE, it is an institute-custom setting that the admin created. System settings are protected from DELETE in RLS |
| `updated_by` | `UUID` | NULL | `NULL` | FK → `profiles.profile_id`. The admin who last changed this setting's value. NULL for system-seeded settings not yet modified by any admin |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Row creation timestamp. Always UTC |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Last modification timestamp. Trigger-maintained. The most important audit field for settings — when was this last changed? |

---

### Primary Key

```
PRIMARY KEY (setting_id)
```

---

### Foreign Keys

```
institute_id → institutes.institute_id   ON DELETE RESTRICT   ON UPDATE RESTRICT
updated_by   → profiles.profile_id       ON DELETE SET NULL   ON UPDATE RESTRICT
```

> **`ON DELETE RESTRICT` on `institute_id`:** An institute cannot be deleted while it has system settings rows. Settings must be archived or purged as part of the institute decommissioning workflow before the institute row can be removed.

> **`ON DELETE SET NULL` on `updated_by`:** If the admin who last modified a setting is deactivated, the attribution degrades to NULL. The setting value itself is unaffected.

---

### Composite Keys

No composite PK. The natural candidate `(institute_id, setting_key)` is enforced via a unique constraint below, keeping FK references to this table simple if needed in future.

---

### Unique Constraints

```
UNIQUE (institute_id, setting_key)
```

> This is the operational key for all runtime lookups. Backend services query `WHERE institute_id = $1 AND setting_key = $2`. The UNIQUE constraint is also the UPSERT target: `ON CONFLICT (institute_id, setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_by = excluded.updated_by, updated_at = NOW()`.

---

### CHECK Constraints

```
CHECK (char_length(setting_key) >= 1 AND char_length(setting_key) <= 200)
CHECK (setting_key ~ '^[a-z][a-z0-9_]*$')
CHECK (char_length(setting_value) >= 1)
CHECK (char_length(display_name) >= 1 AND char_length(display_name) <= 300)
CHECK (char_length(category) >= 1 AND char_length(category) <= 100)
CHECK (
  data_type != 'boolean'
  OR setting_value IN ('true', 'false')
)
CHECK (
  data_type != 'integer'
  OR setting_value ~ '^-?[0-9]+$'
)
CHECK (
  data_type != 'decimal'
  OR setting_value ~ '^-?[0-9]+(\.[0-9]+)?$'
)
```

> **CHECK constraint rationale:**
> - The `setting_key` regex enforces `snake_case` format: starts with a lowercase letter, contains only lowercase letters, digits, and underscores. This guarantees key names are consistent and machine-readable.
> - The `boolean` and `integer` / `decimal` CHECK constraints provide lightweight validation that the `setting_value` string is consistent with its declared `data_type`. They catch admin panel bugs where the wrong value type is submitted before the row is committed.

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_system_settings_institute_key` | `(institute_id, setting_key)` | B-tree (covered by UNIQUE) | **Primary runtime lookup:** backend reads a specific setting by institute + key. Already covered by the unique constraint index |
| `idx_system_settings_institute_category` | `(institute_id, category, is_active)` | B-tree | Admin panel: fetch all settings for an institute grouped by category, filtered to active only |
| `idx_system_settings_institute_active` | `(institute_id, is_active)` | B-tree (partial: `WHERE is_active = TRUE`) | Runtime bulk fetch: load all active settings for an institute into the application cache on startup |

> **Caching note:** `system_settings` is a prime candidate for application-level caching. Backend services should cache the full settings map for each institute in memory or Redis on startup and on each admin update event (via Supabase Realtime or a cache invalidation webhook). Without caching, a setting lookup on every request adds a round-trip to the database for every API call. The cache TTL should be short (30–60 seconds) to ensure setting changes propagate quickly.

---

### Soft Delete Strategy

`is_active = FALSE` is the soft delete mechanism. An inactive setting:

- Is not returned by backend runtime lookups (all queries filter `WHERE is_active = TRUE`).
- Is visible in the admin settings panel with an "Inactive" badge.
- Is never physically deleted — the setting history (via `updated_at` and `updated_by`) is a configuration audit trail.

Physical DELETE is blocked for all client roles via RLS. Only `service_role` may hard-delete setting rows, and only as part of an institute decommissioning workflow.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `updated_at` | ✅ | Trigger-maintained; the most important field — when was this setting last changed? |
| `updated_by` | ✅ | Which admin changed the setting value. Critical for compliance — if a threshold change caused a downstream issue, who changed it and when? |
| `created_by` | ❌ | System-seeded settings have no human creator. For admin-created settings, `updated_by` captures the creator on first write |
| `deleted_at` | ❌ | `is_active` flag is sufficient; settings are never hard-deleted in normal operation |

> **Important:** Every change to `system_settings` (specifically any `UPDATE` to `setting_value`) must also generate a row in `audit_logs` with `action = 'update'`, `resource_type = 'system_settings'`, `resource_id = setting_id`, `old_value = {"setting_value": "<previous>"}`, and `new_value = {"setting_value": "<new>"}`. Settings changes are among the most impactful admin actions on the platform — they must be fully auditable. This audit INSERT is the responsibility of the backend service (or a Postgres trigger on `system_settings`) — not the frontend.

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE system_settings row | No downstream cascade (no tables reference this) | Settings are leaf nodes in the dependency graph |
| DELETE institute | `RESTRICT` | Cannot delete institute while it owns settings rows |
| DELETE admin (updated_by) | `SET NULL` | Attribution degrades gracefully; setting value is unaffected |
| UPDATE setting_id | `RESTRICT` | PK must not change |
| UPDATE setting_key | Not permitted after creation (application layer) | Changing a key name breaks all code that references it. If a rename is needed, create a new row with the new key, migrate all references, then deactivate the old row |

---

### Supabase RLS Considerations

```
Table: system_settings
RLS: ENABLED

SELECT:
  - Admins may read all settings for their institute.
    USING: institute_id = get_my_institute_id()
      AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')

  - Backend services (service_role) may read all settings without restriction.
    This is how the runtime setting lookup works — the backend uses service_role
    to bypass RLS and load the full settings map for an institute into cache.

  - Teachers and Students: no direct SELECT access to system_settings.
    Settings values may be surfaced to the frontend indirectly where needed
    (e.g., "maximum attempts per day" shown on the test screen) via a
    dedicated API endpoint that reads the setting server-side and returns
    only the specific value — never the full settings table.

INSERT:
  - Admins may insert new non-system settings for their institute.
    WITH CHECK: institute_id = get_my_institute_id()
      AND is_system = FALSE
      AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')

  - System settings (is_system = TRUE) are INSERT-only via service_role during
    platform seeding. Client-side INSERT of system settings is blocked.

UPDATE:
  - Admins may update setting_value, display_name, description, category,
    and is_active for settings in their institute.
    USING: institute_id = get_my_institute_id()
    WITH CHECK: institute_id = get_my_institute_id()
      AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')

  - The setting_key and data_type columns must not be mutable post-creation.
    Enforce this at the application layer (only allow updates to specific
    columns) and via a Postgres trigger that rejects updates to setting_key
    or data_type after the row is created.

  - is_system = TRUE settings: setting_value may be updated by admins, but
    setting_key, data_type, and is_system may not. Enforce via trigger.

DELETE:
  - Blocked for all client roles.
  - Only service_role may hard-delete setting rows, and only as part of the
    institute decommissioning workflow.
```

---

### Backend Developer Notes

1. **Seed system settings at platform install time, not at runtime.** Provide a migration seed script (not a `CREATE TABLE` — the schema spec says no SQL — but a seeded data job) that INSERTs all system-level settings with `is_system = TRUE` for every new institute when it is provisioned. When a new institute is created, a Supabase Edge Function should copy all system template settings into the new institute's `system_settings` rows. Never rely on a setting existing without explicitly seeding it.

2. **Backend runtime lookup pattern.** The correct pattern is: on application startup (or on cache miss), load all `system_settings` rows where `institute_id = $1 AND is_active = TRUE` into a key-value map in Redis or in-process memory. All subsequent reads are `cache.get(institute_id, setting_key)`. Invalidate the cache when `system_settings` is updated via Supabase Realtime (subscribe to `UPDATE` events on the table) or via a short TTL (30–60 seconds). Never query `system_settings` on every request — this turns a cache table into a query hotspot.

3. **Type casting is the backend's responsibility.** The database stores all values as TEXT. The backend service must cast `setting_value` to the correct type based on `data_type` before using it:
   - `integer` → `parseInt(value, 10)` with range validation
   - `decimal` → `parseFloat(value)` with range validation
   - `boolean` → `value === 'true'`
   - `json` → `JSON.parse(value)` in a try/catch
   - `uuid` → validate as UUID format before use
   - `date` → parse as ISO 8601 date
   The `data_type` CHECK constraints in the database provide a first line of defence, but the backend must still validate after parsing.

4. **Never hardcode a business threshold in application code.** Every value that an admin might want to change (accuracy thresholds, retry limits, reminder timings, retention windows) must live in `system_settings`. Before hardcoding any constant in the backend, ask: "Could an institute admin ever want this to be different?" If yes, it belongs in `system_settings`. Common candidates missed by developers: file upload size limits, session timeout durations, pagination page sizes, export row limits.

5. **`setting_key` changes are breaking changes.** If a setting key must be renamed, the migration process is: (1) INSERT a new row with the new key and the same value, (2) deploy the new backend code that reads the new key, (3) deactivate (`is_active = FALSE`) the old key, (4) in a future release, clean up the old row. Never rename a key in-place — all code reading the old key will break immediately.

6. **Expose a settings preview endpoint for admins.** The admin panel should include a "Preview effect" button next to configurable numeric thresholds. For example, changing `weak_chapter_accuracy_threshold` from `40` to `50` should show the admin a preview count: "This change would reclassify 1,243 student-chapter pairs from strong to weak." This requires a read-only query against `chapter_performances` — implement it as a Supabase RPC function that reads the current data and returns the impact count without committing any changes.

---

## Domain 10 — Design Decisions Summary

| Decision | Choice | Reason |
|----------|--------|--------|
| `audit_logs` write pattern | Append-only INSERT; never UPDATE or DELETE (except archival purge) | Immutable compliance record; legal and GDPR requirement |
| `audit_logs` scope | Significant mutations and sensitive reads only; NOT all HTTP requests | Volume discipline; at 100K users, logging every request is operationally unviable and creates noise that obscures genuine compliance events |
| `old_value` / `new_value` content | Changed fields only (diff), not full row snapshot | Storage efficiency; readability; full row snapshots bloat JSONB columns and make diffs unreadable |
| `profile_id` ON DELETE | `SET NULL` | Actor deactivation must not erase audit history; attribution degrades gracefully |
| `resource_type` as TEXT (not enum) | Free-text matching table name | New entity types can be added without schema migration; `resource_type` is for human reference, not relational integrity |
| `ip_address` PostgreSQL type | `INET` | Native IP validation; supports CIDR range queries (`>>=`, `<<=`) without string parsing — essential for security monitoring |
| Partitioning on `audit_logs` | Monthly range by `performed_at` — **mandatory before launch** | 1M+ rows/day at scale; partitioning is the only viable long-term storage strategy |
| Cold storage archival window | 90 days (configurable via `system_settings`) | ERD v2 scalability note 2 explicit requirement; keeps PostgreSQL table size bounded |
| `system_settings` value type | All values as `TEXT` + `data_type` enum | Avoids nullable multi-type columns; single column to index and query; type safety enforced at application layer |
| `setting_key` format | `snake_case` enforced via CHECK regex | Consistency across all backend services; prevents key name collisions from inconsistent casing |
| `system_settings` caching | Application-level cache (Redis / in-process); invalidated via Realtime | Avoids per-request DB round-trip for configuration reads; settings are read far more often than they are written |
| `is_system` flag on settings | Boolean column | Protects platform-seeded settings from accidental admin deletion or key renaming while still allowing value edits |
| Setting change audit | Every `setting_value` UPDATE generates an `audit_logs` row | Configuration changes are among the highest-impact admin actions; must be fully traceable |
| `system_settings` DELETE policy | Blocked for all client roles; `is_active = FALSE` is the deactivation path | Prevents accidental breakage of features that read a setting; preserves configuration history |

---

## Domain 10 — Relationships to Other Domains

| This Table | References | Via Column | Domain |
|------------|-----------|------------|--------|
| `audit_logs` | `institutes` | `institute_id` | Domain 2 (Institute) |
| `audit_logs` | `profiles` | `profile_id` | Domain 1 (Identity) |
| `system_settings` | `institutes` | `institute_id` | Domain 2 (Institute) |
| `system_settings` | `profiles` | `updated_by` | Domain 1 (Identity) |

| This Table | Referenced By | Via Column | Domain |
|------------|--------------|------------|--------|
| `audit_logs` | No tables (leaf node) | — | — |
| `system_settings` | No tables (read by backend services, not FK-referenced) | — | — |

> **Cross-domain write dependency:** Every domain in this platform generates rows in `audit_logs`. The `resource_type` column maps to every table across all 15 domains. This is a one-way dependency — `audit_logs` references other domains' UUIDs via `resource_id`, but no other domain has an FK into `audit_logs`. This ensures that `audit_logs` is a pure downstream consumer and its existence never blocks any upstream domain operation.

> **Cross-domain read dependency:** `system_settings` is read by every domain that has configurable behaviour: Analytics (accuracy thresholds), Notifications (retention windows, reminder timings), Mock Test Engine (attempt limits), Live Learning (reminder lead time), Commerce (currency, invoice prefix). No other domain has an FK into `system_settings` — they read it at runtime via the application cache.

---

## Domain 10 — Entity Relationship Summary (Textual)

```
institutes (1) ──────────────────────────── (M) audit_logs
                                                     │
                                              (M:1) profiles
                                              (actor)

institutes (1) ──────────────────────────── (M) system_settings
                                                     │
                                              (M:1) profiles
                                              (updated_by)

audit_logs ◄──── written by ────── ALL domains (via backend logging service)
                                   resource_type = table name
                                   resource_id   = entity UUID

system_settings ◄──── read by ─── ALL domains (via application cache)
                                   lookup: institute_id + setting_key
```

---

*Domain 10 — Administration is complete.*
*Awaiting your approval before proceeding to the next domain.*
