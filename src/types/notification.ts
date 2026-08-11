/**
 * Notification Module Types
 *
 * Production-ready type definitions for the Notifications module.
 *
 * These types mirror the PostgreSQL schema (Domain 09 — Notifications),
 * mapping snake_case database columns to camelCase TypeScript properties.
 *
 * Dependencies:
 * - Consumed by notification service layer, React Query hooks, and UI screens.
 * - Reuses shared types from src/types/academic.ts (ApiResponse,
 *   PaginatedResponse, PaginationParams, SortDirection).
 * - Compatible with Supabase JS client.
 *
 * @module types/notification
 */

import type {
  ApiResponse,
  PaginatedResponse,
  PaginationParams,
  SortDirection,
} from './academic';

// ─── Re-exports for consumer convenience ────────────────────────────────────
export type { ApiResponse, PaginatedResponse, PaginationParams, SortDirection };

// ═══════════════════════════════════════════════════════════════════════════
//  Enums / Constants
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Notification event types supported by the platform.
 *
 * Maps to the `notification_event_type` PostgreSQL enum where applicable.
 * Extended with additional types used by the notification helpers.
 */
export type NotificationType =
  | 'mock_test_assigned'
  | 'mock_test_reminder'
  | 'mock_test_submitted'
  | 'result_published'
  | 'new_content_uploaded'
  | 'chapter_added'
  | 'subject_added'
  | 'new_mock_test_available'
  | 'announcement'
  | 'general_message'
  | 'warning'
  | 'success'
  | 'error'
  | 'live_class_reminder'
  | 'live_class_started'
  | 'content_approved'
  | 'content_rejected'
  | 'subscription_expiring'
  | 'subscription_expired'
  | 'batch_assigned'
  // ── Doubt System (migration 117 + 118 events) ───────────────────────
  | 'doubt_submitted'
  | 'doubt_assigned'
  | 'doubt_answered'
  | 'doubt_follow_up'
  | 'doubt_resolved'
  | 'doubt_reopened'
  | 'doubt_unassigned'
  | 'custom';

/**
 * Notification priority levels.
 */
export type NotificationPriority = 'low' | 'normal' | 'high' | 'critical';

/**
 * Delivery channel for notifications.
 *
 * Mirrors the `notification_channel_type` PostgreSQL enum.
 */
export type NotificationChannel = 'in_app' | 'push' | 'email' | 'sms';

/**
 * Notification target audience role.
 */
export type NotificationTargetRole = 'admin' | 'teacher' | 'student' | 'all';

// ═══════════════════════════════════════════════════════════════════════════
//  Notification
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A user-facing notification item in an inbox.
 *
 * This is the joined view of `notifications` and `notification_recipients`,
 * providing the complete notification display data for a specific recipient.
 */
export interface Notification {
  /** Primary key (notification_recipients.recipient_id). */
  id: string;
  /** The notification event ID (notifications.notification_id). */
  notificationId: string;
  /** Notification title (fully rendered, all tokens substituted). */
  title: string;
  /** Notification body/content (fully rendered). */
  message: string;
  /** The event type that triggered this notification. */
  type: NotificationType;
  /** Delivery channel. */
  channel: NotificationChannel;
  /** Priority level (inferred from event type or stored in metadata). */
  priority: NotificationPriority;
  /** The target recipient (profile_id). */
  userId: string;
  /** The institute context. */
  instituteId: string;
  /** Whether the recipient has read this notification. */
  isRead: boolean;
  /** Timestamp when the notification was created/dispatched. */
  createdAt: string;
  /** Timestamp when the recipient read it. NULL when unread. */
  readAt: string | null;
  /** Timestamp when the recipient received it. */
  receivedAt: string;
  /** Deep-link URL constructed from reference_type + reference_id. */
  actionUrl: string | null;
  /** Reference entity type (e.g. 'mock_test', 'content', 'live_class'). */
  referenceType: string | null;
  /** Reference entity ID. */
  referenceId: string | null;
  /** Optional metadata payload (flexible key-value store). */
  metadata: Record<string, unknown> | null;
  /** Template ID that generated this notification. NULL for ad-hoc messages. */
  templateId: string | null;
}

/**
 * Raw notification event row (snake_case from `notifications` table).
 */
export interface DbNotification {
  notification_id: string;
  institute_id: string;
  template_id: string | null;
  title: string;
  body: string;
  channel: string;
  event_type: string;
  triggered_by: string | null;
  reference_type: string | null;
  reference_id: string | null;
  total_recipients: number;
  dispatched_at: string | null;
  is_deleted: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Notification recipient row from `notification_recipients` table.
 */
export interface DbNotificationRecipient {
  recipient_id: string;
  notification_id: string;
  profile_id: string;
  institute_id: string;
  is_read: boolean;
  read_at: string | null;
  received_at: string;
  created_at: string;
}

/**
 * Joined result from notifications + notification_recipients query.
 */
export interface DbNotificationWithRecipient {
  /** notification columns */
  notification_id: string;
  institute_id: string;
  template_id: string | null;
  title: string;
  body: string;
  channel: string;
  event_type: string;
  triggered_by: string | null;
  reference_type: string | null;
  reference_id: string | null;
  total_recipients: number;
  dispatched_at: string | null;
  is_deleted: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  /** recipient columns */
  recipient_id: string;
  profile_id: string;
  is_read: boolean;
  read_at: string | null;
  received_at: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Announcement
// ═══════════════════════════════════════════════════════════════════════════

/**
 * An admin-published announcement. This is a type of notification with
 * type = 'announcement', but is queried and managed separately for
 * the Dev Console dashboard.
 */
export interface Announcement {
  /** Same as Notification.id (recipient_id). */
  id: string;
  /** The notification event ID. */
  notificationId: string;
  /** Announcement title. */
  title: string;
  /** Announcement body/content. */
  message: string;
  /** Always 'announcement'. */
  type: NotificationType;
  /** Priority level. */
  priority: NotificationPriority;
  /** Institute that published this announcement. */
  instituteId: string;
  /** Target audience role. */
  targetRole: NotificationTargetRole | null;
  /** Whether the recipient has read this. */
  isRead: boolean;
  /** Published timestamp. */
  createdAt: string;
  /** Expiry timestamp. NULL if no expiry. */
  expiresAt: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Input / Mutation Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Input for creating a single notification.
 */
export interface CreateNotificationInput {
  /** Institute context. */
  instituteId: string;
  /** Notification title. Minimum 1 character. */
  title: string;
  /** Notification body content. Minimum 1 character. */
  body: string;
  /** Notification event type. */
  eventType: NotificationType;
  /** Delivery channel. Defaults to 'in_app'. */
  channel?: NotificationChannel;
  /** Optional template ID. */
  templateId?: string | null;
  /** Who triggered this notification. NULL for system events. */
  triggeredBy?: string | null;
  /** Reference entity type (for deep link construction). */
  referenceType?: string | null;
  /** Reference entity ID. */
  referenceId?: string | null;
  /** Priority level. */
  priority?: NotificationPriority;
  /** Optional metadata payload. */
  metadata?: Record<string, unknown> | null;
}

/**
 * Input for creating a bulk notification (single notification sent to
 * multiple recipients).
 */
export interface CreateBulkNotificationInput extends CreateNotificationInput {
  /** List of recipient profile IDs. */
  recipientIds: string[];
}

/**
 * Input for publishing an announcement.
 */
export interface PublishAnnouncementInput {
  /** Institute context. */
  instituteId: string;
  /** Announcement title. */
  title: string;
  /** Announcement body content. */
  body: string;
  /** Target audience role. Defaults to 'all'. */
  targetRole?: NotificationTargetRole;
  /** Optional expiry timestamp. */
  expiresAt?: string | null;
  /** Optional metadata payload. */
  metadata?: Record<string, unknown> | null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Query / Filter Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Filters available when querying notifications.
 */
export interface NotificationFilters {
  /** Filter by notification type. */
  type?: NotificationType;
  /** Filter by read status. */
  isRead?: boolean;
  /** Filter by priority. */
  priority?: NotificationPriority;
  /** Filter by institute. */
  instituteId?: string;
  /** Filter by user/profile ID. */
  userId?: string;
  /** Only results after this timestamp (inclusive). */
  createdAfter?: string;
  /** Only results before this timestamp (inclusive). */
  createdBefore?: string;
  /** Search across title and body (case-insensitive). */
  search?: string;
  /** Filter by delivery channel. */
  channel?: NotificationChannel;
  /** Filter by specific notification IDs. */
  ids?: string[];
}

/**
 * Sort options for notifications list queries.
 */
export interface NotificationSortOptions {
  sortBy?: 'createdAt' | 'receivedAt' | 'readAt' | 'title' | 'type' | 'priority';
  sortDirection?: SortDirection;
}

/**
 * Paginated notification query result.
 */
export interface NotificationListResult {
  notifications: Notification[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  unreadCount: number;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Dashboard Stats
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Dashboard statistics for notifications.
 */
export interface NotificationDashboardStats {
  /** Total notifications for the current context. */
  totalNotifications: number;
  /** Total unread notifications. */
  unreadCount: number;
  /** Total read notifications. */
  readCount: number;
  /** Total announcements. */
  announcementsCount: number;
  /** High priority notifications. */
  highPriorityCount: number;
  /** Notifications from today. */
  todayCount: number;
  /** Critical priority notifications. */
  criticalCount: number;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Audience Model (shared permissions system)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Audience type for notification sending.
 *
 * - `all_users`: Everyone in the institute
 * - `students`: All students
 * - `teachers`: All teachers
 * - `batch`: Specific batch (requires batchId)
 * - `specific_students`: Specific student profile IDs (requires recipientIds)
 * - `specific_teachers`: Specific teacher profile IDs (requires recipientIds)
 */
export type NotificationAudienceType =
  | 'all_users'
  | 'students'
  | 'teachers'
  | 'batch'
  | 'specific_students'
  | 'specific_teachers';

/**
 * An audience descriptor for creating a notification.
 * Resolved to recipient profile IDs before sending.
 */
export interface NotificationAudience {
  /** Which audience category to target. */
  type: NotificationAudienceType;
  /** Batch ID if type is 'batch'. */
  batchId?: string;
  /** Specific profile IDs if type is 'specific_students' or 'specific_teachers'. */
  recipientIds?: string[];
}

/**
 * Per-role permission model defining which audiences a role can target.
 */
export interface RoleNotificationPermissions {
  /** Audiences this role can send to. */
  allowedAudiences: NotificationAudienceType[];
  /** Whether this role can send push notifications. */
  canSendPush: boolean;
  /** Whether this role can send to all users. */
  canSendToAll: boolean;
  /** Whether this role can delete notifications. */
  canDelete: boolean;
  /** Whether this role can send to specific batches. */
  canSendToBatch: boolean;
}

/**
 * Input for creating a notification with audience and optional push.
 */
export interface CreateAudienceNotificationInput {
  instituteId: string;
  title: string;
  body: string;
  eventType: NotificationType;
  priority?: NotificationPriority;
  channel?: NotificationChannel;
  referenceType?: string | null;
  referenceId?: string | null;
  triggeredBy?: string | null;
  /** The audience to send to. Resolved to recipient IDs internally. */
  audience: NotificationAudience;
  /** Whether to also send push notifications via FCM. */
  sendPush?: boolean;
}

/**
 * Result of sending a notification with optional push.
 */
export interface SendNotificationResult {
  notificationId: string;
  recipientCount: number;
  pushSent: boolean;
  pushResults?: {
    successful: number;
    failed: number;
    totalDevices: number;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Notification Template (for reference/admin use)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A reusable notification template blueprint.
 *
 * Mirrors the `notification_templates` table.
 */
export interface NotificationTemplate {
  /** Primary key. */
  templateId: string;
  /** Institute that owns this template. NULL for system templates. */
  instituteId: string | null;
  /** Human-readable internal name. */
  name: string;
  /** The system event this template is bound to. */
  eventType: string;
  /** Delivery channel. */
  channel: NotificationChannel;
  /** Target role. NULL means all roles. */
  targetRole: NotificationTargetRole | null;
  /** Title template with placeholder tokens. */
  titleTemplate: string;
  /** Body template with placeholder tokens. */
  bodyTemplate: string;
  /** Whether this template is active for new dispatches. */
  isActive: boolean;
  /** Who created this template. */
  createdBy: string;
  /** Who last modified this template. */
  updatedBy: string | null;
  /** Creation timestamp. */
  createdAt: string;
  /** Last modification timestamp. */
  updatedAt: string;
}
