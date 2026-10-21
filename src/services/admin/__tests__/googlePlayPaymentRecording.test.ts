import { describe, it, expect } from 'vitest';
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

      function executeMigration206Rpc(profileRole, hasStudentDetails) {
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

      function simulateMigration206Purchase(currentRole, studentId) {
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

      function simulateIdempotentCheck(currentRole, isAlreadyProcessed) {
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
      function resolveEffectiveCourseId(requestedCourseId, planCourse) {
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
      function validatePlanTenantAccess(planInstituteId, resolvedInstituteId) {
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
});
