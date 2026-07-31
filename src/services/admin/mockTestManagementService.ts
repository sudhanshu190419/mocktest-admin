/**
 * Mock Test Management Service
 *
 * Single source of truth for all mock test management operations in the
 * Admin Mock Test Management module.
 *
 * Every public method returns a standardised `ApiResponse<T>` shape.
 * Follows the exact same architecture as `teacherLifecycleService.ts`,
 * `studentLifecycleService.ts`, and `questionApprovalService.ts`.
 *
 * ## Scope
 *
 * This service manages the lifecycle of mock tests via the `mock_tests.status`
 * column.  It does NOT manage:
 * - Questions within a test (handled by mockTestQuestionService)
 * - Attempts, answers, or results (handled by attempt/result services)
 * - Student-facing test view
 *
 * ## Status Transitions
 *
 * ```
 *                  ┌──────────────┐
 *                  │     draft    │
 *                  └──────┬───────┘
 *              ┌──────────┴──────────┐
 *              ▼                     ▼
 *         ┌──────────┐         ┌──────────┐
 *         │ published│         │ pending_ │
 *         │          │         │ approval │
 *         └─────┬─────┘         └────┬─────┘
 *               ▼                    │
 *         ┌──────────┐               │
 *         │ archived │               │
 *         └──────────┘               │
 *               ▼                    │
 *         ┌──────────┐               │
 *         │ published│  (unpublish)  │
 *         └──────────┘               │
 *                                     ▼
 *                               ┌──────────┐
 *                               │ published│
 *                               └──────────┘
 * ```
 *
 * @module services/admin/mockTestManagementService
 */

import { supabase } from '@/config/supabase';
import { buildPagination, extractErrorMessage, validateUUID } from '@/utils/supabase';
import { buildPaginatedResponse } from '@/utils/response';
import type { ApiResponse, PaginatedResponse, PaginationParams, SortDirection } from '@/types/academic';
import type { MockTestStatus } from '@/types/mockTest';
import { canApproveAcademicResources, approvalPermissionDenied } from './approvalGuard';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

/** Dashboard counts grouped by mock test status. */
export interface MockTestManagementCounts {
  draft: number;
  pendingApproval: number;
  published: number;
  archived: number;
  /** Sum of all statuses above. */
  total: number;
}

/** A single mock test row in the admin mock test list. */
export interface MockTestListItem {
  testId: string;
  title: string;
  description: string | null;
  durationMin: number;
  totalMarks: number;
  passingMarks: number | null;
  negativeMarking: number;
  status: MockTestStatus;
  testType: string;
  streamId: string;
  streamName: string | null;
  subjectId: string | null;
  subjectName: string | null;
  teacherId: string;
  teacherName: string | null;
  instituteId: string;
  attemptLimit: number | null;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  calculatorAllowed: boolean;
  resultReleaseMode: string;
  availableFrom: string | null;
  availableUntil: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Detailed mock test for the detail view. */
export interface MockTestManagementDetail extends MockTestListItem {
  /** Number of questions in this test. */
  questionCount: number;
  /** Number of student attempts. */
  attemptCount: number;
  /** Average score across all attempts. */
  averageScore: number | null;
  /** Number of students who have attempted this test. */
  uniqueStudentCount: number;
}

/** Statistics for the mock test management dashboard. */
export interface MockTestManagementStats {
  /** Count of mock tests grouped by test_type. */
  byType: { testType: string; count: number }[];
  /** Count of mock tests grouped by status. */
  byStatus: { status: string; count: number }[];
  /** Most recently created mock tests (last 10). */
  newestTests: MockTestListItem[];
  /** Mock tests with the most attempts (top 10). */
  mostAttempted: MockTestListItem[];
}

/** Filters for the mock test list query. */
export interface MockTestManagementFilters {
  instituteId?: string;
  /** Filter by mock test status (comma-separated for multiple). */
  status?: string;
  /** Filter by stream ID. */
  streamId?: string;
  /** Filter by subject ID. */
  subjectId?: string;
  /** Filter by test type. */
  testType?: string;
  /** Filter by teacher ID. */
  teacherId?: string;
  /** Search across title (case-insensitive). */
  search?: string;
}

/** A question belonging to a mock test. */
export interface MockTestQuestionItem {
  questionId: string;
  questionText: string;
  questionType: string;
  difficulty: string;
  marks: number;
  orderSequence: number;
  status: string;
  subjectId: string;
  subjectName: string | null;
  chapterId: string;
  chapterName: string | null;
}

/** Sort options for the mock test list query. */
export interface MockTestManagementSortOptions {
  sortBy?: 'title' | 'durationMin' | 'totalMarks' | 'status' | 'testType' | 'createdAt' | 'updatedAt' | 'publishedAt' | 'availableFrom' | 'availableUntil';
  sortDirection?: SortDirection;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

const SORT_FIELD_MAP: Record<string, string> = {
  title: 'title',
  durationMin: 'duration_min',
  totalMarks: 'total_marks',
  status: 'status',
  testType: 'test_type',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  publishedAt: 'published_at',
  availableFrom: 'available_from',
  availableUntil: 'available_until',
};

/** Valid lifecycle status transitions for mock tests in admin management. */
const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ['published', 'pending_approval', 'archived'],
  pending_approval: ['published', 'draft'],
  published: ['archived', 'draft'],
  archived: ['published'],
};

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function mapSortField(sortBy?: MockTestManagementSortOptions['sortBy']): string {
  return SORT_FIELD_MAP[sortBy ?? 'createdAt'] ?? 'created_at';
}

/**
 * Validates that a status transition is allowed.
 * Returns an error message if invalid, or null if allowed.
 */
function validateTransition(currentStatus: string, newStatus: string): string | null {
  const allowed = VALID_TRANSITIONS[currentStatus];
  if (!allowed) {
    return `Unknown current status: "${currentStatus}".`;
  }
  if (!allowed.includes(newStatus)) {
    return `Invalid status transition: "${currentStatus}" → "${newStatus}". Allowed: ${allowed.join(', ')}`;
  }
  return null;
}

/** Maps a raw Supabase row (mock_tests JOIN streams JOIN subjects) to MockTestListItem. */
function toMockTestListItem(row: any): MockTestListItem {
  return {
    testId: row.test_id,
    title: row.title,
    description: row.description ?? null,
    durationMin: row.duration_min,
    totalMarks: row.total_marks,
    passingMarks: row.passing_marks ?? null,
    negativeMarking: row.negative_marking,
    status: row.status as MockTestStatus,
    testType: row.test_type,
    streamId: row.stream_id,
    streamName: row.streams?.name ?? null,
    subjectId: row.subject_id ?? null,
    subjectName: row.subjects?.name ?? null,
    teacherId: row.teacher_id,
    teacherName: row.teacher_details?.profiles?.name ?? null,
    instituteId: row.institute_id,
    attemptLimit: row.attempt_limit ?? null,
    shuffleQuestions: row.shuffle_questions,
    shuffleOptions: row.shuffle_options,
    calculatorAllowed: row.calculator_allowed,
    resultReleaseMode: row.result_release_mode,
    availableFrom: row.available_from ?? null,
    availableUntil: row.available_until ?? null,
    publishedAt: row.published_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Service
// ═══════════════════════════════════════════════════════════════════════════

export const mockTestManagementService = {
  // ─────────────────────────────────────────────────────────────────────────
  //  1. Dashboard Counts
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get mock test management dashboard counts grouped by status.
   */
  async getCounts(instituteId?: string | null): Promise<ApiResponse<MockTestManagementCounts>> {
    try {
      const makeQuery = (status: MockTestStatus) => {
        let q = supabase
          .from('mock_tests')
          .select('test_id', { count: 'exact', head: true })
          .eq('status', status);
        if (instituteId) {
          q = q.eq('institute_id', instituteId);
        }
        return q;
      };

      const [draft, pendingApproval, published, archived] = await Promise.all([
        makeQuery('draft'),
        makeQuery('pending_approval'),
        makeQuery('published'),
        makeQuery('archived'),
      ]);

      const counts: MockTestManagementCounts = {
        draft: draft.count ?? 0,
        pendingApproval: pendingApproval.count ?? 0,
        published: published.count ?? 0,
        archived: archived.count ?? 0,
        total: 0,
      };
      counts.total = counts.draft + counts.pendingApproval + counts.published + counts.archived;

      return { success: true, data: counts };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  2. Mock Test List
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a paginated, filtered, and sorted list of mock tests.
   *
   * Joins `mock_tests` with `streams`, `subjects`, and `teacher_details` +
   * `profiles` (left joins) to include display names.  Supports search,
   * status filter, stream filter, subject filter, teacher filter,
   * pagination, and sorting.
   */
  async getList(
    filters?: MockTestManagementFilters,
    sort?: MockTestManagementSortOptions,
    pagination?: PaginationParams,
  ): Promise<ApiResponse<PaginatedResponse<MockTestListItem>>> {
    try {
      let query = supabase
        .from('mock_tests')
        .select(
          `
          *,
          streams!left (
            name
          ),
          subjects!left (
            name
          ),
          teacher_details!left (
            profiles!inner (
              name
            )
          )
        `,
          { count: 'exact' },
        );

      // ── Filters ─────────────────────────────────────────────────────
      if (filters?.instituteId) {
        query = query.eq('institute_id', filters.instituteId);
      }

      if (filters?.status) {
        const statuses = filters.status.split(',').map((s) => s.trim());
        if (statuses.length === 1) {
          query = query.eq('status', statuses[0]);
        } else {
          query = query.in('status', statuses);
        }
      }

      if (filters?.streamId) {
        query = query.eq('stream_id', filters.streamId);
      }

      if (filters?.subjectId) {
        query = query.eq('subject_id', filters.subjectId);
      }

      if (filters?.teacherId) {
        query = query.eq('teacher_id', filters.teacherId);
      }

      if (filters?.testType) {
        query = query.eq('test_type', filters.testType);
      }

      if (filters?.search) {
        const term = `%${filters.search}%`;
        query = query.ilike('title', term);
      }

      // ── Sorting ────────────────────────────────────────────────────
      const sortBy = mapSortField(sort?.sortBy);
      const direction = sort?.sortDirection ?? 'desc';
      query = query.order(sortBy, { ascending: direction === 'asc' });

      // ── Pagination ──────────────────────────────────────────────────
      const { page, pageSize, from, to } = buildPagination(pagination);
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const items = (data ?? []).map(toMockTestListItem);

      return {
        success: true,
        data: buildPaginatedResponse(items, count ?? 0, page, pageSize),
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  3. Mock Test Detail
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the full details for a single mock test, including question count,
   * attempt count, average score, and unique student count.
   */
  async getDetail(testId: string): Promise<ApiResponse<MockTestManagementDetail>> {
    try {
      validateUUID(testId, 'testId');

      // 1. Fetch mock test with joins
      const { data: test, error: testErr } = await supabase
        .from('mock_tests')
        .select(
          `
          *,
          streams!left (
            name
          ),
          subjects!left (
            name
          ),
          teacher_details!left (
            profiles!inner (
              name
            )
          )
        `,
        )
        .eq('test_id', testId)
        .single();

      if (testErr) {
        if (testErr.code === 'PGRST116') {
          return { success: false, error: `Mock test not found: ${testId}` };
        }
        return { success: false, error: extractErrorMessage(testErr) };
      }

      // 2. Fetch related counts in parallel
      const [questionsRes, attemptsRes, distinctStudentsRes] = await Promise.allSettled([
        // Question count
        supabase
          .from('mock_test_questions')
          .select('question_id', { count: 'exact', head: true })
          .eq('test_id', testId),

        // Attempt count
        supabase
          .from('mock_attempts')
          .select('attempt_id', { count: 'exact', head: true })
          .eq('test_id', testId),

        // Unique student count
        supabase
          .from('mock_attempts')
          .select('student_id', { count: 'exact', head: true })
          .eq('test_id', testId),
      ]);

      const questionCount = questionsRes.status === 'fulfilled' ? questionsRes.value.count ?? 0 : 0;
      const attemptCount = attemptsRes.status === 'fulfilled' ? attemptsRes.value.count ?? 0 : 0;
      const uniqueStudentCount = distinctStudentsRes.status === 'fulfilled' ? distinctStudentsRes.value.count ?? 0 : 0;

      // 3. Fetch average score (if there are results)
      let averageScore: number | null = null;
      if (attemptCount > 0) {
        const { data: scoreData } = await supabase
          .from('mock_results')
          .select('total_score')
          .eq('test_id', testId);

        if (scoreData && scoreData.length > 0) {
          const sum = scoreData.reduce((acc: number, r: any) => acc + (r.total_score ?? 0), 0);
          averageScore = Math.round((sum / scoreData.length) * 100) / 100;
        }
      }

      const baseItem = toMockTestListItem(test);

      const detail: MockTestManagementDetail = {
        ...baseItem,
        questionCount,
        attemptCount,
        averageScore,
        uniqueStudentCount,
      };

      return { success: true, data: detail };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  4. Status Mutations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Update a mock test's status with validation.
   *
   * All single-test status mutations (publish, unpublish, archive, restore)
   * funnel through this internal pipeline.
   *
   * @param testId    - The `mock_tests.test_id` of the test.
   * @param newStatus - The target status.
   */
  async updateStatus(
    testId: string,
    newStatus: MockTestStatus,
  ): Promise<ApiResponse<null>> {
    try {
      // ── Authorization: only super/academic admins may publish ──────────
      if (!(await canApproveAcademicResources())) {
        return approvalPermissionDenied();
      }

      validateUUID(testId, 'testId');

      // 1. Fetch current test to validate transition
      const { data: current, error: fetchErr } = await supabase
        .from('mock_tests')
        .select('status, published_at')
        .eq('test_id', testId)
        .single();

      if (fetchErr) {
        if (fetchErr.code === 'PGRST116') {
          return { success: false, error: `Mock test not found: ${testId}` };
        }
        return { success: false, error: extractErrorMessage(fetchErr) };
      }

      // 2. Validate transition
      const transitionError = validateTransition(current.status, newStatus);
      if (transitionError) {
        return { success: false, error: transitionError };
      }

      // 3. Build update payload
      const dbUpdate: Record<string, unknown> = { status: newStatus };

      // Set published_at when publishing (pending_approval → published or draft → published)
      if (newStatus === 'published' && current.status !== 'published') {
        dbUpdate.published_at = new Date().toISOString();
      }

      // For unpublish (published → draft): clear published_at
      if (newStatus === 'draft' && current.status === 'published') {
        dbUpdate.published_at = null;
      }

      // For archive (published → archived): preserve published_at for audit trail
      // For restore (archived → published): preserve existing published_at

      const { error } = await supabase
        .from('mock_tests')
        .update(dbUpdate)
        .eq('test_id', testId);

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  /** Publish (pending_approval → published). */
  async publish(testId: string): Promise<ApiResponse<null>> {
    return this.updateStatus(testId, 'published');
  },

  /** Unpublish (published → draft). */
  async unpublish(testId: string): Promise<ApiResponse<null>> {
    return this.updateStatus(testId, 'draft');
  },

  /** Archive (published → archived). Preserves published_at for audit trail. */
  async archive(testId: string): Promise<ApiResponse<null>> {
    return this.updateStatus(testId, 'archived');
  },

  /** Restore (archived → published). Preserves approval/publish metadata. */
  async restore(testId: string): Promise<ApiResponse<null>> {
    return this.updateStatus(testId, 'published');
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  5. Duplicate
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Duplicate an existing mock test.
   *
   * Creates a new mock test row with the same configuration but a
   * `(Copy)` suffix on the title and status set to `draft`.
   * Does NOT copy questions — questions must be added manually
   * or via a separate operation.
   *
   * @param testId - The UUID of the mock test to duplicate.
   */
  async duplicate(testId: string): Promise<ApiResponse<MockTestListItem>> {
    try {
      validateUUID(testId, 'testId');

      // 1. Fetch the original test
      const { data: original, error: fetchErr } = await supabase
        .from('mock_tests')
        .select('*')
        .eq('test_id', testId)
        .single();

      if (fetchErr) {
        if (fetchErr.code === 'PGRST116') {
          return { success: false, error: `Mock test not found: ${testId}` };
        }
        return { success: false, error: extractErrorMessage(fetchErr) };
      }

      // 2. Build the duplicate record
      const duplicateRecord: Record<string, unknown> = {
        institute_id: original.institute_id,
        teacher_id: original.teacher_id,
        stream_id: original.stream_id,
        subject_id: original.subject_id,
        title: `${original.title} (Copy)`,
        description: original.description,
        duration_min: original.duration_min,
        total_marks: original.total_marks,
        passing_marks: original.passing_marks,
        negative_marking: original.negative_marking,
        attempt_limit: original.attempt_limit,
        shuffle_questions: original.shuffle_questions,
        shuffle_options: original.shuffle_options,
        calculator_allowed: original.calculator_allowed,
        status: 'draft',
        test_type: original.test_type,
        result_release_mode: original.result_release_mode,
        result_release_at: original.result_release_at,
        available_from: original.available_from,
        available_until: original.available_until,
      };

      // 3. Insert the duplicate
      const { data: inserted, error: insertErr } = await supabase
        .from('mock_tests')
        .insert(duplicateRecord)
        .select(
          `
          *,
          streams!left (
            name
          ),
          subjects!left (
            name
          ),
          teacher_details!left (
            profiles!inner (
              name
            )
          )
        `,
        )
        .single();

      if (insertErr) {
        return { success: false, error: extractErrorMessage(insertErr) };
      }

      return { success: true, data: toMockTestListItem(inserted) };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  6. Delete
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Permanently delete a mock test.
   *
   * The `mock_tests` table has no soft-delete column, so this performs a
   * hard delete.  Dependent rows in `mock_test_questions`, `mock_attempts`,
   * and `mock_results` will prevent deletion via FK constraints.
   * For a safe retirement path, use `archive()` instead.
   *
   * @param testId - The UUID of the mock test to delete.
   */
  async delete(testId: string): Promise<ApiResponse<null>> {
    try {
      validateUUID(testId, 'testId');

      const { error } = await supabase
        .from('mock_tests')
        .delete()
        .eq('test_id', testId);

      if (error) {
        if (error.code === '23503') {
          return {
            success: false,
            error:
              'Cannot delete this mock test because it has questions, attempts, or results. ' +
              'Use archive() to retire it instead.',
          };
        }
        return { success: false, error: extractErrorMessage(error) };
      }

      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  7. Test Questions
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get all questions belonging to a mock test.
   *
   * Joins `mock_test_questions` with `questions`, `subjects`, and
   * `chapters` to include question metadata and display names.
   * Ordered by `order_sequence ASC`.
   *
   * @param testId - The `mock_tests.test_id`.
   */
  async getTestQuestions(testId: string): Promise<ApiResponse<MockTestQuestionItem[]>> {
    try {
      validateUUID(testId, 'testId');

      const { data, error } = await supabase
        .from('mock_test_questions')
        .select(
          `
          question_id,
          order_sequence,
          marks,
          questions!inner (
            question_id,
            question_text,
            question_type,
            difficulty,
            marks,
            status,
            subject_id,
            subjects!left (
              name
            ),
            chapter_id,
            chapters!left (
              name
            )
          )
        `,
        )
        .eq('test_id', testId)
        .order('order_sequence', { ascending: true });

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const items: MockTestQuestionItem[] = (data ?? []).map((row: any) => {
        const q = row.questions;
        return {
          questionId: q.question_id,
          questionText: q.question_text,
          questionType: q.question_type,
          difficulty: q.difficulty,
          marks: row.marks ?? q.marks,
          orderSequence: row.order_sequence,
          status: q.status,
          subjectId: q.subject_id,
          subjectName: q.subjects?.name ?? null,
          chapterId: q.chapter_id,
          chapterName: q.chapters?.name ?? null,
        };
      });

      return { success: true, data: items };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  8. Statistics
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get mock test statistics for the admin mock test management dashboard.
   *
   * Returns:
   * - Count by test_type
   * - Count by status
   * - Newest tests (last 10)
   * - Most attempted tests (top 10)
   */
  async getStats(instituteId?: string | null): Promise<ApiResponse<MockTestManagementStats>> {
    try {
      const instituteScope = instituteId ? { institute_id: instituteId } : {};

      // 1. Count by test_type
      const { data: typeData } = await supabase
        .from('mock_tests')
        .select('test_type, count:test_id')
        .match(instituteScope)
        .order('count', { ascending: false })
        .limit(10);

      const byType = (typeData ?? []).map((row: any) => ({
        testType: row.test_type ?? 'Unknown',
        count: typeof row.count === 'number' ? row.count : 0,
      }));

      // 2. Count by status — use getCounts and transform
      const countsRes = await this.getCounts(instituteId);
      const counts = countsRes.data;
      const byStatus = counts
        ? [
            { status: 'draft', count: counts.draft },
            { status: 'pending_approval', count: counts.pendingApproval },
            { status: 'published', count: counts.published },
            { status: 'archived', count: counts.archived },
          ]
        : [];

      // 3. Newest tests (last 10)
      let newestQuery = supabase
        .from('mock_tests')
        .select(
          `
          *,
          streams!left (
            name
          ),
          subjects!left (
            name
          ),
          teacher_details!left (
            profiles!inner (
              name
            )
          )
        `,
        )
        .match(instituteScope)
        .order('created_at', { ascending: false })
        .limit(10);

      const { data: newestData } = await newestQuery;
      const newestTests = (newestData ?? []).map(toMockTestListItem);

      // 4. Most attempted tests (top 10)
      // Join with mock_attempts to count attempts per test
      const { data: mostAttemptedData } = await supabase
        .from('mock_tests')
        .select(
          `
          *,
          streams!left (
            name
          ),
          subjects!left (
            name
          ),
          teacher_details!left (
            profiles!inner (
              name
            )
          )
        `,
        )
        .match(instituteScope)
        .order('created_at', { ascending: false })
        .limit(50); // Fetch more and sort by attempt count client-side

      let mostAttempted: MockTestListItem[] = [];
      if (mostAttemptedData) {
        // Fetch attempt counts for each test
        const testIds = mostAttemptedData.map((t: any) => t.test_id);
        const { data: attemptCounts } = await supabase
          .from('mock_attempts')
          .select('test_id, count:attempt_id', { count: 'exact' })
          .in('test_id', testIds);

        const attemptCountMap = new Map<string, number>();
        if (attemptCounts) {
          for (const row of attemptCounts as any[]) {
            attemptCountMap.set(row.test_id, typeof row.count === 'number' ? row.count : 0);
          }
        }

        // Sort by attempt count descending, take top 10
        mostAttempted = mostAttemptedData
          .map(toMockTestListItem)
          .sort((a: MockTestListItem, b: MockTestListItem) => {
            const aCount = attemptCountMap.get(a.testId) ?? 0;
            const bCount = attemptCountMap.get(b.testId) ?? 0;
            return bCount - aCount;
          })
          .slice(0, 10);
      }

      return {
        success: true,
        data: { byType, byStatus, newestTests, mostAttempted },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },
};
