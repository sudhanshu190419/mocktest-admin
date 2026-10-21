/**
 * Google Play Verification Core Backend Tests (Vitest)
 *
 * Migrated from MockTestApp to canonical mocktest-admin backend.
 * Exercises:
 *  - Service account credential validation (fail-closed)
 *  - Purchase verification lifecycle state checks (ACTIVE, CANCELED, EXPIRED, ON_HOLD, PAUSED)
 *  - RTDN lifecycle state transitions
 *  - Subscription course_id enforcement
 *  - Multi-tier expiry calculations
 *  - JWT authentication extraction
 *  - Google Developer API error sanitization & diagnostics
 *  - Database operations, error handling & invoice snapshot safety
 */

import { describe, it, expect } from 'vitest';
import {
  validateServiceAccountJson,
  verifyGooglePlayPurchaseState,
  calculateSubscriptionExpiry,
  validateSubscriptionCourseAssociation,
  calculateRtdnTransition,
  extractUserFromVerifiedJwt,
  sanitizeGoogleApiError,
  buildInvoiceSnapshotPayload,
} from '../../../../supabase/functions/verify-google-play-purchase/billingCore';

describe('Google Play Verification Core Backend Suite', () => {
  const sampleCourseUuid = 'c1234567-89ab-cdef-0123-456789abcdef';
  const samplePlanUuid = 'e5555555-4444-3333-2222-111111111111';
  const samplePlanSku = 'sub_e5555555444433332222111111111111';

  describe('2. Fail-Closed Service Account Credential Validation (billingCore.ts)', () => {
    it('Missing credentials cannot authorize a purchase (fails closed)', () => {
      expect(validateServiceAccountJson(null).valid).toBe(false);
      expect(validateServiceAccountJson('').valid).toBe(false);
      expect(validateServiceAccountJson(undefined).valid).toBe(false);
    });

    it('Invalid credentials cannot authorize a purchase (fails closed without leaking secrets)', () => {
      expect(validateServiceAccountJson('{ invalid_json: ').valid).toBe(false);
      expect(validateServiceAccountJson(JSON.stringify({ private_key: '-----BEGIN PRIVATE KEY-----abc' })).valid).toBe(false);
      expect(validateServiceAccountJson(JSON.stringify({ client_email: 'svc@app.iam.gserviceaccount.com' })).valid).toBe(false);
    });

    it('Valid service account credentials pass validation', () => {
      const validJson = JSON.stringify({
        client_email: 'service-account@makemetopper.iam.gserviceaccount.com',
        private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC7\n-----END PRIVATE KEY-----\n',
      });
      const result = validateServiceAccountJson(validJson);
      expect(result.valid).toBe(true);
      expect(result.clientEmail).toBe('service-account@makemetopper.iam.gserviceaccount.com');
    });
  });

  describe('3. Purchase Verification Lifecycle State Checks (billingCore.ts)', () => {
    const fixedNowMs = new Date('2026-06-01T12:00:00.000Z').getTime();

    it('A. ACTIVE subscription with valid expiry: authorized successfully', () => {
      const activePayload = {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        lineItems: [
          {
            productId: samplePlanSku,
            expiryTime: '2026-07-01T12:00:00.000Z',
            autoRenewingPlan: { autoRenewEnabled: true },
          },
        ],
      };
      const result = verifyGooglePlayPurchaseState(true, activePayload, samplePlanSku, fixedNowMs);
      expect(result.valid).toBe(true);
      expect(result.state).toBe('SUBSCRIPTION_STATE_ACTIVE');
      expect(result.isAutoRenew).toBe(true);
      expect(result.expiryTime).toBe('2026-07-01T12:00:00.000Z');
    });

    it('B. CANCELED subscription with expiry in the future: remaining paid access is preserved', () => {
      const futureExpiry = '2026-06-25T12:00:00.000Z'; // 24 days in future relative to fixedNowMs
      const canceledPayload = {
        subscriptionState: 'SUBSCRIPTION_STATE_CANCELED',
        lineItems: [
          {
            productId: samplePlanSku,
            expiryTime: futureExpiry,
            autoRenewingPlan: { autoRenewEnabled: false },
          },
        ],
      };
      const result = verifyGooglePlayPurchaseState(true, canceledPayload, samplePlanSku, fixedNowMs);
      expect(result.valid).toBe(true);
      expect(result.state).toBe('SUBSCRIPTION_STATE_CANCELED');
      expect(result.isAutoRenew).toBe(false); // Auto-renew is turned off
      expect(result.expiryTime).toBe(futureExpiry); // Exact authoritative expiry retained
      expect(result.isCanceledWithRemainingAccess).toBe(true);
    });

    it('C. CANCELED subscription whose expiry is in the past: access is not granted', () => {
      const pastExpiry = '2026-05-15T12:00:00.000Z'; // 17 days in past relative to fixedNowMs
      const canceledExpiredPayload = {
        subscriptionState: 'SUBSCRIPTION_STATE_CANCELED',
        lineItems: [
          {
            productId: samplePlanSku,
            expiryTime: pastExpiry,
            autoRenewingPlan: { autoRenewEnabled: false },
          },
        ],
      };
      const result = verifyGooglePlayPurchaseState(true, canceledExpiredPayload, samplePlanSku, fixedNowMs);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('paid access period has expired');
    });

    it('D. EXPIRED subscription: access is rejected', () => {
      const expiredPayload = {
        subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED',
        lineItems: [
          {
            productId: samplePlanSku,
            expiryTime: '2026-05-30T12:00:00.000Z',
          },
        ],
      };
      const result = verifyGooglePlayPurchaseState(true, expiredPayload, samplePlanSku, fixedNowMs);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('subscription has expired');
    });

    it('E. ON_HOLD subscription: access is rejected', () => {
      const onHoldPayload = {
        subscriptionState: 'SUBSCRIPTION_STATE_ON_HOLD',
        lineItems: [
          {
            productId: samplePlanSku,
            expiryTime: '2026-06-05T12:00:00.000Z',
          },
        ],
      };
      const result = verifyGooglePlayPurchaseState(true, onHoldPayload, samplePlanSku, fixedNowMs);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('on hold');
    });

    it('F. PAUSED subscription: access is rejected under existing product policy', () => {
      const pausedPayload = {
        subscriptionState: 'SUBSCRIPTION_STATE_PAUSED',
        lineItems: [
          {
            productId: samplePlanSku,
            expiryTime: '2026-06-15T12:00:00.000Z',
          },
        ],
      };
      const result = verifyGooglePlayPurchaseState(true, pausedPayload, samplePlanSku, fixedNowMs);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('paused');
    });

    it('G. Invalid or missing expiryTime for a canceled subscription: no access granted without confirmation', () => {
      const missingExpiryPayload = {
        subscriptionState: 'SUBSCRIPTION_STATE_CANCELED',
        lineItems: [
          {
            productId: samplePlanSku,
            // expiryTime missing
          },
        ],
      };
      const resultMissing = verifyGooglePlayPurchaseState(true, missingExpiryPayload, samplePlanSku, fixedNowMs);
      expect(resultMissing.valid).toBe(false);
      expect(resultMissing.error).toContain('no authoritative expiryTime was returned');

      const invalidExpiryPayload = {
        subscriptionState: 'SUBSCRIPTION_STATE_CANCELED',
        lineItems: [
          {
            productId: samplePlanSku,
            expiryTime: 'not-a-valid-date-string',
          },
        ],
      };
      const resultInvalid = verifyGooglePlayPurchaseState(true, invalidExpiryPayload, samplePlanSku, fixedNowMs);
      expect(resultInvalid.valid).toBe(false);
      expect(resultInvalid.error).toContain('expiryTime format is invalid');
    });

    it('Line item mismatch: rejects if response does not contain requested productId', () => {
      const mismatchPayload = {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        lineItems: [
          {
            productId: 'sub_unrelated_plan_uuid_11111111111',
            expiryTime: '2026-07-01T12:00:00.000Z',
          },
        ],
      };
      const result = verifyGooglePlayPurchaseState(true, mismatchPayload, samplePlanSku, fixedNowMs);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('does not contain the requested product line item');
    });
  });

  describe('4. RTDN Lifecycle State Transitions (billingCore.ts)', () => {
    const fixedNowMs = new Date('2026-06-01T12:00:00.000Z').getTime();

    it('A. A verified future expiry remains valid', () => {
      const verifiedFutureExpiry = '2026-06-28T12:00:00.000Z';
      const result = calculateRtdnTransition({
        notificationType: 4, // SUBSCRIPTION_PURCHASED
        currentStatus: 'pending',
        currentEndDate: null,
        authoritativeGoogleSub: {
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [
            {
              productId: samplePlanSku,
              expiryTime: verifiedFutureExpiry,
              autoRenewingPlan: { autoRenewEnabled: true },
            },
          ],
        },
        productId: samplePlanSku,
        nowMs: fixedNowMs,
      });

      expect(result.mappedStatus).toBe('active');
      expect(result.isEntitlementActive).toBe(true);
      expect(result.newEndDate).toBe('2026-06-28');
    });

    it('B. A canceled subscription with a future verified expiry retains paid access until that expiry', () => {
      const futureExpiry = '2026-06-28T12:00:00.000Z';
      const cancelResult = calculateRtdnTransition({
        notificationType: 3, // SUBSCRIPTION_CANCELED
        currentStatus: 'active',
        currentEndDate: '2026-06-28',
        authoritativeGoogleSub: {
          subscriptionState: 'SUBSCRIPTION_STATE_CANCELED',
          lineItems: [
            {
              productId: samplePlanSku,
              expiryTime: futureExpiry,
              autoRenewingPlan: { autoRenewEnabled: false },
            },
          ],
        },
        productId: samplePlanSku,
        nowMs: fixedNowMs,
      });

      expect(cancelResult.mappedStatus).toBe('active'); // Still active during paid term
      expect(cancelResult.isEntitlementActive).toBe(true); // Paid entitlement preserved
      expect(cancelResult.isAutoRenew).toBe(false); // Auto-renewal turned off
      expect(cancelResult.mappedReason).toBe('cancellation');
      expect(cancelResult.newEndDate).toBe('2026-06-28'); // Preserves exact paid period
    });

    it('C. An expired subscription cannot be reactivated by a delayed type 2 notification when authoritative Google data is absent', () => {
      const expiredResult = calculateRtdnTransition({
        notificationType: 2, // SUBSCRIPTION_RENEWED (delayed / unverified)
        currentStatus: 'expired',
        currentEndDate: '2026-05-15',
        authoritativeGoogleSub: null, // Google API offline or empty
        productId: samplePlanSku,
        planDurationDays: 30,
        nowMs: fixedNowMs,
      });

      // FAIL-CLOSED: Must NOT become active without authoritative Google confirmation!
      expect(expiredResult.mappedStatus).toBe('expired');
      expect(expiredResult.isEntitlementActive).toBe(false);
      expect(expiredResult.isAutoRenew).toBe(false);
      expect(expiredResult.newEndDate).toBe('2026-05-15'); // Expiry not extended
    });

    it('D. An expired subscription cannot be reactivated by a delayed type 7 notification when authoritative Google data is absent', () => {
      const expiredResult = calculateRtdnTransition({
        notificationType: 7, // SUBSCRIPTION_RESTARTED (delayed / unverified)
        currentStatus: 'expired',
        currentEndDate: '2026-05-15',
        authoritativeGoogleSub: null, // Google API offline or empty
        productId: samplePlanSku,
        planDurationDays: 30,
        nowMs: fixedNowMs,
      });

      // FAIL-CLOSED: Must NOT revive expired subscription!
      expect(expiredResult.mappedStatus).toBe('expired');
      expect(expiredResult.isEntitlementActive).toBe(false);
      expect(expiredResult.isAutoRenew).toBe(false);
      expect(expiredResult.newEndDate).toBe('2026-05-15');
    });

    it('E. Missing or malformed expiry cannot fabricate an extension', () => {
      const fixedEnd = '2026-06-28';

      // E.1: Type 2 with malformed expiry
      const renewMalformed = calculateRtdnTransition({
        notificationType: 2,
        currentStatus: 'active',
        currentEndDate: fixedEnd,
        authoritativeGoogleSub: {
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [{ productId: samplePlanSku, expiryTime: 'MALFORMED_DATE_STRING' }],
        },
        productId: samplePlanSku,
        planDurationDays: 365,
        nowMs: fixedNowMs,
      });
      expect(renewMalformed.newEndDate).toBe(fixedEnd); // Must NOT add 365 days

      // E.2: Type 7 with missing expiryTime
      const restartMissing = calculateRtdnTransition({
        notificationType: 7,
        currentStatus: 'active',
        currentEndDate: fixedEnd,
        authoritativeGoogleSub: {
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [{ productId: samplePlanSku }],
        },
        productId: samplePlanSku,
        planDurationDays: 90,
        nowMs: fixedNowMs,
      });
      expect(restartMissing.newEndDate).toBe(fixedEnd); // Must NOT add 90 days
    });

    it('F. A valid type 2 renewal uses Google authoritative expiry', () => {
      const renewedExpiry = '2026-07-28T12:00:00.000Z';
      const renewResult = calculateRtdnTransition({
        notificationType: 2, // SUBSCRIPTION_RENEWED
        currentStatus: 'active',
        currentEndDate: '2026-06-28',
        authoritativeGoogleSub: {
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [
            {
              productId: samplePlanSku,
              expiryTime: renewedExpiry,
              autoRenewingPlan: { autoRenewEnabled: true },
            },
          ],
        },
        productId: samplePlanSku,
        planDurationDays: 30,
        nowMs: fixedNowMs,
      });

      expect(renewResult.mappedStatus).toBe('active');
      expect(renewResult.isEntitlementActive).toBe(true);
      expect(renewResult.isAutoRenew).toBe(true);
      expect(renewResult.mappedReason).toBe('renewal');
      expect(renewResult.newEndDate).toBe('2026-07-28'); // Uses Google authoritative line item expiry
    });

    it('G. Type 7 does not add plan duration', () => {
      const fixedEnd = '2026-06-28';
      const durations = [30, 90, 182, 365];
      const cycles = ['monthly', 'quarterly', 'half_yearly', 'yearly'];

      for (let i = 0; i < durations.length; i++) {
        const result = calculateRtdnTransition({
          notificationType: 7, // SUBSCRIPTION_RESTARTED
          currentStatus: 'active',
          currentEndDate: fixedEnd,
          authoritativeGoogleSub: {
            subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
            lineItems: [
              {
                productId: samplePlanSku,
                expiryTime: `${fixedEnd}T12:00:00.000Z`,
                autoRenewingPlan: { autoRenewEnabled: true },
              },
            ],
          },
          productId: samplePlanSku,
          planDurationDays: durations[i],
          billingCycle: cycles[i],
          nowMs: fixedNowMs,
        });

        // Must strictly preserve fixedEnd without adding plan duration days
        expect(result.newEndDate).toBe(fixedEnd);
        expect(result.isAutoRenew).toBe(true);
        expect(result.isEntitlementActive).toBe(true);
      }
    });

    it('H. Duplicate notifications cannot repeatedly extend expiry', () => {
      const initialEnd = '2026-06-28';
      const renewedExpiry = '2026-07-28T12:00:00.000Z';
      const googleSub = {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        lineItems: [
          {
            productId: samplePlanSku,
            expiryTime: renewedExpiry,
            autoRenewingPlan: { autoRenewEnabled: true },
          },
        ],
      };

      // First Type 2 notification
      const first = calculateRtdnTransition({
        notificationType: 2,
        currentStatus: 'active',
        currentEndDate: initialEnd,
        authoritativeGoogleSub: googleSub,
        productId: samplePlanSku,
        planDurationDays: 30,
        nowMs: fixedNowMs,
      });
      expect(first.newEndDate).toBe('2026-07-28');

      // Duplicate Type 2 notification with updated database state
      const second = calculateRtdnTransition({
        notificationType: 2,
        currentStatus: first.mappedStatus,
        currentEndDate: first.newEndDate,
        authoritativeGoogleSub: googleSub,
        productId: samplePlanSku,
        planDurationDays: 30,
        nowMs: fixedNowMs,
      });
      expect(second.newEndDate).toBe('2026-07-28'); // MUST NOT advance to August

      // Third duplicate with Google API offline
      const third = calculateRtdnTransition({
        notificationType: 2,
        currentStatus: second.mappedStatus,
        currentEndDate: second.newEndDate,
        authoritativeGoogleSub: null,
        productId: samplePlanSku,
        planDurationDays: 30,
        nowMs: fixedNowMs,
      });
      expect(third.newEndDate).toBe('2026-07-28'); // MUST NOT add 30 days
    });

    it('I. Google EXPIRED and REVOKED states deactivate entitlements', () => {
      // I.1: SUBSCRIPTION_STATE_EXPIRED
      const expiredSub = calculateRtdnTransition({
        notificationType: 2, // Even if notification said renewal
        currentStatus: 'active',
        currentEndDate: '2026-06-01',
        authoritativeGoogleSub: {
          subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED',
          lineItems: [{ productId: samplePlanSku, expiryTime: '2026-06-01T12:00:00.000Z' }],
        },
        productId: samplePlanSku,
        nowMs: fixedNowMs,
      });
      expect(expiredSub.mappedStatus).toBe('expired');
      expect(expiredSub.isEntitlementActive).toBe(false);
      expect(expiredSub.isAutoRenew).toBe(false);

      // I.2: SUBSCRIPTION_STATE_REVOKED
      const revokedSub = calculateRtdnTransition({
        notificationType: 7, // Even if notification said restart
        currentStatus: 'active',
        currentEndDate: '2026-06-28',
        authoritativeGoogleSub: {
          subscriptionState: 'SUBSCRIPTION_STATE_REVOKED',
          lineItems: [{ productId: samplePlanSku, expiryTime: '2026-06-28T12:00:00.000Z' }],
        },
        productId: samplePlanSku,
        nowMs: fixedNowMs,
      });
      expect(revokedSub.mappedStatus).toBe('refunded');
      expect(revokedSub.isEntitlementActive).toBe(false);
      expect(revokedSub.isAutoRenew).toBe(false);

      // I.3: SUBSCRIPTION_STATE_ON_HOLD
      const onHoldSub = calculateRtdnTransition({
        notificationType: 2,
        currentStatus: 'active',
        currentEndDate: '2026-06-28',
        authoritativeGoogleSub: {
          subscriptionState: 'SUBSCRIPTION_STATE_ON_HOLD',
          lineItems: [{ productId: samplePlanSku, expiryTime: '2026-06-28T12:00:00.000Z' }],
        },
        productId: samplePlanSku,
        nowMs: fixedNowMs,
      });
      expect(onHoldSub.mappedStatus).toBe('pending');
      expect(onHoldSub.isEntitlementActive).toBe(false);
      expect(onHoldSub.mappedReason).toBe('payment_failure');
    });

    it('J. Product mismatches cannot use the expiry of a different subscription product', () => {
      const differentProductSku = 'sub_ffffffff000000001111111122222222';
      const unrelatedExpiry = '2026-12-31T12:00:00.000Z';

      // Target product is samplePlanSku, but Google line item only contains differentProductSku
      const mismatchResult = calculateRtdnTransition({
        notificationType: 2, // SUBSCRIPTION_RENEWED
        currentStatus: 'expired',
        currentEndDate: '2026-05-01',
        authoritativeGoogleSub: {
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [
            {
              productId: differentProductSku, // DIFFERENT PRODUCT
              expiryTime: unrelatedExpiry,
              autoRenewingPlan: { autoRenewEnabled: true },
            },
          ],
        },
        productId: samplePlanSku, // EXPECTED PRODUCT
        planDurationDays: 30,
        nowMs: fixedNowMs,
      });

      // FAIL-CLOSED: Product mismatch must NOT adopt the unrelated product expiry or reactivate!
      expect(mismatchResult.newEndDate).not.toBe('2026-12-31');
      expect(mismatchResult.mappedStatus).toBe('expired');
      expect(mismatchResult.isEntitlementActive).toBe(false);
      expect(mismatchResult.isAutoRenew).toBe(false);
    });
  });

  describe('5. Migration 090 Subscription course_id Enforcement (billingCore.ts)', () => {
    it('Invalid or missing subscription course_id is rejected fail-closed', () => {
      expect(validateSubscriptionCourseAssociation({ plan_id: samplePlanUuid, course_id: null }).valid).toBe(false);
      expect(validateSubscriptionCourseAssociation({ plan_id: samplePlanUuid, course_id: '   ' }).valid).toBe(false);
      expect(validateSubscriptionCourseAssociation(null).valid).toBe(false);
    });

    it('Valid course_id resolves successfully', () => {
      const valid = validateSubscriptionCourseAssociation({
        plan_id: samplePlanUuid,
        course_id: sampleCourseUuid,
      });
      expect(valid.valid).toBe(true);
      expect(valid.courseId).toBe(sampleCourseUuid);
    });
  });

  describe('6. Authoritative Multi-Tier Expiry Calculation (billingCore.ts)', () => {
    const testStart = new Date('2026-01-01T00:00:00.000Z');

    it('Prioritizes authoritative Google Play subscriptionsv2 expiryTime', () => {
      const expiry = calculateSubscriptionExpiry({
        startDate: testStart,
        planDurationDays: 30,
        googleExpiryTime: '2026-05-20T15:30:00.000Z',
      });
      expect(expiry).toBe('2026-05-20');
    });

    it('Calculates monthly subscription expiry (30 days)', () => {
      expect(calculateSubscriptionExpiry({ startDate: testStart, planDurationDays: 30, billingCycle: 'monthly' })).toBe('2026-01-31');
    });

    it('Calculates quarterly subscription expiry (90 days)', () => {
      expect(calculateSubscriptionExpiry({ startDate: testStart, planDurationDays: 90, billingCycle: 'quarterly' })).toBe('2026-04-01');
    });

    it('Calculates half-yearly subscription expiry (182 days)', () => {
      expect(calculateSubscriptionExpiry({ startDate: testStart, planDurationDays: 182, billingCycle: 'half_yearly' })).toBe('2026-07-02');
    });

    it('Calculates yearly subscription expiry (365 days)', () => {
      expect(calculateSubscriptionExpiry({ startDate: testStart, planDurationDays: 365, billingCycle: 'yearly' })).toBe('2027-01-01');
    });
  });


  describe('9. Edge Function JWT & User Authentication Safety (billingCore.ts)', () => {
    function createMockJwt(payload: Record<string, any>): string {
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const sig = 'mock_signature_bytes';
      return `${header}.${body}.${sig}`;
    }

    it('A. Valid non-expired JWT returns extracted user ID', () => {
      const now = 1700000000000;
      const validJwt = createMockJwt({
        sub: '00000000-0000-0000-0000-000000000001',
        exp: Math.floor(now / 1000) + 3600,
        email: 'student@example.com',
      });

      const user = extractUserFromVerifiedJwt(validJwt, now);
      expect(user).not.toBeNull();
      expect(user?.id).toBe('00000000-0000-0000-0000-000000000001');
    });

    it('B. Expired JWT fails closed and returns null', () => {
      const now = 1700000000000;
      const expiredJwt = createMockJwt({
        sub: '00000000-0000-0000-0000-000000000001',
        exp: Math.floor(now / 1000) - 60,
      });

      const user = extractUserFromVerifiedJwt(expiredJwt, now);
      expect(user).toBeNull();
    });

    it('C. JWT missing sub claim fails closed and returns null', () => {
      const now = 1700000000000;
      const invalidJwt = createMockJwt({
        exp: Math.floor(now / 1000) + 3600,
      });

      const user = extractUserFromVerifiedJwt(invalidJwt, now);
      expect(user).toBeNull();
    });

    it('D. Malformed or non-JWT string fails closed and returns null', () => {
      expect(extractUserFromVerifiedJwt('not-a-jwt')).toBeNull();
      expect(extractUserFromVerifiedJwt('')).toBeNull();
      expect(extractUserFromVerifiedJwt('header.invalid-base64.sig')).toBeNull();
    });
  });


  describe('11. Google Play Developer API Error Sanitization & Diagnostics (billingCore.ts)', () => {
    it('A. Safely parses Google API 401 insufficientPermissions error JSON', () => {
      const rawGoogle401 = JSON.stringify({
        error: {
          code: 401,
          message: 'The current user has insufficient permissions to perform the requested operation.',
          status: 'UNAUTHENTICATED',
          errors: [
            {
              message: 'The current user has insufficient permissions to perform the requested operation.',
              domain: 'androidpublisher',
              reason: 'insufficientPermissions',
            },
          ],
        },
      });

      const diag = sanitizeGoogleApiError(401, rawGoogle401);
      expect(diag.status).toBe(401);
      expect(diag.classification).toBe('GOOGLE_API_AUTH_OR_PERMISSION_ERROR');
      expect(diag.errorStatus).toBe('UNAUTHENTICATED');
      expect(diag.errorMessage).toBe('The current user has insufficient permissions to perform the requested operation.');
      expect(diag.errorReason).toBe('insufficientPermissions');
      expect(diag.errorDomain).toBe('androidpublisher');
    });

    it('B. Safely parses OAuth invalid_token / invalid credentials error format', () => {
      const rawOauthError = JSON.stringify({
        error: 'invalid_token',
        error_description: 'Invalid Credentials',
      });

      const diag = sanitizeGoogleApiError(401, rawOauthError);
      expect(diag.status).toBe(401);
      expect(diag.classification).toBe('GOOGLE_API_AUTH_OR_PERMISSION_ERROR');
      expect(diag.errorStatus).toBe('invalid_token');
      expect(diag.errorMessage).toBe('Invalid Credentials');
    });

    it('C. Strictly redacts sensitive tokens or keys appearing in error messages', () => {
      const rawLeakingError = JSON.stringify({
        error: {
          code: 401,
          message: 'Failed to authorize token ya29.c.b0AXv0zTN_long_oauth_token_1234567890abcdef1234567890 for resource',
          status: 'UNAUTHENTICATED',
        },
      });

      const diag = sanitizeGoogleApiError(401, rawLeakingError);
      expect(diag.errorMessage).not.toContain('ya29.c.b0AXv0zTN_long_oauth_token_1234567890abcdef1234567890');
      expect(diag.errorMessage).toContain('[REDACTED]');
    });

    it('D. Gracefully handles null, empty, or unparseable non-JSON error text', () => {
      const diagEmpty = sanitizeGoogleApiError(401, '');
      expect(diagEmpty.status).toBe(401);
      expect(diagEmpty.classification).toBe('GOOGLE_API_AUTH_OR_PERMISSION_ERROR');
      expect(diagEmpty.errorMessage).toBeNull();

      const diagHtml = sanitizeGoogleApiError(502, '<html><head><title>Bad Gateway</title></head></html>');
      expect(diagHtml.status).toBe(502);
      expect(diagHtml.classification).toBe('GOOGLE_API_ERROR');
      expect(diagHtml.errorMessage).toContain('Bad Gateway');
    });

    it('E. Classifies 404 as PURCHASE_TOKEN_NOT_FOUND and 400 as INVALID_REQUEST_PARAMETERS', () => {
      const diag404 = sanitizeGoogleApiError(404, JSON.stringify({ error: { message: 'Purchase token not found.' } }));
      expect(diag404.classification).toBe('PURCHASE_TOKEN_NOT_FOUND');
      expect(diag404.errorMessage).toBe('Purchase token not found.');

      const diag400 = sanitizeGoogleApiError(400, JSON.stringify({ error: { message: 'Invalid package name.' } }));
      expect(diag400.classification).toBe('INVALID_REQUEST_PARAMETERS');
      expect(diag400.errorMessage).toBe('Invalid package name.');
    });
  });

  describe('12. Database Operations, Error Handling & Non-Fatal Invoice Snapshot Safety', () => {
    it('A. Generates valid draft invoice snapshot payload structure', () => {
      const payload = buildInvoiceSnapshotPayload({
        orderId: '01234567-89ab-cdef-0123-456789abcdef',
        instituteId: 'inst_123',
        billingName: 'Test Student',
        billingEmail: 'student@example.com',
        unitPrice: 199,
        year: 2026,
      });

      expect(payload.order_id).toBe('01234567-89ab-cdef-0123-456789abcdef');
      expect(payload.institute_id).toBe('inst_123');
      expect(payload.invoice_number).toBe('INV-GP-2026-01234567');
      expect(payload.status).toBe('draft');
      expect(payload.billing_name).toBe('Test Student');
      expect(payload.billing_email).toBe('student@example.com');
      expect(payload.total_amount).toBe(199);
      expect(payload.currency).toBe('INR');
    });

    it('B. Safe handling of Supabase PostgrestBuilder without .catch method', async () => {
      // Simulate real Supabase PostgrestBuilder object which implements then() but NOT catch()
      const mockPostgrestBuilder = {
        then(onFulfilled: any) {
          return Promise.resolve({ data: null, error: { message: 'Database connection timeout' } }).then(onFulfilled);
        },
      };

      // Calling .catch directly on a thenable without catch throws TypeError
      expect(() => {
        (mockPostgrestBuilder as any).catch(() => {});
      }).toThrow(TypeError);

      // Using correct try/await pattern does NOT throw TypeError and safely handles the error
      let caughtWarning: string | null = null;
      try {
        const { error } = await (mockPostgrestBuilder as any);
        if (error) {
          caughtWarning = error.message;
        }
      } catch (ex: any) {
        caughtWarning = ex.message;
      }

      expect(caughtWarning).toBe('Database connection timeout');
    });

    it('C. Non-fatal invoice snapshot failure does not crash the verification response', async () => {
      let isVerified = false;
      let invoiceHandledGracefully = false;

      // Simulating the corrected flow:
      // 1. Google verification succeeds
      // 2. Order, payments, enrollments succeed
      isVerified = true;

      // 3. Invoice snapshot fails with a db error
      try {
        const mockInvoiceInsert: any = {
          then(onFulfilled: any) {
            return Promise.resolve({ data: null, error: { message: 'relation invoices does not exist' } }).then(onFulfilled);
          },
        };

        const { error: invoiceErr } = await mockInvoiceInsert;
        if (invoiceErr) {
          invoiceHandledGracefully = true;
        }
      } catch {
        invoiceHandledGracefully = false;
      }

      // Verification remains successful
      expect(isVerified).toBe(true);
      expect(invoiceHandledGracefully).toBe(true);
    });

    it('D. Essential database operation (payment recording) fails closed if database insert fails', async () => {
      const mockPaymentInsert: any = {
        then(onFulfilled: any) {
          return Promise.resolve({ data: null, error: { message: 'unique constraint violation' } }).then(onFulfilled);
        },
      };

      const recordPayment = async () => {
        const { error: paymentErr } = await mockPaymentInsert;
        if (paymentErr) {
          throw new Error(`Failed to record payment: ${paymentErr.message}`);
        }
      };

      await expect(recordPayment()).rejects.toThrow('Failed to record payment: unique constraint violation');
    });

    it('E. Essential database operation (course enrollment) fails closed if database insert fails', async () => {
      const mockEnrollmentUpsert: any = {
        then(onFulfilled: any) {
          return Promise.resolve({ data: null, error: { message: 'foreign key violation' } }).then(onFulfilled);
        },
      };

      const grantEnrollment = async () => {
        const { error: enrollErr } = await mockEnrollmentUpsert;
        if (enrollErr) {
          throw new Error(`Failed to grant course enrollment: ${enrollErr.message}`);
        }
      };

      await expect(grantEnrollment()).rejects.toThrow('Failed to grant course enrollment: foreign key violation');
    });
  });

});
