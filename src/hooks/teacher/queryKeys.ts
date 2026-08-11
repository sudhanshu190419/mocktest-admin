/**
 * Teacher Query Keys
 *
 * Centralised teacher query-key namespace for the leave-request module
 * (Phase 2B). Follows the `teacherTimetableKeys` conventions in
 * `src/hooks/teacher/useTeacherTimetable.ts` and the admin `adminKeys`
 * factory pattern: prefix invalidation (e.g.
 * `queryClient.invalidateQueries({ queryKey: teacherLeaveKeys.all() })`)
 * refreshes every teacher leave query.
 *
 * Keys are RLS-scoped (the teacher's own rows), so no teacherId is needed —
 * unlike timetable slots/classes which require it.
 *
 * @module hooks/teacher/queryKeys
 */

export const teacherLeaveKeys = {
  /** Root key for every teacher-leave query (broad invalidation). */
  all: () => ['teacher-leave'] as const,

  /** Key for every list-type query (broad invalidation). */
  lists: () => [...teacherLeaveKeys.all(), 'list'] as const,

  /** Key for the teacher's own leave-request list. */
  list: () => [...teacherLeaveKeys.lists()] as const,

  /** Key for every detail-type query. */
  details: () => [...teacherLeaveKeys.all(), 'detail'] as const,

  /** Key for a single leave request by leaveId. */
  detail: (leaveId: string) => [...teacherLeaveKeys.details(), leaveId] as const,
};
