-- ============================================================================
-- Migration 248: Apple In-App Purchase Atomic Fulfillment RPC
-- ============================================================================
--
-- PURPOSE:
--   Implements atomic, idempotent fulfillment RPC for Apple StoreKit 2
--   In-App Purchases on the Make Me Topper platform.
--
-- SCOPE & GOVERNANCE (Phase 2):
--   - Scoped strictly to purchase fulfillment (public.complete_apple_purchase).
--   - Refund, revoke, and Server Notifications V2 processing are explicitly deferred.
--   - Requires verified transaction parameters (amount, currency, timestamp, tx ID, product ID, environment).
--   - No unsafe catalog price fallbacks, INR defaults, or now() timestamp defaults.
--   - Validates complete deterministic Apple SKU mapping:
--       Course:      com.makemetopper.course.<32-hex-course-uuid>
--       PYQ Package: com.makemetopper.pyq.<32-hex-package-uuid>
--   - Restricts server fulfillment environment strictly to ('Production', 'Sandbox').
--   - Protects against cross-account receipt claiming (ACCOUNT_MISMATCH).
--   - Protects against refunded transaction replay (TRANSACTION_REFUNDED).
--   - Protects against re-activating explicitly deactivated/revoked entitlements (ENTITLEMENT_REVOKED).
--   - Safe conflict handling: uses ON CONFLICT DO NOTHING so existing revocation records are never erased.
--   - Allows safe fulfillment repair only when payment is captured & order confirmed but entitlement row is completely missing.
--   - Safely records new charged transactions for already-enrolled students without modifying active entitlements.
--
-- SECURITY & SEARCH PATH:
--   - SECURITY DEFINER with search_path = public, pg_temp.
--   - Strictly guarded: caller must possess service_role privileges.
--   - Permissions revoked from public, anon, and authenticated; granted only to service_role.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.complete_apple_purchase(
    p_profile_id uuid,
    p_institute_id uuid,
    p_item_type text,
    p_amount numeric,
    p_currency text,
    p_transaction_id text,
    p_transaction_timestamp timestamptz,
    p_product_id text,
    p_environment text,
    p_student_id uuid DEFAULT null,
    p_course_id uuid DEFAULT null,
    p_package_id uuid DEFAULT null,
    p_item_name text DEFAULT null,
    p_original_transaction_id text DEFAULT null,
    p_gateway_response jsonb DEFAULT null,
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
  v_existing_payment_status     public.payment_status := null;
  v_existing_order_status       public.order_status := null;
  v_existing_gateway_payment_id text := null;
  v_existing_gateway_order_id   text := null;
  v_existing_order_institute_id uuid := null;
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
  v_profile_name                varchar(255);
  v_profile_email               varchar(255);
  v_resolved_institute_id       uuid;
  v_effective_course_id         uuid := null;
  v_effective_package_id        uuid := null;

  v_course_course_id            uuid := null;
  v_course_institute_id         uuid := null;
  v_course_title                varchar(300) := null;

  v_package_package_id          uuid := null;
  v_package_institute_id        uuid := null;
  v_package_name                varchar(300) := null;

  v_item_name                   varchar(255);
  v_effective_amount            numeric(12,2) := null;
  v_currency_upper              text;
  v_currency                    public.currency_code;
  v_billing_name                varchar(255);
  v_billing_email               varchar(255);

  v_enrollment_no               varchar(50);

  v_entitlement                 text := '';
  v_entitlement_found           boolean := false;
  v_entitlement_is_active       boolean := false;
  v_entitlement_revoked_at      timestamptz := null;
  v_skip_payment_insert         boolean := false;
  v_year                        text;
  v_invoice_num                 text;

  v_target_entitlement_found    boolean := false;
  v_target_is_active            boolean := false;
  v_target_revoked_at           timestamptz := null;
  v_target_revoked_reason       text := null;
  v_entitlement_already_active  boolean := false;

  v_tx_lock_key                 bigint;
  v_orig_tx_lock_key            bigint;
  v_first_lock_key              bigint;
  v_second_lock_key             bigint;
BEGIN
  -- 0. Security Guard: Only service_role (Edge Function backend) may execute this RPC
  v_caller_role := auth.role();
  IF v_caller_role IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: complete_apple_purchase requires service_role privileges',
      'code', 'FORBIDDEN'
    );
  END IF;

  -- 1. Validate required profile and institute parameters
  IF p_profile_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'p_profile_id is required.',
      'code', 'INVALID_PURCHASE_PAYLOAD'
    );
  END IF;

  IF p_institute_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'p_institute_id is required.',
      'code', 'INVALID_PURCHASE_PAYLOAD'
    );
  END IF;

  -- 2. Validate verified Apple transaction parameters (strictly require verified data, no unsafe defaults)
  IF p_amount IS NULL OR p_amount <= 0.00 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Explicit positive p_amount from verified Apple transaction is required.',
      'code', 'INVALID_AMOUNT'
    );
  END IF;
  v_effective_amount := round(p_amount, 2);

  IF p_currency IS NULL OR btrim(p_currency) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Explicit p_currency from verified Apple transaction is required.',
      'code', 'MISSING_CURRENCY'
    );
  END IF;

  v_currency_upper := upper(btrim(p_currency));
  IF v_currency_upper NOT IN ('INR', 'USD', 'AED', 'GBP') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unsupported currency ''' || v_currency_upper || '''. Supported currencies: INR, USD, AED, GBP.',
      'code', 'UNSUPPORTED_CURRENCY'
    );
  END IF;
  v_currency := v_currency_upper::public.currency_code;

  IF p_transaction_id IS NULL OR btrim(p_transaction_id) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Explicit p_transaction_id from verified Apple transaction is required.',
      'code', 'INVALID_TRANSACTION_ID'
    );
  END IF;

  IF p_transaction_timestamp IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Explicit p_transaction_timestamp from verified Apple transaction is required.',
      'code', 'MISSING_TRANSACTION_TIMESTAMP'
    );
  END IF;

  IF p_product_id IS NULL OR btrim(p_product_id) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Explicit p_product_id from verified Apple transaction is required.',
      'code', 'MISSING_PRODUCT_ID'
    );
  END IF;

  IF p_environment IS NULL OR btrim(p_environment) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Explicit p_environment from verified Apple transaction is required.',
      'code', 'MISSING_ENVIRONMENT'
    );
  END IF;

  IF btrim(p_environment) NOT IN ('Production', 'Sandbox') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unsupported environment ''' || p_environment || '''. Server fulfillment accepts only Production or Sandbox.',
      'code', 'INVALID_ENVIRONMENT'
    );
  END IF;

  -- 3. Explicitly reject subscription_plan requests (Migration 246 compliance)
  IF p_item_type = 'subscription_plan' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Subscription purchases are retired. Please purchase individual courses or PYQ packages.',
      'code', 'SUBSCRIPTIONS_RETIRED'
    );
  END IF;

  -- 4. Global Advisory Lock: Serialize concurrent verification requests sharing transaction ID or original transaction ID
  v_tx_lock_key := hashtext('apple_transaction:' || p_transaction_id);
  IF p_original_transaction_id IS NOT NULL AND btrim(p_original_transaction_id) <> '' AND p_original_transaction_id <> p_transaction_id THEN
    v_orig_tx_lock_key := hashtext('apple_original_transaction:' || p_original_transaction_id);
    v_first_lock_key := least(v_tx_lock_key, v_orig_tx_lock_key);
    v_second_lock_key := greatest(v_tx_lock_key, v_orig_tx_lock_key);
    PERFORM pg_advisory_xact_lock(v_first_lock_key);
    PERFORM pg_advisory_xact_lock(v_second_lock_key);
  ELSE
    PERFORM pg_advisory_xact_lock(v_tx_lock_key);
  END IF;

  -- 5. Validate Profile Existence and Lock Profile Row (serializes user-level concurrent requests)
  SELECT p.role, p.institute_id, p.name, p.email
  INTO v_profile_role, v_profile_institute_id, v_profile_name, v_profile_email
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

  -- 6. Staff Role Protection: Staff accounts cannot purchase student products
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

  -- 7. Multi-Tenant Institute Validation
  IF p_institute_id IS NOT NULL AND v_profile_institute_id IS NOT NULL AND p_institute_id <> v_profile_institute_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Institute mismatch: requested institute does not match profile institute.',
      'code', 'INSTITUTE_MISMATCH'
    );
  END IF;
  v_resolved_institute_id := COALESCE(v_profile_institute_id, p_institute_id);

  -- 8. Product & Association Integrity Validation with Complete SKU Mapping Verification
  IF p_item_type = 'course' THEN
    IF p_course_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'p_course_id is required for course purchase.',
        'code', 'INVALID_PURCHASE_PAYLOAD'
      );
    END IF;

    -- Validate complete Apple SKU mapping: com.makemetopper.course.<32-hex-course-uuid>
    IF lower(btrim(p_product_id)) <> ('com.makemetopper.course.' || lower(replace(p_course_id::text, '-', ''))) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Apple product_id ''' || p_product_id || ''' does not match the expected SKU for course ' || p_course_id::text || '.',
        'code', 'PRODUCT_ID_MISMATCH'
      );
    END IF;

    SELECT c.course_id, c.institute_id, c.title
    INTO v_course_course_id, v_course_institute_id, v_course_title
    FROM public.courses c
    WHERE c.course_id = p_course_id;

    IF v_course_course_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Course not found for course_id ' || p_course_id::text,
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

    v_effective_course_id := p_course_id;
    v_effective_package_id := null;
    v_item_name := COALESCE(NULLIF(btrim(p_item_name), ''), v_course_title, 'Educational Course');

  ELSIF p_item_type = 'pyq_package' THEN
    IF p_package_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'p_package_id is required for pyq_package purchase.',
        'code', 'INVALID_PURCHASE_PAYLOAD'
      );
    END IF;

    -- Validate complete Apple SKU mapping: com.makemetopper.pyq.<32-hex-package-uuid>
    IF lower(btrim(p_product_id)) <> ('com.makemetopper.pyq.' || lower(replace(p_package_id::text, '-', ''))) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Apple product_id ''' || p_product_id || ''' does not match the expected SKU for PYQ package ' || p_package_id::text || '.',
        'code', 'PRODUCT_ID_MISMATCH'
      );
    END IF;

    SELECT pp.package_id, pp.institute_id, pp.name
    INTO v_package_package_id, v_package_institute_id, v_package_name
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

    v_effective_course_id := null;
    v_effective_package_id := p_package_id;
    v_item_name := COALESCE(NULLIF(btrim(p_item_name), ''), v_package_name, 'PYQ Package');

  ELSE
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid item_type ''' || COALESCE(p_item_type, 'null') || '''. Must be course or pyq_package.',
      'code', 'INVALID_ITEM_TYPE'
    );
  END IF;

  -- 9. Defensively resolve existing student_details record strictly scoped to p_profile_id
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

  -- 10. Search for existing Apple payment matching transaction ID or original transaction ID
  SELECT p.payment_id, p.order_id, o.profile_id, p.status, o.status, p.gateway_payment_id, p.gateway_order_id, o.institute_id
  INTO v_existing_payment_id, v_existing_order_id, v_existing_payment_profile_id, v_existing_payment_status, v_existing_order_status, v_existing_gateway_payment_id, v_existing_gateway_order_id, v_existing_order_institute_id
  FROM public.payments p
  JOIN public.orders o ON o.order_id = p.order_id
  WHERE p.gateway = 'apple'
    AND (
      p.gateway_payment_id = p_transaction_id
      OR (p_original_transaction_id IS NOT NULL AND btrim(p_original_transaction_id) <> '' AND (p.gateway_payment_id = p_original_transaction_id OR p.gateway_order_id = p_original_transaction_id))
    )
  ORDER BY p.created_at DESC
  LIMIT 1;

  IF v_existing_payment_id IS NOT NULL THEN
    -- Account mismatch check: transaction already claimed by another profile
    IF v_existing_payment_profile_id <> p_profile_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'This Apple In-App Purchase has already been claimed by another account. Please sign in with the original account or contact support.',
        'code', 'ACCOUNT_MISMATCH'
      );
    END IF;

    -- Refund protection: A refunded payment must NEVER restore access through replay
    IF v_existing_payment_status = 'refunded'::public.payment_status OR v_existing_order_status = 'refunded'::public.order_status THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'This Apple In-App Purchase was refunded and cannot be used to claim access.',
        'code', 'TRANSACTION_REFUNDED',
        'paymentId', v_existing_payment_id,
        'orderId', v_existing_order_id
      );
    END IF;

    -- State consistency check: only captured payment + confirmed order can be fulfilled
    IF v_existing_payment_status <> 'captured'::public.payment_status OR v_existing_order_status <> 'confirmed'::public.order_status THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Existing transaction payment is in state ''' || v_existing_payment_status::text || ''' and order is in state ''' || v_existing_order_status::text || '''. Cannot fulfill.',
        'code', 'INVALID_EXISTING_PAYMENT_STATE',
        'paymentId', v_existing_payment_id,
        'orderId', v_existing_order_id
      );
    END IF;

    -- Institute match check
    IF v_existing_order_institute_id <> v_resolved_institute_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Existing transaction belongs to a different institute.',
        'code', 'INSTITUTE_MISMATCH',
        'orderId', v_existing_order_id
      );
    END IF;

    -- Load existing order item to verify product and type consistency
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
      IF v_existing_item_package_id IS DISTINCT FROM v_effective_package_id THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'Existing order item package_id does not match purchase package_id.',
          'code', 'ORDER_ITEM_MISMATCH',
          'orderId', v_existing_order_id
        );
      END IF;
    END IF;

    -- Check actual entitlement record state for this student
    v_entitlement_found := false;
    v_entitlement_is_active := false;
    v_entitlement_revoked_at := null;

    IF v_student_id IS NOT NULL THEN
      IF p_item_type = 'course' THEN
        SELECT true, ce.is_active, ce.revoked_at
        INTO v_entitlement_found, v_entitlement_is_active, v_entitlement_revoked_at
        FROM public.course_enrollments ce
        WHERE ce.course_id = v_effective_course_id
          AND ce.student_id = v_student_id;
      ELSIF p_item_type = 'pyq_package' THEN
        SELECT true, sp.is_active, sp.revoked_at
        INTO v_entitlement_found, v_entitlement_is_active, v_entitlement_revoked_at
        FROM public.student_pyq_purchases sp
        WHERE sp.package_id = v_effective_package_id
          AND sp.student_id = v_student_id;
      END IF;
    END IF;

    -- Case A: Entitlement exists and is active -> Idempotent success (no new order or payment)
    IF v_entitlement_found AND v_entitlement_is_active = true AND v_entitlement_revoked_at IS NULL THEN
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

    -- Case B: Entitlement exists BUT is inactive or revoked -> DO NOT REACTIVATE
    IF v_entitlement_found AND (v_entitlement_is_active = false OR v_entitlement_revoked_at IS NOT NULL) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'The entitlement for this purchase has been explicitly deactivated or revoked. Replay cannot restore access.',
        'code', 'ENTITLEMENT_REVOKED',
        'paymentId', v_existing_payment_id,
        'orderId', v_existing_order_id
      );
    END IF;

    -- Case C: Entitlement row is completely missing (not found) despite captured payment & confirmed order.
    -- Safely remediate: reuse existing order and item, skip duplicate payment insert,
    -- and proceed to ensure student role/details and grant the missing entitlement.
    v_order_id := v_existing_order_id;
    v_item_id := v_existing_item_id;
    v_skip_payment_insert := true;
  END IF;

  -- 10B. Pre-flight check on student's existing entitlement for this product (new transaction path)
  IF v_existing_payment_id IS NULL AND v_student_id IS NOT NULL THEN
    v_target_entitlement_found := false;
    v_target_is_active := false;
    v_target_revoked_at := null;
    v_target_revoked_reason := null;

    IF p_item_type = 'course' THEN
      SELECT true, ce.is_active, ce.revoked_at, ce.revoked_reason
      INTO v_target_entitlement_found, v_target_is_active, v_target_revoked_at, v_target_revoked_reason
      FROM public.course_enrollments ce
      WHERE ce.course_id = v_effective_course_id
        AND ce.student_id = v_student_id;
    ELSIF p_item_type = 'pyq_package' THEN
      SELECT true, sp.is_active, sp.revoked_at, sp.revoked_reason
      INTO v_target_entitlement_found, v_target_is_active, v_target_revoked_at, v_target_revoked_reason
      FROM public.student_pyq_purchases sp
      WHERE sp.package_id = v_effective_package_id
        AND sp.student_id = v_student_id;
    END IF;

    -- Existing inactive or revoked entitlement: NEVER automatically reactivate.
    -- Preserve administrator's access control decision and reject immediately.
    IF v_target_entitlement_found AND (v_target_is_active = false OR v_target_revoked_at IS NOT NULL) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'The entitlement for this product has been deactivated or revoked by an administrator. Purchase cannot restore access.',
        'code', 'ENTITLEMENT_REVOKED'
      );
    END IF;

    -- Existing active entitlement: student already actively owns this product.
    -- Record the charged payment for financial auditing & bank settlement reconciliation,
    -- but preserve existing entitlement state without modification.
    IF v_target_entitlement_found AND v_target_is_active = true AND v_target_revoked_at IS NULL THEN
      v_entitlement_already_active := true;
    END IF;
  END IF;

  -- 11. Check for existing unfulfilled order correlated to this transaction ID
  IF v_order_id IS NULL THEN
    SELECT o.order_id, o.status, o.institute_id
    INTO v_order_id, v_existing_order_status, v_existing_order_institute_id
    FROM public.orders o
    WHERE o.profile_id = p_profile_id
      AND (
        substring(o.notes FROM '"transactionId"[[:space:]]*:[[:space:]]*"([^"]+)"') = p_transaction_id
        OR (p_original_transaction_id IS NOT NULL AND btrim(p_original_transaction_id) <> '' AND substring(o.notes FROM '"originalTransactionId"[[:space:]]*:[[:space:]]*"([^"]+)"') = p_original_transaction_id)
      )
    LIMIT 1;

    IF v_order_id IS NOT NULL THEN
      IF v_existing_order_status = 'refunded'::public.order_status THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'Existing order correlated to this transaction was refunded.',
          'code', 'ORDER_REFUNDED',
          'orderId', v_order_id
        );
      END IF;

      IF v_existing_order_institute_id <> v_resolved_institute_id THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'Existing order belongs to a different institute.',
          'code', 'INSTITUTE_MISMATCH',
          'orderId', v_order_id
        );
      END IF;

      SELECT oi.item_id, oi.item_type, oi.course_id, oi.package_id
      INTO v_existing_item_id, v_existing_item_type, v_existing_item_course_id, v_existing_item_package_id
      FROM public.order_items oi
      WHERE oi.order_id = v_order_id
      LIMIT 1;

      IF v_existing_item_id IS NULL THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'Existing order found for this transaction ID but it has no associated order items. Failing closed to prevent partial order processing.',
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
        IF v_existing_item_package_id IS DISTINCT FROM v_effective_package_id THEN
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

  -- 12. Atomic Role Transition: Promote role = 'user' to 'student'
  IF v_profile_role::text = 'user' THEN
    UPDATE public.profiles
    SET role = 'student'::public.user_role,
        updated_at = p_transaction_timestamp
    WHERE profile_id = p_profile_id;
    v_profile_role := 'student'::public.user_role;
  END IF;

  -- 13. Student Details Resolution & Initialization
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

  -- 14. Build structured order notes with Apple correlation metadata
  v_order_notes := jsonb_build_object(
    'gateway', 'apple',
    'transactionId', p_transaction_id,
    'originalTransactionId', COALESCE(p_original_transaction_id, p_transaction_id),
    'productId', p_product_id,
    'environment', p_environment,
    'itemType', p_item_type,
    'courseId', v_effective_course_id,
    'packageId', v_effective_package_id
  );

  -- 15. Insert Order and Order Item if new
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
      'confirmed'::public.order_status,
      v_currency,
      v_effective_amount,
      0.00,
      0.00,
      v_effective_amount,
      v_order_notes::text,
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
      v_effective_package_id,
      v_item_name,
      v_effective_amount,
      1,
      0.00,
      v_effective_amount,
      p_transaction_timestamp
    )
    RETURNING item_id INTO v_item_id;
  END IF;

  -- 16. Insert Payment record ('apple' gateway, status = 'captured')
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
      'apple'::public.payment_gateway,
      COALESCE(p_original_transaction_id, p_transaction_id),
      p_transaction_id,
      CASE
        WHEN jsonb_typeof(p_gateway_response) = 'object' THEN
          p_gateway_response || jsonb_build_object(
            'transactionId', p_transaction_id,
            'originalTransactionId', COALESCE(p_original_transaction_id, p_transaction_id),
            'productId', p_product_id,
            'environment', p_environment
          )
        ELSE
          jsonb_build_object(
            'transactionId', p_transaction_id,
            'originalTransactionId', COALESCE(p_original_transaction_id, p_transaction_id),
            'productId', p_product_id,
            'environment', p_environment,
            'verified', true
          )
      END,
      v_effective_amount,
      v_currency,
      'captured'::public.payment_status,
      p_transaction_timestamp,
      p_transaction_timestamp,
      p_transaction_timestamp
    )
    RETURNING payment_id INTO v_payment_id;
  END IF;

  -- 17. Grant One-Time Entitlement (unless already active)
  IF NOT v_entitlement_already_active THEN
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
      ON CONFLICT (course_id, student_id) DO NOTHING;

      v_entitlement := 'course_enrollment:' || v_effective_course_id::text;

    ELSIF p_item_type = 'pyq_package' AND v_effective_package_id IS NOT NULL THEN
      INSERT INTO public.student_pyq_purchases (
        package_id,
        student_id,
        institute_id,
        order_item_id,
        access_type,
        is_active,
        purchased_at,
        revoked_at,
        revoked_reason,
        created_at,
        updated_at
      ) VALUES (
        v_effective_package_id,
        v_student_id,
        v_resolved_institute_id,
        v_item_id,
        'lifetime',
        true,
        p_transaction_timestamp,
        null,
        null,
        p_transaction_timestamp,
        p_transaction_timestamp
      )
      ON CONFLICT (package_id, student_id) DO NOTHING;

      v_entitlement := 'pyq_package:' || v_effective_package_id::text;
    END IF;
  ELSE
    IF p_item_type = 'course' THEN
      v_entitlement := 'course_enrollment:' || v_effective_course_id::text;
    ELSIF p_item_type = 'pyq_package' THEN
      v_entitlement := 'pyq_package:' || v_effective_package_id::text;
    END IF;
  END IF;

  -- 18. Snapshot draft invoice (accounting artifact with fallback student details)
  BEGIN
    v_year := to_char(p_transaction_timestamp, 'YYYY');
    v_invoice_num := 'INV-AP-' || v_year || '-' || upper(substr(replace(v_order_id::text, '-', ''), 1, 8));
    v_billing_name := COALESCE(NULLIF(btrim(p_billing_name), ''), NULLIF(btrim(v_profile_name), ''), 'Student');
    v_billing_email := COALESCE(NULLIF(btrim(p_billing_email), ''), NULLIF(btrim(v_profile_email), ''), 'noreply@makemetopper.com');

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
      'draft'::public.invoice_status,
      p_transaction_timestamp,
      v_effective_amount,
      0.00,
      0.00,
      v_effective_amount,
      v_currency,
      v_billing_name,
      v_billing_email,
      p_transaction_timestamp,
      p_transaction_timestamp
    )
    ON CONFLICT (order_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 19. Build structured response
  IF v_entitlement_already_active THEN
    RETURN jsonb_build_object(
      'success', true,
      'verified', true,
      'outcome', 'already_enrolled_payment_recorded',
      'alreadyEnrolled', true,
      'alreadyProcessed', false,
      'paymentId', v_payment_id,
      'orderId', v_order_id,
      'cycleIndex', -1,
      'entitlement', v_entitlement,
      'message', 'Payment recorded for financial reconciliation; existing active entitlement preserved without modification'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'verified', true,
    'outcome', CASE WHEN v_skip_payment_insert THEN 'entitlement_repaired' ELSE 'purchase_recorded' END,
    'alreadyProcessed', v_skip_payment_insert,
    'paymentId', COALESCE(v_payment_id, v_existing_payment_id),
    'orderId', v_order_id,
    'cycleIndex', -1,
    'entitlement', v_entitlement,
    'message', CASE
                 WHEN v_skip_payment_insert THEN 'Existing captured Apple payment reused; missing entitlement safely fulfilled'
                 ELSE 'Apple In-App Purchase processed atomically'
               END
  );
END;
$$;


-- ────────────────────────────────────────────────────────────────────────────
-- PERMISSIONS AND GRANTS
-- ────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.complete_apple_purchase(
  uuid, uuid, text, numeric, text, text, timestamptz, text, text, uuid, uuid, uuid, text, text, jsonb, text, text
) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.complete_apple_purchase(
  uuid, uuid, text, numeric, text, text, timestamptz, text, text, uuid, uuid, uuid, text, text, jsonb, text, text
) TO service_role;
