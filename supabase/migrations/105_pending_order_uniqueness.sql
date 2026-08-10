-- ============================================================================
-- Migration: 105 — Pending Order Uniqueness (M4 Double-Order Race Fix A)
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Purpose: Eliminate the race condition where two concurrent
--          create-payment-order requests (or a double-tap) create TWO
--          PENDING orders for the same student and the same product. Both
--          orders are independently payable, so a double payment can be
--          captured while only one entitlement is granted (M4 audit finding).
--
-- Root cause (verified in create-payment-order/index.ts):
--   findPendingReusableOrder() performs SELECT-then-INSERT with no
--   transaction-level lock, no advisory lock, and no database uniqueness
--   constraint. Product identity is NOT a column on public.orders — it lives
--   in orders.notes (JSON text: courseId / packageId / planId + conversion)
--   and in order_items (course_id / package_id / plan_id).
--
-- Solution: three PARTIAL UNIQUE indexes on public.orders keyed on
--   (profile_id, product-key-from-notes) restricted to status = 'pending'.
--   The second concurrent INSERT then fails with SQLSTATE 23505, which
--   create-payment-order converts into a reuse lookup of the WINNER's order
--   (no second payable order, no generic 500).
--
-- Design notes:
--   • Product key uses notes::jsonb ->> '...' because notes is a TEXT
--     column (migration 008). text::jsonb is IMMUTABLE so it is valid in an
--     index expression; the raw ->> operator does not resolve on text.
--   • The course index includes coalesce(notes::jsonb ->> 'conversion','')
--     in the key so a NORMAL course purchase and a CONVERSION purchase for
--     the same course can both be pending (mirrors the exact signature
--     comparison in findPendingReusableOrder), while two of the SAME kind
--     can never coexist.
--   • The 24-hour reuse window is NOT encoded here — partial-index
--     predicates must be immutable and cannot reference now(). Stale
--     pending (>24h) cleanup is handled by create-payment-order
--     (cancelStalePendingOrders, M4 Fix C) BEFORE a fresh order is inserted.
--     This migration only guarantees ATOMICITY; the app preserves the
--     existing 24h semantics.
--   • Different products never conflict (different keys) — simultaneous
--     purchase of a course + PYQ + plan is unaffected.
--   • Existing pending rows that already violate the invariant abort this
--     migration with a clear message (pattern: migration 086) — automatic
--     merging of billing rows is unsafe. Run the pre-flight diagnostics in
--     supabase/m4_pending_order_diagnostics.sql and resolve duplicates
--     (cancel the older) before applying.
--
-- Depends on: Migration 008 (orders), 043 (profile_id), 044 (nullable
--             student_id)
-- Reference: M4 production-readiness audit (double-order race at order
--            creation) — Fix A (atomic pending-order uniqueness)
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Pre-flight: abort if existing pending orders violate the invariant
-- ════════════════════════════════════════════════════════════════════════════
-- Also guards against non-JSON notes (the expression indexes cast notes to
-- jsonb and would otherwise fail cryptically).
do $$
declare
  v_invalid_json    bigint;
  v_course_dupes    bigint;
  v_package_dupes   bigint;
  v_plan_dupes      bigint;
begin
  -- 1a. Non-JSON notes on any pending row (the index build casts notes::jsonb)
  select count(*) into v_invalid_json
  from public.orders
  where status = 'pending'
    and notes is not null
    and pg_input_error_info(notes, 'jsonb') is not null;

  -- 1b. Duplicate pending COURSE orders per (profile, course, conversion)
  select count(*) into v_course_dupes
  from (
    select profile_id,
           notes::jsonb ->> 'courseId'   as product_key,
           coalesce(notes::jsonb ->> 'conversion', '') as conv
    from public.orders
    where status = 'pending'
      and notes::jsonb ->> 'courseId' is not null
    group by profile_id,
             notes::jsonb ->> 'courseId',
             coalesce(notes::jsonb ->> 'conversion', '')
    having count(*) > 1
  ) d;

  -- 1c. Duplicate pending PYQ orders per (profile, package)
  select count(*) into v_package_dupes
  from (
    select profile_id,
           notes::jsonb ->> 'packageId' as product_key
    from public.orders
    where status = 'pending'
      and notes::jsonb ->> 'packageId' is not null
    group by profile_id,
             notes::jsonb ->> 'packageId'
    having count(*) > 1
  ) d;

  -- 1d. Duplicate pending SUBSCRIPTION orders per (profile, plan)
  select count(*) into v_plan_dupes
  from (
    select profile_id,
           notes::jsonb ->> 'planId' as product_key
    from public.orders
    where status = 'pending'
      and notes::jsonb ->> 'planId' is not null
    group by profile_id,
             notes::jsonb ->> 'planId'
    having count(*) > 1
  ) d;

  if v_invalid_json > 0 then
    raise exception
      'Migration 105 aborted: % pending order(s) have non-JSON notes. Normalize notes before applying.',
      v_invalid_json;
  end if;

  if v_course_dupes + v_package_dupes + v_plan_dupes > 0 then
    raise exception
      'Migration 105 aborted: pending-order uniqueness violated — course: %, pyq: %, plan: % pair(s). '
      'Resolve duplicate pending orders (cancel the older) before applying. See '
      'supabase/m4_pending_order_diagnostics.sql for the diagnostic queries.',
      v_course_dupes, v_package_dupes, v_plan_dupes;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Partial UNIQUE indexes (the atomic guarantee)
-- ════════════════════════════════════════════════════════════════════════════
-- Naming follows the orders constraint family (pk_orders / fk_orders_* /
-- uq_* pattern used elsewhere) with a partial predicate restricting to
-- status = 'pending' (abandoned/cancelled/refunded/confirmed rows never
-- conflict, so a new purchase is never blocked by history).

-- 2a. Course (normal purchase + conversion share courseId; conversion marker
--     is part of the key so the two purchase TYPES are independent, exactly
--     as findPendingReusableOrder compares them).
create unique index if not exists uq_orders_pending_course
  on public.orders (
    profile_id,
    (notes::jsonb ->> 'courseId'),
    coalesce(notes::jsonb ->> 'conversion', '')
  )
  where status = 'pending' and notes::jsonb ->> 'courseId' is not null;

-- 2b. PYQ package
create unique index if not exists uq_orders_pending_package
  on public.orders (
    profile_id,
    (notes::jsonb ->> 'packageId')
  )
  where status = 'pending' and notes::jsonb ->> 'packageId' is not null;

-- 2c. Subscription plan
create unique index if not exists uq_orders_pending_plan
  on public.orders (
    profile_id,
    (notes::jsonb ->> 'planId')
  )
  where status = 'pending' and notes::jsonb ->> 'planId' is not null;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Comments
-- ════════════════════════════════════════════════════════════════════════════
comment on index public.uq_orders_pending_course is
  'M4 concurrency guard (Fix A): at most one PENDING order per '
  '(profile_id, courseId, conversion) as stored in orders.notes. The second '
  'concurrent INSERT fails with 23505 and create-payment-order recovers by '
  're-using the winner. Confirmed/cancelled/refunded rows never conflict.';

comment on index public.uq_orders_pending_package is
  'M4 concurrency guard (Fix A): at most one PENDING order per '
  '(profile_id, packageId) as stored in orders.notes.';

comment on index public.uq_orders_pending_plan is
  'M4 concurrency guard (Fix A): at most one PENDING order per '
  '(profile_id, planId) as stored in orders.notes.';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION (run after applying — see also supabase/m4_pending_order_diagnostics.sql)
-- ════════════════════════════════════════════════════════════════════════════
-- 1. Indexes exist (expect three rows):
--   select indexname from pg_indexes
--   where schemaname = 'public' and tablename = 'orders'
--     and indexname like 'uq_orders_pending_%';
--
-- 2. The guard rejects a conflicting second pending insert.
--    Run inside a transaction and ROLLBACK — do NOT commit this probe.
--   begin;
--   insert into public.orders (
--     institute_id, student_id, profile_id, status, currency,
--     subtotal_amount, discount_amount, tax_amount, total_amount, notes
--   )
--   select institute_id, null, profile_id, 'pending', 'INR', 100, 0, 0, 100,
--          '{"courseId":"<some-uuid>","razorpayOrderId":"order_race_probe","profileId":"<some-uuid>"}'
--   from public.orders where status = 'pending' and notes::jsonb ->> 'courseId' is not null
--   limit 1;
--   -- second identical insert → EXPECTED: duplicate key value violates unique
--   -- constraint "uq_orders_pending_course"
--   rollback;
--
-- 3. Different products coexist (expect one row each, no error):
--   select 1 from public.orders where false;  -- see diagnostics file for
--                                               -- the full product-isolation test

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (if this migration must be undone)
-- ════════════════════════════════════════════════════════════════════════════
--   drop index if exists public.uq_orders_pending_course;
--   drop index if exists public.uq_orders_pending_package;
--   drop index if exists public.uq_orders_pending_plan;
--
-- ============================================================================
-- END OF MIGRATION — 105 Pending Order Uniqueness
-- ============================================================================
