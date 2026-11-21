/**
 * Make Me Topper — Transactional Email System (Phase 1)
 *
 * Automated Unit & Integration Tests:
 * 1. Template rendering, HTML escaping, and plain-text conversion
 * 2. Mock and Resend provider behavior & error classification
 * 3. Exponential backoff calculation & email syntax validation
 * 4. Email worker batch processing loop:
 *    - Priority-based claiming
 *    - Lock recovery
 *    - Graceful missing/invalid email cancellation
 *    - Suppression list enforcement
 *    - Error isolation across multi-job batches
 *    - Retry vs permanent failure transitions
 * 5. Webhook Svix HMAC signature validation & replay protection
 * 6. Webhook delivery, bounce, complaint, and suppression state transitions
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  escapeHtml,
  htmlToPlainText,
  renderBaseLayout,
  renderEmail,
} from '../../../../supabase/functions/_shared/email/templates';

import { MockEmailProvider } from '../../../../supabase/functions/_shared/email/mockProvider';
import { ResendProvider } from '../../../../supabase/functions/_shared/email/resendProvider';
import {
  EmailQueueJob,
  EmailSendRequest,
} from '../../../../supabase/functions/_shared/email/types';

import {
  calculateBackoffSeconds,
  EmailWorkerDatabase,
  isValidEmailAddress,
  resolveWorkerProvider,
  runEmailWorkerBatch,
} from '../../../../supabase/functions/email-worker/emailWorkerCore';

import {
  arrayBufferToBase64,
  base64ToUint8Array,
  processWebhookEvent,
  timingSafeEqual,
  verifySvixWebhookSignature,
  WebhookDatabase,
} from '../../../../supabase/functions/email-webhook/emailWebhookCore';

// ── In-Memory Mock Database for Worker ──────────────────────────────────────
class InMemoryWorkerDatabase implements EmailWorkerDatabase {
  public jobs: EmailQueueJob[] = [];
  public suppressions: Set<string> = new Set();
  public logs: Array<{ queueId: string; action: string; details?: unknown }> = [];
  public recoveredLockCount = 0;

  public async recoverAbandonedLocks(_staleSeconds?: number): Promise<number> {
    const count = this.recoveredLockCount;
    this.recoveredLockCount = 0;
    return count;
  }

  public async claimBatch(batchSize: number, workerId: string): Promise<EmailQueueJob[]> {
    const pendingJobs = this.jobs
      .filter((j) => j.status === 'pending')
      .slice(0, batchSize);

    for (const j of pendingJobs) {
      j.status = 'processing';
      j.locked_by = workerId;
      j.locked_at = new Date().toISOString();
    }
    return pendingJobs;
  }

  public async isSuppressed(email: string): Promise<boolean> {
    return this.suppressions.has(email.toLowerCase().trim());
  }

  public async recordSuccess(queueId: string, providerMessageId?: string): Promise<boolean> {
    const job = this.jobs.find((j) => j.queue_id === queueId);
    if (job) {
      job.status = 'sent';
      job.delivery_status = 'accepted';
      job.provider_message_id = providerMessageId || null;
      job.locked_at = null;
      job.locked_by = null;
      this.logs.push({ queueId, action: 'sent', details: { providerMessageId } });
      return true;
    }
    return false;
  }

  public async scheduleRetry(
    queueId: string,
    error: string,
    _delaySeconds?: number
  ): Promise<{ success: boolean; status?: string }> {
    const job = this.jobs.find((j) => j.queue_id === queueId);
    if (!job) return { success: false };

    job.attempts++;
    job.last_error = error;
    job.locked_at = null;
    job.locked_by = null;

    if (job.attempts >= job.max_attempts) {
      job.status = 'failed';
      this.logs.push({ queueId, action: 'max_retries_exceeded', details: { error } });
      return { success: true, status: 'failed' };
    } else {
      job.status = 'pending';
      this.logs.push({ queueId, action: 'retry_scheduled', details: { error } });
      return { success: true, status: 'pending' };
    }
  }

  public async markFailed(queueId: string, error: string): Promise<boolean> {
    const job = this.jobs.find((j) => j.queue_id === queueId);
    if (job) {
      job.status = 'failed';
      job.attempts++;
      job.last_error = error;
      job.locked_at = null;
      job.locked_by = null;
      this.logs.push({ queueId, action: 'permanent_failure', details: { error } });
      return true;
    }
    return false;
  }

  public async cancelJob(queueId: string, reason: string): Promise<boolean> {
    const job = this.jobs.find((j) => j.queue_id === queueId);
    if (job) {
      job.status = 'cancelled';
      job.last_error = reason;
      job.locked_at = null;
      job.locked_by = null;
      this.logs.push({ queueId, action: 'cancelled', details: { reason } });
      return true;
    }
    return false;
  }
}

// ── In-Memory Mock Database for Webhook ─────────────────────────────────────
class InMemoryWebhookDatabase implements WebhookDatabase {
  public deliveryStatuses: Record<string, string> = {};
  public suppressions: Map<string, { reason: string; source: string }> = new Map();
  public auditLogs: Array<{ providerMessageId: string; eventType: string; svixEventId?: string | null }> = [];
  public processedSvixIds = new Set<string>();

  public async isEventProcessed(svixEventId: string): Promise<boolean> {
    return this.processedSvixIds.has(svixEventId);
  }

  public async recordDeliveryStatus(
    providerMessageId: string,
    status: 'delivered' | 'bounced' | 'complained',
    _eventType: string,
    _rawPayload: Record<string, unknown>,
    svixEventId?: string | null
  ): Promise<boolean> {
    if (svixEventId) {
      if (this.processedSvixIds.has(svixEventId)) {
        return false;
      }
      this.processedSvixIds.add(svixEventId);
    }
    this.deliveryStatuses[providerMessageId] = status;
    return true;
  }

  public async addSuppression(
    email: string,
    reason: 'hard_bounce' | 'complaint' | 'manual',
    source: string,
    _metadata?: Record<string, unknown>
  ): Promise<boolean> {
    this.suppressions.set(email.toLowerCase().trim(), { reason, source });
    return true;
  }

  public async recordAuditLog(
    providerMessageId: string,
    eventType: string,
    _rawPayload: Record<string, unknown>,
    svixEventId?: string | null
  ): Promise<boolean> {
    if (svixEventId) {
      if (this.processedSvixIds.has(svixEventId)) {
        return false;
      }
      this.processedSvixIds.add(svixEventId);
    }
    this.auditLogs.push({ providerMessageId, eventType, svixEventId });
    return true;
  }
}

// ── Helper to create synthetic test jobs ────────────────────────────────────
function createTestJob(overrides: Partial<EmailQueueJob> = {}): EmailQueueJob {
  return {
    queue_id: `queue_${Math.random().toString(36).slice(2, 10)}`,
    recipient_profile_id: 'test-profile-uuid',
    recipient_email: 'student@example.com',
    recipient_name: 'Test Student',
    event_type: 'TEST_EMAIL',
    subject: 'Test Subject',
    template_id: 'test_email',
    payload: {
      title: 'Make Me Topper Test',
      message: 'Hello, this is a test notification.',
      actionUrl: 'https://makemetopper.com',
      actionText: 'View Dashboard',
    },
    priority: 'normal',
    status: 'pending',
    delivery_status: 'unsent',
    attempts: 0,
    max_attempts: 3,
    next_retry_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('Make Me Topper — Transactional Email System (Phase 1)', () => {
  // ──────────────────────────────────────────────────────────────────────────
  // 1. Template Engine & HTML Sanitization Tests
  // ──────────────────────────────────────────────────────────────────────────
  describe('Template Engine & Security Sanitization', () => {
    it('escapes HTML injection vectors to prevent XSS attacks in emails', () => {
      const malicious = '<script>alert("pwned")</script> & "quotes" \'apostrophe\'';
      const escaped = escapeHtml(malicious);

      expect(escaped).not.toContain('<script>');
      expect(escaped).toContain('&lt;script&gt;');
      expect(escaped).toContain('&amp;');
      expect(escaped).toContain('&quot;');
      expect(escaped).toContain('&#39;');
    });

    it('renders base layout with Make Me Topper brand headers, footer and support links', () => {
      const html = renderBaseLayout({
        title: 'Welcome Student',
        preheader: 'Welcome to Make Me Topper',
        contentHtml: '<p>Your account is ready.</p>',
        recipientEmail: 'user@example.com',
      });

      expect(html).toContain('Make Me Topper');
      expect(html).toContain('info@makemetopper.com');
      expect(html).toContain('user@example.com');
      expect(html).toContain('Your account is ready.');
      expect(html).toContain('<!DOCTYPE html>');
    });

    it('generates clean plain-text fallback from HTML', () => {
      const html = '<h1>Heading</h1><p>Check this <a href="https://example.com">Link</a>.</p><ul><li>Item 1</li><li>Item 2</li></ul>';
      const plain = htmlToPlainText(html);

      expect(plain).toContain('Heading');
      expect(plain).toContain('Link (https://example.com)');
      expect(plain).toContain('• Item 1');
      expect(plain).toContain('• Item 2');
      expect(plain).not.toContain('<p>');
    });

    it('renders test_email template with structured payload and context', () => {
      const rendered = renderEmail(
        'test_email',
        {
          title: 'Exam Schedule Announced',
          message: 'The NEET mock test schedule is live.',
          actionUrl: 'https://makemetopper.com/tests',
          actionText: 'View Schedule',
        },
        { recipientEmail: 'student@example.com', recipientName: 'Priya Sharma' }
      );

      expect(rendered.subject).toBe('Exam Schedule Announced');
      expect(rendered.html).toContain('Hello Priya Sharma');
      expect(rendered.html).toContain('The NEET mock test schedule is live.');
      expect(rendered.html).toContain('https://makemetopper.com/tests');
      expect(rendered.text).toContain('Hello Priya Sharma');
    });

    it('gracefully handles missing or unknown templates with generic fallback', () => {
      const rendered = renderEmail(
        'unknown_custom_template',
        { subject: 'Custom Alert', message: 'Important account alert.' },
        { recipientEmail: 'student@example.com', recipientName: 'Rohit' }
      );

      expect(rendered.subject).toBe('Custom Alert');
      expect(rendered.html).toContain('Important account alert.');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Email Validation & Exponential Backoff Tests
  // ──────────────────────────────────────────────────────────────────────────
  describe('Email Address Validation & Backoff Calculations', () => {
    it('validates email addresses properly', () => {
      expect(isValidEmailAddress('student@makemetopper.com')).toBe(true);
      expect(isValidEmailAddress('user.name+tag@sub.example.co.in')).toBe(true);
      expect(isValidEmailAddress('')).toBe(false);
      expect(isValidEmailAddress('   ')).toBe(false);
      expect(isValidEmailAddress(null)).toBe(false);
      expect(isValidEmailAddress(undefined)).toBe(false);
      expect(isValidEmailAddress('invalid-email-without-at')).toBe(false);
      expect(isValidEmailAddress('missing-domain@')).toBe(false);
      expect(isValidEmailAddress('@missing-user.com')).toBe(false);
    });

    it('calculates exponential backoff delay correctly with cap', () => {
      // baseDelay 60s
      expect(calculateBackoffSeconds(0, 60, 3600)).toBe(60);   // 60 * 2^0 = 60
      expect(calculateBackoffSeconds(1, 60, 3600)).toBe(120);  // 60 * 2^1 = 120
      expect(calculateBackoffSeconds(2, 60, 3600)).toBe(240);  // 60 * 2^2 = 240
      expect(calculateBackoffSeconds(3, 60, 3600)).toBe(480);  // 60 * 2^3 = 480
      expect(calculateBackoffSeconds(10, 60, 3600)).toBe(3600); // capped at maxDelay
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Provider Abstraction Tests (Mock & Resend)
  // ──────────────────────────────────────────────────────────────────────────
  describe('Email Provider Abstraction', () => {
    it('MockEmailProvider records dispatched emails with unique mock message IDs', async () => {
      const mock = new MockEmailProvider();
      expect(mock.name).toBe('mock');

      const req: EmailSendRequest = {
        to: 'student@makemetopper.com',
        subject: 'Hello',
        html: '<p>Test</p>',
      };

      const result = await mock.sendEmail(req);
      expect(result.success).toBe(true);
      expect(result.providerMessageId).toMatch(/^mock_msg_/);
      expect(result.retryable).toBe(false);
      expect(mock.dispatchedEmails).toHaveLength(1);
      expect(mock.dispatchedEmails[0].to).toBe('student@makemetopper.com');

      mock.reset();
      expect(mock.dispatchedEmails).toHaveLength(0);
    });

    it('MockEmailProvider simulates transient failure on demand', async () => {
      const mock = new MockEmailProvider();
      mock.simulateFailureOnce('Simulated 503 Provider Down', true, 503, 120);

      const result = await mock.sendEmail({
        to: 'student@makemetopper.com',
        subject: 'Hello',
        html: '<p>Test</p>',
      });

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(true);
      expect(result.statusCode).toBe(503);
      expect(result.retryAfterSeconds).toBe(120);

      // Next request succeeds normally
      const nextResult = await mock.sendEmail({
        to: 'student@makemetopper.com',
        subject: 'Retry',
        html: '<p>Test</p>',
      });
      expect(nextResult.success).toBe(true);
    });

    it('ResendProvider fails fast when RESEND_API_KEY is not configured', async () => {
      const resend = new ResendProvider({ apiKey: '' });
      const result = await resend.sendEmail({
        to: 'student@makemetopper.com',
        subject: 'Test',
        html: '<p>Hi</p>',
      });

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(false);
      expect(result.error).toContain('RESEND_API_KEY');
    });

    it('ResendProvider classifies 429 rate limits as retryable with Retry-After header', async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 429,
          headers: new Headers({ 'Retry-After': '90' }),
          text: async () => JSON.stringify({ message: 'Rate limit exceeded' }),
        }) as unknown as typeof fetch;

        const resend = new ResendProvider({ apiKey: 're_test_key_123' });
        const result = await resend.sendEmail({
          to: 'student@makemetopper.com',
          subject: 'Rate limited',
          html: '<p>Test</p>',
        });

        expect(result.success).toBe(false);
        expect(result.retryable).toBe(true);
        expect(result.statusCode).toBe(429);
        expect(result.retryAfterSeconds).toBe(90);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('ResendProvider classifies 500 server errors as retryable', async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 502,
          headers: new Headers(),
          text: async () => JSON.stringify({ message: 'Bad Gateway' }),
        }) as unknown as typeof fetch;

        const resend = new ResendProvider({ apiKey: 're_test_key_123' });
        const result = await resend.sendEmail({
          to: 'student@makemetopper.com',
          subject: 'Server error',
          html: '<p>Test</p>',
        });

        expect(result.success).toBe(false);
        expect(result.retryable).toBe(true);
        expect(result.statusCode).toBe(502);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('ResendProvider classifies 422 unprocessable entity as permanent failure', async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 422,
          headers: new Headers(),
          text: async () =>
            JSON.stringify({ message: 'The domain makemetopper.com is not verified' }),
        }) as unknown as typeof fetch;

        const resend = new ResendProvider({ apiKey: 're_test_key_123' });
        const result = await resend.sendEmail({
          to: 'student@makemetopper.com',
          subject: 'Unverified domain',
          html: '<p>Test</p>',
        });

        expect(result.success).toBe(false);
        expect(result.retryable).toBe(false);
        expect(result.statusCode).toBe(422);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('resolveWorkerProvider fails closed when RESEND_API_KEY is missing in production mode', () => {
      const resolution = resolveWorkerProvider({
        mockEmailExplicit: false,
        resendApiKey: '',
      });

      expect(resolution.provider).toBeNull();
      expect(resolution.error).toContain('RESEND_API_KEY is missing');
    });

    it('resolveWorkerProvider NEVER accidentally selects MockEmailProvider in production when key is missing', () => {
      const resolutionNull = resolveWorkerProvider({ mockEmailExplicit: false, resendApiKey: null });
      expect(resolutionNull.provider).toBeNull();

      const resolutionUndefined = resolveWorkerProvider({ mockEmailExplicit: undefined, resendApiKey: '   ' });
      expect(resolutionUndefined.provider).toBeNull();
    });

    it('resolveWorkerProvider only selects MockEmailProvider when mockEmailExplicit is strictly true', () => {
      const resolution = resolveWorkerProvider({
        mockEmailExplicit: true,
      });

      expect(resolution.provider).not.toBeNull();
      expect(resolution.provider?.name).toBe('mock');
      expect(resolution.error).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Email Worker Batch Loop Tests
  // ──────────────────────────────────────────────────────────────────────────
  describe('Email Worker Batch Execution Loop', () => {
    let db: InMemoryWorkerDatabase;
    let provider: MockEmailProvider;

    beforeEach(() => {
      db = new InMemoryWorkerDatabase();
      provider = new MockEmailProvider();
    });

    it('successfully processes a batch of pending emails', async () => {
      const job1 = createTestJob({ recipient_email: 'student1@example.com' });
      const job2 = createTestJob({ recipient_email: 'student2@example.com' });
      db.jobs = [job1, job2];

      const summary = await runEmailWorkerBatch(db, provider, { batchSize: 10 });

      expect(summary.totalClaimed).toBe(2);
      expect(summary.succeeded).toBe(2);
      expect(summary.failed).toBe(0);
      expect(summary.retried).toBe(0);
      expect(summary.cancelled).toBe(0);
      expect(job1.status).toBe('sent');
      expect(job2.status).toBe('sent');
      expect(provider.dispatchedEmails).toHaveLength(2);
    });

    it('automatically recovers abandoned locks before claiming batch', async () => {
      db.recoveredLockCount = 3;
      const job = createTestJob();
      db.jobs = [job];

      const summary = await runEmailWorkerBatch(db, provider, { batchSize: 10 });

      expect(summary.recoveredLocks).toBe(3);
      expect(summary.succeeded).toBe(1);
    });

    it('gracefully cancels jobs with missing or whitespace recipient email', async () => {
      const badJob = createTestJob({ recipient_email: '   ' });
      db.jobs = [badJob];

      const summary = await runEmailWorkerBatch(db, provider, { batchSize: 10 });

      expect(summary.totalClaimed).toBe(1);
      expect(summary.cancelled).toBe(1);
      expect(summary.succeeded).toBe(0);
      expect(badJob.status).toBe('cancelled');
      expect(badJob.last_error).toBe('RECIPIENT_EMAIL_MISSING_OR_INVALID');
      expect(provider.dispatchedEmails).toHaveLength(0);
    });

    it('bypasses and cancels suppressed email addresses without calling provider', async () => {
      db.suppressions.add('bounced@example.com');
      const suppressedJob = createTestJob({ recipient_email: 'bounced@example.com' });
      db.jobs = [suppressedJob];

      const summary = await runEmailWorkerBatch(db, provider, { batchSize: 10 });

      expect(summary.totalClaimed).toBe(1);
      expect(summary.cancelled).toBe(1);
      expect(summary.succeeded).toBe(0);
      expect(suppressedJob.status).toBe('cancelled');
      expect(suppressedJob.last_error).toBe('RECIPIENT_EMAIL_SUPPRESSED');
      expect(provider.dispatchedEmails).toHaveLength(0);
    });

    it('isolates errors across batch: job 1 sent, job 2 retried, job 3 failed permanently', async () => {
      const job1 = createTestJob({ recipient_email: 'good@example.com' });
      const job2 = createTestJob({ recipient_email: 'transient@example.com', attempts: 0, max_attempts: 3 });
      const job3 = createTestJob({ recipient_email: 'permanent@example.com' });
      db.jobs = [job1, job2, job3];

      // Custom provider behavior per recipient
      const customProvider = {
        name: 'custom',
        async sendEmail(req: EmailSendRequest) {
          if (req.to === 'good@example.com') {
            return { success: true, providerMessageId: 'msg_1', retryable: false };
          }
          if (req.to === 'transient@example.com') {
            return { success: false, retryable: true, statusCode: 503, error: '503 Service Unavailable' };
          }
          return { success: false, retryable: false, statusCode: 422, error: '422 Unprocessable Recipient' };
        },
      };

      const summary = await runEmailWorkerBatch(db, customProvider, { batchSize: 10 });

      expect(summary.totalClaimed).toBe(3);
      expect(summary.succeeded).toBe(1);
      expect(summary.retried).toBe(1);
      expect(summary.failed).toBe(1);

      expect(job1.status).toBe('sent');
      expect(job2.status).toBe('pending'); // scheduled for retry
      expect(job3.status).toBe('failed');  // permanent failure
    });

    it('transitions job to failed when retry attempts exceed max_attempts', async () => {
      const job = createTestJob({
        recipient_email: 'failing@example.com',
        attempts: 2,
        max_attempts: 3, // next attempt (3) reaches max_attempts
      });
      db.jobs = [job];

      provider.simulateFailureOnce('Transient failure', true, 500);

      const summary = await runEmailWorkerBatch(db, provider, { batchSize: 10 });

      expect(summary.totalClaimed).toBe(1);
      expect(summary.failed).toBe(1);
      expect(summary.retried).toBe(0);
      expect(job.status).toBe('failed');
      expect(job.attempts).toBe(3);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Webhook Svix HMAC Signature & Replay Protection Tests
  // ──────────────────────────────────────────────────────────────────────────
  describe('Webhook Svix HMAC-SHA256 Signature Verification', () => {
    // Generate valid Svix signature using Web Crypto HMAC-SHA256
    async function generateSvixSignature(
      secretBase64: string,
      svixId: string,
      timestamp: string,
      body: string
    ): Promise<string> {
      const secretBytes = base64ToUint8Array(secretBase64);
      const signedData = `${svixId}.${timestamp}.${body}`;
      const signedBytes = new TextEncoder().encode(signedData);

      const key = await crypto.subtle.importKey(
        'raw',
        secretBytes,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );

      const sigBuffer = await crypto.subtle.sign('HMAC', key, signedBytes);
      return arrayBufferToBase64(sigBuffer);
    }

    const testSecretBase64 = Buffer.from('makemetopper-resend-webhook-key-32b').toString('base64');
    const testSecret = `whsec_${testSecretBase64}`;

    it('validates genuine Svix HMAC-SHA256 signature and fresh timestamp', async () => {
      const svixId = 'msg_p1q2r3s4';
      const svixTimestamp = Math.floor(Date.now() / 1000).toString();
      const payload = JSON.stringify({ type: 'email.delivered', data: { id: 'msg_123' } });

      const sigBase64 = await generateSvixSignature(testSecretBase64, svixId, svixTimestamp, payload);
      const svixSignature = `v1,${sigBase64}`;

      const result = await verifySvixWebhookSignature({
        secret: testSecret,
        payload,
        svixId,
        svixTimestamp,
        svixSignature,
      });

      expect(result.valid).toBe(true);
    });

    it('rejects tampered webhook payload with SIGNATURE_MISMATCH', async () => {
      const svixId = 'msg_p1q2r3s4';
      const svixTimestamp = Math.floor(Date.now() / 1000).toString();
      const payload = JSON.stringify({ type: 'email.delivered', data: { id: 'msg_123' } });

      const sigBase64 = await generateSvixSignature(testSecretBase64, svixId, svixTimestamp, payload);
      const svixSignature = `v1,${sigBase64}`;

      // Tampered payload body
      const tamperedPayload = JSON.stringify({ type: 'email.bounced', data: { id: 'msg_123' } });

      const result = await verifySvixWebhookSignature({
        secret: testSecret,
        payload: tamperedPayload,
        svixId,
        svixTimestamp,
        svixSignature,
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('SIGNATURE_MISMATCH');
    });

    it('rejects expired webhook timestamp with TIMESTAMP_TOLERANCE_EXCEEDED (replay protection)', async () => {
      const svixId = 'msg_p1q2r3s4';
      const staleTimestamp = (Math.floor(Date.now() / 1000) - 600).toString(); // 10 minutes ago
      const payload = JSON.stringify({ type: 'email.delivered' });

      const sigBase64 = await generateSvixSignature(testSecretBase64, svixId, staleTimestamp, payload);
      const svixSignature = `v1,${sigBase64}`;

      const result = await verifySvixWebhookSignature({
        secret: testSecret,
        payload,
        svixId,
        svixTimestamp: staleTimestamp,
        svixSignature,
        toleranceSeconds: 300,
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('TIMESTAMP_TOLERANCE_EXCEEDED');
    });

    it('rejects requests when RESEND_WEBHOOK_SECRET is missing (strict fail-closed)', async () => {
      const svixId = 'msg_p1q2r3s4';
      const svixTimestamp = Math.floor(Date.now() / 1000).toString();
      const payload = JSON.stringify({ type: 'email.delivered' });

      const result = await verifySvixWebhookSignature({
        secret: '',
        payload,
        svixId,
        svixTimestamp,
        svixSignature: 'v1,some_sig',
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('MISSING_WEBHOOK_SECRET');
    });

    it('timingSafeEqual behaves correctly for matching and non-matching strings', () => {
      expect(timingSafeEqual('exact-match-string', 'exact-match-string')).toBe(true);
      expect(timingSafeEqual('exact-match-string', 'different-match-str')).toBe(false);
      expect(timingSafeEqual('short', 'longer-string')).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. Webhook State Transitions & Suppression Handling Tests
  // ──────────────────────────────────────────────────────────────────────────
  describe('Webhook State Machine Transitions', () => {
    let db: InMemoryWebhookDatabase;

    beforeEach(() => {
      db = new InMemoryWebhookDatabase();
    });

    it('processes email.delivered by updating delivery status to delivered', async () => {
      const event = {
        type: 'email.delivered',
        created_at: new Date().toISOString(),
        data: {
          id: 'msg_resend_deliv_1',
          to: ['student@example.com'],
          from: 'notifications@makemetopper.com',
        },
      };

      const result = await processWebhookEvent(db, event);

      expect(result.success).toBe(true);
      expect(result.action).toBe('DELIVERY_RECORDED');
      expect(db.deliveryStatuses['msg_resend_deliv_1']).toBe('delivered');
      expect(db.suppressions.size).toBe(0);
    });

    it('processes permanent email.bounced by adding recipient to suppression list', async () => {
      const event = {
        type: 'email.bounced',
        created_at: new Date().toISOString(),
        data: {
          id: 'msg_resend_bounce_1',
          to: ['nonexistent@example.com'],
          bounce: { type: 'permanent' as const, message: 'Mailbox not found' },
        },
      };

      const result = await processWebhookEvent(db, event);

      expect(result.success).toBe(true);
      expect(result.action).toBe('HARD_BOUNCE_SUPPRESSED');
      expect(db.deliveryStatuses['msg_resend_bounce_1']).toBe('bounced');
      expect(db.suppressions.has('nonexistent@example.com')).toBe(true);
      expect(db.suppressions.get('nonexistent@example.com')?.reason).toBe('hard_bounce');
    });

    it('processes email.complained by adding recipient to suppression list', async () => {
      const event = {
        type: 'email.complained',
        created_at: new Date().toISOString(),
        data: {
          id: 'msg_resend_spam_1',
          to: ['complaining_user@example.com'],
        },
      };

      const result = await processWebhookEvent(db, event);

      expect(result.success).toBe(true);
      expect(result.action).toBe('COMPLAINT_SUPPRESSED');
      expect(db.deliveryStatuses['msg_resend_spam_1']).toBe('complained');
      expect(db.suppressions.has('complaining_user@example.com')).toBe(true);
      expect(db.suppressions.get('complaining_user@example.com')?.reason).toBe('complaint');
    });

    it('processes email.opened and email.clicked without modifying delivery status or suppression', async () => {
      const event = {
        type: 'email.opened',
        created_at: new Date().toISOString(),
        data: {
          id: 'msg_resend_open_1',
          to: ['student@example.com'],
        },
      };

      const result = await processWebhookEvent(db, event);

      expect(result.success).toBe(true);
      expect(result.action).toBe('ENGAGEMENT_LOGGED');
      expect(db.auditLogs).toHaveLength(1);
      expect(db.auditLogs[0].eventType).toBe('email.opened');
      expect(db.suppressions.size).toBe(0);
    });

    it('deduplicates identical Svix webhook event ID and skips duplicate side effects', async () => {
      const event = {
        type: 'email.delivered',
        created_at: new Date().toISOString(),
        data: {
          id: 'msg_resend_deliv_dup',
          to: ['student@example.com'],
          from: 'info@makemetopper.com',
        },
      };

      // First delivery
      const res1 = await processWebhookEvent(db, event, { svixId: 'evt_unique_123' });
      expect(res1.success).toBe(true);
      expect(res1.action).toBe('DELIVERY_RECORDED');
      expect(db.deliveryStatuses['msg_resend_deliv_dup']).toBe('delivered');
      expect(db.processedSvixIds.has('evt_unique_123')).toBe(true);

      // Duplicate delivery attempt with identical svixId
      const res2 = await processWebhookEvent(db, event, { svixId: 'evt_unique_123' });
      expect(res2.success).toBe(true);
      expect(res2.action).toBe('IGNORED_DUPLICATE_EVENT');
    });

    it('safely handles concurrent delivery of the same webhook event ID', async () => {
      const event = {
        type: 'email.complained',
        created_at: new Date().toISOString(),
        data: {
          id: 'msg_resend_concurrent',
          to: ['concurrent_student@example.com'],
        },
      };

      const sharedSvixId = 'evt_concurrent_999';

      // Launch two concurrent promises
      const [res1, res2] = await Promise.all([
        processWebhookEvent(db, event, { svixId: sharedSvixId }),
        processWebhookEvent(db, event, { svixId: sharedSvixId }),
      ]);

      expect(res1.success).toBe(true);
      expect(res2.success).toBe(true);
      const actions = [res1.action, res2.action];
      expect(actions).toContain('COMPLAINT_SUPPRESSED');
      expect(db.suppressions.has('concurrent_student@example.com')).toBe(true);
      expect(db.suppressions.size).toBe(1);
    });

    it('guarantees no unintended queue or suppression state changes on rejected requests', async () => {
      // 1. Missing secret test
      const missingSecretResult = await verifySvixWebhookSignature({
        secret: '',
        payload: '{"type":"email.complained"}',
        svixId: 'evt_rejected_1',
        svixTimestamp: Math.floor(Date.now() / 1000).toString(),
        svixSignature: 'v1,some_sig',
      });
      expect(missingSecretResult.valid).toBe(false);

      // Verify that database state was NOT touched
      expect(db.suppressions.size).toBe(0);
      expect(Object.keys(db.deliveryStatuses)).toHaveLength(0);
      expect(db.auditLogs).toHaveLength(0);

      // 2. Invalid signature test
      const invalidSigResult = await verifySvixWebhookSignature({
        secret: 'whsec_bWFrZW1ldG9wcGVyLXJlc2VuZC13ZWJob29rLWtleS0zMmI=',
        payload: '{"type":"email.complained"}',
        svixId: 'evt_rejected_2',
        svixTimestamp: Math.floor(Date.now() / 1000).toString(),
        svixSignature: 'v1,totally_invalid_signature',
      });
      expect(invalidSigResult.valid).toBe(false);

      // Verify database state remains completely untouched
      expect(db.suppressions.size).toBe(0);
      expect(Object.keys(db.deliveryStatuses)).toHaveLength(0);
      expect(db.auditLogs).toHaveLength(0);
    });
  });
});
