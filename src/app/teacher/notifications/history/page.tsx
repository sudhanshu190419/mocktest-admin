'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useNotifications } from '@/hooks/notification/useNotifications';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchBar } from '@/components/ui/SearchBar';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  notificationIcon,
  notificationTypeLabel,
  formatNotificationTime,
  priorityColor,
  priorityLabel,
} from '@/utils/notification';
import type { Notification, NotificationFilters, NotificationType } from '@/types/notification';

const PAGE_SIZE = 25;

export default function NotificationHistoryPage() {
  const router = useRouter();
  const { user } = useAuth();
  const userId = user?.id;

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'month'>('all');

  // Build filters
  const filters: NotificationFilters = {};
  if (search) filters.search = search;
  if (typeFilter) filters.type = typeFilter as NotificationType;
  if (dateFilter === 'today') {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    filters.createdAfter = today.toISOString();
  } else if (dateFilter === 'week') {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    filters.createdAfter = weekAgo.toISOString();
  } else if (dateFilter === 'month') {
    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    filters.createdAfter = monthAgo.toISOString();
  }

  const { data: notifData, isLoading } = useNotifications(
    userId,
    Object.keys(filters).length > 0 ? filters : undefined,
    { sortBy: 'receivedAt', sortDirection: 'desc' },
    { page, pageSize: PAGE_SIZE },
  );

  const notifications = notifData?.notifications ?? [];
  const totalCount = notifData?.total ?? 0;

  // Build per-notification derived stats
  const enrichedRows = notifications.map((n) => ({
    ...n,
    deliveryRate: n.isRead ? 100 : 0,
    readRate: n.isRead ? 100 : 0,
    opens: n.isRead ? 1 : 0,
  }));

  const columns: Column<(typeof enrichedRows)[0]>[] = [
    {
      key: 'icon',
      header: '',
      render: (n) => (
        <span className="text-lg" title={notificationTypeLabel(n.type)}>
          {notificationIcon(n.type)}
        </span>
      ),
    },
    {
      key: 'title',
      header: 'Title',
      render: (n) => (
        <div className="flex items-center gap-2">
          <span className={`truncate text-sm max-w-[180px] ${!n.isRead ? 'font-semibold' : 'font-medium'} text-gray-900 dark:text-gray-100`}>
            {n.title}
          </span>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (n) => (
        <span className="text-xs text-gray-500">{notificationTypeLabel(n.type)}</span>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      render: (n) => (
        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${priorityColor(n.priority)}`}>
          {priorityLabel(n.priority)}
        </span>
      ),
    },
    {
      key: 'deliveryRate',
      header: 'Delivery',
      render: (n) => (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              className={`h-full rounded-full ${n.deliveryRate === 100 ? 'bg-emerald-500' : 'bg-amber-500'}`}
              style={{ width: `${n.deliveryRate}%` }}
            />
          </div>
          <span className="text-[10px] text-gray-500">{n.deliveryRate}%</span>
        </div>
      ),
    },
    {
      key: 'readRate',
      header: 'Read',
      render: (n) => (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              className={`h-full rounded-full ${n.readRate >= 50 ? 'bg-blue-500' : 'bg-gray-400'}`}
              style={{ width: `${n.readRate}%` }}
            />
          </div>
          <span className="text-[10px] text-gray-500">
            {n.readRate}%
          </span>
        </div>
      ),
    },
    {
      key: 'isRead',
      header: 'Status',
      render: (n) => (
        n.isRead ? (
          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Delivered ✓</span>
        ) : (
          <span className="text-xs text-amber-600 dark:text-amber-400">Pending</span>
        )
      ),
    },
    {
      key: 'receivedAt',
      header: 'Sent',
      sortable: true,
      render: (n) => (
        <span className="text-xs text-gray-500">{formatNotificationTime(n.receivedAt)}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (n) => (
        <div className="flex items-center gap-1">
          <Link
            href={`/teacher/notifications/${n.id}`}
            className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
          >
            View
          </Link>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Notification History"
        description={`${totalCount} notification${totalCount !== 1 ? 's' : ''} sent`}
        breadcrumbs={[
          { label: 'Notifications', href: '/teacher/notifications' },
          { label: 'History' },
        ]}
        actions={
          <Link
            href="/teacher/notifications"
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-300 dark:ring-gray-600"
          >
            Dashboard
          </Link>
        }
      />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <SearchBar
            value={search}
            onChange={(v) => { setSearch(v); setPage(1); }}
            placeholder="Search history..."
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="min-w-[140px] rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        >
          <option value="">All Types</option>
          <option value="announcement">Announcements</option>
          <option value="result_published">Results</option>
          <option value="mock_test_submitted">Test Submitted</option>
          <option value="mock_test_reminder">Mock Test Reminder</option>
          <option value="live_class_reminder">Live Class</option>
          <option value="warning">Warnings</option>
          <option value="general_message">General</option>
        </select>
        <select
          value={dateFilter}
          onChange={(e) => { setDateFilter(e.target.value as any); setPage(1); }}
          className="min-w-[120px] rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        >
          <option value="all">All Time</option>
          <option value="today">Today</option>
          <option value="week">This Week</option>
          <option value="month">This Month</option>
        </select>
      </div>

      <DataTable
        columns={columns}
        data={enrichedRows}
        keyExtractor={(n) => n.id}
        onRowClick={(n) => router.push(`/teacher/notifications/${n.id}`)}
        isLoading={isLoading}
        sortable
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={totalCount}
        onPageChange={setPage}
        emptyState={
          <EmptyState
            title="No notification history"
            description={
              search
                ? `No history matching "${search}"`
                : 'Sent notifications and their delivery stats will appear here.'
            }
          />
        }
      />

      {/* Summary Section */}
      {notifications.length > 0 && (
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Delivery Summary</h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              {
                label: 'Total Sent',
                value: totalCount,
                color: 'text-blue-600',
                bg: 'bg-blue-50 dark:bg-blue-900/20',
              },
              {
                label: 'Delivered',
                value: enrichedRows.filter((n) => n.deliveryRate === 100).length,
                color: 'text-emerald-600',
                bg: 'bg-emerald-50 dark:bg-emerald-900/20',
              },
              {
                label: 'Read',
                value: enrichedRows.filter((n) => n.isRead).length,
                color: 'text-indigo-600',
                bg: 'bg-indigo-50 dark:bg-indigo-900/20',
              },
              {
                label: 'Avg. Read Rate',
                value: totalCount > 0
                  ? `${Math.round((enrichedRows.filter((n) => n.isRead).length / totalCount) * 100)}%`
                  : '—',
                color: 'text-purple-600',
                bg: 'bg-purple-50 dark:bg-purple-900/20',
              },
            ].map((s) => (
              <div key={s.label} className={`rounded-lg border border-gray-100 p-3 dark:border-gray-700 ${s.bg}`}>
                <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">{s.label}</p>
                <p className={`mt-1 text-xl font-bold ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
