/**
 * Doubt Query Keys
 *
 * Centralised, stable query-key definitions for the Doubt module (Phase 7B).
 * Follows the `teacherLeaveKeys` / `mockTestKeys` factory conventions:
 * prefix invalidation (e.g.
 * `queryClient.invalidateQueries({ queryKey: doubtKeys.lists() })`) refreshes
 * every doubt list query without touching the rest of the app.
 *
 * List keys carry a role `scope` ('student' | 'teacher' | 'admin') so a
 * student list and a teacher inbox with identical filters never collide,
 * and invalidation can target one role's lists precisely
 * (`doubtKeys.list('teacher')` prefix).
 *
 * Detail keys are doubt-scoped only: RLS (doubt_visible_to_me) decides which
 * roles may load a given doubt, so the same detail key serves all roles.
 *
 * @module hooks/doubt/queryKeys
 */

import type { DoubtFilters, DoubtListScope } from '@/types/doubt';
import type { PaginationParams } from '@/types/academic';

export const doubtKeys = {
  /** Root key for every doubt query (broad invalidation). */
  all: () => ['doubts'] as const,

  /** Key for every doubt list query (broad invalidation). */
  lists: () => [...doubtKeys.all(), 'list'] as const,

  /**
   * Key for a specific role-scoped, filtered + paginated doubt list.
   *
   * @param scope      - 'student' | 'teacher' | 'admin'.
   * @param filters    - Optional DoubtFilters.
   * @param pagination - Optional page/pageSize.
   */
  list: (
    scope: DoubtListScope,
    filters?: DoubtFilters,
    pagination?: PaginationParams,
  ) => [...doubtKeys.lists(), scope, filters, pagination] as const,

  /** Key for every doubt detail query (broad invalidation). */
  details: () => [...doubtKeys.all(), 'detail'] as const,

  /** Key for a single doubt detail by doubtId (all authorized roles). */
  detail: (doubtId: string) => [...doubtKeys.details(), doubtId] as const,

  /**
   * Key for the teacher inbox subject-filter options (RLS-scoped to the
   * teacher's own batch_subject_teachers assignments).
   */
  subjectOptions: () => [...doubtKeys.all(), 'subject-options'] as const,

  /**
   * Key for the admin assign-picker candidate list (batch_subject ∪
   * subject-specialization teachers). Keyed by the doubt's batch_subject +
   * subject so it changes when the doubt's academic context changes.
   */
  teacherOptions: (batchSubjectKey: string, subjectId: string) =>
    [...doubtKeys.all(), 'teacher-options', batchSubjectKey, subjectId] as const,
};
