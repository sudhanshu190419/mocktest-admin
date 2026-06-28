/**
 * Question Service
 *
 * Clean-architecture service layer encapsulating all Question CRUD operations
 * and lifecycle management within the question bank.
 *
 * Every public method returns a standardised `ApiResponse<T>` shape so that
 * consumers (hooks, screens, etc.) never need to handle raw Supabase
 * exceptions or error formats.
 *
 * ## Architecture decisions
 *
 * 1. **RLS is respected.** This service uses the anon key — all queries run
 *    within the context of the authenticated user. RLS policies in the
 *    database control what rows each user can see, insert, update, or delete.
 *
 * 2. **No service_role key.** This service never bypasses RLS. Row-level
 *    security is the sole access control mechanism.
 *
 * 3. **Clean mapping layer.** A single `mapQuestion` helper converts all
 *    snake_case database rows to camelCase TypeScript interfaces, avoiding
 *    duplication across functions.
 *
 * 4. **Status transitions via dedicated functions.** publishQuestion,
 *    archiveQuestion, and restoreQuestion encapsulate the status state
 *    machine transitions separately from general updates.
 *
 * @module questionService
 */

import { supabase } from '../../config/supabase';
import { validateUUID, extractErrorMessage, buildPagination } from '../../utils/supabase';
import { buildPaginatedResponse } from '../../utils/response';
import type {
  ApiResponse,
  PaginatedResponse,
  PaginationParams,
  SortDirection,
} from '../../types/academic';
import type {
  Question,
  QuestionStatus,
  CreateQuestionInput,
  UpdateQuestionInput,
  QuestionFilters,
  QuestionSortOptions,
} from '../../types/mockTest';

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Maps camelCase sort keys to their snake_case database column names.
 * Unknown keys fall back to `created_at`.
 */
const SORT_FIELD_MAP: Record<string, string> = {
  questionText: 'question_text',
  difficulty: 'difficulty',
  marks: 'marks',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

/**
 * Valid lifecycle status transitions for the question state machine.
 *
 * Key: current status
 * Value: allowed next statuses
 *
 * @see supabase/migrations/005_domain_05_assessment.sql
 */
const VALID_TRANSITIONS: Record<QuestionStatus, QuestionStatus[]> = {
  draft: ['pending_approval', 'archived'],
  pending_approval: ['published', 'draft'],
  published: ['archived'],
  archived: ['draft'],
};

// ─── Database Row Shape ────────────────────────────────────────────────────

/**
 * Raw snake_case shape of the `questions` table returned by Supabase.
 *
 * This type is internal to the service layer and is never exported.
 * Consumers receive only the camelCase `Question` interface.
 */
interface DbQuestion {
  question_id: string;
  institute_id: string;
  subject_id: string;
  chapter_id: string;
  created_by: string;
  approved_by: string | null;
  parent_question_id: string | null;
  question_type: string;
  difficulty: string;
  status: string;
  version: number;
  question_text: string;
  marks: number;
  negative_marks: number;
  average_time_seconds: number | null;
  times_attempted: number;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
}

// ─── Mapping Helpers ────────────────────────────────────────────────────────

/**
 * Converts a raw snake_case database row into a camelCase `Question` interface.
 *
 * This is the single source of truth for the mapping. If the schema changes
 * or new fields are added, update this function in one place.
 */
function mapQuestion(db: DbQuestion): Question {
  return {
    questionId: db.question_id,
    instituteId: db.institute_id,
    subjectId: db.subject_id,
    chapterId: db.chapter_id,
    createdBy: db.created_by,
    approvedBy: db.approved_by,
    parentQuestionId: db.parent_question_id,
    questionType: db.question_type as Question['questionType'],
    difficulty: db.difficulty as Question['difficulty'],
    status: db.status as QuestionStatus,
    version: db.version,
    questionText: db.question_text,
    marks: db.marks,
    negativeMarks: db.negative_marks,
    averageTimeSeconds: db.average_time_seconds,
    timesAttempted: db.times_attempted,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
    approvedAt: db.approved_at,
  };
}

/**
 * Converts a camelCase sort key from `QuestionSortOptions` to the
 * corresponding snake_case column name in the database.
 */
function mapSortField(sortBy: QuestionSortOptions['sortBy']): string {
  return SORT_FIELD_MAP[sortBy ?? 'createdAt'] ?? 'created_at';
}

/**
 * Validates that a status transition is allowed by the state machine.
 *
 * @returns An error message if the transition is invalid, or null if allowed.
 */
function validateTransition(
  currentStatus: QuestionStatus,
  nextStatus: QuestionStatus,
): string | null {
  const allowed = VALID_TRANSITIONS[currentStatus];
  if (!allowed) {
    return `Unknown current status: "${currentStatus}".`;
  }
  if (!allowed.includes(nextStatus)) {
    return `Invalid status transition: "${currentStatus}" → "${nextStatus}". Allowed: ${allowed.join(', ')}`;
  }
  return null;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch a paginated, filtered, and sorted list of questions.
 *
 * All parameters are optional. Sensible defaults are applied:
 * - page: 1
 * - pageSize: 20
 * - sortBy: created_at (descending)
 *
 * @param filters    - Optional filter criteria (instituteId, subjectId, chapterId,
 *                      difficulty, questionType, status, search, createdBy, ids).
 * @param sort       - Optional sort configuration (sortBy, sortDirection).
 * @param pagination - Optional pagination parameters (page, pageSize).
 *
 * @example
 * const result = await getQuestions(
 *   { instituteId: '...', subjectId: '...', status: 'published' },
 *   { sortBy: 'createdAt', sortDirection: 'desc' },
 *   { page: 1, pageSize: 20 },
 * );
 *
 * if (result.success) {
 *   console.log(result.data.data);    // Question[]
 *   console.log(result.data.count);   // total rows (for pagination)
 * }
 */
export async function getQuestions(
  filters?: QuestionFilters,
  sort?: QuestionSortOptions,
  pagination?: PaginationParams,
): Promise<ApiResponse<PaginatedResponse<Question>>> {
  try {
    // ── Build query ────────────────────────────────────────────────────
    let query = supabase
      .from('questions')
      .select('*', { count: 'exact' });

    // ── Apply filters ──────────────────────────────────────────────────
    if (filters?.instituteId) {
      validateUUID(filters.instituteId, 'instituteId');
      query = query.eq('institute_id', filters.instituteId);
    }

    if (filters?.subjectId) {
      validateUUID(filters.subjectId, 'subjectId');
      query = query.eq('subject_id', filters.subjectId);
    }

    if (filters?.chapterId) {
      validateUUID(filters.chapterId, 'chapterId');
      query = query.eq('chapter_id', filters.chapterId);
    }

    if (filters?.createdBy) {
      validateUUID(filters.createdBy, 'createdBy');
      query = query.eq('created_by', filters.createdBy);
    }

    if (filters?.difficulty) {
      query = query.eq('difficulty', filters.difficulty);
    }

    if (filters?.questionType) {
      query = query.eq('question_type', filters.questionType);
    }

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    if (filters?.isOriginal === true) {
      query = query.is('parent_question_id', null);
    } else if (filters?.hasParent === true) {
      query = query.not('parent_question_id', 'is', null);
    }

    if (filters?.search) {
      const searchTerm = `%${filters.search}%`;
      query = query.ilike('question_text', searchTerm);
    }

    if (filters?.ids && filters.ids.length > 0) {
      query = query.in('question_id', filters.ids);
    }

    if (filters?.minTimesAttempted !== undefined) {
      query = query.gte('times_attempted', filters.minTimesAttempted);
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

    const questions = (data ?? []).map(mapQuestion);

    return {
      success: true,
      data: buildPaginatedResponse(questions, count ?? 0, page, pageSize),
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Fetch a single question by its ID.
 *
 * @param questionId - The UUID of the question to retrieve.
 *
 * @example
 * const result = await getQuestionById('uuid-here');
 * if (result.success) {
 *   console.log(result.data.questionText);
 * }
 */
export async function getQuestionById(questionId: string): Promise<ApiResponse<Question>> {
  try {
    validateUUID(questionId, 'questionId');

    const { data, error } = await supabase
      .from('questions')
      .select('*')
      .eq('question_id', questionId)
      .single<DbQuestion>();

    if (error) {
      // PGRST116 = "The result contains 0 rows" — question not found
      if (error.code === 'PGRST116') {
        return { success: false, error: `Question not found: ${questionId}` };
      }

      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapQuestion(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Create a new question in the question bank.
 *
 * The `version` is set to 1 on creation. The `status` defaults to `'draft'`.
 * The `updated_by` is never set on creation — only updates populate this field.
 *
 * @param input - The question creation payload.
 *
 * @example
 * const result = await createQuestion({
 *   instituteId: 'uuid-here',
 *   subjectId: 'uuid-here',
 *   chapterId: 'uuid-here',
 *   createdBy: 'teacher-uuid',
 *   questionType: 'mcq',
 *   difficulty: 'medium',
 *   questionText: 'What is Newton's First Law?',
 *   marks: 4,
 *   negativeMarks: 1,
 * });
 */
export async function createQuestion(input: CreateQuestionInput): Promise<ApiResponse<Question>> {
  try {
    // ── Validate required fields ───────────────────────────────────────
    if (!input.instituteId) {
      return { success: false, error: 'instituteId is required.' };
    }

    if (!input.subjectId) {
      return { success: false, error: 'subjectId is required.' };
    }

    if (!input.chapterId) {
      return { success: false, error: 'chapterId is required.' };
    }

    if (!input.createdBy) {
      return { success: false, error: 'createdBy is required.' };
    }

    if (!input.questionType) {
      return { success: false, error: 'questionType is required.' };
    }

    if (!input.difficulty) {
      return { success: false, error: 'difficulty is required.' };
    }

    if (!input.questionText?.trim()) {
      return { success: false, error: 'Question text is required.' };
    }

    if (input.questionText.trim().length < 10) {
      return { success: false, error: 'Question text must be at least 10 characters.' };
    }

    // ── Validate UUID formats ──────────────────────────────────────────
    validateUUID(input.instituteId, 'instituteId');
    validateUUID(input.subjectId, 'subjectId');
    validateUUID(input.chapterId, 'chapterId');
    validateUUID(input.createdBy, 'createdBy');

    if (input.parentQuestionId) {
      validateUUID(input.parentQuestionId, 'parentQuestionId');
    }

    // ── Build DB record ────────────────────────────────────────────────
    const dbRecord: Record<string, unknown> = {
      institute_id: input.instituteId,
      subject_id: input.subjectId,
      chapter_id: input.chapterId,
      created_by: input.createdBy,
      parent_question_id: input.parentQuestionId ?? null,
      question_type: input.questionType,
      difficulty: input.difficulty,
      status: input.status ?? 'draft',
      version: 1,
      question_text: input.questionText.trim(),
      marks: input.marks ?? 1,
      negative_marks: input.negativeMarks ?? 0,
    };

    // ── Insert ─────────────────────────────────────────────────────────
    const { data, error } = await supabase
      .from('questions')
      .insert(dbRecord)
      .select()
      .single<DbQuestion>();

    if (error) {
      // Unique violation or FK constraint
      if (error.code === '23503') {
        return {
          success: false,
          error:
            'Cannot create this question. The referenced subject, chapter, or teacher does not exist.',
        };
      }

      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapQuestion(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Update an existing question.
 *
 * Only the fields provided in `input` are updated. Partial updates are
 * safe — omitted fields retain their current database values.
 *
 * Published questions with `timesAttempted > 0` block changes to
 * questionText, marks, and negativeMarks at the database level
 * (immutability guard trigger). This service does not enforce that
 * restriction — the database trigger handles it.
 *
 * @param questionId - The UUID of the question to update.
 * @param input      - The fields to update (all optional).
 *
 * @example
 * const result = await updateQuestion('uuid-here', {
 *   questionText: 'Updated question stem...',
 *   marks: 5,
 * });
 */
export async function updateQuestion(
  questionId: string,
  input: UpdateQuestionInput,
): Promise<ApiResponse<Question>> {
  try {
    validateUUID(questionId, 'questionId');

    // ── Build update payload (only provided fields) ────────────────────
    const dbRecord: Record<string, unknown> = {};

    if (input.subjectId !== undefined) {
      validateUUID(input.subjectId, 'subjectId');
      dbRecord.subject_id = input.subjectId;
    }

    if (input.chapterId !== undefined) {
      validateUUID(input.chapterId, 'chapterId');
      dbRecord.chapter_id = input.chapterId;
    }

    if (input.parentQuestionId !== undefined) {
      if (input.parentQuestionId === null) {
        dbRecord.parent_question_id = null;
      } else {
        validateUUID(input.parentQuestionId, 'parentQuestionId');
        dbRecord.parent_question_id = input.parentQuestionId;
      }
    }

    if (input.difficulty !== undefined) {
      dbRecord.difficulty = input.difficulty;
    }

    if (input.status !== undefined) {
      dbRecord.status = input.status;
    }

    if (input.questionText !== undefined) {
      if (!input.questionText.trim()) {
        return { success: false, error: 'Question text cannot be empty.' };
      }
      if (input.questionText.trim().length < 10) {
        return { success: false, error: 'Question text must be at least 10 characters.' };
      }
      dbRecord.question_text = input.questionText.trim();
    }

    if (input.marks !== undefined) {
      if (input.marks <= 0) {
        return { success: false, error: 'Marks must be greater than 0.' };
      }
      dbRecord.marks = input.marks;
    }

    if (input.negativeMarks !== undefined) {
      if (input.negativeMarks < 0) {
        return { success: false, error: 'Negative marks cannot be negative.' };
      }
      dbRecord.negative_marks = input.negativeMarks;
    }

    // ── If nothing to update, return current ────────────────────────────
    if (Object.keys(dbRecord).length === 0) {
      return getQuestionById(questionId);
    }

    // ── Update ─────────────────────────────────────────────────────────
    const { data, error } = await supabase
      .from('questions')
      .update(dbRecord)
      .eq('question_id', questionId)
      .select()
      .single<DbQuestion>();

    if (error) {
      // PGRST116 = question not found
      if (error.code === 'PGRST116') {
        return { success: false, error: `Question not found: ${questionId}` };
      }

      // FK violation on subject, chapter, or teacher reference
      if (error.code === '23503') {
        return {
          success: false,
          error:
            'Cannot update this question. The referenced subject or chapter does not exist.',
        };
      }

      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapQuestion(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Permanently delete a question.
 *
 * The `questions` table has no `deleted_at` column, so this performs a hard
 * delete. If the question is referenced by foreign keys (mock_test_questions,
 * mock_answers, pyq_question_mappings), the `ON DELETE RESTRICT` constraint
 * in the database will prevent deletion and return an error.
 *
 * For the standard retirement path, use `archiveQuestion()` instead.
 *
 * @param questionId - The UUID of the question to delete.
 *
 * @example
 * const result = await deleteQuestion('uuid-here');
 * if (result.success) {
 *   // question permanently removed
 * }
 */
export async function deleteQuestion(questionId: string): Promise<ApiResponse<void>> {
  try {
    validateUUID(questionId, 'questionId');

    const { error } = await supabase
      .from('questions')
      .delete()
      .eq('question_id', questionId);

    if (error) {
      // Foreign-key violation (question has dependent rows)
      if (error.code === '23503') {
        return {
          success: false,
          error:
            'Cannot delete this question because it is used in one or more tests or has ' +
            'attempt history. Use archiveQuestion() to retire it instead.',
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
 * Publish a question, making it available for use in mock tests.
 *
 * Status transition: `pending_approval` → `published`
 *
 * Sets the `approved_at` timestamp to the current time. In a full workflow,
 * this is typically called by an admin after reviewing the question.
 *
 * @param questionId - The UUID of the question to publish.
 *
 * @example
 * const result = await publishQuestion('uuid-here');
 * if (result.success) {
 *   // question is now available for test composition
 * }
 */
export async function publishQuestion(questionId: string): Promise<ApiResponse<Question>> {
  return transitionStatus(questionId, 'published');
}

/**
 * Archive (retire) a question.
 *
 * Status transition: `published` → `archived`
 *
 * Archived questions are excluded from test composition but their data
 * is preserved for historical attempt references. Use `restoreQuestion()`
 * to bring an archived question back to draft for revision.
 *
 * @param questionId - The UUID of the question to archive.
 *
 * @example
 * const result = await archiveQuestion('uuid-here');
 * if (result.success) {
 *   // question retired from active use
 * }
 */
export async function archiveQuestion(questionId: string): Promise<ApiResponse<Question>> {
  return transitionStatus(questionId, 'archived');
}

/**
 * Restore an archived question back to draft for revision.
 *
 * Status transition: `archived` → `draft`
 *
 * After restoration, the question can be edited and resubmitted through
 * the approval workflow again.
 *
 * @param questionId - The UUID of the question to restore.
 *
 * @example
 * const result = await restoreQuestion('uuid-here');
 * if (result.success) {
 *   // question available for editing
 * }
 */
export async function restoreQuestion(questionId: string): Promise<ApiResponse<Question>> {
  return transitionStatus(questionId, 'draft');
}

// ═══════════════════════════════════════════════════════════════════════════
//  Internal Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Transitions a question to a new status, validating the state machine.
 *
 * This is the single internal helper for all status transitions. It:
 * 1. Validates the transition is allowed
 * 2. Fetches current question
 * 3. Executes the update with any associated audit fields
 *
 * @param questionId - The UUID of the question.
 * @param newStatus  - The target status.
 */
async function transitionStatus(
  questionId: string,
  newStatus: QuestionStatus,
): Promise<ApiResponse<Question>> {
  try {
    validateUUID(questionId, 'questionId');

    const existing = await getQuestionById(questionId);
    if (!existing.success || !existing.data) {
      return { success: false, error: `Question not found: ${questionId}` };
    }

    const transitionError = validateTransition(existing.data.status, newStatus);
    if (transitionError) {
      return { success: false, error: transitionError };
    }

    // Build update payload
    const dbUpdate: Record<string, unknown> = { status: newStatus };

    // Set approved_at when publishing (pending_approval → published)
    if (newStatus === 'published') {
      dbUpdate.approved_at = new Date().toISOString();
    }

    // Clear approved_at/approved_by only on rejection (pending_approval → draft).
    // Preserve the approval audit trail when archiving (published → archived)
    // so the question's review history is retained for future reference.
    if (newStatus === 'draft' && existing.data.status === 'pending_approval') {
      dbUpdate.approved_at = null;
      dbUpdate.approved_by = null;
    }

    const { data, error } = await supabase
      .from('questions')
      .update(dbUpdate)
      .eq('question_id', questionId)
      .select()
      .single<DbQuestion>();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapQuestion(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}
