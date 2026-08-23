/**
 * Student Lifecycle Management Service
 *
 * Single source of truth for all student lifecycle operations in the
 * Admin Student Management module.
 *
 * Every public method returns a standardised `ApiResponse<T>` shape.
 * Follows the exact same architecture as `teacherLifecycleService.ts`.
 *
 * ## Scope
 *
 * This service manages the lifecycle of student accounts via the
 * `profiles.account_status` column.  It does NOT manage:
 * - Student details (enrollment number, DOB, target year, etc.)
 * - Student academic data (batches, attendance, results, etc.)
 *
 * ## Status Transitions
 *
 * ```
 *                  ┌──────────┐
 *                  │ pending  │
 *                  └────┬─────┘
 *              ┌────────┴────────┐
 *              ▼                 ▼
 *         ┌──────────┐    ┌──────────┐
 *         │ approved │    │ rejected │
 *         └────┬─────┘    └──────────┘
 *        ┌─────┴──────┐
 *        ▼            ▼
 *  ┌──────────┐ ┌──────────┐
 *  │ suspended│ │ inactive │
 *  └──────────┘ └──────────┘
 * ```
 *
 * @module services/admin/studentLifecycleService
 */

import { supabase } from '@/config/supabase';
import { extractErrorMessage } from '@/utils/supabase';
import { buildPaginatedResponse } from '@/utils/response';
import type { ApiResponse, PaginatedResponse, PaginationParams, SortDirection } from '@/types/academic';
import type { AccountStatus } from '@/types/auth';
import { auditService } from '@/services/audit/auditService';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

/** Lifecycle dashboard counts grouped by account_status. */
export interface StudentLifecycleCounts {
  pending: number;
  approved: number;
  rejected: number;
  suspended: number;
  inactive: number;
  totalStudents: number;
}

/** A single student row in the admin student list. */
export interface StudentListItem {
  profileId: string;
  studentId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  instituteId: string | null;
  instituteName: string | null;
  accountStatus: AccountStatus;
  isActive: boolean;
  enrollmentNo: string | null;
  targetYear: string | null;
  /** All batches this student is enrolled in (may be 0, 1, or many). */
  batches: { batchId: string; batchName: string }[];
  createdAt: string;
  updatedAt: string | null;
}

/** Detailed student profile for the detail view. */
export interface StudentDetail extends StudentListItem {
  dob: string | null;
  enrolledOn: string | null;
  /** Number of batches the student is enrolled in. */
  batchCount: number;
  /** Number of mock attempts made by this student. */
  mockAttemptCount: number;
  /** ISO timestamp of the last activity (last mock attempt). */
  lastActivityAt: string | null;
}

/** Statistics for the student management dashboard. */
export interface StudentStats {
  /** Count of students grouped by account_status. */
  byStatus: { status: string; count: number }[];
  /** Count of students grouped by target_year. */
  byTargetYear: { targetYear: string; count: number }[];
  /** Most recently registered students (last 10). */
  newestStudents: StudentListItem[];
}

/** Filters for the student list query. */
export interface StudentListFilters {
  instituteId?: string;
  /** Filter by account_status (comma-separated for multiple). */
  status?: string;
  /** Filter by batch ID. */
  batchId?: string;
  /** Search across name and email (case-insensitive). */
  search?: string;
}

/** Sort options for the student list query. */
export interface StudentListSortOptions {
  sortBy?: 'name' | 'email' | 'createdAt' | 'accountStatus' | 'targetYear';
  sortDirection?: SortDirection;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

const SORT_FIELD_MAP: Record<string, string> = {
  name: 'name',
  email: 'email',
  createdAt: 'created_at',
  accountStatus: 'account_status',
  targetYear: 'student_details.target_year',
};

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function mapSortField(sortBy?: StudentListSortOptions['sortBy']): string {
  return SORT_FIELD_MAP[sortBy ?? 'createdAt'] ?? 'created_at';
}

/**
 * Maps a bulk lifecycle target status to the audit action to record.
 *
 * The single bulk operation records ONE audit event (not one per student)
 * with the full profile ID list in metadata.
 */
function mapBulkLifecycleAction(
  newStatus: AccountStatus,
): import('@/types/audit').AuditAction {
  switch (newStatus) {
    case 'suspended':
      return 'suspend';
    case 'rejected':
      return 'reject';
    case 'approved':
      return 'reactivate';
    default:
      return 'update';
  }
}

/** Maps a raw Supabase row (profiles → student_details → batch_students → batches) to StudentListItem. */
function toStudentListItem(row: any): StudentListItem {
  const details = row.student_details ?? {};
  // batch_students is nested under student_details (FK: student_details.student_id → batch_students.student_id)
  const rawBatches: any[] = Array.isArray(details.batch_students)
    ? details.batch_students
    : details.batch_students
      ? [details.batch_students]
      : [];
  const batches = rawBatches
    .map((bs: any) => bs?.batch)
    .filter(Boolean)
    .map((b: any) => ({ batchId: b.batch_id, batchName: b.name }));
  return {
    profileId: row.profile_id,
    studentId: details.student_id ?? null,
    name: row.name ?? 'Unknown',
    email: row.email ?? null,
    phone: row.phone ?? null,
    avatarUrl: row.avatar_url ?? null,
    instituteId: row.institute_id ?? null,
    instituteName: null, // TODO: join with institutes table when institute name is needed
    accountStatus: row.account_status ?? 'approved',
    isActive: row.is_active ?? true,
    enrollmentNo: details.enrollment_no ?? null,
    targetYear: details.target_year ?? null,
    batches,
    createdAt: row.created_at ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Service
// ═══════════════════════════════════════════════════════════════════════════

export const studentLifecycleService = {
  // ─────────────────────────────────────────────────────────────────────────
  //  1. Dashboard Counts
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get student lifecycle dashboard counts grouped by account_status.
   */
  async getCounts(instituteId?: string | null): Promise<ApiResponse<StudentLifecycleCounts>> {
    try {
      const makeQuery = (status: AccountStatus) => {
        let q = supabase
          .from('profiles')
          .select('profile_id', { count: 'exact', head: true })
          .eq('role', 'student')
          .eq('account_status', status);
        if (instituteId) {
          q = q.eq('institute_id', instituteId);
        }
        return q;
      };

      const [pending, approved, rejected, suspended, inactive] = await Promise.all([
        makeQuery('pending'),
        makeQuery('approved'),
        makeQuery('rejected'),
        makeQuery('suspended'),
        makeQuery('inactive'),
      ]);

      const counts: StudentLifecycleCounts = {
        pending: pending.count ?? 0,
        approved: approved.count ?? 0,
        rejected: rejected.count ?? 0,
        suspended: suspended.count ?? 0,
        inactive: inactive.count ?? 0,
        totalStudents: 0,
      };
      counts.totalStudents =
        counts.pending + counts.approved + counts.rejected + counts.suspended + counts.inactive;

      return { success: true, data: counts };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  2. Student List
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a paginated, filtered, and sorted list of student profiles.
   *
   * Joins `profiles` with `student_details` (left join) to include
   * enrollment number and target year. Also attaches the first batch
   * via `batch_students` (left join) for display purposes.
   * Supports search, status filter, batch filter, pagination, and sorting.
   */
  async getList(
    filters?: StudentListFilters,
    sort?: StudentListSortOptions,
    pagination?: PaginationParams,
  ): Promise<ApiResponse<PaginatedResponse<StudentListItem>>> {
    try {
      let query = supabase
        .from('profiles')
        .select(
          `
          profile_id,
          institute_id,
          name,
          email,
          phone,
          avatar_url,
          account_status,
          is_active,
          created_at,
          updated_at,
          student_details!left (
            student_id,
            enrollment_no,
            target_year,
            batch_students!left (
              batch:batch_id (
                batch_id,
                name
              )
            )
          )
        `,
          { count: 'exact' },
        )
        .eq('role', 'student');

      // ── Filters ─────────────────────────────────────────────────────
      if (filters?.instituteId) {
        query = query.eq('institute_id', filters.instituteId);
      }

      if (filters?.status) {
        const statuses = filters.status.split(',').map((s) => s.trim());
        if (statuses.length === 1) {
          query = query.eq('account_status', statuses[0]);
        } else {
          query = query.in('account_status', statuses);
        }
      }

      if (filters?.batchId) {
        query = query.eq('student_details.batch_students.batch_id', filters.batchId);
      }

      if (filters?.search) {
        const term = `%${filters.search}%`;
        query = query.or(`name.ilike.${term},email.ilike.${term}`);
      }

      // ── Sorting ────────────────────────────────────────────────────
      const sortBy = mapSortField(sort?.sortBy);
      const direction = sort?.sortDirection ?? 'desc';
      query = query.order(sortBy, { ascending: direction === 'asc' });

      // ── Pagination ──────────────────────────────────────────────────
      const page = pagination?.page ?? 1;
      const pageSize = pagination?.pageSize ?? 20;
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const items = (data ?? []).map(toStudentListItem);

      return {
        success: true,
        data: buildPaginatedResponse(items, count ?? 0, page, pageSize),
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  3. Student Detail
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the full profile details for a single student, including
   * batch information, mock attempt counts, and last activity.
   */
  async getDetail(identifier: string): Promise<ApiResponse<StudentDetail>> {
    try {
      // 1. Fetch profile + student_details + batch_students (support both profile_id and student_id)
      let { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select(
          `
          *,
          student_details!left (*)
        `,
        )
        .eq('profile_id', identifier)
        .maybeSingle();

      if (!profile) {
        // If not found by profile_id, check if identifier is a student_details.student_id
        const { data: studentRecord } = await supabase
          .from('student_details')
          .select('profile_id')
          .eq('student_id', identifier)
          .maybeSingle();

        if (studentRecord?.profile_id) {
          const res = await supabase
            .from('profiles')
            .select(
              `
              *,
              student_details!left (*)
            `,
            )
            .eq('profile_id', studentRecord.profile_id)
            .maybeSingle();
          profile = res.data;
          profileErr = res.error;
        }
      }

      if (!profile) {
        return { success: false, error: `Student not found: ${identifier}` };
      }

      if (profile.role !== 'student') {
        return { success: false, error: `Profile ${identifier} is not a student (role: ${profile.role}).` };
      }

      const details = profile.student_details ?? {};
      const studentId = details.student_id;

      // 2. Fetch related data in parallel
      const [batchRes, attemptRes, lastActivityRes] = await Promise.allSettled([
        // Batch count + first batch info
        studentId
          ? supabase
              .from('batch_students')
              .select(
                `
                batch:batch_id (
                  batch_id,
                  name
                )
              `,
                { count: 'exact' },
              )
              .eq('student_id', studentId)
          : Promise.resolve({ count: 0, data: null }),

        // Mock attempt count
        supabase
          .from('mock_attempts')
          .select('attempt_id', { count: 'exact', head: true })
          .eq('student_id', studentId ?? ''),

        // Last activity (mock attempt)
        supabase
          .from('mock_attempts')
          .select('submitted_at')
          .eq('student_id', studentId ?? '')
          .order('submitted_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const batchCount = batchRes.status === 'fulfilled' ? (batchRes.value as any)?.count ?? 0 : 0;
      const mockAttemptCount = attemptRes.status === 'fulfilled' ? attemptRes.value.count ?? 0 : 0;
      const lastActivityAt =
        lastActivityRes.status === 'fulfilled'
          ? (lastActivityRes.value as any)?.data?.submitted_at ?? null
          : null;

      // Extract batch info from the batch response
      const batches: { batchId: string; batchName: string }[] = [];
      if (batchRes.status === 'fulfilled') {
        const batchData = (batchRes.value as any)?.data;
        if (Array.isArray(batchData)) {
          for (const row of batchData) {
            const b = row?.batch;
            if (b?.batch_id && b?.name) {
              batches.push({ batchId: b.batch_id, batchName: b.name });
            }
          }
        }
      }

      const detail: StudentDetail = {
        profileId: profile.profile_id,
        studentId: studentId ?? null,
        name: profile.name ?? 'Unknown',
        email: profile.email ?? null,
        phone: profile.phone ?? null,
        avatarUrl: profile.avatar_url ?? null,
        instituteId: profile.institute_id ?? null,
        instituteName: null,
        accountStatus: profile.account_status ?? 'approved',
        isActive: profile.is_active ?? true,
        enrollmentNo: details.enrollment_no ?? null,
        targetYear: details.target_year ?? null,
        batches,
        createdAt: profile.created_at ?? new Date().toISOString(),
        updatedAt: profile.updated_at ?? null,
        dob: details.dob ?? null,
        enrolledOn: details.enrolled_on ?? null,
        batchCount,
        mockAttemptCount,
        lastActivityAt,
      };

      return { success: true, data: detail };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  4–8. Status Mutations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Update a student's account_status.
   */
  async updateStatus(
    profileId: string,
    newStatus: AccountStatus,
  ): Promise<ApiResponse<null>> {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ account_status: newStatus })
        .eq('profile_id', profileId)
        .eq('role', 'student');

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  /** Approve a pending student (pending → approved). */
  async approve(profileId: string): Promise<ApiResponse<null>> {
    const result = await this.updateStatus(profileId, 'approved');
    if (result.success) {
      await auditService.logApprove({
        resourceType: 'profiles',
        resourceId: profileId,
        metadata: { role: 'student', newStatus: 'approved', previousStatus: 'pending' },
      });
    }
    return result;
  },

  /** Reject a pending student (pending → rejected). */
  async reject(profileId: string): Promise<ApiResponse<null>> {
    const result = await this.updateStatus(profileId, 'rejected');
    if (result.success) {
      await auditService.logReject({
        resourceType: 'profiles',
        resourceId: profileId,
        metadata: { role: 'student', newStatus: 'rejected', previousStatus: 'pending' },
      });
    }
    return result;
  },

  /** Suspend an active student (approved → suspended). */
  async suspend(profileId: string): Promise<ApiResponse<null>> {
    const result = await this.updateStatus(profileId, 'suspended');
    if (result.success) {
      await auditService.logSuspend({
        resourceType: 'profiles',
        resourceId: profileId,
        metadata: { role: 'student', newStatus: 'suspended' },
      });
    }
    return result;
  },

  /** Activate a suspended or inactive student (suspended/inactive → approved). */
  async activate(profileId: string): Promise<ApiResponse<null>> {
    const result = await this.updateStatus(profileId, 'approved');
    if (result.success) {
      await auditService.logReactivate({
        resourceType: 'profiles',
        resourceId: profileId,
        metadata: { role: 'student', newStatus: 'approved', previousStatus: 'suspended/inactive' },
      });
    }
    return result;
  },

  /** Deactivate an active student (approved → inactive). */
  async deactivate(profileId: string): Promise<ApiResponse<null>> {
    const result = await this.updateStatus(profileId, 'inactive');
    if (result.success) {
      await auditService.logUpdate({
        resourceType: 'profiles',
        resourceId: profileId,
        metadata: { role: 'student', newStatus: 'inactive', previousStatus: 'approved' },
      });
    }
    return result;
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  9. Bulk Operations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Bulk-update the account_status for multiple students.
   */
  async bulkUpdateStatus(
    profileIds: string[],
    newStatus: AccountStatus,
  ): Promise<ApiResponse<{ updatedCount: number }>> {
    try {
      if (profileIds.length === 0) {
        return { success: true, data: { updatedCount: 0 } };
      }

      const { error } = await supabase
        .from('profiles')
        .update({ account_status: newStatus })
        .in('profile_id', profileIds)
        .eq('role', 'student');

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      // ── Audit: bulk student status change (single event) ──────────────
      await auditService.log({
        action: mapBulkLifecycleAction(newStatus),
        resourceType: 'profiles',
        resourceId: null,
        newValue: { accountStatus: newStatus },
        metadata: { role: 'student', profileIds, count: profileIds.length, newStatus },
      });

      return { success: true, data: { updatedCount: profileIds.length } };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  /** Bulk-approve selected students. */
  async bulkApprove(profileIds: string[]): Promise<ApiResponse<{ updatedCount: number }>> {
    return this.bulkUpdateStatus(profileIds, 'approved');
  },

  /** Bulk-reject selected students. */
  async bulkReject(profileIds: string[]): Promise<ApiResponse<{ updatedCount: number }>> {
    return this.bulkUpdateStatus(profileIds, 'rejected');
  },

  /** Bulk-suspend selected students. */
  async bulkSuspend(profileIds: string[]): Promise<ApiResponse<{ updatedCount: number }>> {
    return this.bulkUpdateStatus(profileIds, 'suspended');
  },

  /** Bulk-activate (set to approved) selected students. */
  async bulkActivate(profileIds: string[]): Promise<ApiResponse<{ updatedCount: number }>> {
    return this.bulkUpdateStatus(profileIds, 'approved');
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  10. Statistics
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get student statistics for the admin student management dashboard.
   *
   * Returns:
   * - Count by account_status
   * - Count by target_year (top 10)
   * - Newest students (last 10)
   */
  async getStats(instituteId?: string | null): Promise<ApiResponse<StudentStats>> {
    try {
      // 1. Count by status — use getCounts and transform
      const countsRes = await this.getCounts(instituteId);
      const counts = countsRes.data;
      const byStatus = counts
        ? [
            { status: 'pending', count: counts.pending },
            { status: 'approved', count: counts.approved },
            { status: 'rejected', count: counts.rejected },
            { status: 'suspended', count: counts.suspended },
            { status: 'inactive', count: counts.inactive },
          ]
        : [];

      // 2. Count by target_year
      let targetYearQuery = supabase
        .from('student_details')
        .select('target_year, count:student_id')
        .not('target_year', 'is', null);

      if (instituteId) {
        targetYearQuery = targetYearQuery.eq('institute_id', instituteId);
      }

      const { data: yearData } = await targetYearQuery
        .order('target_year', { ascending: false })
        .limit(10);

      const byTargetYear = (yearData ?? []).map((row: any) => ({
        targetYear: row.target_year ?? 'Unknown',
        count: typeof row.count === 'number' ? row.count : 0,
      }));

      // 3. Newest students (last 10)
      let newestQuery = supabase
        .from('profiles')
        .select(
          `
          profile_id,
          institute_id,
          name,
          email,
          phone,
          avatar_url,
          account_status,
          is_active,
          created_at,
          updated_at,
          student_details!left (
            student_id,
            enrollment_no,
            target_year,
            batch_students!left (
              batch:batch_id (
                batch_id,
                name
              )
            )
          )
        `,
        )
        .eq('role', 'student');

      if (instituteId) {
        newestQuery = newestQuery.eq('institute_id', instituteId);
      }

      const { data: newestData } = await newestQuery
        .order('created_at', { ascending: false })
        .limit(10);

      const newestStudents = (newestData ?? []).map(toStudentListItem);

      return {
        success: true,
        data: { byStatus, byTargetYear, newestStudents },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },
};
