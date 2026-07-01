/**
 * Mock Result Statistics Utilities
 *
 * Helper functions for computing derived statistics from MockResult fields.
 * These utilities avoid duplicating logic already inside the evaluation engine
 * (which stores the raw fields: totalScore, maxScore, percentage, correctCount,
 * wrongCount, skippedCount, totalTimeSeconds, avgTimePerQuestion).
 *
 * The functions in this file compute only what is NOT already stored on the
 * MockResult interface — namely accuracy and other display-time derivations.
 *
 * @module utils/mockResults
 */

/**
 * Compute accuracy percentage.
 *
 * Accuracy = correct / (correct + wrong) * 100
 *
 * Returns null when there are no answered questions (i.e., total isn't > 0)
 * to avoid division by zero.
 *
 * @param correct - Number of correct answers.
 * @param wrong   - Number of incorrect answers.
 *
 * @example
 * computeAccuracy(40, 10) // 80
 * computeAccuracy(0, 0)   // null
 */
export function computeAccuracy(correct: number, wrong: number): number | null {
  const total = correct + wrong;
  if (total <= 0) return null;
  return (correct / total) * 100;
}

/**
 * Format a duration in seconds to a human-readable string.
 *
 * @example
 * formatDuration(3661) // "1h 1m 1s"
 * formatDuration(150)  // "2m 30s"
 * formatDuration(45)   // "45s"
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

/**
 * Round a number to a specified number of decimal places.
 *
 * @param value - The number to round.
 * @param decimals - Number of decimal places (default 2).
 */
export function roundTo(value: number, decimals: number = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Get a color class for a score/percentage value.
 *
 * @param percentage - The percentage value (0–100).
 * @returns Tailwind CSS text color class.
 */
export function getScoreColorClass(percentage: number): string {
  if (percentage >= 80) return 'text-green-400';
  if (percentage >= 60) return 'text-blue-400';
  if (percentage >= 40) return 'text-amber-400';
  return 'text-red-400';
}
