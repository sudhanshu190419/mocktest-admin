'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import {
  useNotifications,
  useNotificationDashboard,
  useMarkAllAsRead,
} from '@/hooks/notification/useNotifications';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import {
  notificationIcon,
  notificationTypeLabel,
  formatNotificationTime,
  priorityColor,
  priorityLabel,
} from '@/utils/notification';
import type { Notification } from '@/types/notification';

// ─── Stat Card ──────────────────────────────────────────────────────────────

function StatCard({ label, value, subtext, color, bg, border }: {
  label: string;
  value: string | number;
  subtext?: string;
  color: string;
  bg: string;
  border: string;
}) {
  return (
    <div className={`rounded-xl border ${border} ${bg} p-4 transition-shadow hover:shadow-md`}>
      <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
      {subtext && <p className="mt-0.5 text-xs text-gray-400">{subtext}</p>}
    </div>
  );
}

// ─── Notification Row ───────────────────────────────────────────────────────

function NotificationRow({ notification }: { notification: Notification }) {
  const actionUrl = notification.actionUrl && notification.actionUrl.startsWith('/')
    ? notification.actionUrl
    : null;

  const content = (
    <div className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:border-gray-600 dark:hover:bg-gray-800/30 ${!notification.isRead ? 'border-blue-100 bg-blue-50/50 dark:border-blue-900/30 dark:bg-blue-900/10' : 'border-gray-100 bg-white dark:bg-gray-900'}`}>
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm dark:bg-gray-800">
        {notificationIcon(notification.type)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className={`truncate text-sm ${!notification.isRead ? 'font-semibold text-gray-900 dark:text-gray-100' : 'font-medium text-gray-700 dark:text-gray-300'}`}>
            {notification.title}
          </p>
          {!notification.isRead && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-blue-500" />}
        </div>
        <p className="mt-0.5 text-xs text-gray-500 line-clamp-1">{notification.message}</p>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-gray-400">
          <span>{notificationTypeLabel(notification.type)}</span>
          <span>·</span>
          <span>{formatNotificationTime(notification.receivedAt)}</span>
        </div>
      </div>
      <div className="flex-shrink-0">
        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${priorityColor(notification.priority)}`}>
          {priorityLabel(notification.priority)}
        </span>
      </div>
    </div>
  );

  if (actionUrl) {
    return <Link href={actionUrl}>{content}</Link>;
  }
  return content;
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function NotificationsDashboardPage() {
  const { user, instituteId } = useAuth();
  const userId = user?.id;

  const { data: notifData, isLoading: notificationsLoading } = useNotifications(
    userId,
    {},
    { sortBy: 'receivedAt', sortDirection: 'desc' },
    { page: 1, pageSize: 10 },
  );

  const { data: dashboardStats, isLoading: statsLoading } = useNotificationDashboard(
    userId,
    instituteId ?? undefined,
  );

  const markAllAsRead = useMarkAllAsRead();

  const notifications = notifData?.notifications ?? [];
  const stats = dashboardStats;
  const isLoading = notificationsLoading || statsLoading;

  const statCards = [
    {
      label: 'Total Notifications',
      value: stats?.totalNotifications ?? 0,
      color: 'text-blue-600',
      bg: 'bg-blue-50 dark:bg-blue-900/20',
      border: 'border-blue-200 dark:border-blue-800',
    },
    {
      label: 'Unread',
      value: stats?.unreadCount ?? 0,
      color: 'text-rose-600',
      bg: 'bg-rose-50 dark:bg-rose-900/20',
      border: 'border-rose-200 dark:border-rose-800',
    },
    {
      label: 'Read Today',
      value: stats?.todayCount ?? 0,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50 dark:bg-emerald-900/20',
      border: 'border-emerald-200 dark:border-emerald-800',
    },
    {
      label: 'Announcements',
      value: stats?.announcementsCount ?? 0,
      color: 'text-purple-600',
      bg: 'bg-purple-50 dark:bg-purple-900/20',
      border: 'border-purple-200 dark:border-purple-800',
    },
    {
      label: 'High Priority',
      value: stats?.highPriorityCount ?? 0,
      color: 'text-amber-600',
      bg: 'bg-amber-50 dark:bg-amber-900/20',
      border: 'border-amber-200 dark:border-amber-800',
    },
    {
      label: 'Read Rate',
      value: stats && stats.totalNotifications > 0
        ? `${Math.round((stats.readCount / stats.totalNotifications) * 100)}%`
        : '—',
      color: 'text-indigo-600',
      bg: 'bg-indigo-50 dark:bg-indigo-900/20',
      border: 'border-indigo-200 dark:border-indigo-800',
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description={stats ? `${stats.unreadCount} unread · ${stats.totalNotifications} total` : 'Manage notifications and announcements'}
        actions={
          <div className="flex items-center gap-2">
            {stats && stats.unreadCount > 0 && (
              <button
                type="button"
                onClick={() => userId && markAllAsRead.mutate(userId)}
                disabled={markAllAsRead.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50 dark:bg-gray-900 dark:text-gray-300 dark:ring-gray-600"
              >
                {markAllAsRead.isPending ? 'Marking...' : 'Mark All Read'}
              </button>
            )}
            <Link
              href="/teacher/notifications/create"
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Create Announcement
            </Link>
          </div>
        }
      />

      {/* Stats Cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
              <Skeleton className="mb-2 h-3 w-20" />
              <Skeleton className="h-7 w-12" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {statCards.map((s) => (
            <StatCard key={s.label} {...s} />
          ))}
        </div>
      )}

      {/* Quick Actions */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Quick Actions</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Create Announcement', href: '/teacher/notifications/create', icon: '📢', color: 'bg-blue-600' },
            { label: 'View All', href: '/teacher/notifications/list', icon: '📋', color: 'bg-emerald-600' },
            { label: 'Scheduled', href: '/teacher/notifications/scheduled', icon: '⏰', color: 'bg-amber-600' },
            { label: 'History', href: '/teacher/notifications/history', icon: '📜', color: 'bg-purple-600' },
          ].map((action) => (
            <Link
              key={action.label}
              href={action.href}
              className="group flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 transition-all hover:border-gray-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-900"
            >
              <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-sm text-white shadow-sm ${action.color}`}>
                {action.icon}
              </div>
              <span className="text-xs font-medium text-gray-700 group-hover:text-blue-600 dark:text-gray-300">
                {action.label}
              </span>
            </Link>
          ))}
        </div>
      </div>

      {/* Recent Notifications */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Recent Notifications</h2>
          <Link href="/teacher/notifications/list" className="text-xs font-medium text-blue-600 hover:text-blue-700">
            View all
          </Link>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <EmptyState
            title="No notifications yet"
            description="Notifications from system events and announcements will appear here."
          />
        ) : (
          <div className="space-y-2">
            {notifications.map((n) => (
              <NotificationRow key={n.id} notification={n} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
