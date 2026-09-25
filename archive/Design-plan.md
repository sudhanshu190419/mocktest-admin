# Student Experience Redesign — Implementation Design Plan

**Repo:** `D:\MMT-web\mocktest-admin` (Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4 CSS-first, Redux Toolkit + TanStack Query, Supabase)
**Scope:** Student-facing experience ONLY (marketing/storefront, `/student/*` portal, shared shells they touch). Admin/teacher code is out of scope and must not be modified.
**Baseline:** Design review composite **52.4/100, grade F** — must-fix items are enumerated below and each is wired to a phase.
**Design authority:** `src/design/tokens.css` (Design A). Rules applied: 12px font floor / 14px body default, no gradient text, no side-stripe card borders, one focus treatment, one color system, motion 150–300ms ease-out, labeled inputs, ≥44px touch targets, non-color status cues.

---

## 1. Executive summary

This plan unifies every student-visible surface behind **one design language** (Design A tokens), **one navigation system** (desktop refined top nav + a single mobile bottom nav below 1024px), and **one set of shared UI primitives** (one Button, one Card, one focus ring, one custom icon set). It fixes every must-fix item from the 52.4/100 review, restructures the learning center and tests flow around actual purchase/assignment state, adds a designed `/blog` announcement, separates student-owned files from admin/teacher-shared files, removes confirmed dead code, and archives superseded root docs.

**Explicitly out of scope (backend):** anything requiring new tables, endpoints, or migrations — including the flagged `/student/tests/[testId]` 406. The only approved data addition is a **read-only frontend hook over the existing `student_pyq_purchases` table**, modeled on the existing read at `src/services/student/studentTestWebService.ts` (line ~460) and `src/services/student/paymentService.ts` (line ~238). All backend-bound items live in §13.

**Non-negotiable decisions baked in (user-confirmed):**
1. One unified theme for all student-visible elements — **sole exemption:** desktop card design for courses + PYQ packages keeps its current look; their **mobile** cards get themed (§5).
2. Mobile bottom navbar everywhere students go, **&lt;1024px only**; desktop keeps the top navbar; portal + marketing unified into one system (§3).
3. Storefront stays visible to all; guest click on enroll/buy → `/login` first — flow unchanged (§5).
4. Purchase-aware cards & detail pages: purchased course never shows "Enroll"; PYQ copy "Enroll" → **"Buy" / "Purchase Package"** (§5).
5. Home hero removed section + 5 purchase-state hero variants (§4).
6. Learning center = `/student/overview` + `/student/courses`, redesigned across 4 purchase states, no barren empty pages (§6).
7. Course-assigned tests live inside course detail; `/student/tests` keeps standalone mock + PYQ tests in separate sections (§7).
8. New `/blog` route with designed coming-soon; fix dead blog links (§8).
9. Custom SVG icon set replacing generic Phosphor usage in nav/empty-states/key motifs; anti-slop banner audit (§2, §4, §9).
10. Archive 23 root `.md` files + `client_reuirement.txt` to `/archive`; one new consolidated student design doc written at the end (§11).
11. Dead-code removal incl. `motion.ts` decision (recommendation: **adopt**, §2/§10).
12. Student-owned file separation from admin/teacher-shared files (§10).

**Implementation:** 9 phases (§12), ordered foundation → navigation → home → storefront → learning center → tests → blog → a11y/motion polish → cleanup/docs. Every phase has exact file paths, tasks, and verifiable acceptance criteria.

---

## 2. Unified design language spec

### 2.1 Tokens — single source of truth
- **Only color/spacing/radius source:** `src/design/tokens.css` (Design A). `src/app/globals.css` keeps only `:root` brand aliases that delegate to token vars; no new color literals anywhere in student code.
- All student CSS files (`src/app/student/student.css`, `src/app/courses/courses.css`, `src/app/auth/auth-preview.css`) switch raw hex/rgb values to `var(--…)`. Charts in `src/app/student/analytics/page.tsx` replace raw hex (`#2563EB`, `#059669`, `#E2E8F0`, `#94A3B8`) with token vars + add no-data legends and accessible labels (audit finding 21, 16).
- **Three color systems → one:** merge the token palette, `globals.css` brand aliases, and ad-hoc colors in `student.css`/`courses.css`/`auth-preview.css` into `tokens.css`. Duplicated `@keyframes fadeUp` (defined in ≥3 student CSS files) collapses into one definition in `tokens.css`-adjacent motion block.

### 2.2 Type scale — enforce the 12px floor
- **Floor:** no `font-size` below `12px`; **body default 14px**; marketing body 16px.
- Fix all **46 sub-12px declarations** (audit finding 6), worst offenders first: `courses.css:866` (5px), `:862`/`:847` (8px), `:835`/`:839` (10px), `:155` (11px), plus `:156,159,162,164,174,177,180,184,194,198,201,220,475,476,479,480,483,643,645,779,780,793,804,805,810,812,848,852,865,877,958,1017,1023,1104,1126,1151,1163,1172,1277,1374,1415,1443,1447`; `student.css:648,703,713,876,1157,1225`; `auth-preview.css:190,226,464,473,539,568,642`.
- Replace with named steps from `tokens.css` (e.g. `--fs-xs: 12px`, `--fs-sm: 13px`, `--fs-base: 14px`, `--fs-md: 16px`, `--fs-lg: 18px`, `--fs-xl: 22px`, `--fs-2xl: 28px`, `--fs-hero: 40px` → clamp on mobile).
- Specific collisions: `OVERALL SYLLABUS PROGRESS` label/value collision (audit finding 12) → stack label above value at ≤600px, and cap label width with `min-width: 0` + wrap; raw ISO dates on test cards (finding 10) → formatted dates (§9.6).

### 2.3 ONE Button family
- **Current:** `src/components/ui/mmt/Button.tsx` (3 variants) + `ButtonGhost` + marketing inline buttons + `store-*` buttons + auth buttons (finding 19).
- **Target:** keep `src/components/ui/mmt/Button.tsx` as the single primitive, but **move a student-owned copy to `src/components/student/ui/Button.tsx`** (§10) with variants: `primary | secondary | ghost | danger`, sizes `sm | md | lg`, `fullWidth` prop. Minimum height 44px (md/lg), 36px (sm) with ≥44px hit area via padding on touch.
- All student/marketing call sites migrate to it; raw `<button>`/`<a>` styled as buttons in student CSS get replaced (catalog desktop card CTAs exempt only in visual treatment, not in using the primitive).

### 2.4 ONE Card family
- **Current:** `src/components/ui/mmt/Card.tsx` + marketing `store-card`/pyq card + auth preview card + dead `Card.tsx` orphans (finding 19).
- **Target:** `src/components/student/ui/Card.tsx` with slots: `CardHeader`, `CardBody`, `CardFooter`, `CardMedia`, `CardBadge`. Radius/border/shadow from tokens.
- **Exemption (user decision 1):** the **desktop** look of course cards (`StoreCourseCard.tsx`) and PYQ package cards (`PYQCatalog.tsx`) keeps its current visual design — but rebuilt on the Card primitive's tokens so it can't drift. Their **mobile (≤768px)** presentations get the unified themed treatment.

### 2.5 ONE focus treatment
- **Current 4 treatments:** `courses.css:52`, `auth-preview.css:37`, `globals.css:126` (button only), Tailwind `focus-visible:ring-*` scattered (finding 20).
- **Target:** single global rule in `globals.css`:
  `:where(a, button, input, select, textarea, [tabindex]):focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }` using the token from `tokens.css`.
- Delete the other three; replace `focus-visible:ring-*` utilities with the inherited outline in student files (or keep ring only where outline can't render — canvas/video — and document it).

### 2.6 Motion spec + `motion.ts` decision
- **Recommendation: ADOPT `src/lib/motion.ts` as the real motion system** (it has 0 importers today; adopting is cheaper than deleting+reinventing and gives us the required single vocabulary).
  - Keep easing/duration constants; **change defaults to the 150–300ms band**: `duration.fast = 150ms`, `duration.base = 200ms`, `duration.slow = 300ms` (current `0.7s`/`0.8s` entrance values are the source of the 603ms/999ms offenders).
  - Re-map `duration.emphasis = 300ms` (was 700ms) — no student animation may exceed 300ms.
  - Export `fadeUp` tuned to 200ms/12px offset, `stagger` helpers, and a `prefers-reduced-motion` guard (`prefersReducedMotion()` returning duration 0).
- Fix offenders: `.store-reveal .65s` (`courses.css:244`), `courses.css:911` (0.7s), `courses.css:976` (0.9s), `.store-hero-card > *` 0.8s/0.7s/0.6s (`courses.css:1347–1349`), `hero-carousel` 0.9s/0.7s/0.6s, `.marketing-anim-fade-up .8s`, `.marketing-reveal-slow 1s`, `.store-float-slow 12s` infinite (finding 14).
- All entrance animations fire once (IntersectionObserver already used by `.store-reveal` — keep, retime), never infinite except a single subtle hero ambient (≤12s opacity pulse, disabled under reduced motion).
- CSS transitions in student files: clamp every `transition`/`animation` duration to `150–300ms` (audit found values from 0.1s to 1.2s).

### 2.7 Custom icon set
- **New file:** `src/components/icons/student-icons.tsx` — hand-drawn, 24×24 viewBox, `stroke="currentColor"`, `stroke-width="1.75"`, `fill="none"`, consistent 2px corner radius, `aria-hidden="true"` by default with optional `title` prop.
- **~20 icons required:** `IconHome`, `IconStore`, `IconLibrary` (courses), `IconTest` (clipboard-check), `IconPyq` (archive-doc), `IconDoubt` (chat-question), `IconProgress` (chart-bars), `IconBookmark`, `IconPlay`, `IconLock`, `IconCheck`, `IconSearch`, `IconFilter`, `IconCalendar`, `IconClock`, `IconArrowRight`, `IconArrowLeft`, `IconClose`, `IconMenu`, `IconUser`, `IconBag` (purchases), `IconSpark` (streak), `IconEmptyBox` (empty states), `IconLifeBuoy` (help).
- **Replacement policy (anti-slop):** Phosphor (`@phosphor-icons/react`) is removed from: bottom nav (`StudentBottomNav.tsx`), sub-nav, marketing header (`CourseStoreShell.tsx`), footer (`SiteFooter.tsx`), empty states, store filters, avatar menu, test cards, blog. Phosphor may remain **only** in admin/teacher code (untouched) and in dense third-party-like contexts explicitly listed in §9.7 (none planned for student UI → effectively full removal from student surfaces across the 67 importing files' student-side usages).
- Icon usage rule: every icon-only control gets `aria-label` + visible tooltip on hover/focus (finding 9: bare icon-only controls; 7 unlabeled search inputs get `aria-label="Search courses"` etc. + visible label or placeholder+icon pattern).

### 2.8 Anti-AI-slop banner/hero audit list (remove or justify)
Remove/replace in `MarketingHomeView.tsx` + home CSS:
- Section **"A NOTE FOR YOUR STUDY DESK / Small steps. A clearer direction."** (lines 396–436) — **delete entirely** (user decision 5).
- Generic gradient blobs / decorative orbs behind hero; floating "bubble" decorations; oversized empty whitespace bands before `SiteFooter` (finding 22) — collapse section padding to a single rhythm (`--space-section: 72px` desktop / `48px` mobile).
- Repetitive "banner strip + icon + two lines" filler blocks: FreeDemo and AppShowcase get content-specific redesigns (§4.3) rather than deletion.
- Clipped OFF burst stickers: `.store-card__promo`, `.pyq-package__promo` → `overflow: visible` on the card, sticker positioned inside safe bounds, `transform: scale()` capped so it never clips at 375/600/768 (finding 11).
- Home hero burst text **"Real exam pattern"** currently covered by hero card → hero grid gives burst its own layer/row (§4.2).

---

## 3. Navigation architecture

### 3.1 Desktop top navbar (≥1024px)
- Keep `CourseStoreShell.tsx` header as the one desktop nav. Refine: logo left; primary links (Home, Courses, PYQ, Tests-for-guests→ store? no — see below); right cluster: search icon (labeled), notifications bell (students only, unread badge via the bell's own `['student-notification-unread']` query — NOT `useNavBadgeCounts`, see §3.4), avatar menu.
- **Links:** Home `/`, Courses `/courses`, PYQ `/pyq`, Blog `/blog`, Help `/#contact`. For logged-in students also: Portal `/student/overview` (primary CTA button "My learning").
- **Avatar menu (simplified):** today it's a multi-section dropdown (student identity, "Admin dashboard", "Teacher dashboard", portal links). Student-facing version keeps: identity row (name+email), My learning `/student/overview`, My tests `/student/tests`, My purchases (→ `/student/courses` §6), Contact, Sign out (existing `SignOutButton` behavior inline). **Admin/Teacher dashboard entries show only when `role` allows** — component refactored but admin/teacher routes untouched.
- Remove `StudentHeader.tsx` (dead) — no revival (§10).

### 3.2 Mobile unified bottom nav (&lt;1024px) — user decision 2
- **Single component:** evolve `src/components/student/StudentBottomNav.tsx` into the one system used by **all** student-reachable routes: home `/`, storefront `/courses`, `/pyq`, `/blog`, and portal `/student/*`.
- **Items (5):** Home `/`, Courses `/courses`, Tests `/student/tests`, PYQ `/pyq`, Me `/student/overview` (avatar/profile). Badges via existing `useNavBadgeCounts()` (tests due, doubts count) on Tests item.
- **Behavior:**
  - Rendered for **logged-in students only** on portal routes (as today) **and** for logged-in users browsing marketing/storefront below 1024px.
  - **Guests below 1024px get a hamburger menu** in `CourseStoreShell` (today hamburger exists only ≤600px at `courses.css:613` `.store-menu-toggle`; extend to ≤1023px). Rationale: bottom nav for guests would promote portal destinations they can't access; guests see a drawer with storefront links + "Sign in".
  - Hides on `/student/runner/*` (test runner) and live-class rooms (current `hideOnPaths` logic in `StudentBottomNav`), plus `/student/live-classes/[id]`.
  - Height 64px + `env(safe-area-inset-bottom)`; page content gets matching `padding-bottom` so nothing is occluded; z-index below modals, above content.
- **`StudentSubNav.tsx` fate:** DELETE. It is the "floating pill nav" from finding 5 (5 items: Today, My Learning, Calendar, Tests, Doubts) that overlaps the sidebar "Need help?" card at 1280 and collides with the footer. Its destinations redistribute: Today→bottom-nav Me/overview, My Learning→`/student/courses`, Tests→`/student/tests`, Calendar & Doubts→links inside the overview page header row (§6). Remove `.student-subnav` CSS (`student.css`) and its wrapper in `src/app/student/layout.tsx`.
- Desktop sidebar on `/student/*` (rendered inside portal layout): **keep** (it's the desktop nav counterpart per user decision), restyle with tokens, ensure its "Need help?" card has top margin ≥24px from where the pill used to sit; verify at 1024 & 1280.
- Sub-page horizontal scroll tabs (Overview/Course Tests/etc.) are *content tabs*, not navigation — allowed, but must be a single styled pattern (see §7.2).

### 3.3 Navigation state matrix

| Viewer | &lt;1024px | ≥1024px |
|---|---|---|
| Guest on marketing | Top bar + hamburger drawer | Top nav |
| Logged-in on marketing/storefront | Top bar (compact) + unified bottom nav | Top nav + avatar menu |
| Logged-in on `/student/*` | Top bar (minimal) + unified bottom nav | Sidebar + top nav |

### 3.4 Notifications — restyle the existing bell + panel (frontend only, read-only data)
**Existing assets (researched read-only — reused, never rebuilt):**
- **Bell:** `src/components/student/StudentBellButton.tsx`, mounted in `src/components/marketing/CourseStoreShell.tsx:170` (today renders only when `loggedIn && isStudentRoute`).
- **Panel:** `src/components/student/StudentNotificationCenter.tsx` — popover that lazy-loads the list on open; already supports read / mark-all-read, designed empty + error states, "archived after 30 days" copy.
- **Service (consume only):** `src/services/student/studentNotificationWebService.ts` — `fetchStudentNotifications`, `markStudentNotificationAsRead`, `markAllStudentNotificationsAsRead`, `fetchStudentUnreadNotificationCount`.
- **Unread badge:** the bell's own TanStack query key `['student-notification-unread']`. (`useNavBadgeCounts` returns only `{testsDue, openDoubts}` — it carries **no** notification count; corrected in §3.1.) The dead `StudentHeader.tsx` bell dies with the file per §10.2 — one bell survives, in the shell.

**Entry points:**
- **Desktop ≥1024:** bell + unread badge in the `CourseStoreShell` right cluster (§3.1); restyle with tokens, `aria-label="Notifications"`, badge = dot ≤9 / count chip ≥10.
- **Mobile <1024 (logged-in):** bell stays in the compact top bar (top bar exists at every width, §3.3). The bottom nav **keeps its 5 items** (Home/Courses/Tests/PYQ/Me, §3.2) — notifications are deliberately **not** a 6th bottom-nav item: the decision-2 five-item list is unchanged and the bell is already one glance away in the top bar.
- **Portal + marketing:** mount condition widens from `isStudentRoute`-only to *any logged-in student route* so the bell's availability matches the unified bottom nav.

**Dropdown vs dedicated route → keep the dropdown (popover).** A `/notifications` route would create exactly the barren-page risk decision 6 forbids (empty list ⇒ near-blank page needing its own full state set and chrome) while adding zero data capability — the popover already ships loading/empty/error/mark-all-read. On ≤600px the same component renders as a bottom sheet (full-width, ≤80dvh): one component, two presentations.

**Item states (tokens only):** unread = ink-900 14px title + accent dot/rail; read = ink-600 muted; hover/focus per §2.5 ring; tapping an item calls existing `markStudentNotificationAsRead` (+ navigates only if the payload carries a route — open question 6); "Mark all as read" → existing endpoint; open → `StateSkeleton` rows, empty → `IconEmptyBox` + one line, error → sentence + Retry.

**Scope guard:** read / mark-read / mark-all / unread-count only — diff must show no `.insert/.update/.delete/.rpc`. **No backend changes → nothing added to §13** (existing item 8 already covers count precision).

**Files:** `StudentBellButton.tsx`, `StudentNotificationCenter.tsx`, `CourseStoreShell.tsx` (mount + condition at line 170), `studentNotificationWebService.ts` (consume only), `student.css` (panel/sheet section). **Phase slot: Phase 2** (nav-shell work; Phase 1 untouched).

---

## 4. Home page (`/` → `src/app/page.tsx` → `MarketingHomeView.tsx`)

### 4.1 Section-level decisions
| Section (current) | Decision |
|---|---|
| `StudentHomeHero` / `HeroSection` / hero card + "Real exam pattern" burst | **Redesign** per §4.2 |
| "A NOTE FOR YOUR STUDY DESK" block (lines 396–436) | **Delete** (user decision 5) |
| GOALS strip (`src/components/marketing/GoalsSection` or goals markup) | **Keep**, retoken, fix sub-12px |
| Featured courses grid (`StoreCourseCard`) | **Keep**, purchase-aware (§5) |
| `AppShowcase` | **Keep**, re-space, remove filler banner copy |
| `FreeDemo` | **Keep**, replace generic banner with one concrete demo CTA (labeled button → guest goes to login-gated demo per §5.3 rules: demo link stays visible; gate only purchase actions) |
| Marketing "method"/process section (numbered 01–04 generic steps) | **Remove** (generic filler; audit anti-slop) |
| Dead `HeroCarousel.tsx` | **Delete** (§10) |
| `.student-hero-banner` dead CSS (`student.css:95–116,819,834`) | **Delete** (§10) |
| Pre-footer whitespace band | **Remove** (finding 22) |

### 4.2 Hero redesign — 5 variants (user decision 5)
- Component: rewrite `src/components/marketing/StudentHomeHero.tsx` with a `variant` derived from purchase state:

| Variant | Trigger | Headline | Sub | Primary CTA | Secondary CTA |
|---|---|---|---|---|---|
| `guest` | not authed | "Practise the real exam pattern." | mock tests + PYQ packages line | "Browse courses" → `/courses` | "Sign in" → `/login` |
| `no-purchases` | authed, 0 enrolled, 0 PYQ owned | "Start with a clear plan." | pick a course or PYQ package | "Explore courses" → `/courses` | "My learning" → `/student/overview` |
| `course-only` | `enrolled_courses.length > 0`, no PYQ | "{firstName}, pick up where you left off." | continue enrolled course + nudge PYQ | "Continue learning" → `/student/overview` | "Try a PYQ package" → `/pyq` |
| `pyq-only` | PYQ owned, no courses | "Your PYQ practice is ready." | resume PYQ practice | "Resume practice" → `/student/overview` | "View courses" → `/courses` |
| `both` | both | "{firstName}, your dashboard is ready." | courses + PYQ summary chips | "Go to my learning" → `/student/overview` | "New tests" → `/student/tests` |

- **Data:** purchase state = `fetchStudentBootstrap().enrolled_courses` (course ownership) + new read-only `fetchStudentPyqPurchases()` (§5.5) — fetched client-side; while loading render the `guest`-shaped skeleton (no layout shift), never a wrong-variant flash: gate on `isLoading`.
- Burst "Real exam pattern" must sit outside the hero card's overlap (own grid cell, ≥16px clearance) — fixes finding 23.
- Hero card shows a live mini "syllabus progress" only when variant has content; otherwise shows 3 concrete stats (tests, PYQ papers, batches) — no fake numbers.
- Height: `min-height: 520px` desktop, auto ≤768px; no fixed vh (avoids overlap at 600px).

### 4.3 Below-hero
- Order: GOALS strip → Featured courses (purchase-aware) → AppShowcase → FreeDemo → contact/footer.
- All section paddings from `--space-section`; heading style single pattern (`--fs-xl` + ink-900, no gradient text).

---

## 5. Storefront (courses, PYQ, detail pages, filters, cards)

### 5.1 Card state matrix

**Course card — `src/components/marketing/StoreCourseCard.tsx`**

| State | Detect | Badge | CTA label | CTA action |
|---|---|---|---|---|
| Guest (any card) | no session | none/pricing | "Explore Course" | → `/courses/[courseId]` (detail shows enroll; click Enroll → `/login?next=…` §5.3) |
| Not enrolled, logged-in | `enrolled_courses` excludes id | pricing | "Explore Course" | → detail |
| Enrolled | `enrolled_courses` includes id | **"Enrolled ✓"** / "Active" (keep existing semantics) | **"Continue"** ("Go to course" on mobile) | → `/student/courses/[courseId]` |

- Remove/replace current labels "Go to Classroom"/"Active Enrolled" (inconsistent vocab) → single vocabulary: **Enrolled (badge) / Continue (CTA)**.

**PYQ package card — `src/components/marketing/PYQCatalog.tsx`**

| State | Badge | CTA label | Action |
|---|---|---|---|
| Not purchased | price / "Popular" | **"Buy"** (desktop), **"Purchase Package"** (full-width mobile) | → `/pyq/[pyqId]`; if guest → `/login?next=/pyq/[pyqId]` |
| Purchased | **"Purchased ✓"** | **"Continue practice"** | → `/pyq/[pyqId]` (owned state) or `/student/tests?tab=pyq` if papers live in tests hub |

- **Copy change (user decision 4):** every "Enroll & practice" (PYQCatalog.tsx:282), "Enroll", "Enroll Now" in PYQ contexts → "Buy" / "Purchase Package". `PYQPricing.tsx:49,74` "Enroll Now" → "Purchase Package" / "Buy now". Course `CoursePricing.tsx:104,141` keeps "Enroll Now" (courses legitimately enroll) but purchased state shows "Continue learning" instead.
- Both cards: sticker/burst overflow fixed (§2.8), `OFF` burst never clips at 375/600/768.

### 5.2 Detail pages state matrix

**`src/app/courses/[courseId]/page.tsx`** (route param is `courseId`):
- Guest: pricing card shows full price + "Enroll Now" → navigates `/login?next=/courses/{id}` (no dead end).
- Logged-in, not enrolled: "Enroll Now" → enrollment checkout flow (existing backend flow untouched).
- Enrolled: replace enroll block with **purchase panel:** "You're enrolled" + progress (if any) + **"Continue learning"** → `/student/courses/[courseId]` + syllabus shortcut. No price, no Enroll.

**`src/app/pyq/[pyqId]/page.tsx`** (route param is `pyqId`):
- Guest / not purchased: price + **"Purchase Package"** → `/login?next=…` for guest, checkout for user. Papers list keeps lock chips ("🔒 Unlocks on Purchase" → restyle to non-emoji `IconLock` + "Unlocks on purchase").
- Purchased: "You own this package" + **"Continue practice"** + unlocked papers list.

### 5.3 Guest gate rule (user decision 3 — keep flow exactly)
- Storefront, courses, PYQ, blog remain **fully visible** to guests.
- Only the *commit* actions (Enroll Now, Buy, Purchase Package, Start free demo that requires account) route to `/login` first — implemented as a single helper `requireAuth(action, nextPath)` in `src/lib/authGate.ts` (new, student-owned). No modals added, no content hidden.

### 5.4 Filters, layout, empty states (audit findings 2, 3, 15, 17, 22)
- **Course filters unreachable &lt;1280 (finding 2):** `CourseCatalog.tsx` `.store-stream-filters` — at ≤1279px render filters as a horizontally scrollable chip row directly above the grid (sticky under header), plus a "Filters" bottom-sheet trigger ≤600px. Remove `display` constraints that gate them to ≥1280 in `courses.css` breakpoint blocks (1100/800/600 need explicit filter rules).
- **PYQ empty state mid-results (finding 17):** PYQCatalog's "No packages match" block only renders when `filtered.length === 0`; never inside a populated list — restructure so filtering happens before render, and empty state is a single grid-spanning card with `IconEmptyBox`, explanation, and a **"Clear filters"** button.
- **Bare chart/grid walls (finding 16):** course grid and analytics add row labels, counts ("12 courses"), and empty legends.
- **Whitespace bands (finding 22):** fixed section rhythm (§2.8).

### 5.5 Approved read-only PYQ-purchase hook (frontend only)
- **New file:** `src/hooks/student/useStudentPyqPurchases.ts`.
- Implementation: TanStack `useQuery` calling a new function in `src/services/student/studentTestWebService.ts` (or `paymentService.ts`) — **`fetchStudentPyqPurchases()`** performing `supabase.from('student_pyq_purchases').select('...')` filtered by the current student, **copying the exact pattern already used at `studentTestWebService.ts` ~line 460–521 and `paymentService.ts` ~line 238** (same table, same client, same read-only select). No new table, no RPC, no migration, no server action, no admin/teacher code touched.
- Returns `{ purchasedPyqIds: string[], isLoading, isError }` with `staleTime` 60s. Used by: home hero (§4.2), PYQ cards, `/pyq/[pyqId]`, `/student/overview`, `/student/courses`.
- If the existing service reads are scoped differently (per-order rows), normalize to `Set<pyqPackageId>` in the hook.
- **Not** used to gate visibility of storefront content — only to swap card/detail states.

---

## 6. Learning center (`/student/overview` + `/student/courses`)

### 6.1 Target IA — `/student/overview` ("Today")
Page = dated dashboard, single column main + right rail (desktop ≥1024), stacked ≤768:
1. **Header row:** "Good {timeOfDay}, {firstName}" + date (formatted, §9.6) + link chips: Calendar, Doubts (replacing lost SubNav destinations).
2. **Continue card** (state-dependent, §6.3): one big card — enrolled course w/ progress bar *or* PYQ practice resume *or* first-purchase prompt.
3. **Today's tests / due items:** from `useNavBadgeCounts` sources; empty → "No tests due — browse PYQ practice".
4. **Progress module:** "Overall syllabus progress" — **label stacked above value ≤600px** (fixes finding 12), value + progress bar with `aria-valuenow`.
5. **Doubts/queries teaser** (if applicable) + Help card (bottom of rail so sidebar "Need help?" overlap is moot once pill nav is gone).

### 6.2 Target IA — `/student/courses` hub
- **Purchase-state tabs:** "My courses" (enrolled) | "PYQ packages" (purchased) | "All courses" (browse, links to store). Tabs auto-select the first non-empty; show counts.
- Enrolled course rows: thumbnail, title, progress %, "Continue".
- Purchased PYQ rows: package title, papers practised/total, "Continue practice", CTA to tests hub for new tests.
- **No barren page rule (user decision 6):**
  - 0 purchases → **redirect** (`router.replace`) to `/courses` (course store) with a one-line notice "You don't have a course yet — here's the catalog." (never render an empty hub).
  - course-only → land on "My courses" tab; PYQ tab shows inline upsell card (not empty).
  - PYQ-only → land on "PYQ packages" tab; "My courses" shows inline upsell card.
  - both → "My courses".

### 6.3 Purchase-state edge-case matrix (applies to overview + courses hub + hero)

| State | Continue card | Courses tab | PYQ tab | Redirect rule |
|---|---|---|---|---|
| Guest hitting `/student/*` | — | — | — | → `/login?next=…` (existing auth guard) |
| 0 purchases | "Start here" → catalog CTA | upsell card | upsell card | `/student/courses` → `/courses` |
| Course-only | enrolled course resume | list | upsell card | land "My courses" |
| PYQ-only | PYQ practice resume | upsell card | list | land "PYQ packages" |
| Both | whichever has activity most recent (fallback: course) | list | list | land "My courses" |
| Loading | skeleton (shaped like final card) | skeleton | skeleton | no redirect until resolved |
| Error | inline error + "Retry" (`useNavBadgeCounts`-style) | — | — | no redirect |

- Backend exists for all displayed data (`fetchStudentBootstrap`, tests endpoints, pyq purchase reads) — this is layout/design work only.

### 6.4 Component-level layout
- New/rewritten student components (student-owned, §10): `StudentDashboardHeader`, `ContinueCard`, `ProgressModule`, `DueTestsList`, `CourseRow`, `PyqRow`, `PurchaseUpsellCard`, `StateTabs`.
- Files: `src/components/student/*` (rework existing dashboard components in place where they exist; the audit's 68 student components stay, but nav/dead ones go per §10).
- Pages: `src/app/student/overview/page.tsx`, `src/app/student/courses/page.tsx` (plus light touch to `courses/[courseId]/page.tsx` only for its Tests section, §7.1).
- Styling: `src/app/student/student.css` sections for dashboard, token-driven.

---

## 7. Tests flow

### 7.1 Course-assigned tests → inside course detail
- `src/app/student/courses/[courseId]/page.tsx` gains a **"Tests" section** (tab or anchored section): lists tests assigned to that course (existing "Course Tests" tab data source in `/student/tests` moves its course-scoped queries here).
- Card list uses unified test card: formatted date, status vocabulary (§7.3), unified CTA "Start Test"/"Resume"/"View result".
- **406 flag (must-fix, backend):** opening `/student/tests/[testId]` returns 406 — plan **flags only**: frontend shows a friendly inline error state ("We couldn't load this test — the team has been notified") instead of a broken page; full fix listed in §13.

### 7.2 `/student/tests` hub restructure
- Remove the "Course Tests" tab from the hub (it now lives in course detail). Hub becomes **two clearly separated sections** (segmented control): **"Mock tests"** (standalone `testType = 'mock_test'`) | **"PYQ tests"** (`testType = 'pyq_paper'`), each with its own count, list, and empty state ("No standalone mock tests yet — browse PYQ packages").
- Code has no "class test" type; mapping: tab value `mock_test` → section "Mock tests", `pyq_paper` → "PYQ tests", course-assigned → course detail (§7.1). Filters (`StudentTestFilters`) gain an optional "Course" chip inside Mock tests that deep-links to course detail instead of an in-hub third tab.
- Breadcrumb: `Portal / Tests` on hub; `Portal / Courses / {Course} / Tests` in course detail (student-owned `Breadcrumbs` component).

### 7.3 Vocabulary + cards
- **One vocabulary everywhere (finding 10):** `NOT STARTED` → **"Not started"**; `IN_PROGRESS` → **"In progress"** (CTA "Resume test"); completed → **"Completed"** (CTA "View result"); upcoming → **"Upcoming — {formatted date}"** (CTA "Details"). Replace raw `START`/`Start Test` mixes in `testCardState.ts`, `StudentTestCard`, service label maps.
- Dates: `Intl.DateTimeFormat` helper `formatDate()` in `src/lib/format.ts` (student-owned); no ISO strings in UI.
- Status never color-only: icon + text + color (finding 15 partially).

### 7.4 Exam engine environment — zero site chrome + fullscreen (all engine routes)
**Routes (both count as "engine"):** instructions `src/app/student/tests/[testId]/page.tsx` and runner `src/app/student/tests/[testId]/runner/page.tsx` (→ `src/components/student/test-runner/TestRunnerShell.tsx`). Today `src/app/student/layout.tsx` wraps both in `CourseStoreShell` (top navbar + `SiteFooter`) + `StudentSubNav` + `StudentBottomNav`; only `/runner` suppresses the two navs (`StudentBottomNav.tsx:32–38`, `StudentSubNav.tsx:44–50`) — **the instructions route shows full chrome, and the shell header/footer are never suppressed anywhere.**

**Chrome stripping (both routes):**
- New predicate **`isExamEnginePath(pathname)`** in new `src/lib/routes.ts` (student-owned): matches `^/student/tests/[^/]+(/runner)?/?$` — instructions + runner **only**; the hub `/student/tests` and every other route keep full chrome.
- Consumers: `CourseStoreShell.tsx` (conditionally render header nav + footer), `StudentBottomNav.tsx` (replace the ad-hoc `/runner` string checks with the predicate → now also hides on instructions), `src/app/student/layout.tsx` (gate the desktop sidebar wrapper by the same predicate — sidebar component identity confirmed during Phase 9 per open question 5). `StudentSubNav` is deleted in Phase 2; its suppression duty transfers to this predicate. Phase 2's existing `hideOnPaths` behavior stays as-is until Phase 6 swaps it in.

**Fullscreen lifecycle (extract, don't rewrite):**
- Pull the existing fullscreen code out of `TestRunnerShell.tsx` (state `isFullscreen`/`fullscreenWarning`, `fullscreenchange` listener lines 279–295, `toggleFullscreen` 297–320, exit-warning banner 593–608) into a shared hook **`src/hooks/student/useExamFullscreen.ts`** (new): `{ isFullscreen, supportsFullscreen, enterFullscreen(), exitFullscreen() }`, used by both routes.
- **Enter — from the instruction screen:** the Start/Continue/Retake handler (`page.tsx` `handleStartOrResume`, ~line 103) calls `enterFullscreen()` **synchronously inside the click handler** (Fullscreen API requires a user gesture — no `await` before it), then navigates to `/runner`. The runner never re-requests (a post-fetch request would lose the gesture); it only observes.
- **Exit — allowed only on:** submit (existing `SubmissionOverlay` flow), pause-exit/`QuitConfirmModal` confirm (existing `router.push('/student/tests')`), or an explicit "Exit test" — each calls `exitFullscreen()` first.
- **ESC / any external `fullscreenchange` on the runner:** replace the banner-only warning with the existing `QuitConfirmModal` repurposed as **pause/exit-confirmation** ("Paused — fullscreen was exited" + **Resume** [button re-requests fullscreen; the click is the required gesture] / **Exit test**). The old banner copy becomes secondary text inside that modal.
- **Permission denied / API absent** (`requestFullscreen` rejects `NotAllowedError`, or API missing): fall back to the chrome-stripped immersive layout (still zero header/footer/navs/sidebar) + a non-blocking inline notice on the instructions screen ("Fullscreen unavailable — starting in immersive view"). The test stays fully playable; never block with a modal.
- **iOS Safari caveat:** the Fullscreen API there exists only on `<video>` elements → feature-detect `document.documentElement.requestFullscreen`. Fallback = CSS immersive: engine-route wrapper gets `position: fixed; inset: 0; height: 100dvh; overflow: auto` (new "exam engine" section in `student.css`), with `100vh` as `@supports` fallback so the collapsing address bar can't clip the runner.

**Acceptance:**
- At 375/768/1024/1280, both engine routes render **no** top navbar, footer, bottom nav, or sidebar; `/student/tests` hub and all other routes visually unchanged (unit-check the predicate: hub path NOT matched).
- Desktop Chrome: Start/Continue/Retake enters fullscreen before the runner paints; ESC opens pause/exit-confirmation (not a bare banner); **Resume** re-enters fullscreen; submit exits fullscreen and lands on `/student/tests`.
- Simulated permission denial: both routes chrome-free, notice visible, test completable end-to-end.
- Feature-detect path (`supportsFullscreen === false`, iOS): no crash, no request attempted, fixed `100dvh` immersive layout applied.
- Diff adds no backend calls (same read-only guard as §5.5).

**Risks:** gesture-timing on entry (mitigate: synchronous call, navigation after the request starts); ESC/open-modal races (guard on modal-open state); `100dvh` support (`@supports` fallback); sidebar wrapper unknown until open-question-5 verification (gate whatever `layout.tsx` renders). **Phase slot: Phase 6** (Phase 1 untouched).

---

## 8. Blog (`/blog`)

- **New route:** `src/app/blog/page.tsx` (+ `src/app/blog/blog.css` or a scoped section in a new `src/app/blog/blog.css`).
- Content: unified top nav (§3) + centered designed card: `IconSpark` custom icon, H1 "The MockTest blog", body "Study strategy, exam pattern breakdowns, and product updates — coming soon.", email-capture-free (no backend!), single ghost CTA **"Back to courses"** → `/courses`, plus small "Questions? Contact us" → `/#contact`. Coming-soon card styled with Card + tokens; page contributes no empty whitespace band.
- Metadata: `title: "Blog — coming soon | MockTest"`, `description`.
- **Link fixes:** `CourseStoreShell.tsx:110` dead `/blog` link → `/blog` (now real); `SiteFooter.tsx:95` `href="#"` Blog → `/blog`.
- Add Blog to desktop nav (§3.1) and to the guest hamburger drawer.

---

## 9. Cross-cutting quality rules

### 9.1 Breakpoint checklist (every touched screen must pass 375 / 600 / 768 / 1024 / 1280)
- **375:** bottom nav visible (logged-in), no horizontal scroll, no clipped stickers, hero auto-height, all text ≥12px, CTAs full-width where needed.
- **600:** hamburger (guest) / bottom nav (user) coexist correctly with compact top bar; filter chips scroll; progress label stacked.
- **768:** contact cards **stack to 1-up** (fix finding 4: 3-up collision ≤768 — grid becomes `repeat(auto-fit, minmax(260px, 1fr))`); catalog cards 2-up max.
- **1024:** sidebar appears on portal; bottom nav disappears; top nav full; no pill-nav overlap (pill deleted).
- **1280:** sidebar + "Need help?" card spacing verified (finding 5 residual); filters row fully visible without scroll (finding 2).

### 9.2 WCAG AA
- Contrast ≥4.5:1 body / ≥3:1 large & UI — verify token pairs in `tokens.css` (ink on surface, white on primary) with a contrast pass; fix any failing pair at token level.
- All inputs labeled (7 unlabeled search inputs get `aria-label` or visible `<label>`); all icon-only buttons labeled; focus visible (one treatment, §2.5); ≥44×44px targets on mobile (bottom nav items, filter chips, card CTAs); `alt` text on course thumbnails (title-derived); landmarks (`header/nav/main/footer`) present once per page.

### 9.3 State design standard (applies everywhere)
Every async surface defines: **loading** (skeleton matching final layout), **empty** (icon + one-sentence explanation + one action button — never blank), **error** (icon + sentence + Retry), **success**. Encoded as shared student components `StateSkeleton`, `EmptyState`, `ErrorState` in `src/components/student/ui/`.

### 9.4 One color system / one focus / one button / one card — enforcement
- Grep-gate in review: no new `#hex` in `src/app/student`, `src/components/student`, `src/components/marketing` (except `tokens.css`); no `@phosphor-icons/react` imports added in those dirs; no `font-size` &lt; 12px.

### 9.5 Motion gate
No `transition`/`animation` duration outside 150–300ms in student CSS; no infinite animation except the single hero ambient; `prefers-reduced-motion` zeroes durations via `motion.ts`.

### 9.6 Data formatting
`src/lib/format.ts`: `formatDate` ("24 Sep 2026"), `formatDateTime`, `formatPercent`, `formatPrice`. Used on test cards, overview header, purchase history rows. No raw ISO, no raw decimals.

### 9.7 Icon policy
Custom set (§2.7) for nav, empty states, cards, filters, status. Phosphor tolerated only in dense data tables inherited from shared components (none planned) — student surfaces use the custom set exclusively.

### 9.8 Language gate — no CJK in source
**Standing grep gate:** `grep -rP "[\x{4e00}-\x{9fff}\x{3000}-\x{303f}\x{ff00}-\x{ffef}]" src/` must return **zero matches** (run in Phase 8 sweep and again in Phase 9 final). Audit result: no hardcoded Chinese exists in `src/` today — the visible `物理学`/`化学`/`数学` labels are **data-sourced** from student subject content and are a content-owner fix (§13.3). The gate exists to keep it that way: any future hardcoded CJK string fails review.

---

## 10. File separation & cleanup plan

### 10.1 Student-owned extraction (user decision 12)
Shared-with-admin/teacher files must be duplicated/moved into student-owned files so students evolve independently:

| Shared today | Student-owned target | Notes |
|---|---|---|
| `src/components/ui/mmt/Button.tsx` | `src/components/student/ui/Button.tsx` | copy, student variants (§2.3); admin/teacher keep original |
| `src/components/ui/mmt/Card.tsx` | `src/components/student/ui/Card.tsx` | slots (§2.4) |
| `src/components/ui/mmt/Input.tsx`, `Select.tsx` | `src/components/student/ui/FormControls.tsx` | labeled-by-default inputs |
| `src/components/ui/mmt/Pill.tsx`, `Chip.tsx`, `SectionHeader.tsx` | replace with student `Badge`, `SectionHeading` | orphans already dead |
| `src/components/ui/mmt/Modal.tsx` | `src/components/student/ui/Modal.tsx` if student portal uses modals | check call sites during Phase 1 |
| `src/components/shells/*` (admin/teacher shells used as reference) | student shell stays `CourseStoreShell` + portal layout | no import changes into admin |
| `src/design/tokens.css` | **shared, read-only** — student CSS may consume; never fork tokens | single theme (user decision 1) |
| `src/app/globals.css` | shared; student additions go to student CSS files | |
| `src/lib/motion.ts` | shared motion (adopted, §2.6) | admin may use later, no behavior change for them |
| Marketing header/footer (`CourseStoreShell`, `SiteFooter`) | remain student/marketing-owned; must not import admin/teacher components | audit imports |

**Migration approach:** Phase 1 creates `src/components/student/ui/*` copies; call sites in `src/components/student`, `src/components/marketing`, `src/app/student`, `src/app/courses`, `src/app/pyq`, `src/app/blog` are repointed file-by-file (grep `from '...ui/mmt/...'` limited to those dirs); admin/teacher imports untouched. Old mmt files deleted only when zero non-admin/teacher importers remain (audit says Pill/Chip/SectionHeader/Input/Select are already orphans → delete directly).

### 10.2 Dead-code removal list (user decision 11)
Delete (after `git grep` confirms zero importers outside admin/teacher):
- `src/components/marketing/HeroCarousel.tsx`
- `src/components/marketing/SiteHeader.tsx`
- `src/components/student/StudentHeader.tsx`
- `src/components/student/StudentSidebar.tsx` (only if truly unimported — portal sidebar comes from elsewhere; verify before delete)
- `src/components/ui/mmt/Pill.tsx`, `Chip.tsx`, `SectionHeader.tsx`, `Input.tsx`, `Select.tsx` (orphans)
- `.student-hero-banner` CSS block (`student.css` lines 95–116 + refs at 819, 834)
- `.student-subnav` CSS + `StudentSubNav.tsx` (replaced, §3.2)
- `SignOutButton` if confirmed dead (move logic inline into avatar menu; audit says orphan)
- **`src/lib/motion.ts`: ADOPT, not deleted** (§2.6) — write the adoption (retune durations) in Phase 1.
- Duplicate `@keyframes fadeUp` copies across student CSS (consolidated to one).
- **CSS consolidation:** `courses.css`/`student.css`/`auth-preview.css` restructured into named sections (tokens consumption, layout, components, breakpoints 1100/800/600/1024/1280); remove dead rules only with importer evidence.

### 10.3 Boundary rule going forward
No student page/component may import from `src/components/admin/**`, `src/components/teacher/**`, `src/features/**` (except read-only hooks already sanctioned — none new), or `src/app/admin`/`src/app/teacher`. Review gate: grep check in Phase 8.

---

## 11. Documentation plan

### 11.1 Archive (move, do not delete) → `archive/` at repo root
Move the following **root** docs into `archive/` (create dir; keep `AGENTS.md`, `CLAUDE.md`, `README.md` in root; one new doc added at the end):

`ADMIN_ROLES_IMPLEMENTATION_PLAN.md`, `Admin_Dashboard_Functional_Specification.md`, `Admin_Dashboard_Testing_and_Functional_Flow.md`, `Admin_Dashboard_API_Contracts.md`, `ARCHITECTURE_MIGRATION_ANALYSIS.md`, `DESIGN_SYSTEM.md`, `WEBSITE_DEVELOPER_KNOWLEDGE_BASE.md`, `Teacher_vs_Admin_Feature_Matrix.md`, `Teacher_Live_Classes_Scheduling_Analysis.md`, `Teacher_Live_Classes_Backend_Validation_Report.md`, `Teacher_Dashboard_Testing_and_Functional_Flow.md`, `Teacher_Dashboard_Functional_Specification.md`, `Teacher_Dashboard_API_Contracts.md`, `MIGRATION_CHECKLIST.md`, `Live_Classes_Architecture_Analysis.md`, `Student_Portal_Design_Review.md`, `STUDENT_EXPERIENCE_PRD.md`, `Notification_Working_Flow_Analysis.md`, `Notification_System_Audit.md`, `Recorded_Classes_Implementation_Guide.md`, `client_reuirement.txt` (+ trivial `.docx` lockfile if present).

- `DESIGN_SYSTEM.md` is superseded by the new consolidated doc — archive it (its Design A token rules live on in `tokens.css` + new doc).
- **Docs only** — no admin/teacher code touched.

### 11.2 New consolidated doc (root, written at END of implementation)
`STUDENT_DESIGN_SYSTEM.md` outline:
1. Design principles + token reference (`tokens.css`)
2. Type scale (12px floor, 14px body) & spacing rhythm
3. One Button / one Card / one focus ring / icon set catalog
4. Motion spec (150–300ms, `motion.ts` usage, reduced motion)
5. Navigation map (desktop nav, bottom nav, breadcrumbs, badges)
6. Purchase-state patterns (card matrix, hero variants, gate rules)
7. Page patterns (home, store, detail, overview, tests, blog) + state standard (loading/empty/error)
8. Responsive contract (375/600/768/1024/1280 checks)
9. Accessibility checklist
10. Student file ownership map (§10.1) + backend-pending list (§13)

---

## 12. Phased implementation plan

> Each phase: files, tasks, acceptance criteria (verifiable), risk, parallelization, size. Order matters: foundation → nav → pages → polish → cleanup/docs.

### Phase 1 — Foundation: tokens, primitives, motion, icons  · size **M** · risk **Low**
**Files:** `src/design/tokens.css` (extend only), `src/app/globals.css`, `src/lib/motion.ts`, `src/lib/format.ts` (new), `src/lib/authGate.ts` (new), `src/components/student/ui/{Button,Card,FormControls,Badges,StateSkeleton,EmptyState,ErrorState,Breadcrumbs}.tsx` (new), `src/components/icons/student-icons.tsx` (new), `src/app/student/student.css`, `src/app/courses/courses.css`, `src/app/auth/auth-preview.css`.
**Tasks:** define fs scale + `--space-section`; fix all 46 sub-12px decls; unify focus rule (delete 3 others); merge 3 color systems into tokens; adopt `motion.ts` (150–300ms, reduced-motion guard); build custom icon set (~22 icons); create student UI primitives; create `formatDate`/`authGate`.
**Acceptance:** grep shows zero `font-size` &lt;12px in student CSS; exactly one `:focus-visible` outline rule; `grep -r "@phosphor-icons/react" src/components/student src/components/marketing` planned for Phase 8 (icons exist now); `motion.ts` has ≥1 importer; a smoke render of `/` and `/courses` unchanged visually except tokens.
**Parallel:** independent of all page work; blocks Phases 2–8 primitives use. Risk: token merge could shift colors — mitigate with screenshot diff at 1280.

### Phase 2 — Navigation unification · size **M** · risk **Medium** · needs Phase 1
**Files:** `src/components/student/StudentBottomNav.tsx`, `src/components/student/StudentSubNav.tsx` (delete), `src/app/student/layout.tsx`, `src/components/marketing/CourseStoreShell.tsx`, `src/components/marketing/SiteFooter.tsx` (nav-adjacent only), `src/app/student/student.css`, `src/app/courses/courses.css`, `src/hooks/student/useNavBadgeCounts.ts` (consume only); notifications: `src/components/student/StudentBellButton.tsx`, `src/components/student/StudentNotificationCenter.tsx`, `src/services/student/studentNotificationWebService.ts` (consume only — §3.4).
**Tasks:** bottom nav → 5-item unified system, <1024px, guest/stroke rules (§3.2), safe-area padding, hides on `/runner` + live rooms; hamburger extended 600→1023px for guests; delete SubNav + `.student-subnav` CSS; simplify avatar menu (§3.1); sidebar "Need help?" spacing; add Blog link; notifications (§3.4): bell mount widened to all logged-in student routes, restyle bell + unread badge from `['student-notification-unread']`, panel → tokenized dropdown / ≤600px bottom sheet, item read/unread states, no `.insert/.update/.delete/.rpc` in diff.
**Acceptance:** at 1280 no pill overlaps sidebar/footer; at 375/600/768 bottom nav present (logged-in) & no content occluded; guest at 768 sees hamburger, no bottom nav; 1024 shows sidebar, no bottom nav; all nav icons are custom set with `aria-label`s; bell visible for logged-in student on portal + storefront, badge count matches unread query, panel opens with skeleton → list/empty/error, "Mark all read" clears badge.
**Parallel:** with Phase 4 (home) after shell stabilizes; independent of Phase 5 data work. Risk: layout padding regressions on portal pages — checklist all 20 student routes at 375/1024.

### Phase 3 — Home page redesign · size **M** · risk **Low** · needs Phase 1, 2
**Files:** `src/app/page.tsx`, `src/components/marketing/MarketingHomeView.tsx`, `src/components/marketing/StudentHomeHero.tsx` (+ `HeroSection.tsx` merge/delete decision), GOALS/AppShowcase/FreeDemo components, home sections of `courses.css`/`globals.css`, dead `HeroCarousel.tsx` (delete), `.student-hero-banner` CSS (delete).
**Tasks:** delete "A NOTE FOR YOUR STUDY DESK" block (lines 396–436) + method section; 5-variant hero wired to bootstrap + pyq hook; fix "Real exam pattern" burst overlap; purchase-aware featured courses; remove whitespace band; retoken sections; remove banners per §2.8.
**Acceptance:** view-source/DOM has no "A NOTE FOR YOUR STUDY DESK" or "Small steps"; hero shows correct variant for the 5 states (test with mock states); burst fully visible at 375/768/1280; no infinite floating animations except allowed ambient; LCP not regressed (no added hero images).
**Parallel:** can start after Phase 1 even before Phase 2 completes (bottom nav overlays independently). Risk: hero variant data race — gate on loading (§4.2).

### Phase 4 — Storefront: cards, detail pages, filters · size **L** · risk **Medium** · needs Phase 1, 2, 5-hook
**Files:** `src/components/marketing/StoreCourseCard.tsx`, `PYQCatalog.tsx`, `PYQPricing.tsx`, `CoursePricing.tsx`, `CourseCatalog.tsx`, `src/app/courses/[courseId]/page.tsx`, `src/app/pyq/[pyqId]/page.tsx`, `courses.css`, new `src/hooks/student/useStudentPyqPurchases.ts`, service read in `src/services/student/studentTestWebService.ts` (append read-only fn) or `paymentService.ts`.
**Tasks:** card state matrices (§5.1); PYQ copy "Enroll"→"Buy"/"Purchase Package"; detail-page purchase states (§5.2); guest gate via `authGate` (§5.3); PYQ hook (§5.5, exact pattern of existing reads); filters &lt;1280 fix; PYQ empty-state fix; sticker overflow; chart/grid labels.
**Acceptance:** grep shows no "Enroll" within any PYQ component; enrolled course card shows "Continue" not "Enroll"; purchased PYQ card shows "Continue practice"; guest clicking Purchase lands on `/login` with `next` param; filters operable at 768/1024/1280; empty-state only when list empty; no clipped sticker at 375; hook performs select-only on `student_pyq_purchases` (no mutations) — verify no `.insert/.update/.delete/.rpc` in diff.
**Parallel:** card work (components) and detail-page work can split into two parallel tracks. Risk: purchase-state misdetection — cover all 4 states in acceptance.

### Phase 5 — Learning center · size **L** · risk **Medium** · needs Phase 1, 2, 4-hook
**Files:** `src/app/student/overview/page.tsx`, `src/app/student/courses/page.tsx`, dashboard components in `src/components/student/**`, `student.css`, possibly small read of bootstrap hook.
**Tasks:** rebuild overview per §6.1; courses hub tabs + redirect rules (§6.2); edge-case matrix (§6.3); components (§6.4); fix syllabus-progress label collision; formatted dates; state standard components everywhere.
**Acceptance:** for each of 4 purchase states (+loading/error) screenshots match §6.3 matrix; `/student/courses` with 0 purchases redirects to `/courses`; no page shows a bare "no data" blank; progress label/value don't collide at 375/600; WCAG pass on new controls.
**Parallel:** after Phase 4 hook exists (can develop against mock hook values in parallel). Risk: redirect loops — guard: only redirect when `!isLoading && count===0`, and only from hub, not from detail.

### Phase 6 — Tests flow + exam engine environment · size **L** · risk **Medium** · needs Phase 1, 2
**Files:** `src/app/student/tests/page.tsx`, `src/app/student/tests/[testId]/page.tsx` (instructions), `src/app/student/tests/[testId]/runner/page.tsx`, `src/app/student/courses/[courseId]/page.tsx` (Tests section), `src/components/student` test components (`StudentTestCard`, `StudentTestFilters`, `testCardState.ts`), `src/components/student/test-runner/TestRunnerShell.tsx` (extract fullscreen only), new `src/hooks/student/useExamFullscreen.ts`, new `src/lib/routes.ts` (`isExamEnginePath`), `src/components/marketing/CourseStoreShell.tsx` + `src/app/student/layout.tsx` + `src/components/student/StudentBottomNav.tsx` (chrome gating touchpoints), `student.css` (exam-engine section), service label maps where tests are listed.
**Tasks:** hub → two sections Mock | PYQ (§7.2); move course-assigned tests into course detail; unified status vocabulary + formatted dates (§7.3); breadcrumbs; 406 friendly error state (flag only); exam engine (§7.4): `isExamEnginePath` predicate strips header/footer/subnav/bottom-nav/sidebar on instructions + runner routes; extract `useExamFullscreen`; fullscreen entry from Start/Continue/Retake in the instructions click handler; ESC/`fullscreenchange` → repurposed `QuitConfirmModal` pause/exit-confirmation; exit only on submit/pause-exit/explicit-exit; denied-permission + iOS feature-detect fallbacks (chrome-stripped `100dvh` immersive).
**Acceptance:** hub DOM has exactly two top-level sections with counts; course detail shows its tests; no `NOT STARTED`/`START` raw tokens visible in UI (grep rendered labels); 406 route renders designed error state, not crash; tab/filter deep-links work; all test card CTAs ≥44px; engine-route checklist at 375/768/1024/1280: zero site chrome on instructions **and** runner, hub unchanged; Start enters fullscreen pre-navigation, ESC opens pause/exit modal, Resume re-enters, submit exits fullscreen to `/student/tests`; simulated permission denial still chrome-stripped + playable; no new backend calls in diff.
**Parallel:** independent of Phases 4/5 after Phase 1/2; predicate/hook extraction (small) can precede hub restructure within the phase. Risk: query reuse when moving course tests — keep existing endpoints, only relocate rendering; fullscreen gesture timing — synchronous request, navigate after.

### Phase 7 — Blog · size **S** · risk **Low** · needs Phase 1, 2
**Files:** `src/app/blog/page.tsx`, `src/app/blog/blog.css`, `CourseStoreShell.tsx:110`, `SiteFooter.tsx:95`, nav link lists.
**Tasks:** coming-soon page (§8); fix two dead links; add nav entries.
**Acceptance:** `/blog` 200 + designed card, themed; footer & header Blog links navigate there; no `href="#"` Blog remains; page passes 375/768/1280.
**Parallel:** anytime after Phase 1. Risk: none material.

### Phase 8 — A11y, motion, anti-slop polish + icons sweep · size **M** · risk **Low** · needs Phases 1–7
**Files:** all student/marketing CSS + components touched; `src/app/student/analytics/page.tsx`.
**Tasks:** 7 unlabeled searches labeled; icon-only controls labeled + custom icons replace Phosphor on student surfaces (§2.7); contrast pass on tokens; motion clamp audit (no duration outside 150–300ms); 46→0 sub-12px re-verify; analytics raw-hex → tokens + no-data legends; whitespace-band final pass; non-color status everywhere; run the no-CJK grep gate (§9.8) over `src/`.
**Acceptance:** scripted checklist: Lighthouse a11y ≥ 95 on `/`, `/courses`, `/pyq`, `/student/overview`, `/student/tests`, `/blog`; grep gates pass (§9.4, §9.5, §9.8 — zero CJK in `src/`); axe clean on those pages; 5-breakpoint screenshots reviewed.
**Parallel:** sweep can run per-area alongside 4/5/6 completion. Risk: regressions from icon swap — visual diff key screens.

### Phase 9 — Cleanup, file separation verification, documentation · size **M** · risk **Low** · needs all
**Files:** deletion list (§10.2), `archive/` moves (§11.1), new `STUDENT_DESIGN_SYSTEM.md`, final grep gates.
**Tasks:** delete dead files with importer-proof; finish mmt→student/ui migration and delete orphan primitives; verify §10.3 boundary grep; re-run no-CJK gate (§9.8) as a final standing check; move 23 `.md` + `client_reuirement.txt` to `archive/`; write consolidated doc; final `npm run build` + lint.
**Acceptance:** `npm run build` succeeds; zero imports of deleted files; root contains only `AGENTS.md`, `CLAUDE.md`, `README.md`, `STUDENT_DESIGN_SYSTEM.md` (+ non-doc files); archive holds all 21+ listed docs; §13 list published inside new doc.
**Parallel:** archival can overlap late Phase 8; doc written last. Risk: deleting an "orphan" still referenced dynamically — grep both `import` and string paths before each delete.

---

## 13. Needs backend / content owner

Frontend must NOT fix these; track for backend/content teams (surface friendly states meanwhile):

1. **`/student/tests/[testId]` returns 406** — endpoint/RLS misconfiguration; blocks test detail (Phase 6 adds designed error state only).
2. **Junk DB rows:** `vrfcgf`, `titleeeeeeeeeeee`, `treindinggg` (titles/flags), raw fixture test titles (`neet 2030`, `submit test`) — content cleanup.
3. **Chinese text in student content** — subject labels `物理学` / `化学` / `数学` appear in student subject data (continue-learning/dashboard subjects). Repo grep confirms **zero hardcoded Chinese in `src/`** — all CJK is data-sourced, so there is no frontend removal task; the content owner must **remove all Chinese text from content** (DB/seed/API data), replacing with the localized subject names. Frontend only enforces the standing no-CJK grep gate (§9.8).
4. **Placeholder contact data:** `98xxxxxx21` phone, "Address line 1" address in footer/contact — content owner.
5. **Any new purchase/aggregation endpoints** beyond the sanctioned read-only `student_pyq_purchases` select (e.g., server-side hero variant bundle, payment history API) — backend.
6. **Blog content backend** (posts table/CMS) — beyond coming-soon page.
7. **Email capture on blog** — needs endpoint (intentionally omitted).
8. **Notification/doubt counts precision** — if `useNavBadgeCounts` sources are inaccurate, backend fix.

---

## 14. Open questions

1. **PYQ "Continue practice" destination:** should a purchased package's CTA land on `/pyq/[pyqId]` (owned view) or directly on the tests hub PYQ section (where `pyq_paper` tests run)? Plan defaults to detail page owned-state; confirm preferred landing.
2. **Guest bottom nav:** decision 2 says bottom nav "everywhere students go"; plan interprets guests as non-students → hamburger instead (§3.2). Confirm guests get **no** bottom nav.
3. **Blog email capture:** excluded for lack of backend — add when endpoint exists?
4. **Hero personalization fallback:** for `both` variant, "most recent activity" needs an activity timestamp source; if none exists client-side, plan falls back to course-first. Acceptable, or should we keep it deterministic (course-first always)?
5. **`StudentSidebar.tsx` deletion:** audit marks it dead, but portal pages render a sidebar — confirm the rendered sidebar is a different component before deleting (verification task in Phase 9).
6. **Fullscreen denied by policy:** if a browser/kiosk policy blocks `requestFullscreen` even on user gesture, plan falls back to chrome-stripped immersive (§7.4) with a dismissible notice — acceptable, or should the runner hard-require fullscreen?
7. **Notifications entry on mobile:** bell stays in the compact top bar and the bottom nav keeps its 5 items (§3.4) — confirm no dedicated notifications bottom-nav item / route is wanted later (data is read-only today).