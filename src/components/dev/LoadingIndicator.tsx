interface LoadingIndicatorProps {
  label?: string;
}

export default function LoadingIndicator({ label = 'Loading...' }: LoadingIndicatorProps) {
  return (
    <div className="flex items-center gap-2 text-xs text-gray-400">
      <span className="inline-block w-3 h-3 rounded-sm border border-gray-500 bg-gray-800" />
      <span>{label}</span>
    </div>
  );
}
