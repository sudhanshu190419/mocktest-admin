'use client';

import React, { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  SpinnerGap,
  ShieldWarning,
  CheckCircle,
} from '@phosphor-icons/react';
import {
  fetchStudentTestRunnerData,
  type TestRunnerSessionData,
} from '@/services/student/studentTestWebService';
import { TestRunnerShell } from '@/components/student/test-runner/TestRunnerShell';

interface RunnerPageProps {
  params: Promise<{ testId: string }>;
}

export default function StudentTestRunnerPage({ params }: RunnerPageProps) {
  const unwrappedParams = use(params);
  const testId = unwrappedParams.testId;

  const searchParams = useSearchParams();
  const attemptId = searchParams.get('attemptId');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [sessionData, setSessionData] = useState<TestRunnerSessionData | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadRunner() {
      if (!attemptId) {
        if (isMounted) {
          setError('Missing attempt session identifier. Please start or resume this test from the instructions page.');
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      setError(null);

      const res = await fetchStudentTestRunnerData(testId, attemptId);
      if (!isMounted) return;

      if (!res.success || !res.data) {
        if (res.isAlreadySubmitted) {
          setIsSubmitted(true);
        }
        setError(res.error || 'Failed to initialize test session.');
        setLoading(false);
        return;
      }

      setSessionData(res.data);
      setLoading(false);
    }

    void loadRunner();

    return () => {
      isMounted = false;
    };
  }, [testId, attemptId]);

  // 1. Loading State
  if (loading) {
    return (
      <div className="min-h-screen bg-paper flex flex-col items-center justify-center p-6 text-center">
        <div className="p-6 bg-white rounded-card shadow-sm border border-line flex flex-col items-center gap-4 max-w-sm w-full">
          <SpinnerGap size={36} weight="bold" className="animate-spin text-brand" />
          <div>
            <h2 className="text-base font-bold text-ink">Preparing Test Environment</h2>
            <p className="text-caption text-ink-secondary mt-1">Loading questions, signed assets & attempt state...</p>
          </div>
        </div>
      </div>
    );
  }

  // 2. Already Submitted Attempt State
  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-card shadow-sm border border-line p-6 sm:p-8 text-center flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-mint text-mint-ink flex items-center justify-center">
            <CheckCircle size={36} weight="fill" className="text-emerald-600" />
          </div>
          <div>
            <h2 className="text-h3 font-bold text-ink">Test Attempt Already Completed</h2>
            <p className="text-sm text-ink-secondary mt-1 leading-relaxed">
              This attempt has already been submitted or completed. You can view the results or review instructions from the test hub.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 w-full mt-2">
            <Link
              href="/student/tests"
              className="flex-1 min-h-[44px] py-2.5 px-4 bg-brand hover:bg-brand-hover text-white font-bold text-sm rounded-field transition-colors flex items-center justify-center"
            >
              Back to Test Hub
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // 3. Error / Invalid Session State
  if (error || !sessionData) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-card shadow-sm border border-line p-6 sm:p-8 text-center flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-red-500/20 text-red-600 flex items-center justify-center">
            <ShieldWarning size={36} weight="fill" />
          </div>
          <div>
            <h2 className="text-h3 font-bold text-ink">Unable to Open Test Runner</h2>
            <p className="text-sm text-ink-secondary mt-1 leading-relaxed">{error || 'Session could not be loaded.'}</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 w-full mt-2">
            <Link
              href={`/student/tests/${testId}`}
              className="flex-1 min-h-[44px] py-2.5 px-4 bg-paper hover:bg-sky-tint text-ink font-semibold text-sm rounded-field border border-line transition-colors flex items-center justify-center gap-2"
            >
              <ArrowLeft size={16} weight="bold" />
              <span>Back to Instructions</span>
            </Link>
            <Link
              href="/student/tests"
              className="flex-1 min-h-[44px] py-2.5 px-4 bg-brand hover:bg-brand-hover text-white font-bold text-sm rounded-field transition-colors flex items-center justify-center"
            >
              Test Hub
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // 4. Render Desktop Runner Shell
  return <TestRunnerShell sessionData={sessionData} />;
}
