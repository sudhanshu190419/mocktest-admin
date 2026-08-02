'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'default';
  loading?: boolean;
  /** Optional extra content rendered between the message and the buttons (e.g. a reason input). */
  children?: React.ReactNode;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  loading = false,
  children,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const confirmStyles = {
    danger:
      'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500',
    warning:
      'bg-amber-600 text-white hover:bg-amber-700 focus-visible:ring-amber-500',
    default:
      'bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-blue-500',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className={cn(
          'relative z-10 w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-xl',
          'animate-[fadeIn_200ms_ease-out]',
          'dark:border-gray-700 dark:bg-gray-900',
        )}
      >
        <h2
          id="confirm-title"
          className="text-lg font-semibold text-gray-900 dark:text-gray-100"
        >
          {title}
        </h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          {message}
        </p>
        {children}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50',
              confirmStyles[variant],
            )}
          >
            {loading ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
