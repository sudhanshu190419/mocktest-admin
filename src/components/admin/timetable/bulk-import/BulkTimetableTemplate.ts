/**
 * Bulk Timetable Import — Official Template Generator
 *
 * Phase 3 — downloads official XLSX (2 sheets: Timetable + Reference Data)
 * and CSV templates for the bulk timetable importer.
 *
 * The generated files MUST round-trip through the Phase 2 parser
 * (`src/utils/bulkTimetableParser.ts`): the parser reads cell A1 of the
 * first row as the template version, row 2 as the header row, and rows 3+
 * as data. Header spelling/order is centralized in `BULK_TIMETABLE_HEADERS`
 * so the template never drifts from what the parser accepts.
 *
 * - Sheet 1: `Timetable` (Primary data sheet read by parser)
 * - Sheet 2: `Reference Data` (Current institute batches, subjects, chapters, topics, teachers)
 *
 * @module components/admin/timetable/bulk-import/BulkTimetableTemplate
 */

import {
  BULK_TIMETABLE_HEADERS,
  BULK_TIMETABLE_TEMPLATE_VERSION,
} from '@/types/bulkTimetableImport';
import type { ReferenceData } from '@/types/bulkTimetableImport';
import { downloadCsv } from '@/utils/csv';

/** One realistic example row (rows 3+ of the template). */
const EXAMPLE_ROWS: (string | null)[][] = [
  [
    '2026-08-10',
    '9876543210',
    'Rahul Sharma',
    'JEE-A',
    'PHY',
    '10:00',
    '11:00',
    'Kinematics',
    'Laws of Motion',
    'Example row — replace this with your data',
    null,
    null,
  ],
];

/**
 * Download the official XLSX template with exactly two sheets:
 * 1. `Timetable` (sample data & canonical headers)
 * 2. `Reference Data` (current institute batches, subjects, chapters, topics, teachers)
 *
 * @param reference - Optional loaded ReferenceData for the institute.
 * @returns true when the download was created, false on failure.
 */
export async function downloadXlsxTemplate(reference?: ReferenceData): Promise<boolean> {
  try {
    const XLSX = await import('xlsx');
    const book = XLSX.utils.book_new();

    // ── Sheet 1: Timetable ──────────────────────────────────────────────────
    const timetableAoA: (string | number | null)[][] = [
      [BULK_TIMETABLE_TEMPLATE_VERSION],
      [...BULK_TIMETABLE_HEADERS],
      ...EXAMPLE_ROWS,
    ];
    const timetableSheet = XLSX.utils.aoa_to_sheet(timetableAoA);

    // Set readable column widths
    timetableSheet['!cols'] = [
      { wch: 14 }, // Date
      { wch: 16 }, // Teacher Mobile
      { wch: 20 }, // Teacher Name
      { wch: 14 }, // Batch Code
      { wch: 14 }, // Subject Code
      { wch: 12 }, // Start Time
      { wch: 12 }, // End Time
      { wch: 24 }, // Chapter
      { wch: 24 }, // Topic
      { wch: 32 }, // Notes
      { wch: 14 }, // Valid From
      { wch: 14 }, // Valid Until
    ];

    XLSX.utils.book_append_sheet(book, timetableSheet, 'Timetable');

    // ── Sheet 2: Reference Data ─────────────────────────────────────────────
    const subjectMap = new Map(reference?.subjects.map((s) => [s.subjectId, s.code]) ?? []);
    const chapterMap = new Map(reference?.chapters.map((c) => [c.chapterId, c.name]) ?? []);

    const batches = reference?.batches ?? [];
    const subjects = reference?.subjects ?? [];
    const chapters = reference?.chapters ?? [];
    const topics = reference?.topics ?? [];
    const teachers = reference?.teachers ?? [];

    const maxRows = Math.max(
      batches.length,
      subjects.length,
      chapters.length,
      topics.length,
      teachers.length,
      1,
    );

    const refAoA: (string | null)[][] = [
      // Row 1: Section Headers
      [
        'BATCHES', null, null,
        'SUBJECTS', null, null,
        'CHAPTERS', null, null,
        'TOPICS', null, null,
        'TEACHERS', null,
      ],
      // Row 2: Column Headers
      [
        'Batch Code', 'Batch Name', null,
        'Subject Code', 'Subject Name', null,
        'Subject Code', 'Chapter Name', null,
        'Chapter Name', 'Topic Name', null,
        'Teacher Mobile', 'Teacher Name',
      ],
    ];

    // Data rows
    for (let i = 0; i < maxRows; i++) {
      const b = batches[i];
      const s = subjects[i];
      const ch = chapters[i];
      const top = topics[i];
      const t = teachers[i];

      refAoA.push([
        // Batches
        b ? b.batchCode : null,
        b ? b.name : null,
        null,
        // Subjects
        s ? s.code : null,
        s ? s.name : null,
        null,
        // Chapters
        ch ? (subjectMap.get(ch.subjectId) ?? '') : null,
        ch ? ch.name : null,
        null,
        // Topics
        top ? (chapterMap.get(top.chapterId) ?? '') : null,
        top ? top.name : null,
        null,
        // Teachers
        t ? (t.phone ?? '') : null,
        t ? (t.name ?? '') : null,
      ]);
    }

    const refSheet = XLSX.utils.aoa_to_sheet(refAoA);
    refSheet['!cols'] = [
      { wch: 16 }, // Batch Code
      { wch: 26 }, // Batch Name
      { wch: 4 },  // Spacer
      { wch: 16 }, // Subject Code
      { wch: 26 }, // Subject Name
      { wch: 4 },  // Spacer
      { wch: 16 }, // Subject Code
      { wch: 28 }, // Chapter Name
      { wch: 4 },  // Spacer
      { wch: 28 }, // Chapter Name
      { wch: 28 }, // Topic Name
      { wch: 4 },  // Spacer
      { wch: 18 }, // Teacher Mobile
      { wch: 26 }, // Teacher Name
    ];

    XLSX.utils.book_append_sheet(book, refSheet, 'Reference Data');

    XLSX.writeFile(book, 'bulk_timetable_template.xlsx');
    return true;
  } catch (err) {
    console.error('Failed to generate the XLSX template:', err);
    return false;
  }
}

/**
 * Download the official CSV template (same layout: version row, headers row,
 * example rows). Reuses the existing CSV utilities.
 */
export function downloadCsvTemplate(): boolean {
  try {
    downloadCsv(
      'bulk_timetable_template.csv',
      [BULK_TIMETABLE_TEMPLATE_VERSION],
      [[...BULK_TIMETABLE_HEADERS], ...EXAMPLE_ROWS],
    );
    return true;
  } catch (err) {
    console.error('Failed to generate the CSV template:', err);
    return false;
  }
}
