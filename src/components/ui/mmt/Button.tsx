'use client';

import { forwardRef } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap select-none ' +
  'rounded-field transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-coach ' +
  'active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white shadow-card hover:bg-brand-hover',
  secondary: 'bg-surface text-ink border border-line hover:border-brand/40 hover:shadow-card',
  ghost: 'bg-transparent text-ink-secondary hover:bg-paper hover:text-ink',
  danger: 'bg-error text-white hover:brightness-95',
};

/** Touch-target rule: visual height < 44px is fine, hit area is not —
 *  the tokens.css coarse-pointer rule pads interactive elements; these
 *  sizes already meet it on touch. */
const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3.5 text-meta', // 36px desktop visual
  md: 'h-11 px-5 text-body', // 44px
  lg: 'h-12 px-6 text-body', // 48px
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(base, variants[variant], sizes[size], className)}
      {...rest}
    />
  );
});

export interface ButtonLinkProps extends React.ComponentProps<typeof Link> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** Same treatment for next/link destinations. */
export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  { variant = 'primary', size = 'md', className, ...rest },
  ref
) {
  return (
    <Link
      ref={ref}
      className={cn(base, variants[variant], sizes[size], className)}
      {...rest}
    />
  );
});
