'use client';

import React, { useState, useEffect } from 'react';
import { X, CircleNotch, Plus, ArrowsClockwise } from '@phosphor-icons/react';
import { useAuth } from '@/context/AuthContext';
import { useStreams } from '@/hooks/academic/useStreams';
import { useCreateBatch } from '@/hooks/admin/useBatchManagement';
import type { CreateBatchInput } from '@/services/admin/batchManagementService';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Derives a clean, standard batch code suggestion from the batch name.
 * Enforces PostgreSQL regex format `^[A-Z0-9_-]+$` and maximum length 20.
 */
export function generateBatchCodeSuggestion(name: string): string {
  if (!name.trim()) return '';

  let cleaned = name
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');

  if (cleaned.length > 20) {
    cleaned = cleaned.substring(0, 20).replace(/-+$/, '');
  }

  return cleaned;
}

// ─── Props ──────────────────────────────────────────────────────────────────

export interface CreateBatchDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function CreateBatchDialog({ isOpen, onClose }: CreateBatchDialogProps) {
  const { instituteId } = useAuth();

  // ── Form fields ────────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [batchCode, setBatchCode] = useState('');
  const [isManualCode, setIsManualCode] = useState(false);
  const [academicYear, setAcademicYear] = useState('');
  const [streamId, setStreamId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [maxSeats, setMaxSeats] = useState<number | ''>('');
  const [status, setStatus] = useState<'upcoming' | 'active'>('upcoming');

  // ── Data ───────────────────────────────────────────────────────────────
  const { data: streamsData } = useStreams(undefined, undefined, { page: 1, pageSize: 100 });

  const streams = streamsData?.data ?? [];

  // Select first stream by default when data loads
  useEffect(() => {
    if (!streamId && streams.length > 0) {
      setStreamId(streams[0].streamId);
    }
  }, [streams, streamId]);

  // ── Handlers ───────────────────────────────────────────────────────────
  function handleNameChange(val: string) {
    setName(val);
    if (!isManualCode) {
      setBatchCode(generateBatchCodeSuggestion(val));
    }
  }

  function handleBatchCodeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    setBatchCode(raw);
    setIsManualCode(true);
  }

  function handleRegenerateCode() {
    setIsManualCode(false);
    setBatchCode(generateBatchCodeSuggestion(name));
  }

  // ── Mutation ───────────────────────────────────────────────────────────
  const createMutation = useCreateBatch();

  // ── Reset form ─────────────────────────────────────────────────────────
  function resetForm() {
    setName('');
    setBatchCode('');
    setIsManualCode(false);
    setAcademicYear('');
    setStreamId(streams[0]?.streamId ?? '');
    setStartDate('');
    setEndDate('');
    setMaxSeats('');
    setStatus('upcoming');
  }

  // ── Submit ─────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!instituteId) {
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
    if (!trimmedYear) {
      return;
    }
    if (!streamId) {
      return;
    }
    if (!startDate || !endDate) {
      return;
    }

    const input: CreateBatchInput = {
      instituteId,
      streamId,
      name: trimmedName,
      batchCode: trimmedCode,
      academicYear: trimmedYear,
      startDate,
      endDate,
      maxSeats: maxSeats === '' ? null : Number(maxSeats),
      status,
    };

    try {
      await createMutation.mutateAsync(input);
      resetForm();
      onClose();
    } catch {
      // Error is handled by the mutation
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20">
              <Plus size={22} weight="bold" />
            </div>
            <div>
              <h3 className="text-lg font-bold">Create New Batch</h3>
              <p className="text-xs text-blue-200">Add a new batch to your institute</p>
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
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500">
                Batch Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g. JEE Target Alpha"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
                required
                minLength={3}
                maxLength={200}
              />
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-500">
                  Batch Code <span className="text-red-500">*</span>
                </label>
                {isManualCode && name.trim() && (
                  <button
                    type="button"
                    onClick={handleRegenerateCode}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700 transition-colors"
                    title="Reset to auto-generated code"
                  >
                    <ArrowsClockwise size={12} weight="bold" />
                    Auto
                  </button>
                )}
              </div>
              <input
                type="text"
                value={batchCode}
                onChange={handleBatchCodeChange}
                placeholder="e.g. JEE26-MOR-A"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 uppercase"
                required
                minLength={2}
                maxLength={20}
              />
            </div>
          </div>

          {/* Academic Year & Stream row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500">
                Academic Year <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={academicYear}
                onChange={(e) => setAcademicYear(e.target.value)}
                placeholder="e.g. 2025-26"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
                required
                maxLength={9}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500">
                Stream <span className="text-red-500">*</span>
              </label>
              <select
                value={streamId}
                onChange={(e) => setStreamId(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
                required
              >
                <option value="">— Select stream —</option>
                {streams.map((s: any) => (
                  <option key={s.streamId} value={s.streamId}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Start & End Date row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500">
                Start Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
                required
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500">
                End Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
                required
              />
            </div>
          </div>

          {/* Max Seats & Status row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500">
                Max Seats <span className="text-gray-400">(optional)</span>
              </label>
              <input
                type="number"
                value={maxSeats}
                onChange={(e) => setMaxSeats(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="Unlimited"
                min={1}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500">
                Status <span className="text-red-500">*</span>
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'upcoming' | 'active')}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
              >
                <option value="upcoming">Upcoming</option>
                <option value="active">Active</option>
              </select>
            </div>
          </div>

          {/* Error / Success */}
          {createMutation.isError && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm font-medium text-red-700">
              {createMutation.error instanceof Error
                ? createMutation.error.message
                : 'Failed to create batch.'}
            </div>
          )}
          {createMutation.isSuccess && (
            <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm font-medium text-green-700">
              Batch created successfully!
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
              disabled={createMutation.isPending || !instituteId}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg transition-all hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50"
            >
              {createMutation.isPending ? (
                <>
                  <CircleNotch size={18} className="animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus size={18} weight="bold" />
                  Create Batch
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
