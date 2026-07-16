/**
 * Send Notification Hook
 *
 * React Query mutation hook for sending audience-based notifications.
 *
 * The frontend is a thin client — it sends the bare minimum to the
 * `dispatch-notification` Edge Function, which handles:
 *   - Authentication & role detection
 *   - Permission validation
 *   - Audience resolution (DB queries)
 *   - Notification + recipient creation
 *   - Optional FCM push dispatch
 *
 * Both Admin and Teacher use this single hook.
 *
 * @module hooks/notification/useSendNotification
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationKeys } from './queryKeys';
import { supabase } from '../../config/supabase';
import type {
  CreateAudienceNotificationInput,
  SendNotificationResult,
} from '../../types/notification';

// ─── Mutation Input ─────────────────────────────────────────────────────────

export interface SendAudienceNotificationInput {
  /** The audience-based notification payload. */
  input: CreateAudienceNotificationInput;
  /** The role of the sender (for Edge Function permission validation). */
  userRole: 'admin' | 'teacher';
  /** Optional teacher ID for batch validation on the Edge Function. */
  teacherId?: string;
}

// ─── Edge Function Response ─────────────────────────────────────────────────

interface DispatchResponse {
  success: boolean;
  notificationId: string;
  totalRecipients: number;
  successfulPushes: number;
  failedPushes: number;
  error?: string;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Send a notification to an audience with optional push.
 *
 * Calls the `dispatch-notification` Edge Function which owns the complete
 * workflow: auth → permission validation → audience resolution →
 * notification creation → recipient creation → push dispatch.
 *
 * Automatically invalidates notification list and dashboard caches on success.
 *
 * @example
 * ```tsx
 * const sendNotif = useSendAudienceNotification();
 *
 * await sendNotif.mutateAsync({
 *   input: {
 *     instituteId: 'uuid',
 *     title: 'Exam Reminder',
 *     body: 'Your exam starts tomorrow.',
 *     eventType: 'announcement',
 *     audience: { type: 'students' },
 *     sendPush: true,
 *   },
 *   userRole: 'admin',
 * });
 * ```
 */
export function useSendAudienceNotification() {
  const queryClient = useQueryClient();

  return useMutation<SendNotificationResult, Error, SendAudienceNotificationInput>({
    mutationFn: async ({ input, userRole }) => {
      // ── Resolve Supabase URL ──────────────────────────────────────────
      const supabaseUrl = typeof process !== 'undefined'
        ? process.env.NEXT_PUBLIC_SUPABASE_URL
        : undefined;

      if (!supabaseUrl) {
        throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured.');
      }

      // ── Get the user's current session JWT ──────────────────────────
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError || !session?.access_token) {
        console.error('[useSendAudienceNotification] No active session:', sessionError?.message);
        throw new Error('You must be logged in to send notifications.');
      }

      const token = session.access_token;

      // ── Log outgoing request (masked token) ──────────────────────────
      console.group('[useSendAudienceNotification]');
      console.log('URL:', `${supabaseUrl}/functions/v1/dispatch-notification`);
      console.log('Authorization exists:', !!token);
      console.log('Token (first 20 chars):', token.slice(0, 20) + '...');
      console.log('Content-Type:', 'application/json');
      console.log('Payload:', {
        instituteId: input.instituteId,
        title: input.title,
        eventType: input.eventType,
        audienceType: input.audience.type,
        sendPush: input.sendPush,
      });
      console.groupEnd();

      // ── Call the dispatch-notification Edge Function ─────────────────
      const response = await fetch(
        `${supabaseUrl}/functions/v1/dispatch-notification`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            instituteId: input.instituteId,
            title: input.title,
            body: input.body,
            eventType: input.eventType,
            priority: input.priority,
            channel: input.channel ?? 'in_app',
            triggeredBy: input.triggeredBy ?? null,
            referenceType: input.referenceType ?? null,
            referenceId: input.referenceId ?? null,
            audience: {
              type: input.audience.type,
              batchId: input.audience.batchId,
              recipientIds: input.audience.recipientIds,
            },
            sendPush: input.sendPush ?? false,
          }),
        },
      );

      const data: DispatchResponse = await response.json();

      if (!data.success || !data.notificationId) {
        throw new Error(data.error ?? 'Failed to send notification.');
      }

      return {
        notificationId: data.notificationId,
        recipientCount: data.totalRecipients,
        pushSent: data.successfulPushes > 0 || data.failedPushes > 0,
        pushResults: {
          successful: data.successfulPushes,
          failed: data.failedPushes,
          totalDevices: data.successfulPushes + data.failedPushes,
        },
      } satisfies SendNotificationResult;
    },
    onSuccess: () => {
      // Invalidate all notification-related caches
      queryClient.invalidateQueries({ queryKey: notificationKeys.notifications.lists() });
      queryClient.invalidateQueries({ queryKey: notificationKeys.unread.all() });
      queryClient.invalidateQueries({ queryKey: notificationKeys.dashboard.all() });
      queryClient.invalidateQueries({ queryKey: notificationKeys.announcements.all() });
    },
  });
}
