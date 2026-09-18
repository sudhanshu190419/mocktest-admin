/**
 * Manual Evaluation Service
 *
 * Backend service layer for manual teacher evaluation of subjective questions.
 * Handles: fetching pending evaluations, saving grades, finalizing attempts,
 * and recalculating final results.
 *
 * ## Authorization Model
 *
 * - **Teachers:** Can evaluate students in their assigned batch subjects
 *   (via batch_subject_teachers). Identity derived server-side from auth.uid().
 * - **Super Admin / Academic Admin:** Full access within their institute.
 * - **Finance Admin / Student / Unauthenticated:** Blocked.
 *
 * ## Architecture
 *
 * Uses the Supabase anon key — all queries run within the authenticated user's
 * JWT context. RLS policies enforce row-level access; this service adds
 * service-layer authorization on top.
 *
 * @module services/evaluation/manualEvaluationService
 */

import { supabase } from '@/config/supabase';
import { validateUUID, extractErrorMessage, buildPagination } from '@/utils/supabase';
import { buildPaginatedResponse } from '@/utils/response';
import * as auditService from '@/services/audit/auditService';
import type { ApiResponse, PaginatedResponse, PaginationParams } from '@/types/academic';

// ─── Types ────────────────────────────────────────────────────────────────

interface UserProfile {
  profile_id: string;
  role: string;
}

interface TeacherDetails {
  teacher_id: string;
  profile_id: string;
}

interface AdminRole {
  admin_role_id: string;
  profile_id: string;
  admin_role: string;
}

export interface PendingEvaluationItem {
  answerId: string;
  attemptId: string;
  questionId: string;
  questionText: string;
  questionType: string;
  questionMarks: number;
  studentId: string;
  studentName: string | null;
  testId: string;
  testTitle: string;
  textAnswer: string | null;
  correctTextAnswer: string | null;
  evaluationStatus: 'pending' | 'manual_evaluated' | null;
  awardedMarks: number | null;
  evaluatedAt: string | null;
  evaluatorFeedback: string | null;
  startedAt: string;
}

export interface EvaluationInput {
  answerId: string;
  awardedMarks: number;
  feedback?: string | null;
}

export interface FinalizeInput {
  attemptId: string;
}

// ─── Diagnostic Timing Instrumentation ─────────────────────────────────────

interface EvalDiagnosticTracker {
  correlationId: string;
  attemptId?: string;
  questionId?: string;
  opCount: number;
  totalStart: number;
}

type MeasureOpFn = <T>(opName: string, opFn: () => PromiseLike<T>) => Promise<T>;

const defaultRunner: MeasureOpFn = async <T>(_opName: string, opFn: () => PromiseLike<T>): Promise<T> => {
  return await opFn();
};

function createEvalDiagnosticTracker(answerId: string): {
  tracker: EvalDiagnosticTracker;
  measureOp: MeasureOpFn;
  logStart: () => void;
  logComplete: () => void;
  logFailed: (err: unknown) => void;
  setContext: (attemptId: string, questionId: string) => void;
} {
  const correlationId = `EVAL-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const tracker: EvalDiagnosticTracker = {
    correlationId,
    opCount: 0,
    totalStart: Date.now(),
  };

  const logStart = () => {
    console.log(`[EVAL][START] correlationId=${tracker.correlationId} answerId=${answerId} timestamp=${new Date().toISOString()}`);
  };

  const setContext = (attemptId: string, questionId: string) => {
    tracker.attemptId = attemptId;
    tracker.questionId = questionId;
  };

  const measureOp: MeasureOpFn = async <T>(opName: string, opFn: () => PromiseLike<T>): Promise<T> => {
    tracker.opCount++;
    const stepStart = Date.now();
    const contextInfo = `correlationId=${tracker.correlationId} attemptId=${tracker.attemptId || 'pending'} questionId=${tracker.questionId || 'pending'}`;

    console.log(`[EVAL][STEP_START] ${contextInfo} operationName=${opName} timestamp=${new Date().toISOString()}`);

    const slowTimer = setTimeout(() => {
      console.warn(`[EVAL][SLOW] ${contextInfo} operationName=${opName} elapsed=${Date.now() - stepStart}ms (>5s)`);
    }, 5000);

    const verySlowTimer = setTimeout(() => {
      console.error(`[EVAL][VERY_SLOW] ${contextInfo} operationName=${opName} elapsed=${Date.now() - stepStart}ms (>15s)`);
    }, 15000);

    try {
      const result = await opFn();
      const durationMs = Date.now() - stepStart;
      console.log(`[EVAL][STEP_SUCCESS] ${contextInfo} operationName=${opName} durationMs=${durationMs}`);
      return result;
    } catch (err: any) {
      const durationMs = Date.now() - stepStart;
      const errorCode = err?.code || err?.status || 'UNKNOWN';
      const errorMessage = err?.message || String(err);
      console.error(`[EVAL][STEP_ERROR] ${contextInfo} operationName=${opName} durationMs=${durationMs} errorCode=${errorCode} errorMessage=${errorMessage}`);
      throw err;
    } finally {
      clearTimeout(slowTimer);
      clearTimeout(verySlowTimer);
    }
  };

  const logComplete = () => {
    const totalDurationMs = Date.now() - tracker.totalStart;
    const contextInfo = `correlationId=${tracker.correlationId} attemptId=${tracker.attemptId || 'unknown'} questionId=${tracker.questionId || 'unknown'}`;
    console.log(`[EVAL][COMPLETE] ${contextInfo} totalDurationMs=${totalDurationMs} totalSupabaseOperations=${tracker.opCount}`);
  };

  const logFailed = (err: unknown) => {
    const totalDurationMs = Date.now() - tracker.totalStart;
    const errorCode = (err as any)?.code || (err as any)?.status || 'UNKNOWN';
    const errorMessage = extractErrorMessage(err);
    const contextInfo = `correlationId=${tracker.correlationId} attemptId=${tracker.attemptId || 'unknown'} questionId=${tracker.questionId || 'unknown'}`;
    console.error(`[EVAL][FAILED] ${contextInfo} totalDurationMs=${totalDurationMs} errorCode=${errorCode} errorMessage=${errorMessage}`);
  };

  return { tracker, measureOp, logStart, logComplete, logFailed, setContext };
}

// ─── Authorization Helpers ────────────────────────────────────────────────

/**
 * Resolve the current authenticated user and their role.
 */
async function resolveCurrentUser(measureOp?: MeasureOpFn): Promise<
  | { success: true; userId: string; role: string }
  | { success: false; error: string }
> {
  const runner = measureOp || defaultRunner;
  const { data: userData, error: userError } = await runner('auth.getUser', () =>
    supabase.auth.getUser()
  );
  if (userError || !userData?.user) {
    return { success: false, error: 'Authentication required.' };
  }

  const { data: profile } = await runner('profiles.select', () =>
    supabase
      .from('profiles')
      .select('role')
      .eq('profile_id', userData.user.id)
      .single<UserProfile>()
  );

  if (!profile) {
    return { success: false, error: 'User profile not found.' };
  }

  return { success: true, userId: userData.user.id, role: profile.role };
}

/**
 * Check if the user is a Super Admin or Academic Admin.
 *
 * IMPORTANT: profiles.role contains 'admin' for all admin types.
 * The granular admin roles (super_admin, academic_admin, finance_admin)
 * are stored in the admin_roles table (Migration 074).
 */
async function isAdminUser(userId: string, measureOp?: MeasureOpFn): Promise<boolean> {
  const runner = measureOp || defaultRunner;
  const { data } = await runner('admin_roles.select', () =>
    supabase
      .from('admin_roles')
      .select('admin_role')
      .eq('profile_id', userId)
      .in('admin_role', ['super_admin', 'academic_admin'])
  );

  return (data ?? []).length > 0;
}

/**
 * Resolve teacher_details.teacher_id from profile_id.
 */
async function resolveTeacherId(
  profileId: string,
  measureOp?: MeasureOpFn,
): Promise<string | null> {
  const runner = measureOp || defaultRunner;
  const { data } = await runner('teacher_details.select', () =>
    supabase
      .from('teacher_details')
      .select('teacher_id')
      .eq('profile_id', profileId)
      .single<TeacherDetails>()
  );

  return data?.teacher_id ?? null;
}

/**
 * Verify a teacher is authorized to evaluate a specific mock_answer.
 * Checks batch_subject_teachers assignment.
 */
async function verifyTeacherAuthorization(
  teacherId: string,
  answerId: string,
  measureOp?: MeasureOpFn,
): Promise<boolean> {
  const runner = measureOp || defaultRunner;
  const { data } = await runner('mock_answers.select_auth_context', () =>
    supabase
      .from('mock_answers')
      .select(`
        question_id,
        attempt_id,
        mock_attempts!inner(
          student_id
        )
      `)
      .eq('answer_id', answerId)
      .single()
  );

  if (!data) return false;

  const attempt = data.attempt_id ? data as any : null;
  if (!attempt?.mock_attempts?.student_id) return false;

  const studentId = attempt.mock_attempts.student_id;
  const questionId = data.question_id;

  // Check: teacher is assigned to a batch_subject where this student is enrolled
  // AND the question belongs to the subject they teach
  const { data: authAssignments } = await runner('batch_subject_teachers.select', () =>
    supabase
      .from('batch_subject_teachers')
      .select(`
        batch_subject_id,
        batch_subjects!inner(
          batch_id,
          subject_id
        )
      `)
      .eq('teacher_id', teacherId)
  );

  if (!authAssignments || authAssignments.length === 0) return false;

  // Verify question exists and is subjective
  const { data: question } = await runner('questions.select', () =>
    supabase
      .from('questions')
      .select('subject_id, question_type')
      .eq('question_id', questionId)
      .single()
  );

  if (!question) return false;
  if (question.question_type !== 'subjective') return false;

  // Check if ANY of the teacher's assignments cover this student + subject
  for (let i = 0; i < authAssignments.length; i++) {
    const assignment = authAssignments[i];
    const bs = assignment as any;
    const batchId = bs?.batch_subjects?.batch_id;
    const subjectId = bs?.batch_subjects?.subject_id;

    if (!batchId || !subjectId) continue;
    if (subjectId !== question.subject_id) continue;

    // Verify student is in this batch
    const { data: batchStudent } = await runner(`batch_students.select[${i + 1}]`, () =>
      supabase
        .from('batch_students')
        .select('student_id')
        .eq('batch_id', batchId)
        .eq('student_id', studentId)
        .maybeSingle()
    );

    if (batchStudent) return true;
  }

  return false;
}

// ─── Core Operations ──────────────────────────────────────────────────────

/**
 * Fetch pending subjective evaluations with pagination.
 *
 * Returns attempts containing subjective answers with evaluation_status = 'pending'.
 * Includes enough context for a future evaluation UI.
 */
export async function getPendingEvaluations(
  pagination?: PaginationParams,
): Promise<ApiResponse<PaginatedResponse<PendingEvaluationItem>>> {
  try {
    const user = await resolveCurrentUser();
    if (!user.success) {
      console.warn('[DIAGNOSTIC] resolveCurrentUser failed:', user.error);
      return { success: false, error: user.error };
    }

    const isSuperOrAcademicAdmin = await isAdminUser(user.userId);
    let teacherId: string | null = null;

    if (!isSuperOrAcademicAdmin) {
      teacherId = await resolveTeacherId(user.userId);
      if (!teacherId) {
        console.warn('[DIAGNOSTIC] Teacher profile not found for user.userId:', user.userId);
        return { success: false, error: 'Teacher profile not found.' };
      }
    }

    console.group('[DIAGNOSTIC] getPendingEvaluations() Flow');
    console.log('1. Authenticated User:', {
      authUid: user.userId,
      role: user.role,
      isSuperOrAcademicAdmin,
      resolvedTeacherId: teacherId,
    });

    const { page, pageSize, from, to } = buildPagination(pagination);
    console.log('6. Pagination:', { page, pageSize, from, to });

    // Query mock_answers with pending evaluation_status for subjective questions
    let query = supabase
      .from('mock_answers')
      .select(`
        answer_id,
        attempt_id,
        question_id,
        text_answer,
        evaluation_status,
        awarded_marks,
        evaluated_at,
        evaluator_feedback,
        mock_attempts!inner(
          attempt_id,
          student_id,
          test_id,
          started_at
        ),
        questions!inner(
          question_id,
          question_text,
          question_type,
          marks,
          subject_id,
          question_explanations!left(
            correct_text_answer
          )
        )
      `, { count: 'exact' })
      .eq('evaluation_status', 'pending')
      .eq('questions.question_type', 'subjective')
      .order('created_at', { ascending: true })
      .range(from, to);

    // For non-admin teachers, filter to their assigned batches
    if (!isSuperOrAcademicAdmin && teacherId) {
      // We need to filter by batch_subject_teachers assignment
      // This is done via a subquery approach
      const { data: assignedBatchSubjects, error: bstError } = await supabase
        .from('batch_subject_teachers')
        .select('batch_subject_id, teacher_id')
        .eq('teacher_id', teacherId);

      console.log('2. batch_subject_teachers query:', {
        rowCount: assignedBatchSubjects?.length ?? 0,
        batchSubjectIds: assignedBatchSubjects?.map((bs) => bs.batch_subject_id) ?? [],
        teacherIds: assignedBatchSubjects?.map((bs) => bs.teacher_id) ?? [],
        error: bstError ? { code: bstError.code, message: bstError.message } : null,
      });

      if (!assignedBatchSubjects || assignedBatchSubjects.length === 0) {
        console.warn('2b. Exiting early: No batch_subject_teachers assignments found for teacherId:', teacherId);
        console.groupEnd();
        return {
          success: true,
          data: buildPaginatedResponse([], 0, page, pageSize),
        };
      }

      const bsIds = assignedBatchSubjects.map((bs) => bs.batch_subject_id);

      const { data: batchSubjectData, error: bsError } = await supabase
        .from('batch_subjects')
        .select('batch_id, subject_id')
        .in('batch_subject_id', bsIds);

      console.log('3. batch_subjects query:', {
        rowCount: batchSubjectData?.length ?? 0,
        batchIds: batchSubjectData?.map((bs) => bs.batch_id) ?? [],
        subjectIds: batchSubjectData?.map((bs) => bs.subject_id) ?? [],
        error: bsError ? { code: bsError.code, message: bsError.message } : null,
      });

      if (!batchSubjectData || batchSubjectData.length === 0) {
        console.warn('3b. Exiting early: No batch_subjects records found for bsIds:', bsIds);
        console.groupEnd();
        return {
          success: true,
          data: buildPaginatedResponse([], 0, page, pageSize),
        };
      }

      const subjectIds = batchSubjectData.map((bs) => bs.subject_id);
      const batchIds = batchSubjectData.map((bs) => bs.batch_id);

      // Filter: question must be in an assigned subject, student must be in an assigned batch
      query = query
        .in('questions.subject_id', subjectIds);

      // Get student IDs in assigned batches
      const { data: batchStudents, error: batchStudentsError } = await supabase
        .from('batch_students')
        .select('student_id')
        .in('batch_id', batchIds);

      console.log('4. batch_students query:', {
        rowCount: batchStudents?.length ?? 0,
        studentIds: batchStudents?.map((bs) => bs.student_id) ?? [],
        error: batchStudentsError ? { code: batchStudentsError.code, message: batchStudentsError.message } : null,
      });

      if (!batchStudents || batchStudents.length === 0) {
        console.warn('4b. Exiting early: No batch_students records found for batchIds:', batchIds);
        console.groupEnd();
        return {
          success: true,
          data: buildPaginatedResponse([], 0, page, pageSize),
        };
      }

      const studentIds = batchStudents.map((bs) => bs.student_id);
      query = query.in('mock_attempts.student_id', studentIds);

      console.log('5a. Applied manual filters to mock_answers query:', {
        subjectIdsFilter: subjectIds,
        studentIdsFilter: studentIds,
      });
    }

    const { data, error, count } = await query;

    const TARGET_ATTEMPT_ID = '8b308ec6-e62e-4763-b250-4bca2c8c9e38';
    const targetFoundInDb = (data ?? []).some((r: any) => r.attempt_id === TARGET_ATTEMPT_ID);

    console.log('5b. mock_answers query result:', {
      returnedRowCount: data?.length ?? 0,
      totalCount: count,
      targetAttemptFoundInQuery: targetFoundInDb,
      error: error ? { code: error.code, message: error.message, details: error.details, hint: error.hint } : null,
    });

    if (error) {
      console.groupEnd();
      return { success: false, error: extractErrorMessage(error) };
    }

    // Resolve student names and test titles
    const items: PendingEvaluationItem[] = [];
    const testIdSet = new Set<string>();

    for (const row of data ?? []) {
      const attempt = row.mock_attempts as any;
      if (attempt?.test_id) {
        testIdSet.add(attempt.test_id);
      }
    }

    const testIdList = Array.from(testIdSet);

    // Fetch test titles via secure evaluation-specific RPC
    const testTitleMap = new Map<string, string>();
    if (testIdList.length > 0) {
      const { data: testTitles } = await supabase.rpc('get_evaluation_test_titles', {
        p_test_ids: testIdList,
      });

      if (testTitles) {
        for (const t of testTitles as { test_id: string; title: string }[]) {
          testTitleMap.set(t.test_id, t.title);
        }
      }
    }

    for (const row of data ?? []) {
      const attempt = row.mock_attempts as any;
      const question = row.questions as any;
      const explanation = question.question_explanations as any;

      // Fetch student name
      let studentName: string | null = null;
      if (attempt?.student_id) {
        const { data: student } = await supabase
          .from('student_details')
          .select('profiles!inner(name)')
          .eq('student_id', attempt.student_id)
          .single();
        if (student) {
          studentName = (student as any).profiles?.name ?? null;
        }
      }

      // Fetch test title from RPC map
      const testTitle = (attempt?.test_id ? testTitleMap.get(attempt.test_id) : null) || 'Unknown Test';

      items.push({
        answerId: row.answer_id,
        attemptId: row.attempt_id,
        questionId: row.question_id,
        questionText: question.question_text ?? '',
        questionType: question.question_type,
        questionMarks: question.marks,
        studentId: attempt.student_id,
        studentName,
        testId: attempt.test_id,
        testTitle,
        textAnswer: row.text_answer,
        correctTextAnswer: explanation?.correct_text_answer ?? null,
        evaluationStatus: row.evaluation_status,
        awardedMarks: row.awarded_marks,
        evaluatedAt: row.evaluated_at,
        evaluatorFeedback: row.evaluator_feedback,
        startedAt: attempt.started_at,
      });
    }

    console.log('7. Final items mapped:', {
      itemsCount: items.length,
      targetAttemptPresentInItems: items.some((i) => i.attemptId === TARGET_ATTEMPT_ID),
    });
    console.groupEnd();

    return {
      success: true,
      data: buildPaginatedResponse(items, count ?? 0, page, pageSize),
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Fetch all subjective answers for a specific attempt.
 * Returns both pending and already-evaluated items.
 * Used by the evaluation UI to show full progress.
 */
export async function getAttemptSubjectiveAnswers(
  attemptId: string,
): Promise<ApiResponse<PendingEvaluationItem[]>> {
  try {
    const user = await resolveCurrentUser();
    if (!user.success) return { success: false, error: user.error };

    const isSuperOrAcademicAdmin = await isAdminUser(user.userId);
    let teacherId: string | null = null;
    if (!isSuperOrAcademicAdmin) {
      teacherId = await resolveTeacherId(user.userId);
    }

    validateUUID(attemptId, 'attemptId');

    // Load attempt to verify it exists and get context
    const { data: attempt, error: attemptError } = await supabase
      .from('mock_attempts')
      .select('attempt_id, student_id, test_id, started_at')
      .eq('attempt_id', attemptId)
      .single();

    if (attemptError || !attempt) {
      return { success: false, error: 'Attempt not found.' };
    }

    // Load all subjective answers for this attempt
    const { data, error } = await supabase
      .from('mock_answers')
      .select(`
        answer_id,
        attempt_id,
        question_id,
        text_answer,
        evaluation_status,
        awarded_marks,
        evaluated_at,
        evaluator_feedback,
        questions!inner(
          question_id,
          question_text,
          question_type,
          marks,
          subject_id,
          question_explanations!left(
            correct_text_answer
          )
        )
      `)
      .eq('attempt_id', attemptId)
      .eq('questions.question_type', 'subjective')
      .order('created_at', { ascending: true });

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    // Resolve student name and test title
    let studentName: string | null = null;
    if (attempt.student_id) {
      const { data: student } = await supabase
        .from('student_details')
        .select('profiles!inner(name)')
        .eq('student_id', attempt.student_id)
        .single();
      if (student) {
        studentName = (student as any).profiles?.name ?? null;
      }
    }

    // Fetch test title via secure evaluation-specific RPC
    let testTitle = 'Unknown Test';
    if (attempt.test_id) {
      const { data: testTitles } = await supabase.rpc('get_evaluation_test_titles', {
        p_test_ids: [attempt.test_id],
      });

      if (testTitles && (testTitles as any[]).length > 0) {
        testTitle = (testTitles as any[])[0].title || 'Unknown Test';
      }
    }

    const items: PendingEvaluationItem[] = (data ?? []).map((row) => {
      const question = row.questions as any;
      const explanation = question.question_explanations as any;
      return {
        answerId: row.answer_id,
        attemptId: row.attempt_id,
        questionId: row.question_id,
        questionText: question.question_text ?? '',
        questionType: question.question_type,
        questionMarks: question.marks,
        studentId: attempt.student_id,
        studentName,
        testId: attempt.test_id,
        testTitle,
        textAnswer: row.text_answer,
        correctTextAnswer: explanation?.correct_text_answer ?? null,
        evaluationStatus: row.evaluation_status,
        awardedMarks: row.awarded_marks,
        evaluatedAt: row.evaluated_at,
        evaluatorFeedback: row.evaluator_feedback,
        startedAt: attempt.started_at,
      };
    });

    return { success: true, data: items };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Save evaluation for one subjective answer.
 *
 * Validates: answer exists, is subjective, marks within bounds,
 * caller is authorized. Sets evaluation fields on the mock_answers row.
 */
export async function evaluateSubjectiveAnswer(
  input: EvaluationInput,
): Promise<ApiResponse<{ answerId: string }>> {
  const diag = createEvalDiagnosticTracker(input.answerId);
  diag.logStart();

  try {
    validateUUID(input.answerId, 'answerId');

    const result = await diag.measureOp('rpc.evaluate_subjective_answer', async () => {
      const { data, error } = await supabase.rpc('evaluate_subjective_answer', {
        p_answer_id: input.answerId,
        p_awarded_marks: input.awardedMarks,
        p_feedback: input.feedback ?? null,
      });

      if (error) {
        throw error;
      }

      return data as { success: boolean; data?: { answerId: string }; error?: string };
    });

    if (!result?.success) {
      const errorMsg = result?.error || 'Failed to save evaluation.';
      diag.logFailed(errorMsg);
      return { success: false, error: errorMsg };
    }

    diag.logComplete();
    return { success: true, data: { answerId: result.data?.answerId || input.answerId } };
  } catch (err) {
    diag.logFailed(err);
    return { success: false, error: extractErrorMessage(err) };
  }
}

export async function finalizeSubjectiveEvaluation(
  input: FinalizeInput,
): Promise<ApiResponse<{ resultId: string }>> {
  try {
    validateUUID(input.attemptId, 'attemptId');

    const { data, error } = await supabase.rpc('finalize_subjective_evaluation', {
      p_attempt_id: input.attemptId,
    });

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    const res = data as { success: boolean; data?: { resultId: string; totalScore?: number; maxScore?: number; percentage?: number }; error?: string };
    if (!res || !res.success) {
      return { success: false, error: res?.error || 'Failed to finalize subjective evaluation.' };
    }

    return {
      success: true,
      data: { resultId: res.data?.resultId || '' },
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Count submitted attempts for a given test that still have at least one
 * pending subjective answer awaiting teacher evaluation.
 *
 * @param testId - UUID of the mock test.
 */
export async function getTestPendingEvaluationCount(
  testId: string,
): Promise<ApiResponse<{ pendingEvaluationCount: number }>> {
  try {
    validateUUID(testId, 'testId');

    // Query mock_answers with pending evaluation_status belonging to submitted attempts of this test
    const { data, error } = await supabase
      .from('mock_answers')
      .select(`
        attempt_id,
        mock_attempts!inner(
          test_id,
          status
        )
      `)
      .eq('mock_attempts.test_id', testId)
      .eq('mock_attempts.status', 'submitted')
      .eq('evaluation_status', 'pending');

    if (error) {
      console.warn('[EVALUATION_SERVICE] getTestPendingEvaluationCount failed:', error);
      return { success: false, error: extractErrorMessage(error) };
    }

    // Count unique attemptIds that have pending evaluations
    const uniqueAttemptIds = new Set((data ?? []).map((row: any) => row.attempt_id));
    const pendingEvaluationCount = uniqueAttemptIds.size;

    return {
      success: true,
      data: { pendingEvaluationCount },
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}
