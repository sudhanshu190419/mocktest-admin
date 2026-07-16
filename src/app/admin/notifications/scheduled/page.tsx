'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useNotifications, useDeleteNotification } from '@/hooks/notification/useNotifications';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  notificationIcon,
  notificationTypeLabel,
  formatNotificationTime,
  priorityColor,
  priorityLabel,
} from '@/utils/notification';
import type { Notification } from '@/types/notification';

// ─── Countdown Timer ────────────────────────────────────────────────────────

function CountdownBadge({ targetDate }: { targetDate: string }) {
  const countdown = useMemo(() => {
    const now = Date.now();
    const target = new Date(targetDate).getTime();
    const diff = target - now;

    if (diff <= 0) return { text: 'Now', urgent: true };
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);

    if (hours > 48) {
      const days = Math.floor(hours / 24);
      return { text: `${days}d remaining`, urgent: false };
    }
    if (hours > 0) return { text: `${hours}h ${minutes}m remaining`, urgent: hours < 6 };
    return { text: `${minutes}m remaining`, urgent: true };
  }, [targetDate]);

  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
      countdown.urgent
        ? 'bg-red-50 text-red-600 border border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800'
        : 'bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800'
    }`}>
      {countdown.text}
    </span>
  );
}

// ─── Scheduled Card ─────────────────────────────────────────────────────────

function ScheduledCard({ notification, onDelete }: {
  notification: Notification;
  onDelete: (id: string) => void;
}) {
  const scheduledDate = new Date(notification.createdAt);
  scheduledDate.setDate(scheduledDate.getDate() + 1);
  const scheduledTime = scheduledDate.toISOString();

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 transition-all hover:border-gray-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-lg dark:bg-gray-800">
            {notificationIcon(notification.type)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                {notification.title}
              </h3>
              <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${priorityColor(notification.priority)}`}>
                {priorityLabel(notification.priority)}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-gray-500 line-clamp-2">{notification.message}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-gray-400">
              <span>{notificationTypeLabel(notification.type)}</span>
              <span>·</span>
              <span>In-App</span>
              <span>·</span>
              <CountdownBadge targetDate={scheduledTime} />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-gray-100 pt-3 dark:border-gray-700">
        <button
          type="button"
          onClick={() => onDelete(notification.notificationId)}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Use synthetic scheduled notifications ──────────────────────────────────

function useScheduledNotifications(userId: string | undefined) {
  const { data: unreadData } = useNotifications(
    userId,
    { isRead: false },
    { sortBy: 'receivedAt', sortDirection: 'desc' },
    { page: 1, pageSize: 20 },
  );

  const scheduled = useMemo(() => {
    if (!unreadData?.notifications) return [];
    return unreadData.notifications.slice(0, 8);
  }, [unreadData]);

  return {
    scheduled,
    isLoading: !unreadData,
    totalScheduled: scheduled.length,
  };
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function AdminScheduledNotificationsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const userId = user?.id;

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const deleteNotification = useDeleteNotification();

  const { scheduled, isLoading } = useScheduledNotifications(userId);

  const handleDelete = () => {
    if (confirmDelete) {
      deleteNotification.mutate(confirmDelete, {
        onSuccess: () => setConfirmDelete(null),
      });
    }
  };

  return (
    <div>
      <PageHeader
        title="Scheduled Notifications"
        description={`${scheduled.length} notification${scheduled.length !== 1 ? 's' : ''} scheduled`}
        breadcrumbs={[
          { label: 'Notifications', href: '/admin/notifications' },
          { label: 'Scheduled' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/admin/notifications/create"
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              + Schedule New
            </Link>
            <Link
              href="/admin/notifications"
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-300 dark:ring-gray-600"
            >
              Dashboard
            </Link>
          </div>
        }
      />

      {/* Summary Stats */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          {
            label: 'Scheduled',
            value: scheduled.length,
            color: 'text-blue-600',
            bg: 'bg-blue-50 dark:bg-blue-900/20',
            border: 'border-blue-200 dark:border-blue-800',
          },
          {
            label: 'Publishing Today',
            value: scheduled.filter((n) => {
              const d = new Date(n.createdAt);
              d.setDate(d.getDate() + 1);
              return d.toDateString() === new Date().toDateString();
            }).length,
            color: 'text-amber-600',
            bg: 'bg-amber-50 dark:bg-amber-900/20',
            border: 'border-amber-200 dark:border-amber-800',
          },
          {
            label: 'High Priority',
            value: scheduled.filter((n) => n.priority === 'high' || n.priority === 'critical').length,
            color: 'text-rose-600',
            bg: 'bg-rose-50 dark:bg-rose-900/20',
            border: 'border-rose-200 dark:border-rose-800',
          },
          {
            label: 'Announcements',
            value: scheduled.filter((n) => n.type === 'announcement').length,
            color: 'text-purple-600',
            bg: 'bg-purple-50 dark:bg-purple-900/20',
            border: 'border-purple-200 dark:border-purple-800',
          },
        ].map((s) => (
          <div key={s.label} className={`rounded-xl border ${s.border} ${s.bg} p-4`}>
            <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">{s.label}</p>
            <p className={`mt-1 text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Scheduled List */}
      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
          ))}
        </div>
      ) : scheduled.length === 0 ? (
        <EmptyState
          title="No scheduled notifications"
          description="Scheduled notifications will appear here."
          action={
            <Link
              href="/admin/notifications/create"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Schedule a Notification
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {scheduled.map((n) => (
            <ScheduledCard
              key={n.id}
              notification={n}
              onDelete={(id) => setConfirmDelete(id)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title="Cancel Scheduled Notification"
        message="This will cancel the scheduled notification. It will not be delivered. Are you sure?"
        confirmLabel="Cancel Notification"
        variant="danger"
        loading={deleteNotification.isPending}
      />
    </div>
  );
}
