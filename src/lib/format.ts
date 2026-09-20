/**
 * Display formatting utilities — the ONLY place dates/numbers/ordinals
 * are formatted for student-facing UI.
 *
 * Rules (DESIGN_SYSTEM.md):
 *  - Locale: en-IN everywhere
 *  - Zero/unknown values render as '—' in achievement contexts, never '0%'
 *  - Ordinals via ordinal() ("85th"), never hand-rolled "{n}th"
 */

const DASH = '—';

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "19 Sep 2026" */
export function formatDate(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return DASH;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "19 Sep" (no year — for compact lists) */
export function formatDateShort(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return DASH;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** "14:30" (24h, en-IN) */
export function formatTime(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return DASH;
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** "19 Sep 2026, 14:30" */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return DASH;
  return `${formatDate(d)}, ${formatTime(d)}`;
}

/** 1st / 2nd / 3rd / 4th … 85th */
export function ordinal(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return DASH;
  const v = Math.abs(Math.trunc(n));
  const rem100 = v % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${v}th`;
  switch (v % 10) {
    case 1: return `${v}st`;
    case 2: return `${v}nd`;
    case 3: return `${v}rd`;
    default: return `${v}th`;
  }
}

/**
 * Achievement-style percentage. Renders DASH for null/undefined/0
 * (a 0% average with no data is not an achievement — PRD §11).
 * Pass forceZero to deliberately show "0%" (e.g. a real scored 0).
 */
export function formatPercent(
  value: number | null | undefined,
  opts: { forceZero?: boolean; decimals?: number } = {}
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  if (value === 0 && !opts.forceZero) return DASH;
  const d = opts.decimals ?? 0;
  return `${value.toFixed(d)}%`;
}

/** "214/300" score pair with dash fallbacks. */
export function formatScore(
  score: number | null | undefined,
  total: number | null | undefined
): string {
  if (score === null || score === undefined) return DASH;
  const t = total === null || total === undefined ? DASH : String(total);
  return `${score}/${t}`;
}

/** mm:ss countdown (test runner, video timestamps). Negative → 00:00. */
export function formatCountdown(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined || Number.isNaN(totalSeconds)) return '00:00';
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** 1h 24m / 45m / 30s duration label. */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined || Number.isNaN(totalSeconds)) return DASH;
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** Indian digit grouping: 1,23,456 (en-IN). */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  return value.toLocaleString('en-IN');
}
