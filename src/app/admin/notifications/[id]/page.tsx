'use client';

import { useState, useCallback, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import {
  useNotification,
  useMarkAsRead,
  useDeleteNotification,
} from '@/hooks/notification/useNotifications';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  notificationIcon,
  notificationTypeLabel,
  buildActionUrl,
  formatNotificationTime,
  priorityColor,
  priorityLabel,
} from '@/utils/notification';

// ─── Stat Block ─────────────────────────────────────────────────────────────

function StatBlock({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800/30">
      <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`mt-0.5 text-lg font-bold ${color ?? 'text-gray-900 dark:text-gray-100'}`}>{value}</p>
    </div>
  );
}

// ─── Timeline Event ─────────────────────────────────────────────────────────

function TimelineEvent({ icon, label, description, timestamp, isActive }: {
  icon: string;
  label: string;
  description: string;
  timestamp: string;
  isActive?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-col items-center">
        <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs ${
          isActive ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-800'
        }`}>
          {icon}
        </div>
        <div className="mt-1 h-full w-px bg-gray-200 dark:bg-gray-700" />
      </div>
      <div className="pb-6">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</p>
        <p className="text-xs text-gray-500">{description}</p>
        <p className="mt-0.5 text-[10px] text-gray-400">{formatNotificationTime(timestamp)}</p>
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function AdminNotificationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();

  const recipientId = params?.id as string;

  const { data: notification, isLoading, error } = useNotification(recipientId);
  const markAsRead = useMarkAsRead();
  const deleteNotification = useDeleteNotification();

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDelete = useCallback(() => {
    if (notification) {
      deleteNotification.mutate(notification.notificationId, {
        onSuccess: () => router.push('/admin/notifications'),
      });
    }
    setShowDeleteConfirm(false);
  }, [notification, deleteNotification, router]);

  // Auto-mark as read on first view
  useEffect(() => {
    if (notification && !notification.isRead) {
      markAsRead.mutate(notification.id);
    }
  }, [notification?.id, notification?.isRead]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-60 w-full" />
      </div>
    );
  }

  if (error || !notification) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <span className="text-4xl">🔔</span>
        <p className="mt-4 text-lg font-semibold text-gray-900 dark:text-gray-100">Notification not found</p>
        <p className="mt-1 text-sm text-gray-500">This notification may have been deleted or is no longer available.</p>
        <Link
          href="/admin/notifications"
          className="mt-6 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Back to Notifications
        </Link>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={notification.title}
        description={`${notificationTypeLabel(notification.type)} · ${formatNotificationTime(notification.receivedAt)}`}
        breadcrumbs={[
          { label: 'Notifications', href: '/admin/notifications' },
          { label: notification.title },
        ]}
        actions={
          <div className="flex items-center gap-2">
            {!notification.isRead && (
              <button
                type="button"
                onClick={() => markAsRead.mutate(notification.id)}
                disabled={markAsRead.isPending}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {markAsRead.isPending ? 'Marking...' : 'Mark as Read'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={deleteNotification.isPending}
              className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        }
      />

      {/* Main Content */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left — Notification Body */}
        <div className="space-y-6 lg:col-span-2">
          {/* Details Card */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-gray-100 text-2xl dark:bg-gray-800">
                {notificationIcon(notification.type)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{notification.title}</h2>
                  {!notification.isRead && <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-medium ${priorityColor(notification.priority)}`}>
                    {priorityLabel(notification.priority)}
                  </span>
                  <span className="text-xs text-gray-400">{notificationTypeLabel(notification.type)}</span>
                </div>
              </div>
            </div>

            <div className="mt-5 border-t border-gray-100 pt-4 dark:border-gray-700">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                {notification.message}
              </p>
            </div>

            {/* Metadata */}
            <div className="mt-5 grid grid-cols-2 gap-3 border-t border-gray-100 pt-4 sm:grid-cols-3 dark:border-gray-700">
              <StatBlock label="Type" value={notificationTypeLabel(notification.type)} />
              <StatBlock label="Priority" value={priorityLabel(notification.priority)} color={notification.priority === 'critical' ? 'text-red-500' : notification.priority === 'high' ? 'text-amber-500' : notification.priority === 'normal' ? 'text-blue-500' : 'text-gray-500'} />
              <StatBlock label="Channel" value={notification.channel === 'in_app' ? 'In-App' : notification.channel === 'push' ? 'Push' : notification.channel === 'email' ? 'Email' : 'SMS'} />
              <StatBlock label="Status" value={notification.isRead ? 'Read' : 'Unread'} color={notification.isRead ? 'text-emerald-500' : 'text-blue-500'} />
              <StatBlock label="Received" value={formatNotificationTime(notification.receivedAt)} />
              <StatBlock label="Read At" value={notification.readAt ? formatNotificationTime(notification.readAt) : '—'} />
            </div>

            {/* Reference Link */}
            {(() => {
              const actionUrl =
                buildActionUrl(notification.referenceType, notification.referenceId, 'admin') ??
                (notification.actionUrl && notification.actionUrl.startsWith('/') ? notification.actionUrl : null);
              if (!actionUrl) return null;
              return (
                <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 dark:border-blue-900/30 dark:bg-blue-900/10">
                  <p className="text-xs font-medium text-blue-700 dark:text-blue-400">Related Resource</p>
                  <Link
                    href={actionUrl}
                    className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    View{' '}
                    {notification.referenceType === 'mock_test'
                      ? 'Mock Test'
                      : notification.referenceType === 'result'
                      ? 'Result'
                      : notification.referenceType === 'content'
                      ? 'Content'
                      : notification.referenceType === 'student_doubt' || notification.referenceType === 'doubt'
                      ? 'Doubt'
                      : notification.referenceType === 'order'
                      ? 'Order'
                      : notification.referenceType === 'course'
                      ? 'Course'
                      : notification.referenceType === 'pyq_package' || notification.referenceType === 'pyq'
                      ? 'PYQ Package'
                      : notification.referenceType === 'question'
                      ? 'Question'
                      : notification.referenceType === 'batch'
                      ? 'Batch'
                      : notification.referenceType === 'trusted_devices' ||
                        notification.referenceType === 'trusted_device' ||
                        notification.referenceType === 'device'
                      ? 'Trusted Device'
                      : notification.referenceType === 'teacher_leave_request' ||
                        notification.referenceType === 'leave_request' ||
                        notification.referenceType === 'leave'
                      ? 'Leave Request'
                      : notification.referenceType === 'subscription' ||
                        notification.referenceType === 'subscription_plan'
                      ? 'Subscription'
                      : 'Resource'}{' '}
                    →
                  </Link>
                </div>
              );
            })()}
          </div>

          {/* Timeline */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Timeline</h3>
            <div className="pl-2">
              <TimelineEvent
                icon="📨"
                label="Notification Created"
                description={notification.title}
                timestamp={notification.createdAt}
                isActive
              />
              <TimelineEvent
                icon="📥"
                label="Notification Received"
                description="Delivered to inbox"
                timestamp={notification.receivedAt}
                isActive
              />
              <TimelineEvent
                icon={notification.isRead ? '👁️' : '🕐'}
                label={notification.isRead ? 'Notification Read' : 'Awaiting Read'}
                description={notification.isRead ? 'This notification was read' : 'Not yet read'}
                timestamp={notification.readAt ?? notification.receivedAt}
                isActive={!!notification.isRead}
              />
            </div>
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="space-y-6">
          {/* Actions Card */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Actions</h3>
            <div className="space-y-2">
              {!notification.isRead && (
                <button
                  type="button"
                  onClick={() => markAsRead.mutate(notification.id)}
                  disabled={markAsRead.isPending}
                  className="flex w-full items-center gap-2 rounded-lg bg-emerald-50 px-4 py-2.5 text-left text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 dark:bg-emerald-900/20 dark:text-emerald-400 dark:hover:bg-emerald-900/30"
                >
                  ✓ Mark as Read
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={deleteNotification.isPending}
                className="flex w-full items-center gap-2 rounded-lg bg-rose-50 px-4 py-2.5 text-left text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50 dark:bg-rose-900/20 dark:text-rose-400 dark:hover:bg-rose-900/30"
              >
                🗑️ Delete
              </button>
            </div>
          </div>

          {/* Info Card */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Details</h3>
            <div className="space-y-3 text-xs">
              <div>
                <p className="text-gray-500">Notification ID</p>
                <p className="font-mono text-gray-900 dark:text-gray-100">{notification.notificationId.slice(0, 16)}...</p>
              </div>
              <div>
                <p className="text-gray-500">Recipient ID</p>
                <p className="font-mono text-gray-900 dark:text-gray-100">{notification.id.slice(0, 16)}...</p>
              </div>
              <div>
                <p className="text-gray-500">Reference</p>
                <p className="text-gray-900 dark:text-gray-100">
                  {notification.referenceType
                    ? `${notification.referenceType} · ${notification.referenceId?.slice(0, 12)}...`
                    : 'None'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="Delete Notification"
        message="This will soft-delete this notification event. It will be hidden from all recipients. Are you sure?"
        confirmLabel="Delete"
        variant="danger"
        loading={deleteNotification.isPending}
      />
    </div>
  );
}
