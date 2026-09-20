import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

const fieldBase =
  'h-11 w-full rounded-field border border-line bg-surface px-3.5 text-body text-ink ' +
  'placeholder:text-ink-muted transition-colors duration-200 ' +
  'hover:border-brand/40 disabled:opacity-50';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, className, ...rest },
  ref
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(fieldBase, invalid && 'border-error', className)}
      {...rest}
    />
  );
});

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, className, ...rest },
  ref
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(fieldBase, 'cursor-pointer pr-8', invalid && 'border-error', className)}
      {...rest}
    />
  );
});
