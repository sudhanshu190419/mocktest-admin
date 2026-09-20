'use client';

import React from 'react';
import Link from 'next/link';
import { Exam, ArrowRight } from '@phosphor-icons/react';
import type { StudentMockTestCardItem } from '@/services/student/studentTestWebService';
import { getTestCardPresentation, type TestCardState } from '@/lib/testCardState';

/**
 * PRD §7.3 — one shared test card for every surface.
 * State = left border strip + label + exactly ONE primary action.
 */

const STRIP_CLASS: Record<TestCardState, string> = {
  upcoming: 'tsc-strip-sand',
  available: 'tsc-strip-brand',
  in_progress: 'tsc-strip-sky',
  submitted: 'tsc-strip-mint',
  evaluated: 'tsc-strip-mint',
  evaluated_retake: 'tsc-strip-mint',
  limit_reached: 'tsc-strip-line',
  expired: 'tsc-strip-line',
};

export function TestStateCard({
  test,
  className = '',
}: {
  test: StudentMockTestCardItem;
  className?: string;
}) {
  const p = getTestCardPresentation(test);

  return (
    <article className={`test-state-card ${STRIP_CLASS[p.state]} ${className}`}>
      <div className="tsc-main">
        <div className="tsc-head">
          <Exam size={15} weight="duotone" className="tsc-icon" aria-hidden="true" />
          <h4 className="tsc-title">{test.title}</h4>
        </div>

        <p className="tsc-meta">
          {test.subjectName ? `${test.subjectName}` : 'Mock test'}
          {test.questionCount ? ` · ${test.questionCount} Qs` : ''}
          {test.durationMin ? ` · ${test.durationMin} mins` : ''}
        </p>

        <p className={`tsc-label tsc-label-${p.state}`}>{p.label}</p>
      </div>

      <div className="tsc-actions">
        {p.tertiary && (
          <Link href={p.tertiary.href} className="tsc-action-tertiary">
            {p.tertiary.label}
          </Link>
        )}
        {p.action && (
          <Link href={p.action.href} className="tsc-action-primary">
            {p.action.label}
            <ArrowRight size={13} weight="bold" />
          </Link>
        )}
      </div>
    </article>
  );
}
