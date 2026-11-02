-- ============================================================================
-- Migration 218: Fix Google Play RTDN State Transition & Reconciliation Enum Types
--
-- PURPOSE:
-- Forward migration to correct production defect in public.apply_google_play_rtdn_state_transition:
--   "Database state transition RPC failed: column \"status\" is of type
--    subscription_status_type but expression is of type text"
--
-- ROOT CAUSE:
-- In migration 216, public.apply_google_play_rtdn_state_transition declared:
--   p_mapped_status text, p_mapped_reason text, v_sub_status text
-- and directly assigned "status = p_mapped_status" in step 5, and inserted
-- (v_sub_status, p_mapped_status, p_mapped_reason) into public.subscription_history
-- in step 6. PostgreSQL PL/pgSQL does not have an implicit assignment cast from text
-- to user-defined enums (public.subscription_status_type and public.subscription_change_reason_type),
-- causing SQLSTATE 42804 on non-renewal lifecycle transitions (such as SUBSCRIPTION_CANCELED
-- notification type 3 and SUBSCRIPTION_EXPIRED notification type 13).
--
-- In addition:
-- 1. In reconcile_google_play_renewal_batch, v_sub_status was declared as text, and
--    step 9 inserted change_reason = 'renewal_reconciliation' which is not a valid
--    enum value in subscription_change_reason_type (valid value is 'renewal'), and
--    attempted history insert when status was already 'active', violating check constraint
--    ck_subscription_history_status_change check (status_before is null or status_before != status_after).
-- 2. In complete_google_play_purchase, v_existing_sub_status was declared as text
--    and inserted into subscription_history.status_before (subscription_status_type).
--
-- CORRECTIONS IN THIS FORWARD MIGRATION:
-- 1. public.apply_google_play_rtdn_state_transition:
--    - Declares strongly-typed enum variables:
--        v_sub_status public.subscription_status_type;
--        v_target_status public.subscription_status_type;
--        v_change_reason public.subscription_change_reason_type;
--    - Strictly validates and casts p_mapped_status and p_mapped_reason with graceful
--      error handling returning structured code 'INVALID_STATUS' / 'INVALID_CHANGE_REASON'.
--    - Assigns status = v_target_status on public.student_subscriptions.
--    - Inserts into subscription_history only on genuine status change (v_sub_status is distinct from v_target_status).
--    - Preserves ck_student_subscriptions_cancelled_at: cancelled_at is set if and only if status = 'cancelled'.
--    - Preserves ck_student_subscriptions_grace_status & ck_student_subscriptions_grace_end_date:
--      defensively ensures grace_end_date >= end_date if transitioning to 'grace'.
--    - Preserves access until verified expiry for cancellations, and revokes entitlement on expiry.
--    - Preserves idempotent execution for repeated RTDN deliveries.
-- 2. public.reconcile_google_play_renewal_batch:
--    - Strongly types v_sub_status public.subscription_status_type.
--    - Changes change_reason to 'renewal'::public.subscription_change_reason_type.
--    - Enforces ck_subscription_history_status_change by inserting history only when
--      v_sub_status is distinct from 'active'.
-- 3. public.complete_google_play_purchase:
--    - Strongly types v_existing_sub_status public.subscription_status_type := null.
--
-- PRESERVED INVARIANTS:
-- - Exact function signatures, parameters, default values, and return types preserved.
-- - SECURITY DEFINER, search_path = public, pg_temp preserved.
-- - REVOKE ALL FROM PUBLIC, anon, authenticated and GRANT EXECUTE TO service_role strictly re-issued.
-- - NO data backfill, NO replay, NO DDL changes to tables.
-- ============================================================================

-- SECTION 1: complete_google_play_purchase (Typed status_before enum)

create or replace function public.complete_google_play_purchase(
    p_profile_id uuid,
    p_institute_id uuid,
    p_student_id uuid,
    p_item_type text, -- 'course', 'subscription_plan', 'pyq_package'
    p_course_id uuid default null,
    p_plan_id uuid default null,
    p_package_id uuid default null,
    p_item_name text default 'Educational Product',
    p_unit_price numeric default 0.00,
    p_effective_order_id text default null,
    p_purchase_token text default null,
    p_product_id text default null,
    p_gateway_response jsonb default null,
    p_transaction_timestamp timestamptz default now(),
    p_subscription_end_date date default null,
    p_is_auto_renew boolean default true,
    p_billing_name text default null,
    p_billing_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_role text;
  -- RTDN ledger lease verification variables
  v_current_rtdn_attempts integer := null;
  v_current_rtdn_status text := null;
  -- Explicitly typed payment variables & presence flag (eliminates untyped RECORD & SQLSTATE 55000)
  v_existing_payment_id uuid := null;
  v_existing_order_id uuid := null;
  v_existing_payment_profile_id uuid := null;
  v_existing_gateway_payment_id text := null;
  v_existing_gateway_order_id text := null;
  v_has_existing_payment boolean := false;
  v_is_historical_reconciliation boolean := false;
  -- Cycle-exact idempotency state (Migration 217)
  v_has_authoritative_order_id boolean := false;
  v_recorded_max_cycle integer := -1;
  v_token_payment_id uuid := null;
  v_token_order_id uuid := null;
  v_token_profile_id uuid := null;
  v_token_gateway_payment_id text := null;
  v_token_gateway_order_id text := null;
  v_payment_id uuid := null;
  v_incoming_cycle integer := null;
  v_existing_linked_order_cycle integer := null;
  -- Orders API proof validation for delayed/older renewal cycles (Migration 217)
  v_verified_amount_txt text := null;
  v_verified_expiry_txt text := null;
  v_older_cycle_proof_ok boolean := false;

  -- Explicitly typed order item variables
  v_existing_item_id uuid := null;
  v_existing_item_type public.item_type := null;
  v_existing_item_course_id uuid := null;
  v_existing_item_plan_id uuid := null;
  v_existing_item_package_id uuid := null;

  v_order_id uuid;
  v_item_id uuid;
  v_order_notes jsonb;
  v_student_id uuid;
  v_profile_role public.user_role;
  v_profile_institute_id uuid;
  v_resolved_institute_id uuid;
  v_effective_course_id uuid;

  -- Explicitly typed catalog lookup variables
  v_plan_plan_id uuid := null;
  v_plan_course_id uuid := null;
  v_plan_days integer := null;
  v_plan_institute_id uuid := null;

  v_course_course_id uuid := null;
  v_course_institute_id uuid := null;

  v_package_package_id uuid := null;
  v_package_institute_id uuid := null;

  v_enrollment_no varchar(50);

  -- Explicitly typed subscription lookup variables
  v_existing_sub_id uuid := null;
  v_existing_sub_status public.subscription_status_type := null;
  v_existing_sub_end_date date := null;
  v_existing_sub_order_id uuid := null;

  -- Explicitly typed course enrollment lookup variables
  v_existing_enrollment_id uuid := null;
  v_existing_enrollment_type text := null;
  v_target_enrollment_type text;
  v_entitlement text := '';
  v_entitlement_active boolean := false;
  v_skip_payment_insert boolean := false;
  v_year text;
  v_invoice_num text;

  -- Advisory lock keys for safe, deadlock-free serialization across both identifiers
  v_token_lock_key bigint := null;
  v_order_lock_key bigint := null;
  v_first_lock_key bigint;
  v_second_lock_key bigint;

  -- Date calculation variables (aligning with system_settings & Razorpay policy)
  v_grace_days int := 7;
  v_content_access_days int := 30;
  v_start_date date;
  v_calculated_end_date date;
  v_grace_end_date date;
  v_content_access_end_date date;
  v_plan_duration_days int := 30;
begin
  -- 0. Security Guard: Only service_role (Edge Function backend) may execute this RPC
  v_caller_role := auth.role();
  if v_caller_role is distinct from 'service_role' then
    return jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: complete_google_play_purchase requires service_role privileges',
      'code', 'FORBIDDEN'
    );
  end if;

  -- Initialize transaction reference date for consistent date and renewal calculations
  v_start_date := (p_transaction_timestamp at time zone 'utc')::date;

  -- 1. Global Advisory Lock: Serialize concurrent verification requests sharing purchase token or order ID
  -- Prevents race conditions across concurrent requests (both same-profile and cross-profile replays).
  -- Locks BOTH identifiers if provided. Locks are acquired in strict ascending numerical order
  -- (least then greatest) to provably eliminate deadlocks across concurrent transactions.
  -- Locks are transaction-scoped and released automatically on commit or rollback.
  if p_purchase_token is not null and p_purchase_token <> '' then
    v_token_lock_key := hashtext('google_play_token:' || p_purchase_token);
  end if;

  if p_effective_order_id is not null and p_effective_order_id <> '' then
    v_order_lock_key := hashtext('google_play_order:' || p_effective_order_id);
  end if;

  if v_token_lock_key is not null and v_order_lock_key is not null then
    if v_token_lock_key = v_order_lock_key then
      perform pg_advisory_xact_lock(v_token_lock_key);
    else
      v_first_lock_key := least(v_token_lock_key, v_order_lock_key);
      v_second_lock_key := greatest(v_token_lock_key, v_order_lock_key);
      perform pg_advisory_xact_lock(v_first_lock_key);
      perform pg_advisory_xact_lock(v_second_lock_key);
    end if;
  elsif v_token_lock_key is not null then
    perform pg_advisory_xact_lock(v_token_lock_key);
  elsif v_order_lock_key is not null then
    perform pg_advisory_xact_lock(v_order_lock_key);
  end if;

  -- 1b. Durable RTDN Event Ledger Ownership Verification:
  -- If called from RTDN webhook with ledger fencing tokens, verify active lease ownership
  -- within the same transaction as payment recording and subscription renewal.
  if p_gateway_response is not null and (p_gateway_response->>'rtdn_event_id') is not null and coalesce(p_gateway_response->>'defer_rtdn_completion', 'false') != 'true' then
    select attempts, processing_status
    into v_current_rtdn_attempts, v_current_rtdn_status
    from public.google_play_rtdn_events
    where event_id = (p_gateway_response->>'rtdn_event_id')::uuid
    for update;

    if not found or v_current_rtdn_attempts != (p_gateway_response->>'rtdn_attempt')::integer or v_current_rtdn_status != 'processing' then
      return jsonb_build_object(
        'success', false,
        'action', 'abort_stale_worker',
        'error', 'STALE_LEASE_LOST: RTDN event lease ownership was lost to another worker',
        'code', 'STALE_LEASE_LOST'
      );
    end if;
  end if;

  -- 2. Validate Profile Existence and Lock Profile Row (Concurrency / Anti-Race)
  select p.role, p.institute_id
  into v_profile_role, v_profile_institute_id
  from public.profiles p
  where p.profile_id = p_profile_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'error', 'User profile not found for profile_id ' || coalesce(p_profile_id::text, 'null'),
      'code', 'PROFILE_NOT_FOUND'
    );
  end if;

  -- 3. Staff Role Protection: Strictly reject teacher, admin, and super_admin
  -- Must be executed before any idempotency return to prevent staff accounts from claiming purchases.
  -- SCHEMA ALIGNMENT (Migration 207): public.admin_roles uses access_status (enum public.admin_access_status).
  -- Active, authorized administrative status is strictly 'approved'.
  if v_profile_role::text not in ('user', 'student')
     or exists (
       select 1
       from public.admin_roles ar
       where ar.profile_id = p_profile_id
         and ar.access_status = 'approved'::public.admin_access_status
     )
     or exists (
       select 1
       from public.teacher_details td
       where td.profile_id = p_profile_id
     ) then
    return jsonb_build_object(
      'success', false,
      'error', 'Profile role ''' || v_profile_role::text || ''' is not eligible for student checkout. Staff accounts cannot be converted to students.',
      'code', 'FORBIDDEN_ROLE'
    );
  end if;

  -- 4. Multi-Tenant Institute Validation
  if p_institute_id is not null and v_profile_institute_id is not null and p_institute_id <> v_profile_institute_id then
    return jsonb_build_object(
      'success', false,
      'error', 'Institute mismatch: requested institute does not match profile institute.',
      'code', 'INSTITUTE_MISMATCH'
    );
  end if;
  v_resolved_institute_id := coalesce(v_profile_institute_id, p_institute_id);

  -- 5. Product & Association Integrity Validation BEFORE Mutations
  v_effective_course_id := p_course_id;

  if p_item_type = 'subscription_plan' then
    if p_plan_id is null then
      return jsonb_build_object(
        'success', false,
        'error', 'p_plan_id is required for subscription_plan purchase.',
        'code', 'INVALID_PURCHASE_PAYLOAD'
      );
    end if;

    select sp.plan_id, sp.course_id, sp.duration_days, sp.institute_id
    into v_plan_plan_id, v_plan_course_id, v_plan_days, v_plan_institute_id
    from public.subscription_plans sp
    where sp.plan_id = p_plan_id;

    if v_plan_plan_id is null then
      return jsonb_build_object(
        'success', false,
        'error', 'Subscription plan not found for plan_id ' || p_plan_id::text,
        'code', 'PLAN_NOT_FOUND'
      );
    end if;

    -- Plan tenant validation: Subscription plans are strictly institute-scoped
    if v_resolved_institute_id is null or v_plan_institute_id is null or v_plan_institute_id <> v_resolved_institute_id then
      return jsonb_build_object(
        'success', false,
        'error', 'Subscription plan does not belong to the user''s institute.',
        'code', 'INSTITUTE_MISMATCH'
      );
    end if;

    -- Validate that subscription plan is course-scoped per Migration 090
    if v_plan_course_id is null then
      return jsonb_build_object(
        'success', false,
        'error', 'Subscription plan ' || p_plan_id::text || ' is not associated with any course. All subscription plans must be course-scoped per database schema.',
        'code', 'COURSE_PLAN_MISMATCH'
      );
    end if;

    if v_effective_course_id is not null and v_effective_course_id <> v_plan_course_id then
      return jsonb_build_object(
        'success', false,
        'error', 'Subscription plan course association mismatch: plan course (' || v_plan_course_id::text || ') does not match purchase course (' || v_effective_course_id::text || ').',
        'code', 'COURSE_PLAN_MISMATCH'
      );
    elsif v_effective_course_id is null then
      v_effective_course_id := v_plan_course_id;
    end if;

    -- Validate course existence and institute ownership (course-scoped)
    select c.course_id, c.institute_id
    into v_course_course_id, v_course_institute_id
    from public.courses c
    where c.course_id = v_effective_course_id;

    if v_course_course_id is null then
      return jsonb_build_object(
        'success', false,
        'error', 'Course not found for course_id ' || v_effective_course_id::text,
        'code', 'COURSE_NOT_FOUND'
      );
    end if;

    -- Course tenant validation: Courses are strictly institute-scoped
    if v_resolved_institute_id is null or v_course_institute_id is null or v_course_institute_id <> v_resolved_institute_id then
      return jsonb_build_object(
        'success', false,
        'error', 'Course does not belong to the user''s institute.',
        'code', 'INSTITUTE_MISMATCH'
      );
    end if;

    -- Both plan and course must belong to the same institute
    if v_plan_institute_id <> v_course_institute_id then
      return jsonb_build_object(
        'success', false,
        'error', 'Subscription plan and associated course belong to different institutes.',
        'code', 'INSTITUTE_MISMATCH'
      );
    end if;

    if v_plan_days is not null and v_plan_days > 0 then
      v_plan_duration_days := v_plan_days;
    end if;

  elsif p_item_type = 'course' then
    if v_effective_course_id is null then
      return jsonb_build_object(
        'success', false,
        'error', 'p_course_id is required for course purchase.',
        'code', 'INVALID_PURCHASE_PAYLOAD'
      );
    end if;

    select c.course_id, c.institute_id
    into v_course_course_id, v_course_institute_id
    from public.courses c
    where c.course_id = v_effective_course_id;

    if v_course_course_id is null then
      return jsonb_build_object(
        'success', false,
        'error', 'Course not found for course_id ' || v_effective_course_id::text,
        'code', 'COURSE_NOT_FOUND'
      );
    end if;

    -- Course tenant validation: Courses are strictly institute-scoped
    if v_resolved_institute_id is null or v_course_institute_id is null or v_course_institute_id <> v_resolved_institute_id then
      return jsonb_build_object(
        'success', false,
        'error', 'Course does not belong to the user''s institute.',
        'code', 'INSTITUTE_MISMATCH'
      );
    end if;

  elsif p_item_type = 'pyq_package' then
    if p_package_id is null then
      return jsonb_build_object(
        'success', false,
        'error', 'p_package_id is required for pyq_package purchase.',
        'code', 'INVALID_PURCHASE_PAYLOAD'
      );
    end if;

    select pp.package_id, pp.institute_id
    into v_package_package_id, v_package_institute_id
    from public.pyq_packages pp
    where pp.package_id = p_package_id;

    if v_package_package_id is null then
      return jsonb_build_object(
        'success', false,
        'error', 'PYQ package not found for package_id ' || p_package_id::text,
        'code', 'PACKAGE_NOT_FOUND'
      );
    end if;

    -- PYQ package tenant validation: PYQ packages are strictly institute-scoped
    if v_resolved_institute_id is null or v_package_institute_id is null or v_package_institute_id <> v_resolved_institute_id then
      return jsonb_build_object(
        'success', false,
        'error', 'PYQ package does not belong to the user''s institute.',
        'code', 'INSTITUTE_MISMATCH'
      );
    end if;
  else
    return jsonb_build_object(
      'success', false,
      'error', 'Invalid item_type ''' || coalesce(p_item_type, 'null') || '''. Must be course, subscription_plan, or pyq_package.',
      'code', 'INVALID_ITEM_TYPE'
    );
  end if;

  -- 6. Defensively resolve existing student_details record strictly scoped to p_profile_id
  select sd.student_id into v_student_id
  from public.student_details sd
  where sd.profile_id = p_profile_id;

  -- Validate caller-supplied student_id: MUST belong to p_profile_id (prevent cross-profile hijacking)
  if p_student_id is not null then
    if v_student_id is not null and v_student_id <> p_student_id then
      return jsonb_build_object(
        'success', false,
        'error', 'Supplied student_id does not match the profile''s existing student record.',
        'code', 'STUDENT_PROFILE_MISMATCH'
      );
    elsif v_student_id is null then
      if exists (select 1 from public.student_details sd where sd.student_id = p_student_id and sd.profile_id <> p_profile_id) then
        return jsonb_build_object(
          'success', false,
          'error', 'Supplied student_id belongs to a different user account.',
          'code', 'STUDENT_PROFILE_MISMATCH'
        );
      end if;
    end if;
  end if;

  -- 7. Cycle-exact idempotency resolution (Migration 217)
  -- "Already processed" means ONLY: a captured payment exists for this exact external
  -- Google Play order ID. Google Play reuses one purchaseToken for every renewal cycle
  -- (..0, ..1, ..2, ...), so a token match alone must never suppress a renewal.
  v_has_authoritative_order_id := (
    p_effective_order_id is not null
    and btrim(p_effective_order_id) <> ''
    and p_effective_order_id not like 'GPA.SUB.%'
  );

  v_incoming_cycle := case
    when v_has_authoritative_order_id and p_effective_order_id ~ '[.][.][0-9]+$'
      then substring(p_effective_order_id from '[.][.]([0-9]+)$')::integer
    when v_has_authoritative_order_id then -1
    else null
  end;

  -- 7a. Token-scoped lookup: used only for cross-account replay detection and legacy callers.
  select p.payment_id, p.order_id, o.profile_id, p.gateway_payment_id, p.gateway_order_id
  into v_token_payment_id, v_token_order_id, v_token_profile_id, v_token_gateway_payment_id, v_token_gateway_order_id
  from public.payments p
  join public.orders o on o.order_id = p.order_id
  where p.gateway = 'google_play'
    and p.status = 'captured'
    and p_purchase_token is not null
    and (
      (p.gateway_response ->> 'purchaseToken') = p_purchase_token
      or substring(o.notes from '"purchaseToken"[[:space:]]*:[[:space:]]*"([^"]+)"') = p_purchase_token
    )
  order by p.created_at desc
  limit 1;

  -- 7b. Cross-account replay protection applies to every cycle (initial purchase and renewals).
  if v_token_payment_id is not null and v_token_profile_id <> p_profile_id then
    return jsonb_build_object(
      'success', false,
      'error', 'This purchase has already been claimed by another account. Please sign in with the original account or contact support.',
      'code', 'ACCOUNT_MISMATCH'
    );
  end if;

  -- 7c. The only definition of "already processed": this exact external order ID is recorded.
  select p.payment_id, p.order_id, o.profile_id, p.gateway_payment_id, p.gateway_order_id
  into v_existing_payment_id, v_existing_order_id, v_existing_payment_profile_id, v_existing_gateway_payment_id, v_existing_gateway_order_id
  from public.payments p
  join public.orders o on o.order_id = p.order_id
  where p.gateway = 'google_play'
    and p.status = 'captured'
    and v_has_authoritative_order_id
    and (p.gateway_payment_id = p_effective_order_id or p.gateway_order_id = p_effective_order_id)
  order by p.created_at desc
  limit 1;

  if v_existing_payment_id is not null then
    if v_existing_payment_profile_id <> p_profile_id then
      return jsonb_build_object(
        'success', false,
        'error', 'This purchase has already been claimed by another account. Please sign in with the original account or contact support.',
        'code', 'ACCOUNT_MISMATCH'
      );
    end if;
    v_has_existing_payment := true;
  elsif p_item_type <> 'subscription_plan' then
    -- Legacy one-shot idempotency for course / package purchases: a token match is authoritative.
    v_existing_payment_id := v_token_payment_id;
    v_existing_order_id := v_token_order_id;
    v_existing_payment_profile_id := v_token_profile_id;
    v_existing_gateway_payment_id := v_token_gateway_payment_id;
    v_existing_gateway_order_id := v_token_gateway_order_id;
    v_has_existing_payment := (v_existing_payment_id is not null);
  else
    -- Subscription without a payment for this exact external order ID:
    -- first-time purchase, new renewal cycle, or delayed/older verified cycle.
    if not v_has_authoritative_order_id and v_token_payment_id is not null then
      -- Token already has a payment but no authoritative order ID is available: refuse to guess.
      -- No writes; the caller must record reconciliation instead of completion.
      return jsonb_build_object(
        'success', true,
        'verified', false,
        'outcome', 'reconciliation_required',
        'reason', 'AMBIGUOUS_ORDER_ID',
        'orderId', v_token_order_id,
        'message', 'Subscription purchase without an authoritative Google Play order ID; manual reconciliation required'
      );
    end if;

    -- A renewal cycle must carry verified Google Play expiry evidence before any write.
    if v_incoming_cycle is not null and v_incoming_cycle >= 0 and p_subscription_end_date is null then
      return jsonb_build_object(
        'success', true,
        'verified', false,
        'outcome', 'reconciliation_required',
        'reason', 'EXPIRY_MISSING',
        'orderId', p_effective_order_id,
        'cycleIndex', v_incoming_cycle,
        'message', 'Renewal cycle has no verified Google Play expiry; manual reconciliation required'
      );
    end if;

    -- Highest cycle already recorded for this purchase token (initial purchase = -1).
    select coalesce(max(
             case
               when p.gateway_payment_id ~ '[.][.][0-9]+$'
                 then substring(p.gateway_payment_id from '[.][.]([0-9]+)$')::integer
               else -1
             end
           ), -1)
    into v_recorded_max_cycle
    from public.payments p
    join public.orders o on o.order_id = p.order_id
    where p.gateway = 'google_play'
      and p.status = 'captured'
      and p_purchase_token is not null
      and (
        (p.gateway_response ->> 'purchaseToken') = p_purchase_token
        or substring(o.notes from '"purchaseToken"[[:space:]]*:[[:space:]]*"([^"]+)"') = p_purchase_token
      );

    if v_incoming_cycle is not null
       and v_incoming_cycle >= 0
       and v_incoming_cycle <= v_recorded_max_cycle then
      -- Delayed or older verified cycle: record the ledger row, never move entitlement backwards.
      v_is_historical_reconciliation := true;

      -- Migration 217 (defect B1): a backfill is legal ONLY when the caller supplies proof that
      -- THIS EXACT external order was verified against the Google Play Orders API. Cycle ordering
      -- plus current subscription state is NEVER evidence that an older cycle was paid.
      --
      -- The proof must be self-consistent with the row about to be written, so a bare order-id
      -- claim cannot create a ledger entry: identifying order id, source = orders_api, INR
      -- currency, a numeric verified amount equal to p_unit_price, and a verified expiry equal
      -- to p_subscription_end_date (which is itself never allowed to reduce entitlement).
      -- PostgreSQL cannot call Google, so the trust boundary is that only service_role may invoke
      -- this function and the Edge Function is the sole writer of these fields.
      -- Nothing has been written at this point, so rejecting here creates no order and no payment.
      v_verified_amount_txt := nullif(btrim(coalesce(p_gateway_response->>'verified_amount', '')), '');
      v_verified_expiry_txt := nullif(btrim(coalesce(p_gateway_response->>'verified_expiry', '')), '');
      v_older_cycle_proof_ok := false;

      begin
        if p_gateway_response is not null
           and (p_gateway_response->>'verification_source') = 'orders_api'
           and (p_gateway_response->>'verified_order_id') = p_effective_order_id
           and upper(coalesce(btrim(p_gateway_response->>'currency'), '')) = 'INR'
           and v_verified_amount_txt ~ '^[0-9]+([.][0-9]+)?$'
           and v_verified_expiry_txt ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
           and v_verified_amount_txt::numeric = p_unit_price
           and v_verified_expiry_txt::date = p_subscription_end_date then
          v_older_cycle_proof_ok := true;
        end if;
      exception when others then
        -- Malformed proof (e.g. an impossible calendar date) is treated as no proof at all.
        v_older_cycle_proof_ok := false;
      end;

      if not v_older_cycle_proof_ok then
        return jsonb_build_object(
          'success', true,
          'verified', false,
          'outcome', 'reconciliation_required',
          'reason', 'OLDER_CYCLE_UNVERIFIED',
          'orderId', p_effective_order_id,
          'cycleIndex', v_incoming_cycle,
          'message', 'Older renewal cycle lacks authoritative Orders API proof (exact order id, amount, expiry, currency); no order or payment was created'
        );
      end if;
    end if;
  end if;

  if v_has_existing_payment then
    -- Load existing order item to verify consistency
    select oi.item_id, oi.item_type, oi.course_id, oi.plan_id, oi.package_id
    into v_existing_item_id, v_existing_item_type, v_existing_item_course_id, v_existing_item_plan_id, v_existing_item_package_id
    from public.order_items oi
    where oi.order_id = v_existing_order_id
    limit 1;

    if v_existing_item_id is null then
      return jsonb_build_object(
        'success', false,
        'error', 'Existing payment has no associated order items. Failing closed to prevent inconsistent order state.',
        'code', 'ORDER_ITEM_MISSING_FOR_CAPTURED_PAYMENT',
        'orderId', v_existing_order_id
      );
    end if;

    if v_existing_item_type::text <> p_item_type then
      return jsonb_build_object(
        'success', false,
        'error', 'Existing order item type (' || v_existing_item_type::text || ') does not match purchase item type (' || p_item_type || ').',
        'code', 'ORDER_ITEM_MISMATCH',
        'orderId', v_existing_order_id
      );
    end if;

    if p_item_type = 'course' then
      if v_existing_item_course_id is distinct from v_effective_course_id then
        return jsonb_build_object(
          'success', false,
          'error', 'Existing order item course_id does not match purchase course_id.',
          'code', 'ORDER_ITEM_MISMATCH',
          'orderId', v_existing_order_id
        );
      end if;
    elsif p_item_type = 'subscription_plan' then
      if v_existing_item_plan_id is distinct from p_plan_id
         or (v_existing_item_course_id is distinct from v_effective_course_id) then
        return jsonb_build_object(
          'success', false,
          'error', 'Existing order item plan_id or course_id does not match purchase specifications.',
          'code', 'ORDER_ITEM_MISMATCH',
          'orderId', v_existing_order_id
        );
      end if;
    elsif p_item_type = 'pyq_package' then
      if v_existing_item_package_id is distinct from p_package_id then
        return jsonb_build_object(
          'success', false,
          'error', 'Existing order item package_id does not match purchase package_id.',
          'code', 'ORDER_ITEM_MISMATCH',
          'orderId', v_existing_order_id
        );
      end if;
    end if;

    -- Check if entitlement is currently active for this student
    v_entitlement_active := false;
    if v_student_id is not null then
      if p_item_type = 'course' then
        select exists (
          select 1 from public.course_enrollments
          where course_id = v_effective_course_id
            and student_id = v_student_id
            and is_active = true
        ) into v_entitlement_active;
      elsif p_item_type = 'subscription_plan' then
        select exists (
          select 1 from public.student_subscriptions
          where student_id = v_student_id
            and plan_id = p_plan_id
            and status in ('active', 'grace')
        ) into v_entitlement_active;
      elsif p_item_type = 'pyq_package' then
        select exists (
          select 1 from public.student_pyq_purchases
          where package_id = p_package_id
            and student_id = v_student_id
            and is_active = true
        ) into v_entitlement_active;
      end if;
    end if;

    -- If payment, order item, and active entitlement all exist consistently:
    -- Ensure role transition is applied if profile is still role = 'user'
    -- before returning idempotent success.
    if v_entitlement_active then
      if v_profile_role::text = 'user' then
        update public.profiles
        set role = 'student'::public.user_role,
            updated_at = p_transaction_timestamp
        where profile_id = p_profile_id;
        v_profile_role := 'student'::public.user_role;
      end if;

      if p_gateway_response is not null and (p_gateway_response->>'rtdn_event_id') is not null and coalesce(p_gateway_response->>'defer_rtdn_completion', 'false') != 'true' then
        update public.google_play_rtdn_events
        set processing_status = 'completed',
            order_id = p_effective_order_id,
            cycle_index = coalesce(substring(p_effective_order_id from '\.\.([0-9]+)')::integer, 0),
            processed_at = clock_timestamp(),
            error_message = null
        where event_id = (p_gateway_response->>'rtdn_event_id')::uuid
          and attempts = v_current_rtdn_attempts;
      end if;

      return jsonb_build_object(
        'success', true,
        'verified', true,
        'outcome', 'already_recorded',
        'alreadyProcessed', true,
        'paymentId', v_existing_payment_id,
        'orderId', v_existing_order_id,
        'cycleIndex', case when p_effective_order_id ~ '\.\.[0-9]+$' then substring(p_effective_order_id from '\.\.([0-9]+)$')::integer else -1 end,
        'rtdn_completed', (p_gateway_response is not null and (p_gateway_response->>'rtdn_event_id') is not null),
        'message', 'Purchase already processed and entitlement active'
      );
    end if;

    -- For subscriptions: if the existing subscription is expired or ended,
    -- or if the subscription record exists but its entitlement has lapsed,
    -- do NOT fabricate a new renewal period or extend the subscription.
    if p_item_type = 'subscription_plan' and v_student_id is not null then
      select ss.subscription_id, ss.status, ss.end_date
      into v_existing_sub_id, v_existing_sub_status, v_existing_sub_end_date
      from public.student_subscriptions ss
      where ss.student_id = v_student_id
        and ss.plan_id = p_plan_id
      order by ss.end_date desc nulls last, ss.created_at desc
      limit 1;

      -- Case A: Subscription record exists, but is expired, ended, or has no valid end date
      if v_existing_sub_id is not null and (
        v_existing_sub_end_date is null
        or v_existing_sub_end_date < (p_transaction_timestamp at time zone 'utc')::date
        or v_existing_sub_status not in ('active', 'grace')
      ) then
        if p_gateway_response is not null and (p_gateway_response->>'rtdn_event_id') is not null and coalesce(p_gateway_response->>'defer_rtdn_completion', 'false') != 'true' then
          update public.google_play_rtdn_events
          set processing_status = 'completed',
              order_id = p_effective_order_id,
              cycle_index = coalesce(substring(p_effective_order_id from '\.\.([0-9]+)')::integer, 0),
              processed_at = clock_timestamp(),
              error_message = null
          where event_id = (p_gateway_response->>'rtdn_event_id')::uuid
            and attempts = v_current_rtdn_attempts;
        end if;

        return jsonb_build_object(
          'success', true,
          'verified', true,
          'outcome', 'already_recorded',
          'alreadyProcessed', true,
          'paymentId', v_existing_payment_id,
          'orderId', v_existing_order_id,
          'cycleIndex', case when p_effective_order_id ~ '\.\.[0-9]+$' then substring(p_effective_order_id from '\.\.([0-9]+)$')::integer else -1 end,
          'rtdn_completed', (p_gateway_response is not null and (p_gateway_response->>'rtdn_event_id') is not null),
          'message', 'Purchase already processed and entitlement expired'
        );
      end if;

      -- Case B: Subscription record is completely missing and incoming verified expiry is missing or unestablished.
      -- An existing captured payment whose entitlement was lost can only be safely repaired when verified Google expiry
      -- evidence is established. Without verified expiry evidence, the system MUST NOT proceed to Step 14
      -- and fabricate a new subscription period.
      if v_existing_sub_id is null and (
        p_subscription_end_date is null
        or p_subscription_end_date <= (p_transaction_timestamp at time zone 'utc')::date
      ) then
        return jsonb_build_object(
          'success', false,
          'error', 'Existing payment found but subscription record is missing and incoming verified expiry is missing or invalid. Refusing to fabricate entitlement.',
          'code', 'MISSING_SUBSCRIPTION_EVIDENCE',
          'orderId', v_existing_order_id
        );
      end if;
    end if;

    -- Entitlement is missing/inactive despite captured payment.
    -- Safely remediate: reuse existing order and item, skip duplicate payment insert,
    -- and proceed to ensure student role/details and grant the missing entitlement.
    v_order_id := v_existing_order_id;
    v_item_id := v_existing_item_id;
    v_skip_payment_insert := true;
  end if;

  -- 8. Check for existing unfulfilled order with this purchaseToken / orderId
  if v_order_id is null then
    select o.order_id
    into v_order_id
    from public.orders o
    where o.profile_id = p_profile_id
      and (
        (p_effective_order_id is not null and substring(o.notes from '"orderId"[[:space:]]*:[[:space:]]*"([^"]+)"') = p_effective_order_id)
        or (p_item_type <> 'subscription_plan' and p_purchase_token is not null and substring(o.notes from '"purchaseToken"[[:space:]]*:[[:space:]]*"([^"]+)"') = p_purchase_token)
        or (p_effective_order_id is null and p_purchase_token is not null and substring(o.notes from '"purchaseToken"[[:space:]]*:[[:space:]]*"([^"]+)"') = p_purchase_token)
      )
    limit 1;

    if v_order_id is not null then
      select oi.item_id, oi.item_type, oi.course_id, oi.plan_id, oi.package_id
      into v_existing_item_id, v_existing_item_type, v_existing_item_course_id, v_existing_item_plan_id, v_existing_item_package_id
      from public.order_items oi
      where oi.order_id = v_order_id
      limit 1;

      if v_existing_item_id is null then
        return jsonb_build_object(
          'success', false,
          'error', 'Existing order found for this purchase token but it has no associated order items. Failing closed to prevent partial order processing.',
          'code', 'ORDER_ITEM_MISSING_FOR_EXISTING_ORDER',
          'orderId', v_order_id
        );
      end if;

      if v_existing_item_type::text <> p_item_type then
        return jsonb_build_object(
          'success', false,
          'error', 'Existing order item type (' || v_existing_item_type::text || ') does not match purchase item type (' || p_item_type || ').',
          'code', 'ORDER_ITEM_MISMATCH',
          'orderId', v_order_id
        );
      end if;

      if p_item_type = 'course' then
        if v_existing_item_course_id is distinct from v_effective_course_id then
          return jsonb_build_object(
            'success', false,
            'error', 'Existing order item course_id does not match purchase course_id.',
            'code', 'ORDER_ITEM_MISMATCH',
            'orderId', v_order_id
          );
        end if;
      elsif p_item_type = 'subscription_plan' then
        if v_existing_item_plan_id is distinct from p_plan_id
           or (v_existing_item_course_id is distinct from v_effective_course_id) then
          return jsonb_build_object(
            'success', false,
            'error', 'Existing order item plan_id or course_id does not match purchase specifications.',
            'code', 'ORDER_ITEM_MISMATCH',
            'orderId', v_order_id
          );
        end if;
      elsif p_item_type = 'pyq_package' then
        if v_existing_item_package_id is distinct from p_package_id then
          return jsonb_build_object(
            'success', false,
            'error', 'Existing order item package_id does not match purchase package_id.',
            'code', 'ORDER_ITEM_MISMATCH',
            'orderId', v_order_id
          );
        end if;
      end if;

      v_item_id := v_existing_item_id;
    end if;
  end if;

  -- 9. Atomic Role Transition: Promote role = 'user' to 'student'
  -- Executes for ANY role = 'user', whether student_details already exists or not!
  if v_profile_role::text = 'user' then
    update public.profiles
    set role = 'student'::public.user_role,
        updated_at = p_transaction_timestamp
    where profile_id = p_profile_id;
    v_profile_role := 'student'::public.user_role;
  end if;

  -- 10. Student Details Resolution & Initialization
  if v_student_id is null then
    -- Generate enrollment number using standard sequence / generator
    begin
      v_enrollment_no := public.generate_enrollment_number(v_resolved_institute_id);
    exception when others then
      v_enrollment_no := 'ENR-' || to_char(current_date, 'YYYY') || '-' || lpad(floor(random() * 900000 + 100000)::text, 6, '0');
    end;

    -- Initialize student_details inside the transaction.
    -- Fires trigger trg_student_details_check_role -> check_student_role().
    -- With search_path = public, pg_temp, check_student_role() resolves public.user_role reliably.
    insert into public.student_details (
      profile_id,
      institute_id,
      enrollment_no,
      enrolled_on,
      created_at,
      updated_at
    ) values (
      p_profile_id,
      v_resolved_institute_id,
      v_enrollment_no,
      (p_transaction_timestamp at time zone 'utc')::date,
      p_transaction_timestamp,
      p_transaction_timestamp
    )
    on conflict (profile_id) do update
      set updated_at = p_transaction_timestamp
    returning student_id into v_student_id;
  end if;

  if v_student_id is null then
    raise exception 'Failed to resolve or initialize student_details for profile %', p_profile_id;
  end if;

  -- 11. Build structured order notes with correlation metadata
  v_order_notes := jsonb_build_object(
    'gateway', 'google_play',
    'purchaseToken', p_purchase_token,
    'orderId', p_effective_order_id,
    'productId', p_product_id,
    'itemType', p_item_type,
    'courseId', v_effective_course_id,
    'planId', p_plan_id,
    'packageId', p_package_id
  );

  -- 12. Insert Order and Order Item if new
  if v_order_id is null then
    insert into public.orders (
      institute_id,
      student_id,
      profile_id,
      status,
      currency,
      subtotal_amount,
      discount_amount,
      tax_amount,
      total_amount,
      notes,
      placed_at,
      confirmed_at,
      created_at,
      updated_at
    ) values (
      v_resolved_institute_id,
      v_student_id,
      p_profile_id,
      'confirmed',
      'INR'::public.currency_code,
      p_unit_price,
      0.00,
      0.00,
      p_unit_price,
      v_order_notes,
      p_transaction_timestamp,
      p_transaction_timestamp,
      p_transaction_timestamp,
      p_transaction_timestamp
    )
    returning order_id into v_order_id;

    -- public.order_items is an immutable ledger table that has
    -- created_at but NO updated_at column. Explicit enum casting is applied.
    insert into public.order_items (
      order_id,
      institute_id,
      item_type,
      course_id,
      plan_id,
      package_id,
      item_name,
      unit_price,
      quantity,
      discount_amount,
      line_total,
      created_at
    ) values (
      v_order_id,
      v_resolved_institute_id,
      p_item_type::public.item_type,
      v_effective_course_id,
      p_plan_id,
      p_package_id,
      p_item_name,
      p_unit_price,
      1,
      0.00,
      p_unit_price,
      p_transaction_timestamp
    )
    returning item_id into v_item_id;
  end if;

  -- 13. Insert Payment record satisfying ck_payments_paid_at (unless skipped during remediation)
  if not v_skip_payment_insert then
    insert into public.payments (
      order_id,
      institute_id,
      attempt_number,
      gateway,
      gateway_order_id,
      gateway_payment_id,
      gateway_response,
      amount,
      currency,
      status,
      paid_at,
      created_at,
      updated_at
    ) values (
      v_order_id,
      v_resolved_institute_id,
      1,
      'google_play'::public.payment_gateway,
      p_effective_order_id,
      p_effective_order_id,
      case
        when jsonb_typeof(p_gateway_response) = 'object' then
          p_gateway_response || jsonb_build_object('purchaseToken', p_purchase_token)
        else
          jsonb_build_object('purchaseToken', p_purchase_token, 'verified', true)
      end,
      p_unit_price,
      'INR'::public.currency_code,
      'captured'::public.payment_status,
      p_transaction_timestamp,
      p_transaction_timestamp,
      p_transaction_timestamp
    )
    returning payment_id into v_payment_id;
  end if;

  -- 14. Grant Entitlement
  if p_item_type = 'course' and v_effective_course_id is not null then
    insert into public.course_enrollments (
      course_id,
      student_id,
      institute_id,
      order_item_id,
      enrollment_type,
      is_active,
      enrolled_at,
      revoked_at,
      revoked_reason
    ) values (
      v_effective_course_id,
      v_student_id,
      v_resolved_institute_id,
      v_item_id,
      'purchase',
      true,
      p_transaction_timestamp,
      null,
      null
    )
    on conflict (course_id, student_id)
    do update set
      is_active = true,
      enrollment_type = 'purchase',
      order_item_id = coalesce(excluded.order_item_id, course_enrollments.order_item_id),
      revoked_at = null,
      revoked_reason = null;

    v_entitlement := 'course_enrollment:' || v_effective_course_id::text;

  elsif p_item_type = 'subscription_plan' and p_plan_id is not null then
    -- Load institute-level configuration from system_settings (defaults: 7d grace, 30d content)
    select coalesce(
      (select setting_value::int
       from public.system_settings
       where institute_id = v_resolved_institute_id
         and setting_key = 'grace_days'
         and is_active = true
       limit 1),
      7
    ) into v_grace_days;

    select coalesce(
      (select setting_value::int
       from public.system_settings
       where institute_id = v_resolved_institute_id
         and setting_key = 'content_access_days'
         and is_active = true
       limit 1),
      30
    ) into v_content_access_days;

    v_start_date := (p_transaction_timestamp at time zone 'utc')::date;

    -- Check if active or grace subscription exists (Migration 086 / 096)
    -- Also include existing rows matching start_date = v_start_date so same-day renewals/re-tests update cleanly
    select subscription_id, status, end_date, order_id
    into v_existing_sub_id, v_existing_sub_status, v_existing_sub_end_date, v_existing_sub_order_id
    from public.student_subscriptions
    where student_id = v_student_id
      and plan_id = p_plan_id
      and (
        v_is_historical_reconciliation
        or status in ('active', 'grace')
        or start_date = v_start_date
      )
    order by
      (case when v_is_historical_reconciliation then end_date else null end) desc nulls last,
      (case when status in ('active', 'grace') then 0 else 1 end) asc,
      created_at desc
    limit 1;

    -- Compute end_date, strictly satisfying ck_student_subscriptions_end_date (end_date > start_date).
    -- In Google Play License Testing / test tracks, renewal cycles are accelerated (e.g. 5-15 mins).
    -- This causes Google's expiry timestamp to fall on the exact same UTC date as start_date (end_date = start_date).
    -- If p_subscription_end_date is supplied and is strictly greater than v_start_date, use it.
    -- Otherwise, for a new payment (not v_skip_payment_insert), fall back to the plan duration (default 30 days).
    -- For an existing-payment repair (v_skip_payment_insert), NEVER extend beyond established entitlement.
    if v_is_historical_reconciliation then
      -- For historical reconciliation, preserve established future entitlement.
      -- Do NOT extend the end date by another plan duration.
      v_calculated_end_date := coalesce(v_existing_sub_end_date, p_subscription_end_date, v_calculated_end_date);
    elsif p_subscription_end_date is not null and p_subscription_end_date > v_start_date then
      v_calculated_end_date := p_subscription_end_date;
    elsif not v_skip_payment_insert and v_existing_sub_id is not null and v_existing_sub_end_date is not null and v_existing_sub_end_date >= v_start_date then
      v_calculated_end_date := (v_existing_sub_end_date + (coalesce(v_plan_duration_days, 30) || ' days')::interval)::date;
    elsif v_existing_sub_id is not null and v_existing_sub_end_date is not null and v_existing_sub_end_date > v_start_date then
      v_calculated_end_date := v_existing_sub_end_date;
    elsif not v_skip_payment_insert then
      v_calculated_end_date := (v_start_date + (coalesce(v_plan_duration_days, 30) || ' days')::interval)::date;
    else
      -- Entitlement repair without verified expiry evidence and without an established future end date
      -- MUST NOT fabricate a new renewal period. Preserve established end_date if present.
      v_calculated_end_date := v_existing_sub_end_date;
    end if;

    -- Unconditional safety invariant: end_date MUST be strictly greater than start_date
    if v_calculated_end_date is null or v_calculated_end_date <= v_start_date then
      if v_skip_payment_insert then
        return jsonb_build_object(
          'success', false,
          'error', 'Existing payment found but valid subscription end date cannot be established without verified expiry evidence.',
          'code', 'MISSING_SUBSCRIPTION_EVIDENCE',
          'orderId', v_order_id
        );
      else
        v_calculated_end_date := (v_start_date + (greatest(coalesce(v_plan_duration_days, 30), 1) || ' days')::interval)::date;
      end if;
    end if;

    v_grace_end_date := (v_calculated_end_date + (v_grace_days || ' days')::interval)::date;
    v_content_access_end_date := (v_grace_end_date + (v_content_access_days || ' days')::interval)::date;

    if v_existing_sub_id is not null then
      if v_is_historical_reconciliation then
        -- Historical reconciliation: Preserve established future entitlement and latest order reference!
        -- Do NOT roll back end_date, grace_end_date, content_access_end_date, or start_date.
        -- Update order_id ONLY IF incoming cycle is greater than or equal to existing linked order's cycle.
        if v_existing_sub_order_id is not null then
          select case
                   when p.gateway_order_id is not null then
                     coalesce(substring(p.gateway_order_id from '\.\.([0-9]+)$')::integer, -1)
                   when p.gateway_payment_id is not null and p.gateway_payment_id ~ '^GPA\.[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{5}(\.\.[0-9]+)?$' then
                     coalesce(substring(p.gateway_payment_id from '\.\.([0-9]+)$')::integer, -1)
                   else
                     -1
                 end
          into v_existing_linked_order_cycle
          from public.payments p
          where p.order_id = v_existing_sub_order_id
            and p.gateway = 'google_play'
            and p.status = 'captured'
          order by p.created_at desc
          limit 1;
        end if;

        v_existing_linked_order_cycle := coalesce(v_existing_linked_order_cycle, -1);

        update public.student_subscriptions
        set order_id = case
                         when v_incoming_cycle >= v_existing_linked_order_cycle then v_order_id
                         else order_id
                       end,
            end_date = greatest(end_date, coalesce(v_calculated_end_date, end_date)),
            grace_end_date = greatest(grace_end_date, coalesce(v_grace_end_date, grace_end_date)),
            content_access_end_date = greatest(content_access_end_date, coalesce(v_content_access_end_date, content_access_end_date)),
            updated_at = p_transaction_timestamp
        where subscription_id = v_existing_sub_id;
      else
        -- Forward renewal / normal subscription update:
        -- Monotonicity invariant (Migration 217): an already established future entitlement is
        -- never reduced by a later notification, whether it arrives out of order or carries a
        -- shorter Google expiry than the locally established window. Only the max is written.
        update public.student_subscriptions
        set order_id = v_order_id,
            status = 'active',
            start_date = v_start_date,
            end_date = greatest(coalesce(end_date, v_calculated_end_date), v_calculated_end_date),
            grace_end_date = greatest(coalesce(grace_end_date, v_grace_end_date), v_grace_end_date),
            content_access_end_date = greatest(coalesce(content_access_end_date, v_content_access_end_date), v_content_access_end_date),
            is_auto_renew = p_is_auto_renew,
            payment_method_id = p_purchase_token,
            updated_at = p_transaction_timestamp
        where subscription_id = v_existing_sub_id;

        -- Record in subscription_history only on genuine status change
        if v_existing_sub_status is distinct from 'active' then
          insert into public.subscription_history (
            subscription_id,
            student_id,
            institute_id,
            status_before,
            status_after,
            change_reason,
            occurred_at,
            metadata
          ) values (
            v_existing_sub_id,
            v_student_id,
            v_resolved_institute_id,
            v_existing_sub_status,
            'active',
            'renewal',
            p_transaction_timestamp,
            jsonb_build_object(
              'order_id', p_effective_order_id,
              'rtdn_event_id', p_gateway_response->>'rtdn_event_id'
            )
          );
        end if;
      end if;

      -- Audit in subscription_renewals
      begin
        insert into public.subscription_renewals (
          subscription_id,
          student_id,
          institute_id,
          order_id,
          attempted_at,
          succeeded_at,
          amount_charged,
          currency_code,
          payment_reference,
          new_end_date
        ) values (
          v_existing_sub_id,
          v_student_id,
          v_resolved_institute_id,
          v_order_id,
          p_transaction_timestamp,
          p_transaction_timestamp,
          p_unit_price,
          'INR'::character(3),
          p_effective_order_id,
          greatest(coalesce(v_existing_sub_end_date, v_calculated_end_date), v_calculated_end_date)
        );
      exception when others then
        -- Safe failure isolation: renewals audit table failure never aborts the committed financial transaction
        null;
      end;
    else
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
        is_auto_renew,
        payment_method_id,
        created_at,
        updated_at
      ) values (
        v_student_id,
        p_plan_id,
        v_effective_course_id,
        v_resolved_institute_id,
        v_order_id,
        'active',
        v_start_date,
        v_calculated_end_date,
        v_grace_end_date,
        v_content_access_end_date,
        p_is_auto_renew,
        p_purchase_token,
        p_transaction_timestamp,
        p_transaction_timestamp
      );
    end if;

    -- Grant course access, but preserve permanent ownership ('purchase') per Migration 096
    if v_effective_course_id is not null then
      select enrollment_id, enrollment_type::text
      into v_existing_enrollment_id, v_existing_enrollment_type
      from public.course_enrollments
      where course_id = v_effective_course_id
        and student_id = v_student_id
      limit 1;

      if v_existing_enrollment_type = 'purchase' then
        v_target_enrollment_type := 'purchase';
      else
        v_target_enrollment_type := 'subscription';
      end if;

      insert into public.course_enrollments (
        course_id,
        student_id,
        institute_id,
        enrollment_type,
        is_active,
        enrolled_at,
        revoked_at,
        revoked_reason
      ) values (
        v_effective_course_id,
        v_student_id,
        v_resolved_institute_id,
        v_target_enrollment_type,
        true,
        p_transaction_timestamp,
        null,
        null
      )
      on conflict (course_id, student_id)
      do update set
        is_active = true,
        enrollment_type = v_target_enrollment_type,
        revoked_at = null,
        revoked_reason = null;
    end if;

    v_entitlement := 'student_subscription:' || p_plan_id::text;

  elsif p_item_type = 'pyq_package' and p_package_id is not null then
    insert into public.student_pyq_purchases (
      package_id,
      student_id,
      institute_id,
      order_item_id,
      access_type,
      is_active,
      purchased_at,
      created_at,
      updated_at
    ) values (
      p_package_id,
      v_student_id,
      v_resolved_institute_id,
      v_item_id,
      'lifetime',
      true,
      p_transaction_timestamp,
      p_transaction_timestamp,
      p_transaction_timestamp
    )
    on conflict (package_id, student_id)
    do update set
      is_active = true,
      updated_at = p_transaction_timestamp;

    v_entitlement := 'pyq_package:' || p_package_id::text;
  end if;

  -- 15. Snapshot draft invoice (non-blocking accounting artifact)
  begin
    v_year := to_char(p_transaction_timestamp, 'YYYY');
    v_invoice_num := 'INV-' || v_year || '-' || upper(substr(replace(v_order_id::text, '-', ''), 1, 8));

    insert into public.invoices (
      order_id,
      institute_id,
      invoice_number,
      status,
      issued_at,
      subtotal_amount,
      discount_amount,
      tax_amount,
      total_amount,
      currency,
      billing_name,
      billing_email,
      created_at,
      updated_at
    ) values (
      v_order_id,
      v_resolved_institute_id,
      v_invoice_num,
      'draft',
      p_transaction_timestamp,
      p_unit_price,
      0.00,
      0.00,
      p_unit_price,
      'INR'::public.currency_code,
      p_billing_name,
      p_billing_email,
      p_transaction_timestamp,
      p_transaction_timestamp
    )
    on conflict (order_id) do nothing;
  exception when others then
    null;
  end;

  -- If invoked from RTDN, mark event completed atomically with business mutations
  if p_gateway_response is not null and (p_gateway_response->>'rtdn_event_id') is not null and coalesce(p_gateway_response->>'defer_rtdn_completion', 'false') != 'true' then
    update public.google_play_rtdn_events
    set processing_status = 'completed',
        order_id = p_effective_order_id,
        cycle_index = coalesce(substring(p_effective_order_id from '\.\.([0-9]+)')::integer, 0),
        processed_at = clock_timestamp(),
        error_message = null
    where event_id = (p_gateway_response->>'rtdn_event_id')::uuid
      and attempts = v_current_rtdn_attempts;
  end if;

  -- Migration 217: an entitlement repair (exact captured payment already present, entitlement
  -- re-granted) never creates a payment, so it must never claim 'renewal_recorded' with a null
  -- payment id. It reports the already-recorded outcome together with the existing payment.
  return jsonb_build_object(
    'success', true,
    'verified', true,
    'outcome',
      case
        when v_skip_payment_insert then 'already_recorded'
        when v_incoming_cycle is not null and v_incoming_cycle >= 0 then
          case when v_is_historical_reconciliation then 'renewal_recorded_backfill' else 'renewal_recorded' end
        else 'purchase_recorded'
      end,
    'alreadyProcessed', v_skip_payment_insert,
    'paymentId', coalesce(v_payment_id, v_existing_payment_id),
    'orderId', v_order_id,
    'cycleIndex', coalesce(v_incoming_cycle, -1),
    'entitlement', v_entitlement,
    'message', case
                 when v_skip_payment_insert then 'Existing captured payment reused; entitlement repaired without a new payment'
                 else 'Google Play purchase processed atomically with date parity'
               end
  );
end;
$$;

comment on function public.complete_google_play_purchase(
  uuid, uuid, uuid, text, uuid, uuid, uuid, text, numeric, text, text, text, jsonb, timestamptz, date, boolean, text, text
) is 'Migration 217: cycle-exact Google Play idempotency; renewals classified by cycle order; returns outcome/paymentId.';

revoke all on function public.complete_google_play_purchase(
  uuid, uuid, uuid, text, uuid, uuid, uuid, text, numeric, text, text, text, jsonb, timestamptz, date, boolean, text, text
) from public, anon, authenticated;

grant execute on function public.complete_google_play_purchase(
  uuid, uuid, uuid, text, uuid, uuid, uuid, text, numeric, text, text, text, jsonb, timestamptz, date, boolean, text, text
) to service_role;

-- ============================================================================
-- SECTION 2 (Migration 217): reconcile_google_play_renewal_batch
-- Same signature, SECURITY DEFINER, and grants as migration 216. The only behavioural
-- change is that the batch now takes the SAME advisory locks as the single-cycle RPC
-- (token + every external order id, ascending order) before checking for existing
-- payments, so batch and single-cycle delivery of one renewal can never both insert.
-- NO data backfill, NO replay, NO DDL.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reconcile_google_play_renewal_batch(
  p_rtdn_event_id uuid,
  p_rtdn_attempt integer,
  p_profile_id uuid,
  p_institute_id uuid,
  p_student_id uuid,
  p_plan_id uuid,
  p_course_id uuid default null,
  p_product_id text default null,
  p_purchase_token text default null,
  p_orders jsonb default '[]'::jsonb,
  p_metadata jsonb default '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role text;
  v_current_rtdn_attempts integer;
  v_current_rtdn_status text;

  v_sub_id uuid;
  v_sub_status public.subscription_status_type;
  v_sub_start_date date;
  v_sub_end_date date;
  v_sub_grace_end_date date;
  v_sub_content_access_end_date date;
  v_sub_order_id uuid;
  v_existing_linked_cycle integer := -1;

  v_plan_days integer;
  v_plan_billing_cycle text;
  v_plan_price numeric;
  v_plan_name text;
  v_plan_course_id uuid;
  v_effective_course_id uuid;

  v_order_elem jsonb;
  v_order_id text;
  v_cycle_index integer;
  v_unit_price numeric;
  v_currency text;
  v_tx_timestamp timestamptz;
  v_order_end_date date;
  v_is_auto_renew boolean;
  v_gateway_resp jsonb;

  v_existing_payment_id uuid;
  v_existing_order_id uuid;
  v_new_order_id uuid;
  v_new_item_id uuid;
  v_new_payment_id uuid;
  v_current_order_uuid uuid;

  v_reconciled_orders text[] := array[]::text[];
  v_already_processed text[] := array[]::text[];
  v_highest_cycle integer := -1;
  v_latest_internal_order_id uuid := null;
  v_latest_google_order_id text := null;
  v_max_end_date date := null;
  v_effective_end_date date := null;

  v_target_enrollment_type text;
  v_existing_enrollment_type text;

  v_now timestamptz := clock_timestamp();
  v_invoice_num text;
  v_year text;
  v_total_orders integer;
  -- Migration 217: transaction-scoped advisory lock keys (identical key scheme
  -- to complete_google_play_purchase, so both paths serialize on the same rows)
  v_lock_keys bigint[] := array[]::bigint[];
  v_lock_key bigint;
BEGIN
  -- 0. Security Guard: Only service_role may execute this batch reconciliation RPC
  v_caller_role := auth.role();
  if v_caller_role is distinct from 'service_role' then
    return jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: reconcile_google_play_renewal_batch requires service_role privileges',
      'code', 'FORBIDDEN'
    );
  end if;

  -- 1. Batch Payload Validation: Fail closed on non-array or null payload
  if p_orders is null or jsonb_typeof(p_orders) <> 'array' then
    return jsonb_build_object(
      'success', false,
      'error', 'Invalid batch payload: p_orders must be a non-null JSON array',
      'code', 'INVALID_BATCH_PAYLOAD'
    );
  end if;

  v_total_orders := jsonb_array_length(p_orders);

  -- Reject empty batches: Renewal reconciliation requires at least one verified order
  if v_total_orders = 0 then
    return jsonb_build_object(
      'success', false,
      'error', 'Empty renewal batch: p_orders must contain at least one verified order',
      'code', 'EMPTY_BATCH_ORDERS'
    );
  end if;

  -- 2. Pre-Validation Pass: Validate all order entries before ANY business mutation
  for v_order_elem in select * from jsonb_array_elements(p_orders) loop
    v_order_id := trim(v_order_elem->>'order_id');
    if v_order_id is null or v_order_id = '' then
      return jsonb_build_object(
        'success', false,
        'error', 'Malformed order entry: order_id is missing or empty',
        'code', 'INVALID_ORDER_ID'
      );
    end if;

    -- Strict Google Play order ID format (GPA.xxxx-xxxx-xxxx-xxxxx or GPA.xxxx-xxxx-xxxx-xxxxx..N)
    if v_order_id !~ '^GPA\.[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{5}(\.\.[0-9]+)?$' then
      return jsonb_build_object(
        'success', false,
        'error', 'Malformed Google Play order ID format: ' || v_order_id,
        'code', 'INVALID_ORDER_ID'
      );
    end if;

    -- Validate unit_price: Must be explicit, non-negative numeric amount actually charged
    if v_order_elem->'unit_price' is null or jsonb_typeof(v_order_elem->'unit_price') not in ('number', 'string') then
      return jsonb_build_object(
        'success', false,
        'error', 'Missing verified customer charge (unit_price) for order ' || v_order_id,
        'code', 'MISSING_UNIT_PRICE'
      );
    end if;

    begin
      v_unit_price := (v_order_elem->>'unit_price')::numeric;
    exception when others then
      return jsonb_build_object(
        'success', false,
        'error', 'Invalid unit_price numeric value for order ' || v_order_id,
        'code', 'INVALID_UNIT_PRICE'
      );
    end;

    if v_unit_price is null or v_unit_price < 0 then
      return jsonb_build_object(
        'success', false,
        'error', 'Verified unit_price cannot be negative for order ' || v_order_id,
        'code', 'INVALID_UNIT_PRICE'
      );
    end if;

    -- Validate currency: Must be strictly INR (fail-closed, no silent fallback)
    v_currency := upper(trim(v_order_elem->>'currency'));
    if v_currency is null or v_currency = '' then
      return jsonb_build_object(
        'success', false,
        'error', 'Missing currency for order ' || v_order_id || '; strictly require INR',
        'code', 'CURRENCY_MISMATCH'
      );
    end if;

    if v_currency <> 'INR' then
      return jsonb_build_object(
        'success', false,
        'error', 'Currency mismatch for order ' || v_order_id || ': expected INR, got ' || v_currency,
        'code', 'CURRENCY_MISMATCH'
      );
    end if;

    -- Validate authoritative transaction timestamp
    if v_order_elem->>'transaction_timestamp' is null or trim(v_order_elem->>'transaction_timestamp') = '' then
      return jsonb_build_object(
        'success', false,
        'error', 'Missing authoritative transaction timestamp for order ' || v_order_id,
        'code', 'MISSING_TRANSACTION_TIMESTAMP'
      );
    end if;

    begin
      v_tx_timestamp := (v_order_elem->>'transaction_timestamp')::timestamptz;
    exception when others then
      return jsonb_build_object(
        'success', false,
        'error', 'Unparseable transaction timestamp for order ' || v_order_id,
        'code', 'INVALID_TRANSACTION_TIMESTAMP'
      );
    end;

    if v_tx_timestamp is null then
      return jsonb_build_object(
        'success', false,
        'error', 'Null transaction timestamp for order ' || v_order_id,
        'code', 'MISSING_TRANSACTION_TIMESTAMP'
      );
    end if;

    if v_tx_timestamp > (v_now + interval '1 minute') then
      return jsonb_build_object(
        'success', false,
        'error', 'Transaction timestamp cannot be in the future for order ' || v_order_id,
        'code', 'FUTURE_TRANSACTION_TIMESTAMP'
      );
    end if;

    -- Validate cycle_index (must be integer >= 0, either explicitly provided or extracted via regex from order ID)
    if v_order_elem->'cycle_index' is not null and jsonb_typeof(v_order_elem->'cycle_index') in ('number', 'string') then
      begin
        v_cycle_index := (v_order_elem->>'cycle_index')::integer;
      exception when others then
        v_cycle_index := null;
      end;
    else
      v_cycle_index := (substring(v_order_id from '\.\.([0-9]+)$'))::integer;
    end if;

    if v_cycle_index is null or v_cycle_index < 0 then
      return jsonb_build_object(
        'success', false,
        'error', 'Invalid or missing cycle_index for order ' || v_order_id,
        'code', 'INVALID_CYCLE_INDEX'
      );
    end if;
  end loop;

  -- 2b. Concurrency (Migration 217): coordinate with complete_google_play_purchase by acquiring
  -- the SAME transaction-scoped advisory locks for every external order in this batch plus the
  -- purchase token. Keys are deduplicated and taken in strictly ascending order, which matches
  -- the least/greatest ordering used by the single-cycle function. A batch and a single-cycle
  -- delivery for the same order therefore serialize instead of racing, the loser observes the
  -- winner's captured payment in its own exact-id lookup, and cross-path deadlock is impossible.
  if p_purchase_token is not null and p_purchase_token <> '' then
    v_lock_keys := array_append(v_lock_keys, hashtext('google_play_token:' || p_purchase_token)::bigint);
  end if;

  for v_order_elem in select * from jsonb_array_elements(p_orders) loop
    v_lock_keys := array_append(v_lock_keys, hashtext('google_play_order:' || trim(v_order_elem->>'order_id'))::bigint);
  end loop;

  select array_agg(distinct k order by k) into v_lock_keys from unnest(v_lock_keys) as k;

  if v_lock_keys is not null then
    foreach v_lock_key in array v_lock_keys loop
      perform pg_advisory_xact_lock(v_lock_key);
    end loop;
  end if;

  -- 3. Fencing: Lock and validate active RTDN event ownership
  if p_rtdn_event_id is not null then
    select attempts, processing_status
    into v_current_rtdn_attempts, v_current_rtdn_status
    from public.google_play_rtdn_events
    where event_id = p_rtdn_event_id
    for update;

    if not found or v_current_rtdn_attempts != p_rtdn_attempt or v_current_rtdn_status != 'processing' then
      return jsonb_build_object(
        'success', false,
        'action', 'abort_stale_worker',
        'error', 'STALE_LEASE_LOST: RTDN event lease ownership was lost to another worker',
        'code', 'STALE_LEASE_LOST'
      );
    end if;
  end if;

  -- 4. Lock and fetch current subscription record
  select subscription_id, status, start_date, end_date, grace_end_date, content_access_end_date, order_id
  into v_sub_id, v_sub_status, v_sub_start_date, v_sub_end_date, v_sub_grace_end_date, v_sub_content_access_end_date, v_sub_order_id
  from public.student_subscriptions
  where student_id = p_student_id
    and plan_id = p_plan_id
  order by (case when status in ('active', 'grace') then 0 else 1 end) asc, created_at desc
  limit 1
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'error', 'Subscription not found for student ' || coalesce(p_student_id::text, 'null') || ' and plan ' || coalesce(p_plan_id::text, 'null'),
      'code', 'SUBSCRIPTION_NOT_FOUND'
    );
  end if;

  -- Resolve renewal cycle of subscription's currently linked order from authoritative payments
  if v_sub_order_id is not null then
    select case
             when p.gateway_order_id is not null then
               coalesce(substring(p.gateway_order_id from '\.\.([0-9]+)$')::integer, -1)
             when p.gateway_payment_id is not null and p.gateway_payment_id ~ '^GPA\.[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{5}(\.\.[0-9]+)?$' then
               coalesce(substring(p.gateway_payment_id from '\.\.([0-9]+)$')::integer, -1)
             else
               -1
           end
    into v_existing_linked_cycle
    from public.payments p
    where p.order_id = v_sub_order_id
      and p.gateway = 'google_play'
      and p.status = 'captured'
    order by p.created_at desc
    limit 1;
  end if;

  v_existing_linked_cycle := coalesce(v_existing_linked_cycle, -1);

  -- Initialize monotonic cycle and internal order reference to current subscription state
  v_highest_cycle := v_existing_linked_cycle;
  v_latest_internal_order_id := v_sub_order_id;

  -- Terminal state guard: If already refunded/revoked, do not accept renewal
  if v_sub_status = 'refunded' then
    if p_rtdn_event_id is not null then
      update public.google_play_rtdn_events
      set processing_status = 'completed',
          processed_at = v_now,
          error_message = null,
          metadata = coalesce(metadata, '{}'::jsonb) || p_metadata || jsonb_build_object('terminal_refund_preserved', true)
      where event_id = p_rtdn_event_id
        and attempts = p_rtdn_attempt;
    end if;

    return jsonb_build_object(
      'success', true,
      'action', 'terminal_state_preserved',
      'status', 'refunded',
      'message', 'Subscription is in terminal refunded state; renewal ignored'
    );
  end if;

  -- 5. Lookup plan catalog details
  select duration_days, billing_cycle, price, plan_name, course_id
  into v_plan_days, v_plan_billing_cycle, v_plan_price, v_plan_name, v_plan_course_id
  from public.subscription_plans
  where plan_id = p_plan_id;

  v_effective_course_id := coalesce(p_course_id, v_plan_course_id);

  -- 6. Execution Pass: Process each verified order in the batch
  for v_order_elem in select * from jsonb_array_elements(p_orders) loop
    v_order_id := trim(v_order_elem->>'order_id');
    v_unit_price := (v_order_elem->>'unit_price')::numeric;
    v_currency := upper(trim(v_order_elem->>'currency'));
    v_tx_timestamp := (v_order_elem->>'transaction_timestamp')::timestamptz;

    if v_order_elem->'cycle_index' is not null and jsonb_typeof(v_order_elem->'cycle_index') in ('number', 'string') then
      v_cycle_index := (v_order_elem->>'cycle_index')::integer;
    else
      v_cycle_index := (substring(v_order_id from '\.\.([0-9]+)$'))::integer;
    end if;

    v_order_end_date := (v_order_elem->>'subscription_end_date')::date;
    v_is_auto_renew := coalesce((v_order_elem->>'is_auto_renew')::boolean, true);
    v_gateway_resp := coalesce(v_order_elem->'gateway_response', '{}'::jsonb);

    -- Check if payment already exists for this exact order ID.
    -- Migration 217: runs under the advisory locks acquired in 2b, so a concurrent
    -- single-cycle delivery of the same order cannot insert a second order/payment here.
    v_existing_payment_id := null;
    v_existing_order_id := null;

    select payment_id, order_id
    into v_existing_payment_id, v_existing_order_id
    from public.payments
    where gateway = 'google_play'
      and (gateway_payment_id = v_order_id or gateway_order_id = v_order_id)
      and status = 'captured'
    limit 1;

    if v_existing_payment_id is not null then
      v_already_processed := array_append(v_already_processed, v_order_id);
      v_current_order_uuid := v_existing_order_id;
    else
      -- Insert new order
      insert into public.orders (
        institute_id,
        student_id,
        profile_id,
        status,
        currency,
        subtotal_amount,
        discount_amount,
        tax_amount,
        total_amount,
        notes,
        placed_at,
        confirmed_at,
        created_at,
        updated_at
      ) values (
        p_institute_id,
        p_student_id,
        p_profile_id,
        'confirmed',
        'INR'::public.currency_code,
        v_unit_price,
        0.00,
        0.00,
        v_unit_price,
        jsonb_build_object(
          'gateway', 'google_play',
          'product_id', p_product_id,
          'purchase_token', p_purchase_token,
          'order_id', v_order_id,
          'cycle_index', v_cycle_index,
          'source', 'rtdn_renewal_reconciliation'
        )::text,
        v_tx_timestamp,
        v_tx_timestamp,
        v_tx_timestamp,
        v_tx_timestamp
      )
      returning order_id into v_new_order_id;

      v_current_order_uuid := v_new_order_id;

      -- Insert order item
      insert into public.order_items (
        order_id,
        institute_id,
        item_type,
        course_id,
        plan_id,
        package_id,
        item_name,
        unit_price,
        quantity,
        discount_amount,
        line_total,
        created_at
      ) values (
        v_new_order_id,
        p_institute_id,
        'subscription_plan'::public.item_type,
        v_effective_course_id,
        p_plan_id,
        null,
        coalesce(v_plan_name, 'Subscription Renewal'),
        v_unit_price,
        1,
        0.00,
        v_unit_price,
        v_tx_timestamp
      )
      returning item_id into v_new_item_id;

      -- Insert payment record
      insert into public.payments (
        order_id,
        institute_id,
        attempt_number,
        gateway,
        gateway_order_id,
        gateway_payment_id,
        gateway_response,
        amount,
        currency,
        status,
        paid_at,
        created_at,
        updated_at
      ) values (
        v_new_order_id,
        p_institute_id,
        1,
        'google_play'::public.payment_gateway,
        v_order_id,
        v_order_id,
        v_gateway_resp || jsonb_build_object(
          'purchaseToken', p_purchase_token,
          'rtdn_event_id', p_rtdn_event_id,
          'cycle_index', v_cycle_index,
          'verified', true
        ),
        v_unit_price,
        'INR'::public.currency_code,
        'captured'::public.payment_status,
        v_tx_timestamp,
        v_tx_timestamp,
        v_tx_timestamp
      )
      returning payment_id into v_new_payment_id;

      -- Audit in subscription_renewals (MANDATORY financial record - no error suppression)
      insert into public.subscription_renewals (
        subscription_id,
        student_id,
        institute_id,
        order_id,
        attempted_at,
        succeeded_at,
        amount_charged,
        currency_code,
        payment_reference,
        new_end_date
      ) values (
        v_sub_id,
        p_student_id,
        p_institute_id,
        v_new_order_id,
        v_tx_timestamp,
        v_tx_timestamp,
        v_unit_price,
        'INR'::character(3),
        v_order_id,
        coalesce(v_order_end_date, v_sub_end_date)
      );

      -- Snapshot draft invoice (MANDATORY financial record - no error suppression)
      v_year := to_char(v_tx_timestamp, 'YYYY');
      v_invoice_num := 'INV-' || v_year || '-' || upper(substr(replace(v_new_order_id::text, '-', ''), 1, 8));

      insert into public.invoices (
        order_id,
        institute_id,
        invoice_number,
        status,
        issued_at,
        subtotal_amount,
        discount_amount,
        tax_amount,
        total_amount,
        currency,
        created_at,
        updated_at
      ) values (
        v_new_order_id,
        p_institute_id,
        v_invoice_num,
        'draft',
        v_tx_timestamp,
        v_unit_price,
        0.00,
        0.00,
        v_unit_price,
        'INR'::public.currency_code,
        v_tx_timestamp,
        v_tx_timestamp
      )
      on conflict (order_id) do nothing;

      v_reconciled_orders := array_append(v_reconciled_orders, v_order_id);
    end if;

    -- Track monotonic state across batch and existing subscription
    if v_cycle_index >= v_highest_cycle then
      v_highest_cycle := v_cycle_index;
      v_latest_internal_order_id := v_current_order_uuid;
      v_latest_google_order_id := v_order_id;
    end if;

    if v_order_end_date is not null then
      v_max_end_date := greatest(coalesce(v_max_end_date, v_order_end_date), v_order_end_date);
    end if;
  end loop;

  -- 7. Completeness Invariant Verification
  -- Every order in p_orders must have been processed (reconciled or already present)
  if (coalesce(cardinality(v_reconciled_orders), 0) + coalesce(cardinality(v_already_processed), 0)) != v_total_orders then
    return jsonb_build_object(
      'success', false,
      'error', 'Incomplete batch reconciliation: expected ' || v_total_orders::text || ' orders, but processed ' || (coalesce(cardinality(v_reconciled_orders), 0) + coalesce(cardinality(v_already_processed), 0))::text,
      'code', 'INCOMPLETE_BATCH_PROCESSING'
    );
  end if;

  if (coalesce(cardinality(v_reconciled_orders), 0) + coalesce(cardinality(v_already_processed), 0)) = 0 then
    return jsonb_build_object(
      'success', false,
      'error', 'No valid renewal orders were processed in batch',
      'code', 'NO_ORDERS_PROCESSED'
    );
  end if;

  -- 8. Monotonic Subscription Update
  v_effective_end_date := greatest(coalesce(v_sub_end_date, v_max_end_date), v_max_end_date);

  update public.student_subscriptions
  set status = 'active',
      order_id = coalesce(v_latest_internal_order_id, order_id),
      end_date = coalesce(v_effective_end_date, end_date),
      is_auto_renew = coalesce(v_is_auto_renew, is_auto_renew),
      cancelled_at = null,
      updated_at = v_now
  where subscription_id = v_sub_id;

  -- 9. Insert into subscription_history only on genuine status change (ck_subscription_history_status_change)
  if v_sub_status is distinct from 'active' then
    insert into public.subscription_history (
      subscription_id,
      student_id,
      institute_id,
      status_before,
      status_after,
      change_reason,
      occurred_at,
      metadata
    ) values (
      v_sub_id,
      p_student_id,
      p_institute_id,
      v_sub_status,
      'active',
      'renewal',
      v_now,
      jsonb_build_object(
        'latest_order_id', v_latest_internal_order_id,
        'latest_google_order_id', v_latest_google_order_id,
        'highest_cycle', v_highest_cycle,
        'rtdn_event_id', p_rtdn_event_id,
        'reconciled_orders', v_reconciled_orders,
        'already_processed', v_already_processed
      )
    );
  end if;

  -- 10. Ensure course enrollment is active
  if v_effective_course_id is not null then
    select enrollment_type::text
    into v_existing_enrollment_type
    from public.course_enrollments
    where course_id = v_effective_course_id
      and student_id = p_student_id
    limit 1;

    if v_existing_enrollment_type = 'purchase' then
      v_target_enrollment_type := 'purchase';
    else
      v_target_enrollment_type := 'subscription';
    end if;

    insert into public.course_enrollments (
      course_id,
      student_id,
      institute_id,
      enrollment_type,
      is_active,
      enrolled_at,
      revoked_at,
      revoked_reason
    ) values (
      v_effective_course_id,
      p_student_id,
      p_institute_id,
      v_target_enrollment_type,
      true,
      v_now,
      null,
      null
    )
    on conflict (course_id, student_id)
    do update set
      is_active = true,
      enrollment_type = v_target_enrollment_type,
      revoked_at = null,
      revoked_reason = null;
  end if;

  -- 11. Mark RTDN event completed in this SAME transaction only after ALL operations succeed
  if p_rtdn_event_id is not null then
    update public.google_play_rtdn_events
    set processing_status = 'completed',
        order_id = coalesce(v_latest_google_order_id, order_id),
        cycle_index = case when v_highest_cycle >= 0 then v_highest_cycle else cycle_index end,
        processed_at = v_now,
        error_message = null,
        metadata = coalesce(metadata, '{}'::jsonb) || p_metadata || jsonb_build_object(
          'batch_reconciled', true,
          'reconciled_orders', v_reconciled_orders,
          'already_processed', v_already_processed
        )
    where event_id = p_rtdn_event_id
      and attempts = p_rtdn_attempt;
  end if;

  return jsonb_build_object(
    'success', true,
    'subscription_id', v_sub_id,
    'reconciled_orders', v_reconciled_orders,
    'already_processed', v_already_processed,
    'latest_order_id', v_latest_google_order_id,
    'latest_internal_order_id', v_latest_internal_order_id,
    'highest_cycle', v_highest_cycle,
    'latest_end_date', v_effective_end_date
  );
END;
$$;

COMMENT ON FUNCTION public.reconcile_google_play_renewal_batch(
  uuid, integer, uuid, uuid, uuid, uuid, uuid, text, text, jsonb, jsonb
) IS 'Migration 218: Atomically reconciles multiple historical renewal orders, applies ledger payments, updates subscription expiry monotonically, and marks RTDN event completed in one transaction.';

REVOKE ALL ON FUNCTION public.reconcile_google_play_renewal_batch(
  uuid, integer, uuid, uuid, uuid, uuid, uuid, text, text, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reconcile_google_play_renewal_batch(
  uuid, integer, uuid, uuid, uuid, uuid, uuid, text, text, jsonb, jsonb
) TO service_role;

-- ============================================================================
-- SECTION 3 (Migration 218): apply_google_play_rtdn_state_transition
-- Corrects production type mismatch where p_mapped_status (text) was assigned directly
-- to student_subscriptions.status (subscription_status_type) and inserted into
-- subscription_history (status_before/status_after/change_reason).
-- Enforces strongly-typed enum validation and cast, satisfies constraints
-- (ck_student_subscriptions_cancelled_at, ck_student_subscriptions_grace_status,
-- ck_student_subscriptions_grace_end_date, ck_subscription_history_status_change),
-- preserves access until verified expiry for cancellations, transitions to expired
-- on verified expiry, and keeps idempotent execution for repeated deliveries.
-- Signature, SECURITY DEFINER, search_path, and service_role grants preserved.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.apply_google_play_rtdn_state_transition(
  p_rtdn_event_id uuid,
  p_rtdn_attempt integer,
  p_subscription_id uuid,
  p_mapped_status text,
  p_mapped_reason text,
  p_is_auto_renew boolean,
  p_new_end_date date default null,
  p_grace_end_date date default null,
  p_content_access_end_date date default null,
  p_course_id uuid default null,
  p_student_id uuid default null,
  p_should_deactivate_enrollment boolean default false,
  p_deactivate_reason text default null,
  p_metadata jsonb default '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role text;
  v_current_rtdn_attempts integer;
  v_current_rtdn_status text;

  v_sub_status public.subscription_status_type;
  v_target_status public.subscription_status_type;
  v_change_reason public.subscription_change_reason_type;
  v_sub_start_date date;
  v_sub_end_date date;
  v_sub_grace_end_date date;
  v_sub_content_access_end_date date;
  v_sub_student_id uuid;
  v_sub_institute_id uuid;

  v_effective_end_date date;
  v_effective_grace_end_date date;
  v_effective_content_access_end_date date;
  v_effective_cancelled_at timestamptz := null;
  v_now timestamptz := clock_timestamp();
BEGIN
  -- 0. Security Guard: Only service_role may execute this RPC
  v_caller_role := auth.role();
  if v_caller_role is distinct from 'service_role' then
    return jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: apply_google_play_rtdn_state_transition requires service_role privileges',
      'code', 'FORBIDDEN'
    );
  end if;

  -- 0b. Validate and cast input enums to prevent unhandled type errors
  if p_mapped_status is null then
    return jsonb_build_object(
      'success', false,
      'error', 'p_mapped_status cannot be null',
      'code', 'INVALID_STATUS'
    );
  end if;

  begin
    v_target_status := p_mapped_status::public.subscription_status_type;
  exception when invalid_text_representation or cannot_coerce then
    return jsonb_build_object(
      'success', false,
      'error', 'Invalid subscription status: ' || coalesce(p_mapped_status, 'null'),
      'code', 'INVALID_STATUS'
    );
  end;

  begin
    v_change_reason := coalesce(p_mapped_reason, 'admin_action')::public.subscription_change_reason_type;
  exception when invalid_text_representation or cannot_coerce then
    return jsonb_build_object(
      'success', false,
      'error', 'Invalid subscription change reason: ' || coalesce(p_mapped_reason, 'null'),
      'code', 'INVALID_CHANGE_REASON'
    );
  end;

  -- 1. Fencing: Lock and validate active RTDN event ownership
  if p_rtdn_event_id is not null then
    select attempts, processing_status
    into v_current_rtdn_attempts, v_current_rtdn_status
    from public.google_play_rtdn_events
    where event_id = p_rtdn_event_id
    for update;

    if not found or (p_rtdn_attempt is not null and v_current_rtdn_attempts != p_rtdn_attempt) or v_current_rtdn_status != 'processing' then
      return jsonb_build_object(
        'success', false,
        'action', 'abort_stale_worker',
        'error', 'STALE_LEASE_LOST: RTDN event lease ownership was lost to another worker',
        'code', 'STALE_LEASE_LOST'
      );
    end if;
  end if;

  -- 2. Lock and fetch current subscription state
  select status, start_date, end_date, grace_end_date, content_access_end_date, student_id, institute_id
  into v_sub_status, v_sub_start_date, v_sub_end_date, v_sub_grace_end_date, v_sub_content_access_end_date, v_sub_student_id, v_sub_institute_id
  from public.student_subscriptions
  where subscription_id = p_subscription_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'error', 'Subscription not found for subscription_id ' || coalesce(p_subscription_id::text, 'null'),
      'code', 'SUBSCRIPTION_NOT_FOUND'
    );
  end if;

  -- 3. Terminal state guard: Refunded/revoked subscriptions cannot be transitioned by non-refund events
  if v_sub_status = 'refunded' and v_target_status != 'refunded' then
    if p_rtdn_event_id is not null then
      update public.google_play_rtdn_events
      set processing_status = 'completed',
          processed_at = v_now,
          error_message = null,
          metadata = coalesce(metadata, '{}'::jsonb) || p_metadata || jsonb_build_object('terminal_refund_preserved', true)
      where event_id = p_rtdn_event_id
        and (p_rtdn_attempt is null or attempts = p_rtdn_attempt);
    end if;

    return jsonb_build_object(
      'success', true,
      'action', 'terminal_state_preserved',
      'status', 'refunded',
      'message', 'Subscription is in terminal refunded state; transition ignored'
    );
  end if;

  -- 4. Calculate date values strictly preserving monotonicity and constraints:
  -- ck_student_subscriptions_end_date: end_date > start_date
  v_effective_end_date := v_sub_end_date;
  if p_new_end_date is not null then
    if (v_sub_start_date is null or p_new_end_date > v_sub_start_date) then
      v_effective_end_date := greatest(coalesce(v_sub_end_date, p_new_end_date), p_new_end_date);
    end if;
  end if;

  v_effective_grace_end_date := v_sub_grace_end_date;
  if v_target_status = 'refunded' then
    v_effective_grace_end_date := null;
  elsif p_grace_end_date is not null then
    v_effective_grace_end_date := greatest(coalesce(v_sub_grace_end_date, p_grace_end_date), p_grace_end_date);
  end if;

  -- Defensive check for ck_student_subscriptions_grace_status & grace_end_date >= end_date
  if v_target_status = 'grace' then
    if v_effective_grace_end_date is null or (v_effective_end_date is not null and v_effective_grace_end_date < v_effective_end_date) then
      v_effective_grace_end_date := coalesce(v_effective_end_date, v_now::date) + 7;
    end if;
  end if;

  v_effective_content_access_end_date := v_sub_content_access_end_date;
  if v_target_status = 'refunded' then
    v_effective_content_access_end_date := null;
  elsif p_content_access_end_date is not null then
    v_effective_content_access_end_date := greatest(coalesce(v_sub_content_access_end_date, p_content_access_end_date), p_content_access_end_date);
  end if;

  -- Content access window must end on or after grace_end_date / end_date
  if v_effective_content_access_end_date is not null then
    if v_effective_grace_end_date is not null and v_effective_content_access_end_date < v_effective_grace_end_date then
      v_effective_content_access_end_date := v_effective_grace_end_date;
    elsif v_effective_end_date is not null and v_effective_content_access_end_date < v_effective_end_date then
      v_effective_content_access_end_date := v_effective_end_date;
    end if;
  end if;

  -- Manage cancelled_at strictly per ck_student_subscriptions_cancelled_at:
  -- ((status = 'cancelled' and cancelled_at is not null) or (status != 'cancelled' and cancelled_at is null))
  if v_target_status = 'cancelled' then
    v_effective_cancelled_at := v_now;
  else
    v_effective_cancelled_at := null;
  end if;

  -- 5. Atomic Update to student_subscriptions
  update public.student_subscriptions
  set status = v_target_status,
      is_auto_renew = p_is_auto_renew,
      end_date = v_effective_end_date,
      grace_end_date = v_effective_grace_end_date,
      content_access_end_date = v_effective_content_access_end_date,
      cancelled_at = v_effective_cancelled_at,
      updated_at = v_now
  where subscription_id = p_subscription_id;

  -- 6. Insert into subscription_history only on genuine status change (ck_subscription_history_status_change)
  if v_sub_status is distinct from v_target_status then
    insert into public.subscription_history (
      subscription_id,
      student_id,
      institute_id,
      status_before,
      status_after,
      change_reason,
      occurred_at,
      metadata
    ) values (
      p_subscription_id,
      v_sub_student_id,
      v_sub_institute_id,
      v_sub_status,
      v_target_status,
      v_change_reason,
      v_now,
      p_metadata
    );
  end if;

  -- 7. Update course_enrollments if linked course is present
  if p_course_id is not null then
    if p_should_deactivate_enrollment then
      update public.course_enrollments
      set is_active = false,
          revoked_at = v_now,
          revoked_reason = coalesce(p_deactivate_reason, 'subscription_inactive')
      where course_id = p_course_id
        and student_id = v_sub_student_id
        and enrollment_type = 'subscription';
    elsif v_target_status = 'active' then
      update public.course_enrollments
      set is_active = true,
          revoked_at = null,
          revoked_reason = null
      where course_id = p_course_id
        and student_id = v_sub_student_id
        and enrollment_type = 'subscription';
    end if;
  end if;

  -- 8. Mark RTDN event completed in the same transaction
  if p_rtdn_event_id is not null then
    update public.google_play_rtdn_events
    set processing_status = 'completed',
        processed_at = v_now,
        error_message = null,
        metadata = coalesce(metadata, '{}'::jsonb) || p_metadata
    where event_id = p_rtdn_event_id
      and (p_rtdn_attempt is null or attempts = p_rtdn_attempt);
  end if;

  return jsonb_build_object(
    'success', true,
    'subscription_id', p_subscription_id,
    'status', v_target_status,
    'status_changed', (v_sub_status is distinct from v_target_status)
  );
END;
$$;

COMMENT ON FUNCTION public.apply_google_play_rtdn_state_transition(
  uuid, integer, uuid, text, text, boolean, date, date, date, uuid, uuid, boolean, text, jsonb
) IS 'Migration 218: Atomically validates RTDN lease ownership and applies subscription state transitions, audit history, and course enrollment modifications in one transaction using strongly-typed subscription_status_type and subscription_change_reason_type enums.';

REVOKE ALL ON FUNCTION public.apply_google_play_rtdn_state_transition(
  uuid, integer, uuid, text, text, boolean, date, date, date, uuid, uuid, boolean, text, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_google_play_rtdn_state_transition(
  uuid, integer, uuid, text, text, boolean, date, date, date, uuid, uuid, boolean, text, jsonb
) TO service_role;

notify pgrst, 'reload schema';
