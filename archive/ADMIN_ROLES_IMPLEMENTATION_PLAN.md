# Admin Roles Implementation Plan

**Super Admin · Academic Admin · Finance Admin**

*Analysis-only document. No code was modified.*

---

## 1. Executive Summary

The current system has exactly **one** admin role (`profiles.role = 'admin'`). The client
wants to split it into **Super Admin**, **Academic Admin**, and **Finance Admin**.

The good news: the architecture was explicitly designed RBAC-ready.

- `profiles.role` is already an enum-backed column with a documented extension path
  (`src/types/auth.ts` says *"Extend this union when adding new roles"*).
- An append-only **`audit_logs`** table already exists (Migration 011) with actions for
  `approve`, `reject`, `login`, `restore`, `view_sensitive`, etc.
- A **`system_settings`** key-value store already exists (Migration 011).
- An **`approval_requests`** workflow table already exists (Migration 004) covering
  content and mock tests; **questions** have their own status-based approval
  (`pending_approval → published | draft | archived`).
- Commerce tables (`orders`, `payments`, `invoices`, coupons) already exist with
  admin-scoped RLS.

**Verdict:** This is an **additive change, not a redesign**. No existing table needs to
be dropped or re-shaped. The work is: one new authorization table, a few new RLS helper
functions, service-layer permission scoping, one new OTP-gated finance access flow, and
frontend navigation/page gating.

---

## 2. Current Architecture Assessment

| Layer | Current State |
|---|---|
| **Identity** | `auth.users` (Supabase Auth) — phone + password, phone OTP verification |
| **Profile** | `profiles` table — `role` (enum: `admin, teacher, student, user`), `account_status` (pending/approved/rejected/suspended/inactive), `institute_id` |
| **Role creation** | `handle_new_user()` trigger reads `raw_user_meta_data.role`, defaults to `'user'` |
| **RLS helper functions** | `is_admin()`, `is_teacher()`, `is_student()` — all `SECURITY DEFINER`, check `profiles.role` |
| **Admin RLS pattern** | ~40+ tables have `using (public.is_admin())` policies |
| **Frontend guard** | `RoleGuard allowedRoles={['admin']}` on `/admin/layout.tsx` |
| **Routing** | `getPostLoginDestination()` → `'admin'` → `/admin` |
| **Approval infra** | `approval_requests` (content/mock_test) + `questions.status` (question approval) |
| **Audit infra** | `audit_logs` (append-only, admin-read RLS, no app writes yet) |
| **Settings infra** | `system_settings` (per-institute key-value) |
| **Commerce** | `/admin/commerce/*` (orders, payments, courses, pyq) — all gated by `is_admin()` |
| **Soft delete** | Partial: batches, courses, recordings, notifications are soft-delete; questions, mock tests, content, PYQs, streams/subjects/chapters/topics are **hard delete** |

---

## 3. Compatibility Score

**8.5 / 10 — Highly compatible.**

What already supports this change:

- ✅ RBAC-ready `role` column + documented extension path
- ✅ `audit_logs` + `system_settings` already in the schema
- ✅ `approval_requests` generic workflow (resource_type + status)
- ✅ Question approval lifecycle already built (approve/reject/archive/restore)
- ✅ Commerce module already separated into its own route group `/admin/commerce`
- ✅ Institute scoping (`institute_id`) on every RLS policy

What does NOT exist yet:

- ❌ A second admin-role axis (only a single `role` value; no `admin_role` column/table)
- ❌ Approval workflow for **live classes** and **PYQ packages** (teacher can publish directly)
- ❌ Soft-delete columns on questions / mock tests / content / PYQs / academic structure
- ❌ Application-level writes to `audit_logs` (table exists, nothing populates it)
- ❌ An OTP-gated access-grant mechanism for finance admins
- ❌ An "Audit Logs" or "Deleted Items / Restore" screen in the admin UI
- ❌ The sidebar's "Approval Center" route (`/admin/approvals`) has **no page** (dead link)

---

## 4. Required Database Changes

### 4.1 The one new table: `admin_roles` (recommended)

Keep `profiles.role = 'admin'` for **all** admins (so existing RLS keeps working), and add
a granular authorization table:

```text
admin_roles
├── admin_role_id    uuid PK
├── profile_id       FK → profiles          (the admin user)
├── admin_role       enum: super_admin | academic_admin | finance_admin
├── institute_id     FK → institutes        (denormalized for RLS)
├── access_status    enum: pending | approved | suspended | revoked
├── access_granted_at timestamptz
├── granted_by       uuid FK → profiles     (super admin who granted access)
├── created_at / updated_at
├── UNIQUE (profile_id, admin_role)
└── CHECK (admin_role = 'finance_admin' → access_status lifecycle only)
```

Why this over extending the `user_role` enum:

| Approach | Pros | Cons |
|---|---|---|
| Add `super_admin/academic_admin/finance_admin` to `user_role` | Simplest; no new table | Pollutes the *identity* enum with *authorization* values; every RLS `is_admin()` and every frontend `role === 'admin'` check must be rewritten; a user can't hold two admin hats; enum migration churn |
| **New `admin_roles` table (recommended)** | Identity vs authorization separated; existing `is_admin()` RLS untouched; supports multiple hats; enables `access_status` + `granted_by` + OTP-gated grants natively | One new table + helper functions |

### 4.2 New enums

- `admin_role` → `super_admin | academic_admin | finance_admin`
- `admin_access_status` → `pending | approved | suspended | revoked`
- Add `'role_change'` and `'permission_change'` to the existing `audit_action_type` enum
- Add `'live_class'` and `'pyq_package'` to `approval_resource_type` (for academic admin approvals)

### 4.3 Soft-delete columns (additive)

Add `deleted_at timestamptz NULL` (and optionally `deleted_by uuid`) to:

- `questions`
- `mock_tests`
- `content`
- `pyq_packages`, `pyq_papers`
- `live_classes`
- `streams`, `subjects`, `chapters`, `topics`
- `batch_subjects` (currently hard-deleted with cascade)

All existing list queries filter `deleted_at IS NULL` (pattern already used by
`batches`, `courses`, `recordings`).

### 4.4 Tables that need NO structural change

`profiles`, `orders`, `payments`, `invoices`, `coupons` (existing commerce), `approval_requests`,
`audit_logs`, `system_settings`.

---

## 5. Required Backend Changes

### 5.1 New RLS helper functions (supabase)

```text
is_super_admin()       → exists admin_roles where profile_id = auth.uid()
                           AND admin_role = 'super_admin' AND access_status = 'approved'
is_academic_admin()    → same for 'academic_admin'
is_finance_admin()     → same for 'finance_admin' AND access_status = 'approved'
is_any_admin()         → is_admin() OR exists any approved admin_roles row
```

### 5.2 Services (src/services)

| Service | Change |
|---|---|
| `authService.ts` | No auth change; profile fetch stays. Optionally attach `adminRoles` to the returned profile |
| **New** `admin/adminRoleService.ts` | CRUD admin roles, grant/revoke/suspend, list admins, check role |
| **New** `admin/financeAccessService.ts` | Request grant → super-admin approve → OTP issue/verify → grant session |
| **New** `admin/auditLogService.ts` | Write + query `audit_logs` (first app-level writer) |
| **New** `admin/restoreService.ts` | Restore soft-deleted questions/mock tests/content/PYQs/live classes |
| `questionApprovalService.ts` | Add `is_academic_admin()` check (or keep `is_admin()` if RLS-scoped) |
| `content/approvalService.ts` | Same |
| `mockTestManagementService.ts` | Same |
| `dashboardService.ts` | Role-aware stats (academic sees approvals; finance sees revenue; super sees all) |
| `commerceService.ts` | Add finance-admin permission gate at the service layer |

### 5.3 Permission model

- **RLS** remains tenant-scoped (`is_admin()` covers all admins) — **defense in depth**.
- **Service layer** enforces functional scoping:
  - Academic admin → question/content/mock-test approval endpoints only
  - Finance admin → commerce endpoints only
  - Super admin → everything (including granting finance access, audit logs, restore)
- This avoids rewriting ~40 RLS policies while still enforcing the business rules.

---

## 6. Required Frontend Changes

| Area | Change |
|---|---|
| `src/types/auth.ts` | `UserRole` unchanged; add `AdminRole` union + optional `adminRoles: AdminRole[]` on `UserProfile` |
| **New** `src/hooks/useAdminRole.ts` | Expose `{ role, hasRole, isSuperAdmin, isAcademicAdmin, isFinanceAdmin, loading }` |
| `src/components/auth/RoleGuard.tsx` | Keep as-is (still `['admin']` for the whole area); add a finer `AdminRoleGuard` if needed |
| `src/components/admin/AdminSidebar.tsx` | Filter menu by admin role: Super → all items + Admins + Audit Logs + Restore; Academic → Dashboard, Approvals, Question Bank, Mock Tests, Content; Finance → Dashboard, Commerce |
| **New** Admin management screen | `/admin/admins` — super admin manages admin roles, grants, suspensions |
| **New** Finance access screen | `/admin/access-pending` — finance admin login lands here until super admin approves + OTP |
| **New** Audit log screen | `/admin/audit-logs` — super admin only |
| **New** Deleted items / restore screen | `/admin/trash` or per-module restore buttons |
| **Fix** Approval Center | The sidebar links to `/admin/approvals` but no page exists — create it (this is where Academic Admin works) |
| `src/app/admin/page.tsx` | Role-aware dashboard widgets (academic → approval queues; finance → revenue; super → all) |
| `src/lib/auth/routing.ts` | `'admin'` still → `/admin`; the admin home then routes to the right default module by role |

---

## 7. Required Authentication Changes

**None to the core auth flow.** Identity (phone + password + Supabase session) stays.

The finance-admin OTP is **not** an auth-layer change:

- Finance admin signs in normally (role = `admin`, `admin_role = finance_admin`, `access_status = pending`)
- They land on an "access pending super-admin approval" screen
- Super admin approves the grant in `/admin/admins`
- Finance admin clicks "Request access" → OTP sent via existing phone-OTP infra
  (`signInWithOtp` / `resendOtp` pattern already in `authService.ts`)
- Finance admin enters OTP → `access_status` flips to `approved` → access granted
- Grant is **time-boxed** (configurable via `system_settings`, e.g. `finance_access_ttl_hours`)

This is an **authorization + approval workflow**, implemented on top of the existing
session — exactly the recommended pattern for this requirement.

---

## 8. Required RLS Changes

1. **Keep** all existing `using (public.is_admin())` policies untouched → all three admin
   types keep working immediately (zero risk to current admin functionality).
2. **Tighten 3 tables to super-admin-only** (replace `is_admin()` with `is_super_admin()`):
   - `audit_logs` (read)
   - `system_settings` (all)
   - `admin_roles` (new — only super admins manage it)
3. **Finance tables** (`orders`, `payments`, `invoices`, coupons): optionally add
   `is_finance_admin()` alongside `is_admin()` in policy comments — but keep enforcement
   at the service layer to avoid churning ~10 policies. If the client insists on DB-level
   blocking, create a second set of policies using `is_finance_admin() OR is_super_admin()`.
4. `approval_requests` policies: unchanged (`is_admin()` already covers academic admin).

---

## 9. Required API Changes

| API area | Change |
|---|---|
| Admin role management | New endpoints: list admins, grant role, revoke, suspend, change role |
| Finance access | New endpoints: request-access, super-admin approve, send-otp, verify-otp, check-grant-status |
| Audit logs | New endpoints: query audit logs (filter by institute/actor/action/resource/time-range) |
| Restore | New endpoints: restore soft-deleted resources (per entity type) |
| Approvals | Extend to live classes + PYQ packages; existing question/content/mock-test endpoints gain academic-admin gating |
| Dashboard | Add `adminRole` to the stats request so the dashboard renders role-appropriate widgets |

---

## 10. Soft Delete Strategy

### 10.1 Current hard-delete inventory (from code audit)

| Entity | Delete mechanism today |
|---|---|
| `batches` | ✅ Soft (`deleted_at`) |
| `courses` | ✅ Soft (`deleted_at`) |
| `recordings` | ✅ Soft (`is_deleted` + `deleted_at`) |
| `notifications` | ✅ Soft (`is_deleted`) |
| `questions` | ❌ Hard (RESTRICT FK protects dependents) |
| `mock_tests` | ❌ Hard |
| `content` | ❌ Hard |
| `pyq_packages` / `pyq_papers` | ❌ Hard |
| `streams` / `subjects` / `chapters` / `topics` | ❌ Hard |
| `live_classes` | ❌ Hard (teacher-side delete) |
| `batch_subjects` | ❌ Hard (cascade to junction tables) |
| Junction tables (assignments) | ❌ Hard — correct, keep as-is (assignments should be removable) |

### 10.2 Recommendation

- Add `deleted_at` + `deleted_by` to the ❌ rows listed above (questions, mock tests,
  content, PYQ packages/papers, live classes, academic structure).
- **Do NOT soft-delete junction/assignment rows** — removing an assignment is a legitimate
  operation and should remain a hard delete.
- **Restoration:** `UPDATE ... SET deleted_at = NULL`. Restore must be super-admin-only,
  audit-logged with `action = 'restore'` (enum value already exists).
- Archive/restore lifecycles already exist for questions (`published ⇄ archived`) — this
  is a separate, existing concept and should not be confused with soft delete.

---

## 11. Audit Log Strategy

The `audit_logs` table is already production-shaped (append-only, immutable triggers,
indexed by institute/actor/resource/action/IP). Today **nothing writes to it** — that's the
gap.

### 11.1 What to instrument

| Event | Suggested `action` |
|---|---|
| Create / update / delete | `create`, `update`, `delete` |
| Soft delete | `soft_delete` |
| Restore | `restore` (exists) |
| Approval / rejection | `approve`, `reject` (exist) |
| Login / logout | `login`, `logout` (exist) |
| **Role change / permission change** | **`role_change`, `permission_change` (must be added to enum)** |
| Finance grant / revoke | `permission_change` + metadata |
| OTP issued/verified | `login` + metadata `{ otp_channel, flow: 'finance_access' }` |
| Sensitive views (payments, bank details) | `view_sensitive` (exists) |

### 11.2 Where to write

1. **Application service layer** (recommended): call `auditLogService.log(...)` from
   approval services, lifecycle services, admin role service, commerce service. Uses the
   authenticated user's JWT; the Supabase client with the user's role can only **insert**
   via a dedicated `security definer` function (`log_audit_event(...)`) because RLS blocks
   direct inserts and the immutability triggers block updates/deletes.
2. Optional DB triggers for high-traffic tables later (login events, role changes) — but
   start with the service layer to keep the blast radius small.

### 11.3 Reading audit logs

Super-admin-only screen backed by the new `auditLogService.list(...)` query.

---

## 12. Finance Admin OTP Strategy

**Recommended architecture: Authorization + Approval Workflow (not an auth-layer change).**

```
Finance Admin signs in (role='admin', admin_role='finance_admin', access_status='pending')
        │
        ▼
"Access pending Super Admin approval" screen
        │
Super Admin approves grant (Admin → Admins → Grant Finance Access)
        │
        ▼
Finance Admin clicks "Request Access" → OTP sent to registered phone
        │
        ▼
Finance Admin enters OTP → verify against Supabase Auth OTP
        │
        ▼
access_status = 'approved'  (TTL enforced via system_settings)
```

Why this approach:

- **Authentication stays with Supabase** — no custom session system, no new JWT logic.
- The **OTP step reuses the existing phone-OTP plumbing** (`supabase.auth.signInWithOtp`
  + `verifyOtp` already in `authService.ts`).
- **Grant is revocable and time-boxed** — `access_status` + TTL in `system_settings`
  (`finance_access_ttl_hours`), matching the existing `system_settings` pattern.
- Every step (grant, revoke, OTP issue, verify, expiry) writes an `audit_logs` row.
- If a shorter-lived grant is required later, upgrade the OTP verification to mint a
  short-lived custom claim or a one-time access token — but that's a Phase-2 enhancement,
  not required now.

---

## 13. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Academic admin accidentally gets finance access | **High** | Service-layer gates + finance RLS (`is_finance_admin()`) on sensitive tables; never grant finance access automatically |
| Hard deletes destroy data before restore ships | **High** | Ship soft-delete columns *before* any restore/trash UI; audit all current hard-delete call sites |
| Existing admins lose access during migration | **Medium** | `is_admin()` RLS untouched; seed existing `admin` profiles into `admin_roles` as `super_admin` (backfill) |
| `audit_logs` grows unbounded | **Medium** | Partition by month before go-live (comment in Migration 011 already flags this); retention setting in `system_settings` |
| OTP flow abused (repeated requests) | **Medium** | Rate-limit via `system_settings` (`otp_attempt_limit`); lock after N failures; audit every attempt |
| Dead "Approval Center" sidebar link confuses admins | **Low** | Create the page as part of the Academic Admin scope |
| Finance admin sees academic menu items | **Low** | Sidebar filtered by `useAdminRole()` |

---

## 14. Recommended Implementation Order

### Phase 0 — Backfill & Safety (no UI)
1. Migration: `admin_role` + `admin_access_status` enums, `admin_roles` table, RLS
   (super-admin only), helper functions `is_super_admin()/is_academic_admin()/is_finance_admin()/is_any_admin()`.
2. Backfill: every existing `profiles.role = 'admin'` → `admin_roles(profile_id, 'super_admin', 'approved')`.
3. Migration: soft-delete columns on questions, mock tests, content, PYQs, live classes, academic structure.
4. Migration: add `role_change`/`permission_change` to `audit_action_type`; add
   `live_class`/`pyq_package` to `approval_resource_type`.
5. `auditLogService` + `log_audit_event()` security-definer function.

### Phase 1 — Backend
6. `adminRoleService` (grant/revoke/suspend/list).
7. `restoreService` + restore endpoints.
8. `financeAccessService` (request → approve → OTP → verify → TTL).
9. Gate `commerceService` + approval services by admin role at the service layer.
10. Role-aware `dashboardService`.

### Phase 2 — Admin UI
11. `useAdminRole` hook + sidebar filtering.
12. Admin management screen (`/admin/admins`) — super admin.
13. Finance access / OTP screens — finance admin.
14. Audit logs screen (`/admin/audit-logs`) — super admin.
15. Approval Center (`/admin/approvals`) — academic admin (fix dead link).
16. Restore/Trash UI (super admin) + soft-delete buttons.
17. Role-aware admin dashboard home.

### Phase 3 — Hardening
18. Finance RLS policies (DB-level blocking, optional).
19. Audit instrumentation across lifecycle/approval/commerce services.
20. Rate limiting + lockout for finance OTP.
21. Performance: monthly partitioning for `audit_logs`; index review on `admin_roles`.

---

## 15. Answers to the "IDENTIFY" Questions

| # | Question | Answer |
|---|---|---|
| 1 | Which DB tables need modification? | Add `admin_roles` table; add soft-delete columns to ~10 tables; extend 2 enums. No existing table needs reshaping |
| 2 | Is a new admin table required? | **Yes** — `admin_roles` (the single cleanest change) |
| 3 | Do existing profile tables support multiple admin roles? | Partially — `profiles.role` is single-valued. It supports *identifying* an admin, but a second table is needed for *which* admin |
| 4 | Which services need modification? | dashboard, questionApproval, content/approval, mockTestManagement, commerce + 4 new services |
| 5 | Which screens need modification? | AdminSidebar, admin home, + 5 new screens (admins, finance access, audit logs, approvals, restore) |
| 6 | Which APIs need modification? | Approval APIs (gating), dashboard (role-aware) + 4 new API groups |
| 7 | Which RLS policies need modification? | Only ~3 (audit_logs, system_settings, admin_roles → super-admin). The other 40+ stay as-is |
| 8 | Which auth flow must change? | None. Finance OTP is an authorization/approval layer on the existing session |
| 9 | Does the current role system support multiple admin roles? | The *foundation* does (RBAC-ready enum + RLS helpers), but it needs the `admin_roles` table to represent multiple admin types without rewriting 40+ policies |

---

*Prepared from a full audit of: `profiles`/`user_role` migrations (002, 045, 046),
`audit_logs`/`system_settings` (011), `approval_requests` (004), RLS helper functions
(021), auth service/types/context, RoleGuard, admin layout/sidebar, dashboard service,
approval services, and the admin page inventory.*
