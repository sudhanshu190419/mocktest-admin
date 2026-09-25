'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Broadcast,
  BookOpen,
  GraduationCap,
  ArrowsOut,
  ArrowsIn,
  Clock
} from '@phosphor-icons/react';
import { NetworkQualityIndicator } from './NetworkQualityIndicator';
import { ConnectionQuality } from 'livekit-client';

interface LiveClassHeaderProps {
  title: string;
  subjectName: string;
  batchName: string;
  isLive?: boolean;
  networkQuality?: ConnectionQuality;
  isReconnecting?: boolean;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onLeaveClass?: () => void;
}

export const LiveClassHeader: React.FC<LiveClassHeaderProps> = ({
  title,
  subjectName,
  batchName,
  isLive = true,
  networkQuality,
  isReconnecting,
  isFullscreen,
  onToggleFullscreen,
  onLeaveClass,
}) => {
  // Local session elapsed timer
  const [elapsedSec, setElapsedSec] = useState<number>(0);

  useEffect(() => {
    if (!isLive) return;
    const interval = setInterval(() => {
      setElapsedSec((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isLive]);

  const formatTimer = (sec: number) => {
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <header className="flex items-center justify-between gap-3 px-4 py-3 bg-ink/90 border-b border-ink text-white backdrop-blur-md z-30">
      {/* Left: Back & Class Info */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onLeaveClass}
          className="p-2 rounded-field bg-ink hover:bg-ink text-ink-muted hover:text-white transition-colors border border-ink/60 shrink-0"
          title="Exit Classroom"
        >
          <ArrowLeft size={16} weight="bold" />
        </button>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xs sm:text-sm font-black text-white truncate max-w-[200px] sm:max-w-md">
              {title}
            </h1>
            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand/20 text-sky-ink text-caption font-bold border border-brand/40/20">
              <BookOpen size={10} weight="bold" />
              <span>{subjectName}</span>
            </span>
          </div>

          <div className="flex items-center gap-2 text-caption text-ink-muted">
            <span className="truncate">{batchName}</span>
          </div>
        </div>
      </div>

      {/* Right: Live badge, Timer, Network & Fullscreen */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {/* Live / Timer badge */}
        {isLive && (
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-bold shadow-xs">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
            </span>
            <span className="font-black text-caption">LIVE</span>
            <span className="text-ink-muted font-mono text-caption font-medium hidden sm:inline">
              {formatTimer(elapsedSec)}
            </span>
          </div>
        )}

        {/* Network Quality */}
        <NetworkQualityIndicator quality={networkQuality} isReconnecting={isReconnecting} />

        {/* Fullscreen Button */}
        {onToggleFullscreen && (
          <button
            type="button"
            onClick={onToggleFullscreen}
            className="p-2 rounded-field bg-ink hover:bg-ink text-ink-muted hover:text-white transition-colors border border-ink/60"
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            aria-label={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
          >
            {isFullscreen ? <ArrowsIn size={16} weight="bold" /> : <ArrowsOut size={16} weight="bold" />}
          </button>
        )}
      </div>
    </header>
  );
};
