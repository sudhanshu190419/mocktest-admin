/**
 * Notification Permissions Hook
 *
 * Provides role-based permission data for the notification module.
 * Both Admin and Teacher use this single hook to determine:
 *   - Available audience types
 *   - Whether push notifications can be sent
 *   - Whether notifications can be deleted
 *   - Whether they can send to all users
 *   - Whether they can target specific batches
 *
 * This is the FRONTEND permission gate. Backend enforcement happens
 * inside `notificationService.resolveAudience()`.
 *
 * @module hooks/notification/useNotificationPermissions
 */

import { useMemo } from 'react';
import type {
  NotificationAudienceType,
  RoleNotificationPermissions,
} from '../../types/notification';

// ═══════════════════════════════════════════════════════════════════════════
// Permission Definitions
// ═══════════════════════════════════════════════════════════════════════════

const ADMIN_PERMISSIONS: RoleNotificationPermissions = {
  allowedAudiences: [
    'all_users',
    'students',
    'teachers',
    'batch',
    'specific_students',
    'specific_teachers',
  ],
  canSendPush: true,
  canSendToAll: true,
  canDelete: true,
  canSendToBatch: true,
};

const TEACHER_PERMISSIONS: RoleNotificationPermissions = {
  allowedAudiences: [
    'batch',
    'specific_students',
  ],
  canSendPush: true,
  canSendToAll: false,
  canDelete: false,
  canSendToBatch: true,
};

// ═══════════════════════════════════════════════════════════════════════════
// Audience Labels (shared across Admin + Teacher create pages)
// ═══════════════════════════════════════════════════════════════════════════

export const AUDIENCE_LABELS: Record<NotificationAudienceType, { label: string; description: string; icon: string }> = {
  all_users: { label: 'All Users', description: 'Everyone in the institute', icon: '👥' },
  students: { label: 'All Students', description: 'All enrolled students', icon: '🎓' },
  teachers: { label: 'All Teachers', description: 'All faculty members', icon: '👨‍🏫' },
  batch: { label: 'Specific Batch', description: 'Target a single batch', icon: '📚' },
  specific_students: { label: 'Specific Students', description: 'Select individual students', icon: '👤' },
  specific_teachers: { label: 'Specific Teachers', description: 'Select individual teachers', icon: '👨‍🏫' },
};

// ═══════════════════════════════════════════════════════════════════════════
// Hook
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Returns the notification permissions for a given user role.
 *
 * @param role - The user's role ('admin' | 'teacher').
 * @returns The permissions object for that role.
 *
 * @example
 * ```tsx
 * const { allowedAudiences, canSendPush } = useNotificationPermissions('admin');
 * // allowedAudiences = ['all_users', 'students', 'teachers', ...]
 * ```
 */
export function useNotificationPermissions(
  role: 'admin' | 'teacher' | undefined | null,
): RoleNotificationPermissions {
  return useMemo(() => {
    if (role === 'admin') return ADMIN_PERMISSIONS;
    return TEACHER_PERMISSIONS;
  }, [role]);
}
