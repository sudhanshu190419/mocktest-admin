/**
 * Phone helpers. Auth uses E.164 WITH `+` (+91XXXXXXXXXX);
 * `profiles.phone` stores it WITHOUT the `+`. Don't mix (07-GOTCHAS.md #12).
 */

export const DEFAULT_COUNTRY_CODE = '+91';

/** E.164 shape, allowing 7–15 digits after the country code. */
export const E164_RE = /^\+[1-9]\d{6,14}$/;

/** The UI pins a +91 prefix and accepts exactly 10 digits. */
export const NATIONAL_NUMBER_RE = /^\d{10}$/;

export function toE164(nationalNumber: string): string {
  return `${DEFAULT_COUNTRY_CODE}${nationalNumber.replace(/\D/g, '')}`;
}

export function isValidNationalNumber(value: string): boolean {
  return NATIONAL_NUMBER_RE.test(value);
}

/** Strip characters that are not digits — for controlled inputs. */
export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}
