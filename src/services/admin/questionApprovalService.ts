/**
 * Question Approval Management Service
 *
 * Single source of truth for all question approval operations in the
 * Admin Question Approval module.
 *
 * Every public method returns a standardised `ApiResponse<T>` shape.
 * Follows the exact same architecture as `teacherLifecycleService.ts`.
 *
 * ## Scope
 *
 * This service manages the approval lifecycle of questions via the
 * `questions.status` column.  It does NOT manage:
 * - Question creation or editing (handled by questionService)
 * - Question bank browsing (handled by questionService)
 * - Option or image management (handled by option/image services)
 *
 * ## Status Transitions
 *
 * ```
 *                  ┌──────────────┐
 *                  │ pending_     │
 *                  │ approval     │
 *                  └──────┬───────┘
 *              ┌──────────┴──────────┐
 *              ▼                     ▼
 *         ┌──────────┐         ┌──────────┐
 *         │ published │         │ draft    │
 *         │ (approved)│         │ (rejected)│
 *         └─────┬─────┘         └──────────┘
 *               ▼
 *         ┌──────────┐
 *         │ archived │
 *         └──────────┘
 *               ▼
 *         ┌──────────┐
 *         │ published│  (restore)
 *         └──────────┘
 * ```
 *
 * @module services/admin/questionApprovalService
 */

import { supabase } from '@/config/supabase';
import { extractErrorMessage } from '@/utils/supabase';
import { buildPaginatedResponse } from '@/utils/response';
import type { ApiResponse, PaginatedResponse, PaginationParams, SortDirection } from '@/types/academic';
import type { QuestionStatus } from '@/types/mockTest';
import { canApproveAcademicResources, approvalPermissionDenied } from './approvalGuard';
import { auditService } from '@/services/audit/auditService';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

/** Approval dashboard counts grouped by question status. */
export interface QuestionApprovalCounts {
  /** Questions submitted by teachers, awaiting admin review (status = 'pending_approval'). */
  pendingApproval: number;
  /** Questions that have been approved and published (status = 'published'). */
  approved: number;
  /**
   * Questions currently in draft status.
   *
   * NOTE: The `questions` table uses `status = 'draft'` for both new
   * questions and rejected questions (the reject transition sets status
   * back to 'draft' and clears approval metadata).  There is no dedicated
   * "rejected" status in the `question_status` enum, so this count
   * includes ALL draft questions, not only those that were rejected.
   */
  rejected: number;
  /** Questions that have been published (status = 'published'). Same as `approved`. */
  published: number;
  /** Questions that have been archived (status = 'archived'). */
  archived: number;
}

/** A single question row in the approval list. */
export interface QuestionApprovalListItem {
  questionId: string;
  questionText: string;
  questionType: string;
  difficulty: string;
  status: string;
  subjectId: string;
  subjectName: string | null;
  chapterId: string;
  chapterName: string | null;
  createdBy: string;
  teacherName: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
}

/** Teacher info embedded in the question detail. */
export interface ApprovalTeacherInfo {
  teacherId: string | null;
  name: string | null;
  email: string | null;
}

/** Approval metadata embedded in the question detail. */
export interface ApprovalMetadata {
  approvedBy: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
}

/** Option image info in the approval detail. */
export interface ApprovalOptionImageInfo {
  optionImageId: string;
  storageBucket: string;
  storagePath: string;
  altText: string | null;
  displayOrder: number;
}

/** Option with images in the approval detail. */
export interface ApprovalQuestionOption {
  optionId: string;
  optionText: string;
  isCorrect: boolean;
  orderSequence: number;
  createdAt: string;
  images: ApprovalOptionImageInfo[];
}

/** Stem/explanation image info in the approval detail. */
export interface ApprovalQuestionImage {
  imageId: string;
  storageBucket: string;
  storagePath: string;
  imageRole: string;
  altText: string | null;
  orderSequence: number;
}

/** Explanation info in the approval detail. */
export interface ApprovalQuestionExplanation {
  explanationId: string;
  explanationText: string | null;
  explanationVideoUrl: string | null;
  correctNumericalAnswer: number | null;
  numericalTolerance: number | null;
}

/** Full question detail for the approval detail view. */
export interface QuestionApprovalDetail {
  questionId: string;
  questionText: string;
  questionType: string;
  difficulty: string;
  status: string;
  marks: number;
  negativeMarks: number;
  version: number;
  subjectId: string;
  subjectName: string | null;
  chapterId: string;
  chapterName: string | null;
  createdBy: string;
  teacher: ApprovalTeacherInfo;
  options: ApprovalQuestionOption[];
  images: ApprovalQuestionImage[];
  explanation: ApprovalQuestionExplanation | null;
  approvalMetadata: ApprovalMetadata;
  createdAt: string;
  updatedAt: string;
}

/** Statistics for the question approval dashboard. */
export interface QuestionApprovalStats {
  /** Count of questions grouped by subject. */
  bySubject: { subjectId: string; subjectName: string; count: number }[];
  /** Count of pending-approval questions grouped by subject. */
  pendingBySubject: { subjectId: string; subjectName: string; count: number }[];
  /** Most recently submitted questions (last 10). */
  recentlySubmitted: QuestionApprovalListItem[];
  /** Most recently approved questions (last 10). */
  recentlyApproved: QuestionApprovalListItem[];
}

/** Filters for the question approval list query. */
export interface QuestionApprovalListFilters {
  instituteId?: string;
  /** Filter by question status. */
  status?: string;
  /** Filter by subject ID. */
  subjectId?: string;
  /** Filter by chapter ID. */
  chapterId?: string;
  /** Filter by class/stream ID. */
  classId?: string;
  /** Filter by teacher profile ID. */
  teacherId?: string;
  /** Search across question text (case-insensitive). */
  search?: string;
}

/** Sort options for the question approval list query. */
export interface QuestionApprovalListSortOptions {
  sortBy?: 'createdAt' | 'updatedAt' | 'questionType' | 'difficulty' | 'status' | 'approvedAt';
  sortDirection?: SortDirection;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

const SORT_FIELD_MAP: Record<string, string> = {
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  questionType: 'question_type',
  difficulty: 'difficulty',
  status: 'status',
  approvedAt: 'approved_at',
};

const VALID_QUESTION_STATUSES: ReadonlyArray<QuestionStatus> = [
  'draft',
  'pending_approval',
  'published',
  'archived',
] as const;

/** Valid status transitions for question approval. */
function isValidTransition(currentStatus: string, nextStatus: string): boolean {
  // pending_approval → published (approve)
  // pending_approval → draft (reject)
  // published → archived (archive)
  // archived → published (restore)
  if (currentStatus === 'pending_approval' && nextStatus === 'published') return true;
  if (currentStatus === 'pending_approval' && nextStatus === 'draft') return true;
  if (currentStatus === 'published' && nextStatus === 'archived') return true;
  if (currentStatus === 'archived' && nextStatus === 'published') return true;
  return false;
}

/**
 * Maps a question approval status transition to an audit action.
 *
 * Used so every approval decision writes a single audit event with the
 * correct semantic action (approve / reject / restore / archive). Falls
 * back to `update` for any unrecognised transition (defensive).
 *
 * @param currentStatus - Status BEFORE the transition (may be undefined for bulk ops).
 * @param newStatus     - Status AFTER the transition.
 */
function mapQuestionTransitionAction(
  currentStatus: string | undefined,
  newStatus: string,
): import('@/types/audit').AuditAction {
  if (currentStatus === 'pending_approval' && newStatus === 'published') return 'approve';
  if (currentStatus === 'pending_approval' && newStatus === 'draft') return 'reject';
  if (currentStatus === 'archived' && newStatus === 'published') return 'restore';
  if (newStatus === 'published') return 'approve';
  if (newStatus === 'draft') return 'reject';
  if (newStatus === 'archived') return 'archive';
  return 'update';
}

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function mapSortField(sortBy?: QuestionApprovalListSortOptions['sortBy']): string {
  return SORT_FIELD_MAP[sortBy ?? 'createdAt'] ?? 'created_at';
}

/** Maps a raw Supabase row from the approval list query to QuestionApprovalListItem. */
function toApprovalListItem(row: any): QuestionApprovalListItem {
  return {
    questionId: row.question_id,
    questionText: row.question_text,
    questionType: row.question_type,
    difficulty: row.difficulty,
    status: row.status,
    subjectId: row.subject_id,
    subjectName: row.subjects?.name ?? null,
    chapterId: row.chapter_id,
    chapterName: row.chapters?.name ?? null,
    createdBy: row.created_by,
    teacherName: row.profiles?.name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at ?? null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Service
// ═══════════════════════════════════════════════════════════════════════════

export const questionApprovalService = {
  // ─────────────────────────────────────────────────────────────────────────
  //  1. Dashboard Counts
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get question approval dashboard counts grouped by status.
   *
   * NOTE: The `rejected` count uses `status = 'draft'` as the best
   * approximation.  The `question_status` enum does not have a dedicated
   * "rejected" value — rejection transitions a question back to `draft`
   * and clears approval metadata.  This means the `rejected` count
   * includes ALL draft questions, not only those that were rejected
   * after submission.  If a more precise rejected count is needed in
   * the future, add a `rejected_at` or `rejected_by` column to the
   * `questions` table or introduce a `rejected` status in the enum.
   */
  async getCounts(instituteId?: string | null): Promise<ApiResponse<QuestionApprovalCounts>> {
    try {
      const makeQuery = (status: string) => {
        let q = supabase
          .from('questions')
          .select('question_id', { count: 'exact', head: true })
          .eq('status', status);
        if (instituteId) {
          q = q.eq('institute_id', instituteId);
        }
        return q;
      };

      const [pendingApproval, published, draft, archived] = await Promise.all([
        makeQuery('pending_approval'),
        makeQuery('published'),
        makeQuery('draft'),
        makeQuery('archived'),
      ]);

      const counts: QuestionApprovalCounts = {
        pendingApproval: pendingApproval.count ?? 0,
        approved: published.count ?? 0,
        rejected: draft.count ?? 0,
        published: published.count ?? 0,
        archived: archived.count ?? 0,
      };

      return { success: true, data: counts };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  2. Question Approval List
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a paginated, filtered, and sorted list of questions for approval.
   *
   * Joins `questions` with `subjects`, `chapters`, and `profiles` (left
   * joins) to include display names.  Supports search, status filter,
   * subject filter, chapter filter, teacher filter, pagination, and sorting.
   */
  async getList(
    filters?: QuestionApprovalListFilters,
    sort?: QuestionApprovalListSortOptions,
    pagination?: PaginationParams,
  ): Promise<ApiResponse<PaginatedResponse<QuestionApprovalListItem>>> {
    try {
      let query = supabase
        .from('questions')
        .select(
          `\n          question_id,\n          question_text,\n          question_type,\n          difficulty,\n          status,\n          subject_id,\n          chapter_id,\n          created_by,\n          marks,\n          negative_marks,\n          version,\n          created_at,\n          updated_at,\n          approved_at,\n          subjects!left ( name ),\n          chapters!left ( name )\n        `,
          { count: 'exact' },
        );

      // ── Filters ─────────────────────────────────────────────────────
      if (filters?.instituteId) {
        query = query.eq('institute_id', filters.instituteId);
      }

      if (filters?.status) {
        const statuses = filters.status.split(',').map((s) => s.trim());
        if (statuses.length === 1) {
          query = query.eq('status', statuses[0]);
        } else {
          query = query.in('status', statuses);
        }
      }

      if (filters?.subjectId) {
        query = query.eq('subject_id', filters.subjectId);
      }

      if (filters?.chapterId) {
        query = query.eq('chapter_id', filters.chapterId);
      }

      if (filters?.teacherId) {
        // created_by stores teacher_details.teacher_id — filter by that
        query = query.eq('created_by', filters.teacherId);
      }

      // TODO: implement classId filter
      // The `questions` table has no direct `class_id` column. To filter by
      // class, join through `subjects` (class → subject mapping) or add a
      // dedicated column on `questions`. This requires additional schema analysis.
      // if (filters?.classId) { ... }

      if (filters?.search) {
        const term = `%${filters.search}%`;
        query = query.ilike('question_text', term);
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

      // Initialise items — teacher name is populated below via batch resolution
      const items = (data ?? []).map(toApprovalListItem);

      // Batch-resolve teacher names from created_by IDs
      // created_by references teacher_details.teacher_id, not profiles.profile_id,
      // so we resolve through teacher_details → profiles in a second pass.
      const distinctTeacherIds = [...new Set(items.map((i) => i.createdBy).filter(Boolean))];

      if (distinctTeacherIds.length > 0) {
        // teacher_details has profile_id → join to profiles.name
        const { data: teacherNameData } = await supabase
          .from('teacher_details')
          .select(
            `\n            teacher_id,\n            profiles!inner ( name )\n          `,
          )
          .in('teacher_id', distinctTeacherIds);

        if (teacherNameData) {
          const nameMap = new Map<string, string | null>();
          for (const td of teacherNameData) {
            const p = (td as any).profiles;
            nameMap.set(td.teacher_id, p?.name ?? null);
          }

          // Apply resolved names
          for (const item of items) {
            item.teacherName = nameMap.get(item.createdBy) ?? item.teacherName;
          }
        }
      }

      return {
        success: true,
        data: buildPaginatedResponse(items, count ?? 0, page, pageSize),
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  3. Question Detail
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the full question detail for the approval review view.
   *
   * Returns the question with its options, stem images, option images,
   * explanation, teacher information, and approval metadata — everything
   * an admin needs to review and approve/reject a question.
   */
  async getDetail(questionId: string): Promise<ApiResponse<QuestionApprovalDetail>> {
    try {
      // 1. Fetch the question with subject and chapter names
      const { data: question, error: qErr } = await supabase
        .from('questions')
        .select(
          `\n          *,\n          subjects!left ( name ),\n          chapters!left ( name )\n        `,
        )
        .eq('question_id', questionId)
        .single();

      if (qErr) {
        if (qErr.code === 'PGRST116') {
          return { success: false, error: `Question not found: ${questionId}` };
        }
        return { success: false, error: extractErrorMessage(qErr) };
      }

      // 2. Fetch related data in parallel
      const [optionsRes, imagesRes, explanationRes, teacherRes, approverRes] =
        await Promise.allSettled([
          // Options with images
          fetchOptionsWithImages(questionId),

          // Stem/explanation images
          supabase
            .from('question_images')
            .select('*')
            .eq('question_id', questionId)
            .order('order_sequence', { ascending: true }),

          // Explanation
          supabase
            .from('question_explanations')
            .select('*')
            .eq('question_id', questionId)
            .maybeSingle(),

          // Teacher info (created_by → teacher_details → profiles)
          resolveTeacherInfo(question.created_by),

          // Approver info (approved_by → profiles)
          question.approved_by
            ? supabase
                .from('profiles')
                .select('profile_id, name, email')
                .eq('profile_id', question.approved_by)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        ]);

      const options =
        optionsRes.status === 'fulfilled' ? optionsRes.value : [];
      const images =
        imagesRes.status === 'fulfilled' ? (imagesRes.value.data ?? []) : [];
      const explanationData =
        explanationRes.status === 'fulfilled'
          ? (explanationRes.value as any)?.data ?? null
          : null;
      const teacherInfo =
        teacherRes.status === 'fulfilled' ? teacherRes.value : null;
      const approverData =
        approverRes.status === 'fulfilled' ? (approverRes.value as any)?.data ?? null : null;

      // Map stem images
      const mappedImages: ApprovalQuestionImage[] = (images ?? []).map((img: any) => ({
        imageId: img.image_id,
        storageBucket: img.storage_bucket,
        storagePath: img.storage_path,
        imageRole: img.image_role,
        altText: img.alt_text,
        orderSequence: img.order_sequence,
      }));

      // Map explanation
      const explanation: ApprovalQuestionExplanation | null = explanationData
        ? {
            explanationId: explanationData.explanation_id,
            explanationText: explanationData.explanation_text,
            explanationVideoUrl: explanationData.explanation_video_url,
            correctNumericalAnswer: explanationData.correct_numerical_answer,
            numericalTolerance: explanationData.numerical_tolerance,
          }
        : null;

      // Build the detail
      const detail: QuestionApprovalDetail = {
        questionId: question.question_id,
        questionText: question.question_text,
        questionType: question.question_type,
        difficulty: question.difficulty,
        status: question.status,
        marks: question.marks,
        negativeMarks: question.negative_marks,
        version: question.version,
        subjectId: question.subject_id,
        subjectName: question.subjects?.name ?? null,
        chapterId: question.chapter_id,
        chapterName: question.chapters?.name ?? null,
        createdBy: question.created_by,
        teacher: {
          teacherId: teacherInfo?.teacherId ?? null,
          name: teacherInfo?.name ?? null,
          email: teacherInfo?.email ?? null,
        },
        options,
        images: mappedImages,
        explanation,
        approvalMetadata: {
          approvedBy: question.approved_by ?? null,
          approvedAt: question.approved_at ?? null,
          approvedByName: approverData?.name ?? null,
        },
        createdAt: question.created_at,
        updatedAt: question.updated_at,
      };

      return { success: true, data: detail };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  4–7. Status Mutations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Update a question's status with approval metadata.
   *
   * All single-question approval mutations (approve, reject, publish,
   * archive) funnel through this internal pipeline which validates the
   * state machine and sets/clears approval metadata as appropriate.
   */
  async updateStatus(
    questionId: string,
    newStatus: QuestionStatus,
    approvedBy?: string | null,
  ): Promise<ApiResponse<null>> {
    try {
      // ── Authorization: only super/academic admins may approve ──────────
      if (!(await canApproveAcademicResources())) {
        return approvalPermissionDenied();
      }

      // 1. Fetch current question to validate transition
      const { data: current, error: fetchErr } = await supabase
        .from('questions')
        .select('status, approved_at, approved_by')
        .eq('question_id', questionId)
        .single();

      if (fetchErr) {
        if (fetchErr.code === 'PGRST116') {
          return { success: false, error: `Question not found: ${questionId}` };
        }
        return { success: false, error: extractErrorMessage(fetchErr) };
      }

      // 2. Validate transition
      if (!isValidTransition(current.status, newStatus)) {
        return {
          success: false,
          error: `Invalid status transition: "${current.status}" → "${newStatus}".`,
        };
      }

      // 3. Build update payload with approval metadata
      const dbUpdate: Record<string, unknown> = { status: newStatus };

      if (newStatus === 'published' && current.status !== 'archived') {
        // Approve: set approved_by and approved_at (not for restore from archived)
        dbUpdate.approved_by = approvedBy ?? null;
        dbUpdate.approved_at = new Date().toISOString();
      } else if (newStatus === 'draft' && current.status === 'pending_approval') {
        // Reject: clear approval metadata
        dbUpdate.approved_by = null;
        dbUpdate.approved_at = null;
      }
      // For archive (published → archived) and restore (archived → published),
      // preserve existing approval metadata

      const { error } = await supabase
        .from('questions')
        .update(dbUpdate)
        .eq('question_id', questionId);

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      // ── Audit: question approval decision ────────────────────────────
      await auditService.log({
        action: mapQuestionTransitionAction(current.status, newStatus),
        resourceType: 'questions',
        resourceId: questionId,
        oldValue: { status: current.status },
        newValue: { status: newStatus },
        metadata: { questionId, previousStatus: current.status, newStatus },
      });

      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  /**
   * Approve a pending question (pending_approval → published).
   *
   * Sets `approved_by` and `approved_at` to the current time and admin.
   */
  async approve(questionId: string, approvedBy?: string | null): Promise<ApiResponse<null>> {
    return this.updateStatus(questionId, 'published', approvedBy);
  },

  /**
   * Reject a pending question (pending_approval → draft).
   *
   * Clears `approved_by` and `approved_at`.
   */
  async reject(questionId: string): Promise<ApiResponse<null>> {
    return this.updateStatus(questionId, 'draft');
  },

  /**
   * Publish a pending question (pending_approval → published).
   *
   * Alias for `approve()`. Sets approval metadata.
   */
  async publish(questionId: string, approvedBy?: string | null): Promise<ApiResponse<null>> {
    return this.updateStatus(questionId, 'published', approvedBy);
  },

  /**
   * Archive a published question (published → archived).
   *
   * Preserves existing approval metadata for audit trail.
   */
  async archive(questionId: string): Promise<ApiResponse<null>> {
    return this.updateStatus(questionId, 'archived');
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  8–11. Bulk Operations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Bulk-update the status for multiple questions.
   *
   * @param questionIds - Array of `questions.question_id` values.
   * @param newStatus   - The target question_status.
   * @param approvedBy  - Admin profile ID (required when publishing).
   */
  async bulkUpdateStatus(
    questionIds: string[],
    newStatus: QuestionStatus,
    approvedBy?: string | null,
  ): Promise<ApiResponse<{ updatedCount: number }>> {
    try {
      // ── Authorization: only super/academic admins may approve ──────────
      if (!(await canApproveAcademicResources())) {
        return approvalPermissionDenied();
      }

      if (questionIds.length === 0) {
        return { success: true, data: { updatedCount: 0 } };
      }

      if (newStatus === 'published') {
        // pending_approval → published (set approval metadata)
        const { error: approveErr } = await supabase
          .from('questions')
          .update({
            status: 'published',
            approved_by: approvedBy ?? null,
            approved_at: new Date().toISOString(),
          })
          .in('question_id', questionIds)
          .eq('status', 'pending_approval');

        if (approveErr) {
          return { success: false, error: extractErrorMessage(approveErr) };
        }

        // archived → published (preserve existing approval metadata — restore)
        const { error: restoreErr } = await supabase
          .from('questions')
          .update({ status: 'published' })
          .in('question_id', questionIds)
          .eq('status', 'archived');

        if (restoreErr) {
          return { success: false, error: extractErrorMessage(restoreErr) };
        }

        // ── Audit: bulk question approval (single event) ────────────────
        await auditService.log({
          action: mapQuestionTransitionAction(undefined, newStatus),
          resourceType: 'questions',
          resourceId: null,
          newValue: { status: newStatus },
          metadata: { questionIds, count: questionIds.length, newStatus },
        });

        return { success: true, data: { updatedCount: questionIds.length } };
      }

      const dbUpdate: Record<string, unknown> = { status: newStatus };

      if (newStatus === 'draft') {
        // Reject: clear approval metadata for all
        dbUpdate.approved_by = null;
        dbUpdate.approved_at = null;
      }

      // Guard: only update questions in valid pre-transition statuses
      // to prevent accidental overwrites (e.g. bulk-archiving draft questions)
      let updateQuery = supabase
        .from('questions')
        .update(dbUpdate)
        .in('question_id', questionIds);

      if (newStatus === 'draft') {
        updateQuery = updateQuery.eq('status', 'pending_approval');
      } else if (newStatus === 'archived') {
        updateQuery = updateQuery.eq('status', 'published');
      }

      const { error } = await updateQuery;

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      // ── Audit: bulk question status change (single event) ────────────
      await auditService.log({
        action: mapQuestionTransitionAction(undefined, newStatus),
        resourceType: 'questions',
        resourceId: null,
        newValue: { status: newStatus },
        metadata: { questionIds, count: questionIds.length, newStatus },
      });

      return { success: true, data: { updatedCount: questionIds.length } };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  /** Bulk-approve selected questions (pending_approval → published). */
  async bulkApprove(
    questionIds: string[],
    approvedBy?: string | null,
  ): Promise<ApiResponse<{ updatedCount: number }>> {
    return this.bulkUpdateStatus(questionIds, 'published', approvedBy);
  },

  /** Bulk-reject (revert to draft) selected questions (pending_approval → draft). */
  async bulkReject(questionIds: string[]): Promise<ApiResponse<{ updatedCount: number }>> {
    return this.bulkUpdateStatus(questionIds, 'draft');
  },

  /** Bulk-publish selected questions (pending_approval → published). Alias for bulkApprove. */
  async bulkPublish(
    questionIds: string[],
    approvedBy?: string | null,
  ): Promise<ApiResponse<{ updatedCount: number }>> {
    return this.bulkUpdateStatus(questionIds, 'published', approvedBy);
  },

  /** Bulk-archive selected questions (published → archived). */
  async bulkArchive(questionIds: string[]): Promise<ApiResponse<{ updatedCount: number }>> {
    return this.bulkUpdateStatus(questionIds, 'archived');
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  12. Statistics
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get question approval statistics for the admin dashboard.
   *
   * Returns:
   * - Count by subject (all statuses)
   * - Count by subject (pending approval only)
   * - Recently submitted questions (last 10)
   * - Recently approved questions (last 10)
   */
  async getStats(instituteId?: string | null): Promise<ApiResponse<QuestionApprovalStats>> {
    try {
      // 1. Count by subject (all statuses)
      let subjectQuery = supabase
        .from('questions')
        .select(
          `\n          subject_id,\n          subjects!inner ( name )\n        `,
          { count: 'exact' },
        );

      if (instituteId) {
        subjectQuery = subjectQuery.eq('institute_id', instituteId);
      }

      const { data: subjData } = await subjectQuery;

      // Aggregate by subject manually since we can't GROUP BY with Supabase
      // REST API easily for the count
      const subjectCountMap = new Map<string, { name: string; count: number }>();
      for (const row of subjData ?? []) {
        const sid = row.subject_id;
        const name = (row.subjects as any)?.name ?? 'Unknown';
        const existing = subjectCountMap.get(sid) ?? { name, count: 0 };
        existing.count++;
        subjectCountMap.set(sid, existing);
      }

      const bySubject = [...subjectCountMap.entries()]
        .map(([subjectId, { name, count }]) => ({ subjectId, subjectName: name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // 2. Count by subject (pending approval only)
      let pendingQuery = supabase
        .from('questions')
        .select(
          `\n          subject_id,\n          subjects!inner ( name )\n        `,
          { count: 'exact' },
        )
        .eq('status', 'pending_approval');

      if (instituteId) {
        pendingQuery = pendingQuery.eq('institute_id', instituteId);
      }

      const { data: pendingData } = await pendingQuery;

      const pendingCountMap = new Map<string, { name: string; count: number }>();
      for (const row of pendingData ?? []) {
        const sid = row.subject_id;
        const name = (row.subjects as any)?.name ?? 'Unknown';
        const existing = pendingCountMap.get(sid) ?? { name, count: 0 };
        existing.count++;
        pendingCountMap.set(sid, existing);
      }

      const pendingBySubject = [...pendingCountMap.entries()]
        .map(([subjectId, { name, count }]) => ({ subjectId, subjectName: name, count }))
        .sort((a, b) => b.count - a.count);

      // 3. Recently submitted (last 10 pending_approval, newest first)
      const { data: recentSubmitted } = await supabase
        .from('questions')
        .select(
          `\n          question_id,\n          question_text,\n          question_type,\n          difficulty,\n          status,\n          subject_id,\n          chapter_id,\n          created_by,\n          created_at,\n          updated_at,\n          approved_at,\n          subjects!left ( name ),\n          chapters!left ( name )\n        `,
        )
        .eq('status', 'pending_approval')
        .order('created_at', { ascending: false })
        .limit(10);

      const recentlySubmitted = (recentSubmitted ?? []).map((row: any) => {
        const item = toApprovalListItem(row);
        return item;
      });

      // 4. Recently approved (last 10 published, newest first by approved_at)
      const { data: recentApproved } = await supabase
        .from('questions')
        .select(
          `\n          question_id,\n          question_text,\n          question_type,\n          difficulty,\n          status,\n          subject_id,\n          chapter_id,\n          created_by,\n          created_at,\n          updated_at,\n          approved_at,\n          subjects!left ( name ),\n          chapters!left ( name )\n        `,
        )
        .eq('status', 'published')
        .not('approved_at', 'is', null)
        .order('approved_at', { ascending: false })
        .limit(10);

      const recentlyApproved = (recentApproved ?? []).map((row: any) => {
        const item = toApprovalListItem(row);
        return item;
      });

      return {
        success: true,
        data: { bySubject, pendingBySubject, recentlySubmitted, recentlyApproved },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },
};

// ═══════════════════════════════════════════════════════════════════════════
//  Internal Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch all options for a question, each with its images attached.
 */
async function fetchOptionsWithImages(
  questionId: string,
): Promise<ApprovalQuestionOption[]> {
  const { data: options, error: optErr } = await supabase
    .from('question_options')
    .select('*')
    .eq('question_id', questionId)
    .order('order_sequence', { ascending: true });

  if (optErr || !options) {
    return [];
  }

  // Batch-fetch option images for all options
  const optionIds = options.map((o) => o.option_id);
  let imageMap = new Map<string, ApprovalOptionImageInfo[]>();

  if (optionIds.length > 0) {
    const { data: images } = await supabase
      .from('question_option_images')
      .select('*')
      .in('option_id', optionIds)
      .order('display_order', { ascending: true });

    for (const img of images ?? []) {
      const existing = imageMap.get(img.option_id) ?? [];
      existing.push({
        optionImageId: img.option_image_id,
        storageBucket: img.storage_bucket,
        storagePath: img.storage_path,
        altText: img.alt_text,
        displayOrder: img.display_order,
      });
      imageMap.set(img.option_id, existing);
    }
  }

  return options.map((opt) => ({
    optionId: opt.option_id,
    optionText: opt.option_text,
    isCorrect: opt.is_correct,
    orderSequence: opt.order_sequence,
    createdAt: opt.created_at,
    images: imageMap.get(opt.option_id) ?? [],
  }));
}

/**
 * Resolve teacher info from a `created_by` (teacher_details.teacher_id) value.
 *
 * Joins through `teacher_details` → `profiles` to get name and email.
 */
async function resolveTeacherInfo(
  teacherId: string,
): Promise<{ teacherId: string | null; name: string | null; email: string | null }> {
  try {
    const { data } = await supabase
      .from('teacher_details')
      .select(
        `\n        teacher_id,\n        profiles!inner ( name, email )\n      `,
      )
      .eq('teacher_id', teacherId)
      .maybeSingle();

    if (!data) {
      return { teacherId, name: null, email: null };
    }

    const p = (data as any).profiles;
    return {
      teacherId: data.teacher_id,
      name: p?.name ?? null,
      email: p?.email ?? null,
    };
  } catch {
    return { teacherId, name: null, email: null };
  }
}
