import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signUp, resendOtp, signIn, verifyOtp, isCaptchaError, extractErrorMessage } from '../authService';
import { supabase } from '../../config/supabase';
import { AuthApiError } from '@supabase/supabase-js';

vi.mock('../../config/supabase', () => ({
  supabase: {
    auth: {
      signUp: vi.fn(),
      signInWithOtp: vi.fn(),
      signInWithPassword: vi.fn(),
      verifyOtp: vi.fn(),
      getUser: vi.fn(),
      getSession: vi.fn(),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
  },
}));

vi.mock('../audit/auditService', () => ({
  auditService: {
    logLogin: vi.fn().mockResolvedValue(undefined),
    logLogout: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('Cloudflare Turnstile Web Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AUTO-WEB-01: signUp passes captchaToken in options.captchaToken', async () => {
    (supabase.auth.signUp as any).mockResolvedValueOnce({
      data: { user: { id: 'test-user-id', phone: '+919876543210' } },
      error: null,
    });

    const result = await signUp({
      phone: '+919876543210',
      password: 'password123',
      name: 'Test Student',
      captchaToken: 'valid-turnstile-test-token',
    });

    expect(result.success).toBe(true);
    expect(supabase.auth.signUp).toHaveBeenCalledWith({
      phone: '+919876543210',
      password: 'password123',
      options: expect.objectContaining({
        captchaToken: 'valid-turnstile-test-token',
        data: expect.objectContaining({
          full_name: 'Test Student',
          role: 'student',
        }),
      }),
    });
  });

  it('AUTO-WEB-02: signUp functions safely when captchaToken is omitted', async () => {
    (supabase.auth.signUp as any).mockResolvedValueOnce({
      data: { user: { id: 'test-user-id', phone: '+919876543210' } },
      error: null,
    });

    const result = await signUp({
      phone: '+919876543210',
      password: 'password123',
      name: 'Test Student',
    });

    expect(result.success).toBe(true);
    expect(supabase.auth.signUp).toHaveBeenCalledWith({
      phone: '+919876543210',
      password: 'password123',
      options: expect.objectContaining({
        data: expect.objectContaining({
          full_name: 'Test Student',
        }),
      }),
    });
    const callArgs = (supabase.auth.signUp as any).mock.calls[0][0];
    expect(callArgs.options.captchaToken).toBeUndefined();
  });

  it('AUTO-WEB-03: resendOtp passes captchaToken in options.captchaToken', async () => {
    (supabase.auth.signInWithOtp as any).mockResolvedValueOnce({
      data: {},
      error: null,
    });

    const result = await resendOtp('+919876543210', 'fresh-resend-turnstile-token');

    expect(result.success).toBe(true);
    expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({
      phone: '+919876543210',
      options: {
        shouldCreateUser: false,
        captchaToken: 'fresh-resend-turnstile-token',
      },
    });
  });

  it('AUTO-WEB-04: signIn passes captchaToken in options.captchaToken', async () => {
    (supabase.auth.signInWithPassword as any).mockResolvedValueOnce({
      data: {
        user: {
          id: 'test-user-id',
          phone: '+919876543210',
          created_at: '2026-10-23T00:00:00Z',
        },
      },
      error: null,
    });

    const result = await signIn({
      phone: '+919876543210',
      password: 'password123',
      captchaToken: 'login-turnstile-token',
    });

    expect(result.success).toBe(true);
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      phone: '+919876543210',
      password: 'password123',
      options: {
        captchaToken: 'login-turnstile-token',
      },
    });
  });

  it('AUTO-WEB-05: verifyOtp does not evaluate or send captchaToken', async () => {
    (supabase.auth.verifyOtp as any).mockResolvedValueOnce({
      data: {
        user: {
          id: 'test-user-id',
          phone: '+919876543210',
          created_at: '2026-10-23T00:00:00Z',
        },
      },
      error: null,
    });

    const result = await verifyOtp({
      phone: '+919876543210',
      token: '123456',
    });

    expect(result.success).toBe(true);
    expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({
      phone: '+919876543210',
      token: '123456',
      type: 'sms',
    });
  });

  it('AUTO-WEB-06: handles GoTrue captcha_failed 400 error gracefully', async () => {
    const captchaError = new AuthApiError('Captcha check failed', 400, 'captcha_failed');
    (supabase.auth.signUp as any).mockResolvedValueOnce({
      data: { user: null },
      error: captchaError,
    });

    const result = await signUp({
      phone: '+919876543210',
      password: 'password123',
      name: 'Test Student',
      captchaToken: 'expired-or-invalid-turnstile-token',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Captcha check failed');
    expect(result.error).not.toContain('expired-or-invalid-turnstile-token');
  });

  it('AUTO-WEB-07: does not classify unrelated HTTP 400 errors as CAPTCHA failures', async () => {
    const unrelatedError = new AuthApiError('User already registered', 400, 'user_already_exists');
    (supabase.auth.signUp as any).mockResolvedValueOnce({
      data: { user: null },
      error: unrelatedError,
    });

    const result = await signUp({
      phone: '+919876543210',
      password: 'password123',
      name: 'Test Student',
      captchaToken: 'valid-turnstile-token',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('User already registered');
    expect(result.error).not.toBe('Captcha check failed');
  });

  it('AUTO-WEB-08: handles generic unexpected authentication errors cleanly', async () => {
    (supabase.auth.signUp as any).mockResolvedValueOnce({
      data: { user: null },
      error: { status: 500 },
    });

    const result = await signUp({
      phone: '+919876543210',
      password: 'password123',
      name: 'Test Student',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('An unexpected authentication error occurred.');
  });
});
