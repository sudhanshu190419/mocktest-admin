'use client';

import React from 'react';
import Link from 'next/link';
import { CircleNotch, WarningCircle, ArrowLeft, ArrowsClockwise } from '@phosphor-icons/react';

interface ClassConnectionStateProps {
  type: 'authorizing' | 'connecting' | 'reconnecting' | 'error';
  errorMessage?: string;
  onRetry?: () => void;
}

export const ClassConnectionState: React.FC<ClassConnectionStateProps> = ({
  type,
  errorMessage,
  onRetry,
}) => {
  if (type === 'error') {
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-4">
        <div className="max-w-md w-full p-8 rounded-sheet bg-ink border border-ink text-center text-white space-y-4 shadow-2xl">
          <div className="w-14 h-14 rounded-card bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto border border-rose-500/30">
            <WarningCircle size={28} weight="bold" />
          </div>

          <div className="space-y-1.5">
            <h2 className="text-lg font-black text-white">Classroom Access Notice</h2>
            <p className="text-xs text-ink-muted leading-relaxed">
              {errorMessage || 'Unable to join this live classroom session.'}
            </p>
          </div>

          <div className="pt-3 flex flex-col sm:flex-row items-center justify-center gap-3">
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-field bg-brand hover:bg-brand text-white font-bold text-xs transition-colors shadow-md"
              >
                <ArrowsClockwise size={14} weight="bold" />
                <span>Retry Connection</span>
              </button>
            )}

            <Link
              href="/student/classes"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-field bg-ink hover:bg-ink text-ink-muted font-bold text-xs transition-colors border border-ink"
            >
              <ArrowLeft size={14} weight="bold" />
              <span>Back to Classes</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const titles = {
    authorizing: 'Verifying Classroom Access...',
    connecting: 'Connecting to Live Classroom...',
    reconnecting: 'Re-establishing Live Stream...',
  };

  const descriptions = {
    authorizing: 'Verifying your batch enrollment and generating secure session token.',
    connecting: 'Establishing high-definition WebRTC connection with LiveKit Cloud.',
    reconnecting: 'Temporary network interruption detected. Reconnecting automatically.',
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4">
      <div className="max-w-md w-full p-8 rounded-sheet bg-ink/90 border border-ink text-center text-white space-y-4 shadow-2xl backdrop-blur-md">
        <div className="w-14 h-14 rounded-card bg-brand/20 text-sky-ink flex items-center justify-center mx-auto border border-brand/30">
          <CircleNotch size={28} weight="bold" className="animate-spin text-sky-ink" />
        </div>

        <div className="space-y-1.5">
          <h2 className="text-base sm:text-lg font-black text-white">{titles[type]}</h2>
          <p className="text-xs text-ink-muted leading-relaxed max-w-sm mx-auto">
            {descriptions[type]}
          </p>
        </div>

        <div className="pt-2 flex justify-center">
          <div className="h-1.5 w-36 rounded-full bg-ink overflow-hidden">
            <div className="h-full bg-gradient-to-r bg-brand bg-brand rounded-full animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
};
