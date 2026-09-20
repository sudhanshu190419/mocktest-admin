# PRD — MakeMeTopper Student Experience Redesign
**Status:** Approved v1 · **Date:** 2026-09-19 · **Scope:** everything a student touches (student portal, shared shell, storefront pass-through, checkout, test runner)
**Companion evidence:** `Student_Portal_Design_Review.md` · `scripts/design-audit/measurements.json`
**Decisions locked with owner:** Unify under Design A · 50/50 device split (responsive parity is first-class) · Calm coach personality · Light mode only this pass · NTA-familiar runner with our skin · Mobile bottom bar · Full responsive runner · Wire notifications · North star = **daily/weekly learning engagement**

---

## 1. Purpose & North Star

**Problem.** The student portal is functionally complete but visually split across three dialects, ergonomically hostile on touch (72–92% of interactive elements below 44px on mobile), and organized as an admin dashboard rather than a daily companion. Silent data failures (406/400) degrade pages without telling anyone.

**North star metric.** *Daily/weekly learning engagement* — students returning daily to study, watch, practice. Secondary: test completion rate, doubt resolution time, purchase→activation rate.

**Definition of success (measurable).**
- A returning student reaches an actionable next step in **≤1 tap** from landing on `/student/overview`.
- Zero interactive elements under 44px hit-height on mobile; zero text under 12px in student scope.
- Every async section has designed loading, error, and empty states; zero silent failures.
- Console free of the 406/400 regressions (engineering gate, see §10).

**Non-goals this pass.** Dark mode (Phase 2, enabled by token work), admin/teacher surfaces, backend feature changes (only the listed data-layer fixes), marketing site redesign beyond consistency fixes students pass through.

---

## 2. Design principles ("calm coach")

1. **Today, not everything.** Every screen answers "what should I do next?" before "what exists?"
2. **One identity.** Design A tokens are the only source of visual truth. No orphan palettes.
3. **Thumb-first.** Designed at 390px first, enhanced at 1440px. Every target ≥44px.
4. **Readable under fatigue.** 12px absolute floor; body 14px+; contrast ≥4.5:1 for text.
5. **Quiet energy.** Motion is short (150–300ms), eased, purposeful — progress, reveal, guidance. Never playful, never perpetual.
6. **Honest states.** Loading is shaped, errors are human with a retry, empty states teach, zero-value shows "—", never "0%".

---

## 3. Foundation: tokens & typography (Phase 0)

### 3.1 Tailwind theme bridge
Bridge Design A into Tailwind v4 `@theme` (globals-level) so utilities exist and utilities *replace* all slate/sky/indigo in student scope:

```css
--color-brand: #2458d3;         --color-brand-hover: #1943a6;
--color-ink: #152b45;           --color-ink-secondary: #51637a; /* darkened muted, ≥4.5:1 */
--color-paper: #f3f8fc;         --color-line: #d9e3ed;
--color-sky: #dcecf8;           --color-mint: #dcefe8;   --color-mint-ink: #285e50;
--color-apricot: #ffd7b7;       --color-lilac: #e9e6f6;  --color-lilac-ink: #57507d;
--color-sand: #f7e9d7;          --color-sand-ink: #7c4c26;
--color-success: #10b981;       --color-danger: #dc2626;
--radius-field: 10px; --radius-card: 18px; --radius-sheet: 24px;
--shadow-card: 0 8px 28px #19385508; --shadow-hover: 0 18px 45px #19385512;
```
- Radius set is exactly 3 values + pill; all `rounded-*` ad-hoc values replaced.
- One card spec: white surface, 1px `line`, `shadow-card`. Tinted backgrounds only for semantic moments (focus areas, live class, success).
- Delete legacy `globals.css` tokens (`--color-primary-*`, `btn-*`, bezels, `--font-sans` Outfit). Keep dark-variant hook as Phase 2 marker.
- **Lint gate:** ESLint `no-restricted-syntax` banning `text-slate-*`, `bg-slate-*`, `bg-sky-*`, `bg-indigo-*`, `text-[10px]`, `text-[11px]`, and raw hex `#2563eb`-style literals in `src/app/student/**`, `src/components/student/**`, `src/components/marketing/PaymentModal.tsx`.

### 3.2 Type system
Fonts: **Manrope** (display/headings) + **DM Sans** (body/UI). Remove Geist, Geist Mono, Jakarta, Inter, Outfit.
Scale (size/line-height): display 32/40 · h1 24/30 · h2 20/28 · h3 16/24 · body 14/22 · meta 13/18 · caption 12/16. Letter-spacing ≤ −0.02em below 20px. `tabular-nums` wherever numerals render. Dates via one `formatDate/formatTime` util, `en-IN`.

---

## 4. Shell & navigation

### 4.1 Structure (three layers, clear jobs)
- **Header (global):** logo, catalog links, avatar menu. Mobile: 56px compact variant.
- **Section nav (desktop ≥1024px):** pill sub-nav, regrouped — primary: Overview · Courses · Classes · Tests · Doubts; secondary (moved into avatar menu AND kept accessible): Recordings · Timetable · Results · Analytics · Profile. Pill hit-height 44px; scroll strips get mask-gradient edge fade + ≥24px next-item peek. Active state: sky tint + brand text + dot; animated via shared layout id (see §8). Count badges (apricot tint, ink text) on Tests (due this week) and Doubts (open).
- **Mobile (<1024px): top strip removed; persistent bottom bar** with 4 primary destinations — Today · Courses · Tests · Doubts — each 56px hit height, icon + 11px label, active = brand icon + label, safe-area-inset padding. Remaining sections live in the avatar menu + in-context links. Sub-nav element renders nothing on mobile.
- **Breadcrumbs:** depth-only, hidden on mobile, root always "My Learning" → section → page.

### 4.2 Sticky seam fix
Header height is measured (ResizeObserver) into `--shell-offset` CSS var; any sticky element consumes it. Deletes the 65-vs-70px magic numbers. Verify no seam at 320/390/768/1024/1440.

### 4.3 Footer
Logged-in variant: support links, catalog links, version + help. No "Student login" CTAs to signed-in users.

---

## 5. Overview → "Today" (Phase 1 flagship)

Rebuild `/student/overview` as the daily companion, in this order:
1. **Resume strip** (the hero): at most 3 one-tap cards — *in-progress test* ("Resume Physics Mock — Q12, 22:14 left"), *next class today* (time + Join), *continue last lecture* (chapter + progress bar). If none, show next best action. No generic greeting paragraph; name appears once, compactly ("Good evening, Amar" style, time-of-day aware).
2. **Today's schedule:** timetable entries for today only (pulls from timetable source once §10 fix lands).
3. **This week's tests:** assigned tests due, using the state-card system (§7.3).
4. **Momentum, compact:** 2–3 stats max (streak of active days if derivable, avg score, open doubts) — the full dashboard lives in Analytics. Zero-values render "—".
5. **Focus areas:** keep, but retitled "Worth practicing" with the coach voice and one rubric (§9.1).

**Acceptance:** from `/student/overview`, resume an in-progress test in 1 tap; schedule for today visible without scroll on mobile; no "Academic Performance Snapshot" copy anywhere.

---

## 6. State & feedback systems (Phase 0 primitives, applied everywhere)

- `<Skeleton/>` + per-page skeleton layouts (Overview's is the reference shape).
- `<ErrorState/>`: icon + human line ("Couldn't load your timetable") + Retry. Raw errors/statuses go to console/monitoring, never the UI. Every async section must render a failure state — timetable and profile 400 paths included.
- `<EmptyState/>`: icon + one human line + one action button.
- **Toast provider** (Design A style, bottom-center on mobile / top-right desktop, 4s, dismissible) for: doubt submitted, profile saved, test submitted, payment pending/failed notifications. No toasts for navigation or destructive-confirmation flows.
- Feedback for every mutation a student triggers. No silent success/failure anywhere.

---

## 7. Learning surfaces

### 7.1 Courses & subject workspace
- Course cards on Design A; progress bars animate on load; lecture lists get 44px rows.
- Subject workspace: mobile gets a segmented top area (curriculum as a sheet/drawer, player primary); desktop keeps 3-pane. Doubt button visible next to every content item (deep-links to ask-doubt with context params already supported).

### 7.2 Doubts
- Hub on Design A; stats row uses "—" when empty; ask modal keeps context prefills, adds SLA line ("Faculty typically reply within ___" — **owner to supply real SLA before shipping**) and success toast.
- Status vocabulary: Open → "Waiting on faculty", In progress → "Faculty is on it", Resolved → "Resolved".

### 7.3 Tests & the test-card state system
Every test card communicates state with a **left border strip + label + exactly one primary action**:
| State | Strip | Label | Primary action |
|---|---|---|---|
| Upcoming | sand | "Opens {date}" | Remind/none |
| Available | brand | "Ready when you are" | Start Test |
| In progress | sky | "Resume at Q12 · 22:14 left" | Resume |
| Submitted | mint | "Score 214/300 · 71%" | View Result |
| Evaluated+retake allowed | mint | score | View Result (Retake as tertiary) |
| Limit reached | line | "Attempts used" | View Result |
| Expired | line | "Closed {date}" | View paper (if permitted) |

### 7.4 Results & Analytics
- Results page = list of scorecards only; aggregate metrics move to Analytics; cross-link both ways.
- Analytics re-skin: all cards on Design A (dark slate-900 chart card becomes white/paper with brand line). Score-trend: anchor tooltip to the data point (flips in-bounds), tap support on touch, first/last date labels. Subject cards: Phosphor subject icons (no emoji), inline counts under segmented bars.
- **One rubric everywhere:** <60% = worth practicing · 60–80% = steady · ≥80% = mastered. Overview and analytics share it.

---

## 8. Motion (Phase 4, after structure)

One shared preset file. All motion 150–300ms, `cubic-bezier(0.16,1,0.3,1)`.
- Page sections: fade+8px rise on first paint, 40–60ms stagger on card grids.
- Progress bars & KPI values: fill/count-up (300ms) when data arrives.
- Sub-nav active state + bottom bar: shared-layout indicator slide.
- Tab/accordion: height-aware reveals.
- Live state: only the 6px dot pulses. Nothing else loops.
- `prefers-reduced-motion`: global kill-switch (transitions → opacity-only, no loops).
- Button press: scale 0.98. Card hover: shadow+border change only (no translate on touch).

---

## 9. Test runner (Phase 3)

### 9.1 NTA-parity conventions (our skin)
- Buttons named exactly: **Save & Next** · **Mark for Review & Next** · **Clear Response** (verify current names against these).
- Palette state colors match NTA semantics: answered = green, marked = purple/orange, not-answered = red, unseen = neutral — rendered in Design A tints with a visible legend.
- Timer: neutral → amber at ≤5 min → red at ≤1 min (non-pulsing color shift + subtle tick at each threshold).
- "Question 12 of 90" counter always visible; question stem typography on the reading scale (16/26 body for stems; options ≥44px hit rows).

### 9.2 Responsive runner (decided: full)
- <1024px: question area primary; palette in a **bottom sheet** (drag handle, counts in header); actions docked bottom with safe-area padding; calculator as sheet; submit/quit confirms unchanged.
- No feature loss vs desktop; same session/resume machinery.
- Runner remains a distraction-free surface (sub-nav/bottom-bar hidden, per existing pattern).

### 9.3 Guards & submission
Keep existing engineering (server timer, persistence queue, auto-submit). Design the SubmissionOverlay in Design A with honest stage labels ("Saving answers → Evaluating → Results"). Already-submitted and error screens get EmptyState treatment.

---

## 10. Engineering gates (must land with/before design phases)

1. **Auth hook:** stop querying `teacher_details` for student sessions (406 on every page). Role-aware profile lookup only.
2. **Timetable query:** fix `batch_subject_mock_tests` embed (400 ×8) so today-schedule data exists for §5.
3. **Profile query:** fix `institutes` 400s.
4. Payment modal: re-skin with Design A brand (`#2458d3`), and the **pending-grant honesty fix** — if enrollment polling times out, show "Payment received — confirming enrollment" state + toast, never a false success redirect.
5. Wire **notification bell** into the shell (existing `StudentNotificationCenter` + dispatch pipeline): test released, doubt resolved, class starting soon, enrollment confirmed. Unread dot on bell; list panel as sheet on mobile. Dead components (`StudentSidebar`, `StudentHeader`, `StudentConfirmDialog`) deleted if not adopted.

---

## 11. Microcopy glossary (calm coach voice)

| ❌ Current | ✅ Standard |
|---|---|
| Academic Performance Snapshot | Your week at a glance |
| Mock Tests & Examination Center | Mock tests |
| Completed Evaluations | Tests you've taken |
| Batch Percentile Benchmark | Class percentile |
| Target Focus Areas (<60% Accuracy) | Worth practicing |
| Unable to Load Student Dashboard | Couldn't load your dashboard — let's try again |
| Initiate Attempt / Attempt State | Start test / Resume |
| Contact your academic administrator | Link: explore courses + message support |

One action = one label repo-wide ("View results" — never alternate with "Check scorecard"). Numbers: "—" over 0 until data exists. Ordinals via helper (1st/2nd/3rd/85th + "percentile").

---

## 12. Execution plan & exit criteria

| Phase | Contents | Exit criteria |
|---|---|---|
| **0 Foundation** | §3 tokens+lint, fonts, §6 primitives, §4.2 seam fix, touch-target pass, §10.1–10.3 data fixes | Lint passes with zero banned patterns; no <44px targets on mobile; no <12px text; no sticky seam; console clean of 406/400 |
| **1 Daily loop** | §5 Today, §4 nav+bottom bar, §7.3 test cards, bell wired (§10.5) | 1-tap resume from overview; every test card state readable without reading buttons |
| **2 Learning surfaces** | §7.1, §7.2, §7.4, timetable design pass | Every learning surface on Design A; one weak-rubric; zero silent failures |
| **3 Runner & purchase** | §9, §10.4 payment | Runner NTA-parity checklist green on desktop + mobile; purchase always ends in truthful state |
| **4 Motion & polish** | §8, glossary sweep, footer variant, keyboard details | Motion spec implemented with reduced-motion opt-out; glossary applied repo-wide |

**Per-phase process:** implement → run `scripts/design-audit/measure.mjs` + screenshot diff → verify exit criteria with owner → proceed. Mock data generation (single course + PYQ) to be done **after Phase 2** for a realistic full-journey validation pass, per owner.

**Out of scope, queued:** dark mode (Phase 2 of product, unlocked by §3), marketing storefront deeper redesign, teacher/admin surfaces.
