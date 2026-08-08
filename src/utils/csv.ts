/**
 * CSV Export Helpers
 *
 * Minimal, dependency-free CSV serialization for admin reporting tables.
 * Handles quoting/escaping per RFC 4180 so values containing commas,
 * quotes, or newlines survive round-trips in Excel / Google Sheets.
 *
 * @module utils/csv
 */

type CsvCell = string | number | null | undefined;

/** Serialize a value for a single CSV cell. */
function escapeCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Build a CSV document from a header row + data rows.
 *
 * @param headers - Column headers (first row of the document).
 * @param rows    - Data rows. Each row length should match `headers`.
 */
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeCell).join(','));
  // BOM helps Excel detect UTF-8 for names containing non-ASCII characters.
  return `\uFEFF${lines.join('\r\n')}`;
}

/**
 * Trigger a browser download of a CSV document.
 *
 * @param filename - File name (a `.csv` extension is appended if missing).
 * @param headers  - Column headers.
 * @param rows     - Data rows.
 */
export function downloadCsv(
  filename: string,
  headers: string[],
  rows: CsvCell[][],
): void {
  const csv = toCsv(headers, rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
