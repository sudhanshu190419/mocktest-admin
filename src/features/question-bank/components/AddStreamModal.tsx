'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useCreateStream } from '@/hooks/academic/useStreams';
import { useAuth } from '@/context/AuthContext';
import type { Stream } from '@/types/academic';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Auto-generate a stream code from the name.
 * Takes first 4 uppercase characters. Removes non-alphanumeric chars.
 */
function generateCode(name: string): string {
  const cleaned = name.trim().toUpperCase().replace(/[^A-Z0-9\s]/g, '');
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    return words[0].slice(0, 4);
  }
  const first = words[0].slice(0, 3);
  const second = words[1].slice(0, 1);
  return (first + second).slice(0, 4);
}

// ─── Props ──────────────────────────────────────────────────────────────────

export interface AddStreamModalProps {
  /** Whether the modal is visible. */
  isOpen: boolean;
  /** Existing streams for duplicate detection. Pass the raw Stream array. */
  existingStreams: Stream[];
  /** Called when the modal should close without creating. */
  onClose: () => void;
  /** Called after a stream is successfully created, with the new Stream. */
  onCreated: (stream: Stream) => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function AddStreamModal({
  isOpen,
  existingStreams,
  onClose,
  onCreated,
}: AddStreamModalProps) {
  const { instituteId, user } = useAuth();
  const createStream = useCreateStream();

  // ── Form state ───────────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

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
    () => new Set(existingStreams.map((s) => s.name.trim().toLowerCase())),
    [existingStreams],
  );

  // ── Submit handler ───────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    // ── Validation ──────────────────────────────────────────────────────
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Stream name is required.');
      return;
    }

    if (normalisedExistingNames.has(trimmed.toLowerCase())) {
      setError('A stream with this name already exists.');
      return;
    }

    if (!instituteId) {
      setError('Institute not found. Please ensure you have an institute assigned.');
      return;
    }

    setError(null);

    // ── Generate code ───────────────────────────────────────────────────
    const code = generateCode(trimmed);

    // ── Create ──────────────────────────────────────────────────────────
    try {
      const result = await createStream.mutateAsync({
        instituteId,
        name: trimmed,
        code,
        createdBy: user?.id ?? null,
      });

      setSuccessMsg('✓ Stream created successfully.');
      setTimeout(() => {
        onCreated(result);
      }, 300);
    } catch (err: any) {
      const message = err?.message ?? 'Failed to create stream.';
      if (
        message.toLowerCase().includes('duplicate') ||
        message.toLowerCase().includes('unique') ||
        message.toLowerCase().includes('already exists')
      ) {
        // Code might conflict — try appending a suffix
        try {
          const result = await createStream.mutateAsync({
            instituteId,
            name: trimmed,
            code: generateCode(trimmed) + '1',
            createdBy: user?.id ?? null,
          });
          setSuccessMsg('✓ Stream created successfully.');
          setTimeout(() => onCreated(result), 300);
          return;
        } catch {
          setError(message);
        }
      } else {
        setError(message);
      }
    }
  }, [name, normalisedExistingNames, instituteId, createStream, user, onCreated]);

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

  const isPending = createStream.isPending;

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
            Add New Stream
          </h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Create a new stream for your institute&apos;s curriculum.
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
          {/* Stream Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
              Stream Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. NEET, JEE Mains, CUET"
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
            disabled={isPending || !name.trim()}
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
              'Create Stream'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
