/**
 * Web Device Session Service (Two-Slot Model - Slot B: Web)
 *
 * Manages the single-active website browser session for student accounts.
 *
 * Key guarantees:
 * 1. Exactly ONE active web browser per student account.
 * 2. Shared localStorage across tabs in the same browser -> all tabs share the same webClientId (no self-revocation).
 * 3. Logging in on a second browser (or incognito) revokes the previous browser session with replaced_by_new_device.
 * 4. Web session registration/revocation NEVER affects the mobile slot (Slot A).
 *
 * @module webDeviceSessionService
 */

import { supabase } from '@/config/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export const WEB_CLIENT_ID_STORAGE_KEY = 'mocktest_web_client_id';
const TAG = '[WebDeviceSession]';

export type WebValidationResult =
  | { status: 'active' }
  | { status: 'inactive'; revokedReason?: string }
  | { status: 'unauthenticated' }
  | { status: 'error'; error: string };

/**
 * Derives a human-readable browser device name from userAgent.
 */
export function deriveBrowserDeviceName(): string {
  if (typeof navigator === 'undefined') return 'Web Browser';
  const ua = navigator.userAgent;
  const os = /Windows/i.test(ua)
    ? 'Windows'
    : /Mac OS X/i.test(ua)
      ? 'macOS'
      : /Android/i.test(ua)
        ? 'Android Browser'
        : /iPhone|iPad/i.test(ua)
          ? 'iOS Browser'
          : /Linux/i.test(ua)
            ? 'Linux'
            : 'Web';

  const browser = /Edg\//i.test(ua)
    ? 'Edge'
    : /Chrome\//i.test(ua)
      ? 'Chrome'
      : /Firefox\//i.test(ua)
        ? 'Firefox'
        : /Safari\//i.test(ua)
          ? 'Safari'
          : 'Browser';

  return browser + ' on ' + os;
}

/**
 * Retrieves the persistent browser client UUID from localStorage,
 * or generates and stores a new one.
 */
export function getOrCreateWebClientId(): string {
  if (typeof window === 'undefined' || !window.localStorage) {
    return 'web-client-server-side';
  }

  try {
    const existing = window.localStorage.getItem(WEB_CLIENT_ID_STORAGE_KEY);
    if (existing && existing.trim().length >= 8) {
      return existing.trim();
    }

    const newId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : 'web-' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);

    window.localStorage.setItem(WEB_CLIENT_ID_STORAGE_KEY, newId);
    return newId;
  } catch (err) {
    console.warn(TAG + ' Error accessing localStorage for webClientId:', err);
    return 'web-fallback-' + Date.now().toString(36);
  }
}

/**
 * Registers this browser as the student's active web session (Slot B).
 */
export async function registerActiveWebSession(): Promise<{ success: boolean; error?: string }> {
  try {
    const webClientId = getOrCreateWebClientId();
    const deviceName = deriveBrowserDeviceName();

    console.log(TAG + ' Registering active web session:', { webClientId, deviceName });

    if (typeof supabase?.rpc !== 'function') return { success: true };
    const { data, error } = await supabase.rpc('register_active_device', {
      p_installation_id: webClientId,
      p_platform: 'web',
      p_device_name: deviceName,
      p_app_version: 'web-1.0.0',
      p_fcm_token: null,
    });

    if (error) {
      console.error(TAG + ' register_active_device failed:', error.message);
      return { success: false, error: error.message };
    }

    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    if (parsed && parsed.success === false) {
      console.error(TAG + ' register_active_device returned error:', parsed.error);
      return { success: false, error: parsed.error };
    }

    console.log(TAG + ' Web session successfully registered:', parsed);
    return { success: true };
  } catch (err) {
    console.error(TAG + ' registerActiveWebSession threw:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Validates whether THIS browser is currently the active web session.
 */
export async function validateActiveWebSession(): Promise<WebValidationResult> {
  try {
    const webClientId = getOrCreateWebClientId();

    // Check if a local authenticated session exists
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session?.access_token) {
      console.log(TAG + ' validateActiveWebSession: No active session -> unauthenticated');
      return { status: 'unauthenticated' };
    }

    if (typeof supabase?.rpc !== 'function') return { status: 'active' };
    const { data, error } = await supabase.rpc('validate_active_device', {
      p_installation_id: webClientId,
    });

    if (error) {
      const msg = error.message || '';
      const status = error.status;
      if (status === 401 || msg.includes('JWT') || msg.includes('unauthenticated')) {
        return { status: 'unauthenticated' };
      }
      console.error(TAG + ' validate_active_device error:', msg);
      return { status: 'error', error: msg };
    }

    const parsed = typeof data === 'string' ? JSON.parse(data) : data;

    if (!parsed) {
      return { status: 'error', error: 'Empty response from validate_active_device' };
    }

    if (parsed.status === 'unauthenticated') {
      return { status: 'unauthenticated' };
    }

    if (parsed.status === 'not_found') {
      console.warn(TAG + ' Web installation not found in DB. Attempting self-healing registration.');
      const reg = await registerActiveWebSession();
      if (reg.success) {
        return { status: 'active' };
      }
      return { status: 'error', error: reg.error || 'Self-healing registration failed' };
    }

    if (parsed.active === true || parsed.status === 'active') {
      return { status: 'active' };
    }

    return {
      status: 'inactive',
      revokedReason: parsed.revoked_reason || 'replaced_by_new_device',
    };
  } catch (err) {
    console.error(TAG + ' validateActiveWebSession threw:', err);
    return { status: 'error', error: err instanceof Error ? err.message : 'Unknown validation error' };
  }
}

/**
 * Deactivates this browser's active web session on explicit logout.
 */
export async function deactivateActiveWebSession(): Promise<{ success: boolean; error?: string }> {
  try {
    const webClientId = getOrCreateWebClientId();
    console.log(TAG + ' Deactivating active web session:', webClientId);

    if (typeof supabase?.rpc !== 'function') return;
    const { error } = await supabase.rpc('deactivate_active_device', {
      p_installation_id: webClientId,
      p_reason: 'user_logout',
    });

    if (error) {
      console.warn(TAG + ' deactivate_active_device failed:', error.message);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.warn(TAG + ' deactivateActiveWebSession error:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Subscribes to Realtime device-session events for the current student.
 * Triggers onReplaced when THIS browser's row is revoked by another browser login.
 */
export function subscribeToWebSessionChanges(
  userId: string,
  webClientId: string,
  onReplaced: (reason: string) => void,
): { unsubscribe: () => void } {
  console.log(TAG + ' Setting up Realtime web session listener for user ' + userId + ', client ' + webClientId);

  let channel: RealtimeChannel | null = supabase
    .channel('web_device_session:' + userId + ':' + webClientId)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'user_device_sessions',
        filter: 'profile_id=eq.' + userId,
      },
      (payload) => {
        const row = payload.new as {
          device_installation_id?: string;
          is_active?: boolean;
          revoked_reason?: string;
          session_slot?: string;
        };

        if (!row) return;

        // Verify this event is for THIS browser client
        if (row.device_installation_id === webClientId) {
          if (row.is_active === false && row.revoked_reason === 'replaced_by_new_device') {
            console.log(TAG + ' [DEVICE_AUTH] Web session replaced by another browser login. Triggering force logout.');
            onReplaced(row.revoked_reason);
          }
        }
      }
    )
    .subscribe((status) => {
      console.log(TAG + ' Realtime subscription status:', status);
    });

  return {
    unsubscribe: () => {
      if (channel) {
        console.log(TAG + ' Removing Realtime web session channel');
        supabase.removeChannel(channel);
        channel = null;
      }
    },
  };
}
