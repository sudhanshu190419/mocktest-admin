/**
 * Card primitive — white surface, soft blue border, blue-tinted shadow.
 * `interactive` adds the hover lift used on course/test cards.
 */
export function Card({
  interactive = false,
  className = "",
  children,
}: {
  interactive?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-card border border-border bg-surface shadow-card ${
        interactive
          ? "transition-all duration-200 hover:-translate-y-0.5 hover:shadow-pop"
          : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}
