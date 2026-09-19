type Variant = "default" | "active" | "success" | "error" | "warning" | "outline";

const variants: Record<Variant, string> = {
  default: "bg-brand-soft text-brand",
  active: "bg-brand text-ink-inverse",
  success: "bg-tint-green text-success",
  error: "bg-tint-red text-error",
  warning: "bg-tint-amber text-warning",
  outline: "border border-border bg-surface text-ink-secondary",
};

/** Pill chip — status labels, filters, tags. */
export function Chip({
  variant = "default",
  className = "",
  children,
}: {
  variant?: Variant;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-sm font-semibold ${variants[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
