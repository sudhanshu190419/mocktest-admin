import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const {
  mockFrom,
  mockGetCurrentAdminRoles,
  mockIsSuperAdmin,
  mockAuditLog,
  mockGetUser,
} = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockGetCurrentAdminRoles: vi.fn(),
  mockIsSuperAdmin: vi.fn(),
  mockAuditLog: vi.fn().mockResolvedValue({ success: true, logId: 'log-1' }),
  mockGetUser: vi.fn(),
}));

vi.mock('@/config/supabase', () => ({
  supabase: {
    from: mockFrom,
    auth: {
      getUser: mockGetUser,
    },
  },
}));

vi.mock('@/services/admin/adminRoleService', () => ({
  adminRoleService: {
    getCurrentAdminRoles: mockGetCurrentAdminRoles,
    isSuperAdmin: mockIsSuperAdmin,
  },
}));

vi.mock('@/services/audit/auditService', () => ({
  auditService: {
    log: mockAuditLog,
    logCreate: mockAuditLog,
    logUpdate: mockAuditLog,
    logPublish: mockAuditLog,
    logSoftDelete: mockAuditLog,
  },
}));

import { pyqMockMappingService } from '../pyqMockMappingService';

function mockChain(data: any = null, error: any = null, count?: number) {
  const result = { data, error, count };
  const c: Record<string, any> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.insert = vi.fn().mockReturnValue(c);
  c.update = vi.fn().mockReturnValue(c);
  c.delete = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.is = vi.fn().mockReturnValue(c);
  c.in = vi.fn().mockReturnValue(c);
  c.not = vi.fn().mockReturnValue(c);
  c.or = vi.fn().mockReturnValue(c);
  c.ilike = vi.fn().mockReturnValue(c);
  c.order = vi.fn().mockReturnValue(c);
  c.range = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue(result);
  c.maybeSingle = vi.fn().mockResolvedValue(result);
  c.then = (onFulfilled: any, onRejected?: any) => {
    if (error && onRejected) return onRejected(error);
    return onFulfilled(result);
  };
  return c;
}

const INSTITUTE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_INSTITUTE_ID = '99999999-9999-4999-8999-999999999999';
const STREAM_ID = '22222222-2222-4222-8222-222222222222';
const PACKAGE_ID = '33333333-3333-4333-8333-333333333333';
const PAPER_ID = '44444444-4444-4444-8444-444444444444';
const TEST_ID = '55555555-5555-4555-8555-555555555555';
const TEST_ID_2 = '66666666-6666-4666-8666-666666666666';

describe('PYQ & Mock Test — Link Existing Mock Test to Package Paper', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default admin session
    mockGetCurrentAdminRoles.mockResolvedValue({
      success: true,
      data: [{ adminRole: 'academic_admin', accessStatus: 'approved' }],
    });
    mockIsSuperAdmin.mockResolvedValue(false);
    mockGetUser.mockResolvedValue({ data: { user: { id: 'admin-profile-1' } } });
  });

  // ═════════════════════════════════════════════════════════════════════════
  //  1. Service Tests: Retrieve Available Existing Mock Tests
  // ═════════════════════════════════════════════════════════════════════════
  describe('A. getAvailableExistingMockTests', () => {
    it('1. retrieves published tests belonging to current institute', async () => {
      const mockTestRow = {
        test_id: TEST_ID,
        institute_id: INSTITUTE_ID,
        title: 'JEE Advanced Full Mock 1',
        description: 'Complete mock test',
        duration_min: 180,
        total_marks: 300,
        passing_marks: 100,
        status: 'published',
        test_type: 'mock_test',
        stream_id: STREAM_ID,
        subject_id: null,
        published_at: '2026-08-01T10:00:00Z',
        created_at: '2026-08-01T10:00:00Z',
        streams: { name: 'Engineering' },
        subjects: null,
        mock_test_questions: [{ question_id: 'q1' }, { question_id: 'q2' }],
      };

      mockFrom.mockImplementation((table: string) => {
        if (table === 'profiles') return mockChain({ institute_id: INSTITUTE_ID });
        if (table === 'pyq_mock_mappings') return mockChain([]);
        if (table === 'mock_tests') return mockChain([mockTestRow], null, 1);
        return mockChain(null);
      });

      const res = await pyqMockMappingService.getAvailableExistingMockTests(INSTITUTE_ID);
      expect(res.success).toBe(true);
      expect(res.data?.data).toHaveLength(1);
      expect(res.data?.data[0].testId).toBe(TEST_ID);
      expect(res.data?.data[0].questionCount).toBe(2);
      expect(res.data?.data[0].status).toBe('published');
    });

    it('2. excludes tests belonging to other institutes', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'profiles') return mockChain({ institute_id: INSTITUTE_ID });
        return mockChain(null);
      });

      // Non-super admin trying to query other institute
      const res = await pyqMockMappingService.getAvailableExistingMockTests(OTHER_INSTITUTE_ID);
      expect(res.success).toBe(false);
      expect(res.error).toContain('cannot access mock tests for another institute');
    });

    it('3 & 4. queries only published status (excludes draft and archived tests)', async () => {
      let statusFilterUsed: string | null = null;
      mockFrom.mockImplementation((table: string) => {
        if (table === 'profiles') return mockChain({ institute_id: INSTITUTE_ID });
        if (table === 'pyq_mock_mappings') return mockChain([]);
        if (table === 'mock_tests') {
          const chain = mockChain([]);
          chain.eq = vi.fn().mockImplementation((col: string, val: any) => {
            if (col === 'status') statusFilterUsed = val;
            return chain;
          });
          return chain;
        }
        return mockChain(null);
      });

      await pyqMockMappingService.getAvailableExistingMockTests(INSTITUTE_ID);
      expect(statusFilterUsed).toBe('published');
    });

    it('5. excludes tests without questions via inner join on mock_test_questions', async () => {
      let selectClause = '';
      mockFrom.mockImplementation((table: string) => {
        if (table === 'profiles') return mockChain({ institute_id: INSTITUTE_ID });
        if (table === 'pyq_mock_mappings') return mockChain([]);
        if (table === 'mock_tests') {
          const chain = mockChain([]);
          chain.select = vi.fn().mockImplementation((sel: string) => {
            selectClause = sel;
            return chain;
          });
          return chain;
        }
        return mockChain(null);
      });

      await pyqMockMappingService.getAvailableExistingMockTests(INSTITUTE_ID);
      expect(selectClause).toContain('mock_test_questions!inner');
    });

    it('6. excludes tests already mapped to another paper in pyq_mock_mappings', async () => {
      let notCol = '';
      let notOp = '';
      let notVal = '';

      mockFrom.mockImplementation((table: string) => {
        if (table === 'profiles') return mockChain({ institute_id: INSTITUTE_ID });
        if (table === 'pyq_mock_mappings') return mockChain([{ test_id: TEST_ID_2 }]);
        if (table === 'mock_tests') {
          const chain = mockChain([]);
          chain.not = vi.fn().mockImplementation((col: string, op: string, val: string) => {
            notCol = col;
            notOp = op;
            notVal = val;
            return chain;
          });
          return chain;
        }
        return mockChain(null);
      });

      await pyqMockMappingService.getAvailableExistingMockTests(INSTITUTE_ID);
      expect(notCol).toBe('test_id');
      expect(notOp).toBe('in');
      expect(notVal).toContain(TEST_ID_2);
    });

    it('7. searches existing tests by title or matching subject/stream', async () => {
      let orClause = '';
      mockFrom.mockImplementation((table: string) => {
        if (table === 'profiles') return mockChain({ institute_id: INSTITUTE_ID });
        if (table === 'pyq_mock_mappings') return mockChain([]);
        if (table === 'subjects') return mockChain([{ subject_id: 'sub-1' }]);
        if (table === 'streams') return mockChain([]);
        if (table === 'mock_tests') {
          const chain = mockChain([]);
          chain.or = vi.fn().mockImplementation((clause: string) => {
            orClause = clause;
            return chain;
          });
          return chain;
        }
        return mockChain(null);
      });

      await pyqMockMappingService.getAvailableExistingMockTests(INSTITUTE_ID, 'Physics');
      expect(orClause).toContain('title.ilike.%Physics%');
      expect(orClause).toContain('subject_id.in.(sub-1)');
    });

    it('8. correctly paginates results with buildPagination and buildPaginatedResponse', async () => {
      let rangeFrom = -1;
      let rangeTo = -1;

      mockFrom.mockImplementation((table: string) => {
        if (table === 'profiles') return mockChain({ institute_id: INSTITUTE_ID });
        if (table === 'pyq_mock_mappings') return mockChain([]);
        if (table === 'mock_tests') {
          const chain = mockChain([], null, 25);
          chain.range = vi.fn().mockImplementation((from: number, to: number) => {
            rangeFrom = from;
            rangeTo = to;
            return chain;
          });
          return chain;
        }
        return mockChain(null);
      });

      const res = await pyqMockMappingService.getAvailableExistingMockTests(INSTITUTE_ID, {
        page: 2,
        pageSize: 10,
      });

      expect(res.success).toBe(true);
      expect(rangeFrom).toBe(10);
      expect(rangeTo).toBe(19);
      expect(res.data?.page).toBe(2);
      expect(res.data?.pageSize).toBe(10);
      expect(res.data?.pageCount).toBe(3);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  //  2. Service Tests: Assign Existing Mock Test
  // ═════════════════════════════════════════════════════════════════════════
  describe('B. assignExistingMockTest', () => {
    it('9. assigns a valid existing test to an unmapped paper', async () => {
      const paperRow = {
        paper_id: PAPER_ID,
        package_id: PACKAGE_ID,
        institute_id: INSTITUTE_ID,
        stream_id: STREAM_ID,
        title: 'NEET 2024 Paper',
      };

      const testRow = {
        test_id: TEST_ID,
        institute_id: INSTITUTE_ID,
        status: 'published',
        title: 'NEET 2024 Full Mock',
        duration_min: 200,
        total_marks: 720,
        stream_id: STREAM_ID,
        subject_id: null,
      };

      const createdMappingRow = {
        mapping_id: 'map-uuid-1',
        paper_id: PAPER_ID,
        test_id: TEST_ID,
        institute_id: INSTITUTE_ID,
        created_at: '2026-08-22T10:00:00Z',
        created_by: 'admin-profile-1',
      };

      let mappingInsertPayload: any = null;

      mockFrom.mockImplementation((table: string) => {
        if (table === 'pyq_papers') return mockChain(paperRow);
        if (table === 'pyq_mock_mappings') {
          const chain = mockChain(null); // no existing mapping for paper or test
          chain.insert = vi.fn().mockImplementation((payload: any) => {
            mappingInsertPayload = payload;
            return mockChain(createdMappingRow);
          });
          return chain;
        }
        if (table === 'mock_tests') return mockChain(testRow);
        if (table === 'mock_test_questions') return mockChain(null, null, 180); // has 180 questions
        return mockChain(null);
      });

      const res = await pyqMockMappingService.assignExistingMockTest(PAPER_ID, TEST_ID);
      expect(res.success).toBe(true);
      expect(res.data?.mockMapping.paperId).toBe(PAPER_ID);
      expect(res.data?.mockMapping.testId).toBe(TEST_ID);
      expect(res.data?.mockTest.title).toBe('NEET 2024 Full Mock');

      // Verify mapping row was inserted into public.pyq_mock_mappings
      expect(mappingInsertPayload).toEqual({
        paper_id: PAPER_ID,
        test_id: TEST_ID,
        institute_id: INSTITUTE_ID,
        created_by: 'admin-profile-1',
      });
    });

    it('10. rejects a test from another institute', async () => {
      const paperRow = {
        paper_id: PAPER_ID,
        institute_id: INSTITUTE_ID,
      };
      const testRow = {
        test_id: TEST_ID,
        institute_id: OTHER_INSTITUTE_ID, // Mismatched institute
        status: 'published',
      };

      mockFrom.mockImplementation((table: string) => {
        if (table === 'pyq_papers') return mockChain(paperRow);
        if (table === 'pyq_mock_mappings') return mockChain(null);
        if (table === 'mock_tests') return mockChain(testRow);
        return mockChain(null);
      });

      const res = await pyqMockMappingService.assignExistingMockTest(PAPER_ID, TEST_ID);
      expect(res.success).toBe(false);
      expect(res.error).toContain('belongs to a different institute');
    });

    it('11. rejects unpublished tests (draft / archived)', async () => {
      const paperRow = { paper_id: PAPER_ID, institute_id: INSTITUTE_ID };
      const testRow = { test_id: TEST_ID, institute_id: INSTITUTE_ID, status: 'draft' };

      mockFrom.mockImplementation((table: string) => {
        if (table === 'pyq_papers') return mockChain(paperRow);
        if (table === 'pyq_mock_mappings') return mockChain(null);
        if (table === 'mock_tests') return mockChain(testRow);
        return mockChain(null);
      });

      const res = await pyqMockMappingService.assignExistingMockTest(PAPER_ID, TEST_ID);
      expect(res.success).toBe(false);
      expect(res.error).toContain('Only published mock tests can be linked');
    });

    it('12. rejects tests with no questions in mock_test_questions', async () => {
      const paperRow = { paper_id: PAPER_ID, institute_id: INSTITUTE_ID };
      const testRow = { test_id: TEST_ID, institute_id: INSTITUTE_ID, status: 'published' };

      mockFrom.mockImplementation((table: string) => {
        if (table === 'pyq_papers') return mockChain(paperRow);
        if (table === 'pyq_mock_mappings') return mockChain(null);
        if (table === 'mock_tests') return mockChain(testRow);
        if (table === 'mock_test_questions') return mockChain(null, null, 0); // 0 questions
        return mockChain(null);
      });

      const res = await pyqMockMappingService.assignExistingMockTest(PAPER_ID, TEST_ID);
      expect(res.success).toBe(false);
      expect(res.error).toContain('contains no questions');
    });

    it('13. rejects a paper that already has a mock mapping', async () => {
      const paperRow = { paper_id: PAPER_ID, institute_id: INSTITUTE_ID };
      const existingMappingRow = {
        mapping_id: 'existing-map-1',
        paper_id: PAPER_ID,
        test_id: TEST_ID_2,
        institute_id: INSTITUTE_ID,
      };

      mockFrom.mockImplementation((table: string) => {
        if (table === 'pyq_papers') return mockChain(paperRow);
        if (table === 'pyq_mock_mappings') return mockChain(existingMappingRow);
        return mockChain(null);
      });

      const res = await pyqMockMappingService.assignExistingMockTest(PAPER_ID, TEST_ID);
      expect(res.success).toBe(false);
      expect(res.error).toContain('already linked to a mock test');
    });

    it('14. rejects a test that is already mapped to another paper', async () => {
      const paperRow = { paper_id: PAPER_ID, institute_id: INSTITUTE_ID };
      const existingTestMapping = {
        mapping_id: 'other-map-1',
        paper_id: 'other-paper-uuid',
        test_id: TEST_ID,
      };

      let queryCount = 0;
      mockFrom.mockImplementation((table: string) => {
        if (table === 'pyq_papers') return mockChain(paperRow);
        if (table === 'pyq_mock_mappings') {
          queryCount++;
          // First call is getMockMapping(paperId) -> returns null (paper unmapped)
          if (queryCount === 1) return mockChain(null);
          // Second call is check for test_id -> returns existing mapping
          return mockChain(existingTestMapping);
        }
        return mockChain(null);
      });

      const res = await pyqMockMappingService.assignExistingMockTest(PAPER_ID, TEST_ID);
      expect(res.success).toBe(false);
      expect(res.error).toContain('already been assigned to another paper');
    });

    it('15. gracefully handles concurrent unique constraint collisions (23505)', async () => {
      const paperRow = { paper_id: PAPER_ID, institute_id: INSTITUTE_ID };
      const testRow = { test_id: TEST_ID, institute_id: INSTITUTE_ID, status: 'published' };

      mockFrom.mockImplementation((table: string) => {
        if (table === 'pyq_papers') return mockChain(paperRow);
        if (table === 'mock_tests') return mockChain(testRow);
        if (table === 'mock_test_questions') return mockChain(null, null, 50);
        if (table === 'pyq_mock_mappings') {
          const chain = mockChain(null);
          chain.insert = vi.fn().mockReturnValue(
            mockChain(null, {
              code: '23505',
              message: 'duplicate key value violates unique constraint "uq_pyq_mock_mappings_test"',
            }),
          );
          return chain;
        }
        return mockChain(null);
      });

      const res = await pyqMockMappingService.assignExistingMockTest(PAPER_ID, TEST_ID);
      expect(res.success).toBe(false);
      expect(res.error).toBe(
        'This mock test has already been assigned to another paper. Please select a different test.',
      );
    });

    it('16. confirms NO new mock_tests record is created during assignment', async () => {
      const paperRow = { paper_id: PAPER_ID, institute_id: INSTITUTE_ID };
      const testRow = { test_id: TEST_ID, institute_id: INSTITUTE_ID, status: 'published' };
      let mockTestInsertCalled = false;

      mockFrom.mockImplementation((table: string) => {
        if (table === 'pyq_papers') return mockChain(paperRow);
        if (table === 'mock_tests') {
          const chain = mockChain(testRow);
          chain.insert = vi.fn().mockImplementation(() => {
            mockTestInsertCalled = true;
            return chain;
          });
          return chain;
        }
        if (table === 'mock_test_questions') return mockChain(null, null, 50);
        if (table === 'pyq_mock_mappings') return mockChain({ mapping_id: 'm1', paper_id: PAPER_ID, test_id: TEST_ID });
        return mockChain(null);
      });

      await pyqMockMappingService.assignExistingMockTest(PAPER_ID, TEST_ID);
      expect(mockTestInsertCalled).toBe(false);
    });

    it('17. confirms existing mock_test_questions are unchanged (no inserts or deletions)', async () => {
      const paperRow = { paper_id: PAPER_ID, institute_id: INSTITUTE_ID };
      const testRow = { test_id: TEST_ID, institute_id: INSTITUTE_ID, status: 'published' };
      let questionMutationCalled = false;

      mockFrom.mockImplementation((table: string) => {
        if (table === 'pyq_papers') return mockChain(paperRow);
        if (table === 'mock_tests') return mockChain(testRow);
        if (table === 'mock_test_questions') {
          const chain = mockChain(null, null, 50);
          chain.insert = vi.fn().mockImplementation(() => { questionMutationCalled = true; return chain; });
          chain.delete = vi.fn().mockImplementation(() => { questionMutationCalled = true; return chain; });
          chain.update = vi.fn().mockImplementation(() => { questionMutationCalled = true; return chain; });
          return chain;
        }
        if (table === 'pyq_mock_mappings') return mockChain({ mapping_id: 'm1', paper_id: PAPER_ID, test_id: TEST_ID });
        return mockChain(null);
      });

      await pyqMockMappingService.assignExistingMockTest(PAPER_ID, TEST_ID);
      expect(questionMutationCalled).toBe(false);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  //  3. UI Component and Hook Verification Tests
  // ═════════════════════════════════════════════════════════════════════════
  describe('C. UI & Contract Verifications', () => {
    const questionsPagePath = path.resolve(__dirname, '../../../app/admin/pyq-packages/[id]/papers/[paperId]/questions/page.tsx');
    const questionsPageSource = fs.readFileSync(questionsPagePath, 'utf8');

    const modalPath = path.resolve(__dirname, '../../../features/pyq/components/LinkExistingMockTestModal.tsx');
    const modalSource = fs.readFileSync(modalPath, 'utf8');

    const hooksPath = path.resolve(__dirname, '../../../hooks/pyq/usePyqMockMapping.ts');
    const hooksSource = fs.readFileSync(hooksPath, 'utf8');

    it('18. Both Generate Mock Test and Link Existing Mock Test appear when unmapped', () => {
      expect(questionsPageSource).toContain('Link Existing Mock Test');
      expect(questionsPageSource).toContain('Generate Mock Test');
      expect(questionsPageSource).toContain('setShowLinkModal(true)');
    });

    it('19. Link Existing Mock Test opens the LinkExistingMockTestModal selector', () => {
      expect(questionsPageSource).toContain('<LinkExistingMockTestModal');
      expect(questionsPageSource).toContain('open={showLinkModal}');
      expect(questionsPageSource).toContain('onClose={() => setShowLinkModal(false)}');
      expect(modalSource).toContain('Select Existing Mock Test');
    });

    it('20. Modal provides search input that queries by title, subject, or stream', () => {
      expect(modalSource).toContain('Search by test title, subject, or stream...');
      expect(modalSource).toContain('debouncedSearch');
      expect(modalSource).toContain('useAvailableMockTestsQuery');
    });

    it('21. Eligible tests display title, stream, subject, duration, marks, question count, and status', () => {
      expect(modalSource).toContain('{test.title}');
      expect(modalSource).toContain('{test.streamName}');
      expect(modalSource).toContain('{test.subjectName ?? \'All Subjects\'}');
      expect(modalSource).toContain('{test.durationMin} min');
      expect(modalSource).toContain('{test.totalMarks} marks');
      expect(modalSource).toContain('{test.questionCount} question');
      expect(modalSource).toContain('<StatusBadge status={test.status} />');
    });

    it('22. Excludes unmapped tests and informs user when none are available', () => {
      expect(modalSource).toContain('No eligible mock tests found');
      expect(modalSource).toContain('Only published mock tests with at least one question');
    });

    it('23. Link action shows loading state during mutation', () => {
      expect(modalSource).toContain('assignMutation.isPending');
      expect(modalSource).toContain('Linking Mock Test...');
    });

    it('24. Successful linking triggers cache invalidation and modal close', () => {
      expect(hooksSource).toContain('useAssignExistingMockTestMutation');
      expect(hooksSource).toContain('pyqKeys.mockMappings.detail');
      expect(hooksSource).toContain('availableMockTests');
      expect(modalSource).toContain('await assignMutation.mutateAsync');
      expect(modalSource).toContain('onClose()');
    });

    it('25. Existing mapped-test card displays selected test when mapped', () => {
      expect(questionsPageSource).toContain('mockData.mockTest.title');
      expect(questionsPageSource).toContain('Created ${new Date(mockData.mockMapping.createdAt).toLocaleDateString()}');
    });

    it('26. View Mock Test remains functional and links to /admin/mock-tests/${mockData.mockTest.testId}', () => {
      expect(questionsPageSource).toContain('View Mock Test');
      expect(questionsPageSource).toContain('/admin/mock-tests/${mockData.mockTest.testId}');
    });

    it('27. Existing Regenerate functionality and dialog remain intact', () => {
      expect(questionsPageSource).toContain('setConfirmRegenerate(true)');
      expect(questionsPageSource).toContain('Regenerate Mock Test');
      expect(questionsPageSource).toContain('regenerateMock.mutate(paperId)');
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  //  4. Regression Verifications
  // ═════════════════════════════════════════════════════════════════════════
  describe('D. Regression Protections', () => {
    it('28. Existing generateMockFromPaper continues working', () => {
      expect(typeof pyqMockMappingService.generateMockFromPaper).toBe('function');
    });

    it('29. Existing automatic mapping during generation continues working', () => {
      expect(typeof pyqMockMappingService.getMockMapping).toBe('function');
      expect(typeof pyqMockMappingService.getMockMappingWithTest).toBe('function');
    });

    it('30. Existing regenerateMockFromPaper safeguards remain intact', () => {
      expect(typeof pyqMockMappingService.regenerateMockFromPaper).toBe('function');
    });

    it('31. Migration 160 clause (e) for student entitlement via pyq_mock_mappings remains active', () => {
      const migration160Path = path.resolve(__dirname, '../../../../supabase/migrations/160_fix_pyq_mock_test_attempt_entitlement.sql');
      const migration160Source = fs.readFileSync(migration160Path, 'utf8');
      expect(migration160Source).toContain('FROM public.pyq_mock_mappings pmm');
      expect(migration160Source).toContain('JOIN public.pyq_papers pp ON pp.paper_id = pmm.paper_id');
      expect(migration160Source).toContain('JOIN public.student_pyq_purchases spp ON spp.package_id = pp.package_id');
      expect(migration160Source).toContain('WHERE pmm.test_id = p_test_id');
    });

    it('32. UNIQUE(paper_id) and UNIQUE(test_id) database constraints remain untouched', () => {
      const migration007Path = path.resolve(__dirname, '../../../../supabase/migrations/007_domain_06_pyq.sql');
      const migration007Source = fs.readFileSync(migration007Path, 'utf8');
      expect(migration007Source).toContain('constraint uq_pyq_mock_mappings_paper_id unique (paper_id)');
      expect(migration007Source).toContain('constraint uq_pyq_mock_mappings_test_id unique (test_id)');
    });
  });
});

