'use client';

/**
 * Lightweight JSON pretty-printer for audit snapshots (old_value /
 * new_value / metadata).
 *
 * Renders the value with 2-space indentation in a monospace block. Strings
 * are quoted; `null` renders as a muted token. Fully read-only — no editing,
 * no copying side effects.
 */
export function AuditJsonBlock({ value }: { value: unknown }) {
  if (value == null) {
    return (
      <span className="font-mono text-xs italic text-gray-400 dark:text-gray-500">
        null
      </span>
    );
  }

  let rendered: string;
  try {
    rendered = JSON.stringify(value, null, 2);
  } catch {
    rendered = String(value);
  }

  return (
    <pre className="max-h-64 overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs leading-relaxed text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
      {rendered}
    </pre>
  );
}

export default AuditJsonBlock;
