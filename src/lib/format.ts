/**
 * Student Experience Redesign — Data formatting utilities (§9.6)
 *
 * Ensures consistent presentation across all student and marketing surfaces:
 * - Dates: "24 Sep 2026" (never raw ISO strings)
 * - DateTimes: "24 Sep 2026, 02:30 PM"
 * - Percentages: "85%" or "85.5%"
 * - Prices: "₹1,499" / "Free"
 * - Ordinals: "1st", "2nd", "3rd", "99th"
 */

export function formatDate(
  input: string | number | Date | null | undefined,
  fallback = '—'
): string {
  if (!input) return fallback;
  try {
    const date = typeof input === 'string' || typeof input === 'number' ? new Date(input) : input;
    if (isNaN(date.getTime())) return fallback;
    return new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(date);
  } catch {
    return fallback;
  }
}

export function formatDateTime(
  input: string | number | Date | null | undefined,
  fallback = '—'
): string {
  if (!input) return fallback;
  try {
    const date = typeof input === 'string' || typeof input === 'number' ? new Date(input) : input;
    if (isNaN(date.getTime())) return fallback;
    return new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  } catch {
    return fallback;
  }
}

export interface FormatPercentOptions {
  decimals?: number;
  forceZero?: boolean;
  fallback?: string;
}

export function formatPercent(
  value: number | null | undefined,
  optionsOrDecimals?: number | FormatPercentOptions,
  fallback = '0%'
): string {
  const options: FormatPercentOptions =
    typeof optionsOrDecimals === 'number'
      ? { decimals: optionsOrDecimals }
      : optionsOrDecimals || {};

  const decimals = options.decimals ?? 0;
  const forceZero = options.forceZero ?? false;
  const customFallback = options.fallback ?? fallback;

  if (value === null || value === undefined || isNaN(value)) {
    return forceZero ? `0%` : customFallback;
  }

  const clamped = Math.max(0, Math.min(100, value));
  return `${clamped.toFixed(decimals)}%`;
}

export function formatPrice(
  amount: number | null | undefined,
  currency = '₹'
): string {
  if (amount === null || amount === undefined) return 'Free';
  if (amount === 0) return 'Free';
  const formatted = new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
  }).format(amount);
  return `${currency}${formatted}`;
}

export function ordinal(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const rounded = Math.round(n);
  const rem10 = rounded % 10;
  const rem100 = rounded % 100;
  if (rem10 === 1 && rem100 !== 11) return `${rounded}st`;
  if (rem10 === 2 && rem100 !== 12) return `${rounded}nd`;
  if (rem10 === 3 && rem100 !== 13) return `${rounded}rd`;
  return `${rounded}th`;
}
