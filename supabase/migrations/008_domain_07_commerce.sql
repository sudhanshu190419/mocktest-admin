-- ============================================================================
-- Migration: Domain 07 — Commerce
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Tables: orders · order_items · payments · invoices
--
-- Depends on: Domain 01 (institutes, profiles, student_details)
--             Domain 06 (pyq_packages)
--             Existing enums (order_status, payment_status, payment_gateway,
--               invoice_status, item_type)
--             Existing functions (set_updated_at, get_my_institute_id, etc.)
--
-- New Enums: currency_code
--
-- Order:
--   1. New enum types (idempotent DO blocks)
--   2. Tables (dependency order: parent → child → junction)
--   3. Indexes (after all tables exist)
--   4. Triggers (after all tables exist; set_updated_at already exists from Domain 1)
--   5. Comments
--
-- Reference: Schema_Domain_07_Commerce.md v1.1 | ERD v2.0
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 0 — New Enum Types (Idempotent)
-- ════════════════════════════════════════════════════════════════════════════
-- This domain introduces one new PostgreSQL enum: currency_code.
-- All other enums referenced (order_status, payment_status, etc.) are defined
-- globally in Domain 01.

-- 0a. currency_code: ISO 4217 currency codes relevant to the target market.
--     Kept as enum (not VARCHAR) to prevent malformed currency codes from
--     corrupting financial aggregation. Start with INR only if India-only;
--     add values as international expansion occurs.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'currency_code') then
    create type currency_code as enum ('INR', 'USD', 'AED', 'GBP');
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — CREATE TABLE Statements
-- ════════════════════════════════════════════════════════════════════════════
-- Commerce hierarchy: orders → order_items (1:M), payments (1:M), invoices (1:1)
--
-- orders:        Root purchase event; one per checkout session.
-- order_items:   Individual line items within an order (polymorphic: plan or package).
-- payments:      Payment gateway transaction records; 1:M with orders (one per attempt).
-- invoices:      GST/tax invoice generated after payment confirmation; 1:1 with orders.

-- 1a. Table: orders
-- The root financial entity. Every time a student initiates a checkout, a single
-- order row is created. Acts as the parent for all line items, payment records,
-- and the invoice. Orders must never be deleted — they are the financial source
-- of truth and are legally required to be retained for a minimum of 7 years
-- (GST compliance in India).
create table public.orders (
  order_id         uuid             not null  default gen_random_uuid(),
  institute_id     uuid             not null,
  student_id       uuid             not null,
  status           order_status     not null  default 'pending',
  currency         currency_code    not null  default 'INR',
  subtotal_amount  numeric(12,2)    not null  default 0.00,
  discount_amount  numeric(12,2)    not null  default 0.00,
  tax_amount       numeric(12,2)    not null  default 0.00,
  total_amount     numeric(12,2)    not null  default 0.00,
  coupon_code      varchar(50)      null      default null,
  notes            text             null      default null,
  placed_at        timestamptz      not null  default now(),
  confirmed_at     timestamptz      null      default null,
  cancelled_at     timestamptz      null      default null,
  refunded_at      timestamptz      null      default null,
  created_at       timestamptz      not null  default now(),
  updated_at       timestamptz      not null  default now(),

  -- Primary Key
  constraint pk_orders primary key (order_id),

  -- Foreign Keys
  constraint fk_orders_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_orders_student
    foreign key (student_id) references public.student_details (student_id)
    on delete restrict
    on update restrict,

  -- CHECK Constraints
  constraint ck_orders_subtotal_amount check (subtotal_amount >= 0),
  constraint ck_orders_discount_amount check (discount_amount >= 0),
  constraint ck_orders_tax_amount check (tax_amount >= 0),
  constraint ck_orders_total_amount check (total_amount >= 0),
  constraint ck_orders_discount_limit check (discount_amount <= subtotal_amount),
  constraint ck_orders_confirmed_at check
    (confirmed_at is null or confirmed_at >= placed_at),
  constraint ck_orders_cancelled_at check
    (cancelled_at is null or cancelled_at >= placed_at),
  constraint ck_orders_refunded_at check
    (refunded_at is null or refunded_at >= placed_at),
  constraint ck_orders_status_confirmed check
    ((status = 'confirmed' and confirmed_at is not null)
     or (status != 'confirmed' and confirmed_at is null)),
  constraint ck_orders_status_cancelled check
    ((status = 'cancelled' and cancelled_at is not null)
     or (status != 'cancelled' and cancelled_at is null)),
  constraint ck_orders_status_refunded check
    ((status = 'refunded' and refunded_at is not null)
     or (status != 'refunded' and refunded_at is null))
);

-- 1b. Table: order_items
-- Individual line items within an order. An order may contain one or more items.
-- Each item represents either a subscription_plan (via plan_id) or a pyq_package
-- (via package_id). The polymorphic nature is resolved via two nullable FKs with
-- a CHECK constraint enforcing that exactly one is populated based on item_type.
-- Price snapshots (unit_price, item_name) are stored at purchase time so that
-- plan/package name or price changes do not affect historical invoices.
create table public.order_items (
  item_id          uuid             not null  default gen_random_uuid(),
  order_id         uuid             not null,
  institute_id     uuid             not null,
  item_type        item_type        not null,
  plan_id          uuid             null      default null,
  package_id       uuid             null      default null,
  item_name        varchar(255)     not null,
  unit_price       numeric(12,2)    not null,
  quantity         smallint         not null  default 1,
  discount_amount  numeric(12,2)    not null  default 0.00,
  line_total       numeric(12,2)    not null,
  created_at       timestamptz      not null  default now(),

  -- Primary Key
  constraint pk_order_items primary key (item_id),

  -- Foreign Keys
  constraint fk_order_items_order
    foreign key (order_id) references public.orders (order_id)
    on delete restrict
    on update restrict,

  constraint fk_order_items_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  -- TODO: Add FK to subscription_plans.plan_id after Domain 11 (Subscription & Access Control)
  -- migration has been applied.
  --   constraint fk_order_items_plan
  --     foreign key (plan_id) references public.subscription_plans (plan_id)
  --     on delete restrict
  --     on update restrict

  constraint fk_order_items_package
    foreign key (package_id) references public.pyq_packages (package_id)
    on delete restrict
    on update restrict,

 

  -- CHECK Constraints
  constraint ck_order_items_item_type_consistency check
    ((item_type = 'subscription_plan' and plan_id is not null and package_id is null)
     or (item_type = 'pyq_package' and package_id is not null and plan_id is null)),
  constraint ck_order_items_unit_price check (unit_price >= 0),
  constraint ck_order_items_quantity check (quantity > 0),
  constraint ck_order_items_discount_amount check (discount_amount >= 0),
  constraint ck_order_items_discount_limit check (discount_amount <= unit_price * quantity),
  constraint ck_order_items_line_total check (line_total >= 0)
);

-- 1c. Table: payments
-- Records every payment gateway transaction attempt linked to an order.
-- The relationship between orders and payments is 1:M — one order may have
-- multiple payment rows, one per attempt (retry, gateway switch, etc.).
-- Each attempt produces a distinct row with its own attempt_number, gateway
-- identifiers, status, and raw gateway_response. Only one attempt per order
-- will ever reach status = 'captured' — enforced via partial unique index.
-- gateway_response captures the full raw webhook or API response payload,
-- serving as the authoritative audit trail for every attempt.
create table public.payments (
  payment_id          uuid             not null  default gen_random_uuid(),
  order_id            uuid             not null,
  institute_id        uuid             not null,
  attempt_number      smallint         not null  default 1,
  gateway             payment_gateway  not null,
  gateway_order_id    varchar(255)     null      default null,
  gateway_payment_id  varchar(255)     null      default null,
  gateway_signature   text             null      default null,
  gateway_response    jsonb            null      default null,
  amount              numeric(12,2)    not null,
  currency            currency_code    not null,
  status              payment_status   not null  default 'pending',
  failure_reason      text             null      default null,
  refund_amount       numeric(12,2)    null      default null,
  refund_gateway_id   varchar(255)     null      default null,
  paid_at             timestamptz      null      default null,
  refunded_at         timestamptz      null      default null,
  created_at          timestamptz      not null  default now(),
  updated_at          timestamptz      not null  default now(),

  -- Primary Key
  constraint pk_payments primary key (payment_id),

  -- Foreign Keys
  constraint fk_payments_order
    foreign key (order_id) references public.orders (order_id)
    on delete restrict
    on update restrict,

  constraint fk_payments_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  -- Unique Constraints
  constraint uq_payments_order_attempt unique (order_id, attempt_number),

  -- CHECK Constraints
  constraint ck_payments_amount check (amount > 0),
  constraint ck_payments_attempt_number check (attempt_number >= 1),
  constraint ck_payments_refund_amount check
    (refund_amount is null or refund_amount > 0),
  constraint ck_payments_refund_limit check
    (refund_amount is null or refund_amount <= amount),
  constraint ck_payments_paid_at check
    (paid_at is null or paid_at >= created_at),
  constraint ck_payments_refunded_at check
    (refunded_at is null or paid_at is null or refunded_at >= paid_at),
  constraint ck_payments_status_captured check
    ((status = 'captured' and paid_at is not null and gateway_payment_id is not null)
     or status != 'captured'),
  constraint ck_payments_status_refunded check
    ((status in ('refunded', 'partially_refunded')
      and refund_amount is not null and refunded_at is not null)
     or status not in ('refunded', 'partially_refunded'))
);

-- 1d. Table: invoices
-- Stores the tax invoice generated for a confirmed order. 1:1 relationship
-- with orders — one invoice per confirmed order. Invoices are generated
-- automatically when orders.status transitions to 'confirmed'. They serve
-- dual purposes: student-facing downloadable receipt and institute-facing
-- GST-compliant document for tax filing. Invoices are immutable once issued.
-- If an order is refunded, a credit note is issued; the original invoice is
-- not modified. All financial fields are snapshots from the moment of invoice
-- generation and must never be recalculated from live data.
create table public.invoices (
  invoice_id        uuid             not null  default gen_random_uuid(),
  order_id          uuid             not null,
  institute_id      uuid             not null,
  invoice_number    varchar(100)     not null,
  status            invoice_status   not null  default 'draft',
  billing_name      varchar(255)     not null,
  billing_email     varchar(255)     not null,
  billing_address   text             null      default null,
  billing_gstin     varchar(15)      null      default null,
  institute_gstin   varchar(15)      null      default null,
  subtotal_amount   numeric(12,2)    not null,
  discount_amount   numeric(12,2)    not null  default 0.00,
  tax_amount        numeric(12,2)    not null  default 0.00,
  total_amount      numeric(12,2)    not null,
  currency          currency_code    not null,
  pdf_url           text             null      default null,
  issued_at         timestamptz      null      default null,
  cancelled_at      timestamptz      null      default null,
  created_at        timestamptz      not null  default now(),
  updated_at        timestamptz      not null  default now(),

  -- Primary Key
  constraint pk_invoices primary key (invoice_id),

  -- Foreign Keys
  constraint fk_invoices_order
    foreign key (order_id) references public.orders (order_id)
    on delete restrict
    on update restrict,

  constraint fk_invoices_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  -- Unique Constraints
  constraint uq_invoices_order_id unique (order_id),
  constraint uq_invoices_institute_number unique (institute_id, invoice_number),

  -- CHECK Constraints
  constraint ck_invoices_subtotal_amount check (subtotal_amount >= 0),
  constraint ck_invoices_discount_amount check (discount_amount >= 0),
  constraint ck_invoices_tax_amount check (tax_amount >= 0),
  constraint ck_invoices_total_amount check (total_amount >= 0),
  constraint ck_invoices_invoice_number_length check (char_length(invoice_number) >= 3),
  constraint ck_invoices_billing_gstin_format check
    (billing_gstin is null
     or billing_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$'),
  constraint ck_invoices_institute_gstin_format check
    (institute_gstin is null
     or institute_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$'),
  constraint ck_invoices_issued_at check
    (issued_at is null or issued_at >= created_at),
  constraint ck_invoices_cancelled_at check
    (cancelled_at is null or cancelled_at >= created_at),
  constraint ck_invoices_status_issued check
    ((status = 'issued' and issued_at is not null and pdf_url is not null)
     or status != 'issued'),
  constraint ck_invoices_status_cancelled check
    ((status = 'cancelled' and cancelled_at is not null)
     or status != 'cancelled')
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Indexes
-- ════════════════════════════════════════════════════════════════════════════
-- All indexes are created after their respective tables exist.
-- No duplicate indexes on columns already covered by UNIQUE constraints.
-- Partial indexes are used where specified in the schema.

-- 2a. orders indexes
create index if not exists idx_orders_institute_student
  on public.orders (institute_id, student_id);

create index if not exists idx_orders_institute_status
  on public.orders (institute_id, status);

create index if not exists idx_orders_institute_placed_at
  on public.orders (institute_id, placed_at desc);

create index if not exists idx_orders_student_placed_at
  on public.orders (student_id, placed_at desc);

-- Partial index: coupon code is nullable — only index rows with a coupon
create index if not exists idx_orders_coupon_code
  on public.orders (coupon_code)
  where coupon_code is not null;

-- 2b. order_items indexes
create index if not exists idx_order_items_order_id
  on public.order_items (order_id);

-- Partial index: plan_id is nullable — revenue analytics for plan sales
create index if not exists idx_order_items_institute_plan
  on public.order_items (institute_id, plan_id)
  where plan_id is not null;

-- Partial index: package_id is nullable — revenue analytics for package sales
create index if not exists idx_order_items_institute_package
  on public.order_items (institute_id, package_id)
  where package_id is not null;

-- Note: uq_order_items_order_plan and uq_order_items_order_package
--   already cover unique lookups for plan/package within an order.

-- 2c. payments indexes
create index if not exists idx_payments_order_id
  on public.payments (order_id);

-- Note: idx_payments_order_attempt is covered by uq_payments_order_attempt.

-- Partial unique index: only one captured payment per order
create unique index if not exists uq_payments_order_captured
  on public.payments (order_id)
  where status = 'captured';  -- Partial unique index: webhook lookup + dedup protection
  -- Prevents the same gateway transaction from being recorded twice — critical
  -- safeguard against webhook replay attacks and duplicate processing.
create unique index if not exists uq_payments_gateway_payment_id
  on public.payments (gateway, gateway_payment_id)
  where gateway_payment_id is not null;


create unique index idx_order_items_order_plan
on public.order_items (order_id, plan_id)
where plan_id is not null;

create unique index idx_order_items_order_package
on public.order_items (order_id, package_id)
where package_id is not null;


-- Partial index: pre-payment webhook correlation
create index if not exists idx_payments_gateway_order_id
  on public.payments (gateway, gateway_order_id)
  where gateway_order_id is not null;

create index if not exists idx_payments_institute_status
  on public.payments (institute_id, status);

-- Partial index: revenue timeline — most recent successful payments first
create index if not exists idx_payments_institute_paid_at
  on public.payments (institute_id, paid_at desc)
  where paid_at is not null;

-- 2d. invoices indexes
-- Note: idx_invoices_order_id is covered by uq_invoices_order_id (unique constraint).
-- Note: idx_invoices_institute_number is covered by uq_invoices_institute_number.

create index if not exists idx_invoices_institute_status
  on public.invoices (institute_id, status);

-- Partial index: invoice listing sorted by issue date
create index if not exists idx_invoices_institute_issued_at
  on public.invoices (institute_id, issued_at desc)
  where issued_at is not null;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — CREATE TRIGGER Statements
-- ════════════════════════════════════════════════════════════════════════════
-- Only tables with an updated_at column receive the set_updated_at trigger.
-- set_updated_at() already exists from Domain 01 — do not recreate.
-- order_items has no updated_at column (immutable after insert).

-- 3a. orders triggers
create trigger trg_orders_set_updated_at
  before update on public.orders
  for each row
  execute function public.set_updated_at();

-- 3b. payments triggers
create trigger trg_payments_set_updated_at
  before update on public.payments
  for each row
  execute function public.set_updated_at();

-- 3c. invoices triggers
create trigger trg_invoices_set_updated_at
  before update on public.invoices
  for each row
  execute function public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — COMMENT Statements
-- ════════════════════════════════════════════════════════════════════════════

-- 4za. Cross-table validation notes
-- The schema doc specifies a CHECK constraint ensuring that orders.total_amount
-- equals subtotal_amount - discount_amount + tax_amount. This is intentionally
-- NOT implemented as a DB CHECK because DB constraints on computed columns are
-- fragile during partial updates. Validation must be enforced at the application
-- layer (Zod/Joi schema validation before INSERT) instead.
--
-- TODO — Add FK from Domain 06 (student_pyq_purchases.order_item_id) to
--   order_items.item_id after this migration has been applied:
--     ALTER TABLE student_pyq_purchases ADD CONSTRAINT
--       fk_student_pyq_purchases_order_item
--       FOREIGN KEY (order_item_id) REFERENCES order_items (item_id)
--       ON DELETE SET NULL ON UPDATE RESTRICT;
--
-- TODO — Add FK to subscription_plans.plan_id on order_items.plan_id after
--   Domain 11 (Subscription & Access Control) migration has been applied:
--     ALTER TABLE order_items ADD CONSTRAINT
--       fk_order_items_plan
--       FOREIGN KEY (plan_id) REFERENCES subscription_plans (plan_id)
--       ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 4a. Table comments
comment on table public.orders is
  'Root financial entity. Created on every student checkout. Acts as the parent '
  'for order_items, payments, and invoices. Orders must never be deleted — they '
  'are the financial source of truth and are legally required for 7+ years '
  '(GST compliance in India). Status lifecycle: pending → confirmed → cancelled/refunded.';

comment on table public.order_items is
  'Individual line items within an order. Each item represents a subscription_plan '
  'or pyq_package via polymorphic FKs (plan_id / package_id) enforced by a CHECK '
  'constraint. Price snapshots (unit_price, item_name) are stored at purchase time '
  'to preserve historical accuracy through future plan/package changes.';

comment on table public.payments is
  'Payment gateway transaction attempt records. 1:M relationship with orders — '
  'each payment attempt (including failures and retries) is a distinct immutable '
  'row. At most one payment row per order reaches status = captured. Stores the '
  'raw gateway webhook response in gateway_response for audit, debugging, and '
  'dispute resolution.';

comment on table public.invoices is
  'GST/tax invoice generated for a confirmed order. 1:1 relationship — one invoice '
  'per order. All financial fields are snapshots from invoice generation time and '
  'must never reference live order/plan prices. Invoices are immutable once issued. '
  'If an order is refunded, a credit note is issued; the original invoice is preserved.';

-- 4b. Column comments
comment on column public.orders.status is
  'Lifecycle: pending (checkout initiated), confirmed (payment captured), '
  'cancelled (abandoned/cancelled by student/admin), refunded (payment reversed). '
  'Status transitions are performed by backend Edge Functions only — never by client.';

comment on column public.orders.currency is
  'ISO 4217 currency code as PostgreSQL enum. All amounts in this order use this currency. '
  'Stored at order level — all order_items share the same currency.';

comment on column public.orders.subtotal_amount is
  'Sum of all order_items.line_total before tax and discount. Stored for audit; '
  'recalculated at checkout.';

comment on column public.orders.discount_amount is
  'Total discount applied at order level (coupon, promotional, etc.). Must be between '
  '0 and subtotal_amount. Item-level discounts are stored on order_items.';

comment on column public.orders.tax_amount is
  'GST or applicable tax amount. Must be >= 0. Computed at checkout by the application layer.';

comment on column public.orders.total_amount is
  'Final payable amount. Must equal subtotal_amount - discount_amount + tax_amount '
  '(enforced at API layer). Stored for fast invoice/display without recalculation.';

comment on column public.orders.coupon_code is
  'Applied coupon code, if any. Stored for audit and analytics only — coupon validation '
  'happens in the API layer before the order is written.';

comment on column public.orders.notes is
  'Internal admin notes or student-provided purchase notes.';

comment on column public.orders.placed_at is
  'Business timestamp: when the student clicked "Pay". Appears on invoices and revenue '
  'reports. Distinct from created_at (DB insert time) for audit precision.';

comment on column public.orders.confirmed_at is
  'UTC timestamp when payment was successfully captured. NULL until confirmed. '
  'Set by the payment webhook handler, never by the client.';

comment on column public.orders.cancelled_at is
  'UTC timestamp when the order was cancelled. NULL unless status = cancelled.';

comment on column public.orders.refunded_at is
  'UTC timestamp when a refund was processed. NULL unless status = refunded.';

comment on column public.order_items.item_type is
  'Polymorphic discriminator: subscription_plan or pyq_package. Controls which '
  'FK (plan_id or package_id) is populated. Defined by the global item_type enum.';

comment on column public.order_items.plan_id is
  'FK to subscription_plans.plan_id. Populated when item_type = subscription_plan. '
  'NULL otherwise. FK constraint will be added after Domain 11 migration.';

comment on column public.order_items.package_id is
  'FK to pyq_packages.package_id. Populated when item_type = pyq_package. '
  'NULL otherwise.';

comment on column public.order_items.item_name is
  'Snapshot of the item name at time of purchase. Preserved so that plan/package '
  'name changes do not affect historical invoice line display.';

comment on column public.order_items.unit_price is
  'Price per unit at time of purchase. Snapshot — not a live FK to current plan/package '
  'price. Used for all historical invoice rendering.';

comment on column public.order_items.quantity is
  'Number of units purchased. Currently always 1 for digital goods (subscription plans, '
  'PYQ packages). Included for future extensibility (e.g., institutional bulk purchases).';

comment on column public.order_items.discount_amount is
  'Item-level discount applied to this line item. May be 0 even if an order-level '
  'discount is applied elsewhere. Must not exceed unit_price × quantity.';

comment on column public.order_items.line_total is
  'Stored computed field: (unit_price × quantity) - discount_amount. Prevents invoice '
  'line values from drifting if business logic changes.';

comment on column public.payments.attempt_number is
  'Monotonically increasing attempt counter per order. First attempt = 1, retry = 2, '
  'etc. Application-assigned before INSERT — not a DB sequence. Enables ordered retry '
  'history and human-readable support references ("your 3rd payment attempt").';

comment on column public.payments.gateway is
  'Payment gateway used for this attempt. Enum: razorpay, stripe, payu, cashfree. '
  'May differ between attempts if student switches gateway on retry.';

comment on column public.payments.gateway_order_id is
  'Order/session ID generated by the gateway before payment. Example: Razorpay order_id. '
  'Stored for webhook correlation. Each new gateway session generates a new value.';

comment on column public.payments.gateway_payment_id is
  'Gateway transaction ID after successful payment. Example: Razorpay payment_id. '
  'Required for refund initiation. NULL until capture succeeds.';

comment on column public.payments.gateway_signature is
  'Webhook signature or verification hash returned by the gateway. Stored for post-hoc '
  'verification and dispute resolution. Sensitive — never expose to client-side policies.';

comment on column public.payments.gateway_response is
  'Full raw webhook or API response payload from the gateway for this attempt. Stored '
  'verbatim regardless of success or failure. Enables debugging, post-hoc signature '
  're-verification, and compliance audits without re-querying the gateway. Schema varies '
  'per gateway; treated as an opaque JSONB document. Sensitive — restrict in RLS policies.';

comment on column public.payments.amount is
  'Amount attempted for capture. Must match orders.total_amount. Stored per-attempt for '
  'reconciliation.';

comment on column public.payments.failure_reason is
  'Gateway-provided failure message when status = failed. Examples: "Insufficient funds", '
  '"OTP timeout". Stored per attempt for support and retry-pattern analytics.';

comment on column public.payments.refund_amount is
  'Amount refunded. Only populated on the captured payment row when status transitions '
  'to refunded or partially_refunded.';

comment on column public.payments.refund_gateway_id is
  'Gateway refund transaction ID. Required for refund reconciliation and tracking.';

comment on column public.payments.paid_at is
  'UTC timestamp of successful payment capture. NULL until captured. At most one payment '
  'row per order will have a non-NULL paid_at.';

comment on column public.payments.refunded_at is
  'UTC timestamp when refund was processed. NULL unless refunded.';

comment on column public.invoices.invoice_number is
  'Human-readable invoice number. Format is institute-defined. Examples: '
  'INV-ALLEN-2025-00123. Must be unique per institute (enforced via unique constraint).';

comment on column public.invoices.billing_name is
  'Snapshot of student''s name at time of invoice. Stored because profiles.name can change.';

comment on column public.invoices.billing_email is
  'Snapshot of student''s email at time of invoice. Stored for the same reason as billing_name.';

comment on column public.invoices.billing_address is
  'Billing address if collected at checkout. Required for GST B2B invoices.';

comment on column public.invoices.billing_gstin is
  'Student''s GST registration number for B2B transactions. Nullable (most students are B2C). '
  'Format validated via regex CHECK constraint matching the 15-character Indian GSTIN format.';

comment on column public.invoices.institute_gstin is
  'Institute''s GST registration number. Snapshot at time of invoice. Same format validation '
  'as billing_gstin.';

comment on column public.invoices.pdf_url is
  'Supabase Storage path to the generated PDF invoice. Stored as object path, not signed URL. '
  'Signed URLs are generated on-demand with a short TTL (15-60 min) at download time. '
  'NULL until PDF generation completes (status = issued).';

comment on column public.invoices.issued_at is
  'UTC timestamp when the invoice was formally issued (status → issued). NULL while in draft.';

comment on column public.invoices.cancelled_at is
  'UTC timestamp when the invoice was voided. NULL unless status = cancelled.';

-- 4c. Constraint comments
comment on constraint ck_orders_discount_limit on public.orders is
  'Prevents the total discount from exceeding the subtotal. A negative total_amount would '
  'be a financial anomaly.';

comment on constraint ck_orders_status_confirmed on public.orders is
  'confirmed_at must be set when and only when status = confirmed. Prevents half-written '
  'confirmation states.';

comment on constraint ck_orders_status_cancelled on public.orders is
  'cancelled_at must be set when and only when status = cancelled. Prevents orphaned '
  'cancellation timestamps.';

comment on constraint ck_orders_status_refunded on public.orders is
  'refunded_at must be set when and only when status = refunded. Prevents orphaned '
  'refund timestamps.';

comment on constraint ck_order_items_item_type_consistency on public.order_items is
  'Enforces polymorphic FK consistency: item_type must match the populated FK. '
  'subscription_plan → plan_id populated, package_id NULL. pyq_package → package_id '
  'populated, plan_id NULL. Eliminates an entire class of data integrity bugs.';



comment on constraint uq_payments_order_attempt on public.payments is
  'Enforces that payment attempt numbers are unique per order. Attempt 1, 2, 3 — '
  'no duplicates.';

COMMENT ON INDEX uq_payments_order_captured IS
  'Partial unique index enforcing that only one payment row per order may reach
   status = captured. If violated, a duplicate webhook event or race condition occurred.';

comment on constraint ck_payments_status_captured on public.payments is
  'A captured payment must always have paid_at and gateway_payment_id set. Prevents '
  'half-written capture states.';

comment on constraint ck_payments_status_refunded on public.payments is
  'refund_amount and refunded_at must be set together when and only when status is '
  'refunded or partially_refunded. Prevents half-written refund states.';

comment on constraint uq_invoices_order_id on public.invoices is
  'Enforces the 1:1 relationship — only one invoice may exist per order.';

comment on constraint uq_invoices_institute_number on public.invoices is
  'Invoice numbers must be unique within each institute. Two institutes may share the '
  'same invoice number without conflict.';

comment on constraint ck_invoices_billing_gstin_format on public.invoices is
  'Validates the 15-character Indian GSTIN format: NN AAAAA NNNN A Z N (state code + '
  'PAN + entity code + Z + check digit). This is a structural validation only, not a '
  'government registry lookup.';

comment on constraint ck_invoices_institute_gstin_format on public.invoices is
  'Same GSTIN format validation as billing_gstin, applied to the institute''s GST number.';

comment on constraint ck_invoices_status_issued on public.invoices is
  'An issued invoice must always have issued_at and pdf_url set. Prevents half-written '
  'issue states.';

comment on constraint ck_invoices_status_cancelled on public.invoices is
  'A cancelled invoice must always have cancelled_at set. Prevents orphaned cancellation '
  'flags without a timestamp.';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — Domain 07 Commerce
-- ════════════════════════════════════════════════════════════════════════════
