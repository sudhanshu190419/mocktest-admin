'use client';

import React from 'react';
import Link from 'next/link';
import {
  VideoCamera,
  FileText,
  PlayCircle,
  GraduationCap,
  Exam,
} from '@phosphor-icons/react';
import type { EnrolledCourseCardItem } from '@/services/student/studentCourseWebService';

interface StudentCourseCardProps {
  course: EnrolledCourseCardItem;
  onOpen?: (courseId: string) => void;
}

export const StudentCourseCard: React.FC<StudentCourseCardProps> = ({ course }) => {
  const resumeHref = course.firstAvailableBatchSubjectId
    ? `/student/courses/${course.courseId}/subjects/${course.firstAvailableBatchSubjectId}`
    : `/student/courses/${course.courseId}`;

  return (
    <div className="student-card group flex flex-col justify-between hover:-translate-y-1 transition-all duration-200">
      {/* Top Section: Category + Batch Badges */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="student-pill student-pill-sky">
            <GraduationCap className="h-3.5 w-3.5" />
            {course.category || course.streamName || 'Academic Track'}
          </span>
          <span className="inline-flex items-center rounded-lg bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
            {course.batchName} {course.batchCode ? `(${course.batchCode})` : ''}
          </span>
        </div>

        {/* Title & Description */}
        <h3 className="mt-3.5 text-base sm:text-lg font-extrabold text-slate-900 line-clamp-1 group-hover:text-store-blue transition-colors">
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
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/70 px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-store-blue hover:bg-store-sky transition-colors"
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
          <div className="rounded-xl p-2" style={{ background: 'var(--color-store-sky)' }}>
            <div className="flex items-center justify-center gap-1" style={{ color: 'var(--color-store-blue)' }}>
              <VideoCamera className="h-3.5 w-3.5" />
              <span className="text-xs font-bold tabular-nums">{course.totalLectures}</span>
            </div>
            <p className="text-[10px] text-slate-500 mt-0.5">Lectures</p>
          </div>
          <div className="rounded-xl p-2" style={{ background: 'var(--color-store-mint)' }}>
            <div className="flex items-center justify-center gap-1" style={{ color: 'var(--color-store-green)' }}>
              <FileText className="h-3.5 w-3.5" />
              <span className="text-xs font-bold tabular-nums">{course.totalPdfs + course.totalNotes}</span>
            </div>
            <p className="text-[10px] text-slate-500 mt-0.5">Notes & PDFs</p>
          </div>
          <div className="rounded-xl p-2" style={{ background: 'var(--color-store-lilac)' }}>
            <div className="flex items-center justify-center gap-1" style={{ color: 'var(--color-store-violet)' }}>
              <Exam className="h-3.5 w-3.5" />
              <span className="text-xs font-bold tabular-nums">{course.totalMockTests}</span>
            </div>
            <p className="text-[10px] text-slate-500 mt-0.5">Mock Tests</p>
          </div>
        </div>
      </div>

      {/* Bottom Row: Actions */}
      <div className="mt-6 flex items-center gap-3 border-t border-slate-100 pt-4">
        <Link
          href={resumeHref}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl text-white px-4 py-2.5 text-xs font-bold shadow-xs hover:opacity-95 transition-all"
          style={{ backgroundColor: 'var(--color-store-blue)' }}
        >
          <PlayCircle className="h-4 w-4" />
          Continue Learning
        </Link>
      </div>
    </div>
  );
};
