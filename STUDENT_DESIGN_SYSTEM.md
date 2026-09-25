# Student Design System & Experience Architecture

**Repository:** `mocktest-admin`
**Design Authority:** `src/design/tokens.css` (Design A Tokens)
**Framework & Stack:** Next.js 16 App Router, React 19, TypeScript strict, Tailwind CSS v4 (CSS-first), Supabase, TanStack Query

---

## 1. Design Principles & Token Reference

The student experience adheres to **Design A** — a clean, academic, high-contrast, distraction-free interface built on unified CSS custom properties in `src/design/tokens.css`.

### Core Color Tokens
- **Brand Primary:** `var(--brand)` (`#2563EB`)
- **Brand Hover:** `var(--brand-hover)` (`#1D4ED8`)
- **Ink / Typography:**
  - `var(--ink)` (`#0F172A`): Primary headings and high-emphasis body
  - `var(--ink-secondary)` (`#475569`): Descriptive copy, subtitles, secondary metadata
  - `var(--ink-muted)` (`#94A3B8`): Captions, timestamps, disabled states
- **Surfaces:**
  - `var(--surface)` (`#FFFFFF`): Primary card background
  - `var(--paper)` (`#F8FAFC`): Application page canvas
- **Borders & Lines:**
  - `var(--line)` (`#E2E8F0`): Primary card and container borders
- **Tints:**
  - `var(--sky-tint)` (`#EFF6FF`): Brand badge/accent backgrounds
  - `var(--mint-tint)` (`#ECFDF5`): Success and mastery badges
  - `var(--amber-50)` / `var(--purple-50)`: Category and rubric backgrounds

---

## 2. Type Scale & Spacing Rhythm

### Typography Rules
- **12px Hard Floor:** No font size below 12px anywhere in student CSS or components.
- **14px Body Default:** Standard reading size for descriptions and cards.
- **16px Marketing Default:** Storefront body text default.

| Token | Pixel Equivalent | Role |
|---|---|---|
| `--fs-xs` | `12px` | Badges, pills, metadata tags |
| `--fs-sm` | `13px` | Secondary buttons, compact cards |
| `--fs-base` | `14px` | Standard body text, form controls |
| `--fs-md` | `16px` | Marketing copy, prominent list items |
| `--fs-lg` | `18px` | Section sub-headings, modal headers |
| `--fs-xl` | `22px` | Section titles, feature headings |
| `--fs-2xl` | `28px` | Dashboard page titles |
| `--fs-hero` | `40px` | Storefront & marketing hero titles |

### Spacing Rhythm
- **Desktop Section Spacing:** `var(--space-section)` = `72px`
- **Mobile Section Spacing:** `var(--space-section-mobile)` = `48px`
- **Card Padding:** `p-5` (mobile) / `p-6` or `p-7` (desktop)
- **Minimum Touch Targets:** `≥44px` on all mobile interactive controls (`min-h-[44px]`).

---

## 3. Shared UI Primitives & Iconography

### 1. One Button Family
Located in `src/components/student/ui/Button.tsx` (and `src/components/ui/mmt/Button.tsx`):
- **Variants:** `primary`, `secondary`, `ghost`, `danger`
- **Sizes:** `sm` (36px, with 44px hit-box padding on touch), `md` (44px), `lg` (48px)
- **Full-width:** `fullWidth` prop for mobile actions

### 2. One Card Family
Located in `src/components/student/ui/Card.tsx`:
- Standardized border (`var(--line)`), radius (`var(--radius-card)`), and shadow (`var(--shadow-card)`).
- Desktop cards preserve visual distinction; mobile renders full-width responsive layout.

### 3. One Focus Rule
Defined globally in `src/app/globals.css`:
```css
:where(a, button, input, select, textarea, [tabindex]):focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
```

### 4. Custom Vector Icons
Located in `src/components/icons/student-icons.tsx`:
- 60+ lightweight custom SVG icons (`stroke="currentColor"`, `strokeWidth="1.75"`, 24×24 viewBox).
- Eliminates `@phosphor-icons/react` bundle overhead in student-facing code.

---

## 4. Motion Specification

All transitions and animations adhere to `src/lib/motion.ts`:
- **Duration Band:** `150ms` – `300ms`
  - `fast`: `150ms`
  - `base`: `200ms`
  - `slow`: `300ms`
- **Easing:** `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out)
- **Accessibility:** Respects `prefers-reduced-motion` by zeroing transition durations.

---

## 5. Navigation Architecture

### Responsive Strategy
| Viewport | Component | Destinations |
|---|---|---|
| **Desktop (≥1024px)** | `CourseStoreShell` Top Bar | Home, Courses, PYQ Packages, Demo, Blog, My Learning, Search, Bell, Profile Menu |
| **Mobile (<1024px)** | `StudentBottomNav` (Logged in) | Home, Courses, Tests, PYQ, Me (5 items, ≥44px hit targets) |
| **Mobile (<1024px)** | `CourseStoreShell` Drawer (Guest) | Courses, PYQ, Demo, Blog, Sign In, Sign Up |

### Notifications System
- Bell button (`StudentBellButton.tsx`) mounted in `CourseStoreShell`.
- Unread count backed by query key `['student-notification-unread']`.
- Popover on desktop / bottom sheet on mobile (`StudentNotificationCenter.tsx`). Zero mock data.

---

## 6. Purchase-State Experience Matrix

The UI dynamically adapts across 4 student purchase states without ever rendering barren or placeholder content:

| State | Hero Headline | Overview Continue Card | Courses Hub (`/student/courses`) | PYQ Detail |
|---|---|---|---|---|
| **0 Purchases (Guest/New)** | "Practise the real exam pattern." | First-purchase prompt card | Redirects to `/courses` | Shows price + "Purchase Package" |
| **Course Only** | "{Name}, pick up where you left off." | Active course progress bar | "My courses" tab selected; PYQ upsell card | Shows price + "Purchase Package" |
| **PYQ Only** | "Your PYQ practice is ready." | PYQ papers resume card | "PYQ packages" tab selected; Course upsell card | Shows "Purchased ✓" + "Continue practice" |
| **Both Owned** | "{Name}, your dashboard is ready." | Most recently active track | Both tabs populated | Unlocked papers list |

---

## 7. Exam Engine & Test Runner Architecture

### Route Isolation & Chrome Suppression
Exam routes require an immersive, distraction-free environment:
- **Predicate:** `isExamEnginePath(pathname)` in `src/lib/routes.ts`
- **Routes Covered:** `/student/tests/[testId]` (Instructions) & `/student/tests/[testId]/runner` (Runner)
- **Behavior:**
  - Header nav and `SiteFooter` in `CourseStoreShell` are suppressed.
  - `StudentBottomNav` and sidebar navigation are suppressed.
  - Fullscreen lifecycle managed by `src/hooks/student/useExamFullscreen.ts`.
  - ESC or unexpected fullscreen exits trigger a soft warning banner with a re-enter CTA.

---

## 8. File Ownership & Boundary Rules

### Student-Owned vs. Admin/Teacher Shared
To prevent regressions across user roles, student files are strictly partitioned:

| Student-Owned Path | Rule |
|---|---|
| `src/app/student/**` | Student portal routes. Never import from `src/app/admin` or `src/app/teacher`. |
| `src/components/student/**` | Student-specific components and UI primitives. |
| `src/components/icons/student-icons.tsx` | Single repository of student vector icons. |
| `src/hooks/student/**` | Student-scoped TanStack Query hooks. |
| `src/services/student/**` | Student REST/Supabase services. Read-only data queries. |

### Strict No-Mock-Data Rule
- Zero hardcoded mock arrays or placeholder strings in student code.
- All empty states use `EmptyState` with honest copy and clear recovery CTAs.
- All errors use `ErrorState` with retry actions.

---

## 9. Backend & Content Owner Action Items (Deferred)

The following items are outside frontend scope and tracked for backend/content teams:
1. **`/student/tests/[testId]` 406 Error:** RLS policy or endpoint configuration on test detail. Handled gracefully on frontend with `ErrorState`.
2. **Junk Database Rows:** Content cleanup for legacy test titles in database.
3. **Subject Localizations in Seed Data:** Ensure database subject names are properly formatted in English across all records.
4. **Blog Content Backend:** Content management system for dynamic articles (currently rendered as a designed coming-soon card at `/blog`).
