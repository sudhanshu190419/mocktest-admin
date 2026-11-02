-- Migration 233: Atomic Subsequent Installment Order Reservation & Gateway Order Synchronization
--
-- Architectural Objective:
--   1. Enables authenticated students with an active or in_arrears installment agreement
--      to reserve and pay their next eligible milestone installment.
--   2. Provides atomic single-creator gateway claim handling to serialize external
--      Razorpay order creation across concurrent Edge Function workers.
--
-- Security & Authorization:
--   1. Rejects anonymous calls (requires authenticated caller or trusted service_role).
--   2. Enforces auth.uid() = p_profile_id for authenticated callers to prevent profile spoofing.
--   3. Explicitly revokes execution from PUBLIC and anon roles.
--   4. Grants execution strictly to authenticated and service_role.
--   5. Verifies server-side agreement ownership against student_details.student_id.
--
-- Concurrency & Serialization Design:
--   1. Locks the target agreement row FOR UPDATE to strictly serialize simultaneous
--      checkout requests on the same agreement.
--   2. Post-lock check: inspects whether an active pending order already exists for this
--      agreement and next installment within the 24-hour reuse window. If so, safely
--      reuses and returns the existing valid pending reservation.
--   3. Tightened stale-order cleanup: cancels ONLY stale pending installment orders
--      belonging to this student, course, and agreement (or legacy unlinked installment
--      orders matching the agreement's exact plan older than 24 hours).
--      Never cancels full course purchases, subscriptions, PYQ packages, or another agreement's orders.
--   4. Exception guard: handles unique_violation (SQLSTATE 23505) by recovering and
--      returning the existing pending reservation rather than throwing an unhandled database error.
--   5. Single-creator gateway claim: acquire_gateway_order_claim atomically leases the right
--      to call the external payment gateway, preventing duplicate Razorpay orders.

-- ============================================================================
-- 1. Atomic Subsequent Installment Reservation RPC
-- ============================================================================
create or replace function public.reserve_subsequent_installment_order(
  p_profile_id uuid,
  p_agreement_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id           uuid;
  v_agreement            record;
  v_course               record;
  v_plan                 record;
  v_sched                record;
  v_existing_order       record;
  v_institute_timezone   text;
  v_current_local_date   date;
  v_effective_due_date   date;
  v_installment_amount   numeric(10,2);
  v_amount_paise         integer;
  v_currency             public.currency_code;
  v_order_id             uuid;
  v_payment_id           uuid;
  v_receipt_id           text;
  v_notes                jsonb;
begin
  -- 0. Authorization Guard
  -- Reject anonymous calls: caller must be service_role or have matching auth.uid()
  if auth.role() <> 'service_role' then
    if auth.uid() is null then
      return jsonb_build_object(
        'success', false,
        'error', 'Authentication required.',
        'code', 'UNAUTHENTICATED'
      );
    end if;

    if auth.uid() <> p_profile_id then
      return jsonb_build_object(
        'success', false,
        'error', 'Caller profile does not match authenticated user.',
        'code', 'FORBIDDEN_PROFILE_MISMATCH'
      );
    end if;
  end if;

  -- 1. Resolve student_id from caller's profile
  select student_id into v_student_id
  from public.student_details
  where profile_id = p_profile_id
  limit 1;

  if v_student_id is null then
    return jsonb_build_object(
      'success', false,
      'error', 'Student profile record not found.',
      'code', 'STUDENT_NOT_FOUND'
    );
  end if;

  -- 2. Lock & Validate Agreement FOR UPDATE (Strict Serialization across concurrent requests)
  select 
    sca.agreement_id,
    sca.student_id,
    sca.course_id,
    sca.plan_id,
    sca.total_fee,
    sca.outstanding_balance,
    sca.overdue_balance,
    sca.agreement_status,
    sca.agreement_date
  into v_agreement
  from public.student_course_agreements sca
  where sca.agreement_id = p_agreement_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'error', 'Installment agreement not found.',
      'code', 'AGREEMENT_NOT_FOUND'
    );
  end if;

  -- Ownership verification
  if v_agreement.student_id <> v_student_id then
    return jsonb_build_object(
      'success', false,
      'error', 'You are not authorized to make payments for this installment agreement.',
      'code', 'UNAUTHORIZED_AGREEMENT_ACCESS'
    );
  end if;

  -- Status verification
  if v_agreement.agreement_status not in ('active', 'in_arrears') then
    return jsonb_build_object(
      'success', false,
      'error', 'Agreement is currently ' || v_agreement.agreement_status || ' and not eligible for installment payment.',
      'code', 'AGREEMENT_NOT_PAYABLE'
    );
  end if;

  -- 3. Lock & Validate Course
  select course_id, institute_id, title, currency, is_active
  into v_course
  from public.courses
  where course_id = v_agreement.course_id
  for share;

  if not found then
    return jsonb_build_object(
      'success', false,
      'error', 'Course associated with agreement not found.',
      'code', 'COURSE_NOT_FOUND'
    );
  end if;

  -- 4. Lock & Validate Plan
  select plan_id, plan_name, number_of_installments, interval_months, total_fee
  into v_plan
  from public.course_installment_plans
  where plan_id = v_agreement.plan_id
  for share;

  if not found then
    return jsonb_build_object(
      'success', false,
      'error', 'Installment plan associated with agreement not found.',
      'code', 'PLAN_NOT_FOUND'
    );
  end if;

  -- Resolve institute timezone for date boundary calculation
  if v_course.institute_id is not null then
    select coalesce(timezone, 'Asia/Kolkata')
    into v_institute_timezone
    from public.institutes
    where institute_id = v_course.institute_id;
  end if;
  v_current_local_date := (now() at time zone coalesce(v_institute_timezone, 'Asia/Kolkata'))::date;

  -- 5. Identify Next Eligible Unpaid Installment (Strict FIFO)
  select 
    schedule_id,
    agreement_id,
    installment_index,
    due_date,
    revised_due_date,
    amount_due,
    amount_paid,
    waiver_amount,
    status
  into v_sched
  from public.student_installment_schedule
  where agreement_id = p_agreement_id
    and status in ('pending', 'overdue')
  order by installment_index asc
  limit 1
  for share;

  if not found then
    return jsonb_build_object(
      'success', false,
      'error', 'All scheduled installments for this agreement have already been settled.',
      'code', 'ALL_INSTALLMENTS_PAID'
    );
  end if;

  -- Calculate exact net payable amount for this installment
  v_installment_amount := round(v_sched.amount_due - v_sched.amount_paid - v_sched.waiver_amount, 2);

  if v_installment_amount <= 0.00 then
    return jsonb_build_object(
      'success', false,
      'error', 'The next scheduled installment has already been funded.',
      'code', 'INSTALLMENT_ALREADY_FUNDED'
    );
  end if;

  -- Check due date eligibility: installment is eligible if effective due date <= current date, or status is overdue
  v_effective_due_date := coalesce(v_sched.revised_due_date, v_sched.due_date);
  if v_effective_due_date > v_current_local_date and v_sched.status <> 'overdue' then
    return jsonb_build_object(
      'success', false,
      'error', 'Installment #' || v_sched.installment_index || ' is not yet due for payment (Due on ' || to_char(v_effective_due_date, 'YYYY-MM-DD') || ').',
      'code', 'INSTALLMENT_NOT_DUE',
      'installment_index', v_sched.installment_index,
      'due_date', v_effective_due_date
    );
  end if;

  v_amount_paise := (v_installment_amount * 100)::integer;
  v_currency := coalesce(v_course.currency, 'INR')::public.currency_code;

  -- 6. Check for an Existing Valid Pending Order for this Agreement & Installment (24h Reuse Window)
  select 
    o.order_id,
    o.total_amount,
    o.currency,
    p.payment_id,
    p.gateway_order_id,
    o.notes
  into v_existing_order
  from public.orders o
  join public.order_items oi on oi.order_id = o.order_id
  left join public.payments p on p.order_id = o.order_id and p.gateway = 'razorpay'
  where (o.profile_id = p_profile_id or o.student_id = v_student_id)
    and oi.agreement_id = p_agreement_id
    and oi.item_type = 'installment'::public.item_type
    and o.status = 'pending'
    and o.created_at >= (now() - interval '24 hours')
    and (o.notes::jsonb ->> 'installmentIndex')::integer = v_sched.installment_index
  order by o.created_at desc
  limit 1;

  if v_existing_order.order_id is not null then
    return jsonb_build_object(
      'success', true,
      'reused', true,
      'order_id', v_existing_order.order_id,
      'payment_id', v_existing_order.payment_id,
      'receipt_id', coalesce(v_existing_order.notes::jsonb ->> 'receiptId', 'rcpt_' || replace(v_existing_order.order_id::text, '-', '')),
      'razorpay_order_id', v_existing_order.gateway_order_id,
      'amount', v_installment_amount,
      'amount_paise', v_amount_paise,
      'currency', v_currency::text,
      'plan_id', v_plan.plan_id,
      'plan_name', v_plan.plan_name,
      'course_id', v_agreement.course_id,
      'course_name', v_course.title,
      'agreement_id', p_agreement_id,
      'installment_index', v_sched.installment_index,
      'schedule_id', v_sched.schedule_id,
      'total_fee', v_agreement.total_fee,
      'number_of_installments', v_plan.number_of_installments
    );
  end if;

  -- 7. Scoped Stale-Order Cleanup (Issue 2 Tightened):
  --    Cancel ONLY stale pending installment orders for this specific agreement
  --    OR legacy unlinked installment orders matching the exact plan that are older than 24 hours.
  update public.orders o
  set status = 'cancelled'::public.order_status,
      cancelled_at = now(),
      updated_at = now()
  where (o.profile_id = p_profile_id or (v_student_id is not null and o.student_id = v_student_id))
    and o.status = 'pending'
    -- Strictly require installment product type (never full course, subscription, or PYQ package)
    and (
      exists (
        select 1 from public.order_items oi
        where oi.order_id = o.order_id
          and oi.item_type = 'installment'::public.item_type
      )
      or (
        o.notes is not null
        and o.notes ~ '^\s*\{'
        and (
          (o.notes::jsonb ->> 'productType') = 'installment'
          or (o.notes::jsonb ->> 'installmentPlanId') is not null
        )
      )
    )
    -- Must belong to the exact course of this agreement
    and (
      exists (
        select 1 from public.order_items oi
        where oi.order_id = o.order_id
          and oi.course_id = v_agreement.course_id
      )
      or (
        o.notes is not null
        and o.notes ~ '^\s*\{'
        and (o.notes::jsonb ->> 'courseId') = v_agreement.course_id::text
      )
    )
    -- Must be linked to THIS target agreement, OR an unlinked legacy order matching the exact plan older than 24 hours
    and (
      -- Case A: Explicitly linked to THIS agreement
      exists (
        select 1 from public.order_items oi
        where oi.order_id = o.order_id
          and oi.agreement_id = p_agreement_id
      )
      or (
        o.notes is not null
        and o.notes ~ '^\s*\{'
        and (o.notes::jsonb ->> 'agreementId') = p_agreement_id::text
      )
      -- Case B: Legacy unlinked order matching this exact plan older than 24h
      or (
        (
          exists (
            select 1 from public.order_items oi
            where oi.order_id = o.order_id
              and oi.installment_plan_id = v_agreement.plan_id
              and oi.agreement_id is null
          )
          or (
            o.notes is not null
            and o.notes ~ '^\s*\{'
            and (o.notes::jsonb ->> 'installmentPlanId') = v_agreement.plan_id::text
            and (o.notes::jsonb ->> 'agreementId') is null
          )
        )
        and not exists (
          select 1 from public.order_items oi
          where oi.order_id = o.order_id
            and oi.agreement_id is not null
        )
        and o.created_at < (now() - interval '24 hours')
      )
    );

  -- 8. Generate order ID and deterministic receipt ID
  v_order_id := gen_random_uuid();
  v_receipt_id := 'rcpt_' || replace(v_order_id::text, '-', '');

  -- 9. Build order notes
  v_notes := jsonb_build_object(
    'productType', 'installment',
    'courseId', v_agreement.course_id,
    'courseName', v_course.title,
    'installmentPlanId', v_agreement.plan_id,
    'planName', v_plan.plan_name,
    'agreementId', p_agreement_id,
    'installmentIndex', v_sched.installment_index,
    'scheduleId', v_sched.schedule_id,
    'receiptId', v_receipt_id,
    'isSubsequentInstallment', true,
    'installmentAmount', v_installment_amount,
    'totalFee', v_agreement.total_fee
  );

  -- 10. Atomic Insert with Unique Violation Recovery
  begin
    -- Insert orders row
    insert into public.orders (
      order_id,
      institute_id,
      student_id,
      profile_id,
      status,
      fulfillment_status,
      currency,
      subtotal_amount,
      discount_amount,
      tax_amount,
      total_amount,
      notes,
      placed_at
    ) values (
      v_order_id,
      v_course.institute_id,
      v_student_id,
      p_profile_id,
      'pending'::public.order_status,
      'unfulfilled',
      v_currency,
      v_installment_amount,
      0.00,
      0.00,
      v_installment_amount,
      v_notes::text,
      now()
    );

    -- Insert order_items row with agreement_id pre-linked
    insert into public.order_items (
      order_id,
      institute_id,
      item_type,
      course_id,
      installment_plan_id,
      agreement_id,
      item_name,
      unit_price,
      quantity,
      discount_amount,
      line_total
    ) values (
      v_order_id,
      v_course.institute_id,
      'installment'::public.item_type,
      v_agreement.course_id,
      v_agreement.plan_id,
      p_agreement_id,
      v_course.title || ' - Installment #' || v_sched.installment_index,
      v_installment_amount,
      1,
      0.00,
      v_installment_amount
    );

    -- Insert initial pending payments placeholder
    v_payment_id := gen_random_uuid();
    insert into public.payments (
      payment_id,
      order_id,
      institute_id,
      attempt_number,
      gateway,
      amount,
      currency,
      status
    ) values (
      v_payment_id,
      v_order_id,
      v_course.institute_id,
      1,
      'razorpay'::public.payment_gateway,
      v_installment_amount,
      v_currency,
      'pending'::public.payment_status
    );

  exception when unique_violation then
    -- Concurrent race condition fallback: retrieve the winner's pending order
    select 
      o.order_id,
      p.payment_id,
      p.gateway_order_id,
      o.notes
    into v_existing_order
    from public.orders o
    join public.order_items oi on oi.order_id = o.order_id
    left join public.payments p on p.order_id = o.order_id and p.gateway = 'razorpay'
    where (o.profile_id = p_profile_id or o.student_id = v_student_id)
      and o.status = 'pending'
      and (oi.agreement_id = p_agreement_id or o.notes::jsonb ->> 'agreementId' = p_agreement_id::text)
    order by o.created_at desc
    limit 1;

    if v_existing_order.order_id is not null then
      return jsonb_build_object(
        'success', true,
        'reused', true,
        'order_id', v_existing_order.order_id,
        'payment_id', v_existing_order.payment_id,
        'receipt_id', coalesce(v_existing_order.notes::jsonb ->> 'receiptId', 'rcpt_' || replace(v_existing_order.order_id::text, '-', '')),
        'razorpay_order_id', v_existing_order.gateway_order_id,
        'amount', v_installment_amount,
        'amount_paise', v_amount_paise,
        'currency', v_currency::text,
        'plan_id', v_plan.plan_id,
        'plan_name', v_plan.plan_name,
        'course_id', v_agreement.course_id,
        'course_name', v_course.title,
        'agreement_id', p_agreement_id,
        'installment_index', v_sched.installment_index,
        'schedule_id', v_sched.schedule_id,
        'total_fee', v_agreement.total_fee,
        'number_of_installments', v_plan.number_of_installments
      );
    else
      raise;
    end if;
  end;

  return jsonb_build_object(
    'success', true,
    'reused', false,
    'order_id', v_order_id,
    'payment_id', v_payment_id,
    'receipt_id', v_receipt_id,
    'amount', v_installment_amount,
    'amount_paise', v_amount_paise,
    'currency', v_currency::text,
    'plan_id', v_plan.plan_id,
    'plan_name', v_plan.plan_name,
    'course_id', v_agreement.course_id,
    'course_name', v_course.title,
    'agreement_id', p_agreement_id,
    'installment_index', v_sched.installment_index,
    'schedule_id', v_sched.schedule_id,
    'total_fee', v_agreement.total_fee,
    'number_of_installments', v_plan.number_of_installments
  );
end;
$$;

comment on function public.reserve_subsequent_installment_order is
  'Atomically reserves an order and payment placeholder for the next eligible unpaid installment tranche of an active/in_arrears agreement with FOR UPDATE serialization, auth.uid() enforcement, and 23505 race recovery.';

revoke all on function public.reserve_subsequent_installment_order(uuid, uuid) from public;
revoke all on function public.reserve_subsequent_installment_order(uuid, uuid) from anon;
grant execute on function public.reserve_subsequent_installment_order(uuid, uuid) to authenticated;
grant execute on function public.reserve_subsequent_installment_order(uuid, uuid) to service_role;


-- ============================================================================
-- 2. Atomic Single-Creator Gateway Order Claim RPC
-- ============================================================================
create or replace function public.acquire_gateway_order_claim(
  p_order_id uuid,
  p_claimant text,
  p_lease_seconds integer default 15
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notes              jsonb;
  v_gateway_order_id   text;
  v_existing_claimant  text;
  v_claimed_at         timestamptz;
  v_now                timestamptz := now();
begin
  -- 1. Check if a gateway_order_id is already persisted on payments
  select gateway_order_id into v_gateway_order_id
  from public.payments
  where order_id = p_order_id
    and gateway = 'razorpay'
    and gateway_order_id is not null
  order by created_at desc
  limit 1;

  if v_gateway_order_id is not null then
    return jsonb_build_object(
      'status', 'ALREADY_COMPLETED',
      'gateway_order_id', v_gateway_order_id
    );
  end if;

  -- 2. Lock orders row FOR UPDATE to evaluate and grant the claim atomically
  select notes::jsonb into v_notes
  from public.orders
  where order_id = p_order_id
  for update;

  if not found then
    return jsonb_build_object(
      'status', 'ERROR',
      'error', 'Order not found',
      'code', 'ORDER_NOT_FOUND'
    );
  end if;

  -- 3. Check existing claim in orders.notes
  v_existing_claimant := v_notes -> 'gatewayClaim' ->> 'claimant';
  v_claimed_at := (v_notes -> 'gatewayClaim' ->> 'claimedAt')::timestamptz;

  -- If an active lease is held by another worker and has not expired:
  if v_existing_claimant is not null 
     and v_claimed_at is not null 
     and v_claimed_at + (p_lease_seconds || ' seconds')::interval > v_now 
     and v_existing_claimant <> p_claimant then
    return jsonb_build_object(
      'status', 'LEASE_ACTIVE',
      'claimant', v_existing_claimant,
      'expires_at', v_claimed_at + (p_lease_seconds || ' seconds')::interval
    );
  end if;

  -- 4. Grant / Renew the lease to this claimant
  v_notes := jsonb_set(
    coalesce(v_notes, '{}'::jsonb),
    '{gatewayClaim}',
    jsonb_build_object('claimant', p_claimant, 'claimedAt', v_now)
  );

  update public.orders
  set notes = v_notes::text,
      updated_at = v_now
  where order_id = p_order_id;

  return jsonb_build_object(
    'status', 'CLAIMED',
    'claimant', p_claimant
  );
end;
$$;

comment on function public.acquire_gateway_order_claim is
  'Atomically coordinates external gateway order creation among concurrent workers using a lease to guarantee single-creator semantics. Supports safe lease renewal when invoked by the active claimant (resets claimedAt), and allows safe takeover after lease expiry (worker crash recovery) without blocking checkout.';

revoke all on function public.acquire_gateway_order_claim(uuid, text, integer) from public;
revoke all on function public.acquire_gateway_order_claim(uuid, text, integer) from anon;
grant execute on function public.acquire_gateway_order_claim(uuid, text, integer) to authenticated;
grant execute on function public.acquire_gateway_order_claim(uuid, text, integer) to service_role;
