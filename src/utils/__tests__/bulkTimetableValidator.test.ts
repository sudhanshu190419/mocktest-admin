/**
 * Bulk Timetable Import — Validator unit tests.
 *
 * Covers the resolution/validation/grouping/conflict/preview/payload cases
 * of the 40-case matrix (tests 7–28, 37, 39–40).
 */

import { describe, it, expect } from 'vitest';
import {
  buildImportPreview,
  buildImportPayload,
  hasBlockingErrors,
  parseSpreadsheetDate,
  parseSpreadsheetTime,
  isoDowOf,
} from '@/utils/bulkTimetableValidator';
import { FIXTURE, makeRawRow, makeReference } from './bulkImportTestHelpers';

/** Shortcut: build a preview from a single row (default = valid Kinematics row). */
function previewFor(...rows: ReturnType<typeof makeRawRow>[]) {
  return buildImportPreview({ rows, reference: makeReference() });
}

describe('date/time parsing', () => {
  it('parses YYYY-MM-DD, DD-MMM-YY, DD-MMM-YYYY, DD/MM/YYYY, serials (TEST 17)', () => {
    expect(parseSpreadsheetDate('2026-08-10')).toBe('2026-08-10');
    expect(parseSpreadsheetDate('10-Aug-26')).toBe('2026-08-10');
    expect(parseSpreadsheetDate('10-Aug-2026')).toBe('2026-08-10');
    expect(parseSpreadsheetDate('10/08/2026')).toBe('2026-08-10');
    expect(parseSpreadsheetDate(46244)).toBe('2026-08-10');
    expect(parseSpreadsheetDate('not a date')).toBeNull();
    expect(parseSpreadsheetDate('2026-13-01')).toBeNull();
    expect(parseSpreadsheetDate('')).toBeNull();
  });

  it('parses 24h/12h times and rejects invalid ones (TEST 18)', () => {
    expect(parseSpreadsheetTime('10:00')).toBe('10:00:00');
    expect(parseSpreadsheetTime('10:00:00')).toBe('10:00:00');
    expect(parseSpreadsheetTime('10:00 AM')).toBe('10:00:00');
    expect(parseSpreadsheetTime('10:00 PM')).toBe('22:00:00');
    expect(parseSpreadsheetTime('22:00')).toBe('22:00:00');
    expect(parseSpreadsheetTime(0.4166666666666667)).toBe('10:00:00');
    expect(parseSpreadsheetTime('25:00')).toBeNull();
    expect(parseSpreadsheetTime('')).toBeNull();
  });

  it('computes isodow correctly (1=Monday … 7=Sunday)', () => {
    expect(isoDowOf('2026-08-10')).toBe(1); // Monday
    expect(isoDowOf('2026-08-16')).toBe(7); // Sunday
  });
});

describe('row resolution', () => {
  it('resolves a fully valid row (TEST 24 basis)', () => {
    const preview = previewFor(makeRawRow());
    expect(preview.issues).toHaveLength(0);
    const row = preview.rows[0];
    expect(row.teacherId).toBe(FIXTURE.teacherRahul);
    expect(row.batchId).toBe(FIXTURE.batchJeeA);
    expect(row.subjectId).toBe(FIXTURE.subjectPhy);
    expect(row.batchSubjectId).toBe(FIXTURE.bsPhyJeeA);
    expect(row.chapterId).toBe(FIXTURE.chapterKinematics);
    expect(row.topicId).toBe(FIXTURE.topicLawsOfMotion);
    expect(hasBlockingErrors(preview)).toBe(false);
  });

  it('errors when the teacher mobile does not exist (TEST 7)', () => {
    const preview = previewFor(makeRawRow({ teacherMobile: '9999999999' }));
    expect(preview.rows[0].issues.some((i) => i.severity === 'error' && /not found in this institute/i.test(i.problem))).toBe(true);
    expect(preview.rows[0].teacherId).toBeNull();
    expect(hasBlockingErrors(preview)).toBe(true);
  });

  it('errors when the teacher mobile is blank', () => {
    const preview = previewFor(makeRawRow({ teacherMobile: '' }));
    expect(preview.rows[0].issues.some((i) => /Teacher Mobile is required/i.test(i.problem))).toBe(true);
  });

  it('treats placeholder backfill mobiles (91000000NNNN) as not found — never resolvable', () => {
    const reference = makeReference({
      teachers: [
        ...makeReference().teachers,
        {
          teacherId: 'ph-teacher-1',
          profileId: 'ph-profile-1',
          email: 'placeholder@test.com',
          phone: '910000000001', // migration 024/025 fake backfill
          name: 'Placeholder Teacher',
          instituteId: FIXTURE.institute,
        },
      ],
    });
    // Full 12-digit placeholder digits must NOT resolve.
    const full = buildImportPreview({
      rows: [makeRawRow({ teacherMobile: '910000000001' })],
      reference,
    });
    expect(full.rows[0].teacherId).toBeNull();
    expect(full.rows[0].issues.some((i) => /was not found in this institute/i.test(i.problem))).toBe(true);
    // The 10-digit national key derived from the placeholder must NOT resolve either.
    const national = buildImportPreview({
      rows: [makeRawRow({ teacherMobile: '1000000001' })],
      reference,
    });
    expect(national.rows[0].teacherId).toBeNull();
    expect(national.rows[0].issues.some((i) => /was not found in this institute/i.test(i.problem))).toBe(true);
  });

  it('errors when the batch does not exist (TEST 9)', () => {
    const preview = previewFor(makeRawRow({ batchCode: 'ZZZ' }));
    expect(preview.rows[0].issues.some((i) => /not found in your institute/i.test(i.problem))).toBe(true);
    expect(preview.rows[0].batchId).toBeNull();
  });

  it('warns (not errors) for a non-active batch', () => {
    const reference = makeReference({
      batches: [
        { batchId: FIXTURE.batchJeeA, instituteId: FIXTURE.institute, streamId: FIXTURE.streamJee, name: 'JEE Batch A', batchCode: 'JEE-A', status: 'completed' },
      ],
    });
    const preview = buildImportPreview({ rows: [makeRawRow()], reference });
    expect(preview.rows[0].issues.some((i) => i.severity === 'warning' && /completed/i.test(i.problem))).toBe(true);
    expect(hasBlockingErrors(preview)).toBe(false);
  });

  it('errors when the subject does not exist in the batch stream (TEST 10)', () => {
    const preview = previewFor(makeRawRow({ subjectCode: 'BIO' }));
    expect(preview.rows[0].issues.some((i) => /not found in this batch/i.test(i.problem))).toBe(true);
    expect(preview.rows[0].subjectId).toBeNull();
  });

  it('errors when the subject is not taught in that batch (TEST 11 — invalid batch_subject)', () => {
    // MATHS exists in the JEE stream but has no batch_subject in JEE-A.
    const preview = previewFor(makeRawRow({ subjectCode: 'MATHS' }));
    expect(preview.rows[0].issues.some((i) => /not taught in batch/i.test(i.problem))).toBe(true);
    expect(preview.rows[0].batchSubjectId).toBeNull();
  });

  it('errors when the teacher is not assigned to the batch-subject (TEST 9/authorization)', () => {
    // Priya is assigned to CHEM JEE-A, not PHY JEE-A.
    const preview = previewFor(makeRawRow({ teacherMobile: '9876543211' }));
    expect(preview.rows[0].issues.some((i) => /not assigned to/i.test(i.problem))).toBe(true);
    expect(hasBlockingErrors(preview)).toBe(true);
  });

  it('errors when the chapter does not exist under the subject (TEST 12)', () => {
    const preview = previewFor(makeRawRow({ chapter: 'Thermodynamics' }));
    expect(preview.rows[0].issues.some((i) => /was not found under this subject/i.test(i.problem))).toBe(true);
    expect(preview.rows[0].chapterId).toBeNull();
  });

  it('errors when the chapter belongs to a different subject (TEST 13)', () => {
    // "Organic Chemistry" belongs to CHEM — used on a PHY row.
    const preview = previewFor(makeRawRow({ chapter: 'Organic Chemistry' }));
    expect(preview.rows[0].issues.some((i) => /was not found under this subject/i.test(i.problem))).toBe(true);
  });

  it('errors when the topic does not belong to the chapter (TEST 15)', () => {
    const preview = previewFor(makeRawRow({ topic: 'Hydrocarbons' }));
    expect(preview.rows[0].issues.some((i) => /does not belong to the selected chapter/i.test(i.problem))).toBe(true);
    expect(preview.rows[0].topicId).toBeNull();
  });

  it('supports chapter-only lessons with null topic (TEST 16/39)', () => {
    const preview = previewFor(makeRawRow({ topic: '' }));
    expect(hasBlockingErrors(preview)).toBe(false);
    expect(preview.rows[0].topicId).toBeNull();
    const payload = buildImportPayload(preview);
    expect(payload?.plans[0].topic_id).toBeNull();
    expect(payload?.plans[0].chapter_id).toBe(FIXTURE.chapterKinematics);
  });

  it('matches chapter/topic names case-insensitively and whitespace-normalized', () => {
    const preview = previewFor(makeRawRow({ chapter: '  kinematics ', topic: 'LAWS of MOTION' }));
    expect(hasBlockingErrors(preview)).toBe(false);
    expect(preview.rows[0].chapterId).toBe(FIXTURE.chapterKinematics);
    expect(preview.rows[0].topicId).toBe(FIXTURE.topicLawsOfMotion);
  });

  it('errors on start >= end (TEST 19)', () => {
    const preview = previewFor(makeRawRow({ startTime: '11:00', endTime: '10:00' }));
    expect(preview.rows[0].issues.some((i) => /End time must be after start time/i.test(i.problem))).toBe(true);
  });

  it('errors on invalid time values (TEST 18)', () => {
    const preview = previewFor(makeRawRow({ startTime: 'banana' }));
    expect(preview.rows[0].issues.some((i) => /not a valid start time/i.test(i.problem))).toBe(true);
  });
});

describe('grouping + dedupe', () => {
  it('groups 3 dates into ONE slot + 3 plans (TEST 24)', () => {
    const rows = [
      makeRawRow({ date: '2026-08-10' }),
      makeRawRow({ date: '2026-08-17' }),
      makeRawRow({ date: '2026-08-24' }),
    ];
    const preview = previewFor(...rows);
    expect(preview.groups).toHaveLength(1);
    expect(preview.groups[0].lessonCount).toBe(3);
    expect(preview.groups[0].validFrom).toBe('2026-08-10');
    expect(preview.groups[0].validUntil).toBe('2026-08-24');
    expect(preview.summary.plansToCreate).toBe(3);
    expect(preview.summary.slotsToCreate).toBe(1);

    const payload = buildImportPayload(preview);
    expect(payload?.slots).toHaveLength(1);
    expect(payload?.plans).toHaveLength(3);
    expect(new Set(payload?.plans.map((p) => p.slot_key))).toEqual(new Set([payload!.slots[0].key]));
  });

  it('splits different times into different slots (TEST 25)', () => {
    const rows = [
      makeRawRow({ date: '2026-08-10', startTime: '10:00', endTime: '11:00' }),
      makeRawRow({ date: '2026-08-17', startTime: '12:00', endTime: '13:00' }),
    ];
    const preview = previewFor(...rows);
    expect(preview.groups).toHaveLength(2);
  });

  it('splits different teachers into different slots (TEST 26)', () => {
    const reference = makeReference({
      assignments: [
        { batchSubjectId: FIXTURE.bsPhyJeeA, teacherId: FIXTURE.teacherRahul },
        { batchSubjectId: FIXTURE.bsPhyJeeA, teacherId: FIXTURE.teacherPriya },
      ],
    });
    const rows = [
      makeRawRow({ date: '2026-08-10', teacherMobile: '9876543210' }),
      makeRawRow({ date: '2026-08-17', teacherMobile: '9876543211' }),
    ];
    const preview = buildImportPreview({ rows, reference });
    expect(preview.groups).toHaveLength(2);
  });

  it('silently dedupes identical rows (TEST 20)', () => {
    const rows = [
      makeRawRow({ date: '2026-08-10' }),
      makeRawRow({ date: '2026-08-10' }), // identical
    ];
    const preview = previewFor(...rows);
    expect(hasBlockingErrors(preview)).toBe(false);
    // One plan for that date despite two rows.
    expect(preview.summary.plansToCreate).toBe(1);
    expect(preview.rows.some((r) => r.issues.some((i) => i.severity === 'info' && /Duplicate row/i.test(i.problem)))).toBe(true);
  });

  it('blocks conflicting duplicates — same slot+date, different lesson (TEST 21)', () => {
    const rows = [
      makeRawRow({ date: '2026-08-10', chapter: 'Kinematics', topic: 'Laws of Motion' }),
      makeRawRow({ date: '2026-08-10', chapter: 'Kinematics', topic: "Newton's First Law" }),
    ];
    const preview = previewFor(...rows);
    expect(hasBlockingErrors(preview)).toBe(true);
    expect(preview.rows.some((r) => r.issues.some((i) => /Conflicting duplicate/i.test(i.problem)))).toBe(true);
  });

  it('splits different weekdays into different groups (TEST 20 weekday derivation)', () => {
    const rows = [
      makeRawRow({ date: '2026-08-10' }), // Monday
      makeRawRow({ date: '2026-08-12' }), // Wednesday
    ];
    const preview = previewFor(...rows);
    expect(preview.groups).toHaveLength(2);
  });

  it('applies explicit Valid From / Valid Until as overrides (TEST 27)', () => {
    const rows = [
      makeRawRow({ date: '2026-08-10', validFrom: '2026-08-01', validUntil: '2026-08-31' }),
      makeRawRow({ date: '2026-08-17', validFrom: '2026-08-01', validUntil: '2026-08-31' }),
    ];
    const preview = previewFor(...rows);
    expect(preview.groups[0].validFrom).toBe('2026-08-01');
    expect(preview.groups[0].validUntil).toBe('2026-08-31');
  });

  it('errors when a date falls outside the explicit validity (TEST validity)', () => {
    const preview = previewFor(
      makeRawRow({ date: '2026-08-10', validFrom: '2026-09-01', validUntil: '2026-09-30' }),
    );
    expect(hasBlockingErrors(preview)).toBe(true);
    expect(preview.rows[0].issues.some((i) => /outside the timetable validity/i.test(i.problem))).toBe(true);
  });

  it('keeps each class\'s own chapter/topic across multiple dates (TEST 4)', () => {
    const rows = [
      makeRawRow({ date: '2026-08-10', chapter: 'Kinematics', topic: 'Laws of Motion' }),
      makeRawRow({ date: '2026-08-17', chapter: 'Kinematics', topic: "Newton's First Law" }),
    ];
    const preview = previewFor(...rows);
    const payload = buildImportPayload(preview)!;
    const byDate = Object.fromEntries(payload.plans.map((p) => [p.occurrence_date, p.topic_id]));
    expect(byDate['2026-08-10']).toBe(FIXTURE.topicLawsOfMotion);
    expect(byDate['2026-08-17']).toBe(FIXTURE.topicNewtonsFirst);
  });
});

describe('existing-slot classification', () => {
  it('reuses an identical existing slot (TEST reuse)', () => {
    // Existing: Rahul PHY JEE-A Monday 09:00-10:00. Import an identical schedule.
    const preview = previewFor(
      makeRawRow({ date: '2026-08-10', startTime: '09:00', endTime: '10:00' }),
    );
    expect(preview.groups[0].mode).toBe('reuse');
    expect(preview.groups[0].existingSlotId).toBe(FIXTURE.existingSlotMon);
    expect(preview.summary.slotsToReuse).toBe(1);
    // The plan for 2026-08-10 already exists on that slot → update, not create.
    expect(preview.summary.plansToUpdate).toBe(1);
    expect(preview.summary.plansToCreate).toBe(0);
  });

  it('extends validity when the import window is wider (TEST extend)', () => {
    const preview = previewFor(
      makeRawRow({ date: '2026-08-10', startTime: '09:00', endTime: '10:00', validFrom: '2026-01-01', validUntil: '2027-07-31' }),
    );
    expect(preview.groups[0].mode).toBe('extend');
    expect(preview.summary.slotsToExtend).toBe(1);
  });

  it('creates a new slot when the schedule differs (TEST create)', () => {
    const preview = previewFor(makeRawRow()); // 10:00-11:00 vs existing 09:00-10:00
    expect(preview.groups[0].mode).toBe('create');
    expect(preview.summary.slotsToCreate).toBe(1);
  });

  it('detects a teacher conflict with an existing active slot (TEST 22 basis)', () => {
    // Rahul PHY JEE-A Monday 10:00-11:00 — overlaps existing 09:00-10:00? No.
    // Use 09:30-10:30 to overlap the existing 09:00-10:00 window.
    const preview = previewFor(
      makeRawRow({ date: '2026-08-10', startTime: '09:30', endTime: '10:30' }),
    );
    expect(hasBlockingErrors(preview)).toBe(true);
    expect(preview.issues.some((i) => /conflict with an existing timetable/i.test(i.problem))).toBe(true);
  });
});

describe('within-file conflicts (TEST 22/23)', () => {
  it('detects a teacher overlap within the file', () => {
    const rows = [
      makeRawRow({ date: '2026-08-10', startTime: '10:00', endTime: '11:00' }),
      makeRawRow({ date: '2026-08-10', startTime: '10:30', endTime: '11:30' }),
    ];
    const preview = previewFor(...rows);
    expect(preview.issues.some((i) => /Teacher conflict within the file/i.test(i.problem))).toBe(true);
    expect(hasBlockingErrors(preview)).toBe(true);
  });

  it('detects a batch overlap within the file (different subject/teacher)', () => {
    const rows = [
      makeRawRow({ date: '2026-08-10', subjectCode: 'PHY', startTime: '10:00', endTime: '11:00' }),
      // Priya teaches CHEM in the same batch (JEE-A) at an overlapping time.
      makeRawRow({
        date: '2026-08-10', subjectCode: 'CHEM', chapter: 'Organic Chemistry', topic: '',
        teacherMobile: '9876543211', startTime: '10:30', endTime: '11:30',
      }),
    ];
    const preview = previewFor(...rows);
    expect(preview.issues.some((i) => /Batch conflict within the file/i.test(i.problem))).toBe(true);
    expect(hasBlockingErrors(preview)).toBe(true);
  });
});

describe('warnings + mixed files', () => {
  it('warns on institute holidays (TEST holiday)', () => {
    const preview = previewFor(makeRawRow({ date: '2026-08-17' })); // holiday Monday
    expect(preview.rows[0].issues.some((i) => i.severity === 'warning' && /institute holiday/i.test(i.problem))).toBe(true);
    expect(hasBlockingErrors(preview)).toBe(false);
  });

  it('warns on teacher leave (TEST leave)', () => {
    const preview = previewFor(makeRawRow({ date: '2026-08-24' })); // leave Monday
    expect(preview.rows[0].issues.some((i) => i.severity === 'warning' && /teacher leave/i.test(i.problem))).toBe(true);
  });

  it('collects multiple errors in a completely invalid file (TEST 40)', () => {
    const rows = [
      makeRawRow({ date: 'garbage', teacherMobile: '', startTime: '', endTime: '' }),
      makeRawRow({ date: '2026-08-10', teacherMobile: '9999999999' }),
    ];
    const preview = previewFor(...rows);
    expect(preview.rows[0].issues.filter((i) => i.severity === 'error').length).toBeGreaterThanOrEqual(3);
    expect(preview.summary.errorRows).toBe(2);
    expect(buildImportPayload(preview)).toBeNull();
  });

  it('returns null payload when nothing valid to import', () => {
    const preview = previewFor(makeRawRow({ date: 'garbage' }));
    expect(buildImportPayload(preview)).toBeNull();
  });

  it('produces the exact RPC payload shape for a valid import', () => {
    const rows = [
      makeRawRow({ date: '2026-08-10', notes: 'HW 1' }),
      makeRawRow({ date: '2026-08-17', topic: '' }), // chapter-only
    ];
    const payload = buildImportPayload(previewFor(...rows))!;
    expect(payload.slots).toHaveLength(1);
    expect(payload.plans).toHaveLength(2);
    const slot = payload.slots[0];
    expect(slot).toMatchObject({
      teacher_id: FIXTURE.teacherRahul,
      batch_subject_id: FIXTURE.bsPhyJeeA,
      day_of_week: 1,
      // Times are normalized to HH:MM:SS — the `time` type RPC 114 expects.
      start_time: '10:00:00',
      end_time: '11:00:00',
      valid_from: '2026-08-10',
      valid_until: '2026-08-17',
    });
    expect(slot.key).toBeTruthy();
    const byDate = Object.fromEntries(payload.plans.map((p) => [p.occurrence_date, p]));
    expect(byDate['2026-08-10'].notes).toBe('HW 1');
    expect(byDate['2026-08-17'].topic_id).toBeNull();
    expect(byDate['2026-08-17'].chapter_id).toBe(FIXTURE.chapterKinematics);
  });

  it('never puts the mobile number in the RPC slot payload (teacher_id only)', () => {
    const payload = buildImportPayload(previewFor(makeRawRow()))!;
    const slot = payload.slots[0];
    expect(slot.teacher_id).toBe(FIXTURE.teacherRahul);
    expect(Object.keys(slot)).not.toContain('phone');
    expect(Object.keys(slot)).not.toContain('mobile');
  });
});

describe('teacher mobile resolution (Phase 3.5)', () => {
  it('resolves a 10-digit Indian mobile via the national key (stored 91 + 10)', () => {
    const preview = previewFor(makeRawRow({ teacherMobile: '9876543210' }));
    expect(preview.rows[0].teacherId).toBe(FIXTURE.teacherRahul);
    expect(hasBlockingErrors(preview)).toBe(false);
  });

  it('resolves full international digits (+91 prefix)', () => {
    const preview = previewFor(makeRawRow({ teacherMobile: '919876543210' }));
    expect(preview.rows[0].teacherId).toBe(FIXTURE.teacherRahul);
  });

  it('resolves inputs with spaces and hyphens', () => {
    const preview = previewFor(makeRawRow({ teacherMobile: '+91 98765-43210' }));
    expect(preview.rows[0].teacherId).toBe(FIXTURE.teacherRahul);
  });

  it('does NOT silently strip a trunk prefix zero (09876543210 is not found)', () => {
    const preview = previewFor(makeRawRow({ teacherMobile: '09876543210' }));
    expect(preview.rows[0].teacherId).toBeNull();
    expect(preview.rows[0].issues.some((i) => /not found in this institute/i.test(i.problem))).toBe(true);
  });

  it('blocks duplicate mobiles with an ambiguous error', () => {
    const reference = makeReference({
      teachers: [
        { teacherId: FIXTURE.teacherRahul, profileId: FIXTURE.teacherRahul, email: 'rahul@test.com', phone: '919876543210', name: 'Rahul', instituteId: FIXTURE.institute },
        { teacherId: FIXTURE.teacherPriya, profileId: FIXTURE.teacherPriya, email: 'priya@test.com', phone: '919876543210', name: 'Priya', instituteId: FIXTURE.institute },
      ],
    });
    const preview = buildImportPreview({ rows: [makeRawRow({ teacherMobile: '9876543210' })], reference });
    expect(preview.rows[0].teacherId).toBeNull();
    expect(preview.rows[0].issues.some((i) => /Multiple teachers match mobile number/i.test(i.problem))).toBe(true);
    expect(hasBlockingErrors(preview)).toBe(true);
  });

  it('resolves a teacher with a NULL email (phone-first account) — no crash', () => {
    const reference = makeReference({
      teachers: [
        { teacherId: FIXTURE.teacherRahul, profileId: FIXTURE.teacherRahul, email: null, phone: '919876543210', name: 'Rahul', instituteId: FIXTURE.institute },
        { teacherId: FIXTURE.teacherPriya, profileId: FIXTURE.teacherPriya, email: 'priya@test.com', phone: '919876543211', name: 'Priya', instituteId: FIXTURE.institute },
      ],
    });
    const preview = buildImportPreview({ rows: [makeRawRow()], reference });
    expect(preview.rows[0].teacherId).toBe(FIXTURE.teacherRahul);
    expect(hasBlockingErrors(preview)).toBe(false);
  });

  it('treats a teacher with no real phone as not found', () => {
    const reference = makeReference({
      teachers: [
        { teacherId: FIXTURE.teacherRahul, profileId: FIXTURE.teacherRahul, email: 'rahul@test.com', phone: null, name: 'Rahul', instituteId: FIXTURE.institute },
      ],
    });
    const preview = buildImportPreview({ rows: [makeRawRow()], reference });
    expect(preview.rows[0].teacherId).toBeNull();
    expect(preview.rows[0].issues.some((i) => /not found in this institute/i.test(i.problem))).toBe(true);
  });

  it('never uses the teacher NAME for resolution (wrong name + correct mobile)', () => {
    const preview = previewFor(makeRawRow({ teacherName: 'Completely Wrong Name', teacherMobile: '9876543210' }));
    expect(preview.rows[0].teacherId).toBe(FIXTURE.teacherRahul);
    expect(hasBlockingErrors(preview)).toBe(false);
  });
});
