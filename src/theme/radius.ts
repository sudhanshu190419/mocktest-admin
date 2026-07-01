/**
 * Border Radius Tokens — Freebuff Design System
 *
 * Reusable border radius values for surfaces, inputs, buttons, and
 * components. Every border radius in the application MUST use these
 * constants. Hardcoded radius values outside this file are forbidden.
 *
 * ─── Naming Convention ──────────────────────────────────────────
 *  sm   → small   (8 px)  — buttons, chips, compact elements
 *  md   → medium  (12 px) — inputs, cards, bottom sheets
 *  lg   → large   (16 px) — modals, elevated cards
 *  xl   → extra   (20 px) — dialogs, bottom sheet handles
 *  xxl  → pill    (24 px) — pills, badges, avatar
 *  full → circular (32 px) — large circular avatars, floating action
 *
 * ─── Usage ──────────────────────────────────────────────────────
 *  import { radius } from '../theme';
 *  borderRadius: radius.md,
 *  borderRadius: radius.full,
 *
 * @module theme/radius
 */

/** Border radius scale (in points / dp). */
export const radius = {
  /** Small — 8 px. Buttons, chips, compact elements. */
  sm: 8,
  /** Medium — 12 px. Inputs, cards, content containers. */
  md: 12,
  /** Large — 16 px. Modals, elevated cards. */
  lg: 16,
  /** Extra large — 20 px. Dialogs, bottom sheet surface. */
  xl: 20,
  /** Extra extra large / pill — 24 px. Badges, pills, small avatars. */
  xxl: 24,
  /** Full / circular — 32 px. Large avatars, FAB. */
  full: 32,
} as const satisfies Record<string, number>;

/** Type helper — extract a radius key. */
export type RadiusKey = keyof typeof radius;
