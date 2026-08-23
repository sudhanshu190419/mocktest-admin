/**
 * Mock Test Publish Service
 *
 * Orchestration layer responsible for the mock test publish workflow.
 * This is NOT a CRUD service — it composes functionality from existing
 * services (mockTestService, mockTestQuestionService, questionService)
 * to validate, prepare, and execute the publish operation.
 *
 * ## Responsibilities
 *
 * - Pre-publish validation (entity existence, state, consistency)
 * - Snapshot generation (freeze question data at publish time)
 * - Publish workflow orchestration
 * - Unpublish with guard (only when no attempts exist)
 *
 * ## Design decisions
 *
 * 1. **Reuse over raw queries.** This service never queries Supabase
 *    directly when an existing service already provides the data.
 *    Direct queries are used ONLY for data that no existing service
 *    exposes (e.g. attempt count for unpublish guard).
 *
 * 2. **Validation-first.** `validateMockTestReady()` runs a comprehensive
 *    checklist before any mutation occurs. The report pinpoints exactly
 *    what needs fixing.
 *
 * 3. **Orchestration, not implementation.** The actual status transition
 *    is delegated to `mockTestService.publishMockTest()` — this service
 *    only decides whether the operation should proceed.
 *
 * @module mockTestPublishService
 */

import { supabase } from '../../config/supabase';
import { extractErrorMessage, validateUUID } from '../../utils/supabase';
import { getMockTestById, publishMockTest } from './mockTestService';
import { getMockTestQuestions } from './mockTestQuestionService';
import { getQuestions } from './questionService';
import { getQuestionOptions } from './questionOptionService';
import { getQuestionExplanation } from './questionExplanationService';
import { getQuestionImages } from './questionImageService';
import { getOptionImages } from '../questionOptionImageService';
import type { ApiResponse } from '../../types/academic';
import type {
  MockTest,
  MockTestStatus,
  Question,
  QuestionSnapshot,
  QuestionSnapshotOption,
  QuestionSnapshotImage,
  QuestionSnapshotOptionImage,
} from '../../types/mockTest';

// ─── Public Types ───────────────────────────────────────────────────────────

/**
 * Detailed breakdown of each validation check performed by
 * `validateMockTestReady()`.
 */
export interface ValidationDetails {
  /** Whether the mock test row exists. */
  testExists: boolean;
  /** The test's current lifecycle status (or '-' if not found). */
  status: string;
  /** Whether the test has at least one question assigned. */
  hasQuestions: boolean;
  /** Whether all assigned questions exist in the question bank. */
  allQuestionsExist: boolean;
  /** Whether all assigned questions have status `published`. */
  allQuestionsPublished: boolean;
  /** Whether display orders are unique (no duplicates). */
  noDuplicateDisplayOrder: boolean;
  /** Whether there are no duplicate questions (enforced by PK). */
  noDuplicateQuestions: boolean;
  /** Whether all questions belong to the same institute as the test. */
  instituteMatch: boolean;
  /** Whether availability dates (if set) form a valid window. */
  validAvailabilityDates: boolean;
  /** Whether the test duration is greater than 0. */
  validDuration: boolean;
  /** Whether the computed total marks are greater than 0. */
  validTotalMarks: boolean;
  /** Whether passing marks (if set) is <= total marks. */
  validPassingMarks: boolean;
  /** Computed sum of marks across all assigned questions. */
  computedTotalMarks: number;
  /** Number of questions currently assigned to the test. */
  questionCount: number;
}

/**
 * Comprehensive validation report returned by `validateMockTestReady()`.
 */
export interface ValidationReport {
  /** True when ALL checks pass and the test is ready to publish. */
  isValid: boolean;
  /** Human-readable error messages for each failed check. */
  errors: string[];
  /** Non-blocking warnings (e.g. no description set). */
  warnings: string[];
  /** Per-check detail for programmatic inspection. */
  details: ValidationDetails;
}

/**
 * Summary returned by `publishMockTestWorkflow()` on success.
 */
export interface PublishSummary {
  /** The published test's UUID. */
  testId: string;
  /** Status before the transition (draft or pending_approval). */
  previousStatus: MockTestStatus;
  /** Status after the transition (published). */
  newStatus: 'published';
  /** ISO-8601 timestamp of the publish event. */
  publishedAt: string;
  /** Number of questions frozen in the test. */
  questionCount: number;
  /** Total marks across all questions at publish time. */
  totalMarks: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const VALID_PRE_PUBLISH_STATUSES: MockTestStatus[] = ['draft', 'pending_approval', 'archived'];

/** The current schema version for question snapshots. Bump when the shape changes. */
const SNAPSHOT_VERSION = 1;

// ═══════════════════════════════════════════════════════════════════════════
//  Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Runs a comprehensive validation checklist to determine whether a mock
 * test is ready to be published.
 *
 * Checks performed (in order):
 *  1. Mock test exists
 *  2. Status is `draft` or `pending_approval`
 *  3. At least one question is assigned
 *  4. All assigned questions exist in the question bank
 *  5. All assigned questions have status `published`
 *  6. No duplicate displayOrder values
 *  7. No duplicate questions (structural — PK enforces this)
 *  8. All questions belong to the same institute as the test
 *  9. Availability dates (if set) form a valid window
 * 10. durationMin > 0
 * 11. Total marks > 0 (computed from mock_test_questions)
 *
 * @param testId - The UUID of the mock test to validate.
 *
 * @example
 * const report = await validateMockTestReady('uuid-here');
 * if (report.isValid) {
 *   await publishMockTestWorkflow('uuid-here');
 * } else {
 *   console.log('Cannot publish:', report.errors);
 * }
 */
export async function validateMockTestReady(
  testId: string,
): Promise<ApiResponse<ValidationReport>> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const details: ValidationDetails = {
    testExists: false,
    status: '-',
    hasQuestions: false,
    allQuestionsExist: true,
    allQuestionsPublished: true,
    noDuplicateDisplayOrder: true,
    noDuplicateQuestions: true,
    instituteMatch: true,
    validAvailabilityDates: true,
    validDuration: true,
    validTotalMarks: true,
    validPassingMarks: true,
    computedTotalMarks: 0,
    questionCount: 0,
  };

  try {
    // ── 1. Mock test exists ────────────────────────────────────────────
    const testResult = await getMockTestById(testId);
    if (!testResult.success || !testResult.data) {
      return {
        success: true,
        data: {
          isValid: false,
          errors: [`Mock test not found: ${testId}`],
          warnings: [],
          details: { ...details, testExists: false },
        },
      };
    }

    const mockTest = testResult.data;
    details.testExists = true;
    details.status = mockTest.status;

    console.log('[MOCK_ORDER_DEBUG] VALIDATION_START', {
      testId,
      title: mockTest.title,
      status: mockTest.status,
    });

    // ── 2. Status is draft, pending_approval, or archived (restore) ────
    if (!VALID_PRE_PUBLISH_STATUSES.includes(mockTest.status)) {
      errors.push(
        `Cannot publish a test with status "${mockTest.status}". ` +
        `Only "draft", "pending_approval", or "archived" (restore) tests can be published.`,
      );
    }

    // ── 10. durationMin > 0 ────────────────────────────────────────────
    if (mockTest.durationMin <= 0) {
      errors.push(`Test duration (${mockTest.durationMin} min) must be greater than 0.`);
      details.validDuration = false;
    }

    // ── 9. Availability dates are valid ────────────────────────────────
    if (mockTest.availableFrom && mockTest.availableUntil) {
      if (new Date(mockTest.availableFrom) >= new Date(mockTest.availableUntil)) {
        errors.push(
          'Availability start date must be before the end date. ' +
          `availableFrom (${mockTest.availableFrom}) is not before ` +
          `availableUntil (${mockTest.availableUntil}).`,
        );
        details.validAvailabilityDates = false;
      }
    }

    // ── 3. Has at least one assigned question ─────────────────────────
    const questionsResult = await getMockTestQuestions(testId, 'orderSequence', 'asc');
    if (!questionsResult.success || !questionsResult.data) {
      return {
        success: true,
        data: {
          isValid: false,
          errors: [
            ...errors,
            `Failed to fetch questions for test: ${questionsResult.error}`,
          ],
          warnings,
          details: { ...details, hasQuestions: false },
        },
      };
    }

    const assignments = questionsResult.data;
    details.questionCount = assignments.length;

    console.log('[MOCK_ORDER_DEBUG] ASSIGNMENTS', assignments.map((a, idx) => ({
      index: idx,
      questionId: a.questionId,
      orderSequence: a.orderSequence,
      marks: a.marks,
      addedAt: a.addedAt,
    })));

    if (assignments.length === 0) {
      errors.push('The mock test has no questions assigned. Add at least one question before publishing.');
      details.hasQuestions = false;

      // Short-circuit: no questions means we can't check 4-8
      return {
        success: true,
        data: {
          isValid: false,
          errors,
          warnings,
          details,
        },
      };
    }

    details.hasQuestions = true;

    // ── 6. No duplicate displayOrder ───────────────────────────────────
    const orderSequences = assignments.map((a) => a.orderSequence);
    const uniqueOrders = new Set(orderSequences);

    const orderCounts = new Map<number, number>();
    for (const o of orderSequences) {
      orderCounts.set(o, (orderCounts.get(o) ?? 0) + 1);
    }
    const duplicateOrders = Array.from(orderCounts.entries())
      .filter(([_, count]) => count > 1)
      .map(([order, count]) => ({ order, count }));

    console.log('[MOCK_ORDER_DEBUG] ORDER_ANALYSIS', {
      allOrders: orderSequences,
      uniqueOrders: Array.from(uniqueOrders),
      duplicates: duplicateOrders,
    });

    if (duplicateOrders.length > 0) {
      for (const dup of duplicateOrders) {
        const matchingRows = assignments
          .filter((a) => a.orderSequence === dup.order)
          .map((a) => ({
            questionId: a.questionId,
            orderSequence: a.orderSequence,
            marks: a.marks,
            addedAt: a.addedAt,
          }));
        console.log('[MOCK_ORDER_DEBUG] DUPLICATE_ROWS', {
          order: dup.order,
          rows: matchingRows,
        });
      }
    }

    if (uniqueOrders.size !== orderSequences.length) {
      errors.push(
        'Duplicate displayOrder values detected. ' +
        'Each question must have a unique display order within the test.',
      );
      details.noDuplicateDisplayOrder = false;
    }

    // ── 7. No duplicate questions ──────────────────────────────────────
    const questionIds = assignments.map((a) => a.questionId);
    const uniqueQuestionIds = new Set(questionIds);
    if (uniqueQuestionIds.size !== questionIds.length) {
      errors.push(
        'Duplicate questions detected in the test. ' +
        'Each question may appear only once per test.',
      );
      details.noDuplicateQuestions = false;
    }

    // ── 4, 5, 8. Batch-fetch all questions ─────────────────────────────
    const questionResult = await getQuestions(
      { ids: questionIds },
      undefined,
      { page: 1, pageSize: questionIds.length },
    );

    if (!questionResult.success || !questionResult.data) {
      return {
        success: true,
        data: {
          isValid: false,
          errors: [
            ...errors,
            `Failed to fetch question details: ${questionResult.error}`,
          ],
          warnings,
          details,
        },
      };
    }

    const questionsData = questionResult.data.data;

    // 4. All assigned questions exist
    const foundQuestionIds = new Set(questionsData.map((q: Question) => q.questionId));
    const missingQuestions = questionIds.filter((id) => !foundQuestionIds.has(id));
    if (missingQuestions.length > 0) {
      errors.push(
        `The following assigned questions no longer exist: ${missingQuestions.join(', ')}. ` +
        'Remove them from the test before publishing.',
      );
      details.allQuestionsExist = false;
    }

    // 5. All questions are published
    const nonPublishedQuestions = questionsData.filter(
      (q: Question) => q.status !== 'published',
    );
    if (nonPublishedQuestions.length > 0) {
      const ids = nonPublishedQuestions.map((q: Question) => q.questionId).join(', ');
      errors.push(
        `The following questions are not in "published" status: ${ids}. ` +
        'Only published questions can be included in a mock test.',
      );
      details.allQuestionsPublished = false;
    }

    // 8. All questions belong to same institute as the test
    const instituteMismatch = questionsData.filter(
      (q: Question) => q.instituteId !== mockTest.instituteId,
    );
    if (instituteMismatch.length > 0) {
      const ids = instituteMismatch.map((q: Question) => q.questionId).join(', ');
      errors.push(
        `The following questions belong to a different institute: ${ids}. ` +
        'Cross-institute assignments are not allowed.',
      );
      details.instituteMatch = false;
    }

    // ── 11. Total marks > 0 (computed from actual assignments) ─────────
    const computedTotalMarks = assignments.reduce(
      (sum, a) => sum + Number(a.marks),
      0,
    );
    details.computedTotalMarks = computedTotalMarks;
    if (computedTotalMarks <= 0) {
      errors.push(
        `Total marks (${computedTotalMarks}) must be greater than 0. ` +
        'Ensure at least one question has a positive mark value.',
      );
      details.validTotalMarks = false;
    }

    // ── 12. Passing marks <= computed total marks (if configured) ────────
    if (mockTest.passingMarks !== null && mockTest.passingMarks !== undefined) {
      if (mockTest.passingMarks < 0) {
        errors.push('Passing marks cannot be negative.');
        details.validPassingMarks = false;
      } else if (mockTest.passingMarks > computedTotalMarks) {
        errors.push(
          `Passing marks (${mockTest.passingMarks}) cannot exceed total marks (${computedTotalMarks}). ` +
          'Lower the passing marks in test settings or add more questions before publishing.'
        );
        details.validPassingMarks = false;
      }
    }

    // ── Warnings (non-blocking) ────────────────────────────────────────
    if (!mockTest.description) {
      warnings.push('The test has no description set. Consider adding one for student clarity.');
    }

    const finalReport: ValidationReport = {
      isValid: errors.length === 0,
      errors,
      warnings,
      details,
    };

    console.log('[MOCK_ORDER_DEBUG] FINAL_ORDER_STATE', {
      testId,
      allQuestionIds: questionIds,
      allOrderSequences: orderSequences,
      duplicates: duplicateOrders,
      isValid: finalReport.isValid,
      errors: finalReport.errors,
    });

    return {
      success: true,
      data: finalReport,
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Build a frozen QuestionSnapshot for a single question at publish time.
 *
 * Loads the question's current options, explanation (if any), stem images,
 * and option images, then serialises everything into a self-contained
 * snapshot that is stored in `mock_test_questions.question_snapshot`.
 *
 * @param question - The full Question object from the question bank.
 * @returns A fully populated QuestionSnapshot, or an error if critical
 *          data could not be loaded.
 */
async function buildQuestionSnapshot(
  question: Question,
): Promise<ApiResponse<QuestionSnapshot>> {
  try {
    const questionId = question.questionId;

    // ── Load options (best-effort — numerical questions have none) ────
    const optionsResult = await getQuestionOptions(questionId);
    const dbOptions = optionsResult.success && optionsResult.data ? optionsResult.data : [];

    // Load option images for each option
    const snapshotOptions: QuestionSnapshotOption[] = await Promise.all(
      dbOptions.map(async (opt) => {
        const optImagesResult = await getOptionImages(opt.optionId);
        const optImages = optImagesResult.success && optImagesResult.data ? optImagesResult.data : [];

        const snapshotOptImages: QuestionSnapshotOptionImage[] = optImages.map((img) => ({
          storageBucket: img.storageBucket,
          storagePath: img.storagePath,
          altText: img.altText,
          displayOrder: img.displayOrder,
        }));

        return {
          optionId: opt.optionId,
          optionText: opt.optionText,
          isCorrect: opt.isCorrect,
          orderSequence: opt.orderSequence,
          images: snapshotOptImages,
        };
      }),
    );

    // ── Load explanation (best-effort — may not exist) ────────────────
    let explanationText: string | null = null;
    let explanationVideoUrl: string | null = null;
    let correctNumericalAnswer: number | null = null;
    let numericalTolerance: number | null = null;
    let correctTextAnswer: string | null = null;

    const explResult = await getQuestionExplanation(questionId);
    if (explResult.success && explResult.data) {
      explanationText = explResult.data.explanationText;
      explanationVideoUrl = explResult.data.explanationVideoUrl;
      correctNumericalAnswer = explResult.data.correctNumericalAnswer;
      numericalTolerance = explResult.data.numericalTolerance;
      correctTextAnswer = explResult.data.correctTextAnswer;
    }

    // ── Load stem/explanation images ───────────────────────────────────
    const imagesResult = await getQuestionImages(questionId);
    const dbImages = imagesResult.success && imagesResult.data ? imagesResult.data : [];

    const snapshotImages: QuestionSnapshotImage[] = dbImages.map((img) => ({
      storageBucket: img.storageBucket,
      storagePath: img.storagePath,
      imageRole: img.imageRole,
      altText: img.altText,
      orderSequence: img.orderSequence,
    }));

    // ── Build the snapshot ─────────────────────────────────────────────
    const snapshot: QuestionSnapshot = {
      snapshotVersion: SNAPSHOT_VERSION,
      questionId,
      questionText: question.questionText,
      questionType: question.questionType,
      difficulty: question.difficulty,
      subjectId: question.subjectId,
      chapterId: question.chapterId,
      marks: question.marks,
      negativeMarks: question.negativeMarks,
      options: snapshotOptions,
      correctNumericalAnswer,
      numericalTolerance,
      correctTextAnswer,
      explanationText,
      explanationVideoUrl,
      images: snapshotImages,
    };

    return { success: true, data: snapshot };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Generate frozen question snapshots for all assignments in a mock test.
 *
 * This function:
 * 1. Fetches all assigned questions with their current stem, options,
 *    marks, negative marks, explanations, and images from the question bank.
 * 2. Serialises each into a `QuestionSnapshot` (see types/mockTest.ts).
 * 3. Stores the snapshot JSON in each `mock_test_questions.question_snapshot` column.
 * 4. This ensures the test is immutable even if the source question is
 *    later edited post-publish.
 *
 * This function is called by `publishMockTestWorkflow()` before the
 * status transition, so snapshots are written before the test is
 * marked as published.
 *
 * @param testId - The UUID of the mock test to snapshot.
 */
export async function generateQuestionSnapshots(
  testId: string,
): Promise<ApiResponse<{ message: string }>> {
  try {
    validateUUID(testId, 'testId');

    // ── 1. Get all assignments for this test ───────────────────────────
    const assignmentsResult = await getMockTestQuestions(testId, 'orderSequence', 'asc');
    if (!assignmentsResult.success || !assignmentsResult.data) {
      return {
        success: false,
        error: `Failed to fetch assignments for test ${testId}: ${assignmentsResult.error ?? 'Unknown error'}`,
      };
    }

    const assignments = assignmentsResult.data;
    if (assignments.length === 0) {
      return {
        success: false,
        error: `Cannot generate snapshots: test ${testId} has no assigned questions.`,
      };
    }

    // ── 2. Get all referenced questions ────────────────────────────────
    const questionIds = assignments.map((a) => a.questionId);
    const questionsResult = await getQuestions(
      { ids: questionIds },
      undefined,
      { page: 1, pageSize: questionIds.length },
    );

    if (!questionsResult.success || !questionsResult.data) {
      return {
        success: false,
        error: `Failed to fetch questions for test ${testId}: ${questionsResult.error ?? 'Unknown error'}`,
      };
    }

    const questions = questionsResult.data.data as Question[];
    const questionMap = new Map<string, Question>();
    for (const q of questions) {
      questionMap.set(q.questionId, q);
    }

    // ── 3. Build a snapshot for each assignment and persist ────────────
    let snapshotCount = 0;
    const errors: string[] = [];

    for (const assignment of assignments) {
      const question = questionMap.get(assignment.questionId);
      if (!question) {
        errors.push(`Question ${assignment.questionId} not found in question bank.`);
        continue;
      }

      const snapshotResult = await buildQuestionSnapshot(question);
      if (!snapshotResult.success || !snapshotResult.data) {
        errors.push(
          `Failed to build snapshot for question ${assignment.questionId}: ${snapshotResult.error ?? 'Unknown error'}`,
        );
        continue;
      }

      const snapshot = snapshotResult.data;

      // ── 4. UPDATE the mock_test_questions row with the snapshot ──────
      const { error: updateError } = await supabase
        .from('mock_test_questions')
        .update({ question_snapshot: snapshot as unknown })
        .eq('test_id', testId)
        .eq('question_id', assignment.questionId);

      if (updateError) {
        errors.push(
          `Failed to persist snapshot for question ${assignment.questionId}: ${extractErrorMessage(updateError)}`,
        );
        continue;
      }

      snapshotCount++;
    }

    // ── 5. Report results ──────────────────────────────────────────────
    if (errors.length > 0) {
      return {
        success: false,
        error: `Snapshot generation completed with ${errors.length} error(s):\n${errors.join('\n')}`,
      };
    }

    return {
      success: true,
      data: {
        message: `Successfully generated ${snapshotCount} question snapshot(s) for test ${testId}.`,
      },
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Full publish workflow for a mock test.
 *
 * Orchestrates the complete publish lifecycle:
 * 1. `validateMockTestReady()` — comprehensive pre-flight checks
 * 2. `generateQuestionSnapshots()` — freeze question data
 * 3. `mockTestService.publishMockTest()` — perform the actual status
 *    transition to `published`
 *
 * The workflow aborts at step 1 if validation fails.
 *
 * @param testId - The UUID of the mock test to publish.
 *
 * @example
 * const result = await publishMockTestWorkflow('uuid-here');
 * if (result.success) {
 *   console.log(`Published! ${result.data.questionCount} questions frozen.`);
 * } else {
 *   console.error('Publish failed:', result.error);
 * }
 */
export async function publishMockTestWorkflow(
  testId: string,
): Promise<ApiResponse<PublishSummary>> {
  try {
    // ── Step 1: Validate ───────────────────────────────────────────────
    const validationResult = await validateMockTestReady(testId);

    if (!validationResult.success || !validationResult.data) {
      return {
        success: false,
        error: `Validation check failed: ${validationResult.error ?? 'Unknown error'}`,
      };
    }

    const report = validationResult.data;
    if (!report.isValid) {
      return {
        success: false,
        error: `Publish validation failed (${report.errors.length} error(s)):\n${report.errors.join('\n')}`,
      };
    }

    // Capture pre-publish state for the summary
    const previousStatus = report.details.status as MockTestStatus;
    const questionCount = report.details.questionCount;

    // ── Step 2: Generate snapshots ─────────────────────────────────────
    const snapshotResult = await generateQuestionSnapshots(testId);
    if (!snapshotResult.success) {
      return {
        success: false,
        error: `Snapshot generation failed: ${snapshotResult.error}`,
      };
    }

    // ── Step 2b: Verify snapshots (fail closed) ────────────────────────
    // Belt-and-suspenders: even if snapshot generation reported success,
    // we re-check the database so NO test can reach 'published' with any
    // NULL question_snapshot row.
    const { count: missingSnapshots, error: verifyErr } = await supabase
      .from('mock_test_questions')
      .select('*', { count: 'exact', head: true })
      .eq('test_id', testId)
      .is('question_snapshot', null);

    if (verifyErr) {
      return {
        success: false,
        error: `Snapshot verification failed: ${extractErrorMessage(verifyErr)}`,
      };
    }

    if (missingSnapshots !== null && missingSnapshots > 0) {
      return {
        success: false,
        error: `Cannot publish mock test ${testId}: ${missingSnapshots} question(s) ` +
          'still have no frozen question_snapshot after snapshot generation. ' +
          'Publish aborted — no status change was made.',
      };
    }

    // ── Step 3: Publish via mockTestService (guarded flip) ─────────────
    // Restore (archived → published) preserves the original published_at so
    // the audit trail of the first publication survives.
    const publishResult =
      previousStatus === 'archived'
        ? await publishMockTest(testId, {
            preservePublishedAt: true,
            totalMarks: report.details.computedTotalMarks,
          })
        : await publishMockTest(testId, {
            totalMarks: report.details.computedTotalMarks,
          });

    if (!publishResult.success || !publishResult.data) {
      return {
        success: false,
        error: `Publish transition failed: ${publishResult.error}`,
      };
    }

    const publishedTest = publishResult.data;

    // Compute total marks from the test's metadata
    const totalMarks = publishedTest.totalMarks;

    return {
      success: true,
      data: {
        testId: publishedTest.testId,
        previousStatus,
        newStatus: 'published',
        publishedAt: publishedTest.publishedAt ?? new Date().toISOString(),
        questionCount,
        totalMarks,
      },
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Unpublish a mock test, reverting it from `published` back to `draft`.
 *
 * This is ONLY allowed when no student attempts exist for the test.
 * If any attempts are found, the operation returns an error explaining
 * that the test cannot be unpublished because it has attempt history.
 *
 * @param testId - The UUID of the mock test to unpublish.
 *
 * @example
 * const result = await unpublishMockTest('uuid-here');
 * if (result.success) {
 *   console.log('Test reverted to draft.');
 * } else {
 *   console.error('Cannot unpublish:', result.error);
 * }
 */
export async function unpublishMockTest(
  testId: string,
): Promise<ApiResponse<MockTest>> {
  try {
    // ── Validate test exists and is published ──────────────────────────
    const testResult = await getMockTestById(testId);

    if (!testResult.success || !testResult.data) {
      return { success: false, error: `Mock test not found: ${testId}` };
    }

    const mockTest = testResult.data;

    if (mockTest.status !== 'published') {
      return {
        success: false,
        error: `Cannot unpublish a test with status "${mockTest.status}". Only "published" tests can be unpublished.`,
      };
    }

    // ── Check for existing attempts ────────────────────────────────────
    // No existing service exposes attempt counts yet, so we query
    // the mock_attempts table directly for this guard.
    const { count, error: countError } = await supabase
      .from('mock_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('test_id', testId);

    if (countError) {
      return { success: false, error: extractErrorMessage(countError) };
    }

    if (count !== null && count > 0) {
      return {
        success: false,
        error: `Cannot unpublish this test. It has ${count} student attempt(s). ` +
          'Attempt history prevents unpublishing. Archive the test instead.',
      };
    }

    // ── Perform the status transition via direct update ────────────────
    // We use a direct update rather than the existing service because
    // the unpublish path (published → draft) is not a standard lifecycle
    // transition exposed by mockTestService. It's a special admin action.
    const { data, error: updateError } = await supabase
      .from('mock_tests')
      .update({
        status: 'draft',
        published_at: null,
      })
      .eq('test_id', testId)
      .select()
      .single();

    if (updateError) {
      return { success: false, error: extractErrorMessage(updateError) };
    }

    // Delegate to getMockTestById for mapping — avoids duplicating the
    // snake_case → camelCase mapping that already exists in mockTestService.
    return getMockTestById(testId);
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}
