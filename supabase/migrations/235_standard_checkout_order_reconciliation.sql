-- Migration 235: Standard Non-Installment Razorpay Payment Integrity & Order Reconciliation
--
-- Architectural Objective:
--   1. Protects Razorpay gateway Order IDs across the complete settlement and refund lifecycle.
--      Enforces that at most ONE payment row may exist in a settled status ('captured', 'refunded',
--      'partially_refunded') for any given Razorpay Order ID.
--   2. Introduces public.payment_refund_events:
--      - Dedicated immutable individual refund event ledger for standard checkouts.
--      - Enforces uniqueness on gateway_refund_id (uq_payment_refund_events_gateway_refund).
--      - Tracks authentic individual refund events across created, processed, and failed lifecycles.
--      - Eliminates duplicate refund double-counting across multiple partial refunds and re-deliveries.
--   3. Introduces public.reconcile_standard_order_gateway_order:
--      - Dedicated order-level reconciliation RPC for standard course, PYQ, and subscription checkouts.
--      - Allows multiple payment attempts (e.g. failed attempt 1, captured retry attempt 2) to share
--        the same Razorpay Order ID when and only when they belong to the identical internal order.
--      - Strictly forbids a different internal order from claiming an already-associated Razorpay Order ID.
--      - Guard against stale workers overwriting an existing different Razorpay Order ID in orders.notes.
--      - Uses a transaction-scoped advisory lock: pg_advisory_xact_lock(hashtext('rzp_order_claim:' || trim(p_gateway_order_id))).
--      - Maintains strict orders-before-payments lock hierarchy to prevent SQL deadlocks.
--   4. Introduces public.create_standard_payment_attempt:
--      - Atomically creates and reserves standard payment attempts (attempt_number = max + 1)
--        under the same transaction-scoped advisory lock.
--      - Atomically persists razorpayOrderId in orders.notes and clears active gatewayClaim leases.
--      - Guard against stale workers overwriting an existing different Razorpay Order ID.
--      - Validates authentic refund ID format (rfnd_...) and prevents payment IDs from being written to refund_gateway_id.
--      - Enforces refund consistency: full refunds require exact amount match; partial refunds strictly 0 < amount < payment amount.
--      - Does NOT write the refund ledger: individual refund events are recorded authoritatively
--        by reconcile_standard_refund and reconcile_standard_recovery_refunds.
--      - Eliminates uncoordinated direct PostgREST inserts across checkout initialization,
--        retry failure inserts, out-of-order failure audit inserts, and retry capture inserts.
--   5. Introduces public.reconcile_standard_paid_order:
--      - Dedicated atomic payment-attempt reconciliation RPC for paid Razorpay Orders.
--      - Operates under pg_advisory_xact_lock and orders-before-payments lock hierarchy.
--      - Idempotently reconciles duplicate executions for the same gateway payment.
--      - Strictly enforces monotonic refund-state transitions (cannot regress to captured or partially_refunded).
--      - Prevents cumulative refund amounts from decreasing.
--      - Preserves authentic refund IDs (rfnd_...) and never substitutes payment IDs or null.
--      - Reconciles an existing pending attempt while strictly preserving its original attempt_number.
--      - Safely resolves NULL gateway_order_id via Option A by verifying exact payment mapping and atomically associating under lock.
--      - Rejects gateway payment IDs already assigned to a different internal order or gateway order.
--      - Never alters historical failed attempts; inserts a new attempt (max + 1) when previous attempts failed.
--      - Rejects conflicting settlements if a different payment has already settled the order.
--      - Validates full refunds (amount equals original payment) and partial refunds (strictly 0 < amount < payment amount).
--      - Does NOT write the refund ledger; authoritative ledger writes happen in
--        reconcile_standard_refund and reconcile_standard_recovery_refunds.
--      - Revokes access on full refund; preserves access and confirmed status on partial refund.
--   6. Introduces public.reconcile_standard_refund:
--      - Dedicated atomic refund webhook reconciliation RPC for standard checkout orders.
--      - Synchronizes refund.processed / refund.created events under the shared transaction-scoped advisory lock.
--      - Enforces the orders-before-payments lock hierarchy.
--      - Records individual refund events in public.payment_refund_events with unique gateway_refund_id.
--      - Strict four-way association validation using NULL-safe IS DISTINCT FROM comparison.
--      - Securely repairs missing NULL gateway_payment_id or gateway_order_id under lock.
--      - Accumulates only confirmed processed refund events into payments.refund_amount.
--      - Validates authentic refund ID format (rfnd_...).
--      - Revokes student order access upon full refund; preserves confirmed order and student access upon partial refund.
--   7. Introduces public.reconcile_standard_recovery_refunds:
--      - Dedicated atomic batch refund reconciliation RPC for paid order recovery in create-payment-order.
--      - Eliminates direct PostgREST upserts into payment_refund_events.
--      - Executes under shared advisory lock and orders-before-payments lock hierarchy.
--      - Enforces four-way association integrity and strict NULL-safe validation with secure repair.
--      - Computes cumulative processed refunds monotonically from ledger.
--      - Flags over-refund discrepancies for administrator review without corrupting records.
--      - Cancels order and revokes student access on full refund; preserves confirmed order on partial refund.
--   8. Introduces public.fulfill_standard_course_order, public.fulfill_standard_pyq_order, & public.fulfill_standard_subscription_order:
--      - Transactional database-level fulfillment RPCs eliminating the check-then-act race between fulfillment and refunds.
--      - Executes under shared advisory lock and orders-before-payments lock hierarchy.
--      - Strict fulfillment idempotency: repeated calls for an already fulfilled order safely return the existing result without repeating entitlement mutations.
--      - Repeated subscription fulfillment never extends subscription dates again.
--      - Atomically validates order eligibility and payment capture under lock before any entitlement mutations.
--      - Upgrades profile role, creates student details, inserts/reactivates entitlements, records entitlement grants, and marks order fulfilled in a single transaction.
--   9. Introduces public.acquire_standard_order_creation_claim & public.release_standard_order_creation_claim:
--      - Database-backed single-creator lease coordination for external Razorpay Order creation.
--      - Prevents concurrent checkout requests from creating duplicate Razorpay Orders.
--      - Safely coordinates lease expiration and crash recovery.
--   10. Preserves public.reconcile_razorpay_gateway_order (Migration 234) for subsequent installments,
--       retaining its strict attempt-level isolation semantics without alteration.
--
-- Security & Authorization:
--   1. Enforces SECURITY DEFINER and set search_path = ''.
--   2. Explicitly verifies caller role is service_role using strict fail-closed validation
--      against auth.role(), matching migrations 219 and 234:
--      coalesce(v_caller_role, '') <> 'service_role'.
--      NOTE: earlier revisions read the legacy request.jwt.claim.role GUC, which current PostgREST
--      builds do not populate. auth.role() reads the verified request.jwt.claims payload instead.
--      Runtime verification through the PostgREST path is still required (see audit H1).
--   3. Revokes execute from public, anon, and authenticated; grants execute strictly to service_role.

-- ============================================================================
-- 1. Partial Unique Index: Settled Payment Uniqueness Across Lifecycle
-- ============================================================================
-- Invariant: For any given Razorpay Order ID, at most one payment record may ever exist
-- in a settled financial state ('captured', 'refunded', 'partially_refunded').
-- Preserves failed and pending attempt history while strictly preventing duplicate captures,
-- duplicate settlements, or capture resurrection after full or partial refunds.
create unique index if not exists uq_payments_razorpay_settled_order
  on public.payments (gateway, gateway_order_id)
  where gateway = 'razorpay'::public.payment_gateway
    and gateway_order_id is not null
    and status in (
      'captured'::public.payment_status,
      'refunded'::public.payment_status,
      'partially_refunded'::public.payment_status
    );

comment on index public.uq_payments_razorpay_settled_order is
  'Ensures at most one settled or refunded payment attempt exists per Razorpay Order ID across the complete financial lifecycle.';

-- ============================================================================
-- 2. Standard Payment Refund Events Ledger
-- ============================================================================
-- Ledger for individual Razorpay refund events on standard (non-installment) checkouts.
-- Enforces uniqueness per gateway_refund_id to prevent double-counting across re-deliveries
-- and sequential partial refunds.
create table if not exists public.payment_refund_events (
  refund_event_id       uuid primary key default gen_random_uuid(),
  payment_id            uuid not null references public.payments(payment_id) on delete restrict,
  order_id              uuid not null references public.orders(order_id) on delete restrict,
  gateway               public.payment_gateway not null default 'razorpay'::public.payment_gateway,
  gateway_refund_id     text not null,
  gateway_payment_id    text not null,
  gateway_order_id      text null,
  amount                numeric(10,2) not null check (amount > 0),
  currency              public.currency_code not null default 'INR'::public.currency_code,
  status                text not null check (status in ('created', 'processed', 'failed')),
  gateway_response      jsonb null,
  created_at            timestamptz not null default now(),
  processed_at          timestamptz null,
  constraint uq_payment_refund_events_gateway_refund unique (gateway_refund_id)
);

create index if not exists idx_payment_refund_events_payment_id
  on public.payment_refund_events (payment_id);

create index if not exists idx_payment_refund_events_order_id
  on public.payment_refund_events (order_id);

create index if not exists idx_payment_refund_events_gateway_payment
  on public.payment_refund_events (gateway, gateway_payment_id);

comment on table public.payment_refund_events is
  'Immutable individual refund event ledger for standard checkouts. Guarantees idempotency on gateway_refund_id across sequential partial refunds, created, processed, and failed lifecycles.';

alter table public.payment_refund_events enable row level security;
revoke all on public.payment_refund_events from public, anon, authenticated;
grant all on public.payment_refund_events to service_role;

-- ============================================================================
-- 2b. Subscription Conversion Order Provenance & Entitlement Grants Ledger
-- ============================================================================
-- Adds conversion_order_id to student_subscriptions to track the exact course
-- order that converted an active subscription, ensuring conversion reversals
-- never overwrite newer renewals or administrator modifications.
alter table public.student_subscriptions
  add column if not exists conversion_order_id uuid null
    references public.orders(order_id) on delete set null;

create index if not exists idx_student_subscriptions_conversion_order
  on public.student_subscriptions (conversion_order_id)
  where conversion_order_id is not null;

comment on column public.student_subscriptions.conversion_order_id is
  'Tracks the specific course order that cancelled this subscription via full course conversion, guaranteeing safe refund restoration without overwriting subsequent transactions.';

-- Records order-level entitlement provenance for standard checkouts.
-- Classifies every grant into:
--   - created: newly granted or reactivated course, PYQ, or initial subscription
--   - already_active: duplicate checkout encountering an existing valid entitlement
--   - renewed: subscription renewal extending end_date by duration_days
--   - converted: active/grace subscription cancelled due to full course conversion
create table if not exists public.order_entitlement_grants (
  grant_id              uuid primary key default gen_random_uuid(),
  order_id              uuid not null references public.orders(order_id) on delete restrict,
  order_item_id         uuid null references public.order_items(item_id) on delete set null,
  student_id            uuid not null references public.student_details(student_id) on delete restrict,
  institute_id          uuid not null references public.institutes(institute_id) on delete restrict,
  entitlement_type      text not null check (entitlement_type in ('course', 'subscription', 'pyq')),
  entitlement_id        uuid not null,
  grant_type            text not null check (grant_type in ('created', 'already_active', 'renewed', 'converted')),
  duration_days         integer null,
  prior_state           jsonb null,
  created_at            timestamptz not null default now(),
  revoked_at            timestamptz null,
  revoked_reason        text null
);

create index if not exists idx_order_entitlement_grants_order_id
  on public.order_entitlement_grants (order_id);

create index if not exists idx_order_entitlement_grants_student_type
  on public.order_entitlement_grants (student_id, entitlement_type, entitlement_id);

comment on table public.order_entitlement_grants is
  'Immutable order-level entitlement provenance ledger. Records which order granted or extended each entitlement, prior state for renewals, and conversion associations to guarantee precise, safe refund reversals.';

alter table public.order_entitlement_grants enable row level security;
revoke all on public.order_entitlement_grants from public, anon, authenticated;
grant all on public.order_entitlement_grants to service_role;

-- ============================================================================
-- 2b. Internal Helper RPC: Calendar-Period Subscription End Date
-- ============================================================================
-- H4: subscription periods are calendar periods, not fixed day counts.
-- Monthly = 1 calendar month, quarterly = 3, half-yearly = 6, yearly = 12.
-- Lifetime / custom plans fall back to the stored duration_days.
create or replace function public.subscription_period_end_date(
  p_start_date      date,
  p_billing_cycle   text,
  p_duration_days   integer
)
returns date
language sql
immutable
set search_path = ''
as $$
  select case
    when p_start_date is null then null::date
    when lower(coalesce(p_billing_cycle, '')) = 'monthly'     then (p_start_date + interval '1 month')::date
    when lower(coalesce(p_billing_cycle, '')) = 'quarterly'   then (p_start_date + interval '3 months')::date
    when lower(coalesce(p_billing_cycle, '')) = 'half_yearly' then (p_start_date + interval '6 months')::date
    when lower(coalesce(p_billing_cycle, '')) = 'yearly'      then (p_start_date + interval '12 months')::date
    else (p_start_date + (greatest(coalesce(nullif(p_duration_days, 0), 30), 1) || ' days')::interval)::date
  end;
$$;

comment on function public.subscription_period_end_date is
  'Resolves a subscription period end date from the plan billing cycle. Uses calendar-month arithmetic for monthly/quarterly/half-yearly/yearly plans and falls back to duration_days for lifetime/custom plans.';

-- ============================================================================
-- 2c. Internal Helper RPC: Standard Order Entitlements Revocation
-- ============================================================================
-- Dedicated atomic helper for reversing entitlements attributable strictly to
-- the refunded order, preserving existing valid entitlements, reverting renewal
-- periods, and restoring subscriptions cancelled via course conversion.
create or replace function public.revoke_standard_order_entitlements(
  p_order_id            uuid,
  p_reason              text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_role                 text;
  v_target_order                record;
  v_grant                       record;
  v_course_id                   uuid;
  v_package_id                  uuid;
  v_has_other_course            boolean;
  v_has_other_pyq               boolean;
  v_other_item_id               uuid;
  v_sub_id                      uuid;
  v_sub                         record;
  v_valid_grant                 record;
  v_first                       boolean;
  v_recomputed_start_date       date;
  v_recomputed_end_date         date;
  v_latest_order_id             uuid;
  v_grace_days                  integer;
  v_content_access_days         integer;
  v_recomputed_status           public.subscription_status_type;
  v_recomputed_grace_end        date;
  v_recomputed_content_end      date;
  v_conv_grant                  record;
  v_conv_sub                    record;
  v_has_newer_sub_grant         boolean;
  v_has_other_subscription      boolean;
  v_has_non_purchase_source     boolean;
  v_current_fingerprint         text;
  v_expected_fingerprint        text;
begin
  -- 1. Security Authorization Check (Strict Fail-Closed)
  -- H1: authorize with auth.role(), matching migrations 219/234. auth.role() reads the verified
  -- request.jwt.claims payload, whereas request.jwt.claim.role is a legacy per-claim GUC that is not
  -- populated by current PostgREST builds. Fail-closed semantics below are unchanged.
  v_caller_role := auth.role();
  if coalesce(v_caller_role, '') <> 'service_role' then
    raise exception 'UNAUTHORIZED: service_role required';
  end if;

  if p_order_id is null then
    return;
  end if;

  select order_id, student_id, institute_id, status
  into v_target_order
  from public.orders
  where order_id = p_order_id;

  if v_target_order.order_id is null or v_target_order.student_id is null then
    return;
  end if;

  -- ═════════════════════════════════════════════════════════════════════
  -- SECTION 1: Course Entitlement Reversal (Scenarios A & 'already_active')
  -- ═════════════════════════════════════════════════════════════════════
  for v_course_id in
    select distinct coalesce(oi.course_id, ce.course_id)
    from public.order_items oi
    left join public.course_enrollments ce on ce.order_item_id = oi.item_id
    where oi.order_id = p_order_id
      and coalesce(oi.course_id, ce.course_id) is not null
  loop
    -- Check if student has ANY OTHER confirmed, non-refunded purchase order for this course
    select exists (
      select 1
      from public.order_items oi2
      join public.orders o2 on o2.order_id = oi2.order_id
      join public.payments p2 on p2.order_id = o2.order_id
      where o2.student_id = v_target_order.student_id
        and o2.order_id <> p_order_id
        and o2.status = 'confirmed'::public.order_status
        and o2.fulfillment_status = 'fulfilled'
        and oi2.course_id = v_course_id
        and p2.status in ('captured'::public.payment_status, 'partially_refunded'::public.payment_status)
    ) into v_has_other_course;

    -- C3/M2: the shared (student, course) row cannot represent every concurrent source on its own,
    -- so revocation must prove that no OTHER surviving source of access exists:
    --   (a) another confirmed + fulfilled order with a settled payment for this course
    --   (b) an active/grace subscription for this course that does not belong to this order
    --   (c) a durable non-purchase marker (admin_grant / free) already on the shared row
    select exists (
      select 1
      from public.student_subscriptions ss
      where ss.student_id = v_target_order.student_id
        and ss.course_id = v_course_id
        and ss.status in ('active'::public.subscription_status_type, 'grace'::public.subscription_status_type)
        and (ss.order_id is null or ss.order_id <> p_order_id)
    ) into v_has_other_subscription;

    select coalesce(bool_or(ce.enrollment_type in ('admin_grant', 'free')), false)
    into v_has_non_purchase_source
    from public.course_enrollments ce
    where ce.course_id = v_course_id
      and ce.student_id = v_target_order.student_id
      and ce.is_active = true;

    if v_has_other_course or v_has_other_subscription or v_has_non_purchase_source then
      -- Preserve access: at least one entitlement source independent of this order survives.
      if v_has_other_course then
        select oi2.item_id into v_other_item_id
        from public.order_items oi2
        join public.orders o2 on o2.order_id = oi2.order_id
        join public.payments p2 on p2.order_id = o2.order_id
        where o2.student_id = v_target_order.student_id
          and o2.order_id <> p_order_id
          and o2.status = 'confirmed'::public.order_status
          and o2.fulfillment_status = 'fulfilled'
          and oi2.course_id = v_course_id
          and p2.status in ('captured'::public.payment_status, 'partially_refunded'::public.payment_status)
        order by o2.created_at desc
        limit 1;
      else
        v_other_item_id := null;
      end if;

      -- revoked_by must be cleared: ck_course_enrollments_revocation requires it to be null
      -- whenever is_active = true (H3).
      update public.course_enrollments ce
      set order_item_id = coalesce(v_other_item_id, ce.order_item_id),
          is_active = true,
          revoked_at = null,
          revoked_reason = null,
          revoked_by = null,
          updated_at = now()
      where ce.course_id = v_course_id
        and ce.student_id = v_target_order.student_id;

      -- Access is now subscription-derived with no surviving purchase: mark the row so a later
      -- subscription reversal is judged by these same multi-source rules.
      if v_has_other_subscription and not v_has_other_course then
        update public.course_enrollments ce
        set enrollment_type = 'subscription',
            updated_at = now()
        where ce.course_id = v_course_id
          and ce.student_id = v_target_order.student_id
          and ce.enrollment_type = 'purchase';
      end if;
    else
      -- No surviving source: revoke only that which this order conferred.
      update public.course_enrollments
      set is_active = false,
          revoked_at = coalesce(revoked_at, now()),
          revoked_reason = p_reason,
          updated_at = now()
      where course_id = v_course_id
        and student_id = v_target_order.student_id
        and is_active = true;
    end if;
  end loop;

  -- ═════════════════════════════════════════════════════════════════════
  -- SECTION 2: PYQ Entitlement Reversal (Scenarios D & 'already_active')
  -- ═════════════════════════════════════════════════════════════════════
  for v_package_id in
    select distinct coalesce(oi.package_id, spyq.package_id)
    from public.order_items oi
    left join public.student_pyq_purchases spyq on spyq.order_item_id = oi.item_id
    where oi.order_id = p_order_id
      and coalesce(oi.package_id, spyq.package_id) is not null
  loop
    -- Check if student has ANY OTHER confirmed, non-refunded purchase order for this PYQ package
    select exists (
      select 1
      from public.order_items oi2
      join public.orders o2 on o2.order_id = oi2.order_id
      join public.payments p2 on p2.order_id = o2.order_id
      where o2.student_id = v_target_order.student_id
        and o2.order_id <> p_order_id
        and o2.status = 'confirmed'::public.order_status
        and o2.fulfillment_status = 'fulfilled'
        and oi2.package_id = v_package_id
        and p2.status in ('captured'::public.payment_status, 'partially_refunded'::public.payment_status)
    ) into v_has_other_pyq;

    -- C3/M2 (PYQ parity): a durable admin_grant / free marker on this package must survive a
    -- purchase refund, exactly as it does for courses.
    select coalesce(bool_or(spyq.access_type not in ('purchase')), false)
    into v_has_non_purchase_source
    from public.student_pyq_purchases spyq
    where spyq.package_id = v_package_id
      and spyq.student_id = v_target_order.student_id
      and spyq.is_active = true;

    if v_has_other_pyq then
      -- SCENARIO D / already_active: Student has another valid purchase of this package.
      -- Re-link order_item_id to the most recent valid order item; preserve is_active = true.
      select oi2.item_id into v_other_item_id
      from public.order_items oi2
      join public.orders o2 on o2.order_id = oi2.order_id
      join public.payments p2 on p2.order_id = o2.order_id
      where o2.student_id = v_target_order.student_id
        and o2.order_id <> p_order_id
        and o2.status = 'confirmed'::public.order_status
        and o2.fulfillment_status = 'fulfilled'
        and oi2.package_id = v_package_id
        and p2.status in ('captured'::public.payment_status, 'partially_refunded'::public.payment_status)
      order by o2.created_at desc
      limit 1;

      update public.student_pyq_purchases
      set order_item_id = coalesce(v_other_item_id, order_item_id),
          is_active = true,
          revoked_at = null,
          revoked_reason = null,
          updated_at = now()
      where package_id = v_package_id
        and student_id = v_target_order.student_id;
    elsif v_has_non_purchase_source then
      -- Admin-granted or free access to this package is preserved.
      update public.student_pyq_purchases
      set is_active = true,
          revoked_at = null,
          revoked_reason = null,
          updated_at = now()
      where package_id = v_package_id
        and student_id = v_target_order.student_id;
    else
      -- No other valid source exists: revoke access
      update public.student_pyq_purchases
      set is_active = false,
          revoked_at = coalesce(revoked_at, now()),
          revoked_reason = p_reason,
          updated_at = now()
      where package_id = v_package_id
        and student_id = v_target_order.student_id
        and is_active = true;
    end if;
  end loop;

  -- ═════════════════════════════════════════════════════════════════════
  -- SECTION 3: Multi-Order Subscription Ledger Recomputation
  -- (Handles Out-of-Order Renewal Refunds & Initial Purchase Reversals)
  -- ═════════════════════════════════════════════════════════════════════
  -- First, mark all subscription grants for THIS order as revoked
  update public.order_entitlement_grants
  set revoked_at = now(),
      revoked_reason = p_reason
  where order_id = p_order_id
    and entitlement_type = 'subscription'
    and grant_type in ('created', 'renewed')
    and revoked_at is null;

  -- For every subscription affected by this order (or associated with order items):
  for v_sub_id in
    select distinct entitlement_id
    from public.order_entitlement_grants
    where order_id = p_order_id
      and entitlement_type = 'subscription'
      and grant_type in ('created', 'renewed')
    union
    select distinct ss.subscription_id
    from public.student_subscriptions ss
    where ss.order_id = p_order_id
  loop
    select * into v_sub
    from public.student_subscriptions
    where subscription_id = v_sub_id
    for update;

    if v_sub.subscription_id is not null then
      -- Resolve grace_days and content_access_days settings
      select coalesce(nullif(setting_value, '')::integer, 7) into v_grace_days
      from public.system_settings
      where institute_id = v_sub.institute_id and setting_key = 'grace_days' and is_active = true
      limit 1;
      v_grace_days := coalesce(v_grace_days, 7);

      select coalesce(nullif(setting_value, '')::integer, 30) into v_content_access_days
      from public.system_settings
      where institute_id = v_sub.institute_id and setting_key = 'content_access_days' and is_active = true
      limit 1;
      v_content_access_days := coalesce(v_content_access_days, 30);

      -- Recompute entitlement from all REMAINING valid (unrevoked) grants
      v_first := true;
      v_recomputed_start_date := null;
      v_recomputed_end_date := null;
      v_latest_order_id := null;

      for v_valid_grant in
        select oeg.*,
               coalesce(oeg.duration_days, sp.duration_days, 30) as effective_duration_days,
               sp.billing_cycle::text as billing_cycle_text,
               o.created_at as order_created_at
        from public.order_entitlement_grants oeg
        join public.orders o on o.order_id = oeg.order_id
        join public.payments p on p.order_id = o.order_id
        left join public.order_items oi on oi.item_id = oeg.order_item_id
        left join public.subscription_plans sp on sp.plan_id = oi.plan_id
        where oeg.entitlement_id = v_sub_id
          and oeg.entitlement_type = 'subscription'
          and oeg.grant_type in ('created', 'renewed')
          and oeg.revoked_at is null
          and o.status = 'confirmed'::public.order_status
          and o.fulfillment_status = 'fulfilled'
          and p.status in ('captured'::public.payment_status, 'partially_refunded'::public.payment_status)
        order by oeg.created_at asc
      loop
        v_latest_order_id := v_valid_grant.order_id;

        if v_first then
          if v_valid_grant.grant_type = 'created' then
            v_recomputed_start_date := coalesce(
              (v_valid_grant.prior_state ->> 'prior_start_date')::date,
              v_valid_grant.created_at::date,
              v_sub.start_date
            );
          else
            v_recomputed_start_date := v_valid_grant.created_at::date;
          end if;
          v_recomputed_end_date := public.subscription_period_end_date(
            v_recomputed_start_date, v_valid_grant.billing_cycle_text, v_valid_grant.effective_duration_days
          );
          v_first := false;
        else
          if (v_valid_grant.prior_state ->> 'prior_end_date') is not null and
             (v_valid_grant.prior_state ->> 'prior_end_date')::date < v_valid_grant.order_created_at::date and
             v_recomputed_end_date < v_valid_grant.order_created_at::date
          then
            v_recomputed_end_date := public.subscription_period_end_date(
              v_valid_grant.order_created_at::date, v_valid_grant.billing_cycle_text, v_valid_grant.effective_duration_days
            );
          else
            v_recomputed_end_date := public.subscription_period_end_date(
              v_recomputed_end_date, v_valid_grant.billing_cycle_text, v_valid_grant.effective_duration_days
            );
          end if;
        end if;
      end loop;

      if v_first is true or v_recomputed_end_date is null then
        -- No remaining valid unrevoked grants: cancel subscription
        update public.student_subscriptions
        set status = 'cancelled'::public.subscription_status_type,
            cancelled_at = coalesce(cancelled_at, now()),
            updated_at = now()
        where subscription_id = v_sub_id;

        -- C3/M2: a valid purchase of this same course keeps the shared row alive.
        if exists (
          select 1
          from public.order_items oi2
          join public.orders o2 on o2.order_id = oi2.order_id
          join public.payments p2 on p2.order_id = o2.order_id
          where o2.student_id = v_target_order.student_id
            and o2.status = 'confirmed'::public.order_status
            and o2.fulfillment_status = 'fulfilled'
            and oi2.course_id = v_sub.course_id
            and p2.status in ('captured'::public.payment_status, 'partially_refunded'::public.payment_status)
        ) then
          -- Hand the row back to the surviving purchase source instead of revoking it.
          update public.course_enrollments ce
          set is_active = true,
              enrollment_type = 'purchase',
              revoked_at = null,
              revoked_reason = null,
              revoked_by = null,
              updated_at = now()
          where ce.student_id = v_target_order.student_id
            and ce.course_id = v_sub.course_id;
        else
          -- Deactivate course enrollment for this subscription
          update public.course_enrollments ce
          set is_active = false,
              revoked_at = coalesce(revoked_at, now()),
              revoked_reason = p_reason,
              updated_at = now()
          where ce.student_id = v_target_order.student_id
            and ce.course_id = v_sub.course_id
            and ce.enrollment_type = 'subscription'
            and not exists (
              select 1 from public.student_subscriptions ss2
              where ss2.student_id = v_target_order.student_id
                and ss2.course_id = v_sub.course_id
                and ss2.status in ('active'::public.subscription_status_type, 'grace'::public.subscription_status_type)
                and ss2.subscription_id <> v_sub_id
            );
        end if;
      else
        -- Valid paid renewals remain: apply recomputed calendar entitlement
        v_recomputed_grace_end := v_recomputed_end_date + (v_grace_days || ' days')::interval;
        v_recomputed_content_end := v_recomputed_grace_end + (v_content_access_days || ' days')::interval;

        v_recomputed_status := case
          when v_recomputed_end_date >= current_date then 'active'::public.subscription_status_type
          when v_recomputed_grace_end >= current_date then 'grace'::public.subscription_status_type
          else 'expired'::public.subscription_status_type
        end;

        update public.student_subscriptions
        set order_id = v_latest_order_id,
            start_date = v_recomputed_start_date,
            end_date = v_recomputed_end_date,
            grace_end_date = v_recomputed_grace_end,
            content_access_end_date = v_recomputed_content_end,
            status = v_recomputed_status,
            cancelled_at = null,
            updated_at = now()
        where subscription_id = v_sub_id;

        -- Ensure course enrollment remains active if recomputed status is active or grace
        if v_recomputed_status in ('active'::public.subscription_status_type, 'grace'::public.subscription_status_type) then
          update public.course_enrollments ce
          set is_active = true,
              revoked_at = null,
              revoked_reason = null,
              revoked_by = null,
              updated_at = now()
          where ce.student_id = v_target_order.student_id
            and ce.course_id = v_sub.course_id;
        end if;
      end if;
    end if;
  end loop;

  -- ═════════════════════════════════════════════════════════════════════
  -- SECTION 4: Protected Course-Conversion Restoration (Scenario C)
  -- ═════════════════════════════════════════════════════════════════════
  -- If this refunded course order converted a subscription:
  -- Only restore when current state is still attributable to the conversion performed by this order!
  for v_conv_grant in
    select *
    from public.order_entitlement_grants
    where order_id = p_order_id
      and entitlement_type = 'subscription'
      and grant_type = 'converted'
      and revoked_at is null
  loop
    select * into v_conv_sub
    from public.student_subscriptions
    where subscription_id = v_conv_grant.entitlement_id
    for update;

    if v_conv_sub.subscription_id is not null then
      -- Check if any newer valid subscription grant exists for this student and course
      select exists (
        select 1
        from public.order_entitlement_grants oeg_newer
        where oeg_newer.student_id = v_target_order.student_id
          and oeg_newer.entitlement_type = 'subscription'
          and oeg_newer.entitlement_id = v_conv_sub.subscription_id
          and oeg_newer.created_at > v_conv_grant.created_at
          and oeg_newer.revoked_at is null
      ) into v_has_newer_sub_grant;

      -- Attributability checks:
      -- 1. Subscription must currently still be 'cancelled'
      -- 2. Subscription must reference this converting order (conversion_order_id = p_order_id)
      -- 3. No newer valid subscription grant has been created
      -- M3: attribute the CURRENT state to this conversion before restoring anything. A date-only
      -- (or status-only) administrator edit after the conversion changes the fingerprint, and the
      -- snapshot must then never be reapplied.
      v_current_fingerprint := md5(concat_ws('|',
        v_conv_sub.status::text,
        coalesce(v_conv_sub.start_date::text, ''),
        coalesce(v_conv_sub.end_date::text, ''),
        coalesce(v_conv_sub.grace_end_date::text, ''),
        coalesce(v_conv_sub.content_access_end_date::text, ''),
        coalesce(v_conv_sub.order_id::text, ''),
        coalesce(v_conv_sub.conversion_order_id::text, ''),
        coalesce(extract(epoch from v_conv_sub.cancelled_at)::text, '')
      ));
      v_expected_fingerprint := v_conv_grant.prior_state ->> 'post_conversion_fingerprint';

      if v_conv_sub.status = 'cancelled'::public.subscription_status_type
         and v_conv_sub.conversion_order_id = p_order_id
         and not v_has_newer_sub_grant
         and v_conv_grant.prior_state is not null
         and (
           (v_expected_fingerprint is not null and v_current_fingerprint = v_expected_fingerprint)
           or (
             v_expected_fingerprint is null
             and v_conv_sub.end_date is not distinct from (v_conv_grant.prior_state ->> 'end_date')::date
             and v_conv_sub.grace_end_date is not distinct from (v_conv_grant.prior_state ->> 'grace_end_date')::date
           )
         )
      then
        -- Provably still the state this conversion created. Decide status from the CURRENT dates so
        -- an administrator's extension is honoured rather than replaced by the stale snapshot.
        update public.student_subscriptions
        set status = case
              when v_conv_sub.end_date >= current_date then 'active'::public.subscription_status_type
              when coalesce(v_conv_sub.grace_end_date, v_conv_sub.end_date) >= current_date then 'grace'::public.subscription_status_type
              else coalesce(nullif(v_conv_grant.prior_state ->> 'prior_status', '')::public.subscription_status_type, 'expired'::public.subscription_status_type)
            end,
            conversion_order_id = null,
            cancelled_at = null,
            updated_at = now()
        where subscription_id = v_conv_sub.subscription_id;

        -- Reactivate course enrollment strictly for THIS course only if restored status is active or grace
        if v_conv_sub.end_date >= current_date
           or coalesce(v_conv_sub.grace_end_date, v_conv_sub.end_date) >= current_date
        then
          update public.course_enrollments ce
          set is_active = true,
              enrollment_type = 'subscription',
              revoked_at = null,
              revoked_reason = null,
              revoked_by = null,
              updated_at = now()
          where ce.student_id = v_target_order.student_id
            and ce.course_id = v_conv_sub.course_id;
        end if;
      elsif v_expected_fingerprint is not null and v_current_fingerprint <> v_expected_fingerprint then
        -- An administrator (or another process) changed the subscription after the conversion.
        -- Leave their state untouched and make the divergence durably visible for review.
        update public.orders
        set admin_review_reason = coalesce(admin_review_reason || ' | ', '') ||
              'CONVERSION_REFUND_STATE_DIVERGED: subscription ' || v_conv_sub.subscription_id::text ||
              ' was modified after being converted by order ' || p_order_id::text || '; prior_state NOT restored.',
            updated_at = now()
        where order_id = p_order_id;
      end if;

      -- Mark conversion grant as revoked
      update public.order_entitlement_grants
      set revoked_at = now(),
          revoked_reason = p_reason
      where grant_id = v_conv_grant.grant_id;
    end if;
  end loop;

  -- Mark any remaining grants for this order revoked
  update public.order_entitlement_grants
  set revoked_at = now(),
      revoked_reason = p_reason
  where order_id = p_order_id
    and revoked_at is null;
end;
$$;

comment on function public.revoke_standard_order_entitlements is
  'Dedicated internal atomic helper for reversing entitlements attributable strictly to the refunded order, preserving existing valid entitlements, reverting renewal periods, and restoring subscriptions cancelled via course conversion.';

-- ============================================================================
-- 3. RPC: Order-Level Razorpay Gateway Order Reconciliation
-- ============================================================================
create or replace function public.reconcile_standard_order_gateway_order(
  p_order_id            uuid,
  p_payment_id          uuid,
  p_gateway_order_id    text,
  p_expected_amount     numeric default null,
  p_expected_currency   text default null,
  p_event_type          text default 'checkout'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_role                 text;
  v_competing_payment           record;
  v_target_order                record;
  v_target_payment              record;
  v_existing_notes_rzp_order    text;
begin
  -- 1. Security & Role Authorization Check (Strict Fail-Closed)
  -- H1: authorize with auth.role(), matching migrations 219/234. auth.role() reads the verified
  -- request.jwt.claims payload, whereas request.jwt.claim.role is a legacy per-claim GUC that is not
  -- populated by current PostgREST builds. Fail-closed semantics below are unchanged.
  v_caller_role := auth.role();
  if coalesce(v_caller_role, '') <> 'service_role' then
    return jsonb_build_object(
      'success', false,
      'code', 'UNAUTHORIZED',
      'error', 'Only service_role is authorized to execute standard order reconciliation.'
    );
  end if;

  -- 2. Validate Parameters
  if p_order_id is null or p_payment_id is null or p_gateway_order_id is null or trim(p_gateway_order_id) = '' then
    return jsonb_build_object(
      'success', false,
      'code', 'INVALID_PARAMETERS',
      'error', 'Missing required order_id, payment_id, or gateway_order_id parameter.'
    );
  end if;

  -- 3. Database-Level Transaction-Scoped Advisory Lock
  -- Strictly serializes concurrent workers claiming or reconciling this specific Razorpay Order ID
  perform pg_advisory_xact_lock(hashtext('rzp_order_claim:' || trim(p_gateway_order_id)));

  -- 4. Guard 1: Verify incoming Razorpay Order ID is NOT already claimed by a DIFFERENT internal order
  select payment_id, order_id, status
  into v_competing_payment
  from public.payments
  where gateway = 'razorpay'::public.payment_gateway
    and gateway_order_id = trim(p_gateway_order_id)
    and order_id <> p_order_id
  limit 1;

  if v_competing_payment.payment_id is not null then
    return jsonb_build_object(
      'success', false,
      'code', 'GATEWAY_ORDER_ALREADY_ASSOCIATED_WITH_ANOTHER_ORDER',
      'error', 'Razorpay Order ID is already mapped to a different internal order.',
      'conflict_order_id', v_competing_payment.order_id,
      'conflict_payment_id', v_competing_payment.payment_id
    );
  end if;

  -- 5. Lock & Inspect the Internal Order First (Orders-before-Payments lock hierarchy)
  select order_id, institute_id, total_amount, currency, status, notes
  into v_target_order
  from public.orders
  where order_id = p_order_id
  for update;

  if v_target_order.order_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'ORDER_NOT_FOUND',
      'error', 'Internal order not found.'
    );
  end if;

  -- 6. Guard 2: Prevent Stale Workers from Overwriting an Existing Association
  v_existing_notes_rzp_order := nullif(trim(coalesce(nullif(v_target_order.notes, '')::jsonb ->> 'razorpayOrderId', '')), '');
  if v_existing_notes_rzp_order is not null and v_existing_notes_rzp_order <> trim(p_gateway_order_id) then
    return jsonb_build_object(
      'success', false,
      'code', 'ORDER_ALREADY_ASSOCIATED_WITH_ANOTHER_GATEWAY_ORDER',
      'error', 'Internal order is already associated with a different Razorpay Order ID: ' || v_existing_notes_rzp_order,
      'existing_gateway_order_id', v_existing_notes_rzp_order,
      'incoming_gateway_order_id', trim(p_gateway_order_id)
    );
  end if;

  -- 7. Lock & Inspect the Candidate Payment Attempt Second
  select 
    payment_id,
    order_id,
    institute_id,
    amount,
    currency,
    gateway,
    status,
    gateway_order_id,
    gateway_payment_id,
    attempt_number,
    created_at
  into v_target_payment
  from public.payments
  where payment_id = p_payment_id
  for update;

  if v_target_payment.payment_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'PAYMENT_NOT_FOUND',
      'error', 'Candidate payment attempt not found.'
    );
  end if;

  -- 8. Guard 3: Candidate Payment Must Belong to p_order_id
  if v_target_payment.order_id <> p_order_id then
    return jsonb_build_object(
      'success', false,
      'code', 'INVALID_ORDER_MAPPING',
      'error', 'Candidate payment attempt does not belong to the supplied internal order.',
      'expected_order_id', p_order_id,
      'actual_order_id', v_target_payment.order_id
    );
  end if;

  -- 9. Guard 4: Gateway Must Be Razorpay
  if v_target_payment.gateway is distinct from 'razorpay'::public.payment_gateway then
    return jsonb_build_object(
      'success', false,
      'code', 'PAYMENT_STATUS_INELIGIBLE',
      'error', 'Payment gateway is not razorpay: ' || coalesce(v_target_payment.gateway::text, 'null')
    );
  end if;

  -- 10. Guard 5: Candidate Amount & Currency Verification
  if p_expected_amount is not null and abs(v_target_payment.amount - p_expected_amount) > 0.01 then
    return jsonb_build_object(
      'success', false,
      'code', 'AMOUNT_OR_CURRENCY_MISMATCH',
      'error', 'Candidate payment amount does not match expected amount.',
      'expected_amount', p_expected_amount,
      'payment_amount', v_target_payment.amount
    );
  end if;

  if p_expected_currency is not null and upper(coalesce(v_target_payment.currency::text, 'INR')) <> upper(p_expected_currency) then
    return jsonb_build_object(
      'success', false,
      'code', 'AMOUNT_OR_CURRENCY_MISMATCH',
      'error', 'Candidate payment currency does not match expected currency.',
      'expected_currency', p_expected_currency,
      'payment_currency', v_target_payment.currency
    );
  end if;

  -- 11. Guard 6: Never overwrite a DIFFERENT non-null gateway_order_id
  if v_target_payment.gateway_order_id is not null and v_target_payment.gateway_order_id <> trim(p_gateway_order_id) then
    return jsonb_build_object(
      'success', false,
      'code', 'CANDIDATE_GATEWAY_ORDER_MISMATCH',
      'error', 'Candidate payment attempt already has a different gateway order ID.',
      'existing_gateway_order_id', v_target_payment.gateway_order_id,
      'incoming_gateway_order_id', trim(p_gateway_order_id)
    );
  end if;

  -- 12. Status Eligibility & Event Handling
  if p_event_type = 'checkout' then
    if v_target_payment.status <> 'pending'::public.payment_status then
      return jsonb_build_object(
        'success', false,
        'code', 'PAYMENT_STATUS_INELIGIBLE',
        'error', 'Payment status is ineligible for checkout mapping: ' || v_target_payment.status::text,
        'current_status', v_target_payment.status
      );
    end if;

    if v_target_payment.gateway_order_id = trim(p_gateway_order_id) then
      return jsonb_build_object(
        'success', true,
        'code', 'ALREADY_MAPPED_TO_THIS_ATTEMPT',
        'action', 'already_mapped',
        'payment', row_to_json(v_target_payment)
      );
    else
      update public.payments
      set gateway_order_id = trim(p_gateway_order_id),
          updated_at = now()
      where payment_id = p_payment_id
        and gateway_order_id is null
        and status = 'pending'::public.payment_status;

      v_target_payment.gateway_order_id := trim(p_gateway_order_id);

      return jsonb_build_object(
        'success', true,
        'code', 'MAPPED',
        'action', 'mapped',
        'payment', row_to_json(v_target_payment)
      );
    end if;

  elsif v_target_payment.status = 'captured'::public.payment_status then
    if p_event_type = 'payment.failed' then
      -- Anti-downgrade rule: Never downgrade or associate captured payment with failure event
      return jsonb_build_object(
        'success', true,
        'action', 'ignored_captured',
        'code', 'ALREADY_CAPTURED',
        'message', 'Payment attempt was already captured; failure event ignored.',
        'payment', row_to_json(v_target_payment)
      );
    else
      -- Duplicate webhook idempotency for captured event
      return jsonb_build_object(
        'success', true,
        'action', 'already_captured',
        'code', case when v_target_payment.gateway_order_id = trim(p_gateway_order_id) then 'ALREADY_MAPPED_TO_THIS_ATTEMPT' else 'MAPPED' end,
        'payment', row_to_json(v_target_payment)
      );
    end if;

  elsif v_target_payment.status = 'failed'::public.payment_status then
    if p_event_type = 'payment.failed' and v_target_payment.gateway_order_id = trim(p_gateway_order_id) then
      return jsonb_build_object(
        'success', true,
        'action', 'already_failed',
        'code', 'ALREADY_MAPPED_TO_THIS_ATTEMPT',
        'payment', row_to_json(v_target_payment)
      );
    else
      return jsonb_build_object(
        'success', false,
        'code', 'PAYMENT_STATUS_INELIGIBLE',
        'error', 'Payment attempt has already failed and cannot be reassociated.'
      );
    end if;

  elsif v_target_payment.status <> 'pending'::public.payment_status then
    return jsonb_build_object(
      'success', false,
      'code', 'PAYMENT_STATUS_INELIGIBLE',
      'error', 'Payment attempt status is ineligible for reconciliation: ' || v_target_payment.status::text
    );

  else
    -- Status is 'pending': Eligible for webhook mapping
    if v_target_payment.gateway_order_id = trim(p_gateway_order_id) then
      return jsonb_build_object(
        'success', true,
        'action', 'already_mapped',
        'code', 'ALREADY_MAPPED_TO_THIS_ATTEMPT',
        'payment', row_to_json(v_target_payment)
      );
    else
      update public.payments
      set gateway_order_id = trim(p_gateway_order_id),
          updated_at = now()
      where payment_id = p_payment_id
        and gateway_order_id is null
        and status = 'pending'::public.payment_status;

      v_target_payment.gateway_order_id := trim(p_gateway_order_id);

      return jsonb_build_object(
        'success', true,
        'action', 'mapped',
        'code', 'MAPPED',
        'payment', row_to_json(v_target_payment)
      );
    end if;
  end if;
end;
$$;

comment on function public.reconcile_standard_order_gateway_order is
  'Order-scoped Razorpay Order ID reconciliation for standard checkout. Validates that multiple payment attempts sharing a gateway order belong to the same internal order, while strictly rejecting cross-order collisions.';

-- ============================================================================
-- 4. RPC: Atomic Standard Payment Attempt Creation & Reservation
-- ============================================================================
create or replace function public.create_standard_payment_attempt(
  p_order_id            uuid,
  p_gateway_order_id    text,
  p_amount              numeric,
  p_currency            text,
  p_status              text default 'pending',
  p_gateway_payment_id  text default null,
  p_failure_reason      text default null,
  p_gateway_response    jsonb default null,
  p_created_at          timestamptz default null,
  p_refund_amount       numeric default null,
  p_refund_gateway_id   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_role                 text;
  v_competing_payment           record;
  v_competing_payment_same_order record;
  v_existing_settled            record;
  v_target_order                record;
  v_existing_notes_rzp_order    text;
  v_next_attempt_number         smallint;
  v_new_payment                 record;
  v_created_timestamp           timestamptz;
  v_updated_notes               jsonb;
  v_effective_refund_amount     numeric;
  v_ledger_processed_total      numeric;
begin
  -- 1. Security & Role Authorization Check (Strict Fail-Closed)
  -- H1: authorize with auth.role(), matching migrations 219/234. auth.role() reads the verified
  -- request.jwt.claims payload, whereas request.jwt.claim.role is a legacy per-claim GUC that is not
  -- populated by current PostgREST builds. Fail-closed semantics below are unchanged.
  v_caller_role := auth.role();
  if coalesce(v_caller_role, '') <> 'service_role' then
    return jsonb_build_object(
      'success', false,
      'code', 'UNAUTHORIZED',
      'error', 'Only service_role is authorized to create standard payment attempts.'
    );
  end if;

  -- 2. Validate Parameters
  if p_order_id is null or p_gateway_order_id is null or trim(p_gateway_order_id) = '' or p_amount is null or p_amount <= 0 or p_currency is null then
    return jsonb_build_object(
      'success', false,
      'code', 'INVALID_PARAMETERS',
      'error', 'Missing or invalid order_id, gateway_order_id, amount, or currency parameter.'
    );
  end if;

  if p_status not in ('pending', 'captured', 'failed', 'refunded', 'partially_refunded') then
    return jsonb_build_object(
      'success', false,
      'code', 'INVALID_STATUS',
      'error', 'Target attempt status must be pending, captured, failed, refunded, or partially_refunded.'
    );
  end if;

  -- Validate authentic refund ID format if provided (rfnd_... format required; pay_ strictly forbidden)
  if p_refund_gateway_id is not null and trim(p_refund_gateway_id) <> '' then
    if trim(p_refund_gateway_id) not like 'rfnd_%' or length(trim(p_refund_gateway_id)) < 6 or trim(p_refund_gateway_id) like 'pay_%' then
      return jsonb_build_object(
        'success', false,
        'code', 'INVALID_REFUND_ID_FORMAT',
        'error', 'Refund gateway ID must be an authentic Razorpay refund identifier starting with rfnd_.'
      );
    end if;
  end if;

  -- Validate refund amount consistency with target status
  if p_status = 'refunded' then
    if p_refund_amount is not null and abs(p_refund_amount - p_amount) > 0.01 then
      return jsonb_build_object(
        'success', false,
        'code', 'CONTRADICTORY_REFUND_AMOUNT',
        'error', 'Full refund requires cumulative refund amount equal to original payment amount.',
        'expected_amount', p_amount,
        'refund_amount', p_refund_amount
      );
    end if;
    v_effective_refund_amount := p_amount;
  elsif p_status = 'partially_refunded' then
    if p_refund_amount is null or p_refund_amount <= 0 or p_refund_amount >= p_amount then
      return jsonb_build_object(
        'success', false,
        'code', 'INVALID_PARTIAL_REFUND_AMOUNT',
        'error', 'Partial refund requires refund amount strictly greater than zero and less than payment amount.'
      );
    end if;
    v_effective_refund_amount := p_refund_amount;
  else
    if p_refund_amount is not null and p_refund_amount > 0 then
      return jsonb_build_object(
        'success', false,
        'code', 'INVALID_CAPTURED_REFUND_AMOUNT',
        'error', 'Non-refunded payment attempt cannot have non-zero refund amount.'
      );
    end if;
    v_effective_refund_amount := null;
  end if;

  -- 3. Database-Level Transaction-Scoped Advisory Lock
  perform pg_advisory_xact_lock(hashtext('rzp_order_claim:' || trim(p_gateway_order_id)));

  -- 4. Guard 1: Verify incoming Razorpay Order ID is NOT already claimed by a DIFFERENT internal order
  select payment_id, order_id, status
  into v_competing_payment
  from public.payments
  where gateway = 'razorpay'::public.payment_gateway
    and gateway_order_id = trim(p_gateway_order_id)
    and order_id <> p_order_id
  limit 1;

  if v_competing_payment.payment_id is not null then
    return jsonb_build_object(
      'success', false,
      'code', 'GATEWAY_ORDER_ALREADY_ASSOCIATED_WITH_ANOTHER_ORDER',
      'error', 'Razorpay Order ID is already mapped to a different internal order.',
      'conflict_order_id', v_competing_payment.order_id,
      'conflict_payment_id', v_competing_payment.payment_id
    );
  end if;

  -- 5. Lock & Inspect the Internal Order First (Orders-before-Payments lock hierarchy)
  select order_id, institute_id, total_amount, currency, status, notes
  into v_target_order
  from public.orders
  where order_id = p_order_id
  for update;

  if v_target_order.order_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'ORDER_NOT_FOUND',
      'error', 'Internal order not found.'
    );
  end if;

  -- 6. Guard 2: Prevent Stale Workers from Overwriting an Existing Association
  v_existing_notes_rzp_order := nullif(trim(coalesce(nullif(v_target_order.notes, '')::jsonb ->> 'razorpayOrderId', '')), '');
  if v_existing_notes_rzp_order is not null and v_existing_notes_rzp_order <> trim(p_gateway_order_id) then
    return jsonb_build_object(
      'success', false,
      'code', 'ORDER_ALREADY_ASSOCIATED_WITH_ANOTHER_GATEWAY_ORDER',
      'error', 'Internal order is already associated with a different Razorpay Order ID: ' || v_existing_notes_rzp_order,
      'existing_gateway_order_id', v_existing_notes_rzp_order,
      'incoming_gateway_order_id', trim(p_gateway_order_id)
    );
  end if;

  select payment_id, gateway_order_id
  into v_competing_payment_same_order
  from public.payments
  where order_id = p_order_id
    and gateway = 'razorpay'::public.payment_gateway
    and gateway_order_id is not null
    and gateway_order_id <> trim(p_gateway_order_id)
  limit 1;

  if v_competing_payment_same_order.payment_id is not null then
    return jsonb_build_object(
      'success', false,
      'code', 'ORDER_ALREADY_ASSOCIATED_WITH_ANOTHER_GATEWAY_ORDER',
      'error', 'Internal order already has payment attempts associated with a different gateway order ID: ' || v_competing_payment_same_order.gateway_order_id,
      'existing_gateway_order_id', v_competing_payment_same_order.gateway_order_id,
      'incoming_gateway_order_id', trim(p_gateway_order_id)
    );
  end if;

  -- 7. Settled Invariant Check: If attempting to create a captured row, verify no settled payment exists
  if p_status in ('captured', 'refunded', 'partially_refunded') then
    select payment_id, attempt_number, status
    into v_existing_settled
    from public.payments
    where gateway = 'razorpay'::public.payment_gateway
      and gateway_order_id = trim(p_gateway_order_id)
      and status in (
        'captured'::public.payment_status,
        'refunded'::public.payment_status,
        'partially_refunded'::public.payment_status
      )
    limit 1;

    if v_existing_settled.payment_id is not null then
      return jsonb_build_object(
        'success', false,
        'code', 'ORDER_ALREADY_SETTLED',
        'error', 'A settled payment attempt already exists for this gateway order.',
        'existing_payment_id', v_existing_settled.payment_id,
        'existing_status', v_existing_settled.status
      );
    end if;
  end if;

  -- 8. Calculate Next Attempt Number Atomically
  select coalesce(max(attempt_number), 0) + 1
  into v_next_attempt_number
  from public.payments
  where order_id = p_order_id;

  v_created_timestamp := coalesce(p_created_at, now());

  -- 9. Insert Payment Row Atomically Under Advisory & Order Lock
  insert into public.payments (
    order_id,
    institute_id,
    attempt_number,
    gateway,
    gateway_order_id,
    gateway_payment_id,
    amount,
    currency,
    status,
    failure_reason,
    gateway_response,
    created_at,
    paid_at,
    refund_amount,
    refund_gateway_id,
    refunded_at
  ) values (
    p_order_id,
    v_target_order.institute_id,
    v_next_attempt_number,
    'razorpay'::public.payment_gateway,
    trim(p_gateway_order_id),
    p_gateway_payment_id,
    p_amount,
    p_currency::public.currency_code,
    p_status::public.payment_status,
    p_failure_reason,
    p_gateway_response,
    v_created_timestamp,
    case when p_status = 'captured' then v_created_timestamp else null end,
    v_effective_refund_amount,
    case when p_status in ('refunded', 'partially_refunded') then nullif(trim(p_refund_gateway_id), '') else null end,
    case when p_status in ('refunded', 'partially_refunded') then v_created_timestamp else null end
  )
  returning 
    payment_id, order_id, institute_id, attempt_number, gateway,
    gateway_order_id, gateway_payment_id, amount, currency, status,
    failure_reason, created_at, paid_at, refund_amount, refund_gateway_id, refunded_at
  into v_new_payment;

  -- 10. Payment refund events are recorded authoritatively by reconcile_standard_refund and checkout recovery

  -- 11. Atomically Persist razorpayOrderId in orders.notes and clear any active gatewayClaim lease
  v_updated_notes := jsonb_set(
    coalesce(nullif(v_target_order.notes, '')::jsonb, '{}'::jsonb),
    '{razorpayOrderId}',
    to_jsonb(trim(p_gateway_order_id))
  );
  v_updated_notes := v_updated_notes - 'gatewayClaim';

  update public.orders
  set notes = v_updated_notes::text,
      updated_at = now()
  where order_id = p_order_id;

  return jsonb_build_object(
    'success', true,
    'action', 'created',
    'code', 'ATTEMPT_CREATED',
    'payment', row_to_json(v_new_payment)
  );
end;
$$;

comment on function public.create_standard_payment_attempt is
  'Atomically creates a new payment attempt row with serialized attempt_number increment, order-level Razorpay Order ID ownership enforcement, stale worker protection, authentic refund ID format validation, refund event ledger registration, and atomic persistence of razorpayOrderId in orders.notes.';

-- ============================================================================
-- 5. RPC: Atomic Standard Paid Order Payment Reconciliation
-- ============================================================================
create or replace function public.reconcile_standard_paid_order(
  p_order_id            uuid,
  p_gateway_order_id    text,
  p_gateway_payment_id  text,
  p_payment_status      text,
  p_amount              numeric,
  p_currency            text,
  p_refund_amount       numeric default null,
  p_refund_gateway_id   text default null,
  p_paid_at             timestamptz default null,
  p_refunded_at         timestamptz default null,
  p_gateway_response    jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_role                 text;
  v_target_order                record;
  v_existing_notes_rzp_order    text;
  v_competing_order_payment     record;
  v_competing_payment_same_order record;
  v_competing_payment_id_check  record;
  v_exact_same_payment          record;
  v_diff_settled_payment        record;
  v_latest_attempt              record;
  v_reconciled_payment          record;
  v_next_attempt_number         smallint;
  v_action                      text;
  v_effective_paid_at           timestamptz;
  v_effective_refunded_at       timestamptz;
  v_effective_refund_amount     numeric;
  v_updated_notes               jsonb;
begin
  -- 1. Security & Role Authorization Check (Strict Fail-Closed)
  -- H1: authorize with auth.role(), matching migrations 219/234. auth.role() reads the verified
  -- request.jwt.claims payload, whereas request.jwt.claim.role is a legacy per-claim GUC that is not
  -- populated by current PostgREST builds. Fail-closed semantics below are unchanged.
  v_caller_role := auth.role();
  if coalesce(v_caller_role, '') <> 'service_role' then
    return jsonb_build_object(
      'success', false,
      'code', 'UNAUTHORIZED',
      'error', 'Only service_role is authorized to reconcile standard paid orders.'
    );
  end if;

  -- 2. Validate Parameters
  if p_order_id is null or 
     p_gateway_order_id is null or trim(p_gateway_order_id) = '' or
     p_gateway_payment_id is null or trim(p_gateway_payment_id) = '' or
     p_amount is null or p_amount <= 0 or
     p_currency is null or trim(p_currency) = '' then
    return jsonb_build_object(
      'success', false,
      'code', 'INVALID_PARAMETERS',
      'error', 'Missing or invalid required parameters.'
    );
  end if;

  if p_payment_status not in ('captured', 'refunded', 'partially_refunded') then
    return jsonb_build_object(
      'success', false,
      'code', 'INVALID_STATUS',
      'error', 'Target payment status must be captured, refunded, or partially_refunded.'
    );
  end if;

  -- Validate authentic refund ID format if provided (rfnd_... format required; pay_ strictly forbidden)
  if p_refund_gateway_id is not null and trim(p_refund_gateway_id) <> '' then
    if trim(p_refund_gateway_id) not like 'rfnd_%' or length(trim(p_refund_gateway_id)) < 6 or trim(p_refund_gateway_id) like 'pay_%' then
      return jsonb_build_object(
        'success', false,
        'code', 'INVALID_REFUND_ID_FORMAT',
        'error', 'Refund gateway ID must be an authentic Razorpay refund identifier starting with rfnd_.'
      );
    end if;
  end if;

  -- Validate refund amount consistency with target status
  if p_payment_status = 'refunded' then
    if p_refund_amount is not null and abs(p_refund_amount - p_amount) > 0.01 then
      return jsonb_build_object(
        'success', false,
        'code', 'CONTRADICTORY_REFUND_AMOUNT',
        'error', 'Full refund requires cumulative refund amount equal to original payment amount.',
        'expected_amount', p_amount,
        'refund_amount', p_refund_amount
      );
    end if;
    v_effective_refund_amount := p_amount;
  elsif p_payment_status = 'partially_refunded' then
    if p_refund_amount is null or p_refund_amount <= 0 or p_refund_amount >= p_amount then
      return jsonb_build_object(
        'success', false,
        'code', 'INVALID_PARTIAL_REFUND_AMOUNT',
        'error', 'Partial refund requires refund amount strictly greater than zero and less than payment amount.'
      );
    end if;
    v_effective_refund_amount := p_refund_amount;
  else
    if p_refund_amount is not null and p_refund_amount > 0 then
      return jsonb_build_object(
        'success', false,
        'code', 'INVALID_CAPTURED_REFUND_AMOUNT',
        'error', 'Captured payment cannot have non-zero refund amount.'
      );
    end if;
    v_effective_refund_amount := null;
  end if;

  -- 3. Database-Level Transaction-Scoped Advisory Lock
  -- Strictly serializes all workers attempting to claim or reconcile this Razorpay Order ID
  perform pg_advisory_xact_lock(hashtext('rzp_order_claim:' || trim(p_gateway_order_id)));

  -- 4. Guard 1: Verify incoming Razorpay Order ID is NOT already claimed by a DIFFERENT internal order
  select payment_id, order_id, status
  into v_competing_order_payment
  from public.payments
  where gateway = 'razorpay'::public.payment_gateway
    and gateway_order_id = trim(p_gateway_order_id)
    and order_id <> p_order_id
  limit 1;

  if v_competing_order_payment.payment_id is not null then
    return jsonb_build_object(
      'success', false,
      'code', 'GATEWAY_ORDER_ALREADY_ASSOCIATED_WITH_ANOTHER_ORDER',
      'error', 'Razorpay Order ID is already mapped to a different internal order.',
      'conflict_order_id', v_competing_order_payment.order_id,
      'conflict_payment_id', v_competing_order_payment.payment_id
    );
  end if;

  -- 5. Lock & Inspect the Internal Order First (Orders-before-Payments lock hierarchy)
  select order_id, institute_id, total_amount, currency, status, notes
  into v_target_order
  from public.orders
  where order_id = p_order_id
  for update;

  if v_target_order.order_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'ORDER_NOT_FOUND',
      'error', 'Internal order not found.'
    );
  end if;

  -- 6. Guard 2: Prevent Stale Workers from Overwriting an Existing Association
  v_existing_notes_rzp_order := nullif(trim(coalesce(nullif(v_target_order.notes, '')::jsonb ->> 'razorpayOrderId', '')), '');
  if v_existing_notes_rzp_order is not null and v_existing_notes_rzp_order <> trim(p_gateway_order_id) then
    return jsonb_build_object(
      'success', false,
      'code', 'ORDER_ALREADY_ASSOCIATED_WITH_ANOTHER_GATEWAY_ORDER',
      'error', 'Internal order is already associated with a different Razorpay Order ID: ' || v_existing_notes_rzp_order,
      'existing_gateway_order_id', v_existing_notes_rzp_order,
      'incoming_gateway_order_id', trim(p_gateway_order_id)
    );
  end if;

  select payment_id, gateway_order_id
  into v_competing_payment_same_order
  from public.payments
  where order_id = p_order_id
    and gateway = 'razorpay'::public.payment_gateway
    and gateway_order_id is not null
    and gateway_order_id <> trim(p_gateway_order_id)
  limit 1;

  if v_competing_payment_same_order.payment_id is not null then
    return jsonb_build_object(
      'success', false,
      'code', 'ORDER_ALREADY_ASSOCIATED_WITH_ANOTHER_GATEWAY_ORDER',
      'error', 'Internal order already has payment attempts associated with a different gateway order ID: ' || v_competing_payment_same_order.gateway_order_id,
      'existing_gateway_order_id', v_competing_payment_same_order.gateway_order_id,
      'incoming_gateway_order_id', trim(p_gateway_order_id)
    );
  end if;

  -- 7. Cross-Order / Cross-Gateway Payment ID Integrity Check:
  -- Verify that this exact gateway_payment_id is NOT assigned to another order or a different gateway order
  select payment_id, order_id, gateway_order_id
  into v_competing_payment_id_check
  from public.payments
  where gateway = 'razorpay'::public.payment_gateway
    and gateway_payment_id = trim(p_gateway_payment_id)
    and (order_id <> p_order_id or (gateway_order_id is not null and gateway_order_id <> trim(p_gateway_order_id)))
  limit 1;

  if v_competing_payment_id_check.payment_id is not null then
    return jsonb_build_object(
      'success', false,
      'code', 'GATEWAY_PAYMENT_ALREADY_ASSOCIATED_ELSEWHERE',
      'error', 'Gateway payment ID is already associated with another order or gateway order.',
      'conflict_order_id', v_competing_payment_id_check.order_id,
      'conflict_gateway_order_id', v_competing_payment_id_check.gateway_order_id
    );
  end if;

  -- 8. Exact Payment Check on This Internal Order
  select *
  into v_exact_same_payment
  from public.payments
  where order_id = p_order_id
    and gateway = 'razorpay'::public.payment_gateway
    and gateway_payment_id = trim(p_gateway_payment_id)
  limit 1
  for update;

  if v_exact_same_payment.payment_id is not null then
    -- Guard 3: If gateway_order_id is already set, it must match incoming p_gateway_order_id
    if v_exact_same_payment.gateway_order_id is not null and v_exact_same_payment.gateway_order_id <> trim(p_gateway_order_id) then
      return jsonb_build_object(
        'success', false,
        'code', 'GATEWAY_PAYMENT_ASSOCIATED_WITH_DIFFERENT_GATEWAY_ORDER',
        'error', 'Gateway payment ID is already associated with a different gateway order: ' || v_exact_same_payment.gateway_order_id,
        'existing_payment_id', v_exact_same_payment.payment_id,
        'existing_gateway_order_id', v_exact_same_payment.gateway_order_id,
        'incoming_gateway_order_id', trim(p_gateway_order_id)
      );
    end if;

    -- Option A: If existing payment has NULL gateway_order_id, atomically populate it under lock
    if v_exact_same_payment.gateway_order_id is null then
      update public.payments
      set gateway_order_id = trim(p_gateway_order_id),
          updated_at = now()
      where payment_id = v_exact_same_payment.payment_id;

      v_exact_same_payment.gateway_order_id := trim(p_gateway_order_id);
    end if;

    -- Strict Monotonic Refund State Transitions:
    -- Rule A: Terminal refunded state cannot regress to captured or partially_refunded
    if v_exact_same_payment.status = 'refunded'::public.payment_status then
      if p_payment_status in ('captured', 'partially_refunded') then
        return jsonb_build_object(
          'success', true,
          'action', 'ignored_downgrade',
          'code', 'ALREADY_REFUNDED',
          'message', 'Payment is already fully refunded; incoming ' || p_payment_status || ' state ignored.',
          'payment', row_to_json(v_exact_same_payment)
        );
      else
        -- Idempotent duplicate full refund: preserve authentic refund ID and non-decreasing refund amount
        v_effective_refund_amount := p_amount;
        update public.payments
        set refund_amount = v_effective_refund_amount,
            refund_gateway_id = coalesce(nullif(trim(p_refund_gateway_id), ''), refund_gateway_id),
            gateway_response = coalesce(p_gateway_response, gateway_response),
            updated_at = now()
        where payment_id = v_exact_same_payment.payment_id
        returning * into v_reconciled_payment;



        return jsonb_build_object(
          'success', true,
          'action', 'already_reconciled',
          'code', 'ALREADY_RECONCILED',
          'payment', row_to_json(v_reconciled_payment)
        );
      end if;

    -- Rule B: Partially refunded state cannot regress to captured
    elsif v_exact_same_payment.status = 'partially_refunded'::public.payment_status then
      if p_payment_status = 'captured' then
        return jsonb_build_object(
          'success', true,
          'action', 'ignored_downgrade',
          'code', 'ALREADY_PARTIALLY_REFUNDED',
          'message', 'Payment is already partially refunded; incoming captured state ignored.',
          'payment', row_to_json(v_exact_same_payment)
        );
      elsif p_payment_status = 'refunded' then
        -- Allowed Transition: partially_refunded -> refunded
        v_effective_refund_amount := p_amount;
        update public.payments
        set status = 'refunded'::public.payment_status,
            refund_amount = v_effective_refund_amount,
            refund_gateway_id = coalesce(nullif(trim(p_refund_gateway_id), ''), refund_gateway_id),
            refunded_at = coalesce(p_refunded_at, now()),
            gateway_response = coalesce(p_gateway_response, gateway_response),
            updated_at = now()
        where payment_id = v_exact_same_payment.payment_id
        returning * into v_reconciled_payment;



        return jsonb_build_object(
          'success', true,
          'action', 'transitioned_to_refunded',
          'code', 'REFUND_RECORDED',
          'payment', row_to_json(v_reconciled_payment)
        );
      else
        -- Duplicate or subsequent partial refund: cumulative refund amount cannot decrease
        v_effective_refund_amount := greatest(coalesce(v_exact_same_payment.refund_amount, 0), v_effective_refund_amount);
        update public.payments
        set status = case when v_effective_refund_amount >= v_exact_same_payment.amount then 'refunded'::public.payment_status else 'partially_refunded'::public.payment_status end,
            refund_amount = v_effective_refund_amount,
            refund_gateway_id = coalesce(nullif(trim(p_refund_gateway_id), ''), refund_gateway_id),
            gateway_response = coalesce(p_gateway_response, gateway_response),
            updated_at = now()
        where payment_id = v_exact_same_payment.payment_id
        returning * into v_reconciled_payment;



        return jsonb_build_object(
          'success', true,
          'action', 'already_reconciled',
          'code', 'ALREADY_RECONCILED',
          'payment', row_to_json(v_reconciled_payment)
        );
      end if;

    -- Rule C: Captured state transitioning to refunded or partially_refunded
    elsif v_exact_same_payment.status = 'captured'::public.payment_status then
      if p_payment_status = 'captured' then
        -- Idempotent duplicate captured
        return jsonb_build_object(
          'success', true,
          'action', 'already_reconciled',
          'code', 'ALREADY_RECONCILED',
          'payment', row_to_json(v_exact_same_payment)
        );
      else
        -- Allowed Transition: captured -> refunded / partially_refunded
        update public.payments
        set status = p_payment_status::public.payment_status,
            refund_amount = v_effective_refund_amount,
            refund_gateway_id = coalesce(nullif(trim(p_refund_gateway_id), ''), refund_gateway_id),
            refunded_at = coalesce(p_refunded_at, now()),
            gateway_response = coalesce(p_gateway_response, gateway_response),
            updated_at = now()
        where payment_id = v_exact_same_payment.payment_id
        returning * into v_reconciled_payment;

        -- H2: a gateway-confirmed FULL refund must revoke here, not only in the unreachable
        -- step below. Previously this early return left orders.status = 'confirmed' with live
        -- entitlements whenever the gateway refunds array came back empty.
        if p_payment_status = 'refunded'::text then
          if v_target_order.status not in ('cancelled'::public.order_status, 'refunded'::public.order_status) then
            update public.orders
            set status = 'cancelled'::public.order_status,
                cancelled_at = coalesce(cancelled_at, now()),
                updated_at = now()
            where order_id = p_order_id;
          end if;

          perform public.revoke_standard_order_entitlements(
            p_order_id,
            'Payment fully refunded upon paid-order reconciliation (payment: ' || trim(p_gateway_payment_id) || ')'
          );
        end if;

        return jsonb_build_object(
          'success', true,
          'action', case when p_payment_status = 'refunded' then 'updated_to_refunded' else 'updated_to_partially_refunded' end,
          'code', 'REFUND_RECORDED',
          'payment', row_to_json(v_reconciled_payment)
        );
      end if;

    else
      -- Status is pending: eligible for resolution in step 11
      null;
    end if;
  end if;

  -- 9. Guard 4: Has a DIFFERENT payment already settled this Razorpay Order ID?
  select payment_id, gateway_payment_id, status, attempt_number
  into v_diff_settled_payment
  from public.payments
  where gateway = 'razorpay'::public.payment_gateway
    and gateway_order_id = trim(p_gateway_order_id)
    and status in (
      'captured'::public.payment_status,
      'refunded'::public.payment_status,
      'partially_refunded'::public.payment_status
    )
    and (gateway_payment_id is null or gateway_payment_id <> trim(p_gateway_payment_id))
  limit 1;

  if v_diff_settled_payment.payment_id is not null then
    return jsonb_build_object(
      'success', false,
      'code', 'ORDER_SETTLED_BY_DIFFERENT_PAYMENT',
      'error', 'Razorpay Order ID is already settled by a different payment: ' || coalesce(v_diff_settled_payment.gateway_payment_id, 'null'),
      'conflict_payment_id', v_diff_settled_payment.payment_id,
      'conflict_gateway_payment_id', v_diff_settled_payment.gateway_payment_id,
      'conflict_status', v_diff_settled_payment.status
    );
  end if;

  -- 10. Inspect the Latest Payment Attempt on This Internal Order
  select *
  into v_latest_attempt
  from public.payments
  where order_id = p_order_id
    and gateway = 'razorpay'::public.payment_gateway
  order by attempt_number desc
  limit 1
  for update;

  v_effective_paid_at := case when p_payment_status = 'captured' then coalesce(p_paid_at, now()) else null end;
  v_effective_refunded_at := case when p_payment_status in ('refunded', 'partially_refunded') then coalesce(p_refunded_at, now()) else null end;

  -- 11. Attempt Resolution Rules:
  -- A candidate attempt is suitable to update if and only if:
  -- - Its status is 'pending'
  -- - Its gateway_order_id is null or equals p_gateway_order_id
  -- - Its gateway_payment_id is null or equals p_gateway_payment_id
  -- A historical 'failed' attempt must NEVER be updated or reassigned!
  if v_latest_attempt.payment_id is not null 
     and v_latest_attempt.status = 'pending'::public.payment_status
     and (v_latest_attempt.gateway_order_id is null or v_latest_attempt.gateway_order_id = trim(p_gateway_order_id))
     and (v_latest_attempt.gateway_payment_id is null or v_latest_attempt.gateway_payment_id = trim(p_gateway_payment_id))
  then
    -- Reconcile and update the pending attempt while strictly preserving attempt_number
    update public.payments
    set status = p_payment_status::public.payment_status,
        gateway_order_id = trim(p_gateway_order_id),
        gateway_payment_id = trim(p_gateway_payment_id),
        amount = p_amount,
        currency = p_currency::public.currency_code,
        paid_at = coalesce(v_effective_paid_at, paid_at),
        refund_amount = v_effective_refund_amount,
        refund_gateway_id = coalesce(nullif(trim(p_refund_gateway_id), ''), refund_gateway_id),
        refunded_at = v_effective_refunded_at,
        gateway_response = coalesce(p_gateway_response, gateway_response),
        updated_at = now()
    where payment_id = v_latest_attempt.payment_id
    returning * into v_reconciled_payment;



    v_action := 'reconciled_pending';

  else
    -- No suitable pending attempt exists (e.g. latest attempt is 'failed' or no attempt exists).
    -- Atomically insert a new payment attempt row with attempt_number = max + 1.
    -- Historical failed attempts are left completely untouched!
    select coalesce(max(attempt_number), 0) + 1
    into v_next_attempt_number
    from public.payments
    where order_id = p_order_id;

    insert into public.payments (
      order_id,
      institute_id,
      attempt_number,
      gateway,
      gateway_order_id,
      gateway_payment_id,
      amount,
      currency,
      status,
      created_at,
      paid_at,
      refund_amount,
      refund_gateway_id,
      refunded_at,
      gateway_response
    ) values (
      p_order_id,
      v_target_order.institute_id,
      v_next_attempt_number,
      'razorpay'::public.payment_gateway,
      trim(p_gateway_order_id),
      trim(p_gateway_payment_id),
      p_amount,
      p_currency::public.currency_code,
      p_payment_status::public.payment_status,
      coalesce(p_paid_at, now()),
      v_effective_paid_at,
      v_effective_refund_amount,
      nullif(trim(p_refund_gateway_id), ''),
      v_effective_refunded_at,
      p_gateway_response
    )
    returning * into v_reconciled_payment;



    v_action := 'created_new_attempt';
  end if;

  -- 12. Atomically Persist razorpayOrderId in orders.notes and clear active gatewayClaim
  v_updated_notes := jsonb_set(
    coalesce(nullif(v_target_order.notes, '')::jsonb, '{}'::jsonb),
    '{razorpayOrderId}',
    to_jsonb(trim(p_gateway_order_id))
  );
  v_updated_notes := v_updated_notes - 'gatewayClaim';

  update public.orders
  set notes = v_updated_notes::text,
      updated_at = now()
  where order_id = p_order_id;

  -- 13. Access Revocation on Full Refund:
  -- If payment is recovered in 'refunded' status, cancel order and revoke only order-attributable entitlements
  if p_payment_status = 'refunded' then
    if v_target_order.status not in ('cancelled'::public.order_status, 'refunded'::public.order_status) then
      update public.orders
      set status = 'cancelled'::public.order_status,
          cancelled_at = coalesce(cancelled_at, now()),
          updated_at = now()
      where order_id = p_order_id;
    end if;

    perform public.revoke_standard_order_entitlements(
      p_order_id,
      'Payment fully refunded upon recovery (payment: ' || trim(p_gateway_payment_id) || ')'
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'action', v_action,
    'code', 'RECONCILED',
    'payment', row_to_json(v_reconciled_payment)
  );
end;
$$;

comment on function public.reconcile_standard_paid_order is
  'Dedicated atomic payment-attempt reconciliation RPC for paid Razorpay Orders. Serializes execution under transaction-scoped advisory lock, enforces strict monotonic refund transitions, preserves authentic refund IDs, ensures cumulative refund amounts cannot decrease, safely resolves NULL gateway_order_id under lock via Option A, idempotently reconciles existing payments, updates pending attempts, creates new attempts if prior attempts failed without mutating history, cancels the order and revokes order-attributable entitlements on a gateway-confirmed full refund, and prevents stale worker overwrites. This RPC does not write payment_refund_events; the refund ledger is owned by reconcile_standard_refund and reconcile_standard_recovery_refunds.';

-- ============================================================================
-- 6. RPC: Atomic Standard Refund Webhook Synchronization
-- ============================================================================
create or replace function public.reconcile_standard_refund(
  p_gateway_payment_id  text,
  p_refund_gateway_id   text,
  p_refund_amount       numeric,
  p_refund_status       text default 'processed',
  p_refunded_at         timestamptz default null,
  p_gateway_response    jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_role                 text;
  v_target_payment              record;
  v_target_order                record;
  v_existing_event              record;
  v_inserted_event              record;
  v_ledger_processed_total      numeric;
  v_new_status                  public.payment_status;
  v_effective_amount            numeric;
  v_updated_payment             record;
begin
  -- 1. Security & Role Authorization Check (Strict Fail-Closed)
  -- H1: authorize with auth.role(), matching migrations 219/234. auth.role() reads the verified
  -- request.jwt.claims payload, whereas request.jwt.claim.role is a legacy per-claim GUC that is not
  -- populated by current PostgREST builds. Fail-closed semantics below are unchanged.
  v_caller_role := auth.role();
  if coalesce(v_caller_role, '') <> 'service_role' then
    return jsonb_build_object(
      'success', false,
      'code', 'UNAUTHORIZED',
      'error', 'Only service_role is authorized to execute standard refund reconciliation.'
    );
  end if;

  -- 2. Validate Parameters
  if p_gateway_payment_id is null or trim(p_gateway_payment_id) = '' or
     p_refund_gateway_id is null or trim(p_refund_gateway_id) = '' or
     p_refund_amount is null or p_refund_amount <= 0 then
    return jsonb_build_object(
      'success', false,
      'code', 'INVALID_PARAMETERS',
      'error', 'Missing or invalid payment ID, refund ID, or refund amount.'
    );
  end if;

  -- Authentic Razorpay refund ID format validation
  if trim(p_refund_gateway_id) not like 'rfnd_%' or length(trim(p_refund_gateway_id)) < 6 or trim(p_refund_gateway_id) like 'pay_%' then
    return jsonb_build_object(
      'success', false,
      'code', 'INVALID_REFUND_ID_FORMAT',
      'error', 'Refund gateway ID must be an authentic Razorpay refund identifier starting with rfnd_.'
    );
  end if;

  if p_refund_status not in ('processed', 'created', 'failed') then
    return jsonb_build_object(
      'success', false,
      'code', 'INVALID_STATUS',
      'error', 'Refund status must be processed, created, or failed.'
    );
  end if;

  -- 3. Lookup Candidate Payment
  select *
  into v_target_payment
  from public.payments
  where gateway = 'razorpay'::public.payment_gateway
    and gateway_payment_id = trim(p_gateway_payment_id)
  limit 1;

  if v_target_payment.payment_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'PAYMENT_NOT_FOUND',
      'error', 'Payment not found for gateway payment ID: ' || trim(p_gateway_payment_id)
    );
  end if;

  -- Status check: cannot process refund for failed payment
  if v_target_payment.status = 'failed'::public.payment_status then
    return jsonb_build_object(
      'success', false,
      'code', 'PAYMENT_STATUS_INELIGIBLE',
      'error', 'Cannot process refund for a failed payment attempt.'
    );
  end if;

  -- 4. Database-Level Transaction-Scoped Advisory Lock
  -- Uses the exact same lock key and strategy as checkout reconciliation
  if v_target_payment.gateway_order_id is not null then
    perform pg_advisory_xact_lock(hashtext('rzp_order_claim:' || trim(v_target_payment.gateway_order_id)));
  end if;

  -- 5. Lock Orders Row First (Orders-before-Payments lock hierarchy)
  if v_target_payment.order_id is not null then
    select order_id, institute_id, student_id, status, notes
    into v_target_order
    from public.orders
    where order_id = v_target_payment.order_id
    for update;
  end if;

  -- 6. Lock Payment Row FOR UPDATE
  select *
  into v_target_payment
  from public.payments
  where payment_id = v_target_payment.payment_id
  for update;

  -- 7. Inspect / Lock Existing Refund Event in Ledger
  select *
  into v_existing_event
  from public.payment_refund_events
  where gateway_refund_id = trim(p_refund_gateway_id)
  for update;

  -- Handle Lifecycle & Duplicate Scenarios
  if v_existing_event.refund_event_id is not null then
    -- Verify 4-way association integrity using NULL-safe IS DISTINCT FROM:
    if v_existing_event.payment_id is distinct from v_target_payment.payment_id or
       v_existing_event.order_id is distinct from v_target_payment.order_id then
      return jsonb_build_object(
        'success', false,
        'code', 'REFUND_ID_ASSOCIATION_CONFLICT',
        'error', 'Refund gateway ID ' || trim(p_refund_gateway_id) || ' is already associated with another payment or order.',
        'existing_event_id', v_existing_event.refund_event_id,
        'existing_payment_id', v_existing_event.payment_id,
        'existing_order_id', v_existing_event.order_id,
        'target_payment_id', v_target_payment.payment_id,
        'target_order_id', v_target_payment.order_id
      );
    end if;

    -- Gateway payment association validation & secure repair
    if v_existing_event.gateway_payment_id is null then
      update public.payment_refund_events
      set gateway_payment_id = trim(p_gateway_payment_id)
      where refund_event_id = v_existing_event.refund_event_id;
      v_existing_event.gateway_payment_id := trim(p_gateway_payment_id);
    elsif v_existing_event.gateway_payment_id is distinct from trim(p_gateway_payment_id) then
      return jsonb_build_object(
        'success', false,
        'code', 'REFUND_ID_ASSOCIATION_CONFLICT',
        'error', 'Refund gateway ID ' || trim(p_refund_gateway_id) || ' is associated with a different gateway payment ID.',
        'existing_gateway_payment_id', v_existing_event.gateway_payment_id,
        'target_gateway_payment_id', trim(p_gateway_payment_id)
      );
    end if;

    -- Gateway order association validation & secure repair
    if v_existing_event.gateway_order_id is null then
      if v_target_payment.gateway_order_id is not null then
        update public.payment_refund_events
        set gateway_order_id = trim(v_target_payment.gateway_order_id)
        where refund_event_id = v_existing_event.refund_event_id;
        v_existing_event.gateway_order_id := trim(v_target_payment.gateway_order_id);
      else
        return jsonb_build_object(
          'success', false,
          'code', 'REFUND_INCOMPLETE_ASSOCIATION',
          'error', 'Refund event has no associated gateway order ID and target payment has no gateway order ID.'
        );
      end if;
    elsif v_target_payment.gateway_order_id is not null and v_existing_event.gateway_order_id is distinct from trim(v_target_payment.gateway_order_id) then
      return jsonb_build_object(
        'success', false,
        'code', 'REFUND_ID_ASSOCIATION_CONFLICT',
        'error', 'Refund gateway ID ' || trim(p_refund_gateway_id) || ' is associated with a different gateway order ID.',
        'existing_gateway_order_id', v_existing_event.gateway_order_id,
        'target_gateway_order_id', trim(v_target_payment.gateway_order_id)
      );
    end if;

    if v_existing_event.status = 'processed' then
      -- Duplicate delivery of processed refund: completely idempotent, never adds amount again!
      return jsonb_build_object(
        'success', true,
        'action', 'already_processed',
        'code', 'ALREADY_PROCESSED',
        'payment', row_to_json(v_target_payment)
      );

    elsif v_existing_event.status = 'created' then
      if p_refund_status = 'created' then
        -- Duplicate delivery of created event
        return jsonb_build_object(
          'success', true,
          'action', 'already_created',
          'code', 'REFUND_CREATED',
          'payment', row_to_json(v_target_payment)
        );
      elsif p_refund_status = 'failed' then
        -- Transition created -> failed
        update public.payment_refund_events
        set status = 'failed',
            gateway_response = coalesce(p_gateway_response, gateway_response)
        where refund_event_id = v_existing_event.refund_event_id;

        return jsonb_build_object(
          'success', true,
          'action', 'refund_failed_recorded',
          'code', 'REFUND_FAILED',
          'payment', row_to_json(v_target_payment)
        );
      elsif p_refund_status = 'processed' then
        -- Valid progression: created -> processed!
        update public.payment_refund_events
        set status = 'processed',
            amount = p_refund_amount,
            processed_at = coalesce(p_refunded_at, now()),
            gateway_response = coalesce(p_gateway_response, gateway_response)
        where refund_event_id = v_existing_event.refund_event_id;
      end if;

    elsif v_existing_event.status = 'failed' then
      -- Failed refund event already recorded
      return jsonb_build_object(
        'success', true,
        'action', 'already_failed',
        'code', 'REFUND_FAILED',
        'payment', row_to_json(v_target_payment)
      );
    end if;

  else
    -- First time seeing this refund ID: insert into ledger with unique conflict guard
    insert into public.payment_refund_events (
      payment_id,
      order_id,
      gateway,
      gateway_refund_id,
      gateway_payment_id,
      gateway_order_id,
      amount,
      currency,
      status,
      gateway_response,
      processed_at
    ) values (
      v_target_payment.payment_id,
      v_target_payment.order_id,
      'razorpay'::public.payment_gateway,
      trim(p_refund_gateway_id),
      trim(p_gateway_payment_id),
      v_target_payment.gateway_order_id,
      p_refund_amount,
      v_target_payment.currency,
      p_refund_status,
      p_gateway_response,
      case when p_refund_status = 'processed' then coalesce(p_refunded_at, now()) else null end
    )
    on conflict (gateway_refund_id) do nothing
    returning * into v_inserted_event;

    if v_inserted_event.refund_event_id is null then
      -- Concurrent insertion detected! Re-fetch with FOR UPDATE and validate association integrity
      select *
      into v_existing_event
      from public.payment_refund_events
      where gateway_refund_id = trim(p_refund_gateway_id)
      for update;

      if v_existing_event.refund_event_id is not null then
        if v_existing_event.payment_id is distinct from v_target_payment.payment_id or
           v_existing_event.order_id is distinct from v_target_payment.order_id then
          return jsonb_build_object(
            'success', false,
            'code', 'REFUND_ID_ASSOCIATION_CONFLICT',
            'error', 'Concurrent refund insertion detected: Refund gateway ID is already associated with another payment or order.'
          );
        end if;

        if v_existing_event.gateway_payment_id is null then
          update public.payment_refund_events
          set gateway_payment_id = trim(p_gateway_payment_id)
          where refund_event_id = v_existing_event.refund_event_id;
        elsif v_existing_event.gateway_payment_id is distinct from trim(p_gateway_payment_id) then
          return jsonb_build_object(
            'success', false,
            'code', 'REFUND_ID_ASSOCIATION_CONFLICT',
            'error', 'Concurrent refund insertion detected: association mismatch on gateway payment ID.'
          );
        end if;

        if v_existing_event.gateway_order_id is null then
          if v_target_payment.gateway_order_id is not null then
            update public.payment_refund_events
            set gateway_order_id = trim(v_target_payment.gateway_order_id)
            where refund_event_id = v_existing_event.refund_event_id;
          end if;
        elsif v_target_payment.gateway_order_id is not null and v_existing_event.gateway_order_id is distinct from trim(v_target_payment.gateway_order_id) then
          return jsonb_build_object(
            'success', false,
            'code', 'REFUND_ID_ASSOCIATION_CONFLICT',
            'error', 'Concurrent refund insertion detected: association mismatch on gateway order ID.'
          );
        end if;

        if v_existing_event.status = 'processed' then
          return jsonb_build_object(
            'success', true,
            'action', 'already_processed',
            'code', 'ALREADY_PROCESSED',
            'payment', row_to_json(v_target_payment)
          );
        end if;
      end if;
    end if;

    -- If event is created or failed, do not modify payment amounts
    if p_refund_status = 'failed' then
      return jsonb_build_object(
        'success', true,
        'action', 'refund_failed_recorded',
        'code', 'REFUND_FAILED',
        'payment', row_to_json(v_target_payment)
      );
    elsif p_refund_status = 'created' then
      return jsonb_build_object(
        'success', true,
        'action', 'refund_created_recorded',
        'code', 'REFUND_CREATED',
        'payment', row_to_json(v_target_payment)
      );
    end if;
  end if;

  -- 8. Authoritative Cumulative Amount Calculation From Ledger
  -- Sum all confirmed processed refunds for this payment from the immutable ledger
  select coalesce(sum(amount), 0)
  into v_ledger_processed_total
  from public.payment_refund_events
  where payment_id = v_target_payment.payment_id
    and status = 'processed';

  -- Over-refund detection & admin review flagging
  if v_ledger_processed_total > v_target_payment.amount then
    -- Detect financial inconsistency / over-refund anomaly
    if v_target_order.order_id is not null then
      -- M8: never downgrade a terminal state. 'refunded' stays 'refunded'; the anomaly is still
      -- recorded via fulfillment_status/admin_review_reason so it remains detectable.
      update public.orders
      set status = case
            when status in ('cancelled'::public.order_status, 'refunded'::public.order_status) then status
            else 'cancelled'::public.order_status
          end,
          cancelled_at = case
            when status in ('cancelled'::public.order_status, 'refunded'::public.order_status) then cancelled_at
            else coalesce(cancelled_at, now())
          end,
          fulfillment_status = 'requires_review',
          admin_review_reason = 'OVER_REFUND_DISCREPANCY: Cumulative processed refunds (' || v_ledger_processed_total::text || ') exceed original payment amount (' || v_target_payment.amount::text || ').',
          updated_at = now()
      where order_id = v_target_order.order_id;
    end if;

    -- M5: the ledger is left fully intact; the payment row must still reflect that refunds were
    -- processed so a retry cannot resurrect a captured-only view of a refunded payment.
    update public.payments
    set status = 'refunded'::public.payment_status,
        refund_amount = v_ledger_processed_total,
        refunded_at = coalesce(refunded_at, now()),
        failure_reason = 'FLAGGED_FOR_ADMIN_REVIEW: Cumulative processed refunds (' || v_ledger_processed_total::text || ') exceed original payment amount (' || v_target_payment.amount::text || ')',
        gateway_response = jsonb_set(
          coalesce(gateway_response, '{}'::jsonb),
          '{admin_review}',
          jsonb_build_object(
            'requires_admin_review', true,
            'reason', 'OVER_REFUND_DISCREPANCY',
            'ledger_processed_total', v_ledger_processed_total,
            'payment_amount', v_target_payment.amount,
            'excess_amount', (v_ledger_processed_total - v_target_payment.amount),
            'flagged_at', now()
          )
        ),
        updated_at = now()
    where payment_id = v_target_payment.payment_id;

    -- M5: over-refund means money left the account, so access follows the money while the
    -- discrepancy itself stays quarantined for administrator review.
    if v_target_order.order_id is not null then
      perform public.revoke_standard_order_entitlements(
        v_target_order.order_id,
        'Over-refund discrepancy flagged for administrator review'
      );
    end if;

    return jsonb_build_object(
      'success', false,
      'code', 'OVER_REFUND_DISCREPANCY',
      'error', 'Cumulative processed refunds (' || v_ledger_processed_total::text || ') exceed original payment amount (' || v_target_payment.amount::text || '). Payment flagged for administrator review.',
      'ledger_processed_total', v_ledger_processed_total,
      'payment_amount', v_target_payment.amount,
      'excess_amount', (v_ledger_processed_total - v_target_payment.amount),
      'requires_admin_review', true
    );
  end if;

  -- Monotonicity guard: cumulative total cannot decrease
  v_effective_amount := greatest(coalesce(v_target_payment.refund_amount, 0), v_ledger_processed_total);

  v_new_status := case
    when v_effective_amount >= v_target_payment.amount then 'refunded'::public.payment_status
    else 'partially_refunded'::public.payment_status
  end;

  -- 9. Update Payment Row Atomically Under Advisory & Order Lock
  update public.payments
  set status = v_new_status,
      paid_at = coalesce(v_target_payment.paid_at, coalesce(p_refunded_at, now())),
      refund_amount = v_effective_amount,
      refund_gateway_id = trim(p_refund_gateway_id),
      refunded_at = coalesce(p_refunded_at, now()),
      gateway_response = coalesce(p_gateway_response, gateway_response),
      updated_at = now()
  where payment_id = v_target_payment.payment_id
  returning * into v_updated_payment;

  -- 10. Update Internal Order Status & Revoke Entitlements:
  -- Full refund (v_new_status = 'refunded') cancels internal order to revoke access and block fulfillment.
  -- Partial refund (v_new_status = 'partially_refunded') preserves orders.status = 'confirmed' so ongoing
  -- access is not inappropriately revoked for minor price adjustments / partial fee waivers, while recording
  -- the refund event notes.
  if v_new_status = 'refunded'::public.payment_status then
    if v_target_order.order_id is not null and v_target_order.status not in ('cancelled'::public.order_status, 'refunded'::public.order_status) then
      update public.orders
      set status = 'cancelled'::public.order_status,
          cancelled_at = coalesce(cancelled_at, now()),
          updated_at = now()
      where order_id = v_target_order.order_id;
    end if;

    perform public.revoke_standard_order_entitlements(
      v_target_order.order_id,
      'Payment fully refunded (refund: ' || trim(p_refund_gateway_id) || ')'
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'action', 'refund_processed',
    'code', 'REFUND_PROCESSED',
    'payment', row_to_json(v_updated_payment)
  );
end;
$$;

comment on function public.reconcile_standard_refund is
  'Dedicated atomic refund reconciliation RPC for standard checkout orders. Synchronizes refund events under transaction-scoped advisory lock, enforces orders-before-payments lock hierarchy, records individual refund events in public.payment_refund_events, accumulates confirmed refund amounts monotonically from the ledger, validates authentic refund ID format (rfnd_...), and ensures idempotent duplicate delivery.';

-- ============================================================================
-- 7. RPC: Atomic Standard Recovery Refunds Synchronization
-- ============================================================================
create or replace function public.reconcile_standard_recovery_refunds(
  p_order_id            uuid,
  p_gateway_payment_id  text,
  p_gateway_order_id    text,
  p_refund_events       jsonb,
  p_gateway_response    jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_role                 text;
  v_target_order                record;
  v_target_payment              record;
  v_elem                        jsonb;
  v_ref_id                      text;
  v_ref_amount                  numeric;
  v_ref_status                  text;
  v_ref_created_at              bigint;
  v_seen_refund_ids             text[] := array[]::text[];
  v_existing_event              record;
  v_inserted_event              record;
  v_ledger_processed_total      numeric;
  v_effective_amount            numeric;
  v_new_status                  public.payment_status;
  v_processed_count             integer := 0;
begin
  -- 1. Security & Role Authorization Check (Strict Fail-Closed)
  -- H1: authorize with auth.role(), matching migrations 219/234. auth.role() reads the verified
  -- request.jwt.claims payload, whereas request.jwt.claim.role is a legacy per-claim GUC that is not
  -- populated by current PostgREST builds. Fail-closed semantics below are unchanged.
  v_caller_role := auth.role();
  if coalesce(v_caller_role, '') <> 'service_role' then
    return jsonb_build_object(
      'success', false,
      'code', 'UNAUTHORIZED',
      'error', 'Only service_role is authorized to execute recovery refund reconciliation.'
    );
  end if;

  -- 2. Validate Parameters
  if p_order_id is null or p_gateway_payment_id is null or trim(p_gateway_payment_id) = '' or
     p_gateway_order_id is null or trim(p_gateway_order_id) = '' or
     p_refund_events is null or jsonb_typeof(p_refund_events) <> 'array' then
    return jsonb_build_object(
      'success', false,
      'code', 'INVALID_PARAMETERS',
      'error', 'Missing or invalid order_id, gateway_payment_id, gateway_order_id, or refund_events array.'
    );
  end if;

  -- 3. Common Transaction-Scoped Advisory Lock
  perform pg_advisory_xact_lock(hashtext('rzp_order_claim:' || trim(p_gateway_order_id)));

  -- 4. Lock Order First (Orders-before-Payments lock hierarchy)
  select order_id, institute_id, student_id, status, notes
  into v_target_order
  from public.orders
  where order_id = p_order_id
  for update;

  if v_target_order.order_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'ORDER_NOT_FOUND',
      'error', 'Internal order not found: ' || p_order_id::text
    );
  end if;

  -- 5. Lock Payment Row FOR UPDATE
  select *
  into v_target_payment
  from public.payments
  where gateway = 'razorpay'::public.payment_gateway
    and gateway_payment_id = trim(p_gateway_payment_id)
    and order_id = p_order_id
  for update;

  if v_target_payment.payment_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'PAYMENT_NOT_FOUND',
      'error', 'Payment not found for order ' || p_order_id::text || ' and gateway payment ID ' || trim(p_gateway_payment_id)
    );
  end if;

  if v_target_payment.status = 'failed'::public.payment_status then
    return jsonb_build_object(
      'success', false,
      'code', 'PAYMENT_STATUS_INELIGIBLE',
      'error', 'Cannot reconcile refunds for a failed payment attempt.'
    );
  end if;

  -- 6. Process Each Refund Event in the Batch Under Lock
  for v_elem in select * from jsonb_array_elements(p_refund_events)
  loop
    v_ref_id := trim(coalesce(v_elem->>'id', ''));
    if v_ref_id = '' or v_ref_id not like 'rfnd_%' or length(v_ref_id) < 6 or v_ref_id like 'pay_%' then
      return jsonb_build_object(
        'success', false,
        'code', 'INVALID_REFUND_ID_FORMAT',
        'error', 'Invalid refund identifier format: ' || v_ref_id
      );
    end if;

    -- Validate duplicate refund ID within the batch itself
    if v_ref_id = any(v_seen_refund_ids) then
      return jsonb_build_object(
        'success', false,
        'code', 'DUPLICATE_REFUND_IN_BATCH',
        'error', 'Duplicate refund identifier within recovery batch: ' || v_ref_id
      );
    end if;
    v_seen_refund_ids := array_append(v_seen_refund_ids, v_ref_id);

    -- Validate currency if provided
    if v_elem->>'currency' is not null and upper(trim(v_elem->>'currency')) is distinct from v_target_payment.currency::text then
      return jsonb_build_object(
        'success', false,
        'code', 'REFUND_CURRENCY_MISMATCH',
        'error', 'Refund currency (' || upper(trim(v_elem->>'currency')) || ') does not match payment currency (' || v_target_payment.currency::text || ') for refund: ' || v_ref_id
      );
    end if;

    -- Validate external identifiers if provided in element
    if v_elem->>'gateway_payment_id' is not null and nullif(trim(v_elem->>'gateway_payment_id'), '') is distinct from trim(p_gateway_payment_id) then
      return jsonb_build_object(
        'success', false,
        'code', 'REFUND_ID_ASSOCIATION_CONFLICT',
        'error', 'Refund element gateway_payment_id mismatch for refund: ' || v_ref_id
      );
    end if;
    if v_elem->>'gateway_order_id' is not null and nullif(trim(v_elem->>'gateway_order_id'), '') is distinct from trim(p_gateway_order_id) then
      return jsonb_build_object(
        'success', false,
        'code', 'REFUND_ID_ASSOCIATION_CONFLICT',
        'error', 'Refund element gateway_order_id mismatch for refund: ' || v_ref_id
      );
    end if;

    if (v_elem->>'amount_inr') is not null then
      v_ref_amount := (v_elem->>'amount_inr')::numeric;
    elsif (v_elem->>'amount') is not null then
      v_ref_amount := (v_elem->>'amount')::numeric / 100.0;
    else
      v_ref_amount := 0;
    end if;

    if v_ref_amount <= 0 then
      return jsonb_build_object(
        'success', false,
        'code', 'INVALID_REFUND_AMOUNT',
        'error', 'Refund amount must be greater than zero for refund: ' || v_ref_id
      );
    end if;

    v_ref_status := lower(trim(coalesce(v_elem->>'status', 'processed')));
    if v_ref_status not in ('created', 'processed', 'failed') then
      v_ref_status := 'processed';
    end if;

    v_ref_created_at := (v_elem->>'created_at')::bigint;

    -- Inspect / Lock Existing Ledger Event
    select *
    into v_existing_event
    from public.payment_refund_events
    where gateway_refund_id = v_ref_id
    for update;

    if v_existing_event.refund_event_id is not null then
      -- 4-Way Association Verification
      if v_existing_event.payment_id is distinct from v_target_payment.payment_id or
         v_existing_event.order_id is distinct from v_target_payment.order_id then
        return jsonb_build_object(
          'success', false,
          'code', 'REFUND_ID_ASSOCIATION_CONFLICT',
          'error', 'Refund gateway ID ' || v_ref_id || ' is already associated with another payment or order.',
          'existing_event_id', v_existing_event.refund_event_id,
          'existing_payment_id', v_existing_event.payment_id,
          'existing_order_id', v_existing_event.order_id,
          'target_payment_id', v_target_payment.payment_id,
          'target_order_id', v_target_payment.order_id
        );
      end if;

      if v_existing_event.gateway_payment_id is null then
        update public.payment_refund_events
        set gateway_payment_id = trim(p_gateway_payment_id)
        where refund_event_id = v_existing_event.refund_event_id;
        v_existing_event.gateway_payment_id := trim(p_gateway_payment_id);
      elsif v_existing_event.gateway_payment_id is distinct from trim(p_gateway_payment_id) then
        return jsonb_build_object(
          'success', false,
          'code', 'REFUND_ID_ASSOCIATION_CONFLICT',
          'error', 'Refund gateway ID ' || v_ref_id || ' is associated with a different gateway payment ID.',
          'existing_gateway_payment_id', v_existing_event.gateway_payment_id,
          'target_gateway_payment_id', trim(p_gateway_payment_id)
        );
      end if;

      if v_existing_event.gateway_order_id is null then
        if p_gateway_order_id is not null and trim(p_gateway_order_id) <> '' then
          update public.payment_refund_events
          set gateway_order_id = trim(p_gateway_order_id)
          where refund_event_id = v_existing_event.refund_event_id;
          v_existing_event.gateway_order_id := trim(p_gateway_order_id);
        else
          return jsonb_build_object(
            'success', false,
            'code', 'REFUND_INCOMPLETE_ASSOCIATION',
            'error', 'Refund event has no associated gateway order ID and recovery provides no gateway order ID.'
          );
        end if;
      elsif v_existing_event.gateway_order_id is distinct from trim(p_gateway_order_id) then
        return jsonb_build_object(
          'success', false,
          'code', 'REFUND_ID_ASSOCIATION_CONFLICT',
          'error', 'Refund gateway ID ' || v_ref_id || ' is associated with a different gateway order ID.',
          'existing_gateway_order_id', v_existing_event.gateway_order_id,
          'target_gateway_order_id', trim(p_gateway_order_id)
        );
      end if;

      -- Lifecycle Transition:
      if v_existing_event.status = 'created' and v_ref_status = 'processed' then
        update public.payment_refund_events
        set status = 'processed',
            amount = v_ref_amount,
            processed_at = coalesce(case when v_ref_created_at is not null then to_timestamp(v_ref_created_at) else null end, now()),
            gateway_response = coalesce(p_gateway_response, gateway_response)
        where refund_event_id = v_existing_event.refund_event_id;
        v_processed_count := v_processed_count + 1;
      elsif v_existing_event.status = 'created' and v_ref_status = 'failed' then
        update public.payment_refund_events
        set status = 'failed',
            gateway_response = coalesce(p_gateway_response, gateway_response)
        where refund_event_id = v_existing_event.refund_event_id;
      end if;

    else
      -- Insert New Event Into Ledger
      insert into public.payment_refund_events (
        payment_id,
        order_id,
        gateway,
        gateway_refund_id,
        gateway_payment_id,
        gateway_order_id,
        amount,
        currency,
        status,
        gateway_response,
        processed_at
      ) values (
        v_target_payment.payment_id,
        p_order_id,
        'razorpay'::public.payment_gateway,
        v_ref_id,
        trim(p_gateway_payment_id),
        trim(p_gateway_order_id),
        v_ref_amount,
        v_target_payment.currency,
        v_ref_status,
        p_gateway_response,
        case when v_ref_status = 'processed' then coalesce(case when v_ref_created_at is not null then to_timestamp(v_ref_created_at) else null end, now()) else null end
      )
      on conflict (gateway_refund_id) do nothing
      returning * into v_inserted_event;

      if v_inserted_event.refund_event_id is null then
        select * into v_existing_event
        from public.payment_refund_events
        where gateway_refund_id = v_ref_id
        for update;

        if v_existing_event.refund_event_id is not null then
          if v_existing_event.payment_id is distinct from v_target_payment.payment_id or
             v_existing_event.order_id is distinct from v_target_payment.order_id then
            return jsonb_build_object(
              'success', false,
              'code', 'REFUND_ID_ASSOCIATION_CONFLICT',
              'error', 'Concurrent refund insertion detected: association mismatch for refund ' || v_ref_id
            );
          end if;
        end if;
      else
        if v_ref_status = 'processed' then
          v_processed_count := v_processed_count + 1;
        end if;
      end if;
    end if;
  end loop;

  -- 7. Authoritative Cumulative Amount Calculation From Immutable Ledger
  select coalesce(sum(amount), 0)
  into v_ledger_processed_total
  from public.payment_refund_events
  where payment_id = v_target_payment.payment_id
    and status = 'processed';

  -- Over-refund detection & admin review flagging
  if v_ledger_processed_total > v_target_payment.amount then
    if v_target_order.order_id is not null then
      -- M8: never downgrade a terminal state. 'refunded' stays 'refunded'; the anomaly is still
      -- recorded via fulfillment_status/admin_review_reason so it remains detectable.
      update public.orders
      set status = case
            when status in ('cancelled'::public.order_status, 'refunded'::public.order_status) then status
            else 'cancelled'::public.order_status
          end,
          cancelled_at = case
            when status in ('cancelled'::public.order_status, 'refunded'::public.order_status) then cancelled_at
            else coalesce(cancelled_at, now())
          end,
          fulfillment_status = 'requires_review',
          admin_review_reason = 'OVER_REFUND_DISCREPANCY: Cumulative processed refunds (' || v_ledger_processed_total::text || ') exceed original payment amount (' || v_target_payment.amount::text || ').',
          updated_at = now()
      where order_id = v_target_order.order_id;
    end if;

    -- M5: the ledger is left fully intact; the payment row must still reflect that refunds were
    -- processed so a retry cannot resurrect a captured-only view of a refunded payment.
    update public.payments
    set status = 'refunded'::public.payment_status,
        refund_amount = v_ledger_processed_total,
        refunded_at = coalesce(refunded_at, now()),
        failure_reason = 'FLAGGED_FOR_ADMIN_REVIEW: Cumulative processed refunds (' || v_ledger_processed_total::text || ') exceed original payment amount (' || v_target_payment.amount::text || ')',
        gateway_response = jsonb_set(
          coalesce(gateway_response, '{}'::jsonb),
          '{admin_review}',
          jsonb_build_object(
            'requires_admin_review', true,
            'reason', 'OVER_REFUND_DISCREPANCY',
            'ledger_processed_total', v_ledger_processed_total,
            'payment_amount', v_target_payment.amount,
            'excess_amount', (v_ledger_processed_total - v_target_payment.amount),
            'flagged_at', now()
          )
        ),
        updated_at = now()
    where payment_id = v_target_payment.payment_id;

    -- M5: over-refund means money left the account, so access follows the money while the
    -- discrepancy itself stays quarantined for administrator review.
    if v_target_order.order_id is not null then
      perform public.revoke_standard_order_entitlements(
        v_target_order.order_id,
        'Over-refund discrepancy flagged for administrator review'
      );
    end if;

    return jsonb_build_object(
      'success', false,
      'code', 'OVER_REFUND_DISCREPANCY',
      'error', 'Cumulative processed refunds (' || v_ledger_processed_total::text || ') exceed original payment amount (' || v_target_payment.amount::text || '). Payment flagged for administrator review.',
      'ledger_processed_total', v_ledger_processed_total,
      'payment_amount', v_target_payment.amount,
      'excess_amount', (v_ledger_processed_total - v_target_payment.amount),
      'requires_admin_review', true
    );
  end if;

  -- Monotonicity guard: cumulative total cannot decrease
  v_effective_amount := greatest(coalesce(v_target_payment.refund_amount, 0), v_ledger_processed_total);

  v_new_status := case
    when v_effective_amount >= v_target_payment.amount then 'refunded'::public.payment_status
    when v_effective_amount > 0 then 'partially_refunded'::public.payment_status
    else v_target_payment.status
  end;

  -- 8. Update Payment Row Atomically
  update public.payments
  set status = v_new_status,
      refund_amount = v_effective_amount,
      refunded_at = coalesce(refunded_at, now()),
      gateway_response = coalesce(p_gateway_response, gateway_response),
      updated_at = now()
  where payment_id = v_target_payment.payment_id;

  -- 9. Update Internal Order Status & Revoke Entitlements
  if v_new_status = 'refunded'::public.payment_status then
    if v_target_order.order_id is not null and v_target_order.status not in ('cancelled'::public.order_status, 'refunded'::public.order_status) then
      update public.orders
      set status = 'cancelled'::public.order_status,
          cancelled_at = coalesce(cancelled_at, now()),
          updated_at = now()
      where order_id = v_target_order.order_id;
    end if;

    perform public.revoke_standard_order_entitlements(
      v_target_order.order_id,
      'Payment fully refunded upon recovery (payment: ' || trim(p_gateway_payment_id) || ')'
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'action', 'recovery_refunds_reconciled',
    'code', 'RECOVERY_REFUNDS_RECONCILED',
    'processed_count', v_processed_count,
    'ledger_processed_total', v_ledger_processed_total,
    'payment_status', v_new_status,
    'effective_refund_amount', v_effective_amount
  );
end;
$$;

comment on function public.reconcile_standard_recovery_refunds is
  'Dedicated atomic RPC for registering individual refund events retrieved during paid order recovery. Operates under common transaction-scoped advisory lock and orders-before-payments lock hierarchy, validates four-way associations, accumulates confirmed refund amounts monotonically from the ledger, flags over-refund anomalies for administrator review, revokes access on full refunds, and preserves student access on partial refunds.';

-- ============================================================================
-- 8. RPC: Atomic Transactional Course Order Fulfillment
-- ============================================================================
create or replace function public.fulfill_standard_course_order(
  p_order_id            uuid,
  p_course_id           uuid,
  p_profile_id          uuid,
  p_conversion          boolean default false,
  p_guardian_name       text default null,
  p_guardian_mobile     text default null,
  p_guardian_email      text default null,
  p_target_year         text default null,
  p_dob                 date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_role                 text;
  v_gateway_order_id            text;
  v_order                       record;
  v_payment                     record;
  v_profile_role                public.user_role;
  v_student                     record;
  v_student_res                 json;
  v_student_id                  uuid;
  v_enrollment_no               text;
  v_order_item_id               uuid;
  v_existing_enrollment         record;
  v_enrollment_id               uuid;
  v_converted_sub               record;
  v_conv_cancelled_at           timestamptz;
  v_post_state_fingerprint      text;
begin
  -- 1. Security & Role Authorization Check (Strict Fail-Closed)
  -- H1: authorize with auth.role(), matching migrations 219/234. auth.role() reads the verified
  -- request.jwt.claims payload, whereas request.jwt.claim.role is a legacy per-claim GUC that is not
  -- populated by current PostgREST builds. Fail-closed semantics below are unchanged.
  v_caller_role := auth.role();
  if coalesce(v_caller_role, '') <> 'service_role' then
    return jsonb_build_object(
      'success', false,
      'code', 'UNAUTHORIZED',
      'error', 'Only service_role is authorized to execute course fulfillment.'
    );
  end if;

  -- 2. Validate Parameters
  if p_order_id is null or p_course_id is null or p_profile_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'INVALID_PARAMETERS',
      'error', 'Missing required order_id, course_id, or profile_id.'
    );
  end if;

  -- 3. Resolve Razorpay Order ID for Lock Key
  select nullif(trim(coalesce(nullif(notes, '')::jsonb ->> 'razorpayOrderId', '')), '')
  into v_gateway_order_id
  from public.orders
  where order_id = p_order_id;

  if v_gateway_order_id is not null then
    perform pg_advisory_xact_lock(hashtext('rzp_order_claim:' || trim(v_gateway_order_id)));
  end if;

  -- 4. Lock & Verify Order (Orders-before-Payments lock hierarchy)
  select order_id, institute_id, student_id, status, fulfillment_status, notes
  into v_order
  from public.orders
  where order_id = p_order_id
  for update;

  if v_order.order_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'ORDER_NOT_FOUND',
      'error', 'Order not found: ' || p_order_id::text
    );
  end if;

  -- M1: the advisory lock is only ever acquired BEFORE this order row lock. Acquiring it here
  -- inverted the global order and could deadlock against reconcile_standard_refund /
  -- reconcile_standard_paid_order, which take advisory -> order -> payment. The order row lock is
  -- the authoritative serialisation point: every refund path must take the same row lock, so this
  -- order cannot be mutated concurrently while this transaction holds it.
  if v_gateway_order_id is null then
    v_gateway_order_id := nullif(trim(coalesce(nullif(v_order.notes, '')::jsonb ->> 'razorpayOrderId', '')), '');
  end if;

  -- Fulfilment Invariant Guards: Order status check
  if v_order.status in ('cancelled'::public.order_status, 'refunded'::public.order_status) then
    return jsonb_build_object(
      'success', false,
      'code', 'ORDER_CANCELLED_OR_REFUNDED',
      'error', 'Order ' || p_order_id::text || ' is ' || v_order.status::text || '. Course fulfillment aborted.'
    );
  end if;

  if v_order.fulfillment_status = 'requires_review' then
    return jsonb_build_object(
      'success', false,
      'code', 'ORDER_REQUIRES_ADMIN_REVIEW',
      'error', 'Order ' || p_order_id::text || ' requires administrative review. Course fulfillment aborted.'
    );
  end if;

  -- Fulfilment Idempotency Guard: If order is already fulfilled, return existing fulfillment safely without repeating mutations
  if v_order.fulfillment_status = 'fulfilled' then
    v_student_id := v_order.student_id;
    if v_student_id is null then
      select student_id, enrollment_no into v_student
      from public.student_details
      where profile_id = p_profile_id;
      v_student_id := v_student.student_id;
      v_enrollment_no := v_student.enrollment_no;
    else
      select enrollment_no into v_enrollment_no
      from public.student_details
      where student_id = v_student_id;
    end if;

    select enrollment_id into v_enrollment_id
    from public.course_enrollments
    where course_id = p_course_id
      and student_id = v_student_id
    limit 1;

    return jsonb_build_object(
      'success', true,
      'action', 'already_fulfilled',
      'code', 'ORDER_ALREADY_FULFILLED',
      'student_id', v_student_id,
      'enrollment_id', v_enrollment_id,
      'enrollment_number', v_enrollment_no,
      'course_id', p_course_id,
      'institute_id', v_order.institute_id
    );
  end if;

  -- 5. Lock & Verify Settled Payment Attempt
  select payment_id, status, gateway_payment_id, gateway_order_id
  into v_payment
  from public.payments
  where order_id = p_order_id
    and gateway = 'razorpay'::public.payment_gateway
    and status in (
      'captured'::public.payment_status,
      'refunded'::public.payment_status,
      'partially_refunded'::public.payment_status
    )
  order by created_at desc
  limit 1
  for update;

  if v_payment.payment_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'PAYMENT_NOT_SETTLED',
      'error', 'No settled payment attempt found for order: ' || p_order_id::text
    );
  end if;

  if v_payment.status = 'refunded'::public.payment_status then
    return jsonb_build_object(
      'success', false,
      'code', 'ORDER_CANCELLED_OR_REFUNDED',
      'error', 'Payment has already been refunded. Course fulfillment aborted.'
    );
  end if;

  -- 6. Upgrade Profile Role from user to student
  select role into v_profile_role
  from public.profiles
  where profile_id = p_profile_id
  for update;

  if v_profile_role is null then
    return jsonb_build_object(
      'success', false,
      'code', 'PROFILE_NOT_FOUND',
      'error', 'Profile not found: ' || p_profile_id::text
    );
  end if;

  if v_profile_role = 'user'::public.user_role then
    update public.profiles
    set role = 'student'::public.user_role
    where profile_id = p_profile_id;
  elsif v_profile_role not in ('student'::public.user_role) then
    return jsonb_build_object(
      'success', false,
      'code', 'INVALID_ROLE',
      'error', 'Profile role ' || v_profile_role::text || ' cannot be converted to student.'
    );
  end if;

  -- 7. Ensure Student Record Exists (Atomically within transaction)
  select student_id, enrollment_no
  into v_student
  from public.student_details
  where profile_id = p_profile_id;

  if v_student.student_id is not null then
    v_student_id := v_student.student_id;
    v_enrollment_no := v_student.enrollment_no;
  else
    v_student_res := public.create_student_after_purchase(
      p_profile_id,
      p_guardian_name,
      p_guardian_mobile,
      p_guardian_email,
      p_target_year,
      p_dob
    );

    if (v_student_res->>'error') is not null then
      select student_id, enrollment_no
      into v_student
      from public.student_details
      where profile_id = p_profile_id;

      if v_student.student_id is not null then
        v_student_id := v_student.student_id;
        v_enrollment_no := v_student.enrollment_no;
      else
        return jsonb_build_object(
          'success', false,
          'code', 'STUDENT_CREATION_FAILED',
          'error', v_student_res->>'error'
        );
      end if;
    else
      v_student_id := (v_student_res->>'student_id')::uuid;
      v_enrollment_no := v_student_res->>'enrollment_no';
    end if;
  end if;

  -- 8. Find matching order_items
  select item_id
  into v_order_item_id
  from public.order_items
  where order_id = p_order_id
    and (course_id = p_course_id or course_id is null)
  limit 1;

  -- 9. Upsert Course Enrollment Row Atomically
  select enrollment_id, is_active, order_item_id, enrollment_type
  into v_existing_enrollment
  from public.course_enrollments
  where course_id = p_course_id
    and student_id = v_student_id
  for update;

  if v_existing_enrollment.enrollment_id is not null then
    update public.course_enrollments
    set is_active = true,
        revoked_at = null,
        revoked_reason = null,
        revoked_by = null,
        -- C3/M2: never overwrite a durable non-purchase access source with 'purchase'. This shared
        -- (student, course) row is the only place admin_grant / free / subscription provenance
        -- survives, and a later purchase refund must be able to detect it.
        enrollment_type = case
          when v_existing_enrollment.is_active is true
               and v_existing_enrollment.enrollment_type in ('admin_grant', 'free', 'subscription')
            then v_existing_enrollment.enrollment_type
          else 'purchase'
        end,
        order_item_id = case
          when v_existing_enrollment.is_active is true and v_existing_enrollment.order_item_id is not null then v_existing_enrollment.order_item_id
          else coalesce(v_order_item_id, order_item_id)
        end,
        updated_at = now()
    where enrollment_id = v_existing_enrollment.enrollment_id
    returning enrollment_id into v_enrollment_id;
  else
    insert into public.course_enrollments (
      course_id,
      student_id,
      institute_id,
      order_item_id,
      enrollment_type,
      is_active
    ) values (
      p_course_id,
      v_student_id,
      v_order.institute_id,
      v_order_item_id,
      'purchase',
      true
    )
    returning enrollment_id into v_enrollment_id;
  end if;

  -- Record entitlement grant provenance:
  --   - created: newly created or reactivated course enrollment
  --   - already_active: duplicate checkout encountering an existing active enrollment
  insert into public.order_entitlement_grants (
    order_id,
    order_item_id,
    student_id,
    institute_id,
    entitlement_type,
    entitlement_id,
    grant_type,
    prior_state
  ) values (
    p_order_id,
    v_order_item_id,
    v_student_id,
    v_order.institute_id,
    'course',
    v_enrollment_id,
    case when v_existing_enrollment.enrollment_id is not null and v_existing_enrollment.is_active is true then 'already_active' else 'created' end,
    case when v_existing_enrollment.enrollment_id is not null then jsonb_build_object(
      'prior_order_item_id', v_existing_enrollment.order_item_id,
      'prior_is_active', v_existing_enrollment.is_active,
      'prior_enrollment_type', v_existing_enrollment.enrollment_type
    ) else null end
  );

  -- 10. Handle Full Course Conversion (Cancel Active/Grace Subscription & Record Conversion Provenance)
  if p_conversion is true then
    select *
    into v_converted_sub
    from public.student_subscriptions
    where student_id = v_student_id
      and (course_id = p_course_id or plan_id in (select plan_id from public.subscription_plans where course_id = p_course_id))
      and status in ('active'::public.subscription_status_type, 'grace'::public.subscription_status_type)
    for update;

    if v_converted_sub.subscription_id is not null then
      -- M3: cancel first with a deterministic timestamp, then fingerprint the exact post-conversion
      -- state. A refund may only restore prior_state when this fingerprint still matches, which is
      -- what detects date-only (or status-only) administrator edits made after the conversion.
      v_conv_cancelled_at := coalesce(v_converted_sub.cancelled_at, now());

      update public.student_subscriptions
      set status = 'cancelled'::public.subscription_status_type,
          conversion_order_id = p_order_id,
          cancelled_at = v_conv_cancelled_at,
          updated_at = now()
      where subscription_id = v_converted_sub.subscription_id;

      v_post_state_fingerprint := md5(concat_ws('|',
        'cancelled',
        coalesce(v_converted_sub.start_date::text, ''),
        coalesce(v_converted_sub.end_date::text, ''),
        coalesce(v_converted_sub.grace_end_date::text, ''),
        coalesce(v_converted_sub.content_access_end_date::text, ''),
        coalesce(v_converted_sub.order_id::text, ''),
        p_order_id::text,
        coalesce(extract(epoch from v_conv_cancelled_at)::text, '')
      ));

      insert into public.order_entitlement_grants (
        order_id,
        order_item_id,
        student_id,
        institute_id,
        entitlement_type,
        entitlement_id,
        grant_type,
        prior_state
      ) values (
        p_order_id,
        v_order_item_id,
        v_student_id,
        v_order.institute_id,
        'subscription',
        v_converted_sub.subscription_id,
        'converted',
        jsonb_build_object(
          'subscription_id', v_converted_sub.subscription_id,
          'prior_order_id', v_converted_sub.order_id,
          'prior_status', v_converted_sub.status,
          'start_date', v_converted_sub.start_date,
          'end_date', v_converted_sub.end_date,
          'grace_end_date', v_converted_sub.grace_end_date,
          'content_access_end_date', v_converted_sub.content_access_end_date,
          'cancelled_at', v_conv_cancelled_at,
          'converted_by_course_id', p_course_id,
          'converted_at', now(),
          'post_conversion_fingerprint', v_post_state_fingerprint
        )
      );
    end if;
  end if;

  -- 11. Atomically Update Order Fulfillment Status & Student Link
  update public.orders
  set student_id = coalesce(student_id, v_student_id),
      fulfillment_status = 'fulfilled',
      updated_at = now()
  where order_id = p_order_id;

  return jsonb_build_object(
    'success', true,
    'action', 'course_fulfilled',
    'code', 'COURSE_FULFILLED',
    'student_id', v_student_id,
    'enrollment_id', v_enrollment_id,
    'enrollment_number', v_enrollment_no,
    'course_id', p_course_id,
    'institute_id', v_order.institute_id
  );
end;
$$;

comment on function public.fulfill_standard_course_order is
  'Transactional atomic RPC for standard course order fulfillment. Synchronizes under shared advisory lock and orders-before-payments lock hierarchy, verifies payment capture, validates order eligibility, upgrades profile role to student, creates student details, inserts course enrollment, cancels subscription on conversion, and marks order fulfilled in a single atomic transaction.';

-- ============================================================================
-- 9. RPC: Atomic Transactional PYQ Order Fulfillment
-- ============================================================================
create or replace function public.fulfill_standard_pyq_order(
  p_order_id            uuid,
  p_package_id          uuid,
  p_profile_id          uuid,
  p_guardian_name       text default null,
  p_guardian_mobile     text default null,
  p_guardian_email      text default null,
  p_target_year         text default null,
  p_dob                 date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_role                 text;
  v_gateway_order_id            text;
  v_order                       record;
  v_payment                     record;
  v_profile_role                public.user_role;
  v_student                     record;
  v_student_res                 json;
  v_student_id                  uuid;
  v_enrollment_no               text;
  v_order_item_id               uuid;
  v_existing_pyq                record;
  v_purchase_id                 uuid;
begin
  -- 1. Security & Role Authorization Check (Strict Fail-Closed)
  -- H1: authorize with auth.role(), matching migrations 219/234. auth.role() reads the verified
  -- request.jwt.claims payload, whereas request.jwt.claim.role is a legacy per-claim GUC that is not
  -- populated by current PostgREST builds. Fail-closed semantics below are unchanged.
  v_caller_role := auth.role();
  if coalesce(v_caller_role, '') <> 'service_role' then
    return jsonb_build_object(
      'success', false,
      'code', 'UNAUTHORIZED',
      'error', 'Only service_role is authorized to execute PYQ fulfillment.'
    );
  end if;

  -- 2. Validate Parameters
  if p_order_id is null or p_package_id is null or p_profile_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'INVALID_PARAMETERS',
      'error', 'Missing required order_id, package_id, or profile_id.'
    );
  end if;

  -- 3. Resolve Razorpay Order ID for Lock Key
  select nullif(trim(coalesce(nullif(notes, '')::jsonb ->> 'razorpayOrderId', '')), '')
  into v_gateway_order_id
  from public.orders
  where order_id = p_order_id;

  if v_gateway_order_id is not null then
    perform pg_advisory_xact_lock(hashtext('rzp_order_claim:' || trim(v_gateway_order_id)));
  end if;

  -- 4. Lock & Verify Order
  select order_id, institute_id, student_id, status, fulfillment_status, notes
  into v_order
  from public.orders
  where order_id = p_order_id
  for update;

  if v_order.order_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'ORDER_NOT_FOUND',
      'error', 'Order not found: ' || p_order_id::text
    );
  end if;

  -- M1: the advisory lock is only ever acquired BEFORE this order row lock. Acquiring it here
  -- inverted the global order and could deadlock against reconcile_standard_refund /
  -- reconcile_standard_paid_order, which take advisory -> order -> payment. The order row lock is
  -- the authoritative serialisation point: every refund path must take the same row lock, so this
  -- order cannot be mutated concurrently while this transaction holds it.
  if v_gateway_order_id is null then
    v_gateway_order_id := nullif(trim(coalesce(nullif(v_order.notes, '')::jsonb ->> 'razorpayOrderId', '')), '');
  end if;

  if v_order.status in ('cancelled'::public.order_status, 'refunded'::public.order_status) then
    return jsonb_build_object(
      'success', false,
      'code', 'ORDER_CANCELLED_OR_REFUNDED',
      'error', 'Order ' || p_order_id::text || ' is ' || v_order.status::text || '. PYQ fulfillment aborted.'
    );
  end if;

  if v_order.fulfillment_status = 'requires_review' then
    return jsonb_build_object(
      'success', false,
      'code', 'ORDER_REQUIRES_ADMIN_REVIEW',
      'error', 'Order ' || p_order_id::text || ' requires administrative review. PYQ fulfillment aborted.'
    );
  end if;

  -- Fulfilment Idempotency Guard: If order is already fulfilled, return existing fulfillment safely without repeating mutations
  if v_order.fulfillment_status = 'fulfilled' then
    v_student_id := v_order.student_id;
    if v_student_id is null then
      select student_id, enrollment_no into v_student
      from public.student_details
      where profile_id = p_profile_id;
      v_student_id := v_student.student_id;
      v_enrollment_no := v_student.enrollment_no;
    else
      select enrollment_no into v_enrollment_no
      from public.student_details
      where student_id = v_student_id;
    end if;

    select purchase_id into v_purchase_id
    from public.student_pyq_purchases
    where package_id = p_package_id
      and student_id = v_student_id
    limit 1;

    return jsonb_build_object(
      'success', true,
      'action', 'already_fulfilled',
      'code', 'ORDER_ALREADY_FULFILLED',
      'student_id', v_student_id,
      'purchase_id', v_purchase_id,
      'enrollment_number', v_enrollment_no,
      'package_id', p_package_id,
      'institute_id', v_order.institute_id
    );
  end if;

  -- 5. Lock & Verify Settled Payment Attempt
  select payment_id, status, gateway_payment_id, gateway_order_id
  into v_payment
  from public.payments
  where order_id = p_order_id
    and gateway = 'razorpay'::public.payment_gateway
    and status in (
      'captured'::public.payment_status,
      'refunded'::public.payment_status,
      'partially_refunded'::public.payment_status
    )
  order by created_at desc
  limit 1
  for update;

  if v_payment.payment_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'PAYMENT_NOT_SETTLED',
      'error', 'No settled payment attempt found for order: ' || p_order_id::text
    );
  end if;

  if v_payment.status = 'refunded'::public.payment_status then
    return jsonb_build_object(
      'success', false,
      'code', 'ORDER_CANCELLED_OR_REFUNDED',
      'error', 'Payment has already been refunded. PYQ fulfillment aborted.'
    );
  end if;

  -- 6. Upgrade Profile Role from user to student
  select role into v_profile_role
  from public.profiles
  where profile_id = p_profile_id
  for update;

  if v_profile_role is null then
    return jsonb_build_object(
      'success', false,
      'code', 'PROFILE_NOT_FOUND',
      'error', 'Profile not found: ' || p_profile_id::text
    );
  end if;

  if v_profile_role = 'user'::public.user_role then
    update public.profiles
    set role = 'student'::public.user_role
    where profile_id = p_profile_id;
  elsif v_profile_role not in ('student'::public.user_role) then
    return jsonb_build_object(
      'success', false,
      'code', 'INVALID_ROLE',
      'error', 'Profile role ' || v_profile_role::text || ' cannot be converted to student.'
    );
  end if;

  -- 7. Ensure Student Record Exists
  select student_id, enrollment_no
  into v_student
  from public.student_details
  where profile_id = p_profile_id;

  if v_student.student_id is not null then
    v_student_id := v_student.student_id;
    v_enrollment_no := v_student.enrollment_no;
  else
    v_student_res := public.create_student_after_purchase(
      p_profile_id,
      p_guardian_name,
      p_guardian_mobile,
      p_guardian_email,
      p_target_year,
      p_dob
    );

    if (v_student_res->>'error') is not null then
      select student_id, enrollment_no
      into v_student
      from public.student_details
      where profile_id = p_profile_id;

      if v_student.student_id is not null then
        v_student_id := v_student.student_id;
        v_enrollment_no := v_student.enrollment_no;
      else
        return jsonb_build_object(
          'success', false,
          'code', 'STUDENT_CREATION_FAILED',
          'error', v_student_res->>'error'
        );
      end if;
    else
      v_student_id := (v_student_res->>'student_id')::uuid;
      v_enrollment_no := v_student_res->>'enrollment_no';
    end if;
  end if;

  -- 8. Find matching order_items
  select item_id
  into v_order_item_id
  from public.order_items
  where order_id = p_order_id
    and (package_id = p_package_id or package_id is null)
  limit 1;

  -- 9. Upsert PYQ Purchase Row Atomically
  select purchase_id, is_active, order_item_id
  into v_existing_pyq
  from public.student_pyq_purchases
  where package_id = p_package_id
    and student_id = v_student_id
  for update;

  if v_existing_pyq.purchase_id is not null then
    update public.student_pyq_purchases
    set is_active = true,
        revoked_at = null,
        revoked_reason = null,
        order_item_id = case
          when v_existing_pyq.is_active is true and v_existing_pyq.order_item_id is not null then v_existing_pyq.order_item_id
          else coalesce(v_order_item_id, order_item_id)
        end,
        updated_at = now()
    where purchase_id = v_existing_pyq.purchase_id
    returning purchase_id into v_purchase_id;
  else
    insert into public.student_pyq_purchases (
      package_id,
      student_id,
      institute_id,
      order_item_id,
      access_type,
      is_active
    ) values (
      p_package_id,
      v_student_id,
      v_order.institute_id,
      v_order_item_id,
      'purchase',
      true
    )
    returning purchase_id into v_purchase_id;
  end if;

  -- Record entitlement grant provenance:
  --   - created: newly created or reactivated PYQ purchase
  --   - already_active: duplicate checkout encountering an existing active PYQ purchase
  insert into public.order_entitlement_grants (
    order_id,
    order_item_id,
    student_id,
    institute_id,
    entitlement_type,
    entitlement_id,
    grant_type,
    prior_state
  ) values (
    p_order_id,
    v_order_item_id,
    v_student_id,
    v_order.institute_id,
    'pyq',
    v_purchase_id,
    case when v_existing_pyq.purchase_id is not null and v_existing_pyq.is_active is true then 'already_active' else 'created' end,
    case when v_existing_pyq.purchase_id is not null then jsonb_build_object(
      'prior_order_item_id', v_existing_pyq.order_item_id,
      'prior_is_active', v_existing_pyq.is_active
    ) else null end
  );

  -- 10. Update Order
  update public.orders
  set student_id = coalesce(student_id, v_student_id),
      fulfillment_status = 'fulfilled',
      updated_at = now()
  where order_id = p_order_id;

  return jsonb_build_object(
    'success', true,
    'action', 'pyq_fulfilled',
    'code', 'PYQ_FULFILLED',
    'student_id', v_student_id,
    'purchase_id', v_purchase_id,
    'enrollment_number', v_enrollment_no,
    'package_id', p_package_id,
    'institute_id', v_order.institute_id
  );
end;
$$;

comment on function public.fulfill_standard_pyq_order is
  'Transactional atomic RPC for standard PYQ package order fulfillment. Synchronizes under shared advisory lock and orders-before-payments lock hierarchy, verifies payment capture, upgrades profile role, inserts or reactivates PYQ purchase entitlement, and marks order fulfilled in a single atomic transaction.';

-- ============================================================================
-- 10. RPC: Atomic Transactional Subscription Order Fulfillment
-- ============================================================================
create or replace function public.fulfill_standard_subscription_order(
  p_order_id            uuid,
  p_plan_id             uuid,
  p_profile_id          uuid,
  p_guardian_name       text default null,
  p_guardian_mobile     text default null,
  p_guardian_email      text default null,
  p_target_year         text default null,
  p_dob                 date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_role                 text;
  v_gateway_order_id            text;
  v_order                       record;
  v_payment                     record;
  v_profile_role                public.user_role;
  v_student                     record;
  v_student_res                 json;
  v_student_id                  uuid;
  v_enrollment_no               text;
  v_course_id                   uuid;
  v_order_item_id               uuid;
  v_plan                        record;
  v_grace_days                  integer;
  v_content_access_days         integer;
  v_existing_sub                record;
  v_start_date                  date;
  v_end_date                    date;
  v_grace_end_date              date;
  v_content_access_end_date     date;
  v_subscription_id             uuid;
  v_enrollment_id               uuid;
begin
  -- 1. Security & Role Authorization Check (Strict Fail-Closed)
  -- H1: authorize with auth.role(), matching migrations 219/234. auth.role() reads the verified
  -- request.jwt.claims payload, whereas request.jwt.claim.role is a legacy per-claim GUC that is not
  -- populated by current PostgREST builds. Fail-closed semantics below are unchanged.
  v_caller_role := auth.role();
  if coalesce(v_caller_role, '') <> 'service_role' then
    return jsonb_build_object(
      'success', false,
      'code', 'UNAUTHORIZED',
      'error', 'Only service_role is authorized to execute subscription fulfillment.'
    );
  end if;

  -- 2. Validate Parameters
  if p_order_id is null or p_plan_id is null or p_profile_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'INVALID_PARAMETERS',
      'error', 'Missing required order_id, plan_id, or profile_id.'
    );
  end if;

  -- 3. Resolve Razorpay Order ID for Lock Key
  select nullif(trim(coalesce(nullif(notes, '')::jsonb ->> 'razorpayOrderId', '')), '')
  into v_gateway_order_id
  from public.orders
  where order_id = p_order_id;

  if v_gateway_order_id is not null then
    perform pg_advisory_xact_lock(hashtext('rzp_order_claim:' || trim(v_gateway_order_id)));
  end if;

  -- 4. Lock & Verify Order
  select order_id, institute_id, student_id, status, fulfillment_status, notes
  into v_order
  from public.orders
  where order_id = p_order_id
  for update;

  if v_order.order_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'ORDER_NOT_FOUND',
      'error', 'Order not found: ' || p_order_id::text
    );
  end if;

  -- M1: the advisory lock is only ever acquired BEFORE this order row lock. Acquiring it here
  -- inverted the global order and could deadlock against reconcile_standard_refund /
  -- reconcile_standard_paid_order, which take advisory -> order -> payment. The order row lock is
  -- the authoritative serialisation point: every refund path must take the same row lock, so this
  -- order cannot be mutated concurrently while this transaction holds it.
  if v_gateway_order_id is null then
    v_gateway_order_id := nullif(trim(coalesce(nullif(v_order.notes, '')::jsonb ->> 'razorpayOrderId', '')), '');
  end if;

  if v_order.status in ('cancelled'::public.order_status, 'refunded'::public.order_status) then
    return jsonb_build_object(
      'success', false,
      'code', 'ORDER_CANCELLED_OR_REFUNDED',
      'error', 'Order ' || p_order_id::text || ' is ' || v_order.status::text || '. Subscription fulfillment aborted.'
    );
  end if;

  if v_order.fulfillment_status = 'requires_review' then
    return jsonb_build_object(
      'success', false,
      'code', 'ORDER_REQUIRES_ADMIN_REVIEW',
      'error', 'Order ' || p_order_id::text || ' requires administrative review. Subscription fulfillment aborted.'
    );
  end if;

  -- Fulfilment Idempotency Guard: If order is already fulfilled, return existing fulfillment safely without repeating mutations
  if v_order.fulfillment_status = 'fulfilled' then
    v_student_id := v_order.student_id;
    if v_student_id is null then
      select student_id, enrollment_no into v_student
      from public.student_details
      where profile_id = p_profile_id;
      v_student_id := v_student.student_id;
      v_enrollment_no := v_student.enrollment_no;
    else
      select enrollment_no into v_enrollment_no
      from public.student_details
      where student_id = v_student_id;
    end if;

    select course_id into v_course_id
    from public.subscription_plans
    where plan_id = p_plan_id;

    select * into v_existing_sub
    from public.student_subscriptions
    where order_id = p_order_id
       or (student_id = v_student_id and course_id = v_course_id)
    order by case when order_id = p_order_id then 0 else 1 end, created_at desc
    limit 1;

    select enrollment_id into v_enrollment_id
    from public.course_enrollments
    where course_id = coalesce(v_course_id, v_existing_sub.course_id)
      and student_id = v_student_id
    limit 1;

    return jsonb_build_object(
      'success', true,
      'action', 'already_fulfilled',
      'code', 'ORDER_ALREADY_FULFILLED',
      'student_id', v_student_id,
      'subscription_id', v_existing_sub.subscription_id,
      'enrollment_id', v_enrollment_id,
      'enrollment_number', v_enrollment_no,
      'course_id', coalesce(v_course_id, v_existing_sub.course_id),
      'institute_id', v_order.institute_id,
      'start_date', v_existing_sub.start_date,
      'end_date', v_existing_sub.end_date,
      'grace_end_date', v_existing_sub.grace_end_date,
      'content_access_end_date', v_existing_sub.content_access_end_date
    );
  end if;

  -- 5. Lock & Verify Settled Payment Attempt
  select payment_id, status, gateway_payment_id, gateway_order_id
  into v_payment
  from public.payments
  where order_id = p_order_id
    and gateway = 'razorpay'::public.payment_gateway
    and status in (
      'captured'::public.payment_status,
      'refunded'::public.payment_status,
      'partially_refunded'::public.payment_status
    )
  order by created_at desc
  limit 1
  for update;

  if v_payment.payment_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'PAYMENT_NOT_SETTLED',
      'error', 'No settled payment attempt found for order: ' || p_order_id::text
    );
  end if;

  if v_payment.status = 'refunded'::public.payment_status then
    return jsonb_build_object(
      'success', false,
      'code', 'ORDER_CANCELLED_OR_REFUNDED',
      'error', 'Payment has already been refunded. Subscription fulfillment aborted.'
    );
  end if;

  -- 6. Upgrade Profile Role from user to student
  select role into v_profile_role
  from public.profiles
  where profile_id = p_profile_id
  for update;

  if v_profile_role is null then
    return jsonb_build_object(
      'success', false,
      'code', 'PROFILE_NOT_FOUND',
      'error', 'Profile not found: ' || p_profile_id::text
    );
  end if;

  if v_profile_role = 'user'::public.user_role then
    update public.profiles
    set role = 'student'::public.user_role
    where profile_id = p_profile_id;
  elsif v_profile_role not in ('student'::public.user_role) then
    return jsonb_build_object(
      'success', false,
      'code', 'INVALID_ROLE',
      'error', 'Profile role ' || v_profile_role::text || ' cannot be converted to student.'
    );
  end if;

  -- 7. Ensure Student Record Exists
  select student_id, enrollment_no
  into v_student
  from public.student_details
  where profile_id = p_profile_id;

  if v_student.student_id is not null then
    v_student_id := v_student.student_id;
    v_enrollment_no := v_student.enrollment_no;
  else
    v_student_res := public.create_student_after_purchase(
      p_profile_id,
      p_guardian_name,
      p_guardian_mobile,
      p_guardian_email,
      p_target_year,
      p_dob
    );

    if (v_student_res->>'error') is not null then
      select student_id, enrollment_no
      into v_student
      from public.student_details
      where profile_id = p_profile_id;

      if v_student.student_id is not null then
        v_student_id := v_student.student_id;
        v_enrollment_no := v_student.enrollment_no;
      else
        return jsonb_build_object(
          'success', false,
          'code', 'STUDENT_CREATION_FAILED',
          'error', v_student_res->>'error'
        );
      end if;
    else
      v_student_id := (v_student_res->>'student_id')::uuid;
      v_enrollment_no := v_student_res->>'enrollment_no';
    end if;
  end if;

  -- 8. Fetch Subscription Plan Details
  select course_id, duration_days, institute_id, billing_cycle::text as billing_cycle
  into v_plan
  from public.subscription_plans
  where plan_id = p_plan_id;

  -- Resolve grace_days and content_access_days settings
  select coalesce(nullif(setting_value, '')::integer, 7)
  into v_grace_days
  from public.system_settings
  where institute_id = v_order.institute_id
    and setting_key = 'grace_days'
    and is_active = true
  limit 1;
  v_grace_days := coalesce(v_grace_days, 7);

  select coalesce(nullif(setting_value, '')::integer, 30)
  into v_content_access_days
  from public.system_settings
  where institute_id = v_order.institute_id
    and setting_key = 'content_access_days'
    and is_active = true
  limit 1;
  v_content_access_days := coalesce(v_content_access_days, 30);

  -- 9. Check Existing Subscription for Renewal vs Initial Purchase
  select item_id
  into v_order_item_id
  from public.order_items
  where order_id = p_order_id
    and (plan_id = p_plan_id or course_id = v_plan.course_id or course_id is null)
  limit 1;

  select *
  into v_existing_sub
  from public.student_subscriptions
  where course_id = v_plan.course_id
    and student_id = v_student_id
  order by created_at desc
  limit 1
  for update;

  if v_existing_sub.subscription_id is not null and
     v_existing_sub.status in ('active'::public.subscription_status_type, 'grace'::public.subscription_status_type, 'expired'::public.subscription_status_type)
  then
    -- Renewal: UPDATE existing row in place
    if v_existing_sub.end_date >= current_date then
      v_start_date := v_existing_sub.end_date + 1;
    else
      v_start_date := current_date;
    end if;
    -- H4: calendar-period subscription duration (monthly/quarterly/half-yearly/yearly).
    v_end_date := public.subscription_period_end_date(
      v_start_date, v_plan.billing_cycle, coalesce(v_plan.duration_days, 30)
    );
    v_grace_end_date := v_end_date + (v_grace_days || ' days')::interval;
    v_content_access_end_date := v_grace_end_date + (v_content_access_days || ' days')::interval;

    -- Record renewal grant with prior state & duration_days BEFORE mutating student_subscriptions!
    insert into public.order_entitlement_grants (
      order_id,
      order_item_id,
      student_id,
      institute_id,
      entitlement_type,
      entitlement_id,
      grant_type,
      duration_days,
      prior_state
    ) values (
      p_order_id,
      v_order_item_id,
      v_student_id,
      v_order.institute_id,
      'subscription',
      v_existing_sub.subscription_id,
      'renewed',
      coalesce(v_plan.duration_days, 30),
      jsonb_build_object(
        'prior_order_id', v_existing_sub.order_id,
        'prior_status', v_existing_sub.status,
        'prior_start_date', v_existing_sub.start_date,
        'prior_end_date', v_existing_sub.end_date,
        'prior_grace_end_date', v_existing_sub.grace_end_date,
        'prior_content_access_end_date', v_existing_sub.content_access_end_date
      )
    );

    update public.student_subscriptions
    set status = 'active'::public.subscription_status_type,
        start_date = v_start_date,
        end_date = v_end_date,
        grace_end_date = v_grace_end_date,
        content_access_end_date = v_content_access_end_date,
        order_id = p_order_id,
        conversion_order_id = null,
        updated_at = now()
    where subscription_id = v_existing_sub.subscription_id
    returning subscription_id into v_subscription_id;

    -- Also record in subscription_renewals audit table
    insert into public.subscription_renewals (
      subscription_id,
      student_id,
      institute_id,
      order_id,
      attempted_at,
      succeeded_at,
      amount_charged,
      currency_code,
      new_end_date
    ) values (
      v_subscription_id,
      v_student_id,
      v_order.institute_id,
      p_order_id,
      now(),
      now(),
      v_order.total_amount,
      'INR',
      v_end_date
    );
  else
    -- Initial purchase or prior subscription was cancelled/refunded
    v_start_date := current_date;
    -- H4: calendar-period subscription duration (monthly/quarterly/half-yearly/yearly).
    v_end_date := public.subscription_period_end_date(
      v_start_date, v_plan.billing_cycle, coalesce(v_plan.duration_days, 30)
    );
    v_grace_end_date := v_end_date + (v_grace_days || ' days')::interval;
    v_content_access_end_date := v_grace_end_date + (v_content_access_days || ' days')::interval;

    insert into public.student_subscriptions (
      student_id,
      plan_id,
      course_id,
      institute_id,
      order_id,
      status,
      start_date,
      end_date,
      grace_end_date,
      content_access_end_date,
      is_trial,
      is_auto_renew,
      renewal_attempts
    ) values (
      v_student_id,
      p_plan_id,
      v_plan.course_id,
      v_order.institute_id,
      p_order_id,
      'active'::public.subscription_status_type,
      v_start_date,
      v_end_date,
      v_grace_end_date,
      v_content_access_end_date,
      false,
      false,
      0
    )
    returning subscription_id into v_subscription_id;

    -- Record initial subscription grant with duration_days
    insert into public.order_entitlement_grants (
      order_id,
      order_item_id,
      student_id,
      institute_id,
      entitlement_type,
      entitlement_id,
      grant_type,
      duration_days,
      prior_state
    ) values (
      p_order_id,
      v_order_item_id,
      v_student_id,
      v_order.institute_id,
      'subscription',
      v_subscription_id,
      'created',
      coalesce(v_plan.duration_days, 30),
      null
    );
  end if;

  -- 10. Sync Course Enrollment Row Atomically
  insert into public.course_enrollments (
    course_id,
    student_id,
    institute_id,
    enrollment_type,
    is_active
  ) values (
    v_plan.course_id,
    v_student_id,
    v_order.institute_id,
    'subscription',
    true
  )
  on conflict (course_id, student_id) do update
  set is_active = true,
      revoked_at = null,
      revoked_reason = null,
      revoked_by = null,
      updated_at = now()
  returning enrollment_id into v_enrollment_id;

  -- 11. Update Order
  update public.orders
  set student_id = coalesce(student_id, v_student_id),
      fulfillment_status = 'fulfilled',
      updated_at = now()
  where order_id = p_order_id;

  return jsonb_build_object(
    'success', true,
    'action', 'subscription_fulfilled',
    'code', 'SUBSCRIPTION_FULFILLED',
    'student_id', v_student_id,
    'subscription_id', v_subscription_id,
    'enrollment_id', v_enrollment_id,
    'enrollment_number', v_enrollment_no,
    'course_id', v_plan.course_id,
    'institute_id', v_order.institute_id,
    'start_date', v_start_date,
    'end_date', v_end_date,
    'grace_end_date', v_grace_end_date,
    'content_access_end_date', v_content_access_end_date
  );
end;
$$;

comment on function public.fulfill_standard_subscription_order is
  'Transactional atomic RPC for standard subscription order fulfillment. Synchronizes under shared advisory lock and orders-before-payments lock hierarchy, verifies payment capture, upgrades profile role, inserts or renews subscription, syncs course enrollment, and marks order fulfilled in a single atomic transaction.';

-- ============================================================================
-- 7. RPC: Atomic Standard Order Gateway Creation Claim (Concurrency Lease)
-- ============================================================================
create or replace function public.acquire_standard_order_creation_claim(
  p_order_id          uuid,
  p_claimant          text,
  p_lease_seconds     integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_role         text;
  v_order               record;
  v_notes               jsonb;
  v_existing_claimant   text;
  v_claimed_at          timestamptz;
  v_lease_seconds       integer;
  v_expires_at          timestamptz;
  v_existing_rzp_order  text;
  v_existing_settled    record;
  v_now                 timestamptz := now();
begin
  -- 1. Security & Role Authorization Check (Strict Fail-Closed)
  -- H1: authorize with auth.role(), matching migrations 219/234. auth.role() reads the verified
  -- request.jwt.claims payload, whereas request.jwt.claim.role is a legacy per-claim GUC that is not
  -- populated by current PostgREST builds. Fail-closed semantics below are unchanged.
  v_caller_role := auth.role();
  if coalesce(v_caller_role, '') <> 'service_role' then
    return jsonb_build_object(
      'success', false,
      'code', 'UNAUTHORIZED',
      'error', 'Only service_role is authorized to acquire standard order creation claim.'
    );
  end if;

  if p_order_id is null or p_claimant is null or trim(p_claimant) = '' then
    return jsonb_build_object(
      'success', false,
      'code', 'INVALID_PARAMETERS',
      'error', 'Missing required order_id or claimant parameter.'
    );
  end if;

  -- 2. Lock Internal Order FOR UPDATE
  select order_id, institute_id, total_amount, currency, status, notes
  into v_order
  from public.orders
  where order_id = p_order_id
  for update;

  if v_order.order_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'ORDER_NOT_FOUND',
      'error', 'Internal order not found.'
    );
  end if;

  if v_order.status <> 'pending'::public.order_status then
    return jsonb_build_object(
      'success', false,
      'code', 'ORDER_NOT_PENDING',
      'error', 'Order is not in pending status: ' || v_order.status::text
    );
  end if;

  v_notes := coalesce(nullif(v_order.notes, '')::jsonb, '{}'::jsonb);

  -- 3. Check if already settled in payments table
  select payment_id, gateway_order_id, status
  into v_existing_settled
  from public.payments
  where order_id = p_order_id
    and gateway = 'razorpay'::public.payment_gateway
    and status in (
      'captured'::public.payment_status,
      'refunded'::public.payment_status,
      'partially_refunded'::public.payment_status
    )
  limit 1;

  if v_existing_settled.payment_id is not null then
    return jsonb_build_object(
      'success', true,
      'status', 'ALREADY_SETTLED',
      'payment_status', v_existing_settled.status,
      'gateway_order_id', v_existing_settled.gateway_order_id,
      'order_id', p_order_id
    );
  end if;

  -- 4. Check if already completed:
  -- A. Stored in orders.notes
  v_existing_rzp_order := nullif(trim(v_notes ->> 'razorpayOrderId'), '');
  
  -- B. Or recorded in payments table
  if v_existing_rzp_order is null then
    select gateway_order_id into v_existing_rzp_order
    from public.payments
    where order_id = p_order_id
      and gateway = 'razorpay'::public.payment_gateway
      and gateway_order_id is not null
    order by attempt_number desc
    limit 1;
  end if;

  if v_existing_rzp_order is not null then
    return jsonb_build_object(
      'success', true,
      'status', 'ALREADY_COMPLETED',
      'gateway_order_id', v_existing_rzp_order,
      'order_id', p_order_id
    );
  end if;

  -- 5. Check existing lease in orders.notes -> 'gatewayClaim'
  v_existing_claimant := v_notes -> 'gatewayClaim' ->> 'claimant';
  v_claimed_at        := (v_notes -> 'gatewayClaim' ->> 'claimedAt')::timestamptz;
  v_lease_seconds     := coalesce((v_notes -> 'gatewayClaim' ->> 'leaseSeconds')::integer, p_lease_seconds);

  if v_existing_claimant is not null and v_claimed_at is not null then
    v_expires_at := v_claimed_at + (v_lease_seconds || ' seconds')::interval;
    if v_now < v_expires_at and v_existing_claimant <> p_claimant then
      return jsonb_build_object(
        'success', true,
        'status', 'LEASE_ACTIVE',
        'claimant', v_existing_claimant,
        'expires_at', v_expires_at,
        'retry_after_seconds', ceil(extract(epoch from (v_expires_at - v_now))),
        'order_id', p_order_id
      );
    end if;
  end if;

  -- 6. Grant or Renew Lease
  v_notes := jsonb_set(
    v_notes,
    '{gatewayClaim}',
    jsonb_build_object(
      'claimant', p_claimant,
      'claimedAt', v_now,
      'leaseSeconds', p_lease_seconds
    )
  );

  update public.orders
  set notes = v_notes::text,
      updated_at = v_now
  where order_id = p_order_id;

  return jsonb_build_object(
    'success', true,
    'status', 'CLAIMED',
    'claimant', p_claimant,
    'lease_seconds', p_lease_seconds,
    'order_id', p_order_id
  );
end;
$$;

comment on function public.acquire_standard_order_creation_claim is
  'Coordinates exclusive external gateway order creation among concurrent workers with row-level order locking, lease expiration, and duplicate prevention.';

-- ============================================================================
-- 8. RPC: Release Standard Order Gateway Creation Claim
-- ============================================================================
create or replace function public.release_standard_order_creation_claim(
  p_order_id          uuid,
  p_claimant          text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_role         text;
  v_order               record;
  v_notes               jsonb;
  v_existing_claimant   text;
begin
  -- 1. Security & Role Authorization Check (Strict Fail-Closed)
  -- H1: authorize with auth.role(), matching migrations 219/234. auth.role() reads the verified
  -- request.jwt.claims payload, whereas request.jwt.claim.role is a legacy per-claim GUC that is not
  -- populated by current PostgREST builds. Fail-closed semantics below are unchanged.
  v_caller_role := auth.role();
  if coalesce(v_caller_role, '') <> 'service_role' then
    return jsonb_build_object(
      'success', false,
      'code', 'UNAUTHORIZED',
      'error', 'Only service_role is authorized to release standard order creation claim.'
    );
  end if;

  if p_order_id is null or p_claimant is null then
    return jsonb_build_object('success', false, 'code', 'INVALID_PARAMETERS');
  end if;

  -- 2. Lock Internal Order FOR UPDATE
  select order_id, notes
  into v_order
  from public.orders
  where order_id = p_order_id
  for update;

  if v_order.order_id is null then
    return jsonb_build_object('success', false, 'code', 'ORDER_NOT_FOUND');
  end if;

  v_notes := coalesce(nullif(v_order.notes, '')::jsonb, '{}'::jsonb);
  v_existing_claimant := v_notes -> 'gatewayClaim' ->> 'claimant';

  if v_existing_claimant is null or v_existing_claimant = p_claimant then
    v_notes := v_notes - 'gatewayClaim';
    update public.orders
    set notes = v_notes::text,
        updated_at = now()
    where order_id = p_order_id;
  end if;

  return jsonb_build_object('success', true, 'status', 'RELEASED');
end;
$$;

comment on function public.release_standard_order_creation_claim is
  'Explicitly releases a creation lease held by the claimant on a pending order.';

-- ============================================================================
-- 9. Permissions & Access Control
-- ============================================================================
revoke all on function public.reconcile_standard_order_gateway_order(
  uuid, uuid, text, numeric, text, text
) from public, anon, authenticated;

grant execute on function public.reconcile_standard_order_gateway_order(
  uuid, uuid, text, numeric, text, text
) to service_role;

revoke all on function public.create_standard_payment_attempt(
  uuid, text, numeric, text, text, text, text, jsonb, timestamptz, numeric, text
) from public, anon, authenticated;

grant execute on function public.create_standard_payment_attempt(
  uuid, text, numeric, text, text, text, text, jsonb, timestamptz, numeric, text
) to service_role;

revoke all on function public.reconcile_standard_paid_order(
  uuid, text, text, text, numeric, text, numeric, text, timestamptz, timestamptz, jsonb
) from public, anon, authenticated;

grant execute on function public.reconcile_standard_paid_order(
  uuid, text, text, text, numeric, text, numeric, text, timestamptz, timestamptz, jsonb
) to service_role;

revoke all on function public.reconcile_standard_refund(
  text, text, numeric, text, timestamptz, jsonb
) from public, anon, authenticated;

grant execute on function public.reconcile_standard_refund(
  text, text, numeric, text, timestamptz, jsonb
) to service_role;

revoke all on function public.acquire_standard_order_creation_claim(
  uuid, text, integer
) from public, anon, authenticated;

grant execute on function public.acquire_standard_order_creation_claim(
  uuid, text, integer
) to service_role;

revoke all on function public.release_standard_order_creation_claim(
  uuid, text
) from public, anon, authenticated;

grant execute on function public.release_standard_order_creation_claim(
  uuid, text
) to service_role;

revoke all on function public.reconcile_standard_recovery_refunds(
  uuid, text, text, jsonb, jsonb
) from public, anon, authenticated;

grant execute on function public.reconcile_standard_recovery_refunds(
  uuid, text, text, jsonb, jsonb
) to service_role;

revoke all on function public.fulfill_standard_course_order(
  uuid, uuid, uuid, boolean, text, text, text, text, date
) from public, anon, authenticated;

grant execute on function public.fulfill_standard_course_order(
  uuid, uuid, uuid, boolean, text, text, text, text, date
) to service_role;

revoke all on function public.fulfill_standard_pyq_order(
  uuid, uuid, uuid, text, text, text, text, date
) from public, anon, authenticated;

grant execute on function public.fulfill_standard_pyq_order(
  uuid, uuid, uuid, text, text, text, text, date
) to service_role;

revoke all on function public.fulfill_standard_subscription_order(
  uuid, uuid, uuid, text, text, text, text, date
) from public, anon, authenticated;

grant execute on function public.fulfill_standard_subscription_order(
  uuid, uuid, uuid, text, text, text, text, date
) to service_role;

revoke all on function public.revoke_standard_order_entitlements(
  uuid, text
) from public, anon, authenticated;

grant execute on function public.revoke_standard_order_entitlements(
  uuid, text
) to service_role;

revoke all on function public.subscription_period_end_date(
  date, text, integer
) from public, anon, authenticated;

grant execute on function public.subscription_period_end_date(
  date, text, integer
) to service_role;
