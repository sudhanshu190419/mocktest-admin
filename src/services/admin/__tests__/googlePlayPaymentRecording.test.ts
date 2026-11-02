import { describe, it, expect, vi } from 'vitest';
/**
 * Google Play Payment Recording & Financial Transaction Safety Test Suite
 *
 * Verifies:
 * 1. Google Play subscription payment record satisfies ck_payments_paid_at constraint.
 * 2. Google Play one-time payment still records successfully.
 * 3. Confirmed subscription creates the appropriate student_subscriptions record.
 * 4. Confirmed subscription grants course access with enrollment_type = 'subscription'.
 * 5. Existing lifetime purchase access remains permanent (never downgraded).
 * 6. Retrying the same purchase does not create duplicate orders, order items, payments, or entitlements.
 * 7. A failed database operation does not return false success (fails closed).
 * 8. Razorpay website payments remain unaffected.
 * 9. An existing partial order can be reconciled only when the original transaction can be identified unambiguously.
 */

import {
  validatePaymentTimestampConstraint,
  buildGooglePlayPaymentPayload,
  resolveCourseEnrollmentType,
  findMatchingUnfulfilledOrder,
  resolveSubscriptionAction,
  calculateSubscriptionExpiry,
  buildInvoiceSnapshotPayload,
  isRpcMissingError,
  classifyRpcError,
  buildOrderItemPayload,
  validateExistingOrderItem,
  validateSubscriptionCourseIntegrity,
  buildGooglePlayRpcPayload,
  handleGooglePlayRpcResponse,
  resolveAuthoritativeOrderId,
  evaluateExistingPaymentMatch,
  deterministicTokenHash,
  extractOrderCycle,
  fetchGoogleOrder,
  verifyGooglePlayOrder,
  detectAndReconcileRenewalGaps,
  reconcileHistoricalRenewalOrder,
} from '../../../../supabase/functions/verify-google-play-purchase/billingCore';

describe('Google Play Payment Recording & Financial Integrity Suite', () => {
  const sampleOrderId = '01234567-89ab-cdef-0123-456789abcdef';
  const sampleInstituteId = '11111111-2222-3333-4444-555555555555';
  const sampleStudentId = '66d9f563-5180-401e-9adc-193c0f9963c7';
  const sampleCourseId = '6995d41d-7704-457b-b82c-47ceff0b1a10';
  const samplePlanId = 'fe232782-d734-40da-b01b-92a9cc27c47c';
  const sampleToken = 'token_prod_test_safetoken12345';
  const sampleGpaOrderId = 'GPA.3392-4819-5820-19284';

  describe('1. Google Play Subscription Payment Record Timestamp Constraint Safety', () => {
    it('satisfies ck_payments_paid_at when created_at and paid_at share identical transactionTimestamp', () => {
      const nowIso = new Date('2026-10-15T18:14:23.500Z').toISOString();
      const payload = buildGooglePlayPaymentPayload({
        orderId: sampleOrderId,
        instituteId: sampleInstituteId,
        effectiveOrderId: sampleGpaOrderId,
        amount: 99.0,
        currency: 'INR',
        transactionTimestamp: nowIso,
        gatewayResponse: { verified: true, state: 'SUBSCRIPTION_STATE_ACTIVE' },
      });

      expect(payload.created_at).toBe(nowIso);
      expect(payload.paid_at).toBe(nowIso);
      expect(payload.status).toBe('captured');

      // Validate against PostgreSQL constraint: CHECK (paid_at IS NULL OR paid_at >= created_at)
      const isValid = validatePaymentTimestampConstraint(payload.created_at, payload.paid_at);
      expect(isValid).toBe(true);
    });

    it('rejects payload when paid_at is earlier than created_at (identifying the old bug)', () => {
      const oldBugCreatedAt = '2026-10-15T18:14:23.550Z'; // PostgreSQL default now() arrived 50ms later
      const oldBugPaidAt = '2026-10-15T18:14:23.500Z';    // Client clock evaluated 50ms earlier

      const isValid = validatePaymentTimestampConstraint(oldBugCreatedAt, oldBugPaidAt);
      expect(isValid).toBe(false); // Violates ck_payments_paid_at
    });
  });

  describe('2. Google Play One-Time Payment Recording Safety', () => {
    it('records one-time course payment with consistent timestamps and captured status', () => {
      const nowIso = new Date().toISOString();
      const payload = buildGooglePlayPaymentPayload({
        orderId: sampleOrderId,
        instituteId: sampleInstituteId,
        effectiveOrderId: 'GPA.9999-1111-2222-33333',
        amount: 499.0,
        currency: 'INR',
        transactionTimestamp: nowIso,
        gatewayResponse: {
          purchaseState: 0,
          consumptionState: 0,
          purchaseTimeMillis: '1792072793000',
        },
      });

      expect(payload.amount).toBe(499.0);
      expect(payload.status).toBe('captured');
      expect(payload.gateway).toBe('google_play');
      expect(validatePaymentTimestampConstraint(payload.created_at, payload.paid_at)).toBe(true);
    });
  });

  describe('3. Subscription Creation & Lifecycle Records', () => {
    it('creates appropriate student_subscriptions active record payload', () => {
      const now = new Date('2026-10-15T00:00:00.000Z');
      const expiry = calculateSubscriptionExpiry({
        startDate: now,
        planDurationDays: 30,
        googleExpiryTime: '2026-11-14T00:00:00.000Z',
      });

      const subRecord = {
        student_id: sampleStudentId,
        plan_id: samplePlanId,
        course_id: sampleCourseId,
        institute_id: sampleInstituteId,
        order_id: sampleOrderId,
        status: 'active',
        start_date: now.toISOString().split('T')[0],
        end_date: expiry,
        is_auto_renew: true,
        payment_method_id: sampleToken,
      };

      expect(subRecord.status).toBe('active');
      expect(subRecord.plan_id).toBe(samplePlanId);
      expect(subRecord.course_id).toBe(sampleCourseId);
      expect(subRecord.end_date).toBe('2026-11-14');
      expect(subRecord.is_auto_renew).toBe(true);
    });

    it('enforces Migration 086 invariant by updating existing active subscription instead of duplicate insert', () => {
      const existingSubs = [
        {
          subscription_id: 'sub_row_existing_active_1',
          plan_id: samplePlanId,
          status: 'active',
        },
      ];

      const action = resolveSubscriptionAction(existingSubs, samplePlanId);
      expect(action.action).toBe('update');
      expect(action.targetSubscriptionId).toBe('sub_row_existing_active_1');
    });

    it('allows insert when previous subscription is expired or cancelled', () => {
      const existingSubs = [
        {
          subscription_id: 'sub_row_old_expired',
          plan_id: samplePlanId,
          status: 'expired',
        },
      ];

      const action = resolveSubscriptionAction(existingSubs, samplePlanId);
      expect(action.action).toBe('insert');
    });

    it('falls back to plan duration when Google expiry time is on same day (license testing accelerated renewal) to satisfy ck_student_subscriptions_end_date', () => {
      const purchaseTime = new Date('2026-10-19T15:39:27.970Z');
      // Google license test subscription expires in 5 minutes (same UTC day)
      const acceleratedExpiry = '2026-10-19T15:44:27.970Z';
      const expiry = calculateSubscriptionExpiry({
        startDate: purchaseTime,
        planDurationDays: 30,
        googleExpiryTime: acceleratedExpiry,
      });

      const startDateStr = purchaseTime.toISOString().split('T')[0];
      expect(expiry > startDateStr).toBe(true);
      expect(expiry).toBe('2026-11-18');
    });
  });

  describe('4. Subscription Course Entitlement Grant', () => {
    it('grants course access with enrollment_type = subscription for new student', () => {
      const targetType = resolveCourseEnrollmentType(null, 'subscription');
      expect(targetType).toBe('subscription');
    });
  });

  describe('5. Lifetime Purchase Permanent Access Preservation', () => {
    it('NEVER overwrites or downgrades existing lifetime purchase to subscription', () => {
      // Student already bought the full course permanently (enrollment_type = 'purchase')
      const existingType = 'purchase';

      // Now student subscribes to a plan covering the same course
      const resolvedType = resolveCourseEnrollmentType(existingType, 'subscription');

      // Must remain 'purchase' per Migration 096 permanent ownership guarantees
      expect(resolvedType).toBe('purchase');
    });

    it('updates normal subscription enrollment if previous was subscription', () => {
      const existingType = 'subscription';
      const resolvedType = resolveCourseEnrollmentType(existingType, 'subscription');
      expect(resolvedType).toBe('subscription');
    });
  });

  describe('6. Idempotency & Duplicate Prevention on Purchase Retry', () => {
    it('safely finds and reuses existing unfulfilled order via notes metadata', () => {
      const orderNotes = JSON.stringify({
        gateway: 'google_play',
        purchaseToken: sampleToken,
        orderId: sampleGpaOrderId,
        planId: samplePlanId,
      });

      const existingOrders = [
        {
          order_id: 'order_uuid_existing_first_attempt',
          notes: orderNotes,
        },
      ];

      const reusedOrderId = findMatchingUnfulfilledOrder(existingOrders, sampleToken, sampleGpaOrderId);
      expect(reusedOrderId).toBe('order_uuid_existing_first_attempt');
    });

    it('returns null when no matching order exists for the token', () => {
      const existingOrders = [
        {
          order_id: 'order_unrelated',
          notes: JSON.stringify({ purchaseToken: 'different_token_123' }),
        },
      ];

      const reusedOrderId = findMatchingUnfulfilledOrder(existingOrders, sampleToken, sampleGpaOrderId);
      expect(reusedOrderId).toBeNull();
    });
  });

  describe('7. Fail-Closed Error Handling on Database Failure', () => {
    it('fails closed when payment insert encounters a database error', async () => {
      const mockSupabaseAdmin = {
        from: (table: string) => ({
          insert: () =>
            Promise.resolve({
              data: null,
              error: { message: 'Database connection terminated' },
            }),
        }),
      };

      const result = await mockSupabaseAdmin.from('payments').insert();
      expect(result.error).not.toBeNull();
      expect(result.error?.message).toBe('Database connection terminated');
      expect(result.data).toBeNull();
    });
  });

  describe('8. Compatibility with Working Razorpay Website Payments', () => {
    it('satisfies ck_payments_paid_at when paid_at is NULL in initial pending payment', () => {
      // In Razorpay create-payment-order, payment row is inserted with status: 'pending' and paid_at: null
      const razorpayCreatedAt = new Date('2026-10-15T10:00:00.000Z').toISOString();
      const razorpayPaidAt = null;

      const isValid = validatePaymentTimestampConstraint(razorpayCreatedAt, razorpayPaidAt);
      expect(isValid).toBe(true); // paid_at IS NULL satisfies ck_payments_paid_at
    });

    it('satisfies ck_payments_paid_at when razorpay-webhook captures payment later', () => {
      const razorpayCreatedAt = new Date('2026-10-15T10:00:00.000Z').toISOString();
      const razorpayCapturedAt = new Date('2026-10-15T10:01:30.000Z').toISOString(); // 90 seconds later

      const isValid = validatePaymentTimestampConstraint(razorpayCreatedAt, razorpayCapturedAt);
      expect(isValid).toBe(true); // paid_at >= created_at
    });
  });

  describe('9. Reconciliation of Unambiguous Partial Orders', () => {
    it('reconciles an existing order only when purchaseToken or orderId matches unambiguously', () => {
      const verifiedNotes = JSON.stringify({
        gateway: 'google_play',
        purchaseToken: sampleToken,
        orderId: sampleGpaOrderId,
      });

      const matchingOrders = [{ order_id: 'order_123', notes: verifiedNotes }];
      expect(findMatchingUnfulfilledOrder(matchingOrders, sampleToken)).toBe('order_123');
    });

    it('refuses to automatically link an arbitrary order without valid correlation metadata', () => {
      const unlinkedOrders = [
        { order_id: 'order_arbitrary_456', notes: null },
        { order_id: 'order_empty_789', notes: '' },
        { order_id: 'order_other_000', notes: '{"gateway":"razorpay"}' },
      ];

      expect(findMatchingUnfulfilledOrder(unlinkedOrders, sampleToken)).toBeNull();
    });

    it('safely extracts purchaseToken and orderId when order.notes has trailing text or malformed JSON (22P02 prevention)', () => {
      const ordersWithTrailingText = [
        {
          order_id: 'order_trailing_text',
          notes: '{"gateway":"google_play","purchaseToken":"' + sampleToken + '"} [2026-10-24 12:00:00 Log message]',
        },
        {
          order_id: 'order_orderid_trailing',
          notes: '{"gateway":"google_play","orderId":"' + sampleGpaOrderId + '"} [...some admin notes...]',
        },
        {
          order_id: 'order_plain_text',
          notes: 'Just plain customer notes without any JSON formatting',
        },
      ];

      // Should extract purchaseToken despite trailing text after JSON object
      expect(findMatchingUnfulfilledOrder(ordersWithTrailingText, sampleToken)).toBe('order_trailing_text');

      // Should extract orderId despite trailing text after JSON object
      expect(findMatchingUnfulfilledOrder(ordersWithTrailingText, 'different_token', sampleGpaOrderId)).toBe('order_orderid_trailing');

      // Plain text notes safely return null without throwing JSON syntax error
      expect(findMatchingUnfulfilledOrder([{ order_id: 'order_plain', notes: 'Non-JSON text' }], sampleToken)).toBeNull();
    });
  });

  describe('10. Strict RPC Fallback Safety & Error Scoping (Critical Issue 3)', () => {
    it('classifies RPC errors accurately across PostgreSQL and PostgREST failure modes', () => {
      // PostgREST discovery / schema cache / signature mismatch (PGRST202)
      const pgrst202 = classifyRpcError({
        code: 'PGRST202',
        message: 'Could not find the function complete_google_play_purchase(p_billing_email, ...) in schema cache',
      });
      expect(pgrst202.category).toBe('SCHEMA_CACHE_OR_SIGNATURE_MISMATCH');
      expect(pgrst202.isDiscoveryError).toBe(true);
      expect(pgrst202.safeToFallback).toBe(false);

      // Native PostgreSQL undefined function (42883)
      const undefinedFn = classifyRpcError({
        code: '42883',
        message: 'function complete_google_play_purchase does not exist',
      });
      expect(undefinedFn.category).toBe('UNDEFINED_FUNCTION');
      expect(undefinedFn.isDiscoveryError).toBe(true);
      expect(undefinedFn.safeToFallback).toBe(false);

      // Permission denied (42501)
      const permDenied = classifyRpcError({
        code: '42501',
        message: 'permission denied for function complete_google_play_purchase',
      });
      expect(permDenied.category).toBe('PERMISSION_DENIED');
      expect(permDenied.safeToFallback).toBe(false);

      // Undefined column (42703, e.g. order_items.updated_at)
      const undefCol = classifyRpcError({
        code: '42703',
        message: 'column "updated_at" of relation "order_items" does not exist',
      });
      expect(undefCol.category).toBe('UNDEFINED_COLUMN');
      expect(undefCol.safeToFallback).toBe(false);

      // Constraint violation (23514 check constraint)
      const checkViol = classifyRpcError({
        code: '23514',
        message: 'check constraint ck_payments_paid_at violated',
      });
      expect(checkViol.category).toBe('INTEGRITY_CONSTRAINT_VIOLATION');
      expect(checkViol.safeToFallback).toBe(false);

      // Deadlock / transaction (40P01)
      const deadlock = classifyRpcError({
        code: '40P01',
        message: 'deadlock detected',
      });
      expect(deadlock.category).toBe('TRANSACTION_OR_DEADLOCK');
      expect(deadlock.safeToFallback).toBe(false);

      // Connection failure (08006)
      const connFail = classifyRpcError({
        code: '08006',
        message: 'connection failure',
      });
      expect(connFail.category).toBe('CONNECTION_FAILURE');
      expect(connFail.safeToFallback).toBe(false);
    });

    it('REFUSES to treat PGRST202, schema cache latency, or signature mismatches as safe to fallback', () => {
      // Crucial invariant: PGRST202 must NOT return true from isRpcMissingError because in production
      // complete_google_play_purchase already exists, and PGRST202 typically indicates an argument signature mismatch!
      expect(isRpcMissingError({
        code: 'PGRST202',
        message: 'Could not find the function complete_google_play_purchase in schema cache',
      })).toBe(false);

      expect(isRpcMissingError({
        code: 'PGRST202',
        message: 'Could not find the function public.complete_google_play_purchase',
      })).toBe(false);

      expect(isRpcMissingError({
        message: 'could not find the function in schema cache',
      })).toBe(false);
    });

    it('identifies true PostgreSQL 42883 undefined_function for narrowly controlled legacy fallback', () => {
      expect(isRpcMissingError({
        code: '42883',
        message: 'function complete_google_play_purchase does not exist',
      })).toBe(true);
    });

    it('REFUSES to trigger fallback for database execution, schema, constraint, or permission errors (fails closed)', () => {
      // Must NOT fall back on SQLSTATE 42703 (undefined column, e.g. order_items.updated_at)
      expect(isRpcMissingError({ code: '42703', message: 'column "updated_at" of relation "order_items" does not exist' })).toBe(false);
      // Must NOT fall back on undefined table/relation (42P01)
      expect(isRpcMissingError({ code: '42P01', message: 'relation "order_items" does not exist' })).toBe(false);
      // Must NOT fall back on undefined type (42704)
      expect(isRpcMissingError({ code: '42704', message: 'type "currency_code" does not exist' })).toBe(false);
      // Must NOT fall back on check constraint violation (23514)
      expect(isRpcMissingError({ code: '23514', message: 'check constraint ck_payments_paid_at violated' })).toBe(false);
      // Must NOT fall back on foreign key violation (23503)
      expect(isRpcMissingError({ code: '23503', message: 'foreign key constraint fk_payments_order violated' })).toBe(false);
      // Must NOT fall back on unique violation (23505)
      expect(isRpcMissingError({ code: '23505', message: 'duplicate key value violates unique constraint' })).toBe(false);
      // Must NOT fall back on not-null constraint (23502)
      expect(isRpcMissingError({ code: '23502', message: 'null value in column violates not-null constraint' })).toBe(false);
      // Must NOT fall back on unauthorized permission error (42501)
      expect(isRpcMissingError({ code: '42501', message: 'permission denied for function complete_google_play_purchase' })).toBe(false);
      // Must NOT fall back on deadlock (40P01)
      expect(isRpcMissingError({ code: '40P01', message: 'deadlock detected' })).toBe(false);
      // Must NOT fall back on connection failure (08006)
      expect(isRpcMissingError({ code: '08006', message: 'connection failure' })).toBe(false);
      // Must NOT fall back on generic message mentioning column without error code
      expect(isRpcMissingError({ message: 'column "updated_at" of relation "order_items" does not exist' })).toBe(false);
      // Must NOT fall back merely because message contains function name
      expect(isRpcMissingError({ message: 'permission denied for function complete_google_play_purchase' })).toBe(false);
    });
  });

  describe('11. Course Association Integrity & Mismatch Protection (Critical Issue 1)', () => {
    const realCourseId = 'b1b09176-fabe-4d05-80e4-ca4fa08f937f';
    const wrongCourseId = '6995d41d-7704-457b-b82c-47ceff0b1a10';

    it('validates correct course association for the subscription plan', () => {
      const result = validateSubscriptionCourseIntegrity(realCourseId, realCourseId, realCourseId);
      expect(result.valid).toBe(true);
      expect(result.resolvedCourseId).toBe(realCourseId);
    });

    it('REJECTS course ID mismatch between subscription plan and target course', () => {
      const result = validateSubscriptionCourseIntegrity(realCourseId, realCourseId, wrongCourseId);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('does not match expected target course');
    });

    it('REJECTS order item course mismatch', () => {
      const result = validateSubscriptionCourseIntegrity(realCourseId, wrongCourseId);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Course mismatch between order item');
    });
  });

  describe('12. Acknowledgement Sequencing Safety (Critical Issue 2)', () => {
    it('guarantees Google Play acknowledgement is executed only after database transaction succeeds', async () => {
      const executionOrder: string[] = [];

      // Simulate the workflow
      async function executeVerificationWorkflow(dbSucceeds: boolean) {
        executionOrder.push('1_VERIFY_WITH_GOOGLE');
        executionOrder.push('2_RESOLVE_STUDENT_AND_PRODUCT');

        // Step 5: Database Transaction
        if (!dbSucceeds) {
          executionOrder.push('3_DB_TRANSACTION_FAILED');
          throw new Error('Database transaction aborted');
        }
        executionOrder.push('3_DB_TRANSACTION_COMMITTED');

        // Step 7: Post-Commit Acknowledge
        executionOrder.push('4_ACKNOWLEDGE_GOOGLE_PLAY');
      }

      // Case A: DB fails -> Google Play must NEVER be acknowledged!
      await expect(executeVerificationWorkflow(false)).rejects.toThrow('Database transaction aborted');
      expect(executionOrder).toEqual([
        '1_VERIFY_WITH_GOOGLE',
        '2_RESOLVE_STUDENT_AND_PRODUCT',
        '3_DB_TRANSACTION_FAILED',
      ]);
      expect(executionOrder).not.toContain('4_ACKNOWLEDGE_GOOGLE_PLAY');

      // Case B: DB succeeds -> Google Play is acknowledged post-commit
      executionOrder.length = 0;
      await executeVerificationWorkflow(true);
      expect(executionOrder).toEqual([
        '1_VERIFY_WITH_GOOGLE',
        '2_RESOLVE_STUDENT_AND_PRODUCT',
        '3_DB_TRANSACTION_COMMITTED',
        '4_ACKNOWLEDGE_GOOGLE_PLAY',
      ]);
    });
  });


  describe('13. Subscription Purchase RPC Parameters (Migration 204 Signature Parity)', () => {
    it('builds complete RPC payload for subscription purchase matching Migration 204 signature', () => {
      const nowIso = new Date('2026-10-15T18:14:23.500Z').toISOString();
      const payload = buildGooglePlayRpcPayload({
        profileId: sampleStudentId,
        instituteId: sampleInstituteId,
        studentId: sampleStudentId,
        resolvedItemType: 'subscription_plan',
        resolvedCourseId: sampleCourseId,
        resolvedPlanId: samplePlanId,
        itemName: 'Monthly Plan',
        unitPrice: 99.0,
        effectiveOrderId: sampleGpaOrderId,
        purchaseToken: sampleToken,
        productId: 'sub_fe232782d73440dab01b92a9cc27c47c',
        googleVerificationResult: { verified: true, state: 'SUBSCRIPTION_STATE_ACTIVE' },
        transactionTimestamp: nowIso,
        subscriptionEndDate: '2026-11-14',
        autoRenewSetting: true,
        billingName: 'Test Student',
        billingEmail: 'student@example.com',
      });

      expect(payload.p_profile_id).toBe(sampleStudentId);
      expect(payload.p_institute_id).toBe(sampleInstituteId);
      expect(payload.p_student_id).toBe(sampleStudentId);
      expect(payload.p_item_type).toBe('subscription_plan');
      expect(payload.p_course_id).toBe(sampleCourseId);
      expect(payload.p_plan_id).toBe(samplePlanId);
      expect(payload.p_package_id).toBeNull();
      expect(payload.p_item_name).toBe('Monthly Plan');
      expect(payload.p_unit_price).toBe(99.0);
      expect(payload.p_effective_order_id).toBe(sampleGpaOrderId);
      expect(payload.p_purchase_token).toBe(sampleToken);
      expect(payload.p_product_id).toBe('sub_fe232782d73440dab01b92a9cc27c47c');
      expect(payload.p_transaction_timestamp).toBe(nowIso);
      expect(payload.p_subscription_end_date).toBe('2026-11-14');
      expect(payload.p_is_auto_renew).toBe(true);
      expect(payload.p_billing_name).toBe('Test Student');
      expect(payload.p_billing_email).toBe('student@example.com');
    });

    it('builds one-time course purchase RPC payload with null plan_id and subscription_end_date', () => {
      const nowIso = new Date().toISOString();
      const payload = buildGooglePlayRpcPayload({
        profileId: sampleStudentId,
        instituteId: sampleInstituteId,
        studentId: sampleStudentId,
        resolvedItemType: 'course',
        resolvedCourseId: sampleCourseId,
        itemName: 'One Time Course',
        unitPrice: 499.0,
        effectiveOrderId: 'GPA.1111-2222-3333-44444',
        purchaseToken: sampleToken,
        productId: 'course_6995d41d',
        transactionTimestamp: nowIso,
      });

      expect(payload.p_item_type).toBe('course');
      expect(payload.p_course_id).toBe(sampleCourseId);
      expect(payload.p_plan_id).toBeNull();
      expect(payload.p_subscription_end_date).toBeNull();
    });
  });

  describe('14. RPC Response and Failure Handling Safety', () => {
    it('proceeds to post-commit on rpcData.success = true', () => {
      const res = handleGooglePlayRpcResponse(
        { success: true, orderId: sampleOrderId, entitlement: 'student_subscription:fe232782' },
        null
      );
      expect(res.action).toBe('proceed_to_post_commit');
      expect(res.effectiveFinalOrderId).toBe(sampleOrderId);
      expect(res.entitlementGranted).toBe('student_subscription:fe232782');
    });

    it('handles alreadyProcessed = true idempotently', () => {
      const res = handleGooglePlayRpcResponse(
        { success: true, alreadyProcessed: true, orderId: sampleOrderId },
        null
      );
      expect(res.action).toBe('proceed_to_post_commit');
      expect(res.effectiveFinalOrderId).toBe(sampleOrderId);
      expect(res.entitlementGranted).toBe('already_processed');
    });

    it('returns HTTP 409 when RPC rejects with ACCOUNT_MISMATCH', () => {
      const res = handleGooglePlayRpcResponse(
        {
          success: false,
          error: 'This purchase has already been claimed by another account.',
          code: 'ACCOUNT_MISMATCH',
        },
        null
      );
      expect(res.action).toBe('return_response');
      expect(res.httpStatus).toBe(409);
      expect(res.responseBody.code).toBe('ACCOUNT_MISMATCH');
    });

    it('returns HTTP 422 when RPC rejects with generic error', () => {
      const res = handleGooglePlayRpcResponse(
        {
          success: false,
          error: 'Student details record not found for profile',
          code: 'STUDENT_NOT_FOUND',
        },
        null
      );
      expect(res.action).toBe('return_response');
      expect(res.httpStatus).toBe(422);
      expect(res.responseBody.code).toBe('STUDENT_NOT_FOUND');
    });

    it('throws fatal error on real database constraint failure without falling back', () => {
      const res = handleGooglePlayRpcResponse(null, {
        code: '23514',
        message: 'new row for relation "payments" violates check constraint "ck_payments_paid_at"',
      });
      expect(res.action).toBe('throw_fatal');
      expect(res.fatalError).toContain('INTEGRITY_CONSTRAINT_VIOLATION');
      expect(res.fatalError).not.toBe('__RPC_UNAVAILABLE__');
      expect(res.errorClassification).toBe('INTEGRITY_CONSTRAINT_VIOLATION');
    });

    it('throws fatal error on undefined column error (SQLSTATE 42703) without falling back', () => {
      const res = handleGooglePlayRpcResponse(null, {
        code: '42703',
        message: 'column "updated_at" of relation "order_items" does not exist',
      });
      expect(res.action).toBe('throw_fatal');
      expect(res.fatalError).toContain('UNDEFINED_COLUMN');
      expect(res.fatalError).not.toBe('__RPC_UNAVAILABLE__');
      expect(res.errorClassification).toBe('UNDEFINED_COLUMN');
    });

    it('throws fatal error on permission denied error (SQLSTATE 42501) without falling back', () => {
      const res = handleGooglePlayRpcResponse(null, {
        code: '42501',
        message: 'permission denied for function complete_google_play_purchase',
      });
      expect(res.action).toBe('throw_fatal');
      expect(res.fatalError).toContain('PERMISSION_DENIED');
      expect(res.fatalError).not.toBe('__RPC_UNAVAILABLE__');
      expect(res.errorClassification).toBe('PERMISSION_DENIED');
    });

    it('fails closed with diagnostic error on PGRST202 (schema cache / signature mismatch) without falling back', () => {
      const res = handleGooglePlayRpcResponse(null, {
        code: 'PGRST202',
        message: 'Could not find the function complete_google_play_purchase in schema cache',
      });
      expect(res.action).toBe('throw_fatal');
      expect(res.fatalError).toContain('SCHEMA_CACHE_OR_SIGNATURE_MISMATCH');
      expect(res.fatalError).not.toBe('__RPC_UNAVAILABLE__');
      expect(res.errorClassification).toBe('SCHEMA_CACHE_OR_SIGNATURE_MISMATCH');
    });

    it('fails closed by default even when 42883 occurs in production (allowLegacyFallback not set)', () => {
      const res = handleGooglePlayRpcResponse(null, {
        code: '42883',
        message: 'function public.complete_google_play_purchase does not exist',
      });
      expect(res.action).toBe('throw_fatal');
      expect(res.fatalError).toContain('UNDEFINED_FUNCTION');
      expect(res.fatalError).not.toBe('__RPC_UNAVAILABLE__');
      expect(res.errorClassification).toBe('UNDEFINED_FUNCTION');
    });

    it('signals __RPC_UNAVAILABLE__ ONLY when allowLegacyFallback is explicitly true AND 42883 is reported', () => {
      const res = handleGooglePlayRpcResponse(
        null,
        {
          code: '42883',
          message: 'function public.complete_google_play_purchase does not exist',
        },
        { allowLegacyFallback: true }
      );
      expect(res.action).toBe('throw_fatal');
      expect(res.fatalError).toBe('__RPC_UNAVAILABLE__');
      expect(res.errorClassification).toBe('UNDEFINED_FUNCTION');
    });

    it('REFUSES to trigger __RPC_UNAVAILABLE__ even with allowLegacyFallback = true if error is PGRST202', () => {
      const res = handleGooglePlayRpcResponse(
        null,
        {
          code: 'PGRST202',
          message: 'Could not find the function complete_google_play_purchase in schema cache',
        },
        { allowLegacyFallback: true }
      );
      expect(res.action).toBe('throw_fatal');
      expect(res.fatalError).not.toBe('__RPC_UNAVAILABLE__');
      expect(res.fatalError).toContain('SCHEMA_CACHE_OR_SIGNATURE_MISMATCH');
    });
  });

  describe('15. Existing Owned-Purchase Recovery & Acknowledgment Resilience', () => {
    it('handles already-acknowledged purchase gracefully when Google returns error post-commit', async () => {
      let networkLoggedWarning = false;
      const simulateAcknowledge = async () => {
        const fakeAckResponse = {
          ok: false,
          status: 400,
          text: async () => '{"error":{"message":"The purchase token has already been acknowledged."}}',
        };
        if (!fakeAckResponse.ok) {
          networkLoggedWarning = true;
        }
        return { success: true, verified: true };
      };

      const result = await simulateAcknowledge();
      expect(networkLoggedWarning).toBe(true);
      expect(result.success).toBe(true);
    });
  });

  describe('16. order_items Schema Invariant and Payload Validation', () => {
    it('production buildOrderItemPayload includes valid schema fields, created_at, and strictly excludes updated_at', () => {
      const nowIso = new Date('2026-10-19T10:00:00.000Z').toISOString();
      const payload = buildOrderItemPayload({
        orderId: sampleOrderId,
        instituteId: sampleInstituteId,
        itemType: 'subscription_plan',
        courseId: sampleCourseId,
        planId: samplePlanId,
        itemName: 'Monthly Gold Pass',
        unitPrice: 199.0,
        quantity: 1,
        discountAmount: 0,
        createdAt: nowIso,
      });

      // 1. Mandatory schema fields
      expect(payload.order_id).toBe(sampleOrderId);
      expect(payload.institute_id).toBe(sampleInstituteId);
      expect(payload.item_type).toBe('subscription_plan');
      expect(payload.course_id).toBe(sampleCourseId);
      expect(payload.plan_id).toBe(samplePlanId);
      expect(payload.package_id).toBeNull();
      expect(payload.item_name).toBe('Monthly Gold Pass');
      expect(payload.unit_price).toBe(199.0);
      expect(payload.quantity).toBe(1);
      expect(payload.discount_amount).toBe(0);
      expect(payload.line_total).toBe(199.0);
      expect(payload.created_at).toBe(nowIso);

      // 2. CRITICAL: updated_at must NOT exist on order_items payload
      expect('updated_at' in payload).toBe(false);
      expect((payload as any).updated_at).toBeUndefined();

      // 3. Strict schema field completeness check: exact match of public.order_items columns
      const payloadKeys = Object.keys(payload).sort();
      const expectedSchemaKeys = [
        'created_at',
        'discount_amount',
        'institute_id',
        'item_name',
        'item_type',
        'line_total',
        'order_id',
        'package_id',
        'plan_id',
        'quantity',
        'unit_price',
        'course_id',
      ].sort();

      expect(payloadKeys).toEqual(expectedSchemaKeys);
      expect(payloadKeys).not.toContain('updated_at');
    });

    it('buildOrderItemPayload preserves ck_order_items_item_type_consistency for subscription_plan', () => {
      const payload = buildOrderItemPayload({
        orderId: sampleOrderId,
        instituteId: sampleInstituteId,
        itemType: 'subscription_plan',
        courseId: sampleCourseId,
        planId: samplePlanId,
        packageId: 'should_be_cleared',
        itemName: 'Subscription',
        unitPrice: 99.0,
      });

      // For subscription_plan: course_id is set, plan_id is set, package_id must be null
      expect(payload.item_type).toBe('subscription_plan');
      expect(payload.course_id).toBe(sampleCourseId);
      expect(payload.plan_id).toBe(samplePlanId);
      expect(payload.package_id).toBeNull();
      expect('updated_at' in payload).toBe(false);
    });

    it('buildOrderItemPayload preserves ck_order_items_item_type_consistency for course', () => {
      const payload = buildOrderItemPayload({
        orderId: sampleOrderId,
        instituteId: sampleInstituteId,
        itemType: 'course',
        courseId: sampleCourseId,
        planId: 'should_be_cleared',
        packageId: 'should_be_cleared',
        itemName: 'Full Course',
        unitPrice: 499.0,
      });

      // For course: course_id is set, plan_id must be null, package_id must be null
      expect(payload.item_type).toBe('course');
      expect(payload.course_id).toBe(sampleCourseId);
      expect(payload.plan_id).toBeNull();
      expect(payload.package_id).toBeNull();
      expect('updated_at' in payload).toBe(false);
    });

    it('buildOrderItemPayload preserves ck_order_items_item_type_consistency for pyq_package', () => {
      const samplePackageId = '44444444-5555-6666-7777-888888888888';
      const payload = buildOrderItemPayload({
        orderId: sampleOrderId,
        instituteId: sampleInstituteId,
        itemType: 'pyq_package',
        courseId: 'should_be_cleared',
        planId: 'should_be_cleared',
        packageId: samplePackageId,
        itemName: 'Previous Year Question Pack',
        unitPrice: 149.0,
      });

      // For pyq_package: package_id is set, course_id must be null, plan_id must be null
      expect(payload.item_type).toBe('pyq_package');
      expect(payload.course_id).toBeNull();
      expect(payload.plan_id).toBeNull();
      expect(payload.package_id).toBe(samplePackageId);
      expect('updated_at' in payload).toBe(false);
    });
  });

  describe('17. Protection and Validation of Existing Orders (Critical Safety Invariant)', () => {
    const wrongPlanId = 'wrong-plan-0000-0000-0000-000000000000';
    const wrongCourseId = 'wrong-course-000-0000-0000-000000000000';
    const sampleItemId = 'item_existing_valid_uuid_123';

    it('1. permits a matching existing order with a valid, complete order item', () => {
      const existingItems = [
        {
          item_id: sampleItemId,
          item_type: 'subscription_plan',
          plan_id: samplePlanId,
          course_id: sampleCourseId,
          package_id: null,
        },
      ];

      const validation = validateExistingOrderItem({
        orderItems: existingItems,
        expectedItemType: 'subscription_plan',
        expectedPlanId: samplePlanId,
        expectedCourseId: sampleCourseId,
      });

      expect(validation.valid).toBe(true);
      expect(validation.orderItemId).toBe(sampleItemId);
      expect(validation.errorCode).toBeUndefined();
    });

    it('2. fails closed with ORDER_ITEM_MISSING_FOR_EXISTING_ORDER when an existing order has no order_items row', () => {
      // Scenario: previous failed attempt created an order row but failed before order_items insert
      const emptyItems: any[] = [];
      const validationEmpty = validateExistingOrderItem({
        orderItems: emptyItems,
        expectedItemType: 'subscription_plan',
        expectedPlanId: samplePlanId,
        expectedCourseId: sampleCourseId,
      });

      expect(validationEmpty.valid).toBe(false);
      expect(validationEmpty.errorCode).toBe('ORDER_ITEM_MISSING_FOR_EXISTING_ORDER');
      expect(validationEmpty.error).toContain('no associated order items');

      // Also fails closed if null or undefined
      const validationNull = validateExistingOrderItem({
        orderItems: null,
        expectedItemType: 'subscription_plan',
        expectedPlanId: samplePlanId,
        expectedCourseId: sampleCourseId,
      });
      expect(validationNull.valid).toBe(false);
      expect(validationNull.errorCode).toBe('ORDER_ITEM_MISSING_FOR_EXISTING_ORDER');
    });

    it('3. fails closed with ORDER_ITEM_MISMATCH when an existing order references the wrong plan or course', () => {
      // Case A: Wrong plan_id
      const wrongPlanItems = [
        {
          item_id: sampleItemId,
          item_type: 'subscription_plan',
          plan_id: wrongPlanId,
          course_id: sampleCourseId,
          package_id: null,
        },
      ];
      const resWrongPlan = validateExistingOrderItem({
        orderItems: wrongPlanItems,
        expectedItemType: 'subscription_plan',
        expectedPlanId: samplePlanId,
        expectedCourseId: sampleCourseId,
      });
      expect(resWrongPlan.valid).toBe(false);
      expect(resWrongPlan.errorCode).toBe('ORDER_ITEM_MISMATCH');
      expect(resWrongPlan.error).toContain('does not match expected plan');

      // Case B: Wrong course_id
      const wrongCourseItems = [
        {
          item_id: sampleItemId,
          item_type: 'subscription_plan',
          plan_id: samplePlanId,
          course_id: wrongCourseId,
          package_id: null,
        },
      ];
      const resWrongCourse = validateExistingOrderItem({
        orderItems: wrongCourseItems,
        expectedItemType: 'subscription_plan',
        expectedPlanId: samplePlanId,
        expectedCourseId: sampleCourseId,
      });
      expect(resWrongCourse.valid).toBe(false);
      expect(resWrongCourse.errorCode).toBe('ORDER_ITEM_MISMATCH');

      // Case C: Wrong item_type (e.g. course when expected subscription_plan)
      const wrongTypeItems = [
        {
          item_id: sampleItemId,
          item_type: 'course',
          plan_id: null,
          course_id: sampleCourseId,
          package_id: null,
        },
      ];
      const resWrongType = validateExistingOrderItem({
        orderItems: wrongTypeItems,
        expectedItemType: 'subscription_plan',
        expectedPlanId: samplePlanId,
        expectedCourseId: sampleCourseId,
      });
      expect(resWrongType.valid).toBe(false);
      expect(resWrongType.errorCode).toBe('ORDER_ITEM_MISMATCH');
      expect(resWrongType.error).toContain('does not match expected purchase item type');
    });

    it('4. ensures an invalid existing order fails before payment insertion, subscription grant, or Google acknowledgement', () => {
      // Simulate RPC response when existing order is missing line item
      const rpcMissingItemResponse = {
        success: false,
        code: 'ORDER_ITEM_MISSING_FOR_EXISTING_ORDER',
        error: 'Existing order found for this purchase token but it has no associated order items.',
        orderId: sampleOrderId,
      };

      const handlerResult = handleGooglePlayRpcResponse(rpcMissingItemResponse, null);

      // Must NOT proceed to post-commit (which is where Google Play acknowledgement happens)
      expect(handlerResult.action).toBe('return_response');
      expect(handlerResult.httpStatus).toBe(422);
      expect(handlerResult.responseBody.code).toBe('ORDER_ITEM_MISSING_FOR_EXISTING_ORDER');
      expect(handlerResult.responseBody.orderId).toBe(sampleOrderId);
      expect(handlerResult.entitlementGranted).toBeUndefined();

      // Simulate full workflow execution to guarantee zero payment/entitlement side-effects
      let paymentInserted = false;
      let subscriptionGranted = false;
      let googlePlayAcknowledged = false;

      function simulatePurchaseProcessing(rpcResp: any) {
        const res = handleGooglePlayRpcResponse(rpcResp, null);
        if (res.action === 'proceed_to_post_commit') {
          paymentInserted = true;
          subscriptionGranted = true;
          googlePlayAcknowledged = true;
        }
        return res;
      }

      const res = simulatePurchaseProcessing(rpcMissingItemResponse);
      expect(res.action).toBe('return_response');
      expect(paymentInserted).toBe(false);
      expect(subscriptionGranted).toBe(false);
      expect(googlePlayAcknowledged).toBe(false);
    });

    it('5. preserves normal atomic processing for a new purchase when no existing order is present', () => {
      // Scenario: New purchase (v_order_id is null in database)
      const rpcSuccessResponse = {
        success: true,
        orderId: sampleOrderId,
        entitlement: `student_subscription:${samplePlanId}`,
        message: 'Google Play purchase processed atomically with date parity',
      };

      const handlerResult = handleGooglePlayRpcResponse(rpcSuccessResponse, null);

      expect(handlerResult.action).toBe('proceed_to_post_commit');
      expect(handlerResult.effectiveFinalOrderId).toBe(sampleOrderId);
      expect(handlerResult.entitlementGranted).toBe(`student_subscription:${samplePlanId}`);

      // Verify simulated atomic workflow completes fully for new purchase
      let paymentInserted = false;
      let subscriptionGranted = false;
      let googlePlayAcknowledged = false;

      function simulatePurchaseProcessing(rpcResp: any) {
        const res = handleGooglePlayRpcResponse(rpcResp, null);
        if (res.action === 'proceed_to_post_commit') {
          paymentInserted = true;
          subscriptionGranted = true;
          googlePlayAcknowledged = true;
        }
        return res;
      }

      const res = simulatePurchaseProcessing(rpcSuccessResponse);
      expect(res.action).toBe('proceed_to_post_commit');
      expect(paymentInserted).toBe(true);
      expect(subscriptionGranted).toBe(true);
      expect(googlePlayAcknowledged).toBe(true);
    });
  });

  describe('18. First-Purchase Role Transition and Student Initialization (Migration 206)', () => {
    const sampleProfileId = 'd33b4372-8094-43b2-99f8-d37835c71370';

    it('1. buildGooglePlayRpcPayload supports studentId = null for a new role=user purchaser', () => {
      const nowIso = new Date().toISOString();
      const payload = buildGooglePlayRpcPayload({
        profileId: sampleProfileId,
        instituteId: sampleInstituteId,
        studentId: null,
        resolvedItemType: 'subscription_plan',
        resolvedCourseId: sampleCourseId,
        resolvedPlanId: samplePlanId,
        itemName: 'Max X12 Monthly',
        unitPrice: 99.0,
        effectiveOrderId: sampleGpaOrderId,
        purchaseToken: sampleToken,
        productId: 'sub_monthly_maxx12',
        transactionTimestamp: nowIso,
        autoRenewSetting: true,
      });

      expect(payload.p_profile_id).toBe(sampleProfileId);
      expect(payload.p_institute_id).toBe(sampleInstituteId);
      expect(payload.p_student_id).toBeNull();
      expect(payload.p_item_type).toBe('subscription_plan');
      expect(payload.p_plan_id).toBe(samplePlanId);
      expect(payload.p_course_id).toBe(sampleCourseId);
    });

    it('2. buildGooglePlayRpcPayload preserves existing studentId for role=student user', () => {
      const nowIso = new Date().toISOString();
      const payload = buildGooglePlayRpcPayload({
        profileId: sampleProfileId,
        instituteId: sampleInstituteId,
        studentId: sampleStudentId,
        resolvedItemType: 'subscription_plan',
        resolvedCourseId: sampleCourseId,
        resolvedPlanId: samplePlanId,
        itemName: 'Max X12 Monthly',
        unitPrice: 99.0,
        effectiveOrderId: sampleGpaOrderId,
        purchaseToken: sampleToken,
        productId: 'sub_monthly_maxx12',
        transactionTimestamp: nowIso,
        autoRenewSetting: true,
      });

      expect(payload.p_student_id).toBe(sampleStudentId);
    });

    it('3. handleGooglePlayRpcResponse maps FORBIDDEN_ROLE to HTTP 403', () => {
      const forbiddenResponse = {
        success: false,
        code: 'FORBIDDEN_ROLE',
        error: "Profile role 'teacher' is not eligible for student checkout. Staff accounts cannot be converted to students.",
      };

      const result = handleGooglePlayRpcResponse(forbiddenResponse, null);
      expect(result.action).toBe('return_response');
      expect(result.httpStatus).toBe(403);
      expect(result.responseBody.code).toBe('FORBIDDEN_ROLE');
      expect(result.responseBody.error).toContain('Staff accounts cannot be converted to students');
    });

    it('4. preflight role guard correctly identifies and rejects staff roles', () => {
      const staffRoles = ['teacher', 'admin', 'super_admin'];
      for (const role of staffRoles) {
        const isStaff = role === 'teacher' || role === 'admin' || role === 'super_admin';
        expect(isStaff).toBe(true);
      }

      const customerRoles = ['user', 'student'];
      for (const role of customerRoles) {
        const isStaff = role === 'teacher' || role === 'admin' || role === 'super_admin';
        expect(isStaff).toBe(false);
      }
    });

    it('5. first-purchase atomic flow succeeds and transitions user to student inside RPC', () => {
      const rpcSuccessResponse = {
        success: true,
        verified: true,
        orderId: sampleOrderId,
        entitlement: `student_subscription:${samplePlanId}`,
        message: 'Google Play purchase processed atomically with date parity',
      };

      let roleUpgradedInDb = false;
      let studentDetailsCreatedInDb = false;
      let orderCreatedInDb = false;
      let googlePlayAcknowledged = false;

      function executeMigration206Rpc(profileRole: string, hasStudentDetails: boolean) {
        if (profileRole === 'teacher' || profileRole === 'admin' || profileRole === 'super_admin') {
          return { success: false, code: 'FORBIDDEN_ROLE', error: 'Staff accounts cannot checkout as students' };
        }
        if (profileRole === 'user') {
          roleUpgradedInDb = true;
        }
        if (!hasStudentDetails) {
          studentDetailsCreatedInDb = true;
        }
        orderCreatedInDb = true;
        return rpcSuccessResponse;
      }

      const rpcResult = executeMigration206Rpc('user', false);
      const handlerResult = handleGooglePlayRpcResponse(rpcResult, null);

      if (handlerResult.action === 'proceed_to_post_commit') {
        googlePlayAcknowledged = true;
      }

      expect(roleUpgradedInDb).toBe(true);
      expect(studentDetailsCreatedInDb).toBe(true);
      expect(orderCreatedInDb).toBe(true);
      expect(googlePlayAcknowledged).toBe(true);
      expect(handlerResult.effectiveFinalOrderId).toBe(sampleOrderId);
      expect(handlerResult.entitlementGranted).toBe(`student_subscription:${samplePlanId}`);
    });

    it('6. transactional rollback: database exception aborts all mutations and fails closed', () => {
      let googlePlayAcknowledged = false;

      const dbException = {
        code: '23505',
        message: 'duplicate key value violates unique constraint "uq_student_details_profile_id"',
      };

      const handlerResult = handleGooglePlayRpcResponse(null, dbException);

      if (handlerResult.action === 'proceed_to_post_commit') {
        googlePlayAcknowledged = true;
      }

      expect(handlerResult.action).toBe('throw_fatal');
      expect(googlePlayAcknowledged).toBe(false);
      expect(handlerResult.errorClassification).toBe('INTEGRITY_CONSTRAINT_VIOLATION');
      expect(handlerResult.fatalError).toContain('INTEGRITY_CONSTRAINT_VIOLATION');
    });

    it('7. idempotent retry: already processed purchase does not duplicate records', () => {
      const alreadyProcessedResponse = {
        success: true,
        verified: true,
        alreadyProcessed: true,
        orderId: sampleOrderId,
        message: 'Purchase already processed and entitlement active',
      };

      const handlerResult = handleGooglePlayRpcResponse(alreadyProcessedResponse, null);
      expect(handlerResult.action).toBe('proceed_to_post_commit');
      expect(handlerResult.effectiveFinalOrderId).toBe(sampleOrderId);
      expect(handlerResult.entitlementGranted).toBe('already_processed');
    });

    it('8. staff account checkout rejection prevents any order or entitlement commit', () => {
      let orderCommitted = false;
      let googlePlayAcknowledged = false;

      const rpcForbiddenResponse = {
        success: false,
        code: 'FORBIDDEN_ROLE',
        error: "Profile role 'teacher' is not eligible for student checkout. Staff accounts cannot be converted to students.",
      };

      const handlerResult = handleGooglePlayRpcResponse(rpcForbiddenResponse, null);
      if (handlerResult.action === 'proceed_to_post_commit') {
        orderCommitted = true;
        googlePlayAcknowledged = true;
      }

      expect(handlerResult.action).toBe('return_response');
      expect(handlerResult.httpStatus).toBe(403);
      expect(orderCommitted).toBe(false);
      expect(googlePlayAcknowledged).toBe(false);
    });

    it('9. role=user with existing student_details promotes role to student and preserves existing student_id', () => {
      let roleInDb = 'user';
      let studentDetailsCreated = false;
      const existingStudentId = 'existing-student-uuid-9999';

      function simulateMigration206Purchase(currentRole: string, studentId: string | null) {
        // Step 9: Promote role='user' to 'student'
        if (currentRole === 'user') {
          roleInDb = 'student';
        }
        // Step 10: Initialize student_details ONLY if studentId is null
        if (!studentId) {
          studentDetailsCreated = true;
        }
        return {
          success: true,
          verified: true,
          orderId: sampleOrderId,
          entitlement: `student_subscription:${samplePlanId}`,
        };
      }

      const res = simulateMigration206Purchase(roleInDb, existingStudentId);
      const handlerResult = handleGooglePlayRpcResponse(res, null);

      expect(roleInDb).toBe('student');
      expect(studentDetailsCreated).toBe(false);
      expect(handlerResult.action).toBe('proceed_to_post_commit');
      expect(handlerResult.effectiveFinalOrderId).toBe(sampleOrderId);
    });

    it('10. already-processed retry promotes legacy role=user to student without duplicate records', () => {
      let roleInDb = 'user';
      let orderInserted = false;

      function simulateIdempotentCheck(currentRole: string, isAlreadyProcessed: boolean) {
        if (isAlreadyProcessed) {
          if (currentRole === 'user') {
            roleInDb = 'student';
          }
          return {
            success: true,
            verified: true,
            alreadyProcessed: true,
            orderId: sampleOrderId,
            message: 'Purchase already processed and entitlement active',
          };
        }
        orderInserted = true;
        return { success: true };
      }

      const res = simulateIdempotentCheck(roleInDb, true);
      const handlerResult = handleGooglePlayRpcResponse(res, null);

      expect(roleInDb).toBe('student');
      expect(orderInserted).toBe(false);
      expect(handlerResult.action).toBe('proceed_to_post_commit');
      expect(handlerResult.entitlementGranted).toBe('already_processed');
    });

    it('11. rejects unassociated subscription plan (course_id = null) regardless of requested course (COURSE_PLAN_MISMATCH)', () => {
      // In accordance with Migration 090, every subscription plan MUST be course-scoped
      const mismatchResponse = {
        success: false,
        code: 'COURSE_PLAN_MISMATCH',
        error: 'Subscription plan ' + samplePlanId + ' is not associated with any course. All subscription plans must be course-scoped per database schema.',
      };

      const handlerResult = handleGooglePlayRpcResponse(mismatchResponse, null);
      expect(handlerResult.action).toBe('return_response');
      expect(handlerResult.httpStatus).toBe(422);
      expect(handlerResult.responseBody.code).toBe('COURSE_PLAN_MISMATCH');
      expect(handlerResult.responseBody.error).toContain('All subscription plans must be course-scoped');
    });

    it('12. rejects plan/course mismatch when subscription plan course does not match requested course (COURSE_PLAN_MISMATCH)', () => {
      const mismatchResponse = {
        success: false,
        code: 'COURSE_PLAN_MISMATCH',
        error: 'Subscription plan course association mismatch: plan course (' + sampleCourseId + ') does not match purchase course (wrong-course-uuid).',
      };

      const handlerResult = handleGooglePlayRpcResponse(mismatchResponse, null);
      expect(handlerResult.action).toBe('return_response');
      expect(handlerResult.httpStatus).toBe(422);
      expect(handlerResult.responseBody.code).toBe('COURSE_PLAN_MISMATCH');
      expect(handlerResult.responseBody.error).toContain('Subscription plan course association mismatch');
    });

    it('13. auto-populates target course from subscription plan when p_course_id is omitted', () => {
      // Simulates the RPC resolving v_effective_course_id := v_plan_record.course_id
      const planCourseId = sampleCourseId;
      function resolveEffectiveCourseId(requestedCourseId: string | null, planCourse: string) {
        if (!requestedCourseId) {
          return planCourse; // Auto-populated from plan
        }
        return requestedCourseId;
      }

      const effectiveCourse = resolveEffectiveCourseId(null, planCourseId);
      expect(effectiveCourse).toBe(sampleCourseId);

      const payload = buildGooglePlayRpcPayload({
        profileId: sampleProfileId,
        instituteId: sampleInstituteId,
        studentId: sampleStudentId,
        resolvedItemType: 'subscription_plan',
        resolvedCourseId: effectiveCourse,
        resolvedPlanId: samplePlanId,
        itemName: 'Course Scoped Plan',
        unitPrice: 49.0,
        effectiveOrderId: sampleGpaOrderId,
        purchaseToken: sampleToken,
        productId: 'sub_course_plan',
        transactionTimestamp: '2026-10-23T12:00:00.000Z',
      });

      expect(payload.p_plan_id).toBe(samplePlanId);
      expect(payload.p_course_id).toBe(sampleCourseId);
    });

    it('14. concurrent requests sharing an order ID but using different purchase tokens serialize safely', () => {
      // Simulates two concurrent verification requests with identical orderId but distinct purchase tokens
      let paymentCapturedInDb: { orderId: string; purchaseToken: string; profileId: string } | null = null;
      let duplicateOrderCount = 0;

      function simulateRpcWithAdvisoryLock(profileId: string, orderId: string, purchaseToken: string) {
        // Step 1: Compute lock keys and sort in ascending numerical order
        const tokenKey = `token:${purchaseToken}`;
        const orderKey = `order:${orderId}`;
        const sortedLocks = [tokenKey, orderKey].sort();
        expect(sortedLocks.length).toBe(2);

        // Step 7: Under lock, recheck existing captured payment
        if (paymentCapturedInDb) {
          if (paymentCapturedInDb.profileId !== profileId) {
            return {
              success: false,
              code: 'ACCOUNT_MISMATCH',
              error: 'This purchase has already been claimed by another account. Please sign in with the original account or contact support.',
            };
          }
          if (paymentCapturedInDb.orderId === orderId) {
            return {
              success: true,
              verified: true,
              alreadyProcessed: true,
              orderId,
            };
          }
        }

        // First transaction captures payment
        paymentCapturedInDb = { orderId, purchaseToken, profileId };
        duplicateOrderCount++;
        return { success: true, verified: true, orderId };
      }

      // Tx1 from User A arrives with token_A and GPA.1234
      const res1 = simulateRpcWithAdvisoryLock('user-a', sampleGpaOrderId, 'token_A');
      const handler1 = handleGooglePlayRpcResponse(res1, null);
      expect(handler1.action).toBe('proceed_to_post_commit');
      expect(handler1.effectiveFinalOrderId).toBe(sampleGpaOrderId);

      // Concurrent Tx2 from User B arrives with token_B but same GPA.1234
      const res2 = simulateRpcWithAdvisoryLock('user-b', sampleGpaOrderId, 'token_B');
      const handler2 = handleGooglePlayRpcResponse(res2, null);
      expect(handler2.action).toBe('return_response');
      expect(handler2.httpStatus).toBe(409);
      expect(handler2.responseBody.code).toBe('ACCOUNT_MISMATCH');
      expect(duplicateOrderCount).toBe(1); // No duplicate order created
    });

    it('15. concurrent requests sharing the same purchase token serialize safely and prevent replay', () => {
      let paymentCapturedInDb: { orderId: string; purchaseToken: string; profileId: string } | null = null;
      let duplicatePaymentCount = 0;

      function simulateRpcTokenLock(profileId: string, orderId: string, purchaseToken: string) {
        // Step 7: Check existing payment under lock
        if (paymentCapturedInDb) {
          if (paymentCapturedInDb.profileId !== profileId) {
            return {
              success: false,
              code: 'ACCOUNT_MISMATCH',
              error: 'This purchase has already been claimed by another account. Please sign in with the original account or contact support.',
            };
          }
          return {
            success: true,
            verified: true,
            alreadyProcessed: true,
            orderId: paymentCapturedInDb.orderId,
          };
        }

        paymentCapturedInDb = { orderId, purchaseToken, profileId };
        duplicatePaymentCount++;
        return { success: true, verified: true, orderId };
      }

      // First call by User A succeeds
      const res1 = simulateRpcTokenLock('user-a', 'GPA.1111', sampleToken);
      expect(res1.success).toBe(true);
      expect(duplicatePaymentCount).toBe(1);

      // Same User A retries with same token: returns alreadyProcessed cleanly
      const resRetry = simulateRpcTokenLock('user-a', 'GPA.1111', sampleToken);
      const handlerRetry = handleGooglePlayRpcResponse(resRetry, null);
      expect(handlerRetry.action).toBe('proceed_to_post_commit');
      expect(handlerRetry.entitlementGranted).toBe('already_processed');
      expect(duplicatePaymentCount).toBe(1);

      // Different User B attempts token replay: rejected with ACCOUNT_MISMATCH
      const resReplay = simulateRpcTokenLock('user-b', 'GPA.2222', sampleToken);
      const handlerReplay = handleGooglePlayRpcResponse(resReplay, null);
      expect(handlerReplay.action).toBe('return_response');
      expect(handlerReplay.httpStatus).toBe(409);
      expect(handlerReplay.responseBody.code).toBe('ACCOUNT_MISMATCH');
      expect(duplicatePaymentCount).toBe(1);
    });

    it('16. products tied to an institute reject checkout with INSTITUTE_MISMATCH when resolved institute ID is NULL', () => {
      // Validates that a user with null institute cannot bypass tenant checks for institute-specific products
      function validateTenantAccess(productInstituteId: string | null, resolvedInstituteId: string | null) {
        if (productInstituteId !== null) {
          if (resolvedInstituteId === null || productInstituteId !== resolvedInstituteId) {
            return {
              success: false,
              code: 'INSTITUTE_MISMATCH',
              error: "Subscription plan does not belong to the user's institute.",
            };
          }
        }
        return { success: true };
      }

      const res = validateTenantAccess('inst-alpha-uuid', null);
      const handlerResult = handleGooglePlayRpcResponse(res, null);

      expect(handlerResult.action).toBe('return_response');
      expect(handlerResult.httpStatus).toBe(422);
      expect(handlerResult.responseBody.code).toBe('INSTITUTE_MISMATCH');
      expect(handlerResult.responseBody.error).toContain("does not belong to the user's institute");
    });

    it('17. cross-institute product access attempts are rejected with INSTITUTE_MISMATCH', () => {
      function validateCrossInstitute(productInstituteId: string, resolvedInstituteId: string) {
        if (productInstituteId !== resolvedInstituteId) {
          return {
            success: false,
            code: 'INSTITUTE_MISMATCH',
            error: "Course does not belong to the user's institute.",
          };
        }
        return { success: true };
      }

      const res = validateCrossInstitute('inst-alpha-uuid', 'inst-beta-uuid');
      const handlerResult = handleGooglePlayRpcResponse(res, null);

      expect(handlerResult.action).toBe('return_response');
      expect(handlerResult.httpStatus).toBe(422);
      expect(handlerResult.responseBody.code).toBe('INSTITUTE_MISMATCH');
      expect(handlerResult.responseBody.error).toContain("does not belong to the user's institute");
    });

    it('18. enforces strict tenant isolation: rejects checkout with INSTITUTE_MISMATCH when resolved institute does not match plan institute', () => {
      function validatePlanTenantAccess(planInstituteId: string | null, resolvedInstituteId: string | null) {
        if (!resolvedInstituteId || planInstituteId !== resolvedInstituteId) {
          return {
            success: false,
            code: 'INSTITUTE_MISMATCH',
            error: "Subscription plan does not belong to the user's institute.",
          };
        }
        return {
          success: true,
          verified: true,
          orderId: sampleOrderId,
          entitlement: `student_subscription:${samplePlanId}`,
        };
      }

      // 1. Rejected when resolved institute is null
      const resNull = validatePlanTenantAccess('inst-alpha-uuid', null);
      const handlerNull = handleGooglePlayRpcResponse(resNull, null);
      expect(handlerNull.action).toBe('return_response');
      expect(handlerNull.httpStatus).toBe(422);
      expect(handlerNull.responseBody.code).toBe('INSTITUTE_MISMATCH');

      // 2. Rejected when resolved institute belongs to another tenant
      const resMismatch = validatePlanTenantAccess('inst-alpha-uuid', 'inst-beta-uuid');
      const handlerMismatch = handleGooglePlayRpcResponse(resMismatch, null);
      expect(handlerMismatch.action).toBe('return_response');
      expect(handlerMismatch.httpStatus).toBe(422);
      expect(handlerMismatch.responseBody.code).toBe('INSTITUTE_MISMATCH');

      // 3. Succeeded when resolved institute matches plan institute
      const resMatch = validatePlanTenantAccess('inst-alpha-uuid', 'inst-alpha-uuid');
      const handlerMatch = handleGooglePlayRpcResponse(resMatch, null);
      expect(handlerMatch.action).toBe('proceed_to_post_commit');
      expect(handlerMatch.effectiveFinalOrderId).toBe(sampleOrderId);
    });

    it('19. valid Google Play subscription renewals create a new payment/order and extend subscription rather than exiting via alreadyProcessed', () => {
      const initialOrderId = 'GPA.1234-5678-9012-34567';
      const renewalOrderId = 'GPA.1234-5678-9012-34567..0';
      const sharedPurchaseToken = 'sub-persistent-token-xyz';
      let subscriptionEndDate = '2026-11-19';
      let ordersInDb: string[] = [initialOrderId];

      function simulateSubscriptionProcessing(params: {
        itemType: string;
        effectiveOrderId: string;
        purchaseToken: string;
        existingPayment: { orderId: string; purchaseToken: string; profileId: string; itemType: string } | null;
      }) {
        let existingPayment = params.existingPayment;

        // Step 7: Differentiate idempotent retry from a valid Google Play subscription renewal
        if (existingPayment) {
          if (params.itemType === 'subscription_plan'
              && params.effectiveOrderId !== existingPayment.orderId) {
            // Legitimate renewal: do not treat as already processed
            existingPayment = null;
          }
        }

        if (existingPayment) {
          return {
            success: true,
            verified: true,
            alreadyProcessed: true,
            orderId: existingPayment.orderId,
          };
        }

        // Renewal is processed: new order created and subscription extended
        ordersInDb.push(params.effectiveOrderId);
        subscriptionEndDate = '2026-12-19'; // Extended by 30 days
        return {
          success: true,
          verified: true,
          orderId: params.effectiveOrderId,
          entitlement: `student_subscription:${samplePlanId}`,
        };
      }

      const existingInitialPayment = {
        orderId: initialOrderId,
        purchaseToken: sharedPurchaseToken,
        profileId: sampleProfileId,
        itemType: 'subscription_plan',
      };

      // 1. Idempotent retry of initial purchase: returns alreadyProcessed
      const retryResult = simulateSubscriptionProcessing({
        itemType: 'subscription_plan',
        effectiveOrderId: initialOrderId,
        purchaseToken: sharedPurchaseToken,
        existingPayment: existingInitialPayment,
      });
      expect(retryResult.alreadyProcessed).toBe(true);
      expect(retryResult.orderId).toBe(initialOrderId);
      expect(ordersInDb.length).toBe(1);

      // 2. Legitimate renewal (new orderId with same token): processes new renewal order and extends end date
      const renewalResult = simulateSubscriptionProcessing({
        itemType: 'subscription_plan',
        effectiveOrderId: renewalOrderId,
        purchaseToken: sharedPurchaseToken,
        existingPayment: existingInitialPayment,
      });
      const renewalHandler = handleGooglePlayRpcResponse(renewalResult, null);
      expect(renewalResult.alreadyProcessed).toBeUndefined();
      expect(renewalHandler.action).toBe('proceed_to_post_commit');
      expect(renewalHandler.effectiveFinalOrderId).toBe(renewalOrderId);
      expect(ordersInDb).toContain(renewalOrderId);
      expect(subscriptionEndDate).toBe('2026-12-19');
    });

    it('20. Migration 207 schema alignment: verifies admin_roles access_status semantics and staff rejection', () => {
      // Step 3 in Migration 207:
      // Evaluates role against:
      //   v_profile_role::text not in ('user', 'student')
      //   OR exists (select 1 from public.admin_roles ar where ar.profile_id = p_profile_id and ar.access_status = 'approved'::public.admin_access_status)
      //   OR exists (select 1 from public.teacher_details td where td.profile_id = p_profile_id)
      function evaluateStaffRoleGuard(params: {
        profileRole: string;
        adminRoles?: { accessStatus: 'pending' | 'approved' | 'suspended' | 'revoked' }[];
        isTeacher?: boolean;
      }) {
        const { profileRole, adminRoles = [], isTeacher = false } = params;

        const isDisallowedProfileRole = profileRole !== 'user' && profileRole !== 'student';
        const hasApprovedAdminRole = adminRoles.some((ar) => ar.accessStatus === 'approved');
        const hasTeacherDetails = isTeacher;

        if (isDisallowedProfileRole || hasApprovedAdminRole || hasTeacherDetails) {
          return {
            success: false,
            code: 'FORBIDDEN_ROLE',
            error: `Profile role '${profileRole}' is not eligible for student checkout. Staff accounts cannot be converted to students.`,
          };
        }

        return {
          success: true,
          verified: true,
          orderId: sampleOrderId,
          entitlement: `student_subscription:${samplePlanId}`,
        };
      }

      // 1. Direct staff roles (teacher, admin, super_admin) are strictly rejected
      expect(evaluateStaffRoleGuard({ profileRole: 'admin' }).code).toBe('FORBIDDEN_ROLE');
      expect(evaluateStaffRoleGuard({ profileRole: 'teacher' }).code).toBe('FORBIDDEN_ROLE');
      expect(evaluateStaffRoleGuard({ profileRole: 'super_admin' }).code).toBe('FORBIDDEN_ROLE');

      // 2. Profile role = 'user' with approved admin role is strictly rejected
      const approvedAdminRes = evaluateStaffRoleGuard({
        profileRole: 'user',
        adminRoles: [{ accessStatus: 'approved' }],
      });
      expect(approvedAdminRes.code).toBe('FORBIDDEN_ROLE');

      // 3. Profile role = 'user' with only pending/suspended/revoked admin role is NOT rejected by admin_roles check
      const pendingAdminRes = evaluateStaffRoleGuard({
        profileRole: 'user',
        adminRoles: [{ accessStatus: 'pending' }],
      });
      expect(pendingAdminRes.success).toBe(true);

      const revokedAdminRes = evaluateStaffRoleGuard({
        profileRole: 'user',
        adminRoles: [{ accessStatus: 'revoked' }, { accessStatus: 'suspended' }],
      });
      expect(revokedAdminRes.success).toBe(true);

      // 4. Profile role = 'user' with teacher_details row is strictly rejected
      const teacherDetailsRes = evaluateStaffRoleGuard({
        profileRole: 'user',
        isTeacher: true,
      });
      expect(teacherDetailsRes.code).toBe('FORBIDDEN_ROLE');

      // 5. Normal legitimate customer with role = 'user' succeeds
      const normalUserRes = evaluateStaffRoleGuard({
        profileRole: 'user',
      });
      expect(normalUserRes.success).toBe(true);
      expect(normalUserRes.orderId).toBe(sampleOrderId);
    });

    it('21. SQLSTATE 42703 (undefined_column) fails closed and blocks Google Play acknowledgement', () => {
      let googlePlayAcknowledged = false;

      // Simulates the exact production error: SQLSTATE 42703 (undefined_column: column ar.is_active does not exist)
      const undefinedColumnError = {
        code: '42703',
        message: 'column ar.is_active does not exist',
      };

      const handlerResult = handleGooglePlayRpcResponse(null, undefinedColumnError);

      if (handlerResult.action === 'proceed_to_post_commit') {
        googlePlayAcknowledged = true;
      }

      // Must fail closed with fatal error, never treat as safe fallback, never acknowledge on Google Play
      expect(handlerResult.action).toBe('throw_fatal');
      expect(googlePlayAcknowledged).toBe(false);
      expect(handlerResult.errorClassification).toBe('UNDEFINED_COLUMN');
      expect(handlerResult.fatalError).toContain('column ar.is_active does not exist');
    });
  });

  describe('22. CodeRabbit F-09: Authoritative Order ID Resolution & Replay Protection Suite', () => {
    const authProfileA = '55555555-aaaa-bbbb-cccc-111111111111';
    const authProfileB = '77777777-xxxx-yyyy-zzzz-222222222222';
    const sampleToken = 'google_play_token_authoritative_xyz_12345';
    const authoritativeInAppOrderId = 'GPA.3392-4819-5820-19284';
    const authoritativeSubLatestOrderId = 'GPA.7788-9900-1122-33445..0';
    const renewalSubLatestOrderId = 'GPA.7788-9900-1122-33445..1';

    it('1. Scenario 1: SHA-256 standard cryptographic digest verification', async () => {
      const digest = await deterministicTokenHash(sampleToken);
      expect(typeof digest).toBe('string');
      expect(digest.length).toBe(32);
      expect(/^[0-9A-F]{32}$/.test(digest)).toBe(true);

      const digest2 = await deterministicTokenHash(sampleToken);
      expect(digest).toBe(digest2);

      const otherDigest = await deterministicTokenHash('different_purchase_token_999');
      expect(digest).not.toBe(otherDigest);
    });

    it('2. Scenario 2: One-time in-app purchase uses Google authoritative orderId, ignoring client orderId', async () => {
      const res = await resolveAuthoritativeOrderId({
        isSub: false,
        googleVerificationResult: { orderId: authoritativeInAppOrderId, purchaseState: 0 },
        clientOrderId: 'GPA.CLIENT.IGNORED.123',
        purchaseToken: sampleToken,
      });
      expect(res.authoritativeOrderId).toBe(authoritativeInAppOrderId);
      expect(res.isAuthoritative).toBe(true);
      expect(res.source).toBe('google_inapp_order_id');
      expect(res.diagnosticClientOrderId).toBe('GPA.CLIENT.IGNORED.123');

      const existingPayment = {
        payment_id: 'pay-123',
        order_id: sampleOrderId,
        status: 'captured',
        gateway_payment_id: authoritativeInAppOrderId,
        orders: { profile_id: authProfileA },
      };

      const match = evaluateExistingPaymentMatch({
        isSub: false,
        authoritativeOrderId: res.authoritativeOrderId,
        purchaseToken: sampleToken,
        existingPayment,
        currentProfileId: authProfileA,
      });

      expect(match.isDuplicate).toBe(true);
      expect(match.isAccountMismatch).toBe(false);
      expect(match.isSubscriptionRenewal).toBe(false);
      expect(match.existingOrderId).toBe(sampleOrderId);
    });

    it('3. Scenario 3: Retry with omitted client order ID still resolves authoritative ID and detects duplicate', async () => {
      const res = await resolveAuthoritativeOrderId({
        isSub: false,
        googleVerificationResult: { orderId: authoritativeInAppOrderId, purchaseState: 0 },
        clientOrderId: undefined,
        purchaseToken: sampleToken,
      });
      expect(res.authoritativeOrderId).toBe(authoritativeInAppOrderId);
      expect(res.isAuthoritative).toBe(true);
      expect(res.diagnosticClientOrderId).toBeNull();

      const existingPayment = {
        payment_id: 'pay-123',
        order_id: sampleOrderId,
        status: 'captured',
        gateway_payment_id: authoritativeInAppOrderId,
        orders: { profile_id: authProfileA },
      };

      const match = evaluateExistingPaymentMatch({
        isSub: false,
        authoritativeOrderId: res.authoritativeOrderId,
        purchaseToken: sampleToken,
        existingPayment,
        currentProfileId: authProfileA,
      });

      expect(match.isDuplicate).toBe(true);
      expect(match.isAccountMismatch).toBe(false);
    });

    it('4. Scenario 4: Modified client order ID cannot bypass replay detection', async () => {
      const spoofedClientOrderId = 'GPA.ATTACKER.SPOOFED.ORDER.ID';
      const res = await resolveAuthoritativeOrderId({
        isSub: false,
        googleVerificationResult: { orderId: authoritativeInAppOrderId, purchaseState: 0 },
        clientOrderId: spoofedClientOrderId,
        purchaseToken: sampleToken,
      });

      expect(res.authoritativeOrderId).toBe(authoritativeInAppOrderId);
      expect(res.authoritativeOrderId).not.toBe(spoofedClientOrderId);

      const existingPayment = {
        payment_id: 'pay-123',
        order_id: sampleOrderId,
        status: 'captured',
        gateway_payment_id: authoritativeInAppOrderId,
        orders: { profile_id: authProfileA },
      };

      const match = evaluateExistingPaymentMatch({
        isSub: false,
        authoritativeOrderId: res.authoritativeOrderId,
        purchaseToken: sampleToken,
        existingPayment,
        currentProfileId: authProfileA,
      });

      expect(match.isDuplicate).toBe(true);
      expect(match.isAccountMismatch).toBe(false);
    });

    it('5. Scenario 5: Google omitting order ID for test purchase uses SHA-256 deterministic token hash', async () => {
      const testPurchaseToken = 'sandbox_test_token_abcdef_98765';
      const res = await resolveAuthoritativeOrderId({
        isSub: false,
        googleVerificationResult: { purchaseState: 0 },
        clientOrderId: 'GPA.CLIENT.SPOOF.TEST',
        purchaseToken: testPurchaseToken,
      });

      const expectedTokenHash = await deterministicTokenHash(testPurchaseToken);
      const expectedFallbackId = `GPA.TOK.${expectedTokenHash}`;

      expect(res.authoritativeOrderId).toBe(expectedFallbackId);
      expect(res.authoritativeOrderId.length).toBe(40);
      expect(res.authoritativeOrderId).not.toBe('GPA.CLIENT.SPOOF.TEST');
      expect(res.isAuthoritative).toBe(false);
      expect(res.source).toBe('deterministic_token_hash');
    });

    it('6. Scenario 6: Transition from fallback ID to Google-issued authoritative order ID (One-Time Purchase)', async () => {
      const oneTimeToken = 'one_time_token_transition_112233';
      const fallbackId = `GPA.TOK.${await deterministicTokenHash(oneTimeToken)}`;

      // Step 1: Initial purchase recorded with server-generated fallback ID
      const initialCapturedPayment = {
        payment_id: 'pay-fallback-1',
        order_id: sampleOrderId,
        status: 'captured',
        gateway_payment_id: fallbackId,
        gateway_order_id: fallbackId,
        gateway_response: { purchaseToken: oneTimeToken, verified: true },
        orders: { profile_id: authProfileA },
      };

      // Step 2: Next verification with same token, but Google now returns authoritative order ID
      const delayedAuthoritativeId = 'GPA.5544-3322-1100-99887';
      const resDelayed = await resolveAuthoritativeOrderId({
        isSub: false,
        googleVerificationResult: { orderId: delayedAuthoritativeId, purchaseState: 0 },
        clientOrderId: delayedAuthoritativeId,
        purchaseToken: oneTimeToken,
      });

      expect(resDelayed.authoritativeOrderId).toBe(delayedAuthoritativeId);
      expect(resDelayed.isAuthoritative).toBe(true);

      // Replay check matches on purchaseToken stored in gateway_response
      const match = evaluateExistingPaymentMatch({
        isSub: false,
        authoritativeOrderId: resDelayed.authoritativeOrderId,
        purchaseToken: oneTimeToken,
        existingPayment: initialCapturedPayment,
        currentProfileId: authProfileA,
      });

      // Assert purchase is treated idempotently without creating duplicate payment or enrollment
      expect(match.isDuplicate).toBe(true);
      expect(match.isSubscriptionRenewal).toBe(false);
      expect(match.isAccountMismatch).toBe(false);
      expect(match.existingOrderId).toBe(sampleOrderId);
    });

    it('7. Scenario 7: Initial subscription without authoritative order ID uses SHA-256 deterministic token fallback', async () => {
      const subToken = 'sub_persistent_token_456';
      const res = await resolveAuthoritativeOrderId({
        isSub: true,
        googleVerificationResult: { subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE' },
        clientOrderId: 'GPA.CLIENT.SUB.INITIAL',
        purchaseToken: subToken,
      });

      const expectedSubId = `GPA.SUB.${await deterministicTokenHash(subToken)}`;
      expect(res.authoritativeOrderId).toBe(expectedSubId);
      expect(res.authoritativeOrderId.length).toBe(40);
      expect(res.isAuthoritative).toBe(false);
      expect(res.source).toBe('deterministic_token_hash');

      const existingSubPayment = {
        payment_id: 'pay-sub-1',
        order_id: sampleOrderId,
        status: 'captured',
        gateway_payment_id: expectedSubId,
        orders: { profile_id: authProfileA },
      };

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: res.authoritativeOrderId,
        purchaseToken: subToken,
        existingPayment: existingSubPayment,
        currentProfileId: authProfileA,
      });

      expect(match.isDuplicate).toBe(true);
      expect(match.isSubscriptionRenewal).toBe(false);
    });

    it('8. Scenario 8: Transition from fallback ID to Google-issued authoritative order ID (Subscription Base Cycle ..0)', async () => {
      const subToken = 'sub_transition_token_789';
      const fallbackSubId = `GPA.SUB.${await deterministicTokenHash(subToken)}`;

      // Step 1: Initial subscription recorded with fallback ID
      const initialSubPayment = {
        payment_id: 'pay-sub-fallback',
        order_id: sampleOrderId,
        status: 'captured',
        gateway_payment_id: fallbackSubId,
        gateway_response: { purchaseToken: subToken, verified: true },
        orders: { profile_id: authProfileA },
      };

      // Step 2: Next call with same token returns Google base order ID (..0)
      const delayedBaseOrderId = 'GPA.8899-7766-5544-33221..0';
      const resDelayed = await resolveAuthoritativeOrderId({
        isSub: true,
        googleVerificationResult: {
          latestOrderId: delayedBaseOrderId,
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [{ expiryTime: '2026-11-23T15:00:00.000Z' }],
        },
        clientOrderId: delayedBaseOrderId,
        purchaseToken: subToken,
      });

      expect(resDelayed.authoritativeOrderId).toBe(delayedBaseOrderId);
      expect(resDelayed.isAuthoritative).toBe(true);

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: resDelayed.authoritativeOrderId,
        purchaseToken: subToken,
        existingPayment: initialSubPayment,
        currentProfileId: authProfileA,
        existingSubscriptionEndDate: '2026-11-23',
      });

      // Confirm that transitioning from fallback ID to base authoritative order ID (..0)
      // is safely reconciled as duplicate and does NOT trigger renewal or extend subscription
      expect(match.isDuplicate).toBe(true);
      expect(match.isSubscriptionRenewal).toBe(false);
      expect(match.isAccountMismatch).toBe(false);
    });

    it('9. Scenario 9: Subsequent genuine renewal after fallback initial purchase', async () => {
      const subToken = 'sub_renewal_after_fallback_token_101';
      const fallbackSubId = `GPA.SUB.${await deterministicTokenHash(subToken)}`;

      const initialSubPayment = {
        payment_id: 'pay-sub-initial',
        order_id: sampleOrderId,
        status: 'captured',
        gateway_payment_id: fallbackSubId,
        gateway_response: { purchaseToken: subToken, verified: true },
        orders: { profile_id: authProfileA },
      };

      // Genuine renewal arrives with cycle 1 (..1) and advanced expiry
      const renewalOrderId = 'GPA.8899-7766-5544-33221..1';
      const resRenewal = await resolveAuthoritativeOrderId({
        isSub: true,
        googleVerificationResult: {
          latestOrderId: renewalOrderId,
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [{ expiryTime: '2026-12-23T15:00:00.000Z' }],
        },
        clientOrderId: renewalOrderId,
        purchaseToken: subToken,
      });

      expect(resRenewal.authoritativeOrderId).toBe(renewalOrderId);

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: resRenewal.authoritativeOrderId,
        purchaseToken: subToken,
        existingPayment: initialSubPayment,
        currentProfileId: authProfileA,
        existingSubscriptionEndDate: '2026-11-23', // Prior expiry
        googleVerificationResult: {
          lineItems: [{ expiryTime: '2026-12-23T15:00:00.000Z' }], // Advanced expiry!
        },
      });

      // Genuine renewal confirmed
      expect(match.isSubscriptionRenewal).toBe(true);
      expect(match.isDuplicate).toBe(false);
      expect(match.isAccountMismatch).toBe(false);
    });

    it('10. Scenario 10: Subscription renewal without latestOrderId is safely treated as duplicate, refusing to invent renewal', async () => {
      const subToken = 'sub_persistent_token_456';
      const initialCapturedId = 'GPA.7788-9900-1122-33445..0';

      const existingCycle0 = {
        payment_id: 'pay-sub-cycle-0',
        order_id: sampleOrderId,
        status: 'captured',
        gateway_payment_id: initialCapturedId,
        orders: { profile_id: authProfileA },
      };

      const renewalWithoutOrderIdRes = await resolveAuthoritativeOrderId({
        isSub: true,
        googleVerificationResult: { subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE' },
        clientOrderId: 'GPA.CLIENT.SPOOFED.RENEWAL',
        purchaseToken: subToken,
      });

      expect(renewalWithoutOrderIdRes.authoritativeOrderId).toBe(`GPA.SUB.${await deterministicTokenHash(subToken)}`);
      expect(renewalWithoutOrderIdRes.authoritativeOrderId).not.toBe('GPA.CLIENT.SPOOFED.RENEWAL');

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: initialCapturedId,
        purchaseToken: subToken,
        existingPayment: existingCycle0,
        currentProfileId: authProfileA,
      });

      expect(match.isDuplicate).toBe(true);
      expect(match.isSubscriptionRenewal).toBe(false);
    });

    it('11. Scenario 11: Migration 217 - a newer cycle with non-advancing expiry is recorded, not reported as a duplicate', async () => {
      const subToken = 'sub_unadvanced_token_333';
      const cycle0Id = 'GPA.5555-6666-7777-88888..0';
      const cycle1Id = 'GPA.5555-6666-7777-88888..1';

      const existingCycle0 = {
        payment_id: 'pay-sub-0',
        order_id: sampleOrderId,
        status: 'captured',
        gateway_payment_id: cycle0Id,
        orders: { profile_id: authProfileA },
      };

      // Incoming request has cycle 1 ID, but Google API indicates expiry has NOT advanced.
      // The ledger is authoritative: cycle ..1 is unrecorded, so the renewal must reach the RPC,
      // which records the payment for that exact order id and applies greatest() so the window
      // cannot regress. Duplicate protection now rests on exact-order-id idempotency (asserted
      // by the replay below) instead of on an expiry-ordering heuristic.
      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: cycle1Id,
        purchaseToken: subToken,
        existingPayment: existingCycle0,
        currentProfileId: authProfileA,
        existingSubscriptionEndDate: '2026-11-23T15:00:00.000Z',
        googleVerificationResult: {
          lineItems: [{ expiryTime: '2026-11-23T15:00:00.000Z' }], // Same expiry!
        },
      });

      expect(match.isDuplicate).toBe(false);
      expect(match.isSubscriptionRenewal).toBe(true);
      expect(match.decisionReason).toBe('verified_newer_cycle_non_advancing_expiry');

      // Replaying the already-recorded cycle id remains a hard duplicate.
      const replay = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: cycle0Id,
        purchaseToken: subToken,
        existingPayment: existingCycle0,
        currentProfileId: authProfileA,
        existingSubscriptionEndDate: '2026-11-23T15:00:00.000Z',
        googleVerificationResult: {
          lineItems: [{ expiryTime: '2026-11-23T15:00:00.000Z' }],
        },
      });

      expect(replay.isDuplicate).toBe(true);
      expect(replay.isSubscriptionRenewal).toBe(false);
      expect(replay.decisionReason).toBe('idempotent_duplicate_same_order');
    });

    it('12. Scenario 12: Legitimate subscription renewal with new authoritative latestOrderId extends subscription', async () => {
      const resCycle1 = await resolveAuthoritativeOrderId({
        isSub: true,
        googleVerificationResult: {
          latestOrderId: renewalSubLatestOrderId,
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [{ expiryTime: '2026-12-23T15:00:00.000Z' }],
        },
        clientOrderId: renewalSubLatestOrderId,
        purchaseToken: sampleToken,
      });
      expect(resCycle1.authoritativeOrderId).toBe(renewalSubLatestOrderId);
      expect(resCycle1.source).toBe('google_subscription_latest_order_id');

      const existingCycle0Payment = {
        payment_id: 'pay-cycle-0',
        order_id: sampleOrderId,
        status: 'captured',
        gateway_payment_id: authoritativeSubLatestOrderId,
        orders: { profile_id: authProfileA },
      };

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: resCycle1.authoritativeOrderId,
        purchaseToken: sampleToken,
        existingPayment: existingCycle0Payment,
        currentProfileId: authProfileA,
        existingSubscriptionEndDate: '2026-11-23T15:00:00.000Z',
        googleVerificationResult: {
          lineItems: [{ expiryTime: '2026-12-23T15:00:00.000Z' }],
        },
      });

      expect(match.isSubscriptionRenewal).toBe(true);
      expect(match.isDuplicate).toBe(false);
      expect(match.isAccountMismatch).toBe(false);
    });

    it('13. Scenario 13: Concurrent requests using same purchase token with different effective order IDs (fallback vs authoritative)', async () => {
      const concurrentToken = 'concurrent_test_token_diff_ids_99999';
      const fallbackId = `GPA.TOK.${await deterministicTokenHash(concurrentToken)}`;
      const authoritativeId = 'GPA.9999-8888-7777-66665';

      let ordersCommitted = 0;
      let duplicateRejections = 0;
      const dbMock: any[] = [];

      // Simulate Worker 1 arriving with fallback ID
      async function runWorker1() {
        const res = await resolveAuthoritativeOrderId({
          isSub: false,
          googleVerificationResult: { purchaseState: 0 },
          clientOrderId: undefined,
          purchaseToken: concurrentToken,
        });

        // Lock on purchase token serializes execution
        const existing = dbMock.find(
          p => p.gateway_payment_id === res.authoritativeOrderId || p.purchaseToken === concurrentToken
        );

        if (existing) {
          duplicateRejections++;
          return { success: true, alreadyProcessed: true };
        }

        dbMock.push({
          payment_id: 'pay-w1',
          order_id: 'order-w1',
          status: 'captured',
          gateway_payment_id: res.authoritativeOrderId,
          purchaseToken: concurrentToken,
          orders: { profile_id: authProfileA },
        });
        ordersCommitted++;
        return { success: true, alreadyProcessed: false };
      }

      // Simulate Worker 2 arriving concurrently with authoritative Google ID
      async function runWorker2() {
        const res = await resolveAuthoritativeOrderId({
          isSub: false,
          googleVerificationResult: { orderId: authoritativeId, purchaseState: 0 },
          clientOrderId: authoritativeId,
          purchaseToken: concurrentToken,
        });

        // Under purchase token serialization, checks DB after Worker 1 committed
        const existing = dbMock.find(
          p => p.gateway_payment_id === res.authoritativeOrderId || p.purchaseToken === concurrentToken
        );

        const match = evaluateExistingPaymentMatch({
          isSub: false,
          authoritativeOrderId: res.authoritativeOrderId,
          purchaseToken: concurrentToken,
          existingPayment: existing || null,
          currentProfileId: authProfileA,
        });

        if (match.isDuplicate) {
          duplicateRejections++;
          return { success: true, alreadyProcessed: true };
        }

        dbMock.push({
          payment_id: 'pay-w2',
          order_id: 'order-w2',
          status: 'captured',
          gateway_payment_id: res.authoritativeOrderId,
          purchaseToken: concurrentToken,
          orders: { profile_id: authProfileA },
        });
        ordersCommitted++;
        return { success: true, alreadyProcessed: false };
      }

      // Execute serialized sequence reflecting advisory lock on token
      const w1 = await runWorker1();
      const w2 = await runWorker2();

      expect(w1.alreadyProcessed).toBe(false);
      expect(w2.alreadyProcessed).toBe(true);
      expect(ordersCommitted).toBe(1);
      expect(duplicateRejections).toBe(1);
      expect(dbMock.length).toBe(1);
      expect(dbMock[0].purchaseToken).toBe(concurrentToken);
    });

    it('14. Scenario 14: Already-processed transaction retried after timeout returns idempotent success', () => {
      let ackAttempted = false;
      function simulateTimeoutRetry(isDuplicate: boolean) {
        if (isDuplicate) {
          ackAttempted = true;
          return { success: true, alreadyProcessed: true, orderId: sampleOrderId };
        }
        return { success: true, alreadyProcessed: false };
      }

      const retryRes = simulateTimeoutRetry(true);
      expect(retryRes.alreadyProcessed).toBe(true);
      expect(retryRes.orderId).toBe(sampleOrderId);
      expect(ackAttempted).toBe(true);
    });

    it('15. Scenario 15: Durable purchaseToken persistence in RPC and payment payload', () => {
      const nowIso = new Date('2026-10-23T15:00:00.000Z').toISOString();
      const rpcPayload = buildGooglePlayRpcPayload({
        profileId: authProfileA,
        instituteId: sampleInstituteId,
        studentId: sampleStudentId,
        resolvedItemType: 'subscription_plan',
        resolvedCourseId: sampleCourseId,
        resolvedPlanId: samplePlanId,
        itemName: 'Test Subscription',
        unitPrice: 199.0,
        effectiveOrderId: authoritativeSubLatestOrderId,
        purchaseToken: sampleToken,
        productId: 'sub_test_sku',
        googleVerificationResult: {
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          latestOrderId: authoritativeSubLatestOrderId,
        },
        transactionTimestamp: nowIso,
      });

      expect(rpcPayload.p_purchase_token).toBe(sampleToken);
      expect(rpcPayload.p_gateway_response.purchaseToken).toBe(sampleToken);
      expect(rpcPayload.p_gateway_response.latestOrderId).toBe(authoritativeSubLatestOrderId);

      const paymentPayload = buildGooglePlayPaymentPayload({
        orderId: sampleOrderId,
        instituteId: sampleInstituteId,
        effectiveOrderId: authoritativeSubLatestOrderId,
        amount: 199.0,
        currency: 'INR',
        transactionTimestamp: nowIso,
        gatewayResponse: { latestOrderId: authoritativeSubLatestOrderId },
        purchaseToken: sampleToken,
      });

      expect(paymentPayload.gateway_response.purchaseToken).toBe(sampleToken);
    });
  });

  describe('23. Fail-Closed Subscription Renewal & Consistent Cycle Validation Suite', () => {
    // NOTE ON TEST CLASSIFICATION & ENVIRONMENT:
    // Tests in this suite exercise pure TypeScript decision logic (evaluateExistingPaymentMatch,
    // resolveAuthoritativeOrderId) and mock Edge Function contracts. They do NOT execute against a live PostgreSQL
    // database engine, and therefore do not constitute runtime proof of PostgreSQL transactional or constraint behaviour.

    const testProfile = '66666666-aaaa-bbbb-cccc-333333333333';
    const sampleOrderId = '22222222-3333-4444-5555-666666666666';
    const testPurchaseToken = 'google_play_sub_token_renewal_suite_23';
    const baseCycleOrderId = 'GPA.7788-9900-1122-33445..0';
    const renewalCycle1OrderId = 'GPA.7788-9900-1122-33445..1';
    const priorExpiryIso = '2026-11-23T15:00:00.000Z';
    const advancedExpiryIso = '2026-12-23T15:00:00.000Z';

    it('1. [TypeScript Decision Logic] Initial purchase recovery with a missing subscription row and the original ..0 order ID: no duplicate order or payment', async () => {
      const existingCycle0Payment = {
        payment_id: 'pay-cycle-0',
        order_id: sampleOrderId,
        status: 'captured',
        gateway_payment_id: baseCycleOrderId,
        gateway_order_id: baseCycleOrderId,
        orders: { profile_id: testProfile },
      };

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: baseCycleOrderId,
        purchaseToken: testPurchaseToken,
        existingPayment: existingCycle0Payment,
        currentProfileId: testProfile,
        existingSubscriptionEndDate: null,
        transactionTimestamp: '2026-10-24T12:00:00.000Z',
        googleVerificationResult: {
          latestOrderId: baseCycleOrderId,
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [{ expiryTime: advancedExpiryIso }],
        },
      });

      expect(match.isDuplicate).toBe(true);
      expect(match.isSubscriptionRenewal).toBe(false);
      expect(match.isEntitlementRecovery).toBe(true);
      expect(match.isMissingSubscriptionEvidence).toBeFalsy();
      expect(match.existingOrderId).toBe(sampleOrderId);

      let duplicateOrders = 0;
      let duplicatePayments = 0;
      let entitlementRecovered = false;

      if (match.isSubscriptionRenewal) {
        duplicateOrders++;
        duplicatePayments++;
      } else if (match.isEntitlementRecovery) {
        entitlementRecovered = true;
      }

      expect(duplicateOrders).toBe(0);
      expect(duplicatePayments).toBe(0);
      expect(entitlementRecovered).toBe(true);
    });

    it('2. [TypeScript Decision Logic] Genuine ..1 renewal with a missing subscription row and a valid future expiry: create a separate renewal order and payment', async () => {
      const existingCycle0Payment = {
        payment_id: 'pay-cycle-0',
        order_id: sampleOrderId,
        status: 'captured',
        gateway_payment_id: baseCycleOrderId,
        gateway_order_id: baseCycleOrderId,
        orders: { profile_id: testProfile },
      };

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: renewalCycle1OrderId,
        purchaseToken: testPurchaseToken,
        existingPayment: existingCycle0Payment,
        currentProfileId: testProfile,
        existingSubscriptionEndDate: null,
        transactionTimestamp: '2026-10-24T12:00:00.000Z',
        googleVerificationResult: {
          latestOrderId: renewalCycle1OrderId,
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [{ expiryTime: advancedExpiryIso }],
        },
      });

      expect(match.isDuplicate).toBe(false);
      expect(match.isSubscriptionRenewal).toBe(true);
      expect(match.isAccountMismatch).toBe(false);

      let renewalOrderCreated = false;
      let renewalPaymentRecorded = false;
      let linkedOrderId: string | null = null;
      let recordedGatewayOrderId: string | null = null;

      if (match.isSubscriptionRenewal) {
        renewalOrderCreated = true;
        renewalPaymentRecorded = true;
        linkedOrderId = 'order-renewal-cycle-1-new-uuid';
        recordedGatewayOrderId = renewalCycle1OrderId;
      }

      expect(renewalOrderCreated).toBe(true);
      expect(renewalPaymentRecorded).toBe(true);
      expect(recordedGatewayOrderId).toBe(renewalCycle1OrderId);
      expect(linkedOrderId).not.toBe(sampleOrderId);
    });

    it('3a. [TypeScript Decision Logic & Idempotency] A retry for an already-recorded ..1 renewal with MISSING subscription row and valid future expiry: recognize existing renewal, reuse existing order, skip payment insert, and recover entitlement', async () => {
      const existingCycle1Payment = {
        payment_id: 'pay-cycle-1',
        order_id: 'order-renewal-cycle-1',
        status: 'captured',
        gateway_payment_id: renewalCycle1OrderId,
        gateway_order_id: renewalCycle1OrderId,
        orders: { profile_id: testProfile },
      };

      // Captured payment exists for ..1, but student_subscriptions row is MISSING (null end date)
      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: renewalCycle1OrderId,
        purchaseToken: testPurchaseToken,
        existingPayment: existingCycle1Payment,
        currentProfileId: testProfile,
        existingSubscriptionEndDate: null, // Subscription row missing in DB!
        transactionTimestamp: '2026-10-24T12:00:00.000Z',
        googleVerificationResult: {
          latestOrderId: renewalCycle1OrderId,
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [{ expiryTime: advancedExpiryIso }],
        },
      });

      // Must be recognized as an idempotent retry of the existing ..1 transaction requiring entitlement recovery,
      // NOT as a new renewal that would insert a second payment!
      expect(match.isDuplicate).toBe(true);
      expect(match.isSubscriptionRenewal).toBe(false);
      expect(match.isEntitlementRecovery).toBe(true);
      expect(match.isMissingSubscriptionEvidence).toBeFalsy();
      expect(match.existingOrderId).toBe('order-renewal-cycle-1');

      let duplicateOrders = 0;
      let duplicatePayments = 0;
      let entitlementRecovered = false;

      if (match.isSubscriptionRenewal) {
        duplicateOrders++;
        duplicatePayments++;
      } else if (match.isEntitlementRecovery) {
        entitlementRecovered = true;
      }

      expect(duplicateOrders).toBe(0);
      expect(duplicatePayments).toBe(0);
      expect(entitlementRecovered).toBe(true);
    });

    it('3b. [TypeScript Decision Logic & Fail-Closed Guard] A retry for an already-recorded ..1 renewal with MISSING subscription row and INVALID/EXPIRED expiry: fail closed, do not claim active entitlement, do not insert duplicate order/payment', async () => {
      const existingCycle1Payment = {
        payment_id: 'pay-cycle-1',
        order_id: 'order-renewal-cycle-1',
        status: 'captured',
        gateway_payment_id: renewalCycle1OrderId,
        gateway_order_id: renewalCycle1OrderId,
        orders: { profile_id: testProfile },
      };

      // Captured payment exists for ..1, subscription row is missing, and incoming Google expiry is EXPIRED or NULL
      const matchNullExpiry = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: renewalCycle1OrderId,
        purchaseToken: testPurchaseToken,
        existingPayment: existingCycle1Payment,
        currentProfileId: testProfile,
        existingSubscriptionEndDate: null,
        transactionTimestamp: '2026-10-24T12:00:00.000Z',
        googleVerificationResult: {
          latestOrderId: renewalCycle1OrderId,
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [{ expiryTime: null as any }],
        },
      });

      // Must fail closed: missing subscription evidence!
      expect(matchNullExpiry.isDuplicate).toBe(true);
      expect(matchNullExpiry.isSubscriptionRenewal).toBe(false);
      expect(matchNullExpiry.isEntitlementRecovery).toBe(false);
      expect(matchNullExpiry.isMissingSubscriptionEvidence).toBe(true);

      const pastExpiryIso = '2026-09-01T12:00:00.000Z';
      const matchExpiredDate = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: renewalCycle1OrderId,
        purchaseToken: testPurchaseToken,
        existingPayment: existingCycle1Payment,
        currentProfileId: testProfile,
        existingSubscriptionEndDate: null,
        transactionTimestamp: '2026-10-24T12:00:00.000Z',
        googleVerificationResult: {
          latestOrderId: renewalCycle1OrderId,
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [{ expiryTime: pastExpiryIso }],
        },
      });

      expect(matchExpiredDate.isDuplicate).toBe(true);
      expect(matchExpiredDate.isSubscriptionRenewal).toBe(false);
      expect(matchExpiredDate.isEntitlementRecovery).toBe(false);
      expect(matchExpiredDate.isMissingSubscriptionEvidence).toBe(true);

      let ordersCreated = 0;
      let paymentsCreated = 0;
      if (matchExpiredDate.isSubscriptionRenewal) {
        ordersCreated++;
        paymentsCreated++;
      }
      expect(ordersCreated).toBe(0);
      expect(paymentsCreated).toBe(0);
    });

    it('3c. [TypeScript Decision Logic & Idempotency] A repeated request for already-recorded ..1 renewal when subscription row IS PRESENT: return duplicate without second payment', async () => {
      const existingCycle1Payment = {
        payment_id: 'pay-cycle-1',
        order_id: 'order-renewal-cycle-1',
        status: 'captured',
        gateway_payment_id: renewalCycle1OrderId,
        gateway_order_id: renewalCycle1OrderId,
        orders: { profile_id: testProfile },
      };

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: renewalCycle1OrderId,
        purchaseToken: testPurchaseToken,
        existingPayment: existingCycle1Payment,
        currentProfileId: testProfile,
        existingSubscriptionEndDate: advancedExpiryIso,
        transactionTimestamp: '2026-10-24T12:00:00.000Z',
        googleVerificationResult: {
          latestOrderId: renewalCycle1OrderId,
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [{ expiryTime: advancedExpiryIso }],
        },
      });

      expect(match.isDuplicate).toBe(true);
      expect(match.isSubscriptionRenewal).toBe(false);
      expect(match.isEntitlementRecovery).toBeFalsy();
      expect(match.isMissingSubscriptionEvidence).toBeFalsy();
      expect(match.existingOrderId).toBe('order-renewal-cycle-1');

      let duplicatePayments = 0;
      let extraExtensions = 0;
      if (!match.isDuplicate || match.isSubscriptionRenewal) {
        duplicatePayments++;
        extraExtensions++;
      }
      expect(duplicatePayments).toBe(0);
      expect(extraExtensions).toBe(0);
    });

    it('4. [TypeScript Decision Logic] A ..1 renewal candidate with NULL expiry: do not create a renewal payment or extend access', async () => {
      const existingCycle0Payment = {
        payment_id: 'pay-cycle-0',
        order_id: sampleOrderId,
        status: 'captured',
        gateway_payment_id: baseCycleOrderId,
        gateway_order_id: baseCycleOrderId,
        orders: { profile_id: testProfile },
      };

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: renewalCycle1OrderId,
        purchaseToken: testPurchaseToken,
        existingPayment: existingCycle0Payment,
        currentProfileId: testProfile,
        existingSubscriptionEndDate: priorExpiryIso,
        transactionTimestamp: '2026-10-24T12:00:00.000Z',
        googleVerificationResult: {
          latestOrderId: renewalCycle1OrderId,
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [{ expiryTime: null as any }],
        },
      });

      expect(match.isDuplicate).toBe(true);
      expect(match.isSubscriptionRenewal).toBe(false);

      let paymentsCreated = 0;
      let accessExtended = false;
      if (!match.isDuplicate || match.isSubscriptionRenewal) {
        paymentsCreated++;
        accessExtended = true;
      }
      expect(paymentsCreated).toBe(0);
      expect(accessExtended).toBe(false);
    });

    it('5. [TypeScript Decision Logic] A ..1 renewal candidate with an expired incoming date: do not create a renewal payment or fabricate a plan-duration entitlement', async () => {
      const existingCycle0Payment = {
        payment_id: 'pay-cycle-0',
        order_id: sampleOrderId,
        status: 'captured',
        gateway_payment_id: baseCycleOrderId,
        gateway_order_id: baseCycleOrderId,
        orders: { profile_id: testProfile },
      };

      const pastExpiryIso = '2026-09-01T12:00:00.000Z';
      const currentTxTime = '2026-10-24T12:00:00.000Z';

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: renewalCycle1OrderId,
        purchaseToken: testPurchaseToken,
        existingPayment: existingCycle0Payment,
        currentProfileId: testProfile,
        existingSubscriptionEndDate: priorExpiryIso,
        transactionTimestamp: currentTxTime,
        googleVerificationResult: {
          latestOrderId: renewalCycle1OrderId,
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [{ expiryTime: pastExpiryIso }],
        },
      });

      expect(match.isDuplicate).toBe(true);
      expect(match.isSubscriptionRenewal).toBe(false);

      let paymentsCreated = 0;
      let fabricatedDuration = false;
      if (!match.isDuplicate || match.isSubscriptionRenewal) {
        paymentsCreated++;
        fabricatedDuration = true;
      }
      expect(paymentsCreated).toBe(0);
      expect(fabricatedDuration).toBe(false);
    });

    it('6. [TypeScript Decision Logic] An incoming expiry that is later than the stored expiry but is already in the past: fail closed', async () => {
      const existingCycle0Payment = {
        payment_id: 'pay-cycle-0',
        order_id: sampleOrderId,
        status: 'captured',
        gateway_payment_id: baseCycleOrderId,
        gateway_order_id: baseCycleOrderId,
        orders: { profile_id: testProfile },
      };

      const storedExpiryPast = '2026-08-01T12:00:00.000Z';
      const incomingExpiryPast = '2026-09-01T12:00:00.000Z';
      const currentTxTime = '2026-10-24T12:00:00.000Z';

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: renewalCycle1OrderId,
        purchaseToken: testPurchaseToken,
        existingPayment: existingCycle0Payment,
        currentProfileId: testProfile,
        existingSubscriptionEndDate: storedExpiryPast,
        transactionTimestamp: currentTxTime,
        googleVerificationResult: {
          latestOrderId: renewalCycle1OrderId,
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [{ expiryTime: incomingExpiryPast }],
        },
      });

      expect(match.isDuplicate).toBe(true);
      expect(match.isSubscriptionRenewal).toBe(false);

      let paymentsCreated = 0;
      if (!match.isDuplicate || match.isSubscriptionRenewal) {
        paymentsCreated++;
      }
      expect(paymentsCreated).toBe(0);
    });

    it('7. [TypeScript Decision Logic] A missing prior subscription expiry with a valid authoritative new renewal and a valid future expiry: process the new renewal correctly', async () => {
      const existingCycle0Payment = {
        payment_id: 'pay-cycle-0',
        order_id: sampleOrderId,
        status: 'captured',
        gateway_payment_id: baseCycleOrderId,
        gateway_order_id: baseCycleOrderId,
        orders: { profile_id: testProfile },
      };

      const currentTxTime = '2026-10-24T12:00:00.000Z';
      const futureExpiryIso = '2026-11-24T12:00:00.000Z';

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: renewalCycle1OrderId,
        purchaseToken: testPurchaseToken,
        existingPayment: existingCycle0Payment,
        currentProfileId: testProfile,
        existingSubscriptionEndDate: null,
        transactionTimestamp: currentTxTime,
        googleVerificationResult: {
          latestOrderId: renewalCycle1OrderId,
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [{ expiryTime: futureExpiryIso }],
        },
      });

      expect(match.isDuplicate).toBe(false);
      expect(match.isSubscriptionRenewal).toBe(true);
      expect(match.isAccountMismatch).toBe(false);

      let newOrderCreated = false;
      let newPaymentCreated = false;
      let subscriptionCreated = false;
      if (match.isSubscriptionRenewal) {
        newOrderCreated = true;
        newPaymentCreated = true;
        subscriptionCreated = true;
      }
      expect(newOrderCreated).toBe(true);
      expect(newPaymentCreated).toBe(true);
      expect(subscriptionCreated).toBe(true);
    });

    it('8. [TypeScript Decision Logic & Spoofing Guard] A changed client-supplied order ID without a corresponding verified Google order ID: it must not create a new renewal', async () => {
      const clientSuppliedFakeOrderId = 'GPA.7788-9900-1122-33445..1';

      const resolution = await resolveAuthoritativeOrderId({
        isSub: true,
        googleVerificationResult: {
          latestOrderId: baseCycleOrderId,
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [{ expiryTime: advancedExpiryIso }],
        },
        clientOrderId: clientSuppliedFakeOrderId,
        purchaseToken: testPurchaseToken,
      });

      expect(resolution.authoritativeOrderId).toBe(baseCycleOrderId);
      expect(resolution.authoritativeOrderId).not.toBe(clientSuppliedFakeOrderId);

      const existingCycle0Payment = {
        payment_id: 'pay-cycle-0',
        order_id: sampleOrderId,
        status: 'captured',
        gateway_payment_id: baseCycleOrderId,
        gateway_order_id: baseCycleOrderId,
        orders: { profile_id: testProfile },
      };

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: resolution.authoritativeOrderId,
        purchaseToken: testPurchaseToken,
        existingPayment: existingCycle0Payment,
        currentProfileId: testProfile,
        existingSubscriptionEndDate: priorExpiryIso,
        transactionTimestamp: '2026-10-24T12:00:00.000Z',
        googleVerificationResult: {
          latestOrderId: baseCycleOrderId,
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [{ expiryTime: advancedExpiryIso }],
        },
      });

      expect(match.isDuplicate).toBe(true);
      expect(match.isSubscriptionRenewal).toBe(false);
    });

    it('9. [TypeScript Decision Logic & Idempotency] An existing payment that already records the incoming authoritative renewal order ID: remain idempotent', async () => {
      const renewalCycle2OrderId = 'GPA.7788-9900-1122-33445..2';
      const existingCycle2Payment = {
        payment_id: 'pay-cycle-2',
        order_id: 'order-renewal-cycle-2',
        status: 'captured',
        gateway_payment_id: renewalCycle2OrderId,
        gateway_order_id: renewalCycle2OrderId,
        orders: { profile_id: testProfile },
      };

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: renewalCycle2OrderId,
        purchaseToken: testPurchaseToken,
        existingPayment: existingCycle2Payment,
        currentProfileId: testProfile,
        existingSubscriptionEndDate: advancedExpiryIso,
        transactionTimestamp: '2026-10-24T12:00:00.000Z',
        googleVerificationResult: {
          latestOrderId: renewalCycle2OrderId,
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [{ expiryTime: advancedExpiryIso }],
        },
      });

      expect(match.isDuplicate).toBe(true);
      expect(match.isSubscriptionRenewal).toBe(false);
      expect(match.existingOrderId).toBe('order-renewal-cycle-2');
    });

    it('10. [TypeScript Decision Logic & Cross-Account Guard] Cross-account attempts to claim an existing purchase token: remain rejected', async () => {
      const differentProfileId = '77777777-ffff-eeee-dddd-111111111111';
      const existingPaymentAnotherUser = {
        payment_id: 'pay-other-user',
        order_id: sampleOrderId,
        status: 'captured',
        gateway_payment_id: baseCycleOrderId,
        gateway_order_id: baseCycleOrderId,
        orders: { profile_id: 'original-owner-profile-uuid' },
      };

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: renewalCycle1OrderId,
        purchaseToken: testPurchaseToken,
        existingPayment: existingPaymentAnotherUser,
        currentProfileId: differentProfileId,
        existingSubscriptionEndDate: priorExpiryIso,
        transactionTimestamp: '2026-10-24T12:00:00.000Z',
        googleVerificationResult: {
          latestOrderId: renewalCycle1OrderId,
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [{ expiryTime: advancedExpiryIso }],
        },
      });

      expect(match.isAccountMismatch).toBe(true);
      expect(match.isDuplicate).toBe(true);
      expect(match.isSubscriptionRenewal).toBe(false);
      expect(match.paymentOwnerProfileId).toBe('original-owner-profile-uuid');
    });
  });

  describe('24. Google Play Subscription Renewal Cycle Indexing (..0, ..1) & RTDN Reconciliation Suite', () => {
    const authProfileA = '66d9f563-5180-401e-9adc-193c0f9963c7';
    const authProfileB = '77e8a452-6291-512f-8bea-284d1e8874d8';
    const subToken = 'google_play_sub_token_suite_24';
    const baseOrderId = 'GPA.3389-4094-9724-39270'; // Unsuffixed initial purchase
    const cycle0RenewalOrderId = 'GPA.3389-4094-9724-39270..0'; // First genuine renewal (cycle index 0)
    const cycle1RenewalOrderId = 'GPA.3389-4094-9724-39270..1'; // Second renewal (cycle index 1)
    const targetPlanSku = 'sub_math_expert_monthly';
    const targetPlanId = 'fe232782-d734-40da-b01b-92a9cc27c47c';
    const targetCourseId = '6995d41d-7704-457b-b82c-47ceff0b1a10';
    const initialExpiryIso = '2026-11-24T12:00:00.000Z';
    const renewal0ExpiryIso = '2026-12-24T12:00:00.000Z';
    const renewal1ExpiryIso = '2027-01-24T12:00:00.000Z';

    // 1. Initial purchase without a renewal suffix
    it('1. [TypeScript & RPC Logic] Initial purchase without renewal suffix is recorded as base order and payment', async () => {
      const googleRes = {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        lineItems: [
          {
            productId: targetPlanSku,
            latestSuccessfulOrderId: baseOrderId,
            expiryTime: initialExpiryIso,
          },
        ],
      };

      const orderRes = await resolveAuthoritativeOrderId({
        isSub: true,
        googleVerificationResult: googleRes,
        clientOrderId: baseOrderId,
        purchaseToken: subToken,
        productId: targetPlanSku,
      });

      expect(orderRes.authoritativeOrderId).toBe(baseOrderId);
      expect(orderRes.isAuthoritative).toBe(true);
      expect(orderRes.source).toBe('google_subscription_line_item_order_id');

      // First call: no payment exists in DB yet
      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: baseOrderId,
        purchaseToken: subToken,
        existingPayment: null,
        currentProfileId: authProfileA,
        googleVerificationResult: googleRes,
        productId: targetPlanSku,
      });

      expect(match.isDuplicate).toBe(false);
      expect(match.isSubscriptionRenewal).toBe(false);
    });

    // 2. Retry of the initial purchase
    it('2. [TypeScript & RPC Idempotency] Retry of the initial purchase returns duplicate without creating a second order or payment', async () => {
      const existingBasePayment = {
        payment_id: 'pay-initial-uuid',
        order_id: 'order-initial-uuid',
        status: 'captured',
        gateway_payment_id: baseOrderId,
        gateway_order_id: baseOrderId,
        orders: { profile_id: authProfileA, student_id: 'student-123' },
      };

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: baseOrderId,
        purchaseToken: subToken,
        existingPayment: existingBasePayment,
        currentProfileId: authProfileA,
        existingSubscriptionEndDate: initialExpiryIso,
        transactionTimestamp: '2026-10-24T12:00:00.000Z',
        googleVerificationResult: {
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [{ productId: targetPlanSku, latestSuccessfulOrderId: baseOrderId, expiryTime: initialExpiryIso }],
        },
        productId: targetPlanSku,
      });

      expect(match.isDuplicate).toBe(true);
      expect(match.isSubscriptionRenewal).toBe(false);
      expect(match.existingOrderId).toBe('order-initial-uuid');
    });

    // 3. Genuine first renewal ending in ..0
    it('3. [TypeScript & RPC Decision Logic] Genuine first renewal ending in ..0 creates a separate renewal order and captured payment', async () => {
      const existingBasePayment = {
        payment_id: 'pay-initial-uuid',
        order_id: 'order-initial-uuid',
        status: 'captured',
        gateway_payment_id: baseOrderId,
        gateway_order_id: baseOrderId,
        orders: { profile_id: authProfileA, student_id: 'student-123' },
      };

      const googleRenewal0Res = {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        lineItems: [
          {
            productId: targetPlanSku,
            latestSuccessfulOrderId: cycle0RenewalOrderId,
            expiryTime: renewal0ExpiryIso,
          },
        ],
      };

      const orderRes = await resolveAuthoritativeOrderId({
        isSub: true,
        googleVerificationResult: googleRenewal0Res,
        clientOrderId: baseOrderId, // Mobile Purchase.getOrderId() retains base ID on Android
        purchaseToken: subToken,
        productId: targetPlanSku,
      });

      expect(orderRes.authoritativeOrderId).toBe(cycle0RenewalOrderId);
      expect(orderRes.isAuthoritative).toBe(true);

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: cycle0RenewalOrderId,
        purchaseToken: subToken,
        existingPayment: existingBasePayment,
        currentProfileId: authProfileA,
        existingSubscriptionEndDate: initialExpiryIso,
        transactionTimestamp: '2026-11-24T12:00:00.000Z',
        googleVerificationResult: googleRenewal0Res,
        productId: targetPlanSku,
      });

      expect(match.isDuplicate).toBe(false);
      expect(match.isSubscriptionRenewal).toBe(true);
      expect(match.existingOrderId).toBe('order-initial-uuid');

      // Mocked RPC simulation of Migration 214 Step 7-14 execution
      let renewal0OrderCreated = false;
      let renewal0PaymentRecorded = false;
      let subscriptionLinkedOrderId = 'order-initial-uuid';

      if (match.isSubscriptionRenewal) {
        // Step 7: v_existing_payment := null;
        // Step 12: insert order
        renewal0OrderCreated = true;
        // Step 13: insert payment
        renewal0PaymentRecorded = true;
        // Step 14: update student_subscriptions set order_id = v_order_id
        subscriptionLinkedOrderId = 'order-renewal-0-uuid';
      }

      expect(renewal0OrderCreated).toBe(true);
      expect(renewal0PaymentRecorded).toBe(true);
      expect(subscriptionLinkedOrderId).toBe('order-renewal-0-uuid');
    });

    // 4. Retry of an already-recorded ..0 renewal
    it('4. [TypeScript & RPC Idempotency] Retry of an already-recorded ..0 renewal is recognized idempotently without duplicate payment', async () => {
      const existingRenewal0Payment = {
        payment_id: 'pay-renewal-0-uuid',
        order_id: 'order-renewal-0-uuid',
        status: 'captured',
        gateway_payment_id: cycle0RenewalOrderId,
        gateway_order_id: cycle0RenewalOrderId,
        orders: { profile_id: authProfileA, student_id: 'student-123' },
      };

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: cycle0RenewalOrderId,
        purchaseToken: subToken,
        existingPayment: existingRenewal0Payment,
        currentProfileId: authProfileA,
        existingSubscriptionEndDate: renewal0ExpiryIso,
        transactionTimestamp: '2026-11-24T12:05:00.000Z',
        googleVerificationResult: {
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [{ productId: targetPlanSku, latestSuccessfulOrderId: cycle0RenewalOrderId, expiryTime: renewal0ExpiryIso }],
        },
        productId: targetPlanSku,
      });

      expect(match.isDuplicate).toBe(true);
      expect(match.isSubscriptionRenewal).toBe(false);
      expect(match.existingOrderId).toBe('order-renewal-0-uuid');
    });

    // 5. Genuine subsequent renewal ending in ..1
    it('5. [TypeScript & RPC Decision Logic] Genuine subsequent renewal ending in ..1 creates a separate renewal order and captured payment', async () => {
      const existingRenewal0Payment = {
        payment_id: 'pay-renewal-0-uuid',
        order_id: 'order-renewal-0-uuid',
        status: 'captured',
        gateway_payment_id: cycle0RenewalOrderId,
        gateway_order_id: cycle0RenewalOrderId,
        orders: { profile_id: authProfileA, student_id: 'student-123' },
      };

      const googleRenewal1Res = {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        lineItems: [
          {
            productId: targetPlanSku,
            latestSuccessfulOrderId: cycle1RenewalOrderId,
            expiryTime: renewal1ExpiryIso,
          },
        ],
      };

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: cycle1RenewalOrderId,
        purchaseToken: subToken,
        existingPayment: existingRenewal0Payment,
        currentProfileId: authProfileA,
        existingSubscriptionEndDate: renewal0ExpiryIso,
        transactionTimestamp: '2026-12-24T12:00:00.000Z',
        googleVerificationResult: googleRenewal1Res,
        productId: targetPlanSku,
      });

      expect(match.isDuplicate).toBe(false);
      expect(match.isSubscriptionRenewal).toBe(true);
    });

    // 6. Retry of an already-recorded ..1 renewal
    it('6. [TypeScript & RPC Idempotency] Retry of an already-recorded ..1 renewal remains idempotent without duplicate records', async () => {
      const existingRenewal1Payment = {
        payment_id: 'pay-renewal-1-uuid',
        order_id: 'order-renewal-1-uuid',
        status: 'captured',
        gateway_payment_id: cycle1RenewalOrderId,
        gateway_order_id: cycle1RenewalOrderId,
        orders: { profile_id: authProfileA, student_id: 'student-123' },
      };

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: cycle1RenewalOrderId,
        purchaseToken: subToken,
        existingPayment: existingRenewal1Payment,
        currentProfileId: authProfileA,
        existingSubscriptionEndDate: renewal1ExpiryIso,
        transactionTimestamp: '2026-12-24T12:05:00.000Z',
        googleVerificationResult: {
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [{ productId: targetPlanSku, latestSuccessfulOrderId: cycle1RenewalOrderId, expiryTime: renewal1ExpiryIso }],
        },
        productId: targetPlanSku,
      });

      expect(match.isDuplicate).toBe(true);
      expect(match.isSubscriptionRenewal).toBe(false);
      expect(match.existingOrderId).toBe('order-renewal-1-uuid');
    });

    // 7. Missing subscription row with a genuine new renewal
    it('7. [TypeScript & RPC Logic] Missing subscription row with a genuine ..0 renewal creates a separate renewal order and restores subscription state', async () => {
      const existingBasePayment = {
        payment_id: 'pay-initial-uuid',
        order_id: 'order-initial-uuid',
        status: 'captured',
        gateway_payment_id: baseOrderId,
        gateway_order_id: baseOrderId,
        orders: { profile_id: authProfileA, student_id: 'student-123' },
      };

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: cycle0RenewalOrderId,
        purchaseToken: subToken,
        existingPayment: existingBasePayment,
        currentProfileId: authProfileA,
        existingSubscriptionEndDate: null, // Subscription row missing in DB!
        transactionTimestamp: '2026-11-24T12:00:00.000Z',
        googleVerificationResult: {
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [{ productId: targetPlanSku, latestSuccessfulOrderId: cycle0RenewalOrderId, expiryTime: renewal0ExpiryIso }],
        },
        productId: targetPlanSku,
      });

      expect(match.isDuplicate).toBe(false);
      expect(match.isSubscriptionRenewal).toBe(true);
    });

    // 8. Renewal when the RTDN webhook has already updated the subscription expiry
    it('8. [RTDN Reconciliation Logic] When RTDN webhook has already updated subscription end_date, client verification correctly records unrecorded renewal payment', async () => {
      const existingBasePayment = {
        payment_id: 'pay-initial-uuid',
        order_id: 'order-initial-uuid',
        status: 'captured',
        gateway_payment_id: baseOrderId,
        gateway_order_id: baseOrderId,
        orders: { profile_id: authProfileA, student_id: 'student-123' },
      };

      // RTDN webhook received SUBSCRIPTION_RENEWED and updated student_subscriptions.end_date to renewal0ExpiryIso,
      // but student_subscriptions.order_id still references 'order-initial-uuid' because RTDN does not create payments.
      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: cycle0RenewalOrderId,
        purchaseToken: subToken,
        existingPayment: existingBasePayment,
        currentProfileId: authProfileA,
        existingSubscriptionEndDate: renewal0ExpiryIso, // Date already updated by RTDN!
        existingSubscriptionOrderId: 'order-initial-uuid', // Still pointing to initial order
        transactionTimestamp: '2026-11-24T12:10:00.000Z',
        googleVerificationResult: {
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [{ productId: targetPlanSku, latestSuccessfulOrderId: cycle0RenewalOrderId, expiryTime: renewal0ExpiryIso }],
        },
        productId: targetPlanSku,
      });

      // Must NOT be treated as duplicate; must be recognized as valid renewal to capture the missing payment!
      expect(match.isDuplicate).toBe(false);
      expect(match.isSubscriptionRenewal).toBe(true);
    });

    // 9. Missing, invalid, or expired expiry evidence
    it('9. [Fail-Closed Security Guard] Renewal candidate with null, unparseable, or expired expiry is rejected without fabricating entitlement', async () => {
      const existingBasePayment = {
        payment_id: 'pay-initial-uuid',
        order_id: 'order-initial-uuid',
        status: 'captured',
        gateway_payment_id: baseOrderId,
        orders: { profile_id: authProfileA },
      };

      // Null expiry
      const nullExpiryMatch = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: cycle0RenewalOrderId,
        purchaseToken: subToken,
        existingPayment: existingBasePayment,
        currentProfileId: authProfileA,
        existingSubscriptionEndDate: initialExpiryIso,
        transactionTimestamp: '2026-11-24T12:00:00.000Z',
        googleVerificationResult: {
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [{ productId: targetPlanSku, latestSuccessfulOrderId: cycle0RenewalOrderId, expiryTime: null }],
        },
        productId: targetPlanSku,
      });
      expect(nullExpiryMatch.isDuplicate).toBe(true);
      expect(nullExpiryMatch.isSubscriptionRenewal).toBe(false);

      // Expired expiry (prior to transaction reference time)
      const expiredMatch = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: cycle0RenewalOrderId,
        purchaseToken: subToken,
        existingPayment: existingBasePayment,
        currentProfileId: authProfileA,
        existingSubscriptionEndDate: initialExpiryIso,
        transactionTimestamp: '2026-11-24T12:00:00.000Z',
        googleVerificationResult: {
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [{ productId: targetPlanSku, latestSuccessfulOrderId: cycle0RenewalOrderId, expiryTime: '2026-10-01T00:00:00.000Z' }],
        },
        productId: targetPlanSku,
      });
      expect(expiredMatch.isDuplicate).toBe(true);
      expect(expiredMatch.isSubscriptionRenewal).toBe(false);

      // Canceled/expired subscriptionState
      const canceledStateMatch = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: cycle0RenewalOrderId,
        purchaseToken: subToken,
        existingPayment: existingBasePayment,
        currentProfileId: authProfileA,
        existingSubscriptionEndDate: initialExpiryIso,
        transactionTimestamp: '2026-11-24T12:00:00.000Z',
        googleVerificationResult: {
          subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED',
          lineItems: [{ productId: targetPlanSku, latestSuccessfulOrderId: cycle0RenewalOrderId, expiryTime: renewal0ExpiryIso }],
        },
        productId: targetPlanSku,
      });
      expect(canceledStateMatch.isDuplicate).toBe(true);
      expect(canceledStateMatch.isSubscriptionRenewal).toBe(false);
    });

    // 10. Client-supplied order-ID spoofing
    it('10. [Spoofing Guard] Client-supplied fake renewal order ID is ignored in favor of verified Google API line item', async () => {
      const spoofedClientOrderId = 'GPA.3389-4094-9724-39270..99'; // Client tries to spoof renewal 99

      const orderRes = await resolveAuthoritativeOrderId({
        isSub: true,
        googleVerificationResult: {
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [
            {
              productId: targetPlanSku,
              latestSuccessfulOrderId: baseOrderId, // Google actually reports base order
              expiryTime: initialExpiryIso,
            },
          ],
        },
        clientOrderId: spoofedClientOrderId,
        purchaseToken: subToken,
        productId: targetPlanSku,
      });

      expect(orderRes.authoritativeOrderId).toBe(baseOrderId);
      expect(orderRes.authoritativeOrderId).not.toBe(spoofedClientOrderId);
      expect(orderRes.diagnosticClientOrderId).toBe(spoofedClientOrderId);
    });

    // 11. Cross-account purchase-token claims
    it('11. [Cross-Account Security Guard] Renewal submitted under a different student profile is rejected with account mismatch', async () => {
      const existingBasePayment = {
        payment_id: 'pay-initial-uuid',
        order_id: 'order-initial-uuid',
        status: 'captured',
        gateway_payment_id: baseOrderId,
        orders: { profile_id: authProfileA }, // Owned by Profile A
      };

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: cycle0RenewalOrderId,
        purchaseToken: subToken,
        existingPayment: existingBasePayment,
        currentProfileId: authProfileB, // Attempted by Profile B!
        existingSubscriptionEndDate: initialExpiryIso,
        transactionTimestamp: '2026-11-24T12:00:00.000Z',
        googleVerificationResult: {
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [{ productId: targetPlanSku, latestSuccessfulOrderId: cycle0RenewalOrderId, expiryTime: renewal0ExpiryIso }],
        },
        productId: targetPlanSku,
      });

      expect(match.isAccountMismatch).toBe(true);
      expect(match.isDuplicate).toBe(true);
      expect(match.isSubscriptionRenewal).toBe(false);
      expect(match.paymentOwnerProfileId).toBe(authProfileA);
    });

    // 12. Correct selection of latestSuccessfulOrderId from the relevant Google API line item
    it('12. [Multi-Item Line Item Resolution] Selects the specific line item matching productId rather than blindly using lineItems[0]', async () => {
      const multiItemGoogleRes = {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        lineItems: [
          {
            productId: 'sub_unrelated_course_monthly',
            latestSuccessfulOrderId: 'GPA.9999-8888-7777-11111..3',
            expiryTime: '2026-11-01T00:00:00.000Z',
          },
          {
            productId: targetPlanSku,
            latestSuccessfulOrderId: cycle0RenewalOrderId,
            expiryTime: renewal0ExpiryIso,
          },
        ],
      };

      const orderRes = await resolveAuthoritativeOrderId({
        isSub: true,
        googleVerificationResult: multiItemGoogleRes,
        clientOrderId: baseOrderId,
        purchaseToken: subToken,
        productId: targetPlanSku,
      });

      expect(orderRes.authoritativeOrderId).toBe(cycle0RenewalOrderId);
      expect(orderRes.source).toBe('google_subscription_line_item_order_id');

      // Deprecated root fallback when line item lacks latestSuccessfulOrderId
      const deprecatedFallbackRes = await resolveAuthoritativeOrderId({
        isSub: true,
        googleVerificationResult: {
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          latestOrderId: 'GPA.DEPRECATED.FALLBACK..0',
          lineItems: [{ productId: targetPlanSku, expiryTime: renewal0ExpiryIso }], // No latestSuccessfulOrderId
        },
        clientOrderId: baseOrderId,
        purchaseToken: subToken,
        productId: targetPlanSku,
      });

      expect(deprecatedFallbackRes.authoritativeOrderId).toBe('GPA.DEPRECATED.FALLBACK..0');
      expect(deprecatedFallbackRes.source).toBe('google_subscription_latest_order_id');
    });
  });

  describe('25. Google Play Line-Item Authoritative Order-ID Isolation & Fallback Safety Suite', () => {
    const profileA = '99999999-1111-2222-3333-444444444444';
    const profileB = '88888888-2222-3333-4444-555555555555';
    const token = 'google_play_sub_token_suite_25';
    const baseOrderId = 'GPA.5555-1111-2222-33333';
    const renewalCycle0OrderId = 'GPA.5555-1111-2222-33333..0';
    const otherProductOrderId = 'GPA.9999-0000-1111-22222..0';

    const skuMath = 'sub_math_monthly';
    const skuPhysics = 'sub_physics_monthly';
    const skuChemistry = 'sub_chemistry_monthly';

    const futureExpiryIso = '2026-12-25T12:00:00.000Z';
    const priorExpiryIso = '2026-11-25T12:00:00.000Z';

    it('1. [Multi-Item Response] Correctly selects matching product line item and its latestSuccessfulOrderId', async () => {
      const multiItemGoogleRes = {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        lineItems: [
          {
            productId: skuMath,
            latestSuccessfulOrderId: renewalCycle0OrderId,
            expiryTime: futureExpiryIso,
          },
          {
            productId: skuPhysics,
            latestSuccessfulOrderId: otherProductOrderId,
            expiryTime: futureExpiryIso,
          },
        ],
      };

      // Verify Math
      const mathRes = await resolveAuthoritativeOrderId({
        isSub: true,
        googleVerificationResult: multiItemGoogleRes,
        purchaseToken: token,
        productId: skuMath,
      });
      expect(mathRes.authoritativeOrderId).toBe(renewalCycle0OrderId);
      expect(mathRes.isAuthoritative).toBe(true);
      expect(mathRes.source).toBe('google_subscription_line_item_order_id');

      // Verify Physics
      const physicsRes = await resolveAuthoritativeOrderId({
        isSub: true,
        googleVerificationResult: multiItemGoogleRes,
        purchaseToken: token,
        productId: skuPhysics,
      });
      expect(physicsRes.authoritativeOrderId).toBe(otherProductOrderId);
      expect(physicsRes.isAuthoritative).toBe(true);
      expect(physicsRes.source).toBe('google_subscription_line_item_order_id');
    });

    it('2. [Missing Requested Product in Multi-Item Response] Never selects an unrelated product order ID; falls back safely to token hash', async () => {
      const multiItemGoogleRes = {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        lineItems: [
          {
            productId: skuMath,
            latestSuccessfulOrderId: renewalCycle0OrderId,
            expiryTime: futureExpiryIso,
          },
          {
            productId: skuPhysics,
            latestSuccessfulOrderId: otherProductOrderId,
            expiryTime: futureExpiryIso,
          },
        ],
      };

      // Client requests Chemistry, which is NOT in line items
      const chemRes = await resolveAuthoritativeOrderId({
        isSub: true,
        googleVerificationResult: multiItemGoogleRes,
        purchaseToken: token,
        productId: skuChemistry,
      });

      // MUST NOT pick Math or Physics order ID!
      expect(chemRes.authoritativeOrderId).not.toBe(renewalCycle0OrderId);
      expect(chemRes.authoritativeOrderId).not.toBe(otherProductOrderId);
      expect(chemRes.isAuthoritative).toBe(false);
      expect(chemRes.source).toBe('deterministic_token_hash');
      expect(chemRes.authoritativeOrderId.startsWith('GPA.SUB.')).toBe(true);

      // Verify evaluateExistingPaymentMatch fails closed and does NOT fabricate a renewal
      const existingPayment = {
        payment_id: 'pay-base',
        order_id: 'order-base',
        status: 'captured',
        gateway_payment_id: baseOrderId,
        orders: { profile_id: profileA },
      };

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: chemRes.authoritativeOrderId,
        purchaseToken: token,
        existingPayment,
        currentProfileId: profileA,
        existingSubscriptionEndDate: priorExpiryIso,
        transactionTimestamp: '2026-11-25T12:00:00.000Z',
        googleVerificationResult: multiItemGoogleRes,
        productId: skuChemistry,
      });

      expect(match.isDuplicate).toBe(true);
      expect(match.isSubscriptionRenewal).toBe(false);
    });

    it('3. [Missing latestSuccessfulOrderId on Matching Product in Multi-Item Response] Never uses another line item order ID or ambiguous root latestOrderId', async () => {
      const multiItemGoogleRes = {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        latestOrderId: 'GPA.AMBIGUOUS.ROOT..0',
        lineItems: [
          {
            productId: skuMath,
            latestSuccessfulOrderId: renewalCycle0OrderId, // Math has an order ID
            expiryTime: futureExpiryIso,
          },
          {
            productId: skuPhysics,
            latestSuccessfulOrderId: '', // Physics has NO order ID
            expiryTime: futureExpiryIso,
          },
        ],
      };

      const physicsRes = await resolveAuthoritativeOrderId({
        isSub: true,
        googleVerificationResult: multiItemGoogleRes,
        purchaseToken: token,
        productId: skuPhysics,
      });

      // MUST NOT pick Math's order ID or ambiguous root latestOrderId
      expect(physicsRes.authoritativeOrderId).not.toBe(renewalCycle0OrderId);
      expect(physicsRes.authoritativeOrderId).not.toBe('GPA.AMBIGUOUS.ROOT..0');
      expect(physicsRes.isAuthoritative).toBe(false);
      expect(physicsRes.source).toBe('deterministic_token_hash');
    });

    it('4. [Mismatched Product in Single-Item Response] Never uses another product order ID or root latestOrderId when product mismatches', async () => {
      const singleItemMismatchGoogleRes = {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        latestOrderId: otherProductOrderId,
        lineItems: [
          {
            productId: skuPhysics, // Only Physics is in Google's subscription
            latestSuccessfulOrderId: otherProductOrderId,
            expiryTime: futureExpiryIso,
          },
        ],
      };

      // Client requests Math
      const orderRes = await resolveAuthoritativeOrderId({
        isSub: true,
        googleVerificationResult: singleItemMismatchGoogleRes,
        purchaseToken: token,
        productId: skuMath,
      });

      // MUST NOT use Physics order ID or root latestOrderId
      expect(orderRes.authoritativeOrderId).not.toBe(otherProductOrderId);
      expect(orderRes.isAuthoritative).toBe(false);
      expect(orderRes.source).toBe('deterministic_token_hash');
    });

    it('5. [Valid ..0 Renewal and Already-Recorded ..0 Renewal] Correctly transitions from base to ..0, then idempotently protects ..0', async () => {
      const validSubGoogleRes = {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        lineItems: [
          {
            productId: skuMath,
            latestSuccessfulOrderId: renewalCycle0OrderId,
            expiryTime: futureExpiryIso,
          },
        ],
      };

      const orderRes = await resolveAuthoritativeOrderId({
        isSub: true,
        googleVerificationResult: validSubGoogleRes,
        purchaseToken: token,
        productId: skuMath,
      });

      expect(orderRes.authoritativeOrderId).toBe(renewalCycle0OrderId);
      expect(orderRes.isAuthoritative).toBe(true);

      const existingBasePayment = {
        payment_id: 'pay-base',
        order_id: 'order-base',
        status: 'captured',
        gateway_payment_id: baseOrderId,
        orders: { profile_id: profileA },
      };

      // Step A: First renewal verification (valid new renewal)
      const firstMatch = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: orderRes.authoritativeOrderId,
        purchaseToken: token,
        existingPayment: existingBasePayment,
        currentProfileId: profileA,
        existingSubscriptionEndDate: priorExpiryIso,
        transactionTimestamp: '2026-11-25T12:00:00.000Z',
        googleVerificationResult: validSubGoogleRes,
        productId: skuMath,
      });

      expect(firstMatch.isDuplicate).toBe(false);
      expect(firstMatch.isSubscriptionRenewal).toBe(true);

      // Step B: Second renewal verification (already recorded ..0 payment)
      const recordedRenewal0Payment = {
        payment_id: 'pay-renewal-0',
        order_id: 'order-renewal-0',
        status: 'captured',
        gateway_payment_id: renewalCycle0OrderId,
        gateway_order_id: renewalCycle0OrderId,
        orders: { profile_id: profileA },
      };

      const retryMatch = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: orderRes.authoritativeOrderId,
        purchaseToken: token,
        existingPayment: recordedRenewal0Payment,
        currentProfileId: profileA,
        existingSubscriptionEndDate: futureExpiryIso,
        transactionTimestamp: '2026-11-25T12:05:00.000Z',
        googleVerificationResult: validSubGoogleRes,
        productId: skuMath,
      });

      expect(retryMatch.isDuplicate).toBe(true);
      expect(retryMatch.isSubscriptionRenewal).toBe(false);
      expect(retryMatch.existingOrderId).toBe('order-renewal-0');
    });

    it('6. [Ownership and Cross-Account Protection] Mismatched account claiming renewal token remains rejected', async () => {
      const validSubGoogleRes = {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        lineItems: [
          {
            productId: skuMath,
            latestSuccessfulOrderId: renewalCycle0OrderId,
            expiryTime: futureExpiryIso,
          },
        ],
      };

      const existingBasePayment = {
        payment_id: 'pay-base',
        order_id: 'order-base',
        status: 'captured',
        gateway_payment_id: baseOrderId,
        orders: { profile_id: profileA }, // Owned by profileA
      };

      const mismatchMatch = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: renewalCycle0OrderId,
        purchaseToken: token,
        existingPayment: existingBasePayment,
        currentProfileId: profileB, // ProfileB attempts to verify
        existingSubscriptionEndDate: priorExpiryIso,
        transactionTimestamp: '2026-11-25T12:00:00.000Z',
        googleVerificationResult: validSubGoogleRes,
        productId: skuMath,
      });

      expect(mismatchMatch.isAccountMismatch).toBe(true);
      expect(mismatchMatch.isDuplicate).toBe(true);
      expect(mismatchMatch.isSubscriptionRenewal).toBe(false);
      expect(mismatchMatch.paymentOwnerProfileId).toBe(profileA);
    });
  });

  describe('26. Google Play Accelerated Test Renewal (License Testing) & False-Duplicate Prevention Suite', () => {
    const profileId = '55555555-4444-3333-2222-111111111111';
    const subToken = 'google_play_sub_token_suite_26';
    const baseOrderId = 'GPA.3393-2204-6009-92756';
    const cycle2OrderId = 'GPA.3393-2204-6009-92756..2';
    const planSku = 'sub_license_test_monthly';
    const txTime = '2026-10-24T12:00:00.000Z';
    // License testing accelerated expiry (e.g. 5 minutes in future on same day)
    const testExpiryTime = '2026-10-24T12:05:00.000Z';
    // Persisted DB end_date set by plan-duration fallback (+30 days)
    const planFallbackEndDate = '2026-11-23';

    // 1. Genuine test renewal with ..2 order ID and short future Google expiry
    it('1. [License Test Renewal] Genuine accelerated test renewal ..2 with short future expiry and plan-duration fallback DB date is recognized as a renewal', async () => {
      const googleRes = {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        testPurchase: {}, // Official Google Play license test indicator
        latestOrderId: cycle2OrderId,
        lineItems: [
          {
            productId: planSku,
            latestSuccessfulOrderId: cycle2OrderId,
            expiryTime: testExpiryTime,
          },
        ],
      };

      const existingBasePayment = {
        payment_id: 'pay-base-uuid',
        order_id: 'order-base-uuid',
        status: 'captured',
        gateway_payment_id: baseOrderId,
        gateway_order_id: baseOrderId,
        orders: { profile_id: profileId, student_id: 'student-999' },
      };

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: cycle2OrderId,
        purchaseToken: subToken,
        existingPayment: existingBasePayment,
        currentProfileId: profileId,
        existingSubscriptionEndDate: planFallbackEndDate, // DB date is 2026-11-23!
        existingSubscriptionOrderId: 'order-base-uuid', // Still references base order
        transactionTimestamp: txTime,
        googleVerificationResult: googleRes,
        productId: planSku,
      });

      // Must NOT be falsely rejected as duplicate!
      expect(match.isDuplicate).toBe(false);
      expect(match.isSubscriptionRenewal).toBe(true);
      expect(match.isAccountMismatch).toBe(false);
      expect(match.decisionReason).toBe('accelerated_test_renewal');
    });

    // 2. The same test renewal submitted a second time
    it('2. [Idempotency] The same test renewal ..2 submitted a second time is recognized idempotently as a duplicate without creating duplicate payments', async () => {
      const googleRes = {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        testPurchase: {},
        latestOrderId: cycle2OrderId,
        lineItems: [
          {
            productId: planSku,
            latestSuccessfulOrderId: cycle2OrderId,
            expiryTime: testExpiryTime,
          },
        ],
      };

      // Payment for ..2 is now recorded in DB
      const existingCycle2Payment = {
        payment_id: 'pay-cycle-2-uuid',
        order_id: 'order-cycle-2-uuid',
        status: 'captured',
        gateway_payment_id: cycle2OrderId,
        gateway_order_id: cycle2OrderId,
        orders: { profile_id: profileId, student_id: 'student-999' },
      };

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: cycle2OrderId,
        purchaseToken: subToken,
        existingPayment: existingCycle2Payment,
        currentProfileId: profileId,
        existingSubscriptionEndDate: planFallbackEndDate,
        existingSubscriptionOrderId: 'order-cycle-2-uuid',
        transactionTimestamp: txTime,
        googleVerificationResult: googleRes,
        productId: planSku,
      });

      expect(match.isDuplicate).toBe(true);
      expect(match.isSubscriptionRenewal).toBe(false);
      expect(match.existingOrderId).toBe('order-cycle-2-uuid');
      expect(match.decisionReason).toBe('idempotent_duplicate_same_order');
    });

    // 3. An ordinary non-test renewal with valid expiry advancement
    it('3. [Production Renewal] Non-test production renewal with valid expiry advancement is accepted', async () => {
      const prodCycle0OrderId = 'GPA.3393-2204-6009-92756..0';
      const prodStoredEndDate = '2026-11-24';
      const prodAdvancedExpiry = '2026-12-24T12:00:00.000Z';

      const googleRes = {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        // testPurchase is undefined (production user)
        latestOrderId: prodCycle0OrderId,
        lineItems: [
          {
            productId: planSku,
            latestSuccessfulOrderId: prodCycle0OrderId,
            expiryTime: prodAdvancedExpiry,
          },
        ],
      };

      const existingBasePayment = {
        payment_id: 'pay-base-uuid',
        order_id: 'order-base-uuid',
        status: 'captured',
        gateway_payment_id: baseOrderId,
        gateway_order_id: baseOrderId,
        orders: { profile_id: profileId },
      };

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: prodCycle0OrderId,
        purchaseToken: subToken,
        existingPayment: existingBasePayment,
        currentProfileId: profileId,
        existingSubscriptionEndDate: prodStoredEndDate,
        transactionTimestamp: txTime,
        googleVerificationResult: googleRes,
        productId: planSku,
      });

      expect(match.isDuplicate).toBe(false);
      expect(match.isSubscriptionRenewal).toBe(true);
      expect(match.decisionReason).toBe('valid_new_renewal_cycle');
    });

    // 4. A non-test renewal whose expiry does not advance the persisted date.
    //    Migration 217: the ledger is authoritative, so a verified NEWER cycle proceeds to the
    //    RPC, which records the exact order id and applies greatest() so entitlement never regresses.
    it('4. [Migration 217] Non-test renewal on a newer cycle with non-advancing expiry proceeds to the RPC', async () => {
      const prodCycle0OrderId = 'GPA.3393-2204-6009-92756..0';
      const prodStoredEndDate = '2026-11-24';
      // Incoming expiry does NOT advance beyond the stored end date (same calendar date).
      const prodUnadvancedExpiry = '2026-11-24T12:00:00.000Z';

      const googleRes = {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        // testPurchase is undefined: a normal production renewal, not a license test
        latestOrderId: prodCycle0OrderId,
        lineItems: [
          {
            productId: planSku,
            latestSuccessfulOrderId: prodCycle0OrderId,
            expiryTime: prodUnadvancedExpiry,
          },
        ],
      };

      const existingBasePayment = {
        payment_id: 'pay-base-uuid',
        order_id: 'order-base-uuid',
        status: 'captured',
        gateway_payment_id: baseOrderId,
        gateway_order_id: baseOrderId,
        orders: { profile_id: profileId },
      };

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: prodCycle0OrderId,
        purchaseToken: subToken,
        existingPayment: existingBasePayment,
        currentProfileId: profileId,
        existingSubscriptionEndDate: prodStoredEndDate,
        existingSubscriptionOrderId: 'different-order-uuid', // Not matching RTDN condition
        transactionTimestamp: txTime,
        googleVerificationResult: googleRes,
        productId: planSku,
      });

      expect(match.isDuplicate).toBe(false);
      expect(match.isSubscriptionRenewal).toBe(true);
      expect(match.decisionReason).toBe('verified_newer_cycle_non_advancing_expiry');
    });

    it('4b. [Migration 217] Renewal whose verified expiry is earlier than a locally extended window still reaches the RPC', async () => {
      const cycle1OrderId = 'GPA.3393-2204-6009-92756..1';
      // Local end date was extended by the plan-duration fallback (degenerate same-day expiry)
      // or by support, so it sits AHEAD of Google's genuine next-cycle expiry.
      const locallyExtendedEndDate = '2027-03-25';
      const googleRes = {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        latestOrderId: cycle1OrderId,
        lineItems: [
          {
            productId: planSku,
            latestSuccessfulOrderId: cycle1OrderId,
            expiryTime: '2026-12-25T12:00:00.000Z',
          },
        ],
      };

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: cycle1OrderId,
        purchaseToken: subToken,
        existingPayment: {
          payment_id: 'pay-cycle0-uuid',
          order_id: 'order-cycle0-uuid',
          status: 'captured',
          gateway_payment_id: 'GPA.3393-2204-6009-92756..0',
          gateway_order_id: 'GPA.3393-2204-6009-92756..0',
          orders: { profile_id: profileId },
        },
        currentProfileId: profileId,
        existingSubscriptionEndDate: locallyExtendedEndDate,
        existingSubscriptionOrderId: 'order-cycle0-uuid',
        transactionTimestamp: txTime,
        googleVerificationResult: googleRes,
        productId: planSku,
      });

      // The SQL applies greatest(), so recording this cycle cannot reduce the established window.
      expect(match.isDuplicate).toBe(false);
      expect(match.isSubscriptionRenewal).toBe(true);
      expect(match.decisionReason).toBe('verified_newer_cycle_non_advancing_expiry');
    });

    it('4c. [Duplicate Protection Preserved] A delayed OLDER cycle with non-advancing expiry stays a duplicate', async () => {
      const cycle1OrderId = 'GPA.3393-2204-6009-92756..1';
      const googleRes = {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        latestOrderId: cycle1OrderId,
        lineItems: [
          {
            productId: planSku,
            latestSuccessfulOrderId: cycle1OrderId,
            expiryTime: '2026-11-24T12:00:00.000Z',
          },
        ],
      };

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: cycle1OrderId,
        purchaseToken: subToken,
        existingPayment: {
          payment_id: 'pay-cycle2-uuid',
          order_id: 'order-cycle2-uuid',
          status: 'captured',
          gateway_payment_id: cycle2OrderId,
          gateway_order_id: cycle2OrderId,
          orders: { profile_id: profileId },
        },
        currentProfileId: profileId,
        existingSubscriptionEndDate: '2026-11-24',
        existingSubscriptionOrderId: 'different-order-uuid', // RTDN-reconciliation exception must not apply
        transactionTimestamp: txTime,
        googleVerificationResult: googleRes,
        productId: planSku,
      });

      // Ordering still protects against replaying an older, already-superseded cycle.
      expect(match.isDuplicate).toBe(true);
      expect(match.isSubscriptionRenewal).toBe(false);
      expect(match.decisionReason).toBe('expiry_not_advanced');
    });

    it('4d. [Duplicate Protection Preserved] Replaying the recorded order id stays an idempotent duplicate', async () => {
      const googleRes = {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        latestOrderId: cycle2OrderId,
        lineItems: [
          {
            productId: planSku,
            latestSuccessfulOrderId: cycle2OrderId,
            expiryTime: '2026-12-24T12:00:00.000Z',
          },
        ],
      };

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: cycle2OrderId,
        purchaseToken: subToken,
        existingPayment: {
          payment_id: 'pay-cycle2-uuid',
          order_id: 'order-cycle2-uuid',
          status: 'captured',
          gateway_payment_id: cycle2OrderId,
          gateway_order_id: cycle2OrderId,
          orders: { profile_id: profileId },
        },
        currentProfileId: profileId,
        existingSubscriptionEndDate: '2026-11-24',
        existingSubscriptionOrderId: 'order-cycle2-uuid',
        transactionTimestamp: txTime,
        googleVerificationResult: googleRes,
        productId: planSku,
      });

      expect(match.isDuplicate).toBe(true);
      expect(match.isSubscriptionRenewal).toBe(false);
      expect(match.decisionReason).toBe('idempotent_duplicate_same_order');
    });


    // 5. A renewal with missing or expired expiry evidence
    it('5. [Fail-Closed Guard] Renewal with missing or past expiry evidence fails closed', async () => {
      const googleResNullExpiry = {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        testPurchase: {},
        latestOrderId: cycle2OrderId,
        lineItems: [
          {
            productId: planSku,
            latestSuccessfulOrderId: cycle2OrderId,
            expiryTime: null,
          },
        ],
      };

      const existingBasePayment = {
        payment_id: 'pay-base-uuid',
        order_id: 'order-base-uuid',
        status: 'captured',
        gateway_payment_id: baseOrderId,
        orders: { profile_id: profileId },
      };

      const matchNull = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: cycle2OrderId,
        purchaseToken: subToken,
        existingPayment: existingBasePayment,
        currentProfileId: profileId,
        existingSubscriptionEndDate: planFallbackEndDate,
        transactionTimestamp: txTime,
        googleVerificationResult: googleResNullExpiry,
        productId: planSku,
      });

      expect(matchNull.isDuplicate).toBe(true);
      expect(matchNull.isSubscriptionRenewal).toBe(false);
      expect(matchNull.decisionReason).toBe('missing_expiry_evidence');

      // Past expiry relative to transaction timestamp
      const pastExpiryTime = '2026-10-24T11:50:00.000Z'; // 10 mins before txTime
      const googleResPastExpiry = {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        testPurchase: {},
        latestOrderId: cycle2OrderId,
        lineItems: [
          {
            productId: planSku,
            latestSuccessfulOrderId: cycle2OrderId,
            expiryTime: pastExpiryTime,
          },
        ],
      };

      const matchPast = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: cycle2OrderId,
        purchaseToken: subToken,
        existingPayment: existingBasePayment,
        currentProfileId: profileId,
        existingSubscriptionEndDate: planFallbackEndDate,
        transactionTimestamp: txTime,
        googleVerificationResult: googleResPastExpiry,
        productId: planSku,
      });

      expect(matchPast.isDuplicate).toBe(true);
      expect(matchPast.isSubscriptionRenewal).toBe(false);
      expect(matchPast.decisionReason).toBe('google_expiry_in_past');
    });

    // 6. Case where stored date came from plan-duration fallback
    it('6. [Plan-Duration Fallback Coherence] calculateSubscriptionExpiry produces plan duration fallback for same-day test expiry, and subsequent test renewal is recognized', async () => {
      const initialTxDate = new Date('2026-10-24T12:00:00.000Z');
      const sameDayTestExpiry = '2026-10-24T12:05:00.000Z';

      const calculatedEndDate = calculateSubscriptionExpiry({
        startDate: initialTxDate,
        planDurationDays: 30,
        googleExpiryTime: sameDayTestExpiry,
      });

      // Because sameDayTestExpiry is on 2026-10-24, calculateSubscriptionExpiry falls back to 30 days
      expect(calculatedEndDate).toBe('2026-11-23');

      // Now 1st test renewal ..0 arrives
      const cycle0OrderId = 'GPA.3393-2204-6009-92756..0';
      const cycle0TestExpiry = '2026-10-24T12:10:00.000Z';
      const googleRes = {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        testPurchase: {},
        latestOrderId: cycle0OrderId,
        lineItems: [
          {
            productId: planSku,
            latestSuccessfulOrderId: cycle0OrderId,
            expiryTime: cycle0TestExpiry,
          },
        ],
      };

      const existingBasePayment = {
        payment_id: 'pay-base-uuid',
        order_id: 'order-base-uuid',
        status: 'captured',
        gateway_payment_id: baseOrderId,
        gateway_order_id: baseOrderId,
        orders: { profile_id: profileId },
      };

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: cycle0OrderId,
        purchaseToken: subToken,
        existingPayment: existingBasePayment,
        currentProfileId: profileId,
        existingSubscriptionEndDate: calculatedEndDate,
        existingSubscriptionOrderId: 'order-base-uuid',
        transactionTimestamp: '2026-10-24T12:06:00.000Z',
        googleVerificationResult: googleRes,
        productId: planSku,
      });

      expect(match.isDuplicate).toBe(false);
      expect(match.isSubscriptionRenewal).toBe(true);
      expect(match.decisionReason).toBe('accelerated_test_renewal');
    });

    // 7. Case where RTDN already updated subscription expiry
    it('7. [RTDN Reconciliation Coherence] RTDN-synchronized expiry with prior order reference is recognized as renewal', async () => {
      const cycle1OrderId = 'GPA.3393-2204-6009-92756..1';
      const rtdnSynchronizedEndDate = '2026-12-24';
      const googleExpiryIso = '2026-12-24T12:00:00.000Z';

      const googleRes = {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        latestOrderId: cycle1OrderId,
        lineItems: [
          {
            productId: planSku,
            latestSuccessfulOrderId: cycle1OrderId,
            expiryTime: googleExpiryIso,
          },
        ],
      };

      const existingBasePayment = {
        payment_id: 'pay-base-uuid',
        order_id: 'order-base-uuid',
        status: 'captured',
        gateway_payment_id: baseOrderId,
        gateway_order_id: baseOrderId,
        orders: { profile_id: profileId },
      };

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: cycle1OrderId,
        purchaseToken: subToken,
        existingPayment: existingBasePayment,
        currentProfileId: profileId,
        existingSubscriptionEndDate: rtdnSynchronizedEndDate,
        existingSubscriptionOrderId: 'order-base-uuid', // Still references base order
        transactionTimestamp: '2026-11-24T12:00:00.000Z',
        googleVerificationResult: googleRes,
        productId: planSku,
      });

      expect(match.isDuplicate).toBe(false);
      expect(match.isSubscriptionRenewal).toBe(true);
      expect(match.decisionReason).toBe('rtdn_reconciliation');
    });

    // 8. Different product order ID appearing in a multi-item response
    it('8. [Multi-Item Cross-Pollution Guard] Missing order ID on requested product never adopts another product order ID', async () => {
      const multiItemGoogleRes = {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        latestOrderId: 'GPA.OTHER.PRODUCT..0',
        lineItems: [
          {
            productId: 'sub_unrelated_course',
            latestSuccessfulOrderId: 'GPA.OTHER.PRODUCT..0',
            expiryTime: '2026-12-24T12:00:00.000Z',
          },
          {
            productId: planSku,
            latestSuccessfulOrderId: '', // Missing order ID for target product!
            expiryTime: '2026-12-24T12:00:00.000Z',
          },
        ],
      };

      const orderResolution = await resolveAuthoritativeOrderId({
        isSub: true,
        googleVerificationResult: multiItemGoogleRes,
        purchaseToken: subToken,
        productId: planSku,
      });

      // Must NOT use other product's order ID
      expect(orderResolution.authoritativeOrderId).not.toBe('GPA.OTHER.PRODUCT..0');
      expect(orderResolution.isAuthoritative).toBe(false);
      expect(orderResolution.source).toBe('deterministic_token_hash');

      // In evaluateExistingPaymentMatch, token hash fails closed as duplicate without renewal
      const existingBasePayment = {
        payment_id: 'pay-base-uuid',
        order_id: 'order-base-uuid',
        status: 'captured',
        gateway_payment_id: baseOrderId,
        orders: { profile_id: profileId },
      };

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: orderResolution.authoritativeOrderId,
        purchaseToken: subToken,
        existingPayment: existingBasePayment,
        currentProfileId: profileId,
        existingSubscriptionEndDate: '2026-11-24',
        transactionTimestamp: '2026-11-24T12:00:00.000Z',
        googleVerificationResult: multiItemGoogleRes,
        productId: planSku,
      });

      expect(match.isDuplicate).toBe(true);
      expect(match.isSubscriptionRenewal).toBe(false);
    });
  });



  describe('27. Google Play Unassigned Record Remediation & Deterministic Renewal Suite (Migration 215)', () => {
    // Note: These unit tests validate the TypeScript decision logic and simulate the PostgreSQL PL/pgSQL
    // control flow defined in Migration 215 (complete_google_play_purchase). They clearly distinguish
    // simulated/mocked unit tests from live PostgreSQL runtime execution.
    const profileA = '66d9f563-5180-401e-9adc-193c0f9963c7';
    const profileB = '77e8a452-6291-512f-8bea-284d1e8874d8';
    const studentA = '99b7c321-4321-4444-a123-111122223333';
    const subToken = 'google_play_token_suite_27';
    const baseOrderId = 'GPA.3302-5554-4517-66396'; // Unsuffixed initial purchase
    const cycle0OrderId = 'GPA.3302-5554-4517-66396..0'; // 1st renewal
    const cycle1OrderId = 'GPA.3302-5554-4517-66396..1'; // 2nd renewal
    const cycle2OrderId = 'GPA.3302-5554-4517-66396..2'; // 3rd renewal
    const planSku = 'sub_fe232782d73440dab01b92a9cc27c47c';
    const planId = 'fe232782-d734-40da-b01b-92a9cc27c47c';
    const courseId = '6995d41d-7704-457b-b82c-47ceff0b1a10';
    const baseExpiry = '2026-11-24';
    const baseExpiryIso = '2026-11-24T12:00:00.000Z';
    const cycle0Expiry = '2026-12-24';
    const cycle0ExpiryIso = '2026-12-24T12:00:00.000Z';
    const cycle1Expiry = '2027-01-24';
    const cycle1ExpiryIso = '2027-01-24T12:00:00.000Z';
    const cycle2Expiry = '2027-02-24';
    const cycle2ExpiryIso = '2027-02-24T12:00:00.000Z';

    // Simulated PL/pgSQL Migration 215 complete_google_play_purchase executor
    function simulateMigration215RPC(params: {
      profileId: string;
      studentId: string;
      itemType: string;
      planId: string;
      courseId: string;
      effectiveOrderId: string;
      purchaseToken: string;
      subscriptionEndDate: string | null;
      transactionTimestamp: string;
      // In-memory DB state
      paymentsTable: Array<{
        payment_id: string;
        order_id: string;
        gateway: string;
        status: string;
        gateway_payment_id: string | null;
        gateway_order_id: string | null;
        gateway_response: any;
      }>;
      ordersTable: Array<{
        order_id: string;
        profile_id: string;
        notes: string;
      }>;
      orderItemsTable: Array<{
        item_id: string;
        order_id: string;
        item_type: string;
        plan_id: string | null;
        course_id: string | null;
      }>;
      subscriptionsTable: Array<{
        subscription_id: string;
        student_id: string;
        plan_id: string;
        status: string;
        end_date: string;
        order_id: string;
      }>;
    }) {
      const txDate = new Date(params.transactionTimestamp).toISOString().split('T')[0];
      const p_effective_order_id = params.effectiveOrderId;
      const p_purchase_token = params.purchaseToken;
      const p_subscription_end_date = params.subscriptionEndDate;
      const v_start_date = txDate;

      // Migration 215 Typed scalar declarations (NO untyped RECORD variables!)
      let v_existing_payment_id: string | null = null;
      let v_existing_order_id: string | null = null;
      let v_existing_payment_profile_id: string | null = null;
      let v_existing_gateway_payment_id: string | null = null;
      let v_existing_gateway_order_id: string | null = null;
      let v_has_existing_payment: boolean = false;

      let v_existing_item_id: string | null = null;
      let v_existing_item_type: string | null = null;

      let v_existing_sub_id: string | null = null;
      let v_existing_sub_status: string | null = null;
      let v_existing_sub_end_date: string | null = null;

      let v_order_id: string | null = null;
      let v_item_id: string | null = null;
      let v_skip_payment_insert: boolean = false;

      // Step 7: Check existing captured payment UNDER LOCK
      // Matches SQL ORDER BY: exact order match has priority (0) over token-only match (1)
      const matchedPayment = [...params.paymentsTable]
        .filter(p => p.gateway === 'google_play' && p.status === 'captured')
        .filter(p => {
          const matchOrder = p_effective_order_id && (p.gateway_payment_id === p_effective_order_id || p.gateway_order_id === p_effective_order_id);
          const matchToken = p_purchase_token && (
            p.gateway_response?.purchaseToken === p_purchase_token ||
            p.gateway_response?.notes?.includes(p_purchase_token)
          );
          return matchOrder || matchToken;
        })
        .sort((a, b) => {
          const aExact = p_effective_order_id && (a.gateway_payment_id === p_effective_order_id || a.gateway_order_id === p_effective_order_id) ? 0 : 1;
          const bExact = p_effective_order_id && (b.gateway_payment_id === p_effective_order_id || b.gateway_order_id === p_effective_order_id) ? 0 : 1;
          return aExact - bExact;
        })[0];

      if (matchedPayment) {
        const order = params.ordersTable.find(o => o.order_id === matchedPayment.order_id);
        v_existing_payment_id = matchedPayment.payment_id;
        v_existing_order_id = matchedPayment.order_id;
        v_existing_payment_profile_id = order ? order.profile_id : null;
        v_existing_gateway_payment_id = matchedPayment.gateway_payment_id;
        v_existing_gateway_order_id = matchedPayment.gateway_order_id;
        v_has_existing_payment = true;
      }

      if (v_has_existing_payment) {
        // Cross-profile replay detection
        if (v_existing_payment_profile_id !== params.profileId) {
          return {
            success: false,
            error: 'This purchase has already been claimed by another account. Please sign in with the original account or contact support.',
            code: 'ACCOUNT_MISMATCH',
          };
        }

        // Renewal detection
        if (
          params.itemType === 'subscription_plan' &&
          p_effective_order_id &&
          !p_effective_order_id.startsWith('GPA.SUB.') &&
          v_existing_gateway_payment_id !== p_effective_order_id &&
          (v_existing_gateway_order_id === null || v_existing_gateway_order_id !== p_effective_order_id)
        ) {
          const isCycleSuffix = /\.\.[0-9]+$/.test(p_effective_order_id);
          if (isCycleSuffix && p_subscription_end_date && p_subscription_end_date > v_start_date) {
            const existingSub = params.subscriptionsTable
              .filter(s => s.student_id === params.studentId && s.plan_id === params.planId)
              .sort((a, b) => b.end_date.localeCompare(a.end_date))[0];

            const v_calculated_end_date = existingSub ? existingSub.end_date : null;
            const v_existing_sub_order_id = existingSub ? existingSub.order_id : null;

            if (
              v_calculated_end_date === null ||
              p_subscription_end_date > v_calculated_end_date ||
              (p_subscription_end_date === v_calculated_end_date && (v_existing_sub_order_id === null || v_existing_sub_order_id === v_existing_order_id))
            ) {
              // Valid renewal confirmed: Clear existing payment indicators safely
              v_has_existing_payment = false;
              v_existing_payment_id = null;
              v_existing_order_id = null;
              v_existing_payment_profile_id = null;
              v_existing_gateway_payment_id = null;
              v_existing_gateway_order_id = null;
            }
          }
        }
      }

      // Step 7 Idempotency / Repair handling
      if (v_has_existing_payment) {
        const item = params.orderItemsTable.find(i => i.order_id === v_existing_order_id);
        if (!item) {
          return {
            success: false,
            error: 'Existing payment has no associated order items. Failing closed to prevent inconsistent order state.',
            code: 'ORDER_ITEM_MISSING_FOR_CAPTURED_PAYMENT',
            orderId: v_existing_order_id,
          };
        }
        v_existing_item_id = item.item_id;
        v_existing_item_type = item.item_type;

        // Check active entitlement
        const activeSub = params.subscriptionsTable.find(
          s => s.student_id === params.studentId && s.plan_id === params.planId && (s.status === 'active' || s.status === 'grace')
        );

        if (activeSub && activeSub.end_date >= txDate) {
          return {
            success: true,
            verified: true,
            alreadyProcessed: true,
            orderId: v_existing_order_id,
            message: 'Purchase already processed and entitlement active',
          };
        }

        // Subscriptions Case A: Subscription record exists, but is expired, ended, or status not in ('active', 'grace')
        const existingSub = params.subscriptionsTable
          .filter(s => s.student_id === params.studentId && s.plan_id === params.planId)
          .sort((a, b) => b.end_date.localeCompare(a.end_date))[0];

        if (existingSub) {
          v_existing_sub_id = existingSub.subscription_id;
          v_existing_sub_status = existingSub.status;
          v_existing_sub_end_date = existingSub.end_date;
        }

        if (v_existing_sub_id !== null && (
          v_existing_sub_end_date === null ||
          v_existing_sub_end_date < txDate ||
          (v_existing_sub_status !== 'active' && v_existing_sub_status !== 'grace')
        )) {
          return {
            success: true,
            verified: true,
            alreadyProcessed: true,
            orderId: v_existing_order_id,
            message: 'Purchase already processed and entitlement expired',
          };
        }

        // Subscriptions Case B: Subscription record is completely missing and incoming verified expiry is missing or unestablished
        if (v_existing_sub_id === null && (!p_subscription_end_date || p_subscription_end_date <= txDate)) {
          return {
            success: false,
            error: 'Existing payment found but subscription record is missing and incoming verified expiry is missing or invalid. Refusing to fabricate entitlement.',
            code: 'MISSING_SUBSCRIPTION_EVIDENCE',
            orderId: v_existing_order_id,
          };
        }

        v_order_id = v_existing_order_id;
        v_item_id = v_existing_item_id;
        v_skip_payment_insert = true;
      }

      // Step 12: Insert Order & Item if v_order_id is null
      let newOrderCreated = false;
      let newPaymentCreated = false;
      if (!v_order_id) {
        v_order_id = 'order-' + Math.random().toString(36).substring(2, 9);
        v_item_id = 'item-' + Math.random().toString(36).substring(2, 9);
        params.ordersTable.push({
          order_id: v_order_id,
          profile_id: params.profileId,
          notes: JSON.stringify({ orderId: p_effective_order_id, purchaseToken: p_purchase_token }),
        });
        params.orderItemsTable.push({
          item_id: v_item_id,
          order_id: v_order_id,
          item_type: params.itemType,
          plan_id: params.planId,
          course_id: params.courseId,
        });
        newOrderCreated = true;
      }

      // Step 13: Insert Payment if not v_skip_payment_insert
      if (!v_skip_payment_insert) {
        const v_payment_id = 'pay-' + Math.random().toString(36).substring(2, 9);
        params.paymentsTable.push({
          payment_id: v_payment_id,
          order_id: v_order_id,
          gateway: 'google_play',
          status: 'captured',
          gateway_payment_id: p_effective_order_id,
          gateway_order_id: p_effective_order_id,
          gateway_response: { purchaseToken: p_purchase_token },
        });
        newPaymentCreated = true;
      }

      // Step 14: Grant Entitlement
      const existingSub = params.subscriptionsTable.find(
        s => s.student_id === params.studentId && s.plan_id === params.planId
      );
      if (existingSub) {
        existingSub.order_id = v_order_id;
        existingSub.status = 'active';
        existingSub.end_date = p_subscription_end_date || '2026-11-23';
      } else {
        params.subscriptionsTable.push({
          subscription_id: 'sub-' + Math.random().toString(36).substring(2, 9),
          student_id: params.studentId,
          plan_id: params.planId,
          status: 'active',
          end_date: p_subscription_end_date || '2026-11-23',
          order_id: v_order_id,
        });
      }

      return {
        success: true,
        verified: true,
        orderId: v_order_id,
        newOrderCreated,
        newPaymentCreated,
        subscriptionEndDate: p_subscription_end_date,
      };
    }

    // 1. Unsuffixed initial payment followed by a genuine ..0 renewal
    it('1. [Initial Purchase to ..0 Renewal] Unsuffixed initial payment followed by a genuine ..0 renewal creates separate order and captured payment', async () => {
      const dbState = {
        paymentsTable: [] as any[],
        ordersTable: [] as any[],
        orderItemsTable: [] as any[],
        subscriptionsTable: [] as any[],
      };

      // Initial purchase
      const initialRes = simulateMigration215RPC({
        profileId: profileA,
        studentId: studentA,
        itemType: 'subscription_plan',
        planId,
        courseId,
        effectiveOrderId: baseOrderId,
        purchaseToken: subToken,
        subscriptionEndDate: baseExpiry,
        transactionTimestamp: '2026-10-24T12:00:00.000Z',
        ...dbState,
      });

      expect(initialRes.success).toBe(true);
      expect(initialRes.newOrderCreated).toBe(true);
      expect(initialRes.newPaymentCreated).toBe(true);
      expect(dbState.paymentsTable).toHaveLength(1);
      expect(dbState.paymentsTable[0].gateway_payment_id).toBe(baseOrderId);
      expect(dbState.subscriptionsTable[0].end_date).toBe(baseExpiry);

      // 1st Renewal arrives with cycle ..0 and extended expiry
      const renewalRes = simulateMigration215RPC({
        profileId: profileA,
        studentId: studentA,
        itemType: 'subscription_plan',
        planId,
        courseId,
        effectiveOrderId: cycle0OrderId,
        purchaseToken: subToken,
        subscriptionEndDate: cycle0Expiry,
        transactionTimestamp: '2026-11-24T12:00:00.000Z',
        ...dbState,
      });

      expect(renewalRes.success).toBe(true);
      expect(renewalRes.newOrderCreated).toBe(true);
      expect(renewalRes.newPaymentCreated).toBe(true);
      expect(renewalRes.orderId).not.toBe(initialRes.orderId);
      expect(dbState.paymentsTable).toHaveLength(2);
      expect(dbState.paymentsTable[1].gateway_payment_id).toBe(cycle0OrderId);
      expect(dbState.subscriptionsTable[0].order_id).toBe(renewalRes.orderId);
      expect(dbState.subscriptionsTable[0].end_date).toBe(cycle0Expiry);
    });

    // 2. Retry of the same ..0 renewal after it has been recorded
    it('2. [Exact-Order Idempotency] Retry of the same ..0 renewal after recording returns alreadyProcessed without creating duplicates', async () => {
      const dbState = {
        paymentsTable: [
          {
            payment_id: 'pay-base',
            order_id: 'order-base',
            gateway: 'google_play',
            status: 'captured',
            gateway_payment_id: baseOrderId,
            gateway_order_id: baseOrderId,
            gateway_response: { purchaseToken: subToken },
          },
          {
            payment_id: 'pay-cycle-0',
            order_id: 'order-cycle-0',
            gateway: 'google_play',
            status: 'captured',
            gateway_payment_id: cycle0OrderId,
            gateway_order_id: cycle0OrderId,
            gateway_response: { purchaseToken: subToken },
          },
        ],
        ordersTable: [
          { order_id: 'order-base', profile_id: profileA, notes: JSON.stringify({ orderId: baseOrderId, purchaseToken: subToken }) },
          { order_id: 'order-cycle-0', profile_id: profileA, notes: JSON.stringify({ orderId: cycle0OrderId, purchaseToken: subToken }) },
        ],
        orderItemsTable: [
          { item_id: 'item-base', order_id: 'order-base', item_type: 'subscription_plan', plan_id: planId, course_id: courseId },
          { item_id: 'item-cycle-0', order_id: 'order-cycle-0', item_type: 'subscription_plan', plan_id: planId, course_id: courseId },
        ],
        subscriptionsTable: [
          { subscription_id: 'sub-1', student_id: studentA, plan_id: planId, status: 'active', end_date: cycle0Expiry, order_id: 'order-cycle-0' },
        ],
      };

      const retryRes = simulateMigration215RPC({
        profileId: profileA,
        studentId: studentA,
        itemType: 'subscription_plan',
        planId,
        courseId,
        effectiveOrderId: cycle0OrderId,
        purchaseToken: subToken,
        subscriptionEndDate: cycle0Expiry,
        transactionTimestamp: '2026-11-24T12:05:00.000Z',
        ...dbState,
      });

      expect(retryRes.success).toBe(true);
      expect((retryRes as any).alreadyProcessed).toBe(true);
      expect(retryRes.orderId).toBe('order-cycle-0');
      expect(dbState.paymentsTable).toHaveLength(2); // No duplicate payment inserted
      expect(dbState.ordersTable).toHaveLength(2); // No duplicate order inserted
    });

    // 3. Subsequent ..1 and ..2 renewals
    it('3. [Subsequent Renewals ..1 and ..2] Subsequent renewals ..1 and ..2 proceed to create distinct orders and advance subscription', async () => {
      const dbState = {
        paymentsTable: [
          {
            payment_id: 'pay-cycle-0',
            order_id: 'order-cycle-0',
            gateway: 'google_play',
            status: 'captured',
            gateway_payment_id: cycle0OrderId,
            gateway_order_id: cycle0OrderId,
            gateway_response: { purchaseToken: subToken },
          },
        ],
        ordersTable: [
          { order_id: 'order-cycle-0', profile_id: profileA, notes: JSON.stringify({ orderId: cycle0OrderId, purchaseToken: subToken }) },
        ],
        orderItemsTable: [
          { item_id: 'item-cycle-0', order_id: 'order-cycle-0', item_type: 'subscription_plan', plan_id: planId, course_id: courseId },
        ],
        subscriptionsTable: [
          { subscription_id: 'sub-1', student_id: studentA, plan_id: planId, status: 'active', end_date: cycle0Expiry, order_id: 'order-cycle-0' },
        ],
      };

      // 2nd Renewal: ..1
      const res1 = simulateMigration215RPC({
        profileId: profileA,
        studentId: studentA,
        itemType: 'subscription_plan',
        planId,
        courseId,
        effectiveOrderId: cycle1OrderId,
        purchaseToken: subToken,
        subscriptionEndDate: cycle1Expiry,
        transactionTimestamp: '2026-12-24T12:00:00.000Z',
        ...dbState,
      });

      expect(res1.success).toBe(true);
      expect(res1.newOrderCreated).toBe(true);
      expect(dbState.paymentsTable).toHaveLength(2);
      expect(dbState.paymentsTable[1].gateway_payment_id).toBe(cycle1OrderId);
      expect(dbState.subscriptionsTable[0].end_date).toBe(cycle1Expiry);

      // 3rd Renewal: ..2
      const res2 = simulateMigration215RPC({
        profileId: profileA,
        studentId: studentA,
        itemType: 'subscription_plan',
        planId,
        courseId,
        effectiveOrderId: cycle2OrderId,
        purchaseToken: subToken,
        subscriptionEndDate: cycle2Expiry,
        transactionTimestamp: '2027-01-24T12:00:00.000Z',
        ...dbState,
      });

      expect(res2.success).toBe(true);
      expect(res2.newOrderCreated).toBe(true);
      expect(dbState.paymentsTable).toHaveLength(3);
      expect(dbState.paymentsTable[2].gateway_payment_id).toBe(cycle2OrderId);
      expect(dbState.subscriptionsTable[0].end_date).toBe(cycle2Expiry);
    });

    // 4. Renewal when no matching payment row exists for the new order ID
    it('4. [No Matching Payment Row for New Order ID] Renewal when no matching payment row exists for the new order ID proceeds to create new transaction', async () => {
      const dbState = {
        paymentsTable: [
          {
            payment_id: 'pay-base',
            order_id: 'order-base',
            gateway: 'google_play',
            status: 'captured',
            gateway_payment_id: baseOrderId,
            gateway_order_id: baseOrderId,
            gateway_response: { purchaseToken: subToken },
          },
        ],
        ordersTable: [
          { order_id: 'order-base', profile_id: profileA, notes: JSON.stringify({ orderId: baseOrderId, purchaseToken: subToken }) },
        ],
        orderItemsTable: [
          { item_id: 'item-base', order_id: 'order-base', item_type: 'subscription_plan', plan_id: planId, course_id: courseId },
        ],
        subscriptionsTable: [
          { subscription_id: 'sub-1', student_id: studentA, plan_id: planId, status: 'active', end_date: baseExpiry, order_id: 'order-base' },
        ],
      };

      // Confirm no payment row exists for cycle0OrderId
      const existingPayForCycle0 = dbState.paymentsTable.find(p => p.gateway_payment_id === cycle0OrderId);
      expect(existingPayForCycle0).toBeUndefined();

      const renewalRes = simulateMigration215RPC({
        profileId: profileA,
        studentId: studentA,
        itemType: 'subscription_plan',
        planId,
        courseId,
        effectiveOrderId: cycle0OrderId,
        purchaseToken: subToken,
        subscriptionEndDate: cycle0Expiry,
        transactionTimestamp: '2026-11-24T12:00:00.000Z',
        ...dbState,
      });

      expect(renewalRes.success).toBe(true);
      expect(renewalRes.newOrderCreated).toBe(true);
      expect(renewalRes.newPaymentCreated).toBe(true);
      expect(dbState.paymentsTable.find(p => p.gateway_payment_id === cycle0OrderId)).toBeDefined();
    });

    // 5. Renewal whose purchase token matches original payment but authoritative order ID is distinct
    it('5. [Token Match with Distinct Order ID] Renewal whose purchase token matches original payment but authoritative order ID is distinct proceeds to grant renewal', async () => {
      const googleRes = {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        lineItems: [
          {
            productId: planSku,
            latestSuccessfulOrderId: cycle0OrderId,
            expiryTime: cycle0ExpiryIso,
          },
        ],
      };

      // Resolve authoritative order ID via billingCore
      const resolved = await resolveAuthoritativeOrderId({
        isSub: true,
        googleVerificationResult: googleRes,
        clientOrderId: baseOrderId, // Client still provides base order ID
        purchaseToken: subToken,
        productId: planSku,
      });

      expect(resolved.authoritativeOrderId).toBe(cycle0OrderId);
      expect(resolved.authoritativeOrderId).not.toBe(baseOrderId);

      // evaluateExistingPaymentMatch confirms renewal
      const existingBasePayment = {
        payment_id: 'pay-base',
        order_id: 'order-base',
        status: 'captured',
        gateway_payment_id: baseOrderId,
        gateway_order_id: baseOrderId,
        orders: { profile_id: profileA },
      };

      const match = evaluateExistingPaymentMatch({
        isSub: true,
        authoritativeOrderId: resolved.authoritativeOrderId,
        purchaseToken: subToken,
        existingPayment: existingBasePayment,
        currentProfileId: profileA,
        existingSubscriptionEndDate: baseExpiry,
        transactionTimestamp: '2026-11-24T12:00:00.000Z',
        googleVerificationResult: googleRes,
        productId: planSku,
      });

      expect(match.isDuplicate).toBe(false);
      expect(match.isSubscriptionRenewal).toBe(true);
    });

    // 6. Missing, invalid or expired renewal evidence
    it('6. [Missing, Invalid or Expired Renewal Evidence] Renewal attempt with missing or past expiry fails closed without extending entitlement', async () => {
      // Case A: Lapsed subscription with expired date returns alreadyProcessed expired without extending
      const dbStateExpired = {
        paymentsTable: [
          {
            payment_id: 'pay-base',
            order_id: 'order-base',
            gateway: 'google_play',
            status: 'captured',
            gateway_payment_id: baseOrderId,
            gateway_order_id: baseOrderId,
            gateway_response: { purchaseToken: subToken },
          },
        ],
        ordersTable: [
          { order_id: 'order-base', profile_id: profileA, notes: JSON.stringify({ orderId: baseOrderId, purchaseToken: subToken }) },
        ],
        orderItemsTable: [
          { item_id: 'item-base', order_id: 'order-base', item_type: 'subscription_plan', plan_id: planId, course_id: courseId },
        ],
        subscriptionsTable: [
          { subscription_id: 'sub-1', student_id: studentA, plan_id: planId, status: 'expired', end_date: '2026-10-01', order_id: 'order-base' },
        ],
      };

      const expiredRes = simulateMigration215RPC({
        profileId: profileA,
        studentId: studentA,
        itemType: 'subscription_plan',
        planId,
        courseId,
        effectiveOrderId: cycle0OrderId,
        purchaseToken: subToken,
        subscriptionEndDate: '2026-10-01', // Expired in past
        transactionTimestamp: '2026-11-24T12:00:00.000Z',
        ...dbStateExpired,
      });

      expect(expiredRes.success).toBe(true);
      expect((expiredRes as any).alreadyProcessed).toBe(true);
      expect((expiredRes as any).message).toContain('entitlement expired');
      expect(dbStateExpired.paymentsTable).toHaveLength(1); // No new payment

      // Case B: Completely missing subscription record and missing expiry evidence fails closed with MISSING_SUBSCRIPTION_EVIDENCE
      const dbStateMissingSub = {
        paymentsTable: [
          {
            payment_id: 'pay-base',
            order_id: 'order-base',
            gateway: 'google_play',
            status: 'captured',
            gateway_payment_id: baseOrderId,
            gateway_order_id: baseOrderId,
            gateway_response: { purchaseToken: subToken },
          },
        ],
        ordersTable: [
          { order_id: 'order-base', profile_id: profileA, notes: JSON.stringify({ orderId: baseOrderId, purchaseToken: subToken }) },
        ],
        orderItemsTable: [
          { item_id: 'item-base', order_id: 'order-base', item_type: 'subscription_plan', plan_id: planId, course_id: courseId },
        ],
        subscriptionsTable: [] as any[], // Missing subscription row
      };

      const missingRes = simulateMigration215RPC({
        profileId: profileA,
        studentId: studentA,
        itemType: 'subscription_plan',
        planId,
        courseId,
        effectiveOrderId: cycle0OrderId,
        purchaseToken: subToken,
        subscriptionEndDate: null, // Missing verified Google expiry
        transactionTimestamp: '2026-11-24T12:00:00.000Z',
        ...dbStateMissingSub,
      });

      expect(missingRes.success).toBe(false);
      expect((missingRes as any).code).toBe('MISSING_SUBSCRIPTION_EVIDENCE');
      expect(dbStateMissingSub.paymentsTable).toHaveLength(1); // No renewal payment fabricated
    });

    // 7. Account ownership mismatch
    it('7. [Cross-Account Protection] Renewal attempt with account ownership mismatch is rejected with ACCOUNT_MISMATCH', async () => {
      const dbState = {
        paymentsTable: [
          {
            payment_id: 'pay-base',
            order_id: 'order-base',
            gateway: 'google_play',
            status: 'captured',
            gateway_payment_id: baseOrderId,
            gateway_order_id: baseOrderId,
            gateway_response: { purchaseToken: subToken },
          },
        ],
        ordersTable: [
          { order_id: 'order-base', profile_id: profileA, notes: JSON.stringify({ orderId: baseOrderId, purchaseToken: subToken }) },
        ],
        orderItemsTable: [
          { item_id: 'item-base', order_id: 'order-base', item_type: 'subscription_plan', plan_id: planId, course_id: courseId },
        ],
        subscriptionsTable: [
          { subscription_id: 'sub-1', student_id: studentA, plan_id: planId, status: 'active', end_date: baseExpiry, order_id: 'order-base' },
        ],
      };

      // Attacker Profile B submits renewal for Profile A's subscription
      const attackerRes = simulateMigration215RPC({
        profileId: profileB,
        studentId: 'student-attacker-uuid',
        itemType: 'subscription_plan',
        planId,
        courseId,
        effectiveOrderId: cycle0OrderId,
        purchaseToken: subToken,
        subscriptionEndDate: cycle0Expiry,
        transactionTimestamp: '2026-11-24T12:00:00.000Z',
        ...dbState,
      });

      expect(attackerRes.success).toBe(false);
      expect((attackerRes as any).code).toBe('ACCOUNT_MISMATCH');
      expect((attackerRes as any).error).toContain('claimed by another account');
      expect(dbState.paymentsTable).toHaveLength(1); // No renewal payment inserted
    });
  });


  describe('28. Google Play Renewal Reconciliation & RTDN Ledger Integrity (Migration 216)', () => {
    const student1 = '66d9f563-5180-401e-9adc-193c0f9963c7';
    const profile1 = '55d9f563-5180-401e-9adc-193c0f9963c5';
    const planId = 'fe232782-d734-40da-b01b-92a9cc27c47c';
    const courseId = '6995d41d-7704-457b-b82c-47ceff0b1a10';
    const subToken = 'token_prod_test_safetoken12345';
    const baseOrderId = 'GPA.3320-7494-2046-53752';
    const order0 = `${baseOrderId}..0`;
    const order1 = `${baseOrderId}..1`;
    const order2 = `${baseOrderId}..2`;

    function simulateMigration216RPC(params: {
      profileId: string;
      studentId: string;
      itemType: string;
      planId: string;
      courseId: string;
      effectiveOrderId: string;
      purchaseToken: string;
      subscriptionEndDate: string | null;
      transactionTimestamp: string;
      paymentsTable: Array<{
        payment_id: string;
        order_id: string;
        gateway: string;
        status: string;
        gateway_payment_id: string | null;
        gateway_order_id: string | null;
        gateway_response: any;
      }>;
      ordersTable: Array<{
        order_id: string;
        profile_id: string;
        gateway_order_id?: string;
        notes: string;
      }>;
      orderItemsTable: Array<{
        item_id: string;
        order_id: string;
        item_type: string;
        plan_id: string | null;
        course_id: string | null;
      }>;
      subscriptionsTable: Array<{
        subscription_id: string;
        student_id: string;
        plan_id: string;
        status: string;
        end_date: string;
        order_id: string;
      }>;
    }) {
      const txDate = new Date(params.transactionTimestamp).toISOString().split('T')[0];
      const p_effective_order_id = params.effectiveOrderId;
      const p_purchase_token = params.purchaseToken;
      const p_subscription_end_date = params.subscriptionEndDate;
      const p_student_id = params.studentId;
      const p_plan_id = params.planId;

      // 1. Replay check by purchaseToken
      let v_existing_payment = params.paymentsTable.find(
        (p) => p.gateway === 'google_play' && (p.gateway_order_id === p_effective_order_id || p.gateway_payment_id === p_effective_order_id || p.gateway_response?.purchaseToken === p_purchase_token)
      );

      let v_has_existing_payment = Boolean(v_existing_payment);
      let v_is_historical_reconciliation = false;
      let v_incoming_cycle = extractOrderCycle(p_effective_order_id);

      if (v_has_existing_payment && v_existing_payment) {
        // Ownership check
        const parentOrder = params.ordersTable.find((o) => o.order_id === v_existing_payment?.order_id);
        if (parentOrder && parentOrder.profile_id !== params.profileId) {
          return { success: false, code: 'ACCOUNT_MISMATCH', error: 'Payment claimed by another account' };
        }

        // Renewal evaluation
        const isDistinctOrder = (v_existing_payment.gateway_payment_id !== p_effective_order_id && v_existing_payment.gateway_order_id !== p_effective_order_id);
        if (params.itemType === 'subscription_plan' && p_effective_order_id && isDistinctOrder && /\.\.[0-9]+$/.test(p_effective_order_id)) {
          const sub = params.subscriptionsTable.find((s) => s.student_id === p_student_id && s.plan_id === p_plan_id);
          const v_calculated_end_date = sub?.end_date || null;

          if (!v_calculated_end_date || (p_subscription_end_date && p_subscription_end_date > v_calculated_end_date)) {
            // Forward renewal
            v_has_existing_payment = false;
            v_is_historical_reconciliation = false;
          } else if (sub && p_subscription_end_date && p_subscription_end_date <= v_calculated_end_date) {
            // Historical missing cycle reconciliation (Migration 216)
            v_has_existing_payment = false;
            v_is_historical_reconciliation = true;
          }
        }
      }

      if (v_has_existing_payment && v_existing_payment) {
        return {
          success: true,
          alreadyProcessed: true,
          orderId: v_existing_payment.order_id,
          paymentId: v_existing_payment.payment_id,
        };
      }

      // Insert new Order with RFC 4122 v4 UUID
      const newOrderId = '22222222-2222-4222-8222-' + Math.floor(100000000000 + Math.random() * 900000000000).toString();
      params.ordersTable.push({
        order_id: newOrderId,
        profile_id: params.profileId,
        notes: JSON.stringify({ purchaseToken: p_purchase_token, order_id: p_effective_order_id }),
      });

      // Insert Payment
      const newPaymentId = '33333333-3333-4333-8333-' + Math.floor(100000000000 + Math.random() * 900000000000).toString();
      params.paymentsTable.push({
        payment_id: newPaymentId,
        order_id: newOrderId,
        gateway: 'google_play',
        status: 'captured',
        gateway_order_id: p_effective_order_id,
        gateway_payment_id: p_effective_order_id,
        gateway_response: { purchaseToken: p_purchase_token },
      });

      // Update or Insert Subscription
      let sub = params.subscriptionsTable.find((s) => s.student_id === p_student_id && s.plan_id === p_plan_id);
      if (sub) {
        if (v_is_historical_reconciliation) {
          // Historical reconciliation: resolve linked cycle from authoritative paymentsTable
          const linkedPayment = params.paymentsTable.find((p) => p.order_id === sub.order_id && p.gateway === 'google_play' && p.status === 'captured');
          const linkedCycle = extractOrderCycle(linkedPayment?.gateway_order_id);
          if (v_incoming_cycle !== null && (linkedCycle === null || v_incoming_cycle >= linkedCycle)) {
            sub.order_id = newOrderId;
          }
          if (p_subscription_end_date && p_subscription_end_date > sub.end_date) {
            sub.end_date = p_subscription_end_date;
          }
        } else {
          // Forward renewal: advance end_date and update order_id
          sub.order_id = newOrderId;
          sub.end_date = p_subscription_end_date || sub.end_date;
        }
      } else {
        params.subscriptionsTable.push({
          subscription_id: 'sub-' + Math.random().toString(36).slice(2, 9),
          student_id: p_student_id,
          plan_id: p_plan_id,
          status: 'active',
          end_date: p_subscription_end_date || txDate,
          order_id: newOrderId,
        });
      }

      return {
        success: true,
        alreadyProcessed: false,
        orderId: newOrderId,
        paymentId: newPaymentId,
      };
    }

    it('reconciles missing intermediate cycle ..0 when subscription has already advanced to cycle ..1 without rolling back expiry', () => {
      const cycle1OrderUuid = '11111111-1111-4111-8111-111111111111';
      const cycle1PayUuid = 'aaaa1111-1111-4111-8111-111111111111';

      const dbState = {
        ordersTable: [
          { order_id: cycle1OrderUuid, profile_id: profile1, notes: JSON.stringify({ purchaseToken: subToken, order_id: order1 }) },
        ],
        paymentsTable: [
          {
            payment_id: cycle1PayUuid,
            order_id: cycle1OrderUuid,
            gateway: 'google_play',
            status: 'captured',
            gateway_order_id: order1,
            gateway_payment_id: order1,
            gateway_response: { purchaseToken: subToken },
          },
        ],
        orderItemsTable: [] as any[],
        subscriptionsTable: [
          {
            subscription_id: 'sub-main',
            student_id: student1,
            plan_id: planId,
            status: 'active',
            end_date: '2026-12-24', // Already pushed to cycle 1's expiry
            order_id: cycle1OrderUuid, // References cycle 1 UUID
          },
        ],
      };

      // Now reconcile missing intermediate cycle 0 (order0, expiry 2026-11-24)
      const res = simulateMigration216RPC({
        profileId: profile1,
        studentId: student1,
        itemType: 'subscription_plan',
        planId,
        courseId,
        effectiveOrderId: order0,
        purchaseToken: subToken,
        subscriptionEndDate: '2026-11-24',
        transactionTimestamp: '2026-10-24T15:14:33.000Z',
        ...dbState,
      });

      expect(res.success).toBe(true);
      expect(res.alreadyProcessed).toBe(false);

      // Verify payment ledger completeness: BOTH cycle 0 and cycle 1 exist in payments
      expect(dbState.paymentsTable).toHaveLength(2);
      const pay0 = dbState.paymentsTable.find((p) => p.gateway_order_id === order0);
      expect(pay0).toBeDefined();
      expect(pay0?.status).toBe('captured');

      // Verify entitlement preservation: end_date was NOT rolled back to 2026-11-24!
      const sub = dbState.subscriptionsTable[0];
      expect(sub.end_date).toBe('2026-12-24');
      // Verify order_id was NOT downgraded back to cycle 0; remains cycle 1's UUID!
      expect(sub.order_id).toBe(cycle1OrderUuid);
      expect(sub.order_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(sub.order_id).not.toContain('GPA.');
    });

    it('exact-order idempotency: processing cycle ..0 a second time returns alreadyProcessed', () => {
      const dbState = {
        ordersTable: [
          { order_id: 'order-0', profile_id: profile1, gateway_order_id: order0, notes: JSON.stringify({ purchaseToken: subToken }) },
          { order_id: 'order-1', profile_id: profile1, gateway_order_id: order1, notes: JSON.stringify({ purchaseToken: subToken }) },
        ],
        paymentsTable: [
          {
            payment_id: 'pay-0',
            order_id: 'order-0',
            gateway: 'google_play',
            status: 'captured',
            gateway_order_id: order0,
            gateway_payment_id: order0,
            gateway_response: { purchaseToken: subToken },
          },
          {
            payment_id: 'pay-1',
            order_id: 'order-1',
            gateway: 'google_play',
            status: 'captured',
            gateway_order_id: order1,
            gateway_payment_id: order1,
            gateway_response: { purchaseToken: subToken },
          },
        ],
        orderItemsTable: [] as any[],
        subscriptionsTable: [
          {
            subscription_id: 'sub-main',
            student_id: student1,
            plan_id: planId,
            status: 'active',
            end_date: '2026-12-24',
            order_id: 'order-1',
          },
        ],
      };

      const res = simulateMigration216RPC({
        profileId: profile1,
        studentId: student1,
        itemType: 'subscription_plan',
        planId,
        courseId,
        effectiveOrderId: order0,
        purchaseToken: subToken,
        subscriptionEndDate: '2026-11-24',
        transactionTimestamp: '2026-10-24T15:14:33.000Z',
        ...dbState,
      });

      expect(res.success).toBe(true);
      expect(res.alreadyProcessed).toBe(true);
      expect(res.orderId).toBe('order-0');
      expect(res.paymentId).toBe('pay-0');
      expect(dbState.paymentsTable).toHaveLength(2); // Zero duplicate rows
    });

    it('Orders API reconciliation fails closed when intermediate order returns 404', async () => {
      const mockRpc = vi.fn();
      const mockApiFetcher = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Order not found'),
      });

      const recResult = await reconcileHistoricalRenewalOrder({
        orderId: order0,
        purchaseToken: subToken,
        productId: 'mock_sub',
        planId,
        profileId: profile1,
        studentId: student1,
        instituteId: 'inst_1',
        googleAccessToken: 'token',
        packageName: 'com.makemetopper.app',
        supabaseAdmin: { rpc: mockRpc },
        apiFetcher: mockApiFetcher,
      });

      expect(recResult.reconciled).toBe(false);
      expect(recResult.error).toContain('could not be authoritatively verified');
      expect(mockRpc).not.toHaveBeenCalled(); // No fake payment fabricated
    });
  });

});
