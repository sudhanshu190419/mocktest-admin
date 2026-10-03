'use client';

import React from 'react';
import {
  IconFilm,
  IconClock,
  IconCalendar,
  IconArrowRight,
  IconPlay,
  IconSpark,
  IconBookmark,
  IconLayers,
  IconCalculator,
  IconVideo,
} from '@/components/icons/student-icons';
import type { StudentSubjectSummary } from '@/services/student/studentRecordingWebService';
import {
  formatRecordingDate,
  getRecordingSubjectColor,
} from '@/services/student/studentRecordingWebService';

interface StudentSubjectCardsGridProps {
  subjects: StudentSubjectSummary[];
  onSelectSubject: (subjectId: string) => void;
}

function getSubjectIcon(subjectName: string) {
  const s = subjectName.toLowerCase();
  if (s.includes('math')) return <IconCalculator size={24} />;
  if (s.includes('physic') || s.includes('chem') || s.includes('sci')) return <IconLayers size={24} />;
  if (s.includes('bio') || s.includes('botan') || s.includes('zool')) return <IconBookmark size={24} />;
  return <IconVideo size={24} />;
}

export const StudentSubjectCardsGrid: React.FC<StudentSubjectCardsGridProps> = ({
  subjects,
  onSelectSubject,
}) => {
  if (subjects.length === 0) {
    return (
      <div className="rounded-sheet bg-white border border-line p-10 text-center shadow-xs max-w-xl mx-auto space-y-4 my-8">
        <div className="w-16 h-16 rounded-card bg-sky-tint border border-line mx-auto flex items-center justify-center text-brand">
          <IconFilm size={32} />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-base font-extrabold text-ink">
            No Recorded Subjects Available
          </h3>
          <p className="text-xs text-ink-secondary leading-relaxed max-w-sm mx-auto">
            You don&apos;t have any recorded class sessions in your enrolled batches yet. Once your instructors conduct live classes, recordings will automatically appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-extrabold text-ink tracking-tight">
            Academic Subjects
          </h2>
          <p className="text-xs text-ink-secondary mt-0.5">
            Select a subject to browse and stream its recorded lectures
          </p>
        </div>
        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-caption font-bold bg-paper border border-line text-ink-secondary shadow-2xs">
          {subjects.length} {subjects.length === 1 ? 'Subject' : 'Subjects'} Available
        </span>
      </div>

      {/* Horizontal Cards Layout */}
      <div
        className={"grid gap-4 sm:gap-5 " + (subjects.length === 1 ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2")}
      >
        {subjects.map((subject) => {
          const colors = getRecordingSubjectColor(subject.subjectName);
          const formattedDate = formatRecordingDate(subject.latestRecordingAt);
          const lectureCountText =
            subject.recordingCount === 1
              ? '1 Lecture'
              : subject.recordingCount + ' Lectures';

          return (
            <div
              key={subject.subjectId}
              onClick={() => onSelectSubject(subject.subjectId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectSubject(subject.subjectId);
                }
              }}
              role="button"
              tabIndex={0}
              aria-label={"Browse " + subject.subjectName + " recordings (" + lectureCountText + ")"}
              className="group relative flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-6 p-5 sm:p-6 rounded-card bg-surface border border-line shadow-card hover:shadow-card-hover hover:border-brand/40 transition-all duration-200 cursor-pointer active:scale-[0.995]"
            >
              {/* Left / Main Subject Info */}
              <div className="flex items-center gap-4 sm:gap-5 flex-1 min-w-0">
                {/* Subject Themed Icon Box */}
                <div
                  className={"w-14 h-14 sm:w-16 sm:h-16 rounded-card bg-gradient-to-br " + colors.gradient + " flex items-center justify-center text-white shadow-xs shrink-0 relative overflow-hidden group-hover:scale-105 transition-transform duration-300"}
                >
                  <div className="absolute inset-0 bg-white/10 opacity-60 pointer-events-none" />
                  <div className="relative z-10 flex items-center justify-center">
                    {getSubjectIcon(subject.subjectName)}
                  </div>
                </div>

                {/* Details */}
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-caption font-bold bg-paper border border-line text-ink-secondary">
                      <span className={"h-1.5 w-1.5 rounded-full " + colors.badge} />
                      <span>Subject</span>
                    </span>
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-caption font-bold bg-sky-tint text-brand border border-sky-200/60">
                      <IconFilm size={12} className="shrink-0" />
                      <span>{lectureCountText}</span>
                    </span>
                  </div>

                  <h3 className="text-base sm:text-lg font-extrabold text-ink tracking-tight group-hover:text-brand transition-colors truncate">
                    {subject.subjectName}
                  </h3>

                  <div className="flex flex-wrap items-center gap-y-1 gap-x-3 text-caption text-ink-secondary">
                    <span className="font-semibold text-ink-muted">
                      Content Library &bull; {subject.recordingCount} recorded {subject.recordingCount === 1 ? 'session' : 'sessions'}
                    </span>
                    {subject.latestRecordingAt && (
                      <span className="inline-flex items-center gap-1 text-ink-muted">
                        <IconCalendar size={12} className="shrink-0 text-ink-muted" />
                        <span>Latest: {formattedDate}</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Right CTA Button */}
              <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 shrink-0 pt-3 sm:pt-0 border-t sm:border-t-0 border-line/60">
                <div className="w-full sm:w-auto inline-flex min-h-[44px] items-center justify-center gap-2 px-5 py-2.5 rounded-field bg-sky-tint text-brand border border-brand/20 group-hover:bg-brand group-hover:text-white group-hover:border-brand font-bold text-xs sm:text-sm transition-all duration-200 shadow-2xs">
                  <IconPlay size={13} className="shrink-0 fill-current" />
                  <span>Browse Lectures</span>
                  <IconArrowRight
                    size={14}
                    className="shrink-0 transform group-hover:translate-x-1.5 transition-transform duration-200"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
