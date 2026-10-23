-- ============================================================================
-- Migration 203: Atomic Google Play Purchase Completion RPC
--
-- PURPOSE:
-- Executes the complete Google Play purchase recording workflow atomically
-- inside a single PostgreSQL transaction (ACID):
--   1. Replay and cross-account ownership validation.
--   2. Order reuse (idempotency) or creation with Google Play correlation metadata.
--   3. Order item snapshot creation.
--   4. Payment recording in 'captured' status with consistent timestamps
--      (created_at = paid_at = transaction_timestamp) satisfying ck_payments_paid_at.
--   5. Entitlement grant (course_enrollments or student_subscriptions):
--      - For subscriptions: update in-place if active/grace exists (086 invariant).
--      - For course enrollments: preserve permanent ownership ('purchase') if present (096 invariant).
--   6. Non-blocking draft invoice snapshot creation.
--
-- SECURITY GUARDS:
--   - Role restricted to service_role only (cannot be called by anon or authenticated).
--   - search_path is strictly pinned to empty (prevents search_path hijacking).
--
-- NOTE: Local migration only. DO NOT apply directly to production database
-- without operator review and approval.
-- ============================================================================

-- Ensure 'google_play' exists in the payment_gateway enum
do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumtypid = 'public.payment_gateway'::regtype
      and enumlabel = 'google_play'
  ) then
    alter type public.payment_gateway add value 'google_play';
  end if;
end $$;

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
  v_order_id uuid;
  v_item_id uuid;
  v_order_notes jsonb;
  v_student_id uuid;
  v_existing_sub record;
  v_existing_enrollment record;
  v_target_enrollment_type text;
  v_entitlement text := '';
  v_year text;
  v_invoice_num text;
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

  -- 1. Defensively resolve student_details.student_id from profile_id
  select student_id into v_student_id
  from public.student_details
  where profile_id = p_profile_id;

  if v_student_id is null and p_student_id is not null then
    -- Verify that p_student_id exists in student_details
    select student_id into v_student_id
    from public.student_details
    where student_id = p_student_id;
  end if;

  if v_student_id is null then
    return jsonb_build_object(
      'success', false,
      'error', 'Student details record not found for profile',
      'code', 'STUDENT_NOT_FOUND'
    );
  end if;

  -- 2. Check existing captured payment (idempotency / replay)
  select p.payment_id, p.order_id, o.profile_id
  into v_existing_payment
  from public.payments p
  join public.orders o on o.order_id = p.order_id
  where p.gateway = 'google_play'
    and p.status = 'captured'
    and (
      p.gateway_payment_id = p_effective_order_id
      or p.gateway_order_id = p_effective_order_id
      or (p.gateway_response ->> 'purchaseToken') = p_purchase_token
    )
  limit 1;

  if v_existing_payment.payment_id is not null then
    if v_existing_payment.profile_id <> p_profile_id then
      return jsonb_build_object(
        'success', false,
        'error', 'This purchase has already been claimed by another account. Please sign in with the original account or contact support.',
        'code', 'ACCOUNT_MISMATCH'
      );
    end if;

    return jsonb_build_object(
      'success', true,
      'verified', true,
      'alreadyProcessed', true,
      'orderId', v_existing_payment.order_id,
      'message', 'Purchase already processed and entitlement active'
    );
  end if;

  -- 3. Build structured order notes with correlation metadata
  v_order_notes := jsonb_build_object(
    'gateway', 'google_play',
    'purchaseToken', p_purchase_token,
    'orderId', p_effective_order_id,
    'productId', p_product_id,
    'itemType', p_item_type,
    'courseId', p_course_id,
    'planId', p_plan_id,
    'packageId', p_package_id
  );

  -- 4. Check for existing unfulfilled order with this purchaseToken / orderId
  select o.order_id
  into v_order_id
  from public.orders o
  where o.profile_id = p_profile_id
    and (
      (o.notes::jsonb ->> 'purchaseToken') = p_purchase_token
      or (o.notes::jsonb ->> 'orderId') = p_effective_order_id
    )
  limit 1;

  -- If not found, create new order and order_item
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
      p_institute_id,
      v_student_id,
      p_profile_id,
      'confirmed',
      'INR'::public.currency_code,
      p_unit_price,
      0.00,
      0.00,
      p_unit_price,
      v_order_notes::text,
      p_transaction_timestamp,
      p_transaction_timestamp,
      p_transaction_timestamp,
      p_transaction_timestamp
    )
    returning order_id into v_order_id;

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
      created_at,
      updated_at
    ) values (
      v_order_id,
      p_institute_id,
      p_item_type::public.item_type,
      case when p_item_type in ('course', 'subscription_plan') then p_course_id else null end,
      case when p_item_type = 'subscription_plan' then p_plan_id else null end,
      case when p_item_type = 'pyq_package' then p_package_id else null end,
      p_item_name,
      p_unit_price,
      1,
      0.00,
      p_unit_price,
      p_transaction_timestamp,
      p_transaction_timestamp
    )
    returning item_id into v_item_id;
  else
    -- Reuse existing order item if present
    select item_id into v_item_id
    from public.order_items
    where order_id = v_order_id
    limit 1;
  end if;

  -- 5. Insert Payment record satisfying ck_payments_paid_at
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
    p_institute_id,
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

  -- 6. Grant Entitlement
  if p_item_type = 'course' and p_course_id is not null then
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
      p_course_id,
      v_student_id,
      p_institute_id,
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

    v_entitlement := 'course_enrollment:' || p_course_id::text;

  elsif p_item_type = 'subscription_plan' and p_plan_id is not null then
    -- Check if active or grace subscription exists (Migration 086 / 096)
    select subscription_id, status
    into v_existing_sub
    from public.student_subscriptions
    where student_id = v_student_id
      and plan_id = p_plan_id
      and status in ('active', 'grace')
    limit 1;

    if v_existing_sub.subscription_id is not null then
      update public.student_subscriptions
      set order_id = v_order_id,
          status = 'active',
          start_date = (p_transaction_timestamp at time zone 'utc')::date,
          end_date = coalesce(p_subscription_end_date, ((p_transaction_timestamp at time zone 'utc')::date + interval '30 days')::date),
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
        is_auto_renew,
        payment_method_id,
        created_at,
        updated_at
      ) values (
        v_student_id,
        p_plan_id,
        p_course_id,
        p_institute_id,
        v_order_id,
        'active',
        (p_transaction_timestamp at time zone 'utc')::date,
        coalesce(p_subscription_end_date, ((p_transaction_timestamp at time zone 'utc')::date + interval '30 days')::date),
        p_is_auto_renew,
        p_purchase_token,
        p_transaction_timestamp,
        p_transaction_timestamp
      );
    end if;

    -- Grant course access, but preserve permanent ownership ('purchase') per Migration 096
    if p_course_id is not null then
      select enrollment_id, enrollment_type
      into v_existing_enrollment
      from public.course_enrollments
      where course_id = p_course_id
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
        p_course_id,
        v_student_id,
        p_institute_id,
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
      revoked_at,
      revoked_reason
    ) values (
      p_package_id,
      v_student_id,
      p_institute_id,
      v_item_id,
      'purchase',
      true,
      p_transaction_timestamp,
      null,
      null
    )
    on conflict (package_id, student_id)
    do update set
      is_active = true,
      access_type = 'purchase',
      revoked_at = null,
      revoked_reason = null;

    v_entitlement := 'pyq_purchase:' || p_package_id::text;
  end if;

  -- 7. Insert draft invoice (non-fatal snapshot)
  begin
    v_year := to_char(p_transaction_timestamp, 'YYYY');
    v_invoice_num := 'INV-GP-' || v_year || '-' || upper(substring(v_order_id::text from 1 for 8));

    insert into public.invoices (
      order_id,
      institute_id,
      invoice_number,
      status,
      billing_name,
      billing_email,
      subtotal_amount,
      discount_amount,
      tax_amount,
      total_amount,
      currency,
      created_at,
      updated_at
    ) values (
      v_order_id,
      p_institute_id,
      v_invoice_num,
      'draft',
      coalesce(p_billing_name, 'Student'),
      coalesce(p_billing_email, 'student@makemetopper.com'),
      p_unit_price,
      0.00,
      0.00,
      p_unit_price,
      'INR'::public.currency_code,
      p_transaction_timestamp,
      p_transaction_timestamp
    );
  exception when others then
    -- Invoice snapshot is a non-fatal accounting record; do not abort the transaction
    null;
  end;

  return jsonb_build_object(
    'success', true,
    'verified', true,
    'orderId', v_order_id,
    'entitlement', v_entitlement
  );
end;
$$;

-- Revoke execute from public/anon/authenticated and grant strictly to service_role
revoke all on function public.complete_google_play_purchase from public, anon, authenticated;
grant execute on function public.complete_google_play_purchase to service_role;

comment on function public.complete_google_play_purchase is
  'Atomic RPC for verifying and recording Google Play purchases. '
  'Restricted to service_role. Guarantees all orders, payments, subscriptions, and '
  'enrollments commit in a single transaction with identical created_at/paid_at timestamps.';
