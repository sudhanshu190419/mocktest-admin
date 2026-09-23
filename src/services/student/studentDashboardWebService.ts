/**
 * Student Web Dashboard Service
 *
 * Clean-architecture service layer for the Student Web Dashboard.
 * Reuses existing backend Supabase RPCs and tables matching MockTestApp:
 *   - get_home_screen_bootstrap (Composite student summary)
 *   - get_courses_content_summary (Batched course/subject content progress)
 *   - get_student_subject_analytics (Subject mastery metrics)
 *   - get_student_weak_chapters (Weak areas < 60% accuracy)
 *   - get_student_score_trend (Historical test performance)
 *   - batch_subject_live_classes (Live now & upcoming sessions)
 *   - timetable_sessions (Weekly class timetable)
 *   - fetchStudentAssignedMockTests (Authoritative student-assigned mock tests)
 *
 * @module services/student/studentDashboardWebService
 */

import { supabase } from '@/config/supabase';
import {
  fetchBatchSubjectRowsForBatches,
  fetchStudentAssignedMockTests,
  type BatchSubjectRow,
  type StudentMockTestCardItem,
} from './studentTestWebService';
import {
  fetchTodayTimetable,
  type TimetableSessionItem,
} from './studentTimetableWebService';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export type StudentAssignedMockTest = StudentMockTestCardItem;

export interface StudentProfileData {
  profile_id: string;
  name: string;
  role: string;
  institute_id: string;
  phone: string | null;
  avatar_url: string | null;
  student_id: string | null;
}

export interface StudentActiveBatch {
  batch_id: string;
  name: string;
  batch_code: string;
  stream_name?: string;
}

export interface StudentEnrolledCourse {
  course_id: string;
  title: string;
  thumbnail_url: string | null;
  category?: string;
  batch_name?: string;
  batch_id?: string;
  stream_id?: string;
  progress?: number;
  enrollment_type?: string;
}

export interface StudentLiveClassItem {
  id: string;
  class_id: string;
  room_name: string;
  title: string;
  status: 'live' | 'scheduled' | 'completed' | 'cancelled';
  scheduled_at: string;
  duration_minutes: number;
  subject_name: string;
  teacher_name: string;
  teacher_avatar?: string | null;
  batch_name?: string;
  current_topic?: string;
}

export interface SubjectAnalyticsItem {
  subject_id: string;
  subject_name: string;
  questions_attempted: number;
  correct_count: number;
  wrong_count: number;
  skipped_count: number;
  accuracy: number;
  score?: number;
  total_score?: number;
  avg_time_per_question?: number | null;
}

export interface WeakChapterItem {
  chapter_id: string;
  chapter_name: string;
  subject_name: string;
  accuracy: number;
  questions_attempted: number;
  correct_count: number;
  wrong_count: number;
  skipped_count: number;
}

export interface RecentTestResultItem {
  result_id: string;
  attempt_id?: string;
  test_id: string;
  test_title: string;
  score: number;
  total_score: number;
  percentage: number;
  accuracy: number;
  submitted_at: string;
  rank?: number | string | null;
  percentile?: number | null;
}

// TimetableSessionItem is the unified projector type from studentTimetableWebService.

export interface StudentDashboardSummary {
  profile: StudentProfileData | null;
  unreadNotificationsCount: number;
  activeBatches: StudentActiveBatch[];
  enrolledCourses: StudentEnrolledCourse[];
  liveClass: StudentLiveClassItem | null;
  upcomingLiveClasses: StudentLiveClassItem[];
  analytics: {
    testsAttempted: number;
    averageScore: number;
    accuracy: number;
    rank?: string | number | null;
    percentile?: number | null;
  };
  subjectAnalytics: SubjectAnalyticsItem[];
  weakChapters: WeakChapterItem[];
  recentResults: RecentTestResultItem[];
  assignedMockTests: StudentAssignedMockTest[];
  todayTimetable: TimetableSessionItem[];
  courseContentSummary: Record<string, any>;
  hasPurchased: boolean;
  selectedStreamName?: string;
}

// ─── Service Methods ────────────────────────────────────────────────────────

/**
 * Fetches the composite bootstrap dataset for the authenticated student.
 */
export async function fetchStudentBootstrap(streamId?: string | null): Promise<{
  data: any | null;
  error: string | null;
}> {
  try {
    const { data, error } = await supabase.rpc('get_home_screen_bootstrap', {
      p_stream_id: streamId || null,
    });

    if (error) {
      console.warn('[studentWebDashboardService] get_home_screen_bootstrap RPC error:', error);
      return { data: null, error: error.message };
    }

    return { data, error: null };
  } catch (err: any) {
    console.error('[studentWebDashboardService] Unexpected error during bootstrap:', err);
    return { data: null, error: err?.message || 'Failed to load student dashboard' };
  }
}

/**
 * Fetches batched content summary progress for all enrolled courses.
 */
export async function fetchCoursesContentSummary(
  courseIds: string[],
  batchIds?: string[]
): Promise<Record<string, any>> {
  if (!courseIds || courseIds.length === 0) return {};
  try {
    const { data, error } = await supabase.rpc('get_courses_content_summary', {
      p_course_ids: courseIds,
      p_batch_ids: batchIds && batchIds.length > 0 ? batchIds : null,
    });

    if (error) {
      console.warn('[studentWebDashboardService] get_courses_content_summary RPC warning:', error);
      return {};
    }

    return (data as Record<string, any>) || {};
  } catch (err) {
    console.warn('[studentWebDashboardService] Failed to fetch course content summary:', err);
    return {};
  }
}

/**
 * Fetches live now and upcoming scheduled classes for the student's active batches.
 */
export async function fetchStudentLiveAndUpcomingClasses(
  batchIds: string[],
  sharedBatchSubjects?: PromiseLike<BatchSubjectRow[]> | null,
): Promise<StudentLiveClassItem[]> {
  if (!batchIds || batchIds.length === 0) return [];

  try {
    // 1. Resolve batch_subject IDs — reuse the dashboard's shared request when
    //    supplied so both branches share ONE batch_subjects query. The shared
    //    row set is unfiltered, so live-class discovery sees exactly the same
    //    rows it did before (it never applied an is_active filter).
    const batchSubjects: BatchSubjectRow[] = sharedBatchSubjects
      ? await sharedBatchSubjects
      : (await fetchBatchSubjectRowsForBatches(batchIds)).rows;

    if (!batchSubjects || batchSubjects.length === 0) {
      return [];
    }

    const batchSubjectIds = batchSubjects.map((bs) => bs.batch_subject_id);
    const subjectMap = new Map<string, string>();
    batchSubjects.forEach((bs) => {
      const s: any = Array.isArray(bs.subjects) ? bs.subjects[0] : bs.subjects;
      subjectMap.set(bs.batch_subject_id, s?.name || 'General Subject');
    });

    // 2. Fetch live and upcoming classes in one query
    const { data: classes, error: classError } = await supabase
      .from('batch_subject_live_classes')
      .select(`
        class_id,
        room_name,
        title,
        status,
        scheduled_at,
        duration_minutes,
        batch_subject_id,
        profiles:teacher_id (
          name,
          avatar_url
        )
      `)
      .in('batch_subject_id', batchSubjectIds)
      .in('status', ['live', 'scheduled'])
      .order('scheduled_at', { ascending: true })
      .limit(6);

    if (classError || !classes) {
      return [];
    }

    return classes.map((c: any) => {
      const teacher = Array.isArray(c.profiles) ? c.profiles[0] : c.profiles;
      return {
        id: c.class_id,
        class_id: c.class_id,
        room_name: c.room_name || c.class_id,
        title: c.title || 'Live Class Session',
        status: (c.status as any) || 'scheduled',
        scheduled_at: c.scheduled_at,
        duration_minutes: c.duration_minutes || 60,
        subject_name: subjectMap.get(c.batch_subject_id) || 'Subject Lecture',
        teacher_name: teacher?.name || 'Faculty Member',
        teacher_avatar: teacher?.avatar_url || null,
      };
    });
  } catch (err) {
    console.warn('[studentWebDashboardService] Error fetching live classes:', err);
    return [];
  }
}

/**
 * Fetches student subject performance analytics.
 */
export async function fetchStudentSubjectAnalytics(): Promise<SubjectAnalyticsItem[]> {
  try {
    const { data, error } = await supabase.rpc('get_student_subject_analytics');
    if (error) {
      console.warn('[studentWebDashboardService] get_student_subject_analytics warning:', error);
      return [];
    }
    if (!Array.isArray(data)) return [];

    return data.map((row: any) => ({
      subject_id: row.subject_id,
      subject_name: row.subject_name || 'Subject',
      questions_attempted: row.questions_attempted || 0,
      correct_count: row.correct_count ?? row.correct ?? 0,
      wrong_count: row.wrong_count ?? row.wrong ?? 0,
      skipped_count: row.skipped_count ?? row.skipped ?? 0,
      accuracy: Math.round(Number(row.accuracy || 0)),
      score: row.score ?? row.total_score ?? 0,
      avg_time_per_question: row.avg_time_per_question ?? null,
    }));
  } catch (err) {
    console.warn('[studentWebDashboardService] Failed to load subject analytics:', err);
    return [];
  }
}

/**
 * Fetches student weak chapters (< 60% accuracy).
 */
export async function fetchStudentWeakChapters(): Promise<WeakChapterItem[]> {
  try {
    const { data, error } = await supabase.rpc('get_student_weak_chapters');
    if (error) {
      console.warn('[studentWebDashboardService] get_student_weak_chapters warning:', error);
      return [];
    }
    if (!Array.isArray(data)) return [];

    return data.slice(0, 6).map((row: any) => ({
      chapter_id: row.chapter_id,
      chapter_name: row.chapter_name || 'Chapter',
      subject_name: row.subject_name || 'Subject',
      accuracy: Math.round(Number(row.accuracy || 0)),
      questions_attempted: row.questions_attempted || 0,
      correct_count: row.correct_count ?? row.correct ?? 0,
      wrong_count: row.wrong_count ?? row.wrong ?? 0,
      skipped_count: row.skipped_count ?? row.skipped ?? 0,
    }));
  } catch (err) {
    console.warn('[studentWebDashboardService] Failed to load weak chapters:', err);
    return [];
  }
}

/**
 * Fetches student historical score trend.
 */
export async function fetchStudentScoreTrend(): Promise<RecentTestResultItem[]> {
  try {
    const { data, error } = await supabase.rpc('get_student_score_trend');
    if (error) {
      return [];
    }
    if (!Array.isArray(data)) return [];

    return data.slice(0, 5).map((row: any) => ({
      result_id: row.result_id || row.attempt_id,
      attempt_id: row.attempt_id || row.result_id,
      test_id: row.test_id,
      test_title: row.test_title || row.test_name || 'Mock Test',
      score: row.score || 0,
      total_score: row.total_score || row.max_score || 100,
      percentage: Math.round(Number(row.percentage || 0)),
      accuracy: Math.round(Number(row.accuracy || 0)),
      submitted_at: row.submitted_at || row.attempted_on || row.created_at || new Date().toISOString(),
      rank: row.rank !== undefined && row.rank !== null ? row.rank : null,
      percentile: row.percentile !== undefined && row.percentile !== null ? Number(row.percentile) : null,
    }));
  } catch (err) {
    return [];
  }
}

// ─── Dashboard shell (fast first-paint boundary) ────────────────────────────

/**
 * Fast subset of the dashboard that the first screen needs: the composite
 * bootstrap payload plus today's timetable.
 */
export interface StudentDashboardShell {
  bootstrap: any | null;
  todayTimetable: TimetableSessionItem[];
}

/**
 * In-flight shell promises keyed by the authenticated profile id. Sharing the
 * promise (rather than the resolved value) lets the fast shell query and the
 * aggregate primary query await the SAME bootstrap/timetable requests, so a
 * cold dashboard load still issues each exactly once. Keying by profile id
 * guarantees one student's shell can never be served to another in the same
 * browser session; entries are removed as soon as they settle.
 */
const dashboardShellInFlight = new Map<string, Promise<StudentDashboardShell>>();

export async function fetchStudentDashboardShell(): Promise<StudentDashboardShell> {
  let shellKey = 'anon';
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    shellKey = sessionData?.session?.user?.id ?? 'anon';
  } catch {
    shellKey = 'anon';
  }

  const existing = dashboardShellInFlight.get(shellKey);
  if (existing) {
    return existing;
  }

  const promise = (async (): Promise<StudentDashboardShell> => {
    const [bootstrapResult, timetable] = await Promise.all([
      fetchStudentBootstrap(),
      // PRD §5: today's schedule. Timetable source may be mid-repair (§10.2);
      // fail soft to an empty day so the Today page never blocks.
      fetchTodayTimetable().catch(() => ({
        sessions: [] as TimetableSessionItem[],
        todayStr: '',
      })),
    ]);

    return {
      bootstrap: bootstrapResult.data ?? null,
      todayTimetable: timetable?.sessions || [],
    };
  })();

  dashboardShellInFlight.set(shellKey, promise);
  void promise.finally(() => {
    if (dashboardShellInFlight.get(shellKey) === promise) {
      dashboardShellInFlight.delete(shellKey);
    }
  });

  return promise;
}

// ─── Query keys (shared: overview page + nav badge hooks) ──────────────────

export const studentDashboardKeys = {
  /** Fast composite bootstrap payload (profile, enrolled courses, active batches, stream). */
  bootstrap: (profileId?: string | null) =>
    ['student-dashboard', 'bootstrap', profileId || 'anon'] as const,
  /** Fast bootstrap + today's timetable — lets the first screen paint early. */
  overviewShell: (profileId?: string | null) =>
    ['student-dashboard', 'overview', profileId || 'anon', 'shell'] as const,
  /** Critical first-screen data — gates the dashboard skeleton. */
  overviewPrimary: (profileId?: string | null) =>
    ['student-dashboard', 'overview', profileId || 'anon', 'primary'] as const,
  /** Below-the-fold data — renders progressively, never blocks the page. */
  overviewSecondary: (profileId?: string | null) =>
    ['student-dashboard', 'overview', profileId || 'anon', 'secondary'] as const,
};

/**
 * Derives the Momentum analytics snapshot.
 *
 * Subject mastery drives accuracy when available; when it hasn't loaded yet
 * (primary wave), accuracy falls back to the latest score-trend entry — the
 * same fallback the original composite used for students without subject data.
 */
function deriveAnalytics(
  subjectAnalytics: SubjectAnalyticsItem[],
  scoreTrend: RecentTestResultItem[],
  bootstrapAnalytics?: { rank?: unknown; percentile?: unknown } | null,
): StudentDashboardSummary['analytics'] {
  const totalQuestions = subjectAnalytics.reduce((acc, curr) => acc + curr.questions_attempted, 0);
  const totalCorrect = subjectAnalytics.reduce((acc, curr) => acc + curr.correct_count, 0);
  const overallAccuracy = totalQuestions > 0
    ? Math.round((totalCorrect / totalQuestions) * 100)
    : (scoreTrend[0]?.accuracy || 0);
  const avgScore = scoreTrend.length > 0
    ? Math.round(scoreTrend.reduce((acc, c) => acc + c.percentage, 0) / scoreTrend.length)
    : 0;

  // Real rank: score results first, then bootstrap-provided cohort rank.
  const latestResultWithRank = scoreTrend.find(r => r.rank !== null && r.rank !== undefined);
  const rawRank = latestResultWithRank?.rank ?? bootstrapAnalytics?.rank ?? null;
  const realRank = rawRank !== null && rawRank !== undefined
    ? (typeof rawRank === 'number' ? `#${rawRank}` : String(rawRank))
    : '--';

  const latestResultWithPercentile = scoreTrend.find(r => r.percentile !== null && r.percentile !== undefined);
  const rawPercentile = latestResultWithPercentile?.percentile ?? bootstrapAnalytics?.percentile ?? null;
  const realPercentile = rawPercentile !== null && rawPercentile !== undefined ? Number(rawPercentile) : null;

  return {
    testsAttempted: scoreTrend.length,
    averageScore: avgScore,
    accuracy: overallAccuracy,
    rank: realRank,
    percentile: realPercentile,
  };
}

/**
 * WAVE 1 — critical first-screen data for /student/overview.
 *
 * True dependency graph (independent work starts at t=0):
 *   t=0      : bootstrap ∥ score trend ∥ today's timetable
 *   post-boot: assigned tests (receives already-resolved IDs → no rediscovery)
 *              ∥ live classes (needs batchIds) ∥ content summary (needs IDs)
 *
 * Secondary fields (subjectAnalytics / weakChapters) are returned as empty
 * placeholders — fetchStudentDashboardSecondary() fills them in a wave that
 * never blocks first paint.
 */
export async function fetchStudentDashboardPrimary(): Promise<StudentDashboardSummary> {
  // Wave 1 — momentum starts immediately; bootstrap + today's timetable come
  // from the shared shell so the fast shell query and this aggregate query
  // never issue duplicate bootstrap/timetable requests.
  const scoreTrendPromise = fetchStudentScoreTrend();
  const shell = await fetchStudentDashboardShell();
  const scoreTrend = await scoreTrendPromise;
  const bootstrap = shell.bootstrap;
  const todayTimetable = { sessions: shell.todayTimetable };

  const profile = bootstrap?.profile || null;
  const unreadNotificationsCount = bootstrap?.unread_notifications_count || 0;
  const activeBatches: StudentActiveBatch[] = bootstrap?.active_batches || [];
  const enrolledCourses: StudentEnrolledCourse[] = bootstrap?.enrolled_courses || [];
  const hasPurchased = bootstrap?.has_purchased || (enrolledCourses.length > 0);
  const selectedStreamName = bootstrap?.selected_stream?.name || 'Competitive Exams';

  const batchIds = activeBatches.map(b => b.batch_id);
  const courseIds = enrolledCourses.map(c => c.course_id);

  // Assigned-test discovery historically derived its course list from DIRECT
  // course_enrollments only. Bootstrap's unified list also includes
  // batch-assigned courses (`source: 'batch'`), so narrow it back to direct
  // rows here — meaning the pre-resolved context reproduces the original batch
  // set exactly (falling back to the full list if `source` is unavailable).
  const enrollmentRows = (bootstrap?.enrolled_courses || []) as Array<{
    course_id?: string | null;
    source?: string | null;
  }>;
  const hasEnrollmentSource = enrollmentRows.some(c => typeof c?.source === 'string');
  const assignedTestCourseIds = hasEnrollmentSource
    ? enrollmentRows.filter(c => c.source === 'direct').map(c => c.course_id as string)
    : courseIds;

  // Wave 2 — only what genuinely needs bootstrap IDs. Assigned tests reuse the
  // resolved profile/batch/course IDs so it skips its discovery round trips.
  // ONE shared batch_subjects request feeds BOTH assigned tests and live
  // classes; each branch keeps its own filtering behavior. Passing the promise
  // (not the resolved rows) keeps both branches concurrent.
  const sharedBatchSubjects = batchIds.length > 0
    ? fetchBatchSubjectRowsForBatches(batchIds).then((result) => result.rows)
    : null;

  const [assignedTestsData, liveClasses, contentSummary] = await Promise.all([
    fetchStudentAssignedMockTests(
      undefined,
      profile?.profile_id
        ? {
            profileId: profile.profile_id,
            batchIds,
            courseIds: assignedTestCourseIds,
            batchSubjects: sharedBatchSubjects,
          }
        : undefined,
    ),
    fetchStudentLiveAndUpcomingClasses(batchIds, sharedBatchSubjects),
    fetchCoursesContentSummary(courseIds, batchIds),
  ]);

  // Identify Live Now vs Next Scheduled class
  const liveNow = liveClasses.find(c => c.status === 'live') || null;
  const nextUpcoming = liveClasses.find(c => c.status === 'scheduled') || null;
  const featuredClass = liveNow || nextUpcoming || null;
  const upcomingClasses = liveClasses.filter(c => c !== featuredClass);

  return {
    profile,
    unreadNotificationsCount,
    activeBatches,
    enrolledCourses,
    liveClass: featuredClass,
    upcomingLiveClasses: upcomingClasses,
    // Rank/percentile are already final here; accuracy is layered with subject
    // mastery by fetchCompleteStudentDashboard()/the secondary wave.
    analytics: deriveAnalytics([], scoreTrend, bootstrap?.analytics),
    subjectAnalytics: [],
    weakChapters: [],
    recentResults: scoreTrend,
    assignedMockTests: assignedTestsData?.tests || [],
    todayTimetable: todayTimetable?.sessions || [],
    courseContentSummary: contentSummary,
    hasPurchased,
    selectedStreamName,
  };
}

/**
 * WAVE 2 — below-the-fold sections. Both RPCs are independent of bootstrap and
 * of each other, so they start at t=0 and never block first paint.
 */
export async function fetchStudentDashboardSecondary(): Promise<
  Pick<StudentDashboardSummary, 'subjectAnalytics' | 'weakChapters'>
> {
  const [subjectAnalytics, weakChapters] = await Promise.all([
    fetchStudentSubjectAnalytics(),
    fetchStudentWeakChapters(),
  ]);
  return { subjectAnalytics, weakChapters };
}

/**
 * Fetches the complete aggregated dashboard payload for the student dashboard.
 * Primary and secondary waves run concurrently; the returned shape is identical
 * to the original composite (existing consumers/tests unaffected).
 */
export async function fetchCompleteStudentDashboard(): Promise<StudentDashboardSummary> {
  const [primary, secondary] = await Promise.all([
    fetchStudentDashboardPrimary(),
    fetchStudentDashboardSecondary(),
  ]);
  const summary: StudentDashboardSummary = { ...primary, ...secondary };

  // Subject mastery feeds overall accuracy when present (original semantics);
  // the primary wave already computed the no-subject fallback.
  const totalQuestions = secondary.subjectAnalytics.reduce((acc, curr) => acc + curr.questions_attempted, 0);
  const totalCorrect = secondary.subjectAnalytics.reduce((acc, curr) => acc + curr.correct_count, 0);
  if (totalQuestions > 0) {
    summary.analytics = {
      ...summary.analytics,
      accuracy: Math.round((totalCorrect / totalQuestions) * 100),
    };
  }

  return summary;
}
