# EdTech Platform — Database Schema Specification
## Domain 15: Infrastructure & Operations
### Tables: `api_keys` · `webhook_endpoints` · `webhook_delivery_logs` · `async_jobs` · `feature_flags` · `feature_flag_overrides` · `system_events_outbox`

**Document version:** 1.0
**ERD reference:** Platform Architecture Extensions (Infrastructure)
**PostgreSQL target:** 16
**Supabase compatibility:** Yes
**Domain sequence:** Phase 15 of 15

---

## Domain Overview

This domain handles the "invisible" meta-operations of the platform. It does not store student data or educational content; instead, it ensures the platform runs smoothly, integrates with external systems securely, and recovers gracefully from failures.

Key capabilities provided:
- **API Security:** Issuing and tracking programmatic access (`api_keys`).
- **Event Driven Integrations:** Sending real-time updates to external ERPs or CRMs (`webhooks`).
- **Job Queues:** A robust application-level queue for everything from generating PDF reports to running `file_cleanup_jobs` (`async_jobs`).
- **Feature Management:** Safely rolling out new features (like a new Mock Test engine) to specific institutes before a global launch (`feature_flags`).
- **Data Consistency:** Using the Transactional Outbox pattern to reliably trigger `cache_invalidation` and cross-service messaging (`system_events_outbox`).

*Note on `cron_jobs`:* Supabase provides `pg_cron` natively in the `cron` schema. However, we use `async_jobs` to track the actual application-level execution, retries, and failures of those scheduled tasks.

---

## New Enum Types Defined in This Domain

| Enum Name | Values | Used By | Reason |
|-----------|--------|---------|--------|
| `job_status_type` | `queued`, `processing`, `completed`, `failed`, `retrying`, `cancelled` | `async_jobs.status` | State machine for background workers. |
| `webhook_status_type` | `pending`, `success`, `failed`, `retrying` | `webhook_delivery_logs.status` | Tracks outbound HTTP requests. |
| `outbox_status_type` | `pending`, `published`, `failed` | `system_events_outbox.status` | State machine for cache invalidation / event bus bridging. |

---

## Table 1: `api_keys`

### 1. Purpose
Allows Institutes or internal microservices to generate programmatic access tokens. This enables integrations with third-party HR systems, ERPs, or custom BI dashboards. **Crucially, raw keys are never stored—only their hashes.**

### 2–5. Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `key_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key. |
| `institute_id` | `UUID` | NULL | `NULL` | FK → `institutes.institute_id`. NULL if it's a global platform-level key. |
| `name` | `TEXT` | NOT NULL | — | Identifier (e.g., "Zapier Integration", "ERP Sync"). |
| `key_prefix` | `TEXT` | NOT NULL | — | The first 8 chars of the raw key (e.g., `edtech_live_a1b2...`) for UI identification. |
| `key_hash` | `TEXT` | NOT NULL | — | SHA-256 hash of the full raw key. Used for authentication validation. |
| `scopes` | `TEXT[]` | NOT NULL | `'{ "read_only" }'` | Array of permissions (e.g., `['read:students', 'write:attendance']`). |
| `expires_at` | `TIMESTAMPTZ` | NULL | `NULL` | Optional expiration date for security rotation. |
| `last_used_at` | `TIMESTAMPTZ` | NULL | `NULL` | Updated periodically when the key is utilized. |
| `is_active` | `BOOLEAN` | NOT NULL | `TRUE` | Quick toggle to revoke access without deleting the record. |
| `created_by` | `UUID` | NULL | `NULL` | FK → `profiles.profile_id`. The admin who generated it. |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Record creation timestamp. |

### 6. Primary Key
`PRIMARY KEY (key_id)`

### 7. Foreign Keys
* `institute_id → institutes.institute_id (ON DELETE CASCADE ON UPDATE RESTRICT)`
* `created_by → profiles.profile_id (ON DELETE SET NULL ON UPDATE RESTRICT)`

### 8. Composite Keys
None.

### 9. Unique Constraints
* `UNIQUE (key_hash)`: Prevents hash collisions.

### 10. CHECK Constraints
* `CHECK (char_length(name) > 0)`
* `CHECK (char_length(key_prefix) >= 4)`

### 11. Recommended Indexes
* `idx_api_keys_institute` `(institute_id, is_active)`: Dashboard listing for admins.
* `idx_api_keys_hash` `(key_hash)`: The critical lookup index for the API gateway middleware.

### 12. Soft Delete Strategy
`is_active = FALSE`. API keys are soft-deleted to preserve historical audit logs of who created/used them.

### 13. Audit Fields
* `created_at`, `last_used_at`, `created_by`.

### 14. Cascade Rules
* DELETE `institutes`: CASCADE (If an institute leaves, their API access vanishes instantly).

### 15. Supabase RLS Considerations
* **Admins:** `SELECT`, `INSERT`, `UPDATE` (to revoke) for their `institute_id`.
* **Teachers/Students:** Blocked.
* **Service Role:** `ALL` for middleware validation.

### 16. Notes for Backend Developers
* The raw key is generated in the backend, hashed, inserted into the DB, and then the raw key is returned to the user **exactly once**. If they lose it, they must roll a new key.

---

## Table 2: `webhook_endpoints`

### 1. Purpose
Stores the destination URLs where external systems want to be notified about platform events (e.g., `student.enrolled`, `payment.succeeded`).

### 2–5. Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `endpoint_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key. |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. |
| `url` | `TEXT` | NOT NULL | — | The destination HTTPS URL. |
| `secret` | `TEXT` | NOT NULL | — | Cryptographic secret used to sign the payload (HMAC SHA-256). |
| `event_types` | `TEXT[]` | NOT NULL | `'{ "*" }'` | Array of event topics this endpoint subscribes to. |
| `description` | `TEXT` | NULL | `NULL` | Developer notes (e.g., "Main CRM Sync"). |
| `is_active` | `BOOLEAN` | NOT NULL | `TRUE` | Whether the platform should dispatch events here. |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Record creation timestamp. |

### 6. Primary Key
`PRIMARY KEY (endpoint_id)`

### 7. Foreign Keys
* `institute_id → institutes.institute_id (ON DELETE CASCADE ON UPDATE RESTRICT)`

### 8. Composite Keys
None.

### 9. Unique Constraints
* `UNIQUE (institute_id, url)`: Prevent redundant webhooks.

### 10. CHECK Constraints
* `CHECK (url ~ '^https://')`: Enforce HTTPS for secure delivery.
* `CHECK (char_length(secret) >= 16)`: Enforce strong signing secrets.

### 11. Recommended Indexes
* `idx_webhook_endpoints_events` `(institute_id, is_active)`: Used by the event dispatcher to find active subscribers.

### 12. Soft Delete Strategy
`is_active = FALSE`. 

### 13. Audit Fields
* `created_at`.

### 14. Cascade Rules
* DELETE `institutes`: CASCADE.

### 15. Supabase RLS Considerations
* **Admins:** `ALL` for their `institute_id`.
* **Students/Teachers:** Blocked.

### 16. Notes for Backend Developers
* Generate a secure random string for `secret` upon creation. The backend dispatcher must use this to generate a `X-EdTech-Signature` header so the receiving server can verify the payload wasn't tampered with.

---

## Table 3: `webhook_delivery_logs`

### 1. Purpose
The audit log for webhooks. Tracks payloads, delivery successes, and HTTP error responses. Essential for debugging "Why didn't my CRM update?".

### 2–5. Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `log_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key. |
| `endpoint_id` | `UUID` | NOT NULL | — | FK → `webhook_endpoints.endpoint_id`. |
| `event_type` | `TEXT` | NOT NULL | — | e.g., `payment.failed`. |
| `payload` | `JSONB` | NOT NULL | — | The exact JSON sent to the endpoint. |
| `status` | `webhook_status_type` | NOT NULL | `'pending'` | Current state of delivery. |
| `http_status_code` | `SMALLINT` | NULL | `NULL` | Response code from the external server (e.g., 200, 500). |
| `response_body` | `TEXT` | NULL | `NULL` | Truncated response from the external server (for debugging). |
| `attempt_count` | `SMALLINT` | NOT NULL | `0` | Number of times delivery was attempted. |
| `next_retry_at` | `TIMESTAMPTZ` | NULL | `NULL` | Scheduled time for the next exponential backoff retry. |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Timestamp of the event occurrence. |

### 6. Primary Key
`PRIMARY KEY (log_id)`

### 7. Foreign Keys
* `endpoint_id → webhook_endpoints.endpoint_id (ON DELETE CASCADE ON UPDATE RESTRICT)`

### 8. Composite Keys
None.

### 9. Unique Constraints
None.

### 10. CHECK Constraints
* `CHECK (attempt_count >= 0)`

### 11. Recommended Indexes
* `idx_webhook_logs_retry` `(status, next_retry_at)` WHERE `status = 'retrying'`: Used by the background worker polling for webhooks to resend.
* `idx_webhook_logs_endpoint` `(endpoint_id, created_at DESC)`: For the admin UI delivery history.

### 12. Soft Delete Strategy
No soft delete. Run a background `file_cleanup_job` to permanently DELETE logs older than 30 days to prevent table bloat.

### 13. Audit Fields
* `created_at`, `attempt_count`.

### 14. Cascade Rules
* DELETE `webhook_endpoints`: CASCADE.

### 15. Supabase RLS Considerations
* **Admins:** `SELECT` for logs tied to their institute's endpoints.
* **All others:** Blocked.

### 16. Notes for Backend Developers
* Implement exponential backoff for retries (e.g., retry after 1 min, 5 mins, 30 mins, 2 hours) updating `next_retry_at`. Stop after `attempt_count` reaches 5 and mark as `failed`.

---

## Table 4: `async_jobs`

### 1. Purpose
A robust, application-level job queue. While `pg_cron` handles scheduling, this table handles execution tracking. It is used for heavy tasks: generating PDF reports, bulk email fan-outs, media transcoding polling, and `file_cleanup_jobs` (garbage collection).

### 2–5. Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `job_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key. |
| `queue_name` | `TEXT` | NOT NULL | `'default'` | Allows partitioning workers (e.g., `high_priority`, `video_processing`). |
| `task_name` | `TEXT` | NOT NULL | — | Identifier for the worker function (e.g., `generate_student_report`). |
| `payload` | `JSONB` | NOT NULL | `'{}'` | Arguments for the task. |
| `status` | `job_status_type` | NOT NULL | `'queued'` | Lifecycle state. |
| `priority` | `SMALLINT` | NOT NULL | `0` | Lower number = higher priority. |
| `run_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Allows scheduling jobs for the future. |
| `started_at` | `TIMESTAMPTZ` | NULL | `NULL` | When the worker locked the job. |
| `completed_at` | `TIMESTAMPTZ` | NULL | `NULL` | When the job succeeded or permanently failed. |
| `attempts` | `SMALLINT` | NOT NULL | `0` | Current try count. |
| `max_attempts` | `SMALLINT` | NOT NULL | `3` | Maximum allowed retries before hard failure. |
| `last_error` | `TEXT` | NULL | `NULL` | Stack trace of the last failure. |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Job creation timestamp. |

### 6. Primary Key
`PRIMARY KEY (job_id)`

### 7. Foreign Keys
None. This is a purely infrastructural table.

### 8. Composite Keys
None.

### 9. Unique Constraints
None.

### 10. CHECK Constraints
* `CHECK (attempts <= max_attempts)`

### 11. Recommended Indexes
* `idx_async_jobs_poll` `(queue_name, status, run_at, priority)`: **Critical performance index.** Used by workers pulling the next job via `SELECT ... FOR UPDATE SKIP LOCKED`.
* `idx_async_jobs_status` `(status, created_at)`: Useful for admin dashboards monitoring failed jobs.

### 12. Soft Delete Strategy
No soft delete. Jobs should be hard-deleted automatically 7 days after reaching `completed` or `failed` state to maintain DB performance.

### 13. Audit Fields
* `started_at`, `completed_at`, `last_error`.

### 14. Cascade Rules
None.

### 15. Supabase RLS Considerations
* Blocked for all client roles (`authenticated`, `anon`).
* Exclusive access to `service_role` (your Node.js / Python background workers).

### 16. Notes for Backend Developers
* **Locking:** Workers must pull jobs using:
  `UPDATE async_jobs SET status = 'processing', started_at = NOW() WHERE job_id = (SELECT job_id FROM async_jobs WHERE status = 'queued' AND run_at <= NOW() ORDER BY priority ASC, run_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *;`
  This prevents multiple workers from processing the same job.

---

## Table 5: `feature_flags`

### 1. Purpose
Centralized control for releasing new application capabilities. Allows the engineering team to turn features on/off globally without deploying new code.

### 2–5. Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `flag_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key. |
| `flag_key` | `TEXT` | NOT NULL | — | Developer string (e.g., `enable_new_mock_ui`). |
| `description` | `TEXT` | NOT NULL | — | Context for product managers. |
| `is_global_enabled` | `BOOLEAN` | NOT NULL | `FALSE` | If TRUE, the feature is live for everyone. |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Record creation timestamp. |

### 6. Primary Key
`PRIMARY KEY (flag_id)`

### 7. Foreign Keys
None.

### 8. Composite Keys
None.

### 9. Unique Constraints
* `UNIQUE (flag_key)`

### 10. CHECK Constraints
* `CHECK (char_length(flag_key) > 0)`

### 11. Recommended Indexes
* `idx_feature_flags_key` `(flag_key)`: Fast lookups during frontend initialization.

### 12. Soft Delete Strategy
Hard delete when a feature is 100% rolled out and the old code is deprecated (cleaning up tech debt).

### 13. Audit Fields
* `created_at`.

### 14. Cascade Rules
None.

---

## Table 6: `feature_flag_overrides`

### 1. Purpose
Allows canary releases, beta testing, or premium gating by enabling/disabling a feature flag for specific Institutes regardless of the `is_global_enabled` setting.

### 2–5. Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `override_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key. |
| `flag_id` | `UUID` | NOT NULL | — | FK → `feature_flags.flag_id`. |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. |
| `is_enabled` | `BOOLEAN` | NOT NULL | `TRUE` | Overrides the global setting for this institute. |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Timestamp. |

### 6. Primary Key
`PRIMARY KEY (override_id)`

### 7. Foreign Keys
* `flag_id → feature_flags.flag_id (ON DELETE CASCADE ON UPDATE RESTRICT)`
* `institute_id → institutes.institute_id (ON DELETE CASCADE ON UPDATE RESTRICT)`

### 9. Unique Constraints
* `UNIQUE (flag_id, institute_id)`: Only one override per institute per flag.

### 11. Recommended Indexes
* `idx_ff_overrides_institute` `(institute_id, is_enabled)`: Resolve flags for a specific tenant.

### 15. Supabase RLS Considerations
* **Admins:** `SELECT` to see their own enabled features.
* **Super Admins / Service Role:** `ALL`.

---

## Table 7: `system_events_outbox`

### 1. Purpose
Implements the **Transactional Outbox Pattern**. 
This is the holy grail for preventing distributed data inconsistencies. If you need to invalidate a Redis cache, trigger a search engine (Elasticsearch/Typesense) re-index, or emit a Kafka event when a DB row updates, **do not do it from your API handler**. Instead, insert a row into this table in the same PostgreSQL transaction that updates the main data. A background worker reads this table and safely pushes to the external system.

### 2–5. Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `event_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key. |
| `aggregate_type` | `TEXT` | NOT NULL | — | The entity type (e.g., `LiveClass`, `Question`). |
| `aggregate_id` | `UUID` | NOT NULL | — | The ID of the affected entity. |
| `event_type` | `TEXT` | NOT NULL | — | What happened (e.g., `cache.invalidate`, `question.updated`). |
| `payload` | `JSONB` | NOT NULL | `'{}'` | The data needed by the consumer. |
| `status` | `outbox_status_type` | NOT NULL | `'pending'` | Lifecycle state. |
| `error_log` | `TEXT` | NULL | `NULL` | If publication fails. |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | When the transaction committed. |

### 6. Primary Key
`PRIMARY KEY (event_id)`

### 7. Foreign Keys
None. (Polymorphic data by design).

### 9. Unique Constraints
None.

### 11. Recommended Indexes
* `idx_outbox_polling` `(status, created_at ASC)`: Used by the outbox relay worker to grab pending events in FIFO order.

### 12. Soft Delete Strategy
No soft delete. Hard delete rows where `status = 'published'` frequently (e.g., via a daily cron job) to keep the table extremely small and fast.

### 15. Supabase RLS Considerations
* Blocked for all client roles. Internal infrastructure only (`service_role`).

### 16. Notes for Backend Developers
* **Cache Invalidation:** To invalidate a cache based on a DB update, write a Postgres Trigger that inserts `event_type = 'cache.invalidate', payload = '{"key": "student:123"}'` into this table whenever the student record changes. Your relay worker reads it and safely executes `DEL student:123` in Redis, even if your API server crashes mid-request.

---