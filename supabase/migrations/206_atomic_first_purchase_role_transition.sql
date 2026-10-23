-- ============================================================================
-- Migration 206: Atomic First-Purchase Role Transition and Student Initialization
--
-- PURPOSE:
-- 1. Updates public.complete_google_play_purchase to atomically handle the
--    legitimate first-purchase account lifecycle:
--    - When an eligible user with role = 'user' completes their first purchase,
--      transitions their role from 'user' to 'student'.
--    - Initializes their public.student_details record inside the same
--      transaction before granting entitlements.
--    - Generates a unique enrollment number using the standard sequence/format.
-- 2. Role Transition Edge-Case Hardening:
--    - Separates the role transition from student_details initialization:
--      A profile with role = 'user' is promoted to 'student' whenever an
--      eligible purchase succeeds, EVEN IF a student_details record ALREADY
--      exists (e.g. legacy/inconsistent state).
--    - In the idempotency path (existing captured payment + active entitlement),
--      if the profile has role = 'user', it is promoted to 'student' before
--      returning alreadyProcessed: true.
--    - Preserves existing student_id and enrollment_no without alterations.
-- 3. Staff Account Protection:
--    - Strictly prevents 'teacher', 'admin', and 'super_admin' profiles from
--      being converted into students or making student purchases.
--    - Staff check is executed immediately upon acquiring profile lock and
--      CANNOT be bypassed by early idempotency returns.
-- 4. Plan/Course Association & Multi-Tenant Enforcement:
--    - In accordance with the canonical schema (Migrations 012, 032, 090):
--      * Every subscription plan MUST be course-scoped (subscription_plans.course_id NOT NULL).
--        Plans lacking a course association are strictly rejected with 'COURSE_PLAN_MISMATCH'.
--      * Validates that p_course_id matches the plan's course_id (or auto-populates it if omitted).
--      * Every product, course, plan, and package enforces institute_id NOT NULL.
--      * Multi-tenant isolation is strictly enforced: checkout is rejected with 'INSTITUTE_MISMATCH'
--        if the resolved institute ID is NULL or does not match the product/course institute.
-- 5. Concurrency, Advisory Locking & Idempotency Hardening:
--    - Acquires transaction-level advisory locks on BOTH purchase token AND
--      effective order ID when available.
--    - Acquires multiple locks in strict monotonic ascending numerical order
--      (least then greatest) to provably eliminate deadlocks across concurrent
--      verification requests.
--    - Rechecks payment and order state under lock.
--    - Preserves valid Google Play subscription renewals by differentiating
--      new renewal billing cycles (distinct orderId with retained token) from
--      idempotent retries of the same cycle.
--    - Acquires row-level lock on public.profiles (FOR UPDATE) to prevent
--      concurrent purchase requests from racing on role transition or
--      student initialization.
--    - Cross-profile replay detection returns code 'ACCOUNT_MISMATCH'.
--    - Existing order line item validation fails closed on missing or mismatched items.
--    - Missing/inconsistent entitlement under existing payment is remediated
--      safely without duplicate order or payment creation.
-- 6. Atomicity & Rollback:
--    - If any critical operation fails after mutation begins, unhandled
--      exceptions abort the transaction and roll back all changes completely,
--      ensuring no partial student role or orphaned records persist.
-- 7. Preserves ALL Corrections from Migration 205 and 204:
--    - 18-argument signature parity (exact argument names, types, order, defaults)
--    - public.order_items immutable ledger schema (no updated_at column)
--    - Explicit public.item_type enum casting
--    - public.invoices issued_at schema alignment
--    - ck_payments_paid_at timestamp constraint satisfaction
--    - Date parity (7-day grace period, 30-day post-grace content window)
--    - Permanent course ownership ('purchase' vs 'subscription') preservation
--    - Restricted execution privileges (REVOKE from public/anon/authenticated,
--      GRANT to service_role only)
--
-- NOTE: Forward-only migration. Migration 205 has already been applied in production.
-- ============================================================================

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
set search_path = ''
as $$
declare
  v_caller_role text;
  v_existing_payment record;
  v_existing_item record;
  v_order_id uuid;
  v_item_id uuid;
  v_order_notes jsonb;
  v_student_id uuid;
  v_profile_role public.user_role;
  v_profile_institute_id uuid;
  v_resolved_institute_id uuid;
  v_effective_course_id uuid;
  v_plan_record record;
  v_course_record record;
  v_package_record record;
  v_enrollment_no varchar(50);
  v_existing_sub record;
  v_existing_enrollment record;
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
  if v_caller_role <> 'service_role' then
    return jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: complete_google_play_purchase requires service_role privileges',
      'code', 'FORBIDDEN'
    );
  end if;

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
  if v_profile_role::text not in ('user', 'student')
     or exists (select 1 from public.admin_roles ar where ar.profile_id = p_profile_id and ar.is_active = true)
     or exists (select 1 from public.teacher_details td where td.profile_id = p_profile_id) then
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
    into v_plan_record
    from public.subscription_plans sp
    where sp.plan_id = p_plan_id;

    if v_plan_record.plan_id is null then
      return jsonb_build_object(
        'success', false,
        'error', 'Subscription plan not found for plan_id ' || p_plan_id::text,
        'code', 'PLAN_NOT_FOUND'
      );
    end if;

    -- Plan tenant validation: Subscription plans are strictly institute-scoped
    if v_resolved_institute_id is null or v_plan_record.institute_id is null or v_plan_record.institute_id <> v_resolved_institute_id then
      return jsonb_build_object(
        'success', false,
        'error', 'Subscription plan does not belong to the user''s institute.',
        'code', 'INSTITUTE_MISMATCH'
      );
    end if;

    -- Validate that subscription plan is course-scoped per Migration 090
    if v_plan_record.course_id is null then
      return jsonb_build_object(
        'success', false,
        'error', 'Subscription plan ' || p_plan_id::text || ' is not associated with any course. All subscription plans must be course-scoped per database schema.',
        'code', 'COURSE_PLAN_MISMATCH'
      );
    end if;

    if v_effective_course_id is not null and v_effective_course_id <> v_plan_record.course_id then
      return jsonb_build_object(
        'success', false,
        'error', 'Subscription plan course association mismatch: plan course (' || v_plan_record.course_id::text || ') does not match purchase course (' || v_effective_course_id::text || ').',
        'code', 'COURSE_PLAN_MISMATCH'
      );
    elsif v_effective_course_id is null then
      v_effective_course_id := v_plan_record.course_id;
    end if;

    -- Validate course existence and institute ownership (course-scoped)
    select c.course_id, c.institute_id
    into v_course_record
    from public.courses c
    where c.course_id = v_effective_course_id;

    if v_course_record.course_id is null then
      return jsonb_build_object(
        'success', false,
        'error', 'Course not found for course_id ' || v_effective_course_id::text,
        'code', 'COURSE_NOT_FOUND'
      );
    end if;

    -- Course tenant validation: Courses are strictly institute-scoped
    if v_resolved_institute_id is null or v_course_record.institute_id is null or v_course_record.institute_id <> v_resolved_institute_id then
      return jsonb_build_object(
        'success', false,
        'error', 'Course does not belong to the user''s institute.',
        'code', 'INSTITUTE_MISMATCH'
      );
    end if;

    -- Both plan and course must belong to the same institute
    if v_plan_record.institute_id <> v_course_record.institute_id then
      return jsonb_build_object(
        'success', false,
        'error', 'Subscription plan and associated course belong to different institutes.',
        'code', 'INSTITUTE_MISMATCH'
      );
    end if;

    if v_plan_record.duration_days is not null and v_plan_record.duration_days > 0 then
      v_plan_duration_days := v_plan_record.duration_days;
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
    into v_course_record
    from public.courses c
    where c.course_id = v_effective_course_id;

    if v_course_record.course_id is null then
      return jsonb_build_object(
        'success', false,
        'error', 'Course not found for course_id ' || v_effective_course_id::text,
        'code', 'COURSE_NOT_FOUND'
      );
    end if;

    -- Course tenant validation: Courses are strictly institute-scoped
    if v_resolved_institute_id is null or v_course_record.institute_id is null or v_course_record.institute_id <> v_resolved_institute_id then
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
    into v_package_record
    from public.pyq_packages pp
    where pp.package_id = p_package_id;

    if v_package_record.package_id is null then
      return jsonb_build_object(
        'success', false,
        'error', 'PYQ package not found for package_id ' || p_package_id::text,
        'code', 'PACKAGE_NOT_FOUND'
      );
    end if;

    -- PYQ package tenant validation: PYQ packages are strictly institute-scoped
    if v_resolved_institute_id is null or v_package_record.institute_id is null or v_package_record.institute_id <> v_resolved_institute_id then
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
  into v_existing_payment
  from public.payments p
  join public.orders o on o.order_id = p.order_id
  where p.gateway = 'google_play'
    and p.status = 'captured'
    and (
      (p_effective_order_id is not null and (p.gateway_payment_id = p_effective_order_id or p.gateway_order_id = p_effective_order_id))
      or (p_purchase_token is not null and (p.gateway_response ->> 'purchaseToken') = p_purchase_token)
    )
  order by (
    case when p_effective_order_id is not null and (p.gateway_payment_id = p_effective_order_id or p.gateway_order_id = p_effective_order_id) then 0 else 1 end
  ) asc
  limit 1;

  if v_existing_payment.payment_id is not null then
    -- Cross-profile replay detection: immediately reject if claimed by a different account
    if v_existing_payment.profile_id <> p_profile_id then
      return jsonb_build_object(
        'success', false,
        'error', 'This purchase has already been claimed by another account. Please sign in with the original account or contact support.',
        'code', 'ACCOUNT_MISMATCH'
      );
    end if;

    -- Differentiate idempotent retry from a valid Google Play subscription renewal:
    -- In Google Play, recurring subscription renewals retain the original purchaseToken
    -- but receive a new distinct orderId (e.g. GPA.1234..0).
    -- For subscription_plans with a new non-null order ID that does not match the captured payment,
    -- this is a new renewal cycle for the same student.
    if p_item_type = 'subscription_plan'
       and p_effective_order_id is not null
       and (v_existing_payment.gateway_payment_id is distinct from p_effective_order_id)
       and (v_existing_payment.gateway_order_id is null or v_existing_payment.gateway_order_id is distinct from p_effective_order_id) then
      -- Legitimate subscription renewal: do not treat as already processed.
      -- Clear existing payment reference so the renewal proceeds to insert the new order & payment and extend the subscription.
      v_existing_payment := null;
    end if;
  end if;

  if v_existing_payment.payment_id is not null then

    -- Validate that an associated order item exists for the captured payment
    select oi.item_id, oi.item_type, oi.course_id, oi.plan_id, oi.package_id
    into v_existing_item
    from public.order_items oi
    where oi.order_id = v_existing_payment.order_id
    limit 1;

    if v_existing_item.item_id is null then
      return jsonb_build_object(
        'success', false,
        'error', 'Existing captured payment found, but associated order item is missing. Contact support.',
        'code', 'ORDER_ITEM_MISSING_FOR_EXISTING_ORDER',
        'orderId', v_existing_payment.order_id
      );
    end if;

    -- Validate product identity
    if v_existing_item.item_type::text <> p_item_type then
      return jsonb_build_object(
        'success', false,
        'error', 'Existing order item type (' || v_existing_item.item_type::text || ') does not match purchase item type (' || p_item_type || ').',
        'code', 'ORDER_ITEM_MISMATCH',
        'orderId', v_existing_payment.order_id
      );
    end if;

    if p_item_type = 'course' then
      if v_existing_item.course_id is distinct from v_effective_course_id then
        return jsonb_build_object(
          'success', false,
          'error', 'Existing order item course_id does not match purchase course_id.',
          'code', 'ORDER_ITEM_MISMATCH',
          'orderId', v_existing_payment.order_id
        );
      end if;
    elsif p_item_type = 'subscription_plan' then
      if v_existing_item.plan_id is distinct from p_plan_id
         or (v_existing_item.course_id is distinct from v_effective_course_id) then
        return jsonb_build_object(
          'success', false,
          'error', 'Existing order item plan_id or course_id does not match purchase specifications.',
          'code', 'ORDER_ITEM_MISMATCH',
          'orderId', v_existing_payment.order_id
        );
      end if;
    elsif p_item_type = 'pyq_package' then
      if v_existing_item.package_id is distinct from p_package_id then
        return jsonb_build_object(
          'success', false,
          'error', 'Existing order item package_id does not match purchase package_id.',
          'code', 'ORDER_ITEM_MISMATCH',
          'orderId', v_existing_payment.order_id
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
    -- CRITICAL FIX: Ensure role transition is applied if profile is still role = 'user'
    -- before returning idempotent success.
    if v_entitlement_active then
      if v_profile_role::text = 'user' then
        update public.profiles
        set role = 'student'::public.user_role,
            updated_at = p_transaction_timestamp
        where profile_id = p_profile_id;
        v_profile_role := 'student'::public.user_role;
      end if;

      return jsonb_build_object(
        'success', true,
        'verified', true,
        'alreadyProcessed', true,
        'orderId', v_existing_payment.order_id,
        'message', 'Purchase already processed and entitlement active'
      );
    end if;

    -- Entitlement is missing/inactive despite captured payment.
    -- Safely remediate: reuse existing order and item, skip duplicate payment insert,
    -- and proceed to ensure student role/details and grant the missing entitlement.
    v_order_id := v_existing_payment.order_id;
    v_item_id := v_existing_item.item_id;
    v_skip_payment_insert := true;
  end if;

  -- 8. Check for existing unfulfilled order with this purchaseToken / orderId
  if v_order_id is null then
    select o.order_id
    into v_order_id
    from public.orders o
    where o.profile_id = p_profile_id
      and (
        (p_effective_order_id is not null and (o.notes::jsonb ->> 'orderId') = p_effective_order_id)
        or (p_effective_order_id is null and p_purchase_token is not null and (o.notes::jsonb ->> 'purchaseToken') = p_purchase_token)
      )
    limit 1;

    if v_order_id is not null then
      select oi.item_id, oi.item_type, oi.course_id, oi.plan_id, oi.package_id
      into v_existing_item
      from public.order_items oi
      where oi.order_id = v_order_id
      limit 1;

      if v_existing_item.item_id is null then
        return jsonb_build_object(
          'success', false,
          'error', 'Existing order found for this purchase token but it has no associated order items. Failing closed to prevent partial order processing.',
          'code', 'ORDER_ITEM_MISSING_FOR_EXISTING_ORDER',
          'orderId', v_order_id
        );
      end if;

      if v_existing_item.item_type::text <> p_item_type then
        return jsonb_build_object(
          'success', false,
          'error', 'Existing order item type (' || v_existing_item.item_type::text || ') does not match purchase item type (' || p_item_type || ').',
          'code', 'ORDER_ITEM_MISMATCH',
          'orderId', v_order_id
        );
      end if;

      if p_item_type = 'course' then
        if v_existing_item.course_id is distinct from v_effective_course_id then
          return jsonb_build_object(
            'success', false,
            'error', 'Existing order item course_id does not match purchase course_id.',
            'code', 'ORDER_ITEM_MISMATCH',
            'orderId', v_order_id
          );
        end if;
      elsif p_item_type = 'subscription_plan' then
        if v_existing_item.plan_id is distinct from p_plan_id
           or (v_existing_item.course_id is distinct from v_effective_course_id) then
          return jsonb_build_object(
            'success', false,
            'error', 'Existing order item plan_id or course_id does not match purchase specifications.',
            'code', 'ORDER_ITEM_MISMATCH',
            'orderId', v_order_id
          );
        end if;
      elsif p_item_type = 'pyq_package' then
        if v_existing_item.package_id is distinct from p_package_id then
          return jsonb_build_object(
            'success', false,
            'error', 'Existing order item package_id does not match purchase package_id.',
            'code', 'ORDER_ITEM_MISMATCH',
            'orderId', v_order_id
          );
        end if;
      end if;

      v_item_id := v_existing_item.item_id;
    end if;
  end if;

  -- 9. Atomic Role Transition: Promote role = 'user' to 'student'
  -- CRITICAL FIX: Executes for ANY role = 'user', whether student_details already exists or not!
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

    -- Initialize student_details inside the transaction
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
      p_gateway_response,
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
    select subscription_id, status, end_date
    into v_existing_sub
    from public.student_subscriptions
    where student_id = v_student_id
      and plan_id = p_plan_id
      and status in ('active', 'grace')
    limit 1;

    -- Compute end_date, preserving early renewal remaining days if applicable
    if p_subscription_end_date is not null then
      v_calculated_end_date := p_subscription_end_date;
    elsif v_existing_sub.subscription_id is not null and v_existing_sub.end_date is not null and v_existing_sub.end_date >= v_start_date then
      v_calculated_end_date := (v_existing_sub.end_date + (v_plan_duration_days || ' days')::interval)::date;
    else
      v_calculated_end_date := (v_start_date + (v_plan_duration_days || ' days')::interval)::date;
    end if;

    -- Compute grace and content access boundaries
    v_grace_end_date := (v_calculated_end_date + (v_grace_days || ' days')::interval)::date;
    v_content_access_end_date := (v_grace_end_date + (v_content_access_days || ' days')::interval)::date;

    if v_existing_sub.subscription_id is not null then
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
      where subscription_id = v_existing_sub.subscription_id;
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
      select enrollment_id, enrollment_type
      into v_existing_enrollment
      from public.course_enrollments
      where course_id = v_effective_course_id
        and student_id = v_student_id
      limit 1;

      if v_existing_enrollment.enrollment_type = 'purchase' then
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
) is 'Migration 206: Atomic role transition (user -> student), staff protection, student_details initialization, global token advisory locking, and cross-profile isolation.';

revoke all on function public.complete_google_play_purchase(
  uuid, uuid, uuid, text, uuid, uuid, uuid, text, numeric, text, text, text, jsonb, timestamptz, date, boolean, text, text
) from public, anon, authenticated;

grant execute on function public.complete_google_play_purchase(
  uuid, uuid, uuid, text, uuid, uuid, uuid, text, numeric, text, text, text, jsonb, timestamptz, date, boolean, text, text
) to service_role;

-- Request PostgREST schema cache reload to ensure immediate RPC visibility
notify pgrst, 'reload schema';
