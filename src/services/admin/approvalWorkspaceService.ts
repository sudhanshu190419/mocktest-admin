/**
 * Approval Workspace Service
 *
 * Lightweight dashboard aggregation for the centralized Approval Workspace.
 *
 * This is NOT a CRUD or approval service — approval decisions remain in the
 * existing per-module services (questionApprovalService,
 * mockTestManagementService, courseManagementService, contentService,
 * approvalService). This service only aggregates lightweight read-only
 * statistics for the workspace landing page:
 *
 *   - Pending counts per resource type (questions / mock tests / content)
 *   - Approved / rejected counts for today and this week
 *
 * ## Data sources
 *
 *   - questions.status = 'pending_approval'           → pending questions
 *   - mock_tests.status = 'pending_approval'          → pending mock tests
 *   - content.status = 'pending_review'               → pending content
 *   - questions.approved_at / mock_tests.published_at /
 *     content.published_at                            → approved windows
 *   - approval_requests.status = 'rejected' AND
 *     reviewed_at >= window                           → rejected windows
 *
 * ## Scope note
 *
 * "Rejected" windows are sourced from `approval_requests.reviewed_at`
 * (the audit trail). Question/mock-test rejections revert status directly
 * and do not carry a rejection timestamp, so today/week rejection counts
 * reflect content approvals (the only flow with a timestamped rejection
 * trail today). A full cross-resource audit trail is a future phase.
 *
 * @module services/admin/approvalWorkspaceService
 */

import { supabase } from '@/config/supabase';
import { extractErrorMessage } from '@/utils/supabase';
import type { ApiResponse } from '@/types/academic';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

/** Aggregated statistics for the Approval Workspace landing page. */
export interface ApprovalWorkspaceStats {
  /** Questions awaiting review (status = pending_approval). */
  pendingQuestions: number;
  /** Mock tests awaiting review (status = pending_approval). */
  pendingMockTests: number;
  /** Content awaiting review (status = pending_review). */
  pendingContent: number;
  /** Sum of all pending counts. */
  totalPending: number;
  /** Resources approved since the start of today. */
  approvedToday: number;
  /** Resources approved since the start of this week (Monday). */
  approvedThisWeek: number;
  /** Approval requests rejected since the start of today. */
  rejectedToday: number;
  /** Approval requests rejected since the start of this week (Monday). */
  rejectedThisWeek: number;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** ISO timestamp for the start of the current day (local time). */
function startOfDay(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** ISO timestamp for the start of the current week (Monday, local time). */
function startOfWeek(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day; // shift back to Monday
  d.setDate(d.getDate() + diff);
  return d.toISOString();
}

// ═══════════════════════════════════════════════════════════════════════════
//  Service
// ═══════════════════════════════════════════════════════════════════════════

export const approvalWorkspaceService = {
  /**
   * Fetch aggregated Approval Workspace statistics for an institute.
   *
   * All count queries run in parallel (head-only, exact counts) and are
   * institute-scoped when `instituteId` is provided.
   *
   * @param instituteId - Optional institute scope.
   */
  async getStats(
    instituteId?: string | null,
  ): Promise<ApiResponse<ApprovalWorkspaceStats>> {
    try {
      // Institute scope helper (no-op when instituteId is absent)
      const scope = (q: any) => (instituteId ? q.eq('institute_id', instituteId) : q);
      const countOf = (res: { count: number | null } | null): number => res?.count ?? 0;

      const today = startOfDay();
      const week = startOfWeek();

      const [
        pendingQuestionsRes,
        pendingMockTestsRes,
        pendingContentRes,
        approvedTodayQuestions,
        approvedTodayMockTests,
        approvedTodayContent,
        approvedWeekQuestions,
        approvedWeekMockTests,
        approvedWeekContent,
        rejectedTodayRes,
        rejectedWeekRes,
      ] = await Promise.all([
        // ── Pending counts ──────────────────────────────────────────────
        scope(
          supabase
            .from('questions')
            .select('question_id', { count: 'exact', head: true })
            .eq('status', 'pending_approval'),
        ),
        scope(
          supabase
            .from('mock_tests')
            .select('test_id', { count: 'exact', head: true })
            .eq('status', 'pending_approval'),
        ),
        scope(
          supabase
            .from('content')
            .select('content_id', { count: 'exact', head: true })
            .eq('status', 'pending_review'),
        ),

        // ── Approved today (across the three resource tables) ──────────
        scope(
          supabase
            .from('questions')
            .select('question_id', { count: 'exact', head: true })
            .eq('status', 'published')
            .gte('approved_at', today),
        ),
        scope(
          supabase
            .from('mock_tests')
            .select('test_id', { count: 'exact', head: true })
            .eq('status', 'published')
            .gte('published_at', today),
        ),
        scope(
          supabase
            .from('content')
            .select('content_id', { count: 'exact', head: true })
            .eq('status', 'approved')
            .gte('published_at', today),
        ),

        // ── Approved this week ─────────────────────────────────────────
        scope(
          supabase
            .from('questions')
            .select('question_id', { count: 'exact', head: true })
            .eq('status', 'published')
            .gte('approved_at', week),
        ),
        scope(
          supabase
            .from('mock_tests')
            .select('test_id', { count: 'exact', head: true })
            .eq('status', 'published')
            .gte('published_at', week),
        ),
        scope(
          supabase
            .from('content')
            .select('content_id', { count: 'exact', head: true })
            .eq('status', 'approved')
            .gte('published_at', week),
        ),

        // ── Rejected windows (approval_requests audit trail) ───────────
        scope(
          supabase
            .from('approval_requests')
            .select('approval_id', { count: 'exact', head: true })
            .eq('status', 'rejected')
            .gte('reviewed_at', today),
        ),
        scope(
          supabase
            .from('approval_requests')
            .select('approval_id', { count: 'exact', head: true })
            .eq('status', 'rejected')
            .gte('reviewed_at', week),
        ),
      ]);

      const pendingQuestions = countOf(pendingQuestionsRes);
      const pendingMockTests = countOf(pendingMockTestsRes);
      const pendingContent = countOf(pendingContentRes);

      return {
        success: true,
        data: {
          pendingQuestions,
          pendingMockTests,
          pendingContent,
          totalPending: pendingQuestions + pendingMockTests + pendingContent,
          approvedToday:
            countOf(approvedTodayQuestions) +
            countOf(approvedTodayMockTests) +
            countOf(approvedTodayContent),
          approvedThisWeek:
            countOf(approvedWeekQuestions) +
            countOf(approvedWeekMockTests) +
            countOf(approvedWeekContent),
          rejectedToday: countOf(rejectedTodayRes),
          rejectedThisWeek: countOf(rejectedWeekRes),
        },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },
};
