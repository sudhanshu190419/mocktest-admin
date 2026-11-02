-- ============================================================================
-- Migration 227: Cancel Any Pending Course Orders in reserve_installment_order
-- ============================================================================
-- Purpose:
--   Updates public.reserve_installment_order() Step 6 to cancel ANY existing
--   pending order for the student and requested course before reserving the
--   new installment order.
--   Previously, Step 6 only cancelled orders where installmentPlanId was not null.
--   If a student had a prior pending order for the course (e.g. from full-course
--   checkout), the partial unique constraint uq_orders_pending_course on
--   (profile_id, notes::jsonb ->> 'courseId') was violated on INSERT.
--
-- Repositories:
--   - C:\Projects\mocktest-admin\supabase\migrations\227_fix_installment_reservation_cancel_course_pending_orders.sql
--   - C:\Projects\MockTestApp\supabase\migrations\227_fix_installment_reservation_cancel_course_pending_orders.sql
-- ============================================================================

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
  v_currency             public.currency_code;
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

  -- Resolve currency with explicit enum typing
  v_currency := coalesce(v_course.currency, 'INR')::public.currency_code;

  -- 6. Cancel ANY stale pending orders for this user and course
  --    (both full-course and installment orders) to satisfy uq_orders_pending_course.
  update public.orders
  set status = 'cancelled'::public.order_status,
      cancelled_at = now(),
      updated_at = now()
  where (profile_id = p_profile_id or (v_student_id is not null and student_id = v_student_id))
    and status = 'pending'
    and notes is not null
    and case
          when notes ~ '^\s*\{' then (notes::jsonb ->> 'courseId' = p_course_id::text)
          else false
        end;

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
  -- Note: fulfillment_status is TEXT with CHECK constraint (not an enum)
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
    'pending'::public.order_status,
    'unfulfilled',
    v_currency,
    v_first_tranche,
    0.00,
    0.00,
    v_first_tranche,
    v_notes::text,
    now()
  );

  -- 10. Insert order_items row with explicit enum casting
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
    'installment'::public.item_type,
    p_course_id,
    p_plan_id,
    v_plan.plan_name,
    v_first_tranche,
    1,
    0.00,
    v_first_tranche
  );

  -- 11. Insert initial pending payments row with explicit enum casting
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
    'razorpay'::public.payment_gateway,
    v_first_tranche,
    v_currency,
    'pending'::public.payment_status
  );

  return jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'payment_id', v_payment_id,
    'receipt_id', v_receipt_id,
    'amount', v_first_tranche,
    'amount_paise', v_tranche_paise,
    'currency', v_currency::text,
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
  'Atomically validates plan terms, calculates first installment amount, cancels all prior pending course orders, and persists orders, order_items, and payments in one ACID transaction.';

grant execute on function public.reserve_installment_order to authenticated;
grant execute on function public.reserve_installment_order to service_role;
