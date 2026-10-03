import { describe, it, expect } from 'vitest';
import {
  projectSlotsForDateRange,
  RawTimetableSlot,
  RawLessonPlan,
  RawConcreteClass,
  RawMockTestAssignment,
} from '../studentTimetableProjector';

describe('studentTimetableProjector — Acceptance Tests A to J', () => {
  const recurringSlotMonTeacherA: RawTimetableSlot = {
    timetable_slot_id: 'slot-rec-mon-a',
    institute_id: 'inst-1',
    teacher_id: 'teacher-a',
    teacher_name: 'Teacher A',
    batch_subject_id: 'bs-phy-batchA',
    subject_name: 'Physics',
    batch_name: 'Batch A',
    batch_id: 'batch-a',
    day_of_week: 1, // Monday
    start_time: '10:00:00',
    end_time: '11:00:00',
    valid_from: '2026-04-01',
    valid_until: '2027-03-31',
    is_recurring: true,
    status: 'active',
  };

  const oneOffSlotOct18TeacherB: RawTimetableSlot = {
    timetable_slot_id: 'slot-oneoff-oct18-b',
    institute_id: 'inst-1',
    teacher_id: 'teacher-b',
    teacher_name: 'Teacher B',
    batch_subject_id: 'bs-phy-batchA',
    subject_name: 'Physics',
    batch_name: 'Batch A',
    batch_id: 'batch-a',
    day_of_week: 7, // 2026-10-18 is Sunday (isodow 7)
    start_time: '10:00:00',
    end_time: '11:00:00',
    valid_from: '2026-10-18',
    valid_until: '2026-10-18',
    is_recurring: false,
    status: 'active',
  };

  it('Test Case A & B: One-off slot appears ONLY on valid_from date (Oct 18) and NOT on Oct 25', () => {
    // Project for Oct 18 (Sunday)
    const sessionsOct18 = projectSlotsForDateRange({
      slots: [oneOffSlotOct18TeacherB],
      lessonPlans: [],
      concreteClasses: [],
      mockTests: [],
      startDate: '2026-10-18',
      endDate: '2026-10-18',
    });
    expect(sessionsOct18).toHaveLength(1);
    expect(sessionsOct18[0].date).toBe('2026-10-18');
    expect(sessionsOct18[0].subject).toBe('Physics');

    // Project for Oct 25 (Sunday)
    const sessionsOct25 = projectSlotsForDateRange({
      slots: [oneOffSlotOct18TeacherB],
      lessonPlans: [],
      concreteClasses: [],
      mockTests: [],
      startDate: '2026-10-25',
      endDate: '2026-10-25',
    });
    expect(sessionsOct25).toHaveLength(0);
  });

  it('Test Case C: Recurring slot appears on matching weekday within validity range and not outside', () => {
    // 2026-10-19 is Monday
    const sessionsMon = projectSlotsForDateRange({
      slots: [recurringSlotMonTeacherA],
      lessonPlans: [],
      concreteClasses: [],
      mockTests: [],
      startDate: '2026-10-19',
      endDate: '2026-10-19',
    });
    expect(sessionsMon).toHaveLength(1);
    expect(sessionsMon[0].date).toBe('2026-10-19');
    expect(sessionsMon[0].teacher).toBe('Teacher A');

    // 2026-10-20 is Tuesday -> 0 sessions
    const sessionsTue = projectSlotsForDateRange({
      slots: [recurringSlotMonTeacherA],
      lessonPlans: [],
      concreteClasses: [],
      mockTests: [],
      startDate: '2026-10-20',
      endDate: '2026-10-20',
    });
    expect(sessionsTue).toHaveLength(0);

    // 2027-05-03 is Monday but after valid_until (2027-03-31) -> 0 sessions
    const sessionsAfterTerm = projectSlotsForDateRange({
      slots: [recurringSlotMonTeacherA],
      lessonPlans: [],
      concreteClasses: [],
      mockTests: [],
      startDate: '2027-05-03',
      endDate: '2027-05-03',
    });
    expect(sessionsAfterTerm).toHaveLength(0);
  });

  it('Test Case D & E: One-off substitution overrides recurring slot on collision date; recurring continues on other dates', () => {
    // Sunday recurring Physics slot for Teacher A
    const recurringSundaySlotTeacherA: RawTimetableSlot = {
      ...recurringSlotMonTeacherA,
      timetable_slot_id: 'slot-rec-sun-a',
      day_of_week: 7, // Sunday
    };

    // Date Oct 18: both recurring (Teacher A) and one-off (Teacher B) are candidate active slots
    const sessionsOct18 = projectSlotsForDateRange({
      slots: [recurringSundaySlotTeacherA, oneOffSlotOct18TeacherB],
      lessonPlans: [],
      concreteClasses: [],
      mockTests: [],
      startDate: '2026-10-18',
      endDate: '2026-10-18',
    });
    // Exactly ONE class on Oct 18, taught by Teacher B
    expect(sessionsOct18).toHaveLength(1);
    expect(sessionsOct18[0].timetableSlotId).toBe('slot-oneoff-oct18-b');
    expect(sessionsOct18[0].teacher).toBe('Teacher B');

    // Date Oct 25 (Next Sunday): only recurring Teacher A remains
    const sessionsOct25 = projectSlotsForDateRange({
      slots: [recurringSundaySlotTeacherA, oneOffSlotOct18TeacherB],
      lessonPlans: [],
      concreteClasses: [],
      mockTests: [],
      startDate: '2026-10-25',
      endDate: '2026-10-25',
    });
    expect(sessionsOct25).toHaveLength(1);
    expect(sessionsOct25[0].timetableSlotId).toBe('slot-rec-sun-a');
    expect(sessionsOct25[0].teacher).toBe('Teacher A');
  });

  it('Test Case F: Different batches at the same time remain separate', () => {
    const slotBatchB: RawTimetableSlot = {
      ...oneOffSlotOct18TeacherB,
      timetable_slot_id: 'slot-oneoff-oct18-batchB',
      batch_subject_id: 'bs-phy-batchB',
      batch_name: 'Batch B',
      batch_id: 'batch-b',
    };

    const sessions = projectSlotsForDateRange({
      slots: [oneOffSlotOct18TeacherB, slotBatchB],
      lessonPlans: [],
      concreteClasses: [],
      mockTests: [],
      startDate: '2026-10-18',
      endDate: '2026-10-18',
    });
    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => s.batch)).toEqual(['Batch A', 'Batch B']);
  });

  it('Test Case G: Different subjects at the same time remain separate', () => {
    const slotChemistry: RawTimetableSlot = {
      ...oneOffSlotOct18TeacherB,
      timetable_slot_id: 'slot-oneoff-oct18-chem',
      batch_subject_id: 'bs-chem-batchA',
      subject_name: 'Chemistry',
    };

    const sessions = projectSlotsForDateRange({
      slots: [oneOffSlotOct18TeacherB, slotChemistry],
      lessonPlans: [],
      concreteClasses: [],
      mockTests: [],
      startDate: '2026-10-18',
      endDate: '2026-10-18',
    });
    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => s.subject)).toEqual(['Physics', 'Chemistry']);
  });

  it('Test Case H: Overnight class (23:30 -> 00:30) is associated with its start date', () => {
    const overnightSlot: RawTimetableSlot = {
      ...oneOffSlotOct18TeacherB,
      timetable_slot_id: 'slot-overnight',
      start_time: '23:30:00',
      end_time: '00:30:00',
      valid_from: '2026-10-18',
      valid_until: '2026-10-18',
    };

    const sessions = projectSlotsForDateRange({
      slots: [overnightSlot],
      lessonPlans: [],
      concreteClasses: [],
      mockTests: [],
      startDate: '2026-10-18',
      endDate: '2026-10-19',
    });
    // Appears on Oct 18 (start date)
    expect(sessions).toHaveLength(1);
    expect(sessions[0].date).toBe('2026-10-18');
    expect(sessions[0].timeSlot).toBe('11:30 PM - 12:30 AM');
    expect(sessions[0].duration).toBe('60 mins');
  });
});
