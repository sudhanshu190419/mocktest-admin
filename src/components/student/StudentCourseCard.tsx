'use client';

/**
 * StudentCourseCard Component
 *
 * Premium enrolled course card matching MockTestApp design system:
 *   - Primary: #0284C7
 *   - Background: #F0F9FF
 *   - Badges: #05C46B (Live/Completed), #F59E0B (In Progress)
 *   - Spacing: 8px modular system
 *
 * @module components/student/StudentCourseCard
 */

import React from 'react';
import Link from 'next/link';
import {
  BookOpen,
  VideoCamera,
  FileText,
  Clock,
  ArrowRight,
  PlayCircle,
  GraduationCap,
  Sparkle,
  Exam
} from '@phosphor-icons/react';
import type { EnrolledCourseCardItem } from '@/services/student/studentCourseWebService';

interface StudentCourseCardProps {
  course: EnrolledCourseCardItem;
  onOpen?: (courseId: string) => void;
}

export const StudentCourseCard: React.FC<StudentCourseCardProps> = ({ course, onOpen }) => {
  const resumeHref = course.firstAvailableBatchSubjectId
    ? `/student/courses/${course.courseId}/subjects/${course.firstAvailableBatchSubjectId}`
    : `/student/courses/${course.courseId}`;

  return (
    <div className="group flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-sky-300 hover:shadow-md">
      {/* Top Section: Category + Batch Badges */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700 border border-sky-100">
            <GraduationCap className="h-3.5 w-3.5" />
            {course.category || course.streamName || 'Academic Track'}
          </span>
          <span className="inline-flex items-center rounded-lg bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
            {course.batchName} {course.batchCode ? `(${course.batchCode})` : ''}
          </span>
        </div>

        {/* Title & Description */}
        <h3 className="mt-3.5 text-lg font-bold text-slate-900 line-clamp-1 group-hover:text-sky-600 transition-colors">
          {course.title}
        </h3>
        {course.description ? (
          <p className="mt-1 text-xs text-slate-500 line-clamp-2 leading-relaxed">
            {course.description}
          </p>
        ) : (
          <p className="mt-1 text-xs text-slate-400">
            Comprehensive curriculum, video lectures, notes & mock test series.
          </p>
        )}


        {/* Subjects List */}
        {course.subjects && course.subjects.length > 0 && (
          <div className="mt-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Enrolled Subject Tracks
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {course.subjects.map((sub) => (
                <Link
                  key={sub.batchSubjectId || sub.subjectId}
                  href={`/student/courses/${course.courseId}/subjects/${sub.batchSubjectId || sub.subjectId}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-sky-400 hover:bg-sky-50 transition-colors"
                >
                  <span>{sub.emoji}</span>
                  <span>{sub.subjectName}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Content Availability Badges */}
        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-center">
          <div className="rounded-lg bg-sky-50/70 p-2">
            <div className="flex items-center justify-center gap-1 text-sky-700">
              <VideoCamera className="h-3.5 w-3.5" />
              <span className="text-xs font-bold">{course.totalLectures}</span>
            </div>
            <p className="text-[10px] text-slate-500 mt-0.5">Lectures</p>
          </div>
          <div className="rounded-lg bg-emerald-50/70 p-2">
            <div className="flex items-center justify-center gap-1 text-emerald-700">
              <FileText className="h-3.5 w-3.5" />
              <span className="text-xs font-bold">{course.totalPdfs + course.totalNotes}</span>
            </div>
            <p className="text-[10px] text-slate-500 mt-0.5">Notes & PDFs</p>
          </div>
          <div className="rounded-lg bg-indigo-50/70 p-2">
            <div className="flex items-center justify-center gap-1 text-indigo-700">
              <Exam className="h-3.5 w-3.5" />
              <span className="text-xs font-bold">{course.totalMockTests}</span>
            </div>
            <p className="text-[10px] text-slate-500 mt-0.5">Mock Tests</p>
          </div>
        </div>
      </div>

      {/* Bottom Row: Actions */}
      <div className="mt-6 flex items-center gap-3 border-t border-slate-100 pt-4">
        <Link
          href={resumeHref}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-sky-700 active:scale-[0.98] transition-all"
        >
          <PlayCircle className="h-4 w-4" />
          Continue Learning
        </Link>
      </div>
    </div>
  );
};
