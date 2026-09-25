'use client';

import React, { forwardRef } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const baseClasses =
  'inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap select-none ' +
  'rounded-[var(--radius-field,10px)] transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-out ' +
  'active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none cursor-pointer';

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--brand,#0284c7)] text-white shadow-sm hover:bg-[var(--brand-hover,#0369a1)] focus-visible:ring-2 focus-visible:ring-[var(--brand,#0284c7)]',
  secondary:
    'bg-white text-[var(--ink,#152b45)] border border-[var(--line,#d9e3ed)] hover:border-[var(--brand,#0284c7)] hover:bg-[var(--paper,#f3f8fc)]',
  ghost:
    'bg-transparent text-[var(--ink-secondary,#51637a)] hover:bg-[var(--paper,#f3f8fc)] hover:text-[var(--ink,#152b45)]',
  danger:
    'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-2 focus-visible:ring-red-600',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'min-h-[36px] px-3.5 text-xs sm:text-sm', // 36px visual, >=44px touch area handled via coarse pointer media
  md: 'min-h-[44px] px-5 text-sm',
  lg: 'min-h-[48px] px-6 text-base',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    fullWidth = false,
    leftIcon,
    rightIcon,
    className,
    type = 'button',
    children,
    ...rest
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        baseClasses,
        variantClasses[variant],
        sizeClasses[size],
        fullWidth && 'w-full',
        className
      )}
      {...rest}
    >
      {leftIcon && <span className="inline-flex shrink-0 items-center">{leftIcon}</span>}
      <span>{children}</span>
      {rightIcon && <span className="inline-flex shrink-0 items-center">{rightIcon}</span>}
    </button>
  );
});

export interface ButtonLinkProps extends React.ComponentProps<typeof Link> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  {
    variant = 'primary',
    size = 'md',
    fullWidth = false,
    leftIcon,
    rightIcon,
    className,
    children,
    ...rest
  },
  ref
) {
  return (
    <Link
      ref={ref}
      className={cn(
        baseClasses,
        variantClasses[variant],
        sizeClasses[size],
        fullWidth && 'w-full',
        className
      )}
      {...rest}
    >
      {leftIcon && <span className="inline-flex shrink-0 items-center">{leftIcon}</span>}
      <span>{children}</span>
      {rightIcon && <span className="inline-flex shrink-0 items-center">{rightIcon}</span>}
    </Link>
  );
});
