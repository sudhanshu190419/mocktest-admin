'use client';

import React from 'react';
import {
  SpinnerGap,
  CheckCircle,
  WarningCircle,
  ArrowClockwise,
  HourglassMedium,
} from '@phosphor-icons/react';

export type SubmissionStage = 'idle' | 'draining' | 'evaluating' | 'submitted' | 'error';

interface SubmissionOverlayProps {
  stage: SubmissionStage;
  isTimeout?: boolean;
  errorMessage?: string | null;
  onRetry: () => void;
  onGoToResults: () => void;
}

export const SubmissionOverlay: React.FC<SubmissionOverlayProps> = ({
  stage,
  isTimeout = false,
  errorMessage,
  onRetry,
  onGoToResults,
}) => {
  if (stage === 'idle') return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-200 select-none"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col p-6 sm:p-8 text-center animate-in zoom-in-95 duration-200">
        {/* Stage 1: Draining & Persisting Answers */}
        {stage === 'draining' && (
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="p-4 bg-sky-50 text-sky-600 rounded-2xl relative">
              <SpinnerGap size={40} className="animate-spin" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">
                {isTimeout ? 'Time Expired — Finalizing Exam' : 'Saving Final Answers'}
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">
                Flushing and guaranteeing all responses are securely persisted to the server...
              </p>
            </div>
          </div>
        )}

        {/* Stage 2: Server Evaluation */}
        {stage === 'evaluating' && (
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="p-4 bg-emerald-50 text-emerald-600 rounded-2xl relative">
              <HourglassMedium size={40} className="animate-pulse" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Submitting & Evaluating</h3>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">
                Executing authoritative test evaluation and generating performance metrics...
              </p>
            </div>
          </div>
        )}

        {/* Stage 3: Submitted & Evaluated Successfully */}
        {stage === 'submitted' && (
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="p-4 bg-emerald-100 text-emerald-600 rounded-2xl">
              <CheckCircle size={44} weight="fill" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-900">Test Submitted Successfully!</h3>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">
                Your responses have been evaluated and recorded.
              </p>
            </div>
            <button
              type="button"
              onClick={onGoToResults}
              className="mt-3 w-full py-3 px-6 rounded-xl font-bold text-sm bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-900/20 transition-all cursor-pointer"
            >
              View Test Details & Status
            </button>
          </div>
        )}

        {/* Stage 4: Submission Error */}
        {stage === 'error' && (
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="p-4 bg-rose-100 text-rose-600 rounded-2xl">
              <WarningCircle size={44} weight="fill" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Submission Interrupted</h3>
              <p className="text-xs sm:text-sm text-rose-600 font-medium mt-1">
                {errorMessage || 'Network error occurred while submitting test.'}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Your local answers are safely preserved. Click below to retry submission.
              </p>
            </div>
            <div className="flex gap-3 w-full mt-3">
              <button
                type="button"
                onClick={onRetry}
                className="flex-1 py-3 px-4 rounded-xl font-bold text-sm bg-sky-600 hover:bg-sky-700 text-white shadow-md shadow-sky-900/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <ArrowClockwise size={18} weight="bold" />
                <span>Retry Submission</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
