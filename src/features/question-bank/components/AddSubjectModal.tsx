'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useCreateSubject } from '@/hooks/academic/useSubjects';
import { useStreams } from '@/hooks/academic/useStreams';
import { useAuth } from '@/context/AuthContext';
import type { Subject } from '@/types/academic';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Auto-generate a subject code from the name.
 * Takes the first 4 uppercase characters of the first word, or first 3 + 2nd initial.
 */
function generateCode(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return '';
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    return words[0].slice(0, 4).toUpperCase();
  }
  const first = words[0].slice(0, 3).toUpperCase();
  const second = words[1].slice(0, 1).toUpperCase();
  return (first + second).slice(0, 4);
}

// ─── Props ──────────────────────────────────────────────────────────────────

export interface AddSubjectModalProps {
  /** Whether the modal is visible. */
  isOpen: boolean;
  /** Existing subjects for duplicate detection. Pass the raw Subject array. */
  existingSubjects: Subject[];
  /** Called when the modal should close without creating. */
  onClose: () => void;
  /** Called after a subject is successfully created, with the new Subject. */
  onCreated: (subject: Subject) => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function AddSubjectModal({
  isOpen,
  existingSubjects,
  onClose,
  onCreated,
}: AddSubjectModalProps) {
  const { instituteId, user } = useAuth();
  const createSubject = useCreateSubject();

  // ── Streams ──────────────────────────────────────────────────────────────
  const { data: streamsData, isLoading: streamsLoading } = useStreams(
    instituteId ? { instituteId } : undefined,
    { sortBy: 'name', sortDirection: 'asc' },
    { page: 1, pageSize: 100 },
  );
  const streams = streamsData?.data ?? [];

  // ── Form state ───────────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [selectedStreamId, setSelectedStreamId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Auto-select first stream when data loads
  useEffect(() => {
    if (!selectedStreamId && streams.length > 0) {
      setSelectedStreamId(streams[0].streamId);
    }
  }, [streams, selectedStreamId]);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setName('');
      setError(null);
      setSuccessMsg(null);
    }
  }, [isOpen]);

  // ── Duplicate detection (case-insensitive) ──────────────────────────────
  const normalisedExistingNames = useMemo(
    () => new Set(existingSubjects.map((s) => s.name.trim().toLowerCase())),
    [existingSubjects],
  );

  // ── Submit handler ───────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    // ── Validation ──────────────────────────────────────────────────────
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Subject name is required.');
      return;
    }

    if (normalisedExistingNames.has(trimmed.toLowerCase())) {
      setError('A subject with this name already exists.');
      return;
    }

    if (!selectedStreamId) {
      setError('No stream selected. Please select a stream for this subject.');
      return;
    }

    setError(null);

    // ── Generate code ───────────────────────────────────────────────────
    const code = generateCode(trimmed);

    console.log('\n[ADD_SUBJECT] ========================');
    console.log('[ADD_SUBJECT] Step 1 — Validation passed');
    console.log('[ADD_SUBJECT]   name:', trimmed);
    console.log('[ADD_SUBJECT]   code:', code);
    console.log('[ADD_SUBJECT]   streamId:', selectedStreamId);
    console.log('[ADD_SUBJECT]   createdBy:', user?.id ?? null);
    console.log('[ADD_SUBJECT]   instituteId:', instituteId);

    // ── Create ──────────────────────────────────────────────────────────
    try {
      console.log('[ADD_SUBJECT] Step 2 — Calling createSubject.mutateAsync...');
      const result = await createSubject.mutateAsync({
        streamId: selectedStreamId,
        name: trimmed,
        code,
        createdBy: user?.id ?? null,
      });

      console.log('[ADD_SUBJECT] Step 3 — Success! Result:', JSON.stringify(result, null, 2));

      setSuccessMsg('✓ Subject created successfully.');
      setTimeout(() => {
        onCreated(result);
      }, 300);
    } catch (err: any) {
      console.log('[ADD_SUBJECT] Step 3 — Error caught');
      console.log('[ADD_SUBJECT]   err:', err);
      console.log('[ADD_SUBJECT]   err.name:', err?.name);
      console.log('[ADD_SUBJECT]   err.message:', err?.message);
      console.log('[ADD_SUBJECT]   err.stack:', err?.stack);
      console.log('[ADD_SUBJECT]   JSON:', JSON.stringify(err, Object.getOwnPropertyNames(err), 2));

      // Check for unique constraint violation on the code column
      const message = err?.message ?? 'Failed to create subject.';
      if (
        message.toLowerCase().includes('duplicate') ||
        message.toLowerCase().includes('unique') ||
        message.toLowerCase().includes('already exists')
      ) {
        console.log('[ADD_SUBJECT]   → Duplicate detected, retrying with suffixed code...');
        // The code might conflict — try appending a suffix
        try {
          const result = await createSubject.mutateAsync({
            streamId: selectedStreamId,
            name: trimmed,
            code: generateCode(trimmed) + '1',
            createdBy: user?.id ?? null,
          });
          console.log('[ADD_SUBJECT]   → Retry success!');
          setSuccessMsg('✓ Subject created successfully.');
          setTimeout(() => onCreated(result), 300);
          return;
        } catch (retryErr: any) {
          console.log('[ADD_SUBJECT]   → Retry also failed:', retryErr?.message);
          setError(message);
        }
      } else {
        console.log('[ADD_SUBJECT]   → Setting error message:', message);
        setError(message);
      }
    }
  }, [name, normalisedExistingNames, selectedStreamId, createSubject, user, onCreated]);

  // ── Close on Escape ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isPending = createSubject.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 mx-auto w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-gray-700 dark:bg-gray-900">
        {/* Header */}
        <div className="mb-5">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Add New Subject
          </h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Create a new subject for your institute&apos;s curriculum.
          </p>
        </div>

        {/* Success message */}
        {successMsg && (
          <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400">
            {successMsg}
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Form */}
        <div className="space-y-4">
          {/* Stream selector (shown when multiple streams exist) */}
          {streams.length > 1 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
                Stream <span className="text-red-500">*</span>
              </label>
              <select
                value={selectedStreamId}
                onChange={(e) => setSelectedStreamId(e.target.value)}
                disabled={streamsLoading}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              >
                {streamsLoading ? (
                  <option value="">Loading streams...</option>
                ) : (
                  streams.map((s) => (
                    <option key={s.streamId} value={s.streamId}>
                      {s.name}
                    </option>
                  ))
                )}
              </select>
            </div>
          )}

          {/* Subject Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
              Subject Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Physics, Chemistry, Biology"
              autoFocus
              disabled={isPending}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            />
            <p className="text-[10px] text-gray-400 dark:text-gray-500">
              Code will be auto-generated: <span className="font-mono font-medium text-gray-500 dark:text-gray-400">{name ? generateCode(name) : '—'}</span>
            </p>
          </div>
        </div>

        {/* Buttons */}
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || !name.trim() || !selectedStreamId}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-blue-700 disabled:opacity-50"
          >
            {isPending ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Creating...
              </>
            ) : (
              'Create Subject'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
