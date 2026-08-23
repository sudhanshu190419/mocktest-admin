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

// ─── Authorization Helpers ────────────────────────────────────────────────

/**
 * Resolve the current authenticated user and their role.
 */
async function resolveCurrentUser(): Promise<
  | { success: true; userId: string; role: string }
  | { success: false; error: string }
> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return { success: false, error: 'Authentication required.' };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('profile_id', userData.user.id)
    .single<UserProfile>();

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
async function isAdminUser(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('admin_roles')
    .select('admin_role')
    .eq('profile_id', userId)
    .in('admin_role', ['super_admin', 'academic_admin']);

  return (data ?? []).length > 0;
}

/**
 * Resolve teacher_details.teacher_id from profile_id.
 */
async function resolveTeacherId(
  profileId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('teacher_details')
    .select('teacher_id')
    .eq('profile_id', profileId)
    .single<TeacherDetails>();

  return data?.teacher_id ?? null;
}

/**
 * Verify a teacher is authorized to evaluate a specific mock_answer.
 * Checks batch_subject_teachers assignment.
 */
async function verifyTeacherAuthorization(
  teacherId: string,
  answerId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('mock_answers')
    .select(`
      question_id,
      attempt_id,
      mock_attempts!inner(
        student_id
      )
    `)
    .eq('answer_id', answerId)
    .single();

  if (!data) return false;

  const attempt = data.attempt_id ? data as any : null;
  if (!attempt?.mock_attempts?.student_id) return false;

  const studentId = attempt.mock_attempts.student_id;
  const questionId = data.question_id;

  // Check: teacher is assigned to a batch_subject where this student is enrolled
  // AND the question belongs to the subject they teach
  // NOTE: A teacher may have multiple batch_subject assignments, so we check ALL.
  const { data: authAssignments } = await supabase
    .from('batch_subject_teachers')
    .select(`
      batch_subject_id,
      batch_subjects!inner(
        batch_id,
        subject_id
      )
    `)
    .eq('teacher_id', teacherId);

  if (!authAssignments || authAssignments.length === 0) return false;

  // Verify question exists and is subjective
  const { data: question } = await supabase
    .from('questions')
    .select('subject_id, question_type')
    .eq('question_id', questionId)
    .single();

  if (!question) return false;
  if (question.question_type !== 'subjective') return false;

  // Check if ANY of the teacher's assignments cover this student + subject
  for (const assignment of authAssignments) {
    const bs = assignment as any;
    const batchId = bs?.batch_subjects?.batch_id;
    const subjectId = bs?.batch_subjects?.subject_id;

    if (!batchId || !subjectId) continue;
    if (subjectId !== question.subject_id) continue;

    // Verify student is in this batch
    const { data: batchStudent } = await supabase
      .from('batch_students')
      .select('student_id')
      .eq('batch_id', batchId)
      .eq('student_id', studentId)
      .maybeSingle();

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

    for (const row of data ?? []) {
      const attempt = row.mock_attempts as any;
      const question = row.questions as any;
      const explanation = question.question_explanations as any;

      // Fetch student name
      let studentName: string | null = null;
      if (attempt?.student_id) {
        const { data: student } = await supabase
          .from('student_details')
          .select('profiles!inner(full_name)')
          .eq('student_id', attempt.student_id)
          .single();
        if (student) {
          studentName = (student as any).profiles?.full_name ?? null;
        }
      }

      // Fetch test title
      let testTitle = 'Unknown Test';
      if (attempt?.test_id) {
        const { data: test } = await supabase
          .from('mock_tests')
          .select('title')
          .eq('test_id', attempt.test_id)
          .single();
        if (test) testTitle = test.title;
      }

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
        .select('profiles!inner(full_name)')
        .eq('student_id', attempt.student_id)
        .single();
      if (student) {
        studentName = (student as any).profiles?.full_name ?? null;
      }
    }

    let testTitle = 'Unknown Test';
    const { data: test } = await supabase
      .from('mock_tests')
      .select('title')
      .eq('test_id', attempt.test_id)
      .single();
    if (test) testTitle = test.title;

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
  try {
    // ── 1. Authenticate ────────────────────────────────────────────────
    const user = await resolveCurrentUser();
    if (!user.success) return { success: false, error: user.error };

    validateUUID(input.answerId, 'answerId');

    // ── 2. Load the answer ─────────────────────────────────────────────
    const { data: answer, error: answerError } = await supabase
      .from('mock_answers')
      .select(`
        answer_id,
        attempt_id,
        question_id,
        evaluation_status,
        awarded_marks,
        evaluator_feedback,
        mock_attempts!inner(
          attempt_id,
          student_id,
          test_id,
          status
        ),
        questions!inner(
          question_id,
          question_type,
          marks
        )
      `)
      .eq('answer_id', input.answerId)
      .single();

    if (answerError || !answer) {
      return { success: false, error: 'Answer not found.' };
    }

    const attempt = answer.mock_attempts as any;
    const question = answer.questions as any;

    // ── 3. Validate it's a subjective question ─────────────────────────
    if (question.question_type !== 'subjective') {
      return { success: false, error: 'This question is not subjective and cannot be manually evaluated.' };
    }

    // ── 4. Validate marks ──────────────────────────────────────────────
    if (typeof input.awardedMarks !== 'number' || !Number.isFinite(input.awardedMarks)) {
      return { success: false, error: 'Awarded marks must be a valid number.' };
    }
    if (input.awardedMarks < 0) {
      return { success: false, error: 'Awarded marks cannot be negative.' };
    }
    if (input.awardedMarks > question.marks) {
      return { success: false, error: `Awarded marks (${input.awardedMarks}) cannot exceed question maximum (${question.marks}).` };
    }

    // ── 5. Check attempt not finalized ─────────────────────────────────
    if (attempt.status === 'submitted' || attempt.status === 'timed_out') {
      // Check if result is already released
      const { data: result } = await supabase
        .from('mock_results')
        .select('is_released')
        .eq('attempt_id', attempt.attempt_id)
        .single();

      if (result?.is_released) {
        return { success: false, error: 'This attempt has been finalized and released. Evaluation cannot be modified.' };
      }
    }

    // ── 6. Authorize ───────────────────────────────────────────────────
    const isSuperOrAcademicAdmin = await isAdminUser(user.userId);

    if (!isSuperOrAcademicAdmin) {
      const teacherId = await resolveTeacherId(user.userId);
      if (!teacherId) {
        return { success: false, error: 'Teacher profile not found.' };
      }

      const authorized = await verifyTeacherAuthorization(teacherId, input.answerId);
      if (!authorized) {
        return { success: false, error: 'You are not authorized to evaluate this student\'s answer.' };
      }
    }

    // ── 7. Save evaluation ─────────────────────────────────────────────
    const previousMarks = answer.awarded_marks;
    const previousFeedback = answer.evaluator_feedback;

    const { error: updateError } = await supabase
      .from('mock_answers')
      .update({
        evaluation_status: 'manual_evaluated',
        awarded_marks: input.awardedMarks,
        evaluated_by: user.userId,
        evaluated_at: new Date().toISOString(),
        evaluator_feedback: input.feedback ?? null,
      })
      .eq('answer_id', input.answerId);

    if (updateError) {
      return { success: false, error: `Failed to save evaluation: ${extractErrorMessage(updateError)}` };
    }

    // ── 8. Audit log ───────────────────────────────────────────────────
    await auditService.log({
      action: 'subjective_evaluation_saved',
      resourceType: 'mock_answers',
      resourceId: input.answerId,
      oldValue: { awardedMarks: previousMarks, feedback: previousFeedback },
      newValue: { awardedMarks: input.awardedMarks, feedback: input.feedback },
      metadata: {
        attemptId: attempt.attempt_id,
        questionId: question.question_id,
        studentId: attempt.student_id,
        testId: attempt.test_id,
      },
    });

    return { success: true, data: { answerId: input.answerId } };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Finalize subjective evaluation for an attempt.
 *
 * Verifies all subjective answers are evaluated, recalculates the final
 * score (objective + subjective), updates mock_results, and marks the
 * result as released.
 */
export async function finalizeSubjectiveEvaluation(
  input: FinalizeInput,
): Promise<ApiResponse<{ resultId: string }>> {
  console.error('[FINALIZE_TRACE] ENTERED finalizeSubjectiveEvaluation', {
    attemptId: input.attemptId,
  });

  try {
    // ── 1. Authenticate ────────────────────────────────────────────────
    const user = await resolveCurrentUser();
    if (!user.success) return { success: false, error: user.error };

    validateUUID(input.attemptId, 'attemptId');

    const isSuperOrAcademicAdmin = await isAdminUser(user.userId);
    let teacherId: string | null = null;

    if (!isSuperOrAcademicAdmin) {
      teacherId = await resolveTeacherId(user.userId);
      if (!teacherId) {
        return { success: false, error: 'Teacher profile not found.' };
      }
    }

    console.group('[SUBJ_FINALIZE_DEBUG] finalizeSubjectiveEvaluation() Flow');
    console.log('[SUBJ_FINALIZE_DEBUG] START_AUTH', {
      attemptId: input.attemptId,
      authUserId: user.userId,
      role: user.role,
      isSuperOrAcademicAdmin,
      resolvedTeacherId: teacherId,
    });

    // ── 2. Load attempt ────────────────────────────────────────────────
    const { data: attempt, error: attemptError } = await supabase
      .from('mock_attempts')
      .select('attempt_id, student_id, test_id, institute_id, status')
      .eq('attempt_id', input.attemptId)
      .single();

    if (attemptError || !attempt) {
      console.warn('[SUBJ_FINALIZE_DEBUG] Attempt not found:', attemptError);
      console.groupEnd();
      return { success: false, error: 'Attempt not found.' };
    }

    // ── 3. Authorize ───────────────────────────────────────────────────
    if (!isSuperOrAcademicAdmin && teacherId) {
      // 1. Get all batches this student is enrolled in
      const { data: studentBatches, error: sbError } = await supabase
        .from('batch_students')
        .select('batch_id')
        .eq('student_id', attempt.student_id);

      const studentBatchIds = (studentBatches ?? []).map((sb) => sb.batch_id);

      // 2. Get all batch subjects assigned to this teacher
      const { data: teacherAssignments, error: bstError } = await supabase
        .from('batch_subject_teachers')
        .select(`
          batch_subject_id,
          batch_subjects!inner(
            batch_id,
            subject_id
          )
        `)
        .eq('teacher_id', teacherId);

      const assignedBatchIds = (teacherAssignments ?? []).map(
        (ta: any) => ta.batch_subjects?.batch_id,
      ).filter(Boolean);

      const isAuthorized = studentBatchIds.some((batchId) =>
        assignedBatchIds.includes(batchId),
      );

      console.log('[FINALIZE_ASSIGNMENT_DEBUG]', {
        teacherId,
        attemptId: input.attemptId,
        studentId: attempt.student_id,
        studentBatchIds,
        teacherAssignmentCount: teacherAssignments?.length ?? 0,
        assignedBatchIds,
        isAuthorized,
        error: sbError || bstError,
      });

      if (!isAuthorized) {
        console.warn('[SUBJ_FINALIZE_DEBUG] Teacher not authorized for student in attempt:', attempt.attempt_id);
        console.groupEnd();
        return { success: false, error: 'You are not authorized to finalize this evaluation.' };
      }
    }

    // ── 4. Load all answers for this attempt ───────────────────────────
    const { data: answers, error: answersError } = await supabase
      .from('mock_answers')
      .select(`
        answer_id,
        question_id,
        marks_awarded,
        awarded_marks,
        evaluation_status,
        questions!inner(
          question_type,
          marks
        )
      `)
      .eq('attempt_id', input.attemptId);

    if (answersError || !answers) {
      console.warn('[SUBJ_FINALIZE_DEBUG] Failed to load answers:', answersError);
      console.groupEnd();
      return { success: false, error: 'Failed to load answers.' };
    }

    // ── 5. Check all subjective answers are evaluated ──────────────────
    const subjectiveAnswers = answers.filter(
      (a) => (a.questions as any).question_type === 'subjective',
    );

    if (subjectiveAnswers.length === 0) {
      console.warn('[SUBJ_FINALIZE_DEBUG] No subjective questions found in attempt');
      console.groupEnd();
      return { success: false, error: 'This attempt contains no subjective questions.' };
    }

    const pendingAnswers = subjectiveAnswers.filter(
      (a) => a.evaluation_status !== 'manual_evaluated',
    );

    console.log('[SUBJ_FINALIZE_DEBUG] ANSWERS_FETCH', {
      answerCount: answers.length,
      subjectiveAnswerCount: subjectiveAnswers.length,
      pendingAnswerCount: pendingAnswers.length,
      evaluatedAnswerCount: subjectiveAnswers.length - pendingAnswers.length,
      answersSummary: subjectiveAnswers.map((a: any) => ({
        answerId: a.answer_id,
        questionId: a.question_id,
        evaluationStatus: a.evaluation_status,
        awardedMarks: a.awarded_marks,
        marksAwarded: a.marks_awarded,
        maxMarks: (a.questions as any)?.marks,
      })),
    });

    if (pendingAnswers.length > 0) {
      console.warn('[SUBJ_FINALIZE_DEBUG] Subjective answers still pending:', pendingAnswers.length);
      console.groupEnd();
      return {
        success: false,
        error: `${pendingAnswers.length} subjective answer(s) still pending evaluation.`,
      };
    }

    // ── 6. Load existing result (created at submission time) ──────────
    console.log('[SUBJ_FINALIZE_DEBUG] BEFORE_RESULT_SELECT', { attemptId: input.attemptId });

    const { data: existingResult, error: selectResultError } = await supabase
      .from('mock_results')
      .select('result_id, total_score, max_score, percentage, is_released')
      .eq('attempt_id', input.attemptId)
      .maybeSingle();

    console.log('[SUBJ_FINALIZE_DEBUG] AFTER_RESULT_SELECT', {
      found: Boolean(existingResult),
      resultId: existingResult?.result_id ?? null,
      existingTotalScore: existingResult?.total_score ?? null,
      existingMaxScore: existingResult?.max_score ?? null,
      existingPercentage: existingResult?.percentage ?? null,
      selectErrorCode: selectResultError?.code ?? null,
      selectErrorMessage: selectResultError?.message ?? null,
      status: existingResult ? 'RESULT_SELECT_ALLOWED' : 'RESULT_SELECT_BLOCKED',
    });

    // ── 7. Calculate final score ───────────────────────────────────────
    let objectiveScore = 0;
    let subjectiveScore = 0;
    let maxScore = 0;
    let correctCount = 0;
    let wrongCount = 0;
    let skippedCount = 0;

    for (const answer of answers) {
      const question = answer.questions as any;
      maxScore += question.marks;

      if (question.question_type === 'subjective') {
        // Use awarded_marks from manual evaluation
        subjectiveScore += answer.awarded_marks ?? 0;
      } else {
        // Use existing auto-evaluated marks
        objectiveScore += answer.marks_awarded ?? 0;

        if (answer.marks_awarded !== null) {
          if (answer.marks_awarded > 0) {
            correctCount++;
          } else if (answer.marks_awarded < 0) {
            wrongCount++;
          } else {
            skippedCount++;
          }
        } else {
          skippedCount++;
        }
      }
    }

    const totalScore = objectiveScore + subjectiveScore;
    const percentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;

    console.log('[SUBJ_FINALIZE_DEBUG] SCORE_CALCULATION', {
      objectiveScore,
      subjectiveScore,
      totalScore,
      maxScore,
      percentage,
      correctCount,
      wrongCount,
      skippedCount,
    });

    // ── 8. Update or insert mock_results ───────────────────────────────
    if (existingResult) {
      console.log('[SUBJ_FINALIZE_DEBUG] RESULT_UPDATE_PAYLOAD', {
        resultId: existingResult.result_id,
        total_score: totalScore,
        percentage,
        correct_count: correctCount,
        wrong_count: wrongCount,
        skipped_count: skippedCount,
        is_released: false,
      });

      // Diagnostic update
      const { data: updateData, error: updateError } = await supabase
        .from('mock_results')
        .update({
          total_score: totalScore,
          percentage,
          correct_count: correctCount,
          wrong_count: wrongCount,
          skipped_count: skippedCount,
        })
        .eq('result_id', existingResult.result_id)
        .select();

      console.log('[SUBJ_FINALIZE_DEBUG] RESULT_UPDATE_RESPONSE', {
        updateError: updateError?.code ?? null,
        updateMessage: updateError?.message ?? null,
        updateDetails: (updateError as any)?.details ?? null,
        updateHint: (updateError as any)?.hint ?? null,
        returnedDataCount: updateData?.length ?? 0,
        returnedData: updateData ?? null,
      });

      if (updateError) {
        console.groupEnd();
        return { success: false, error: `Failed to update result: ${extractErrorMessage(updateError)}` };
      }

      // Diagnostic post-update verification select
      const { data: verifyRow, error: verifyError } = await supabase
        .from('mock_results')
        .select('result_id, total_score, max_score, percentage, is_released, released_at')
        .eq('result_id', existingResult.result_id)
        .maybeSingle();

      console.log('[SUBJ_FINALIZE_DEBUG] POST_UPDATE_VERIFY', {
        found: Boolean(verifyRow),
        totalScore: verifyRow?.total_score ?? null,
        maxScore: verifyRow?.max_score ?? null,
        percentage: verifyRow?.percentage ?? null,
        isReleased: verifyRow?.is_released ?? null,
        releasedAt: verifyRow?.released_at ?? null,
        errorCode: verifyError?.code ?? null,
        errorMessage: verifyError?.message ?? null,
      });

      // ── 9. Audit log ───────────────────────────────────────────────
      await auditService.log({
        action: 'subjective_evaluation_finalized',
        resourceType: 'mock_results',
        resourceId: existingResult.result_id,
        metadata: {
          attemptId: input.attemptId,
          studentId: attempt.student_id,
          testId: attempt.test_id,
          objectiveScore,
          subjectiveScore,
          totalScore,
          maxScore,
          subjectiveCount: subjectiveAnswers.length,
        },
      });

      console.log('[SUBJ_FINALIZE_DEBUG] FINAL_RESULT', {
        success: true,
        attemptId: input.attemptId,
        resultId: existingResult.result_id,
        totalScore,
        maxScore,
        percentage,
        error: null,
      });
      console.groupEnd();

      return { success: true, data: { resultId: existingResult.result_id } };
    } else {
      console.warn('[SUBJ_FINALIZE_DEBUG] FALLBACK_TO_INSERT_BRANCH', { attemptId: input.attemptId });

      // Create new result (shouldn't normally happen — result is created during submission)
      const { data: newResult, error: insertError } = await supabase
        .from('mock_results')
        .insert({
          attempt_id: input.attemptId,
          test_id: attempt.test_id,
          student_id: attempt.student_id,
          institute_id: attempt.institute_id,
          total_score: totalScore,
          max_score: maxScore,
          percentage,
          correct_count: correctCount,
          wrong_count: wrongCount,
          skipped_count: skippedCount,
          total_time_seconds: 0,
          avg_time_per_question: 0,
        })
        .select('result_id')
        .single();

      if (insertError) {
        console.groupEnd();
        return { success: false, error: `Failed to create result: ${extractErrorMessage(insertError)}` };
      }

      await auditService.log({
        action: 'subjective_evaluation_finalized',
        resourceType: 'mock_results',
        resourceId: newResult.result_id,
        metadata: {
          attemptId: input.attemptId,
          studentId: attempt.student_id,
          testId: attempt.test_id,
          objectiveScore,
          subjectiveScore,
          totalScore,
          maxScore,
          subjectiveCount: subjectiveAnswers.length,
        },
      });

      console.log('[SUBJ_FINALIZE_DEBUG] FINAL_RESULT (INSERT)', {
        success: true,
        attemptId: input.attemptId,
        resultId: newResult.result_id,
        totalScore,
        maxScore,
        percentage,
        error: null,
      });
      console.groupEnd();

      return { success: true, data: { resultId: newResult.result_id } };
    }
  } catch (err) {
    console.error('[SUBJ_FINALIZE_DEBUG] CATCH_ERROR', err);
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
