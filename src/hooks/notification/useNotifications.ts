/**
 * Notification Hooks
 *
 * React Query hooks wrapping the notificationService API calls.
 * Provides cached queries and mutations with automatic cache invalidation.
 *
 * ## Exports
 *
 * | Hook                        | Type     | Description                             |
 * |-----------------------------|----------|-----------------------------------------|
 * | `useNotifications`          | Query    | Paginated, filtered notification list   |
 * | `useUnreadNotifications`    | Query    | Unread notifications for a user         |
 * | `useNotification`           | Query    | Single notification by recipient ID     |
 * | `useMarkAsRead`             | Mutation | Mark a notification as read             |
 * | `useMarkAllAsRead`          | Mutation | Mark all notifications as read          |
 * | `useDeleteNotification`     | Mutation | Soft-delete a notification              |
 * | `useCreateNotification`     | Mutation | Create a single notification            |
 * | `useCreateBulkNotification` | Mutation | Create a bulk notification              |
 * | `useAnnouncements`          | Query    | Paginated announcements list            |
 * | `usePublishAnnouncement`    | Mutation | Publish a new announcement              |
 * | `useNotificationDashboard`  | Query    | Dashboard statistics                    |
 *
 * @module hooks/notification/useNotifications
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationKeys } from './queryKeys';
import {
  getNotifications,
  getUnreadNotifications,
  getNotification,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  createNotification,
  createBulkNotification,
  getAnnouncements,
  publishAnnouncement,
  getNotificationDashboardStats,
} from '../../services/notification/notificationService';
import type {
  Notification,
  NotificationListResult,
  NotificationFilters,
  NotificationSortOptions,
  NotificationDashboardStats,
  Announcement,
  CreateNotificationInput,
  CreateBulkNotificationInput,
  PublishAnnouncementInput,
} from '../../types/notification';
import type { PaginatedResponse, PaginationParams } from '../../types/academic';

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Fetch a paginated, filtered, and sorted list of notifications for a user.
 *
 * The query is disabled when `userId` is falsy.
 *
 * @param userId     - The profile ID of the recipient.
 * @param filters    - Optional filter criteria.
 * @param sort       - Optional sort configuration.
 * @param pagination - Optional pagination parameters.
 *
 * @example
 * const { data, isLoading } = useNotifications(
 *   'profile-uuid',
 *   { type: 'result_published', isRead: false },
 *   { sortBy: 'receivedAt', sortDirection: 'desc' },
 *   { page: 1, pageSize: 10 },
 * );
 */
export function useNotifications(
  userId: string | undefined | null,
  filters?: NotificationFilters,
  sort?: NotificationSortOptions,
  pagination?: PaginationParams,
) {
  return useQuery<NotificationListResult>({
    queryKey: notificationKeys.notifications.list(userId!, filters, sort, pagination),
    queryFn: async () => {
      const result = await getNotifications(userId!, filters, sort, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch notifications.');
      }
      return result.data!;
    },
    enabled: !!userId,
  });
}

/**
 * Fetch unread notifications for a user.
 *
 * The query is disabled when `userId` is falsy.
 *
 * @param userId     - The profile ID.
 * @param pagination - Optional pagination parameters.
 */
export function useUnreadNotifications(
  userId: string | undefined | null,
  pagination?: PaginationParams,
) {
  return useQuery<NotificationListResult>({
    queryKey: notificationKeys.unread.list(userId!, pagination),
    queryFn: async () => {
      const result = await getUnreadNotifications(userId!, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch unread notifications.');
      }
      return result.data!;
    },
    enabled: !!userId,
  });
}

/**
 * Fetch a single notification by its recipient ID.
 *
 * The query is disabled when `id` is falsy.
 *
 * @param id - The notification_recipients.recipient_id.
 */
export function useNotification(id: string | undefined | null) {
  return useQuery<Notification>({
    queryKey: notificationKeys.notifications.detail(id!),
    queryFn: async () => {
      const result = await getNotification(id!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch notification.');
      }
      return result.data!;
    },
    enabled: !!id,
  });
}

/**
 * Fetch paginated announcements for an institute.
 *
 * The query is disabled when `instituteId` is falsy.
 *
 * @param instituteId - The institute UUID.
 * @param pagination  - Optional pagination parameters.
 */
export function useAnnouncements(
  instituteId: string | undefined | null,
  pagination?: PaginationParams,
) {
  return useQuery<PaginatedResponse<Announcement>>({
    queryKey: notificationKeys.announcements.list(instituteId!, pagination),
    queryFn: async () => {
      const result = await getAnnouncements(instituteId!, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch announcements.');
      }
      return result.data!;
    },
    enabled: !!instituteId,
  });
}

/**
 * Fetch notification dashboard statistics.
 *
 * The query is disabled when `userId` is falsy.
 *
 * @param userId      - The profile ID.
 * @param instituteId - Optional institute ID.
 */
export function useNotificationDashboard(
  userId: string | undefined | null,
  instituteId?: string,
) {
  return useQuery<NotificationDashboardStats>({
    queryKey: notificationKeys.dashboard.stats(userId!, instituteId),
    queryFn: async () => {
      const result = await getNotificationDashboardStats(userId!, instituteId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch notification dashboard stats.');
      }
      return result.data!;
    },
    enabled: !!userId,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Mark a single notification as read.
 *
 * On success, invalidates the affected detail query, the list queries,
 * unread queries, and dashboard stats.
 */
export function useMarkAsRead() {
  const queryClient = useQueryClient();

  return useMutation<Notification, Error, string>({
    mutationFn: async (id) => {
      const result = await markAsRead(id);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to mark notification as read.');
      }
      return result.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.notifications.lists() });
      queryClient.invalidateQueries({ queryKey: notificationKeys.notifications.details() });
      queryClient.invalidateQueries({ queryKey: notificationKeys.unread.all() });
      queryClient.invalidateQueries({ queryKey: notificationKeys.dashboard.all() });
    },
  });
}

/**
 * Mark all notifications as read for a user.
 *
 * On success, invalidates all notification list queries, unread queries,
 * and dashboard stats.
 */
export function useMarkAllAsRead() {
  const queryClient = useQueryClient();

  return useMutation<number, Error, string>({
    mutationFn: async (userId) => {
      const result = await markAllAsRead(userId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to mark all notifications as read.');
      }
      return result.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.notifications.lists() });
      queryClient.invalidateQueries({ queryKey: notificationKeys.unread.all() });
      queryClient.invalidateQueries({ queryKey: notificationKeys.dashboard.all() });
    },
  });
}

/**
 * Soft-delete a notification event.
 *
 * On success, invalidates all notification list queries, detail queries,
 * unread queries, and dashboard stats.
 */
export function useDeleteNotification() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (notificationId) => {
      const result = await deleteNotification(notificationId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to delete notification.');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.notifications.lists() });
      queryClient.invalidateQueries({ queryKey: notificationKeys.notifications.details() });
      queryClient.invalidateQueries({ queryKey: notificationKeys.unread.all() });
      queryClient.invalidateQueries({ queryKey: notificationKeys.dashboard.all() });
      queryClient.invalidateQueries({ queryKey: notificationKeys.announcements.all() });
    },
  });
}

/**
 * Create a single notification.
 *
 * On success, invalidates all notification list queries and dashboard stats.
 */
export function useCreateNotification() {
  const queryClient = useQueryClient();

  return useMutation<Notification, Error, CreateNotificationInput>({
    mutationFn: async (input) => {
      const result = await createNotification(input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to create notification.');
      }
      return result.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.notifications.lists() });
      queryClient.invalidateQueries({ queryKey: notificationKeys.dashboard.all() });
    },
  });
}

/**
 * Create a bulk notification (one notification sent to multiple recipients).
 *
 * On success, invalidates all notification list queries and dashboard stats.
 */
export function useCreateBulkNotification() {
  const queryClient = useQueryClient();

  return useMutation<{ notificationId: string; recipientCount: number }, Error, CreateBulkNotificationInput>({
    mutationFn: async (input) => {
      const result = await createBulkNotification(input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to create bulk notification.');
      }
      return result.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.notifications.lists() });
      queryClient.invalidateQueries({ queryKey: notificationKeys.dashboard.all() });
    },
  });
}

/**
 * Publish a new announcement.
 *
 * On success, invalidates announcement list queries and dashboard stats.
 */
export function usePublishAnnouncement() {
  const queryClient = useQueryClient();

  return useMutation<{ notificationId: string }, Error, PublishAnnouncementInput>({
    mutationFn: async (input) => {
      const result = await publishAnnouncement(input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to publish announcement.');
      }
      return result.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.announcements.lists() });
      queryClient.invalidateQueries({ queryKey: notificationKeys.dashboard.all() });
    },
  });
}
