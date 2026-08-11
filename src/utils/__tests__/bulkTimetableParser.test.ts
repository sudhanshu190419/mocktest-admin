/**
 * Bulk Timetable Import — Parser unit tests.
 *
 * Covers the file-level cases of the 40-case matrix: valid XLSX/CSV, empty
 * file, missing/duplicate/unknown columns, malformed workbook, unsupported
 * extensions, .xlsm rejection, row caps, blank rows, whitespace, formula
 * cells, and quoted commas/newlines in notes.
 */

import { describe, it, expect } from 'vitest';
import { parseImportFile } from '@/utils/bulkTimetableParser';
import {
  headerRow,
  makeCsvFile,
  makeCsvText,
  makeXlsxFile,
  validCsvRow,
} from './bulkImportTestHelpers';

describe('parseImportFile — file structure', () => {
  it('parses a valid CSV (TEST 2)', async () => {
    const file = makeCsvFile(makeCsvText([headerRow(), validCsvRow()]));
    const result = await parseImportFile(file);

    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].teacherMobile).toBe('9876543210');
    expect(result.rows[0].date).toBe('2026-08-10');
    expect(result.rows[0].startTime).toBe('10:00');
    expect(result.rows[0].batchCode).toBe('JEE-A');
    expect(result.rows[0].subjectCode).toBe('PHY');
  });

  it('parses a valid XLSX (TEST 1)', async () => {
    const file = await makeXlsxFile([headerRow(), validCsvRow()]);
    const result = await parseImportFile(file);

    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].teacherMobile).toBe('9876543210');
  });

  it('accepts the BULK_TIMETABLE_V2 version row', async () => {
    const file = makeCsvFile(
      makeCsvText([['BULK_TIMETABLE_V2'], headerRow(), validCsvRow()]),
    );
    const result = await parseImportFile(file);
    expect(result.ok).toBe(true);
    expect(result.version).toBe('BULK_TIMETABLE_V2');
    expect(result.rows).toHaveLength(1);
  });

  it('rejects the legacy V1 template with a clear version error (TEST 20)', async () => {
    const file = makeCsvFile(
      makeCsvText([['BULK_TIMETABLE_V1'], headerRow(), validCsvRow()]),
    );
    const result = await parseImportFile(file);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.severity === 'error' && /not supported by this system/i.test(i.problem))).toBe(true);
  });

  it('rejects an empty file (TEST 3)', async () => {
    const file = makeCsvFile('');
    const result = await parseImportFile(file);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /empty/i.test(i.problem))).toBe(true);
  });

  it('rejects a file with no data rows', async () => {
    const file = makeCsvFile(makeCsvText([headerRow()]));
    const result = await parseImportFile(file);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /no data rows/i.test(i.problem))).toBe(true);
  });

  it('rejects a missing required column (TEST 4)', async () => {
    const headers = headerRow().filter((h) => h !== 'Date');
    const file = makeCsvFile(makeCsvText([headers, validCsvRow().slice(1)]));
    const result = await parseImportFile(file);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /Required column "Date" is missing/i.test(i.problem))).toBe(true);
  });

  it('rejects a duplicate column (TEST 5)', async () => {
    const headers = [...headerRow(), 'Date'];
    const row = [...validCsvRow(), '2026-08-10'];
    const file = makeCsvFile(makeCsvText([headers, row]));
    const result = await parseImportFile(file);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /Duplicate column/i.test(i.problem))).toBe(true);
  });

  it('rejects an unknown column (TEST 6)', async () => {
    const headers = [...headerRow(), 'Random Column'];
    const row = [...validCsvRow(), 'x'];
    const file = makeCsvFile(makeCsvText([headers, row]));
    const result = await parseImportFile(file);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /Unknown column/i.test(i.problem))).toBe(true);
  });

  it('normalizes header whitespace/casing (TEST 36)', async () => {
    const headers = [
      ' date ', 'teacher mobile', 'Teacher Name', 'batch code', 'SUBJECT CODE',
      'start time', 'end time', 'chapter', 'topic', 'notes', 'valid from', 'valid until',
    ];
    const file = makeCsvFile(makeCsvText([headers, validCsvRow()]));
    const result = await parseImportFile(file);
    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(1);
  });

  it('ignores blank rows (TEST 35)', async () => {
    const file = makeCsvFile(makeCsvText([headerRow(), validCsvRow(), ['', '', '', '', '', '', '', '', '', '', '', '']]));
    const result = await parseImportFile(file);
    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(1);
  });

  it('rejects an unsupported extension (TEST 32)', async () => {
    const file = makeCsvFile(makeCsvText([headerRow(), validCsvRow()]), 'import.txt');
    const result = await parseImportFile(file);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /Unsupported file type/i.test(i.problem))).toBe(true);
  });

  it('rejects .xls (legacy binary)', async () => {
    const file = makeCsvFile(makeCsvText([headerRow(), validCsvRow()]), 'import.xls');
    const result = await parseImportFile(file);
    expect(result.ok).toBe(false);
  });

  it('rejects .xlsm (macro-enabled) (TEST 34)', async () => {
    const file = makeCsvFile(makeCsvText([headerRow(), validCsvRow()]), 'import.xlsm');
    const result = await parseImportFile(file);
    expect(result.ok).toBe(false);
  });

  it('rejects a malformed workbook (TEST 31)', async () => {
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])], 'broken.xlsx');
    const result = await parseImportFile(file);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /could not be read/i.test(i.problem))).toBe(true);
  });

  it('rejects files over 10 MB', async () => {
    const big = 'x'.repeat(11 * 1024 * 1024);
    const file = makeCsvFile(big);
    const result = await parseImportFile(file);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /10 MB limit/i.test(i.problem))).toBe(true);
  });

  it('accepts exactly 5,000 rows and rejects 5,001 (TEST 29/30)', async () => {
    const ok5000 = makeCsvFile(
      makeCsvText([headerRow(), ...Array.from({ length: 5000 }, () => validCsvRow())]),
    );
    const result5000 = await parseImportFile(ok5000);
    expect(result5000.ok).toBe(true);
    expect(result5000.rows).toHaveLength(5000);

    const over = makeCsvFile(
      makeCsvText([headerRow(), ...Array.from({ length: 5001 }, () => validCsvRow())]),
    );
    const resultOver = await parseImportFile(over);
    expect(resultOver.ok).toBe(false);
    expect(resultOver.issues.some((i) => /maximum is 5,000|maximum is 5000/i.test(i.problem))).toBe(true);
  });

  it('flags formula-like text values as warnings (TEST 33)', async () => {
    const row = [...validCsvRow()];
    row[9] = '=HYPERLINK("http://evil")'; // Notes column (index 9)
    const file = makeCsvFile(makeCsvText([headerRow(), row]));
    const result = await parseImportFile(file);
    expect(result.ok).toBe(true);
    expect(result.issues.some((i) => i.severity === 'warning' && /formula/i.test(i.problem))).toBe(true);
  });

  it('preserves notes with commas and newlines (TEST 38)', async () => {
    const row = [...validCsvRow()];
    row[9] = 'Line 1\nLine 2, with comma';
    const file = makeCsvFile(makeCsvText([headerRow(), row]));
    const result = await parseImportFile(file);
    expect(result.ok).toBe(true);
    expect(result.rows[0].notes).toBe('Line 1\nLine 2, with comma');
  });

  it('handles Excel serial date and time cells in XLSX (TEST 17/18 basis)', async () => {
    // Serial 46244 = 2026-08-10 and time fraction for 10:00:00.
    const grid: Array<Array<string | number>> = [
      headerRow(),
      [
        46244, '9876543210', 'Rahul', 'JEE-A', 'PHY',
        0.4166666666666667, 0.4583333333333333, 'Kinematics', 'Laws of Motion', '', '', '',
      ],
    ];
    const file = await makeXlsxFile(grid);
    const result = await parseImportFile(file);
    expect(result.ok).toBe(true);
    expect(result.rows[0].date).toBe('2026-08-10');
    expect(result.rows[0].startTime).toBe('10:00:00');
    expect(result.rows[0].endTime).toBe('11:00:00');
  });

  it('normalizes teacher mobile cells to digits (spaces, +, hyphens)', async () => {
    const grid: Array<Array<string | number>> = [
      headerRow(),
      ['2026-08-10', '+91 98765-43210', 'Rahul', 'JEE-A', 'PHY', '10:00', '11:00', 'Kinematics', 'Laws of Motion', '', '', ''],
    ];
    const file = await makeXlsxFile(grid);
    const result = await parseImportFile(file);
    expect(result.ok).toBe(true);
    expect(result.rows[0].teacherMobile).toBe('919876543210');
  });
});
