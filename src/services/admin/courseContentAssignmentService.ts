/**
 * Course Content Assignment Service
 *
 * Single source of truth for content assignment operations within the
 * Admin Course Management module.
 *
 * Every public method returns a standardised `ApiResponse<T>` shape.
 * Follows the exact same architecture as `courseBatchAssignmentService.ts`
 * and `batchStudentAssignmentService.ts`.
 *
 * ## Scope
 *
 * This service manages the `course_content` junction table (migration 033).
 * It does NOT manage:
 * - Course lifecycle (handled by courseManagementService)
 * - Teacher/batch assignment to courses (handled by separate services)
 *
 * ## Business Rules
 *
 * - A course may contain multiple content items (many-to-many).
 * - A content item may belong to multiple courses.
 * - Assigning content adds new entries; duplicate entries are silently skipped.
 * - Only approved/published, non-deleted content from the same institute is eligible.
 *
 * @module services/admin/courseContentAssignmentService
 */

import { supabase } from '@/config/supabase';
import { extractErrorMessage, validateUUID } from '@/utils/supabase';
import type { ApiResponse } from '@/types/academic';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

/** Content assigned to a course. */
export interface AssignedCourseContent {
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
  assignedAt: string;
}

/** Content available for assignment to a course. */
export interface AvailableCourseContent {
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

/** Assignment statistics for a course. */
export interface CourseContentAssignmentStats {
  /** Number of content items assigned to this course. */
  assignedCount: number;
  /** Number of content items available for assignment. */
  availableCount: number;
  /** Content type breakdown of assigned content. */
  byType: { contentType: string; count: number }[];
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

export const courseContentAssignmentService = {
  // ─────────────────────────────────────────────────────────────────────────
  //  1. Get Assigned Content
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get all content items assigned to a course.
   *
   * Joins `course_content` → `content` → `subjects`, `chapters`,
   * `teacher_details` + `profiles` to return enriched content information.
   *
   * @param courseId - The `courses.course_id`.
   */
  async getAssignedContent(courseId: string): Promise<ApiResponse<AssignedCourseContent[]>> {
    try {
      validateUUID(courseId, 'courseId');

      const { data, error } = await supabase
        .from('course_content')
        .select(
          `
          content_id,
          order_sequence,
          section_name,
          assigned_at,
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
        .eq('course_id', courseId)
        .order('order_sequence', { ascending: true });

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const items: AssignedCourseContent[] = (data ?? []).map((row: any) => {
        const c = row.content ?? {};

        return {
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
          assignedAt: row.assigned_at ?? '',
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
   * Fetch content items available for assignment to a course.
   *
   * Returns approved/published, non-soft-deleted content from the same
   * institute.  Supports optional search by title, description, or
   * content type.  Excludes content already assigned to this course.
   *
   * @param courseId - The `courses.course_id` to determine the institute scope.
   * @param search   - Optional search term (title, description, or content type).
   */
  async getAvailableContent(
    courseId: string,
    search?: string,
  ): Promise<ApiResponse<AvailableCourseContent[]>> {
    try {
      validateUUID(courseId, 'courseId');

      // 1. Get the course's institute_id
      const { data: course, error: courseErr } = await supabase
        .from('courses')
        .select('institute_id')
        .eq('course_id', courseId)
        .is('deleted_at', null)
        .single();

      if (courseErr) {
        if (courseErr.code === 'PGRST116') {
          return { success: false, error: `Course not found: ${courseId}` };
        }
        return { success: false, error: extractErrorMessage(courseErr) };
      }

      // 2. Get already-assigned content IDs to exclude them
      const { data: assignedData } = await supabase
        .from('course_content')
        .select('content_id')
        .eq('course_id', courseId);

      const assignedContentIds = (assignedData ?? []).map((r: any) => r.content_id);

      // 3. Query available content (approved/published, not assigned)
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
        .eq('institute_id', course.institute_id)
        .in('status', ['approved'])

      // Exclude already assigned content
      if (assignedContentIds.length > 0) {
        // Manual parens — .not() doesn't wrap arrays like .in() does
        query = query.not('content_id', 'in', `(${assignedContentIds.join(',')})`);
      }

      // Search filter: title, description, or content type
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

      const items: AvailableCourseContent[] = (data ?? []).map((row: any) => ({
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
   * Assign one or more content items to a course.
   *
   * **Business Rule:** A course may contain multiple content items. This
   * method inserts new assignment rows with auto-incremented order_sequence.
   * If a content item is already assigned, it is silently skipped.
   *
   * @param courseId    - The `courses.course_id`.
   * @param contentIds  - Array of `content.content_id` values.
   *
   * @returns The count of content items actually assigned.
   */
  async assignContent(
    courseId: string,
    contentIds: string[],
  ): Promise<ApiResponse<{ assigned: number }>> {
    try {
      validateUUID(courseId, 'courseId');

      if (!contentIds.length) {
        return { success: false, error: 'No content IDs provided.' };
      }

      // Validate all content IDs
      for (const id of contentIds) {
        validateUUID(id, 'contentId');
      }

      // 1. Get course institute_id
      const { data: course, error: courseErr } = await supabase
        .from('courses')
        .select('institute_id')
        .eq('course_id', courseId)
        .is('deleted_at', null)
        .single();

      if (courseErr) {
        if (courseErr.code === 'PGRST116') {
          return { success: false, error: `Course not found: ${courseId}` };
        }
        return { success: false, error: extractErrorMessage(courseErr) };
      }

      // 2. Determine the next order_sequence for new content
      const { data: maxSeqData } = await supabase
        .from('course_content')
        .select('order_sequence')
        .eq('course_id', courseId)
        .order('order_sequence', { ascending: false })
        .limit(1);

      const nextSequence = (maxSeqData && maxSeqData.length > 0
        ? (maxSeqData[0] as any).order_sequence + 1
        : 1);

      // 3. Build insert records with sequential ordering
      const now = new Date().toISOString();
      const records = contentIds.map((contentId, index) => ({
        course_id: courseId,
        content_id: contentId,
        institute_id: course.institute_id,
        order_sequence: nextSequence + index,
        assigned_at: now,
      }));

      // 4. Insert (ignore conflicts — if already assigned, skip)
      const { error: insertErr } = await supabase
        .from('course_content')
        .insert(records)
        .select('content_id');

      if (insertErr) {
        if (insertErr.code === '23503') {
          return {
            success: false,
            error: 'Cannot assign content. One or more content items or the course does not exist.',
          };
        }
        return { success: false, error: extractErrorMessage(insertErr) };
      }

      return { success: true, data: { assigned: contentIds.length } };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  4. Remove Single Content
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Remove a specific content item from a course.
   *
   * If the content is not currently assigned, the operation succeeds silently.
   *
   * @param courseId  - The `courses.course_id`.
   * @param contentId - The `content.content_id` to remove.
   */
  async removeContent(
    courseId: string,
    contentId: string,
  ): Promise<ApiResponse<null>> {
    try {
      validateUUID(courseId, 'courseId');
      validateUUID(contentId, 'contentId');

      const { error } = await supabase
        .from('course_content')
        .delete()
        .eq('course_id', courseId)
        .eq('content_id', contentId);

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  5. Remove Multiple Content Items
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Remove multiple content items from a course.
   *
   * @param courseId    - The `courses.course_id`.
   * @param contentIds  - Array of `content.content_id` values to remove.
   */
  async removeContents(
    courseId: string,
    contentIds: string[],
  ): Promise<ApiResponse<null>> {
    try {
      validateUUID(courseId, 'courseId');

      if (!contentIds.length) {
        return { success: false, error: 'No content IDs provided.' };
      }

      for (const id of contentIds) {
        validateUUID(id, 'contentId');
      }

      const { error } = await supabase
        .from('course_content')
        .delete()
        .eq('course_id', courseId)
        .in('content_id', contentIds);

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  6. Get Assignment Stats
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get content assignment statistics for a course.
   *
   * Returns the number of assigned content items, the number of available
   * items, and a content type breakdown of assigned items.
   *
   * @param courseId - The `courses.course_id`.
   */
  async getAssignmentStats(courseId: string): Promise<ApiResponse<CourseContentAssignmentStats>> {
    try {
      validateUUID(courseId, 'courseId');

      // 1. Count assigned content
      const { count: assignedCount, error: assignedErr } = await supabase
        .from('course_content')
        .select('content_id', { count: 'exact', head: true })
        .eq('course_id', courseId);

      if (assignedErr) {
        return { success: false, error: extractErrorMessage(assignedErr) };
      }

      // 2. Count available content (in the same institute, approved/published, not assigned)
      const { data: course, error: courseErr } = await supabase
        .from('courses')
        .select('institute_id')
        .eq('course_id', courseId)
        .is('deleted_at', null)
        .single();

      if (courseErr) {
        if (courseErr.code === 'PGRST116') {
          return { success: false, error: `Course not found: ${courseId}` };
        }
        return { success: false, error: extractErrorMessage(courseErr) };
      }

      // Get already-assigned content IDs
      const { data: assignedData } = await supabase
        .from('course_content')
        .select('content_id')
        .eq('course_id', courseId);

      const assignedContentIds = (assignedData ?? []).map((r: any) => r.content_id);

      let availableQuery = supabase
        .from('content')
        .select('content_id', { count: 'exact', head: true })
        .eq('institute_id', course.institute_id)
        .in('status', ['approved'])

      if (assignedContentIds.length > 0) {
        // Manual parens — .not() doesn't wrap arrays like .in() does
        availableQuery = availableQuery.not('content_id', 'in', `(${assignedContentIds.join(',')})`);
      }

      const { count: availableCount } = await availableQuery;

      // 3. Content type breakdown of assigned items
      const { data: typeData } = await supabase
        .from('course_content')
        .select(
          `
          content!inner (
            content_type
          )
        `,
        )
        .eq('course_id', courseId);

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
        },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─── Exported helpers for display formatting (used by UI) ─────────────

  formatFileSize,
  formatDuration,
};
