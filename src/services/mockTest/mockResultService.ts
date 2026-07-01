/**
 * Mock Result Service
 *
 * Clean-architecture service layer encapsulating Mock Result read, release,
 * hide, and delete operations for the results module.
 *
 * Every public method returns a standardised `ApiResponse<T>` shape so that
 * consumers (hooks, screens, etc.) never need to handle raw Supabase
 * exceptions or error formats.
 *
 * ## Scope
 *
 * This service manages the `mock_results` table only. It does NOT manage:
 * - evaluation / scoring (see mockEvaluationService.ts)
 * - attempts or answers
 * - ranking or percentile computation
 *
 * ## Architecture decisions
 *
 * 1. **RLS is respected.** This service uses the anon key — all queries run
 *    within the context of the authenticated user. RLS policies control
 *    what rows each user can see, insert, update, or delete.
 *
 * 2. **No service_role key.** This service never bypasses RLS.
 *
 * 3. **Clean mapping layer.** A single `mapMockResult` helper converts all
 *    snake_case database rows to camelCase TypeScript interfaces.
 *
 * 4. **Debug logging.** All operations log to the console in development
 *    using console.group patterns consistent with the existing services.
 *
 * @module mockResultService
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
  MockResult,
  MockResultFilters,
  MockResultSortOptions,
} from '../../types/mockTest';

// ─── Database Row Shape ────────────────────────────────────────────────────

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

// ─── Sort Field Map ────────────────────────────────────────────────────────

const SORT_FIELD_MAP: Record<string, string> = {
  totalScore: 'total_score',
  percentage: 'percentage',
  rank: 'rank',
  percentile: 'percentile',
  correctCount: 'correct_count',
  totalTimeSeconds: 'total_time_seconds',
  generatedAt: 'generated_at',
  releasedAt: 'released_at',
};

// ─── Mapping Helper ────────────────────────────────────────────────────────

/**
 * Converts a raw snake_case database row into a camelCase `MockResult` interface.
 */
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

/**
 * Maps a camelCase sort key to its snake_case database column name.
 */
function mapSortField(sortBy: MockResultSortOptions['sortBy']): string {
  return SORT_FIELD_MAP[sortBy ?? 'generatedAt'] ?? 'generated_at';
}

// ═══════════════════════════════════════════════════════════════════════════
//  Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch a result by its attempt ID (1:1 relationship).
 *
 * @param attemptId - UUID of the mock attempt.
 */
export async function getResultByAttemptId(
  attemptId: string,
): Promise<ApiResponse<MockResult>> {
  try {
    console.group('RESULT SERVICE');
    console.log('Operation: getResultByAttemptId');
    console.log('Payload:', { attemptId });

    validateUUID(attemptId, 'attemptId');

    const { data, error } = await supabase
      .from('mock_results')
      .select('*')
      .eq('attempt_id', attemptId)
      .single<DbMockResult>();

    console.log('Response:', { success: !error, data, error });
    console.groupEnd();

    if (error) {
      if (error.code === 'PGRST116') {
        return { success: false, error: `Result not found for attempt: ${attemptId}` };
      }
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapMockResult(data) };
  } catch (err) {
    console.group('RESULT SERVICE');
    console.log('Operation: getResultByAttemptId');
    console.log('Error:', (err as Record<string, unknown>).message);
    console.groupEnd();
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Fetch a single result by its result ID.
 *
 * @param resultId - UUID of the result.
 */
export async function getResult(
  resultId: string,
): Promise<ApiResponse<MockResult>> {
  try {
    console.group('RESULT SERVICE');
    console.log('Operation: getResult');
    console.log('Payload:', { resultId });

    validateUUID(resultId, 'resultId');

    const { data, error } = await supabase
      .from('mock_results')
      .select('*')
      .eq('result_id', resultId)
      .single<DbMockResult>();

    console.log('Response:', { success: !error, data, error });
    console.groupEnd();

    if (error) {
      if (error.code === 'PGRST116') {
        return { success: false, error: `Result not found: ${resultId}` };
      }
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapMockResult(data) };
  } catch (err) {
    console.group('RESULT SERVICE');
    console.log('Operation: getResult');
    console.log('Error:', (err as Record<string, unknown>).message);
    console.groupEnd();
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Fetch all results for a student, ordered by generated_at descending.
 *
 * @param studentId  - UUID of the student.
 * @param filters    - Optional additional filters.
 * @param sort       - Optional sort configuration.
 * @param pagination - Optional pagination parameters.
 */
export async function getStudentResults(
  studentId: string,
  filters?: Omit<MockResultFilters, 'studentId'>,
  sort?: MockResultSortOptions,
  pagination?: PaginationParams,
): Promise<ApiResponse<PaginatedResponse<MockResult>>> {
  try {
    console.group('RESULT SERVICE');
    console.log('Operation: getStudentResults');
    console.log('Payload:', { studentId, filters, sort, pagination });

    validateUUID(studentId, 'studentId');

    let query = supabase
      .from('mock_results')
      .select('*', { count: 'exact' })
      .eq('student_id', studentId);

    // Apply optional filters
    if (filters?.testId) {
      validateUUID(filters.testId, 'filters.testId');
      query = query.eq('test_id', filters.testId);
    }
    if (filters?.instituteId) {
      validateUUID(filters.instituteId, 'filters.instituteId');
      query = query.eq('institute_id', filters.instituteId);
    }
    if (filters?.isReleased !== undefined) {
      query = query.eq('is_released', filters.isReleased);
    }
    if (filters?.minScore !== undefined) {
      query = query.gte('total_score', filters.minScore);
    }
    if (filters?.maxScore !== undefined) {
      query = query.lte('total_score', filters.maxScore);
    }
    if (filters?.minRank !== undefined) {
      query = query.gte('rank', filters.minRank);
    }
    if (filters?.maxRank !== undefined) {
      query = query.lte('rank', filters.maxRank);
    }
    if (filters?.percentageMin !== undefined) {
      query = query.gte('percentage', filters.percentageMin);
    }
    if (filters?.percentageMax !== undefined) {
      query = query.lte('percentage', filters.percentageMax);
    }
    if (filters?.generatedAfter) {
      query = query.gte('generated_at', filters.generatedAfter);
    }
    if (filters?.generatedBefore) {
      query = query.lte('generated_at', filters.generatedBefore);
    }
    if (filters?.ids && filters.ids.length > 0) {
      query = query.in('result_id', filters.ids);
    }

    const sortBy = mapSortField(sort?.sortBy);
    const sortDir: SortDirection = sort?.sortDirection ?? 'desc';
    query = query.order(sortBy, { ascending: sortDir === 'asc' });

    const { page, pageSize, from, to } = buildPagination(pagination);
    query = query.range(from, to);

    const { data, error, count } = await query;

    console.log('Response:', { success: !error, count, error });
    console.groupEnd();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    const results = (data ?? []).map(mapMockResult);

    return {
      success: true,
      data: buildPaginatedResponse(results, count ?? 0, page, pageSize),
    };
  } catch (err) {
    console.group('RESULT SERVICE');
    console.log('Operation: getStudentResults');
    console.log('Error:', (err as Record<string, unknown>).message);
    console.groupEnd();
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Fetch all results for a mock test (leaderboard), ordered by total_score DESC.
 *
 * @param testId     - UUID of the mock test.
 * @param filters    - Optional additional filters.
 * @param sort       - Optional sort configuration.
 * @param pagination - Optional pagination parameters.
 */
export async function getMockTestResults(
  testId: string,
  filters?: Omit<MockResultFilters, 'testId'>,
  sort?: MockResultSortOptions,
  pagination?: PaginationParams,
): Promise<ApiResponse<PaginatedResponse<MockResult>>> {
  try {
    console.group('RESULT SERVICE');
    console.log('Operation: getMockTestResults');
    console.log('Payload:', { testId, filters, sort, pagination });

    validateUUID(testId, 'testId');

    let query = supabase
      .from('mock_results')
      .select('*', { count: 'exact' })
      .eq('test_id', testId);

    // Apply optional filters
    if (filters?.studentId) {
      validateUUID(filters.studentId, 'filters.studentId');
      query = query.eq('student_id', filters.studentId);
    }
    if (filters?.instituteId) {
      validateUUID(filters.instituteId, 'filters.instituteId');
      query = query.eq('institute_id', filters.instituteId);
    }
    if (filters?.isReleased !== undefined) {
      query = query.eq('is_released', filters.isReleased);
    }
    if (filters?.minScore !== undefined) {
      query = query.gte('total_score', filters.minScore);
    }
    if (filters?.maxScore !== undefined) {
      query = query.lte('total_score', filters.maxScore);
    }
    if (filters?.minRank !== undefined) {
      query = query.gte('rank', filters.minRank);
    }
    if (filters?.maxRank !== undefined) {
      query = query.lte('rank', filters.maxRank);
    }
    if (filters?.percentageMin !== undefined) {
      query = query.gte('percentage', filters.percentageMin);
    }
    if (filters?.percentageMax !== undefined) {
      query = query.lte('percentage', filters.percentageMax);
    }
    if (filters?.generatedAfter) {
      query = query.gte('generated_at', filters.generatedAfter);
    }
    if (filters?.generatedBefore) {
      query = query.lte('generated_at', filters.generatedBefore);
    }
    if (filters?.ids && filters.ids.length > 0) {
      query = query.in('result_id', filters.ids);
    }

    const sortBy = mapSortField(sort?.sortBy);
    const sortDir: SortDirection = sort?.sortDirection ?? 'desc';
    query = query.order(sortBy, { ascending: sortDir === 'asc' });

    const { page, pageSize, from, to } = buildPagination(pagination);
    query = query.range(from, to);

    const { data, error, count } = await query;

    console.log('Response:', { success: !error, count, dataLength: data?.length, error });
    console.groupEnd();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    const results = (data ?? []).map(mapMockResult);

    return {
      success: true,
      data: buildPaginatedResponse(results, count ?? 0, page, pageSize),
    };
  } catch (err) {
    console.group('RESULT SERVICE');
    console.log('Operation: getMockTestResults');
    console.log('Error:', (err as Record<string, unknown>).message);
    console.groupEnd();
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Fetch all results for an institute, ordered by generated_at descending.
 *
 * @param instituteId - UUID of the institute.
 * @param filters     - Optional additional filters.
 * @param sort        - Optional sort configuration.
 * @param pagination  - Optional pagination parameters.
 */
export async function getInstituteResults(
  instituteId: string,
  filters?: Omit<MockResultFilters, 'instituteId'>,
  sort?: MockResultSortOptions,
  pagination?: PaginationParams,
): Promise<ApiResponse<PaginatedResponse<MockResult>>> {
  try {
    console.group('RESULT SERVICE');
    console.log('Operation: getInstituteResults');
    console.log('Payload:', { instituteId, filters, sort, pagination });

    validateUUID(instituteId, 'instituteId');

    let query = supabase
      .from('mock_results')
      .select('*', { count: 'exact' })
      .eq('institute_id', instituteId);

    // Apply optional filters
    if (filters?.studentId) {
      validateUUID(filters.studentId, 'filters.studentId');
      query = query.eq('student_id', filters.studentId);
    }
    if (filters?.testId) {
      validateUUID(filters.testId, 'filters.testId');
      query = query.eq('test_id', filters.testId);
    }
    if (filters?.isReleased !== undefined) {
      query = query.eq('is_released', filters.isReleased);
    }
    if (filters?.minScore !== undefined) {
      query = query.gte('total_score', filters.minScore);
    }
    if (filters?.maxScore !== undefined) {
      query = query.lte('total_score', filters.maxScore);
    }
    if (filters?.minRank !== undefined) {
      query = query.gte('rank', filters.minRank);
    }
    if (filters?.maxRank !== undefined) {
      query = query.lte('rank', filters.maxRank);
    }
    if (filters?.percentageMin !== undefined) {
      query = query.gte('percentage', filters.percentageMin);
    }
    if (filters?.percentageMax !== undefined) {
      query = query.lte('percentage', filters.percentageMax);
    }
    if (filters?.generatedAfter) {
      query = query.gte('generated_at', filters.generatedAfter);
    }
    if (filters?.generatedBefore) {
      query = query.lte('generated_at', filters.generatedBefore);
    }
    if (filters?.ids && filters.ids.length > 0) {
      query = query.in('result_id', filters.ids);
    }

    const sortBy = mapSortField(sort?.sortBy);
    const sortDir: SortDirection = sort?.sortDirection ?? 'desc';
    query = query.order(sortBy, { ascending: sortDir === 'asc' });

    const { page, pageSize, from, to } = buildPagination(pagination);
    query = query.range(from, to);

    const { data, error, count } = await query;

    console.log('Response:', { success: !error, count, error });
    console.groupEnd();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    const results = (data ?? []).map(mapMockResult);

    return {
      success: true,
      data: buildPaginatedResponse(results, count ?? 0, page, pageSize),
    };
  } catch (err) {
    console.group('RESULT SERVICE');
    console.log('Operation: getInstituteResults');
    console.log('Error:', (err as Record<string, unknown>).message);
    console.groupEnd();
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Release a result, making it visible to the student.
 *
 * Sets `is_released = TRUE` and `released_at = NOW()`.
 *
 * @param resultId - UUID of the result to release.
 */
export async function releaseResult(
  resultId: string,
): Promise<ApiResponse<MockResult>> {
  try {
    console.group('RESULT SERVICE');
    console.log('Operation: releaseResult');
    console.log('Payload:', { resultId });

    validateUUID(resultId, 'resultId');

    const { data, error } = await supabase
      .from('mock_results')
      .update({
        is_released: true,
        released_at: new Date().toISOString(),
      })
      .eq('result_id', resultId)
      .select()
      .single<DbMockResult>();

    console.log('Response:', { success: !error, data, error });
    console.groupEnd();

    if (error) {
      if (error.code === 'PGRST116') {
        return { success: false, error: `Result not found: ${resultId}` };
      }
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapMockResult(data) };
  } catch (err) {
    console.group('RESULT SERVICE');
    console.log('Operation: releaseResult');
    console.log('Error:', (err as Record<string, unknown>).message);
    console.groupEnd();
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Hide a result, setting is_released = FALSE.
 *
 * @param resultId - UUID of the result to hide.
 */
export async function hideResult(
  resultId: string,
): Promise<ApiResponse<MockResult>> {
  try {
    console.group('RESULT SERVICE');
    console.log('Operation: hideResult');
    console.log('Payload:', { resultId });

    validateUUID(resultId, 'resultId');

    const { data, error } = await supabase
      .from('mock_results')
      .update({
        is_released: false,
        released_at: null,
      })
      .eq('result_id', resultId)
      .select()
      .single<DbMockResult>();

    console.log('Response:', { success: !error, data, error });
    console.groupEnd();

    if (error) {
      if (error.code === 'PGRST116') {
        return { success: false, error: `Result not found: ${resultId}` };
      }
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapMockResult(data) };
  } catch (err) {
    console.group('RESULT SERVICE');
    console.log('Operation: hideResult');
    console.log('Error:', (err as Record<string, unknown>).message);
    console.groupEnd();
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Delete a result (Developer Console only — not for production use).
 *
 * Uses a hard delete from the mock_results table. In production, results
 * should never be deleted — use hideResult() instead.
 *
 * @param resultId - UUID of the result to delete.
 */
export async function deleteResult(
  resultId: string,
): Promise<ApiResponse<void>> {
  try {
    console.group('RESULT SERVICE');
    console.log('Operation: deleteResult');
    console.log('Payload:', { resultId });

    validateUUID(resultId, 'resultId');

    const { error } = await supabase
      .from('mock_results')
      .delete()
      .eq('result_id', resultId);

    console.log('Response:', { success: !error, error });
    console.groupEnd();

    if (error) {
      if (error.code === '23503') {
        return {
          success: false,
          error: 'Cannot delete this result because it is referenced by other records.',
        };
      }
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true };
  } catch (err) {
    console.group('RESULT SERVICE');
    console.log('Operation: deleteResult');
    console.log('Error:', (err as Record<string, unknown>).message);
    console.groupEnd();
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Fetch a paginated, filtered, and sorted list of mock results.
 *
 * @param filters    - Optional filter criteria.
 * @param sort       - Optional sort configuration.
 * @param pagination - Optional pagination parameters.
 */
export async function getResults(
  filters?: MockResultFilters,
  sort?: MockResultSortOptions,
  pagination?: PaginationParams,
): Promise<ApiResponse<PaginatedResponse<MockResult>>> {
  try {
    console.group('RESULT SERVICE');
    console.log('Operation: getResults');
    console.log('Payload:', { filters, sort, pagination });

    let query = supabase
      .from('mock_results')
      .select('*', { count: 'exact' });

    // Apply filters
    if (filters?.attemptId) {
      validateUUID(filters.attemptId, 'filters.attemptId');
      query = query.eq('attempt_id', filters.attemptId);
    }
    if (filters?.testId) {
      validateUUID(filters.testId, 'filters.testId');
      query = query.eq('test_id', filters.testId);
    }
    if (filters?.studentId) {
      validateUUID(filters.studentId, 'filters.studentId');
      query = query.eq('student_id', filters.studentId);
    }
    if (filters?.instituteId) {
      validateUUID(filters.instituteId, 'filters.instituteId');
      query = query.eq('institute_id', filters.instituteId);
    }
    if (filters?.isReleased !== undefined) {
      query = query.eq('is_released', filters.isReleased);
    }
    if (filters?.minScore !== undefined) {
      query = query.gte('total_score', filters.minScore);
    }
    if (filters?.maxScore !== undefined) {
      query = query.lte('total_score', filters.maxScore);
    }
    if (filters?.minRank !== undefined) {
      query = query.gte('rank', filters.minRank);
    }
    if (filters?.maxRank !== undefined) {
      query = query.lte('rank', filters.maxRank);
    }
    if (filters?.percentageMin !== undefined) {
      query = query.gte('percentage', filters.percentageMin);
    }
    if (filters?.percentageMax !== undefined) {
      query = query.lte('percentage', filters.percentageMax);
    }
    if (filters?.generatedAfter) {
      query = query.gte('generated_at', filters.generatedAfter);
    }
    if (filters?.generatedBefore) {
      query = query.lte('generated_at', filters.generatedBefore);
    }
    if (filters?.ids && filters.ids.length > 0) {
      query = query.in('result_id', filters.ids);
    }

    const sortBy = mapSortField(sort?.sortBy);
    const sortDir: SortDirection = sort?.sortDirection ?? 'desc';
    query = query.order(sortBy, { ascending: sortDir === 'asc' });

    const { page, pageSize, from, to } = buildPagination(pagination);
    query = query.range(from, to);

    const { data, error, count } = await query;

    console.log('Response:', { success: !error, count, dataLength: data?.length, error });
    console.groupEnd();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    const results = (data ?? []).map(mapMockResult);

    return {
      success: true,
      data: buildPaginatedResponse(results, count ?? 0, page, pageSize),
    };
  } catch (err) {
    console.group('RESULT SERVICE');
    console.log('Operation: getResults');
    console.log('Error:', (err as Record<string, unknown>).message);
    console.groupEnd();
    return { success: false, error: extractErrorMessage(err) };
  }
}
