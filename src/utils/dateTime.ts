/**
 * Date and Time Timezone Conversion Utilities
 *
 * Converts between HTML5 `<input type="datetime-local">` timezone-less local strings
 * ("YYYY-MM-DDTHH:mm") and ISO-8601 UTC strings ("YYYY-MM-DDTHH:mm:ss.sssZ").
 *
 * Guarantees:
 * - Uses the client browser runtime's local timezone (never hardcodes offsets).
 * - Avoids manual string concatenation (no manual appending of 'Z').
 * - Preserves round-trip fidelity between database UTC and local UI inputs.
 *
 * @module utils/dateTime
 */

/**
 * Converts an HTML5 datetime-local string (e.g. "2026-08-21T23:06")
 * or any local date string into a UTC ISO-8601 string (e.g. "2026-08-21T17:36:00.000Z").
 *
 * @param localDateTime - Local datetime string, or null/undefined
 * @returns UTC ISO-8601 string or null if empty/invalid
 */
export function toUtcIsoString(localDateTime: string | null | undefined): string | null {
  if (!localDateTime || typeof localDateTime !== 'string') return null;
  const trimmed = localDateTime.trim();
  if (!trimmed) return null;

  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;

  return d.toISOString();
}

/**
 * Converts a UTC ISO-8601 timestamp (e.g. "2026-08-21T17:36:00.000Z")
 * into a local "YYYY-MM-DDTHH:mm" format suitable for `<input type="datetime-local">`.
 *
 * @param iso - UTC ISO string or timestamp
 * @returns "YYYY-MM-DDTHH:mm" in the user's local timezone, or empty string if empty/invalid
 */
export function toLocalDatetime(iso: string | null | undefined): string {
  if (!iso || typeof iso !== 'string') return '';
  const trimmed = iso.trim();
  if (!trimmed) return '';

  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return '';

  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
