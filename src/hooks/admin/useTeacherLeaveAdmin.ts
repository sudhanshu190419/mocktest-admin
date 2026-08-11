/**
 * Teacher Leave Admin Hooks
 *
 * Phase 2B — React Query hooks wrapping `teacherLeaveAdminService`. Server
 * state is owned by React Query (no Redux), matching the rest of the app.
 *
 * ## Exports
 *
 * | Hook                   | Type     | Description                              |
 * |------------------------|----------|------------------------------------------|
 * | `useLeaveRequests`     | Query    | Paginated, filterable admin inbox        |
 * | `useLeaveRequestDetail`| Query    | Full detail for one leave request        |
 * | `useReviewLeaveRequest`| Mutation | Approve / reject a pending request       |
 * | `useResolveClass`      | Mutation | One mutation for all five resolution actions + supersede |
 *
 * ## Invalidation
 *
 * - Review: admin leave lists/details + teacher leave data.
 * - Resolution: admin leave lists/details + teacher leave data + teacher
 *   timetable class queries (prefix) so later UI reflects the new schedule.
 *
 * All mutations go through migration-115 RPCs; the hooks only expose the
 * RPC result/error — they never implement business rules.
 *
 * @module hooks/admin/useTeacherLeaveAdmin
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminKeys } from './queryKeys';
import { teacherLeaveKeys } from '@/hooks/teacher/queryKeys';
import { teacherLeaveAdminService } from '@/services/admin/teacherLeaveAdminService';
import type { PaginatedResponse, PaginationParams } from '@/types/academic';
import type {
  LeaveRequestFilters,
  ResolveClassInput,
  ResolutionResult,
  ReviewLeaveRequestParams,
  ReviewLeaveRequestResult,
  TeacherLeaveRequest,
  TeacherLeaveRequestDetail,
} from '@/types/teacherLeave';

/** Query key prefix for teacher timetable class queries (shared with the
 * teacher timetable hook — see `teacherTimetableKeys`). */
const TEACHER_TIMETABLE_CLASSES_PREFIX = ['teacher-timetable', 'classes'] as const;

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Paginated, filterable admin leave-request inbox (RLS: institute-scoped).
 *
 * @param filters    - Optional status / emergency / teacher / date filters.
 * @param pagination - Optional page/pageSize.
 *
 * @example
 * const { data, isLoading } = useLeaveRequests(
 *   { status: 'pending', emergency: true },
 *   { page: 1, pageSize: 25 },
 * );
 */
export function useLeaveRequests(
  filters?: LeaveRequestFilters,
  pagination?: PaginationParams,
) {
  return useQuery<PaginatedResponse<TeacherLeaveRequest>>({
    queryKey: adminKeys.leaveRequests.list(
      filters as Record<string, unknown> | undefined,
      pagination as Record<string, unknown> | undefined,
    ),
    queryFn: async () => {
      const result = await teacherLeaveAdminService.getLeaveRequests(filters, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch leave requests.');
      }
      return result.data!;
    },
  });
}

/**
 * Full detail for one leave request (header + occurrences + resolutions).
 * Disabled until a leaveId is provided.
 *
 * @param leaveId - teacher_leave_requests.leave_id.
 */
export function useLeaveRequestDetail(leaveId: string | undefined | null) {
  return useQuery<TeacherLeaveRequestDetail>({
    queryKey: adminKeys.leaveRequests.detail(leaveId ?? ''),
    queryFn: async () => {
      const result = await teacherLeaveAdminService.getLeaveRequestDetail(leaveId as string);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch the leave request.');
      }
      return result.data!;
    },
    enabled: !!leaveId,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Approve or reject a pending leave request.
 *
 * On success, invalidates admin leave lists/details and teacher leave data.
 */
export function useReviewLeaveRequest() {
  const queryClient = useQueryClient();

  return useMutation<ReviewLeaveRequestResult, Error, ReviewLeaveRequestParams>({
    mutationFn: async (params) => {
      const result = await teacherLeaveAdminService.reviewTeacherLeaveRequest(params);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to review the leave request.');
      }
      return result.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.leaveRequests.lists() });
      queryClient.invalidateQueries({ queryKey: adminKeys.leaveRequests.details() });
      queryClient.invalidateQueries({ queryKey: teacherLeaveKeys.lists() });
      queryClient.invalidateQueries({ queryKey: teacherLeaveKeys.details() });
    },
  });
}

/**
 * Resolve a pending class resolution — one mutation for every action:
 * `substitute_teacher`, `reschedule`, `recorded_class`, `mock_test`,
 * `cancelled` (cancel the class), and `cancel_resolution` (supersede a
 * pending resolution).
 *
 * On success, invalidates admin leave lists/details, teacher leave data,
 * and teacher timetable class queries.
 *
 * @example
 * const { mutate, isPending } = useResolveClass();
 * mutate({ action: 'substitute_teacher', resolutionId, teacherId });
 * mutate({ action: 'reschedule', resolutionId, newDate, newStart, newEnd });
 * mutate({ action: 'mock_test', resolutionId, testId });
 * mutate({ action: 'cancelled', resolutionId, reason });
 * mutate({ action: 'cancel_resolution', resolutionId, reason });
 */
export function useResolveClass() {
  const queryClient = useQueryClient();

  return useMutation<ResolutionResult, Error, ResolveClassInput>({
    mutationFn: async (input) => {
      let result;
      switch (input.action) {
        case 'substitute_teacher':
          result = await teacherLeaveAdminService.resolveWithSubstitute(input);
          break;
        case 'reschedule':
          result = await teacherLeaveAdminService.rescheduleOccurrence(input);
          break;
        case 'recorded_class':
          result = await teacherLeaveAdminService.assignRecorded(input);
          break;
        case 'mock_test':
          result = await teacherLeaveAdminService.assignMockTest(input);
          break;
        case 'cancelled':
          result = await teacherLeaveAdminService.cancelOccurrence(input);
          break;
        case 'cancel_resolution':
          result = await teacherLeaveAdminService.cancelResolution(input);
          break;
      }

      if (!result.success) {
        throw new Error(result.error ?? 'Failed to resolve the class.');
      }
      return result.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.leaveRequests.lists() });
      queryClient.invalidateQueries({ queryKey: adminKeys.leaveRequests.details() });
      queryClient.invalidateQueries({ queryKey: teacherLeaveKeys.lists() });
      queryClient.invalidateQueries({ queryKey: teacherLeaveKeys.details() });
      queryClient.invalidateQueries({ queryKey: TEACHER_TIMETABLE_CLASSES_PREFIX });
    },
  });
}
