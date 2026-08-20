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
import { resolveCurrentTeacherId } from '../content/teacherResolver';
import {
  getOptionImages,
  uploadOptionImage,
  deleteOptionImage,
  replaceOptionImage,
  reorderOptionImages,
} from '../questionOptionImageService';
import {
  uploadQuestionImage,
  deleteQuestionImage,
} from './questionImageService';
import {
  createQuestionOption,
  getQuestionOptions,
} from './questionOptionService';
import { auditService } from '../audit/auditService';
import { canApproveAcademicResources } from '../admin/approvalGuard';
import type {
  ApiResponse,
  PaginatedResponse,
  PaginationParams,
  SortDirection,
} from '../../types/academic';
import type {
  Question,
  QuestionStatus,
  QuestionDetail,
  QuestionOptionWithImages,
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
      .select('*', { count: 'exact' })
      .is('deleted_at', null);

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
      .is('deleted_at', null)
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
    // We do NOT validate input.createdBy as a UUID here because we override
    // it with the resolved teacher_details.teacher_id below.

    if (input.parentQuestionId) {
      validateUUID(input.parentQuestionId, 'parentQuestionId');
    }

    // ── Resolve creator authorization & profile ID ─────────────────────────
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user?.id) {
      return { success: false, error: 'User is not authenticated.' };
    }
    const currentUserId = userData.user.id;

    // 1. Check if the caller is an Admin (Super Admin or Academic Admin)
    const isAdmin = await canApproveAcademicResources();

    let creatorProfileId: string;
    let targetStatus: QuestionStatus;
    let approvedBy: string | null = null;
    let approvedAt: string | null = null;

    const now = new Date().toISOString();

    if (isAdmin) {
      // Super Admin or Academic Admin: direct auto-publish
      creatorProfileId = currentUserId;
      targetStatus = 'published';
      approvedBy = currentUserId;
      approvedAt = now;
    } else {
      // Teacher creator: must have a valid teacher_details record
      const resolved = await resolveCurrentTeacherId();
      if (!resolved) {
        return {
          success: false,
          error:
            'Cannot create question: you must be an authorized teacher or academic administrator.',
        };
      }
      creatorProfileId = currentUserId;
      targetStatus = input.status ?? 'draft';
      approvedBy = null;
      approvedAt = null;
    }

    // ── Build DB record (created_by uses profiles.profile_id) ───────────────
    const dbRecord: Record<string, unknown> = {
      institute_id: input.instituteId,
      subject_id: input.subjectId,
      chapter_id: input.chapterId,
      created_by: creatorProfileId,
      approved_by: approvedBy,
      approved_at: approvedAt,
      created_at: now,
      updated_at: now,
      parent_question_id: input.parentQuestionId ?? null,
      question_type: input.questionType,
      difficulty: input.difficulty,
      status: targetStatus,
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
      console.group('QUESTION CREATE ERROR');
      console.log('code:', error.code);
      console.log('message:', error.message);
      console.log('details:', error.details ?? '—');
      console.log('hint:', error.hint ?? '—');
      console.groupEnd();

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

    const createdQuestion = mapQuestion(data);

    // ── Post-insert: explanation → stem images → options → option images ──
    // All steps are wrapped in a single try/catch so any failure triggers
    // a full rollback that leaves the database as if nothing happened.

    const questionId = createdQuestion.questionId;
    // createdExplanationId tracked for documentation; rollback handled by
    // ON DELETE CASCADE from the questions FK constraint.
    const uploadedStemImageIds: string[] = [];
    const createdOptionIds: string[] = [];
    const uploadedImageIds: string[] = [];

    try {
      // ── Phase 1: Insert explanation (if any fields provided) ────────────
      const hasExplanationContent =
        input.explanationText?.trim() ||
        input.explanationVideoUrl?.trim() ||
        input.correctNumericalAnswer != null ||
        input.numericalTolerance != null ||
        input.correctTextAnswer?.trim();

      if (hasExplanationContent) {
        const explRecord: Record<string, unknown> = {
          question_id: questionId,
          institute_id: input.instituteId,
          explanation_text: input.explanationText?.trim() ?? null,
          explanation_video_url: input.explanationVideoUrl?.trim() ?? null,
          correct_numerical_answer: input.correctNumericalAnswer ?? null,
          numerical_tolerance: input.numericalTolerance ?? null,
          correct_text_answer: input.correctTextAnswer?.trim() ?? null,
        };

        const { data: explData, error: explError } = await supabase
          .from('question_explanations')
          .insert(explRecord)
          .select()
          .single();

        if (explError) {
          throw new Error(`Failed to create explanation: ${explError.message}`);
        }

      }

      // ── Phase 2: Upload stem/explanation images (if any) ────────────────
      if (input.images && input.images.length > 0) {
        for (let i = 0; i < input.images.length; i++) {
          const imageEntry = input.images[i];
          const imgResult = await uploadQuestionImage({
            questionId,
            instituteId: input.instituteId,
            file: imageEntry.file,
            imageRole: imageEntry.imageRole,
            altText: imageEntry.altText,
            orderSequence: imageEntry.displayOrder ?? i + 1,
          });

          if (!imgResult.success || !imgResult.data) {
            throw new Error(`Stem image upload failed: ${imgResult.error}`);
          }

          uploadedStemImageIds.push(imgResult.data.imageId);
        }
      }

      // ── Phase 2: Create options with option images (if any) ────────────
      if (input.options && input.options.length > 0) {
        for (const optionEntry of input.options) {
          // Create the option
          const optResult = await createQuestionOption({
            questionId,
            instituteId: input.instituteId,
            optionText: optionEntry.optionText,
            isCorrect: optionEntry.isCorrect,
            orderSequence: optionEntry.orderSequence,
          });

          if (!optResult.success || !optResult.data) {
            throw new Error(optResult.error ?? 'Failed to create option.');
          }

          const optionId = optResult.data.optionId;
          createdOptionIds.push(optionId);

          // Upload images for this option if any
          if (optionEntry.images && optionEntry.images.length > 0) {
            for (const imageEntry of optionEntry.images) {
              const imgResult = await uploadOptionImage({
                optionId,
                questionId,
                instituteId: input.instituteId,
                file: imageEntry.file,
                altText: imageEntry.altText,
                displayOrder: imageEntry.displayOrder,
              });

              if (!imgResult.success || !imgResult.data) {
                throw new Error(`Option image upload failed: ${imgResult.error}`);
              }

              uploadedImageIds.push(imgResult.data.optionImageId);
            }
          }
        }
      }
    } catch (optError: any) {
      // ── Full rollback: delete everything created so far ────────────────
      // The goal is to leave the database as if the request never happened.

      // 1. Delete uploaded stem images (storage files + question_images rows)
      for (const imageId of uploadedStemImageIds) {
        try {
          await deleteQuestionImage(imageId);
        } catch {
          // Best-effort — continue with remaining cleanup
        }
      }

      // 2. Delete uploaded option images (storage files + question_option_images rows)
      for (const imageId of uploadedImageIds) {
        try {
          await deleteOptionImage(imageId);
        } catch {
          // Best-effort
        }
      }

      // 3. Delete created options
      for (const optId of createdOptionIds) {
        try {
          await supabase
            .from('question_options')
            .delete()
            .eq('option_id', optId);
        } catch {
          // Best-effort
        }
      }

      // 4. Delete the question row itself (prevents orphan ghost questions)
      try {
        await supabase
          .from('questions')
          .delete()
          .eq('question_id', createdQuestion.questionId);
      } catch {
        // Best-effort
      }

      return {
        success: false,
        error: `Question created but image setup failed: ${optError.message}`,
      };
    }

    if (isAdmin) {
      await auditService.log({
        action: 'create',
        resourceType: 'questions',
        resourceId: createdQuestion.questionId,
        newValue: { status: 'published', createdBy: creatorProfileId },
        metadata: { questionId: createdQuestion.questionId, autoPublished: true },
      });
    }

    return { success: true, data: createdQuestion };
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

    let metadataUpdated = false;

    // ── Update question metadata if there are changes ────────────────────
    if (Object.keys(dbRecord).length > 0) {
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

      metadataUpdated = true;
    }

    // ── Process option image operations ─────────────────────────────────
    if (input.optionImageOps && input.optionImageOps.length > 0) {
      // Fetch the current question to resolve instituteId
      const currentQ = await getQuestionById(questionId);
      const instituteId = currentQ.success && currentQ.data
        ? currentQ.data.instituteId
        : '';

      for (const op of input.optionImageOps) {
        switch (op.action) {
          case 'add': {
            const result = await uploadOptionImage({
              optionId: op.optionId,
              questionId,
              instituteId,
              file: op.file,
              altText: op.altText,
              displayOrder: op.displayOrder,
            });
            if (!result.success) {
              return { success: false, error: `Failed to add option image: ${result.error}` };
            }
            break;
          }
          case 'delete': {
            const result = await deleteOptionImage(op.imageId);
            if (!result.success) {
              return { success: false, error: `Failed to delete option image: ${result.error}` };
            }
            break;
          }
          case 'replace': {
            const result = await replaceOptionImage(op.imageId, {
              file: op.file,
              altText: op.altText !== undefined ? op.altText : undefined,
              questionId,
            });
            if (!result.success) {
              return { success: false, error: `Failed to replace option image: ${result.error}` };
            }
            break;
          }
          case 'reorder': {
            const result = await reorderOptionImages(op.optionId, op.imageOrder);
            if (!result.success) {
              return { success: false, error: `Failed to reorder option images: ${result.error}` };
            }
            break;
          }
        }
      }
    }

    // ── Return updated question ─────────────────────────────────────────
    return getQuestionById(questionId);
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Soft-delete a question (Phase 8B Enterprise Soft Delete).
 *
 * Sets `deleted_at` / `deleted_by` / `delete_reason` on the question and its
 * child rows (options, option images, stem images, explanations). No row is
 * physically deleted and storage files are preserved so the question can be
 * restored from the Recycle Bin (Phase 8C).
 *
 * @param questionId - The UUID of the question to delete.
 * @param reason     - Optional reason captured for audit / delete_reason.
 *
 * @example
 * const result = await deleteQuestion('uuid-here');
 * if (result.success) {
 *   // question moved to trash (recoverable)
 * }
 */
export async function deleteQuestion(questionId: string, reason?: string): Promise<ApiResponse<void>> {
  try {
    validateUUID(questionId, 'questionId');

    // ── Resolve the acting profile (profiles.profile_id = auth.users.id) ─
    const { data: { user } } = await supabase.auth.getUser();
    const deletedBy = user?.id ?? null;
    const now = new Date().toISOString();
    const softDeleteFields = {
      deleted_at: now,
      deleted_by: deletedBy,
      delete_reason: reason ?? null,
    };

    // ── Soft-delete children first (they carry deleted_at since 080) ────
    // Options must be resolved for question_option_images (keyed by option_id).
    const { data: options } = await supabase
      .from('question_options')
      .select('option_id')
      .eq('question_id', questionId);

    const optionIds = (options ?? []).map((o) => o.option_id);

    if (optionIds.length > 0) {
      const { error: imgError } = await supabase
        .from('question_option_images')
        .update(softDeleteFields)
        .in('option_id', optionIds);

      if (imgError) {
        return { success: false, error: `Failed to soft-delete option images: ${extractErrorMessage(imgError)}` };
      }

      const { error: optError } = await supabase
        .from('question_options')
        .update(softDeleteFields)
        .eq('question_id', questionId);

      if (optError) {
        return { success: false, error: `Failed to soft-delete options: ${extractErrorMessage(optError)}` };
      }
    }

    // Stem images and explanations also ride along with the parent.
    // Best-effort: these children may not exist for every question and the
    // rows are only hidden — errors here must never fail the soft delete.
    await supabase
      .from('question_images')
      .update(softDeleteFields)
      .eq('question_id', questionId);

    await supabase
      .from('question_explanations')
      .update(softDeleteFields)
      .eq('question_id', questionId);

    // ── Soft-delete the question itself ──────────────────────────────────
    const { error } = await supabase
      .from('questions')
      .update(softDeleteFields)
      .eq('question_id', questionId);

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    // ── Audit (non-strict: never breaks the operation) ──────────────────
    await auditService.logSoftDelete({
      resourceType: 'questions',
      resourceId: questionId,
      metadata: { questionId, deletedAt: now, deletedBy },
      reason,
    });

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
//  getQuestion() — Full question detail with nested options and images
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch a question with all its options and option images fully resolved.
 *
 * The frontend receives a single nested response:
 *   question
 *     ├── options[]
 *     │     └── images[]
 *
 * without making additional service calls.
 *
 * @param questionId - The UUID of the question to retrieve.
 *
 * @example
 * const result = await getQuestion('uuid-here');
 * if (result.success) {
 *   console.log(result.data.questionText);
 *   console.log(result.data.options[0].images); // OptionImageInfo[]
 * }
 */
export async function getQuestion(questionId: string): Promise<ApiResponse<QuestionDetail>> {
  try {
    validateUUID(questionId, 'questionId');

    // ── 1. Fetch the question ───────────────────────────────────────────
    const questionResult = await getQuestionById(questionId);
    if (!questionResult.success || !questionResult.data) {
      return { success: false, error: questionResult.error ?? `Question not found: ${questionId}` };
    }

    // ── 2. Fetch options for the question ───────────────────────────────
    const optionsResult = await getQuestionOptions(questionId);
    if (!optionsResult.success) {
      return { success: false, error: `Failed to fetch options: ${optionsResult.error}` };
    }

    const options = optionsResult.data ?? [];

    // ── 3. Fetch option images for all options in a single query ────────
    const optionIds = options.map((o) => o.optionId);
    let imageMap = new Map<string, Array<{
      optionImageId: string;
      storageBucket: string;
      storagePath: string;
      altText: string | null;
      displayOrder: number;
    }>>();

    if (optionIds.length > 0) {
      const { data: images, error: imgError } = await supabase
        .from('question_option_images')
        .select('*')
        .in('option_id', optionIds)
        .order('display_order', { ascending: true });

      if (imgError) {
        return { success: false, error: `Failed to fetch option images: ${extractErrorMessage(imgError)}` };
      }

      // Group images by option_id
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

    // ── 4. Assemble the nested response ─────────────────────────────────
    const optionsWithImages: QuestionOptionWithImages[] = options.map((opt) => ({
      optionId: opt.optionId,
      questionId: opt.questionId,
      instituteId: opt.instituteId,
      optionText: opt.optionText,
      isCorrect: opt.isCorrect,
      orderSequence: opt.orderSequence,
      createdAt: opt.createdAt,
      images: imageMap.get(opt.optionId) ?? [],
    }));

    const detail: QuestionDetail = {
      ...questionResult.data,
      options: optionsWithImages,
    };

    return { success: true, data: detail };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  duplicateQuestion() — Full question duplication
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Duplicate a question along with its options and option image metadata.
 *
 * The new question is created as a `draft` with `parentQuestionId` pointing
 * to the source question. The duplication workflow:
 *
 *   1. Fetch the source question with its options and option images.
 *   2. Create a new question with the same metadata.
 *   3. Create new options with the same text and ordering.
 *   4. Option image DB rows are duplicated with the same storage paths
 *      (storage files are NOT re-uploaded — the duplicate references the
 *      same storage objects, avoiding storage costs and upload time).
 *
 * **Storage limitation:** The duplicated option images reference the same
 * Supabase Storage objects as the original. If the original question is
 * later deleted, its storage files will be removed, breaking the
 * duplicate's images. For production use with long-lived duplicates,
 * consider copying storage files. This limitation applies equally to stem
 * image duplication in the current codebase.
 *
 * @param questionId - The UUID of the question to duplicate.
 *
 * @example
 * const result = await duplicateQuestion('uuid-here');
 * if (result.success) {
 *   console.log(result.data.questionId); // new question ID
 * }
 */
export async function duplicateQuestion(questionId: string): Promise<ApiResponse<QuestionDetail>> {
  try {
    validateUUID(questionId, 'questionId');

    // ── 1. Fetch the full source question with options and images ───────
    const sourceResult = await getQuestion(questionId);
    if (!sourceResult.success || !sourceResult.data) {
      return { success: false, error: sourceResult.error ?? `Source question not found: ${questionId}` };
    }

    const source = sourceResult.data;

    // ── 2. Create a new question based on the source ────────────────────
    const createResult = await createQuestion({
      instituteId: source.instituteId,
      subjectId: source.subjectId,
      chapterId: source.chapterId,
      createdBy: source.createdBy,
      parentQuestionId: questionId, // Link duplicate to source
      questionType: source.questionType,
      difficulty: source.difficulty,
      status: 'draft',
      questionText: source.questionText,
      marks: source.marks,
      negativeMarks: source.negativeMarks,
      // Do NOT pass options here — we handle them manually below
    });

    if (!createResult.success || !createResult.data) {
      return { success: false, error: `Failed to create duplicate question: ${createResult.error}` };
    }

    const newQuestionId = createResult.data.questionId;
    const newInstituteId = source.instituteId;

    // ── 3. Duplicate options (with image metadata) ──────────────────────
    const newOptionIds: string[] = [];
    const duplicatedImageIds: string[] = [];

    try {
      for (const srcOption of source.options) {
        // Create the new option
        const optResult = await createQuestionOption({
          questionId: newQuestionId,
          instituteId: newInstituteId,
          optionText: srcOption.optionText,
          isCorrect: srcOption.isCorrect,
          orderSequence: srcOption.orderSequence,
        });

        if (!optResult.success || !optResult.data) {
          throw new Error(optResult.error ?? 'Failed to create duplicate option.');
        }

        const newOptionId = optResult.data.optionId;
        newOptionIds.push(newOptionId);

        // Duplicate option image DB rows (reference same storage files)
        for (const srcImage of srcOption.images) {
          const { data: insertedImage, error: insertImgError } = await supabase
            .from('question_option_images')
            .insert({
              option_id: newOptionId,
              institute_id: newInstituteId,
              storage_bucket: srcImage.storageBucket,
              storage_path: srcImage.storagePath,
              alt_text: srcImage.altText,
              display_order: srcImage.displayOrder,
            })
            .select()
            .single();

          if (insertImgError) {
            throw new Error(`Failed to duplicate option image: ${extractErrorMessage(insertImgError)}`);
          }

          duplicatedImageIds.push(insertedImage.option_image_id);
        }
      }
    } catch (dupError: any) {
      // ── Rollback: clean up duplicated images and options ──────────────
      for (const imgId of duplicatedImageIds) {
        try {
          await deleteOptionImage(imgId);
        } catch {
          // Best-effort
        }
      }
      for (const optId of newOptionIds) {
        try {
          await supabase.from('question_options').delete().eq('option_id', optId);
        } catch {
          // Best-effort
        }
      }

      return {
        success: false,
        error: `Question duplicated but option setup failed: ${dupError.message}`,
      };
    }

    // ── 4. Return the new full question detail ──────────────────────────
    return getQuestion(newQuestionId);
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
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
