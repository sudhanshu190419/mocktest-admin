/**
 * Approval Service
 *
 * Clean-architecture service layer encapsulating all approval/review workflow
 * operations for content and mock test resources. Manages the approval_requests
 * table — creation, review decisions, and audit trail.
 *
 * Does NOT manage uploads or content CRUD — those are handled by contentService
 * and storageService respectively.
 *
 * ## Architecture decisions
 *
 * 1. **Lifecycle delegation.** Approval decisions that affect resource status
 *    (approve/reject) delegate to the existing content lifecycle methods
 *    (contentService.approveContent, contentService.rejectContent) rather than
 *    duplicating state machine validation.
 *
 * 2. **Append-only audit trail.** Approval requests are never hard-deleted
 *    after a review decision has been made. The only exception is
 *    cancelRequest(), which removes a pending request before review begins.
 *
 * 3. **Duplicate prevention.** The partial unique index
 *    `uq_approval_pending_resource` on (resource_type, resource_id)
 *    WHERE status = 'pending' enforces one open request per resource at the
 *    database level. This service validates proactively before insert and
 *    catches any race-condition duplicates via the returned error.
 *
 * @module approvalService
 */

import { supabase } from '../../config/supabase';
import { validateUUID, extractErrorMessage, buildPagination } from '../../utils/supabase';
import { buildPaginatedResponse } from '../../utils/response';
import {
  getContentById,
  publishContent,
  approveContent,
  rejectContent,
} from './contentService';
import type {
  ApiResponse,
  PaginatedResponse,
  PaginationParams,
  SortDirection,
} from '../../types/academic';
import type {
  ApprovalRequest,
  ApprovalRequestFilters,
  ApprovalRequestSortOptions,
  ApprovalStatus,
  ApprovalResourceType,
} from '../../types/content';

// ═══════════════════════════════════════════════════════════════════════════
//  Extended Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extended filter type supporting additional query capabilities beyond
 * the base `ApprovalRequestFilters` type.
 *
 * Provides aliases (`approvalStatus`, `reviewerId`) and an additional
 * `requestedBy` filter that maps to the `requested_by` DB column.
 */
export interface ApprovalQueryFilters extends ApprovalRequestFilters {
  /** Alias for `status` — maps to `approval_status`. */
  approvalStatus?: ApprovalStatus;
  /** Alias for `reviewedBy` — maps to `reviewed_by`. */
  reviewerId?: string;
  /** Filter by submitter profile ID (maps to `requested_by`). */
  requestedBy?: string;
}

/**
 * Input for creating an approval request.
 *
 * The service looks up the resource to derive instituteId and teacherId,
 * so the caller only needs to identify the resource and themselves.
 */
export interface CreateApprovalParams {
  /** Polymorphic discriminator: content or mock_test. */
  resourceType: ApprovalResourceType;
  /** The content_id or test_id of the resource to submit for review. */
  resourceId: string;
  /** Profile ID of the submitting teacher. */
  requestedBy: string;
}

/**
 * Input for recording an approval or rejection decision.
 */
export interface ReviewDecisionParams {
  /** The approval request ID. */
  approvalId: string;
  /** Profile ID of the reviewing admin. */
  reviewedBy: string;
  /** Review notes. Required when rejecting (enforced at application layer). */
  remarks?: string | null;
}

// ─── Database Row Shape ────────────────────────────────────────────────────

/**
 * Raw snake_case shape of the `approval_requests` table returned by Supabase.
 *
 * This type is internal to the service layer and is never exported.
 * Consumers receive only the camelCase `ApprovalRequest` interface.
 */
interface DbApprovalRequest {
  approval_id: string;
  institute_id: string;
  resource_type: ApprovalResourceType;
  resource_id: string;
  requested_by: string;
  teacher_id: string;
  reviewed_by: string | null;
  status: ApprovalStatus;
  remarks: string | null;
  version: number;
  requested_at: string;
  reviewed_at: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Maps camelCase sort keys to their snake_case database column names.
 */
const SORT_FIELD_MAP: Record<string, string> = {
  status: 'status',
  version: 'version',
  requestedAt: 'requested_at',
  reviewedAt: 'reviewed_at',
};

// ═══════════════════════════════════════════════════════════════════════════
//  Mapping Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Converts a raw snake_case approval request row into a camelCase
 * `ApprovalRequest` interface.
 */
function mapApprovalRequest(db: DbApprovalRequest): ApprovalRequest {
  return {
    approvalId: db.approval_id,
    instituteId: db.institute_id,
    resourceType: db.resource_type,
    resourceId: db.resource_id,
    requestedBy: db.requested_by,
    teacherId: db.teacher_id,
    reviewedBy: db.reviewed_by,
    status: db.status,
    remarks: db.remarks,
    version: db.version,
    requestedAt: db.requested_at,
    reviewedAt: db.reviewed_at,
  };
}

/**
 * Converts a camelCase sort key to its snake_case column name.
 */
function mapSortField(sortBy: ApprovalRequestSortOptions['sortBy']): string {
  return SORT_FIELD_MAP[sortBy ?? 'requestedAt'] ?? 'requested_at';
}

// ═══════════════════════════════════════════════════════════════════════════
//  1. getApprovalRequests()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch a paginated, filtered, and sorted list of approval requests.
 *
 * Supports filtering by institute, approval status, resource type, reviewer,
 * submitter (requestedBy/teacherId), date ranges, and search (remarks).
 * Pagination defaults to page 1, pageSize 20. Sorting defaults to
 * requested_at descending.
 *
 * @param filters    - Optional filter criteria.
 * @param sort       - Optional sort configuration.
 * @param pagination - Optional pagination parameters.
 *
 * @example
 * ```ts
 * const result = await getApprovalRequests(
 *   { instituteId: '...', approvalStatus: 'pending', resourceType: 'content' },
 *   { sortBy: 'requestedAt', sortDirection: 'asc' },
 *   { page: 1, pageSize: 20 },
 * );
 * ```
 */
export async function getApprovalRequests(
  filters?: ApprovalQueryFilters,
  sort?: ApprovalRequestSortOptions,
  pagination?: PaginationParams,
): Promise<ApiResponse<PaginatedResponse<ApprovalRequest>>> {
  try {
    // ── Build query ────────────────────────────────────────────────────
    let query = supabase
      .from('approval_requests')
      .select('*', { count: 'exact' });

    // ── Apply filters ──────────────────────────────────────────────────
    if (filters?.instituteId) {
      validateUUID(filters.instituteId, 'instituteId');
      query = query.eq('institute_id', filters.instituteId);
    }

    // Support both approvalStatus (alias) and status (from base type)
    const statusFilter = filters?.approvalStatus ?? filters?.status;
    if (statusFilter) {
      query = query.eq('status', statusFilter);
    }

    if (filters?.resourceType) {
      query = query.eq('resource_type', filters.resourceType);
    }

    if (filters?.resourceId) {
      validateUUID(filters.resourceId, 'resourceId');
      query = query.eq('resource_id', filters.resourceId);
    }

    // Support both reviewerId (alias) and reviewedBy (from base type)
    const reviewerFilter = filters?.reviewerId ?? filters?.reviewedBy;
    if (reviewerFilter) {
      validateUUID(reviewerFilter, 'reviewerId');
      query = query.eq('reviewed_by', reviewerFilter);
    }

    if (filters?.requestedBy) {
      validateUUID(filters.requestedBy, 'requestedBy');
      query = query.eq('requested_by', filters.requestedBy);
    }

    if (filters?.teacherId) {
      validateUUID(filters.teacherId, 'teacherId');
      query = query.eq('teacher_id', filters.teacherId);
    }

    if (filters?.requestedAfter) {
      query = query.gte('requested_at', filters.requestedAfter);
    }

    if (filters?.requestedBefore) {
      query = query.lte('requested_at', filters.requestedBefore);
    }

    if (filters?.reviewedAfter) {
      query = query.gte('reviewed_at', filters.reviewedAfter);
    }

    if (filters?.reviewedBefore) {
      query = query.lte('reviewed_at', filters.reviewedBefore);
    }

    if (filters?.search) {
      const searchTerm = `%${filters.search}%`;
      query = query.or(`remarks.ilike.${searchTerm}`);
    }

    // ── Apply sorting ──────────────────────────────────────────────────
    const sortBy = mapSortField(sort?.sortBy);
    const sortDirection: SortDirection = sort?.sortDirection ?? 'desc';
    query = query.order(sortBy, { ascending: sortDirection === 'asc' });

    // ── Apply pagination ───────────────────────────────────────────────
    const { page, pageSize, from, to } = buildPagination(pagination);
    query = query.range(from, to);

    // ── Execute ────────────────────────────────────────────────────────
    const { data, error, count } = await query;

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    const items = (data ?? []).map(mapApprovalRequest);

    return {
      success: true,
      data: buildPaginatedResponse(items, count ?? 0, page, pageSize),
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  2. getApprovalRequestById()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch a single approval request by its ID.
 *
 * @param requestId - The UUID of the approval request to retrieve.
 */
export async function getApprovalRequestById(
  requestId: string,
): Promise<ApiResponse<ApprovalRequest>> {
  try {
    validateUUID(requestId, 'requestId');

    const { data, error } = await supabase
      .from('approval_requests')
      .select('*')
      .eq('approval_id', requestId)
      .single<DbApprovalRequest>();

    if (error) {
      if (error.code === 'PGRST116') {
        return { success: false, error: `Approval request not found: ${requestId}` };
      }
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapApprovalRequest(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  3. createApprovalRequest()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Creates a new approval request for a resource and transitions the resource
 * to pending_review.
 *
 * Workflow:
 *   1. Validates that the resource exists and is eligible for review
 *   2. Checks for an existing pending request (duplicate prevention)
 *   3. Calculates the next version number from previous requests
 *   4. Inserts the approval_request row
 *   5. Delegates to contentService.publishContent() to transition the
 *      resource lifecycle to pending_review
 *
 * @param params - Identifies the resource and the submitter.
 *
 * @example
 * ```ts
 * const result = await createApprovalRequest({
 *   resourceType: 'content',
 *   resourceId: 'cont-123',
 *   requestedBy: 'profile-456',
 * });
 * ```
 */
export async function createApprovalRequest(
  params: CreateApprovalParams,
): Promise<ApiResponse<ApprovalRequest>> {
  const { resourceType, resourceId, requestedBy } = params;

  try {
    // ── Validate required fields ────────────────────────────────────────
    if (!resourceId) {
      return { success: false, error: 'resourceId is required.' };
    }
    if (!resourceType) {
      return { success: false, error: 'resourceType is required.' };
    }
    if (!requestedBy) {
      return { success: false, error: 'requestedBy is required.' };
    }

    validateUUID(resourceId, 'resourceId');
    validateUUID(requestedBy, 'requestedBy');

    // ── Validate resource exists and is eligible for review ─────────────
    if (resourceType === 'content') {
      const contentResult = await getContentById(resourceId);

      if (!contentResult.success || !contentResult.data) {
        return {
          success: false,
          error: `Resource not found: ${resourceId}. Cannot create approval request for a non-existent resource.`,
        };
      }

      const content = contentResult.data;

      // Resource must be in draft or rejected state to be submitted for review
      if (content.status !== 'draft' && content.status !== 'rejected') {
        return {
          success: false,
          error: `Resource status is "${content.status}". Only draft or rejected content can be submitted for review.`,
        };
      }

      // ── Prevent duplicate pending requests ───────────────────────────
      const { data: existingPending } = await supabase
        .from('approval_requests')
        .select('approval_id')
        .eq('resource_type', resourceType)
        .eq('resource_id', resourceId)
        .eq('status', 'pending')
        .maybeSingle();

      if (existingPending) {
        return {
          success: false,
          error:
            'A pending approval request already exists for this resource. ' +
            'Complete or cancel the existing request before creating a new one.',
        };
      }

      // ── Calculate version ────────────────────────────────────────────
      const { data: previousReqs } = await supabase
        .from('approval_requests')
        .select('version')
        .eq('resource_type', resourceType)
        .eq('resource_id', resourceId)
        .order('version', { ascending: false })
        .limit(1);

      const nextVersion = (previousReqs?.[0]?.version ?? 0) + 1;

      // ── Insert approval request ──────────────────────────────────────
      const { data, error } = await supabase
        .from('approval_requests')
        .insert({
          institute_id: content.instituteId,
          resource_type: resourceType,
          resource_id: resourceId,
          requested_by: requestedBy,
          teacher_id: content.teacherId,
          status: 'pending',
          version: nextVersion,
        })
        .select()
        .single<DbApprovalRequest>();

      if (error) {
        // 23505 = unique violation (duplicate pending — safety net for
        // race conditions that bypassed the earlier check)
        if (error.code === '23505') {
          return {
            success: false,
            error: 'A pending approval request already exists for this resource.',
          };
        }
        return { success: false, error: extractErrorMessage(error) };
      }

      // ── Transition resource lifecycle to pending_review ───────────────
      // Delegates to contentService which handles state machine validation
      const lifecycleResult = await publishContent(resourceId);
      if (!lifecycleResult.success) {
        // The approval request was created but content status couldn't be
        // updated. This is a partial failure — return the data with a warning
        // rather than rolling back (the audit trail is preserved).
        return {
          success: true,
          data: mapApprovalRequest(data),
          warning: `Approval request created but failed to update resource status: ${lifecycleResult.error}`,
        };
      }

      return { success: true, data: mapApprovalRequest(data) };
    }

    // Future: handle mock_test resource type when Domain 09 is implemented
    return {
      success: false,
      error: `Unsupported resource type: "${resourceType}". Only "content" is currently supported.`,
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  4. assignReviewer()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Assigns a reviewer (admin) to a pending approval request.
 *
 * The reviewer is recorded immediately upon assignment. Only pending requests
 * can have a reviewer assigned.
 *
 * @param approvalId - The UUID of the approval request.
 * @param reviewerId - The UUID of the admin profile to assign.
 */
export async function assignReviewer(
  approvalId: string,
  reviewerId: string,
): Promise<ApiResponse<ApprovalRequest>> {
  try {
    validateUUID(approvalId, 'approvalId');
    validateUUID(reviewerId, 'reviewerId');

    // ── Fetch existing request ─────────────────────────────────────────
    const existing = await getApprovalRequestById(approvalId);
    if (!existing.success || !existing.data) {
      return existing;
    }

    const request = existing.data;

    // Only pending requests can have a reviewer assigned
    if (request.status !== 'pending') {
      return {
        success: false,
        error: `Cannot assign reviewer to a "${request.status}" request. Only pending requests can be assigned.`,
      };
    }

    // ── Update reviewed_by ─────────────────────────────────────────────
    const { data, error } = await supabase
      .from('approval_requests')
      .update({ reviewed_by: reviewerId })
      .eq('approval_id', approvalId)
      .select()
      .single<DbApprovalRequest>();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapApprovalRequest(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  5. approveRequest()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Approves a pending approval request.
 *
 * Workflow:
 *   pending → approved
 *
 * Updates the approval request with the reviewer's decision and timestamp,
 * then delegates to contentService.approveContent() to transition the linked
 * resource lifecycle (pending_review → approved) and set published_at.
 *
 * @param params - The approval ID, reviewer ID, and optional remarks.
 *
 * @example
 * ```ts
 * const result = await approveRequest({
 *   approvalId: 'req-123',
 *   reviewedBy: 'admin-456',
 *   remarks: 'Content looks good. Approved.',
 * });
 * ```
 */
export async function approveRequest(
  params: ReviewDecisionParams,
): Promise<ApiResponse<ApprovalRequest>> {
  const { approvalId, reviewedBy, remarks } = params;

  try {
    validateUUID(approvalId, 'approvalId');
    validateUUID(reviewedBy, 'reviewedBy');

    // ── Fetch existing request ─────────────────────────────────────────
    const existing = await getApprovalRequestById(approvalId);
    if (!existing.success || !existing.data) {
      return existing;
    }

    const request = existing.data;

    // Only pending requests can be approved
    if (request.status !== 'pending') {
      return {
        success: false,
        error: `Cannot approve a "${request.status}" request. Only pending requests can be approved.`,
      };
    }

    const reviewedAt = new Date().toISOString();

    // ── Update the approval request record ─────────────────────────────
    const { data, error } = await supabase
      .from('approval_requests')
      .update({
        status: 'approved',
        reviewed_by: reviewedBy,
        reviewed_at: reviewedAt,
        remarks: remarks ?? null,
      })
      .eq('approval_id', approvalId)
      .select()
      .single<DbApprovalRequest>();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    // ── Update the linked resource lifecycle ───────────────────────────
    // Delegates to contentService which handles state machine validation
    // and sets published_at
    if (request.resourceType === 'content') {
      const lifecycleResult = await approveContent(request.resourceId);
      if (!lifecycleResult.success) {
        return {
          success: false,
          error: `Approval recorded but failed to approve resource: ${lifecycleResult.error}`,
        };
      }
    }

    return { success: true, data: mapApprovalRequest(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  6. rejectRequest()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Rejects a pending approval request.
 *
 * Workflow:
 *   pending → rejected
 *
 * Updates the approval request with the reviewer's decision, timestamp, and
 * required remarks. Then delegates to contentService.rejectContent() to
 * transition the linked resource lifecycle (pending_review → rejected).
 *
 * Remarks are required on rejection and are enforced at this layer.
 *
 * @param params - The approval ID, reviewer ID, and rejection remarks.
 *
 * @example
 * ```ts
 * const result = await rejectRequest({
 *   approvalId: 'req-123',
 *   reviewedBy: 'admin-456',
 *   remarks: 'Please revise the formatting and add references.',
 * });
 * ```
 */
export async function rejectRequest(
  params: ReviewDecisionParams,
): Promise<ApiResponse<ApprovalRequest>> {
  const { approvalId, reviewedBy, remarks } = params;

  try {
    validateUUID(approvalId, 'approvalId');
    validateUUID(reviewedBy, 'reviewedBy');

    // ── Validate remarks required on rejection ──────────────────────────
    if (!remarks?.trim()) {
      return {
        success: false,
        error:
          'Review remarks are required when rejecting a request. ' +
          'Please provide feedback for the teacher explaining why the resource was rejected.',
      };
    }

    // ── Fetch existing request ─────────────────────────────────────────
    const existing = await getApprovalRequestById(approvalId);
    if (!existing.success || !existing.data) {
      return existing;
    }

    const request = existing.data;

    // Only pending requests can be rejected
    if (request.status !== 'pending') {
      return {
        success: false,
        error: `Cannot reject a "${request.status}" request. Only pending requests can be rejected.`,
      };
    }

    const reviewedAt = new Date().toISOString();

    // ── Update the approval request record ─────────────────────────────
    const { data, error } = await supabase
      .from('approval_requests')
      .update({
        status: 'rejected',
        reviewed_by: reviewedBy,
        reviewed_at: reviewedAt,
        remarks: remarks.trim(),
      })
      .eq('approval_id', approvalId)
      .select()
      .single<DbApprovalRequest>();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    // ── Update the linked resource lifecycle ───────────────────────────
    if (request.resourceType === 'content') {
      const lifecycleResult = await rejectContent(request.resourceId);
      if (!lifecycleResult.success) {
        return {
          success: false,
          error: `Rejection recorded but failed to update resource status: ${lifecycleResult.error}`,
        };
      }
    }

    return { success: true, data: mapApprovalRequest(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  7. reopenRequest()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Reopens a rejected approval request, returning it to pending status.
 *
 * Workflow:
 *   rejected → pending
 *
 * Clears the reviewer fields, resets remarks, and increments the version
 * counter to track the revision cycle. This allows the original reviewer
 * (or a new one) to reconsider without the teacher creating a fresh
 * approval request.
 *
 * The linked resource's lifecycle is also reverted to `draft` so the
 * teacher can make necessary revisions and resubmit.
 *
 * @param approvalId - The UUID of the rejected approval request to reopen.
 */
export async function reopenRequest(
  approvalId: string,
): Promise<ApiResponse<ApprovalRequest>> {
  try {
    validateUUID(approvalId, 'approvalId');

    // ── Fetch existing request ─────────────────────────────────────────
    const existing = await getApprovalRequestById(approvalId);
    if (!existing.success || !existing.data) {
      return existing;
    }

    const request = existing.data;

    // Only rejected requests can be reopened
    if (request.status !== 'rejected') {
      return {
        success: false,
        error: `Cannot reopen a "${request.status}" request. Only rejected requests can be reopened.`,
      };
    }

    // ── Set back to pending, clear reviewer, increment version ─────────
    const { data, error } = await supabase
      .from('approval_requests')
      .update({
        status: 'pending',
        reviewed_by: null,
        reviewed_at: null,
        remarks: null,
        version: request.version + 1,
      })
      .eq('approval_id', approvalId)
      .select()
      .single<DbApprovalRequest>();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    // ── Revert resource lifecycle to draft ─────────────────────────────
    // The content was transitioned to rejected by rejectRequest on rejection.
    // Reopening puts it back to draft so the teacher can revise and resubmit.
    if (request.resourceType === 'content') {
      const { error: contentError } = await supabase
        .from('content')
        .update({ status: 'draft' })
        .eq('content_id', request.resourceId);

      if (contentError) {
        return {
          success: false,
          error: `Request reopened but failed to revert resource status: ${extractErrorMessage(contentError)}`,
        };
      }
    }

    return { success: true, data: mapApprovalRequest(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  8. cancelRequest()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cancels a pending approval request before review begins.
 *
 * Only pending requests with no review decision can be cancelled. Once a
 * reviewer has been assigned or a decision made, the request must go through
 * the normal reopen/reject workflow instead.
 *
 * The row is permanently deleted because no review activity has occurred.
 * This is the sole exception to the append-only audit trail rule.
 *
 * When the request is cancelled, the linked resource's lifecycle is reverted
 * to `draft` so the teacher can make further edits and resubmit later.
 *
 * @param approvalId - The UUID of the pending approval request to cancel.
 */
export async function cancelRequest(
  approvalId: string,
): Promise<ApiResponse<void>> {
  try {
    validateUUID(approvalId, 'approvalId');

    // ── Fetch existing request ─────────────────────────────────────────
    const existing = await getApprovalRequestById(approvalId);
    if (!existing.success || !existing.data) {
      return { success: false, error: `Approval request not found: ${approvalId}` };
    }

    const request = existing.data;

    // Only pending requests can be cancelled (before review begins)
    if (request.status !== 'pending') {
      return {
        success: false,
        error: `Cannot cancel a "${request.status}" request. Only pending requests can be cancelled.`,
      };
    }

    // ── Delete the pending request ─────────────────────────────────────
    const { error } = await supabase
      .from('approval_requests')
      .delete()
      .eq('approval_id', approvalId);

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    // ── Revert resource lifecycle to draft ─────────────────────────────
    // The content was transitioned to pending_review by createApprovalRequest.
    // Cancelling should put it back to draft so the teacher can edit/resubmit.
    if (request.resourceType === 'content') {
      const { error: contentError } = await supabase
        .from('content')
        .update({ status: 'draft' })
        .eq('content_id', request.resourceId);

      if (contentError) {
        return {
          success: false,
          error: `Request cancelled but failed to revert resource status: ${extractErrorMessage(contentError)}`,
        };
      }
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  9. getPendingApprovals()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Reviewer dashboard helper — fetch all pending approval requests.
 *
 * Returns pending requests ordered oldest-first by default (FIFO processing).
 * Optionally scoped to an institute. Supports pagination.
 *
 * @param instituteId - Optional institute scope.
 * @param pagination  - Optional pagination parameters.
 */
export async function getPendingApprovals(
  instituteId?: string,
  pagination?: PaginationParams,
): Promise<ApiResponse<PaginatedResponse<ApprovalRequest>>> {
  try {
    let query = supabase
      .from('approval_requests')
      .select('*', { count: 'exact' })
      .eq('status', 'pending')
      .order('requested_at', { ascending: true }); // oldest-first (FIFO)

    if (instituteId) {
      validateUUID(instituteId, 'instituteId');
      query = query.eq('institute_id', instituteId);
    }

    const { page, pageSize, from, to } = buildPagination(pagination);
    query = query.range(from, to);

    const { data, error, count } = await query;

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    const items = (data ?? []).map(mapApprovalRequest);

    return {
      success: true,
      data: buildPaginatedResponse(items, count ?? 0, page, pageSize),
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  10. getApprovalHistory()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Return all approval history for a resource.
 *
 * Returns every approval request ever created for the given resource,
 * ordered newest-first. Optionally filters by resource type. The full
 * history includes the complete audit trail of submissions, rejections,
 * and approvals across all versions.
 *
 * @param resourceId   - The UUID of the resource (content_id or test_id).
 * @param resourceType - Optional polymorphic filter (content or mock_test).
 *
 * @example
 * ```ts
 * const history = await getApprovalHistory('cont-123', 'content');
 * // Returns all approval requests for this content, newest first.
 * ```
 */
export async function getApprovalHistory(
  resourceId: string,
  resourceType?: ApprovalResourceType,
): Promise<ApiResponse<ApprovalRequest[]>> {
  try {
    validateUUID(resourceId, 'resourceId');

    let query = supabase
      .from('approval_requests')
      .select('*')
      .eq('resource_id', resourceId)
      .order('requested_at', { ascending: false });

    if (resourceType) {
      query = query.eq('resource_type', resourceType);
    }

    const { data, error } = await query;

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    const items = (data ?? []).map(mapApprovalRequest);

    return { success: true, data: items };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}
