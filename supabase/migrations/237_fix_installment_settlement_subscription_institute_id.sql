-- ============================================================================
-- Migration: 237 — Fix Installment Settlement Subscription Institute ID
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready | Idempotent
--
-- ## Root Cause
-- In Migration 234, public.process_installment_payment(uuid, uuid) was updated
-- with retry and lock-hierarchy hardening.
-- When onboarding an initial installment payment into a new
-- public.student_subscriptions record (the ELSE branch where v_sub_id IS NULL),
-- line 2094 evaluated:
--   v_agreement.institute_id
-- However, public.student_course_agreements does not contain an institute_id column.
-- When a student purchases a course via installment for the first time, PostgreSQL
-- threw runtime error:
--   record "v_agreement" has no field "institute_id" (SQLSTATE 42703)
-- This aborted the settlement transaction, causing edge function
-- complete-installment-purchase and razorpay-webhook to fail with HTTP 500
-- (INSTALLMENT_FULFILLMENT_TRANSIENT_FAILURE).
--
-- ## Remediation
-- Update public.process_installment_payment(uuid, uuid) to resolve institute_id
-- from the locked order and course records:
--   coalesce(v_order.institute_id, (select institute_id from public.courses where course_id = v_agreement.course_id))
-- preserving 100% of canonical FIFO allocation, locking order, anchor date D0,
-- and subscription status logic.
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
      coalesce(v_order.institute_id, (select institute_id from public.courses where course_id = v_agreement.course_id)),
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

