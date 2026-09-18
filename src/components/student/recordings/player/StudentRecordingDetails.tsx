'use client';

/**
 * Student Recording Details Component
 *
 * Displays full metadata, instructor details, subject/batch tags,
 * watch completion status, class description, and navigation actions
 * for a live-class recording.
 *
 * @module components/student/recordings/player/StudentRecordingDetails
 */

import React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  User,
  CalendarBlank,
  Clock,
  GraduationCap,
  CheckCircle,
  Question,
  BookOpen,
  Keyboard,
  Info,
} from '@phosphor-icons/react';
import type { StudentRecording } from '@/services/student/studentRecordingWebService';
import { createContextQueryUrl } from '@/services/student/studentDoubtAcademicService';
import {
  formatRecordingDuration,
  formatRecordingDate,
  getRecordingSubjectColor,
} from '@/services/student/studentRecordingWebService';

export interface StudentRecordingDetailsProps {
  recording: StudentRecording;
  isCompleted?: boolean;
  watchedPercentage?: number;
}

export const StudentRecordingDetails: React.FC<StudentRecordingDetailsProps> = ({
  recording,
  isCompleted: propCompleted,
  watchedPercentage: propPercentage,
}) => {
  const isCompleted = propCompleted ?? recording.progress?.isCompleted ?? false;
  const percentage = propPercentage ?? recording.progress?.watchedPercentage ?? 0;
  const subjectColors = getRecordingSubjectColor(recording.subjectName);

  const askDoubtUrl = createContextQueryUrl({
    batchId: recording.batchId || undefined,
    relatedResourceType: 'live_class',
    relatedResourceId: recording.classId || recording.recordingId,
    prefillTitle: `Doubt regarding recording: ${recording.title}`,
    subjectName: recording.subjectName || undefined,
  });

  return (
    <div className="flex flex-col gap-6">
      {/* ── Top Navigation / Back Breadcrumb ───────────────────────── */}
      <div className="flex items-center justify-between">
        <Link
          href="/student/recordings"
          className="inline-flex items-center gap-2 text-xs md:text-sm font-medium text-neutral-600 hover:text-indigo-600 transition-colors group"
        >
          <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
          <span>Back to Recorded Classes</span>
        </Link>

        {/* Watch Status Badge */}
        {isCompleted ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle className="w-4 h-4 text-emerald-600" weight="fill" />
            Completed
          </span>
        ) : percentage > 0 ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
            <Clock className="w-4 h-4 text-indigo-600" weight="fill" />
            {percentage}% Watched
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-neutral-100 text-neutral-600 border border-neutral-200">
            Not Started
          </span>
        )}
      </div>

      {/* ── Main Title & Badges ───────────────────────────────────── */}
      <div className="space-y-3">
        {/* Badges Row */}
        <div className="flex flex-wrap items-center gap-2">
          {recording.subjectName && (
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-bold uppercase tracking-wider ${subjectColors.bg} ${subjectColors.text} border ${subjectColors.border}`}
            >
              {recording.subjectName}
            </span>
          )}

          {recording.batchName && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-medium bg-neutral-100 text-neutral-700 border border-neutral-200">
              <GraduationCap className="w-3.5 h-3.5 text-neutral-500" />
              {recording.batchName}
            </span>
          )}

          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-medium bg-neutral-50 text-neutral-600 border border-neutral-200">
            <CalendarBlank className="w-3.5 h-3.5 text-neutral-400" />
            {formatRecordingDate(recording.scheduledAt || recording.createdAt)}
          </span>

          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-medium bg-neutral-50 text-neutral-600 border border-neutral-200">
            <Clock className="w-3.5 h-3.5 text-neutral-400" />
            {formatRecordingDuration(recording.durationSeconds)}
          </span>
        </div>

        {/* Title */}
        <h1 className="text-xl md:text-2xl lg:text-3xl font-bold text-neutral-900 tracking-tight leading-snug">
          {recording.title}
        </h1>
      </div>

      {/* ── Instructor & Action Card ──────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-white border border-neutral-200/80 shadow-sm">
        {/* Teacher Info */}
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-gradient-to-tr from-indigo-600 to-indigo-400 flex items-center justify-center text-white font-bold text-sm shadow-md shadow-indigo-500/20">
            {recording.teacherName ? (
              recording.teacherName.charAt(0).toUpperCase()
            ) : (
              <User className="w-5 h-5" />
            )}
          </div>
          <div>
            <div className="text-sm font-bold text-neutral-900">
              {recording.teacherName || 'Faculty Instructor'}
            </div>
            <div className="text-xs text-neutral-500 font-medium">
              Live Class Instructor
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-2">
          <Link
            href={askDoubtUrl}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold border border-indigo-200 transition-colors shadow-sm"
          >
            <Question className="w-4 h-4 text-indigo-600" />
            <span>Ask a Doubt</span>
          </Link>

          <Link
            href="/student/classes"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs font-semibold transition-colors"
          >
            <BookOpen className="w-4 h-4 text-neutral-500" />
            <span>All Classes</span>
          </Link>
        </div>
      </div>

      {/* ── Description & Notes ──────────────────────────────────── */}
      <div className="p-5 rounded-2xl bg-white border border-neutral-200/80 shadow-sm space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-neutral-400">
          <Info className="w-4 h-4 text-indigo-500" />
          <span>Class Overview & Topics Covered</span>
        </div>

        {recording.description ? (
          <p className="text-sm text-neutral-700 leading-relaxed whitespace-pre-line">
            {recording.description}
          </p>
        ) : (
          <p className="text-xs text-neutral-400 italic">
            No detailed summary provided for this recorded session.
          </p>
        )}
      </div>

      {/* ── Keyboard Shortcuts Legend ─────────────────────────────── */}
      <div className="p-4 rounded-2xl bg-neutral-50 border border-neutral-200/60 text-neutral-600 text-xs space-y-2.5">
        <div className="flex items-center gap-2 font-semibold text-neutral-800">
          <Keyboard className="w-4 h-4 text-neutral-500" />
          <span>Player Keyboard Shortcuts</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-[11px]">
          <div className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 bg-white border border-neutral-300 rounded font-mono shadow-xs text-neutral-900">Space</kbd>
            <span className="text-neutral-500">Play/Pause</span>
          </div>
          <div className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 bg-white border border-neutral-300 rounded font-mono shadow-xs text-neutral-900">← / →</kbd>
            <span className="text-neutral-500">±5s Seek</span>
          </div>
          <div className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 bg-white border border-neutral-300 rounded font-mono shadow-xs text-neutral-900">J / L</kbd>
            <span className="text-neutral-500">±10s Seek</span>
          </div>
          <div className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 bg-white border border-neutral-300 rounded font-mono shadow-xs text-neutral-900">↑ / ↓</kbd>
            <span className="text-neutral-500">Volume</span>
          </div>
          <div className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 bg-white border border-neutral-300 rounded font-mono shadow-xs text-neutral-900">M</kbd>
            <span className="text-neutral-500">Mute</span>
          </div>
          <div className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 bg-white border border-neutral-300 rounded font-mono shadow-xs text-neutral-900">F</kbd>
            <span className="text-neutral-500">Fullscreen</span>
          </div>
        </div>
      </div>
    </div>
  );
};
