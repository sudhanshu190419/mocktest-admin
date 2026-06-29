type StatusVariant = 'success' | 'error' | 'warning' | 'info' | 'neutral';

interface StatusBadgeProps {
  label: string;
  variant?: StatusVariant;
}

const VARIANT_STYLES: Record<StatusVariant, string> = {
  success: 'bg-green-950/50 text-green-400 border-green-700/50',
  error: 'bg-red-950/50 text-red-400 border-red-700/50',
  warning: 'bg-amber-950/50 text-amber-400 border-amber-700/50',
  info: 'bg-blue-950/50 text-blue-400 border-blue-700/50',
  neutral: 'bg-gray-800 text-gray-400 border-gray-700',
};

export default function StatusBadge({ label, variant = 'neutral' }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider border ${VARIANT_STYLES[variant]}`}
    >
      {label}
    </span>
  );
}
