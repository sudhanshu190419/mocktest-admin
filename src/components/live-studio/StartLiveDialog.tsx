'use client';

/**
 * StartLiveDialog — Pre-start dialog for launching a live class.
 *
 * The teacher selects:
 *   - Batch     (required, loaded from getAssignedBatches)
 *   - Title     (optional, auto-generated)
 *
 * Subject is auto-selected (first authorized subject) in the background.
 *
 * @module components/live-studio/StartLiveDialog
 */

import React, { useState, useEffect, useCallback } from 'react';
import { teacherService } from '@/services/teacherService';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface StartLiveClassSelections {
  batchId: string;
  batchName: string;
  title: string;
}

interface StartLiveDialogProps {
  teacherId: string;
  /** Called when the teacher confirms. The parent should then start the class. */
  onStart: (selections: StartLiveClassSelections) => void;
  /** Called when the teacher cancels / closes the dialog. */
  onCancel: () => void;
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function StartLiveDialog({
  teacherId,
  onStart,
  onCancel,
}: StartLiveDialogProps) {
  // ── State ──────────────────────────────────────────────────────────────

  const [batches, setBatches] = useState<
    { id: string; name: string; code: string }[]
  >([]);

  const [selectedBatchId, setSelectedBatchId] = useState<string>('');
  const [customTitle, setCustomTitle] = useState<string>('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);

  // ── Load batches on mount ──────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const batchList = await teacherService.getAssignedBatches(teacherId);
        if (cancelled) return;

        setBatches(
          batchList.map((b) => ({
            id: b.id,
            name: b.name,
            code: b.code,
          }))
        );

        // Auto-generate a default title
        setCustomTitle('Live Class');
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load options.'
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [teacherId]);

  // ── Handlers ────────────────────────────────────────────────────────

  const handleBatchChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setSelectedBatchId(e.target.value);
    },
    []
  );

  const handleStart = useCallback(async () => {
    setError(null);

    // Validate
    if (!selectedBatchId) {
      setError('Please select a batch.');
      return;
    }

    setValidating(true);
    try {
      // Validate batch is assigned
      const isAssigned = batches.some((b) => b.id === selectedBatchId);
      if (!isAssigned) {
        throw new Error('Selected batch is not assigned to you.');
      }

      const batchName =
        batches.find((b) => b.id === selectedBatchId)?.name || 'Batch';

      onStart({
        batchId: selectedBatchId,
        batchName,
        title: customTitle.trim() || 'Live Class',
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Validation failed.'
      );
    } finally {
      setValidating(false);
    }
  }, [selectedBatchId, customTitle, batches, onStart]);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-900">
        {/* Header */}
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Start Live Class
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Select a batch and start your live session.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
            <span className="ml-3 text-gray-500">Loading options…</span>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Error */}
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
                {error}
              </div>
            )}

            {/* Batch */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Batch <span className="text-red-500">*</span>
              </label>
              <select
                value={selectedBatchId}
                onChange={handleBatchChange}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              >
                <option value="">— Select a batch —</option>
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              {batches.length === 0 && (
                <p className="mt-1 text-xs text-amber-600">
                  No batches assigned. Contact admin.
                </p>
              )}
            </div>

            {/* Custom Title */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Class Title <span className="text-gray-400">(optional)</span>
              </label>
              <input
                type="text"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder="Live Class"
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500"
              />
            </div>
          </div>
        )}

        {/* Footer Buttons */}
        <div className="mt-6 flex items-center justify-end gap-3 border-t border-gray-200 pt-4 dark:border-gray-700">
          <button
            onClick={onCancel}
            disabled={validating}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={handleStart}
            disabled={loading || validating || !selectedBatchId}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {validating ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Verifying…
              </>
            ) : (
              'Start Live'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
