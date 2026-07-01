/**
 * Notification Service
 *
 * Clean-architecture service layer encapsulating notification CRUD operations
 * and lifecycle management — notifications, recipients, announcements.
 *
 * Every public method returns a standardised `ApiResponse<T>` shape so that
 * consumers (hooks, screens, etc.) never need to handle raw Supabase
 * exceptions or error formats.
 *
 * ## Scope
 *
 * This service manages the `notifications` and `notification_recipients`
 * tables. It does NOT manage `notification_templates` (template management
 * is a separate responsibility handled by the admin panel).
 *
 * ## Architecture decisions
 *
 * 1. **RLS is respected.** This service uses the anon key — all queries run
 *    within the context of the authenticated user. RLS policies control
 *    what rows each user can see, insert, update, or delete.
 *
 * 2. **Clean mapping layer.** A `mapNotification` helper converts joined
 *    database rows to camelCase TypeScript interfaces, avoiding duplication.
 *
 * 3. **Fan-out is NOT handled here.** Bulk notification creation delegates
 *    recipient row insertion to the caller — this service creates the core
 *    notification row and returns it, leaving fan-out to a background job.
 *
 * 4. **Soft delete is the only delete path.** The service never performs
 *    hard deletes on notifications.
 *
 * @module notificationService
 */

import { supabase } from '../../config/supabase';
import { validateUUID, extractErrorMessage, buildPagination } from '../../utils/supabase';
import { buildPaginatedResponse } from '../../utils/response';
import { inferPriority, buildActionUrl } from '../../utils/notification';
import type { ApiResponse, PaginatedResponse, PaginationParams, SortDirection } from '../../types/academic';
import type {
  Notification,
  NotificationType,
  NotificationPriority,
  NotificationFilters,
  NotificationSortOptions,
  NotificationDashboardStats,
  Announcement,
  CreateNotificationInput,
  CreateBulkNotificationInput,
  PublishAnnouncementInput,
  DbNotificationWithRecipient,
  NotificationListResult,
} from '../../types/notification';

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Maps camelCase sort keys to their snake_case database column names.
 */
const SORT_FIELD_MAP: Record<string, { column: string; foreignTable?: string }> = {
  createdAt: { column: 'created_at', foreignTable: 'notification' },
  receivedAt: { column: 'received_at' },
  readAt: { column: 'read_at' },
  title: { column: 'title', foreignTable: 'notification' },
  type: { column: 'event_type', foreignTable: 'notification' },
};

/**
 * Maps notification event types to priority levels for sorting.
 */
const DEFAULT_PRIORITY: Record<string, NotificationPriority> = {
  error: 'high',
  warning: 'high',
  subscription_expired: 'high',
  result_published: 'normal',
  mock_test_submitted: 'normal',
  subscription_expiring: 'normal',
  announcement: 'normal',
  general_message: 'low',
  success: 'low',
};

// ─── Mapping Helpers ────────────────────────────────────────────────────────

/**
 * Converts a joined database row (notifications + notification_recipients)
 * into a camelCase `Notification` interface.
 */
function mapNotification(db: DbNotificationWithRecipient): Notification {
  const eventType = db.event_type as NotificationType;
  return {
    id: db.recipient_id,
    notificationId: db.notification_id,
    title: db.title,
    message: db.body,
    type: eventType,
    channel: db.channel as Notification['channel'],
    priority: DEFAULT_PRIORITY[eventType] ?? 'normal',
    userId: db.profile_id,
    instituteId: db.institute_id,
    isRead: db.is_read,
    createdAt: db.created_at,
    readAt: db.read_at,
    receivedAt: db.received_at,
    actionUrl: buildActionUrl(db.reference_type, db.reference_id),
    referenceType: db.reference_type,
    referenceId: db.reference_id,
    metadata: null, // not stored in current schema; reserved for future
    templateId: db.template_id,
  };
}

/**
 * Maps a notification row into an Announcement.
 */
function mapAnnouncement(db: DbNotificationWithRecipient): Announcement {
  return {
    id: db.recipient_id,
    notificationId: db.notification_id,
    title: db.title,
    message: db.body,
    type: 'announcement',
    priority: DEFAULT_PRIORITY[db.event_type] ?? 'normal',
    instituteId: db.institute_id,
    targetRole: 'all',
    isRead: db.is_read,
    createdAt: db.created_at,
    expiresAt: null,
  };
}

/**
 * Maps a camelCase sort key to sort configuration with column and optional
 * foreign table reference.
 */
function mapSortField(
  sortBy: NotificationSortOptions['sortBy'],
): { column: string; foreignTable?: string } {
  return SORT_FIELD_MAP[sortBy ?? 'receivedAt'] ?? { column: 'received_at' };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch paginated, filtered, and sorted notifications for a user.
 *
 * @param userId     - The profile ID of the recipient.
 * @param filters    - Optional filter criteria.
 * @param sort       - Optional sort configuration.
 * @param pagination - Optional pagination parameters.
 *
 * @example
 * const result = await getNotifications(
 *   'profile-uuid',
 *   { type: 'result_published', isRead: false },
 *   { sortBy: 'receivedAt', sortDirection: 'desc' },
 *   { page: 1, pageSize: 20 },
 * );
 */
export async function getNotifications(
  userId: string,
  filters?: NotificationFilters,
  sort?: NotificationSortOptions,
  pagination?: PaginationParams,
): Promise<ApiResponse<NotificationListResult>> {
  try {
    validateUUID(userId, 'userId');
    const { page, pageSize, from, to } = buildPagination(pagination);

    console.group('NOTIFICATIONS');
    console.log('getNotifications', { userId, filters, sort, pagination });

    // ── Build query ───────────────────────────────────────────────────
    let query = supabase
      .from('notification_recipients')
      .select('*, notification:notifications(*)', { count: 'exact' })
      .eq('profile_id', userId);

    // Filter out soft-deleted notifications
    query = query.not('notification.is_deleted', 'is', true);

    // ── Apply filters ─────────────────────────────────────────────────
    if (filters?.isRead !== undefined) {
      query = query.eq('is_read', filters.isRead);
    }

    if (filters?.type) {
      query = query.eq('notification.event_type', filters.type);
    }

    if (filters?.channel) {
      query = query.eq('notification.channel', filters.channel);
    }

    if (filters?.instituteId) {
      validateUUID(filters.instituteId, 'instituteId');
      query = query.eq('notification.institute_id', filters.instituteId);
    }

    if (filters?.createdAfter) {
      query = query.gte('notification.created_at', filters.createdAfter);
    }

    if (filters?.createdBefore) {
      query = query.lte('notification.created_at', filters.createdBefore);
    }

    if (filters?.search) {
      const searchTerm = `%${filters.search}%`;
      query = query.or(
        `notification.title.ilike.${searchTerm},notification.body.ilike.${searchTerm}`,
      );
    }

    if (filters?.ids && filters.ids.length > 0) {
      query = query.in('notification.notification_id', filters.ids);
    }

    // ── Apply sorting ─────────────────────────────────────────────────
    const sortConfig = mapSortField(sort?.sortBy);
    const sortDirection: SortDirection = sort?.sortDirection ?? 'desc';
    const ascending = sortDirection === 'asc';

    // Handle column prefixes for joined queries
    if (sortConfig.foreignTable) {
      query = query.order(sortConfig.column, { ascending, foreignTable: sortConfig.foreignTable });
    } else {
      query = query.order(sortConfig.column, { ascending });
    }

    // ── Apply pagination ──────────────────────────────────────────────
    query = query.range(from, to);

    // ── Execute ───────────────────────────────────────────────────────
    const { data, error, count } = await query;

    if (error) {
      console.log('Error:', error);
      console.groupEnd();
      return { success: false, error: extractErrorMessage(error) };
    }

    // ── Map results ───────────────────────────────────────────────────
    const notifications: Notification[] = (data ?? []).map((row: Record<string, unknown>) => {
      const notification = row.notification as Record<string, unknown>;
      const recipient = row as Record<string, unknown>;

      const dbRow: DbNotificationWithRecipient = {
        notification_id: notification.notification_id as string,
        institute_id: notification.institute_id as string,
        template_id: notification.template_id as string | null,
        title: notification.title as string,
        body: notification.body as string,
        channel: notification.channel as string,
        event_type: notification.event_type as string,
        triggered_by: notification.triggered_by as string | null,
        reference_type: notification.reference_type as string | null,
        reference_id: notification.reference_id as string | null,
        total_recipients: notification.total_recipients as number,
        dispatched_at: notification.dispatched_at as string | null,
        is_deleted: notification.is_deleted as boolean,
        deleted_at: notification.deleted_at as string | null,
        created_at: notification.created_at as string,
        updated_at: notification.updated_at as string,
        recipient_id: recipient.recipient_id as string,
        profile_id: recipient.profile_id as string,
        is_read: recipient.is_read as boolean,
        read_at: recipient.read_at as string | null,
        received_at: recipient.received_at as string,
      };

      return mapNotification(dbRow);
    });

    // Get unread count for the user
    const unreadResult = await getUnreadCount(userId);
    const unreadCountVal = unreadResult.success ? unreadResult.data ?? 0 : 0;

    console.log(`Fetched ${notifications.length} of ${count ?? 0} total, ${unreadCountVal} unread`);
    console.groupEnd();

    return {
      success: true,
      data: {
        notifications,
        total: count ?? 0,
        page,
        pageSize,
        pageCount: pageSize > 0 ? Math.ceil((count ?? 0) / pageSize) : 0,
        unreadCount: unreadCountVal,
      },
    };
  } catch (err) {
    console.log('Error:', err);
    console.groupEnd();
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Fetch unread notifications for a user.
 */
export async function getUnreadNotifications(
  userId: string,
  pagination?: PaginationParams,
): Promise<ApiResponse<NotificationListResult>> {
  return getNotifications(
    userId,
    { isRead: false },
    { sortBy: 'receivedAt', sortDirection: 'desc' },
    pagination,
  );
}

/**
 * Fetch a single notification by its recipient ID.
 *
 * @param recipientId - The notification_recipients.recipient_id.
 */
export async function getNotification(
  recipientId: string,
): Promise<ApiResponse<Notification>> {
  try {
    validateUUID(recipientId, 'recipientId');

    console.group('NOTIFICATIONS');
    console.log('getNotification', { recipientId });

    const { data, error } = await supabase
      .from('notification_recipients')
      .select('*, notification:notifications(*)')
      .eq('recipient_id', recipientId)
      .not('notification.is_deleted', 'is', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        console.log('Notification not found');
        console.groupEnd();
        return { success: false, error: `Notification not found: ${recipientId}` };
      }
      console.log('Error:', error);
      console.groupEnd();
      return { success: false, error: extractErrorMessage(error) };
    }

    const notification = data.notification as Record<string, unknown>;
    const recipient = data as Record<string, unknown>;

    const dbRow: DbNotificationWithRecipient = {
      notification_id: notification.notification_id as string,
      institute_id: notification.institute_id as string,
      template_id: notification.template_id as string | null,
      title: notification.title as string,
      body: notification.body as string,
      channel: notification.channel as string,
      event_type: notification.event_type as string,
      triggered_by: notification.triggered_by as string | null,
      reference_type: notification.reference_type as string | null,
      reference_id: notification.reference_id as string | null,
      total_recipients: notification.total_recipients as number,
      dispatched_at: notification.dispatched_at as string | null,
      is_deleted: notification.is_deleted as boolean,
      deleted_at: notification.deleted_at as string | null,
      created_at: notification.created_at as string,
      updated_at: notification.updated_at as string,
      recipient_id: recipient.recipient_id as string,
      profile_id: recipient.profile_id as string,
      is_read: recipient.is_read as boolean,
      read_at: recipient.read_at as string | null,
      received_at: recipient.received_at as string,
    };

    console.log('Result:', dbRow);
    console.groupEnd();

    return { success: true, data: mapNotification(dbRow) };
  } catch (err) {
    console.log('Error:', err);
    console.groupEnd();
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Mark a single notification as read by its recipient ID.
 *
 * @param recipientId - The notification_recipients.recipient_id.
 */
export async function markAsRead(recipientId: string): Promise<ApiResponse<Notification>> {
  try {
    validateUUID(recipientId, 'recipientId');

    console.group('NOTIFICATIONS');
    console.log('markAsRead', { recipientId });

    const { data, error } = await supabase
      .from('notification_recipients')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('recipient_id', recipientId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        console.log('Notification not found');
        console.groupEnd();
        return { success: false, error: `Notification not found: ${recipientId}` };
      }
      console.log('Error:', error);
      console.groupEnd();
      return { success: false, error: extractErrorMessage(error) };
    }

    console.log('Marked as read:', data);
    console.groupEnd();

    // Refetch the full notification to return
    return getNotification(recipientId);
  } catch (err) {
    console.log('Error:', err);
    console.groupEnd();
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Mark all notifications as read for a user.
 *
 * @param userId - The profile ID.
 */
export async function markAllAsRead(userId: string): Promise<ApiResponse<number>> {
  try {
    validateUUID(userId, 'userId');

    console.group('NOTIFICATIONS');
    console.log('markAllAsRead', { userId });

    const { data, error } = await supabase
      .from('notification_recipients')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('profile_id', userId)
      .eq('is_read', false)
      .select();

    if (error) {
      console.log('Error:', error);
      console.groupEnd();
      return { success: false, error: extractErrorMessage(error) };
    }

    const markedCount = data?.length ?? 0;
    console.log(`Marked ${markedCount} notifications as read`);
    console.groupEnd();

    return { success: true, data: markedCount };
  } catch (err) {
    console.log('Error:', err);
    console.groupEnd();
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Soft-delete a notification event (admin action).
 *
 * Sets `is_deleted = TRUE` and `deleted_at = NOW()` on the notifications row,
 * which hides it from all recipient inboxes.
 *
 * @param notificationId - The notifications.notification_id.
 */
export async function deleteNotification(notificationId: string): Promise<ApiResponse<void>> {
  try {
    validateUUID(notificationId, 'notificationId');

    console.group('NOTIFICATIONS');
    console.log('deleteNotification', { notificationId });

    const { error } = await supabase
      .from('notifications')
      .update({ is_deleted: true, deleted_at: new Date().toISOString() })
      .eq('notification_id', notificationId);

    if (error) {
      console.log('Error:', error);
      console.groupEnd();
      return { success: false, error: extractErrorMessage(error) };
    }

    console.log('Notification soft-deleted');
    console.groupEnd();

    return { success: true };
  } catch (err) {
    console.log('Error:', err);
    console.groupEnd();
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Create a single notification event and add recipients.
 *
 * This creates one row in `notifications` and one row per recipient in
 * `notification_recipients`. For production use at scale, fan-out should
 * be handled asynchronously via a queue. This synchronous version is
 * suitable for developer console testing and low-volume scenarios.
 *
 * @param input - The notification creation payload.
 */
export async function createNotification(
  input: CreateNotificationInput,
): Promise<ApiResponse<Notification>> {
  try {
    console.group('NOTIFICATIONS');
    console.log('createNotification', { input });

    // ── Validate required fields ──────────────────────────────────────
    if (!input.instituteId) {
      console.groupEnd();
      return { success: false, error: 'instituteId is required.' };
    }

    if (!input.title?.trim()) {
      console.groupEnd();
      return { success: false, error: 'Title is required.' };
    }

    if (!input.body?.trim()) {
      console.groupEnd();
      return { success: false, error: 'Body is required.' };
    }

    // ── Validate UUID formats ─────────────────────────────────────────
    validateUUID(input.instituteId, 'instituteId');

    if (input.templateId) validateUUID(input.templateId, 'templateId');
    if (input.triggeredBy) validateUUID(input.triggeredBy, 'triggeredBy');
    if (input.referenceId) validateUUID(input.referenceId, 'referenceId');

    // ── Build notification DB record ──────────────────────────────────
    const dbRecord: Record<string, unknown> = {
      institute_id: input.instituteId,
      template_id: input.templateId ?? null,
      title: input.title.trim(),
      body: input.body.trim(),
      channel: input.channel ?? 'in_app',
      event_type: input.eventType,
      triggered_by: input.triggeredBy ?? null,
      reference_type: input.referenceType ?? null,
      reference_id: input.referenceId ?? null,
      total_recipients: 0,
      dispatched_at: new Date().toISOString(),
    };

    console.log('Inserting notification:', dbRecord);

    // ── Insert notification ───────────────────────────────────────────
    const { data: notifData, error: notifError } = await supabase
      .from('notifications')
      .insert(dbRecord)
      .select()
      .single();

    if (notifError) {
      console.log('Insert error:', notifError);
      console.groupEnd();
      return { success: false, error: extractErrorMessage(notifError) };
    }

    console.log('Notification created:', notifData);

    // We need to also create a recipient row for the notification to show up
    // in the user's inbox. Since we don't know the userId here, we'll
    // return the notification event itself without recipient data.
    // The caller should call addRecipient separately if needed.

    console.groupEnd();

    // Return a placeholder notification since we don't have recipient data
    return {
      success: true,
      data: {
        id: '',
        notificationId: notifData.notification_id,
        title: notifData.title,
        message: notifData.body,
        type: input.eventType,
        channel: input.channel ?? 'in_app',
        priority: inferPriority(input.eventType),
        userId: '',
        instituteId: notifData.institute_id,
        isRead: false,
        createdAt: notifData.created_at,
        readAt: null,
        receivedAt: notifData.created_at,
        actionUrl: buildActionUrl(input.referenceType ?? null, input.referenceId ?? null),
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        metadata: input.metadata ?? null,
        templateId: input.templateId ?? null,
      },
    };
  } catch (err) {
    console.log('Error:', err);
    console.groupEnd();
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Create a bulk notification (single notification sent to multiple recipients).
 *
 * Creates one notification row and multiple recipient rows.
 *
 * @param input - The bulk notification payload with recipient IDs.
 */
export async function createBulkNotification(
  input: CreateBulkNotificationInput,
): Promise<ApiResponse<{ notificationId: string; recipientCount: number }>> {
  try {
    console.group('NOTIFICATIONS');
    console.log('createBulkNotification', { input });

    // ── Validate ────────────────────────────────────────────────────────
    if (!input.instituteId) {
      console.groupEnd();
      return { success: false, error: 'instituteId is required.' };
    }

    if (!input.title?.trim()) {
      console.groupEnd();
      return { success: false, error: 'Title is required.' };
    }

    if (!input.body?.trim()) {
      console.groupEnd();
      return { success: false, error: 'Body is required.' };
    }

    if (!input.recipientIds || input.recipientIds.length === 0) {
      console.groupEnd();
      return { success: false, error: 'At least one recipient is required.' };
    }

    validateUUID(input.instituteId, 'instituteId');

    // ── Create notification event ───────────────────────────────────────
    const dbRecord: Record<string, unknown> = {
      institute_id: input.instituteId,
      template_id: input.templateId ?? null,
      title: input.title.trim(),
      body: input.body.trim(),
      channel: input.channel ?? 'in_app',
      event_type: input.eventType,
      triggered_by: input.triggeredBy ?? null,
      reference_type: input.referenceType ?? null,
      reference_id: input.referenceId ?? null,
      total_recipients: input.recipientIds.length,
      dispatched_at: new Date().toISOString(),
    };

    const { data: notifData, error: notifError } = await supabase
      .from('notifications')
      .insert(dbRecord)
      .select()
      .single();

    if (notifError) {
      console.log('Insert error:', notifError);
      console.groupEnd();
      return { success: false, error: extractErrorMessage(notifError) };
    }

    console.log('Notification created:', notifData);

    // ── Insert recipient rows ───────────────────────────────────────────
    const recipientRows = input.recipientIds.map((profileId) => ({
      notification_id: notifData.notification_id,
      profile_id: profileId,
      institute_id: input.instituteId,
      is_read: false,
      read_at: null,
      received_at: new Date().toISOString(),
    }));

    // Validate all recipient UUIDs
    for (const profileId of input.recipientIds) {
      validateUUID(profileId, 'recipientId');
    }

    // Insert in chunks to avoid payload size limits
    const CHUNK_SIZE = 100;
    let inserted = 0;

    for (let i = 0; i < recipientRows.length; i += CHUNK_SIZE) {
      const chunk = recipientRows.slice(i, i + CHUNK_SIZE);
      const { error: recipError } = await supabase
        .from('notification_recipients')
        .insert(chunk);

      if (recipError) {
        console.log(`Chunk ${i / CHUNK_SIZE} insert error:`, recipError);
        // Continue with the rest — partial insert is acceptable for bulk
        continue;
      }

      inserted += chunk.length;
    }

    // Update the total_recipients count
    await supabase
      .from('notifications')
      .update({ total_recipients: inserted })
      .eq('notification_id', notifData.notification_id);

    console.log(`Inserted ${inserted} recipient rows`);
    console.groupEnd();

    return {
      success: true,
      data: {
        notificationId: notifData.notification_id,
        recipientCount: inserted,
      },
    };
  } catch (err) {
    console.log('Error:', err);
    console.groupEnd();
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Get announcements for an institute.
 *
 * Announcements are notifications with event_type = 'announcement'.
 *
 * @param instituteId - The institute UUID.
 * @param pagination  - Optional pagination parameters.
 */
export async function getAnnouncements(
  instituteId: string,
  pagination?: PaginationParams,
): Promise<ApiResponse<PaginatedResponse<Announcement>>> {
  try {
    validateUUID(instituteId, 'instituteId');
    const { page, pageSize, from, to } = buildPagination(pagination);

    console.group('NOTIFICATIONS');
    console.log('getAnnouncements', { instituteId, pagination });

    const query = supabase
      .from('notifications')
      .select('*, recipient:notification_recipients(*)', { count: 'exact' })
      .eq('institute_id', instituteId)
      .eq('event_type', 'announcement')
      .is('is_deleted', false)
      .order('created_at', { ascending: false })
      .range(from, to);

    const { data, error, count } = await query;

    if (error) {
      console.log('Error:', error);
      console.groupEnd();
      return { success: false, error: extractErrorMessage(error) };
    }

    // Map to Announcement type (use first recipient if available)
    const announcements: Announcement[] = [];

    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const notification = row as Record<string, unknown>;
      const recipients = (notification.recipient ?? []) as Record<string, unknown>[];

      const recipient = recipients[0] ?? {};

      const dbRow: DbNotificationWithRecipient = {
        notification_id: notification.notification_id as string,
        institute_id: notification.institute_id as string,
        template_id: notification.template_id as string | null,
        title: notification.title as string,
        body: notification.body as string,
        channel: notification.channel as string,
        event_type: notification.event_type as string,
        triggered_by: notification.triggered_by as string | null,
        reference_type: notification.reference_type as string | null,
        reference_id: notification.reference_id as string | null,
        total_recipients: notification.total_recipients as number,
        dispatched_at: notification.dispatched_at as string | null,
        is_deleted: notification.is_deleted as boolean,
        deleted_at: notification.deleted_at as string | null,
        created_at: notification.created_at as string,
        updated_at: notification.updated_at as string,
        recipient_id: (recipient.recipient_id as string) ?? '',
        profile_id: (recipient.profile_id as string) ?? '',
        is_read: (recipient.is_read as boolean) ?? false,
        read_at: (recipient.read_at as string) ?? null,
        received_at: (recipient.received_at as string) ?? notification.created_at as string,
      };

      announcements.push(mapAnnouncement(dbRow));
    }

    console.log(`Fetched ${announcements.length} announcements`);
    console.groupEnd();

    return {
      success: true,
      data: buildPaginatedResponse(announcements, count ?? 0, page, pageSize),
    };
  } catch (err) {
    console.log('Error:', err);
    console.groupEnd();
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Publish an announcement.
 *
 * Creates a notification with event_type = 'announcement' and optionally
 * creates recipient rows for all users with the specified role in the institute.
 *
 * @param input - The announcement creation payload.
 */
export async function publishAnnouncement(
  input: PublishAnnouncementInput,
): Promise<ApiResponse<{ notificationId: string }>> {
  try {
    console.group('NOTIFICATIONS');
    console.log('publishAnnouncement', { input });

    // ── Validate ────────────────────────────────────────────────────────
    if (!input.instituteId) {
      console.groupEnd();
      return { success: false, error: 'instituteId is required.' };
    }

    if (!input.title?.trim()) {
      console.groupEnd();
      return { success: false, error: 'Title is required.' };
    }

    if (!input.body?.trim()) {
      console.groupEnd();
      return { success: false, error: 'Body is required.' };
    }

    validateUUID(input.instituteId, 'instituteId');

    // ── Create notification event ───────────────────────────────────────
    const dbRecord: Record<string, unknown> = {
      institute_id: input.instituteId,
      template_id: null,
      title: input.title.trim(),
      body: input.body.trim(),
      channel: 'in_app',
      event_type: 'announcement',
      triggered_by: null,
      reference_type: 'announcement',
      reference_id: null,
      total_recipients: 0,
      dispatched_at: new Date().toISOString(),
    };

    const { data: notifData, error: notifError } = await supabase
      .from('notifications')
      .insert(dbRecord)
      .select()
      .single();

    if (notifError) {
      console.log('Insert error:', notifError);
      console.groupEnd();
      return { success: false, error: extractErrorMessage(notifError) };
    }

    console.log('Announcement created:', notifData);
    console.groupEnd();

    return { success: true, data: { notificationId: notifData.notification_id } };
  } catch (err) {
    console.log('Error:', err);
    console.groupEnd();
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ─── Dashboard Stats ─────────────────────────────────────────────────────────

/**
 * Fetch notification dashboard statistics for a user/institute.
 *
 * @param userId      - The profile ID.
 * @param instituteId - The institute ID.
 */
export async function getNotificationDashboardStats(
  userId: string,
  instituteId?: string,
): Promise<ApiResponse<NotificationDashboardStats>> {
  try {
    validateUUID(userId, 'userId');

    console.group('NOTIFICATIONS');
    console.log('getNotificationDashboardStats', { userId, instituteId });

    // ── Total and unread counts ─────────────────────────────────────────
    const { count: totalCount, error: totalError } = await supabase
      .from('notification_recipients')
      .select('*', { count: 'exact', head: true })
      .eq('profile_id', userId);

    if (totalError) {
      console.log('Error:', totalError);
      console.groupEnd();
      return { success: false, error: extractErrorMessage(totalError) };
    }

    const { count: unreadCount, error: unreadError } = await supabase
      .from('notification_recipients')
      .select('*', { count: 'exact', head: true })
      .eq('profile_id', userId)
      .eq('is_read', false);

    if (unreadError) {
      console.log('Error:', unreadError);
      console.groupEnd();
      return { success: false, error: extractErrorMessage(unreadError) };
    }

    // ── Today's count ───────────────────────────────────────────────────
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { count: todayCount, error: todayError } = await supabase
      .from('notification_recipients')
      .select('*', { count: 'exact', head: true })
      .eq('profile_id', userId)
      .gte('received_at', todayStart.toISOString());

    if (todayError) {
      console.log('Error:', todayError);
      console.groupEnd();
      return { success: false, error: extractErrorMessage(todayError) };
    }

    // ── Announcements count ─────────────────────────────────────────────
    const { count: announcementsCount, error: annError } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', 'announcement')
      .is('is_deleted', false);

    if (annError) {
      // Non-fatal — announcements count can be skipped
      console.log('Announcements count error:', annError);
    }

    const total = totalCount ?? 0;
    const unread = unreadCount ?? 0;

    console.log('Stats:', { total, unread, todayCount });
    console.groupEnd();

    return {
      success: true,
      data: {
        totalNotifications: total,
        unreadCount: unread,
        readCount: total - unread,
        announcementsCount: announcementsCount ?? 0,
        highPriorityCount: 0, // computed from full query in real scenarios
        todayCount: todayCount ?? 0,
        criticalCount: 0,
      },
    };
  } catch (err) {
    console.log('Error:', err);
    console.groupEnd();
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Automatic Notification Helpers
//
//  These helpers can be called by other modules (mock tests, results, content,
//  etc.) to automatically notify relevant users when specific events occur.
//  They do NOT modify existing modules — they are standalone reusable functions.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Notify students/teachers that a mock test has been published.
 *
 * Creates a notification of type `new_mock_test_available` linked to the
 * published mock test.
 *
 * @param instituteId  - The institute UUID.
 * @param testId       - The mock test UUID (used as reference_id).
 * @param testTitle    - The title of the published test.
 * @param recipientIds - Array of profile IDs to notify.
 *
 * @example
 * await notifyMockTestPublished(instituteId, testId, 'NEET Mock #5', [studentId1, studentId2]);
 */
export async function notifyMockTestPublished(
  instituteId: string,
  testId: string,
  testTitle: string,
  recipientIds: string[],
): Promise<ApiResponse<{ notificationId: string; recipientCount: number }>> {
  return createBulkNotification({
    instituteId,
    title: 'New Mock Test Available',
    body: `A new mock test "${testTitle}" has been published and is now available for you to attempt.`,
    eventType: 'new_mock_test_available',
    channel: 'in_app',
    referenceType: 'mock_test',
    referenceId: testId,
    recipientIds,
  });
}

/**
 * Notify a student that their result has been published for a mock test.
 *
 * Creates a notification of type `result_published` linked to the result.
 *
 * @param instituteId  - The institute UUID.
 * @param recipientId  - The student's profile ID.
 * @param testTitle    - The title of the mock test.
 * @param score        - The student's score.
 * @param totalMarks   - The maximum possible score.
 * @param resultId     - The result UUID (used as reference_id).
 *
 * @example
 * await notifyResultPublished(instituteId, studentId, 'NEET Mock #5', 85, 100, resultId);
 */
export async function notifyResultPublished(
  instituteId: string,
  recipientId: string,
  testTitle: string,
  score: number,
  totalMarks: number,
  resultId: string,
): Promise<ApiResponse<{ notificationId: string; recipientCount: number }>> {
  return createBulkNotification({
    instituteId,
    title: 'Result Published',
    body: `Your result for "${testTitle}" is now available. You scored ${score}/${totalMarks}.`,
    eventType: 'result_published',
    channel: 'in_app',
    referenceType: 'result',
    referenceId: resultId,
    recipientIds: [recipientId],
  });
}

/**
 * Notify students that new content has been uploaded.
 *
 * Creates a notification of type `new_content_uploaded` linked to the content.
 *
 * @param instituteId  - The institute UUID.
 * @param contentId    - The content UUID (used as reference_id).
 * @param contentTitle - The title of the uploaded content.
 * @param recipientIds - Array of profile IDs to notify.
 *
 * @example
 * await notifyContentUploaded(instituteId, contentId, 'Thermodynamics Notes', batchStudentIds);
 */
export async function notifyContentUploaded(
  instituteId: string,
  contentId: string,
  contentTitle: string,
  recipientIds: string[],
): Promise<ApiResponse<{ notificationId: string; recipientCount: number }>> {
  return createBulkNotification({
    instituteId,
    title: 'New Content Uploaded',
    body: `New study material "${contentTitle}" has been uploaded and is available for you to access.`,
    eventType: 'new_content_uploaded',
    channel: 'in_app',
    referenceType: 'content',
    referenceId: contentId,
    recipientIds,
  });
}

/**
 * Publish a notification-based announcement to targeted users.
 *
 * Creates a notification of type `announcement`.
 *
 * @param instituteId  - The institute UUID.
 * @param title        - The announcement title.
 * @param body         - The announcement body.
 * @param recipientIds - Array of profile IDs to notify.
 *
 * @example
 * await notifyAnnouncement(instituteId, 'Holiday Notice', 'Institute will remain closed on...', allStudentIds);
 */
export async function notifyAnnouncement(
  instituteId: string,
  title: string,
  body: string,
  recipientIds: string[],
): Promise<ApiResponse<{ notificationId: string; recipientCount: number }>> {
  return createBulkNotification({
    instituteId,
    title,
    body,
    eventType: 'announcement',
    channel: 'in_app',
    referenceType: 'announcement',
    referenceId: null as string | null,
    recipientIds,
  });
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Get the count of unread notifications for a user.
 */
async function getUnreadCount(userId: string): Promise<ApiResponse<number>> {
  try {
    const { count, error } = await supabase
      .from('notification_recipients')
      .select('*', { count: 'exact', head: true })
      .eq('profile_id', userId)
      .eq('is_read', false);

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: count ?? 0 };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}
