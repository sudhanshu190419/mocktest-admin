/**
 * Motion contract — "calm coach"
 *
 * Rules (PRD §8 / DESIGN_SYSTEM.md):
 *  - 150–300ms only, coach easing, purposeful (reveal, progress, guidance)
 *  - Nothing loops except the 6px live dot
 *  - Stagger 40–60ms on card grids
 *  - Respect prefers-reduced-motion via useCoachMotion()
 */
import { useReducedMotion } from 'framer-motion';
import type { Transition, Variants } from 'framer-motion';

export const DURATION = { fast: 0.15, base: 0.2, slow: 0.3 } as const;
export const duration = { fast: 150, base: 200, slow: 300, emphasis: 300 } as const;

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export const COACH_EASE = [0.16, 1, 0.3, 1] as const;

export const coachTransition: Transition = {
  duration: DURATION.base,
  ease: COACH_EASE,
};

/** Sections/cards rising in on first paint. */
export const fadeRise: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: coachTransition },
};

/** Parent container that staggers fadeRise children (40–60ms). */
export const staggerGrid: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};

/** Progress bars / fills animating to their width. */
export const progressFill: Variants = {
  hidden: { scaleX: 0 },
  visible: { scaleX: 1, transition: { duration: DURATION.slow, ease: COACH_EASE } },
};

/** Count-up helper for KPI values (300ms). Returns final value instantly
 *  under reduced motion. Uses rAF, no Framer dependency at call sites. */
export function countUp(
  target: number,
  opts: { durationMs?: number; onTick?: (v: number) => void; onDone?: () => void } = {}
): () => void {
  const { durationMs = 300, onTick, onDone } = opts;
  const start = performance.now();
  let raf = 0;

  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduced) {
    onTick?.(target);
    onDone?.();
    return () => {};
  }

  const frame = (now: number) => {
    const t = Math.min(1, (now - start) / durationMs);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
    onTick?.(Math.round(target * eased));
    if (t < 1) raf = requestAnimationFrame(frame);
    else onDone?.();
  };
  raf = requestAnimationFrame(frame);

  return () => cancelAnimationFrame(raf);
}

/**
 * Hook wrapper: returns motion variants pre-disabled for reduced motion.
 * Usage:
 *   const { fadeRise: rise, staggerGrid: stagger } = useCoachMotion();
 *   <motion.div variants={rise} initial="hidden" animate="visible" />
 */
export function useCoachMotion() {
  const reduced = useReducedMotion();
  if (reduced) {
    return {
      fadeRise: { hidden: { opacity: 1 }, visible: { opacity: 1 } },
      staggerGrid: { hidden: {}, visible: {} },
      progressFill: { hidden: { scaleX: 1 }, visible: { scaleX: 1 } },
    } satisfies Record<string, Variants>;
  }
  return { fadeRise, staggerGrid, progressFill };
}
