# EdTech Platform — Database Schema Specification
## Domain 11: Subscription & Access Control
### Tables: `subscription_plans` · `subscription_features` · `plan_unlocks` · `student_subscriptions` · `subscription_history` · `subscription_renewals` · `subscription_cancellations` · `subscription_grace_periods` · `subscription_usage`

**Document version:** 1.0
**ERD reference:** ERD v2.0 (Relationships R14–R15; Domain 5 — Subscription & Packages; Change Log P8)
**PostgreSQL target:** 16
**Supabase compatibility:** Yes
**Domain sequence:** Phase 11 of 15

---

## Domain Overview

The Subscription & Access Control domain is the **commercial and permissions gateway** of the platform. Every piece of content, every live class, every mock test, and every PYQ paper is gated behind either a subscription plan or a standalone purchase. This domain defines what can be sold, who has bought it, what that purchase unlocks, and whether the access is currently valid.

This domain answers three questions at runtime, on every authenticated student request:

- **"Does this student have an active subscription?"** → `student_subscriptions`
- **"Does their subscription unlock this specific feature?"** → `plan_unlocks` + `subscription_features`
- **"How much of this feature have they consumed today / this month?"** → `subscription_usage`

Getting this domain wrong breaks the entire platform. A bug here either locks paying students out of content they have purchased (catastrophic for retention) or grants free students access to premium content (catastrophic for revenue). Every table in this domain demands extra precision.

**Tables in this domain (in dependency order):**

| # | Table | Role | Write Pattern |
|---|-------|------|---------------|
| 1 | `subscription_plans` | Master catalogue of available subscription plans per institute | Admin-managed; low-frequency INSERT / UPDATE |
| 2 | `subscription_features` | Master catalogue of all gatable features on the platform | Platform-seeded; effectively static |
| 3 | `plan_unlocks` | Junction: which features does each plan unlock, and at what limits | Admin-managed when plans are created or modified |
| 4 | `student_subscriptions` | The active subscription record per student | Written on purchase; updated on renewal, cancellation, expiry |
| 5 | `subscription_history` | Immutable log of every state transition a subscription has passed through | Append-only; INSERT on every status change |
| 6 | `subscription_renewals` | One row per renewal event (manual or auto) for a subscription | Written by payment webhook on successful renewal |
| 7 | `subscription_cancellations` | One row per cancellation event, capturing reason and refund eligibility | Written when a student or admin cancels |
| 8 | `subscription_grace_periods` | Tracks active grace period windows after payment failure or expiry | Written by renewal failure handler; updated when resolved |
| 9 | `subscription_usage` | Rolling usage counters per student per feature per billing period | High-frequency UPSERT; reset on period rollover |

---

## Key Architectural Principles for This Domain

**1. Access control is evaluated at runtime from two sources: `student_subscriptions` + `plan_unlocks`.** The backend access-check middleware must perform exactly two queries: (a) is there an active `student_subscriptions` row for this student? (b) does the plan for that subscription have a `plan_unlocks` row for the requested feature? Both must return true for access to be granted. This two-step check must be cached aggressively — it fires on every protected API endpoint.

**2. `subscription_features` is the single source of truth for what can be gated.** Every feature on the platform that can be locked behind a subscription — live classes, recorded classes, mock tests, PYQs, notes, assignments, analytics, downloads, premium support — must have a row in `subscription_features` before it can be referenced in `plan_unlocks`. Adding a new gated feature requires inserting a row here first, not hardcoding a feature string in application code.

**3. `student_subscriptions.status` is the only runtime access gate.** The `status` field drives access in real time. The valid lifecycle states are: `pending` (payment initiated, not confirmed) → `active` (paid and within validity window) → `grace` (payment failed or expired, within grace period) → `expired` (past grace period, no access) → `cancelled` (student or admin cancelled) → `refunded` (payment reversed). Only `active` and `grace` statuses grant feature access. Every status transition must also write a row to `subscription_history`.

**4. `subscription_history` is append-only.** It is the audit trail for every commercial state change. It is never updated or deleted. If a dispute arises ("I paid but my access was revoked"), the history table provides a timestamped record of every state the subscription passed through and who triggered each change.

**5. `subscription_usage` resets on billing period rollover, not on midnight.** Usage counters (e.g., "5 mock tests per month") are scoped to `(student_id, feature_id, period_start, period_end)`. When a student renews, a new usage row is created for the new period — the old row is retained for audit. Usage counters are high-frequency write targets and must be updated with `UPDATE ... SET used_count = used_count + 1 WHERE ... AND used_count < limit` (atomic increment with cap-check) to prevent race conditions.

**6. Grace periods are first-class entities, not flags.** A grace period is a critical commercial concept: a student whose payment fails or whose subscription lapses still gets access for a configured window (default: 7 days) to complete payment. This is tracked in `subscription_grace_periods` with a clear start, end, and resolution status — not as a boolean on `student_subscriptions`.

---

## Enum Types Referenced

| Enum Name | Values | Used By |
|-----------|--------|---------|
| `user_role_type` | `admin`, `teacher`, `student` | `subscription_history.changed_by_role` |

---

## New Enum Types Defined in This Domain

| Enum Name | Values | Used By | Reason |
|-----------|--------|---------|--------|
| `subscription_status_type` | `pending`, `active`, `grace`, `expired`, `cancelled`, `refunded` | `student_subscriptions.status`, `subscription_history.status_after` | Defines the complete lifecycle of a subscription. Every valid state transition must be explicitly modelled — no free-text status strings |
| `subscription_change_reason_type` | `new_purchase`, `renewal`, `upgrade`, `downgrade`, `manual_activation`, `payment_failure`, `payment_recovery`, `admin_action`, `expiry`, `cancellation`, `refund` | `subscription_history.change_reason` | Categorises why a subscription changed state. Enables revenue analytics: how many students churned due to `payment_failure` vs `cancellation`? |
| `cancellation_reason_type` | `student_request`, `admin_action`, `payment_failure_unresolved`, `fraud_detected`, `institute_deactivated`, `plan_discontinued` | `subscription_cancellations.reason` | Structured cancellation reasons for churn analysis and refund eligibility determination |
| `grace_period_resolution_type` | `payment_recovered`, `expired_no_payment`, `admin_waived`, `cancelled` | `subscription_grace_periods.resolution` | How the grace period ended. Determines whether the subscription moved back to `active` or forward to `expired` / `cancelled` |
| `plan_billing_cycle_type` | `monthly`, `quarterly`, `half_yearly`, `yearly`, `lifetime`, `custom` | `subscription_plans.billing_cycle` | The billing frequency of the plan. `lifetime` means one-time payment, never expires. `custom` uses `duration_days` directly |
| `feature_category_type` | `live_classes`, `recorded_classes`, `mock_tests`, `pyq_papers`, `notes`, `assignments`, `analytics`, `downloads`, `premium_support`, `batch_access`, `api_access` | `subscription_features.category` | Groups features for plan builder UI and access-check routing in the backend middleware |

---

## Table 1: `subscription_plans`

### Purpose

The master catalogue of all subscription plans offered by an institute. A plan is a named, priced product that, when purchased by a student, grants access to a defined set of features for a defined duration.

Examples:
- **NEET Gold — Monthly** (`price`: ₹999, `billing_cycle`: `monthly`, `duration_days`: 30) — unlocks live classes, recorded classes, mock tests, notes for the NEET stream
- **JEE Platinum — Yearly** (`price`: ₹8,999, `billing_cycle`: `yearly`, `duration_days`: 365) — unlocks all features for the JEE stream including PYQs and premium support
- **Mock Test Only Pack** (`price`: ₹299, `billing_cycle`: `monthly`) — unlocks mock tests only

Plans are scoped to an institute. What a plan unlocks is defined in `plan_unlocks`, not on this table. The plan itself is just the price, duration, and billing cycle. This separation allows the same plan to be modified (features added/removed) without changing the plan row itself.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `plan_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. The institute that owns this plan. Plans are never shared across institutes |
| `stream_id` | `UUID` | NULL | `NULL` | FK → `streams.stream_id`. The academic stream this plan targets (e.g., NEET, JEE, UPSC). NULL means the plan is stream-agnostic (e.g., a general notes-only plan that applies to all streams in the institute). When NOT NULL, access checks filter content by this stream |
| `name` | `TEXT` | NOT NULL | — | Display name of the plan shown to students (e.g., `"NEET Gold — Monthly"`, `"JEE Platinum — Yearly"`). Must be unique within the institute (enforced via unique constraint). Maximum 200 characters |
| `slug` | `TEXT` | NOT NULL | — | URL-safe identifier for the plan (e.g., `neet-gold-monthly`). Auto-generated from `name` at creation. Used in marketing URLs and deep links. Must be unique within the institute |
| `description` | `TEXT` | NULL | `NULL` | Marketing description of the plan shown on the plans page. Supports basic markdown for formatting. Not used in access-check logic |
| `price` | `NUMERIC(10, 2)` | NOT NULL | — | The listed price in the institute's currency. Must be ≥ 0.00. 0.00 is valid for free plans. `NUMERIC(10, 2)` supports up to ₹99,99,999.99 — sufficient for any EdTech pricing in INR |
| `currency_code` | `CHAR(3)` | NOT NULL | `'INR'` | ISO 4217 currency code (e.g., `INR`, `USD`, `AED`). Default `INR` for the Indian EdTech market. Three-character fixed-length to enforce ISO standard |
| `billing_cycle` | `plan_billing_cycle_type` | NOT NULL | — | How frequently the plan recurs: `monthly`, `quarterly`, `half_yearly`, `yearly`, `lifetime`, `custom` |
| `duration_days` | `SMALLINT` | NOT NULL | — | Exact validity in days from the `start_date` of a `student_subscriptions` row. For `monthly` plans: 30. For `yearly`: 365. For `lifetime`: a very large value (e.g., 36500 = 100 years). Required for all billing cycles — the `billing_cycle` enum is for display and analytics; `duration_days` is what the system uses for expiry calculations |
| `trial_days` | `SMALLINT` | NOT NULL | `0` | Number of free trial days before billing begins. 0 means no trial. When a student starts a trial, a `student_subscriptions` row is created with `status = 'active'` and `is_trial = TRUE`. The trial end date is `start_date + trial_days` |
| `max_students` | `INTEGER` | NULL | `NULL` | Maximum number of concurrent active subscribers allowed on this plan. NULL means unlimited. Used by institutes to create capacity-limited cohort plans (e.g., a "100-seat NEET Batch" plan). Enforced via a CHECK at subscription creation time in the backend service |
| `is_active` | `BOOLEAN` | NOT NULL | `TRUE` | Soft delete / publish flag. Inactive plans are not shown to students for new purchases but existing active subscriptions on this plan continue to work until expiry. An admin deactivating a plan does NOT cancel existing subscriptions |
| `is_featured` | `BOOLEAN` | NOT NULL | `FALSE` | Whether the plan appears in the "Featured" or "Recommended" section on the plans listing page. UI-only flag; has no effect on access control logic |
| `sort_order` | `SMALLINT` | NOT NULL | `0` | Display order of plans on the pricing page. Lower values appear first. Allows admin to control plan display order without changing names |
| `created_by` | `UUID` | NOT NULL | — | FK → `profiles.profile_id`. The admin who created the plan |
| `updated_by` | `UUID` | NULL | `NULL` | FK → `profiles.profile_id`. The admin who last modified the plan |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Row creation timestamp. Always UTC |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Last modification timestamp. Trigger-maintained. Always UTC |

---

### Primary Key

```
PRIMARY KEY (plan_id)
```

---

### Foreign Keys

```
institute_id → institutes.institute_id   ON DELETE RESTRICT   ON UPDATE RESTRICT
stream_id    → streams.stream_id         ON DELETE RESTRICT   ON UPDATE RESTRICT
created_by   → profiles.profile_id       ON DELETE RESTRICT   ON UPDATE RESTRICT
updated_by   → profiles.profile_id       ON DELETE SET NULL   ON UPDATE RESTRICT
```

> **`ON DELETE RESTRICT` on `institute_id` and `stream_id`:** An institute or stream cannot be deleted while active plans exist. Deactivate all plans first, run a data retention sweep to confirm no active subscriptions remain, then archive.

---

### Composite Keys

None. `plan_id` is the sole primary key.

---

### Unique Constraints

```
UNIQUE (institute_id, name)
UNIQUE (institute_id, slug)
```

> Two plans in the same institute cannot share a name or a slug. Cross-institute duplication is permitted (Institute A and Institute B can both have a plan named "NEET Gold").

---

### CHECK Constraints

```
CHECK (price >= 0.00)
CHECK (duration_days >= 1)
CHECK (trial_days >= 0)
CHECK (max_students IS NULL OR max_students >= 1)
CHECK (sort_order >= 0)
CHECK (char_length(name) >= 2 AND char_length(name) <= 200)
CHECK (char_length(slug) >= 2 AND char_length(slug) <= 200)
CHECK (slug ~ '^[a-z0-9][a-z0-9\-]*[a-z0-9]$')
CHECK (
  billing_cycle != 'lifetime'
  OR (billing_cycle = 'lifetime' AND trial_days = 0)
)
```

> **Slug regex:** enforces lowercase alphanumeric with hyphens, no leading or trailing hyphens (e.g., `neet-gold-monthly` is valid; `-neet-gold` is not).
> **Lifetime + trial:** a lifetime plan cannot have a trial period — a student who starts a "lifetime" trial and never pays would have indefinite access, which is a business logic error.

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_plans_institute_active` | `(institute_id, is_active, sort_order ASC)` | B-tree | Plans listing page: all active plans for an institute in display order |
| `idx_plans_institute_stream` | `(institute_id, stream_id, is_active)` | B-tree | Stream-scoped plan lookup: "show all plans for NEET stream" |
| `idx_plans_institute_slug` | `(institute_id, slug)` | B-tree (covered by UNIQUE) | Already covered |
| `idx_plans_billing_cycle` | `(institute_id, billing_cycle, is_active)` | B-tree | Admin filter: all yearly plans in an institute for renewal forecasting |

---

### Soft Delete Strategy

`is_active = FALSE` is the soft delete. Deactivating a plan:
- Hides it from the student-facing plans listing (`WHERE is_active = TRUE`).
- Does NOT cancel any existing `student_subscriptions` on this plan — those continue until their natural expiry.
- Does NOT prevent the plan from being referenced by existing `student_subscriptions`, `plan_unlocks`, or `subscription_history` rows.

Physical DELETE is blocked via RLS and FK constraints (`student_subscriptions` references `plan_id`).

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `updated_at` | ✅ | Trigger-maintained |
| `created_by` | ✅ | Plan authorship for compliance |
| `updated_by` | ✅ | Price changes and feature changes must be attributable |

> Every `UPDATE` to `subscription_plans` (especially `price`) must generate a row in `audit_logs` with `action = 'update'`, `old_value = {"price": <old>}`, `new_value = {"price": <new>}`. Price changes affecting existing subscribers are a commercial dispute surface.

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE subscription_plans | `RESTRICT` | Student subscriptions and plan unlocks reference this |
| DELETE institute | `RESTRICT` | Plans must be deactivated and archived first |
| DELETE stream | `RESTRICT` | Plans targeting a stream cannot be orphaned |
| UPDATE plan_id | `RESTRICT` | PK must not change; subscriptions reference it |

---

### Supabase RLS Considerations

```
Table: subscription_plans
RLS: ENABLED

SELECT:
  - Students and Teachers: may read active plans within their institute.
    USING: institute_id = get_my_institute_id()
      AND is_active = TRUE

  - Admins: may read all plans (active and inactive) within their institute.
    USING: institute_id = get_my_institute_id()

INSERT / UPDATE:
  - Admins only.
    WITH CHECK: institute_id = get_my_institute_id()
      AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')

DELETE:
  - Blocked for all client roles. Use is_active = FALSE.
```

---

### Backend Developer Notes

1. **Price changes on active plans do NOT retroactively affect existing subscribers.** A student who subscribed at ₹999/month retains that price for their current subscription period. Price changes only affect new purchases. If the platform introduces price versioning in the future, add a `plan_price_history` table. For v1, the `audit_logs` entry on the `UPDATE` event serves as the price change record.

2. **`max_students` enforcement requires a transaction-level lock.** To prevent overselling a capacity-limited plan, the subscription creation service must: `SELECT COUNT(*) FROM student_subscriptions WHERE plan_id = $1 AND status = 'active' FOR UPDATE` and compare against `max_students` within the same transaction. Without the `FOR UPDATE` lock, two concurrent purchases could both pass the check and both succeed, exceeding the cap.

3. **`duration_days` is the authoritative expiry field.** `billing_cycle` is a display / categorisation field. The subscription expiry date is always computed as `start_date + duration_days`. Do not derive the expiry from `billing_cycle` — different months have different day counts, and `billing_cycle = 'monthly'` does not mean "end of next calendar month."

---

## Table 2: `subscription_features`

### Purpose

The master catalogue of every feature on the platform that can be gated behind a subscription. This table is the single source of truth for what can be unlocked. Every gatable feature must have a row here before it can be referenced in `plan_unlocks`.

This table is seeded by the platform at install time and rarely changes. It is effectively a reference table — the application reads it to build the plan builder UI (checkboxes for each feature when creating a plan) and to validate `plan_unlocks` rows.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `feature_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `feature_key` | `TEXT` | NOT NULL | — | Machine-readable identifier for the feature. Used in backend middleware for access checks (e.g., `live_classes_access`, `mock_tests_access`, `pyq_download`, `recorded_classes_access`, `notes_access`, `assignment_access`, `analytics_premium`, `batch_access`). `snake_case`. Must be globally unique across the platform |
| `display_name` | `TEXT` | NOT NULL | — | Human-readable name shown in the plan builder UI (e.g., `"Live Classes"`, `"Mock Tests"`, `"PYQ Papers & Solutions"`, `"Notes & Study Material"`) |
| `description` | `TEXT` | NULL | `NULL` | Explanation of what this feature includes, shown in the plan builder and on the student-facing pricing page |
| `category` | `feature_category_type` | NOT NULL | — | Groups the feature for UI display and backend routing: `live_classes`, `recorded_classes`, `mock_tests`, `pyq_papers`, `notes`, `assignments`, `analytics`, `downloads`, `premium_support`, `batch_access`, `api_access` |
| `is_quantifiable` | `BOOLEAN` | NOT NULL | `FALSE` | Whether this feature has a usage limit that can be configured per plan. If TRUE, `plan_unlocks.limit_value` is meaningful (e.g., "10 mock tests per month"). If FALSE, the feature is binary — either unlocked or not (e.g., "live classes access") and `limit_value` is ignored |
| `unit_label` | `TEXT` | NULL | `NULL` | The human-readable unit for quantifiable features (e.g., `"tests per month"`, `"downloads per day"`, `"GB storage"`). NULL for non-quantifiable features. Used in the plan builder UI to label the limit input |
| `is_active` | `BOOLEAN` | NOT NULL | `TRUE` | Soft delete for features. An inactive feature is not shown in the plan builder and is not evaluated in access checks. Used to retire features without breaking existing `plan_unlocks` rows |
| `sort_order` | `SMALLINT` | NOT NULL | `0` | Display order in the plan builder UI checkbox list |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Row creation timestamp. Always UTC |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Last modification timestamp. Trigger-maintained |

---

### Primary Key

```
PRIMARY KEY (feature_id)
```

---

### Foreign Keys

None. `subscription_features` is a reference table with no upstream FK dependencies. It is referenced by `plan_unlocks`.

---

### Composite Keys

None.

---

### Unique Constraints

```
UNIQUE (feature_key)
```

> `feature_key` is globally unique — not scoped to an institute. The same feature key is used by all institutes on the platform.

---

### CHECK Constraints

```
CHECK (char_length(feature_key) >= 3 AND char_length(feature_key) <= 100)
CHECK (feature_key ~ '^[a-z][a-z0-9_]*$')
CHECK (char_length(display_name) >= 2 AND char_length(display_name) <= 200)
CHECK (sort_order >= 0)
CHECK (
  is_quantifiable = TRUE
  OR unit_label IS NULL
)
```

> The final CHECK ensures `unit_label` is only populated when `is_quantifiable = TRUE`. A non-quantifiable feature (binary on/off) cannot have a unit label.

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_features_key` | `(feature_key)` | B-tree (covered by UNIQUE) | Primary access pattern: backend middleware looks up feature by key |
| `idx_features_category_active` | `(category, is_active, sort_order ASC)` | B-tree | Plan builder UI: features grouped by category, active only, in display order |

---

### Soft Delete Strategy

`is_active = FALSE`. A retired feature is hidden from the plan builder but all existing `plan_unlocks` rows that reference it are preserved. The access-check middleware must filter `WHERE subscription_features.is_active = TRUE` when evaluating access — an inactive feature is effectively inaccessible regardless of plan configuration.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `updated_at` | ✅ | Trigger-maintained |
| `created_by` | ❌ | System-seeded at install; no human author in normal operation |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE subscription_features | `RESTRICT` | `plan_unlocks` references `feature_id` |
| UPDATE feature_id | `RESTRICT` | PK must not change; backend middleware caches feature keys |

---

### Supabase RLS Considerations

```
Table: subscription_features
RLS: ENABLED

SELECT:
  - All authenticated users may read active features.
    USING: is_active = TRUE
  - Admins may read all features including inactive.
    USING: EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')

INSERT / UPDATE / DELETE:
  - service_role only (platform seeding). No client role may modify this table.
```

---

### Backend Developer Notes

1. **Seed `subscription_features` at platform install time.** The complete list of gatable features must be inserted by the platform initialisation job. Hardcode the `feature_key` values in the backend access-check middleware as constants (e.g., `FEATURES.LIVE_CLASSES = 'live_classes_access'`). If the `feature_key` in the database does not match the constant in the code, access checks will silently fail — always validate keys on deploy.

2. **The access-check middleware pattern.** For every protected API endpoint, the middleware must: (a) look up the student's active `student_subscriptions` row, (b) join to `plan_unlocks` where `plan_id = subscription.plan_id AND feature_key = FEATURES.THIS_ENDPOINT`, (c) if `is_quantifiable = TRUE`, additionally check `subscription_usage.used_count < plan_unlocks.limit_value`. Cache steps (a) and (b) in Redis keyed by `student_id` + `feature_key` with a 60-second TTL. Never query the database on every request for access validation.

---

## Table 3: `plan_unlocks`

### Purpose

The junction table between `subscription_plans` and `subscription_features`. One row per feature unlocked by a plan. This is where the plan definition becomes concrete: "NEET Gold Monthly unlocks live classes (unlimited), mock tests (10 per month), notes (unlimited), recorded classes (unlimited)."

When a student's access check fires, the middleware resolves: "does the student's active plan have a `plan_unlocks` row for the requested `feature_key`?" If yes → access granted (subject to usage limits). If no → 403.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `unlock_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key (surrogate, for simpler RLS policies and history references) |
| `plan_id` | `UUID` | NOT NULL | — | FK → `subscription_plans.plan_id`. The plan that grants this feature access |
| `feature_id` | `UUID` | NOT NULL | — | FK → `subscription_features.feature_id`. The feature being unlocked |
| `is_enabled` | `BOOLEAN` | NOT NULL | `TRUE` | Whether this feature is currently enabled for this plan. `FALSE` temporarily disables a feature without deleting the unlock row — useful for maintenance windows or feature rollbacks |
| `limit_value` | `INTEGER` | NULL | `NULL` | The usage cap for quantifiable features. NULL means unlimited. For non-quantifiable features (`is_quantifiable = FALSE`), this must be NULL. For quantifiable features, a value of 0 means the feature is unlocked but immediately exhausted — effectively blocked. Positive integers set the periodic limit (e.g., `10` for "10 mock tests per month") |
| `limit_period_days` | `SMALLINT` | NULL | `NULL` | The rolling window in days over which `limit_value` is counted. NULL for non-quantifiable features. Common values: `1` (daily limit), `7` (weekly), `30` (monthly), `365` (yearly). The `subscription_usage` table resets counters per `(student_id, feature_id, period_start, period_end)` where the period is derived from this value and the subscription start date |
| `notes` | `TEXT` | NULL | `NULL` | Internal admin notes about this specific unlock (e.g., "Reduced from 20 to 10 on 2025-01-15 per pricing review"). Not shown to students |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Row creation timestamp. Always UTC |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Last modification timestamp. Trigger-maintained |

---

### Primary Key

```
PRIMARY KEY (unlock_id)
```

---

### Foreign Keys

```
plan_id    → subscription_plans.plan_id             ON DELETE RESTRICT   ON UPDATE RESTRICT
feature_id → subscription_features.feature_id       ON DELETE RESTRICT   ON UPDATE RESTRICT
```

> **`ON DELETE RESTRICT` on both FKs:** A plan cannot be hard-deleted while it has unlock rows, and a feature cannot be hard-deleted while plans reference it. Both must be soft-deleted first.

---

### Composite Keys

No composite PK. `unlock_id` is the surrogate primary key. The natural candidate `(plan_id, feature_id)` is enforced via a unique constraint.

---

### Unique Constraints

```
UNIQUE (plan_id, feature_id)
```

> One plan cannot unlock the same feature twice. The UPSERT target when an admin edits a plan's feature list: `ON CONFLICT (plan_id, feature_id) DO UPDATE SET limit_value = excluded.limit_value, is_enabled = excluded.is_enabled`.

---

### CHECK Constraints

```
CHECK (limit_value IS NULL OR limit_value >= 0)
CHECK (limit_period_days IS NULL OR limit_period_days >= 1)
CHECK (
  (limit_value IS NULL AND limit_period_days IS NULL)
  OR (limit_value IS NOT NULL AND limit_period_days IS NOT NULL)
)
```

> The final CHECK ensures `limit_value` and `limit_period_days` are either both NULL (unlimited / non-quantifiable) or both NOT NULL (quantifiable with a defined period). A plan unlock cannot have a limit without a period, or a period without a limit.

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_plan_unlocks_plan_id` | `(plan_id, is_enabled)` | B-tree | **Primary access-check query:** "what features does plan X have enabled?" — called on every protected endpoint |
| `idx_plan_unlocks_feature_id` | `(feature_id)` | B-tree | Reverse lookup: "which plans unlock feature Y?" — used by admin plan comparison UI |
| `idx_plan_unlocks_plan_feature` | `(plan_id, feature_id)` | B-tree (covered by UNIQUE) | Already covered |

---

### Soft Delete Strategy

`is_enabled = FALSE` temporarily disables a feature on a plan without removing the unlock row. This is the correct mechanism for rolling back a feature from a plan during a maintenance window. Full removal requires DELETE of the unlock row (admin action, service_role).

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `updated_at` | ✅ | Trigger-maintained; limit changes must be traceable |
| `notes` | ✅ | Admin rationale for limit decisions; essential for plan management at scale |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE plan_unlocks | Safe (no downstream FKs from other tables) | The unlock row itself is a leaf; `subscription_usage` references `feature_id` directly, not `unlock_id` |
| DELETE plan | `RESTRICT` | Cannot delete a plan that has unlock rows |
| DELETE feature | `RESTRICT` | Cannot delete a feature that plans reference |
| UPDATE unlock_id | `RESTRICT` | PK must not change |

---

### Supabase RLS Considerations

```
Table: plan_unlocks
RLS: ENABLED

SELECT:
  - Students and Teachers: may read enabled plan_unlocks for active plans within
    their institute.
    USING: is_enabled = TRUE
      AND plan_id IN (
        SELECT plan_id FROM subscription_plans
        WHERE institute_id = get_my_institute_id() AND is_active = TRUE
      )

  - Admins: may read all plan_unlocks for their institute's plans.
    USING: plan_id IN (
      SELECT plan_id FROM subscription_plans
      WHERE institute_id = get_my_institute_id()
    )

INSERT / UPDATE:
  - Admins only.
    WITH CHECK: plan_id IN (
      SELECT plan_id FROM subscription_plans
      WHERE institute_id = get_my_institute_id()
    )

DELETE:
  - Admins only. Prefer is_enabled = FALSE over DELETE.
```

---

### Backend Developer Notes

1. **Cache the full feature map per plan.** On plan creation or plan_unlocks update, cache `SELECT feature_key, limit_value, limit_period_days FROM plan_unlocks JOIN subscription_features USING (feature_id) WHERE plan_id = $1 AND is_enabled = TRUE` in Redis as a hash keyed by `plan:{plan_id}:features`. Invalidate this cache whenever a `plan_unlocks` row for this plan is inserted, updated, or deleted via Supabase Realtime.

2. **Access check is O(1) with the cache.** With the plan feature map cached, an access check is: (1) `cache.get(student:subscription)` → get `plan_id`, (2) `cache.get(plan:{plan_id}:features:{feature_key})` → get limit, (3) if quantifiable, `cache.get(student:{id}:usage:{feature_key}:{period})` → compare to limit. Three cache reads, zero DB queries, sub-millisecond response.

---

## Table 4: `student_subscriptions`

### Purpose

The core subscription record. One row per subscription per student. This is the table that the access-check middleware queries on every protected request to determine if a student has active access.

A student may have multiple rows in this table over their lifetime (one per purchase / renewal cycle), but at most one row should have `status = 'active'` or `status = 'grace'` at any given time for the same plan. Overlapping active subscriptions on the same plan are a data integrity error; different plans can overlap.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `subscription_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `student_id` | `UUID` | NOT NULL | — | FK → `student_details.student_id`. The student who owns this subscription |
| `plan_id` | `UUID` | NOT NULL | — | FK → `subscription_plans.plan_id`. The plan the student subscribed to |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS enforcement and multi-tenant queries |
| `order_id` | `UUID` | NULL | `NULL` | FK → `orders.order_id`. The commerce order that created or most recently renewed this subscription. NULL for admin-gifted or trial subscriptions that bypassed the checkout flow |
| `status` | `subscription_status_type` | NOT NULL | `'pending'` | The current lifecycle state. Default `'pending'` on row creation (before payment confirmation). The access-check middleware only grants access when `status IN ('active', 'grace')` |
| `start_date` | `DATE` | NOT NULL | — | The date from which access begins. For paid subscriptions, set to the payment confirmation date. For trials, the trial start date. For admin-gifted subscriptions, the admin-specified start date |
| `end_date` | `DATE` | NOT NULL | — | The date on which access expires. Computed as `start_date + subscription_plans.duration_days`. For `lifetime` plans, set to a far-future date (e.g., `2099-12-31`). For trials, `start_date + trial_days` |
| `grace_end_date` | `DATE` | NULL | `NULL` | The date on which the grace period (if active) ends. Set when a subscription enters `status = 'grace'`. NULL when no grace period is active. Grace end = `end_date + system_settings.grace_period_days` |
| `is_trial` | `BOOLEAN` | NOT NULL | `FALSE` | Whether this subscription started as a free trial. Affects renewal behaviour and cancellation eligibility |
| `is_auto_renew` | `BOOLEAN` | NOT NULL | `TRUE` | Whether the student has opted in to automatic renewal. Defaults to TRUE (opt-out model). When TRUE and a valid payment method is stored, the renewal service attempts renewal `system_settings.renewal_attempt_days_before_expiry` days before `end_date` |
| `payment_method_id` | `TEXT` | NULL | `NULL` | The payment gateway's stored payment method token (e.g., Razorpay mandate ID, Stripe customer + payment method ID). NULL for one-time payments, trial subscriptions, or when `is_auto_renew = FALSE`. Never store raw card numbers — always store the gateway token |
| `renewal_attempts` | `SMALLINT` | NOT NULL | `0` | Number of times the auto-renewal service has attempted to charge for the current renewal cycle. Reset to 0 on successful renewal. Used to stop retrying after `system_settings.max_renewal_attempts` |
| `cancelled_at` | `TIMESTAMPTZ` | NULL | `NULL` | Timestamp when the subscription was cancelled. Set when `status` transitions to `'cancelled'`. NULL for all other statuses |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Row creation timestamp. Always UTC |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Last modification timestamp. Trigger-maintained |

---

### Primary Key

```
PRIMARY KEY (subscription_id)
```

---

### Foreign Keys

```
student_id   → student_details.student_id     ON DELETE RESTRICT   ON UPDATE RESTRICT
plan_id      → subscription_plans.plan_id     ON DELETE RESTRICT   ON UPDATE RESTRICT
institute_id → institutes.institute_id        ON DELETE RESTRICT   ON UPDATE RESTRICT
order_id     → orders.order_id               ON DELETE SET NULL   ON UPDATE RESTRICT
```

> **`ON DELETE RESTRICT` on `student_id` and `plan_id`:** A student cannot be deleted while an active subscription exists. A plan cannot be deleted while students are subscribed to it.
> **`ON DELETE SET NULL` on `order_id`:** If an order is hard-deleted (data purge), the subscription record is preserved with `order_id = NULL`. The subscription's validity does not depend on the order's existence.

---

### Composite Keys

None. `subscription_id` is the sole PK.

---

### Unique Constraints

```
UNIQUE (student_id, plan_id, start_date)
```

> Prevents duplicate subscription rows for the same student on the same plan starting on the same date. A student can have multiple subscriptions on the same plan (sequential renewals as separate rows), but not two starting on the same day. The `start_date` disambiguator allows historical rows to coexist with the current active row.

---

### CHECK Constraints

```
CHECK (end_date > start_date)
CHECK (grace_end_date IS NULL OR grace_end_date >= end_date)
CHECK (renewal_attempts >= 0)
CHECK (
  (status = 'cancelled' AND cancelled_at IS NOT NULL)
  OR (status != 'cancelled' AND cancelled_at IS NULL)
)
CHECK (
  (status = 'grace' AND grace_end_date IS NOT NULL)
  OR (status != 'grace')
)
CHECK (
  is_trial = FALSE
  OR (is_trial = TRUE AND is_auto_renew = FALSE)
)
```

> The `is_trial` + `is_auto_renew` constraint: trial subscriptions cannot auto-renew — a student must actively choose to convert to a paid subscription after a trial.

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_student_subs_student_status` | `(student_id, status)` | B-tree | **Primary access-check query:** "does this student have an active subscription?" — the hottest read on the platform. Must be sub-millisecond |
| `idx_student_subs_student_active` | `(student_id, status, end_date)` WHERE `status IN ('active', 'grace')` | B-tree (partial) | Further optimised access check: only rows that can grant access |
| `idx_student_subs_expiry_autorenew` | `(end_date, is_auto_renew, status)` WHERE `status = 'active'` | B-tree (partial) | Renewal job: find all active auto-renew subscriptions expiring within N days |
| `idx_student_subs_institute_status` | `(institute_id, status, end_date DESC)` | B-tree | Admin dashboard: active subscriber count and churn tracking per institute |
| `idx_student_subs_plan_active` | `(plan_id, status)` WHERE `status = 'active'` | B-tree (partial) | Plan-level capacity check: `COUNT(*) WHERE plan_id = $1 AND status = 'active'` vs `max_students` |
| `idx_student_subs_grace_end_date` | `(grace_end_date)` WHERE `status = 'grace'` | B-tree (partial) | Grace expiry job: find all grace-period subscriptions whose grace window has passed |

---

### Soft Delete Strategy

There is no soft delete on `student_subscriptions`. Subscriptions have an explicit `status` enum that captures all lifecycle states including `cancelled` and `refunded`. A "deleted" subscription is meaningless — every state is commercially significant.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `updated_at` | ✅ | Trigger-maintained |
| `cancelled_at` | ✅ | Cancellation timestamp is a first-class audit field |
| `renewal_attempts` | ✅ | Renewal failure tracking for operations monitoring |

> Every `status` change on `student_subscriptions` must also INSERT a row into `subscription_history`. The history table is the detailed audit trail; the subscription table is the current state.

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE student_subscriptions | `CASCADE` to `subscription_history`, `subscription_grace_periods`, `subscription_usage` | All child records are meaningless without the parent subscription |
| DELETE student | `RESTRICT` | Student must be deactivated; subscriptions must expire or be cancelled first |
| DELETE plan | `RESTRICT` | Cannot delete a plan with subscriptions |
| UPDATE subscription_id | `RESTRICT` | PK must not change; history and usage rows reference it |

---

### Supabase RLS Considerations

```
Table: student_subscriptions
RLS: ENABLED

SELECT:
  - Students may read their own subscription rows.
    USING: student_id = (
      SELECT student_id FROM student_details WHERE profile_id = auth.uid()
    )
      AND institute_id = get_my_institute_id()

  - Admins may read all subscriptions within their institute.
    USING: institute_id = get_my_institute_id()
      AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')

  - Teachers: no access (teachers do not manage student subscriptions).

INSERT:
  - Blocked for all client roles.
  - Written by service_role on payment confirmation webhook only.

UPDATE:
  - Blocked for all client roles. Status transitions are managed by the
    subscription service (service_role) via webhook handlers and background jobs.
  - The one exception: is_auto_renew may be toggled by the student via a
    dedicated RPC function that validates the subscription belongs to the caller.

DELETE:
  - Blocked for all client roles.
```

---

### Backend Developer Notes

1. **The access check must be a single cached lookup.** On first request, the access service queries: `SELECT s.subscription_id, s.plan_id, s.status, s.end_date, s.grace_end_date FROM student_subscriptions s WHERE s.student_id = $1 AND s.status IN ('active', 'grace') AND s.end_date >= CURRENT_DATE ORDER BY s.end_date DESC LIMIT 1`. Cache the result keyed by `student_id` with a 60-second TTL. Invalidate on any subscription `UPDATE` via Supabase Realtime.

2. **Status transition machine.** Valid transitions only: `pending → active`, `pending → cancelled`, `active → grace`, `active → expired`, `active → cancelled`, `grace → active` (payment recovered), `grace → expired`, `grace → cancelled`, `expired → active` (admin re-activation), `cancelled → refunded`. Any other transition is a bug. Implement a status transition validator function in the backend that rejects invalid transitions before writing.

3. **Never read `end_date` alone for access.** Always check `status IN ('active', 'grace')` AND `end_date >= CURRENT_DATE` (for active) OR `grace_end_date >= CURRENT_DATE` (for grace). A subscription in `status = 'expired'` but with `end_date` in the future is an inconsistency — the status is authoritative. Fix the status, not the date.

---

## Table 5: `subscription_history`

### Purpose

An immutable, append-only log of every status transition that a `student_subscriptions` row has passed through. One row per state change. This is the commercial audit trail — it answers "when did this student's subscription change from `active` to `grace`, who triggered it, and why?"

This table is consumed by the admin subscription management panel, customer support tools, and automated refund eligibility calculations.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `history_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `subscription_id` | `UUID` | NOT NULL | — | FK → `student_subscriptions.subscription_id`. The subscription this event belongs to |
| `student_id` | `UUID` | NOT NULL | — | FK → `student_details.student_id`. Denormalized for direct student-scoped queries |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS |
| `status_before` | `subscription_status_type` | NULL | `NULL` | The subscription status immediately before this change. NULL for the first history row (`new_purchase` event where there was no prior status) |
| `status_after` | `subscription_status_type` | NOT NULL | — | The subscription status immediately after this change |
| `change_reason` | `subscription_change_reason_type` | NOT NULL | — | Why the status changed |
| `changed_by` | `UUID` | NULL | `NULL` | FK → `profiles.profile_id`. The human actor who triggered the change. NULL for automated system events (renewal job, expiry job, payment webhook) |
| `changed_by_role` | `user_role_type` | NULL | `NULL` | Denormalized role of `changed_by` at the time of change. NULL for system events |
| `payment_reference` | `TEXT` | NULL | `NULL` | Payment gateway transaction ID or reference number associated with this event, when the change was triggered by a payment event. NULL for non-payment-related changes |
| `metadata` | `JSONB` | NULL | `NULL` | Additional context for this event (e.g., `{"renewal_attempt": 2, "failure_code": "insufficient_funds"}` for a payment failure event, or `{"admin_note": "Manually activated for scholarship student"}` for an admin action) |
| `occurred_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Timestamp when the state change occurred. Always UTC. The ordering column for history display |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Row insertion timestamp. Equivalent to `occurred_at` in synchronous flows |

---

### Primary Key

```
PRIMARY KEY (history_id)
```

---

### Foreign Keys

```
subscription_id → student_subscriptions.subscription_id   ON DELETE CASCADE    ON UPDATE RESTRICT
student_id      → student_details.student_id              ON DELETE RESTRICT   ON UPDATE RESTRICT
institute_id    → institutes.institute_id                 ON DELETE RESTRICT   ON UPDATE RESTRICT
changed_by      → profiles.profile_id                     ON DELETE SET NULL   ON UPDATE RESTRICT
```

---

### Unique Constraints

None. Multiple history rows for the same subscription are expected and valid.

---

### CHECK Constraints

```
CHECK (status_before IS NULL OR status_before != status_after)
CHECK (
  changed_by IS NOT NULL OR changed_by_role IS NULL
)
```

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_sub_history_subscription_occurred` | `(subscription_id, occurred_at DESC)` | B-tree | Timeline view: all events for a specific subscription |
| `idx_sub_history_student_occurred` | `(student_id, occurred_at DESC)` | B-tree | Student support panel: full subscription history for a student |
| `idx_sub_history_institute_reason` | `(institute_id, change_reason, occurred_at DESC)` | B-tree | Churn analytics: all `payment_failure` events in an institute this month |

---

### Soft Delete Strategy

None. Append-only. No row is ever updated or deleted until the configured data retention purge.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `occurred_at` | ✅ | Authoritative event timestamp |
| `created_at` | ✅ | Row insertion timestamp |
| `changed_by` | ✅ | Actor attribution |
| `changed_by_role` | ✅ | Denormalized role; preserved after actor deactivation |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE parent subscription | `CASCADE` | History is meaningless without the subscription |
| DELETE student | `RESTRICT` | Student data must be retained |
| DELETE admin (changed_by) | `SET NULL` | Attribution degrades gracefully |

---

### Supabase RLS Considerations

```
Table: subscription_history
RLS: ENABLED

SELECT:
  - Students may read history rows for their own subscriptions.
    USING: student_id = (
      SELECT student_id FROM student_details WHERE profile_id = auth.uid()
    )

  - Admins may read all history within their institute.
    USING: institute_id = get_my_institute_id()
      AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')

INSERT:
  - Blocked for all client roles. Written by service_role only.

UPDATE / DELETE:
  - Blocked for ALL roles. Immutable record.
```

---

## Table 6: `subscription_renewals`

### Purpose

Records every successful or attempted renewal event for a subscription. One row per renewal attempt. Provides a detailed renewal ledger separate from the history log — the history captures status transitions, while renewals capture the financial specifics of each renewal cycle.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `renewal_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `subscription_id` | `UUID` | NOT NULL | — | FK → `student_subscriptions.subscription_id` |
| `student_id` | `UUID` | NOT NULL | — | FK → `student_details.student_id`. Denormalized |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS |
| `order_id` | `UUID` | NULL | `NULL` | FK → `orders.order_id`. The new order created for this renewal. NULL for failed renewal attempts where no order was created |
| `attempted_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | When the renewal was attempted |
| `succeeded_at` | `TIMESTAMPTZ` | NULL | `NULL` | When the renewal payment was confirmed. NULL for failed attempts |
| `amount_charged` | `NUMERIC(10, 2)` | NULL | `NULL` | The amount actually charged in this renewal cycle. May differ from `plan.price` if a discount was applied. NULL for failed attempts |
| `currency_code` | `CHAR(3)` | NOT NULL | `'INR'` | Currency of the charge |
| `payment_reference` | `TEXT` | NULL | `NULL` | Payment gateway transaction ID for this renewal payment. NULL for failed attempts |
| `failure_code` | `TEXT` | NULL | `NULL` | Payment gateway failure code for failed attempts (e.g., `insufficient_funds`, `card_expired`, `do_not_honor`). NULL for successful renewals |
| `failure_message` | `TEXT` | NULL | `NULL` | Human-readable failure description from the payment gateway. Used in customer support context. NULL for successful renewals |
| `attempt_number` | `SMALLINT` | NOT NULL | `1` | Which attempt number this is for the current renewal cycle. The first attempt is 1; subsequent retries increment this. Reset to 1 on a new billing period |
| `new_end_date` | `DATE` | NULL | `NULL` | The new `end_date` set on the `student_subscriptions` row after a successful renewal. NULL for failed attempts |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Row creation timestamp |

---

### Primary Key

```
PRIMARY KEY (renewal_id)
```

---

### Foreign Keys

```
subscription_id → student_subscriptions.subscription_id   ON DELETE CASCADE   ON UPDATE RESTRICT
student_id      → student_details.student_id              ON DELETE RESTRICT  ON UPDATE RESTRICT
institute_id    → institutes.institute_id                 ON DELETE RESTRICT  ON UPDATE RESTRICT
order_id        → orders.order_id                        ON DELETE SET NULL  ON UPDATE RESTRICT
```

---

### Unique Constraints

None. Multiple renewal attempts per subscription per billing cycle are expected.

---

### CHECK Constraints

```
CHECK (amount_charged IS NULL OR amount_charged >= 0.00)
CHECK (attempt_number >= 1)
CHECK (
  (succeeded_at IS NOT NULL AND failure_code IS NULL AND amount_charged IS NOT NULL AND new_end_date IS NOT NULL)
  OR
  (succeeded_at IS NULL AND new_end_date IS NULL)
)
```

> The final CHECK ensures that a successful renewal has all required success fields populated, and a failed attempt has them NULL. No partial success states.

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_renewals_subscription_id` | `(subscription_id, attempted_at DESC)` | B-tree | Full renewal history for a subscription |
| `idx_renewals_institute_succeeded` | `(institute_id, succeeded_at DESC)` WHERE `succeeded_at IS NOT NULL` | B-tree (partial) | Revenue recognition: all successful renewals in an institute by date |
| `idx_renewals_failure_code` | `(institute_id, failure_code, attempted_at DESC)` WHERE `failure_code IS NOT NULL` | B-tree (partial) | Payment failure analysis: most common failure codes |

---

### Soft Delete / Audit Fields

No soft delete. Append-only. `created_at` and `attempted_at` are the audit timestamps.

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE parent subscription | `CASCADE` | Renewal records are meaningless without the subscription |
| DELETE order | `SET NULL` | Renewal record preserved without the order reference |

---

### Supabase RLS Considerations

```
Table: subscription_renewals
RLS: ENABLED

SELECT:
  - Students: read their own renewal records only.
    USING: student_id = (
      SELECT student_id FROM student_details WHERE profile_id = auth.uid()
    )

  - Admins: read all within their institute.
    USING: institute_id = get_my_institute_id()
      AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')

INSERT / UPDATE / DELETE:
  - service_role only (payment webhook handler).
```

---

## Table 7: `subscription_cancellations`

### Purpose

Records the details of every subscription cancellation event. One row per cancellation. Captures the student-provided or admin-provided reason, refund eligibility, and whether a partial refund was issued. This is the primary data source for churn analysis and refund processing.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `cancellation_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `subscription_id` | `UUID` | NOT NULL | — | FK → `student_subscriptions.subscription_id` |
| `student_id` | `UUID` | NOT NULL | — | FK → `student_details.student_id`. Denormalized |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS |
| `cancelled_by` | `UUID` | NULL | `NULL` | FK → `profiles.profile_id`. The actor who cancelled. NULL for system-initiated cancellations (e.g., fraud detection, plan discontinuation) |
| `cancelled_by_role` | `user_role_type` | NULL | `NULL` | Denormalized role of `cancelled_by`. NULL for system cancellations |
| `reason` | `cancellation_reason_type` | NOT NULL | — | Structured reason for cancellation |
| `reason_detail` | `TEXT` | NULL | `NULL` | Free-text elaboration on the reason. For `student_request`, this is the student's optional comment. For `admin_action`, this is the admin's mandatory note. Maximum 1000 characters |
| `effective_date` | `DATE` | NOT NULL | — | The date from which access is revoked. For immediate cancellations: today's date. For end-of-period cancellations: the subscription's `end_date` (student retains access until the period they paid for ends) |
| `days_used` | `SMALLINT` | NOT NULL | `0` | Number of days the student used the subscription before cancellation. Computed as `effective_date - start_date`. Used for prorated refund calculations |
| `days_remaining` | `SMALLINT` | NOT NULL | `0` | Number of days remaining in the subscription period at cancellation. Computed as `end_date - effective_date`. Used for prorated refund calculations |
| `refund_eligible` | `BOOLEAN` | NOT NULL | `FALSE` | Whether the student is eligible for a (full or partial) refund based on the institute's refund policy. Computed at cancellation time from `system_settings.refund_policy_*` settings |
| `refund_amount` | `NUMERIC(10, 2)` | NULL | `NULL` | The refund amount to be issued, if `refund_eligible = TRUE`. NULL until the refund is computed and approved. May be 0.00 if eligible but no refund is due |
| `refund_processed_at` | `TIMESTAMPTZ` | NULL | `NULL` | When the refund was actually processed via the payment gateway. NULL until processed |
| `cancelled_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | When the cancellation event was recorded. Always UTC |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Row creation timestamp |

---

### Primary Key

```
PRIMARY KEY (cancellation_id)
```

---

### Foreign Keys

```
subscription_id → student_subscriptions.subscription_id   ON DELETE CASCADE    ON UPDATE RESTRICT
student_id      → student_details.student_id              ON DELETE RESTRICT   ON UPDATE RESTRICT
institute_id    → institutes.institute_id                 ON DELETE RESTRICT   ON UPDATE RESTRICT
cancelled_by    → profiles.profile_id                     ON DELETE SET NULL   ON UPDATE RESTRICT
```

---

### Unique Constraints

```
UNIQUE (subscription_id)
```

> One cancellation record per subscription. A subscription can only be cancelled once. If a cancelled subscription is somehow re-activated and then cancelled again (edge case: admin re-activates then a second cancellation occurs), the existing row should be updated — not a second row inserted.

---

### CHECK Constraints

```
CHECK (days_used >= 0)
CHECK (days_remaining >= 0)
CHECK (refund_amount IS NULL OR refund_amount >= 0.00)
CHECK (char_length(reason_detail) <= 1000)
CHECK (effective_date >= (
  SELECT start_date FROM student_subscriptions
  WHERE subscription_id = subscription_cancellations.subscription_id
))
```

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_cancellations_institute_reason` | `(institute_id, reason, cancelled_at DESC)` | B-tree | Churn analysis: cancellations by reason per institute per period |
| `idx_cancellations_refund_eligible` | `(institute_id, refund_eligible, refund_processed_at)` WHERE `refund_eligible = TRUE AND refund_processed_at IS NULL` | B-tree (partial) | Pending refund queue: unprocessed eligible refunds |

---

### Supabase RLS Considerations

```
Table: subscription_cancellations
RLS: ENABLED

SELECT:
  - Students: read their own cancellation record.
    USING: student_id = (
      SELECT student_id FROM student_details WHERE profile_id = auth.uid()
    )

  - Admins: read all within their institute.
    USING: institute_id = get_my_institute_id()
      AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')

INSERT / UPDATE:
  - service_role only.

DELETE:
  - Blocked for all roles. Cancellation records are permanent.
```

---

## Table 8: `subscription_grace_periods`

### Purpose

Tracks active grace period windows. When a subscription's `end_date` passes without a successful renewal (due to payment failure or non-renewal), the subscription enters `status = 'grace'` and a `subscription_grace_periods` row is created. The student retains access during the grace window to complete payment.

This table is the operational record for the grace period workflow — it is queried by the grace expiry job to find grace periods that have ended and transition the subscription to `expired`.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `grace_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `subscription_id` | `UUID` | NOT NULL | — | FK → `student_subscriptions.subscription_id` |
| `student_id` | `UUID` | NOT NULL | — | FK → `student_details.student_id`. Denormalized |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS |
| `grace_start_date` | `DATE` | NOT NULL | — | The date the grace period began. Typically the day after the subscription's `end_date` |
| `grace_end_date` | `DATE` | NOT NULL | — | The last date of the grace period. After this date, if unresolved, the grace expiry job transitions the subscription to `expired`. Computed as `grace_start_date + system_settings.grace_period_days` |
| `trigger_reason` | `TEXT` | NOT NULL | — | Why the grace period was triggered: `'payment_failure'`, `'auto_renewal_failed'`, `'manual_expiry'` |
| `resolution` | `grace_period_resolution_type` | NULL | `NULL` | How the grace period ended. NULL while the grace period is still active. Set when the grace period resolves: `payment_recovered`, `expired_no_payment`, `admin_waived`, `cancelled` |
| `resolved_at` | `TIMESTAMPTZ` | NULL | `NULL` | When the grace period was resolved. NULL while active. Set when `resolution` is set |
| `reminders_sent` | `SMALLINT` | NOT NULL | `0` | Count of payment reminder notifications sent to the student during this grace period. Used to avoid sending excessive reminders (cap at `system_settings.grace_reminder_max`) |
| `last_reminder_sent_at` | `TIMESTAMPTZ` | NULL | `NULL` | Timestamp of the most recent reminder notification sent. Used by the reminder job to enforce minimum interval between reminders |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Row creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Trigger-maintained; updated when `resolution`, `resolved_at`, or `reminders_sent` are updated |

---

### Primary Key

```
PRIMARY KEY (grace_id)
```

---

### Foreign Keys

```
subscription_id → student_subscriptions.subscription_id   ON DELETE CASCADE   ON UPDATE RESTRICT
student_id      → student_details.student_id              ON DELETE RESTRICT  ON UPDATE RESTRICT
institute_id    → institutes.institute_id                 ON DELETE RESTRICT  ON UPDATE RESTRICT
```

---

### Unique Constraints

```
UNIQUE (subscription_id)
  WHERE resolution IS NULL
```

> A subscription can only have one active (unresolved) grace period at a time. Once resolved, a new grace period can be created if the subscription re-enters grace (unusual but possible after admin re-activation). Implemented as a partial unique index.

---

### CHECK Constraints

```
CHECK (grace_end_date > grace_start_date)
CHECK (reminders_sent >= 0)
CHECK (
  (resolution IS NULL AND resolved_at IS NULL)
  OR (resolution IS NOT NULL AND resolved_at IS NOT NULL)
)
```

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_grace_periods_expiry_job` | `(grace_end_date, resolution)` WHERE `resolution IS NULL` | B-tree (partial) | Grace expiry job: find all unresolved grace periods whose window has passed |
| `idx_grace_periods_reminder_job` | `(last_reminder_sent_at, resolution)` WHERE `resolution IS NULL` | B-tree (partial) | Reminder job: find active grace periods due for a reminder |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE parent subscription | `CASCADE` | Grace period is meaningless without the subscription |

---

### Supabase RLS Considerations

```
Table: subscription_grace_periods
RLS: ENABLED

SELECT:
  - Students: read their own grace period record.
    USING: student_id = (
      SELECT student_id FROM student_details WHERE profile_id = auth.uid()
    )

  - Admins: read all within their institute.
    USING: institute_id = get_my_institute_id()
      AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')

INSERT / UPDATE:
  - service_role only (renewal failure handler and grace expiry job).

DELETE:
  - Blocked for all client roles.
```

---

## Table 9: `subscription_usage`

### Purpose

Rolling usage counters per student per feature per billing period. Tracks how many times a student has consumed a quantifiable feature (e.g., "attempted 7 out of 10 allowed mock tests this month") against the limit defined in `plan_unlocks`.

This table is read on every access check for quantifiable features and is one of the highest-frequency write targets in the Subscriptions domain. Every mock test attempt, every PYQ download, every content download increments a counter here.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `usage_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `subscription_id` | `UUID` | NOT NULL | — | FK → `student_subscriptions.subscription_id`. The subscription this usage is counted against |
| `student_id` | `UUID` | NOT NULL | — | FK → `student_details.student_id`. Denormalized for direct lookups |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS |
| `feature_id` | `UUID` | NOT NULL | — | FK → `subscription_features.feature_id`. Which feature is being counted |
| `period_start` | `DATE` | NOT NULL | — | Start of the usage counting period. For monthly limits: the subscription's billing cycle start date for this period. For daily limits: today's date. Derived from `plan_unlocks.limit_period_days` and the subscription start date |
| `period_end` | `DATE` | NOT NULL | — | End of the usage counting period (inclusive). `period_start + limit_period_days - 1` |
| `used_count` | `INTEGER` | NOT NULL | `0` | The number of times this feature has been consumed in this period. Incremented atomically on each feature use |
| `limit_snapshot` | `INTEGER` | NULL | `NULL` | Snapshot of `plan_unlocks.limit_value` at the time this usage period row was created. Stored here so that if the plan's limit changes mid-period, existing usage rows reflect the limit the student was under for that period. NULL for unlimited features |
| `last_used_at` | `TIMESTAMPTZ` | NULL | `NULL` | Timestamp of the most recent feature consumption event. NULL until first use. Used for "last used" display and suspicious activity detection |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Row creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Last modification timestamp. Trigger-maintained |

---

### Primary Key

```
PRIMARY KEY (usage_id)
```

---

### Foreign Keys

```
subscription_id → student_subscriptions.subscription_id   ON DELETE CASCADE    ON UPDATE RESTRICT
student_id      → student_details.student_id              ON DELETE RESTRICT   ON UPDATE RESTRICT
institute_id    → institutes.institute_id                 ON DELETE RESTRICT   ON UPDATE RESTRICT
feature_id      → subscription_features.feature_id        ON DELETE RESTRICT   ON UPDATE RESTRICT
```

---

### Composite Keys

No composite PK. The natural candidate `(subscription_id, feature_id, period_start)` is enforced via a unique constraint.

---

### Unique Constraints

```
UNIQUE (subscription_id, feature_id, period_start)
```

> One usage row per subscription per feature per period. The UPSERT target: `ON CONFLICT (subscription_id, feature_id, period_start) DO UPDATE SET used_count = subscription_usage.used_count + 1, last_used_at = NOW(), updated_at = NOW()`.

---

### CHECK Constraints

```
CHECK (used_count >= 0)
CHECK (period_end >= period_start)
CHECK (limit_snapshot IS NULL OR limit_snapshot >= 0)
CHECK (
  used_count <= COALESCE(limit_snapshot, 2147483647)
)
```

> The final CHECK provides a database-level cap: `used_count` cannot exceed `limit_snapshot` (or `INT` max for unlimited features). This is a safety net; the primary enforcement is in the backend service's atomic increment with pre-check.

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_usage_subscription_feature_period` | `(subscription_id, feature_id, period_start)` | B-tree (covered by UNIQUE) | Primary access-check read: "how many times has this student used feature X in this period?" |
| `idx_usage_student_feature_period` | `(student_id, feature_id, period_end DESC)` | B-tree | Student usage dashboard: consumption history across all features |
| `idx_usage_feature_institute` | `(institute_id, feature_id, period_start DESC)` | B-tree | Admin analytics: aggregate feature consumption across the institute per period |

---

### Soft Delete / Audit Fields

No soft delete. Usage rows accumulate per period and are retained for the data retention window. `created_at`, `updated_at`, and `last_used_at` are the audit fields.

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE parent subscription | `CASCADE` | Usage counters are meaningless without the subscription |
| DELETE feature | `RESTRICT` | Cannot delete a feature with usage history |

---

### Supabase RLS Considerations

```
Table: subscription_usage
RLS: ENABLED

SELECT:
  - Students: read their own usage rows.
    USING: student_id = (
      SELECT student_id FROM student_details WHERE profile_id = auth.uid()
    )

  - Admins: read all within their institute.
    USING: institute_id = get_my_institute_id()
      AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')

INSERT:
  - Blocked for all client roles. Written by the feature-use handler
    (service_role) via atomic UPSERT.

UPDATE:
  - Blocked for all client roles. The UPSERT pattern handles all increments.

DELETE:
  - Blocked for all client roles.
```

---

### Backend Developer Notes

1. **Atomic increment with cap enforcement.** The correct usage increment pattern is a single SQL statement: `INSERT INTO subscription_usage (subscription_id, student_id, institute_id, feature_id, period_start, period_end, used_count, limit_snapshot, last_used_at) VALUES ($1, $2, $3, $4, $5, $6, 1, $limit, NOW()) ON CONFLICT (subscription_id, feature_id, period_start) DO UPDATE SET used_count = subscription_usage.used_count + 1, last_used_at = NOW(), updated_at = NOW() WHERE subscription_usage.used_count < subscription_usage.limit_snapshot RETURNING used_count`. If this UPDATE returns 0 rows (the `WHERE` clause blocked it), the student has hit their limit — return a 429 or a domain-specific limit-exceeded error.

2. **Period boundaries must be precomputed, not dynamic.** Before upserting a usage row, the backend service must compute `period_start` and `period_end` from the subscription's `start_date` and the plan's `limit_period_days`. For a student subscribed on 2025-03-15 with a 30-day period, the periods are: 2025-03-15 → 2025-04-13, then 2025-04-14 → 2025-05-13. Periods are subscription-relative, not calendar-month-aligned. This is intentional — it prevents the abuse pattern of "subscribe on Jan 31 to get two months' worth of daily limits in one calendar month."

3. **Cache the usage counter, not just the limit.** Cache `(student_id, feature_id, period)` → `used_count` in Redis with a TTL equal to the remaining time in the current period. Increment the cache atomically alongside the database write (`INCR` in Redis). This eliminates the database read on every access check for quantifiable features.

---

## Domain 11 — Design Decisions Summary

| Decision | Choice | Reason |
|----------|--------|--------|
| Feature catalogue as a separate table | `subscription_features` | Single source of truth for all gatable features; prevents hardcoded feature strings scattered across microservices |
| Plan unlocks as a junction table | `plan_unlocks` with `limit_value` + `limit_period_days` | Decouples plan definition from feature access; allows the same plan to be modified without schema changes |
| `student_subscriptions.status` as the sole access gate | Enum with 6 states | Status is the runtime truth; date-only checks are insufficient (a subscription may be date-valid but payment-failed) |
| Grace period as a first-class table | `subscription_grace_periods` | Grace periods require operational tracking (reminder count, resolution type) beyond a simple boolean flag |
| `subscription_history` append-only | Never UPDATE or DELETE | Commercial audit trail; required for dispute resolution and churn analysis |
| Separate `subscription_renewals` table | Not merged into history | Renewal events carry financial data (amount, failure code) that is different in kind from status-change events; separation keeps both tables clean |
| Separate `subscription_cancellations` table | Not merged into history | Cancellation carries refund eligibility and prorated calculation data; structured separately for refund processing workflow |
| Usage period is subscription-relative | `period_start` based on `start_date`, not calendar month | Prevents gaming monthly limits at calendar month boundaries |
| `limit_snapshot` on `subscription_usage` | Denormalized from `plan_unlocks.limit_value` | If the plan's limit is changed mid-period, existing usage rows retain the limit the student was under for that period — correct and fair |
| `payment_method_id` stored as gateway token | TEXT, not card data | PCI DSS compliance; raw card data must never touch the platform database |
| `UNIQUE (student_id, plan_id, start_date)` on subscriptions | Allows sequential renewals as separate rows | Each renewal cycle is a distinct subscription row; history is preserved without a separate history table for this data |
| Cascade DELETE from subscription to children | Applied to history, renewals, grace, usage | All are financially meaningless without the subscription parent; only triggered by data retention purge, never by normal operations |

---

## Domain 11 — Relationships to Other Domains

| This Table | References | Via Column | Domain |
|------------|-----------|------------|--------|
| `subscription_plans` | `institutes` | `institute_id` | Domain 2 (Institute) |
| `subscription_plans` | `streams` | `stream_id` | Domain 3 (Academic Structure) |
| `subscription_plans` | `profiles` | `created_by`, `updated_by` | Domain 1 (Identity) |
| `plan_unlocks` | `subscription_plans` | `plan_id` | This domain |
| `plan_unlocks` | `subscription_features` | `feature_id` | This domain |
| `student_subscriptions` | `student_details` | `student_id` | Domain 1 (Identity) |
| `student_subscriptions` | `subscription_plans` | `plan_id` | This domain |
| `student_subscriptions` | `institutes` | `institute_id` | Domain 2 (Institute) |
| `student_subscriptions` | `orders` | `order_id` | Domain 12 (Commerce) |
| `subscription_history` | `student_subscriptions` | `subscription_id` | This domain |
| `subscription_history` | `profiles` | `changed_by` | Domain 1 (Identity) |
| `subscription_renewals` | `student_subscriptions` | `subscription_id` | This domain |
| `subscription_renewals` | `orders` | `order_id` | Domain 12 (Commerce) |
| `subscription_cancellations` | `student_subscriptions` | `subscription_id` | This domain |
| `subscription_cancellations` | `profiles` | `cancelled_by` | Domain 1 (Identity) |
| `subscription_grace_periods` | `student_subscriptions` | `subscription_id` | This domain |
| `subscription_usage` | `student_subscriptions` | `subscription_id` | This domain |
| `subscription_usage` | `subscription_features` | `feature_id` | This domain |

| This Table | Referenced By | Via Column | Domain |
|------------|--------------|------------|--------|
| `subscription_plans` | `order_items` | `plan_id` | Domain 12 (Commerce) |
| `subscription_plans` | `student_subscriptions` | `plan_id` | This domain |
| `subscription_features` | `plan_unlocks` | `feature_id` | This domain |
| `subscription_features` | `subscription_usage` | `feature_id` | This domain |
| `student_subscriptions` | `subscription_history` | `subscription_id` | This domain |
| `student_subscriptions` | `subscription_renewals` | `subscription_id` | This domain |
| `student_subscriptions` | `subscription_cancellations` | `subscription_id` | This domain |
| `student_subscriptions` | `subscription_grace_periods` | `subscription_id` | This domain |
| `student_subscriptions` | `subscription_usage` | `subscription_id` | This domain |
| `student_subscriptions` | `audit_logs` | `resource_id` | Domain 10 (Administration) |

---

## Domain 11 — Entity Relationship Summary (Textual)

```
subscription_plans (1) ──────── (M) plan_unlocks ──────────── (M:1) subscription_features
        │
        │ (1:M)
        │
student_subscriptions  ◄── student_details (M:1)
        │
        ├── (1:M) subscription_history       [append-only state log]
        ├── (1:M) subscription_renewals      [financial renewal ledger]
        ├── (1:1) subscription_cancellations [cancellation + refund record]
        ├── (1:1) subscription_grace_periods [grace window tracker]
        └── (1:M) subscription_usage         [rolling feature usage counters]
                        │
                        └── (M:1) subscription_features
```

---

*Domain 11 — Subscription & Access Control is complete.*
*Awaiting your approval before proceeding to the next domain.*
