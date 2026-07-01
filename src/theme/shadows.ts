/**
 * Shadow Tokens — Freebuff Design System
 *
 * Cross-platform shadow presets. Each preset is compatible with both
 * iOS (shadowColor / shadowOffset / shadowOpacity / shadowRadius)
 * and Android (elevation).
 *
 * Every shadow in the application MUST use these presets. Hardcoded
 * shadow values outside this file are forbidden.
 *
 * ─── Usage ──────────────────────────────────────────────────────
 *  import { shadows } from '../theme';
 *  <View style={[shadows.small, { backgroundColor: 'white' }]}>...
 *  <View style={shadows.large}>...
 *
 * ─── Visual Reference ───────────────────────────────────────────
 *  small  →  subtle, low-elevation (cards, buttons)
 *  medium →  elevated (modals, dropdowns, action sheets)
 *  large  →  prominent (bottom sheets, dialogs, FAB)
 *
 * @module theme/shadows
 */

import type { ViewStyle } from 'react-native';

/** Shadow preset type. */
type ShadowStyle = Pick<
  ViewStyle,
  'shadowColor' | 'shadowOffset' | 'shadowOpacity' | 'shadowRadius' | 'elevation'
>;

/**
 * Cross-platform shadow presets.
 *
 * Each preset provides consistent depth between iOS and Android.
 */
export const shadows: Record<'small' | 'medium' | 'large', ShadowStyle> = {
  /** Subtle, low-elevation shadow. Use for cards, list items, buttons. */
  small: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },

  /** Medium-elevation shadow. Use for modals, dropdowns, action sheets. */
  medium: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 6,
  },

  /** High-elevation shadow. Use for bottom sheets, dialogs, FAB. */
  large: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 12,
  },
} as const;
