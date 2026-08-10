'use client';

import React from 'react';
import {
  BookOpen,
  Clock,
  Users,
  PlayCircle,
  PencilSimple,
  XCircle,
  VideoCamera,
  CalendarBlank,
} from '@phosphor-icons/react';
import type { LiveClassListItem } from '@/services/teacherLiveClassService';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Re-export the service type for convenience. */
export type { LiveClassListItem };

/** Determines which statuses can be cancelled. */
const CANCELLABLE_STATUSES = ['scheduled'];
const EDITABLE_STATUSES = ['scheduled'];

export type ClassAction =
  | { type: 'start'; classId: string }
  | { type: 'rejoin'; classId: string }
  | { type: 'edit'; classId: string }
  | { type: 'cancel'; classId: string }
  | { type: 'view'; classId: string };

export interface ClassCardProps {
  item: LiveClassListItem;
  onAction: (action: ClassAction) => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const time = d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  return { date, time };
}

function getStatusConfig(status: LiveClassListItem['status']) {
  switch (status) {
    case 'live':
      return {
        label: 'LIVE',
        dot: 'bg-green-500 animate-pulse',
        bg: 'bg-green-50',
        text: 'text-green-700',
        border: 'border-green-200',
        icon: VideoCamera,
      };
    case 'scheduled':
      return {
        label: 'Scheduled',
        dot: 'bg-blue-500',
        bg: 'bg-blue-50',
        text: 'text-blue-700',
        border: 'border-blue-200',
        icon: CalendarBlank,
      };
    case 'completed':
      return {
        label: 'Completed',
        dot: 'bg-gray-400',
        bg: 'bg-gray-50',
        text: 'text-gray-600',
        border: 'border-gray-200',
        icon: Clock,
      };
    case 'cancelled':
      return {
        label: 'Cancelled',
        dot: 'bg-red-400',
        bg: 'bg-red-50',
        text: 'text-red-600',
        border: 'border-red-200',
        icon: XCircle,
      };
    default:
      return {
        label: status,
        dot: 'bg-gray-400',
        bg: 'bg-gray-50',
        text: 'text-gray-600',
        border: 'border-gray-200',
        icon: Clock,
      };
  }
}

/**
 * Start-window state mirroring the server rule in
 * `start_scheduled_live_class()` (UX only — the RPC remains authoritative):
 *   not-open  → before scheduled_at - 10 min
 *   open      → scheduled_at - 10 min … scheduled_at + duration + 15 min
 *   expired   → after the late limit
 */
function getStartWindowState(scheduledAt: string, durationMin: number): 'open' | 'not-open' | 'expired' {
  const start = new Date(scheduledAt).getTime();
  if (Number.isNaN(start)) return 'open';
  const EARLY_WINDOW_MS = 10 * 60 * 1000; // 10 min before scheduled_at
  const LATE_GRACE_MS = 15 * 60 * 1000;   // 15 min after duration
  const now = Date.now();
  if (now < start - EARLY_WINDOW_MS) return 'not-open';
  if (now > start + durationMin * 60_000 + LATE_GRACE_MS) return 'expired';
  return 'open';
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ClassCard({ item, onAction }: ClassCardProps) {
  const cfg = getStatusConfig(item.status);
  const { date, time } = formatDateTime(item.scheduledAt);
  // Mirrors the server start window (UX only — the RPC stays authoritative).
  const startWindow = getStartWindowState(item.scheduledAt, item.durationMin);
  const canStart = item.status === 'scheduled' && startWindow === 'open';
  const startNotOpen = item.status === 'scheduled' && startWindow === 'not-open';
  const startExpired = item.status === 'scheduled' && startWindow === 'expired';
  const canEdit = EDITABLE_STATUSES.includes(item.status);
  const canCancel = CANCELLABLE_STATUSES.includes(item.status);

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-gray-300">
      {/* Top row: status badge */}
      <div className="mb-3 flex items-center justify-between">
        <div className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${cfg.bg} ${cfg.text} ${cfg.border} border`}>
          <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
          {cfg.label}
        </div>

        {/* Time info */}
        <div className="flex items-center gap-1 text-xs text-gray-400">
          <Clock size={14} />
          <span>{item.durationMin} min</span>
        </div>
      </div>

      {/* Title */}
      <h4 className="text-base font-bold text-gray-900 leading-snug mb-1">
        {item.title}
      </h4>

      {/* Metadata row - show batch subjects */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 mb-4">
        {item.assignedBatchSubjects && item.assignedBatchSubjects.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            <Users size={14} className="text-gray-400 shrink-0 mt-0.5" />
            {item.assignedBatchSubjects.map((bs, idx) => (
              <span key={bs.batchSubjectId} className="inline-flex items-center gap-1">
                {idx > 0 && <span className="text-gray-300 mx-0.5">·</span>}
                <span className="font-medium text-gray-600">{bs.batchName}</span>
                <span className="text-gray-400">→</span>
                <span>{bs.subjectName}</span>
              </span>
            ))}
          </div>
        ) : (
          <span className="flex items-center gap-1">
            <Users size={14} className="text-gray-400" />
            {item.batchName}
          </span>
        )}
      </div>

      {/* Date/time */}
      <div className="mb-3 flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-600">
        <CalendarBlank size={16} className="text-gray-400 shrink-0" />
        <span className="font-medium">{date}</span>
        <span className="text-gray-300">·</span>
        <span className="font-mono font-medium">{time}</span>
      </div>

      {/* Planned lesson (chapter/topic from the admin lesson plan) */}
      {item.chapterName && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-indigo-100 bg-indigo-50/70 px-3 py-2 text-xs text-indigo-700 dark:border-indigo-900/40 dark:bg-indigo-950/40 dark:text-indigo-300">
          <BookOpen size={14} className="text-indigo-400 shrink-0 mt-0.5" />
          <span className="min-w-0">
            <span className="font-semibold">{item.chapterName}</span>
            {item.topicName && (
              <span className="font-medium text-indigo-500 dark:text-indigo-400"> — {item.topicName}</span>
            )}
          </span>
        </div>
      )}

      {/* Action buttons (appear on hover) */}
      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        {canStart && (
          <button
            onClick={() => onAction({ type: 'start', classId: item.classId })}
            className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-green-700"
          >
            <PlayCircle size={16} weight="fill" />
            Go Live
          </button>
        )}
        {startNotOpen && (
          <span className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
            <Clock size={14} />
            Starts at {time}
          </span>
        )}
        {startExpired && (
          <span className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-500">
            <Clock size={14} />
            Start window expired
          </span>
        )}
        {item.status === 'live' && (
          <button
            onClick={() => onAction({ type: 'rejoin', classId: item.classId })}
            className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-green-700 animate-pulse"
          >
            <VideoCamera size={16} weight="fill" />
            Rejoin Live Class
          </button>
        )}
        {canEdit && (
          <button
            onClick={() => onAction({ type: 'edit', classId: item.classId })}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50"
          >
            <PencilSimple size={14} />
            Edit
          </button>
        )}
        {canCancel && (
          <button
            onClick={() => onAction({ type: 'cancel', classId: item.classId })}
            className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50"
          >
            <XCircle size={14} />
            Cancel
          </button>
        )}
        {item.status === 'completed' && (
          <button
            onClick={() => onAction({ type: 'view', classId: item.classId })}
            className="flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-200"
          >
            View Details
          </button>
        )}
        {item.status === 'cancelled' && (
          <span className="text-xs text-gray-400 italic">Cancelled</span>
        )}
      </div>
    </div>
  );
}
