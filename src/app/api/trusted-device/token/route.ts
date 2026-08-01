/**
 * Trusted Device Token Cookie API
 *
 * Client-side code CANNOT set an HttpOnly cookie directly — it must be set
 * by the server. This route handler is the ONLY way the browser persists
 * the plaintext device token (it lives in an HttpOnly, Secure, SameSite=Lax
 * cookie; only its SHA-256 hash is stored in the database).
 *
 *   GET    → returns { token } from the td_device cookie (null when absent)
 *   POST   → body { token } — sets the td_device cookie
 *   DELETE → clears the td_device cookie
 *
 * Note: logout deliberately does NOT clear this cookie. The device token is
 * a browser credential that persists across sessions (per Phase 7D spec —
 * logout only removes the Supabase session).
 *
 * @module app/api/trusted-device/token
 */

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const COOKIE_NAME = 'td_device';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/** Shared cookie options — HttpOnly + Secure + SameSite=Lax per spec. */
function cookieOptions() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  };
}

/** GET — read the stored device token (null when absent). */
export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value ?? null;
  return NextResponse.json({ token });
}

/** POST — persist the device token in the HttpOnly cookie. */
export async function POST(request: Request) {
  let body: { token?: unknown };
  try {
    body = (await request.json()) as { token?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) {
    return NextResponse.json({ error: 'Device token is required.' }, { status: 400 });
  }

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, cookieOptions());

  return NextResponse.json({ ok: true });
}

/** DELETE — clear the stored device token. */
export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  return NextResponse.json({ ok: true });
}
