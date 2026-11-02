-- ============================================================================
-- Migration: 238 — Fix Subsequent Installment Reservation Course Is Active
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready | Idempotent
--
-- ## Root Cause
-- In Migration 233 and Migration 234, public.reserve_subsequent_installment_order
-- queries public.courses at Step 3 to resolve course details:
--   select course_id, institute_id, title, currency, is_active
--   into v_course
--   from public.courses
--   where course_id = v_agreement.course_id
--   for share;
--
-- However, public.courses does not contain an is_active column (course status is
-- represented via status: draft/published/archived and soft-deletion via deleted_at).
-- Furthermore, v_course.is_active is never referenced anywhere in the function.
-- When a student attempts to pay a subsequent installment (e.g. installment #2),
-- PostgreSQL raises runtime error:
--   column "is_active" does not exist (SQLSTATE 42703)
-- causing create-payment-order to fail with:
--   "Failed to reserve installment order: column "is_active" does not exist"
--
-- ## Remediation
-- Redefine public.reserve_subsequent_installment_order(uuid, uuid) with
-- CREATE OR REPLACE FUNCTION, selecting valid columns:
--   select course_id, institute_id, title, currency
-- while preserving 100% of the function implementation, authorization,
-- student verification, canonical row locking order, FIFO schedule selection,
-- effective due date resolution COALESCE(revised_due_date, due_date),
-- 24-hour pending order reuse, attempt tracking, and return payloads.
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
  v_latest_payment       record;
  v_institute_timezone   text;
  v_current_local_date   date;
  v_effective_due_date   date;
  v_installment_amount   numeric(10,2);
  v_amount_paise         integer;
  v_currency             public.currency_code;
  v_order_id             uuid;
  v_payment_id           uuid;
  v_attempt_number       integer;
  v_receipt_id           text;
  v_razorpay_order_id    text;
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
  select course_id, institute_id, title, currency
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
  -- Lock internal orders row FOR UPDATE to strictly serialize concurrent retry / claim workers
  select 
    o.order_id,
    o.total_amount,
    o.currency,
    o.notes
  into v_existing_order
  from public.orders o
  join public.order_items oi on oi.order_id = o.order_id
  where (o.profile_id = p_profile_id or o.student_id = v_student_id)
    and oi.agreement_id = p_agreement_id
    and oi.item_type = 'installment'::public.item_type
    and o.status = 'pending'
    and o.created_at >= (now() - interval '24 hours')
    and (o.notes::jsonb ->> 'installmentIndex')::integer = v_sched.installment_index
  order by o.created_at desc
  limit 1
  for update of o;

  if v_existing_order.order_id is not null then
    -- Inspect the latest payment attempt for this exact internal order
    select 
      payment_id,
      attempt_number,
      status,
      gateway_order_id,
      created_at
    into v_latest_payment
    from public.payments
    where order_id = v_existing_order.order_id
      and gateway = 'razorpay'
    order by attempt_number desc
    limit 1
    for update;

    -- Guard: Check if target installment is already fully settled,
    -- or if ANY payment for this specific internal order was already captured or allocated.
    -- (Partial payments with remaining balances are supported; unallocated balance check is authoritative).
    if v_sched.status not in ('pending', 'overdue')
       or round(v_sched.amount_due - v_sched.amount_paid - v_sched.waiver_amount, 2) <= 0.00
       or exists (
         select 1 from public.payments
         where order_id = v_existing_order.order_id
           and status = 'captured'
       )
       or exists (
         select 1 from public.installment_payment_allocations ipa
         join public.payments p on p.payment_id = ipa.payment_id
         where p.order_id = v_existing_order.order_id
       ) then
      return jsonb_build_object(
        'success', false,
        'error', 'This installment has already been settled.',
        'code', 'INSTALLMENT_ALREADY_PAID',
        'installment_index', v_sched.installment_index
      );
    end if;

    -- Strict Payment Attempt Evaluation:
    if v_latest_payment.payment_id is null then
      -- 1. No prior payment attempt row exists: safely create attempt 1
      v_payment_id := gen_random_uuid();
      v_attempt_number := 1;
      v_receipt_id := 'rcpt_' || replace(v_payment_id::text, '-', '');
      v_razorpay_order_id := null;

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
        v_existing_order.order_id,
        v_course.institute_id,
        1,
        'razorpay'::public.payment_gateway,
        v_installment_amount,
        v_currency,
        'pending'::public.payment_status
      );

      update public.orders
      set notes = (
        coalesce(v_existing_order.notes::jsonb, '{}'::jsonb)
        || jsonb_build_object(
             'paymentId', v_payment_id,
             'receiptId', v_receipt_id,
             'attemptNumber', 1
           )
      )::text,
      updated_at = now()
      where order_id = v_existing_order.order_id;

    elsif v_latest_payment.status = 'pending' then
      -- 2. Latest attempt is pending: reuse that exact pending attempt
      v_payment_id := v_latest_payment.payment_id;
      v_attempt_number := v_latest_payment.attempt_number;
      v_razorpay_order_id := v_latest_payment.gateway_order_id;
      v_receipt_id := 'rcpt_' || replace(v_payment_id::text, '-', '');

      -- Ensure orders.notes has current paymentId and receiptId
      update public.orders
      set notes = (
        coalesce(v_existing_order.notes::jsonb, '{}'::jsonb)
        || jsonb_build_object(
             'paymentId', v_payment_id,
             'receiptId', v_receipt_id,
             'attemptNumber', v_attempt_number
           )
      )::text,
      updated_at = now()
      where order_id = v_existing_order.order_id;

    elsif v_latest_payment.status = 'failed' then
      -- 3. Latest attempt failed: retain failed row, generate new payment_id and incremented attempt_number
      v_payment_id := gen_random_uuid();
      v_attempt_number := coalesce(v_latest_payment.attempt_number, 0) + 1;
      v_receipt_id := 'rcpt_' || replace(v_payment_id::text, '-', '');
      v_razorpay_order_id := null;

      -- Insert new pending payment attempt row
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
        v_existing_order.order_id,
        v_course.institute_id,
        v_attempt_number,
        'razorpay'::public.payment_gateway,
        v_installment_amount,
        v_currency,
        'pending'::public.payment_status
      );

      -- Update orders.notes: record new attempt details and purge previous attempt's gateway order & claim
      update public.orders
      set notes = (
        coalesce(v_existing_order.notes::jsonb, '{}'::jsonb)
        || jsonb_build_object(
             'paymentId', v_payment_id,
             'receiptId', v_receipt_id,
             'attemptNumber', v_attempt_number
           )
        - 'razorpayOrderId'
        - 'gatewayClaim'
      )::text,
      updated_at = now()
      where order_id = v_existing_order.order_id;

    elsif v_latest_payment.status = 'captured' then
      -- 4. Captured payment attempt: fail closed
      return jsonb_build_object(
        'success', false,
        'error', 'This installment has already been settled.',
        'code', 'INSTALLMENT_ALREADY_PAID',
        'installment_index', v_sched.installment_index
      );

    elsif v_latest_payment.status in ('refunded', 'partially_refunded') then
      -- 5. Refunded payment attempt: fail closed explicitly
      return jsonb_build_object(
        'success', false,
        'error', 'Payment attempt for this order was refunded. Please contact institute administration.',
        'code', 'PAYMENT_ALREADY_REFUNDED',
        'payment_status', v_latest_payment.status::text,
        'installment_index', v_sched.installment_index
      );

    else
      -- 6. Any other unhandled/unknown status: fail closed
      return jsonb_build_object(
        'success', false,
        'error', 'Existing payment attempt is in an unpayable status: ' || v_latest_payment.status::text,
        'code', 'INVALID_PAYMENT_STATUS',
        'payment_status', v_latest_payment.status::text,
        'installment_index', v_sched.installment_index
      );
    end if;

    return jsonb_build_object(
      'success', true,
      'reused', true,
      'order_id', v_existing_order.order_id,
      'payment_id', v_payment_id,
      'attempt_number', v_attempt_number,
      'receipt_id', v_receipt_id,
      'razorpay_order_id', v_razorpay_order_id,
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

  -- 7. Scoped Stale-Order Cleanup:
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

  -- 8. Generate order ID and initial payment attempt ID
  v_order_id := gen_random_uuid();
  v_payment_id := gen_random_uuid();
  v_attempt_number := 1;
  v_receipt_id := 'rcpt_' || replace(v_payment_id::text, '-', '');

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
    'paymentId', v_payment_id,
    'receiptId', v_receipt_id,
    'attemptNumber', 1,
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
      o.notes
    into v_existing_order
    from public.orders o
    join public.order_items oi on oi.order_id = o.order_id
    where (o.profile_id = p_profile_id or o.student_id = v_student_id)
      and o.status = 'pending'
      and (oi.agreement_id = p_agreement_id or o.notes::jsonb ->> 'agreementId' = p_agreement_id::text)
    order by o.created_at desc
    limit 1
    for update of o;

    if v_existing_order.order_id is not null then
      -- Inspect the latest payment attempt for the winner's order
      select 
        payment_id,
        attempt_number,
        status,
        gateway_order_id
      into v_latest_payment
      from public.payments
      where order_id = v_existing_order.order_id
        and gateway = 'razorpay'
      order by attempt_number desc
      limit 1
      for update;

      -- Guard: Check if target installment is already fully settled,
      -- or if ANY payment for this specific internal order was already captured or allocated.
      -- (Partial payments with remaining balances are supported; unallocated balance check is authoritative).
      if v_sched.status not in ('pending', 'overdue')
         or round(v_sched.amount_due - v_sched.amount_paid - v_sched.waiver_amount, 2) <= 0.00
         or exists (
           select 1 from public.payments
           where order_id = v_existing_order.order_id
             and status = 'captured'
         )
         or exists (
           select 1 from public.installment_payment_allocations ipa
           join public.payments p on p.payment_id = ipa.payment_id
           where p.order_id = v_existing_order.order_id
         ) then
        return jsonb_build_object(
          'success', false,
          'error', 'This installment has already been settled.',
          'code', 'INSTALLMENT_ALREADY_PAID',
          'installment_index', v_sched.installment_index
        );
      end if;

      if v_latest_payment.payment_id is null then
        -- 1. No payment attempt exists yet: create attempt 1
        v_payment_id := gen_random_uuid();
        v_attempt_number := 1;
        v_receipt_id := 'rcpt_' || replace(v_payment_id::text, '-', '');
        v_razorpay_order_id := null;

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
          v_existing_order.order_id,
          v_course.institute_id,
          1,
          'razorpay'::public.payment_gateway,
          v_installment_amount,
          v_currency,
          'pending'::public.payment_status
        );

        update public.orders
        set notes = (
          coalesce(v_existing_order.notes::jsonb, '{}'::jsonb)
          || jsonb_build_object(
               'paymentId', v_payment_id,
               'receiptId', v_receipt_id,
               'attemptNumber', 1
             )
        )::text,
        updated_at = now()
        where order_id = v_existing_order.order_id;

      elsif v_latest_payment.status = 'pending' then
        -- 2. Latest attempt is pending: reuse that exact pending attempt
        v_payment_id := v_latest_payment.payment_id;
        v_attempt_number := v_latest_payment.attempt_number;
        v_razorpay_order_id := v_latest_payment.gateway_order_id;
        v_receipt_id := 'rcpt_' || replace(v_payment_id::text, '-', '');

        update public.orders
        set notes = (
          coalesce(v_existing_order.notes::jsonb, '{}'::jsonb)
          || jsonb_build_object(
               'paymentId', v_payment_id,
               'receiptId', v_receipt_id,
               'attemptNumber', v_attempt_number
             )
        )::text,
        updated_at = now()
        where order_id = v_existing_order.order_id;

      elsif v_latest_payment.status = 'failed' then
        -- 3. Latest attempt failed: create new attempt with incremented attempt_number
        v_payment_id := gen_random_uuid();
        v_attempt_number := coalesce(v_latest_payment.attempt_number, 0) + 1;
        v_receipt_id := 'rcpt_' || replace(v_payment_id::text, '-', '');
        v_razorpay_order_id := null;

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
          v_existing_order.order_id,
          v_course.institute_id,
          v_attempt_number,
          'razorpay'::public.payment_gateway,
          v_installment_amount,
          v_currency,
          'pending'::public.payment_status
        );

        update public.orders
        set notes = (
          coalesce(v_existing_order.notes::jsonb, '{}'::jsonb)
          || jsonb_build_object(
               'paymentId', v_payment_id,
               'receiptId', v_receipt_id,
               'attemptNumber', v_attempt_number
             )
          - 'razorpayOrderId'
          - 'gatewayClaim'
        )::text,
        updated_at = now()
        where order_id = v_existing_order.order_id;

      elsif v_latest_payment.status = 'captured' then
        -- 4. Captured payment attempt: fail closed
        return jsonb_build_object(
          'success', false,
          'error', 'This installment has already been settled.',
          'code', 'INSTALLMENT_ALREADY_PAID',
          'installment_index', v_sched.installment_index
        );

      elsif v_latest_payment.status in ('refunded', 'partially_refunded') then
        -- 5. Refunded payment attempt: fail closed explicitly
        return jsonb_build_object(
          'success', false,
          'error', 'Payment attempt for this order was refunded. Please contact institute administration.',
          'code', 'PAYMENT_ALREADY_REFUNDED',
          'payment_status', v_latest_payment.status::text,
          'installment_index', v_sched.installment_index
        );

      else
        -- 6. Any other unhandled/unknown status: fail closed
        return jsonb_build_object(
          'success', false,
          'error', 'Existing payment attempt is in an unpayable status: ' || v_latest_payment.status::text,
          'code', 'INVALID_PAYMENT_STATUS',
          'payment_status', v_latest_payment.status::text,
          'installment_index', v_sched.installment_index
        );
      end if;

      return jsonb_build_object(
        'success', true,
        'reused', true,
        'order_id', v_existing_order.order_id,
        'payment_id', v_payment_id,
        'attempt_number', v_attempt_number,
        'receipt_id', v_receipt_id,
        'razorpay_order_id', v_razorpay_order_id,
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
    'attempt_number', v_attempt_number,
    'receipt_id', v_receipt_id,
    'razorpay_order_id', null,
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
  'Atomically reserves or reuses an internal installment order and creates attempt-specific payment records with FOR UPDATE serialization, distinct payment attempts per failure retry, and deterministic per-attempt receipts.';

revoke all on function public.reserve_subsequent_installment_order(uuid, uuid) from public;
revoke all on function public.reserve_subsequent_installment_order(uuid, uuid) from anon;
grant execute on function public.reserve_subsequent_installment_order(uuid, uuid) to authenticated;
grant execute on function public.reserve_subsequent_installment_order(uuid, uuid) to service_role;
