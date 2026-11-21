/**
 * Make Me Topper — Transactional Email System (Phase 2)
 *
 * Automated Test Suite for Commerce & Financial Email Integration:
 *
 * 1. Template Rendering & Content Truthfulness:
 *    - PAY-01: Course Purchase Confirmed (live-class batch truthfulness, enrollment number)
 *    - PAY-02: PYQ Package Purchase Confirmed (immediate access)
 *    - PAY-03: Payment Failed (reassuring bank refund advisory, retry link)
 *    - PAY-04: Refund Processed (refund reference, 5-7 day timeline)
 *    - PAY-05: Payment Received — Under Verification ("DO NOT PAY AGAIN", 24h review)
 *    - PAY-06: Entitlement Revoked (App Store revocation notice)
 *    - INS-01: Initial Installment Paid (initial payment, agreement breakdown, next due date)
 *    - INS-02: Subsequent Installment Paid (subsequent payment, milestone, full completion upgrade)
 *
 * 2. Safe Enqueue Service (enqueueEmailSafe):
 *    - Server-side email resolution from profile_id
 *    - Server-side email resolution from student_id
 *    - Graceful bypass for missing or invalid email addresses (never throws)
 *    - Strict error isolation (RPC error or client exceptions never crash caller)
 *    - Idempotency key enforcement & deduplication
 *
 * 3. Payment Safety & Financial Invariance:
 *    - Guaranteed transaction safety: email failure NEVER aborts purchase or enrollment.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  escapeHtml,
  formatCurrency,
  htmlToPlainText,
  renderEmail,
  renderCoursePurchaseConfirmedEmail,
  renderPyqPurchaseConfirmedEmail,
  renderPaymentFailedEmail,
  renderRefundProcessedEmail,
  renderPaymentUnderVerificationEmail,
  renderEntitlementRevokedEmail,
  renderInstallmentInitialPaidEmail,
  renderInstallmentSubsequentPaidEmail,
} from '../../../../supabase/functions/_shared/email/templates';

import {
  enqueueEmailSafe,
  MinimalSupabaseClient,
} from '../../../../supabase/functions/_shared/email/enqueue';

import {
  reconcileUnqueuedCourseEnrollments,
  reconcileUnqueuedPyqPurchases,
  reconcileAllUnqueuedTransactions,
  parseActivationTimestamp,
} from '../../../../supabase/functions/_shared/email/reconciliation';

// ── Mock Supabase Client Factory ─────────────────────────────────────────────
function createMockSupabaseClient(overrides?: {
  profiles?: Record<string, { email?: string; name?: string }>;
  students?: Record<string, { profile_id?: string }>;
  rpcResult?: { data: any; error: any };
  rpcHook?: (fn: string, args: Record<string, unknown>) => { data: any; error: any };
}): MinimalSupabaseClient {
  const profiles = overrides?.profiles || {};
  const students = overrides?.students || {};

  return {
    from: (table: string) => {
      let selectedCol = '';
      let filterCol = '';
      let filterVal: unknown = null;

      return {
        select: (col: string) => {
          selectedCol = col;
          return {
            eq: (colName: string, val: unknown) => {
              filterCol = colName;
              filterVal = val;
              return {
                maybeSingle: async () => {
                  if (table === 'profiles') {
                    const row = profiles[String(filterVal)];
                    return { data: row || null, error: null };
                  }
                  if (table === 'student_details') {
                    const row = students[String(filterVal)];
                    return { data: row || null, error: null };
                  }
                  return { data: null, error: null };
                },
                single: async () => {
                  if (table === 'profiles') {
                    const row = profiles[String(filterVal)];
                    if (!row) return { data: null, error: { message: 'Row not found' } };
                    return { data: row, error: null };
                  }
                  if (table === 'student_details') {
                    const row = students[String(filterVal)];
                    if (!row) return { data: null, error: { message: 'Row not found' } };
                    return { data: row, error: null };
                  }
                  return { data: null, error: { message: 'Not found' } };
                },
              };
            },
          };
        },
      };
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (overrides?.rpcHook) {
        return overrides.rpcHook(fn, args);
      }
      if (overrides?.rpcResult) {
        return overrides.rpcResult;
      }
      return {
        data: { success: true, queue_id: 'mock-q-' + Math.random().toString(36).substring(7), status: 'enqueued' },
        error: null,
      };
    },
  };
}

describe('Phase 2: Commerce & Financial Email Templates', () => {
  const context = {
    recipientEmail: 'rahul.sharma@example.com',
    recipientName: 'Rahul Sharma',
  };

  describe('PAY-01: Course Purchase Confirmed', () => {
    it('renders course confirmation with accurate product truth on batch allocation', () => {
      const payload = {
        courseName: 'Complete Physics Masterclass 2026',
        enrollmentNumber: 'MMT-PHY-2026-0042',
        orderId: 'ord_rzp_987654321',
        amount: 4999,
        currency: 'INR',
        purchaseDate: '20 Nov 2026',
      };

      const email = renderCoursePurchaseConfirmedEmail(payload, context);

      expect(email.subject).toBe('Order Confirmed: Complete Physics Masterclass 2026 — Make Me Topper');
      expect(email.html).toContain('Rahul Sharma');
      expect(email.html).toContain('Complete Physics Masterclass 2026');
      expect(email.html).toContain('MMT-PHY-2026-0042');
      expect(email.html).toContain('ord_rzp_987654321');
      expect(email.html).toContain('₹4,999.00');

      // Product truth requirement: must NOT promise immediate live-class/timetable access
      expect(email.html).toContain('Timetables and live-class batch assignments are scheduled');
      expect(email.html).toContain('academic team');
      expect(email.html).toContain('https://makemetopper.com/student/courses');
      expect(email.text).toContain('Complete Physics Masterclass 2026');
      expect(email.text).toContain('MMT-PHY-2026-0042');
    });

    it('sanitizes malicious scripts and attributes in payload', () => {
      const payload = {
        courseName: '<script>alert("hacked")</script>Advanced Chemistry',
        enrollmentNumber: '<img src=x onerror=alert(1)>',
        orderId: '"><script>alert(2)</script>',
      };

      const email = renderCoursePurchaseConfirmedEmail(payload, context);
      expect(email.html).not.toContain('<script>');
      expect(email.html).toContain('&lt;script&gt;');
      expect(email.html).not.toContain('<img src=x');
    });

    it('routes correctly through main renderEmail with aliases', () => {
      const payload = { courseName: 'Test Course' };
      const e1 = renderEmail('PAY-01', payload, context);
      const e2 = renderEmail('course_purchase_confirmed', payload, context);
      const e3 = renderEmail('course-purchased', payload, context);

      expect(e1.subject).toBe(e2.subject);
      expect(e2.subject).toBe(e3.subject);
      expect(e1.subject).toContain('Test Course');
    });
  });

  describe('PAY-02: PYQ Package Purchase Confirmed', () => {
    it('renders PYQ package purchase confirmation and CTA link', () => {
      const payload = {
        packageName: 'NEET 15 Years Chapterwise PYQ Pack',
        purchaseId: 'pyq_pur_11223344',
        orderId: 'ord_pyq_889900',
        amount: 899,
      };

      const email = renderPyqPurchaseConfirmedEmail(payload, context);

      expect(email.subject).toBe('Access Granted: NEET 15 Years Chapterwise PYQ Pack — Make Me Topper');
      expect(email.html).toContain('NEET 15 Years Chapterwise PYQ Pack');
      expect(email.html).toContain('pyq_pur_11223344');
      expect(email.html).toContain('ord_pyq_889900');
      expect(email.html).toContain('₹899.00');
      expect(email.html).toContain('https://makemetopper.com/student/pyq');
      expect(email.text).toContain('pyq_pur_11223344');
    });
  });

  describe('PAY-03: Payment Failed', () => {
    it('renders reassuring tone, failure reason, and bank refund guidance', () => {
      const payload = {
        itemTitle: 'Target JEE Advanced Crash Course',
        amount: 2999,
        gatewayPaymentId: 'pay_fail_776655',
        failureReason: 'Card issuer declined transaction due to daily limit',
      };

      const email = renderPaymentFailedEmail(payload, context);

      expect(email.subject).toBe('Payment Unsuccessful — Make Me Topper');
      expect(email.html).toContain('Payment Not Completed');
      expect(email.html).toContain('Target JEE Advanced Crash Course');
      expect(email.html).toContain('pay_fail_776655');
      expect(email.html).toContain('₹2,999.00');
      expect(email.html).toContain('Card issuer declined transaction due to daily limit');
      // Bank refund guidance: neutral advisory, no guaranteed refund
      expect(email.html).toContain('5 to 7 business days');
      expect(email.html).toContain('typically released or reversed');
      expect(email.html).not.toContain('will automatically be refunded');
      expect(email.html).toContain('Retry Payment');
      expect(email.text).toContain('5 to 7 business days');
      expect(email.text).not.toContain('will automatically be refunded');
    });
  });

  describe('PAY-04: Refund Processed', () => {
    it('renders refund confirmation with reference ID and processing timeline', () => {
      const payload = {
        itemTitle: 'Target JEE Advanced Course',
        refundId: 'rfnd_rzp_44556677',
        orderId: 'ord_123456789',
        amount: 2999,
        refundDate: '20 Nov 2026',
      };

      const email = renderRefundProcessedEmail(payload, context);

      expect(email.subject).toBe('Refund Processed — Make Me Topper');
      expect(email.html).toContain('rfnd_rzp_44556677');
      expect(email.html).toContain('₹2,999.00');
      expect(email.html).toContain('5 to 7 business days');
      expect(email.html).toContain('support@inovoxy.com');
      expect(email.text).toContain('rfnd_rzp_44556677');
    });
  });

  describe('PAY-05: Payment Received — Under Verification', () => {
    it('renders DO NOT PAY AGAIN warning and 24-hour verification window', () => {
      const payload = {
        orderId: 'ord_review_998877',
        itemTitle: 'Comprehensive Biology Foundation',
        amount: 3499,
        gatewayPaymentId: 'pay_rzp_554433',
      };

      const email = renderPaymentUnderVerificationEmail(payload, context);

      expect(email.subject).toBe('We Received Your Payment — Verification in Progress');
      expect(email.html).toContain('PLEASE DO NOT PAY AGAIN');
      expect(email.html).toContain('captured and securely received');
      expect(email.html).toContain('ord_review_998877');
      expect(email.html).toContain('pay_rzp_554433');
      expect(email.html).toContain('24 hours');
      expect(email.text).toContain('PLEASE DO NOT PAY AGAIN');
    });
  });

  describe('PAY-06: Entitlement Revoked', () => {
    it('renders notice of Apple App Store revocation with support link', () => {
      const payload = {
        productName: 'Full Mock Test Pass (iOS)',
        transactionId: 'apple_tx_2000000123456789',
        revokedDate: '20 Nov 2026',
      };

      const email = renderEntitlementRevokedEmail(payload, context);

      expect(email.subject).toBe('Access Update: Full Mock Test Pass (iOS) — Make Me Topper');
      expect(email.html).toContain('Full Mock Test Pass (iOS)');
      expect(email.html).toContain('apple_tx_2000000123456789');
      expect(email.html).toContain('App Store revocation notice');
      expect(email.html).toContain('mailto:support@inovoxy.com');
      expect(email.text).toContain('apple_tx_2000000123456789');
    });
  });

  describe('INS-01: Initial Installment Paid', () => {
    it('renders installment agreement activation and financial breakdown', () => {
      const payload = {
        courseName: 'Two-Year NEET Achiever Batch',
        agreementId: 'agr_inst_112233',
        initialAmount: 5000,
        totalFee: 20000,
        outstandingBalance: 15000,
        nextDueDate: '20 Dec 2026',
      };

      const email = renderInstallmentInitialPaidEmail(payload, context);

      expect(email.subject).toBe('Installment Plan Activated: Two-Year NEET Achiever Batch — Make Me Topper');
      expect(email.html).toContain('agr_inst_112233');
      expect(email.html).toContain('₹5,000.00');
      expect(email.html).toContain('₹20,000.00');
      expect(email.html).toContain('₹15,000.00');
      expect(email.html).toContain('20 Dec 2026');
      expect(email.html).toContain('academic team');
      expect(email.html).toContain('https://makemetopper.com/student/installments');
      expect(email.text).toContain('agr_inst_112233');
    });
  });

  describe('INS-02: Subsequent Installment Paid', () => {
    it('renders subsequent installment payment with milestone number and remaining balance', () => {
      const payload = {
        courseName: 'Two-Year NEET Achiever Batch',
        paymentId: 'pay_rzp_inst_223344',
        installmentNumber: 2,
        amount: 5000,
        outstandingBalance: 10000,
        nextDueDate: '20 Jan 2027',
        isCompleted: false,
      };

      const email = renderInstallmentSubsequentPaidEmail(payload, context);

      expect(email.subject).toBe('Installment Payment Received: Two-Year NEET Achiever Batch — Make Me Topper');
      expect(email.html).toContain('Installment #2');
      expect(email.html).toContain('pay_rzp_inst_223344');
      expect(email.html).toContain('₹5,000.00');
      expect(email.html).toContain('₹10,000.00');
      expect(email.html).toContain('20 Jan 2027');
      expect(email.text).toContain('Installment #2');
    });

    it('renders celebratory plan completion and batch allocation disclaimer when balance is zero', () => {
      const payload = {
        courseName: 'Two-Year NEET Achiever Batch',
        paymentId: 'pay_rzp_final_99',
        installmentNumber: 4,
        amount: 5000,
        outstandingBalance: 0,
        isCompleted: true,
      };

      const email = renderInstallmentSubsequentPaidEmail(payload, context);

      expect(email.html).toContain('All Installments Completed!');
      expect(email.html).toContain('Installment Plan Complete:');
      expect(email.html).toContain('Note on Batch &amp; Live Classes:');
      expect(email.html).toContain('managed and allocated by the academic team');
      expect(email.html).not.toContain('permanent full ownership');
      expect(email.html).toContain('₹0.00 (Fully Paid)');
      expect(email.text).toContain('All Installments Completed!');
      expect(email.text).toContain('Installment Plan Complete:');
      expect(email.text).not.toContain('permanent full ownership');
    });
  });
});

describe('Phase 2: Safe Enqueue Service (enqueueEmailSafe)', () => {
  it('successfully enqueues when recipient email is provided directly', async () => {
    let capturedArgs: Record<string, unknown> | null = null;
    const client = createMockSupabaseClient({
      rpcHook: (fn, args) => {
        capturedArgs = args;
        return { data: { success: true, queue_id: 'q-test-123', status: 'enqueued' }, error: null };
      },
    });

    const result = await enqueueEmailSafe(client, {
      recipientEmail: 'direct@student.com',
      recipientName: 'Direct Student',
      eventType: 'PAY-01',
      subject: 'Order Confirmed',
      templateId: 'PAY-01',
      payload: { courseName: 'Math 101' },
      priority: 'high',
      idempotencyKey: 'course_enrolled:enroll-123',
    });

    expect(result.success).toBe(true);
    expect(result.queueId).toBe('q-test-123');
    expect(capturedArgs).not.toBeNull();
    expect(capturedArgs!['p_recipient_email']).toBe('direct@student.com');
    expect(capturedArgs!['p_idempotency_key']).toBe('course_enrolled:enroll-123');
    expect(capturedArgs!['p_event_type']).toBe('PAY-01');
    expect(capturedArgs!['p_priority']).toBe('high');
  });

  it('resolves email and name server-side from profile_id', async () => {
    const profileId = '11111111-2222-3333-4444-555555555555';
    let capturedEmail = '';

    const client = createMockSupabaseClient({
      profiles: {
        [profileId]: { email: 'resolved.profile@makemetopper.com', name: 'Profile Student' },
      },
      rpcHook: (_fn, args) => {
        capturedEmail = args['p_recipient_email'] as string;
        return { data: { success: true, queue_id: 'q-resolved-profile', status: 'enqueued' }, error: null };
      },
    });

    const result = await enqueueEmailSafe(client, {
      recipientProfileId: profileId,
      eventType: 'PAY-02',
      subject: 'PYQ Confirmed',
      templateId: 'PAY-02',
      payload: {},
      idempotencyKey: 'pyq_purchase:pur-456',
    });

    expect(result.success).toBe(true);
    expect(capturedEmail).toBe('resolved.profile@makemetopper.com');
  });

  it('resolves email and name server-side via student_id -> profile_id link', async () => {
    const studentId = '22222222-3333-4444-5555-666666666666';
    const profileId = '33333333-4444-5555-6666-777777777777';
    let capturedEmail = '';
    let capturedName = '';

    const client = createMockSupabaseClient({
      students: {
        [studentId]: { profile_id: profileId },
      },
      profiles: {
        [profileId]: { email: 'student.via.link@makemetopper.com', name: 'Linked Student' },
      },
      rpcHook: (_fn, args) => {
        capturedEmail = args['p_recipient_email'] as string;
        capturedName = args['p_recipient_name'] as string;
        return { data: { success: true, queue_id: 'q-student-link', status: 'enqueued' }, error: null };
      },
    });

    const result = await enqueueEmailSafe(client, {
      studentId,
      eventType: 'INS-01',
      subject: 'Installment Active',
      templateId: 'INS-01',
      payload: {},
      idempotencyKey: 'inst_init:agr-789',
    });

    expect(result.success).toBe(true);
    expect(capturedEmail).toBe('student.via.link@makemetopper.com');
    expect(capturedName).toBe('Linked Student');
  });

  it('gracefully skips without throwing if recipient email cannot be resolved', async () => {
    const client = createMockSupabaseClient({
      profiles: {},
      students: {},
    });

    const result = await enqueueEmailSafe(client, {
      recipientProfileId: 'non-existent-profile-id',
      eventType: 'PAY-03',
      subject: 'Payment Failed',
      templateId: 'PAY-03',
      payload: {},
    });

    // Must return skipped: true and success: true so caller does NOT abort
    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain('No valid recipient email');
  });

  it('handles database RPC errors gracefully without throwing', async () => {
    const client = createMockSupabaseClient({
      rpcResult: { data: null, error: { message: 'Database connection timeout' } },
    });

    const result = await enqueueEmailSafe(client, {
      recipientEmail: 'test@makemetopper.com',
      eventType: 'PAY-04',
      subject: 'Refund',
      templateId: 'PAY-04',
      payload: {},
      idempotencyKey: 'pay_refund:rfnd-123',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Database connection timeout');
  });

  it('handles unexpected exceptions (network/syntax error) gracefully without throwing', async () => {
    const client = {
      from: () => {
        throw new Error('Fatal socket failure');
      },
      rpc: async () => {
        throw new Error('Fatal RPC failure');
      },
    } as unknown as MinimalSupabaseClient;

    const result = await enqueueEmailSafe(client, {
      recipientEmail: 'student@example.com',
      eventType: 'PAY-05',
      subject: 'Review',
      templateId: 'PAY-05',
      payload: {},
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Fatal RPC failure');
  });
});

describe('Phase 2: Payment Safety & Financial Invariance', () => {
  it('guarantees financial transaction completion even when email queueing completely fails', async () => {
    let orderFulfilled = false;
    let enrollmentCreated = false;

    // Simulate failing Supabase RPC
    const failingEmailClient = createMockSupabaseClient({
      rpcResult: { data: null, error: { message: 'email_queue table is locked' } },
    });

    // Simulate core fulfillment function logic
    async function completeMockPurchase(client: MinimalSupabaseClient) {
      // 1. Core financial operations
      orderFulfilled = true;
      enrollmentCreated = true;

      // 2. Email notification (non-blocking)
      const emailResult = await enqueueEmailSafe(client, {
        recipientEmail: 'student@example.com',
        eventType: 'PAY-01',
        subject: 'Course Purchased',
        templateId: 'PAY-01',
        payload: { courseName: 'Physics 101' },
      });

      return {
        success: true,
        orderFulfilled,
        enrollmentCreated,
        emailDispatched: emailResult.success,
      };
    }

    const result = await completeMockPurchase(failingEmailClient);

    expect(result.success).toBe(true);
    expect(result.orderFulfilled).toBe(true);
    expect(result.enrollmentCreated).toBe(true);
    expect(result.emailDispatched).toBe(false); // Email failed, but transaction succeeded!
  });

  it('idempotently returns existing job when same key is submitted twice', async () => {
    const submittedKeys: string[] = [];
    const client = createMockSupabaseClient({
      rpcHook: (_fn, args) => {
        const key = args['p_idempotency_key'] as string;
        if (submittedKeys.includes(key)) {
          return { data: { success: true, queue_id: 'q-existing', status: 'existing' }, error: null };
        }
        submittedKeys.push(key);
        return { data: { success: true, queue_id: 'q-new-1', status: 'enqueued' }, error: null };
      },
    });

    const res1 = await enqueueEmailSafe(client, {
      recipientEmail: 'student@example.com',
      eventType: 'PAY-01',
      subject: 'Test',
      templateId: 'PAY-01',
      payload: {},
      idempotencyKey: 'course_enrolled:enrollment-uuid-99',
    });

    const res2 = await enqueueEmailSafe(client, {
      recipientEmail: 'student@example.com',
      eventType: 'PAY-01',
      subject: 'Test',
      templateId: 'PAY-01',
      payload: {},
      idempotencyKey: 'course_enrolled:enrollment-uuid-99',
    });

    expect(res1.status).toBe('enqueued');
    expect(res2.status).toBe('existing');
  });

  describe('Phase 2: Apple & Google Play In-App Purchase Integration', () => {
    it('enqueues PAY-01 course confirmation with canonical idempotency key for Apple purchases', async () => {
      let capturedArgs: Record<string, unknown> | null = null;
      const client = createMockSupabaseClient({
        rpcHook: (fn, args) => {
          if (fn === 'enqueue_email_job') {
            capturedArgs = args;
            return { data: { success: true, queue_id: 'q-apple-course', status: 'enqueued' }, error: null };
          }
          return { data: null, error: null };
        },
      });

      const enrollmentId = 'enr-apple-uuid-1122';
      const profileId = 'prof-ios-user-1';

      const res = await enqueueEmailSafe(client, {
        recipientProfileId: profileId,
        recipientEmail: 'ios.student@example.com',
        studentId: 'stud-ios-1',
        eventType: 'PAY-01',
        subject: 'Order Confirmed: Masterclass Physics — Make Me Topper',
        templateId: 'PAY-01',
        payload: {
          courseName: 'Masterclass Physics',
          enrollmentNumber: 'Active',
          orderId: 'ord_apple_778899',
          amount: 2999,
          purchaseDate: '20 Nov 2026',
        },
        priority: 'high',
        idempotencyKey: `course_enrolled:${enrollmentId}`,
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe('enqueued');
      expect(capturedArgs).not.toBeNull();
      expect(capturedArgs!['p_idempotency_key']).toBe(`course_enrolled:${enrollmentId}`);
      expect(capturedArgs!['p_event_type']).toBe('PAY-01');
    });

    it('enqueues PAY-02 PYQ package confirmation with canonical idempotency key for Apple purchases', async () => {
      let capturedArgs: Record<string, unknown> | null = null;
      const client = createMockSupabaseClient({
        rpcHook: (fn, args) => {
          if (fn === 'enqueue_email_job') {
            capturedArgs = args;
            return { data: { success: true, queue_id: 'q-apple-pyq', status: 'enqueued' }, error: null };
          }
          return { data: null, error: null };
        },
      });

      const purchaseId = 'pur-apple-uuid-3344';

      const res = await enqueueEmailSafe(client, {
        recipientEmail: 'ios.student@example.com',
        eventType: 'PAY-02',
        subject: 'Access Granted: NEET PYQ 10-Year — Make Me Topper',
        templateId: 'PAY-02',
        payload: {
          packageName: 'NEET PYQ 10-Year',
          purchaseId,
          orderId: 'ord_apple_5566',
          amount: 499,
          purchaseDate: '20 Nov 2026',
        },
        priority: 'high',
        idempotencyKey: `pyq_purchase:${purchaseId}`,
      });

      expect(res.success).toBe(true);
      expect(capturedArgs!['p_idempotency_key']).toBe(`pyq_purchase:${purchaseId}`);
      expect(capturedArgs!['p_event_type']).toBe('PAY-02');
    });

    it('enqueues PAY-01 course confirmation for Google Play purchases with canonical key', async () => {
      let capturedArgs: Record<string, unknown> | null = null;
      const client = createMockSupabaseClient({
        rpcHook: (fn, args) => {
          if (fn === 'enqueue_email_job') {
            capturedArgs = args;
            return { data: { success: true, queue_id: 'q-play-course', status: 'enqueued' }, error: null };
          }
          return { data: null, error: null };
        },
      });

      const enrollmentId = 'enr-play-uuid-5566';

      const res = await enqueueEmailSafe(client, {
        recipientEmail: 'android.student@example.com',
        studentId: 'stud-android-1',
        eventType: 'PAY-01',
        subject: 'Order Confirmed: Complete Chemistry — Make Me Topper',
        templateId: 'PAY-01',
        payload: {
          courseName: 'Complete Chemistry',
          enrollmentNumber: 'Active',
          orderId: 'GPA.1234-5678-9012',
          amount: 3499,
          purchaseDate: '20 Nov 2026',
        },
        priority: 'high',
        idempotencyKey: `course_enrolled:${enrollmentId}`,
      });

      expect(res.success).toBe(true);
      expect(capturedArgs!['p_idempotency_key']).toBe(`course_enrolled:${enrollmentId}`);
    });

    it('enqueues PAY-02 PYQ package confirmation for Google Play purchases with canonical key', async () => {
      let capturedArgs: Record<string, unknown> | null = null;
      const client = createMockSupabaseClient({
        rpcHook: (fn, args) => {
          if (fn === 'enqueue_email_job') {
            capturedArgs = args;
            return { data: { success: true, queue_id: 'q-play-pyq', status: 'enqueued' }, error: null };
          }
          return { data: null, error: null };
        },
      });

      const purchaseId = 'pur-play-uuid-7788';

      const res = await enqueueEmailSafe(client, {
        recipientEmail: 'android.student@example.com',
        eventType: 'PAY-02',
        subject: 'Access Granted: JEE Advanced PYQ — Make Me Topper',
        templateId: 'PAY-02',
        payload: {
          packageName: 'JEE Advanced PYQ',
          purchaseId,
          orderId: 'GPA.9876-5432-1098',
          amount: 599,
          purchaseDate: '20 Nov 2026',
        },
        priority: 'high',
        idempotencyKey: `pyq_purchase:${purchaseId}`,
      });

      expect(res.success).toBe(true);
      expect(capturedArgs!['p_idempotency_key']).toBe(`pyq_purchase:${purchaseId}`);
    });
  });

  describe('Phase 2: Cross-Provider Idempotency & Deduplication', () => {
    it('deduplicates across Razorpay, Apple, and Google Play using canonical enrollment key', async () => {
      const queueLog: Array<{ key: string; provider: string; status: string }> = [];
      const existingKeys = new Set<string>();

      const createGatewayClient = (gateway: string) => {
        return createMockSupabaseClient({
          rpcHook: (_fn, args) => {
            const key = args['p_idempotency_key'] as string;
            if (existingKeys.has(key)) {
              queueLog.push({ key, provider: gateway, status: 'existing' });
              return { data: { success: true, queue_id: 'q-existing', status: 'existing' }, error: null };
            }
            existingKeys.add(key);
            queueLog.push({ key, provider: gateway, status: 'enqueued' });
            return { data: { success: true, queue_id: 'q-' + gateway, status: 'enqueued' }, error: null };
          },
        });
      };

      const sharedEnrollmentId = 'canonical-shared-enrollment-uuid';
      const canonicalKey = `course_enrolled:${sharedEnrollmentId}`;

      // 1. Razorpay checkout completes and enqueues
      const razorpayClient = createGatewayClient('razorpay');
      const r1 = await enqueueEmailSafe(razorpayClient, {
        recipientEmail: 'student@example.com',
        eventType: 'PAY-01',
        subject: 'Order Confirmed',
        templateId: 'PAY-01',
        payload: { courseName: 'Target Course' },
        idempotencyKey: canonicalKey,
      });

      // 2. Client re-verifies or sends from Apple StoreKit
      const appleClient = createGatewayClient('apple');
      const r2 = await enqueueEmailSafe(appleClient, {
        recipientEmail: 'student@example.com',
        eventType: 'PAY-01',
        subject: 'Order Confirmed',
        templateId: 'PAY-01',
        payload: { courseName: 'Target Course' },
        idempotencyKey: canonicalKey,
      });

      // 3. Android Google Play verification retry
      const playClient = createGatewayClient('google_play');
      const r3 = await enqueueEmailSafe(playClient, {
        recipientEmail: 'student@example.com',
        eventType: 'PAY-01',
        subject: 'Order Confirmed',
        templateId: 'PAY-01',
        payload: { courseName: 'Target Course' },
        idempotencyKey: canonicalKey,
      });

      expect(r1.status).toBe('enqueued');
      expect(r2.status).toBe('existing');
      expect(r3.status).toBe('existing');

      expect(queueLog).toEqual([
        { key: canonicalKey, provider: 'razorpay', status: 'enqueued' },
        { key: canonicalKey, provider: 'apple', status: 'existing' },
        { key: canonicalKey, provider: 'google_play', status: 'existing' },
      ]);
    });
  });

  describe('Phase 2: Reconciliation Service (Self-Healing Unqueued Jobs)', () => {
    it('reconciles missing course enrollments created on or after activation timestamp without backfilling historical records', async () => {
      const activationDate = new Date('2026-11-20T00:00:00.000Z');
      const recentDate = new Date('2026-11-20T12:00:00.000Z');

      const mockEnrollments = [
        {
          enrollment_id: 'enr-recent-missing',
          course_id: 'c-1',
          student_id: 's-1',
          enrolled_at: recentDate.toISOString(),
          order_item_id: 'item-1',
          is_active: true,
          courses: { title: 'Recent Course' },
          student_details: { profile_id: 'p-1', enrollment_no: 'ENR-2026-001' },
        },
        {
          enrollment_id: 'enr-recent-already-queued',
          course_id: 'c-2',
          student_id: 's-2',
          enrolled_at: recentDate.toISOString(),
          order_item_id: 'item-2',
          is_active: true,
          courses: { title: 'Queued Course' },
          student_details: { profile_id: 'p-2', enrollment_no: 'ENR-2026-002' },
        },
      ];

      const existingQueueKeys = new Set(['course_enrolled:enr-recent-already-queued']);
      const newlyEnqueuedKeys: string[] = [];

      const mockClient: any = {
        from: (table: string) => {
          let appliedGteVal: string | null = null;
          let appliedEqVal: any = null;

          const builder: any = {
            select: () => builder,
            gte: (_col: string, val: string) => {
              appliedGteVal = val;
              return builder;
            },
            eq: (_col: string, val: any) => {
              appliedEqVal = val;
              return builder;
            },
            order: () => builder,
            limit: () => builder,
            maybeSingle: async () => {
              if (table === 'email_queue') {
                if (existingQueueKeys.has(appliedEqVal)) {
                  return { data: { queue_id: 'q-exists', status: 'enqueued' }, error: null };
                }
                return { data: null, error: null };
              }
              if (table === 'order_items') {
                return { data: { order_id: 'ord-reconcile-1', price: 1999 }, error: null };
              }
              if (table === 'profiles') {
                return { data: { email: 'student@example.com', name: 'Student' }, error: null };
              }
              return { data: null, error: null };
            },
          };

          builder.then = (resolve: any) => {
            if (table === 'course_enrollments') {
              const filtered = mockEnrollments.filter(e => {
                if (!appliedGteVal) return true;
                return new Date(e.enrolled_at) >= new Date(appliedGteVal);
              });
              resolve({ data: filtered, error: null });
            } else {
              resolve({ data: [], error: null });
            }
          };

          return builder;
        },
        rpc: async (_fn: string, args: Record<string, unknown>) => {
          const key = args['p_idempotency_key'] as string;
          newlyEnqueuedKeys.push(key);
          return { data: { success: true, queue_id: 'q-reconciled', status: 'enqueued' }, error: null };
        },
      };

      const summary = await reconcileUnqueuedCourseEnrollments(mockClient, {
        activationTimestamp: activationDate,
      });

      expect(summary.scanned).toBe(2);
      expect(summary.alreadyQueued).toBe(1);
      expect(summary.reconciled).toBe(1);
      expect(summary.skipped).toBe(0);
      expect(newlyEnqueuedKeys).toEqual(['course_enrolled:enr-recent-missing']);
    });

    it('fails safely when an invalid activation timestamp is supplied', () => {
      expect(() => {
        // @ts-ignore
        parseActivationTimestamp('invalid-date-string');
      }).toThrow(/Invalid activation timestamp/);

      expect(() => {
        parseActivationTimestamp(new Date('invalid'));
      }).toThrow(/Invalid activation timestamp/);
    });

    it('returns null and disables reconciliation when activation timestamp is omitted and env is unset', async () => {
      const origEnv = process.env.EMAIL_INTEGRATION_ACTIVATION_TIMESTAMP;
      delete process.env.EMAIL_INTEGRATION_ACTIVATION_TIMESTAMP;

      try {
        expect(parseActivationTimestamp()).toBeNull();
        expect(parseActivationTimestamp(null)).toBeNull();
        expect(parseActivationTimestamp('')).toBeNull();
        expect(parseActivationTimestamp('   ')).toBeNull();

        const dummyClient: any = {};
        const summary = await reconcileUnqueuedCourseEnrollments(dummyClient);

        expect(summary.disabled).toBe(true);
        expect(summary.disabledReason).toContain('EMAIL_INTEGRATION_ACTIVATION_TIMESTAMP is not configured');
        expect(summary.scanned).toBe(0);
        expect(summary.reconciled).toBe(0);

        const pyqSummary = await reconcileUnqueuedPyqPurchases(dummyClient);
        expect(pyqSummary.disabled).toBe(true);
        expect(pyqSummary.reconciled).toBe(0);

        const allSummary = await reconcileAllUnqueuedTransactions(dummyClient);
        expect(allSummary.disabled).toBe(true);
        expect(allSummary.totalReconciled).toBe(0);
      } finally {
        if (origEnv !== undefined) {
          process.env.EMAIL_INTEGRATION_ACTIVATION_TIMESTAMP = origEnv;
        }
      }
    });

    it('strictly enforces the exact activation boundary timestamp down to the millisecond', async () => {
      const boundaryIso = '2026-11-20T17:00:00.000Z';
      const boundaryDate = new Date(boundaryIso);

      const beforeTime = new Date(boundaryDate.getTime() - 1).toISOString(); // 16:59:59.999Z
      const exactTime = boundaryDate.toISOString();                          // 17:00:00.000Z
      const afterTime = new Date(boundaryDate.getTime() + 1000).toISOString(); // 17:00:01.000Z

      const mockEnrollments = [
        {
          enrollment_id: 'enr-before',
          course_id: 'c-0',
          student_id: 's-0',
          enrolled_at: beforeTime,
          is_active: true,
          courses: { title: 'Pre-Deployment Course' },
          student_details: { profile_id: 'p-0', enrollment_no: 'ENR-0' },
        },
        {
          enrollment_id: 'enr-exact',
          course_id: 'c-1',
          student_id: 's-1',
          enrolled_at: exactTime,
          is_active: true,
          courses: { title: 'Exact Deployment Course' },
          student_details: { profile_id: 'p-1', enrollment_no: 'ENR-1' },
        },
        {
          enrollment_id: 'enr-after',
          course_id: 'c-2',
          student_id: 's-2',
          enrolled_at: afterTime,
          is_active: true,
          courses: { title: 'Post-Deployment Course' },
          student_details: { profile_id: 'p-2', enrollment_no: 'ENR-2' },
        },
      ];

      const enqueuedIds: string[] = [];

      const mockClient: any = {
        from: (table: string) => {
          let gteFilter: string | null = null;
          const builder: any = {
            select: () => builder,
            gte: (_col: string, val: string) => {
              gteFilter = val;
              return builder;
            },
            eq: () => builder,
            order: () => builder,
            limit: () => builder,
            maybeSingle: async () => {
              if (table === 'email_queue') return { data: null, error: null }; // all unqueued
              if (table === 'profiles') return { data: { email: 'student@example.com', name: 'Student' }, error: null };
              return { data: null, error: null };
            },
          };

          builder.then = (resolve: any) => {
            if (table === 'course_enrollments') {
              const matched = mockEnrollments.filter(e => {
                if (!gteFilter) return true;
                return new Date(e.enrolled_at) >= new Date(gteFilter);
              });
              resolve({ data: matched, error: null });
            } else {
              resolve({ data: [], error: null });
            }
          };

          return builder;
        },
        rpc: async (_fn: string, args: Record<string, unknown>) => {
          const key = args['p_idempotency_key'] as string;
          enqueuedIds.push(key);
          return { data: { success: true, queue_id: 'q-boundary', status: 'enqueued' }, error: null };
        },
      };

      const summary = await reconcileUnqueuedCourseEnrollments(mockClient, {
        activationTimestamp: boundaryIso,
      });

      // enr-before must NOT be scanned or enqueued
      expect(summary.scanned).toBe(2);
      expect(summary.reconciled).toBe(2);
      expect(enqueuedIds).toEqual([
        'course_enrolled:enr-exact',
        'course_enrolled:enr-after',
      ]);
      expect(enqueuedIds).not.toContain('course_enrolled:enr-before');
    });
  });
});
