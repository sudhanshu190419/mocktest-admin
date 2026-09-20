import { cn } from '@/lib/cn';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Adds hover elevation (shadow + border). Never translates — PRD §8. */
  interactive?: boolean;
}

/**
 * The single card spec (PRD §3.1): white surface, 1px line,
 * shadow-card, radius-card. Tinted backgrounds are reserved for
 * semantic moments — pass a tint class explicitly when justified.
 */
export function Card({ interactive = false, className, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-card border border-line bg-surface shadow-card',
        interactive &&
          'transition-[border-color,box-shadow] duration-200 ease-coach hover:border-brand/40 hover:shadow-hover',
        className
      )}
      {...rest}
    />
  );
}

/** Standard inner padding for card bodies. */
export function CardBody({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5 sm:p-6', className)} {...rest} />;
}
