/**
 * Theme Utilities — Freebuff Design System
 *
 * Helper functions for creating typed StyleSheets that infer theme
 * tokens automatically.
 *
 * @module theme/utils
 */

import { StyleSheet } from 'react-native';

/**
 * Creates a typed StyleSheet with automatic theme inference.
 *
 * Wraps `StyleSheet.create` with a generic so that every style
 * object is validated against React Native's `ViewStyle | TextStyle
 * | ImageStyle` at compile time.
 *
 * @example
 * ```ts
 * const styles = createThemedStyles((theme) => ({
 *   container: {
 *     backgroundColor: theme.colors.background,
 *     padding: theme.spacing[16],
 *   },
 * }));
 * ```
 *
 * NOTE: For now this is a thin wrapper around `StyleSheet.create`.
 * In the future it can accept a theme callback when dynamic theming
 * (dark mode) is required.
 */
export function createThemedStyles<T extends StyleSheet.NamedStyles<T>>(
  styles: T,
): T {
  return StyleSheet.create(styles);
}
