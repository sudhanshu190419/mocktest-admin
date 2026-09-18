'use client';

import React from 'react';
import { X, SignOut, ShieldCheck } from '@phosphor-icons/react';

interface QuitConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export const QuitConfirmModal: React.FC<QuitConfirmModalProps> = ({ isOpen, onClose, onConfirm }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center gap-2.5 text-slate-800">
            <div className="p-2 bg-amber-100 text-amber-800 rounded-xl">
              <SignOut size={20} weight="bold" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Exit Test Session?</h3>
              <p className="text-xs text-slate-500">Your answers are saved automatically</p>
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

        {/* Body */}
        <div className="p-6 flex flex-col gap-4 text-sm text-slate-600 leading-relaxed">
          <div className="flex items-start gap-3 p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 text-xs">
            <ShieldCheck size={20} weight="fill" className="text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-emerald-800">Answers Persisted to Server</p>
              <p className="mt-0.5 text-emerald-700">
                All saved answers remain intact on the server. You can resume this attempt anytime before the timer expires.
              </p>
            </div>
          </div>
          <p>
            Are you sure you want to return to the test hub?
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 bg-slate-50 border-t border-slate-200">
          <button
            onClick={onClose}
            className="px-4 py-2.5 bg-white hover:bg-slate-100 text-slate-700 text-sm font-semibold rounded-xl border border-slate-300 transition-colors cursor-pointer"
          >
            Continue Test
          </button>
          <button
            onClick={onConfirm}
            className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-xl shadow-sm transition-colors cursor-pointer"
          >
            Exit to Hub
          </button>
        </div>
      </div>
    </div>
  );
};
