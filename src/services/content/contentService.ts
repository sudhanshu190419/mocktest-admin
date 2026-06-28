/**
 * Content Service
 *
 * Clean-architecture service layer encapsulating all Content CRUD operations
 * and lifecycle management. Orchestrates storage operations through the
 * storageService — never calls Supabase Storage directly.
 *
 * ## Architecture decisions
 *
 * 1. **Storage orchestration.** All file uploads, deletions, and replacements
 *    are delegated to `storageService`. This service only interacts with the
 *    database and coordinates rollback on failure.
 *
 * 2. **No orphaned uploads.** If a file upload succeeds but the subsequent DB
 *    insert fails, the uploaded file is immediately deleted. The caller never
 *    sees a success response for a half-created resource.
 *
 * 3. **Lifecycle via status transitions.** Content status follows a strict
 *    state machine: draft → pending_review → approved → archived, with
 *    rejection returning to rejected and then back to draft.
 *
 * 4. **RLS is respected.** All queries use the anon key — RLS policies in the
 *    database control row-level access.
 *
 * @module contentService
 */

import { supabase } from '../../config/supabase';
import { validateUUID, extractErrorMessage, buildPagination } from '../../utils/supabase';
import { buildPaginatedResponse } from '../../utils/response';
import {
  uploadFile as storageUploadFile,
  deleteFile as storageDeleteFile,
  replaceFile as storageReplaceFile,
  uploadThumbnail as storageUploadThumbnail,
} from '../storage/storageService';
import type {
  ApiResponse,
  PaginatedResponse,
  PaginationParams,
  SortDirection,
} from '../../types/academic';
import type {
  Content,
  ContentFilters,
  ContentSortOptions,
  ContentType,
  LifecycleStatus,
} from '../../types/content';

// ═══════════════════════════════════════════════════════════════════════════
//  Internal Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parameters for creating content with a file upload.
 *
 * Storage fields (storageBucket, storagePath, mimeType, originalFileName,
 * fileSizeBytes) are derived automatically by the service from the file
 * and upload result — they are not accepted from the caller.
 */
export interface CreateContentParams {
  /** Institute that owns this content. */
  instituteId: string;
  /** Teacher uploading this content. */
  teacherId: string;
  /** Chapter this content belongs to. */
  chapterId: string;
  /** For versioned uploads: the content row this revision supersedes. */
  parentContentId?: string | null;
  /** Display title. Minimum 3 characters. */
  title: string;
  /** Optional summary or learning objectives. */
  description?: string | null;
  /** Content type discriminator. */
  contentType: ContentType;
  /** The file to upload (File, Blob, or ArrayBuffer). */
  file: File | Blob | ArrayBuffer;
  /** Optional thumbnail image. */
  thumbnailFile?: File | Blob | ArrayBuffer;
  /** Video duration in seconds (required when contentType = 'video'). */
  durationSeconds?: number | null;
  /** Page count (applicable to PDF and notes). */
  pageCount?: number | null;
  /** Defaults to `false` when not provided. */
  isFreePreview?: boolean;
  /** Optional upload progress callback. */
  onProgress?: (loaded: number, total: number) => void;
}

/**
 * Parameters for updating content, with optional file replacement.
 */
export interface UpdateContentParams {
  title?: string;
  description?: string | null;
  /** New file to replace the existing one — triggers storage replacement. */
  file?: File | Blob | ArrayBuffer;
  /** New thumbnail to replace the existing one. */
  thumbnailFile?: File | Blob | ArrayBuffer;
  durationSeconds?: number | null;
  pageCount?: number | null;
  isFreePreview?: boolean;
  /** Optional upload progress callback when replacing a file. */
  onProgress?: (loaded: number, total: number) => void;
}

/**
 * Extended filter type supporting additional query capabilities beyond
 * the base `ContentFilters` type.
 */
export interface ContentQueryFilters extends ContentFilters {
  /** Filter by stream ID (resolved via chapter → subject → stream join). */
  streamId?: string;
  /** Filter by topic ID (requires topic_id on content — applies when available). */
  topicId?: string;
  /** Filter by batch ID (requires batch-content mapping). */
  batchId?: string;
  /** Filter by tag IDs (resolved via content_tag join). */
  tags?: string[];
  /** Filter by creator profile ID (maps to teacher_id lookup). */
  createdBy?: string;
  /** Alias for status filtering. */
  lifecycleStatus?: LifecycleStatus;
  /** Filter content with pending approval. */
  isPendingReview?: boolean;
}

// ─── Database Row Shape ────────────────────────────────────────────────────

/**
 * Raw snake_case shape of the `content` table returned by Supabase.
 *
 * This type is internal to the service layer and is never exported.
 * Consumers receive only the camelCase `Content` interface.
 */
interface DbContent {
  content_id: string;
  institute_id: string;
  teacher_id: string;
  chapter_id: string;
  subject_id: string;
  parent_content_id: string | null;
  title: string;
  description: string | null;
  content_type: ContentType;
  storage_bucket: string;
  storage_path: string;
  mime_type: string;
  original_file_name: string;
  thumbnail_bucket: string | null;
  thumbnail_path: string | null;
  duration_seconds: number | null;
  page_count: number | null;
  file_size_bytes: number | null;
  view_count: number;
  download_count: number;
  status: LifecycleStatus;
  is_free_preview: boolean;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Maps camelCase sort keys to their snake_case database column names.
 */
const SORT_FIELD_MAP: Record<string, string> = {
  title: 'title',
  contentType: 'content_type',
  status: 'status',
  viewCount: 'view_count',
  downloadCount: 'download_count',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  publishedAt: 'published_at',
};

/**
 * Valid lifecycle status transitions.
 *
 * Key: current status
 * Value: allowed next statuses
 */
const VALID_TRANSITIONS: Record<LifecycleStatus, LifecycleStatus[]> = {
  draft: ['pending_review', 'archived'],
  pending_review: ['approved', 'rejected'],
  approved: ['archived'],
  rejected: ['draft', 'archived'],
  archived: ['draft'], // Restore from archive
};

// ═══════════════════════════════════════════════════════════════════════════
//  Mapping Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Converts a raw snake_case database row into a camelCase `Content` interface.
 */
function mapContent(db: DbContent): Content {
  return {
    contentId: db.content_id,
    instituteId: db.institute_id,
    teacherId: db.teacher_id,
    chapterId: db.chapter_id,
    subjectId: db.subject_id,
    parentContentId: db.parent_content_id,
    title: db.title,
    description: db.description,
    contentType: db.content_type,
    storageBucket: db.storage_bucket,
    storagePath: db.storage_path,
    mimeType: db.mime_type,
    originalFileName: db.original_file_name,
    thumbnailBucket: db.thumbnail_bucket,
    thumbnailPath: db.thumbnail_path,
    durationSeconds: db.duration_seconds,
    pageCount: db.page_count,
    fileSizeBytes: db.file_size_bytes,
    viewCount: db.view_count,
    downloadCount: db.download_count,
    status: db.status,
    isFreePreview: db.is_free_preview,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
    publishedAt: db.published_at,
  };
}

/**
 * Converts a camelCase sort key to its snake_case column name.
 */
function mapSortField(sortBy: ContentSortOptions['sortBy']): string {
  return SORT_FIELD_MAP[sortBy ?? 'createdAt'] ?? 'created_at';
}

/**
 * Validates that a status transition is allowed by the state machine.
 *
 * @returns An error message if the transition is invalid, or null if allowed.
 */
function validateTransition(
  currentStatus: LifecycleStatus,
  nextStatus: LifecycleStatus,
): string | null {
  const allowed = VALID_TRANSITIONS[currentStatus];
  if (!allowed) {
    return `Unknown current status: "${currentStatus}".`;
  }
  if (!allowed.includes(nextStatus)) {
    return `Invalid status transition: "${currentStatus}" → "${nextStatus}". Allowed: ${allowed.join(', ')}`;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  1. getContents()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch a paginated, filtered, and sorted list of content items.
 *
 * Supports filtering by institute, chapter, subject, content type, status,
 * search (title), and tag IDs (via content_tag join). Pagination defaults
 * to page 1, pageSize 20. Sorting defaults to created_at descending.
 *
 * @param filters    - Optional filter criteria.
 * @param sort       - Optional sort configuration.
 * @param pagination - Optional pagination parameters.
 *
 * @example
 * ```ts
 * const result = await getContents(
 *   { instituteId: '...', contentType: 'pdf', status: 'approved' },
 *   { sortBy: 'createdAt', sortDirection: 'desc' },
 *   { page: 1, pageSize: 20 },
 * );
 * ```
 */
export async function getContents(
  filters?: ContentQueryFilters,
  sort?: ContentSortOptions,
  pagination?: PaginationParams,
): Promise<ApiResponse<PaginatedResponse<Content>>> {
  try {
    // ── Build query ────────────────────────────────────────────────────
    let query = supabase
      .from('content')
      .select('*', { count: 'exact' });

    // ── Apply filters ──────────────────────────────────────────────────
    if (filters?.instituteId) {
      validateUUID(filters.instituteId, 'instituteId');
      query = query.eq('institute_id', filters.instituteId);
    }

    if (filters?.teacherId) {
      validateUUID(filters.teacherId, 'teacherId');
      query = query.eq('teacher_id', filters.teacherId);
    }

    if (filters?.chapterId) {
      validateUUID(filters.chapterId, 'chapterId');
      query = query.eq('chapter_id', filters.chapterId);
    }

    if (filters?.subjectId) {
      validateUUID(filters.subjectId, 'subjectId');
      query = query.eq('subject_id', filters.subjectId);
    }

    if (filters?.contentType) {
      query = query.eq('content_type', filters.contentType);
    }

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    if (filters?.lifecycleStatus) {
      query = query.eq('status', filters.lifecycleStatus);
    }

    if (filters?.isFreePreview !== undefined) {
      query = query.eq('is_free_preview', filters.isFreePreview);
    }

    if (filters?.parentContentId !== undefined) {
      if (filters.parentContentId === null) {
        query = query.is('parent_content_id', null);
      } else {
        query = query.eq('parent_content_id', filters.parentContentId);
      }
    }

    if (filters?.isOriginal === true) {
      query = query.is('parent_content_id', null);
    } else if (filters?.isOriginal === false) {
      query = query.not('parent_content_id', 'is', null);
    }

    if (filters?.search) {
      const searchTerm = `%${filters.search}%`;
      query = query.or(`title.ilike.${searchTerm},description.ilike.${searchTerm}`);
    }

    if (filters?.ids && filters.ids.length > 0) {
      query = query.in('content_id', filters.ids);
    }

    // createdBy maps to teacher_id lookup
    if (filters?.createdBy) {
      validateUUID(filters.createdBy, 'createdBy');
      query = query.eq('teacher_id', filters.createdBy);
    }

    // ── Notes on unsupported cross-table filters ─────────────────────────
    // streamId: Not directly filterable on the content table — requires a
    //           join through chapter → subject → stream. Use getContents with
    //           subjectId or chapterId filters instead.
    //
    // topicId:  The content table does not have a topic_id column in the
    //           current schema. Filtering by topic is not yet supported.
    //
    // batchId:  Content has no direct FK to batches. Batch-level content
    //           access is determined through the academic hierarchy
    //           (batch → stream → subject → chapter → content).
    //
    // tags:     Tag-based filtering requires a join through the content_tag
    //           junction table. Use the tagService to find content IDs by
    //           tag, then pass them via the `ids` filter.

    // ── Apply sorting ──────────────────────────────────────────────────
    const sortBy = mapSortField(sort?.sortBy);
    const sortDirection: SortDirection = sort?.sortDirection ?? 'desc';
    query = query.order(sortBy, { ascending: sortDirection === 'asc' });

    // ── Apply pagination ───────────────────────────────────────────────
    const { page, pageSize, from, to } = buildPagination(pagination);
    query = query.range(from, to);

    // ── Execute ────────────────────────────────────────────────────────
    const { data, error, count } = await query;

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    const items = (data ?? []).map(mapContent);

    return {
      success: true,
      data: buildPaginatedResponse(items, count ?? 0, page, pageSize),
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  2. getContentById()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch a single content item by its ID.
 *
 * @param contentId - The UUID of the content to retrieve.
 */
export async function getContentById(contentId: string): Promise<ApiResponse<Content>> {
  try {
    validateUUID(contentId, 'contentId');

    const { data, error } = await supabase
      .from('content')
      .select('*')
      .eq('content_id', contentId)
      .single<DbContent>();

    if (error) {
      if (error.code === 'PGRST116') {
        return { success: false, error: `Content not found: ${contentId}` };
      }
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapContent(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  3. createContent()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Creates a new content record with an uploaded file.
 *
 * Workflow:
 *   1. Generate a contentId for the new row
 *   2. Upload the file to Supabase Storage via storageService
 *   3. Insert the content row in the database
 *   4. If DB insert fails, delete the uploaded file (no orphaned uploads)
 *   5. Optionally upload a thumbnail
 *   6. Return the created Content
 *
 * @param params - Content metadata and file to upload.
 *
 * @example
 * ```ts
 * const result = await createContent({
 *   instituteId: 'inst-123',
 *   teacherId: 'teacher-456',
 *   chapterId: 'ch-789',
 *   title: 'Thermodynamics Notes',
 *   contentType: 'pdf',
 *   file: pdfFile,
 * });
 * ```
 */
export async function createContent(
  params: CreateContentParams,
): Promise<ApiResponse<Content>> {
  const {
    instituteId,
    teacherId,
    chapterId,
    parentContentId,
    title,
    description,
    contentType,
    file,
    thumbnailFile,
    durationSeconds,
    pageCount,
    isFreePreview,
    onProgress,
  } = params;

  try {
    // ── Validate required fields ────────────────────────────────────────
    if (!instituteId) {
      return { success: false, error: 'instituteId is required.' };
    }
    if (!teacherId) {
      return { success: false, error: 'teacherId is required.' };
    }
    if (!chapterId) {
      return { success: false, error: 'chapterId is required.' };
    }
    if (!title?.trim()) {
      return { success: false, error: 'Title is required.' };
    }
    if (!file) {
      return { success: false, error: 'File is required.' };
    }

    validateUUID(instituteId, 'instituteId');
    validateUUID(teacherId, 'teacherId');
    validateUUID(chapterId, 'chapterId');

    if (parentContentId) {
      validateUUID(parentContentId, 'parentContentId');
    }

    // ── 1. Generate content ID ─────────────────────────────────────────
    const contentId = generateUUID();

    // ── 2. Upload file ──────────────────────────────────────────────────
    const uploadResult = await storageUploadFile({
      file,
      contentType,
      instituteId,
      contentId,
      onProgress,
    });

    if (!uploadResult.success) {
      return { success: false, error: `File upload failed: ${uploadResult.error}` };
    }

    const { bucket: storageBucket, storagePath, fileSize: fileSizeBytes, mimeType } =
      uploadResult.data!;

    // ── 3. Insert DB record ─────────────────────────────────────────────
    // Derive subjectId from chapter (the DB trigger/application should
    // resolve this, but we build a minimal insert here)
    const originalFileName = file instanceof File ? file.name : 'upload';

    const dbRecord: Record<string, unknown> = {
      content_id: contentId,
      institute_id: instituteId,
      teacher_id: teacherId,
      chapter_id: chapterId,
      title: title.trim(),
      description: description ?? null,
      content_type: contentType,
      storage_bucket: storageBucket,
      storage_path: storagePath,
      mime_type: mimeType,
      original_file_name: originalFileName,
      duration_seconds: durationSeconds ?? null,
      page_count: pageCount ?? null,
      file_size_bytes: fileSizeBytes,
      is_free_preview: isFreePreview ?? false,
    };

    const { data: dbData, error: dbError } = await supabase
      .from('content')
      .insert(dbRecord)
      .select()
      .single<DbContent>();

    // ── 4. Rollback on DB failure ───────────────────────────────────────
    if (dbError) {
      // Delete the uploaded file to prevent orphaned storage objects
      await storageDeleteFile(storageBucket, storagePath);
      return { success: false, error: extractErrorMessage(dbError) };
    }

    // ── 5. Optionally upload thumbnail ──────────────────────────────────
    if (thumbnailFile) {
      const thumbResult = await storageUploadThumbnail(thumbnailFile, instituteId, contentId);
      if (thumbResult.success && thumbResult.data) {
        // Update the content row with thumbnail references
        await supabase
          .from('content')
          .update({
            thumbnail_bucket: thumbResult.data.bucket,
            thumbnail_path: thumbResult.data.storagePath,
          })
          .eq('content_id', contentId);
      }
      // Thumbnail failure is non-fatal — content is still created
    }

    return { success: true, data: mapContent(dbData) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  4. updateContent()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Updates an existing content record.
 *
 * Supports metadata updates and optional file replacement. When a new file
 * is provided, the old file is deleted first, then the new one is uploaded.
 * All storage operations go through storageService — never directly.
 *
 * @param contentId - The UUID of the content to update.
 * @param params    - The fields to update (all optional).
 */
export async function updateContent(
  contentId: string,
  params: UpdateContentParams,
): Promise<ApiResponse<Content>> {
  try {
    validateUUID(contentId, 'contentId');

    // ── Fetch existing content ─────────────────────────────────────────
    const existing = await getContentById(contentId);
    if (!existing.success || !existing.data) {
      return { success: false, error: `Content not found: ${contentId}` };
    }

    const current = existing.data;

    // ── Build DB update payload ─────────────────────────────────────────
    const dbUpdate: Record<string, unknown> = {};

    if (params.title !== undefined) {
      if (!params.title.trim()) {
        return { success: false, error: 'Title cannot be empty.' };
      }
      dbUpdate.title = params.title.trim();
    }

    if (params.description !== undefined) {
      dbUpdate.description = params.description;
    }

    if (params.durationSeconds !== undefined) {
      dbUpdate.duration_seconds = params.durationSeconds;
    }

    if (params.pageCount !== undefined) {
      dbUpdate.page_count = params.pageCount;
    }

    if (params.isFreePreview !== undefined) {
      dbUpdate.is_free_preview = params.isFreePreview;
    }

    // ── Handle file replacement ─────────────────────────────────────────
    if (params.file) {
      // Only draft/rejected content can have its file replaced
      if (current.status !== 'draft' && current.status !== 'rejected') {
        return {
          success: false,
          error: `Cannot replace file when status is "${current.status}". Only draft or rejected content can be modified.`,
        };
      }

      const replaceResult = await storageReplaceFile(
        {
          file: params.file,
          contentType: current.contentType,
          instituteId: current.instituteId,
          contentId,
          onProgress: params.onProgress,
        },
        current.storageBucket,
        current.storagePath,
      );

      if (!replaceResult.success) {
        return { success: false, error: `File replacement failed: ${replaceResult.error}` };
      }

      dbUpdate.storage_bucket = replaceResult.data!.bucket;
      dbUpdate.storage_path = replaceResult.data!.storagePath;
      dbUpdate.file_size_bytes = replaceResult.data!.fileSize;
      dbUpdate.mime_type = replaceResult.data!.mimeType;
    }

    // ── Handle thumbnail replacement ────────────────────────────────────
    if (params.thumbnailFile) {
      const thumbResult = await storageUploadThumbnail(
        params.thumbnailFile,
        current.instituteId,
        contentId,
      );
      if (thumbResult.success && thumbResult.data) {
        dbUpdate.thumbnail_bucket = thumbResult.data.bucket;
        dbUpdate.thumbnail_path = thumbResult.data.storagePath;
      }
    }

    // ── If nothing to update, return current ────────────────────────────
    if (Object.keys(dbUpdate).length === 0) {
      return { success: true, data: current };
    }

    // ── Execute update ──────────────────────────────────────────────────
    const { data, error } = await supabase
      .from('content')
      .update(dbUpdate)
      .eq('content_id', contentId)
      .select()
      .single<DbContent>();

    if (error) {
      if (error.code === 'PGRST116') {
        return { success: false, error: `Content not found: ${contentId}` };
      }
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapContent(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  5. deleteContent()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Deletes a content record and its associated storage files.
 *
 * Workflow:
 *   1. Delete the storage file via storageService
 *   2. Delete the thumbnail via storageService
 *   3. Delete the database row
 *
 * Since the content table does not support soft delete via `deleted_at`,
 * this performs a hard delete. Foreign key constraints (RESTRICT) will
 * block deletion if tags or approval requests reference this content.
 *
 * For the standard retirement path, use `archiveContent()` instead.
 *
 * @param contentId - The UUID of the content to delete.
 */
export async function deleteContent(contentId: string): Promise<ApiResponse<void>> {
  try {
    validateUUID(contentId, 'contentId');

    // ── Fetch existing content for storage paths ────────────────────────
    const existing = await getContentById(contentId);
    if (!existing.success || !existing.data) {
      return { success: false, error: `Content not found: ${contentId}` };
    }

    const current = existing.data;

    // ── Delete storage files (best-effort) ──────────────────────────────
    await storageDeleteFile(current.storageBucket, current.storagePath);

    if (current.thumbnailBucket && current.thumbnailPath) {
      await storageDeleteFile(current.thumbnailBucket, current.thumbnailPath);
    }

    // ── Delete DB row ──────────────────────────────────────────────────
    const { error } = await supabase
      .from('content')
      .delete()
      .eq('content_id', contentId);

    if (error) {
      if (error.code === '23503') {
        return {
          success: false,
          error:
            'Cannot delete this content because it has associated tags or approval requests. ' +
            'Remove or archive them first, or use archiveContent() instead.',
        };
      }
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  6. publishContent()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Submits content for admin review.
 *
 * Status transition: `draft` → `pending_review`
 *
 * @param contentId - The UUID of the content to publish.
 */
export async function publishContent(contentId: string): Promise<ApiResponse<Content>> {
  return transitionStatus(contentId, 'pending_review');
}

// ═══════════════════════════════════════════════════════════════════════════
//  7. approveContent()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Approves content, making it visible to students.
 *
 * Status transition: `pending_review` → `approved`
 * Sets `published_at` to the current timestamp.
 *
 * @param contentId - The UUID of the content to approve.
 */
export async function approveContent(contentId: string): Promise<ApiResponse<Content>> {
  // Delegates to transitionStatus which handles published_at auto-setting
  return transitionStatus(contentId, 'approved');
}

// ═══════════════════════════════════════════════════════════════════════════
//  8. rejectContent()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Rejects content during review.
 *
 * Status transition: `pending_review` → `rejected`
 *
 * Full review remarks should be stored via the approval_requests service.
 * This function only updates the content table.
 *
 * @param contentId - The UUID of the content to reject.
 */
export async function rejectContent(contentId: string): Promise<ApiResponse<Content>> {
  return transitionStatus(contentId, 'rejected');
}

// ═══════════════════════════════════════════════════════════════════════════
//  9. archiveContent()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Archives (retires) content.
 *
 * Status transition: `approved` → `archived`
 *
 * Archived content is excluded from all student-facing queries via RLS.
 * The storage files are NOT deleted — they remain accessible for admin
 * review and potential restoration.
 *
 * @param contentId - The UUID of the content to archive.
 */
export async function archiveContent(contentId: string): Promise<ApiResponse<Content>> {
  return transitionStatus(contentId, 'archived');
}

// ═══════════════════════════════════════════════════════════════════════════
//  10. restoreContent()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Restores archived content back to draft for revision.
 *
 * Status transition: `archived` → `draft`
 *
 * @param contentId - The UUID of the content to restore.
 */
export async function restoreContent(contentId: string): Promise<ApiResponse<Content>> {
  return transitionStatus(contentId, 'draft');
}

// ═══════════════════════════════════════════════════════════════════════════
//  Internal Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generates a UUID v4 string without relying on `crypto.randomUUID()`
 * (which is unavailable in React Native's JavaScript engine).
 *
 * Uses `Math.random()` as a fallback entropy source. This is suitable for
 * generating unique content IDs for path construction — not for
 * cryptographic security.
 */
function generateUUID(): string {
  // xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  const hex = '0123456789abcdef';
  let uuid = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      uuid += '-';
    } else if (i === 14) {
      uuid += '4'; // version 4
    } else if (i === 19) {
      uuid += hex[(Math.random() * 4) | 8]; // variant 10xx
    } else {
      uuid += hex[(Math.random() * 16) | 0];
    }
  }
  return uuid;
}

/**
 * Transitions content to a new status, validating the state machine.
 *
 * This is the single internal helper for all status transitions. It:
 * 1. Validates the transition is allowed
 * 2. Fetches current content
 * 3. Executes the update
 *
 * @param contentId - The UUID of the content.
 * @param newStatus - The target status.
 */
async function transitionStatus(
  contentId: string,
  newStatus: LifecycleStatus,
): Promise<ApiResponse<Content>> {
  try {
    validateUUID(contentId, 'contentId');

    const existing = await getContentById(contentId);
    if (!existing.success || !existing.data) {
      return { success: false, error: `Content not found: ${contentId}` };
    }

    const transitionError = validateTransition(existing.data.status, newStatus);
    if (transitionError) {
      return { success: false, error: transitionError };
    }

    // Build update payload
    const dbUpdate: Record<string, unknown> = { status: newStatus };

    // Set published_at only when approving
    if (newStatus === 'approved') {
      dbUpdate.published_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('content')
      .update(dbUpdate)
      .eq('content_id', contentId)
      .select()
      .single<DbContent>();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapContent(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}
