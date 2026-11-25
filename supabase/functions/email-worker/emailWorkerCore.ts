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

export interface MockResultEligibility {
  eligible: boolean;
  cancelReason?: string;
  isTransient?: boolean;
}

export interface DispatchReservationResult {
  success: boolean;
  reason?: string;
  isTransient?: boolean;
  consumedAt?: string;
  providerMessageId?: string;
  providerRequestStartedAt?: string;
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
  isInstallmentReminderEligible?(payload: Record<string, unknown>, eventType?: string): Promise<boolean>;
  checkMockResultReleaseEligibility?(payload: Record<string, unknown>): Promise<MockResultEligibility>;
  acquireMockResultDispatchReservation?(
    attemptId: string,
    testId: string,
    queueId: string,
    releaseGeneration: string
  ): Promise<DispatchReservationResult>;
  consumeMockResultDispatchReservation?(
    attemptId: string,
    queueId: string,
    providerMessageId?: string
  ): Promise<boolean>;
  releaseMockResultDispatchReservation?(
    attemptId: string,
    queueId: string,
    reason?: string
  ): Promise<boolean>;
  updateMockResultProviderOutcome?(
    attemptId: string,
    queueId: string,
    outcome: 'not_dispatched' | 'definitively_rejected' | 'outcome_unknown' | 'provider_accepted',
    error?: string,
    status?: 'reserved' | 'consumed' | 'blocked'
  ): Promise<boolean>;
  recordMockResultSuccess?(
    queueId: string,
    attemptId: string,
    providerMessageId?: string
  ): Promise<boolean>;
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
 * Normalizes an ISO-8601 timestamp string to full PostgreSQL microsecond precision (YYYY-MM-DDTHH:mm:ss.uuuuuuZ).
 * Returns null if the timestamp is missing, malformed, or unparseable.
 */
export function normalizePostgresTimestamp(ts?: unknown): string | null {
  if (typeof ts !== 'string' || !ts.trim()) return null;
  const trimmed = ts.trim();
  const parsedMs = Date.parse(trimmed);
  if (isNaN(parsedMs)) return null;

  // Extract date-time up to seconds in UTC
  const d = new Date(parsedMs);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const base = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

  // Extract fractional seconds (microseconds)
  const fracMatch = trimmed.match(/\.(\d+)/);
  let micros = '000000';
  if (fracMatch && fracMatch[1]) {
    micros = fracMatch[1].padEnd(6, '0').substring(0, 6);
  } else {
    micros = pad(d.getUTCMilliseconds(), 3) + '000';
  }

  return `${base}.${micros}Z`;
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
    let resOutcome: DispatchReservationResult | undefined;
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

      // Step C.5: Final Pre-Dispatch Eligibility Check for Installment Reminders (Worker Race Protection)
      if (
        ['INS-03', 'INS-04', 'INS-05', 'INS-06'].includes(job.event_type) &&
        typeof db.isInstallmentReminderEligible === 'function'
      ) {
        let isEligible = false;
        try {
          isEligible = await db.isInstallmentReminderEligible(job.payload, job.event_type);
        } catch (eligibilityErr) {
          console.warn(
            `[email-worker] Pre-dispatch eligibility check error for ${job.event_type} (${job.queue_id}):`,
            eligibilityErr
          );
          isEligible = false; // Fail closed
        }

        if (!isEligible) {
          await db.cancelJob(
            job.queue_id,
            'STALE_REMINDER: Obligation paid, rescheduled, or ineligible at dispatch time'
          );
          result.cancelled++;
          result.details.push({
            queueId: job.queue_id,
            eventType: job.event_type,
            recipientEmail: job.recipient_email,
            action: 'cancelled',
            reason: 'STALE_REMINDER: Obligation paid, rescheduled, or ineligible at dispatch time',
          });
          continue;
        }
      }

      // Step C.6: Final Pre-Dispatch Eligibility Check for Exam Result Release (Worker Race Protection)
      if (job.event_type === 'EXM-01') {
        // Eligibility check is mandatory for EXM-01: missing verification checker must never allow dispatch
        if (typeof db.checkMockResultReleaseEligibility !== 'function') {
          const errorMsg = 'ELIGIBILITY_CHECKER_UNAVAILABLE: checkMockResultReleaseEligibility is not implemented';
          const delaySeconds = calculateBackoffSeconds(job.attempts);
          const retryOutcome = await db.scheduleRetry(job.queue_id, errorMsg, delaySeconds);
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
          continue;
        }

        let releaseCheck: MockResultEligibility;
        try {
          releaseCheck = await db.checkMockResultReleaseEligibility(job.payload);
        } catch (eligibilityErr) {
          const errMsg = eligibilityErr instanceof Error ? eligibilityErr.message : String(eligibilityErr);
          console.warn(
            `[email-worker] Pre-dispatch release eligibility transient error for ${job.event_type} (${job.queue_id}):`,
            eligibilityErr
          );
          // Transient verification failure (e.g. temporary DB connection error / timeout) -> schedule retry
          const delaySeconds = calculateBackoffSeconds(job.attempts);
          const retryOutcome = await db.scheduleRetry(job.queue_id, `VERIFICATION_QUERY_ERROR: ${errMsg}`, delaySeconds);
          if (retryOutcome.status === 'failed') {
            result.failed++;
            result.details.push({
              queueId: job.queue_id,
              eventType: job.event_type,
              recipientEmail: job.recipient_email,
              action: 'failed',
              reason: `MAX_RETRIES_EXCEEDED: VERIFICATION_QUERY_ERROR: ${errMsg}`,
            });
          } else {
            result.retried++;
            result.details.push({
              queueId: job.queue_id,
              eventType: job.event_type,
              recipientEmail: job.recipient_email,
              action: 'retried',
              reason: `VERIFICATION_QUERY_ERROR: ${errMsg}`,
            });
          }
          continue;
        }

        // If eligibility checker returned an explicit transient failure:
        if (!releaseCheck.eligible && releaseCheck.isTransient) {
          const errorMsg = releaseCheck.cancelReason || 'TRANSIENT_VERIFICATION_FAILURE';
          const delaySeconds = calculateBackoffSeconds(job.attempts);
          const retryOutcome = await db.scheduleRetry(job.queue_id, errorMsg, delaySeconds);
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
          continue;
        }

        // Permanent ineligibility (unreleased, superseded, wrong attempt/test ID, result not found, etc.)
        if (!releaseCheck.eligible) {
          const cancelReason = releaseCheck.cancelReason || 'TEST_RESULT_UNRELEASED';
          await db.cancelJob(job.queue_id, cancelReason);
          result.cancelled++;
          result.details.push({
            queueId: job.queue_id,
            eventType: job.event_type,
            recipientEmail: job.recipient_email,
            action: 'cancelled',
            reason: cancelReason,
          });
          continue;
        }

        // Step C.7: Acquire Attempt-Level Dispatch Reservation (Choice 1: Strict First-Only Concurrency Protection)
        const attemptId = job.payload?.attemptId as string | undefined;
        const testId = job.payload?.testId as string | undefined;
        const rawQueuedReleasedAt = job.payload?.releasedAt as string | undefined;
        const releaseGen = normalizePostgresTimestamp(rawQueuedReleasedAt) || rawQueuedReleasedAt || '';
        if (attemptId && testId && typeof db.acquireMockResultDispatchReservation === 'function') {
          try {
            resOutcome = await db.acquireMockResultDispatchReservation(
              attemptId,
              testId,
              job.queue_id,
              releaseGen
            );
          } catch (resErr) {
            const errMsg = resErr instanceof Error ? resErr.message : String(resErr);
            console.warn(
              `[email-worker] Reservation acquisition transient error for EXM-01 (${job.queue_id}):`,
              resErr
            );
            const delaySeconds = calculateBackoffSeconds(job.attempts);
            const retryOutcome = await db.scheduleRetry(
              job.queue_id,
              `RESERVATION_ACQUISITION_ERROR: ${errMsg}`,
              delaySeconds
            );
            if (retryOutcome.status === 'failed') {
              result.failed++;
              result.details.push({
                queueId: job.queue_id,
                eventType: job.event_type,
                recipientEmail: job.recipient_email,
                action: 'failed',
                reason: `MAX_RETRIES_EXCEEDED: RESERVATION_ACQUISITION_ERROR: ${errMsg}`,
              });
            } else {
              result.retried++;
              result.details.push({
                queueId: job.queue_id,
                eventType: job.event_type,
                recipientEmail: job.recipient_email,
                action: 'retried',
                reason: `RESERVATION_ACQUISITION_ERROR: ${errMsg}`,
              });
            }
            continue;
          }

          if (!resOutcome.success) {
            if (resOutcome.isTransient) {
              const reason = resOutcome.reason || 'CONCURRENT_DISPATCH_IN_PROGRESS';
              const delaySeconds = calculateBackoffSeconds(job.attempts);
              const retryOutcome = await db.scheduleRetry(job.queue_id, reason, delaySeconds);
              if (retryOutcome.status === 'failed') {
                result.failed++;
                result.details.push({
                  queueId: job.queue_id,
                  eventType: job.event_type,
                  recipientEmail: job.recipient_email,
                  action: 'failed',
                  reason: `MAX_RETRIES_EXCEEDED: ${reason}`,
                });
              } else {
                result.retried++;
                result.details.push({
                  queueId: job.queue_id,
                  eventType: job.event_type,
                  recipientEmail: job.recipient_email,
                  action: 'retried',
                  reason,
                });
              }
              continue;
            } else {
              // Permanent ineligibility: first notification already consumed or superseded
              const cancelReason = resOutcome.reason || 'FIRST_NOTIFICATION_ALREADY_CONSUMED';
              await db.cancelJob(job.queue_id, cancelReason);
              result.cancelled++;
              result.details.push({
                queueId: job.queue_id,
                eventType: job.event_type,
                recipientEmail: job.recipient_email,
                action: 'cancelled',
                reason: cancelReason,
              });
              continue;
            }
          }
        }
      }

      // Step D: Dispatch via Provider
      // Step D.1: Verify 24-hour Resend Idempotency Retention Window for retries
      // Resend guarantees 24-hour retention. We use a conservative safety margin of 23 hours.
      // Protection applies ONLY to retries of an actual provider operation (where providerRequestStartedAt is recorded).
      // A job that has never reached the provider is not subject to idempotency expiration.
      if (job.event_type === 'EXM-01') {
        const providerStartedAtStr = resOutcome?.providerRequestStartedAt;
        if (providerStartedAtStr) {
          const startedAtMs = new Date(providerStartedAtStr).getTime();
          const elapsedMs = Date.now() - startedAtMs;
          const TWENTY_THREE_HOURS_MS = 23 * 60 * 60 * 1000;

          if (startedAtMs > 0 && elapsedMs > TWENTY_THREE_HOURS_MS) {
            const timeoutReason =
              'IDEMPOTENCY_WINDOW_EXPIRED_MANUAL_RECONCILIATION_REQUIRED: Ambiguous dispatch cannot be safely retried after 23h window';
            if (
              typeof db.updateMockResultProviderOutcome === 'function' &&
              job.payload?.attemptId
            ) {
              try {
                await db.updateMockResultProviderOutcome(
                  job.payload.attemptId as string,
                  job.queue_id,
                  'outcome_unknown',
                  timeoutReason,
                  'blocked'
                );
              } catch {}
            }
            await db.markFailed(job.queue_id, timeoutReason);
            result.failed++;
            result.details.push({
              queueId: job.queue_id,
              eventType: job.event_type,
              recipientEmail: job.recipient_email,
              action: 'failed',
              reason: timeoutReason,
            });
            continue;
          }
        }
      }

      // Step D.2: Persist durable provider-request-started state BEFORE initiating external HTTP request
      // Mandatory for EXM-01: must never dispatch without successful durable preflight persistence
      if (job.event_type === 'EXM-01') {
        const exmAttemptId = job.payload?.attemptId as string | undefined;
        if (!exmAttemptId) {
          await db.cancelJob(job.queue_id, 'EXM_PAYLOAD_MISSING_ATTEMPT_ID');
          result.cancelled++;
          result.details.push({
            queueId: job.queue_id,
            eventType: job.event_type,
            recipientEmail: job.recipient_email,
            action: 'cancelled',
            reason: 'EXM_PAYLOAD_MISSING_ATTEMPT_ID',
          });
          continue;
        }

        if (typeof db.updateMockResultProviderOutcome !== 'function') {
          const delaySeconds = calculateBackoffSeconds(job.attempts);
          await db.scheduleRetry(
            job.queue_id,
            'PREFLIGHT_METHOD_MISSING: updateMockResultProviderOutcome required',
            delaySeconds
          );
          result.retried++;
          result.details.push({
            queueId: job.queue_id,
            eventType: job.event_type,
            recipientEmail: job.recipient_email,
            action: 'retried',
            reason: 'PREFLIGHT_METHOD_MISSING: updateMockResultProviderOutcome required',
          });
          continue;
        }

        let preflightSuccess = false;
        try {
          preflightSuccess = await db.updateMockResultProviderOutcome(
            exmAttemptId,
            job.queue_id,
            'outcome_unknown',
            'PROVIDER_REQUEST_IN_FLIGHT'
          );
        } catch (preflightErr) {
          console.warn('[email-worker] Failed to persist provider request start:', preflightErr);
          const delaySeconds = calculateBackoffSeconds(job.attempts);
          await db.scheduleRetry(job.queue_id, 'PROVIDER_PREFLIGHT_ERROR', delaySeconds);
          result.retried++;
          result.details.push({
            queueId: job.queue_id,
            eventType: job.event_type,
            recipientEmail: job.recipient_email,
            action: 'retried',
            reason: 'PROVIDER_PREFLIGHT_ERROR',
          });
          continue;
        }

        if (!preflightSuccess) {
          // Preflight update affected 0 rows -> reservation ownership mismatch or already consumed
          const delaySeconds = calculateBackoffSeconds(job.attempts);
          await db.scheduleRetry(
            job.queue_id,
            'RESERVATION_OWNERSHIP_MISMATCH_OR_CONSUMED',
            delaySeconds
          );
          result.retried++;
          result.details.push({
            queueId: job.queue_id,
            eventType: job.event_type,
            recipientEmail: job.recipient_email,
            action: 'retried',
            reason: 'RESERVATION_OWNERSHIP_MISMATCH_OR_CONSUMED',
          });
          continue;
        }
      }

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
        // Atomic recording of provider acceptance + consumption
        if (
          job.event_type === 'EXM-01' &&
          typeof db.recordMockResultSuccess === 'function' &&
          job.payload?.attemptId
        ) {
          try {
            await db.recordMockResultSuccess(
              job.queue_id,
              job.payload.attemptId as string,
              sendResult.providerMessageId
            );
          } catch (atomicRecordErr) {
            console.warn(`[email-worker] recordMockResultSuccess error:`, atomicRecordErr);
            await db.recordSuccess(job.queue_id, sendResult.providerMessageId);
            if (typeof db.consumeMockResultDispatchReservation === 'function') {
              await db.consumeMockResultDispatchReservation(
                job.payload.attemptId as string,
                job.queue_id,
                sendResult.providerMessageId
              );
            }
          }
        } else {
          await db.recordSuccess(job.queue_id, sendResult.providerMessageId);

          if (
            job.event_type === 'EXM-01' &&
            typeof db.consumeMockResultDispatchReservation === 'function' &&
            job.payload?.attemptId
          ) {
            try {
              await db.consumeMockResultDispatchReservation(
                job.payload.attemptId as string,
                job.queue_id,
                sendResult.providerMessageId
              );
            } catch (consumeErr) {
              console.warn(
                `[email-worker] Warning: consumeMockResultDispatchReservation failed for ${job.queue_id}:`,
                consumeErr
              );
            }
          }
        }

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
          // Outcome is unknown (socket timeout, 5xx gateway error, network drop)
          if (
            job.event_type === 'EXM-01' &&
            typeof db.updateMockResultProviderOutcome === 'function' &&
            job.payload?.attemptId
          ) {
            try {
              await db.updateMockResultProviderOutcome(
                job.payload.attemptId as string,
                job.queue_id,
                'outcome_unknown',
                errorMsg
              );
            } catch (outErr) {
              console.warn(`[email-worker] updateMockResultProviderOutcome error:`, outErr);
            }
          }

          const delaySeconds =
            sendResult.retryAfterSeconds ??
            calculateBackoffSeconds(job.attempts);

          const retryOutcome = await db.scheduleRetry(
            job.queue_id,
            errorMsg,
            delaySeconds
          );

          if (retryOutcome.status === 'failed') {
            // Max retries exceeded after ambiguous outcome
            // Crucial: DO NOT release reservation! Retain in blocked state!
            if (
              job.event_type === 'EXM-01' &&
              typeof db.updateMockResultProviderOutcome === 'function' &&
              job.payload?.attemptId
            ) {
              try {
                await db.updateMockResultProviderOutcome(
                  job.payload.attemptId as string,
                  job.queue_id,
                  'outcome_unknown',
                  `MAX_RETRIES_EXCEEDED: ${errorMsg}`,
                  'blocked'
                );
              } catch (outErr) {
                console.warn(`[email-worker] updateMockResultProviderOutcome error:`, outErr);
              }
            }

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
          // Permanent failure (e.g. 400, 401, 403, 409, 422)
          // Distinguish:
          // 1. Ambiguous permanent failure (e.g. 409 invalid_idempotent_request, 400 key format error)
          // 2. Failure occurring on a retry after an earlier ambiguous attempt:
          //    A later HTTP rejection (401, 403, 422) on a retry does NOT prove the original attempt was never accepted!
          //    Must preserve outcome_unknown, block reservation, and forbid release.
          // 3. Genuine first-attempt definitive rejection:
          //    Initial request (no prior ambiguous attempt) received verified definitive 4xx (e.g. 422).
          const hasPriorAmbiguousAttempt =
            job.attempts > 0 ||
            Boolean(
              resOutcome?.providerRequestStartedAt &&
              resOutcome.reason === 'RESERVATION_RENEWED_AMBIGUOUS_RETRY'
            );

          const isAmbiguousOutcome =
            sendResult.isAmbiguous === true ||
            (job.event_type === 'EXM-01' && hasPriorAmbiguousAttempt);

          if (isAmbiguousOutcome) {
            // Ambiguous outcome: previous operation may have been accepted with another payload or timed out.
            // DO NOT release reservation! Retain in blocked state requiring manual investigation!
            const reasonPrefix = hasPriorAmbiguousAttempt && sendResult.isAmbiguous !== true
              ? 'AMBIGUOUS_RETRY_PERMANENT_ERROR'
              : 'AMBIGUOUS_PROVIDER_ERROR';

            if (
              job.event_type === 'EXM-01' &&
              typeof db.updateMockResultProviderOutcome === 'function' &&
              job.payload?.attemptId
            ) {
              try {
                await db.updateMockResultProviderOutcome(
                  job.payload.attemptId as string,
                  job.queue_id,
                  'outcome_unknown',
                  `${reasonPrefix}: ${errorMsg}`,
                  'blocked'
                );
              } catch (outErr) {
                console.warn(`[email-worker] updateMockResultProviderOutcome error:`, outErr);
              }
            }

            await db.markFailed(job.queue_id, `${reasonPrefix}: ${errorMsg}`);
            result.failed++;
            result.details.push({
              queueId: job.queue_id,
              eventType: job.event_type,
              recipientEmail: job.recipient_email,
              action: 'failed',
              reason: `${reasonPrefix}: ${errorMsg}`,
            });
          } else {
            // Genuine first-attempt definitive rejection: Resend definitely did not accept or deliver this message
            if (
              job.event_type === 'EXM-01' &&
              typeof db.updateMockResultProviderOutcome === 'function' &&
              job.payload?.attemptId
            ) {
              try {
                await db.updateMockResultProviderOutcome(
                  job.payload.attemptId as string,
                  job.queue_id,
                  'definitively_rejected',
                  `PERMANENT_ERROR: ${errorMsg}`
                );
              } catch {}
            }

            if (
              job.event_type === 'EXM-01' &&
              typeof db.releaseMockResultDispatchReservation === 'function' &&
              job.payload?.attemptId
            ) {
              try {
                await db.releaseMockResultDispatchReservation(
                  job.payload.attemptId as string,
                  job.queue_id,
                  `PERMANENT_ERROR: ${errorMsg}`
                );
              } catch (relErr) {
                console.warn(`[email-worker] Warning: release reservation failed:`, relErr);
              }
            }

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

    async isInstallmentReminderEligible(
      payload: Record<string, unknown>,
      eventType?: string
    ): Promise<boolean> {
      try {
        const scheduleId = payload?.scheduleId as string | undefined;
        const agreementId = payload?.agreementId as string | undefined;
        const effectiveDueDate = (payload?.effectiveDueDate || payload?.dueDate) as string | undefined;

        // Resolve current calendar date in Asia/Kolkata (YYYY-MM-DD)
        const nowIst = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

        if (scheduleId) {
          const { data: sched, error: schedError } = await supabaseClient
            .from('student_installment_schedule')
            .select('status, amount_due, amount_paid, waiver_amount, revised_due_date, due_date')
            .eq('schedule_id', scheduleId)
            .maybeSingle();

          if (schedError || !sched) return false;

          // Status allowlist: only pending and overdue can receive reminders
          if (!['pending', 'overdue'].includes(sched.status)) return false;

          // Must have positive remaining unpaid obligation
          const unpaid = Number(sched.amount_due) - Number(sched.amount_paid) - Number(sched.waiver_amount);
          if (unpaid <= 0) return false;

          // Effective due date must still match the queued date
          const currentEffective = (sched.revised_due_date || sched.due_date) as string;
          if (effectiveDueDate && currentEffective !== effectiveDueDate) {
            return false;
          }

          // Event-specific timing validity:
          if (eventType && currentEffective) {
            // If due date has already passed, INS-03 (T-3) and INS-04 (T-0) are obsolete
            if (['INS-03', 'INS-04'].includes(eventType) && nowIst > currentEffective) {
              return false;
            }
            // If 7+ days past due date, INS-05 (T+1 alert) is obsolete
            if (eventType === 'INS-05') {
              const effectiveDateObj = new Date(currentEffective);
              const nowIstObj = new Date(nowIst);
              const diffDays = Math.floor((nowIstObj.getTime() - effectiveDateObj.getTime()) / (86400 * 1000));
              if (diffDays >= 7) {
                return false;
              }
            }
          }
        }

        if (agreementId) {
          const { data: agr, error: agrError } = await supabaseClient
            .from('student_course_agreements')
            .select('agreement_status, outstanding_balance, requires_admin_review')
            .eq('agreement_id', agreementId)
            .maybeSingle();

          if (agrError || !agr) return false;

          // Status allowlist: only active and in_arrears
          if (!['active', 'in_arrears'].includes(agr.agreement_status)) {
            return false;
          }
          if (Boolean(agr.requires_admin_review)) {
            return false;
          }
          if (Number(agr.outstanding_balance) <= 0) {
            return false;
          }
        }

        return true;
      } catch (err) {
        console.warn('[email-worker] isInstallmentReminderEligible failed closed:', err);
        return false; // Fail closed: unvalidated reminder is cancelled rather than sent
      }
    },

    async checkMockResultReleaseEligibility(
      payload: Record<string, unknown>
    ): Promise<MockResultEligibility> {
      try {
        const attemptId = payload?.attemptId as string | undefined;
        const testId = payload?.testId as string | undefined;
        const rawQueuedReleasedAt = payload?.releasedAt as string | undefined;

        // 1. Mandatory metadata validation (fails closed with distinct reasons)
        if (!attemptId || typeof attemptId !== 'string') {
          return { eligible: false, cancelReason: 'TEST_RESULT_MISSING_ATTEMPT_ID' };
        }
        if (!testId || typeof testId !== 'string') {
          return { eligible: false, cancelReason: 'TEST_RESULT_MISSING_TEST_ID' };
        }
        if (!rawQueuedReleasedAt || typeof rawQueuedReleasedAt !== 'string') {
          return { eligible: false, cancelReason: 'TEST_RESULT_MISSING_RELEASED_AT' };
        }

        const queuedNormalized = normalizePostgresTimestamp(rawQueuedReleasedAt);
        if (!queuedNormalized) {
          return { eligible: false, cancelReason: 'TEST_RESULT_MALFORMED_RELEASED_AT' };
        }

        // 2. Preferred: Database-Side RPC Verification (Exact microsecond timestamptz equality)
        if (typeof supabaseClient?.rpc === 'function') {
          try {
            const rpcResponse = await supabaseClient.rpc(
              'check_mock_result_release_eligibility',
              {
                p_attempt_id: attemptId,
                p_test_id: testId,
                p_queued_released_at: rawQueuedReleasedAt,
              }
            );

            if (rpcResponse) {
              const { data: rpcData, error: rpcError } = rpcResponse;

              if (!rpcError && rpcData && typeof rpcData === 'object') {
                if (rpcData.eligible === true) {
                  return { eligible: true };
                }
                return {
                  eligible: false,
                  cancelReason: rpcData.cancel_reason || 'TEST_RESULT_INELIGIBLE',
                };
              }

              // Distinguish undefined function error (42883) from actual transient RPC network/connection failures
              if (rpcError && rpcError.code !== '42883') {
                return {
                  eligible: false,
                  isTransient: true,
                  cancelReason: `RPC_TRANSIENT_ERROR: ${rpcError.message || String(rpcError)}`,
                };
              }
            }
          } catch (rpcCallErr) {
            // If RPC call throws network/connection error, mark as transient
            return {
              eligible: false,
              isTransient: true,
              cancelReason: `RPC_EXCEPTION: ${rpcCallErr instanceof Error ? rpcCallErr.message : String(rpcCallErr)}`,
            };
          }
        }

        // 3. Fallback: Exact Table Query Verification (Preserving full microsecond precision)
        // Choice 1 First-Only Check: Verify no notification already consumed for this attempt
        try {
          const { data: dispatchRecord } = await supabaseClient
            .from('mock_result_email_dispatches')
            .select('status')
            .eq('attempt_id', attemptId)
            .eq('status', 'consumed')
            .maybeSingle();

          if (dispatchRecord) {
            return { eligible: false, cancelReason: 'FIRST_NOTIFICATION_ALREADY_CONSUMED' };
          }
        } catch {}

        const { data: resultRecord, error: resultError } = await supabaseClient
          .from('mock_results')
          .select('is_released, released_at, test_id, attempt_id')
          .eq('attempt_id', attemptId)
          .maybeSingle();

        if (resultError) {
          return {
            eligible: false,
            isTransient: true,
            cancelReason: `QUERY_ERROR: ${resultError.message || String(resultError)}`,
          };
        }

        if (!resultRecord) {
          return { eligible: false, cancelReason: 'TEST_RESULT_NOT_FOUND' };
        }

        // 4. Test ID Match Verification
        if (resultRecord.test_id !== testId) {
          return { eligible: false, cancelReason: 'TEST_RESULT_TEST_ID_MISMATCH' };
        }

        // 5. Publication State Verification
        if (!resultRecord.is_released) {
          return { eligible: false, cancelReason: 'TEST_RESULT_UNRELEASED' };
        }

        // 6. Database Release Timestamp Verification
        if (!resultRecord.released_at) {
          return { eligible: false, cancelReason: 'TEST_RESULT_DATABASE_RELEASED_AT_NULL' };
        }

        const dbNormalized = normalizePostgresTimestamp(resultRecord.released_at);
        if (!dbNormalized) {
          return { eligible: false, cancelReason: 'TEST_RESULT_DATABASE_RELEASED_AT_MALFORMED' };
        }

        // 7. Exact Microsecond Timestamp Match (older or differing release cycle rejected)
        if (queuedNormalized !== dbNormalized) {
          return { eligible: false, cancelReason: 'TEST_RESULT_RELEASE_SUPERSEDED' };
        }

        return { eligible: true };
      } catch (err) {
        console.warn('[email-worker] checkMockResultReleaseEligibility transient error:', err);
        return {
          eligible: false,
          isTransient: true,
          cancelReason: `VERIFICATION_EXCEPTION: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },

    async acquireMockResultDispatchReservation(
      attemptId: string,
      testId: string,
      queueId: string,
      releaseGeneration: string
    ): Promise<DispatchReservationResult> {
      try {
        if (typeof supabaseClient?.rpc === 'function') {
          try {
            const rpcResponse = await supabaseClient.rpc(
              'acquire_mock_result_dispatch_reservation',
              {
                p_attempt_id: attemptId,
                p_test_id: testId,
                p_queue_id: queueId,
                p_release_generation: releaseGeneration,
              }
            );

            if (rpcResponse) {
              const { data: rpcData, error: rpcError } = rpcResponse;
              if (!rpcError && rpcData && typeof rpcData === 'object') {
                return {
                  success: Boolean(rpcData.success),
                  reason: rpcData.reason,
                  isTransient: Boolean(rpcData.is_transient),
                  consumedAt: rpcData.consumed_at,
                  providerMessageId: rpcData.provider_message_id,
                  providerRequestStartedAt: rpcData.provider_request_started_at,
                };
              }
              if (rpcError && rpcError.code !== '42883') {
                return {
                  success: false,
                  isTransient: true,
                  reason: `RPC_TRANSIENT_ERROR: ${rpcError.message || String(rpcError)}`,
                };
              }
            }
          } catch (rpcErr) {
            return {
              success: false,
              isTransient: true,
              reason: `RPC_EXCEPTION: ${rpcErr instanceof Error ? rpcErr.message : String(rpcErr)}`,
            };
          }
        }

        // Fallback: Table-level atomic logic
        const { data: existing, error: selectErr } = await supabaseClient
          .from('mock_result_email_dispatches')
          .select('*')
          .eq('attempt_id', attemptId)
          .maybeSingle();

        if (selectErr) {
          return {
            success: false,
            isTransient: true,
            reason: `QUERY_ERROR: ${selectErr.message || String(selectErr)}`,
          };
        }

        if (existing) {
          if (existing.status === 'consumed') {
            return {
              success: false,
              reason: 'FIRST_NOTIFICATION_ALREADY_CONSUMED',
              isTransient: false,
              consumedAt: existing.consumed_at,
              providerMessageId: existing.provider_message_id,
            };
          }

          if (existing.status === 'blocked' || existing.provider_outcome === 'outcome_unknown') {
            if (existing.reserved_by_queue_id === queueId && existing.status !== 'blocked') {
              return { success: true, reason: 'RESERVATION_RENEWED_AMBIGUOUS_RETRY' };
            }
            return {
              success: false,
              reason: 'PROVIDER_OUTCOME_UNKNOWN_BLOCKED',
              isTransient: false,
            };
          }

          if (existing.reserved_by_queue_id === queueId) {
            if (existing.release_generation === releaseGeneration) {
              return { success: true, reason: 'RESERVATION_RENEWED' };
            } else {
              return { success: false, reason: 'TEST_RESULT_RELEASE_SUPERSEDED', isTransient: false };
            }
          }

          // Check status of job holding the reservation
          const { data: reserverJob } = await supabaseClient
            .from('email_queue')
            .select('status, sent_at, provider_message_id')
            .eq('queue_id', existing.reserved_by_queue_id)
            .maybeSingle();

          if (reserverJob?.status === 'sent') {
            await supabaseClient
              .from('mock_result_email_dispatches')
              .update({
                status: 'consumed',
                provider_outcome: 'provider_accepted',
                consumed_at: reserverJob.sent_at || new Date().toISOString(),
                provider_message_id: reserverJob.provider_message_id,
              })
              .eq('attempt_id', attemptId);

            return { success: false, reason: 'FIRST_NOTIFICATION_ALREADY_CONSUMED', isTransient: false };
          }

          // Allow transfer ONLY if provider outcome was not_dispatched or definitively_rejected
          if (
            ['not_dispatched', 'definitively_rejected'].includes(existing.provider_outcome || 'not_dispatched') &&
            (!reserverJob || ['cancelled', 'failed'].includes(reserverJob.status))
          ) {
            const { error: updateErr } = await supabaseClient
              .from('mock_result_email_dispatches')
              .update({
                test_id: testId,
                reserved_by_queue_id: queueId,
                release_generation: releaseGeneration,
                status: 'reserved',
                provider_outcome: 'not_dispatched',
                reserved_at: new Date().toISOString(),
                last_error: null,
              })
              .eq('attempt_id', attemptId);

            if (updateErr) {
              return { success: false, isTransient: true, reason: updateErr.message };
            }
            return { success: true, reason: 'RESERVATION_ACQUIRED_FROM_CANCELLED' };
          }

          if (existing.provider_outcome === 'outcome_unknown') {
            return {
              success: false,
              reason: 'PROVIDER_OUTCOME_UNKNOWN_BLOCKED',
              isTransient: false,
            };
          }

          return {
            success: false,
            reason: 'CONCURRENT_DISPATCH_IN_PROGRESS',
            isTransient: true,
          };
        }

        // Insert fresh reservation
        const { error: insertErr } = await supabaseClient
          .from('mock_result_email_dispatches')
          .insert({
            attempt_id: attemptId,
            test_id: testId,
            reserved_by_queue_id: queueId,
            release_generation: releaseGeneration,
            status: 'reserved',
            provider_outcome: 'not_dispatched',
          });

        if (insertErr) {
          const { data: reread } = await supabaseClient
            .from('mock_result_email_dispatches')
            .select('*')
            .eq('attempt_id', attemptId)
            .maybeSingle();

          if (reread?.status === 'consumed') {
            return { success: false, reason: 'FIRST_NOTIFICATION_ALREADY_CONSUMED', isTransient: false };
          }
          if (reread?.reserved_by_queue_id === queueId) {
            return { success: true, reason: 'RESERVATION_OWNED' };
          }
          if (reread?.status === 'blocked' || reread?.provider_outcome === 'outcome_unknown') {
            return { success: false, reason: 'PROVIDER_OUTCOME_UNKNOWN_BLOCKED', isTransient: false };
          }
          return { success: false, reason: 'CONCURRENT_DISPATCH_IN_PROGRESS', isTransient: true };
        }

        return { success: true, reason: 'RESERVATION_ACQUIRED' };
      } catch (err) {
        return {
          success: false,
          isTransient: true,
          reason: `RESERVATION_EXCEPTION: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },

    async consumeMockResultDispatchReservation(
      attemptId: string,
      queueId: string,
      providerMessageId?: string
    ): Promise<boolean> {
      try {
        if (typeof supabaseClient?.rpc === 'function') {
          const { data, error } = await supabaseClient.rpc(
            'consume_mock_result_dispatch_reservation',
            {
              p_attempt_id: attemptId,
              p_queue_id: queueId,
              p_provider_message_id: providerMessageId || null,
            }
          );
          if (!error && typeof data === 'boolean') return data;
        }

        const { error } = await supabaseClient
          .from('mock_result_email_dispatches')
          .update({
            status: 'consumed',
            provider_outcome: 'provider_accepted',
            consumed_at: new Date().toISOString(),
            provider_message_id: providerMessageId || null,
            updated_at: new Date().toISOString(),
          })
          .eq('attempt_id', attemptId)
          .eq('reserved_by_queue_id', queueId);

        return !error;
      } catch (err) {
        console.warn('[email-worker] consumeMockResultDispatchReservation error:', err);
        return false;
      }
    },

    async releaseMockResultDispatchReservation(
      attemptId: string,
      queueId: string,
      reason?: string
    ): Promise<boolean> {
      try {
        if (typeof supabaseClient?.rpc === 'function') {
          const { data, error } = await supabaseClient.rpc(
            'release_mock_result_dispatch_reservation',
            {
              p_attempt_id: attemptId,
              p_queue_id: queueId,
              p_reason: reason || null,
            }
          );
          if (!error && typeof data === 'boolean') return data;
        }

        const { error } = await supabaseClient
          .from('mock_result_email_dispatches')
          .delete()
          .eq('attempt_id', attemptId)
          .eq('reserved_by_queue_id', queueId)
          .eq('status', 'reserved')
          .in('provider_outcome', ['not_dispatched', 'definitively_rejected']);

        return !error;
      } catch (err) {
        console.warn('[email-worker] releaseMockResultDispatchReservation error:', err);
        return false;
      }
    },

    async updateMockResultProviderOutcome(
      attemptId: string,
      queueId: string,
      outcome: 'not_dispatched' | 'definitively_rejected' | 'outcome_unknown' | 'provider_accepted',
      error?: string,
      status?: 'reserved' | 'consumed' | 'blocked'
    ): Promise<boolean> {
      try {
        if (typeof supabaseClient?.rpc === 'function') {
          const { data, error: rpcErr } = await supabaseClient.rpc(
            'update_mock_result_provider_outcome',
            {
              p_attempt_id: attemptId,
              p_queue_id: queueId,
              p_provider_outcome: outcome,
              p_error: error || null,
              p_status: status || null,
            }
          );
          if (!rpcErr && typeof data === 'boolean') return data;
        }

        const updatePayload: Record<string, unknown> = {
          provider_outcome: outcome,
          last_error: error || null,
          updated_at: new Date().toISOString(),
        };
        if (status) updatePayload.status = status;

        const { error: dbErr } = await supabaseClient
          .from('mock_result_email_dispatches')
          .update(updatePayload)
          .eq('attempt_id', attemptId)
          .eq('reserved_by_queue_id', queueId);

        return !dbErr;
      } catch (err) {
        console.warn('[email-worker] updateMockResultProviderOutcome error:', err);
        return false;
      }
    },

    async recordMockResultSuccess(
      queueId: string,
      attemptId: string,
      providerMessageId?: string
    ): Promise<boolean> {
      try {
        if (typeof supabaseClient?.rpc === 'function') {
          const { data, error } = await supabaseClient.rpc(
            'record_mock_result_email_success',
            {
              p_queue_id: queueId,
              p_attempt_id: attemptId,
              p_provider_message_id: providerMessageId || null,
            }
          );
          if (!error && typeof data === 'boolean') return data;
        }

        await this.recordSuccess(queueId, providerMessageId);
        await this.consumeMockResultDispatchReservation?.(attemptId, queueId, providerMessageId);
        return true;
      } catch (err) {
        console.warn('[email-worker] recordMockResultSuccess error:', err);
        return false;
      }
    },
  };
}

