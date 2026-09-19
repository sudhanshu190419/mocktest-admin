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
    <div className="flex items-center justify-between gap-3 py-2 border-b border-slate-100 last:border-0">
      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
        {label}
      </span>
      <span className="text-right text-xs font-semibold text-slate-800">
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
          <span className="text-xs text-slate-600">
            {course} · {batch}
          </span>
        )}
        {chapter && (
          <span className="text-xs text-slate-500">
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
      <h3 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">
        Academic Context
      </h3>
      <div className="space-y-0.5 bg-slate-50/70 p-3 rounded-2xl border border-slate-100">
        <ContextRow label="Course" value={course} />
        <ContextRow label="Batch" value={batch} />
        <ContextRow label="Subject" value={subject} />
        <ContextRow label="Chapter" value={chapter} />
        <ContextRow label="Topic" value={topic} />
      </div>
    </div>
  );
}
