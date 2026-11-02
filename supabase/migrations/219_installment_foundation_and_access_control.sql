-- ============================================================================
-- Migration 219: Installment Database Foundation and Server-Side Access Control
--
-- Implements Phase 1 of Make Me Topper Fixed-Course-Fee Installment Architecture:
--   1. Schema:
--      - course_installment_plans (plan configuration)
--      - student_course_agreements (student commitments, terms version, and verified payment anchor)
--      - student_installment_schedule (milestone due dates, revised due dates, amounts, waivers)
--      - installment_payment_allocations (normalized M:N payment-to-installment allocation ledger with composite FK integrity)
--      - installment_adjustments (audit trail for waivers, adjustments, corrections)
--   2. Immutable calendar calculation helper: calculate_anchor_date.
--   3. Effective overdue calculation helper: calculate_effective_overdue_balance.
--   4. Transaction-safe, idempotent FIFO payment-allocation RPC: process_installment_payment.
--   5. Server-Side Quad-Check live-class authorization (Hardened Allowlist): authorize_live_class_access.
--   6. Unpaid-gap recording restriction: verify_recording_playback_access.
--   7. Strict ON DELETE RESTRICT on financial history to prevent audit erasure.
--   8. Enforces Decision A (Zero Grace Period at 00:00 IST) and Decision B (Restore
--      Entitlement Through Next Scheduled Milestone).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Course Installment Plans
-- ----------------------------------------------------------------------------
create table if not exists public.course_installment_plans (
    plan_id                 uuid primary key default gen_random_uuid(),
    course_id               uuid not null references public.courses(course_id) on delete restrict,
    plan_name               text not null,
    total_fee               numeric(10,2) not null check (total_fee > 0),
    number_of_installments  smallint not null check (number_of_installments >= 1),
    interval_months         smallint not null check (interval_months >= 1),
    is_active               boolean not null default true,
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now()
);

create index if not exists idx_course_installment_plans_course
    on public.course_installment_plans (course_id, is_active);

-- ----------------------------------------------------------------------------
-- 2. Student Course Agreements
-- ----------------------------------------------------------------------------
create table if not exists public.student_course_agreements (
    agreement_id            uuid primary key default gen_random_uuid(),
    student_id              uuid not null references public.student_details(student_id) on delete restrict,
    course_id               uuid not null references public.courses(course_id) on delete restrict,
    plan_id                 uuid not null references public.course_installment_plans(plan_id) on delete restrict,
    agreement_date          date null, -- Established strictly upon verified initial payment (immutable calendar anchor D0)
    total_fee               numeric(10,2) not null check (total_fee > 0),
    outstanding_balance     numeric(10,2) not null check (outstanding_balance >= 0),
    overdue_balance         numeric(10,2) not null default 0.00 check (overdue_balance >= 0),
    requires_admin_review   boolean not null default false,
    agreement_status        text not null check (agreement_status in (
                              'pending_initial_payment', 'active', 'in_arrears', 
                              'completed', 'cancelled_by_admin', 'defaulted', 'withdrawn'
                            )),
    terms_version           text not null default 'v1.0',
    accepted_at             timestamptz not null default now(),
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now(),
    constraint uq_student_course_agreement unique (student_id, course_id),
    constraint ck_agreement_active_date check (agreement_status = 'pending_initial_payment' or agreement_date is not null)
);

create index if not exists idx_student_course_agreements_student
    on public.student_course_agreements (student_id, agreement_status);
create index if not exists idx_student_course_agreements_course
    on public.student_course_agreements (course_id);

-- ----------------------------------------------------------------------------
-- 3. Student Installment Schedule
-- ----------------------------------------------------------------------------
create table if not exists public.student_installment_schedule (
    schedule_id             uuid primary key default gen_random_uuid(),
    agreement_id            uuid not null references public.student_course_agreements(agreement_id) on delete restrict,
    installment_index       smallint not null check (installment_index >= 1),
    due_date                date not null,
    revised_due_date        date null, -- Set upon authorized rescheduling
    amount_due              numeric(10,2) not null check (amount_due > 0),
    amount_paid             numeric(10,2) not null default 0.00 check (amount_paid >= 0),
    waiver_amount           numeric(10,2) not null default 0.00 check (waiver_amount >= 0), -- Approved partial/full waivers
    status                  text not null check (status in ('pending', 'paid', 'overdue', 'waived', 'payment_reversed')),
    paid_at                 timestamptz null,
    payment_id              uuid null references public.payments(payment_id) on delete restrict, -- Latest contributing payment (denormalized, non-authoritative)
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now(),
    constraint uq_agreement_installment unique (agreement_id, installment_index),
    constraint uq_schedule_agreement_schedule unique (agreement_id, schedule_id) -- Enables composite foreign key integrity
);

comment on column public.student_installment_schedule.payment_id is
  'Denormalized audit pointer to the latest contributing payment. Non-authoritative: public.installment_payment_allocations is the sole authoritative source of truth for all financial accounting and allocations.';

create index if not exists idx_installment_schedule_agreement
    on public.student_installment_schedule (agreement_id, installment_index);
create index if not exists idx_installment_schedule_due_date
    on public.student_installment_schedule (due_date, status);
create index if not exists idx_installment_schedule_revised_due
    on public.student_installment_schedule (revised_due_date) where revised_due_date is not null;
create index if not exists idx_installment_schedule_payment
    on public.student_installment_schedule (payment_id) where payment_id is not null;

-- ----------------------------------------------------------------------------
-- 4. Normalized Installment Payment Allocations (M:N Audit Trail with Composite FK)
-- ----------------------------------------------------------------------------
create table if not exists public.installment_payment_allocations (
    allocation_id           uuid primary key default gen_random_uuid(),
    payment_id              uuid not null references public.payments(payment_id) on delete restrict,
    schedule_id             uuid not null references public.student_installment_schedule(schedule_id) on delete restrict,
    agreement_id            uuid not null references public.student_course_agreements(agreement_id) on delete restrict,
    allocated_amount        numeric(10,2) not null check (allocated_amount > 0),
    allocated_at            timestamptz not null default now(),
    created_at              timestamptz not null default now(),
    constraint uq_payment_schedule_allocation unique (payment_id, schedule_id),
    -- Composite foreign key guarantees that allocation cannot reference a schedule belonging to a different agreement:
    constraint fk_allocations_agreement_schedule foreign key (agreement_id, schedule_id)
      references public.student_installment_schedule (agreement_id, schedule_id) on delete restrict
);

create index if not exists idx_allocations_payment
    on public.installment_payment_allocations (payment_id);
create index if not exists idx_allocations_schedule
    on public.installment_payment_allocations (schedule_id);
create index if not exists idx_allocations_agreement
    on public.installment_payment_allocations (agreement_id);

-- ----------------------------------------------------------------------------
-- 5. Installment Adjustments (Audit Trail for Waivers, Reschedules & Gateway Corrections)
-- ----------------------------------------------------------------------------
create table if not exists public.installment_adjustments (
    adjustment_id           uuid primary key default gen_random_uuid(),
    agreement_id            uuid not null references public.student_course_agreements(agreement_id) on delete restrict,
    installment_index       smallint null,
    adjustment_type         text not null check (adjustment_type in (
                              'waiver', 'scholarship', 'reschedule', 'admin_credit', 
                              'duplicate_charge_refund', 'gateway_refund', 'gateway_reversal'
                            )),
    amount                  numeric(10,2) not null default 0.00,
    restored_amount         numeric(10,2) not null default 0.00 check (restored_amount >= 0.00 and restored_amount <= amount),
    status                  text not null default 'processed' check (status in (
                              'created', 'processed', 'failed', 'under_review', 'won', 'lost', 'closed'
                            )),
    revised_due_date        date null,
    reference_payment_id    uuid null references public.payments(payment_id) on delete restrict,
    gateway_event_id        varchar(255) null,
    reason                  text not null,
    approved_by_admin_id    uuid null references public.profiles(profile_id) on delete restrict,
    created_at              timestamptz not null default now(),
    constraint uq_installment_adjustments_gateway_event unique (gateway_event_id),
    constraint ck_adjustment_audit_identity check (
      (adjustment_type in ('gateway_refund', 'duplicate_charge_refund', 'gateway_reversal') 
         and reference_payment_id is not null 
         and gateway_event_id is not null 
         and length(trim(gateway_event_id)) > 0)
      or (adjustment_type = 'admin_credit' and reference_payment_id is not null)
      or (approved_by_admin_id is not null)
    ),
    constraint ck_adjustment_gateway_linkage check (
      (adjustment_type not in ('gateway_refund', 'duplicate_charge_refund', 'gateway_reversal'))
      or (reference_payment_id is not null 
          and gateway_event_id is not null 
          and length(trim(gateway_event_id)) > 0)
    )
);

create index if not exists idx_installment_adjustments_agreement
    on public.installment_adjustments (agreement_id);
create index if not exists idx_installment_adjustments_ref_payment
    on public.installment_adjustments (reference_payment_id) where reference_payment_id is not null;
create index if not exists idx_installment_adjustments_gateway_event
    on public.installment_adjustments (reference_payment_id, gateway_event_id) where gateway_event_id is not null;

-- ----------------------------------------------------------------------------
-- 5b. Database-Level Enforcement of Allocation Limits (Trigger)
-- Guarantees payment-level limit, installment-level limit, and agreement ownership
-- ----------------------------------------------------------------------------
create or replace function public.trg_enforce_allocation_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_amount       numeric(10,2);
  v_payment_refund       numeric(10,2);
  v_payment_refund_id    text;
  v_payment_status       text;
  v_is_reconciled        boolean := true;
  v_refund_adjustments   numeric(10,2) := 0.00;
  v_reversal_adjustments numeric(10,2) := 0.00;
  v_confirmed_refund     numeric(10,2) := 0.00;
  v_confirmed_reversal   numeric(10,2) := 0.00;
  v_payment_net          numeric(10,2);
  v_total_payment_alloc  numeric(10,2);
  v_sched_due            numeric(10,2);
  v_sched_waiver         numeric(10,2);
  v_total_sched_alloc    numeric(10,2);
  v_payment_student_id   uuid;
  v_payment_course_id    uuid;
  v_agreement_student_id uuid;
  v_agreement_course_id  uuid;
  v_other_agreement_id   uuid;
  v_agreement_requires_review boolean;
begin
  -- 0. Agreement Admin Review Check (Revision 34, Issue 4):
  -- Allocations are strictly blocked while an agreement is under administrative review
  select sca.requires_admin_review
  into v_agreement_requires_review
  from public.student_course_agreements sca
  where sca.agreement_id = NEW.agreement_id;

  if coalesce(v_agreement_requires_review, false) then
    raise exception 'Installment allocation blocked: agreement % is flagged for administrative review (requires_admin_review = true). Must be cleared by an authorized administrator before new allocations.',
      NEW.agreement_id
      using errcode = 'check_violation';
  end if;

  -- 1. Validate Payment Level Limits
  select p.amount, coalesce(p.refund_amount, 0.00), p.refund_gateway_id, p.status::text, o.student_id, oi.course_id
  into v_payment_amount, v_payment_refund, v_payment_refund_id, v_payment_status, v_payment_student_id, v_payment_course_id
  from public.payments p
  join public.orders o on o.order_id = p.order_id
  left join public.order_items oi on oi.order_id = p.order_id
  where p.payment_id = NEW.payment_id
  limit 1;

  if v_payment_amount is null then
    raise exception 'Referenced payment % does not exist in commerce ledger.', NEW.payment_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_payment_status = 'refunded' then
    v_payment_net := 0.00;
  else
    -- Non-double-counting calculation:
    select coalesce(sum(amount), 0.00)
    into v_refund_adjustments
    from public.installment_adjustments
    where reference_payment_id = NEW.payment_id
      and adjustment_type in ('gateway_refund', 'duplicate_charge_refund')
      and status = 'processed';

    -- Net reversal reduction accounts for historical debit minus verified restored funds:
    select coalesce(sum(greatest(0.00, amount - restored_amount)), 0.00)
    into v_reversal_adjustments
    from public.installment_adjustments
    where reference_payment_id = NEW.payment_id
      and adjustment_type = 'gateway_reversal'
      and status in ('processed', 'lost', 'closed', 'under_review', 'won');

    -- Strict reconciliation check:
    v_is_reconciled := (coalesce(v_payment_refund, 0.00) = v_refund_adjustments);
    if v_is_reconciled and coalesce(v_payment_refund, 0.00) > 0.00 and v_payment_refund_id is not null then
      if not exists (
        select 1 from public.installment_adjustments
        where reference_payment_id = NEW.payment_id
          and adjustment_type in ('gateway_refund', 'duplicate_charge_refund')
          and status = 'processed'
          and gateway_event_id = v_payment_refund_id
      ) then
        v_is_reconciled := false;
      end if;
    end if;

    if not v_is_reconciled then
      raise exception 'Payment allocation blocked: payment % refund summary (%) and adjustment ledger (%) are unreconciled. Requires administrator review before allocation.',
        NEW.payment_id, coalesce(v_payment_refund, 0.00), v_refund_adjustments
        using errcode = 'check_violation';
    end if;

    v_confirmed_refund := v_refund_adjustments;
    v_confirmed_reversal := v_reversal_adjustments;
    v_payment_net := greatest(0.00, v_payment_amount - v_confirmed_refund - v_confirmed_reversal);
  end if;

  select coalesce(sum(allocated_amount), 0.00)
  into v_total_payment_alloc
  from public.installment_payment_allocations
  where payment_id = NEW.payment_id
    and allocation_id <> coalesce(NEW.allocation_id, '00000000-0000-0000-0000-000000000000'::uuid);

  if (v_total_payment_alloc + NEW.allocated_amount) > v_payment_net then
    raise exception 'Payment allocation limit exceeded: cannot allocate % from payment % (available: %, already allocated: %).',
      NEW.allocated_amount, NEW.payment_id, v_payment_net, v_total_payment_alloc
      using errcode = 'check_violation';
  end if;

  -- 2. Validate Installment Level Limits
  select sis.amount_due, sis.waiver_amount
  into v_sched_due, v_sched_waiver
  from public.student_installment_schedule sis
  where sis.schedule_id = NEW.schedule_id;

  if v_sched_due is null then
    raise exception 'Referenced installment schedule % does not exist.', NEW.schedule_id
      using errcode = 'foreign_key_violation';
  end if;

  select coalesce(sum(allocated_amount), 0.00)
  into v_total_sched_alloc
  from public.installment_payment_allocations
  where schedule_id = NEW.schedule_id
    and allocation_id <> coalesce(NEW.allocation_id, '00000000-0000-0000-0000-000000000000'::uuid);

  if (v_total_sched_alloc + NEW.allocated_amount + v_sched_waiver) > v_sched_due then
    raise exception 'Installment allocation limit exceeded: allocating % to schedule % would exceed obligation (due: %, allocated: %, waiver: %).',
      NEW.allocated_amount, NEW.schedule_id, v_sched_due, v_total_sched_alloc, v_sched_waiver
      using errcode = 'check_violation';
  end if;

  -- 3. Validate Agreement-Level Ownership & Cross-Agreement Prohibitions
  select sca.student_id, sca.course_id
  into v_agreement_student_id, v_agreement_course_id
  from public.student_course_agreements sca
  where sca.agreement_id = NEW.agreement_id;

  if v_agreement_student_id is not null and (v_agreement_student_id <> v_payment_student_id or v_agreement_course_id <> v_payment_course_id) then
    raise exception 'Payment agreement ownership mismatch: payment student/course does not match target agreement.'
      using errcode = 'check_violation';
  end if;

  select agreement_id
  into v_other_agreement_id
  from public.installment_payment_allocations
  where payment_id = NEW.payment_id
    and agreement_id <> NEW.agreement_id
  limit 1;

  if v_other_agreement_id is not null then
    raise exception 'Payment reuse prohibited: payment % is already allocated to agreement %.',
      NEW.payment_id, v_other_agreement_id
      using errcode = 'check_violation';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_enforce_installment_allocation_limits on public.installment_payment_allocations;
create trigger trg_enforce_installment_allocation_limits
before insert or update on public.installment_payment_allocations
for each row
execute function public.trg_enforce_allocation_limits();

-- ----------------------------------------------------------------------------
-- 5c. Database-Level Enforcement of Post-Allocation Deficit Review (Trigger)
-- Flags agreement for administrative review if a reversal or refund arrives
-- after allocations have already been committed from the referenced payment.
-- ----------------------------------------------------------------------------
create or replace function public.trg_installment_adjustment_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_amount       numeric(10,2);
  v_payment_refund       numeric(10,2);
  v_payment_refund_id    text;
  v_payment_status       text;
  v_refund_adjustments   numeric(10,2) := 0.00;
  v_reversal_adjustments numeric(10,2) := 0.00;
  v_confirmed_refund     numeric(10,2) := 0.00;
  v_confirmed_reversal   numeric(10,2) := 0.00;
  v_payment_net          numeric(10,2) := 0.00;
  v_already_allocated    numeric(10,2) := 0.00;
  v_is_reconciled        boolean := true;
begin
  if NEW.reference_payment_id is not null and NEW.adjustment_type in ('gateway_reversal', 'gateway_refund', 'duplicate_charge_refund') then
    select p.amount, coalesce(p.refund_amount, 0.00), p.refund_gateway_id, p.status::text
    into v_payment_amount, v_payment_refund, v_payment_refund_id, v_payment_status
    from public.payments p
    where p.payment_id = NEW.reference_payment_id;

    if v_payment_amount is not null then
      if v_payment_status = 'refunded' then
        v_payment_net := 0.00;
      else
        select coalesce(sum(amount), 0.00)
        into v_refund_adjustments
        from public.installment_adjustments
        where reference_payment_id = NEW.reference_payment_id
          and adjustment_type in ('gateway_refund', 'duplicate_charge_refund')
          and status = 'processed';

        -- Net reversal reduction accounts for historical debit minus verified restored funds:
        select coalesce(sum(greatest(0.00, amount - restored_amount)), 0.00)
        into v_reversal_adjustments
        from public.installment_adjustments
        where reference_payment_id = NEW.reference_payment_id
          and adjustment_type = 'gateway_reversal'
          and status in ('processed', 'lost', 'closed', 'under_review', 'won');

        v_confirmed_refund := greatest(coalesce(v_payment_refund, 0.00), v_refund_adjustments);
        v_confirmed_reversal := v_reversal_adjustments;
        v_payment_net := greatest(0.00, v_payment_amount - v_confirmed_refund - v_confirmed_reversal);

        v_is_reconciled := (coalesce(v_payment_refund, 0.00) = v_refund_adjustments);
        if v_is_reconciled and coalesce(v_payment_refund, 0.00) > 0.00 and v_payment_refund_id is not null then
          if not exists (
            select 1 from public.installment_adjustments
            where reference_payment_id = NEW.reference_payment_id
              and adjustment_type in ('gateway_refund', 'duplicate_charge_refund')
              and status = 'processed'
              and gateway_event_id = v_payment_refund_id
          ) then
            v_is_reconciled := false;
          end if;
        end if;
      end if;

      select coalesce(sum(allocated_amount), 0.00)
      into v_already_allocated
      from public.installment_payment_allocations
      where payment_id = NEW.reference_payment_id;

      -- If already allocated amount exceeds post-adjustment net available payment (deficit condition),
      -- OR if there is an unreconciled discrepancy between gateway refund summary and ledger (partial overlap / out-of-sync / conflicting ID),
      -- flag the agreement for administrative review.
      -- Original payment evidence and allocation history remain intact.
      -- Entitlement is NOT automatically revoked without explicit administrative authorization.
      if (v_already_allocated > v_payment_net) or (not v_is_reconciled) then
        update public.student_course_agreements
        set requires_admin_review = true,
            updated_at = now()
        where agreement_id = NEW.agreement_id;
      end if;
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_installment_adjustment_audit on public.installment_adjustments;
create trigger trg_installment_adjustment_audit
  after insert or update on public.installment_adjustments
  for each row
  execute function public.trg_installment_adjustment_audit();

-- ----------------------------------------------------------------------------
-- 5c. Database-Level Enforcement of Adjustment Immutability & Audit Integrity (Trigger)
-- Guarantees historical debit amount immutability, monotonic restoration, and structural linkage protection
-- ----------------------------------------------------------------------------
create or replace function public.trg_enforce_adjustment_immutability()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- 1. Protect structural linkages: agreement, reference payment, gateway event ID, and type cannot be altered
  if (NEW.agreement_id <> OLD.agreement_id) or
     (NEW.reference_payment_id is distinct from OLD.reference_payment_id) or
     (NEW.gateway_event_id is distinct from OLD.gateway_event_id) or
     (NEW.adjustment_type <> OLD.adjustment_type) then
    raise exception 'Installment adjustment structural linkages (agreement, payment, gateway_event, type) are immutable once recorded.'
      using errcode = 'check_violation';
  end if;

  -- 2. Protect historical debit amount:
  -- Once a non-zero debit amount is established (OLD.amount > 0.00), it cannot be modified or overwritten.
  -- Initial confirmation from 0.00 (e.g. open dispute with zero deduction transitioning to confirmed debit) is permitted.
  if (OLD.amount > 0.00) and (NEW.amount <> OLD.amount) then
    raise exception 'Installment adjustment historical debit amount is immutable once confirmed (original: %, attempted: %). Use restored_amount to record verified funds returned.',
      OLD.amount, NEW.amount
      using errcode = 'check_violation';
  end if;

  -- 3. Protect restoration monotonicity:
  -- Verified funds returned cannot be decreased without explicit administrative intervention.
  if (NEW.restored_amount < OLD.restored_amount) then
    raise exception 'Installment adjustment restored_amount cannot decrease (original: %, attempted: %).',
      OLD.restored_amount, NEW.restored_amount
      using errcode = 'check_violation';
  end if;

  -- 4. Invariant: restored_amount cannot exceed confirmed gross amount
  if (NEW.restored_amount > NEW.amount) then
    raise exception 'Installment adjustment restored_amount (%) cannot exceed gross amount (%).',
      NEW.restored_amount, NEW.amount
      using errcode = 'check_violation';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_enforce_adjustment_immutability on public.installment_adjustments;
create trigger trg_enforce_adjustment_immutability
  before update on public.installment_adjustments
  for each row
  execute function public.trg_enforce_adjustment_immutability();

-- ----------------------------------------------------------------------------
-- 5d. Dispute Restoration Event Ledger (Revision 33: Event-Level Audit Integrity)
-- Tracks distinct, verified gateway restoration events for chargebacks/disputes
-- ----------------------------------------------------------------------------
create table if not exists public.installment_dispute_restorations (
    restoration_id        uuid primary key default gen_random_uuid(),
    adjustment_id         uuid not null references public.installment_adjustments(adjustment_id) on delete restrict,
    dispute_id            varchar(255) not null,
    gateway_event_id      varchar(255) not null,
    provider_reference_id varchar(255) not null,
    amount                numeric(10,2) not null check (amount > 0.00),
    restored_at           timestamptz not null default now(),
    reason                text null,
    created_at            timestamptz not null default now(),
    constraint uq_dispute_restorations_event unique (gateway_event_id),
    constraint uq_dispute_restorations_provider_ref unique (provider_reference_id)
);

create index if not exists idx_dispute_restorations_adjustment
    on public.installment_dispute_restorations (adjustment_id);
create index if not exists idx_dispute_restorations_dispute
    on public.installment_dispute_restorations (dispute_id);
create index if not exists idx_dispute_restorations_provider_ref
    on public.installment_dispute_restorations (provider_reference_id);

create or replace function public.trg_sync_dispute_restoration()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total_restored numeric(10,2);
  v_gross_debit    numeric(10,2);
begin
  select amount into v_gross_debit
  from public.installment_adjustments
  where adjustment_id = NEW.adjustment_id;

  select coalesce(sum(amount), 0.00)
  into v_total_restored
  from public.installment_dispute_restorations
  where adjustment_id = NEW.adjustment_id;

  if v_total_restored > v_gross_debit then
    raise exception 'Dispute restoration total (%) exceeds original gross debit (%) for adjustment %.',
      v_total_restored, v_gross_debit, NEW.adjustment_id
      using errcode = 'check_violation';
  end if;

  update public.installment_adjustments
  set restored_amount = v_total_restored
  where adjustment_id = NEW.adjustment_id;

  return NEW;
end;
$$;

drop trigger if exists trg_sync_dispute_restoration on public.installment_dispute_restorations;
create trigger trg_sync_dispute_restoration
  after insert on public.installment_dispute_restorations
  for each row
  execute function public.trg_sync_dispute_restoration();

-- ----------------------------------------------------------------------------
-- 5e. Webhook Quarantine Ledger (Revision 34: Durable Malformed Event Quarantine)
-- Persists authenticated malformed webhook events for audit, investigation and reconciliation.
-- Preserves retry idempotency on gateway_event_id and supports unlinked events.
-- ----------------------------------------------------------------------------
create table if not exists public.webhook_quarantine_events (
    quarantine_id        uuid primary key default gen_random_uuid(),
    gateway_event_id     varchar(255) not null,
    event_type           varchar(100) not null,
    entity_id            varchar(255) null,
    gateway_payment_id   varchar(255) null,
    payment_id           uuid null references public.payments(payment_id) on delete set null,
    agreement_id         uuid null references public.student_course_agreements(agreement_id) on delete set null,
    failure_code         varchar(100) not null,
    failure_reason       text not null,
    payload              jsonb not null,
    created_at           timestamptz not null default now(),
    constraint uq_webhook_quarantine_event unique (gateway_event_id)
);

create index if not exists idx_webhook_quarantine_payment
    on public.webhook_quarantine_events (payment_id);
create index if not exists idx_webhook_quarantine_agreement
    on public.webhook_quarantine_events (agreement_id);
create index if not exists idx_webhook_quarantine_gateway_payment
    on public.webhook_quarantine_events (gateway_payment_id);

-- ----------------------------------------------------------------------------
-- 5f. Authorized Agreement Review Clearance RPC (Revision 34, Issue 4)
-- Allows an authorized administrator to clear the requires_admin_review flag
-- after verifying that dispute/quarantine/financial anomalies are resolved.
-- Financial reconciliation alone does not clear the flag.
-- ----------------------------------------------------------------------------
create or replace function public.resolve_agreement_admin_review(
    p_agreement_id      uuid,
    p_resolution_notes  text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_is_authorized boolean := false;
    v_agreement record;
begin
    -- 1. Authorization check: must be service_role or admin
    if auth.role() = 'service_role' then
        v_is_authorized := true;
    elsif coalesce(public.is_admin(), false) then
        v_is_authorized := true;
    end if;

    if not v_is_authorized then
        raise exception 'Unauthorized: Only administrators may clear requires_admin_review for agreement %.',
            p_agreement_id
            using errcode = 'insufficient_privilege';
    end if;

    -- 2. Validation of mandatory parameters
    if p_agreement_id is null then
        raise exception 'Agreement ID cannot be null.'
            using errcode = 'invalid_parameter_value';
    end if;

    if p_resolution_notes is null or trim(p_resolution_notes) = '' then
        raise exception 'Resolution notes are mandatory when clearing admin review flag.'
            using errcode = 'invalid_parameter_value';
    end if;

    -- 3. Verify agreement exists and lock row
    select agreement_id, student_id, requires_admin_review
    into v_agreement
    from public.student_course_agreements
    where agreement_id = p_agreement_id
    for update;

    if not found then
        raise exception 'Agreement % not found.', p_agreement_id
            using errcode = 'no_data_found';
    end if;

    -- 4. Clear the review flag
    update public.student_course_agreements
    set requires_admin_review = false,
        updated_at = now()
    where agreement_id = p_agreement_id;

    -- 5. Safe audit recording if audit infrastructure is available
    begin
        if auth.uid() is not null then
            perform public.write_audit_log(
                p_action => 'installment_agreement_update'::public.audit_action_type,
                p_resource_type => 'student_course_agreements',
                p_resource_id => p_agreement_id,
                p_old_value => jsonb_build_object('requires_admin_review', v_agreement.requires_admin_review),
                p_new_value => jsonb_build_object('requires_admin_review', false, 'resolution_notes', trim(p_resolution_notes)),
                p_metadata => jsonb_build_object('resolved_by', auth.uid(), 'resolved_at', now())
            );
        end if;
    exception when others then
        null;
    end;

    return jsonb_build_object(
        'success', true,
        'agreement_id', p_agreement_id,
        'requires_admin_review', false,
        'notes', trim(p_resolution_notes)
    );
end;
$$;

comment on function public.resolve_agreement_admin_review(uuid, text) is
  'Revision 34: Authoritatively clears requires_admin_review after manual verification and audit logging. Restricted to admin role.';

revoke all on function public.resolve_agreement_admin_review(uuid, text) from public;
grant execute on function public.resolve_agreement_admin_review(uuid, text) to authenticated;
grant execute on function public.resolve_agreement_admin_review(uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- 6. Row-Level Security (RLS) Policies
-- ----------------------------------------------------------------------------
alter table public.course_installment_plans enable row level security;
alter table public.student_course_agreements enable row level security;
alter table public.student_installment_schedule enable row level security;
alter table public.installment_payment_allocations enable row level security;
alter table public.installment_adjustments enable row level security;
alter table public.installment_dispute_restorations enable row level security;
alter table public.webhook_quarantine_events enable row level security;

-- course_installment_plans
drop policy if exists "course_installment_plans_select" on public.course_installment_plans;
create policy "course_installment_plans_select"
    on public.course_installment_plans
    for select
    to authenticated
    using (true);

drop policy if exists "course_installment_plans_admin_manage" on public.course_installment_plans;
create policy "course_installment_plans_admin_manage"
    on public.course_installment_plans
    for all
    to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- student_course_agreements
drop policy if exists "student_course_agreements_select_own" on public.student_course_agreements;
create policy "student_course_agreements_select_own"
    on public.student_course_agreements
    for select
    to authenticated
    using (
        student_id = public.get_my_student_id()
        or public.is_admin()
    );

drop policy if exists "student_course_agreements_admin_manage" on public.student_course_agreements;
create policy "student_course_agreements_admin_manage"
    on public.student_course_agreements
    for all
    to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- student_installment_schedule
drop policy if exists "student_installment_schedule_select_own" on public.student_installment_schedule;
create policy "student_installment_schedule_select_own"
    on public.student_installment_schedule
    for select
    to authenticated
    using (
        exists (
            select 1 from public.student_course_agreements sca
            where sca.agreement_id = student_installment_schedule.agreement_id
              and (sca.student_id = public.get_my_student_id() or public.is_admin())
        )
    );

drop policy if exists "student_installment_schedule_admin_manage" on public.student_installment_schedule;
create policy "student_installment_schedule_admin_manage"
    on public.student_installment_schedule
    for all
    to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- installment_payment_allocations
drop policy if exists "installment_payment_allocations_select_own" on public.installment_payment_allocations;
create policy "installment_payment_allocations_select_own"
    on public.installment_payment_allocations
    for select
    to authenticated
    using (
        exists (
            select 1 from public.student_course_agreements sca
            where sca.agreement_id = installment_payment_allocations.agreement_id
              and (sca.student_id = public.get_my_student_id() or public.is_admin())
        )
    );

drop policy if exists "installment_payment_allocations_admin_manage" on public.installment_payment_allocations;
create policy "installment_payment_allocations_admin_manage"
    on public.installment_payment_allocations
    for all
    to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- installment_adjustments
drop policy if exists "installment_adjustments_select_own" on public.installment_adjustments;
create policy "installment_adjustments_select_own"
    on public.installment_adjustments
    for select
    to authenticated
    using (
        exists (
            select 1 from public.student_course_agreements sca
            where sca.agreement_id = installment_adjustments.agreement_id
              and (sca.student_id = public.get_my_student_id() or public.is_admin())
        )
    );

drop policy if exists "installment_adjustments_admin_manage" on public.installment_adjustments;
create policy "installment_adjustments_admin_manage"
    on public.installment_adjustments
    for all
    to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- installment_dispute_restorations
drop policy if exists "installment_dispute_restorations_select" on public.installment_dispute_restorations;
create policy "installment_dispute_restorations_select"
    on public.installment_dispute_restorations
    for select
    to authenticated
    using (
        exists (
            select 1 from public.installment_adjustments ia
            join public.student_course_agreements sca on sca.agreement_id = ia.agreement_id
            where ia.adjustment_id = installment_dispute_restorations.adjustment_id
              and (sca.student_id = public.get_my_student_id() or public.is_admin())
        )
    );

drop policy if exists "installment_dispute_restorations_admin_manage" on public.installment_dispute_restorations;
create policy "installment_dispute_restorations_admin_manage"
    on public.installment_dispute_restorations
    for all
    to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- webhook_quarantine_events
drop policy if exists "webhook_quarantine_events_admin_select" on public.webhook_quarantine_events;
create policy "webhook_quarantine_events_admin_select"
    on public.webhook_quarantine_events
    for select
    to authenticated
    using (public.is_admin());

drop policy if exists "webhook_quarantine_events_admin_manage" on public.webhook_quarantine_events;
create policy "webhook_quarantine_events_admin_manage"
    on public.webhook_quarantine_events
    for all
    to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- 7. Immutable Calendar Date Calculation Helper
-- ----------------------------------------------------------------------------
create or replace function public.calculate_anchor_date(
    p_anchor_date date,
    p_month_offset smallint
)
returns date
language sql
immutable
set search_path = ''
as $$
  select (p_anchor_date + (p_month_offset * interval '1 month'))::date;
$$;

comment on function public.calculate_anchor_date(date, smallint) is
  'Calculates an installment due date or entitlement paid-through date from an immutable initial anchor date without compounding calendar drift.';

-- ----------------------------------------------------------------------------
-- 8. Effective Overdue Calculation Helper (Consistent Across Ledger & Auth)
-- ----------------------------------------------------------------------------
create or replace function public.calculate_effective_overdue_balance(
    p_agreement_id uuid,
    p_as_of_date   date default null
)
returns numeric(10,2)
language sql
stable
security definer
set search_path = ''
as $$
  -- Sums the effective remaining unpaid balance of installments whose effective due date has passed.
  -- Accounts for verified payments, approved partial/full waivers, and authorized rescheduling.
  select coalesce(sum(
    greatest(0.00, sis.amount_due - sis.amount_paid - sis.waiver_amount)
  ), 0.00)
  from public.student_installment_schedule sis
  where sis.agreement_id = p_agreement_id
    and sis.status <> 'waived'
    and coalesce(sis.revised_due_date, sis.due_date) < coalesce(p_as_of_date, current_date)
    and (sis.amount_paid + sis.waiver_amount) < sis.amount_due;
$$;

comment on function public.calculate_effective_overdue_balance(uuid, date) is
  'Calculates the authoritative effective overdue balance for an agreement as of a given date, accounting for payments, waivers, and rescheduled due dates.';

-- ----------------------------------------------------------------------------
-- 9. Transaction-Safe, Idempotent FIFO Payment-Allocation RPC
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
          round(v_agreement.total_fee / v_plan.number_of_installments, 2),
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
  'Transaction-safe, idempotent FIFO installment payment allocation RPC. Records M:N allocations in installment_payment_allocations, verifies trusted commerce records, establishes initial anchor D0 from verified paid_at, recalculates effective balances with waivers and rescheduling, and enforces Decision A and Decision B.';

-- ----------------------------------------------------------------------------
-- 10. Server-Side Live-Class Authorization (Hardened Quad-Check Allowlist)
-- ----------------------------------------------------------------------------
-- Explicitly drop legacy/unintended 2-argument overload if present in target environment
-- to guarantee no legacy bypass path remains.
drop function if exists public.authorize_live_class_access(uuid, uuid);

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
  v_active_batch_found  boolean := false;
  v_batch_record        record;
  v_is_perm_owner       boolean := false;
  v_has_active_sub      boolean := false;
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
    -- STUDENT ROLE: THE SERVER-SIDE QUAD-CHECK (HARDENED ALLOWLIST)
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

    -- QUAD-CHECK CONDITION 2: Batch End Date (Applies to ALL students, including permanent owners)
    -- An ended batch NEVER authorizes live classes.
    if v_batch_record.end_date is not null and v_batch_record.end_date < v_current_local_date then
      return jsonb_build_object(
        'authorized', false,
        'error', 'This cohort batch has concluded. Live classes are no longer joinable for ended batches.',
        'code', 'BATCH_ENDED'
      );
    end if;

    -- QUAD-CHECK CONDITION 3: Valid Entitlement (Permanent Ownership OR Active Subscription)
    select exists (
      select 1
      from public.course_batches cb
      where cb.batch_id = v_batch_record.batch_id
        and public.is_permanent_course_owner(cb.course_id)
    ) into v_is_perm_owner;

    select exists (
      select 1
      from public.course_batches cb
      join public.student_subscriptions ss
        on ss.course_id = cb.course_id and ss.student_id = v_student_id
      where cb.batch_id = v_batch_record.batch_id
        and ss.status = 'active'
        and ss.end_date >= v_current_local_date
    ) into v_has_active_sub;

    if not v_is_perm_owner and not v_has_active_sub then
      return jsonb_build_object(
        'authorized', false,
        'error', 'Valid active subscription or course ownership required to join live classes.',
        'code', 'SUBSCRIPTION_REQUIRED'
      );
    end if;

    -- QUAD-CHECK CONDITION 4: Installment Agreement Integrity (Strict Allowlist)
    select sca.*
    into v_agreement_record
    from public.course_batches cb
    join public.student_course_agreements sca
      on sca.course_id = cb.course_id and sca.student_id = v_student_id
    where cb.batch_id = v_batch_record.batch_id
    order by sca.created_at desc
    limit 1;

    if found then
      -- 4a. Explicit Allowlist: ONLY 'active' and 'completed' are eligible states
      if v_agreement_record.agreement_status not in ('active', 'completed') then
        if v_agreement_record.agreement_status = 'pending_initial_payment' then
          return jsonb_build_object(
            'authorized', false,
            'error', 'Initial installment payment has not been verified. Access is suspended.',
            'code', 'INITIAL_PAYMENT_PENDING'
          );
        elsif v_agreement_record.agreement_status = 'in_arrears' then
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

      -- 4b. Decision A: Effective Overdue Balance Check (accounts for payments, waivers, and reschedules)
      v_effective_overdue := public.calculate_effective_overdue_balance(v_agreement_record.agreement_id, v_current_local_date);

      if v_effective_overdue > 0.00 or coalesce(v_agreement_record.overdue_balance, 0.00) > 0.00 then
        return jsonb_build_object(
          'authorized', false,
          'error', 'Live-class access is suspended due to an overdue installment. Please clear your overdue payment to restore access.',
          'code', 'INSTALLMENT_ARREARS_BLOCKED'
        );
      end if;

      -- 4c. Dynamic Schedule Check: Ensure no unpaid effective obligation has effective due date < current_local_date
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
    end if;
    -- Note: If v_agreement_record is not found, legacy periodic subscribers and permanent owners pass Check 4 cleanly.

    v_can_publish := false;
    v_role := 'student';
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
  'SECURITY DEFINER RPC implementing Server-Side Quad-Check: validates active batch assignment, enforces batch end-date cutoff for all students, verifies active subscription or permanent ownership, and enforces an explicit allowlist and effective zero-grace arrears clearance accounting for waivers and rescheduling.';

-- Security Hardening: Direct authenticated invocation is revoked to prevent IDOR parameter probing;
-- authorized access is gated exclusively through the livekit-token Edge Function via service_role.
revoke all on function public.authorize_live_class_access(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.authorize_live_class_access(uuid, uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- 11. Preserve Recording and Content Access (with Unpaid-Gap Locks)
-- ----------------------------------------------------------------------------
-- Explicitly drop legacy/unintended 2-argument overload if present in target environment
-- to guarantee no legacy bypass path remains.
drop function if exists public.verify_recording_playback_access(uuid, uuid);

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
  v_user_id             uuid;
  v_role                text;
  v_caller_institute_id uuid;
  v_rec                 record;
  v_teacher_id          uuid;
  v_owns_recording      boolean := false;
  v_student_id          uuid;
  v_has_linked_courses  boolean := false;
  v_has_content_access  boolean := false;
  v_class_date          date;
  v_institute_timezone  text := 'Asia/Kolkata';
  v_unpaid_gap_blocked  boolean := false;
begin
  -- 1. Validate caller identity
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object(
      'allowed', false,
      'status_code', 401,
      'error_code', 'UNAUTHORIZED',
      'error_message', 'Authentication required. Provide a valid Bearer token.'
    );
  end if;

  -- 2. Fetch profile & role
  select p.role, p.institute_id
  into v_role, v_caller_institute_id
  from public.profiles p
  where p.profile_id = v_user_id;

  if not found or v_role is null then
    return jsonb_build_object(
      'allowed', false,
      'status_code', 403,
      'error_code', 'UNAUTHORIZED_ROLE',
      'error_message', 'Unauthorized role. Access denied.'
    );
  end if;

  if v_role not in ('admin', 'super_admin', 'teacher', 'faculty', 'student') then
    return jsonb_build_object(
      'allowed', false,
      'status_code', 403,
      'error_code', 'UNAUTHORIZED_ROLE',
      'error_message', 'Unauthorized role. Access denied.'
    );
  end if;

  -- 3. Resolve target recording
  select
    r.recording_id,
    r.institute_id,
    r.class_id,
    r.status,
    r.storage_bucket,
    r.storage_path,
    r.is_deleted,
    r.teacher_id,
    r.recorded_at
  into v_rec
  from public.recordings r
  where r.recording_id = p_recording_id;

  if not found then
    return jsonb_build_object(
      'allowed', false,
      'status_code', 404,
      'error_code', 'RECORDING_NOT_FOUND',
      'error_message', 'Recording not found.'
    );
  end if;

  -- 4. Cross-institute isolation check
  if v_rec.institute_id is not null and v_caller_institute_id is not null and v_rec.institute_id <> v_caller_institute_id then
    return jsonb_build_object(
      'allowed', false,
      'status_code', 403,
      'error_code', 'CROSS_INSTITUTE_DENIED',
      'error_message', 'Access denied. Cross-institute recording access is prohibited.'
    );
  end if;

  -- 5. Lifecycle status check: must be completed
  if v_rec.status <> 'completed' then
    return jsonb_build_object(
      'allowed', false,
      'status_code', 403,
      'error_code', 'RECORDING_NOT_READY',
      'error_message', 'Recording is not ready for playback. Current status: ' || coalesce(v_rec.status::text, 'unknown')
    );
  end if;

  -- 6. Soft-delete check
  if coalesce(v_rec.is_deleted, false) = true then
    return jsonb_build_object(
      'allowed', false,
      'status_code', 410,
      'error_code', 'RECORDING_DELETED',
      'error_message', 'Recording has been deleted.'
    );
  end if;

  -- 7. Storage path check
  if v_rec.storage_path is null or trim(v_rec.storage_path) = '' then
    return jsonb_build_object(
      'allowed', false,
      'status_code', 500,
      'error_code', 'MISSING_STORAGE_PATH',
      'error_message', 'Recording has no storage path.'
    );
  end if;

  -- 8. Role-based authorization
  -- Admin bypass
  if v_role in ('admin', 'super_admin') then
    return jsonb_build_object(
      'allowed', true,
      'status_code', 200,
      'role', 'admin',
      'storage_bucket', v_rec.storage_bucket,
      'storage_path', v_rec.storage_path
    );

  -- Teacher ownership
  elsif v_role in ('teacher', 'faculty') then
    select td.teacher_id
    into v_teacher_id
    from public.teacher_details td
    where td.profile_id = v_user_id;

    if v_teacher_id is null then
      return jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'error_code', 'TEACHER_NOT_FOUND',
        'error_message', 'Teacher profile not found.'
      );
    end if;

    if v_rec.teacher_id is not null and v_rec.teacher_id = v_teacher_id then
      v_owns_recording := true;
    elsif v_rec.class_id is not null then
      select exists (
        select 1
        from public.live_classes lc
        where lc.class_id = v_rec.class_id
          and lc.teacher_id = v_teacher_id
      ) into v_owns_recording;
    end if;

    if not v_owns_recording then
      return jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'error_code', 'NOT_OWNER',
        'error_message', 'You do not own this recording.'
      );
    end if;

    return jsonb_build_object(
      'allowed', true,
      'status_code', 200,
      'role', 'teacher',
      'storage_bucket', v_rec.storage_bucket,
      'storage_path', v_rec.storage_path
    );

  -- Student check
  elsif v_role = 'student' then
    select sd.student_id
    into v_student_id
    from public.student_details sd
    where sd.profile_id = v_user_id;

    if v_student_id is null then
      return jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'error_code', 'STUDENT_NOT_FOUND',
        'error_message', 'Student profile not found.'
      );
    end if;

    -- Verify recording assigned to active batch subjects
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
        'error_code', 'NOT_ASSIGNED_TO_RECORDING',
        'error_message', 'You are not assigned to this recording.'
      );
    end if;

    -- Check course content entitlement via can_student_access_content()
    select exists (
      select 1
      from (
        select distinct cb.course_id
        from public.batch_subject_recordings bsr
        join public.batch_subjects bs on bs.batch_subject_id = bsr.batch_subject_id
        join public.course_batches cb on cb.batch_id = bs.batch_id
        where bsr.recording_id = p_recording_id
          and bs.is_active = true
      ) courses
      where public.can_student_access_content(courses.course_id) = true
    ) into v_has_content_access;

    if not v_has_content_access then
      return jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'error_code', 'CONTENT_ACCESS_EXPIRED',
        'error_message', 'Your content access period has ended. Renew your subscription to continue.'
      );
    end if;

    -- Unpaid-Gap Recording Check:
    -- If student is governed by an installment agreement for any course linked to this recording,
    -- determine whether the recording was conducted during an unpaid gap period.
    if v_rec.institute_id is not null then
      select coalesce(timezone, 'Asia/Kolkata')
      into v_institute_timezone
      from public.institutes
      where institute_id = v_rec.institute_id;
    end if;

    select coalesce(
      (select (lc.scheduled_at at time zone coalesce(v_institute_timezone, 'Asia/Kolkata'))::date from public.live_classes lc where lc.class_id = v_rec.class_id),
      (v_rec.recorded_at at time zone coalesce(v_institute_timezone, 'Asia/Kolkata'))::date
    ) into v_class_date;

    if v_class_date is not null then
      select exists (
        select 1
        from public.batch_subject_recordings bsr
        join public.batch_subjects bs on bs.batch_subject_id = bsr.batch_subject_id
        join public.course_batches cb on cb.batch_id = bs.batch_id
        join public.student_course_agreements sca
          on sca.course_id = cb.course_id and sca.student_id = v_student_id
        join public.student_subscriptions ss
          on ss.course_id = sca.course_id and ss.student_id = v_student_id
        where bsr.recording_id = p_recording_id
          and bs.is_active = true
          and sca.overdue_balance > 0.00
          and v_class_date > ss.end_date
      ) into v_unpaid_gap_blocked;

      if v_unpaid_gap_blocked then
        return jsonb_build_object(
          'allowed', false,
          'status_code', 403,
          'error_code', 'RECORDING_LOCKED_ARREARS',
          'error_message', 'This recording was conducted during an unpaid period. Please clear your overdue installment balance to unlock playback.'
        );
      end if;
    end if;

    return jsonb_build_object(
      'allowed', true,
      'status_code', 200,
      'role', 'student',
      'storage_bucket', v_rec.storage_bucket,
      'storage_path', v_rec.storage_path
    );
  end if;

  return jsonb_build_object(
    'allowed', false,
    'status_code', 403,
    'error_code', 'UNAUTHORIZED_ROLE',
    'error_message', 'Access denied.'
  );
end;
$$;

comment on function public.verify_recording_playback_access(uuid) is
  'Verifies recording playback authorization. Preserves batch isolation and permanent course ownership while locking recordings conducted during an unpaid gap period until overdue installments are settled.';

revoke all on function public.verify_recording_playback_access(uuid) from public, anon;
grant execute on function public.verify_recording_playback_access(uuid) to authenticated;
grant execute on function public.verify_recording_playback_access(uuid) to service_role;
