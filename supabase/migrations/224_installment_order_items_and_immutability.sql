-- ============================================================================
-- Migration 224: Installment Order Items, Fulfillment Decoupling, and Immutability
-- ============================================================================
-- Purpose:
--   1. Extends public.order_items with installment_plan_id and agreement_id FKs.
--   2. Updates ck_order_items_item_type_consistency to enforce 'installment' integrity.
--   3. Extends public.orders with fulfillment_status and admin_review_reason to
--      strictly decouple payment capture from course entitlement fulfillment.
--   4. Creates partial unique index uq_orders_pending_installment to prevent
--      concurrent duplicate checkout attempts for the same course.
--   5. Extends trg_enforce_installment_plan_immutability so plan financial terms
--      cannot be mutated once referenced by agreements OR unresolved orders.
--   6. Provides atomic database reservation RPC public.reserve_installment_order().
--
-- Dependencies:
--   - Migration 221 (Installment Financial Integrity & process_installment_payment)
--   - Migration 223 (Add 'installment' to public.item_type enum)
--
-- Repositories:
--   - C:\Projects\mocktest-admin\supabase\migrations\224_installment_order_items_and_immutability.sql
--   - C:\Projects\MockTestApp\supabase\migrations\224_installment_order_items_and_immutability.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Schema Extensions on public.order_items
-- ----------------------------------------------------------------------------

alter table public.order_items
  add column if not exists installment_plan_id uuid null
    references public.course_installment_plans(plan_id) on delete restrict,
  add column if not exists agreement_id uuid null
    references public.student_course_agreements(agreement_id) on delete restrict;

create index if not exists idx_order_items_installment_plan
  on public.order_items (installment_plan_id)
  where installment_plan_id is not null;

create index if not exists idx_order_items_agreement
  on public.order_items (agreement_id)
  where agreement_id is not null;

-- ----------------------------------------------------------------------------
-- 2. Schema Extensions on public.orders (Decouple Payment from Fulfillment)
-- ----------------------------------------------------------------------------

alter table public.orders
  add column if not exists fulfillment_status text not null default 'unfulfilled'
    constraint ck_orders_fulfillment_status check (
      fulfillment_status in ('unfulfilled', 'fulfilled', 'requires_review', 'failed')
    ),
  add column if not exists admin_review_reason text null;

create index if not exists idx_orders_fulfillment_status
  on public.orders (fulfillment_status);

create index if not exists idx_orders_admin_review
  on public.orders (created_at desc)
  where fulfillment_status = 'requires_review';

comment on column public.orders.fulfillment_status is
  'Decouples payment capture from product onboarding: unfulfilled, fulfilled, requires_review, failed.';

comment on column public.orders.admin_review_reason is
  'Diagnostic reason when fulfillment_status = requires_review (e.g. PLAN_DEACTIVATED_IN_FLIGHT, LATE_PAYMENT_ON_SUPERSEDED_ORDER).';

-- ----------------------------------------------------------------------------
-- 3. Update ck_order_items_item_type_consistency Constraint
-- ----------------------------------------------------------------------------

alter table public.order_items
  drop constraint if exists ck_order_items_item_type_consistency;

alter table public.order_items
  add constraint ck_order_items_item_type_consistency check (
    (item_type = 'course' and course_id is not null and plan_id is null and package_id is null and installment_plan_id is null and agreement_id is null) or
    (item_type = 'subscription_plan' and plan_id is not null and course_id is not null and package_id is null and installment_plan_id is null and agreement_id is null) or
    (item_type = 'pyq_package' and package_id is not null and plan_id is null and course_id is null and installment_plan_id is null and agreement_id is null) or
    (item_type = 'installment' and installment_plan_id is not null and course_id is not null and plan_id is null and package_id is null)
  );

comment on constraint ck_order_items_item_type_consistency on public.order_items is
  'Enforces polymorphic foreign-key consistency across course, subscription_plan, pyq_package, and installment items.';

-- ----------------------------------------------------------------------------
-- 4. Concurrency & Uniqueness Guard on Pending Installment Orders
-- ----------------------------------------------------------------------------

create unique index if not exists uq_orders_pending_installment
  on public.orders (
    profile_id,
    (notes::jsonb ->> 'courseId')
  )
  where status = 'pending' and notes::jsonb ->> 'installmentPlanId' is not null;

comment on index public.uq_orders_pending_installment is
  'Concurrency guard: at most one PENDING installment order per student profile and course.';

-- ----------------------------------------------------------------------------
-- 5. Extend Plan Immutability Trigger (Agreements + Unresolved Orders)
-- ----------------------------------------------------------------------------

create or replace function public.trg_enforce_installment_plan_immutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has_agreements boolean;
  v_has_orders     boolean;
begin
  -- Only evaluate when one or more of the 4 protected financial fields are modified
  if (old.course_id is distinct from new.course_id
      or old.total_fee is distinct from new.total_fee
      or old.number_of_installments is distinct from new.number_of_installments
      or old.interval_months is distinct from new.interval_months) then

    -- 1. Check if any student agreements reference this plan
    select exists (
      select 1
      from public.student_course_agreements
      where plan_id = old.plan_id
    ) into v_has_agreements;

    if v_has_agreements then
      raise exception 'Cannot modify financial parameters (course_id, total_fee, number_of_installments, interval_months) for installment plan % because student agreements already reference it. To change terms, deactivate this plan (set is_active = false) and create a new plan.', old.plan_id
        using errcode = '23514'; -- check_violation
    end if;

    -- 2. Check if any active or review-pending orders reference this plan
    select exists (
      select 1
      from public.order_items oi
      join public.orders o on o.order_id = oi.order_id
      where oi.installment_plan_id = old.plan_id
        and (o.status in ('pending', 'confirmed') or o.fulfillment_status = 'requires_review')
    ) into v_has_orders;

    if v_has_orders then
      raise exception 'Cannot modify financial parameters for installment plan % because active orders or orders under review reference it. To change terms, deactivate this plan (set is_active = false) and create a new plan.', old.plan_id
        using errcode = '23514'; -- check_violation
    end if;
  end if;

  return new;
end;
$$;

comment on function public.trg_enforce_installment_plan_immutability() is
  'Enforces database-level immutability of financial terms on course_installment_plans once student agreements or orders reference it.';

-- ----------------------------------------------------------------------------
-- 6. Atomic Installment Order Reservation RPC
-- ----------------------------------------------------------------------------

create or replace function public.reserve_installment_order(
  p_profile_id       uuid,
  p_course_id        uuid,
  p_plan_id          uuid,
  p_guardian_name    text default null,
  p_guardian_mobile  text default null,
  p_guardian_email   text default null,
  p_target_year      text default null,
  p_dob              date default null
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_institute_id         uuid;
  v_plan                 record;
  v_course               record;
  v_student_id           uuid;
  v_existing_agreement   record;
  v_first_tranche        numeric(12,2);
  v_tranche_paise        integer;
  v_order_id             uuid;
  v_payment_id           uuid;
  v_receipt_id           text;
  v_notes                jsonb;
begin
  -- 1. Validate Profile and resolve institute
  select institute_id into v_institute_id
  from public.profiles
  where profile_id = p_profile_id;

  if v_institute_id is null then
    return jsonb_build_object(
      'success', false,
      'error', 'Profile not found or missing institute association.',
      'code', 'PROFILE_NOT_FOUND'
    );
  end if;

  -- 2. Validate Course
  select course_id, title, status, deleted_at, currency
  into v_course
  from public.courses
  where course_id = p_course_id;

  if not found or v_course.deleted_at is not null then
    return jsonb_build_object(
      'success', false,
      'error', 'Course not found or no longer available.',
      'code', 'COURSE_NOT_AVAILABLE'
    );
  end if;

  if v_course.status <> 'published' then
    return jsonb_build_object(
      'success', false,
      'error', 'Course is not published for purchase.',
      'code', 'COURSE_NOT_PUBLISHED'
    );
  end if;

  -- 3. Lock & Validate Installment Plan FOR SHARE
  select plan_id, course_id, plan_name, total_fee, number_of_installments, interval_months, is_active
  into v_plan
  from public.course_installment_plans
  where plan_id = p_plan_id
  for share;

  if not found then
    return jsonb_build_object(
      'success', false,
      'error', 'Installment plan not found.',
      'code', 'PLAN_NOT_FOUND'
    );
  end if;

  if v_plan.course_id <> p_course_id then
    return jsonb_build_object(
      'success', false,
      'error', 'Installment plan does not belong to the requested course.',
      'code', 'PLAN_COURSE_MISMATCH'
    );
  end if;

  if not v_plan.is_active then
    return jsonb_build_object(
      'success', false,
      'error', 'This installment plan is inactive and no longer accepting checkouts.',
      'code', 'PLAN_INACTIVE'
    );
  end if;

  -- 4. Check if student already has an active agreement or permanent ownership
  select student_id into v_student_id
  from public.student_details
  where profile_id = p_profile_id
  limit 1;

  if v_student_id is not null then
    -- Permanent owner check
    if exists (
      select 1 from public.course_enrollments
      where student_id = v_student_id
        and course_id = p_course_id
        and enrollment_type = 'purchase'
        and is_active = true
        and revoked_at is null
    ) then
      return jsonb_build_object(
        'success', false,
        'error', 'You already permanently own this course.',
        'code', 'ALREADY_OWNED'
      );
    end if;

    -- Existing active or in_arrears agreement check
    select agreement_id, agreement_status
    into v_existing_agreement
    from public.student_course_agreements
    where student_id = v_student_id
      and course_id = p_course_id
    limit 1;

    if found and v_existing_agreement.agreement_status in ('active', 'in_arrears') then
      return jsonb_build_object(
        'success', false,
        'error', 'An active installment agreement already exists for this course.',
        'code', 'AGREEMENT_ALREADY_EXISTS',
        'agreement_id', v_existing_agreement.agreement_id
      );
    end if;
  end if;

  -- 5. Calculate exact BCD Tranche 1 using PostgreSQL arbitrary-precision math
  v_first_tranche := round(v_plan.total_fee / v_plan.number_of_installments, 2);
  v_tranche_paise := (v_first_tranche * 100)::integer;

  -- 6. Cancel any stale pending installment orders for this user and course
  update public.orders
  set status = 'cancelled',
      cancelled_at = now(),
      updated_at = now()
  where profile_id = p_profile_id
    and status = 'pending'
    and notes::jsonb ->> 'courseId' = p_course_id::text
    and notes::jsonb ->> 'installmentPlanId' is not null;

  -- 7. Generate order ID and deterministic receipt ID
  v_order_id := gen_random_uuid();
  v_receipt_id := 'rcpt_' || replace(v_order_id::text, '-', '');

  -- 8. Build order notes
  v_notes := jsonb_build_object(
    'productType', 'installment',
    'courseId', p_course_id,
    'courseName', v_course.title,
    'installmentPlanId', p_plan_id,
    'planName', v_plan.plan_name,
    'totalFee', v_plan.total_fee,
    'numberOfInstallments', v_plan.number_of_installments,
    'intervalMonths', v_plan.interval_months,
    'firstTrancheAmount', v_first_tranche,
    'receiptId', v_receipt_id,
    'guardianName', p_guardian_name,
    'guardianMobile', p_guardian_mobile,
    'guardianEmail', p_guardian_email,
    'targetYear', p_target_year,
    'dob', p_dob
  );

  -- 9. Insert orders row (Atomic Reservation)
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
    v_institute_id,
    v_student_id, -- may be null for pre-onboarding users
    p_profile_id,
    'pending',
    'unfulfilled',
    coalesce(v_course.currency, 'INR'),
    v_first_tranche,
    0.00,
    0.00,
    v_first_tranche,
    v_notes::text,
    now()
  );

  -- 10. Insert order_items row
  insert into public.order_items (
    order_id,
    institute_id,
    item_type,
    course_id,
    installment_plan_id,
    item_name,
    unit_price,
    quantity,
    discount_amount,
    line_total
  ) values (
    v_order_id,
    v_institute_id,
    'installment',
    p_course_id,
    p_plan_id,
    v_plan.plan_name,
    v_first_tranche,
    1,
    0.00,
    v_first_tranche
  );

  -- 11. Insert initial pending payments row
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
    v_institute_id,
    1,
    'razorpay',
    v_first_tranche,
    coalesce(v_course.currency, 'INR'),
    'pending'
  );

  return jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'payment_id', v_payment_id,
    'receipt_id', v_receipt_id,
    'amount', v_first_tranche,
    'amount_paise', v_tranche_paise,
    'currency', coalesce(v_course.currency, 'INR'),
    'plan_id', v_plan.plan_id,
    'plan_name', v_plan.plan_name,
    'course_id', p_course_id,
    'course_name', v_course.title,
    'total_fee', v_plan.total_fee,
    'number_of_installments', v_plan.number_of_installments,
    'interval_months', v_plan.interval_months
  );
end;
$$;

comment on function public.reserve_installment_order is
  'Atomically validates plan terms, calculates first installment amount, cancels stale pending orders, and persists orders, order_items, and payments in one ACID transaction.';

grant execute on function public.reserve_installment_order to authenticated;
grant execute on function public.reserve_installment_order to service_role;
