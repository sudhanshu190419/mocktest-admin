'use client';

import { useState } from 'react';
import { X } from '@phosphor-icons/react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  useDeleteLessonPlan,
  useSlotSubject,
  useUpsertLessonPlan,
} from '@/hooks/admin/useLessonPlans';
import { useChapters } from '@/hooks/academic/useChapters';
import { useTopics } from '@/hooks/academic/useTopics';
import type { LessonPlan } from '@/types/lessonPlan';
import type { TimetableSlot } from '@/types/timetable';

/**
 * Lesson Editor Modal (Phase 2C-3)
 *
 * Assigns a chapter (+ optional topic + notes) to one timetable occurrence.
 *
 * - Subject is derived from the slot's `batch_subject` (never re-selected).
 * - Chapter options are scoped to that subject; topic options are scoped to
 *   the selected chapter; "No specific topic" = chapter-only lesson (topic
 *   null) — matching migration 113 semantics.
 * - Save → `upsert_lesson_plan` (FULL-REPLACE: sends the complete current
 *   state). Remove (only when a plan exists) → `delete_lesson_plan` via a
 *   nested ConfirmDialog. The RPCs only ever rewrite FUTURE scheduled
 *   classes; the page already blocks editing of live/completed/cancelled
 *   occurrences.
 *
 * @module components/admin/timetable/LessonEditorModal
 */

/** isodow 1..7 labels (mirrors the admin timetable module). */
const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Shared label style (matches Select / TimetableFormModal conventions). */
const labelClass =
  'block text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400';

/** Shared select/textarea style (matches the admin `Select` primitive). */
const inputClass =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 ' +
  'transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 ' +
  'disabled:cursor-not-allowed disabled:opacity-60 ' +
  'dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

/** "10:00:00" → "10:00 AM" (12-hour). */
function formatTime(value: string): string {
  if (!value) return '—';
  const parts = value.split(':');
  if (parts.length < 2) return value;
  let h = parseInt(parts[0], 10);
  const m = parts[1];
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${suffix}`;
}

/** "2026-08-17" → "17 Aug 2026" (UTC — date-only input, no local-tz shift). */
function formatDateLabel(occurrenceDate: string): string {
  const d = new Date(`${occurrenceDate}T00:00:00.000Z`);
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

interface LessonEditorModalProps {
  /** The resolved timetable slot (subject, day/time labels, batch_subject). */
  slot: TimetableSlot;
  /** YYYY-MM-DD occurrence being edited. */
  occurrenceDate: string;
  /** Existing lesson_plan (null when adding a new one). */
  plan: LessonPlan | null;
  onClose: () => void;
  /** Called after a successful save/delete with a success message for the toast. */
  onSaved: (message: string) => void;
}

export function LessonEditorModal({
  slot,
  occurrenceDate,
  plan,
  onClose,
  onSaved,
}: LessonEditorModalProps) {
  const [chapterId, setChapterId] = useState(plan?.chapterId ?? '');
  const [topicId, setTopicId] = useState(plan?.topicId ?? '');
  const [notes, setNotes] = useState(plan?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Subject is derived from the slot — the admin never re-selects it.
  const { data: subjectId } = useSlotSubject(slot.batchSubjectId);

  const { data: chaptersData, isLoading: chaptersLoading } = useChapters(
    subjectId ? { subjectId } : undefined,
    { sortBy: 'name', sortDirection: 'asc' },
    { page: 1, pageSize: 200 },
  );
  const chapters = chaptersData?.data ?? [];

  const { data: topicsData, isLoading: topicsLoading } = useTopics(
    chapterId ? { chapterId } : undefined,
    { sortBy: 'name', sortDirection: 'asc' },
    { page: 1, pageSize: 200 },
  );
  const topics = topicsData?.data ?? [];

  const upsertMutation = useUpsertLessonPlan();
  const deleteMutation = useDeleteLessonPlan();

  const hasPlan = Boolean(plan);
  const pending = upsertMutation.isPending || deleteMutation.isPending;

  const handleChapterChange = (value: string) => {
    setChapterId(value);
    setTopicId(''); // chapter changed — the previous topic is invalid.
    setError(null);
  };

  const handleSave = () => {
    if (!chapterId) return;
    setError(null);
    upsertMutation.mutate(
      {
        timetableSlotId: slot.timetableSlotId,
        occurrenceDate,
        chapterId,
        topicId: topicId || null,
        notes: notes.trim() || null,
      },
      {
        onSuccess: () => onSaved('Lesson saved successfully.'),
        onError: (err) => setError(err.message),
      },
    );
  };

  const handleDelete = () => {
    setError(null);
    deleteMutation.mutate(
      { timetableSlotId: slot.timetableSlotId, occurrenceDate },
      {
        onSuccess: () => onSaved('Lesson plan removed.'),
        onError: (err) => {
          setConfirmDelete(false);
          setError(err.message);
        },
      },
    );
  };

  const dayLabel = DAY_LABELS[(slot.dayOfWeek - 1 + 7) % DAY_LABELS.length] ?? '';
  const title = `${hasPlan ? 'Edit' : 'Add'} Lesson — ${dayLabel} · ${formatDateLabel(occurrenceDate)}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => {
          if (!pending) onClose();
        }}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lesson-editor-title"
        className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-200 bg-white p-6 shadow-xl animate-[fadeIn_200ms_ease-out] dark:border-gray-700 dark:bg-gray-900"
      >
        {/* Header */}
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2
              id="lesson-editor-title"
              className="text-lg font-semibold text-gray-900 dark:text-gray-100"
            >
              {title}
            </h2>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              {slot.subjectName ?? 'Subject'} — {slot.batchName ?? 'Batch'} ·{' '}
              {formatTime(slot.startTime)} – {formatTime(slot.endTime)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <div className="space-y-4">
          <div>
            <label className={labelClass}>
              Chapter <span className="text-rose-500">*</span>
            </label>
            <select
              value={chapterId}
              onChange={(e) => handleChapterChange(e.target.value)}
              disabled={chaptersLoading || pending}
              className={inputClass}
            >
              <option value="">
                {chaptersLoading ? 'Loading chapters…' : 'Select chapter'}
              </option>
              {chapters.map((chapter) => (
                <option key={chapter.chapterId} value={chapter.chapterId}>
                  {chapter.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>Topic</label>
            <select
              value={topicId}
              onChange={(e) => {
                setTopicId(e.target.value);
                setError(null);
              }}
              disabled={!chapterId || topicsLoading || pending}
              className={inputClass}
            >
              <option value="">
                {!chapterId
                  ? 'Select a chapter first'
                  : topicsLoading
                    ? 'Loading topics…'
                    : 'No specific topic'}
              </option>
              {topics.map((topic) => (
                <option key={topic.topicId} value={topic.topicId}>
                  {topic.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              disabled={pending}
              placeholder="Optional note for this lesson (e.g. homework, resources)…"
              className={`${inputClass} resize-y`}
            />
          </div>

          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="mt-6 flex items-center justify-between gap-3">
          {hasPlan ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={pending}
              className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900/50 dark:text-rose-400 dark:hover:bg-rose-900/20"
            >
              Remove
            </button>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!chapterId || pending}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              {upsertMutation.isPending ? 'Saving…' : hasPlan ? 'Save Changes' : 'Save Lesson'}
            </button>
          </div>
        </div>

        {/* Delete confirmation (nests above the modal — same fixed z-50 overlay). */}
        <ConfirmDialog
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          onConfirm={handleDelete}
          title="Remove lesson plan?"
          message="This removes the planned chapter/topic for this occurrence and clears it from the future scheduled class. Historical classes are never modified."
          confirmLabel="Remove Lesson Plan"
          loading={deleteMutation.isPending}
          variant="danger"
        />
      </div>
    </div>
  );
}
