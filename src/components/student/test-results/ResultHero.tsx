'use client';

import React from 'react';
import { Trophy, Medal, CheckCircle, XCircle, CalendarBlank } from '@phosphor-icons/react';
import { ordinal } from '@/lib/format';

interface ResultHeroProps {
  testTitle: string;
  testType: string;
  attemptNumber: number;
  attemptedAt: string;
  totalScore: number;
  maxScore: number;
  percentage: number;
  passingMarks: number | null;
  isPassed: boolean | null;
  rank: number | null;
  percentile: number | null;
}

export const ResultHero: React.FC<ResultHeroProps> = ({
  testTitle,
  testType,
  attemptNumber,
  attemptedAt,
  totalScore,
  maxScore,
  percentage,
  passingMarks,
  isPassed,
  rank,
  percentile,
}) => {
  const formattedDate = new Date(attemptedAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return (
    <div className="bg-gradient-to-br bg-ink bg-ink bg-ink text-white rounded-sheet p-6 sm:p-8 shadow-xl border border-ink/60 relative overflow-hidden">
      {/* Decorative ambient gradients */}
      <div className="absolute -top-24 -right-24 w-72 h-72 bg-brand/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 -left-24 w-72 h-72 bg-brand/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
        {/* Left: Test Details & Metadata */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="px-2.5 py-1 rounded-md text-caption font-bold tracking-wider uppercase bg-brand/20 text-sky-ink border border-brand/30">
              {testType.replace(/_/g, ' ')}
            </span>
            <span className="px-2.5 py-1 rounded-md text-caption font-bold bg-ink text-ink-muted border border-ink">
              Attempt #{attemptNumber}
            </span>
            {isPassed !== null && (
              <span
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-caption font-bold border ${
                  isPassed
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                    : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                }`}
              >
                {isPassed ? <CheckCircle size={14} weight="bold" /> : <XCircle size={14} weight="bold" />}
                <span>{isPassed ? 'PASSED' : 'DID NOT QUALIFY'}</span>
              </span>
            )}
          </div>

          <h1 className="text-xl sm:text-2xl lg:text-3xl font-extrabold text-white tracking-tight mt-1">
            {testTitle}
          </h1>

          <div className="flex items-center gap-2 text-xs text-ink-muted mt-0.5">
            <CalendarBlank size={14} />
            <span>Completed on {formattedDate}</span>
            {passingMarks !== null && (
              <>
                <span>•</span>
                <span>Cutoff: {passingMarks} marks</span>
              </>
            )}
          </div>
        </div>

        {/* Right: Score Pill & Ranks */}
        <div className="flex items-center gap-4 sm:gap-6 self-start md:self-auto flex-wrap">
          {/* Rank Badge */}
          {rank !== null && (
            <div className="flex flex-col items-center justify-center p-3 sm:p-4 rounded-card bg-ink/80 border border-ink shadow-inner min-w-[80px]">
              <div className="flex items-center gap-1 text-amber-400 text-xs font-bold uppercase tracking-wider">
                <Trophy size={16} weight="fill" />
                <span>Rank</span>
              </div>
              <span className="text-xl sm:text-2xl font-black text-white mt-1">#{rank}</span>
            </div>
          )}

          {/* Percentile Badge */}
          {percentile !== null && (
            <div className="flex flex-col items-center justify-center p-3 sm:p-4 rounded-card bg-ink/80 border border-ink shadow-inner min-w-[80px]">
              <div className="flex items-center gap-1 text-sky-ink text-xs font-bold uppercase tracking-wider">
                <Medal size={16} weight="fill" />
                <span>Percentile</span>
              </div>
              <span className="text-xl sm:text-2xl font-black text-white mt-1">{ordinal(percentile)}</span>
            </div>
          )}

          {/* Overall Score Box */}
          <div className="flex flex-col items-center justify-center px-5 py-4 rounded-card bg-gradient-to-b bg-brand bg-brand-hover text-white shadow-lg shadow-card border border-brand/30 min-w-[120px]">
            <span className="text-caption font-bold tracking-widest text-brand uppercase">
              Total Score
            </span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-3xl sm:text-4xl font-black tracking-tight">{totalScore}</span>
              <span className="text-sm font-semibold text-brand">/ {maxScore}</span>
            </div>
            <span className="text-xs font-bold text-brand mt-0.5">{percentage}% aggregate</span>
          </div>
        </div>
      </div>
    </div>
  );
};
