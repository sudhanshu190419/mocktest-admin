/**
 * Teacher Lifecycle Management Service
 *
 * Single source of truth for all teacher lifecycle operations in the
 * Admin Teacher Management module.
 *
 * Every public method returns a standardised `ApiResponse<T>` shape.
 *
 * ## Scope
 *
 * This service manages the lifecycle of teacher accounts via the
 * `profiles.account_status` column.  It does NOT manage:
 * - Teacher details (specializations, qualifications, etc.)
 * - Teacher content (questions, mock tests, etc.)
 * - Teacher HR data (employment, bank details, etc.)
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
 * @module services/admin/teacherLifecycleService
 */

import { supabase } from '@/config/supabase';
import { extractErrorMessage } from '@/utils/supabase';
import { buildPaginatedResponse } from '@/utils/response';
import type { ApiResponse, PaginatedResponse, PaginationParams, SortDirection } from '@/types/academic';
import type { AccountStatus } from '@/types/auth';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

/** Lifecycle dashboard counts grouped by account_status. */
export interface TeacherLifecycleCounts {
  pending: number;
  approved: number;
  rejected: number;
  suspended: number;
  inactive: number;
  /** Sum of all statuses above. */
  total: number;
}

/** A single teacher row in the admin teacher list. */
export interface TeacherListItem {
  profileId: string;
  teacherId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  department: string | null;
  designation: string | null;
  instituteId: string | null;
  instituteName: string | null;
  accountStatus: AccountStatus;
  createdAt: string;
}

/** Detailed teacher profile for the detail view. */
export interface TeacherDetail extends TeacherListItem {
  avatarUrl: string | null;
  isActive: boolean;
  updatedAt: string | null;
  /** Number of batches the teacher is assigned to. */
  batchCount: number;
  /** Number of questions created by this teacher. */
  questionCount: number;
  /** Number of mock tests created by this teacher. */
  mockTestCount: number;
  /** ISO timestamp of the last activity (last mock test or question creation). */
  lastActivityAt: string | null;
}

/** Statistics for the teacher management dashboard. */
export interface TeacherStats {
  /** Count of teachers grouped by department (top 10 by count). */
  byDepartment: { department: string; count: number }[];
  /** Count of teachers grouped by account_status. */
  byStatus: { status: string; count: number }[];
  /** Most recently registered teachers (last 10). */
  newestTeachers: TeacherListItem[];
}

/** Filters for the teacher list query. */
export interface TeacherListFilters {
  instituteId?: string;
  /** Filter by account_status (comma-separated for multiple). */
  status?: string;
  /** Filter by department (exact match). */
  department?: string;
  /** Search across name and email (case-insensitive). */
  search?: string;
}

/** Sort options for the teacher list query. */
export interface TeacherListSortOptions {
  sortBy?: 'name' | 'email' | 'department' | 'createdAt' | 'accountStatus';
  sortDirection?: SortDirection;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

const SORT_FIELD_MAP: Record<string, string> = {
  name: 'name',
  email: 'email',
  department: 'department',
  createdAt: 'created_at',
  accountStatus: 'account_status',
};

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function mapSortField(sortBy?: TeacherListSortOptions['sortBy']): string {
  return SORT_FIELD_MAP[sortBy ?? 'createdAt'] ?? 'created_at';
}

/** Maps a raw Supabase row (profiles JOIN teacher_details) to TeacherListItem. */
function toTeacherListItem(row: any): TeacherListItem {
  return {
    profileId: row.profile_id,
    teacherId: row.teacher_id ?? null,
    name: row.name ?? 'Unknown',
    email: row.email ?? null,
    phone: row.phone ?? null,
    department: row.department ?? null,
    designation: row.designation ?? null,
    instituteId: row.institute_id ?? null,
    instituteName: row.institute_name ?? null,
    accountStatus: row.account_status ?? 'approved',
    createdAt: row.created_at ?? new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Service
// ═══════════════════════════════════════════════════════════════════════════

export const teacherLifecycleService = {
  // ─────────────────────────────────────────────────────────────────────────
  //  1. Dashboard Counts
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get teacher lifecycle dashboard counts grouped by account_status.
   */
  async getCounts(instituteId?: string | null): Promise<ApiResponse<TeacherLifecycleCounts>> {
    try {
      // Create a FRESH query builder for each status so that .eq() filters
      // on one query do NOT mutate the shared builder (the bug: previously
      // all 5 .eq('account_status', ...) calls accumulated on the same
      // `base` object, producing impossible WHERE conditions like
      // "account_status = 'pending' AND account_status = 'approved'"
      // which always returned 0 for every count).
      const makeQuery = (status: AccountStatus) => {
        let q = supabase
          .from('profiles')
          .select('profile_id', { count: 'exact', head: true })
          .eq('role', 'teacher')
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

      const counts: TeacherLifecycleCounts = {
        pending: pending.count ?? 0,
        approved: approved.count ?? 0,
        rejected: rejected.count ?? 0,
        suspended: suspended.count ?? 0,
        inactive: inactive.count ?? 0,
        total: 0,
      };
      counts.total = counts.pending + counts.approved + counts.rejected + counts.suspended + counts.inactive;

      return { success: true, data: counts };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  2. Teacher List
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a paginated, filtered, and sorted list of teacher profiles.
   *
   * Joins `profiles` with `teacher_details` (left join) to include
   * department and designation.  Supports search, status filter,
   * department filter, pagination, and sorting.
   */
  async getList(
    filters?: TeacherListFilters,
    sort?: TeacherListSortOptions,
    pagination?: PaginationParams,
  ): Promise<ApiResponse<PaginatedResponse<TeacherListItem>>> {
    try {
      // Build query with join to teacher_details for department/designation
      let query = supabase
        .from('profiles')
        .select(
          `
          profile_id,
          institute_id,
          name,
          email,
          phone,
          account_status,
          is_active,
          created_at,
          updated_at,
          teacher_details!left (
            teacher_id,
            department,
            designation
          )
        `,
          { count: 'exact' },
        )
        .eq('role', 'teacher');

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

      if (filters?.department) {
        query = query.eq('teacher_details.department', filters.department);
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

      const items = (data ?? []).map((row: any) => {
        const details = row.teacher_details ?? {};
        return {
          profileId: row.profile_id,
          teacherId: details.teacher_id ?? null,
          name: row.name ?? 'Unknown',
          email: row.email ?? null,
          phone: row.phone ?? null,
          department: details.department ?? null,
          designation: details.designation ?? null,
          instituteId: row.institute_id ?? null,            instituteName: null, // TODO: join with institutes table when institute name is needed
          accountStatus: row.account_status ?? 'approved',
          createdAt: row.created_at ?? new Date().toISOString(),
        };
      });

      return {
        success: true,
        data: buildPaginatedResponse(items, count ?? 0, page, pageSize),
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  3. Teacher Detail
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the full profile details for a single teacher, including
   * counts of batches, questions, and mock tests, plus last activity.
   */
  async getDetail(profileId: string): Promise<ApiResponse<TeacherDetail>> {
    try {
      // 1. Fetch profile + teacher_details
      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select(
          `
          *,
          teacher_details!left (*)
        `,
        )
        .eq('profile_id', profileId)
        .single();

      if (profileErr) {
        if (profileErr.code === 'PGRST116') {
          return { success: false, error: `Teacher not found: ${profileId}` };
        }
        return { success: false, error: extractErrorMessage(profileErr) };
      }

      if (profile.role !== 'teacher') {
        return { success: false, error: `Profile ${profileId} is not a teacher (role: ${profile.role}).` };
      }

      const details = profile.teacher_details ?? {};
      const teacherId = details.teacher_id;

      // 2. Fetch related counts and last activity in parallel
      const [batchRes, questionRes, mockTestRes, qDateRes, mtDateRes] = await Promise.allSettled([
        // Batch count
        teacherId
          ? supabase
              .from('batch_subject_teachers')
              .select('batch_subject_id', { count: 'exact', head: true })
              .eq('teacher_id', teacherId)
          : Promise.resolve({ count: 0, data: null }),

        // Question count
        supabase
          .from('questions')
          .select('question_id', { count: 'exact', head: true })
          .eq('created_by', teacherId ?? profileId),

        // Mock test count
        supabase
          .from('mock_tests')
          .select('test_id', { count: 'exact', head: true })
          .eq('teacher_id', teacherId ?? ''),

        // Last question created_at
        supabase
          .from('questions')
          .select('created_at')
          .eq('created_by', teacherId ?? profileId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),

        // Last mock test created_at
        supabase
          .from('mock_tests')
          .select('created_at')
          .eq('teacher_id', teacherId ?? '')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const batchCount = batchRes.status === 'fulfilled' ? (batchRes.value as any)?.count ?? 0 : 0;
      const questionCount = questionRes.status === 'fulfilled' ? questionRes.value.count ?? 0 : 0;
      const mockTestCount = mockTestRes.status === 'fulfilled' ? mockTestRes.value.count ?? 0 : 0;

      // Compute last activity: the most recent between last question and last mock test
      const qDate = qDateRes.status === 'fulfilled' ? (qDateRes.value as any)?.data?.created_at ?? null : null;
      const mtDate = mtDateRes.status === 'fulfilled' ? (mtDateRes.value as any)?.data?.created_at ?? null : null;
      const lastActivityAt = [qDate, mtDate].filter(Boolean).sort().pop() ?? null;

      const detail: TeacherDetail = {
        profileId: profile.profile_id,
        teacherId: teacherId ?? null,
        name: profile.name ?? 'Unknown',
        email: profile.email ?? null,
        phone: profile.phone ?? null,
        department: details.department ?? null,
        designation: details.designation ?? null,
        instituteId: profile.institute_id ?? null,
        instituteName: null,
        accountStatus: profile.account_status ?? 'approved',
        createdAt: profile.created_at ?? new Date().toISOString(),
        avatarUrl: profile.avatar_url ?? null,
        isActive: profile.is_active ?? true,
        updatedAt: profile.updated_at ?? null,
        batchCount,
        questionCount,
        mockTestCount,
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
   * Update a teacher's account_status.
   *
   * All single-teacher status mutations (approve, reject, suspend,
   * activate, deactivate) funnel through this function.
   *
   * @param profileId - The `profiles.profile_id` of the teacher.
   * @param newStatus - The target account_status.
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
        .eq('role', 'teacher');

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  /** Approve a pending teacher (pending → approved). */
  async approve(profileId: string): Promise<ApiResponse<null>> {
    return this.updateStatus(profileId, 'approved');
  },

  /** Reject a pending teacher (pending → rejected). */
  async reject(profileId: string): Promise<ApiResponse<null>> {
    return this.updateStatus(profileId, 'rejected');
  },

  /** Suspend an active teacher (approved → suspended). */
  async suspend(profileId: string): Promise<ApiResponse<null>> {
    return this.updateStatus(profileId, 'suspended');
  },

  /** Activate a suspended or inactive teacher (suspended/inactive → approved). */
  async activate(profileId: string): Promise<ApiResponse<null>> {
    return this.updateStatus(profileId, 'approved');
  },

  /** Deactivate an active teacher (approved → inactive). */
  async deactivate(profileId: string): Promise<ApiResponse<null>> {
    return this.updateStatus(profileId, 'inactive');
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  9. Bulk Operations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Bulk-update the account_status for multiple teachers.
   *
   * @param profileIds - Array of `profiles.profile_id` values.
   * @param newStatus  - The target account_status.
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
        .eq('role', 'teacher');

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      // Return the count of input IDs optimistically — Supabase update()
      // does not reliably return matched row counts in the v2 client.
      return { success: true, data: { updatedCount: profileIds.length } };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  /** Bulk-approve selected teachers. */
  async bulkApprove(profileIds: string[]): Promise<ApiResponse<{ updatedCount: number }>> {
    return this.bulkUpdateStatus(profileIds, 'approved');
  },

  /** Bulk-reject selected teachers. */
  async bulkReject(profileIds: string[]): Promise<ApiResponse<{ updatedCount: number }>> {
    return this.bulkUpdateStatus(profileIds, 'rejected');
  },

  /** Bulk-suspend selected teachers. */
  async bulkSuspend(profileIds: string[]): Promise<ApiResponse<{ updatedCount: number }>> {
    return this.bulkUpdateStatus(profileIds, 'suspended');
  },

  /** Bulk-activate (set to approved) selected teachers. */
  async bulkActivate(profileIds: string[]): Promise<ApiResponse<{ updatedCount: number }>> {
    return this.bulkUpdateStatus(profileIds, 'approved');
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  10. Statistics
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get teacher statistics for the admin teacher management dashboard.
   *
   * Returns:
   * - Count by department (top 10)
   * - Count by account_status
   * - Newest teachers (last 10)
   */
  async getStats(instituteId?: string | null): Promise<ApiResponse<TeacherStats>> {
    try {
      const baseFilter = instituteId ? { institute_id: instituteId } : {};

      // 1. Count by department
      const { data: deptData } = await supabase
        .from('teacher_details')
        .select('department, count:teacher_id')
        .match(baseFilter)
        .not('department', 'is', null)
        .order('count', { ascending: false })
        .limit(10);

      const byDepartment = (deptData ?? []).map((row: any) => ({
        department: row.department ?? 'Unspecified',
        count: typeof row.count === 'number' ? row.count : 0,
      }));

      // 2. Count by status — use getCounts and transform
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

      // 3. Newest teachers (last 10)
      const { data: newestData } = await supabase
        .from('profiles')
        .select(
          `
          profile_id,
          institute_id,
          name,
          email,
          phone,
          account_status,
          is_active,
          created_at,
          updated_at,
          teacher_details!left (
            teacher_id,
            department,
            designation
          )
        `,
        )
        .eq('role', 'teacher')
        .match(baseFilter)
        .order('created_at', { ascending: false })
        .limit(10);

      const newestTeachers = (newestData ?? []).map(toTeacherListItem);

      return {
        success: true,
        data: { byDepartment, byStatus, newestTeachers },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },
};
