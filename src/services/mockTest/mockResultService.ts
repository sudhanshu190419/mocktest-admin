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
 * 5. **Batch operations use PostgreSQL RPCs.** `releaseMockResults` and
 *    `unreleaseMockResults` call Postgres functions via `supabase.rpc()`
 *    so that `released_at` is always set to `now()` on the database server,
 *    never the client clock. This satisfies the CHECK constraint:
 *      `released_at >= generated_at`
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

// ─── RPC Response Shapes ───────────────────────────────────────────────────

interface DbReleaseCount {
  updated_count: number;
}

interface DbReleaseStatus {
  total_results: number;
  released_results: number;
  unreleased_results: number;
  all_released: boolean;
  earliest_generated: string | null;
  latest_generated: string | null;
  first_released_at: string | null;
  last_released_at: string | null;
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
//  Public Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Aggregate release status for all results belonging to a mock test.
 *
 * Returned by `getReleaseStatus()`.
 */
export interface MockTestReleaseStatus {
  /** Total number of result rows for the test. */
  totalResults: number;
  /** Number of results with is_released = true. */
  releasedResults: number;
  /** Number of results with is_released = false. */
  unreleasedResults: number;
  /** TRUE when all results are released. */
  allReleased: boolean;
  /** Earliest generated_at across all results. */
  earliestGenerated: string | null;
  /** Latest generated_at across all results. */
  latestGenerated: string | null;
  /** Earliest released_at across all results (when first result was released). */
  firstReleasedAt: string | null;
  /** Latest released_at across all results (when last result was released). */
  lastReleasedAt: string | null;
}

/**
 * Maps a raw snake_case RPC status row to a camelCase `MockTestReleaseStatus`.
 */
function mapReleaseStatus(db: DbReleaseStatus): MockTestReleaseStatus {
  return {
    totalResults: db.total_results,
    releasedResults: db.released_results,
    unreleasedResults: db.unreleased_results,
    allReleased: db.all_released,
    earliestGenerated: db.earliest_generated,
    latestGenerated: db.latest_generated,
    firstReleasedAt: db.first_released_at,
    lastReleasedAt: db.last_released_at,
  };
}

/**
 * Result of a batch release or unrelease operation.
 */
export interface BatchReleaseResult {
  /** Number of mock_results rows that were updated. */
  updatedCount: number;
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
 * Release a single result, making it visible to the student.
 *
 * Sets `is_released = TRUE` and `released_at = NOW()`.
 *
 * For batch operations (release all results for a test), use
 * `releaseMockResults()` instead, which calls the PostgreSQL RPC function
 * and guarantees the timestamp comes from the database server.
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
 * Hide a single result, setting is_released = FALSE.
 *
 * For batch operations, use `unreleaseMockResults()` instead.
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

// ═══════════════════════════════════════════════════════════════════════════
//  Batch Release / Unrelease (via PostgreSQL RPC)
// ═══════════════════════════════════════════════════════════════════════════
//
// These methods use supabase.rpc() to call Postgres functions so that
// released_at is always set to now() on the database server, never the
// client clock. This satisfies the CHECK constraint:
//   (is_released = true AND released_at IS NOT NULL)
//    OR (is_released = false AND released_at IS NULL)
//
// Admin-only: RLS policies on mock_results ensure only admin users
// can update the is_released / released_at columns.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Release all currently unreleased results for a mock test.
 *
 * Calls the `release_test_results` PostgreSQL RPC function which sets:
 *   is_released = TRUE
 *   released_at = NOW()   (database server timestamp)
 *
 * Only rows WHERE is_released = FALSE are updated, satisfying the CHECK
 * constraint `ck_mock_results_is_released`.
 *
 * @param testId - UUID of the mock test whose results to release.
 *
 * @returns ApiResponse with the count of rows updated.
 *
 * @see supabase/migrations/035_mock_test_result_release.sql
 */
export async function releaseMockResults(
  testId: string,
): Promise<ApiResponse<BatchReleaseResult>> {
  try {
    console.group('RESULT SERVICE');
    console.log('Operation: releaseMockResults');
    console.log('Payload:', { testId });

    validateUUID(testId, 'testId');

    const { data, error } = await supabase.rpc('release_test_results', {
      p_test_id: testId,
    });

    console.log('Response:', { success: !error, data, error });
    console.groupEnd();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    const result = (data as DbReleaseCount[])?.[0];
    return {
      success: true,
      data: { updatedCount: result?.updated_count ?? 0 },
    };
  } catch (err) {
    console.group('RESULT SERVICE');
    console.log('Operation: releaseMockResults');
    console.log('Error:', (err as Record<string, unknown>).message);
    console.groupEnd();
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Unrelease (hide) all currently released results for a mock test.
 *
 * Calls the `unrelease_test_results` PostgreSQL RPC function which sets:
 *   is_released = FALSE
 *   released_at = NULL
 *
 * This satisfies the CHECK constraint because both fields are set together
 * to the "not released" state.
 *
 * @param testId - UUID of the mock test whose results to hide.
 *
 * @returns ApiResponse with the count of rows updated.
 *
 * @see supabase/migrations/035_mock_test_result_release.sql
 */
export async function unreleaseMockResults(
  testId: string,
): Promise<ApiResponse<BatchReleaseResult>> {
  try {
    console.group('RESULT SERVICE');
    console.log('Operation: unreleaseMockResults');
    console.log('Payload:', { testId });

    validateUUID(testId, 'testId');

    const { data, error } = await supabase.rpc('unrelease_test_results', {
      p_test_id: testId,
    });

    console.log('Response:', { success: !error, data, error });
    console.groupEnd();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    const result = (data as DbReleaseCount[])?.[0];
    return {
      success: true,
      data: { updatedCount: result?.updated_count ?? 0 },
    };
  } catch (err) {
    console.group('RESULT SERVICE');
    console.log('Operation: unreleaseMockResults');
    console.log('Error:', (err as Record<string, unknown>).message);
    console.groupEnd();
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Get the aggregate release status for all results belonging to a mock test.
 *
 * Calls the `get_test_release_status` PostgreSQL RPC function which returns
 * counts, all_released flag, and date ranges.
 *
 * @param testId - UUID of the mock test.
 *
 * @returns ApiResponse with MockTestReleaseStatus.
 *
 * @see supabase/migrations/035_mock_test_result_release.sql
 */
export async function getReleaseStatus(
  testId: string,
): Promise<ApiResponse<MockTestReleaseStatus>> {
  try {
    console.group('RESULT SERVICE');
    console.log('Operation: getReleaseStatus');
    console.log('Payload:', { testId });

    // TEMP DEBUG: Log before UUID validation
    console.log('[SERVICE] incoming testId =', testId);

    validateUUID(testId, 'testId');

    // TEMP DEBUG: UUID validation passed
    console.log('[SERVICE] UUID validation passed');

    // TEMP DEBUG: Log RPC request
    console.log('[RPC REQUEST]', testId);

    const { data, error } = await supabase.rpc('get_test_release_status', {
      p_test_id: testId,
    });

    // TEMP DEBUG: Log RPC response
    console.log('[RPC RESPONSE]', { data, error });

    console.log('Response:', { success: !error, data, error });
    console.groupEnd();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    const row = (data as DbReleaseStatus[])?.[0];
    if (!row) {
      // No results exist yet for this test
      return {
        success: true,
        data: {
          totalResults: 0,
          releasedResults: 0,
          unreleasedResults: 0,
          allReleased: false,
          earliestGenerated: null,
          latestGenerated: null,
          firstReleasedAt: null,
          lastReleasedAt: null,
        },
      };
    }

    // TEMP DEBUG: Log mapped release status before returning
    const mapped = mapReleaseStatus(row);
    console.log('[MAPPED RELEASE STATUS]', mapped);

    return { success: true, data: mapped };
  } catch (err) {
    console.group('RESULT SERVICE');
    console.log('Operation: getReleaseStatus');
    console.log('Error:', (err as Record<string, unknown>).message);
    console.groupEnd();
    return { success: false, error: extractErrorMessage(err) };
  }
}
