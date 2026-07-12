/**
 * Batch Student Assignment Service
 *
 * Single source of truth for student assignment operations within the
 * Admin Batch Management module.
 *
 * Every public method returns a standardised `ApiResponse<T>` shape.
 * Follows the exact same architecture as `batchManagementService.ts`,
 * `teacherLifecycleService.ts`, and `mockTestManagementService.ts`.
 *
 * ## Scope
 *
 * This service manages the `batch_students` junction table only.
 * It does NOT manage:
 * - Batch lifecycle (handled by batchManagementService)
 * - Teacher assignment to batches (handled by batchTeacherService)
 *
 * @module services/admin/batchStudentAssignmentService
 */

import { supabase } from '@/config/supabase';
import { extractErrorMessage, validateUUID } from '@/utils/supabase';
import type { ApiResponse } from '@/types/academic';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

/** A student assigned to a batch. */
export interface AssignedStudent {
  profileId: string;
  studentId: string;
  enrollmentNo: string | null;
  studentName: string;
  avatar: string | null;
  phone: string | null;
  email: string | null;
  targetYear: string | null;
  joinedAt: string;
}

/** A student available for assignment (not already in the batch). */
export interface AvailableStudent {
  profileId: string;
  studentId: string;
  enrollmentNo: string | null;
  studentName: string;
  email: string | null;
  phone: string | null;
  targetYear: string | null;
}

/** Result of an assign operation. */
export interface AssignResult {
  assigned: number;
  skipped: number;
}

/** Assignment statistics for a batch. */
export interface BatchAssignmentStats {
  assignedStudents: number;
  remainingCapacity: number | null;
  utilization: number | null;
  recentlyAssigned: AssignedStudent[];
}

// ═══════════════════════════════════════════════════════════════════════════
//  Service
// ═══════════════════════════════════════════════════════════════════════════

export const batchStudentAssignmentService = {
  // ─────────────────────────────────────────────────────────────────────────
  //  1. Get Assigned Students
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Fetch all students currently assigned to a batch.
   *
   * Joins `batch_students` → `student_details` → `profiles` to return
   * enriched student information including name, email, phone, avatar,
   * enrollment number, target year, and enrollment date.
   *
   * @param batchId - The `batches.batch_id`.
   */
  async getAssignedStudents(batchId: string): Promise<ApiResponse<AssignedStudent[]>> {
    try {
      validateUUID(batchId, 'batchId');

      const { data, error } = await supabase
        .from('batch_students')
        .select(
          `
          student_id,
          enrolled_on,
          student_details!inner (
            student_id,
            profile_id,
            enrollment_no,
            target_year,
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
        .order('enrolled_on', { ascending: false });

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const students: AssignedStudent[] = (data ?? []).map((row: any) => {
        const sd = row.student_details ?? {};
        const prof = sd.profiles ?? {};
        return {
          profileId: prof.profile_id ?? sd.profile_id ?? '',
          studentId: sd.student_id ?? row.student_id,
          enrollmentNo: sd.enrollment_no ?? null,
          studentName: prof.name ?? 'Unknown',
          avatar: prof.avatar_url ?? null,
          phone: prof.phone ?? null,
          email: prof.email ?? null,
          targetYear: sd.target_year ?? null,
          joinedAt: row.enrolled_on ?? '',
        };
      });

      return { success: true, data: students };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  2. Get Available Students
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Fetch students who are eligible to be added to a batch.
   *
   * Returns approved, active students who are NOT already assigned to the
   * given batch.  Supports optional search by name or enrollment number.
   *
   * **Root table:** `profiles` (filters are applied on root columns, avoiding
   * PostgREST nested-filter issues with `!inner` joins).
   *
   * @param batchId - The `batches.batch_id` to exclude existing members.
   * @param search  - Optional search term (name or enrollment number).
   */
  async getAvailableStudents(
    batchId: string,
    search?: string,
  ): Promise<ApiResponse<AvailableStudent[]>> {
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

      // 2. Get already-assigned student IDs (used to exclude them from results)
      const { data: assignedData } = await supabase
        .from('batch_students')
        .select('student_id')
        .eq('batch_id', batchId);

      const assignedIds = (assignedData ?? []).map((r: any) => r.student_id);

      // 3. Query from profiles as root, join student_details via !inner
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
          is_active,
          account_status,
          institute_id,
          student_details!inner (
            student_id,
            enrollment_no,
            target_year
          )
        `,
        )
        .eq('role', 'student')
        .eq('is_active', true)
        .eq('account_status', 'approved')
        .eq('institute_id', batch.institute_id);

      // Exclude already-assigned students via their profile_id
      if (assignedIds.length > 0) {
        // We need to exclude profiles whose student_details.student_id is in assignedIds.
        // Since student_id != profile_id, first resolve the profile_ids for assigned students.
        const { data: studentProfileMap } = await supabase
          .from('student_details')
          .select('student_id, profile_id')
          .in('student_id', assignedIds);

        const assignedProfileIds = (studentProfileMap ?? []).map(
          (r: any) => r.profile_id,
        );

        if (assignedProfileIds.length > 0) {
          query = query.not('profile_id', 'in', `(${assignedProfileIds.join(',')})`);
        }
      }

      // Search filter
      if (search?.trim()) {
        const term = `%${search.trim()}%`;
        query = query.or(
          `name.ilike.${term},student_details.enrollment_no.ilike.${term}`,
        );
      }

      query = query.order('name', { ascending: true });

      const { data, error } = await query;

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const students: AvailableStudent[] = (data ?? []).map((row: any) => {
        // student_details can be an object or a single-element array
        // depending on the Supabase client version and relationship cardinality.
        const sd = Array.isArray(row.student_details)
          ? row.student_details[0] ?? {}
          : row.student_details ?? {};

        return {
          profileId: row.profile_id ?? '',
          studentId: sd.student_id ?? '',
          enrollmentNo: sd.enrollment_no ?? null,
          studentName: row.name ?? 'Unknown',
          email: row.email ?? null,
          phone: row.phone ?? null,
          targetYear: sd.target_year ?? null,
        };
      });

      return { success: true, data: students };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  3. Assign Students
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Assign multiple students to a batch.
   *
   * The composite PK (batch_id, student_id) on `batch_students` prevents
   * duplicate assignments — Supabase will return a 23505 error for existing
   * rows, which we catch and report as skipped.
   *
   * @param batchId    - The `batches.batch_id`.
   * @param studentIds - Array of `student_details.student_id` values.
   */
  async assignStudents(
    batchId: string,
    studentIds: string[],
  ): Promise<ApiResponse<AssignResult>> {
    try {
      validateUUID(batchId, 'batchId');

      if (studentIds.length === 0) {
        return { success: true, data: { assigned: 0, skipped: 0 } };
      }

      // Validate all student IDs
      for (const id of studentIds) {
        validateUUID(id, 'studentId');
      }

      // Build insert rows
      const rows = studentIds.map((studentId) => ({
        batch_id: batchId,
        student_id: studentId,
        enrolled_on: new Date().toISOString().split('T')[0], // YYYY-MM-DD
        status: 'active',
      }));

      const { error } = await supabase
        .from('batch_students')
        .insert(rows);

      if (error) {
        // 23505 = unique violation — some or all rows already exist
        if (error.code === '23505') {
          // Fall back to inserting one at a time to count assigned vs skipped
          let assigned = 0;
          let skipped = 0;

          for (const row of rows) {
            const { error: insertErr } = await supabase
              .from('batch_students')
              .insert(row);

            if (insertErr && insertErr.code === '23505') {
              skipped++;
            } else if (!insertErr) {
              assigned++;
            } else {
              skipped++;
            }
          }

          return {
            success: true,
            data: { assigned, skipped },
            warning: `${skipped} student(s) were already assigned to this batch.`,
          };
        }

        return { success: false, error: extractErrorMessage(error) };
      }

      return {
        success: true,
        data: { assigned: studentIds.length, skipped: 0 },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  4. Remove Single Student
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Remove a single student from a batch.
   *
   * Performs a hard delete from the `batch_students` junction table.
   * Enrollment records are permanent per schema design, but the FK is
   * ON DELETE RESTRICT — the row is deleted from the junction.
   *
   * @param batchId   - The `batches.batch_id`.
   * @param studentId - The `student_details.student_id`.
   */
  async removeStudent(
    batchId: string,
    studentId: string,
  ): Promise<ApiResponse<null>> {
    try {
      validateUUID(batchId, 'batchId');
      validateUUID(studentId, 'studentId');

      const { error } = await supabase
        .from('batch_students')
        .delete()
        .eq('batch_id', batchId)
        .eq('student_id', studentId);

      if (error) {
        if (error.code === 'PGRST116') {
          return { success: false, error: 'Student is not assigned to this batch.' };
        }
        return { success: false, error: extractErrorMessage(error) };
      }

      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  5. Bulk Remove Students
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Remove multiple students from a batch in a single operation.
   *
   * @param batchId    - The `batches.batch_id`.
   * @param studentIds - Array of `student_details.student_id` values.
   */
  async removeStudents(
    batchId: string,
    studentIds: string[],
  ): Promise<ApiResponse<null>> {
    try {
      validateUUID(batchId, 'batchId');

      if (studentIds.length === 0) {
        return { success: true, data: null };
      }

      for (const id of studentIds) {
        validateUUID(id, 'studentId');
      }

      const { error } = await supabase
        .from('batch_students')
        .delete()
        .eq('batch_id', batchId)
        .in('student_id', studentIds);

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
   * Get assignment statistics for a batch.
   *
   * Returns the number of assigned students, remaining capacity,
   * utilisation percentage, and a list of recently assigned students.
   *
   * @param batchId - The `batches.batch_id`.
   */
  async getAssignmentStats(batchId: string): Promise<ApiResponse<BatchAssignmentStats>> {
    try {
      validateUUID(batchId, 'batchId');

      // 1. Fetch batch details (max_seats)
      const { data: batch, error: batchErr } = await supabase
        .from('batches')
        .select('max_seats')
        .eq('batch_id', batchId)
        .single();

      if (batchErr) {
        if (batchErr.code === 'PGRST116') {
          return { success: false, error: `Batch not found: ${batchId}` };
        }
        return { success: false, error: extractErrorMessage(batchErr) };
      }

      // 2. Fetch assigned students count and recent assignments
      const { data: assignedData, error: assignedErr } = await supabase
        .from('batch_students')
        .select(
          `
          student_id,
          enrolled_on,
          student_details!inner (
            student_id,
            profile_id,
            enrollment_no,
            target_year,
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
        .order('enrolled_on', { ascending: false });

      if (assignedErr) {
        return { success: false, error: extractErrorMessage(assignedErr) };
      }

      const assignedStudents = (assignedData ?? []).length;
      const maxSeats = batch.max_seats;
      const remainingCapacity = maxSeats !== null ? Math.max(0, maxSeats - assignedStudents) : null;
      const utilization = maxSeats !== null && maxSeats > 0
        ? Math.round((assignedStudents / maxSeats) * 100 * 100) / 100
        : null;

      // Recently assigned (top 5)
      const recentlyAssigned: AssignedStudent[] = (assignedData ?? []).slice(0, 5).map((row: any) => {
        const sd = row.student_details ?? {};
        const prof = sd.profiles ?? {};
        return {
          profileId: prof.profile_id ?? sd.profile_id ?? '',
          studentId: sd.student_id ?? row.student_id,
          enrollmentNo: sd.enrollment_no ?? null,
          studentName: prof.name ?? 'Unknown',
          avatar: prof.avatar_url ?? null,
          phone: prof.phone ?? null,
          email: prof.email ?? null,
          targetYear: sd.target_year ?? null,
          joinedAt: row.enrolled_on ?? '',
        };
      });

      return {
        success: true,
        data: {
          assignedStudents,
          remainingCapacity,
          utilization,
          recentlyAssigned,
        },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },
};
