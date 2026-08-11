/**
 * Shared leave-display helpers (Phase 2D dedup)
 *
 * Pure formatters + label maps shared by the teacher and admin leave
 * surfaces. No React, no Supabase — unit-testable.
 *
 * @module utils/leaveFormat
 */

/** isodow label map indexed by dayOfWeek (index 0 unused; 1 = Monday). */
export const SLOT_DAY_LABELS = [
  '',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

/** `teacher_leave_requests.leave_category` → display label. */
export const CATEGORY_LABELS: Record<string, string> = {
  casual: 'Casual',
  sick: 'Sick',
  unpaid: 'Unpaid',
  maternity_paternity: 'Maternity / Paternity',
  compensatory: 'Compensatory',
};

/** "2026-08-10" → "10 Aug 2026". */
export function formatDateOnly(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** "10:00:00" → "10:00 AM". */
export function formatSlotTime(time: string | null | undefined): string {
  if (!time) return '—';
  const [h, m] = time.split(':').map(Number);
  const date = new Date();
  date.setHours(h ?? 0, m ?? 0, 0, 0);
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

/** Relative time ("Just now", "3h ago", "Yesterday", "2w ago"). */
export function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}
