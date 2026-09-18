/**
 * Student Notification Web Service
 *
 * Dedicated clean-architecture service layer for the Student Web Notification Center.
 * Reuses the existing backend schema (Domain 09 — Notifications) and shares exact parity
 * with the mobile app (MockTestApp):
 *   - public.notification_recipients (Recipient delivery & read status)
 *   - public.notifications (Content payload & metadata)
 *
 * Scoping:
 *   Strictly scoped to the authenticated student profile (auth.uid()).
 *
 * @module services/student/studentNotificationWebService
 */

import { supabase } from '@/config/supabase';

// ─── Enums & Types ──────────────────────────────────────────────────────────

export type StudentNotificationType =
  | 'mock-test'
  | 'result'
  | 'live-class'
  | 'course'
  | 'payment'
  | 'doubt'
  | 'announcement'
  | 'reminder'
  | 'system';

export type StudentNotificationActionType =
  | 'mockTestDetails'
  | 'testResult'
  | 'courseDetails'
  | 'liveClassDetails'
  | 'paymentDetails'
  | 'announcementDetails'
  | 'doubtDetails'
  | 'profile'
  | 'systemAlert'
  | 'deepLink';

export interface StudentNotificationItem {
  id: string; // notification_id or recipient_id
  notificationId: string;
  title: string;
  description: string;
  type: StudentNotificationType;
  isRead: boolean;
  createdAt: string;
  actionType: StudentNotificationActionType;
  actionId?: string;
  href?: string;
}

export interface FetchStudentNotificationsParams {
  page?: number;
  pageSize?: number;
  type?: StudentNotificationType | 'all' | 'unread';
}

export interface FetchStudentNotificationsResponse {
  data: StudentNotificationItem[];
  totalCount: number;
  unreadCount: number;
  hasMore: boolean;
}

// ─── Mappings ───────────────────────────────────────────────────────────────

const DB_EVENT_TYPE_TO_UI: Record<string, StudentNotificationType> = {
  live_class_reminder: 'live-class',
  live_class_started: 'live-class',
  test_published: 'mock-test',
  mock_test_assigned: 'mock-test',
  new_mock_test_available: 'mock-test',
  result_available: 'result',
  result_published: 'result',
  new_content_uploaded: 'course',
  batch_assigned: 'course',
  course_enrolled: 'course',
  pyq_access_granted: 'course',
  course_purchased: 'payment',
  pyq_purchased: 'payment',
  subscription_expiring: 'payment',
  subscription_expired: 'payment',
  announcement: 'announcement',
  student_doubt: 'doubt',
  content_approved: 'system',
  content_rejected: 'system',
  custom: 'system',
};

const UI_TYPE_TO_DB_EVENT_TYPES: Record<string, string[]> = {
  'mock-test': ['test_published', 'mock_test_assigned', 'new_mock_test_available'],
  result: ['result_available', 'result_published'],
  'live-class': ['live_class_reminder', 'live_class_started'],
  course: ['new_content_uploaded', 'batch_assigned', 'course_enrolled', 'pyq_access_granted'],
  payment: ['subscription_expiring', 'subscription_expired', 'course_purchased', 'pyq_purchased'],
  doubt: ['student_doubt'],
  announcement: ['announcement'],
  system: ['content_approved', 'content_rejected', 'custom'],
};

/**
 * Maps a DB reference_type string to a UI Action Type.
 */
export function mapNotificationReferenceType(refType: string | null): StudentNotificationActionType {
  switch (refType) {
    case 'live_class':
      return 'liveClassDetails';
    case 'mock_test':
      return 'mockTestDetails';
    case 'test_result':
      return 'testResult';
    case 'course':
    case 'content':
      return 'courseDetails';
    case 'student_doubt':
      return 'doubtDetails';
    case 'order':
    case 'payment':
      return 'paymentDetails';
    case 'announcement':
      return 'announcementDetails';
    case 'profile':
      return 'profile';
    case 'deep_link':
      return 'deepLink';
    default:
      return 'systemAlert';
  }
}

/**
 * Resolves the destination Student Web URL for a given notification action.
 */
export function resolveNotificationWebHref(
  actionType: StudentNotificationActionType,
  actionId?: string
): string {
  switch (actionType) {
    case 'mockTestDetails':
      return actionId ? `/student/tests/${actionId}` : '/student/tests';
    case 'testResult':
      return actionId ? `/student/tests/${actionId}/results` : '/student/tests';
    case 'liveClassDetails':
      return '/student/classes';
    case 'courseDetails':
      return actionId ? `/student/courses/${actionId}` : '/student/courses';
    case 'doubtDetails':
      return actionId ? `/student/doubts/${actionId}` : '/student/doubts';
    case 'paymentDetails':
      return '/student/courses';
    case 'announcementDetails':
      return '/student/overview';
    case 'profile':
      return '/student/profile';
    case 'deepLink':
      if (actionId && actionId.startsWith('/')) {
        return actionId;
      }
      return '/student/overview';
    case 'systemAlert':
    default:
      return '/student/overview';
  }
}

// ─── Service Methods ────────────────────────────────────────────────────────

/**
 * Fetches notifications for the authenticated student.
 */
export async function fetchStudentNotifications(
  params: FetchStudentNotificationsParams = {}
): Promise<FetchStudentNotificationsResponse> {
  const { page = 1, pageSize = 20, type = 'all' } = params;

  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      return { data: [], totalCount: 0, unreadCount: 0, hasMore: false };
    }
    const userId = userData.user.id;

    // 1. Build Query
    let query = supabase
      .from('notification_recipients')
      .select(
        `recipient_id,
         is_read,
         received_at,
         notifications!inner (
           notification_id,
           title,
           body,
           event_type,
           reference_type,
           reference_id,
           created_at
         )`,
        { count: 'exact' }
      )
      .eq('profile_id', userId)
      .order('received_at', { ascending: false });

    // 2. Filters
    if (type === 'unread') {
      query = query.eq('is_read', false);
    } else if (type !== 'all') {
      const eventTypes = UI_TYPE_TO_DB_EVENT_TYPES[type];
      if (eventTypes && eventTypes.length > 0) {
        query = query.in('notifications.event_type', eventTypes);
      }
    }

    // 3. Pagination
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    query = query.range(from, to);

    const { data, error, count } = await query;

    if (error || !data) {
      console.warn('[studentNotificationWebService] Error fetching notifications:', error);
      return { data: [], totalCount: 0, unreadCount: 0, hasMore: false };
    }

    // 4. Map rows
    const items: StudentNotificationItem[] = [];
    data.forEach((row: any) => {
      const n = row.notifications;
      if (!n) return;

      const eventType = n.event_type || 'custom';
      const uiType = DB_EVENT_TYPE_TO_UI[eventType] || 'system';
      const actionType = mapNotificationReferenceType(n.reference_type);
      const actionId = n.reference_id || undefined;
      const href = resolveNotificationWebHref(actionType, actionId);

      items.push({
        id: row.recipient_id || n.notification_id,
        notificationId: n.notification_id,
        title: n.title || 'Notification',
        description: n.body || '',
        type: uiType,
        isRead: Boolean(row.is_read),
        createdAt: row.received_at || n.created_at || new Date().toISOString(),
        actionType,
        actionId,
        href,
      });
    });

    // 5. Unread count
    const { count: unreadCount } = await supabase
      .from('notification_recipients')
      .select('*', { count: 'exact', head: true })
      .eq('profile_id', userId)
      .eq('is_read', false);

    const total = count ?? items.length;
    const hasMore = from + items.length < total;

    return {
      data: items,
      totalCount: total,
      unreadCount: unreadCount ?? 0,
      hasMore,
    };
  } catch (err) {
    console.error('[studentNotificationWebService] Unexpected exception in fetchStudentNotifications:', err);
    return { data: [], totalCount: 0, unreadCount: 0, hasMore: false };
  }
}

/**
 * Fetches the unread notification count for the authenticated student.
 */
export async function fetchStudentUnreadNotificationCount(): Promise<number> {
  try {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) return 0;

    const { count, error } = await supabase
      .from('notification_recipients')
      .select('*', { count: 'exact', head: true })
      .eq('profile_id', userData.user.id)
      .eq('is_read', false);

    if (error) {
      console.warn('[studentNotificationWebService] fetchStudentUnreadNotificationCount error:', error);
      return 0;
    }

    return count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Marks a single notification as read for the authenticated student.
 */
export async function markStudentNotificationAsRead(
  notificationId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) return { success: false, error: 'Not authenticated' };

    let query = supabase
      .from('notification_recipients')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('profile_id', userData.user.id);

    // Support either recipient_id or notification_id
    if (notificationId.includes('-')) {
      query = query.or(`recipient_id.eq.${notificationId},notification_id.eq.${notificationId}`);
    } else {
      query = query.eq('notification_id', notificationId);
    }

    const { error } = await query;
    if (error) {
      console.warn('[studentNotificationWebService] markStudentNotificationAsRead error:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to mark as read' };
  }
}

/**
 * Marks all notifications as read for the authenticated student.
 */
export async function markAllStudentNotificationsAsRead(): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) return { success: false, error: 'Not authenticated' };

    const { error } = await supabase
      .from('notification_recipients')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('profile_id', userData.user.id)
      .eq('is_read', false);

    if (error) {
      console.warn('[studentNotificationWebService] markAllStudentNotificationsAsRead error:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to mark all as read' };
  }
}
