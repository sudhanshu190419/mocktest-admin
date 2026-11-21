/**
 * Make Me Topper — Email Worker Core Logic
 *
 * Implements:
 * 1. Concurrency-safe queue batch claiming & processing loop.
 * 2. Automatic abandoned lock recovery.
 * 3. Graceful missing/invalid recipient email cancellation.
 * 4. Email suppression checking.
 * 5. Safe template rendering with fallback.
 * 6. Provider dispatch with transient vs permanent error handling.
 * 7. Exponential backoff and retry scheduling.
 * 8. Strict error isolation (one failing job never aborts the batch).
 */

import { EmailProvider } from '../_shared/email/provider.ts';
import { MockEmailProvider } from '../_shared/email/mockProvider.ts';
import { ResendProvider } from '../_shared/email/resendProvider.ts';
import { renderEmail } from '../_shared/email/templates.ts';
import {
  EmailQueueJob,
  WorkerBatchResult,
} from '../_shared/email/types.ts';

export interface WorkerProviderConfig {
  mockEmailExplicit?: boolean;
  resendApiKey?: string | null;
  from?: string;
  replyTo?: string;
}

/**
 * Resolves the email provider for the worker.
 * Strictly guarantees fail-closed behavior:
 * - MockEmailProvider is ONLY selected when mockEmailExplicit === true.
 * - If mockEmailExplicit is false/omitted, RESEND_API_KEY is strictly mandatory.
 * - Missing RESEND_API_KEY will NEVER fall back to MockEmailProvider.
 */
export function resolveWorkerProvider(config: WorkerProviderConfig): {
  provider: EmailProvider | null;
  error?: string;
} {
  if (config.mockEmailExplicit === true) {
    return { provider: new MockEmailProvider() };
  }

  const apiKey = config.resendApiKey?.trim();
  if (!apiKey) {
    return {
      provider: null,
      error: 'RESEND_API_KEY is missing. Production worker aborted to prevent silent email loss.',
    };
  }

  return {
    provider: new ResendProvider({
      apiKey,
      from: config.from || 'Make Me Topper <info@makemetopper.com>',
      replyTo: config.replyTo || 'support@inovoxy.com',
    }),
  };
}

export interface EmailWorkerDatabase {
  recoverAbandonedLocks(staleSeconds?: number): Promise<number>;
  claimBatch(batchSize: number, workerId: string): Promise<EmailQueueJob[]>;
  isSuppressed(email: string): Promise<boolean>;
  recordSuccess(queueId: string, providerMessageId?: string): Promise<boolean>;
  scheduleRetry(
    queueId: string,
    error: string,
    delaySeconds?: number
  ): Promise<{ success: boolean; status?: string }>;
  markFailed(queueId: string, error: string): Promise<boolean>;
  cancelJob(queueId: string, reason: string): Promise<boolean>;
}

export interface ProcessBatchOptions {
  batchSize?: number;
  workerId?: string;
  staleLockSeconds?: number;
}

/**
 * Calculates exponential backoff delay in seconds.
 * Base delay: 60s, doubling with each attempt (60, 120, 240, 480...), capped at 3600s (1hr).
 */
export function calculateBackoffSeconds(
  attempts: number,
  baseDelaySeconds: number = 60,
  maxDelaySeconds: number = 3600
): number {
  const exponent = Math.max(0, attempts);
  const calculated = baseDelaySeconds * Math.pow(2, exponent);
  return Math.min(Math.round(calculated), maxDelaySeconds);
}

/**
 * Validates whether an email string looks syntactically valid and non-empty.
 */
export function isValidEmailAddress(email?: string | null): boolean {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length < 5 || trimmed.length > 255) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(trimmed);
}

/**
 * Executes a single email worker processing cycle.
 */
export async function runEmailWorkerBatch(
  db: EmailWorkerDatabase,
  provider: EmailProvider,
  options: ProcessBatchOptions = {}
): Promise<WorkerBatchResult> {
  const startTime = Date.now();
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 20, 50));
  const workerId =
    options.workerId ||
    `worker-${Math.random().toString(36).substring(2, 9)}-${Date.now()}`;
  const staleLockSeconds = options.staleLockSeconds ?? 300;

  // 1. Recover abandoned locks from crashed worker runs
  let recoveredLocks = 0;
  try {
    recoveredLocks = await db.recoverAbandonedLocks(staleLockSeconds);
  } catch (err) {
    console.warn(`[email-worker] Warning: lock recovery failed:`, err);
  }

  // 2. Atomically claim batch of pending jobs
  let claimedJobs: EmailQueueJob[] = [];
  try {
    claimedJobs = await db.claimBatch(batchSize, workerId);
  } catch (err) {
    console.error(`[email-worker] Error: failed to claim queue batch:`, err);
    return {
      totalClaimed: 0,
      succeeded: 0,
      retried: 0,
      failed: 0,
      cancelled: 0,
      recoveredLocks,
      durationMs: Date.now() - startTime,
      details: [],
    };
  }

  const result: WorkerBatchResult = {
    totalClaimed: claimedJobs.length,
    succeeded: 0,
    retried: 0,
    failed: 0,
    cancelled: 0,
    recoveredLocks,
    durationMs: 0,
    details: [],
  };

  if (claimedJobs.length === 0) {
    result.durationMs = Date.now() - startTime;
    return result;
  }

  // 3. Process each claimed job independently with strict error isolation
  for (const job of claimedJobs) {
    try {
      // Step A: Graceful Null/Empty Email Check
      if (!isValidEmailAddress(job.recipient_email)) {
        await db.cancelJob(job.queue_id, 'RECIPIENT_EMAIL_MISSING_OR_INVALID');
        result.cancelled++;
        result.details.push({
          queueId: job.queue_id,
          eventType: job.event_type,
          recipientEmail: job.recipient_email,
          action: 'cancelled',
          reason: 'RECIPIENT_EMAIL_MISSING_OR_INVALID',
        });
        continue;
      }

      // Step B: Suppression Check
      const isSuppressed = await db.isSuppressed(job.recipient_email.toLowerCase().trim());
      if (isSuppressed) {
        await db.cancelJob(job.queue_id, 'RECIPIENT_EMAIL_SUPPRESSED');
        result.cancelled++;
        result.details.push({
          queueId: job.queue_id,
          eventType: job.event_type,
          recipientEmail: job.recipient_email,
          action: 'cancelled',
          reason: 'RECIPIENT_EMAIL_SUPPRESSED',
        });
        continue;
      }

      // Step C: Render Template
      let rendered;
      try {
        rendered = renderEmail(job.template_id, job.payload, {
          recipientName: job.recipient_name,
          recipientEmail: job.recipient_email,
        });
      } catch (renderErr) {
        const errorMsg =
          renderErr instanceof Error ? renderErr.message : String(renderErr);
        await db.markFailed(job.queue_id, `TEMPLATE_RENDER_ERROR: ${errorMsg}`);
        result.failed++;
        result.details.push({
          queueId: job.queue_id,
          eventType: job.event_type,
          recipientEmail: job.recipient_email,
          action: 'failed',
          reason: `TEMPLATE_RENDER_ERROR: ${errorMsg}`,
        });
        continue;
      }

      // Step D: Dispatch via Provider
      const sendResult = await provider.sendEmail({
        to: job.recipient_email,
        subject: rendered.subject || job.subject,
        html: rendered.html,
        text: rendered.text,
        idempotencyKey: job.idempotency_key || undefined,
        tags: [
          { name: 'event_type', value: job.event_type },
          { name: 'queue_id', value: job.queue_id },
        ],
      });

      // Step E: Handle Provider Dispatch Outcome
      if (sendResult.success) {
        await db.recordSuccess(job.queue_id, sendResult.providerMessageId);
        result.succeeded++;
        result.details.push({
          queueId: job.queue_id,
          eventType: job.event_type,
          recipientEmail: job.recipient_email,
          action: 'sent',
          providerMessageId: sendResult.providerMessageId,
        });
      } else {
        // Failure branch
        const errorMsg = sendResult.error || 'Provider dispatch failed';

        if (sendResult.retryable) {
          const delaySeconds =
            sendResult.retryAfterSeconds ??
            calculateBackoffSeconds(job.attempts);

          const retryOutcome = await db.scheduleRetry(
            job.queue_id,
            errorMsg,
            delaySeconds
          );

          if (retryOutcome.status === 'failed') {
            result.failed++;
            result.details.push({
              queueId: job.queue_id,
              eventType: job.event_type,
              recipientEmail: job.recipient_email,
              action: 'failed',
              reason: `MAX_RETRIES_EXCEEDED: ${errorMsg}`,
            });
          } else {
            result.retried++;
            result.details.push({
              queueId: job.queue_id,
              eventType: job.event_type,
              recipientEmail: job.recipient_email,
              action: 'retried',
              reason: errorMsg,
            });
          }
        } else {
          // Permanent failure (e.g. 400, 422, unverified sender domain, illegal address)
          await db.markFailed(job.queue_id, `PERMANENT_ERROR: ${errorMsg}`);
          result.failed++;
          result.details.push({
            queueId: job.queue_id,
            eventType: job.event_type,
            recipientEmail: job.recipient_email,
            action: 'failed',
            reason: `PERMANENT_ERROR: ${errorMsg}`,
          });
        }
      }
    } catch (unhandledJobErr) {
      // Unhandled error for this specific job — isolate and mark for retry
      const errMsg =
        unhandledJobErr instanceof Error
          ? unhandledJobErr.message
          : String(unhandledJobErr);
      console.error(
        `[email-worker] Unhandled error processing job ${job.queue_id}:`,
        unhandledJobErr
      );

      try {
        await db.scheduleRetry(job.queue_id, `UNHANDLED_EXCEPTION: ${errMsg}`, 120);
        result.retried++;
        result.details.push({
          queueId: job.queue_id,
          eventType: job.event_type,
          recipientEmail: job.recipient_email,
          action: 'retried',
          reason: `UNHANDLED_EXCEPTION: ${errMsg}`,
        });
      } catch {
        result.failed++;
      }
    }
  }

  result.durationMs = Date.now() - startTime;
  return result;
}

/**
 * Creates an EmailWorkerDatabase implementation backed by a Supabase client.
 */
// deno-lint-ignore no-explicit-any
export function createSupabaseWorkerDb(supabaseClient: any): EmailWorkerDatabase {
  return {
    async recoverAbandonedLocks(staleSeconds: number = 300): Promise<number> {
      const { data, error } = await supabaseClient.rpc(
        'recover_abandoned_email_locks',
        { p_stale_seconds: staleSeconds }
      );
      if (error) throw error;
      return typeof data === 'number' ? data : 0;
    },

    async claimBatch(batchSize: number, workerId: string): Promise<EmailQueueJob[]> {
      const { data, error } = await supabaseClient.rpc(
        'claim_email_queue_batch',
        {
          p_batch_size: batchSize,
          p_worker_id: workerId,
        }
      );
      if (error) throw error;
      return (data as EmailQueueJob[]) || [];
    },

    async isSuppressed(email: string): Promise<boolean> {
      const { data, error } = await supabaseClient
        .from('email_suppressions')
        .select('email')
        .eq('email', email)
        .maybeSingle();

      if (error) {
        console.warn(`[email-worker] Error checking suppressions:`, error);
        return false;
      }
      return !!data;
    },

    async recordSuccess(queueId: string, providerMessageId?: string): Promise<boolean> {
      const { data, error } = await supabaseClient.rpc('record_email_success', {
        p_queue_id: queueId,
        p_provider_message_id: providerMessageId || null,
      });
      if (error) throw error;
      return !!data;
    },

    async scheduleRetry(
      queueId: string,
      errorMessage: string,
      delaySeconds: number = 60
    ): Promise<{ success: boolean; status?: string }> {
      const { data, error } = await supabaseClient.rpc('schedule_email_retry', {
        p_queue_id: queueId,
        p_error_message: errorMessage,
        p_retry_delay_seconds: delaySeconds,
      });
      if (error) throw error;
      return (data as { success: boolean; status?: string }) || { success: false };
    },

    async markFailed(queueId: string, errorMessage: string): Promise<boolean> {
      const { data, error } = await supabaseClient.rpc('mark_email_failed', {
        p_queue_id: queueId,
        p_error_message: errorMessage,
      });
      if (error) throw error;
      return !!data;
    },

    async cancelJob(queueId: string, reason: string): Promise<boolean> {
      const { data, error } = await supabaseClient.rpc('cancel_email_job', {
        p_queue_id: queueId,
        p_reason: reason,
      });
      if (error) throw error;
      return !!data;
    },
  };
}

