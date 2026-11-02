-- ============================================================================
-- Migration 217 regression tests: Google Play renewal cycle-exact idempotency
--
-- Executes the REAL public.complete_google_play_purchase (not a mock).
--
-- Run against a LOCAL / DEV database only:
--   psql "$LOCAL_DATABASE_URL" -f supabase/tests/google_play_renewal_cycle_idempotency.sql
--
-- Every row created here is rolled back at the end. No historical/demo data is
-- touched: the script only reads an existing student + plan to obtain valid
-- foreign keys, then creates its own throwaway order family.
--
-- Coverage: S1 first renewal, S2 duplicate delivery, S3a-S3e delayed older cycle with
-- and without exact-order Orders API proof (including inconsistent proof), S4 missing
-- expiry, S5 synthetic order id,
-- S6 one payment per cycle, S7 sequential cycles, S8 original-order replay, S9/S10
-- monotonic expiry, S11 rollback + retry, S12 RTDN ledger completion with lease
-- fencing, S13 batch/single-cycle lock-key compatibility + batch recording, S14
-- rejected batch writes nothing, S15 one captured payment per external order.
--
-- Limitation: two genuinely concurrent sessions cannot be created from inside a
-- single-transaction script (no dblink/pg_background dependency). S2/S7 exercise the
-- serialized duplicate path, and S13 verifies that the batch function is defined with
-- the same advisory lock keys as the single-cycle function, which is what makes the
-- two paths mutually exclusive on one external order.
-- ============================================================================
\set ON_ERROR_STOP on

begin;

-- The function enforces auth.role() = 'service_role'.
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create temp table _gp_test on commit drop as
select
  sd.student_id,
  sd.profile_id,
  sd.institute_id,
  sp.plan_id,
  sp.name            as plan_name,
  sp.course_id       as plan_course_id,
  sp.price           as plan_price,
  ('test_217_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 24)) as token,
  ('GPA.2170-' || lpad((floor(random() * 9000) + 1000)::int::text, 4, '0') || '-0000-0000-' || lpad((floor(random() * 90000) + 10000)::int::text, 5, '0')) as base_order
from public.student_details sd
join lateral (
  select p.plan_id, p.name, p.course_id, p.price
  from public.subscription_plans p
  where p.institute_id = sd.institute_id
    and p.is_active = true
    -- Deterministic: never reuse a (student, plan) pair that already owns a subscription row,
    -- so creating the fixture subscription cannot collide with ANY unique/partial-unique
    -- constraint on public.student_subscriptions (e.g. one active row per student+plan).
    and not exists (
      select 1 from public.student_subscriptions ss
      where ss.student_id = sd.student_id
        and ss.plan_id = p.plan_id
    )
  order by p.price asc, p.plan_id asc
  limit 1
) sp on true
join public.profiles pr on pr.profile_id = sd.profile_id
where pr.role = 'student'
  and not exists (select 1 from public.teacher_details td where td.profile_id = sd.profile_id)
  and not exists (select 1 from public.admin_roles ar where ar.profile_id = sd.profile_id and ar.access_status = 'approved')
limit 1;

do $$
begin
  if not exists (select 1 from _gp_test) then
    raise exception 'Seed prerequisites missing: need an active student (role=student, student_details row) and an active subscription plan in the same institute';
  end if;
end $$;

-- ── Fixture: original unsuffixed purchase (order, item, captured payment) ──
insert into public.orders (
  order_id, institute_id, student_id, profile_id, status, currency,
  subtotal_amount, discount_amount, tax_amount, total_amount, notes,
  placed_at, confirmed_at, created_at, updated_at
)
select gen_random_uuid(), t.institute_id, t.student_id, t.profile_id, 'confirmed', 'INR',
       t.plan_price, 0.00, 0.00, t.plan_price,
       jsonb_build_object('gateway','google_play','purchaseToken',t.token,'orderId',t.base_order,'itemType','subscription_plan','planId',t.plan_id)::text,
       '2026-10-26T00:00:00Z','2026-10-26T00:00:00Z','2026-10-26T00:00:00Z','2026-10-26T00:00:00Z'
from _gp_test t;

alter table _gp_test add column orig_order_uuid uuid;
update _gp_test t
set orig_order_uuid = o.order_id
from public.orders o
where o.notes::jsonb ->> 'orderId' = t.base_order;

insert into public.order_items (
  order_id, institute_id, item_type, course_id, plan_id, package_id,
  item_name, unit_price, quantity, discount_amount, line_total, created_at
)
select t.orig_order_uuid, t.institute_id, 'subscription_plan', t.plan_course_id, t.plan_id, null,
       t.plan_name, t.plan_price, 1, 0.00, t.plan_price, '2026-10-26T00:00:00Z'
from _gp_test t;

insert into public.payments (
  order_id, institute_id, attempt_number, gateway, gateway_order_id, gateway_payment_id,
  gateway_response, amount, currency, status, paid_at, created_at, updated_at
)
select t.orig_order_uuid, t.institute_id, 1, 'google_play', t.base_order, t.base_order,
       jsonb_build_object('purchaseToken', t.token, 'verified', true), t.plan_price, 'INR',
       'captured', '2026-10-26T00:00:00Z', '2026-10-26T00:00:00Z', '2026-10-26T00:00:00Z'
from _gp_test t;

insert into public.student_subscriptions (
  student_id, plan_id, course_id, institute_id, order_id, status,
  start_date, end_date, grace_end_date, content_access_end_date,
  is_auto_renew, payment_method_id, created_at, updated_at
)
select t.student_id, t.plan_id, t.plan_course_id, t.institute_id, t.orig_order_uuid, 'active',
       '2026-10-26', '2026-11-25', '2026-12-02', '2027-01-01',
       true, t.token, '2026-10-26T00:00:00Z', '2026-10-26T00:00:00Z'
from _gp_test t;

-- ── Harness: call the real RPC for an arbitrary cycle ─────────────────────
create function pg_temp._gp_complete(
  p_order text,
  p_expiry date,
  p_verification jsonb default null,
  p_defer boolean default false,
  p_rtdn_event_id uuid default null,
  p_rtdn_attempt integer default null
)
returns jsonb
language plpgsql
as $fn$
declare
  t record;
begin
  select * into t from _gp_test;
  return public.complete_google_play_purchase(
    p_profile_id             => t.profile_id,
    p_institute_id           => t.institute_id,
    p_student_id             => t.student_id,
    p_item_type             => 'subscription_plan',
    p_course_id              => t.plan_course_id,
    p_plan_id                => t.plan_id,
    p_package_id             => null,
    p_item_name              => t.plan_name,
    p_unit_price             => t.plan_price,
    p_effective_order_id     => p_order,
    p_purchase_token         => t.token,
    p_product_id             => 'test_sku_217',
    p_gateway_response       => coalesce(p_verification, jsonb_build_object('verified', true, 'source', 'subscriptionsv2'))
                                || case when p_defer then jsonb_build_object('defer_rtdn_completion', true) else '{}'::jsonb end
                                || case when p_rtdn_event_id is not null
                                        then jsonb_build_object('rtdn_event_id', p_rtdn_event_id, 'rtdn_attempt', coalesce(p_rtdn_attempt, 1))
                                        else '{}'::jsonb end,
    p_transaction_timestamp  => '2026-10-26T00:00:00Z'::timestamptz,
    p_subscription_end_date  => p_expiry,
    p_is_auto_renew          => true,
    p_billing_name           => 'Student',
    p_billing_email          => 'student@example.test'
  );
end
$fn$;

-- Builds the Orders API proof object the Edge Function sends for a delayed/older cycle.
-- Migration 217 requires it to be self-consistent with the row being written.
create function pg_temp._gp_proof(
  p_order text,
  p_amount numeric,
  p_expiry date,
  p_order_id_override text default null
)
returns jsonb
language sql
as $fn$
  select jsonb_build_object(
    'verified', true,
    'source', 'google_orders_api',
    'verification_source', 'orders_api',
    'verified_order_id', coalesce(p_order_id_override, p_order),
    'verified_amount', p_amount,
    'verified_expiry', p_expiry::text,
    'currency', 'INR'
  );
$fn$;

-- ── S1: first verified renewal ..0 creates its own ledger row ─────────────
do $t$
declare
  t record; v jsonb; cnt int; sub record; cyc_order uuid;
begin
  select * into t from _gp_test;
  v := pg_temp._gp_complete(t.base_order || '..0', '2026-12-25');

  if v->>'outcome' is distinct from 'renewal_recorded' then
    raise exception 'S1 expected renewal_recorded, got %', v;
  end if;
  if v->>'paymentId' is null then
    raise exception 'S1 paymentId missing: %', v;
  end if;

  select count(*) into cnt from public.payments
  where gateway = 'google_play' and gateway_payment_id = t.base_order || '..0';
  if cnt <> 1 then raise exception 'S1 expected exactly 1 payment, got %', cnt; end if;

  select p.order_id into cyc_order from public.payments p
  where p.gateway_payment_id = t.base_order || '..0';
  if not exists (select 1 from public.orders o where o.order_id = cyc_order and o.profile_id = t.profile_id) then
    raise exception 'S1 renewal payment must reference an internal order UUID of this profile';
  end if;

  select * into sub from public.student_subscriptions
  where student_id = t.student_id and plan_id = t.plan_id
  order by created_at desc limit 1;
  if sub.end_date <> '2026-12-25'::date then
    raise exception 'S1 end_date expected 2026-12-25, got %', sub.end_date;
  end if;
  if sub.order_id <> cyc_order then
    raise exception 'S1 subscription must link to the newest cycle internal order';
  end if;
end
$t$;

-- ── S2: duplicate delivery of a recorded renewal is idempotent ────────────
do $t$
declare
  t record; v jsonb; cnt int; sub record;
begin
  select * into t from _gp_test;
  v := pg_temp._gp_complete(t.base_order || '..0', '2026-12-25');

  if v->>'outcome' is distinct from 'already_recorded' then
    raise exception 'S2 expected already_recorded, got %', v;
  end if;
  if (v->>'alreadyProcessed')::boolean is not true then
    raise exception 'S2 alreadyProcessed must stay true for a genuine duplicate: %', v;
  end if;

  select count(*) into cnt from public.payments
  where gateway = 'google_play' and gateway_payment_id = t.base_order || '..0';
  if cnt <> 1 then raise exception 'S2 duplicate created a second payment (count=%)', cnt; end if;

  select * into sub from public.student_subscriptions
  where student_id = t.student_id and plan_id = t.plan_id order by created_at desc limit 1;
  if sub.end_date <> '2026-12-25'::date then
    raise exception 'S2 duplicate changed entitlement to %', sub.end_date;
  end if;
end
$t$;

-- ── S3a: newer cycle advances the ledger and the linked order ────────────
do $t$
declare
  t record; v2 jsonb;
begin
  select * into t from _gp_test;

  v2 := pg_temp._gp_complete(t.base_order || '..2', '2027-02-25');
  if v2->>'outcome' is distinct from 'renewal_recorded' then
    raise exception 'S3a forward cycle expected renewal_recorded, got %', v2;
  end if;
end
$t$;

-- ── S3b: an older unrecorded cycle is NOT ledgered without Orders API proof ─
do $t$
declare
  t record; v jsonb; cnt int; sub record;
begin
  select * into t from _gp_test;

  v := pg_temp._gp_complete(t.base_order || '..1', '2027-01-25');
  if v->>'outcome' is distinct from 'reconciliation_required' then
    raise exception 'S3b expected reconciliation_required, got %', v;
  end if;
  if v->>'reason' is distinct from 'OLDER_CYCLE_UNVERIFIED' then
    raise exception 'S3b expected OLDER_CYCLE_UNVERIFIED, got %', v->>'reason';
  end if;

  select count(*) into cnt from public.payments
  where gateway = 'google_play' and gateway_payment_id = t.base_order || '..1';
  if cnt <> 0 then raise exception 'S3b recorded an unverified older cycle'; end if;

  select * into sub from public.student_subscriptions
  where student_id = t.student_id and plan_id = t.plan_id order by created_at desc limit 1;
  if sub.end_date <> '2027-02-25'::date then
    raise exception 'S3b changed entitlement to %', sub.end_date;
  end if;
end
$t$;

-- ── S3c: verification metadata for a DIFFERENT order is rejected ───────────
do $t$
declare
  t record; v jsonb; cnt int;
begin
  select * into t from _gp_test;

  v := pg_temp._gp_complete(
    t.base_order || '..1',
    '2027-01-25',
    pg_temp._gp_proof(t.base_order || '..1', t.plan_price, '2027-01-25', t.base_order || '..0')
  );
  if v->>'outcome' is distinct from 'reconciliation_required' then
    raise exception 'S3c expected reconciliation_required, got %', v;
  end if;
  if v->>'reason' is distinct from 'OLDER_CYCLE_UNVERIFIED' then
    raise exception 'S3c expected OLDER_CYCLE_UNVERIFIED, got %', v->>'reason';
  end if;

  select count(*) into cnt from public.payments
  where gateway = 'google_play' and gateway_payment_id = t.base_order || '..1';
  if cnt <> 0 then raise exception 'S3c recorded a cycle with mismatched verification metadata'; end if;
end
$t$;

-- ── S3d: proof that is not self-consistent is rejected ────────────────────
do $t$
declare
  t record; v jsonb; cnt int;
begin
  select * into t from _gp_test;

  -- (a) proof without a verified amount
  v := pg_temp._gp_complete(
    t.base_order || '..1',
    '2027-01-25',
    jsonb_build_object('verified', true, 'verification_source', 'orders_api',
                       'verified_order_id', t.base_order || '..1',
                       'verified_expiry', '2027-01-25', 'currency', 'INR')
  );
  if v->>'outcome' is distinct from 'reconciliation_required' or v->>'reason' is distinct from 'OLDER_CYCLE_UNVERIFIED' then
    raise exception 'S3d(a) proof without verified_amount must be rejected, got %', v;
  end if;

  -- (b) verified amount that does not match the ledgered unit price
  v := pg_temp._gp_complete(
    t.base_order || '..1',
    '2027-01-25',
    pg_temp._gp_proof(t.base_order || '..1', t.plan_price + 1, '2027-01-25')
  );
  if v->>'outcome' is distinct from 'reconciliation_required' then
    raise exception 'S3d(b) mismatched verified_amount must be rejected, got %', v;
  end if;

  -- (c) verified expiry that does not match the submitted expiry
  v := pg_temp._gp_complete(
    t.base_order || '..1',
    '2027-01-25',
    pg_temp._gp_proof(t.base_order || '..1', t.plan_price, '2027-01-24')
  );
  if v->>'outcome' is distinct from 'reconciliation_required' then
    raise exception 'S3d(c) mismatched verified_expiry must be rejected, got %', v;
  end if;

  select count(*) into cnt from public.payments
  where gateway = 'google_play' and gateway_payment_id = t.base_order || '..1';
  if cnt <> 0 then raise exception 'S3d wrote % payments for inconsistent proofs', cnt; end if;
end
$t$;

-- ── S3e: delayed older cycle WITH exact-order proof is ledgered, not applied ─
do $t$
declare
  t record; v jsonb; sub record; order2 uuid; cnt int;
begin
  select * into t from _gp_test;

  select p.order_id into order2 from public.payments p where p.gateway_payment_id = t.base_order || '..2';

  v := pg_temp._gp_complete(
    t.base_order || '..1',
    '2027-01-25',
    pg_temp._gp_proof(t.base_order || '..1', t.plan_price, '2027-01-25')
  );
  if v->>'outcome' is distinct from 'renewal_recorded_backfill' then
    raise exception 'S3e older cycle expected renewal_recorded_backfill, got %', v;
  end if;

  select count(*) into cnt from public.payments
  where gateway = 'google_play' and gateway_payment_id = t.base_order || '..1';
  if cnt <> 1 then raise exception 'S3e older cycle payment not recorded (count=%)', cnt; end if;

  select * into sub from public.student_subscriptions
  where student_id = t.student_id and plan_id = t.plan_id order by created_at desc limit 1;
  if sub.end_date <> '2027-02-25'::date then
    raise exception 'S3e older cycle reduced entitlement to %', sub.end_date;
  end if;
  if sub.order_id <> order2 then
    raise exception 'S3e older cycle replaced the linked order reference';
  end if;
end
$t$;

-- ── S4: renewal without verified expiry is not written ────────────────────
do $t$
declare
  t record; v jsonb; cnt int; sub record;
begin
  select * into t from _gp_test;
  v := pg_temp._gp_complete(t.base_order || '..3', null);

  if v->>'outcome' is distinct from 'reconciliation_required' then
    raise exception 'S4 expected reconciliation_required, got %', v;
  end if;
  if v->>'reason' is distinct from 'EXPIRY_MISSING' then
    raise exception 'S4 expected EXPIRY_MISSING, got %', v->>'reason';
  end if;

  select count(*) into cnt from public.payments
  where gateway = 'google_play' and gateway_payment_id = t.base_order || '..3';
  if cnt <> 0 then raise exception 'S4 fabricated a payment without expiry evidence'; end if;

  select * into sub from public.student_subscriptions
  where student_id = t.student_id and plan_id = t.plan_id order by created_at desc limit 1;
  if sub.end_date <> '2027-02-25'::date then
    raise exception 'S4 changed entitlement to % without evidence', sub.end_date;
  end if;
end
$t$;

-- ── S5: a synthetic order id never suppresses a renewal ───────────────────
do $t$
declare
  t record; v jsonb; cnt int;
begin
  select * into t from _gp_test;
  v := pg_temp._gp_complete('GPA.SUB.TEST217', null);

  if v->>'outcome' is distinct from 'reconciliation_required' then
    raise exception 'S5 expected reconciliation_required, got %', v;
  end if;
  if v->>'reason' is distinct from 'AMBIGUOUS_ORDER_ID' then
    raise exception 'S5 expected AMBIGUOUS_ORDER_ID, got %', v->>'reason';
  end if;

  select count(*) into cnt from public.payments
  where gateway = 'google_play' and gateway_payment_id = 'GPA.SUB.TEST217';
  if cnt <> 0 then raise exception 'S5 fabricated a payment for a synthetic order id'; end if;
end
$t$;

-- ── S6: exactly one payment per genuine cycle, token-scoped count ─────────
do $t$
declare
  t record; total int; dup int;
begin
  select * into t from _gp_test;

  select count(*) into total from public.payments
  where gateway = 'google_play'
    and (gateway_payment_id = t.base_order
      or gateway_payment_id in (t.base_order || '..0', t.base_order || '..1', t.base_order || '..2'));
  if total <> 4 then
    raise exception 'S6 expected 4 ledgered orders (original + ..0 + ..1 + ..2), got %', total;
  end if;

  select count(*) into dup from (
    select gateway_payment_id from public.payments
    where gateway = 'google_play'
      and gateway_payment_id like t.base_order || '%'
    group by gateway_payment_id having count(*) > 1
  ) d;
  if dup <> 0 then raise exception 'S6 duplicate payment rows detected for % order ids', dup; end if;
end
$t$;

-- ── S7: sequential renewal cycles advance one step at a time ──────────────
do $t$
declare
  t record; v3 jsonb; v4 jsonb; sub record; cnt3 int; cnt4 int; o4 uuid;
begin
  select * into t from _gp_test;

  v3 := pg_temp._gp_complete(t.base_order || '..3', '2027-03-25');
  if v3->>'outcome' is distinct from 'renewal_recorded' then
    raise exception 'S7 cycle ..3 expected renewal_recorded, got %', v3;
  end if;

  v4 := pg_temp._gp_complete(t.base_order || '..4', '2027-04-25');
  if v4->>'outcome' is distinct from 'renewal_recorded' then
    raise exception 'S7 cycle ..4 expected renewal_recorded, got %', v4;
  end if;

  select count(*) into cnt3 from public.payments
  where gateway = 'google_play' and gateway_payment_id = t.base_order || '..3';
  select count(*) into cnt4 from public.payments
  where gateway = 'google_play' and gateway_payment_id = t.base_order || '..4';
  if cnt3 <> 1 or cnt4 <> 1 then
    raise exception 'S7 expected one payment per sequential cycle (..3=%, ..4=%)', cnt3, cnt4;
  end if;

  select p.order_id into o4 from public.payments p where p.gateway_payment_id = t.base_order || '..4';

  select * into sub from public.student_subscriptions
  where student_id = t.student_id and plan_id = t.plan_id order by created_at desc limit 1;
  if sub.end_date <> '2027-04-25'::date then
    raise exception 'S7 end_date expected 2027-04-25, got %', sub.end_date;
  end if;
  if sub.order_id <> o4 then
    raise exception 'S7 subscription must link to the newest cycle internal order';
  end if;
end
$t$;

-- ── S8: replaying the unsuffixed original purchase stays idempotent ────────
do $t$
declare
  t record; v jsonb; cnt int; sub record;
begin
  select * into t from _gp_test;

  v := pg_temp._gp_complete(t.base_order, '2027-04-25');
  if v->>'outcome' is distinct from 'already_recorded' then
    raise exception 'S8 expected already_recorded for the original order replay, got %', v;
  end if;

  select count(*) into cnt from public.payments
  where gateway = 'google_play' and gateway_payment_id = t.base_order;
  if cnt <> 1 then raise exception 'S8 original replay produced % payments', cnt; end if;

  select * into sub from public.student_subscriptions
  where student_id = t.student_id and plan_id = t.plan_id order by created_at desc limit 1;
  if sub.end_date <> '2027-04-25'::date then
    raise exception 'S8 original replay changed entitlement to %', sub.end_date;
  end if;
end
$t$;

-- ── S9: a shorter verified expiry never reduces established entitlement ────
do $t$
declare
  t record; v jsonb; sub record; cnt int;
begin
  select * into t from _gp_test;

  v := pg_temp._gp_complete(t.base_order || '..5', '2027-01-25');
  if v->>'outcome' is distinct from 'renewal_recorded' then
    raise exception 'S9 expected renewal_recorded, got %', v;
  end if;

  select count(*) into cnt from public.payments
  where gateway = 'google_play' and gateway_payment_id = t.base_order || '..5';
  if cnt <> 1 then raise exception 'S9 payment not recorded (count=%)', cnt; end if;

  select * into sub from public.student_subscriptions
  where student_id = t.student_id and plan_id = t.plan_id order by created_at desc limit 1;
  if sub.end_date <> '2027-04-25'::date then
    raise exception 'S9 monotonic expiry violated: end_date=%', sub.end_date;
  end if;
  if sub.grace_end_date < '2027-05-02'::date then
    raise exception 'S9 grace window regressed to %', sub.grace_end_date;
  end if;
end
$t$;

-- ── S10: degenerate (same-day) verified expiry never regresses entitlement ─
do $t$
declare
  t record; v jsonb; sub record; cnt int;
begin
  select * into t from _gp_test;

  v := pg_temp._gp_complete(t.base_order || '..6', '2026-10-26');
  if v->>'outcome' is distinct from 'renewal_recorded' then
    raise exception 'S10 expected renewal_recorded, got %', v;
  end if;

  select count(*) into cnt from public.payments
  where gateway = 'google_play' and gateway_payment_id = t.base_order || '..6';
  if cnt <> 1 then raise exception 'S10 payment not recorded (count=%)', cnt; end if;

  select * into sub from public.student_subscriptions
  where student_id = t.student_id and plan_id = t.plan_id order by created_at desc limit 1;
  if sub.end_date < '2027-04-25'::date then
    raise exception 'S10 degenerate expiry regressed entitlement to %', sub.end_date;
  end if;
  if sub.end_date <= sub.start_date then
    raise exception 'S10 produced a non-advancing window: % .. %', sub.start_date, sub.end_date;
  end if;
end
$t$;

-- ── S11: a rolled-back renewal leaves nothing behind and retries cleanly ───
do $t$
declare
  t record; v jsonb; cnt int;
begin
  select * into t from _gp_test;

  begin
    perform pg_temp._gp_complete(t.base_order || '..7', '2027-06-25');
    raise exception 'S11 forced rollback';
  exception when others then
    if sqlerrm <> 'S11 forced rollback' then raise; end if;
  end;

  select count(*) into cnt from public.payments
  where gateway = 'google_play' and gateway_payment_id = t.base_order || '..7';
  if cnt <> 0 then raise exception 'S11 rollback left % payment rows', cnt; end if;

  if exists (
    select 1 from public.orders o
    where o.profile_id = t.profile_id
      and (o.notes::jsonb ->> 'orderId') = t.base_order || '..7'
  ) then
    raise exception 'S11 rollback left an orphan order row';
  end if;

  v := pg_temp._gp_complete(t.base_order || '..7', '2027-06-25');
  if v->>'outcome' is distinct from 'renewal_recorded' then
    raise exception 'S11 retry expected renewal_recorded, got %', v;
  end if;

  select count(*) into cnt from public.payments
  where gateway = 'google_play' and gateway_payment_id = t.base_order || '..7';
  if cnt <> 1 then raise exception 'S11 retry produced % payments', cnt; end if;
end
$t$;

-- ── S12: RTDN ledger completion uses a real event id and lease fencing ─────
do $t$
declare
  t record; v jsonb; ev uuid; rec record; cnt int;
begin
  select * into t from _gp_test;

  insert into public.google_play_rtdn_events (
    notification_type, purchase_token, package_name, subscription_id,
    event_time_millis, processing_status, attempts, received_at
  ) values (
    2, t.token, 'com.makemetopper.test', 'test_sku_217',
    1729999999000, 'processing', 1, now()
  ) returning event_id into ev;

  v := pg_temp._gp_complete(t.base_order || '..8', '2027-07-25', null, false, ev, 1);
  if v->>'outcome' is distinct from 'renewal_recorded' then
    raise exception 'S12 expected renewal_recorded, got %', v;
  end if;

  select * into rec from public.google_play_rtdn_events where event_id = ev;
  if rec.processing_status <> 'completed' then
    raise exception 'S12 ledger not completed (status=%)', rec.processing_status;
  end if;
  if rec.order_id is distinct from t.base_order || '..8' then
    raise exception 'S12 ledger order_id mismatch: %', rec.order_id;
  end if;
  if rec.cycle_index is distinct from 8 then
    raise exception 'S12 ledger cycle_index expected 8, got %', rec.cycle_index;
  end if;

  select count(*) into cnt from public.payments
  where gateway = 'google_play' and gateway_payment_id = t.base_order || '..8';
  if cnt <> 1 then raise exception 'S12 expected exactly 1 payment, got %', cnt; end if;

  -- A stale worker (wrong attempts value) must never write a ledger row.
  v := pg_temp._gp_complete(t.base_order || '..9', '2027-08-25', null, false, ev, 99);
  if v->>'code' is distinct from 'STALE_LEASE_LOST' then
    raise exception 'S12b expected STALE_LEASE_LOST, got %', v;
  end if;

  select count(*) into cnt from public.payments
  where gateway = 'google_play' and gateway_payment_id = t.base_order || '..9';
  if cnt <> 0 then raise exception 'S12b stale worker wrote % payments', cnt; end if;
end
$t$;

-- ── S13: batch and single-cycle share the same advisory lock keys ─────────
-- (A single-transaction script cannot host two live sessions, so the lock
--  contract is verified structurally and each path is exercised serially.)
do $t$
declare
  t record; v jsonb; sub record; cnt int; def_core text; def_batch text; o11 uuid;
begin
  select * into t from _gp_test;

  def_core := pg_get_functiondef('public.complete_google_play_purchase(uuid,uuid,uuid,text,uuid,uuid,uuid,text,numeric,text,text,text,jsonb,timestamptz,date,boolean,text,text)'::regprocedure);
  def_batch := pg_get_functiondef('public.reconcile_google_play_renewal_batch(uuid,integer,uuid,uuid,uuid,uuid,uuid,text,text,jsonb,jsonb)'::regprocedure);

  if position('google_play_token:' in def_core) = 0 or position('google_play_token:' in def_batch) = 0 then
    raise exception 'S13 batch must lock the same purchase-token key as the single-cycle RPC';
  end if;
  if position('google_play_order:' in def_core) = 0 or position('google_play_order:' in def_batch) = 0 then
    raise exception 'S13 batch must lock the same external-order keys as the single-cycle RPC';
  end if;
  if position('pg_advisory_xact_lock' in def_batch) = 0 then
    raise exception 'S13 batch RPC does not acquire advisory locks';
  end if;

  v := public.reconcile_google_play_renewal_batch(
    p_rtdn_event_id  => null::uuid,
    p_rtdn_attempt   => null::integer,
    p_profile_id     => t.profile_id,
    p_institute_id   => t.institute_id,
    p_student_id     => t.student_id,
    p_plan_id        => t.plan_id,
    p_course_id      => t.plan_course_id,
    p_product_id     => 'test_sku_217',
    p_purchase_token => t.token,
    p_orders         => jsonb_build_array(
      jsonb_build_object(
        'order_id', t.base_order || '..10', 'cycle_index', 10,
        'unit_price', t.plan_price, 'currency', 'INR',
        'transaction_timestamp', '2026-10-26T00:00:00Z',
        'subscription_end_date', '2027-09-25', 'is_auto_renew', true,
        'gateway_response', jsonb_build_object('verified', true, 'verification_source', 'orders_api', 'verified_order_id', t.base_order || '..10')
      ),
      jsonb_build_object(
        'order_id', t.base_order || '..11', 'cycle_index', 11,
        'unit_price', t.plan_price, 'currency', 'INR',
        'transaction_timestamp', '2026-10-26T00:00:00Z',
        'subscription_end_date', '2027-10-25', 'is_auto_renew', true,
        'gateway_response', jsonb_build_object('verified', true, 'verification_source', 'orders_api', 'verified_order_id', t.base_order || '..11')
      )
    ),
    p_metadata       => jsonb_build_object('source', 'test_217')
  );

  if (v->>'success')::boolean is not true then
    raise exception 'S13 batch expected success, got %', v;
  end if;

  select count(*) into cnt from public.payments
  where gateway = 'google_play' and gateway_payment_id in (t.base_order || '..10', t.base_order || '..11');
  if cnt <> 2 then raise exception 'S13 expected 2 batch payments, got %', cnt; end if;

  select p.order_id into o11 from public.payments p where p.gateway_payment_id = t.base_order || '..11';

  select * into sub from public.student_subscriptions
  where student_id = t.student_id and plan_id = t.plan_id order by created_at desc limit 1;
  if sub.end_date <> '2027-10-25'::date then
    raise exception 'S13 batch end_date expected 2027-10-25, got %', sub.end_date;
  end if;
  if sub.order_id <> o11 then
    raise exception 'S13 batch must link the highest cycle internal order';
  end if;
end
$t$;

-- ── S14: a rejected batch writes nothing and never fabricates a payment ────
do $t$
declare
  t record; v jsonb; cnt int; end_before date; end_after date;
begin
  select * into t from _gp_test;

  select end_date into end_before from public.student_subscriptions
  where student_id = t.student_id and plan_id = t.plan_id order by created_at desc limit 1;

  v := public.reconcile_google_play_renewal_batch(
    p_rtdn_event_id  => null::uuid,
    p_rtdn_attempt   => null::integer,
    p_profile_id     => t.profile_id,
    p_institute_id   => t.institute_id,
    p_student_id     => t.student_id,
    p_plan_id        => t.plan_id,
    p_course_id      => t.plan_course_id,
    p_product_id     => 'test_sku_217',
    p_purchase_token => t.token,
    p_orders         => jsonb_build_array(
      jsonb_build_object(
        'order_id', t.base_order || '..12', 'cycle_index', 12,
        'currency', 'INR',
        'transaction_timestamp', '2026-10-26T00:00:00Z',
        'subscription_end_date', '2027-11-25', 'is_auto_renew', true,
        'gateway_response', jsonb_build_object('verified', true, 'verification_source', 'orders_api', 'verified_order_id', t.base_order || '..12')
      )
    ),
    p_metadata       => jsonb_build_object('source', 'test_217')
  );

  if (v->>'success')::boolean is not false then
    raise exception 'S14 batch rejection expected success=false, got %', v;
  end if;
  if v->>'code' is distinct from 'MISSING_UNIT_PRICE' then
    raise exception 'S14 expected MISSING_UNIT_PRICE, got %', v->>'code';
  end if;

  select count(*) into cnt from public.payments
  where gateway = 'google_play' and gateway_payment_id = t.base_order || '..12';
  if cnt <> 0 then raise exception 'S14 rejected batch created % payments', cnt; end if;

  if exists (
    select 1 from public.orders o
    where o.profile_id = t.profile_id
      and (o.notes::jsonb ->> 'orderId') = t.base_order || '..12'
  ) then
    raise exception 'S14 rejected batch created an orphan order';
  end if;

  select end_date into end_after from public.student_subscriptions
  where student_id = t.student_id and plan_id = t.plan_id order by created_at desc limit 1;
  if end_after is distinct from end_before then
    raise exception 'S14 rejected batch changed entitlement: % -> %', end_before, end_after;
  end if;
end
$t$;

-- ── S15: exactly one captured payment per external renewal order ───────────
do $t$
declare
  t record; dup int; total int;
begin
  select * into t from _gp_test;

  select count(*) into total from public.payments
  where gateway = 'google_play'
    and (gateway_payment_id like t.base_order || '%' or gateway_order_id like t.base_order || '%');

  -- original purchase + ..0 + ..1 + ..2 + ..3 + ..4 + ..5 + ..6 + ..7 + ..8 + ..10 + ..11
  if total <> 12 then
    raise exception 'S15 expected 12 ledgered orders for this throwaway family, got %', total;
  end if;

  select count(*) into dup from (
    select coalesce(gateway_payment_id, gateway_order_id) as ext_order
    from public.payments
    where gateway = 'google_play'
      and (gateway_payment_id like t.base_order || '%' or gateway_order_id like t.base_order || '%')
    group by 1
    having count(*) > 1
  ) d;
  if dup <> 0 then
    raise exception 'S15 % external orders carry more than one captured payment', dup;
  end if;
end
$t$;

rollback;
