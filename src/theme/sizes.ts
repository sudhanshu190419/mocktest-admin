/**
 * Size Tokens — Freebuff Design System
 *
 * Standard dimension constants for common UI elements — avatars,
 * icons, buttons, badges, and interactive areas. Every hardcoded
 * size in the application MUST use these constants.
 *
 * ─── Usage ──────────────────────────────────────────────────────
 *  import { sizes } from '../theme';
 *  width: sizes.avatar.md,
 *  height: sizes.button.md,
 *
 * @module theme/sizes
 */

/** Standard sizes for avatars. */
export const avatarSizes = {
  /** Small avatar — 32 dp. Chips, comments, list items. */
  sm: 32,
  /** Medium avatar — 40 dp. Profile cards, headers. */
  md: 40,
  /** Large avatar — 48 dp. Profile screens, hero sections. */
  lg: 48,
  /** Extra large avatar — 64 dp. Full-screen profile preview. */
  xl: 64,
  /** Extra extra large — 80 dp. Welcome / onboarding. */
  xxl: 80,
} as const;

/** Standard sizes for icons. */
export const iconSizes = {
  /** Small icon — 16 dp. Inline with text, badge icons. */
  sm: 16,
  /** Medium-small icon — 20 dp. Context menu, tab bar. */
  mdSm: 20,
  /** Medium icon — 24 dp. Primary action icons. */
  md: 24,
  /** Large icon — 28 dp. Section headers, empty state icons. */
  lg: 28,
  /** Extra large icon — 32 dp. Hero / splash icons. */
  xl: 32,
} as const;

/** Standard sizes for buttons. */
export const buttonSizes = {
  /** Small button height — 36 dp. */
  sm: 36,
  /** Medium button height — 44 dp. Default. */
  md: 44,
  /** Large button height — 52 dp. Primary CTA. */
  lg: 52,
} as const;

/** Standard sizes for badges. */
export const badgeSizes = {
  /** Small badge — 18 dp. */
  sm: 18,
  /** Medium badge — 22 dp. */
  md: 22,
  /** Large badge — 28 dp. */
  lg: 28,
} as const;

/** Interactive hit-slop — minimum touch target (44 dp). */
export const hitSlop = {
  top: 8,
  bottom: 8,
  left: 12,
  right: 12,
} as const;

/** Standard minimum touch target size (44 dp, Apple HIG / Material Design). */
export const MIN_TOUCH_TARGET = 44 as const;

/** Convenience aggregate of all size tokens. */
export const sizes = {
  avatar: avatarSizes,
  icon: iconSizes,
  button: buttonSizes,
  badge: badgeSizes,
  hitSlop,
  minTouchTarget: MIN_TOUCH_TARGET,
} as const;

/** Type helpers. */
export type AvatarSizeKey = keyof typeof avatarSizes;
export type IconSizeKey = keyof typeof iconSizes;
export type ButtonSizeKey = keyof typeof buttonSizes;
export type BadgeSizeKey = keyof typeof badgeSizes;
