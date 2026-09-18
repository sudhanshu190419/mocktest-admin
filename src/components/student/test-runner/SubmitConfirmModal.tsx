'use client';

import React from 'react';
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
  notVisitedCount,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-sky-100 text-sky-700 rounded-xl">
              <Question size={20} weight="bold" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Confirm Test Submission</h3>
              <p className="text-xs text-slate-500">Review your question summary before submitting</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X size={18} weight="bold" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex flex-col gap-5">
          {/* Summary Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-center">
              <div className="flex items-center justify-center gap-1 text-emerald-700 mb-1">
                <CheckCircle size={16} weight="fill" />
                <span className="text-xs font-semibold">Answered</span>
              </div>
              <div className="text-2xl font-bold text-emerald-800">{answeredCount}</div>
            </div>

            <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl text-center">
              <div className="flex items-center justify-center gap-1 text-purple-700 mb-1">
                <BookmarkSimple size={16} weight="fill" />
                <span className="text-xs font-semibold">Marked</span>
              </div>
              <div className="text-2xl font-bold text-purple-800">{markedCount}</div>
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-center">
              <div className="flex items-center justify-center gap-1 text-amber-700 mb-1">
                <WarningCircle size={16} weight="fill" />
                <span className="text-xs font-semibold">Unanswered</span>
              </div>
              <div className="text-2xl font-bold text-amber-800">{unansweredCount}</div>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-center">
              <div className="flex items-center justify-center gap-1 text-slate-600 mb-1">
                <span className="text-xs font-semibold">Total</span>
              </div>
              <div className="text-2xl font-bold text-slate-800">{totalQuestions}</div>
            </div>
          </div>

          <div className="p-4 bg-sky-50 border border-sky-100 rounded-xl text-xs text-sky-900 leading-relaxed">
            <p className="font-semibold mb-1">Notice on Submission:</p>
            <p>
              Once you submit, you cannot change your answers. In this preview step, final submission evaluation is gated until the next phase.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 bg-slate-50 border-t border-slate-200">
          <button
            onClick={onClose}
            className="px-4 py-2.5 bg-white hover:bg-slate-100 text-slate-700 text-sm font-semibold rounded-xl border border-slate-300 transition-colors cursor-pointer"
          >
            Resume Test
          </button>
          <button
            onClick={onConfirm}
            className="px-5 py-2.5 bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold rounded-xl shadow-sm transition-colors cursor-pointer"
          >
            Submit Test
          </button>
        </div>
      </div>
    </div>
  );
};
