/**
 * Question Option Service
 *
 * Clean-architecture service layer encapsulating all QuestionOption CRUD
 * operations and the bulk replace/reorder logic used by the Question Editor.
 *
 * Every public method returns a standardised `ApiResponse<T>` shape so that
 * consumers (hooks, screens, etc.) never need to handle raw Supabase
 * exceptions or error formats.
 *
 * ## Key functions
 *
 * - **replaceQuestionOptions** — the primary entry point for the Question
 *   Editor. Atomically replaces all options for a question with a new set,
 *   performing MCQ/MSQ cardinality validation.
 * - **reorderQuestionOptions** — lightweight display-order update without
 *   touching option content.
 *
 * @module questionOptionService
 */

import { supabase } from '../../config/supabase';
import { validateUUID, extractErrorMessage } from '../../utils/supabase';
import type { ApiResponse } from '../../types/academic';
import type { QuestionOption, QuestionType } from '../../types/mockTest';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Minimum number of options required. */
const MIN_OPTIONS = 2;

/** Maximum number of options allowed. */
const MAX_OPTIONS = 8;

// ─── Database Row Shape ────────────────────────────────────────────────────

/**
 * Raw snake_case shape of the `question_options` table returned by Supabase.
 */
interface DbQuestionOption {
  option_id: string;
  question_id: string;
  institute_id: string;
  option_text: string;
  is_correct: boolean;
  order_sequence: number;
  created_at: string;
}

// ─── Input Types ────────────────────────────────────────────────────────────

/**
 * Input for creating a single question option.
 */
interface CreateOptionInput {
  /** Parent question ID. */
  questionId: string;
  /** Institute that owns this option. */
  instituteId: string;
  /** Option content in plain text or Markdown. */
  optionText: string;
  /** TRUE if this is a correct answer. */
  isCorrect?: boolean;
  /** 1-indexed display order. */
  orderSequence: number;
}

/**
 * Input for updating a question option.
 */
interface UpdateOptionInput {
  /** Updated option text. */
  optionText?: string;
  /** Updated correct-answer flag. */
  isCorrect?: boolean;
  /** Updated display order. */
  displayOrder?: number;
}

/**
 * Input for reordering a single option.
 */
interface ReorderItem {
  /** The option to reorder. */
  optionId: string;
  /** New display order position. */
  displayOrder: number;
}

/**
 * Option entry used by the bulk replace workflow.
 */
interface ReplaceOptionEntry {
  /** Option text in plain text or Markdown. */
  optionText: string;
  /** TRUE if this is a correct answer. */
  isCorrect: boolean;
  /** 1-indexed display order. */
  orderSequence: number;
}

// ─── Mapping Helpers ────────────────────────────────────────────────────────

/**
 * Converts a raw snake_case database row into a camelCase `QuestionOption`.
 */
function mapQuestionOption(db: DbQuestionOption): QuestionOption {
  return {
    optionId: db.option_id,
    questionId: db.question_id,
    instituteId: db.institute_id,
    optionText: db.option_text,
    isCorrect: db.is_correct,
    orderSequence: db.order_sequence,
    createdAt: db.created_at,
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch all options for a given question, ordered by display order ascending.
 *
 * @param questionId - The UUID of the parent question.
 *
 * @example
 * const result = await getQuestionOptions('uuid-here');
 * if (result.success) {
 *   console.log(result.data); // QuestionOption[]
 * }
 */
export async function getQuestionOptions(
  questionId: string,
): Promise<ApiResponse<QuestionOption[]>> {
  try {
    validateUUID(questionId, 'questionId');

    const { data, error } = await supabase
      .from('question_options')
      .select('*')
      .eq('question_id', questionId)
      .order('order_sequence', { ascending: true });

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    const options = (data ?? []).map(mapQuestionOption);
    return { success: true, data: options };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Fetch a single question option by its ID.
 *
 * @param optionId - The UUID of the option to retrieve.
 *
 * @example
 * const result = await getQuestionOptionById('uuid-here');
 * if (result.success) {
 *   console.log(result.data.optionText);
 * }
 */
export async function getQuestionOptionById(
  optionId: string,
): Promise<ApiResponse<QuestionOption>> {
  try {
    validateUUID(optionId, 'optionId');

    const { data, error } = await supabase
      .from('question_options')
      .select('*')
      .eq('option_id', optionId)
      .single<DbQuestionOption>();

    if (error) {
      if (error.code === 'PGRST116') {
        return { success: false, error: `Question option not found: ${optionId}` };
      }
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapQuestionOption(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Create a single question option.
 *
 * @param input - The option creation payload.
 *
 * @example
 * const result = await createQuestionOption({
 *   questionId: 'uuid-here',
 *   instituteId: 'uuid-here',
 *   optionText: 'Newton's First Law',
 *   isCorrect: true,
 *   orderSequence: 1,
 * });
 */
export async function createQuestionOption(
  input: CreateOptionInput,
): Promise<ApiResponse<QuestionOption>> {
  try {
    // ── Validate required fields ───────────────────────────────────────
    if (!input.questionId) {
      return { success: false, error: 'questionId is required.' };
    }

    if (!input.instituteId) {
      return { success: false, error: 'instituteId is required.' };
    }

    if (!input.optionText?.trim()) {
      return { success: false, error: 'Option text is required.' };
    }

    if (input.orderSequence < 1) {
      return { success: false, error: 'orderSequence must be 1 or greater.' };
    }

    // ── Validate UUIDs ─────────────────────────────────────────────────
    validateUUID(input.questionId, 'questionId');
    validateUUID(input.instituteId, 'instituteId');

    // ── Build DB record ────────────────────────────────────────────────
    const dbRecord: Record<string, unknown> = {
      question_id: input.questionId,
      institute_id: input.instituteId,
      option_text: input.optionText.trim(),
      is_correct: input.isCorrect ?? false,
      order_sequence: input.orderSequence,
    };

    // ── Insert ─────────────────────────────────────────────────────────
    const { data, error } = await supabase
      .from('question_options')
      .insert(dbRecord)
      .select()
      .single<DbQuestionOption>();

    if (error) {
      // FK violation: parent question does not exist
      if (error.code === '23503') {
        return {
          success: false,
          error: 'Cannot create option: the referenced question does not exist.',
        };
      }

      // Unique violation: duplicate (question_id, order_sequence)
      if (error.code === '23505') {
        return {
          success: false,
          error:
            'An option with this display order already exists for this question. ' +
            'Choose a different order sequence.',
        };
      }

      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapQuestionOption(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Update an existing question option.
 *
 * Only the fields provided in `input` are updated. Options for `published`
 * questions are immutable — any attempt to update them will be blocked
 * by the database's immutability guard trigger or RLS policy. This service
 * does not enforce that restriction; the database handles it.
 *
 * @param optionId - The UUID of the option to update.
 * @param input    - The fields to update (all optional).
 *
 * @example
 * const result = await updateQuestionOption('uuid-here', {
 *   optionText: 'Updated option text',
 *   isCorrect: false,
 * });
 */
export async function updateQuestionOption(
  optionId: string,
  input: UpdateOptionInput,
): Promise<ApiResponse<QuestionOption>> {
  try {
    validateUUID(optionId, 'optionId');

    // ── Build update payload (only provided fields) ────────────────────
    const dbRecord: Record<string, unknown> = {};

    if (input.optionText !== undefined) {
      if (!input.optionText.trim()) {
        return { success: false, error: 'Option text cannot be empty.' };
      }
      dbRecord.option_text = input.optionText.trim();
    }

    if (input.isCorrect !== undefined) {
      dbRecord.is_correct = input.isCorrect;
    }

    if (input.displayOrder !== undefined) {
      if (input.displayOrder < 1) {
        return { success: false, error: 'displayOrder must be 1 or greater.' };
      }
      dbRecord.order_sequence = input.displayOrder;
    }

    // ── If nothing to update, return current ────────────────────────────
    if (Object.keys(dbRecord).length === 0) {
      return getQuestionOptionById(optionId);
    }

    // ── Update ─────────────────────────────────────────────────────────
    const { data, error } = await supabase
      .from('question_options')
      .update(dbRecord)
      .eq('option_id', optionId)
      .select()
      .single<DbQuestionOption>();

    if (error) {
      if (error.code === 'PGRST116') {
        return { success: false, error: `Question option not found: ${optionId}` };
      }

      // Unique violation on (question_id, order_sequence)
      if (error.code === '23505') {
        return {
          success: false,
          error: 'Another option already has this display order. Choose a different value.',
        };
      }

      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapQuestionOption(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Delete a single question option.
 *
 * @param optionId - The UUID of the option to delete.
 *
 * @example
 * const result = await deleteQuestionOption('uuid-here');
 * if (result.success) {
 *   // option removed
 * }
 */
export async function deleteQuestionOption(optionId: string): Promise<ApiResponse<void>> {
  try {
    validateUUID(optionId, 'optionId');

    const { error } = await supabase
      .from('question_options')
      .delete()
      .eq('option_id', optionId);

    if (error) {
      // FK violation: option is referenced by mock_answer_options (student responses)
      if (error.code === '23503') {
        return {
          success: false,
          error:
            'Cannot delete this option because it has been selected in student answers. ' +
            'Create a new question version instead.',
        };
      }

      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Atomically replace all options for a question.
 *
 * This is the primary function used by the Question Editor. It deletes all
 * existing options for the question and inserts the new set.
 *
 * **Atomicity note:** The DELETE and INSERT are executed as two separate
 * Supabase API calls, not a single database transaction. If the INSERT
 * fails after the DELETE succeeds (e.g. network error), the question will
 * be left with zero options. The caller should verify the result and
 * retry or re-fetch as needed. Future iterations may wrap this in a
 * Supabase RPC for true atomicity.
 *
 * ## Validation rules
 *
 * - At least 2 options required.
 * - Maximum 8 options allowed.
 * - At least one option must be marked as correct.
 * - For MCQ: exactly one correct option.
 * - For MSQ: multiple correct options allowed (at least one).
 * - No duplicate `orderSequence` values.
 * - All `orderSequence` values must be >= 1.
 *
 * @param questionId  - The UUID of the question whose options are being replaced.
 * @param instituteId - The UUID of the institute.
 * @param options     - The new set of options.
 * @param questionType - The question type (controls MCQ vs MSQ validation).
 *
 * @example
 * const result = await replaceQuestionOptions(
 *   'question-uuid',
 *   'institute-uuid',
 *   [
 *     { optionText: 'Option A', isCorrect: true, orderSequence: 1 },
 *     { optionText: 'Option B', isCorrect: false, orderSequence: 2 },
 *     { optionText: 'Option C', isCorrect: false, orderSequence: 3 },
 *     { optionText: 'Option D', isCorrect: false, orderSequence: 4 },
 *   ],
 *   'mcq',
 * );
 */
export async function replaceQuestionOptions(
  questionId: string,
  instituteId: string,
  options: ReplaceOptionEntry[],
  questionType: QuestionType,
): Promise<ApiResponse<QuestionOption[]>> {
  try {
    // ═══════════════════════════════════════════════════════════════════
    //  Validation
    // ═══════════════════════════════════════════════════════════════════

    validateUUID(questionId, 'questionId');
    validateUUID(instituteId, 'instituteId');

    // --- Count validation ---
    if (options.length < MIN_OPTIONS) {
      return {
        success: false,
        error: `At least ${MIN_OPTIONS} options are required. Received ${options.length}.`,
      };
    }

    if (options.length > MAX_OPTIONS) {
      return {
        success: false,
        error: `Maximum ${MAX_OPTIONS} options allowed. Received ${options.length}.`,
      };
    }

    // --- Content validation ---
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      if (!opt.optionText?.trim()) {
        return {
          success: false,
          error: `Option at position ${i + 1} has empty text. All options must have text content.`,
        };
      }
    }

    // --- Correct-option validation ---
    const correctCount = options.filter((o) => o.isCorrect).length;

    if (correctCount === 0) {
      return {
        success: false,
        error: 'At least one option must be marked as correct.',
      };
    }

    if (questionType === 'mcq' || questionType === 'true_false') {
      if (correctCount !== 1) {
        return {
          success: false,
          error:
            `Invalid correct-option count for "${questionType}": expected exactly 1 correct option, ` +
            `but received ${correctCount}.`,
        };
      }
    }

    // MSQ: multiple correct options allowed — already validated that at least one exists

    // --- Order-sequence validation ---
    const sequences = options.map((o) => o.orderSequence);

    if (sequences.some((s) => s < 1)) {
      return {
        success: false,
        error: 'All display order values must be 1 or greater.',
      };
    }

    const uniqueSequences = new Set(sequences);
    if (uniqueSequences.size !== sequences.length) {
      return {
        success: false,
        error:
          'Duplicate display order values detected. Each option must have a unique order sequence.',
      };
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Execution (atomic via Supabase transaction-equivalent approach)
    // ═══════════════════════════════════════════════════════════════════

    // Step 1: Delete all existing options for this question
    const { error: deleteError } = await supabase
      .from('question_options')
      .delete()
      .eq('question_id', questionId);

    if (deleteError) {
      return { success: false, error: extractErrorMessage(deleteError) };
    }

    // Step 2: Insert new options
    const dbRecords = options.map((opt) => ({
      question_id: questionId,
      institute_id: instituteId,
      option_text: opt.optionText.trim(),
      is_correct: opt.isCorrect,
      order_sequence: opt.orderSequence,
    }));

    const { data, error: insertError } = await supabase
      .from('question_options')
      .insert(dbRecords)
      .select()
      .order('order_sequence', { ascending: true });

    if (insertError) {
      return { success: false, error: extractErrorMessage(insertError) };
    }

    const mapped = (data ?? []).map(mapQuestionOption);
    return { success: true, data: mapped };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Update the display order of options in a single operation.
 *
 * Accepts an array of `{ optionId, displayOrder }` pairs and updates only
 * the `order_sequence` column for each specified option. All updates are
 * performed in sequence — if any update fails, the operation returns the
 * error and earlier updates are committed (callers should treat this as
 * best-effort; for atomic ordering, use `replaceQuestionOptions` instead).
 *
 * Each `displayOrder` must be 1 or greater.
 *
 * @param items - Array of option ID to display order mappings.
 *
 * @example
 * const result = await reorderQuestionOptions([
 *   { optionId: 'uuid-a', displayOrder: 2 },
 *   { optionId: 'uuid-b', displayOrder: 1 },
 * ]);
 */
export async function reorderQuestionOptions(
  items: ReorderItem[],
): Promise<ApiResponse<void>> {
  try {
    if (items.length === 0) {
      return { success: false, error: 'At least one item is required for reordering.' };
    }

    // ── Validate all inputs before mutating ─────────────────────────────
    for (const item of items) {
      validateUUID(item.optionId, 'optionId');

      if (item.displayOrder < 1) {
        return {
          success: false,
          error: `displayOrder must be 1 or greater for option: ${item.optionId}`,
        };
      }
    }

    // Check for duplicate display orders
    const orders = items.map((i) => i.displayOrder);
    const uniqueOrders = new Set(orders);
    if (uniqueOrders.size !== orders.length) {
      return {
        success: false,
        error: 'Duplicate display order values detected. Each option must have a unique order.',
      };
    }

    // ── Execute updates ─────────────────────────────────────────────────
    for (const item of items) {
      const { error } = await supabase
        .from('question_options')
        .update({ order_sequence: item.displayOrder })
        .eq('option_id', item.optionId);

      if (error) {
        if (error.code === 'PGRST116') {
          return {
            success: false,
            error: `Option not found: ${item.optionId}. Reordering stopped.`,
          };
        }

        // Unique violation on (question_id, order_sequence)
        if (error.code === '23505') {
          return {
            success: false,
            error:
              `Cannot set option ${item.optionId} to display order ${item.displayOrder}: ` +
              'another option already has this order. Refresh and try again.',
          };
        }

        return { success: false, error: extractErrorMessage(error) };
      }
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}
