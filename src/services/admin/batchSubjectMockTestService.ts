/**
 * Batch Subject Mock Test Service
 *
 * Manages mock test assignments within a Batch Subject (subject-within-a-batch).
 * Serves as the primary service for querying and mutating `batch_subject_mock_tests`
 * — the migration 069 replacement for the old `batch_mock_tests` table.
 *
 * ## Scope
 *
 * This service manages the `batch_subject_mock_tests` junction table ONLY.
 * It does NOT manage:
 * - Batch Subject lifecycle
 * - Mock test CRUD or lifecycle (handled by mockTestService)
 * - Teacher assignment (handled by batchSubjectTeacherService)
 *
 * ## Business Rules
 *
 * - A Batch Subject may have multiple mock tests assigned (many-to-many).
 * - A mock test may belong to multiple Batch Subjects across batches.
 * - Assigning a test adds a new entry; duplicate entries are silently skipped.
 * - Only published mock tests from the same institute + subject are eligible.
 * - Teachers can only manage tests for Batch Subjects they are assigned to.
 *
 * @module services/admin/batchSubjectMockTestService
 */

import { supabase } from '@/config/supabase';
import { extractErrorMessage, validateUUID } from '@/utils/supabase';
import type { ApiResponse } from '@/types/academic';
import { auditService } from '@/services/audit/auditService';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

/** A mock test assigned to a Batch Subject. */
export interface AssignedBatchSubjectMockTest {
  assignmentId: string;
  batchSubjectId: string;
  mockTestId: string;
  title: string;
  testType: string;
  subjectName: string | null;
  streamName: string;
  durationMin: number;
  totalMarks: number;
  publishedAt: string | null;
  assignedAt: string;
  availableFrom: string | null;
  availableUntil: string | null;
  attemptLimit: number | null;
  status: string;
}

/** A mock test available for assignment to a Batch Subject. */
export interface AvailableBatchSubjectMockTest {
  testId: string;
  title: string;
  testType: string;
  subjectId: string;
  subjectName: string | null;
  streamName: string;
  durationMin: number;
  totalMarks: number;
  publishedAt: string | null;
  status: string;
}

/** Options when assigning mock tests. */
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

/** Assignment statistics for a Batch Subject. */
export interface BatchSubjectMockTestStats {
  /** Total tests assigned to this batch subject. */
  assigned: number;
  /** Tests currently available. */
  active: number;
  /** Tests whose available_until has passed. */
  expired: number;
  /** Tests whose available_from is in the future. */
  upcoming: number;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Service
// ═══════════════════════════════════════════════════════════════════════════

export const batchSubjectMockTestService = {
  // ─────────────────────────────────────────────────────────────────────────
  //  1. Get Assigned Mock Tests
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Fetch all mock tests assigned to a Batch Subject.
   *
   * Joins `batch_subject_mock_tests` → `mock_tests` to return enriched test info.
   *
   * @param batchSubjectId - The `batch_subjects.batch_subject_id`.
   */
  async getAssignedMockTests(
    batchSubjectId: string,
  ): Promise<ApiResponse<AssignedBatchSubjectMockTest[]>> {
    try {
      validateUUID(batchSubjectId, 'batchSubjectId');

      const { data, error } = await supabase
        .from('batch_subject_mock_tests')
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
            streams!left (
              name
            ),
            subjects!left (
              name
            )
          )
        `,
        )
        .eq('batch_subject_id', batchSubjectId)
        .order('assigned_at', { ascending: false });

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const list: AssignedBatchSubjectMockTest[] = (data ?? []).map((row: any) => {
        const mt = row.mock_tests ?? {};
        return {
          assignmentId: row.assignment_id,
          batchSubjectId: row.batch_subject_id,
          mockTestId: mt.test_id ?? row.test_id,
          title: mt.title ?? 'Unknown',
          testType: mt.test_type ?? 'practice',
          subjectName: mt.subjects?.name ?? null,
          streamName: mt.streams?.name ?? '',
          durationMin: mt.duration_min ?? 0,
          totalMarks: mt.total_marks ?? 0,
          publishedAt: mt.published_at ?? null,
          assignedAt: row.assigned_at ?? row.created_at ?? '',
          availableFrom: row.available_from ?? null,
          availableUntil: row.available_until ?? null,
          attemptLimit: row.attempt_limit ?? null,
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
   * Fetch published mock tests that are NOT already assigned to a Batch Subject.
   *
   * Scopes to the same institute and subject as the Batch Subject.
   * Supports optional search by title.
   *
   * @param batchSubjectId - The `batch_subjects.batch_subject_id`.
   * @param subjectId      - The subject_id to scope available tests.
   * @param search         - Optional search term.
   */
  async getAvailableMockTests(
    batchSubjectId: string,
    subjectId: string,
    search?: string,
  ): Promise<ApiResponse<AvailableBatchSubjectMockTest[]>> {
    try {
      console.log('[DIAG] getAvailableMockTests called with:', { batchSubjectId, subjectId, search });

      validateUUID(batchSubjectId, 'batchSubjectId');
      validateUUID(subjectId, 'subjectId');

      // 1. Get the Batch Subject's institute_id
      const { data: bs, error: bsErr } = await supabase
        .from('batch_subjects')
        .select('institute_id')
        .eq('batch_subject_id', batchSubjectId)
        .single();

      if (bsErr) {
        console.error('[DIAG] Failed to fetch batch_subject institute_id:', bsErr);
        if (bsErr.code === 'PGRST116') {
          return { success: false, error: `Batch Subject not found: ${batchSubjectId}` };
        }
        return { success: false, error: extractErrorMessage(bsErr) };
      }

      console.log('[DIAG] Batch subject institute_id:', bs.institute_id);

      // 2. Get already-assigned test IDs
      const { data: assignedData } = await supabase
        .from('batch_subject_mock_tests')
        .select('test_id')
        .eq('batch_subject_id', batchSubjectId);

      const assignedIds = (assignedData ?? []).map((r: any) => r.test_id);
      console.log('[DIAG] Already assigned test IDs:', assignedIds);

      // 2a. Check ALL published tests in this institute to compare subject_id matching
      const { data: allPublished, error: allPubErr } = await supabase
        .from('mock_tests')
        .select('test_id, title, subject_id, institute_id, status')
        .eq('institute_id', bs.institute_id)
        .eq('status', 'published');

      if (allPubErr) {
        console.error('[DIAG] Failed to fetch all published tests:', allPubErr);
      } else {
        console.log('[DIAG] All published mock_tests in this institute:', allPublished?.length ?? 0);
        console.log('[DIAG] Looking for subject_id:', subjectId);
        allPublished?.forEach((t: any) => {
          console.log(`[DIAG]   "${t.title}" | subject_id: ${t.subject_id} | matches: ${t.subject_id === subjectId} | type check: ${typeof t.subject_id} === ${typeof subjectId}`);
        });
      }

      // 3. Query mock_tests for this institute + subject, published status
      let query = supabase
        .from('mock_tests')
        .select(
          `*,
          streams!left (name),
          subjects!left (name)
        `,
        )
        .eq('institute_id', bs.institute_id)
        .eq('subject_id', subjectId)
        .eq('status', 'published');

      // Exclude already-assigned tests
      if (assignedIds.length > 0) {
        console.log('[DIAG] Excluding already-assigned test_ids:', assignedIds);
        query = query.not('test_id', 'in', `(${assignedIds.join(',')})`);
      }

      // Search filter
      if (search?.trim()) {
        const term = `%${search.trim()}%`;
        console.log('[DIAG] Applying search filter:', term);
        query = query.or(`title.ilike.${term},subjects.name.ilike.${term}`);
      }

      query = query.order('title', { ascending: true });

      console.log('[DIAG] Executing final query for subject_id:', subjectId, 'and institute_id:', bs.institute_id);
      const { data, error } = await query;

      if (error) {
        console.error('[DIAG] Final query failed:', error);
        return { success: false, error: extractErrorMessage(error) };
      }

      console.log('[DIAG] Final filtered results count:', data?.length ?? 0);
      console.log('[DIAG] Final filtered results:', data);

      const tests: AvailableBatchSubjectMockTest[] = (data ?? []).map((row: any) => ({
        testId: row.test_id,
        title: row.title ?? 'Unknown',
        testType: row.test_type ?? 'practice',
        subjectId: row.subject_id ?? '',
        subjectName: row.subjects?.name ?? null,
        streamName: row.streams?.name ?? '',
        durationMin: row.duration_min ?? 0,
        totalMarks: row.total_marks ?? 0,
        publishedAt: row.published_at ?? null,
        status: row.status ?? 'draft',
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
   * Assign multiple mock tests to a Batch Subject.
   *
   * Prevents duplicate assignments. Options (availableFrom, availableUntil,
   * attemptLimit) are applied to all tests.
   *
   * @param batchSubjectId - The `batch_subjects.batch_subject_id`.
   * @param testIds        - Array of `mock_tests.test_id` values.
   * @param options        - Optional overrides for all assigned tests.
   */
  async assignMockTests(
    batchSubjectId: string,
    testIds: string[],
    options?: AssignMockTestsOptions,
  ): Promise<ApiResponse<AssignMockTestsResult>> {
    try {
      validateUUID(batchSubjectId, 'batchSubjectId');

      if (testIds.length === 0) {
        return { success: true, data: { assigned: 0, skipped: 0 } };
      }

      for (const id of testIds) {
        validateUUID(id, 'testId');
      }

      // 1. Get batch subject's institute_id
      const { data: bs, error: bsErr } = await supabase
        .from('batch_subjects')
        .select('institute_id')
        .eq('batch_subject_id', batchSubjectId)
        .single();

      if (bsErr) {
        if (bsErr.code === 'PGRST116') {
          return { success: false, error: `Batch Subject not found: ${batchSubjectId}` };
        }
        return { success: false, error: extractErrorMessage(bsErr) };
      }

      // 2. Get the current user for assigned_by
      const { data: userData } = await supabase.auth.getUser();
      const assignedBy = userData?.user?.id ?? null;

      // 3. Build insert rows
      const now = new Date().toISOString();
      const rows = testIds.map((testId) => ({
        batch_subject_id: batchSubjectId,
        test_id: testId,
        institute_id: bs.institute_id,
        assigned_at: now,
        available_from: options?.availableFrom ?? null,
        available_until: options?.availableUntil ?? null,
        attempt_limit: options?.attemptLimit ?? null,
        assigned_by: assignedBy,
      }));

      const { error } = await supabase
        .from('batch_subject_mock_tests')
        .insert(rows);

      if (error) {
        // 23505 = unique violation — some or all rows already exist
        if (error.code === '23505') {
          let assigned = 0;
          let skipped = 0;

          for (const row of rows) {
            const { error: insertErr } = await supabase
              .from('batch_subject_mock_tests')
              .insert(row);

            if (insertErr && insertErr.code === '23505') {
              skipped++;
            } else if (!insertErr) {
              assigned++;
            } else {
              skipped++;
            }
          }

          // ── Audit: mock tests assigned (single bulk event) ────────────
          await auditService.logAssign({
            resourceType: 'batch_subject_mock_tests',
            resourceId: null,
            metadata: { batchSubjectId, testIds, assigned, skipped },
          });

          return {
            success: true,
            data: { assigned, skipped },
            warning: `${skipped} mock test(s) were already assigned to this batch subject.`,
          };
        }

        return { success: false, error: extractErrorMessage(error) };
      }

      // ── Audit: mock tests assigned (single bulk event) ────────────────
      await auditService.logAssign({
        resourceType: 'batch_subject_mock_tests',
        resourceId: null,
        metadata: { batchSubjectId, testIds, assigned: testIds.length, skipped: 0 },
      });

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
   * Remove a single mock test assignment from a Batch Subject.
   *
   * @param batchSubjectId - The `batch_subjects.batch_subject_id`.
   * @param assignmentId   - The `batch_subject_mock_tests.assignment_id`.
   */
  async removeMockTest(
    batchSubjectId: string,
    assignmentId: string,
  ): Promise<ApiResponse<null>> {
    try {
      validateUUID(batchSubjectId, 'batchSubjectId');
      validateUUID(assignmentId, 'assignmentId');

      const { error } = await supabase
        .from('batch_subject_mock_tests')
        .delete()
        .eq('batch_subject_id', batchSubjectId)
        .eq('assignment_id', assignmentId);

      if (error) {
        if (error.code === 'PGRST116') {
          return { success: false, error: 'Assignment not found.' };
        }
        return { success: false, error: extractErrorMessage(error) };
      }

      // ── Audit: mock test unassigned ───────────────────────────────────
      await auditService.logUnassign({
        resourceType: 'batch_subject_mock_tests',
        resourceId: null,
        metadata: { batchSubjectId, assignmentId },
      });

      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  5. Bulk Remove Assignments
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Remove multiple mock test assignments from a Batch Subject.
   *
   * @param batchSubjectId - The `batch_subjects.batch_subject_id`.
   * @param assignmentIds  - Array of `batch_subject_mock_tests.assignment_id` values.
   */
  async removeMockTests(
    batchSubjectId: string,
    assignmentIds: string[],
  ): Promise<ApiResponse<null>> {
    try {
      validateUUID(batchSubjectId, 'batchSubjectId');

      if (assignmentIds.length === 0) {
        return { success: true, data: null };
      }

      for (const id of assignmentIds) {
        validateUUID(id, 'assignmentId');
      }

      const { error } = await supabase
        .from('batch_subject_mock_tests')
        .delete()
        .eq('batch_subject_id', batchSubjectId)
        .in('assignment_id', assignmentIds);

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      // ── Audit: mock tests unassigned (single bulk event) ──────────────
      await auditService.logUnassign({
        resourceType: 'batch_subject_mock_tests',
        resourceId: null,
        metadata: { batchSubjectId, assignmentIds, count: assignmentIds.length },
      });

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
   * @param assignmentId - The `batch_subject_mock_tests.assignment_id`.
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
        .from('batch_subject_mock_tests')
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
   * Get mock test assignment statistics for a Batch Subject.
   *
   * Returns total assigned, active, expired, and upcoming counts.
   *
   * @param batchSubjectId - The `batch_subjects.batch_subject_id`.
   */
  async getAssignmentStats(
    batchSubjectId: string,
  ): Promise<ApiResponse<BatchSubjectMockTestStats>> {
    try {
      validateUUID(batchSubjectId, 'batchSubjectId');

      const { data, error } = await supabase
        .from('batch_subject_mock_tests')
        .select(
          `
          assignment_id,
          available_from,
          available_until
        `,
        )
        .eq('batch_subject_id', batchSubjectId);

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const now = new Date().toISOString();
      let active = 0;
      let expired = 0;
      let upcoming = 0;

      for (const row of data ?? []) {
        const rowAny = row as any;
        const from = rowAny.available_from;
        const until = rowAny.available_until;

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
