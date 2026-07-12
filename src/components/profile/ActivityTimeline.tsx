'use client';

import { cn } from '@/lib/utils';
import type { ActivityEvent, ActivityEventType } from '@/types/profile';

interface ActivityTimelineProps {
  events: ActivityEvent[];
  className?: string;
  loading?: boolean;
}

const EVENT_ICONS: Record<ActivityEventType, { icon: string; bg: string }> = {
  login: { icon: '🔑', bg: 'bg-blue-100 dark:bg-blue-900/20' },
  password_change: { icon: '🔒', bg: 'bg-amber-100 dark:bg-amber-900/20' },
  profile_update: { icon: '✏️', bg: 'bg-purple-100 dark:bg-purple-900/20' },
  mock_test_created: { icon: '📝', bg: 'bg-emerald-100 dark:bg-emerald-900/20' },
  question_added: { icon: '❓', bg: 'bg-cyan-100 dark:bg-cyan-900/20' },
  notification_sent: { icon: '🔔', bg: 'bg-indigo-100 dark:bg-indigo-900/20' },
  result_released: { icon: '📊', bg: 'bg-rose-100 dark:bg-rose-900/20' },
  account_update: { icon: '⚙️', bg: 'bg-gray-100 dark:bg-gray-800' },
  batch_assigned: { icon: '👥', bg: 'bg-teal-100 dark:bg-teal-900/20' },
  other: { icon: '📌', bg: 'bg-gray-100 dark:bg-gray-800' },
};

function formatTimestamp(ts: string): string {
  const date = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function getTimeGroupLabel(ts: string): string {
  const date = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return 'This Week';
  if (diffDays < 30) return 'This Month';
  if (date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()) return 'This Month';
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function ActivityTimeline({
  events,
  className,
  loading = false,
}: ActivityTimelineProps) {
  if (loading) {
    return (
      <div className={cn('space-y-4', className)}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <div className="h-8 w-8 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-3 w-48 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className={cn('py-12 text-center', className)}>
        <p className="text-sm text-gray-500">No activity recorded yet.</p>
      </div>
    );
  }

  // Group events by time period
  const groups = new Map<string, ActivityEvent[]>();
  for (const event of events) {
    const label = getTimeGroupLabel(event.timestamp);
    const existing = groups.get(label) ?? [];
    existing.push(event);
    groups.set(label, existing);
  }

  return (
    <div className={cn('space-y-6', className)}>
      {Array.from(groups.entries()).map(([label, groupEvents]) => (
        <div key={label}>
          <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {label}
          </h4>
          <div className="relative space-y-0">
            {/* Vertical line */}
            <div className="absolute bottom-0 left-[15px] top-0 w-px bg-gray-200 dark:bg-gray-700" />

            {groupEvents.map((event, idx) => {
              const config = EVENT_ICONS[event.type] ?? EVENT_ICONS.other;
              return (
                <div key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
                  {/* Icon */}
                  <div
                    className={cn(
                      'relative z-10 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs',
                      config.bg,
                    )}
                    aria-hidden="true"
                  >
                    {config.icon}
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {event.title}
                      </p>
                      <time
                        className="flex-shrink-0 text-[10px] text-gray-400"
                        dateTime={event.timestamp}
                      >
                        {formatTimestamp(event.timestamp)}
                      </time>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {event.description}
                    </p>
                    {event.metadata && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {Object.entries(event.metadata).map(([key, val]) => (
                          <span
                            key={key}
                            className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-mono text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                          >
                            {key}: {String(val).slice(0, 20)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
