/**
 * Color Tokens — Freebuff Design System
 *
 * The single source of truth for every colour used in the application.
 * Every screen, component, and utility MUST import colours from this
 * file. Hardcoded hex values outside this file are forbidden.
 *
 * ─── Architecture ──────────────────────────────────────────────
 *  1. Brand palette   – raw brand colours (never consumed directly)
 *  2. Semantic tokens  – purpose-mapped colours consumed by screens
 *  3. Raw palette      – full extended palette for edge cases
 *
 * ─── Usage ─────────────────────────────────────────────────────
 *   import { colors } from '../theme';
 *   backgroundColor: colors.background,
 *   color: colors.text.primary,
 *
 * @module theme/colors
 */

// ═════════════════════════════════════════════════════════════════
//  1. Brand Palette (raw values)
// ═════════════════════════════════════════════════════════════════

const brand = {
  /** Primary brand green — trust, growth, success. */
  green: '#155215',
  /** Primary brand blue — primary CTA, authority. */
  blue: '#194080',
  /** Deep positive / success accent. */
  successBlue: '#092F6E',
} as const;

// ═════════════════════════════════════════════════════════════════
//  2. Semantic Tokens (consumed by screens & components)
// ═════════════════════════════════════════════════════════════════

export const colors = {
  // ── Brand ─────────────────────────────────────────────────────
  /** Primary brand colour (green) — used for success states, progress indicators. */
  primary: brand.green,
  /** Secondary brand colour (blue) — used for primary CTAs, links, navigation. */
  secondary: brand.blue,

  // ── Backgrounds ───────────────────────────────────────────────
  /** App-level page background. */
  background: '#F8FAFC',
  /** Elevated surface colour (cards, sheets, modals). */
  surface: '#FFFFFF',

  // ── Text ──────────────────────────────────────────────────────
  text: {
    /** Primary content text — headings, body copy. */
    primary: '#1E293B',
    /** Secondary / subdued text — labels, hints, metadata. */
    secondary: '#64748B',
    /** Text on brand-coloured backgrounds. */
    inverse: '#FFFFFF',
  },

  // ── Semantic States ───────────────────────────────────────────
  /** Success / positive state — deep positive blue. */
  success: brand.successBlue,
  /** Error / destructive state. */
  error: '#DC2626',
  /** Warning / caution state. */
  warning: '#F59E0B',
  /** Informational state. */
  info: brand.blue,

  // ── Interactive States ────────────────────────────────────────
  /** Disabled elements — buttons, inputs, chips. */
  disabled: '#CBD5E1',

  // ── Borders & Dividers ────────────────────────────────────────
  /** Default border colour for inputs, cards, outlined elements. */
  border: '#E2E8F0',
  /** Light separator colour for dividers, list item separators. */
  divider: '#F1F5F9',

  // ── Feedback / Overlay ────────────────────────────────────────
  /** Overlay scrim (semi-transparent black). */
  scrim: 'rgba(0, 0, 0, 0.4)',
  /** Highlight tint for selected / focused states. */
  highlight: 'rgba(25, 64, 128, 0.08)',

  // ── Brand Tints (for backgrounds, badges, chips) ──────────────
  tint: {
    /** Light green tint — success pill backgrounds. */
    green: '#E8F5E9',
    /** Light blue tint — info pill backgrounds. */
    blue: '#E3F2FD',
    /** Light red tint — error / destructive pill backgrounds. */
    red: '#FFEBEE',
    /** Light amber tint — warning pill backgrounds. */
    amber: '#FFFBEB',
  },
} as const;

// ═════════════════════════════════════════════════════════════════
//  3. Raw Palette (for custom / one-off uses)
// ═════════════════════════════════════════════════════════════════

export const palette = {
  white: '#FFFFFF',
  black: '#000000',
  slate50: '#F8FAFC',
  slate100: '#F1F5F9',
  slate200: '#E2E8F0',
  slate300: '#CBD5E1',
  slate400: '#94A3B8',
  slate500: '#64748B',
  slate600: '#475569',
  slate700: '#334155',
  slate800: '#1E293B',
  slate900: '#0F172A',
  green: '#155215',
  blue: '#194080',
  successBlue: '#092F6E',
  red500: '#DC2626',
  amber400: '#F59E0B',
} as const;

/** Type helper — extract a text colour key. */
export type TextColorKey = keyof typeof colors.text;

/** Type helper — extract a tint colour key. */
export type TintColorKey = keyof typeof colors.tint;
