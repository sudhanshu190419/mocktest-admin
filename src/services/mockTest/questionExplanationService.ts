/**
 * Question Explanation Service
 *
 * Clean-architecture service layer encapsulating all QuestionExplanation
 * CRUD operations and the upsert workflow used by the Question Editor.
 *
 * Every public method returns a standardised `ApiResponse<T>` shape so that
 * consumers (hooks, screens, etc.) never need to handle raw Supabase
 * exceptions or error formats.
 *
 * ## Key design points
 *
 * - **1:1 relationship with questions.** A question has at most one
 *   explanation row, enforced by a UNIQUE constraint on `question_id`.
 * - **Upsert is the recommended API.** `upsertQuestionExplanation` handles
 *   both create and update in a single call, making it the ideal entry
 *   point for the Question Editor.
 * - **Explanation access timing.** Explanation content must never be served
 *   to a student during an active attempt. This service does not enforce
 *   timing — that is the responsibility of the attempt delivery layer.
 *
 * @module questionExplanationService
 */

import { supabase } from '../../config/supabase';
import { validateUUID, extractErrorMessage } from '../../utils/supabase';
import type { ApiResponse } from '../../types/academic';
import type { QuestionExplanation } from '../../types/mockTest';

// ─── Database Row Shape ────────────────────────────────────────────────────

/**
 * Raw snake_case shape of the `question_explanations` table returned by Supabase.
 *
 * This type is internal to the service layer and is never exported.
 * Consumers receive only the camelCase `QuestionExplanation` interface.
 */
interface DbQuestionExplanation {
  explanation_id: string;
  question_id: string;
  institute_id: string;
  explanation_text: string | null;
  explanation_video_url: string | null;
  correct_numerical_answer: number | null;
  numerical_tolerance: number | null;
  created_at: string;
  updated_at: string;
}

// ─── Input Types ────────────────────────────────────────────────────────────

/**
 * Input for creating a question explanation.
 */
interface CreateExplanationInput {
  /** Parent question ID. */
  questionId: string;
  /** Institute that owns this explanation. */
  instituteId: string;
  /** Step-by-step solution text. */
  explanationText: string;
  /** Optional video solution URL. */
  videoUrl?: string | null;
  /** Correct answer for numerical questions. */
  correctNumericalAnswer?: number | null;
  /** Numerical tolerance for approximate matching. NULL = exact match. */
  numericalTolerance?: number | null;
}

/**
 * Input for updating a question explanation.
 */
interface UpdateExplanationInput {
  /** Updated solution text. */
  explanationText?: string | null;
  /** Updated video solution URL. */
  videoUrl?: string | null;
  /** Updated correct numerical answer. */
  correctNumericalAnswer?: number | null;
  /** Updated numerical tolerance. */
  numericalTolerance?: number | null;
}

// ─── Mapping Helpers ────────────────────────────────────────────────────────

/**
 * Converts a raw snake_case database row into a camelCase `QuestionExplanation`.
 */
function mapExplanation(db: DbQuestionExplanation): QuestionExplanation {
  return {
    explanationId: db.explanation_id,
    questionId: db.question_id,
    instituteId: db.institute_id,
    explanationText: db.explanation_text,
    explanationVideoUrl: db.explanation_video_url,
    correctNumericalAnswer: db.correct_numerical_answer,
    numericalTolerance: db.numerical_tolerance,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch the explanation for a given question.
 *
 * A question has at most one explanation row (enforced by UNIQUE constraint
 * on `question_id`). Returns the explanation if it exists, or an error if
 * no explanation has been authored yet.
 *
 * @param questionId - The UUID of the question.
 *
 * @example
 * const result = await getQuestionExplanation('question-uuid');
 * if (result.success) {
 *   console.log(result.data.explanationText);
 * }
 */
export async function getQuestionExplanation(
  questionId: string,
): Promise<ApiResponse<QuestionExplanation>> {
  try {
    validateUUID(questionId, 'questionId');

    const { data, error } = await supabase
      .from('question_explanations')
      .select('*')
      .eq('question_id', questionId)
      .single<DbQuestionExplanation>();

    if (error) {
      if (error.code === 'PGRST116') {
        return {
          success: false,
          error: `No explanation found for question: ${questionId}. Add an explanation before publishing.`,
        };
      }

      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapExplanation(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Fetch a single explanation by its ID.
 *
 * @param explanationId - The UUID of the explanation to retrieve.
 *
 * @example
 * const result = await getQuestionExplanationById('uuid-here');
 * if (result.success) {
 *   console.log(result.data.explanationText);
 * }
 */
export async function getQuestionExplanationById(
  explanationId: string,
): Promise<ApiResponse<QuestionExplanation>> {
  try {
    validateUUID(explanationId, 'explanationId');

    const { data, error } = await supabase
      .from('question_explanations')
      .select('*')
      .eq('explanation_id', explanationId)
      .single<DbQuestionExplanation>();

    if (error) {
      if (error.code === 'PGRST116') {
        return {
          success: false,
          error: `Question explanation not found: ${explanationId}`,
        };
      }

      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapExplanation(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Create a new question explanation.
 *
 * A question may have at most one explanation row. If an explanation already
 * exists for this question, the insert will fail with a unique constraint
 * violation. Use `upsertQuestionExplanation` for the Question Editor flow
 * that handles both create and update.
 *
 * @param input - The explanation creation payload.
 *
 * @example
 * const result = await createQuestionExplanation({
 *   questionId: 'uuid-here',
 *   instituteId: 'uuid-here',
 *   explanationText: 'Step-by-step solution...',
 *   videoUrl: 'https://...',
 * });
 */
export async function createQuestionExplanation(
  input: CreateExplanationInput,
): Promise<ApiResponse<QuestionExplanation>> {
  try {
    // ── Validate required fields ───────────────────────────────────────
    if (!input.questionId) {
      return { success: false, error: 'questionId is required.' };
    }

    if (!input.instituteId) {
      return { success: false, error: 'instituteId is required.' };
    }

    if (!input.explanationText?.trim()) {
      return { success: false, error: 'Explanation text is required.' };
    }

    // ── Validate UUIDs ─────────────────────────────────────────────────
    validateUUID(input.questionId, 'questionId');
    validateUUID(input.instituteId, 'instituteId');

    // ── Build DB record ────────────────────────────────────────────────
    const dbRecord: Record<string, unknown> = {
      question_id: input.questionId,
      institute_id: input.instituteId,
      explanation_text: input.explanationText.trim(),
      explanation_video_url: input.videoUrl ?? null,
      correct_numerical_answer: input.correctNumericalAnswer ?? null,
      numerical_tolerance: input.numericalTolerance ?? null,
    };

    // ── Insert ─────────────────────────────────────────────────────────
    const { data, error } = await supabase
      .from('question_explanations')
      .insert(dbRecord)
      .select()
      .single<DbQuestionExplanation>();

    if (error) {
      // FK violation: parent question does not exist
      if (error.code === '23503') {
        return {
          success: false,
          error: 'Cannot create explanation: the referenced question does not exist.',
        };
      }

      // Unique violation: explanation already exists for this question
      if (error.code === '23505') {
        return {
          success: false,
          error:
            'An explanation already exists for this question. ' +
            'Use upsertQuestionExplanation() or updateQuestionExplanation() to modify it.',
        };
      }

      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapExplanation(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Update an existing question explanation.
 *
 * Only the fields provided in `input` are updated. Partial updates are
 * safe — omitted fields retain their current database values.
 *
 * Explanations for questions that have been used in submitted attempts
 * should generally be treated as immutable. This service does not enforce
 * that restriction — the decision is left to the calling context.
 *
 * @param explanationId - The UUID of the explanation to update.
 * @param input         - The fields to update (all optional).
 *
 * @example
 * const result = await updateQuestionExplanation('uuid-here', {
 *   explanationText: 'Updated solution...',
 *   videoUrl: 'https://updated-video-url.com',
 * });
 */
export async function updateQuestionExplanation(
  explanationId: string,
  input: UpdateExplanationInput,
): Promise<ApiResponse<QuestionExplanation>> {
  try {
    validateUUID(explanationId, 'explanationId');

    // ── Build update payload (only provided fields) ────────────────────
    const dbRecord: Record<string, unknown> = {};

    if (input.explanationText !== undefined) {
      if (input.explanationText !== null && !input.explanationText.trim()) {
        return {
          success: false,
          error: 'Explanation text cannot be empty. Set to null to remove it.',
        };
      }
      dbRecord.explanation_text = input.explanationText;
    }

    if (input.videoUrl !== undefined) {
      dbRecord.explanation_video_url = input.videoUrl;
    }

    if (input.correctNumericalAnswer !== undefined) {
      dbRecord.correct_numerical_answer = input.correctNumericalAnswer;
    }

    if (input.numericalTolerance !== undefined) {
      dbRecord.numerical_tolerance = input.numericalTolerance;
    }

    // ── If nothing to update, return current ────────────────────────────
    if (Object.keys(dbRecord).length === 0) {
      return getQuestionExplanationById(explanationId);
    }

    // ── Update ─────────────────────────────────────────────────────────
    const { data, error } = await supabase
      .from('question_explanations')
      .update(dbRecord)
      .eq('explanation_id', explanationId)
      .select()
      .single<DbQuestionExplanation>();

    if (error) {
      if (error.code === 'PGRST116') {
        return {
          success: false,
          error: `Question explanation not found: ${explanationId}`,
        };
      }

      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapExplanation(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Permanently delete a question explanation.
 *
 * @param explanationId - The UUID of the explanation to delete.
 *
 * @example
 * const result = await deleteQuestionExplanation('uuid-here');
 * if (result.success) {
 *   // explanation removed
 * }
 */
export async function deleteQuestionExplanation(
  explanationId: string,
): Promise<ApiResponse<void>> {
  try {
    validateUUID(explanationId, 'explanationId');

    const { error } = await supabase
      .from('question_explanations')
      .delete()
      .eq('explanation_id', explanationId);

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Create or update the explanation for a question.
 *
 * This is the recommended API for the Question Editor. It checks whether
 * an explanation already exists for the given question and performs the
 * appropriate operation:
 *
 * - **Explanation exists:** updates the existing row with provided fields.
 * - **No explanation exists:** creates a new row (requires `instituteId`
 *   and `explanationText`).
 *
 * @param questionId  - The UUID of the question.
 * @param instituteId - The UUID of the institute (required only for creation).
 * @param input       - The explanation fields to upsert.
 *
 * @example
 * // Create new explanation
 * const result = await upsertQuestionExplanation('question-uuid', 'institute-uuid', {
 *   explanationText: 'Step-by-step solution...',
 *   videoUrl: 'https://...',
 * });
 *
 * @example
 * // Update existing explanation (instituteId is ignored when updating)
 * const result = await upsertQuestionExplanation('question-uuid', 'institute-uuid', {
 *   explanationText: 'Updated solution...',
 * });
 */
export async function upsertQuestionExplanation(
  questionId: string,
  instituteId: string,
  input: UpdateExplanationInput & { explanationText?: string | null },
): Promise<ApiResponse<QuestionExplanation>> {
  try {
    validateUUID(questionId, 'questionId');

    // ── Check if an explanation already exists ──────────────────────────
    const existing = await getQuestionExplanation(questionId);

    if (existing.success && existing.data) {
      // ── Update path ─────────────────────────────────────────────────
      return updateQuestionExplanation(existing.data.explanationId, input);
    }

    // ── Create path ────────────────────────────────────────────────────
    // Validate required fields for creation
    if (!instituteId) {
      return {
        success: false,
        error:
          'instituteId is required when creating a new explanation. ' +
          'No explanation exists for this question yet.',
      };
    }

    if (!input.explanationText?.trim()) {
      return {
        success: false,
        error:
          'explanationText is required when creating a new explanation. ' +
          'No explanation exists for this question yet.',
      };
    }

    validateUUID(instituteId, 'instituteId');

    return createQuestionExplanation({
      questionId,
      instituteId,
      explanationText: input.explanationText,
      videoUrl: input.videoUrl,
      correctNumericalAnswer: input.correctNumericalAnswer,
      numericalTolerance: input.numericalTolerance,
    });
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}
