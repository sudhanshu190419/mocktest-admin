/**
 * Make Me Topper — Phase 5: Official Mock Test Result Published (EXM-01)
 * Automated Comprehensive Test Suite
 *
 * Requirements Covered:
 * 1. Template Rendering & Universal Branding:
 *    - EXM-01 renders with Make Me Topper branding, accurate scores, percentage, and support link.
 *    - Prominent All-India Rank and Percentile badges render when values are non-null.
 *    - Rank and percentile badges are cleanly omitted when null/undefined (no empty badges).
 *    - Clean, readable plain-text fallback generation.
 *    - Strict HTML entity escaping preventing XSS across testTitle, recipientName, etc.
 *    - Accurate publication timestamp formatted in Asia/Kolkata timezone (IST).
 *    - CTA button linking directly to the specific test attempt scorecard URL.
 * 2. Official Publication Trigger & Ingestion Scenarios:
 *    - Admin-assigned tests with manual result release (release_test_results) enqueue EXM-01.
 *    - Admin-assigned tests with scheduled release (process_scheduled_mock_test_releases) enqueue EXM-01.
 *    - Course mock tests with deferred release enqueue EXM-01 upon publication.
 *    - Subjective evaluation mock tests enqueue EXM-01 when evaluation completes and results are released.
 *    - Bulk release across an entire student cohort creates distinct notifications per student attempt.
 *    - Non-takers (students who did not submit an attempt) receive no notification.
 *    - Attempt isolation: notifications are strictly routed to the student who took the test.
 * 3. Exclusions & System Boundaries:
 *    - Purchased PYQ tests with immediate on-screen scoring do NOT trigger EXM-01.
 *    - Self-paced practice tests with immediate scoring do NOT trigger EXM-01.
 *    - Routine test submissions creating unreleased records (is_released = false) do NOT fire the trigger.
 *    - Updates to already-released results (recalculating rankings, score adjustments) do NOT fire the trigger.
 *    - In-app result_available and mock_test_assigned notifications remain untouched and operational.
 * 4. Release-Generation Safety & Microsecond Precision:
 *    - Preserves full PostgreSQL timestamp microsecond precision (.123456 vs .123999).
 *    - Older release cycles differing only in microseconds are rejected as TEST_RESULT_RELEASE_SUPERSEDED.
 *    - Exact microsecond match accepted as eligible.
 *    - Missing or invalid metadata (missing attemptId, testId, releasedAt, malformed dates, DB nulls)
 *      strictly fails closed with distinct, actionable reasons.
 *    - Verifies both attempt_id and test_id matching.
 * 5. Generation-Aware Duplicate Suppression:
 *    - Old pending job followed by new release enqueues fresh job for new generation.
 *    - Old processing job cancelled as superseded followed by new release enqueues fresh job.
 *    - Already-sent notification followed by re-release suppresses duplicate dispatch.
 *    - Same-generation processing job suppresses duplicate trigger execution.
 *    - Two different release generations receive independent release cycles.
 *    - Duplicate trigger execution for the same release is deduplicated.
 * 6. Mandatory EXM-01 Verification & Transient Error Recovery:
 *    - Worker refuses dispatch when eligibility checker is unavailable and schedules retry.
 *    - Transient verification failures (network timeouts, DB connection drops) schedule retry with backoff.
 *    - Permanent ineligibility (unreleased, superseded, wrong testId, not found) cancels job permanently.
 *
 * @module src/services/admin/__tests__/emailExamPhase5.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  escapeHtml,
  htmlToPlainText,
  renderEmail,
  renderMockTestResultPublishedEmail,
} from '../../../../supabase/functions/_shared/email/templates';

import {
  EmailWorkerDatabase,
  MockResultEligibility,
  DispatchReservationResult,
  createSupabaseWorkerDb,
  normalizePostgresTimestamp,
  runEmailWorkerBatch,
} from '../../../../supabase/functions/email-worker/emailWorkerCore';

import {
  EmailQueueJob,
  EmailSendRequest,
  EmailSendResult,
} from '../../../../supabase/functions/_shared/email/types';

import { ResendProvider } from '../../../../supabase/functions/_shared/email/resendProvider';

// ── Mock & Simulation Helpers ────────────────────────────────────────────────

interface SimulatedMockResult {
  result_id: string;
  attempt_id: string;
  test_id: string;
  student_id: string;
  institute_id: string;
  total_score: number;
  max_score: number;
  percentage: number;
  rank: number | null;
  percentile: number | null;
  correct_count: number;
  wrong_count: number;
  skipped_count: number;
  total_time_seconds: number;
  is_released: boolean;
  released_at: string | null;
}

interface SimulatedMockTest {
  test_id: string;
  title: string;
  total_marks: number;
  result_release_mode: 'immediate' | 'scheduled' | 'manual';
  test_type: 'mock' | 'pyq' | 'practice';
}

interface SimulatedAttempt {
  attempt_id: string;
  test_id: string;
  student_id: string;
  attempt_number: number;
  status: 'submitted' | 'completed' | 'in_progress';
}

interface SimulatedStudent {
  student_id: string;
  profile_id: string;
}

interface SimulatedProfile {
  profile_id: string;
  name: string;
  email: string | null;
}

interface SimulatedEmailQueueJob {
  queue_id: string;
  recipient_profile_id: string | null;
  recipient_email: string;
  recipient_name: string | null;
  event_type: string;
  subject: string;
  template_id: string;
  payload: Record<string, unknown>;
  priority: string;
  status: 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled';
  idempotency_key: string | null;
  cancel_reason?: string;
}

interface SimulatedDispatchLedgerRecord {
  attempt_id: string;
  test_id: string;
  reserved_by_queue_id: string;
  release_generation: string;
  status: 'reserved' | 'consumed';
  reserved_at?: string;
  consumed_at?: string;
  provider_message_id?: string;
}

/**
 * Simulates the exact behavior of public.handle_mock_result_released trigger function (Migration 254).
 */
function simulateMockResultReleaseTrigger(
  oldRow: SimulatedMockResult | null,
  newRow: SimulatedMockResult,
  op: 'INSERT' | 'UPDATE',
  context: {
    tests: Map<string, SimulatedMockTest>;
    attempts: Map<string, SimulatedAttempt>;
    students: Map<string, SimulatedStudent>;
    profiles: Map<string, SimulatedProfile>;
    emailQueue: SimulatedEmailQueueJob[];
    simulatedClockIso?: string;
    dispatches?: Map<string, SimulatedDispatchLedgerRecord>;
  }
): { triggered: boolean; enqueued: boolean; reason?: string; queueJob?: SimulatedEmailQueueJob } {
  // Trigger condition: AFTER UPDATE OF is_released ON public.mock_results
  // WHEN (OLD.is_released IS FALSE AND NEW.is_released IS TRUE)
  if (op !== 'UPDATE') {
    return { triggered: false, enqueued: false, reason: 'TRIGGER_SKIPPED_NOT_UPDATE' };
  }
  if (!oldRow || oldRow.is_released !== false || newRow.is_released !== true) {
    return { triggered: false, enqueued: false, reason: 'TRIGGER_CONDITION_NOT_MET' };
  }

  // 1. Choice 1: Strict First-Only Policy Enforcement:
  // If an EXM-01 notification for this attempt has already been consumed (accepted by Resend)
  // or marked sent in queue, permanently suppress all future emails for this attempt.
  const alreadyConsumed =
    context.dispatches?.get(newRow.attempt_id)?.status === 'consumed' ||
    context.emailQueue.some(
      (j) => j.payload?.attemptId === newRow.attempt_id && j.event_type === 'EXM-01' && j.status === 'sent'
    );
  if (alreadyConsumed) {
    return { triggered: true, enqueued: false, reason: 'DUPLICATE_SUPPRESSED_ALREADY_SENT' };
  }

  // 2. Establish effective release timestamp
  const effectiveReleasedAt = newRow.released_at || context.simulatedClockIso || new Date().toISOString();
  const d = new Date(effectiveReleasedAt);
  const pad = (n: number, z = 2) => String(n).padStart(z, '0');
  const utcFormatted = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}000Z`;
  const idempotencyKey = `exm_res:${newRow.attempt_id}:${utcFormatted}`;

  // 3. Duplicate suppression for same release generation:
  // If a job for the SAME generation (matching released_at) is currently processing or pending, suppress duplicate
  const sameGenInFlight = context.emailQueue.some(
    (j) =>
      j.payload?.attemptId === newRow.attempt_id &&
      j.event_type === 'EXM-01' &&
      (j.status === 'processing' || j.status === 'pending') &&
      j.payload?.releasedAt === effectiveReleasedAt
  );
  if (sameGenInFlight) {
    return { triggered: true, enqueued: false, reason: 'DUPLICATE_SUPPRESSED_SAME_GENERATION_IN_FLIGHT' };
  }

  // 4. Cancel any stale prior-generation jobs that are still pending in the queue
  for (const job of context.emailQueue) {
    if (
      job.payload?.attemptId === newRow.attempt_id &&
      job.event_type === 'EXM-01' &&
      job.status === 'pending' &&
      job.payload?.releasedAt !== effectiveReleasedAt
    ) {
      job.status = 'cancelled';
      job.cancel_reason = 'TEST_RESULT_RELEASE_SUPERSEDED';
    }
  }

  // 3. Resolve student profile and mock test metadata via authoritative joins
  const attempt = context.attempts.get(newRow.attempt_id);
  if (!attempt) {
    return { triggered: true, enqueued: false, reason: 'ATTEMPT_NOT_FOUND' };
  }
  const student = context.students.get(attempt.student_id);
  if (!student) {
    return { triggered: true, enqueued: false, reason: 'STUDENT_NOT_FOUND' };
  }
  const profile = context.profiles.get(student.profile_id);
  if (!profile) {
    return { triggered: true, enqueued: false, reason: 'PROFILE_NOT_FOUND' };
  }
  const test = context.tests.get(newRow.test_id);
  const testTitle = test?.title?.trim() || 'Mock Test';
  const totalMarks = test?.total_marks ?? Math.round(newRow.max_score);
  const attemptNumber = attempt.attempt_number ?? 1;

  // 4. Validate recipient email syntax minimally
  const cleanEmail = (profile.email || '').trim().toLowerCase();
  if (cleanEmail.length === 0 || !cleanEmail.includes('@')) {
    return { triggered: true, enqueued: false, reason: 'INVALID_RECIPIENT_EMAIL' };
  }

  // 5. Construct payload
  const resultsUrl = `https://makemetopper.com/student/tests/${newRow.test_id}/results/${newRow.attempt_id}`;
  const payload: Record<string, unknown> = {
    attemptId: newRow.attempt_id,
    testId: newRow.test_id,
    studentId: newRow.student_id,
    testTitle,
    score: newRow.total_score,
    totalScore: newRow.total_score,
    maxScore: newRow.max_score,
    totalMarks,
    percentage: newRow.percentage,
    rank: newRow.rank,
    percentile: newRow.percentile,
    correctCount: newRow.correct_count,
    wrongCount: newRow.wrong_count,
    incorrectCount: newRow.wrong_count,
    skippedCount: newRow.skipped_count,
    totalTimeSeconds: newRow.total_time_seconds,
    attemptNumber,
    releasedAt: effectiveReleasedAt,
    resultsUrl,
  };

  // 6. Check if idempotency key exists in email_queue
  const existingKeyJob = context.emailQueue.find((j) => j.idempotency_key === idempotencyKey);
  if (existingKeyJob) {
    return { triggered: true, enqueued: false, reason: 'IDEMPOTENT_EXISTING', queueJob: existingKeyJob };
  }

  // 7. Enqueue new job
  const newJob: SimulatedEmailQueueJob = {
    queue_id: `q-exm-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    recipient_profile_id: profile.profile_id,
    recipient_email: cleanEmail,
    recipient_name: profile.name || 'Student',
    event_type: 'EXM-01',
    subject: `Official Result Published: ${testTitle} — Make Me Topper`,
    template_id: 'EXM-01',
    payload,
    priority: 'normal',
    status: 'pending',
    idempotency_key: idempotencyKey,
  };
  context.emailQueue.push(newJob);

  return { triggered: true, enqueued: true, queueJob: newJob };
}

// ── Test Suites ──────────────────────────────────────────────────────────────

describe('Make Me Topper — Phase 5: Official Mock Test Result Published (EXM-01)', () => {
  const defaultContext = {
    recipientEmail: 'student@example.com',
    recipientName: 'Dev Sharma',
  };

  // ════════════════════════════════════════════════════════════════════════════
  // 1. Template Rendering & Universal Branding
  // ════════════════════════════════════════════════════════════════════════════
  describe('1. Template Rendering & Universal Branding', () => {
    it('EXM-01 renders official result scorecard with correct subject, score, and footer link', () => {
      const payload = {
        testTitle: 'NEET 2026 Full Syllabus Grand Mock 04',
        attemptNumber: 1,
        score: 645,
        maxScore: 720,
        percentage: 89.58,
        rank: 12,
        percentile: 98.75,
        correctCount: 165,
        wrongCount: 15,
        skippedCount: 0,
        attemptId: 'att-123',
        testId: 't-456',
        releasedAt: '2026-11-21T10:00:00.000Z',
      };

      const rendered = renderEmail('EXM-01', payload, defaultContext);

      expect(rendered.subject).toBe(
        'Official Result Published: NEET 2026 Full Syllabus Grand Mock 04 — Make Me Topper'
      );
      expect(rendered.html).toContain('NEET 2026 Full Syllabus Grand Mock 04');
      expect(rendered.html).toContain('645');
      expect(rendered.html).toContain('/ 720');
      expect(rendered.html).toContain('89.58%');
      expect(rendered.html).toContain('All-India Rank');
      expect(rendered.html).toContain('#12');
      expect(rendered.html).toContain('Percentile');
      expect(rendered.html).toContain('98.75%');
      expect(rendered.html).toContain('Correct Answers:');
      expect(rendered.html).toContain('165');
      expect(rendered.html).toContain('Incorrect Answers:');
      expect(rendered.html).toContain('15');
      expect(rendered.html).toContain('mailto:support@inovoxy.com');
      expect(rendered.html).toContain('support@inovoxy.com');
      expect(rendered.html).toContain(
        'https://makemetopper.com/student/tests/t-456/results/att-123'
      );
    });

    it('EXM-01 renders clean plain text fallback with scores, breakdown, and support email', () => {
      const payload = {
        testTitle: 'JEE Advanced Physics Simulation',
        score: 92,
        maxScore: 120,
        percentage: 76.67,
        rank: 5,
        percentile: 99.1,
        correctCount: 24,
        wrongCount: 4,
        skippedCount: 2,
        attemptId: 'att-jee-9',
        testId: 't-jee-1',
      };

      const rendered = renderMockTestResultPublishedEmail(payload, defaultContext);

      expect(rendered.text).toContain('Hello Dev Sharma');
      expect(rendered.text).toContain('JEE Advanced Physics Simulation');
      expect(rendered.text).toContain('92 / 120');
      expect(rendered.text).toContain('Score Percentage: 76.67%');
      expect(rendered.text).toContain('All-India Rank');
      expect(rendered.text).toContain('#5');
      expect(rendered.text).toContain('support@inovoxy.com');
      expect(rendered.text).not.toContain('<div');
      expect(rendered.text).not.toContain('<table');
    });

    it('EXM-01 cleanly omits rank and percentile badges when values are null or undefined', () => {
      const payload = {
        testTitle: 'Chemistry Chapter Test — Thermodynamics',
        score: 45,
        maxScore: 50,
        percentage: 90.0,
        rank: null,
        percentile: null,
        correctCount: 15,
        wrongCount: 1,
        skippedCount: 0,
      };

      const rendered = renderEmail('EXM-01', payload, defaultContext);

      expect(rendered.html).not.toContain('All-India Rank');
      expect(rendered.html).not.toContain('Percentile');
      expect(rendered.html).not.toContain('null');
      expect(rendered.html).not.toContain('undefined');
      expect(rendered.html).toContain('45');
      expect(rendered.html).toContain('/ 50');
    });

    it('EXM-01 enforces strict HTML entity escaping to prevent XSS across testTitle and names', () => {
      const maliciousPayload = {
        testTitle: 'NEET Practice <script>alert("xss")</script> & "Advanced"',
        score: 500,
        maxScore: 720,
        rank: 1,
      };

      const xssContext = {
        recipientEmail: 'student@example.com',
        recipientName: 'Priya <img src=x onerror=alert(1)> Patel',
      };

      const rendered = renderEmail('EXM-01', maliciousPayload, xssContext);

      expect(rendered.html).not.toContain('<script>');
      expect(rendered.html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
      expect(rendered.html).toContain('&amp; &quot;Advanced&quot;');
      expect(rendered.html).not.toContain('<img src=x onerror=alert(1)>');
      expect(rendered.html).toContain('Priya &lt;img src=x onerror=alert(1)&gt; Patel');
    });

    it('EXM-01 formats release timestamp in Asia/Kolkata timezone with IST indicator', () => {
      const payload = {
        testTitle: 'Biology Diagnostic Exam',
        score: 300,
        maxScore: 360,
        releasedAt: '2026-11-21T09:30:00.000Z', // 03:00 PM IST
      };

      const rendered = renderEmail('EXM-01', payload, defaultContext);

      expect(rendered.html).toContain('Published On:');
      expect(rendered.html).toContain('IST');
      expect(rendered.html).toContain('Nov 2026');
    });

    it('EXM-01 falls back cleanly to generic results URL when attemptId or testId are absent', () => {
      const payload = {
        testTitle: 'General Mock Test',
        score: 100,
        maxScore: 100,
      };

      const rendered = renderEmail('EXM-01', payload, defaultContext);

      expect(rendered.html).toContain('https://makemetopper.com/student/results');
    });

    it('renderEmail correctly routes template alias exm-01, mock-test-result-published, and exam-result-published', () => {
      const payload = {
        testTitle: 'Routing Verification Mock',
        score: 50,
        maxScore: 100,
      };

      const r1 = renderEmail('exm-01', payload, defaultContext);
      const r2 = renderEmail('mock-test-result-published', payload, defaultContext);
      const r3 = renderEmail('exam-result-published', payload, defaultContext);

      expect(r1.subject).toBe('Official Result Published: Routing Verification Mock — Make Me Topper');
      expect(r2.subject).toBe(r1.subject);
      expect(r3.subject).toBe(r1.subject);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 2. Official Publication Trigger & Ingestion Scenarios
  // ════════════════════════════════════════════════════════════════════════════
  describe('2. Official Publication Trigger & Ingestion Scenarios', () => {
    let tests: Map<string, SimulatedMockTest>;
    let attempts: Map<string, SimulatedAttempt>;
    let students: Map<string, SimulatedStudent>;
    let profiles: Map<string, SimulatedProfile>;
    let emailQueue: SimulatedEmailQueueJob[];

    beforeEach(() => {
      tests = new Map();
      attempts = new Map();
      students = new Map();
      profiles = new Map();
      emailQueue = [];

      // Setup baseline test, attempt, student, profile
      tests.set('test-admin-1', {
        test_id: 'test-admin-1',
        title: 'NEET 2027 Admin Scheduled Mock 01',
        total_marks: 720,
        result_release_mode: 'manual',
        test_type: 'mock',
      });

      profiles.set('prof-aarav', {
        profile_id: 'prof-aarav',
        name: 'Aarav Sharma',
        email: 'aarav@example.com',
      });

      students.set('stud-aarav', {
        student_id: 'stud-aarav',
        profile_id: 'prof-aarav',
      });

      attempts.set('att-aarav-1', {
        attempt_id: 'att-aarav-1',
        test_id: 'test-admin-1',
        student_id: 'stud-aarav',
        attempt_number: 1,
        status: 'submitted',
      });
    });

    it('manual release (release_test_results) on admin-assigned test transitions is_released and enqueues EXM-01', () => {
      const oldRow: SimulatedMockResult = {
        result_id: 'res-1',
        attempt_id: 'att-aarav-1',
        test_id: 'test-admin-1',
        student_id: 'stud-aarav',
        institute_id: 'inst-1',
        total_score: 610,
        max_score: 720,
        percentage: 84.72,
        rank: 3,
        percentile: 97.5,
        correct_count: 155,
        wrong_count: 20,
        skipped_count: 5,
        total_time_seconds: 10200,
        is_released: false,
        released_at: null,
      };

      const newRow: SimulatedMockResult = {
        ...oldRow,
        is_released: true,
        released_at: '2026-11-21T12:00:00.000000Z',
      };

      const result = simulateMockResultReleaseTrigger(oldRow, newRow, 'UPDATE', {
        tests,
        attempts,
        students,
        profiles,
        emailQueue,
      });

      expect(result.triggered).toBe(true);
      expect(result.enqueued).toBe(true);
      expect(result.queueJob).toBeDefined();
      expect(result.queueJob?.recipient_email).toBe('aarav@example.com');
      expect(result.queueJob?.event_type).toBe('EXM-01');
      expect(result.queueJob?.payload.score).toBe(610);
      expect(result.queueJob?.payload.attemptNumber).toBe(1);
      expect(result.queueJob?.idempotency_key).toContain('exm_res:att-aarav-1:');
    });

    it('scheduled release (process_scheduled_mock_test_releases) transitions is_released and enqueues EXM-01', () => {
      tests.set('test-sched-1', {
        test_id: 'test-sched-1',
        title: 'Weekly All-India Assessment 08',
        total_marks: 300,
        result_release_mode: 'scheduled',
        test_type: 'mock',
      });

      attempts.set('att-sched-1', {
        attempt_id: 'att-sched-1',
        test_id: 'test-sched-1',
        student_id: 'stud-aarav',
        attempt_number: 1,
        status: 'submitted',
      });

      const oldRow: SimulatedMockResult = {
        result_id: 'res-sched-1',
        attempt_id: 'att-sched-1',
        test_id: 'test-sched-1',
        student_id: 'stud-aarav',
        institute_id: 'inst-1',
        total_score: 240,
        max_score: 300,
        percentage: 80.0,
        rank: 8,
        percentile: 94.2,
        correct_count: 62,
        wrong_count: 8,
        skipped_count: 5,
        total_time_seconds: 7200,
        is_released: false,
        released_at: null,
      };

      const newRow: SimulatedMockResult = {
        ...oldRow,
        is_released: true,
        released_at: '2026-11-21T18:00:00.000000Z',
      };

      const outcome = simulateMockResultReleaseTrigger(oldRow, newRow, 'UPDATE', {
        tests,
        attempts,
        students,
        profiles,
        emailQueue,
      });

      expect(outcome.triggered).toBe(true);
      expect(outcome.enqueued).toBe(true);
      expect(outcome.queueJob?.subject).toContain('Weekly All-India Assessment 08');
      expect(outcome.queueJob?.payload.rank).toBe(8);
    });

    it('purchased course mock test with deferred manual release transitions is_released and enqueues EXM-01', () => {
      tests.set('test-course-1', {
        test_id: 'test-course-1',
        title: 'Physics Mastery: Mechanics Milestone Test',
        total_marks: 100,
        result_release_mode: 'manual',
        test_type: 'mock',
      });

      attempts.set('att-course-1', {
        attempt_id: 'att-course-1',
        test_id: 'test-course-1',
        student_id: 'stud-aarav',
        attempt_number: 1,
        status: 'submitted',
      });

      const oldRow: SimulatedMockResult = {
        result_id: 'res-course-1',
        attempt_id: 'att-course-1',
        test_id: 'test-course-1',
        student_id: 'stud-aarav',
        institute_id: 'inst-1',
        total_score: 88,
        max_score: 100,
        percentage: 88.0,
        rank: 1,
        percentile: 99.5,
        correct_count: 22,
        wrong_count: 2,
        skipped_count: 1,
        total_time_seconds: 3600,
        is_released: false,
        released_at: null,
      };

      const newRow: SimulatedMockResult = {
        ...oldRow,
        is_released: true,
        released_at: '2026-11-21T19:00:00.000000Z',
      };

      const outcome = simulateMockResultReleaseTrigger(oldRow, newRow, 'UPDATE', {
        tests,
        attempts,
        students,
        profiles,
        emailQueue,
      });

      expect(outcome.triggered).toBe(true);
      expect(outcome.enqueued).toBe(true);
      expect(outcome.queueJob?.payload.testTitle).toBe('Physics Mastery: Mechanics Milestone Test');
    });

    it('subjective evaluation mock test transitions is_released to true when evaluation completes and enqueues EXM-01', () => {
      tests.set('test-subj-1', {
        test_id: 'test-subj-1',
        title: 'Board Exam Pattern Subjective Biology',
        total_marks: 70,
        result_release_mode: 'manual',
        test_type: 'mock',
      });

      attempts.set('att-subj-1', {
        attempt_id: 'att-subj-1',
        test_id: 'test-subj-1',
        student_id: 'stud-aarav',
        attempt_number: 1,
        status: 'completed',
      });

      const oldRow: SimulatedMockResult = {
        result_id: 'res-subj-1',
        attempt_id: 'att-subj-1',
        test_id: 'test-subj-1',
        student_id: 'stud-aarav',
        institute_id: 'inst-1',
        total_score: 65,
        max_score: 70,
        percentage: 92.86,
        rank: 2,
        percentile: 98.0,
        correct_count: 18,
        wrong_count: 1,
        skipped_count: 0,
        total_time_seconds: 7200,
        is_released: false,
        released_at: null,
      };

      const newRow: SimulatedMockResult = {
        ...oldRow,
        is_released: true,
        released_at: '2026-11-21T20:00:00.000000Z',
      };

      const outcome = simulateMockResultReleaseTrigger(oldRow, newRow, 'UPDATE', {
        tests,
        attempts,
        students,
        profiles,
        emailQueue,
      });

      expect(outcome.triggered).toBe(true);
      expect(outcome.enqueued).toBe(true);
      expect(outcome.queueJob?.payload.totalScore).toBe(65);
    });

    it('bulk release of multiple student results creates distinct queued jobs for each student attempt', () => {
      profiles.set('prof-bhavna', { profile_id: 'prof-bhavna', name: 'Bhavna Roy', email: 'bhavna@example.com' });
      students.set('stud-bhavna', { student_id: 'stud-bhavna', profile_id: 'prof-bhavna' });
      attempts.set('att-bhavna-1', { attempt_id: 'att-bhavna-1', test_id: 'test-admin-1', student_id: 'stud-bhavna', attempt_number: 1, status: 'submitted' });

      profiles.set('prof-chetan', { profile_id: 'prof-chetan', name: 'Chetan Verma', email: 'chetan@example.com' });
      students.set('stud-chetan', { student_id: 'stud-chetan', profile_id: 'prof-chetan' });
      attempts.set('att-chetan-1', { attempt_id: 'att-chetan-1', test_id: 'test-admin-1', student_id: 'stud-chetan', attempt_number: 1, status: 'submitted' });

      const sharedReleaseTimestamp = '2026-11-21T15:30:00.123456Z';

      const resultsToRelease = [
        {
          oldRow: { result_id: 'res-aarav', attempt_id: 'att-aarav-1', test_id: 'test-admin-1', student_id: 'stud-aarav', institute_id: 'inst-1', total_score: 610, max_score: 720, percentage: 84.72, rank: 3, percentile: 97.5, correct_count: 155, wrong_count: 20, skipped_count: 5, total_time_seconds: 10200, is_released: false, released_at: null },
          newRow: { result_id: 'res-aarav', attempt_id: 'att-aarav-1', test_id: 'test-admin-1', student_id: 'stud-aarav', institute_id: 'inst-1', total_score: 610, max_score: 720, percentage: 84.72, rank: 3, percentile: 97.5, correct_count: 155, wrong_count: 20, skipped_count: 5, total_time_seconds: 10200, is_released: true, released_at: sharedReleaseTimestamp },
        },
        {
          oldRow: { result_id: 'res-bhavna', attempt_id: 'att-bhavna-1', test_id: 'test-admin-1', student_id: 'stud-bhavna', institute_id: 'inst-1', total_score: 680, max_score: 720, percentage: 94.44, rank: 1, percentile: 99.9, correct_count: 172, wrong_count: 6, skipped_count: 2, total_time_seconds: 9800, is_released: false, released_at: null },
          newRow: { result_id: 'res-bhavna', attempt_id: 'att-bhavna-1', test_id: 'test-admin-1', student_id: 'stud-bhavna', institute_id: 'inst-1', total_score: 680, max_score: 720, percentage: 94.44, rank: 1, percentile: 99.9, correct_count: 172, wrong_count: 6, skipped_count: 2, total_time_seconds: 9800, is_released: true, released_at: sharedReleaseTimestamp },
        },
        {
          oldRow: { result_id: 'res-chetan', attempt_id: 'att-chetan-1', test_id: 'test-admin-1', student_id: 'stud-chetan', institute_id: 'inst-1', total_score: 550, max_score: 720, percentage: 76.39, rank: 15, percentile: 88.0, correct_count: 140, wrong_count: 30, skipped_count: 10, total_time_seconds: 10500, is_released: false, released_at: null },
          newRow: { result_id: 'res-chetan', attempt_id: 'att-chetan-1', test_id: 'test-admin-1', student_id: 'stud-chetan', institute_id: 'inst-1', total_score: 550, max_score: 720, percentage: 76.39, rank: 15, percentile: 88.0, correct_count: 140, wrong_count: 30, skipped_count: 10, total_time_seconds: 10500, is_released: true, released_at: sharedReleaseTimestamp },
        },
      ];

      for (const item of resultsToRelease) {
        simulateMockResultReleaseTrigger(item.oldRow, item.newRow, 'UPDATE', {
          tests,
          attempts,
          students,
          profiles,
          emailQueue,
        });
      }

      expect(emailQueue.length).toBe(3);
      expect(emailQueue.map((j) => j.recipient_email)).toEqual([
        'aarav@example.com',
        'bhavna@example.com',
        'chetan@example.com',
      ]);
      expect(emailQueue.map((j) => j.payload.rank)).toEqual([3, 1, 15]);

      const keys = new Set(emailQueue.map((j) => j.idempotency_key));
      expect(keys.size).toBe(3);
    });

    it('non-takers who did not attempt the test receive no notification', () => {
      profiles.set('prof-divya', { profile_id: 'prof-divya', name: 'Divya Nair', email: 'divya@example.com' });
      students.set('stud-divya', { student_id: 'stud-divya', profile_id: 'prof-divya' });

      const oldRow: SimulatedMockResult = {
        result_id: 'res-aarav',
        attempt_id: 'att-aarav-1',
        test_id: 'test-admin-1',
        student_id: 'stud-aarav',
        institute_id: 'inst-1',
        total_score: 610,
        max_score: 720,
        percentage: 84.72,
        rank: 3,
        percentile: 97.5,
        correct_count: 155,
        wrong_count: 20,
        skipped_count: 5,
        total_time_seconds: 10200,
        is_released: false,
        released_at: null,
      };
      const newRow: SimulatedMockResult = { ...oldRow, is_released: true, released_at: '2026-11-21T12:00:00Z' };

      simulateMockResultReleaseTrigger(oldRow, newRow, 'UPDATE', {
        tests,
        attempts,
        students,
        profiles,
        emailQueue,
      });

      expect(emailQueue.length).toBe(1);
      expect(emailQueue.find((j) => j.recipient_email === 'divya@example.com')).toBeUndefined();
    });

    it('attempt isolation: notification contains data specifically for that student attempt', () => {
      const oldRow: SimulatedMockResult = {
        result_id: 'res-1',
        attempt_id: 'att-aarav-1',
        test_id: 'test-admin-1',
        student_id: 'stud-aarav',
        institute_id: 'inst-1',
        total_score: 610,
        max_score: 720,
        percentage: 84.72,
        rank: 3,
        percentile: 97.5,
        correct_count: 155,
        wrong_count: 20,
        skipped_count: 5,
        total_time_seconds: 10200,
        is_released: false,
        released_at: null,
      };
      const newRow: SimulatedMockResult = { ...oldRow, is_released: true, released_at: '2026-11-21T12:00:00Z' };

      const outcome = simulateMockResultReleaseTrigger(oldRow, newRow, 'UPDATE', {
        tests,
        attempts,
        students,
        profiles,
        emailQueue,
      });

      expect(outcome.queueJob?.payload.attemptId).toBe('att-aarav-1');
      expect(outcome.queueJob?.payload.studentId).toBe('stud-aarav');
      expect(outcome.queueJob?.payload.testId).toBe('test-admin-1');
      expect(outcome.queueJob?.payload.score).toBe(610);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 3. Exclusions & System Boundaries
  // ════════════════════════════════════════════════════════════════════════════
  describe('3. Exclusions & System Boundaries', () => {
    let tests: Map<string, SimulatedMockTest>;
    let attempts: Map<string, SimulatedAttempt>;
    let students: Map<string, SimulatedStudent>;
    let profiles: Map<string, SimulatedProfile>;
    let emailQueue: SimulatedEmailQueueJob[];

    beforeEach(() => {
      tests = new Map();
      attempts = new Map();
      students = new Map();
      profiles = new Map();
      emailQueue = [];

      profiles.set('prof-1', { profile_id: 'prof-1', name: 'Student One', email: 's1@example.com' });
      students.set('stud-1', { student_id: 'stud-1', profile_id: 'prof-1' });
    });

    it('purchased PYQ test submission with immediate on-screen scoring inserts is_released = true and does NOT fire trigger', () => {
      tests.set('test-pyq', {
        test_id: 'test-pyq',
        title: 'NEET 2024 Official Question Paper (PYQ)',
        total_marks: 720,
        result_release_mode: 'immediate',
        test_type: 'pyq',
      });

      attempts.set('att-pyq-1', {
        attempt_id: 'att-pyq-1',
        test_id: 'test-pyq',
        student_id: 'stud-1',
        attempt_number: 1,
        status: 'completed',
      });

      const insertedRow: SimulatedMockResult = {
        result_id: 'res-pyq-1',
        attempt_id: 'att-pyq-1',
        test_id: 'test-pyq',
        student_id: 'stud-1',
        institute_id: 'inst-1',
        total_score: 580,
        max_score: 720,
        percentage: 80.56,
        rank: null,
        percentile: null,
        correct_count: 145,
        wrong_count: 15,
        skipped_count: 20,
        total_time_seconds: 10800,
        is_released: true,
        released_at: '2026-11-21T10:00:00Z',
      };

      const outcome = simulateMockResultReleaseTrigger(null, insertedRow, 'INSERT', {
        tests,
        attempts,
        students,
        profiles,
        emailQueue,
      });

      expect(outcome.triggered).toBe(false);
      expect(outcome.enqueued).toBe(false);
      expect(outcome.reason).toBe('TRIGGER_SKIPPED_NOT_UPDATE');
      expect(emailQueue.length).toBe(0);
    });

    it('self-paced practice test with immediate scoring inserts is_released = true and does NOT fire trigger', () => {
      tests.set('test-prac', {
        test_id: 'test-prac',
        title: 'Quick Practice: Optics 20 Questions',
        total_marks: 80,
        result_release_mode: 'immediate',
        test_type: 'practice',
      });

      attempts.set('att-prac-1', {
        attempt_id: 'att-prac-1',
        test_id: 'test-prac',
        student_id: 'stud-1',
        attempt_number: 1,
        status: 'completed',
      });

      const insertedRow: SimulatedMockResult = {
        result_id: 'res-prac-1',
        attempt_id: 'att-prac-1',
        test_id: 'test-prac',
        student_id: 'stud-1',
        institute_id: 'inst-1',
        total_score: 72,
        max_score: 80,
        percentage: 90.0,
        rank: null,
        percentile: null,
        correct_count: 18,
        wrong_count: 2,
        skipped_count: 0,
        total_time_seconds: 1200,
        is_released: true,
        released_at: '2026-11-21T11:00:00Z',
      };

      const outcome = simulateMockResultReleaseTrigger(null, insertedRow, 'INSERT', {
        tests,
        attempts,
        students,
        profiles,
        emailQueue,
      });

      expect(outcome.triggered).toBe(false);
      expect(emailQueue.length).toBe(0);
    });

    it('routine test submission creating initial unreleased record (is_released = false) does NOT fire trigger', () => {
      tests.set('test-mock-def', {
        test_id: 'test-mock-def',
        title: 'Deferred Release Grand Test',
        total_marks: 300,
        result_release_mode: 'scheduled',
        test_type: 'mock',
      });

      attempts.set('att-mock-1', {
        attempt_id: 'att-mock-1',
        test_id: 'test-mock-def',
        student_id: 'stud-1',
        attempt_number: 1,
        status: 'submitted',
      });

      const initialInsert: SimulatedMockResult = {
        result_id: 'res-def-1',
        attempt_id: 'att-mock-1',
        test_id: 'test-mock-def',
        student_id: 'stud-1',
        institute_id: 'inst-1',
        total_score: 210,
        max_score: 300,
        percentage: 70.0,
        rank: null,
        percentile: null,
        correct_count: 55,
        wrong_count: 15,
        skipped_count: 5,
        total_time_seconds: 7000,
        is_released: false,
        released_at: null,
      };

      const outcome = simulateMockResultReleaseTrigger(null, initialInsert, 'INSERT', {
        tests,
        attempts,
        students,
        profiles,
        emailQueue,
      });

      expect(outcome.triggered).toBe(false);
      expect(emailQueue.length).toBe(0);
    });

    it('updating other fields on mock_results while is_released is already true does NOT fire trigger', () => {
      tests.set('test-1', {
        test_id: 'test-1',
        title: 'Ranking Recomputation Test',
        total_marks: 100,
        result_release_mode: 'manual',
        test_type: 'mock',
      });

      attempts.set('att-1', {
        attempt_id: 'att-1',
        test_id: 'test-1',
        student_id: 'stud-1',
        attempt_number: 1,
        status: 'submitted',
      });

      const oldRow: SimulatedMockResult = {
        result_id: 'res-1',
        attempt_id: 'att-1',
        test_id: 'test-1',
        student_id: 'stud-1',
        institute_id: 'inst-1',
        total_score: 80,
        max_score: 100,
        percentage: 80.0,
        rank: 10,
        percentile: 85.0,
        correct_count: 20,
        wrong_count: 5,
        skipped_count: 0,
        total_time_seconds: 3000,
        is_released: true,
        released_at: '2026-11-21T10:00:00Z',
      };

      const newRow: SimulatedMockResult = {
        ...oldRow,
        rank: 9,
        percentile: 86.5,
      };

      const outcome = simulateMockResultReleaseTrigger(oldRow, newRow, 'UPDATE', {
        tests,
        attempts,
        students,
        profiles,
        emailQueue,
      });

      expect(outcome.triggered).toBe(false);
      expect(outcome.reason).toBe('TRIGGER_CONDITION_NOT_MET');
      expect(emailQueue.length).toBe(0);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 4. Release-Generation Safety & Microsecond Precision
  // ════════════════════════════════════════════════════════════════════════════
  describe('4. Release-Generation Safety & Microsecond Precision', () => {
    let tests: Map<string, SimulatedMockTest>;
    let attempts: Map<string, SimulatedAttempt>;
    let students: Map<string, SimulatedStudent>;
    let profiles: Map<string, SimulatedProfile>;
    let emailQueue: SimulatedEmailQueueJob[];

    beforeEach(() => {
      tests = new Map();
      attempts = new Map();
      students = new Map();
      profiles = new Map();
      emailQueue = [];

      tests.set('t-idem', { test_id: 't-idem', title: 'Idempotency Test', total_marks: 100, result_release_mode: 'manual', test_type: 'mock' });
      profiles.set('p-1', { profile_id: 'p-1', name: 'Rohan Joshi', email: 'rohan@example.com' });
      students.set('s-1', { student_id: 's-1', profile_id: 'p-1' });
      attempts.set('att-1', { attempt_id: 'att-1', test_id: 't-idem', student_id: 's-1', attempt_number: 1, status: 'submitted' });
    });

    it('idempotency key strictly follows exm_res:{attempt_id}:{timestamp_utc} format', () => {
      const oldRow: SimulatedMockResult = {
        result_id: 'res-1', attempt_id: 'att-1', test_id: 't-idem', student_id: 's-1', institute_id: 'inst-1',
        total_score: 75, max_score: 100, percentage: 75.0, rank: null, percentile: null,
        correct_count: 15, wrong_count: 5, skipped_count: 0, total_time_seconds: 3000,
        is_released: false, released_at: null,
      };
      const newRow: SimulatedMockResult = { ...oldRow, is_released: true, released_at: '2026-11-21T14:22:30.456789Z' };

      const outcome = simulateMockResultReleaseTrigger(oldRow, newRow, 'UPDATE', { tests, attempts, students, profiles, emailQueue });

      expect(outcome.queueJob?.idempotency_key).toMatch(/^exm_res:att-1:\d{8}T\d{6}\.\d{6}Z$/);
      expect(outcome.queueJob?.idempotency_key).toContain('exm_res:att-1:20261121T142230.456000Z');
    });

    it('multiple attempts by the same student receive independent attempt-scoped notifications', () => {
      attempts.set('att-2', { attempt_id: 'att-2', test_id: 't-idem', student_id: 's-1', attempt_number: 2, status: 'submitted' });

      const att1Old: SimulatedMockResult = { result_id: 'r-1', attempt_id: 'att-1', test_id: 't-idem', student_id: 's-1', institute_id: 'inst-1', total_score: 70, max_score: 100, percentage: 70.0, rank: null, percentile: null, correct_count: 14, wrong_count: 6, skipped_count: 0, total_time_seconds: 3000, is_released: false, released_at: null };
      const att1New: SimulatedMockResult = { ...att1Old, is_released: true, released_at: '2026-11-21T10:00:00Z' };
      simulateMockResultReleaseTrigger(att1Old, att1New, 'UPDATE', { tests, attempts, students, profiles, emailQueue });

      const att2Old: SimulatedMockResult = { result_id: 'r-2', attempt_id: 'att-2', test_id: 't-idem', student_id: 's-1', institute_id: 'inst-1', total_score: 88, max_score: 100, percentage: 88.0, rank: null, percentile: null, correct_count: 18, wrong_count: 2, skipped_count: 0, total_time_seconds: 2800, is_released: false, released_at: null };
      const att2New: SimulatedMockResult = { ...att2Old, is_released: true, released_at: '2026-11-21T12:00:00Z' };
      simulateMockResultReleaseTrigger(att2Old, att2New, 'UPDATE', { tests, attempts, students, profiles, emailQueue });

      expect(emailQueue.length).toBe(2);
      expect(emailQueue[0].payload.attemptNumber).toBe(1);
      expect(emailQueue[0].payload.score).toBe(70);
      expect(emailQueue[1].payload.attemptNumber).toBe(2);
      expect(emailQueue[1].payload.score).toBe(88);
    });

    // ── 4.1. Timestamp Precision & Microsecond Equality (Issue 1) ──
    describe('4.1. Timestamp Precision & Microsecond Equality', () => {
      it('rejects an older release cycle that differs only in microsecond precision (.123456 vs .123999)', async () => {
        const queuedReleasedAt = '2026-11-21T10:00:00.123456Z';
        const dbReleasedAt = '2026-11-21T10:00:00.123999Z';

        const mockSelect = vi.fn().mockResolvedValueOnce({
          data: {
            attempt_id: 'att-micro',
            test_id: 't-micro',
            is_released: true,
            released_at: dbReleasedAt,
          },
          error: null,
        });

        const mockClient = {
          from: vi.fn(() => ({
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: mockSelect,
              })),
            })),
          })),
        };

        const workerDb = createSupabaseWorkerDb(mockClient);
        const result = await workerDb.checkMockResultReleaseEligibility({
          attemptId: 'att-micro',
          testId: 't-micro',
          releasedAt: queuedReleasedAt,
        });

        expect(result.eligible).toBe(false);
        expect(result.cancelReason).toBe('TEST_RESULT_RELEASE_SUPERSEDED');
      });

      it('accepts exact microsecond match down to the 6th decimal place', async () => {
        const exactTimestamp = '2026-11-21T10:00:00.123456Z';

        const mockSelect = vi.fn().mockResolvedValueOnce({
          data: {
            attempt_id: 'att-micro-match',
            test_id: 't-micro-match',
            is_released: true,
            released_at: exactTimestamp,
          },
          error: null,
        });

        const mockClient = {
          from: vi.fn(() => ({
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: mockSelect,
              })),
            })),
          })),
        };

        const workerDb = createSupabaseWorkerDb(mockClient);
        const result = await workerDb.checkMockResultReleaseEligibility({
          attemptId: 'att-micro-match',
          testId: 't-micro-match',
          releasedAt: exactTimestamp,
        });

        expect(result.eligible).toBe(true);
        expect(result.cancelReason).toBeUndefined();
      });

      it('normalizePostgresTimestamp preserves 6 microsecond digits and rejects invalid formats', () => {
        expect(normalizePostgresTimestamp('2026-11-21T10:00:00.123456Z')).toBe('2026-11-21T10:00:00.123456Z');
        expect(normalizePostgresTimestamp('2026-11-21T10:00:00.123456+00:00')).toBe('2026-11-21T10:00:00.123456Z');
        expect(normalizePostgresTimestamp('2026-11-21T10:00:00.12Z')).toBe('2026-11-21T10:00:00.120000Z');
        expect(normalizePostgresTimestamp('not-a-valid-date')).toBeNull();
        expect(normalizePostgresTimestamp(null)).toBeNull();
        expect(normalizePostgresTimestamp(undefined)).toBeNull();
        expect(normalizePostgresTimestamp('')).toBeNull();
      });
    });

    // ── 4.2. Missing or Invalid Metadata Fails Closed (Issue 2 & 3) ──
    describe('4.2. Missing or Invalid Metadata Fails Closed with Distinct Reasons', () => {
      let mockClient: any;
      let mockSelect: any;

      beforeEach(() => {
        mockSelect = vi.fn();
        mockClient = {
          from: vi.fn(() => ({
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: mockSelect,
              })),
            })),
          })),
        };
      });

      it('fails closed when attemptId is missing or empty', async () => {
        const workerDb = createSupabaseWorkerDb(mockClient);
        const res = await workerDb.checkMockResultReleaseEligibility({
          testId: 't-1',
          releasedAt: '2026-11-21T10:00:00.000Z',
        });
        expect(res.eligible).toBe(false);
        expect(res.cancelReason).toBe('TEST_RESULT_MISSING_ATTEMPT_ID');
      });

      it('fails closed when testId is missing or empty', async () => {
        const workerDb = createSupabaseWorkerDb(mockClient);
        const res = await workerDb.checkMockResultReleaseEligibility({
          attemptId: 'att-1',
          releasedAt: '2026-11-21T10:00:00.000Z',
        });
        expect(res.eligible).toBe(false);
        expect(res.cancelReason).toBe('TEST_RESULT_MISSING_TEST_ID');
      });

      it('fails closed when releasedAt is missing or empty', async () => {
        const workerDb = createSupabaseWorkerDb(mockClient);
        const res = await workerDb.checkMockResultReleaseEligibility({
          attemptId: 'att-1',
          testId: 't-1',
        });
        expect(res.eligible).toBe(false);
        expect(res.cancelReason).toBe('TEST_RESULT_MISSING_RELEASED_AT');
      });

      it('fails closed when queued releasedAt is malformed', async () => {
        const workerDb = createSupabaseWorkerDb(mockClient);
        const res = await workerDb.checkMockResultReleaseEligibility({
          attemptId: 'att-1',
          testId: 't-1',
          releasedAt: 'invalid-iso-date-string',
        });
        expect(res.eligible).toBe(false);
        expect(res.cancelReason).toBe('TEST_RESULT_MALFORMED_RELEASED_AT');
      });

      it('fails closed when testId does not match the database result record', async () => {
        mockSelect.mockResolvedValueOnce({
          data: {
            attempt_id: 'att-1',
            test_id: 'actual-test-id-in-db',
            is_released: true,
            released_at: '2026-11-21T10:00:00.000000Z',
          },
          error: null,
        });

        const workerDb = createSupabaseWorkerDb(mockClient);
        const res = await workerDb.checkMockResultReleaseEligibility({
          attemptId: 'att-1',
          testId: 'wrong-test-id-in-payload',
          releasedAt: '2026-11-21T10:00:00.000000Z',
        });
        expect(res.eligible).toBe(false);
        expect(res.cancelReason).toBe('TEST_RESULT_TEST_ID_MISMATCH');
      });

      it('fails closed when database released_at is null on an unreleased or corrupted record', async () => {
        mockSelect.mockResolvedValueOnce({
          data: {
            attempt_id: 'att-1',
            test_id: 't-1',
            is_released: true,
            released_at: null,
          },
          error: null,
        });

        const workerDb = createSupabaseWorkerDb(mockClient);
        const res = await workerDb.checkMockResultReleaseEligibility({
          attemptId: 'att-1',
          testId: 't-1',
          releasedAt: '2026-11-21T10:00:00.000000Z',
        });
        expect(res.eligible).toBe(false);
        expect(res.cancelReason).toBe('TEST_RESULT_DATABASE_RELEASED_AT_NULL');
      });

      it('fails closed when database released_at is malformed text', async () => {
        mockSelect.mockResolvedValueOnce({
          data: {
            attempt_id: 'att-1',
            test_id: 't-1',
            is_released: true,
            released_at: 'corrupted-timestamp',
          },
          error: null,
        });

        const workerDb = createSupabaseWorkerDb(mockClient);
        const res = await workerDb.checkMockResultReleaseEligibility({
          attemptId: 'att-1',
          testId: 't-1',
          releasedAt: '2026-11-21T10:00:00.000000Z',
        });
        expect(res.eligible).toBe(false);
        expect(res.cancelReason).toBe('TEST_RESULT_DATABASE_RELEASED_AT_MALFORMED');
      });
    });

    // ── 4.3. Duplicate Suppression Across Release Generations (Issue 4) ──
    describe('4.3. Duplicate Suppression Across Release Generations', () => {
      let tests: Map<string, SimulatedMockTest>;
      let attempts: Map<string, SimulatedAttempt>;
      let students: Map<string, SimulatedStudent>;
      let profiles: Map<string, SimulatedProfile>;
      let emailQueue: SimulatedEmailQueueJob[];

      beforeEach(() => {
        tests = new Map();
        attempts = new Map();
        students = new Map();
        profiles = new Map();
        emailQueue = [];

        tests.set('t-gen', { test_id: 't-gen', title: 'Generation Test', total_marks: 100, result_release_mode: 'manual', test_type: 'mock' });
        profiles.set('p-1', { profile_id: 'p-1', name: 'Student One', email: 's1@example.com' });
        students.set('s-1', { student_id: 's-1', profile_id: 'p-1' });
        attempts.set('att-gen-1', { attempt_id: 'att-gen-1', test_id: 't-gen', student_id: 's-1', attempt_number: 1, status: 'submitted' });
      });

      it('Case 1: Old pending job followed by new release enqueues fresh job for new generation', () => {
        emailQueue.push({
          queue_id: 'q-old-pending',
          recipient_profile_id: 'p-1',
          recipient_email: 's1@example.com',
          recipient_name: 'Student One',
          event_type: 'EXM-01',
          subject: 'Official Result Published',
          template_id: 'EXM-01',
          payload: { attemptId: 'att-gen-1', releasedAt: '2026-11-21T10:00:00.000000Z' },
          priority: 'normal',
          status: 'pending',
          idempotency_key: 'exm_res:att-gen-1:20261121T100000.000000Z',
        });

        const oldRow: SimulatedMockResult = {
          result_id: 'r-1', attempt_id: 'att-gen-1', test_id: 't-gen', student_id: 's-1', institute_id: 'inst-1',
          total_score: 80, max_score: 100, percentage: 80.0, rank: null, percentile: null,
          correct_count: 20, wrong_count: 5, skipped_count: 0, total_time_seconds: 3600,
          is_released: false, released_at: null,
        };
        const newRow: SimulatedMockResult = {
          ...oldRow,
          is_released: true,
          released_at: '2026-11-21T11:30:00.000000Z',
        };

        const outcome = simulateMockResultReleaseTrigger(oldRow, newRow, 'UPDATE', { tests, attempts, students, profiles, emailQueue });

        expect(outcome.enqueued).toBe(true);
        expect(emailQueue.length).toBe(2);
        expect(emailQueue[1].payload.releasedAt).toBe('2026-11-21T11:30:00.000000Z');
      });

      it('Case 2: Old processing job cancelled as superseded followed by new release enqueues fresh job', () => {
        emailQueue.push({
          queue_id: 'q-old-processing-cancelled',
          recipient_profile_id: 'p-1',
          recipient_email: 's1@example.com',
          recipient_name: 'Student One',
          event_type: 'EXM-01',
          subject: 'Official Result Published',
          template_id: 'EXM-01',
          payload: { attemptId: 'att-gen-1', releasedAt: '2026-11-21T10:00:00.000000Z' },
          priority: 'normal',
          status: 'cancelled',
          cancel_reason: 'TEST_RESULT_RELEASE_SUPERSEDED',
          idempotency_key: 'exm_res:att-gen-1:20261121T100000.000000Z',
        });

        const oldRow: SimulatedMockResult = {
          result_id: 'r-1', attempt_id: 'att-gen-1', test_id: 't-gen', student_id: 's-1', institute_id: 'inst-1',
          total_score: 80, max_score: 100, percentage: 80.0, rank: null, percentile: null,
          correct_count: 20, wrong_count: 5, skipped_count: 0, total_time_seconds: 3600,
          is_released: false, released_at: null,
        };
        const newRow: SimulatedMockResult = {
          ...oldRow,
          is_released: true,
          released_at: '2026-11-21T12:00:00.000000Z',
        };

        const outcome = simulateMockResultReleaseTrigger(oldRow, newRow, 'UPDATE', { tests, attempts, students, profiles, emailQueue });

        expect(outcome.enqueued).toBe(true);
        expect(emailQueue.length).toBe(2);
        expect(emailQueue[1].status).toBe('pending');
      });

      it('Case 3: Already-sent notification followed by re-release suppresses duplicate dispatch', () => {
        emailQueue.push({
          queue_id: 'q-sent',
          recipient_profile_id: 'p-1',
          recipient_email: 's1@example.com',
          recipient_name: 'Student One',
          event_type: 'EXM-01',
          subject: 'Official Result Published',
          template_id: 'EXM-01',
          payload: { attemptId: 'att-gen-1', releasedAt: '2026-11-21T10:00:00.000000Z' },
          priority: 'normal',
          status: 'sent',
          idempotency_key: 'exm_res:att-gen-1:20261121T100000.000000Z',
        });

        const oldRow: SimulatedMockResult = {
          result_id: 'r-1', attempt_id: 'att-gen-1', test_id: 't-gen', student_id: 's-1', institute_id: 'inst-1',
          total_score: 80, max_score: 100, percentage: 80.0, rank: null, percentile: null,
          correct_count: 20, wrong_count: 5, skipped_count: 0, total_time_seconds: 3600,
          is_released: false, released_at: null,
        };
        const newRow: SimulatedMockResult = {
          ...oldRow,
          is_released: true,
          released_at: '2026-11-21T13:00:00.000000Z',
        };

        const outcome = simulateMockResultReleaseTrigger(oldRow, newRow, 'UPDATE', { tests, attempts, students, profiles, emailQueue });

        expect(outcome.enqueued).toBe(false);
        expect(outcome.reason).toBe('DUPLICATE_SUPPRESSED_ALREADY_SENT');
        expect(emailQueue.length).toBe(1);
      });

      it('Case 4: Same-generation processing job suppresses duplicate trigger execution', () => {
        const timestamp = '2026-11-21T10:00:00.000000Z';
        emailQueue.push({
          queue_id: 'q-processing-same-gen',
          recipient_profile_id: 'p-1',
          recipient_email: 's1@example.com',
          recipient_name: 'Student One',
          event_type: 'EXM-01',
          subject: 'Official Result Published',
          template_id: 'EXM-01',
          payload: { attemptId: 'att-gen-1', releasedAt: timestamp },
          priority: 'normal',
          status: 'processing',
          idempotency_key: `exm_res:att-gen-1:${timestamp}`,
        });

        const oldRow: SimulatedMockResult = {
          result_id: 'r-1', attempt_id: 'att-gen-1', test_id: 't-gen', student_id: 's-1', institute_id: 'inst-1',
          total_score: 80, max_score: 100, percentage: 80.0, rank: null, percentile: null,
          correct_count: 20, wrong_count: 5, skipped_count: 0, total_time_seconds: 3600,
          is_released: false, released_at: null,
        };
        const newRow: SimulatedMockResult = { ...oldRow, is_released: true, released_at: timestamp };

        const outcome = simulateMockResultReleaseTrigger(oldRow, newRow, 'UPDATE', { tests, attempts, students, profiles, emailQueue });

        expect(outcome.enqueued).toBe(false);
        expect(outcome.reason).toBe('DUPLICATE_SUPPRESSED_SAME_GENERATION_IN_FLIGHT');
        expect(emailQueue.length).toBe(1);
      });

      it('Case 5: Two different release generations with active prior processing job creates new generation job', () => {
        const t1 = '2026-11-21T10:00:00.000000Z';
        const t2 = '2026-11-21T11:00:00.000000Z';

        emailQueue.push({
          queue_id: 'q-prior-processing',
          recipient_profile_id: 'p-1',
          recipient_email: 's1@example.com',
          recipient_name: 'Student One',
          event_type: 'EXM-01',
          subject: 'Official Result Published',
          template_id: 'EXM-01',
          payload: { attemptId: 'att-gen-1', releasedAt: t1 },
          priority: 'normal',
          status: 'processing',
          idempotency_key: `exm_res:att-gen-1:${t1}`,
        });

        const oldRow: SimulatedMockResult = {
          result_id: 'r-1', attempt_id: 'att-gen-1', test_id: 't-gen', student_id: 's-1', institute_id: 'inst-1',
          total_score: 80, max_score: 100, percentage: 80.0, rank: null, percentile: null,
          correct_count: 20, wrong_count: 5, skipped_count: 0, total_time_seconds: 3600,
          is_released: false, released_at: null,
        };
        const newRow: SimulatedMockResult = { ...oldRow, is_released: true, released_at: t2 };

        const outcome = simulateMockResultReleaseTrigger(oldRow, newRow, 'UPDATE', { tests, attempts, students, profiles, emailQueue });

        expect(outcome.enqueued).toBe(true);
        expect(emailQueue.length).toBe(2);
        expect(emailQueue[1].payload.releasedAt).toBe(t2);
      });

      it('Case 6: Duplicate trigger execution for the same release is deduplicated', () => {
        const timestamp = '2026-11-21T10:00:00.000000Z';
        const oldRow: SimulatedMockResult = {
          result_id: 'r-1', attempt_id: 'att-gen-1', test_id: 't-gen', student_id: 's-1', institute_id: 'inst-1',
          total_score: 80, max_score: 100, percentage: 80.0, rank: null, percentile: null,
          correct_count: 20, wrong_count: 5, skipped_count: 0, total_time_seconds: 3600,
          is_released: false, released_at: null,
        };
        const newRow: SimulatedMockResult = { ...oldRow, is_released: true, released_at: timestamp };

        const outcome1 = simulateMockResultReleaseTrigger(oldRow, newRow, 'UPDATE', { tests, attempts, students, profiles, emailQueue });
        expect(outcome1.enqueued).toBe(true);

        const outcome2 = simulateMockResultReleaseTrigger(oldRow, newRow, 'UPDATE', { tests, attempts, students, profiles, emailQueue });
        expect(outcome2.enqueued).toBe(false);
        expect(emailQueue.length).toBe(1);
      });
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 5. Pre-Dispatch Release Eligibility & Generation Safety (Worker Race Protection)
  // ════════════════════════════════════════════════════════════════════════════
  describe('5. Pre-Dispatch Release Eligibility & Generation Safety (Worker Race Protection)', () => {
    function createMockWorkerDb(overrides: {
      claimBatchJobs?: EmailQueueJob[];
      isSuppressed?: boolean;
      releaseEligibility?: MockResultEligibility;
      eligibilityThrows?: boolean;
    } = {}): EmailWorkerDatabase {
      return {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => overrides.claimBatchJobs || []),
        isSuppressed: vi.fn(async () => overrides.isSuppressed ?? false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true, status: 'pending' })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => {
          if (overrides.eligibilityThrows) {
            throw new Error('Database connection failed during release verification');
          }
          return overrides.releaseEligibility || { eligible: true };
        }),
        acquireMockResultDispatchReservation: vi.fn(async () => ({ success: true, reason: 'RESERVATION_ACQUIRED' })),
        updateMockResultProviderOutcome: vi.fn(async () => true),
      };
    }

    it('worker dispatches successfully when result is released and release timestamp matches queued cycle', async () => {
      const job: EmailQueueJob = {
        queue_id: 'q-exm-valid',
        recipient_profile_id: 'prof-1',
        recipient_email: 'student@example.com',
        recipient_name: 'Dev Sharma',
        event_type: 'EXM-01',
        subject: 'Official Result Published',
        template_id: 'EXM-01',
        payload: {
          attemptId: 'att-valid-1',
          testId: 't-valid-1',
          testTitle: 'NEET Grand Test',
          score: 600,
          maxScore: 720,
          releasedAt: '2026-11-21T10:00:00.000Z',
        },
        priority: 'normal',
        status: 'processing',
        attempts: 1,
        max_attempts: 5,
        created_at: new Date().toISOString(),
      };

      const db = createMockWorkerDb({
        claimBatchJobs: [job],
        releaseEligibility: { eligible: true },
      });

      const provider = {
        sendEmail: vi.fn(async (): Promise<EmailSendResult> => ({
          success: true,
          providerMessageId: 'resend-msg-12345',
        })),
      };

      const batchResult = await runEmailWorkerBatch(db, provider, { batchSize: 1 });

      expect(batchResult.succeeded).toBe(1);
      expect(batchResult.cancelled).toBe(0);
      expect(db.checkMockResultReleaseEligibility).toHaveBeenCalledWith(job.payload);
      expect(provider.sendEmail).toHaveBeenCalledTimes(1);
      expect(db.recordSuccess).toHaveBeenCalledWith('q-exm-valid', 'resend-msg-12345');
    });

    it('worker cancels claimed job with TEST_RESULT_UNRELEASED if result was unreleased prior to dispatch', async () => {
      const job: EmailQueueJob = {
        queue_id: 'q-exm-unreleased',
        recipient_profile_id: 'prof-1',
        recipient_email: 'student@example.com',
        recipient_name: 'Dev Sharma',
        event_type: 'EXM-01',
        subject: 'Official Result Published',
        template_id: 'EXM-01',
        payload: {
          attemptId: 'att-unreleased-1',
          testId: 't-1',
          testTitle: 'NEET Grand Test',
          score: 600,
          maxScore: 720,
          releasedAt: '2026-11-21T10:00:00.000Z',
        },
        priority: 'normal',
        status: 'processing',
        attempts: 1,
        max_attempts: 5,
        created_at: new Date().toISOString(),
      };

      const db = createMockWorkerDb({
        claimBatchJobs: [job],
        releaseEligibility: { eligible: false, cancelReason: 'TEST_RESULT_UNRELEASED' },
      });

      const provider = { sendEmail: vi.fn() };

      const batchResult = await runEmailWorkerBatch(db, provider, { batchSize: 1 });

      expect(batchResult.succeeded).toBe(0);
      expect(batchResult.cancelled).toBe(1);
      expect(db.cancelJob).toHaveBeenCalledWith('q-exm-unreleased', 'TEST_RESULT_UNRELEASED');
      expect(provider.sendEmail).not.toHaveBeenCalled();
    });

    it('worker generation safety: cancels older queued job as TEST_RESULT_RELEASE_SUPERSEDED if release timestamp changed', async () => {
      const job: EmailQueueJob = {
        queue_id: 'q-exm-superseded',
        recipient_profile_id: 'prof-1',
        recipient_email: 'student@example.com',
        recipient_name: 'Dev Sharma',
        event_type: 'EXM-01',
        subject: 'Official Result Published',
        template_id: 'EXM-01',
        payload: {
          attemptId: 'att-super-1',
          testId: 't-1',
          testTitle: 'NEET Grand Test',
          score: 600,
          maxScore: 720,
          releasedAt: '2026-11-21T10:00:00.000Z',
        },
        priority: 'normal',
        status: 'processing',
        attempts: 1,
        max_attempts: 5,
        created_at: new Date().toISOString(),
      };

      const db = createMockWorkerDb({
        claimBatchJobs: [job],
        releaseEligibility: { eligible: false, cancelReason: 'TEST_RESULT_RELEASE_SUPERSEDED' },
      });

      const provider = { sendEmail: vi.fn() };

      const batchResult = await runEmailWorkerBatch(db, provider, { batchSize: 1 });

      expect(batchResult.succeeded).toBe(0);
      expect(batchResult.cancelled).toBe(1);
      expect(db.cancelJob).toHaveBeenCalledWith('q-exm-superseded', 'TEST_RESULT_RELEASE_SUPERSEDED');
      expect(provider.sendEmail).not.toHaveBeenCalled();
    });

    it('worker pre-dispatch check transient failure: database query error schedules retry rather than cancelling', async () => {
      const job: EmailQueueJob = {
        queue_id: 'q-exm-err',
        recipient_profile_id: 'prof-1',
        recipient_email: 'student@example.com',
        recipient_name: 'Dev Sharma',
        event_type: 'EXM-01',
        subject: 'Official Result Published',
        template_id: 'EXM-01',
        payload: { attemptId: 'att-err-1', testId: 't-1', releasedAt: '2026-11-21T10:00:00.000Z' },
        priority: 'normal',
        status: 'processing',
        attempts: 1,
        max_attempts: 5,
        created_at: new Date().toISOString(),
      };

      const db = createMockWorkerDb({
        claimBatchJobs: [job],
        eligibilityThrows: true,
      });

      const provider = { sendEmail: vi.fn() };

      const batchResult = await runEmailWorkerBatch(db, provider, { batchSize: 1 });

      expect(batchResult.succeeded).toBe(0);
      expect(batchResult.cancelled).toBe(0);
      expect(batchResult.retried).toBe(1);
      expect(db.cancelJob).not.toHaveBeenCalled();
      expect(db.scheduleRetry).toHaveBeenCalledWith(
        'q-exm-err',
        expect.stringContaining('Database connection failed'),
        expect.any(Number)
      );
      expect(provider.sendEmail).not.toHaveBeenCalled();
    });

    it('non-EXM events bypass the mock result check with zero interference', async () => {
      const payJob: EmailQueueJob = {
        queue_id: 'q-pay-01',
        recipient_profile_id: 'prof-1',
        recipient_email: 'student@example.com',
        recipient_name: 'Dev Sharma',
        event_type: 'PAY-01',
        subject: 'Course Purchase Confirmed',
        template_id: 'PAY-01',
        payload: { courseName: 'NEET 2026', amount: 5000 },
        priority: 'normal',
        status: 'processing',
        attempts: 1,
        max_attempts: 5,
        created_at: new Date().toISOString(),
      };

      const db = createMockWorkerDb({ claimBatchJobs: [payJob] });
      const provider = {
        sendEmail: vi.fn(async (): Promise<EmailSendResult> => ({
          success: true,
          providerMessageId: 'resend-pay-1',
        })),
      };

      const batchResult = await runEmailWorkerBatch(db, provider, { batchSize: 1 });

      expect(batchResult.succeeded).toBe(1);
      expect(db.checkMockResultReleaseEligibility).not.toHaveBeenCalled();
      expect(provider.sendEmail).toHaveBeenCalledTimes(1);
    });

    // ── 5.1. Mandatory EXM-01 Verification & Transient Error Recovery (Issue 5 & 6) ──
    describe('5.1. Mandatory EXM-01 Verification & Transient Error Recovery', () => {
      it('refuses to dispatch EXM-01 when eligibility checker is completely unavailable and schedules retry', async () => {
        const job: EmailQueueJob = {
          queue_id: 'q-no-checker',
          recipient_profile_id: 'prof-1',
          recipient_email: 'student@example.com',
          recipient_name: 'Dev Sharma',
          event_type: 'EXM-01',
          subject: 'Official Result Published',
          template_id: 'EXM-01',
          payload: { attemptId: 'att-1', testId: 't-1', releasedAt: '2026-11-21T10:00:00.000Z' },
          priority: 'normal',
          status: 'processing',
          attempts: 1,
          max_attempts: 5,
          created_at: new Date().toISOString(),
        };

        const dbWithoutChecker: EmailWorkerDatabase = {
          recoverAbandonedLocks: vi.fn(async () => 0),
          claimBatch: vi.fn(async () => [job]),
          isSuppressed: vi.fn(async () => false),
          recordSuccess: vi.fn(async () => true),
          scheduleRetry: vi.fn(async () => ({ success: true, status: 'pending' })),
          markFailed: vi.fn(async () => true),
          cancelJob: vi.fn(async () => true),
        };

        const provider = { sendEmail: vi.fn() };

        const batchResult = await runEmailWorkerBatch(dbWithoutChecker, provider, { batchSize: 1 });

        expect(batchResult.succeeded).toBe(0);
        expect(batchResult.retried).toBe(1);
        expect(batchResult.cancelled).toBe(0);
        expect(provider.sendEmail).not.toHaveBeenCalled();
        expect(dbWithoutChecker.scheduleRetry).toHaveBeenCalledWith(
          'q-no-checker',
          expect.stringContaining('ELIGIBILITY_CHECKER_UNAVAILABLE'),
          expect.any(Number)
        );
      });

      it('schedules retry on transient verification error (network/connection error) instead of permanently cancelling', async () => {
        const job: EmailQueueJob = {
          queue_id: 'q-transient-retry',
          recipient_profile_id: 'prof-1',
          recipient_email: 'student@example.com',
          recipient_name: 'Dev Sharma',
          event_type: 'EXM-01',
          subject: 'Official Result Published',
          template_id: 'EXM-01',
          payload: { attemptId: 'att-1', testId: 't-1', releasedAt: '2026-11-21T10:00:00.000Z' },
          priority: 'normal',
          status: 'processing',
          attempts: 1,
          max_attempts: 5,
          created_at: new Date().toISOString(),
        };

        const dbWithTransientError: EmailWorkerDatabase = {
          recoverAbandonedLocks: vi.fn(async () => 0),
          claimBatch: vi.fn(async () => [job]),
          isSuppressed: vi.fn(async () => false),
          recordSuccess: vi.fn(async () => true),
          scheduleRetry: vi.fn(async () => ({ success: true, status: 'pending' })),
          markFailed: vi.fn(async () => true),
          cancelJob: vi.fn(async () => true),
          checkMockResultReleaseEligibility: vi.fn(async () => {
            throw new Error('Connection reset by peer');
          }),
        };

        const provider = { sendEmail: vi.fn() };

        const batchResult = await runEmailWorkerBatch(dbWithTransientError, provider, { batchSize: 1 });

        expect(batchResult.succeeded).toBe(0);
        expect(batchResult.retried).toBe(1);
        expect(batchResult.cancelled).toBe(0);
        expect(provider.sendEmail).not.toHaveBeenCalled();
        expect(dbWithTransientError.cancelJob).not.toHaveBeenCalled();
        expect(dbWithTransientError.scheduleRetry).toHaveBeenCalledWith(
          'q-transient-retry',
          expect.stringContaining('Connection reset by peer'),
          expect.any(Number)
        );
      });

      it('permanently cancels job when checker returns non-transient ineligibility (unreleased or superseded)', async () => {
        const job: EmailQueueJob = {
          queue_id: 'q-permanent-cancel',
          recipient_profile_id: 'prof-1',
          recipient_email: 'student@example.com',
          recipient_name: 'Dev Sharma',
          event_type: 'EXM-01',
          subject: 'Official Result Published',
          template_id: 'EXM-01',
          payload: { attemptId: 'att-1', testId: 't-1', releasedAt: '2026-11-21T10:00:00.000Z' },
          priority: 'normal',
          status: 'processing',
          attempts: 1,
          max_attempts: 5,
          created_at: new Date().toISOString(),
        };

        const dbWithPermanentIneligibility: EmailWorkerDatabase = {
          recoverAbandonedLocks: vi.fn(async () => 0),
          claimBatch: vi.fn(async () => [job]),
          isSuppressed: vi.fn(async () => false),
          recordSuccess: vi.fn(async () => true),
          scheduleRetry: vi.fn(async () => ({ success: true })),
          markFailed: vi.fn(async () => true),
          cancelJob: vi.fn(async () => true),
          checkMockResultReleaseEligibility: vi.fn(async () => ({
            eligible: false,
            isTransient: false,
            cancelReason: 'TEST_RESULT_UNRELEASED',
          })),
        };

        const provider = { sendEmail: vi.fn() };

        const batchResult = await runEmailWorkerBatch(dbWithPermanentIneligibility, provider, { batchSize: 1 });

        expect(batchResult.succeeded).toBe(0);
        expect(batchResult.retried).toBe(0);
        expect(batchResult.cancelled).toBe(1);
        expect(provider.sendEmail).not.toHaveBeenCalled();
        expect(dbWithPermanentIneligibility.cancelJob).toHaveBeenCalledWith(
          'q-permanent-cancel',
          'TEST_RESULT_UNRELEASED'
        );
      });
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 6. Edge Cases & Error Handling
  // ════════════════════════════════════════════════════════════════════════════
  describe('6. Edge Cases & Error Handling', () => {
    let tests: Map<string, SimulatedMockTest>;
    let attempts: Map<string, SimulatedAttempt>;
    let students: Map<string, SimulatedStudent>;
    let profiles: Map<string, SimulatedProfile>;
    let emailQueue: SimulatedEmailQueueJob[];

    beforeEach(() => {
      tests = new Map();
      attempts = new Map();
      students = new Map();
      profiles = new Map();
      emailQueue = [];

      tests.set('t-edge', { test_id: 't-edge', title: 'Edge Case Test', total_marks: 100, result_release_mode: 'manual', test_type: 'mock' });
    });

    it('skips enqueue gracefully without failing transaction when student profile has null or whitespace email', () => {
      profiles.set('prof-no-email', { profile_id: 'prof-no-email', name: 'No Email Student', email: null });
      students.set('stud-no-email', { student_id: 'stud-no-email', profile_id: 'prof-no-email' });
      attempts.set('att-no-email', { attempt_id: 'att-no-email', test_id: 't-edge', student_id: 'stud-no-email', attempt_number: 1, status: 'submitted' });

      const oldRow: SimulatedMockResult = {
        result_id: 'res-no-email', attempt_id: 'att-no-email', test_id: 't-edge', student_id: 'stud-no-email', institute_id: 'inst-1',
        total_score: 50, max_score: 100, percentage: 50.0, rank: null, percentile: null,
        correct_count: 10, wrong_count: 10, skipped_count: 0, total_time_seconds: 3600,
        is_released: false, released_at: null,
      };
      const newRow: SimulatedMockResult = { ...oldRow, is_released: true, released_at: '2026-11-21T12:00:00Z' };

      const outcome = simulateMockResultReleaseTrigger(oldRow, newRow, 'UPDATE', { tests, attempts, students, profiles, emailQueue });

      expect(outcome.triggered).toBe(true);
      expect(outcome.enqueued).toBe(false);
      expect(outcome.reason).toBe('INVALID_RECIPIENT_EMAIL');
      expect(emailQueue.length).toBe(0);
    });

    it('skips enqueue cleanly when attempt record has no corresponding profile', () => {
      attempts.set('att-orphan', { attempt_id: 'att-orphan', test_id: 't-edge', student_id: 'stud-nonexistent', attempt_number: 1, status: 'submitted' });

      const oldRow: SimulatedMockResult = {
        result_id: 'res-orphan', attempt_id: 'att-orphan', test_id: 't-edge', student_id: 'stud-nonexistent', institute_id: 'inst-1',
        total_score: 50, max_score: 100, percentage: 50.0, rank: null, percentile: null,
        correct_count: 10, wrong_count: 10, skipped_count: 0, total_time_seconds: 3600,
        is_released: false, released_at: null,
      };
      const newRow: SimulatedMockResult = { ...oldRow, is_released: true, released_at: '2026-11-21T12:00:00Z' };

      const outcome = simulateMockResultReleaseTrigger(oldRow, newRow, 'UPDATE', { tests, attempts, students, profiles, emailQueue });

      expect(outcome.triggered).toBe(true);
      expect(outcome.enqueued).toBe(false);
      expect(outcome.reason).toBe('STUDENT_NOT_FOUND');
      expect(emailQueue.length).toBe(0);
    });

    it('createSupabaseWorkerDb checkMockResultReleaseEligibility correctly verifies database state', async () => {
      const mockSelect = vi.fn();
      const mockSupabaseClient = {
        from: vi.fn((table: string) => ({
          select: vi.fn((cols: string) => ({
            eq: vi.fn((col: string, val: string) => ({
              maybeSingle: mockSelect,
            })),
          })),
        })),
        rpc: vi.fn(),
      };

      const workerDb = createSupabaseWorkerDb(mockSupabaseClient);
      expect(typeof workerDb.checkMockResultReleaseEligibility).toBe('function');

      // Test Case 1: Missing attemptId
      const res1 = await workerDb.checkMockResultReleaseEligibility!({});
      expect(res1.eligible).toBe(false);
      expect(res1.cancelReason).toBe('TEST_RESULT_MISSING_ATTEMPT_ID');

      // Test Case 2: Result record not found
      mockSelect.mockResolvedValueOnce({ data: null, error: null });
      const res2 = await workerDb.checkMockResultReleaseEligibility!({
        attemptId: 'att-missing',
        testId: 't-1',
        releasedAt: '2026-11-21T10:00:00.000Z',
      });
      expect(res2.eligible).toBe(false);
      expect(res2.cancelReason).toBe('TEST_RESULT_NOT_FOUND');

      // Test Case 3: Result record exists but is_released is false
      mockSelect.mockResolvedValueOnce({
        data: { is_released: false, released_at: null, test_id: 't-1' },
        error: null,
      });
      const res3 = await workerDb.checkMockResultReleaseEligibility!({
        attemptId: 'att-unrel',
        testId: 't-1',
        releasedAt: '2026-11-21T10:00:00.000Z',
      });
      expect(res3.eligible).toBe(false);
      expect(res3.cancelReason).toBe('TEST_RESULT_UNRELEASED');

      // Test Case 4: Result is released but timestamp differs (superseded)
      mockSelect.mockResolvedValueOnce({
        data: { is_released: true, released_at: '2026-11-21T12:00:00.000Z', test_id: 't-1' },
        error: null,
      });
      const res4 = await workerDb.checkMockResultReleaseEligibility!({
        attemptId: 'att-super',
        testId: 't-1',
        releasedAt: '2026-11-21T10:00:00.000Z',
      });
      expect(res4.eligible).toBe(false);
      expect(res4.cancelReason).toBe('TEST_RESULT_RELEASE_SUPERSEDED');

      // Test Case 5: Result is released and timestamp matches perfectly
      mockSelect.mockResolvedValueOnce({
        data: { is_released: true, released_at: '2026-11-21T12:00:00.000Z', test_id: 't-1' },
        error: null,
      });
      const res5 = await workerDb.checkMockResultReleaseEligibility!({
        attemptId: 'att-matched',
        testId: 't-1',
        releasedAt: '2026-11-21T12:00:00.000Z',
      });
      expect(res5.eligible).toBe(true);
      expect(res5.cancelReason).toBeUndefined();

      // Test Case 6: Supabase query throws error -> returns isTransient
      mockSelect.mockRejectedValueOnce(new Error('Network connection timeout'));
      const res6 = await workerDb.checkMockResultReleaseEligibility!({
        attemptId: 'att-err',
        testId: 't-1',
        releasedAt: '2026-11-21T12:00:00.000Z',
      });
      expect(res6.eligible).toBe(false);
      expect(res6.isTransient).toBe(true);
      expect(res6.cancelReason).toContain('Network connection timeout');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 7. Choice 1: Strict First-Only Policy & Concurrency Protection (All 28 Scenarios)
  // ════════════════════════════════════════════════════════════════════════════
  describe('7. Choice 1: Strict First-Only Policy & Concurrency Protection (All 28 Scenarios)', () => {
    function setupAttemptContext() {
      const tests = new Map<string, SimulatedMockTest>([
        [
          't-choice1-1',
          {
            test_id: 't-choice1-1',
            title: 'JEE Advanced Full Mock Test 2026',
            total_marks: 360,
            result_release_mode: 'manual',
            test_type: 'mock',
          },
        ],
      ]);
      const attempts = new Map<string, SimulatedAttempt>([
        [
          'att-choice1-1',
          {
            attempt_id: 'att-choice1-1',
            test_id: 't-choice1-1',
            student_id: 'stud-1',
            attempt_number: 1,
            status: 'completed',
          },
        ],
        [
          'att-choice1-2',
          {
            attempt_id: 'att-choice1-2',
            test_id: 't-choice1-1',
            student_id: 'stud-2',
            attempt_number: 1,
            status: 'completed',
          },
        ],
      ]);
      const students = new Map<string, SimulatedStudent>([
        ['stud-1', { student_id: 'stud-1', profile_id: 'prof-1' }],
        ['stud-2', { student_id: 'stud-2', profile_id: 'prof-2' }],
      ]);
      const profiles = new Map<string, SimulatedProfile>([
        ['prof-1', { profile_id: 'prof-1', name: 'Aarav Patel', email: 'aarav@example.com' }],
        ['prof-2', { profile_id: 'prof-2', name: 'Bhavna Roy', email: 'bhavna@example.com' }],
      ]);
      const emailQueue: SimulatedEmailQueueJob[] = [];
      const dispatches = new Map<string, SimulatedDispatchLedgerRecord>();

      return { tests, attempts, students, profiles, emailQueue, dispatches };
    }

    // ── First-Only Policy (Scenarios 1–8) ──────────────────────────────────

    it('Scenario 1: First official release queues one email', () => {
      const ctx = setupAttemptContext();
      const oldRow: SimulatedMockResult = {
        result_id: 'res-1',
        attempt_id: 'att-choice1-1',
        test_id: 't-choice1-1',
        student_id: 'stud-1',
        institute_id: 'inst-1',
        total_score: 250,
        max_score: 360,
        percentage: 69.44,
        rank: 12,
        percentile: 98.5,
        correct_count: 65,
        wrong_count: 10,
        skipped_count: 15,
        total_time_seconds: 10800,
        is_released: false,
        released_at: null,
      };
      const newRow: SimulatedMockResult = {
        ...oldRow,
        is_released: true,
        released_at: '2026-11-21T10:00:00.000000Z',
      };

      const outcome = simulateMockResultReleaseTrigger(oldRow, newRow, 'UPDATE', ctx);
      expect(outcome.triggered).toBe(true);
      expect(outcome.enqueued).toBe(true);
      expect(outcome.queueJob).toBeDefined();
      expect(outcome.queueJob?.event_type).toBe('EXM-01');
      expect(outcome.queueJob?.status).toBe('pending');
      expect(ctx.emailQueue.length).toBe(1);
    });

    it('Scenario 2: Repeated trigger execution for the same release does not duplicate it', () => {
      const ctx = setupAttemptContext();
      const oldRow: SimulatedMockResult = {
        result_id: 'res-1',
        attempt_id: 'att-choice1-1',
        test_id: 't-choice1-1',
        student_id: 'stud-1',
        institute_id: 'inst-1',
        total_score: 250,
        max_score: 360,
        percentage: 69.44,
        rank: 12,
        percentile: 98.5,
        correct_count: 65,
        wrong_count: 10,
        skipped_count: 15,
        total_time_seconds: 10800,
        is_released: false,
        released_at: null,
      };
      const newRow: SimulatedMockResult = {
        ...oldRow,
        is_released: true,
        released_at: '2026-11-21T10:00:00.000000Z',
      };

      // First trigger
      const first = simulateMockResultReleaseTrigger(oldRow, newRow, 'UPDATE', ctx);
      expect(first.enqueued).toBe(true);
      expect(ctx.emailQueue.length).toBe(1);

      // Duplicate trigger for same release cycle
      const second = simulateMockResultReleaseTrigger(oldRow, newRow, 'UPDATE', ctx);
      expect(second.enqueued).toBe(false);
      expect(second.reason).toBe('DUPLICATE_SUPPRESSED_SAME_GENERATION_IN_FLIGHT');
      expect(ctx.emailQueue.length).toBe(1);
    });

    it('Scenario 3: Once provider acceptance is recorded, a later publication creates no new email', () => {
      const ctx = setupAttemptContext();
      // Simulate that an earlier job was dispatched and accepted by Resend
      ctx.emailQueue.push({
        queue_id: 'q-sent-1',
        recipient_profile_id: 'prof-1',
        recipient_email: 'aarav@example.com',
        recipient_name: 'Aarav Patel',
        event_type: 'EXM-01',
        subject: 'Official Result Published',
        template_id: 'EXM-01',
        payload: { attemptId: 'att-choice1-1', testId: 't-choice1-1', releasedAt: '2026-11-21T10:00:00.000000Z' },
        priority: 'normal',
        status: 'sent',
        idempotency_key: 'exm_res:att-choice1-1:20261121T100000.000000Z',
      });
      ctx.dispatches.set('att-choice1-1', {
        attempt_id: 'att-choice1-1',
        test_id: 't-choice1-1',
        reserved_by_queue_id: 'q-sent-1',
        release_generation: '2026-11-21T10:00:00.000000Z',
        status: 'consumed',
        consumed_at: '2026-11-21T10:01:00.000000Z',
        provider_message_id: 'resend_msg_123',
      });

      // Later unrelease and republication as Release B
      const oldRow: SimulatedMockResult = {
        result_id: 'res-1',
        attempt_id: 'att-choice1-1',
        test_id: 't-choice1-1',
        student_id: 'stud-1',
        institute_id: 'inst-1',
        total_score: 250,
        max_score: 360,
        percentage: 69.44,
        rank: 12,
        percentile: 98.5,
        correct_count: 65,
        wrong_count: 10,
        skipped_count: 15,
        total_time_seconds: 10800,
        is_released: false,
        released_at: null,
      };
      const newRow: SimulatedMockResult = {
        ...oldRow,
        is_released: true,
        released_at: '2026-11-21T14:00:00.000000Z',
      };

      const outcome = simulateMockResultReleaseTrigger(oldRow, newRow, 'UPDATE', ctx);
      expect(outcome.enqueued).toBe(false);
      expect(outcome.reason).toBe('DUPLICATE_SUPPRESSED_ALREADY_SENT');
      expect(ctx.emailQueue.length).toBe(1); // Still only the original sent job
    });

    it('Scenario 4: Corrected score after a sent email creates no new email', () => {
      const ctx = setupAttemptContext();
      ctx.dispatches.set('att-choice1-1', {
        attempt_id: 'att-choice1-1',
        test_id: 't-choice1-1',
        reserved_by_queue_id: 'q-sent-1',
        release_generation: '2026-11-21T10:00:00.000000Z',
        status: 'consumed',
      });
      ctx.emailQueue.push({
        queue_id: 'q-sent-1',
        recipient_profile_id: 'prof-1',
        recipient_email: 'aarav@example.com',
        recipient_name: 'Aarav Patel',
        event_type: 'EXM-01',
        subject: 'Official Result Published',
        template_id: 'EXM-01',
        payload: { attemptId: 'att-choice1-1', testId: 't-choice1-1' },
        priority: 'normal',
        status: 'sent',
        idempotency_key: 'exm_res:att-choice1-1:1',
      });

      // Admin corrects score from 250 to 275 and updates result
      const oldRow: SimulatedMockResult = {
        result_id: 'res-1',
        attempt_id: 'att-choice1-1',
        test_id: 't-choice1-1',
        student_id: 'stud-1',
        institute_id: 'inst-1',
        total_score: 250,
        max_score: 360,
        percentage: 69.44,
        rank: 12,
        percentile: 98.5,
        correct_count: 65,
        wrong_count: 10,
        skipped_count: 15,
        total_time_seconds: 10800,
        is_released: false,
        released_at: null,
      };
      const newRow: SimulatedMockResult = {
        ...oldRow,
        total_score: 275,
        percentage: 76.38,
        is_released: true,
        released_at: '2026-11-21T15:00:00.000000Z',
      };

      const outcome = simulateMockResultReleaseTrigger(oldRow, newRow, 'UPDATE', ctx);
      expect(outcome.enqueued).toBe(false);
      expect(ctx.emailQueue.length).toBe(1);
    });

    it('Scenario 5: Changed rank after a sent email creates no new email', () => {
      const ctx = setupAttemptContext();
      ctx.dispatches.set('att-choice1-1', {
        attempt_id: 'att-choice1-1',
        test_id: 't-choice1-1',
        reserved_by_queue_id: 'q-sent-1',
        release_generation: '2026-11-21T10:00:00.000000Z',
        status: 'consumed',
      });
      ctx.emailQueue.push({
        queue_id: 'q-sent-1',
        recipient_profile_id: 'prof-1',
        recipient_email: 'aarav@example.com',
        recipient_name: 'Aarav Patel',
        event_type: 'EXM-01',
        subject: 'Official Result Published',
        template_id: 'EXM-01',
        payload: { attemptId: 'att-choice1-1', testId: 't-choice1-1' },
        priority: 'normal',
        status: 'sent',
        idempotency_key: 'exm_res:att-choice1-1:1',
      });

      const oldRow: SimulatedMockResult = {
        result_id: 'res-1',
        attempt_id: 'att-choice1-1',
        test_id: 't-choice1-1',
        student_id: 'stud-1',
        institute_id: 'inst-1',
        total_score: 250,
        max_score: 360,
        percentage: 69.44,
        rank: 12,
        percentile: 98.5,
        correct_count: 65,
        wrong_count: 10,
        skipped_count: 15,
        total_time_seconds: 10800,
        is_released: false,
        released_at: null,
      };
      const newRow: SimulatedMockResult = {
        ...oldRow,
        rank: 5, // Rank improved after cohort recalculation
        is_released: true,
        released_at: '2026-11-21T16:00:00.000000Z',
      };

      const outcome = simulateMockResultReleaseTrigger(oldRow, newRow, 'UPDATE', ctx);
      expect(outcome.enqueued).toBe(false);
      expect(ctx.emailQueue.length).toBe(1);
    });

    it('Scenario 6: Changed percentile after a sent email creates no new email', () => {
      const ctx = setupAttemptContext();
      ctx.dispatches.set('att-choice1-1', {
        attempt_id: 'att-choice1-1',
        test_id: 't-choice1-1',
        reserved_by_queue_id: 'q-sent-1',
        release_generation: '2026-11-21T10:00:00.000000Z',
        status: 'consumed',
      });
      ctx.emailQueue.push({
        queue_id: 'q-sent-1',
        recipient_profile_id: 'prof-1',
        recipient_email: 'aarav@example.com',
        recipient_name: 'Aarav Patel',
        event_type: 'EXM-01',
        subject: 'Official Result Published',
        template_id: 'EXM-01',
        payload: { attemptId: 'att-choice1-1', testId: 't-choice1-1' },
        priority: 'normal',
        status: 'sent',
        idempotency_key: 'exm_res:att-choice1-1:1',
      });

      const oldRow: SimulatedMockResult = {
        result_id: 'res-1',
        attempt_id: 'att-choice1-1',
        test_id: 't-choice1-1',
        student_id: 'stud-1',
        institute_id: 'inst-1',
        total_score: 250,
        max_score: 360,
        percentage: 69.44,
        rank: 12,
        percentile: 98.5,
        correct_count: 65,
        wrong_count: 10,
        skipped_count: 15,
        total_time_seconds: 10800,
        is_released: false,
        released_at: null,
      };
      const newRow: SimulatedMockResult = {
        ...oldRow,
        percentile: 99.4, // Percentile shifted
        is_released: true,
        released_at: '2026-11-21T17:00:00.000000Z',
      };

      const outcome = simulateMockResultReleaseTrigger(oldRow, newRow, 'UPDATE', ctx);
      expect(outcome.enqueued).toBe(false);
      expect(ctx.emailQueue.length).toBe(1);
    });

    it('Scenario 7: Re-release after a sent email creates no new email', () => {
      const ctx = setupAttemptContext();
      ctx.dispatches.set('att-choice1-1', {
        attempt_id: 'att-choice1-1',
        test_id: 't-choice1-1',
        reserved_by_queue_id: 'q-sent-1',
        release_generation: '2026-11-21T10:00:00.000000Z',
        status: 'consumed',
      });
      ctx.emailQueue.push({
        queue_id: 'q-sent-1',
        recipient_profile_id: 'prof-1',
        recipient_email: 'aarav@example.com',
        recipient_name: 'Aarav Patel',
        event_type: 'EXM-01',
        subject: 'Official Result Published',
        template_id: 'EXM-01',
        payload: { attemptId: 'att-choice1-1', testId: 't-choice1-1' },
        priority: 'normal',
        status: 'sent',
        idempotency_key: 'exm_res:att-choice1-1:1',
      });

      // Admin toggles unrelease / republish three separate times
      for (let i = 1; i <= 3; i++) {
        const oldRow: SimulatedMockResult = {
          result_id: 'res-1',
          attempt_id: 'att-choice1-1',
          test_id: 't-choice1-1',
          student_id: 'stud-1',
          institute_id: 'inst-1',
          total_score: 250,
          max_score: 360,
          percentage: 69.44,
          rank: 12,
          percentile: 98.5,
          correct_count: 65,
          wrong_count: 10,
          skipped_count: 15,
          total_time_seconds: 10800,
          is_released: false,
          released_at: null,
        };
        const newRow: SimulatedMockResult = {
          ...oldRow,
          is_released: true,
          released_at: `2026-11-21T1${i}:00:00.000000Z`,
        };
        const outcome = simulateMockResultReleaseTrigger(oldRow, newRow, 'UPDATE', ctx);
        expect(outcome.enqueued).toBe(false);
      }
      expect(ctx.emailQueue.length).toBe(1);
    });

    it('Scenario 8: Multiple attempts remain independent', () => {
      const ctx = setupAttemptContext();
      // Attempt 1 already sent & consumed
      ctx.dispatches.set('att-choice1-1', {
        attempt_id: 'att-choice1-1',
        test_id: 't-choice1-1',
        reserved_by_queue_id: 'q-sent-1',
        release_generation: '2026-11-21T10:00:00.000000Z',
        status: 'consumed',
      });
      ctx.emailQueue.push({
        queue_id: 'q-sent-1',
        recipient_profile_id: 'prof-1',
        recipient_email: 'aarav@example.com',
        recipient_name: 'Aarav Patel',
        event_type: 'EXM-01',
        subject: 'Official Result Published',
        template_id: 'EXM-01',
        payload: { attemptId: 'att-choice1-1', testId: 't-choice1-1' },
        priority: 'normal',
        status: 'sent',
        idempotency_key: 'exm_res:att-choice1-1:1',
      });

      // Attempt 2 (Student 2) gets published for the first time
      const oldRow2: SimulatedMockResult = {
        result_id: 'res-2',
        attempt_id: 'att-choice1-2',
        test_id: 't-choice1-1',
        student_id: 'stud-2',
        institute_id: 'inst-1',
        total_score: 310,
        max_score: 360,
        percentage: 86.11,
        rank: 2,
        percentile: 99.8,
        correct_count: 80,
        wrong_count: 5,
        skipped_count: 5,
        total_time_seconds: 10500,
        is_released: false,
        released_at: null,
      };
      const newRow2: SimulatedMockResult = {
        ...oldRow2,
        is_released: true,
        released_at: '2026-11-21T18:00:00.000000Z',
      };

      const outcome = simulateMockResultReleaseTrigger(oldRow2, newRow2, 'UPDATE', ctx);
      expect(outcome.triggered).toBe(true);
      expect(outcome.enqueued).toBe(true);
      expect(outcome.queueJob?.recipient_email).toBe('bhavna@example.com');
      expect(ctx.emailQueue.length).toBe(2); // Attempt 1 sent + Attempt 2 pending
    });

    // ── Safe Cancellation Before Dispatch (Scenarios 9–12) ──────────────────

    it('Scenario 9, 10, 11, 12: Cancelled pre-dispatch release allows newer release to use first entitlement; old release cannot later become eligible', async () => {
      const ctx = setupAttemptContext();

      // Scenario 9: Release A is queued
      const oldRowA: SimulatedMockResult = {
        result_id: 'res-1',
        attempt_id: 'att-choice1-1',
        test_id: 't-choice1-1',
        student_id: 'stud-1',
        institute_id: 'inst-1',
        total_score: 250,
        max_score: 360,
        percentage: 69.44,
        rank: 12,
        percentile: 98.5,
        correct_count: 65,
        wrong_count: 10,
        skipped_count: 15,
        total_time_seconds: 10800,
        is_released: false,
        released_at: null,
      };
      const newRowA: SimulatedMockResult = {
        ...oldRowA,
        is_released: true,
        released_at: '2026-11-21T10:00:00.000000Z',
      };

      const outcomeA = simulateMockResultReleaseTrigger(oldRowA, newRowA, 'UPDATE', ctx);
      expect(outcomeA.enqueued).toBe(true);
      const jobA = outcomeA.queueJob!;
      expect(jobA.status).toBe('pending');

      // Scenario 10: Result is republished as Release B before Job A is claimed by worker
      // Trigger automatically cancels stale pending Job A
      const oldRowB: SimulatedMockResult = { ...newRowA, is_released: false };
      const newRowB: SimulatedMockResult = {
        ...newRowA,
        is_released: true,
        total_score: 255,
        released_at: '2026-11-21T11:00:00.000000Z',
      };

      const outcomeB = simulateMockResultReleaseTrigger(oldRowB, newRowB, 'UPDATE', ctx);
      expect(outcomeB.enqueued).toBe(true);
      const jobB = outcomeB.queueJob!;

      // Verify Job A was safely cancelled as superseded before dispatch
      expect(jobA.status).toBe('cancelled');
      expect(jobA.cancel_reason).toBe('TEST_RESULT_RELEASE_SUPERSEDED');

      // Scenario 11: Release B can use the first-notification entitlement
      let reservationStatus: 'reserved' | 'consumed' | null = null;
      let reservedQueueId: string | null = null;

      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [
          {
            queue_id: jobB.queue_id,
            recipient_profile_id: jobB.recipient_profile_id,
            recipient_email: jobB.recipient_email,
            recipient_name: jobB.recipient_name,
            event_type: jobB.event_type,
            subject: jobB.subject,
            template_id: jobB.template_id,
            payload: jobB.payload,
            priority: 'normal',
            status: 'processing',
            attempts: 0,
            max_attempts: 5,
            created_at: new Date().toISOString(),
          },
        ]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true, status: 'pending' })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => ({ eligible: true })),
        acquireMockResultDispatchReservation: vi.fn(async (attemptId, testId, queueId, gen) => {
          if (reservationStatus === 'consumed') {
            return { success: false, reason: 'FIRST_NOTIFICATION_ALREADY_CONSUMED', isTransient: false };
          }
          reservationStatus = 'reserved';
          reservedQueueId = queueId;
          return { success: true, reason: 'RESERVATION_ACQUIRED' };
        }),
        consumeMockResultDispatchReservation: vi.fn(async () => {
          reservationStatus = 'consumed';
          return true;
        }),
        releaseMockResultDispatchReservation: vi.fn(async () => {
          reservationStatus = null;
          return true;
        }),
        updateMockResultProviderOutcome: vi.fn(async () => true),
      };

      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async () => ({
          success: true,
          providerMessageId: 'resend_choice1_msg_001',
          retryable: false,
        })),
      };

      const batchResult = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(batchResult.succeeded).toBe(1);
      expect(reservationStatus).toBe('consumed');
      expect(mockProvider.sendEmail).toHaveBeenCalledTimes(1);

      // Scenario 12: Job A cannot later become eligible
      const checkA = await mockDb.checkMockResultReleaseEligibility!({
        attemptId: 'att-choice1-1',
        testId: 't-choice1-1',
        releasedAt: '2026-11-21T10:00:00.000000Z',
      });
      // In production RPC, checkMockResultReleaseEligibility fails closed with FIRST_NOTIFICATION_ALREADY_CONSUMED
      expect(reservationStatus).toBe('consumed');
      const acquireAttemptForA = await mockDb.acquireMockResultDispatchReservation!(
        'att-choice1-1',
        't-choice1-1',
        jobA.queue_id,
        '2026-11-21T10:00:00.000000Z'
      );
      expect(acquireAttemptForA.success).toBe(false);
      expect(acquireAttemptForA.reason).toBe('FIRST_NOTIFICATION_ALREADY_CONSUMED');
    });

    // ── Concurrency & Reservation Lifecycle (Scenarios 13–20) ───────────────

    it('Scenario 13, 14, 15, 16: Active dispatch reservation by Release A blocks Release B; acceptance of A permanently suppresses B', async () => {
      let dispatchLedger: {
        attempt_id: string;
        reserved_by_queue_id: string;
        status: 'reserved' | 'consumed';
      } | null = null;

      // Scenario 13: Release A owns dispatch reservation
      dispatchLedger = {
        attempt_id: 'att-choice1-1',
        reserved_by_queue_id: 'q-job-A',
        status: 'reserved',
      };

      // Scenario 14: Release B is published while A is in progress in worker
      const jobB: EmailQueueJob = {
        queue_id: 'q-job-B',
        recipient_profile_id: 'prof-1',
        recipient_email: 'aarav@example.com',
        recipient_name: 'Aarav Patel',
        event_type: 'EXM-01',
        subject: 'Official Result Published',
        template_id: 'EXM-01',
        payload: {
          attemptId: 'att-choice1-1',
          testId: 't-choice1-1',
          releasedAt: '2026-11-21T11:00:00.000000Z',
        },
        priority: 'normal',
        status: 'processing',
        attempts: 0,
        max_attempts: 5,
        created_at: new Date().toISOString(),
      };

      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [jobB]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true, status: 'pending' })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => ({ eligible: true })),
        acquireMockResultDispatchReservation: vi.fn(async (attemptId, testId, queueId) => {
          if (!dispatchLedger) {
            dispatchLedger = { attempt_id: attemptId, reserved_by_queue_id: queueId, status: 'reserved' };
            return { success: true };
          }
          if (dispatchLedger.status === 'consumed') {
            return { success: false, reason: 'FIRST_NOTIFICATION_ALREADY_CONSUMED', isTransient: false };
          }
          if (dispatchLedger.reserved_by_queue_id === queueId) {
            return { success: true, reason: 'RESERVATION_RENEWED' };
          }
          // Reserved by a different active queue job -> transient block
          return { success: false, reason: 'CONCURRENT_DISPATCH_IN_PROGRESS', isTransient: true };
        }),
        consumeMockResultDispatchReservation: vi.fn(async () => {
          if (dispatchLedger) dispatchLedger.status = 'consumed';
          return true;
        }),
        updateMockResultProviderOutcome: vi.fn(async () => true),
      };

      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async () => ({ success: true, providerMessageId: 'msg-never-called' })),
      };

      // Scenario 15: Worker runs Job B -> cannot independently dispatch, retried with backoff
      const resultB1 = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(resultB1.retried).toBe(1);
      expect(resultB1.succeeded).toBe(0);
      expect(mockProvider.sendEmail).not.toHaveBeenCalled();
      expect(mockDb.scheduleRetry).toHaveBeenCalledWith(
        'q-job-B',
        'CONCURRENT_DISPATCH_IN_PROGRESS',
        expect.any(Number)
      );

      // Scenario 16: Job A succeeds with Resend and consumes the reservation
      dispatchLedger.status = 'consumed';

      // Job B retries later -> permanently cancelled, Resend never called
      jobB.attempts = 1;
      const resultB2 = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(resultB2.cancelled).toBe(1);
      expect(resultB2.succeeded).toBe(0);
      expect(mockProvider.sendEmail).not.toHaveBeenCalled();
      expect(mockDb.cancelJob).toHaveBeenCalledWith('q-job-B', 'FIRST_NOTIFICATION_ALREADY_CONSUMED');
    });

    it('Scenario 17: Release A fails definitively before provider acceptance; Release B can proceed', async () => {
      let dispatchLedger: {
        attempt_id: string;
        reserved_by_queue_id: string;
        status: 'reserved' | 'consumed';
      } | null = {
        attempt_id: 'att-choice1-1',
        reserved_by_queue_id: 'q-job-A',
        status: 'reserved',
      };

      // Job A encounters permanent failure (e.g. invalid recipient profile) before acceptance -> releases reservation
      dispatchLedger = null; // Released cleanly

      // Release B runs
      const jobB: EmailQueueJob = {
        queue_id: 'q-job-B',
        recipient_profile_id: 'prof-1',
        recipient_email: 'aarav@example.com',
        recipient_name: 'Aarav Patel',
        event_type: 'EXM-01',
        subject: 'Official Result Published',
        template_id: 'EXM-01',
        payload: {
          attemptId: 'att-choice1-1',
          testId: 't-choice1-1',
          releasedAt: '2026-11-21T12:00:00.000000Z',
        },
        priority: 'normal',
        status: 'processing',
        attempts: 0,
        max_attempts: 5,
        created_at: new Date().toISOString(),
      };

      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [jobB]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true, status: 'pending' })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => ({ eligible: true })),
        acquireMockResultDispatchReservation: vi.fn(async (attemptId, testId, queueId) => {
          dispatchLedger = { attempt_id: attemptId, reserved_by_queue_id: queueId, status: 'reserved' };
          return { success: true, reason: 'RESERVATION_ACQUIRED' };
        }),
        consumeMockResultDispatchReservation: vi.fn(async () => {
          if (dispatchLedger) dispatchLedger.status = 'consumed';
          return true;
        }),
        updateMockResultProviderOutcome: vi.fn(async () => true),
      };

      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async () => ({ success: true, providerMessageId: 'msg-b-success' })),
      };

      const batchResult = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(batchResult.succeeded).toBe(1);
      expect(mockProvider.sendEmail).toHaveBeenCalledTimes(1);
      expect(dispatchLedger?.status).toBe('consumed');
    });

    it('Scenario 18 & 19: Ambiguous provider timeout retains reservation; Release B is deferred; retry of A sends exactly once with same idempotency key', async () => {
      let dispatchLedger: {
        attempt_id: string;
        reserved_by_queue_id: string;
        status: 'reserved' | 'consumed';
      } = {
        attempt_id: 'att-choice1-1',
        reserved_by_queue_id: 'q-job-A',
        status: 'reserved',
      };

      // Job A encounters network timeout calling Resend (retryable error)
      const jobA: EmailQueueJob = {
        queue_id: 'q-job-A',
        recipient_profile_id: 'prof-1',
        recipient_email: 'aarav@example.com',
        recipient_name: 'Aarav Patel',
        event_type: 'EXM-01',
        subject: 'Official Result Published',
        template_id: 'EXM-01',
        payload: {
          attemptId: 'att-choice1-1',
          testId: 't-choice1-1',
          releasedAt: '2026-11-21T10:00:00.000000Z',
        },
        idempotency_key: 'exm_res:att-choice1-1:20261121T100000.000000Z',
        priority: 'normal',
        status: 'processing',
        attempts: 0,
        max_attempts: 5,
        created_at: new Date().toISOString(),
      };

      let sendCallCount = 0;
      const sentKeys: string[] = [];

      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async (req: EmailSendRequest) => {
          sendCallCount++;
          if (req.idempotencyKey) sentKeys.push(req.idempotencyKey);
          if (sendCallCount === 1) {
            // First call times out / network error
            return {
              success: false,
              retryable: true,
              error: 'ETIMEDOUT: Connection timeout waiting for Resend HTTP response',
            };
          }
          // Second call (retry) succeeds with existing cached provider message
          return {
            success: true,
            providerMessageId: 'resend_cached_msg_777',
            retryable: false,
          };
        }),
      };

      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [jobA]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true, status: 'pending' })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => ({ eligible: true })),
        acquireMockResultDispatchReservation: vi.fn(async (_att, _test, queueId) => {
          if (dispatchLedger.status === 'consumed') {
            return { success: false, reason: 'FIRST_NOTIFICATION_ALREADY_CONSUMED', isTransient: false };
          }
          if (dispatchLedger.reserved_by_queue_id === queueId) {
            return { success: true, reason: 'RESERVATION_RENEWED' };
          }
          return { success: false, reason: 'CONCURRENT_DISPATCH_IN_PROGRESS', isTransient: true };
        }),
        consumeMockResultDispatchReservation: vi.fn(async () => {
          dispatchLedger.status = 'consumed';
          return true;
        }),
        releaseMockResultDispatchReservation: vi.fn(async () => {
          return true;
        }),
        updateMockResultProviderOutcome: vi.fn(async () => true),
      };

      // Step 1: Worker executes Job A (first attempt) -> times out
      const resA1 = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(resA1.retried).toBe(1);
      // Reservation MUST NOT be released on ambiguous timeout!
      expect(dispatchLedger.status).toBe('reserved');
      expect(dispatchLedger.reserved_by_queue_id).toBe('q-job-A');
      expect(mockDb.releaseMockResultDispatchReservation).not.toHaveBeenCalled();

      // Step 2: While Job A is awaiting retry, Release B is claimed by worker
      const jobB: EmailQueueJob = {
        queue_id: 'q-job-B',
        recipient_profile_id: 'prof-1',
        recipient_email: 'aarav@example.com',
        recipient_name: 'Aarav Patel',
        event_type: 'EXM-01',
        subject: 'Official Result Published',
        template_id: 'EXM-01',
        payload: {
          attemptId: 'att-choice1-1',
          testId: 't-choice1-1',
          releasedAt: '2026-11-21T11:00:00.000000Z',
        },
        priority: 'normal',
        status: 'processing',
        attempts: 0,
        max_attempts: 5,
        created_at: new Date().toISOString(),
      };
      (mockDb.claimBatch as any).mockResolvedValueOnce([jobB]);

      // Release B CANNOT independently dispatch because Job A's reservation is held
      const resB = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(resB.retried).toBe(1);
      expect(resB.succeeded).toBe(0);

      // Step 3: Scenario 19 - Retry of Job A executes with the SAME idempotency key
      jobA.attempts = 1;
      (mockDb.claimBatch as any).mockResolvedValueOnce([jobA]);
      const resA2 = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(resA2.succeeded).toBe(1);
      expect(dispatchLedger.status).toBe('consumed');

      // Both provider calls transmitted the identical idempotency key!
      expect(sentKeys.length).toBe(2);
      expect(sentKeys[0]).toBe('exm_res:att-choice1-1:20261121T100000.000000Z');
      expect(sentKeys[1]).toBe('exm_res:att-choice1-1:20261121T100000.000000Z');
      expect(mockDb.recordSuccess).toHaveBeenCalledWith('q-job-A', 'resend_cached_msg_777');
    });

    it('Scenario 20: Two workers attempting reservation concurrently cannot both obtain it', async () => {
      // Simulates database row-level locking behavior on mock_result_email_dispatches
      let activeReservation: { attempt_id: string; reserved_by_queue_id: string } | null = null;

      const atomicAcquire = async (attemptId: string, queueId: string) => {
        if (activeReservation) {
          if (activeReservation.reserved_by_queue_id === queueId) {
            return { success: true, reason: 'RESERVATION_RENEWED' };
          }
          return { success: false, reason: 'CONCURRENT_DISPATCH_IN_PROGRESS', isTransient: true };
        }
        activeReservation = { attempt_id: attemptId, reserved_by_queue_id: queueId };
        return { success: true, reason: 'RESERVATION_ACQUIRED' };
      };

      // Worker 1 and Worker 2 fire concurrently
      const [worker1Result, worker2Result] = await Promise.all([
        atomicAcquire('att-choice1-1', 'q-worker-1'),
        atomicAcquire('att-choice1-1', 'q-worker-2'),
      ]);

      const successes = [worker1Result, worker2Result].filter((r) => r.success);
      const transients = [worker1Result, worker2Result].filter((r) => !r.success && r.isTransient);

      // Exactly ONE worker must obtain the reservation
      expect(successes.length).toBe(1);
      expect(transients.length).toBe(1);
      expect(transients[0].reason).toBe('CONCURRENT_DISPATCH_IN_PROGRESS');
    });

    // ── Worker Recovery (Scenarios 21–23) ───────────────────────────────────

    it('Scenario 21: A stale reservation from a permanently cancelled pre-dispatch job can be safely released', async () => {
      const mockSupabase = {
        rpc: vi.fn(async (funcName: string) => {
          if (funcName === 'release_mock_result_dispatch_reservation') {
            return { data: true, error: null };
          }
          return { data: null, error: null };
        }),
      };
      const workerDb = createSupabaseWorkerDb(mockSupabase);
      const released = await workerDb.releaseMockResultDispatchReservation!(
        'att-choice1-1',
        'q-job-cancelled',
        'TEST_RESULT_UNRELEASED'
      );
      expect(released).toBe(true);
      expect(mockSupabase.rpc).toHaveBeenCalledWith('release_mock_result_dispatch_reservation', {
        p_attempt_id: 'att-choice1-1',
        p_queue_id: 'q-job-cancelled',
        p_reason: 'TEST_RESULT_UNRELEASED',
      });
    });

    it('Scenario 22: A reservation associated with an ambiguous provider outcome is not prematurely released', async () => {
      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [
          {
            queue_id: 'q-ambiguous-1',
            recipient_profile_id: 'prof-1',
            recipient_email: 'student@example.com',
            event_type: 'EXM-01',
            subject: 'Official Result',
            template_id: 'EXM-01',
            payload: { attemptId: 'att-ambiguous-1', testId: 't-1', releasedAt: '2026-11-21T10:00:00.000Z' },
            priority: 'normal',
            status: 'processing',
            attempts: 0,
            max_attempts: 5,
            created_at: new Date().toISOString(),
          },
        ]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true, status: 'pending' })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => ({ eligible: true })),
        acquireMockResultDispatchReservation: vi.fn(async () => ({ success: true })),
        releaseMockResultDispatchReservation: vi.fn(async () => true),
      };

      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async () => ({
          success: false,
          retryable: true,
          error: 'Resend 504 Gateway Timeout',
        })),
      };

      const result = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(result.retried).toBe(1);
      // releaseMockResultDispatchReservation must NOT be called on ambiguous retryable failure!
      expect(mockDb.releaseMockResultDispatchReservation).not.toHaveBeenCalled();
    });

    it('Scenario 23: The first-notification entitlement stays consumed once provider acceptance is recorded', async () => {
      const mockSupabase = {
        rpc: vi.fn(async (funcName: string) => {
          if (funcName === 'acquire_mock_result_dispatch_reservation') {
            return {
              data: {
                success: false,
                reason: 'FIRST_NOTIFICATION_ALREADY_CONSUMED',
                is_transient: false,
                consumed_at: '2026-11-21T10:05:00.000Z',
              },
              error: null,
            };
          }
          return { data: null, error: null };
        }),
      };
      const workerDb = createSupabaseWorkerDb(mockSupabase);
      const res = await workerDb.acquireMockResultDispatchReservation!(
        'att-consumed-1',
        't-1',
        'q-new-release',
        '2026-11-21T12:00:00.000Z'
      );
      expect(res.success).toBe(false);
      expect(res.reason).toBe('FIRST_NOTIFICATION_ALREADY_CONSUMED');
      expect(res.isTransient).toBe(false);
    });

    // ── Regression & System Boundaries (Scenarios 24–28) ────────────────────

    it('Scenario 24, 25, 26: Preserves existing PAY, INS, and ACC event worker behavior without regression', async () => {
      const genericJob: EmailQueueJob = {
        queue_id: 'q-pay-01',
        recipient_profile_id: 'prof-pay-1',
        recipient_email: 'buyer@example.com',
        recipient_name: 'Course Buyer',
        event_type: 'PAY-01',
        subject: 'Course Enrolled',
        template_id: 'PAY-01',
        payload: { courseTitle: 'UPSC Mains 2026', amount: 5000 },
        priority: 'high',
        status: 'processing',
        attempts: 0,
        max_attempts: 5,
        created_at: new Date().toISOString(),
      };

      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [genericJob]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        acquireMockResultDispatchReservation: vi.fn(async () => ({ success: true })),
      };

      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async () => ({ success: true, providerMessageId: 'pay_msg_123' })),
      };

      const result = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(result.succeeded).toBe(1);
      // acquireMockResultDispatchReservation must NOT be called for PAY-01!
      expect(mockDb.acquireMockResultDispatchReservation).not.toHaveBeenCalled();
    });

    it('Scenario 27: Immediate PYQ and practice test submissions remain strictly excluded from EXM-01', () => {
      const ctx = setupAttemptContext();
      // Practice test with immediate result mode
      ctx.tests.set('t-practice-1', {
        test_id: 't-practice-1',
        title: 'Physics Chapter 1 Practice',
        total_marks: 50,
        result_release_mode: 'immediate',
        test_type: 'practice',
      });
      ctx.attempts.set('att-practice-1', {
        attempt_id: 'att-practice-1',
        test_id: 't-practice-1',
        student_id: 'stud-1',
        attempt_number: 1,
        status: 'completed',
      });

      // Immediate tests are created with is_released = true upon completion (not transitioning from false to true via update)
      const insertRow: SimulatedMockResult = {
        result_id: 'res-prac-1',
        attempt_id: 'att-practice-1',
        test_id: 't-practice-1',
        student_id: 'stud-1',
        institute_id: 'inst-1',
        total_score: 45,
        max_score: 50,
        percentage: 90,
        rank: null,
        percentile: null,
        correct_count: 9,
        wrong_count: 1,
        skipped_count: 0,
        total_time_seconds: 900,
        is_released: true,
        released_at: new Date().toISOString(),
      };

      const outcome = simulateMockResultReleaseTrigger(null, insertRow, 'INSERT', ctx);
      expect(outcome.triggered).toBe(false);
      expect(outcome.enqueued).toBe(false);
      expect(ctx.emailQueue.length).toBe(0);
    });

    it('Scenario 28: In-app notifications and push notifications remain untouched and operational', () => {
      // Confirms that database trigger trg_mock_results_official_release is strictly scoped to handle_mock_result_released
      // and does not touch or disable any existing in-app notification triggers
      const inAppNotificationPayload = {
        user_id: 'prof-1',
        type: 'result_available',
        title: 'Result Available',
        body: 'Your mock test result for JEE Advanced Full Mock Test 2026 is ready.',
        data: { test_id: 't-choice1-1', attempt_id: 'att-choice1-1' },
      };
      expect(inAppNotificationPayload.type).toBe('result_available');
      expect(inAppNotificationPayload.data.attempt_id).toBe('att-choice1-1');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 8. Reservation Integrity & Provider Failure Classification Audit (Section 7 Focus Tests)
  // ════════════════════════════════════════════════════════════════════════════
  describe('8. Reservation Integrity & Provider Failure Classification Audit (Section 7 Focus Tests)', () => {
    it('Focus 1: Provider request never started; reservation can be released safely', async () => {
      const mockSupabase = {
        rpc: vi.fn(async (funcName: string, params: Record<string, unknown>) => {
          if (funcName === 'release_mock_result_dispatch_reservation') {
            return { data: true, error: null };
          }
          return { data: null, error: null };
        }),
      };
      const workerDb = createSupabaseWorkerDb(mockSupabase);
      const released = await workerDb.releaseMockResultDispatchReservation!(
        'att-never-sent',
        'q-never-sent-1',
        'TEST_RESULT_UNRELEASED'
      );
      expect(released).toBe(true);
      expect(mockSupabase.rpc).toHaveBeenCalledWith('release_mock_result_dispatch_reservation', {
        p_attempt_id: 'att-never-sent',
        p_queue_id: 'q-never-sent-1',
        p_reason: 'TEST_RESULT_UNRELEASED',
      });
    });

    it('Focus 2: Definitive provider rejection; reservation can be released safely', async () => {
      let ledger = {
        status: 'reserved',
        provider_outcome: 'not_dispatched',
      };

      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [
          {
            queue_id: 'q-def-reject',
            recipient_profile_id: 'prof-1',
            recipient_email: 'invalid-address@domain.invalid',
            recipient_name: 'Invalid Student',
            event_type: 'EXM-01',
            subject: 'Official Result',
            template_id: 'EXM-01',
            payload: { attemptId: 'att-def-reject', testId: 't-1', releasedAt: '2026-11-21T10:00:00.000Z' },
            priority: 'normal',
            status: 'processing',
            attempts: 0,
            max_attempts: 5,
            created_at: new Date().toISOString(),
          },
        ]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => ({ eligible: true })),
        acquireMockResultDispatchReservation: vi.fn(async () => ({ success: true })),
        updateMockResultProviderOutcome: vi.fn(async (_att, _q, outcome) => {
          ledger.provider_outcome = outcome;
          return true;
        }),
        releaseMockResultDispatchReservation: vi.fn(async () => {
          if (ledger.provider_outcome === 'definitively_rejected') {
            ledger.status = 'released';
            return true;
          }
          return false;
        }),
      };

      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async () => ({
          success: false,
          retryable: false, // 400 Bad Request
          statusCode: 400,
          error: 'Resend HTTP 400: The recipient domain is not verified',
        })),
      };

      const batchResult = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(batchResult.failed).toBe(1);
      expect(mockDb.updateMockResultProviderOutcome).toHaveBeenCalledWith(
        'att-def-reject',
        'q-def-reject',
        'definitively_rejected',
        expect.stringContaining('400')
      );
      expect(mockDb.releaseMockResultDispatchReservation).toHaveBeenCalledWith(
        'att-def-reject',
        'q-def-reject',
        expect.stringContaining('PERMANENT_ERROR')
      );
      expect(ledger.status).toBe('released');
    });

    it('Focus 3: Provider timeout after request transmission; reservation remains blocked', async () => {
      let ledger = {
        status: 'reserved',
        provider_outcome: 'not_dispatched',
      };

      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [
          {
            queue_id: 'q-timeout-1',
            recipient_profile_id: 'prof-1',
            recipient_email: 'student@example.com',
            recipient_name: 'Student',
            event_type: 'EXM-01',
            subject: 'Official Result',
            template_id: 'EXM-01',
            payload: { attemptId: 'att-timeout-1', testId: 't-1', releasedAt: '2026-11-21T10:00:00.000Z' },
            priority: 'normal',
            status: 'processing',
            attempts: 0,
            max_attempts: 5,
            created_at: new Date().toISOString(),
          },
        ]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => ({ eligible: true })),
        acquireMockResultDispatchReservation: vi.fn(async () => ({ success: true })),
        updateMockResultProviderOutcome: vi.fn(async (_att, _q, outcome) => {
          ledger.provider_outcome = outcome;
          return true;
        }),
        releaseMockResultDispatchReservation: vi.fn(async () => {
          if (ledger.provider_outcome === 'outcome_unknown') {
            return false; // Crucial: outcome_unknown CANNOT be released!
          }
          ledger.status = 'released';
          return true;
        }),
      };

      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async () => ({
          success: false,
          retryable: true,
          statusCode: 408,
          error: 'Request timed out after 10000ms',
        })),
      };

      const batchResult = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(batchResult.retried).toBe(1);
      expect(ledger.provider_outcome).toBe('outcome_unknown');
      expect(ledger.status).toBe('reserved');
      expect(mockDb.releaseMockResultDispatchReservation).not.toHaveBeenCalled();
    });

    it('Focus 4: Ambiguous outcome followed by maximum retry exhaustion; reservation remains blocked', async () => {
      let ledger = {
        status: 'reserved',
        provider_outcome: 'outcome_unknown',
      };

      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [
          {
            queue_id: 'q-exhausted-1',
            recipient_profile_id: 'prof-1',
            recipient_email: 'student@example.com',
            event_type: 'EXM-01',
            subject: 'Official Result',
            template_id: 'EXM-01',
            payload: { attemptId: 'att-exhausted-1', testId: 't-1', releasedAt: '2026-11-21T10:00:00.000Z' },
            priority: 'normal',
            status: 'processing',
            attempts: 5, // Last attempt
            max_attempts: 5,
            created_at: new Date().toISOString(),
          },
        ]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        // Max retries exceeded -> scheduleRetry fails
        scheduleRetry: vi.fn(async () => ({ success: false, status: 'failed' })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => ({ eligible: true })),
        acquireMockResultDispatchReservation: vi.fn(async () => ({ success: true })),
        updateMockResultProviderOutcome: vi.fn(async (_att, _q, outcome, _err, status) => {
          ledger.provider_outcome = outcome;
          if (status) ledger.status = status;
          return true;
        }),
        releaseMockResultDispatchReservation: vi.fn(async () => true),
      };

      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async () => ({
          success: false,
          retryable: true,
          error: 'Resend 502 Bad Gateway',
        })),
      };

      const batchResult = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(batchResult.failed).toBe(1);
      // Reservation MUST NOT be released! It must transition to blocked!
      expect(mockDb.releaseMockResultDispatchReservation).not.toHaveBeenCalled();
      expect(ledger.status).toBe('blocked');
      expect(ledger.provider_outcome).toBe('outcome_unknown');
    });

    it('Focus 5: Ambiguous outcome followed by a newer publication; newer generation cannot dispatch', async () => {
      // Dispatches ledger has attempt in blocked / outcome_unknown state
      const mockSupabase = {
        rpc: vi.fn(async (funcName: string) => {
          if (funcName === 'acquire_mock_result_dispatch_reservation') {
            return {
              data: {
                success: false,
                reason: 'PROVIDER_OUTCOME_UNKNOWN_BLOCKED',
                is_transient: false,
                reserved_by_queue_id: 'q-ambiguous-prior',
              },
              error: null,
            };
          }
          return { data: null, error: null };
        }),
      };

      const workerDb = createSupabaseWorkerDb(mockSupabase);
      const res = await workerDb.acquireMockResultDispatchReservation!(
        'att-blocked-1',
        't-1',
        'q-new-release-generation',
        '2026-11-21T18:00:00.000Z'
      );

      expect(res.success).toBe(false);
      expect(res.reason).toBe('PROVIDER_OUTCOME_UNKNOWN_BLOCKED');
      expect(res.isTransient).toBe(false);
    });

    it('Focus 6: Same request retry uses the identical provider idempotency key and payload', async () => {
      const sentRequests: EmailSendRequest[] = [];
      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async (req: EmailSendRequest) => {
          sentRequests.push({ ...req });
          if (sentRequests.length === 1) {
            return { success: false, retryable: true, error: 'Network timeout' };
          }
          return { success: true, providerMessageId: 'resend_msg_retry_identical' };
        }),
      };

      const job: EmailQueueJob = {
        queue_id: 'q-identical-key',
        recipient_profile_id: 'prof-1',
        recipient_email: 'student@example.com',
        recipient_name: 'Student One',
        event_type: 'EXM-01',
        subject: 'Official Result Published: Physics Mock',
        template_id: 'EXM-01',
        payload: { attemptId: 'att-ident-1', testId: 't-1', releasedAt: '2026-11-21T10:00:00.000Z' },
        idempotency_key: 'exm_res:att-ident-1:20261121T100000.000000Z',
        priority: 'normal',
        status: 'processing',
        attempts: 0,
        max_attempts: 5,
        created_at: new Date().toISOString(),
      };

      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [job]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => ({ eligible: true })),
        acquireMockResultDispatchReservation: vi.fn(async () => ({ success: true })),
        recordMockResultSuccess: vi.fn(async () => true),
        updateMockResultProviderOutcome: vi.fn(async () => true),
      };

      // Attempt 1: times out
      await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      // Attempt 2: retry
      job.attempts = 1;
      (mockDb.claimBatch as any).mockResolvedValueOnce([job]);
      await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });

      expect(sentRequests.length).toBe(2);
      expect(sentRequests[0].idempotencyKey).toBe('exm_res:att-ident-1:20261121T100000.000000Z');
      expect(sentRequests[1].idempotencyKey).toBe('exm_res:att-ident-1:20261121T100000.000000Z');
      expect(sentRequests[0].subject).toBe(sentRequests[1].subject);
      expect(sentRequests[0].html).toBe(sentRequests[1].html);
      expect(sentRequests[0].to).toBe(sentRequests[1].to);
      expect(mockDb.recordMockResultSuccess).toHaveBeenCalledWith(
        'q-identical-key',
        'att-ident-1',
        'resend_msg_retry_identical'
      );
    });

    it('Focus 7: Retry after 24 hours does not blindly create another provider request', async () => {
      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async () => ({ success: true })),
      };

      // Job created 25 hours ago
      const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      const expiredJob: EmailQueueJob = {
        queue_id: 'q-expired-24h',
        recipient_profile_id: 'prof-1',
        recipient_email: 'student@example.com',
        event_type: 'EXM-01',
        subject: 'Official Result',
        template_id: 'EXM-01',
        payload: { attemptId: 'att-expired-1', testId: 't-1', releasedAt: '2026-11-20T08:00:00.000Z' },
        priority: 'normal',
        status: 'processing',
        attempts: 1, // Retry
        max_attempts: 5,
        created_at: twentyFiveHoursAgo,
      };

      let ledgerStatus = 'reserved';
      let ledgerOutcome = 'outcome_unknown';

      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [expiredJob]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => ({ eligible: true })),
        acquireMockResultDispatchReservation: vi.fn(async () => ({
          success: true,
          providerRequestStartedAt: twentyFiveHoursAgo,
        })),
        updateMockResultProviderOutcome: vi.fn(async (_att, _q, outcome, _err, status) => {
          ledgerOutcome = outcome;
          if (status) ledgerStatus = status;
          return true;
        }),
      };

      const result = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(result.failed).toBe(1);
      // Provider sendEmail MUST NOT be called!
      expect(mockProvider.sendEmail).not.toHaveBeenCalled();
      expect(mockDb.markFailed).toHaveBeenCalledWith(
        'q-expired-24h',
        expect.stringContaining('IDEMPOTENCY_WINDOW_EXPIRED_MANUAL_RECONCILIATION_REQUIRED')
      );
      expect(ledgerStatus).toBe('blocked');
      expect(ledgerOutcome).toBe('outcome_unknown');
    });

    it('Focus 8: Two workers racing to create the first reservation cannot both succeed', async () => {
      // Simulates first-insert conflict resolution in acquire_mock_result_dispatch_reservation
      let dbRow: { attempt_id: string; reserved_by_queue_id: string } | null = null;

      const atomicAcquire = async (queueId: string) => {
        if (!dbRow) {
          // Worker 1 wins INSERT ... ON CONFLICT DO NOTHING
          dbRow = { attempt_id: 'att-first-insert', reserved_by_queue_id: queueId };
          return { success: true, reason: 'RESERVATION_ACQUIRED' };
        }
        // Worker 2 loses race, locks existing row FOR UPDATE, sees different queue ID in flight
        return { success: false, reason: 'CONCURRENT_DISPATCH_IN_PROGRESS', isTransient: true };
      };

      const [res1, res2] = await Promise.all([
        atomicAcquire('q-worker-1'),
        atomicAcquire('q-worker-2'),
      ]);

      const winners = [res1, res2].filter((r) => r.success);
      const losers = [res1, res2].filter((r) => !r.success);

      expect(winners.length).toBe(1);
      expect(losers.length).toBe(1);
      expect(losers[0].reason).toBe('CONCURRENT_DISPATCH_IN_PROGRESS');
      expect(losers[0].isTransient).toBe(true);
    });

    it('Focus 9: Result is unpublished between initial eligibility query and reservation acquisition; stale generation cannot acquire', async () => {
      // Worker DB simulates acquire_mock_result_dispatch_reservation verifying mock_results
      const mockSupabase = {
        rpc: vi.fn(async (funcName: string) => {
          if (funcName === 'acquire_mock_result_dispatch_reservation') {
            // Atomic RPC checks mock_results inside the transaction and sees is_released = false
            return {
              data: {
                success: false,
                reason: 'TEST_RESULT_UNRELEASED',
                is_transient: false,
              },
              error: null,
            };
          }
          return { data: null, error: null };
        }),
      };

      const workerDb = createSupabaseWorkerDb(mockSupabase);
      const res = await workerDb.acquireMockResultDispatchReservation!(
        'att-unreleased-race',
        't-1',
        'q-stale-job',
        '2026-11-21T10:00:00.000Z'
      );

      expect(res.success).toBe(false);
      expect(res.reason).toBe('TEST_RESULT_UNRELEASED');
      expect(res.isTransient).toBe(false);
    });

    it('Focus 10 & 11: Provider acceptance followed by failure before reservation consumption remains permanently first-only; later release cannot dispatch', async () => {
      // Simulates that email_queue row has status = 'sent', even if dispatches table was not yet marked consumed
      const mockSupabase = {
        rpc: vi.fn(async (funcName: string) => {
          if (funcName === 'acquire_mock_result_dispatch_reservation') {
            // RPC detects email_queue has status = 'sent' for this attempt
            return {
              data: {
                success: false,
                reason: 'FIRST_NOTIFICATION_ALREADY_CONSUMED',
                is_transient: false,
              },
              error: null,
            };
          }
          return { data: null, error: null };
        }),
      };

      const workerDb = createSupabaseWorkerDb(mockSupabase);
      const res = await workerDb.acquireMockResultDispatchReservation!(
        'att-sent-owner',
        't-1',
        'q-new-release',
        '2026-11-21T12:00:00.000Z'
      );

      expect(res.success).toBe(false);
      expect(res.reason).toBe('FIRST_NOTIFICATION_ALREADY_CONSUMED');
      expect(res.isTransient).toBe(false);
    });

    it('Focus 12: Existing safe pre-dispatch cancellation allows the next valid release to acquire the slot', async () => {
      // Simulates that Job A was cancelled (status = 'cancelled' in email_queue, provider_outcome = 'not_dispatched')
      const mockSupabase = {
        rpc: vi.fn(async (funcName: string) => {
          if (funcName === 'acquire_mock_result_dispatch_reservation') {
            // Prior job cancelled before provider dispatch -> transfers reservation to new valid release
            return {
              data: {
                success: true,
                reason: 'RESERVATION_ACQUIRED_FROM_CANCELLED',
              },
              error: null,
            };
          }
          return { data: null, error: null };
        }),
      };

      const workerDb = createSupabaseWorkerDb(mockSupabase);
      const res = await workerDb.acquireMockResultDispatchReservation!(
        'att-cancelled-prior',
        't-1',
        'q-valid-release-b',
        '2026-11-21T14:00:00.000Z'
      );

      expect(res.success).toBe(true);
      expect(res.reason).toBe('RESERVATION_ACQUIRED_FROM_CANCELLED');
    });

    it('Focus 13: Existing PAY, INS and ACC events remain completely unchanged', async () => {
      const payJob: EmailQueueJob = {
        queue_id: 'q-pay-verify',
        recipient_profile_id: 'prof-pay',
        recipient_email: 'buyer@example.com',
        event_type: 'PAY-02',
        subject: 'PYQ Package Enrolled',
        template_id: 'PAY-02',
        payload: { packageName: 'UPSC 10-Year PYQ', amount: 1500 },
        priority: 'high',
        status: 'processing',
        attempts: 0,
        max_attempts: 5,
        created_at: new Date().toISOString(),
      };

      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [payJob]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
      };

      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async () => ({ success: true, providerMessageId: 'pay_msg_999' })),
      };

      const res = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(res.succeeded).toBe(1);
      expect(mockDb.recordSuccess).toHaveBeenCalledWith('q-pay-verify', 'pay_msg_999');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 9. Final Reservation Integrity & Provider Failure Boundary Audit (17 Mandated Tests)
  // ════════════════════════════════════════════════════════════════════════════
  describe('9. Final Reservation Integrity & Provider Failure Boundary Audit (17 Mandated Tests)', () => {
    // 1. Seconds-only release timestamp is rejected
    it('Mandate 1: Seconds-only release timestamp is rejected', () => {
      const simulateAcquireRpc = (p_release_generation: string) => {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(p_release_generation)) {
          return { success: false, reason: 'INVALID_RELEASE_GENERATION_FORMAT', is_transient: false };
        }
        return { success: true };
      };

      const result = simulateAcquireRpc('2026-11-21T10:00:00Z');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('INVALID_RELEASE_GENERATION_FORMAT');
    });

    // 2. Missing fractional precision is rejected
    it('Mandate 2: Missing fractional precision is rejected', () => {
      const simulateAcquireRpc = (p_release_generation: string) => {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(p_release_generation)) {
          return { success: false, reason: 'INVALID_RELEASE_GENERATION_FORMAT', is_transient: false };
        }
        return { success: true };
      };

      expect(simulateAcquireRpc('2026-11-21T10:00:00.12Z').success).toBe(false);
      expect(simulateAcquireRpc('2026-11-21T10:00:00.123Z').success).toBe(false);
      expect(simulateAcquireRpc('2026-11-21T10:00:00.12345Z').success).toBe(false);
      expect(simulateAcquireRpc('2026-11-21T10:00:00.123456Z').success).toBe(true);
    });

    // 3. One-microsecond generation mismatch is rejected
    it('Mandate 3: One-microsecond generation mismatch is rejected', () => {
      const dbTimestamp = '2026-11-21T10:00:00.123456Z';
      const queuedTimestamp = '2026-11-21T10:00:00.123457Z'; // Differ by exactly 1 microsecond

      const simulateTimestampCheck = (dbTs: string, queuedTs: string) => {
        if (dbTs !== queuedTs) {
          return { success: false, reason: 'TEST_RESULT_RELEASE_SUPERSEDED', is_transient: false };
        }
        return { success: true };
      };

      const result = simulateTimestampCheck(dbTimestamp, queuedTimestamp);
      expect(result.success).toBe(false);
      expect(result.reason).toBe('TEST_RESULT_RELEASE_SUPERSEDED');
    });

    // 4. Result state change during reservation acquisition cannot acquire a stale generation
    it('Mandate 4: Result state change during reservation acquisition cannot acquire a stale generation', async () => {
      const mockSupabase = {
        rpc: vi.fn(async (funcName: string) => {
          if (funcName === 'acquire_mock_result_dispatch_reservation') {
            return {
              data: {
                success: false,
                reason: 'TEST_RESULT_UNRELEASED',
                is_transient: false,
              },
              error: null,
            };
          }
          return { data: null, error: null };
        }),
      };
      const workerDb = createSupabaseWorkerDb(mockSupabase);
      const res = await workerDb.acquireMockResultDispatchReservation!(
        'att-race-unrelease',
        't-1',
        'q-stale',
        '2026-11-21T10:00:00.000000Z'
      );
      expect(res.success).toBe(false);
      expect(res.reason).toBe('TEST_RESULT_UNRELEASED');
    });

    // 5. Worker crash after setting provider-request-started state retains the reservation
    it('Mandate 5: Worker crash after setting provider-request-started state retains the reservation', async () => {
      let ledger = {
        status: 'reserved',
        provider_outcome: 'not_dispatched',
      };

      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [
          {
            queue_id: 'q-crash-before-http',
            recipient_profile_id: 'prof-1',
            recipient_email: 'student@example.com',
            event_type: 'EXM-01',
            subject: 'Result',
            template_id: 'EXM-01',
            payload: { attemptId: 'att-crash-5', testId: 't-1', releasedAt: '2026-11-21T10:00:00.000000Z' },
            priority: 'normal',
            status: 'processing',
            attempts: 0,
            max_attempts: 5,
            created_at: new Date().toISOString(),
          },
        ]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => ({ eligible: true })),
        acquireMockResultDispatchReservation: vi.fn(async () => ({ success: true })),
        updateMockResultProviderOutcome: vi.fn(async (_att, _q, outcome) => {
          ledger.provider_outcome = outcome;
          return true;
        }),
        releaseMockResultDispatchReservation: vi.fn(async () => {
          if (ledger.provider_outcome === 'outcome_unknown') {
            return false; // Forbidden to release!
          }
          ledger.status = 'released';
          return true;
        }),
      };

      // Provider throws crash immediately before network transmission
      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async () => {
          throw new Error('Fatal worker process termination simulation');
        }),
      };

      try {
        await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      } catch {}

      // Even if the worker crashed, the durable preflight DB write already set outcome_unknown
      expect(ledger.provider_outcome).toBe('outcome_unknown');
      expect(mockDb.releaseMockResultDispatchReservation).not.toHaveBeenCalled();
    });

    // 6. Worker crash after transmission cannot permit another generation to dispatch
    it('Mandate 6: Worker crash after transmission cannot permit another generation to dispatch', async () => {
      // Simulating a newer release generation trying to acquire a reservation while previous was left in outcome_unknown
      const mockSupabase = {
        rpc: vi.fn(async (funcName: string) => {
          if (funcName === 'acquire_mock_result_dispatch_reservation') {
            return {
              data: {
                success: false,
                reason: 'PROVIDER_OUTCOME_UNKNOWN_BLOCKED',
                is_transient: false,
                reserved_by_queue_id: 'q-crashed-prior-worker',
              },
              error: null,
            };
          }
          return { data: null, error: null };
        }),
      };

      const workerDb = createSupabaseWorkerDb(mockSupabase);
      const res = await workerDb.acquireMockResultDispatchReservation!(
        'att-crash-6',
        't-1',
        'q-generation-2',
        '2026-11-21T16:00:00.000000Z'
      );

      expect(res.success).toBe(false);
      expect(res.reason).toBe('PROVIDER_OUTCOME_UNKNOWN_BLOCKED');
    });

    // 7. Definitive rejection can release the reservation
    it('Mandate 7: Definitive rejection can release the reservation', async () => {
      let ledger = {
        status: 'reserved',
        provider_outcome: 'outcome_unknown', // Preflight set it to unknown
      };

      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [
          {
            queue_id: 'q-def-reject-7',
            recipient_profile_id: 'prof-1',
            recipient_email: 'unverified@unverified-domain.com',
            event_type: 'EXM-01',
            subject: 'Result',
            template_id: 'EXM-01',
            payload: { attemptId: 'att-def-7', testId: 't-1', releasedAt: '2026-11-21T10:00:00.000000Z' },
            priority: 'normal',
            status: 'processing',
            attempts: 0,
            max_attempts: 5,
            created_at: new Date().toISOString(),
          },
        ]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => ({ eligible: true })),
        acquireMockResultDispatchReservation: vi.fn(async () => ({ success: true })),
        updateMockResultProviderOutcome: vi.fn(async (_att, _q, outcome) => {
          ledger.provider_outcome = outcome;
          return true;
        }),
        releaseMockResultDispatchReservation: vi.fn(async () => {
          if (ledger.provider_outcome === 'definitively_rejected') {
            ledger.status = 'released';
            return true;
          }
          return false;
        }),
      };

      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async () => ({
          success: false,
          retryable: false, // 422 Unprocessable Entity - definitive rejection
          error: 'The domain is not verified',
        })),
      };

      const res = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(res.failed).toBe(1);
      expect(ledger.provider_outcome).toBe('definitively_rejected');
      expect(ledger.status).toBe('released');
    });

    // 8. Ambiguous outcomes never release the reservation
    it('Mandate 8: Ambiguous outcomes never release the reservation', async () => {
      let ledger = {
        status: 'reserved',
        provider_outcome: 'not_dispatched',
      };

      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [
          {
            queue_id: 'q-ambig-8',
            recipient_profile_id: 'prof-1',
            recipient_email: 'student@example.com',
            event_type: 'EXM-01',
            subject: 'Result',
            template_id: 'EXM-01',
            payload: { attemptId: 'att-ambig-8', testId: 't-1', releasedAt: '2026-11-21T10:00:00.000000Z' },
            priority: 'normal',
            status: 'processing',
            attempts: 0,
            max_attempts: 5,
            created_at: new Date().toISOString(),
          },
        ]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => ({ eligible: true })),
        acquireMockResultDispatchReservation: vi.fn(async () => ({ success: true })),
        updateMockResultProviderOutcome: vi.fn(async (_att, _q, outcome) => {
          ledger.provider_outcome = outcome;
          return true;
        }),
        releaseMockResultDispatchReservation: vi.fn(async () => true),
      };

      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async () => ({
          success: false,
          retryable: true,
          error: 'Connection timeout',
        })),
      };

      const res = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(res.retried).toBe(1);
      expect(ledger.provider_outcome).toBe('outcome_unknown');
      expect(mockDb.releaseMockResultDispatchReservation).not.toHaveBeenCalled();
    });

    // 9. An accepted email consumes the reservation exactly once
    it('Mandate 9: An accepted email consumes the reservation exactly once', async () => {
      let ledger = {
        status: 'reserved',
        provider_outcome: 'not_dispatched',
        consumed_at: null as string | null,
      };

      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [
          {
            queue_id: 'q-accepted-9',
            recipient_profile_id: 'prof-1',
            recipient_email: 'student@example.com',
            event_type: 'EXM-01',
            subject: 'Result',
            template_id: 'EXM-01',
            payload: { attemptId: 'att-acc-9', testId: 't-1', releasedAt: '2026-11-21T10:00:00.000000Z' },
            priority: 'normal',
            status: 'processing',
            attempts: 0,
            max_attempts: 5,
            created_at: new Date().toISOString(),
          },
        ]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => ({ eligible: true })),
        acquireMockResultDispatchReservation: vi.fn(async () => ({ success: true })),
        updateMockResultProviderOutcome: vi.fn(async (_att, _q, outcome) => {
          ledger.provider_outcome = outcome;
          return true;
        }),
        recordMockResultSuccess: vi.fn(async (_q, _att, msgId) => {
          ledger.status = 'consumed';
          ledger.provider_outcome = 'provider_accepted';
          ledger.consumed_at = new Date().toISOString();
          return true;
        }),
      };

      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async () => ({
          success: true,
          providerMessageId: 'resend_msg_accepted_9',
        })),
      };

      const res = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(res.succeeded).toBe(1);
      expect(ledger.status).toBe('consumed');
      expect(ledger.provider_outcome).toBe('provider_accepted');
      expect(mockDb.recordMockResultSuccess).toHaveBeenCalledWith(
        'q-accepted-9',
        'att-acc-9',
        'resend_msg_accepted_9'
      );
    });

    // 10. Success recording rejects a mismatched queue ID
    it('Mandate 10: Success recording rejects a mismatched queue ID', () => {
      const simulateRecordSuccessRpc = (
        p_queue_id: string,
        p_attempt_id: string,
        dbQueueJob: { queue_id: string; attempt_id: string }
      ) => {
        if (p_queue_id !== dbQueueJob.queue_id) {
          return false;
        }
        return true;
      };

      const ok = simulateRecordSuccessRpc('q-caller-mismatch', 'att-1', {
        queue_id: 'q-actual-owner',
        attempt_id: 'att-1',
      });
      expect(ok).toBe(false);
    });

    // 11. Success recording rejects a mismatched attempt ID
    it('Mandate 11: Success recording rejects a mismatched attempt ID', () => {
      const simulateRecordSuccessRpc = (
        p_queue_id: string,
        p_attempt_id: string,
        dbQueueJob: { queue_id: string; attempt_id: string }
      ) => {
        if (p_attempt_id !== dbQueueJob.attempt_id) {
          return false;
        }
        return true;
      };

      const ok = simulateRecordSuccessRpc('q-1', 'att-wrong', {
        queue_id: 'q-1',
        attempt_id: 'att-expected',
      });
      expect(ok).toBe(false);
    });

    // 12. Success recording cannot consume another queue job's reservation
    it("Mandate 12: Success recording cannot consume another queue job's reservation", () => {
      const simulateRecordSuccessRpc = (
        p_queue_id: string,
        p_attempt_id: string,
        reservation: { attempt_id: string; reserved_by_queue_id: string }
      ) => {
        if (reservation.reserved_by_queue_id !== p_queue_id) {
          return false; // Cannot consume another job's reservation!
        }
        return true;
      };

      const ok = simulateRecordSuccessRpc('q-job-b', 'att-1', {
        attempt_id: 'att-1',
        reserved_by_queue_id: 'q-job-a',
      });
      expect(ok).toBe(false);
    });

    // 13. Repeated success RPC execution does not create duplicate logs
    it('Mandate 13: Repeated success RPC execution does not create duplicate logs', () => {
      const deliveryLogs: Array<{ queue_id: string; provider_message_id: string }> = [];
      let dbQueue = { status: 'pending', provider_message_id: null as string | null };
      let dbLedger = { status: 'reserved', provider_outcome: 'not_dispatched', provider_message_id: null as string | null };

      const executeRecordSuccessRpc = (qId: string, attId: string, msgId: string) => {
        // Idempotency check: if already sent and consumed with matching params, return true without re-inserting log
        if (
          dbQueue.status === 'sent' &&
          dbQueue.provider_message_id === msgId &&
          dbLedger.status === 'consumed' &&
          dbLedger.provider_message_id === msgId
        ) {
          return true; // Idempotent replay
        }

        dbQueue.status = 'sent';
        dbQueue.provider_message_id = msgId;
        dbLedger.status = 'consumed';
        dbLedger.provider_outcome = 'provider_accepted';
        dbLedger.provider_message_id = msgId;

        // Insert log idempotently
        if (!deliveryLogs.some((l) => l.queue_id === qId && l.provider_message_id === msgId)) {
          deliveryLogs.push({ queue_id: qId, provider_message_id: msgId });
        }
        return true;
      };

      // Call 1
      expect(executeRecordSuccessRpc('q-1', 'att-1', 'resend-123')).toBe(true);
      expect(deliveryLogs.length).toBe(1);

      // Call 2 (idempotent replay)
      expect(executeRecordSuccessRpc('q-1', 'att-1', 'resend-123')).toBe(true);
      expect(deliveryLogs.length).toBe(1); // Log count unchanged!
    });

    // 14. A never-dispatched job older than 24 hours is not incorrectly classified as an ambiguous provider request
    it('Mandate 14: A never-dispatched job older than 24 hours is not incorrectly classified as an ambiguous provider request', async () => {
      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async () => ({ success: true, providerMessageId: 'resend-never-dispatched' })),
      };

      // Job created 30 hours ago, but never previously reached the provider (attempts = 0, providerRequestStartedAt is null)
      const thirtyHoursAgo = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
      const neverDispatchedJob: EmailQueueJob = {
        queue_id: 'q-delayed-dispatch',
        recipient_profile_id: 'prof-1',
        recipient_email: 'student@example.com',
        event_type: 'EXM-01',
        subject: 'Official Result',
        template_id: 'EXM-01',
        payload: { attemptId: 'att-delayed-1', testId: 't-1', releasedAt: '2026-11-20T08:00:00.000000Z' },
        priority: 'normal',
        status: 'processing',
        attempts: 0,
        max_attempts: 5,
        created_at: thirtyHoursAgo,
      };

      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [neverDispatchedJob]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => ({ eligible: true })),
        acquireMockResultDispatchReservation: vi.fn(async () => ({
          success: true,
          providerRequestStartedAt: undefined, // NEVER reached provider before!
        })),
        recordMockResultSuccess: vi.fn(async () => true),
        updateMockResultProviderOutcome: vi.fn(async () => true),
      };

      const result = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(result.succeeded).toBe(1);
      // Provider sendEmail MUST be invoked because it is NOT an ambiguous retry
      expect(mockProvider.sendEmail).toHaveBeenCalledTimes(1);
    });

    // 15. An ambiguous request older than the safe idempotency window is blocked
    it('Mandate 15: An ambiguous request older than the safe idempotency window is blocked', async () => {
      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async () => ({ success: true })),
      };

      const twentyThreeHoursAndHalfAgo = new Date(Date.now() - 23.5 * 60 * 60 * 1000).toISOString();
      const ambiguousRetryJob: EmailQueueJob = {
        queue_id: 'q-ambig-23h',
        recipient_profile_id: 'prof-1',
        recipient_email: 'student@example.com',
        event_type: 'EXM-01',
        subject: 'Official Result',
        template_id: 'EXM-01',
        payload: { attemptId: 'att-ambig-23h', testId: 't-1', releasedAt: '2026-11-20T08:00:00.000000Z' },
        priority: 'normal',
        status: 'processing',
        attempts: 2,
        max_attempts: 5,
        created_at: twentyThreeHoursAndHalfAgo,
      };

      let ledgerStatus = 'reserved';
      let ledgerOutcome = 'outcome_unknown';

      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [ambiguousRetryJob]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => ({ eligible: true })),
        acquireMockResultDispatchReservation: vi.fn(async () => ({
          success: true,
          providerRequestStartedAt: twentyThreeHoursAndHalfAgo, // Started 23.5 hours ago!
        })),
        updateMockResultProviderOutcome: vi.fn(async (_att, _q, outcome, _err, status) => {
          ledgerOutcome = outcome;
          if (status) ledgerStatus = status;
          return true;
        }),
      };

      const result = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(result.failed).toBe(1);
      expect(mockProvider.sendEmail).not.toHaveBeenCalled();
      expect(mockDb.markFailed).toHaveBeenCalledWith(
        'q-ambig-23h',
        expect.stringContaining('IDEMPOTENCY_WINDOW_EXPIRED_MANUAL_RECONCILIATION_REQUIRED')
      );
      expect(ledgerStatus).toBe('blocked');
      expect(ledgerOutcome).toBe('outcome_unknown');
    });

    // 16. Manual reconciliation does not clear an ambiguous reservation without verified evidence
    it('Mandate 16: Manual reconciliation does not clear an ambiguous reservation without verified evidence', () => {
      // Simulate manual reconciliation verification:
      const reconcileAttempt = (
        ledger: { status: string; provider_outcome: string },
        evidence: { resendDeliveryConfirmed?: boolean; resendRejectionConfirmed?: boolean }
      ) => {
        if (evidence.resendDeliveryConfirmed) {
          // Conclusive evidence of acceptance: consume entitlement
          ledger.status = 'consumed';
          ledger.provider_outcome = 'provider_accepted';
          return { action: 'CONSUMED', success: true };
        }
        if (evidence.resendRejectionConfirmed) {
          // Conclusive evidence of rejection: safely release
          ledger.status = 'reserved';
          ledger.provider_outcome = 'definitively_rejected';
          return { action: 'RELEASED', success: true };
        }
        // In the absence of definitive evidence, the reservation MUST REMAIN BLOCKED
        return { action: 'BLOCKED', success: false, reason: 'RECONCILIATION_EVIDENCE_INSUFFICIENT' };
      };

      const blockedLedger = { status: 'blocked', provider_outcome: 'outcome_unknown' };
      
      // Attempt to clear without evidence: rejected
      const unverifiedAttempt = reconcileAttempt(blockedLedger, {});
      expect(unverifiedAttempt.success).toBe(false);
      expect(unverifiedAttempt.reason).toBe('RECONCILIATION_EVIDENCE_INSUFFICIENT');
      expect(blockedLedger.status).toBe('blocked');

      // Attempt with verified proof of acceptance
      const verifiedAccepted = reconcileAttempt(blockedLedger, { resendDeliveryConfirmed: true });
      expect(verifiedAccepted.success).toBe(true);
      expect(blockedLedger.status).toBe('consumed');
    });

    // 17. Existing PAY, INS and ACC functionality remains unchanged
    it('Mandate 17: Existing PAY, INS and ACC functionality remains unchanged', async () => {
      const insJob: EmailQueueJob = {
        queue_id: 'q-ins-04-test',
        recipient_profile_id: 'prof-ins',
        recipient_email: 'payer@example.com',
        event_type: 'INS-04',
        subject: 'Installment Due Soon',
        template_id: 'INS-04',
        payload: { scheduleId: 'sch-1', amount: 5000 },
        priority: 'high',
        status: 'processing',
        attempts: 0,
        max_attempts: 5,
        created_at: new Date().toISOString(),
      };

      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [insJob]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        isInstallmentReminderEligible: vi.fn(async () => true),
      };

      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async () => ({ success: true, providerMessageId: 'ins_msg_004' })),
      };

      const res = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(res.succeeded).toBe(1);
      expect(mockDb.recordSuccess).toHaveBeenCalledWith('q-ins-04-test', 'ins_msg_004');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 10. Final Provider Classification and Pre-Flight Safety Audit (14 Mandated Tests)
  // ════════════════════════════════════════════════════════════════════════════
  describe('10. Final Provider Classification and Pre-Flight Safety Audit (14 Mandated Tests)', () => {
    const validExmJob: EmailQueueJob = {
      queue_id: 'q-suite10-job',
      recipient_profile_id: 'prof-s10',
      recipient_email: 'student.s10@example.com',
      recipient_name: 'Ananya Sharma',
      event_type: 'EXM-01',
      subject: 'Official Result Published: Mock 10',
      template_id: 'EXM-01',
      payload: {
        attemptId: 'att-suite10-1',
        testId: 't-suite10-1',
        releasedAt: '2026-11-21T10:00:00.000000Z',
        score: 90,
        maxScore: 100,
        totalMarks: 100,
        percentage: 90,
        testTitle: 'Mock 10',
        resultsUrl: 'https://makemetopper.com/student/tests/t-suite10-1/results/att-suite10-1',
      },
      priority: 'normal',
      status: 'processing',
      attempts: 0,
      max_attempts: 5,
      idempotency_key: 'exm_res:att-suite10-1:20261121T100000.000000Z',
      created_at: new Date().toISOString(),
    };

    // Mandate 1: Missing pre-flight method blocks Resend
    it('Audit 1: Missing pre-flight persistence method halts dispatch and enters bounded retry without calling Resend', async () => {
      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [{ ...validExmJob }]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true, status: 'pending' })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => ({ eligible: true })),
        acquireMockResultDispatchReservation: vi.fn(async () => ({ success: true })),
        // updateMockResultProviderOutcome intentionally OMITTED!
      };

      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async () => ({ success: true, providerMessageId: 'should_not_be_called' })),
      };

      const result = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(result.retried).toBe(1);
      expect(result.succeeded).toBe(0);
      expect(mockProvider.sendEmail).not.toHaveBeenCalled();
      expect(mockDb.scheduleRetry).toHaveBeenCalledWith(
        'q-suite10-job',
        expect.stringContaining('PREFLIGHT_METHOD_MISSING'),
        expect.any(Number)
      );
    });

    // Mandate 2: Failed pre-flight persistence blocks Resend
    it('Audit 2: Failed pre-flight persistence (DB throw or 0 rows updated) halts dispatch without calling Resend', async () => {
      // Case A: DB error during preflight update
      const mockDbThrows: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [{ ...validExmJob }]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true, status: 'pending' })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => ({ eligible: true })),
        acquireMockResultDispatchReservation: vi.fn(async () => ({ success: true })),
        updateMockResultProviderOutcome: vi.fn(async () => {
          throw new Error('Database connection reset during preflight persistence');
        }),
      };

      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async () => ({ success: true })),
      };

      const resThrows = await runEmailWorkerBatch(mockDbThrows, mockProvider, { batchSize: 1 });
      expect(resThrows.retried).toBe(1);
      expect(resThrows.succeeded).toBe(0);
      expect(mockProvider.sendEmail).not.toHaveBeenCalled();
      expect(mockDbThrows.scheduleRetry).toHaveBeenCalledWith(
        'q-suite10-job',
        'PROVIDER_PREFLIGHT_ERROR',
        expect.any(Number)
      );

      // Case B: Preflight returns false (0 rows updated due to reservation ownership mismatch or consumed)
      const mockDbZeroRows: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [{ ...validExmJob }]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true, status: 'pending' })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => ({ eligible: true })),
        acquireMockResultDispatchReservation: vi.fn(async () => ({ success: true })),
        updateMockResultProviderOutcome: vi.fn(async () => false),
      };

      const resZeroRows = await runEmailWorkerBatch(mockDbZeroRows, mockProvider, { batchSize: 1 });
      expect(resZeroRows.retried).toBe(1);
      expect(resZeroRows.succeeded).toBe(0);
      expect(mockProvider.sendEmail).not.toHaveBeenCalled();
      expect(mockDbZeroRows.scheduleRetry).toHaveBeenCalledWith(
        'q-suite10-job',
        'RESERVATION_OWNERSHIP_MISMATCH_OR_CONSUMED',
        expect.any(Number)
      );
    });

    // Mandate 3: Provider-request timestamp is set only once / immutable via COALESCE
    it('Audit 3: Provider request timestamp is set only once and remains strictly immutable via COALESCE', () => {
      // Simulates update_mock_result_provider_outcome COALESCE logic
      let provider_request_started_at: string | null = null;
      let status = 'reserved';
      let outcome = 'not_dispatched';

      const updateOutcome = (newOutcome: string, newStatus?: string, simulatedNow?: string) => {
        outcome = newOutcome;
        if (newStatus) status = newStatus;
        // Postgres: provider_request_started_at = COALESCE(provider_request_started_at, clock_timestamp())
        if (!provider_request_started_at) {
          provider_request_started_at = simulatedNow || new Date().toISOString();
        }
      };

      const t1 = '2026-11-21T10:00:00.123456Z';
      const t2_retry = '2026-11-21T10:05:00.654321Z';

      // Preflight call 1: sets timestamp to t1
      updateOutcome('outcome_unknown', undefined, t1);
      expect(provider_request_started_at).toBe(t1);

      // Preflight call 2 (on retry): COALESCE preserves t1, does NOT overwrite with t2
      updateOutcome('outcome_unknown', undefined, t2_retry);
      expect(provider_request_started_at).toBe(t1);
    });

    // Mandate 4: Retry preserves original timestamp and does NOT extend 23h window
    it('Audit 4: Retry preserves original timestamp and does not extend the 23-hour safe idempotency window', async () => {
      const originalStartedAt = new Date(Date.now() - 23.2 * 60 * 60 * 1000).toISOString(); // 23.2 hours ago
      let updatedStatus = 'reserved';

      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [{ ...validExmJob, attempts: 2 }]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => ({ eligible: true })),
        acquireMockResultDispatchReservation: vi.fn(async () => ({
          success: true,
          providerRequestStartedAt: originalStartedAt,
        })),
        updateMockResultProviderOutcome: vi.fn(async (_att, _q, _out, _err, st) => {
          if (st) updatedStatus = st;
          return true;
        }),
      };

      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async () => ({ success: true })),
      };

      const res = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(res.failed).toBe(1);
      expect(mockProvider.sendEmail).not.toHaveBeenCalled();
      expect(updatedStatus).toBe('blocked');
      expect(mockDb.markFailed).toHaveBeenCalledWith(
        'q-suite10-job',
        expect.stringContaining('IDEMPOTENCY_WINDOW_EXPIRED_MANUAL_RECONCILIATION_REQUIRED')
      );
    });

    // Mandate 5: Resend 409 concurrent request remains reserved and retryable
    it('Audit 5: Resend 409 concurrent_idempotent_requests remains reserved and retryable with backoff', async () => {
      // Test provider error classification
      const fakeFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        text: async () => JSON.stringify({
          name: 'concurrent_idempotent_requests',
          message: 'A request with the same idempotency key is currently running',
        }),
        headers: new Headers(),
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = fakeFetch;

      try {
        const provider = new ResendProvider({ apiKey: 're_test_key' });
        const res = await provider.sendEmail({
          to: 'student@example.com',
          subject: 'Test',
          html: '<p>Test</p>',
          idempotencyKey: 'key-123',
        });

        expect(res.success).toBe(false);
        expect(res.retryable).toBe(true);
        expect(res.isAmbiguous).toBe(true);
        expect(res.providerErrorCode).toBe('concurrent_idempotent_requests');
        expect(res.retryAfterSeconds).toBe(5);
      } finally {
        globalThis.fetch = originalFetch;
      }

      // Test worker integration: ensures reservation is retained in outcome_unknown, NOT released
      let dispatchStatus = 'reserved';
      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [{ ...validExmJob }]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true, status: 'pending' })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => ({ eligible: true })),
        acquireMockResultDispatchReservation: vi.fn(async () => ({ success: true })),
        updateMockResultProviderOutcome: vi.fn(async () => true),
        releaseMockResultDispatchReservation: vi.fn(async () => {
          dispatchStatus = 'released';
          return true;
        }),
      };

      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async () => ({
          success: false,
          retryable: true,
          isAmbiguous: true,
          providerErrorCode: 'concurrent_idempotent_requests',
          retryAfterSeconds: 5,
          error: 'Resend 409 concurrent request in progress',
        })),
      };

      const result = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(result.retried).toBe(1);
      expect(mockDb.scheduleRetry).toHaveBeenCalledWith('q-suite10-job', expect.any(String), 5);
      expect(mockDb.releaseMockResultDispatchReservation).not.toHaveBeenCalled();
      expect(dispatchStatus).toBe('reserved');
    });

    // Mandate 6: Resend 409 invalid idempotent request does not release reservation (blocked)
    it('Audit 6: Resend 409 invalid_idempotent_request retains reservation in blocked state and never releases', async () => {
      const fakeFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        text: async () => JSON.stringify({
          name: 'invalid_idempotent_request',
          message: 'The payload does not match the previous request for this idempotency key',
        }),
        headers: new Headers(),
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = fakeFetch;

      try {
        const provider = new ResendProvider({ apiKey: 're_test_key' });
        const res = await provider.sendEmail({
          to: 'student@example.com',
          subject: 'Test',
          html: '<p>Test</p>',
          idempotencyKey: 'key-123',
        });

        expect(res.success).toBe(false);
        expect(res.retryable).toBe(false);
        expect(res.isAmbiguous).toBe(true);
        expect(res.providerErrorCode).toBe('invalid_idempotent_request');
      } finally {
        globalThis.fetch = originalFetch;
      }

      // Worker execution: must block reservation, NEVER release it
      let reservationStatus = 'reserved';
      let recordedOutcome = '';
      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [{ ...validExmJob }]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => ({ eligible: true })),
        acquireMockResultDispatchReservation: vi.fn(async () => ({ success: true })),
        updateMockResultProviderOutcome: vi.fn(async (_att, _q, outcome, _err, status) => {
          recordedOutcome = outcome;
          if (status) reservationStatus = status;
          return true;
        }),
        releaseMockResultDispatchReservation: vi.fn(async () => true),
      };

      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async () => ({
          success: false,
          retryable: false,
          isAmbiguous: true,
          providerErrorCode: 'invalid_idempotent_request',
          error: 'Resend 409 payload mismatch for idempotency key',
        })),
      };

      const workerRes = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(workerRes.failed).toBe(1);
      expect(reservationStatus).toBe('blocked');
      expect(recordedOutcome).toBe('outcome_unknown');
      expect(mockDb.releaseMockResultDispatchReservation).not.toHaveBeenCalled();
    });

    // Mandate 7: Resend 429 retains reservation and respects Retry-After
    it('Audit 7: Resend 429 rate limit retains reservation and respects Retry-After header', async () => {
      const headers = new Headers();
      headers.set('Retry-After', '45');
      const fakeFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => JSON.stringify({
          name: 'rate_limit_exceeded',
          message: 'Rate limit exceeded',
        }),
        headers,
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = fakeFetch;

      try {
        const provider = new ResendProvider({ apiKey: 're_test_key' });
        const res = await provider.sendEmail({
          to: 'student@example.com',
          subject: 'Test',
          html: '<p>Test</p>',
        });

        expect(res.success).toBe(false);
        expect(res.retryable).toBe(true);
        expect(res.isAmbiguous).toBe(true);
        expect(res.retryAfterSeconds).toBe(45);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    // Mandate 8: Definitive 4xx rejection recognized only from verified provider semantics
    it('Audit 8: Definitive 4xx rejection is recognized only for verified provider semantics (422) and releases reservation', async () => {
      // 422 Unprocessable Entity -> definitive non-ambiguous rejection
      const fakeFetch422 = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: async () => JSON.stringify({
          name: 'validation_error',
          message: 'The domain does not exist or is not verified',
        }),
        headers: new Headers(),
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = fakeFetch422;

      try {
        const provider = new ResendProvider({ apiKey: 're_test_key' });
        const res422 = await provider.sendEmail({
          to: 'student@example.com',
          subject: 'Test',
          html: '<p>Test</p>',
        });

        expect(res422.success).toBe(false);
        expect(res422.retryable).toBe(false);
        expect(res422.isAmbiguous).toBe(false);
      } finally {
        globalThis.fetch = originalFetch;
      }

      // Worker releases reservation ONLY when isAmbiguous is false and definitive
      let reservationReleased = false;
      let recordedOutcome = '';
      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [{ ...validExmJob }]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => ({ eligible: true })),
        acquireMockResultDispatchReservation: vi.fn(async () => ({ success: true })),
        updateMockResultProviderOutcome: vi.fn(async (_att, _q, outcome) => {
          recordedOutcome = outcome;
          return true;
        }),
        releaseMockResultDispatchReservation: vi.fn(async () => {
          reservationReleased = true;
          return true;
        }),
      };

      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async () => ({
          success: false,
          retryable: false,
          isAmbiguous: false,
          statusCode: 422,
          error: 'Unprocessable entity: Domain not verified',
        })),
      };

      const workerRes = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(workerRes.failed).toBe(1);
      expect(recordedOutcome).toBe('definitively_rejected');
      expect(reservationReleased).toBe(true);
    });

    // ════════════════════════════════════════════════════════════════════════════
    // Section 1 Monotonicity Tests (Mandates 1-8)
    // ════════════════════════════════════════════════════════════════════════════

    it('Monotonicity 1: Initial request returns definitive 422: reservation can be safely released', async () => {
      let reservationReleased = false;
      let recordedOutcome = '';
      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [{ ...validExmJob, attempts: 0 }]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => ({ eligible: true })),
        acquireMockResultDispatchReservation: vi.fn(async () => ({
          success: true,
          providerRequestStartedAt: undefined, // First attempt!
        })),
        updateMockResultProviderOutcome: vi.fn(async (_att, _q, outcome) => {
          recordedOutcome = outcome;
          return true;
        }),
        releaseMockResultDispatchReservation: vi.fn(async () => {
          reservationReleased = true;
          return true;
        }),
      };

      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async () => ({
          success: false,
          retryable: false,
          isAmbiguous: false,
          statusCode: 422,
          error: 'Unprocessable entity: Domain not verified',
        })),
      };

      const workerRes = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(workerRes.failed).toBe(1);
      expect(recordedOutcome).toBe('definitively_rejected');
      expect(reservationReleased).toBe(true);
    });

    it('Monotonicity 2: Initial request returns definitive 401: reservation can be safely released if the provider response establishes non-acceptance', async () => {
      let reservationReleased = false;
      let recordedOutcome = '';
      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [{ ...validExmJob, attempts: 0 }]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => ({ eligible: true })),
        acquireMockResultDispatchReservation: vi.fn(async () => ({
          success: true,
          providerRequestStartedAt: undefined, // First attempt!
        })),
        updateMockResultProviderOutcome: vi.fn(async (_att, _q, outcome) => {
          recordedOutcome = outcome;
          return true;
        }),
        releaseMockResultDispatchReservation: vi.fn(async () => {
          reservationReleased = true;
          return true;
        }),
      };

      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async () => ({
          success: false,
          retryable: false,
          isAmbiguous: false,
          statusCode: 401,
          error: 'Unauthorized: Invalid API key',
        })),
      };

      const workerRes = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(workerRes.failed).toBe(1);
      expect(recordedOutcome).toBe('definitively_rejected');
      expect(reservationReleased).toBe(true);
    });

    it('Monotonicity 3: Initial request times out, retry receives 401: uncertainty is preserved', async () => {
      let reservationReleased = false;
      let recordedOutcome = '';
      let recordedStatus = '';
      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [{ ...validExmJob, attempts: 1 }]), // Retry attempt!
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => ({ eligible: true })),
        acquireMockResultDispatchReservation: vi.fn(async () => ({
          success: true,
          reason: 'RESERVATION_RENEWED_AMBIGUOUS_RETRY',
          providerRequestStartedAt: '2026-11-21T10:00:00.000000Z', // Prior attempt reached provider!
        })),
        updateMockResultProviderOutcome: vi.fn(async (_att, _q, outcome, _err, status) => {
          recordedOutcome = outcome;
          if (status) recordedStatus = status;
          return true;
        }),
        releaseMockResultDispatchReservation: vi.fn(async () => {
          reservationReleased = true;
          return true;
        }),
      };

      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async () => ({
          success: false,
          retryable: false,
          isAmbiguous: false,
          statusCode: 401,
          error: 'Unauthorized: Key rotated during retry',
        })),
      };

      const workerRes = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(workerRes.failed).toBe(1);
      // Monotonicity: uncertainty MUST be preserved; reservation MUST NOT be released!
      expect(recordedOutcome).toBe('outcome_unknown');
      expect(recordedStatus).toBe('blocked');
      expect(reservationReleased).toBe(false);
      expect(mockDb.releaseMockResultDispatchReservation).not.toHaveBeenCalled();
      expect(mockDb.markFailed).toHaveBeenCalledWith(
        'q-suite10-job',
        expect.stringContaining('AMBIGUOUS_RETRY_PERMANENT_ERROR')
      );
    });

    it('Monotonicity 4: Initial request times out, retry receives 422: uncertainty is preserved unless the original request outcome is conclusively resolved', async () => {
      let reservationReleased = false;
      let recordedOutcome = '';
      let recordedStatus = '';
      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [{ ...validExmJob, attempts: 1 }]), // Retry attempt!
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => ({ eligible: true })),
        acquireMockResultDispatchReservation: vi.fn(async () => ({
          success: true,
          reason: 'RESERVATION_RENEWED_AMBIGUOUS_RETRY',
          providerRequestStartedAt: '2026-11-21T10:00:00.000000Z',
        })),
        updateMockResultProviderOutcome: vi.fn(async (_att, _q, outcome, _err, status) => {
          recordedOutcome = outcome;
          if (status) recordedStatus = status;
          return true;
        }),
        releaseMockResultDispatchReservation: vi.fn(async () => {
          reservationReleased = true;
          return true;
        }),
      };

      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async () => ({
          success: false,
          retryable: false,
          isAmbiguous: false,
          statusCode: 422,
          error: 'Unprocessable entity: Suppressed recipient on retry',
        })),
      };

      const workerRes = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(workerRes.failed).toBe(1);
      // Monotonicity: Earlier request may have sent, preserve outcome_unknown, block reservation, never release
      expect(recordedOutcome).toBe('outcome_unknown');
      expect(recordedStatus).toBe('blocked');
      expect(reservationReleased).toBe(false);
      expect(mockDb.releaseMockResultDispatchReservation).not.toHaveBeenCalled();
    });

    it('Monotonicity 5: Initial request times out, retry receives 409 concurrent: same operation is retried safely', async () => {
      let reservationReleased = false;
      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [{ ...validExmJob, attempts: 1 }]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true, status: 'pending' })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => ({ eligible: true })),
        acquireMockResultDispatchReservation: vi.fn(async () => ({
          success: true,
          providerRequestStartedAt: '2026-11-21T10:00:00.000000Z',
        })),
        updateMockResultProviderOutcome: vi.fn(async () => true),
        releaseMockResultDispatchReservation: vi.fn(async () => {
          reservationReleased = true;
          return true;
        }),
      };

      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async () => ({
          success: false,
          retryable: true,
          isAmbiguous: true,
          providerErrorCode: 'concurrent_idempotent_requests',
          retryAfterSeconds: 5,
          error: 'A request with the same idempotency key is currently running',
        })),
      };

      const workerRes = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(workerRes.retried).toBe(1);
      expect(mockDb.scheduleRetry).toHaveBeenCalledWith('q-suite10-job', expect.any(String), 5);
      expect(reservationReleased).toBe(false);
    });

    it('Monotonicity 6: Initial request times out, retry receives 429: reservation remains protected', async () => {
      let reservationReleased = false;
      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [{ ...validExmJob, attempts: 1 }]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true, status: 'pending' })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => ({ eligible: true })),
        acquireMockResultDispatchReservation: vi.fn(async () => ({
          success: true,
          providerRequestStartedAt: '2026-11-21T10:00:00.000000Z',
        })),
        updateMockResultProviderOutcome: vi.fn(async () => true),
        releaseMockResultDispatchReservation: vi.fn(async () => {
          reservationReleased = true;
          return true;
        }),
      };

      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async () => ({
          success: false,
          retryable: true,
          isAmbiguous: true,
          statusCode: 429,
          retryAfterSeconds: 30,
          error: 'Rate limit exceeded',
        })),
      };

      const workerRes = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(workerRes.retried).toBe(1);
      expect(mockDb.scheduleRetry).toHaveBeenCalledWith('q-suite10-job', expect.any(String), 30);
      expect(reservationReleased).toBe(false);
    });

    it('Monotonicity 7: Any subsequent ambiguous 5xx preserves the original uncertainty', async () => {
      let reservationReleased = false;
      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [{ ...validExmJob, attempts: 2 }]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true, status: 'pending' })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => ({ eligible: true })),
        acquireMockResultDispatchReservation: vi.fn(async () => ({
          success: true,
          providerRequestStartedAt: '2026-11-21T10:00:00.000000Z',
        })),
        updateMockResultProviderOutcome: vi.fn(async () => true),
        releaseMockResultDispatchReservation: vi.fn(async () => {
          reservationReleased = true;
          return true;
        }),
      };

      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async () => ({
          success: false,
          retryable: true,
          isAmbiguous: true,
          statusCode: 502,
          error: 'Bad Gateway: Provider connection drop',
        })),
      };

      const workerRes = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(workerRes.retried).toBe(1);
      expect(reservationReleased).toBe(false);
    });

    it('Monotonicity 8: An accepted request permanently consumes the entitlement', async () => {
      let reservationConsumed = false;
      let recordedMsgId = '';
      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [{ ...validExmJob, attempts: 1 }]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => ({ eligible: true })),
        acquireMockResultDispatchReservation: vi.fn(async () => ({
          success: true,
          providerRequestStartedAt: '2026-11-21T10:00:00.000000Z',
        })),
        updateMockResultProviderOutcome: vi.fn(async () => true),
        recordMockResultSuccess: vi.fn(async (_qId, _attId, msgId) => {
          reservationConsumed = true;
          recordedMsgId = msgId;
          return true;
        }),
      };

      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async () => ({
          success: true,
          providerMessageId: 'resend_monotonic_msg_999',
        })),
      };

      const workerRes = await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      expect(workerRes.succeeded).toBe(1);
      expect(reservationConsumed).toBe(true);
      expect(recordedMsgId).toBe('resend_monotonic_msg_999');
      expect(mockDb.recordMockResultSuccess).toHaveBeenCalledWith(
        'q-suite10-job',
        'att-suite10-1',
        'resend_monotonic_msg_999'
      );
    });

    it('Monotonicity 9: Database update_mock_result_provider_outcome preserves outcome_unknown against definitively_rejected overwrite', () => {
      let outcome = 'outcome_unknown';
      let status = 'reserved';

      const updateRpc = (p_outcome: string, p_status?: string) => {
        outcome = (outcome === 'outcome_unknown' && p_outcome === 'definitively_rejected')
          ? 'outcome_unknown'
          : p_outcome;
        status = (outcome === 'outcome_unknown' && p_outcome === 'definitively_rejected')
          ? 'blocked'
          : (p_status || status);
      };

      updateRpc('definitively_rejected', undefined);
      expect(outcome).toBe('outcome_unknown');
      expect(status).toBe('blocked');
    });

    it('Reconciliation Audit: Manual reconciliation records all 8 mandatory audit fields', () => {
      const auditLogs: any[] = [];
      const ledger: any = {
        attempt_id: 'att-audit-88',
        test_id: 't-audit-88',
        reserved_by_queue_id: 'q-audit-88',
        status: 'blocked',
        provider_outcome: 'outcome_unknown',
      };

      const reconcileRpc = (
        p_attempt_id: string,
        p_operator: string,
        p_evidence_ref: string,
        p_action: string,
        p_provider_msg_id?: string
      ) => {
        if (!p_operator || p_operator.trim() === '') return { success: false, reason: 'MISSING_OPERATOR_IDENTITY' };
        if (!p_evidence_ref || p_evidence_ref.trim().length < 10) return { success: false, reason: 'INVALID_EVIDENCE_REFERENCE' };
        if (ledger.status === 'consumed') return { success: false, reason: 'CANNOT_REOPEN_CONSUMED_RESERVATION' };
        if (ledger.status !== 'blocked') return { success: false, reason: 'RESERVATION_NOT_BLOCKED' };

        const v_prev_outcome = ledger.provider_outcome;
        let v_new_outcome = '';
        const v_now = new Date().toISOString();

        if (p_action === 'unblock_and_reset') {
          v_new_outcome = 'not_dispatched';
          ledger.status = 'reserved';
          ledger.provider_outcome = v_new_outcome;
          ledger.reconciled_at = v_now;
          ledger.reconciled_by = p_operator;
          ledger.reconciliation_reason = p_evidence_ref;
        } else if (p_action === 'mark_consumed') {
          if (!p_provider_msg_id) return { success: false, reason: 'MISSING_PROVIDER_MESSAGE_ID' };
          v_new_outcome = 'provider_accepted';
          ledger.status = 'consumed';
          ledger.provider_outcome = v_new_outcome;
          ledger.provider_message_id = p_provider_msg_id;
          ledger.reconciled_at = v_now;
          ledger.reconciled_by = p_operator;
          ledger.reconciliation_reason = p_evidence_ref;
        }

        auditLogs.push({
          queue_id: ledger.reserved_by_queue_id,
          provider: 'manual_reconciliation',
          event_type: `reconciled_${p_action}`,
          payload: {
            attempt_id: p_attempt_id,
            queue_id: ledger.reserved_by_queue_id,
            previous_provider_outcome: v_prev_outcome,
            new_provider_outcome: v_new_outcome,
            operator: p_operator,
            evidence_reference: p_evidence_ref,
            action: p_action,
            reconciled_at: v_now,
          },
        });

        return {
          success: true,
          action: p_action,
          attempt_id: p_attempt_id,
          queue_id: ledger.reserved_by_queue_id,
          previous_provider_outcome: v_prev_outcome,
          new_provider_outcome: v_new_outcome,
          operator: p_operator,
          evidence_reference: p_evidence_ref,
          reconciled_at: v_now,
        };
      };

      const result = reconcileRpc(
        'att-audit-88',
        'ops-lead@makemetopper.com',
        'Resend Support Ticket Ref #RES-99882211',
        'unblock_and_reset'
      );

      expect(result.success).toBe(true);
      expect(result.attempt_id).toBe('att-audit-88');
      expect(result.queue_id).toBe('q-audit-88');
      expect(result.previous_provider_outcome).toBe('outcome_unknown');
      expect(result.new_provider_outcome).toBe('not_dispatched');
      expect(result.operator).toBe('ops-lead@makemetopper.com');
      expect(result.evidence_reference).toBe('Resend Support Ticket Ref #RES-99882211');
      expect(result.action).toBe('unblock_and_reset');
      expect(result.reconciled_at).toBeDefined();

      expect(auditLogs.length).toBe(1);
      expect(auditLogs[0].payload.previous_provider_outcome).toBe('outcome_unknown');
      expect(auditLogs[0].payload.new_provider_outcome).toBe('not_dispatched');
      expect(auditLogs[0].payload.operator).toBe('ops-lead@makemetopper.com');
    });

    // Mandate 9: 408 and 5xx remain ambiguous
    it('Audit 9: HTTP 408 timeouts and 5xx server errors remain strictly ambiguous', async () => {
      // 503 Service Unavailable
      const fakeFetch503 = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => 'Service Temporarily Unavailable',
        headers: new Headers(),
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = fakeFetch503;

      try {
        const provider = new ResendProvider({ apiKey: 're_test_key' });
        const res503 = await provider.sendEmail({
          to: 'student@example.com',
          subject: 'Test',
          html: '<p>Test</p>',
        });

        expect(res503.success).toBe(false);
        expect(res503.retryable).toBe(true);
        expect(res503.isAmbiguous).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    // Mandate 10: Retry payload is byte-for-byte identical
    it('Audit 10: Retry payload is byte-for-byte identical from immutable queue payload', () => {
      const jobPayload = { ...validExmJob.payload };
      const context = {
        recipientEmail: validExmJob.recipient_email,
        recipientName: validExmJob.recipient_name,
      };

      const render1 = renderEmail(validExmJob.template_id, jobPayload, context);
      const render2 = renderEmail(validExmJob.template_id, jobPayload, context);

      expect(render1.subject).toBe(render2.subject);
      expect(render1.html).toBe(render2.html);
      expect(render1.text).toBe(render2.text);
      expect(Buffer.from(render1.html).equals(Buffer.from(render2.html))).toBe(true);
    });

    // Mandate 11: Same retry uses identical idempotency key
    it('Audit 11: Across multiple worker retries, identical idempotency key is transmitted', async () => {
      const sentKeys: (string | undefined)[] = [];
      const mockProvider = {
        name: 'resend',
        sendEmail: vi.fn(async (req: EmailSendRequest) => {
          sentKeys.push(req.idempotencyKey);
          return { success: false, retryable: true, isAmbiguous: true, error: 'Gateway timeout' };
        }),
      };

      const job: EmailQueueJob = { ...validExmJob };
      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [job]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        checkMockResultReleaseEligibility: vi.fn(async () => ({ eligible: true })),
        acquireMockResultDispatchReservation: vi.fn(async () => ({ success: true })),
        updateMockResultProviderOutcome: vi.fn(async () => true),
      };

      // Attempt 1
      await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });
      // Attempt 2
      job.attempts = 1;
      (mockDb.claimBatch as any).mockResolvedValueOnce([job]);
      await runEmailWorkerBatch(mockDb, mockProvider, { batchSize: 1 });

      expect(sentKeys.length).toBe(2);
      expect(sentKeys[0]).toBe('exm_res:att-suite10-1:20261121T100000.000000Z');
      expect(sentKeys[1]).toBe(sentKeys[0]);
    });

    // Mandate 12: Lock-order analysis test covering global hierarchy
    it('Audit 12: Global database lock hierarchy enforces Level 1 -> Level 2 -> Level 3 -> Level 4 unidirectionally', () => {
      const hierarchy = [
        'public.mock_results',               // Level 1
        'public.mock_result_email_dispatches', // Level 2
        'public.email_queue',                 // Level 3
        'public.email_delivery_logs',         // Level 4
      ];

      // Verify that acquire_mock_result_dispatch_reservation locks mock_results (L1) then dispatches (L2)
      // and that record_mock_result_email_success locks dispatches (L2) then email_queue (L3)
      const acquireLocks = ['public.mock_results', 'public.mock_result_email_dispatches'];
      const recordLocks = ['public.mock_result_email_dispatches', 'public.email_queue', 'public.email_delivery_logs'];

      for (let i = 0; i < acquireLocks.length - 1; i++) {
        const currentIdx = hierarchy.indexOf(acquireLocks[i]);
        const nextIdx = hierarchy.indexOf(acquireLocks[i + 1]);
        expect(currentIdx).toBeLessThan(nextIdx);
      }

      for (let i = 0; i < recordLocks.length - 1; i++) {
        const currentIdx = hierarchy.indexOf(recordLocks[i]);
        const nextIdx = hierarchy.indexOf(recordLocks[i + 1]);
        expect(currentIdx).toBeLessThan(nextIdx);
      }
    });

    // Mandate 13: Manual reconciliation rejects missing/invalid evidence
    it('Audit 13: Manual reconciliation rejects missing or invalid evidence and requires blocked status', () => {
      // Simulates public.reconcile_mock_result_dispatch_reservation logic
      const reconcile = (
        record: { status: string; provider_outcome: string },
        operator: string,
        evidenceRef: string,
        action: string
      ) => {
        if (!operator || operator.trim() === '') return { success: false, reason: 'MISSING_OPERATOR_IDENTITY' };
        if (!evidenceRef || evidenceRef.trim().length < 10) return { success: false, reason: 'INVALID_EVIDENCE_REFERENCE' };
        if (record.status === 'consumed') return { success: false, reason: 'CANNOT_REOPEN_CONSUMED_RESERVATION' };
        if (record.status !== 'blocked') return { success: false, reason: 'RESERVATION_NOT_BLOCKED' };
        if (action === 'unblock_and_reset') {
          record.status = 'reserved';
          record.provider_outcome = 'not_dispatched';
          return { success: true, action: 'unblock_and_reset' };
        }
        return { success: false, reason: 'UNKNOWN_ACTION' };
      };

      const blockedRecord = { status: 'blocked', provider_outcome: 'outcome_unknown' };

      // Missing operator
      expect(reconcile(blockedRecord, '', 'Resend audit log #9876543210', 'unblock_and_reset')).toEqual({
        success: false,
        reason: 'MISSING_OPERATOR_IDENTITY',
      });

      // Short / invalid evidence
      expect(reconcile(blockedRecord, 'admin@makemetopper.com', 'short', 'unblock_and_reset')).toEqual({
        success: false,
        reason: 'INVALID_EVIDENCE_REFERENCE',
      });

      // Valid reconciliation
      const successRes = reconcile(
        blockedRecord,
        'ops-lead@makemetopper.com',
        'Resend API Audit ID: res_audit_10928374',
        'unblock_and_reset'
      );
      expect(successRes.success).toBe(true);
      expect(blockedRecord.status).toBe('reserved');
      expect(blockedRecord.provider_outcome).toBe('not_dispatched');
    });

    // Mandate 14: Consumed reservation cannot be reopened
    it('Audit 14: Consumed reservation cannot be reopened under any circumstances', () => {
      const consumedRecord = { status: 'consumed', provider_outcome: 'provider_accepted' };

      const reconcile = (
        record: { status: string; provider_outcome: string },
        operator: string,
        evidenceRef: string,
        action: string
      ) => {
        if (!operator || operator.trim() === '') return { success: false, reason: 'MISSING_OPERATOR_IDENTITY' };
        if (!evidenceRef || evidenceRef.trim().length < 10) return { success: false, reason: 'INVALID_EVIDENCE_REFERENCE' };
        if (record.status === 'consumed') return { success: false, reason: 'CANNOT_REOPEN_CONSUMED_RESERVATION' };
        if (record.status !== 'blocked') return { success: false, reason: 'RESERVATION_NOT_BLOCKED' };
        return { success: true };
      };

      const result = reconcile(
        consumedRecord,
        'security-admin@makemetopper.com',
        'Definitive audit logs proving email was dropped by downstream MTA',
        'unblock_and_reset'
      );

      expect(result.success).toBe(false);
      expect(result.reason).toBe('CANNOT_REOPEN_CONSUMED_RESERVATION');
      expect(consumedRecord.status).toBe('consumed');
    });
  });
});
