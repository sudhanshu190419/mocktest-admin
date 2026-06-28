/**
 * Mock Test Service
 *
 * Clean-architecture service layer encapsulating Mock Test CRUD operations
 * and lifecycle management.
 *
 * Every public method returns a standardised `ApiResponse<T>` shape so that
 * consumers (hooks, screens, etc.) never need to handle raw Supabase
 * exceptions or error formats.
 *
 * ## Scope
 *
 * This service manages the `mock_tests` table only. It does NOT manage:
 * - questions (see questionService.ts)
 * - mock_test_questions junction
 * - attempts, answers, or results
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
 * 3. **Clean mapping layer.** A single `mapMockTest` helper converts all
 *    snake_case database rows to camelCase TypeScript interfaces, avoiding
 *    duplication across functions.
 *
 * 4. **Status transitions via dedicated functions.** publishMockTest,
 *    archiveMockTest, and restoreMockTest encapsulate the status state
 *    machine transitions separately from general updates.
 *
 * @module mockTestService
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
  MockTest,
  MockTestStatus,
  CreateMockTestInput,
  UpdateMockTestInput,
} from '../../types/mockTest';

// ─── Local Filter / Sort Types ──────────────────────────────────────────────

/**
 * Filters available when querying the mock tests list.
 *
 * These are intentionally defined locally rather than importing the
 * existing `MockTestFilters` from types/mockTest.ts, because the service
 * exposes a specific subset of filters tailored to this layer's API.
 */
export interface MockTestServiceFilters {
  instituteId?: string;
  batchId?: string;
  streamId?: string;
  subjectId?: string;
  status?: MockTestStatus;
  /** Searches across title (case-insensitive LIKE). */
  search?: string;
  /** Teacher who created/owns the test (maps to DB column `teacher_id`). */
  createdBy?: string;
  /** Filter by specific test IDs. */
  ids?: string[];
}

/**
 * Sort options for mock tests list queries exposed by this service.
 */
export interface MockTestServiceSortOptions {
  sortBy?: 'title' | 'createdAt' | 'updatedAt' | 'scheduledStart' | 'scheduledEnd';
  sortDirection?: SortDirection;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Maps camelCase sort keys to their snake_case database column names.
 * Unknown keys fall back to `created_at`.
 */
const SORT_FIELD_MAP: Record<string, string> = {
  title: 'title',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  scheduledStart: 'available_from',
  scheduledEnd: 'available_until',
};

/**
 * Valid lifecycle status transitions for the mock test state machine.
 *
 * Key: current status
 * Value: allowed next statuses
 */
const VALID_TRANSITIONS: Record<MockTestStatus, MockTestStatus[]> = {
  draft: ['pending_approval', 'archived'],
  pending_approval: ['published', 'draft'],
  published: ['archived'],
  archived: ['draft'],
};

// ─── Database Row Shape ────────────────────────────────────────────────────

/**
 * Raw snake_case shape of the `mock_tests` table returned by Supabase.
 *
 * This type is internal to the service layer and is never exported.
 * Consumers receive only the camelCase `MockTest` interface.
 */
interface DbMockTest {
  test_id: string;
  institute_id: string;
  teacher_id: string;
  stream_id: string;
  subject_id: string | null;
  title: string;
  description: string | null;
  duration_min: number;
  total_marks: number;
  passing_marks: number | null;
  negative_marking: number;
  attempt_limit: number | null;
  shuffle_questions: boolean;
  shuffle_options: boolean;
  calculator_allowed: boolean;
  status: string;
  test_type: string;
  result_release_mode: string;
  result_release_at: string | null;
  available_from: string | null;
  available_until: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

// ─── Mapping Helpers ────────────────────────────────────────────────────────

/**
 * Converts a raw snake_case database row into a camelCase `MockTest` interface.
 *
 * This is the single source of truth for the mapping. If the schema changes
 * or new fields are added, update this function in one place.
 */
function mapMockTest(db: DbMockTest): MockTest {
  return {
    testId: db.test_id,
    instituteId: db.institute_id,
    teacherId: db.teacher_id,
    streamId: db.stream_id,
    subjectId: db.subject_id,
    title: db.title,
    description: db.description,
    durationMin: db.duration_min,
    totalMarks: db.total_marks,
    passingMarks: db.passing_marks,
    negativeMarking: db.negative_marking,
    attemptLimit: db.attempt_limit,
    shuffleQuestions: db.shuffle_questions,
    shuffleOptions: db.shuffle_options,
    calculatorAllowed: db.calculator_allowed,
    status: db.status as MockTestStatus,
    testType: db.test_type,
    resultReleaseMode: db.result_release_mode,
    resultReleaseAt: db.result_release_at,
    availableFrom: db.available_from,
    availableUntil: db.available_until,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
    publishedAt: db.published_at,
  };
}

/**
 * Converts a camelCase sort key from `MockTestServiceSortOptions` to the
 * corresponding snake_case column name in the database.
 */
function mapSortField(sortBy: MockTestServiceSortOptions['sortBy']): string {
  return SORT_FIELD_MAP[sortBy ?? 'createdAt'] ?? 'created_at';
}

/**
 * Validates that a status transition is allowed by the state machine.
 *
 * @returns An error message if the transition is invalid, or null if allowed.
 */
function validateTransition(
  currentStatus: MockTestStatus,
  nextStatus: MockTestStatus,
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
 * Fetch a paginated, filtered, and sorted list of mock tests.
 *
 * All parameters are optional. Sensible defaults are applied:
 * - page: 1
 * - pageSize: 20
 * - sortBy: created_at (descending)
 *
 * @param filters    - Optional filter criteria (instituteId, batchId, streamId,
 *                      subjectId, status, search, createdBy, ids).
 * @param sort       - Optional sort configuration (sortBy, sortDirection).
 * @param pagination - Optional pagination parameters (page, pageSize).
 *
 * @example
 * const result = await getMockTests(
 *   { instituteId: '...', status: 'published' },
 *   { sortBy: 'createdAt', sortDirection: 'desc' },
 *   { page: 1, pageSize: 20 },
 * );
 *
 * if (result.success) {
 *   console.log(result.data.data);    // MockTest[]
 *   console.log(result.data.count);   // total rows (for pagination)
 * }
 */
export async function getMockTests(
  filters?: MockTestServiceFilters,
  sort?: MockTestServiceSortOptions,
  pagination?: PaginationParams,
): Promise<ApiResponse<PaginatedResponse<MockTest>>> {
  try {
    // ── Build query ────────────────────────────────────────────────────
    let query = supabase
      .from('mock_tests')
      .select('*', { count: 'exact' });

    // ── Apply filters ──────────────────────────────────────────────────
    if (filters?.instituteId) {
      validateUUID(filters.instituteId, 'instituteId');
      query = query.eq('institute_id', filters.instituteId);
    }

    if (filters?.batchId) {
      validateUUID(filters.batchId, 'batchId');
      query = query.eq('batch_id', filters.batchId);
    }

    if (filters?.streamId) {
      validateUUID(filters.streamId, 'streamId');
      query = query.eq('stream_id', filters.streamId);
    }

    if (filters?.subjectId) {
      validateUUID(filters.subjectId, 'subjectId');
      query = query.eq('subject_id', filters.subjectId);
    }

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    if (filters?.createdBy) {
      validateUUID(filters.createdBy, 'createdBy');
      query = query.eq('teacher_id', filters.createdBy);
    }

    if (filters?.search) {
      const searchTerm = `%${filters.search}%`;
      query = query.ilike('title', searchTerm);
    }

    if (filters?.ids && filters.ids.length > 0) {
      query = query.in('test_id', filters.ids);
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

    const mockTests = (data ?? []).map(mapMockTest);

    return {
      success: true,
      data: buildPaginatedResponse(mockTests, count ?? 0, page, pageSize),
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Fetch a single mock test by its ID.
 *
 * @param testId - The UUID of the mock test to retrieve.
 *
 * @example
 * const result = await getMockTestById('uuid-here');
 * if (result.success) {
 *   console.log(result.data.title);
 * }
 */
export async function getMockTestById(testId: string): Promise<ApiResponse<MockTest>> {
  try {
    validateUUID(testId, 'testId');

    const { data, error } = await supabase
      .from('mock_tests')
      .select('*')
      .eq('test_id', testId)
      .single<DbMockTest>();

    if (error) {
      // PGRST116 = "The result contains 0 rows" — test not found
      if (error.code === 'PGRST116') {
        return { success: false, error: `Mock test not found: ${testId}` };
      }

      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapMockTest(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Create a new mock test.
 *
 * The `totalMarks` is set to 0 on creation (marks are populated when questions
 * are added in a separate step). The `status` defaults to `'draft'`.
 *
 * @param input - The mock test creation payload.
 *
 * @example
 * const result = await createMockTest({
 *   instituteId: 'uuid-here',
 *   teacherId: 'teacher-uuid',
 *   streamId: 'uuid-here',
 *   title: 'NEET 2025 Full Syllabus Mock #3',
 *   durationMin: 180,
 * });
 */
export async function createMockTest(input: CreateMockTestInput): Promise<ApiResponse<MockTest>> {
  try {
    // ── Validate required fields ───────────────────────────────────────
    if (!input.instituteId) {
      return { success: false, error: 'instituteId is required.' };
    }

    if (!input.teacherId) {
      return { success: false, error: 'teacherId is required.' };
    }

    if (!input.streamId) {
      return { success: false, error: 'streamId is required.' };
    }

    if (!input.title?.trim()) {
      return { success: false, error: 'Title is required.' };
    }

    if (input.title.trim().length < 3) {
      return { success: false, error: 'Title must be at least 3 characters.' };
    }

    if (!input.durationMin || input.durationMin <= 0) {
      return { success: false, error: 'durationMin must be greater than 0.' };
    }

    // ── Validate UUID formats ──────────────────────────────────────────
    validateUUID(input.instituteId, 'instituteId');
    validateUUID(input.teacherId, 'teacherId');
    validateUUID(input.streamId, 'streamId');

    if (input.subjectId) {
      validateUUID(input.subjectId, 'subjectId');
    }

    // ── Build DB record ────────────────────────────────────────────────
    const dbRecord: Record<string, unknown> = {
      institute_id: input.instituteId,
      teacher_id: input.teacherId,
      stream_id: input.streamId,
      subject_id: input.subjectId ?? null,
      title: input.title.trim(),
      description: input.description ?? null,
      duration_min: input.durationMin,
      total_marks: 1,
      passing_marks: input.passingMarks ?? null,
      negative_marking: input.negativeMarking ?? 0,
      attempt_limit: input.attemptLimit ?? null,
      shuffle_questions: input.shuffleQuestions ?? false,
      shuffle_options: input.shuffleOptions ?? false,
      calculator_allowed: input.calculatorAllowed ?? false,
      status: input.status ?? 'draft',
      test_type: input.testType ?? 'practice',
      result_release_mode: input.resultReleaseMode ?? 'immediate',
      result_release_at: input.resultReleaseAt ?? null,
      available_from: input.availableFrom ?? null,
      available_until: input.availableUntil ?? null,
    };

    // ── Insert ─────────────────────────────────────────────────────────
    const { data, error } = await supabase
      .from('mock_tests')
      .insert(dbRecord)
      .select()
      .single<DbMockTest>();

    if (error) {
      // FK violation
      if (error.code === '23503') {
        return {
          success: false,
          error:
            'Cannot create this mock test. The referenced institute, teacher, stream, or subject does not exist.',
        };
      }

      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapMockTest(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Update an existing mock test.
 *
 * Only the fields provided in `input` are updated. Partial updates are
 * safe — omitted fields retain their current database values.
 *
 * Published tests have restricted mutability. The service checks for this
 * before applying updates outside the permitted scope.
 *
 * @param testId - The UUID of the mock test to update.
 * @param input  - The fields to update (all optional).
 *
 * @example
 * const result = await updateMockTest('uuid-here', {
 *   title: 'Updated title',
 *   durationMin: 120,
 * });
 */
export async function updateMockTest(
  testId: string,
  input: UpdateMockTestInput,
): Promise<ApiResponse<MockTest>> {
  try {
    validateUUID(testId, 'testId');

    // ── Build update payload (only provided fields) ────────────────────
    const dbRecord: Record<string, unknown> = {};

    if (input.title !== undefined) {
      if (!input.title.trim()) {
        return { success: false, error: 'Title cannot be empty.' };
      }
      if (input.title.trim().length < 3) {
        return { success: false, error: 'Title must be at least 3 characters.' };
      }
      dbRecord.title = input.title.trim();
    }

    if (input.description !== undefined) {
      dbRecord.description = input.description;
    }

    if (input.durationMin !== undefined) {
      if (input.durationMin <= 0 || input.durationMin > 600) {
        return { success: false, error: 'durationMin must be between 1 and 600.' };
      }
      dbRecord.duration_min = input.durationMin;
    }

    if (input.passingMarks !== undefined) {
      dbRecord.passing_marks = input.passingMarks;
    }

    if (input.negativeMarking !== undefined) {
      if (input.negativeMarking < 0) {
        return { success: false, error: 'negativeMarking cannot be negative.' };
      }
      dbRecord.negative_marking = input.negativeMarking;
    }

    if (input.attemptLimit !== undefined) {
      dbRecord.attempt_limit = input.attemptLimit;
    }

    if (input.shuffleQuestions !== undefined) {
      dbRecord.shuffle_questions = input.shuffleQuestions;
    }

    if (input.shuffleOptions !== undefined) {
      dbRecord.shuffle_options = input.shuffleOptions;
    }

    if (input.calculatorAllowed !== undefined) {
      dbRecord.calculator_allowed = input.calculatorAllowed;
    }

    if (input.status !== undefined) {
      dbRecord.status = input.status;
    }

    if (input.testType !== undefined) {
      dbRecord.test_type = input.testType;
    }

    if (input.resultReleaseMode !== undefined) {
      dbRecord.result_release_mode = input.resultReleaseMode;
    }

    if (input.resultReleaseAt !== undefined) {
      dbRecord.result_release_at = input.resultReleaseAt;
    }

    if (input.availableFrom !== undefined) {
      dbRecord.available_from = input.availableFrom;
    }

    if (input.availableUntil !== undefined) {
      dbRecord.available_until = input.availableUntil;
    }

    // ── If nothing to update, return current ────────────────────────────
    if (Object.keys(dbRecord).length === 0) {
      return getMockTestById(testId);
    }

    // ── Update ─────────────────────────────────────────────────────────
    const { data, error } = await supabase
      .from('mock_tests')
      .update(dbRecord)
      .eq('test_id', testId)
      .select()
      .single<DbMockTest>();

    if (error) {
      // PGRST116 = test not found
      if (error.code === 'PGRST116') {
        return { success: false, error: `Mock test not found: ${testId}` };
      }

      // FK violation
      if (error.code === '23503') {
        return {
          success: false,
          error:
            'Cannot update this mock test. The referenced stream or subject does not exist.',
        };
      }

      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapMockTest(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Permanently delete a mock test.
 *
 * The `mock_tests` table has no `deleted_at` column, so this performs a hard
 * delete. If the test is referenced by foreign keys (mock_test_questions,
 * mock_attempts), the `ON DELETE RESTRICT` / `ON DELETE CASCADE` constraint
 * will either prevent deletion or cascade. For a safe retirement path, use
 * `archiveMockTest()` instead.
 *
 * @param testId - The UUID of the mock test to delete.
 *
 * @example
 * const result = await deleteMockTest('uuid-here');
 * if (result.success) {
 *   // test permanently removed
 * }
 */
export async function deleteMockTest(testId: string): Promise<ApiResponse<void>> {
  try {
    validateUUID(testId, 'testId');

    const { error } = await supabase
      .from('mock_tests')
      .delete()
      .eq('test_id', testId);

    if (error) {
      // Foreign-key violation (test has dependent rows)
      if (error.code === '23503') {
        return {
          success: false,
          error:
            'Cannot delete this mock test because it has questions or attempt history. ' +
            'Use archiveMockTest() to retire it instead.',
        };
      }

      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Publish a mock test, making it available for student attempts.
 *
 * Status transition: `pending_approval` → `published`
 *
 * Sets the `published_at` timestamp to the current time.
 *
 * @param testId - The UUID of the mock test to publish.
 *
 * @example
 * const result = await publishMockTest('uuid-here');
 * if (result.success) {
 *   // test is now available to students
 * }
 */
export async function publishMockTest(testId: string): Promise<ApiResponse<MockTest>> {
  return transitionStatus(testId, 'published');
}

/**
 * Archive (retire) a mock test.
 *
 * Status transition: `published` → `archived`
 *
 * Archived tests are excluded from student view but their data is preserved
 * for historical attempt references. Use `restoreMockTest()` to bring an
 * archived test back to draft.
 *
 * @param testId - The UUID of the mock test to archive.
 *
 * @example
 * const result = await archiveMockTest('uuid-here');
 * if (result.success) {
 *   // test retired from active use
 * }
 */
export async function archiveMockTest(testId: string): Promise<ApiResponse<MockTest>> {
  return transitionStatus(testId, 'archived');
}

/**
 * Restore an archived mock test back to draft for revision.
 *
 * Status transition: `archived` → `draft`
 *
 * After restoration, the test can be edited and resubmitted through the
 * approval workflow again.
 *
 * @param testId - The UUID of the mock test to restore.
 *
 * @example
 * const result = await restoreMockTest('uuid-here');
 * if (result.success) {
 *   // test available for editing
 * }
 */
export async function restoreMockTest(testId: string): Promise<ApiResponse<MockTest>> {
  return transitionStatus(testId, 'draft');
}

// ═══════════════════════════════════════════════════════════════════════════
//  Internal Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Transitions a mock test to a new status, validating the state machine.
 *
 * This is the single internal helper for all status transitions. It:
 * 1. Validates the transition is allowed
 * 2. Fetches the current test
 * 3. Executes the update with any associated audit fields
 *
 * @param testId    - The UUID of the mock test.
 * @param newStatus - The target status.
 */
async function transitionStatus(
  testId: string,
  newStatus: MockTestStatus,
): Promise<ApiResponse<MockTest>> {
  try {
    validateUUID(testId, 'testId');

    const existing = await getMockTestById(testId);
    if (!existing.success || !existing.data) {
      return { success: false, error: `Mock test not found: ${testId}` };
    }

    const transitionError = validateTransition(existing.data.status, newStatus);
    if (transitionError) {
      return { success: false, error: transitionError };
    }

    // Build update payload
    const dbUpdate: Record<string, unknown> = { status: newStatus };

    // Set published_at when publishing (pending_approval → published)
    if (newStatus === 'published') {
      dbUpdate.published_at = new Date().toISOString();
    }

    // Clear published_at only on rejection (pending_approval → draft).
    // Preserve the published_at audit trail when archiving (published → archived)
    // so the test's publish history is retained.
    if (newStatus === 'draft' && existing.data.status === 'pending_approval') {
      dbUpdate.published_at = null;
    }

    const { data, error } = await supabase
      .from('mock_tests')
      .update(dbUpdate)
      .eq('test_id', testId)
      .select()
      .single<DbMockTest>();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapMockTest(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}
