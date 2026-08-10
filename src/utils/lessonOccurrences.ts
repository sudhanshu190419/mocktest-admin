/**
 * Lesson Planner Date Utilities
 *
 * Phase 2C-1 — pure, deterministic calendar helpers for the Admin Lesson
 * Planner. No Supabase calls and no browser-local-timezone dependence:
 *
 * - `generateOccurrenceDates` — which calendar dates a recurring timetable
 *   slot actually occurs on (day_of_week + validity + requested window).
 * - `toOccurrenceDate` — map a live class's `scheduled_at` (UTC timestamptz)
 *   to its occurrence date in the INSTITUTE's timezone (never the browser's).
 * - `expandDateRange` — every date between two ISO dates (used to expand
 *   active teacher-leave ranges into per-date skip entries).
 *
 * All date arithmetic happens on UTC midnight boundaries via `Date.UTC`, so
 * there is no local-timezone shift, and `Date.toISOString()` is never used to
 * derive calendar dates (it is UTC, but the explicit UTC-component approach
 * is clearer and equally deterministic).
 *
 * @module utils/lessonOccurrences
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True when `value` is a well-formed, real YYYY-MM-DD date. */
function isISODate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Format a UTC Date as YYYY-MM-DD from its UTC components (no tz shift). */
function toISODateUTC(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Every calendar date from `startIso` to `endIso` inclusive.
 *
 * @param startIso - YYYY-MM-DD (inclusive).
 * @param endIso - YYYY-MM-DD (inclusive).
 * @returns Sorted YYYY-MM-DD dates, or `[]` when malformed or start > end.
 */
export function expandDateRange(startIso: string, endIso: string): string[] {
  if (!isISODate(startIso) || !isISODate(endIso)) return [];
  if (startIso > endIso) return [];

  const dates: string[] = [];
  const cursor = new Date(`${startIso}T00:00:00.000Z`);
  const endMs = Date.parse(`${endIso}T00:00:00.000Z`);
  for (; cursor.getTime() <= endMs; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(toISODateUTC(cursor));
  }
  return dates;
}

/**
 * The calendar dates on which a recurring timetable slot occurs, restricted
 * to a requested window AND the slot's validity period.
 *
 * Matches the backend materializer's rule (`extract(isodow from g) = slot
 * day_of_week` over the validity clamp) — see migration 109.
 *
 * @param dayOfWeek - PostgreSQL isodow 1..7 (1 = Monday, 7 = Sunday).
 * @param validFrom - Slot validity start (YYYY-MM-DD, inclusive).
 * @param validUntil - Slot validity end (YYYY-MM-DD, inclusive).
 * @param from - Requested window start (YYYY-MM-DD, inclusive).
 * @param to - Requested window end (YYYY-MM-DD, inclusive).
 * @returns Sorted YYYY-MM-DD dates, or `[]` when nothing matches.
 */
export function generateOccurrenceDates(
  dayOfWeek: number,
  validFrom: string,
  validUntil: string,
  from: string,
  to: string,
): string[] {
  if (dayOfWeek < 1 || dayOfWeek > 7) return [];
  if (
    !isISODate(validFrom) ||
    !isISODate(validUntil) ||
    !isISODate(from) ||
    !isISODate(to)
  ) {
    return [];
  }

  // ISO dates compare lexicographically == chronologically.
  const start = validFrom > from ? validFrom : from;
  const end = validUntil < to ? validUntil : to;
  if (start > end) return [];

  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00.000Z`);
  const endMs = Date.parse(`${end}T00:00:00.000Z`);
  for (; cursor.getTime() <= endMs; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const dow = cursor.getUTCDay(); // 0 = Sunday
    const isodow = dow === 0 ? 7 : dow;
    if (isodow === dayOfWeek) {
      dates.push(toISODateUTC(cursor));
    }
  }
  return dates;
}

/**
 * Map a live class's `scheduled_at` (UTC timestamptz, ISO 8601) to its
 * occurrence date in the institute's timezone.
 *
 * The institute timezone is authoritative — this mirrors the backend's
 * `(scheduled_at at time zone institutes.timezone)::date` (migration 113).
 * The browser's local timezone is NEVER used.
 *
 * @param scheduledAtIso - ISO 8601 timestamp (from `SlotClassStatus.scheduledAt`).
 * @param timezone - IANA timezone (e.g. "Asia/Kolkata"). Falls back to the
 *          project default when null/undefined, matching `institutes.timezone`.
 * @returns YYYY-MM-DD, or `''` for an unparseable timestamp.
 */
export function toOccurrenceDate(
  scheduledAtIso: string,
  timezone: string | null | undefined,
): string {
  const date = new Date(scheduledAtIso);
  if (Number.isNaN(date.getTime())) return '';

  // Defensive: `institutes.timezone` is an unconstrained text column, so a
  // bad IANA name must not crash the planner — `Intl.DateTimeFormat` throws a
  // RangeError for unrecognized timezones. Fall back to the project default.
  const tz = timezone || 'Asia/Kolkata';
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
  }

  const pick = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}
