'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import {
  useNotifications,
  useMarkAsRead,
  useMarkAllAsRead,
  useDeleteNotification,
} from '@/hooks/notification/useNotifications';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchBar } from '@/components/ui/SearchBar';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  notificationIcon,
  notificationTypeLabel,
  formatNotificationTime,
  priorityColor,
  priorityLabel,
} from '@/utils/notification';
import type { Notification, NotificationFilters, NotificationType, NotificationPriority } from '@/types/notification';

const PAGE_SIZE = 25;

const NOTIFICATION_TYPES: { value: string; label: string }[] = [
  { value: '', label: 'All Types' },
  { value: 'announcement', label: 'Announcements' },
  { value: 'result_published', label: 'Results' },
  { value: 'mock_test_submitted', label: 'Test Submitted' },
  { value: 'new_mock_test_available', label: 'New Test' },
  { value: 'live_class_reminder', label: 'Live Class' },
  { value: 'warning', label: 'Warnings' },
  { value: 'general_message', label: 'General' },
];

export default function NotificationListPage() {
  const router = useRouter();
  const { user } = useAuth();
  const userId = user?.id;

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [readFilter, setReadFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Confirm dialog state
  const [confirmState, setConfirmState] = useState<{
    type: 'delete' | 'resend';
    id: string;
  } | null>(null);

  // Build filters
  const filters: NotificationFilters = {};
  if (search) filters.search = search;
  if (typeFilter) filters.type = typeFilter as NotificationType;
  if (readFilter === 'unread') filters.isRead = false;
  if (readFilter === 'read') filters.isRead = true;
  if (priorityFilter) filters.priority = priorityFilter as NotificationPriority;

  const { data: notifData, isLoading } = useNotifications(
    userId,
    Object.keys(filters).length > 0 ? filters : undefined,
    { sortBy: 'receivedAt', sortDirection: 'desc' },
    { page, pageSize: PAGE_SIZE },
  );

  const notifications = notifData?.notifications ?? [];
  const totalCount = notifData?.total ?? 0;

  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();
  const deleteNotification = useDeleteNotification();

  const columns: Column<Notification>[] = [
    {
      key: 'type',
      header: 'Type',
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
          <span className={`truncate text-sm max-w-[200px] ${!n.isRead ? 'font-semibold' : 'font-medium'} text-gray-900 dark:text-gray-100`}>
            {n.title}
          </span>
          {!n.isRead && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-blue-500" />}
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Category',
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
      key: 'isRead',
      header: 'Status',
      render: (n) =>
        n.isRead ? (
          <span className="text-xs text-gray-400">Read</span>
        ) : (
          <span className="text-xs font-medium text-blue-600">Unread</span>
        ),
    },
    {
      key: 'receivedAt',
      header: 'Received',
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
          {!n.isRead && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                markAsRead.mutate(n.id);
              }}
              className="rounded px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
            >
              Read
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmState({ type: 'delete', id: n.notificationId });
            }}
            className="rounded px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20"
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  const handleConfirmAction = useCallback(() => {
    if (!confirmState) return;
    if (confirmState.type === 'delete') {
      deleteNotification.mutate(confirmState.id);
    }
    setConfirmState(null);
  }, [confirmState, deleteNotification]);

  return (
    <div>
      <PageHeader
        title="All Notifications"
        description={`${totalCount} notification${totalCount !== 1 ? 's' : ''}`}
        breadcrumbs={[
          { label: 'Notifications', href: '/teacher/notifications' },
          { label: 'All Notifications' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={() => {
                  selectedIds.forEach((id) => markAsRead.mutate(id));
                  setSelectedIds(new Set());
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Mark Read ({selectedIds.size})
              </button>
            )}
            {notifData && notifData.unreadCount > 0 && (
              <button
                type="button"
                onClick={() => userId && markAllAsRead.mutate(userId)}
                disabled={markAllAsRead.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-300 dark:ring-gray-600"
              >
                {markAllAsRead.isPending ? '...' : 'Mark All Read'}
              </button>
            )}
            <Link
              href="/teacher/notifications/create"
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Create
            </Link>
            <Link
              href="/teacher/notifications"
              className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-300 dark:ring-gray-600"
            >
              Dashboard
            </Link>
          </div>
        }
      />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <SearchBar
            value={search}
            onChange={(v) => { setSearch(v); setPage(1); }}
            placeholder="Search notifications..."
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="min-w-[140px] rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        >
          {NOTIFICATION_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <select
          value={readFilter}
          onChange={(e) => { setReadFilter(e.target.value); setPage(1); }}
          className="min-w-[120px] rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        >
          <option value="">All Status</option>
          <option value="unread">Unread</option>
          <option value="read">Read</option>
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => { setPriorityFilter(e.target.value); setPage(1); }}
          className="min-w-[120px] rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        >
          <option value="">All Priority</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
      </div>

      <DataTable<Notification>
        columns={columns}
        data={notifications}
        keyExtractor={(n) => n.id}
        onRowClick={(n) => router.push(`/teacher/notifications/${n.id}`)}
        isLoading={isLoading}
        sortable
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={totalCount}
        onPageChange={setPage}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        emptyState={
          <EmptyState
            title="No notifications found"
            description={
              search
                ? `No notifications matching "${search}"`
                : 'No notifications yet. They will appear from system events and announcements.'
            }
          />
        }
      />

      <ConfirmDialog
        open={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={handleConfirmAction}
        title="Delete Notification"
        message="This will soft-delete this notification event. It will be hidden from all recipients. Are you sure?"
        confirmLabel="Delete"
        variant="danger"
        loading={deleteNotification.isPending}
      />
    </div>
  );
}
