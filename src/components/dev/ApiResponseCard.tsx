import { ReactNode } from 'react';

interface ApiResponseCardProps {
  /** The title of the API operation. */
  title: string;
  /** Whether the API call succeeded. */
  success?: boolean | null;
  /** The response data to display. */
  data?: unknown;
  /** Error message if the call failed. */
  error?: string | null;
  /** Additional action buttons or controls. */
  children?: ReactNode;
}

export default function ApiResponseCard({
  title,
  success,
  data,
  error,
  children,
}: ApiResponseCardProps) {
  const statusColor =
    success === true ? 'border-green-700/50' : success === false ? 'border-red-700/50' : 'border-gray-700';

  return (
    <div className={`rounded border ${statusColor} bg-gray-900 overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 bg-gray-800/50">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-200">{title}</span>
          {success !== undefined && (
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                success === true ? 'bg-green-400' : success === false ? 'bg-red-400' : 'bg-gray-500'
              }`}
            />
          )}
        </div>
        {children}
      </div>

      {/* Body */}
      <div className="p-3 space-y-2">
        {error && (
          <div className="rounded bg-red-950/40 border border-red-800/50 px-3 py-2">
            <span className="text-xs text-red-400 font-medium">Error: </span>
            <span className="text-xs text-red-300">{error}</span>
          </div>
        )}

        {data !== undefined && (
          <pre className="text-xs text-gray-300 font-mono overflow-x-auto max-h-48">
            {JSON.stringify(data, null, 2)}
          </pre>
        )}

        {!error && data === undefined && (
          <span className="text-xs text-gray-600 italic">No response data</span>
        )}
      </div>
    </div>
  );
}
