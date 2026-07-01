'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  useMockTests,
  useMockTest,
  useCreateMockTest,
  useUpdateMockTest,
  useDeleteMockTest,
  usePublishMockTest,
  useArchiveMockTest,
  useRestoreMockTest,
} from '@/hooks/mockTest/useMockTests';
import { useAuth } from '@/hooks/useAuth';
import type { MockTest, CreateMockTestInput, UpdateMockTestInput, MockTestStatus } from '@/types/mockTest';
import type { MockTestServiceFilters, MockTestServiceSortOptions } from '@/services/mockTest/mockTestService';
import LoadingIndicator from '@/components/dev/LoadingIndicator';
import StatusBadge from '@/components/dev/StatusBadge';

export interface MockTestsDebugInfo {
  loading: boolean;
  mutationLoading: boolean;
  selectedRecord: string | null;
  cacheStatus: string;
  queryStatus: string;
  lastHookCalled: string;
  lastApiResponse: string | null;
  errorMessage: string | null;
}

interface MockTestsPanelProps {
  onDebugInfo?: (info: MockTestsDebugInfo) => void;
}

const STATUSES: MockTestStatus[] = ['draft', 'pending_approval', 'published', 'archived'];
const TEST_TYPES = ['practice', 'mock', 'chapter_test', 'pyq_paper'];
const RESULT_RELEASE_MODES = ['immediate', 'scheduled', 'manual'];

const STATUS_VARIANT: Record<MockTestStatus, 'info' | 'warning' | 'success' | 'neutral'> = {
  draft: 'info',
  pending_approval: 'warning',
  published: 'success',
  archived: 'neutral',
};

const SORT_FIELDS = [
  { value: 'createdAt', label: 'Created At' },
  { value: 'updatedAt', label: 'Updated At' },
  { value: 'title', label: 'Title' },
  { value: 'scheduledStart', label: 'Available From' },
  { value: 'scheduledEnd', label: 'Available Until' },
] as const;

export default function MockTestsPanel({ onDebugInfo }: MockTestsPanelProps) {
  const { user } = useAuth();

  // ── Filter/Pagination/Sort state ──────────────────────────────────────
  const [search, setSearch] = useState('');
  const [filterStreamId, setFilterStreamId] = useState('');
  const [filterSubjectId, setFilterSubjectId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCreatedBy, setFilterCreatedBy] = useState('');
  const [filters, setFilters] = useState<MockTestServiceFilters>({});
  const [sortField, setSortField] = useState<string>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const pageSize = 15;

  // ── Form state ────────────────────────────────────────────────────────
  const [editRecord, setEditRecord] = useState<MockTest | null>(null);
  const [detailTestId, setDetailTestId] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formStreamId, setFormStreamId] = useState('');
  const [formSubjectId, setFormSubjectId] = useState('');
  const [formTestType, setFormTestType] = useState('practice');
  const [formDuration, setFormDuration] = useState(60);
  const [formPassingMarks, setFormPassingMarks] = useState('');
  const [formTotalMarks, setFormTotalMarks] = useState(1);
  const [formNegativeMarking, setFormNegativeMarking] = useState(0);
  const [formAttemptLimit, setFormAttemptLimit] = useState('');
  const [formAvailableFrom, setFormAvailableFrom] = useState('');
  const [formAvailableUntil, setFormAvailableUntil] = useState('');
  const [formResultReleaseMode, setFormResultReleaseMode] = useState('immediate');
  const [formResultReleaseAt, setFormResultReleaseAt] = useState('');
  const [formShuffleQuestions, setFormShuffleQuestions] = useState(false);
  const [formShuffleOptions, setFormShuffleOptions] = useState(false);
  const [formCalculatorAllowed, setFormCalculatorAllowed] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // ── Debug state ───────────────────────────────────────────────────────
  const [lastHookCalled, setLastHookCalled] = useState<string>('—');
  const [lastApiResponse, setLastApiResponse] = useState<string | null>(null);

  // ── Hooks ─────────────────────────────────────────────────────────────
  const sort: MockTestServiceSortOptions = { sortBy: sortField as MockTestServiceSortOptions['sortBy'], sortDirection: sortDir };
  const appliedFilters = Object.keys(filters).length > 0 ? filters : undefined;
  const { data, isLoading, isFetching, isStale, refetch } = useMockTests(appliedFilters, sort, { page, pageSize });
  const { data: detailTest, isLoading: detailLoading } = useMockTest(detailTestId);
  const createMutation = useCreateMockTest();
  const updateMutation = useUpdateMockTest();
  const deleteMutation = useDeleteMockTest();
  const publishMutation = usePublishMockTest();
  const archiveMutation = useArchiveMockTest();
  const restoreMutation = useRestoreMockTest();

  const isMutating =
    createMutation.isPending || updateMutation.isPending || deleteMutation.isPending ||
    publishMutation.isPending || archiveMutation.isPending || restoreMutation.isPending;

  // ── Report debug info ─────────────────────────────────────────────────
  useEffect(() => {
    if (!onDebugInfo) return;
    onDebugInfo({
      loading: isLoading,
      mutationLoading: isMutating,
      selectedRecord: editRecord?.testId ?? detailTestId ?? null,
      cacheStatus: isStale ? 'stale' : 'fresh',
      queryStatus: isFetching ? 'fetching' : isLoading ? 'loading' : 'idle',
      lastHookCalled,
      lastApiResponse,
      errorMessage: formError,
    });
  });

  // ── Filter handlers ───────────────────────────────────────────────────
  const handleSearch = useCallback(() => {
    const newFilters: MockTestServiceFilters = {};
    if (search.trim()) newFilters.search = search.trim();
    if (filterStreamId) newFilters.streamId = filterStreamId;
    if (filterSubjectId) newFilters.subjectId = filterSubjectId;
    if (filterStatus) newFilters.status = filterStatus as MockTestStatus;
    if (filterCreatedBy) newFilters.createdBy = filterCreatedBy;
    if (user?.instituteId) newFilters.instituteId = user.instituteId;
    setFilters(newFilters);
    setPage(1);
    setLastHookCalled('useMockTests [search]');
  }, [search, filterStreamId, filterSubjectId, filterStatus, filterCreatedBy, user]);

  const handleResetFilters = useCallback(() => {
    setSearch('');
    setFilterStreamId('');
    setFilterSubjectId('');
    setFilterStatus('');
    setFilterCreatedBy('');
    setFilters({});
    setPage(1);
    setLastHookCalled('useMockTests [reset]');
  }, []);

  // ── Form handlers ─────────────────────────────────────────────────────
  const resetForm = useCallback(() => {
    setEditRecord(null);
    setDetailTestId(null);
    setFormTitle('');
    setFormDescription('');
    setFormStreamId('');
    setFormSubjectId('');
    setFormTestType('practice');
    setFormDuration(60);
    setFormPassingMarks('');
    setFormTotalMarks(1);
    setFormNegativeMarking(0);
    setFormAttemptLimit('');
    setFormAvailableFrom('');
    setFormAvailableUntil('');
    setFormResultReleaseMode('immediate');
    setFormResultReleaseAt('');
    setFormShuffleQuestions(false);
    setFormShuffleOptions(false);
    setFormCalculatorAllowed(false);
    setFormError(null);
  }, []);

  const populateForm = useCallback((t: MockTest) => {
    setEditRecord(t);
    setDetailTestId(null);
    setFormTitle(t.title);
    setFormDescription(t.description ?? '');
    setFormStreamId(t.streamId);
    setFormSubjectId(t.subjectId ?? '');
    setFormTestType(t.testType);
    setFormDuration(t.durationMin);
    setFormPassingMarks(t.passingMarks?.toString() ?? '');
    setFormTotalMarks(t.totalMarks);
    setFormNegativeMarking(t.negativeMarking);
    setFormAttemptLimit(t.attemptLimit?.toString() ?? '');
    setFormAvailableFrom(t.availableFrom ?? '');
    setFormAvailableUntil(t.availableUntil ?? '');
    setFormResultReleaseMode(t.resultReleaseMode);
    setFormResultReleaseAt(t.resultReleaseAt ?? '');
    setFormShuffleQuestions(t.shuffleQuestions);
    setFormShuffleOptions(t.shuffleOptions);
    setFormCalculatorAllowed(t.calculatorAllowed);
    setFormError(null);
  }, []);

  const handleFormSubmit = useCallback(() => {
    setFormError(null);
    if (!formTitle.trim()) { setFormError('Title is required.'); return; }
    if (formTitle.trim().length < 3) { setFormError('Title must be at least 3 characters.'); return; }
    if (!formStreamId) { setFormError('Stream ID is required.'); return; }
    if (!formDuration || formDuration <= 0) { setFormError('Duration must be greater than 0.'); return; }

    if (editRecord) {
      const input: UpdateMockTestInput = {
        title: formTitle.trim(),
        description: formDescription.trim() || null,
        durationMin: formDuration,
        passingMarks: formPassingMarks ? Number(formPassingMarks) : null,
        negativeMarking: formNegativeMarking,
        attemptLimit: formAttemptLimit ? Number(formAttemptLimit) : null,
        shuffleQuestions: formShuffleQuestions,
        shuffleOptions: formShuffleOptions,
        calculatorAllowed: formCalculatorAllowed,
        testType: formTestType,
        resultReleaseMode: formResultReleaseMode,
        resultReleaseAt: formResultReleaseAt || null,
        availableFrom: formAvailableFrom || null,
        availableUntil: formAvailableUntil || null,
      };
      setLastHookCalled('useUpdateMockTest');
      updateMutation.mutate(
        { id: editRecord.testId, input },
        {
          onSuccess: (result) => { setLastApiResponse(JSON.stringify(result)); resetForm(); },
          onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
        },
      );
    } else {
      if (!user?.instituteId) { setFormError('No institute ID.'); return; }
      const input: CreateMockTestInput = {
        instituteId: user.instituteId,
        teacherId: user.id,
        streamId: formStreamId,
        subjectId: formSubjectId || null,
        title: formTitle.trim(),
        description: formDescription.trim() || null,
        durationMin: formDuration,
        totalMarks: Number(formTotalMarks),
        passingMarks: formPassingMarks ? Number(formPassingMarks) : null,
        negativeMarking: formNegativeMarking,
        attemptLimit: formAttemptLimit ? Number(formAttemptLimit) : null,
        shuffleQuestions: formShuffleQuestions,
        shuffleOptions: formShuffleOptions,
        calculatorAllowed: formCalculatorAllowed,
        testType: formTestType,
        resultReleaseMode: formResultReleaseMode,
        resultReleaseAt: formResultReleaseAt || null,
        availableFrom: formAvailableFrom || null,
        availableUntil: formAvailableUntil || null,
      };
      // ── Debug: Trace form values before mutation ────────────────────────
      console.log('=== MOCK TEST CREATE FORM VALUES ===');
      console.log('Form totalMarks:', formTotalMarks, typeof formTotalMarks);
      console.log('Form passingMarks:', formPassingMarks, typeof formPassingMarks);
      console.log('Input payload:', JSON.stringify(input, null, 2));

      setLastHookCalled('useCreateMockTest');
      createMutation.mutate(input, {
        onSuccess: (result) => { setLastApiResponse(JSON.stringify(result)); resetForm(); },
        onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
      });
    }
  }, [formTitle, formDescription, formStreamId, formSubjectId, formTestType, formDuration,
      formPassingMarks, formTotalMarks, formNegativeMarking, formAttemptLimit,
      formAvailableFrom, formAvailableUntil, formResultReleaseMode, formResultReleaseAt,
      formShuffleQuestions, formShuffleOptions, formCalculatorAllowed,
      editRecord, user, createMutation, updateMutation, resetForm]);

  const handleDelete = useCallback((t: MockTest) => {
    if (!window.confirm(`Delete mock test "${t.title}"?`)) return;
    setLastHookCalled('useDeleteMockTest');
    deleteMutation.mutate(t.testId, {
      onSuccess: () => { setLastApiResponse(JSON.stringify({ deleted: t.testId })); if (editRecord?.testId === t.testId) resetForm(); },
      onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
    });
  }, [deleteMutation, editRecord, resetForm]);

  const handlePublish = useCallback((t: MockTest) => {
    setLastHookCalled('usePublishMockTest');
    publishMutation.mutate(t.testId, {
      onSuccess: (result) => setLastApiResponse(JSON.stringify(result)),
      onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
    });
  }, [publishMutation]);

  const handleArchive = useCallback((t: MockTest) => {
    setLastHookCalled('useArchiveMockTest');
    archiveMutation.mutate(t.testId, {
      onSuccess: (result) => setLastApiResponse(JSON.stringify(result)),
      onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
    });
  }, [archiveMutation]);

  const handleRestore = useCallback((t: MockTest) => {
    setLastHookCalled('useRestoreMockTest');
    restoreMutation.mutate(t.testId, {
      onSuccess: (result) => setLastApiResponse(JSON.stringify(result)),
      onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
    });
  }, [restoreMutation]);

  const handleViewDetail = useCallback((testId: string) => {
    setDetailTestId(testId);
    setEditRecord(null);
    setLastHookCalled('useMockTest [detail]');
  }, []);

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-100">Mock Tests</h2>
          <p className="text-xs text-gray-500 mt-0.5">Create, read, update, delete, publish, archive, restore</p>
        </div>
        <div className="flex items-center gap-2">
          {isLoading && <LoadingIndicator label="Loading..." />}
          {isMutating && <LoadingIndicator label="Mutating..." />}
          <StatusBadge label={String(data?.count ?? 0) + ' tests'} variant={data ? 'info' : 'neutral'} />
        </div>
      </div>

      {!user?.instituteId && (
        <div className="rounded border border-amber-700/50 bg-amber-950/30 px-4 py-2.5">
          <span className="text-xs text-amber-400 font-medium">⚠ No Institute assigned. Create/Update operations disabled.</span>
        </div>
      )}

      {formError && (
        <div className="rounded border border-red-700/50 bg-red-950/30 px-4 py-2.5">
          <span className="text-xs text-red-400">{String(formError)}</span>
        </div>
      )}

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div className="rounded border border-gray-700 bg-gray-900 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1 min-w-[180px]">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Search</label>
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Title..." className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200" />
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Stream ID</label>
            <input type="text" value={filterStreamId} onChange={(e) => setFilterStreamId(e.target.value)} placeholder="UUID" className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200 w-[200px]" />
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Subject ID</label>
            <input type="text" value={filterSubjectId} onChange={(e) => setFilterSubjectId(e.target.value)} placeholder="UUID" className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200 w-[200px]" />
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Status</label>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200">
              <option value="">All</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Teacher ID</label>
            <input type="text" value={filterCreatedBy} onChange={(e) => setFilterCreatedBy(e.target.value)} placeholder="UUID" className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200 w-[200px]" />
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Sort</label>
            <div className="flex gap-1">
              <select value={sortField} onChange={(e) => setSortField(e.target.value)} className="rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200">
                {SORT_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
              <select value={sortDir} onChange={(e) => setSortDir(e.target.value as 'asc' | 'desc')} className="rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-gray-200 w-16">
                <option value="desc">DESC</option>
                <option value="asc">ASC</option>
              </select>
            </div>
          </div>
          <button type="button" onClick={handleSearch} className="rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white">Apply</button>
          <button type="button" onClick={handleResetFilters} className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300">Reset</button>
          <button type="button" onClick={() => { refetch().catch(() => {}); setLastHookCalled('useMockTests [refetch]'); }} className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300">Refresh</button>
        </div>
      </div>

      {/* ── Create / Edit Form ──────────────────────────────────────────── */}
      <div className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-700 bg-gray-800/50 flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-200">
            {editRecord ? `Edit: ${editRecord.title}` : 'Create New Mock Test'}
          </span>
          {editRecord && <button type="button" onClick={resetForm} className="text-[11px] text-gray-500">Cancel</button>}
        </div>
        <div className="p-4 max-h-[500px] overflow-y-auto">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div className="col-span-2 space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Title *</label>
              <input type="text" value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="e.g. NEET 2025 Mock #3" className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Description</label>
              <input type="text" value={formDescription} onChange={(e) => setFormDescription(e.target.value)} placeholder="Optional description" className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Stream ID *</label>
              <input type="text" value={formStreamId} onChange={(e) => setFormStreamId(e.target.value)} placeholder="UUID" className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Subject ID</label>
              <input type="text" value={formSubjectId} onChange={(e) => setFormSubjectId(e.target.value)} placeholder="UUID (optional)" className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Test Type</label>
              <select value={formTestType} onChange={(e) => setFormTestType(e.target.value)} className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200">
                {TEST_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Duration (min) *</label>
              <input type="number" value={formDuration} onChange={(e) => setFormDuration(Number(e.target.value))} min={1} max={600} className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Passing Marks</label>
              <input type="number" value={formPassingMarks} onChange={(e) => setFormPassingMarks(e.target.value)} min={0} placeholder="Optional" className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Total Marks</label>
              <input type="number" value={formTotalMarks} onChange={(e) => setFormTotalMarks(Number(e.target.value))} min={1} className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Negative Marking</label>
              <input type="number" value={formNegativeMarking} onChange={(e) => setFormNegativeMarking(Number(e.target.value))} min={0} className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Attempt Limit</label>
              <input type="number" value={formAttemptLimit} onChange={(e) => setFormAttemptLimit(e.target.value)} min={0} placeholder="Empty = unlimited" className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Available From</label>
              <input type="datetime-local" value={formAvailableFrom ? formAvailableFrom.slice(0, 16) : ''} onChange={(e) => setFormAvailableFrom(e.target.value ? new Date(e.target.value).toISOString() : '')} className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Available Until</label>
              <input type="datetime-local" value={formAvailableUntil ? formAvailableUntil.slice(0, 16) : ''} onChange={(e) => setFormAvailableUntil(e.target.value ? new Date(e.target.value).toISOString() : '')} className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Result Release Mode</label>
              <select value={formResultReleaseMode} onChange={(e) => setFormResultReleaseMode(e.target.value)} className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200">
                {RESULT_RELEASE_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Result Release At</label>
              <input type="datetime-local" value={formResultReleaseAt ? formResultReleaseAt.slice(0, 16) : ''} onChange={(e) => setFormResultReleaseAt(e.target.value ? new Date(e.target.value).toISOString() : '')} className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
            </div>
            <div className="flex items-end gap-4 pb-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={formShuffleQuestions} onChange={(e) => setFormShuffleQuestions(e.target.checked)} className="rounded border-gray-700 bg-gray-950 text-amber-600" />
                <span className="text-xs text-gray-300">Shuffle Questions</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={formShuffleOptions} onChange={(e) => setFormShuffleOptions(e.target.checked)} className="rounded border-gray-700 bg-gray-950 text-amber-600" />
                <span className="text-xs text-gray-300">Shuffle Options</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={formCalculatorAllowed} onChange={(e) => setFormCalculatorAllowed(e.target.checked)} className="rounded border-gray-700 bg-gray-950 text-amber-600" />
                <span className="text-xs text-gray-300">Calculator</span>
              </label>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={isMutating || !formTitle.trim() || !formStreamId || !user?.instituteId}
              onClick={handleFormSubmit}
              className="rounded bg-amber-800 px-4 py-2 text-xs font-medium text-amber-100 disabled:opacity-40"
            >
              {isMutating ? 'Saving...' : editRecord ? 'Update Mock Test' : 'Create Mock Test'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Tests Table ──────────────────────────────────────────────────── */}
      <div className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-700 bg-gray-800/50">
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Title</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Type</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Status</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">Duration</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">Marks</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Stream</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Created</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data && data.data.length > 0 ? data.data.map((t) => (
                <tr key={t.testId} className="border-b border-gray-800 hover:bg-gray-800/30 transition-colors">
                  <td className="px-3 py-2.5 text-gray-200 max-w-[250px] truncate font-medium">
                    <button type="button" onClick={() => handleViewDetail(t.testId)} className="hover:text-blue-400 transition-colors text-left">
                      {t.title}
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-gray-400">{t.testType}</td>
                  <td className="px-3 py-2.5">
                    <StatusBadge label={t.status} variant={STATUS_VARIANT[t.status]} />
                  </td>
                  <td className="px-3 py-2.5 text-right text-gray-300">{t.durationMin}m</td>
                  <td className="px-3 py-2.5 text-right text-gray-300">{t.totalMarks}</td>
                  <td className="px-3 py-2.5 text-gray-500 font-mono text-[10px]">{t.streamId.slice(0, 8)}...</td>
                  <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{new Date(t.createdAt).toLocaleDateString()}</td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" onClick={() => populateForm(t)} className="rounded bg-gray-800 px-2 py-1 text-[11px] text-gray-300 hover:bg-gray-700">Edit</button>
                      {t.status === 'pending_approval' && (
                        <button type="button" onClick={() => handlePublish(t)} disabled={publishMutation.isPending} className="rounded bg-green-900/50 px-2 py-1 text-[11px] text-green-300 hover:bg-green-900/70 disabled:opacity-40">Pub</button>
                      )}
                      {t.status === 'published' && (
                        <button type="button" onClick={() => handleArchive(t)} disabled={archiveMutation.isPending} className="rounded bg-amber-900/50 px-2 py-1 text-[11px] text-amber-300 hover:bg-amber-900/70 disabled:opacity-40">Arc</button>
                      )}
                      {t.status === 'archived' && (
                        <button type="button" onClick={() => handleRestore(t)} disabled={restoreMutation.isPending} className="rounded bg-blue-900/50 px-2 py-1 text-[11px] text-blue-300 hover:bg-blue-900/70 disabled:opacity-40">Res</button>
                      )}
                      <button type="button" onClick={() => handleDelete(t)} disabled={deleteMutation.isPending} className="rounded bg-red-900/50 px-2 py-1 text-[11px] text-red-300 hover:bg-red-900/70 disabled:opacity-40">Del</button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-gray-600">{isLoading ? 'Loading...' : 'No mock tests found'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {data && data.pageCount > 1 && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-gray-700 bg-gray-800/30">
            <span className="text-[11px] text-gray-500">Page {data.page} of {data.pageCount} ({data.count} total)</span>
            <div className="flex gap-1.5">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded bg-gray-800 px-2.5 py-1 text-[11px] text-gray-300 disabled:opacity-40">Prev</button>
              <button type="button" disabled={page >= data.pageCount} onClick={() => setPage((p) => p + 1)} className="rounded bg-gray-800 px-2.5 py-1 text-[11px] text-gray-300 disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Detail View ──────────────────────────────────────────────────── */}
      {detailTestId && (
        <div className="rounded border border-blue-700/50 bg-gray-900 overflow-hidden">
          <div className="px-4 py-2 border-b border-blue-700/50 bg-blue-950/30 flex items-center justify-between">
            <span className="text-xs font-semibold text-blue-300">Mock Test Detail: {detailTestId}</span>
            <button type="button" onClick={() => setDetailTestId(null)} className="text-[11px] text-gray-500">Close</button>
          </div>
          <div className="p-4">
            {detailLoading ? (
              <LoadingIndicator label="Loading detail..." />
            ) : detailTest ? (
              <div className="space-y-2 text-xs text-gray-300">
                <div><span className="text-gray-500">ID:</span> <span className="font-mono">{detailTest.testId}</span></div>
                <div><span className="text-gray-500">Institute:</span> <span className="font-mono">{detailTest.instituteId}</span></div>
                <div><span className="text-gray-500">Teacher:</span> <span className="font-mono">{detailTest.teacherId}</span></div>
                <div><span className="text-gray-500">Stream:</span> <span className="font-mono">{detailTest.streamId}</span></div>
                <div><span className="text-gray-500">Subject:</span> <span className="font-mono">{detailTest.subjectId ?? '(none)'}</span></div>
                <div><span className="text-gray-500">Title:</span> {detailTest.title}</div>
                <div><span className="text-gray-500">Description:</span> {detailTest.description ?? '(none)'}</div>
                <div><span className="text-gray-500">Status:</span> <StatusBadge label={detailTest.status} variant={STATUS_VARIANT[detailTest.status]} /></div>
                <div><span className="text-gray-500">Test Type:</span> {detailTest.testType}</div>
                <div><span className="text-gray-500">Duration:</span> {detailTest.durationMin} min</div>
                <div><span className="text-gray-500">Total Marks:</span> {detailTest.totalMarks}</div>
                <div><span className="text-gray-500">Passing Marks:</span> {detailTest.passingMarks ?? '(none)'}</div>
                <div><span className="text-gray-500">Negative Marking:</span> {detailTest.negativeMarking}</div>
                <div><span className="text-gray-500">Attempt Limit:</span> {detailTest.attemptLimit ?? '(unlimited)'}</div>
                <div><span className="text-gray-500">Shuffle Questions:</span> {String(detailTest.shuffleQuestions)}</div>
                <div><span className="text-gray-500">Shuffle Options:</span> {String(detailTest.shuffleOptions)}</div>
                <div><span className="text-gray-500">Calculator:</span> {String(detailTest.calculatorAllowed)}</div>
                <div><span className="text-gray-500">Result Mode:</span> {detailTest.resultReleaseMode}</div>
                <div><span className="text-gray-500">Result Release At:</span> {detailTest.resultReleaseAt ?? '(immediate/manual)'}</div>
                <div><span className="text-gray-500">Available From:</span> {detailTest.availableFrom ? new Date(detailTest.availableFrom).toLocaleString() : '(immediately)'}</div>
                <div><span className="text-gray-500">Available Until:</span> {detailTest.availableUntil ? new Date(detailTest.availableUntil).toLocaleString() : '(no expiry)'}</div>
                <div><span className="text-gray-500">Created:</span> {new Date(detailTest.createdAt).toLocaleString()}</div>
                <div><span className="text-gray-500">Updated:</span> {new Date(detailTest.updatedAt).toLocaleString()}</div>
                <div><span className="text-gray-500">Published At:</span> {detailTest.publishedAt ? new Date(detailTest.publishedAt).toLocaleString() : '—'}</div>
              </div>
            ) : (
              <span className="text-xs text-gray-500">Mock test not found or failed to load.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
