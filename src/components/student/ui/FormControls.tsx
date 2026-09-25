'use client';

import React, { forwardRef, useId } from 'react';
import { cn } from '@/lib/cn';

export interface FormInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  errorText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  containerClassName?: string;
}

export const FormInput = forwardRef<HTMLInputElement, FormInputProps>(function FormInput(
  {
    label,
    helperText,
    errorText,
    leftIcon,
    rightIcon,
    id: customId,
    className,
    required,
    disabled,
    ...rest
  },
  ref
) {
  const generatedId = useId();
  const id = customId || generatedId;
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;

  const hasError = Boolean(errorText);

  return (
    <div className={cn('w-full flex flex-col gap-1.5', className)}>
      {label && (
        <label
          htmlFor={id}
          className="text-sm font-medium text-[var(--ink,#152b45)] flex items-center justify-between"
        >
          <span>
            {label}
            {required && <span className="text-red-500 ml-0.5">*</span>}
          </span>
        </label>
      )}

      <div className="relative flex items-center w-full">
        {leftIcon && (
          <span className="absolute left-3.5 text-[var(--ink-secondary,#51637a)] pointer-events-none flex items-center">
            {leftIcon}
          </span>
        )}
        <input
          ref={ref}
          id={id}
          required={required}
          disabled={disabled}
          aria-invalid={hasError ? 'true' : undefined}
          aria-describedby={
            hasError ? errorId : helperText ? helperId : undefined
          }
          className={cn(
            'w-full min-h-[44px] rounded-[var(--radius-field,10px)] border bg-white px-3.5 text-sm text-[var(--ink,#152b45)] ' +
              'placeholder:text-[var(--ink-muted,#5e7084)] transition-colors duration-150 ' +
              'focus:outline-none focus:border-[var(--brand,#0284c7)] ' +
              'disabled:bg-[var(--paper,#f3f8fc)] disabled:opacity-60 disabled:cursor-not-allowed',
            leftIcon ? 'pl-10' : 'pl-3.5',
            rightIcon ? 'pr-10' : 'pr-3.5',
            hasError
              ? 'border-red-500 focus:border-red-600'
              : 'border-[var(--line,#d9e3ed)] hover:border-[var(--brand,#0284c7)]/40'
          )}
          {...rest}
        />
        {rightIcon && (
          <span className="absolute right-3.5 text-[var(--ink-secondary,#51637a)] flex items-center">
            {rightIcon}
          </span>
        )}
      </div>

      {hasError ? (
        <p id={errorId} className="text-xs text-red-600 font-medium">
          {errorText}
        </p>
      ) : helperText ? (
        <p id={helperId} className="text-xs text-[var(--ink-secondary,#51637a)]">
          {helperText}
        </p>
      ) : null}
    </div>
  );
});

export interface FormSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  helperText?: string;
  errorText?: string;
  containerClassName?: string;
}

export const FormSelect = forwardRef<HTMLSelectElement, FormSelectProps>(function FormSelect(
  {
    label,
    helperText,
    errorText,
    id: customId,
    className,
    required,
    disabled,
    children,
    ...rest
  },
  ref
) {
  const generatedId = useId();
  const id = customId || generatedId;
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;
  const hasError = Boolean(errorText);

  return (
    <div className={cn('w-full flex flex-col gap-1.5', className)}>
      {label && (
        <label
          htmlFor={id}
          className="text-sm font-medium text-[var(--ink,#152b45)]"
        >
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}

      <select
        ref={ref}
        id={id}
        required={required}
        disabled={disabled}
        aria-invalid={hasError ? 'true' : undefined}
        aria-describedby={hasError ? errorId : helperText ? helperId : undefined}
        className={cn(
          'w-full min-h-[44px] rounded-[var(--radius-field,10px)] border bg-white px-3.5 pr-8 text-sm text-[var(--ink,#152b45)] ' +
            'cursor-pointer transition-colors duration-150 focus:outline-none focus:border-[var(--brand,#0284c7)] ' +
            'disabled:bg-[var(--paper,#f3f8fc)] disabled:opacity-60 disabled:cursor-not-allowed',
          hasError
            ? 'border-red-500 focus:border-red-600'
            : 'border-[var(--line,#d9e3ed)] hover:border-[var(--brand,#0284c7)]/40'
        )}
        {...rest}
      >
        {children}
      </select>

      {hasError ? (
        <p id={errorId} className="text-xs text-red-600 font-medium">
          {errorText}
        </p>
      ) : helperText ? (
        <p id={helperId} className="text-xs text-[var(--ink-secondary,#51637a)]">
          {helperText}
        </p>
      ) : null}
    </div>
  );
});
