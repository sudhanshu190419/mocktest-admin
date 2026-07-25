'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useCreateTopic } from '@/hooks/academic/useTopics';
import { useAuth } from '@/context/AuthContext';
import type { Topic } from '@/types/academic';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface AddTopicModalProps {
  /** Whether the modal is visible. */
  isOpen: boolean;
  /** The currently selected chapter ID (topic's parent). */
  chapterId: string;
  /** Existing topics under this chapter for duplicate detection. */
  existingTopics: Topic[];
  /** Called when the modal should close without creating. */
  onClose: () => void;
  /** Called after a topic is successfully created, with the new Topic. */
  onCreated: (topic: Topic) => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function AddTopicModal({
  isOpen,
  chapterId,
  existingTopics,
  onClose,
  onCreated,
}: AddTopicModalProps) {
  const { user } = useAuth();
  const createTopic = useCreateTopic();

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
    () => new Set(existingTopics.map((t) => t.name.trim().toLowerCase())),
    [existingTopics],
  );

  // ── Submit handler ───────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    // ── Validation ──────────────────────────────────────────────────────
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Topic name is required.');
      return;
    }

    if (normalisedExistingNames.has(trimmed.toLowerCase())) {
      setError('A topic with this name already exists under this chapter.');
      return;
    }

    if (!chapterId) {
      setError('No chapter selected. Please select a chapter first.');
      return;
    }

    setError(null);

    console.log('\n[ADD_TOPIC] ========================');
    console.log('[ADD_TOPIC] Step 1 — Validation passed');
    console.log('[ADD_TOPIC]   name:', trimmed);
    console.log('[ADD_TOPIC]   chapterId:', chapterId);
    console.log('[ADD_TOPIC]   createdBy:', user?.id ?? null);

    // ── Create ──────────────────────────────────────────────────────────
    try {
      console.log('[ADD_TOPIC] Step 2 — Calling createTopic.mutateAsync...');
      const result = await createTopic.mutateAsync({
        chapterId,
        name: trimmed,
        createdBy: user?.id ?? null,
      });

      console.log('[ADD_TOPIC] Step 3 — Success! Result:', JSON.stringify(result, null, 2));

      setSuccessMsg('✓ Topic created successfully.');
      setTimeout(() => {
        onCreated(result);
      }, 300);
    } catch (err: any) {
      console.log('[ADD_TOPIC] Step 3 — Error caught');
      console.log('[ADD_TOPIC]   err:', err);
      console.log('[ADD_TOPIC]   err.name:', err?.name);
      console.log('[ADD_TOPIC]   err.message:', err?.message);
      console.log('[ADD_TOPIC]   JSON:', JSON.stringify(err, Object.getOwnPropertyNames(err), 2));

      const message = err?.message ?? 'Failed to create topic.';
      if (
        message.toLowerCase().includes('duplicate') ||
        message.toLowerCase().includes('unique') ||
        message.toLowerCase().includes('already exists')
      ) {
        console.log('[ADD_TOPIC]   → Name conflict detected.');
        setError('A topic with this name already exists.');
      } else {
        console.log('[ADD_TOPIC]   → Setting error message:', message);
        setError(message);
      }
    }
  }, [name, normalisedExistingNames, chapterId, createTopic, user, onCreated]);

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

  const isPending = createTopic.isPending;

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
            Add New Topic
          </h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Create a new topic for the current chapter.
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
          {/* Topic Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
              Topic Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Newton's First Law, Kinematic Equations"
              autoFocus
              disabled={isPending}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            />
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
            disabled={isPending || !name.trim() || !chapterId}
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
              'Create Topic'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
