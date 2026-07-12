/**
 * Course Teacher Assignment Service
 *
 * Single source of truth for teacher assignment operations within the
 * Admin Course Management module.
 *
 * Every public method returns a standardised `ApiResponse<T>` shape.
 * Follows the exact same architecture as `batchTeacherAssignmentService.ts`,
 * `batchStudentAssignmentService.ts`, and `mockTestAssignmentService.ts`.
 *
 * ## Scope
 *
 * This service manages the `course_teachers` junction table.
 * It does NOT manage:
 * - Course lifecycle (handled by courseManagementService)
 * - Batch/content assignment to courses (handled by separate services)
 *
 * ## Business Rules
 *
 * - A course may have multiple teachers (many-to-many).
 * - A teacher may teach multiple courses.
 * - Assigning teachers adds new entries; duplicate entries are silently skipped.
 * - Removing a teacher only deletes the course-specific assignment.
 *
 * @module services/admin/courseTeacherAssignmentService
 */

import { supabase } from '@/config/supabase';
import { extractErrorMessage, validateUUID } from '@/utils/supabase';
import type { ApiResponse } from '@/types/academic';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

/** A teacher assigned to a course. */
export interface AssignedCourseTeacher {
  teacherId: string;
  profileId: string;
  facultyId: string | null;
  teacherName: string;
  avatar: string | null;
  department: string | null;
  designation: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  assignedAt: string;
}

/** A teacher available for assignment to a course. */
export interface AvailableCourseTeacher {
  teacherId: string;
  profileId: string;
  facultyId: string | null;
  teacherName: string;
  department: string | null;
  designation: string | null;
  email: string | null;
  phone: string | null;
}

/** Assignment statistics for a course. */
export interface CourseTeacherAssignmentStats {
  /** Number of teachers assigned to this course. */
  assignedCount: number;
  /** Number of teachers available for assignment. */
  availableCount: number;
  /** Role breakdown of assigned teachers. */
  byRole: { role: string; count: number }[];
}

// ═══════════════════════════════════════════════════════════════════════════
//  Service
// ═══════════════════════════════════════════════════════════════════════════

export const courseTeacherAssignmentService = {
  // ─────────────────────────────────────────────────────────────────────────
  //  1. Get Assigned Teachers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get all teachers assigned to a course.
   *
   * Joins `course_teachers` → `teacher_details` → `profiles` to return
   * enriched teacher information including name, email, phone, avatar,
   * faculty ID, department, and designation.
   *
   * @param courseId - The `courses.course_id`.
   */
  async getAssignedTeachers(courseId: string): Promise<ApiResponse<AssignedCourseTeacher[]>> {
    try {
      validateUUID(courseId, 'courseId');

      const { data, error } = await supabase
        .from('course_teachers')
        .select(
          `
          teacher_id,
          role,
          assigned_at,
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
        .eq('course_id', courseId)
        .order('assigned_at', { ascending: true });

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const teachers: AssignedCourseTeacher[] = (data ?? []).map((row: any) => {
        const td = row.teacher_details ?? {};
        const prof = td.profiles ?? {};

        return {
          teacherId: td.teacher_id ?? row.teacher_id,
          profileId: prof.profile_id ?? td.profile_id ?? '',
          facultyId: td.faculty_id ?? null,
          teacherName: prof.name ?? 'Unknown',
          avatar: prof.avatar_url ?? null,
          department: td.department ?? null,
          designation: td.designation ?? null,
          email: prof.email ?? null,
          phone: prof.phone ?? null,
          role: row.role ?? null,
          assignedAt: row.assigned_at ?? '',
        };
      });

      return { success: true, data: teachers };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  2. Get Available Teachers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Fetch teachers available for assignment to a course.
   *
   * Returns approved, active teachers (profiles.role = 'teacher' AND
   * profiles.is_active = true AND profiles.account_status = 'approved').
   * Supports optional search by name or faculty ID.
   * Filters to the same institute as the course.
   * Excludes teachers already assigned to this course.
   *
   * **Root table:** `profiles` (filters are applied on root columns, avoiding
   * PostgREST nested-filter issues with `!inner` joins).
   *
   * @param courseId - The `courses.course_id` to determine the institute scope.
   * @param search   - Optional search term (name or faculty ID).
   */
  async getAvailableTeachers(
    courseId: string,
    search?: string,
  ): Promise<ApiResponse<AvailableCourseTeacher[]>> {
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

      // 2. Get already-assigned teacher IDs to exclude them
      const { data: assignedData } = await supabase
        .from('course_teachers')
        .select('teacher_id')
        .eq('course_id', courseId);

      const assignedTeacherIds = (assignedData ?? []).map((r: any) => r.teacher_id);

      // 3. Query available profiles (not already assigned)
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
        .eq('institute_id', course.institute_id);

      // Exclude already assigned teachers via PostgREST not.in filter
      if (assignedTeacherIds.length > 0) {
        // Manually wrap in parentheses — Supabase JS .not() does NOT add
        // parens around array values like .in() does. Without parens,
        // PostgREST misparses the not.in filter and returns 0 rows.
        query = query.not('teacher_details.teacher_id', 'in', `(${assignedTeacherIds.join(',')})`);
      }

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

      const teachers: AvailableCourseTeacher[] = (data ?? []).map((row: any) => {
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
  //  3. Assign Teachers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Assign one or more teachers to a course.
   *
   * **Business Rule:** A course may have multiple teachers. This method
   * inserts new assignment rows. If a teacher is already assigned, the
   * insertion is silently skipped (no duplicate error).
   *
   * @param courseId    - The `courses.course_id`.
   * @param teacherIds  - Array of `teacher_details.teacher_id` values.
   *
   * @returns The count of teachers actually assigned.
   */
  async assignTeachers(
    courseId: string,
    teacherIds: string[],
  ): Promise<ApiResponse<{ assigned: number }>> {
    try {
      validateUUID(courseId, 'courseId');

      if (!teacherIds.length) {
        return { success: false, error: 'No teacher IDs provided.' };
      }

      // Validate all teacher IDs
      for (const id of teacherIds) {
        validateUUID(id, 'teacherId');
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
      const records = teacherIds.map((teacherId) => ({
        course_id: courseId,
        teacher_id: teacherId,
        institute_id: course.institute_id,
        assigned_at: now,
      }));

      // 3. Insert (ignore conflicts — if already assigned, skip)
      const { error: insertErr } = await supabase
        .from('course_teachers')
        .insert(records)
        .select('teacher_id');

      if (insertErr) {
        if (insertErr.code === '23503') {
          return {
            success: false,
            error: 'Cannot assign teachers. One or more teachers or the course does not exist.',
          };
        }
        return { success: false, error: extractErrorMessage(insertErr) };
      }

      return { success: true, data: { assigned: teacherIds.length } };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  4. Remove Single Teacher
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Remove a specific teacher from a course.
   *
   * If the teacher is not currently assigned, the operation succeeds silently.
   *
   * @param courseId  - The `courses.course_id`.
   * @param teacherId - The `teacher_details.teacher_id` to remove.
   */
  async removeTeacher(
    courseId: string,
    teacherId: string,
  ): Promise<ApiResponse<null>> {
    try {
      validateUUID(courseId, 'courseId');
      validateUUID(teacherId, 'teacherId');

      const { error } = await supabase
        .from('course_teachers')
        .delete()
        .eq('course_id', courseId)
        .eq('teacher_id', teacherId);

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  5. Remove Multiple Teachers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Remove multiple teachers from a course.
   *
   * @param courseId    - The `courses.course_id`.
   * @param teacherIds  - Array of `teacher_details.teacher_id` values to remove.
   */
  async removeTeachers(
    courseId: string,
    teacherIds: string[],
  ): Promise<ApiResponse<null>> {
    try {
      validateUUID(courseId, 'courseId');

      if (!teacherIds.length) {
        return { success: false, error: 'No teacher IDs provided.' };
      }

      for (const id of teacherIds) {
        validateUUID(id, 'teacherId');
      }

      const { error } = await supabase
        .from('course_teachers')
        .delete()
        .eq('course_id', courseId)
        .in('teacher_id', teacherIds);

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
   * Get teacher assignment statistics for a course.
   *
   * Returns the number of assigned teachers, the number of available
   * (unassigned) teachers, and a role breakdown of assigned teachers.
   *
   * @param courseId - The `courses.course_id`.
   */
  async getAssignmentStats(courseId: string): Promise<ApiResponse<CourseTeacherAssignmentStats>> {
    try {
      validateUUID(courseId, 'courseId');

      // 1. Count assigned teachers
      const { count: assignedCount, error: assignedErr } = await supabase
        .from('course_teachers')
        .select('teacher_id', { count: 'exact', head: true })
        .eq('course_id', courseId);

      if (assignedErr) {
        return { success: false, error: extractErrorMessage(assignedErr) };
      }

      // 2. Count available teachers (in the same institute)
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

      const { count: availableCount } = await supabase
        .from('profiles')
        .select('profile_id', { count: 'exact', head: true })
        .eq('role', 'teacher')
        .eq('is_active', true)
        .eq('account_status', 'approved')
        .eq('institute_id', course.institute_id);

      // 3. Role breakdown
      const { data: roleData } = await supabase
        .from('course_teachers')
        .select('role, count:teacher_id')
        .eq('course_id', courseId)
        .order('count', { ascending: false });

      const byRole = (roleData ?? []).map((row: any) => ({
        role: row.role ?? 'Unspecified',
        count: typeof row.count === 'number' ? row.count : 0,
      }));

      return {
        success: true,
        data: {
          assignedCount: assignedCount ?? 0,
          availableCount: availableCount ?? 0,
          byRole,
        },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },
};
