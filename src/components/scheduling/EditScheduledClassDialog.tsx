'use client';

import React, { useState, useEffect } from 'react';
import { X, VideoCamera, CircleNotch } from '@phosphor-icons/react';
import { teacherService } from '@/services/teacherService';
import { teacherLiveClassService, type LiveClassDetail, type UpdateScheduledClassInput } from '@/services/teacherLiveClassService';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface EditScheduledClassDialogProps {
  isOpen: boolean;
  onClose: () => void;
  teacherId: string;
  classId: string;
  /** Callback after successful update — parent can refresh its list. */
  onUpdated?: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function EditScheduledClassDialog({ isOpen, onClose, teacherId, classId, onUpdated }: EditScheduledClassDialogProps) {
  const [loading, setLoading] = useState(true);
  const [original, setOriginal] = useState<LiveClassDetail | null>(null);

  // Form fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [durationMin, setDurationMin] = useState(60);
  const [isRecorded, setIsRecorded] = useState(true);

  const [batches, setBatches] = useState<{ id: string; name: string }[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // ── Fetch data on mount ───────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen || !classId || !teacherId) return;
    setError(null);
    setSuccess(false);
    setLoading(true);

    Promise.all([
      teacherLiveClassService.getTeacherClassById(classId),
      teacherService.getAssignedBatches(teacherId),
    ]).then(([classDetail, batchList]) => {
      if (!classDetail) {
        setError('Class not found. It may have been deleted.');
        setLoading(false);
        return;
      }

      setOriginal(classDetail);
      setBatches(batchList.map((b: any) => ({ id: b.id, name: b.name })));

      // Pre-fill form
      setTitle(classDetail.title);
      setDescription(classDetail.description || '');
      setSelectedBatchId(classDetail.batchId || classDetail.batches[0]?.batchId || '');
      setDurationMin(classDetail.durationMin);
      setIsRecorded(classDetail.isRecorded);

      // Extract date & time from scheduledAt
      const d = new Date(classDetail.scheduledAt);
      setDate(d.toISOString().split('T')[0]);
      setTime(d.toTimeString().slice(0, 5));
    }).catch((err: any) => {
      setError(err?.message || 'Failed to load class details.');
    }).finally(() => {
      setLoading(false);
    });
  }, [isOpen, classId, teacherId]);

  // ── Submit ─────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedTitle = title.trim();
    if (trimmedTitle.length < 3) {
      setError('Title must be at least 3 characters.');
      return;
    }
    if (!date || !time) {
      setError('Please select a date and time.');
      return;
    }
    if (durationMin < 5 || durationMin > 480) {
      setError('Duration must be between 5 and 480 minutes.');
      return;
    }

    // Convert user's local time to UTC before storing
    const localDate = new Date(`${date}T${time}:00`);
    const scheduledAt = localDate.toISOString();

    if (!original) {
      setError('Could not load original class data. Please close and try again.');
      return;
    }

    const updates: UpdateScheduledClassInput = {};
    if (trimmedTitle !== original.title) updates.title = trimmedTitle;
    if (description.trim() !== (original.description || '')) updates.description = description.trim() || undefined;
    if (selectedBatchId !== original.batchId) updates.batchIds = [selectedBatchId];
    if (durationMin !== original.durationMin) updates.durationMin = durationMin;
    if (isRecorded !== original.isRecorded) updates.isRecorded = isRecorded;

    // Always include scheduledAt if date/time changed
    const origDate = new Date(original.scheduledAt);
    const newDate = new Date(scheduledAt);
    if (newDate.getTime() !== origDate.getTime()) {
      updates.scheduledAt = scheduledAt;
    }

    // Validate future time if scheduledAt changed
    if (updates.scheduledAt && newDate <= new Date()) {
      setError('Scheduled time must be in the future.');
      return;
    }

    if (Object.keys(updates).length === 0) {
      onClose();
      return;
    }

    setSubmitting(true);
    try {
      await teacherLiveClassService.updateScheduledClass(classId, teacherId, updates);
      setSuccess(true);
      onUpdated?.();
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: any) {
      setError(err?.message || 'Failed to update class.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="w-full max-w-xl rounded-3xl border border-gray-200 bg-white shadow-2xl overflow-hidden animate-slideUp">
        {/* Header */}
        <div className="flex items-center justify-between bg-gradient-to-r from-amber-600 to-orange-600 px-6 py-4 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20">
              <VideoCamera size={22} weight="fill" />
            </div>
            <div>
              <h3 className="text-lg font-bold">Edit Scheduled Class</h3>
              <p className="text-xs text-amber-200">Update your class details</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <CircleNotch size={32} className="animate-spin text-blue-600" />
          </div>
        ) : error && !original ? (
          <div className="p-6 text-center">
            <p className="text-sm font-medium text-red-700">{error}</p>
            <button onClick={onClose} className="mt-4 rounded-xl bg-gray-100 px-4 py-2 text-sm font-semibold">
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5 p-6 max-h-[70vh] overflow-y-auto">
            {/* Title */}
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500">
                Class Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-amber-400 focus:bg-white focus:ring-2 focus:ring-amber-100"
                required
                maxLength={200}
              />
            </div>

            {/* Description */}
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500">
                Description <span className="text-gray-400">(optional)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-amber-400 focus:bg-white focus:ring-2 focus:ring-amber-100"
                maxLength={1000}
              />
            </div>

            {/* Batch select */}
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500">
                Batch <span className="text-red-500">*</span>
              </label>
              <select
                value={selectedBatchId}
                onChange={(e) => setSelectedBatchId(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-amber-400 focus:bg-white focus:ring-2 focus:ring-amber-100"
              >
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>

            {/* Date, Time, Duration */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500">
                  Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-amber-400 focus:bg-white focus:ring-2 focus:ring-amber-100"
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500">
                  Time <span className="text-red-500">*</span>
                </label>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-amber-400 focus:bg-white focus:ring-2 focus:ring-amber-100"
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500">
                  Duration (min) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  value={durationMin}
                  onChange={(e) => setDurationMin(Number(e.target.value))}
                  min={5}
                  max={480}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-amber-400 focus:bg-white focus:ring-2 focus:ring-amber-100"
                />
              </div>
            </div>

            {/* Recording toggle */}
            <div className="flex items-center gap-3 rounded-xl bg-gray-50 px-4 py-3">
              <button
                type="button"
                onClick={() => setIsRecorded(!isRecorded)}
                className={`relative h-6 w-11 rounded-full transition-colors ${
                  isRecorded ? 'bg-amber-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    isRecorded ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
              <div>
                <p className="text-sm font-semibold text-gray-900">Enable Recording</p>
                <p className="text-xs text-gray-500">Students can watch the replay later</p>
              </div>
            </div>

            {/* Error / Success */}
            {error && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm font-medium text-red-700">
                {error}
              </div>
            )}
            {success && (
              <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm font-medium text-green-700">
                Class updated successfully!
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-5">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg transition-all hover:from-amber-700 hover:to-orange-700 disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <CircleNotch size={18} className="animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
