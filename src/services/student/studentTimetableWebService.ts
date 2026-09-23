/**
 * Student Timetable Web Service
 *
 * Provides student-facing timetable queries and projection for Student Web.
 * Connects to Supabase to fetch active batch timetable_slots, lesson_plans,
 * concrete live_classes, and scheduled mock_tests, and feeds them into the
 * shared studentTimetableProjector.
 *
 * @module services/student/studentTimetableWebService
 */

import { supabase } from '@/config/supabase';
import {
  projectSlotsForDateRange,
  groupSessionsByDate,
  getAcademicYearInfo,
  getAcademicYearMonths,
  getWeekDaysForDate,
  formatDateToIsoDate,
  buildAcademicYearFromStartYear,
  type TimetableSessionItem,
  type RawTimetableSlot,
  type RawLessonPlan,
  type RawConcreteClass,
  type RawMockTestAssignment,
  type AcademicYearInfo,
  type DynamicDayItem,
} from '@/utils/studentTimetableProjector';

// Re-export for consumers (dashboard service, Today page) — PRD §5 today schedule.
export type { TimetableSessionItem } from '@/utils/studentTimetableProjector';

// ═══════════════════════════════════════════════════════════════════════════
//  Internal Types & Select Constants
// ═══════════════════════════════════════════════════════════════════════════

interface DbSlotRow {
  timetable_slot_id: string;
  institute_id: string;
  teacher_id: string;
  batch_subject_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  valid_from: string;
  valid_until: string;
  status: 'active' | 'paused' | 'cancelled';
  teacher_details?: {
    teacher_id: string;
    profiles?: { name: string } | { name: string }[] | null;
  } | null;
  batch_subjects?: {
    batch_subject_id: string;
    batch_id: string;
    batches?: { name: string } | { name: string }[] | null;
    subjects?: { name: string } | { name: string }[] | null;
  } | null;
}

interface DbLessonPlanRow {
  lesson_plan_id: string;
  timetable_slot_id: string;
  occurrence_date: string;
  chapter_id?: string | null;
  topic_id?: string | null;
  notes?: string | null;
  chapters?: { name: string } | { name: string }[] | null;
  topics?: { name: string } | { name: string }[] | null;
}

interface DbLiveClassRow {
  class_id: string;
  title: string;
  scheduled_at: string;
  duration_min: number;
  status: 'scheduled' | 'live' | 'completed' | 'cancelled';
  room_name?: string | null;
  timetable_slot_id?: string | null;
  teacher_details?: {
    profiles?: { name: string } | { name: string }[] | null;
  } | null;
  chapters?: { name: string } | { name: string }[] | null;
  topics?: { name: string } | { name: string }[] | null;
  batch_subject_live_classes?: Array<{
    batch_subject_id: string;
    batch_subjects?: {
      batch_id: string;
      batches?: { name: string } | { name: string }[] | null;
      subjects?: { name: string } | { name: string }[] | null;
    } | null;
  }> | null;
}

interface DbMockTestRow {
  batch_subject_id: string;
  test_id: string;
  available_from?: string | null;
  mock_tests?: {
    title: string;
    duration_min: number;
    subjects?: { name: string } | { name: string }[] | null;
  } | null;
  batch_subjects?: {
    batch_id: string;
  } | null;
}

function pickFirst<T>(val: T | T[] | null | undefined): T | null {
  if (Array.isArray(val)) return val[0] ?? null;
  return val ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Data Fetchers
// ═══════════════════════════════════════════════════════════════════════════

interface RpcTimetableSlotRow {
  timetable_slot_id: string;
  batch_subject_id: string;
  batch_id: string;
  batch_name: string;
  subject_id: string;
  subject_name: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  valid_from: string;
  valid_until: string;
  status: 'active' | 'paused' | 'cancelled' | string;
}

/**
 * Legacy PostgREST fallback for fetching student timetable slots.
 * Executed only if the get_student_timetable_slots RPC fails or returns unusable data.
 */
async function fetchStudentTimetableSlotsLegacy(): Promise<RawTimetableSlot[]> {
  try {
    const { data, error } = await supabase
      .from('timetable_slots')
      .select(`
        timetable_slot_id,
        institute_id,
        teacher_id,
        batch_subject_id,
        day_of_week,
        start_time,
        end_time,
        valid_from,
        valid_until,
        status,
        teacher_details!fk_timetable_slots_teacher (
          teacher_id,
          profiles!fk_teacher_details_profile ( name )
        ),
        batch_subjects!fk_timetable_slots_batch_subject (
          batch_subject_id,
          batch_id,
          batches!fk_batch_subjects_batch ( name ),
          subjects!fk_batch_subjects_subject ( name )
        )
      `)
      .eq('status', 'active');

    if (error) {
      console.warn('[studentTimetableWebService] fetchStudentTimetableSlotsLegacy error:', error.message);
      return [];
    }

    if (!data) return [];

    return (data as unknown as DbSlotRow[]).map((row) => {
      const teacherProfile = pickFirst(row.teacher_details?.profiles);
      const batchSubject = pickFirst(row.batch_subjects);
      const batch = pickFirst(batchSubject?.batches);
      const subject = pickFirst(batchSubject?.subjects);

      return {
        timetable_slot_id: row.timetable_slot_id,
        institute_id: row.institute_id,
        teacher_id: row.teacher_id,
        batch_subject_id: row.batch_subject_id,
        day_of_week: row.day_of_week,
        start_time: row.start_time,
        end_time: row.end_time,
        valid_from: row.valid_from,
        valid_until: row.valid_until,
        status: row.status,
        teacher_name: teacherProfile?.name || null,
        batch_name: batch?.name || null,
        batch_id: batchSubject?.batch_id || null,
        subject_name: subject?.name || null,
      };
    });
  } catch (err) {
    console.warn('[studentTimetableWebService] fetchStudentTimetableSlotsLegacy catch:', err);
    return [];
  }
}

/**
 * Fetch all active recurring timetable slots accessible to the authenticated student.
 * Primary path: calls public.get_student_timetable_slots RPC.
 * Fallback path: falls back to legacy PostgREST query on error.
 */
export async function fetchStudentTimetableSlots(batchIds?: string[]): Promise<RawTimetableSlot[]> {
  try {
    const rpcParams: { p_batch_ids?: string[] } = {};
    if (batchIds && batchIds.length > 0) {
      rpcParams.p_batch_ids = batchIds;
    }

    const { data, error } = await supabase.rpc('get_student_timetable_slots', rpcParams);

    if (error) {
      console.warn('[studentTimetableWebService] get_student_timetable_slots RPC failed, using legacy fallback:', error.message);
      return await fetchStudentTimetableSlotsLegacy();
    }

    if (!Array.isArray(data)) {
      console.warn('[studentTimetableWebService] get_student_timetable_slots returned non-array, using legacy fallback');
      return await fetchStudentTimetableSlotsLegacy();
    }

    return (data as RpcTimetableSlotRow[]).map((row) => ({
      timetable_slot_id: row.timetable_slot_id,
      institute_id: '',
      teacher_id: '',
      batch_subject_id: row.batch_subject_id,
      day_of_week: Number(row.day_of_week),
      start_time: row.start_time,
      end_time: row.end_time,
      valid_from: row.valid_from,
      valid_until: row.valid_until,
      status: (row.status as 'active' | 'paused' | 'cancelled') || 'active',
      teacher_name: null,
      batch_name: row.batch_name || null,
      batch_id: row.batch_id || null,
      subject_name: row.subject_name || null,
    }));
  } catch (err) {
    console.warn('[studentTimetableWebService] fetchStudentTimetableSlots catch, using legacy fallback:', err);
    return await fetchStudentTimetableSlotsLegacy().catch(() => []);
  }
}

/**
 * Fetch lesson plans for a set of slot IDs in a given date range
 */
export async function fetchStudentLessonPlans(
  slotIds: string[],
  startDate?: string,
  endDate?: string,
): Promise<RawLessonPlan[]> {
  if (!slotIds || slotIds.length === 0) return [];

  try {
    let query = supabase
      .from('lesson_plans')
      .select(`
        lesson_plan_id,
        timetable_slot_id,
        occurrence_date,
        chapter_id,
        topic_id,
        notes,
        chapters ( name ),
        topics ( name )
      `)
      .in('timetable_slot_id', slotIds);

    if (startDate) {
      query = query.gte('occurrence_date', startDate);
    }
    if (endDate) {
      query = query.lte('occurrence_date', endDate);
    }

    const { data, error } = await query;

    if (error) {
      console.warn('[studentTimetableWebService] fetchStudentLessonPlans error:', error.message);
      return [];
    }

    if (!data) return [];

    return (data as unknown as DbLessonPlanRow[]).map((row) => {
      const chapter = pickFirst(row.chapters);
      const topic = pickFirst(row.topics);
      return {
        lesson_plan_id: row.lesson_plan_id,
        timetable_slot_id: row.timetable_slot_id,
        occurrence_date: row.occurrence_date,
        chapter_id: row.chapter_id,
        topic_id: row.topic_id,
        notes: row.notes,
        chapter_name: chapter?.name || null,
        topic_name: topic?.name || null,
      };
    });
  } catch (err) {
    console.warn('[studentTimetableWebService] fetchStudentLessonPlans catch:', err);
    return [];
  }
}

/**
 * Fetch materialized concrete live classes for the student in a date range
 */
export async function fetchStudentConcreteClasses(
  startDate: string,
  endDate: string,
): Promise<RawConcreteClass[]> {
  try {
    const startIso = `${startDate}T00:00:00Z`;
    const endIso = `${endDate}T23:59:59Z`;

    const { data, error } = await supabase
      .from('live_classes')
      .select(`
        class_id,
        title,
        scheduled_at,
        duration_min,
        status,
        room_name,
        timetable_slot_id,
        teacher_details!fk_live_classes_teacher (
          profiles!fk_teacher_details_profile ( name )
        ),
        chapters ( name ),
        topics ( name ),
        batch_subject_live_classes!fk_bslc_class (
          batch_subject_id,
          batch_subjects!fk_bslc_batch_subject (
            batch_id,
            batches!fk_batch_subjects_batch ( name ),
            subjects!fk_batch_subjects_subject ( name )
          )
        )
      `)
      .gte('scheduled_at', startIso)
      .lte('scheduled_at', endIso)
      .in('status', ['scheduled', 'live', 'completed']);

    if (error) {
      console.warn('[studentTimetableWebService] fetchStudentConcreteClasses error:', error.message);
      return [];
    }

    if (!data) return [];

    return (data as unknown as DbLiveClassRow[]).map((row) => {
      const teacherProfile = pickFirst(row.teacher_details?.profiles);
      const chapter = pickFirst(row.chapters);
      const topic = pickFirst(row.topics);
      const bslc = row.batch_subject_live_classes?.[0];
      const batchSubject = bslc?.batch_subjects;
      const batch = pickFirst(batchSubject?.batches);
      const subject = pickFirst(batchSubject?.subjects);

      return {
        class_id: row.class_id,
        title: row.title,
        scheduled_at: row.scheduled_at,
        duration_min: row.duration_min,
        status: row.status,
        room_name: row.room_name,
        timetable_slot_id: row.timetable_slot_id,
        teacher_name: teacherProfile?.name || null,
        subject_name: subject?.name || null,
        batch_name: batch?.name || null,
        batch_id: batchSubject?.batch_id || null,
        batch_subject_id: bslc?.batch_subject_id || null,
        chapter_name: chapter?.name || null,
        topic_name: topic?.name || null,
      };
    });
  } catch (err) {
    console.warn('[studentTimetableWebService] fetchStudentConcreteClasses catch:', err);
    return [];
  }
}

/**
 * Fetch scheduled mock tests for the student in a date range
 */
export async function fetchStudentScheduledMockTests(
  startDate: string,
  endDate: string,
): Promise<RawMockTestAssignment[]> {
  try {
    const startIso = `${startDate}T00:00:00Z`;
    const endIso = `${endDate}T23:59:59Z`;

    const { data, error } = await supabase
      .from('batch_subject_mock_tests')
      .select(`
        batch_subject_id,
        test_id,
        available_from,
        mock_tests (
          title,
          duration_min,
          subjects:subjects!fk_mock_tests_subject ( name )
        ),
        batch_subjects!fk_bsmt_batch_subject (
          batch_id
        )
      `)
      .gte('available_from', startIso)
      .lte('available_from', endIso);

    if (error) {
      // Table might not have RLS or scheduled tests; fail soft
      return [];
    }

    if (!data) return [];

    return (data as unknown as DbMockTestRow[]).map((row) => {
      const mt = row.mock_tests;
      const subject = pickFirst(mt?.subjects);
      return {
        assignment_id: row.test_id,
        test_id: row.test_id,
        batch_subject_id: row.batch_subject_id,
        batch_id: row.batch_subjects?.batch_id || null,
        available_from: row.available_from,
        available_until: null,
        title: mt?.title || 'Mock Test',
        subject_name: subject?.name || 'Full Syllabus',
        duration_minutes: mt?.duration_min || 180,
        total_marks: 300,
      };
    });
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Public High-Level Query Methods
// ═══════════════════════════════════════════════════════════════════════════

/**
 * High-level: Fetch unified timetable schedule for ANY custom date range
 */
export async function fetchTimetableForRange(
  startDate: string,
  endDate: string,
  now: Date = new Date(),
  batchIds?: string[],
): Promise<{ sessions: TimetableSessionItem[]; grouped: Record<string, TimetableSessionItem[]> }> {
  // 1. Fetch slots
  const slots = await fetchStudentTimetableSlots(batchIds);
  const slotIds = slots.map((s) => s.timetable_slot_id);

  // 2. Parallel fetch of plans, concrete classes, and mock tests
  const [lessonPlans, concreteClasses, mockTests] = await Promise.all([
    fetchStudentLessonPlans(slotIds, startDate, endDate),
    fetchStudentConcreteClasses(startDate, endDate),
    fetchStudentScheduledMockTests(startDate, endDate),
  ]);

  // 3. Project unified schedule
  const sessions = projectSlotsForDateRange({
    slots,
    lessonPlans,
    concreteClasses,
    mockTests,
    startDate,
    endDate,
    now,
  });

  const grouped = groupSessionsByDate(sessions);
  return { sessions, grouped };
}

/**
 * High-level: Fetch TODAY's timetable
 */
export async function fetchTodayTimetable(
  now: Date = new Date(),
  batchIds?: string[],
): Promise<{ sessions: TimetableSessionItem[]; todayStr: string }> {
  const todayStr = formatDateToIsoDate(now);
  const { sessions } = await fetchTimetableForRange(todayStr, todayStr, now, batchIds);
  return { sessions, todayStr };
}

/**
 * High-level: Fetch WEEK's timetable (Mon–Sun)
 */
export async function fetchWeekTimetable(
  referenceDate: Date = new Date(),
  now: Date = new Date(),
): Promise<{
  days: DynamicDayItem[];
  sessions: TimetableSessionItem[];
  grouped: Record<string, TimetableSessionItem[]>;
}> {
  const days = getWeekDaysForDate(referenceDate);
  const startDate = days[0].dateString;
  const endDate = days[6].dateString;

  const { sessions, grouped } = await fetchTimetableForRange(startDate, endDate, now);
  return { days, sessions, grouped };
}

/**
 * High-level: Fetch MONTH's timetable
 */
export async function fetchMonthTimetable(
  year: number,
  month: number, // 1-indexed (1 = Jan ... 12 = Dec)
  now: Date = new Date(),
): Promise<{
  year: number;
  month: number;
  startDate: string;
  endDate: string;
  sessions: TimetableSessionItem[];
  grouped: Record<string, TimetableSessionItem[]>;
}> {
  const lastDay = new Date(year, month, 0).getDate();
  const mStr = String(month).padStart(2, '0');
  const startDate = `${year}-${mStr}-01`;
  const endDate = `${year}-${mStr}-${String(lastDay).padStart(2, '0')}`;

  const { sessions, grouped } = await fetchTimetableForRange(startDate, endDate, now);
  return { year, month, startDate, endDate, sessions, grouped };
}

/**
 * High-level: Fetch ANNUAL Timetable (12 Months, Apr -> Mar)
 */
export async function fetchAnnualTimetable(
  academicYearStartYear?: number,
  now: Date = new Date(),
): Promise<{
  academicYear: AcademicYearInfo;
  months: Array<{ year: number; month: number; label: string; shortName: string }>;
  sessions: TimetableSessionItem[];
  grouped: Record<string, TimetableSessionItem[]>;
}> {
  const academicYear = academicYearStartYear
    ? buildAcademicYearFromStartYear(academicYearStartYear)
    : getAcademicYearInfo(now);

  const months = getAcademicYearMonths(academicYear.startYear);

  const { sessions, grouped } = await fetchTimetableForRange(
    academicYear.startDate,
    academicYear.endDate,
    now,
  );

  return { academicYear, months, sessions, grouped };
}
