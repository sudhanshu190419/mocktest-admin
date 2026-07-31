'use client';

import React, { useState, useEffect } from 'react';
import { X, VideoCamera, CircleNotch, CheckSquare, Square, BookOpen } from '@phosphor-icons/react';
import { supabase } from '@/config/supabase';
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [durationMin, setDurationMin] = useState(60);
  const [isRecorded, setIsRecorded] = useState(true);

  const [batchSubjects, setBatchSubjects] = useState<{ batchSubjectId: string; batchName: string; subjectName: string; label: string }[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // ── Fetch data on mount ───────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen || !classId || !teacherId) return;
    setError(null);
    setSuccess(false);
    setLoading(true);

    (async () => {
      try {
        // Fetch class detail and teacher's batch subjects in parallel
        const [classDetail] = await Promise.all([
          teacherLiveClassService.getTeacherClassById(classId),
        ]);

        if (!classDetail) {
          setError('Class not found. It may have been deleted.');
          setLoading(false);
          return;
        }

        setOriginal(classDetail);

        // Fetch teacher's assigned batch subjects
        const { data: myTeacherId } = await supabase.rpc('get_my_teacher_id');
        if (myTeacherId) {
          const { data: assignments } = await supabase
            .from('batch_subject_teachers')
            .select(`
              batch_subject_id,
              batch_subjects!inner (
                batch_subject_id,
                is_active,
                batches!inner (name),
                subjects!inner (name)
              )
            `)
            .eq('teacher_id', myTeacherId);

          if (assignments) {
            const options = (assignments as any[])
              .filter((row: any) => row.batch_subjects?.is_active !== false)
              .map((row: any) => {
                const bs = row.batch_subjects;
                const batchName = bs?.batches?.name ?? 'Unknown Batch';
                const subjectName = bs?.subjects?.name ?? 'Unknown Subject';
                return {
                  batchSubjectId: row.batch_subject_id,
                  batchName,
                  subjectName,
                  label: `${batchName} → ${subjectName}`,
                };
              });
            setBatchSubjects(options);
          }
        }

        // Pre-fill form with existing class data
        setTitle(classDetail.title);
        setDescription(classDetail.description || '');

        // Pre-select the batch subjects this class is already assigned to
        const existingIds = new Set(
          classDetail.assignedBatchSubjects.map((bs) => bs.batchSubjectId)
        );
        setSelectedIds(existingIds);

        setDurationMin(classDetail.durationMin);
        setIsRecorded(classDetail.isRecorded);

        // Extract date & time from scheduledAt
        const d = new Date(classDetail.scheduledAt);
        setDate(d.toISOString().split('T')[0]);
        setTime(d.toTimeString().slice(0, 5));
      } catch (err: any) {
        setError(err?.message || 'Failed to load class details.');
      } finally {
        setLoading(false);
      }
    })();
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
    if (selectedIds.size === 0) {
      setError('Please select at least one batch subject.');
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

    // Detect batch subject changes
    const originalIds = new Set(original.assignedBatchSubjects.map((bs) => bs.batchSubjectId));
    const newIds = Array.from(selectedIds);
    const idsChanged =
      originalIds.size !== selectedIds.size ||
      newIds.some((id) => !originalIds.has(id));
    if (idsChanged) {
      updates.batchSubjectIds = newIds;
    }

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

            {/* Batch Subject multi-select */}
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500">
                Batch Subjects <span className="text-red-500">*</span>
                {selectedIds.size > 0 && (
                  <span className="ml-1.5 font-normal text-blue-500">
                    ({selectedIds.size} selected)
                  </span>
                )}
              </label>

              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search batch subjects..."
                className="mb-2 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-amber-400 focus:bg-white focus:ring-2 focus:ring-amber-100"
              />

              <div className="max-h-48 overflow-y-auto rounded-xl border border-gray-200 bg-gray-50 divide-y divide-gray-100">
                {batchSubjects.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <BookOpen size={24} className="text-gray-300 mb-2" />
                    <p className="text-sm text-gray-400">
                      No subjects assigned. Contact admin.
                    </p>
                  </div>
                )}
                {batchSubjects
                  .filter((bs) => !searchQuery.trim() || bs.label.toLowerCase().includes(searchQuery.toLowerCase()))
                  .map((bs) => {
                    const isSelected = selectedIds.has(bs.batchSubjectId);
                    return (
                      <button
                        key={bs.batchSubjectId}
                        type="button"
                        onClick={() => {
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(bs.batchSubjectId)) {
                              next.delete(bs.batchSubjectId);
                            } else {
                              next.add(bs.batchSubjectId);
                            }
                            return next;
                          });
                        }}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                          isSelected
                            ? 'bg-amber-50 text-amber-800'
                            : 'text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        <span className="shrink-0">
                          {isSelected ? (
                            <CheckSquare size={18} weight="fill" className="text-amber-600" />
                          ) : (
                            <Square size={18} className="text-gray-400" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <span className="font-medium">{bs.batchName}</span>
                          <span className="mx-1 text-gray-400">→</span>
                          <span className="text-gray-500">{bs.subjectName}</span>
                        </div>
                      </button>
                    );
                  })}
              </div>
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
