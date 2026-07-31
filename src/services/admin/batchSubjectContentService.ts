/**
 * Batch Subject Content Service
 *
 * Manages content assignments within a Batch Subject (subject-within-a-batch).
 * Serves as the primary service for querying and mutating `batch_subject_contents`
 * — the migration 068 replacement for the old `batch_contents` table.
 *
 * ## Scope
 *
 * This service manages the `batch_subject_contents` junction table ONLY.
 * It does NOT manage:
 * - Batch Subject lifecycle (handled by batchSubjectService or direct DB)
 * - Content CRUD or lifecycle (handled by contentService)
 * - Teacher assignment (handled by batchSubjectTeacherService)
 * - Course content assignment (handled by courseContentAssignmentService)
 *
 * ## Business Rules
 *
 * - A Batch Subject may contain multiple content items (many-to-many).
 * - A content item may belong to multiple Batch Subjects across batches.
 * - Assigning content adds new entries; duplicate entries are silently skipped.
 * - Only approved/published, non-deleted content from the same institute is eligible.
 * - Teachers can only manage content for Batch Subjects they are assigned to.
 *
 * @module services/admin/batchSubjectContentService
 */

import { supabase } from '@/config/supabase';
import { extractErrorMessage, validateUUID } from '@/utils/supabase';
import type { ApiResponse } from '@/types/academic';
import { auditService } from '@/services/audit/auditService';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

/** Content assigned to a Batch Subject. */
export interface AssignedBatchSubjectContent {
  batchSubjectContentId: string;
  contentId: string;
  title: string;
  contentType: string;
  subjectId: string;
  subjectName: string | null;
  chapterId: string;
  chapterName: string | null;
  teacherId: string;
  teacherName: string | null;
  thumbnailBucket: string | null;
  thumbnailPath: string | null;
  durationSeconds: number | null;
  pageCount: number | null;
  fileSizeBytes: number | null;
  status: string;
  sectionName: string | null;
  orderSequence: number;
  isOptional: boolean;
  assignedAt: string;
  assignedBy: string | null;
}

/** Content available for assignment to a Batch Subject. */
export interface AvailableBatchSubjectContent {
  contentId: string;
  title: string;
  contentType: string;
  subjectId: string;
  subjectName: string | null;
  chapterId: string;
  chapterName: string | null;
  teacherId: string;
  teacherName: string | null;
  durationSeconds: number | null;
  pageCount: number | null;
  fileSizeBytes: number | null;
  thumbnailBucket: string | null;
  thumbnailPath: string | null;
  status: string;
}

/** Assignment statistics for a Batch Subject. */
export interface BatchSubjectContentStats {
  /** Number of content items assigned to this batch subject. */
  assignedCount: number;
  /** Number of content items available for assignment. */
  availableCount: number;
  /** Content type breakdown of assigned content. */
  byType: { contentType: string; count: number }[];
  /** Count of optional vs required content. */
  optionalCount: number;
  requiredCount: number;
}

/** Input for reordering content within a Batch Subject. */
export interface ReorderInput {
  batchSubjectContentId: string;
  orderSequence: number;
}

/** A Batch Subject with enriched counts for the admin subjects page. */
export interface BatchSubjectWithCounts {
  batchSubjectId: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  sortOrder: number;
  isActive: boolean;
  contentCount: number;
  mockTestCount: number;
  teacherCount: number;
  liveClassCount: number;
}

/** A subject available for assignment to a batch (from the stream, not yet assigned). */
export interface AvailableSubject {
  subjectId: string;
  name: string;
  code: string;
  displayOrder: number;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Formats file size bytes into a human-readable string (e.g. "2.5 MB"). */
function formatFileSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Formats duration seconds into a human-readable string (e.g. "15 min" or "1h 30m"). */
function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Service
// ═══════════════════════════════════════════════════════════════════════════

export const batchSubjectContentService = {
  // ─────────────────────────────────────────────────────────────────────────
  //  1. Get Assigned Content
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get all content items assigned to a specific Batch Subject.
   *
   * Joins `batch_subject_contents` → `content` → `subjects`, `chapters`,
   * `teacher_details` + `profiles` to return enriched content information.
   *
   * @param batchSubjectId - The `batch_subjects.batch_subject_id`.
   */
  async getAssignedContent(
    batchSubjectId: string,
  ): Promise<ApiResponse<AssignedBatchSubjectContent[]>> {
    try {
      validateUUID(batchSubjectId, 'batchSubjectId');

      const { data, error } = await supabase
        .from('batch_subject_contents')
        .select(
          `
          batch_subject_content_id,
          content_id,
          order_sequence,
          section_name,
          is_optional,
          assigned_at,
          assigned_by,
          content!inner (
            content_id,
            title,
            content_type,
            subject_id,
            chapter_id,
            teacher_id,
            thumbnail_bucket,
            thumbnail_path,
            duration_seconds,
            page_count,
            file_size_bytes,
            status,
            subjects!left (
              name
            ),
            chapters!left (
              name
            ),
            teacher_details!left (
              profiles!inner (
                name
              )
            )
          )
        `,
        )
        .eq('batch_subject_id', batchSubjectId)
        .order('order_sequence', { ascending: true });

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const items: AssignedBatchSubjectContent[] = (data ?? []).map((row: any) => {
        const c = row.content ?? {};

        return {
          batchSubjectContentId: row.batch_subject_content_id,
          contentId: c.content_id ?? row.content_id,
          title: c.title ?? 'Unknown',
          contentType: c.content_type ?? 'unknown',
          subjectId: c.subject_id ?? '',
          subjectName: c.subjects?.name ?? null,
          chapterId: c.chapter_id ?? '',
          chapterName: c.chapters?.name ?? null,
          teacherId: c.teacher_id ?? '',
          teacherName: c.teacher_details?.profiles?.name ?? null,
          thumbnailBucket: c.thumbnail_bucket ?? null,
          thumbnailPath: c.thumbnail_path ?? null,
          durationSeconds: c.duration_seconds ?? null,
          pageCount: c.page_count ?? null,
          fileSizeBytes: c.file_size_bytes ?? null,
          status: c.status ?? 'unknown',
          sectionName: row.section_name ?? null,
          orderSequence: row.order_sequence ?? 0,
          isOptional: row.is_optional ?? false,
          assignedAt: row.assigned_at ?? '',
          assignedBy: row.assigned_by ?? null,
        };
      });

      return { success: true, data: items };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  2. Get Available Content
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Fetch content items available for assignment to a Batch Subject.
   *
   * Returns approved/published, non-soft-deleted content from the same
   * institute that matches the Batch Subject's subject_id.
   * Supports optional search by title, description, or content type.
   * Excludes content already assigned to this Batch Subject.
   *
   * @param batchSubjectId - The `batch_subjects.batch_subject_id`.
   * @param subjectId      - The subject_id to scope available content.
   * @param search         - Optional search term.
   */
  async getAvailableContent(
    batchSubjectId: string,
    subjectId: string,
    search?: string,
  ): Promise<ApiResponse<AvailableBatchSubjectContent[]>> {
    try {
      validateUUID(batchSubjectId, 'batchSubjectId');
      validateUUID(subjectId, 'subjectId');

      // 1. Get the Batch Subject's institute_id
      const { data: bs, error: bsErr } = await supabase
        .from('batch_subjects')
        .select('institute_id')
        .eq('batch_subject_id', batchSubjectId)
        .single();

      if (bsErr) {
        if (bsErr.code === 'PGRST116') {
          return { success: false, error: `Batch Subject not found: ${batchSubjectId}` };
        }
        return { success: false, error: extractErrorMessage(bsErr) };
      }

      // 2. Get already-assigned content IDs to exclude them
      const { data: assignedData } = await supabase
        .from('batch_subject_contents')
        .select('content_id')
        .eq('batch_subject_id', batchSubjectId);

      const assignedContentIds = (assignedData ?? []).map((r: any) => r.content_id);

      // 3. Query available content (approved, same subject, not already assigned)
      let query = supabase
        .from('content')
        .select(
          `
          content_id,
          title,
          content_type,
          subject_id,
          chapter_id,
          teacher_id,
          thumbnail_bucket,
          thumbnail_path,
          duration_seconds,
          page_count,
          file_size_bytes,
          status,
          subjects!left (
            name
          ),
          chapters!left (
            name
          ),
          teacher_details!left (
            profiles!inner (
              name
            )
          )
        `,
        )
        .eq('institute_id', bs.institute_id)
        .eq('subject_id', subjectId)
        .in('status', ['approved']);

      // Exclude already assigned content
      if (assignedContentIds.length > 0) {
        query = query.not('content_id', 'in', `(${assignedContentIds.join(',')})`);
      }

      // Search filter
      if (search?.trim()) {
        const term = `%${search.trim()}%`;
        query = query.or(
          `title.ilike.${term},description.ilike.${term},content_type.ilike.${term}`,
        );
      }

      query = query.order('title', { ascending: true });

      const { data, error } = await query;

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const items: AvailableBatchSubjectContent[] = (data ?? []).map((row: any) => ({
        contentId: row.content_id,
        title: row.title ?? 'Unknown',
        contentType: row.content_type ?? 'unknown',
        subjectId: row.subject_id ?? '',
        subjectName: row.subjects?.name ?? null,
        chapterId: row.chapter_id ?? '',
        chapterName: row.chapters?.name ?? null,
        teacherId: row.teacher_id ?? '',
        teacherName: row.teacher_details?.profiles?.name ?? null,
        durationSeconds: row.duration_seconds ?? null,
        pageCount: row.page_count ?? null,
        fileSizeBytes: row.file_size_bytes ?? null,
        thumbnailBucket: row.thumbnail_bucket ?? null,
        thumbnailPath: row.thumbnail_path ?? null,
        status: row.status ?? 'unknown',
      }));

      return { success: true, data: items };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  3. Assign Content
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Assign one or more content items to a Batch Subject.
   *
   * **Business Rule:** A Batch Subject may contain multiple content items.
   * New assignments get auto-incremented order_sequence. Duplicate entries
   * are silently skipped via ON CONFLICT handling.
   *
   * @param batchSubjectId - The `batch_subjects.batch_subject_id`.
   * @param contentIds     - Array of `content.content_id` values.
   * @param sectionName    - Optional section/module label (e.g. "Week 1").
   *
   * @returns The count of content items actually assigned.
   */
  async assignContent(
    batchSubjectId: string,
    contentIds: string[],
    sectionName?: string | null,
  ): Promise<ApiResponse<{ assigned: number }>> {
    try {
      validateUUID(batchSubjectId, 'batchSubjectId');

      if (!contentIds.length) {
        return { success: false, error: 'No content IDs provided.' };
      }

      for (const id of contentIds) {
        validateUUID(id, 'contentId');
      }

      // 1. Get batch subject's institute_id
      const { data: bs, error: bsErr } = await supabase
        .from('batch_subjects')
        .select('institute_id')
        .eq('batch_subject_id', batchSubjectId)
        .single();

      if (bsErr) {
        if (bsErr.code === 'PGRST116') {
          return { success: false, error: `Batch Subject not found: ${batchSubjectId}` };
        }
        return { success: false, error: extractErrorMessage(bsErr) };
      }

      // 2. Determine the next order_sequence for new content
      const { data: maxSeqData } = await supabase
        .from('batch_subject_contents')
        .select('order_sequence')
        .eq('batch_subject_id', batchSubjectId)
        .order('order_sequence', { ascending: false })
        .limit(1);

      const nextSequence = (maxSeqData && maxSeqData.length > 0
        ? (maxSeqData[0] as any).order_sequence + 1
        : 1);

      // 3. Get the current user for assigned_by
      const { data: userData } = await supabase.auth.getUser();
      const assignedBy = userData?.user?.id ?? null;

      // 4. Build insert records
      const now = new Date().toISOString();
      const records = contentIds.map((contentId, index) => ({
        batch_subject_id: batchSubjectId,
        content_id: contentId,
        institute_id: bs.institute_id,
        order_sequence: nextSequence + index,
        section_name: sectionName ?? null,
        is_optional: false,
        assigned_at: now,
        assigned_by: assignedBy,
      }));

      // 5. Insert via individual attempts for graceful handling
      let assigned = 0;
      for (const record of records) {
        const { error: singleErr } = await supabase
          .from('batch_subject_contents')
          .insert(record);

        if (!singleErr) {
          assigned++;
        } else if (singleErr.code !== '23505') {
          // 23505 = duplicate, skip silently
          return { success: false, error: extractErrorMessage(singleErr) };
        }
      }

      // ── Audit: content assigned to batch subject ──────────────────────
      await auditService.logAssign({
        resourceType: 'batch_subject_contents',
        resourceId: null,
        metadata: { batchSubjectId, contentIds, assigned, sectionName: sectionName ?? null },
      });

      return { success: true, data: { assigned } };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  4. Remove Single Content
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Remove a specific content item from a Batch Subject.
   *
   * If the content is not currently assigned, the operation succeeds silently.
   *
   * @param batchSubjectId - The `batch_subjects.batch_subject_id`.
   * @param contentId      - The `content.content_id` to remove.
   */
  async removeContent(
    batchSubjectId: string,
    contentId: string,
  ): Promise<ApiResponse<null>> {
    try {
      validateUUID(batchSubjectId, 'batchSubjectId');
      validateUUID(contentId, 'contentId');

      const { error } = await supabase
        .from('batch_subject_contents')
        .delete()
        .eq('batch_subject_id', batchSubjectId)
        .eq('content_id', contentId);

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      // ── Audit: content unassigned from batch subject ──────────────────
      await auditService.logUnassign({
        resourceType: 'batch_subject_contents',
        resourceId: null,
        metadata: { batchSubjectId, contentId },
      });

      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  5. Remove Multiple Content Items
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Remove multiple content items from a Batch Subject.
   *
   * @param batchSubjectId - The `batch_subjects.batch_subject_id`.
   * @param contentIds     - Array of `content.content_id` values to remove.
   */
  async removeContents(
    batchSubjectId: string,
    contentIds: string[],
  ): Promise<ApiResponse<null>> {
    try {
      validateUUID(batchSubjectId, 'batchSubjectId');

      if (!contentIds.length) {
        return { success: false, error: 'No content IDs provided.' };
      }

      for (const id of contentIds) {
        validateUUID(id, 'contentId');
      }

      const { error } = await supabase
        .from('batch_subject_contents')
        .delete()
        .eq('batch_subject_id', batchSubjectId)
        .in('content_id', contentIds);

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      // ── Audit: content items unassigned (single bulk event) ───────────
      await auditService.logUnassign({
        resourceType: 'batch_subject_contents',
        resourceId: null,
        metadata: { batchSubjectId, contentIds, count: contentIds.length },
      });

      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  6. Reorder Content
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Reorder content items within a Batch Subject.
   *
   * Accepts an array of `{ batchSubjectContentId, orderSequence }` pairs.
   * All updates are performed atomically in a single batch.
   *
   * @param reorderList - Array of reorder inputs.
   */
  async reorderContent(
    reorderList: ReorderInput[],
  ): Promise<ApiResponse<null>> {
    try {
      if (!reorderList.length) {
        return { success: false, error: 'No reorder data provided.' };
      }

      // Update each item's order_sequence
      for (const item of reorderList) {
        const { error } = await supabase
          .from('batch_subject_contents')
          .update({ order_sequence: item.orderSequence })
          .eq('batch_subject_content_id', item.batchSubjectContentId);

        if (error) {
          return { success: false, error: extractErrorMessage(error) };
        }
      }

      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  7. Update Content Assignment
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Update a single content assignment's metadata (section_name, is_optional).
   *
   * @param batchSubjectContentId - The PK of the assignment row.
   * @param updates              - Fields to update.
   */
  async updateAssignment(
    batchSubjectContentId: string,
    updates: {
      sectionName?: string | null;
      isOptional?: boolean;
      orderSequence?: number;
    },
  ): Promise<ApiResponse<null>> {
    try {
      validateUUID(batchSubjectContentId, 'batchSubjectContentId');

      const dbUpdates: Record<string, unknown> = {};

      if (updates.sectionName !== undefined) {
        dbUpdates.section_name = updates.sectionName;
      }
      if (updates.isOptional !== undefined) {
        dbUpdates.is_optional = updates.isOptional;
      }
      if (updates.orderSequence !== undefined) {
        dbUpdates.order_sequence = updates.orderSequence;
      }

      if (Object.keys(dbUpdates).length === 0) {
        return { success: true, data: null };
      }

      const { error } = await supabase
        .from('batch_subject_contents')
        .update(dbUpdates)
        .eq('batch_subject_content_id', batchSubjectContentId);

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  8. Get Assignment Stats
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get content assignment statistics for a Batch Subject.
   *
   * @param batchSubjectId - The `batch_subjects.batch_subject_id`.
   * @param subjectId      - The subject_id to count available content.
   */
  async getAssignmentStats(
    batchSubjectId: string,
    subjectId: string,
  ): Promise<ApiResponse<BatchSubjectContentStats>> {
    try {
      validateUUID(batchSubjectId, 'batchSubjectId');
      validateUUID(subjectId, 'subjectId');

      // 1. Get batch subject's institute_id
      const { data: bs, error: bsErr } = await supabase
        .from('batch_subjects')
        .select('institute_id')
        .eq('batch_subject_id', batchSubjectId)
        .single();

      if (bsErr) {
        if (bsErr.code === 'PGRST116') {
          return { success: false, error: `Batch Subject not found: ${batchSubjectId}` };
        }
        return { success: false, error: extractErrorMessage(bsErr) };
      }

      // 2. Count assigned content
      const { count: assignedCount, error: assignedErr } = await supabase
        .from('batch_subject_contents')
        .select('batch_subject_content_id', { count: 'exact', head: true })
        .eq('batch_subject_id', batchSubjectId);

      if (assignedErr) {
        return { success: false, error: extractErrorMessage(assignedErr) };
      }

      // 3. Count optional vs required
      const { count: optionalCount } = await supabase
        .from('batch_subject_contents')
        .select('batch_subject_content_id', { count: 'exact', head: true })
        .eq('batch_subject_id', batchSubjectId)
        .eq('is_optional', true);

      const requiredCount = (assignedCount ?? 0) - (optionalCount ?? 0);

      // 4. Get already-assigned content IDs
      const { data: assignedData } = await supabase
        .from('batch_subject_contents')
        .select('content_id')
        .eq('batch_subject_id', batchSubjectId);

      const assignedContentIds = (assignedData ?? []).map((r: any) => r.content_id);

      // 5. Count available content
      let availableQuery = supabase
        .from('content')
        .select('content_id', { count: 'exact', head: true })
        .eq('institute_id', bs.institute_id)
        .eq('subject_id', subjectId)
        .in('status', ['approved']);

      if (assignedContentIds.length > 0) {
        availableQuery = availableQuery.not('content_id', 'in', `(${assignedContentIds.join(',')})`);
      }

      const { count: availableCount } = await availableQuery;

      // 6. Content type breakdown
      const { data: typeData } = await supabase
        .from('batch_subject_contents')
        .select(
          `
          content!inner (
            content_type
          )
        `,
        )
        .eq('batch_subject_id', batchSubjectId);

      const typeCountMap = new Map<string, number>();
      for (const row of (typeData ?? []) as any[]) {
        const contentType = row.content?.content_type ?? 'unknown';
        typeCountMap.set(contentType, (typeCountMap.get(contentType) ?? 0) + 1);
      }

      const byType = [...typeCountMap.entries()]
        .map(([contentType, count]) => ({ contentType, count }))
        .sort((a, b) => b.count - a.count);

      return {
        success: true,
        data: {
          assignedCount: assignedCount ?? 0,
          availableCount: availableCount ?? 0,
          byType,
          optionalCount: optionalCount ?? 0,
          requiredCount,
        },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  9. Get Batch Subject Details (with subject info)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get details about a Batch Subject including its subject name, batch info.
   *
   * @param batchSubjectId - The `batch_subjects.batch_subject_id`.
   */
  async getBatchSubjectDetail(
    batchSubjectId: string,
  ): Promise<
    ApiResponse<{
      batchSubjectId: string;
      batchId: string;
      batchName: string;
      subjectId: string;
      subjectName: string;
      subjectCode: string;
      isActive: boolean;
      batchSubjectName: string;
    }>
  > {
    try {
      validateUUID(batchSubjectId, 'batchSubjectId');

      const { data, error } = await supabase
        .from('batch_subjects')
        .select(
          `
          batch_subject_id,
          batch_id,
          subject_id,
          is_active,
          sort_order,
          batches!inner (
            name
          ),
          subjects!inner (
            name,
            code
          )
        `,
        )
        .eq('batch_subject_id', batchSubjectId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return { success: false, error: `Batch Subject not found: ${batchSubjectId}` };
        }
        return { success: false, error: extractErrorMessage(error) };
      }

      return {
        success: true,
        data: {
          batchSubjectId: data.batch_subject_id,
          batchId: data.batch_id,
          batchName: data.batches?.name ?? 'Unknown Batch',
          subjectId: data.subject_id,
          subjectName: data.subjects?.name ?? 'Unknown Subject',
          subjectCode: data.subjects?.code ?? '',
          isActive: data.is_active ?? true,
          batchSubjectName: `${data.batches?.name ?? ''} - ${data.subjects?.name ?? ''}`,
        },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  10. Get Batch Subjects for a Batch
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get all active Batch Subjects for a given batch, with subject info.
   *
   * @param batchId - The `batches.batch_id`.
   */
  async getBatchSubjects(
    batchId: string,
  ): Promise<
    ApiResponse<
      Array<{
        batchSubjectId: string;
        subjectId: string;
        subjectName: string;
        subjectCode: string;
        sortOrder: number;
        isActive: boolean;
        contentCount: number;
        mockTestCount: number;
        teacherCount: number;
        liveClassCount: number;
      }>
    >
  > {
    try {
      validateUUID(batchId, 'batchId');

      const { data, error } = await supabase
        .from('batch_subjects')
        .select(
          `
          batch_subject_id,
          subject_id,
          sort_order,
          is_active,
          subjects!inner (
            name,
            code
          )
        `,
        )
        .eq('batch_id', batchId)
        .order('sort_order', { ascending: true });

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      // Get content and mock test counts per batch subject
      const items = await Promise.all(
        (data ?? []).map(async (row: any) => {
          const { count: contentCount } = await supabase
            .from('batch_subject_contents')
            .select('batch_subject_content_id', { count: 'exact', head: true })
            .eq('batch_subject_id', row.batch_subject_id);

          const { count: mockTestCount } = await supabase
            .from('batch_subject_mock_tests')
            .select('assignment_id', { count: 'exact', head: true })
            .eq('batch_subject_id', row.batch_subject_id);

          const { count: teacherCount } = await supabase
            .from('batch_subject_teachers')
            .select('teacher_id', { count: 'exact', head: true })
            .eq('batch_subject_id', row.batch_subject_id);

          // Live classes count: live_classes has batch_subject_id as direct FK
          const { count: liveClassCount } = await supabase
            .from('live_classes')
            .select('class_id', { count: 'exact', head: true })
            .eq('batch_subject_id', row.batch_subject_id);

          return {
            batchSubjectId: row.batch_subject_id,
            subjectId: row.subject_id,
            subjectName: row.subjects?.name ?? 'Unknown',
            subjectCode: row.subjects?.code ?? '',
            sortOrder: row.sort_order ?? 0,
            isActive: row.is_active ?? true,
            contentCount: contentCount ?? 0,
            mockTestCount: mockTestCount ?? 0,
            teacherCount: teacherCount ?? 0,
            liveClassCount: liveClassCount ?? 0,
          };
        }),
      );

      return { success: true, data: items };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  11. Get Available Subjects for a Batch
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get subjects from the batch's stream that are NOT yet assigned to the batch.
   *
   * @param batchId - The `batches.batch_id`.
   */
  async getAvailableSubjects(
    batchId: string,
  ): Promise<ApiResponse<AvailableSubject[]>> {
    try {
      validateUUID(batchId, 'batchId');

      // 1. Get batch's stream_id and institute_id
      const { data: batch, error: batchErr } = await supabase
        .from('batches')
        .select('stream_id, institute_id')
        .eq('batch_id', batchId)
        .single();

      if (batchErr) {
        if (batchErr.code === 'PGRST116') {
          return { success: false, error: `Batch not found: ${batchId}` };
        }
        return { success: false, error: extractErrorMessage(batchErr) };
      }

      // 2. Get already-assigned subject IDs for this batch
      const { data: assignedData } = await supabase
        .from('batch_subjects')
        .select('subject_id')
        .eq('batch_id', batchId);

      const assignedSubjectIds = (assignedData ?? []).map((r: any) => r.subject_id);

      // 3. Query all subjects in the stream, excluding already-assigned ones
      let query = supabase
        .from('subjects')
        .select('subject_id, name, code, display_order')
        .eq('stream_id', batch.stream_id)
        .order('display_order', { ascending: true });

      if (assignedSubjectIds.length > 0) {
        query = query.not('subject_id', 'in', `(${assignedSubjectIds.join(',')})`);
      }

      const { data, error } = await query;

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const items: AvailableSubject[] = (data ?? []).map((row: any) => ({
        subjectId: row.subject_id,
        name: row.name,
        code: row.code,
        displayOrder: row.display_order,
      }));

      return { success: true, data: items };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  12. Assign Subjects to a Batch
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Assign one or more subjects from the stream to a batch.
   * Creates batch_subject records. Duplicates are silently skipped.
   *
   * @param batchId    - The `batches.batch_id`.
   * @param subjectIds - Array of `subjects.subject_id` values to assign.
   *
   * @returns The count of subjects actually assigned.
   */
  async assignSubjectsToBatch(
    batchId: string,
    subjectIds: string[],
  ): Promise<ApiResponse<{ assigned: number }>> {
    try {
      validateUUID(batchId, 'batchId');

      if (!subjectIds.length) {
        return { success: false, error: 'No subject IDs provided.' };
      }

      for (const id of subjectIds) {
        validateUUID(id, 'subjectId');
      }

      // 1. Get batch's institute_id
      const { data: batch, error: batchErr } = await supabase
        .from('batches')
        .select('institute_id')
        .eq('batch_id', batchId)
        .single();

      if (batchErr) {
        if (batchErr.code === 'PGRST116') {
          return { success: false, error: `Batch not found: ${batchId}` };
        }
        return { success: false, error: extractErrorMessage(batchErr) };
      }

      // 2. Get subject display orders for sort_order
      const { data: subjects } = await supabase
        .from('subjects')
        .select('subject_id, name, display_order')
        .in('subject_id', subjectIds);

      const subjectMap = new Map(
        (subjects ?? []).map((s: any) => [s.subject_id, { name: s.name, displayOrder: s.display_order }]),
      );

      // 3. Get current user for created_by
      const { data: userData } = await supabase.auth.getUser();
      const createdBy = userData?.user?.id ?? null;

      // 4. Build insert records
      const now = new Date().toISOString();
      const records = subjectIds.map((subjectId) => {
        const info = subjectMap.get(subjectId);
        return {
          batch_id: batchId,
          subject_id: subjectId,
          institute_id: batch.institute_id,
          name: info?.name ?? null,
          sort_order: info?.displayOrder ?? 0,
          is_active: true,
          created_at: now,
          updated_at: now,
          created_by: createdBy,
          updated_by: null,
        };
      });

      // 5. Insert individually for graceful duplicate handling
      let assigned = 0;
      for (const record of records) {
        const { error: singleErr } = await supabase
          .from('batch_subjects')
          .insert(record);

        if (!singleErr) {
          assigned++;
        } else if (singleErr.code !== '23505') {
          // 23505 = duplicate (batch_id, subject_id), skip silently
          return { success: false, error: extractErrorMessage(singleErr) };
        }
      }

      // ── Audit: subjects assigned to batch (single bulk event) ─────────
      await auditService.logAssign({
        resourceType: 'batch_subjects',
        resourceId: null,
        metadata: { batchId, subjectIds, assigned },
      });

      return { success: true, data: { assigned } };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  13. Remove a Batch Subject (with dependency check)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Remove a subject from a batch by deleting its batch_subject record.
   *
   * If the batch_subject has dependent data (content, mock tests, teachers,
   * live classes, recordings), returns an error message listing the
   * dependencies. The caller should confirm with the admin before proceeding.
   *
   * When `force` is true, deletes all dependent data first, then removes
   * the batch_subject.
   *
   * @param batchSubjectId - The `batch_subjects.batch_subject_id`.
   * @param force          - If true, cascade-delete dependent data.
   */
  async removeBatchSubject(
    batchSubjectId: string,
    force: boolean = false,
  ): Promise<ApiResponse<null>> {
    try {
      validateUUID(batchSubjectId, 'batchSubjectId');

      if (force) {
        // Delete all dependent data in order
        await supabase.from('batch_subject_contents').delete().eq('batch_subject_id', batchSubjectId);
        await supabase.from('batch_subject_mock_tests').delete().eq('batch_subject_id', batchSubjectId);
        await supabase.from('batch_subject_teachers').delete().eq('batch_subject_id', batchSubjectId);
        // Delete live class assignments (junction table). live_classes themselves
        // remain unaffected — only the batch_subject_live_classes links are removed.
        await supabase.from('batch_subject_live_classes').delete().eq('batch_subject_id', batchSubjectId);

        // Delete the batch_subject itself
        const { error } = await supabase
          .from('batch_subjects')
          .delete()
          .eq('batch_subject_id', batchSubjectId);

        if (error) {
          return { success: false, error: extractErrorMessage(error) };
        }

        return { success: true, data: null };
      }

      // Check for dependent data
      const promises = [
        supabase
          .from('batch_subject_contents')
          .select('batch_subject_content_id', { count: 'exact', head: true })
          .eq('batch_subject_id', batchSubjectId),
        supabase
          .from('batch_subject_mock_tests')
          .select('assignment_id', { count: 'exact', head: true })
          .eq('batch_subject_id', batchSubjectId),
        supabase
          .from('batch_subject_teachers')
          .select('teacher_id', { count: 'exact', head: true })
          .eq('batch_subject_id', batchSubjectId),
        supabase
          .from('live_classes')
          .select('class_id', { count: 'exact', head: true })
          .eq('batch_subject_id', batchSubjectId),
      ] as const;

      const [contentRes, mockTestRes, teacherRes, liveClassRes] = await Promise.all(promises);

      const contentCount = contentRes.count ?? 0;
      const mockTestCount = mockTestRes.count ?? 0;
      const teacherCount = teacherRes.count ?? 0;
      const liveClassCount = liveClassRes.count ?? 0;

      const totalDependencies = contentCount + mockTestCount + teacherCount + liveClassCount;

      if (totalDependencies > 0) {
        const parts: string[] = [];
        if (contentCount > 0) parts.push(`${contentCount} content item(s)`);
        if (mockTestCount > 0) parts.push(`${mockTestCount} mock test(s)`);
        if (teacherCount > 0) parts.push(`${teacherCount} teacher(s)`);
        if (liveClassCount > 0) parts.push(`${liveClassCount} live class(es)`);

        return {
          success: false,
          error: `Cannot remove this subject. It has ${parts.join(', ')} assigned. Remove those first or use force delete.`,
          data: null,
        };
      }

      // No dependencies — safe to delete
      const { error } = await supabase
        .from('batch_subjects')
        .delete()
        .eq('batch_subject_id', batchSubjectId);

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─── Exported helpers for display formatting (used by UI) ─────────────

  formatFileSize,
  formatDuration,
};
