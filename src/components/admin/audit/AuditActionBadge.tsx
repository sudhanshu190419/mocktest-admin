'use client';

import { cn } from '@/lib/utils';

/**
 * Colour mapping for known audit actions. Unknown/future actions fall back
 * to a neutral grey — so new event types render automatically without
 * requiring a code change to this component.
 */
const ACTION_STYLES: Record<string, string> = {
  create: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  update: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  delete: 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  soft_delete: 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  restore: 'bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  publish: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  unpublish: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  approve: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  reject: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  login: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  logout: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  failed_login: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  enroll: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  unenroll: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  purchase: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  refund: 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  export: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  import: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  view_sensitive: 'bg-fuchsia-50 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-300',
  suspend: 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  reactivate: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  revoke: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  grant: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  assign: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  unassign: 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  transfer: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  submit: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  archive: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  reset_password: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  device_approve: 'bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  device_revoke: 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
};

const FALLBACK_STYLE =
  'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';

/** Formats an action key into a readable label ("soft_delete" → "Soft Delete"). */
export function formatActionLabel(action: string): string {
  return action
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface AuditActionBadgeProps {
  action: string;
  className?: string;
}

/**
 * Badge chip for an audit action. Colour-coded for known actions; unknown
 * (future) actions render in a neutral grey so new events appear
 * automatically without component changes.
 */
export function AuditActionBadge({ action, className }: AuditActionBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium leading-5',
        ACTION_STYLES[action] ?? FALLBACK_STYLE,
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {formatActionLabel(action)}
    </span>
  );
}

export default AuditActionBadge;
