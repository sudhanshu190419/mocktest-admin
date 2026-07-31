'use client';

import { X, CircleNotch, ShieldCheck, UserCircle, Cube, ArrowsLeftRight } from '@phosphor-icons/react';
import type { AuditLogEntry } from '@/services/admin/auditLogService';
import { AuditActionBadge } from './AuditActionBadge';
import { AuditJsonBlock } from './AuditJsonBlock';

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatId(id: string | null | undefined): string {
  if (!id) return '—';
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
}

/**
 * Best-effort entity display name. Many audit payloads carry the entity
 * name under metadata (entityName / name / title). Falls back to null.
 */
function resolveEntityName(entry: AuditLogEntry): string | null {
  const meta = entry.metadata;
  if (!meta || typeof meta !== 'object') return null;
  const candidate = (meta as Record<string, unknown>).entityName
    ?? (meta as Record<string, unknown>).name
    ?? (meta as Record<string, unknown>).title;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

/** A labelled row inside a detail section. */
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="flex-shrink-0 text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {label}
      </span>
      <span className="min-w-0 break-all text-right text-xs text-gray-700 dark:text-gray-300">
        {children}
      </span>
    </div>
  );
}

interface AuditDetailDrawerProps {
  /** The loaded entry. May be null while a fetch resolves. */
  entry?: AuditLogEntry | null;
  isLoading?: boolean;
  onClose: () => void;
}

/**
 * Read-only detail drawer for a single audit log entry.
 *
 * Renders General (action/resource/timestamp/outcome/reason), Actor
 * (name/role/email), Entity (type/id), Changes (before/after JSON
 * snapshots) and Metadata (pretty-printed JSON).
 *
 * Full dark-mode support, matches the existing admin design system.
 */
export function AuditDetailDrawer({ entry, isLoading, onClose }: AuditDetailDrawerProps) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 flex h-full w-full max-w-lg flex-col overflow-hidden border-l border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Audit Detail
            </h2>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Immutable event record
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            aria-label="Close detail"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {isLoading || !entry ? (
            <div className="flex flex-col items-center gap-3 py-20">
              <CircleNotch size={26} className="animate-spin text-amber-500" />
              <p className="text-xs text-gray-400">Loading event…</p>
            </div>
          ) : (
            <>
              {/* ── General ────────────────────────────────────────────── */}
              <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <ShieldCheck size={14} /> General
                </h3>
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  <DetailRow label="Action">
                    <AuditActionBadge action={entry.action} />
                  </DetailRow>
                  <DetailRow label="Resource">{entry.resourceType}</DetailRow>
                  <DetailRow label="Timestamp">
                    {formatDateTime(entry.performedAt)}
                  </DetailRow>
                  <DetailRow label="Outcome">
                    <span
                      className={
                        entry.outcome === 'failure'
                          ? 'font-medium text-red-600 dark:text-red-400'
                          : 'font-medium text-emerald-600 dark:text-emerald-400'
                      }
                    >
                      {entry.outcome === 'failure' ? 'Failure' : 'Success'}
                    </span>
                  </DetailRow>
                  {entry.reason && <DetailRow label="Reason">{entry.reason}</DetailRow>}
                  {entry.sessionId && (
                    <DetailRow label="Session">{formatId(entry.sessionId)}</DetailRow>
                  )}
                </div>
              </section>

              {/* ── Actor ──────────────────────────────────────────────── */}
              <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <UserCircle size={14} /> Actor
                </h3>
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  <DetailRow label="Name">{entry.actorName ?? 'System'}</DetailRow>
                  <DetailRow label="Role">
                    {entry.actorRoleDisplay ?? 'System'}
                  </DetailRow>
                  {entry.actorEmail && <DetailRow label="Email">{entry.actorEmail}</DetailRow>}
                  {entry.ipAddress && <DetailRow label="IP">{entry.ipAddress}</DetailRow>}
                  {entry.userAgent && (
                    <DetailRow label="User Agent">{entry.userAgent}</DetailRow>
                  )}
                </div>
              </section>

              {/* ── Entity ─────────────────────────────────────────────── */}
              <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <Cube size={14} /> Entity
                </h3>
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  <DetailRow label="Type">{entry.resourceType}</DetailRow>
                  <DetailRow label="ID">
                    <span className="font-mono">{formatId(entry.resourceId)}</span>
                  </DetailRow>
                  {(() => {
                    const entityName = resolveEntityName(entry);
                    return entityName ? (
                      <DetailRow label="Name">{entityName}</DetailRow>
                    ) : null;
                  })()}
                  {entry.instituteName && (
                    <DetailRow label="Institute">{entry.instituteName}</DetailRow>
                  )}
                </div>
              </section>

              {/* ── Changes (before / after) ───────────────────────────── */}
              <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <ArrowsLeftRight size={14} /> Changes
                </h3>
                <div className="space-y-3">
                  <div>
                    <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                      Before (old_value)
                    </p>
                    <AuditJsonBlock value={entry.oldValue} />
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                      After (new_value)
                    </p>
                    <AuditJsonBlock value={entry.newValue} />
                  </div>
                </div>
              </section>

              {/* ── Metadata ───────────────────────────────────────────── */}
              <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Metadata
                </h3>
                <AuditJsonBlock value={entry.metadata} />
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default AuditDetailDrawer;
