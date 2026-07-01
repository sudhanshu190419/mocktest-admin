'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  useNotifications,
  useUnreadNotifications,
  useMarkAsRead,
  useMarkAllAsRead,
  useDeleteNotification,
  useCreateNotification,
  useCreateBulkNotification,
  useAnnouncements,
  usePublishAnnouncement,
  useNotificationDashboard,
} from '@/hooks/notification/useNotifications';
import { useAuth } from '@/hooks/useAuth';
import {
  formatNotificationTime,
  priorityColor,
  notificationIcon,
  notificationTypeLabel,
} from '@/utils/notification';
import LoadingIndicator from '@/components/dev/LoadingIndicator';
import type {
  NotificationListResult,
  NotificationType,
  NotificationPriority,
  NotificationChannel,
  NotificationFilters,
  NotificationSortOptions,
  Announcement,
  NotificationDashboardStats,
  CreateNotificationInput,
  CreateBulkNotificationInput,
  PublishAnnouncementInput,
} from '@/types/notification';
import type { PaginatedResponse } from '@/types/academic';

export interface NotificationsDebugInfo {
  loading: boolean;
  mutationLoading: boolean;
  selectedRecord: string | null;
  cacheStatus: string;
  queryStatus: string;
  lastHookCalled: string;
  lastApiResponse: string | null;
  errorMessage: string | null;
}

interface NotificationsPanelProps {
  onDebugInfo?: (info: NotificationsDebugInfo) => void;
}

type NotificationsTab = 'all' | 'unread' | 'announcements' | 'create' | 'bulk' | 'publish' | 'dashboard';

const TAB_LABELS: Record<string, string> = {
  all: 'All Notifications',
  unread: 'Unread',
  announcements: 'Announcements',
  create: 'Create',
  bulk: 'Bulk',
  publish: 'Publish',
  dashboard: 'Dashboard',
};

const NOTIFICATION_TYPES: NotificationType[] = [
  'mock_test_assigned',
  'mock_test_reminder',
  'mock_test_submitted',
  'result_published',
  'new_content_uploaded',
  'chapter_added',
  'subject_added',
  'new_mock_test_available',
  'announcement',
  'general_message',
  'warning',
  'success',
  'error',
];

const NOTIFICATION_PRIORITIES: NotificationPriority[] = ['low', 'normal', 'high', 'critical'];

const NOTIFICATION_CHANNELS: NotificationChannel[] = ['in_app', 'push', 'email', 'sms'];

export default function NotificationsPanel({ onDebugInfo }: NotificationsPanelProps) {
  const { user } = useAuth();

  // ── Tab state ────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<NotificationsTab>('dashboard');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [entityId, setEntityId] = useState('');
  const [loadEntityId, setLoadEntityId] = useState('');

  // ── Form state ───────────────────────────────────────────────────────
  const [notifTitle, setNotifTitle] = useState('');
  const [notifBody, setNotifBody] = useState('');
  const [notifType, setNotifType] = useState<NotificationType>('general_message');
  const [notifPriority, setNotifPriority] = useState<NotificationPriority>('normal');
  const [notifChannel, setNotifChannel] = useState<NotificationChannel>('in_app');
  const [notifRefType, setNotifRefType] = useState('');
  const [notifRefId, setNotifRefId] = useState('');
  const [notifRecipientIds, setNotifRecipientIds] = useState('');
  const [announceTitle, setAnnounceTitle] = useState('');
  const [announceBody, setAnnounceBody] = useState('');
  const [announceTargetRole, setAnnounceTargetRole] = useState<'all' | 'student' | 'teacher' | 'admin'>('all');

  // ── Operation feedback ───────────────────────────────────────────────
  const [operationError, setOperationError] = useState<string | null>(null);
  const [operationSuccess, setOperationSuccess] = useState<string | null>(null);
  const [lastHookCalled, setLastHookCalled] = useState<string>('—');
  const [lastApiResponse, setLastApiResponse] = useState<string | null>(null);

  // ── Filter state ─────────────────────────────────────────────────────
  const [filterType, setFilterType] = useState<string>('');
  const [filterIsRead, setFilterIsRead] = useState<string>('');

  const pageSize = 10;

  // ── Hooks ────────────────────────────────────────────────────────────
  const dashboardQuery = useNotificationDashboard(
    activeTab === 'dashboard' ? (loadEntityId || user?.id) : null,
    user?.instituteId ?? undefined,
  );

  // Build filters object from separate filter state
  const activeFilters = useMemo<NotificationFilters | undefined>(() => {
    const filters: NotificationFilters = {};
    if (filterType) {
      filters.type = filterType as NotificationType;
    }
    if (filterIsRead !== '') {
      filters.isRead = filterIsRead === 'true';
    }
    return Object.keys(filters).length > 0 ? filters : undefined;
  }, [filterType, filterIsRead]);

  const notificationsQuery = useNotifications(
    activeTab === 'all' ? (loadEntityId || user?.id) : null,
    activeFilters,
    { sortBy: 'receivedAt', sortDirection: 'desc' } as NotificationSortOptions,
    { page, pageSize },
  );

  const unreadQuery = useUnreadNotifications(
    activeTab === 'unread' ? (loadEntityId || user?.id) : null,
    { page, pageSize },
  );

  const announcementsQuery = useAnnouncements(
    activeTab === 'announcements' ? (loadEntityId || user?.instituteId) : null,
    { page, pageSize },
  );

  // ── Mutations ──────────────────────────────────────────────────────────
  const markAsReadMut = useMarkAsRead();
  const markAllAsReadMut = useMarkAllAsRead();
  const deleteNotifMut = useDeleteNotification();
  const createNotifMut = useCreateNotification();
  const createBulkMut = useCreateBulkNotification();
  const publishAnnounceMut = usePublishAnnouncement();

  const mutationLoading =
    markAsReadMut.isPending ||
    markAllAsReadMut.isPending ||
    deleteNotifMut.isPending ||
    createNotifMut.isPending ||
    createBulkMut.isPending ||
    publishAnnounceMut.isPending;

  const isLoading =
    activeTab === 'dashboard' ? dashboardQuery.isLoading :
    activeTab === 'all' ? notificationsQuery.isLoading :
    activeTab === 'unread' ? unreadQuery.isLoading :
    activeTab === 'announcements' ? announcementsQuery.isLoading :
    false;

  const currentQueryStatus = activeTab === 'dashboard' ? dashboardQuery.status :
    activeTab === 'all' ? notificationsQuery.status :
    activeTab === 'unread' ? unreadQuery.status :
    activeTab === 'announcements' ? announcementsQuery.status :
    'idle';

  // ── Report debug info ─────────────────────────────────────────────────
  useEffect(() => {
    if (!onDebugInfo) return;
    onDebugInfo({
      loading: isLoading,
      mutationLoading,
      selectedRecord: selectedId,
      cacheStatus: 'mixed',
      queryStatus: currentQueryStatus,
      lastHookCalled,
      lastApiResponse,
      errorMessage: operationError,
    });
  });

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleTabChange = useCallback((tab: NotificationsTab) => {
    setActiveTab(tab);
    setPage(1);
    setOperationError(null);
    setOperationSuccess(null);
    setLastHookCalled(`tab: ${TAB_LABELS[tab]}`);
  }, []);

  const handleLoad = useCallback(() => {
    setLoadEntityId(entityId.trim());
    setLastHookCalled(`load: ${entityId.trim()}`);
    setLastApiResponse(null);
    setOperationError(null);
    setOperationSuccess(null);
  }, [entityId]);

  const handleRefresh = useCallback(() => {
    dashboardQuery.refetch().catch(() => {});
    notificationsQuery.refetch().catch(() => {});
    unreadQuery.refetch().catch(() => {});
    announcementsQuery.refetch().catch(() => {});
    setLastHookCalled('refetch');
  }, [dashboardQuery, notificationsQuery, unreadQuery, announcementsQuery]);

  const handleMarkAsRead = useCallback(async (id: string) => {
    setLastHookCalled('markAsRead');
    setOperationError(null);
    setOperationSuccess(null);

    try {
      await markAsReadMut.mutateAsync(id);
      setLastApiResponse(JSON.stringify({ id }));
      setOperationSuccess('Marked as read');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed';
      setOperationError(msg);
    }
  }, [markAsReadMut]);

  const handleMarkAllAsRead = useCallback(async () => {
    const userId = loadEntityId || user?.id;
    if (!userId) return;

    setLastHookCalled('markAllAsRead');
    setOperationError(null);
    setOperationSuccess(null);

    try {
      const count = await markAllAsReadMut.mutateAsync(userId);
      setLastApiResponse(JSON.stringify({ count }));
      setOperationSuccess(`Marked ${count} as read`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed';
      setOperationError(msg);
    }
  }, [markAllAsReadMut, loadEntityId, user?.id]);

  const handleDelete = useCallback(async (notificationId: string) => {
    setLastHookCalled('deleteNotification');
    setOperationError(null);
    setOperationSuccess(null);

    try {
      await deleteNotifMut.mutateAsync(notificationId);
      setLastApiResponse(JSON.stringify({ notificationId }));
      setOperationSuccess('Notification deleted');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed';
      setOperationError(msg);
    }
  }, [deleteNotifMut]);

  const handleSelectNotification = useCallback((id: string) => {
    setSelectedId(id === selectedId ? null : id);
  }, [selectedId]);

  const handleCreateNotification = useCallback(async () => {
    if (!user?.instituteId) {
      setOperationError('Institute ID is required. Authenticate first.');
      return;
    }

    setLastHookCalled('createNotification');
    setOperationError(null);
    setOperationSuccess(null);

    const input: CreateNotificationInput = {
      instituteId: user.instituteId,
      title: notifTitle,
      body: notifBody,
      eventType: notifType,
      channel: notifChannel,
      referenceType: notifRefType || null,
      referenceId: notifRefId || null,
      priority: notifPriority,
    };

    try {
      const result = await createNotifMut.mutateAsync(input);
      setLastApiResponse(JSON.stringify(result));
      setOperationSuccess(`Notification created: ${result.notificationId}`);
      setNotifTitle('');
      setNotifBody('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed';
      setOperationError(msg);
    }
  }, [
    user?.instituteId, notifTitle, notifBody, notifType,
    notifChannel, notifRefType, notifRefId, notifPriority,
    createNotifMut,
  ]);

  const handleCreateBulk = useCallback(async () => {
    if (!user?.instituteId) {
      setOperationError('Institute ID is required. Authenticate first.');
      return;
    }

    const ids = notifRecipientIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (ids.length === 0) {
      setOperationError('Enter at least one recipient UUID.');
      return;
    }

    setLastHookCalled('createBulkNotification');
    setOperationError(null);
    setOperationSuccess(null);

    const input: CreateBulkNotificationInput = {
      instituteId: user.instituteId,
      title: notifTitle,
      body: notifBody,
      eventType: notifType,
      channel: notifChannel,
      recipientIds: ids,
      referenceType: notifRefType || null,
      referenceId: notifRefId || null,
      priority: notifPriority,
    };

    try {
      const result = await createBulkMut.mutateAsync(input);
      setLastApiResponse(JSON.stringify(result));
      setOperationSuccess(`Bulk notification sent to ${result.recipientCount} recipients`);
      setNotifTitle('');
      setNotifBody('');
      setNotifRecipientIds('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed';
      setOperationError(msg);
    }
  }, [
    user?.instituteId, notifTitle, notifBody, notifType,
    notifChannel, notifRecipientIds, notifRefType, notifRefId,
    notifPriority, createBulkMut,
  ]);

  const handlePublishAnnouncement = useCallback(async () => {
    if (!user?.instituteId) {
      setOperationError('Institute ID is required. Authenticate first.');
      return;
    }

    setLastHookCalled('publishAnnouncement');
    setOperationError(null);
    setOperationSuccess(null);

    const input: PublishAnnouncementInput = {
      instituteId: user.instituteId,
      title: announceTitle,
      body: announceBody,
      targetRole: announceTargetRole,
    };

    try {
      const result = await publishAnnounceMut.mutateAsync(input);
      setLastApiResponse(JSON.stringify(result));
      setOperationSuccess(`Announcement published: ${result.notificationId}`);
      setAnnounceTitle('');
      setAnnounceBody('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed';
      setOperationError(msg);
    }
  }, [
    user?.instituteId, announceTitle, announceBody,
    announceTargetRole, publishAnnounceMut,
  ]);

  // ═══════════════════════════════════════════════════════════════════════
  //  Render Helpers
  // ═══════════════════════════════════════════════════════════════════════

  const Card = ({ label, value }: { label: string; value: string | number }) => (
    <div className="rounded border border-gray-700 bg-gray-900 p-3">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">{label}</div>
      <div className="text-sm font-semibold text-gray-100">{value}</div>
    </div>
  );

  const SectionTitle = ({ title, count }: { title: string; count?: number }) => (
    <h3 className="text-sm font-semibold text-gray-100 mt-4 mb-2">
      {title}
      {count !== undefined && (
        <span className="ml-2 text-xs text-gray-500 font-normal">({count})</span>
      )}
    </h3>
  );

  const NotifBadge = ({ variant, label }: { variant: 'info' | 'success' | 'warning' | 'default'; label: string }) => {
    const colors = {
      info: 'bg-blue-900/30 text-blue-400 border-blue-700/50',
      success: 'bg-green-900/30 text-green-400 border-green-700/50',
      warning: 'bg-amber-900/30 text-amber-400 border-amber-700/50',
      default: 'bg-gray-800 text-gray-400 border-gray-700',
    };

    return (
      <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium ${colors[variant]}`}>
        {label}
      </span>
    );
  };

  // ═══════════════════════════════════════════════════════════════════════
  //  Tab Renderers
  // ═══════════════════════════════════════════════════════════════════════

  const renderDashboard = (data: NotificationDashboardStats) => (
    <div>
      <SectionTitle title="Notification Dashboard" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card label="Total" value={data.totalNotifications} />
        <Card label="Unread" value={data.unreadCount} />
        <Card label="Read" value={data.readCount} />
        <Card label="Announcements" value={data.announcementsCount} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
        <Card label="High Priority" value={data.highPriorityCount} />
        <Card label="Today" value={data.todayCount} />
        <Card label="Critical" value={data.criticalCount} />
      </div>
      <div className="flex gap-2 mt-4">
        <button
          type="button"
          onClick={() => handleTabChange('all')}
          className="rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600"
        >
          View All
        </button>
        <button
          type="button"
          onClick={handleMarkAllAsRead}
          disabled={markAllAsReadMut.isPending}
          className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-700 disabled:opacity-50"
        >
          {markAllAsReadMut.isPending ? 'Marking...' : 'Mark All Read'}
        </button>
      </div>
    </div>
  );

  const renderNotificationList = (
    data: NotificationListResult | undefined,
    isUnread = false,
  ) => {
    if (!data || data.notifications.length === 0) {
      return <p className="text-xs text-gray-500 mt-2">No notifications found.</p>;
    }

    return (
      <div>
        <SectionTitle title={isUnread ? 'Unread Notifications' : 'All Notifications'} count={data.total} />
        <p className="text-[10px] text-gray-600 mb-2">Unread: {data.unreadCount}</p>

        <div className="flex gap-2 mb-3">
          <button
            type="button"
            onClick={handleMarkAllAsRead}
            disabled={markAllAsReadMut.isPending}
            className="rounded bg-gray-800 px-2.5 py-1 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-50"
          >
            {markAllAsReadMut.isPending ? '...' : 'Mark All Read'}
          </button>
        </div>

        <div className="space-y-2 max-h-96 overflow-y-auto">
          {data.notifications.map((notif) => (
            <div
              key={notif.id}
              className={`rounded border p-3 cursor-pointer transition-colors ${
                selectedId === notif.id
                  ? 'border-blue-600 bg-blue-950/30'
                  : notif.isRead
                    ? 'border-gray-700 bg-gray-900/50'
                    : 'border-gray-600 bg-gray-900'
              }`}
              onClick={() => handleSelectNotification(notif.id)}
            >
              <div className="flex items-start gap-3">
                <span className="text-lg">{notificationIcon(notif.type)}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-semibold ${notif.isRead ? 'text-gray-400' : 'text-gray-100'}`}>
                      {notif.title}
                    </span>
                    {!notif.isRead && (
                      <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 line-clamp-2 mb-1">{notif.message}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <NotifBadge variant="info" label={notificationTypeLabel(notif.type)} />
                    <span className={`inline-block rounded border px-1 py-0.5 text-[10px] ${priorityColor(notif.priority)}`}>
                      {notif.priority}
                    </span>
                    <span className="text-[10px] text-gray-600">{formatNotificationTime(notif.createdAt)}</span>
                    {notif.isRead && notif.readAt && (
                      <span className="text-[10px] text-gray-600">Read {formatNotificationTime(notif.readAt)}</span>
                    )}
                  </div>

                  {/* Expanded details */}
                  {selectedId === notif.id && (
                    <div className="mt-3 pt-2 border-t border-gray-700 space-y-1.5">
                      <div className="text-[10px] text-gray-500">
                        ID: <span className="text-gray-400 font-mono">{notif.id}</span>
                      </div>
                      <div className="text-[10px] text-gray-500">
                        Notification ID: <span className="text-gray-400 font-mono">{notif.notificationId}</span>
                      </div>
                      <div className="text-[10px] text-gray-500">
                        Channel: <span className="text-gray-400">{notif.channel}</span>
                      </div>
                      <div className="text-[10px] text-gray-500">
                        User ID: <span className="text-gray-400 font-mono">{notif.userId}</span>
                      </div>
                      <div className="text-[10px] text-gray-500">
                        Created: <span className="text-gray-400">{notif.createdAt}</span>
                      </div>
                      <div className="text-[10px] text-gray-500">
                        Action URL: <span className="text-gray-400">{notif.actionUrl ?? '—'}</span>
                      </div>
                      {notif.referenceType && (
                        <div className="text-[10px] text-gray-500">
                          Reference: <span className="text-gray-400">{notif.referenceType} / {notif.referenceId}</span>
                        </div>
                      )}
                      <div className="flex gap-2 mt-2">
                        {!notif.isRead && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleMarkAsRead(notif.id); }}
                            disabled={markAsReadMut.isPending}
                            className="rounded bg-blue-800 px-2 py-1 text-[10px] text-blue-200 hover:bg-blue-700 disabled:opacity-50"
                          >
                            Mark Read
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleDelete(notif.notificationId); }}
                          disabled={deleteNotifMut.isPending}
                          className="rounded bg-red-900/50 px-2 py-1 text-[10px] text-red-400 hover:bg-red-800/50 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Pagination */}
        {data.pageCount > 1 && (
          <div className="flex items-center justify-between mt-3">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded bg-gray-800 px-2.5 py-1 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-50"
            >
              ← Prev
            </button>
            <span className="text-[10px] text-gray-600">
              Page {data.page} of {data.pageCount} ({data.total} total)
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= data.pageCount}
              className="rounded bg-gray-800 px-2.5 py-1 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-50"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderAnnouncements = (data: PaginatedResponse<Announcement> | undefined) => {
    if (!data || data.data.length === 0) {
      return <p className="text-xs text-gray-500 mt-2">No announcements found.</p>;
    }

    return (
      <div>
        <SectionTitle title="Announcements" count={data.count} />
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {data.data.map((ann) => (
            <div key={ann.id} className="rounded border border-gray-700 bg-gray-900 p-3">
              <div className="flex items-start gap-3">
                <span className="text-lg">📢</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-100">{ann.title}</span>
                    <span className={`inline-block rounded border px-1 py-0.5 text-[10px] ${priorityColor(ann.priority)}`}>
                      {ann.priority}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1">{ann.message}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    <span className="text-[10px] text-gray-600">
                      Target: <span className="text-gray-400">{ann.targetRole}</span>
                    </span>
                    <span className="text-[10px] text-gray-600">
                      {formatNotificationTime(ann.createdAt)}
                    </span>
                    <span className="text-[10px] text-gray-600 font-mono">{ann.notificationId}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {data.pageCount > 1 && (
          <div className="flex items-center justify-between mt-3">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded bg-gray-800 px-2.5 py-1 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-50"
            >
              ← Prev
            </button>
            <span className="text-[10px] text-gray-600">
              Page {data.page} of {data.pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= data.pageCount}
              className="rounded bg-gray-800 px-2.5 py-1 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-50"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderCreateForm = () => (
    <div className="rounded border border-gray-700 bg-gray-900 p-4">
      <SectionTitle title="Create Single Notification" />
      <p className="text-[10px] text-gray-600 mb-3">Creates a notification event without recipients (for testing).</p>

      <div className="space-y-3">
        <div className="space-y-1">
          <label className="block text-[10px] uppercase tracking-wider text-gray-500">Title *</label>
          <input
            type="text"
            value={notifTitle}
            onChange={(e) => setNotifTitle(e.target.value)}
            placeholder="Notification title"
            className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200"
          />
        </div>

        <div className="space-y-1">
          <label className="block text-[10px] uppercase tracking-wider text-gray-500">Body *</label>
          <textarea
            value={notifBody}
            onChange={(e) => setNotifBody(e.target.value)}
            placeholder="Notification body"
            rows={3}
            className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200"
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Type</label>
            <select
              value={notifType}
              onChange={(e) => setNotifType(e.target.value as NotificationType)}
              className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200"
            >
              {NOTIFICATION_TYPES.map((t) => (
                <option key={t} value={t}>{notificationTypeLabel(t)}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Priority</label>
            <select
              value={notifPriority}
              onChange={(e) => setNotifPriority(e.target.value as NotificationPriority)}
              className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200"
            >
              {NOTIFICATION_PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Channel</label>
            <select
              value={notifChannel}
              onChange={(e) => setNotifChannel(e.target.value as NotificationChannel)}
              className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200"
            >
              {NOTIFICATION_CHANNELS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Reference Type</label>
            <input
              type="text"
              value={notifRefType}
              onChange={(e) => setNotifRefType(e.target.value)}
              placeholder="e.g. mock_test"
              className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Reference ID</label>
            <input
              type="text"
              value={notifRefId}
              onChange={(e) => setNotifRefId(e.target.value)}
              placeholder="UUID"
              className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={handleCreateNotification}
          disabled={createNotifMut.isPending || !notifTitle || !notifBody}
          className="rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
        >
          {createNotifMut.isPending ? 'Creating...' : 'Create Notification'}
        </button>
      </div>
    </div>
  );

  const renderBulkForm = () => (
    <div className="rounded border border-gray-700 bg-gray-900 p-4">
      <SectionTitle title="Create Bulk Notification" />
      <p className="text-[10px] text-gray-600 mb-3">
        Creates a notification and sends it to multiple recipients.
      </p>

      <div className="space-y-3">
        <div className="space-y-1">
          <label className="block text-[10px] uppercase tracking-wider text-gray-500">Title *</label>
          <input
            type="text"
            value={notifTitle}
            onChange={(e) => setNotifTitle(e.target.value)}
            placeholder="Notification title"
            className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200"
          />
        </div>

        <div className="space-y-1">
          <label className="block text-[10px] uppercase tracking-wider text-gray-500">Body *</label>
          <textarea
            value={notifBody}
            onChange={(e) => setNotifBody(e.target.value)}
            placeholder="Notification body"
            rows={3}
            className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200"
          />
        </div>

        <div className="space-y-1">
          <label className="block text-[10px] uppercase tracking-wider text-gray-500">
            Recipient IDs * <span className="text-gray-600 font-normal">(comma-separated UUIDs)</span>
          </label>
          <textarea
            value={notifRecipientIds}
            onChange={(e) => setNotifRecipientIds(e.target.value)}
            placeholder="uuid-1, uuid-2, uuid-3"
            rows={2}
            className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200"
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Type</label>
            <select
              value={notifType}
              onChange={(e) => setNotifType(e.target.value as NotificationType)}
              className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200"
            >
              {NOTIFICATION_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Priority</label>
            <select
              value={notifPriority}
              onChange={(e) => setNotifPriority(e.target.value as NotificationPriority)}
              className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200"
            >
              {NOTIFICATION_PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Channel</label>
            <select
              value={notifChannel}
              onChange={(e) => setNotifChannel(e.target.value as NotificationChannel)}
              className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200"
            >
              {NOTIFICATION_CHANNELS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Reference Type</label>
            <input
              type="text"
              value={notifRefType}
              onChange={(e) => setNotifRefType(e.target.value)}
              placeholder="e.g. mock_test"
              className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Reference ID</label>
            <input
              type="text"
              value={notifRefId}
              onChange={(e) => setNotifRefId(e.target.value)}
              placeholder="UUID"
              className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={handleCreateBulk}
          disabled={createBulkMut.isPending || !notifTitle || !notifBody || !notifRecipientIds}
          className="rounded bg-purple-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-600 disabled:opacity-50"
        >
          {createBulkMut.isPending ? 'Sending...' : 'Send Bulk Notification'}
        </button>
      </div>
    </div>
  );

  const renderPublishForm = () => (
    <div className="rounded border border-gray-700 bg-gray-900 p-4">
      <SectionTitle title="Publish Announcement" />
      <p className="text-[10px] text-gray-600 mb-3">
        Creates an announcement notification in the system.
      </p>

      <div className="space-y-3">
        <div className="space-y-1">
          <label className="block text-[10px] uppercase tracking-wider text-gray-500">Title *</label>
          <input
            type="text"
            value={announceTitle}
            onChange={(e) => setAnnounceTitle(e.target.value)}
            placeholder="Announcement title"
            className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200"
          />
        </div>

        <div className="space-y-1">
          <label className="block text-[10px] uppercase tracking-wider text-gray-500">Body *</label>
          <textarea
            value={announceBody}
            onChange={(e) => setAnnounceBody(e.target.value)}
            placeholder="Announcement body"
            rows={3}
            className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200"
          />
        </div>

        <div className="space-y-1">
          <label className="block text-[10px] uppercase tracking-wider text-gray-500">Target Role</label>
          <select
            value={announceTargetRole}
            onChange={(e) => setAnnounceTargetRole(e.target.value as typeof announceTargetRole)}
            className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200"
          >
            <option value="all">All</option>
            <option value="student">Students</option>
            <option value="teacher">Teachers</option>
            <option value="admin">Admins</option>
          </select>
        </div>

        <button
          type="button"
          onClick={handlePublishAnnouncement}
          disabled={publishAnnounceMut.isPending || !announceTitle || !announceBody}
          className="rounded bg-green-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-600 disabled:opacity-50"
        >
          {publishAnnounceMut.isPending ? 'Publishing...' : 'Publish Announcement'}
        </button>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════
  //  Main Render
  // ═══════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-100">Notifications Console</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {TAB_LABELS[activeTab]} — Test notification operations, filtering, pagination
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isLoading && <LoadingIndicator label="Loading..." />}
        </div>
      </div>

      {/* ── Error / Success Messages ─────────────────────────────────────── */}
      {operationError && (
        <div className="rounded border border-red-700/50 bg-red-950/30 px-4 py-2.5">
          <span className="text-xs text-red-400">{operationError}</span>
        </div>
      )}
      {operationSuccess && (
        <div className="rounded border border-green-700/50 bg-green-950/30 px-4 py-2.5">
          <span className="text-xs text-green-400">{operationSuccess}</span>
        </div>
      )}

      {/* ── Tab Navigation ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5">
        {(['dashboard', 'all', 'unread', 'announcements', 'create', 'bulk', 'publish'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => handleTabChange(tab)}
            className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
              activeTab === tab
                ? 'bg-blue-700 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* ── Entity ID Input ──────────────────────────────────────────────── */}
      <div className="rounded border border-gray-700 bg-gray-900 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1 min-w-[280px]">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">
              {activeTab === 'announcements' ? 'Institute ID' : 'User ID'}
            </label>
            <input
              type="text"
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              placeholder="UUID (leave empty for current user)"
              className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200"
            />
          </div>
          <button
            type="button"
            onClick={handleLoad}
            className="rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white"
          >
            Load
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* ── Filters (for All / Unread tabs) ──────────────────────────────── */}
      {(activeTab === 'all' || activeTab === 'unread') && (
        <div className="rounded border border-gray-700 bg-gray-900 p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="block text-[10px] uppercase tracking-wider text-gray-500">Type</label>
              <select
                value={filterType}
                onChange={(e) => { setFilterType(e.target.value); setPage(1); }}
                className="rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200"
              >
                <option value="">All Types</option>
                {NOTIFICATION_TYPES.map((t) => (
                  <option key={t} value={t}>{notificationTypeLabel(t)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="block text-[10px] uppercase tracking-wider text-gray-500">Read Status</label>
              <select
                value={filterIsRead}
                onChange={(e) => { setFilterIsRead(e.target.value); setPage(1); }}
                className="rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200"
              >
                <option value="">All</option>
                <option value="false">Unread</option>
                <option value="true">Read</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* ── Dashboard Tab ────────────────────────────────────────────────── */}
      {activeTab === 'dashboard' && (
        dashboardQuery.isLoading ? (
          <LoadingIndicator label="Loading dashboard..." />
        ) : dashboardQuery.data ? (
          renderDashboard(dashboardQuery.data)
        ) : (
          <p className="text-xs text-gray-500">Enter a User ID or authenticate, then click Load.</p>
        )
      )}

      {/* ── All Notifications Tab ────────────────────────────────────────── */}
      {activeTab === 'all' && (
        notificationsQuery.isLoading ? (
          <LoadingIndicator label="Loading notifications..." />
        ) : notificationsQuery.data ? (
          renderNotificationList(notificationsQuery.data, false)
        ) : (
          <p className="text-xs text-gray-500">Enter a User ID or leave empty for current user, then click Load.</p>
        )
      )}

      {/* ── Unread Tab ───────────────────────────────────────────────────── */}
      {activeTab === 'unread' && (
        unreadQuery.isLoading ? (
          <LoadingIndicator label="Loading unread notifications..." />
        ) : unreadQuery.data ? (
          renderNotificationList(unreadQuery.data, true)
        ) : (
          <p className="text-xs text-gray-500">Enter a User ID or leave empty for current user, then click Load.</p>
        )
      )}

      {/* ── Announcements Tab ────────────────────────────────────────────── */}
      {activeTab === 'announcements' && (
        announcementsQuery.isLoading ? (
          <LoadingIndicator label="Loading announcements..." />
        ) : announcementsQuery.data ? (
          renderAnnouncements(announcementsQuery.data)
        ) : (
          <p className="text-xs text-gray-500">Enter an Institute ID or leave empty for current user, then click Load.</p>
        )
      )}

      {/* ── Create Tab ────────────────────────────────────────────────────── */}
      {activeTab === 'create' && renderCreateForm()}

      {/* ── Bulk Tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'bulk' && renderBulkForm()}

      {/* ── Publish Tab ────────────────────────────────────────────────────── */}
      {activeTab === 'publish' && renderPublishForm()}
    </div>
  );
}
