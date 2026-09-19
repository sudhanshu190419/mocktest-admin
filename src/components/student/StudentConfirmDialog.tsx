'use client';

import React, { useEffect, useRef } from 'react';
import { WarningCircle, Info, CircleNotch } from '@phosphor-icons/react';

export interface StudentConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'default';
  loading?: boolean;
  children?: React.ReactNode;
}

export function StudentConfirmDialog({
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
}: StudentConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const iconMap = {
    danger: <WarningCircle size={24} weight="duotone" className="text-red-500" />,
    warning: <WarningCircle size={24} weight="duotone" className="text-amber-500" />,
    default: <Info size={24} weight="duotone" className="text-blue-500" />,
  };

  const confirmStyles = {
    danger: 'bg-red-600 hover:bg-red-700 text-white shadow-sm shadow-red-600/20',
    warning: 'bg-amber-600 hover:bg-amber-700 text-white shadow-sm shadow-amber-600/20',
    default: 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm shadow-blue-600/20',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Soft Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/30 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />
      {/* Dialog Container */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-confirm-title"
        className="relative z-10 w-full max-w-md rounded-3xl bg-white border border-slate-200/90 p-6 sm:p-7 shadow-2xl shadow-slate-900/10 animate-fadeIn"
      >
        <div className="flex items-start gap-4">
          <span className="w-10 h-10 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0">
            {iconMap[variant]}
          </span>
          <div className="flex-1">
            <h2
              id="student-confirm-title"
              className="text-base sm:text-lg font-bold text-slate-900 font-display leading-tight"
            >
              {title}
            </h2>
            <p className="mt-2 text-xs sm:text-sm text-slate-600 leading-relaxed">
              {message}
            </p>
          </div>
        </div>

        {children && <div className="mt-4">{children}</div>}

        <div className="mt-6 flex items-center justify-end gap-2.5 pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-semibold transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 disabled:opacity-50 ${confirmStyles[variant]}`}
          >
            {loading ? (
              <>
                <CircleNotch size={14} className="animate-spin" />
                <span>Processing...</span>
              </>
            ) : (
              <span>{confirmLabel}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
