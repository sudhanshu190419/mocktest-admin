-- ============================================================================
-- Migration 204: Subscription Grace Parity and Content Access Unblocker
--
-- PURPOSE:
-- 1. Restores Google Play subscription date parity with the original Razorpay
--    access policy:
--    - Calculates and stores grace_end_date (end_date + grace_days, default 7d)
--    - Calculates and stores content_access_end_date (grace_end_date + content_access_days, default 30d)
--    - Reads grace_days and content_access_days from public.system_settings for tenant isolation
--    - Satisfies constraint ck_student_subscriptions_content_access_end_date
-- 2. Resolves the Batch-Membership blocker for self-paced and app-direct courses:
--    - Updates can_student_access_content(p_course_id) to permit direct subscription
--      access when a course has no linked batches (not exists in course_batches)
--    - Preserves strict batch isolation when institutional batches are present
--    - Preserves permanent course ownership (is_permanent_course_owner)
-- 3. Updates can_student_access_live_course(p_course_id) with identical non-batch
--    direct support while strictly cutting off live classes at grace_end_date.
-- 4. Updates verify_recording_playback_access(p_recording_id) to honor permanent
--    course ownership while preserving batch isolation between institutional cohorts.
--
-- SECURITY GUARDS:
-- - All functions are SECURITY DEFINER with set search_path = ''
-- - complete_google_play_purchase is restricted to service_role only
-- - Preserves RLS, tenant isolation, and payment verification
--
-- NOTE: Prepared locally. DO NOT apply directly to production without review.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 1: Updated complete_google_play_purchase with Date Parity
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.complete_google_play_purchase(
    p_profile_id uuid,
    p_institute_id uuid,
    p_student_id uuid,
    p_item_type text, -- 'course', 'subscription_plan', 'pyq_package'
    p_course_id uuid default null,
    p_plan_id uuid default null,
    p_package_id uuid default null,
    p_item_name text default 'Educational Product',
    p_unit_price numeric default 0.00,
    p_effective_order_id text default null,
    p_purchase_token text default null,
    p_product_id text default null,
    p_gateway_response jsonb default null,
    p_transaction_timestamp timestamptz default now(),
    p_subscription_end_date date default null,
    p_is_auto_renew boolean default true,
    p_billing_name text default null,
    p_billing_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_role text;
  v_existing_payment record;
  v_order_id uuid;
  v_item_id uuid;
  v_order_notes jsonb;
  v_student_id uuid;
  v_existing_sub record;
  v_existing_enrollment record;
  v_target_enrollment_type text;
  v_entitlement text := '';
  v_year text;
  v_invoice_num text;

  -- Date calculation variables (aligning with system_settings & Razorpay policy)
  v_grace_days int := 7;
  v_content_access_days int := 30;
  v_start_date date;
  v_calculated_end_date date;
  v_grace_end_date date;
  v_content_access_end_date date;
  v_plan_duration_days int := 30;
begin
  -- 0. Security Guard: Only service_role (Edge Function backend) may execute this RPC
  v_caller_role := auth.role();
  if v_caller_role <> 'service_role' then
    return jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: complete_google_play_purchase requires service_role privileges',
      'code', 'FORBIDDEN'
    );
  end if;

  -- 1. Defensively resolve student_details.student_id from profile_id
  select student_id into v_student_id
  from public.student_details
  where profile_id = p_profile_id;

  if v_student_id is null and p_student_id is not null then
    select student_id into v_student_id
    from public.student_details
    where student_id = p_student_id;
  end if;

  if v_student_id is null then
    return jsonb_build_object(
      'success', false,
      'error', 'Student details record not found for profile',
      'code', 'STUDENT_NOT_FOUND'
    );
  end if;

  -- 2. Check existing captured payment (idempotency / replay)
  select p.payment_id, p.order_id, o.profile_id
  into v_existing_payment
  from public.payments p
  join public.orders o on o.order_id = p.order_id
  where p.gateway = 'google_play'
    and p.status = 'captured'
    and (
      p.gateway_payment_id = p_effective_order_id
      or p.gateway_order_id = p_effective_order_id
      or (p.gateway_response ->> 'purchaseToken') = p_purchase_token
    )
  limit 1;

  if v_existing_payment.payment_id is not null then
    if v_existing_payment.profile_id <> p_profile_id then
      return jsonb_build_object(
        'success', false,
        'error', 'This purchase has already been claimed by another account. Please sign in with the original account or contact support.',
        'code', 'ACCOUNT_MISMATCH'
      );
    end if;

    return jsonb_build_object(
      'success', true,
      'verified', true,
      'alreadyProcessed', true,
      'orderId', v_existing_payment.order_id,
      'message', 'Purchase already processed and entitlement active'
    );
  end if;

  -- 3. Build structured order notes with correlation metadata
  v_order_notes := jsonb_build_object(
    'gateway', 'google_play',
    'purchaseToken', p_purchase_token,
    'orderId', p_effective_order_id,
    'productId', p_product_id,
    'itemType', p_item_type,
    'courseId', p_course_id,
    'planId', p_plan_id,
    'packageId', p_package_id
  );

  -- 4. Check for existing unfulfilled order with this purchaseToken / orderId
  select o.order_id
  into v_order_id
  from public.orders o
  where o.profile_id = p_profile_id
    and (
      (o.notes::jsonb ->> 'purchaseToken') = p_purchase_token
      or (o.notes::jsonb ->> 'orderId') = p_effective_order_id
    )
  limit 1;

  if v_order_id is null then
    insert into public.orders (
      institute_id,
      student_id,
      profile_id,
      status,
      currency,
      subtotal_amount,
      discount_amount,
      tax_amount,
      total_amount,
      notes,
      placed_at,
      confirmed_at,
      created_at,
      updated_at
    ) values (
      p_institute_id,
      v_student_id,
      p_profile_id,
      'confirmed',
      'INR'::public.currency_code,
      p_unit_price,
      0.00,
      0.00,
      p_unit_price,
      v_order_notes,
      p_transaction_timestamp,
      p_transaction_timestamp,
      p_transaction_timestamp,
      p_transaction_timestamp
    )
    returning order_id into v_order_id;

    insert into public.order_items (
      order_id,
      institute_id,
      item_type,
      course_id,
      plan_id,
      package_id,
      item_name,
      unit_price,
      quantity,
      discount_amount,
      line_total,
      created_at,
      updated_at
    ) values (
      v_order_id,
      p_institute_id,
      p_item_type,
      p_course_id,
      p_plan_id,
      p_package_id,
      p_item_name,
      p_unit_price,
      1,
      0.00,
      p_unit_price,
      p_transaction_timestamp,
      p_transaction_timestamp
    )
    returning item_id into v_item_id;
  else
    select item_id into v_item_id
    from public.order_items
    where order_id = v_order_id
    limit 1;
  end if;

  -- 5. Insert Payment record satisfying ck_payments_paid_at
  insert into public.payments (
    order_id,
    institute_id,
    attempt_number,
    gateway,
    gateway_order_id,
    gateway_payment_id,
    gateway_response,
    amount,
    currency,
    status,
    paid_at,
    created_at,
    updated_at
  ) values (
    v_order_id,
    p_institute_id,
    1,
    'google_play'::public.payment_gateway,
    p_effective_order_id,
    p_effective_order_id,
    p_gateway_response,
    p_unit_price,
    'INR'::public.currency_code,
    'captured'::public.payment_status,
    p_transaction_timestamp,
    p_transaction_timestamp,
    p_transaction_timestamp
  );

  -- 6. Grant Entitlement
  if p_item_type = 'course' and p_course_id is not null then
    insert into public.course_enrollments (
      course_id,
      student_id,
      institute_id,
      order_item_id,
      enrollment_type,
      is_active,
      enrolled_at,
      revoked_at,
      revoked_reason
    ) values (
      p_course_id,
      v_student_id,
      p_institute_id,
      v_item_id,
      'purchase',
      true,
      p_transaction_timestamp,
      null,
      null
    )
    on conflict (course_id, student_id)
    do update set
      is_active = true,
      enrollment_type = 'purchase',
      order_item_id = coalesce(excluded.order_item_id, course_enrollments.order_item_id),
      revoked_at = null,
      revoked_reason = null;

    v_entitlement := 'course_enrollment:' || p_course_id::text;

  elsif p_item_type = 'subscription_plan' and p_plan_id is not null then
    -- Load institute-level configuration from system_settings (defaults: 7d grace, 30d content)
    select coalesce(
      (select setting_value::int
       from public.system_settings
       where institute_id = p_institute_id
         and setting_key = 'grace_days'
         and is_active = true
       limit 1),
      7
    ) into v_grace_days;

    select coalesce(
      (select setting_value::int
       from public.system_settings
       where institute_id = p_institute_id
         and setting_key = 'content_access_days'
         and is_active = true
       limit 1),
      30
    ) into v_content_access_days;

    -- Fetch plan duration for fallback calculation
    select coalesce(duration_days, 30)
    into v_plan_duration_days
    from public.subscription_plans
    where plan_id = p_plan_id;

    v_start_date := (p_transaction_timestamp at time zone 'utc')::date;

    -- Check if active or grace subscription exists (Migration 086 / 096)
    select subscription_id, status, end_date
    into v_existing_sub
    from public.student_subscriptions
    where student_id = v_student_id
      and plan_id = p_plan_id
      and status in ('active', 'grace')
    limit 1;

    -- Compute end_date, preserving early renewal remaining days if applicable
    if p_subscription_end_date is not null then
      v_calculated_end_date := p_subscription_end_date;
    elsif v_existing_sub.subscription_id is not null and v_existing_sub.end_date is not null and v_existing_sub.end_date >= v_start_date then
      v_calculated_end_date := (v_existing_sub.end_date + (v_plan_duration_days || ' days')::interval)::date;
    else
      v_calculated_end_date := (v_start_date + (v_plan_duration_days || ' days')::interval)::date;
    end if;

    -- Compute grace and content access boundaries
    v_grace_end_date := (v_calculated_end_date + (v_grace_days || ' days')::interval)::date;
    v_content_access_end_date := (v_grace_end_date + (v_content_access_days || ' days')::interval)::date;

    if v_existing_sub.subscription_id is not null then
      update public.student_subscriptions
      set order_id = v_order_id,
          status = 'active',
          start_date = v_start_date,
          end_date = v_calculated_end_date,
          grace_end_date = v_grace_end_date,
          content_access_end_date = v_content_access_end_date,
          is_auto_renew = p_is_auto_renew,
          payment_method_id = p_purchase_token,
          updated_at = p_transaction_timestamp
      where subscription_id = v_existing_sub.subscription_id;
    else
      insert into public.student_subscriptions (
        student_id,
        plan_id,
        course_id,
        institute_id,
        order_id,
        status,
        start_date,
        end_date,
        grace_end_date,
        content_access_end_date,
        is_auto_renew,
        payment_method_id,
        created_at,
        updated_at
      ) values (
        v_student_id,
        p_plan_id,
        p_course_id,
        p_institute_id,
        v_order_id,
        'active',
        v_start_date,
        v_calculated_end_date,
        v_grace_end_date,
        v_content_access_end_date,
        p_is_auto_renew,
        p_purchase_token,
        p_transaction_timestamp,
        p_transaction_timestamp
      );
    end if;

    -- Grant course access, but preserve permanent ownership ('purchase') per Migration 096
    if p_course_id is not null then
      select enrollment_id, enrollment_type
      into v_existing_enrollment
      from public.course_enrollments
      where course_id = p_course_id
        and student_id = v_student_id
      limit 1;

      if v_existing_enrollment.enrollment_type = 'purchase' then
        v_target_enrollment_type := 'purchase';
      else
        v_target_enrollment_type := 'subscription';
      end if;

      insert into public.course_enrollments (
        course_id,
        student_id,
        institute_id,
        enrollment_type,
        is_active,
        enrolled_at,
        revoked_at,
        revoked_reason
      ) values (
        p_course_id,
        v_student_id,
        p_institute_id,
        v_target_enrollment_type,
        true,
        p_transaction_timestamp,
        null,
        null
      )
      on conflict (course_id, student_id)
      do update set
        is_active = true,
        enrollment_type = v_target_enrollment_type,
        revoked_at = null,
        revoked_reason = null;
    end if;

    v_entitlement := 'student_subscription:' || p_plan_id::text;

  elsif p_item_type = 'pyq_package' and p_package_id is not null then
    insert into public.student_pyq_purchases (
      package_id,
      student_id,
      institute_id,
      order_item_id,
      access_type,
      is_active,
      purchased_at,
      created_at,
      updated_at
    ) values (
      p_package_id,
      v_student_id,
      p_institute_id,
      v_item_id,
      'lifetime',
      true,
      p_transaction_timestamp,
      p_transaction_timestamp,
      p_transaction_timestamp
    )
    on conflict (package_id, student_id)
    do update set
      is_active = true,
      updated_at = p_transaction_timestamp;

    v_entitlement := 'pyq_package:' || p_package_id::text;
  end if;

  -- 7. Snapshot draft invoice
  begin
    v_year := to_char(p_transaction_timestamp, 'YYYY');
    v_invoice_num := 'INV-' || v_year || '-' || upper(substr(replace(v_order_id::text, '-', ''), 1, 8));

    insert into public.invoices (
      order_id,
      institute_id,
      invoice_number,
      status,
      issue_date,
      subtotal_amount,
      discount_amount,
      tax_amount,
      total_amount,
      currency,
      billing_name,
      billing_email,
      created_at,
      updated_at
    ) values (
      v_order_id,
      p_institute_id,
      v_invoice_num,
      'draft',
      (p_transaction_timestamp at time zone 'utc')::date,
      p_unit_price,
      0.00,
      0.00,
      p_unit_price,
      'INR'::public.currency_code,
      p_billing_name,
      p_billing_email,
      p_transaction_timestamp,
      p_transaction_timestamp
    )
    on conflict (order_id) do nothing;
  exception when others then
    null;
  end;

  return jsonb_build_object(
    'success', true,
    'verified', true,
    'orderId', v_order_id,
    'entitlement', v_entitlement,
    'message', 'Google Play purchase processed atomically with date parity'
  );
end;
$$;

comment on function public.complete_google_play_purchase(
  uuid, uuid, uuid, text, uuid, uuid, uuid, text, numeric, text, text, text, jsonb, timestamptz, date, boolean, text, text
) is 'Migration 204: Atomic Google Play purchase processing with full 7-day grace and 30-day content window date parity matching the Razorpay policy.';

revoke all on function public.complete_google_play_purchase(
  uuid, uuid, uuid, text, uuid, uuid, uuid, text, numeric, text, text, text, jsonb, timestamptz, date, boolean, text, text
) from public, anon, authenticated;

grant execute on function public.complete_google_play_purchase(
  uuid, uuid, uuid, text, uuid, uuid, uuid, text, numeric, text, text, text, jsonb, timestamptz, date, boolean, text, text
) to service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 2: Updated can_student_access_content(course_id uuid)
-- ────────────────────────────────────────────────────────────────────────────
-- Resolves the batch-membership blocker:
--   1. Permanent course ownership (enrollment_type = 'purchase') preserves direct access.
--   2. Subscription content entitlement:
--      - If the course has NO linked batches (course_batches has 0 rows for course),
--        a valid subscription directly entitles the student to course materials.
--      - If the course HAS linked institutional batches, the student must be actively
--        assigned to at least one batch linked to the course (is_student_assigned_to_course_batch),
--        preserving cohort isolation between separate batches.
--      - Valid tiers: active, grace, or expired inside content_access_end_date.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.can_student_access_content(
    p_course_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with today as (
    select (now() at time zone 'utc')::date as d
  )
  select
    -- (1) Permanent course ownership (Phase 11K.2) — standalone entitlement
    public.is_permanent_course_owner(p_course_id)
    or exists (
      -- (2) Subscription content entitlement
      select 1
      from public.student_subscriptions ss, today
      where ss.course_id = p_course_id
        and ss.student_id = public.get_my_student_id()
        and (
          -- If course has no linked batches, grant direct subscription access.
          -- If course has linked batches, student must be assigned to an active linked batch.
          (not exists (select 1 from public.course_batches cb where cb.course_id = p_course_id))
          or public.is_student_assigned_to_course_batch(p_course_id)
        )
        and (
          (ss.status = 'active'
            and (
              ss.end_date >= today.d
              or (ss.grace_end_date is not null
                  and ss.grace_end_date >= today.d)
              or (ss.content_access_end_date is not null
                  and ss.content_access_end_date >= today.d)
            ))
          or (ss.status = 'grace'
              and (
                (ss.grace_end_date is not null
                 and ss.grace_end_date >= today.d)
                or (ss.content_access_end_date is not null
                    and ss.content_access_end_date >= today.d)
              ))
          or (ss.status = 'expired'
              and ss.content_access_end_date is not null
              and ss.content_access_end_date >= today.d)
        )
    );
$$;

comment on function public.can_student_access_content(uuid) is
  'Migration 204: TRUE when caller permanently owns the course OR holds a valid subscription '
  '(active, grace, or content_only window). For courses without linked batches, direct subscription '
  'grants access. For courses with linked institutional batches, active batch assignment is enforced.';


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 3: Updated can_student_access_live_course(course_id uuid)
-- ────────────────────────────────────────────────────────────────────────────
-- Live classes are joinable only during active term and 7-day grace window.
-- Live classes cut off strictly after grace_end_date.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.can_student_access_live_course(
    p_course_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with today as (
    select (now() at time zone 'utc')::date as d
  )
  select
    -- (1) Permanent course ownership (Phase 11K.2) — standalone entitlement
    public.is_permanent_course_owner(p_course_id)
    or exists (
      -- (2) Subscription live entitlement (active or grace tier only)
      select 1
      from public.student_subscriptions ss, today
      where ss.course_id = p_course_id
        and ss.student_id = public.get_my_student_id()
        and (
          (not exists (select 1 from public.course_batches cb where cb.course_id = p_course_id))
          or public.is_student_assigned_to_course_batch(p_course_id)
        )
        and (
          (ss.status = 'active'
            and (ss.end_date >= today.d
                 or (ss.grace_end_date is not null
                     and ss.grace_end_date >= today.d)))
          or (ss.status = 'grace'
              and ss.grace_end_date is not null
              and ss.grace_end_date >= today.d)
        )
    );
$$;

comment on function public.can_student_access_live_course(uuid) is
  'Migration 204: TRUE when caller permanently owns the course OR holds an active or grace subscription. '
  'Live access terminates after grace_end_date. Direct access supported for non-batch courses.';


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 4: Updated verify_recording_playback_access(recording_id uuid)
-- ────────────────────────────────────────────────────────────────────────────
-- Preserves role-based isolation (Admin bypass, Teacher ownership).
-- For Students:
--   1. Recording must be assigned to an active batch subject.
--   2. Student must be actively enrolled in the batch OR permanently own a course linked to the batch.
--   3. Content window access must be valid via can_student_access_content() for a linked course.
-- ────────────────────────────────────────────────────────────────────────────

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
begin
  -- 1. Validate caller identity (derive strictly from auth.uid())
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object(
      'allowed', false,
      'status_code', 401,
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
    r.teacher_id
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

  -- 6. Soft-delete check: must not be deleted
  if coalesce(v_rec.is_deleted, false) = true then
    return jsonb_build_object(
      'allowed', false,
      'status_code', 410,
      'error_code', 'RECORDING_DELETED',
      'error_message', 'Recording has been deleted.'
    );
  end if;

  -- 7. Storage path check: must have a non-empty storage path
  if v_rec.storage_path is null or trim(v_rec.storage_path) = '' then
    return jsonb_build_object(
      'allowed', false,
      'status_code', 500,
      'error_code', 'MISSING_STORAGE_PATH',
      'error_message', 'Recording has no storage path.'
    );
  end if;

  -- 8. Role-based authorization
  -- Case A: Admin (full bypass)
  if v_role in ('admin', 'super_admin') then
    return jsonb_build_object(
      'allowed', true,
      'status_code', 200,
      'role', 'admin',
      'storage_bucket', v_rec.storage_bucket,
      'storage_path', v_rec.storage_path
    );

  -- Case B: Teacher (ownership check)
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

  -- Case C: Student (batch assignment OR permanent course ownership + course content entitlement)
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

    -- Check if recording is assigned to any batch subjects
    if not exists (
      select 1
      from public.batch_subject_recordings bsr
      where bsr.recording_id = p_recording_id
    ) then
      return jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'error_code', 'NO_BATCH_ASSIGNED',
        'error_message', 'This recording is not assigned to any batch.'
      );
    end if;

    -- Check if recording is assigned to any ACTIVE batch subjects
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

    -- Check student's active batch membership OR permanent course ownership
    -- Permanent course owners of a course linked to this recording's batch keep access without batch_students row.
    -- All other students must have an active batch_students row for that batch.
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

    -- Check if any courses are linked to the recording's active batches
    select exists (
      select 1
      from public.batch_subject_recordings bsr
      join public.batch_subjects bs on bs.batch_subject_id = bsr.batch_subject_id
      join public.course_batches cb on cb.batch_id = bs.batch_id
      where bsr.recording_id = p_recording_id
        and bs.is_active = true
    ) into v_has_linked_courses;

    if not v_has_linked_courses then
      return jsonb_build_object(
        'allowed', false,
        'status_code', 403,
        'error_code', 'NO_LINKED_COURSE',
        'error_message', 'Your content access period has ended. Renew your subscription to continue.'
      );
    end if;

    -- Check course content entitlement using can_student_access_content()
    -- Evaluates TRUE if ANY course linked to the recording's active batches satisfies entitlement
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
  'Migration 204: Verifies recording playback authorization. Preserves batch isolation and permanent course ownership.';
