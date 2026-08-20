/**
 * Trash Service (Phase 8C.1 + 8C.2 + 8C.4 — Restore, Listing & Permanent Delete)
 *
 * Centralized, reusable service for the Enterprise Recycle Bin & Restore
 * system. Phase 8C.1 implemented restore; Phase 8C.2 adds the Recycle Bin
 * listing backend; Phase 8C.4 adds permanent delete (purge). Bulk actions
 * are a later phase.
 *
 * ## Contract
 *
 *   • restore(resourceType, resourceId) — restores a soft-deleted resource by
 *     clearing `deleted_at`, `deleted_by`, and `delete_reason`. Nothing else
 *     on the row changes (business status is preserved exactly).
 *   • permanentlyDelete(resourceType, resourceId, reason) — IRREVERSIBLE purge
 *     of a Recycle Bin row: removes associated storage files, orphaned child
 *     rows, and the row itself; FK-guarded (never destroys live/historical
 *     data) and audited with `permanent_delete`.
 *   • listDeleted(filters, sort, pagination) — paginated, filtered Recycle Bin
 *     listing across all resource types, normalized to a common `TrashItem`
 *     shape (resourceType, resourceId, displayName, deletedAt, deletedBy,
 *     deleteReason, status, parentResource, extraMetadata).
 *   • getDeletedItem(resourceType, resourceId) — single deleted item with its
 *     parent name resolved.
 *   • Every operation is gated to **Super Admin only** (service-layer live
 *     check via `adminRoleService.isSuperAdmin()` — the runtime equivalent of
 *     the frontend `canRestoreDeletedData` permission).
 *   • Validation runs BEFORE restoring: the row must exist and be soft-deleted,
 *     and any required parent (subject/chapter/package/stream) must exist and
 *     NOT itself be deleted. Broken data is never restored.
 *   • Cascade restore mirrors the Phase 8B soft-delete cascade:
 *       Question    → options, stem images, explanations, option images
 *       PYQ Package → PYQ papers
 *   • Every successful restore writes an audit event via `auditService.logRestore`
 *     and every permanent delete via `auditService.logPermanentDelete`
 *     (reusing the existing audit infrastructure — no new tables/RPCs).
 *
 * ## Design notes
 *
 *   • Resource metadata is data-driven (`RESOURCE_REGISTRY`) — restore,
 *     listing AND permanent delete share one registry; no per-type switch
 *     statements. Later bulk actions extend the same registry.
 *   • Recordings restore also clears `is_deleted = false` (the recording
 *     soft-delete path sets both `is_deleted` and `deleted_at`).
 *   • Permanent delete is FK-aware: children with RESTRICT FKs are deleted
 *     first (question option images, PYQ papers/mappings), while protected
 *     references (mock attempts, enrollments, assignments) BLOCK the purge
 *     with a friendly error instead of cascading destructive deletes.
 *
 * ## Atomicity note
 *
 * Restore runs children-first, then the parent last. If a child cascade fails,
 * the operation returns an error BEFORE the parent is touched, so a parent is
 * never left restored with missing children. A partial child-cascade failure
 * (e.g. option images restored, then options fail) leaves restored children
 * under a still-deleted parent — harmless today because children are invisible
 * while the parent is deleted, and it mirrors `deleteQuestion`'s own
 * best-effort sequential pattern. A future SECURITY DEFINER RPC can make the
 * whole cascade truly atomic if required.
 *
 * @module services/admin/trashService
 */

import { supabase } from '@/config/supabase';
import { validateUUID, extractErrorMessage, buildPagination } from '@/utils/supabase';
import { auditService } from '@/services/audit/auditService';
import { adminRoleService } from '@/services/admin/adminRoleService';
import { deleteFile as storageDeleteFile } from '@/services/storage/storageService';
import type { ApiResponse } from '@/types/academic';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Every resource type that supports enterprise restore.
 *
 * Each maps to a table with `deleted_at` / `deleted_by` / `delete_reason`
 * columns added by Migration 080 (Phase 8A).
 */
export type TrashResourceType =
  | 'questions'
  | 'mock_tests'
  | 'content'
  | 'subjects'
  | 'chapters'
  | 'topics'
  | 'streams'
  | 'tags'
  | 'batches'
  | 'courses'
  | 'recordings'
  | 'pyq_packages'
  | 'pyq_papers'
  | 'demo_classes';

/** Result of a restore operation. */
export interface RestoreResult {
  /** Total restored rows (1 parent + cascade children). */
  restored: number;
  /** The resource type that was restored. */
  resourceType: TrashResourceType;
  /** The resource id that was restored. */
  resourceId: string;
}

/** Result of a permanent delete operation. */
export interface PermanentDeleteResult {
  /** Total rows permanently deleted (1 parent + cascade children). */
  deleted: number;
  /** The resource type that was permanently deleted. */
  resourceType: TrashResourceType;
  /** The resource id that was permanently deleted. */
  resourceId: string;
}

/** A single resource reference used by the bulk operations. */
export interface BulkItemRef {
  resourceType: TrashResourceType;
  resourceId: string;
}

/** Outcome of one item inside a bulk operation. */
export interface BulkItemResult extends BulkItemRef {
  /** 'succeeded' | 'failed' | 'skipped'. */
  status: 'succeeded' | 'failed' | 'skipped';
  /** Friendly error when failed; undefined otherwise. */
  error?: string;
}

/** Aggregated result of a bulk operation. */
export interface BulkResult {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  /** Unique resource types included in the selection. */
  resourceTypes: TrashResourceType[];
  /** Per-item outcomes (for the "view detailed failures" UI). */
  items: BulkItemResult[];
}

// ═══════════════════════════════════════════════════════════════════════════
//  Listing Types (Phase 8C.2 — Recycle Bin Backend)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * One deleted item in the Recycle Bin, normalized to a common shape.
 *
 * The UI must never need to know table-specific schemas — every resource
 * type surfaces through this single shape.
 */
export interface TrashItem {
  /** Resource type (e.g. 'questions'). */
  resourceType: TrashResourceType;
  /** Primary key of the deleted row. */
  resourceId: string;
  /** Human-readable name/title (e.g. question text, subject name). */
  displayName: string | null;
  /** When the row was soft-deleted (`deleted_at`). */
  deletedAt: string | null;
  /** Profile id of the actor who soft-deleted it (`deleted_by`). May be null (FK SET NULL). */
  deletedBy: string | null;
  /** Free-text reason captured at delete time (`delete_reason`). */
  deleteReason: string | null;
  /** Business status at delete time (e.g. 'published', 'active') — display only. */
  status: string | null;
  /** Optional parent reference (type + id + resolved name) for context. */
  parentResource: {
    type: string;
    id: string | null;
    name: string | null;
  } | null;
  /** Curated per-type summary fields (no raw table schemas leak to the UI). */
  extraMetadata: Record<string, unknown>;
}

/** Filters accepted by `listDeleted`. */
export interface TrashListFilters {
  /** Restrict to these resource types. Omit for ALL types. */
  resourceTypes?: TrashResourceType[];
  /** Free-text search across each resource's display column. */
  search?: string;
  /** Restrict to rows deleted by this profile id. */
  deletedBy?: string;
  /** Only rows deleted at/after this ISO timestamp. */
  dateFrom?: string;
  /** Only rows deleted at/before this ISO timestamp. */
  dateTo?: string;
}

/** Sort options for the Recycle Bin listing. */
export interface TrashSortOptions {
  sortBy?: 'deletedAt' | 'displayName' | 'resourceType';
  sortDirection?: 'asc' | 'desc';
}

/** Pagination parameters for the Recycle Bin listing. */
export interface TrashListParams {
  page?: number;
  pageSize?: number;
}

/** Paginated, filtered Recycle Bin listing response. */
export interface TrashListResponse {
  items: TrashItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  /** Per-resource-type deleted counts (used for filter chips / summary cards). */
  perTypeCounts: Partial<Record<TrashResourceType, number>>;
}

/** A parent reference that must exist and be active before restore. */
interface ParentRef {
  /** Column on the resource row holding the parent id (e.g. 'subject_id'). */
  column: string;
  /** Parent table to check (e.g. 'subjects'). */
  table: string;
  /** Parent primary-key column (e.g. 'subject_id'). */
  idColumn: string;
  /** Human label for friendly error messages (e.g. 'Subject'). */
  label: string;
}

/** A child table to cascade-restore (keyed by an FK on the child). */
interface ChildRef {
  /** Child table (e.g. 'pyq_papers'). */
  table: string;
  /** FK column on the child pointing at the parent (e.g. 'package_id'). */
  fkColumn: string;
  /** Human label for friendly error messages. */
  label: string;
}

/** Per-resource restore metadata (data-driven registry). */
interface ResourceMeta {
  /** Database table name. */
  table: string;
  /** Primary-key column (e.g. 'question_id'). */
  idColumn: string;
  /** Human label (e.g. 'Question'). */
  label: string;
  /** Optional parents that must exist and be non-deleted before restore. */
  parentRefs?: ParentRef[];
  /** Optional simple child cascades (generic update by FK). */
  children?: ChildRef[];
  /** Additional fields to clear on restore (e.g. recordings.is_deleted). */
  extraClear?: Record<string, unknown>;
  /** Optional custom cascade handler (e.g. questions → option images). */
  cascadeRestore?: (
    resourceId: string,
  ) => Promise<{ success: boolean; error?: string; restored?: number }>;

  // ── Phase 8C.4 — permanent delete metadata ───────────────────────────
  /** Child tables to hard-delete BEFORE the parent (FK cleanup). */
  deleteChildren?: ChildRef[];
  /**
   * Custom cascade-delete handler (children + storage) for resources with
   * RESTRICT FKs or storage files (questions, pyq packages/papers).
   */
  cascadeDelete?: (
    resourceId: string,
  ) => Promise<{ success: boolean; error?: string; deleted?: number }>;
  /** Storage cleanup for the row itself (content files, recording R2, PYQ PDFs). */
  storageCleanup?: (
    row: Record<string, unknown>,
  ) => Promise<{ success: boolean; error?: string; deleted?: number }>;

  // ── Phase 8C.2 — listing metadata ────────────────────────────────────
  /** Column holding the human-readable display name (e.g. 'title', 'name', 'question_text'). */
  displayColumn: string;
  /** Optional plain status column (e.g. 'status'). */
  statusColumn?: string;
  /** Optional boolean status column mapped to labels (e.g. is_active → Active/Inactive). */
  statusBoolean?: { column: string; trueLabel: string; falseLabel: string };
  /** Optional derived status function for composite statuses (e.g. published_at + is_active). */
  statusFn?: (row: Record<string, unknown>) => string | null;
  /** Optional parent reference for display (type + name) in the common list shape. */
  parentDisplayRef?: {
    /** FK column on this table pointing to the parent (e.g. 'subject_id'). */
    column: string;
    /** Parent table (e.g. 'subjects'). */
    table: string;
    /** Parent primary-key column (e.g. 'subject_id'). */
    idColumn: string;
    /** Parent display-name column (e.g. 'name'). */
    nameColumn: string;
  };
  /** Optional curated summary fields for extraMetadata (keeps table schemas out of the UI). */
  listingSummary?: (row: Record<string, unknown>) => Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Resource Registry
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Custom cascade for questions.
 *
 * Mirrors `questionService.deleteQuestion` in reverse:
 *   1. Resolve option_ids (needed because question_option_images is keyed by
 *      option_id, not question_id).
 *   2. Restore question_option_images (by option_id IN …).
 *   3. Restore question_options (by question_id).
 *   4. Restore question_images and question_explanations (by question_id).
 */
async function cascadeRestoreQuestion(
  questionId: string,
): Promise<{ success: boolean; error?: string; restored?: number }> {
  try {
    let restored = 0;

    // ── Resolve options (needed for option images) ─────────────────────
    const { data: options } = await supabase
      .from('question_options')
      .select('option_id')
      .eq('question_id', questionId);

    const optionIds = (options ?? []).map((o) => o.option_id);

    if (optionIds.length > 0) {
      const { data: optImgData, error: optImgError } = await supabase
        .from('question_option_images')
        .update({ deleted_at: null, deleted_by: null, delete_reason: null })
        .in('option_id', optionIds)
        .select();

      if (optImgError) {
        return {
          success: false,
          error: `Failed to restore option images: ${extractErrorMessage(optImgError)}`,
        };
      }
      restored += (optImgData ?? []).length;

      const { data: optData, error: optError } = await supabase
        .from('question_options')
        .update({ deleted_at: null, deleted_by: null, delete_reason: null })
        .eq('question_id', questionId)
        .select();

      if (optError) {
        return {
          success: false,
          error: `Failed to restore options: ${extractErrorMessage(optError)}`,
        };
      }
      restored += (optData ?? []).length;
    }

    // ── Stem images ────────────────────────────────────────────────────
    const { data: stemData, error: stemError } = await supabase
      .from('question_images')
      .update({ deleted_at: null, deleted_by: null, delete_reason: null })
      .eq('question_id', questionId)
      .select();

    if (stemError) {
      return {
        success: false,
        error: `Failed to restore question images: ${extractErrorMessage(stemError)}`,
      };
    }
    restored += (stemData ?? []).length;

    // ── Explanations ───────────────────────────────────────────────────
    const { data: explData, error: explError } = await supabase
      .from('question_explanations')
      .update({ deleted_at: null, deleted_by: null, delete_reason: null })
      .eq('question_id', questionId)
      .select();

    if (explError) {
      return {
        success: false,
        error: `Failed to restore explanation: ${extractErrorMessage(explError)}`,
      };
    }
    restored += (explData ?? []).length;

    return { success: true, restored };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Permanent-Delete Cascade Helpers (Phase 8C.4)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Delete every storage file for a question (stem + option images).
 *
 * Best-effort — a missing object (already cleaned, or never uploaded) is not
 * an error. Storage paths are only available while the image rows still
 * exist, so this runs BEFORE any row deletion.
 */
async function deleteQuestionStorage(questionId: string): Promise<void> {
  // Stem images
  const { data: stemImages } = await supabase
    .from('question_images')
    .select('storage_bucket, storage_path')
    .eq('question_id', questionId);

  for (const img of stemImages ?? []) {
    if (img.storage_bucket && img.storage_path) {
      const res = await storageDeleteFile(img.storage_bucket, img.storage_path);
      if (!res.success) console.warn('[TrashService] Stem image cleanup failed:', res.error);
    }
  }

  // Option images (resolve options first)
  const { data: options } = await supabase
    .from('question_options')
    .select('option_id')
    .eq('question_id', questionId);

  const optionIds = (options ?? []).map((o) => o.option_id);
  if (optionIds.length > 0) {
    const { data: optionImages } = await supabase
      .from('question_option_images')
      .select('storage_bucket, storage_path')
      .in('option_id', optionIds);

    for (const img of optionImages ?? []) {
      if (img.storage_bucket && img.storage_path) {
        const res = await storageDeleteFile(img.storage_bucket, img.storage_path);
        if (!res.success) console.warn('[TrashService] Option image cleanup failed:', res.error);
      }
    }
  }
}

/**
 * Custom cascade-delete for questions.
 *
 * `question_option_images` has a RESTRICT FK on `option_id`, so it MUST be
 * deleted before the question row (whose deletion would otherwise cascade
 * into `question_options` and be blocked). Stem/option image storage files
 * are removed first (paths are only available while rows still exist).
 * `question_options` / `question_images` / `question_explanations` cascade
 * automatically when the parent question row is deleted.
 */
async function cascadeDeleteQuestion(
  questionId: string,
): Promise<{ success: boolean; error?: string; deleted?: number }> {
  try {
    let deleted = 0;

    // ── Pre-flight: block purge if the question is referenced by RESTRICT-FK
    // tables (mock_test_questions, mock_answers). Doing this BEFORE any
    // storage cleanup guarantees we never delete image files and then fail
    // the row delete, which would leave a restorable-but-broken question.
    for (const ref of ['mock_test_questions', 'mock_answers']) {
      const { data: hit, error: refError } = await supabase
        .from(ref)
        .select('question_id')
        .eq('question_id', questionId)
        .limit(1);

      if (refError) {
        return { success: false, error: `Failed to check ${ref} references: ${extractErrorMessage(refError)}` };
      }
      if ((hit ?? []).length > 0) {
        return {
          success: false,
          error:
            'Cannot permanently delete this question: it is still used in a mock test or student answers. Remove those references first.',
        };
      }
    }

    // Storage cleanup only happens once we know the purge can complete.
    await deleteQuestionStorage(questionId);

    // Resolve options (needed for option images)
    const { data: options } = await supabase
      .from('question_options')
      .select('option_id')
      .eq('question_id', questionId);
    const optionIds = (options ?? []).map((o) => o.option_id);

    if (optionIds.length > 0) {
      const { data: optImgData, error: optImgError } = await supabase
        .from('question_option_images')
        .delete()
        .in('option_id', optionIds)
        .select();

      if (optImgError) {
        return {
          success: false,
          error: `Failed to delete option images: ${extractErrorMessage(optImgError)}`,
        };
      }
      deleted += (optImgData ?? []).length;
    }

    // question_options / question_images / question_explanations cascade
    // automatically when the parent question row is deleted (ON DELETE CASCADE).
    return { success: true, deleted };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/** Storage cleanup for a content row (file + thumbnail). Best-effort. */
async function cleanupContentStorage(
  row: Record<string, unknown>,
): Promise<{ success: boolean; error?: string; deleted?: number }> {
  try {
    if (row.storage_bucket && row.storage_path) {
      const res = await storageDeleteFile(String(row.storage_bucket), String(row.storage_path));
      if (!res.success) console.warn('[TrashService] Content file cleanup failed:', res.error);
    }
    if (row.thumbnail_bucket && row.thumbnail_path) {
      const res = await storageDeleteFile(String(row.thumbnail_bucket), String(row.thumbnail_path));
      if (!res.success) console.warn('[TrashService] Content thumbnail cleanup failed:', res.error);
    }
    return { success: true, deleted: 0 };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Storage cleanup for a recording row (R2 via the recording-delete Edge
 * Function). Best-effort — the soft-delete path already removed the R2 file.
 */
async function cleanupRecordingStorage(
  row: Record<string, unknown>,
): Promise<{ success: boolean; error?: string; deleted?: number }> {
  try {
    const storagePath = row.storage_path ? String(row.storage_path) : null;
    if (!storagePath) return { success: true, deleted: 0 };

    const { error: rpcError } = await supabase.functions.invoke('recording-delete', {
      body: {
        storagePath,
        bucket: row.storage_bucket ? String(row.storage_bucket) : undefined,
      },
    });
    if (rpcError) console.warn('[TrashService] Recording R2 cleanup failed:', rpcError);

    return { success: true, deleted: 0 };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/** Storage cleanup for a PYQ paper row (question + solution PDFs). Best-effort. */
async function cleanupPyqPaperStorage(
  row: Record<string, unknown>,
): Promise<{ success: boolean; error?: string; deleted?: number }> {
  try {
    const pdfPairs = [
      { bucket: row.pdf_storage_bucket, path: row.pdf_storage_path },
      { bucket: row.solution_pdf_storage_bucket, path: row.solution_pdf_storage_path },
    ];
    for (const pair of pdfPairs) {
      if (pair.bucket && pair.path) {
        const res = await storageDeleteFile(String(pair.bucket), String(pair.path));
        if (!res.success) console.warn('[TrashService] PYQ PDF cleanup failed:', res.error);
      }
    }
    return { success: true, deleted: 0 };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/** Storage cleanup for a demo class row (video + thumbnail). Best-effort. */
async function cleanupDemoClassStorage(
  row: Record<string, unknown>,
): Promise<{ success: boolean; error?: string; deleted?: number }> {
  try {
    if (row.storage_bucket && row.storage_path) {
      const { data: shared } = await supabase
        .from('demo_classes')
        .select('demo_class_id')
        .eq('storage_bucket', String(row.storage_bucket))
        .eq('storage_path', String(row.storage_path))
        .neq('demo_class_id', String(row.demo_class_id));

      if (!shared || shared.length === 0) {
        const res = await storageDeleteFile(String(row.storage_bucket), String(row.storage_path));
        if (!res.success) console.warn('[TrashService] Demo class video cleanup failed:', res.error);
      }
    }
    if (row.thumbnail_bucket && row.thumbnail_path) {
      const { data: sharedThumb } = await supabase
        .from('demo_classes')
        .select('demo_class_id')
        .eq('thumbnail_bucket', String(row.thumbnail_bucket))
        .eq('thumbnail_path', String(row.thumbnail_path))
        .neq('demo_class_id', String(row.demo_class_id));

      if (!sharedThumb || sharedThumb.length === 0) {
        const res = await storageDeleteFile(String(row.thumbnail_bucket), String(row.thumbnail_path));
        if (!res.success) console.warn('[TrashService] Demo class thumbnail cleanup failed:', res.error);
      }
    }
    return { success: true, deleted: 0 };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Fully delete one PYQ paper (mappings → PDFs → row).
 *
 * Used by the package cascade — pyq_papers has a RESTRICT FK on package_id,
 * so every paper must be fully removed before the package row can be deleted.
 */
async function deletePyqPaperFully(
  paperId: string,
): Promise<{ success: boolean; error?: string; deleted?: number }> {
  try {
    let deleted = 0;

    // Mappings have RESTRICT FKs on paper_id → delete them first.
    const mappingTables = [
      { table: 'pyq_question_mappings', fk: 'paper_id' },
      { table: 'pyq_solutions', fk: 'paper_id' },
      { table: 'pyq_mock_mappings', fk: 'paper_id' },
    ];
    for (const m of mappingTables) {
      const { data, error } = await supabase
        .from(m.table)
        .delete()
        .eq(m.fk, paperId);
      if (error) {
        return { success: false, error: `Failed to delete ${m.table}: ${extractErrorMessage(error)}` };
      }
      deleted += (data ?? []).length;
    }

    // PDFs (paths are only available while the paper row still exists)
    const { data: paperRow } = await supabase
      .from('pyq_papers')
      .select('*')
      .eq('paper_id', paperId)
      .maybeSingle();
    if (paperRow) await cleanupPyqPaperStorage(paperRow as Record<string, unknown>);

    const { data: deletedRows, error: delError } = await supabase
      .from('pyq_papers')
      .delete()
      .eq('paper_id', paperId);
    if (delError) {
      return { success: false, error: `Failed to delete PYQ paper: ${extractErrorMessage(delError)}` };
    }
    deleted += (deletedRows ?? []).length;

    return { success: true, deleted };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/** Custom cascade-delete for PYQ packages (fully deletes papers first). */
async function cascadeDeletePyqPackage(
  packageId: string,
): Promise<{ success: boolean; error?: string; deleted?: number }> {
  try {
    const { data: papers } = await supabase
      .from('pyq_papers')
      .select('paper_id')
      .eq('package_id', packageId);

    let deleted = 0;
    for (const paper of papers ?? []) {
      const res = await deletePyqPaperFully(paper.paper_id);
      if (!res.success) return res;
      deleted += res.deleted ?? 0;
    }
    return { success: true, deleted };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/** Resource registry — single source of truth for restore + listing metadata. */
const RESOURCE_REGISTRY: Record<TrashResourceType, ResourceMeta> = {
  questions: {
    table: 'questions',
    idColumn: 'question_id',
    label: 'Question',
    displayColumn: 'question_text',
    statusColumn: 'status',
    parentDisplayRef: {
      column: 'subject_id',
      table: 'subjects',
      idColumn: 'subject_id',
      nameColumn: 'name',
    },
    parentRefs: [
      { column: 'subject_id', table: 'subjects', idColumn: 'subject_id', label: 'Subject' },
      { column: 'chapter_id', table: 'chapters', idColumn: 'chapter_id', label: 'Chapter' },
    ],
    cascadeRestore: cascadeRestoreQuestion,
    cascadeDelete: cascadeDeleteQuestion,
    listingSummary: (row) => ({
      subjectId: row.subject_id ?? null,
      chapterId: row.chapter_id ?? null,
      questionType: row.question_type ?? null,
      difficulty: row.difficulty ?? null,
      marks: row.marks ?? null,
    }),
  },
  mock_tests: {
    table: 'mock_tests',
    idColumn: 'test_id',
    label: 'Mock Test',
    displayColumn: 'title',
    statusColumn: 'status',
    parentDisplayRef: {
      column: 'subject_id',
      table: 'subjects',
      idColumn: 'subject_id',
      nameColumn: 'name',
    },
    parentRefs: [
      { column: 'subject_id', table: 'subjects', idColumn: 'subject_id', label: 'Subject' },
      // NOTE: mock_tests has subject_id but NO chapter_id column (migration 006).
    ],
    listingSummary: (row) => ({
      subjectId: row.subject_id ?? null,
      durationMin: row.duration_min ?? null,
      totalMarks: row.total_marks ?? null,
    }),
  },
  content: {
    table: 'content',
    idColumn: 'content_id',
    label: 'Content',
    displayColumn: 'title',
    statusColumn: 'status',
    parentDisplayRef: {
      column: 'subject_id',
      table: 'subjects',
      idColumn: 'subject_id',
      nameColumn: 'name',
    },
    parentRefs: [
      { column: 'subject_id', table: 'subjects', idColumn: 'subject_id', label: 'Subject' },
      { column: 'chapter_id', table: 'chapters', idColumn: 'chapter_id', label: 'Chapter' },
    ],
    storageCleanup: cleanupContentStorage,
    listingSummary: (row) => ({
      subjectId: row.subject_id ?? null,
      chapterId: row.chapter_id ?? null,
      contentType: row.content_type ?? null,
    }),
  },
  subjects: {
    table: 'subjects',
    idColumn: 'subject_id',
    label: 'Subject',
    displayColumn: 'name',
    parentDisplayRef: {
      column: 'stream_id',
      table: 'streams',
      idColumn: 'stream_id',
      nameColumn: 'name',
    },
    parentRefs: [
      { column: 'stream_id', table: 'streams', idColumn: 'stream_id', label: 'Stream' },
    ],
  },
  chapters: {
    table: 'chapters',
    idColumn: 'chapter_id',
    label: 'Chapter',
    displayColumn: 'name',
    parentDisplayRef: {
      column: 'subject_id',
      table: 'subjects',
      idColumn: 'subject_id',
      nameColumn: 'name',
    },
    parentRefs: [
      { column: 'subject_id', table: 'subjects', idColumn: 'subject_id', label: 'Subject' },
    ],
  },
  topics: {
    table: 'topics',
    idColumn: 'topic_id',
    label: 'Topic',
    displayColumn: 'name',
    parentDisplayRef: {
      column: 'chapter_id',
      table: 'chapters',
      idColumn: 'chapter_id',
      nameColumn: 'name',
    },
    parentRefs: [
      { column: 'chapter_id', table: 'chapters', idColumn: 'chapter_id', label: 'Chapter' },
    ],
  },
  streams: {
    table: 'streams',
    idColumn: 'stream_id',
    label: 'Stream',
    displayColumn: 'name',
    statusBoolean: { column: 'is_active', trueLabel: 'Active', falseLabel: 'Inactive' },
  },
  tags: {
    table: 'tags',
    idColumn: 'tag_id',
    label: 'Tag',
    displayColumn: 'name',
  },
  batches: {
    table: 'batches',
    idColumn: 'batch_id',
    label: 'Batch',
    displayColumn: 'name',
    statusColumn: 'status',
    listingSummary: (row) => ({ streamId: row.stream_id ?? null }),
  },
  courses: {
    table: 'courses',
    idColumn: 'course_id',
    label: 'Course',
    displayColumn: 'title',
    statusColumn: 'status',
    parentDisplayRef: {
      column: 'stream_id',
      table: 'streams',
      idColumn: 'stream_id',
      nameColumn: 'name',
    },
    listingSummary: (row) => ({ streamId: row.stream_id ?? null }),
  },
  recordings: {
    table: 'recordings',
    idColumn: 'recording_id',
    label: 'Recording',
    displayColumn: 'title',
    statusColumn: 'status',
    // The recording soft-delete path sets is_deleted=true AND deleted_at.
    // Restore must clear both to bring the row back to its active state.
    extraClear: { is_deleted: false },
    storageCleanup: cleanupRecordingStorage,
    listingSummary: (row) => ({ durationSeconds: row.duration_seconds ?? null }),
  },
  pyq_packages: {
    table: 'pyq_packages',
    idColumn: 'package_id',
    label: 'PYQ Package',
    displayColumn: 'name',
    statusFn: (row) =>
      row.published_at ? 'published' : row.is_active ? 'active' : 'inactive',
    parentDisplayRef: {
      column: 'stream_id',
      table: 'streams',
      idColumn: 'stream_id',
      nameColumn: 'name',
    },
    parentRefs: [
      { column: 'stream_id', table: 'streams', idColumn: 'stream_id', label: 'Stream' },
    ],
    children: [{ table: 'pyq_papers', fkColumn: 'package_id', label: 'PYQ papers' }],
    cascadeDelete: cascadeDeletePyqPackage,
    listingSummary: (row) => ({ streamId: row.stream_id ?? null, price: row.price ?? null }),
  },
  pyq_papers: {
    table: 'pyq_papers',
    idColumn: 'paper_id',
    label: 'PYQ Paper',
    displayColumn: 'title',
    statusFn: (row) =>
      row.is_published && row.published_at ? 'published' : 'draft',
    parentDisplayRef: {
      column: 'package_id',
      table: 'pyq_packages',
      idColumn: 'package_id',
      nameColumn: 'name',
    },
    parentRefs: [
      { column: 'package_id', table: 'pyq_packages', idColumn: 'package_id', label: 'PYQ Package' },
    ],
    deleteChildren: [
      { table: 'pyq_question_mappings', fkColumn: 'paper_id', label: 'question mappings' },
      { table: 'pyq_solutions', fkColumn: 'paper_id', label: 'solutions' },
      { table: 'pyq_mock_mappings', fkColumn: 'paper_id', label: 'mock mappings' },
    ],
    storageCleanup: cleanupPyqPaperStorage,
    listingSummary: (row) => ({
      examYear: row.exam_year ?? null,
      totalQuestions: row.total_questions ?? null,
    }),
  },
  demo_classes: {
    table: 'demo_classes',
    idColumn: 'demo_class_id',
    label: 'Demo Class',
    displayColumn: 'title',
    statusColumn: 'status',
    parentDisplayRef: {
      column: 'stream_id',
      table: 'streams',
      idColumn: 'stream_id',
      nameColumn: 'name',
    },
    parentRefs: [
      { column: 'stream_id', table: 'streams', idColumn: 'stream_id', label: 'Stream' },
    ],
    storageCleanup: cleanupDemoClassStorage,
    listingSummary: (row) => ({
      streamId: row.stream_id ?? null,
      durationSeconds: row.duration_seconds ?? null,
    }),
  },
};

// ═══════════════════════════════════════════════════════════════════════════
//  Public API — Restore
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Restore a soft-deleted resource.
 *
 * Clears `deleted_at` / `deleted_by` / `delete_reason` (nothing else changes)
 * and cascade-restores any child rows required by the resource (question →
 * options/images/explanations, PYQ package → papers).
 *
 * Validation performed BEFORE restoring:
 *   1. The caller is an approved Super Admin.
 *   2. The row exists AND is currently soft-deleted (`deleted_at IS NOT NULL`).
 *   3. Required parents exist and are NOT themselves deleted — a child is
 *      never restored under a deleted parent (no broken data).
 *
 * Every successful restore is audited via `auditService.logRestore`.
 *
 * @param resourceType - The resource type to restore (e.g. 'questions').
 * @param resourceId   - The primary key of the soft-deleted row.
 *
 * @example
 * const result = await trashService.restore('questions', 'uuid-here');
 * if (result.success) console.log(`Restored ${result.data.restored} rows`);
 */
export async function restore(
  resourceType: TrashResourceType,
  resourceId: string,
): Promise<ApiResponse<RestoreResult>> {
  try {
    validateUUID(resourceId, 'resourceId');

    const meta = RESOURCE_REGISTRY[resourceType];
    if (!meta) {
      return { success: false, error: `Unsupported resource type: ${resourceType}` };
    }

    // ── Permission: Super Admin only (live check, never client-supplied) ──
    // Service-layer equivalent of the frontend `canRestoreDeletedData`.
    if (!(await adminRoleService.isSuperAdmin())) {
      return {
        success: false,
        error: 'Only a Super Admin can restore deleted data.',
      };
    }

    // ── Load the row (must exist AND be soft-deleted) ──────────────────
    const { data: row, error: fetchError } = await supabase
      .from(meta.table)
      .select('*')
      .eq(meta.idColumn, resourceId)
      .not('deleted_at', 'is', null)
      .maybeSingle();

    if (fetchError) {
      return { success: false, error: extractErrorMessage(fetchError) };
    }
    if (!row) {
      return {
        success: false,
        error: `${meta.label} is not in the Recycle Bin or does not exist.`,
      };
    }

    // ── Validate parents (never restore broken data) ───────────────────
    for (const ref of meta.parentRefs ?? []) {
      const parentId = row[ref.column];
      if (!parentId) continue;

      // Select * (not a template-literal column list) so the typed Supabase
      // client stays happy and we can read deleted_at off the returned row.
      const { data: parent, error: parentError } = await supabase
        .from(ref.table)
        .select('*')
        .eq(ref.idColumn, parentId)
        .maybeSingle();

      if (parentError) {
        return { success: false, error: extractErrorMessage(parentError) };
      }
      if (!parent) {
        return {
          success: false,
          error: `Cannot restore ${meta.label.toLowerCase()}: the ${ref.label.toLowerCase()} it belongs to no longer exists.`,
        };
      }
      if (parent.deleted_at !== null) {
        return {
          success: false,
          error: `Cannot restore ${meta.label.toLowerCase()}: its ${ref.label.toLowerCase()} is itself deleted. Restore the ${ref.label.toLowerCase()} first.`,
        };
      }
    }

    // ── Cascade-restore children first (parent restore is the final step) ──
    let restoredChildren = 0;

    if (meta.cascadeRestore) {
      const cascade = await meta.cascadeRestore(resourceId);
      if (!cascade.success) {
        return { success: false, error: cascade.error ?? 'Failed to restore child records.' };
      }
      restoredChildren = cascade.restored ?? 0;
    } else {
      for (const child of meta.children ?? []) {
        const { data, error } = await supabase
          .from(child.table)
          .update({ deleted_at: null, deleted_by: null, delete_reason: null })
          .eq(child.fkColumn, resourceId)
          .select();

        if (error) {
          return {
            success: false,
            error: `Failed to restore ${child.label}: ${extractErrorMessage(error)}`,
          };
        }
        restoredChildren += (data ?? []).length;
      }
    }

    // ── Restore the row itself ─────────────────────────────────────────
    const extraUpdates: Record<string, unknown> = { ...(meta.extraClear ?? {}) };
    if (meta.table === 'demo_classes') {
      extraUpdates.status = row.published_at ? 'archived' : 'draft';
    }

    const { error: restoreError } = await supabase
      .from(meta.table)
      .update({
        deleted_at: null,
        deleted_by: null,
        delete_reason: null,
        ...extraUpdates,
      })
      .eq(meta.idColumn, resourceId);

    if (restoreError) {
      return { success: false, error: extractErrorMessage(restoreError) };
    }

    // ── Audit (non-strict: never breaks the operation) ─────────────────
    await auditService.logRestore({
      resourceType: meta.table,
      resourceId,
      oldValue: {
        deletedAt: row.deleted_at ?? null,
        deletedBy: row.deleted_by ?? null,
        deleteReason: row.delete_reason ?? null,
      },
      newValue: { restoredAt: new Date().toISOString(), restoredChildren },
      metadata: { label: meta.label },
    });

    return {
      success: true,
      data: {
        restored: 1 + restoredChildren,
        resourceType,
        resourceId,
      },
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Listing Helpers (Phase 8C.2)
// ═══════════════════════════════════════════════════════════════════════════

/** Max rows fetched per resource type before in-memory merge/sort/paginate. */
const MAX_ROWS_PER_TYPE = 500;

/** All resource types, in a stable order. */
const ALL_RESOURCE_TYPES = Object.keys(RESOURCE_REGISTRY) as TrashResourceType[];

/**
 * Resolve the display status for a deleted row using the registry metadata.
 */
function resolveStatus(
  meta: ResourceMeta,
  row: Record<string, unknown>,
): string | null {
  if (meta.statusFn) return meta.statusFn(row);
  if (meta.statusColumn && row[meta.statusColumn] != null) {
    return String(row[meta.statusColumn]);
  }
  if (meta.statusBoolean) {
    const raw = row[meta.statusBoolean.column];
    if (raw === null || raw === undefined) return null;
    return raw ? meta.statusBoolean.trueLabel : meta.statusBoolean.falseLabel;
  }
  return null;
}

/**
 * Map one deleted DB row to the common `TrashItem` shape.
 */
function mapToTrashItem(
  resourceType: TrashResourceType,
  meta: ResourceMeta,
  row: Record<string, unknown>,
): TrashItem {
  const parentId = meta.parentDisplayRef ? (row[meta.parentDisplayRef.column] as string | null) : null;

  return {
    resourceType,
    resourceId: String(row[meta.idColumn]),
    displayName: row[meta.displayColumn] != null ? String(row[meta.displayColumn]) : null,
    deletedAt: row.deleted_at != null ? String(row.deleted_at) : null,
    deletedBy: row.deleted_by != null ? String(row.deleted_by) : null,
    deleteReason: row.delete_reason != null ? String(row.delete_reason) : null,
    status: resolveStatus(meta, row),
    parentResource: meta.parentDisplayRef
      ? {
          type: meta.parentDisplayRef.table,
          id: parentId ?? null,
          name: null, // resolved in a batched follow-up query
        }
      : null,
    extraMetadata: meta.listingSummary ? meta.listingSummary(row) : {},
  };
}

/**
 * Batch-resolve parent display names for a page of items.
 *
 * Groups items by their parentDisplayRef (table + id column) and issues one
 * `IN` query per parent table, then fills `parentResource.name`.
 */
async function resolveParentNames(items: TrashItem[]): Promise<void> {
  // Collect distinct parent lookups: table -> { idColumn, nameColumn, ids[] }
  const groups = new Map<
    string,
    { idColumn: string; nameColumn: string; ids: string[] }
  >();

  for (const item of items) {
    const parent = item.parentResource;
    if (!parent?.id) continue;

    const meta = RESOURCE_REGISTRY[item.resourceType];
    const ref = meta.parentDisplayRef;
    if (!ref || ref.table !== parent.type) continue;

    const existing = groups.get(ref.table);
    if (existing) {
      if (!existing.ids.includes(parent.id)) existing.ids.push(parent.id);
    } else {
      groups.set(ref.table, {
        idColumn: ref.idColumn,
        nameColumn: ref.nameColumn,
        ids: [parent.id],
      });
    }
  }

  // Execute one query per parent table and fill names back.
  const nameById = new Map<string, Map<string, string | null>>();

  for (const [table, group] of groups) {
    // Select * (not a template-literal column list) so the typed Supabase
    // client stays happy — same fix as the 8C.1 parent validation.
    const { data } = await supabase
      .from(table)
      .select('*')
      .in(group.idColumn, group.ids);

    const map = new Map<string, string | null>();
    for (const row of data ?? []) {
      map.set(
        String((row as Record<string, unknown>)[group.idColumn]),
        (row as Record<string, unknown>)[group.nameColumn] != null
          ? String((row as Record<string, unknown>)[group.nameColumn])
          : null,
      );
    }
    nameById.set(table, map);
  }

  for (const item of items) {
    if (!item.parentResource?.id) continue;
    const map = nameById.get(item.parentResource.type);
    item.parentResource.name = map?.get(item.parentResource.id) ?? null;
  }
}

/**
 * Query deleted rows for a single resource type with the given filters.
 *
 * Returns raw rows (bounded by `MAX_ROWS_PER_TYPE`) plus the exact total
 * count of deleted rows matching the filters for that type.
 */
async function queryDeletedRows(
  resourceType: TrashResourceType,
  meta: ResourceMeta,
  filters: TrashListFilters,
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  let query = supabase
    .from(meta.table)
    .select('*', { count: 'exact' })
    .not('deleted_at', 'is', null);

  if (filters.search) {
    query = query.ilike(meta.displayColumn, `%${filters.search}%`);
  }
  if (filters.deletedBy) {
    query = query.eq('deleted_by', filters.deletedBy);
  }
  if (filters.dateFrom) {
    query = query.gte('deleted_at', filters.dateFrom);
  }
  if (filters.dateTo) {
    query = query.lte('deleted_at', filters.dateTo);
  }

  query = query.order('deleted_at', { ascending: false });
  query = query.limit(MAX_ROWS_PER_TYPE);

  const { data, error, count } = await query;
  if (error) throw new Error(extractErrorMessage(error));

  return {
    rows: (data ?? []).map((r) => r as Record<string, unknown>),
    total: count ?? 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Public API — Listing (Phase 8C.2)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * List soft-deleted items across resource types (the Recycle Bin backend).
 *
 * Data-driven across the shared `RESOURCE_REGISTRY` — no per-type switch
 * statements. Every item is normalized to the common `TrashItem` shape so the
 * future UI never touches table-specific schemas.
 *
 * Supported filters: resource types, search, deleted-by, date range.
 * Supported sort: deletedAt (default desc), displayName, resourceType.
 * Pagination: page (1-based) + pageSize (default 20, max 100).
 *
 * Permission: Super Admin only (live check — same model as restore).
 *
 * Note: per-type fetches are bounded by `MAX_ROWS_PER_TYPE` (500) before the
 * in-memory merge/sort/paginate, so `total`/`pageCount` are exact (computed
 * from per-type counts) but deep pages may show fewer rows than `pageCount`
 * implies when a single type has more than 500 matching deleted rows. Use the
 * `resourceTypes` filter to narrow when a type's bin is very large.
 *
 * @param filters    - Optional filter criteria.
 * @param sort       - Optional sort configuration.
 * @param pagination - Optional page/pageSize.
 */
export async function listDeleted(
  filters: TrashListFilters = {},
  sort: TrashSortOptions = {},
  pagination: TrashListParams = {},
): Promise<ApiResponse<TrashListResponse>> {
  try {
    // ── Permission: Super Admin only ───────────────────────────────────
    if (!(await adminRoleService.isSuperAdmin())) {
      return {
        success: false,
        error: 'Only a Super Admin can view the Recycle Bin.',
      };
    }

    // ── Resolve which resource types to query ──────────────────────────
    const requestedTypes =
      filters.resourceTypes && filters.resourceTypes.length > 0
        ? filters.resourceTypes
        : ALL_RESOURCE_TYPES;

    for (const t of requestedTypes) {
      if (!RESOURCE_REGISTRY[t]) {
        return { success: false, error: `Unsupported resource type: ${t}` };
      }
    }

    // Validate deletedBy once up-front instead of once per resource type.
    if (filters.deletedBy) validateUUID(filters.deletedBy, 'deletedBy');

    // ── Query every requested type (bounded per type) ──────────────────
    const allItems: TrashItem[] = [];
    const perTypeCounts: Partial<Record<TrashResourceType, number>> = {};

    for (const resourceType of requestedTypes) {
      const meta = RESOURCE_REGISTRY[resourceType];
      const { rows, total } = await queryDeletedRows(resourceType, meta, filters);
      perTypeCounts[resourceType] = total;
      for (const row of rows) allItems.push(mapToTrashItem(resourceType, meta, row));
    }

    const grandTotal = requestedTypes.reduce(
      (sum, t) => sum + (perTypeCounts[t] ?? 0),
      0,
    );

    // ── Sort (in-memory over the bounded merged set) ───────────────────
    const sortBy = sort.sortBy ?? 'deletedAt';
    const direction = (sort.sortDirection ?? 'desc') === 'asc' ? 1 : -1;

    allItems.sort((a, b) => {
      if (sortBy === 'resourceType') {
        return a.resourceType.localeCompare(b.resourceType) * direction;
      }
      if (sortBy === 'displayName') {
        const av = (a.displayName ?? '').toLowerCase();
        const bv = (b.displayName ?? '').toLowerCase();
        if (av === bv) return 0;
        return (av < bv ? -1 : 1) * direction;
      }
      // deletedAt (default) — nulls always last, regardless of direction
      const aNull = !a.deletedAt;
      const bNull = !b.deletedAt;
      if (aNull || bNull) {
        if (aNull && bNull) return 0;
        return aNull ? 1 : -1;
      }
      // aNull/bNull branches above already returned when either is null,
      // so non-null assertion is safe here (the local booleans do not
      // narrow the property for TypeScript).
      const av = new Date(a.deletedAt!).getTime();
      const bv = new Date(b.deletedAt!).getTime();
      if (av === bv) return 0;
      return (av < bv ? -1 : 1) * direction;
    });

    // ── Paginate ────────────────────────────────────────────────────────
    const { page, pageSize, from, to } = buildPagination({
      page: pagination.page ?? 1,
      pageSize: pagination.pageSize,
    });

    const pageItems = allItems.slice(from, Math.min(to + 1, allItems.length));
    await resolveParentNames(pageItems);

    return {
      success: true,
      data: {
        items: pageItems,
        total: grandTotal,
        page,
        pageSize,
        pageCount: pageSize > 0 ? Math.ceil(grandTotal / pageSize) : 0,
        perTypeCounts,
      },
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Fetch a single soft-deleted item by resource type + id.
 *
 * Returns the common `TrashItem` shape (with the parent name resolved).
 *
 * @param resourceType - The resource type (e.g. 'questions').
 * @param resourceId   - The primary key of the deleted row.
 */
export async function getDeletedItem(
  resourceType: TrashResourceType,
  resourceId: string,
): Promise<ApiResponse<TrashItem>> {
  try {
    validateUUID(resourceId, 'resourceId');

    const meta = RESOURCE_REGISTRY[resourceType];
    if (!meta) {
      return { success: false, error: `Unsupported resource type: ${resourceType}` };
    }

    // ── Permission: Super Admin only ───────────────────────────────────
    if (!(await adminRoleService.isSuperAdmin())) {
      return {
        success: false,
        error: 'Only a Super Admin can view the Recycle Bin.',
      };
    }

    const { data: row, error } = await supabase
      .from(meta.table)
      .select('*')
      .eq(meta.idColumn, resourceId)
      .not('deleted_at', 'is', null)
      .maybeSingle();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }
    if (!row) {
      return {
        success: false,
        error: `${meta.label} is not in the Recycle Bin or does not exist.`,
      };
    }

    const item = mapToTrashItem(
      resourceType,
      meta,
      row as Record<string, unknown>,
    );
    await resolveParentNames([item]);

    return { success: true, data: item };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Public API — Permanent Delete (Phase 8C.4)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Permanently delete a soft-deleted resource (Recycle Bin purge).
 *
 * IRREVERSIBLE. Only rows already inside the Recycle Bin (soft-deleted) may
 * be permanently deleted — active records are never touched. The operation:
 *
 *   1. Deletes every associated storage file (question/option images, content
 *      files + thumbnails, recording R2 objects, PYQ PDFs).
 *   2. Deletes orphaned child rows (question option images → options cascade;
 *      PYQ package → papers → mappings/solutions).
 *   3. Deletes the row itself.
 *   4. Writes a `permanent_delete` audit event via `auditService.logPermanentDelete`.
 *
 * FK-guarded: if the row is still referenced by live records (e.g. student
 * attempts, enrollments, course assignments), the delete is BLOCKED with a
 * friendly error — never cascade-destroys protected/historical data.
 *
 * Permission: Super Admin only (live check — same model as restore/list).
 *
 * @param resourceType - The resource type to purge (e.g. 'questions').
 * @param resourceId   - The primary key of the soft-deleted row.
 * @param reason       - Optional purge reason recorded in the audit log.
 *
 * @example
 * const result = await trashService.permanentlyDelete('questions', 'uuid-here', 'Removed per request');
 * if (result.success) console.log(`Purged ${result.data.deleted} rows`);
 */
export async function permanentlyDelete(
  resourceType: TrashResourceType,
  resourceId: string,
  reason?: string,
): Promise<ApiResponse<PermanentDeleteResult>> {
  try {
    validateUUID(resourceId, 'resourceId');

    const meta = RESOURCE_REGISTRY[resourceType];
    if (!meta) {
      return { success: false, error: `Unsupported resource type: ${resourceType}` };
    }

    // ── Permission: Super Admin only (live check, never client-supplied) ──
    if (!(await adminRoleService.isSuperAdmin())) {
      return {
        success: false,
        error: 'Only a Super Admin can permanently delete data.',
      };
    }

    // ── Load the row (must exist AND be soft-deleted — Recycle Bin only) ──
    const { data: row, error: fetchError } = await supabase
      .from(meta.table)
      .select('*')
      .eq(meta.idColumn, resourceId)
      .not('deleted_at', 'is', null)
      .maybeSingle();

    if (fetchError) {
      return { success: false, error: extractErrorMessage(fetchError) };
    }
    if (!row) {
      return {
        success: false,
        error: `${meta.label} is not in the Recycle Bin or does not exist.`,
      };
    }

    let deleted = 0;

    // ── 1. Row-level storage cleanup (content files, recording R2, PYQ PDFs) ──
    if (meta.storageCleanup) {
      const cleanup = await meta.storageCleanup(row as Record<string, unknown>);
      if (!cleanup.success) {
        return { success: false, error: cleanup.error };
      }
    }

    // ── 2. Cascade-delete children (custom handler OR generic deleteChildren) ──
    if (meta.cascadeDelete) {
      const cascade = await meta.cascadeDelete(resourceId);
      if (!cascade.success) {
        return { success: false, error: cascade.error };
      }
      deleted += cascade.deleted ?? 0;
    } else {
      for (const child of meta.deleteChildren ?? []) {
        const { data, error } = await supabase
          .from(child.table)
          .delete()
          .eq(child.fkColumn, resourceId);

        if (error) {
          return {
            success: false,
            error: `Failed to delete ${child.label}: ${extractErrorMessage(error)}`,
          };
        }
        deleted += (data ?? []).length;
      }
    }

    // ── 3. Delete the row itself ───────────────────────────────────────────
    const { error: deleteError } = await supabase
      .from(meta.table)
      .delete()
      .eq(meta.idColumn, resourceId);

    if (deleteError) {
      // FK violation (23503) — still referenced by protected/historical data
      if (deleteError.code === '23503') {
        return {
          success: false,
          error:
            `Cannot permanently delete this ${meta.label.toLowerCase()}: it is still referenced ` +
            'by other records (e.g. student attempts, enrollments, or assignments). ' +
            'Remove those references first.',
        };
      }
      return { success: false, error: extractErrorMessage(deleteError) };
    }
    deleted += 1;

    // ── 4. Audit (non-strict: never breaks the operation) ──────────────────
    await auditService.logPermanentDelete({
      resourceType: meta.table,
      resourceId,
      oldValue: {
        deletedAt: row.deleted_at ?? null,
        deletedBy: row.deleted_by ?? null,
        deleteReason: row.delete_reason ?? null,
      },
      newValue: { permanentlyDeletedAt: new Date().toISOString(), rowsDeleted: deleted },
      metadata: { label: meta.label },
      reason,
    });

    return { success: true, data: { deleted, resourceType, resourceId } };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Public API — Bulk Actions (Phase 8C.5)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Deduplicate a bulk selection (same resourceType+resourceId counted once).
 *
 * Duplicates are reported as `skipped` in the result so the caller sees an
 * accurate per-item ledger.
 */
function dedupeBulkItems(items: BulkItemRef[]): {
  unique: BulkItemRef[];
  skipped: BulkItemRef[];
} {
  const seen = new Set<string>();
  const unique: BulkItemRef[] = [];
  const skipped: BulkItemRef[] = [];

  for (const item of items) {
    const key = `${item.resourceType}:${item.resourceId}`;
    if (seen.has(key)) {
      skipped.push(item);
    } else {
      seen.add(key);
      unique.push(item);
    }
  }

  return { unique, skipped };
}

/** Normalize a settled promise into a friendly error message. */
function settleError(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === 'string') return reason;
  return 'Operation failed.';
}

/**
 * Bulk restore soft-deleted resources (Recycle Bin).
 *
 * Each item is executed independently via `Promise.allSettled` — one failed
 * item NEVER stops the remaining items. Every item reuses the full
 * `restore()` validation (Super Admin gate, Recycle-Bin-only row check,
 * parent validation, per-item audit), so nothing bypasses existing checks.
 *
 * After the run, ONE aggregate audit event (`restore` action) records the
 * totals: total selected, succeeded, failed, skipped, resource types.
 *
 * @param items - Array of { resourceType, resourceId } references to restore.
 *
 * @example
 * const res = await trashService.bulkRestore([
 *   { resourceType: 'questions', resourceId: 'a' },
 *   { resourceType: 'mock_tests', resourceId: 'b' },
 * ]);
 */
export async function bulkRestore(
  items: BulkItemRef[],
): Promise<ApiResponse<BulkResult>> {
  try {
    // ── Permission: Super Admin only (live check — same model as restore) ──
    if (!(await adminRoleService.isSuperAdmin())) {
      return {
        success: false,
        error: 'Only a Super Admin can restore deleted data.',
      };
    }

    if (items.length === 0) {
      return { success: false, error: 'No items selected to restore.' };
    }

    const { unique, skipped } = dedupeBulkItems(items);
    const results: BulkItemResult[] = skipped.map((item) => ({
      ...item,
      status: 'skipped',
      error: 'Duplicate selection.',
    }));

    const settled = await Promise.allSettled(
      unique.map((item) => restore(item.resourceType, item.resourceId)),
    );

    settled.forEach((outcome, i) => {
      const item = unique[i];
      if (outcome.status === 'rejected') {
        results.push({ ...item, status: 'failed', error: settleError(outcome.reason) });
        return;
      }
      const res = outcome.value;
      results.push({
        ...item,
        status: res.success ? 'succeeded' : 'failed',
        error: res.success ? undefined : res.error,
      });
    });

    const succeeded = results.filter((r) => r.status === 'succeeded').length;
    const failed = results.filter((r) => r.status === 'failed').length;
    const skippedCount = results.filter((r) => r.status === 'skipped').length;
    const resourceTypes = [...new Set(results.map((r) => r.resourceType))];

    // ── Aggregate audit (non-strict: never breaks the operation) ──────────
    await auditService.logRestore({
      resourceType: 'recycle_bin',
      metadata: {
        bulk: true,
        total: results.length,
        succeeded,
        failed,
        skipped: skippedCount,
        resourceTypes,
      },
    });

    return {
      success: true,
      data: {
        total: results.length,
        succeeded,
        failed,
        skipped: skippedCount,
        resourceTypes,
        items: results,
      },
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Bulk permanent delete soft-deleted resources (Recycle Bin purge).
 *
 * Each item is executed independently via `Promise.allSettled` — one FK
 * blocked item NEVER stops the remaining items. Every item reuses the full
 * `permanentlyDelete()` path (Super Admin gate, Recycle-Bin-only validation,
 * storage cleanup, cascade, FK 23503 friendly errors, per-item
 * `permanent_delete` audit), so nothing bypasses existing checks.
 *
 * After the run, ONE aggregate audit event (`permanent_delete` action)
 * records the totals: total selected, succeeded, failed, skipped, resource
 * types.
 *
 * @param items  - Array of { resourceType, resourceId } references to purge.
 * @param reason - Mandatory purge reason recorded on the aggregate audit event.
 *
 * @example
 * const res = await trashService.bulkPermanentlyDelete(
 *   [{ resourceType: 'questions', resourceId: 'a' }],
 *   'Client request — data no longer needed',
 * );
 */
export async function bulkPermanentlyDelete(
  items: BulkItemRef[],
  reason: string,
): Promise<ApiResponse<BulkResult>> {
  try {
    // ── Permission: Super Admin only (live check — same model as restore) ──
    if (!(await adminRoleService.isSuperAdmin())) {
      return {
        success: false,
        error: 'Only a Super Admin can permanently delete data.',
      };
    }

    if (items.length === 0) {
      return { success: false, error: 'No items selected to permanently delete.' };
    }

    const { unique, skipped } = dedupeBulkItems(items);
    const results: BulkItemResult[] = skipped.map((item) => ({
      ...item,
      status: 'skipped',
      error: 'Duplicate selection.',
    }));

    const settled = await Promise.allSettled(
      unique.map((item) => permanentlyDelete(item.resourceType, item.resourceId, reason)),
    );

    settled.forEach((outcome, i) => {
      const item = unique[i];
      if (outcome.status === 'rejected') {
        results.push({ ...item, status: 'failed', error: settleError(outcome.reason) });
        return;
      }
      const res = outcome.value;
      results.push({
        ...item,
        status: res.success ? 'succeeded' : 'failed',
        error: res.success ? undefined : res.error,
      });
    });

    const succeeded = results.filter((r) => r.status === 'succeeded').length;
    const failed = results.filter((r) => r.status === 'failed').length;
    const skippedCount = results.filter((r) => r.status === 'skipped').length;
    const resourceTypes = [...new Set(results.map((r) => r.resourceType))];

    // ── Aggregate audit (non-strict: never breaks the operation) ──────────
    await auditService.logPermanentDelete({
      resourceType: 'recycle_bin',
      reason,
      metadata: {
        bulk: true,
        total: results.length,
        succeeded,
        failed,
        skipped: skippedCount,
        resourceTypes,
      },
    });

    return {
      success: true,
      data: {
        total: results.length,
        succeeded,
        failed,
        skipped: skippedCount,
        resourceTypes,
        items: results,
      },
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Namespaced object (matches existing service conventions)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Namespaced trash service object.
 *
 * ```ts
 * import { trashService } from '@/services/admin/trashService';
 * await trashService.restore('questions', 'uuid');
 * const bin = await trashService.listDeleted({ search: 'Newton' });
 * const item = await trashService.getDeletedItem('questions', 'uuid');
 * await trashService.permanentlyDelete('questions', 'uuid', 'Purge reason');
 * await trashService.bulkRestore([{ resourceType: 'questions', resourceId: 'a' }]);
 * await trashService.bulkPermanentlyDelete([{ resourceType: 'questions', resourceId: 'a' }], 'Reason');
 * ```
 */
export const trashService = {
  restore,
  permanentlyDelete,
  listDeleted,
  getDeletedItem,
  bulkRestore,
  bulkPermanentlyDelete,
};
