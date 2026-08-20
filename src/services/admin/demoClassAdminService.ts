/**
 * Admin Demo Class Management Service
 *
 * CRUD + lifecycle for `demo_classes` (migration 106) in the Admin
 * Dashboard. Stream-scoped demo videos stored in the EXISTING
 * `content-videos` bucket; thumbnails in the EXISTING public
 * `content-thumbnails` bucket.
 *
 * ## Architecture decisions
 *
 * 1. **RLS is respected.** Uses the anon key — all queries run as the
 *    authenticated admin. Migration 106's RLS allows CRUD only for
 *    super_admin / academic_admin scoped to their own institute.
 *    Finance admins, teachers, and students are denied at the RLS layer.
 *
 * 2. **Storage orchestration via storageService.** File uploads, thumbnail
 *    uploads, and deletions are delegated to `storageService` — never
 *    called directly. Video validation (MIME, extension, 5 GB limit) and
 *    retry/backoff come from the existing `content_video` resource config.
 *
 * 3. **No orphaned uploads.** If the DB insert/update fails after a
 *    successful upload, the uploaded file is immediately deleted.
 *
 * 4. **Lifecycle via status transitions.** draft → published → archived.
 *    `published_at` is set on publish and preserved through archive
 *    (migration 106 CHECK constraint — published/archived rows must carry
 *    `published_at`, draft rows must not).
 *
 * @module services/admin/demoClassAdminService
 */

import { supabase } from '@/config/supabase';
import { validateUUID, extractErrorMessage, buildPagination } from '@/utils/supabase';
import { buildPaginatedResponse } from '@/utils/response';
import { sanitizeFileName } from '@/utils/storage';
import {
  uploadResource as storageUploadResource,
  uploadThumbnail as storageUploadThumbnail,
  deleteFile as storageDeleteFile,
} from '../storage/storageService';
import { auditService } from '@/services/audit/auditService';
import type { ApiResponse, PaginatedResponse, PaginationParams, SortDirection } from '@/types/academic';
import type {
  DemoClass,
  DemoClassFilters,
  CreateDemoClassParams,
  UpdateDemoClassParams,
} from '@/types/demoClass';

// ═══════════════════════════════════════════════════════════════════════════
//  Internal Types
// ═══════════════════════════════════════════════════════════════════════════

/** Raw snake_case shape of a `demo_classes` row (with stream join). */
interface DbDemoClass {
  demo_class_id: string;
  institute_id: string;
  stream_id: string;
  title: string;
  description: string | null;
  storage_bucket: string;
  storage_path: string;
  thumbnail_bucket: string | null;
  thumbnail_path: string | null;
  duration_seconds: number | null;
  status: DemoClass['status'];
  display_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  deleted_at?: string | null;
  deleted_by?: string | null;
  delete_reason?: string | null;
  streams?: { stream_id: string; name: string } | null;
}

/** PostgREST select with the stream join (via FK fk_demo_classes_stream). */
const DEMO_SELECT = `*, streams!fk_demo_classes_stream ( stream_id, name )`;

/** Maps camelCase sort keys to snake_case columns. */
const SORT_FIELD_MAP: Record<string, string> = {
  title: 'title',
  status: 'status',
  displayOrder: 'display_order',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  publishedAt: 'published_at',
};

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Converts a raw snake_case DB row into a camelCase `DemoClass`. */
function mapDemoClass(db: DbDemoClass): DemoClass {
  return {
    demoClassId: db.demo_class_id,
    instituteId: db.institute_id,
    streamId: db.stream_id,
    streamName: db.streams?.name ?? null,
    title: db.title,
    description: db.description,
    storageBucket: db.storage_bucket,
    storagePath: db.storage_path,
    thumbnailBucket: db.thumbnail_bucket,
    thumbnailPath: db.thumbnail_path,
    durationSeconds: db.duration_seconds,
    status: db.status,
    displayOrder: db.display_order,
    createdBy: db.created_by,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
    publishedAt: db.published_at,
    deletedAt: db.deleted_at ?? null,
    deletedBy: db.deleted_by ?? null,
    deleteReason: db.delete_reason ?? null,
  };
}

/**
 * Generates a UUID v4 string without relying on `crypto.randomUUID()`
 * (unavailable in React Native's JS engine — mirrors contentService).
 * Used to derive the storage path before the DB row exists.
 */
function generateUUID(): string {
  const hex = '0123456789abcdef';
  let uuid = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      uuid += '-';
    } else if (i === 14) {
      uuid += '4';
    } else if (i === 19) {
      uuid += hex[(Math.random() * 4) | 8];
    } else {
      uuid += hex[(Math.random() * 16) | 0];
    }
  }
  return uuid;
}

/**
 * Builds the video object name inside the content-videos bucket.
 *
 * When `uniqueSuffix` is true a timestamp is inserted before the extension
 * so a replacement upload can never collide with the existing object
 * (upload uses `upsert: false`). The new file is uploaded first and the
 * old file deleted only after the DB row is updated.
 */
function buildDemoVideoName(originalName: string, uniqueSuffix = false): string {
  const sanitized = sanitizeFileName(originalName || 'demo-video.mp4');
  if (!uniqueSuffix) return sanitized;

  const dot = sanitized.lastIndexOf('.');
  const base = dot > 0 ? sanitized.slice(0, dot) : sanitized;
  const ext = dot > 0 ? sanitized.slice(dot) : '';
  return `${base}-${Date.now()}${ext}`;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch a paginated, filtered, sorted list of demo classes (with stream
 * names joined). Sorted by created_at DESC by default.
 */
export async function getDemoClasses(
  filters?: DemoClassFilters,
  sort?: { sortBy?: keyof typeof SORT_FIELD_MAP | string; sortDirection?: 'asc' | 'desc' },
  pagination?: PaginationParams,
): Promise<ApiResponse<PaginatedResponse<DemoClass>>> {
  try {
    let query = supabase
      .from('demo_classes')
      .select(DEMO_SELECT, { count: 'exact' })
      .is('deleted_at', null);

    // ── Filters ──────────────────────────────────────────────────────
    if (filters?.instituteId) {
      validateUUID(filters.instituteId, 'instituteId');
      query = query.eq('institute_id', filters.instituteId);
    }
    if (filters?.streamId) {
      validateUUID(filters.streamId, 'streamId');
      query = query.eq('stream_id', filters.streamId);
    }
    if (filters?.status) {
      query = query.eq('status', filters.status);
    }
    if (filters?.search) {
      query = query.ilike('title', `%${filters.search}%`);
    }

    // ── Sort ─────────────────────────────────────────────────────────
    const sortBy = SORT_FIELD_MAP[sort?.sortBy ?? 'createdAt'] ?? 'created_at';
    const sortDirection: SortDirection = sort?.sortDirection ?? 'desc';
    query = query.order(sortBy, { ascending: sortDirection === 'asc' });

    // ── Pagination ───────────────────────────────────────────────────
    const { page, pageSize, from, to } = buildPagination(pagination);
    query = query.range(from, to);

    const { data, error, count } = await query;

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    const items = (data ?? []).map((row: DbDemoClass) => mapDemoClass(row));

    return {
      success: true,
      data: buildPaginatedResponse(items, count ?? 0, page, pageSize),
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/** Fetch a single demo class by ID (with stream name joined). */
export async function getDemoClassById(demoClassId: string): Promise<ApiResponse<DemoClass>> {
  try {
    validateUUID(demoClassId, 'demoClassId');

    const { data, error } = await supabase
      .from('demo_classes')
      .select(DEMO_SELECT)
      .eq('demo_class_id', demoClassId)
      .is('deleted_at', null)
      .single<DbDemoClass>();

    if (error) {
      if (error.code === 'PGRST116') {
        return { success: false, error: `Demo class not found: ${demoClassId}` };
      }
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapDemoClass(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Create a demo class as a DRAFT.
 *
 * Workflow:
 *   1. Generate the demoClassId (drives the storage path).
 *   2. Upload the video to the content-videos bucket via storageService
 *      (uses the existing `content_video` resource config — MIME/extension
 *      validation + 5 GB limit + retry).
 *   3. Insert the `demo_classes` row with status = draft.
 *   4. If the DB insert fails, delete the uploaded file (no orphaned uploads).
 *   5. Optionally upload a thumbnail (non-fatal on failure).
 *
 * @param params - Demo metadata + video file.
 */
export async function createDemoClass(
  params: CreateDemoClassParams,
): Promise<ApiResponse<DemoClass>> {
  const {
    instituteId,
    streamId,
    title,
    description,
    file,
    thumbnailFile,
    durationSeconds,
    displayOrder,
    createdBy,
    onProgress,
  } = params;

  try {
    // ── Validate ──────────────────────────────────────────────────────
    if (!instituteId) return { success: false, error: 'Institute is required.' };
    if (!streamId) return { success: false, error: 'Stream is required.' };
    if (!createdBy) return { success: false, error: 'Creator identity is required.' };
    if (!title?.trim() || title.trim().length < 3) {
      return { success: false, error: 'Title must be at least 3 characters.' };
    }
    if (!file) return { success: false, error: 'Video file is required.' };

    validateUUID(instituteId, 'instituteId');
    validateUUID(streamId, 'streamId');
    validateUUID(createdBy, 'createdBy');

    // ── 1. Generate demo class ID ────────────────────────────────────
    const demoClassId = generateUUID();
    const originalFileName = file.name;

    // ── 2. Upload video (existing content_video config → content-videos) ──
    const uploadResult = await storageUploadResource({
      file,
      resourceType: 'content_video',
      pathParams: {
        instituteId,
        contentId: demoClassId,
        sanitisedFileName: buildDemoVideoName(originalFileName),
      },
      onProgress,
    });

    if (!uploadResult.success) {
      return { success: false, error: `Video upload failed: ${uploadResult.error}` };
    }

    const { bucket: storageBucket, storagePath } = uploadResult.data!;

    // ── 3. Insert DB record (always a draft) ─────────────────────────
    const { data: dbData, error: dbError } = await supabase
      .from('demo_classes')
      .insert({
        demo_class_id: demoClassId,
        institute_id: instituteId,
        stream_id: streamId,
        title: title.trim(),
        description: description ?? null,
        storage_bucket: storageBucket,
        storage_path: storagePath,
        duration_seconds: durationSeconds ?? null,
        display_order: displayOrder ?? 0,
        created_by: createdBy,
      })
      .select(DEMO_SELECT)
      .single<DbDemoClass>();

    // ── 4. Rollback on DB failure (no orphaned uploads) ──────────────
    if (dbError) {
      await storageDeleteFile(storageBucket, storagePath);
      return { success: false, error: extractErrorMessage(dbError) };
    }

    // ── 5. Optional thumbnail (non-fatal on failure) ─────────────────
    if (thumbnailFile) {
      const thumbResult = await storageUploadThumbnail(thumbnailFile, instituteId, demoClassId);
      if (thumbResult.success && thumbResult.data) {
        await supabase
          .from('demo_classes')
          .update({
            thumbnail_bucket: thumbResult.data.bucket,
            thumbnail_path: thumbResult.data.storagePath,
          })
          .eq('demo_class_id', demoClassId);
      }
    }

    return { success: true, data: mapDemoClass(dbData) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Update demo class metadata, optionally replacing the video or thumbnail.
 *
 * Video replacement:
 *   1. Upload the new file (timestamped name — never collides).
 *   2. Update the DB row with the new storage path.
 *   3. Delete the OLD file only after the DB update succeeds (best-effort).
 *
 * File replacement is only allowed for `draft` / `archived` demos —
 * published demos are never silently swapped (content module convention).
 *
 * @param demoClassId - UUID of the demo class.
 * @param params      - Fields to update (all optional).
 */
export async function updateDemoClass(
  demoClassId: string,
  params: UpdateDemoClassParams,
): Promise<ApiResponse<DemoClass>> {
  try {
    validateUUID(demoClassId, 'demoClassId');

    // ── Fetch existing ───────────────────────────────────────────────
    const existing = await getDemoClassById(demoClassId);
    if (!existing.success || !existing.data) {
      return { success: false, error: `Demo class not found: ${demoClassId}` };
    }
    const current = existing.data;

    // ── Build DB update payload ──────────────────────────────────────
    const dbUpdate: Record<string, unknown> = {};

    if (params.streamId !== undefined) {
      if (!params.streamId) return { success: false, error: 'Stream is required.' };
      validateUUID(params.streamId, 'streamId');
      dbUpdate.stream_id = params.streamId;
    }

    if (params.title !== undefined) {
      if (!params.title.trim() || params.title.trim().length < 3) {
        return { success: false, error: 'Title must be at least 3 characters.' };
      }
      dbUpdate.title = params.title.trim();
    }

    if (params.description !== undefined) {
      dbUpdate.description = params.description;
    }

    if (params.durationSeconds !== undefined) {
      dbUpdate.duration_seconds = params.durationSeconds;
    }

    if (params.displayOrder !== undefined) {
      dbUpdate.display_order = params.displayOrder;
    }

    // ── Video replacement (draft/archived only) ──────────────────────
    let newlyUploaded: { bucket: string; path: string } | null = null;

    if (params.file) {
      if (current.status !== 'draft' && current.status !== 'archived') {
        return {
          success: false,
          error:
            'Video can only be replaced while the demo is draft or archived. Archive it first to swap the video.',
        };
      }

      const originalFileName = params.file.name;

      const uploadResult = await storageUploadResource({
        file: params.file,
        resourceType: 'content_video',
        pathParams: {
          instituteId: current.instituteId,
          contentId: demoClassId,
          sanitisedFileName: buildDemoVideoName(originalFileName, true),
        },
        onProgress: params.onProgress,
      });

      if (!uploadResult.success) {
        return { success: false, error: `Video upload failed: ${uploadResult.error}` };
      }

      newlyUploaded = { bucket: uploadResult.data!.bucket, path: uploadResult.data!.storagePath };
      dbUpdate.storage_bucket = newlyUploaded.bucket;
      dbUpdate.storage_path = newlyUploaded.path;
    }

    // ── Thumbnail replacement (upsert — same path, overwrites) ───────
    if (params.thumbnailFile) {
      const thumbResult = await storageUploadThumbnail(
        params.thumbnailFile,
        current.instituteId,
        demoClassId,
      );
      if (thumbResult.success && thumbResult.data) {
        dbUpdate.thumbnail_bucket = thumbResult.data.bucket;
        dbUpdate.thumbnail_path = thumbResult.data.storagePath;
      }
    }

    // ── Nothing to update ────────────────────────────────────────────
    if (Object.keys(dbUpdate).length === 0) {
      return { success: true, data: current };
    }

    // ── Execute update ───────────────────────────────────────────────
    const { data, error } = await supabase
      .from('demo_classes')
      .update(dbUpdate)
      .eq('demo_class_id', demoClassId)
      .select(DEMO_SELECT)
      .single<DbDemoClass>();

    if (error) {
      // Rollback the newly uploaded file so we never orphan storage
      if (newlyUploaded) {
        await storageDeleteFile(newlyUploaded.bucket, newlyUploaded.path);
      }
      if (error.code === 'PGRST116') {
        return { success: false, error: `Demo class not found: ${demoClassId}` };
      }
      return { success: false, error: extractErrorMessage(error) };
    }

    // ── Delete the old video AFTER the swap succeeded (best-effort) ──
    if (newlyUploaded && current.storagePath && current.storageBucket) {
      const oldDelete = await storageDeleteFile(current.storageBucket, current.storagePath);
      if (!oldDelete.success) {
        console.warn(
          `[demo-classes] Video swapped but old file could not be deleted (orphan): ` +
            `${current.storageBucket}/${current.storagePath} — ${oldDelete.error}`,
        );
      }
    }

    return { success: true, data: mapDemoClass(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Publish a demo class: draft (or archived) → published.
 *
 * Sets `published_at = now()` — required by ck_demo_classes_published_at.
 * Multiple demos may be published per stream; the student app later
 * selects the newest published one.
 *
 * @param demoClassId - UUID of the demo class to publish.
 */
export async function publishDemoClass(demoClassId: string): Promise<ApiResponse<DemoClass>> {
  try {
    validateUUID(demoClassId, 'demoClassId');

    const existing = await getDemoClassById(demoClassId);
    if (!existing.success || !existing.data) {
      return { success: false, error: `Demo class not found: ${demoClassId}` };
    }

    if (existing.data.status === 'published') {
      return { success: false, error: 'This demo class is already published.' };
    }

    const { data, error } = await supabase
      .from('demo_classes')
      .update({ status: 'published', published_at: new Date().toISOString() })
      .eq('demo_class_id', demoClassId)
      .select(DEMO_SELECT)
      .single<DbDemoClass>();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapDemoClass(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Archive a published demo class: published → archived.
 *
 * `published_at` is preserved (migration 106 CHECK requires archived rows
 * to keep it — migration 031 audit-trail convention). The video file is
 * NOT deleted; it stays available for admin history.
 *
 * Draft demos cannot be archived directly — they are admin-only anyway;
 * publish first or leave them as drafts.
 *
 * @param demoClassId - UUID of the demo class to archive.
 */
export async function archiveDemoClass(demoClassId: string): Promise<ApiResponse<DemoClass>> {
  try {
    validateUUID(demoClassId, 'demoClassId');

    const existing = await getDemoClassById(demoClassId);
    if (!existing.success || !existing.data) {
      return { success: false, error: `Demo class not found: ${demoClassId}` };
    }

    if (existing.data.status === 'archived') {
      return { success: false, error: 'This demo class is already archived.' };
    }

    if (existing.data.status === 'draft') {
      return {
        success: false,
        error:
          'Draft demos cannot be archived (archived rows must carry a publish timestamp). Publish the demo first.',
      };
    }

    const { data, error } = await supabase
      .from('demo_classes')
      .update({ status: 'archived' })
      .eq('demo_class_id', demoClassId)
      .select(DEMO_SELECT)
      .single<DbDemoClass>();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapDemoClass(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Soft-delete a demo class record (Enterprise Soft Delete).
 *
 * Sets `deleted_at` / `deleted_by` / `delete_reason` on the demo_classes row.
 * Storage files are PRESERVED so the demo class can be restored from the Recycle Bin.
 *
 * @param demoClassId - The UUID of the demo class to delete.
 * @param reason      - Optional reason captured for audit / delete_reason.
 */
export async function deleteDemoClass(
  demoClassId: string,
  reason?: string,
): Promise<ApiResponse<void>> {
  try {
    validateUUID(demoClassId, 'demoClassId');

    const existing = await getDemoClassById(demoClassId);
    if (!existing.success || !existing.data) {
      return { success: false, error: `Demo class not found: ${demoClassId}` };
    }

    const current = existing.data;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const deletedBy = user?.id ?? null;
    const now = new Date().toISOString();

    const { error } = await supabase
      .from('demo_classes')
      .update({
        deleted_at: now,
        deleted_by: deletedBy,
        delete_reason: reason ?? null,
      })
      .eq('demo_class_id', demoClassId);

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    await auditService.logSoftDelete({
      resourceType: 'demo_classes',
      resourceId: demoClassId,
      metadata: { demoClassId, title: current.title, deletedAt: now, deletedBy },
      reason,
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Resolve the public thumbnail URL for a demo class (thumbnails live in
 * the PUBLIC `content-thumbnails` bucket). Returns null when no thumbnail
 * is set.
 */
export function getDemoClassThumbnailUrl(
  demo: Pick<DemoClass, 'thumbnailBucket' | 'thumbnailPath'>,
): string | null {
  if (!demo.thumbnailBucket || !demo.thumbnailPath) return null;
  const { data } = supabase.storage.from(demo.thumbnailBucket).getPublicUrl(demo.thumbnailPath);
  return data.publicUrl ?? null;
}
