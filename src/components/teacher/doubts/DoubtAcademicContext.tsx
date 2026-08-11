'use client';

import type { StudentDoubt } from '@/types/doubt';

/**
 * Reusable academic-context panel for the Teacher Doubt experience.
 *
 * Renders the full hierarchy the teacher needs at a glance:
 *
 *   Course → Batch → Subject → Chapter → Topic
 *
 * All values come from RLS-scoped embeds populated by doubtService
 * (courseName via batch_subject → batches → course_batches → courses;
 * never stored on student_doubts). UUIDs are never displayed.
 */
interface DoubtAcademicContextProps {
  doubt: StudentDoubt;
  /** Compact mode (used in list rows) — hides null chapter/topic. */
  compact?: boolean;
  className?: string;
}

function ContextRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">
        {label}
      </span>
      <span className="text-right text-sm font-medium text-gray-800 dark:text-gray-200">
        {value}
      </span>
    </div>
  );
}

export function DoubtAcademicContext({
  doubt,
  compact = false,
  className,
}: DoubtAcademicContextProps) {
  const course = doubt.courseName;
  const batch = doubt.batchName;
  const subject = doubt.subjectName;
  const chapter = doubt.chapterName;
  const topic = doubt.topicName;

  // In compact mode (list rows) the subject line is shown by the caller as
  // the row title — only render chapter/topic here when present.
  if (compact) {
    return (
      <div className={className}>
        {course && batch && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {course} • {batch}
          </span>
        )}
        {chapter && (
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {' '}
            • {chapter}
            {topic ? ` / ${topic}` : ''}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
        Academic Context
      </h3>
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        <ContextRow label="Course" value={course} />
        <ContextRow label="Batch" value={batch} />
        <ContextRow label="Subject" value={subject} />
        <ContextRow label="Chapter" value={chapter} />
        <ContextRow label="Topic" value={topic} />
      </div>
    </div>
  );
}
