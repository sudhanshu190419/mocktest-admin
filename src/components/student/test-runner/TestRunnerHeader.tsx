'use client';

import React from 'react';
import {
  Timer,
  SpinnerGap,
  CloudCheck,
  WarningCircle,
  Calculator,
  SignOut,
  PaperPlaneRight,
  ArrowsOut,
  ArrowsIn,
  WifiSlash,
} from '@phosphor-icons/react';
import type { SaveStatus } from '@/services/student/webPersistenceQueue';

interface TestRunnerHeaderProps {
  title: string;
  testType?: string;
  remainingSeconds: number;
  formattedTime: string;
  saveStatus: SaveStatus;
  isOnline?: boolean;
  isFullscreen?: boolean;
  fullscreenSupported?: boolean;
  calculatorAllowed?: boolean;
  isSubmitting?: boolean;
  onToggleFullscreen?: () => void;
  onOpenCalculator?: () => void;
  onExit: () => void;
  onSubmit: () => void;
}

export const TestRunnerHeader: React.FC<TestRunnerHeaderProps> = ({
  title,
  testType = 'MOCK TEST',
  remainingSeconds,
  formattedTime,
  saveStatus,
  isOnline = true,
  isFullscreen = false,
  fullscreenSupported = true,
  calculatorAllowed = false,
  isSubmitting = false,
  onToggleFullscreen,
  onOpenCalculator,
  onExit,
  onSubmit,
}) => {
  // Timer Urgency States (PRD §9.1: neutral -> amber <= 5 min -> red <= 1 min, non-pulsing)
  const isExpired = remainingSeconds <= 0;
  const isCritical = remainingSeconds > 0 && remainingSeconds <= 60; // <= 1 minute
  const isWarning = remainingSeconds > 60 && remainingSeconds <= 300; // <= 5 minutes

  // Timer Color Theme (strictly non-pulsing)
  let timerBadgeClasses = 'bg-white/10 text-white border-white/20';
  let timerIconClasses = 'text-sky-tint';

  if (isExpired) {
    timerBadgeClasses = 'bg-red-950 text-red-200 border-red-800';
    timerIconClasses = 'text-red-400';
  } else if (isCritical) {
    timerBadgeClasses = 'bg-red-500/25 text-red-300 border-red-500/50';
    timerIconClasses = 'text-red-400';
  } else if (isWarning) {
    timerBadgeClasses = 'bg-amber-500/25 text-amber-300 border-amber-500/50';
    timerIconClasses = 'text-amber-400';
  }

  // Save Status Badge Config
  const renderSaveStatus = () => {
    if (!isOnline) {
      return (
        <div
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-caption font-medium bg-red-950/70 text-red-300 border border-red-800"
          title="Network connection lost. Answers are safely cached locally."
        >
          <WifiSlash size={14} weight="bold" className="text-red-400" />
          <span>Offline (Buffered)</span>
        </div>
      );
    }

    switch (saveStatus) {
      case 'saving':
        return (
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-caption font-medium bg-ink/80 text-sky-ink border border-line/20">
            <SpinnerGap size={14} className="animate-spin text-sky-tint" />
            <span>Saving...</span>
          </div>
        );
      case 'pending':
        return (
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-caption font-medium bg-amber-950/80 text-amber-300 border border-amber-800">
            <WarningCircle size={14} weight="fill" className="text-amber-400" />
            <span>Save pending</span>
          </div>
        );
      case 'failed':
        return (
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-caption font-medium bg-red-950/80 text-red-300 border border-red-800">
            <WarningCircle size={14} weight="fill" className="text-red-400" />
            <span>Sync retry</span>
          </div>
        );
      case 'saved':
      default:
        return (
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-caption font-medium bg-emerald-950/80 text-emerald-300 border border-emerald-800">
            <CloudCheck size={14} weight="bold" className="text-emerald-400" />
            <span>Saved</span>
          </div>
        );
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-ink text-sky-tint border-b border-ink px-4 sm:px-6 py-3 shadow-md flex items-center justify-between gap-4 select-none">
      {/* 1. Left: Test Info */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-field text-caption font-bold tracking-wider uppercase bg-brand/30 text-white border border-brand/40">
              {testType.replace(/_/g, ' ')}
            </span>
            <span className="text-caption text-ink-secondary hidden md:inline">Exam in progress</span>
          </div>
          <h1 className="text-sm sm:text-base font-bold text-white truncate max-w-xs sm:max-w-md mt-0.5" title={title}>
            {title}
          </h1>
        </div>
      </div>

      {/* 2. Middle: Timer & Auto-Save */}
      <div className="flex items-center gap-3">
        {/* Countdown Timer Pill (non-pulsing color shift) */}
        <div
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full border shadow-inner transition-colors duration-200 ${timerBadgeClasses}`}
          title={isExpired ? 'Time has expired' : 'Authoritative Time Remaining'}
        >
          <Timer size={18} weight={isCritical ? 'fill' : 'bold'} className={timerIconClasses} />
          <span className="font-mono text-sm sm:text-base font-bold tracking-wider tabular-nums">
            {formattedTime}
          </span>
        </div>

        {/* Persistence Status */}
        {renderSaveStatus()}
      </div>

      {/* 3. Right: Tools & Actions */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {/* Fullscreen Toggle */}
        {fullscreenSupported && onToggleFullscreen && (
          <button
            type="button"
            onClick={onToggleFullscreen}
            className="flex items-center justify-center gap-1.5 min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-field text-caption font-medium bg-white/10 hover:bg-white/20 text-white border border-white/20 transition-colors cursor-pointer"
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            aria-label={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
          >
            {isFullscreen ? (
              <>
                <ArrowsIn size={16} weight="bold" />
                <span className="hidden md:inline">Exit Fullscreen</span>
              </>
            ) : (
              <>
                <ArrowsOut size={16} weight="bold" />
                <span className="hidden md:inline">Fullscreen</span>
              </>
            )}
          </button>
        )}

        {/* Scientific Calculator Trigger */}
        {calculatorAllowed && onOpenCalculator && (
          <button
            type="button"
            onClick={onOpenCalculator}
            className="flex items-center justify-center gap-1.5 min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-field text-caption font-medium bg-white/10 hover:bg-white/20 text-white border border-white/20 transition-colors cursor-pointer"
            title="Open Scientific Calculator"
          >
            <Calculator size={16} weight="bold" className="text-amber-300" />
            <span className="hidden md:inline">Calculator</span>
          </button>
        )}

        {/* Quit / Exit Button */}
        <button
          type="button"
          onClick={onExit}
          disabled={isSubmitting}
          className="flex items-center justify-center gap-1 min-h-[44px] min-w-[44px] px-2.5 sm:px-3 py-1.5 rounded-field text-caption font-semibold text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-50"
          title="Exit test session"
        >
          <SignOut size={16} weight="bold" />
          <span className="hidden sm:inline">Exit</span>
        </button>

        {/* Submit Button */}
        <button
          type="button"
          onClick={onSubmit}
          disabled={isSubmitting}
          className="flex items-center justify-center gap-1.5 min-h-[44px] px-3.5 sm:px-4 py-1.5 rounded-field text-caption sm:text-sm font-bold bg-brand hover:bg-brand-hover text-white shadow-sm transition-all cursor-pointer disabled:opacity-50"
        >
          {isSubmitting ? (
            <>
              <SpinnerGap size={16} className="animate-spin" />
              <span>Submitting...</span>
            </>
          ) : (
            <>
              <PaperPlaneRight size={16} weight="fill" />
              <span>Submit</span>
            </>
          )}
        </button>
      </div>
    </header>
  );
};
