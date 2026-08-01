# Trusted Device Security — Architecture & Implementation Plan (Phase 7A)

> **Status:** Analysis & architecture only. No code, migration, or UI is implemented by this document.
> **Applies to:** Admin web app (`mocktest-admin`, Next.js 15 + Supabase).
> **Scope:** Academic Admin + Finance Admin device approval. Super Admin bypasses.
> **Prereq phases (done):** Multi-Admin RBAC, Admin Management, Secure Admin Creation (Edge Function), Audit Infrastructure (migration 076), Audit Log UI.

---

## 1. Executive Summary

Trusted Device Login adds a **per-profile device trust layer** on top of the existing
phone/password + RBAC stack. When an Academic or Finance Admin signs in from a device that
has not been approved, the sign-in **succeeds** but **admin access is gated** until a Super
Admin approves that device. Approved devices skip the gate on subsequent logins.

Recommended architecture at a glance:

| Concern | Decision |
|---|---|
| Device identity | **Secure random device ID** (server-issued, 256-bit) stored in an **HttpOnly, Secure, SameSite=Strict cookie**; only a **SHA-256 hash** is persisted in Postgres |
| IP address | **Audit-only + secondary anomaly signal.** Never a primary identifier |
| Login gate | Post-auth **device-challenge** edge function; returns `trusted / pending / rejected / revoked / expired / bypass` |
| Approval | Super Admin approves/rejects via **`device-approve`** edge function; in-app notification to requester |
| State | New `trusted_devices` table + `trusted_device_status` enum; RLS: super admin manages all, owner reads own |
| Audit | Reuses migration 076: `device_approve` / `device_revoke` already in `audit_action_type`; request/deny recorded via `create` / `device_revoke` with `resource_type = 'trusted_devices'` |
| Edge Functions | 4 new: `device-challenge`, `device-approve`, `device-revoke`, `device-list` — all reuse `_shared/adminIdentity.ts` |
| Super Admin | Bypasses approval entirely (recorded for audit, never gated) |

**Why this shape:** the existing `admin-identity-create` edge function already establishes the
"verify caller from `admin_roles`, never trust the client, service-role for writes" pattern.
Trusted devices extend that same pattern rather than introducing a new mechanism.

---

## 2. Current Architecture Assessment

### 2.1 Authentication flow (today)

```
LoginView
   └─ AuthContext.signIn(phone, password)
        └─ supabase.auth.signInWithPassword({ phone, password })   // AuthContext.tsx
             ├─ success → setSession / setUser
             └─ loadTeacherProfileDetails(user.id)
                  ├─ profiles.select('*').eq('profile_id', user.id)
                  ├─ role === 'admin' → fetchAdminRoles(user.id)   // admin_roles rows
                  ├─ teacher_details (optional)
                  └─ setTeacherProfile({ ...adminRoles })
```

- Session restore path: `AuthContext` `useEffect` → `supabase.auth.getSession()` →
  `onAuthStateChange` → same `loadTeacherProfileDetails`.
- Post-login routing: `getPostLoginDestination()` in `src/lib/auth/routing.ts`
  (`admin → /admin`, `teacher → /teacher`, pending → `/pending-approval`).
- Route protection: `RoleGuard` (role/status) at layout level + `AdminRouteGuard`
  (permission matrix in `src/lib/admin/routePermissions.ts`) + `PermissionGuard` per page.

### 2.2 Where device verification fits

**Insertion point — after authentication, before admin authorization:**

```
signInWithPassword succeeds        ← authentication (unchanged)
   └─ profile + adminRoles loaded  ← role resolution (unchanged)
   └─ if role is academic_admin | finance_admin:
        └─ device-challenge edge function  ← NEW
             ├─ trusted    → allow /admin (normal flow)
             ├─ pending    → gate screen "Approval requested"
             ├─ rejected / revoked / expired → gate screen with re-request action
             └─ bypass     → super admin, allow
```

Key principle: **the Supabase session is issued regardless** (login is not blocked). Device
trust gates **authorization to the admin workspace**, not authentication. This avoids
breaking session handling, refresh tokens, or the OTP registration flow.

> ⚠️ **Residual authorization gap (design correction, acknowledged).** The gate is enforced
> at the **UI layer**. A pending Academic/Finance admin holds a valid Supabase JWT and could
> call PostgREST directly — existing RLS grants data access by profile role
> (`admin_roles`), **not** by device trust — so they could read admin data by bypassing the
> UI. Accepted residual risk for Phase 7, with mitigations: (1) all **state-changing** admin
> operations that matter run through edge functions / `SECURITY DEFINER` RPCs that re-verify
> authorization (already the pattern); (2) reads remain readable by role but are not
> privileged write paths; (3) optional hardening later — bind an approved-device claim into
> the session or RLS. This must be called out to the client as a known limitation.

### 2.3 Existing building blocks reused

| Building block | Location | Role here |
|---|---|---|
| Edge-function identity helpers | `supabase/functions/_shared/adminIdentity.ts` | `resolveCallerProfileId`, `isApprovedSuperAdmin`, `createAdminClient`, `sanitizeErrorMessage`, `jsonResponse`, `errorResponse`, `structuredLog` |
| RBAC role lookup | `admin_roles` table | determines super/academic/finance; **not** for device trust itself |
| Audit RPC | `write_audit_log()` (migration 076) | `device_approve`, `device_revoke` enum values **already exist**; `create` / `revoke` reuse the snapshot rules |
| Audit service | `src/services/audit/auditService.ts` | `logApprove`, `logRevoke`, `logCreate` helpers — no new service needed |
| Notifications | `notifications` + `notification_recipients`; `createBulkNotification` | Super Admin gets an in-app "device approval requested" notification |
| Permission guards | `PermissionGuard`, `AdminRouteGuard`, `usePermissions` | hide/show device-management UI for Super Admin only |
| Admin identity pattern | `admin-identity-create` | template for all 4 new edge functions |

---

## 3. Device Identification Strategy

### 3.1 Options compared

| Option | Reliability | Security | UX | Verdict |
|---|---|---|---|---|
| Device fingerprint (canvas/WebGL etc.) | High false positives; breaks on browser updates | Weak — spoofable, nondeterministic | Silent breakage | ❌ |
| Browser fingerprint (UA + screen + plugins) | Low; mostly identical across users | None | Bad | ❌ |
| **Secure random device ID (cookie)** | **High — cryptographically unique per device** | **Strong — 256-bit, hash-at-rest** | **Silent (HttpOnly)** | ✅ **Primary** |
| Refresh-token binding | High while session lives | Medium — dies with session | none | 🟡 Secondary |
| Cookie-based device identifier | High persistence | Medium if not signed | Silent | 🟡 variant of above |
| IP address | Very low (mobile, VPN, dynamic) | None | — | ❌ identity |
| Combination approach | Highest | Highest | Silent | ✅ **Recommended** |

### 3.2 Recommended architecture (combination)

**Primary — secure random device ID:**

1. Server generates a **256-bit random token** (`crypto.getRandomValues`, URL-safe base64)
   on first unknown-device login.
2. The token is stored as cookie `td_device` with flags:
   - `HttpOnly` — **never readable by JS** (XSS-safe)
   - `Secure`
   - `SameSite=Strict` (or `Lax` if cross-subdomain needs arise)
   - `Max-Age = 365 days` (refreshable)
3. Only **`SHA-256(device_token)`** is persisted in `trusted_devices.device_token_hash`.
   A DB leak cannot be replayed as a valid device token.
4. The edge function re-derives the hash from the cookie on every challenge; no plaintext
   token ever reaches Postgres or the browser bundle.

> ⚠️ **Cookie-set mechanics (design correction).** `supabase.functions.invoke()` is a
> **cross-origin** call (`*.functions.supabase.co` vs. the app origin). Browsers silently
> drop `Set-Cookie` from cross-site responses unless `SameSite=None; Secure` — so an edge
> function cannot reliably persist a `SameSite=Strict` cookie directly. **Recommended
> path:** `device-challenge` returns the token in the **response body**, and a
> **same-origin Next.js route handler / middleware** sets the `td_device` cookie on the app
> origin. If a cookie-from-edge-function approach is ever preferred instead, the cookie must
> be `SameSite=None; Secure` and the trade-off documented.

**Secondary signals (never identity, always signals):**

- `user_agent` + a coarse fingerprint hash (UA family + OS + screen resolution + timezone)
  stored on the device row for display and anomaly spotting.
- `session_id` (existing Supabase session) recorded per challenge in the audit metadata.
- Refresh-token binding is **not** used as the trust mechanism — device trust must outlive
  individual sessions.

### 3.3 IP Address analysis

**IP alone is not a reliable identity signal:**

| Scenario | Effect on IP |
|---|---|
| Mobile networks (4G/5G) | IP rotates per connection / NAT |
| Office Wi-Fi | All staff share one public IP |
| VPN | Stable but shared / spoofable |
| Dynamic ISP | Changes periodically |
| ISP/geo changes | Legitimate logins from new regions |

**Recommendation:**

| Use | Verdict |
|---|---|
| Primary identifier | ❌ Never |
| Secondary anomaly signal | 🟡 Yes — record `last_ip_address` on the device row; flag "new IP for this device" in the approval card |
| Audit only | ✅ Yes — `write_audit_log` already persists `ip_address` per event |

---

## 4. Database Recommendation (Phase 7B)

### 4.1 New enum

```sql
create type public.trusted_device_status as enum (
  'pending',      -- waiting for super admin approval
  'approved',     -- active, trusted
  'rejected',     -- denied by super admin
  'revoked',      -- previously approved, now removed
  'expired'       -- auto-expired (expires_at passed)
);
```

### 4.2 New table — `trusted_devices`

```sql
create table public.trusted_devices (
  device_id            uuid primary key default gen_random_uuid(),
  profile_id           uuid not null,            -- FK -> profiles.profile_id (the admin)
  institute_id         uuid not null,            -- FK -> institutes (denormalized for RLS)
  device_token_hash    text not null,            -- SHA-256 of the random cookie token
  device_name          text not null,            -- e.g. 'Chrome on Windows 11'
  fingerprint_hash     text null,                -- coarse UA/fingerprint hash (signal only)
  last_ip_address      inet null,                -- most recently seen IP (display/anomaly)
  user_agent           text null,
  status               public.trusted_device_status not null default 'pending',
  requested_at         timestamptz not null default now(),
  approved_at          timestamptz null,
  approved_by          uuid null,                -- FK -> profiles (super admin)
  last_used_at         timestamptz null,
  expires_at           timestamptz null,         -- optional per-device expiry
  rejection_reason     text null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint uq_trusted_devices_profile_token unique (profile_id, device_token_hash)
);
```

### 4.3 Indexes

```sql
create index idx_trusted_devices_profile_status  on public.trusted_devices (profile_id, status);
create index idx_trusted_devices_institute_status on public.trusted_devices (institute_id, status);
create index idx_trusted_devices_queue on public.trusted_devices (institute_id, status, requested_at desc);
```

### 4.4 RLS

- **Super Admin:** full CRUD within their institute (mirrors `admin_roles` policy style).
- **Owner admin:** `SELECT` on their own rows only (for "My Devices" screen).
- **Teachers / Students:** no access.
- **Writes** happen via edge functions (service role), so no `INSERT`/`UPDATE` policy is
  strictly required for the challenge/approve paths. `SELECT` policies only.

### 4.5 Notification types

The `notification_event_type` enum needs new values (pattern already used by migrations 047,
054, 055):

- `device_approval_requested`
- `device_approved`
- `device_rejected`

---

## 5. Login Flow (detailed)

### 5.1 Academic / Finance Admin, known + approved device

```
signInWithPassword → profile + adminRoles
   → AuthContext detects academic_admin|finance_admin
   → device-challenge (cookie td_device present)
        → hash matches approved row, expires_at not passed
        → status='approved' → update last_used_at → { trusted: true }
   → normal routing to /admin (existing getPostLoginDestination)
```

### 5.2 Unknown device (first login on that browser)

```
   → device-challenge (no cookie)
        → server generates 256-bit token, returns it in the response body;
          the same-origin route handler sets the HttpOnly td_device cookie (see §3.2)
        → inserts trusted_devices row (status='pending', hash, fingerprint, ip)
        → createBulkNotification → all approved super admins of institute
           ("New device approval requested — Academic Admin, Chrome/Windows, 202.xx")
        → { trusted: false, status: 'pending' }
   → AuthContext sets deviceStatus='pending'
   → gate screen: "Device approval requested. A Super Admin has been notified."
   → optional lightweight polling (every 20–30s) or manual refresh → re-run challenge
        → once super admin approves → { trusted: true } → continue to /admin
```

### 5.3 Rejected / revoked / expired device

```
   → device-challenge → { trusted: false, status: 'rejected' | 'revoked' | 'expired' }
   → gate screen with reason + "Request access again" button
        → re-request sets status='pending' again (new row or reset), re-notifies
```

### 5.4 Super Admin

```
   → device-challenge → { trusted: true, status: 'bypass' }  (never gated)
   → optionally upsert a device row for audit visibility (status='approved', approved_by=self)
```

### 5.5 Session restore (page refresh)

- `getSession()` path runs the same challenge before mounting `/admin` routes; a cached
  `trusted=true` flag is **not** trusted — the cookie + edge function re-verify on each
  boot and on `SIGNED_IN` / `TOKEN_REFRESHED` events.

---

## 6. Approval Flow

```
Unknown device login
   → trusted_devices(status='pending')
   → notification → Super Admin (in-app)
   → Super Admin opens /admin/device-approvals
        → card: admin name, role, device name, fingerprint hash, IP, requested_at
        → Approve  → device-approve edge fn → status='approved', approved_by, approved_at
                     → audit logApprove('device_approve', resource='trusted_devices')
                     → notify requester ("Device approved — you can now sign in")
        → Reject (with reason) → status='rejected'
                     → audit via 'device_revoke' or new 'device_reject' (see 7.4)
                     → notify requester
   → requester's gate screen picks up new status (poll/refresh) → access granted
```

Lifecycle states: `pending → approved → revoked/expired` and `pending → rejected`
(no transitions back to approved without a new request).

**Guard rails:**
- One admin may have **at most N pending requests** (e.g. 3) — prevents notification spam.
- Rejecting is reversible only by a **new request** (fresh `pending`), not by editing history.
- Approving does **not** change `admin_roles` — device trust is orthogonal to RBAC.

---

## 7. Edge Function Design

All functions follow the `admin-identity-create` pattern: resolve caller from JWT, verify
authorization from `admin_roles` via service role, sanitize errors, never expose raw DB text.

### 7.1 `device-challenge` (POST) — called by AuthContext after admin sign-in

```
1. resolveCallerProfileId(authHeader) → profileId | 401
2. serviceClient → profiles (role, institute_id) + admin_roles (approved roles)
3. if approved super_admin → { trusted: true, status: 'bypass' }  (optionally upsert row)
4. if NOT academic_admin|finance_admin (teacher/student) → 403 (shouldn't be called)
5. read cookie `td_device`
     - absent → issue new token (crypto.getRandomValues → base64url), return it in the
               response body (same-origin route handler sets the HttpOnly cookie — §3.2)
               → insert trusted_devices(status='pending', hash=f(device), fingerprint, ip)
               → createBulkNotification → super admins
               → return { trusted:false, status:'pending', deviceId }
     - present → sha256(cookie) → lookup trusted_devices(profile_id, hash)
               → approved & !expired → touch last_used_at → { trusted:true, status:'approved' }
               → pending      → { trusted:false, status:'pending' }
               → rejected/revoked/expired → { trusted:false, status }
6. write_audit_log (action='create' or 'failed_login' style record per 7.4)
```

Security notes:
- The token is returned in the response body; the **same-origin Next.js route handler** sets
  the `td_device` cookie (HttpOnly, Secure, SameSite=Strict, Max-Age 365d). See §3.2
  correction — the edge function itself cannot set a Strict cookie cross-origin.
- The token is never stored in JS-accessible storage (cookie is HttpOnly).
- Only the hash is persisted.

> ⚠️ **Audit actor derivation (design correction).** `write_audit_log()` derives the actor
> from `auth.uid()` (migration 076 — "never trust client-supplied profile IDs"). If the
> edge function calls the RPC through the **service-role client**, `auth.uid()` is NULL and
> every `device_approve` / `create` / `device_revoke` event records `profile_id = null`
> (system actor) — losing accountability. **Edge functions must invoke `write_audit_log`
> with a client bound to the caller's JWT (`createCallerClient`) so the actor resolves to
> the real admin.** Service-role writes are reserved for data changes only.

### 7.2 `device-approve` (POST) — Super Admin only

```
1. resolveCallerProfileId → isApprovedSuperAdmin(serviceClient, profileId) → 403 if not
2. body: { deviceId, decision: 'approve'|'reject', reason? }
3. approve → update status='approved', approved_by, approved_at
     → write_audit_log(action='device_approve', resource='trusted_devices', resource_id=deviceId,
        new_value={status:'approved', profile_id, device_name})
     → notify requester ("Device approved")
4. reject → status='rejected', rejection_reason
     → write_audit_log(action='device_revoke' OR 'device_reject', reason)
     → notify requester
```

### 7.3 `device-revoke` (POST) — Super Admin (or owner for own device)

```
→ status='revoked'
→ write_audit_log(action='device_revoke', resource='trusted_devices', old_value={status:'approved'})
→ requester's next challenge returns 'revoked'
```

### 7.4 `device-list` (GET)

- Super Admin: pending queue + all devices (institute-scoped).
- Owner admin: own devices only (`profile_id = caller`).
- Powers `/admin/device-approvals`, `/admin/trusted-devices`, `/admin/my-devices`.

### 7.5 Audit action mapping

| Event | action | old_value | new_value | reason |
|---|---|---|---|---|
| Device requested (first login) | `create` (or new `device_request`) | null | `{status:'pending'}` | — |
| Device approved | `device_approve` (exists in 076) | null | `{status:'approved'}` | — |
| Device rejected | `device_revoke` (exists) **or** add `device_reject` | `{status:'pending'}` | null | rejection reason |
| Device revoked | `device_revoke` (exists) | `{status:'approved'}` | null | revoke reason |
| Device login (trusted) | `login` (existing) | null | null | metadata device_id |
| Failed challenge | `failed_login` (exists) | null | null | metadata |

> **Recommendation:** keep migration 076 untouched; reuse `device_approve` / `device_revoke`
> and record the *request* as `create` with `resource_type='trusted_devices'`. If a distinct
> "requested" or "rejected" action is desired for filtering, add
> `device_request` / `device_reject` in the Phase 7B migration — cheap and idempotent.

---

## 8. Security Design

| Threat | Mitigation |
|---|---|
| Token theft (XSS) | HttpOnly + Secure cookie; token never in JS reach |
| DB leak → token replay | Only SHA-256 hash stored; leak gives nothing usable |
| Token theft (physical/network) | SameSite=Strict + TLS; per-device revoke kills it instantly |
| Stolen/lost device | Super Admin revoke; next login shows `revoked` |
| Replay of challenge response | Challenge is read-only (state check); writes are idempotent (`ON CONFLICT` / unique constraint) |
| Notification spam | Cap pending requests per profile (e.g. 3); dedupe per device |
| Suspicious login detection | New device + known profile = pending (normal flow); **actual anomaly flags** = IP change on an already-approved device, multiple failed challenges, or a pending-request flood (dedupe/cap) |
| Expired device reuse | `expires_at` checked on every challenge; optional auto-expiry job or lazy transition |
| Compromised Super Admin | Existing RBAC unchanged; Super Admin device is recorded but never auto-approved when created by others — super admin can still be revoked via `admin_roles` |

**Explicitly not needed:** device-level MFA (out of scope), biometrics, IP allowlists.

---

## 9. UI Roadmap (future phases)

### 9.1 Super Admin screens

| Screen | Route | Content |
|---|---|---|
| Device Approvals | `/admin/device-approvals` | Pending queue cards: admin, role, device, IP, requested_at, Approve / Reject(reason); permission-gated (`canManageAdmins`) |
| Trusted Devices | `/admin/trusted-devices` | All devices, status chips, revoke, expiry; filters by status/admin |
| (history) | reuse `/admin/audit-logs` | `trusted_devices` resource events already visible |

### 9.2 Academic / Finance Admin screens

| Screen | Route | Content |
|---|---|---|
| My Devices | `/admin/my-devices` | Own approved/pending/revoked devices; revoke own device; request again |
| Login gate | inline component | Shown post-login when `trusted=false`: pending/rejected/revoked states |

### 9.3 Navigation

- Sidebar: **Device Approvals** + **Trusted Devices** visible only when
  `canManageAdmins` (reuse existing permission — no new permission required).
- Notifications deep-link: `device_approval_requested` → `/admin/device-approvals`.

---

## 10. Risks

1. **Cookie loss (private browsing, cookie clearing)** — user re-approves; acceptable, but
   mitigations: friendly re-request flow; optional "remember this browser" note.
2. **Lockout while waiting for approval** — gate is UI-level; the admin still holds a valid
   session but no admin UI. Super Admin can approve quickly; provide an escape (contact/support).
3. **Multiple admins on shared devices** — device rows are per `profile_id`; a shared computer
   means each admin needs their own approval (documented behavior).
4. **Super Admin device compromise** — mitigated by existing RBAC; consider requiring
   super-admin approval for *other* super admins' devices in a later phase (out of scope).
5. **Notification delivery latency** — in-app only for now; push (dispatch-notification) is a
   natural extension.
6. **Edge case: backfilled admins** — all current admins are `super_admin` (backfill), so the
   gate does not break anyone today; newly created Academic/Finance admins (via
   `admin-identity-create`) will face the gate on their first login — expected.

---

## 11. Recommended Implementation Phases

| Phase | Scope | Outcome |
|---|---|---|
| **7B** | Migration: `trusted_device_status` enum, `trusted_devices` table, indexes, RLS, optional `device_request`/`device_reject` audit values, notification event types | DB ready, backward compatible |
| **7C** | Edge functions: `device-challenge`, `device-approve`, `device-revoke`, `device-list` (+ `_shared` helper additions) | Secure device layer exists |
| **7D** | Backend service + hooks: `trustedDeviceService.ts`, `useTrustedDevices.ts`, query keys | Frontend has typed API |
| **7E** | Login gate integration: AuthContext `deviceStatus`, gate component, routing to `/admin` only when trusted | Gate enforced |
| **7F** | Admin UI: approvals queue, trusted devices list, My Devices, sidebar + permission wiring | Full feature UI |
| **7G** | Audit + notifications polish, poll/refresh UX, testing checklist, E2E | Production ready |

---

## 12. Deliverables check

| Requested | Provided |
|---|---|
| Recommended architecture | §1, §3.2 |
| Device identification strategy | §3 |
| Login flow | §5 |
| Approval flow | §6 |
| Database recommendation | §4 |
| Edge Function design | §7 |
| Audit integration | §7.5 |
| UI roadmap | §9 |
| Risks | §10 |
| Implementation phases | §11 |
