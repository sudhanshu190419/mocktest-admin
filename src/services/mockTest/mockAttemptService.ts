/**
 * Mock Attempt Service
 *
 * Clean-architecture service layer encapsulating Mock Attempt, Answer,
 * and Result CRUD operations for the Attempt Engine.
 *
 * Every public method returns a standardised `ApiResponse<T>` shape so that
 * consumers (hooks, screens, etc.) never need to handle raw Supabase
 * exceptions or error formats.
 *
 * ## Scope
 *
 * - mock_attempts table (create, read, update, delete, list)
 * - mock_answers table (create, read, update, delete, list)
 * - mock_answer_options table (create, read, delete)
 * - mock_results table (read, list)
 *
 * ## Architecture decisions
 *
 * 1. **RLS is respected.** This service uses the anon key — all queries run
 *    within the context of the authenticated user.
 * 2. **No service_role key.** This service never bypasses RLS.
 * 3. **Clean mapping layer.** Dedicated map functions convert snake_case DB
 *    rows to camelCase TypeScript interfaces.
 *
 * @module mockAttemptService
 */

import { supabase } from '../../config/supabase';
import { resolveCurrentStudentId } from './studentResolver';
import { validateUUID, extractErrorMessage, buildPagination } from '../../utils/supabase';
import { buildPaginatedResponse } from '../../utils/response';
import { getMockTestById } from './mockTestService';
import type {
  ApiResponse,
  PaginatedResponse,
  PaginationParams,
  SortDirection,
} from '../../types/academic';
import type {
  MockAttempt,
  MockAnswer,
  MockAnswerOption,
  MockResult,
  AttemptStatus,
  CreateMockAttemptInput,
  UpdateMockAttemptInput,
  MockAttemptFilters,
  MockAttemptSortOptions,
  CreateMockAnswerInput,
  UpdateMockAnswerInput,
  MockAnswerFilters,
  MockAnswerSortOptions,
  CreateMockAnswerOptionInput,
  MockAnswerOptionFilters,
  MockResultFilters,
  MockResultSortOptions,
} from '../../types/mockTest';

// ─── Database Row Shapes ──────────────────────────────────────────────────

interface DbMockAttempt {
  attempt_id: string;
  test_id: string;
  student_id: string;
  institute_id: string;
  attempt_number: number;
  status: string;
  started_at: string;
  submitted_at: string | null;
  time_remaining_seconds: number | null;
  ip_address: string | null;
  device_fingerprint: string | null;
  created_at: string;
  updated_at: string;
}

interface DbMockAnswer {
  answer_id: string;
  attempt_id: string;
  question_id: string;
  institute_id: string;
  is_answered: boolean;
  is_marked_for_review: boolean;
  numerical_answer: number | null;
  is_correct: boolean | null;
  marks_awarded: number | null;
  time_spent_seconds: number;
  answered_at: string | null;
  created_at: string;
  updated_at: string;
}

interface DbMockAnswerOption {
  answer_option_id: string;
  answer_id: string;
  option_id: string;
  selected_at: string;
}

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

// ─── Mapping Helpers ──────────────────────────────────────────────────────

function mapMockAttempt(db: DbMockAttempt): MockAttempt {
  return {
    attemptId: db.attempt_id,
    testId: db.test_id,
    studentId: db.student_id,
    instituteId: db.institute_id,
    attemptNumber: db.attempt_number,
    status: db.status as AttemptStatus,
    startedAt: db.started_at,
    submittedAt: db.submitted_at,
    timeRemainingSeconds: db.time_remaining_seconds,
    ipAddress: db.ip_address,
    deviceFingerprint: db.device_fingerprint,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
  };
}

function mapMockAnswer(db: DbMockAnswer): MockAnswer {
  return {
    answerId: db.answer_id,
    attemptId: db.attempt_id,
    questionId: db.question_id,
    instituteId: db.institute_id,
    isAnswered: db.is_answered,
    isMarkedForReview: db.is_marked_for_review,
    numericalAnswer: db.numerical_answer,
    isCorrect: db.is_correct,
    marksAwarded: db.marks_awarded,
    timeSpentSeconds: db.time_spent_seconds,
    answeredAt: db.answered_at,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
  };
}

function mapMockAnswerOption(db: DbMockAnswerOption): MockAnswerOption {
  return {
    answerOptionId: db.answer_option_id,
    answerId: db.answer_id,
    optionId: db.option_id,
    selectedAt: db.selected_at,
  };
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

// ─── Sort Field Maps ──────────────────────────────────────────────────────

const ATTEMPT_SORT_MAP: Record<string, string> = {
  attemptNumber: 'attempt_number',
  status: 'status',
  startedAt: 'started_at',
  submittedAt: 'submitted_at',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

const ANSWER_SORT_MAP: Record<string, string> = {
  timeSpentSeconds: 'time_spent_seconds',
  answeredAt: 'answered_at',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

const RESULT_SORT_MAP: Record<string, string> = {
  totalScore: 'total_score',
  percentage: 'percentage',
  rank: 'rank',
  percentile: 'percentile',
  correctCount: 'correct_count',
  totalTimeSeconds: 'total_time_seconds',
  generatedAt: 'generated_at',
  releasedAt: 'released_at',
};

// ═══════════════════════════════════════════════════════════════════════════
//  Mock Attempts
// ═══════════════════════════════════════════════════════════════════════════

export async function getMockAttempts(
  filters?: MockAttemptFilters,
  sort?: MockAttemptSortOptions,
  pagination?: PaginationParams,
): Promise<ApiResponse<PaginatedResponse<MockAttempt>>> {
  try {
    let query = supabase
      .from('mock_attempts')
      .select('*', { count: 'exact' });

    if (filters?.testId) {
      validateUUID(filters.testId, 'testId');
      query = query.eq('test_id', filters.testId);
    }

    if (filters?.studentId) {
      validateUUID(filters.studentId, 'studentId');
      query = query.eq('student_id', filters.studentId);
    }

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    if (filters?.instituteId) {
      validateUUID(filters.instituteId, 'instituteId');
      query = query.eq('institute_id', filters.instituteId);
    }

    if (filters?.startedAfter) {
      query = query.gte('started_at', filters.startedAfter);
    }

    if (filters?.startedBefore) {
      query = query.lte('started_at', filters.startedBefore);
    }

    if (filters?.ids && filters.ids.length > 0) {
      query = query.in('attempt_id', filters.ids);
    }

    const sortBy = ATTEMPT_SORT_MAP[sort?.sortBy ?? 'createdAt'] ?? 'created_at';
    const sortDir: SortDirection = sort?.sortDirection ?? 'desc';
    query = query.order(sortBy, { ascending: sortDir === 'asc' });

    const { page, pageSize, from, to } = buildPagination(pagination);
    query = query.range(from, to);

    const { data, error, count } = await query;

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    const attempts = (data ?? []).map(mapMockAttempt);

    return {
      success: true,
      data: buildPaginatedResponse(attempts, count ?? 0, page, pageSize),
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

export async function getMockAttemptById(attemptId: string): Promise<ApiResponse<MockAttempt>> {
  try {
    validateUUID(attemptId, 'attemptId');

    const { data, error } = await supabase
      .from('mock_attempts')
      .select('*')
      .eq('attempt_id', attemptId)
      .single<DbMockAttempt>();

    if (error) {
      if (error.code === 'PGRST116') {
        return { success: false, error: `Mock attempt not found: ${attemptId}` };
      }
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapMockAttempt(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

export async function createMockAttempt(input: CreateMockAttemptInput): Promise<ApiResponse<MockAttempt>> {
  try {
    if (!input.testId) return { success: false, error: 'testId is required.' };
    if (!input.studentId) return { success: false, error: 'studentId is required.' };
    if (!input.instituteId) return { success: false, error: 'instituteId is required.' };

    validateUUID(input.testId, 'testId');
    validateUUID(input.studentId, 'studentId');
    validateUUID(input.instituteId, 'instituteId');

    // ── Resolve correct student_id from session ────────────────────────
    // `mock_attempts.student_id` is FK → `student_details.student_id`, NOT
    // `profiles.profile_id`.  The RLS INSERT policy checks:
    //   student_id = (SELECT student_id FROM student_details WHERE profile_id = auth.uid())
    // So we must always use the resolved student_details.student_id.
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData?.session;
    const profileId = session?.user?.id;

    let studentDetailsId: string | null = null;
    if (profileId) {
      const resolved = await resolveCurrentStudentId();
      studentDetailsId = resolved?.studentId ?? null;
    }

    const studentId = studentDetailsId ?? input.studentId;
    const testId = input.testId;
    const instituteId = input.instituteId;

    // ── Fetch mock test for attempt limit ──────────────────────────────
    const testResult = await getMockTestById(testId);
    if (!testResult.success || !testResult.data) {
      return { success: false, error: 'Mock test not found.' };
    }
    const attemptLimit = testResult.data.attemptLimit;

    // ── Query latest attempt number for this student + test ────────────
    const { data: lastAttempt } = await supabase
      .from('mock_attempts')
      .select('attempt_number')
      .eq('student_id', studentId)
      .eq('test_id', testId)
      .order('attempt_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    const attemptNumber =
      lastAttempt?.attempt_number
        ? lastAttempt.attempt_number + 1
        : 1;

    // ── Validate attempt limit ─────────────────────────────────────────
    if (attemptLimit !== null && attemptNumber > attemptLimit) {
      return { success: false, error: 'Maximum attempt limit reached.' };
    }

    const dbRecord: Record<string, unknown> = {
      test_id: testId,
      student_id: studentId,
      institute_id: instituteId,
      attempt_number: attemptNumber,
      ip_address: input.ipAddress ?? null,
      device_fingerprint: input.deviceFingerprint ?? null,
    };

    // ── Debug logging ──────────────────────────────────────────────────
    console.group('ATTEMPT CREATE DEBUG');
    console.log('Authenticated profile ID:', profileId);
    console.log('Resolved student_details.student_id:', studentDetailsId);
    console.log('Payload student_id (input):', input.studentId);
    console.log('student_id === profileId:', input.studentId === profileId);
    console.log('student_id === studentDetailsId:', input.studentId === studentDetailsId);
    console.log('Payload:', { ...dbRecord, student_id_from_input: input.studentId });
    console.groupEnd();

    const { data, error } = await supabase
      .from('mock_attempts')
      .insert(dbRecord)
      .select()
      .single<DbMockAttempt>();

    // ── Detailed error logging on failure ───────────────────────────────
    if (error) {
      console.group('ATTEMPT CREATE ERROR');
      console.log('error.code:', error.code);
      console.log('error.message:', error.message);
      console.log('error.details:', (error as unknown as Record<string, unknown>).details);
      console.log('error.hint:', (error as unknown as Record<string, unknown>).hint);
      console.groupEnd();

      if (error.code === '23503') {
        return {
          success: false,
          error: 'Cannot create attempt. The referenced test or student does not exist.',
        };
      }
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapMockAttempt(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

export async function updateMockAttempt(
  attemptId: string,
  input: UpdateMockAttemptInput,
): Promise<ApiResponse<MockAttempt>> {
  try {
    validateUUID(attemptId, 'attemptId');

    const dbRecord: Record<string, unknown> = {};

    if (input.timeRemainingSeconds !== undefined) {
      dbRecord.time_remaining_seconds = input.timeRemainingSeconds;
    }
    if (input.status !== undefined) {
      dbRecord.status = input.status;
    }
    if (input.submittedAt !== undefined) {
      dbRecord.submitted_at = input.submittedAt;
    }

    const { data, error } = await supabase
      .from('mock_attempts')
      .update(dbRecord)
      .eq('attempt_id', attemptId)
      .select()
      .single<DbMockAttempt>();

    if (error) {
      if (error.code === 'PGRST116') {
        return { success: false, error: `Mock attempt not found: ${attemptId}` };
      }
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapMockAttempt(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

export async function deleteMockAttempt(attemptId: string): Promise<ApiResponse<void>> {
  try {
    validateUUID(attemptId, 'attemptId');

    const { error } = await supabase
      .from('mock_attempts')
      .delete()
      .eq('attempt_id', attemptId);

    if (error) {
      if (error.code === '23503') {
        return {
          success: false,
          error: 'Cannot delete this attempt because it has answers or results.',
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
//  Mock Answers
// ═══════════════════════════════════════════════════════════════════════════

export async function getMockAnswers(
  filters?: MockAnswerFilters,
  sort?: MockAnswerSortOptions,
): Promise<ApiResponse<MockAnswer[]>> {
  try {
    let query = supabase
      .from('mock_answers')
      .select('*');

    if (filters?.attemptId) {
      validateUUID(filters.attemptId, 'attemptId');
      query = query.eq('attempt_id', filters.attemptId);
    }

    if (filters?.questionId) {
      validateUUID(filters.questionId, 'questionId');
      query = query.eq('question_id', filters.questionId);
    }

    if (filters?.isAnswered !== undefined) {
      query = query.eq('is_answered', filters.isAnswered);
    }

    if (filters?.isMarkedForReview !== undefined) {
      query = query.eq('is_marked_for_review', filters.isMarkedForReview);
    }

    if (filters?.ids && filters.ids.length > 0) {
      query = query.in('answer_id', filters.ids);
    }

    const sortBy = ANSWER_SORT_MAP[sort?.sortBy ?? 'createdAt'] ?? 'created_at';
    const sortDir: SortDirection = sort?.sortDirection ?? 'asc';
    query = query.order(sortBy, { ascending: sortDir === 'asc' });

    const { data, error } = await query;

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: (data ?? []).map(mapMockAnswer) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

export async function getMockAnswerById(answerId: string): Promise<ApiResponse<MockAnswer>> {
  try {
    validateUUID(answerId, 'answerId');

    const { data, error } = await supabase
      .from('mock_answers')
      .select('*')
      .eq('answer_id', answerId)
      .single<DbMockAnswer>();

    if (error) {
      if (error.code === 'PGRST116') {
        return { success: false, error: `Mock answer not found: ${answerId}` };
      }
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapMockAnswer(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

export async function createMockAnswer(input: CreateMockAnswerInput): Promise<ApiResponse<MockAnswer>> {
  try {
    if (!input.attemptId) return { success: false, error: 'attemptId is required.' };
    if (!input.questionId) return { success: false, error: 'questionId is required.' };
    if (!input.instituteId) return { success: false, error: 'instituteId is required.' };

    validateUUID(input.attemptId, 'attemptId');
    validateUUID(input.questionId, 'questionId');
    validateUUID(input.instituteId, 'instituteId');

    const dbRecord: Record<string, unknown> = {
      attempt_id: input.attemptId,
      question_id: input.questionId,
      institute_id: input.instituteId,
    };

    const { data, error } = await supabase
      .from('mock_answers')
      .insert(dbRecord)
      .select()
      .single<DbMockAnswer>();

    if (error) {
      if (error.code === '23503') {
        return {
          success: false,
          error: 'Cannot create answer. The referenced attempt or question does not exist.',
        };
      }
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapMockAnswer(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

export async function updateMockAnswer(
  answerId: string,
  input: UpdateMockAnswerInput,
): Promise<ApiResponse<MockAnswer>> {
  try {
    validateUUID(answerId, 'answerId');

    const dbRecord: Record<string, unknown> = {};

    if (input.isAnswered !== undefined) dbRecord.is_answered = input.isAnswered;
    if (input.isMarkedForReview !== undefined) dbRecord.is_marked_for_review = input.isMarkedForReview;
    if (input.numericalAnswer !== undefined) dbRecord.numerical_answer = input.numericalAnswer;
    if (input.timeSpentSeconds !== undefined) dbRecord.time_spent_seconds = input.timeSpentSeconds;
    if (input.answeredAt !== undefined) dbRecord.answered_at = input.answeredAt;

    const { data, error } = await supabase
      .from('mock_answers')
      .update(dbRecord)
      .eq('answer_id', answerId)
      .select()
      .single<DbMockAnswer>();

    if (error) {
      if (error.code === 'PGRST116') {
        return { success: false, error: `Mock answer not found: ${answerId}` };
      }
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapMockAnswer(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

export async function deleteMockAnswer(answerId: string): Promise<ApiResponse<void>> {
  try {
    validateUUID(answerId, 'answerId');

    const { error } = await supabase
      .from('mock_answers')
      .delete()
      .eq('answer_id', answerId);

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Mock Answer Options (Junction)
// ═══════════════════════════════════════════════════════════════════════════

export async function getMockAnswerOptions(
  filters?: MockAnswerOptionFilters,
): Promise<ApiResponse<MockAnswerOption[]>> {
  try {
    let query = supabase
      .from('mock_answer_options')
      .select('*');

    if (filters?.answerId) {
      validateUUID(filters.answerId, 'answerId');
      query = query.eq('answer_id', filters.answerId);
    }

    if (filters?.optionId) {
      validateUUID(filters.optionId, 'optionId');
      query = query.eq('option_id', filters.optionId);
    }

    if (filters?.answerIds && filters.answerIds.length > 0) {
      query = query.in('answer_id', filters.answerIds);
    }

    query = query.order('selected_at', { ascending: true });

    const { data, error } = await query;

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: (data ?? []).map(mapMockAnswerOption) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

export async function createMockAnswerOption(
  input: CreateMockAnswerOptionInput,
): Promise<ApiResponse<MockAnswerOption>> {
  try {
    if (!input.answerId) return { success: false, error: 'answerId is required.' };
    if (!input.optionId) return { success: false, error: 'optionId is required.' };

    validateUUID(input.answerId, 'answerId');
    validateUUID(input.optionId, 'optionId');

    const dbRecord: Record<string, unknown> = {
      answer_id: input.answerId,
      option_id: input.optionId,
    };

    const { data, error } = await supabase
      .from('mock_answer_options')
      .insert(dbRecord)
      .select()
      .single<DbMockAnswerOption>();

    if (error) {
      if (error.code === '23503') {
        return {
          success: false,
          error: 'Cannot add option. The referenced answer or question option does not exist.',
        };
      }
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapMockAnswerOption(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

export async function deleteMockAnswerOption(answerOptionId: string): Promise<ApiResponse<void>> {
  try {
    validateUUID(answerOptionId, 'answerOptionId');

    const { error } = await supabase
      .from('mock_answer_options')
      .delete()
      .eq('answer_option_id', answerOptionId);

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

export async function deleteMockAnswerOptionsByAnswerId(answerId: string): Promise<ApiResponse<void>> {
  try {
    validateUUID(answerId, 'answerId');

    const { error } = await supabase
      .from('mock_answer_options')
      .delete()
      .eq('answer_id', answerId);

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Mock Results (Read-only from dev console)
// ═══════════════════════════════════════════════════════════════════════════

export async function getMockResults(
  filters?: MockResultFilters,
  sort?: MockResultSortOptions,
): Promise<ApiResponse<MockResult[]>> {
  try {
    let query = supabase
      .from('mock_results')
      .select('*');

    if (filters?.attemptId) {
      validateUUID(filters.attemptId, 'attemptId');
      query = query.eq('attempt_id', filters.attemptId);
    }

    if (filters?.testId) {
      validateUUID(filters.testId, 'testId');
      query = query.eq('test_id', filters.testId);
    }

    if (filters?.studentId) {
      validateUUID(filters.studentId, 'studentId');
      query = query.eq('student_id', filters.studentId);
    }

    if (filters?.instituteId) {
      validateUUID(filters.instituteId, 'instituteId');
      query = query.eq('institute_id', filters.instituteId);
    }

    if (filters?.isReleased !== undefined) {
      query = query.eq('is_released', filters.isReleased);
    }

    if (filters?.ids && filters.ids.length > 0) {
      query = query.in('result_id', filters.ids);
    }

    const sortBy = RESULT_SORT_MAP[sort?.sortBy ?? 'generatedAt'] ?? 'generated_at';
    const sortDir: SortDirection = sort?.sortDirection ?? 'desc';
    query = query.order(sortBy, { ascending: sortDir === 'asc' });

    const { data, error } = await query;

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: (data ?? []).map(mapMockResult) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

export async function getMockResultByAttemptId(attemptId: string): Promise<ApiResponse<MockResult>> {
  try {
    validateUUID(attemptId, 'attemptId');

    const { data, error } = await supabase
      .from('mock_results')
      .select('*')
      .eq('attempt_id', attemptId)
      .single<DbMockResult>();

    if (error) {
      if (error.code === 'PGRST116') {
        return { success: false, error: `Mock result not found for attempt: ${attemptId}` };
      }
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapMockResult(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

export async function getMockResultById(resultId: string): Promise<ApiResponse<MockResult>> {
  try {
    validateUUID(resultId, 'resultId');

    const { data, error } = await supabase
      .from('mock_results')
      .select('*')
      .eq('result_id', resultId)
      .single<DbMockResult>();

    if (error) {
      if (error.code === 'PGRST116') {
        return { success: false, error: `Mock result not found: ${resultId}` };
      }
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapMockResult(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}
