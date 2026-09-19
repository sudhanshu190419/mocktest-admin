import Link from "next/link";

type Variant = "primary" | "secondary" | "ghost";
type Size = "md" | "sm";

const base =
  "inline-flex items-center justify-center gap-2 rounded-pill font-semibold transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:pointer-events-none disabled:bg-ink-muted/40 disabled:text-ink-inverse";

const variants: Record<Variant, string> = {
  primary: "bg-brand text-ink-inverse shadow-card hover:bg-brand-hover active:shadow-none",
  secondary: "border-[1.5px] border-brand bg-surface text-brand hover:bg-brand-soft",
  ghost: "text-brand hover:bg-brand-soft",
};

const sizes: Record<Size, string> = {
  md: "min-h-12 px-6 text-[15px]",
  sm: "min-h-10 px-4 text-sm",
};

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export function Button({ variant = "primary", size = "md", className = "", ...props }: ButtonProps) {
  return <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props} />;
}

type ButtonLinkProps = React.ComponentProps<typeof Link> & {
  variant?: Variant;
  size?: Size;
};

export function ButtonLink({ variant = "primary", size = "md", className = "", ...props }: ButtonLinkProps) {
  return <Link className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props} />;
}
