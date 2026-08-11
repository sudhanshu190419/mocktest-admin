'use client';

import type { StudentDoubt } from '@/types/doubt';

/**
 * Reusable student-identity panel for the Teacher Doubt experience.
 *
 * Shows the asking student's name + enrollment number. The data arrives
 * through RLS-scoped embeds (migration 082 grants teachers read access to
 * student_details/profiles for students in their assigned batches), so a
 * teacher sees identity ONLY for students they are permitted to see — never
 * arbitrary student records, phone/email, or address.
 */
interface StudentDoubtContextProps {
  doubt: StudentDoubt;
  compact?: boolean;
  className?: string;
}

export function StudentDoubtContext({ doubt, compact = false, className }: StudentDoubtContextProps) {
  const name = doubt.studentName;
  const enrollment = doubt.enrollmentNo;

  // Identity is unavailable when RLS filters the embed (legacy doubts with
  // no batch context, or students outside the teacher's batches). Render
  // nothing rather than a fabricated/empty value.
  if (!name && !enrollment) return null;

  if (compact) {
    return (
      <div className={className}>
        <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
          {name ?? 'Student'}
        </span>
        {enrollment && (
          <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
            {enrollment}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
        Student
      </h3>
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
          {(name ?? 'S').charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
            {name ?? 'Student'}
          </p>
          {enrollment && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Enrollment: {enrollment}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
