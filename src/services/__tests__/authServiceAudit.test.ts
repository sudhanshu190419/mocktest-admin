import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFrom, mockAuditLog, mockSignInWithPassword, mockVerifyOtp, mockSignOut, mockUpdateUser, mockGetUser } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockAuditLog: vi.fn().mockResolvedValue({ success: true, logId: 'log-1' }),
  mockSignInWithPassword: vi.fn(),
  mockVerifyOtp: vi.fn(),
  mockSignOut: vi.fn(),
  mockUpdateUser: vi.fn(),
  mockGetUser: vi.fn(),
}));

vi.mock('@/config/supabase', () => ({
  supabase: {
    from: mockFrom,
    auth: {
      signInWithPassword: mockSignInWithPassword,
      verifyOtp: mockVerifyOtp,
      signOut: mockSignOut,
      updateUser: mockUpdateUser,
      getUser: mockGetUser,
    },
  },
}));

vi.mock('../../config/supabase', () => ({
  supabase: {
    from: mockFrom,
    auth: {
      signInWithPassword: mockSignInWithPassword,
      verifyOtp: mockVerifyOtp,
      signOut: mockSignOut,
      updateUser: mockUpdateUser,
      getUser: mockGetUser,
    },
  },
}));

vi.mock('@/services/audit/auditService', () => ({
  auditService: {
    log: mockAuditLog,
    logLogin: (payload: any) => mockAuditLog({ ...payload, action: 'login' }),
    logLogout: (payload: any) => mockAuditLog({ ...payload, action: 'logout' }),
    logCreate: (payload: any) => mockAuditLog({ ...payload, action: 'create' }),
    logUpdate: (payload: any) => mockAuditLog({ ...payload, action: 'update' }),
  },
}));

vi.mock('../audit/auditService', () => ({
  auditService: {
    log: mockAuditLog,
    logLogin: (payload: any) => mockAuditLog({ ...payload, action: 'login' }),
    logLogout: (payload: any) => mockAuditLog({ ...payload, action: 'logout' }),
    logCreate: (payload: any) => mockAuditLog({ ...payload, action: 'create' }),
    logUpdate: (payload: any) => mockAuditLog({ ...payload, action: 'update' }),
  },
}));

import { signIn, verifyOtp, signOut, updatePassword } from '../authService';

function mockChain(data: any = null, error: any = null) {
  const result = { data, error };
  const c: Record<string, any> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue(result);
  c.maybeSingle = vi.fn().mockResolvedValue(result);
  c.then = (onFulfilled: any, onRejected?: any) => {
    if (error && onRejected) return onRejected(error);
    return onFulfilled(result);
  };
  return c;
}

const USER_ID = '11111111-1111-4111-8111-111111111111';

describe('authService - Audit Logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('signIn logs login audit event on success', async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: {
        user: { id: USER_ID, phone: '+919876543210', user_metadata: { role: 'teacher' } },
        session: { access_token: 'token-1' },
      },
      error: null,
    });

    mockFrom.mockReturnValue(
      mockChain({
        profile_id: USER_ID,
        phone: '+919876543210',
        name: 'Teacher Name',
        role: 'teacher',
        status: 'approved',
      })
    );

    const result = await signIn({
      phone: '+919876543210',
      password: 'password123',
    });

    expect(result.success).toBe(true);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'login',
        resourceType: 'profiles',
        resourceId: USER_ID,
        metadata: expect.objectContaining({
          method: 'password',
          phone: '+919876543210',
        }),
      })
    );
  });

  it('verifyOtp logs login audit event on success', async () => {
    mockVerifyOtp.mockResolvedValue({
      data: {
        user: { id: USER_ID, phone: '+919876543210', user_metadata: { role: 'teacher' } },
        session: { access_token: 'token-1' },
      },
      error: null,
    });

    mockFrom.mockReturnValue(
      mockChain({
        profile_id: USER_ID,
        phone: '+919876543210',
        name: 'Teacher Name',
        role: 'teacher',
        status: 'approved',
      })
    );

    const result = await verifyOtp({
      phone: '+919876543210',
      token: '123456',
    });

    expect(result.success).toBe(true);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'login',
        resourceType: 'profiles',
        resourceId: USER_ID,
        metadata: expect.objectContaining({
          method: 'otp',
          phone: '+919876543210',
        }),
      })
    );
  });

  it('signOut logs logout audit event before clearing session', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: USER_ID } },
      error: null,
    });
    mockSignOut.mockResolvedValue({ error: null });

    const result = await signOut();

    expect(result.success).toBe(true);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'logout',
        resourceType: 'profiles',
        resourceId: USER_ID,
      })
    );
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('updatePassword logs reset_password audit event on success', async () => {
    mockUpdateUser.mockResolvedValue({
      data: { user: { id: USER_ID } },
      error: null,
    });
    mockGetUser.mockResolvedValue({
      data: { user: { id: USER_ID } },
      error: null,
    });

    const result = await updatePassword('newSecretPassword123');

    expect(result.success).toBe(true);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'reset_password',
        resourceType: 'profiles',
        resourceId: USER_ID,
      })
    );
  });
});
