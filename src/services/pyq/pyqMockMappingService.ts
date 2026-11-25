/**
 * PYQ Mock Mapping Service
 *
 * Generates mock tests from PYQ papers by composing the existing Mock Test
 * architecture (mockTestService + mockTestQuestionService).
 *
 * ## Flow
 *
 * 1. Fetch mapped questions from `pyq_question_mappings`
 * 2. Create a `mock_test` via `mockTestService.createMockTest()`
 * 3. Copy all questions to `mock_test_questions` via `mockTestQuestionService.addQuestionsToMockTest()`
 * 4. Publish via `publishMockTestWorkflow()` (generates question snapshots + transitions to published)
 * 5. Create a `pyq_mock_mappings` row linking paper → test
 *
 * ## Regenerate Flow
 *
 * 1. Delete old `pyq_mock_mappings` row
 * 2. Delete old `mock_test` (cleans up mock_test_questions via CASCADE)
 * 3. Create new mock_test
 * 4. Copy questions
 * 5. Publish
 * 6. Create new mapping
 *
 * ## Design decisions
 *
 * - No schema changes, no migrations
 * - Reuses existing mock test service, question service, and storage
 * - Respects UNIQUE(paper_id) and UNIQUE(test_id) constraints
 * - Institute-scoped validation (question must belong to same institute as paper)
 *
 * @module services/pyq/pyqMockMappingService
 */

import { supabase } from '@/config/supabase';
import { buildPagination, extractErrorMessage, validateUUID } from '@/utils/supabase';
import { buildPaginatedResponse } from '@/utils/response';
import { createMockTest } from '@/services/mockTest/mockTestService';
import { addQuestionsToMockTest } from '@/services/mockTest/mockTestQuestionService';
import { publishMockTestWorkflow } from '@/services/mockTest/mockTestPublishService';
import { auditService } from '@/services/audit/auditService';
import {
  assertPaperOwnership,
  canManagePyq,
  isCurrentUserSuperAdmin,
  resolveCurrentProfileId,
} from './pyqOwnershipGuard';
import type { ApiResponse, PaginatedResponse } from '@/types/academic';
import type { MockTest } from '@/types/mockTest';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A PYQ Mock Mapping — links a PYQ paper to a generated mock test.
 *
 * Mirrors the `pyq_mock_mappings` table in PostgreSQL.
 */
export interface PyqMockMapping {
  mappingId: string;
  paperId: string;
  testId: string;
  instituteId: string;
  createdAt: string;
  createdBy: string | null;
}

/**
 * Result of a successful mock generation.
 */
export interface GenerateMockResult {
  mockMapping: PyqMockMapping;
  mockTest: MockTest;
}

/**
 * An available mock test item eligible to be linked to a package paper.
 */
export interface AvailableMockTestItem {
  testId: string;
  instituteId: string;
  title: string;
  description: string | null;
  durationMin: number;
  totalMarks: number;
  passingMarks: number | null;
  status: string;
  testType: string;
  streamId: string;
  streamName: string | null;
  subjectId: string | null;
  subjectName: string | null;
  questionCount: number;
  publishedAt: string | null;
  createdAt: string;
}

/**
 * Options for querying available mock tests.
 */
export interface GetAvailableMockTestsParams {
  search?: string;
  page?: number;
  pageSize?: number;
  streamId?: string;
  subjectId?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Database Row Shape
// ═══════════════════════════════════════════════════════════════════════════

interface DbPyqMockMapping {
  mapping_id: string;
  paper_id: string;
  test_id: string;
  institute_id: string;
  created_at: string;
  created_by: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Mapping Helpers
// ═══════════════════════════════════════════════════════════════════════════

function toPyqMockMapping(db: DbPyqMockMapping): PyqMockMapping {
  return {
    mappingId: db.mapping_id,
    paperId: db.paper_id,
    testId: db.test_id,
    instituteId: db.institute_id,
    createdAt: db.created_at,
    createdBy: db.created_by,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Paper Question Shape (mapped question with marks info)
// ═══════════════════════════════════════════════════════════════════════════

interface MappedQuestion {
  questionId: string;
  orderSequence: number;
  sectionName: string | null;
  officialMarks: number | null;
  officialNegativeMarks: number | null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Public API
// ═══════════════════════════════════════════════════════════════════════════

export const pyqMockMappingService = {
  // ═════════════════════════════════════════════════════════════════════════
  //  1. Get Mock Mapping for a Paper
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Check if a PYQ paper has a mock mapping and return it.
   *
   * @param paperId - The UUID of the PYQ paper.
   * @returns The mock mapping if it exists, or null if not.
   */
  async getMockMapping(paperId: string): Promise<ApiResponse<PyqMockMapping | null>> {
    try {
      validateUUID(paperId, 'paperId');

      const { data, error } = await supabase
        .from('pyq_mock_mappings')
        .select('*')
        .eq('paper_id', paperId)
        .maybeSingle<DbPyqMockMapping>();

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      return {
        success: true,
        data: data ? toPyqMockMapping(data) : null,
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  2. Generate Mock Test from PYQ Paper
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Generate a mock test from a PYQ paper's mapped questions.
   *
   * OWNERSHIP: paper owner or Super Admin only (server-side). The paper's
   * `created_by` must equal the current profile — Super Admin bypasses.
   * The mock mapping's `created_by` is stamped with the authenticated
   * profile, never client input.
   *
   * Validates:
   * - Paper exists (fetches institute_id, stream_id)
   * - Paper has at least 1 mapped question
   * - No existing mapping (caller should check first or use regenerate)
   *
   * Flow:
   * 1. Fetch paper details
   * 2. Fetch all mapped questions
   * 3. Calculate total marks from question defaults
   * 4. Create a mock_test via mockTestService.createMockTest()
   * 5. Copy all questions via mockTestQuestionService.addQuestionsToMockTest()
   * 6. Create pyq_mock_mappings row
   *
   * @param paperId - The UUID of the PYQ paper.
   * @returns The mock mapping and created mock test.
   */
  async generateMockFromPaper(paperId: string): Promise<ApiResponse<GenerateMockResult>> {
    try {
      validateUUID(paperId, 'paperId');

      // ── Ownership: paper owner or Super Admin (server-side) ─────────
      const ownership = await assertPaperOwnership(paperId);
      if (!ownership.success || !ownership.data) {
        return { success: false, error: ownership.error ?? 'Could not verify paper ownership.' };
      }
      const actorProfileId = ownership.data.profileId;

      // ── Pre-flight check: ensure no mapping already exists ──────────
      const existingMapping = await this.getMockMapping(paperId);
      if (existingMapping.success && existingMapping.data) {
        return {
          success: false,
          error: 'A mock test is already linked to this paper. Use regenerateMockFromPaper() to replace it.',
        };
      }

      // ── Fetch paper details ──────────────────────────────────────────
      const { data: paper, error: paperErr } = await supabase
        .from('pyq_papers')
        .select('paper_id, institute_id, stream_id, title, total_marks, duration_min')
        .eq('paper_id', paperId)
        .single<{
          paper_id: string;
          institute_id: string;
          stream_id: string;
          title: string;
          total_marks: number | null;
          duration_min: number | null;
        }>();

      if (paperErr) {
        if (paperErr.code === 'PGRST116') {
          return { success: false, error: `PYQ paper not found: ${paperId}` };
        }
        return { success: false, error: extractErrorMessage(paperErr) };
      }

      // ── Fetch mapped questions ─────────────────────────────────────────
      const { data: mappings, error: mapErr } = await supabase
        .from('pyq_question_mappings')
        .select('question_id, order_sequence, section_name, official_marks, official_negative_marks')
        .eq('paper_id', paperId)
        .order('order_sequence', { ascending: true });

      if (mapErr) {
        return { success: false, error: extractErrorMessage(mapErr) };
      }

      if (!mappings || mappings.length === 0) {
        return {
          success: false,
          error:
            'Cannot generate mock test: this paper has no mapped questions. ' +
            'Assign questions first.',
        };
      }

      // ── Fetch question marks from the question bank ───────────────────
      const questionIds = mappings.map((m) => m.question_id);
      const { data: questions, error: qErr } = await supabase
        .from('questions')
        .select('question_id, marks, negative_marks')
        .in('question_id', questionIds);

      if (qErr) {
        return { success: false, error: extractErrorMessage(qErr) };
      }

      const questionMap = new Map(
        (questions ?? []).map((q) => [q.question_id, q]),
      );

      // ── Build mock test title ─────────────────────────────────────────
      const mockTestTitle = `${paper.title} — Mock Test`;

      // ── Calculate total marks ─────────────────────────────────────────
      const totalMarks = mappings.reduce((sum, m) => {
        const marks = m.official_marks ?? questionMap.get(m.question_id)?.marks ?? 4;
        return sum + marks;
      }, 0);

      // ── Create mock_test ─────────────────────────────────────────────
      const mockResult = await createMockTest({
        instituteId: paper.institute_id,
        streamId: paper.stream_id,
        title: mockTestTitle,
        description: `Auto-generated mock test from PYQ paper: ${paper.title}`,
        durationMin: paper.duration_min ?? 180,
        totalMarks,
        negativeMarking: 0,
        testType: 'pyq_paper',
        status: 'pending_approval',
        resultReleaseMode: 'immediate',
        shuffleQuestions: false,
        shuffleOptions: false,
      });

      if (!mockResult.success || !mockResult.data) {
        return {
          success: false,
          error: mockResult.error ?? 'Failed to create mock test.',
        };
      }

      const mockTest = mockResult.data;

      // ── Add questions to mock test ────────────────────────────────────
      const assignments = mappings.map((m) => {
        const q = questionMap.get(m.question_id);
        const marks = m.official_marks ?? q?.marks ?? 4;
        const negMarks =
          m.official_negative_marks ?? q?.negative_marks ?? 0;

        return {
          questionId: m.question_id,
          orderSequence: m.order_sequence,
          marks,
          negativeMarksOverride: negMarks === 0 ? null : negMarks,
          sectionName: m.section_name,
        };
      });

      const questionsResult = await addQuestionsToMockTest(
        mockTest.testId,
        assignments,
      );

      if (!questionsResult.success) {
        // Best-effort: mock test was created but questions failed.
        // Don't create the mapping — clean up the test.
        await supabase
          .from('mock_tests')
          .delete()
          .eq('test_id', mockTest.testId);

        return {
          success: false,
          error: questionsResult.error ?? 'Failed to add questions to mock test.',
        };
      }

      // ── Publish the mock test ────────────────────────────────────────
      // This generates question snapshots and transitions the test to
      // published status, making it available to students.
      const publishResult = await publishMockTestWorkflow(mockTest.testId);

      if (!publishResult.success) {
        // Publish failed — clean up mock test and mapping is not created
        await supabase
          .from('mock_tests')
          .delete()
          .eq('test_id', mockTest.testId);

        return {
          success: false,
          error: publishResult.error ?? 'Failed to publish mock test.',
        };
      }

      // Refresh the mock test data to reflect published state
      const { data: publishedTest } = await supabase
        .from('mock_tests')
        .select('*')
        .eq('test_id', mockTest.testId)
        .single();

      // ── Create pyq_mock_mappings row ─────────────────────────────────
      const { data: mappingData, error: mappingErr } = await supabase
        .from('pyq_mock_mappings')
        .insert({
          paper_id: paperId,
          test_id: mockTest.testId,
          institute_id: paper.institute_id,
          created_by: actorProfileId,
        })
        .select()
        .single<DbPyqMockMapping>();

      if (mappingErr) {
        // Mapping failed — clean up mock test
        await supabase
          .from('mock_tests')
          .delete()
          .eq('test_id', mockTest.testId);

        return {
          success: false,
          error: extractErrorMessage(mappingErr),
        };
      }

      // ── Audit: mock mapping generated ────────────────────────────────
      await auditService.logCreate({
        resourceType: 'pyq_mock_mappings',
        resourceId: mappingData.mapping_id,
        metadata: { paperId, testId: mockTest.testId },
      });

      return {
        success: true,
        data: {
          mockMapping: toPyqMockMapping(mappingData),
          mockTest: publishedTest
            ? {
                testId: publishedTest.test_id,
                instituteId: publishedTest.institute_id,
                teacherId: publishedTest.teacher_id,
                streamId: publishedTest.stream_id,
                subjectId: publishedTest.subject_id,
                title: publishedTest.title,
                description: publishedTest.description,
                durationMin: publishedTest.duration_min,
                totalMarks: publishedTest.total_marks,
                passingMarks: publishedTest.passing_marks,
                negativeMarking: publishedTest.negative_marking,
                attemptLimit: publishedTest.attempt_limit,
                shuffleQuestions: publishedTest.shuffle_questions,
                shuffleOptions: publishedTest.shuffle_options,
                calculatorAllowed: publishedTest.calculator_allowed,
                status: publishedTest.status,
                testType: publishedTest.test_type,
                resultReleaseMode: publishedTest.result_release_mode,
                resultReleaseAt: publishedTest.result_release_at,
                availableFrom: publishedTest.available_from,
                availableUntil: publishedTest.available_until,
                createdAt: publishedTest.created_at,
                updatedAt: publishedTest.updated_at,
                publishedAt: publishedTest.published_at,
              }
            : mockTest,
        },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  3. Regenerate Mock Test (Replace Existing)
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Regenerate a mock test for a PYQ paper, replacing any existing one.
   *
   * OWNERSHIP: paper owner or Super Admin only (server-side) — checked
   * before any existing mapping/test is removed.
   *
   * Flow:
   * 1. Fetch existing mapping (abort if none exists)
   * 2. Delete the old mock mapping row
   * 3. Delete the old mock test (cascades to mock_test_questions)
   * 4. Generate fresh via generateMockFromPaper()
   *
   * @param paperId - The UUID of the PYQ paper.
   * @returns The new mock mapping and mock test.
   */
  async regenerateMockFromPaper(paperId: string): Promise<ApiResponse<GenerateMockResult>> {
    try {
      validateUUID(paperId, 'paperId');

      // ── Ownership: paper owner or Super Admin (server-side) ─────────
      const ownership = await assertPaperOwnership(paperId);
      if (!ownership.success) {
        return { success: false, error: ownership.error };
      }

      // ── Fetch existing mapping ──────────────────────────────────────────
      const existing = await this.getMockMapping(paperId);
      if (!existing.success) {
        return { success: false, error: existing.error };
      }

      if (!existing.data) {
        return {
          success: false,
          error:
            'Cannot regenerate: no existing mock mapping found for this paper. ' +
            'Use generateMockFromPaper() instead.',
        };
      }

      const oldMapping = existing.data;

      // ── Delete old mapping ──────────────────────────────────────────────
      const { error: deleteMapErr } = await supabase
        .from('pyq_mock_mappings')
        .delete()
        .eq('paper_id', paperId);

      if (deleteMapErr) {
        return { success: false, error: extractErrorMessage(deleteMapErr) };
      }

      // ── Delete old mock test ───────────────────────────────────────────
      const { error: deleteTestErr } = await supabase
        .from('mock_tests')
        .delete()
        .eq('test_id', oldMapping.testId);

      if (deleteTestErr) {
        // If the test can't be deleted (e.g., has attempts), revert the
        // mapping delete and report the error.
        await supabase.from('pyq_mock_mappings').insert({
          paper_id: paperId,
          test_id: oldMapping.testId,
          institute_id: oldMapping.instituteId,
        });

        return {
          success: false,
          error:
            'Cannot regenerate: the existing mock test has attempt history. ' +
            'Archive the test instead.',
        };
      }

      // ── Generate new mock test ─────────────────────────────────────────
      return this.generateMockFromPaper(paperId);
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  4. Get Mock Mapping with Mock Test Details
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Get the mock mapping for a paper along with the full mock test details.
   *
   * @param paperId - The UUID of the PYQ paper.
   * @returns The mapping + mock test, or null if no mapping exists.
   */
  async getMockMappingWithTest(
    paperId: string,
  ): Promise<ApiResponse<GenerateMockResult | null>> {
    try {
      const mappingResult = await this.getMockMapping(paperId);

      if (!mappingResult.success) {
        return { success: false, error: mappingResult.error };
      }

      if (!mappingResult.data) {
        return { success: true, data: null };
      }

      // Fetch the mock test details
      const { data: mockTest, error: testErr } = await supabase
        .from('mock_tests')
        .select('*')
        .eq('test_id', mappingResult.data.testId)
        .single();

      if (testErr) {
        if (testErr.code === 'PGRST116') {
          return {
            success: false,
            error: `Mock test not found: ${mappingResult.data.testId}. The test may have been deleted.`,
          };
        }
        return { success: false, error: extractErrorMessage(testErr) };
      }

      // Map mock test (simple mapping since we don't need all fields)
      const mappedTest: MockTest = {
        testId: mockTest.test_id,
        instituteId: mockTest.institute_id,
        teacherId: mockTest.teacher_id,
        streamId: mockTest.stream_id,
        subjectId: mockTest.subject_id,
        title: mockTest.title,
        description: mockTest.description,
        durationMin: mockTest.duration_min,
        totalMarks: mockTest.total_marks,
        passingMarks: mockTest.passing_marks,
        negativeMarking: mockTest.negative_marking,
        attemptLimit: mockTest.attempt_limit,
        shuffleQuestions: mockTest.shuffle_questions,
        shuffleOptions: mockTest.shuffle_options,
        calculatorAllowed: mockTest.calculator_allowed,
        status: mockTest.status,
        testType: mockTest.test_type,
        resultReleaseMode: mockTest.result_release_mode,
        resultReleaseAt: mockTest.result_release_at,
        availableFrom: mockTest.available_from,
        availableUntil: mockTest.available_until,
        createdAt: mockTest.created_at,
        updatedAt: mockTest.updated_at,
        publishedAt: mockTest.published_at,
      };

      return {
        success: true,
        data: {
          mockMapping: mappingResult.data,
          mockTest: mappedTest,
        },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  5. Get Available Existing Mock Tests
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Fetch published mock tests from the current institute that:
   * 1. Belong to the current administrator's institute.
   * 2. Have `status = 'published'`.
   * 3. Contain at least one usable question (checked via mock_test_questions).
   * 4. Are not already linked through `public.pyq_mock_mappings`.
   * 5. Support searching by title, subject name, or stream name.
   * 6. Support pagination.
   *
   * @param instituteId - Target institute UUID (validated server-side against admin profile)
   * @param searchOrParams - Optional search term or structured options
   * @param pageParam - 1-based page index (defaults to 1)
   * @param pageSizeParam - Items per page (defaults to 10)
   */
  async getAvailableExistingMockTests(
    instituteId?: string | null,
    searchOrParams?: string | GetAvailableMockTestsParams,
    pageParam: number = 1,
    pageSizeParam: number = 10,
  ): Promise<ApiResponse<PaginatedResponse<AvailableMockTestItem>>> {
    try {
      // ── Server-side Authorization ────────────────────────────────────
      const canManage = await canManagePyq();
      if (!canManage) {
        return {
          success: false,
          error: 'Only a Super Admin or Academic Admin can view available mock tests.',
        };
      }

      const profileId = await resolveCurrentProfileId();
      if (!profileId) {
        return { success: false, error: 'No authenticated user found.' };
      }

      // ── Institute Isolation ──────────────────────────────────────────
      const { data: profile, error: profErr } = await supabase
        .from('profiles')
        .select('institute_id')
        .eq('profile_id', profileId)
        .single();

      if (profErr || !profile?.institute_id) {
        return { success: false, error: 'Could not resolve administrator institute.' };
      }

      const isSuper = await isCurrentUserSuperAdmin();
      if (!isSuper && instituteId && instituteId !== profile.institute_id) {
        return {
          success: false,
          error: 'Access denied: cannot access mock tests for another institute.',
        };
      }

      const effectiveInstituteId = (!isSuper || !instituteId) ? profile.institute_id : instituteId;
      validateUUID(effectiveInstituteId, 'instituteId');

      // ── Parse options ────────────────────────────────────────────────
      let search = '';
      let page = pageParam;
      let pageSize = pageSizeParam;
      let streamId: string | undefined;
      let subjectId: string | undefined;

      if (typeof searchOrParams === 'object' && searchOrParams !== null) {
        search = searchOrParams.search ?? '';
        page = searchOrParams.page ?? 1;
        pageSize = searchOrParams.pageSize ?? 10;
        streamId = searchOrParams.streamId;
        subjectId = searchOrParams.subjectId;
      } else if (typeof searchOrParams === 'string') {
        search = searchOrParams;
      }

      // ── Exclude already-mapped tests in pyq_mock_mappings ─────────────
      const { data: mappedRows, error: mapErr } = await supabase
        .from('pyq_mock_mappings')
        .select('test_id')
        .eq('institute_id', effectiveInstituteId);

      if (mapErr) {
        return { success: false, error: extractErrorMessage(mapErr) };
      }

      const mappedTestIds = (mappedRows ?? []).map((m: any) => m.test_id);

      // ── Build query ──────────────────────────────────────────────────
      let query = supabase
        .from('mock_tests')
        .select(
          `
          test_id,
          institute_id,
          title,
          description,
          duration_min,
          total_marks,
          passing_marks,
          status,
          test_type,
          stream_id,
          subject_id,
          published_at,
          created_at,
          streams!left (
            name
          ),
          subjects!left (
            name
          ),
          mock_test_questions!inner (
            question_id
          )
        `,
          { count: 'exact' },
        )
        .eq('institute_id', effectiveInstituteId)
        .eq('status', 'published')
        .is('deleted_at', null);

      if (mappedTestIds.length > 0) {
        query = query.not('test_id', 'in', `(${mappedTestIds.join(',')})`);
      }

      if (streamId) {
        query = query.eq('stream_id', streamId);
      }
      if (subjectId) {
        query = query.eq('subject_id', subjectId);
      }

      // ── Search filter (title, subject name, stream name) ──────────────
      if (search.trim()) {
        const term = `%${search.trim()}%`;
        const [matchingSubjects, matchingStreams] = await Promise.all([
          supabase.from('subjects').select('subject_id').ilike('name', term),
          supabase.from('streams').select('stream_id').ilike('name', term),
        ]);

        const foundSubjectIds = (matchingSubjects.data ?? []).map((s: any) => s.subject_id);
        const foundStreamIds = (matchingStreams.data ?? []).map((s: any) => s.stream_id);

        const orConditions: string[] = [`title.ilike.${term}`];
        if (foundSubjectIds.length > 0) {
          orConditions.push(`subject_id.in.(${foundSubjectIds.join(',')})`);
        }
        if (foundStreamIds.length > 0) {
          orConditions.push(`stream_id.in.(${foundStreamIds.join(',')})`);
        }
        query = query.or(orConditions.join(','));
      }

      // ── Order & Pagination ───────────────────────────────────────────
      query = query.order('created_at', { ascending: false });
      const { from, to } = buildPagination({ page, pageSize });
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const items: AvailableMockTestItem[] = (data ?? []).map((row: any) => {
        let questionCount = 0;
        if (Array.isArray(row.mock_test_questions)) {
          if (row.mock_test_questions.length > 0 && typeof row.mock_test_questions[0]?.count === 'number') {
            questionCount = row.mock_test_questions[0].count;
          } else {
            questionCount = row.mock_test_questions.length;
          }
        }

        return {
          testId: row.test_id,
          instituteId: row.institute_id,
          title: row.title ?? 'Untitled Test',
          description: row.description ?? null,
          durationMin: row.duration_min ?? 0,
          totalMarks: row.total_marks ?? 0,
          passingMarks: row.passing_marks ?? null,
          status: row.status ?? 'published',
          testType: row.test_type ?? 'mock_test',
          streamId: row.stream_id,
          streamName: row.streams?.name ?? null,
          subjectId: row.subject_id ?? null,
          subjectName: row.subjects?.name ?? null,
          questionCount,
          publishedAt: row.published_at ?? null,
          createdAt: row.created_at,
        };
      });

      return {
        success: true,
        data: buildPaginatedResponse(items, count ?? 0, page, pageSize),
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  6. Assign Existing Mock Test
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Connects an existing published mock test from the Mock Test Builder to a
   * package paper via public.pyq_mock_mappings.
   *
   * Validates:
   * 1. Valid UUIDs for paperId and testId
   * 2. Administrator has permission (Super Admin or Academic Admin)
   * 3. Target paper exists
   * 4. Paper does not already have a linked mock test (enforces UNIQUE paper_id)
   * 5. Target mock test exists and belongs to the same institute
   * 6. Mock test has status = 'published'
   * 7. Mock test has at least 1 question in mock_test_questions
   * 8. Mock test is not already linked to another paper (enforces UNIQUE test_id)
   * 9. Inserts mapping into public.pyq_mock_mappings
   * 10. Handles race conditions / unique constraint collisions gracefully
   * 11. Logs audit event
   *
   * @param paperId - UUID of the target PYQ paper
   * @param testId - UUID of the existing published mock test
   * @returns GenerateMockResult containing mockMapping and mockTest
   */
  async assignExistingMockTest(
    paperId: string,
    testId: string,
  ): Promise<ApiResponse<GenerateMockResult>> {
    try {
      validateUUID(paperId, 'paperId');
      validateUUID(testId, 'testId');

      // ── 1. Authorization: Super Admin or Academic Admin ──────────────
      const ownership = await assertPaperOwnership(paperId);
      if (!ownership.success || !ownership.data) {
        return {
          success: false,
          error: ownership.error ?? 'You do not have permission to modify this paper.',
        };
      }
      const actorProfileId = ownership.data.profileId;

      // ── 2. Fetch and validate target paper ───────────────────────────
      const { data: paper, error: paperErr } = await supabase
        .from('pyq_papers')
        .select('paper_id, package_id, institute_id, stream_id, title')
        .eq('paper_id', paperId)
        .single<{
          paper_id: string;
          package_id: string;
          institute_id: string;
          stream_id: string;
          title: string;
        }>();

      if (paperErr || !paper) {
        if (paperErr?.code === 'PGRST116') {
          return { success: false, error: `PYQ paper not found: ${paperId}` };
        }
        return { success: false, error: extractErrorMessage(paperErr) };
      }

      // ── 3. Preflight check: paper must not already have a mapping ────
      const existingMapping = await this.getMockMapping(paperId);
      if (existingMapping.success && existingMapping.data) {
        return {
          success: false,
          error: 'This paper is already linked to a mock test.',
        };
      }

      // ── 4. Preflight check: test must not already be mapped ──────────
      const { data: existingTestMap, error: testMapErr } = await supabase
        .from('pyq_mock_mappings')
        .select('mapping_id, paper_id')
        .eq('test_id', testId)
        .maybeSingle();

      if (testMapErr) {
        return { success: false, error: extractErrorMessage(testMapErr) };
      }

      if (existingTestMap) {
        return {
          success: false,
          error: 'This mock test has already been assigned to another paper. Please select a different test.',
        };
      }

      // ── 5. Fetch and validate selected mock test ──────────────────────
      const { data: mockTest, error: testErr } = await supabase
        .from('mock_tests')
        .select('*')
        .eq('test_id', testId)
        .is('deleted_at', null)
        .single();

      if (testErr || !mockTest) {
        if (testErr?.code === 'PGRST116') {
          return { success: false, error: `Mock test not found: ${testId}` };
        }
        return { success: false, error: extractErrorMessage(testErr) };
      }

      // ── 6. Institute isolation: test must match paper's institute ────
      if (mockTest.institute_id !== paper.institute_id) {
        return {
          success: false,
          error: 'The selected mock test belongs to a different institute.',
        };
      }

      // ── 7. Status check: test must be published ──────────────────────
      if (mockTest.status !== 'published') {
        return {
          success: false,
          error: 'Only published mock tests can be linked to a paper.',
        };
      }

      // ── 8. Question validation: test must contain >= 1 question ──────
      const { count: qCount, error: qCountErr } = await supabase
        .from('mock_test_questions')
        .select('question_id', { count: 'exact', head: true })
        .eq('test_id', testId);

      if (qCountErr) {
        return { success: false, error: extractErrorMessage(qCountErr) };
      }

      if (!qCount || qCount === 0) {
        return {
          success: false,
          error: 'The selected mock test contains no questions and cannot be linked.',
        };
      }

      // ── 9. Insert mapping into public.pyq_mock_mappings ──────────────
      const { data: mappingData, error: mappingErr } = await supabase
        .from('pyq_mock_mappings')
        .insert({
          paper_id: paperId,
          test_id: testId,
          institute_id: paper.institute_id,
          created_by: actorProfileId,
        })
        .select()
        .single<DbPyqMockMapping>();

      if (mappingErr) {
        // Concurrency protection: handle unique constraint collisions
        if (mappingErr.code === '23505') {
          const detail = (mappingErr.details ?? mappingErr.message ?? '').toLowerCase();
          if (detail.includes('paper') || detail.includes('uq_pyq_mock_mappings_paper')) {
            return {
              success: false,
              error: 'This paper is already linked to a mock test.',
            };
          }
          return {
            success: false,
            error: 'This mock test has already been assigned to another paper. Please select a different test.',
          };
        }
        return { success: false, error: extractErrorMessage(mappingErr) };
      }

      // ── 10. Audit log ────────────────────────────────────────────────
      await auditService.logCreate({
        resourceType: 'pyq_mock_mappings',
        resourceId: mappingData.mapping_id,
        metadata: {
          paperId,
          testId,
          linkedExisting: true,
          paperTitle: paper.title,
          testTitle: mockTest.title,
        },
      });

      // ── 11. Return mapping + mock test details ────────────────────────
      const mappedTest: MockTest = {
        testId: mockTest.test_id,
        instituteId: mockTest.institute_id,
        teacherId: mockTest.teacher_id,
        streamId: mockTest.stream_id,
        subjectId: mockTest.subject_id,
        title: mockTest.title,
        description: mockTest.description,
        durationMin: mockTest.duration_min,
        totalMarks: mockTest.total_marks,
        passingMarks: mockTest.passing_marks,
        negativeMarking: mockTest.negative_marking,
        attemptLimit: mockTest.attempt_limit,
        shuffleQuestions: mockTest.shuffle_questions,
        shuffleOptions: mockTest.shuffle_options,
        calculatorAllowed: mockTest.calculator_allowed,
        status: mockTest.status,
        testType: mockTest.test_type,
        resultReleaseMode: mockTest.result_release_mode,
        resultReleaseAt: mockTest.result_release_at,
        availableFrom: mockTest.available_from,
        availableUntil: mockTest.available_until,
        createdAt: mockTest.created_at,
        updatedAt: mockTest.updated_at,
        publishedAt: mockTest.published_at,
      };

      return {
        success: true,
        data: {
          mockMapping: toPyqMockMapping(mappingData),
          mockTest: mappedTest,
        },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },
};
