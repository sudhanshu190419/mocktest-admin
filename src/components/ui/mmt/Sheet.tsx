'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name — required. */
  title: string;
  /** Visually hide the title row (keep for screen readers). */
  hideTitle?: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * Bottom sheet on mobile / centered dialog on desktop (PRD §4.1, §9.2).
 * Portal-rendered; Escape and scrim click close it; focus moves inside
 * on open and returns to the trigger position on close.
 */
export function Sheet({ open, onClose, title, hideTitle = false, children, className }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const lastActiveRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    lastActiveRef.current = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    // Focus the panel once mounted
    const raf = requestAnimationFrame(() => {
      panelRef.current?.focus();
    });

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      cancelAnimationFrame(raf);
      lastActiveRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-[80] flex items-end justify-center sm:items-center',
        'bg-scrim backdrop-blur-[2px] animate-fade-quick'
      )}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'w-full max-w-lg max-h-[88vh] overflow-y-auto overscroll-contain',
          'rounded-t-sheet sm:rounded-sheet',
          'border border-line bg-surface p-5 sm:p-6 shadow-dialog',
          'animate-pop-in',
          'outline-none',
          className
        )}
      >
        <div className={cn('mb-4 flex items-center justify-between gap-4', hideTitle && 'sr-only')}>
          <h2 className="text-h3 font-bold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-2 text-ink-muted transition-colors hover:bg-paper hover:text-ink"
          >
            <X size={16} weight="bold" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}
