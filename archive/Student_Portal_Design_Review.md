# MMT Student Experience — Full Design Review
**Reviewer:** Buffy (senior product designer lens: visual system, UX/IA, motion, a11y, content, data-viz, mobile, conversion)
**Date:** 2026-09-19 · **Scope:** everything a student touches (student portal, shared shell, storefront, checkout, test runner)
**Method:** full code scan (21 student routes, 62 student components, shell, tokens) + live Playwright audit (31 screenshots, desktop 1440 & mobile 390) + DOM instrumentation (tap targets, type sizes, color histograms, sticky geometry, overflow) + network failure log.

---

## 1. The story: a student's first five minutes

A NEET aspirant opens MMT on her phone after school. Header loads — clean, distinctive, genuinely nicer than most coaching platforms. She taps "My Learning" and scrolls: **greeting banner first** ("Welcome back, pick up where you left off…") — but the actual *where she left off* (her in-progress test, her last lecture) is nowhere in the hero; it's generic copy above generic stats. To reach anything she must first scroll past **124px of stacked sticky bars** (header + sub-nav), then a breadcrumb, then a page hero, before her first real card — roughly **500px of throat-clearing** before content on a 844px screen.

She wants today's plan. What she gets is a marketing-style dashboard: four KPI tiles in corporate English ("Academic Performance Snapshot", "Completed Evaluations"), two emoji-studded test rows, and an amber "Target Focus Areas" box that reads like a warning label. She opens **Mock Tests**: 55 elements of sub-12px text, filter pills 32px tall, and four identical-looking buttons per card (Start / Resume / View Result / Retake) — she must *read every card* instead of *seeing its state*. On **Timetable**, half the data silently fails to load (HTTP 400s, no error UI). On **Analytics**, a dark slate dashboard-card suddenly takes over the screen like a different app; her percentile reads "85th %".

Then she tries to tap. On mobile, **72–92% of all interactive elements are under 44px tall** — the platform physically fights her thumbs. Nothing animates in; screens snap. It works, nothing overflows, and the bones are good — but at no point does it feel like a *coach who knows her*. It feels like a well-built admin panel wearing a nice storefront jacket.

**Verdict if I visited:** 6.5/10 — strong foundation, professional, distinctive shell; undermined by touch ergonomics, typography, a split visual identity, and a home that doesn't serve the daily loop. Every problem below is fixable without a rewrite.

---

## 2. What is genuinely right — protect these

1. **Design A token foundation** (paper `#f3f8fc`, brand `#2458d3`, ink `#152b45`, warm tints, editorial type) is distinctive and premium. This is the platform's identity — extend it, don't replace it.
2. **Accessibility basics done properly:** skip-link, 3px `focus-visible` outlines, `aria-current`, semantic nav/breadcrumbs, labelled fields with correct `autocomplete`.
3. **Zero horizontal overflow at 390px on every single page** (measured). Rare. The responsive grid work is real.
4. **Overview skeleton loader** exists and is well-shaped (most pages lack it — Overview shows the way).
5. **Test-runner engineering** (server-authoritative timer, persistence queue with drain barrier, auto-submit, save-status, fullscreen/tab warnings) is genuinely solid — the design layer just needs to catch up.
6. **Live-dot on Live Classes nav item**, hover elevation on cards, tabular-nums on metrics: good instincts already present.

---

## 3. Findings by discipline

Legend: 🔴 critical (breaks the experience) · 🟠 major (materially hurts) · 🟡 minor (polish debt)

### A. Visual system & brand identity

| # | Sev | Finding | Evidence | Prescription |
|---|-----|---------|----------|--------------|
| A1 | 🔴 | **Three visual dialects coexist.** Design A tokens vs Tailwind slate/sky/indigo utilities vs dead legacy tokens in `globals.css`. | Payment modal CTA is `blue-600` `#2563eb`; brand is `#2458d3`. Analytics page is slate-900 + sky/indigo/emerald/rose Tailwind. Overview is Design A. Root cause: `--color-store-*` tokens aren't bridged into Tailwind v4 `@theme`, so devs reaching for utilities default to slate. | Bridge Design A into `@theme` (`--color-brand`, `--color-ink`, …) so `bg-brand`, `text-ink` utilities exist; then sweep slate/sky/indigo utilities out of `/student/**` + payment modal. Delete unused legacy tokens + `btn-primary`/bezel classes. |
| A2 | 🟠 | **6 font families loaded, 3 render.** | `layout.tsx` loads Geist, Geist Mono, Manrope (display), DM Sans (body), Jakarta, Inter. Measured: DM Sans + Manrope render; Outfit on 1 element; Geist/Jakarta/Inter unused; JetBrains Mono appears once (profile). | Load only Manrope + DM Sans (or DM Sans + tabular-nums). Cut ~100–150KB and two FOUT sources. |
| A3 | 🟠 | **Radius chaos.** | Measured per page: 8, 10, 12, 14, 18, 24, 32px and pill all present; `rounded-xl/2xl/3xl` used freehand against `--radius-store-card: 18px`. | Codify 3 radii: `field 10px`, `card 18px`, `sheet 24px` + pill. Enforce via tokens. |
| A4 | 🟡 | Emoji used as iconography. | `getSubjectIcon()` returns 🔬🧪📐; tests hub uses ⏱📝🏆 inline. Clashes with the Phosphor icon system and kills the premium tone. | Replace with Phosphor (`Atom`, `Flask`, `MathOperations`…), one `subjectIcon()` helper. |
| A5 | 🟡 | Inline `style={{…var(--color-store-x)}}` sprinkled through JSX (dozens of instances). | Overview, tests, results, payment. Un-greppable, bypasses Tailwind. | Becomes unnecessary once A1's theme bridge lands. |
| A6 | 🟡 | Shadow systems overlap (`shadow-store-card`, `shadow-xs/md/2xs`, gradient backgrounds on some cards only). | Overview: three different card treatments on one screen (white, paper-gradient, amber-gradient). | One card spec: white surface + 1px line + `shadow-store-card`; tints reserved for semantic moments (focus areas). |

### B. Typography & readability

| # | Sev | Finding | Evidence | Prescription |
|---|-----|---------|----------|--------------|
| B1 | 🔴 | **Sub-12px text epidemic.** Measured: overview 35, tests **55**, analytics 31–32, profile 24–25 instances of <12px text per page. 10px uppercase labels, 11px body. | Audience is 15–19-year-olds studying 4–8 h/day (often on 6" screens, sometimes low-end). | Hard floor: 12px for captions/badges, 13px for meta, 14px body minimum. Define a 6-step type scale as tokens and forbid `text-[10px]`/`text-[11px]` via lint. |
| B2 | 🟠 | No codified type scale; display tracking (`-.055em`) applied to small UI headings. | `student.css`, page headings. | Scale tokens: display 32/40, h1 24/30, h2 20/28, h3 16/24, body 14/22, meta 13/18, caption 12/16. Tracking ≤ -0.02em below 20px. |
| B3 | 🟡 | Numbers: tabular-nums applied inconsistently; mixed date locales (`en-IN` in analytics, browser default elsewhere). | Analytics vs results. | One `formatDate/formatTime` util, `en-IN`, tabular-nums everywhere numerals render. |

### C. Layout, information architecture & navigation

| # | Sev | Finding | Evidence | Prescription |
|---|-----|---------|----------|--------------|
| C1 | 🔴 | **Overview is a dashboard, not a daily plan.** North star = daily engagement; the hero says "pick up where you left off" but shows static greeting + KPIs. Resume points (in-progress test, next lecture) require hunting. | `overview/page.tsx`. | Rebuild overview as **Today**: (1) resume strip — in-progress test / next class / last lecture, (2) today's timetable strip, (3) tests due this week, (4) *then* compact stats. KPIs move to Analytics. |
| C2 | 🟠 | **10 flat destinations in one scroll strip** — no hierarchy between daily (Courses, Tests, Doubts, Classes) and occasional (Profile, Analytics); mobile shows no affordance for scrollability. | `StudentSubNav`. | Group: primary 5 remain pills; Profile + Analytics move into the header avatar menu (already partially exists); add edge-fade + partial-next-item peek on overflow. |
| C3 | 🟠 | **Three overlapping navigation layers** (header nav + sub-nav pills + breadcrumbs) with inconsistent roots ("Student Hub" isn't a nav label; courses breadcrumb starts at "MakeMeTopper"). | Multiple pages. | Header = global, sub-nav = sections, breadcrumbs = depth only, single canonical root "My Learning". |
| C4 | 🟠 | Results vs Analytics overlap: results page computes its own avg-score/accuracy aggregates — two competing "how am I doing" models. | `results/page.tsx` metrics bar. | Results = *list of scorecards*; all aggregate intelligence lives in Analytics. Cross-link between them. |
| C5 | 🟡 | Footer is logged-out marketing even when signed in ("Student login ↗" visible to a logged-in student). | `CourseStoreShell` footer. | Logged-in footer variant: support links, catalog links, version/help. |
| C6 | 🟡 | Sub-nav has no badge counts (pending doubts, tests due today) — the one nav element that could drive the daily loop doesn't. | `StudentSubNav`. | Small count badges on Doubts + Tests (Design A apricot tint, not alarm red). |
| C7 | 🟡 | Active pill style (solid ink) is heavy and competes with page content; no motion between active states. | `student.css`. | Soften: sky tint + brand text + 2px underline dot; animate with a shared layout indicator if Framer Motion is adopted. |

### D. Color, contrast & accessibility

| # | Sev | Finding | Evidence | Prescription |
|---|-----|---------|----------|--------------|
| D1 | 🟠 | Muted text combos borderline/failing at their sizes: `slate-400 #94a3b8` on white ≈ 2.9:1 used for 10–11px labels; `--color-store-muted #5e7084` on paper ≈ 4.6:1 (passes only for ≥14px). | Measured text-color histogram; `text-slate-400` widespread in tests/analytics. | Darken muted token to ≈ `#51637a` and *ban* `slate-400` for text in student scope; small text must hit 4.5:1. |
| D2 | 🟠 | Status communicated by color+tint alone in several cards (weak-area amber, evaluated green) without icon/text redundancy at small sizes. | Overview, results. | Always pair color with icon or word (Pass/Fail/Live/Ended); never color-only. |
| D3 | 🟡 | Focus behavior inconsistent: shell has excellent 3px focus-visible; Tailwind-utility areas rely on UA defaults. | Courses.css vs analytics page. | Global focus-visible rule once the theme bridge lands (it already exists in `.course-store` — extend scope to all student content). |
| D4 | 🟡 | Profile dropdown has no Escape-close/keyboard handling; overlay modals vary in Escape/focus-trap behavior. | `CourseStoreShell.tsx`. | Shared `useDismiss` (Escape + outside click + focus return) for dropdown + modals. |
| D5 | 🟡 | Percentile rendering "{p}th %" produces "85th %" — awkward and slightly wrong for 1st/2nd/3rd. | Overview KPI. | `ordinal(n)` helper: 1st/2nd/3rd/85th + "percentile" label. |

### E. Touch, ergonomics & mobile

| # | Sev | Finding | Evidence | Prescription |
|---|-----|---------|----------|--------------|
| E1 | 🔴 | **Touch-target failure at scale: 72–92% of interactive elements <44px tall on mobile** (measured every page; sub-nav pills ~38px, filter buttons ~32px, card action buttons ~30px, header 32–34px). | `measurements.json`, all 10 mobile pages. | Global rule: every interactive element ≥44px *hit area* (padding, not necessarily visual size). Sub-nav pills, filter chips, table action buttons are the priority list. |
| E2 | 🔴 | **Sticky-bar seam defect:** sub-nav `top:65px` but real mobile header is 70px → 5px band where content scrolls visibly between the bars (desktop: 85 vs 86 = 1px sliver). Magic numbers in `student.css` media queries. | Measured geometry; CSS `@media (max-width:800px)`. | Measure once in JS (or CSS var set by header height) and set `--shell-offset`; sub-nav consumes it. Kills the seam and all magic numbers. |
| E3 | 🟠 | **124px of sticky chrome on a 844px mobile viewport (15%)** before content; plus breadcrumb + page hero push first meaningful card to ~500px. | Measured; page structures. | On mobile: collapse header to 56px, make sub-nav horizontally compact (icons + short labels), drop breadcrumbs on mobile, make page heroes compact (title only; the long lead paragraph is desktop decoration). |
| E4 | 🟠 | Overflow scroll strips (sub-nav, filter rows) have no edge fade or partial-next peek — undiscoverable affordance. | Tests hub, sub-nav. | CSS mask gradient fade + ensure next pill peeks ~24px. |
| E5 | 🟡 | No mobile bottom-nav consideration; primary nav lives at thumb-hostile top. | — | Consider a 4-item bottom bar on mobile (Today, Courses, Tests, Doubts) as part of the C1 overview rebuild. Decision point for PRD. |
| E6 | 🟠 | **Test runner is desktop-only in practice** ("Render Desktop Runner Shell"; no mobile adaptation). For a 50/50 audience, students may be unable to take tests from phones. | `runner/page.tsx`, `TestRunnerShell`. | PRD decision (you chose NTA-familiar skin): NTA CBT is desktop, but mocks on mobile are still how students practice casually. Minimum: responsive runner (palette becomes a bottom sheet), or an explicit "best on desktop" notice with resumable session — never a broken layout. |

### F. Motion & micro-interactions

| # | Sev | Finding | Evidence | Prescription |
|---|-----|---------|----------|--------------|
| F1 | 🔴 | **Framer Motion is installed and used zero times.** No entrance choreography, no shared transitions; screens pop. | `grep framer-motion / motion` → 0 matches. | "Calm coach" motion spec: 200–250ms ease-out entrances, 40–60ms stagger on card grids, progress-fill animations on load, tab underline slide. One shared `motion` preset file; nothing springy or bouncy. |
| F2 | 🟠 | Permanent `animate-pulse` on the live-class icon box and in-progress metric — constant peripheral motion is fatiguing. | Overview. | Pulse only the 6px live dot; static icon + color for the rest. |
| F3 | 🟡 | Hover/press inconsistency: cards translate on hover in some places only; no pressed states in student portal (globals has `.btn-primary:active` scale — unused here). | CSS. | Interaction spec: card hover = shadow+border (no translate on mobile), button press = scale .98, all 150–200ms. |
| F4 | 🟡 | No `prefers-reduced-motion` handling anywhere. | CSS grep. | Global media query kills transitions/pulses for opt-out users. |
| F5 | 🟡 | KPI values appear instantly; no count-up or fill-in on load (skips a free "aliveness" moment). | Overview/analytics. | Count-up (300ms) on KPI values + width-fill on progress bars when data arrives. |

### G. Component states: loading / error / empty / feedback

| # | Sev | Finding | Evidence | Prescription |
|---|-----|---------|----------|--------------|
| G1 | 🔴 | **No shared state system.** Overview has skeletons; tests/results/courses/analytics each hand-roll different loaders; runner uses a full-screen spinner. | Page code. | One `<Skeleton/>` + page-level skeleton variants; one `<ErrorState/>` with retry; one `<EmptyState/>` with icon + one-liner + next action. |
| G2 | 🟠 | Error cards render raw internal errors to students (`{error}` shown, e.g. HTTP statuses). Alarm-red styling for what's often a soft failure. | Overview/runner error UIs; timetable fails silently (400s) with *no* error UI at all. | Friendly copy + retry; log details to console/monitoring, never render. Every async section gets a visible failure state (timetable currently hides it). |
| G3 | 🟠 | **Zero toast/feedback in the student portal** (admin pages each hand-roll one; students get silent actions). | `grep toast` → student portal none. | One lightweight toast provider (Design A style) for ask-doubt submitted, profile saved, payment fallbacks, etc. |
| G4 | 🟡 | Empty states are text boxes; only Overview's has a CTA. | Courses/tests/results. | Every empty state = illustration/icon + one human line + one action (Overview's pattern, standardized). |
| G5 | 🟡 | Dead components: `StudentNotificationCenter`, `StudentSidebar`, `StudentHeader`, `StudentConfirmDialog`… unwired. Notification badge hooks exist but no surface. | Component grep. | Either wire notifications into the header bell (they're built!) or delete; recommend wiring — it feeds the daily loop. |

### H. Content & microcopy

| # | Sev | Finding | Evidence | Prescription |
|---|-----|---------|----------|--------------|
| H1 | 🟠 | Admin-panel vocabulary addressed to students: "Academic Performance Snapshot", "Mock Tests & Examination Center", "Completed Evaluations", "Batch Percentile Benchmark". | Overview, tests. | Coach voice (calm, warm, plain): "Your week at a glance", "Mock tests", "Tests you've taken". Full microcopy table goes in the PRD. |
| H2 | 🟠 | Inconsistent title case and CTA naming for identical destinations: "Explore Catalog" / "Explore Courses" / "All Courses →" on one screen. | Overview. | One action = one label, repo-wide glossary in PRD. |
| H3 | 🟡 | Zeros shown as failure: "Average Score 0%" with no data (analytics correctly shows "—"). | Overview KPIs. | "—" until data exists; never render 0 as an achievement metric. |
| H4 | 🟡 | Dead-end copy: "Contact your academic administrator to enroll" — no link, no path. | Overview empty courses. | Link to catalog + demo-class + support contact. |
| H5 | 🟡 | Doubt flow sets no expectations (no SLA hint, no success confirmation moment). | Ask-doubt modal. | On submit: success toast + "Faculty typically reply within X hours" (get the real SLA from you). |

### I. Data visualization (analytics)

| # | Sev | Finding | Evidence | Prescription |
|---|-----|---------|----------|--------------|
| I1 | 🟠 | Dark slate-900 chart card inside the light Design A page — the single most jarring element in the portal. | Analytics hero. | Re-skin in Design A: white/paper card, brand line, ink text; keep the chart itself (it's a good hand-rolled SVG). |
| I2 | 🟠 | Tooltip is a detached drawer *below* the chart; hover-only (unusable on touch); X axis unlabeled. | `ScoreTrendCard`. | Anchor tooltip to the point (flip within bounds); add tap support; label first/last dates. |
| I3 | 🟡 | "Weak" defined inconsistently: analytics flags <50% (weak chapters), overview flags <60%. Two sources of truth. | Code thresholds. | One rubric (<60% focus, 60–80 steady, ≥80 mastered) everywhere. |
| I4 | 🟡 | Subject icons are emoji (A4); segmented bars have no labels until hover. | Analytics subject cards. | Phosphor icons; inline counts under segments. |

### J. Flows (journey-level)

| # | Sev | Finding | Evidence | Prescription |
|---|-----|---------|----------|--------------|
| J1 | 🔴 | **Test-card state is communicated only by a small button** — 4 same-weight actions (Start/Resume/View Result/Retake) across 20 cards = scan cost. | Overview + tests hub. | Card-level state system: banner strip per state (Available → brand / In progress → sky "Resume at Q12" / Evaluated → mint + score / Locked → sand + unlock time) with ONE primary action. |
| J2 | 🟠 | Purchase → activation failure path silently "succeeds" and dumps the student on Overview if enrollment polling times out — no "we're confirming, we'll notify you" state. | `PaymentModal` handler fallback. | Honest pending state + notification/toast + auto-verify on next visit. |
| J3 | 🟠 | Post-purchase there's no first-run moment inside the product (no "start with Chapter 1", no checklist for a brand-new student). | Payment success → course detail. | First-run checklist on Overview (new-student cohort): watch first lecture, attempt first test, ask first doubt — each a one-tap card. |
| J4 | 🟡 | Login always lands on `/student/overview` with no continuity ("next" param exists but only for post-purchase redirects). | Auth shell. | Land on Today (C1) which *is* continuity; deep-link from marketing CTAs via `next`. |
| J5 | 🟡 | Doubt asking from content exists via URL params (smart!) but nothing in content UI promotes it ("Ask a doubt about this lecture" entry points missing). | Doubts service params vs content pages. | Contextual ask buttons on player/PDF/test-review that deep-link with prefill. |

### K. Test runner vs NTA conventions (per your "NTA-familiar, our skin" decision)

**Already right:** palette with color legend, section tabs, mark-for-review, submit/quit confirms, calculator, auto-submit on time-up, save-status indicator, fullscreen + tab-switch guards.
**Gaps to verify/fix in PRD:** "Save & Next" / "Clear Response" / "Mark for Review & Next" naming parity; palette must match NTA color semantics (green answered, purple/orange marked, red not-answered — currently custom colors); timer must shift color in the last 5 minutes; question counter "Question 12 of 90"; **mobile runner strategy (E6)**; paper-like reading typography for question stems (long-form physics stems at current sizes will strain).

### L. Engineering hygiene that undermines design

| # | Sev | Finding | Evidence | Prescription |
|---|-----|---------|----------|--------------|
| L1 | 🔴 | **406 on `teacher_details` from every page** (auth hook queries teacher table for every student) + **400s on `batch_subject_mock_tests` embed (timetable, 8×)** + **400s on `institutes` (profile)**. Students silently get degraded data; console spam on every page. | `netlog.mjs` output. | Fix the auth hook (role-aware lookup), fix the two broken queries. *Not design work, but it's on the critical path for the redesign — flagging prominently.* |
| L2 | 🟠 | No Tailwind↔token bridge (root cause of A1); no lint guard against raw slate/hex in student scope. | Configs. | `@theme` bridge + ESLint `no-restricted-syntax` rule for `text-slate-`/`bg-slate-`/`bg-sky-`/`bg-indigo-`/hex in `src/app/student/**`, `src/components/student/**`, `PaymentModal`. |
| L3 | 🟡 | Dark-mode variant hook defined; nothing implemented (fine — out of scope this pass, but keep the hook). | `globals.css`. | Leave as Phase 2 marker. |
| L4 | 🟡 | Dead code cluster (G5) inflates the bundle and confuses contributors. | Components. | Delete or wire. |

---

## 4. Prioritized roadmap

**Phase 0 — Foundation (do first; everything else sits on it)**
1. Tailwind `@theme` bridge of Design A tokens + delete legacy globals tokens (A1, A5, L2)
2. Font diet: Manrope + DM Sans only (A2)
3. Type-scale tokens + 12px floor + lint rule (B1, B2)
4. Touch-target pass ≥44px + sticky-offset `--shell-offset` fix (E1, E2)
5. Shared Skeleton/ErrorState/EmptyState/Toast primitives (G1–G3)
**Exit criteria:** no slate/sky utilities in student scope; no sub-12px text; no interactive element <44px; no sticky seam; console clean of the 406.

**Phase 1 — The daily loop (north star)**
6. Overview → "Today" rebuild: resume strip, today's schedule, tests due, compact stats (C1, H1, H3)
7. Nav IA: sub-nav regrouping + badge counts + mobile bottom-nav decision (C2, C6, E5)
8. Test-card state system (J1)
9. Wire notifications bell (G5)
**Exit criteria:** a returning student reaches *an actionable next step in ≤1 tap from landing*; state of every test readable without reading buttons.

**Phase 2 — Learning surfaces**
10. Analytics re-skin (I1, I2, I3) + Results simplification (C4)
11. Doubts polish + contextual ask entry points (H5, J5)
12. Timetable real-data fix + design pass (L1, G2)
13. Subject workspace & recordings passes (mobile ergonomics, player UX)
**Exit criteria:** every learning surface on Design A, one "weak" rubric, zero silent failures.

**Phase 3 — Test runner & purchase**
14. NTA-parity audit of runner naming/colors + question-stem typography; mobile runner strategy (K, E6)
15. Payment modal re-skin + honest pending state (A1, J2)
16. First-run checklist for new students (J3)
**Exit criteria:** runner feels familiar to NTA aspirants; a purchase always ends in a clear, truthful state.

**Phase 4 — Polish & motion**
17. Framer Motion entrance/stagger/progress system + reduced-motion (F1–F5)
18. Microcopy glossary sweep (H1, H2), radii/shadow enforcement (A3, A6)
19. Footer logged-in variant, a11y keyboard details (C5, D4)

---

## 5. Instrumentation artifacts
- `scripts/design-audit/shots/` — 31 screenshots (desktop + mobile, incl. dropdown/menu/modal open states) + `manifest.json` with per-page console errors
- `scripts/design-audit/measurements.json` — per-page quantitative data (tap targets, font sizes, colors, radii, sticky geometry, overflow)
- `scripts/design-audit/{audit,measure,netlog}.mjs` — rerunnable: `node scripts/design-audit/audit.mjs` etc.

*Next step: the PRD (detailed, decision-by-decision, per your requirement) before any code change.*
