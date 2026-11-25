-- ============================================================================
-- Migration 253: Installment Email Notifications Infrastructure (Phase 4)
--
-- Implements Phase 4 transactional email notification backend infrastructure:
-- 1. Helper function: public.cancel_stale_installment_email_jobs()
--    Cancels obsolete pending reminder jobs (INS-03, INS-04, INS-05, INS-06)
--    when obligations are paid, rescheduled, or settled in full.
--    Uses a single data-modifying CTE statement with FOR UPDATE SKIP LOCKED.
-- 2. Authoritative update to public.process_installment_payment()
--    - Captures authoritative pre-settlement agreement status under exclusive lock.
--    - Cancels obsolete pending reminder jobs inside non-blocking exception blocks.
--    - Returns authoritative transition metadata: previous_agreement_status and
--      previous_overdue_balance (100% backward-compatible).
-- 3. Database trigger trg_installment_adjustment_rescheduled on public.installment_adjustments
--    - Synchronizes student_installment_schedule.revised_due_date.
--    - Captures previous effective due date COALESCE(revised_due_date, due_date).
--    - Restores overdue status to pending for future revised dates.
--    - Cancels stale reminder jobs for the rescheduled tranche.
--    - Enqueues INS-08 notification inside non-blocking exception block.
-- 4. Daily reminder sweep procedure: public.sweep_installment_reminders()
--    - Evaluates business date in Asia/Kolkata timezone ((now() AT TIME ZONE 'Asia/Kolkata')::date).
--    - Uses explicit status allowlists ('pending', 'overdue').
--    - Scans for INS-03 (T-3), INS-04 (T-0), INS-05 (T+1), and INS-06 (T+7).
--    - INS-06 evaluates every eligible overdue tranche per agreement with per-tranche
--      idempotency keys (inst_arr_7d:{agreement_id}:{schedule_id}:{effective_due_date}).
-- 5. Registers daily pg_cron job 'sweep-installment-reminders-daily' at 08:00 AM IST
--    (02:30 AM UTC -> '30 2 * * *') using idempotent unschedule-then-schedule.
--
-- Security:
--   - SECURITY DEFINER with fixed search_path = public, pg_temp.
--   - cancel_stale_installment_email_jobs, handle_installment_due_date_rescheduled,
--     and sweep_installment_reminders have EXECUTE revoked from public, anon, and authenticated.
--   - Executable strictly by service_role (and internal SECURITY DEFINER callers).
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1: Helper: Cancel Stale Installment Email Jobs
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cancel_stale_installment_email_jobs(
    p_agreement_id uuid,
    p_schedule_id  uuid DEFAULT NULL,
    p_reason       text DEFAULT 'OBLIGATION_SETTLED_OR_RESCHEDULED'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_cancelled_count integer := 0;
BEGIN
    IF p_agreement_id IS NULL AND p_schedule_id IS NULL THEN
        RETURN 0;
    END IF;

    -- Single data-modifying CTE: target_jobs -> cancelled_rows -> inserted_logs
    WITH target_jobs AS (
        SELECT queue_id
        FROM public.email_queue
        WHERE status = 'pending'
          AND event_type IN ('INS-03', 'INS-04', 'INS-05', 'INS-06')
          AND (
            (p_schedule_id IS NOT NULL AND payload->>'scheduleId' = p_schedule_id::text)
            OR (p_schedule_id IS NULL AND p_agreement_id IS NOT NULL AND payload->>'agreementId' = p_agreement_id::text)
          )
        FOR UPDATE SKIP LOCKED
    ),
    cancelled_rows AS (
        UPDATE public.email_queue eq
        SET status = 'cancelled',
            last_error = p_reason,
            locked_at = NULL,
            locked_by = NULL,
            updated_at = clock_timestamp()
        FROM target_jobs tj
        WHERE eq.queue_id = tj.queue_id
        RETURNING eq.queue_id
    ),
    inserted_logs AS (
        INSERT INTO public.email_delivery_logs (
            queue_id,
            provider,
            event_type,
            payload
        )
        SELECT
            cr.queue_id,
            'system',
            'cancelled',
            jsonb_build_object(
                'reason', p_reason,
                'agreement_id', p_agreement_id,
                'schedule_id', p_schedule_id,
                'cancelled_at', clock_timestamp()
            )
        FROM cancelled_rows cr
        RETURNING log_id
    )
    SELECT count(*)::integer INTO v_cancelled_count FROM cancelled_rows;

    RETURN v_cancelled_count;
END;
$$;

COMMENT ON FUNCTION public.cancel_stale_installment_email_jobs(uuid, uuid, text) IS
  'Phase 4: Cancels pending reminder email jobs (INS-03..INS-06) when an installment obligation is paid, waived, or rescheduled. Historical sent emails are never modified.';

REVOKE ALL ON FUNCTION public.cancel_stale_installment_email_jobs(uuid, uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.cancel_stale_installment_email_jobs(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.cancel_stale_installment_email_jobs(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_stale_installment_email_jobs(uuid, uuid, text) TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2: Enhanced process_installment_payment with Transition Auditing
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
  v_prev_status           text;
  v_prev_overdue          numeric(10,2) := 0.00;
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

  -- Capture authoritative pre-settlement status under exclusive row lock (Phase 4)
  v_prev_status  := v_agreement.agreement_status;
  v_prev_overdue := coalesce(v_agreement.overdue_balance, 0.00);

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

    -- If this installment tranche is settled in full, cancel any obsolete pending reminder jobs (Phase 4)
    -- Housekeeping failure must NEVER abort or rollback the financial settlement transaction
    if (v_sched_allocated + v_to_pay + v_sched.waiver_amount) >= v_sched.amount_due then
      begin
        perform public.cancel_stale_installment_email_jobs(
          v_agreement.agreement_id,
          v_sched.schedule_id,
          'SETTLED: Installment tranche paid'
        );
      exception when others then
        null;
      end;
    end if;

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
    -- Cancel all pending installment reminder jobs for this agreement (Phase 4)
    -- Housekeeping failure must NEVER abort or rollback the financial settlement transaction
    begin
      perform public.cancel_stale_installment_email_jobs(
        v_agreement.agreement_id,
        null,
        'SETTLED: Entire installment plan completed'
      );
    exception when others then
      null;
    end;
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
    'previous_agreement_status', v_prev_status,
    'previous_overdue_balance', v_prev_overdue,
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



-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3: Trigger for INS-08 (Installment Due Date Rescheduled)
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_installment_due_date_rescheduled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_recipient_email            text;
    v_recipient_name             text;
    v_profile_id                 uuid;
    v_course_title               text;
    v_previous_effective_due_date date;
    v_amount_due                 numeric(10,2);
    v_schedule_id                uuid;
    v_today                      date;
    v_is_eligible                boolean := false;
BEGIN
    -- Evaluate trigger eligibility across separate INSERT and UPDATE branches
    -- OLD is strictly isolated and evaluated only when TG_OP = 'UPDATE'
    IF NEW.adjustment_type = 'reschedule'
       AND NEW.status = 'processed'
       AND NEW.revised_due_date IS NOT NULL THEN

        IF TG_OP = 'INSERT' THEN
            v_is_eligible := true;
        ELSIF TG_OP = 'UPDATE' THEN
            IF OLD.status IS DISTINCT FROM 'processed'
               OR OLD.revised_due_date IS DISTINCT FROM NEW.revised_due_date THEN
                v_is_eligible := true;
            END IF;
        END IF;

    END IF;

    IF v_is_eligible THEN

        v_today := (now() AT TIME ZONE 'Asia/Kolkata')::date;

        -- 1. Lock and capture previous effective due date BEFORE updating
        SELECT 
            schedule_id, 
            COALESCE(revised_due_date, due_date), 
            (amount_due - amount_paid - waiver_amount)
        INTO 
            v_schedule_id, 
            v_previous_effective_due_date, 
            v_amount_due
        FROM public.student_installment_schedule
        WHERE agreement_id = NEW.agreement_id
          AND installment_index = NEW.installment_index
        FOR UPDATE;

        IF v_schedule_id IS NULL THEN
            RAISE EXCEPTION 'Installment schedule row not found for agreement % installment index %',
                NEW.agreement_id, NEW.installment_index;
        END IF;

        -- 2. Atomically persist revised_due_date and restore status if date is future
        UPDATE public.student_installment_schedule
        SET revised_due_date = NEW.revised_due_date,
            status = CASE
                       WHEN status = 'overdue' AND NEW.revised_due_date >= v_today
                       THEN 'pending'
                       ELSE status
                     END,
            updated_at = now()
        WHERE schedule_id = v_schedule_id;

        -- 3. Atomically cancel any obsolete pending reminder jobs for this tranche (non-blocking)
        BEGIN
            PERFORM public.cancel_stale_installment_email_jobs(
                p_agreement_id => NEW.agreement_id,
                p_schedule_id  => v_schedule_id,
                p_reason       => 'RESCHEDULED: Due date extended to ' || NEW.revised_due_date::text
            );
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;

        -- 4. Enqueue INS-08 inside non-blocking exception block
        -- Email enqueue failure must NEVER roll back an authorized, approved reschedule
        BEGIN
            SELECT p.email, p.name, p.profile_id, c.title
            INTO v_recipient_email, v_recipient_name, v_profile_id, v_course_title
            FROM public.student_course_agreements sca
            JOIN public.student_details sd ON sd.student_id = sca.student_id
            JOIN public.profiles p ON p.profile_id = sd.profile_id
            JOIN public.courses c ON c.course_id = sca.course_id
            WHERE sca.agreement_id = NEW.agreement_id;

            IF v_recipient_email IS NOT NULL AND position('@' in v_recipient_email) > 0 THEN
                PERFORM public.enqueue_email_job(
                    p_recipient_email      => v_recipient_email,
                    p_subject              => 'Your Installment Due Date Has Been Updated — Make Me Topper',
                    p_template_id          => 'INS-08',
                    p_payload              => jsonb_build_object(
                        'courseName', v_course_title,
                        'installmentNumber', NEW.installment_index,
                        'originalDueDate', v_previous_effective_due_date::text,
                        'newDueDate', NEW.revised_due_date::text,
                        'amountDue', COALESCE(v_amount_due, NEW.amount, 0.00),
                        'reason', COALESCE(NEW.reason, 'Approved academic extension'),
                        'scheduleId', v_schedule_id,
                        'agreementId', NEW.agreement_id,
                        'effectiveDueDate', NEW.revised_due_date::text
                    ),
                    p_recipient_profile_id => v_profile_id,
                    p_recipient_name       => v_recipient_name,
                    p_event_type           => 'INS-08',
                    p_priority             => 'high'::public.email_priority,
                    p_idempotency_key      => 'inst_resched:' || NEW.adjustment_id::text || ':' || NEW.revised_due_date::text
                );
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'INS-08 notification enqueue failed for adjustment %: %', NEW.adjustment_id, SQLERRM;
        END;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_installment_due_date_rescheduled() IS
  'Phase 4: Database trigger function for INS-08. Persists revised_due_date, cancels obsolete reminders, and enqueues student notification.';

REVOKE ALL ON FUNCTION public.handle_installment_due_date_rescheduled() FROM public;
REVOKE ALL ON FUNCTION public.handle_installment_due_date_rescheduled() FROM anon;
REVOKE ALL ON FUNCTION public.handle_installment_due_date_rescheduled() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.handle_installment_due_date_rescheduled() TO service_role;

DROP TRIGGER IF EXISTS trg_installment_adjustment_rescheduled ON public.installment_adjustments;
CREATE TRIGGER trg_installment_adjustment_rescheduled
    AFTER INSERT OR UPDATE ON public.installment_adjustments
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_installment_due_date_rescheduled();

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4: Daily Reminder Sweep Procedure (INS-03, INS-04, INS-05, INS-06)
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sweep_installment_reminders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_today          date;
    v_rec            record;
    v_ins03_count    integer := 0;
    v_ins04_count    integer := 0;
    v_ins05_count    integer := 0;
    v_ins06_count    integer := 0;
    v_total_enqueued integer := 0;
BEGIN
    -- Strict calendar anchor in Indian Standard Time (Asia/Kolkata)
    v_today := (now() AT TIME ZONE 'Asia/Kolkata')::date;

    -- =========================================================================
    -- SWEEP 1: INS-03 — Installment Due in 3 Days (T-3)
    -- =========================================================================
    FOR v_rec IN
        SELECT
            sis.schedule_id,
            sis.agreement_id,
            sis.installment_index,
            COALESCE(sis.revised_due_date, sis.due_date) AS effective_due_date,
            (sis.amount_due - sis.amount_paid - sis.waiver_amount) AS amount_due,
            cip.number_of_installments AS total_installments,
            c.title AS course_title,
            p.email AS recipient_email,
            p.name AS recipient_name,
            p.profile_id AS recipient_profile_id
        FROM public.student_installment_schedule sis
        JOIN public.student_course_agreements sca ON sca.agreement_id = sis.agreement_id
        JOIN public.course_installment_plans cip ON cip.plan_id = sca.plan_id
        JOIN public.courses c ON c.course_id = sca.course_id
        JOIN public.student_details sd ON sd.student_id = sca.student_id
        JOIN public.profiles p ON p.profile_id = sd.profile_id
        WHERE (sis.status = 'pending')
          AND ((sis.amount_due - sis.amount_paid - sis.waiver_amount) > 0.00)
          AND (COALESCE(sis.revised_due_date, sis.due_date) = (v_today + 3))
          AND (sca.agreement_status IN ('active', 'in_arrears'))
          AND (sca.outstanding_balance > 0.00)
          AND (COALESCE(sca.requires_admin_review, false) = false)
          AND (p.email IS NOT NULL AND position('@' in p.email) > 0)
    LOOP
        PERFORM public.enqueue_email_job(
            p_recipient_email      => v_rec.recipient_email,
            p_subject              => 'Your Make Me Topper installment is due in 3 days',
            p_template_id          => 'INS-03',
            p_payload              => jsonb_build_object(
                'courseName', v_rec.course_title,
                'installmentNumber', v_rec.installment_index,
                'totalInstallments', v_rec.total_installments,
                'amountDue', v_rec.amount_due,
                'dueDate', v_rec.effective_due_date::text,
                'effectiveDueDate', v_rec.effective_due_date::text,
                'scheduleId', v_rec.schedule_id,
                'agreementId', v_rec.agreement_id
            ),
            p_recipient_profile_id => v_rec.recipient_profile_id,
            p_recipient_name       => v_rec.recipient_name,
            p_event_type           => 'INS-03',
            p_priority             => 'normal'::public.email_priority,
            p_idempotency_key      => 'inst_due_3d:' || v_rec.schedule_id::text || ':' || v_rec.effective_due_date::text
        );
        v_ins03_count := v_ins03_count + 1;
    END LOOP;

    -- =========================================================================
    -- SWEEP 2: INS-04 — Installment Due Today (T-0)
    -- =========================================================================
    FOR v_rec IN
        SELECT
            sis.schedule_id,
            sis.agreement_id,
            sis.installment_index,
            COALESCE(sis.revised_due_date, sis.due_date) AS effective_due_date,
            (sis.amount_due - sis.amount_paid - sis.waiver_amount) AS amount_due,
            cip.number_of_installments AS total_installments,
            c.title AS course_title,
            p.email AS recipient_email,
            p.name AS recipient_name,
            p.profile_id AS recipient_profile_id
        FROM public.student_installment_schedule sis
        JOIN public.student_course_agreements sca ON sca.agreement_id = sis.agreement_id
        JOIN public.course_installment_plans cip ON cip.plan_id = sca.plan_id
        JOIN public.courses c ON c.course_id = sca.course_id
        JOIN public.student_details sd ON sd.student_id = sca.student_id
        JOIN public.profiles p ON p.profile_id = sd.profile_id
        WHERE (sis.status = 'pending')
          AND ((sis.amount_due - sis.amount_paid - sis.waiver_amount) > 0.00)
          AND (COALESCE(sis.revised_due_date, sis.due_date) = v_today)
          AND (sca.agreement_status IN ('active', 'in_arrears'))
          AND (sca.outstanding_balance > 0.00)
          AND (COALESCE(sca.requires_admin_review, false) = false)
          AND (p.email IS NOT NULL AND position('@' in p.email) > 0)
    LOOP
        PERFORM public.enqueue_email_job(
            p_recipient_email      => v_rec.recipient_email,
            p_subject              => 'Reminder: Your installment payment is due today',
            p_template_id          => 'INS-04',
            p_payload              => jsonb_build_object(
                'courseName', v_rec.course_title,
                'installmentNumber', v_rec.installment_index,
                'totalInstallments', v_rec.total_installments,
                'amountDue', v_rec.amount_due,
                'dueDate', v_rec.effective_due_date::text,
                'effectiveDueDate', v_rec.effective_due_date::text,
                'scheduleId', v_rec.schedule_id,
                'agreementId', v_rec.agreement_id
            ),
            p_recipient_profile_id => v_rec.recipient_profile_id,
            p_recipient_name       => v_rec.recipient_name,
            p_event_type           => 'INS-04',
            p_priority             => 'high'::public.email_priority,
            p_idempotency_key      => 'inst_due_0d:' || v_rec.schedule_id::text || ':' || v_rec.effective_due_date::text
        );
        v_ins04_count := v_ins04_count + 1;
    END LOOP;

    -- =========================================================================
    -- SWEEP 3: INS-05 — Installment Overdue (T+1)
    -- =========================================================================
    FOR v_rec IN
        SELECT
            sis.schedule_id,
            sis.agreement_id,
            sis.installment_index,
            COALESCE(sis.revised_due_date, sis.due_date) AS effective_due_date,
            (sis.amount_due - sis.amount_paid - sis.waiver_amount) AS amount_due,
            c.title AS course_title,
            p.email AS recipient_email,
            p.name AS recipient_name,
            p.profile_id AS recipient_profile_id
        FROM public.student_installment_schedule sis
        JOIN public.student_course_agreements sca ON sca.agreement_id = sis.agreement_id
        JOIN public.courses c ON c.course_id = sca.course_id
        JOIN public.student_details sd ON sd.student_id = sca.student_id
        JOIN public.profiles p ON p.profile_id = sd.profile_id
        WHERE (sis.status IN ('pending', 'overdue'))
          AND ((sis.amount_due - sis.amount_paid - sis.waiver_amount) > 0.00)
          AND (COALESCE(sis.revised_due_date, sis.due_date) <= (v_today - 1))
          AND (COALESCE(sis.revised_due_date, sis.due_date) > (v_today - 7))
          AND (sca.agreement_status IN ('active', 'in_arrears'))
          AND (sca.outstanding_balance > 0.00)
          AND (COALESCE(sca.requires_admin_review, false) = false)
          AND (p.email IS NOT NULL AND position('@' in p.email) > 0)
    LOOP
        PERFORM public.enqueue_email_job(
            p_recipient_email      => v_rec.recipient_email,
            p_subject              => 'Payment Reminder: Your installment is overdue',
            p_template_id          => 'INS-05',
            p_payload              => jsonb_build_object(
                'courseName', v_rec.course_title,
                'installmentNumber', v_rec.installment_index,
                'amountDue', v_rec.amount_due,
                'originalDueDate', v_rec.effective_due_date::text,
                'effectiveDueDate', v_rec.effective_due_date::text,
                'scheduleId', v_rec.schedule_id,
                'agreementId', v_rec.agreement_id
            ),
            p_recipient_profile_id => v_rec.recipient_profile_id,
            p_recipient_name       => v_rec.recipient_name,
            p_event_type           => 'INS-05',
            p_priority             => 'high'::public.email_priority,
            p_idempotency_key      => 'inst_od_1d:' || v_rec.schedule_id::text || ':' || v_rec.effective_due_date::text
        );
        v_ins05_count := v_ins05_count + 1;
    END LOOP;

    -- =========================================================================
    -- SWEEP 4: INS-06 — Arrears Escalation & Academic Access Warning (T+7)
    -- Per-tranche episode idempotency: every qualifying overdue tranche reaching
    -- T+7 generates its own notification, deduplicated by scheduleId + effectiveDueDate
    -- =========================================================================
    FOR v_rec IN
        SELECT
            sca.agreement_id,
            sca.student_id,
            sca.course_id,
            sca.overdue_balance,
            sis.schedule_id,
            sis.installment_index,
            COALESCE(sis.revised_due_date, sis.due_date) AS effective_due_date,
            (sis.amount_due - sis.amount_paid - sis.waiver_amount) AS tranche_unpaid_amount,
            p.email AS recipient_email,
            p.name AS recipient_name,
            p.profile_id AS recipient_profile_id,
            c.title AS course_title
        FROM public.student_installment_schedule sis
        JOIN public.student_course_agreements sca ON (sca.agreement_id = sis.agreement_id)
        JOIN public.student_details sd ON (sd.student_id = sca.student_id)
        JOIN public.profiles p ON (p.profile_id = sd.profile_id)
        JOIN public.courses c ON (c.course_id = sca.course_id)
        WHERE (
          (sca.agreement_status IN ('active', 'in_arrears'))
          AND (sca.outstanding_balance > 0.00)
          AND (
            (sca.overdue_balance > 0.00)
            OR (sca.agreement_status = 'in_arrears')
          )
          AND (COALESCE(sca.requires_admin_review, false) = false)
          AND (p.email IS NOT NULL AND position('@' in p.email) > 0)
        )
        AND (
          (sis.status IN ('pending', 'overdue'))
          AND ((sis.amount_due - sis.amount_paid - sis.waiver_amount) > 0.00)
          AND (COALESCE(sis.revised_due_date, sis.due_date) <= (v_today - 7))
        )
        ORDER BY 
          sca.agreement_id, 
          COALESCE(sis.revised_due_date, sis.due_date) ASC, 
          sis.installment_index ASC
    LOOP
        PERFORM public.enqueue_email_job(
            p_recipient_email      => v_rec.recipient_email,
            p_subject              => 'Important: Outstanding Installment and Academic Access Warning',
            p_template_id          => 'INS-06',
            p_payload              => jsonb_build_object(
                'courseName', v_rec.course_title,
                'installmentNumber', v_rec.installment_index,
                'overdueBalance', v_rec.overdue_balance,
                'earliestDueDate', v_rec.effective_due_date::text,
                'daysOverdue', (v_today - v_rec.effective_due_date)::integer,
                'scheduleId', v_rec.schedule_id,
                'agreementId', v_rec.agreement_id,
                'effectiveDueDate', v_rec.effective_due_date::text
            ),
            p_recipient_profile_id => v_rec.recipient_profile_id,
            p_recipient_name       => v_rec.recipient_name,
            p_event_type           => 'INS-06',
            p_priority             => 'critical'::public.email_priority,
            p_idempotency_key      => 'inst_arr_7d:' || v_rec.agreement_id::text || ':' || v_rec.schedule_id::text || ':' || v_rec.effective_due_date::text
        );
        v_ins06_count := v_ins06_count + 1;
    END LOOP;

    v_total_enqueued := v_ins03_count + v_ins04_count + v_ins05_count + v_ins06_count;

    RETURN jsonb_build_object(
        'success', true,
        'sweep_date_ist', v_today,
        'executed_at', clock_timestamp(),
        'ins03_due_in_3d_count', v_ins03_count,
        'ins04_due_today_count', v_ins04_count,
        'ins05_overdue_1d_count', v_ins05_count,
        'ins06_arrears_7d_count', v_ins06_count,
        'total_enqueued', v_total_enqueued
    );
END;
$$;

COMMENT ON FUNCTION public.sweep_installment_reminders() IS
  'Phase 4: Daily 08:00 AM IST sweep procedure for upcoming and overdue installment reminder emails (INS-03, INS-04, INS-05, INS-06).';

REVOKE ALL ON FUNCTION public.sweep_installment_reminders() FROM public;
REVOKE ALL ON FUNCTION public.sweep_installment_reminders() FROM anon;
REVOKE ALL ON FUNCTION public.sweep_installment_reminders() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_installment_reminders() TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5: Idempotent pg_cron Registration (08:00 AM IST / 02:30 AM UTC)
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sweep-installment-reminders-daily') THEN
      PERFORM cron.unschedule('sweep-installment-reminders-daily');
    END IF;

    PERFORM cron.schedule(
      'sweep-installment-reminders-daily',
      '30 2 * * *',
      'SELECT public.sweep_installment_reminders();'
    );
  END IF;
END;
$$;
