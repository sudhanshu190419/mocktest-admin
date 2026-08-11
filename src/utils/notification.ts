/**
 * Notification Utilities
 *
 * Shared helper functions for notification display, formatting, and
 * manipulation. These utilities have zero business logic — they are
 * pure functions that transform data for presentation.
 *
 * @module utils/notification
 */

import type { NotificationPriority, NotificationType } from '../types/notification';

// ─── Time Formatting ─────────────────────────────────────────────────────────

/**
 * Formats a notification timestamp into a human-readable relative string.
 *
 * - < 1 minute: "Just now"
 * - < 1 hour: "Xm ago"
 * - < 1 day: "Xh ago"
 * - < 7 days: "Xd ago"
 * - < 30 days: "Xw ago"
 * - Otherwise: locale date string
 *
 * @param dateStr - ISO-8601 timestamp string.
 * @returns Formatted time string.
 */
export function formatNotificationTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '';

  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);

  if (diffSeconds < 60) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffWeeks < 4) return `${diffWeeks}w ago`;

  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// ─── Priority Helpers ────────────────────────────────────────────────────────

/**
 * Maps a notification priority to a Tailwind colour class.
 *
 * @param priority - The notification priority level.
 * @returns A Tailwind CSS colour class string.
 */
export function priorityColor(priority: NotificationPriority): string {
  switch (priority) {
    case 'critical':
      return 'text-red-400 bg-red-950/30 border-red-700/50';
    case 'high':
      return 'text-amber-400 bg-amber-950/30 border-amber-700/50';
    case 'normal':
      return 'text-blue-400 bg-blue-950/30 border-blue-700/50';
    case 'low':
      return 'text-gray-400 bg-gray-900 border-gray-700';
    default:
      return 'text-gray-400 bg-gray-900 border-gray-700';
  }
}

/**
 * Returns a human-readable label for the priority level.
 */
export function priorityLabel(priority: NotificationPriority): string {
  switch (priority) {
    case 'critical':
      return 'Critical';
    case 'high':
      return 'High';
    case 'normal':
      return 'Normal';
    case 'low':
      return 'Low';
    default:
      return 'Unknown';
  }
}

// ─── Icon Helpers ────────────────────────────────────────────────────────────

/**
 * Returns an emoji icon for a given notification type.
 *
 * @param type - The notification event type.
 * @returns An emoji string representing the notification type.
 */
export function notificationIcon(type: NotificationType): string {
  switch (type) {
    case 'mock_test_assigned':
      return '📝';
    case 'mock_test_reminder':
      return '⏰';
    case 'mock_test_submitted':
      return '📤';
    case 'result_published':
      return '📊';
    case 'new_content_uploaded':
      return '📄';
    case 'chapter_added':
      return '📖';
    case 'subject_added':
      return '📚';
    case 'new_mock_test_available':
      return '🆕';
    case 'announcement':
      return '📢';
    case 'general_message':
      return '💬';
    case 'warning':
      return '⚠️';
    case 'success':
      return '✅';
    case 'error':
      return '❌';
    case 'live_class_reminder':
      return '🎓';
    case 'live_class_started':
      return '🔴';
    case 'content_approved':
      return '👍';
    case 'content_rejected':
      return '👎';
    case 'subscription_expiring':
      return '🕐';
    case 'subscription_expired':
      return '🚫';
    case 'batch_assigned':
      return '👥';
    case 'doubt_submitted':
      return '❓';
    case 'doubt_assigned':
      return '📥';
    case 'doubt_answered':
      return '✅';
    case 'doubt_follow_up':
      return '💬';
    case 'doubt_resolved':
      return '🎉';
    case 'doubt_reopened':
      return '🔄';
    case 'doubt_unassigned':
      return '⚠️';
    case 'custom':
      return '🔔';
    default:
      return '🔔';
  }
}

/**
 * Returns a human-readable label for a notification type.
 */
export function notificationTypeLabel(type: NotificationType): string {
  switch (type) {
    case 'mock_test_assigned':
      return 'Mock Test Assigned';
    case 'mock_test_reminder':
      return 'Mock Test Reminder';
    case 'mock_test_submitted':
      return 'Mock Test Submitted';
    case 'result_published':
      return 'Result Published';
    case 'new_content_uploaded':
      return 'New Content Uploaded';
    case 'chapter_added':
      return 'Chapter Added';
    case 'subject_added':
      return 'Subject Added';
    case 'new_mock_test_available':
      return 'New Mock Test Available';
    case 'announcement':
      return 'Announcement';
    case 'general_message':
      return 'General Message';
    case 'warning':
      return 'Warning';
    case 'success':
      return 'Success';
    case 'error':
      return 'Error';
    case 'live_class_reminder':
      return 'Live Class Reminder';
    case 'live_class_started':
      return 'Live Class Started';
    case 'content_approved':
      return 'Content Approved';
    case 'content_rejected':
      return 'Content Rejected';
    case 'subscription_expiring':
      return 'Subscription Expiring';
    case 'subscription_expired':
      return 'Subscription Expired';
    case 'batch_assigned':
      return 'Batch Assigned';
    case 'doubt_submitted':
      return 'New Doubt';
    case 'doubt_assigned':
      return 'Doubt Assigned';
    case 'doubt_answered':
      return 'Doubt Answered';
    case 'doubt_follow_up':
      return 'Doubt Follow-up';
    case 'doubt_resolved':
      return 'Doubt Resolved';
    case 'doubt_reopened':
      return 'Doubt Reopened';
    case 'doubt_unassigned':
      return 'Doubt Needs Assignment';
    case 'custom':
      return 'Custom';
    default:
      return 'Unknown';
  }
}

// ─── Grouping & Counting ────────────────────────────────────────────────────

/**
 * Groups a list of notifications by their creation date.
 *
 * Returns a map where keys are date strings (YYYY-MM-DD) and values are
 * arrays of notifications created on that date.
 *
 * @param notifications - Array of notification objects.
 * @returns A map of date keys to notification arrays.
 */
export function groupNotificationsByDate(
  notifications: { createdAt: string }[],
): Map<string, { createdAt: string }[]> {
  const groups = new Map<string, { createdAt: string }[]>();

  for (const notification of notifications) {
    const date = new Date(notification.createdAt);
    const key = date.toISOString().slice(0, 10); // YYYY-MM-DD

    const existing = groups.get(key);
    if (existing) {
      existing.push(notification);
    } else {
      groups.set(key, [notification]);
    }
  }

  return groups;
}

/**
 * Computes the count of unread notifications from a list.
 *
 * @param notifications - Array of notification objects with `isRead` field.
 * @returns The number of unread notifications.
 */
export function unreadCount(notifications: { isRead: boolean }[]): number {
  return notifications.filter((n) => !n.isRead).length;
}

/**
 * Builds an action URL from a reference type and reference ID.
 *
 * Doubt notifications (migration 117/118) deep-link to the doubt detail
 * page. The audience decides between the teacher page (default — teacher
 * and admin can both pass the teacher RoleGuard) and the admin page (so an
 * admin receiving a doubt_unassigned fallback notification lands where
 * assign/reassign is available). All other reference types are audience-
 * independent.
 *
 * @param referenceType - Entity type (e.g. 'mock_test', 'content').
 * @param referenceId   - Entity UUID.
 * @param audience      - 'teacher' (default) | 'admin' — only affects
 *                        'student_doubt' reference type.
 * @returns A relative URL path or null if either parameter is missing.
 */
export function buildActionUrl(
  referenceType: string | null,
  referenceId: string | null,
  audience: 'teacher' | 'admin' = 'teacher',
): string | null {
  if (!referenceType || !referenceId) return null;

  switch (referenceType) {
    case 'mock_test':
      return `/mock-tests/${referenceId}`;
    case 'content':
      return `/content/${referenceId}`;
    case 'live_class':
      return `/live-classes/${referenceId}`;
    case 'result':
      return `/results/${referenceId}`;
    case 'attempt':
      return `/attempts/${referenceId}`;
    case 'order':
      return `/orders/${referenceId}`;
    case 'student_doubt':
      // Students consume doubts on the mobile app (own deep links); the web
      // audience is teacher or admin. Admin deep-links to /admin/doubts so
      // assignment actions are immediately available.
      return audience === 'admin'
        ? `/admin/doubts/${referenceId}`
        : `/teacher/doubts/${referenceId}`;
    default:
      return `/${referenceType}/${referenceId}`;
  }
}

// ─── Priority Inference ──────────────────────────────────────────────────────

/**
 * Infers the appropriate priority level from a notification type.
 *
 * @param type - The notification event type.
 * @returns The inferred priority level.
 */
export function inferPriority(type: NotificationType): NotificationPriority {
  switch (type) {
    case 'error':
    case 'warning':
    case 'subscription_expired':
      return 'high';
    case 'result_published':
    case 'mock_test_submitted':
    case 'subscription_expiring':
      return 'normal';
    case 'announcement':
    case 'general_message':
    case 'success':
      return 'low';
    default:
      return 'normal';
  }
}
