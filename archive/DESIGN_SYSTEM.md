# MMT Design System — "Design A" (student scope)

Usage law for the Design A primitives and tokens introduced in the
Student Experience redesign. Companion files:

- `src/design/tokens.css` — token source of truth (palette → `@theme` bridge → scope → base rules)
- `src/components/ui/mmt/` — the primitives
- `src/lib/{format,motion,cn}.ts` — display/motion/composition helpers
- Evidence: `Student_Portal_Design_Review.md`, `STUDENT_EXPERIENCE_PRD.md`

## Scope

These primitives are for **student + storefront surfaces** (anything
inside `CourseStoreShell`). Admin/teacher pages keep the shared kit in
`src/components/ui/` — do **not** repoint those imports, and do **not**
move shared components into `mmt/` without an API review.

```tsx
import { Button, Card, Pill, useToast } from '@/components/ui/mmt';
```

## Rules that bite

1. **One card spec.** `Card` = white surface + 1px `line` + `shadow-card`
   + `radius-card`. Tinted backgrounds only for semantic moments (live
   class, focus areas, success) — pass the tint class explicitly.
2. **Radius set is exactly 3 values + pill:** `rounded-field` (10px),
   `rounded-card` (18px), `rounded-sheet` (24px), `rounded-full`.
   No freehand `rounded-[14px]`, no `rounded-xl/2xl/3xl`.
3. **12px type floor.** The smallest allowed size is `text-caption`
   (12/16). Scale: `caption 12 · meta 13 · body 14 · h3 16 · h2 20 ·
   h1 24 · display 32`. Never `text-[10px]`/`text-[11px]`.
4. **Touch targets ≥44px** on coarse pointers. `tokens.css` enforces
   min-height app-side; `Button` sizes already comply. Don't override
   with shorter fixed heights on interactive elements.
5. **Every async section has designed states:** `Skeleton` while
   loading, `ErrorState` on failure (raw errors go to console, never
   the UI), `EmptyState` when there's no data — icon + one human line +
   one action.
6. **Every mutation gives feedback:** `useToast()` (safe no-op outside
   the provider). No silent success/failure. No toasts for navigation.
7. **Numbers:** `formatPercent/formatScore/formatNumber/formatDate…`
   from `@/lib/format`. Zero-with-no-data renders `—`, never `0%`.
   Ordinals via `ordinal(n)` ("85th"), locale `en-IN`.
8. **Motion:** 150–300ms, `ease-coach`, purposeful. Use
   `useCoachMotion()` / `src/lib/motion.ts` presets. Nothing loops
   except the 6px live dot. `prefers-reduced-motion` is handled
   globally in `tokens.css` — don't add new perpetual animations.
9. **No slate/sky/indigo utilities or raw hex** in student scope — use
   the token bridge (`bg-brand`, `text-ink`, `bg-sky-tint`, …).
10. **Icons:** Phosphor (`@phosphor-icons/react`), `weight="duotone"`
    by default. No emoji as iconography.

## State conventions (§7.3 test-card system applies repo-wide)

State is communicated by a left border strip + label + exactly ONE
primary action — never by a row of equal-weight buttons.

| State | Strip | Label | Primary action |
|---|---|---|---|
| Upcoming | `sand` | "Opens {date}" | — |
| Available | `brand` | "Ready when you are" | Start Test |
| In progress | `sky` | "Resume at Q12 · 22:14 left" | Resume |
| Submitted | `mint` | "Score 214/300 · 71%" | View Result |
| Evaluated | `mint` | score | View Result |
| Limit reached | `line` | "Attempts used" | View Result |
| Expired | `line` | "Closed {date}" | View paper |

## Token layering contract (tokens.css)

1. Palette — private `:root` names; the only place raw values live.
2. `@theme` — Tailwind v4 utility bridge; **additive only** (never
   re-declare a token `globals.css` already owns, or admin/marketing
   surfaces drift). Exception: `--radius-field: 10px` is scoped inside
   `.course-store` because globals owns the root 12px.
3. `.course-store` scope — Design A values flow in.
4. Base — focus, reduced motion, coarse-pointer 44px rule.

## Microcopy (calm coach voice)

| ❌ | ✅ |
|---|---|
| Academic Performance Snapshot | Your week at a glance |
| Mock Tests & Examination Center | Mock tests |
| Completed Evaluations | Tests you've taken |
| Target Focus Areas | Worth practicing |
| Initiate Attempt | Start test |
| Contact your academic administrator | Link: explore courses + support |

One action = one label repo-wide ("View results", never alternating
with "Check scorecard"). Sentence case, no ALL-CAPS UI copy.
