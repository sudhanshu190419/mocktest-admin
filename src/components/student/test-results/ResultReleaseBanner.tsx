'use client';

import React from 'react';
import { WarningCircle, Clock, ArrowLeft } from '@phosphor-icons/react';
import Link from 'next/link';

interface ResultReleaseBannerProps {
  testTitle: string;
  attemptNumber?: number;
  releasedAt?: string | null;
}

export const ResultReleaseBanner: React.FC<ResultReleaseBannerProps> = ({
  testTitle,
  attemptNumber = 1,
  releasedAt,
}) => {
  return (
    <div className="max-w-2xl mx-auto my-12 p-8 bg-white rounded-3xl border border-line shadow-xl text-center flex flex-col items-center gap-4">
      <div className="p-4 bg-amber-50 text-amber-600 rounded-2xl">
        <Clock size={48} weight="bold" />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="px-3 py-1 bg-amber-100 text-amber-800 font-bold text-xs rounded-full uppercase tracking-wider self-center">
          Result Pending Release
        </span>
        <h2 className="text-2xl font-black text-ink mt-1">{testTitle}</h2>
        <p className="text-xs text-ink-secondary font-semibold">Attempt #{attemptNumber}</p>
      </div>

      <p className="text-sm text-ink-secondary max-w-md">
        Your exam has been submitted and evaluated securely. Detailed scoring and rankings will be released once authorized by your institute administrators.
      </p>

      {releasedAt && (
        <p className="text-xs font-semibold text-amber-800 bg-amber-50 px-4 py-2 rounded-xl border border-amber-200">
          Scheduled Release Date: {new Date(releasedAt).toLocaleString()}
        </p>
      )}

      <div className="pt-4 w-full flex justify-center">
        <Link
          href="/student/tests"
          className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm bg-ink hover:bg-ink text-white transition-all shadow-md"
        >
          <ArrowLeft size={16} weight="bold" />
          <span>Return to Test Hub</span>
        </Link>
      </div>
    </div>
  );
};
