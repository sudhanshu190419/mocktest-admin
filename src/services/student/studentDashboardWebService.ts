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
  fetchStudentAssignedMockTests,
  type StudentMockTestCardItem,
} from './studentTestWebService';

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

export interface TimetableSessionItem {
  session_id: string;
  batch_id: string;
  subject_name: string;
  teacher_name: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  room_or_link?: string;
}

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
  batchIds: string[]
): Promise<StudentLiveClassItem[]> {
  if (!batchIds || batchIds.length === 0) return [];

  try {
    // 1. Resolve batch_subject IDs
    const { data: batchSubjects, error: bsError } = await supabase
      .from('batch_subjects')
      .select('batch_subject_id, batch_id, subjects(name)')
      .in('batch_id', batchIds);

    if (bsError || !batchSubjects || batchSubjects.length === 0) {
      return [];
    }

    const batchSubjectIds = batchSubjects.map((bs: any) => bs.batch_subject_id);
    const subjectMap = new Map<string, string>();
    batchSubjects.forEach((bs: any) => {
      subjectMap.set(bs.batch_subject_id, bs.subjects?.name || 'General Subject');
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

/**
 * Fetches the complete aggregated dashboard payload for the student dashboard.
 */
export async function fetchCompleteStudentDashboard(): Promise<StudentDashboardSummary> {
  // 1. Primary composite bootstrap
  const { data: bootstrap } = await fetchStudentBootstrap();

  const profile = bootstrap?.profile || null;
  const unreadNotificationsCount = bootstrap?.unread_notifications_count || 0;
  const activeBatches: StudentActiveBatch[] = bootstrap?.active_batches || [];
  const enrolledCourses: StudentEnrolledCourse[] = bootstrap?.enrolled_courses || [];
  const hasPurchased = bootstrap?.has_purchased || (enrolledCourses.length > 0);
  const selectedStreamName = bootstrap?.selected_stream?.name || 'Competitive Exams';

  const batchIds = activeBatches.map(b => b.batch_id);
  const courseIds = enrolledCourses.map(c => c.course_id);

  // 2. Fetch parallel non-blocking supplementary data (Single batched lifecycle, zero N+1)
  const [
    contentSummary,
    liveClasses,
    subjectAnalytics,
    weakChapters,
    scoreTrend,
    assignedTestsData
  ] = await Promise.all([
    fetchCoursesContentSummary(courseIds, batchIds),
    fetchStudentLiveAndUpcomingClasses(batchIds),
    fetchStudentSubjectAnalytics(),
    fetchStudentWeakChapters(),
    fetchStudentScoreTrend(),
    fetchStudentAssignedMockTests(profile?.profile_id || undefined)
  ]);

  // Identify Live Now vs Next Scheduled class
  const liveNow = liveClasses.find(c => c.status === 'live') || null;
  const nextUpcoming = liveClasses.find(c => c.status === 'scheduled') || null;
  const featuredClass = liveNow || nextUpcoming || null;
  const upcomingClasses = liveClasses.filter(c => c !== featuredClass);

  // Derive top performance snapshot
  const totalQuestions = subjectAnalytics.reduce((acc, curr) => acc + curr.questions_attempted, 0);
  const totalCorrect = subjectAnalytics.reduce((acc, curr) => acc + curr.correct_count, 0);
  const overallAccuracy = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : (scoreTrend[0]?.accuracy || 0);
  const avgScore = scoreTrend.length > 0
    ? Math.round(scoreTrend.reduce((acc, c) => acc + c.percentage, 0) / scoreTrend.length)
    : 0;

  // Real rank: check if recent score results or bootstrap provides genuine cohort rank
  const latestResultWithRank = scoreTrend.find(r => r.rank !== null && r.rank !== undefined);
  const rawRank = latestResultWithRank?.rank ?? bootstrap?.analytics?.rank ?? null;
  const realRank = rawRank !== null && rawRank !== undefined
    ? (typeof rawRank === 'number' ? `#${rawRank}` : String(rawRank))
    : '--';

  // Real percentile: check if genuine percentile benchmark exists, otherwise null
  const latestResultWithPercentile = scoreTrend.find(r => r.percentile !== null && r.percentile !== undefined);
  const rawPercentile = latestResultWithPercentile?.percentile ?? bootstrap?.analytics?.percentile ?? null;
  const realPercentile = rawPercentile !== null && rawPercentile !== undefined ? Number(rawPercentile) : null;

  return {
    profile,
    unreadNotificationsCount,
    activeBatches,
    enrolledCourses,
    liveClass: featuredClass,
    upcomingLiveClasses: upcomingClasses,
    analytics: {
      testsAttempted: scoreTrend.length,
      averageScore: avgScore,
      accuracy: overallAccuracy,
      rank: realRank,
      percentile: realPercentile,
    },
    subjectAnalytics,
    weakChapters,
    recentResults: scoreTrend,
    assignedMockTests: assignedTestsData?.tests || [],
    todayTimetable: [],
    courseContentSummary: contentSummary,
    hasPurchased,
    selectedStreamName,
  };
}
