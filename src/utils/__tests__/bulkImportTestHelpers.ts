/**
 * Shared test fixtures for the bulk-import parser/validator unit tests.
 *
 * Pure test data — no network, no database.
 */

import type { RawSheetRow, ReferenceData } from '@/types/bulkTimetableImport';

/** Fixed UUIDs for a deterministic institute fixture. */
export const FIXTURE = {
  institute: '11111111-1111-4111-8111-111111111111',
  streamJee: '22222222-2222-4222-8222-222222222222',
  teacherRahul: '33333333-3333-4333-8333-333333333333',
  teacherPriya: '44444444-4444-4444-8444-444444444444',
  batchJeeA: '55555555-5555-4555-8555-555555555555',
  batchJeeB: '66666666-6666-4666-8666-666666666666',
  subjectPhy: '77777777-7777-4777-8777-777777777777',
  subjectChem: '88888888-8888-4888-8888-888888888888',
  subjectMaths: '99999990-9999-4999-8999-999999999990',
  bsPhyJeeA: '99999999-9999-4999-8999-999999999999',
  bsChemJeeA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  bsPhyJeeB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  chapterKinematics: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  chapterOrganic: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  topicLawsOfMotion: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  topicNewtonsFirst: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  existingSlotMon: '11111111-2222-4333-8444-555555555555',
} as const;

/** Build the reference data used by most validator tests. */
export function makeReference(overrides: Partial<ReferenceData> = {}): ReferenceData {
  const base: ReferenceData = {
    instituteId: FIXTURE.institute,
    timezone: 'Asia/Kolkata',
    teachers: [
      { teacherId: FIXTURE.teacherRahul, profileId: FIXTURE.teacherRahul, email: 'rahul@test.com', phone: '919876543210', name: 'Rahul', instituteId: FIXTURE.institute },
      { teacherId: FIXTURE.teacherPriya, profileId: FIXTURE.teacherPriya, email: 'priya@test.com', phone: '919876543211', name: 'Priya', instituteId: FIXTURE.institute },
    ],
    batches: [
      { batchId: FIXTURE.batchJeeA, instituteId: FIXTURE.institute, streamId: FIXTURE.streamJee, name: 'JEE Batch A', batchCode: 'JEE-A', status: 'active' },
      { batchId: FIXTURE.batchJeeB, instituteId: FIXTURE.institute, streamId: FIXTURE.streamJee, name: 'JEE Batch B', batchCode: 'JEE-B', status: 'active' },
    ],
    streams: [
      { streamId: FIXTURE.streamJee, instituteId: FIXTURE.institute, name: 'JEE', code: 'JEE' },
    ],
    subjects: [
      { subjectId: FIXTURE.subjectPhy, streamId: FIXTURE.streamJee, name: 'Physics', code: 'PHY' },
      { subjectId: FIXTURE.subjectChem, streamId: FIXTURE.streamJee, name: 'Chemistry', code: 'CHEM' },
      // MATHS exists in the stream but is NOT taught in any batch — used to
      // test the "subject not taught in this batch" path.
      { subjectId: FIXTURE.subjectMaths, streamId: FIXTURE.streamJee, name: 'Maths', code: 'MATHS' },
    ],
    batchSubjects: [
      { batchSubjectId: FIXTURE.bsPhyJeeA, batchId: FIXTURE.batchJeeA, subjectId: FIXTURE.subjectPhy, instituteId: FIXTURE.institute, name: null },
      { batchSubjectId: FIXTURE.bsChemJeeA, batchId: FIXTURE.batchJeeA, subjectId: FIXTURE.subjectChem, instituteId: FIXTURE.institute, name: null },
      { batchSubjectId: FIXTURE.bsPhyJeeB, batchId: FIXTURE.batchJeeB, subjectId: FIXTURE.subjectPhy, instituteId: FIXTURE.institute, name: null },
    ],
    assignments: [
      { batchSubjectId: FIXTURE.bsPhyJeeA, teacherId: FIXTURE.teacherRahul },
      { batchSubjectId: FIXTURE.bsPhyJeeB, teacherId: FIXTURE.teacherRahul },
      { batchSubjectId: FIXTURE.bsChemJeeA, teacherId: FIXTURE.teacherPriya },
    ],
    chapters: [
      { chapterId: FIXTURE.chapterKinematics, subjectId: FIXTURE.subjectPhy, name: 'Kinematics' },
      { chapterId: FIXTURE.chapterOrganic, subjectId: FIXTURE.subjectChem, name: 'Organic Chemistry' },
    ],
    topics: [
      { topicId: FIXTURE.topicLawsOfMotion, chapterId: FIXTURE.chapterKinematics, name: 'Laws of Motion' },
      { topicId: FIXTURE.topicNewtonsFirst, chapterId: FIXTURE.chapterKinematics, name: "Newton's First Law" },
    ],
    existingSlots: [
      {
        timetableSlotId: FIXTURE.existingSlotMon,
        teacherId: FIXTURE.teacherRahul,
        batchSubjectId: FIXTURE.bsPhyJeeA,
        dayOfWeek: 1, // Monday
        startTime: '09:00:00',
        endTime: '10:00:00',
        validFrom: '2026-01-01',
        validUntil: '2026-12-31',
        status: 'active',
      },
    ],
    // Rahul teaches Physics JEE-A on Mondays 09:00; a plan already exists on 2026-08-10.
    existingPlans: [
      { timetableSlotId: FIXTURE.existingSlotMon, occurrenceDate: '2026-08-10' },
    ],
    holidays: ['2026-08-17'], // a Monday
    teacherLeaves: [{ teacherId: FIXTURE.teacherRahul, startDate: '2026-08-24', endDate: '2026-08-24' }],
    ...overrides,
  };
  return base;
}

/** Build a normalized RawSheetRow (post-parser shape). */
export function makeRawRow(overrides: Partial<RawSheetRow> = {}): RawSheetRow {
  return {
    row: 2,
    date: '2026-08-10', // Monday
    teacherMobile: '9876543210',
    teacherName: 'Rahul',
    batchCode: 'JEE-A',
    subjectCode: 'PHY',
    startTime: '10:00',
    endTime: '11:00',
    chapter: 'Kinematics',
    topic: 'Laws of Motion',
    notes: '',
    validFrom: null,
    validUntil: null,
    ...overrides,
  };
}

/** Build a CSV string from a 2D grid (first row = headers). */
export function makeCsvText(grid: Array<Array<string | number>>): string {
  const escape = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return grid.map((row) => row.map(escape).join(',')).join('\n');
}

/** Create a `File` for a CSV payload. */
export function makeCsvFile(csv: string, name = 'import.csv'): File {
  return new File([csv], name, { type: 'text/csv' });
}

/** Create a `File` for an XLSX payload from a 2D grid (first row = headers). */
export async function makeXlsxFile(
  grid: Array<Array<string | number | Date>>,
  name = 'import.xlsx',
): Promise<File> {
  const XLSX = await import('xlsx');
  const worksheet = XLSX.utils.aoa_to_sheet(grid);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return new File([new Uint8Array(buffer)], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** The official header row. */
export function headerRow(): string[] {
  return [
    'Date', 'Teacher Mobile', 'Teacher Name', 'Batch Code', 'Subject Code',
    'Start Time', 'End Time', 'Chapter', 'Topic', 'Notes', 'Valid From', 'Valid Until',
  ];
}

/** One valid CSV data row (Kinematics / Laws of Motion on Monday 10-11). */
export function validCsvRow(): Array<string | number> {
  return [
    '2026-08-10', '9876543210', 'Rahul', 'JEE-A', 'PHY',
    '10:00', '11:00', 'Kinematics', 'Laws of Motion', '', '', '',
  ];
}
