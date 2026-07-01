/**
 * Spacing Tokens — Freebuff Design System
 *
 * 8-point spacing system. Every margin, padding, gap, and offset in
 * the application MUST use these constants. Hardcoded spacing values
 * outside this file are forbidden.
 *
 * ─── Rationale ──────────────────────────────────────────────────
 *  The 8-point grid ensures visual rhythm and consistency across
 *  all screens. Multiples of 8 (and sub-multiples 4) provide enough
 *  granularity for fine-tuning without sacrificing alignment.
 *
 * ─── Usage ──────────────────────────────────────────────────────
 *  import { spacing } from '../theme';
 *  padding: spacing[16],
 *  marginBottom: spacing[24],
 *  gap: spacing[12],
 *
 * @module theme/spacing
 */

/** Spacing scale (in points / dp). */
export const spacing = {
  0: 0,
  /** 4 dp — extra tight (icon-to-text, small inline gaps). */
  4: 4,
  /** 8 dp — tight (button padding, chip padding, small card inset). */
  8: 8,
  /** 12 dp — compact (input-to-label, list item inner gaps). */
  12: 12,
  /** 16 dp — base (card padding, section margins, screen padding). */
  16: 16,
  /** 20 dp — comfortable (card-to-card, button-to-next-element). */
  20: 20,
  /** 24 dp — relaxed (section-to-section, modal margins). */
  24: 24,
  /** 32 dp — generous (screen padding on large screens, hero spacing). */
  32: 32,
  /** 40 dp — extra generous (major section breaks, bottom sheet top offset). */
  40: 40,
  /** 48 dp — very spacious (large bottom padding, top-of-screen hero). */
  48: 48,
  /** 56 dp — extreme (splash screen spacing, full-screen modal footer). */
  56: 56,
  /** 64 dp — maximum spacing (large hero sections, bottom sheet full height). */
  64: 64,
} as const satisfies Record<number, number>;

/** Type helper — extract a spacing key. */
export type SpacingKey = keyof typeof spacing;

/** Convenience aliases for common spacing values. */
export const Spacing = {
  /** Extra extra small — 4 dp. */
  xxs: spacing[4],
  /** Extra small — 8 dp. */
  xs: spacing[8],
  /** Small — 12 dp. */
  sm: spacing[12],
  /** Medium / base — 16 dp. */
  md: spacing[16],
  /** Large — 20 dp. */
  lg: spacing[20],
  /** Extra large — 24 dp. */
  xl: spacing[24],
  /** Extra extra large — 32 dp. */
  xxl: spacing[32],
  /** Huge — 40 dp. */
  huge: spacing[40],
  /** Extra huge — 48 dp. */
  xhuge: spacing[48],
  /** Giant — 56 dp. */
  giant: spacing[56],
  /** Extra giant — 64 dp. */
  xgiant: spacing[64],
} as const;
