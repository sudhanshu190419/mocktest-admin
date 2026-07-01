/**
 * Mock Evaluation Service
 *
 * Backend evaluation engine that computes results for a submitted mock test
 * attempt. Called immediately after an attempt transitions to `submitted`.
 *
 * ## Flow
 *
 * 1. Load the attempt → get testId, studentId, instituteId
 * 2. Load the mock test → get totalMarks, negativeMarking
 * 3. Load all mock_test_questions → get questionSnapshot for correct answers
 * 4. Load all mock_answers for the attempt
 * 5. Load all mock_answer_options (selected options) for those answers
 * 6. Compare submitted answers with correct answers from snapshots
 * 7. Calculate scores and insert mock_results row
 *
 * ## Duplicate prevention
 *
 * Before inserting, checks if a result already exists for the attempt.
 * If so, skips evaluation entirely.
 *
 * @module mockEvaluationService
 */

import { supabase } from '../../config/supabase';
import { validateUUID, extractErrorMessage } from '../../utils/supabase';
import { getMockAttemptById, getMockAnswers, getMockAnswerOptions } from './mockAttemptService';
import { getMockTestById } from './mockTestService';
import { getMockTestQuestions } from './mockTestQuestionService';
import type { ApiResponse } from '../../types/academic';
import type {
  MockResult,
  MockAnswer,
  MockAnswerOption,
  MockTestQuestion,
  QuestionSnapshotOption,
  MockTest,
  MockAttempt,
} from '../../types/mockTest';

// ─── Database Row Shapes ──────────────────────────────────────────────────

interface DbMockResult {
  result_id: string;
  attempt_id: string;
  test_id: string;
  student_id: string;
  institute_id: string;
  total_score: number;
  max_score: number;
  percentage: number;
  rank: number | null;
  percentile: number | null;
  correct_count: number;
  wrong_count: number;
  skipped_count: number;
  total_time_seconds: number;
  avg_time_per_question: number;
  subject_breakdown: unknown | null;
  chapter_breakdown: unknown | null;
  is_released: boolean;
  generated_at: string;
  released_at: string | null;
}

function mapMockResult(db: DbMockResult): MockResult {
  return {
    resultId: db.result_id,
    attemptId: db.attempt_id,
    testId: db.test_id,
    studentId: db.student_id,
    instituteId: db.institute_id,
    totalScore: db.total_score,
    maxScore: db.max_score,
    percentage: db.percentage,
    rank: db.rank,
    percentile: db.percentile,
    correctCount: db.correct_count,
    wrongCount: db.wrong_count,
    skippedCount: db.skipped_count,
    totalTimeSeconds: db.total_time_seconds,
    avgTimePerQuestion: db.avg_time_per_question,
    subjectBreakdown: db.subject_breakdown as MockResult['subjectBreakdown'],
    chapterBreakdown: db.chapter_breakdown as MockResult['chapterBreakdown'],
    isReleased: db.is_released,
    generatedAt: db.generated_at,
    releasedAt: db.released_at,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Resolve the effective negative marks for a question.
 * Uses per-question override if set, otherwise falls back to test-level default.
 */
function getEffectiveNegativeMarks(
  mtq: MockTestQuestion,
  mockTest: MockTest,
): number {
  if (mtq.negativeMarksOverride !== null && mtq.negativeMarksOverride !== undefined) {
    return mtq.negativeMarksOverride;
  }
  return mockTest.negativeMarking;
}

/**
 * Check if a submitted MCQ/MSQ answer matches the correct options.
 *
 * For MCQ / True-False: exactly one correct option, and the student must
 * select that exact option and no others.
 *
 * For MSQ: student must select ALL correct options and NO incorrect options.
 */
function isOptionAnswerCorrect(
  selectedOptionIds: string[],
  correctOptions: QuestionSnapshotOption[],
): boolean {
  const correctIds = correctOptions
    .filter((o) => o.isCorrect)
    .map((o) => o.optionId)
    .sort();

  const selected = [...selectedOptionIds].sort();

  if (selected.length !== correctIds.length) return false;

  return selected.every((id, idx) => id === correctIds[idx]);
}

/**
 * Check if a numerical answer is correct within tolerance.
 */
function isNumericalAnswerCorrect(
  studentAnswer: number,
  correctAnswer: number,
  tolerance: number | null,
): boolean {
  if (tolerance === null || tolerance === undefined) {
    return studentAnswer === correctAnswer;
  }
  return Math.abs(studentAnswer - correctAnswer) <= tolerance;
}

// ─── Evaluation Engine ─────────────────────────────────────────────────────

/**
 * Evaluate a submitted attempt and insert a result row.
 *
 * Steps:
 * 1. Check for existing result (duplicate prevention)
 * 2. Load attempt, mock test, test questions, answers, and answer options
 * 3. Compare each answer against the correct options from question snapshots
 * 4. Calculate aggregate scores
 * 5. Update mock_answers with is_correct and marks_awarded
 * 6. Insert one row into mock_results
 *
 * @param attemptId - The UUID of the submitted attempt.
 *
 * @returns The created MockResult, or an error if evaluation fails.
 */
export async function evaluateAttempt(
  attemptId: string,
): Promise<ApiResponse<MockResult>> {
  try {
    console.group('EVALUATION PIPELINE');
    console.log('Entered evaluateAttempt with attemptId:', attemptId);

    validateUUID(attemptId, 'attemptId');

    // ── Step 1: Duplicate prevention ────────────────────────────────────
    const existingResult = await getMockResultByAttemptId(attemptId);
    console.log('STEP 1 - Existing Result:', existingResult);
    if (existingResult.success && existingResult.data) {
      console.log('EARLY RETURN: Result already exists for attempt:', attemptId);
      console.groupEnd();
      return { success: true, data: existingResult.data };
    }

    // ── Step 2: Load attempt data ───────────────────────────────────────
    const attemptResult = await getMockAttemptById(attemptId);
    console.log('STEP 2 - Attempt:', attemptResult.data ?? null);
    if (!attemptResult.success || !attemptResult.data) {
      console.log('EARLY RETURN: Attempt not found:', attemptId);
      console.groupEnd();
      return { success: false, error: `Attempt not found: ${attemptId}` };
    }
    const attempt: MockAttempt = attemptResult.data;

    // Load mock test
    const testResult = await getMockTestById(attempt.testId);
    console.log('STEP 3 - Test:', testResult.data ?? null);
    if (!testResult.success || !testResult.data) {
      console.log('EARLY RETURN: Mock test not found:', attempt.testId);
      console.groupEnd();
      return { success: false, error: `Mock test not found: ${attempt.testId}` };
    }
    const mockTest: MockTest = testResult.data;

    // Load all assigned questions (with snapshots)
    const questionsResult = await getMockTestQuestions(attempt.testId);
    console.log('STEP 4 - Questions:', questionsResult.data?.length ?? 0);
    if (!questionsResult.success || !questionsResult.data) {
      console.log('EARLY RETURN: Failed to load test questions');
      console.groupEnd();
      return { success: false, error: 'Failed to load test questions.' };
    }
    const testQuestions: MockTestQuestion[] = questionsResult.data;

    if (testQuestions.length === 0) {
      console.log('EARLY RETURN: No questions found for this test');
      console.groupEnd();
      return { success: false, error: 'No questions found for this test.' };
    }

    // Load all answers for this attempt
    const answersResult = await getMockAnswers({ attemptId });
    console.log('STEP 5 - Answers:', answersResult.data?.length ?? 0);
    if (!answersResult.success || !answersResult.data) {
      console.log('EARLY RETURN: Failed to load answers');
      console.groupEnd();
      return { success: false, error: 'Failed to load answers.' };
    }
    const answers: MockAnswer[] = answersResult.data;

    // ── Step 3: Load answer options (selected options per answer) ────────
    const answerIds = answers.map((a) => a.answerId);
    const answerOptionsMap = new Map<string, MockAnswerOption[]>();

    if (answerIds.length > 0) {
      const optsResult = await getMockAnswerOptions({ answerIds });
      console.log('STEP 6 - Answer Options count:', optsResult.data?.length ?? 0);
      if (optsResult.success && optsResult.data) {
        for (const opt of optsResult.data) {
          const existing = answerOptionsMap.get(opt.answerId) ?? [];
          existing.push(opt);
          answerOptionsMap.set(opt.answerId, existing);
        }
      }
    }

    // ── Step 4: Build question lookup by questionId ─────────────────────
    const questionMap = new Map<string, MockTestQuestion>();
    for (const mtq of testQuestions) {
      questionMap.set(mtq.questionId, mtq);
    }

    // ── Step 5: Score each answer ────────────────────────────────────────
    let totalScore = 0;
    let maxScore = 0;
    let correctCount = 0;
    let wrongCount = 0;
    let skippedCount = 0;
    let totalTimeSeconds = 0;
    const answerUpdates: { answerId: string; isCorrect: boolean; marksAwarded: number }[] = [];

    for (const answer of answers) {
      const mtq = questionMap.get(answer.questionId);
      if (!mtq) {
        continue; // Question not in this test (shouldn't happen)
      }

      const questionMarks = mtq.marks;
      maxScore += questionMarks;
      totalTimeSeconds += answer.timeSpentSeconds;

      if (!answer.isAnswered) {
        // Skipped
        skippedCount++;
        answerUpdates.push({
          answerId: answer.answerId,
          isCorrect: false,
          marksAwarded: 0,
        });
        continue;
      }

      // Answered — determine correctness
      const snapshot = mtq.questionSnapshot;
      let isCorrect = false;
      let marksAwarded = 0;

      if (!snapshot) {
        // No snapshot — can't evaluate (shouldn't happen for published tests)
        skippedCount++;
        answerUpdates.push({
          answerId: answer.answerId,
          isCorrect: false,
          marksAwarded: 0,
        });
        continue;
      }

      const snapshotOptions = snapshot.options ?? [];
      const correctOptions = snapshotOptions.filter((o) => o.isCorrect);

      if (snapshot.questionType === 'numerical') {
        // Numerical answer
        if (answer.numericalAnswer !== null && answer.numericalAnswer !== undefined) {
          isCorrect = isNumericalAnswerCorrect(
            answer.numericalAnswer,
            snapshot.correctNumericalAnswer ?? 0,
            snapshot.numericalTolerance,
          );
        } else {
          isCorrect = false;
        }
      } else {
        // MCQ, MSQ, True/False — compare selected options
        const selectedOptions = answerOptionsMap.get(answer.answerId) ?? [];
        const selectedOptionIds = selectedOptions.map((o) => o.optionId);
        isCorrect = isOptionAnswerCorrect(selectedOptionIds, correctOptions);
      }

      if (isCorrect) {
        marksAwarded = questionMarks;
        correctCount++;
        totalScore += marksAwarded;
      } else {
        // Wrong answer — apply negative marking
        const negativeMarks = getEffectiveNegativeMarks(mtq, mockTest);
        marksAwarded = negativeMarks > 0 ? -negativeMarks : 0;
        wrongCount++;
        totalScore += marksAwarded;
      }

      answerUpdates.push({ answerId: answer.answerId, isCorrect, marksAwarded });
    }

    // ── Step 6: Update mock_answers with scoring results ─────────────────
    let answersUpdated = 0;
    let answerUpdateErrors = 0;
    for (const update of answerUpdates) {
      const { error: updateError } = await supabase
        .from('mock_answers')
        .update({
          is_correct: update.isCorrect,
          marks_awarded: update.marksAwarded,
        })
        .eq('answer_id', update.answerId);

      if (updateError) {
        answerUpdateErrors++;
        console.log('Failed to update answer:', update.answerId);
        console.log('error.code:', updateError.code);
        console.log('error.message:', updateError.message);
        console.log('error.details:', (updateError as unknown as Record<string, unknown>).details);
        console.log('error.hint:', (updateError as unknown as Record<string, unknown>).hint);
      } else {
        answersUpdated++;
      }
    }

    console.log('STEP 8 - Answers Updated:', { updated: answersUpdated, errors: answerUpdateErrors });

    // ── Step 7: Compute aggregate values ─────────────────────────────────
    const percentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;
    const avgTimePerQuestion = testQuestions.length > 0
      ? totalTimeSeconds / testQuestions.length
      : 0;

    const resultPayload = {
      attempt_id: attemptId,
      test_id: attempt.testId,
      student_id: attempt.studentId,
      institute_id: attempt.instituteId,
      total_score: totalScore,
      max_score: maxScore,
      percentage,
      correct_count: correctCount,
      wrong_count: wrongCount,
      skipped_count: skippedCount,
      total_time_seconds: totalTimeSeconds,
      avg_time_per_question: avgTimePerQuestion,
    };
    console.log('STEP 7 - Computed Result:', resultPayload);

    // ── Step 8: Insert mock_results row ──────────────────────────────────
    const dbRecord: Record<string, unknown> = {
      ...resultPayload,
      subject_breakdown: null,
      chapter_breakdown: null,
      is_released: true,
      rank: null,
      percentile: null,
      released_at: new Date().toISOString(),
    };

    console.log('Attempting to insert mock_results row...');
    const { data: resultData, error: insertError } = await supabase
      .from('mock_results')
      .insert(dbRecord)
      .select()
      .single<DbMockResult>();

    console.log('STEP 9 - Insert Response:', { success: !insertError, data: resultData, error: insertError });

    if (insertError) {
      console.log('Insert failed!');
      console.log('error.code:', insertError.code);
      console.log('error.message:', insertError.message);
      console.log('error.details:', (insertError as unknown as Record<string, unknown>).details);
      console.log('error.hint:', (insertError as unknown as Record<string, unknown>).hint);
      console.groupEnd();
      return { success: false, error: extractErrorMessage(insertError) };
    }

    console.log('Insert succeeded! Result:', resultData);
    console.groupEnd();
    return { success: true, data: mapMockResult(resultData) };
  } catch (err) {
    console.log('UNEXPECTED ERROR in evaluateAttempt:');
    const errorObj = err as Record<string, unknown>;
    console.log('error.code:', errorObj.code);
    console.log('error.message:', errorObj.message);
    console.log('error.details:', errorObj.details);
    console.log('error.hint:', errorObj.hint);
    console.log('error.stack:', errorObj.stack);
    console.groupEnd();
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Check if a result already exists for an attempt.
 * Used by evaluateAttempt for duplicate prevention.
 */
async function getMockResultByAttemptId(
  attemptId: string,
): Promise<ApiResponse<MockResult>> {
  try {
    validateUUID(attemptId, 'attemptId');

    const { data, error } = await supabase
      .from('mock_results')
      .select('*')
      .eq('attempt_id', attemptId)
      .maybeSingle<DbMockResult>();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    if (!data) {
      return { success: false, error: `Mock result not found for attempt: ${attemptId}` };
    }

    return { success: true, data: mapMockResult(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}
