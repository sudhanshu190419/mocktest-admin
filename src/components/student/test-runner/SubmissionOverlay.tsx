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

  const currentStep =
    stage === 'draining' ? 1 : stage === 'evaluating' ? 2 : stage === 'submitted' ? 3 : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim backdrop-blur-xs p-4 animate-fade-quick select-none"
      role="dialog"
      aria-modal="true"
      aria-label="Submission status"
    >
      <div className="w-full max-w-md bg-white rounded-sheet shadow-dialog border border-line overflow-hidden flex flex-col p-6 sm:p-8 text-center animate-pop-in">
        {/* Stage Progression Indicator (Saving answers -> Evaluating -> Results) */}
        <div className="flex items-center justify-between mb-6 px-2">
          {/* Step 1 */}
          <div className="flex flex-col items-center gap-1.5 flex-1">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-caption font-bold transition-colors ${
                currentStep >= 1
                  ? 'bg-brand text-white'
                  : 'bg-paper text-ink-secondary border border-line'
              }`}
            >
              {currentStep > 1 ? '✓' : '1'}
            </div>
            <span
              className={`text-caption font-semibold ${
                currentStep === 1 ? 'text-brand font-bold' : 'text-ink-secondary'
              }`}
            >
              Saving answers
            </span>
          </div>

          {/* Connector Line 1-2 */}
          <div
            className={`h-0.5 flex-1 -mt-5 transition-colors ${
              currentStep >= 2 ? 'bg-brand' : 'bg-line'
            }`}
          />

          {/* Step 2 */}
          <div className="flex flex-col items-center gap-1.5 flex-1">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-caption font-bold transition-colors ${
                currentStep >= 2
                  ? 'bg-brand text-white'
                  : 'bg-paper text-ink-secondary border border-line'
              }`}
            >
              {currentStep > 2 ? '✓' : '2'}
            </div>
            <span
              className={`text-caption font-semibold ${
                currentStep === 2 ? 'text-brand font-bold' : 'text-ink-secondary'
              }`}
            >
              Evaluating
            </span>
          </div>

          {/* Connector Line 2-3 */}
          <div
            className={`h-0.5 flex-1 -mt-5 transition-colors ${
              currentStep >= 3 ? 'bg-brand' : 'bg-line'
            }`}
          />

          {/* Step 3 */}
          <div className="flex flex-col items-center gap-1.5 flex-1">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-caption font-bold transition-colors ${
                currentStep >= 3
                  ? 'bg-emerald-600 text-white'
                  : 'bg-paper text-ink-secondary border border-line'
              }`}
            >
              3
            </div>
            <span
              className={`text-caption font-semibold ${
                currentStep === 3 ? 'text-emerald-700 font-bold' : 'text-ink-secondary'
              }`}
            >
              Results
            </span>
          </div>
        </div>

        {/* Stage 1: Draining & Persisting Answers */}
        {stage === 'draining' && (
          <div className="flex flex-col items-center gap-4 py-3">
            <div className="p-4 bg-sky-tint text-brand rounded-card relative">
              <SpinnerGap size={40} className="animate-spin text-brand" />
            </div>
            <div>
              <h3 className="text-h3 font-bold text-ink">
                {isTimeout ? 'Time Expired — Saving answers' : 'Saving answers'}
              </h3>
              <p className="text-caption sm:text-sm text-ink-secondary mt-1 leading-relaxed">
                Flushing and guaranteeing all responses are securely persisted to the server...
              </p>
            </div>
          </div>
        )}

        {/* Stage 2: Server Evaluation */}
        {stage === 'evaluating' && (
          <div className="flex flex-col items-center gap-4 py-3">
            <div className="p-4 bg-sky-tint text-brand rounded-card relative">
              <HourglassMedium size={40} className="text-brand animate-spin" />
            </div>
            <div>
              <h3 className="text-h3 font-bold text-ink">Evaluating</h3>
              <p className="text-caption sm:text-sm text-ink-secondary mt-1 leading-relaxed">
                Executing authoritative test evaluation and compiling performance insights...
              </p>
            </div>
          </div>
        )}

        {/* Stage 3: Submitted & Evaluated Successfully */}
        {stage === 'submitted' && (
          <div className="flex flex-col items-center gap-4 py-3">
            <div className="p-4 bg-mint text-mint-ink rounded-card">
              <CheckCircle size={44} weight="fill" className="text-emerald-600" />
            </div>
            <div>
              <h3 className="text-h2 font-bold text-ink">Results Ready</h3>
              <p className="text-caption sm:text-sm text-ink-secondary mt-1 leading-relaxed">
                Your test attempt has been evaluated and recorded.
              </p>
            </div>
            <button
              type="button"
              onClick={onGoToResults}
              className="mt-3 w-full min-h-[44px] py-3 px-6 rounded-field font-bold text-sm bg-brand hover:bg-brand-hover text-white shadow-md shadow-card transition-all cursor-pointer"
            >
              View results
            </button>
          </div>
        )}

        {/* Stage 4: Submission Error */}
        {stage === 'error' && (
          <div className="flex flex-col items-center gap-4 py-3">
            <div className="p-4 bg-red-500/20 text-red-700 rounded-card">
              <WarningCircle size={44} weight="fill" className="text-red-600" />
            </div>
            <div>
              <h3 className="text-h3 font-bold text-ink">Couldn&apos;t submit test</h3>
              <p className="text-caption sm:text-sm text-red-600 font-medium mt-1">
                {errorMessage || 'Network error occurred while submitting test.'}
              </p>
              <p className="text-caption text-ink-secondary mt-1">
                Your responses are safely cached locally. Tap below to retry.
              </p>
            </div>
            <div className="flex gap-3 w-full mt-3">
              <button
                type="button"
                onClick={onRetry}
                className="flex-1 min-h-[44px] py-3 px-4 rounded-field font-bold text-sm bg-brand hover:bg-brand-hover text-white shadow-md shadow-card transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <ArrowClockwise size={18} weight="bold" />
                <span>Retry submission</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
