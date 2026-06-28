/**
 * Mock Test Question Service
 *
 * Clean-architecture service layer encapsulating all operations on the
 * `mock_test_questions` junction table — the link between a mock test
 * and the questions it contains.
 *
 * Every public method returns a standardised `ApiResponse<T>` shape so that
 * consumers (hooks, screens, etc.) never need to handle raw Supabase
 * exceptions or error formats.
 *
 * ## Scope
 *
 * This service manages the `mock_test_questions` table only. It does NOT
 * manage:
 * - mock_tests (see mockTestService.ts)
 * - questions (see questionService.ts)
 * - attempts, answers, or results
 *
 * ## Architecture decisions
 *
 * 1. **Composite key.** The `mock_test_questions` table uses a composite
 *    primary key (`test_id`, `question_id`). Functions that accept a single
 *    `id` parameter use the compound format `testId::questionId` (double
 *    colon separated) to encode both parts.
 *
 * 2. **No snapshot logic yet.** The `question_snapshot` field is mapped and
 *    preserved through updates, but no snapshot-generation logic is
 *    implemented. This is reserved for the publish workflow.
 *
 * 3. **Validation-first.** Every mutation validates entity existence,
 *    institute-scope match, and uniqueness constraints before executing.
 *    The database enforces the same rules as a second line of defence.
 *
 * 4. **Bulk operations are transactional-primed.** Each bulk operation
 *    performs multiple Supabase calls sequentially. In a production
 *    deployment these should be wrapped in a single database transaction
 *    (e.g. via an Edge Function or Supabase RPC).
 *
 * @module mockTestQuestionService
 */

import { supabase } from '../../config/supabase';
import { validateUUID, extractErrorMessage } from '../../utils/supabase';
import type { ApiResponse } from '../../types/academic';
import type {
  MockTestQuestion,
  QuestionSnapshot,
} from '../../types/mockTest';

// ─── Local Types ────────────────────────────────────────────────────────────

/**
 * Assignment descriptor for bulk question operations.
 *
 * Defines which question to add to a test and how it should be scored.
 * `marks` is optional — when omitted, the service defaults to the
 * question's default marks value.
 */
export interface QuestionAssignment {
  /** The question to assign. */
  questionId: string;
  /** 1-indexed display order within the test. */
  orderSequence: number;
  /**
   * Marks for this question in this test.
   * When omitted, defaults to the question's `marks` value.
   */
  marks?: number;
  /**
   * Per-question negative marks override.
   * NULL means use the test-level default.
   */
  negativeMarksOverride?: number | null;
  /**
   * Optional section name for multi-section tests.
   */
  sectionName?: string | null;
}

/**
 * Item descriptor for reorder operations.
 *
 * `assignmentId` is the compound identifier in the format
 * `testId::questionId`.
 */
export interface ReorderItem {
  /** Compound identifier: `testId::questionId`. */
  assignmentId: string;
  /** New 1-indexed display order. */
  displayOrder: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Maps camelCase sort keys to their snake_case database column names.
 * Unknown keys fall back to `order_sequence`.
 */
const SORT_FIELD_MAP: Record<string, string> = {
  orderSequence: 'order_sequence',
  marks: 'marks',
  addedAt: 'added_at',
};

/**
 * Default maximum number of questions allowed in a single test.
 * Configurable by importing and overriding this constant.
 */
export const DEFAULT_MAX_QUESTIONS = 200;

// ─── Database Row Shape ────────────────────────────────────────────────────

/**
 * Raw snake_case shape of the `mock_test_questions` table.
 */
interface DbMockTestQuestion {
  test_id: string;
  question_id: string;
  order_sequence: number;
  marks: number;
  negative_marks_override: number | null;
  section_name: string | null;
  question_snapshot: unknown | null;
  added_at: string;
}

/**
 * Raw snake_case shape of the `questions` table (subset needed for validation).
 */
interface DbQuestionBrief {
  question_id: string;
  institute_id: string;
  marks: number;
  negative_marks: number;
  status: string;
}

/**
 * Raw snake_case shape of the `mock_tests` table (subset needed for validation).
 */
interface DbMockTestBrief {
  test_id: string;
  institute_id: string;
  status: string;
}

// ─── Compound ID Helpers ────────────────────────────────────────────────────

/**
 * Builds a compound identifier string from a test ID and question ID.
 *
 * Format: `testId::questionId`
 */
function buildAssignmentId(testId: string, questionId: string): string {
  return `${testId}::${questionId}`;
}

/**
 * Parses a compound identifier string into its component UUIDs.
 *
 * @throws An error if the format is invalid or either UUID is malformed.
 */
function parseAssignmentId(id: string): { testId: string; questionId: string } {
  const parts = id.split('::');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(
      `Invalid assignment ID: "${id}". Expected format: "testId::questionId".`,
    );
  }
  validateUUID(parts[0], 'testId');
  validateUUID(parts[1], 'questionId');

  return { testId: parts[0], questionId: parts[1] };
}

// ─── Mapping Helpers ────────────────────────────────────────────────────────

/**
 * Converts a raw snake_case database row into a camelCase `MockTestQuestion`.
 */
function mapMockTestQuestion(db: DbMockTestQuestion): MockTestQuestion {
  return {
    testId: db.test_id,
    questionId: db.question_id,
    orderSequence: db.order_sequence,
    marks: db.marks,
    negativeMarksOverride: db.negative_marks_override,
    sectionName: db.section_name,
    questionSnapshot: db.question_snapshot as QuestionSnapshot | null,
    addedAt: db.added_at,
  };
}

/**
 * Converts a camelCase sort key to its snake_case column name.
 */
function mapSortField(sortBy: string | undefined): string {
  return SORT_FIELD_MAP[sortBy ?? 'orderSequence'] ?? 'order_sequence';
}

// ─── Validation Helpers ─────────────────────────────────────────────────────

/**
 * Validates that the mock test exists and returns its basic info.
 */
async function validateMockTestExists(
  testId: string,
): Promise<ApiResponse<DbMockTestBrief>> {
  const { data, error } = await supabase
    .from('mock_tests')
    .select('test_id, institute_id, status')
    .eq('test_id', testId)
    .single<DbMockTestBrief>();

  if (error) {
    if (error.code === 'PGRST116') {
      return { success: false, error: `Mock test not found: ${testId}` };
    }
    return { success: false, error: extractErrorMessage(error) };
  }

  return { success: true, data };
}

/**
 * Validates that the question exists and returns its basic info.
 */
async function validateQuestionExists(
  questionId: string,
): Promise<ApiResponse<DbQuestionBrief>> {
  const { data, error } = await supabase
    .from('questions')
    .select('question_id, institute_id, marks, negative_marks, status')
    .eq('question_id', questionId)
    .single<DbQuestionBrief>();

  if (error) {
    if (error.code === 'PGRST116') {
      return { success: false, error: `Question not found: ${questionId}` };
    }
    return { success: false, error: extractErrorMessage(error) };
  }

  return { success: true, data };
}

/**
 * Checks if a question is already assigned to a test.
 */
async function isDuplicate(
  testId: string,
  questionId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('mock_test_questions')
    .select('test_id')
    .eq('test_id', testId)
    .eq('question_id', questionId)
    .maybeSingle();

  return data !== null;
}

/**
 * Gets the current count of questions in a test.
 */
async function getQuestionCount(testId: string): Promise<number> {
  const { count } = await supabase
    .from('mock_test_questions')
    .select('*', { count: 'exact', head: true })
    .eq('test_id', testId);

  return count ?? 0;
}

/**
 * Validates a list of assignments for consistency before bulk operations.
 *
 * Checks:
 * - All question UUIDs are valid
 * - All orderSequence values >= 1
 * - No duplicate questionIds within the batch
 * - No duplicate orderSequence values within the batch
 *
 * @returns An error message if validation fails, or null if all checks pass.
 */
function validateAssignments(
  assignments: QuestionAssignment[],
): string | null {
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

    if (a.marks !== undefined && (a.marks <= 0 || !Number.isFinite(a.marks))) {
      return `assignments[${i}].marks must be greater than 0 when provided, got ${a.marks}.`;
    }

    if (
      a.negativeMarksOverride !== undefined &&
      a.negativeMarksOverride !== null &&
      a.negativeMarksOverride < 0
    ) {
      return `assignments[${i}].negativeMarksOverride cannot be negative, got ${a.negativeMarksOverride}.`;
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

// ─── Public API ─────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════
//  Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch all questions assigned to a mock test, ordered by their display
 * sequence.
 *
 * @param testId - The UUID of the mock test.
 * @param sortBy - Optional sort field (orderSequence, marks, addedAt).
 * @param sortDir - Optional sort direction (asc, desc).
 *
 * @example
 * const result = await getMockTestQuestions('uuid-here');
 * if (result.success) {
 *   console.log(result.data); // MockTestQuestion[]
 * }
 */
export async function getMockTestQuestions(
  testId: string,
  sortBy?: 'orderSequence' | 'marks' | 'addedAt',
  sortDir?: 'asc' | 'desc',
): Promise<ApiResponse<MockTestQuestion[]>> {
  try {
    validateUUID(testId, 'testId');

    const sortField = mapSortField(sortBy);
    const direction = sortDir ?? 'asc';

    const { data, error } = await supabase
      .from('mock_test_questions')
      .select('*')
      .eq('test_id', testId)
      .order(sortField, { ascending: direction === 'asc' });

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    return {
      success: true,
      data: (data ?? []).map(mapMockTestQuestion),
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Fetch a single assignment by its compound identifier.
 *
 * The `id` parameter uses the format `testId::questionId`.
 *
 * @param id - Compound identifier in the format `testId::questionId`.
 *
 * @example
 * const result = await getMockTestQuestionById('uuid-test::uuid-question');
 * if (result.success) {
 *   console.log(result.data.marks);
 * }
 */
export async function getMockTestQuestionById(
  id: string,
): Promise<ApiResponse<MockTestQuestion>> {
  try {
    const { testId, questionId } = parseAssignmentId(id);

    const { data, error } = await supabase
      .from('mock_test_questions')
      .select('*')
      .eq('test_id', testId)
      .eq('question_id', questionId)
      .single<DbMockTestQuestion>();

    if (error) {
      if (error.code === 'PGRST116') {
        return {
          success: false,
          error: `Assignment not found: ${id}`,
        };
      }
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapMockTestQuestion(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Single Mutations
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Add a single question to a mock test.
 *
 * Performs full validation:
 * - Test exists and belongs to the same institute as the question
 * - Question exists and is published
 * - No duplicate question in the same test
 * - orderSequence >= 1
 * - Maximum question limit not exceeded
 * - Marks default to the question's default marks if not provided
 *
 * @param input - The assignment details.
 *
 * @example
 * const result = await addQuestionToMockTest({
 *   testId: 'uuid-here',
 *   questionId: 'uuid-here',
 *   orderSequence: 1,
 *   marks: 4,
 *   negativeMarksOverride: 1,
 *   sectionName: 'Physics',
 * });
 */
export async function addQuestionToMockTest(input: {
  testId: string;
  questionId: string;
  orderSequence: number;
  marks?: number;
  negativeMarksOverride?: number | null;
  sectionName?: string | null;
  maxQuestions?: number;
}): Promise<ApiResponse<MockTestQuestion>> {
  try {
    const maxQuestions = input.maxQuestions ?? DEFAULT_MAX_QUESTIONS;

    // ── Validate basic input ───────────────────────────────────────────
    if (!input.testId) {
      return { success: false, error: 'testId is required.' };
    }

    if (!input.questionId) {
      return { success: false, error: 'questionId is required.' };
    }

    if (
      !Number.isInteger(input.orderSequence) ||
      input.orderSequence < 1
    ) {
      return {
        success: false,
        error: 'orderSequence must be a positive integer >= 1.',
      };
    }

    validateUUID(input.testId, 'testId');
    validateUUID(input.questionId, 'questionId');

    // ── Validate mock test exists ──────────────────────────────────────
    const testCheck = await validateMockTestExists(input.testId);
    if (!testCheck.success || !testCheck.data) {
      return { success: false, error: testCheck.error };
    }
    const mockTest = testCheck.data;

    // ── Validate question exists ───────────────────────────────────────
    const questionCheck = await validateQuestionExists(input.questionId);
    if (!questionCheck.success || !questionCheck.data) {
      return { success: false, error: questionCheck.error };
    }
    const question = questionCheck.data;

    // ── Institute scope validation ─────────────────────────────────────
    if (question.institute_id !== mockTest.institute_id) {
      return {
        success: false,
        error:
          'Question belongs to a different institute than the mock test. ' +
          'Cross-institute assignments are not allowed.',
      };
    }

    // ── Prevent duplicates ─────────────────────────────────────────────
    const duplicate = await isDuplicate(input.testId, input.questionId);
    if (duplicate) {
      return {
        success: false,
        error:
          'This question is already assigned to the mock test. ' +
          'Duplicate questions in the same test are not allowed.',
      };
    }

    // ── Check maximum question limit ───────────────────────────────────
    const currentCount = await getQuestionCount(input.testId);
    if (currentCount >= maxQuestions) {
      return {
        success: false,
        error: `Maximum question limit reached (${maxQuestions}). Cannot add more questions.`,
      };
    }

    // ── Build DB record ────────────────────────────────────────────────
    const marks = input.marks ?? question.marks;
    const negativeMarksOverride =
      input.negativeMarksOverride !== undefined
        ? input.negativeMarksOverride
        : null;

    if (marks <= 0 || !Number.isFinite(marks)) {
      return { success: false, error: 'Marks must be greater than 0.' };
    }

    if (
      negativeMarksOverride !== null &&
      negativeMarksOverride < 0
    ) {
      return {
        success: false,
        error: 'negativeMarksOverride cannot be negative.',
      };
    }

    const dbRecord: Record<string, unknown> = {
      test_id: input.testId,
      question_id: input.questionId,
      order_sequence: input.orderSequence,
      marks,
      negative_marks_override: negativeMarksOverride,
      section_name: input.sectionName ?? null,
      question_snapshot: null, // Reserved for publish workflow
    };

    // ── Insert ─────────────────────────────────────────────────────────
    const { data, error } = await supabase
      .from('mock_test_questions')
      .insert(dbRecord)
      .select()
      .single<DbMockTestQuestion>();

    if (error) {
      // Duplicate key violation (PK: test_id + question_id)
      if (error.code === '23505') {
        return {
          success: false,
          error:
            'This question is already assigned to the mock test. ' +
            'Duplicate questions in the same test are not allowed.',
        };
      }

      // FK violation
      if (error.code === '23503') {
        return {
          success: false,
          error:
            'Cannot add question to test. The mock test or question does not exist.',
        };
      }

      // Check constraint violation (order_sequence >= 1, marks > 0)
      if (error.code === '23514') {
        return {
          success: false,
          error:
            'A database constraint was violated. Ensure orderSequence >= 1 and marks > 0.',
        };
      }

      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapMockTestQuestion(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Update an existing assignment's scoring configuration or section grouping.
 *
 * Only the fields provided in `input` are updated. Omitted fields retain
 * their current database values.
 *
 * @param id - Compound identifier in the format `testId::questionId`.
 * @param input - The fields to update (all optional).
 *
 * @example
 * const result = await updateMockTestQuestion(
 *   'test-uuid::question-uuid',
 *   { orderSequence: 3, marks: 5 },
 * );
 */
export async function updateMockTestQuestion(
  id: string,
  input: {
    orderSequence?: number;
    section?: string | null;
    marksOverride?: number;
    negativeMarksOverride?: number | null;
  },
): Promise<ApiResponse<MockTestQuestion>> {
  try {
    const { testId, questionId } = parseAssignmentId(id);

    // ── Build update payload ───────────────────────────────────────────
    const dbRecord: Record<string, unknown> = {};

    if (input.orderSequence !== undefined) {
      if (!Number.isInteger(input.orderSequence) || input.orderSequence < 1) {
        return {
          success: false,
          error: 'orderSequence must be a positive integer >= 1.',
        };
      }
      dbRecord.order_sequence = input.orderSequence;
    }

    if (input.section !== undefined) {
      dbRecord.section_name = input.section;
    }

    if (input.marksOverride !== undefined) {
      if (input.marksOverride <= 0 || !Number.isFinite(input.marksOverride)) {
        return {
          success: false,
          error: 'marksOverride must be greater than 0.',
        };
      }
      dbRecord.marks = input.marksOverride;
    }

    if (input.negativeMarksOverride !== undefined) {
      if (
        input.negativeMarksOverride !== null &&
        input.negativeMarksOverride < 0
      ) {
        return {
          success: false,
          error: 'negativeMarksOverride cannot be negative.',
        };
      }
      dbRecord.negative_marks_override = input.negativeMarksOverride;
    }

    // ── If nothing to update, return current ────────────────────────────
    if (Object.keys(dbRecord).length === 0) {
      return getMockTestQuestionById(id);
    }

    // ── Update ─────────────────────────────────────────────────────────
    const { data, error } = await supabase
      .from('mock_test_questions')
      .update(dbRecord)
      .eq('test_id', testId)
      .eq('question_id', questionId)
      .select()
      .single<DbMockTestQuestion>();

    if (error) {
      // PGRST116 = not found (shouldn't happen with eq on both PK fields,
      // but handle it for safety)
      if (error.code === 'PGRST116') {
        return { success: false, error: `Assignment not found: ${id}` };
      }

      // Check constraint violation
      if (error.code === '23514') {
        return {
          success: false,
          error:
            'A database constraint was violated. Ensure orderSequence >= 1 and marks > 0.',
        };
      }

      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapMockTestQuestion(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Remove a question from a mock test.
 *
 * This is a hard delete of the junction row. The question itself is not
 * deleted — only removed from this test's question set.
 *
 * Once a test is published, the database trigger should block mutations
 * to `mock_test_questions`.
 *
 * @param id - Compound identifier in the format `testId::questionId`.
 *
 * @example
 * const result = await removeQuestionFromMockTest('test-uuid::question-uuid');
 * if (result.success) {
 *   // question removed from test
 * }
 */
export async function removeQuestionFromMockTest(
  id: string,
): Promise<ApiResponse<void>> {
  try {
    const { testId, questionId } = parseAssignmentId(id);

    const { error } = await supabase
      .from('mock_test_questions')
      .delete()
      .eq('test_id', testId)
      .eq('question_id', questionId);

    if (error) {
      // FK violation — shouldn't happen on delete of a junction row,
      // but handle it anyway.
      if (error.code === '23503') {
        return {
          success: false,
          error:
            'Cannot remove this question from the test. It has attempt ' +
            'history that references it. Archive the test instead.',
        };
      }

      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Bulk Operations
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Add multiple questions to a mock test in a single batch operation.
 *
 * Each assignment is validated individually before any insert is performed.
 * If any assignment fails validation, the entire batch is rejected (no
 * partial inserts).
 *
 * @param testId     - The UUID of the mock test.
 * @param assignments - Array of question assignments to add.
 * @param maxQuestions - Optional override for the maximum question limit.
 *
 * @example
 * const result = await addQuestionsToMockTest('uuid-here', [
 *   { questionId: 'q1-uuid', orderSequence: 1, marks: 4 },
 *   { questionId: 'q2-uuid', orderSequence: 2, marks: 5 },
 * ]);
 */
export async function addQuestionsToMockTest(
  testId: string,
  assignments: QuestionAssignment[],
  maxQuestions?: number,
): Promise<ApiResponse<MockTestQuestion[]>> {
  try {
    const limit = maxQuestions ?? DEFAULT_MAX_QUESTIONS;

    validateUUID(testId, 'testId');

    // ── Validate batch structure ───────────────────────────────────────
    const validationError = validateAssignments(assignments);
    if (validationError) {
      return { success: false, error: validationError };
    }

    // ── Validate mock test exists ──────────────────────────────────────
    const testCheck = await validateMockTestExists(testId);
    if (!testCheck.success || !testCheck.data) {
      return { success: false, error: testCheck.error };
    }
    const mockTest = testCheck.data;

    // ── Check maximum question limit ───────────────────────────────────
    const currentCount = await getQuestionCount(testId);
    if (currentCount + assignments.length > limit) {
      return {
        success: false,
        error: `Cannot add ${assignments.length} questions. The test currently has ${currentCount} questions, and the maximum is ${limit}.`,
      };
    }

    // ── Validate each assignment ───────────────────────────────────────
    const resolvedRecords: Record<string, unknown>[] = [];
    const seenQuestionIds = new Set<string>();

    for (let i = 0; i < assignments.length; i++) {
      const a = assignments[i];

      // Check for duplicates within the batch (already checked in
      // validateAssignments, but also check against already-seen)
      if (seenQuestionIds.has(a.questionId)) {
        return {
          success: false,
          error: `Duplicate question in batch: "${a.questionId}" at index ${i}.`,
        };
      }
      seenQuestionIds.add(a.questionId);

      // Check if already assigned to the test
      const duplicate = await isDuplicate(testId, a.questionId);
      if (duplicate) {
        return {
          success: false,
          error: `Question "${a.questionId}" at index ${i} is already assigned to this test.`,
        };
      }

      // Validate question exists and fetch its details
      const questionCheck = await validateQuestionExists(a.questionId);
      if (!questionCheck.success || !questionCheck.data) {
        return {
          success: false,
          error: `Question "${a.questionId}" at index ${i}: ${questionCheck.error}`,
        };
      }
      const question = questionCheck.data;

      // Institute scope validation
      if (question.institute_id !== mockTest.institute_id) {
        return {
          success: false,
          error: `Question "${a.questionId}" at index ${i} belongs to a different institute.`,
        };
      }

      // Resolve marks
      const marks = a.marks ?? question.marks;
      if (marks <= 0 || !Number.isFinite(marks)) {
        return {
          success: false,
          error: `Question "${a.questionId}" at index ${i}: marks must be greater than 0.`,
        };
      }

      const negativeMarksOverride =
        a.negativeMarksOverride !== undefined
          ? a.negativeMarksOverride
          : null;

      if (
        negativeMarksOverride !== null &&
        negativeMarksOverride < 0
      ) {
        return {
          success: false,
          error: `Question "${a.questionId}" at index ${i}: negativeMarksOverride cannot be negative.`,
        };
      }

      resolvedRecords.push({
        test_id: testId,
        question_id: a.questionId,
        order_sequence: a.orderSequence,
        marks,
        negative_marks_override: negativeMarksOverride,
        section_name: a.sectionName ?? null,
        question_snapshot: null, // Reserved for publish workflow
      });
    }

    // ── Bulk insert ────────────────────────────────────────────────────
    const { data, error } = await supabase
      .from('mock_test_questions')
      .insert(resolvedRecords)
      .select();

    if (error) {
      // Duplicate key — one of the questions was just added by another user
      if (error.code === '23505') {
        return {
          success: false,
          error:
            'One or more questions were already assigned to this test by another concurrent operation.',
        };
      }

      // FK violation
      if (error.code === '23503') {
        return {
          success: false,
          error:
            'One or more questions or the mock test does not exist.',
        };
      }

      return { success: false, error: extractErrorMessage(error) };
    }

    return {
      success: true,
      data: (data ?? []).map(mapMockTestQuestion),
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Replace all questions in a mock test with a new set.
 *
 * This is the primary editor API for composing a test's question list.
 *
 * Workflow:
 * 1. Validate all assignments (duplicates, structure, existence)
 * 2. Remove all existing assignments for the test
 * 3. Insert the new assignments
 * 4. Return the ordered result
 *
 * @param testId      - The UUID of the mock test.
 * @param assignments - The complete new set of question assignments.
 * @param maxQuestions - Optional override for the maximum question limit.
 *
 * @example
 * const result = await replaceMockTestQuestions('uuid-here', [
 *   { questionId: 'q1-uuid', orderSequence: 1, marks: 4 },
 *   { questionId: 'q2-uuid', orderSequence: 2, marks: 5 },
 * ]);
 */
export async function replaceMockTestQuestions(
  testId: string,
  assignments: QuestionAssignment[],
  maxQuestions?: number,
): Promise<ApiResponse<MockTestQuestion[]>> {
  try {
    const limit = maxQuestions ?? DEFAULT_MAX_QUESTIONS;

    validateUUID(testId, 'testId');

    // ── Validate batch structure ───────────────────────────────────────
    const validationError = validateAssignments(assignments);
    if (validationError) {
      return { success: false, error: validationError };
    }

    // ── Validate count against limit ───────────────────────────────────
    if (assignments.length > limit) {
      return {
        success: false,
        error: `Cannot set ${assignments.length} questions. The maximum is ${limit}.`,
      };
    }

    // ── Validate mock test exists ──────────────────────────────────────
    const testCheck = await validateMockTestExists(testId);
    if (!testCheck.success || !testCheck.data) {
      return { success: false, error: testCheck.error };
    }
    const mockTest = testCheck.data;

    // ── Validate each assignment ───────────────────────────────────────
    const resolvedRecords: Record<string, unknown>[] = [];

    for (let i = 0; i < assignments.length; i++) {
      const a = assignments[i];

      // Validate question exists and fetch details
      const questionCheck = await validateQuestionExists(a.questionId);
      if (!questionCheck.success || !questionCheck.data) {
        return {
          success: false,
          error: `Question "${a.questionId}" at index ${i}: ${questionCheck.error}`,
        };
      }
      const question = questionCheck.data;

      // Institute scope validation
      if (question.institute_id !== mockTest.institute_id) {
        return {
          success: false,
          error: `Question "${a.questionId}" at index ${i} belongs to a different institute.`,
        };
      }

      // Resolve marks
      const marks = a.marks ?? question.marks;
      if (marks <= 0 || !Number.isFinite(marks)) {
        return {
          success: false,
          error: `Question "${a.questionId}" at index ${i}: marks must be greater than 0.`,
        };
      }

      const negativeMarksOverride =
        a.negativeMarksOverride !== undefined
          ? a.negativeMarksOverride
          : null;

      if (
        negativeMarksOverride !== null &&
        negativeMarksOverride < 0
      ) {
        return {
          success: false,
          error: `Question "${a.questionId}" at index ${i}: negativeMarksOverride cannot be negative.`,
        };
      }

      resolvedRecords.push({
        test_id: testId,
        question_id: a.questionId,
        order_sequence: a.orderSequence,
        marks,
        negative_marks_override: negativeMarksOverride,
        section_name: a.sectionName ?? null,
        question_snapshot: null, // Reserved for publish workflow
      });
    }

    // ── Execute replace workflow ──────────────────────────────────────
    // Step 1: Remove all existing assignments for this test
    const { error: deleteError } = await supabase
      .from('mock_test_questions')
      .delete()
      .eq('test_id', testId);

    if (deleteError) {
      return { success: false, error: extractErrorMessage(deleteError) };
    }

    // Step 2: Insert the new assignments
    const { data, error: insertError } = await supabase
      .from('mock_test_questions')
      .insert(resolvedRecords)
      .select()
      .order('order_sequence', { ascending: true });

    if (insertError) {
      // FK violation
      if (insertError.code === '23503') {
        return {
          success: false,
          error:
            'One or more questions or the mock test does not exist.',
        };
      }

      return { success: false, error: extractErrorMessage(insertError) };
    }

    return {
      success: true,
      data: (data ?? []).map(mapMockTestQuestion),
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Reorder the questions in a mock test.
 *
 * Accepts an array of items, each specifying a compound assignment ID and
 * the new display order. Only the provided assignments' order is updated —
 * all other assignments retain their current order.
 *
 * @param testId - The UUID of the mock test.
 * @param items  - Array of reorder items with compound IDs and new positions.
 *
 * @example
 * const result = await reorderMockTestQuestions('uuid-here', [
 *   { assignmentId: 'test-uuid::q1-uuid', displayOrder: 3 },
 *   { assignmentId: 'test-uuid::q2-uuid', displayOrder: 1 },
 *   { assignmentId: 'test-uuid::q3-uuid', displayOrder: 2 },
 * ]);
 */
export async function reorderMockTestQuestions(
  testId: string,
  items: ReorderItem[],
): Promise<ApiResponse<MockTestQuestion[]>> {
  try {
    validateUUID(testId, 'testId');

    if (items.length === 0) {
      return { success: false, error: 'At least one reorder item is required.' };
    }

    // ── Validate items ─────────────────────────────────────────────────
    const seenOrders = new Set<number>();
    const assignmentItems: { testId: string; questionId: string; orderSequence: number }[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      let parsed: { testId: string; questionId: string };
      try {
        parsed = parseAssignmentId(item.assignmentId);
      } catch {
        return {
          success: false,
          error: `items[${i}].assignmentId is invalid: "${item.assignmentId}".`,
        };
      }

      // Verify the item's testId matches
      if (parsed.testId !== testId) {
        return {
          success: false,
          error: `items[${i}].assignmentId references a different test (${parsed.testId}). Expected: ${testId}.`,
        };
      }

      if (!Number.isInteger(item.displayOrder) || item.displayOrder < 1) {
        return {
          success: false,
          error: `items[${i}].displayOrder must be a positive integer >= 1.`,
        };
      }

      if (seenOrders.has(item.displayOrder)) {
        return {
          success: false,
          error: `Duplicate displayOrder in reorder items: ${item.displayOrder} at index ${i}.`,
        };
      }
      seenOrders.add(item.displayOrder);

      assignmentItems.push({
        testId: parsed.testId,
        questionId: parsed.questionId,
        orderSequence: item.displayOrder,
      });
    }

    // ── Update each assignment's order ─────────────────────────────────
    // In a production deployment, this should be a single RPC call.
    // For now, each update is executed sequentially.
    for (const item of assignmentItems) {
      const { error } = await supabase
        .from('mock_test_questions')
        .update({ order_sequence: item.orderSequence })
        .eq('test_id', item.testId)
        .eq('question_id', item.questionId);

      if (error) {
        if (error.code === 'PGRST116') {
          return {
            success: false,
            error: `Assignment not found: ${buildAssignmentId(item.testId, item.questionId)}.`,
          };
        }

        return { success: false, error: extractErrorMessage(error) };
      }
    }

    // ── Fetch and return the updated list ──────────────────────────────
    return getMockTestQuestions(testId, 'orderSequence', 'asc');
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}
