/**
 * Make Me Topper — Transactional Email System Domain Types
 *
 * Defines contracts for queue jobs, delivery statuses, email sending,
 * provider responses, and webhooks.
 */

export type EmailQueueStatus =
  | 'pending'
  | 'processing'
  | 'sent'
  | 'failed'
  | 'cancelled';

export type EmailDeliveryStatus =
  | 'unsent'
  | 'accepted'
  | 'delivered'
  | 'bounced'
  | 'complained';

export type EmailPriority = 'critical' | 'high' | 'normal' | 'low';

export interface EmailQueueJob {
  queue_id: string;
  recipient_profile_id?: string | null;
  recipient_email: string;
  recipient_name?: string | null;
  event_type: string;
  subject: string;
  template_id: string;
  payload: Record<string, unknown>;
  priority: EmailPriority;
  status: EmailQueueStatus;
  delivery_status: EmailDeliveryStatus;
  attempts: number;
  max_attempts: number;
  next_retry_at: string;
  locked_at?: string | null;
  locked_by?: string | null;
  sent_at?: string | null;
  provider_message_id?: string | null;
  last_error?: string | null;
  idempotency_key?: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailSendRequest {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  idempotencyKey?: string;
  headers?: Record<string, string>;
  tags?: Array<{ name: string; value: string }>;
}

export interface EmailSendResult {
  success: boolean;
  providerMessageId?: string;
  retryable: boolean;
  error?: string;
  statusCode?: number;
  retryAfterSeconds?: number;
  providerErrorCode?: string;
  isAmbiguous?: boolean;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface TemplateContext {
  recipientName?: string | null;
  recipientEmail: string;
  [key: string]: unknown;
}

export interface WorkerBatchResult {
  totalClaimed: number;
  succeeded: number;
  retried: number;
  failed: number;
  cancelled: number;
  recoveredLocks: number;
  durationMs: number;
  details: Array<{
    queueId: string;
    eventType: string;
    recipientEmail: string;
    action: 'sent' | 'retried' | 'failed' | 'cancelled';
    reason?: string;
    providerMessageId?: string;
  }>;
}

export interface ResendWebhookPayload {
  type: string;
  created_at: string;
  data: {
    id: string;
    from?: string;
    to?: string[];
    subject?: string;
    created_at?: string;
    status?: string;
    bounce?: {
      message?: string;
      type?: 'transient' | 'permanent' | 'undetermined';
      sub_type?: string;
    };
    [key: string]: unknown;
  };
}

