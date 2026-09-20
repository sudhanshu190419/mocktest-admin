/**
 * Unified Student Performance Rubric (PRD §7.4, §9.1)
 *
 * One single rubric across all student surfaces (Overview, Analytics, Results, Review):
 *   - < 60% : Worth practicing (Needs attention / Focus area)
 *   - 60% – 80% : Steady (Solid progress)
 *   - >= 80% : Mastered (Strong / High proficiency)
 */

export type RubricTier = 'worth_practicing' | 'steady' | 'mastered';

export interface RubricLevel {
  tier: RubricTier;
  label: string;
  shortLabel: string;
  minPercent: number;
  maxPercent: number;
  colorClass: {
    text: string;
    bg: string;
    border: string;
    bar: string;
    pill: string;
  };
}

export const RUBRIC_TIERS: Record<RubricTier, RubricLevel> = {
  worth_practicing: {
    tier: 'worth_practicing',
    label: 'Worth practicing',
    shortLabel: 'Practice',
    minPercent: 0,
    maxPercent: 59.99,
    colorClass: {
      text: 'text-amber-800',
      bg: 'bg-amber-50',
      border: 'border-amber-200',
      bar: 'bg-amber-500',
      pill: 'bg-amber-50 text-amber-800 border-amber-200',
    },
  },
  steady: {
    tier: 'steady',
    label: 'Steady',
    shortLabel: 'Steady',
    minPercent: 60,
    maxPercent: 79.99,
    colorClass: {
      text: 'text-brand-hover',
      bg: 'bg-sky-tint',
      border: 'border-line',
      bar: 'bg-brand',
      pill: 'bg-sky-tint text-brand-hover border-line',
    },
  },
  mastered: {
    tier: 'mastered',
    label: 'Mastered',
    shortLabel: 'Mastered',
    minPercent: 80,
    maxPercent: 100,
    colorClass: {
      text: 'text-mint-ink',
      bg: 'bg-mint-tint',
      border: 'border-emerald-200',
      bar: 'bg-emerald-500',
      pill: 'bg-mint-tint text-mint-ink border-emerald-200',
    },
  },
};

/**
 * Returns the rubric tier and styling for a given percentage or accuracy value.
 * Null/undefined/NaN returns null.
 */
export function getRubricLevel(scoreOrAccuracy: number | null | undefined): RubricLevel | null {
  if (scoreOrAccuracy === null || scoreOrAccuracy === undefined || Number.isNaN(scoreOrAccuracy)) {
    return null;
  }
  if (scoreOrAccuracy >= 80) return RUBRIC_TIERS.mastered;
  if (scoreOrAccuracy >= 60) return RUBRIC_TIERS.steady;
  return RUBRIC_TIERS.worth_practicing;
}

/** Check if score is in "worth practicing" range (< 60%) */
export function isWorthPracticing(scoreOrAccuracy: number | null | undefined): boolean {
  if (scoreOrAccuracy === null || scoreOrAccuracy === undefined || Number.isNaN(scoreOrAccuracy)) return false;
  return scoreOrAccuracy < 60;
}

/** Check if score is in "mastered" range (>= 80%) */
export function isMastered(scoreOrAccuracy: number | null | undefined): boolean {
  if (scoreOrAccuracy === null || scoreOrAccuracy === undefined || Number.isNaN(scoreOrAccuracy)) return false;
  return scoreOrAccuracy >= 80;
}
