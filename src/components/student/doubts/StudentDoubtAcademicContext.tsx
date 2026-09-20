'use client';

import React from 'react';
import type { StudentDoubt } from '@/types/doubt';

interface StudentDoubtAcademicContextProps {
  doubt: StudentDoubt;
  compact?: boolean;
  className?: string;
}

function ContextRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-line last:border-0">
      <span className="text-caption font-bold uppercase tracking-wider text-ink-muted">
        {label}
      </span>
      <span className="text-right text-xs font-semibold text-ink">
        {value}
      </span>
    </div>
  );
}

export function StudentDoubtAcademicContext({
  doubt,
  compact = false,
  className,
}: StudentDoubtAcademicContextProps) {
  const course = doubt.courseName;
  const batch = doubt.batchName;
  const subject = doubt.subjectName;
  const chapter = doubt.chapterName;
  const topic = doubt.topicName;

  if (compact) {
    return (
      <div className={className}>
        {course && batch && (
          <span className="text-xs text-ink-secondary">
            {course} · {batch}
          </span>
        )}
        {chapter && (
          <span className="text-xs text-ink-secondary">
            {' '}
            · {chapter}
            {topic ? ` / ${topic}` : ''}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      <h3 className="mb-3 text-caption font-bold uppercase tracking-wider text-ink-muted">
        Academic Context
      </h3>
      <div className="space-y-0.5 bg-paper/70 p-3 rounded-2xl border border-line">
        <ContextRow label="Course" value={course} />
        <ContextRow label="Batch" value={batch} />
        <ContextRow label="Subject" value={subject} />
        <ContextRow label="Chapter" value={chapter} />
        <ContextRow label="Topic" value={topic} />
      </div>
    </div>
  );
}
