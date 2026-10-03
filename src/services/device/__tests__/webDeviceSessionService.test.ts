import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getOrCreateWebClientId,
  registerActiveWebSession,
  validateActiveWebSession,
  deactivateActiveWebSession,
  subscribeToWebSessionChanges,
  WEB_CLIENT_ID_STORAGE_KEY,
} from '../webDeviceSessionService';
import { supabase } from '@/config/supabase';

// Mock localStorage for node environment in vitest
const mockStorage: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, value: string) => {
    mockStorage[key] = value;
  },
  removeItem: (key: string) => {
    delete mockStorage[key];
  },
  clear: () => {
    for (const k in mockStorage) {
      delete mockStorage[k];
    }
  },
};

(global as any).window = {
  localStorage: localStorageMock,
};
(global as any).localStorage = localStorageMock;

vi.mock('@/config/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    auth: {
      getSession: vi.fn(),
    },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

describe('webDeviceSessionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  describe('getOrCreateWebClientId', () => {
    it('generates and stores a new UUID in localStorage if none exists', () => {
      const id = getOrCreateWebClientId();
      expect(id).toBeDefined();
      expect(id.length).toBeGreaterThanOrEqual(8);
      expect(localStorageMock.getItem(WEB_CLIENT_ID_STORAGE_KEY)).toBe(id);
    });

    it('returns the same existing client ID across multiple calls (multi-tab support)', () => {
      const id1 = getOrCreateWebClientId();
      const id2 = getOrCreateWebClientId();
      expect(id1).toBe(id2);
    });

    it('reuses client ID stored in localStorage', () => {
      localStorageMock.setItem(WEB_CLIENT_ID_STORAGE_KEY, 'custom-stored-client-uuid-1234');
      const id = getOrCreateWebClientId();
      expect(id).toBe('custom-stored-client-uuid-1234');
    });
  });

  describe('registerActiveWebSession', () => {
    it('calls register_active_device RPC with platform = web and client ID', async () => {
      localStorageMock.setItem(WEB_CLIENT_ID_STORAGE_KEY, 'test-web-client-1234');
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: { success: true, installedDeviceId: 'uuid-1', sessionSlot: 'web' },
        error: null,
      } as any);

      const result = await registerActiveWebSession();

      expect(result).toEqual({ success: true });
      expect(supabase.rpc).toHaveBeenCalledWith('register_active_device', {
        p_installation_id: 'test-web-client-1234',
        p_platform: 'web',
        p_device_name: expect.any(String),
        p_app_version: 'web-1.0.0',
        p_fcm_token: null,
      });
    });

    it('returns error when RPC fails', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: null,
        error: { message: 'Database error' },
      } as any);

      const result = await registerActiveWebSession();
      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
    });
  });

  describe('validateActiveWebSession', () => {
    it('returns unauthenticated when there is no active local Supabase session', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
        data: { session: null },
        error: null,
      } as any);

      const result = await validateActiveWebSession();
      expect(result).toEqual({ status: 'unauthenticated' });
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it('returns active when validate_active_device RPC returns active: true', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
        data: { session: { access_token: 'valid-jwt' } },
        error: null,
      } as any);
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: { status: 'active', active: true },
        error: null,
      } as any);

      const result = await validateActiveWebSession();
      expect(result).toEqual({ status: 'active' });
    });

    it('returns inactive with revokedReason when device was replaced by another browser', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
        data: { session: { access_token: 'valid-jwt' } },
        error: null,
      } as any);
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: { status: 'inactive', active: false, revoked_reason: 'replaced_by_new_device' },
        error: null,
      } as any);

      const result = await validateActiveWebSession();
      expect(result).toEqual({
        status: 'inactive',
        revokedReason: 'replaced_by_new_device',
      });
    });

    it('returns unauthenticated when RPC returns status: unauthenticated (e.g. expired JWT)', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
        data: { session: { access_token: 'expired-jwt' } },
        error: null,
      } as any);
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: { status: 'unauthenticated', active: false },
        error: null,
      } as any);

      const result = await validateActiveWebSession();
      expect(result).toEqual({ status: 'unauthenticated' });
    });

    it('returns error on transient network failure without logging out', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
        data: { session: { access_token: 'valid-jwt' } },
        error: null,
      } as any);
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: null,
        error: { message: 'Network request failed' },
      } as any);

      const result = await validateActiveWebSession();
      expect(result).toEqual({ status: 'error', error: 'Network request failed' });
    });

    it('self-heals and returns active when DB returns not_found', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
        data: { session: { access_token: 'valid-jwt' } },
        error: null,
      } as any);
      // First call (validate): returns not_found
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: { status: 'not_found', active: false },
        error: null,
      } as any);
      // Second call (register): succeeds
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: { success: true },
        error: null,
      } as any);

      const result = await validateActiveWebSession();
      expect(result).toEqual({ status: 'active' });
    });
  });

  describe('deactivateActiveWebSession', () => {
    it('calls deactivate_active_device RPC with user_logout reason', async () => {
      localStorageMock.setItem(WEB_CLIENT_ID_STORAGE_KEY, 'test-web-client-1234');
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: { success: true },
        error: null,
      } as any);

      const result = await deactivateActiveWebSession();
      expect(result).toEqual({ success: true });
      expect(supabase.rpc).toHaveBeenCalledWith('deactivate_active_device', {
        p_installation_id: 'test-web-client-1234',
        p_reason: 'user_logout',
      });
    });
  });

  describe('subscribeToWebSessionChanges', () => {
    it('sets up Realtime channel and triggers onReplaced when THIS browser is replaced', () => {
      let eventCallback: any;
      const mockChannel: any = {};
      mockChannel.on = vi.fn((event, config, cb) => {
        eventCallback = cb;
        return mockChannel;
      });
      mockChannel.subscribe = vi.fn(() => mockChannel);

      vi.mocked(supabase.channel).mockReturnValue(mockChannel);

      const onReplaced = vi.fn();
      const sub = subscribeToWebSessionChanges('user-1', 'client-web-1', onReplaced);

      expect(supabase.channel).toHaveBeenCalledWith('web_device_session:user-1:client-web-1');

      // Trigger event for THIS client
      eventCallback({
        new: {
          device_installation_id: 'client-web-1',
          is_active: false,
          revoked_reason: 'replaced_by_new_device',
          session_slot: 'web',
        },
      });

      expect(onReplaced).toHaveBeenCalledWith('replaced_by_new_device');

      // Event for DIFFERENT client (e.g. mobile device) -> ignored
      onReplaced.mockClear();
      eventCallback({
        new: {
          device_installation_id: 'client-mobile-phone-1',
          is_active: false,
          revoked_reason: 'replaced_by_new_device',
          session_slot: 'mobile',
        },
      });
      expect(onReplaced).not.toHaveBeenCalled();

      sub.unsubscribe();
      expect(supabase.removeChannel).toHaveBeenCalledWith(mockChannel);
    });
  });
});
