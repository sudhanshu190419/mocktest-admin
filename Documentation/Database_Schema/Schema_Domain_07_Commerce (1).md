# EdTech Platform — Database Schema Specification
## Domain 7: Commerce
### Tables: `orders` · `order_items` · `payments` · `invoices`

**Document version:** 1.1 *(amended: Order → Payment cardinality changed to 1:M; `attempt_number` and `gateway_response` added to `payments`)*
**ERD reference:** ERD v2.0 (Relationships R56–R61)
**PostgreSQL target:** 16
**Supabase compatibility:** Yes
**Domain sequence:** Phase 7 of 15

---

## Domain Overview

The Commerce domain is the financial backbone of the platform. It handles the complete purchase lifecycle — from a student adding items to a cart, through payment capture, to invoice generation. All monetary transactions flow through this domain.

This domain interacts with **Domain 5 (Subscription & Packages)** for purchasable items, **Domain 1 (Foundation)** for student identity, and is referenced by **Domain 11 (Analytics)** for revenue dashboards.

**Tables in this domain (in dependency order):**

| # | Table | Role |
|---|-------|------|
| 1 | `orders` | The root purchase event; one per checkout session |
| 2 | `order_items` | Individual line items within an order |
| 3 | `payments` | Payment gateway transaction records (1:M with order — one per attempt) |
| 4 | `invoices` | GST/tax invoice generated after payment (1:1 with order) |

---

## Enum Types Referenced

The following enums are defined globally (see Domain 1 — Pre-Domain Notes). They are referenced throughout this document.

| Enum Name | Values | Used By |
|-----------|--------|---------|
| `order_status` | `pending`, `confirmed`, `cancelled`, `refunded` | `orders.status` |
| `payment_status` | `pending`, `captured`, `failed`, `refunded`, `partially_refunded` | `payments.status` |
| `payment_gateway` | `razorpay`, `stripe`, `payu`, `cashfree` | `payments.gateway` |
| `invoice_status` | `draft`, `issued`, `cancelled` | `invoices.status` |
| `item_type` | `subscription_plan`, `pyq_package` | `order_items.item_type` |

> **Implementation note:** These enums must already exist before this domain's tables are created. If adding a new gateway (e.g., `phonepe`), use `ALTER TYPE payment_gateway ADD VALUE 'phonepe'`. This is a safe, non-blocking operation in PostgreSQL 16.

---

## New Enum Types Defined in This Domain

| Enum Name | Values | Used By | Reason |
|-----------|--------|---------|--------|
| `currency_code` | `INR`, `USD`, `AED`, `GBP` | `orders.currency` | ISO 4217 currency codes relevant to the target market. Kept as enum (not free text) to prevent malformed currency codes corrupting financial calculations |

> Start with `INR` only if the product is India-only. Add values as international expansion occurs. Do not use `VARCHAR` for currency — a typo in `currency` can corrupt financial aggregation.

---

## Table 1: `orders`

### Purpose

The `orders` table is the root financial entity. Every time a student initiates a checkout — whether purchasing a subscription plan, a PYQ package, or a combination of both — a single order row is created. The order acts as the parent for all line items, the payment record, and the invoice.

An order has a defined lifecycle:
- `pending` → created but not yet paid
- `confirmed` → payment captured successfully
- `cancelled` → abandoned or cancelled by student/admin
- `refunded` → payment was reversed (full or partial)

Orders must never be deleted. They are the financial source of truth and are legally required to be retained for a minimum of 7 years (GST compliance in India).

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `order_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS and multi-tenant query isolation. All financial queries must be scoped by institute |
| `student_id` | `UUID` | NOT NULL | — | FK → `student_details.student_id`. The purchasing student |
| `status` | `order_status` | NOT NULL | `'pending'` | Lifecycle state of the order |
| `currency` | `currency_code` | NOT NULL | `'INR'` | ISO 4217 currency code. All amounts in this order are denominated in this currency |
| `subtotal_amount` | `NUMERIC(12, 2)` | NOT NULL | `0.00` | Sum of all `order_items.unit_price × quantity` before tax and discounts. Stored for audit; recalculated at checkout |
| `discount_amount` | `NUMERIC(12, 2)` | NOT NULL | `0.00` | Total discount applied (coupon, promotional, etc.). Must be ≥ 0 |
| `tax_amount` | `NUMERIC(12, 2)` | NOT NULL | `0.00` | GST or applicable tax. Must be ≥ 0 |
| `total_amount` | `NUMERIC(12, 2)` | NOT NULL | `0.00` | Final payable amount. Must equal `subtotal_amount - discount_amount + tax_amount` (enforced at API layer, not DB) |
| `coupon_code` | `VARCHAR(50)` | NULL | `NULL` | Coupon code applied, if any. Stored as plain text for display and audit. Coupon logic lives in the application layer |
| `notes` | `TEXT` | NULL | `NULL` | Internal admin notes or student-provided purchase notes |
| `placed_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Timestamp when the student initiated checkout. Always UTC |
| `confirmed_at` | `TIMESTAMPTZ` | NULL | `NULL` | Timestamp when payment was successfully captured. NULL until confirmed |
| `cancelled_at` | `TIMESTAMPTZ` | NULL | `NULL` | Timestamp when the order was cancelled. NULL unless cancelled |
| `refunded_at` | `TIMESTAMPTZ` | NULL | `NULL` | Timestamp when a refund was processed. NULL unless refunded |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Audit creation timestamp. Always UTC |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Last modification timestamp. Trigger-maintained |

---

### Primary Key

```
PRIMARY KEY (order_id)
```

---

### Foreign Keys

```
institute_id → institutes.institute_id   ON DELETE RESTRICT   ON UPDATE RESTRICT
student_id   → student_details.student_id   ON DELETE RESTRICT   ON UPDATE RESTRICT
```

> **Cascade rationale:** Financial records must survive even if a student's profile is deactivated. `RESTRICT` on both FKs prevents any accidental cascading deletion of order history.

---

### Composite Keys

None. `order_id` is the sole primary key. No natural composite candidate exists.

---

### Unique Constraints

None at the table level. A student may legitimately place multiple orders (including re-purchasing after a lapse or purchasing different item combinations). Uniqueness is enforced at the business logic layer (e.g., prevent duplicate active subscriptions).

---

### CHECK Constraints

```
CHECK (subtotal_amount >= 0)
CHECK (discount_amount >= 0)
CHECK (tax_amount >= 0)
CHECK (total_amount >= 0)
CHECK (discount_amount <= subtotal_amount)
CHECK (confirmed_at IS NULL OR confirmed_at >= placed_at)
CHECK (cancelled_at IS NULL OR cancelled_at >= placed_at)
CHECK (refunded_at IS NULL OR refunded_at >= placed_at)
CHECK (
  (status = 'confirmed' AND confirmed_at IS NOT NULL) OR
  (status != 'confirmed' AND confirmed_at IS NULL)
)
```

> **Note on `total_amount` consistency:** The constraint `total_amount = subtotal_amount - discount_amount + tax_amount` is enforced in the API layer (Zod/Joi schema validation before INSERT), not at the DB level. A DB CHECK on computed columns is fragile during partial updates. Validate fully in the service layer before writing.

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_orders_institute_student` | `(institute_id, student_id)` | B-tree | Primary access pattern: "all orders for a student in this institute" |
| `idx_orders_institute_status` | `(institute_id, status)` | B-tree | Admin dashboard: filter pending/confirmed/refunded orders per institute |
| `idx_orders_institute_placed_at` | `(institute_id, placed_at DESC)` | B-tree | Revenue timeline queries; most recent orders first |
| `idx_orders_student_placed_at` | `(student_id, placed_at DESC)` | B-tree | Student's own purchase history, sorted newest first |
| `idx_orders_coupon_code` | `(coupon_code)` | B-tree | Coupon redemption analytics. Partial index: `WHERE coupon_code IS NOT NULL` |

> **Partitioning note:** At hundreds of thousands of users with frequent purchases, `orders` will grow large. Consider range partitioning by `placed_at` (monthly or quarterly) when the table exceeds 10 million rows. This is a future migration concern, not Day 1.

---

### Soft Delete Strategy

`orders` must **never** be soft-deleted or hard-deleted. Financial records are legally required for 7+ years. Status transitions (`cancelled`, `refunded`) serve as the lifecycle termination mechanism. If regulatory archival is needed after the retention period, export to cold storage; do not DELETE from the database.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `updated_at` | ✅ | Trigger-maintained |
| `placed_at` | ✅ | Business-level: when the student initiated checkout (distinct from DB insert time) |
| `confirmed_at` | ✅ | Financial event timestamp |
| `cancelled_at` | ✅ | Financial event timestamp |
| `refunded_at` | ✅ | Financial event timestamp |
| `created_by` | ❌ | Always the authenticated student; derivable from `student_id` + RLS context |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE order | `RESTRICT` | Financial records are legally retained |
| DELETE institute | `RESTRICT` | Institute deletion blocked system-wide |
| DELETE student | `RESTRICT` | Cannot destroy financial history |
| UPDATE order_id | `RESTRICT` | PK must never change |
| UPDATE institute_id | `RESTRICT` | Immutable after creation |

---

### Supabase RLS Considerations

```
Table: orders
RLS: ENABLED

SELECT:
  - Students may read their own orders only.
    USING: student_id = (SELECT student_id FROM student_details WHERE profile_id = auth.uid())
    AND institute_id = get_my_institute_id()

  - Teachers: no access. Teachers do not see student financial data.

  - Admins may read all orders within their institute.
    USING: institute_id = get_my_institute_id()
      AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')

INSERT:
  - Students may insert their own orders.
    WITH CHECK: institute_id = get_my_institute_id()
      AND student_id = (SELECT student_id FROM student_details WHERE profile_id = auth.uid())
      AND status = 'pending'
    (Only 'pending' orders may be created by the client. Status transitions happen via Edge Functions.)

UPDATE:
  - Students: blocked. Status transitions (pending → confirmed, etc.) are performed exclusively
    by backend Edge Functions using the service_role key after verifying payment gateway webhooks.
  - Admins may update notes, cancelled_at, refunded_at via Edge Function.
  - Direct client-side UPDATE on orders is BLOCKED for all roles.

DELETE:
  - Blocked for all roles at RLS level.
```

> **Critical pattern:** The `confirmed_at` timestamp and `status = 'confirmed'` transition must only be set by a payment gateway webhook handler (Edge Function with service_role). Never allow the client to set order status directly. A student could self-confirm an unpaid order otherwise.

---

### Backend Developer Notes

1. **Monetary precision — use `NUMERIC(12, 2)` exclusively.** Never use `FLOAT` or `DOUBLE PRECISION` for money. Floating-point arithmetic produces rounding errors in financial aggregation. `NUMERIC(12, 2)` stores up to ₹9,999,999,999.99 exactly.

2. **Currency at order level, not item level.** All `order_items` in one order share the same currency (from `orders.currency`). The system does not support multi-currency line items in a single order.

3. **`placed_at` vs `created_at`.** `placed_at` is the business timestamp (when the student clicked "Pay"). `created_at` is the DB insert timestamp. They are nearly always identical, but `placed_at` is what appears on invoices and revenue reports. Keep both.

4. **Status transitions via Edge Function only.** Write a `confirm_order(order_id, payment_id)` Edge Function that atomically: (a) verifies payment from gateway, (b) updates `orders.status = 'confirmed'` and `confirmed_at`, (c) creates `student_subscription` or `student_pyq_purchase` rows, (d) triggers invoice generation. This is not a client-side operation.

5. **Coupon codes are stored, not enforced, in the DB.** Store the applied `coupon_code` for audit and analytics. All coupon validation, expiry, and usage-count enforcement happen in the API layer before the order is written.

6. **Zero-amount orders are valid.** A 100% discounted order has `total_amount = 0.00`. Handle this in the payment flow — skip the payment gateway for ₹0 orders and directly confirm them.

---

## Table 2: `order_items`

### Purpose

Stores individual line items within an order. An order may contain one or more items. Each item represents either a `subscription_plan` or a `pyq_package`.

The polymorphic nature of `item_type` (a student can purchase a plan and a package in the same cart) is resolved via two nullable foreign keys: `plan_id` and `package_id`. Exactly one of them is populated based on `item_type`.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `item_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `order_id` | `UUID` | NOT NULL | — | FK → `orders.order_id`. Parent order |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS and per-institute financial reporting |
| `item_type` | `item_type` | NOT NULL | — | Enum: `subscription_plan` or `pyq_package`. Controls which FK is populated |
| `plan_id` | `UUID` | NULL | `NULL` | FK → `subscription_plans.plan_id`. Populated when `item_type = 'subscription_plan'` |
| `package_id` | `UUID` | NULL | `NULL` | FK → `pyq_packages.package_id`. Populated when `item_type = 'pyq_package'` |
| `item_name` | `VARCHAR(255)` | NOT NULL | — | Snapshot of the item name at time of purchase. Stored because plan/package names may change after purchase |
| `unit_price` | `NUMERIC(12, 2)` | NOT NULL | — | Price per unit at time of purchase. Snapshot — not a live FK to current plan price |
| `quantity` | `SMALLINT` | NOT NULL | `1` | Number of units purchased. Currently always 1 (digital goods), but modelled for flexibility |
| `discount_amount` | `NUMERIC(12, 2)` | NOT NULL | `0.00` | Item-level discount. May be 0 even if order-level discount is applied |
| `line_total` | `NUMERIC(12, 2)` | NOT NULL | — | `(unit_price × quantity) - discount_amount`. Stored for invoice line rendering without recalculation |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Audit creation timestamp |

---

### Primary Key

```
PRIMARY KEY (item_id)
```

---

### Foreign Keys

```
order_id     → orders.order_id                  ON DELETE RESTRICT   ON UPDATE RESTRICT
institute_id → institutes.institute_id           ON DELETE RESTRICT   ON UPDATE RESTRICT
plan_id      → subscription_plans.plan_id        ON DELETE RESTRICT   ON UPDATE RESTRICT
package_id   → pyq_packages.package_id           ON DELETE RESTRICT   ON UPDATE RESTRICT
```

> **Nullable FK note:** `plan_id` and `package_id` are independently nullable. PostgreSQL correctly allows `NULL` values on FK columns — the constraint only fires when the value is non-NULL. Both being NULL simultaneously is blocked by the CHECK constraint below.

---

### Composite Keys

None. `item_id` is the sole primary key.

---

### Unique Constraints

```
UNIQUE (order_id, plan_id) WHERE plan_id IS NOT NULL
UNIQUE (order_id, package_id) WHERE package_id IS NOT NULL
```

> These partial unique constraints prevent the same plan or package from appearing twice in one order. A student should not purchase the same subscription plan twice in a single checkout.

---

### CHECK Constraints

```
CHECK (unit_price >= 0)
CHECK (quantity > 0)
CHECK (discount_amount >= 0)
CHECK (discount_amount <= unit_price * quantity)
CHECK (line_total >= 0)

-- Exactly one FK must be populated based on item_type
CHECK (
  (item_type = 'subscription_plan' AND plan_id IS NOT NULL AND package_id IS NULL)
  OR
  (item_type = 'pyq_package' AND package_id IS NOT NULL AND plan_id IS NULL)
)
```

> The final CHECK constraint is the most critical. It enforces the polymorphic FK rule at the database level: `item_type` and the populated FK must always be consistent. This eliminates an entire class of data integrity bugs.

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_order_items_order_id` | `(order_id)` | B-tree | Primary access: fetch all items for an order |
| `idx_order_items_institute_plan` | `(institute_id, plan_id)` | B-tree | Revenue analytics: how many times was each plan sold? Partial: `WHERE plan_id IS NOT NULL` |
| `idx_order_items_institute_package` | `(institute_id, package_id)` | B-tree | Revenue analytics: package sales per institute. Partial: `WHERE package_id IS NOT NULL` |

---

### Soft Delete Strategy

`order_items` are never deleted. They are financial line-item records. No soft delete field is needed — the parent `orders.status` communicates the lifecycle state. A cancelled order's items remain for audit.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `updated_at` | ❌ | Order items are immutable after creation. No updates are permitted |
| `created_by` | ❌ | Derivable from parent `orders.student_id` |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE order_item | `RESTRICT` | Financial line items are legally retained |
| DELETE parent order | `RESTRICT` | Orders themselves cannot be deleted |
| DELETE plan / package | `RESTRICT` | Cannot delete a product that has been sold |
| UPDATE item_id | `RESTRICT` | PK must not change |

---

### Supabase RLS Considerations

```
Table: order_items
RLS: ENABLED

SELECT:
  - Students may read order_items belonging to their own orders only.
    USING: order_id IN (
      SELECT order_id FROM orders
      WHERE student_id = (SELECT student_id FROM student_details WHERE profile_id = auth.uid())
    )

  - Admins may read all order_items within their institute.
    USING: institute_id = get_my_institute_id()
      AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')

INSERT:
  - Via Edge Function (service_role) only, as part of the order creation transaction.
    Direct client-side INSERT is blocked.

UPDATE:
  - Blocked for all roles. Order items are immutable.

DELETE:
  - Blocked for all roles.
```

---

### Backend Developer Notes

1. **Price snapshot is mandatory.** `unit_price` and `item_name` are snapshots of the product's price and name at the time of purchase. If the institute later changes the plan price from ₹4,999 to ₹5,499, old invoices must still display ₹4,999. Never join to `subscription_plans.price` for invoice rendering — use `order_items.unit_price`.

2. **`line_total` is a stored computed field.** It equals `(unit_price × quantity) - discount_amount`. Compute and store it on INSERT. Do not leave it to be recalculated at query time. This prevents invoice line values from ever drifting if business logic changes.

3. **Polymorphic FK pattern.** The two-nullable-FK approach (`plan_id` / `package_id`) is simpler and more readable than a single `item_reference_id UUID` + `item_type` approach, which loses referential integrity. Two FKs with a CHECK constraint is the correct PostgreSQL pattern for this use case.

4. **Transaction scope.** Creating an order and its items must be a single database transaction. If inserting any `order_item` fails, the entire `orders` INSERT must be rolled back. Use a single Edge Function that wraps both operations in an explicit `BEGIN / COMMIT`.

5. **`quantity` is always 1 for digital goods.** In the current product scope, a student purchases one license of a plan or package. The `quantity` column is included for future extensibility (e.g., institutional bulk purchases). Validate `quantity = 1` at the API layer for now.

---

## Table 3: `payments`

### Purpose

Records every payment gateway transaction attempt linked to an order. The relationship between `orders` and `payments` is **1:M** — one order may have multiple payment rows, one per attempt.

This is the correct model for a production payment system. A student may:
- Attempt payment and have it fail (bank decline, network drop, OTP timeout)
- Retry payment using a different card or UPI handle
- Switch gateways mid-attempt (e.g., Razorpay → Cashfree fallback)

Each attempt produces a distinct `payments` row with its own `attempt_number`, gateway identifiers, status, and raw `gateway_response`. Only one attempt per order will ever reach `status = 'captured'` — this is enforced at the application layer and reinforced by the `UNIQUE (order_id, attempt_number)` constraint.

The `payments` table is the bridge between the platform's internal order lifecycle and the external payment gateway (Razorpay, Stripe, etc.). It stores the gateway's own transaction identifiers, which are needed for reconciliation, refund initiation, and dispute resolution. `gateway_response JSONB` captures the full raw webhook or API response payload from the gateway, serving as the authoritative audit trail for every attempt regardless of outcome.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `payment_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `order_id` | `UUID` | NOT NULL | — | FK → `orders.order_id`. The order this payment attempt belongs to |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for multi-tenant financial reporting and RLS |
| `attempt_number` | `SMALLINT` | NOT NULL | `1` | Monotonically increasing attempt counter scoped per order. First attempt = 1, retry = 2, etc. Combined with `order_id` forms a natural composite identifier. Must be assigned by the application before INSERT, not derived from a DB sequence — the application controls retry logic |
| `gateway` | `payment_gateway` | NOT NULL | — | The payment gateway used for this attempt. Enum: `razorpay`, `stripe`, `payu`, `cashfree`. May differ between attempts if the student switches gateway on retry |
| `gateway_order_id` | `VARCHAR(255)` | NULL | `NULL` | The order/session ID generated by the gateway before payment. Example: Razorpay's `order_id`. Stored for webhook correlation. Each attempt that uses a new gateway session gets a new `gateway_order_id` |
| `gateway_payment_id` | `VARCHAR(255)` | NULL | `NULL` | The gateway's own transaction ID after payment success. Example: Razorpay's `payment_id`. Required for refund initiation. NULL until capture succeeds |
| `gateway_signature` | `TEXT` | NULL | `NULL` | Webhook signature or verification hash returned by gateway. Stored for post-hoc verification and dispute resolution |
| `gateway_response` | `JSONB` | NULL | `NULL` | Full raw response payload from the gateway — webhook body or API response — for this attempt. Stored verbatim regardless of success or failure. Enables debugging failed attempts, post-hoc signature re-verification, and compliance audits without re-querying the gateway API. Schema varies per gateway; treated as an opaque document at the DB level |
| `amount` | `NUMERIC(12, 2)` | NOT NULL | — | Amount attempted for capture. Must match `orders.total_amount`. Stored separately for per-attempt reconciliation |
| `currency` | `currency_code` | NOT NULL | — | Currency of the gateway transaction. Must match `orders.currency` |
| `status` | `payment_status` | NOT NULL | `'pending'` | Gateway payment status for this specific attempt |
| `failure_reason` | `TEXT` | NULL | `NULL` | Gateway-provided failure message when `status = 'failed'`. Example: `"Insufficient funds"`. Stored per attempt for support and retry-pattern analytics |
| `refund_amount` | `NUMERIC(12, 2)` | NULL | `NULL` | Amount refunded. Only populated on the `captured` attempt when `status` transitions to `'refunded'` or `'partially_refunded'` |
| `refund_gateway_id` | `VARCHAR(255)` | NULL | `NULL` | Gateway's refund transaction ID. Required for refund reconciliation |
| `paid_at` | `TIMESTAMPTZ` | NULL | `NULL` | Timestamp of successful payment capture. NULL until captured. At most one payment row per order will have a non-NULL `paid_at` |
| `refunded_at` | `TIMESTAMPTZ` | NULL | `NULL` | Timestamp of refund processing. NULL unless refunded |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Audit creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Last modification. Trigger-maintained. Updated on every webhook status change |

---

### Primary Key

```
PRIMARY KEY (payment_id)
```

---

### Foreign Keys

```
order_id     → orders.order_id              ON DELETE RESTRICT   ON UPDATE RESTRICT
institute_id → institutes.institute_id       ON DELETE RESTRICT   ON UPDATE RESTRICT
```

---

### Composite Keys

None.

---

### Unique Constraints

```
UNIQUE (order_id, attempt_number)
UNIQUE (gateway, gateway_payment_id) WHERE gateway_payment_id IS NOT NULL
```

> `UNIQUE (order_id, attempt_number)` replaces the old `UNIQUE (order_id)` that enforced 1:1 cardinality. It now enforces that retry attempts are numbered sequentially and distinctly per order — attempt 1, 2, 3 — with no duplicates. Two different orders may each have an `attempt_number = 1`; only the combination must be unique.
>
> The partial unique constraint on `(gateway, gateway_payment_id)` prevents the same gateway transaction from being recorded twice — a critical safeguard against webhook replay attacks and duplicate processing. This constraint is unchanged.

---

### CHECK Constraints

```
CHECK (amount > 0)
CHECK (attempt_number >= 1)
CHECK (refund_amount IS NULL OR refund_amount > 0)
CHECK (refund_amount IS NULL OR refund_amount <= amount)
CHECK (paid_at IS NULL OR paid_at >= created_at)
CHECK (refunded_at IS NULL OR refunded_at >= paid_at)

-- Status-field consistency
CHECK (
  (status = 'captured' AND paid_at IS NOT NULL AND gateway_payment_id IS NOT NULL)
  OR status != 'captured'
)
CHECK (
  (status IN ('refunded', 'partially_refunded') AND refund_amount IS NOT NULL AND refunded_at IS NOT NULL)
  OR status NOT IN ('refunded', 'partially_refunded')
)
```

> **Single-capture enforcement:** The constraint `CHECK (attempt_number >= 1)` prevents sentinel or zero-indexed attempts. The application must also enforce that at most one payment row per `order_id` reaches `status = 'captured'`. This is an application-layer invariant — enforcing it purely at the DB level would require a partial unique index on `(order_id) WHERE status = 'captured'`, which is valid PostgreSQL and recommended as an additional safety net.

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_payments_order_id` | `(order_id)` | B-tree (covered by UNIQUE on order_id, attempt_number) | Fetch all payment attempts for an order. Covered by the composite unique constraint |
| `idx_payments_order_attempt` | `(order_id, attempt_number)` | B-tree (covered by UNIQUE) | Already covered |
| `idx_payments_order_captured` | `(order_id)` | B-tree | Partial index: `WHERE status = 'captured'`. Fast lookup of the single successful payment per order — used by invoice generation and order confirmation logic |
| `idx_payments_gateway_payment_id` | `(gateway, gateway_payment_id)` | B-tree | Webhook lookup: find payment by gateway transaction ID. Partial: `WHERE gateway_payment_id IS NOT NULL` |
| `idx_payments_gateway_order_id` | `(gateway, gateway_order_id)` | B-tree | Pre-payment webhook correlation. Partial: `WHERE gateway_order_id IS NOT NULL` |
| `idx_payments_institute_status` | `(institute_id, status)` | B-tree | Admin financial dashboard: filter by status per institute; count failed attempts per period |
| `idx_payments_institute_paid_at` | `(institute_id, paid_at DESC)` | B-tree | Revenue timeline; most recent successful payments first. Partial: `WHERE paid_at IS NOT NULL` |

---

### Soft Delete Strategy

`payments` must never be deleted. Payment records are financial and legal artefacts. No soft delete mechanism is applied. Status transitions (`failed`, `refunded`) are the terminal states.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `updated_at` | ✅ | Critical — updated on every webhook status change |
| `paid_at` | ✅ | Business-level financial timestamp (not the same as `updated_at`) |
| `refunded_at` | ✅ | Business-level refund timestamp |
| `created_by` | ❌ | Derivable from `order_id → student_id` |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE payment | `RESTRICT` | Financial records are legally retained |
| DELETE parent order | `RESTRICT` | Order itself cannot be deleted |
| UPDATE payment_id | `RESTRICT` | PK must not change |
| UPDATE order_id | `RESTRICT` | Immutable after creation |

---

### Supabase RLS Considerations

```
Table: payments
RLS: ENABLED

SELECT:
  - Students may read all payment attempt records for their own orders.
    USING: order_id IN (
      SELECT order_id FROM orders
      WHERE student_id = (SELECT student_id FROM student_details WHERE profile_id = auth.uid())
    )
    (Expose only: attempt_number, status, amount, currency, gateway, paid_at, failure_reason.
     Never expose gateway_signature or gateway_response to the client — both contain
     cryptographic material and raw gateway internals.)

  - Admins may read all payments within their institute.
    USING: institute_id = get_my_institute_id()
      AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    (Admins may see gateway_response for support and reconciliation purposes,
     but should access it via a restricted admin view, not the raw table policy.)

INSERT:
  - Via Edge Function (service_role) only. A new payment row is created for each checkout
    attempt with the next sequential attempt_number.
    Direct client-side INSERT is blocked.

UPDATE:
  - Via Edge Function (service_role) only. All status transitions are driven by
    payment gateway webhooks processed server-side.
    Direct client-side UPDATE is blocked for all roles.

DELETE:
  - Blocked for all roles.
```

> **Security note:** `gateway_signature` and `gateway_response` are sensitive. `gateway_signature` is a cryptographic verification hash. `gateway_response` may contain full card network metadata, bank codes, and internal gateway routing details depending on the gateway. Neither should ever be exposed in SELECT policies for student or teacher roles. For admin access, consider creating a restricted database view that exposes only the safe fields of `gateway_response` (e.g., error codes, timestamps) rather than the raw JSONB column.

---

### Backend Developer Notes

1. **One row per attempt, not one row per order.** Each time a student initiates payment — first try, retry after failure, gateway switch — the application inserts a new `payments` row with `attempt_number` incremented. Never UPDATE a `failed` payment row to `captured`. The failed attempt is a permanent audit record; the successful capture is a new row.

2. **`attempt_number` is application-assigned.** Before inserting a new payment row, the Edge Function must query `SELECT MAX(attempt_number) FROM payments WHERE order_id = $1` and increment by 1. Do not use a DB sequence — the application owns retry logic and must know the attempt number before the INSERT to include it in the gateway request metadata (useful for support tickets: "your 3rd payment attempt").

3. **`gateway_response` is the raw source of truth.** Store the complete, unmodified webhook or API response body as JSONB for every attempt, successful or not. This is the authoritative record if a student disputes a charge, a gateway has a bug, or an auditor requests proof of a transaction. Never truncate or transform it. Index specific fields from it only if you have a proven query need (use JSONB path indexes, not generated columns, for flexibility).

4. **Querying JSONB gateway_response.** Example access patterns:
   - Razorpay payment ID from response: `gateway_response -> 'payload' -> 'payment' -> 'entity' ->> 'id'`
   - Error code on failure: `gateway_response -> 'error' ->> 'code'`
   Define these as named expressions in your application query layer, not as DB computed columns — gateway response schemas change with API versions.

5. **Webhook-first architecture.** All payment status updates must come from verified gateway webhooks, not from client callbacks. A client callback can be spoofed. The Edge Function that receives the webhook must: (a) verify the signature using `gateway_signature`, (b) find the payment by `gateway_payment_id`, (c) store the raw webhook body in `gateway_response`, (d) update `status`, (e) call `confirm_order()` if captured.

6. **Idempotent webhook handler.** Payment gateways retry webhooks (typically 3–5 times with exponential backoff). The handler must be idempotent: if a payment row is already `captured` and the same webhook arrives again, return 200 without re-processing. The `UNIQUE (gateway, gateway_payment_id)` constraint is a backstop, but handle the conflict gracefully in code.

7. **Single-capture invariant.** Only one payment row per order should ever reach `status = 'captured'`. Enforce this with the recommended partial unique index `ON payments (order_id) WHERE status = 'captured'`. If this index raises a violation, it means two webhook deliveries raced — the second should be treated as a duplicate and returned 200.

8. **Store `gateway_order_id` before payment.** When Razorpay creates an order session, store `gateway_order_id` immediately with `status = 'pending'`. This is the correlation key for all pre-capture webhooks (`payment.authorized`, `payment.failed`, etc.). Store it alongside the initial `gateway_response` (the order creation API response).

9. **Amount reconciliation.** After capture, verify that `payments.amount` matches `orders.total_amount`. If they differ, flag for manual review. Do not auto-confirm an order where amounts disagree.

10. **Refund flow.** Refunds are initiated via the gateway's API. After success, update `payments.status`, `refund_amount`, `refund_gateway_id`, `refunded_at`, and store the refund API response in `gateway_response`. Then update `orders.status = 'refunded'` and `orders.refunded_at` in the same transaction. Refunds always operate on the `captured` payment row, not on a failed-attempt row.

---

## Table 4: `invoices`

### Purpose

Stores the tax invoice generated for a confirmed order. The relationship is 1:1 — one invoice per confirmed order.

Invoices are generated automatically after `orders.status` transitions to `'confirmed'`. They serve dual purposes:
- **Student-facing:** downloadable PDF receipt/invoice for their records
- **Institute-facing:** GST-compliant document for tax filing

Invoices are immutable once issued. If an order is refunded, a credit note is issued (stored in a future `credit_notes` table); the original invoice is not modified.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `invoice_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `order_id` | `UUID` | NOT NULL | — | FK → `orders.order_id`. The settled order this invoice covers |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for institute-level invoice reporting and RLS |
| `invoice_number` | `VARCHAR(100)` | NOT NULL | — | Human-readable invoice number. Format is institute-defined. Example: `INV-ALLEN-2025-00123`. Must be unique per institute |
| `status` | `invoice_status` | NOT NULL | `'draft'` | Invoice lifecycle: `draft` (generating), `issued` (PDF ready), `cancelled` (voided) |
| `billing_name` | `VARCHAR(255)` | NOT NULL | — | Snapshot of student's name at time of invoice. Stored because `profiles.name` can change |
| `billing_email` | `VARCHAR(255)` | NOT NULL | — | Snapshot of student's email. Stored for the same reason |
| `billing_address` | `TEXT` | NULL | `NULL` | Billing address if collected at checkout. Required for GST B2B invoices |
| `billing_gstin` | `VARCHAR(15)` | NULL | `NULL` | Student's GST registration number for B2B transactions. Nullable (most students are B2C) |
| `institute_gstin` | `VARCHAR(15)` | NULL | `NULL` | Institute's GST registration number. Snapshot at time of invoice |
| `subtotal_amount` | `NUMERIC(12, 2)` | NOT NULL | — | Snapshot from `orders.subtotal_amount` |
| `discount_amount` | `NUMERIC(12, 2)` | NOT NULL | `0.00` | Snapshot from `orders.discount_amount` |
| `tax_amount` | `NUMERIC(12, 2)` | NOT NULL | `0.00` | Snapshot from `orders.tax_amount` |
| `total_amount` | `NUMERIC(12, 2)` | NOT NULL | — | Snapshot from `orders.total_amount`. The final invoiced amount |
| `currency` | `currency_code` | NOT NULL | — | Snapshot from `orders.currency` |
| `pdf_url` | `TEXT` | NULL | `NULL` | Supabase Storage URL of the generated PDF invoice. NULL until PDF is generated |
| `issued_at` | `TIMESTAMPTZ` | NULL | `NULL` | Timestamp when the invoice was issued (status → `'issued'`). NULL while in `draft` |
| `cancelled_at` | `TIMESTAMPTZ` | NULL | `NULL` | Timestamp when voided. NULL unless cancelled |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Audit creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Last modification. Trigger-maintained |

---

### Primary Key

```
PRIMARY KEY (invoice_id)
```

---

### Foreign Keys

```
order_id     → orders.order_id              ON DELETE RESTRICT   ON UPDATE RESTRICT
institute_id → institutes.institute_id       ON DELETE RESTRICT   ON UPDATE RESTRICT
```

---

### Composite Keys

None.

---

### Unique Constraints

```
UNIQUE (order_id)
UNIQUE (institute_id, invoice_number)
```

> `UNIQUE (order_id)` enforces the 1:1 relationship with orders.
>
> `UNIQUE (institute_id, invoice_number)` ensures invoice numbers are unique within each institute's invoice series. Two institutes can both have `INV-2025-00001` without conflict.

---

### CHECK Constraints

```
CHECK (subtotal_amount >= 0)
CHECK (discount_amount >= 0)
CHECK (tax_amount >= 0)
CHECK (total_amount >= 0)
CHECK (char_length(invoice_number) >= 3)
CHECK (billing_gstin IS NULL OR billing_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$')
CHECK (institute_gstin IS NULL OR institute_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$')
CHECK (issued_at IS NULL OR issued_at >= created_at)
CHECK (cancelled_at IS NULL OR cancelled_at >= created_at)
CHECK (
  (status = 'issued' AND issued_at IS NOT NULL AND pdf_url IS NOT NULL)
  OR status != 'issued'
)
CHECK (
  (status = 'cancelled' AND cancelled_at IS NOT NULL)
  OR status != 'cancelled'
)
```

> The GSTIN regex validates the 15-character Indian GST Identification Number format: `NNAAAANNNNAANZAN` (state code + PAN + entity code + Z + check digit). This is a format check only, not a government registry lookup.

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_invoices_order_id` | `(order_id)` | B-tree (covered by UNIQUE) | Already covered |
| `idx_invoices_institute_number` | `(institute_id, invoice_number)` | B-tree (covered by UNIQUE) | Already covered |
| `idx_invoices_institute_status` | `(institute_id, status)` | B-tree | Admin: filter issued/draft/cancelled invoices per institute |
| `idx_invoices_institute_issued_at` | `(institute_id, issued_at DESC)` | B-tree | Invoice listing sorted by issue date. Partial: `WHERE issued_at IS NOT NULL` |

---

### Soft Delete Strategy

Invoices are never deleted. Voiding an invoice is performed by transitioning `status = 'cancelled'` and setting `cancelled_at`. The original PDF remains in Supabase Storage. A separate credit note process handles the financial reversal — this is out of scope for v1 but must be kept in mind architecturally.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `updated_at` | ✅ | Trigger-maintained |
| `issued_at` | ✅ | Business-level timestamp (when invoice was formally issued) |
| `cancelled_at` | ✅ | Business-level timestamp |
| `created_by` | ❌ | Always the system (Edge Function). Derivable from order context |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE invoice | `RESTRICT` | Legal financial document; must be retained |
| DELETE parent order | `RESTRICT` | Order cannot be deleted |
| UPDATE invoice_id | `RESTRICT` | PK must not change |
| UPDATE order_id | `RESTRICT` | Immutable after creation |

---

### Supabase RLS Considerations

```
Table: invoices
RLS: ENABLED

SELECT:
  - Students may read their own invoices.
    USING: order_id IN (
      SELECT order_id FROM orders
      WHERE student_id = (SELECT student_id FROM student_details WHERE profile_id = auth.uid())
    )
    (Expose: invoice_number, status, total_amount, currency, pdf_url, issued_at.
     Do NOT expose billing_gstin to other users.)

  - Admins may read all invoices within their institute.
    USING: institute_id = get_my_institute_id()
      AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')

INSERT:
  - Via Edge Function (service_role) only.
    Triggered automatically when order status transitions to 'confirmed'.
    Direct client-side INSERT is blocked.

UPDATE:
  - Via Edge Function (service_role) only.
    Permitted transitions: draft → issued (when PDF is ready), issued → cancelled (voiding).
    Direct client-side UPDATE is blocked.

DELETE:
  - Blocked for all roles.
```

---

### Backend Developer Notes

1. **Invoice number generation.** Generate invoice numbers in the Edge Function, not in the DB. Format: `{INSTITUTE_CODE}-{YEAR}-{SEQUENCE}`. Use a per-institute atomic sequence counter (Postgres `SEQUENCE` or a counter in a `institute_sequences` table) to prevent gaps and duplicates. Do not use UUIDs as invoice numbers — they are not human-readable and fail GST compliance requirements.

2. **Snapshot all financial data.** `billing_name`, `billing_email`, `subtotal_amount`, `tax_amount`, `total_amount` are all snapshots from the moment of invoice generation. They must never be recalculated from live data. An invoice must display the exact figures that existed at the time of purchase, even if the student changes their name or the plan price changes later.

3. **PDF generation is async.** The invoice row is created with `status = 'draft'` immediately when the order is confirmed. The PDF is generated asynchronously (via a background Edge Function or a queue). When the PDF is ready, update `pdf_url` and `status = 'issued'` with `issued_at = NOW()`. The student's "download invoice" button should only appear when `status = 'issued'`.

4. **GSTIN validation.** The DB CHECK constraint validates GSTIN format. However, government registry validation (checking if a GSTIN is active and registered) requires an external API call (GST Suvidha Provider). Perform this at the API layer before saving, not in the DB.

5. **`pdf_url` is a Supabase Storage path.** Store the Storage object path (e.g., `invoices/institute_id/invoice_id.pdf`), not a signed URL. Generate signed URLs on-demand with a short TTL (15–60 minutes) when the student requests the download. Never store long-lived signed URLs in the DB — they expire and become invalid.

6. **Cancellation vs. Refund.** Cancelling an invoice (`status = 'cancelled'`) is a document operation — it means the invoice is voided. It does not automatically trigger a payment refund. A refund is a payment operation (`payments.status = 'refunded'`). These are two independent workflows that often happen together but must be managed separately.

---

## Domain 7 — Design Decisions Summary

| Decision | Choice | Reason |
|----------|--------|--------|
| Order → Payment cardinality | **1:M** *(amended from 1:1)* | Each payment attempt — including failures and retries — is a distinct immutable record. The captured attempt is identified by `status = 'captured'`, not by position |
| `attempt_number` | `SMALLINT NOT NULL DEFAULT 1`, `UNIQUE (order_id, attempt_number)` | Application-assigned sequential counter; enables ordered retry history per order and human-readable support references ("your 2nd attempt") |
| `gateway_response` | `JSONB NULL` | Stores the full, unmodified gateway webhook or API response per attempt. Raw JSONB preserves all gateway-specific fields for audit, debugging, and dispute resolution without schema coupling |
| Order → Invoice cardinality | 1:1 | One GST invoice per confirmed order — unchanged |
| Polymorphic items | Two nullable FKs + CHECK constraint | Preserves referential integrity; avoids untyped `item_reference_id` |
| Monetary type | `NUMERIC(12, 2)` | Exact precision; never `FLOAT` for money |
| Currency storage | Custom enum `currency_code` | Prevents malformed currency codes from corrupting financial aggregation |
| Price snapshots | Stored on `order_items` and `invoices` | Immutable historical record; plan price changes must not alter past invoices |
| Status transitions | Edge Function + service_role only | Prevents client-side manipulation of order/payment/invoice status |
| Invoice numbers | Application-generated sequence | Human-readable, GST-compliant, per-institute unique |
| `institute_id` denormalization | Added to all four tables | Enables direct RLS policies and per-institute financial queries without joins |
| Soft delete | None — status fields only | Financial records are legally immutable; status communicates lifecycle |

---

## Domain 7 — Relationships to Other Domains

| This Table | References | Via Column | Domain |
|------------|-----------|------------|--------|
| `orders` | `student_details` | `student_id` | Domain 1 (Foundation) |
| `orders` | `institutes` | `institute_id` | Domain 1 (Foundation) |
| `order_items` | `subscription_plans` | `plan_id` | Domain 5 (Subscriptions) |
| `order_items` | `pyq_packages` | `package_id` | Domain 5 (Subscriptions) |
| `payments` | `orders` | `order_id` | This domain |
| `invoices` | `orders` | `order_id` | This domain |

| This Table | Referenced By | Via Column | Domain |
|------------|--------------|------------|--------|
| `orders` | `audit_logs` | `resource_id` | Domain 15 (Administration) |
| `payments` | `audit_logs` | `resource_id` | Domain 15 (Administration) |
| `invoices` | `audit_logs` | `resource_id` | Domain 15 (Administration) |

---

## Domain 7 — Entity Relationship Summary (Textual)

```
student_details (1) ──────────────────────────── (M) orders
                                                        │
                                      ┌─────────────────┼─────────────────┐
                                      │                 │                 │
                                    (M) order_items   (M) payments      (1) invoices
                                      │                 │
                          ┌───────────┴──────┐          └── attempt_number (1, 2, 3 …)
                  (M:1) subscription_plans   (M:1) pyq_packages           only one reaches status='captured'
```

---

*Domain 7 — Commerce is complete (v1.1 — amended).*
*Awaiting your approval before proceeding to the next domain.*
