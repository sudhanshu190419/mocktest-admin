'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useBatches } from '@/hooks/academic/useBatches';
import { useBatchSubjects } from '@/hooks/admin/useBatchSubjectContentAssignment';
import { useBSTAvailableTeachers } from '@/hooks/admin/useBatchSubjectTeacherAssignment';
import {
  useCreateTimetableSlot,
  useUpdateTimetableSlot,
} from '@/hooks/admin/useTimetableAdmin';
import { cn } from '@/lib/utils';
import { CalendarPlus, CircleNotch, X } from '@phosphor-icons/react';
import type { TimetableSlot } from '@/types/timetable';

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

/** isodow (1 = Monday … 7 = Sunday) labels. */
const DAY_OPTIONS = [
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
  { value: '7', label: 'Sunday' },
];

/** Normalizes "10:00:00" → "10:00" for time inputs. */
function toTimeInput(value: string): string {
  if (!value) return '';
  const parts = value.split(':');
  if (parts.length < 2) return value;
  return `${parts[0]}:${parts[1]}`;
}

/** Splits "YYYY-MM-DD" into the browser's date-input value (same format). */
function toDateInput(value: string): string {
  return value || '';
}

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

interface FormState {
  teacherId: string;
  batchId: string;
  batchSubjectId: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  validFrom: string;
  validUntil: string;
}

interface FormErrors {
  teacherId?: string;
  batchId?: string;
  batchSubjectId?: string;
  dayOfWeek?: string;
  startTime?: string;
  endTime?: string;
  validFrom?: string;
  validUntil?: string;
  submit?: string;
}

interface TimetableFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  /** The slot being edited (null for create). */
  slot?: TimetableSlot | null;
  onClose: () => void;
  onSuccess?: () => void;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════════════════

export function TimetableFormModal({ open, mode, slot, onClose, onSuccess }: TimetableFormModalProps) {
  const { instituteId, user } = useAuth();

  // ── Data selectors (RLS keeps them scoped to the institute) ────────────
  // Note: edit mode must still be able to represent the slot's CURRENT
  // teacher/batch/subject even if that related row later left the "active"
  // state (deactivated teacher, completed batch, inactive batch-subject).
  // We therefore merge the slot's own values into the option lists below.
  const { data: teachersData, isLoading: teachersLoading } = useBSTAvailableTeachers(
    instituteId ?? '',
  );
  const teacherOptions = useMemo(() => {
    const options = (teachersData ?? []).map((t) => ({
      value: t.teacherId,
      label: t.teacherName,
    }));
    if (slot?.teacherId && !options.some((o) => o.value === slot.teacherId)) {
      options.unshift({
        value: slot.teacherId,
        label: slot.teacherName ?? 'Current teacher',
      });
    }
    return options;
  }, [teachersData, slot]);

  const { data: batchesData, isLoading: batchesLoading } = useBatches(
    instituteId ? { instituteId, includeDeleted: false } : undefined,
    undefined,
    { page: 1, pageSize: 100 },
  );
  const batchOptions = useMemo(() => {
    const options = (batchesData?.data ?? []).map((b) => ({
      value: b.batchId,
      label: b.name,
    }));
    if (slot?.batchId && !options.some((o) => o.value === slot.batchId)) {
      options.unshift({
        value: slot.batchId,
        label: slot.batchName ?? 'Current batch',
      });
    }
    return options;
  }, [batchesData, slot]);

  // ── Form state (initialized once from the slot being edited) ───────────
  const [form, setForm] = useState<FormState>(() => ({
    teacherId: slot?.teacherId ?? '',
    batchId: slot?.batchId ?? '',
    batchSubjectId: slot?.batchSubjectId ?? '',
    dayOfWeek: slot ? String(slot.dayOfWeek) : '',
    startTime: slot ? toTimeInput(slot.startTime) : '10:00',
    endTime: slot ? toTimeInput(slot.endTime) : '11:00',
    validFrom: slot ? toDateInput(slot.validFrom) : '',
    validUntil: slot ? toDateInput(slot.validUntil) : '',
  }));
  const [errors, setErrors] = useState<FormErrors>({});

  // Subjects for the selected batch (only when a batch is chosen)
  const { data: subjectsData, isLoading: subjectsLoading } = useBatchSubjects(form.batchId);
  const subjectOptions = useMemo(() => {
    const batchName = batchOptions.find((b) => b.value === form.batchId)?.label ?? 'Batch';
    const options = (subjectsData ?? []).map((s) => ({
      value: s.batchSubjectId,
      label: `${batchName} — ${s.subjectName}`,
    }));
    // Keep the slot's own batch-subject selectable in edit mode even if it
    // was later deactivated (is_active = false).
    if (slot?.batchSubjectId && !options.some((o) => o.value === slot.batchSubjectId)) {
      options.unshift({
        value: slot.batchSubjectId,
        label: `${batchName} — ${slot.subjectName ?? 'Current subject'}`,
      });
    }
    return options;
  }, [subjectsData, batchOptions, form.batchId, slot]);

  const createMutation = useCreateTimetableSlot();
  const updateMutation = useUpdateTimetableSlot();
  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  if (!open) return null;

  const handleChange = (field: keyof FormState) => (value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
    // Changing the batch invalidates the chosen subject
    if (field === 'batchId') {
      setForm((prev) => ({ ...prev, batchSubjectId: '' }));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // ── Validate ───────────────────────────────────────────────────────
    const next: FormErrors = {};
    if (!form.teacherId) next.teacherId = 'Select a teacher.';
    if (!form.batchId) next.batchId = 'Select a batch.';
    if (!form.batchSubjectId) next.batchSubjectId = 'Select a subject for the batch.';
    if (!form.dayOfWeek) next.dayOfWeek = 'Select a day.';
    if (!form.startTime) next.startTime = 'Start time is required.';
    if (!form.endTime) next.endTime = 'End time is required.';
    if (form.startTime && form.endTime && form.endTime <= form.startTime) {
      next.endTime = 'End time must be after start time.';
    }
    if (!form.validFrom) next.validFrom = 'Valid from is required.';
    if (!form.validUntil) next.validUntil = 'Valid until is required.';
    if (form.validFrom && form.validUntil && form.validUntil < form.validFrom) {
      next.validUntil = 'Valid until must be on or after valid from.';
    }

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const base = {
      teacherId: form.teacherId,
      batchSubjectId: form.batchSubjectId,
      dayOfWeek: parseInt(form.dayOfWeek, 10),
      startTime: form.startTime,
      endTime: form.endTime,
      validFrom: form.validFrom,
      validUntil: form.validUntil,
    };

    if (mode === 'create') {
      createMutation.mutate(
        {
          ...base,
          instituteId: instituteId ?? '',
          createdBy: user?.id ?? '',
        },
        {
          onSuccess: () => {
            onSuccess?.();
            onClose();
          },
          onError: (err) => setErrors((prev) => ({ ...prev, submit: err.message })),
        },
      );
      return;
    }

    updateMutation.mutate(
      {
        ...base,
        timetableSlotId: slot!.timetableSlotId,
        // Lets the service detect schedule-affecting edits and best-effort
        // reconcile (cancel stale future + regenerate) only when needed.
        previousSlot: slot ?? null,
      },
      {
        onSuccess: () => {
          onSuccess?.();
          onClose();
        },
        onError: (err) => setErrors((prev) => ({ ...prev, submit: err.message })),
      },
    );
  };

  const inputClass = (hasError?: string) =>
    cn(
      'w-full rounded-lg border px-3 py-2 text-sm text-gray-900 transition-colors focus:outline-none focus:ring-2 dark:bg-gray-900 dark:text-gray-100',
      hasError
        ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20'
        : 'border-gray-200 focus:border-blue-500 focus:ring-blue-500/20 dark:border-gray-700',
    );

  const labelClass = 'mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="timetable-form-title"
        className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-200 bg-white p-6 shadow-xl animate-[fadeIn_200ms_ease-out] dark:border-gray-700 dark:bg-gray-900"
      >
        {/* Header */}
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 id="timetable-form-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {mode === 'create' ? 'Create Timetable' : 'Edit Timetable'}
            </h2>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              {mode === 'create'
                ? 'Define a recurring weekly teaching slot. Classes are materialized separately.'
                : 'Update the recurring slot. Conflicts with other slots are rejected by the database.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Teacher */}
          <div>
            <label className={labelClass}>
              Teacher <span className="text-rose-500">*</span>
            </label>
            <select
              value={form.teacherId}
              onChange={(e) => handleChange('teacherId')(e.target.value)}
              disabled={teachersLoading}
              className={inputClass(errors.teacherId)}
            >
              <option value="">{teachersLoading ? 'Loading teachers…' : 'Select teacher'}</option>
              {teacherOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {errors.teacherId && <p className="mt-1 text-xs text-rose-500">{errors.teacherId}</p>}
          </div>

          {/* Batch */}
          <div>
            <label className={labelClass}>
              Batch <span className="text-rose-500">*</span>
            </label>
            <select
              value={form.batchId}
              onChange={(e) => handleChange('batchId')(e.target.value)}
              disabled={batchesLoading}
              className={inputClass(errors.batchId)}
            >
              <option value="">{batchesLoading ? 'Loading batches…' : 'Select batch'}</option>
              {batchOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {errors.batchId && <p className="mt-1 text-xs text-rose-500">{errors.batchId}</p>}
          </div>

          {/* Subject (from the selected batch's batch_subjects) */}
          <div>
            <label className={labelClass}>
              Batch + Subject <span className="text-rose-500">*</span>
            </label>
            <select
              value={form.batchSubjectId}
              onChange={(e) => handleChange('batchSubjectId')(e.target.value)}
              disabled={!form.batchId || subjectsLoading}
              className={inputClass(errors.batchSubjectId)}
            >
              <option value="">
                {!form.batchId
                  ? 'Select a batch first'
                  : subjectsLoading
                    ? 'Loading subjects…'
                    : 'Select subject'}
              </option>
              {subjectOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {errors.batchSubjectId && (
              <p className="mt-1 text-xs text-rose-500">{errors.batchSubjectId}</p>
            )}
            {form.batchId && subjectOptions.length === 0 && !subjectsLoading && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                This batch has no active subjects assigned yet.
              </p>
            )}
          </div>

          {/* Day of week */}
          <div>
            <label className={labelClass}>
              Day of Week <span className="text-rose-500">*</span>
            </label>
            <select
              value={form.dayOfWeek}
              onChange={(e) => handleChange('dayOfWeek')(e.target.value)}
              className={inputClass(errors.dayOfWeek)}
            >
              <option value="">Select day</option>
              {DAY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {errors.dayOfWeek && <p className="mt-1 text-xs text-rose-500">{errors.dayOfWeek}</p>}
          </div>

          {/* Start / end time */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>
                Start Time <span className="text-rose-500">*</span>
              </label>
              <input
                type="time"
                value={form.startTime}
                onChange={(e) => handleChange('startTime')(e.target.value)}
                className={inputClass(errors.startTime)}
              />
              {errors.startTime && <p className="mt-1 text-xs text-rose-500">{errors.startTime}</p>}
            </div>
            <div>
              <label className={labelClass}>
                End Time <span className="text-rose-500">*</span>
              </label>
              <input
                type="time"
                value={form.endTime}
                onChange={(e) => handleChange('endTime')(e.target.value)}
                className={inputClass(errors.endTime)}
              />
              {errors.endTime && <p className="mt-1 text-xs text-rose-500">{errors.endTime}</p>}
            </div>
          </div>

          {/* Validity */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>
                Valid From <span className="text-rose-500">*</span>
              </label>
              <input
                type="date"
                value={form.validFrom}
                onChange={(e) => handleChange('validFrom')(e.target.value)}
                className={inputClass(errors.validFrom)}
              />
              {errors.validFrom && <p className="mt-1 text-xs text-rose-500">{errors.validFrom}</p>}
            </div>
            <div>
              <label className={labelClass}>
                Valid Until <span className="text-rose-500">*</span>
              </label>
              <input
                type="date"
                value={form.validUntil}
                onChange={(e) => handleChange('validUntil')(e.target.value)}
                className={inputClass(errors.validUntil)}
              />
              {errors.validUntil && <p className="mt-1 text-xs text-rose-500">{errors.validUntil}</p>}
            </div>
          </div>

          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            Times are wall-clock in the institute timezone (Asia/Kolkata default). Occurrences are
            materialized into live classes in a separate step.
          </p>

          {/* Submit error */}
          {errors.submit && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-300">
              {errors.submit}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50"
            >
              {isSubmitting ? (
                <CircleNotch size={16} className="animate-spin" />
              ) : (
                <CalendarPlus size={16} />
              )}
              {mode === 'create' ? 'Create Timetable' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
