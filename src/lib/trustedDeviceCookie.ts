/**
 * Trusted Device Cookie Helper (client)
 *
 * Thin client wrapper around `/api/trusted-device/token`. The plaintext
 * device token lives in an HttpOnly cookie — client JS cannot read or write
 * it directly, so all access goes through the API route.
 *
 * @module lib/trustedDeviceCookie
 */

const TOKEN_ENDPOINT = '/api/trusted-device/token';

/** Read the stored device token (null when absent / on failure). */
export async function getStoredDeviceToken(): Promise<string | null> {
  try {
    const res = await fetch(TOKEN_ENDPOINT, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as { token?: string | null };
    return data.token ?? null;
  } catch {
    return null;
  }
}

/** Persist the device token in the HttpOnly cookie. */
export async function storeDeviceToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Clear the stored device token (only used for explicit device reset). */
export async function clearStoredDeviceToken(): Promise<boolean> {
  try {
    const res = await fetch(TOKEN_ENDPOINT, { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}
