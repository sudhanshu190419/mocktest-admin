# Phase 8C — Enterprise Recycle Bin & Restore: Design Document

> **Status:** ANALYSIS ONLY. No code was written. This document is the complete
> architectural analysis for the Enterprise Recycle Bin, grounded in the
> **actual current state** of the repository (verified by direct inspection of
> Migration 080, the Phase 8B-converted services, `auditService`, the permission
> layer, `routePermissions`, and storage services).

---

## 1. Current State: Soft-Delete Column Inventory

### 1.1 Tables that HAVE `deleted_at` / `deleted_by` / `delete_reason` (17 total)

All added by **Migration 080** (verified in `supabase/migrations/080_soft_delete_foundation.sql`),
each with a partial index `(deleted_at) WHERE deleted_at IS NULL` and an
`fk_<table>_deleted_by → profiles(profile_id) ON DELETE SET NULL` constraint:

| Group | Tables |
|---|---|
| Full columns (new in 080) — 15 | `questions` · `question_options` · `question_images` · `question_explanations` · `question_option_images` · `mock_tests` · `content` · `tags` · `subjects` · `chapters` · `topics` · `streams` · `pyq_packages` · `pyq_papers` · `recordings` |
| Metadata only (already had `deleted_at`) — 2 | `batches` (003) · `courses` (032) |

**Audit enum:** `permanent_delete` was added to `audit_action_type` by Migration 080
(verified — line 1 of the migration).

### 1.2 Tables still WITHOUT soft-delete (intentionally excluded — verified)

- **`audit_logs`** — immutable by design (triggers block UPDATE/DELETE). Never soft-delete.
- **`trusted_devices`** — security records; status lifecycle (revoked/expired) already exists.
- **`approval_requests`** — history/audit trail.
- **`orders` / coupons / financial tables** — financial integrity; cancel/refund instead.
- **`notifications`** — per-user ephemeral; already has per-recipient `is_deleted`.
- **Junction/link tables** (`batch_subject_*`, `course_*`, `mock_test_questions`, `pyq_*_mappings`, `content_tag`) — deleting a link is a correction, not data loss.
- **`mock_attempts` / answers / results** — student performance data; GDPR-style purge is a separate legal matter.

### 1.3 Remaining HARD deletes in the service layer (must be addressed by 8C)

These child-level `.delete()` calls still exist and are **not** routed through soft delete:

| Service function | Table | Impact |
|---|---|---|
| `questionExplanationService.deleteQuestionExplanation` | `question_explanations` | Direct `.delete()` (has `deleted_at` from 080!) |
| `questionImageService.deleteQuestionImage` | `question_images` | `.delete()` + storage file delete |
| `questionOptionService.deleteQuestionOption` | `question_options` | `.delete()` (FK-guarded vs student answers) |
| `questionOptionImageService` (delete paths) | `question_option_images` | storage file delete + row delete |

**Recommendation:** these are *child-correction* deletes invoked during editing
(removing one image/option/explanation), distinct from the resource-level soft
delete. Two options: (a) convert them to soft-delete too (they have columns),
or (b) keep them hard as "edit corrections" and rely on the parent question's
soft-delete for recovery. **Recommended: (a) convert** — the columns already
exist, the cost is trivial, and it guarantees a restored question always has
its full child set. **Decision needed before 8C.1 — see §11 step 2 where this
decision point is carried forward.**

---

## 2. Restore Logic per Resource

| Resource | Always restorable? | Validation required before restore |
|---|---|---|
| **Questions** | ✅ Yes | Parent subject/chapter/topic must not be deleted. Options/images/explanations restored in the same cascade. |
| **Question children** | ✅ Yes (with parent) | Only via parent cascade restore; never individually from the Bin. |
| **Mock Tests** | ✅ Yes | Parent subject/chapter still exist. Published/archived state preserved exactly. Attempts are untouched (they reference the test row, which still exists). **Purge note:** `mock_test_questions` junction rows reference `mock_tests` — before purge, verify whether that FK is CASCADE (silent junction cleanup) or RESTRICT (purge blocked); junction rows are never soft-deleted, but their fate on purge must be decided explicitly. |
| **Content** | ✅ Yes | Parent subject/chapter exist. Approval status (`pending_approval`/`published`/`draft`) preserved. |
| **Subjects** | ✅ Yes | Chapters/topics/questions restored together (cascade). |
| **Chapters** | ✅ Yes | Parent subject not deleted. Children (topics/questions) cascade. |
| **Topics** | ✅ Yes | Parent chapter not deleted; questions cascade. |
| **Streams** | ✅ Yes | Subjects beneath it cascade. **⚠️ Verify:** whether `streamService.deleteStream` (8B) actually cascades soft-delete to subjects — only the subject→chapter→topic→question chain is confirmed; treat stream→subjects as a design decision to confirm in 8C.1. |
| **Tags** | ✅ Yes | No dependents (junction `content_tag` unaffected). |
| **Batches** | ✅ Yes | `deleted_at` cleared; assignments (`batch_subject_*`, students) are untouched (links were never deleted). |
| **Courses** | ✅ Yes | Same — enrollments/assignments untouched. |
| **Recordings** | ⚠️ Partially | Storage file must still exist in R2. If the periodic purge already deleted the file, restore must surface a clear "file no longer available" state. **Recommend removing/gating the auto-purge (see §4).** |
| **PYQ Packages** | ✅ Yes | Parent stream/institute exist. **Papers cascade.** |
| **PYQ Papers** | ✅ Yes | Parent package not deleted. PDFs in `pyq_pdfs` bucket must still exist. |

**Key rule (from the Phase 8 design):** *restore never changes a resource's
business status* — it only clears `deleted_at`. A `published` item restores as
`published` (preserving `approved_at`/`published_at`), a `draft` restores as
`draft`, a `pending_approval` item re-enters the approval queue as-is. The only
exception: **archived items are blocked from soft-delete in the first place**
(dual-state ambiguity) — already the Phase 8 rule.

---

## 3. Cascade Restore Matrix

Restore must mirror the soft-delete cascade. Soft-delete already cascades
downward (verified: `deleteQuestion` soft-deletes options + option images;
`deleteSubject` is designed to cascade chapters→topics→questions in Phase 8B).
Restore must be **bottom-up within one transaction**:

```
Streams        → Subjects        → Chapters → Topics → Questions → options/images/explanations
Courses        → (enrollments/assignments untouched)
Batches        → (batch_subject_* links untouched)
Mock Tests     → (mock_test_questions untouched — links never deleted)
PYQ Packages   → PYQ Papers → (pyq_question_mappings / pyq_mock_mappings untouched)
```

**Which need automatic child restore (recommended ✅):**
- Subject → Chapters → Topics → Questions (+ children) — full hierarchy
- PYQ Package → Papers (a restored package must not be empty/partial)
- Stream → Subjects (if a stream is in the Bin with its subjects)

**Which do NOT cascade (recommended ❌):**
- Batch → assignments (links never deleted — nothing to restore)
- Mock Test → questions (junction rows were never deleted)
- Course → enrollments/assignments (never deleted)

**Constraint:** cascade restore must be **atomic** (single `SECURITY DEFINER`
RPC or transaction), mirroring `approve_trusted_device` precedent. Partial
restore would re-expose orphaned children.

---

## 4. Permanent Delete (Purge) — Cleanup Requirements

Nothing should be orphaned. Per resource, purge must clean:

| Resource | Storage cleanup | DB cleanup |
|---|---|---|
| Questions + children | Delete `question_images` / `question_option_images` files (via existing `storageDeleteFile`) | Hard delete rows (FK-guarded — will fail if referenced by published tests/attempts → surface friendly error) |
| Content | Delete attachments (existing `contentService` storage deletes) | Hard delete row |
| Mock Tests | — | Hard delete row (blocked by FK if attempts exist — surface friendly error) |
| Recordings | **Delete R2 file** (reuse `recording-delete` edge function) | Hard delete row |
| PYQ Packages/Papers | Delete PDFs in `pyq_pdfs` bucket | Hard delete rows |
| All | — | `approval_requests` / audit references are NOT deleted (they are history and reference by ID — safe) |

**⚠️ Critical existing risk (verified):** `recordingService` has a **periodic
purge job** (~line 697 area) that permanently deletes soft-deleted recordings
after a cutoff. This would destroy recoverable data. **Must be gated to
Super Admin explicit purge or removed before 8C ships.**

**Rule:** storage file deletion happens **ONLY in permanent purge** — never at
soft-delete time (soft-deleted items keep their files so restore works).

### 4.1 Notifications & purged-resource references

The user requirement explicitly lists **Notifications** under "nothing should be
orphaned." Verified behavior: notifications carry resource IDs as free-form
payload (they are per-recipient, soft-deleted via `is_deleted`, never hard
removed), so a purged resource leaves notification rows referencing a now-gone
ID. Recommended handling:

1. **Delete/soft-delete → notify owner** (reuse existing notification service):
   "Your {resource} '{title}' was moved to the Recycle Bin by the Super Admin."
2. **Restore → notify owner** that their resource is back (same generic type).
3. **Permanent delete → notify owner** that the resource was permanently
   removed. This is the point where the notification may reference a purged
   resource ID — that is acceptable (history), but mark the resource as
   purged in the payload (`{ resourceType, resourceId, purged: true }`).

No new notification infrastructure; reuse existing types/helpers only.

---

## 5. Trash Service Design (`src/services/admin/trashService.ts`)

One reusable service, mirroring the project's `ApiResponse` + `extractErrorMessage`
convention. **Every method gated by `canRestoreDeletedData` (Super Admin only)** —
mirroring `approvalGuard.ts` style, enforced in the service itself.

```
trashService
├── listDeleted(filters, sort, pagination)  → PaginatedResponse<TrashItem>
│     filters: resourceType[], deletedBy, dateFrom/dateTo, search (title + reason)
│     implementation: per-type query with deleted_at IS NOT NULL, UNION ALL,
│     or a single RPC. Recommend an RPC (SECURITY DEFINER) for perf + one round trip.
├── getItem(resourceType, id)               → TrashItem + preview payload
├── restore(resourceType, id, reason?)      → clears deleted_at (+ cascade children, atomic)
├── permanentlyDelete(resourceType, id, reason) → real DELETE + storage cleanup (+ audit)
├── bulkRestore(items[])                    → per-item restore in a loop w/ aggregate result
├── bulkDelete(items[])                     → per-item purge w/ aggregate result
└── (internal) resourceRegistry             → { resourceType: { table, titleColumn, parentFk,
                                              cascadeChildren[], storageCleanup?, validators[] } }
```

**TrashItem shape** (union per type, or a normalized view):

```ts
interface TrashItem {
  resourceType: 'questions' | 'mock_tests' | 'content' | 'subjects' | 'chapters'
    | 'topics' | 'streams' | 'tags' | 'batches' | 'courses' | 'recordings'
    | 'pyq_packages' | 'pyq_papers';
  resourceId: string;
  title: string;                 // name/Title from each table
  deletedAt: string;
  deletedBy: string | null;      // profile_id — MAY BE NULL (FK ON DELETE SET NULL
                                 // when the actor profile was later removed)
  deletedByName?: string | null; // joined for display; tolerate null actor
  deleteReason: string | null;
  status: string | null;         // business status snapshot for preview
}
```

**Performance:** each table's `(deleted_at) WHERE deleted_at IS NULL` partial
index also serves `deleted_at IS NOT NULL` scans (they are complementary).
A UNION-ALL RPC with per-type LIMIT + an outer pagination is the production
answer for large bins. Add `totalCount` per type for the summary cards.

---

## 6. Admin Recycle Bin UI (`/admin/trash`)

Reuse the admin design system (verified components: `PageHeader`, `DataTable`,
`StatusBadge`, `EmptyState`, `SearchBar`, `ConfirmDialog`, `Skeleton`).

- **Route:** `/admin/trash` — enable the **already-planted placeholder** in
  `routePermissions.ts` (verified, currently commented):
  `{ prefix: '/admin/trash', permission: 'restoreDeletedData' }` → uncomment.
- **Layout:** summary cards (total / this week / per-type counts) → filterable,
  paginated table grouped by resource type.
- **Filters:** resource type (multi-select chips), deleted-by (**tolerate null
  actors** — the FK is `ON DELETE SET NULL`, so "deleted by" may be empty for
  old rows), date range, free-text search across title + reason (debounced,
  server-side).
- **Row actions:** Preview (expandable: reason, deleted-by, deleted date, status)
  · Restore (ConfirmDialog) · Permanent Delete (ConfirmDialog, mandatory reason,
  lists consequences).
- **Bulk actions:** bulk restore + bulk permanent delete with selection
  checkboxes + aggregate result summary.
- **Permission:** Super Admin only — sidebar item gated by `canRestoreDeletedData`
  (already exposed by `usePermissions`, verified), route gated by
  `routePermissions`, service gated by `canRestoreDeletedData`.

**New files:** `src/app/admin/trash/page.tsx`, `src/hooks/admin/useTrash.ts`,
`src/components/admin/trash/*` (filter bar, item preview, dialogs).

---

## 7. Permission Model — Recommendation

**Super Admin only** for all three actions (soft delete is already enforced;
restore + purge follow the same matrix):

| Action | Super Admin | Academic Admin | Finance Admin | Teacher | Student |
|---|:---:|:---:|:---:|:---:|:---:|
| View Recycle Bin | ✅ | ❌ | ❌ | ❌ | ❌ |
| Restore | ✅ | ❌ | ❌ | ❌ | ❌ |
| Bulk Restore | ✅ | ❌ | ❌ | ❌ | ❌ |
| Permanent Delete | ✅ | ❌ | ❌ | ❌ | ❌ |
| Bulk Permanent Delete | ✅ | ❌ | ❌ | ❌ | ❌ |

This is **already fully wired** (verified):
- `permissionService.canRestoreDeletedData()` → `super_admin` only ✅
- `usePermissions()` exposes `canRestoreDeletedData` ✅
- `AdminPermission` union includes `'restoreDeletedData'` ✅
- Delete buttons across admin/teacher pages are already gated by
  `canRestoreDeletedData` (verified in batches, courses, questions,
  mock-tests, content review, recordings pages) ✅

**Recommendation:** do **NOT** extend to Academic/Finance Admin. The client
requirement is absolute: only Super Admin deletes or restores. Keep it.

---

## 8. Audit Events

| Event | Action (enum) | Helper |
|---|---|---|
| Restore (single) | `restore` | `auditService.logRestore` (exists ✅) |
| Permanent Delete | `permanent_delete` | **`logPermanentDelete` must be added** — enum value exists in DB (080) but the TS `AuditAction` union does NOT yet include `'permanent_delete'` (verified — union ends at `device_revoke`) |
| Bulk Restore | `restore` + metadata `{ count, items[] }` | reuse `logRestore` |
| Bulk Delete | `permanent_delete` + metadata `{ count, items[] }` | reuse new `logPermanentDelete` |

**Verified gap to fix in 8C.1:** add `'permanent_delete'` to the `AuditAction`
union in `src/types/audit.ts` and add a `logPermanentDelete` helper to
`auditService` (thin wrapper over `log()`, matching the existing pattern).
This is a 5-line change; no audit infrastructure redesign.

Metadata captured per event: `resourceType`, `resourceId`, `resourceName`,
`reason` (mandatory for purge), `deleted_by` actor (derived server-side by
`write_audit_log` RPC).

---

## 9. Restore Validation Checklist

Before clearing `deleted_at`, the trashService must validate (per registry entry):

1. **Parent exists** — subject/chapter/topic/package/stream not deleted (and not itself in the Bin awaiting restore).
2. **Parent is restorable** — if the parent is also deleted, restore parent first (or cascade).
3. **Unique constraints** — name/title uniqueness (e.g., a duplicate name created after deletion). Recommend: allow restore even on duplicate (unique index may or may not exist per table); surface a warning if it would collide, or auto-suffix. **Decision needed.**
4. **Storage exists** (recordings/PDFs/images) — if the file is gone, restore still restores the row and marks the preview as "file missing."
5. **Status intact** — never flip business status; only clear `deleted_at`.
6. **Not archived** — archived items should never reach the Bin (Phase 8 rule); enforce defensively.

---

## 10. Risk Analysis

| Risk | Severity | Mitigation |
|---|---|---|
| **Recording auto-purge destroys recoverable data** | 🔴 High | Gate/remove the periodic purge before 8C ships (verified risk at `recordingService` ~697). |
| Restore re-exposes orphans (partial cascade) | 🔴 High | Atomic cascade RPC (SECURITY DEFINER), mirroring `approve_trusted_device`. |
| Storage leaks on purge | 🟠 Med | Purge-only storage cleanup per resource registry; never at soft-delete time. |
| FK RESTRICT on purge (question in published test / mock with attempts) | 🟠 Med | Friendly error message (existing FK-guard pattern reused). |
| Duplicate unique keys after restore | 🟠 Med | Validation + explicit decision (block vs auto-suffix). |
| Large bins / UNION-ALL performance | 🟠 Med | RPC with per-type LIMIT + outer pagination; partial indexes already present. |
| Child hard deletes bypass recovery (option/image/explanation) | 🟠 Med | Convert child deletes to soft delete in 8C.1 (§1.3). |
| Archive vs soft-delete confusion | 🟡 Low | Clear UI labels; archived items blocked from Bin. |
| TS `AuditAction` missing `permanent_delete` | 🟡 Low | Add union member + helper in 8C.1 (verified gap). |

---

## 11. Implementation Plan (safest order)

**Phase 8C.1 — Backend Restore APIs (foundation)**
1. Add `'permanent_delete'` to `AuditAction` union + `logPermanentDelete` helper (verified gap).
2. **Decision point:** convert the 4 child hard-deletes (§1.3) to soft delete
   (columns exist) — recommended (a); alternatively keep as edit-corrections.
3. Gate/remove the recording auto-purge.
4. Per-resource restore functions: `UPDATE ... SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL WHERE id = $1` + cascade children (atomic, per hierarchy). **Verify stream→subjects cascade behavior** (see §2).
5. **Decide `mock_test_questions` purge FK behavior** (CASCADE cleanup vs RESTRICT block) before 8C.4.

**Phase 8C.2 — Trash Service**
5. `trashService.ts` with `resourceRegistry`, `listDeleted`, `restore`,
   `permanentlyDelete`, `bulkRestore`, `bulkDelete`, all gated by
   `canRestoreDeletedData`.
6. Optional: single `SECURITY DEFINER` RPC for UNION-ALL list + atomic cascade restore.

**Phase 8C.3 — Admin Recycle Bin UI**
7. Uncomment `/admin/trash` in `routePermissions`; add sidebar item (Super Admin only).
8. `/admin/trash` page + `useTrash` hooks + filter/search/group + preview.
9. Restore dialogs (single) — reuse `ConfirmDialog`.

**Phase 8C.4 — Permanent Delete**
10. Purge actions + storage cleanup per registry + mandatory-reason dialog listing consequences.

**Phase 8C.5 — Bulk Actions**
11. Bulk restore + bulk purge with aggregate results + audit metadata counts.

**Validation gate at each phase:** `tsc --noEmit`, review with
code-reviewer, manual test matrix (restore each of the 13 resource types;
purge with FK conflicts; cascade restore subject→chapter→topic→question;
recording file-missing path; permission denial for non-Super-Admins).

---

## 12. Files Impacted (complete list)

**Modify:** `src/services/audit/auditService.ts` (+`logPermanentDelete`),
`src/types/audit.ts` (+`'permanent_delete'`), `src/lib/admin/routePermissions.ts`
(uncomment trash route), `src/components/admin/AdminSidebar.tsx` (+trash item),
`src/services/recording/recordingService.ts` (purge gating), the 4 child-delete
services (`questionExplanationService`, `questionImageService`,
`questionOptionService`, `questionOptionImageService`).

**Create:** `src/services/admin/trashService.ts`, `src/hooks/admin/useTrash.ts`,
`src/app/admin/trash/page.tsx`, `src/components/admin/trash/*`.

**No DB changes required** — Migration 080 already provides every column,
index, FK, and the `permanent_delete` enum value. Optional (8C.2): one
`SECURITY DEFINER` RPC for UNION-ALL listing + atomic cascade restore.
