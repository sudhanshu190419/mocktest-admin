/**
 * Mobile-number normalization for the Bulk Timetable Import (Phase 3.5).
 *
 * The database stores teacher mobile numbers on `profiles.phone` in E.164
 * digits-only form WITHOUT the leading '+' (migrations 024/025), e.g.
 * `919876543210` — matching how Supabase Auth stores them. The bulk import
 * therefore uses the full international digit string as its canonical key.
 *
 * Country codes are NEVER silently stripped: a number typed WITH a country
 * code is matched only against the full international key. The only
 * exception is the documented India convenience below, which derives a
 * national key for +91 numbers from the STORED value — it never modifies
 * the incoming digits.
 *
 * @module utils/mobileNumber
 */

/** Strip everything except digits: `+91 98765-43210` → `919876543210`. */
export function digitsOnly(input: string): string {
  return input.replace(/\D/g, '');
}

/**
 * India convenience: a stored 12-digit `91…` number also gets a 10-digit
 * national lookup key (the final 10 digits), so an admin can type
 * `9876543210` and resolve the teacher stored as `919876543210`.
 *
 * Applied to STORED phone numbers only (never to user input), and only for
 * the exact `91` + 10-digit pattern — other countries are never affected.
 * Returns null when the pattern does not apply.
 */
export function indiaNationalKey(digits: string): string | null {
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  return null;
}

/**
 * Detect the fake placeholder phones that migrations 024/025 backfilled for
 * profiles that had no phone at signup (format `91000000` + 4 digits).
 *
 * These are NOT real teacher numbers (a genuine Indian mobile is `91` + 10
 * digits where the national part starts with 6–9, so `91000000…` can never
 * be a valid real number). The mobile importer treats them as "no usable
 * phone" so an admin can never accidentally schedule against a placeholder
 * teacher. See migrations 024/025.
 */
export function isPlaceholderMobile(digits: string): boolean {
  return /^91000000\d{4}$/.test(digits);
}
