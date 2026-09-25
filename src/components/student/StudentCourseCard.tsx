'use client';

import React from 'react';
import Link from 'next/link';
import {
  IconVideo,
  IconFileText,
  IconPlayCircle,
  IconGraduationCap,
  IconTest,
} from '@/components/icons/student-icons';
import type { EnrolledCourseCardItem } from '@/services/student/studentCourseWebService';
import { ProgressBar } from '@/components/ui/mmt/ProgressBar';

interface StudentCourseCardProps {
  course: EnrolledCourseCardItem;
  onOpen?: (courseId: string) => void;
}

export const StudentCourseCard: React.FC<StudentCourseCardProps> = ({ course }) => {
  const resumeHref = course.firstAvailableBatchSubjectId
    ? `/student/courses/${course.courseId}/subjects/${course.firstAvailableBatchSubjectId}`
    : `/student/courses/${course.courseId}`;

  return (
    <div className="group flex flex-col justify-between rounded-card border border-line bg-surface p-5 sm:p-6 shadow-card hover:border-line hover:shadow-card-hover transition-all duration-200">
      {/* Top Section: Category + Batch Badges */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-tint px-3 py-1 text-caption font-bold text-brand-hover border border-line">
            <IconGraduationCap className="h-3.5 w-3.5" />
            {course.category || course.streamName || 'Academic Track'}
          </span>
          <span className="inline-flex items-center rounded-field bg-paper px-2.5 py-1 text-caption font-semibold text-ink-secondary border border-line">
            {course.batchName} {course.batchCode ? `(${course.batchCode})` : ''}
          </span>
        </div>

        {/* Title & Description */}
        <h3 className="mt-3.5 text-h3 font-extrabold text-ink line-clamp-1 group-hover:text-brand transition-colors">
          {course.title}
        </h3>
        {course.description ? (
          <p className="mt-1 text-body text-ink-secondary line-clamp-2 leading-relaxed">
            {course.description}
          </p>
        ) : (
          <p className="mt-1 text-body text-ink-secondary">
            Comprehensive curriculum, video lectures, notes & mock test series.
          </p>
        )}

        {/* Animated Progress Bar */}
        <div className="mt-4 space-y-1.5">
          <div className="flex items-center justify-between text-caption font-bold">
            <span className="text-ink-secondary uppercase tracking-wider">Course Progress</span>
            <span className="text-ink tabular-nums">{course.progress}%</span>
          </div>
          <ProgressBar
            value={course.progress}
            label={`${course.title} progress`}
            tone={course.progress >= 80 ? 'success' : 'brand'}
          />
        </div>

        {/* Subjects List */}
        {course.subjects && course.subjects.length > 0 && (
          <div className="mt-4">
            <p className="text-caption font-bold uppercase tracking-wider text-ink-secondary">
              Subject Tracks
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {course.subjects.map((sub) => (
                <Link
                  key={sub.batchSubjectId || sub.subjectId}
                  href={`/student/courses/${course.courseId}/subjects/${sub.batchSubjectId || sub.subjectId}`}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-field border border-line bg-paper px-2.5 py-1 text-caption font-medium text-ink hover:border-brand hover:bg-sky-tint transition-colors"
                >
                  <span>{sub.emoji}</span>
                  <span>{sub.subjectName}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Content Availability Badges */}
        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
          <div className="rounded-field bg-sky-tint p-2">
            <div className="flex items-center justify-center gap-1 text-brand-hover">
              <IconVideo className="h-3.5 w-3.5" />
              <span className="text-body font-bold tabular-nums">{course.totalLectures}</span>
            </div>
            <p className="text-caption text-ink-secondary mt-0.5">Lectures</p>
          </div>
          <div className="rounded-field bg-mint-tint p-2">
            <div className="flex items-center justify-center gap-1 text-mint-ink">
              <IconFileText className="h-3.5 w-3.5" />
              <span className="text-body font-bold tabular-nums">{course.totalPdfs + course.totalNotes}</span>
            </div>
            <p className="text-caption text-ink-secondary mt-0.5">Notes & PDFs</p>
          </div>
          <div className="rounded-field bg-lilac-tint p-2">
            <div className="flex items-center justify-center gap-1 text-lilac-ink">
              <IconTest className="h-3.5 w-3.5" />
              <span className="text-body font-bold tabular-nums">{course.totalMockTests}</span>
            </div>
            <p className="text-caption text-ink-secondary mt-0.5">Mock Tests</p>
          </div>
        </div>
      </div>

      {/* Bottom Row: Actions (≥44px hit-height) */}
      <div className="mt-6 border-t border-line pt-4">
        <Link
          href={resumeHref}
          className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-field bg-brand px-4 py-2.5 text-body font-bold text-white shadow-xs hover:bg-brand-hover active:scale-[0.98] transition-all"
        >
          <IconPlayCircle className="h-4 w-4" />
          <span>Continue Learning</span>
        </Link>
      </div>
    </div>
  );
};
