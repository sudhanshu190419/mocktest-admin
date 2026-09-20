'use client';

import React from 'react';
import Link from 'next/link';
import {
  Play,
  Clock,
  User,
  CalendarBlank,
  GraduationCap,
  CheckCircle,
  ArrowCounterClockwise,
  ArrowRight,
} from '@phosphor-icons/react';
import type { StudentRecording } from '@/services/student/studentRecordingWebService';
import {
  formatRecordingDuration,
  formatRecordingDate,
  getRecordingSubjectColor,
} from '@/services/student/studentRecordingWebService';

interface StudentRecordingCardProps {
  recording: StudentRecording;
}

export const StudentRecordingCard: React.FC<StudentRecordingCardProps> = ({ recording }) => {
  const subjectColors = getRecordingSubjectColor(recording.subjectName);
  const formattedDuration = formatRecordingDuration(recording.durationSeconds);
  const formattedDate = formatRecordingDate(recording.scheduledAt || recording.createdAt);

  const progress = recording.progress;
  const isCompleted = progress?.isCompleted === true;
  const isStarted = !isCompleted && progress && progress.lastPositionSeconds > 0;
  const watchedPercent = progress?.watchedPercentage ?? 0;

  let ctaLabel = 'Watch Recording';
  let ctaIcon = <Play size={14} weight="fill" />;

  if (isCompleted) {
    ctaLabel = 'Watch Again';
    ctaIcon = <ArrowCounterClockwise size={14} weight="bold" />;
  } else if (isStarted) {
    ctaLabel = 'Continue Watching';
    ctaIcon = <Play size={14} weight="fill" />;
  }

  return (
    <div className="group relative flex flex-col justify-between rounded-card bg-surface border border-line shadow-card hover:shadow-card-hover transition-all duration-200 overflow-hidden">
      <div>
        {/* Top Thumbnail Canvas */}
        <div
          className={`relative h-40 w-full bg-gradient-to-br ${subjectColors.gradient} p-4 flex flex-col justify-between overflow-hidden`}
        >
          {/* Subtle gradient pattern */}
          <div className="absolute inset-0 bg-white/5 opacity-50 pointer-events-none" />

          {/* Top badges: Subject Tag & Duration */}
          <div className="relative z-10 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-caption font-extrabold bg-white/95 text-ink shadow-xs backdrop-blur-xs">
              <span className={`h-1.5 w-1.5 rounded-full ${subjectColors.badge}`} />
              <span>{recording.subjectName || 'General'}</span>
            </span>

            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-caption font-bold bg-black/40 text-white backdrop-blur-md border border-white/10">
              <Clock size={12} weight="bold" />
              <span>{formattedDuration}</span>
            </span>
          </div>

          {/* Center Play Icon Visual */}
          <div className="relative z-10 self-center my-auto flex h-12 w-12 items-center justify-center rounded-field bg-white/20 backdrop-blur-md text-white border border-white/30 group-hover:scale-110 group-hover:bg-white group-hover:text-brand-hover transition-all duration-300 shadow-md">
            <Play size={20} weight="fill" className="ml-0.5" />
          </div>

          {/* Bottom Progress Indicator on Thumbnail */}
          {isStarted && (
            <div className="relative z-10 w-full bg-black/40 backdrop-blur-xs rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-brand h-full rounded-full transition-all duration-300"
                style={{ width: `${watchedPercent}%` }}
              />
            </div>
          )}

          {isCompleted && (
            <div className="relative z-10 w-full bg-emerald-900/60 backdrop-blur-xs rounded-full h-1.5 overflow-hidden">
              <div className="bg-emerald-400 h-full rounded-full w-full" />
            </div>
          )}
        </div>

        {/* Body: Content & Metadata */}
        <div className="p-5 space-y-3.5">
          <div>
            <h3 className="text-h3 font-extrabold text-ink line-clamp-2 leading-snug group-hover:text-brand transition-colors">
              {recording.title}
            </h3>
            {recording.description && (
              <p className="mt-1 text-body text-ink-secondary line-clamp-2 leading-relaxed">
                {recording.description}
              </p>
            )}
          </div>

          <div className="space-y-1.5 pt-1 border-t border-line text-body text-ink-secondary">
            {recording.teacherName && (
              <div className="flex items-center gap-2">
                <User size={14} weight="duotone" className="text-ink-muted shrink-0" />
                <span className="truncate font-semibold">{recording.teacherName}</span>
              </div>
            )}

            {recording.batchName && (
              <div className="flex items-center gap-2">
                <GraduationCap size={14} weight="duotone" className="text-ink-muted shrink-0" />
                <span className="truncate">{recording.batchName}</span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <CalendarBlank size={14} weight="duotone" className="text-ink-muted shrink-0" />
              <span>{formattedDate}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer / CTA Section (≥44px hit-height) */}
      <div className="p-5 pt-0">
        {isStarted && (
          <div className="mb-3 flex items-center justify-between text-caption font-bold text-brand-hover">
            <span>{watchedPercent}% watched</span>
            <span className="text-ink-secondary font-normal">
              {formatRecordingDuration(progress?.lastPositionSeconds || 0)} left off
            </span>
          </div>
        )}

        {isCompleted && (
          <div className="mb-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-field bg-mint-tint text-mint-ink border border-emerald-200 text-caption font-bold">
            <CheckCircle size={14} weight="fill" />
            <span>Completed Lecture</span>
          </div>
        )}

        <Link
          href={`/student/recordings/${recording.recordingId}`}
          aria-label={`${ctaLabel}: ${recording.title}`}
          className={`w-full inline-flex min-h-[44px] items-center justify-center gap-2 px-4 py-2.5 rounded-field text-body font-bold transition-all duration-200 shadow-xs active:scale-[0.98] ${
            isStarted
              ? 'bg-brand text-white hover:bg-brand-hover'
              : isCompleted
              ? 'bg-paper hover:bg-sky-tint text-ink border border-line'
              : 'bg-brand text-white hover:bg-brand-hover'
          }`}
        >
          {ctaIcon}
          <span>{ctaLabel}</span>
          <ArrowRight size={13} weight="bold" className="opacity-70 group-hover:translate-x-0.5 transition-transform" />
        </Link>
      </div>
    </div>
  );
};
