-- ============================================================================
-- Migration 216: Google Play Renewal Reconciliation & RTDN Ledger Infrastructure
--
-- REMEDIATION PURPOSE:
-- 1. Creates public.google_play_rtdn_events:
--    - Durable audit and idempotency ledger for Google Cloud Pub/Sub RTDN notifications.
--    - Retains event_time_millis, purchase_token, order_id, cycle_index, processing_status,
--      attempts, and diagnostic metadata.
--    - Enables safe retry, observability, and concurrent deduplication.
-- 2. Extends public.complete_google_play_purchase to support historical renewal reconciliation:
--    - When an intermediate or historical renewal cycle (e.g. GPA.xxxx..0) was skipped because
--      the subscription advanced to a newer cycle (..1 or ..2) before verification ran,
--      this migration allows recording the verified historical payment in the ledger.
--    - Strictly prevents entitlement regression: preserves established future end_date
--      (end_date = greatest(end_date, p_subscription_end_date)) and never downgrades the
--      linked order_id to an older cycle.
--    - Records a corresponding audit entry in public.subscription_renewals.
-- 3. Preserves all existing protections:
--    - Advisory locks on purchase_token and effective_order_id.
--    - Exact-order idempotency: repeated submissions of the same order ID return alreadyProcessed.
--    - Role elevation, student profile initialization, and course enrollment validation.
-- ============================================================================

-- SECTION 1: Durable RTDN Event Ingestion Ledger
CREATE TABLE IF NOT EXISTS public.google_play_rtdn_events (
  event_id            uuid            NOT NULL DEFAULT gen_random_uuid(),
  notification_type   integer         NOT NULL,
  purchase_token      text            NOT NULL,
  package_name        text            NOT NULL,
  subscription_id     text            NULL,
  event_time_millis   bigint          NULL,
  order_id            text            NULL,
  cycle_index         integer         NULL,
  processing_status   text            NOT NULL CHECK (processing_status IN ('pending', 'processing', 'completed', 'reconciliation_required', 'failed', 'duplicate', 'skipped')),
  error_message       text            NULL,
  attempts            integer         NOT NULL DEFAULT 1,
  received_at         timestamptz     NOT NULL DEFAULT now(),
  processed_at        timestamptz     NULL,
  metadata            jsonb           NULL,

  CONSTRAINT pk_google_play_rtdn_events PRIMARY KEY (event_id),
  CONSTRAINT uq_google_play_rtdn_events_token_time_type UNIQUE (purchase_token, event_time_millis, notification_type)
);

CREATE INDEX IF NOT EXISTS idx_google_play_rtdn_events_token
  ON public.google_play_rtdn_events (purchase_token);

CREATE INDEX IF NOT EXISTS idx_google_play_rtdn_events_order
  ON public.google_play_rtdn_events (order_id)
  WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_google_play_rtdn_events_status
  ON public.google_play_rtdn_events (processing_status, received_at);

ALTER TABLE public.google_play_rtdn_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access_on_google_play_rtdn_events" ON public.google_play_rtdn_events;
CREATE POLICY "service_role_full_access_on_google_play_rtdn_events"
  ON public.google_play_rtdn_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- SECTION 2: Enhanced Atomic Purchase & Reconciliation RPC
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
  v_incoming_cycle integer := null;
  v_existing_linked_order_cycle integer := null;

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
  v_existing_sub_status text := null;
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

  -- 7. Check existing captured payment UNDER LOCK (Idempotency / Replay / Inconsistency checks)
  select p.payment_id, p.order_id, o.profile_id, p.gateway_payment_id, p.gateway_order_id
  into v_existing_payment_id, v_existing_order_id, v_existing_payment_profile_id, v_existing_gateway_payment_id, v_existing_gateway_order_id
  from public.payments p
  join public.orders o on o.order_id = p.order_id
  where p.gateway = 'google_play'
    and p.status = 'captured'
    and (
      (p_effective_order_id is not null and (p.gateway_payment_id = p_effective_order_id or p.gateway_order_id = p_effective_order_id))
      or (p_purchase_token is not null and (
        (p.gateway_response ->> 'purchaseToken') = p_purchase_token
        or substring(o.notes from '"purchaseToken"[[:space:]]*:[[:space:]]*"([^"]+)"') = p_purchase_token
      ))
    )
  order by (
    case when p_effective_order_id is not null and (p.gateway_payment_id = p_effective_order_id or p.gateway_order_id = p_effective_order_id) then 0 else 1 end
  ) asc, p.created_at desc
  limit 1;

  if v_existing_payment_id is not null then
    v_has_existing_payment := true;
  end if;

  if v_has_existing_payment then
    -- Cross-profile replay detection: immediately reject if claimed by a different account
    if v_existing_payment_profile_id <> p_profile_id then
      return jsonb_build_object(
        'success', false,
        'error', 'This purchase has already been claimed by another account. Please sign in with the original account or contact support.',
        'code', 'ACCOUNT_MISMATCH'
      );
    end if;

    -- Differentiate idempotent retry / transition from a valid Google Play subscription renewal:
    -- In Google Play, recurring subscription renewals retain the original purchaseToken
    -- but receive a new distinct orderId with an incremented cycle suffix (..0, ..1, etc.).
    -- A valid renewal candidate MUST satisfy ALL of the following criteria:
    --   1. Item type is subscription_plan.
    --   2. Effective order ID is provided, is NOT a synthetic fallback ('GPA.SUB.%'),
    --      and is distinct from the captured payment's gateway_payment_id and gateway_order_id.
    --   3. Effective order ID satisfies the expected renewal cycle format:
    --      it MUST match '%..[0-9]+' (cycle ..0 for 1st renewal, ..1 for 2nd, etc.).
    --   4. Incoming Google-verified subscription expiry (p_subscription_end_date) is NON-NULL.
    --   5. Incoming Google-verified expiry is strictly in the future relative to the transaction UTC calendar date (p_subscription_end_date > v_start_date).
    --   6. If a previously granted subscription expiry (v_calculated_end_date) can be established,
    --      the incoming expiry must be strictly greater than that previous expiry (p_subscription_end_date > v_calculated_end_date),
    --      OR equal to it if the subscription record still references the previous order (reconciling RTDN-synchronized expiries).
    -- Fail closed: do NOT clear v_has_existing_payment unless all mandatory renewal evidence is explicitly established.
    if p_item_type = 'subscription_plan'
       and p_effective_order_id is not null
       and p_effective_order_id not like 'GPA.SUB.%'
       and (v_existing_gateway_payment_id is distinct from p_effective_order_id)
       and (v_existing_gateway_order_id is null or v_existing_gateway_order_id is distinct from p_effective_order_id) then

      -- In Google Play:
      --   - Initial subscription purchase uses an unsuffixed order ID (e.g. GPA.1234-5678-9012-34567).
      --   - 1st renewal receives cycle index 0 suffix: ..0 (e.g. GPA.1234-5678-9012-34567..0).
      --   - 2nd renewal receives cycle index 1 suffix: ..1 (e.g. GPA.1234-5678-9012-34567..1).
      --   - Nth renewal receives cycle index N-1 suffix: ..N.
      -- A valid renewal candidate must match '%..[0-9]+' and have verified future expiry.
      if p_effective_order_id similar to '%\.\.[0-9]+'
         and p_subscription_end_date is not null
         and p_subscription_end_date > v_start_date then

        -- Establish previously granted subscription expiry and linked order ID if present
        select ss.end_date, ss.order_id
        into v_calculated_end_date, v_existing_sub_order_id
        from public.student_subscriptions ss
        where ss.student_id = v_student_id
          and ss.plan_id = p_plan_id
        order by ss.end_date desc nulls last
        limit 1;

        v_incoming_cycle := coalesce(substring(p_effective_order_id from '\.\.([0-9]+)$')::integer, -1);

        if v_calculated_end_date is null
           or p_subscription_end_date > v_calculated_end_date
           or (p_subscription_end_date = v_calculated_end_date and (v_existing_sub_order_id is null or v_existing_sub_order_id = v_existing_order_id)) then
          -- Legitimate forward subscription renewal confirmed with future verified expiry:
          v_has_existing_payment := false;
          v_is_historical_reconciliation := false;
          v_existing_payment_id := null;
          v_existing_order_id := null;
          v_existing_payment_profile_id := null;
          v_existing_gateway_payment_id := null;
          v_existing_gateway_order_id := null;
        elsif v_existing_sub_id is not null and (p_subscription_end_date is null or p_subscription_end_date <= v_calculated_end_date) then
          -- Legitimate historical renewal reconciliation (e.g. missing intermediate cycle ..0 verified after ..1 recorded):
          -- Subscription already has established future expiry, but this authoritative renewal order has NOT been recorded in payments.
          -- Clear existing payment flags so the order and payment rows are recorded in the ledger,
          -- while flagging historical reconciliation to protect established future entitlement from rolling backward.
          v_has_existing_payment := false;
          v_is_historical_reconciliation := true;
          v_existing_payment_id := null;
          v_existing_order_id := null;
          v_existing_payment_profile_id := null;
          v_existing_gateway_payment_id := null;
          v_existing_gateway_order_id := null;
        end if;
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
        'alreadyProcessed', true,
        'orderId', v_existing_order_id,
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
          'alreadyProcessed', true,
          'orderId', v_existing_order_id,
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
    );
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
      and (status in ('active', 'grace') or start_date = v_start_date)
    order by (case when status in ('active', 'grace') then 0 else 1 end) asc, created_at desc
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
        update public.student_subscriptions
        set order_id = v_order_id,
            status = 'active',
            start_date = v_start_date,
            end_date = v_calculated_end_date,
            grace_end_date = v_grace_end_date,
            content_access_end_date = v_content_access_end_date,
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

  return jsonb_build_object(
    'success', true,
    'verified', true,
    'orderId', v_order_id,
    'entitlement', v_entitlement,
    'message', 'Google Play purchase processed atomically with date parity'
  );
end;
$$;

comment on function public.complete_google_play_purchase(
  uuid, uuid, uuid, text, uuid, uuid, uuid, text, numeric, text, text, text, jsonb, timestamptz, date, boolean, text, text
) is 'Migration 216: Extends complete_google_play_purchase to support historical renewal cycle reconciliation without entitlement regression.';

revoke all on function public.complete_google_play_purchase(
  uuid, uuid, uuid, text, uuid, uuid, uuid, text, numeric, text, text, text, jsonb, timestamptz, date, boolean, text, text
) from public, anon, authenticated;

grant execute on function public.complete_google_play_purchase(
  uuid, uuid, uuid, text, uuid, uuid, uuid, text, numeric, text, text, text, jsonb, timestamptz, date, boolean, text, text
) to service_role;

-- SECTION 3: Atomic RTDN Lifecycle State Transition RPC
-- Transactionally locks RTDN event ownership, validates attempt fencing token,
-- applies student_subscriptions state update, inserts subscription_history,
-- updates course_enrollments, and marks RTDN event completed in one atomic database transaction.
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

  v_sub_status text;
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

  -- 1. Fencing: Lock and validate active RTDN event ownership
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
  if v_sub_status = 'refunded' and p_mapped_status != 'refunded' then
    update public.google_play_rtdn_events
    set processing_status = 'completed',
        processed_at = v_now,
        error_message = null,
        metadata = coalesce(metadata, '{}'::jsonb) || p_metadata || jsonb_build_object('terminal_refund_preserved', true)
    where event_id = p_rtdn_event_id
      and attempts = p_rtdn_attempt;

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
  if p_mapped_status = 'refunded' then
    v_effective_grace_end_date := null;
  elsif p_grace_end_date is not null then
    v_effective_grace_end_date := greatest(coalesce(v_sub_grace_end_date, p_grace_end_date), p_grace_end_date);
  end if;

  v_effective_content_access_end_date := v_sub_content_access_end_date;
  if p_mapped_status = 'refunded' then
    v_effective_content_access_end_date := null;
  elsif p_content_access_end_date is not null then
    v_effective_content_access_end_date := greatest(coalesce(v_sub_content_access_end_date, p_content_access_end_date), p_content_access_end_date);
  end if;

  -- Manage cancelled_at strictly per ck_student_subscriptions_cancelled_at:
  -- ((status = 'cancelled' and cancelled_at is not null) or (status != 'cancelled' and cancelled_at is null))
  if p_mapped_status = 'cancelled' then
    v_effective_cancelled_at := v_now;
  else
    v_effective_cancelled_at := null;
  end if;

  -- 5. Atomic Update to student_subscriptions
  update public.student_subscriptions
  set status = p_mapped_status,
      is_auto_renew = p_is_auto_renew,
      end_date = v_effective_end_date,
      grace_end_date = v_effective_grace_end_date,
      content_access_end_date = v_effective_content_access_end_date,
      cancelled_at = v_effective_cancelled_at,
      updated_at = v_now
  where subscription_id = p_subscription_id;

  -- 6. Insert into subscription_history only on genuine status change (ck_subscription_history_status_change)
  if v_sub_status is distinct from p_mapped_status then
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
      p_mapped_status,
      p_mapped_reason,
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
    elsif p_mapped_status = 'active' then
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
  update public.google_play_rtdn_events
  set processing_status = 'completed',
      processed_at = v_now,
      error_message = null,
      metadata = coalesce(metadata, '{}'::jsonb) || p_metadata
  where event_id = p_rtdn_event_id
    and attempts = p_rtdn_attempt;

  return jsonb_build_object(
    'success', true,
    'subscription_id', p_subscription_id,
    'status', p_mapped_status,
    'status_changed', (v_sub_status is distinct from p_mapped_status)
  );
END;
$$;

COMMENT ON FUNCTION public.apply_google_play_rtdn_state_transition(
  uuid, integer, uuid, text, text, boolean, date, date, date, uuid, uuid, boolean, text, jsonb
) IS 'Migration 216: Atomically validates RTDN lease ownership and applies subscription state transitions, audit history, and course enrollment modifications in one transaction.';

REVOKE ALL ON FUNCTION public.apply_google_play_rtdn_state_transition(
  uuid, integer, uuid, text, text, boolean, date, date, date, uuid, uuid, boolean, text, jsonb
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.apply_google_play_rtdn_state_transition(
  uuid, integer, uuid, text, text, boolean, date, date, date, uuid, uuid, boolean, text, jsonb
) TO service_role;

-- SECTION 3b: Atomic Multi-Order Renewal Reconciliation Batch RPC
-- Reconciles multiple missing historical orders and incoming renewal in one atomic transaction under row lock.
-- Event completed only after all required order recordings succeed.
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
  v_sub_status text;
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

    -- Check if payment already exists for this exact order ID
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

  -- 9. Insert into subscription_history if status transitioned or new renewal recorded
  if v_sub_status is distinct from 'active' or cardinality(v_reconciled_orders) > 0 then
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
      'renewal_reconciliation',
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
) IS 'Migration 216: Atomically reconciles multiple historical renewal orders, applies ledger payments, updates subscription expiry monotonically, and marks RTDN event completed in one transaction.';

REVOKE ALL ON FUNCTION public.reconcile_google_play_renewal_batch(
  uuid, integer, uuid, uuid, uuid, uuid, uuid, text, text, jsonb, jsonb
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.reconcile_google_play_renewal_batch(
  uuid, integer, uuid, uuid, uuid, uuid, uuid, text, text, jsonb, jsonb
) TO service_role;

-- SECTION 4: Atomic RTDN Event Ingestion & Lease Reclamation RPC
-- Atomically claims or reclaims an RTDN event under exclusive row lock.
-- Concurrency rules:
-- 1. If row does not exist, inserts with status 'processing', attempts = 1.
-- 2. If row exists and status is 'completed', returns 'already_completed' (HTTP 200). It cannot be reclaimed.
-- 3. If row exists and status is 'processing' with a fresh lease (< timeout_seconds), returns 'in_flight' (HTTP 503 retryable).
-- 4. If row exists and is 'failed' OR ('processing' with expired lease >= timeout_seconds),
--    atomically increments attempts, updates received_at = now(), resets error_message, and returns 'reclaimed'.
CREATE OR REPLACE FUNCTION public.claim_google_play_rtdn_event(
  p_purchase_token text,
  p_event_time_millis text,
  p_notification_type integer,
  p_package_name text default null,
  p_subscription_id text default null,
  p_lease_timeout_seconds integer default 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event public.google_play_rtdn_events%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_timeout_threshold timestamptz := v_now - (p_lease_timeout_seconds || ' seconds')::interval;
  v_event_time_bigint bigint;
BEGIN
  -- Parse event_time_millis safely to bigint to match table column
  v_event_time_bigint := case
    when p_event_time_millis ~ '^[0-9]+$' then p_event_time_millis::bigint
    else null
  end;

  -- 1. Try to select existing event under exclusive row lock (waits on concurrent workers)
  SELECT * INTO v_event
  FROM public.google_play_rtdn_events
  WHERE purchase_token = p_purchase_token
    AND (event_time_millis = v_event_time_bigint OR (event_time_millis IS NULL AND v_event_time_bigint IS NULL))
    AND notification_type = p_notification_type
  FOR UPDATE;

  IF NOT FOUND THEN
    -- First delivery attempt: insert processing row
    BEGIN
      INSERT INTO public.google_play_rtdn_events (
        purchase_token,
        event_time_millis,
        notification_type,
        package_name,
        subscription_id,
        processing_status,
        attempts,
        received_at
      ) VALUES (
        p_purchase_token,
        v_event_time_bigint,
        p_notification_type,
        p_package_name,
        p_subscription_id,
        'processing',
        1,
        v_now
      )
      RETURNING * INTO v_event;

      RETURN jsonb_build_object(
        'success', true,
        'action', 'claimed',
        'event_id', v_event.event_id,
        'attempt', v_event.attempts,
        'processing_status', v_event.processing_status
      );
    EXCEPTION WHEN unique_violation THEN
      -- Concurrent insert race: re-select under exclusive lock
      SELECT * INTO v_event
      FROM public.google_play_rtdn_events
      WHERE purchase_token = p_purchase_token
        AND (event_time_millis = v_event_time_bigint OR (event_time_millis IS NULL AND v_event_time_bigint IS NULL))
        AND notification_type = p_notification_type
      FOR UPDATE;
    END;
  END IF;

  -- 2. If event was already completed: completed events CANNOT be reclaimed
  IF v_event.processing_status = 'completed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'already_completed',
      'event_id', v_event.event_id,
      'attempt', v_event.attempts,
      'processing_status', 'completed',
      'order_id', v_event.order_id
    );
  END IF;

  -- 3. If event is actively in-flight with an active (non-expired) lease:
  IF v_event.processing_status = 'processing' AND v_event.received_at > v_timeout_threshold THEN
    RETURN jsonb_build_object(
      'success', false,
      'action', 'in_flight',
      'event_id', v_event.event_id,
      'attempt', v_event.attempts,
      'error', 'Event is currently being processed by another worker',
      'retryable', true
    );
  END IF;

  -- 4. Reclaim: event is failed OR (processing with expired lease)
  UPDATE public.google_play_rtdn_events
  SET processing_status = 'processing',
      attempts = v_event.attempts + 1,
      received_at = v_now,
      error_message = null
  WHERE event_id = v_event.event_id
  RETURNING * INTO v_event;

  RETURN jsonb_build_object(
    'success', true,
    'action', 'reclaimed',
    'event_id', v_event.event_id,
    'attempt', v_event.attempts,
    'processing_status', 'processing'
  );
END;
$$;

COMMENT ON FUNCTION public.claim_google_play_rtdn_event(
  text, text, integer, text, text, integer
) IS 'Migration 216: Atomically ingests, claims, or reclaims RTDN events under row lock to prevent double reclamation or reclamation of completed events.';

REVOKE ALL ON FUNCTION public.claim_google_play_rtdn_event(
  text, text, integer, text, text, integer
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.claim_google_play_rtdn_event(
  text, text, integer, text, text, integer
) TO service_role;

-- SECTION 4b: Atomic RTDN Event Failure Recording RPC
-- Atomically marks an RTDN event failed under row lock, strictly verifying attempt fencing.
CREATE OR REPLACE FUNCTION public.record_google_play_rtdn_event_failure(
  p_rtdn_event_id uuid,
  p_rtdn_attempt integer,
  p_error_message text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current_rtdn_attempts integer;
  v_current_rtdn_status text;
  v_now timestamptz := clock_timestamp();
BEGIN
  -- 0. Security guard: Only service_role may call this function
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: record_google_play_rtdn_event_failure requires service_role privileges',
      'code', 'FORBIDDEN'
    );
  END IF;

  -- 1. Lock event row FOR UPDATE and verify lease ownership
  SELECT attempts, processing_status
  INTO v_current_rtdn_attempts, v_current_rtdn_status
  FROM public.google_play_rtdn_events
  WHERE event_id = p_rtdn_event_id
  FOR UPDATE;

  IF NOT FOUND OR v_current_rtdn_attempts != p_rtdn_attempt OR v_current_rtdn_status != 'processing' THEN
    RETURN jsonb_build_object(
      'success', false,
      'action', 'abort_stale_worker',
      'error', 'STALE_LEASE_LOST: RTDN event lease ownership was lost to another worker',
      'code', 'STALE_LEASE_LOST'
    );
  END IF;

  -- 2. Mark event as failed so it can be retried by Pub/Sub
  UPDATE public.google_play_rtdn_events
  SET processing_status = 'failed',
      error_message = p_error_message,
      processed_at = v_now
  WHERE event_id = p_rtdn_event_id
    AND attempts = p_rtdn_attempt;

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_rtdn_event_id,
    'processing_status', 'failed'
  );
END;
$$;

COMMENT ON FUNCTION public.record_google_play_rtdn_event_failure(uuid, integer, text)
IS 'Migration 216: Atomically marks an RTDN event failed under row lock, strictly verifying attempt fencing.';

REVOKE ALL ON FUNCTION public.record_google_play_rtdn_event_failure(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_google_play_rtdn_event_failure(uuid, integer, text) TO service_role;

-- SECTION 5: Indexes & Idempotent Backfill
-- Create partial functional index on purchaseToken in payments.gateway_response
-- to ensure O(1) indexed replay lookups
create index if not exists idx_payments_google_play_purchase_token
  on public.payments ((gateway_response ->> 'purchaseToken'))
  where gateway = 'google_play';

-- Safe idempotent backfill: for existing captured google_play payments that lack
-- purchaseToken in gateway_response, populate it from the associated order's notes.
-- Safely extracts purchaseToken via POSIX regex without casting o.notes to jsonb,
-- preventing 22P02 invalid input syntax errors on freeform or malformed order notes.
update public.payments p
set gateway_response = coalesce(p.gateway_response, '{}'::jsonb) || jsonb_build_object(
  'purchaseToken',
  substring(o.notes from '"purchaseToken"[[:space:]]*:[[:space:]]*"([^"]+)"')
)
from public.orders o
where p.order_id = o.order_id
  and p.gateway = 'google_play'
  and (p.gateway_response ->> 'purchaseToken') is null
  and substring(o.notes from '"purchaseToken"[[:space:]]*:[[:space:]]*"([^"]+)"') is not null;

-- Secondary safe idempotent backfill: for subscription payments still lacking purchaseToken
-- in gateway_response, populate it from student_subscriptions.payment_method_id (where
-- purchaseToken was historically recorded per Migrations 203-209).
update public.payments p
set gateway_response = coalesce(p.gateway_response, '{}'::jsonb) || jsonb_build_object('purchaseToken', ss.payment_method_id)
from public.student_subscriptions ss
where p.order_id = ss.order_id
  and p.gateway = 'google_play'
  and (p.gateway_response ->> 'purchaseToken') is null
  and ss.payment_method_id is not null
  and ss.payment_method_id <> '';

-- Request PostgREST schema cache reload to ensure immediate RPC visibility
notify pgrst, 'reload schema';
