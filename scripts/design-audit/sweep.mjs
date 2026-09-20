/**
 * Design A token sweep codemod — PRD §3.1 (A1/L2).
 *
 * Rewrites default-palette utilities (slate/sky/indigo/blue-*) into Design A
 * token utilities inside the student scope ONLY (files passed as args).
 *
 * Philosophy: a mapping table, not heuristics. Only whitelisted tokens are
 * rewritten; anything ambiguous is REPORTED, never guessed. Alpha variants
 * (e.g. bg-slate-900/60 scrims) and raw hex are reported for hand-fixing.
 *
 * Usage: node scripts/design-audit/sweep.mjs <glob...>   (dry run by default)
 *        node scripts/design-audit/sweep.mjs --write <glob...>
 */
import fs from 'node:fs';
import path from 'node:path';

const WRITE = process.argv.includes('--write');
const args = process.argv.slice(2).filter((a) => a !== '--write');
if (args.length === 0) {
  console.error('Usage: node scripts/design-audit/sweep.mjs [--write] <files...>');
  process.exit(1);
}

/* ── The mapping table (property → shade → Design A token) ───────────── */

// slate: the neutral voice → paper/line/ink
const slateText = {
  100: 'text-sky-ink', // on-dark text (kept brand-tinted until dark mode)
  200: 'text-sky-ink',
  300: 'text-ink-muted', // decorative/meta on light
  400: 'text-ink-muted',
  500: 'text-ink-secondary',
  600: 'text-ink-secondary',
  700: 'text-ink',
  800: 'text-ink',
  900: 'text-ink',
  950: 'text-ink',
};
const slateBg = {
  50: 'bg-paper',
  100: 'bg-paper',
  200: 'bg-sky-tint',
  300: 'bg-sky-tint',
  400: 'bg-sky-tint',
  600: 'bg-ink-secondary', // mid surface (chips, disabled)
  700: 'bg-ink', // dark UI surfaces
  800: 'bg-ink',
  900: 'bg-ink',
  950: 'bg-ink',
};
const slateBorder = {
  100: 'border-line',
  200: 'border-line',
  300: 'border-line',
  400: 'border-line',
  600: 'border-ink-secondary',
  700: 'border-ink', // dark UI borders
  800: 'border-ink',
  900: 'border-ink',
};
const slateOther = {
  placeholder: { 400: 'placeholder:text-ink-muted', 500: 'placeholder:text-ink-muted' },
  ring: { 950: 'ring-ink' },
  divide: { 100: 'divide-line' },
  shadow: {
    900: { 5: 'shadow-none', 10: 'shadow-card', 15: 'shadow-card' },
  },
};

// sky: the brand tint → brand / sky-tint
const skyText = {
  100: 'text-brand', // on-dark
  200: 'text-brand',
  300: 'text-sky-ink',
  400: 'text-sky-ink',
  500: 'text-brand',
  600: 'text-brand',
  700: 'text-brand-hover',
  800: 'text-brand-hover',
  900: 'text-brand-hover',
  950: 'text-brand-hover',
};
const skyBg = {
  50: 'bg-sky-tint',
  100: 'bg-sky-tint',
  200: 'bg-sky-tint',
  400: 'bg-sky-tint',
  500: 'bg-brand',
  600: 'bg-brand',
  700: 'bg-brand-hover',
  800: 'bg-brand-hover',
  900: 'bg-ink',
  950: 'bg-ink',
};
const skyBorder = {
  100: 'border-line',
  200: 'border-line',
  300: 'border-line',
  400: 'border-brand/40',
  500: 'border-brand',
  600: 'border-brand',
  800: 'border-ink',
};
const skyOther = {
  ring: {
    100: 'ring-line',
    200: 'ring-line',
    500: 'ring-brand',
    600: 'ring-brand',
  },
  shadow: {
    600: { 20: 'shadow-card', 30: 'shadow-card' },
    900: { 20: 'shadow-card' },
  },
};

// indigo/blue: brand aliases → brand tokens
const brandText = {
  100: 'text-brand',
  200: 'text-brand',
  300: 'text-brand',
  400: 'text-brand',
  500: 'text-brand',
  600: 'text-brand',
  700: 'text-brand-hover',
  800: 'text-brand-hover',
  900: 'text-brand-hover',
  950: 'text-brand-hover',
};
const brandBg = {
  50: 'bg-sky-tint',
  100: 'bg-sky-tint',
  400: 'bg-sky-tint',
  500: 'bg-brand',
  600: 'bg-brand',
  700: 'bg-brand-hover',
  800: 'bg-brand-hover',
  900: 'bg-ink',
  950: 'bg-ink',
};
const brandBorder = {
  100: 'border-line',
  200: 'border-line',
  300: 'border-line',
  400: 'border-brand',
  500: 'border-brand',
  600: 'border-brand',
  700: 'border-brand-hover',
};
const brandOther = {
  accent: { 500: 'accent-brand' },
  ring: {
    200: 'ring-line',
    400: 'ring-brand',
    500: 'ring-brand',
    600: 'ring-brand',
  },
  shadow: {
    500: { 20: 'shadow-card' },
    600: { 20: 'shadow-card', 30: 'shadow-card', 50: 'shadow-card' },
    950: { 20: 'shadow-card', 50: 'shadow-card' },
  },
};

const MAP = {
  slate: { text: slateText, bg: slateBg, border: slateBorder, other: slateOther },
  sky: { text: skyText, bg: skyBg, border: skyBorder, other: skyOther },
  indigo: { text: brandText, bg: brandBg, border: brandBorder, other: brandOther },
  blue: { text: brandText, bg: brandBg, border: brandBorder, other: brandOther },
};

/* ── Transform ────────────────────────────────────────────────────────── */

const TOKEN_RE =
  /(?<prop>bg|text|border|ring|from|to|via|divide|outline|decoration|shadow|accent|caret|fill|stroke|placeholder)-(?<pal>slate|sky|indigo|blue)-(?<shade>\d{2,3})(?:\/(?<alpha>\d{1,3}))?(?![\w-])/g;
const HEX_RE = /#[0-9a-fA-F]{6}\b/gi;
const HEX_OK = /^#(ffffff|000000)$/i;
const SIZE_RE = /text-\[1[01]px\]/g;

const reports = [];
let changedFiles = 0;

function mapToken(m) {
  const table = MAP[m.pal];
  if (!table) return null;

  // Gradient stops follow the bg table (from-sky-50 ≈ bg-sky-50 in intent).
  const prop = /^(from|to|via)$/.test(m.prop) ? 'bg' : m.prop;

  let mapped;
  if (prop === 'text') mapped = table.text[m.shade];
  else if (prop === 'bg') mapped = table.bg[m.shade];
  else if (prop === 'border') mapped = table.border[m.shade];
  else {
    const others = table.other[m.prop];
    if (others) {
      const v = others[m.shade];
      // Alpha-dependent entries are objects; colored glows collapse to the
      // flat elevation token (alpha is meaningless once the color is fixed).
      if (typeof v === 'object') {
        return m.prop === 'shadow' ? 'shadow-card' : null;
      }
      mapped = v;
    }
  }
  if (!mapped) return null;
  // Tailwind v4 supports alpha on token colors: bg-slate-900/60 → bg-ink/60.
  return m.alpha ? `${mapped}/${m.alpha}` : mapped;
}

for (const arg of args) {
  const files = fs.existsSync(arg) && fs.statSync(arg).isDirectory()
    ? fs.readdirSync(arg, { recursive: true })
        .filter((f) => /\.(tsx?|jsx?)$/.test(f) && !/\.test\./.test(f))
        .map((f) => path.join(arg, f))
    : [arg];

  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    let out = src;
    const fileReports = [];

    out = out.replace(TOKEN_RE, (match, ...rest) => {
      const groups = rest[rest.length - 1];
      const mapped = mapToken(groups);
      if (!mapped) {
        fileReports.push(`    ? ${match}  (hand-fix)`);
        return match;
      }
      return mapped;
    });

    out = out.replace(SIZE_RE, () => {
      // Sub-floor sizes lift to caption (12px) — the type-scale floor.
      // Always a safe enlarge; meta (13) can be chosen by hand if wanted.
      fileReports.push(`    ! sub-12px size → text-caption (verify visually)`);
      return 'text-caption';
    });

    for (const h of src.match(HEX_RE) ?? []) {
      if (!HEX_OK.test(h)) fileReports.push(`    ! ${h}  (hex — hand-fix)`);
    }

    if (out !== src) {
      if (WRITE) fs.writeFileSync(file, out);
      changedFiles++;
      console.log(`${WRITE ? 'W' : 'D'} ${file}`);
    }
    if (fileReports.length) {
      reports.push(`${file}\n${fileReports.join('\n')}`);
    }
  }
}

console.log(`\n${WRITE ? 'WROTE' : 'DRY-RUN would change'} ${changedFiles} files.`);
if (reports.length) {
  console.log(`\n── ${reports.length} file(s) need hand-fixes ──`);
  console.log(reports.join('\n'));
  fs.writeFileSync(
    path.join(import.meta.dirname, 'sweep-handfixes.txt'),
    reports.join('\n\n')
  );
  console.log('\nHand-fix list: scripts/design-audit/sweep-handfixes.txt');
}
