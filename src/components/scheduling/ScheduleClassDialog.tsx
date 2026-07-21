'use client';

import React, { useState, useEffect } from 'react';
import { X, CalendarBlank, Clock, VideoCamera, CircleNotch } from '@phosphor-icons/react';
import { teacherService } from '@/services/teacherService';
import { teacherLiveClassService, type ScheduleLiveClassInput } from '@/services/teacherLiveClassService';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface ScheduleClassDialogProps {
  isOpen: boolean;
  onClose: () => void;
  teacherId: string;
  /** Callback after successful scheduling — parent can refresh its list. */
  onScheduled?: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ScheduleClassDialog({ isOpen, onClose, teacherId, onScheduled }: ScheduleClassDialogProps) {
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

  // ── Fetch batches on mount ────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen || !teacherId) return;
    setError(null);
    setSuccess(false);

    teacherService.getAssignedBatches(teacherId).then((batchList) => {
      setBatches(batchList.map((b: any) => ({ id: b.id, name: b.name })));
      if (batchList.length > 0) setSelectedBatchId(batchList[0].id);
    }).catch(() => { /* handled */ });
  }, [isOpen, teacherId]);

  // ── Reset form on close ────────────────────────────────────────────────

  function resetForm() {
    setTitle('');
    setDescription('');
    setSelectedBatchId(batches[0]?.id ?? '');
    setDate('');
    setTime('');
    setDurationMin(60);
    setIsRecorded(true);
    setError(null);
    setSuccess(false);
  }

  // ── Submit ─────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedTitle = title.trim();
    if (trimmedTitle.length < 3) {
      setError('Title must be at least 3 characters.');
      return;
    }
    if (!selectedBatchId) {
      setError('Please select a batch.');
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
    // Without this, the local time (e.g. IST) would be falsely labelled as UTC,
    // causing a timezone offset error when the UI later converts UTC back to local.
    const localDate = new Date(`${date}T${time}:00`);
    const scheduledAt = localDate.toISOString();
    const scheduledDate = new Date(scheduledAt);
    if (scheduledDate <= new Date()) {
      setError('Scheduled time must be in the future.');
      return;
    }

    const input: ScheduleLiveClassInput = {
      teacherId,
      title: trimmedTitle,
      batchIds: [selectedBatchId],
      scheduledAt,
      durationMin,
      description: description.trim() || undefined,
      isRecorded,
    };

    setSubmitting(true);
    try {
      await teacherLiveClassService.scheduleLiveClass(input);
      setSuccess(true);
      onScheduled?.();
      setTimeout(() => {
        resetForm();
        onClose();
      }, 1500);
    } catch (err: any) {
      setError(err?.message || 'Failed to schedule class. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="w-full max-w-xl rounded-3xl border border-gray-200 bg-white shadow-2xl overflow-hidden animate-slideUp">
        {/* Header */}
        <div className="flex items-center justify-between bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20">
              <VideoCamera size={22} weight="fill" />
            </div>
            <div>
              <h3 className="text-lg font-bold">Schedule Live Class</h3>
              <p className="text-xs text-blue-200">Create a future-dated class for your batch</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
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
              placeholder="e.g. Rotational Dynamics Deep Dive"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
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
              placeholder="What will this session cover?"
              rows={3}
              className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
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
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
            >
              {batches.length === 0 && <option value="">No batches assigned</option>}
              {batches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          {/* Date, Time, Duration row */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500">
                Date <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <CalendarBlank size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 pl-9 pr-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
                  required
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500">
                Time <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Clock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 pl-9 pr-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
                  required
                />
              </div>
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
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>

          {/* Recording toggle */}
          <div className="flex items-center gap-3 rounded-xl bg-gray-50 px-4 py-3">
            <button
              type="button"
              onClick={() => setIsRecorded(!isRecorded)}
              className={`relative h-6 w-11 rounded-full transition-colors ${
                isRecorded ? 'bg-blue-600' : 'bg-gray-300'
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
            <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm font-medium text-green-700 flex items-center gap-2">
              <CircleNotch size={16} className="animate-spin" />
              Class scheduled successfully!
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-5">
            <button
              type="button"
              onClick={() => { resetForm(); onClose(); }}
              className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg transition-all hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <CircleNotch size={18} className="animate-spin" />
                  Scheduling...
                </>
              ) : (
                <>
                  <VideoCamera size={18} />
                  Schedule Class
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
