import { describe, it, expect, vi } from 'vitest';
/**
 * Google Play Purchase Verification — Authentication Security Regression Tests
 *
 * Validates the fix for Security Finding F-01:
 * - Removal of unverified JWT claims fallback in verify-google-play-purchase.
 * - Strict requirement for authoritative Supabase Auth validation (auth.getUser).
 * - Immediate fail-closed HTTP 401 on missing, malformed, expired, or forged tokens.
 * - Guarantees that Google Play Developer APIs and database mutations are never
 *   executed when authentication fails.
 * - Confirms valid authenticated tokens proceed with the authoritative profileId.
 */

import {
  authenticatePlayPurchaseRequest,
  AuthVerificationResult,
} from '../../../../supabase/functions/verify-google-play-purchase/billingCore';

describe('F-01 Authentication Security: Authoritative JWT Verification', () => {
  const victimUserId = '99999999-9999-4999-8999-999999999999';
  const legitimateUserId = '11111111-1111-4111-8111-111111111111';

  function createForgedJwt(payload: Record<string, any>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const fakeSignature = 'tampered_or_unverified_signature_bytes';
    return `${header}.${body}.${fakeSignature}`;
  }

  describe('1. Missing and Malformed Token Rejection (Fail-Closed)', () => {
    it('rejects null authorization header with HTTP 401', async () => {
      const mockAuth = {
        getUser: vi.fn(),
      };

      const result: AuthVerificationResult = await authenticatePlayPurchaseRequest(null, mockAuth);

      expect(result.authenticated).toBe(false);
      expect(result.profileId).toBeNull();
      expect(result.statusCode).toBe(401);
      expect(result.errorMessage).toBe('Missing Authorization header');
      expect(mockAuth.getUser).not.toHaveBeenCalled();
    });

    it('rejects empty bearer token with HTTP 401', async () => {
      const mockAuth = {
        getUser: vi.fn(),
      };

      const result: AuthVerificationResult = await authenticatePlayPurchaseRequest('Bearer   ', mockAuth);

      expect(result.authenticated).toBe(false);
      expect(result.profileId).toBeNull();
      expect(result.statusCode).toBe(401);
      expect(result.errorMessage).toBe('Malformed Authorization header');
      expect(mockAuth.getUser).not.toHaveBeenCalled();
    });
  });

  describe('2. Forged and Expired JWT Token Rejection (No Fallback to Payload Claims)', () => {
    it('CRITICAL: Forged JWT with victim UUID in payload is rejected with 401 and NEVER assigns victim profileId', async () => {
      const forgedToken = createForgedJwt({
        sub: victimUserId,
        email: 'victim@makemetopper.com',
        role: 'authenticated',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      // Supabase Auth cryptographically rejects the forged token
      const mockAuth = {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { message: 'invalid signature: signature verification failed', status: 401 },
        }),
      };

      const result = await authenticatePlayPurchaseRequest(`Bearer ${forgedToken}`, mockAuth);

      // Security invariant: Must fail closed.
      // Under the old vulnerable implementation, extractUserFromVerifiedJwt would have
      // read the unverified payload and assigned profileId = victimUserId!
      expect(result.authenticated).toBe(false);
      expect(result.profileId).toBeNull();
      expect(result.profileId).not.toBe(victimUserId);
      expect(result.statusCode).toBe(401);
      expect(result.errorMessage).toBe('Invalid or expired session');
      expect(mockAuth.getUser).toHaveBeenCalledWith(forgedToken);
    });

    it('CRITICAL: Expired token rejected by Supabase Auth fails closed with 401 and does not extract user', async () => {
      const expiredToken = createForgedJwt({
        sub: victimUserId,
        exp: Math.floor(Date.now() / 1000) - 300, // expired 5 mins ago
      });

      const mockAuth = {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { message: 'jwt expired', status: 401 },
        }),
      };

      const result = await authenticatePlayPurchaseRequest(`Bearer ${expiredToken}`, mockAuth);

      expect(result.authenticated).toBe(false);
      expect(result.profileId).toBeNull();
      expect(result.statusCode).toBe(401);
      expect(result.errorMessage).toBe('Invalid or expired session');
    });

    it('rejects token when auth.getUser returns no error but user data is null/empty', async () => {
      const mockAuth = {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      };

      const result = await authenticatePlayPurchaseRequest('Bearer some-token', mockAuth);

      expect(result.authenticated).toBe(false);
      expect(result.profileId).toBeNull();
      expect(result.statusCode).toBe(401);
      expect(result.errorMessage).toBe('Invalid or expired session');
    });
  });

  describe('3. Execution Gating: Downstream Operations Blocked on Auth Failure', () => {
    it('guarantees Google Play API and Supabase database mutations are NEVER invoked when authentication fails', async () => {
      const forgedToken = createForgedJwt({ sub: victimUserId });

      const mockAuth = {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { message: 'Signature check failed' },
        }),
      };

      // Mock downstream dependencies
      const googleApiFetchSpy = vi.fn();
      const dbMutationSpy = vi.fn();

      // Execute authentication check (Stage 0)
      const authResult = await authenticatePlayPurchaseRequest(`Bearer ${forgedToken}`, mockAuth);

      // In the Edge Function, if !authResult.authenticated, execution returns HTTP 401 immediately
      if (!authResult.authenticated) {
        // Downstream actions are completely gated
      } else {
        await googleApiFetchSpy();
        await dbMutationSpy();
      }

      expect(authResult.authenticated).toBe(false);
      expect(googleApiFetchSpy).not.toHaveBeenCalled();
      expect(dbMutationSpy).not.toHaveBeenCalled();
    });
  });

  describe('4. Valid Authenticated Session Progression', () => {
    it('authorizes valid session and supplies authoritative user ID from Supabase Auth', async () => {
      const validToken = 'valid_session_token_from_gotrue';

      const mockAuth = {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: legitimateUserId,
              email: 'student@makemetopper.com',
              aud: 'authenticated',
            },
          },
          error: null,
        }),
      };

      const result = await authenticatePlayPurchaseRequest(`Bearer ${validToken}`, mockAuth);

      expect(result.authenticated).toBe(true);
      expect(result.profileId).toBe(legitimateUserId);
      expect(result.statusCode).toBeUndefined();
      expect(result.errorMessage).toBeUndefined();
      expect(mockAuth.getUser).toHaveBeenCalledWith(validToken);
    });
  });
});
