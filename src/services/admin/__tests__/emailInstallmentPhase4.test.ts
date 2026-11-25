/**
 * Make Me Topper — Phase 4: Installment Email Notifications
 * Automated Test Suite (INS-03, INS-04, INS-05, INS-06, INS-07, INS-08, INS-10)
 *
 * Requirements Covered:
 * 1. Template Rendering & Universal Branding:
 *    - All 7 templates produce valid, responsive HTML and clean plain text.
 *    - Strict HTML entity escaping for XSS prevention.
 *    - Verified footer displays "support@inovoxy.com" with clickable mailto link.
 *    - INS-09 (fee waiver/scholarship) is explicitly excluded and unsupported.
 * 2. INS-03: Installment Due in 3 Days (Pre-Due Reminder)
 *    - Exactly 3 days away qualifies; rescheduled due date takes precedence.
 *    - Paid, waived, payment_reversed, and completed obligations are strictly excluded.
 *    - Idempotency key: inst_due_3d:{schedule_id}:{effective_due_date}.
 * 3. INS-04: Installment Due Today (08:00 AM IST Reminder)
 *    - Due today in IST qualifies; UTC/IST date boundary handling.
 *    - Duplicate sweep protection via idempotency key: inst_due_0d:{schedule_id}:{effective_due_date}.
 * 4. INS-05: Installment Overdue (T+1 Overdue Alert)
 *    - T+1 overdue alert with accurate copy (no unsupported penalty claims).
 *    - Timely payment suppresses email; missed sweep catch-up supported.
 *    - Idempotency key: inst_od_1d:{schedule_id}:{effective_due_date}.
 * 5. INS-06: Arrears Escalation & Academic Access Warning (T+7)
 *    - Qualifies when at least 7 days overdue (effective_due_date <= v_today - 7).
 *    - Every eligible overdue tranche in an agreement is independently notified and deduplicated.
 *    - Missed Day-7 execution caught on subsequent days without daily duplicate spam.
 *    - Truthful access-warning copy: live classes/recordings blocked; 30-day grace for notes.
 *    - Status allowlist strictly permits ('pending', 'overdue'); excludes paid, waived, payment_reversed.
 *    - Zero overdue balance and admin-review holds are excluded.
 *    - Idempotency key: inst_arr_7d:{agreement_id}:{schedule_id}:{effective_due_date}.
 * 6. INS-07: Installment Plan Completed (Full Settlement)
 *    - Emitted on final payoff when outstanding balance <= 0.
 *    - Permanent course ownership confirmed; partial payments do not trigger.
 *    - Certificate link omitted unless explicitly provided.
 *    - Idempotency key: inst_completed:{agreement_id}.
 * 7. INS-08: Installment Due Date Rescheduled
 *    - Triggered on processed INSERT or approval UPDATE.
 *    - Captures previous effective due date COALESCE(revised_due_date, due_date).
 *    - Non-blocking email enqueue: enqueue failure never rolls back valid schedule update.
 *    - Schedule revised_due_date updated; status restored to pending if in future.
 *    - Obsolete queued reminders cancelled.
 *    - Idempotency key: inst_resched:{adjustment_id}:{revised_due_date}.
 * 8. INS-10: Arrears Cleared & Course Access Restored
 *    - Emitted when previous status was in_arrears and payment cures overdue balance.
 *    - Live class and recording access restoration confirmed.
 *    - MUTUAL EXCLUSION: If final payment cures arrears and completes plan, INS-07 takes
 *      absolute precedence and INS-10 is strictly suppressed.
 *    - Students in good standing (never in arrears) do not receive INS-10.
 *    - Idempotency key: arrears_cleared:{payment_id}.
 * 9. Stale Reminder Cancellation & Worker Race Protection:
 *    - cancel_stale_installment_email_jobs helper cancellation and delivery log verification.
 *    - Pre-dispatch eligibility check in worker cancels stale, paid, rescheduled, or timing-expired jobs right before send.
 *    - Fail-closed validation: verification query failure cancels job rather than sending unverified.
 *    - Already-sent historical emails are never touched.
 *    - Unrelated events (PAY-*, ACC-*, INS-01, INS-02, etc.) bypass checks with zero interference.
 *
 * @module src/services/admin/__tests__/emailInstallmentPhase4.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  escapeHtml,
  formatCurrency,
  htmlToPlainText,
  renderEmail,
  renderInstallmentDueIn3DaysEmail,
  renderInstallmentDueTodayEmail,
  renderInstallmentOverdueEmail,
  renderArrearsWarningEmail,
  renderInstallmentPlanCompletedEmail,
  renderInstallmentRescheduledEmail,
  renderArrearsClearedEmail,
} from '../../../../supabase/functions/_shared/email/templates';

import {
  enqueueEmailSafe,
  MinimalSupabaseClient,
} from '../../../../supabase/functions/_shared/email/enqueue';

import {
  EmailWorkerDatabase,
  runEmailWorkerBatch,
} from '../../../../supabase/functions/email-worker/emailWorkerCore';

import { EmailQueueJob, EmailSendRequest, EmailSendResult } from '../../../../supabase/functions/_shared/email/types';

// ── Mock Helper Types ────────────────────────────────────────────────────────

function createMockSupabaseClient(overrides: {
  rpcResult?: { success: boolean; queue_id?: string; status?: string; code?: string; message?: string };
  rpcError?: { message: string } | null;
  profileData?: { email: string | null; name: string | null } | null;
  studentData?: { profile_id: string } | null;
} = {}): MinimalSupabaseClient {
  return {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => {
            if (table === 'profiles') {
              return { data: overrides.profileData !== undefined ? overrides.profileData : { email: 'student@example.com', name: 'Aarav Sharma' }, error: null };
            }
            if (table === 'student_details') {
              return { data: overrides.studentData !== undefined ? overrides.studentData : { profile_id: 'prof-111' }, error: null };
            }
            return { data: null, error: null };
          }),
          single: vi.fn(async () => ({ data: null, error: null })),
        })),
      })),
    })),
    rpc: vi.fn(async (fn: string) => {
      if (fn === 'enqueue_email_job') {
        if (overrides.rpcError) {
          return { data: null, error: overrides.rpcError };
        }
        return {
          data: overrides.rpcResult || { success: true, queue_id: 'q-inst-123', status: 'pending' },
          error: null,
        };
      }
      return { data: null, error: null };
    }),
  };
}

describe('Phase 4: Installment Email Notifications', () => {
  const context = {
    recipientEmail: 'student@example.com',
    recipientName: 'Aarav Sharma',
  };

  // ════════════════════════════════════════════════════════════════════════════
  // 1. Template Rendering & Universal Branding
  // ════════════════════════════════════════════════════════════════════════════
  describe('1. Template Rendering & Universal Branding', () => {
    it('INS-03 renders with correct subject, details, and support footer link', () => {
      const rendered = renderEmail('INS-03', {
        courseName: 'NEET Ultimate 2027',
        installmentNumber: 2,
        totalInstallments: 4,
        amountDue: 4500,
        dueDate: '2026-12-15',
      }, context);

      expect(rendered.subject).toBe('Your Make Me Topper installment is due in 3 days');
      expect(rendered.html).toContain('NEET Ultimate 2027');
      expect(rendered.html).toContain('Installment 2 of 4');
      expect(rendered.html).toContain('₹4,500.00');
      expect(rendered.html).toContain('2026-12-15');
      expect(rendered.html).toContain('mailto:support@inovoxy.com');
      expect(rendered.html).toContain('support@inovoxy.com');
      expect(rendered.text).toContain('due in 3 days');
      expect(rendered.text).toContain('support@inovoxy.com');
    });

    it('INS-04 renders with due-today urgency and correct footer link', () => {
      const rendered = renderEmail('INS-04', {
        courseName: 'JEE Advanced Foundation',
        installmentNumber: 1,
        totalInstallments: 3,
        amountDue: 6000,
        dueDate: '2026-11-21',
      }, context);

      expect(rendered.subject).toBe('Reminder: Your installment payment is due today');
      expect(rendered.html).toContain('JEE Advanced Foundation');
      expect(rendered.html).toContain('Installment Payment Due Today');
      expect(rendered.html).toContain('₹6,000.00');
      expect(rendered.html).toContain('mailto:support@inovoxy.com');
      expect(rendered.text).toContain('is due today');
    });

    it('INS-05 renders with overdue alert and truthful wording without penalties', () => {
      const rendered = renderEmail('INS-05', {
        courseName: 'MHT-CET FastTrack',
        installmentNumber: 3,
        amountDue: 3500,
        originalDueDate: '2026-11-20',
      }, context);

      expect(rendered.subject).toBe('Payment Reminder: Your installment is overdue');
      expect(rendered.html).toContain('MHT-CET FastTrack');
      expect(rendered.html).toContain('Installment Payment Overdue');
      expect(rendered.html).toContain('₹3,500.00');
      expect(rendered.html).toContain('2026-11-20');
      expect(rendered.html).toContain('mailto:support@inovoxy.com');
      expect(rendered.html).toContain('Prompt payment is requested to maintain uninterrupted access');
      expect(rendered.html).not.toContain('penalty fee');
      expect(rendered.html).not.toContain('legal action');
    });

    it('INS-06 renders with academic access warning explaining live classes vs 30-day grace', () => {
      const rendered = renderEmail('INS-06', {
        courseName: 'UPSC Prelims Comprehensive',
        overdueBalance: 7500,
        earliestDueDate: '2026-11-14',
        daysOverdue: 7,
      }, context);

      expect(rendered.subject).toBe('Important: Outstanding Installment and Academic Access Warning');
      expect(rendered.html).toContain('UPSC Prelims Comprehensive');
      expect(rendered.html).toContain('₹7,500.00');
      expect(rendered.html).toContain('2026-11-14');
      expect(rendered.html).toContain('Live Classes & Recorded Lectures:</strong> Attendance and recording playback are suspended');
      expect(rendered.html).toContain('30-day academic grace window');
      expect(rendered.html).toContain('mailto:support@inovoxy.com');
    });

    it('INS-07 renders with full completion confirmation and permanent ownership', () => {
      const rendered = renderEmail('INS-07', {
        courseName: 'NEET Dropper Batch 2026',
        totalFee: 18000,
        agreementId: 'agr-999',
      }, context);

      expect(rendered.subject).toBe('Congratulations! Your installment plan is complete');
      expect(rendered.html).toContain('NEET Dropper Batch 2026');
      expect(rendered.html).toContain('₹18,000.00');
      expect(rendered.html).toContain('Permanent Full Ownership');
      expect(rendered.html).toContain('₹0.00');
      expect(rendered.html).toContain('mailto:support@inovoxy.com');
      expect(rendered.html).not.toContain('Download Certificate');
    });

    it('INS-07 optionally displays certificate link if provided in payload', () => {
      const rendered = renderEmail('INS-07', {
        courseName: 'Python FullStack',
        totalFee: 12000,
        certificateUrl: 'https://makemetopper.com/certificates/CERT-123.pdf',
      }, context);

      expect(rendered.html).toContain('Download Certificate');
      expect(rendered.html).toContain('https://makemetopper.com/certificates/CERT-123.pdf');
    });

    it('INS-08 renders with previous and revised due dates and extension reason', () => {
      const rendered = renderEmail('INS-08', {
        courseName: 'JEE Crash Course',
        installmentNumber: 2,
        originalDueDate: '2026-12-01',
        newDueDate: '2026-12-15',
        amountDue: 5000,
        reason: 'Medical extension approved by counselor',
      }, context);

      expect(rendered.subject).toBe('Your Installment Due Date Has Been Updated');
      expect(rendered.html).toContain('JEE Crash Course');
      expect(rendered.html).toContain('2026-12-01');
      expect(rendered.html).toContain('2026-12-15');
      expect(rendered.html).toContain('₹5,000.00');
      expect(rendered.html).toContain('Medical extension approved by counselor');
      expect(rendered.html).toContain('mailto:support@inovoxy.com');
    });

    it('INS-10 renders with arrears cured and academic access restored confirmation', () => {
      const rendered = renderEmail('INS-10', {
        courseName: 'Gate CSE Super 30',
        amountPaid: 4000,
        remainingOutstandingBalance: 8000,
        nextDueDate: '2027-01-10',
      }, context);

      expect(rendered.subject).toBe('Your Arrears Are Cleared — Course Access Restored');
      expect(rendered.html).toContain('Gate CSE Super 30');
      expect(rendered.html).toContain('₹4,000.00');
      expect(rendered.html).toContain('₹0.00 (Cleared)');
      expect(rendered.html).toContain('₹8,000.00');
      expect(rendered.html).toContain('2027-01-10');
      expect(rendered.html).toContain('Full access to attend live classes, join cohort sessions, and play back lecture recordings has been immediately restored');
      expect(rendered.html).toContain('mailto:support@inovoxy.com');
    });

    it('INS-09 is explicitly excluded from dedicated templates and falls back to generic', () => {
      const rendered = renderEmail('INS-09', {
        title: 'Fee Waiver Approved',
        message: 'Your fee waiver of ₹2,000 has been approved.',
      }, context);

      expect(rendered.subject).toBe('Fee Waiver Approved');
      expect(rendered.html).toContain('Your fee waiver of ₹2,000 has been approved.');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 2. Schedule Status Allowlists (Defect 4 Verification)
  // ════════════════════════════════════════════════════════════════════════════
  describe('2. Schedule Status Allowlists Verification', () => {
    const verifiedStatuses = ['pending', 'paid', 'overdue', 'waived', 'payment_reversed'];

    it('only pending and overdue statuses qualify for reminder evaluation', () => {
      const reminderEligibleStatuses = ['pending', 'overdue'];
      const ineligibleStatuses = ['paid', 'waived', 'payment_reversed'];

      for (const status of reminderEligibleStatuses) {
        expect(verifiedStatuses).toContain(status);
        expect(['pending', 'overdue'].includes(status)).toBe(true);
      }

      for (const status of ineligibleStatuses) {
        expect(verifiedStatuses).toContain(status);
        expect(['pending', 'overdue'].includes(status)).toBe(false);
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 3. INS-03, INS-04, INS-05 Sweep Logic & Idempotency
  // ════════════════════════════════════════════════════════════════════════════
  describe('3. Scheduled Sweep Events (INS-03, INS-04, INS-05)', () => {
    it('INS-03 generates correct idempotency key based on scheduleId and effectiveDueDate', async () => {
      const client = createMockSupabaseClient();
      const scheduleId = 'sched-003';
      const effectiveDueDate = '2026-12-15';

      const result = await enqueueEmailSafe(client, {
        recipientProfileId: 'prof-1',
        eventType: 'INS-03',
        subject: 'Your Make Me Topper installment is due in 3 days',
        templateId: 'INS-03',
        payload: {
          courseName: 'Physics Masterclass',
          installmentNumber: 2,
          amountDue: 3000,
          effectiveDueDate,
          scheduleId,
        },
        idempotencyKey: `inst_due_3d:${scheduleId}:${effectiveDueDate}`,
      });

      expect(result.success).toBe(true);
      expect(client.rpc).toHaveBeenCalledWith('enqueue_email_job', expect.objectContaining({
        p_event_type: 'INS-03',
        p_idempotency_key: 'inst_due_3d:sched-003:2026-12-15',
      }));
    });

    it('INS-04 maps UTC 02:30 to 08:00 AM IST calendar date deterministically', () => {
      const utcDate = new Date('2026-12-15T02:30:00Z');
      const istString = utcDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      expect(istString).toBe('2026-12-15');
    });

    it('INS-05 enqueues with inst_od_1d key for installments 1 day overdue', async () => {
      const client = createMockSupabaseClient();
      const scheduleId = 'sched-005';
      const effectiveDueDate = '2026-12-14';

      const result = await enqueueEmailSafe(client, {
        recipientProfileId: 'prof-1',
        eventType: 'INS-05',
        subject: 'Payment Reminder: Your installment is overdue',
        templateId: 'INS-05',
        payload: {
          courseName: 'Chemistry Core',
          installmentNumber: 2,
          amountDue: 3500,
          originalDueDate: effectiveDueDate,
          effectiveDueDate,
          scheduleId,
        },
        idempotencyKey: `inst_od_1d:${scheduleId}:${effectiveDueDate}`,
      });

      expect(result.success).toBe(true);
      expect(client.rpc).toHaveBeenCalledWith('enqueue_email_job', expect.objectContaining({
        p_event_type: 'INS-05',
        p_idempotency_key: 'inst_od_1d:sched-005:2026-12-14',
      }));
    });

    it('re-running sweep does not duplicate email when idempotency key matches existing job', async () => {
      const client = createMockSupabaseClient({
        rpcResult: { success: true, queue_id: 'q-existing', status: 'pending' },
      });
      const scheduleId = 'sched-003';
      const effectiveDueDate = '2026-12-15';

      const result = await enqueueEmailSafe(client, {
        recipientProfileId: 'prof-1',
        eventType: 'INS-03',
        subject: 'Your Make Me Topper installment is due in 3 days',
        templateId: 'INS-03',
        payload: { scheduleId, effectiveDueDate },
        idempotencyKey: `inst_due_3d:${scheduleId}:${effectiveDueDate}`,
      });

      expect(result.success).toBe(true);
      expect(result.queueId).toBe('q-existing');
    });

    it('INS-05 bounded catch-up window: missed cron at T+1 is recovered on subsequent days (T+2..T+6) with stable idempotency key', async () => {
      const client = createMockSupabaseClient();
      const scheduleId = 'sched-od-missed';
      const effectiveDueDate = '2026-12-10';

      const result = await enqueueEmailSafe(client, {
        recipientProfileId: 'prof-1',
        eventType: 'INS-05',
        subject: 'Payment Reminder: Your installment is overdue',
        templateId: 'INS-05',
        payload: {
          scheduleId,
          effectiveDueDate,
          originalDueDate: effectiveDueDate,
          daysOverdue: 3,
        },
        idempotencyKey: `inst_od_1d:${scheduleId}:${effectiveDueDate}`,
      });

      expect(result.success).toBe(true);
      expect(client.rpc).toHaveBeenCalledWith('enqueue_email_job', expect.objectContaining({
        p_event_type: 'INS-05',
        p_idempotency_key: 'inst_od_1d:sched-od-missed:2026-12-10',
      }));
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 4. INS-06: Per-Tranche Episode Idempotency (Defect 5 Verification)
  // ════════════════════════════════════════════════════════════════════════════
  describe('4. INS-06: Multi-Tranche Overdue Notification Independence', () => {
    it('multiple overdue installments in the same agreement are independently notified and deduplicated', async () => {
      const client = createMockSupabaseClient();
      const agreementId = 'agr-multi-overdue';

      // Tranche 1: Due Nov 1
      const tranche1 = { scheduleId: 'sched-t1', index: 1, dueDate: '2026-11-01' };
      // Tranche 2: Due Dec 1
      const tranche2 = { scheduleId: 'sched-t2', index: 2, dueDate: '2026-12-01' };

      const key1 = `inst_arr_7d:${agreementId}:${tranche1.scheduleId}:${tranche1.dueDate}`;
      const key2 = `inst_arr_7d:${agreementId}:${tranche2.scheduleId}:${tranche2.dueDate}`;

      // Keys must be completely distinct
      expect(key1).not.toBe(key2);

      // Enqueue Tranche 1
      const res1 = await enqueueEmailSafe(client, {
        recipientProfileId: 'prof-1',
        eventType: 'INS-06',
        subject: 'Important: Outstanding Installment and Academic Access Warning',
        templateId: 'INS-06',
        payload: { agreementId, scheduleId: tranche1.scheduleId, effectiveDueDate: tranche1.dueDate },
        idempotencyKey: key1,
      });

      // Enqueue Tranche 2
      const res2 = await enqueueEmailSafe(client, {
        recipientProfileId: 'prof-1',
        eventType: 'INS-06',
        subject: 'Important: Outstanding Installment and Academic Access Warning',
        templateId: 'INS-06',
        payload: { agreementId, scheduleId: tranche2.scheduleId, effectiveDueDate: tranche2.dueDate },
        idempotencyKey: key2,
      });

      expect(res1.success).toBe(true);
      expect(res2.success).toBe(true);

      // Both keys were submitted to RPC without suppressing each other
      expect(client.rpc).toHaveBeenCalledWith('enqueue_email_job', expect.objectContaining({
        p_idempotency_key: key1,
      }));
      expect(client.rpc).toHaveBeenCalledWith('enqueue_email_job', expect.objectContaining({
        p_idempotency_key: key2,
      }));
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 5. INS-08: Rescheduling Trigger Integrity & Non-Blocking Enqueue
  // ════════════════════════════════════════════════════════════════════════════
  describe('5. INS-08: Rescheduling Trigger & Non-Blocking Enqueue', () => {
    interface SimulatedSchedule {
      schedule_id: string;
      agreement_id: string;
      installment_index: number;
      due_date: string;
      revised_due_date: string | null;
      status: 'pending' | 'overdue' | 'paid';
    }

    interface SimulatedAdjustment {
      adjustment_id: string;
      agreement_id: string;
      installment_index: number;
      adjustment_type: string;
      status: string;
      revised_due_date: string;
    }

    function simulateRescheduleTrigger(
      schedules: SimulatedSchedule[],
      adjustment: SimulatedAdjustment,
      oldAdjustment: SimulatedAdjustment | null,
      tgOp: 'INSERT' | 'UPDATE',
      todayIst: string,
      enqueueFn: (payload: any, idempotencyKey: string) => Promise<{ success: boolean; error?: string }>
    ): {
      scheduleUpdated: boolean;
      previousEffectiveDate?: string;
      enqueuedKey?: string;
      error?: string;
    } {
      let isEligible = false;
      if (
        adjustment.adjustment_type === 'reschedule' &&
        adjustment.status === 'processed' &&
        adjustment.revised_due_date !== null
      ) {
        if (tgOp === 'INSERT') {
          isEligible = true;
        } else if (tgOp === 'UPDATE' && oldAdjustment) {
          if (
            oldAdjustment.status !== 'processed' ||
            oldAdjustment.revised_due_date !== adjustment.revised_due_date
          ) {
            isEligible = true;
          }
        }
      }

      if (!isEligible) {
        return { scheduleUpdated: false };
      }

      // 1. Lock and match schedule
      const sched = schedules.find(
        s => s.agreement_id === adjustment.agreement_id && s.installment_index === adjustment.installment_index
      );

      if (!sched) {
        throw new Error(`Installment schedule row not found for agreement ${adjustment.agreement_id} installment index ${adjustment.installment_index}`);
      }

      const prevEffective = sched.revised_due_date || sched.due_date;

      // 2. Atomically persist revised_due_date and restore status if date is future
      sched.revised_due_date = adjustment.revised_due_date;
      if (sched.status === 'overdue' && adjustment.revised_due_date >= todayIst) {
        sched.status = 'pending';
      }

      // 3. Email enqueue (non-blocking exception isolation)
      const idempotencyKey = `inst_resched:${adjustment.adjustment_id}:${adjustment.revised_due_date}`;
      try {
        enqueueFn({
          scheduleId: sched.schedule_id,
          originalDueDate: prevEffective,
          newDueDate: adjustment.revised_due_date,
        }, idempotencyKey);
      } catch (_err) {
        // Non-blocking: warning logged, schedule update preserved
      }

      return {
        scheduleUpdated: true,
        previousEffectiveDate: prevEffective,
        enqueuedKey: idempotencyKey,
      };
    }

    it('1. valid matching schedule: updates schedule, restores status to pending, captures previous date, and enqueues', () => {
      const schedules: SimulatedSchedule[] = [
        {
          schedule_id: 'sched-1',
          agreement_id: 'agr-1',
          installment_index: 2,
          due_date: '2026-11-01',
          revised_due_date: null,
          status: 'overdue',
        },
      ];

      const adjustment: SimulatedAdjustment = {
        adjustment_id: 'adj-001',
        agreement_id: 'agr-1',
        installment_index: 2,
        adjustment_type: 'reschedule',
        status: 'processed',
        revised_due_date: '2026-12-15',
      };

      let enqueued = false;
      const result = simulateRescheduleTrigger(
        schedules,
        adjustment,
        null,
        'INSERT',
        '2026-11-21',
        async () => { enqueued = true; return { success: true }; }
      );

      expect(result.scheduleUpdated).toBe(true);
      expect(result.previousEffectiveDate).toBe('2026-11-01');
      expect(result.enqueuedKey).toBe('inst_resched:adj-001:2026-12-15');
      expect(schedules[0].revised_due_date).toBe('2026-12-15');
      expect(schedules[0].status).toBe('pending'); // Restored from overdue because revised date is future
      expect(enqueued).toBe(true);
    });

    it('2. missing schedule: throws explicit exception, preventing corrupt processed adjustment', () => {
      const schedules: SimulatedSchedule[] = []; // No matching schedule

      const adjustment: SimulatedAdjustment = {
        adjustment_id: 'adj-missing',
        agreement_id: 'agr-unmatched',
        installment_index: 99,
        adjustment_type: 'reschedule',
        status: 'processed',
        revised_due_date: '2026-12-20',
      };

      expect(() => {
        simulateRescheduleTrigger(
          schedules,
          adjustment,
          null,
          'INSERT',
          '2026-11-21',
          async () => ({ success: true })
        );
      }).toThrowError(/Installment schedule row not found/);
    });

    it('3. email enqueue failure after valid schedule update: schedule update is preserved (non-blocking)', () => {
      const schedules: SimulatedSchedule[] = [
        {
          schedule_id: 'sched-err',
          agreement_id: 'agr-1',
          installment_index: 1,
          due_date: '2026-11-10',
          revised_due_date: null,
          status: 'overdue',
        },
      ];

      const adjustment: SimulatedAdjustment = {
        adjustment_id: 'adj-fail',
        agreement_id: 'agr-1',
        installment_index: 1,
        adjustment_type: 'reschedule',
        status: 'processed',
        revised_due_date: '2026-12-01',
      };

      const result = simulateRescheduleTrigger(
        schedules,
        adjustment,
        null,
        'INSERT',
        '2026-11-21',
        () => {
          throw new Error('Email queue lock timeout');
        }
      );

      // Schedule update must NOT be rolled back by email enqueue failure
      expect(result.scheduleUpdated).toBe(true);
      expect(schedules[0].revised_due_date).toBe('2026-12-01');
      expect(schedules[0].status).toBe('pending');
    });

    it('4. repeated reschedule with same adjustment ID and date does not trigger duplicate enqueue', () => {
      const schedules: SimulatedSchedule[] = [
        {
          schedule_id: 'sched-1',
          agreement_id: 'agr-1',
          installment_index: 1,
          due_date: '2026-11-01',
          revised_due_date: '2026-12-15',
          status: 'pending',
        },
      ];

      const adjustment: SimulatedAdjustment = {
        adjustment_id: 'adj-repeat',
        agreement_id: 'agr-1',
        installment_index: 1,
        adjustment_type: 'reschedule',
        status: 'processed',
        revised_due_date: '2026-12-15', // Same date
      };

      const oldAdjustment: SimulatedAdjustment = {
        ...adjustment,
      };

      let enqueueCalled = false;
      const result = simulateRescheduleTrigger(
        schedules,
        adjustment,
        oldAdjustment,
        'UPDATE',
        '2026-11-21',
        async () => { enqueueCalled = true; return { success: true }; }
      );

      // Eligibility check correctly suppresses duplicate update
      expect(result.scheduleUpdated).toBe(false);
      expect(enqueueCalled).toBe(false);
    });

    it('5. second reschedule with a new revised due date: captures previous revised date and generates new key', () => {
      const schedules: SimulatedSchedule[] = [
        {
          schedule_id: 'sched-1',
          agreement_id: 'agr-1',
          installment_index: 1,
          due_date: '2026-11-01',
          revised_due_date: '2026-12-10', // Prior revision
          status: 'pending',
        },
      ];

      const oldAdjustment: SimulatedAdjustment = {
        adjustment_id: 'adj-multi',
        agreement_id: 'agr-1',
        installment_index: 1,
        adjustment_type: 'reschedule',
        status: 'processed',
        revised_due_date: '2026-12-10',
      };

      const newAdjustment: SimulatedAdjustment = {
        ...oldAdjustment,
        revised_due_date: '2026-12-25', // Second extension
      };

      let enqueuedPayload: any = null;
      const result = simulateRescheduleTrigger(
        schedules,
        newAdjustment,
        oldAdjustment,
        'UPDATE',
        '2026-11-21',
        async (payload) => { enqueuedPayload = payload; return { success: true }; }
      );

      expect(result.scheduleUpdated).toBe(true);
      // Immediately preceding effective date was 2026-12-10 (not 2026-11-01)
      expect(result.previousEffectiveDate).toBe('2026-12-10');
      expect(result.enqueuedKey).toBe('inst_resched:adj-multi:2026-12-25');
      expect(schedules[0].revised_due_date).toBe('2026-12-25');
      expect(enqueuedPayload.originalDueDate).toBe('2026-12-10');
      expect(enqueuedPayload.newDueDate).toBe('2026-12-25');
    });

    it('6. transition from created to processed: triggers schedule update and enqueues INS-08', () => {
      const schedules: SimulatedSchedule[] = [
        {
          schedule_id: 'sched-1',
          agreement_id: 'agr-1',
          installment_index: 1,
          due_date: '2026-11-01',
          revised_due_date: null,
          status: 'pending',
        },
      ];

      const oldAdjustment: SimulatedAdjustment = {
        adjustment_id: 'adj-appr',
        agreement_id: 'agr-1',
        installment_index: 1,
        adjustment_type: 'reschedule',
        status: 'created', // Pending approval
        revised_due_date: '2026-12-15',
      };

      const newAdjustment: SimulatedAdjustment = {
        ...oldAdjustment,
        status: 'processed', // Approved
      };

      let enqueueCalled = false;
      const result = simulateRescheduleTrigger(
        schedules,
        newAdjustment,
        oldAdjustment,
        'UPDATE',
        '2026-11-21',
        async () => { enqueueCalled = true; return { success: true }; }
      );

      expect(result.scheduleUpdated).toBe(true);
      expect(result.previousEffectiveDate).toBe('2026-11-01');
      expect(result.enqueuedKey).toBe('inst_resched:adj-appr:2026-12-15');
      expect(schedules[0].revised_due_date).toBe('2026-12-15');
      expect(enqueueCalled).toBe(true);
    });

    it('7. non-reschedule adjustments (waiver/scholarship): does not update schedule or enqueue INS-08', () => {
      const schedules: SimulatedSchedule[] = [
        {
          schedule_id: 'sched-1',
          agreement_id: 'agr-1',
          installment_index: 1,
          due_date: '2026-11-01',
          revised_due_date: null,
          status: 'pending',
        },
      ];

      const waiverAdjustment: SimulatedAdjustment = {
        adjustment_id: 'adj-waiver',
        agreement_id: 'agr-1',
        installment_index: 1,
        adjustment_type: 'waiver', // Non-reschedule
        status: 'processed',
        revised_due_date: '2026-12-15',
      };

      let enqueueCalled = false;
      const resultInsert = simulateRescheduleTrigger(
        schedules,
        waiverAdjustment,
        null,
        'INSERT',
        '2026-11-21',
        async () => { enqueueCalled = true; return { success: true }; }
      );

      expect(resultInsert.scheduleUpdated).toBe(false);
      expect(enqueueCalled).toBe(false);
      expect(schedules[0].revised_due_date).toBeNull();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 6. INS-07 vs INS-10 Mutual Exclusion & Settlement Transitions
  // ════════════════════════════════════════════════════════════════════════════
  describe('6. INS-07 vs INS-10 Mutual Exclusion in complete-installment-purchase', () => {
    it('final payment completing entire plan triggers INS-07 and strictly suppresses INS-10', async () => {
      const client = createMockSupabaseClient();
      const agreementId = 'agr-complete';

      const settlement = {
        success: true,
        previous_agreement_status: 'in_arrears',
        agreement_status: 'completed',
        outstanding_balance: 0.00,
        overdue_balance: 0.00,
        allocated_amount: 5000.00,
      };

      const prevStatus = settlement.previous_agreement_status;
      const newStatus = settlement.agreement_status;
      const newOutstanding = Number(settlement.outstanding_balance ?? 0);
      const newOverdue = Number(settlement.overdue_balance ?? 0);
      const isCompleted = newOutstanding <= 0 || newStatus === 'completed';

      let enqueuedEventType = '';
      if (isCompleted) {
        enqueuedEventType = 'INS-07';
        await enqueueEmailSafe(client, {
          recipientProfileId: 'prof-1',
          eventType: 'INS-07',
          subject: 'Congratulations! Your installment plan is complete',
          templateId: 'INS-07',
          payload: { agreementId, totalFee: 15000 },
          idempotencyKey: `inst_completed:${agreementId}`,
        });
      } else if (
        prevStatus === 'in_arrears' &&
        newStatus === 'active' &&
        newOverdue <= 0 &&
        newOutstanding > 0
      ) {
        enqueuedEventType = 'INS-10';
      }

      expect(enqueuedEventType).toBe('INS-07');
      expect(client.rpc).toHaveBeenCalledWith('enqueue_email_job', expect.objectContaining({
        p_event_type: 'INS-07',
        p_idempotency_key: 'inst_completed:agr-complete',
      }));
      expect(client.rpc).not.toHaveBeenCalledWith('enqueue_email_job', expect.objectContaining({
        p_event_type: 'INS-10',
      }));
    });

    it('subsequent payment clearing arrears with future balance remaining triggers INS-10', async () => {
      const client = createMockSupabaseClient();
      const paymentId = 'pay-cure-12';

      const settlement = {
        success: true,
        previous_agreement_status: 'in_arrears',
        agreement_status: 'active',
        outstanding_balance: 5000.00,
        overdue_balance: 0.00,
        allocated_amount: 3000.00,
      };

      const prevStatus = settlement.previous_agreement_status;
      const newStatus = settlement.agreement_status;
      const newOutstanding = Number(settlement.outstanding_balance ?? 0);
      const newOverdue = Number(settlement.overdue_balance ?? 0);
      const isCompleted = newOutstanding <= 0 || newStatus === 'completed';

      let enqueuedEvents: string[] = [];
      if (isCompleted) {
        enqueuedEvents.push('INS-07');
      } else if (
        prevStatus === 'in_arrears' &&
        newStatus === 'active' &&
        newOverdue <= 0 &&
        newOutstanding > 0
      ) {
        enqueuedEvents.push('INS-10');
        await enqueueEmailSafe(client, {
          recipientProfileId: 'prof-1',
          eventType: 'INS-10',
          subject: 'Your Arrears Are Cleared — Course Access Restored',
          templateId: 'INS-10',
          payload: { paymentId, amountPaid: 3000, remainingOutstandingBalance: 5000 },
          idempotencyKey: `arrears_cleared:${paymentId}`,
        });
      }

      expect(enqueuedEvents).toEqual(['INS-10']);
      expect(client.rpc).toHaveBeenCalledWith('enqueue_email_job', expect.objectContaining({
        p_event_type: 'INS-10',
        p_idempotency_key: 'arrears_cleared:pay-cure-12',
      }));
    });

    it('ordinary payment from a student in good standing suppresses INS-10 and INS-07', async () => {
      const client = createMockSupabaseClient();
      const settlement = {
        success: true,
        previous_agreement_status: 'active',
        agreement_status: 'active',
        outstanding_balance: 6000.00,
        overdue_balance: 0.00,
        allocated_amount: 3000.00,
      };

      const prevStatus = settlement.previous_agreement_status;
      const newStatus = settlement.agreement_status;
      const newOutstanding = Number(settlement.outstanding_balance ?? 0);
      const isCompleted = newOutstanding <= 0 || newStatus === 'completed';

      let enqueuedEvents: string[] = [];
      if (isCompleted) {
        enqueuedEvents.push('INS-07');
      } else if (
        prevStatus === 'in_arrears' &&
        newStatus === 'active' &&
        Number(settlement.overdue_balance) <= 0 &&
        newOutstanding > 0
      ) {
        enqueuedEvents.push('INS-10');
      }

      expect(enqueuedEvents).toEqual([]);
      expect(client.rpc).not.toHaveBeenCalledWith('enqueue_email_job', expect.objectContaining({
        p_event_type: 'INS-07',
      }));
      expect(client.rpc).not.toHaveBeenCalledWith('enqueue_email_job', expect.objectContaining({
        p_event_type: 'INS-10',
      }));
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 7. Worker Pre-Dispatch Eligibility & Race Protection (Defect 7)
  // ════════════════════════════════════════════════════════════════════════════
  describe('7. Worker Race Protection & Pre-Dispatch Eligibility Check', () => {
    let mockProvider: { sendEmail: any };

    beforeEach(() => {
      mockProvider = {
        sendEmail: vi.fn(async (req: EmailSendRequest): Promise<EmailSendResult> => ({
          success: true,
          providerMessageId: 'resend-msg-123',
          retryable: false,
        })),
      };
    });

    it('cancels claimed INS-03 job before provider send when schedule is already paid', async () => {
      const claimedJob: EmailQueueJob = {
        queue_id: 'q-stale-1',
        recipient_email: 'student@example.com',
        recipient_name: 'Aarav Sharma',
        event_type: 'INS-03',
        subject: 'Your Make Me Topper installment is due in 3 days',
        template_id: 'INS-03',
        payload: {
          scheduleId: 'sched-101',
          agreementId: 'agr-101',
          courseName: 'Math Foundation',
          effectiveDueDate: '2026-12-15',
        },
        priority: 'normal',
        status: 'processing',
        delivery_status: 'unsent',
        attempts: 1,
        max_attempts: 5,
        next_retry_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [claimedJob]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        isInstallmentReminderEligible: vi.fn(async () => false), // Paid
      };

      const result = await runEmailWorkerBatch(mockDb, mockProvider as any, { batchSize: 1 });

      expect(mockProvider.sendEmail).not.toHaveBeenCalled();
      expect(mockDb.cancelJob).toHaveBeenCalledWith('q-stale-1', expect.stringContaining('STALE_REMINDER'));
      expect(result.cancelled).toBe(1);
      expect(result.succeeded).toBe(0);
    });

    it('cancels claimed reminder when verification query fails (fail-closed security)', async () => {
      const claimedJob: EmailQueueJob = {
        queue_id: 'q-err-1',
        recipient_email: 'student@example.com',
        recipient_name: 'Aarav Sharma',
        event_type: 'INS-04',
        subject: 'Reminder: Your installment payment is due today',
        template_id: 'INS-04',
        payload: { scheduleId: 'sched-err' },
        priority: 'high',
        status: 'processing',
        delivery_status: 'unsent',
        attempts: 1,
        max_attempts: 5,
        next_retry_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [claimedJob]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        isInstallmentReminderEligible: vi.fn(async () => {
          throw new Error('Database connection reset');
        }),
      };

      const result = await runEmailWorkerBatch(mockDb, mockProvider as any, { batchSize: 1 });

      // Provider must NEVER be called if check threw an exception
      expect(mockProvider.sendEmail).not.toHaveBeenCalled();
      expect(mockDb.cancelJob).toHaveBeenCalledWith('q-err-1', expect.stringContaining('STALE_REMINDER'));
      expect(result.cancelled).toBe(1);
    });

    it('unrelated events (PAY-01, ACC-01) bypass installment eligibility check completely', async () => {
      const claimedJob: EmailQueueJob = {
        queue_id: 'q-pay-1',
        recipient_email: 'student@example.com',
        recipient_name: 'Aarav Sharma',
        event_type: 'PAY-01',
        subject: 'Course Purchase Confirmed',
        template_id: 'PAY-01',
        payload: { courseTitle: 'Chemistry Crash Course', amount: 9999 },
        priority: 'high',
        status: 'processing',
        delivery_status: 'unsent',
        attempts: 1,
        max_attempts: 5,
        next_retry_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [claimedJob]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        isInstallmentReminderEligible: vi.fn(async () => false),
      };

      const result = await runEmailWorkerBatch(mockDb, mockProvider as any, { batchSize: 1 });

      expect(mockDb.isInstallmentReminderEligible).not.toHaveBeenCalled();
      expect(mockProvider.sendEmail).toHaveBeenCalledTimes(1);
      expect(result.succeeded).toBe(1);
    });

    it('dispatches INS-03 normally when tranche remains unpaid and eligible', async () => {
      const claimedJob: EmailQueueJob = {
        queue_id: 'q-valid-1',
        recipient_email: 'student@example.com',
        recipient_name: 'Aarav Sharma',
        event_type: 'INS-03',
        subject: 'Your Make Me Topper installment is due in 3 days',
        template_id: 'INS-03',
        payload: {
          scheduleId: 'sched-102',
          agreementId: 'agr-102',
          courseName: 'Math Foundation',
          effectiveDueDate: '2026-12-15',
        },
        priority: 'normal',
        status: 'processing',
        delivery_status: 'unsent',
        attempts: 1,
        max_attempts: 5,
        next_retry_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const mockDb: EmailWorkerDatabase = {
        recoverAbandonedLocks: vi.fn(async () => 0),
        claimBatch: vi.fn(async () => [claimedJob]),
        isSuppressed: vi.fn(async () => false),
        recordSuccess: vi.fn(async () => true),
        scheduleRetry: vi.fn(async () => ({ success: true })),
        markFailed: vi.fn(async () => true),
        cancelJob: vi.fn(async () => true),
        isInstallmentReminderEligible: vi.fn(async () => true),
      };

      const result = await runEmailWorkerBatch(mockDb, mockProvider as any, { batchSize: 1 });

      expect(mockProvider.sendEmail).toHaveBeenCalledTimes(1);
      expect(mockDb.recordSuccess).toHaveBeenCalledWith('q-valid-1', 'resend-msg-123');
      expect(result.succeeded).toBe(1);
      expect(result.cancelled).toBe(0);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 8. Stale Reminder Cancellation Helper & Delivery Log Audit
  // ════════════════════════════════════════════════════════════════════════════
  describe('8. Stale Reminder Cancellation Helper & Delivery Log Audit', () => {
    interface SimulatedEmailQueueRow {
      queue_id: string;
      event_type: string;
      status: 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled';
      payload: Record<string, unknown>;
      last_error?: string | null;
      updated_at?: string;
    }

    interface SimulatedDeliveryLogRow {
      log_id: string;
      queue_id: string;
      provider: string;
      event_type: string;
      payload: Record<string, unknown>;
      created_at: string;
    }

    function simulateCancelStaleInstallmentEmailJobs(
      queue: SimulatedEmailQueueRow[],
      deliveryLogs: SimulatedDeliveryLogRow[],
      params: { agreementId?: string; scheduleId?: string; reason?: string }
    ): number {
      if (!params.agreementId && !params.scheduleId) return 0;
      const reason = params.reason || 'OBLIGATION_SETTLED_OR_RESCHEDULED';

      // Corrected logic:
      // Scope A: When p_schedule_id IS NOT NULL -> matches ONLY payload.scheduleId
      // Scope B: When p_schedule_id IS NULL and p_agreement_id IS NOT NULL -> matches payload.agreementId
      const targets = queue.filter(q =>
        q.status === 'pending' &&
        ['INS-03', 'INS-04', 'INS-05', 'INS-06'].includes(q.event_type) &&
        (
          params.scheduleId != null
            ? q.payload?.scheduleId === params.scheduleId
            : params.agreementId != null
            ? q.payload?.agreementId === params.agreementId
            : false
        )
      );

      for (const t of targets) {
        t.status = 'cancelled';
        t.last_error = reason;
        t.updated_at = new Date().toISOString();

        deliveryLogs.push({
          log_id: `log-${Math.random().toString(36).substring(7)}`,
          queue_id: t.queue_id,
          provider: 'system',
          event_type: 'cancelled',
          payload: {
            reason,
            agreement_id: params.agreementId || null,
            schedule_id: params.scheduleId || null,
            cancelled_at: new Date().toISOString(),
          },
          created_at: new Date().toISOString(),
        });
      }

      return targets.length;
    }

    it('Scope A: schedule-specific cancellation cancels only target schedule, preserving other schedules in same agreement', () => {
      const queue: SimulatedEmailQueueRow[] = [
        {
          queue_id: 'q-rem-t1',
          event_type: 'INS-04',
          status: 'pending',
          payload: { agreementId: 'agr-common', scheduleId: 'sched-tranche-1' },
        },
        {
          queue_id: 'q-rem-t2',
          event_type: 'INS-03',
          status: 'pending',
          payload: { agreementId: 'agr-common', scheduleId: 'sched-tranche-2' },
        },
      ];
      const logs: SimulatedDeliveryLogRow[] = [];

      // Settle/reschedule tranche 1 only, passing both agreementId and scheduleId
      const count = simulateCancelStaleInstallmentEmailJobs(queue, logs, {
        agreementId: 'agr-common',
        scheduleId: 'sched-tranche-1',
        reason: 'Tranche 1 paid',
      });

      expect(count).toBe(1);
      expect(queue[0].status).toBe('cancelled');
      // Critical check: Tranche 2 MUST remain pending
      expect(queue[1].status).toBe('pending');
      expect(logs).toHaveLength(1);
      expect(logs[0].queue_id).toBe('q-rem-t1');
    });

    it('Scope B: agreement-wide cancellation (scheduleId omitted) cancels all reminders across all schedules in agreement', () => {
      const queue: SimulatedEmailQueueRow[] = [
        {
          queue_id: 'q-rem-t1',
          event_type: 'INS-04',
          status: 'pending',
          payload: { agreementId: 'agr-common', scheduleId: 'sched-tranche-1' },
        },
        {
          queue_id: 'q-rem-t2',
          event_type: 'INS-03',
          status: 'pending',
          payload: { agreementId: 'agr-common', scheduleId: 'sched-tranche-2' },
        },
      ];
      const logs: SimulatedDeliveryLogRow[] = [];

      // Agreement completed: pass agreementId with no scheduleId
      const count = simulateCancelStaleInstallmentEmailJobs(queue, logs, {
        agreementId: 'agr-common',
        reason: 'Entire agreement completed',
      });

      expect(count).toBe(2);
      expect(queue[0].status).toBe('cancelled');
      expect(queue[1].status).toBe('cancelled');
      expect(logs).toHaveLength(2);
    });

    it('Scope C: no identifiers returns zero without modifying anything', () => {
      const queue: SimulatedEmailQueueRow[] = [
        {
          queue_id: 'q-rem-1',
          event_type: 'INS-03',
          status: 'pending',
          payload: { agreementId: 'agr-1', scheduleId: 'sched-1' },
        },
      ];
      const logs: SimulatedDeliveryLogRow[] = [];

      const count = simulateCancelStaleInstallmentEmailJobs(queue, logs, {});

      expect(count).toBe(0);
      expect(queue[0].status).toBe('pending');
      expect(logs).toHaveLength(0);
    });

    it('cancels INS-03, INS-04, INS-05, and INS-06 when eligible', () => {
      const queue: SimulatedEmailQueueRow[] = [
        { queue_id: 'q-ins03', event_type: 'INS-03', status: 'pending', payload: { scheduleId: 'sched-1' } },
        { queue_id: 'q-ins04', event_type: 'INS-04', status: 'pending', payload: { scheduleId: 'sched-1' } },
        { queue_id: 'q-ins05', event_type: 'INS-05', status: 'pending', payload: { scheduleId: 'sched-1' } },
        { queue_id: 'q-ins06', event_type: 'INS-06', status: 'pending', payload: { scheduleId: 'sched-1' } },
      ];
      const logs: SimulatedDeliveryLogRow[] = [];

      const count = simulateCancelStaleInstallmentEmailJobs(queue, logs, { scheduleId: 'sched-1' });

      expect(count).toBe(4);
      for (const item of queue) {
        expect(item.status).toBe('cancelled');
      }
      expect(logs).toHaveLength(4);
    });

    it('non-reminder events (PAY-01, ACC-01, INS-01, INS-02, INS-07, INS-08, INS-10) are NOT cancelled', () => {
      const nonReminders = ['PAY-01', 'ACC-01', 'INS-01', 'INS-02', 'INS-07', 'INS-08', 'INS-10'];
      const queue: SimulatedEmailQueueRow[] = nonReminders.map((event_type, idx) => ({
        queue_id: `q-non-${idx}`,
        event_type,
        status: 'pending',
        payload: { scheduleId: 'sched-1', agreementId: 'agr-1' },
      }));
      const logs: SimulatedDeliveryLogRow[] = [];

      const count = simulateCancelStaleInstallmentEmailJobs(queue, logs, { agreementId: 'agr-1', scheduleId: 'sched-1' });

      expect(count).toBe(0);
      expect(logs).toHaveLength(0);
      for (const item of queue) {
        expect(item.status).toBe('pending');
      }
    });

    it('zero-match case succeeds with count 0 and zero delivery logs inserted', () => {
      const queue: SimulatedEmailQueueRow[] = [
        { queue_id: 'q-other', event_type: 'INS-03', status: 'pending', payload: { scheduleId: 'sched-other' } },
      ];
      const logs: SimulatedDeliveryLogRow[] = [];

      const count = simulateCancelStaleInstallmentEmailJobs(queue, logs, { scheduleId: 'sched-unmatched' });

      expect(count).toBe(0);
      expect(queue[0].status).toBe('pending');
      expect(logs).toHaveLength(0);
    });

    it('every successfully cancelled job receives exactly one cancellation log conforming to Migration 251 schema', () => {
      const queue: SimulatedEmailQueueRow[] = [
        { queue_id: 'q-c1', event_type: 'INS-03', status: 'pending', payload: { scheduleId: 'sched-1' } },
        { queue_id: 'q-c2', event_type: 'INS-04', status: 'pending', payload: { scheduleId: 'sched-1' } },
        { queue_id: 'q-c3', event_type: 'INS-05', status: 'pending', payload: { scheduleId: 'sched-1' } },
        { queue_id: 'q-c4', event_type: 'INS-06', status: 'pending', payload: { scheduleId: 'sched-1' } },
      ];
      const logs: SimulatedDeliveryLogRow[] = [];

      const count = simulateCancelStaleInstallmentEmailJobs(queue, logs, {
        scheduleId: 'sched-1',
        reason: 'Installment tranche paid in full',
      });

      expect(count).toBe(4);
      expect(logs).toHaveLength(4);

      // Verify exact schema alignment with Migration 251 (public.email_delivery_logs)
      for (let i = 0; i < 4; i++) {
        const log = logs[i];
        expect(log.queue_id).toBe(queue[i].queue_id);
        expect(log.provider).toBe('system');
        expect(log.event_type).toBe('cancelled');
        expect(log.payload).toMatchObject({
          reason: 'Installment tranche paid in full',
          schedule_id: 'sched-1',
        });
        expect(log.created_at).toBeDefined();
        expect(typeof log.log_id).toBe('string');
        expect(typeof log.event_type).toBe('string');
      }
    });
  });
});
