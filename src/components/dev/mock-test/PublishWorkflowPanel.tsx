'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  useValidateMockTestReady,
  usePublishMockTestWorkflow,
  useUnpublishMockTest,
} from '@/hooks/mockTest/useMockTestPublish';
import LoadingIndicator from '@/components/dev/LoadingIndicator';
import StatusBadge from '@/components/dev/StatusBadge';

export interface PublishDebugInfo {
  loading: boolean;
  mutationLoading: boolean;
  selectedRecord: string | null;
  cacheStatus: string;
  queryStatus: string;
  lastHookCalled: string;
  lastApiResponse: string | null;
  errorMessage: string | null;
}

interface PublishWorkflowPanelProps {
  onDebugInfo?: (info: PublishDebugInfo) => void;
}

interface ValidationCheckProps {
  label: string;
  passed: boolean | undefined;
  isWarning?: boolean;
}

function ValidationCheck({ label, passed, isWarning }: ValidationCheckProps) {
  if (passed === undefined) return null;
  const icon = isWarning ? (passed ? '✅' : '⚠️') : (passed ? '✅' : '❌');
  const color = passed ? 'text-green-400' : isWarning ? 'text-amber-400' : 'text-red-400';
  return (
    <div className={`flex items-center gap-2 text-xs ${color}`}>
      <span>{icon}</span>
      <span>{label}</span>
    </div>
  );
}

const VALIDATION_CHECKS = [
  { key: 'testExists' as const, label: 'Test Exists' },
  { key: 'status' as const, label: 'Draft / Pending Approval Status', isCheck: true },
  { key: 'hasQuestions' as const, label: 'Has Questions' },
  { key: 'allQuestionsExist' as const, label: 'All Questions Exist' },
  { key: 'allQuestionsPublished' as const, label: 'All Questions Published' },
  { key: 'noDuplicateDisplayOrder' as const, label: 'No Duplicate Display Order' },
  { key: 'noDuplicateQuestions' as const, label: 'No Duplicate Questions' },
  { key: 'instituteMatch' as const, label: 'Same Institute' },
  { key: 'validAvailabilityDates' as const, label: 'Valid Availability Window' },
  { key: 'validDuration' as const, label: 'Duration > 0' },
  { key: 'validTotalMarks' as const, label: 'Total Marks > 0' },
] as const;

export default function PublishWorkflowPanel({ onDebugInfo }: PublishWorkflowPanelProps) {
  const [testId, setTestId] = useState('');
  const [loadedTestId, setLoadedTestId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [publishResult, setPublishResult] = useState<string | null>(null);
  const [unpublishResult, setUnpublishResult] = useState<string | null>(null);

  // Debug
  const [lastHookCalled, setLastHookCalled] = useState<string>('—');
  const [lastApiResponse, setLastApiResponse] = useState<string | null>(null);

  // ── Hooks ──────────────────────────────────────────────────────────────
  const { data: validationReport, isLoading, isFetching, isStale, refetch } = useValidateMockTestReady(loadedTestId);
  const publishMutation = usePublishMockTestWorkflow();
  const unpublishMutation = useUnpublishMockTest();

  const isMutating = publishMutation.isPending || unpublishMutation.isPending;

  // ── Report debug info ─────────────────────────────────────────────────
  useEffect(() => {
    if (!onDebugInfo) return;
    onDebugInfo({
      loading: isLoading,
      mutationLoading: isMutating,
      selectedRecord: loadedTestId,
      cacheStatus: isStale ? 'stale' : 'fresh',
      queryStatus: isFetching ? 'fetching' : isLoading ? 'loading' : 'idle',
      lastHookCalled,
      lastApiResponse,
      errorMessage: formError,
    });
  });

  // ── Handlers ───────────────────────────────────────────────────────────
  const handleValidate = useCallback(() => {
    if (!testId.trim()) { setFormError('Test ID is required.'); return; }
    setLoadedTestId(testId.trim());
    setPublishResult(null);
    setUnpublishResult(null);
    setFormError(null);
    setLastHookCalled('useValidateMockTestReady');
  }, [testId]);

  const handlePublish = useCallback(() => {
    if (!loadedTestId) return;
    setLastHookCalled('usePublishMockTestWorkflow');
    publishMutation.mutate(loadedTestId, {
      onSuccess: (summary) => {
        const msg = `✅ Published! Status: ${summary.previousStatus} → ${summary.newStatus}\nQuestions: ${summary.questionCount}\nTotal Marks: ${summary.totalMarks}\nPublished At: ${new Date(summary.publishedAt).toLocaleString()}`;
        setPublishResult(msg);
        setLastApiResponse(JSON.stringify(summary));
      },
      onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
    });
  }, [loadedTestId, publishMutation]);

  const handleUnpublish = useCallback(() => {
    if (!loadedTestId) return;
    if (!window.confirm('Unpublish this mock test? This will revert it to draft. Only allowed if no attempts exist.')) return;
    setLastHookCalled('useUnpublishMockTest');
    unpublishMutation.mutate(loadedTestId, {
      onSuccess: (test) => {
        const msg = `✅ Unpublished! Test "${test.title}" reverted to draft.`;
        setUnpublishResult(msg);
        setLastApiResponse(JSON.stringify(test));
      },
      onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
    });
  }, [loadedTestId, unpublishMutation]);

  // Derive check results from validation report
  const getCheckPassed = useCallback((key: string): boolean | undefined => {
    if (!validationReport) return undefined;
    const d = validationReport.details;
    switch (key) {
      case 'testExists': return d.testExists;
      case 'status': return d.status === 'draft' || d.status === 'pending_approval';
      case 'hasQuestions': return d.hasQuestions;
      case 'allQuestionsExist': return d.allQuestionsExist;
      case 'allQuestionsPublished': return d.allQuestionsPublished;
      case 'noDuplicateDisplayOrder': return d.noDuplicateDisplayOrder;
      case 'noDuplicateQuestions': return d.noDuplicateQuestions;
      case 'instituteMatch': return d.instituteMatch;
      case 'validAvailabilityDates': return d.validAvailabilityDates;
      case 'validDuration': return d.validDuration;
      case 'validTotalMarks': return d.validTotalMarks;
      default: return undefined;
    }
  }, [validationReport]);

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-100">Publish Workflow</h2>
          <p className="text-xs text-gray-500 mt-0.5">Validate, publish, and unpublish mock tests</p>
        </div>
        <div className="flex items-center gap-2">
          {isLoading && <LoadingIndicator label="Validating..." />}
          {isMutating && <LoadingIndicator label="Working..." />}
          {validationReport && (
            <StatusBadge
              label={validationReport.isValid ? 'Ready' : `${validationReport.errors.length} error(s)`}
              variant={validationReport.isValid ? 'success' : 'error'}
            />
          )}
        </div>
      </div>

      {formError && (
        <div className="rounded border border-red-700/50 bg-red-950/30 px-4 py-2.5">
          <span className="text-xs text-red-400">{String(formError)}</span>
        </div>
      )}

      {/* ── Test ID selector ────────────────────────────────────────────── */}
      <div className="rounded border border-gray-700 bg-gray-900 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1 min-w-[300px] flex-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Mock Test UUID</label>
            <input type="text" value={testId} onChange={(e) => setTestId(e.target.value)} placeholder="Paste test UUID..." className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200" />
          </div>
          <button type="button" onClick={handleValidate} className="rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white">Validate</button>
          <button type="button" onClick={() => { if (loadedTestId) refetch().catch(() => {}); }} className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300">Refresh</button>
        </div>
        {loadedTestId && (
          <div className="mt-2 text-[11px] text-gray-500">Loaded: <span className="font-mono text-gray-400">{loadedTestId}</span></div>
        )}
      </div>

      {/* ── Validation Report ────────────────────────────────────────────── */}
      {validationReport && (
        <div className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-700 bg-gray-800/50 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-200">Validation Report</span>
            <StatusBadge
              label={validationReport.isValid ? 'PASS' : 'FAIL'}
              variant={validationReport.isValid ? 'success' : 'error'}
            />
          </div>
          <div className="p-4 space-y-4">
            {/* Checks */}
            <div className="grid grid-cols-2 gap-2">
              {VALIDATION_CHECKS.map((check) => (
                <ValidationCheck
                  key={check.key}
                  label={check.label}
                  passed={getCheckPassed(check.key)}
                />
              ))}
            </div>

            {/* Errors */}
            {validationReport.errors.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-red-400 mb-1.5">Errors</div>
                <ul className="space-y-1">
                  {validationReport.errors.map((err, i) => (
                    <li key={i} className="text-xs text-red-300 bg-red-950/30 rounded px-2.5 py-1.5">{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Warnings */}
            {validationReport.warnings.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-amber-400 mb-1.5">Warnings</div>
                <ul className="space-y-1">
                  {validationReport.warnings.map((warn, i) => (
                    <li key={i} className="text-xs text-amber-300 bg-amber-950/30 rounded px-2.5 py-1.5">{warn}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Question count */}
            <div className="text-xs text-gray-500">
              Questions: <span className="text-gray-300 font-semibold">{validationReport.details.questionCount}</span>
              {' | '}
              Status: <span className="text-gray-300">{validationReport.details.status}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Publish / Unpublish Actions ───────────────────────────────────── */}
      {loadedTestId && validationReport && (
        <div className="grid grid-cols-2 gap-4">
          {/* Publish */}
          <div className="rounded border border-green-700/50 bg-gray-900 overflow-hidden">
            <div className="px-4 py-2 border-b border-green-700/50 bg-green-950/30">
              <span className="text-xs font-semibold text-green-300">Publish</span>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-gray-500">
                Runs validation → generates snapshots → transitions status to <code>published</code>.
              </p>
              <button
                type="button"
                disabled={isMutating || !validationReport.isValid}
                onClick={handlePublish}
                className="rounded bg-green-800 px-4 py-2 text-xs font-medium text-green-100 disabled:opacity-40"
              >
                {publishMutation.isPending ? 'Publishing...' : 'Publish Mock Test'}
              </button>
              {publishResult && (
                <pre className="bg-green-950/40 rounded p-2 text-xs text-green-300 whitespace-pre-wrap">{publishResult}</pre>
              )}
            </div>
          </div>

          {/* Unpublish */}
          <div className="rounded border border-red-700/50 bg-gray-900 overflow-hidden">
            <div className="px-4 py-2 border-b border-red-700/50 bg-red-950/30">
              <span className="text-xs font-semibold text-red-300">Unpublish</span>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-gray-500">
                Reverts a <code>published</code> test back to <code>draft</code>.
                Only allowed when no student attempts exist.
              </p>
              <button
                type="button"
                disabled={isMutating}
                onClick={handleUnpublish}
                className="rounded bg-red-800 px-4 py-2 text-xs font-medium text-red-100 disabled:opacity-40"
              >
                {unpublishMutation.isPending ? 'Unpublishing...' : 'Unpublish'}
              </button>
              {unpublishResult && (
                <pre className="bg-red-950/40 rounded p-2 text-xs text-red-300 whitespace-pre-wrap">{unpublishResult}</pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
