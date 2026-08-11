/**
 * Bulk Timetable Import — Parser
 *
 * Phase 2 — pure file → workbook → headers → `RawSheetRow[]` conversion.
 * NO Supabase calls, NO database access, NO React. The parser only:
 *
 * 1. Detects + validates the file (extension, size, readability, row cap).
 * 2. Loads the FIRST worksheet of an XLSX (or CSV) workbook via a dynamic
 *    `import('xlsx')` — keeping the library out of the initial bundle.
 * 3. Reads cell VALUES only (never formulas/macros).
 * 4. Validates the header row + template version (file-level issues).
 * 5. Normalizes date/time cells (Excel serials → ISO / HH:MM:SS) and emits
 *    `RawSheetRow[]` for the validator.
 *
 * Header spelling/casing rules are centralized in
 * `src/types/bulkTimetableImport.ts` (`BULK_TIMETABLE_HEADERS`).
 *
 * @module utils/bulkTimetableParser
 */

import {
  BULK_IMPORT_ALLOWED_EXTENSIONS,
  BULK_IMPORT_MAX_FILE_BYTES,
  BULK_IMPORT_MAX_ROWS,
  BULK_TIMETABLE_HEADERS,
  BULK_TIMETABLE_TEMPLATE_VERSION,
} from '@/types/bulkTimetableImport';
import type {
  BulkTimetableHeader,
  ImportIssue,
  RawSheetRow,
  SheetCellValue,
} from '@/types/bulkTimetableImport';
import { digitsOnly } from '@/utils/mobileNumber';

// ═══════════════════════════════════════════════════════════════════════════
//  Public result types
// ═══════════════════════════════════════════════════════════════════════════

/** Result of parsing one uploaded file. */
export interface ParsedImportFile {
  /** False when any file-level ERROR exists (headers/version/size/structure). */
  ok: boolean;
  /** Detected template version (defaults to V1 when no version row present). */
  version: string;
  /** Canonical headers found, in file column order. */
  headers: BulkTimetableHeader[];
  /** Normalized data rows (never includes header/version rows). */
  rows: RawSheetRow[];
  /** File-level issues only (row-level validation belongs to the validator). */
  issues: ImportIssue[];
  /** The name of the sheet that was parsed. */
  sheetName: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Internal helpers
// ═══════════════════════════════════════════════════════════════════════════

/** True when the file extension is one of the allowed ones (.xlsx / .csv). */
function hasAllowedExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return BULK_IMPORT_ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Lowercase, trim, and collapse internal whitespace — canonical header key. */
function canonicalHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Map a raw header string to its canonical template header (or null). */
function matchHeader(raw: string): BulkTimetableHeader | null {
  const key = canonicalHeader(raw);
  const found = BULK_TIMETABLE_HEADERS.find((h) => canonicalHeader(h) === key);
  return found ?? null;
}

/**
 * Convert an Excel date serial (days since 1899-12-30) to YYYY-MM-DD.
 * Uses `XLSX.SSF.parse_date_code` — deterministic, timezone-independent
 * (a date-only serial IS the calendar date; no browser-local shift).
 */
function serialToIsoDate(serial: number, parseDateCode: (v: number) => unknown): string {
  const d = parseDateCode(serial) as { y?: number; m?: number; d?: number } | null;
  if (!d || typeof d.y !== 'number' || typeof d.m !== 'number' || typeof d.d !== 'number') {
    return String(serial); // validator will flag it as an invalid date
  }
  const y = String(d.y).padStart(4, '0');
  const m = String(d.m).padStart(2, '0');
  const day = String(d.d).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Convert a Date object to YYYY-MM-DD using its UTC components. */
function dateToIso(date: Date): string {
  const y = String(date.getUTCFullYear()).padStart(4, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Convert an Excel time serial (fraction of a day, e.g. 0.4166… = 10:00) to
 * HH:MM:SS via `XLSX.SSF.parse_date_code` (extracting only H/M/S).
 */
function serialToTime(serial: number, parseDateCode: (v: number) => unknown): string {
  const d = parseDateCode(serial) as { H?: number; M?: number; S?: number } | null;
  if (!d || typeof d.H !== 'number' || typeof d.M !== 'number' || typeof d.S !== 'number') {
    return String(serial); // validator will flag it as an invalid time
  }
  const h = String(d.H).padStart(2, '0');
  const m = String(d.M).padStart(2, '0');
  const s = String(d.S).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/** Convert a Date object to HH:MM:SS (UTC components — time-only serial). */
function dateToTime(date: Date): string {
  const h = String(date.getUTCHours()).padStart(2, '0');
  const m = String(date.getUTCMinutes()).padStart(2, '0');
  const s = String(date.getUTCSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/** Coerce an arbitrary cell value to a string (trimmed; '' for null/undefined). */
function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/** True when a data row is completely blank. */
function isRowBlank(row: Array<unknown>): boolean {
  return row.every((cell) => cell === null || cell === undefined || cell === '');
}

// ═══════════════════════════════════════════════════════════════════════════
//  Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse an uploaded XLSX or CSV file into headers + normalized raw rows.
 *
 * File-level errors (bad extension, too large, unreadable workbook, empty
 * file, bad headers, unsupported version) are returned in `issues` with
 * `ok === false`; the caller must NOT proceed to validation when `ok` is
 * false. `.xls` / `.xlsm` / macro workbooks are rejected — only values are
 * ever read, never formulas.
 *
 * @param file - The File object selected by the admin.
 * @returns A `ParsedImportFile` (never throws for user-facing failures).
 */
export async function parseImportFile(file: File): Promise<ParsedImportFile> {
  const fileName = file.name || 'import.xlsx';
  const issues: ImportIssue[] = [];

  // ── 1. Extension guard ─────────────────────────────────────────────────
  if (!hasAllowedExtension(fileName)) {
    return {
      ok: false,
      version: BULK_TIMETABLE_TEMPLATE_VERSION,
      headers: [],
      rows: [],
      issues: [
        {
          row: null,
          column: null,
          value: fileName,
          problem: `Unsupported file type. Upload an .xlsx or .csv file (${BULK_IMPORT_ALLOWED_EXTENSIONS.join(', ')}).`,
          suggestion: 'Export your timetable as XLSX or CSV and try again.',
          severity: 'error',
        },
      ],
      sheetName: '',
    };
  }

  // ── 2. Size guard ─────────────────────────────────────────────────────
  if (file.size > BULK_IMPORT_MAX_FILE_BYTES) {
    return {
      ok: false,
      version: BULK_TIMETABLE_TEMPLATE_VERSION,
      headers: [],
      rows: [],
      issues: [
        {
          row: null,
          column: null,
          value: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
          problem: `File is larger than the ${BULK_IMPORT_MAX_FILE_BYTES / (1024 * 1024)} MB limit.`,
          suggestion: 'Split the file into smaller batches and upload them separately.',
          severity: 'error',
        },
      ],
      sheetName: '',
    };
  }

  // ── 3. Load workbook (dynamic import keeps xlsx out of the initial bundle) ──
  let XLSX: typeof import('xlsx');
  try {
    XLSX = await import('xlsx');
  } catch {
    return {
      ok: false,
      version: BULK_TIMETABLE_TEMPLATE_VERSION,
      headers: [],
      rows: [],
      issues: [
        {
          row: null,
          column: null,
          value: fileName,
          problem: 'The spreadsheet reader could not be loaded.',
          severity: 'error',
        },
      ],
      sheetName: '',
    };
  }

  let workbook: import('xlsx').WorkBook;
  try {
    if (fileName.toLowerCase().endsWith('.csv')) {
      let text = await file.text();
      // Strip a UTF-8 BOM so the first header is not polluted.
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      workbook = XLSX.read(text, { type: 'string', raw: true });
    } else {
      const buffer = await file.arrayBuffer();
      workbook = XLSX.read(buffer, { type: 'array', raw: true });
    }
  } catch {
    return {
      ok: false,
      version: BULK_TIMETABLE_TEMPLATE_VERSION,
      headers: [],
      rows: [],
      issues: [
        {
          row: null,
          column: null,
          value: fileName,
          problem: 'The file could not be read. It may be corrupted or not a valid spreadsheet.',
          suggestion: 'Re-export the file from Excel and try again.',
          severity: 'error',
        },
      ],
      sheetName: '',
    };
  }

  // ── 4. First worksheet only ───────────────────────────────────────────
  const sheetName = workbook.SheetNames[0] ?? '';
  const sheet = workbook.Sheets[sheetName];
  if (!sheet || !workbook.SheetNames.length) {
    return {
      ok: false,
      version: BULK_TIMETABLE_TEMPLATE_VERSION,
      headers: [],
      rows: [],
      issues: [
        {
          row: null,
          column: null,
          value: fileName,
          problem: 'The workbook contains no worksheets.',
          severity: 'error',
        },
      ],
      sheetName,
    };
  }

  // ── 5. Extract raw cell grid (values only — never formulas) ──────────
  let grid: Array<Array<unknown>>;
  try {
    grid = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false,
    }) as Array<Array<unknown>>;
  } catch {
    return {
      ok: false,
      version: BULK_TIMETABLE_TEMPLATE_VERSION,
      headers: [],
      rows: [],
      issues: [
        {
          row: null,
          column: null,
          value: fileName,
          problem: 'The worksheet could not be parsed.',
          severity: 'error',
        },
      ],
      sheetName,
    };
  }

  if (grid.length === 0) {
    return {
      ok: false,
      version: BULK_TIMETABLE_TEMPLATE_VERSION,
      headers: [],
      rows: [],
      issues: [
        {
          row: null,
          column: null,
          value: fileName,
          problem: 'The file is empty.',
          suggestion: 'Download the template, fill it in, and upload it again.',
          severity: 'error',
        },
      ],
      sheetName,
    };
  }

  // ── 6. Version row detection ──────────────────────────────────────────
  // The official template carries "BULK_TIMETABLE_V1" in cell A1 of the
  // first row, followed by the header row. A plain sheet without a version
  // row defaults to the current supported version (V1).
  let version = BULK_TIMETABLE_TEMPLATE_VERSION;
  let headerRowIndex = 0;
  const firstCell = cellToString(grid[0]?.[0]);
  if (/^BULK_TIMETABLE_V\d+$/i.test(firstCell)) {
    version = firstCell.toUpperCase();
    headerRowIndex = 1;
  }

  if (version !== BULK_TIMETABLE_TEMPLATE_VERSION) {
    return {
      ok: false,
      version,
      headers: [],
      rows: [],
      issues: [
        {
          row: null,
          column: null,
          value: version,
          problem: `Template version "${version}" is not supported by this system.`,
          suggestion: `Use template version "${BULK_TIMETABLE_TEMPLATE_VERSION}".`,
          severity: 'error',
        },
      ],
      sheetName,
    };
  }

  // ── 7. Header row validation (file-level) ─────────────────────────────
  const rawHeaderRow = grid[headerRowIndex] ?? [];
  const seen = new Map<string, number>();
  const headers: BulkTimetableHeader[] = [];

  for (let i = 0; i < rawHeaderRow.length; i += 1) {
    const cell = rawHeaderRow[i];
    if (cell === null || cell === undefined || cell === '') continue;
    const matched = matchHeader(cellToString(cell));
    if (!matched) {
      issues.push({
        row: headerRowIndex + 1,
        column: null,
        value: cellToString(cell),
        problem: `Unknown column "${cellToString(cell)}" in the header row.`,
        suggestion: `Allowed columns: ${BULK_TIMETABLE_HEADERS.join(', ')}.`,
        severity: 'error',
      });
      continue;
    }
    const prev = seen.get(matched);
    if (prev !== undefined) {
      issues.push({
        row: headerRowIndex + 1,
        column: matched,
        value: cellToString(cell),
        problem: `Duplicate column "${matched}".`,
        suggestion: 'Remove the duplicate column from the file.',
        severity: 'error',
      });
      continue;
    }
    seen.set(matched, i);
    headers.push(matched);
  }

  // Missing required headers.
  const present = new Set(headers);
  const required = new Set<string>([
    'Date',
    'Teacher Mobile',
    'Batch Code',
    'Subject Code',
    'Start Time',
    'End Time',
  ]);
  for (const req of required) {
    if (!present.has(req as BulkTimetableHeader)) {
      issues.push({
        row: headerRowIndex + 1,
        column: req,
        value: null,
        problem: `Required column "${req}" is missing.`,
        suggestion: `Download the template and include the "${req}" column.`,
        severity: 'error',
      });
    }
  }

  // Unknown headers already recorded; if we have no usable headers at all,
  // the file structure is invalid — stop here.
  if (headers.length === 0 || issues.some((i) => i.severity === 'error')) {
    return {
      ok: false,
      version,
      headers,
      rows: [],
      issues,
      sheetName,
    };
  }

  // ── 8. Data rows (cap + conversion) ───────────────────────────────────
  const dataRows = grid.slice(headerRowIndex + 1).filter((r) => !isRowBlank(r));
  if (dataRows.length === 0) {
    issues.push({
      row: null,
      column: null,
      value: null,
      problem: 'The file contains no data rows.',
      suggestion: 'Download the template, fill in at least one row, and upload it again.',
      severity: 'error',
    });
    return { ok: false, version, headers, rows: [], issues, sheetName };
  }
  if (dataRows.length > BULK_IMPORT_MAX_ROWS) {
    issues.push({
      row: null,
      column: null,
      value: dataRows.length,
      problem: `File contains ${dataRows.length} data rows — the maximum is ${BULK_IMPORT_MAX_ROWS}.`,
      suggestion: 'Split the file into multiple uploads of at most 5,000 rows.',
      severity: 'error',
    });
    return { ok: false, version, headers, rows: [], issues, sheetName };
  }

  // Map canonical header → column index for value extraction.
  const columnIndex = new Map<BulkTimetableHeader, number>();
  for (const h of headers) {
    columnIndex.set(h, seen.get(h) ?? -1);
  }
  // SSF may be exposed directly on the dynamic-import namespace (Vite/webpack
  // interop) or only via the CJS `default` export (Node's dynamic import of
  // the `xlsx` package). When neither is available, fall back to a small
  // Excel-serial converter so date/time serials still normalize correctly in
  // every environment. Behavior with SSF present is unchanged.
  type SerialDateCode = { y: number; m: number; d: number; H: number; M: number; S: number };
  const ssfNamespace = XLSX as unknown as {
    SSF?: { parse_date_code: (v: number) => SerialDateCode };
    default?: { SSF?: { parse_date_code: (v: number) => SerialDateCode } };
  };
  const ssf = ssfNamespace.SSF ?? ssfNamespace.default?.SSF;
  const nativeParseDateCode =
    ssf && typeof ssf.parse_date_code === 'function'
      ? ssf.parse_date_code.bind(ssf)
      : null;
  const parseDateCode: (v: number) => SerialDateCode = nativeParseDateCode ?? ((serial: number) => {
    // Excel serial = days since 1899-12-30 (25569 = 1970-01-01). The time is
    // the fractional part of the day. The 1900 leap-year phantom (serial 60)
    // only affects Jan/Feb 1900 dates — irrelevant for real timetables.
    const whole = Math.floor(serial);
    const date = new Date(Math.round((whole - 25569) * 86400000));
    const totalSeconds = Math.round((serial - whole) * 86400);
    return {
      y: date.getUTCFullYear(),
      m: date.getUTCMonth() + 1,
      d: date.getUTCDate(),
      H: Math.floor(totalSeconds / 3600),
      M: Math.floor((totalSeconds % 3600) / 60),
      S: totalSeconds % 60,
    };
  });

  const cellAt = (row: Array<unknown>, header: BulkTimetableHeader): SheetCellValue => {
    const idx = columnIndex.get(header) ?? -1;
    if (idx < 0 || idx >= row.length) return null;
    return (row[idx] as SheetCellValue) ?? null;
  };

  const rows: RawSheetRow[] = dataRows.map((dataRow, idx) => {
    const sheetRowNumber = headerRowIndex + 2 + idx;
    const rawDate = cellAt(dataRow, 'Date');
    const rawStart = cellAt(dataRow, 'Start Time');
    const rawEnd = cellAt(dataRow, 'End Time');
    const rawValidFrom = cellAt(dataRow, 'Valid From');
    const rawValidUntil = cellAt(dataRow, 'Valid Until');

    // ── Date/time normalization (Excel serials → ISO / HH:MM:SS) ───────
    const normalizeDateCell = (cell: unknown): SheetCellValue => {
      if (typeof cell === 'number') return serialToIsoDate(cell, parseDateCode);
      if (cell instanceof Date) return dateToIso(cell);
      return typeof cell === 'string' ? cell.trim() : null;
    };
    const normalizeTimeCell = (cell: unknown): SheetCellValue => {
      if (typeof cell === 'number') return serialToTime(cell, parseDateCode);
      if (cell instanceof Date) return dateToTime(cell);
      return typeof cell === 'string' ? cell.trim() : null;
    };

    return {
      row: sheetRowNumber,
      date: normalizeDateCell(rawDate),
      teacherMobile: digitsOnly(cellToString(cellAt(dataRow, 'Teacher Mobile'))),
      teacherName: cellToString(cellAt(dataRow, 'Teacher Name')),
      batchCode: cellToString(cellAt(dataRow, 'Batch Code')).toUpperCase(),
      subjectCode: cellToString(cellAt(dataRow, 'Subject Code')).toUpperCase(),
      startTime: normalizeTimeCell(rawStart),
      endTime: normalizeTimeCell(rawEnd),
      chapter: cellToString(cellAt(dataRow, 'Chapter')),
      topic: cellToString(cellAt(dataRow, 'Topic')),
      notes: cellToString(cellAt(dataRow, 'Notes')),
      validFrom: normalizeDateCell(rawValidFrom),
      validUntil: normalizeDateCell(rawValidUntil),
    };
  });

  // Formula-injection hygiene: flag text cells starting with = + - @ (values
  // are never evaluated — this is detection only, and only for text columns).
  const formulaLike = /^[=+\-@]/;
  for (const r of rows) {
    const textCols: Array<{ header: string; value: string }> = [
      { header: 'Teacher Mobile', value: r.teacherMobile },
      { header: 'Batch Code', value: r.batchCode },
      { header: 'Subject Code', value: r.subjectCode },
      { header: 'Chapter', value: r.chapter },
      { header: 'Topic', value: r.topic },
      { header: 'Notes', value: r.notes },
    ];
    for (const col of textCols) {
      if (col.value && formulaLike.test(col.value)) {
        issues.push({
          row: r.row,
          column: col.header,
          value: col.value,
          problem: `Value in "${col.header}" starts with "${col.value[0]}" and looks like a spreadsheet formula.`,
          suggestion: 'Replace it with plain text before importing.',
          severity: 'warning',
        });
      }
    }
  }

  return { ok: issues.every((i) => i.severity !== 'error'), version, headers, rows, issues, sheetName };
}
