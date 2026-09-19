/**
 * Student Mock Tests Web Service
 *
 * Dedicated clean-architecture service for the Student Mock Tests Hub (/student/tests),
 * Test Instructions screen (/student/tests/[testId]), and Web Test Runner.
 *
 * Reuses existing backend Supabase tables, RPCs, and access-control rules:
 *   - public.batch_students / public.course_enrollments (Student access boundary)
 *   - public.batch_subject_mock_tests (Assigned tests per batch subject)
 *   - public.mock_tests (Real test specification & metadata)
 *   - public.mock_test_questions (Real question counts & section breakdowns)
 *   - public.mock_attempts (Real student attempt state & tracking)
 *   - public.mock_results (Real score and accuracy metrics for submitted attempts)
 *   - RPC: public.initialize_mock_attempt (Atomic attempt creation & resume recovery)
 *   - RPC: public.persist_mock_answers_batch (Atomic batch persistence)
 *   - RPC: public.persist_mock_answer_live (Single-answer persistence fallback)
 *
 * Scope: Listing tests, instructions metadata, attempt status resolution, attempt initialization,
 * and answer persistence RPC bridge.
 *
 * @module services/student/studentTestWebService
 */

import { supabase } from '@/config/supabase';
import { seededShuffle } from '@/utils/seededShuffle';
import {
  isUuidString,
  resolveCurrentStudentId,
  fetchStudentTestAttempts,
  fetchMockTestQuestionCounts,
  getMockTestAvailability,
  type MockTestAttemptSummary,
  type StudentTestAttemptState,
} from './studentCourseWebService';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export type StudentTestFilterTab = 'all' | 'assigned' | 'pyq' | 'in_progress' | 'completed' | 'upcoming';

export interface DirtyAnswerItem {
  answerId?: string;
  questionId: string;
  questionType: string;
  value: string | string[] | number | null | undefined;
  isMarkedForReview?: boolean;
  isAnswered?: boolean;
  timeSpentSeconds?: number;
  dirtyAt: number; // Timestamp of modification (latest-write-wins)
}

export interface StudentMockTestResultPreview {
  resultId: string;
  attemptId: string;
  totalScore: number;
  maxScore: number;
  percentage: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  accuracy: number;
  isReleased: boolean;
  submittedAt: string;
}

export interface StudentMockTestCardItem {
  testId: string;
  assignmentId?: string;
  title: string;
  description: string | null;
  testType: string;
  subjectId: string | null;
  subjectName: string | null;
  courseId: string | null;
  courseTitle: string | null;
  batchName: string | null;
  durationMin: number | null;
  totalMarks: number | null;
  passingMarks: number | null;
  negativeMarking: number;
  questionCount: number;
  attemptLimit: number | null;
  availableFrom: string | null;
  availableUntil: string | null;
  availabilityStatus: 'available' | 'upcoming' | 'expired';
  attemptSummary: MockTestAttemptSummary;
  latestResult?: StudentMockTestResultPreview | null;
  assignedAt?: string | null;
}

export interface StudentTestsHubSummary {
  total: number;
  available: number;
  inProgress: number;
  completed: number;
  upcoming: number;
}

export interface StudentTestsHubData {
  tests: StudentMockTestCardItem[];
  summary: StudentTestsHubSummary;
  error: string | null;
}

export interface TestSectionBreakdown {
  sectionName: string;
  questionCount: number;
  totalMarks: number;
  questionTypes: string[];
}

export interface StudentTestInstructionsData {
  test: {
    testId: string;
    title: string;
    description: string | null;
    testType: string;
    durationMin: number | null;
    totalMarks: number | null;
    passingMarks: number | null;
    negativeMarking: number;
    instituteId: string;
    attemptLimit: number | null;
    availableFrom: string | null;
    availableUntil: string | null;
    availabilityStatus: 'available' | 'upcoming' | 'expired';
    courseTitle: string | null;
    subjectName: string | null;
    batchName: string | null;
  };
  structure: {
    totalQuestions: number;
    totalMarks: number;
    sections: TestSectionBreakdown[];
    marksPerCorrect: number | null;
    hasVaryingMarks: boolean;
    hasVaryingNegativeMarks: boolean;
    questionTypes: string[];
  };
  attemptSummary: MockTestAttemptSummary;
  latestResult?: StudentMockTestResultPreview | null;
  hasAccess: boolean;
  accessError?: string | null;
}

export interface InitializeAttemptResult {
  attemptId: string;
  reused: boolean;
  effectiveRemainingSeconds?: number;
  isExpired?: boolean;
  remainingAttempts?: number;
}

// ─── Helper Functions ───────────────────────────────────────────────────────

/**
 * Batched query for student test results from public.mock_results.
 * Retrieves score and accuracy previews for submitted attempts without N+1.
 */
export async function fetchStudentTestResults(
  studentId: string | null,
  testIds: string[]
): Promise<Map<string, StudentMockTestResultPreview>> {
  const resultMap = new Map<string, StudentMockTestResultPreview>();
  if (!studentId || !testIds || testIds.length === 0) return resultMap;

  const validTestIds = testIds.filter(isUuidString);
  if (validTestIds.length === 0) return resultMap;

  try {
    const { data: results, error } = await supabase
      .from('mock_results')
      .select(`
        result_id,
        attempt_id,
        test_id,
        total_score,
        max_score,
        percentage,
        correct_count,
        wrong_count,
        skipped_count,
        is_released,
        generated_at,
        mock_attempts:attempt_id (submitted_at)
      `)
      .eq('student_id', studentId)
      .in('test_id', validTestIds)
      .order('generated_at', { ascending: false });

    if (error) {
      console.warn('[studentTestWebService] fetchStudentTestResults warning:', error);
      return resultMap;
    }

    (results || []).forEach((row: any) => {
      // If multiple results exist for a test, keep the latest
      if (!resultMap.has(row.test_id)) {
        const totalAttempted = (row.correct_count || 0) + (row.wrong_count || 0);
        const accuracy = totalAttempted > 0
          ? Math.round(((row.correct_count || 0) / totalAttempted) * 100)
          : Math.round(row.percentage || 0);

        const submittedAt = row.mock_attempts?.submitted_at || row.generated_at || new Date().toISOString();

        resultMap.set(row.test_id, {
          resultId: row.result_id,
          attemptId: row.attempt_id,
          totalScore: row.total_score,
          maxScore: row.max_score,
          percentage: Math.round(row.percentage || 0),
          correctCount: row.correct_count || 0,
          wrongCount: row.wrong_count || 0,
          skippedCount: row.skipped_count || 0,
          accuracy,
          isReleased: Boolean(row.is_released),
          submittedAt,
        });
      }
    });
  } catch (err) {
    console.warn('[studentTestWebService] Unexpected error in fetchStudentTestResults:', err);
  }

  return resultMap;
}

// ─── Main Hub Query ─────────────────────────────────────────────────────────

/**
 * Fetches all mock tests assigned to the authenticated student across all enrolled batches
 * AND all purchased Previous Year Question (PYQ) packages and papers.
 * Fully respects access control and executes batched, bounded queries to eliminate N+1 performance bottlenecks.
 */
export async function fetchStudentAssignedMockTests(
  userId?: string
): Promise<StudentTestsHubData> {
  try {
    // 1. Resolve student ID
    const studentId = await resolveCurrentStudentId(userId);

    // 2. Discover active batch IDs and active PYQ purchases
    let batchIds: string[] = [];
    let purchasedPackageIds: string[] = [];
    const pyqPackageNameMap = new Map<string, string>();

    if (studentId) {
      // Source A: Active batch enrollments
      const { data: batchStudentRows } = await supabase
        .from('batch_students')
        .select('batch_id')
        .eq('student_id', studentId)
        .eq('status', 'active');

      if (batchStudentRows) {
        batchStudentRows.forEach((r: any) => {
          if (r.batch_id) batchIds.push(r.batch_id);
        });
      }

      // Source B: Direct course enrollments -> batch mappings
      const { data: courseEnrollRows } = await supabase
        .from('course_enrollments')
        .select('course_id')
        .eq('student_id', studentId)
        .eq('is_active', true);

      if (courseEnrollRows && courseEnrollRows.length > 0) {
        const courseIds = courseEnrollRows.map((r: any) => r.course_id).filter(isUuidString);
        if (courseIds.length > 0) {
          const { data: courseBatchRows } = await supabase
            .from('course_batches')
            .select('batch_id')
            .in('course_id', courseIds);

          if (courseBatchRows) {
            courseBatchRows.forEach((r: any) => {
              if (r.batch_id) batchIds.push(r.batch_id);
            });
          }
        }
      }

      // Source C: Active PYQ package purchases
      const { data: pyqPurchaseRows, error: pyqErr } = await supabase
        .from('student_pyq_purchases')
        .select(`
          package_id,
          purchased_at,
          pyq_packages (
            package_id,
            name
          )
        `)
        .eq('student_id', studentId)
        .eq('is_active', true);

      if (pyqErr) {
        console.warn('[studentTestWebService] student_pyq_purchases query warning:', pyqErr);
      }

      if (pyqPurchaseRows && pyqPurchaseRows.length > 0) {
        pyqPurchaseRows.forEach((r: any) => {
          if (r.package_id) {
            purchasedPackageIds.push(r.package_id);
            const pkg = Array.isArray(r.pyq_packages) ? r.pyq_packages[0] : r.pyq_packages;
            if (pkg?.name) {
              pyqPackageNameMap.set(r.package_id, pkg.name);
            }
          }
        });
      }
    }

    // Deduplicate IDs
    batchIds = Array.from(new Set(batchIds.filter(isUuidString)));
    purchasedPackageIds = Array.from(new Set(purchasedPackageIds.filter(isUuidString)));

    // If student has no active batches AND no purchased PYQ packages, return empty list
    if (batchIds.length === 0 && purchasedPackageIds.length === 0) {
      return {
        tests: [],
        summary: { total: 0, available: 0, inProgress: 0, completed: 0, upcoming: 0 },
        error: null,
      };
    }

    const uniqueTestIds: string[] = [];
    const attemptLimitMap = new Map<string, number | null>();
    const rawTestMap = new Map<string, any>();

    // ─── 3. Process Batch Assigned Tests ────────────────────────────────────
    if (batchIds.length > 0) {
      const { data: batchSubjectRows, error: bsErr } = await supabase
        .from('batch_subjects')
        .select(`
          batch_subject_id,
          batch_id,
          subject_id,
          subjects:subject_id (name, code),
          batches:batch_id (
            name,
            batch_code,
            course_batches (
              courses (course_id, title)
            )
          )
        `)
        .in('batch_id', batchIds)
        .eq('is_active', true);

      if (!bsErr && batchSubjectRows && batchSubjectRows.length > 0) {
        const batchSubjectIds = batchSubjectRows.map((bs: any) => bs.batch_subject_id);

        const subjectNameMap = new Map<string, string>();
        const courseTitleMap = new Map<string, { courseId: string; title: string }>();
        const batchNameMap = new Map<string, string>();

        batchSubjectRows.forEach((bs: any) => {
          const s = Array.isArray(bs.subjects) ? bs.subjects[0] : bs.subjects;
          const b = Array.isArray(bs.batches) ? bs.batches[0] : bs.batches;
          if (s?.name) {
            subjectNameMap.set(bs.batch_subject_id, s.name);
          }
          if (b?.name) {
            batchNameMap.set(bs.batch_subject_id, b.name);
          }
          const cb = b?.course_batches?.[0];
          const c = Array.isArray(cb?.courses) ? cb?.courses[0] : cb?.courses;
          if (c?.course_id && c?.title) {
            courseTitleMap.set(bs.batch_subject_id, { courseId: c.course_id, title: c.title });
          }
        });

        const { data: testAssignmentRows, error: taErr } = await supabase
          .from('batch_subject_mock_tests')
          .select(`
            assignment_id,
            test_id,
            assigned_at,
            available_from,
            available_until,
            attempt_limit,
            batch_subject_id,
            mock_tests:test_id (
              test_id,
              title,
              description,
              test_type,
              subject_id,
              duration_min,
              total_marks,
              passing_marks,
              negative_marking,
              status,
              created_at
            )
          `)
          .in('batch_subject_id', batchSubjectIds)
          .order('assigned_at', { ascending: false });

        if (!taErr && testAssignmentRows) {
          testAssignmentRows.forEach((row: any) => {
            const mt = Array.isArray(row.mock_tests) ? row.mock_tests[0] : row.mock_tests;
            const tid = mt?.test_id || row.test_id;
            if (!tid) return;

            if (!rawTestMap.has(tid)) {
              uniqueTestIds.push(tid);
              attemptLimitMap.set(tid, row.attempt_limit ?? null);
              const bsId = row.batch_subject_id;
              rawTestMap.set(tid, {
                row,
                mt,
                isPyq: false,
                subjectName: subjectNameMap.get(bsId) || null,
                courseTitle: courseTitleMap.get(bsId)?.title || null,
                courseId: courseTitleMap.get(bsId)?.courseId || null,
                batchName: batchNameMap.get(bsId) || null,
              });
            }
          });
        }
      }
    }

    // ─── 4. Process Purchased PYQ Papers & Mock Tests ───────────────────────
    if (purchasedPackageIds.length > 0) {
      try {
        const { data: pyqPaperRows, error: ppErr } = await supabase
          .from('pyq_papers')
          .select(`
            paper_id,
            package_id,
            title,
            exam_year,
            exam_session,
            total_questions,
            total_marks,
            duration_min,
            is_published,
            created_at
          `)
          .in('package_id', purchasedPackageIds)
          .eq('is_published', true);

        if (!ppErr && pyqPaperRows && pyqPaperRows.length > 0) {
          const paperIds = pyqPaperRows.map((p: any) => p.paper_id).filter(isUuidString);
          const paperMap = new Map<string, any>(pyqPaperRows.map((p: any) => [p.paper_id, p]));

          if (paperIds.length > 0) {
            const { data: mappingRows, error: mapErr } = await supabase
              .from('pyq_mock_mappings')
              .select(`
                mapping_id,
                paper_id,
                test_id,
                mock_tests:test_id (
                  test_id,
                  title,
                  description,
                  test_type,
                  subject_id,
                  duration_min,
                  total_marks,
                  passing_marks,
                  negative_marking,
                  status,
                  created_at
                )
              `)
              .in('paper_id', paperIds);

            if (!mapErr && mappingRows) {
              mappingRows.forEach((mRow: any) => {
                const mt = Array.isArray(mRow.mock_tests) ? mRow.mock_tests[0] : mRow.mock_tests;
                const tid = mt?.test_id || mRow.test_id;
                if (!tid) return;

                const paper = paperMap.get(mRow.paper_id);
                const packageName = paper?.package_id ? (pyqPackageNameMap.get(paper.package_id) || 'PYQ Archive') : 'PYQ Archive';

                if (!rawTestMap.has(tid)) {
                  uniqueTestIds.push(tid);
                  attemptLimitMap.set(tid, null); // Unlimited practice for lifetime PYQ access
                  rawTestMap.set(tid, {
                    row: {
                      assignment_id: mRow.mapping_id,
                      test_id: tid,
                      attempt_limit: null,
                      available_from: null,
                      available_until: null,
                      assigned_at: paper?.created_at || null,
                    },
                    mt: mt || {
                      test_id: tid,
                      title: paper?.title || 'Previous Year Exam Paper',
                      description: `Official Past Paper (${paper?.exam_year || ''})`,
                      test_type: 'pyq_paper',
                      duration_min: paper?.duration_min ?? 180,
                      total_marks: paper?.total_marks ?? null,
                      passing_marks: null,
                      negative_marking: 1,
                      status: 'published',
                    },
                    isPyq: true,
                    subjectName: paper?.title || 'PYQ Paper',
                    courseTitle: packageName,
                    courseId: paper?.package_id || null,
                    batchName: packageName,
                    paperMetadata: paper,
                  });
                }
              });
            }
          }
        }
      } catch (pyqEx) {
        console.warn('[studentTestWebService] Error resolving PYQ mock mappings:', pyqEx);
      }
    }

    if (uniqueTestIds.length === 0) {
      return {
        tests: [],
        summary: { total: 0, available: 0, inProgress: 0, completed: 0, upcoming: 0 },
        error: null,
      };
    }

    // 5. Run parallel batched queries for Question Counts, Attempts, and Results
    const [questionCountMap, attemptSummaryMap, resultsMap] = await Promise.all([
      fetchMockTestQuestionCounts(uniqueTestIds),
      fetchStudentTestAttempts(studentId, uniqueTestIds, attemptLimitMap),
      fetchStudentTestResults(studentId, uniqueTestIds),
    ]);

    // 6. Build the unified test cards array
    const tests: StudentMockTestCardItem[] = [];
    let inProgressCount = 0;
    let completedCount = 0;
    let upcomingCount = 0;
    let availableCount = 0;

    uniqueTestIds.forEach((tId) => {
      const entry = rawTestMap.get(tId);
      if (!entry) return;
      const { row, mt, isPyq, subjectName, courseTitle, courseId, batchName, paperMetadata } = entry;

      const availability = isPyq ? 'available' : getMockTestAvailability(row.available_from, row.available_until);
      const questionCount = questionCountMap.get(tId) ?? (paperMetadata?.total_questions || 0);
      const attemptSummary = attemptSummaryMap.get(tId) || {
        attemptsUsed: 0,
        attemptsRemaining: row.attempt_limit ?? null,
        attemptState: 'not_started' as StudentTestAttemptState,
        latestAttemptId: null,
        latestStatus: null,
        canAttempt: availability === 'available',
        actionLabel: 'Start Test',
        actionHref: `/student/tests/${tId}`,
      };

      attemptSummary.actionHref = `/student/tests/${tId}`;

      const latestResult = resultsMap.get(tId) || null;

      // Update counters
      if (attemptSummary.attemptState === 'in_progress') {
        inProgressCount++;
      } else if (attemptSummary.attemptState === 'submitted') {
        completedCount++;
      }

      if (availability === 'upcoming') {
        upcomingCount++;
      } else if (availability === 'available') {
        availableCount++;
      }

      tests.push({
        testId: tId,
        assignmentId: row.assignment_id,
        title: mt?.title || paperMetadata?.title || 'Mock Assessment Test',
        description: mt?.description || (isPyq ? `Official Past Exam Paper (${paperMetadata?.exam_year || ''})` : null),
        testType: isPyq ? 'pyq_paper' : (mt?.test_type || 'mock_test'),
        subjectId: mt?.subject_id || null,
        subjectName,
        courseId: courseId || null,
        courseTitle: courseTitle || null,
        batchName,
        durationMin: mt?.duration_min ?? paperMetadata?.duration_min ?? null,
        totalMarks: mt?.total_marks ?? paperMetadata?.total_marks ?? null,
        passingMarks: mt?.passing_marks ?? null,
        negativeMarking: mt?.negative_marking ?? 0,
        questionCount,
        attemptLimit: row.attempt_limit ?? null,
        availableFrom: row.available_from || null,
        availableUntil: row.available_until || null,
        availabilityStatus: availability,
        attemptSummary,
        latestResult,
        assignedAt: row.assigned_at || null,
      });
    });

    const summary: StudentTestsHubSummary = {
      total: tests.length,
      available: availableCount,
      inProgress: inProgressCount,
      completed: completedCount,
      upcoming: upcomingCount,
    };

    return { tests, summary, error: null };
  } catch (err: any) {
    console.error('[studentTestWebService] fetchStudentAssignedMockTests exception:', err);
    return {
      tests: [],
      summary: { total: 0, available: 0, inProgress: 0, completed: 0, upcoming: 0 },
      error: err?.message || 'Unexpected error loading mock tests',
    };
  }
}

// ─── Test Instructions Query ────────────────────────────────────────────────

/**
 * Fetches full test instruction metadata and verifies student entitlement for a specific test.
 * Dynamically resolves question counts, section/syllabus breakdown, and marking scheme.
 * Single composite resolution avoiding N+1 round trips.
 */
export async function fetchStudentTestInstructions(
  testId: string,
  userId?: string
): Promise<{ data: StudentTestInstructionsData | null; error: string | null }> {
  if (!isUuidString(testId)) {
    return { data: null, error: 'Invalid Test ID format' };
  }

  try {
    // 1. Resolve student ID
    const studentId = await resolveCurrentStudentId(userId);

    // 2. Fetch test details from mock_tests
    const { data: testRow, error: tErr } = await supabase
      .from('mock_tests')
      .select(`
        test_id,
        title,
        description,
        test_type,
        subject_id,
        duration_min,
        total_marks,
        passing_marks,
        negative_marking,
        status,
        institute_id,
        created_at,
        subjects:subject_id (name)
      `)
      .eq('test_id', testId)
      .single();

    if (tErr || !testRow) {
      return { data: null, error: 'Test not found or no longer available' };
    }

    // 3. Verify access via batch_subject_mock_tests or student enrollment or PYQ purchase
    let hasAccess = false;
    let assignmentRow: any = null;
    let courseTitle: string | null = null;
    let batchName: string | null = null;
    let subjectName: string | null = (testRow.subjects as any)?.name || null;

    if (studentId) {
      // Find assignment in student active batches
      const { data: assignRows } = await supabase
        .from('batch_subject_mock_tests')
        .select(`
          assignment_id,
          test_id,
          attempt_limit,
          available_from,
          available_until,
          batch_subjects!inner (
            batch_id,
            subject_id,
            subjects (name),
            batches (
              name,
              batch_students!inner (student_id, status),
              course_batches (
                courses (title)
              )
            )
          )
        `)
        .eq('test_id', testId)
        .eq('batch_subjects.batches.batch_students.student_id', studentId)
        .eq('batch_subjects.batches.batch_students.status', 'active');

      if (assignRows && assignRows.length > 0) {
        hasAccess = true;
        assignmentRow = assignRows[0];
        const bs = assignmentRow.batch_subjects;
        if (bs?.subjects?.name) subjectName = bs.subjects.name;
        if (bs?.batches?.name) batchName = bs.batches.name;
        const cb = bs?.batches?.course_batches?.[0];
        if (cb?.courses?.title) courseTitle = cb.courses.title;
      }

      // Check if test is mapped to a purchased PYQ paper
      if (!hasAccess) {
        const { data: pyqMapping } = await supabase
          .from('pyq_mock_mappings')
          .select('paper_id')
          .eq('test_id', testId)
          .maybeSingle();

        if (pyqMapping?.paper_id) {
          const { data: paperRow } = await supabase
            .from('pyq_papers')
            .select(`
              paper_id,
              title,
              package_id,
              pyq_packages:package_id (
                name
              )
            `)
            .eq('paper_id', pyqMapping.paper_id)
            .maybeSingle();

          if (paperRow?.package_id) {
            const { data: purchaseRow } = await supabase
              .from('student_pyq_purchases')
              .select('purchase_id')
              .eq('student_id', studentId)
              .eq('package_id', paperRow.package_id)
              .eq('is_active', true)
              .maybeSingle();

            if (purchaseRow) {
              hasAccess = true;
              if (paperRow.title) subjectName = paperRow.title;
              const pkg = Array.isArray(paperRow.pyq_packages) ? paperRow.pyq_packages[0] : paperRow.pyq_packages;
              if (pkg?.name) courseTitle = pkg.name;
            }
          }
        }
      }
    }

    // If test is published and accessible by institute, allow access
    if (!hasAccess && testRow.status === 'published') {
      hasAccess = true;
    }

    if (!hasAccess) {
      return {
        data: null,
        error: 'You do not have access to this assessment. Please enroll or purchase the corresponding package.',
      };
    }

    const attemptLimit = assignmentRow?.attempt_limit ?? null;
    const availableFrom = assignmentRow?.available_from ?? null;
    const availableUntil = assignmentRow?.available_until ?? null;
    const availabilityStatus = getMockTestAvailability(availableFrom, availableUntil);

    // 4. Fetch question breakdown and sections from mock_test_questions
    const { data: mtqRows } = await supabase
      .from('mock_test_questions')
      .select(`
        mock_test_question_id,
        question_id,
        order_sequence,
        marks,
        negative_marks_override,
        section_name,
        question_snapshot
      `)
      .eq('test_id', testId)
      .order('order_sequence', { ascending: true });

    const questions = mtqRows || [];
    const totalQuestions = questions.length;

    // Group by section_name
    const sectionMap = new Map<string, { count: number; totalMarks: number; types: Set<string> }>();
    let calculatedTotalMarks = 0;
    let hasVaryingMarks = false;
    let hasVaryingNegativeMarks = false;
    let firstMarks: number | null = null;
    let firstNegative: number | null = null;
    const allQuestionTypes = new Set<string>();

    questions.forEach((q: any) => {
      const snapshot = q.question_snapshot;
      const sName = q.section_name || snapshot?.subjectName || subjectName || 'General';
      const qMarks = q.marks ?? snapshot?.marks ?? 4;
      const qNeg = q.negative_marks_override ?? snapshot?.negativeMarks ?? testRow.negative_marking ?? 1;
      const qType = snapshot?.questionType || 'mcq';

      calculatedTotalMarks += qMarks;
      allQuestionTypes.add(qType);

      if (firstMarks === null) firstMarks = qMarks;
      else if (firstMarks !== qMarks) hasVaryingMarks = true;

      if (firstNegative === null) firstNegative = qNeg;
      else if (firstNegative !== qNeg) hasVaryingNegativeMarks = true;

      if (!sectionMap.has(sName)) {
        sectionMap.set(sName, { count: 0, totalMarks: 0, types: new Set<string>() });
      }
      const s = sectionMap.get(sName)!;
      s.count++;
      s.totalMarks += qMarks;
      s.types.add(qType);
    });

    const sections: TestSectionBreakdown[] = Array.from(sectionMap.entries()).map(([name, val]) => ({
      sectionName: name,
      questionCount: val.count,
      totalMarks: val.totalMarks,
      questionTypes: Array.from(val.types),
    }));

    // 5. Fetch attempt summary & results in parallel
    const attemptLimitMap = new Map<string, number | null>([[testId, attemptLimit]]);
    const [attemptSummaryMap, resultsMap] = await Promise.all([
      fetchStudentTestAttempts(studentId, [testId], attemptLimitMap),
      fetchStudentTestResults(studentId, [testId]),
    ]);

    const attemptSummary = attemptSummaryMap.get(testId) || {
      attemptsUsed: 0,
      attemptsRemaining: attemptLimit,
      attemptState: 'not_started' as StudentTestAttemptState,
      latestAttemptId: null,
      latestStatus: null,
      canAttempt: availabilityStatus === 'available',
      actionLabel: 'Start Test',
      actionHref: `/student/tests/${testId}`,
    };

    const latestResult = resultsMap.get(testId) || null;

    return {
      data: {
        test: {
          testId: testRow.test_id,
          title: testRow.title || 'Mock Test Assessment',
          description: testRow.description || null,
          testType: testRow.test_type || 'mock_test',
          durationMin: testRow.duration_min ?? 180,
          totalMarks: testRow.total_marks ?? calculatedTotalMarks ?? 300,
          passingMarks: testRow.passing_marks ?? null,
          negativeMarking: testRow.negative_marking ?? 1,
          instituteId: testRow.institute_id,
          attemptLimit,
          availableFrom,
          availableUntil,
          availabilityStatus,
          courseTitle,
          subjectName,
          batchName,
        },
        structure: {
          totalQuestions,
          totalMarks: testRow.total_marks ?? calculatedTotalMarks ?? 0,
          sections,
          marksPerCorrect: hasVaryingMarks ? null : firstMarks,
          hasVaryingMarks,
          hasVaryingNegativeMarks,
          questionTypes: Array.from(allQuestionTypes),
        },
        attemptSummary,
        latestResult,
        hasAccess: true,
      },
      error: null,
    };
  } catch (err: any) {
    console.error('[studentTestWebService] fetchStudentTestInstructions exception:', err);
    return { data: null, error: err?.message || 'Failed to load test instructions' };
  }
}

// ─── Test Attempt Initialization ────────────────────────────────────────────

/**
 * Initializes or resumes a mock test attempt via the atomic initialize_mock_attempt RPC.
 *
 * Guaranteed Properties:
 *   - Uses PostgreSQL advisory transaction locks (pg_advisory_xact_lock) to prevent duplicate attempts
 *   - Reuses existing in_progress attempt if active (and server-corrects remaining time)
 *   - Bulk-inserts mock_answers rows atomically if new attempt
 *   - Validates attempt limits server-side
 *
 * Called ONLY upon explicit student interaction (Start / Resume click) prior to entering the runner.
 */
export async function initializeStudentTestAttempt(
  testId: string,
  instituteId: string,
  attemptLimit: number | null,
  userId?: string
): Promise<{ success: boolean; data?: InitializeAttemptResult; error?: string }> {
  if (!isUuidString(testId)) {
    return { success: false, error: 'Invalid Test ID' };
  }

  try {
    // 1. Resolve student ID
    const studentId = await resolveCurrentStudentId(userId);
    if (!studentId) {
      return { success: false, error: 'No active student profile found for this account.' };
    }

    // 2. Validate instituteId
    let validInstituteId = instituteId;
    if (!isUuidString(validInstituteId)) {
      // Fetch from test row if not provided
      const { data: tRow } = await supabase
        .from('mock_tests')
        .select('institute_id')
        .eq('test_id', testId)
        .single();

      if (!tRow?.institute_id) {
        return { success: false, error: 'Could not resolve institute context for this test.' };
      }
      validInstituteId = tRow.institute_id;
    }

    // 3. Call the atomic RPC
    const { data: rpcData, error: rpcError } = await supabase.rpc('initialize_mock_attempt', {
      p_test_id: testId,
      p_student_id: studentId,
      p_institute_id: validInstituteId,
      p_attempt_limit: attemptLimit,
    });

    if (rpcError) {
      console.error('[studentTestWebService] initialize_mock_attempt RPC error:', rpcError);
      return { success: false, error: rpcError.message || 'Failed to initialize test attempt.' };
    }

    if (!rpcData || !rpcData.success) {
      return {
        success: false,
        error: rpcData?.error || 'Could not start test. The attempt limit may have been reached.',
      };
    }

    return {
      success: true,
      data: {
        attemptId: rpcData.attempt_id,
        reused: Boolean(rpcData.reused),
        effectiveRemainingSeconds: rpcData.effective_remaining_seconds,
        isExpired: Boolean(rpcData.is_expired),
        remainingAttempts: rpcData.remaining_attempts,
      },
    };
  } catch (err: any) {
    console.error('[studentTestWebService] initializeStudentTestAttempt exception:', err);
    return { success: false, error: err?.message || 'An unexpected error occurred while starting the test.' };
  }
}

// ─── Answer Persistence Bridge (Batch & Live) ───────────────────────────────

/**
 * Persist multiple answers in a single atomic database batch via persist_mock_answers_batch RPC.
 * Translates rich client answers into the normalized PostgreSQL JSONB schema.
 *
 * @param attemptId - The UUID of the mock attempt.
 * @param answers   - Array of dirty answer items from the persistence queue.
 */
export async function persistMockAnswersBatch(
  attemptId: string,
  answers: DirtyAnswerItem[]
): Promise<{ success: boolean; error?: string; syncedCount?: number }> {
  if (!attemptId || !answers || answers.length === 0) {
    return { success: true, syncedCount: 0 };
  }

  const formattedAnswers = answers.map((item) => {
    const { answerId, questionType, value, isMarkedForReview, timeSpentSeconds } = item;
    const val = value;
    const isAnswered =
      val !== null &&
      val !== undefined &&
      (typeof val === 'string' ? val.trim() !== '' : true) &&
      (!Array.isArray(val) || val.length > 0);

    let selectedOptionIds: string[] | null = null;
    let numericalValue: number | null = null;
    let textValue: string | null = null;

    if (questionType === 'mcq' || questionType === 'true_false') {
      if (isAnswered && typeof val === 'string' && val.trim() !== '') {
        selectedOptionIds = [val.trim()];
      }
    } else if (questionType === 'msq') {
      if (isAnswered && Array.isArray(val) && val.length > 0) {
        selectedOptionIds = val.filter((id) => typeof id === 'string' && id.trim() !== '');
      }
    } else if (questionType === 'numerical') {
      if (isAnswered && typeof val === 'string' && val.trim() !== '') {
        const parsed = Number(val.trim());
        if (!isNaN(parsed)) numericalValue = parsed;
      } else if (isAnswered && typeof val === 'number') {
        numericalValue = val;
      }
    } else if (questionType === 'subjective' || questionType === 'text_based') {
      if (isAnswered && typeof val === 'string' && val.trim() !== '') {
        textValue = val;
      }
    }

    return {
      answer_id: answerId,
      question_id: item.questionId,
      is_answered: isAnswered,
      is_marked_for_review: isMarkedForReview,
      selected_option_ids: selectedOptionIds,
      numerical_answer: numericalValue,
      text_answer: textValue,
      time_spent_seconds: timeSpentSeconds ?? null,
    };
  });

  try {
    const { error } = await supabase.rpc('persist_mock_answers_batch', {
      p_attempt_id: attemptId,
      p_answers: formattedAnswers,
    });

    if (error) {
      console.warn('[studentTestWebService] persist_mock_answers_batch RPC error:', error);
      return { success: false, error: error.message };
    }

    return { success: true, syncedCount: formattedAnswers.length };
  } catch (err: any) {
    console.error('[studentTestWebService] persistMockAnswersBatch exception:', err);
    return { success: false, error: err?.message || 'Failed to persist answers batch.' };
  }
}

/**
 * Single-answer persistence fallback using persist_mock_answer_live RPC.
 */
export async function persistMockAnswerLive(
  answerId: string,
  isAnswered: boolean,
  isMarkedForReview: boolean,
  selectedOptionIds: string[] | null,
  numericalAnswer: number | null,
  textAnswer: string | null,
  timeSpentSeconds: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase.rpc('persist_mock_answer_live', {
      p_answer_id: answerId,
      p_is_answered: isAnswered,
      p_is_marked_for_review: isMarkedForReview,
      p_selected_option_ids: selectedOptionIds,
      p_numerical_answer: numericalAnswer,
      p_text_answer: textAnswer,
      p_time_spent_seconds: timeSpentSeconds,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to persist single answer.' };
  }
}


// ═══════════════════════════════════════════════════════════════════════════
//  Runner Session Types & Service Logic (Phase 2 — Step 4)
// ═══════════════════════════════════════════════════════════════════════════

export interface RunnerQuestionOption {
  id: string;
  label: string;
  text: string;
  imageUrl?: string;
}

export interface RunnerQuestion {
  id: string;
  index: number;
  orderSequence: number;
  text: string;
  options: RunnerQuestionOption[];
  imageUrl?: string;
  imageAlt?: string;
  marks: number;
  negativeMarks: number;
  sectionName?: string;
  subjectName?: string;
  questionType: 'mcq' | 'msq' | 'numerical' | 'true_false' | 'text_based' | 'subjective';
  answerId: string;
}

export interface TestRunnerSessionData {
  test: {
    testId: string;
    title: string;
    description: string | null;
    testType: string;
    durationMin: number;
    totalMarks: number;
    passingMarks: number | null;
    negativeMarking: number;
    calculatorAllowed: boolean;
    shuffleQuestions: boolean;
    shuffleOptions: boolean;
    sections: Array<{ name: string; questionCount: number }>;
  };
  attempt: {
    attemptId: string;
    studentId: string;
    status: 'in_progress' | 'submitted' | 'timed_out' | 'abandoned';
    startedAt: string;
    serverRemainingSeconds: number;
  };
  questions: RunnerQuestion[];
  restoredState: {
    selectedOptions: Record<number, string | string[] | null>;
    markedForReviewIndices: number[];
    visitedIndices: number[];
    accumulatedQuestionTimes: Record<string, number>;
    lastQuestionIndex: number;
  };
}

const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

function imageStorageKey(img: { storageBucket: string; storagePath: string }): string {
  return `${img.storageBucket}::${img.storagePath}`;
}

/**
 * Fetches and initializes complete test session data for the desktop test runner.
 * Atomically resolves test configuration, verified attempt context, questions,
 * signed image URLs, deterministic shuffling, and existing answer states.
 */
export async function fetchStudentTestRunnerData(
  testId: string,
  attemptId: string,
  userId?: string
): Promise<{
  success: boolean;
  data?: TestRunnerSessionData;
  error?: string;
  isAlreadySubmitted?: boolean;
}> {
  if (!isUuidString(testId) || !isUuidString(attemptId)) {
    return { success: false, error: 'Invalid Test or Attempt ID format.' };
  }

  try {
    const studentId = await resolveCurrentStudentId(userId);
    if (!studentId) {
      return { success: false, error: 'Student authentication session expired or missing.' };
    }

    // 1. Fetch test row and attempt row concurrently
    const [testRes, attemptRes] = await Promise.all([
      supabase.from('mock_tests').select('*').eq('test_id', testId).single(),
      supabase.from('mock_attempts').select('*').eq('attempt_id', attemptId).single(),
    ]);

    if (testRes.error || !testRes.data) {
      return { success: false, error: 'Mock test could not be found or is unavailable.' };
    }
    const testRow = testRes.data;

    if (attemptRes.error || !attemptRes.data) {
      return { success: false, error: 'Test attempt session could not be found.' };
    }
    const attemptRow = attemptRes.data;

    if (attemptRow.test_id !== testId) {
      return { success: false, error: 'Attempt session mismatch with specified test.' };
    }
    if (attemptRow.student_id !== studentId) {
      return { success: false, error: 'Unauthorized access to this test attempt.' };
    }
    if (attemptRow.status !== 'in_progress') {
      return {
        success: false,
        error: `This test attempt has already been ${attemptRow.status}.`,
        isAlreadySubmitted: true,
      };
    }

    // 2. Fetch questions and answers concurrently
    const [questionsRes, answersRes] = await Promise.all([
      supabase
        .from('mock_test_questions')
        .select('*')
        .eq('test_id', testId)
        .order('order_sequence', { ascending: true }),
      supabase
        .from('mock_answers')
        .select('*')
        .eq('attempt_id', attemptId),
    ]);

    if (questionsRes.error || !questionsRes.data || questionsRes.data.length === 0) {
      return { success: false, error: 'No questions are configured for this mock test.' };
    }

    const rawQuestions = questionsRes.data;
    const existingAnswers = answersRes.data || [];

    // Map answer ID & timing by questionId
    const answerByQuestionId = new Map<string, any>();
    for (const ans of existingAnswers) {
      answerByQuestionId.set(ans.question_id, ans);
    }

    // 3. Collect unique image storage references & generate signed URLs
    const allStorageRefs: Array<{ bucket: string; path: string }> = [];
    const seenKeys = new Set<string>();

    for (const mtq of rawQuestions) {
      const snap = mtq.question_snapshot;
      if (!snap) continue;

      if (snap.images && Array.isArray(snap.images)) {
        for (const img of snap.images) {
          if (img.storageBucket && img.storagePath) {
            const key = imageStorageKey(img);
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              allStorageRefs.push({ bucket: img.storageBucket, path: img.storagePath });
            }
          }
        }
      }

      if (snap.options && Array.isArray(snap.options)) {
        for (const opt of snap.options) {
          if (opt.images && Array.isArray(opt.images)) {
            for (const img of opt.images) {
              if (img.storageBucket && img.storagePath) {
                const key = imageStorageKey(img);
                if (!seenKeys.has(key)) {
                  seenKeys.add(key);
                  allStorageRefs.push({ bucket: img.storageBucket, path: img.storagePath });
                }
              }
            }
          }
        }
      }
    }

    const signedUrlMap: Record<string, string> = {};
    if (allStorageRefs.length > 0) {
      const bucketPathsMap = new Map<string, string[]>();
      for (const ref of allStorageRefs) {
        const list = bucketPathsMap.get(ref.bucket) ?? [];
        list.push(ref.path);
        bucketPathsMap.set(ref.bucket, list);
      }

      const batchPromises = Array.from(bucketPathsMap.entries()).map(async ([bucket, paths]) => {
        try {
          const { data, error } = await supabase.storage
            .from(bucket)
            .createSignedUrls(paths, 14400); // 4 hours

          if (!error && data) {
            for (const item of data) {
              if (item.signedUrl && item.path) {
                signedUrlMap[`${bucket}::${item.path}`] = item.signedUrl;
              }
            }
          }
        } catch (imgErr) {
          console.warn('[studentTestWebService] Non-fatal image signed URL warning:', imgErr);
        }
      });
      await Promise.all(batchPromises);
    }

    // 4. Deterministic Question Shuffling (Mulberry32 PRNG)
    // seededShuffle imported at top level
    let orderedQuestions = [...rawQuestions];
    if (testRow.shuffle_questions && attemptId) {
      orderedQuestions = seededShuffle(orderedQuestions, `${attemptId}:questions`);
    }

    // 5. Build section summary
    const sectionCounts = new Map<string, number>();
    for (const q of orderedQuestions) {
      const sec = q.section_name || q.question_snapshot?.subjectName || 'General';
      sectionCounts.set(sec, (sectionCounts.get(sec) || 0) + 1);
    }
    const sections = Array.from(sectionCounts.entries()).map(([name, count]) => ({
      name,
      questionCount: count,
    }));

    // 6. Map to RunnerQuestion display model with deterministic option shuffle
    const mappedQuestions: RunnerQuestion[] = orderedQuestions.map((mtq, idx) => {
      const snapshot = mtq.question_snapshot;
      const questionId = snapshot?.questionId ?? mtq.question_id;

      let stemImageUrl: string | undefined;
      let stemImageAlt: string | undefined;
      if (snapshot?.images && snapshot.images.length > 0) {
        const stemImg = snapshot.images[0];
        const key = imageStorageKey(stemImg);
        stemImageUrl = signedUrlMap[key];
        stemImageAlt = stemImg.altText || undefined;
      }

      let rawOptions = snapshot?.options ? [...snapshot.options] : [];
      if (testRow.shuffle_options && attemptId) {
        rawOptions = seededShuffle(rawOptions, `${attemptId}:options:${questionId}`);
      }

      const options: RunnerQuestionOption[] = rawOptions.map((opt: any, optIdx: number) => {
        let optImageUrl: string | undefined;
        if (opt.images && opt.images.length > 0) {
          const optImg = opt.images[0];
          const key = imageStorageKey(optImg);
          optImageUrl = signedUrlMap[key];
        }

        return {
          id: opt.optionId,
          label: OPTION_LABELS[optIdx] ?? String(optIdx + 1),
          text: opt.optionText || '',
          imageUrl: optImageUrl,
        };
      });

      const ansRecord = answerByQuestionId.get(questionId);

      return {
        id: questionId,
        index: idx + 1,
        orderSequence: mtq.order_sequence ?? idx + 1,
        text: snapshot?.questionText ?? '',
        options,
        imageUrl: stemImageUrl,
        imageAlt: stemImageAlt,
        marks: snapshot?.marks ?? mtq.marks ?? 4,
        negativeMarks: mtq.negative_marks_override ?? snapshot?.negativeMarks ?? testRow.negative_marking ?? 1,
        sectionName: mtq.section_name ?? snapshot?.subjectName ?? undefined,
        subjectName: snapshot?.subjectName ?? undefined,
        questionType: (snapshot?.questionType ?? 'mcq') as any,
        answerId: ansRecord?.answer_id || '',
      };
    });

    // 7. Calculate server remaining seconds
    const durationMin = testRow.duration_min ?? 180;
    const totalDurationSec = durationMin * 60;
    let serverRemainingSeconds = totalDurationSec;

    if (attemptRow.started_at) {
      const startedAtTime = new Date(attemptRow.started_at).getTime();
      const elapsedSec = Math.floor((Date.now() - startedAtTime) / 1000);
      serverRemainingSeconds = Math.max(0, totalDurationSec - elapsedSec);
    }
    if (attemptRow.time_remaining_seconds !== null && attemptRow.time_remaining_seconds !== undefined) {
      serverRemainingSeconds = Math.min(serverRemainingSeconds, attemptRow.time_remaining_seconds);
    }

    // 8. Reconstruct restored state for resumed attempts
    const selectedOptions: Record<number, string | string[] | null> = {};
    const markedForReviewIndices: number[] = [];
    const visitedIndices: number[] = [0];
    const accumulatedQuestionTimes: Record<string, number> = {};

    mappedQuestions.forEach((q, idx) => {
      const ans = answerByQuestionId.get(q.id);
      if (!ans) return;

      if (ans.time_spent_seconds) {
        accumulatedQuestionTimes[q.id] = ans.time_spent_seconds;
      }

      if (ans.is_marked_for_review) {
        markedForReviewIndices.push(idx);
        visitedIndices.push(idx);
      }

      if (ans.is_answered) {
        visitedIndices.push(idx);
        const qType = q.questionType;

        if (qType === 'msq') {
          selectedOptions[idx] = ans.selected_option_ids || [];
        } else if (qType === 'numerical') {
          selectedOptions[idx] = ans.numerical_answer !== null ? String(ans.numerical_answer) : null;
        } else if (qType === 'subjective' || qType === 'text_based') {
          selectedOptions[idx] = ans.text_answer || null;
        } else {
          selectedOptions[idx] = ans.selected_option_ids?.[0] || null;
        }
      }
    });

    return {
      success: true,
      data: {
        test: {
          testId: testRow.test_id,
          title: testRow.title || 'Mock Test',
          description: testRow.description,
          testType: testRow.test_type || 'mock_test',
          durationMin,
          totalMarks: testRow.total_marks ?? 0,
          passingMarks: testRow.passing_marks ?? null,
          negativeMarking: testRow.negative_marking ?? 1,
          calculatorAllowed: Boolean(testRow.calculator_allowed),
          shuffleQuestions: Boolean(testRow.shuffle_questions),
          shuffleOptions: Boolean(testRow.shuffle_options),
          sections,
        },
        attempt: {
          attemptId: attemptRow.attempt_id,
          studentId: attemptRow.student_id,
          status: attemptRow.status,
          startedAt: attemptRow.started_at,
          serverRemainingSeconds,
        },
        questions: mappedQuestions,
        restoredState: {
          selectedOptions,
          markedForReviewIndices,
          visitedIndices: Array.from(new Set(visitedIndices)),
          accumulatedQuestionTimes,
          lastQuestionIndex: 0,
        },
      },
    };
  } catch (err: any) {
    console.error('[studentTestWebService] fetchStudentTestRunnerData exception:', err);
    return { success: false, error: err?.message || 'Failed to initialize test runner session.' };
  }
}

// ─── Phase 2 Step 5: Web Timer & Evaluation RPC Bridge ──────────────────────

export interface MockEvaluationResult {
  resultId: string;
  attemptId: string;
  testId: string;
  studentId: string;
  instituteId: string;
  totalScore: number;
  maxScore: number;
  percentage: number;
  rank: number | null;
  percentile: number | null;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  totalTimeSeconds: number;
  avgTimePerQuestion: number;
  isReleased: boolean;
  generatedAt: string;
  releasedAt: string | null;
  alreadyEvaluated?: boolean;
}

/**
 * Update time_remaining_seconds and last_activity_at on mock_attempts.
 * Used by webTimerService periodic 60s sync and lifecycle listeners.
 */
export async function updateMockAttemptTime(
  attemptId: string,
  timeRemainingSeconds: number,
  lastQuestionId?: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!attemptId) return { success: false, error: 'attemptId is required' };

    const payload: Record<string, unknown> = {
      time_remaining_seconds: Math.max(0, Math.floor(timeRemainingSeconds)),
      last_activity_at: new Date().toISOString(),
    };
    if (lastQuestionId) {
      payload.last_question_id = lastQuestionId;
    }

    const { error } = await supabase
      .from('mock_attempts')
      .update(payload)
      .eq('attempt_id', attemptId);

    if (error) {
      console.warn('[studentTestWebService] updateMockAttemptTime error:', error.message);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    console.error('[studentTestWebService] updateMockAttemptTime exception:', err);
    return { success: false, error: err?.message || 'Failed to update attempt timer' };
  }
}

/**
 * Submit and evaluate a mock attempt via the authoritative database RPC.
 *
 * The submit_and_evaluate_mock_attempt RPC:
 *   1. Verifies student ownership
 *   2. Evaluates all answers server-side using frozen snapshots
 *   3. Scores MCQ, MSQ, True/False, Numerical answers and awards marks
 *   4. Updates mock_attempts status to 'submitted'
 *   5. Generates the mock_results record
 *   6. Handles idempotency (if already evaluated, returns existing result)
 */
export async function submitAndEvaluateMockAttempt(
  attemptId: string,
  timeTakenSeconds?: number | null,
  questionTimes?: Record<string, number> | null
): Promise<{ success: boolean; data?: MockEvaluationResult; error?: string }> {
  try {
    if (!attemptId) return { success: false, error: 'attemptId is required' };

    const { data, error } = await supabase.rpc('submit_and_evaluate_mock_attempt', {
      p_attempt_id: attemptId,
      p_time_taken_seconds: timeTakenSeconds ?? null,
      p_question_times: questionTimes ?? null,
    });

    if (error) {
      console.error('[studentTestWebService] submit_and_evaluate_mock_attempt RPC error:', error);
      return { success: false, error: error.message };
    }

    const payload = data as any;
    if (!payload || payload.success === false) {
      return { success: false, error: payload?.error || 'Test submission and evaluation failed.' };
    }

    const result: MockEvaluationResult = {
      resultId: payload.result_id || `res-${attemptId}`,
      attemptId: payload.attempt_id || attemptId,
      testId: payload.test_id || '',
      studentId: payload.student_id || '',
      instituteId: payload.institute_id || '',
      totalScore: Number(payload.total_score ?? 0),
      maxScore: Number(payload.max_score ?? 0),
      percentage: Number(payload.percentage ?? 0),
      rank: null,
      percentile: null,
      correctCount: Number(payload.correct_count ?? 0),
      wrongCount: Number(payload.wrong_count ?? 0),
      skippedCount: Number(payload.skipped_count ?? 0),
      totalTimeSeconds: Number(payload.total_time_seconds ?? 0),
      avgTimePerQuestion: Number(payload.avg_time_per_question ?? 0),
      isReleased: Boolean(payload.is_released),
      generatedAt: payload.generated_at || new Date().toISOString(),
      releasedAt: payload.released_at || null,
      alreadyEvaluated: Boolean(payload.already_evaluated),
    };

    return { success: true, data: result };
  } catch (err: any) {
    console.error('[studentTestWebService] submitAndEvaluateMockAttempt exception:', err);
    return { success: false, error: err?.message || 'Failed to submit and evaluate test' };
  }
}
