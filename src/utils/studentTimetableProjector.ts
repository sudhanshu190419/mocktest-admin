/**
 * Student Timetable Projection Engine & Pure Utilities
 *
 * Unified cross-platform projection engine for Student Web and Student Mobile.
 * Projects recurring weekly timetable_slots across any date range (Today, Week,
 * Month, Annual/Academic Year), merges lesson plans and concrete live class
 * occurrences, and integrates real scheduled mock tests.
 *
 * @module utils/studentTimetableProjector
 */

export type TimetableSessionType = 'live' | 'test';
export type TimetableSessionStatus = 'live' | 'upcoming' | 'completed' | 'scheduled';

export interface SubjectTheme {
  accentColor: string;
  badgeBg: string;
  badgeText: string;
}

export interface TimetableSessionItem {
  id: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM:SS or HH:MM
  endTime: string; // HH:MM:SS or HH:MM
  timeSlot: string; // "10:00 AM - 11:30 AM"
  duration: string; // "90 mins"
  durationMin: number;
  title?: string;
  subject: string;
  teacher: string | null;
  batch: string;
  batchId: string;
  batchSubjectId: string;
  chapter: string | null;
  topic: string | null;
  notes: string | null;
  sessionType: TimetableSessionType;
  status: TimetableSessionStatus;
  classId?: string;
  roomName?: string;
  testId?: string;
  timetableSlotId?: string;
  accentColor: string;
  badgeBg: string;
  badgeText: string;
  isProjected?: boolean;
}

export interface RawTimetableSlot {
  timetable_slot_id: string;
  institute_id: string;
  teacher_id: string;
  batch_subject_id: string;
  day_of_week: number; // 1 = Monday ... 7 = Sunday
  start_time: string;
  end_time: string;
  valid_from: string; // YYYY-MM-DD
  valid_until: string; // YYYY-MM-DD
  status: 'active' | 'paused' | 'cancelled';
  teacher_name?: string | null;
  subject_name?: string | null;
  batch_name?: string | null;
  batch_id?: string | null;
}

export interface RawLessonPlan {
  lesson_plan_id: string;
  timetable_slot_id: string;
  occurrence_date: string; // YYYY-MM-DD
  chapter_id?: string | null;
  topic_id?: string | null;
  notes?: string | null;
  chapter_name?: string | null;
  topic_name?: string | null;
}

export interface RawConcreteClass {
  class_id: string;
  title: string;
  scheduled_at: string; // ISO
  duration_min: number;
  status: 'scheduled' | 'live' | 'completed' | 'cancelled';
  room_name?: string | null;
  timetable_slot_id?: string | null;
  teacher_name?: string | null;
  subject_name?: string | null;
  batch_name?: string | null;
  batch_id?: string | null;
  batch_subject_id?: string | null;
  chapter_name?: string | null;
  topic_name?: string | null;
}

export interface RawMockTestAssignment {
  assignment_id: string;
  test_id: string;
  batch_subject_id?: string | null;
  batch_id?: string | null;
  available_from?: string | null; // ISO or date
  available_until?: string | null;
  title: string;
  subject_name?: string | null;
  duration_minutes?: number;
  total_marks?: number;
}

export interface AcademicYearInfo {
  startYear: number;
  endYear: number;
  startDate: string; // YYYY-04-01
  endDate: string; // (YYYY+1)-03-31
  label: string; // "2026–2027"
}

export interface DynamicDayItem {
  date: number;
  dayName: string;
  fullDate: string;
  isToday: boolean;
  dateString: string; // YYYY-MM-DD
  fullDateObj: Date;
}

/**
 * Standard Subject Color Theme Mapping
 * Synchronized across Web and Mobile
 */
export function getSubjectTheme(subjectName: string): SubjectTheme {
  const lower = (subjectName || '').toLowerCase();
  if (lower.includes('physics')) {
    return { accentColor: '#D97706', badgeBg: '#FEF3C7', badgeText: '#92400E' };
  }
  if (lower.includes('chem')) {
    return { accentColor: '#059669', badgeBg: '#D1FAE5', badgeText: '#065F46' };
  }
  if (lower.includes('bio')) {
    return { accentColor: '#E11D48', badgeBg: '#FFE4E6', badgeText: '#9F1239' };
  }
  if (lower.includes('math')) {
    return { accentColor: '#2563EB', badgeBg: '#DBEAFE', badgeText: '#1E40AF' };
  }
  if (lower.includes('test') || lower.includes('mock')) {
    return { accentColor: '#DC2626', badgeBg: '#FEE2E2', badgeText: '#991B1B' };
  }
  return { accentColor: '#7C3AED', badgeBg: '#EDE9FE', badgeText: '#5B21B6' };
}

/**
 * Format 24-hour time "HH:MM:SS" or "HH:MM" into "HH:MM AM/PM"
 */
export function formatTimeAmPm(timeStr: string): string {
  if (!timeStr) return '';
  const parts = timeStr.split(':');
  let hours = parseInt(parts[0], 10);
  const minutes = parts[1] || '00';
  if (isNaN(hours)) return timeStr;
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${hours}:${minutes.padStart(2, '0')} ${ampm}`;
}

/**
 * Build time slot string e.g. "10:00 AM - 11:30 AM"
 */
export function buildTimeSlotString(startTime: string, endTime: string): string {
  return `${formatTimeAmPm(startTime)} - ${formatTimeAmPm(endTime)}`;
}

/**
 * Calculate duration in minutes between two "HH:MM" strings
 */
export function calculateDurationMinutes(startTime: string, endTime: string): number {
  if (!startTime || !endTime) return 60;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return 60;
  const startMins = sh * 60 + sm;
  let endMins = eh * 60 + em;
  if (endMins < startMins) endMins += 24 * 60; // Cross midnight
  return endMins - startMins || 60;
}

/**
 * Formats a Date object as YYYY-MM-DD in local time
 */
export function formatDateToIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Converts a YYYY-MM-DD string into a local Date object safely
 */
export function parseIsoDateStringToLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Safely converts an ISO timestamp or date string into YYYY-MM-DD in local/IST time
 */
export function parseTimestampToLocalDateStr(isoOrDateStr?: string | null): string {
  if (!isoOrDateStr) return '';
  if (isoOrDateStr.length === 10 && !isoOrDateStr.includes('T')) {
    return isoOrDateStr;
  }
  const d = new Date(isoOrDateStr);
  if (isNaN(d.getTime())) {
    return isoOrDateStr.split('T')[0] || '';
  }
  return formatDateToIsoDate(d);
}

/**
 * Calculate dynamic status for a session based on date and time
 */
export function calculateSessionStatus(
  dateStr: string,
  startTime: string,
  endTime: string,
  explicitClassStatus?: 'scheduled' | 'live' | 'completed' | 'cancelled',
  now: Date = new Date(),
): TimetableSessionStatus {
  if (explicitClassStatus === 'live') return 'live';
  if (explicitClassStatus === 'completed' || explicitClassStatus === 'cancelled') return 'completed';

  const todayStr = formatDateToIsoDate(now);

  if (dateStr < todayStr) {
    return 'completed';
  }

  if (dateStr > todayStr) {
    return 'scheduled';
  }

  // Same day: evaluate wall-clock time
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);

  const startMinutes = (isNaN(sh) ? 0 : sh) * 60 + (isNaN(sm) ? 0 : sm);
  const endMinutes = (isNaN(eh) ? 0 : eh) * 60 + (isNaN(em) ? 0 : em);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  if (nowMinutes >= startMinutes && nowMinutes <= endMinutes) {
    return 'live';
  }
  if (nowMinutes > endMinutes) {
    return 'completed';
  }
  return 'upcoming';
}

/**
 * Calculate Academic Year (April 1 to March 31) from a date or reference year
 */
export function getAcademicYearInfo(referenceDate: Date = new Date()): AcademicYearInfo {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth(); // 0 = Jan ... 11 = Dec

  // If January to March (0, 1, 2), academic year started in previous year
  const startYear = month < 3 ? year - 1 : year;
  const endYear = startYear + 1;

  return {
    startYear,
    endYear,
    startDate: `${startYear}-04-01`,
    endDate: `${endYear}-03-31`,
    label: `${startYear}–${endYear}`,
  };
}

/**
 * Build academic year info for a specific start year e.g. 2026 -> 2026-04-01 to 2027-03-31
 */
export function buildAcademicYearFromStartYear(startYear: number): AcademicYearInfo {
  return {
    startYear,
    endYear: startYear + 1,
    startDate: `${startYear}-04-01`,
    endDate: `${startYear + 1}-03-31`,
    label: `${startYear}–${startYear + 1}`,
  };
}

/**
 * Returns a list of the 12 months for an academic year (Apr -> Mar)
 */
export function getAcademicYearMonths(startYear: number): Array<{ year: number; month: number; label: string; shortName: string }> {
  const months = [
    { year: startYear, month: 4, label: `April ${startYear}`, shortName: 'Apr' },
    { year: startYear, month: 5, label: `May ${startYear}`, shortName: 'May' },
    { year: startYear, month: 6, label: `June ${startYear}`, shortName: 'Jun' },
    { year: startYear, month: 7, label: `July ${startYear}`, shortName: 'Jul' },
    { year: startYear, month: 8, label: `August ${startYear}`, shortName: 'Aug' },
    { year: startYear, month: 9, label: `September ${startYear}`, shortName: 'Sep' },
    { year: startYear, month: 10, label: `October ${startYear}`, shortName: 'Oct' },
    { year: startYear, month: 11, label: `November ${startYear}`, shortName: 'Nov' },
    { year: startYear, month: 12, label: `December ${startYear}`, shortName: 'Dec' },
    { year: startYear + 1, month: 1, label: `January ${startYear + 1}`, shortName: 'Jan' },
    { year: startYear + 1, month: 2, label: `February ${startYear + 1}`, shortName: 'Feb' },
    { year: startYear + 1, month: 3, label: `March ${startYear + 1}`, shortName: 'Mar' },
  ];
  return months;
}

/**
 * Get 7 days for a given week starting Monday
 */
export function getWeekDaysForDate(referenceDate: Date = new Date()): DynamicDayItem[] {
  const dayOfWeek = referenceDate.getDay(); // 0 = Sun ... 6 = Sat
  const distanceToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const monday = new Date(referenceDate);
  monday.setDate(referenceDate.getDate() + distanceToMon);

  const now = new Date();
  const days: DynamicDayItem[] = [];
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);

    const isToday = formatDateToIsoDate(d) === formatDateToIsoDate(now);
    const dateNum = d.getDate();
    const monthName = d.toLocaleString('en-US', { month: 'short' });
    const fullWeekday = d.toLocaleString('en-US', { weekday: 'long' });

    days.push({
      date: dateNum,
      dayName: dayNames[i],
      fullDate: `${fullWeekday}, ${monthName} ${dateNum}`,
      isToday,
      dateString: formatDateToIsoDate(d),
      fullDateObj: d,
    });
  }

  return days;
}

/**
 * Project recurring slots and merge concrete classes + lesson plans + mock tests for any date range
 */
export function projectSlotsForDateRange(params: {
  slots: RawTimetableSlot[];
  lessonPlans?: RawLessonPlan[];
  concreteClasses?: RawConcreteClass[];
  mockTests?: RawMockTestAssignment[];
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  now?: Date;
}): TimetableSessionItem[] {
  const {
    slots = [],
    lessonPlans = [],
    concreteClasses = [],
    mockTests = [],
    startDate,
    endDate,
    now = new Date(),
  } = params;

  const results: TimetableSessionItem[] = [];

  // Index lesson plans by `${slotId}_${date}`
  const lessonPlanMap = new Map<string, RawLessonPlan>();
  for (const lp of lessonPlans) {
    if (lp.timetable_slot_id && lp.occurrence_date) {
      lessonPlanMap.set(`${lp.timetable_slot_id}_${lp.occurrence_date}`, lp);
    }
  }

  // Index concrete classes by `${slotId}_${date}` and by date for one-offs
  const concreteClassBySlotDate = new Map<string, RawConcreteClass>();
  const oneOffClassesByDate = new Map<string, RawConcreteClass[]>();

  for (const cc of concreteClasses) {
    const classDate = parseTimestampToLocalDateStr(cc.scheduled_at);
    if (!classDate) continue;

    if (cc.timetable_slot_id) {
      concreteClassBySlotDate.set(`${cc.timetable_slot_id}_${classDate}`, cc);
    } else {
      const list = oneOffClassesByDate.get(classDate) || [];
      list.push(cc);
      oneOffClassesByDate.set(classDate, list);
    }
  }

  // Index mock tests by date
  const mockTestsByDate = new Map<string, RawMockTestAssignment[]>();
  for (const mt of mockTests) {
    const testDate = parseTimestampToLocalDateStr(mt.available_from);
    if (testDate) {
      const list = mockTestsByDate.get(testDate) || [];
      list.push(mt);
      mockTestsByDate.set(testDate, list);
    }
  }

  const startD = parseIsoDateStringToLocalDate(startDate);
  const endD = parseIsoDateStringToLocalDate(endDate);

  const activeSlots = slots.filter((s) => s.status === 'active');

  const cursor = new Date(startD);
  while (cursor <= endD) {
    const dateStr = formatDateToIsoDate(cursor);
    const dayOfWeek = cursor.getDay(); // 0 = Sun, 1 = Mon ... 6 = Sat
    const isoDow = dayOfWeek === 0 ? 7 : dayOfWeek; // 1 = Mon ... 7 = Sun

    // Match recurring slots for this day of week & validity window
    for (const slot of activeSlots) {
      if (slot.day_of_week !== isoDow) continue;
      if (slot.valid_from && dateStr < slot.valid_from) continue;
      if (slot.valid_until && dateStr > slot.valid_until) continue;

      const planKey = `${slot.timetable_slot_id}_${dateStr}`;
      const plan = lessonPlanMap.get(planKey);
      const concrete = concreteClassBySlotDate.get(planKey);

      const subjectName = slot.subject_name || concrete?.subject_name || 'Subject';
      const teacherName = slot.teacher_name || concrete?.teacher_name || null;
      const batchName = slot.batch_name || concrete?.batch_name || 'Class Batch';
      const batchId = slot.batch_id || concrete?.batch_id || '';
      const batchSubjectId = slot.batch_subject_id || '';

      const chapterName = plan?.chapter_name || concrete?.chapter_name || null;
      const topicName = plan?.topic_name || concrete?.topic_name || null;
      const notes = plan?.notes || null;

      const startTime = slot.start_time || '09:00';
      const endTime = slot.end_time || '10:00';
      const durationMin = calculateDurationMinutes(startTime, endTime);
      const timeSlot = buildTimeSlotString(startTime, endTime);
      const theme = getSubjectTheme(subjectName);

      const status = calculateSessionStatus(
        dateStr,
        startTime,
        endTime,
        concrete?.status,
        now,
      );

      results.push({
        id: concrete?.class_id || `projected_${slot.timetable_slot_id}_${dateStr}`,
        date: dateStr,
        startTime,
        endTime,
        timeSlot,
        duration: `${durationMin} mins`,
        durationMin,
        title: concrete?.title || (chapterName ? `${subjectName}: ${chapterName}` : `${subjectName} Lecture`),
        subject: subjectName,
        teacher: teacherName,
        batch: batchName,
        batchId,
        batchSubjectId,
        chapter: chapterName,
        topic: topicName,
        notes,
        sessionType: 'live',
        status,
        classId: concrete?.class_id,
        roomName: concrete?.room_name || undefined,
        timetableSlotId: slot.timetable_slot_id,
        accentColor: theme.accentColor,
        badgeBg: theme.badgeBg,
        badgeText: theme.badgeText,
        isProjected: !concrete,
      });
    }

    // Add one-off concrete classes for this date
    const oneOffs = oneOffClassesByDate.get(dateStr) || [];
    for (const cc of oneOffs) {
      const startDateTime = new Date(cc.scheduled_at);
      const startH = String(startDateTime.getHours()).padStart(2, '0');
      const startM = String(startDateTime.getMinutes()).padStart(2, '0');
      const startTime = `${startH}:${startM}`;
      const durationMin = cc.duration_min || 60;
      const endDateTime = new Date(startDateTime.getTime() + durationMin * 60 * 1000);
      const endH = String(endDateTime.getHours()).padStart(2, '0');
      const endM = String(endDateTime.getMinutes()).padStart(2, '0');
      const endTime = `${endH}:${endM}`;

      const subjectName = cc.subject_name || cc.title || 'Live Class';
      const theme = getSubjectTheme(subjectName);
      const timeSlot = buildTimeSlotString(startTime, endTime);
      const status = calculateSessionStatus(dateStr, startTime, endTime, cc.status, now);

      results.push({
        id: cc.class_id,
        date: dateStr,
        startTime,
        endTime,
        timeSlot,
        duration: `${durationMin} mins`,
        durationMin,
        title: cc.title || `${subjectName} Live Class`,
        subject: subjectName,
        teacher: cc.teacher_name || null,
        batch: cc.batch_name || 'Live Batch Class',
        batchId: cc.batch_id || '',
        batchSubjectId: cc.batch_subject_id || '',
        chapter: cc.chapter_name || null,
        topic: cc.topic_name || null,
        notes: null,
        sessionType: 'live',
        status,
        classId: cc.class_id,
        roomName: cc.room_name || undefined,
        timetableSlotId: undefined,
        accentColor: theme.accentColor,
        badgeBg: theme.badgeBg,
        badgeText: theme.badgeText,
        isProjected: false,
      });
    }

    // Add scheduled mock tests for this date
    const tests = mockTestsByDate.get(dateStr) || [];
    for (const mt of tests) {
      const subjectName = mt.subject_name || 'Mock Test';
      const theme = getSubjectTheme('mock');
      let startTime = '10:00';
      if (mt.available_from) {
        if (mt.available_from.length === 10 && !mt.available_from.includes('T')) {
          startTime = '10:00';
        } else {
          const startDateTime = new Date(mt.available_from);
          if (!isNaN(startDateTime.getTime())) {
            const startH = String(startDateTime.getHours()).padStart(2, '0');
            const startM = String(startDateTime.getMinutes()).padStart(2, '0');
            startTime = `${startH}:${startM}`;
          }
        }
      }
      const durationMin = mt.duration_minutes || 180;
      const [sh, sm] = startTime.split(':').map(Number);
      const endTotalMins = (isNaN(sh) ? 10 : sh) * 60 + (isNaN(sm) ? 0 : sm) + durationMin;
      const endH = String(Math.floor(endTotalMins / 60) % 24).padStart(2, '0');
      const endM = String(endTotalMins % 60).padStart(2, '0');
      const endTime = `${endH}:${endM}`;

      results.push({
        id: `test_${mt.test_id}_${dateStr}`,
        date: dateStr,
        startTime,
        endTime,
        timeSlot: buildTimeSlotString(startTime, endTime),
        duration: `${durationMin} mins`,
        durationMin,
        title: mt.title || 'Scheduled Mock Test',
        subject: subjectName,
        teacher: null,
        batch: 'Assigned Batch',
        batchId: mt.batch_id || '',
        batchSubjectId: mt.batch_subject_id || '',
        chapter: null,
        topic: null,
        notes: null,
        sessionType: 'test',
        status: calculateSessionStatus(dateStr, startTime, endTime, undefined, now),
        testId: mt.test_id,
        accentColor: theme.accentColor,
        badgeBg: theme.badgeBg,
        badgeText: theme.badgeText,
        isProjected: false,
      });
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  // Sort by date ascending, then start_time ascending
  results.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.startTime.localeCompare(b.startTime);
  });

  return results;
}

/**
 * Group sessions by YYYY-MM-DD date string
 */
export function groupSessionsByDate(sessions: TimetableSessionItem[]): Record<string, TimetableSessionItem[]> {
  const grouped: Record<string, TimetableSessionItem[]> = {};
  for (const s of sessions) {
    if (!grouped[s.date]) {
      grouped[s.date] = [];
    }
    grouped[s.date].push(s);
  }
  return grouped;
}
