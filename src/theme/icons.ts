/**
 * Icon Size Tokens — Freebuff Design System
 *
 * Standard icon size constants. Every icon rendered in the
 * application MUST use these sizes to maintain visual consistency.
 *
 * ─── Usage ──────────────────────────────────────────────────────
 *  import { iconSizes } from './sizes';
 *  // or
 *  import { iconSize } from '../theme';
 *
 *  <Icon size={iconSizes.md} />
 *
 * ─── Note ───────────────────────────────────────────────────────
 *  These are re-exported from sizes.ts. This file exists as a
 *  dedicated module for clarity and to satisfy the folder structure
 *  specification.
 *
 * @module theme/icons
 */

export { iconSizes } from './sizes';

export type { IconSizeKey } from './sizes';
