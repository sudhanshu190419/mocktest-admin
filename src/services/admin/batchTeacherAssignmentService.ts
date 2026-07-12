/**
 * Batch Teacher Assignment Service
 *
 * Single source of truth for teacher assignment operations within the
 * Admin Batch Management module.
 *
 * Every public method returns a standardised `ApiResponse<T>` shape.
 * Follows the exact same architecture as `batchStudentAssignmentService.ts`,
 * `batchManagementService.ts`, and `teacherLifecycleService.ts`.
 *
 * ## Scope
 *
 * This service manages the `batch_teachers` junction table.
 * It does NOT manage:
 * - Batch lifecycle (handled by batchManagementService)
 * - Student enrollment (handled by batchStudentAssignmentService)
 *
 * ## Business Rules
 *
 * - A batch can have at most ONE assigned teacher.
 * - Assigning a teacher when one is already assigned replaces the assignment.
 * - Remove clears the existing assignment.
 *
 * @module services/admin/batchTeacherAssignmentService
 */

import { supabase } from '@/config/supabase';
import { extractErrorMessage, validateUUID } from '@/utils/supabase';
import type { ApiResponse } from '@/types/academic';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

/** The teacher currently assigned to a batch. */
export interface AssignedTeacher {
  teacherId: string;
  profileId: string;
  facultyId: string | null;
  teacherName: string;
  avatar: string | null;
  department: string | null;
  designation: string | null;
  email: string | null;
  phone: string | null;
  assignedAt: string;
}

/** A teacher available for assignment. */
export interface AvailableTeacher {
  teacherId: string;
  profileId: string;
  facultyId: string | null;
  teacherName: string;
  department: string | null;
  designation: string | null;
  email: string | null;
  phone: string | null;
}

/** Assignment statistics. */
export interface TeacherAssignmentStats {
  /** Number of batches that have at least one teacher assigned. */
  totalAssignedBatches: number;
  /** Number of non-deleted batches with NO teacher assigned. */
  unassignedBatches: number;
  /** Number of batches each teacher is assigned to (top 10). */
  teacherWorkload: { teacherName: string; batchCount: number }[];
}

// ═══════════════════════════════════════════════════════════════════════════
//  Service
// ═══════════════════════════════════════════════════════════════════════════

export const batchTeacherAssignmentService = {
  // ─────────────────────────────────────────────────────────────────────────
  //  1. Get Assigned Teacher
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the teacher currently assigned to a batch.
   *
   * Joins `batch_teachers` → `teacher_details` → `profiles` to return
   * enriched teacher information including name, email, phone, avatar,
   * faculty ID, department, and designation.
   *
   * Returns `null` in the data field if no teacher is assigned.
   *
   * @param batchId - The `batches.batch_id`.
   */
  async getAssignedTeacher(batchId: string): Promise<ApiResponse<AssignedTeacher | null>> {
    try {
      validateUUID(batchId, 'batchId');

      const { data, error } = await supabase
        .from('batch_teachers')
        .select(
          `
          teacher_id,
          assigned_on,
          teacher_details!inner (
            teacher_id,
            profile_id,
            faculty_id,
            department,
            designation,
            profiles!inner (
              profile_id,
              name,
              email,
              phone,
              avatar_url
            )
          )
        `,
        )
        .eq('batch_id', batchId)
        .maybeSingle();

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      if (!data) {
        return { success: true, data: null };
      }

      const row = data as any;
      const td = row.teacher_details ?? {};
      const prof = td.profiles ?? {};

      return {
        success: true,
        data: {
          teacherId: td.teacher_id ?? row.teacher_id,
          profileId: prof.profile_id ?? td.profile_id ?? '',
          facultyId: td.faculty_id ?? null,
          teacherName: prof.name ?? 'Unknown',
          avatar: prof.avatar_url ?? null,
          department: td.department ?? null,
          designation: td.designation ?? null,
          email: prof.email ?? null,
          phone: prof.phone ?? null,
          assignedAt: row.assigned_on ?? '',
        },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  2. Get Available Teachers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Fetch teachers available for assignment.
   *
   * Returns approved, active teachers (profiles.role = 'teacher' AND
   * profiles.is_active = true AND profiles.account_status = 'approved').
   * Supports optional search by name or faculty ID.
   * Filters to the same institute as the batch.
   *
   * **Root table:** `profiles` (filters are applied on root columns, avoiding
   * PostgREST nested-filter issues with `!inner` joins).
   *
   * @param batchId - The `batches.batch_id` to determine the institute scope.
   * @param search  - Optional search term (name or faculty ID).
   */
  async getAvailableTeachers(
    batchId: string,
    search?: string,
  ): Promise<ApiResponse<AvailableTeacher[]>> {
    try {
      validateUUID(batchId, 'batchId');

      // 1. Get the batch's institute_id
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

      // 2. Query from profiles as root, join teacher_details via !inner
      //    All filters are on root-level columns so PostgREST applies them
      //    unconditionally as direct WHERE clauses (no nested-filter issues).
      let query = supabase
        .from('profiles')
        .select(
          `
          profile_id,
          name,
          email,
          phone,
          avatar_url,
          role,
          is_active,
          account_status,
          institute_id,
          teacher_details!inner (
            teacher_id,
            faculty_id,
            department,
            designation
          )
        `,
        )
        .eq('role', 'teacher')
        .eq('is_active', true)
        .eq('account_status', 'approved')
        .eq('institute_id', batch.institute_id);

      // Search filter
      if (search?.trim()) {
        const term = `%${search.trim()}%`;
        query = query.or(
          `name.ilike.${term},teacher_details.faculty_id.ilike.${term}`,
        );
      }

      query = query.order('name', { ascending: true });

      const { data, error } = await query;

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const teachers: AvailableTeacher[] = (data ?? []).map((row: any) => {
        // teacher_details can be an object or a single-element array
        // depending on the Supabase client version and relationship cardinality.
        const td = Array.isArray(row.teacher_details)
          ? row.teacher_details[0] ?? {}
          : row.teacher_details ?? {};

        return {
          teacherId: td.teacher_id ?? '',
          profileId: row.profile_id ?? '',
          facultyId: td.faculty_id ?? null,
          teacherName: row.name ?? 'Unknown',
          department: td.department ?? null,
          designation: td.designation ?? null,
          email: row.email ?? null,
          phone: row.phone ?? null,
        };
      });

      return { success: true, data: teachers };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  3. Assign Teacher
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Assign a teacher to a batch.
   *
   * **Business Rule:** A batch can have at most ONE teacher. If a teacher is
   * already assigned, the existing assignment is deleted before inserting
   * the new one — effectively a "replace" operation.
   *
   * @param batchId   - The `batches.batch_id`.
   * @param teacherId - The `teacher_details.teacher_id`.
   *
   * @returns The newly created assignment record.
   */
  async assignTeacher(
    batchId: string,
    teacherId: string,
  ): Promise<ApiResponse<AssignedTeacher>> {
    try {
      validateUUID(batchId, 'batchId');
      validateUUID(teacherId, 'teacherId');

      // 1. Delete any existing assignment for this batch
      const { error: deleteErr } = await supabase
        .from('batch_teachers')
        .delete()
        .eq('batch_id', batchId);

      if (deleteErr) {
        return { success: false, error: extractErrorMessage(deleteErr) };
      }

      // 2. Insert the new assignment
      const { error: insertErr } = await supabase.from('batch_teachers').insert({
        batch_id: batchId,
        teacher_id: teacherId,
        assigned_on: new Date().toISOString().split('T')[0],
      });

      if (insertErr) {
        if (insertErr.code === '23503') {
          return {
            success: false,
            error: 'Cannot assign this teacher. The teacher or batch does not exist.',
          };
        }
        if (insertErr.code === '23505') {
          // Race condition: another assignment was inserted between our delete and insert
          // This should be rare; retry the whole operation
          const retryResult = await this.assignTeacher(batchId, teacherId);
          return retryResult;
        }
        return { success: false, error: extractErrorMessage(insertErr) };
      }

      // 3. Return the full assignment
      const assigned = await this.getAssignedTeacher(batchId);
      if (!assigned.success || !assigned.data) {
        return { success: false, error: assigned.error ?? 'Failed to verify new assignment.' };
      }

      return { success: true, data: assigned.data };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  4. Remove Teacher
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Remove the teacher assignment from a batch.
   *
   * If no teacher is currently assigned, the operation succeeds silently.
   *
   * @param batchId - The `batches.batch_id`.
   */
  async removeTeacher(batchId: string): Promise<ApiResponse<null>> {
    try {
      validateUUID(batchId, 'batchId');

      const { error } = await supabase
        .from('batch_teachers')
        .delete()
        .eq('batch_id', batchId);

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows matched — nothing to remove, which is fine
          return { success: true, data: null };
        }
        return { success: false, error: extractErrorMessage(error) };
      }

      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  5. Get Assignment Stats
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get teacher assignment statistics.
   *
   * Returns the total number of batches with an assigned teacher, the
   * number of batches without a teacher, and the top 10 teachers ranked
   * by the number of batches they are assigned to.
   */
  async getAssignmentStats(): Promise<ApiResponse<TeacherAssignmentStats>> {
    try {
      // 1. Total batches (non-deleted)
      const { count: totalBatches, error: totalErr } = await supabase
        .from('batches')
        .select('batch_id', { count: 'exact', head: true })
        .is('deleted_at', null);

      if (totalErr) {
        return { success: false, error: extractErrorMessage(totalErr) };
      }

      // 2. Count distinct batch_ids in batch_teachers
      const { count: assignedCount, error: assignedErr } = await supabase
        .from('batch_teachers')
        .select('batch_id', { count: 'exact', head: true });

      if (assignedErr) {
        return { success: false, error: extractErrorMessage(assignedErr) };
      }

      const totalAssignedBatches = assignedCount ?? 0;
      const total = totalBatches ?? 0;
      const unassignedBatches = Math.max(0, total - totalAssignedBatches);

      // 3. Teacher workload (top 10)
      const { data: workloadData, error: workloadErr } = await supabase
        .from('batch_teachers')
        .select(
          `
          teacher_id,
          count:batch_id,
          teacher_details!inner (
            profiles!inner (
              name
            )
          )
        `,
        )
        .order('count', { ascending: false })
        .limit(10);

      if (workloadErr) {
        return { success: false, error: extractErrorMessage(workloadErr) };
      }

      const teacherWorkload = (workloadData ?? []).map((row: any) => ({
        teacherName: row.teacher_details?.profiles?.name ?? 'Unknown',
        batchCount: typeof row.count === 'number' ? row.count : 0,
      }));

      return {
        success: true,
        data: {
          totalAssignedBatches,
          unassignedBatches,
          teacherWorkload,
        },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },
};
