-- Migration 234: Subsequent Installment Payment Retry Isolation & Payment Attempt Lifecycle
--
-- Architectural Objective:
--   1. Enforces strict separation between the internal installment order (orders.order_id)
--      and individual gateway payment attempts (payments.payment_id).
--   2. Ensures that when an authenticated student retries a checkout following a failed
--      Razorpay payment attempt:
--        - The historical failed public.payments row is preserved intact for financial audit.
--        - A new public.payments row is generated with a fresh payment_id and incremented attempt_number.
--        - A unique, deterministic receipt ID derived from the payment_id (rcpt_ + compact UUID, 37 chars <= 40 chars)
--          is generated so retries of the SAME pending attempt are stable while NEW attempts receive distinct receipts.
--        - The RPC returns null for razorpay_order_id on new attempts, preventing reuse of failed gateway orders.
--        - If any payment attempt for this installment was already captured/settled, checkout is refused (INSTALLMENT_ALREADY_PAID).
--   3. Scopes gateway order claims (acquire_gateway_order_claim) to the exact payment attempt (p_payment_id).
--      Leases in orders.notes.gatewayClaim are attempt-specific; an active lease or completed order on attempt P1
--      never blocks or confuses attempt P2.
--
-- Security & Authorization:
--   1. Requires service_role or authenticated caller matching auth.uid() = p_profile_id.
--   2. Enforces SECURITY DEFINER and set search_path = ''.
--   3. Revokes execute from public and anon; grants execute strictly to authenticated and service_role.

-- ============================================================================
-- 1. Redefine Atomic Subsequent Installment Reservation RPC
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


-- ============================================================================
-- 2. Redefine Atomic Single-Creator Gateway Order Claim RPC with Attempt Scoping
-- ============================================================================
-- Drop old 3-arg overload to eliminate function signature ambiguity in PostgreSQL
drop function if exists public.acquire_gateway_order_claim(uuid, text, integer);

create or replace function public.acquire_gateway_order_claim(
  p_order_id uuid,
  p_claimant text,
  p_lease_seconds integer default 15,
  p_payment_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_payment     record;
  v_notes              jsonb;
  v_existing_claimant  text;
  v_claimed_at         timestamptz;
  v_claimed_payment_id text;
  v_now                timestamptz := now();
begin
  -- 0. Authorization Guard: strictly service_role only
  if auth.role() <> 'service_role' then
    return jsonb_build_object(
      'status', 'ERROR',
      'error', 'Unauthorized: acquire_gateway_order_claim requires service_role privileges.',
      'code', 'FORBIDDEN'
    );
  end if;

  -- 1. Lock orders row FOR UPDATE first (Consistent Lock Ordering: orders -> payments)
  select notes::jsonb into v_notes
  from public.orders
  where order_id = p_order_id
  for update;

  if not found then
    return jsonb_build_object(
      'status', 'ERROR',
      'error', 'Order not found.',
      'code', 'ORDER_NOT_FOUND'
    );
  end if;

  -- 2. Lock & Validate Payment Attempt FOR UPDATE (orders-before-payments lock hierarchy)
  if p_payment_id is not null then
    select 
      payment_id,
      order_id,
      gateway,
      status,
      gateway_order_id,
      attempt_number
    into v_target_payment
    from public.payments
    where payment_id = p_payment_id
    for update;

    if not found then
      return jsonb_build_object(
        'status', 'ERROR',
        'error', 'Specified payment attempt record not found.',
        'code', 'PAYMENT_NOT_FOUND'
      );
    end if;

    if v_target_payment.order_id <> p_order_id then
      return jsonb_build_object(
        'status', 'ERROR',
        'error', 'Payment attempt does not belong to specified order.',
        'code', 'PAYMENT_ORDER_MISMATCH'
      );
    end if;

    if v_target_payment.gateway <> 'razorpay'::public.payment_gateway then
      return jsonb_build_object(
        'status', 'ERROR',
        'error', 'Payment attempt gateway is not razorpay.',
        'code', 'INVALID_GATEWAY'
      );
    end if;

    -- Fail-closed on terminal states:
    if v_target_payment.status = 'captured' then
      return jsonb_build_object(
        'status', 'ALREADY_CAPTURED',
        'error', 'This payment attempt has already been captured.',
        'code', 'INSTALLMENT_ALREADY_PAID',
        'payment_id', v_target_payment.payment_id,
        'gateway_order_id', v_target_payment.gateway_order_id
      );
    elsif v_target_payment.status = 'failed' then
      return jsonb_build_object(
        'status', 'STALE_FAILED_ATTEMPT',
        'error', 'Payment attempt has already failed; a new attempt must be created.',
        'code', 'PAYMENT_ATTEMPT_FAILED',
        'payment_id', v_target_payment.payment_id
      );
    elsif v_target_payment.status <> 'pending' then
      return jsonb_build_object(
        'status', 'ERROR',
        'error', 'Payment attempt is not in pending status.',
        'code', 'INVALID_PAYMENT_STATUS',
        'payment_id', v_target_payment.payment_id
      );
    end if;

    -- If the current pending attempt already has a persisted gateway_order_id:
    if v_target_payment.gateway_order_id is not null then
      return jsonb_build_object(
        'status', 'ALREADY_COMPLETED',
        'gateway_order_id', v_target_payment.gateway_order_id,
        'payment_id', v_target_payment.payment_id,
        'attempt_number', v_target_payment.attempt_number
      );
    end if;

  else
    -- Fallback for callers where p_payment_id is omitted:
    -- Inspect latest payment attempt for this order with lock
    select payment_id, order_id, gateway, status, gateway_order_id into v_target_payment
    from public.payments
    where order_id = p_order_id
      and gateway = 'razorpay'
    order by attempt_number desc
    limit 1
    for update;

    if v_target_payment.payment_id is not null then
      if v_target_payment.status = 'captured' then
        return jsonb_build_object(
          'status', 'ALREADY_CAPTURED',
          'code', 'INSTALLMENT_ALREADY_PAID',
          'gateway_order_id', v_target_payment.gateway_order_id
        );
      elsif v_target_payment.status = 'failed' then
        return jsonb_build_object(
          'status', 'STALE_FAILED_ATTEMPT',
          'code', 'PAYMENT_ATTEMPT_FAILED',
          'payment_id', v_target_payment.payment_id
        );
      elsif v_target_payment.status = 'pending' and v_target_payment.gateway_order_id is not null then
        return jsonb_build_object(
          'status', 'ALREADY_COMPLETED',
          'gateway_order_id', v_target_payment.gateway_order_id
        );
      end if;
    end if;
  end if;

  -- 3. Check existing claim in orders.notes
  v_existing_claimant  := v_notes -> 'gatewayClaim' ->> 'claimant';
  v_claimed_at         := (v_notes -> 'gatewayClaim' ->> 'claimedAt')::timestamptz;
  v_claimed_payment_id := v_notes -> 'gatewayClaim' ->> 'paymentId';

  -- Attempt-specific lease isolation:
  -- If the existing claim belongs to a DIFFERENT payment attempt, it does not block this attempt.
  if (p_payment_id is null or v_claimed_payment_id is null or v_claimed_payment_id = p_payment_id::text) then
    -- Active lease held by another worker on THIS attempt:
    if v_existing_claimant is not null 
       and v_claimed_at is not null 
       and v_claimed_at + (p_lease_seconds || ' seconds')::interval > v_now 
       and v_existing_claimant <> p_claimant then
      return jsonb_build_object(
        'status', 'LEASE_ACTIVE',
        'claimant', v_existing_claimant,
        'expires_at', v_claimed_at + (p_lease_seconds || ' seconds')::interval,
        'payment_id', p_payment_id
      );
    end if;
  end if;

  -- 4. Grant / Renew the lease to this claimant for this payment attempt
  v_notes := jsonb_set(
    coalesce(v_notes, '{}'::jsonb),
    '{gatewayClaim}',
    jsonb_build_object(
      'claimant', p_claimant,
      'claimedAt', v_now,
      'paymentId', p_payment_id
    )
  );

  update public.orders
  set notes = v_notes::text,
      updated_at = v_now
  where order_id = p_order_id;

  return jsonb_build_object(
    'status', 'CLAIMED',
    'claimant', p_claimant,
    'payment_id', p_payment_id
  );
end;
$$;

comment on function public.acquire_gateway_order_claim is
  'Atomically coordinates external gateway order creation among concurrent workers with consistent orders-before-payments lock hierarchy, strict attempt-level scoping (p_payment_id), and service_role execution authorization.';

revoke all on function public.acquire_gateway_order_claim(uuid, text, integer, uuid) from public;
revoke all on function public.acquire_gateway_order_claim(uuid, text, integer, uuid) from anon;
revoke all on function public.acquire_gateway_order_claim(uuid, text, integer, uuid) from authenticated;
grant execute on function public.acquire_gateway_order_claim(uuid, text, integer, uuid) to service_role;


-- ============================================================================
-- ============================================================================
-- RPC: public.reconcile_razorpay_gateway_order
--
-- Concurrency-Safe Razorpay Gateway Order ID Reconciliation & Checkout Mapping
--
-- Serializes gateway order association using a transaction-scoped advisory lock
-- on the incoming Razorpay Order ID. Guarantees:
--   1. An external Razorpay Order ID is never assigned to multiple payment attempts.
--   2. Candidate payment attempt is matched to exact payment_id, internal order_id, amount, and currency.
--   3. Existing non-null gateway_order_id is never overwritten with a different ID.
--   4. Never resurrects or captures a failed payment attempt.
--   5. Never downgrades a captured payment attempt.
--   6. Duplicate webhook events and idempotent checkout mappings return success with explicit status.
-- ============================================================================

drop function if exists public.reconcile_razorpay_gateway_order(uuid, text, numeric, text, text);
drop function if exists public.reconcile_razorpay_gateway_order(uuid, text, numeric, text, text, uuid);

create or replace function public.reconcile_razorpay_gateway_order(
  p_payment_id          uuid,
  p_gateway_order_id    text,
  p_expected_amount     numeric,
  p_expected_currency   text,
  p_event_type          text,
  p_order_id            uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role                text;
  v_competing_payment   record;
  v_target_payment      record;
begin
  -- 1. Security Check: Enforce service_role or admin caller
  v_role := auth.role();
  if v_role <> 'service_role' and not public.is_admin() then
    return jsonb_build_object(
      'success', false,
      'code', 'UNAUTHORIZED',
      'error', 'Unauthorized: reconcile_razorpay_gateway_order requires service_role privileges.'
    );
  end if;

  -- 2. Validate Parameters
  if p_payment_id is null or p_gateway_order_id is null or trim(p_gateway_order_id) = '' then
    return jsonb_build_object(
      'success', false,
      'code', 'INVALID_PARAMETERS',
      'error', 'Missing required payment_id or gateway_order_id parameter.'
    );
  end if;

  -- 3. Database-Level Transaction-Scoped Advisory Lock
  -- Strictly serializes concurrent workers (checkout creation & webhook reconciliation)
  -- for this specific Razorpay Order ID across all database transactions.
  perform pg_advisory_xact_lock(hashtext('rzp_order_claim:' || trim(p_gateway_order_id)));

  -- 4. Guard 1: Verify incoming Razorpay Order ID is NOT already owned by a DIFFERENT payment attempt
  select payment_id, order_id, status
  into v_competing_payment
  from public.payments
  where gateway = 'razorpay'
    and gateway_order_id = trim(p_gateway_order_id)
    and payment_id <> p_payment_id
  limit 1;

  if v_competing_payment.payment_id is not null then
    return jsonb_build_object(
      'success', false,
      'code', 'ALREADY_MAPPED_TO_ANOTHER_ATTEMPT',
      'error', 'Razorpay Order ID is already mapped to another payment attempt.',
      'conflict_payment_id', v_competing_payment.payment_id,
      'conflict_order_id', v_competing_payment.order_id
    );
  end if;

  -- 5. Lock & Inspect the Candidate Payment Attempt
  select 
    payment_id,
    order_id,
    institute_id,
    amount,
    currency,
    gateway,
    status,
    gateway_order_id,
    gateway_payment_id,
    attempt_number,
    created_at
  into v_target_payment
  from public.payments
  where payment_id = p_payment_id
  for update;

  if v_target_payment.payment_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'PAYMENT_NOT_FOUND',
      'error', 'Candidate payment attempt not found.'
    );
  end if;

  -- 6. Guard 2: Exact internal order_id check (when p_order_id is provided)
  if p_order_id is not null and v_target_payment.order_id <> p_order_id then
    return jsonb_build_object(
      'success', false,
      'code', 'INVALID_ORDER_MAPPING',
      'error', 'Candidate payment attempt does not belong to the supplied internal order.',
      'expected_order_id', p_order_id,
      'actual_order_id', v_target_payment.order_id
    );
  end if;

  -- 7. Guard 3: Gateway must be Razorpay
  if v_target_payment.gateway is distinct from 'razorpay' then
    return jsonb_build_object(
      'success', false,
      'code', 'PAYMENT_STATUS_INELIGIBLE',
      'error', 'Payment gateway is not razorpay: ' || coalesce(v_target_payment.gateway::text, 'null')
    );
  end if;

  -- 8. Guard 4: Candidate Amount and Currency Verification
  if p_expected_amount is not null and abs(v_target_payment.amount - p_expected_amount) > 0.01 then
    return jsonb_build_object(
      'success', false,
      'code', 'AMOUNT_OR_CURRENCY_MISMATCH',
      'error', 'Candidate payment amount does not match expected amount.',
      'expected_amount', p_expected_amount,
      'payment_amount', v_target_payment.amount
    );
  end if;

  if p_expected_currency is not null and upper(coalesce(v_target_payment.currency::text, 'INR')) <> upper(p_expected_currency) then
    return jsonb_build_object(
      'success', false,
      'code', 'AMOUNT_OR_CURRENCY_MISMATCH',
      'error', 'Candidate payment currency does not match expected currency.',
      'expected_currency', p_expected_currency,
      'payment_currency', v_target_payment.currency
    );
  end if;

  -- 9. Guard 5: Never overwrite a DIFFERENT non-null gateway_order_id
  if v_target_payment.gateway_order_id is not null and v_target_payment.gateway_order_id <> trim(p_gateway_order_id) then
    return jsonb_build_object(
      'success', false,
      'code', 'CANDIDATE_GATEWAY_ORDER_MISMATCH',
      'error', 'Candidate payment attempt already has a different gateway order ID.',
      'existing_gateway_order_id', v_target_payment.gateway_order_id,
      'incoming_gateway_order_id', trim(p_gateway_order_id)
    );
  end if;

  -- 10. Status Eligibility & Event Handling
  if p_event_type = 'checkout' then
    -- Checkout order mapping strictly requires payment status = 'pending'
    if v_target_payment.status <> 'pending' then
      return jsonb_build_object(
        'success', false,
        'code', 'PAYMENT_STATUS_INELIGIBLE',
        'error', 'Payment status is ineligible for checkout mapping: ' || v_target_payment.status::text,
        'current_status', v_target_payment.status
      );
    end if;

    if v_target_payment.gateway_order_id = trim(p_gateway_order_id) then
      return jsonb_build_object(
        'success', true,
        'code', 'ALREADY_MAPPED_TO_THIS_ATTEMPT',
        'action', 'already_mapped',
        'payment', row_to_json(v_target_payment)
      );
    else
      -- Atomically assign the gateway order ID
      update public.payments
      set gateway_order_id = trim(p_gateway_order_id),
          updated_at = now()
      where payment_id = p_payment_id
        and gateway_order_id is null
        and status = 'pending';

      v_target_payment.gateway_order_id := trim(p_gateway_order_id);

      return jsonb_build_object(
        'success', true,
        'code', 'MAPPED',
        'action', 'mapped',
        'payment', row_to_json(v_target_payment)
      );
    end if;

  -- Webhook Reconciliation Events (payment.captured / payment.failed)
  elsif v_target_payment.status = 'captured' then
    if p_event_type = 'payment.failed' then
      -- Anti-downgrade rule: Never downgrade or associate captured payment with failure event
      return jsonb_build_object(
        'success', true,
        'action', 'ignored_captured',
        'code', 'ALREADY_CAPTURED',
        'message', 'Payment attempt was already captured; failure event ignored.',
        'payment', row_to_json(v_target_payment)
      );
    else
      -- Duplicate webhook idempotency for captured event
      return jsonb_build_object(
        'success', true,
        'action', 'already_captured',
        'code', case when v_target_payment.gateway_order_id = trim(p_gateway_order_id) then 'ALREADY_MAPPED_TO_THIS_ATTEMPT' else 'MAPPED' end,
        'payment', row_to_json(v_target_payment)
      );
    end if;

  elsif v_target_payment.status = 'failed' then
    if p_event_type = 'payment.failed' and v_target_payment.gateway_order_id = trim(p_gateway_order_id) then
      -- Duplicate failure webhook idempotency
      return jsonb_build_object(
        'success', true,
        'action', 'already_failed',
        'code', 'ALREADY_MAPPED_TO_THIS_ATTEMPT',
        'payment', row_to_json(v_target_payment)
      );
    else
      -- Failed-attempt history: Never resurrect or reassociate a failed payment attempt
      return jsonb_build_object(
        'success', false,
        'code', 'PAYMENT_STATUS_INELIGIBLE',
        'error', 'Payment attempt has already failed and cannot be reassociated.'
      );
    end if;

  elsif v_target_payment.status <> 'pending' then
    -- Ineligible status (e.g. refunded, partially_refunded)
    return jsonb_build_object(
      'success', false,
      'code', 'PAYMENT_STATUS_INELIGIBLE',
      'error', 'Payment attempt status is ineligible for reconciliation: ' || v_target_payment.status::text
    );

  else
    -- Status is 'pending': Eligible for webhook mapping
    if v_target_payment.gateway_order_id = trim(p_gateway_order_id) then
      return jsonb_build_object(
        'success', true,
        'action', 'already_mapped',
        'code', 'ALREADY_MAPPED_TO_THIS_ATTEMPT',
        'payment', row_to_json(v_target_payment)
      );
    else
      -- Assign the gateway order ID atomically
      update public.payments
      set gateway_order_id = trim(p_gateway_order_id),
          updated_at = now()
      where payment_id = p_payment_id
        and gateway_order_id is null
        and status = 'pending';

      v_target_payment.gateway_order_id := trim(p_gateway_order_id);

      return jsonb_build_object(
        'success', true,
        'action', 'mapped',
        'code', 'MAPPED',
        'payment', row_to_json(v_target_payment)
      );
    end if;
  end if;
end;
$$;

comment on function public.reconcile_razorpay_gateway_order is
  'Concurrency-safe Razorpay Order ID reconciliation and checkout mapping using transaction-scoped advisory locks, duplicate gateway ownership prevention, anti-downgrade protection, and attempt-specific scoping.';

revoke all on function public.reconcile_razorpay_gateway_order(uuid, text, numeric, text, text, uuid) from public;
revoke all on function public.reconcile_razorpay_gateway_order(uuid, text, numeric, text, text, uuid) from anon;
revoke all on function public.reconcile_razorpay_gateway_order(uuid, text, numeric, text, text, uuid) from authenticated;
grant execute on function public.reconcile_razorpay_gateway_order(uuid, text, numeric, text, text, uuid) to service_role;


-- ============================================================================
-- RPC: public.process_installment_payment
--
-- Lock-Order Harmonized Installment Payment Settlement Engine
--
-- Harmonizes row lock acquisition order across checkout reservation and payment settlement:
--   1. student_course_agreements (FOR UPDATE)
--   2. student_installment_schedule (FOR UPDATE)
--   3. orders (FOR UPDATE)
--   4. payments (FOR UPDATE)
--   5. installment_payment_allocations (INSERT / UPDATE)
--
-- Performs an initial non-locking lookup to resolve target identifiers, acquires
-- locks strictly in the canonical order, re-reads and revalidates all records under
-- exclusive lock, and preserves 100% of the financial FIFO allocation, calendar D0
-- anchor date verification, remainder absorption, student_id adoption, and subscription
-- access entitlement logic.
-- ============================================================================

create or replace function public.process_installment_payment(
    p_payment_id   uuid,
    p_agreement_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lookup                record;
  v_order                 record;
  v_payment               record;
  v_agreement             record;
  v_plan                  record;
  v_student_id            uuid;
  v_course_id             uuid;
  v_order_plan_id         uuid;
  v_order_agreement_id    uuid;
  v_target_agreement_id   uuid;
  v_refund_adjustments    numeric(10,2) := 0.00;
  v_reversal_adjustments  numeric(10,2) := 0.00;
  v_confirmed_refund      numeric(10,2) := 0.00;
  v_confirmed_reversal    numeric(10,2) := 0.00;
  v_net_payment_available numeric(10,2);
  v_is_reconciled         boolean := true;
  v_already_allocated     numeric(10,2) := 0.00;
  v_unallocated_amount    numeric(10,2);
  v_allocated_total       numeric(10,2) := 0.00;
  v_sched_allocated       numeric(10,2) := 0.00;
  v_needed                numeric(10,2);
  v_to_pay                numeric(10,2);
  v_sched                 record;
  v_current_local_date    date;
  v_institute_timezone    text := 'Asia/Kolkata';
  v_verified_ts           timestamptz;
  v_anchor_date           date;
  v_total_paid            numeric(10,2);
  v_total_waivers         numeric(10,2);
  v_total_adjustments     numeric(10,2);
  v_new_outstanding       numeric(10,2);
  v_new_overdue           numeric(10,2);
  v_consecutive_k         smallint := 0;
  v_new_end_date          date;
  v_terminal_end_date     date;
  v_sub_id                uuid;
  v_role                  text;
  v_step                  int;
  v_standard_tranche      numeric(10,2);
begin
  -- 1. Security Check: Enforce service_role or admin caller
  v_role := auth.role();
  if v_role <> 'service_role' and not public.is_admin() then
    return jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: process_installment_payment requires service_role or admin privileges.',
      'code', 'UNAUTHORIZED'
    );
  end if;

  if p_payment_id is null then
    return jsonb_build_object(
      'success', false,
      'error', 'Missing payment_id parameter.',
      'code', 'INVALID_PARAMETERS'
    );
  end if;

  -- 2. Initial Non-Locking Lookup to Resolve Targets
  select 
    p.payment_id,
    p.order_id,
    p.amount,
    p.status,
    p.created_at,
    p.paid_at,
    coalesce(p.refund_amount, 0.00) as refund_amount,
    p.refund_gateway_id,
    o.student_id,
    o.institute_id,
    oi.course_id,
    oi.installment_plan_id,
    oi.agreement_id as order_item_agreement_id
  into v_lookup
  from public.payments p
  left join public.orders o on o.order_id = p.order_id
  left join public.order_items oi on oi.order_id = o.order_id and oi.item_type = 'installment'
  where p.payment_id = p_payment_id
  limit 1;

  if v_lookup.payment_id is null then
    return jsonb_build_object(
      'success', false,
      'error', 'Authoritative payment record not found.',
      'code', 'PAYMENT_NOT_FOUND'
    );
  end if;

  if v_lookup.course_id is null then
    return jsonb_build_object(
      'success', false,
      'error', 'No course_id found for payment order items.',
      'code', 'ORDER_COURSE_NOT_FOUND'
    );
  end if;

  -- Resolve target agreement ID
  v_target_agreement_id := coalesce(p_agreement_id, v_lookup.order_item_agreement_id);
  if v_target_agreement_id is null and v_lookup.student_id is not null then
    select sca.agreement_id
    into v_target_agreement_id
    from public.student_course_agreements sca
    where sca.student_id = v_lookup.student_id
      and sca.course_id = v_lookup.course_id
    order by sca.created_at desc
    limit 1;
  end if;

  if v_target_agreement_id is null then
    return jsonb_build_object(
      'success', false,
      'error', 'No matching student course agreement found for payment order.',
      'code', 'AGREEMENT_NOT_FOUND'
    );
  end if;

  -- ==========================================================================
  -- 3. Canonical Global Row Locking Hierarchy:
  --    Step 1: student_course_agreements (FOR UPDATE)
  --    Step 2: student_installment_schedule (FOR UPDATE)
  --    Step 3: orders (FOR UPDATE)
  --    Step 4: payments (FOR UPDATE)
  -- ==========================================================================

  -- Step 1: Lock target agreement row FOR UPDATE
  select *
  into v_agreement
  from public.student_course_agreements
  where agreement_id = v_target_agreement_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'error', 'Target student course agreement not found.',
      'code', 'AGREEMENT_NOT_FOUND'
    );
  end if;

  -- Step 2: Lock existing schedule rows for this agreement FOR UPDATE
  perform 1
  from public.student_installment_schedule
  where agreement_id = v_agreement.agreement_id
  for update;

  -- Step 3: Lock internal orders row FOR UPDATE
  select *
  into v_order
  from public.orders
  where order_id = v_lookup.order_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'error', 'Order record not found for payment.',
      'code', 'ORDER_NOT_FOUND'
    );
  end if;

  -- Step 4: Lock payment attempt row FOR UPDATE
  select 
    payment_id,
    order_id,
    amount,
    status,
    created_at,
    paid_at,
    coalesce(refund_amount, 0.00) as refund_amount,
    refund_gateway_id
  into v_payment
  from public.payments
  where payment_id = p_payment_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'error', 'Authoritative payment record not found.',
      'code', 'PAYMENT_NOT_FOUND'
    );
  end if;

  -- ==========================================================================
  -- 4. Re-Validation of Authoritative Records Under Lock
  -- ==========================================================================

  -- Validate payment status (captured or partially_refunded are payable; refunded has 0 available)
  if v_payment.status in ('failed', 'pending') then
    return jsonb_build_object(
      'success', false,
      'error', 'Payment status is not captured or verified. Current status: ' || coalesce(v_payment.status::text, 'null'),
      'code', 'PAYMENT_NOT_CAPTURED'
    );
  end if;

  if v_payment.status = 'refunded' then
    return jsonb_build_object(
      'success', false,
      'error', 'Payment has been fully refunded and is unavailable for installment allocation.',
      'code', 'PAYMENT_REFUNDED'
    );
  end if;

  if v_payment.amount is null or v_payment.amount <= 0 then
    return jsonb_build_object(
      'success', false,
      'error', 'Payment amount must be positive.',
      'code', 'INVALID_PAYMENT_AMOUNT'
    );
  end if;

  -- Re-read authoritative order items under locked order
  select oi.course_id, oi.installment_plan_id, oi.agreement_id
  into v_course_id, v_order_plan_id, v_order_agreement_id
  from public.order_items oi
  where oi.order_id = v_payment.order_id
  limit 1;

  if v_course_id is null then
    return jsonb_build_object(
      'success', false,
      'error', 'No course_id found for payment order items.',
      'code', 'ORDER_COURSE_NOT_FOUND'
    );
  end if;

  -- Adopt verified student_id from agreement if orders.student_id was null (pre-onboarding checkout)
  v_student_id := v_order.student_id;
  if v_student_id is null then
    v_student_id := v_agreement.student_id;
  end if;

  -- Ensure student_id is strictly resolved
  if v_student_id is null or v_agreement.student_id is null then
    return jsonb_build_object(
      'success', false,
      'error', 'Authoritative student_id could not be resolved from agreement.',
      'code', 'STUDENT_ID_REQUIRED'
    );
  end if;

  -- Cross-verify payment context:
  -- 1. If orders.student_id already has a value, strictly reject mismatch with agreement student
  if v_order.student_id is not null and v_order.student_id <> v_agreement.student_id then
    return jsonb_build_object(
      'success', false,
      'error', 'Payment context mismatch: payment order student (' || v_order.student_id::text || ') does not match agreement student (' || v_agreement.student_id::text || ').',
      'code', 'PAYMENT_CONTEXT_MISMATCH'
    );
  end if;

  -- 2. Verify course matches agreement
  if v_agreement.course_id <> v_course_id then
    return jsonb_build_object(
      'success', false,
      'error', 'Payment context mismatch: order item course (' || v_course_id::text || ') does not match agreement course (' || v_agreement.course_id::text || ').',
      'code', 'PAYMENT_CONTEXT_MISMATCH'
    );
  end if;

  -- 3. Verify installment plan matches if order item specifies plan
  if v_order_plan_id is not null and v_agreement.plan_id <> v_order_plan_id then
    return jsonb_build_object(
      'success', false,
      'error', 'Payment context mismatch: order item plan (' || v_order_plan_id::text || ') does not match agreement plan (' || v_agreement.plan_id::text || ').',
      'code', 'PAYMENT_CONTEXT_MISMATCH'
    );
  end if;

  -- 4. Verify order item agreement matches if already linked
  if v_order_agreement_id is not null and v_order_agreement_id <> v_agreement.agreement_id then
    return jsonb_build_object(
      'success', false,
      'error', 'Payment context mismatch: order item agreement (' || v_order_agreement_id::text || ') does not match target agreement (' || v_agreement.agreement_id::text || ').',
      'code', 'PAYMENT_CONTEXT_MISMATCH'
    );
  end if;

  -- Backfill orders.student_id within transaction if currently null
  if v_order.student_id is null then
    update public.orders
    set student_id = v_student_id,
        updated_at = now()
    where order_id = v_payment.order_id
      and student_id is null;
  end if;

  -- Ensure order_items is linked to this agreement if currently null
  update public.order_items
  set agreement_id = v_agreement.agreement_id
  where order_id = v_payment.order_id
    and item_type = 'installment'
    and agreement_id is null;

  -- Payment Reuse Check: Verify payment has not been allocated to a DIFFERENT agreement
  if exists (
    select 1 from public.installment_payment_allocations
    where payment_id = p_payment_id
      and agreement_id <> v_agreement.agreement_id
  ) then
    return jsonb_build_object(
      'success', false,
      'error', 'Payment is already allocated to a different agreement.',
      'code', 'PAYMENT_REUSE_PROHIBITED'
    );
  end if;

  -- Agreement Review Check: Allocations are strictly blocked while under administrative review
  if v_agreement.requires_admin_review then
    return jsonb_build_object(
      'success', false,
      'code', 'AGREEMENT_PENDING_ADMIN_REVIEW',
      'error', 'Agreement is currently flagged for administrative review (requires_admin_review = true). New installment allocation is blocked until review is authoritatively cleared by an administrator.',
      'requires_admin_review', true,
      'agreement_id', v_agreement.agreement_id,
      'unallocated_amount', 0.00
    );
  end if;

  -- Payment-Level Available Amount Calculation (Accounting: Non-Double-Counting)
  select coalesce(sum(amount), 0.00)
  into v_refund_adjustments
  from public.installment_adjustments
  where reference_payment_id = p_payment_id
    and adjustment_type in ('gateway_refund', 'duplicate_charge_refund')
    and status = 'processed';

  select coalesce(sum(greatest(0.00, amount - restored_amount)), 0.00)
  into v_reversal_adjustments
  from public.installment_adjustments
  where reference_payment_id = p_payment_id
    and adjustment_type = 'gateway_reversal'
    and status in ('processed', 'lost', 'closed', 'under_review', 'won');

  -- Strict Refund Reconciliation Check
  v_is_reconciled := (coalesce(v_payment.refund_amount, 0.00) = v_refund_adjustments);
  if v_is_reconciled and coalesce(v_payment.refund_amount, 0.00) > 0.00 and v_payment.refund_gateway_id is not null then
    if not exists (
      select 1 from public.installment_adjustments
      where reference_payment_id = p_payment_id
        and adjustment_type in ('gateway_refund', 'duplicate_charge_refund')
        and status = 'processed'
        and gateway_event_id = v_payment.refund_gateway_id
    ) then
      v_is_reconciled := false;
    end if;
  end if;

  if not v_is_reconciled then
    update public.student_course_agreements
    set requires_admin_review = true,
        updated_at = now()
    where agreement_id = v_agreement.agreement_id;

    return jsonb_build_object(
      'success', false,
      'code', 'PAYMENT_REFUND_RECONCILIATION_REQUIRED',
      'error', 'Payment refund summary and adjustment ledger cannot be reconciled reliably. New installment allocation is blocked until administrator reconciliation.',
      'requires_admin_review', true,
      'summary_refund_amount', coalesce(v_payment.refund_amount, 0.00),
      'ledger_refund_amount', v_refund_adjustments,
      'summary_refund_gateway_id', v_payment.refund_gateway_id,
      'refund_discrepancy', abs(coalesce(v_payment.refund_amount, 0.00) - v_refund_adjustments),
      'unallocated_amount', 0.00
    );
  end if;

  v_confirmed_refund := v_refund_adjustments;
  v_confirmed_reversal := v_reversal_adjustments;

  v_net_payment_available := greatest(
    0.00,
    v_payment.amount - v_confirmed_refund - v_confirmed_reversal
  );

  -- Idempotency and Allocation Status Check
  select coalesce(sum(allocated_amount), 0.00)
  into v_already_allocated
  from public.installment_payment_allocations
  where payment_id = p_payment_id;

  if v_already_allocated > v_net_payment_available then
    update public.student_course_agreements
    set requires_admin_review = true,
        updated_at = now()
    where agreement_id = v_agreement.agreement_id;

    return jsonb_build_object(
      'success', false,
      'code', 'PAYMENT_REVERSED_ALLOCATION_DEFICIT',
      'error', 'Payment reversal or refund exceeds unallocated balance: previously allocated amount ('
               || v_already_allocated || ') exceeds net available (' || v_net_payment_available
               || '). Agreement flagged for administrative review.',
      'requires_admin_review', true,
      'net_payment_available', v_net_payment_available,
      'already_allocated', v_already_allocated,
      'deficit_amount', (v_already_allocated - v_net_payment_available),
      'unallocated_amount', 0.00
    );
  end if;

  v_unallocated_amount := v_net_payment_available - v_already_allocated;

  if v_unallocated_amount <= 0.00 then
    if v_already_allocated > 0.00 then
      return jsonb_build_object(
        'success', true,
        'already_processed', true,
        'message', 'Payment has already been fully allocated.',
        'code', 'PAYMENT_ALREADY_ALLOCATED'
      );
    else
      return jsonb_build_object(
        'success', false,
        'error', 'Payment has no available amount for allocation due to refunds or reversals.',
        'code', 'PAYMENT_AMOUNT_UNAVAILABLE'
      );
    end if;
  end if;

  -- Reject defaulted, cancelled, or withdrawn agreements
  if v_agreement.agreement_status in ('cancelled_by_admin', 'defaulted', 'withdrawn') then
    return jsonb_build_object(
      'success', false,
      'error', 'Agreement is not in payable standing. Current status: ' || v_agreement.agreement_status,
      'code', 'AGREEMENT_INELIGIBLE'
    );
  end if;

  -- Load plan configuration
  select *
  into v_plan
  from public.course_installment_plans
  where plan_id = v_agreement.plan_id;

  if not found then
    return jsonb_build_object(
      'success', false,
      'error', 'Associated installment plan not found.',
      'code', 'PLAN_NOT_FOUND'
    );
  end if;

  -- Resolve authoritative institute timezone for midnight date boundary
  if v_order.institute_id is not null then
    select coalesce(timezone, 'Asia/Kolkata')
    into v_institute_timezone
    from public.institutes
    where institute_id = v_order.institute_id;
  end if;
  v_current_local_date := (now() at time zone coalesce(v_institute_timezone, 'Asia/Kolkata'))::date;

  -- 4. Initial Payment Verification: Establish Calendar Anchor D0 from Verified Timestamp
  if v_agreement.agreement_date is null then
    if v_payment.paid_at is null then
      update public.student_course_agreements
      set requires_admin_review = true,
          updated_at = now()
      where agreement_id = v_agreement.agreement_id;

      return jsonb_build_object(
        'success', false,
        'error', 'Missing authoritative payment timestamp (paid_at). Initial agreement activation failed closed pending reconciliation.',
        'code', 'MISSING_AUTHORITATIVE_PAYMENT_TIMESTAMP',
        'agreement_id', v_agreement.agreement_id,
        'payment_id', v_payment.payment_id,
        'requires_admin_review', true
      );
    end if;

    v_verified_ts := v_payment.paid_at;
    v_anchor_date := (v_verified_ts at time zone coalesce(v_institute_timezone, 'Asia/Kolkata'))::date;
    
    update public.student_course_agreements
    set agreement_date = v_anchor_date,
        agreement_status = 'active',
        requires_admin_review = false,
        updated_at = now()
    where agreement_id = v_agreement.agreement_id;
    
    v_agreement.agreement_date := v_anchor_date;
    v_agreement.agreement_status := 'active';

    -- Generate schedule from this immutable anchor if schedule rows do not yet exist
    if not exists (
      select 1 from public.student_installment_schedule
      where agreement_id = v_agreement.agreement_id
    ) then
      v_standard_tranche := round(v_agreement.total_fee / v_plan.number_of_installments, 2);
      for v_step in 1..v_plan.number_of_installments loop
        insert into public.student_installment_schedule (
          agreement_id,
          installment_index,
          due_date,
          amount_due,
          amount_paid,
          waiver_amount,
          status
        ) values (
          v_agreement.agreement_id,
          v_step,
          case
            when v_step = 1 then v_anchor_date
            else public.calculate_anchor_date(v_anchor_date, ((v_step - 1) * v_plan.interval_months)::smallint)
          end,
          case
            when v_step = v_plan.number_of_installments
            then v_agreement.total_fee - (v_standard_tranche * (v_plan.number_of_installments - 1))
            else v_standard_tranche
          end,
          0.00,
          0.00,
          'pending'
        );
      end loop;
    else
      -- If draft schedule rows existed, re-align due dates to verified anchor date
      for v_step in 1..v_plan.number_of_installments loop
        update public.student_installment_schedule
        set due_date = case
                         when v_step = 1 then v_anchor_date
                         else public.calculate_anchor_date(v_anchor_date, ((v_step - 1) * v_plan.interval_months)::smallint)
                       end,
            updated_at = now()
        where agreement_id = v_agreement.agreement_id
          and installment_index = v_step
          and status = 'pending'
          and amount_paid = 0.00;
      end loop;
    end if;
  end if;

  -- 5. FIFO Allocation across pending / overdue installments
  for v_sched in
    select *
    from public.student_installment_schedule
    where agreement_id = v_agreement.agreement_id
      and status in ('pending', 'overdue')
    order by installment_index asc
    for update
  loop
    exit when v_unallocated_amount <= 0.00;

    -- Authoritative already-allocated total for this schedule from allocations ledger:
    select coalesce(sum(allocated_amount), 0.00)
    into v_sched_allocated
    from public.installment_payment_allocations
    where schedule_id = v_sched.schedule_id;

    -- Effective obligation considers approved waivers and previous allocations
    v_needed := greatest(0.00, v_sched.amount_due - v_sched_allocated - v_sched.waiver_amount);
    if v_needed <= 0.00 then
      if v_sched.status <> 'paid' and v_sched.status <> 'waived' then
        update public.student_installment_schedule
        set status = 'paid',
            amount_paid = v_sched_allocated,
            updated_at = now()
        where schedule_id = v_sched.schedule_id;
      end if;
      continue;
    end if;

    v_to_pay := least(v_unallocated_amount, v_needed);

    -- Insert or update normalized allocation row
    insert into public.installment_payment_allocations (
      payment_id,
      schedule_id,
      agreement_id,
      allocated_amount,
      allocated_at
    ) values (
      p_payment_id,
      v_sched.schedule_id,
      v_agreement.agreement_id,
      v_to_pay,
      v_payment.paid_at
    )
    on conflict (payment_id, schedule_id) do update
    set allocated_amount = public.installment_payment_allocations.allocated_amount + excluded.allocated_amount,
        allocated_at = excluded.allocated_at;

    -- Update schedule with new total amount_paid and status
    update public.student_installment_schedule
    set amount_paid = v_sched_allocated + v_to_pay,
        status      = case
                        when (v_sched_allocated + v_to_pay + v_sched.waiver_amount) >= v_sched.amount_due then 'paid'
                        else status
                      end,
        paid_at     = coalesce(v_sched.paid_at, v_payment.paid_at),
        payment_id  = p_payment_id,
        updated_at  = now()
    where schedule_id = v_sched.schedule_id;

    v_unallocated_amount := v_unallocated_amount - v_to_pay;
    v_allocated_total    := v_allocated_total + v_to_pay;
  end loop;

  -- If any unallocated surplus remains, log it as an admin credit adjustment
  if v_unallocated_amount > 0 then
    insert into public.installment_adjustments (
      agreement_id,
      adjustment_type,
      amount,
      reference_payment_id,
      reason,
      approved_by_admin_id
    ) values (
      v_agreement.agreement_id,
      'admin_credit',
      v_unallocated_amount,
      p_payment_id,
      'Surplus payment credit unallocated after clearing all scheduled installments',
      auth.uid()
    );
  end if;

  -- 6. Update status to 'overdue' for remaining unpaid obligations past effective due date
  update public.student_installment_schedule
  set status = 'overdue',
      updated_at = now()
  where agreement_id = v_agreement.agreement_id
    and status = 'pending'
    and coalesce(revised_due_date, due_date) < v_current_local_date
    and (amount_paid + waiver_amount) < amount_due;

  -- 7. Recalculate Agreement Balances using Effective Obligation
  select coalesce(sum(amount_paid), 0.00), coalesce(sum(waiver_amount), 0.00)
  into v_total_paid, v_total_waivers
  from public.student_installment_schedule
  where agreement_id = v_agreement.agreement_id;

  select coalesce(sum(amount), 0.00)
  into v_total_adjustments
  from public.installment_adjustments
  where agreement_id = v_agreement.agreement_id
    and adjustment_type in ('scholarship', 'admin_credit')
    and installment_index is null;

  v_new_outstanding := greatest(0.00, v_agreement.total_fee - v_total_paid - v_total_waivers - v_total_adjustments);
  v_new_overdue := public.calculate_effective_overdue_balance(v_agreement.agreement_id, v_current_local_date);

  -- 8. Determine Highest Consecutively Funded Installment Milestone (k)
  select coalesce(max(installment_index), 0)
  into v_consecutive_k
  from (
    select installment_index,
           row_number() over (order by installment_index) as rn
    from public.student_installment_schedule
    where agreement_id = v_agreement.agreement_id
      and (status in ('paid', 'waived') or (amount_paid + waiver_amount) >= amount_due)
  ) t
  where installment_index = rn;

  -- 9. Recalculate Entitlement Paid-Through Date
  v_terminal_end_date := public.calculate_anchor_date(
    v_agreement.agreement_date,
    (v_plan.number_of_installments * v_plan.interval_months)::smallint
  );

  if v_consecutive_k = 0 then
    v_new_end_date := v_agreement.agreement_date;
  elsif v_consecutive_k < v_plan.number_of_installments then
    v_new_end_date := public.calculate_anchor_date(
      v_agreement.agreement_date,
      (v_consecutive_k * v_plan.interval_months)::smallint
    );
  else
    v_new_end_date := v_terminal_end_date;
  end if;

  -- 10. Synchronize Subscription Entitlement Record
  select subscription_id
  into v_sub_id
  from public.student_subscriptions
  where student_id = v_student_id
    and course_id = v_agreement.course_id
  limit 1;

  if v_sub_id is not null then
    update public.student_subscriptions
    set end_date = greatest(coalesce(end_date, v_new_end_date), v_new_end_date),
        content_access_end_date = greatest(
          coalesce(content_access_end_date, v_new_end_date + interval '30 days'),
          (v_new_end_date + interval '30 days')::date
        ),
        grace_end_date = case
                           when v_new_overdue > 0 then coalesce(grace_end_date, v_new_end_date)
                           else null
                         end,
        status = (case
                    when v_new_overdue > 0 then 'grace'
                    when v_new_end_date >= v_current_local_date then 'active'
                    else 'expired'
                  end)::public.subscription_status_type,
        updated_at = now()
    where subscription_id = v_sub_id;
  else
    insert into public.student_subscriptions (
      student_id,
      course_id,
      institute_id,
      start_date,
      end_date,
      content_access_end_date,
      grace_end_date,
      status,
      plan_id
    ) values (
      v_student_id,
      v_agreement.course_id,
      v_agreement.institute_id,
      v_agreement.agreement_date,
      v_new_end_date,
      (v_new_end_date + interval '30 days')::date,
      case
        when v_new_overdue > 0 then v_new_end_date
        else null
      end,
      case
        when v_new_overdue > 0 then 'grace'::public.subscription_status_type
        when v_new_end_date >= v_current_local_date then 'active'::public.subscription_status_type
        else 'expired'::public.subscription_status_type
      end,
      null
    );
  end if;

  -- 11. Update Agreement State
  update public.student_course_agreements
  set outstanding_balance = v_new_outstanding,
      overdue_balance     = v_new_overdue,
      agreement_status    = case
                              when v_new_outstanding <= 0.00 then 'completed'
                              when v_new_overdue > 0.00 then 'in_arrears'
                              else 'active'
                            end,
      updated_at          = now()
  where agreement_id = v_agreement.agreement_id;

  -- 12. Return Authoritative Allocation Results
  return jsonb_build_object(
    'success', true,
    'agreement_id', v_agreement.agreement_id,
    'payment_id', p_payment_id,
    'allocated_amount', v_allocated_total,
    'unallocated_surplus', v_unallocated_amount,
    'outstanding_balance', v_new_outstanding,
    'overdue_balance', v_new_overdue,
    'consecutively_funded_milestone', v_consecutive_k,
    'paid_through_end_date', v_new_end_date,
    'terminal_end_date', v_terminal_end_date,
    'requires_admin_review', (coalesce(v_payment.refund_amount, 0.00) <> v_refund_adjustments or v_agreement.requires_admin_review),
    'refund_discrepancy', abs(coalesce(v_payment.refund_amount, 0.00) - v_refund_adjustments),
    'agreement_status', case
                          when v_new_outstanding <= 0.00 then 'completed'
                          when v_new_overdue > 0.00 then 'in_arrears'
                          else 'active'
                        end
  );
end;
$$;

comment on function public.process_installment_payment(uuid, uuid) is
  'Lock-order harmonized, transaction-safe FIFO installment allocation engine with orders-before-payments and agreements-before-schedule locking hierarchy, verified anchor D0, exact remainder-absorbing schedule reconciliation, pre-onboarding student_id adoption from verified agreement, arrears access-control synchronization, and explicit subscription_status_type enum casting.';

revoke all on function public.process_installment_payment(uuid, uuid) from public;
revoke all on function public.process_installment_payment(uuid, uuid) from anon;
grant execute on function public.process_installment_payment(uuid, uuid) to service_role;
grant execute on function public.process_installment_payment(uuid, uuid) to authenticated;
