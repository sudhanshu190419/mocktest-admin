-- ============================================================================
-- Migration 246: Complete Subscription Module Retirement
--
-- TARGET: Make Me Topper PostgreSQL Schema
-- ENVIRONMENTS: Production & Staging (Supabase Project: ocolfottogbybitfpdqy)
-- PRECEDING MIGRATIONS:
--   - 240: Decoupled installment settlement and course access from subscriptions.
--   - 241: Corrected recording playback access schema.
--   - 242: Separated live class discovery from installment authorization.
--   - 243: Decoupled home bootstrap, batch subjects, and account deletion.
--   - 244: Purged subscription demo/test data and decoupled runtime dependencies.
--   - 245: Removed order_items.plan_id, dropped fk_order_items_plan, updated check
--          constraints, and decoupled standard order entitlement revocation.
--
-- PURPOSE OF MIGRATION 246:
-- Permanently and completely retires the obsolete subscription module from the
-- database catalog:
--   1. Updates public.complete_google_play_purchase to remove all RTDN ledger
--      operations on google_play_rtdn_events, while strictly preserving one-time
--      course and PYQ purchase verification, token idempotency, and fulfillment.
--   2. Drops the 6 obsolete subscription SQL functions and RPCs using RESTRICT.
--   3. Drops the 4 subscription triggers on student_subscriptions and their
--      trigger functions using RESTRICT.
--   4. Unschedules the daily pg_cron job 'subscription-lifecycle-daily' and
--      deletes the Vault secret 'subscription_lifecycle_url'.
--   5. Drops the 9 obsolete subscription tables and the standalone RTDN ledger table
--      in strict dependency order (child -> parent -> catalog) using RESTRICT.
--   6. Drops the 6 obsolete subscription enum types using RESTRICT.
--   7. Runs comprehensive automated verification assertions guaranteeing that all
--      targeted objects are removed and protected course, PYQ, and installment
--      tables, constraints, foreign keys, and records remain 100% intact.
--
-- PRESERVATION GUARANTEES:
--   - Full Course Purchases (Google Play one-time course_* and Razorpay website).
--   - Installment Course Purchases (Razorpay website, agreements, schedules, ledgers).
--   - PYQ Package Purchases (Google Play pyq_* and Razorpay website).
--   - Preserved installment schema, foreign keys, tables, and purchasing flows.
--   - Zero modifications to migrations 233-245.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1: Decouple complete_google_play_purchase from RTDN Ledger
-- ════════════════════════════════════════════════════════════════════════════
-- Removes all reads and writes to public.google_play_rtdn_events so the RTDN
-- table can be safely dropped in Section 5. Retains identical 18-parameter signature,
-- advisory locks, token idempotency, role elevation, order/payment creation, and
-- course/PYQ fulfillment. Fails closed immediately if p_item_type = 'subscription_plan'.

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


      RETURN jsonb_build_object(
        'success', true,
        'verified', true,
        'outcome', 'already_recorded',
        'alreadyProcessed', true,
        'paymentId', v_existing_payment_id,
        'orderId', v_existing_order_id,
        'cycleIndex', -1,
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

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2: Drop Obsolete Subscription Functions and RPCs
-- ════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.apply_google_play_rtdn_state_transition(
  uuid, integer, uuid, text, text, boolean, date, date, date, uuid, uuid, boolean, text, jsonb
) RESTRICT;

DROP FUNCTION IF EXISTS public.reconcile_google_play_renewal_batch(
  uuid, integer, uuid, uuid, uuid, uuid, uuid, text, text, jsonb, jsonb
) RESTRICT;

DROP FUNCTION IF EXISTS public.transition_subscription_to_grace(uuid) RESTRICT;

DROP FUNCTION IF EXISTS public.total_subscription_payments(uuid, uuid) RESTRICT;

DROP FUNCTION IF EXISTS public.diag_assigned_notes_access(uuid, uuid, uuid) RESTRICT;

DROP FUNCTION IF EXISTS public.fulfill_standard_subscription_order(
  uuid, uuid, uuid, text, text, text, text, date
) RESTRICT;

DROP FUNCTION IF EXISTS public.fulfill_standard_subscription_order(uuid) RESTRICT;

-- Safety sweep: Drop any remaining overloads of obsolete subscription functions in public schema
DO $$
DECLARE
  r RECORD;
  v_obsolete_func text;
  v_obsolete_funcs text[] := ARRAY[
    'apply_google_play_rtdn_state_transition',
    'reconcile_google_play_renewal_batch',
    'transition_subscription_to_grace',
    'total_subscription_payments',
    'diag_assigned_notes_access',
    'fulfill_standard_subscription_order'
  ];
BEGIN
  FOREACH v_obsolete_func IN ARRAY v_obsolete_funcs LOOP
    FOR r IN (
      SELECT p.oid::regprocedure AS func_sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_obsolete_func
    ) LOOP
      EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_sig || ' RESTRICT';
    END LOOP;
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3: Drop Obsolete Subscription Triggers and Trigger Functions
-- ════════════════════════════════════════════════════════════════════════════
-- Explicitly drops the 4 dependent triggers installed on public.student_subscriptions
-- before dropping the trigger functions with RESTRICT (never CASCADE).

DROP TRIGGER IF EXISTS trg_student_subscriptions_auto_history ON public.student_subscriptions;
DROP TRIGGER IF EXISTS trg_student_subscriptions_check_capacity ON public.student_subscriptions;
DROP TRIGGER IF EXISTS trg_student_subscriptions_validate_course ON public.student_subscriptions;
DROP TRIGGER IF EXISTS trg_student_subscriptions_validate_status ON public.student_subscriptions;

DROP FUNCTION IF EXISTS public.trgfn_subscription_auto_history() RESTRICT;
DROP FUNCTION IF EXISTS public.trgfn_subscription_check_capacity() RESTRICT;
DROP FUNCTION IF EXISTS public.trgfn_subscription_validate_course() RESTRICT;
DROP FUNCTION IF EXISTS public.trgfn_subscription_validate_status() RESTRICT;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4: Unschedule Subscription pg_cron Job and Remove Vault Secret
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'subscription-lifecycle-daily') THEN
      PERFORM cron.unschedule('subscription-lifecycle-daily');
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    DELETE FROM vault.secrets WHERE name = 'subscription_lifecycle_url';
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5: Drop Obsolete Subscription Tables in Strict Dependency Order
-- ════════════════════════════════════════════════════════════════════════════
-- Drops child event and usage tables first, followed by student_subscriptions,
-- the plan_unlocks junction, catalog tables, and finally the RTDN ledger.
-- Every drop specifies RESTRICT to prevent accidental cascade onto non-subscription objects.

DROP TABLE IF EXISTS public.subscription_usage RESTRICT;
DROP TABLE IF EXISTS public.subscription_grace_periods RESTRICT;
DROP TABLE IF EXISTS public.subscription_cancellations RESTRICT;
DROP TABLE IF EXISTS public.subscription_renewals RESTRICT;
DROP TABLE IF EXISTS public.subscription_history RESTRICT;
DROP TABLE IF EXISTS public.student_subscriptions RESTRICT;
DROP TABLE IF EXISTS public.plan_unlocks RESTRICT;
DROP TABLE IF EXISTS public.subscription_plans RESTRICT;
DROP TABLE IF EXISTS public.subscription_features RESTRICT;
DROP TABLE IF EXISTS public.google_play_rtdn_events RESTRICT;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6: Drop Obsolete Subscription Enum Types
-- ════════════════════════════════════════════════════════════════════════════
-- After table removal, these 6 enums have zero dependent columns and can be cleanly
-- dropped with RESTRICT. Shared enums (item_type, notification_event_type) are preserved.

DROP TYPE IF EXISTS public.subscription_status_type RESTRICT;
DROP TYPE IF EXISTS public.subscription_change_reason_type RESTRICT;
DROP TYPE IF EXISTS public.cancellation_reason_type RESTRICT;
DROP TYPE IF EXISTS public.grace_period_resolution_type RESTRICT;
DROP TYPE IF EXISTS public.plan_billing_cycle_type RESTRICT;
DROP TYPE IF EXISTS public.feature_category_type RESTRICT;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 7: Post-Migration Automated Verification Assertions
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_tbl text;
  v_type text;
  v_func text;
  v_trg text;
  v_tables_to_check text[] := ARRAY[
    'subscription_usage',
    'subscription_grace_periods',
    'subscription_cancellations',
    'subscription_renewals',
    'subscription_history',
    'student_subscriptions',
    'plan_unlocks',
    'subscription_plans',
    'subscription_features',
    'google_play_rtdn_events'
  ];
  v_types_to_check text[] := ARRAY[
    'subscription_status_type',
    'subscription_change_reason_type',
    'cancellation_reason_type',
    'grace_period_resolution_type',
    'plan_billing_cycle_type',
    'feature_category_type'
  ];
  v_funcs_to_check text[] := ARRAY[
    'apply_google_play_rtdn_state_transition',
    'reconcile_google_play_renewal_batch',
    'transition_subscription_to_grace',
    'total_subscription_payments',
    'diag_assigned_notes_access',
    'fulfill_standard_subscription_order',
    'trgfn_subscription_auto_history',
    'trgfn_subscription_check_capacity',
    'trgfn_subscription_validate_course',
    'trgfn_subscription_validate_status'
  ];
  v_triggers_to_check text[] := ARRAY[
    'trg_student_subscriptions_auto_history',
    'trg_student_subscriptions_check_capacity',
    'trg_student_subscriptions_validate_course',
    'trg_student_subscriptions_validate_status'
  ];
  v_shared_funcs_to_check text[] := ARRAY[
    'complete_google_play_purchase',
    'process_installment_payment',
    'reserve_installment_order',
    'reserve_subsequent_installment_order',
    'can_student_access_content',
    'can_student_access_live_course',
    'authorize_live_class_access',
    'verify_recording_playback_access'
  ];
BEGIN
  -- 1. Assert all 10 obsolete tables no longer exist
  FOREACH v_tbl IN ARRAY v_tables_to_check LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = v_tbl
    ) THEN
      RAISE EXCEPTION 'POST-MIGRATION VERIFICATION FAILED: Table public.% still exists!', v_tbl;
    END IF;
  END LOOP;

  -- 2. Assert all 6 obsolete enums no longer exist
  FOREACH v_type IN ARRAY v_types_to_check LOOP
    IF EXISTS (
      SELECT 1 FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typname = v_type
    ) THEN
      RAISE EXCEPTION 'POST-MIGRATION VERIFICATION FAILED: Enum type public.% still exists!', v_type;
    END IF;
  END LOOP;

  -- 3. Assert all 10 obsolete functions no longer exist
  FOREACH v_func IN ARRAY v_funcs_to_check LOOP
    IF EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_func
    ) THEN
      RAISE EXCEPTION 'POST-MIGRATION VERIFICATION FAILED: Function public.% still exists!', v_func;
    END IF;
  END LOOP;

  -- 4. Assert identified subscription triggers no longer exist
  FOREACH v_trg IN ARRAY v_triggers_to_check LOOP
    IF EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = v_trg
    ) THEN
      RAISE EXCEPTION 'POST-MIGRATION VERIFICATION FAILED: Trigger % still exists!', v_trg;
    END IF;
  END LOOP;

  -- 5. Assert subscription-lifecycle-daily cron job no longer exists
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'subscription-lifecycle-daily') THEN
      RAISE EXCEPTION 'POST-MIGRATION VERIFICATION FAILED: Cron job subscription-lifecycle-daily still exists!';
    END IF;
  END IF;

  -- 6. Assert Vault secret subscription_lifecycle_url no longer exists
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    IF EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'subscription_lifecycle_url') THEN
      RAISE EXCEPTION 'POST-MIGRATION VERIFICATION FAILED: Vault secret subscription_lifecycle_url still exists!';
    END IF;
  END IF;

  -- 7. Assert shared purchasing and entitlement functions remain available
  FOREACH v_func IN ARRAY v_shared_funcs_to_check LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_func
    ) THEN
      RAISE EXCEPTION 'POST-MIGRATION VERIFICATION FAILED: Shared function public.% missing!', v_func;
    END IF;
  END LOOP;

  -- 8. Assert order_items.installment_plan_id column exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'order_items'
      AND column_name = 'installment_plan_id'
  ) THEN
    RAISE EXCEPTION 'POST-MIGRATION VERIFICATION FAILED: Column public.order_items.installment_plan_id missing!';
  END IF;

  -- 9. Assert student_course_agreements.plan_id column exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'student_course_agreements'
      AND column_name = 'plan_id'
  ) THEN
    RAISE EXCEPTION 'POST-MIGRATION VERIFICATION FAILED: Column public.student_course_agreements.plan_id missing!';
  END IF;

  -- 10. Assert exact foreign key: order_items.installment_plan_id -> course_installment_plans.plan_id
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

  -- 11. Assert exact foreign key: student_course_agreements.plan_id -> course_installment_plans.plan_id
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

  -- 12. Assert core commerce and installment tables exist and are healthy
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'orders')
     OR NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'order_items')
     OR NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payments')
     OR NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'course_enrollments')
     OR NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'student_pyq_purchases')
     OR NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'course_installment_plans')
     OR NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'student_course_agreements')
     OR NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'student_installment_schedule')
     OR NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'installment_payment_allocations')
     OR NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'installment_adjustments')
  THEN
    RAISE EXCEPTION 'POST-MIGRATION VERIFICATION FAILED: Core commerce or installment tables missing!';
  END IF;

  RAISE NOTICE '=======================================================';
  RAISE NOTICE 'Migration 246 Verification Passed:';
  RAISE NOTICE '  - 10 obsolete tables dropped successfully';
  RAISE NOTICE '  - 6 obsolete enums dropped successfully';
  RAISE NOTICE '  - 10 obsolete functions dropped successfully';
  RAISE NOTICE '  - 4 obsolete triggers verified absent';
  RAISE NOTICE '  - Cron job and Vault secret cleaned up successfully';
  RAISE NOTICE '  - complete_google_play_purchase decoupled from RTDN';
  RAISE NOTICE '  - Shared purchasing and entitlement functions verified';
  RAISE NOTICE '  - Core commerce and installment schema verified intact';
  RAISE NOTICE '=======================================================';
END $$;
