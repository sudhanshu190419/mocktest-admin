/**
 * Mock Test Assignment Service
 *
 * Single source of truth for mock test assignment operations within the
 * Admin Batch Management module.
 *
 * Every public method returns a standardised `ApiResponse<T>` shape.
 * Follows the exact same architecture as `batchStudentAssignmentService.ts`,
 * `batchTeacherAssignmentService.ts`, and `batchManagementService.ts`.
 *
 * ## Scope
 *
 * This service manages the planned `batch_mock_tests` junction table.
 * It does NOT manage:
 * - Batch lifecycle (handled by batchManagementService)
 * - Student enrollment (handled by batchStudentAssignmentService)
 * - Teacher assignment (handled by batchTeacherAssignmentService)
 * - Mock test CRUD or lifecycle (handled by mockTestService)
 *
 * ## Schema Note
 *
 * The `batch_mock_tests` junction table does not exist in the current DB
 * schema.  It is a planned table documented in:
 *   - src/services/admin/batchManagementService.ts (mockTestCount = 0)
 *   - Schema_Domain_05_Assessment.md
 *
 * Expected columns:
 *   assignment_id    uuid (PK)
 *   batch_id         uuid (FK → batches)
 *   test_id          uuid (FK → mock_tests)
 *   assigned_at      timestamptz
 *   available_from   timestamptz (nullable — override)
 *   available_until  timestamptz (nullable — override)
 *   attempt_limit    integer (nullable — override)
 *   created_at       timestamptz
 *
 * @module services/admin/mockTestAssignmentService
 */

import { supabase } from '@/config/supabase';
import { extractErrorMessage, validateUUID } from '@/utils/supabase';
import type { ApiResponse } from '@/types/academic';
import type { MockTest } from '@/types/mockTest';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

/** A mock test assigned to a batch. */
export interface AssignedMockTest {
  assignmentId: string;
  mockTestId: string;
  title: string;
  type: string;
  subject: string | null;
  stream: string;
  duration: number;
  totalMarks: number;
  publishedAt: string | null;
  assignedAt: string;
  availableFrom: string | null;
  availableUntil: string | null;
  attemptLimit: number | null;
  status: string;
}

/** Input for assigning mock tests to a batch. */
export interface AssignMockTestsOptions {
  availableFrom?: string | null;
  availableUntil?: string | null;
  attemptLimit?: number | null;
}

/** Result of an assign operation. */
export interface AssignMockTestsResult {
  assigned: number;
  skipped: number;
}

/** Input for updating an existing assignment. */
export interface UpdateMockTestAssignmentInput {
  availableFrom?: string | null;
  availableUntil?: string | null;
  attemptLimit?: number | null;
}

/** Assignment statistics for a batch. */
export interface MockTestAssignmentStats {
  /** Total tests assigned to this batch. */
  assigned: number;
  /** Tests currently available (NOW() BETWEEN available_from AND available_until). */
  active: number;
  /** Tests whose available_until has passed. */
  expired: number;
  /** Tests whose available_from is in the future. */
  upcoming: number;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Service
// ═══════════════════════════════════════════════════════════════════════════

export const mockTestAssignmentService = {
  // ─────────────────────────────────────────────────────────────────────────
  //  1. Get Assigned Mock Tests
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Fetch all mock tests assigned to a batch.
   *
   * Joins `batch_mock_tests` → `mock_tests` to return enriched test info.
   *
   * @param batchId - The `batches.batch_id`.
   */
  async getAssignedMockTests(batchId: string): Promise<ApiResponse<AssignedMockTest[]>> {
    try {
      validateUUID(batchId, 'batchId');

      const { data, error } = await supabase
        .from('batch_mock_tests')
        .select(
          `
          *,
          mock_tests!inner (
            test_id,
            title,
            test_type,
            subject_id,
            duration_min,
            total_marks,
            published_at,
            status,
            available_from,
            available_until,
            attempt_limit,
            streams!left (
              name
            ),
            subjects!left (
              name
            )
          )
        `,
        )
        .eq('batch_id', batchId)
        .order('assigned_at', { ascending: false });

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const list: AssignedMockTest[] = (data ?? []).map((row: any) => {
        const mt = row.mock_tests ?? {};
        return {
          assignmentId: row.assignment_id,
          mockTestId: mt.test_id ?? row.test_id,
          title: mt.title ?? 'Unknown',
          type: mt.test_type ?? 'practice',
          subject: mt.subjects?.name ?? null,
          stream: mt.streams?.name ?? '',
          duration: mt.duration_min ?? 0,
          totalMarks: mt.total_marks ?? 0,
          publishedAt: mt.published_at ?? null,
          assignedAt: row.assigned_at ?? row.created_at ?? '',
          availableFrom: row.available_from ?? mt.available_from ?? null,
          availableUntil: row.available_until ?? mt.available_until ?? null,
          attemptLimit: row.attempt_limit ?? mt.attempt_limit ?? null,
          status: mt.status ?? 'draft',
        };
      });

      return { success: true, data: list };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  2. Get Available Mock Tests
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Fetch published mock tests that are NOT already assigned to a batch.
   *
   * Supports optional search by title or subject name.
   *
   * @param batchId - The `batches.batch_id` to exclude already-assigned tests.
   * @param search  - Optional search term (title or subject).
   */
  async getAvailableMockTests(
    batchId: string,
    search?: string,
  ): Promise<ApiResponse<MockTest[]>> {
    try {
      validateUUID(batchId, 'batchId');

      // 1. Get the batch's institute_id
      const { data: batch, error: batchErr } = await supabase
        .from('batches')
        .select('institute_id, stream_id')
        .eq('batch_id', batchId)
        .single();

      if (batchErr) {
        if (batchErr.code === 'PGRST116') {
          return { success: false, error: `Batch not found: ${batchId}` };
        }
        return { success: false, error: extractErrorMessage(batchErr) };
      }

      // 2. Get already-assigned test IDs
      const { data: assignedData } = await supabase
        .from('batch_mock_tests')
        .select('test_id')
        .eq('batch_id', batchId);

      const assignedIds = (assignedData ?? []).map((r: any) => r.test_id);

      // 3. Query mock_tests for this institute + stream, published status
      let query = supabase
        .from('mock_tests')
        .select(
          `*,
          streams!left (name),
          subjects!left (name)
        `,
        )
        .eq('institute_id', batch.institute_id)
        .eq('status', 'published');

      // Exclude already-assigned tests
      if (assignedIds.length > 0) {
        query = query.not('test_id', 'in', `(${assignedIds.join(',')})`);
      }

      // Search filter
      if (search?.trim()) {
        const term = `%${search.trim()}%`;
        query = query.or(`title.ilike.${term},subjects.name.ilike.${term}`);
      }

      query = query.order('title', { ascending: true });

      const { data, error } = await query;

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const tests: MockTest[] = (data ?? []).map((row: any) => ({
        testId: row.test_id,
        instituteId: row.institute_id,
        teacherId: row.teacher_id,
        streamId: row.stream_id,
        subjectId: row.subject_id,
        title: row.title,
        description: row.description,
        durationMin: row.duration_min,
        totalMarks: row.total_marks,
        passingMarks: row.passing_marks,
        negativeMarking: row.negative_marking,
        attemptLimit: row.attempt_limit,
        shuffleQuestions: row.shuffle_questions,
        shuffleOptions: row.shuffle_options,
        calculatorAllowed: row.calculator_allowed,
        status: row.status,
        testType: row.test_type,
        resultReleaseMode: row.result_release_mode,
        resultReleaseAt: row.result_release_at,
        availableFrom: row.available_from,
        availableUntil: row.available_until,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        publishedAt: row.published_at,
      }));

      return { success: true, data: tests };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  3. Assign Mock Tests
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Assign multiple mock tests to a batch.
   *
   * Prevents duplicate assignments.  Options (availableFrom, availableUntil,
   * attemptLimit) are applied to all tests.
   *
   * @param batchId   - The `batches.batch_id`.
   * @param testIds   - Array of `mock_tests.test_id` values.
   * @param options   - Optional overrides for all assigned tests.
   */
  async assignMockTests(
    batchId: string,
    testIds: string[],
    options?: AssignMockTestsOptions,
  ): Promise<ApiResponse<AssignMockTestsResult>> {
    try {
      validateUUID(batchId, 'batchId');

      if (testIds.length === 0) {
        return { success: true, data: { assigned: 0, skipped: 0 } };
      }

      // Validate all test IDs
      for (const id of testIds) {
        validateUUID(id, 'testId');
      }

      // Get the current user for assigned_by
      const { data: userData } = await supabase.auth.getUser();
      const assignedBy = userData?.user?.id ?? null;

      // Build insert rows
      const now = new Date().toISOString();
      const rows = testIds.map((testId) => ({
        batch_id: batchId,
        test_id: testId,
        assigned_at: now,
        available_from: options?.availableFrom ?? null,
        available_until: options?.availableUntil ?? null,
        attempt_limit: options?.attemptLimit ?? null,
        assigned_by: assignedBy,
      }));

      const { error } = await supabase
        .from('batch_mock_tests')
        .insert(rows);

      if (error) {
        // 23505 = unique violation — some or all rows already exist
        if (error.code === '23505') {
          let assigned = 0;
          let skipped = 0;

          for (const row of rows) {
            const { error: insertErr } = await supabase
              .from('batch_mock_tests')
              .insert(row);

            if (insertErr && insertErr.code === '23505') {
              skipped++;
            } else if (!insertErr) {
              assigned++;
            } else {
              skipped++;
            }
          }

          return {
            success: true,
            data: { assigned, skipped },
            warning: `${skipped} mock test(s) were already assigned to this batch.`,
          };
        }

        return { success: false, error: extractErrorMessage(error) };
      }

      return {
        success: true,
        data: { assigned: testIds.length, skipped: 0 },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  4. Remove Single Assignment
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Remove a single mock test assignment from a batch.
   *
   * @param batchId      - The `batches.batch_id`.
   * @param assignmentId - The `batch_mock_tests.assignment_id`.
   */
  async removeMockTest(
    batchId: string,
    assignmentId: string,
  ): Promise<ApiResponse<null>> {
    try {
      validateUUID(batchId, 'batchId');
      validateUUID(assignmentId, 'assignmentId');

      const { error } = await supabase
        .from('batch_mock_tests')
        .delete()
        .eq('batch_id', batchId)
        .eq('assignment_id', assignmentId);

      if (error) {
        if (error.code === 'PGRST116') {
          return { success: false, error: 'Assignment not found.' };
        }
        return { success: false, error: extractErrorMessage(error) };
      }

      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  5. Bulk Remove Assignments
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Remove multiple mock test assignments from a batch.
   *
   * @param batchId       - The `batches.batch_id`.
   * @param assignmentIds - Array of `batch_mock_tests.assignment_id` values.
   */
  async removeMockTests(
    batchId: string,
    assignmentIds: string[],
  ): Promise<ApiResponse<null>> {
    try {
      validateUUID(batchId, 'batchId');

      if (assignmentIds.length === 0) {
        return { success: true, data: null };
      }

      for (const id of assignmentIds) {
        validateUUID(id, 'assignmentId');
      }

      const { error } = await supabase
        .from('batch_mock_tests')
        .delete()
        .eq('batch_id', batchId)
        .in('assignment_id', assignmentIds);

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  6. Update Assignment
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Update an existing assignment's configuration.
   *
   * Allows updating availableFrom, availableUntil, and attemptLimit.
   *
   * @param assignmentId - The `batch_mock_tests.assignment_id`.
   * @param input        - The fields to update.
   */
  async updateAssignment(
    assignmentId: string,
    input: UpdateMockTestAssignmentInput,
  ): Promise<ApiResponse<null>> {
    try {
      validateUUID(assignmentId, 'assignmentId');

      const dbRecord: Record<string, unknown> = {};

      if (input.availableFrom !== undefined) {
        dbRecord.available_from = input.availableFrom;
      }
      if (input.availableUntil !== undefined) {
        dbRecord.available_until = input.availableUntil;
      }
      if (input.attemptLimit !== undefined) {
        dbRecord.attempt_limit = input.attemptLimit;
      }

      if (Object.keys(dbRecord).length === 0) {
        return { success: true, data: null };
      }

      const { error } = await supabase
        .from('batch_mock_tests')
        .update(dbRecord)
        .eq('assignment_id', assignmentId);

      if (error) {
        if (error.code === 'PGRST116') {
          return { success: false, error: `Assignment not found: ${assignmentId}` };
        }
        return { success: false, error: extractErrorMessage(error) };
      }

      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  7. Get Assignment Stats
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get mock test assignment statistics for a batch.
   *
   * Returns total assigned, active, expired, and upcoming counts.
   *
   * @param batchId - The `batches.batch_id`.
   */
  async getAssignmentStats(batchId: string): Promise<ApiResponse<MockTestAssignmentStats>> {
    try {
      validateUUID(batchId, 'batchId');

      const { data, error } = await supabase
        .from('batch_mock_tests')
        .select(
          `
          assignment_id,
          available_from,
          available_until,
          mock_tests!inner (
            available_from,
            available_until
          )
        `,
        )
        .eq('batch_id', batchId);

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const now = new Date().toISOString();
      let active = 0;
      let expired = 0;
      let upcoming = 0;

      for (const row of data ?? []) {
        const rowAny = row as any;
        const mt = rowAny.mock_tests ?? {};
        const from = rowAny.available_from ?? mt.available_from;
        const until = rowAny.available_until ?? mt.available_until;

        if (until && until < now) {
          expired++;
        } else if (from && from > now) {
          upcoming++;
        } else {
          active++;
        }
      }

      return {
        success: true,
        data: {
          assigned: (data ?? []).length,
          active,
          expired,
          upcoming,
        },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },
};
