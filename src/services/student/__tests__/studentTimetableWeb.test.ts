import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  projectSlotsForDateRange,
  calculateSessionStatus,
  getSubjectTheme,
  getAcademicYearInfo,
  getAcademicYearMonths,
  getWeekDaysForDate,
  formatDateToIsoDate,
  buildTimeSlotString,
  groupSessionsByDate,
  type RawTimetableSlot,
  type RawLessonPlan,
  type RawConcreteClass,
  type RawMockTestAssignment,
} from '@/utils/studentTimetableProjector';

describe('studentTimetableProjector — Unified Projection Engine', () => {
  const fixedNow = new Date('2026-09-16T10:15:00Z'); // Wednesday, 10:15

  const sampleSlots: RawTimetableSlot[] = [
    {
      timetable_slot_id: 'slot-phy-mon',
      institute_id: 'inst-1',
      teacher_id: 'teach-1',
      teacher_name: 'Dr. HC Verma',
      batch_subject_id: 'bs-phy',
      batch_name: 'NEET 2026 Batch A',
      batch_id: 'batch-1',
      subject_name: 'Physics',
      day_of_week: 1, // Monday
      start_time: '10:00:00',
      end_time: '11:30:00',
      valid_from: '2026-04-01',
      valid_until: '2027-03-31',
      status: 'active',
    },
    {
      timetable_slot_id: 'slot-chem-wed',
      institute_id: 'inst-1',
      teacher_id: 'teach-2',
      teacher_name: 'Prof. Mukherjee',
      batch_subject_id: 'bs-chem',
      batch_name: 'NEET 2026 Batch A',
      batch_id: 'batch-1',
      subject_name: 'Chemistry',
      day_of_week: 3, // Wednesday
      start_time: '10:00:00',
      end_time: '11:00:00',
      valid_from: '2026-04-01',
      valid_until: '2027-03-31',
      status: 'active',
    },
    {
      timetable_slot_id: 'slot-bio-fri',
      institute_id: 'inst-1',
      teacher_id: 'teach-3',
      teacher_name: 'Dr. Sharma',
      batch_subject_id: 'bs-bio',
      batch_name: 'NEET 2026 Batch A',
      batch_id: 'batch-1',
      subject_name: 'Biology',
      day_of_week: 5, // Friday
      start_time: '14:00:00',
      end_time: '15:30:00',
      valid_from: '2026-04-01',
      valid_until: '2027-03-31',
      status: 'active',
    },
  ];

  const sampleLessonPlans: RawLessonPlan[] = [
    {
      lesson_plan_id: 'lp-1',
      timetable_slot_id: 'slot-chem-wed',
      occurrence_date: '2026-09-16',
      chapter_id: 'chap-1',
      chapter_name: 'Chemical Bonding',
      topic_id: 'top-1',
      topic_name: 'Hybridization & VSEPR',
      notes: 'Bring NCERT textbook',
    },
  ];

  const sampleConcreteClasses: RawConcreteClass[] = [
    {
      class_id: 'live-class-123',
      title: 'Chemistry Live - Hybridization',
      scheduled_at: '2026-09-16T10:00:00Z',
      duration_min: 60,
      status: 'live',
      room_name: 'room_neet_chem_101',
      timetable_slot_id: 'slot-chem-wed',
      teacher_name: 'Prof. Mukherjee',
      subject_name: 'Chemistry',
      batch_name: 'NEET 2026 Batch A',
      batch_id: 'batch-1',
      batch_subject_id: 'bs-chem',
      chapter_name: 'Chemical Bonding',
      topic_name: 'Hybridization & VSEPR',
    },
  ];

  const sampleMockTests: RawMockTestAssignment[] = [
    {
      assignment_id: 'assign-1',
      test_id: 'test-grand-1',
      available_from: '2026-09-20T09:00:00Z', // Sunday
      available_until: '2026-09-20T18:00:00Z',
      title: 'Grand Mock Test 1 - NEET Pattern',
      subject_name: 'Full Syllabus',
      duration_minutes: 180,
      total_marks: 720,
    },
  ];

  it('projects recurring slots across a week date range', () => {
    const sessions = projectSlotsForDateRange({
      slots: sampleSlots,
      startDate: '2026-09-14', // Monday
      endDate: '2026-09-20',   // Sunday
      now: fixedNow,
    });

    expect(sessions.length).toBe(3);
    expect(sessions[0].subject).toBe('Physics');
    expect(sessions[0].date).toBe('2026-09-14');
    expect(sessions[1].subject).toBe('Chemistry');
    expect(sessions[1].date).toBe('2026-09-16');
    expect(sessions[2].subject).toBe('Biology');
    expect(sessions[2].date).toBe('2026-09-18');
  });

  it('merges lesson plans and concrete live class occurrences accurately', () => {
    const sessions = projectSlotsForDateRange({
      slots: sampleSlots,
      lessonPlans: sampleLessonPlans,
      concreteClasses: sampleConcreteClasses,
      startDate: '2026-09-16',
      endDate: '2026-09-16',
      now: fixedNow,
    });

    expect(sessions.length).toBe(1);
    const chemSession = sessions[0];
    expect(chemSession.subject).toBe('Chemistry');
    expect(chemSession.chapter).toBe('Chemical Bonding');
    expect(chemSession.topic).toBe('Hybridization & VSEPR');
    expect(chemSession.status).toBe('live');
    expect(chemSession.roomName).toBe('room_neet_chem_101');
    expect(chemSession.classId).toBe('live-class-123');
    expect(chemSession.isProjected).toBe(false);
  });

  it('includes scheduled mock tests on their target availability date', () => {
    const sessions = projectSlotsForDateRange({
      slots: sampleSlots,
      mockTests: sampleMockTests,
      startDate: '2026-09-20',
      endDate: '2026-09-20',
      now: fixedNow,
    });

    expect(sessions.length).toBe(1);
    const testSession = sessions[0];
    expect(testSession.sessionType).toBe('test');
    expect(testSession.testId).toBe('test-grand-1');
    expect(testSession.title).toBe('Grand Mock Test 1 - NEET Pattern');
  });

  it('respects slot valid_from and valid_until boundaries for annual timetable', () => {
    const restrictedSlots: RawTimetableSlot[] = [
      {
        timetable_slot_id: 'slot-apr-jun-only',
        institute_id: 'inst-1',
        teacher_id: 'teach-1',
        batch_subject_id: 'bs-1',
        day_of_week: 1, // Mon
        start_time: '10:00:00',
        end_time: '11:00:00',
        valid_from: '2026-04-01',
        valid_until: '2026-06-30',
        status: 'active',
        subject_name: 'Physics',
      },
    ];

    // Check July 2026
    const julySessions = projectSlotsForDateRange({
      slots: restrictedSlots,
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      now: fixedNow,
    });

    expect(julySessions.length).toBe(0);

    // Check May 2026
    const maySessions = projectSlotsForDateRange({
      slots: restrictedSlots,
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      now: fixedNow,
    });

    expect(maySessions.length).toBe(4); // 4 Mondays in May 2026
  });

  it('correctly calculates academic year boundaries (April 1 to March 31)', () => {
    const sepDate = new Date('2026-09-16');
    const sepAy = getAcademicYearInfo(sepDate);
    expect(sepAy.startYear).toBe(2026);
    expect(sepAy.endYear).toBe(2027);
    expect(sepAy.startDate).toBe('2026-04-01');
    expect(sepAy.endDate).toBe('2027-03-31');
    expect(sepAy.label).toBe('2026–2027');

    const febDate = new Date('2027-02-15');
    const febAy = getAcademicYearInfo(febDate);
    expect(febAy.startYear).toBe(2026);
    expect(febAy.endYear).toBe(2027);
  });

  it('generates 12 academic year months in proper April -> March sequence', () => {
    const months = getAcademicYearMonths(2026);
    expect(months.length).toBe(12);
    expect(months[0].shortName).toBe('Apr');
    expect(months[0].year).toBe(2026);
    expect(months[11].shortName).toBe('Mar');
    expect(months[11].year).toBe(2027);
  });

  it('calculates dynamic status for today, past, and future sessions', () => {
    const todayStr = '2026-09-16';
    const pastStr = '2026-09-10';
    const futureStr = '2026-09-25';

    // Past date -> completed
    expect(calculateSessionStatus(pastStr, '10:00', '11:00', undefined, fixedNow)).toBe('completed');

    // Future date -> scheduled
    expect(calculateSessionStatus(futureStr, '10:00', '11:00', undefined, fixedNow)).toBe('scheduled');

    // Explicit live status
    expect(calculateSessionStatus(todayStr, '10:00', '11:00', 'live', fixedNow)).toBe('live');

    // Explicit completed status
    expect(calculateSessionStatus(todayStr, '10:00', '11:00', 'completed', fixedNow)).toBe('completed');
  });

  it('maps subject color themes consistently across all disciplines', () => {
    expect(getSubjectTheme('Physics').accentColor).toBe('#D97706');
    expect(getSubjectTheme('Chemistry').accentColor).toBe('#059669');
    expect(getSubjectTheme('Biology').accentColor).toBe('#E11D48');
    expect(getSubjectTheme('Mathematics').accentColor).toBe('#2563EB');
    expect(getSubjectTheme('NEET Mock Test').accentColor).toBe('#DC2626');
  });

  it('groups sessions by date into a dictionary', () => {
    const sessions = projectSlotsForDateRange({
      slots: sampleSlots,
      startDate: '2026-09-14',
      endDate: '2026-09-20',
      now: fixedNow,
    });

    const grouped = groupSessionsByDate(sessions);
    expect(grouped['2026-09-14'].length).toBe(1);
    expect(grouped['2026-09-16'].length).toBe(1);
    expect(grouped['2026-09-18'].length).toBe(1);
    expect(grouped['2026-09-15']).toBeUndefined();
  });
  describe('IST Local Date Correctness for Concrete Sessions', () => {
    it('correctly maps 04:00 AM IST concrete class to the correct calendar day', () => {
      // 04:00 AM IST on Sept 17 = 2026-09-16T22:30:00Z
      const earlyMorningClass: RawConcreteClass = {
        class_id: 'live-early-4am',
        title: 'Early Morning Physics',
        scheduled_at: '2026-09-16T22:30:00Z',
        duration_min: 60,
        status: 'scheduled',
        subject_name: 'Physics',
      };

      const sessions = projectSlotsForDateRange({
        slots: [],
        concreteClasses: [earlyMorningClass],
        startDate: '2026-09-17',
        endDate: '2026-09-17',
        now: fixedNow,
      });

      expect(sessions.length).toBe(1);
      expect(sessions[0].date).toBe('2026-09-17');
      expect(sessions[0].title).toBe('Early Morning Physics');
      expect(sessions[0].startTime).toBe('04:00');
    });

    it('correctly maps 06:00 AM IST concrete class to the correct calendar day', () => {
      // 06:00 AM IST on Sept 17 = 2026-09-17T00:30:00Z
      const morningClass: RawConcreteClass = {
        class_id: 'live-morning-6am',
        title: 'Morning Chemistry',
        scheduled_at: '2026-09-17T00:30:00Z',
        duration_min: 60,
        status: 'scheduled',
        subject_name: 'Chemistry',
      };

      const sessions = projectSlotsForDateRange({
        slots: [],
        concreteClasses: [morningClass],
        startDate: '2026-09-17',
        endDate: '2026-09-17',
        now: fixedNow,
      });

      expect(sessions.length).toBe(1);
      expect(sessions[0].date).toBe('2026-09-17');
      expect(sessions[0].startTime).toBe('06:00');
    });

    it('correctly maps 11:59 PM IST concrete class to the correct calendar day', () => {
      // 11:59 PM IST on Sept 17 = 2026-09-17T18:29:00Z
      const lateNightClass: RawConcreteClass = {
        class_id: 'live-night-1159pm',
        title: 'Late Night Doubt Clearing',
        scheduled_at: '2026-09-17T18:29:00Z',
        duration_min: 60,
        status: 'scheduled',
        subject_name: 'Physics',
      };

      const sessions = projectSlotsForDateRange({
        slots: [],
        concreteClasses: [lateNightClass],
        startDate: '2026-09-17',
        endDate: '2026-09-17',
        now: fixedNow,
      });

      expect(sessions.length).toBe(1);
      expect(sessions[0].date).toBe('2026-09-17');
      expect(sessions[0].startTime).toBe('23:59');
    });

    it('correctly maps 12:00 AM IST (midnight) concrete class to the correct calendar day', () => {
      // 12:00 AM IST on Sept 17 = 2026-09-16T18:30:00Z
      const midnightClass: RawConcreteClass = {
        class_id: 'live-midnight-12am',
        title: 'Midnight Revision',
        scheduled_at: '2026-09-16T18:30:00Z',
        duration_min: 60,
        status: 'scheduled',
        subject_name: 'Mathematics',
      };

      const sessions = projectSlotsForDateRange({
        slots: [],
        concreteClasses: [midnightClass],
        startDate: '2026-09-17',
        endDate: '2026-09-17',
        now: fixedNow,
      });

      expect(sessions.length).toBe(1);
      expect(sessions[0].date).toBe('2026-09-17');
      expect(sessions[0].startTime).toBe('00:00');
    });

    it('preserves normal daytime class unchanged', () => {
      // 10:00 AM IST on Sept 17 = 2026-09-17T04:30:00Z
      const daytimeClass: RawConcreteClass = {
        class_id: 'live-day-10am',
        title: 'Daytime Biology',
        scheduled_at: '2026-09-17T04:30:00Z',
        duration_min: 90,
        status: 'scheduled',
        subject_name: 'Biology',
      };

      const sessions = projectSlotsForDateRange({
        slots: [],
        concreteClasses: [daytimeClass],
        startDate: '2026-09-17',
        endDate: '2026-09-17',
        now: fixedNow,
      });

      expect(sessions.length).toBe(1);
      expect(sessions[0].date).toBe('2026-09-17');
      expect(sessions[0].startTime).toBe('10:00');
      expect(sessions[0].durationMin).toBe(90);
    });

    it('handles academic-year boundary dates correctly (2026-04-01 and 2027-03-31)', () => {
      // 04:00 AM IST on 2026-04-01 = 2026-03-31T22:30:00Z
      const startAyClass: RawConcreteClass = {
        class_id: 'live-ay-start',
        title: 'Orientation Lecture',
        scheduled_at: '2026-03-31T22:30:00Z',
        duration_min: 60,
        status: 'scheduled',
        subject_name: 'Physics',
      };

      // 11:59 PM IST on 2027-03-31 = 2027-03-31T18:29:00Z
      const endAyClass: RawConcreteClass = {
        class_id: 'live-ay-end',
        title: 'Final Academic Concluding Class',
        scheduled_at: '2027-03-31T18:29:00Z',
        duration_min: 60,
        status: 'scheduled',
        subject_name: 'Chemistry',
      };

      const startSessions = projectSlotsForDateRange({
        slots: [],
        concreteClasses: [startAyClass],
        startDate: '2026-04-01',
        endDate: '2026-04-01',
        now: fixedNow,
      });
      expect(startSessions.length).toBe(1);
      expect(startSessions[0].date).toBe('2026-04-01');

      const endSessions = projectSlotsForDateRange({
        slots: [],
        concreteClasses: [endAyClass],
        startDate: '2027-03-31',
        endDate: '2027-03-31',
        now: fixedNow,
      });
      expect(endSessions.length).toBe(1);
      expect(endSessions[0].date).toBe('2027-03-31');
    });

    it('correctly maps scheduled mock test with 04:00 AM IST availability to target date', () => {
      // 04:00 AM IST on Sept 20 = 2026-09-19T22:30:00Z
      const earlyTest: RawMockTestAssignment = {
        assignment_id: 'asgn-early',
        test_id: 'test-real-123',
        available_from: '2026-09-19T22:30:00Z',
        title: 'Real Scheduled Mock Test 100 Qs',
        subject_name: 'Physics',
        duration_minutes: 120,
        total_marks: 400,
      };

      const sessions = projectSlotsForDateRange({
        slots: [],
        mockTests: [earlyTest],
        startDate: '2026-09-20',
        endDate: '2026-09-20',
        now: fixedNow,
      });

      expect(sessions.length).toBe(1);
      const s = sessions[0];
      expect(s.sessionType).toBe('test');
      expect(s.testId).toBe('test-real-123');
      expect(s.date).toBe('2026-09-20');
      expect(s.startTime).toBe('04:00');
      expect(s.durationMin).toBe(120);
      expect(s.title).toBe('Real Scheduled Mock Test 100 Qs');
    });
  });
});
