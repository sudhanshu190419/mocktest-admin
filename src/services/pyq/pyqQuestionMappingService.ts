/**
 * PYQ Question Mapping Service
 *
 * Encapsulates all operations on the `pyq_question_mappings` junction table
 * — the link between a PYQ paper and the questions it contains.
 *
 * ## Scope
 *
 * This service manages the `pyq_question_mappings` table only. It does NOT
 * manage:
 * - pyq_papers (see pyqPaperService.ts)
 * - questions (see questionService.ts in the mock test module)
 * - solutions, mock mappings, or purchases
 *
 * ## Side Effects
 *
 * When a mapping is created or deleted, this service updates the parent
 * paper's `total_questions` count to maintain denormalised consistency.
 *
 * ## Design decisions
 *
 * The service follows the exact same architecture as `mockTestQuestionService.ts`,
 * replacing `mock_test_questions` with `pyq_question_mappings`.
 * No business logic is duplicated — the parallel structure exists because
 * the two tables serve fundamentally different domains (mock tests vs PYQ).
 *
 * @module services/pyq/pyqQuestionMappingService
 */

import { supabase } from '@/config/supabase';
import { extractErrorMessage, validateUUID } from '@/utils/supabase';
import { auditService } from '@/services/audit/auditService';
import { assertPaperOwnership } from './pyqOwnershipGuard';
import type { ApiResponse } from '@/types/academic';
import type {
  PyqQuestionMapping,
  PyqQuestionAssignment,
  PyqReorderItem,
} from '@/types/pyq';

// ─── Constants ──────────────────────────────────────────────────────────────

const SORT_FIELD_MAP: Record<string, string> = {
  orderSequence: 'order_sequence',
  officialMarks: 'official_marks',
  addedAt: 'added_at',
};

// ─── Database Row Shape ────────────────────────────────────────────────────

interface DbPyqQuestionMapping {
  mapping_id: string;
  paper_id: string;
  question_id: string;
  institute_id: string;
  order_sequence: number;
  section_name: string | null;
  official_marks: number | null;
  official_negative_marks: number | null;
  added_at: string;
}

// ─── Mapping Helpers ────────────────────────────────────────────────────────

function toPyqQuestionMapping(db: DbPyqQuestionMapping): PyqQuestionMapping {
  return {
    mappingId: db.mapping_id,
    paperId: db.paper_id,
    questionId: db.question_id,
    instituteId: db.institute_id,
    orderSequence: db.order_sequence,
    sectionName: db.section_name,
    officialMarks: db.official_marks,
    officialNegativeMarks: db.official_negative_marks,
    addedAt: db.added_at,
  };
}

function mapSortField(sortBy: string | undefined): string {
  return SORT_FIELD_MAP[sortBy ?? 'orderSequence'] ?? 'order_sequence';
}

// ─── Side Effects ───────────────────────────────────────────────────────────

/**
 * Refreshes the parent paper's `total_questions` count by counting all
 * mapped questions.
 */
async function refreshPaperQuestionCount(paperId: string): Promise<void> {
  try {
    const { count, error } = await supabase
      .from('pyq_question_mappings')
      .select('mapping_id', { count: 'exact', head: true })
      .eq('paper_id', paperId);

    if (error) {
      console.warn('Failed to refresh paper question count:', error.message);
      return;
    }

    await supabase
      .from('pyq_papers')
      .update({ total_questions: count ?? 0 })
      .eq('paper_id', paperId);
  } catch (err) {
    console.warn('Failed to refresh paper question count:', err);
  }
}

// ─── Validation Helpers ─────────────────────────────────────────────────────

/**
 * Checks if a question is already mapped to a paper.
 */
async function isDuplicate(paperId: string, questionId: string): Promise<boolean> {
  const { data } = await supabase
    .from('pyq_question_mappings')
    .select('mapping_id')
    .eq('paper_id', paperId)
    .eq('question_id', questionId)
    .maybeSingle();

  return data !== null;
}

/**
 * Gets the current count of mapped questions in a paper.
 */
async function getQuestionCount(paperId: string): Promise<number> {
  const { count } = await supabase
    .from('pyq_question_mappings')
    .select('*', { count: 'exact', head: true })
    .eq('paper_id', paperId);

  return count ?? 0;
}

/**
 * Validates a list of assignments for consistency before bulk operations.
 */
function validateAssignments(assignments: PyqQuestionAssignment[]): string | null {
  if (assignments.length === 0) {
    return 'At least one question assignment is required.';
  }

  const seenQuestionIds = new Set<string>();
  const seenOrders = new Set<number>();

  for (let i = 0; i < assignments.length; i++) {
    const a = assignments[i];

    try {
      validateUUID(a.questionId, `assignments[${i}].questionId`);
    } catch {
      return `assignments[${i}].questionId is not a valid UUID: "${a.questionId}".`;
    }

    if (!Number.isInteger(a.orderSequence) || a.orderSequence < 1) {
      return `assignments[${i}].orderSequence must be a positive integer >= 1, got ${a.orderSequence}.`;
    }

    if (a.officialMarks !== undefined && a.officialMarks !== null && a.officialMarks <= 0) {
      return `assignments[${i}].officialMarks must be greater than 0 when provided, got ${a.officialMarks}.`;
    }

    if (a.officialNegativeMarks !== undefined && a.officialNegativeMarks !== null && a.officialNegativeMarks < 0) {
      return `assignments[${i}].officialNegativeMarks cannot be negative, got ${a.officialNegativeMarks}.`;
    }

    if (seenQuestionIds.has(a.questionId)) {
      return `Duplicate question in assignments: "${a.questionId}" at index ${i}.`;
    }
    seenQuestionIds.add(a.questionId);

    if (seenOrders.has(a.orderSequence)) {
      return `Duplicate orderSequence in assignments: ${a.orderSequence} at index ${i}.`;
    }
    seenOrders.add(a.orderSequence);
  }

  return null;
}

/**
 * Validates the paper exists and fetches its institute_id.
 */
async function validatePaperExists(paperId: string): Promise<ApiResponse<{ paper_id: string; institute_id: string; stream_id: string }>> {
  const { data, error } = await supabase
    .from('pyq_papers')
    .select('paper_id, institute_id, stream_id')
    .eq('paper_id', paperId)
    .single<{ paper_id: string; institute_id: string; stream_id: string }>();

  if (error) {
    if (error.code === 'PGRST116') {
      return { success: false, error: `PYQ paper not found: ${paperId}` };
    }
    return { success: false, error: extractErrorMessage(error) };
  }

  return { success: true, data };
}

/**
 * Validates the question exists and returns its basic info.
 */
async function validateQuestionExists(questionId: string): Promise<ApiResponse<{ question_id: string; institute_id: string }>> {
  const { data, error } = await supabase
    .from('questions')
    .select('question_id, institute_id')
    .eq('question_id', questionId)
    .single<{ question_id: string; institute_id: string }>();

  if (error) {
    if (error.code === 'PGRST116') {
      return { success: false, error: `Question not found: ${questionId}` };
    }
    return { success: false, error: extractErrorMessage(error) };
  }

  return { success: true, data };
}

// ─── Public API ─────────────────────────────────────────────────────────────

export const pyqQuestionMappingService = {
  // ═════════════════════════════════════════════════════════════════════════
  //  1. List Mappings
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Fetch all questions assigned to a PYQ paper, ordered by their display
   * sequence.
   *
   * @param paperId - The UUID of the PYQ paper.
   * @param sortBy  - Optional sort field (orderSequence, officialMarks, addedAt).
   * @param sortDir - Optional sort direction (asc, desc).
   */
  async getMappings(
    paperId: string,
    sortBy?: 'orderSequence' | 'officialMarks' | 'addedAt',
    sortDir?: 'asc' | 'desc',
  ): Promise<ApiResponse<PyqQuestionMapping[]>> {
    try {
      validateUUID(paperId, 'paperId');

      const sortField = mapSortField(sortBy);
      const direction = sortDir ?? 'asc';

      const { data, error } = await supabase
        .from('pyq_question_mappings')
        .select('*')
        .eq('paper_id', paperId)
        .order(sortField, { ascending: direction === 'asc' });

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      return {
        success: true,
        data: (data ?? []).map(toPyqQuestionMapping),
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  2. Get Single Mapping
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Fetch a single mapping by paper ID and question ID.
   */
  async getMapping(
    paperId: string,
    questionId: string,
  ): Promise<ApiResponse<PyqQuestionMapping>> {
    try {
      validateUUID(paperId, 'paperId');
      validateUUID(questionId, 'questionId');

      const { data, error } = await supabase
        .from('pyq_question_mappings')
        .select('*')
        .eq('paper_id', paperId)
        .eq('question_id', questionId)
        .single<DbPyqQuestionMapping>();

      if (error) {
        if (error.code === 'PGRST116') {
          return { success: false, error: `Question mapping not found for paper ${paperId} and question ${questionId}.` };
        }
        return { success: false, error: extractErrorMessage(error) };
      }

      return { success: true, data: toPyqQuestionMapping(data) };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  3. Add Single Mapping
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Add a single question to a PYQ paper.
   *
   * OWNERSHIP: only the paper owner (created_by == current profile) or a
   * Super Admin may add questions to a paper.
   *
   * Performs full validation:
   * - Paper exists
   * - Question exists
   * - Institute scope match
   * - No duplicate question in the same paper
   * - orderSequence >= 1
   * - Unique order_sequence constraint
   *
   * @param input - The mapping details.
   */
  async addMapping(input: {
    paperId: string;
    questionId: string;
    orderSequence: number;
    sectionName?: string | null;
    officialMarks?: number | null;
    officialNegativeMarks?: number | null;
  }): Promise<ApiResponse<PyqQuestionMapping>> {
    try {
      // ── Ownership: owner or Super Admin (server-side) ───────────────
      const ownership = await assertPaperOwnership(input.paperId);
      if (!ownership.success) {
        return { success: false, error: ownership.error };
      }

      // ── Validate basic input ───────────────────────────────────────────
      if (!input.paperId) {
        return { success: false, error: 'paperId is required.' };
      }
      if (!input.questionId) {
        return { success: false, error: 'questionId is required.' };
      }
      if (!Number.isInteger(input.orderSequence) || input.orderSequence < 1) {
        return { success: false, error: 'orderSequence must be a positive integer >= 1.' };
      }

      validateUUID(input.paperId, 'paperId');
      validateUUID(input.questionId, 'questionId');

      // ── Validate paper exists ──────────────────────────────────────────
      const paperCheck = await validatePaperExists(input.paperId);
      if (!paperCheck.success || !paperCheck.data) {
        return { success: false, error: paperCheck.error };
      }
      const paper = paperCheck.data;

      // ── Validate question exists ───────────────────────────────────────
      const questionCheck = await validateQuestionExists(input.questionId);
      if (!questionCheck.success || !questionCheck.data) {
        return { success: false, error: questionCheck.error };
      }
      const question = questionCheck.data;

      // ── Institute scope validation ─────────────────────────────────────
      if (question.institute_id !== paper.institute_id) {
        return {
          success: false,
          error: 'Question belongs to a different institute than the paper. Cross-institute assignments are not allowed.',
        };
      }

      // ── Prevent duplicates ─────────────────────────────────────────────
      const duplicate = await isDuplicate(input.paperId, input.questionId);
      if (duplicate) {
        return {
          success: false,
          error: 'This question is already assigned to this PYQ paper. Duplicate questions in the same paper are not allowed.',
        };
      }

      // ── Build DB record ────────────────────────────────────────────────
      const dbRecord: Record<string, unknown> = {
        paper_id: input.paperId,
        question_id: input.questionId,
        institute_id: paper.institute_id,
        order_sequence: input.orderSequence,
        section_name: input.sectionName ?? null,
        official_marks: input.officialMarks ?? null,
        official_negative_marks: input.officialNegativeMarks ?? null,
      };

      // ── Insert ─────────────────────────────────────────────────────────
      const { data, error } = await supabase
        .from('pyq_question_mappings')
        .insert(dbRecord)
        .select()
        .single<DbPyqQuestionMapping>();

      if (error) {
        if (error.code === '23505') {
          return {
            success: false,
            error: 'This question is already assigned to this PYQ paper, or the order_sequence is already taken.',
          };
        }
        if (error.code === '23503') {
          return {
            success: false,
            error: 'Cannot add question to paper. The PYQ paper or question does not exist.',
          };
        }
        return { success: false, error: extractErrorMessage(error) };
      }

      // ── Refresh paper question count ───────────────────────────────────
      await refreshPaperQuestionCount(input.paperId);

      // ── Audit: mapping created ─────────────────────────────────────────
      await auditService.logCreate({
        resourceType: 'pyq_question_mappings',
        resourceId: data.mapping_id,
        metadata: { paperId: input.paperId, questionId: input.questionId },
      });

      return { success: true, data: toPyqQuestionMapping(data) };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  4. Remove Mapping
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Remove a question from a PYQ paper.
   *
   * OWNERSHIP: only the paper owner or a Super Admin may remove questions.
   *
   * This is a hard delete of the junction row. The question itself is not
   * deleted — only removed from this paper's question set.
   *
   * @param paperId    - The UUID of the PYQ paper.
   * @param questionId - The UUID of the question to remove.
   */
  async removeMapping(
    paperId: string,
    questionId: string,
  ): Promise<ApiResponse<void>> {
    try {
      // ── Ownership: owner or Super Admin (server-side) ───────────────
      const ownership = await assertPaperOwnership(paperId);
      if (!ownership.success) {
        return { success: false, error: ownership.error };
      }

      validateUUID(paperId, 'paperId');
      validateUUID(questionId, 'questionId');

      const { error } = await supabase
        .from('pyq_question_mappings')
        .delete()
        .eq('paper_id', paperId)
        .eq('question_id', questionId);

      if (error) {
        if (error.code === '23503') {
          return {
            success: false,
            error: 'Cannot remove this question from the paper. It has solution records that reference it.',
          };
        }
        return { success: false, error: extractErrorMessage(error) };
      }

      // ── Refresh paper question count ───────────────────────────────────
      await refreshPaperQuestionCount(paperId);

      // ── Audit: mapping removed ─────────────────────────────────────────
      await auditService.log({
        action: 'delete',
        resourceType: 'pyq_question_mappings',
        metadata: { paperId, questionId },
      });

      return { success: true };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  5. Bulk Add Mappings
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Add multiple questions to a PYQ paper in a single batch operation.
   *
   * OWNERSHIP: only the paper owner or a Super Admin may add questions.
   *
   * Each assignment is validated individually before any insert is performed.
   * If any assignment fails validation, the entire batch is rejected.
   *
   * @param paperId     - The UUID of the PYQ paper.
   * @param assignments - Array of question assignments to add.
   */
  async addMappings(
    paperId: string,
    assignments: PyqQuestionAssignment[],
  ): Promise<ApiResponse<PyqQuestionMapping[]>> {
    try {
      // ── Ownership: owner or Super Admin (server-side) ───────────────
      const ownership = await assertPaperOwnership(paperId);
      if (!ownership.success) {
        return { success: false, error: ownership.error };
      }

      validateUUID(paperId, 'paperId');

      // ── Validate batch structure ───────────────────────────────────────
      const validationError = validateAssignments(assignments);
      if (validationError) {
        return { success: false, error: validationError };
      }

      // ── Validate paper exists ──────────────────────────────────────────
      const paperCheck = await validatePaperExists(paperId);
      if (!paperCheck.success || !paperCheck.data) {
        return { success: false, error: paperCheck.error };
      }
      const paper = paperCheck.data;

      // ── Validate each assignment ───────────────────────────────────────
      const resolvedRecords: Record<string, unknown>[] = [];
      const seenQuestionIds = new Set<string>();

      for (let i = 0; i < assignments.length; i++) {
        const a = assignments[i];

        if (seenQuestionIds.has(a.questionId)) {
          return { success: false, error: `Duplicate question in batch: "${a.questionId}" at index ${i}.` };
        }
        seenQuestionIds.add(a.questionId);

        const duplicate = await isDuplicate(paperId, a.questionId);
        if (duplicate) {
          return { success: false, error: `Question "${a.questionId}" at index ${i} is already assigned to this paper.` };
        }

        const questionCheck = await validateQuestionExists(a.questionId);
        if (!questionCheck.success || !questionCheck.data) {
          return { success: false, error: `Question "${a.questionId}" at index ${i}: ${questionCheck.error}` };
        }
        const question = questionCheck.data;

        if (question.institute_id !== paper.institute_id) {
          return { success: false, error: `Question "${a.questionId}" at index ${i} belongs to a different institute.` };
        }

        resolvedRecords.push({
          paper_id: paperId,
          question_id: a.questionId,
          institute_id: paper.institute_id,
          order_sequence: a.orderSequence,
          section_name: a.sectionName ?? null,
          official_marks: a.officialMarks ?? null,
          official_negative_marks: a.officialNegativeMarks ?? null,
        });
      }

      // ── Bulk insert ────────────────────────────────────────────────────
      const { data, error } = await supabase
        .from('pyq_question_mappings')
        .insert(resolvedRecords)
        .select();

      if (error) {
        if (error.code === '23505') {
          return {
            success: false,
            error: 'One or more questions were already assigned (or their order_sequence is taken) by another concurrent operation.',
          };
        }
        if (error.code === '23503') {
          return { success: false, error: 'One or more questions or the PYQ paper does not exist.' };
        }
        return { success: false, error: extractErrorMessage(error) };
      }

      // ── Refresh paper question count ───────────────────────────────────
      await refreshPaperQuestionCount(paperId);

      // ── Audit: bulk mappings created ───────────────────────────────────
      await auditService.logCreate({
        resourceType: 'pyq_question_mappings',
        metadata: { paperId, addedCount: resolvedRecords.length },
      });

      return {
        success: true,
        data: (data ?? []).map(toPyqQuestionMapping),
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  6. Reorder Mappings
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Reorder the questions in a PYQ paper.
   *
   * OWNERSHIP: only the paper owner or a Super Admin may reorder questions.
   *
   * Accepts an array of items, each specifying a question ID and the new
   * order position. Only the provided mappings' order is updated — all
   * other mappings retain their current order.
   *
   * @param paperId - The UUID of the PYQ paper.
   * @param items   - Array of reorder items with question IDs and new positions.
   */
  async reorderMappings(
    paperId: string,
    items: PyqReorderItem[],
  ): Promise<ApiResponse<PyqQuestionMapping[]>> {
    try {
      // ── Ownership: owner or Super Admin (server-side) ───────────────
      const ownership = await assertPaperOwnership(paperId);
      if (!ownership.success) {
        return { success: false, error: ownership.error };
      }

      validateUUID(paperId, 'paperId');

      if (items.length === 0) {
        return { success: false, error: 'At least one reorder item is required.' };
      }

      const seenOrders = new Set<number>();

      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        try {
          validateUUID(item.questionId, `items[${i}].questionId`);
        } catch {
          return { success: false, error: `items[${i}].questionId is invalid: "${item.questionId}".` };
        }

        if (!Number.isInteger(item.orderSequence) || item.orderSequence < 1) {
          return { success: false, error: `items[${i}].orderSequence must be a positive integer >= 1.` };
        }

        if (seenOrders.has(item.orderSequence)) {
          return { success: false, error: `Duplicate orderSequence in reorder items: ${item.orderSequence} at index ${i}.` };
        }
        seenOrders.add(item.orderSequence);
      }

      // ── Update each mapping's order ────────────────────────────────────
      for (const item of items) {
        const { error } = await supabase
          .from('pyq_question_mappings')
          .update({ order_sequence: item.orderSequence })
          .eq('paper_id', paperId)
          .eq('question_id', item.questionId);

        if (error) {
          if (error.code === 'PGRST116') {
            return { success: false, error: `Mapping not found for question "${item.questionId}" in paper "${paperId}".` };
          }
          return { success: false, error: extractErrorMessage(error) };
        }
      }

      // ── Audit: mappings reordered ─────────────────────────────────────
      await auditService.logUpdate({
        resourceType: 'pyq_question_mappings',
        resourceId: paperId,
        metadata: { paperId, reorderedCount: items.length },
      });

      // ── Fetch and return the updated list ──────────────────────────────
      return this.getMappings(paperId, 'orderSequence', 'asc');
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  7. Helper: Get Next Order Sequence
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Get the next available order_sequence for a paper.
   *
   * OWNERSHIP: paper owner or Super Admin only (helper used inside the paper
   * editor).
   *
   * @param paperId - The UUID of the PYQ paper.
   * @returns The next sequence number (current max + 1, or 1 if no mappings exist).
   */
  async getNextOrderSequence(paperId: string): Promise<ApiResponse<number>> {
    try {
      // ── Ownership: owner or Super Admin (server-side) ───────────────
      const ownership = await assertPaperOwnership(paperId);
      if (!ownership.success) {
        return { success: false, error: ownership.error };
      }

      validateUUID(paperId, 'paperId');

      const { data, error } = await supabase
        .from('pyq_question_mappings')
        .select('order_sequence')
        .eq('paper_id', paperId)
        .order('order_sequence', { ascending: false })
        .limit(1);

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const next = (data && data.length > 0 ? data[0].order_sequence : 0) + 1;
      return { success: true, data: next };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },
};
