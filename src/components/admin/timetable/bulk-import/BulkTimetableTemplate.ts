/**
 * Bulk Timetable Import — Official Template Generator
 *
 * Phase 3 — downloads the two official templates for the bulk importer.
 *
 * The generated files MUST round-trip through the Phase 2 parser
 * (`src/utils/bulkTimetableParser.ts`): the parser reads cell A1 of the
 * first row as the template version, row 2 as the header row, and rows 3+
 * as data. Header spelling/order is centralized in `BULK_TIMETABLE_HEADERS`
 * so the template never drifts from what the parser accepts.
 *
 * - XLSX is generated with the already-installed `xlsx` package via a
 *   dynamic import (kept out of the initial bundle — same pattern as the
 *   parser). No second spreadsheet library.
 * - CSV reuses the existing `src/utils/csv.ts` helpers (UTF-8 BOM safe for
 *   Hindi/Unicode names).
 *
 * @module components/admin/timetable/bulk-import/BulkTimetableTemplate
 */

import {
  BULK_TIMETABLE_HEADERS,
  BULK_TIMETABLE_TEMPLATE_VERSION,
} from '@/types/bulkTimetableImport';
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
 * Download the official XLSX template.
 *
 * @returns true when the download was created, false on failure.
 */
export async function downloadXlsxTemplate(): Promise<boolean> {
  try {
    const XLSX = await import('xlsx');
    const aoa: (string | number | null)[][] = [
      [BULK_TIMETABLE_TEMPLATE_VERSION],
      [...BULK_TIMETABLE_HEADERS],
      ...EXAMPLE_ROWS,
    ];
    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Timetable');
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
