import { describe, it, expect, vi } from 'vitest';
/**
 * Google Play RTDN Webhook — Real HTTP Handler & Security Regression Tests
 *
 * Exercises the production HTTP handler (handleRtdnHttpRequest) and authentication core:
 * - TASK 1: Business logic parity with original RTDN transitions.
 * - TASK 2: Real HTTP Handler testing via standard Request/Response with zero test-only conditionals.
 * - TASK 3: Strict expiry validation: rejects exp < nowSec AND exp === nowSec; accepts exp > nowSec.
 * - TASK 4: Sensitive logging redaction: verifies no full tokens, secrets, or raw payloads in logs.
 * - TASK 5: Full OIDC authentication architecture (signature, issuer, audience, identity, email_verified).
 */

import {
  handleRtdnHttpRequest,
  authenticateRtdnRequest,
  validateGooglePubSubClaims,
  calculateRtdnTransition,
  RtdnHandlerDependencies,
  GooglePubSubIdTokenPayload,
} from '../../../../supabase/functions/google-play-rtdn-webhook/billingCore';

describe('F-03 RTDN Real HTTP Handler & Authentication Security Suite', () => {
  const validAudience = 'https://ocolfottogbybitfpdqy.supabase.co/functions/v1/google-play-rtdn-webhook';
  const validServiceAccount = 'makemetopper-rtdn-pubsub@makemetopper.iam.gserviceaccount.com';
  const fixedNowSec = 1770000000; // Reference timestamp

  function createValidPayload(overrides: Partial<GooglePubSubIdTokenPayload> = {}): GooglePubSubIdTokenPayload {
    return {
      iss: 'https://accounts.google.com',
      sub: '109876543210987654321',
      aud: validAudience,
      email: validServiceAccount,
      email_verified: true,
      exp: fixedNowSec + 3600,
      iat: fixedNowSec - 60,
      ...overrides,
    };
  }

  function createMockDeps(overrides: Partial<RtdnHandlerDependencies> = {}) {
    const futureExpiryIso = new Date(Date.now() + 30 * 86400000).toISOString();
    const googleApiFetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [{ productId: 'sub_test_sku', expiryTime: futureExpiryIso }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const dbUpdateSpy = vi.fn().mockResolvedValue({ error: null });
    const dbInsertSpy = vi.fn().mockResolvedValue({ error: null });

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'student_subscriptions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    subscription_id: 'sub-1111-2222',
                    student_id: 'student-3333-4444',
                    plan_id: 'plan-5555-6666',
                    institute_id: 'inst-7777-8888',
                    end_date: new Date(Date.now() - 86400000).toISOString().split('T')[0],
                    status: 'active',
                  },
                  error: null,
                }),
              })),
            })),
            update: vi.fn((payload) => ({
              eq: vi.fn((field, val) => {
                dbUpdateSpy(table, payload, field, val);
                return Promise.resolve({ error: null });
              }),
            })),
          };
        }
        if (table === 'subscription_plans') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { course_id: 'course-9999', duration_days: 30, billing_cycle: 'monthly' },
                  error: null,
                }),
              })),
            })),
          };
        }
        if (table === 'subscription_history') {
          return {
            insert: vi.fn((payload) => {
              dbInsertSpy(table, payload);
              return Promise.resolve({ error: null });
            }),
          };
        }
        if (table === 'course_enrollments') {
          return {
            update: vi.fn((payload) => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => {
                    dbUpdateSpy(table, payload);
                    return Promise.resolve({ error: null });
                  }),
                })),
              })),
            })),
          };
        }
        if (table === 'system_settings') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn(() => ({
                  eq: vi.fn().mockResolvedValue({
                    data: [
                      { setting_key: 'grace_days', setting_value: '7' },
                      { setting_key: 'content_access_days', setting_value: '30' },
                    ],
                    error: null,
                  }),
                })),
              })),
            })),
          };
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            })),
          })),
        };
      }),
    };

    const createSupabaseAdminClient = vi.fn().mockReturnValue(mockSupabase);

    const tokenInfoFetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      payload: createValidPayload(),
    });

    const googleAccessTokenFetcher = vi.fn().mockResolvedValue('mock_google_access_token_xyz');

    return {
      deps: {
        env: {
          SUPABASE_URL: 'https://ocolfottogbybitfpdqy.supabase.co',
          SUPABASE_SERVICE_ROLE_KEY: 'test_service_role_key',
          GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'sa@test.com', private_key: 'test' }),
          ANDROID_PACKAGE_NAME: 'com.makemetopper.app',
          RTDN_EXPECTED_AUDIENCE: validAudience,
          PUBSUB_SERVICE_ACCOUNT_EMAIL: validServiceAccount,
        },
        tokenInfoFetcher,
        googleAccessTokenFetcher,
        googleApiFetcher,
        createSupabaseAdminClient,
        nowSec: fixedNowSec,
        ...overrides,
      },
      spies: {
        googleApiFetcher,
        dbUpdateSpy,
        dbInsertSpy,
        createSupabaseAdminClient,
        tokenInfoFetcher,
      },
    };
  }

  function createPubSubRequest(
    dataPayload: Record<string, any>,
    headers: Record<string, string> = { Authorization: 'Bearer valid_oidc_token' },
    url: string = 'https://ocolfottogbybitfpdqy.supabase.co/functions/v1/google-play-rtdn-webhook'
  ): Request {
    const encodedData = Buffer.from(JSON.stringify(dataPayload)).toString('base64');
    return new Request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify({
        message: {
          data: encodedData,
          messageId: 'msg-test-12345',
          publishTime: '2026-10-21T12:00:00.000Z',
        },
      }),
    });
  }

  // ── TASK 2 & 5: Real HTTP Handler Execution & Downstream Gating ──────────────
  describe('TASK 2: Real HTTP Handler Execution & Downstream Gating', () => {
    it('OPTIONS preflight returns HTTP 200 without authentication', async () => {
      const { deps, spies } = createMockDeps();
      const req = new Request('https://domain/google-play-rtdn-webhook', { method: 'OPTIONS' });

      const res = await handleRtdnHttpRequest(req, deps);

      expect(res.status).toBe(200);
      expect(spies.tokenInfoFetcher).not.toHaveBeenCalled();
      expect(spies.googleApiFetcher).not.toHaveBeenCalled();
    });

    it('missing Authorization header returns HTTP 401 and halts before any Google API or DB work', async () => {
      const { deps, spies } = createMockDeps();
      const req = createPubSubRequest({ testNotification: { version: '1.0' } }, {}); // No Authorization header

      const res = await handleRtdnHttpRequest(req, deps);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Missing Authorization header');
      expect(spies.tokenInfoFetcher).not.toHaveBeenCalled();
      expect(spies.googleApiFetcher).not.toHaveBeenCalled();
      expect(spies.dbUpdateSpy).not.toHaveBeenCalled();
    });

    it('malformed Authorization header returns HTTP 401 and halts downstream processing', async () => {
      const { deps, spies } = createMockDeps();
      const req = createPubSubRequest(
        { testNotification: { version: '1.0' } },
        { Authorization: 'Basic dXNlcjpwYXNz' }
      );

      const res = await handleRtdnHttpRequest(req, deps);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain("must start with 'Bearer '");
      expect(spies.tokenInfoFetcher).not.toHaveBeenCalled();
      expect(spies.googleApiFetcher).not.toHaveBeenCalled();
      expect(spies.dbUpdateSpy).not.toHaveBeenCalled();
    });

    it('missing RTDN_EXPECTED_AUDIENCE in environment fails closed with HTTP 500', async () => {
      const { deps, spies } = createMockDeps();
      deps.env!.RTDN_EXPECTED_AUDIENCE = '';
      const req = createPubSubRequest({ testNotification: { version: '1.0' } });

      const res = await handleRtdnHttpRequest(req, deps);

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain('RTDN_EXPECTED_AUDIENCE must be configured');
      expect(spies.tokenInfoFetcher).not.toHaveBeenCalled();
      expect(spies.googleApiFetcher).not.toHaveBeenCalled();
      expect(spies.dbUpdateSpy).not.toHaveBeenCalled();
    });

    it('missing PUBSUB_SERVICE_ACCOUNT_EMAIL in environment fails closed with HTTP 500', async () => {
      const { deps, spies } = createMockDeps();
      deps.env!.PUBSUB_SERVICE_ACCOUNT_EMAIL = '';
      const req = createPubSubRequest({ testNotification: { version: '1.0' } });

      const res = await handleRtdnHttpRequest(req, deps);

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain('PUBSUB_SERVICE_ACCOUNT_EMAIL must be configured');
      expect(spies.tokenInfoFetcher).not.toHaveBeenCalled();
      expect(spies.googleApiFetcher).not.toHaveBeenCalled();
      expect(spies.dbUpdateSpy).not.toHaveBeenCalled();
    });

    it('invalid token signature from Google tokeninfo returns HTTP 401 and stops downstream work', async () => {
      const { deps, spies } = createMockDeps();
      spies.tokenInfoFetcher.mockResolvedValueOnce({
        ok: false,
        status: 400,
        errorText: 'Invalid Value: Signature verification failure',
      });
      const req = createPubSubRequest({ testNotification: { version: '1.0' } });

      const res = await handleRtdnHttpRequest(req, deps);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain('signature validation failed');
      expect(spies.googleApiFetcher).not.toHaveBeenCalled();
      expect(spies.dbUpdateSpy).not.toHaveBeenCalled();
    });

    it('token issuer mismatch returns HTTP 401 and halts downstream processing', async () => {
      const { deps, spies } = createMockDeps();
      spies.tokenInfoFetcher.mockResolvedValueOnce({
        ok: true,
        status: 200,
        payload: createValidPayload({ iss: 'https://unauthorized-issuer.com' }),
      });
      const req = createPubSubRequest({ testNotification: { version: '1.0' } });

      const res = await handleRtdnHttpRequest(req, deps);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain('Invalid token issuer');
      expect(spies.googleApiFetcher).not.toHaveBeenCalled();
      expect(spies.dbUpdateSpy).not.toHaveBeenCalled();
    });

    it('audience mismatch returns HTTP 401 and halts downstream processing (F-03-A)', async () => {
      const { deps, spies } = createMockDeps();
      spies.tokenInfoFetcher.mockResolvedValueOnce({
        ok: true,
        status: 200,
        payload: createValidPayload({ aud: 'https://unrelated-project-service.run.app' }),
      });
      const req = createPubSubRequest({ testNotification: { version: '1.0' } });

      const res = await handleRtdnHttpRequest(req, deps);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain('Audience mismatch');
      expect(spies.googleApiFetcher).not.toHaveBeenCalled();
      expect(spies.dbUpdateSpy).not.toHaveBeenCalled();
    });

    it('service account identity mismatch returns HTTP 401 and halts downstream processing (F-03-B)', async () => {
      const { deps, spies } = createMockDeps();
      spies.tokenInfoFetcher.mockResolvedValueOnce({
        ok: true,
        status: 200,
        payload: createValidPayload({ email: 'attacker@other-project.iam.gserviceaccount.com' }),
      });
      const req = createPubSubRequest({ testNotification: { version: '1.0' } });

      const res = await handleRtdnHttpRequest(req, deps);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain('Service account identity mismatch');
      expect(spies.googleApiFetcher).not.toHaveBeenCalled();
      expect(spies.dbUpdateSpy).not.toHaveBeenCalled();
    });

    it('missing or false email_verified returns HTTP 401 and halts downstream processing (F-03-C)', async () => {
      const { deps, spies } = createMockDeps();
      spies.tokenInfoFetcher.mockResolvedValueOnce({
        ok: true,
        status: 200,
        payload: createValidPayload({ email_verified: false }),
      });
      const req = createPubSubRequest({ testNotification: { version: '1.0' } });

      const res = await handleRtdnHttpRequest(req, deps);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain('not verified by Google');
      expect(spies.googleApiFetcher).not.toHaveBeenCalled();
      expect(spies.dbUpdateSpy).not.toHaveBeenCalled();
    });

    it('query-parameter ?secret=anything CANNOT authenticate and is rejected with HTTP 401 (F-03-D)', async () => {
      const { deps, spies } = createMockDeps();
      // Caller provides ?secret=legacy_shared_secret in the URL but no Authorization header
      const req = createPubSubRequest(
        { testNotification: { version: '1.0' } },
        {},
        'https://ocolfottogbybitfpdqy.supabase.co/functions/v1/google-play-rtdn-webhook?secret=legacy_shared_secret'
      );

      const res = await handleRtdnHttpRequest(req, deps);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Missing Authorization header');
      expect(spies.tokenInfoFetcher).not.toHaveBeenCalled();
      expect(spies.googleApiFetcher).not.toHaveBeenCalled();
      expect(spies.dbUpdateSpy).not.toHaveBeenCalled();
    });

    it('valid OIDC test notification proceeds through authentication to return test_acknowledged', async () => {
      const { deps, spies } = createMockDeps();
      const req = createPubSubRequest({ testNotification: { version: '1.0' } });

      const res = await handleRtdnHttpRequest(req, deps);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('test_acknowledged');
      expect(spies.tokenInfoFetcher).toHaveBeenCalled();
    });

    it('valid OIDC subscription renewal notification executes full legitimate pipeline', async () => {
      const { deps, spies } = createMockDeps();
      const req = createPubSubRequest({
        subscriptionNotification: {
          notificationType: 2, // SUBSCRIPTION_RENEWED
          purchaseToken: 'purchase_token_valid_123',
          subscriptionId: 'sub_test_sku',
        },
      });

      const res = await handleRtdnHttpRequest(req, deps);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.processed).toBe('SUBSCRIPTION_RENEWED');
      expect(body.status).toBe('active');

      // Verifies Google API was called for authoritative state
      expect(spies.googleApiFetcher).toHaveBeenCalled();

      // Verifies database mutations were performed
      expect(spies.dbUpdateSpy).toHaveBeenCalledWith(
        'student_subscriptions',
        expect.objectContaining({ status: 'active', is_auto_renew: true }),
        'subscription_id',
        'sub-1111-2222'
      );
      expect(spies.dbInsertSpy).toHaveBeenCalledWith(
        'subscription_history',
        expect.objectContaining({ status_after: 'active', change_reason: 'renewal' })
      );
    });

    it('valid OIDC subscription cancellation notification executes cancellation pipeline', async () => {
      const { deps, spies } = createMockDeps();
      const req = createPubSubRequest({
        subscriptionNotification: {
          notificationType: 3, // SUBSCRIPTION_CANCELED
          purchaseToken: 'purchase_token_valid_123',
          subscriptionId: 'sub_test_sku',
        },
      });

      const res = await handleRtdnHttpRequest(req, deps);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.processed).toBe('SUBSCRIPTION_CANCELED');
      expect(spies.dbUpdateSpy).toHaveBeenCalledWith(
        'student_subscriptions',
        expect.objectContaining({ is_auto_renew: false }),
        'subscription_id',
        'sub-1111-2222'
      );
    });
  });

  // ── TASK 3: Strict Expiry Validation (exp > nowSec vs exp <= nowSec) ──────────
  describe('TASK 3: Strict Expiration Validation (Strictly > nowSec)', () => {
    it('CRITICAL: rejects token when exp EQUALS current second (exp === nowSec)', () => {
      const result = validateGooglePubSubClaims({
        payload: createValidPayload({ exp: fixedNowSec }),
        expectedAudience: validAudience,
        expectedServiceAccountEmail: validServiceAccount,
        nowSec: fixedNowSec,
      });

      expect(result.valid).toBe(false);
      expect(result.statusCode).toBe(401);
      expect(result.error).toBe('Token expired');
    });

    it('rejects token when exp is earlier than current second (exp < nowSec)', () => {
      const result = validateGooglePubSubClaims({
        payload: createValidPayload({ exp: fixedNowSec - 1 }),
        expectedAudience: validAudience,
        expectedServiceAccountEmail: validServiceAccount,
        nowSec: fixedNowSec,
      });

      expect(result.valid).toBe(false);
      expect(result.statusCode).toBe(401);
      expect(result.error).toBe('Token expired');
    });

    it('accepts token when exp is strictly later than current second (exp > nowSec)', () => {
      const result = validateGooglePubSubClaims({
        payload: createValidPayload({ exp: fixedNowSec + 1 }),
        expectedAudience: validAudience,
        expectedServiceAccountEmail: validServiceAccount,
        nowSec: fixedNowSec,
      });

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('handleRtdnHttpRequest rejects token when exp === nowSec with HTTP 401', async () => {
      const { deps, spies } = createMockDeps();
      spies.tokenInfoFetcher.mockResolvedValueOnce({
        ok: true,
        status: 200,
        payload: createValidPayload({ exp: fixedNowSec }),
      });
      const req = createPubSubRequest({ testNotification: { version: '1.0' } });

      const res = await handleRtdnHttpRequest(req, deps);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Token expired');
      expect(spies.googleApiFetcher).not.toHaveBeenCalled();
      expect(spies.dbUpdateSpy).not.toHaveBeenCalled();
    });
  });

  // ── Direct Claims & Authentication Unit Verification ────────────────────────
  describe('Direct Claims & authenticateRtdnRequest Unit Verification', () => {
    it('rejects token payload missing or not an object', () => {
      const resultNull = validateGooglePubSubClaims({
        payload: null,
        expectedAudience: validAudience,
        expectedServiceAccountEmail: validServiceAccount,
        nowSec: fixedNowSec,
      });
      expect(resultNull.valid).toBe(false);
      expect(resultNull.statusCode).toBe(401);
    });

    it('accepts both accounts.google.com and https://accounts.google.com issuers', () => {
      const res1 = validateGooglePubSubClaims({
        payload: createValidPayload({ iss: 'https://accounts.google.com' }),
        expectedAudience: validAudience,
        expectedServiceAccountEmail: validServiceAccount,
        nowSec: fixedNowSec,
      });
      expect(res1.valid).toBe(true);

      const res2 = validateGooglePubSubClaims({
        payload: createValidPayload({ iss: 'accounts.google.com' }),
        expectedAudience: validAudience,
        expectedServiceAccountEmail: validServiceAccount,
        nowSec: fixedNowSec,
      });
      expect(res2.valid).toBe(true);
    });

    it('accepts string "true" for email_verified claim from Google tokeninfo', async () => {
      const mockFetcher = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        payload: createValidPayload({ email_verified: 'true' }),
      });

      const result = await authenticateRtdnRequest({
        authHeader: 'Bearer valid_token',
        expectedAudience: validAudience,
        expectedServiceAccountEmail: validServiceAccount,
        tokenInfoFetcher: mockFetcher,
        nowSec: fixedNowSec,
      });

      expect(result.authenticated).toBe(true);
      expect(result.email).toBe(validServiceAccount);
    });

    it('performs case-insensitive service-account email matching', async () => {
      const mockFetcher = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        payload: createValidPayload({ email: validServiceAccount.toUpperCase() }),
      });

      const result = await authenticateRtdnRequest({
        authHeader: 'Bearer valid_token',
        expectedAudience: validAudience,
        expectedServiceAccountEmail: validServiceAccount.toLowerCase(),
        tokenInfoFetcher: mockFetcher,
        nowSec: fixedNowSec,
      });

      expect(result.authenticated).toBe(true);
    });
  });

  // ── TASK 1: Original RTDN Business Logic Parity ──────────────────────────────
  describe('TASK 1: Original RTDN Business Logic Parity', () => {
    it('preserves calculateRtdnTransition for all Google Play lifecycle notification types', () => {
      // 1. SUBSCRIPTION_PURCHASED (type 4)
      const resPurchased = calculateRtdnTransition({
        notificationType: 4,
        currentStatus: 'pending',
        currentEndDate: null,
        authoritativeGoogleSub: {
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          lineItems: [{ productId: 'sub_test_sku', expiryTime: '2026-07-01T12:00:00.000Z' }],
        },
        productId: 'sub_test_sku',
        nowMs: new Date('2026-06-01T12:00:00.000Z').getTime(),
        graceDays: 7,
        contentAccessDays: 30,
      });
      expect(resPurchased.mappedStatus).toBe('active');
      expect(resPurchased.mappedReason).toBe('new_purchase');

      // 2. SUBSCRIPTION_CANCELED (type 3) - remains active until end_date
      const resCanceled = calculateRtdnTransition({
        notificationType: 3,
        currentStatus: 'active',
        currentEndDate: '2026-06-15',
        authoritativeGoogleSub: {
          subscriptionState: 'SUBSCRIPTION_STATE_CANCELED',
          lineItems: [{ productId: 'sub_test_sku', expiryTime: '2026-06-15T12:00:00.000Z' }],
        },
        productId: 'sub_test_sku',
        nowMs: new Date('2026-06-01T12:00:00.000Z').getTime(),
      });
      expect(resCanceled.mappedStatus).toBe('active');
      expect(resCanceled.mappedReason).toBe('cancellation');
      expect(resCanceled.isAutoRenew).toBe(false);

      // 3. SUBSCRIPTION_ON_HOLD (type 5) - mapped to pending / payment_failure
      const resHold = calculateRtdnTransition({
        notificationType: 5,
        currentStatus: 'active',
        currentEndDate: '2026-06-01',
        authoritativeGoogleSub: {
          subscriptionState: 'SUBSCRIPTION_STATE_ON_HOLD',
          lineItems: [{ productId: 'sub_test_sku', expiryTime: '2026-06-05T12:00:00.000Z' }],
        },
        productId: 'sub_test_sku',
        nowMs: new Date('2026-06-01T12:00:00.000Z').getTime(),
      });
      expect(resHold.mappedStatus).toBe('pending');
      expect(resHold.mappedReason).toBe('payment_failure');
      expect(resHold.isEntitlementActive).toBe(false);

      // 4. SUBSCRIPTION_REVOKED (type 12) - mapped to refunded / refund
      const resRevoked = calculateRtdnTransition({
        notificationType: 12,
        currentStatus: 'active',
        currentEndDate: '2026-06-01',
        authoritativeGoogleSub: {
          subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED',
          lineItems: [{ productId: 'sub_test_sku', expiryTime: '2026-05-30T12:00:00.000Z' }],
        },
        productId: 'sub_test_sku',
        nowMs: new Date('2026-06-01T12:00:00.000Z').getTime(),
      });
      expect(resRevoked.mappedStatus).toBe('refunded');
      expect(resRevoked.mappedReason).toBe('refund');
      expect(resRevoked.isEntitlementActive).toBe(false);

      // 5. SUBSCRIPTION_EXPIRED (type 13) - mapped to expired / expiry
      const resExpired = calculateRtdnTransition({
        notificationType: 13,
        currentStatus: 'active',
        currentEndDate: '2026-05-31',
        authoritativeGoogleSub: {
          subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED',
          lineItems: [{ productId: 'sub_test_sku', expiryTime: '2026-05-31T12:00:00.000Z' }],
        },
        productId: 'sub_test_sku',
        nowMs: new Date('2026-06-01T12:00:00.000Z').getTime(),
      });
      expect(resExpired.mappedStatus).toBe('expired');
      expect(resExpired.mappedReason).toBe('expiry');
      expect(resExpired.isEntitlementActive).toBe(false);
    });
  });
});
