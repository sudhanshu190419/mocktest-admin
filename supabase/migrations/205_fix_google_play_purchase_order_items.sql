-- ============================================================================
-- Migration 205: Fix Google Play Purchase Atomic RPC Schema Compatibility
--
-- PURPOSE:
-- 1. Corrects public.complete_google_play_purchase to remove the non-existent
--    updated_at column from public.order_items insert.
--    - The actual public.order_items table (Domain 07 Commerce, Migration 008)
--      is an immutable transaction line-item ledger that has created_at but
--      never had an updated_at column.
-- 2. Adds explicit enum casting p_item_type::public.item_type to guarantee
--    type compatibility under empty search_path (SET search_path = '').
-- 3. Aligns the non-blocking draft invoice insert with the actual public.invoices
--    schema (issued_at instead of issue_date).
-- 4. Protects existing orders: when an existing unfulfilled order is found,
--    verifies that an associated order_items row exists and matches product type,
--    course_id, plan_id, and package_id. Fails closed with ORDER_ITEM_MISSING_FOR_EXISTING_ORDER
--    or ORDER_ITEM_MISMATCH without inserting payments or granting entitlements.
-- 5. Preserves ALL existing functionality from Migration 204:
--    - 18-argument signature parity
--    - 7-day grace and 30-day content window date calculations
--    - Multi-tenant institute system_settings lookup
--    - ck_payments_paid_at timestamp constraint satisfaction
--    - Idempotent replay protection with account mismatch rejection
--    - Permanent course ownership preservation (Migration 096)
--    - Atomic single-transaction commit
--    - service_role execution restriction
--
-- NOTE: Prepared locally. DO NOT apply directly to production without review.
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
  v_existing_sub record;
  v_existing_enrollment record;
  v_target_enrollment_type text;
  v_entitlement text := '';
  v_year text;
  v_invoice_num text;

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

  -- 1. Defensively resolve student_details.student_id from profile_id
  select student_id into v_student_id
  from public.student_details
  where profile_id = p_profile_id;

  if v_student_id is null and p_student_id is not null then
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
      v_order_notes,
      p_transaction_timestamp,
      p_transaction_timestamp,
      p_transaction_timestamp,
      p_transaction_timestamp
    )
    returning order_id into v_order_id;

    -- Corrected: public.order_items is an immutable ledger table that has
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
      p_institute_id,
      p_item_type::public.item_type,
      p_course_id,
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
  else
    -- Verify that an associated order_items row exists for the existing order
    select item_id, item_type, course_id, plan_id, package_id
    into v_existing_item
    from public.order_items
    where order_id = v_order_id
    limit 1;

    if v_existing_item.item_id is null then
      return jsonb_build_object(
        'success', false,
        'error', 'Existing order found for this purchase token but it has no associated order items. Failing closed to prevent partial order processing.',
        'code', 'ORDER_ITEM_MISSING_FOR_EXISTING_ORDER',
        'orderId', v_order_id
      );
    end if;

    -- Verify that the existing line item matches requested item_type
    if v_existing_item.item_type::text <> p_item_type then
      return jsonb_build_object(
        'success', false,
        'error', 'Existing order item type (' || v_existing_item.item_type::text || ') does not match purchase item type (' || p_item_type || ').',
        'code', 'ORDER_ITEM_MISMATCH',
        'orderId', v_order_id
      );
    end if;

    -- Verify that course_id, plan_id, and package_id match as applicable
    if p_item_type = 'course' then
      if v_existing_item.course_id is distinct from p_course_id then
        return jsonb_build_object(
          'success', false,
          'error', 'Existing order item course_id does not match purchase course_id.',
          'code', 'ORDER_ITEM_MISMATCH',
          'orderId', v_order_id
        );
      end if;
    elsif p_item_type = 'subscription_plan' then
      if v_existing_item.plan_id is distinct from p_plan_id
         or (p_course_id is not null and v_existing_item.course_id is distinct from p_course_id) then
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
    -- Load institute-level configuration from system_settings (defaults: 7d grace, 30d content)
    select coalesce(
      (select setting_value::int
       from public.system_settings
       where institute_id = p_institute_id
         and setting_key = 'grace_days'
         and is_active = true
       limit 1),
      7
    ) into v_grace_days;

    select coalesce(
      (select setting_value::int
       from public.system_settings
       where institute_id = p_institute_id
         and setting_key = 'content_access_days'
         and is_active = true
       limit 1),
      30
    ) into v_content_access_days;

    -- Fetch plan duration for fallback calculation
    select coalesce(duration_days, 30)
    into v_plan_duration_days
    from public.subscription_plans
    where plan_id = p_plan_id;

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
        p_course_id,
        p_institute_id,
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
      created_at,
      updated_at
    ) values (
      p_package_id,
      v_student_id,
      p_institute_id,
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

  -- 7. Snapshot draft invoice (non-blocking accounting artifact)
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
      p_institute_id,
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
) is 'Migration 205: Fix order_items insert column mismatch (removed updated_at), explicit item_type enum casting, and issued_at invoice alignment.';

revoke all on function public.complete_google_play_purchase(
  uuid, uuid, uuid, text, uuid, uuid, uuid, text, numeric, text, text, text, jsonb, timestamptz, date, boolean, text, text
) from public, anon, authenticated;

grant execute on function public.complete_google_play_purchase(
  uuid, uuid, uuid, text, uuid, uuid, uuid, text, numeric, text, text, text, jsonb, timestamptz, date, boolean, text, text
) to service_role;

-- Request PostgREST schema cache reload to ensure immediate RPC visibility
notify pgrst, 'reload schema';
