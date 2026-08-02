# RLS DELETE-Permission Security Audit — Phase 8 Pre-Implementation

**Status:** Analysis only. No SQL generated. No policies modified.
**Purpose:** Production-grade permission model for Enterprise Soft Delete & Recovery.
**Business rule (absolute):** Only **Super Admin** may delete — soft delete, restore, permanent delete. Teacher, Academic Admin, Finance Admin, Student must never hold DELETE at the database level. Application code is NOT sufficient protection; RLS must enforce it.

---

## 1. Security Findings — Every Table That Exposes DELETE Today

The audit exported and inspected every `create policy` statement across `supabase/migrations/` (021, 022, 023, 024, 032, 048, 050, 051, 057, 071, 074, 075, 076, 077, 080) plus `supabase/patches/`.

### Critical helper-function fact (drives the whole audit)

- `is_admin()` (migration 021) returns TRUE when `profiles.role = 'admin'` — **it does not check `admin_roles.access_status`**. A suspended, revoked, or deactivated admin whose `profiles.role` is still `'admin'` **still passes `is_admin()`** and retains every privilege granted by `is_admin()` policies, including DELETE.
- `is_super_admin()` / `is_academic_admin()` / `is_finance_admin()` / `is_any_admin()` (migration 074) correctly require `admin_roles.access_status = 'approved'`.

### Group A — Admin FOR ALL → DELETE granted to admin types (Super, Academic, Finance, and even revoked admins)

`FOR ALL ... USING (public.is_admin())` is equivalent to granting SELECT + INSERT + UPDATE + **DELETE**. Tables currently exposed (policy `"Admins have full access to <table>"`, migration 021 unless noted):

| # | Table | Policy source | Notes |
|---|-------|--------------|-------|
| 1 | `institutes` | 021 | |
| 2 | `teacher_details` | 021 | |
| 3 | `student_details` | 021 | |
| 4 | `streams` | 021 | re-created super-admin DELETE in 080 |
| 5 | `subjects` | 021 | 080 adds super-admin DELETE |
| 6 | `chapters` | 021 | 080 adds super-admin DELETE |
| 7 | `topics` | 021 | 080 adds super-admin DELETE |
| 8 | `batches` | 021 | 080 adds super-admin DELETE |
| 9 | `batch_students` | 021 | |
| 10 | `batch_teachers` | 021 | |
| 11 | `content_tag` | 021 | |
| 12 | `live_classes` | 021 | |
| 13 | `live_sessions` | 021 | |
| 14 | `live_class_batch` | 021 | |
| 15 | `recordings` | 021 | 080 adds super-admin DELETE |
| 16 | `session_participants` | 021 | |
| 17 | `attendance` | 021 | |
| 18 | `attendance_events` | 021 | |
| 19 | `question_options` | 021 | 080 adds super-admin DELETE |
| 20 | `question_explanations` | 021 | 080 adds super-admin DELETE |
| 21 | `question_images` | 021 | 080 adds super-admin DELETE |
| 22 | `mock_test_questions` | 021 | |
| 23 | `mock_attempts` | 021 | student data |
| 24 | `mock_answers` | 021 | student data |
| 25 | `mock_answer_options` | 021 | student data |
| 26 | `mock_results` | 021 | student data |
| 27 | `pyq_packages` | 021 | 080 adds super-admin DELETE |
| 28 | `pyq_package_unlocks` | 021 | |
| 29 | `pyq_papers` | 021 | 080 adds super-admin DELETE |
| 30 | `pyq_question_mappings` | 021 | |
| 31 | `pyq_solutions` | 021 | |
| 32 | `pyq_mock_mappings` | 021 | |
| 33 | `student_pyq_purchases` | 021 | commerce record |
| 34 | `orders` | 021 | **financial — must never be deletable** |
| 35 | `order_items` | 021 | **financial** |
| 36 | `payments` | 021 | **financial** |
| 37 | `invoices` | 021 | **financial** |
| 38 | `performance_reports` | 021 | analytics |
| 39 | `subject_performances` | 021 | analytics |
| 40 | `chapter_performances` | 021 | analytics |
| 41 | `progress_history` | 021 | analytics |
| 42 | `teacher_analytics` | 021 | analytics |
| 43 | `notification_templates` | 021 | |
| 44 | `notifications` | 021 | ephemeral per-user |
| 45 | `notification_recipients` | 021 | ephemeral per-user |
| 46 | `content` | 021 → **re-created in 075** | now `is_super_admin() OR is_academic_admin()` |
| 47 | `approval_requests` | 021 → **re-created in 075** | now `is_super_admin() OR is_academic_admin()` — approval history |
| 48 | `questions` | 021 → **re-created in 075** | now `is_super_admin() OR is_academic_admin()` |
| 49 | `mock_tests` | 021 → **re-created in 075** | now `is_super_admin() OR is_academic_admin()` |
| 50 | `courses` | 032 | `is_admin()` + institute scoped |
| 51 | `tags` | 021 (`FOR UPDATE` is_admin + separate `"Admins can delete tags"` `FOR DELETE` is_admin) | |
| 52 | `system_settings` | 021 | four separate policies; DELETE = `is_admin()` |

### Group B — Teacher own-resource FOR ALL → DELETE on own rows

`FOR ALL ... USING (teacher_id = get_my_teacher_id())` (or `created_by` for questions):

- `content`, `live_classes`, `questions`, `mock_tests` — teachers can DELETE their own rows today
- `teacher_qualifications`, `teacher_experiences`, `teacher_documents`, `teacher_availability`, `teacher_leave_requests` — teacher profile child tables

### Group C — Student own-data FOR ALL → DELETE on own rows

- `mock_attempts`, `mock_answers`, `mock_answer_options` — **students can delete their own test-history / performance data**
- `student_bookmarks`, `student_downloads`, `student_viewing_history`, `student_personal_notes`, `student_doubts`, `support_tickets`, `feedback_ratings`

### Group D — Explicit FOR DELETE self-service

- `profiles` — `"Users can delete their own profile"` (`auth.uid() = id`). **Any user can delete their own profile row** → cascades/FK fallout.
- `device_tokens` — `"Users can delete their own device tokens"` (`auth.uid() = user_id`).

### Group E — Teacher junction-row FOR DELETE (legitimate business today)

- `live_class_batch` — `"Teachers can delete from live_class_batch for their classes"` (051)
- `batch_subject_live_classes` — `"Teachers can delete from batch_subject_live_classes"` (071)

These are link-row corrections for classes the teacher owns. They conflict with the absolute rule and need a decision (see §4).

### Group F — Additive super-admin-only FOR DELETE (already shipped in migration 080)

17 tables: `questions, question_options, question_images, question_explanations, question_option_images, mock_tests, content, tags, subjects, chapters, topics, streams, pyq_packages, pyq_papers, batches, courses, recordings` — `USING (is_super_admin())`. **Additive only** — they do not remove the older grants above; DELETE is still reachable through Group A/B/C policies.

### Group G — Storage objects (`storage.objects`) delete-own policies

`profile_images`, `teacher_documents`, `content-pdfs`, `content-videos`, `content-thumbnails`, `student-submissions`, `mock-test-assets`, `recordings` (022) and `pyq-pdfs` (057) buckets, plus question-image buckets (023/024: teachers delete own draft uploads, admins delete all). Storage cleanup is a separate concern — relevant only to permanent-purge flows.

### Group H — Tables where DELETE must NEVER exist (enforce, don't assume)

- **`audit_logs`** — no DELETE policy exists AND immutability triggers (migrations 011/076) block UPDATE/DELETE for every role; read is super-admin-only (076). **Already correct.**
- **`trusted_devices`** — status-lifecycle table (077). **Caveat:** `"Super admins can manage trusted_devices"` is `FOR ALL ... is_super_admin()` (077, line 274) — this DOES include DELETE today. Device owner has read-only (`FOR SELECT`). Recommended: replace the FOR ALL with `FOR SELECT/INSERT/UPDATE` and route revocation through the status lifecycle (revoked/expired) rather than DELETE; the one-device replacement is business logic, not row deletion.
- **`orders` / `order_items` / `payments` / `invoices` / `student_pyq_purchases` / `coupons`** — financial integrity; cancel/refund, never DELETE.
- **`approval_requests`** — approval history; keeps soft-delete/restore actions in context.

---

## 2. Risk Assessment

| # | Risk | Severity | Detail |
|---|------|----------|--------|
| R1 | **Admins can DELETE ~52 tables today** | 🔴 Critical | `FOR ALL ... USING (is_admin())` on ~48 tables = DELETE for Super, Academic, Finance — and any user whose profile still says `admin`. A further 4 tables (`questions`, `mock_tests`, `content`, `approval_requests`, via 075) grant DELETE to Super + Academic only (Finance excluded). Directly violates the business rule. |
| R2 | **`is_admin()` ignores suspension/revocation** | 🔴 Critical | A revoked admin keeps DELETE (and all is_admin privileges) because the check is `profiles.role` only, not `admin_roles.access_status = 'approved'`. The RBAC-aware helpers (074) fix this, but 50+ policies still use the legacy helper. |
| R3 | **Students can delete their own performance data** | 🟠 High | `mock_attempts/answers/answer_options` FOR ALL. Destroys analytics/attendance-quality inputs; must become append-only via service RPC. |
| R4 | **Teachers can DELETE their own content/questions/tests** | 🟠 High | `content`, `questions`, `mock_tests`, `live_classes` FOR ALL on own rows. The exact hard-delete paths Phase 8 converts to soft delete. If RLS is tightened before the service conversion ships in the same release, teacher flows break (see §4 ordering). |
| R5 | **Self-service profile DELETE** | 🟠 High | Any user deletes their own `profiles` row → orphaned children, broken FK chains, lost access. Must be revoked; account deletion becomes a status-based/super-admin flow. |
| R6 | **Financial tables deletable by any admin** | 🔴 Critical | `orders/payments/invoices` FOR ALL is_admin. A finance-admin bug or compromise can destroy billing records irreversibly. |
| R7 | **`is_admin()` FOR ALL masks the 080 super-admin DELETE policies** | 🟡 Medium | 080 added correct super-admin-only DELETE, but the older FOR ALL grants remain — so 080 provides no real protection today. False sense of security. |
| R8 | **`FOR ALL` on junction tables** | 🟡 Medium | `batch_*`, `course_*`, `content_tag` link rows deletable by admins/teachers; deleting them is often a "correction" but bypasses audit. |
| R9 | **Audit gap** | 🟡 Medium | Because `.delete()` is currently the only delete mechanism, deletes that succeed via RLS are not necessarily audited. Post-Phase 8, all deletes must route through `auditService.logSoftDelete()`. |

---

## 3. Recommended Permission Matrix

Legend: **DELETE** column = database-level DELETE grant. `✗` = no grant. `✓` = super-admin-only.

| Table / Group | Current DELETE | Recommended DELETE | Rationale |
|---|---|---|---|
| `questions`, `question_options`, `question_images`, `question_explanations`, `question_option_images`, `mock_tests`, `content`, `subjects`, `chapters`, `topics`, `streams`, `tags`, `pyq_packages`, `pyq_papers`, `batches`, `courses`, `recordings` | Admin FOR ALL (A) + teacher own FOR ALL (B) + super-admin 080 (F) | **`✓ is_super_admin()` only** — split FOR ALL into SELECT/INSERT/UPDATE; keep the 080 FOR DELETE | Phase 8 soft-delete targets; hard DELETE = super-admin purge only |
| `institutes`, `teacher_details`, `student_details`, `batch_students`, `batch_teachers`, `content_tag`, `live_sessions`, `session_participants`, `attendance`, `attendance_events`, `mock_test_questions`, `pyq_package_unlocks`, `pyq_question_mappings`, `pyq_solutions`, `pyq_mock_mappings`, `performance_reports`, `subject_performances`, `chapter_performances`, `progress_history`, `teacher_analytics`, `notification_templates`, `system_settings` | Admin FOR ALL (A) | **`✗` no DELETE** (SELECT/INSERT/UPDATE only) | Not soft-delete targets; rows are config/history — never user-deletable |
| `approval_requests` | Super/Academic FOR ALL (075) | **`✗` no DELETE** — SELECT/INSERT/UPDATE only | Immutable approval history |
| `notifications`, `notification_recipients` | Admin FOR ALL (A) | **`✗` no DELETE** (existing soft-delete `is_deleted` covers cleanup) | Ephemeral per-user; delete already handled via flag + triggers |
| `mock_attempts`, `mock_answers`, `mock_answer_options`, `mock_results` | Admin FOR ALL (A) + Student FOR ALL (C) | **`✗` no DELETE** — SELECT/INSERT only (attempts), SELECT only (results). Writes via service RPC | Student performance data; append-only |
| `orders`, `order_items`, `payments`, `invoices`, `student_pyq_purchases` | Admin FOR ALL (A) | **`✗` no DELETE ever** | Financial integrity — cancel/refund only |
| `teacher_qualifications`, `teacher_experiences`, `teacher_documents`, `teacher_availability`, `teacher_leave_requests` | Teacher FOR ALL (B) | **`✗` no DELETE** — teacher keeps SELECT/INSERT/UPDATE | Profile sub-records; removal = status/inactive |
| `student_bookmarks`, `student_downloads`, `student_viewing_history`, `student_personal_notes`, `student_doubts`, `support_tickets`, `feedback_ratings` | Student FOR ALL (C) | **`✗` no DELETE** — SELECT/INSERT/UPDATE | User content; hide/archive instead of delete |
| `profiles` | Self DELETE (D) | **`✗` no DELETE** | Account lifecycle = status-based, super-admin only |
| `device_tokens` | Self DELETE (D) | **`✗` no DELETE** — SELECT/INSERT/UPDATE | Managed by trusted-device service |
| `live_class_batch`, `batch_subject_live_classes` | Teacher FOR DELETE (E) | **Decision required** (see §4.3): `✗` no DELETE via service RPC, OR keep teacher link-row DELETE with RLS-scoped `is_teacher()` if business insists | Link-row corrections |
| `audit_logs` | none + immutability triggers | **`✗` never** (unchanged) | Immutable by design |
| `trusted_devices` | Super-admin FOR ALL (077) — includes DELETE | **`✗` no DELETE** — replace FOR ALL with SELECT/INSERT/UPDATE; revocation via status lifecycle only | Security records; one-device replacement is business logic, not row deletion |
| `storage.objects` | owner/teacher/admins delete-own (G) | Keep storage delete for owners; storage purge only from permanent-delete flow | Storage ≠ DB rows |

**RBAC helper mapping after migration:** every policy that today uses `is_admin()` should move to the RBAC-aware helper appropriate to the operation — `is_super_admin()` for DELETE; `is_any_admin()` (approved role required) for other admin operations where a role-agnostic admin check is intended.

---

## 4. Migration Strategy — Safest Order

> No SQL is produced here; this describes the order and reasoning. The guiding constraint: **never leave a release where RLS denies a delete that the current UI/services still perform.**

### 4.1 Principle — split-then-convert, in the same release

Tightening RLS *before* the Phase 8 service conversion would break every current hard-delete call (teacher deletes own question, admin deletes batch, etc.). Therefore each table's RLS split and its service conversion must ship together. Recommended migration order:

1. **Phase 8B (service layer) first, RLS split second — per table.** Convert `deleteXxx()` → soft delete (`UPDATE deleted_at`), guarded by `canRestoreDeletedData` (Super Admin), audited via `auditService.logSoftDelete()`. Once the app no longer calls `.delete()` for a table, its RLS can be tightened without breaking the UI.
2. **For the 17 Phase-8 target tables:** convert services → then replace the `FOR ALL` admin/teacher policies with `FOR SELECT/INSERT/UPDATE` (same or RBAC-aware helper) + keep the existing 080 `FOR DELETE ... is_super_admin()` as the **only** DELETE grant.
3. **For non-target tables (Group A minus the 17):** these have no Phase 8 soft-delete column. For each, either (a) drop DELETE entirely (SELECT/INSERT/UPDATE only), or (b) if a hard-delete path is genuinely needed later, route it through a super-admin SECURITY DEFINER RPC — never through client DELETE.
4. **Financial tables (`orders`, `payments`, `invoices`, `order_items`, `student_pyq_purchases`):** split to SELECT/INSERT/UPDATE in the very first batch — highest value, no service depends on deleting them.
5. **`profiles` self-delete + student FOR ALL + teacher own FOR ALL:** revoke DELETE in the same release as the service conversions that touch them (lifecycle services already use status-based deactivation — no hard deletes exist there).
6. **Add `permanent_delete` execution path last (Phase 8C+):** a SECURITY DEFINER RPC (e.g. `purge_resource(...)`) that (a) asserts `is_super_admin()`, (b) checks FK dependencies and surfaces friendly errors, (c) calls storage cleanup for files, (d) writes `permanent_delete` audit. With this RPC in place, you may optionally **revoke DELETE from `authenticated` entirely** and let the RPC (security-definer, bypassing RLS) be the only delete mechanism — the cleanest end-state.

### 4.2 Recommended end-state architecture

- **No `FOR ALL` policies remain.** Every policy is one of `FOR SELECT / FOR INSERT / FOR UPDATE / FOR DELETE`.
- **`FOR DELETE` exists on exactly the Phase-8 tables (the 17 in 080) and only for `is_super_admin()`.**
- All other tables: **no DELETE grant at all.** Destructive operations (soft delete on non-target tables, purge, restore) run through SECURITY DEFINER RPCs that internally check `is_super_admin()` — so the "service layer is not enough" concern is answered by the database function gate, not by client-side `.delete()`.
- **Service-role / edge functions:** the admin-identity edge function (SECURITY DEFINER, service role) bypasses RLS by design; it must keep its own role checks. Never add `service_role` DELETE grants to client tables.

### 4.3 Open decision — teacher link-row deletes (Group E)

`live_class_batch` and `batch_subject_live_classes` teacher FOR DELETE are the only *active* DELETE flows that Phase 8 does not replace. Options:
- **Strict (recommended):** revoke; provide a small SECURITY DEFINER RPC `unlink_batch_from_class(...)` that checks `is_teacher()` + ownership, used by the live-class service. Keeps the absolute rule.
- **Pragmatic:** keep `FOR DELETE ... (teacher owns the class)` for these two junction tables only, documented as an explicit exception. Not recommended given the absolute business rule.

---

## 5. Edge Cases

| Edge case | Analysis |
|---|---|
| **Future Recycle Bin (Phase 8C)** | Listing requires `SELECT` of rows with `deleted_at IS NOT NULL` — current SELECT policies (`deleted_at IS NULL` style or raw) must not hide them from super admin. Add a super-admin `FOR SELECT` that sees all rows, or use a SECURITY DEFINER RPC. |
| **Restore** | `UPDATE deleted_at = NULL` — allowed by the future UPDATE policies for super admin (service-guarded + audited via `logRestore`). Ensure the UPDATE policy's `WITH CHECK` doesn't forbid clearing `deleted_at`. |
| **Permanent delete** | Must be SECURITY DEFINER RPC (super-admin check inside), because RLS `FOR DELETE` grants on child tables (question_options etc.) also need the super-admin gate; cascades from a security-definer function bypass RLS safely and can clear children in one transaction. |
| **Cascading deletes / FK** | `ON DELETE CASCADE` chains (e.g., subject→chapters→topics→questions) must be handled inside the RPC transaction; **partial failures are unacceptable** — one transaction or explicit dependency check. `ON DELETE RESTRICT` (e.g., questions referenced by published tests) surfaces friendly errors, never raw PGRST/FK exceptions. |
| **`deleted_by` FK (migration 080)** | `ON DELETE SET NULL` — safe even if a profile is later removed; no trigger re-entry now that the guard trigger was removed in 080 (Phase 8A refactor). |
| **RLS × SECURITY DEFINER RPCs** | RPCs run as the definer (super admin context) — they can delete rows even where client DELETE is revoked. That is the intended end-state; the RPC itself must be the only gate and must validate `is_super_admin()` internally. |
| **Service-role edge functions** | Bypass RLS entirely. They must call the same RPCs (never raw `service_role` `.delete()`) so every destructive path is audited and gated identically. |
| **audit_logs immutability** | Untouched — UPDATE/DELETE blocked by triggers (011/076); only `write_audit_log()` (SECURITY DEFINER) inserts. Confirm no migration ever adds a DELETE policy on it. |
| **`is_admin()` vs RBAC helpers** | Every surviving admin policy must use `is_super_admin()/is_academic_admin()/is_finance_admin()/is_any_admin()` (approved-status aware). Legacy `is_admin()` should be retired from all policies. |
| **Storage cleanup timing** | Files deleted only during permanent purge, never during soft delete (a restored row must keep its images). Storage delete-own policies remain for user uploads. |
| **Backward compatibility** | Existing SELECT/INSERT/UPDATE behaviors must be unchanged by the splits; only the DELETE dimension is removed. Validate with role-based smoke tests (login as each role, assert delete blocked). |

---

## 6. Final Recommendation

1. **Adopt the split-policy model:** eliminate every `FOR ALL` policy; express access as explicit `FOR SELECT/INSERT/UPDATE/DELETE`.
2. **DELETE = `is_super_admin()` only**, and only on the 17 Phase-8 soft-delete tables (already prepared in migration 080). Every other table gets **no DELETE grant**.
3. **Route all destructive operations through SECURITY DEFINER RPCs** (soft delete, restore, permanent purge, link-row unlink) that check `is_super_admin()` internally — satisfying "application code is not sufficient protection" at the database function boundary.
4. **Ship RLS splits together with the Phase 8B service conversions**, table by table, so no release breaks an active delete flow.
5. **Retire `is_admin()` from policies** in favor of the approved-status-aware RBAC helpers; this also fixes the revoked-admin gap (R2).
6. **Never add DELETE to** `audit_logs`, `trusted_devices`, `approval_requests`, or financial tables — enforce via the split (no policy) plus existing immutability triggers.
7. **Recommended sequencing:** (1) financial + `profiles` + student/teacher FOR ALL splits (immediate value, no service deps), (2) Phase-8 tables split alongside 8B conversions, (3) super-admin purge RPC + storage cleanup, (4) Recycle Bin UI (8C), (5) retire `is_admin()` across all remaining policies.

This produces a database where **no non-super-admin user can delete anything**, destructive actions are centrally gated and audited, and Phase 8 (Soft Delete, Restore, Permanent Delete, Recycle Bin) can be built without weakening security.

---
*Audit basis: supabase/migrations 001, 021, 022, 023, 024, 032, 048, 050, 051, 057, 071, 074, 075, 076, 077, 080; supabase/patches. Compiled 2026-08-01.*
