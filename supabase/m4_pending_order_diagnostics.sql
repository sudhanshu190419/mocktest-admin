-- ============================================================================
-- M4 — DOUBLE-ORDER RACE: DIAGNOSTICS + REVIEWED OPS CLEANUP
-- Repository: mocktest-admin | PostgreSQL 16
--
-- READ FIRST:
--   • ALL queries in SECTION 1 are SELECT-only and safe to review.
--   • Migration 105 (pending-order uniqueness) must NOT be applied until the
--     SECTION 1 queries marked "MUST BE ZERO" return zero rows.
--   • SECTION 2 (cleanup) contains UPDATE statements. They are commented out
--     on purpose. An operator must review each candidate row, run the cleanup
--     inside a transaction, and commit only after verifying the impact.
--   • Nothing in this file runs automatically. Execute statements yourself.
--
-- Context: create-payment-order's findPendingReusableOrder() is a
-- SELECT-then-INSERT with no database uniqueness, so two concurrent requests
-- can create two pending orders for the same product. Migration 105 adds
-- partial unique indexes on (profile_id, product-key-from-notes) restricted
-- to status = 'pending'. This file identifies the pre-existing rows that
-- would violate those indexes.
--
-- Product key lives in orders.notes (JSON text), NOT in an orders column:
--   course  → notes->>'courseId'   (+ conversion flag notes->>'conversion')
--   pyq     → notes->>'packageId'
--   plan    → notes->>'planId'
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — SELECT-ONLY DIAGNOSTICS
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1.0 Non-JSON notes on pending rows  [MUST BE ZERO before migration 105]
--      The index build casts notes::jsonb; malformed JSON aborts it.
select order_id, profile_id, status, left(notes, 80) as notes_preview, created_at
from public.orders
where status = 'pending'
  and notes is not null
  and pg_input_error_info(notes, 'jsonb') is not null;

-- ── 1.1 Duplicate pending COURSE orders  [MUST BE ZERO]
--      Same (profile, course, conversion) with >1 pending order.
select profile_id,
       notes::jsonb ->> 'courseId' as course_id,
       coalesce(notes::jsonb ->> 'conversion', '') as conversion,
       count(*) as pending_count,
       array_agg(order_id order by created_at) as order_ids,
       array_agg(created_at::date order by created_at) as created_dates
from public.orders
where status = 'pending'
  and notes::jsonb ->> 'courseId' is not null
group by profile_id, notes::jsonb ->> 'courseId', coalesce(notes::jsonb ->> 'conversion', '')
having count(*) > 1;

-- ── 1.2 Duplicate pending CONVERSION orders  [MUST BE ZERO — subset of 1.1]
select profile_id,
       notes::jsonb ->> 'courseId' as course_id,
       count(*) as pending_count,
       array_agg(order_id order by created_at) as order_ids
from public.orders
where status = 'pending'
  and notes::jsonb ->> 'courseId' is not null
  and notes::jsonb ->> 'conversion' = 'true'
group by profile_id, notes::jsonb ->> 'courseId'
having count(*) > 1;

-- ── 1.3 Duplicate pending PYQ orders  [MUST BE ZERO]
select profile_id,
       notes::jsonb ->> 'packageId' as package_id,
       count(*) as pending_count,
       array_agg(order_id order by created_at) as order_ids,
       array_agg(created_at::date order by created_at) as created_dates
from public.orders
where status = 'pending'
  and notes::jsonb ->> 'packageId' is not null
group by profile_id, notes::jsonb ->> 'packageId'
having count(*) > 1;

-- ── 1.4 Duplicate pending SUBSCRIPTION orders  [MUST BE ZERO]
select profile_id,
       notes::jsonb ->> 'planId' as plan_id,
       count(*) as pending_count,
       array_agg(order_id order by created_at) as order_ids,
       array_agg(created_at::date order by created_at) as created_dates
from public.orders
where status = 'pending'
  and notes::jsonb ->> 'planId' is not null
group by profile_id, notes::jsonb ->> 'planId'
having count(*) > 1;

-- ── 1.5 Stale pending orders (older than the 24h reuse window)  [REVIEW]
--      These are the rows the app now cancels on next purchase attempt
--      (M4 Fix C). They do NOT block migration 105, but an operator may want
--      to cancel them proactively. NOT counted against the pre-flight.
select order_id, profile_id,
       coalesce(notes::jsonb ->> 'courseId',
                notes::jsonb ->> 'packageId',
                notes::jsonb ->> 'planId') as product_id,
       notes::jsonb ->> 'conversion' as conversion,
       created_at, total_amount
from public.orders
where status = 'pending'
  and created_at < now() - interval '24 hours'
order by created_at;

-- ── 1.6 Potentially duplicate CONFIRMED course orders  [REVIEW — Fix B backstop]
--      Same profile + course with >1 confirmed order. The older one granted
--      the entitlement; each newer one was charged without a grant and should
--      be reviewed for refund (post-deploy they are auto-flagged).
select o.profile_id,
       o.notes::jsonb ->> 'courseId' as course_id,
       count(*) as confirmed_count,
       array_agg(o.order_id order by o.created_at) as order_ids,
       array_agg(o.created_at::date order by o.created_at) as created_dates,
       array_agg(o.total_amount order by o.created_at) as amounts
from public.orders o
where o.status = 'confirmed'
  and o.notes::jsonb ->> 'courseId' is not null
group by o.profile_id, o.notes::jsonb ->> 'courseId'
having count(*) > 1;

-- ── 1.7 Potentially duplicate CONFIRMED PYQ orders  [REVIEW — Fix B backstop]
select o.profile_id,
       o.notes::jsonb ->> 'packageId' as package_id,
       count(*) as confirmed_count,
       array_agg(o.order_id order by o.created_at) as order_ids,
       array_agg(o.created_at::date order by o.created_at) as created_dates,
       array_agg(o.total_amount order by o.created_at) as amounts
from public.orders o
where o.status = 'confirmed'
  and o.notes::jsonb ->> 'packageId' is not null
group by o.profile_id, o.notes::jsonb ->> 'packageId'
having count(*) > 1;

-- ── 1.8 Potentially duplicate CONFIRMED SUBSCRIPTION orders  [REVIEW]
--      Same profile + plan with >1 confirmed order. Initial purchases and
--      renewals both land here; a confirmed order with NO active/grace
--      student_subscriptions row pointing at it (or a different one) is a
--      candidate for refund review.
select o.profile_id,
       o.notes::jsonb ->> 'planId' as plan_id,
       count(*) as confirmed_count,
       array_agg(o.order_id order by o.created_at) as order_ids,
       array_agg(o.created_at::date order by o.created_at) as created_dates,
       array_agg(o.total_amount order by o.created_at) as amounts
from public.orders o
where o.status = 'confirmed'
  and o.notes::jsonb ->> 'planId' is not null
group by o.profile_id, o.notes::jsonb ->> 'planId'
having count(*) > 1;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — REVIEWED OPS CLEANUP (DO NOT RUN UNCHECKED — COMMENTED OUT)
-- ════════════════════════════════════════════════════════════════════════════
-- Required before migration 105 ONLY if SECTION 1.1–1.4 return rows.
-- Policy: cancel the OLDER pending order of each duplicate pair. Pending
-- orders carry no captured payment (payments.status = 'pending'), so
-- cancelling them loses no money — a Razorpay order that is never paid
-- simply expires. NEVER cancel a confirmed order and never touch payments.
--
-- Step 1 — PREVIEW inside a transaction:
-- begin;
--   -- (paste the exact candidate rows from 1.1–1.4 as a CTE, then)
--   select * from <candidate rows>;
-- rollback;
--
-- Step 2 — after review, CANCEL the older duplicate pendings:
-- begin;
--   with dupes as (
--     select profile_id,
--            notes::jsonb ->> 'courseId' as product_key,
--            coalesce(notes::jsonb ->> 'conversion', '') as conv,
--            count(*) as c
--     from public.orders
--     where status = 'pending' and notes::jsonb ->> 'courseId' is not null
--     group by profile_id, notes::jsonb ->> 'courseId',
--              coalesce(notes::jsonb ->> 'conversion', '')
--     having count(*) > 1
--   ),
--   to_cancel as (
--     select distinct on (o.profile_id, o.notes::jsonb ->> 'courseId',
--                         coalesce(o.notes::jsonb ->> 'conversion', ''))
--            o.order_id
--     from public.orders o
--     join dupes d
--       on d.profile_id = o.profile_id
--      and d.product_key = o.notes::jsonb ->> 'courseId'
--      and d.conv = coalesce(o.notes::jsonb ->> 'conversion', '')
--     where o.status = 'pending'
--     order by o.profile_id,
--              o.notes::jsonb ->> 'courseId',
--              coalesce(o.notes::jsonb ->> 'conversion', ''),
--              o.created_at           -- keep the NEWEST, cancel the rest
--   )
--   update public.orders o
--   set status = 'cancelled', cancelled_at = now(), updated_at = now()
--   from to_cancel tc
--   where o.order_id = tc.order_id
--     and o.status = 'pending';
--   -- NOTE: the SELECT DISTINCT ON above is illustrative. For the pyq/plan
--   --   variants replace courseId with packageId / planId and drop conv.
--   --   A safer formulation uses the exact order_ids printed by 1.1–1.4.
-- rollback;  -- replace with COMMIT only after you verified the row count
--
-- Step 3 — re-run SECTION 1.1–1.4; all must be zero, then apply migration 105.

-- ============================================================================
-- END OF FILE
-- ============================================================================
