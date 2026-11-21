-- ============================================================================
-- Migration: 245 — Shared Schema and Constraint Cleanup
--
-- Repositories:
--   - C:\Projects\MockTestApp\supabase\migrations\245_shared_schema_and_constraint_cleanup.sql
--   - C:\Projects\mocktest-admin\supabase\migrations\245_shared_schema_and_constraint_cleanup.sql
--
-- Objective:
--   Removes obsolete shared subscription columns, foreign keys, check constraints,
--   and indexes following the successful execution and verification of Migration 244
--   (subscription demo data cleanup). Decouples shared commerce and entitlement
--   RPCs from public.order_items.plan_id.
--
-- Scope Boundary:
--   - Shared schema cleanup strictly (order_items, course_enrollments, order_entitlement_grants).
--   - Subscription catalog tables (subscription_plans, subscription_features, plan_unlocks)
--     and runtime table drops belong strictly to Migration 246.
--   - PostgreSQL enum types (public.item_type, public.notification_event_type) retain
--     existing labels because PostgreSQL does not support ALTER TYPE ... DROP VALUE;
--     domain integrity is enforced via check constraints.
--
-- Protected Functionality Preserved:
--   1. Full-payment course purchases through Google Play Billing on Android.
--   2. Website course purchases through Razorpay.
--   3. Website installment purchases through Razorpay.
--   4. PYQ package purchases.
--   5. Student course enrollment and content access.
--   6. Admin batch assignment.
--   7. Installment schedules, payments, allocations, adjustments, and dispute handling.
--   8. course_enrollments.enrollment_type preserves:
--      'purchase', 'installment', 'admin_grant', 'free'.
--   9. order_items.installment_plan_id and student_course_agreements.plan_id are 100% preserved.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1: Decouple RPCs from order_items.plan_id
-- ════════════════════════════════════════════════════════════════════════════

-- 1A. public.complete_google_play_purchase
-- Retains exact 18-parameter signature with p_plan_id DEFAULT NULL for Edge Function
-- compatibility, but excises all internal selects and inserts targeting order_items.plan_id.
CREATE OR REPLACE FUNCTION public.complete_google_play_purchase(
    p_profile_id uuid,
    p_institute_id uuid,
    p_student_id uuid,
    p_item_type text, -- 'course', 'subscription_plan', 'pyq_package'
    p_course_id uuid DEFAULT null,
    p_plan_id uuid DEFAULT null,
    p_package_id uuid DEFAULT null,
    p_item_name text DEFAULT 'Educational Product',
    p_unit_price numeric DEFAULT 0.00,
    p_effective_order_id text DEFAULT null,
    p_purchase_token text DEFAULT null,
    p_product_id text DEFAULT null,
    p_gateway_response jsonb DEFAULT null,
    p_transaction_timestamp timestamptz DEFAULT now(),
    p_subscription_end_date date DEFAULT null,
    p_is_auto_renew boolean DEFAULT true,
    p_billing_name text DEFAULT null,
    p_billing_email text DEFAULT null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role                 text;
  v_current_rtdn_attempts       integer := null;
  v_current_rtdn_status         text := null;
  v_existing_payment_id         uuid := null;
  v_existing_order_id           uuid := null;
  v_existing_payment_profile_id uuid := null;
  v_existing_gateway_payment_id text := null;
  v_existing_gateway_order_id   text := null;
  v_has_existing_payment        boolean := false;
  v_has_authoritative_order_id  boolean := false;
  v_token_payment_id            uuid := null;
  v_token_order_id              uuid := null;
  v_token_profile_id            uuid := null;
  v_token_gateway_payment_id    text := null;
  v_token_gateway_order_id      text := null;
  v_payment_id                  uuid := null;

  v_existing_item_id            uuid := null;
  v_existing_item_type          public.item_type := null;
  v_existing_item_course_id     uuid := null;
  v_existing_item_package_id    uuid := null;

  v_order_id                    uuid := null;
  v_item_id                     uuid := null;
  v_order_notes                 jsonb;
  v_student_id                  uuid := null;
  v_profile_role                public.user_role;
  v_profile_institute_id        uuid;
  v_resolved_institute_id       uuid;
  v_effective_course_id         uuid;

  v_course_course_id            uuid := null;
  v_course_institute_id         uuid := null;

  v_package_package_id          uuid := null;
  v_package_institute_id        uuid := null;

  v_enrollment_no               varchar(50);

  v_entitlement                 text := '';
  v_entitlement_active          boolean := false;
  v_skip_payment_insert         boolean := false;
  v_year                        text;
  v_invoice_num                 text;

  v_token_lock_key              bigint := null;
  v_order_lock_key              bigint := null;
  v_first_lock_key              bigint;
  v_second_lock_key             bigint;
BEGIN
  -- 0. Security Guard: Only service_role (Edge Function backend) may execute this RPC
  v_caller_role := auth.role();
  IF v_caller_role IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: complete_google_play_purchase requires service_role privileges',
      'code', 'FORBIDDEN'
    );
  END IF;

  -- Explicitly reject subscription_plan requests immediately before mutations or locking
  IF p_item_type = 'subscription_plan' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Subscription purchases are retired. Please purchase individual courses or PYQ packages.',
      'code', 'SUBSCRIPTIONS_RETIRED'
    );
  END IF;

  -- 1. Global Advisory Lock: Serialize concurrent verification requests sharing purchase token or order ID
  IF p_purchase_token IS NOT NULL AND p_purchase_token <> '' THEN
    v_token_lock_key := hashtext('google_play_token:' || p_purchase_token);
  END IF;

  IF p_effective_order_id IS NOT NULL AND p_effective_order_id <> '' THEN
    v_order_lock_key := hashtext('google_play_order:' || p_effective_order_id);
  END IF;

  IF v_token_lock_key IS NOT NULL AND v_order_lock_key IS NOT NULL THEN
    IF v_token_lock_key = v_order_lock_key THEN
      PERFORM pg_advisory_xact_lock(v_token_lock_key);
    ELSE
      v_first_lock_key := least(v_token_lock_key, v_order_lock_key);
      v_second_lock_key := greatest(v_token_lock_key, v_order_lock_key);
      PERFORM pg_advisory_xact_lock(v_first_lock_key);
      PERFORM pg_advisory_xact_lock(v_second_lock_key);
    END IF;
  ELSIF v_token_lock_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(v_token_lock_key);
  ELSIF v_order_lock_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(v_order_lock_key);
  END IF;

  -- 1b. Durable RTDN Event Ledger Ownership Verification
  IF p_gateway_response IS NOT NULL AND (p_gateway_response->>'rtdn_event_id') IS NOT NULL AND COALESCE(p_gateway_response->>'defer_rtdn_completion', 'false') != 'true' THEN
    SELECT attempts, processing_status
    INTO v_current_rtdn_attempts, v_current_rtdn_status
    FROM public.google_play_rtdn_events
    WHERE event_id = (p_gateway_response->>'rtdn_event_id')::uuid
    FOR UPDATE;

    IF NOT FOUND OR v_current_rtdn_attempts != (p_gateway_response->>'rtdn_attempt')::integer OR v_current_rtdn_status != 'processing' THEN
      RETURN jsonb_build_object(
        'success', false,
        'action', 'abort_stale_worker',
        'error', 'STALE_LEASE_LOST: RTDN event lease ownership was lost to another worker',
        'code', 'STALE_LEASE_LOST'
      );
    END IF;
  END IF;

  -- 2. Validate Profile Existence and Lock Profile Row
  SELECT p.role, p.institute_id
  INTO v_profile_role, v_profile_institute_id
  FROM public.profiles p
  WHERE p.profile_id = p_profile_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User profile not found for profile_id ' || COALESCE(p_profile_id::text, 'null'),
      'code', 'PROFILE_NOT_FOUND'
    );
  END IF;

  -- 3. Staff Role Protection
  IF v_profile_role::text NOT IN ('user', 'student')
     OR EXISTS (
       SELECT 1
       FROM public.admin_roles ar
       WHERE ar.profile_id = p_profile_id
         AND ar.access_status = 'approved'::public.admin_access_status
     )
     OR EXISTS (
       SELECT 1
       FROM public.teacher_details td
       WHERE td.profile_id = p_profile_id
     ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Profile role ''' || v_profile_role::text || ''' is not eligible for student checkout. Staff accounts cannot be converted to students.',
      'code', 'FORBIDDEN_ROLE'
    );
  END IF;

  -- 4. Multi-Tenant Institute Validation
  IF p_institute_id IS NOT NULL AND v_profile_institute_id IS NOT NULL AND p_institute_id <> v_profile_institute_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Institute mismatch: requested institute does not match profile institute.',
      'code', 'INSTITUTE_MISMATCH'
    );
  END IF;
  v_resolved_institute_id := COALESCE(v_profile_institute_id, p_institute_id);

  -- 5. Product & Association Integrity Validation BEFORE Mutations
  v_effective_course_id := p_course_id;

  IF p_item_type = 'course' THEN
    IF v_effective_course_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'p_course_id is required for course purchase.',
        'code', 'INVALID_PURCHASE_PAYLOAD'
      );
    END IF;

    SELECT c.course_id, c.institute_id
    INTO v_course_course_id, v_course_institute_id
    FROM public.courses c
    WHERE c.course_id = v_effective_course_id;

    IF v_course_course_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Course not found for course_id ' || v_effective_course_id::text,
        'code', 'COURSE_NOT_FOUND'
      );
    END IF;

    IF v_resolved_institute_id IS NULL OR v_course_institute_id IS NULL OR v_course_institute_id <> v_resolved_institute_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Course does not belong to the user''s institute.',
        'code', 'INSTITUTE_MISMATCH'
      );
    END IF;

  ELSIF p_item_type = 'pyq_package' THEN
    IF p_package_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'p_package_id is required for pyq_package purchase.',
        'code', 'INVALID_PURCHASE_PAYLOAD'
      );
    END IF;

    SELECT pp.package_id, pp.institute_id
    INTO v_package_package_id, v_package_institute_id
    FROM public.pyq_packages pp
    WHERE pp.package_id = p_package_id;

    IF v_package_package_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'PYQ package not found for package_id ' || p_package_id::text,
        'code', 'PACKAGE_NOT_FOUND'
      );
    END IF;

    IF v_resolved_institute_id IS NULL OR v_package_institute_id IS NULL OR v_package_institute_id <> v_resolved_institute_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'PYQ package does not belong to the user''s institute.',
        'code', 'INSTITUTE_MISMATCH'
      );
    END IF;
  ELSE
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid item_type ''' || COALESCE(p_item_type, 'null') || '''. Must be course or pyq_package.',
      'code', 'INVALID_ITEM_TYPE'
    );
  END IF;

  -- 6. Defensively resolve existing student_details record strictly scoped to p_profile_id
  SELECT sd.student_id INTO v_student_id
  FROM public.student_details sd
  WHERE sd.profile_id = p_profile_id;

  IF p_student_id IS NOT NULL THEN
    IF v_student_id IS NOT NULL AND v_student_id <> p_student_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Supplied student_id does not match the profile''s existing student record.',
        'code', 'STUDENT_PROFILE_MISMATCH'
      );
    ELSIF v_student_id IS NULL THEN
      IF EXISTS (SELECT 1 FROM public.student_details sd WHERE sd.student_id = p_student_id AND sd.profile_id <> p_profile_id) THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'Supplied student_id belongs to a different user account.',
          'code', 'STUDENT_PROFILE_MISMATCH'
        );
      END IF;
    END IF;
  END IF;

  -- 7. Idempotency Check (Token & External Order ID)
  v_has_authoritative_order_id := (
    p_effective_order_id IS NOT NULL
    AND btrim(p_effective_order_id) <> ''
  );

  SELECT p.payment_id, p.order_id, o.profile_id, p.gateway_payment_id, p.gateway_order_id
  INTO v_token_payment_id, v_token_order_id, v_token_profile_id, v_token_gateway_payment_id, v_token_gateway_order_id
  FROM public.payments p
  JOIN public.orders o ON o.order_id = p.order_id
  WHERE p.gateway = 'google_play'
    AND p.status = 'captured'
    AND p_purchase_token IS NOT NULL
    AND (
      (p.gateway_response ->> 'purchaseToken') = p_purchase_token
      OR substring(o.notes FROM '"purchaseToken"[[:space:]]*:[[:space:]]*"([^"]+)"') = p_purchase_token
    )
  ORDER BY p.created_at DESC
  LIMIT 1;

  IF v_token_payment_id IS NOT NULL AND v_token_profile_id <> p_profile_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'This purchase has already been claimed by another account. Please sign in with the original account or contact support.',
      'code', 'ACCOUNT_MISMATCH'
    );
  END IF;

  IF v_has_authoritative_order_id THEN
    SELECT p.payment_id, p.order_id, o.profile_id, p.gateway_payment_id, p.gateway_order_id
    INTO v_existing_payment_id, v_existing_order_id, v_existing_payment_profile_id, v_existing_gateway_payment_id, v_existing_gateway_order_id
    FROM public.payments p
    JOIN public.orders o ON o.order_id = p.order_id
    WHERE p.gateway = 'google_play'
      AND p.status = 'captured'
      AND (p.gateway_payment_id = p_effective_order_id OR p.gateway_order_id = p_effective_order_id)
    ORDER BY p.created_at DESC
    LIMIT 1;

    IF v_existing_payment_id IS NOT NULL AND v_existing_payment_profile_id <> p_profile_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'This purchase has already been claimed by another account. Please sign in with the original account or contact support.',
        'code', 'ACCOUNT_MISMATCH'
      );
    END IF;
  END IF;

  -- One-shot idempotency for course / package purchases: token match or order ID match is authoritative
  IF v_existing_payment_id IS NULL AND v_token_payment_id IS NOT NULL THEN
    v_existing_payment_id := v_token_payment_id;
    v_existing_order_id := v_token_order_id;
    v_existing_payment_profile_id := v_token_profile_id;
  END IF;

  v_has_existing_payment := (v_existing_payment_id IS NOT NULL);

  IF v_has_existing_payment THEN
    -- Load existing order item to verify consistency (decoupled from order_items.plan_id)
    SELECT oi.item_id, oi.item_type, oi.course_id, oi.package_id
    INTO v_existing_item_id, v_existing_item_type, v_existing_item_course_id, v_existing_item_package_id
    FROM public.order_items oi
    WHERE oi.order_id = v_existing_order_id
    LIMIT 1;

    IF v_existing_item_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Existing payment has no associated order items. Failing closed to prevent inconsistent order state.',
        'code', 'ORDER_ITEM_MISSING_FOR_CAPTURED_PAYMENT',
        'orderId', v_existing_order_id
      );
    END IF;

    IF v_existing_item_type::text <> p_item_type THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Existing order item type (' || v_existing_item_type::text || ') does not match purchase item type (' || p_item_type || ').',
        'code', 'ORDER_ITEM_MISMATCH',
        'orderId', v_existing_order_id
      );
    END IF;

    IF p_item_type = 'course' THEN
      IF v_existing_item_course_id IS DISTINCT FROM v_effective_course_id THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'Existing order item course_id does not match purchase course_id.',
          'code', 'ORDER_ITEM_MISMATCH',
          'orderId', v_existing_order_id
        );
      END IF;
    ELSIF p_item_type = 'pyq_package' THEN
      IF v_existing_item_package_id IS DISTINCT FROM p_package_id THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'Existing order item package_id does not match purchase package_id.',
          'code', 'ORDER_ITEM_MISMATCH',
          'orderId', v_existing_order_id
        );
      END IF;
    END IF;

    -- Check if entitlement is currently active for this student
    v_entitlement_active := false;
    IF v_student_id IS NOT NULL THEN
      IF p_item_type = 'course' THEN
        SELECT EXISTS (
          SELECT 1 FROM public.course_enrollments
          WHERE course_id = v_effective_course_id
            AND student_id = v_student_id
            AND is_active = true
        ) INTO v_entitlement_active;
      ELSIF p_item_type = 'pyq_package' THEN
        SELECT EXISTS (
          SELECT 1 FROM public.student_pyq_purchases
          WHERE package_id = p_package_id
            AND student_id = v_student_id
            AND is_active = true
        ) INTO v_entitlement_active;
      END IF;
    END IF;

    IF v_entitlement_active THEN
      IF v_profile_role::text = 'user' THEN
        UPDATE public.profiles
        SET role = 'student'::public.user_role,
            updated_at = p_transaction_timestamp
        WHERE profile_id = p_profile_id;
        v_profile_role := 'student'::public.user_role;
      END IF;

      IF p_gateway_response IS NOT NULL AND (p_gateway_response->>'rtdn_event_id') IS NOT NULL AND COALESCE(p_gateway_response->>'defer_rtdn_completion', 'false') != 'true' THEN
        UPDATE public.google_play_rtdn_events
        SET processing_status = 'completed',
            order_id = p_effective_order_id,
            cycle_index = COALESCE(substring(p_effective_order_id FROM '\.\.([0-9]+)')::integer, 0),
            processed_at = clock_timestamp(),
            error_message = null
        WHERE event_id = (p_gateway_response->>'rtdn_event_id')::uuid
          AND attempts = v_current_rtdn_attempts;
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'verified', true,
        'outcome', 'already_recorded',
        'alreadyProcessed', true,
        'paymentId', v_existing_payment_id,
        'orderId', v_existing_order_id,
        'cycleIndex', -1,
        'rtdn_completed', (p_gateway_response IS NOT NULL AND (p_gateway_response->>'rtdn_event_id') IS NOT NULL),
        'message', 'Purchase already processed and entitlement active'
      );
    END IF;

    -- Entitlement is missing/inactive despite captured payment.
    -- Safely remediate: reuse existing order and item, skip duplicate payment insert,
    -- and proceed to ensure student role/details and grant the missing entitlement.
    v_order_id := v_existing_order_id;
    v_item_id := v_existing_item_id;
    v_skip_payment_insert := true;
  END IF;

  -- 8. Check for existing unfulfilled order with this purchaseToken / orderId
  IF v_order_id IS NULL THEN
    SELECT o.order_id
    INTO v_order_id
    FROM public.orders o
    WHERE o.profile_id = p_profile_id
      AND (
        (p_effective_order_id IS NOT NULL AND substring(o.notes FROM '"orderId"[[:space:]]*:[[:space:]]*"([^"]+)"') = p_effective_order_id)
        OR (p_purchase_token IS NOT NULL AND substring(o.notes FROM '"purchaseToken"[[:space:]]*:[[:space:]]*"([^"]+)"') = p_purchase_token)
      )
    LIMIT 1;

    IF v_order_id IS NOT NULL THEN
      SELECT oi.item_id, oi.item_type, oi.course_id, oi.package_id
      INTO v_existing_item_id, v_existing_item_type, v_existing_item_course_id, v_existing_item_package_id
      FROM public.order_items oi
      WHERE oi.order_id = v_order_id
      LIMIT 1;

      IF v_existing_item_id IS NULL THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'Existing order found for this purchase token but it has no associated order items. Failing closed to prevent partial order processing.',
          'code', 'ORDER_ITEM_MISSING_FOR_EXISTING_ORDER',
          'orderId', v_order_id
        );
      END IF;

      IF v_existing_item_type::text <> p_item_type THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'Existing order item type (' || v_existing_item_type::text || ') does not match purchase item type (' || p_item_type || ').',
          'code', 'ORDER_ITEM_MISMATCH',
          'orderId', v_order_id
        );
      END IF;

      IF p_item_type = 'course' THEN
        IF v_existing_item_course_id IS DISTINCT FROM v_effective_course_id THEN
          RETURN jsonb_build_object(
            'success', false,
            'error', 'Existing order item course_id does not match purchase course_id.',
            'code', 'ORDER_ITEM_MISMATCH',
            'orderId', v_order_id
          );
        END IF;
      ELSIF p_item_type = 'pyq_package' THEN
        IF v_existing_item_package_id IS DISTINCT FROM p_package_id THEN
          RETURN jsonb_build_object(
            'success', false,
            'error', 'Existing order item package_id does not match purchase package_id.',
            'code', 'ORDER_ITEM_MISMATCH',
            'orderId', v_order_id
          );
        END IF;
      END IF;

      v_item_id := v_existing_item_id;
    END IF;
  END IF;

  -- 9. Atomic Role Transition: Promote role = 'user' to 'student'
  IF v_profile_role::text = 'user' THEN
    UPDATE public.profiles
    SET role = 'student'::public.user_role,
        updated_at = p_transaction_timestamp
    WHERE profile_id = p_profile_id;
    v_profile_role := 'student'::public.user_role;
  END IF;

  -- 10. Student Details Resolution & Initialization
  IF v_student_id IS NULL THEN
    BEGIN
      v_enrollment_no := public.generate_enrollment_number(v_resolved_institute_id);
    EXCEPTION WHEN OTHERS THEN
      v_enrollment_no := 'ENR-' || to_char(current_date, 'YYYY') || '-' || lpad(floor(random() * 900000 + 100000)::text, 6, '0');
    END;

    INSERT INTO public.student_details (
      profile_id,
      institute_id,
      enrollment_no,
      enrolled_on,
      created_at,
      updated_at
    ) VALUES (
      p_profile_id,
      v_resolved_institute_id,
      v_enrollment_no,
      (p_transaction_timestamp AT TIME ZONE 'utc')::date,
      p_transaction_timestamp,
      p_transaction_timestamp
    )
    ON CONFLICT (profile_id) DO UPDATE
      SET updated_at = p_transaction_timestamp
    RETURNING student_id INTO v_student_id;
  END IF;

  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'Failed to resolve or initialize student_details for profile %', p_profile_id;
  END IF;

  -- 11. Build structured order notes with correlation metadata
  v_order_notes := jsonb_build_object(
    'gateway', 'google_play',
    'purchaseToken', p_purchase_token,
    'orderId', p_effective_order_id,
    'productId', p_product_id,
    'itemType', p_item_type,
    'courseId', v_effective_course_id,
    'packageId', p_package_id
  );

  -- 12. Insert Order and Order Item if new (decoupled from order_items.plan_id)
  IF v_order_id IS NULL THEN
    INSERT INTO public.orders (
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
    ) VALUES (
      v_resolved_institute_id,
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
    RETURNING order_id INTO v_order_id;

    INSERT INTO public.order_items (
      order_id,
      institute_id,
      item_type,
      course_id,
      package_id,
      item_name,
      unit_price,
      quantity,
      discount_amount,
      line_total,
      created_at
    ) VALUES (
      v_order_id,
      v_resolved_institute_id,
      p_item_type::public.item_type,
      v_effective_course_id,
      p_package_id,
      p_item_name,
      p_unit_price,
      1,
      0.00,
      p_unit_price,
      p_transaction_timestamp
    )
    RETURNING item_id INTO v_item_id;
  END IF;

  -- 13. Insert Payment record (unless skipped during remediation)
  IF NOT v_skip_payment_insert THEN
    INSERT INTO public.payments (
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
    ) VALUES (
      v_order_id,
      v_resolved_institute_id,
      1,
      'google_play'::public.payment_gateway,
      p_effective_order_id,
      p_effective_order_id,
      CASE
        WHEN jsonb_typeof(p_gateway_response) = 'object' THEN
          p_gateway_response || jsonb_build_object('purchaseToken', p_purchase_token)
        ELSE
          jsonb_build_object('purchaseToken', p_purchase_token, 'verified', true)
      END,
      p_unit_price,
      'INR'::public.currency_code,
      'captured'::public.payment_status,
      p_transaction_timestamp,
      p_transaction_timestamp,
      p_transaction_timestamp
    )
    RETURNING payment_id INTO v_payment_id;
  END IF;

  -- 14. Grant One-Time Entitlement
  IF p_item_type = 'course' AND v_effective_course_id IS NOT NULL THEN
    INSERT INTO public.course_enrollments (
      course_id,
      student_id,
      institute_id,
      order_item_id,
      enrollment_type,
      is_active,
      enrolled_at,
      revoked_at,
      revoked_reason
    ) VALUES (
      v_effective_course_id,
      v_student_id,
      v_resolved_institute_id,
      v_item_id,
      'purchase',
      true,
      p_transaction_timestamp,
      null,
      null
    )
    ON CONFLICT (course_id, student_id)
    DO UPDATE SET
      is_active = true,
      enrollment_type = 'purchase',
      order_item_id = COALESCE(excluded.order_item_id, course_enrollments.order_item_id),
      revoked_at = null,
      revoked_reason = null;

    v_entitlement := 'course_enrollment:' || v_effective_course_id::text;

  ELSIF p_item_type = 'pyq_package' AND p_package_id IS NOT NULL THEN
    INSERT INTO public.student_pyq_purchases (
      package_id,
      student_id,
      institute_id,
      order_item_id,
      access_type,
      is_active,
      purchased_at,
      created_at,
      updated_at
    ) VALUES (
      p_package_id,
      v_student_id,
      v_resolved_institute_id,
      v_item_id,
      'lifetime',
      true,
      p_transaction_timestamp,
      p_transaction_timestamp,
      p_transaction_timestamp
    )
    ON CONFLICT (package_id, student_id)
    DO UPDATE SET
      is_active = true,
      updated_at = p_transaction_timestamp;

    v_entitlement := 'pyq_package:' || p_package_id::text;
  END IF;

  -- 15. Snapshot draft invoice (non-blocking accounting artifact)
  BEGIN
    v_year := to_char(p_transaction_timestamp, 'YYYY');
    v_invoice_num := 'INV-' || v_year || '-' || upper(substr(replace(v_order_id::text, '-', ''), 1, 8));

    INSERT INTO public.invoices (
      order_id,
      institute_id,
      invoice_number,
      status,
      issued_at,
      subtotal_amount,
      discount_amount,
      tax_amount,
      total_amount,
      currency,
      billing_name,
      billing_email,
      created_at,
      updated_at
    ) VALUES (
      v_order_id,
      v_resolved_institute_id,
      v_invoice_num,
      'draft',
      p_transaction_timestamp,
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
    ON CONFLICT (order_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- RTDN Completion
  IF p_gateway_response IS NOT NULL AND (p_gateway_response->>'rtdn_event_id') IS NOT NULL AND COALESCE(p_gateway_response->>'defer_rtdn_completion', 'false') != 'true' THEN
    UPDATE public.google_play_rtdn_events
    SET processing_status = 'completed',
        order_id = p_effective_order_id,
        cycle_index = COALESCE(substring(p_effective_order_id FROM '\.\.([0-9]+)')::integer, 0),
        processed_at = clock_timestamp(),
        error_message = null
    WHERE event_id = (p_gateway_response->>'rtdn_event_id')::uuid
      AND attempts = v_current_rtdn_attempts;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'verified', true,
    'outcome', CASE WHEN v_skip_payment_insert THEN 'already_recorded' ELSE 'purchase_recorded' END,
    'alreadyProcessed', v_skip_payment_insert,
    'paymentId', COALESCE(v_payment_id, v_existing_payment_id),
    'orderId', v_order_id,
    'cycleIndex', -1,
    'entitlement', v_entitlement,
    'message', CASE
                 WHEN v_skip_payment_insert THEN 'Existing captured payment reused; entitlement repaired without a new payment'
                 ELSE 'Google Play one-time purchase processed atomically'
               END
  );
END;
$$;

COMMENT ON FUNCTION public.complete_google_play_purchase(
  uuid, uuid, uuid, text, uuid, uuid, uuid, text, numeric, text, text, text, jsonb, timestamptz, date, boolean, text, text
) IS 'Authoritative atomic handler for one-time course and PYQ Google Play purchases (decoupled from order_items.plan_id in Migration 245).';

REVOKE ALL ON FUNCTION public.complete_google_play_purchase(
  uuid, uuid, uuid, text, uuid, uuid, uuid, text, numeric, text, text, text, jsonb, timestamptz, date, boolean, text, text
) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.complete_google_play_purchase(
  uuid, uuid, uuid, text, uuid, uuid, uuid, text, numeric, text, text, text, jsonb, timestamptz, date, boolean, text, text
) TO service_role;


-- 1B. public.fulfill_standard_subscription_order
-- Retired subscription fulfillment RPC. Explicitly disabled and made fail-closed in Migration 245.
CREATE OR REPLACE FUNCTION public.fulfill_standard_subscription_order(
  p_order_id            uuid,
  p_plan_id             uuid,
  p_profile_id          uuid,
  p_guardian_name       text default null,
  p_guardian_mobile     text default null,
  p_guardian_email      text default null,
  p_target_year         text default null,
  p_dob                 date default null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN jsonb_build_object(
    'success', false,
    'error', 'Subscription purchases and fulfillments are retired.',
    'code', 'SUBSCRIPTIONS_RETIRED'
  );
END;
$$;

COMMENT ON FUNCTION public.fulfill_standard_subscription_order IS
  'Retired subscription fulfillment RPC. Explicitly disabled in Migration 245.';

REVOKE ALL ON FUNCTION public.fulfill_standard_subscription_order(
  uuid, uuid, uuid, text, text, text, text, date
) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fulfill_standard_subscription_order(
  uuid, uuid, uuid, text, text, text, text, date
) TO service_role;


-- 1C. public.revoke_standard_order_entitlements
-- Decoupled from order_items.plan_id and obsolete subscription reversal loops.
CREATE OR REPLACE FUNCTION public.revoke_standard_order_entitlements(
  p_order_id            uuid,
  p_reason              text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_role                 text;
  v_target_order                record;
  v_course_id                   uuid;
  v_package_id                  uuid;
  v_has_other_course            boolean;
  v_other_item_id               uuid;
  v_has_other_pyq               boolean;
  v_has_non_purchase_source     boolean;
BEGIN
  -- 1. Security Authorization Check (Strict Fail-Closed)
  v_caller_role := auth.role();
  IF coalesce(v_caller_role, '') <> 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED: service_role required';
  END IF;

  IF p_order_id IS NULL THEN
    RETURN;
  END IF;

  SELECT order_id, student_id, institute_id, status
  INTO v_target_order
  FROM public.orders
  WHERE order_id = p_order_id;

  IF v_target_order.order_id IS NULL OR v_target_order.student_id IS NULL THEN
    RETURN;
  END IF;

  -- ═════════════════════════════════════════════════════════════════════
  -- SECTION 1: Course Entitlement Reversal
  -- ═════════════════════════════════════════════════════════════════════
  FOR v_course_id IN
    SELECT DISTINCT coalesce(oi.course_id, ce.course_id)
    FROM public.order_items oi
    LEFT JOIN public.course_enrollments ce ON ce.order_item_id = oi.item_id
    WHERE oi.order_id = p_order_id
      AND coalesce(oi.course_id, ce.course_id) IS NOT NULL
  LOOP
    -- Check if student has ANY OTHER confirmed, non-refunded purchase order for this course
    SELECT exists (
      SELECT 1
      FROM public.order_items oi2
      JOIN public.orders o2 ON o2.order_id = oi2.order_id
      JOIN public.payments p2 ON p2.order_id = o2.order_id
      WHERE o2.student_id = v_target_order.student_id
        AND o2.order_id <> p_order_id
        AND o2.status = 'confirmed'::public.order_status
        AND o2.fulfillment_status = 'fulfilled'
        AND oi2.course_id = v_course_id
        AND p2.status IN ('captured'::public.payment_status, 'partially_refunded'::public.payment_status)
    ) INTO v_has_other_course;

    SELECT coalesce(bool_or(ce.enrollment_type IN ('admin_grant', 'free', 'installment')), false)
    INTO v_has_non_purchase_source
    FROM public.course_enrollments ce
    WHERE ce.course_id = v_course_id
      AND ce.student_id = v_target_order.student_id
      AND ce.is_active = true;

    IF v_has_other_course OR v_has_non_purchase_source THEN
      -- Preserve access: at least one entitlement source independent of this order survives.
      IF v_has_other_course THEN
        SELECT oi2.item_id INTO v_other_item_id
        FROM public.order_items oi2
        JOIN public.orders o2 ON o2.order_id = oi2.order_id
        JOIN public.payments p2 ON p2.order_id = o2.order_id
        WHERE o2.student_id = v_target_order.student_id
          AND o2.order_id <> p_order_id
          AND o2.status = 'confirmed'::public.order_status
          AND o2.fulfillment_status = 'fulfilled'
          AND oi2.course_id = v_course_id
          AND p2.status IN ('captured'::public.payment_status, 'partially_refunded'::public.payment_status)
        ORDER BY o2.created_at DESC
        LIMIT 1;
      ELSE
        v_other_item_id := null;
      END IF;

      UPDATE public.course_enrollments ce
      SET order_item_id = coalesce(v_other_item_id, ce.order_item_id),
          is_active = true,
          revoked_at = null,
          revoked_reason = null,
          revoked_by = null,
          updated_at = now()
      WHERE ce.course_id = v_course_id
        AND ce.student_id = v_target_order.student_id;
    ELSE
      -- No surviving source: revoke only that which this order conferred.
      UPDATE public.course_enrollments
      SET is_active = false,
          revoked_at = coalesce(revoked_at, now()),
          revoked_reason = p_reason,
          updated_at = now()
      WHERE course_id = v_course_id
        AND student_id = v_target_order.student_id
        AND is_active = true;
    END IF;
  END LOOP;

  -- ═════════════════════════════════════════════════════════════════════
  -- SECTION 2: PYQ Package Entitlement Reversal
  -- ═════════════════════════════════════════════════════════════════════
  FOR v_package_id IN
    SELECT DISTINCT coalesce(oi.package_id, spp.package_id)
    FROM public.order_items oi
    LEFT JOIN public.student_pyq_purchases spp ON spp.order_item_id = oi.item_id
    WHERE oi.order_id = p_order_id
      AND coalesce(oi.package_id, spp.package_id) IS NOT NULL
  LOOP
    SELECT exists (
      SELECT 1
      FROM public.order_items oi2
      JOIN public.orders o2 ON o2.order_id = oi2.order_id
      JOIN public.payments p2 ON p2.order_id = o2.order_id
      WHERE o2.student_id = v_target_order.student_id
        AND o2.order_id <> p_order_id
        AND o2.status = 'confirmed'::public.order_status
        AND o2.fulfillment_status = 'fulfilled'
        AND oi2.package_id = v_package_id
        AND p2.status IN ('captured'::public.payment_status, 'partially_refunded'::public.payment_status)
    ) INTO v_has_other_pyq;

    IF v_has_other_pyq THEN
      SELECT oi2.item_id INTO v_other_item_id
      FROM public.order_items oi2
      JOIN public.orders o2 ON o2.order_id = oi2.order_id
      JOIN public.payments p2 ON p2.order_id = o2.order_id
      WHERE o2.student_id = v_target_order.student_id
        AND o2.order_id <> p_order_id
        AND o2.status = 'confirmed'::public.order_status
        AND o2.fulfillment_status = 'fulfilled'
        AND oi2.package_id = v_package_id
        AND p2.status IN ('captured'::public.payment_status, 'partially_refunded'::public.payment_status)
      ORDER BY o2.created_at DESC
      LIMIT 1;

      UPDATE public.student_pyq_purchases spp
      SET order_item_id = coalesce(v_other_item_id, spp.order_item_id),
          is_active = true,
          revoked_at = null,
          revoked_reason = null,
          updated_at = now()
      WHERE spp.package_id = v_package_id
        AND spp.student_id = v_target_order.student_id;
    ELSE
      UPDATE public.student_pyq_purchases
      SET is_active = false,
          revoked_at = coalesce(revoked_at, now()),
          revoked_reason = p_reason,
          updated_at = now()
      WHERE package_id = v_package_id
        AND student_id = v_target_order.student_id
        AND is_active = true;
    END IF;
  END LOOP;

  -- ═════════════════════════════════════════════════════════════════════
  -- SECTION 3: Revoke Entitlement Grants for this Order
  -- ═════════════════════════════════════════════════════════════════════
  UPDATE public.order_entitlement_grants
  SET revoked_at = now(),
      revoked_reason = p_reason
  WHERE order_id = p_order_id
    AND revoked_at IS NULL;
END;
$$;

COMMENT ON FUNCTION public.revoke_standard_order_entitlements IS
  'Transactional helper for reversing course and PYQ entitlements on refunded orders (decoupled from subscriptions in Migration 245).';

REVOKE ALL ON FUNCTION public.revoke_standard_order_entitlements(uuid, text)
FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.revoke_standard_order_entitlements(uuid, text)
TO service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2: Update Check Constraint on public.order_items
-- ════════════════════════════════════════════════════════════════════════════
-- Replaces ck_order_items_item_type_consistency to enforce polymorphic consistency
-- exclusively across 'course', 'pyq_package', and 'installment'.
-- The legacy 'subscription_plan' type is disallowed from being stored in order_items.

ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS ck_order_items_item_type_consistency;

ALTER TABLE public.order_items
  ADD CONSTRAINT ck_order_items_item_type_consistency CHECK (
    (item_type = 'course' AND course_id IS NOT NULL AND package_id IS NULL AND installment_plan_id IS NULL AND agreement_id IS NULL) OR
    (item_type = 'pyq_package' AND package_id IS NOT NULL AND course_id IS NULL AND installment_plan_id IS NULL AND agreement_id IS NULL) OR
    (item_type = 'installment' AND installment_plan_id IS NOT NULL AND course_id IS NOT NULL AND package_id IS NULL)
  );

COMMENT ON CONSTRAINT ck_order_items_item_type_consistency ON public.order_items IS
  'Enforces polymorphic foreign-key consistency across course, pyq_package, and installment items. Subscription items retired in Migration 245.';


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3: Drop Foreign Key and Indexes on public.order_items
-- ════════════════════════════════════════════════════════════════════════════

-- Drop foreign key constraint referencing public.subscription_plans
ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS fk_order_items_plan;

-- Drop obsolete partial indexes referencing plan_id
DROP INDEX IF EXISTS public.idx_order_items_institute_plan;
DROP INDEX IF EXISTS public.idx_order_items_order_plan;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4: Drop Column plan_id from public.order_items
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.order_items
  DROP COLUMN IF EXISTS plan_id;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5: Update Check Constraint on public.course_enrollments
-- ════════════════════════════════════════════════════════════════════════════
-- Updates permitted enrollment_type values:
-- Retains: 'purchase', 'admin_grant', 'free', 'installment'.
-- Removes: 'subscription'.

ALTER TABLE public.course_enrollments
  DROP CONSTRAINT IF EXISTS ck_course_enrollments_enrollment_type;

ALTER TABLE public.course_enrollments
  ADD CONSTRAINT ck_course_enrollments_enrollment_type
  CHECK (enrollment_type IN ('purchase', 'admin_grant', 'free', 'installment'));

COMMENT ON CONSTRAINT ck_course_enrollments_enrollment_type ON public.course_enrollments IS
  'Permitted course enrollment types: purchase (permanent full ownership), admin_grant (manual grant), free (free enrollment), and installment (active installment agreement). Legacy subscription enrollment type retired in Migration 245.';


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6: Update Check Constraint on public.order_entitlement_grants
-- ════════════════════════════════════════════════════════════════════════════
-- Explicitly drops the obsolete check constraint on entitlement_type
-- (order_entitlement_grants_entitlement_type_check) while preserving unrelated
-- constraints such as order_entitlement_grants_grant_type_check.
-- Enforces that order_entitlement_grants only allows 'course' and 'pyq'.

ALTER TABLE public.order_entitlement_grants
  DROP CONSTRAINT IF EXISTS order_entitlement_grants_entitlement_type_check,
  DROP CONSTRAINT IF EXISTS ck_order_entitlement_grants_type;

ALTER TABLE public.order_entitlement_grants
  ADD CONSTRAINT ck_order_entitlement_grants_type
  CHECK (entitlement_type IN ('course', 'pyq'));

COMMENT ON CONSTRAINT ck_order_entitlement_grants_type ON public.order_entitlement_grants IS
  'Permitted entitlement types: course and pyq. Subscription entitlement type retired in Migration 245.';


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 7: Post-Migration Automated Verification Assertions
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_col_exists boolean;
  v_fk_exists boolean;
  v_idx_inst_plan_exists boolean;
  v_idx_ord_plan_exists boolean;
  v_sub_order_items integer;
  v_sub_enrollments integer;
  v_sub_grants integer;
  v_installment_orders integer;
BEGIN
  -- 1. Assert column order_items.plan_id no longer exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'order_items'
      AND column_name = 'plan_id'
  ) INTO v_col_exists;

  IF v_col_exists THEN
    RAISE EXCEPTION 'POST-MIGRATION VERIFICATION FAILED: Column public.order_items.plan_id still exists!';
  END IF;

  -- 2. Assert foreign key fk_order_items_plan no longer exists
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_order_items_plan'
  ) INTO v_fk_exists;

  IF v_fk_exists THEN
    RAISE EXCEPTION 'POST-MIGRATION VERIFICATION FAILED: Foreign key fk_order_items_plan still exists!';
  END IF;

  -- 3. Assert indexes referencing plan_id no longer exist
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'order_items'
      AND indexname = 'idx_order_items_institute_plan'
  ) INTO v_idx_inst_plan_exists;

  IF v_idx_inst_plan_exists THEN
    RAISE EXCEPTION 'POST-MIGRATION VERIFICATION FAILED: Index idx_order_items_institute_plan still exists!';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'order_items'
      AND indexname = 'idx_order_items_order_plan'
  ) INTO v_idx_ord_plan_exists;

  IF v_idx_ord_plan_exists THEN
    RAISE EXCEPTION 'POST-MIGRATION VERIFICATION FAILED: Index idx_order_items_order_plan still exists!';
  END IF;

  -- 4. Assert zero subscription items exist in order_items
  SELECT count(*) INTO v_sub_order_items
  FROM public.order_items
  WHERE item_type = 'subscription_plan';

  IF v_sub_order_items > 0 THEN
    RAISE EXCEPTION 'POST-MIGRATION VERIFICATION FAILED: % subscription_plan items found in order_items!', v_sub_order_items;
  END IF;

  -- 5. Assert zero legacy subscription enrollments exist
  SELECT count(*) INTO v_sub_enrollments
  FROM public.course_enrollments
  WHERE enrollment_type = 'subscription';

  IF v_sub_enrollments > 0 THEN
    RAISE EXCEPTION 'POST-MIGRATION VERIFICATION FAILED: % subscription course enrollments found!', v_sub_enrollments;
  END IF;

  -- 6. Assert zero subscription entitlement grants exist
  SELECT count(*) INTO v_sub_grants
  FROM public.order_entitlement_grants
  WHERE entitlement_type = 'subscription';

  IF v_sub_grants > 0 THEN
    RAISE EXCEPTION 'POST-MIGRATION VERIFICATION FAILED: % subscription entitlement grants found!', v_sub_grants;
  END IF;

  -- 7. Assert unrelated grant_type check constraint on order_entitlement_grants is preserved
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.order_entitlement_grants'::regclass
      AND conname = 'order_entitlement_grants_grant_type_check'
  ) THEN
    RAISE EXCEPTION 'POST-MIGRATION VERIFICATION FAILED: Unrelated constraint order_entitlement_grants_grant_type_check was unexpectedly removed!';
  END IF;

  -- 8. Assert protected installment orders baseline is preserved (>= 17)
  SELECT count(DISTINCT o.order_id) INTO v_installment_orders
  FROM public.orders o
  JOIN public.order_items oi ON oi.order_id = o.order_id
  WHERE oi.item_type = 'installment';

  IF v_installment_orders < 17 THEN
    RAISE EXCEPTION 'POST-MIGRATION VERIFICATION FAILED: Installment orders baseline compromised! Found % (expected >= 17)', v_installment_orders;
  END IF;

  -- 9. Assert order_items.installment_plan_id column exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'order_items'
      AND column_name = 'installment_plan_id'
  ) THEN
    RAISE EXCEPTION 'POST-MIGRATION VERIFICATION FAILED: Column public.order_items.installment_plan_id missing!';
  END IF;

  -- 10. Assert student_course_agreements.plan_id column exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'student_course_agreements'
      AND column_name = 'plan_id'
  ) THEN
    RAISE EXCEPTION 'POST-MIGRATION VERIFICATION FAILED: Column public.student_course_agreements.plan_id missing!';
  END IF;

  -- 11. Assert exact foreign key: order_items.installment_plan_id -> course_installment_plans.plan_id
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute src
      ON src.attrelid = c.conrelid
     AND src.attnum = c.conkey[1]
    JOIN pg_attribute dst
      ON dst.attrelid = c.confrelid
     AND dst.attnum = c.confkey[1]
    WHERE c.conrelid = 'public.order_items'::regclass
      AND c.confrelid = 'public.course_installment_plans'::regclass
      AND c.contype = 'f'
      AND cardinality(c.conkey) = 1
      AND cardinality(c.confkey) = 1
      AND src.attname = 'installment_plan_id'
      AND dst.attname = 'plan_id'
  ) THEN
    RAISE EXCEPTION 'POST-MIGRATION VERIFICATION FAILED: Exact foreign key order_items.installment_plan_id -> course_installment_plans.plan_id missing!';
  END IF;

  -- 12. Assert exact foreign key: student_course_agreements.plan_id -> course_installment_plans.plan_id
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute src
      ON src.attrelid = c.conrelid
     AND src.attnum = c.conkey[1]
    JOIN pg_attribute dst
      ON dst.attrelid = c.confrelid
     AND dst.attnum = c.confkey[1]
    WHERE c.conrelid = 'public.student_course_agreements'::regclass
      AND c.confrelid = 'public.course_installment_plans'::regclass
      AND c.contype = 'f'
      AND cardinality(c.conkey) = 1
      AND cardinality(c.confkey) = 1
      AND src.attname = 'plan_id'
      AND dst.attname = 'plan_id'
  ) THEN
    RAISE EXCEPTION 'POST-MIGRATION VERIFICATION FAILED: Exact foreign key student_course_agreements.plan_id -> course_installment_plans.plan_id missing!';
  END IF;

  RAISE NOTICE '=======================================================';
  RAISE NOTICE 'Migration 245 Verification Passed:';
  RAISE NOTICE '  - order_items.plan_id dropped successfully';
  RAISE NOTICE '  - fk_order_items_plan dropped successfully';
  RAISE NOTICE '  - idx_order_items_institute_plan dropped successfully';
  RAISE NOTICE '  - idx_order_items_order_plan dropped successfully';
  RAISE NOTICE '  - ck_order_items_item_type_consistency enforced';
  RAISE NOTICE '  - ck_course_enrollments_enrollment_type enforced';
  RAISE NOTICE '  - ck_order_entitlement_grants_type enforced (grant_type check preserved)';
  RAISE NOTICE '  - Preserved installment orders: %', v_installment_orders;
  RAISE NOTICE '  - Preserved installment columns: order_items.installment_plan_id, student_course_agreements.plan_id';
  RAISE NOTICE '  - Preserved installment FKs: order_items -> course_installment_plans, agreements -> course_installment_plans';
  RAISE NOTICE '=======================================================';
END $$;
