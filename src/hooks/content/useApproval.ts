/**
 * Approval Hooks
 *
 * React Query hooks wrapping the approvalService API calls.
 * Provides cached queries and mutations with automatic cache invalidation,
 * covering the full review workflow — submission, assignment, decisions,
 * reopening, cancellation, and audit history.
 *
 * ## Exports
 *
 * | Hook                       | Type     | Description                                   |
 * |----------------------------|----------|-----------------------------------------------|
 * | `useApprovalRequests`      | Query    | Paginated, filterable approval request list   |
 * | `useApprovalRequest`       | Query    | Single approval request by ID                 |
 * | `usePendingApprovals`      | Query    | Reviewer dashboard — pending requests queue   |
 * | `useApprovalHistory`       | Query    | Full approval audit trail for a resource      |
 * | `useCreateApprovalRequest` | Mutation | Submit a resource for review                  |
 * | `useAssignReviewer`        | Mutation | Pre-assign an admin to a pending request      |
 * | `useApproveRequest`        | Mutation | Approve a pending request                     |
 * | `useRejectRequest`         | Mutation | Reject a pending request with remarks         |
 * | `useReopenRequest`         | Mutation | Reopen a rejected request                     |
 * | `useCancelRequest`         | Mutation | Cancel a pending request before review        |
 *
 * @module hooks/content/useApproval
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { contentKeys } from './queryKeys';
import {
  getApprovalRequests,
  getApprovalRequestById,
  getPendingApprovals,
  getApprovalHistory,
  createApprovalRequest,
  assignReviewer,
  approveRequest,
  rejectRequest,
  reopenRequest,
  cancelRequest,
} from '../../services/content/approvalService';
import type {
  ApprovalRequest,
  ApprovalRequestSortOptions,
  ApprovalResourceType,
  PaginatedResponse,
  PaginationParams,
} from '../../types/content';
import type {
  ApprovalQueryFilters,
  CreateApprovalParams,
  ReviewDecisionParams,
} from '../../services/content/approvalService';

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Fetch a paginated, filtered, and sorted list of approval requests.
 *
 * Supports filtering by institute, approval status, resource type, reviewer,
 * submitter, date ranges, and search (remarks). Pagination defaults to
 * page 1, pageSize 20.
 *
 * @param filters    - Optional filter criteria.
 * @param sort       - Optional sort configuration.
 * @param pagination - Optional pagination parameters.
 *
 * @example
 * const { data, isLoading } = useApprovalRequests(
 *   { instituteId: 'uuid', approvalStatus: 'pending', resourceType: 'content' },
 *   { sortBy: 'requestedAt', sortDirection: 'asc' },
 *   { page: 1, pageSize: 20 },
 * );
 */
export function useApprovalRequests(
  filters?: ApprovalQueryFilters,
  sort?: ApprovalRequestSortOptions,
  pagination?: PaginationParams,
) {
  return useQuery<PaginatedResponse<ApprovalRequest>>({
    queryKey: contentKeys.approvals.list(filters, sort, pagination),
    queryFn: async () => {
      const result = await getApprovalRequests(filters, sort, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch approval requests.');
      }
      return result.data!;
    },
  });
}

/**
 * Fetch a single approval request by its ID.
 *
 * The query is disabled when `requestId` is falsy.
 *
 * @param requestId - The UUID of the approval request to retrieve.
 */
export function useApprovalRequest(requestId: string | undefined | null) {
  return useQuery<ApprovalRequest>({
    queryKey: contentKeys.approvals.detail(requestId!),
    queryFn: async () => {
      const result = await getApprovalRequestById(requestId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch approval request.');
      }
      return result.data!;
    },
    enabled: !!requestId,
  });
}

/**
 * Reviewer dashboard helper — fetch all pending approval requests.
 *
 * Returns pending requests ordered oldest-first (FIFO processing).
 * Optionally scoped to an institute. Supports pagination.
 *
 * @param instituteId - Optional institute scope.
 * @param pagination  - Optional pagination parameters.
 *
 * @example
 * const { data: pendingRequests, isLoading } = usePendingApprovals(instituteId);
 */
export function usePendingApprovals(
  instituteId?: string,
  pagination?: PaginationParams,
) {
  return useQuery<PaginatedResponse<ApprovalRequest>>({
    queryKey: contentKeys.approvals.pendingList(instituteId, pagination),
    queryFn: async () => {
      const result = await getPendingApprovals(instituteId, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch pending approvals.');
      }
      return result.data!;
    },
  });
}

/**
 * Fetch the full approval audit trail for a resource.
 *
 * Returns every approval request for the given resource, ordered
 * newest-first. Optionally filters by resource type.
 *
 * @param resourceId   - The UUID of the resource.
 * @param resourceType - Optional polymorphic filter.
 *
 * @example
 * const { data: history } = useApprovalHistory('cont-123', 'content');
 */
export function useApprovalHistory(
  resourceId: string | undefined | null,
  resourceType?: ApprovalResourceType,
) {
  return useQuery<ApprovalRequest[]>({
    queryKey: contentKeys.approvals.historyList(resourceId!, resourceType),
    queryFn: async () => {
      const result = await getApprovalHistory(resourceId!, resourceType);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch approval history.');
      }
      return result.data!;
    },
    enabled: !!resourceId,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Submit a resource for review.
 *
 * Creates a pending approval request and transitions the resource lifecycle
 * to pending_review. Validates eligibility and prevents duplicate pending
 * requests.
 *
 * On success, invalidates both approval list queries and content list/detail
 * queries (since the content status changes to pending_review).
 *
 * @example
 * const { mutate, isPending } = useCreateApprovalRequest();
 * mutate({
 *   resourceType: 'content',
 *   resourceId: 'cont-123',
 *   requestedBy: 'profile-456',
 * });
 */
export function useCreateApprovalRequest() {
  const queryClient = useQueryClient();

  return useMutation<ApprovalRequest, Error, CreateApprovalParams>({
    mutationFn: async (params) => {
      const result = await createApprovalRequest(params);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to create approval request.');
      }
      return result.data!;
    },
    onSuccess: (_data, params) => {
      // Invalidate approval lists — new pending request appears
      queryClient.invalidateQueries({ queryKey: contentKeys.approvals.lists() });
      queryClient.invalidateQueries({ queryKey: contentKeys.approvals.pending() });

      // Invalidate content queries — status changed to pending_review
      queryClient.invalidateQueries({
        queryKey: contentKeys.contents.detail(params.resourceId),
      });
      queryClient.invalidateQueries({ queryKey: contentKeys.contents.lists() });
    },
  });
}

/**
 * Pre-assign an admin to a pending approval request.
 *
 * Only pending requests can have a reviewer assigned. The reviewer is
 * recorded immediately.
 *
 * On success, invalidates the affected detail query and all list queries.
 *
 * @example
 * const { mutate, isPending } = useAssignReviewer();
 * mutate({ approvalId: 'req-123', reviewerId: 'admin-456' });
 */
export function useAssignReviewer() {
  const queryClient = useQueryClient();

  return useMutation<ApprovalRequest, Error, { approvalId: string; reviewerId: string }>({
    mutationFn: async ({ approvalId, reviewerId }) => {
      const result = await assignReviewer(approvalId, reviewerId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to assign reviewer.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: contentKeys.approvals.detail(variables.approvalId),
      });
      queryClient.invalidateQueries({ queryKey: contentKeys.approvals.lists() });
      queryClient.invalidateQueries({ queryKey: contentKeys.approvals.pending() });
    },
  });
}

/**
 * Approve a pending approval request.
 *
 * Workflow: pending → approved. Delegates to the content lifecycle to
 * transition resource status (pending_review → approved) and set published_at.
 *
 * On success, invalidates approval queries and content queries (the resource
 * status changed).
 *
 * @example
 * const { mutate, isPending } = useApproveRequest();
 * mutate({
 *   approvalId: 'req-123',
 *   reviewedBy: 'admin-456',
 *   remarks: 'Looks good.',
 * });
 */
export function useApproveRequest() {
  const queryClient = useQueryClient();

  return useMutation<ApprovalRequest, Error, ReviewDecisionParams>({
    mutationFn: async (params) => {
      const result = await approveRequest(params);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to approve request.');
      }
      return result.data!;
    },
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({
        queryKey: contentKeys.approvals.detail(params.approvalId),
      });
      queryClient.invalidateQueries({ queryKey: contentKeys.approvals.lists() });
      queryClient.invalidateQueries({ queryKey: contentKeys.approvals.pending() });
      queryClient.invalidateQueries({ queryKey: contentKeys.contents.lists() });
    },
  });
}

/**
 * Reject a pending approval request with review remarks.
 *
 * Workflow: pending → rejected. Remarks are required and enforced at the
 * service layer. Delegates to the content lifecycle to transition resource
 * status (pending_review → rejected).
 *
 * On success, invalidates approval and content queries.
 *
 * @example
 * const { mutate, isPending } = useRejectRequest();
 * mutate({
 *   approvalId: 'req-123',
 *   reviewedBy: 'admin-456',
 *   remarks: 'Please add references and resubmit.',
 * });
 */
export function useRejectRequest() {
  const queryClient = useQueryClient();

  return useMutation<ApprovalRequest, Error, ReviewDecisionParams>({
    mutationFn: async (params) => {
      const result = await rejectRequest(params);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to reject request.');
      }
      return result.data!;
    },
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({
        queryKey: contentKeys.approvals.detail(params.approvalId),
      });
      queryClient.invalidateQueries({ queryKey: contentKeys.approvals.lists() });
      queryClient.invalidateQueries({ queryKey: contentKeys.approvals.pending() });
      queryClient.invalidateQueries({ queryKey: contentKeys.contents.lists() });
    },
  });
}

/**
 * Reopen a rejected approval request, returning it to pending status.
 *
 * Workflow: rejected → pending. Clears reviewer fields and increments the
 * version counter. The linked resource lifecycle is also reverted to draft.
 *
 * On success, invalidates approval queries and content queries (the resource
 * status changed to draft).
 *
 * @example
 * const { mutate, isPending } = useReopenRequest();
 * mutate(approvalId);
 */
export function useReopenRequest() {
  const queryClient = useQueryClient();

  return useMutation<ApprovalRequest, Error, string>({
    mutationFn: async (approvalId) => {
      const result = await reopenRequest(approvalId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to reopen request.');
      }
      return result.data!;
    },
    onSuccess: (_data, approvalId) => {
      queryClient.invalidateQueries({
        queryKey: contentKeys.approvals.detail(approvalId),
      });
      queryClient.invalidateQueries({ queryKey: contentKeys.approvals.lists() });
      queryClient.invalidateQueries({ queryKey: contentKeys.approvals.pending() });
      queryClient.invalidateQueries({ queryKey: contentKeys.contents.lists() });
    },
  });
}

/**
 * Cancel a pending approval request before review begins.
 *
 * Only pending requests can be cancelled. The request row is deleted and
 * the linked resource lifecycle is reverted to draft so the teacher can
 * revise and resubmit.
 *
 * On success, removes the detail cache, invalidates approval lists, and
 * invalidates content queries.
 *
 * @example
 * const { mutate, isPending } = useCancelRequest();
 * mutate(approvalId);
 */
export function useCancelRequest() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (approvalId) => {
      const result = await cancelRequest(approvalId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to cancel request.');
      }
    },
    onSuccess: (_data, approvalId) => {
      queryClient.removeQueries({
        queryKey: contentKeys.approvals.detail(approvalId),
      });
      queryClient.invalidateQueries({ queryKey: contentKeys.approvals.lists() });
      queryClient.invalidateQueries({ queryKey: contentKeys.approvals.pending() });
      queryClient.invalidateQueries({ queryKey: contentKeys.contents.lists() });
    },
  });
}
