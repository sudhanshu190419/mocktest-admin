-- ============================================================================
-- Migration 221: Installment Financial Integrity & Plan Immutability
-- ============================================================================
--
-- Background:
--   Follow-up to Migration 219 (applied) and Migration 220 (applied).
--   Resolves two database-level financial integrity requirements:
--
-- 1. Installment Schedule Exact Rounding Reconciliation (Part A):
--    Replaces public.process_installment_payment() so that the final installment
--    absorbs any fractional rounding remainder.
--    Mathematically guarantees: SUM(amount_due) = agreement.total_fee.
--      • Tranches 1 through N-1: ROUND(total_fee / number_of_installments, 2)
--      • Tranche N: total_fee - (standard_tranche * (number_of_installments - 1))
--    Eliminates fractional-cent deficits (e.g. ₹100/3 yielding ₹99.99 with an
--    unpayable ₹0.01 outstanding balance) and overcharges (e.g. ₹100/6 yielding ₹100.02).
--
-- 2. Database-Enforced Financial-Term Immutability (Part B):
--    Prevents modifying financial parameters (course_id, total_fee,
--    number_of_installments, interval_months) on public.course_installment_plans
--    once one or more rows in public.student_course_agreements reference that plan.
--    Allows updating non-financial fields (plan_name, is_active) at all times.
--    Safeguards contract terms and historical payment auditing.
--
-- 3. Concurrency Serialization Guard (Part B Concurrency):
--    Adds a BEFORE INSERT trigger on public.student_course_agreements that acquires
--    a FOR SHARE lock on the referenced course_installment_plans row.
--    Ensures that in-flight agreement creation and admin plan updates serialize
--    cleanly, eliminating any concurrent-transaction race condition between
--    plan modification and agreement checkout.
--
-- 4. Preserves Existing Business Logic & Authorization (Part C):
--    • Retains public.is_admin() coarse admin access on course_installment_plans_admin_manage.
--    • Retains course_installment_plans_select (is_active = true) for students.
--    • Retains zero-grace arrears access control and recording playback lockout.
--    • Retains immutable initial payment anchor D0 and FIFO payment allocation.
--    • Modifies zero historical data; applies to all future operations.
--
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Database-Enforced Financial-Term Immutability Trigger
-- ----------------------------------------------------------------------------

create or replace function public.trg_enforce_installment_plan_immutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has_agreements boolean;
begin
  -- Only evaluate when one or more of the 4 protected financial fields are modified
  if (old.course_id is distinct from new.course_id
      or old.total_fee is distinct from new.total_fee
      or old.number_of_installments is distinct from new.number_of_installments
      or old.interval_months is distinct from new.interval_months) then

    -- Check if any student agreements reference this plan
    select exists (
      select 1
      from public.student_course_agreements
      where plan_id = old.plan_id
    ) into v_has_agreements;

    if v_has_agreements then
      raise exception 'Cannot modify financial parameters (course_id, total_fee, number_of_installments, interval_months) for installment plan % because student agreements already reference it. To change terms, deactivate this plan (set is_active = false) and create a new plan.', old.plan_id
        using errcode = '23514'; -- check_violation
    end if;
  end if;

  return new;
end;
$$;

comment on function public.trg_enforce_installment_plan_immutability() is
  'Enforces database-level immutability of financial terms on course_installment_plans once student agreements exist.';

drop trigger if exists trg_enforce_installment_plan_immutability on public.course_installment_plans;
create trigger trg_enforce_installment_plan_immutability
  before update on public.course_installment_plans
  for each row execute function public.trg_enforce_installment_plan_immutability();


-- ----------------------------------------------------------------------------
-- 2. Concurrency Serialization & Authoritative Term Enforcement Guard
-- ----------------------------------------------------------------------------

create or replace function public.trg_student_course_agreements_lock_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan record;
begin
  -- 1. On UPDATE: enforce structural immutability and fast-path execution
  if tg_op = 'UPDATE' then
    -- Course ID is permanently immutable once an agreement row is created
    if old.course_id is distinct from new.course_id then
      raise exception 'Agreement course_id is immutable once created (existing: %, attempted: %).',
        old.course_id, new.course_id
        using errcode = '23514'; -- check_violation
    end if;

    -- Fast path: if neither plan_id nor total_fee is modified, bypass plan validation
    -- (allows payment processing, balance updates, status changes, and review clearance without plan lock contention)
    if (old.plan_id is not distinct from new.plan_id) and (old.total_fee is not distinct from new.total_fee) then
      return new;
    end if;

    -- If plan_id is being changed, disallow if the agreement is already active or funded
    if old.plan_id is distinct from new.plan_id then
      if old.agreement_status not in ('pending_initial_payment') or old.agreement_date is not null then
        raise exception 'Cannot change installment plan for agreement % because it is already active (status: %).',
          old.agreement_id, old.agreement_status
          using errcode = '23514'; -- check_violation
      end if;

      -- Reject plan reassignment if any schedule rows exist to preserve financial and audit history
      if exists (
        select 1 from public.student_installment_schedule
        where agreement_id = old.agreement_id
      ) then
        raise exception 'Cannot change installment plan for agreement % because installment schedule rows already exist.',
          old.agreement_id
          using errcode = '23514'; -- check_violation
      end if;
    end if;
  end if;

  -- 2. Mandatory plan_id check
  if new.plan_id is null then
    raise exception 'Installment plan_id is mandatory for student course agreements.'
      using errcode = '23502'; -- not_null_violation
  end if;

  -- 3. Acquire FOR SHARE lock on referenced plan row
  -- In PostgreSQL, FOR SHARE conflicts with FOR NO KEY UPDATE and FOR UPDATE.
  -- This serializes agreement creation against any concurrent plan UPDATE modifying financial fields,
  -- while allowing multiple concurrent agreement creations without mutual blocking.
  select plan_id, course_id, plan_name, total_fee, number_of_installments, interval_months, is_active
  into v_plan
  from public.course_installment_plans
  where plan_id = new.plan_id
  for share;

  if not found then
    raise exception 'Referenced installment plan % does not exist.', new.plan_id
      using errcode = '23503'; -- foreign_key_violation
  end if;

  -- 4. Reject agreement creation or reassignment against inactive plans
  if not v_plan.is_active then
    raise exception 'Cannot create agreement for inactive installment plan % (%).',
      v_plan.plan_id, coalesce(v_plan.plan_name, 'unnamed')
      using errcode = '23514'; -- check_violation
  end if;

  -- 5. Validate and enforce authoritative course_id from plan
  if new.course_id is not null and new.course_id <> v_plan.course_id then
    raise exception 'Agreement course_id (%) contradicts referenced installment plan course_id (%).',
      new.course_id, v_plan.course_id
      using errcode = '23514'; -- check_violation
  end if;
  new.course_id := v_plan.course_id;

  -- 6. Validate and enforce authoritative total_fee from plan
  if new.total_fee is not null and new.total_fee <> v_plan.total_fee then
    raise exception 'Agreement total_fee (%) contradicts referenced installment plan total_fee (%). Plan terms may have been modified; reload checkout.',
      new.total_fee, v_plan.total_fee
      using errcode = '23514'; -- check_violation
  end if;
  new.total_fee := v_plan.total_fee;

  -- 7. For newly inserted agreements in pending_initial_payment status (or plan reassignment), enforce initial balance
  if (tg_op = 'INSERT' and new.agreement_status = 'pending_initial_payment')
     or (tg_op = 'UPDATE' and old.plan_id is distinct from new.plan_id) then
    if new.outstanding_balance is not null and new.outstanding_balance <> v_plan.total_fee then
      raise exception 'Initial agreement outstanding_balance (%) must equal plan total_fee (%).',
        new.outstanding_balance, v_plan.total_fee
        using errcode = '23514'; -- check_violation
    end if;
    new.outstanding_balance := v_plan.total_fee;
  end if;

  return new;
end;
$$;

comment on function public.trg_student_course_agreements_lock_plan() is
  'Acquires a FOR SHARE lock on the referenced installment plan, rejects inactive plans, enforces authoritative course_id and total_fee terms, prevents plan reassignment when schedule rows exist, and prevents concurrent plan modification races.';

drop trigger if exists trg_student_course_agreements_lock_plan on public.student_course_agreements;
create trigger trg_student_course_agreements_lock_plan
  before insert or update on public.student_course_agreements
  for each row execute function public.trg_student_course_agreements_lock_plan();


-- ----------------------------------------------------------------------------
-- 3. Replace public.process_installment_payment with Exact Rounding Reconciliation
-- ----------------------------------------------------------------------------

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
  v_payment               record;
  v_agreement             record;
  v_plan                  record;
  v_student_id            uuid;
  v_course_id             uuid;
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

  -- 2. Lock & Validate Authoritative Payment Record from trusted commerce tables
  -- Includes paid_at as authoritative gateway verification timestamp and refund_amount
  select p.payment_id, p.order_id, p.amount, p.status, p.created_at, p.paid_at,
         coalesce(p.refund_amount, 0.00) as refund_amount,
         p.refund_gateway_id,
         o.student_id, o.institute_id
  into v_payment
  from public.payments p
  join public.orders o on o.order_id = p.order_id
  where p.payment_id = p_payment_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'error', 'Authoritative payment record not found.',
      'code', 'PAYMENT_NOT_FOUND'
    );
  end if;

  -- 2b. Validate Payment Status (captured or partially_refunded are payable; refunded has 0 available)
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

  v_student_id := v_payment.student_id;

  -- Resolve course_id from order items
  select oi.course_id into v_course_id
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

  -- 3. Resolve & Lock Agreement
  v_target_agreement_id := p_agreement_id;
  if v_target_agreement_id is null then
    select sca.agreement_id
    into v_target_agreement_id
    from public.student_course_agreements sca
    where sca.student_id = v_student_id
      and sca.course_id = v_course_id
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

  -- Cross-verify payment context: payment student & course MUST match agreement!
  if v_agreement.student_id <> v_student_id or v_agreement.course_id <> v_course_id then
    return jsonb_build_object(
      'success', false,
      'error', 'Payment context mismatch: payment student or course does not match agreement.',
      'code', 'PAYMENT_CONTEXT_MISMATCH'
    );
  end if;

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

  -- Agreement Review Check (Revision 34, Issue 4):
  -- Allocations are strictly blocked while an agreement is under administrative review
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
  -- Distinguishes:
  --   1. Original captured amount: v_payment.amount
  --   2. Gateway confirmed refund: v_payment.refund_amount
  --   3. Audit trail duplicate-charge refunds: v_refund_adjustments
  --   4. Confirmed gateway reversals: v_reversal_adjustments
  select coalesce(sum(amount), 0.00)
  into v_refund_adjustments
  from public.installment_adjustments
  where reference_payment_id = p_payment_id
    and adjustment_type in ('gateway_refund', 'duplicate_charge_refund')
    and status = 'processed';

  -- Net reversal reduction accounts for historical debit minus verified restored funds:
  select coalesce(sum(greatest(0.00, amount - restored_amount)), 0.00)
  into v_reversal_adjustments
  from public.installment_adjustments
  where reference_payment_id = p_payment_id
    and adjustment_type = 'gateway_reversal'
    and status in ('processed', 'lost', 'closed', 'under_review', 'won');

  -- Strict Refund Reconciliation Check:
  -- The database strictly verifies that the cumulative summary in payments.refund_amount and
  -- the itemized ledger in installment_adjustments represent the same underlying financial transactions.
  -- Ambiguous conditions include:
  --   a) Summary > Ledger (unitemized refund reported by gateway summary; overlap cannot be proved)
  --   b) Ledger > Summary (stale summary; adjustment ledger has events not reflected in commerce summary)
  --   c) Conflicting Event IDs (equal aggregate totals, but payments.refund_gateway_id does not match the ledger)
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

  -- Reconciled confirmed refund and reversal:
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

  -- Reversals After Payment Allocation Check:
  -- If v_already_allocated > v_net_payment_available, a reversal or refund arrived AFTER
  -- previous allocations were committed.
  -- The system must:
  --   1. Preserve the original captured payment record.
  --   2. Preserve the original payment-allocation audit trail.
  --   3. Prevent further inappropriate allocations (unallocated amount is 0).
  --   4. Flag the affected agreement for administrative review.
  --   5. Avoid automatic mass-reallocation or automatic entitlement revocation.
  --   6. Explicitly represent and report this deficit condition.
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
  if v_payment.institute_id is not null then
    select coalesce(timezone, 'Asia/Kolkata')
    into v_institute_timezone
    from public.institutes
    where institute_id = v_payment.institute_id;
  end if;
  v_current_local_date := (now() at time zone coalesce(v_institute_timezone, 'Asia/Kolkata'))::date;

  -- 4. Initial Payment Verification: Establish Calendar Anchor D0 from Verified Timestamp
  -- Strict Rule: Anchor D0 requires authoritative paid_at in Asia/Kolkata timezone.
  -- Never silently substitute created_at (order-creation time). If paid_at is missing,
  -- fail closed for agreement activation, flag requires_admin_review, and preserve payment evidence.
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
        requires_admin_review = false, -- cleared upon verified activation
        updated_at = now()
    where agreement_id = v_agreement.agreement_id;
    
    v_agreement.agreement_date := v_anchor_date;
    v_agreement.agreement_status := 'active';

    -- Generate schedule from this immutable anchor if schedule rows do not yet exist
    if not exists (
      select 1 from public.student_installment_schedule
      where agreement_id = v_agreement.agreement_id
    ) then
      -- Rounding reconciliation: standard tranches 1..(N-1), final tranche N absorbs remainder
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
  -- Enforces installment-level limit: allocated_amount + waiver_amount <= amount_due
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
        payment_id  = p_payment_id, -- Non-authoritative pointer to latest contributing payment
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
    and installment_index is null; -- only unassigned agreement-level credits

  v_new_outstanding := greatest(0.00, v_agreement.total_fee - v_total_paid - v_total_waivers - v_total_adjustments);

  -- Use unified calculation for overdue balance
  v_new_overdue := public.calculate_effective_overdue_balance(v_agreement.agreement_id, v_current_local_date);

  -- 8. Determine Highest Consecutively Funded Installment Milestone (k)
  -- Funded if amount_paid + waiver_amount >= amount_due or status in ('paid', 'waived')
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
    -- Intermediate milestone: Decision B restores entitlement through next scheduled milestone D_{k+1}^due
    v_new_end_date := public.calculate_anchor_date(
      v_agreement.agreement_date,
      (v_consecutive_k * v_plan.interval_months)::smallint
    );
  else
    -- All N installments consecutively funded: Terminal entitlement reached
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
        grace_end_date = null, -- Zero grace period for installment architecture
        status = case
                   when v_new_overdue > 0 then 'grace' -- flagged for arrears restriction
                   when v_new_end_date >= v_current_local_date then 'active'
                   else 'expired'
                 end,
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
      status
    ) values (
      v_student_id,
      v_agreement.course_id,
      v_payment.institute_id,
      v_agreement.agreement_date,
      v_new_end_date,
      (v_new_end_date + interval '30 days')::date,
      null,
      case
        when v_new_overdue > 0 then 'grace'
        when v_new_end_date >= v_current_local_date then 'active'
        else 'expired'
      end
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
  'Idempotent, transaction-safe FIFO installment allocation engine with verified anchor D0, exact remainder-absorbing schedule reconciliation, and arrears access-control synchronization.';

-- Explicit permission grants matching existing configuration
grant execute on function public.process_installment_payment(uuid, uuid) to service_role;
grant execute on function public.process_installment_payment(uuid, uuid) to authenticated;
