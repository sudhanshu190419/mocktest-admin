'use client';

import { useState } from 'react';

interface DebugInfo {
  label: string;
  value: string | null | undefined;
}

interface DebugPanelProps {
  /** Additional debug info specific to the current module page. */
  info?: DebugInfo[];
  /** The last API response to display. */
  lastResponse?: unknown;
  /** Label for the last operation performed. */
  lastOperation?: string;
}

export default function DebugPanel({ info, lastResponse, lastOperation }: DebugPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  const defaultInfo: DebugInfo[] = [
    { label: 'Environment', value: 'development' },
    { label: 'Runtime', value: typeof window !== 'undefined' ? 'client' : 'server' },
    { label: 'Last Operation', value: lastOperation ?? '—' },
  ];

  const allInfo = [...defaultInfo, ...(info ?? [])];

  return (
    <div className="mt-8 rounded-lg border border-amber-700/50 bg-amber-950/30 overflow-hidden">
      {/* Toggle header */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between px-4 py-2 text-xs font-medium text-amber-400 hover:bg-amber-950/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span>🐛</span>
          <span>Debug Panel</span>
          {lastOperation && (
            <span className="text-amber-600 font-normal">— {lastOperation}</span>
          )}
        </div>
        <span className="text-amber-600">{isOpen ? '▲' : '▼'}</span>
      </button>

      {/* Collapsible content */}
      {isOpen && (
        <div className="border-t border-amber-700/50 p-4 space-y-4">
          {/* Info table */}
          <table className="w-full text-xs">
            <tbody>
              {allInfo.map((item) => (
                <tr key={item.label} className="border-b border-amber-900/30 last:border-0">
                  <td className="py-1 pr-4 text-amber-600 w-36">{item.label}</td>
                  <td className="py-1 text-gray-300 font-mono">{item.value ?? 'null'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Last response */}
          {lastResponse !== undefined && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-amber-600 mb-1">
                Last API Response
              </div>
              <pre className="bg-black/50 rounded p-2 text-xs text-gray-300 overflow-x-auto max-h-48">
                {JSON.stringify(lastResponse, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
