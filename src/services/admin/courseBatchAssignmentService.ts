/**
 * Course Batch Assignment Service
 *
 * Single source of truth for batch assignment operations within the
 * Admin Course Management module.
 *
 * Every public method returns a standardised `ApiResponse<T>` shape.
 * Follows the exact same architecture as `courseTeacherAssignmentService.ts`,
 * `batchTeacherAssignmentService.ts`, and `batchStudentAssignmentService.ts`.
 *
 * ## Scope
 *
 * This service manages the `course_batches` junction table (migration 033).
 * It does NOT manage:
 * - Course lifecycle (handled by courseManagementService)
 * - Teacher/content assignment to courses (handled by separate services)
 *
 * ## Business Rules
 *
 * - A course may contain multiple batches (many-to-many).
 * - A batch may belong to multiple courses.
 * - Assigning batches adds new entries; duplicate entries are silently skipped.
 * - Only non-deleted batches from the same institute are eligible.
 *
 * @module services/admin/courseBatchAssignmentService
 */

import { supabase } from '@/config/supabase';
import { extractErrorMessage, validateUUID } from '@/utils/supabase';
import type { ApiResponse } from '@/types/academic';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

/** A batch assigned to a course. */
export interface AssignedCourseBatch {
  batchId: string;
  batchName: string;
  batchCode: string;
  academicYear: string;
  streamId: string;
  streamName: string | null;
  teacherCount: number;
  studentCount: number;
  status: string;
  assignedAt: string;
}

/** A batch available for assignment to a course. */
export interface AvailableCourseBatch {
  batchId: string;
  batchName: string;
  batchCode: string;
  academicYear: string;
  streamId: string;
  streamName: string | null;
  status: string;
}

/** Assignment statistics for a course. */
export interface CourseBatchAssignmentStats {
  /** Number of batches assigned to this course. */
  assignedCount: number;
  /** Number of batches available for assignment. */
  availableCount: number;
  /** Status breakdown of assigned batches. */
  byStatus: { status: string; count: number }[];
}

// ═══════════════════════════════════════════════════════════════════════════
//  Service
// ═══════════════════════════════════════════════════════════════════════════

export const courseBatchAssignmentService = {
  // ─────────────────────────────────────────────────────────────────────────
  //  1. Get Assigned Batches
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get all batches assigned to a course.
   *
   * Joins `course_batches` → `batches` → `streams` to return enriched
   * batch information including name, code, academic year, stream, and
   * teacher/student counts.
   *
   * @param courseId - The `courses.course_id`.
   */
  async getAssignedBatches(courseId: string): Promise<ApiResponse<AssignedCourseBatch[]>> {
    try {
      validateUUID(courseId, 'courseId');

      const { data, error } = await supabase
        .from('course_batches')
        .select(
          `
          batch_id,
          assigned_at,
          batches!inner (
            batch_id,
            name,
            batch_code,
            academic_year,
            stream_id,
            status,
            streams!left (
              name
            )
          )
        `,
        )
        .eq('course_id', courseId)
        .order('assigned_at', { ascending: true });

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      // Collect all batch IDs to fetch teacher/student counts
      const batchIds = (data ?? []).map((row: any) => row.batches?.batch_id ?? row.batch_id);

      // Fetch teacher and student counts in parallel for all batches
      let teachersCountMap = new Map<string, number>();
      let studentsCountMap = new Map<string, number>();

      if (batchIds.length > 0) {
        const [teachersRes, studentsRes] = await Promise.allSettled([
          // Teacher counts per batch (via batch_subject_teachers -> batch_subjects)
          supabase
            .from('batch_subject_teachers')
            .select('batch_subjects!inner(batch_id), teacher_id')
            .in('batch_subjects.batch_id', batchIds),
          // Student counts per batch (active only)
          supabase
            .from('batch_students')
            .select('batch_id, count:student_id')
            .in('batch_id', batchIds)
            .eq('status', 'active'),
        ]);

        if (teachersRes.status === 'fulfilled' && teachersRes.value.data) {
          // Count distinct teachers per batch from batch_subject_teachers
          const teacherBatchMap = new Map<string, Set<string>>();
          for (const row of teachersRes.value.data as any[]) {
            const bid = row.batch_subjects?.batch_id;
            if (bid) {
              if (!teacherBatchMap.has(bid)) {
                teacherBatchMap.set(bid, new Set());
              }
              teacherBatchMap.get(bid)!.add(row.teacher_id);
            }
          }
          for (const [bid, teacherSet] of teacherBatchMap) {
            teachersCountMap.set(bid, teacherSet.size);
          }
        }

        if (studentsRes.status === 'fulfilled' && studentsRes.value.data) {
          for (const row of studentsRes.value.data as any[]) {
            studentsCountMap.set(row.batch_id, typeof row.count === 'number' ? row.count : 0);
          }
        }
      }

      const batches: AssignedCourseBatch[] = (data ?? []).map((row: any) => {
        const b = row.batches ?? {};
        const batchId = b.batch_id ?? row.batch_id;

        return {
          batchId,
          batchName: b.name ?? 'Unknown',
          batchCode: b.batch_code ?? '',
          academicYear: b.academic_year ?? '',
          streamId: b.stream_id ?? '',
          streamName: b.streams?.name ?? null,
          teacherCount: teachersCountMap.get(batchId) ?? 0,
          studentCount: studentsCountMap.get(batchId) ?? 0,
          status: b.status ?? 'unknown',
          assignedAt: row.assigned_at ?? '',
        };
      });

      return { success: true, data: batches };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  2. Get Available Batches
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Fetch batches available for assignment to a course.
   *
   * Returns non-deleted batches from the same institute as the course.
   * Supports optional search by batch name, batch code, or academic year.
   * Excludes batches already assigned to this course.
   *
   * @param courseId - The `courses.course_id` to determine the institute scope.
   * @param search   - Optional search term (batch name, code, or academic year).
   */
  async getAvailableBatches(
    courseId: string,
    search?: string,
  ): Promise<ApiResponse<AvailableCourseBatch[]>> {
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

      // 2. Get already-assigned batch IDs to exclude them
      const { data: assignedData } = await supabase
        .from('course_batches')
        .select('batch_id')
        .eq('course_id', courseId);

      const assignedBatchIds = (assignedData ?? []).map((r: any) => r.batch_id);

      // 3. Query available batches
      let query = supabase
        .from('batches')
        .select(
          `
          batch_id,
          name,
          batch_code,
          academic_year,
          stream_id,
          status,
          streams!left (
            name
          )
        `,
        )
        .is('deleted_at', null)
        .eq('institute_id', course.institute_id);

      // Exclude already assigned batches
      if (assignedBatchIds.length > 0) {
        // Manual parens — .not() doesn't wrap arrays like .in() does
        query = query.not('batch_id', 'in', `(${assignedBatchIds.join(',')})`);
      }

      // Search filter: batch name, batch code, or academic year
      if (search?.trim()) {
        const term = `%${search.trim()}%`;
        query = query.or(
          `name.ilike.${term},batch_code.ilike.${term},academic_year.ilike.${term}`,
        );
      }

      query = query.order('name', { ascending: true });

      const { data, error } = await query;

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const batches: AvailableCourseBatch[] = (data ?? []).map((row: any) => ({
        batchId: row.batch_id,
        batchName: row.name ?? 'Unknown',
        batchCode: row.batch_code ?? '',
        academicYear: row.academic_year ?? '',
        streamId: row.stream_id ?? '',
        streamName: row.streams?.name ?? null,
        status: row.status ?? 'unknown',
      }));

      return { success: true, data: batches };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  3. Assign Batches
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Assign one or more batches to a course.
   *
   * **Business Rule:** A course may contain multiple batches. This method
   * inserts new assignment rows. If a batch is already assigned, the
   * insertion is silently skipped (no duplicate error).
   *
   * @param courseId  - The `courses.course_id`.
   * @param batchIds  - Array of `batches.batch_id` values.
   *
   * @returns The count of batches actually assigned.
   */
  async assignBatches(
    courseId: string,
    batchIds: string[],
  ): Promise<ApiResponse<{ assigned: number }>> {
    try {
      validateUUID(courseId, 'courseId');

      if (!batchIds.length) {
        return { success: false, error: 'No batch IDs provided.' };
      }

      // Validate all batch IDs
      for (const id of batchIds) {
        validateUUID(id, 'batchId');
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

      // 2. Build insert records
      const now = new Date().toISOString();
      const records = batchIds.map((batchId) => ({
        course_id: courseId,
        batch_id: batchId,
        institute_id: course.institute_id,
        assigned_at: now,
      }));

      // 3. Insert (ignore conflicts — if already assigned, skip)
      const { error: insertErr } = await supabase
        .from('course_batches')
        .insert(records)
        .select('batch_id');

      if (insertErr) {
        if (insertErr.code === '23503') {
          return {
            success: false,
            error: 'Cannot assign batches. One or more batches or the course does not exist.',
          };
        }
        return { success: false, error: extractErrorMessage(insertErr) };
      }

      return { success: true, data: { assigned: batchIds.length } };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  4. Remove Single Batch
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Remove a specific batch from a course.
   *
   * If the batch is not currently assigned, the operation succeeds silently.
   *
   * @param courseId - The `courses.course_id`.
   * @param batchId  - The `batches.batch_id` to remove.
   */
  async removeBatch(
    courseId: string,
    batchId: string,
  ): Promise<ApiResponse<null>> {
    try {
      validateUUID(courseId, 'courseId');
      validateUUID(batchId, 'batchId');

      const { error } = await supabase
        .from('course_batches')
        .delete()
        .eq('course_id', courseId)
        .eq('batch_id', batchId);

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  5. Remove Multiple Batches
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Remove multiple batches from a course.
   *
   * @param courseId  - The `courses.course_id`.
   * @param batchIds  - Array of `batches.batch_id` values to remove.
   */
  async removeBatches(
    courseId: string,
    batchIds: string[],
  ): Promise<ApiResponse<null>> {
    try {
      validateUUID(courseId, 'courseId');

      if (!batchIds.length) {
        return { success: false, error: 'No batch IDs provided.' };
      }

      for (const id of batchIds) {
        validateUUID(id, 'batchId');
      }

      const { error } = await supabase
        .from('course_batches')
        .delete()
        .eq('course_id', courseId)
        .in('batch_id', batchIds);

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
   * Get batch assignment statistics for a course.
   *
   * Returns the number of assigned batches, the number of available
   * batches, and a status breakdown of assigned batches.
   *
   * @param courseId - The `courses.course_id`.
   */
  async getAssignmentStats(courseId: string): Promise<ApiResponse<CourseBatchAssignmentStats>> {
    try {
      validateUUID(courseId, 'courseId');

      // 1. Count assigned batches
      const { count: assignedCount, error: assignedErr } = await supabase
        .from('course_batches')
        .select('batch_id', { count: 'exact', head: true })
        .eq('course_id', courseId);

      if (assignedErr) {
        return { success: false, error: extractErrorMessage(assignedErr) };
      }

      // 2. Count available batches (in the same institute, non-deleted, not assigned)
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

      // Get already-assigned batch IDs
      const { data: assignedData } = await supabase
        .from('course_batches')
        .select('batch_id')
        .eq('course_id', courseId);

      const assignedBatchIds = (assignedData ?? []).map((r: any) => r.batch_id);

      let query = supabase
        .from('batches')
        .select('batch_id', { count: 'exact', head: true })
        .is('deleted_at', null)
        .eq('institute_id', course.institute_id);

      if (assignedBatchIds.length > 0) {
        // Manual parens — .not() doesn't wrap arrays like .in() does
        query = query.not('batch_id', 'in', `(${assignedBatchIds.join(',')})`);
      }

      const { count: availableCount } = await query;

      // 3. Status breakdown of assigned batches
      const { data: statusData } = await supabase
        .from('course_batches')
        .select(
          `
          batches!inner (
            status
          )
        `,
        )
        .eq('course_id', courseId);

      // Aggregate status counts manually from the joined data
      const statusCountMap = new Map<string, number>();
      for (const row of (statusData ?? []) as any[]) {
        const status = row.batches?.status ?? 'unknown';
        statusCountMap.set(status, (statusCountMap.get(status) ?? 0) + 1);
      }

      const byStatus = [...statusCountMap.entries()].map(([status, count]) => ({
        status,
        count,
      })).sort((a, b) => b.count - a.count);

      return {
        success: true,
        data: {
          assignedCount: assignedCount ?? 0,
          availableCount: availableCount ?? 0,
          byStatus,
        },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },
};
