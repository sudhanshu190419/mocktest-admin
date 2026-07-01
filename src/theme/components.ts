/**
 * Component Tokens — Freebuff Design System
 *
 * Pre-built reusable styles for every common UI component in the
 * application. These styles are derived from the atomic tokens
 * (colors, typography, spacing, radius, shadows) and MUST NOT
 * contain hardcoded values that exist in those modules.
 *
 * Every screen-level component should import its required styles
 * from this file rather than creating them inline.
 *
 * ─── Usage ──────────────────────────────────────────────────────
 *  import { components } from '../theme';
 *  <TouchableOpacity style={components.button.primary}>
 *    <Text style={components.buttonText.primary}>Submit</Text>
 *  </TouchableOpacity>
 *
 * @module theme/components
 */

import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { colors } from './colors';
import { typography } from './typography';
import { spacing } from './spacing';
import { radius } from './radius';

// ═════════════════════════════════════════════════════════════════
//  Utility Types
// ═════════════════════════════════════════════════════════════════

/** A style record that maps string keys to ViewStyle or TextStyle. */
type ViewStyleRecord = Record<string, ViewStyle>;
type TextStyleRecord = Record<string, TextStyle>;

// ═════════════════════════════════════════════════════════════════
//  1. Buttons
// ═════════════════════════════════════════════════════════════════

const buttonBase: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  paddingVertical: spacing[12],
  paddingHorizontal: spacing[24],
  borderRadius: radius.md,
  minHeight: 52,
};

const buttonSmallBase: ViewStyle = {
  ...buttonBase,
  paddingVertical: spacing[8],
  paddingHorizontal: spacing[16],
  minHeight: 36,
};

export const button: ViewStyleRecord = {
  /** Primary CTA button — filled with brand blue. */
  primary: {
    ...buttonBase,
    backgroundColor: colors.secondary,
  },
  /** Secondary button — filled with brand green. */
  secondary: {
    ...buttonBase,
    backgroundColor: colors.primary,
  },
  /** Outlined button — bordered with brand blue. */
  outlined: {
    ...buttonBase,
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.secondary,
  },
  /** Ghost / text button — no background, no border. */
  text: {
    ...buttonBase,
    backgroundColor: 'transparent',
  },
  /** Disabled button — greyed out, no interaction. */
  disabled: {
    ...buttonBase,
    backgroundColor: colors.disabled,
  },
  /** Small primary button — compact CTA. */
  primarySmall: {
    ...buttonSmallBase,
    backgroundColor: colors.secondary,
  },
  /** Small outlined button. */
  outlinedSmall: {
    ...buttonSmallBase,
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.secondary,
  },
  /** Icon-only button — square, no text padding. */
  icon: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
};

export const buttonText: TextStyleRecord = {
  /** Primary CTA button text. */
  primary: {
    ...typography.button,
    color: colors.text.inverse,
  },
  /** Secondary button text. */
  secondary: {
    ...typography.button,
    color: colors.text.inverse,
  },
  /** Outlined button text. */
  outlined: {
    ...typography.button,
    color: colors.secondary,
  },
  /** Text / ghost button text. */
  text: {
    ...typography.button,
    color: colors.secondary,
  },
  /** Disabled button text. */
  disabled: {
    ...typography.button,
    color: colors.text.inverse,
  },
  /** Small version of button text. */
  small: {
    ...typography.buttonSmall,
    color: colors.text.inverse,
  },
  /** Small outlined button text. */
  outlinedSmall: {
    ...typography.buttonSmall,
    color: colors.secondary,
  },
};

// ═════════════════════════════════════════════════════════════════
//  2. Inputs
// ═════════════════════════════════════════════════════════════════

const inputBase: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  borderWidth: 1,
  borderRadius: radius.md,
  paddingHorizontal: spacing[16],
  paddingVertical: spacing[12],
  backgroundColor: colors.surface,
  minHeight: 52,
};

export const input: ViewStyleRecord = {
  /** Filled input — light background with no border outline. */
  filled: {
    ...inputBase,
    backgroundColor: colors.background,
    borderColor: 'transparent',
  },
  /** Outlined input — bordered with default border colour. */
  outlined: {
    ...inputBase,
    borderColor: colors.border,
  },
  /** Focused input — highlighted border with brand blue. */
  focused: {
    borderColor: colors.secondary,
    borderWidth: 2,
  },
  /** Error input — red border with error tint. */
  error: {
    borderColor: colors.error,
    borderWidth: 1.5,
    backgroundColor: colors.tint.red,
  },
  /** Disabled input — subdued background, no interaction. */
  disabled: {
    ...inputBase,
    backgroundColor: colors.divider,
    borderColor: colors.disabled,
  },
};

export const inputText: TextStyleRecord = {
  /** Default input text style. */
  default: {
    ...typography.body,
    color: colors.text.primary,
    flex: 1,
    paddingVertical: 0,
  },
  /** Placeholder text style. */
  placeholder: {
    ...typography.body,
    color: colors.text.secondary,
  },
  /** Error state text style. */
  error: {
    ...typography.body,
    color: colors.error,
  },
  /** Label text for input fields. */
  label: {
    ...typography.label,
    color: colors.text.primary,
    marginBottom: spacing[8],
  },
  /** Error message text below input. */
  errorMessage: {
    ...typography.bodySmall,
    color: colors.error,
    marginTop: spacing[4],
  },
  /** Helper text below input. */
  helper: {
    ...typography.bodySmall,
    color: colors.text.secondary,
    marginTop: spacing[4],
  },
};

// ═════════════════════════════════════════════════════════════════
//  3. Card
// ═════════════════════════════════════════════════════════════════

export const card: ViewStyleRecord = {
  /** Default elevated card. */
  default: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing[16],
  },
  /** Compact card — less padding. */
  compact: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: spacing[12],
  },
  /** Bordered card — outlined instead of elevated. */
  bordered: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing[16],
    borderWidth: 1,
    borderColor: colors.border,
  },
  /** Pressable / interactive card state. */
  pressed: {
    opacity: 0.92,
  },
};

// ═════════════════════════════════════════════════════════════════
//  4. Bottom Sheet
// ═════════════════════════════════════════════════════════════════

export const bottomSheet: ViewStyleRecord = {
  /** Container for the bottom sheet surface. */
  container: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing[12],
    paddingHorizontal: spacing[24],
    paddingBottom: spacing[40],
  },
  /** Drag handle bar at the top of the sheet. */
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing[16],
  },
  /** Backdrop / scrim overlay. */
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.scrim,
  },
};

// ═════════════════════════════════════════════════════════════════
//  5. Chip
// ═════════════════════════════════════════════════════════════════

export const chip: ViewStyleRecord = {
  /** Default chip — subtle background. */
  default: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.tint.blue,
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[8],
    borderRadius: radius.xxl,
  },
  /** Active / selected chip. */
  active: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.secondary,
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[8],
    borderRadius: radius.xxl,
  },
  /** Outlined chip. */
  outlined: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[8],
    borderRadius: radius.xxl,
  },
  /** Error / warning chip. */
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.tint.red,
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[8],
    borderRadius: radius.xxl,
  },
  /** Success chip. */
  success: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.tint.green,
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[8],
    borderRadius: radius.xxl,
  },
};

export const chipText: TextStyleRecord = {
  /** Default chip text. */
  default: {
    ...typography.labelSmall,
    color: colors.secondary,
  },
  /** Active chip text. */
  active: {
    ...typography.labelSmall,
    color: colors.text.inverse,
  },
  /** Outlined chip text. */
  outlined: {
    ...typography.labelSmall,
    color: colors.text.secondary,
  },
  /** Error chip text. */
  error: {
    ...typography.labelSmall,
    color: colors.error,
  },
  /** Success chip text. */
  success: {
    ...typography.labelSmall,
    color: colors.primary,
  },
};

// ═════════════════════════════════════════════════════════════════
//  6. Badge
// ═════════════════════════════════════════════════════════════════

export const badge: ViewStyleRecord = {
  /** Standard badge — red dot / count indicator. */
  default: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  /** Success badge — green indicator. */
  success: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  /** Neutral badge — grey indicator. */
  neutral: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.disabled,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
};

export const badgeText: TextStyleRecord = {
  default: {
    ...typography.caption,
    color: colors.text.inverse,
    fontWeight: '700',
  },
};

// ═════════════════════════════════════════════════════════════════
//  7. Avatar
// ═════════════════════════════════════════════════════════════════

export const avatar: ViewStyleRecord = {
  /** Small avatar — 32 dp. */
  sm: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.tint.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Medium avatar — 40 dp. */
  md: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.tint.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Large avatar — 48 dp. */
  lg: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.tint.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Extra large avatar — 64 dp. */
  xl: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.tint.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** XXL avatar — 80 dp. */
  xxl: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.tint.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
};

export const avatarText: TextStyleRecord = {
  sm: {
    ...typography.bodySmall,
    fontWeight: '700',
    color: colors.secondary,
  },
  md: {
    ...typography.subtitle,
    color: colors.secondary,
  },
  lg: {
    ...typography.title,
    color: colors.secondary,
  },
  xl: {
    ...typography.heading3,
    color: colors.secondary,
  },
  xxl: {
    ...typography.heading2,
    color: colors.secondary,
  },
};

// ═════════════════════════════════════════════════════════════════
//  8. Dividers
// ═════════════════════════════════════════════════════════════════

export const divider: ViewStyleRecord = {
  /** Full-width horizontal divider. */
  horizontal: {
    height: 1,
    backgroundColor: colors.divider,
  },
  /** Vertical divider for inline elements. */
  vertical: {
    width: 1,
    backgroundColor: colors.divider,
    alignSelf: 'stretch',
  },
  /** Section divider with label. */
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing[16],
  },
  /** Section divider line. */
  sectionLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.divider,
  },
};

// ═════════════════════════════════════════════════════════════════
//  9. Layout Helpers
// ═════════════════════════════════════════════════════════════════

export const layout: ViewStyleRecord = {
  /** Full-screen centred container. */
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Full-screen container with background. */
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  /** Row layout with centred alignment. */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  /** Row layout with space-between distribution. */
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  /** Safe area bottom padding. */
  safeBottom: {
    paddingBottom: spacing[24],
  },
  /** Page content padding. */
  pagePadding: {
    paddingHorizontal: spacing[16],
  },
};

// ═════════════════════════════════════════════════════════════════
//  Aggregate Export
// ═════════════════════════════════════════════════════════════════

/** All component tokens — the single import for screen-level styles. */
export const components = {
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
} as const;
