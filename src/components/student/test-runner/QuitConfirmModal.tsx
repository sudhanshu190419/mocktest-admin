'use client';

import React, { useEffect } from 'react';
import { X, SignOut, ShieldCheck } from '@phosphor-icons/react';

interface QuitConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export const QuitConfirmModal: React.FC<QuitConfirmModalProps> = ({ isOpen, onClose, onConfirm }) => {
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
      aria-label="Exit Test Session"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md bg-white rounded-t-sheet sm:rounded-sheet shadow-dialog border border-line overflow-hidden flex flex-col animate-pop-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-paper border-b border-line">
          <div className="flex items-center gap-2.5 text-ink">
            <div className="p-2 bg-sand text-sand-ink rounded-field">
              <SignOut size={20} weight="bold" />
            </div>
            <div>
              <h3 className="text-base font-bold text-ink">Exit Test Session?</h3>
              <p className="text-caption text-ink-secondary">Your answers are saved automatically</p>
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

        {/* Body */}
        <div className="p-6 flex flex-col gap-4 text-sm text-ink-secondary leading-relaxed">
          <div className="flex items-start gap-3 p-3.5 bg-mint border border-mint-ink/30 rounded-field text-mint-ink text-caption">
            <ShieldCheck size={20} weight="fill" className="text-mint-ink shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-mint-ink">Answers Persisted to Server</p>
              <p className="mt-0.5">
                All saved answers remain intact on the server. You can resume this attempt anytime before the timer expires.
              </p>
            </div>
          </div>
          <p className="text-ink text-sm">
            Are you sure you want to return to the test hub?
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 bg-paper border-t border-line">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 py-2.5 bg-white hover:bg-paper text-ink text-sm font-semibold rounded-field border border-line transition-colors cursor-pointer"
          >
            Continue Test
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-[44px] px-5 py-2.5 bg-sand text-sand-ink hover:bg-sand/80 text-sm font-bold rounded-field border border-sand-ink/30 shadow-xs transition-colors cursor-pointer"
          >
            Exit to Hub
          </button>
        </div>
      </div>
    </div>
  );
};
