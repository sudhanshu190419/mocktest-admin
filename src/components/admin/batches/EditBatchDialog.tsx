'use client';

import React, { useState, useEffect } from 'react';
import { X, CircleNotch, PencilSimple } from '@phosphor-icons/react';
import { useUpdateBatch } from '@/hooks/admin/useBatchManagement';
import type { UpdateBatchInput, BatchStatus } from '@/services/admin/batchManagementService';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface EditBatchDialogProps {
  isOpen: boolean;
  onClose: () => void;
  batch: {
    batchId: string;
    batchName: string;
    batchCode: string;
    academicYear?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    capacity?: number | null;
    status: BatchStatus;
    streamName?: string | null;
  } | null;
  onSuccess?: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function EditBatchDialog({ isOpen, onClose, batch, onSuccess }: EditBatchDialogProps) {
  // ── Form fields ────────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [batchCode, setBatchCode] = useState('');
  const [academicYear, setAcademicYear] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [maxSeats, setMaxSeats] = useState<number | ''>('');
  const [status, setStatus] = useState<BatchStatus>('upcoming');

  // Populate form fields when batch data changes
  useEffect(() => {
    if (batch) {
      setName(batch.batchName || '');
      setBatchCode(batch.batchCode || '');
      setAcademicYear(batch.academicYear || '');
      setStartDate(batch.startDate ? batch.startDate.slice(0, 10) : '');
      setEndDate(batch.endDate ? batch.endDate.slice(0, 10) : '');
      setMaxSeats(batch.capacity ?? '');
      setStatus(batch.status || 'upcoming');
    }
  }, [batch]);

  // ── Mutation ───────────────────────────────────────────────────────────
  const updateMutation = useUpdateBatch();

  // ── Handlers ───────────────────────────────────────────────────────────
  function handleBatchCodeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    setBatchCode(raw);
  }

  // ── Submit ─────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!batch?.batchId) {
      return;
    }

    const trimmedName = name.trim();
    const trimmedCode = batchCode.trim().toUpperCase();
    const trimmedYear = academicYear.trim();

    if (trimmedName.length < 3) {
      return;
    }
    if (trimmedCode.length < 2) {
      return;
    }

    const input: UpdateBatchInput = {
      name: trimmedName,
      batchCode: trimmedCode,
      academicYear: trimmedYear || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      maxSeats: maxSeats === '' ? null : Number(maxSeats),
      status,
    };

    try {
      await updateMutation.mutateAsync({ batchId: batch.batchId, input });
      onSuccess?.();
      onClose();
    } catch {
      // Error handled and rendered via updateMutation.isError / updateMutation.error
    }
  }

  if (!isOpen || !batch) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white shadow-xl overflow-hidden dark:border-gray-700 dark:bg-gray-900">
        {/* Header */}
        <div className="flex items-center justify-between bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20">
              <PencilSimple size={22} weight="bold" />
            </div>
            <div>
              <h3 className="text-lg font-bold">Edit Batch</h3>
              <p className="text-xs text-blue-200">
                {batch.streamName ? `${batch.streamName} · ` : ''}Update batch details
              </p>
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
          {/* Name & Code row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Batch Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. JEE Target Alpha"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                required
                minLength={3}
                maxLength={200}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Batch Code <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={batchCode}
                onChange={handleBatchCodeChange}
                placeholder="e.g. JEE26-MOR-A"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 uppercase dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                required
                minLength={2}
                maxLength={20}
              />
            </div>
          </div>

          {/* Academic Year & Status row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Academic Year
              </label>
              <input
                type="text"
                value={academicYear}
                onChange={(e) => setAcademicYear(e.target.value)}
                placeholder="e.g. 2025-26"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                maxLength={10}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Status <span className="text-red-500">*</span>
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as BatchStatus)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="upcoming">Upcoming</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>

          {/* Start & End Date row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
          </div>

          {/* Max Seats */}
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Max Seats <span className="text-gray-400">(optional)</span>
            </label>
            <input
              type="number"
              value={maxSeats}
              onChange={(e) => setMaxSeats(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="Unlimited"
              min={1}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>

          {/* Error Banner */}
          {updateMutation.isError && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              {updateMutation.error instanceof Error
                ? updateMutation.error.message
                : 'Failed to update batch.'}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-5 dark:border-gray-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg transition-all hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50"
            >
              {updateMutation.isPending ? (
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
      </div>
    </div>
  );
}
