/**
 * Analytics Utilities
 *
 * Helper functions for computing derived analytics metrics from raw data.
 * These utilities avoid duplicating business logic already inside the
 * evaluation engine or result service.
 *
 * @module utils/analytics
 */

import { computeAccuracy as computeResultAccuracy } from './mockResults';

// ─── Re-export for convenience ─────────────────────────────────────────────

export { computeResultAccuracy };

// ═══════════════════════════════════════════════════════════════════════════
//  Accuracy & Percentage
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute accuracy as a percentage.
 * Delegates to mockResults utility for consistency.
 */
export function computeAccuracy(correct: number, wrong: number): number | null {
  return computeResultAccuracy(correct, wrong);
}

/**
 * Compute a percentage from a value and max.
 * Returns null when max is 0 to avoid division by zero.
 */
export function computePercentage(value: number, max: number): number | null {
  if (max <= 0) return null;
  return (value / max) * 100;
}

/**
 * Compute average from an array of numbers.
 * Returns null for empty arrays.
 */
export function computeAverage(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Grade
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Letter grade for a percentage score.
 */
export type LetterGrade = 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D' | 'F';

/**
 * Compute a letter grade from a percentage score.
 *
 * Scale:
 * - A+: 90–100
 * - A:  80–89
 * - B+: 70–79
 * - B:  60–69
 * - C:  50–59
 * - D:  40–49
 * - F:  0–39
 */
export function computeGrade(percentage: number): LetterGrade {
  if (percentage >= 90) return 'A+';
  if (percentage >= 80) return 'A';
  if (percentage >= 70) return 'B+';
  if (percentage >= 60) return 'B';
  if (percentage >= 50) return 'C';
  if (percentage >= 40) return 'D';
  return 'F';
}

// ═══════════════════════════════════════════════════════════════════════════
//  Distribution
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute the distribution of values into named buckets.
 *
 * @param items - Array of items with a bucket key.
 * @param getBucket - Function to extract the bucket key from an item.
 * @returns Map of bucket key → count.
 */
export function computeDistribution<T>(
  items: T[],
  getBucket: (item: T) => string,
): Map<string, number> {
  const distribution = new Map<string, number>();
  for (const item of items) {
    const bucket = getBucket(item);
    distribution.set(bucket, (distribution.get(bucket) ?? 0) + 1);
  }
  return distribution;
}

/**
 * Compute percentage distribution for a set of counts.
 *
 * @param counts - Map of bucket key → count.
 * @returns Map of bucket key → percentage (0–100).
 */
export function computePercentageDistribution(
  counts: Map<string, number>,
): Map<string, number> {
  const total = Array.from(counts.values()).reduce((sum, c) => sum + c, 0);
  if (total <= 0) return new Map();

  const result = new Map<string, number>();
  for (const [key, count] of counts) {
    result.set(key, (count / total) * 100);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Ranking
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute rank from a sorted array of scores.
 *
 * @param scores - Array of score objects with a value property, sorted descending.
 * @param targetValue - The value to find the rank for.
 * @returns The rank (1-indexed). Returns null if the array is empty.
 */
export function computeRank(
  scores: { value: number }[],
  targetValue: number,
): number | null {
  if (scores.length === 0) return null;

  // Find the first occurrence (or use indexOf approach)
  let rank = 1;
  for (let i = 0; i < scores.length; i++) {
    if (scores[i].value > targetValue) {
      rank++;
    } else {
      break;
    }
  }
  return rank;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Trend
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute the trend direction from a series of values.
 *
 * - 'improving': Last value is significantly higher than the first.
 * - 'declining': Last value is significantly lower than the first.
 * - 'stable': No significant change.
 * - 'insufficient_data': Fewer than 2 data points.
 */
export type TrendDirection = 'improving' | 'declining' | 'stable' | 'insufficient_data';

/**
 * Determine the direction of a performance trend.
 *
 * @param values - Array of values in chronological order.
 * @param threshold - Minimum percentage change required to register as a trend (default 5%).
 */
export function computeTrendDirection(
  values: number[],
  threshold: number = 5,
): TrendDirection {
  if (values.length < 2) return 'insufficient_data';

  const first = values[0];
  const last = values[values.length - 1];

  if (first === 0 && last > 0) return 'improving';
  if (first === 0 && last === 0) return 'stable';

  const change = ((last - first) / Math.abs(first || 1)) * 100;

  if (change > threshold) return 'improving';
  if (change < -threshold) return 'declining';
  return 'stable';
}

// ═══════════════════════════════════════════════════════════════════════════
//  Rounding
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Round a number to a specified number of decimal places.
 */
export function roundTo(value: number, decimals: number = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Clamp a number between min and max.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Time Formatting
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Format seconds into a human-readable duration string.
 */
export function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 0) return '0s';

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(' ');
}
