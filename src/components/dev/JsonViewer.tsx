interface JsonViewerProps {
  data: unknown;
  label?: string;
  collapsed?: boolean;
}

export default function JsonViewer({ data, label, collapsed = false }: JsonViewerProps) {
  if (data === null || data === undefined) {
    return (
      <div className="rounded border border-gray-700 bg-gray-900 p-3">
        {label && <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">{label}</div>}
        <span className="text-xs text-gray-500 italic">null / undefined</span>
      </div>
    );
  }

  return (
    <div className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
      {label && (
        <div className="px-3 py-1.5 border-b border-gray-700 bg-gray-800/50">
          <span className="text-[10px] uppercase tracking-wider text-gray-500">{label}</span>
        </div>
      )}
      <pre
        className={`p-3 text-xs text-gray-300 font-mono overflow-x-auto ${
          collapsed ? 'max-h-32 overflow-y-hidden relative' : ''
        }`}
      >
        {JSON.stringify(data, null, 2)}
        {collapsed && (
          <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-gray-900 to-transparent" />
        )}
      </pre>
    </div>
  );
}
