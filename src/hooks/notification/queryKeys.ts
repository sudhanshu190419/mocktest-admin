/**
 * Notification Query Key Factory
 *
 * Centralised, stable query key definitions for the Notifications module.
 *
 * Every hook in this module derives its keys from this factory so that
 * cache invalidation is always consistent — mutating one entity never
 * accidentally invalidates another's cache.
 *
 * ## Structure
 *
 * Each entity follows the same hierarchy:
 * ```
 * <keys>.<entity>.all        → root for the entity
 * <keys>.<entity>.lists()     → all list-type queries
 * <keys>.<entity>.list(f,p)   → specific list query (keyed by params)
 * <keys>.<entity>.details()   → all detail-type queries
 * <keys>.<entity>.detail(id)  → single item query
 * ```
 *
 * @module hooks/notification/queryKeys
 */

import type { PaginationParams } from '../../types/academic';
import type {
  NotificationFilters,
  NotificationSortOptions,
} from '../../types/notification';

export const notificationKeys = {
  all: ['notifications'] as const,

  // ═════════════════════════════════════════════════════════════════════════
  //  Notifications
  // ═════════════════════════════════════════════════════════════════════════

  notifications: {
    /** Root key for all notification queries. */
    all: () => [...notificationKeys.all, 'notifications'] as const,

    /** Key for every notification list query (used for broad invalidation). */
    lists: () => [...notificationKeys.notifications.all(), 'list'] as const,

    /** Key for a specific notification list query with its params. */
    list: (
      userId: string,
      filters?: NotificationFilters,
      sort?: NotificationSortOptions,
      pagination?: PaginationParams,
    ) => [...notificationKeys.notifications.lists(), userId, filters, sort, pagination] as const,

    /** Key for every notification detail query. */
    details: () => [...notificationKeys.notifications.all(), 'detail'] as const,

    /** Key for a single notification by recipient ID. */
    detail: (id: string) => [...notificationKeys.notifications.details(), id] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Unread
  // ═════════════════════════════════════════════════════════════════════════

  unread: {
    /** Root key for all unread notification queries. */
    all: () => [...notificationKeys.all, 'unread'] as const,

    /** Key for the unread notification list for a user. */
    list: (userId: string, pagination?: PaginationParams) =>
      [...notificationKeys.unread.all(), userId, pagination] as const,

    /** Key for the unread count for a user. */
    count: (userId: string) => [...notificationKeys.unread.all(), userId, 'count'] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Announcements
  // ═════════════════════════════════════════════════════════════════════════

  announcements: {
    /** Root key for all announcement queries. */
    all: () => [...notificationKeys.all, 'announcements'] as const,

    /** Key for every announcement list query. */
    lists: () => [...notificationKeys.announcements.all(), 'list'] as const,

    /** Key for a specific announcement list query (keyed by instituteId). */
    list: (instituteId: string, pagination?: PaginationParams) =>
      [...notificationKeys.announcements.lists(), instituteId, pagination] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Dashboard Stats
  // ═════════════════════════════════════════════════════════════════════════

  dashboard: {
    /** Root key for all dashboard stat queries. */
    all: () => [...notificationKeys.all, 'dashboard'] as const,

    /** Key for the dashboard stats for a user/institute. */
    stats: (userId: string, instituteId?: string) =>
      [...notificationKeys.dashboard.all(), userId, instituteId] as const,
  },
};
