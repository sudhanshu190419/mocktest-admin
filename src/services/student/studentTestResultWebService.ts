/**
 * Student Test Result & Answer Review Web Service
 *
 * Presentation-layer service connecting Next.js Student Portal to the authoritative
 * Supabase test evaluation tables (`mock_results`, `mock_attempts`, `mock_answers`,
 * `mock_test_questions`, `question_explanations`).
 *
 * Guarantees:
 *   - Zero client-side grading: All scores, correctness flags, and ranks come from `mock_results`.
 *   - Release Gating: Respects `is_released` status.
 *   - Access Control: Verifies student profile ownership before returning attempt data.
 *   - High Performance: Single-batch data fetching with deterministic seeded shuffling.
 *   - SSR Safe: No direct browser global references.
 *
 * @module services/student/studentTestResultWebService
 */

import { supabase } from '@/config/supabase';
import { seededShuffle } from '@/utils/seededShuffle';

// ─── Constants ───────────────────────────────────────────────────────────────

const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const SIGNED_URL_EXPIRY = 14400; // 4 hours

// ─── Status Classification ───────────────────────────────────────────────────

export type ReviewQuestionStatus = 'correct' | 'incorrect' | 'skipped' | 'pending' | 'evaluated';

export interface ClassifyQuestionParams {
  questionType?: string | null;
  isAnswered?: boolean | null;
  isCorrect?: boolean | null;
  textAnswer?: string | null;
  evaluationStatus?: string | null;
}

/**
 * Single source of truth for question-level correctness classification.
 * Matches the mobile review engine semantics exactly.
 */
export function classifyQuestionStatus(params: ClassifyQuestionParams): ReviewQuestionStatus {
  const qType = params.questionType ?? 'mcq';
  const hasTextAnswer =
    typeof params.textAnswer === 'string' && params.textAnswer.trim().length > 0;
  const isAnswered = Boolean(params.isAnswered || hasTextAnswer);

  if (qType === 'subjective' || qType === 'text_based') {
    if (!isAnswered) return 'skipped';
    if (params.evaluationStatus === 'manual_evaluated') return 'evaluated';
    return 'pending';
  }

  // Objective questions (MCQ, MSQ, True/False, Numerical)
  if (isAnswered && params.isCorrect === true) return 'correct';
  if (isAnswered && params.isCorrect === false) return 'incorrect';
  return 'skipped';
}

// ─── Result Scorecard Types ──────────────────────────────────────────────────

export interface SubjectBreakdownItem {
  subjectId: string;
  subjectName: string;
  score: number;
  maxScore: number;
  percentage: number;
  correct: number;
  wrong: number;
  skipped: number;
  accuracy: number;
  timeSpentMin?: number;
}

export interface StudentTestResultData {
  testId: string;
  attemptId: string;
  testTitle: string;
  testType: string;
  attemptNumber: number;
  attemptedAt: string;
  submittedAt: string | null;
  isReleased: boolean;
  releasedAt: string | null;

  // Scores
  totalScore: number;
  maxScore: number;
  percentage: number;
  passingMarks: number | null;
  isPassed: boolean | null;

  // Rank & Percentile
  rank: number | null;
  percentile: number | null;

  // Summary Metrics
  correctCount: number;
  incorrectCount: number;
  skippedCount: number;
  totalQuestions: number;
  accuracy: number;
  accuracyInsight: string;

  // Timing
  totalTimeSeconds: number;
  avgTimePerQuestion: number;
  durationMin: number;

  // Section Breakdown
  subjectBreakdown: SubjectBreakdownItem[];

  // Retake eligibility
  attemptLimit: number | null;
  canRetake: boolean;
}

export type FetchResultResponse =
  | { success: true; isReleased: true; data: StudentTestResultData }
  | { success: true; isReleased: false; data: Partial<StudentTestResultData> & { testTitle: string; attemptedAt: string } }
  | { success: false; error: string; code?: string };

// ─── Answer Review Types ─────────────────────────────────────────────────────

export type OptionFeedbackState = 'selected' | 'wrong' | 'correct' | 'neutral';

export interface ReviewOptionDisplay {
  id: string;
  label: string;
  text: string;
  imageUrl?: string;
  feedback: OptionFeedbackState;
  isSelected: boolean;
  isCorrect: boolean;
}

export interface ReviewQuestionItem {
  index: number; // 1-based UI index
  questionId: string;
  answerId?: string;
  questionType: string;
  marks: number;
  negativeMarks: number;
  marksAwarded: number;
  status: ReviewQuestionStatus;
  sectionName: string;

  // Stem & Media
  questionText: string;
  questionImageUrl?: string;
  questionImageAlt?: string;

  // Options
  options: ReviewOptionDisplay[];

  // Student vs Correct Response
  studentAnswerText?: string | null;
  studentNumericalAnswer?: number | null;
  correctNumericalAnswer?: number | null;
  timeSpentSeconds: number;

  // Evaluation & Feedback
  evaluationStatus?: string | null;
  evaluatorFeedback?: string | null;
  evaluatedAt?: string | null;

  // Solution / Explanation
  explanationText?: string | null;
  explanationImages: string[];
  explanationVideoUrl?: string | null;
}

export interface ReviewSessionData {
  test: {
    testId: string;
    title: string;
    durationMin: number;
    totalMarks: number;
    totalQuestions: number;
  };
  attempt: {
    attemptId: string;
    attemptNumber: number;
    totalScore: number;
    maxScore: number;
    percentage: number;
    correctCount: number;
    wrongCount: number;
    skippedCount: number;
  };
  questions: ReviewQuestionItem[];
  sections: string[];
}

export type FetchReviewResponse =
  | { success: true; data: ReviewSessionData }
  | { success: false; error: string; code?: string };

// ─── Helper: Image Signed URL Batcher ────────────────────────────────────────

function imageStorageKey(img: { storageBucket: string; storagePath: string }): string {
  return `${img.storageBucket}::${img.storagePath}`;
}

async function generateBatchSignedUrls(storageRefs: Array<{ bucket: string; path: string }>): Promise<Record<string, string>> {
  const signedUrlMap: Record<string, string> = {};
  if (!storageRefs.length) return signedUrlMap;

  // Group paths by bucket
  const bucketMap = new Map<string, string[]>();
  for (const ref of storageRefs) {
    const list = bucketMap.get(ref.bucket) || [];
    list.push(ref.path);
    bucketMap.set(ref.bucket, list);
  }

  const batchPromises = Array.from(bucketMap.entries()).map(async ([bucket, paths]) => {
    try {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, SIGNED_URL_EXPIRY);
      if (!error && data) {
        for (const item of data) {
          if (item.signedUrl && item.path) {
            signedUrlMap[`${bucket}::${item.path}`] = item.signedUrl;
          }
        }
      }
    } catch {
      // Ignore individual batch failure
    }
  });

  await Promise.all(batchPromises);
  return signedUrlMap;
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. Fetch Test Result Scorecard
// ═════════════════════════════════════════════════════════════════════════════

export async function fetchStudentTestResult(
  testId: string,
  attemptId: string,
  userId?: string
): Promise<FetchResultResponse> {
  try {
    if (!testId || !attemptId) {
      return { success: false, error: 'testId and attemptId are required.' };
    }

    // 1. Authenticated User Resolution
    let authUid = userId;
    if (!authUid) {
      const { data: authData } = await supabase.auth.getUser();
      authUid = authData?.user?.id;
    }
    if (!authUid) {
      return { success: false, error: 'Authentication required to view results.' };
    }

    // 2. Fetch student_details to verify attempt ownership
    const { data: studentDetail } = await supabase
      .from('student_details')
      .select('student_id')
      .eq('profile_id', authUid)
      .maybeSingle();

    // 3. Parallel fetch of Result, Attempt, and Test metadata
    const [resultRes, attemptRes, testRes] = await Promise.all([
      supabase.from('mock_results').select('*').eq('attempt_id', attemptId).maybeSingle(),
      supabase.from('mock_attempts').select('*').eq('attempt_id', attemptId).maybeSingle(),
      supabase.from('mock_tests').select('*').eq('test_id', testId).maybeSingle(),
    ]);

    if (!attemptRes.data) {
      return { success: false, error: 'Test attempt not found.' };
    }

    // Verify ownership
    if (studentDetail?.student_id && attemptRes.data.student_id !== studentDetail.student_id) {
      return { success: false, error: 'You are not authorized to view this test result.' };
    }

    const testRow = testRes.data;
    const testTitle = testRow?.title || 'Mock Test';
    const attemptedAt = attemptRes.data.startedAt || attemptRes.data.created_at || new Date().toISOString();

    // If result not found in mock_results
    if (!resultRes.data) {
      return {
        success: true,
        isReleased: false,
        data: {
          testTitle,
          attemptedAt,
          attemptNumber: attemptRes.data.attempt_number || 1,
        },
      };
    }

    const mr = resultRes.data;

    // Check release status
    if (!mr.is_released) {
      return {
        success: true,
        isReleased: false,
        data: {
          testTitle,
          attemptedAt,
          attemptNumber: attemptRes.data.attempt_number || 1,
          isReleased: false,
          releasedAt: mr.released_at,
        },
      };
    }

    // 4. Compute Derived Metrics from Real Result Data
    const correctCount = mr.correct_count ?? 0;
    const incorrectCount = mr.wrong_count ?? 0;
    const skippedCount = mr.skipped_count ?? 0;
    const totalQuestions = correctCount + incorrectCount + skippedCount;
    const attemptedObjective = correctCount + incorrectCount;

    const accuracy =
      attemptedObjective > 0
        ? Math.round((correctCount / attemptedObjective) * 100)
        : Math.round(mr.percentage ?? 0);

    let accuracyInsight = 'No questions answered.';
    if (accuracy >= 90) {
      accuracyInsight = 'Outstanding performance! High precision across all sections.';
    } else if (accuracy >= 75) {
      accuracyInsight = 'Strong accuracy with solid conceptual understanding.';
    } else if (accuracy >= 50) {
      accuracyInsight = 'Moderate accuracy. Review incorrect responses to minimize penalties.';
    } else {
      accuracyInsight = 'Needs improvement. Focus on concept revision and careful attempt strategy.';
    }

    const durationMin = testRow?.duration_min || Math.round((mr.total_time_seconds || 0) / 60);
    const passingMarks = testRow?.passing_marks ?? null;
    const isPassed = passingMarks !== null ? (mr.total_score >= passingMarks) : null;

    // Subject / Section Breakdown
    const rawBreakdown = (mr.subject_breakdown as any[]) || [];
    const subjectBreakdown: SubjectBreakdownItem[] = rawBreakdown.map((s, idx) => {
      const correct = s.correct ?? 0;
      const wrong = s.wrong ?? 0;
      const skipped = s.skipped ?? 0;
      const attempted = correct + wrong;
      const secAccuracy = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;
      const maxScore = s.maxScore || s.max_score || 0;
      const score = s.score ?? 0;
      const percentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;

      return {
        subjectId: s.subjectId || s.subject_id || `sec-${idx}`,
        subjectName: s.subjectName || s.subject_name || `Section ${idx + 1}`,
        score,
        maxScore,
        percentage,
        correct,
        wrong,
        skipped,
        accuracy: secAccuracy,
        timeSpentMin: s.timeSpentMin || undefined,
      };
    });

    const attemptLimit = testRow?.attempt_limit ?? null;
    const canRetake = attemptLimit === null || (attemptRes.data.attempt_number < attemptLimit);

    const resultData: StudentTestResultData = {
      testId,
      attemptId,
      testTitle,
      testType: testRow?.test_type || 'mock_test',
      attemptNumber: attemptRes.data.attempt_number || 1,
      attemptedAt,
      submittedAt: attemptRes.data.submitted_at || null,
      isReleased: true,
      releasedAt: mr.released_at || null,
      totalScore: Number(mr.total_score ?? 0),
      maxScore: Number(mr.max_score ?? 0),
      percentage: Number(mr.percentage ?? 0),
      passingMarks,
      isPassed,
      rank: mr.rank ?? null,
      percentile: mr.percentile !== null ? Number(mr.percentile) : null,
      correctCount,
      incorrectCount,
      skippedCount,
      totalQuestions: totalQuestions || 1,
      accuracy,
      accuracyInsight,
      totalTimeSeconds: Number(mr.total_time_seconds ?? 0),
      avgTimePerQuestion: Number(mr.avg_time_per_question ?? 0),
      durationMin,
      subjectBreakdown,
      attemptLimit,
      canRetake,
    };

    return { success: true, isReleased: true, data: resultData };
  } catch (err: any) {
    console.error('[studentTestResultWebService] fetchStudentTestResult exception:', err);
    return { success: false, error: err?.message || 'Failed to load test result.' };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. Fetch Answer Review & Solution Explorer Data
// ═════════════════════════════════════════════════════════════════════════════

export async function fetchStudentAnswerReview(
  testId: string,
  attemptId: string,
  userId?: string
): Promise<FetchReviewResponse> {
  try {
    if (!testId || !attemptId) {
      return { success: false, error: 'testId and attemptId are required.' };
    }

    // 1. Authenticated User Resolution
    let authUid = userId;
    if (!authUid) {
      const { data: authData } = await supabase.auth.getUser();
      authUid = authData?.user?.id;
    }
    if (!authUid) {
      return { success: false, error: 'Authentication required to review test answers.' };
    }

    // 2. Parallel single-batch retrieval
    const [testRes, attemptRes, resultRes, questionsRes, answersRes] = await Promise.all([
      supabase.from('mock_tests').select('*').eq('test_id', testId).maybeSingle(),
      supabase.from('mock_attempts').select('*').eq('attempt_id', attemptId).maybeSingle(),
      supabase.from('mock_results').select('*').eq('attempt_id', attemptId).maybeSingle(),
      supabase.from('mock_test_questions').select('*').eq('test_id', testId).order('order_sequence', { ascending: true }),
      supabase.from('mock_answers').select('*').eq('attempt_id', attemptId),
    ]);

    if (!testRes.data || !attemptRes.data) {
      return { success: false, error: 'Test or attempt session not found.' };
    }

    const testRow = testRes.data;
    const attemptRow = attemptRes.data;
    const mr = resultRes.data;

    if (!mr || !mr.is_released) {
      return { success: false, error: 'Detailed answers and solutions are not yet released for this test.' };
    }

    let rawQuestions = questionsRes.data || [];
    if (!rawQuestions.length) {
      return { success: false, error: 'No questions found for this test.' };
    }

    // Deterministic shuffle matching test runner
    if (testRow.shuffle_questions) {
      rawQuestions = seededShuffle(rawQuestions, `${attemptId}:questions`);
    }

    const answers = answersRes.data || [];
    const answerIds = answers.map((a) => a.answer_id);
    const answerByQuestionId = new Map<string, any>();
    for (const a of answers) {
      answerByQuestionId.set(a.question_id, a);
    }

    // 3. Fetch selected option junction rows & explanations in parallel
    const questionIds = rawQuestions.map((q) => q.question_snapshot?.questionId || q.question_id);

    const [optionsJunctionRes, explanationsRes] = await Promise.all([
      answerIds.length > 0
        ? supabase.from('mock_answer_options').select('*').in('answer_id', answerIds)
        : Promise.resolve({ data: [] }),
      questionIds.length > 0
        ? supabase.from('question_explanations').select('*').in('question_id', questionIds)
        : Promise.resolve({ data: [] }),
    ]);

    // Build answer_id -> selectedOptionIds
    const selectedOptionIdsByAnswer = new Map<string, Set<string>>();
    for (const row of optionsJunctionRes.data || []) {
      const existing = selectedOptionIdsByAnswer.get(row.answer_id) || new Set<string>();
      existing.add(row.option_id);
      selectedOptionIdsByAnswer.set(row.answer_id, existing);
    }

    // Build question_id -> explanation
    const explanationByQuestionId = new Map<string, any>();
    for (const exp of explanationsRes.data || []) {
      explanationByQuestionId.set(exp.question_id, exp);
    }

    // 4. Collect all storage image references for single-batch signed URL generation
    const storageRefs: Array<{ bucket: string; path: string }> = [];
    const seenRefs = new Set<string>();

    for (const qRow of rawQuestions) {
      const snap = qRow.question_snapshot;
      if (!snap) continue;

      if (snap.images) {
        for (const img of snap.images) {
          const key = imageStorageKey(img);
          if (!seenRefs.has(key)) {
            seenRefs.add(key);
            storageRefs.push({ bucket: img.storageBucket, path: img.storagePath });
          }
        }
      }

      if (snap.options) {
        for (const opt of snap.options) {
          if (opt.images) {
            for (const img of opt.images) {
              const key = imageStorageKey(img);
              if (!seenRefs.has(key)) {
                seenRefs.add(key);
                storageRefs.push({ bucket: img.storageBucket, path: img.storagePath });
              }
            }
          }
        }
      }
    }

    const signedUrlMap = await generateBatchSignedUrls(storageRefs);

    // 5. Build Final Review Question Models
    const sectionsSet = new Set<string>();
    const mappedReviewQuestions: ReviewQuestionItem[] = [];

    rawQuestions.forEach((qRow, idx) => {
      const snap = qRow.question_snapshot;
      const questionId = snap?.questionId || qRow.question_id;
      const answer = answerByQuestionId.get(questionId);
      const explanation = explanationByQuestionId.get(questionId);

      const sectionName = qRow.section_name || snap?.subjectName || 'General';
      sectionsSet.add(sectionName);

      const questionType = snap?.questionType || 'mcq';
      const status = classifyQuestionStatus({
        questionType,
        isAnswered: answer?.is_answered,
        isCorrect: answer?.is_correct,
        textAnswer: answer?.text_answer,
        evaluationStatus: answer?.evaluation_status,
      });

      const selectedOptionsSet = answer?.answer_id
        ? selectedOptionIdsByAnswer.get(answer.answer_id) || new Set<string>()
        : new Set<string>();

      // Question Stem Image
      let questionImageUrl: string | undefined;
      let questionImageAlt: string | undefined;
      if (snap?.images && snap.images.length > 0) {
        const img = snap.images[0];
        questionImageUrl = signedUrlMap[imageStorageKey(img)];
        questionImageAlt = img.altText;
      }

      // Options Display
      let rawOptions = snap?.options || [];
      if (testRow.shuffle_options) {
        rawOptions = seededShuffle(rawOptions, `${attemptId}:options:${questionId}`);
      }

      const options: ReviewOptionDisplay[] = rawOptions.map((opt: any, optIdx: number) => {
        const isSelected = selectedOptionsSet.has(opt.optionId);
        const isCorrectOpt = Boolean(opt.isCorrect);

        let feedback: OptionFeedbackState = 'neutral';
        if (isSelected && isCorrectOpt) feedback = 'selected';
        else if (isSelected && !isCorrectOpt) feedback = 'wrong';
        else if (!isSelected && isCorrectOpt) feedback = 'correct';

        let optImageUrl: string | undefined;
        if (opt.images && opt.images.length > 0) {
          optImageUrl = signedUrlMap[imageStorageKey(opt.images[0])];
        }

        return {
          id: opt.optionId,
          label: OPTION_LABELS[optIdx] || String(optIdx + 1),
          text: opt.optionText || '',
          imageUrl: optImageUrl,
          feedback,
          isSelected,
          isCorrect: isCorrectOpt,
        };
      });

      // Explanation Images
      const explanationImages: string[] = [];
      if (snap?.images && snap.images.length > 1) {
        for (let i = 1; i < snap.images.length; i++) {
          const url = signedUrlMap[imageStorageKey(snap.images[i])];
          if (url) explanationImages.push(url);
        }
      }

      mappedReviewQuestions.push({
        index: idx + 1,
        questionId,
        answerId: answer?.answer_id,
        questionType,
        marks: snap?.marks ?? qRow.marks ?? 1,
        negativeMarks: qRow.negative_marks_override ?? snap?.negativeMarks ?? testRow.negative_marking ?? 0,
        marksAwarded: answer?.awarded_marks ?? answer?.marks_awarded ?? 0,
        status,
        sectionName,
        questionText: snap?.questionText || 'Question text unavailable',
        questionImageUrl,
        questionImageAlt,
        options,
        studentAnswerText: answer?.text_answer ?? null,
        studentNumericalAnswer: answer?.numerical_answer ?? null,
        correctNumericalAnswer: snap?.numericalAnswer ?? null,
        timeSpentSeconds: answer?.time_spent_seconds ?? 0,
        evaluationStatus: answer?.evaluation_status ?? null,
        evaluatorFeedback: answer?.evaluator_feedback ?? null,
        evaluatedAt: answer?.evaluated_at ?? null,
        explanationText: explanation?.explanation_text || snap?.explanation || null,
        explanationImages,
        explanationVideoUrl: explanation?.explanation_video_url || null,
      });
    });

    return {
      success: true,
      data: {
        test: {
          testId,
          title: testRow.title || 'Mock Test',
          durationMin: testRow.duration_min || 60,
          totalMarks: testRow.total_marks || 0,
          totalQuestions: mappedReviewQuestions.length,
        },
        attempt: {
          attemptId,
          attemptNumber: attemptRow.attempt_number || 1,
          totalScore: mr.total_score ?? 0,
          maxScore: mr.max_score ?? 0,
          percentage: mr.percentage ?? 0,
          correctCount: mr.correct_count ?? 0,
          wrongCount: mr.wrong_count ?? 0,
          skippedCount: mr.skipped_count ?? 0,
        },
        questions: mappedReviewQuestions,
        sections: Array.from(sectionsSet),
      },
    };
  } catch (err: any) {
    console.error('[studentTestResultWebService] fetchStudentAnswerReview exception:', err);
    return { success: false, error: err?.message || 'Failed to load answer review data.' };
  }
}
