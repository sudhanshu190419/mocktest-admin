import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "supabase/**",
    "scripts/**",
  ]),
  // ── MMT design-token gate (student scope) — PRD §3.1 / review L2 ──
  // One identity: Design A tokens only. Banned: default-palette classes
  // (slate/sky/indigo/blue-*), sub-12px arbitrary text, raw hex literals.
  // Replacement map lives in DESIGN_SYSTEM.md.
  {
    files: [
      "src/app/student/**/*.{ts,tsx}",
      "src/components/student/**/*.{ts,tsx}",
      "src/components/marketing/CourseStoreShell.tsx",
      "src/components/marketing/PaymentModal.tsx",
      "src/components/ui/mmt/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/.*\\b(slate|sky|indigo|blue)-\\d{2,3}\\b.*/]",
          message:
            "Default-palette utility (slate/sky/indigo/blue-*) — use Design A tokens: text-ink/text-ink-secondary, bg-brand, bg-sky-tint, bg-mint, border-line, bg-surface (see DESIGN_SYSTEM.md).",
        },
        {
          selector: "TemplateElement[value.raw=/.*\\b(slate|sky|indigo|blue)-\\d{2,3}\\b.*/]",
          message:
            "Default-palette utility (slate/sky/indigo/blue-*) — use Design A tokens: text-ink/text-ink-secondary, bg-brand, bg-sky-tint, bg-mint, border-line, bg-surface (see DESIGN_SYSTEM.md).",
        },
        {
          selector: "Literal[value=/.*text-\\[1[01]px\\].*/]",
          message:
            "Sub-12px text (12px floor, PRD §3.2) — use text-caption (12px) or text-meta (13px).",
        },
        {
          selector: "TemplateElement[value.raw=/.*text-\\[1[01]px\\].*/]",
          message:
            "Sub-12px text (12px floor, PRD §3.2) — use text-caption (12px) or text-meta (13px).",
        },
        {
          selector: "Literal[value=/.*#(?!ffffff\\b|000000\\b)[0-9a-fA-F]{6}\\b.*/i]",
          message:
            "Raw hex color — use Design A tokens (bg-brand, text-ink, border-line, …) so the palette is changeable in one place (see DESIGN_SYSTEM.md). Pure #ffffff/#000000 are allowed for SVG fills.",
        },
        {
          selector: "TemplateElement[value.raw=/.*#(?!ffffff\\b|000000\\b)[0-9a-fA-F]{6}\\b.*/i]",
          message:
            "Raw hex color — use Design A tokens (bg-brand, text-ink, border-line, …) so the palette is changeable in one place (see DESIGN_SYSTEM.md). Pure #ffffff/#000000 are allowed for SVG fills.",
        },
      ],
    },
  },
]);

export default eslintConfig;
