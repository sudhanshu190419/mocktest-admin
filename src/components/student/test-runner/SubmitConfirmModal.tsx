'use client';

import React, { useEffect } from 'react';
import { X, CheckCircle, WarningCircle, BookmarkSimple, Question } from '@phosphor-icons/react';

interface SubmitConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  totalQuestions: number;
  answeredCount: number;
  markedCount: number;
  unansweredCount: number;
  notVisitedCount: number;
}

export const SubmitConfirmModal: React.FC<SubmitConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  totalQuestions,
  answeredCount,
  markedCount,
  unansweredCount,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-scrim backdrop-blur-xs p-0 sm:p-4 animate-fade-quick"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm Test Submission"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg bg-white rounded-t-sheet sm:rounded-sheet shadow-dialog border border-line overflow-hidden flex flex-col animate-pop-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-paper border-b border-line">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-sky-tint text-brand rounded-field">
              <Question size={20} weight="bold" />
            </div>
            <div>
              <h3 className="text-base font-bold text-ink">Confirm Test Submission</h3>
              <p className="text-caption text-ink-secondary">Review your question summary before submitting</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-ink-secondary hover:text-ink hover:bg-sky-tint rounded-full transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X size={18} weight="bold" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex flex-col gap-5">
          {/* Summary Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 bg-mint border border-mint-ink/30 rounded-field text-center">
              <div className="flex items-center justify-center gap-1 text-mint-ink mb-1">
                <CheckCircle size={16} weight="fill" />
                <span className="text-caption font-bold">Answered</span>
              </div>
              <div className="text-2xl font-bold text-mint-ink tabular-nums">{answeredCount}</div>
            </div>

            <div className="p-3 bg-lilac border border-lilac-ink/30 rounded-field text-center">
              <div className="flex items-center justify-center gap-1 text-lilac-ink mb-1">
                <BookmarkSimple size={16} weight="fill" />
                <span className="text-caption font-bold">Marked</span>
              </div>
              <div className="text-2xl font-bold text-lilac-ink tabular-nums">{markedCount}</div>
            </div>

            <div className="p-3 bg-sand border border-sand-ink/30 rounded-field text-center">
              <div className="flex items-center justify-center gap-1 text-sand-ink mb-1">
                <WarningCircle size={16} weight="fill" />
                <span className="text-caption font-bold">Unanswered</span>
              </div>
              <div className="text-2xl font-bold text-sand-ink tabular-nums">{unansweredCount}</div>
            </div>

            <div className="p-3 bg-paper border border-line rounded-field text-center">
              <div className="flex items-center justify-center gap-1 text-ink-secondary mb-1">
                <span className="text-caption font-bold">Total</span>
              </div>
              <div className="text-2xl font-bold text-ink tabular-nums">{totalQuestions}</div>
            </div>
          </div>

          <div className="p-4 bg-sky-tint border border-line rounded-field text-caption text-ink leading-relaxed">
            <p className="font-bold mb-1">Notice on Submission:</p>
            <p>
              Once you submit, your test attempt will be evaluated and final scores will be calculated.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 bg-paper border-t border-line">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 py-2.5 bg-white hover:bg-paper text-ink text-sm font-semibold rounded-field border border-line transition-colors cursor-pointer"
          >
            Resume Test
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-[44px] px-5 py-2.5 bg-brand hover:bg-brand-hover text-white text-sm font-bold rounded-field shadow-xs transition-colors cursor-pointer"
          >
            Submit Test
          </button>
        </div>
      </div>
    </div>
  );
};
