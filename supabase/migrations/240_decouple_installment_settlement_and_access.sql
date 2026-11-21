-- ============================================================================
-- Migration: 240 — Decouple Installment Settlement and Access Control
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready | Idempotent
--
-- ## Phase 4A Objective:
-- Eliminate dependencies of the installment system on `public.student_subscriptions`.
--
-- 1. Updates `public.course_enrollments` check constraint to permit 'installment'
--    as an authoritative enrollment type alongside 'purchase', 'admin_grant',
--    'subscription', and 'free'.
-- 2. Replaces `public.process_installment_payment()`:
--    - Completely removes Step 10 (which wrote to `student_subscriptions`).
--    - Working directly through installment agreements, schedules, and allocations.
--    - On full settlement (zero outstanding balance), transitions the student to
--      permanent course ownership (`course_enrollments.enrollment_type = 'purchase'`).
-- 3. Replaces `public.can_student_access_content()`:
--    - Evaluates permanent ownership via `is_permanent_course_owner()`.
--    - Evaluates installment agreements, schedules, and 30-day content grace window
--      without reading `student_subscriptions`.
-- 4. Replaces `public.can_student_access_live_course()`:
--    - Evaluates permanent ownership via `is_permanent_course_owner()`.
--    - Enforces zero-arrears policy on installment agreements and schedules
--      without reading `student_subscriptions`.
-- 5. Replaces `public.authorize_live_class_access()`:
--    - Removes the Condition 3 check on `student_subscriptions`.
--    - Gated strictly by permanent ownership OR verified active installment agreement.
--    - Returns typed codes (INSTALLMENT_ARREARS_BLOCKED, AGREEMENT_UNDER_REVIEW, etc.).
-- 6. Replaces `public.verify_recording_playback_access()`:
--    - Preserves all arrears-before-content gate checks from Migration 239.
--    - Delegates content-tier evaluation to decoupled `can_student_access_content()`.
--
-- Security:
--   - SECURITY DEFINER with SET search_path = ''
--   - Canonical function grants preserved.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1: Extend course_enrollments.enrollment_type Check Constraint
-- ════════════════════════════════════════════════════════════════════════════

alter table public.course_enrollments
  drop constraint if exists ck_course_enrollments_enrollment_type;

alter table public.course_enrollments
  add constraint ck_course_enrollments_enrollment_type
  check (enrollment_type in ('purchase', 'admin_grant', 'subscription', 'free', 'installment'));

comment on constraint ck_course_enrollments_enrollment_type on public.course_enrollments is
  'Phase 4A: Permitted enrollment types: purchase (permanent full ownership), admin_grant, subscription (discontinued legacy), free, and installment (active installment agreement).';


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2: Decoupled Installment Settlement Engine
-- ════════════════════════════════════════════════════════════════════════════

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

  -- ==========================================================================
  -- 10. Decoupled Settlement: student_subscriptions Synchronization Completely Removed
  --     Installment entitlement operates natively through student_course_agreements
  --     and student_installment_schedule.
  -- ==========================================================================

  -- 11. Update Agreement State & Establish Permanent Ownership on Full Settlement
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

  -- Full settlement transition:
  -- When the remaining installment balance reaches 0.00, the agreement transitions
  -- to 'completed' and the student transitions to permanent course ownership:
  if v_new_outstanding <= 0.00 then
    update public.course_enrollments
    set enrollment_type = 'purchase',
        is_active = true,
        revoked_at = null,
        revoked_by = null,
        revoked_reason = null,
        updated_at = now()
    where student_id = v_student_id
      and course_id = v_agreement.course_id;

    if not found then
      insert into public.course_enrollments (
        course_id,
        student_id,
        institute_id,
        enrollment_type,
        is_active
      ) values (
        v_agreement.course_id,
        v_student_id,
        coalesce(v_order.institute_id, (select institute_id from public.courses where course_id = v_agreement.course_id)),
        'purchase',
        true
      )
      on conflict (course_id, student_id) do update
      set enrollment_type = 'purchase',
          is_active = true,
          revoked_at = null,
          revoked_by = null,
          revoked_reason = null,
          updated_at = now();
    end if;
  end if;

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
  'Phase 4A: Decoupled FIFO installment settlement engine. Completely independent of student_subscriptions. On full settlement (zero outstanding balance), transitions student to permanent ownership (course_enrollments.enrollment_type = purchase).';

revoke all on function public.process_installment_payment(uuid, uuid) from public;
revoke all on function public.process_installment_payment(uuid, uuid) from anon;
grant execute on function public.process_installment_payment(uuid, uuid) to service_role;
grant execute on function public.process_installment_payment(uuid, uuid) to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3: Decoupled Course Content Access (can_student_access_content)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.can_student_access_content(
    p_course_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student_id         uuid;
  v_institute_timezone text := 'Asia/Kolkata';
  v_current_local_date date;
  v_has_batches        boolean;
  v_assigned_to_batch  boolean;
  v_agr                record;
  v_consecutive_k      smallint;
  v_paid_through_date  date;
  v_content_end_date   date;
begin
  -- 1. Full Payment permanent course ownership (standalone entitlement)
  if public.is_permanent_course_owner(p_course_id) then
    return true;
  end if;

  -- 2. Resolve authenticated student identity
  v_student_id := public.get_my_student_id();
  if v_student_id is null then
    return false;
  end if;

  -- 3. Check batch assignment requirement:
  -- If course has linked batches, student MUST be assigned to an active linked batch.
  -- If course has no linked batches, direct course content access applies.
  select exists (
    select 1 from public.course_batches cb where cb.course_id = p_course_id
  ) into v_has_batches;

  if v_has_batches then
    v_assigned_to_batch := public.is_student_assigned_to_course_batch(p_course_id);
    if not v_assigned_to_batch then
      return false;
    end if;
  end if;

  -- 4. Resolve authoritative institute timezone & local calendar date
  select coalesce(i.timezone, 'Asia/Kolkata')
  into v_institute_timezone
  from public.courses c
  left join public.institutes i on i.institute_id = c.institute_id
  where c.course_id = p_course_id;

  v_current_local_date := (now() at time zone coalesce(v_institute_timezone, 'Asia/Kolkata'))::date;

  -- 5. Evaluate Student Course Agreement(s) for this course
  for v_agr in
    select sca.*, cip.number_of_installments, cip.interval_months
    from public.student_course_agreements sca
    join public.course_installment_plans cip on cip.plan_id = sca.plan_id
    where sca.student_id = v_student_id
      and sca.course_id = p_course_id
    order by sca.created_at desc
  loop
    -- Fail closed on administrative review
    if coalesce(v_agr.requires_admin_review, false) = true then
      return false;
    end if;

    -- Ineligible or unverified initial payment agreements cannot grant access
    if v_agr.agreement_status in ('cancelled_by_admin', 'withdrawn', 'defaulted', 'pending_initial_payment') then
      continue;
    end if;

    -- Fully completed agreements grant permanent content access
    if v_agr.agreement_status = 'completed' or coalesce(v_agr.outstanding_balance, 0.00) <= 0.00 then
      return true;
    end if;

    -- Active or in_arrears: calculate paid-through date from consecutively funded installments
    if v_agr.agreement_date is not null then
      select coalesce(max(installment_index), 0)
      into v_consecutive_k
      from (
        select installment_index,
               row_number() over (order by installment_index) as rn
        from public.student_installment_schedule
        where agreement_id = v_agr.agreement_id
          and (status in ('paid', 'waived') or (amount_paid + waiver_amount) >= amount_due)
      ) t
      where installment_index = rn;

      if v_consecutive_k > 0 then
        if v_consecutive_k >= v_agr.number_of_installments then
          return true;
        end if;

        v_paid_through_date := public.calculate_anchor_date(
          v_agr.agreement_date,
          (v_consecutive_k * v_agr.interval_months)::smallint
        );
        -- Non-recording content retains the 30-day grace / content window past paid-through date
        v_content_end_date := (v_paid_through_date + interval '30 days')::date;

        if v_current_local_date <= v_content_end_date then
          return true;
        end if;
      end if;
    end if;
  end loop;

  return false;
end;
$$;

comment on function public.can_student_access_content(uuid) is
  'Phase 4A: TRUE when caller permanently owns the course OR holds a valid installment agreement with active term or 30-day content grace window. Completely decoupled from student_subscriptions.';

revoke all on function public.can_student_access_content(uuid) from public;
grant execute on function public.can_student_access_content(uuid) to authenticated, service_role, anon;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4: Decoupled Live Course Access (can_student_access_live_course)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.can_student_access_live_course(
    p_course_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student_id         uuid;
  v_institute_timezone text := 'Asia/Kolkata';
  v_current_local_date date;
  v_has_batches        boolean;
  v_assigned_to_batch  boolean;
  v_agr                record;
  v_effective_overdue  numeric(10,2);
begin
  -- 1. Full Payment permanent course ownership
  if public.is_permanent_course_owner(p_course_id) then
    return true;
  end if;

  -- 2. Resolve authenticated student identity
  v_student_id := public.get_my_student_id();
  if v_student_id is null then
    return false;
  end if;

  -- 3. Batch assignment requirement
  select exists (
    select 1 from public.course_batches cb where cb.course_id = p_course_id
  ) into v_has_batches;

  if v_has_batches then
    v_assigned_to_batch := public.is_student_assigned_to_course_batch(p_course_id);
    if not v_assigned_to_batch then
      return false;
    end if;
  end if;

  -- 4. Institute local date
  select coalesce(i.timezone, 'Asia/Kolkata')
  into v_institute_timezone
  from public.courses c
  left join public.institutes i on i.institute_id = c.institute_id
  where c.course_id = p_course_id;

  v_current_local_date := (now() at time zone coalesce(v_institute_timezone, 'Asia/Kolkata'))::date;

  -- 5. Evaluate Installment Agreement(s)
  for v_agr in
    select sca.*
    from public.student_course_agreements sca
    where sca.student_id = v_student_id
      and sca.course_id = p_course_id
    order by sca.created_at desc
  loop
    -- Administrative review blocks live classes
    if coalesce(v_agr.requires_admin_review, false) = true then
      return false;
    end if;

    -- Only 'active' and 'completed' agreements are eligible for live classes
    if v_agr.agreement_status not in ('active', 'completed') then
      continue;
    end if;

    -- If completed with zero balance, live classes are accessible (subject to batch assignment)
    if v_agr.agreement_status = 'completed' and coalesce(v_agr.outstanding_balance, 0.00) <= 0.00 then
      return true;
    end if;

    -- Zero arrears requirement:
    v_effective_overdue := public.calculate_effective_overdue_balance(v_agr.agreement_id, v_current_local_date);
    if v_effective_overdue > 0.00 or coalesce(v_agr.overdue_balance, 0.00) > 0.00 then
      return false;
    end if;

    -- Dynamic schedule check: ensure no unpaid obligation has effective due date < current_local_date
    if exists (
      select 1 from public.student_installment_schedule sis
      where sis.agreement_id = v_agr.agreement_id
        and sis.status <> 'waived'
        and coalesce(sis.revised_due_date, sis.due_date) < v_current_local_date
        and (sis.amount_paid + sis.waiver_amount) < sis.amount_due
    ) then
      return false;
    end if;

    -- Agreement is active, batch assigned, and zero arrears
    return true;
  end loop;

  return false;
end;
$$;

comment on function public.can_student_access_live_course(uuid) is
  'Phase 4A: TRUE when caller permanently owns the course OR holds an active installment agreement free of arrears and assigned to an active batch. Completely decoupled from student_subscriptions.';

revoke all on function public.can_student_access_live_course(uuid) from public;
grant execute on function public.can_student_access_live_course(uuid) to authenticated, service_role, anon;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5: Decoupled Live Class Authorization (authorize_live_class_access)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.authorize_live_class_access(
  p_user_id   uuid,
  p_class_id  uuid default null,
  p_room_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_role           text;
  v_user_institute_id   uuid;
  v_teacher_id          uuid;
  v_student_id          uuid;
  v_class_row           record;
  v_can_publish         boolean := false;
  v_role                text;
  v_reason              text := 'Authorized';
  v_current_local_date  date;
  v_institute_timezone  text := 'Asia/Kolkata';
  v_batch_record        record;
  v_is_perm_owner       boolean := false;
  v_agreement_record    record;
  v_effective_overdue   numeric(10,2) := 0.00;
begin
  -- 1. Validate user identifier
  if p_user_id is null then
    return jsonb_build_object(
      'authorized', false,
      'error', 'Unauthorized: missing user identifier',
      'code', 'UNAUTHENTICATED'
    );
  end if;

  -- 2. Fetch user profile
  select p.role, p.institute_id
    into v_user_role, v_user_institute_id
    from public.profiles p
   where p.profile_id = p_user_id;

  if not found then
    return jsonb_build_object(
      'authorized', false,
      'error', 'Profile not found for authenticated user',
      'code', 'USER_NOT_FOUND'
    );
  end if;

  -- 3. Resolve the target live_classes record
  if p_class_id is not null then
    select lc.class_id, lc.institute_id, lc.teacher_id, lc.room_name, lc.status, lc.title, lc.scheduled_at, lc.duration_min
      into v_class_row
      from public.live_classes lc
     where lc.class_id = p_class_id;
  elsif p_room_name is not null and trim(p_room_name) != '' then
    select lc.class_id, lc.institute_id, lc.teacher_id, lc.room_name, lc.status, lc.title, lc.scheduled_at, lc.duration_min
      into v_class_row
      from public.live_classes lc
     where lc.room_name = trim(p_room_name);
  else
    return jsonb_build_object(
      'authorized', false,
      'error', 'Missing classId or roomName',
      'code', 'INVALID_PARAMETERS'
    );
  end if;

  if v_class_row.class_id is null then
    return jsonb_build_object(
      'authorized', false,
      'error', 'Live class not found',
      'code', 'CLASS_NOT_FOUND'
    );
  end if;

  -- 4. Cross-institute isolation
  if v_class_row.institute_id is not null and v_user_institute_id is not null and v_class_row.institute_id != v_user_institute_id then
    return jsonb_build_object(
      'authorized', false,
      'error', 'Cross-institute access denied',
      'code', 'CROSS_INSTITUTE_DENIED'
    );
  end if;

  -- 5. Cancelled class check
  if v_class_row.status = 'cancelled' then
    return jsonb_build_object(
      'authorized', false,
      'error', 'This live class has been cancelled.',
      'code', 'CLASS_CANCELLED'
    );
  end if;

  -- 6. Resolve timezone and current local date
  if v_class_row.institute_id is not null then
    select coalesce(timezone, 'Asia/Kolkata')
    into v_institute_timezone
    from public.institutes
    where institute_id = v_class_row.institute_id;
  end if;
  v_current_local_date := (now() at time zone coalesce(v_institute_timezone, 'Asia/Kolkata'))::date;

  -- 7. Role-based authorization & permission granting
  if v_user_role in ('teacher', 'faculty') then
    select td.teacher_id into v_teacher_id
      from public.teacher_details td
     where td.profile_id = p_user_id;

    if v_teacher_id is not null and v_class_row.teacher_id = v_teacher_id then
      v_can_publish := true;
      v_role := 'teacher';
    else
      return jsonb_build_object(
        'authorized', false,
        'error', 'Teacher is not assigned to conduct this class.',
        'code', 'TEACHER_NOT_ASSIGNED'
      );
    end if;

  elsif v_user_role in ('admin', 'super_admin') then
    v_can_publish := true;
    v_role := 'admin';

  else
    -- ========================================================================
    -- STUDENT ROLE: SERVER-SIDE QUAD-CHECK DECOUPLED FROM SUBSCRIPTIONS
    -- ========================================================================
    select sd.student_id into v_student_id
      from public.student_details sd
     where sd.profile_id = p_user_id;

    if v_student_id is null then
      return jsonb_build_object(
        'authorized', false,
        'error', 'Student details not found.',
        'code', 'STUDENT_NOT_FOUND'
      );
    end if;

    -- QUAD-CHECK CONDITION 1: Active Student Batch Assignment
    select b.batch_id, b.end_date, b.name as batch_name
    into v_batch_record
    from public.batches b
    join public.batch_students bs on bs.batch_id = b.batch_id
    where bs.student_id = v_student_id
      and bs.status = 'active'
      and (
        exists (
          select 1 from public.live_class_batch lcb
          where lcb.class_id = v_class_row.class_id and lcb.batch_id = b.batch_id
        )
        or
        exists (
          select 1 from public.batch_subjects bsub
          join public.batch_subject_live_classes bslc on bslc.batch_subject_id = bsub.batch_subject_id
          where bslc.class_id = v_class_row.class_id and bsub.batch_id = b.batch_id
        )
      )
    order by b.created_at desc
    limit 1;

    if v_batch_record.batch_id is null then
      return jsonb_build_object(
        'authorized', false,
        'error', 'Student is not enrolled in any active batch assigned to this live class.',
        'code', 'BATCH_NOT_ENROLLED'
      );
    end if;

    -- QUAD-CHECK CONDITION 2: Batch End Date (Applies to ALL students)
    if v_batch_record.end_date is not null and v_batch_record.end_date < v_current_local_date then
      return jsonb_build_object(
        'authorized', false,
        'error', 'This cohort batch has concluded. Live classes are no longer joinable for ended batches.',
        'code', 'BATCH_ENDED'
      );
    end if;

    -- QUAD-CHECK CONDITION 3: Course Entitlement & Installment Integrity
    select exists (
      select 1
      from public.course_batches cb
      where cb.batch_id = v_batch_record.batch_id
        and public.is_permanent_course_owner(cb.course_id)
    ) into v_is_perm_owner;

    if v_is_perm_owner then
      -- Permanent course owners pass Condition 3 unconditionally
      v_can_publish := false;
      v_role := 'student';
    else
      -- Non-permanent owners MUST hold an eligible installment agreement
      select sca.*
      into v_agreement_record
      from public.course_batches cb
      join public.student_course_agreements sca
        on sca.course_id = cb.course_id and sca.student_id = v_student_id
      where cb.batch_id = v_batch_record.batch_id
      order by sca.created_at desc
      limit 1;

      if not found or v_agreement_record.agreement_id is null then
        return jsonb_build_object(
          'authorized', false,
          'error', 'Valid course ownership or active installment agreement required to join live classes.',
          'code', 'COURSE_ENTITLEMENT_REQUIRED'
        );
      end if;

      -- 3a. Administrative review check (fail-closed financial guard)
      if coalesce(v_agreement_record.requires_admin_review, false) = true then
        return jsonb_build_object(
          'authorized', false,
          'error', 'Installment agreement is pending administrative review. Live classes are suspended.',
          'code', 'AGREEMENT_UNDER_REVIEW'
        );
      end if;

      -- 3b. Pending initial payment verification
      if v_agreement_record.agreement_status = 'pending_initial_payment' then
        return jsonb_build_object(
          'authorized', false,
          'error', 'Initial installment payment has not been verified. Access is suspended.',
          'code', 'INITIAL_PAYMENT_PENDING'
        );
      end if;

      -- 3c. Explicit allowlist: ONLY 'active' and 'completed' are eligible states
      if v_agreement_record.agreement_status not in ('active', 'completed') then
        if v_agreement_record.agreement_status = 'in_arrears' then
          return jsonb_build_object(
            'authorized', false,
            'error', 'Live-class access is suspended due to an overdue installment. Please clear your overdue payment to restore access.',
            'code', 'INSTALLMENT_ARREARS_BLOCKED'
          );
        else
          return jsonb_build_object(
            'authorized', false,
            'error', 'Installment agreement is not in good standing (' || v_agreement_record.agreement_status || '). Live classes are suspended.',
            'code', 'AGREEMENT_INELIGIBLE'
          );
        end if;
      end if;

      -- 3d. Dynamic Overdue Balance Check (accounts for payments, waivers, and reschedules)
      v_effective_overdue := public.calculate_effective_overdue_balance(v_agreement_record.agreement_id, v_current_local_date);

      if v_effective_overdue > 0.00 or coalesce(v_agreement_record.overdue_balance, 0.00) > 0.00 then
        return jsonb_build_object(
          'authorized', false,
          'error', 'Live-class access is suspended due to an overdue installment. Please clear your overdue payment to restore access.',
          'code', 'INSTALLMENT_ARREARS_BLOCKED'
        );
      end if;

      -- 3e. Dynamic Schedule Check: Ensure no unpaid effective obligation has effective due date < current_local_date
      if exists (
        select 1 from public.student_installment_schedule sis
        where sis.agreement_id = v_agreement_record.agreement_id
          and sis.status <> 'waived'
          and coalesce(sis.revised_due_date, sis.due_date) < v_current_local_date
          and (sis.amount_paid + sis.waiver_amount) < sis.amount_due
      ) then
        return jsonb_build_object(
          'authorized', false,
          'error', 'Live-class access is suspended due to an overdue installment. Please clear your overdue payment to restore access.',
          'code', 'INSTALLMENT_ARREARS_BLOCKED'
        );
      end if;

      v_can_publish := false;
      v_role := 'student';
    end if;
  end if;

  return jsonb_build_object(
    'authorized', true,
    'classId', v_class_row.class_id,
    'roomName', coalesce(v_class_row.room_name, 'room-' || v_class_row.class_id::text),
    'role', v_role,
    'canPublish', v_can_publish,
    'title', v_class_row.title,
    'status', v_class_row.status,
    'reason', v_reason
  );
end;
$$;

comment on function public.authorize_live_class_access(uuid, uuid, text) is
  'Phase 4A: SECURITY DEFINER RPC implementing Quad-Check live-class authorization completely independent of student_subscriptions. Validates active batch assignment, enforces batch end-date cutoff, verifies permanent ownership or active zero-arrears installment agreement.';

revoke all on function public.authorize_live_class_access(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.authorize_live_class_access(uuid, uuid, text) to service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6: Decoupled Recording Playback Access (verify_recording_playback_access)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.verify_recording_playback_access(
  p_recording_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id                   uuid;
  v_role                      text;
  v_caller_institute_id       uuid;
  v_rec                       record;
  v_teacher_id                uuid;
  v_owns_recording            boolean := false;
  v_student_id                uuid;
  v_institute_timezone        text := 'Asia/Kolkata';
  v_current_local_date        date;
  v_course_rec                record;
  v_agr                       record;
  v_effective_overdue         numeric(10,2) := 0.00;
  v_course_blocked            boolean := false;
  v_course_block_code         text := null;
  v_has_arrears_block         boolean := false;
  v_has_review_block          boolean := false;
  v_has_pending_initial_block boolean := false;
  v_has_ineligible_block      boolean := false;
begin
  -- 1. Validate caller identity (derive strictly from auth.uid())
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object(
      'allowed', false,
      'status_code', 401,
      'http_status', 401,
      'error_code', 'UNAUTHORIZED',
      'error_message', 'Authentication required. Provide a valid Bearer token.'
    );
  end if;

  -- 2. Fetch authoritative user profile and role
  select p.role, p.institute_id
  into v_role, v_caller_institute_id
  from public.profiles p
  where p.profile_id = v_user_id;

  if not found or v_role is null then
    return jsonb_build_object(
      'allowed', false,
      'status_code', 403,
      'http_status', 403,
      'error_code', 'UNAUTHORIZED_ROLE',
      'error_message', 'Unauthorized role. Access denied.'
    );
  end if;

  if v_role not in ('admin', 'super_admin', 'teacher', 'faculty', 'student') then
    return jsonb_build_object(
      'allowed', false,
      'status_code', 403,
      'http_status', 403,
      'error_code', 'UNAUTHORIZED_ROLE',
      'error_message', 'Unauthorized role. Access denied.'
    );
  end if;

  -- 3. Resolve target recording
  select
    r.recording_id,
    r.institute_id,
    r.storage_path,
    r.storage_bucket,
    r.duration_seconds,
    r.status,
    r.is_deleted,
    r.created_by,
    r.live_class_id
  into v_rec
  from public.recordings r
  where r.recording_id = p_recording_id;

  if not found or v_rec.recording_id is null then
    return jsonb_build_object(
      'allowed', false,
      'status_code', 404,
      'http_status', 404,
      'error_code', 'RECORDING_NOT_FOUND',
      'error_message', 'Recording not found.'
    );
  end if;

  -- 4. Cross-tenant isolation check
  if v_caller_institute_id is not null and v_rec.institute_id is not null and v_caller_institute_id <> v_rec.institute_id then
    return jsonb_build_object(
      'allowed', false,
      'status_code', 403,
      'http_status', 403,
      'error_code', 'CROSS_INSTITUTE_DENIED',
      'error_message', 'Access denied across institute boundaries.'
    );
  end if;

  -- 5. Soft-delete check
  if coalesce(v_rec.is_deleted, false) = true then
    return jsonb_build_object(
      'allowed', false,
      'status_code', 404,
      'http_status', 404,
      'error_code', 'RECORDING_DELETED',
      'error_message', 'This recording has been deleted.'
    );
  end if;

  -- 6. Recording status check
  if coalesce(v_rec.status, '') <> 'completed' then
    return jsonb_build_object(
      'allowed', false,
      'status_code', 400,
      'http_status', 400,
      'error_code', 'RECORDING_NOT_COMPLETED',
      'error_message', 'This recording is not ready for playback.'
    );
  end if;

  -- 7. Storage path check
  if v_rec.storage_path is null or trim(v_rec.storage_path) = '' then
    return jsonb_build_object(
      'allowed', false,
      'status_code', 404,
      'http_status', 404,
      'error_code', 'RECORDING_FILE_MISSING',
      'error_message', 'Recording media file path is missing.'
    );
  end if;

  -- 8. Role-based routing: Admin and Teacher access
  if v_role in ('admin', 'super_admin') then
    return jsonb_build_object(
      'allowed', true,
      'status_code', 200,
      'http_status', 200,
      'role', 'admin',
      'storage_bucket', v_rec.storage_bucket,
      'storage_path', v_rec.storage_path,
      'duration_seconds', v_rec.duration_seconds
    );
  end if;

  if v_role in ('teacher', 'faculty') then
    select t.teacher_id
    into v_teacher_id
    from public.teacher_details t
    where t.profile_id = v_user_id;

    if v_teacher_id is not null then
      if v_rec.created_by = v_user_id then
        v_owns_recording := true;
      elsif v_rec.live_class_id is not null then
        select exists (
          select 1
          from public.live_classes lc
          where lc.class_id = v_rec.live_class_id
            and lc.teacher_id = v_teacher_id
        ) into v_owns_recording;
      end if;

      if not v_owns_recording then
        select exists (
          select 1
          from public.batch_subject_recordings bsr
          join public.batch_subjects bs on bs.batch_subject_id = bsr.batch_subject_id
          join public.batch_teachers bt on bt.batch_id = bs.batch_id
          where bsr.recording_id = p_recording_id
            and bt.teacher_id = v_teacher_id
            and bt.is_active = true
            and bs.is_active = true
        ) into v_owns_recording;
      end if;

      if not v_owns_recording then
        select exists (
          select 1
          from public.batch_subject_recordings bsr
          join public.batch_subjects bs on bs.batch_subject_id = bsr.batch_subject_id
          where bsr.recording_id = p_recording_id
            and bs.teacher_id = v_teacher_id
            and bs.is_active = true
        ) into v_owns_recording;
      end if;
    end if;

    if v_owns_recording then
      return jsonb_build_object(
        'allowed', true,
        'status_code', 200,
        'http_status', 200,
        'role', 'teacher',
        'storage_bucket', v_rec.storage_bucket,
        'storage_path', v_rec.storage_path,
        'duration_seconds', v_rec.duration_seconds
      );
    else
      return jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'http_status', 403,
        'error_code', 'TEACHER_NOT_ASSIGNED',
        'error_message', 'You are not assigned to conduct or manage this recording.'
      );
    end if;
  end if;

  -- 9. Student authorization pipeline
  if v_role = 'student' then
    select s.student_id
    into v_student_id
    from public.student_details s
    where s.profile_id = v_user_id;

    if not found or v_student_id is null then
      return jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'http_status', 403,
        'error_code', 'STUDENT_NOT_FOUND',
        'error_message', 'Student profile not found.'
      );
    end if;

    -- Verify active batch mapping exists
    if not exists (
      select 1
      from public.batch_subject_recordings bsr
      join public.batch_subjects bs on bs.batch_subject_id = bsr.batch_subject_id
      where bsr.recording_id = p_recording_id
        and bs.is_active = true
    ) then
      return jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'http_status', 403,
        'error_code', 'NO_ACTIVE_BATCH',
        'error_message', 'This recording is not assigned to any active batch.'
      );
    end if;

    -- Verify student active batch membership OR permanent course ownership
    if not exists (
      select 1
      from public.batch_subject_recordings bsr
      join public.batch_subjects bs on bs.batch_subject_id = bsr.batch_subject_id
      join public.batch_students bstud on bstud.batch_id = bs.batch_id
      where bsr.recording_id = p_recording_id
        and bs.is_active = true
        and bstud.student_id = v_student_id
        and bstud.status = 'active'
    ) and not exists (
      select 1
      from public.batch_subject_recordings bsr
      join public.batch_subjects bs on bs.batch_subject_id = bsr.batch_subject_id
      join public.course_batches cb on cb.batch_id = bs.batch_id
      where bsr.recording_id = p_recording_id
        and bs.is_active = true
        and public.is_permanent_course_owner(cb.course_id)
    ) then
      return jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'http_status', 403,
        'error_code', 'NOT_ASSIGNED_TO_RECORDING',
        'error_message', 'You are not assigned to this recording.'
      );
    end if;

    -- Resolve institute timezone & current local calendar date
    if v_rec.institute_id is not null then
      select coalesce(timezone, 'Asia/Kolkata')
      into v_institute_timezone
      from public.institutes
      where institute_id = v_rec.institute_id;
    end if;
    v_current_local_date := (now() at time zone coalesce(v_institute_timezone, 'Asia/Kolkata'))::date;

    -- ========================================================================
    -- INSTALLMENT ARREARS & MULTI-COURSE APPLICABILITY GATE
    -- ========================================================================
    for v_course_rec in
      select distinct cb.course_id
      from public.batch_subject_recordings bsr
      join public.batch_subjects bs on bs.batch_subject_id = bsr.batch_subject_id
      join public.course_batches cb on cb.batch_id = bs.batch_id
      where bsr.recording_id = p_recording_id
        and bs.is_active = true
        and (
          exists (
            select 1 from public.batch_students bstud
            where bstud.batch_id = bs.batch_id
              and bstud.student_id = v_student_id
              and bstud.status = 'active'
          )
          or public.is_permanent_course_owner(cb.course_id)
        )
    loop
      v_course_blocked := false;
      v_course_block_code := null;

      -- 1. Evaluate Installment Agreement Obligations for this specific course
      for v_agr in
        select sca.*
        from public.student_course_agreements sca
        where sca.course_id = v_course_rec.course_id
          and sca.student_id = v_student_id
        order by sca.created_at desc
      loop
        -- Terminal agreement handling:
        -- If student holds independent permanent course ownership, the dead agreement does not block.
        -- If student lacks permanent ownership, the terminated agreement cannot grant access.
        if v_agr.agreement_status in ('cancelled_by_admin', 'withdrawn', 'defaulted') then
          if public.is_permanent_course_owner(v_course_rec.course_id) then
            continue;
          else
            v_course_blocked := true;
            v_course_block_code := 'AGREEMENT_INELIGIBLE';
            exit;
          end if;
        end if;

        -- A. Administrative review queue check (fail-closed financial safety guard)
        if coalesce(v_agr.requires_admin_review, false) = true then
          v_course_blocked := true;
          v_course_block_code := 'AGREEMENT_UNDER_REVIEW';
          exit;
        end if;

        -- B. Pending initial payment verification
        if v_agr.agreement_status = 'pending_initial_payment' then
          v_course_blocked := true;
          v_course_block_code := 'INITIAL_PAYMENT_PENDING';
          exit;
        end if;

        -- C. Explicit in_arrears status
        if v_agr.agreement_status = 'in_arrears' then
          v_course_blocked := true;
          v_course_block_code := 'INSTALLMENT_ARREARS_BLOCKED';
          exit;
        end if;

        -- D. Active or Completed: dynamic overdue calculation & schedule check
        if v_agr.agreement_status in ('active', 'completed') then
          v_effective_overdue := public.calculate_effective_overdue_balance(v_agr.agreement_id, v_current_local_date);
          if v_effective_overdue > 0.00 then
            v_course_blocked := true;
            v_course_block_code := 'INSTALLMENT_ARREARS_BLOCKED';
            exit;
          end if;

          -- Dynamic schedule check: effective due date strictly before current local calendar day
          if exists (
            select 1 from public.student_installment_schedule sis
            where sis.agreement_id = v_agr.agreement_id
              and sis.status <> 'waived'
              and coalesce(sis.revised_due_date, sis.due_date) < v_current_local_date
              and (sis.amount_paid + sis.waiver_amount) < sis.amount_due
          ) then
            v_course_blocked := true;
            v_course_block_code := 'INSTALLMENT_ARREARS_BLOCKED';
            exit;
          end if;
        else
          -- Any unrecognized non-terminal status fails closed
          v_course_blocked := true;
          v_course_block_code := 'AGREEMENT_INELIGIBLE';
          exit;
        end if;
      end loop;

      -- Record specific blocker encountered for downstream reporting
      if v_course_block_code = 'INSTALLMENT_ARREARS_BLOCKED' then
        v_has_arrears_block := true;
      elsif v_course_block_code = 'AGREEMENT_UNDER_REVIEW' then
        v_has_review_block := true;
      elsif v_course_block_code = 'INITIAL_PAYMENT_PENDING' then
        v_has_pending_initial_block := true;
      elsif v_course_block_code = 'AGREEMENT_INELIGIBLE' then
        v_has_ineligible_block := true;
      end if;

      -- 2. If this course is not blocked by installment obligations, check content access
      if not v_course_blocked then
        if public.can_student_access_content(v_course_rec.course_id) = true then
          return jsonb_build_object(
            'allowed', true,
            'status_code', 200,
            'http_status', 200,
            'role', 'student',
            'storage_bucket', v_rec.storage_bucket,
            'storage_path', v_rec.storage_path,
            'duration_seconds', v_rec.duration_seconds
          );
        end if;
      end if;
    end loop;

    -- If no candidate course granted clear access, return authoritative denial reason
    if v_has_arrears_block then
      return jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'http_status', 403,
        'error_code', 'INSTALLMENT_ARREARS_BLOCKED',
        'error_message', 'Your installment is overdue. Please complete the pending payment to access recorded classes.'
      );
    elsif v_has_review_block then
      return jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'http_status', 403,
        'error_code', 'AGREEMENT_UNDER_REVIEW',
        'error_message', 'Installment agreement is pending administrative review. Recorded classes are suspended.'
      );
    elsif v_has_pending_initial_block then
      return jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'http_status', 403,
        'error_code', 'INITIAL_PAYMENT_PENDING',
        'error_message', 'Initial installment payment has not been verified. Recorded classes are suspended.'
      );
    elsif v_has_ineligible_block then
      return jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'http_status', 403,
        'error_code', 'AGREEMENT_INELIGIBLE',
        'error_message', 'Installment agreement is not in good standing. Recorded classes are suspended.'
      );
    else
      return jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'http_status', 403,
        'error_code', 'RECORDING_ACCESS_EXPIRED',
        'error_message', 'Your course content access window has expired. Please enroll or clear pending installments to continue watching.'
      );
    end if;
  end if;

  return jsonb_build_object(
    'allowed', false,
    'status_code', 403,
    'http_status', 403,
    'error_code', 'UNAUTHORIZED_ROLE',
    'error_message', 'Unauthorized role.'
  );
end;
$$;

comment on function public.verify_recording_playback_access(uuid) is
  'Phase 4A: Authoritative dynamic recording playback access verification completely independent of student_subscriptions. Gated by installment arrears lockout and decoupled can_student_access_content().';

revoke all on function public.verify_recording_playback_access(uuid) from public;
grant execute on function public.verify_recording_playback_access(uuid) to authenticated, service_role, anon;
