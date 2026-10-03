import { describe, it, expect, vi } from 'vitest';
import type { TimetableSlot } from '@/types/timetable';
import { getTimetableSlots } from '../timetableAdminService';

// Helper matching AdminTimetablePage slotsByDay logic
function projectAdminCalendarWeek(
  slots: TimetableSlot[],
  weekDates: Date[],
): Map<number, TimetableSlot[]> {
  const map = new Map<number, TimetableSlot[]>();

  for (let i = 0; i < 7; i++) {
    const dayDate = weekDates[i];
    const y = dayDate.getFullYear();
    const m = `${dayDate.getMonth() + 1}`.padStart(2, '0');
    const d = `${dayDate.getDate()}`.padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;
    const dayNum = i + 1; // 1 = Monday ... 7 = Sunday

    const candidatesOnDate: TimetableSlot[] = [];
    for (const s of slots) {
      if (s.isRecurring === false) {
        if (s.validFrom === dateStr) {
          candidatesOnDate.push(s);
        }
      } else {
        if (
          s.dayOfWeek === dayNum &&
          dateStr >= s.validFrom &&
          dateStr <= s.validUntil
        ) {
          candidatesOnDate.push(s);
        }
      }
    }

    // Apply substitution / override: one-off slot overrides recurring template
    const collisionMap = new Map<string, TimetableSlot>();
    for (const slot of candidatesOnDate) {
      const overrideKey = `${slot.batchSubjectId}_${slot.startTime}_${slot.endTime}`;
      const existing = collisionMap.get(overrideKey);
      if (!existing) {
        collisionMap.set(overrideKey, slot);
      } else {
        if (slot.isRecurring === false && existing.isRecurring !== false) {
          collisionMap.set(overrideKey, slot);
        }
      }
    }

    const finalSlots: TimetableSlot[] = [];
    collisionMap.forEach((slot) => {
      finalSlots.push(slot);
    });
    finalSlots.sort((a, b) => a.startTime.localeCompare(b.startTime));
    map.set(dayNum, finalSlots);
  }

  return map;
}

describe('Admin Timetable - Recurrence & Date-Specific Projection', () => {
  const recurringSlotMondayTeacherA: TimetableSlot = {
    timetableSlotId: 'slot-rec-mon-teacherA',
    instituteId: 'inst-1',
    teacherId: 'teacher-A',
    teacherName: 'Teacher A',
    batchSubjectId: 'bs-physics-morning',
    batchId: 'batch-morning',
    batchName: 'Batch Morning',
    subjectName: 'Physics',
    dayOfWeek: 1, // Monday
    startTime: '10:00:00',
    endTime: '11:00:00',
    validFrom: '2026-04-01',
    validUntil: '2027-03-31',
    status: 'active',
    isRecurring: true,
    createdBy: 'admin-1',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
  };

  const oneOffSlotOct18TeacherB: TimetableSlot = {
    timetableSlotId: 'slot-oneoff-oct18-teacherB',
    instituteId: 'inst-1',
    teacherId: 'teacher-B',
    teacherName: 'Teacher B (Substitute)',
    batchSubjectId: 'bs-physics-morning',
    batchId: 'batch-morning',
    batchName: 'Batch Morning',
    subjectName: 'Physics',
    dayOfWeek: 7, // Sunday
    startTime: '10:00:00',
    endTime: '11:00:00',
    validFrom: '2026-10-18',
    validUntil: '2026-10-18',
    status: 'active',
    isRecurring: false,
    createdBy: 'admin-1',
    createdAt: '2026-10-18T00:00:00Z',
    updatedAt: '2026-10-18T00:00:00Z',
  };

  const recurringSundaySlotTeacherA: TimetableSlot = {
    timetableSlotId: 'slot-rec-sun-teacherA',
    instituteId: 'inst-1',
    teacherId: 'teacher-A',
    teacherName: 'Teacher A',
    batchSubjectId: 'bs-physics-morning',
    batchId: 'batch-morning',
    batchName: 'Batch Morning',
    subjectName: 'Physics',
    dayOfWeek: 7, // Sunday
    startTime: '10:00:00',
    endTime: '11:00:00',
    validFrom: '2026-04-01',
    validUntil: '2027-03-31',
    status: 'active',
    isRecurring: true,
    createdBy: 'admin-1',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
  };

  // Sep 21 - Sep 27, 2026
  const weekSep21_27 = [
    new Date(2026, 8, 21), // Mon Sep 21
    new Date(2026, 8, 22),
    new Date(2026, 8, 23),
    new Date(2026, 8, 24),
    new Date(2026, 8, 25),
    new Date(2026, 8, 26),
    new Date(2026, 8, 27), // Sun Sep 27
  ];

  // Oct 12 - Oct 18, 2026
  const weekOct12_18 = [
    new Date(2026, 9, 12), // Mon Oct 12
    new Date(2026, 9, 13),
    new Date(2026, 9, 14),
    new Date(2026, 9, 15),
    new Date(2026, 9, 16),
    new Date(2026, 9, 17),
    new Date(2026, 9, 18), // Sun Oct 18
  ];

  // Oct 19 - Oct 25, 2026
  const weekOct19_25 = [
    new Date(2026, 9, 19), // Mon Oct 19
    new Date(2026, 9, 20),
    new Date(2026, 9, 21),
    new Date(2026, 9, 22),
    new Date(2026, 9, 23),
    new Date(2026, 9, 24),
    new Date(2026, 9, 25), // Sun Oct 25
  ];

  it('Test 1: One-off Excel row (Oct 18 Physics 10-11) appears only on Oct 18', () => {
    const calendar = projectAdminCalendarWeek([oneOffSlotOct18TeacherB], weekOct12_18);
    const sundaySlots = calendar.get(7) ?? [];
    expect(sundaySlots).toHaveLength(1);
    expect(sundaySlots[0].timetableSlotId).toBe('slot-oneoff-oct18-teacherB');
    expect(sundaySlots[0].teacherName).toBe('Teacher B (Substitute)');

    // Other days in the week must have 0 slots
    expect(calendar.get(1)).toHaveLength(0); // Mon
    expect(calendar.get(2)).toHaveLength(0); // Tue
  });

  it('Test 2: Current week Sep 21-27 does NOT show Oct 18 one-off class', () => {
    const calendar = projectAdminCalendarWeek([oneOffSlotOct18TeacherB], weekSep21_27);
    for (let day = 1; day <= 7; day++) {
      expect(calendar.get(day)).toHaveLength(0);
    }
  });

  it('Test 3: Navigating to week Oct 12-18 shows Oct 18 on Sunday', () => {
    const calendar = projectAdminCalendarWeek([oneOffSlotOct18TeacherB], weekOct12_18);
    const sunSlots = calendar.get(7) ?? [];
    expect(sunSlots).toHaveLength(1);
    expect(sunSlots[0].validFrom).toBe('2026-10-18');
  });

  it('Test 4: Recurring Monday class continues appearing every valid Monday', () => {
    const calSep = projectAdminCalendarWeek([recurringSlotMondayTeacherA], weekSep21_27);
    expect(calSep.get(1)).toHaveLength(1);
    expect(calSep.get(1)![0].teacherName).toBe('Teacher A');

    const calOct = projectAdminCalendarWeek([recurringSlotMondayTeacherA], weekOct12_18);
    expect(calOct.get(1)).toHaveLength(1);
    expect(calOct.get(1)![0].teacherName).toBe('Teacher A');
  });

  it('Test 5: Substitution on Oct 18 - one-off Teacher B overrides recurring Teacher A on Oct 18 only', () => {
    // Week of Oct 18
    const calOct18 = projectAdminCalendarWeek(
      [recurringSundaySlotTeacherA, oneOffSlotOct18TeacherB],
      weekOct12_18,
    );
    const sunOct18 = calOct18.get(7) ?? [];
    expect(sunOct18).toHaveLength(1);
    expect(sunOct18[0].teacherId).toBe('teacher-B');
    expect(sunOct18[0].isRecurring).toBe(false);

    // Week of Oct 25 - Teacher A regular recurring class is preserved
    const calOct25 = projectAdminCalendarWeek(
      [recurringSundaySlotTeacherA, oneOffSlotOct18TeacherB],
      weekOct19_25,
    );
    const sunOct25 = calOct25.get(7) ?? [];
    expect(sunOct25).toHaveLength(1);
    expect(sunOct25[0].teacherId).toBe('teacher-A');
    expect(sunOct25[0].isRecurring).toBe(true);
  });

  it('Test 6: Multiple one-off classes on the same date for different subjects appear together', () => {
    const oneOffChemistry: TimetableSlot = {
      ...oneOffSlotOct18TeacherB,
      timetableSlotId: 'slot-oneoff-chem',
      batchSubjectId: 'bs-chemistry-morning',
      subjectName: 'Chemistry',
      startTime: '11:30:00',
      endTime: '12:30:00',
    };

    const calendar = projectAdminCalendarWeek(
      [oneOffSlotOct18TeacherB, oneOffChemistry],
      weekOct12_18,
    );
    const sunSlots = calendar.get(7) ?? [];
    expect(sunSlots).toHaveLength(2);
    expect(sunSlots[0].subjectName).toBe('Physics');
    expect(sunSlots[1].subjectName).toBe('Chemistry');
  });
});
