/**
 * Design System — Freebuff
 *
 * Single entry point for the entire design system. Every screen and
 * component in the application imports tokens from this module.
 *
 * ─── Golden Rule ────────────────────────────────────────────────
 *  Never hardcode colours, font sizes, spacing, or shadows inside
 *  any screen file. Always import from `src/theme`.
 *
 *  ✅ Correct:
 *    import { colors, typography, spacing } from '../theme';
 *    <Text style={[typography.body, { color: colors.text.primary }]}>
 *
 *  ❌ Wrong:
 *    <Text style={{ fontSize: 14, color: '#1E293B' }}>
 *
 * @module theme
 */

// ─── Atomic Tokens ──────────────────────────────────────────────
export { colors, palette } from './colors';
export type { TextColorKey, TintColorKey } from './colors';

export { typography, getFontFamily } from './typography';
export type { TypographyKey } from './typography';

export { spacing, Spacing } from './spacing';
export type { SpacingKey } from './spacing';

export { radius } from './radius';
export type { RadiusKey } from './radius';

export { shadows } from './shadows';

export { sizes, avatarSizes, iconSizes, buttonSizes, badgeSizes, hitSlop, MIN_TOUCH_TARGET } from './sizes';
export type { AvatarSizeKey, IconSizeKey, ButtonSizeKey, BadgeSizeKey } from './sizes';

// ─── Component Tokens ───────────────────────────────────────────
export {
  components,
  button,
  buttonText,
  input,
  inputText,
  card,
  bottomSheet,
  chip,
  chipText,
  badge,
  badgeText,
  avatar,
  avatarText,
  divider,
  layout,
} from './components';

// ─── StyleSheet Factory (convenience) ───────────────────────────
export { createThemedStyles } from './utils';
