# EdTech Platform — Database Schema Specification
## Domain 1: Foundation
### Tables: Institute · Profile · TeacherDetails · StudentDetails

**Document version:** 1.0
**ERD reference:** ERD v3.0 (Frozen)
**PostgreSQL target:** 16
**Supabase compatibility:** Yes

---

## Pre-Domain Notes — Enum Types

The following PostgreSQL enum types are defined globally before any table creation.
They are referenced throughout this document and all subsequent domain documents.

| Enum Name | Values | Used By |
|-----------|--------|---------|
| `user_role` | `admin`, `teacher`, `student` | profiles.role |
| `lifecycle_status` | `draft`, `pending_review`, `approved`, `rejected`, `archived` | content, question, mock_test, pyq_paper, live_class |
| `content_type` | `pdf`, `video`, `notes`, `assignment` | content |
| `question_type` | `mcq`, `msq`, `numerical`, `true_false` | question |
| `question_source_type` | `teacher`, `pyq`, `imported` | question |
| `difficulty_level` | `easy`, `medium`, `hard` | question |
| `batch_status` | `upcoming`, `active`, `completed`, `archived` | batch |
| `subscription_status` | `active`, `expired`, `cancelled` | student_subscription |
| `payment_status` | `pending`, `captured`, `failed`, `refunded`, `partially_refunded` | payment |
| `order_status` | `pending`, `confirmed`, `cancelled`, `refunded` | order |
| `invoice_status` | `draft`, `issued`, `cancelled` | invoice |
| `recording_status` | `queued`, `processing`, `completed`, `failed` | recording |
| `live_class_status` | `draft`, `scheduled`, `live`, `completed`, `cancelled` | live_class |
| `live_session_status` | `waiting`, `live`, `ended` | live_session |
| `attempt_status` | `in_progress`, `submitted`, `abandoned`, `timed_out` | mock_attempt |
| `approval_resource_type` | `content`, `mock_test` | approval_request |
| `approval_status` | `pending`, `approved`, `rejected` | approval_request |
| `notification_channel` | `in_app`, `push`, `email`, `sms` | notification |
| `platform_type` | `web`, `android`, `ios` | mock_attempt |
| `device_type` | `mobile`, `tablet`, `desktop` | mock_attempt |
| `image_role` | `question`, `option`, `explanation` | question_image |
| `payment_gateway` | `razorpay`, `stripe`, `payu`, `cashfree` | payment |
| `item_type` | `subscription_plan`, `pyq_package` | order_item |

> **Implementation note:** Define all enums in a single migration before any table migrations. Enums cannot be easily renamed in PostgreSQL — name them carefully. If a value needs to be added later, `ALTER TYPE ... ADD VALUE` is safe. Removing a value requires recreating the type.

---

## Supabase RLS Helper Function

This function must be created before any RLS policies are written. It is used across every domain.

```
Function: get_my_institute_id()
Returns: uuid
Language: SQL
Stability: STABLE (result may be cached within a single query)
Body: SELECT institute_id FROM profiles WHERE id = auth.uid()
Security: SECURITY DEFINER recommended so RLS on profiles does not recurse
```

> **Backend note:** This function is a performance primitive. All RLS policies across all 14 domains use it. Without `SECURITY DEFINER`, calling it from within a profile RLS policy causes infinite recursion. Define it once and reference it everywhere.

---

## Table 1: `institutes`

### Purpose

Root entity of the entire multi-tenant SaaS platform. Every piece of data in the system belongs to exactly one institute. This table is the anchor for all Row Level Security policies across all other domains.

An institute represents a coaching centre, school, or educational organisation that subscribes to the platform. Multiple institutes operate in complete isolation from one another within the same database.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `institute_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `name` | `VARCHAR(255)` | NOT NULL | — | Full legal name of the institute |
| `slug` | `VARCHAR(100)` | NOT NULL | — | URL-safe lowercase identifier. Example: `allen-kota`. Used in subdomains or URL routing |
| `domain` | `VARCHAR(255)` | NULL | `NULL` | Custom domain if the institute uses a white-label URL. Example: `app.allenkota.com` |
| `logo_url` | `TEXT` | NULL | `NULL` | Supabase Storage URL for the institute logo |
| `plan_tier` | `VARCHAR(50)` | NOT NULL | `'starter'` | SaaS billing tier. Values: `starter`, `growth`, `enterprise`. Not a PostgreSQL enum — kept flexible for billing system changes |
| `is_active` | `BOOLEAN` | NOT NULL | `TRUE` | Soft-disable an institute without deleting it. When FALSE, all logins for this institute are blocked |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Creation timestamp. Always UTC |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Last modification timestamp. Maintained by trigger |

---

### Primary Key

```
PRIMARY KEY (institute_id)
```

---

### Foreign Keys

None. `institutes` is the root entity and has no parent.

---

### Unique Constraints

```
UNIQUE (slug)
UNIQUE (domain) WHERE domain IS NOT NULL
```

> The partial unique index on `domain` (`WHERE domain IS NOT NULL`) allows multiple institutes to have `domain = NULL` without violating uniqueness.

---

### CHECK Constraints

```
CHECK (char_length(slug) >= 3)
CHECK (slug ~ '^[a-z0-9-]+$')   -- slug must be lowercase alphanumeric with hyphens only
CHECK (plan_tier IN ('starter', 'growth', 'enterprise'))
```

> `slug` validation is enforced at the database level to prevent malformed routing identifiers from ever being stored.

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_institutes_slug` | `(slug)` | B-tree (covered by UNIQUE) | Already covered by unique constraint |
| `idx_institutes_is_active` | `(is_active)` | B-tree | Admin dashboard filtering by active institutes |

> The unique constraints create indexes automatically. No additional indexes are needed on this table given its expected low cardinality (hundreds of institutes, not millions).

---

### Soft Delete Strategy

`institutes` does not use `deleted_at`. Use `is_active = FALSE` to disable an institute. Hard deletion of an institute is forbidden — it would cascade-destroy all student data, financial records, and audit logs.

If a client cancels and data must be purged, that is a separate data-retention workflow handled outside the database (export → purge → archive), not a SQL DELETE.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `updated_at` | ✅ | Required; maintained by `updated_at` trigger |
| `created_by` | ❌ | Institute creation is a platform-level operation (by Anthropic/superadmin), not by a profile within the system |
| `updated_by` | ❌ | Same reason; platform-level. Track in AuditLog instead |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE institute | `RESTRICT` | Cannot delete a root multi-tenant entity with active data |
| UPDATE institute_id | `RESTRICT` | PKs must never change |

---

### Supabase RLS Considerations

```
Table: institutes
RLS: ENABLED

Policies:

SELECT:
  - Authenticated users may select their own institute only.
    USING: institute_id = get_my_institute_id()

  - Superadmin (platform-level role, outside normal auth) may select all.
    Implement via service_role key in backend — bypass RLS for platform admin operations.

INSERT:
  - Blocked for all normal authenticated users.
  - Only via service_role (platform operations) or a trusted Edge Function.

UPDATE:
  - Restricted to profiles with role = 'admin' within the institute.
    USING: institute_id = get_my_institute_id()
    WITH CHECK: institute_id = get_my_institute_id() AND (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'

DELETE:
  - Blocked entirely at RLS level. Enforce RESTRICT in FK cascade rules as backup.
```

---

### Backend Developer Notes

1. **Slug generation:** Auto-generate from institute name on creation (lowercase, replace spaces with hyphens, strip special characters). Validate uniqueness before insert. The slug is immutable after creation — changing it breaks URL routing for all users.

2. **plan_tier is not enforced as an enum** intentionally. Billing tiers evolve frequently. Validate at the application layer and store as VARCHAR. Consider a separate `institute_plans` table in a future billing domain if tiers become complex.

3. **The `updated_at` trigger pattern** — create a single reusable trigger function `set_updated_at()` that sets `NEW.updated_at = NOW()`. Apply it to every table that has an `updated_at` column. Do not repeat the logic per table.

4. **institute_id in JWT:** After login, embed `institute_id` in the Supabase JWT custom claims so the frontend can read it without an extra round-trip. This also makes RLS policies faster (claim lookup vs DB lookup).

5. **is_active check at auth layer:** In the Supabase Auth hook (or Edge Function on sign-in), check `institutes.is_active` before completing the login flow. Return a 403 with message `"Your institute account is suspended"` if false.

---

## Table 2: `profiles`

### Purpose

Central identity table for all users — admins, teachers, and students. Mirrors `auth.users` (Supabase Auth) via a 1:1 relationship on `profile_id = auth.users.id`. This table stores application-level user data; authentication credentials (password hash, OAuth tokens) remain exclusively in `auth.users`.

The `role` field determines which downstream detail table is populated: teachers have a `teacher_details` row, students have a `student_details` row. Admins have neither — the admin role is a permission level, not a data type.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `profile_id` | `UUID` | NOT NULL | — | Primary key. **Must equal `auth.users.id`** — no auto-generation; supplied by Supabase Auth on user creation |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. The institute this user belongs to |
| `name` | `VARCHAR(255)` | NOT NULL | — | Full display name |
| `email` | `VARCHAR(255)` | NOT NULL | — | Convenience copy from `auth.users.email`. Kept in sync via Auth hook. Used for display and search — do not use for auth decisions |
| `phone` | `VARCHAR(20)` | NULL | `NULL` | Mobile number with country code. Example: `+919876543210`. Not stored in `auth.users` |
| `avatar_url` | `TEXT` | NULL | `NULL` | Supabase Storage URL for profile picture |
| `role` | `user_role` | NOT NULL | — | PostgreSQL enum: `admin`, `teacher`, `student`. Immutable after creation in normal operation |
| `is_active` | `BOOLEAN` | NOT NULL | `TRUE` | Soft-disable a user. When FALSE, login is blocked and the user is excluded from all application queries |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC timestamp of profile creation |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC timestamp of last update. Maintained by trigger |

---

### Primary Key

```
PRIMARY KEY (profile_id)
```

---

### Foreign Keys

```
institute_id → institutes.institute_id   ON DELETE RESTRICT   ON UPDATE RESTRICT
```

---

### Unique Constraints

```
UNIQUE (email)
```

> Email is globally unique across all institutes. A user cannot have accounts in two institutes with the same email address. If multi-institute accounts are required in future, this constraint must be changed to `UNIQUE (institute_id, email)`.

---

### CHECK Constraints

```
CHECK (char_length(name) >= 2)
CHECK (phone IS NULL OR phone ~ '^\+[1-9]\d{6,14}$')
```

> Phone validation enforces E.164 international format. The regex allows 7–15 digits after the `+` prefix, covering all valid international numbers.

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_profiles_institute_role` | `(institute_id, role)` | B-tree | Admin dashboard: "list all teachers in this institute". Heavily used |
| `idx_profiles_institute_is_active` | `(institute_id, is_active)` | B-tree | Filter active users per institute |
| `idx_profiles_email` | `(email)` | B-tree (covered by UNIQUE) | Already covered by unique constraint |

---

### Soft Delete Strategy

`profiles` does not use `deleted_at`. Use `is_active = FALSE`.

Hard-deleting a profile is forbidden because:
- `teacher_details.profile_id` → content authorship records would orphan
- `student_details.profile_id` → all attempt history would orphan
- Financial records (orders, payments) reference students indirectly

To "delete" a user: set `is_active = FALSE` and revoke their `auth.users` session via Supabase Admin API. Data is retained.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `updated_at` | ✅ | Required; trigger-maintained |
| `created_by` | ❌ | Profile creation is triggered by Supabase Auth signup — no "creator" profile exists at that moment |
| `updated_by` | ❌ | Track admin edits to profiles via `audit_logs` table instead |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE profile | `RESTRICT` | Soft delete only; data must be retained |
| UPDATE profile_id | `RESTRICT` | PK must never change — it mirrors `auth.users.id` |
| Institute deleted | `RESTRICT` (from institute) | Cannot delete institute with profiles |

---

### Supabase RLS Considerations

```
Table: profiles
RLS: ENABLED

Policies:

SELECT:
  - Any authenticated user may read profiles within their own institute.
    USING: institute_id = get_my_institute_id()

  - Users may always read their own profile regardless of institute.
    USING: profile_id = auth.uid()

INSERT:
  - Blocked for normal authenticated users.
  - Profile creation triggered by a Supabase Auth webhook (on user signup) via Edge Function
    using service_role key.

UPDATE:
  - Users may update their own name, phone, avatar_url only.
    USING: profile_id = auth.uid()

  - Admins may update role and is_active for profiles in their institute.
    USING: institute_id = get_my_institute_id()
    WITH CHECK: (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'

DELETE:
  - Blocked at RLS level. Soft delete via is_active only.
```

---

### Backend Developer Notes

1. **Profile creation flow:** When Supabase fires the `auth.users` insert hook (on signup), an Edge Function should immediately create the corresponding `profiles` row. This ensures the profile always exists before the first API call from the frontend. Do not lazy-create profiles.

2. **Email sync:** `profiles.email` is a denormalized copy of `auth.users.email`. Keep them in sync via the Auth email-change hook. Do NOT use `profiles.email` for authentication decisions — always use `auth.uid()` for identity.

3. **Role immutability:** After creation, `role` should never change in normal application flow. Changing a teacher to a student (for example) would leave orphaned `teacher_details` records and corrupt analytics. If a role change is required, create a new auth user and profile, then deactivate the old one.

4. **Phone as secondary auth:** If OTP-based phone login is implemented via Supabase, `auth.users` stores the phone for auth. `profiles.phone` remains the application-display field. Keep both in sync.

5. **Multi-institute support (future):** The current `UNIQUE (email)` constraint assumes one account per person globally. If an institute consortium needs teachers shared across institutes, this constraint must be relaxed and the RLS helper function updated to support multi-institute contexts.

---

## Table 3: `teacher_details`

### Purpose

Stores teacher-specific profile extension data that is not relevant to students or admins. Follows the table-per-type pattern — `profiles` holds the shared identity, `teacher_details` holds role-specific attributes.

Every profile with `role = 'teacher'` has exactly one corresponding `teacher_details` row. Admins and students have no `teacher_details` row.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `teacher_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key. Separate from `profile_id` for cleaner FK references from content, questions, live_classes, etc. |
| `profile_id` | `UUID` | NOT NULL | — | FK → `profiles.profile_id`. 1:1 relationship. Carries UNIQUE constraint |
| `specialization` | `VARCHAR(255)` | NULL | `NULL` | Subject area expertise. Example: `Physics`, `Organic Chemistry`. Free text |
| `qualification` | `VARCHAR(255)` | NULL | `NULL` | Academic qualification. Example: `B.Tech IIT Delhi`, `MBBS AIIMS`. Free text |
| `bio` | `TEXT` | NULL | `NULL` | Teacher biography displayed on their public profile. Max recommended: 1000 characters (enforce at application layer) |
| `rating` | `NUMERIC(3,2)` | NULL | `NULL` | Aggregated student rating. Range: 0.00–5.00. Computed by background job, not live-calculated |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC last-update timestamp. Trigger-maintained |

---

### Primary Key

```
PRIMARY KEY (teacher_id)
```

---

### Foreign Keys

```
profile_id → profiles.profile_id   ON DELETE RESTRICT   ON UPDATE RESTRICT
```

---

### Unique Constraints

```
UNIQUE (profile_id)
```

> Enforces the 1:1 relationship. One teacher profile per user.

---

### CHECK Constraints

```
CHECK (rating IS NULL OR (rating >= 0.00 AND rating <= 5.00))
```

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_teacher_details_profile_id` | `(profile_id)` | B-tree (covered by UNIQUE) | Already covered by unique constraint |
| `idx_teacher_details_rating` | `(rating DESC NULLS LAST)` | B-tree | Teacher leaderboard / ranking queries |

---

### Soft Delete Strategy

None. Soft deletion is handled on the parent `profiles.is_active` field. When a teacher is deactivated, queries join through `profiles` and the `is_active = FALSE` filter excludes them.

Do not add a separate `deleted_at` or `is_active` on `teacher_details` — it would create dual-source-of-truth for active/inactive state.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `updated_at` | ✅ | Required; trigger-maintained |
| `created_by` | ❌ | Row is created automatically when teacher profile is created — no separate creator |
| `updated_by` | ❌ | Track admin modifications via `audit_logs` |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE teacher_details | `RESTRICT` | Content, questions, live classes reference `teacher_id` |
| DELETE parent profile | `RESTRICT` (from profiles) | Profile soft-delete is sufficient |
| UPDATE teacher_id | `RESTRICT` | PK must not change |

---

### Supabase RLS Considerations

```
Table: teacher_details
RLS: ENABLED

SELECT:
  - Any authenticated user within the same institute may read teacher details.
    Join path: teacher_details → profiles → institute_id = get_my_institute_id()
    USING: EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.profile_id = teacher_details.profile_id
      AND p.institute_id = get_my_institute_id()
    )

  - Simpler alternative after adding institute_id denormalization:
    If institute_id is added to teacher_details (optional optimization), the USING clause becomes one column check.

UPDATE:
  - Teachers may update their own specialization, qualification, bio.
    USING: profile_id = auth.uid()

  - Admins may update any teacher_details within the institute.

INSERT:
  - Via Edge Function only (triggered by profile creation with role = 'teacher').

DELETE:
  - Blocked at RLS level.
```

> **Optimization note:** Because `teacher_details` does not carry `institute_id` directly (it inherits via `profiles`), every RLS policy requires a join or subquery through `profiles`. For a table accessed as frequently as this one, consider adding `institute_id` as a denormalized column with a direct FK to `institutes`. This would make RLS policies on `teacher_details` equivalent in performance to all other tables in the system. Evaluate this after measuring query performance in staging.

---

### Backend Developer Notes

1. **teacher_id vs profile_id:** All domain tables (content, questions, live_classes, etc.) reference `teacher_details.teacher_id`, not `profiles.profile_id`. This is intentional — it decouples teacher-specific FK relationships from the auth identity.

2. **Rating computation:** `teacher_details.rating` is never written by an end-user API call. It is computed by a background job (pg_cron or Edge Function) from student attendance and mock test performance data. The backend should have a single dedicated function for this computation.

3. **Creation trigger:** Create `teacher_details` row automatically when a `profiles` row is inserted with `role = 'teacher'`. Use a database trigger or an Edge Function on the Auth webhook. Never rely on the frontend to create this row.

4. **Bio character limit:** Enforce 1000-character limit at the API validation layer (Zod/Joi schema), not as a DB constraint. Changing a DB VARCHAR limit requires a migration; changing an API validation rule is a code change.

---

## Table 4: `student_details`

### Purpose

Stores student-specific profile extension data. Every profile with `role = 'student'` has exactly one corresponding `student_details` row. Follows the same table-per-type pattern as `teacher_details`.

This table is referenced by batch enrollment, mock attempt history, subscriptions, orders, and all analytics tables. It is one of the most heavily joined tables in the system.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `student_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key. Referenced by MockAttempt, BatchStudent, StudentSubscription, Order, PerformanceReport, etc. |
| `profile_id` | `UUID` | NOT NULL | — | FK → `profiles.profile_id`. 1:1 relationship |
| `enrollment_no` | `VARCHAR(50)` | NULL | `NULL` | Institute-assigned enrollment number. Examples: `ALLEN-2025-001`, `STU-00123`. Nullable until the institute assigns one. Unique per institute |
| `dob` | `DATE` | NULL | `NULL` | Date of birth. Used for age verification and student records |
| `target_year` | `VARCHAR(10)` | NULL | `NULL` | Exam target year. Example: `2026`, `2027`. Free text to accommodate different exam calendars |
| `enrolled_on` | `DATE` | NULL | `NULL` | Date the student enrolled with the institute (not the platform registration date) |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC last-update timestamp. Trigger-maintained |

---

### Primary Key

```
PRIMARY KEY (student_id)
```

---

### Foreign Keys

```
profile_id → profiles.profile_id   ON DELETE RESTRICT   ON UPDATE RESTRICT
```

---

### Unique Constraints

```
UNIQUE (profile_id)
UNIQUE (institute_id, enrollment_no) WHERE enrollment_no IS NOT NULL
```

> The second constraint requires `institute_id` on `student_details`. Because `student_details` inherits institute context via `profiles`, implement this unique constraint one of two ways:
>
> **Option A (Recommended):** Add a denormalized `institute_id UUID NOT NULL` column to `student_details` with FK → `institutes.institute_id`. Apply the unique constraint directly: `UNIQUE (institute_id, enrollment_no) WHERE enrollment_no IS NOT NULL`.
>
> **Option B:** Enforce enrollment_no uniqueness via a unique partial index over a subquery (not natively supported in PostgreSQL). This requires a trigger — avoid it.
>
> **Decision:** Add `institute_id` to `student_details` as a denormalized column. It also solves the RLS performance problem (same as the `teacher_details` note above).

---

### CHECK Constraints

```
CHECK (dob IS NULL OR dob < CURRENT_DATE)
CHECK (dob IS NULL OR dob > '1900-01-01')
CHECK (enrollment_no IS NULL OR char_length(enrollment_no) >= 2)
```

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_student_details_profile_id` | `(profile_id)` | B-tree (covered by UNIQUE) | Covered |
| `idx_student_details_institute_enrollment` | `(institute_id, enrollment_no)` | B-tree | Enrollment number lookup per institute. Partial index: `WHERE enrollment_no IS NOT NULL` |
| `idx_student_details_institute_target_year` | `(institute_id, target_year)` | B-tree | Batch assignment by target year; admin filtering |

---

### Soft Delete Strategy

Same as `teacher_details` — soft deletion is handled at the `profiles.is_active` level. No separate soft delete on `student_details`.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `updated_at` | ✅ | Required; trigger-maintained |
| `created_by` | ❌ | Auto-created via Auth webhook |
| `updated_by` | ❌ | Track via `audit_logs` |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE student_details | `RESTRICT` | Mock attempts, subscriptions, orders, analytics all reference `student_id` |
| DELETE parent profile | `RESTRICT` (from profiles) | Soft delete only |
| UPDATE student_id | `RESTRICT` | PK must not change |

---

### Supabase RLS Considerations

```
Table: student_details
RLS: ENABLED

SELECT:
  - Students may read their own row.
    USING: profile_id = auth.uid()

  - Teachers and admins within the same institute may read all student_details.
    USING: institute_id = get_my_institute_id()
    (Requires institute_id column on student_details — see Unique Constraints note above)

  - Students must NOT be able to read other students' details.
    Do not write a blanket "read all in institute" policy for the student role.

UPDATE:
  - Students may update their own dob, target_year only.
    USING: profile_id = auth.uid()

  - Admins may update enrollment_no, enrolled_on for any student in their institute.

INSERT:
  - Via Edge Function only (Auth webhook trigger).

DELETE:
  - Blocked at RLS level.
```

---

### Backend Developer Notes

1. **institute_id denormalization decision:** As noted in Unique Constraints, add `institute_id` directly to `student_details`. This is a one-time architectural addition that pays dividends in every RLS policy, every index, and every analytics query for the lifetime of the product.

2. **student_id as the universal student reference:** All downstream tables (MockAttempt, BatchStudent, StudentSubscription, Order, PerformanceReport, ProgressHistory) reference `student_details.student_id`, not `profiles.profile_id`. This is the correct pattern — it decouples student-domain FKs from auth identity.

3. **enrollment_no is institute-assigned, not system-generated:** The platform should not auto-generate enrollment numbers. The institute assigns them according to their own convention (which varies per institute). The field is nullable until the admin assigns one.

4. **target_year filtering:** The admin dashboard will frequently filter students by `target_year` (to group NEET 2026 students vs NEET 2027 students). The `(institute_id, target_year)` index serves this query efficiently.

5. **Creation trigger:** Create `student_details` row automatically when a `profiles` row is inserted with `role = 'student'`. Same pattern as `teacher_details` — use an Auth webhook Edge Function.

---

## Domain 1 — Design Decisions Summary

| Decision | Choice | Reason |
|----------|--------|--------|
| Auth model | `profiles.profile_id = auth.users.id` | Clean Supabase Auth alignment; no duplication |
| Role model | Single `role` enum on `profiles` | 3 roles only; RBAC overkill was removed in v2 |
| Identity extension | Table-per-type (TeacherDetails / StudentDetails) | No NULL columns on Profile for role-specific data |
| institute_id on detail tables | Recommended to denormalize | Enables direct RLS without join; enrollment_no uniqueness |
| Soft delete | `is_active` on `profiles` only | Detail tables inherit via profile join |
| Email uniqueness | Global `UNIQUE (email)` | One account per person system-wide |
| PKs | UUID everywhere | `gen_random_uuid()` for all except `profile_id` (from Auth) |
| Updated_at maintenance | Single reusable trigger function | DRY; apply to all tables with `updated_at` |

---

## Domain 1 — Relationships to Other Domains

| This Table | Referenced By | Via Column | Domain |
|------------|--------------|------------|--------|
| `institutes` | All business entities | `institute_id` | All domains |
| `profiles` | `audit_logs`, `approval_requests`, `system_settings`, `question.approved_by` | `profile_id` | Domains 6, 8, 14 |
| `teacher_details` | `content`, `live_class`, `mock_test`, `question`, `batch_teacher`, `teacher_analytics` | `teacher_id` | Domains 6, 7, 8, 9, 11 |
| `student_details` | `batch_student`, `student_subscription`, `student_pyq_purchase`, `mock_attempt`, `order`, `performance_report`, `progress_history`, `attendance` | `student_id` | Domains 4, 5, 9, 11, 12 |

---

*Domain 1 complete. Awaiting approval before proceeding to Domain 2 — Academic Structure (Stream, Subject, Chapter, Topic).*
