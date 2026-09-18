/**
 * Student Course & Subject Learning Web Service
 *
 * Provides dedicated queries and helpers for:
 *   - /student/courses (Enrolled courses listing + real progress + content metrics)
 *   - /student/courses/[courseId] (Course syllabus, subject tracks, assigned tests + real attempt state)
 *   - /student/courses/[courseId]/subjects/[subjectId] (Curriculum workspace & learning content + completion tracking)
 *
 * Backed by Supabase tables and RPCs:
 *   - public.student_viewing_history (Real completion source of truth)
 *   - public.mock_attempts (Real test attempt state)
 *   - public.mock_test_questions (Real question counts)
 *   - public.mock_tests (Real test duration, marks, negative marking)
 *   - get_home_screen_bootstrap (Composite student summary)
 *   - get_courses_content_summary (Batched course/subject content summary)
 *
 * @module services/student/studentCourseWebService
 */

import { supabase } from '@/config/supabase';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidString(str?: string | null): boolean {
  return typeof str === 'string' && UUID_REGEX.test(str.trim());
}

/**
 * Standard progress percentage calculation.
 * Formula: totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0
 */
export function calculateProgressPercent(completedItems: number, totalItems: number): number {
  if (!totalItems || totalItems <= 0) return 0;
  if (!completedItems || completedItems <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((completedItems / totalItems) * 100)));
}

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface SubjectBadgeSummary {
  subjectId: string;
  batchSubjectId: string;
  subjectName: string;
  code?: string;
  emoji: string;
  color: string;
  teacherName?: string | null;
  videoCount: number;
  pdfCount: number;
  notesCount: number;
  assignmentCount: number;
  totalContentCount: number;
  mockTestsCount: number;
}

export interface EnrolledCourseCardItem {
  courseId: string;
  title: string;
  description?: string | null;
  thumbnailUrl: string | null;
  category: string;
  batchId: string;
  batchName: string;
  batchCode?: string;
  academicYear?: string;
  streamName?: string;
  progress: number;
  subjects: SubjectBadgeSummary[];
  totalLectures: number;
  totalPdfs: number;
  totalNotes: number;
  totalAssignments: number;
  totalMockTests: number;
  firstAvailableSubjectId?: string;
  firstAvailableBatchSubjectId?: string;
}

export type StudentTestAttemptState = 'not_started' | 'in_progress' | 'submitted' | 'limit_reached';

export interface MockTestAttemptSummary {
  attemptsUsed: number;
  attemptsRemaining: number | null;
  attemptState: StudentTestAttemptState;
  latestAttemptId: string | null;
  latestStatus: string | null;
  canAttempt: boolean;
  actionLabel: string;
  actionHref: string;
}

export interface AssignedMockTestItem {
  testId: string;
  assignmentId?: string;
  title: string;
  description: string | null;
  testType: string;
  subjectId: string | null;
  subjectName?: string;
  durationMin: number | null;
  totalMarks: number | null;
  passingMarks: number | null;
  negativeMarking: number;
  status: 'available' | 'upcoming' | 'expired';
  questionCount: number;
  attemptLimit: number | null;
  availableFrom: string | null;
  availableUntil: string | null;
  attemptSummary?: MockTestAttemptSummary;
}

export interface SubjectWorkspaceContentItem {
  contentId: string;
  title: string;
  description: string | null;
  contentType: 'video' | 'pdf' | 'notes' | 'assignment';
  storageBucket: string;
  storagePath: string;
  mimeType: string;
  durationSeconds: number | null;
  pageCount: number | null;
  fileSizeBytes: number | null;
  thumbnailBucket?: string | null;
  thumbnailPath?: string | null;
  orderSequence: number;
  sectionName: string | null;
  isOptional: boolean;
  assignedAt: string;
  signedUrl?: string | null;
  isCompleted: boolean;
}

export interface SubjectCurriculumSection {
  sectionName: string;
  items: SubjectWorkspaceContentItem[];
}

export interface CourseDetailWorkspaceData {
  course: {
    courseId: string;
    title: string;
    description: string | null;
    category: string;
    thumbnailUrl: string | null;
    streamName: string;
    batchId: string;
    batchName: string;
    batchCode: string;
    academicYear: string;
    progress: number;
  };
  subjects: SubjectBadgeSummary[];
  assignedMockTests: AssignedMockTestItem[];
  totalContentCount: number;
  completedContentCount: number;
  isEnrolled: boolean;
}

export interface SubjectLearningWorkspaceData {
  subject: {
    subjectId: string;
    batchSubjectId: string;
    subjectName: string;
    subjectCode: string;
    teacherName: string | null;
    teacherAvatar?: string | null;
    batchName: string;
    emoji: string;
    color: string;
  };
  course: {
    courseId: string;
    title: string;
    category: string;
  };
  sections: SubjectCurriculumSection[];
  allItems: SubjectWorkspaceContentItem[];
  mockTests: AssignedMockTestItem[];
  progress: {
    completedItems: number;
    totalItems: number;
    percent: number;
  };
  isAuthorized: boolean;
}

// ─── Student Resolution & Viewing History Helpers ───────────────────────────

/**
 * Resolves the authenticated student's student_details.student_id.
 * Queries student_details by profile_id = auth.uid() or passed userId.
 */
export async function resolveCurrentStudentId(userIdOrStudentId?: string | null): Promise<string | null> {
  if (userIdOrStudentId && isUuidString(userIdOrStudentId)) {
    // Check if it's already a student_id
    const { data: byStudentId } = await supabase
      .from('student_details')
      .select('student_id')
      .eq('student_id', userIdOrStudentId)
      .maybeSingle();

    if (byStudentId?.student_id) {
      return byStudentId.student_id;
    }

    // Check if it's a profile_id
    const { data: byProfileId } = await supabase
      .from('student_details')
      .select('student_id')
      .eq('profile_id', userIdOrStudentId)
      .maybeSingle();

    if (byProfileId?.student_id) {
      return byProfileId.student_id;
    }
  }

  // Fallback to active auth session
  const { data: sessionData } = await supabase.auth.getSession();
  const profileId = sessionData?.session?.user?.id;
  if (!profileId) return null;

  const { data: studentRecord } = await supabase
    .from('student_details')
    .select('student_id')
    .eq('profile_id', profileId)
    .maybeSingle();

  return studentRecord?.student_id ?? null;
}

/**
 * BATCHED Query for Student Viewing History.
 * Queries public.student_viewing_history for a given student and set of resource IDs.
 * Bounded single query — no N+1 per item.
 */
export async function fetchStudentViewingHistory(
  studentId: string | null,
  resourceIds: string[]
): Promise<{ completedSet: Set<string>; positionMap: Map<string, number> }> {
  const completedSet = new Set<string>();
  const positionMap = new Map<string, number>();

  if (!studentId || !resourceIds || resourceIds.length === 0) {
    return { completedSet, positionMap };
  }

  const validIds = resourceIds.filter(isUuidString);
  if (validIds.length === 0) {
    return { completedSet, positionMap };
  }

  try {
    const { data, error } = await supabase
      .from('student_viewing_history')
      .select('resource_id, is_completed, last_position_seconds')
      .eq('student_id', studentId)
      .in('resource_id', validIds);

    if (error) {
      console.warn('[studentCourseWebService] fetchStudentViewingHistory error:', error);
      return { completedSet, positionMap };
    }

    (data || []).forEach((row) => {
      if (row.is_completed) {
        completedSet.add(row.resource_id);
      }
      if (typeof row.last_position_seconds === 'number') {
        positionMap.set(row.resource_id, row.last_position_seconds);
      }
    });
  } catch (err) {
    console.warn('[studentCourseWebService] Unexpected error in fetchStudentViewingHistory:', err);
  }

  return { completedSet, positionMap };
}

/**
 * Marks a content item as completed in student_viewing_history (UPSERT).
 */
export async function markContentItemCompleted(
  contentId: string,
  userId?: string
): Promise<{ success: boolean; error: string | null }> {
  if (!isUuidString(contentId)) {
    return { success: false, error: 'Invalid content ID' };
  }

  try {
    const studentId = await resolveCurrentStudentId(userId);
    if (!studentId) {
      return { success: false, error: 'Student record not found' };
    }

    const { error } = await supabase
      .from('student_viewing_history')
      .upsert(
        {
          student_id: studentId,
          resource_type: 'content',
          resource_id: contentId,
          is_completed: true,
          viewed_at: new Date().toISOString(),
        },
        { onConflict: 'student_id,resource_type,resource_id' }
      );

    if (error) {
      console.error('[studentCourseWebService] markContentItemCompleted upsert error:', error);
      return { success: false, error: error.message };
    }

    return { success: true, error: null };
  } catch (err: any) {
    console.error('[studentCourseWebService] markContentItemCompleted exception:', err);
    return { success: false, error: err?.message || 'Failed to mark item completed' };
  }
}

/**
 * BATCHED Query for Student Mock Test Attempts.
 * Queries public.mock_attempts for the student and calculates attempt states and CTAs.
 */
export async function fetchStudentTestAttempts(
  studentId: string | null,
  testIds: string[],
  attemptLimitMap?: Map<string, number | null>
): Promise<Map<string, MockTestAttemptSummary>> {
  const summaryMap = new Map<string, MockTestAttemptSummary>();
  if (!testIds || testIds.length === 0) return summaryMap;

  const validTestIds = testIds.filter(isUuidString);
  if (validTestIds.length === 0) return summaryMap;

  // Initialize defaults for all tests
  validTestIds.forEach((tId) => {
    const limit = attemptLimitMap?.get(tId) ?? null;
    summaryMap.set(tId, {
      attemptsUsed: 0,
      attemptsRemaining: limit,
      attemptState: 'not_started',
      latestAttemptId: null,
      latestStatus: null,
      canAttempt: true,
      actionLabel: 'Start Test',
      actionHref: '/student/tests',
    });
  });

  if (!studentId) return summaryMap;

  try {
    const { data: attempts, error } = await supabase
      .from('mock_attempts')
      .select('attempt_id, test_id, attempt_number, status, started_at, submitted_at')
      .eq('student_id', studentId)
      .in('test_id', validTestIds)
      .order('attempt_number', { ascending: false });

    if (error) {
      console.warn('[studentCourseWebService] fetchStudentTestAttempts error:', error);
      return summaryMap;
    }

    // Group attempts by test_id
    const attemptsByTest = new Map<string, any[]>();
    (attempts || []).forEach((row: any) => {
      if (!attemptsByTest.has(row.test_id)) {
        attemptsByTest.set(row.test_id, []);
      }
      attemptsByTest.get(row.test_id)!.push(row);
    });

    attemptsByTest.forEach((tAttempts, tId) => {
      const limit = attemptLimitMap?.get(tId) ?? null;
      const attemptsUsed = tAttempts.length;
      const inProgressAttempt = tAttempts.find((a) => a.status === 'in_progress');
      const latestAttempt = tAttempts[0];

      let attemptState: StudentTestAttemptState = 'not_started';
      let canAttempt = true;
      let actionLabel = 'Start Test';
      let actionHref = '/student/tests';
      const remaining = limit !== null ? Math.max(0, limit - attemptsUsed) : null;

      if (inProgressAttempt) {
        attemptState = 'in_progress';
        canAttempt = true;
        actionLabel = 'Resume Test';
        actionHref = `/student/tests?attemptId=${inProgressAttempt.attempt_id}`;
      } else if (limit !== null && attemptsUsed >= limit) {
        attemptState = 'limit_reached';
        canAttempt = false;
        actionLabel = 'Attempts Exhausted';
        actionHref = '/student/tests';
      } else if (attemptsUsed > 0) {
        attemptState = 'submitted';
        canAttempt = limit === null || (remaining !== null && remaining > 0);
        actionLabel = canAttempt ? 'Retake Test' : 'View Result';
        actionHref = '/student/tests';
      }

      summaryMap.set(tId, {
        attemptsUsed,
        attemptsRemaining: remaining,
        attemptState,
        latestAttemptId: latestAttempt?.attempt_id || null,
        latestStatus: latestAttempt?.status || null,
        canAttempt,
        actionLabel,
        actionHref,
      });
    });
  } catch (err) {
    console.warn('[studentCourseWebService] Unexpected error in fetchStudentTestAttempts:', err);
  }

  return summaryMap;
}

/**
 * BATCHED Query for Real Question Counts from mock_test_questions.
 * Used as an accurate fallback when get_courses_content_summary is unavailable.
 */
export async function fetchMockTestQuestionCounts(testIds: string[]): Promise<Map<string, number>> {
  const countMap = new Map<string, number>();
  if (!testIds || testIds.length === 0) return countMap;

  const validTestIds = testIds.filter(isUuidString);
  if (validTestIds.length === 0) return countMap;

  try {
    const { data, error } = await supabase
      .from('mock_test_questions')
      .select('test_id')
      .in('test_id', validTestIds);

    if (error) {
      console.warn('[studentCourseWebService] fetchMockTestQuestionCounts error:', error);
      return countMap;
    }

    (data || []).forEach((row: any) => {
      const current = countMap.get(row.test_id) || 0;
      countMap.set(row.test_id, current + 1);
    });
  } catch (err) {
    console.warn('[studentCourseWebService] Error counting mock test questions:', err);
  }

  return countMap;
}

// ─── Subject Helper Utilities ───────────────────────────────────────────────

export function getSubjectEmoji(name: string): string {
  const c = name.toLowerCase();
  if (c.includes('phy') || c === 'physics') return '📘';
  if (c.includes('chem') || c === 'chemistry') return '🧪';
  if (c.includes('bio') || c.includes('bot') || c.includes('zoo') || c === 'biology') return '🧬';
  if (c.includes('math')) return '📐';
  if (c.includes('eng')) return '📖';
  return '📚';
}

export function getSubjectColor(name: string): string {
  const c = name.toLowerCase();
  if (c.includes('phy') || c === 'physics') return '#0284C7';
  if (c.includes('chem') || c === 'chemistry') return '#8B5CF6';
  if (c.includes('bio') || c.includes('bot') || c.includes('zoo') || c === 'biology') return '#05C46B';
  if (c.includes('math')) return '#F97316';
  if (c.includes('eng')) return '#EC4899';
  return '#4F46E5';
}

export function getMockTestAvailability(
  availableFrom?: string | null,
  availableUntil?: string | null
): 'available' | 'upcoming' | 'expired' {
  const now = Date.now();
  if (availableFrom && new Date(availableFrom).getTime() > now) {
    return 'upcoming';
  }
  if (availableUntil && new Date(availableUntil).getTime() < now) {
    return 'expired';
  }
  return 'available';
}

// ─── Service API Methods ───────────────────────────────────────────────────

/**
 * 1. Fetch all courses in which the student is currently enrolled.
 * Computes REAL progress percentage from student_viewing_history.
 * No arbitrary fallback percentages (e.g. 15).
 */
export async function fetchStudentEnrolledCourses(
  userId?: string
): Promise<{ courses: EnrolledCourseCardItem[]; error: string | null }> {
  try {
    // 1. Fetch bootstrap to get enrolled courses & active batches
    const { data: bootstrap, error: bootError } = await supabase.rpc('get_home_screen_bootstrap');

    if (bootError) {
      console.warn('[studentCourseWebService] get_home_screen_bootstrap error:', bootError);
      return { courses: [], error: bootError.message };
    }

    const rawEnrolled: any[] = bootstrap?.enrolled_courses || [];
    const activeBatches: any[] = bootstrap?.active_batches || [];

    if (rawEnrolled.length === 0) {
      return { courses: [], error: null };
    }

    const courseIds = rawEnrolled.map((c) => c.course_id).filter(isUuidString);
    const batchIds = activeBatches.map((b) => b.batch_id).filter(isUuidString);

    // 2. Batched summary call for content counts & subject breakdowns
    let contentSummaryMap: Record<string, any[]> = {};
    if (courseIds.length > 0) {
      try {
        const { data: summaryData } = await supabase.rpc('get_courses_content_summary', {
          p_course_ids: courseIds,
          p_batch_ids: batchIds.length > 0 ? batchIds : null,
        });
        if (summaryData && typeof summaryData === 'object') {
          contentSummaryMap = summaryData as Record<string, any[]>;
        }
      } catch (sumErr) {
        console.warn('[studentCourseWebService] get_courses_content_summary warn:', sumErr);
      }
    }

    // 3. Resolve student ID for viewing history lookup
    const studentId = await resolveCurrentStudentId(userId || bootstrap?.profile?.student_id);

    // 4. Resolve course batches and subject teachers
    const { data: courseBatchRows } = await supabase
      .from('course_batches')
      .select(`
        course_id,
        batch_id,
        batches:batch_id (
          batch_id,
          name,
          batch_code,
          academic_year,
          streams:stream_id (name)
        )
      `)
      .in('course_id', courseIds);

    const courseBatchMap = new Map<string, any>();
    const allAssignedBatchIds: string[] = [];
    (courseBatchRows || []).forEach((row: any) => {
      const b = Array.isArray(row.batches) ? row.batches[0] : row.batches;
      if (b && !courseBatchMap.has(row.course_id)) {
        courseBatchMap.set(row.course_id, b);
      }
      if (row.batch_id) {
        allAssignedBatchIds.push(row.batch_id);
      }
    });

    // 5. Batched query: get all content IDs associated with enrolled batches & subjects
    const { data: batchSubjectRows } = await supabase
      .from('batch_subjects')
      .select('batch_subject_id, batch_id')
      .in('batch_id', allAssignedBatchIds.length > 0 ? allAssignedBatchIds : batchIds);

    const batchSubjectIds = (batchSubjectRows || []).map((bs: any) => bs.batch_subject_id);
    const batchToCourseMap = new Map<string, string>();
    (courseBatchRows || []).forEach((row: any) => {
      if (row.batch_id && row.course_id) {
        batchToCourseMap.set(row.batch_id, row.course_id);
      }
    });

    let completedSet = new Set<string>();
    const courseContentIdsMap = new Map<string, string[]>();

    if (batchSubjectIds.length > 0) {
      const { data: contentAssignRows } = await supabase
        .from('batch_subject_contents')
        .select('content_id, batch_subject_id, batch_subjects:batch_subject_id (batch_id)')
        .in('batch_subject_id', batchSubjectIds);

      const allContentIds: string[] = [];
      (contentAssignRows || []).forEach((car: any) => {
        if (car.content_id) {
          allContentIds.push(car.content_id);
          const bs = Array.isArray(car.batch_subjects) ? car.batch_subjects[0] : car.batch_subjects;
          const bId = bs?.batch_id;
          const cId = bId ? batchToCourseMap.get(bId) : null;
          if (cId) {
            if (!courseContentIdsMap.has(cId)) {
              courseContentIdsMap.set(cId, []);
            }
            courseContentIdsMap.get(cId)!.push(car.content_id);
          }
        }
      });

      if (studentId && allContentIds.length > 0) {
        const historyRes = await fetchStudentViewingHistory(studentId, allContentIds);
        completedSet = historyRes.completedSet;
      }
    }

    // 6. Map each course item to EnrolledCourseCardItem with REAL progress calculation
    const courses: EnrolledCourseCardItem[] = rawEnrolled.map((c) => {
      const cid = c.course_id;
      const batchInfo = courseBatchMap.get(cid) || {};
      const summaryItems: any[] = contentSummaryMap[cid] || [];

      let totalLectures = 0;
      let totalPdfs = 0;
      let totalNotes = 0;
      let totalAssignments = 0;
      let totalMockTests = 0;

      const subjects: SubjectBadgeSummary[] = summaryItems.map((item) => {
        const counts = item.contentCountsByType || {};
        const vCount = counts.video || 0;
        const pCount = counts.pdf || 0;
        const nCount = counts.notes || 0;
        const aCount = counts.assignment || 0;
        const mTests = Array.isArray(item.mockTests) ? item.mockTests.length : 0;
        const totalC = vCount + pCount + nCount + aCount;

        totalLectures += vCount;
        totalPdfs += pCount;
        totalNotes += nCount;
        totalAssignments += aCount;
        totalMockTests += mTests;

        const sName = item.subjectName || 'Subject';

        return {
          subjectId: item.subjectId,
          batchSubjectId: item.batchSubjectId,
          subjectName: sName,
          code: item.subjectCode || '',
          emoji: getSubjectEmoji(sName),
          color: getSubjectColor(sName),
          teacherName: item.teacherName || null,
          videoCount: vCount,
          pdfCount: pCount,
          notesCount: nCount,
          assignmentCount: aCount,
          totalContentCount: totalC,
          mockTestsCount: mTests,
        };
      });

      const firstSub = subjects[0];
      const courseContentIds = courseContentIdsMap.get(cid) || [];
      const totalCourseItems = courseContentIds.length > 0
        ? courseContentIds.length
        : totalLectures + totalPdfs + totalNotes + totalAssignments;

      let completedCourseItems = 0;
      courseContentIds.forEach((contentId) => {
        if (completedSet.has(contentId)) {
          completedCourseItems++;
        }
      });

      // Real calculated course progress (0 if no items)
      const realProgress = calculateProgressPercent(completedCourseItems, totalCourseItems);

      return {
        courseId: cid,
        title: c.title || 'Course',
        description: c.description || null,
        thumbnailUrl: c.thumbnail_url || null,
        category: c.category || batchInfo?.streams?.name || 'Academic Course',
        batchId: c.batch_id || batchInfo?.batch_id || '',
        batchName: c.batch_name || batchInfo?.name || 'Primary Batch',
        batchCode: batchInfo?.batch_code || '',
        academicYear: batchInfo?.academic_year || '',
        streamName: batchInfo?.streams?.name || bootstrap?.selected_stream?.name || 'Competitive Exams',
        progress: realProgress,
        subjects,
        totalLectures,
        totalPdfs,
        totalNotes,
        totalAssignments,
        totalMockTests,
        firstAvailableSubjectId: firstSub?.subjectId,
        firstAvailableBatchSubjectId: firstSub?.batchSubjectId,
      };
    });

    return { courses, error: null };
  } catch (err: any) {
    console.error('[studentCourseWebService] fetchStudentEnrolledCourses exception:', err);
    return { courses: [], error: err?.message || 'Failed to load courses' };
  }
}

/**
 * 2. Fetch Course Details / Syllabus page data (/student/courses/[courseId]).
 * Returns REAL progress derived from student_viewing_history,
 * and REAL mock test specifications & student attempt states.
 */
export async function fetchCourseDetailWorkspace(
  courseId: string,
  userId?: string
): Promise<{ data: CourseDetailWorkspaceData | null; error: string | null }> {
  if (!isUuidString(courseId)) {
    return { data: null, error: 'Invalid Course ID format' };
  }

  try {
    // 1. Fetch course details
    const { data: courseRow, error: cErr } = await supabase
      .from('courses')
      .select(`
        course_id,
        title,
        description,
        thumbnail_url,
        category,
        stream_id,
        streams:stream_id (name)
      `)
      .eq('course_id', courseId)
      .single();

    if (cErr || !courseRow) {
      return { data: null, error: 'Course not found or inaccessible' };
    }

    // 2. Fetch batches associated with this course
    const { data: cbRows } = await supabase
      .from('course_batches')
      .select(`
        batch_id,
        batches:batch_id (
          batch_id,
          name,
          batch_code,
          academic_year,
          streams:stream_id (name)
        )
      `)
      .eq('course_id', courseId);

    const firstBatch = cbRows?.[0]?.batches
      ? Array.isArray(cbRows[0].batches)
        ? cbRows[0].batches[0]
        : cbRows[0].batches
      : null;
    const batchId = firstBatch?.batch_id || '';
    const batchName = firstBatch?.name || 'Assigned Batch';
    const batchCode = firstBatch?.batch_code || '';
    const academicYear = firstBatch?.academic_year || '';

    let streamName = 'Competitive Stream';
    if (firstBatch?.streams) {
      streamName = Array.isArray(firstBatch.streams)
        ? firstBatch.streams[0]?.name
        : (firstBatch.streams as any)?.name;
    } else if (courseRow.streams) {
      streamName = Array.isArray(courseRow.streams)
        ? (courseRow.streams as any)[0]?.name
        : (courseRow.streams as any)?.name;
    }
    if (!streamName) streamName = 'Competitive Stream';

    // 3. Resolve student ID
    const studentId = await resolveCurrentStudentId(userId);

    // 4. Fetch summary for this course via get_courses_content_summary
    let summaryItems: any[] = [];
    const summaryQuestionCountMap = new Map<string, number>();
    try {
      const { data: summaryData } = await supabase.rpc('get_courses_content_summary', {
        p_course_ids: [courseId],
        p_batch_ids: batchId ? [batchId] : null,
      });
      if (summaryData && summaryData[courseId]) {
        summaryItems = summaryData[courseId];
        // Extract real question counts from summary
        summaryItems.forEach((sItem) => {
          if (Array.isArray(sItem.mockTests)) {
            sItem.mockTests.forEach((mt: any) => {
              if (mt.testId && typeof mt.questionCount === 'number') {
                summaryQuestionCountMap.set(mt.testId, mt.questionCount);
              }
            });
          }
        });
      }
    } catch (sErr) {
      console.warn('[studentCourseWebService] summary rpc failed:', sErr);
    }

    // 5. Resolve subjects
    let subjects: SubjectBadgeSummary[] = [];
    if (summaryItems.length > 0) {
      subjects = summaryItems.map((item) => {
        const counts = item.contentCountsByType || {};
        const vCount = counts.video || 0;
        const pCount = counts.pdf || 0;
        const nCount = counts.notes || 0;
        const aCount = counts.assignment || 0;
        const mTests = Array.isArray(item.mockTests) ? item.mockTests.length : 0;
        const sName = item.subjectName || 'Subject';

        return {
          subjectId: item.subjectId,
          batchSubjectId: item.batchSubjectId,
          subjectName: sName,
          code: item.subjectCode || '',
          emoji: getSubjectEmoji(sName),
          color: getSubjectColor(sName),
          teacherName: item.teacherName || null,
          videoCount: vCount,
          pdfCount: pCount,
          notesCount: nCount,
          assignmentCount: aCount,
          totalContentCount: vCount + pCount + nCount + aCount,
          mockTestsCount: mTests,
        };
      });
    } else if (batchId) {
      const { data: bsRows } = await supabase
        .from('batch_subjects')
        .select(`
          batch_subject_id,
          subject_id,
          subjects:subject_id (name, code)
        `)
        .eq('batch_id', batchId)
        .eq('is_active', true);

      subjects = (bsRows || []).map((bs: any) => {
        const s = Array.isArray(bs.subjects) ? bs.subjects[0] : bs.subjects;
        const sName = s?.name || 'Subject';
        return {
          subjectId: bs.subject_id,
          batchSubjectId: bs.batch_subject_id,
          subjectName: sName,
          code: s?.code || '',
          emoji: getSubjectEmoji(sName),
          color: getSubjectColor(sName),
          teacherName: null,
          videoCount: 0,
          pdfCount: 0,
          notesCount: 0,
          assignmentCount: 0,
          totalContentCount: 0,
          mockTestsCount: 0,
        };
      });
    }

    const batchSubjectIds = subjects.map((s) => s.batchSubjectId).filter(isUuidString);

    // 6. Batched query for all course content IDs to derive REAL course progress
    let completedContentCount = 0;
    let totalContentCount = 0;

    if (batchSubjectIds.length > 0) {
      const { data: contentAssignRows } = await supabase
        .from('batch_subject_contents')
        .select('content_id')
        .in('batch_subject_id', batchSubjectIds);

      const contentIds = (contentAssignRows || [])
        .map((r: any) => r.content_id)
        .filter(isUuidString);

      totalContentCount = contentIds.length;

      if (studentId && contentIds.length > 0) {
        const { completedSet } = await fetchStudentViewingHistory(studentId, contentIds);
        completedContentCount = contentIds.filter((id) => completedSet.has(id)).length;
      }
    }

    const realProgress = calculateProgressPercent(completedContentCount, totalContentCount);

    // 7. Fetch assigned mock tests with REAL test specifications and attempts
    let assignedMockTests: AssignedMockTestItem[] = [];

    if (batchSubjectIds.length > 0) {
      const { data: testRows } = await supabase
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
            status
          )
        `)
        .in('batch_subject_id', batchSubjectIds)
        .order('assigned_at', { ascending: false });

      if (testRows && testRows.length > 0) {
        const subjectMap = new Map<string, string>();
        subjects.forEach((s) => subjectMap.set(s.batchSubjectId, s.subjectName));

        const testIds = testRows.map((tr: any) => tr.test_id).filter(isUuidString);
        const attemptLimitMap = new Map<string, number | null>();
        testRows.forEach((tr: any) => {
          attemptLimitMap.set(tr.test_id, tr.attempt_limit ?? null);
        });

        // Parallel resolution of question counts and attempts
        const [fallbackQuestionCounts, attemptSummaryMap] = await Promise.all([
          // Only fetch from table if missing from RPC summary
          testIds.some((id) => !summaryQuestionCountMap.has(id))
            ? fetchMockTestQuestionCounts(testIds)
            : Promise.resolve(new Map<string, number>()),
          fetchStudentTestAttempts(studentId, testIds, attemptLimitMap),
        ]);

        assignedMockTests = testRows.map((tr: any) => {
          const mt = Array.isArray(tr.mock_tests) ? tr.mock_tests[0] : tr.mock_tests;
          const status = getMockTestAvailability(tr.available_from, tr.available_until);
          const tId = mt?.test_id || tr.test_id;

          const questionCount =
            summaryQuestionCountMap.get(tId) ?? fallbackQuestionCounts.get(tId) ?? 0;

          const attemptSummary = attemptSummaryMap.get(tId);

          return {
            testId: tId,
            assignmentId: tr.assignment_id,
            title: mt?.title || 'Mock Test Assessment',
            description: mt?.description || null,
            testType: mt?.test_type || 'practice',
            subjectId: mt?.subject_id || null,
            subjectName: subjectMap.get(tr.batch_subject_id) || 'General',
            durationMin: mt?.duration_min ?? null,
            totalMarks: mt?.total_marks ?? null,
            passingMarks: mt?.passing_marks ?? null,
            negativeMarking: mt?.negative_marking ?? 0,
            status,
            questionCount,
            attemptLimit: tr.attempt_limit ?? null,
            availableFrom: tr.available_from ?? null,
            availableUntil: tr.available_until ?? null,
            attemptSummary,
          };
        });
      }
    }

    return {
      data: {
        course: {
          courseId,
          title: courseRow.title || 'Course Details',
          description: courseRow.description || null,
          category: courseRow.category || streamName,
          thumbnailUrl: courseRow.thumbnail_url || null,
          streamName,
          batchId,
          batchName,
          batchCode,
          academicYear,
          progress: realProgress,
        },
        subjects,
        assignedMockTests,
        totalContentCount,
        completedContentCount,
        isEnrolled: true,
      },
      error: null,
    };
  } catch (err: any) {
    console.error('[studentCourseWebService] fetchCourseDetailWorkspace error:', err);
    return { data: null, error: err?.message || 'Failed to load course details' };
  }
}

/**
 * 3. Fetch Subject Learning Workspace data (/student/courses/[courseId]/subjects/[subjectId]).
 * Resolves curriculum with REAL completion states (isCompleted), real progress,
 * real question counts, and real student test attempt states.
 */
export async function fetchSubjectLearningWorkspace(
  courseId: string,
  subjectIdOrBatchSubjectId: string,
  userId?: string
): Promise<{ data: SubjectLearningWorkspaceData | null; error: string | null }> {
  if (!isUuidString(courseId) || !isUuidString(subjectIdOrBatchSubjectId)) {
    return { data: null, error: 'Invalid course or subject identifier' };
  }

  try {
    // 1. Resolve batch_subject record
    let batchSubjectId = subjectIdOrBatchSubjectId;
    let actualSubjectId = subjectIdOrBatchSubjectId;
    let subjectName = 'Subject';
    let subjectCode = '';
    let batchName = 'Batch';
    let teacherName: string | null = null;
    let teacherAvatar: string | null = null;

    // Check if passed identifier is a batch_subject_id
    const { data: bsRow } = await supabase
      .from('batch_subjects')
      .select(`
        batch_subject_id,
        subject_id,
        batch_id,
        subjects:subject_id (name, code),
        batches:batch_id (name)
      `)
      .eq('batch_subject_id', subjectIdOrBatchSubjectId)
      .maybeSingle();

    if (bsRow) {
      batchSubjectId = bsRow.batch_subject_id;
      actualSubjectId = bsRow.subject_id;
      const s = Array.isArray(bsRow.subjects) ? bsRow.subjects[0] : bsRow.subjects;
      const b = Array.isArray(bsRow.batches) ? bsRow.batches[0] : bsRow.batches;
      subjectName = s?.name || 'Subject';
      subjectCode = s?.code || '';
      batchName = b?.name || 'Batch';
    } else {
      // Check if passed identifier is subject_id
      const { data: subRow } = await supabase
        .from('batch_subjects')
        .select(`
          batch_subject_id,
          subject_id,
          batch_id,
          subjects:subject_id (name, code),
          batches:batch_id (name)
        `)
        .eq('subject_id', subjectIdOrBatchSubjectId)
        .maybeSingle();

      if (subRow) {
        batchSubjectId = subRow.batch_subject_id;
        actualSubjectId = subRow.subject_id;
        const s = Array.isArray(subRow.subjects) ? subRow.subjects[0] : subRow.subjects;
        const b = Array.isArray(subRow.batches) ? subRow.batches[0] : subRow.batches;
        subjectName = s?.name || 'Subject';
        subjectCode = s?.code || '';
        batchName = b?.name || 'Batch';
      }
    }

    // 2. Fetch subject teacher
    const { data: teacherRow } = await supabase
      .from('batch_subject_teachers')
      .select(`
        teacher_details:teacher_id (
          profiles:profile_id (name, avatar_url)
        )
      `)
      .eq('batch_subject_id', batchSubjectId)
      .maybeSingle();

    if (teacherRow) {
      const td: any = Array.isArray(teacherRow.teacher_details)
        ? teacherRow.teacher_details[0]
        : teacherRow.teacher_details;
      const prof: any = Array.isArray(td?.profiles) ? td?.profiles[0] : td?.profiles;
      teacherName = prof?.name || null;
      teacherAvatar = prof?.avatar_url || null;
    }

    // 3. Fetch Course Info
    const { data: courseRow } = await supabase
      .from('courses')
      .select('course_id, title, category')
      .eq('course_id', courseId)
      .single();

    // 4. Resolve Student ID
    const studentId = await resolveCurrentStudentId(userId);

    // 5. Fetch Approved Study Content items from batch_subject_contents
    const { data: contentRows, error: contErr } = await supabase
      .from('batch_subject_contents')
      .select(`
        order_sequence,
        section_name,
        is_optional,
        assigned_at,
        content:content_id (
          content_id,
          title,
          description,
          content_type,
          storage_bucket,
          storage_path,
          mime_type,
          duration_seconds,
          page_count,
          file_size_bytes,
          thumbnail_bucket,
          thumbnail_path,
          published_at
        )
      `)
      .eq('batch_subject_id', batchSubjectId)
      .order('order_sequence', { ascending: true });

    if (contErr) {
      console.warn('[studentCourseWebService] batch_subject_contents query error:', contErr);
    }

    const contentIds: string[] = (contentRows || [])
      .map((row: any) => {
        const c = Array.isArray(row.content) ? row.content[0] : row.content;
        return c?.content_id;
      })
      .filter(isUuidString);

    // BATCHED viewing history lookup for this subject's content items
    let completedSet = new Set<string>();
    if (studentId && contentIds.length > 0) {
      const historyRes = await fetchStudentViewingHistory(studentId, contentIds);
      completedSet = historyRes.completedSet;
    }

    const allItems: SubjectWorkspaceContentItem[] = (contentRows || [])
      .filter((row: any) => row.content)
      .map((row: any) => {
        const c = Array.isArray(row.content) ? row.content[0] : row.content;
        const cid = c.content_id;
        const isCompleted = completedSet.has(cid);

        return {
          contentId: cid,
          title: c.title || 'Untitled Learning Material',
          description: c.description || null,
          contentType: c.content_type || 'notes',
          storageBucket: c.storage_bucket || 'content-pdfs',
          storagePath: c.storage_path || '',
          mimeType: c.mime_type || (c.content_type === 'video' ? 'video/mp4' : 'application/pdf'),
          durationSeconds: c.duration_seconds || null,
          pageCount: c.page_count || null,
          fileSizeBytes: c.file_size_bytes || null,
          thumbnailBucket: c.thumbnail_bucket || null,
          thumbnailPath: c.thumbnail_path || null,
          orderSequence: row.order_sequence ?? 1,
          sectionName: row.section_name || 'General Modules',
          isOptional: row.is_optional ?? false,
          assignedAt: row.assigned_at || '',
          isCompleted,
        };
      });

    // 6. Group items by sectionName into structured curriculum
    const sectionMap = new Map<string, SubjectWorkspaceContentItem[]>();
    allItems.forEach((item) => {
      const sName = item.sectionName || 'Curriculum Overview';
      if (!sectionMap.has(sName)) {
        sectionMap.set(sName, []);
      }
      sectionMap.get(sName)!.push(item);
    });

    const sections: SubjectCurriculumSection[] = [];
    sectionMap.forEach((items, sName) => {
      sections.push({ sectionName: sName, items });
    });

    // 7. Calculate REAL subject progress
    const completedItemsCount = allItems.filter((i) => i.isCompleted).length;
    const totalItemsCount = allItems.length;
    const progressPercent = calculateProgressPercent(completedItemsCount, totalItemsCount);

    // 8. Fetch Subject Assigned Mock Tests with real specifications & student attempt state
    const { data: testRows } = await supabase
      .from('batch_subject_mock_tests')
      .select(`
        assignment_id,
        test_id,
        assigned_at,
        available_from,
        available_until,
        attempt_limit,
        mock_tests:test_id (
          test_id,
          title,
          description,
          test_type,
          duration_min,
          total_marks,
          passing_marks,
          negative_marking,
          status
        )
      `)
      .eq('batch_subject_id', batchSubjectId)
      .order('assigned_at', { ascending: false });

    let mockTests: AssignedMockTestItem[] = [];
    if (testRows && testRows.length > 0) {
      const testIds = testRows.map((tr: any) => tr.test_id).filter(isUuidString);
      const attemptLimitMap = new Map<string, number | null>();
      testRows.forEach((tr: any) => {
        attemptLimitMap.set(tr.test_id, tr.attempt_limit ?? null);
      });

      const [questionCounts, attemptSummaryMap] = await Promise.all([
        fetchMockTestQuestionCounts(testIds),
        fetchStudentTestAttempts(studentId, testIds, attemptLimitMap),
      ]);

      mockTests = testRows.map((tr: any) => {
        const mt = Array.isArray(tr.mock_tests) ? tr.mock_tests[0] : tr.mock_tests;
        const tId = mt?.test_id || tr.test_id;
        const qCount = questionCounts.get(tId) ?? 0;
        const attemptSummary = attemptSummaryMap.get(tId);

        return {
          testId: tId,
          assignmentId: tr.assignment_id,
          title: mt?.title || 'Subject Assessment Test',
          description: mt?.description || null,
          testType: mt?.test_type || 'practice',
          subjectId: actualSubjectId,
          subjectName,
          durationMin: mt?.duration_min ?? null,
          totalMarks: mt?.total_marks ?? null,
          passingMarks: mt?.passing_marks ?? null,
          negativeMarking: mt?.negative_marking ?? 0,
          status: getMockTestAvailability(tr.available_from, tr.available_until),
          questionCount: qCount,
          attemptLimit: tr.attempt_limit ?? null,
          availableFrom: tr.available_from ?? null,
          availableUntil: tr.available_until ?? null,
          attemptSummary,
        };
      });
    }

    return {
      data: {
        subject: {
          subjectId: actualSubjectId,
          batchSubjectId,
          subjectName,
          subjectCode,
          teacherName,
          teacherAvatar,
          batchName,
          emoji: getSubjectEmoji(subjectName),
          color: getSubjectColor(subjectName),
        },
        course: {
          courseId,
          title: courseRow?.title || 'Course',
          category: courseRow?.category || 'Academic Track',
        },
        sections,
        allItems,
        mockTests,
        progress: {
          completedItems: completedItemsCount,
          totalItems: totalItemsCount,
          percent: progressPercent,
        },
        isAuthorized: true,
      },
      error: null,
    };
  } catch (err: any) {
    console.error('[studentCourseWebService] fetchSubjectLearningWorkspace error:', err);
    return { data: null, error: err?.message || 'Failed to load subject workspace' };
  }
}

/**
 * 4. Resolve a secure authenticated signed URL for viewing content files from Supabase Storage.
 */
export async function getStorageSignedUrl(
  bucket: string,
  storagePath: string,
  expiresIn: number = 3600
): Promise<string | null> {
  if (!bucket || !storagePath) return null;
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(storagePath, expiresIn);

    if (error) {
      console.warn('[studentCourseWebService] createSignedUrl error:', error);
      return null;
    }

    return data?.signedUrl || null;
  } catch (err) {
    console.warn('[studentCourseWebService] Failed to create signed url:', err);
    return null;
  }
}
