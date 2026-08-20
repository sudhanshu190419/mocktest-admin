/**
 * Bulk Question Import — Parser
 *
 * Pure file → workbook → headers → `RawQuestionSheetRow[]` conversion.
 * NO network calls, NO database access, NO React.
 *
 * 1. Validates extension, size, readability, and row count limit.
 * 2. Loads first worksheet via dynamic `import('xlsx')`.
 * 3. Reads cell VALUES only (no formulas/macros).
 * 4. Resolves headers and normalizes string/number values.
 * 5. Emits `RawQuestionSheetRow[]` and file-level issues.
 *
 * @module utils/bulkQuestionParser
 */

import {
  BULK_QUESTION_ALLOWED_EXTENSIONS,
  BULK_QUESTION_HEADERS,
  BULK_QUESTION_MAX_FILE_BYTES,
  BULK_QUESTION_MAX_ROWS,
  BULK_QUESTION_REQUIRED_HEADERS,
  BULK_QUESTION_TEMPLATE_VERSION,
} from '@/types/bulkQuestionImport';
import type {
  BulkQuestionHeader,
  QuestionImportIssue,
  RawQuestionSheetRow,
  SheetCellValue,
} from '@/types/bulkQuestionImport';

export interface ParsedQuestionFile {
  ok: boolean;
  version: string;
  headers: BulkQuestionHeader[];
  rows: RawQuestionSheetRow[];
  issues: QuestionImportIssue[];
  sheetName: string;
}

/**
 * Normalizes header strings: lowercases, removes non-alphanumerics.
 */
function normalizeHeader(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Map canonical headers to normalized form for lookup.
 */
const CANONICAL_MAP = new Map<string, BulkQuestionHeader>();
for (const h of BULK_QUESTION_HEADERS) {
  CANONICAL_MAP.set(normalizeHeader(h), h);
}

function matchHeader(raw: string): BulkQuestionHeader | null {
  const norm = normalizeHeader(raw);
  return CANONICAL_MAP.get(norm) ?? null;
}

function normalizeCellValue(val: unknown): SheetCellValue {
  if (val === null || val === undefined) return null;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return String(val).trim();
}

/**
 * Parse an uploaded CSV or XLSX file into structured `RawQuestionSheetRow` objects.
 */
export async function parseQuestionImportFile(file: File): Promise<ParsedQuestionFile> {
  const fileName = file.name;
  const lowerName = fileName.toLowerCase();

  // ── 1. Validate extension ────────────────────────────────────────────────
  const hasValidExt = BULK_QUESTION_ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  if (!hasValidExt) {
    return {
      ok: false,
      version: BULK_QUESTION_TEMPLATE_VERSION,
      headers: [],
      rows: [],
      issues: [
        {
          row: null,
          column: null,
          value: fileName,
          problem: `Unsupported file format. Only ${BULK_QUESTION_ALLOWED_EXTENSIONS.join(', ')} files are accepted.`,
          suggestion: 'Please upload a valid .xlsx or .csv template file.',
          severity: 'error',
        },
      ],
      sheetName: '',
    };
  }

  // ── 2. Validate size ─────────────────────────────────────────────────────
  if (file.size > BULK_QUESTION_MAX_FILE_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      version: BULK_QUESTION_TEMPLATE_VERSION,
      headers: [],
      rows: [],
      issues: [
        {
          row: null,
          column: null,
          value: `${mb} MB`,
          problem: `File size exceeds the 10 MB limit (${mb} MB).`,
          suggestion: 'Split the file into smaller batches and try again.',
          severity: 'error',
        },
      ],
      sheetName: '',
    };
  }

  // ── 3. Load XLSX reader ──────────────────────────────────────────────────
  let XLSX: typeof import('xlsx');
  try {
    XLSX = await import('xlsx');
  } catch {
    return {
      ok: false,
      version: BULK_QUESTION_TEMPLATE_VERSION,
      headers: [],
      rows: [],
      issues: [
        {
          row: null,
          column: null,
          value: fileName,
          problem: 'Spreadsheet reader could not be loaded.',
          severity: 'error',
        },
      ],
      sheetName: '',
    };
  }

  let workbook: import('xlsx').WorkBook;
  try {
    if (lowerName.endsWith('.csv')) {
      let text = await file.text();
      // Strip UTF-8 BOM if present
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      workbook = XLSX.read(text, { type: 'string', raw: true });
    } else {
      const buffer = await file.arrayBuffer();
      workbook = XLSX.read(buffer, { type: 'array', raw: true });
    }
  } catch {
    return {
      ok: false,
      version: BULK_QUESTION_TEMPLATE_VERSION,
      headers: [],
      rows: [],
      issues: [
        {
          row: null,
          column: null,
          value: fileName,
          problem: 'The file could not be read. It may be corrupted or invalid.',
          suggestion: 'Re-export the file and try again.',
          severity: 'error',
        },
      ],
      sheetName: '',
    };
  }

  // ── 4. Locate primary worksheet ──────────────────────────────────────────
  const sheetName = workbook.SheetNames[0] ?? '';
  const sheet = workbook.Sheets[sheetName];
  if (!sheet || !workbook.SheetNames.length) {
    return {
      ok: false,
      version: BULK_QUESTION_TEMPLATE_VERSION,
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

  // ── 5. Extract cell grid ─────────────────────────────────────────────────
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
      version: BULK_QUESTION_TEMPLATE_VERSION,
      headers: [],
      rows: [],
      issues: [
        {
          row: null,
          column: null,
          value: fileName,
          problem: 'Failed to extract rows from the worksheet.',
          severity: 'error',
        },
      ],
      sheetName,
    };
  }

  if (!grid.length) {
    return {
      ok: false,
      version: BULK_QUESTION_TEMPLATE_VERSION,
      headers: [],
      rows: [],
      issues: [
        {
          row: null,
          column: null,
          value: fileName,
          problem: 'The sheet is empty.',
          suggestion: 'Fill in question rows using the official template.',
          severity: 'error',
        },
      ],
      sheetName,
    };
  }

  // ── 6. Header resolution & Version check ─────────────────────────────────
  let headerRowIndex = 0;
  let detectedVersion = BULK_QUESTION_TEMPLATE_VERSION;

  const firstCell = String(grid[0]?.[0] ?? '').trim();
  if (firstCell.toUpperCase().startsWith('BULK_QUESTION_')) {
    detectedVersion = firstCell;
    headerRowIndex = 1;
  }

  const rawHeaderRow = grid[headerRowIndex];
  if (!rawHeaderRow || !Array.isArray(rawHeaderRow)) {
    return {
      ok: false,
      version: detectedVersion,
      headers: [],
      rows: [],
      issues: [
        {
          row: headerRowIndex + 1,
          column: null,
          value: null,
          problem: 'Could not find a valid header row.',
          suggestion: 'Download and use the official template.',
          severity: 'error',
        },
      ],
      sheetName,
    };
  }

  const matchedHeaders: BulkQuestionHeader[] = [];
  const columnIndex = new Map<BulkQuestionHeader, number>();

  rawHeaderRow.forEach((cell, idx) => {
    if (typeof cell === 'string' && cell.trim()) {
      const match = matchHeader(cell);
      if (match) {
        matchedHeaders.push(match);
        columnIndex.set(match, idx);
      }
    }
  });

  // Verify all required headers exist
  const missingHeaders: string[] = [];
  for (const req of BULK_QUESTION_REQUIRED_HEADERS) {
    if (!columnIndex.has(req as BulkQuestionHeader)) {
      missingHeaders.push(req);
    }
  }

  if (missingHeaders.length > 0) {
    return {
      ok: false,
      version: detectedVersion,
      headers: matchedHeaders,
      rows: [],
      issues: [
        {
          row: headerRowIndex + 1,
          column: null,
          value: missingHeaders.join(', '),
          problem: `Missing required template columns: ${missingHeaders.join(', ')}`,
          suggestion: 'Download the official template to ensure all mandatory columns exist.',
          severity: 'error',
        },
      ],
      sheetName,
    };
  }

  // ── 7. Parse Data Rows ───────────────────────────────────────────────────
  const dataRows: RawQuestionSheetRow[] = [];
  const startRowIndex = headerRowIndex + 1;

  const cellAt = (row: Array<unknown>, header: BulkQuestionHeader): SheetCellValue => {
    const idx = columnIndex.get(header);
    if (idx === undefined) return null;
    return normalizeCellValue(row[idx]);
  };

  const stringAt = (row: Array<unknown>, header: BulkQuestionHeader): string | null => {
    const val = cellAt(row, header);
    if (val === null || val === undefined) return null;
    return String(val).trim() || null;
  };

  for (let r = startRowIndex; r < grid.length; r++) {
    const row = grid[r];
    if (!row || !Array.isArray(row)) continue;

    // Check if entire row is empty
    const hasContent = row.some((c) => c !== null && c !== undefined && String(c).trim() !== '');
    if (!hasContent) continue;

    const rowNumber = r + 1; // 1-based spreadsheet row

    const rawCells: Record<string, SheetCellValue> = {};
    for (const h of matchedHeaders) {
      rawCells[h] = cellAt(row, h);
    }

    dataRows.push({
      rowNumber,
      questionText: stringAt(row, 'Question Text'),
      questionType: stringAt(row, 'Question Type'),
      subject: stringAt(row, 'Subject'),
      chapter: stringAt(row, 'Chapter'),
      topic: stringAt(row, 'Topic'),
      difficulty: stringAt(row, 'Difficulty'),
      marks: cellAt(row, 'Marks'),
      negativeMarks: cellAt(row, 'Negative Marks'),
      optionA: stringAt(row, 'Option A'),
      optionB: stringAt(row, 'Option B'),
      optionC: stringAt(row, 'Option C'),
      optionD: stringAt(row, 'Option D'),
      correctAnswer: stringAt(row, 'Correct Answer'),
      numericalAnswer: cellAt(row, 'Numerical Answer'),
      tolerance: cellAt(row, 'Tolerance'),
      explanation: stringAt(row, 'Explanation'),
      rawCells,
    });
  }

  if (dataRows.length > BULK_QUESTION_MAX_ROWS) {
    return {
      ok: false,
      version: detectedVersion,
      headers: matchedHeaders,
      rows: [],
      issues: [
        {
          row: null,
          column: null,
          value: `${dataRows.length} rows`,
          problem: `File contains ${dataRows.length} rows, which exceeds the maximum limit of ${BULK_QUESTION_MAX_ROWS} rows.`,
          suggestion: 'Split your spreadsheet into smaller files and import each separately.',
          severity: 'error',
        },
      ],
      sheetName,
    };
  }

  return {
    ok: true,
    version: detectedVersion,
    headers: matchedHeaders,
    rows: dataRows,
    issues: [],
    sheetName,
  };
}
