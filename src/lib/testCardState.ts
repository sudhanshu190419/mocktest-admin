import type { StudentMockTestCardItem } from '@/services/student/studentTestWebService';

/**
 * PRD §7.3 — Test-card state system.
 * State is communicated by a left border strip + label + exactly ONE primary
 * action. Derivation is pure so overview, tests hub and runner share one truth.
 */

export type TestCardState =
  | 'upcoming'
  | 'available'
  | 'in_progress'
  | 'submitted'
  | 'evaluated'
  | 'evaluated_retake'
  | 'limit_reached'
  | 'expired';

export interface TestCardAction {
  label: string;
  href: string;
}

export interface TestCardPresentation {
  state: TestCardState;
  /** Calm coach-voice line under the title (§11 glossary). */
  label: string;
  /** Exactly one primary action per state (may be null for upcoming). */
  action: TestCardAction | null;
  /** Rare secondary, e.g. Retake next to View Result (§7.3). */
  tertiary: TestCardAction | null;
}

function formatDay(iso: string | null | undefined, now: Date): string {
  if (!iso) return 'soon';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'soon';
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  if (days > 1 && days <= 6) return `on ${d.toLocaleDateString([], { weekday: 'long' })} at ${time}`;
  return `on ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}

function resultHref(test: StudentMockTestCardItem): string {
  const attemptId = test.latestResult?.attemptId || test.attemptSummary?.latestAttemptId;
  return attemptId
    ? `/student/tests/${test.testId}/results/${attemptId}`
    : `/student/tests/${test.testId}`;
}

export function getTestCardPresentation(
  test: StudentMockTestCardItem,
  now: Date = new Date(),
): TestCardPresentation {
  const { attemptSummary, availabilityStatus, latestResult } = test;

  // ── In progress: highest priority, overrides availability ────────────────
  if (attemptSummary?.attemptState === 'in_progress') {
    return {
      state: 'in_progress',
      label: 'In progress — pick up where you left off',
      action: { label: 'Resume', href: `/student/tests/${test.testId}` },
      tertiary: null,
    };
  }

  // ── Availability-gated states ─────────────────────────────────────────────
  if (availabilityStatus === 'upcoming') {
    return {
      state: 'upcoming',
      label: `Opens ${formatDay(test.availableFrom, now)}`,
      action: null,
      tertiary: null,
    };
  }

  if (availabilityStatus === 'expired') {
    return {
      state: 'expired',
      label: `Closed ${formatDay(test.availableUntil, now)}`,
      action: latestResult ? { label: 'View Result', href: resultHref(test) } : null,
      tertiary: null,
    };
  }

  // ── Available now ─────────────────────────────────────────────────────────
  if (attemptSummary?.attemptState === 'submitted') {
    const scoreLabel = latestResult
      ? `Score ${latestResult.totalScore}/${latestResult.maxScore} · ${latestResult.percentage}%`
      : 'Awaiting evaluation';
    const evaluated = Boolean(latestResult);
    return {
      state: evaluated && attemptSummary.canAttempt ? 'evaluated_retake' : 'evaluated',
      label: scoreLabel,
      action: { label: 'View Result', href: resultHref(test) },
      tertiary:
        evaluated && attemptSummary.canAttempt
          ? { label: 'Retake', href: `/student/tests/${test.testId}` }
          : null,
    };
  }

  if (attemptSummary?.attemptState === 'limit_reached') {
    return {
      state: 'limit_reached',
      label: 'Attempts used',
      action: { label: 'View Result', href: resultHref(test) },
      tertiary: null,
    };
  }

  return {
    state: 'available',
    label: 'Ready when you are',
    action: { label: 'Start Test', href: `/student/tests/${test.testId}` },
    tertiary: null,
  };
}

/** True when the test should appear in "this week's tests" (due or open now). */
export function isDueThisWeek(test: StudentMockTestCardItem, now: Date = new Date()): boolean {
  const { attemptSummary, availabilityStatus } = test;
  if (attemptSummary?.attemptState === 'in_progress') return true;
  if (attemptSummary?.attemptState === 'submitted') return true;
  if (availabilityStatus === 'available') return true;
  if (availabilityStatus === 'upcoming' && test.availableFrom) {
    const from = new Date(test.availableFrom);
    if (!Number.isNaN(from.getTime())) {
      const weekAhead = new Date(now);
      weekAhead.setDate(weekAhead.getDate() + 7);
      return from <= weekAhead;
    }
  }
  return false;
}
