/**
 * Teacher Leave Hooks
 *
 * Phase 2B — React Query hooks wrapping `teacherLeaveService`. Server state
 * is owned by React Query (no Redux), matching the rest of the app.
 *
 * ## Invalidation
 *
 * - `useSubmitLeaveRequest` / `useCancelLeaveRequest` invalidate the
 *   teacher's own leave lists/details AND the teacher timetable class
 *   queries (prefix `['teacher-timetable', 'classes']`) so any later UI
 *   immediately reflects the changed schedule.
 *
 * All mutations go through migration-115 RPCs; the hooks only expose the
 * RPC result/error — they never implement business rules.
 *
 * @module hooks/teacher/useTeacherLeave
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { teacherLeaveKeys } from './queryKeys';
import { teacherLeaveService } from '@/services/teacher/teacherLeaveService';
import type {
  CancelLeaveRequestResult,
  SubmitLeaveRequestParams,
  SubmitLeaveRequestResult,
  TeacherLeaveRequest,
  TeacherLeaveRequestDetail,
} from '@/types/teacherLeave';

/** Query key prefix for teacher timetable class queries (shared with the
 * teacher timetable hook — see `teacherTimetableKeys`). */
const TEACHER_TIMETABLE_CLASSES_PREFIX = ['teacher-timetable', 'classes'] as const;

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Fetch the current teacher's own leave requests (newest first).
 *
 * The query is enabled unconditionally — teacher routes are wrapped in
 * RoleGuard, so an authenticated teacher context is guaranteed there.
 */
export function useMyLeaveRequests() {
  return useQuery<TeacherLeaveRequest[]>({
    queryKey: teacherLeaveKeys.list(),
    queryFn: async () => {
      const result = await teacherLeaveService.getMyLeaveRequests();
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch your leave requests.');
      }
      return result.data!;
    },
  });
}

/**
 * Fetch one of the teacher's own leave requests with its occurrences and
 * resolutions. Disabled until a leaveId is provided.
 *
 * @param leaveId - teacher_leave_requests.leave_id.
 */
export function useMyLeaveRequest(leaveId: string | undefined | null) {
  return useQuery<TeacherLeaveRequestDetail>({
    queryKey: teacherLeaveKeys.detail(leaveId ?? ''),
    queryFn: async () => {
      const result = await teacherLeaveService.getMyLeaveRequest(leaveId as string);
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
 * Submit a leave request for a date range (via submit_teacher_leave_request).
 *
 * The RPC discovers the affected occurrences and computes emergency
 * classification server-side. On success, invalidates the teacher's leave
 * lists/details and teacher timetable class queries.
 */
export function useSubmitLeaveRequest() {
  const queryClient = useQueryClient();

  return useMutation<SubmitLeaveRequestResult, Error, SubmitLeaveRequestParams>({
    mutationFn: async (params) => {
      const result = await teacherLeaveService.submitLeaveRequest(params);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to submit the leave request.');
      }
      return result.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teacherLeaveKeys.lists() });
      queryClient.invalidateQueries({ queryKey: teacherLeaveKeys.details() });
      queryClient.invalidateQueries({ queryKey: TEACHER_TIMETABLE_CLASSES_PREFIX });
    },
  });
}

/**
 * Cancel one of the teacher's OWN pending leave requests.
 *
 * On success, invalidates the teacher's leave lists/details.
 */
export function useCancelLeaveRequest() {
  const queryClient = useQueryClient();

  return useMutation<CancelLeaveRequestResult, Error, string>({
    mutationFn: async (leaveId) => {
      const result = await teacherLeaveService.cancelLeaveRequest(leaveId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to cancel the leave request.');
      }
      return result.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teacherLeaveKeys.lists() });
      queryClient.invalidateQueries({ queryKey: teacherLeaveKeys.details() });
    },
  });
}
