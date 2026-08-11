/**
 * Doubt Hooks
 *
 * Phase 7B — React Query hooks wrapping `doubtService` (+ attachment
 * service). Server state is owned by React Query (no Redux), matching the
 * rest of the app.
 *
 * ## Role model
 *
 * The same `doubtService` powers all three roles; RLS decides visibility.
 * List hooks carry a role scope in their query key ('student' | 'teacher' |
 * 'admin') so the three views cache independently, while the single
 * `useDoubtDetail` key serves every authorized role (RLS-authoritative).
 *
 * ## Invalidation
 *
 * - Submit: student lists + all doubt details (a new doubt appears in the
 *   teacher inbox / admin view too — but only via refetch-on-focus/stale
 *   invalidation, never by guessing server state).
 * - Reply / accept / resolve / reopen / archive: the affected detail + all
 *   role lists (status / first-response / accepted-answer change list
 *   badges and previews).
 * - Assign: admin lists + teacher lists + student detail (assignment is
 *   displayed in the student detail).
 *
 * Never `queryClient.clear()`, never invalidate unrelated modules.
 *
 * All mutations go through migration-117 RPCs; the hooks only expose the
 * RPC result/error — they never implement business rules.
 *
 * @module hooks/doubt/useDoubt
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { doubtKeys } from './queryKeys';
import { doubtService } from '@/services/doubtService';
import { doubtAttachmentService } from '@/services/doubtAttachmentService';
import type { PaginatedResponse, PaginationParams } from '@/types/academic';
import type {
  AcceptDoubtAnswerInput,
  ArchiveDoubtInput,
  AssignDoubtInput,
  AssignDoubtResult,
  DoubtFilters,
  DoubtListScope,
  DoubtTeacherOption,
  ReplyToDoubtInput,
  ReplyToDoubtResult,
  ReopenDoubtInput,
  ResolveDoubtInput,
  StudentDoubt,
  StudentDoubtDetail,
  SubmitDoubtInput,
  SubmitDoubtResult,
} from '@/types/doubt';

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Shared role-scoped list query implementation. Dispatches to the matching
 * service read so the correct RLS view (student/teacher/admin) is queried;
 * the scope is also baked into the query key.
 */
function useDoubtList(
  scope: DoubtListScope,
  filters?: DoubtFilters,
  pagination?: PaginationParams,
) {
  return useQuery<PaginatedResponse<StudentDoubt>>({
    queryKey: doubtKeys.list(scope, filters, pagination),
    queryFn: async () => {
      const readFn =
        scope === 'student'
          ? doubtService.getMyDoubts
          : scope === 'teacher'
            ? doubtService.getTeacherDoubts
            : doubtService.getAdminDoubts;
      const result = await readFn(filters, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch doubts.');
      }
      return result.data!;
    },
  });
}

/** The student's own doubts (RLS: own rows only). */
export function useMyDoubts(filters?: DoubtFilters, pagination?: PaginationParams) {
  return useDoubtList('student', filters, pagination);
}

/** Teacher doubt inbox (RLS: institute-scoped + routing/specialization). */
export function useTeacherDoubts(filters?: DoubtFilters, pagination?: PaginationParams) {
  return useDoubtList('teacher', filters, pagination);
}

/** Admin doubt management list (RLS: institute-scoped). */
export function useAdminDoubts(filters?: DoubtFilters, pagination?: PaginationParams) {
  return useDoubtList('admin', filters, pagination);
}

/**
 * Subjects visible to the current teacher, for the inbox subject filter.
 * Scoped by RLS to the teacher's own batch_subject_teachers assignments.
 */
export function useTeacherDoubtSubjects() {
  return useQuery<{ subjectId: string; name: string }[]>({
    queryKey: doubtKeys.subjectOptions(),
    queryFn: async () => {
      const result = await doubtService.getTeacherDoubtSubjects();
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to load subjects.');
      }
      return result.data!;
    },
  });
}

/** Optional freshness tuning for `useDoubtDetail` (defaults to the global client config). */
export interface DoubtDetailQueryOptions {
  /**
   * Poll the detail while this query is mounted (ms). Use sparingly — the
   * teacher detail page uses a gentle 60s interval so a student's mobile
   * reopen/follow-up is picked up without a manual refresh.
   */
  refetchInterval?: number | false;
  /** Refetch when the window/tab regains focus. Defaults to the client-wide setting. */
  refetchOnWindowFocus?: boolean;
}

/**
 * Candidate teachers for the admin assign picker (batch-subject ∪ subject
 * specialization — mirrors assign_doubt eligibility). Disabled until a
 * doubt with a subject is provided, or when the caller explicitly disables
 * it (e.g. the doubt is archived/resolved and cannot be assigned).
 */
export function useDoubtAssignableTeachers(
  doubt: { batchSubjectId?: string | null; subjectId: string } | null | undefined,
  enabled = true,
) {
  return useQuery<DoubtTeacherOption[]>({
    queryKey: doubtKeys.teacherOptions(doubt?.batchSubjectId ?? 'none', doubt?.subjectId ?? ''),
    queryFn: async () => {
      const result = await doubtService.getDoubtAssignableTeachers({
        batchSubjectId: doubt?.batchSubjectId ?? null,
        subjectId: doubt!.subjectId,
      });
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to load teachers.');
      }
      return result.data!;
    },
    enabled: enabled && !!doubt && !!doubt.subjectId,
  });
}

/**
 * Full detail for one doubt (header + replies + attachments).
 * Disabled until a doubtId is provided. The same key serves every role —
 * RLS decides whether the current user may load it.
 *
 * @param doubtId - student_doubts.doubt_id.
 * @param options - Optional freshness tuning (see DoubtDetailQueryOptions).
 */
export function useDoubtDetail(
  doubtId: string | undefined | null,
  options?: DoubtDetailQueryOptions,
) {
  return useQuery<StudentDoubtDetail>({
    queryKey: doubtKeys.detail(doubtId ?? ''),
    queryFn: async () => {
      const result = await doubtService.getDoubtDetail(doubtId as string);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch the doubt.');
      }
      return result.data!;
    },
    enabled: !!doubtId,
    ...(options?.refetchInterval !== undefined && { refetchInterval: options.refetchInterval }),
    ...(options?.refetchOnWindowFocus !== undefined && { refetchOnWindowFocus: options.refetchOnWindowFocus }),
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/** Invalidates every doubt list + detail query (module-scoped only). */
function useDoubtInvalidateAll() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: doubtKeys.lists() });
    queryClient.invalidateQueries({ queryKey: doubtKeys.details() });
  };
}

/**
 * Student submits a doubt (submit_student_doubt).
 *
 * On success, invalidates all doubt lists (the new doubt may surface in the
 * student list, teacher inbox, and admin view) + all details.
 */
export function useSubmitDoubt() {
  const invalidate = useDoubtInvalidateAll();

  return useMutation<SubmitDoubtResult, Error, SubmitDoubtInput>({
    mutationFn: async (params) => {
      const result = await doubtService.submitDoubt(params);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to submit the doubt.');
      }
      return result.data!;
    },
    onSuccess: invalidate,
  });
}

/**
 * Reply to a doubt — student follow-up, teacher answer, or admin reply
 * (reply_to_doubt). On success, invalidates all doubt lists + details.
 */
export function useReplyToDoubt() {
  const invalidate = useDoubtInvalidateAll();

  return useMutation<ReplyToDoubtResult, Error, ReplyToDoubtInput>({
    mutationFn: async (params) => {
      const result = await doubtService.replyToDoubt(params);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to send the reply.');
      }
      return result.data!;
    },
    onSuccess: invalidate,
  });
}

/**
 * Student accepts a teacher/admin reply as the solution
 * (accept_doubt_answer). On success, invalidates all doubt lists + details.
 */
export function useAcceptDoubtAnswer() {
  const invalidate = useDoubtInvalidateAll();

  return useMutation<{ success: boolean; status: string }, Error, AcceptDoubtAnswerInput>({
    mutationFn: async (params) => {
      const result = await doubtService.acceptDoubtAnswer(params);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to accept the answer.');
      }
      return result.data!;
    },
    onSuccess: invalidate,
  });
}

/**
 * Resolve a doubt directly (resolve_doubt) — owner student, authorized
 * teacher, or admin. On success, invalidates all doubt lists + details.
 */
export function useResolveDoubt() {
  const invalidate = useDoubtInvalidateAll();

  return useMutation<{ success: boolean; status: string }, Error, ResolveDoubtInput>({
    mutationFn: async (params) => {
      const result = await doubtService.resolveDoubt(params);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to resolve the doubt.');
      }
      return result.data!;
    },
    onSuccess: invalidate,
  });
}

/**
 * Reopen a resolved doubt (reopen_doubt) — owner student (capped at 3) or
 * admin. On success, invalidates all doubt lists + details.
 */
export function useReopenDoubt() {
  const invalidate = useDoubtInvalidateAll();

  return useMutation<{ success: boolean; status: string }, Error, ReopenDoubtInput>({
    mutationFn: async (params) => {
      const result = await doubtService.reopenDoubt(params);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to reopen the doubt.');
      }
      return result.data!;
    },
    onSuccess: invalidate,
  });
}

/**
 * Academic admin assigns (or reassigns) a teacher (assign_doubt).
 *
 * On success, invalidates all doubt lists (teacher inbox + admin view +
 * student list change) and all details (assignment is displayed in the
 * student detail).
 */
export function useAssignDoubt() {
  const invalidate = useDoubtInvalidateAll();

  return useMutation<AssignDoubtResult, Error, AssignDoubtInput>({
    mutationFn: async (params) => {
      const result = await doubtService.assignDoubt(params);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to assign the teacher.');
      }
      return result.data!;
    },
    onSuccess: invalidate,
  });
}

/**
 * Academic admin archives a doubt (archive_doubt).
 * On success, invalidates all doubt lists + details.
 */
export function useArchiveDoubt() {
  const invalidate = useDoubtInvalidateAll();

  return useMutation<{ success: boolean; status: string }, Error, ArchiveDoubtInput>({
    mutationFn: async (params) => {
      const result = await doubtService.archiveDoubt(params);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to archive the doubt.');
      }
      return result.data!;
    },
    onSuccess: invalidate,
  });
}

/**
 * Uploads + records a doubt attachment (doubtAttachmentService →
 * attach_doubt_file). On success, invalidates the doubt detail so the new
 * attachment appears in the conversation.
 */
export function useAttachDoubtFile() {
  const queryClient = useQueryClient();

  return useMutation<
    {
      attachmentId: string;
      bucket: string;
      storagePath: string;
      mimeType: string;
      sizeBytes: number;
    },
    Error,
    {
      file: File | Blob;
      instituteId: string;
      doubtId: string;
      replyId?: string | null;
    }
  >({
    mutationFn: async (params) => {
      const result = await doubtAttachmentService.uploadDoubtAttachment(params);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to upload the attachment.');
      }
      return result.data!;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: doubtKeys.detail(vars.doubtId) });
    },
  });
}
