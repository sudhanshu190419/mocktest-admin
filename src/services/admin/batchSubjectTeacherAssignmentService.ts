/**
 * Batch Subject Teacher Assignment Service
 *
 * Single source of truth for teacher assignment operations within the
 * Admin Batch Subject management module.
 *
 * Every public method returns a standardised `ApiResponse<T>` shape.
 * Follows the exact same architecture as `batchTeacherAssignmentService.ts`
 * but uses `batch_subject_teachers` instead of `batch_teachers`.
 *
 * ## Scope
 *
 * This service manages the `batch_subject_teachers` junction table.
 * A Batch Subject can have MULTIPLE teachers.
 *
 * ## Business Rules
 *
 * - A Batch Subject can have multiple assigned teachers.
 * - Assigning a teacher who is already assigned is a no-op (unique constraint).
 * - Removing a teacher only removes that specific assignment.
 * - Reassigning a teacher batch_subject is done via remove + assign.
 *
 * @module services/admin/batchSubjectTeacherAssignmentService
 */

import { supabase } from '@/config/supabase';
import { extractErrorMessage, validateUUID } from '@/utils/supabase';
import type { ApiResponse } from '@/types/academic';
import { auditService } from '@/services/audit/auditService';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

/** A teacher assigned to a batch subject (with resolved names). */
export interface AssignedSubjectTeacher {
  assignmentId: string;
  teacherId: string;
  profileId: string;
  facultyId: string | null;
  teacherName: string;
  avatar: string | null;
  department: string | null;
  designation: string | null;
  email: string | null;
  phone: string | null;
  batchSubjectId: string;
  batchName: string;
  subjectName: string;
  assignedAt: string;
}

/** A teacher available for assignment. */
export interface AvailableSubjectTeacher {
  teacherId: string;
  profileId: string;
  facultyId: string | null;
  teacherName: string;
  department: string | null;
  designation: string | null;
  email: string | null;
  phone: string | null;
}

/** Summary of teachers assigned to each batch subject within a batch. */
export interface BatchSubjectTeacherSummary {
  batchSubjectId: string;
  subjectName: string;
  batchName: string;
  teachers: {
    teacherId: string;
    teacherName: string;
    assignmentId: string;
  }[];
}

/** Assignment statistics. */
export interface SubjectTeacherAssignmentStats {
  /** Number of batch_subjects that have at least one teacher assigned. */
  totalAssignedSubjects: number;
  /** Number of batch_subjects with NO teacher assigned. */
  unassignedSubjects: number;
  /** Number of batch_subjects each teacher is assigned to (top 10). */
  teacherWorkload: { teacherName: string; subjectCount: number }[];
}

// ═══════════════════════════════════════════════════════════════════════════
//  Service
// ═══════════════════════════════════════════════════════════════════════════

export const batchSubjectTeacherAssignmentService = {
  // ─────────────────────────────────────────────────────────────────────────
  //  1. Get Teachers for a Batch Subject
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get all teachers assigned to a specific batch subject.
   *
   * @param batchSubjectId - The `batch_subjects.batch_subject_id`.
   */
  async getAssignedTeachers(
    batchSubjectId: string,
  ): Promise<ApiResponse<AssignedSubjectTeacher[]>> {
    try {
      validateUUID(batchSubjectId, 'batchSubjectId');

      const { data, error } = await supabase
        .from('batch_subject_teachers')
        .select(
          `
          batch_subject_id,
          teacher_id,
          teacher_details:teacher_details!inner (
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
        .eq('batch_subject_id', batchSubjectId);

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const teachers: AssignedSubjectTeacher[] = (data ?? []).map((row: any) => {
        const td = row.teacher_details ?? {};
        const prof = td.profiles ?? {};
        return {
          assignmentId: `${row.batch_subject_id}_${row.teacher_id}`,
          teacherId: td.teacher_id ?? row.teacher_id,
          profileId: prof.profile_id ?? td.profile_id ?? '',
          facultyId: td.faculty_id ?? null,
          teacherName: prof.name ?? 'Unknown',
          avatar: prof.avatar_url ?? null,
          department: td.department ?? null,
          designation: td.designation ?? null,
          email: prof.email ?? null,
          phone: prof.phone ?? null,
          batchSubjectId: row.batch_subject_id,
          batchName: '',
          subjectName: '',
          assignedAt: '',
        };
      });

      return { success: true, data: teachers };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  2. Get All Teachers for All Batch Subjects in a Batch
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get all teachers assigned to every batch subject within a batch,
   * grouped by batch_subject.
   *
   * @param batchId - The `batches.batch_id`.
   */
  async getBatchTeacherSummary(
    batchId: string,
    instituteId: string,
  ): Promise<ApiResponse<BatchSubjectTeacherSummary[]>> {
    try {
      validateUUID(batchId, 'batchId');

      // Get all batch subjects for this batch
      const { data: batchSubjects, error: bsError } = await supabase
        .from('batch_subjects')
        .select(
          `
          batch_subject_id,
          is_active,
          subjects!inner (name),
          batches!inner (name)
        `,
        )
        .eq('batch_id', batchId);

      if (bsError) {
        return { success: false, error: extractErrorMessage(bsError) };
      }

      // For each batch subject, get assigned teachers
      const summaries: BatchSubjectTeacherSummary[] = [];

      for (const bs of (batchSubjects ?? []) as any[]) {
        const teachersResult = await this.getAssignedTeachers(bs.batch_subject_id);
        const teachers = teachersResult.success ? (teachersResult.data ?? []) : [];

        summaries.push({
          batchSubjectId: bs.batch_subject_id,
          subjectName: bs.subjects?.name ?? 'Unknown Subject',
          batchName: bs.batches?.name ?? 'Unknown Batch',
          teachers: teachers.map((t) => ({
            teacherId: t.teacherId,
            teacherName: t.teacherName,
            assignmentId: t.assignmentId,
          })),
        });
      }

      return { success: true, data: summaries };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  3. Get Available Teachers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Fetch teachers available for assignment.
   *
   * @param instituteId - The institute to scope the search.
   * @param search      - Optional search term (name or faculty ID).
   */
  async getAvailableTeachers(
    instituteId: string,
    search?: string,
  ): Promise<ApiResponse<AvailableSubjectTeacher[]>> {
    try {
      validateUUID(instituteId, 'instituteId');

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
        .eq('institute_id', instituteId);

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

      const teachers: AvailableSubjectTeacher[] = (data ?? []).map((row: any) => {
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
  //  4. Assign Teacher to Batch Subject
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Assign a teacher to a batch subject.
   *
   * A Batch Subject can have multiple teachers. This adds one teacher.
   * Duplicate assignments are prevented by the unique constraint.
   *
   * @param batchSubjectId - The `batch_subjects.batch_subject_id`.
   * @param teacherId      - The `teacher_details.teacher_id`.
   */
  async assignTeacher(
    batchSubjectId: string,
    teacherId: string,
  ): Promise<ApiResponse<{ assigned: boolean; existing: boolean }>> {
    try {
      validateUUID(batchSubjectId, 'batchSubjectId');
      validateUUID(teacherId, 'teacherId');

      // Resolve institute_id once for RLS compliance
      const { data: batchSubject, error: bsErr } = await supabase
        .from('batch_subjects')
        .select('institute_id')
        .eq('batch_subject_id', batchSubjectId)
        .single();

      if (bsErr || !batchSubject) {
        return {
          success: false,
          error: 'Batch subject not found.',
        };
      }

      const { error: insertErr } = await supabase
        .from('batch_subject_teachers')
        .insert({
          batch_subject_id: batchSubjectId,
          teacher_id: teacherId,
          institute_id: batchSubject.institute_id,
        });

      if (insertErr) {
        if (insertErr.code === '23505') {
          // Teacher already assigned to this batch subject — not an error
          return {
            success: true,
            data: { assigned: false, existing: true },
          };
        }
        if (insertErr.code === '23503') {
          return {
            success: false,
            error: 'Cannot assign this teacher. The teacher or batch subject does not exist.',
          };
        }
        return { success: false, error: extractErrorMessage(insertErr) };
      }

      // ── Audit: teacher assigned to batch subject ──────────────────────
      await auditService.logAssign({
        resourceType: 'batch_subject_teachers',
        resourceId: null,
        metadata: { batchSubjectId, teacherId },
      });

      return {
        success: true,
        data: { assigned: true, existing: false },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  5. Remove Teacher from Batch Subject
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Remove a teacher from a batch subject.
   *
   * Only this specific assignment is removed. Other assignments remain.
   *
   * @param batchSubjectId - The `batch_subjects.batch_subject_id`.
   * @param teacherId      - The `teacher_details.teacher_id`.
   */
  async removeTeacher(
    batchSubjectId: string,
    teacherId: string,
  ): Promise<ApiResponse<void>> {
    try {
      validateUUID(batchSubjectId, 'batchSubjectId');
      validateUUID(teacherId, 'teacherId');

      const { error } = await supabase
        .from('batch_subject_teachers')
        .delete()
        .eq('batch_subject_id', batchSubjectId)
        .eq('teacher_id', teacherId);

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      // ── Audit: teacher unassigned from batch subject ──────────────────
      await auditService.logUnassign({
        resourceType: 'batch_subject_teachers',
        resourceId: null,
        metadata: { batchSubjectId, teacherId },
      });

      return { success: true };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  6. Bulk Assign Teachers to a Batch Subject
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Assign multiple teachers to a batch subject in one operation.
   *
   * Handles duplicates gracefully (unique constraint).
   *
   * @param batchSubjectId - The `batch_subjects.batch_subject_id`.
   * @param teacherIds     - Array of `teacher_details.teacher_id`.
   */
  async assignMultipleTeachers(
    batchSubjectId: string,
    teacherIds: string[],
  ): Promise<ApiResponse<{ assigned: number }>> {
    try {
      validateUUID(batchSubjectId, 'batchSubjectId');

      // Resolve institute_id ONCE for all rows (RLS compliance)
      const { data: batchSubject, error: bsErr } = await supabase
        .from('batch_subjects')
        .select('institute_id')
        .eq('batch_subject_id', batchSubjectId)
        .single();

      if (bsErr || !batchSubject) {
        return {
          success: false,
          error: 'Batch subject not found.',
        };
      }

      const rows = teacherIds.map((teacherId) => ({
        batch_subject_id: batchSubjectId,
        teacher_id: teacherId,
        institute_id: batchSubject.institute_id,
      }));

      const { error: insertErr } = await supabase
        .from('batch_subject_teachers')
        .insert(rows);

      if (insertErr) {
        if (insertErr.code === '23505') {
          // At least some were duplicates — fall back to individual inserts
          let assignedCount = 0;
          for (const teacherId of teacherIds) {
            const result = await this.assignTeacher(batchSubjectId, teacherId);
            if (result.success && result.data?.assigned) {
              assignedCount++;
            }
          }
          return { success: true, data: { assigned: assignedCount } };
        }
        return { success: false, error: extractErrorMessage(insertErr) };
      }

      // ── Audit: teachers assigned to batch subject (single bulk event) ──
      await auditService.logAssign({
        resourceType: 'batch_subject_teachers',
        resourceId: null,
        metadata: { batchSubjectId, teacherIds, count: teacherIds.length },
      });

      return { success: true, data: { assigned: teacherIds.length } };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  7. Replace All Teachers for a Batch Subject
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Replace all teachers for a batch subject with a new set.
   *
   * Deletes existing assignments and inserts the new ones.
   *
   * @param batchSubjectId - The `batch_subjects.batch_subject_id`.
   * @param teacherIds     - Array of `teacher_details.teacher_id`.
   */
  async replaceTeachers(
    batchSubjectId: string,
    teacherIds: string[],
  ): Promise<ApiResponse<{ assigned: number }>> {
    try {
      validateUUID(batchSubjectId, 'batchSubjectId');

      // Delete all existing assignments
      const { error: deleteErr } = await supabase
        .from('batch_subject_teachers')
        .delete()
        .eq('batch_subject_id', batchSubjectId);

      if (deleteErr) {
        return { success: false, error: extractErrorMessage(deleteErr) };
      }

      // Assign new teachers
      const result = await this.assignMultipleTeachers(batchSubjectId, teacherIds);
      return result;
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  8. Get Assignment Stats
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get teacher assignment statistics by batch subject.
   *
   * @param instituteId - The institute to scope the stats.
   */
  async getAssignmentStats(
    instituteId: string,
  ): Promise<ApiResponse<SubjectTeacherAssignmentStats>> {
    try {
      // 1. Total active batch_subjects in this institute
      const { count: totalSubjects, error: totalErr } = await supabase
        .from('batch_subjects')
        .select('batch_subject_id', { count: 'exact', head: true })
        .eq('is_active', true);

      if (totalErr) {
        return { success: false, error: extractErrorMessage(totalErr) };
      }

      // 2. Batch subjects with at least one teacher assigned
      const { count: assignedCount, error: assignedErr } = await supabase
        .from('batch_subject_teachers')
        .select('batch_subject_id', { count: 'exact', head: true });

      if (assignedErr) {
        return { success: false, error: extractErrorMessage(assignedErr) };
      }

      const totalAssignedSubjects = assignedCount ?? 0;
      const total = totalSubjects ?? 0;
      const unassignedSubjects = Math.max(0, total - totalAssignedSubjects);

      // 3. Teacher workload
      const { data: workloadData, error: workloadErr } = await supabase
        .from('batch_subject_teachers')
        .select(
          `
          teacher_id,
          count:batch_subject_id,
          teacher_details!inner (
            profiles!inner (name)
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
        subjectCount: typeof row.count === 'number' ? row.count : 0,
      }));

      return {
        success: true,
        data: {
          totalAssignedSubjects,
          unassignedSubjects,
          teacherWorkload,
        },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },
};
