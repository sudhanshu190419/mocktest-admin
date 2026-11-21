/**
 * Make Me Topper — Transactional Email Queue Reconciliation Service
 *
 * Implements a safe, idempotent reconciliation mechanism for transactions
 * where primary database fulfillment committed (enrollment, order, payment)
 * but the subsequent non-transactional email enqueue step failed, timed out,
 * or terminated abruptly.
 *
 * Safety Principles:
 *  1. Strict Activation Boundary: Records created PRIOR to activationTimestamp
 *     are STRICTLY IGNORED. This eliminates any risk of spamming historical users.
 *  2. No Hardcoded Fallback: EMAIL_INTEGRATION_ACTIVATION_TIMESTAMP must be
 *     explicitly configured. If missing or invalid, reconciliation FAILS CLOSED
 *     and returns a disabled summary without scanning or mutating any records.
 *  3. Shared Canonical Idempotency: Uses identical keys ('course_enrolled:<id>',
 *     'pyq_purchase:<id>') ensuring zero duplicate jobs or emails.
 *  4. Non-blocking & Resilient: Individual reconciliation failures are isolated
 *     and recorded without aborting the batch.
 */

import { enqueueEmailSafe } from './enqueue.ts';

export type ReconciliationClient = any;

export interface ReconciliationOptions {
  activationTimestamp?: string | Date | null;
  limit?: number;
  batchSize?: number;
}

export interface ReconciliationSummary {
  disabled?: boolean;
  disabledReason?: string;
  scanned: number;
  alreadyQueued: number;
  reconciled: number;
  skipped: number;
  errors: Array<{ id: string; error: string }>;
}

function getActivationEnv(): string | undefined {
  if (typeof (globalThis as any).Deno !== 'undefined' && (globalThis as any).Deno.env) {
    return (globalThis as any).Deno.env.get('EMAIL_INTEGRATION_ACTIVATION_TIMESTAMP');
  }
  if (typeof process !== 'undefined' && process.env) {
    return process.env['EMAIL_INTEGRATION_ACTIVATION_TIMESTAMP'];
  }
  return undefined;
}

/**
 * Authoritatively resolves and validates the activation timestamp.
 * Returns a valid Date object, or null if unconfigured (fail-closed disabled state).
 * Throws an explicit Error if an invalid, non-ISO timestamp string or invalid Date is provided.
 */
export function parseActivationTimestamp(input?: string | Date | null): Date | null {
  const raw = input !== undefined ? input : getActivationEnv();
  if (raw === null || raw === undefined) {
    return null;
  }
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) {
      throw new Error('Invalid activation timestamp: Date object is NaN.');
    }
    return raw;
  }
  if (typeof raw !== 'string' || raw.trim() === '') {
    return null;
  }
  const trimmed = raw.trim();
  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) {
    throw new Error(`Invalid activation timestamp provided: '${trimmed}'. Must be a valid ISO 8601 timestamp string.`);
  }
  return parsed;
}

/**
 * Reconciles unqueued Course Enrollments created at or after activationTimestamp.
 * Fails closed if activation timestamp is not explicitly provided.
 */
export async function reconcileUnqueuedCourseEnrollments(
  supabase: ReconciliationClient,
  options: ReconciliationOptions = {}
): Promise<ReconciliationSummary> {
  const activationDate = parseActivationTimestamp(options.activationTimestamp);
  if (!activationDate) {
    return {
      disabled: true,
      disabledReason: 'Reconciliation is disabled: EMAIL_INTEGRATION_ACTIVATION_TIMESTAMP is not configured. Historical backfill is blocked.',
      scanned: 0,
      alreadyQueued: 0,
      reconciled: 0,
      skipped: 0,
      errors: [],
    };
  }

  const limit = options.limit || 100;

  const summary: ReconciliationSummary = {
    scanned: 0,
    alreadyQueued: 0,
    reconciled: 0,
    skipped: 0,
    errors: [],
  };

  // 1. Fetch active enrollments created on or after activation date
  const { data: enrollments, error: enrError } = await supabase
    .from('course_enrollments')
    .select(`
      enrollment_id,
      course_id,
      student_id,
      enrolled_at,
      order_item_id,
      courses (
        title
      ),
      student_details (
        profile_id,
        enrollment_no
      )
    `)
    .gte('enrolled_at', activationDate.toISOString())
    .eq('is_active', true)
    .order('enrolled_at', { ascending: true })
    .limit(limit);

  if (enrError) {
    summary.errors.push({ id: 'fetch_course_enrollments', error: enrError.message });
    return summary;
  }

  if (!enrollments || enrollments.length === 0) {
    return summary;
  }

  summary.scanned = enrollments.length;

  // 2. Check each enrollment against email_queue idempotency keys
  for (const enr of enrollments) {
    try {
      const idempotencyKey = `course_enrolled:${enr.enrollment_id}`;

      // Check existing queue job
      const { data: existingJob } = await supabase
        .from('email_queue')
        .select('queue_id, status')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();

      if (existingJob) {
        summary.alreadyQueued++;
        continue;
      }

      // Resolve student profile
      const studentDetails = Array.isArray(enr.student_details)
        ? enr.student_details[0]
        : enr.student_details;
      const profileId = studentDetails?.profile_id;
      const enrollmentNo = studentDetails?.enrollment_no || 'Active';

      if (!profileId) {
        summary.skipped++;
        summary.errors.push({
          id: enr.enrollment_id,
          error: 'Missing profile_id for student details',
        });
        continue;
      }

      const courseData = Array.isArray(enr.courses) ? enr.courses[0] : enr.courses;
      const courseTitle = courseData?.title || 'Enrolled Course';

      // Resolve order total amount if order_item_id exists
      let orderAmount = 0;
      let orderId = 'N/A';
      if (enr.order_item_id) {
        const { data: itemData } = await supabase
          .from('order_items')
          .select('order_id, price')
          .eq('item_id', enr.order_item_id)
          .maybeSingle();
        if (itemData) {
          orderId = itemData.order_id || 'N/A';
          orderAmount = Number(itemData.price || 0);
        }
      }

      // Safely enqueue missing PAY-01 job
      const enqueueRes = await enqueueEmailSafe(supabase, {
        recipientProfileId: profileId,
        studentId: enr.student_id,
        eventType: 'PAY-01',
        subject: `Order Confirmed: ${courseTitle} — Make Me Topper`,
        templateId: 'PAY-01',
        payload: {
          courseName: courseTitle,
          enrollmentNumber: enrollmentNo,
          orderId,
          amount: orderAmount,
          purchaseDate: new Date(enr.enrolled_at).toLocaleDateString('en-IN', {
            dateStyle: 'medium',
          }),
        },
        priority: 'high',
        idempotencyKey,
      });

      if (enqueueRes.success) {
        summary.reconciled++;
      } else {
        summary.errors.push({
          id: enr.enrollment_id,
          error: enqueueRes.error || 'Failed to enqueue reconciliation email',
        });
      }
    } catch (itemErr: any) {
      summary.errors.push({
        id: enr.enrollment_id,
        error: itemErr instanceof Error ? itemErr.message : String(itemErr),
      });
    }
  }

  return summary;
}

/**
 * Reconciles unqueued PYQ Package Purchases created at or after activationTimestamp.
 * Fails closed if activation timestamp is not explicitly provided.
 */
export async function reconcileUnqueuedPyqPurchases(
  supabase: ReconciliationClient,
  options: ReconciliationOptions = {}
): Promise<ReconciliationSummary> {
  const activationDate = parseActivationTimestamp(options.activationTimestamp);
  if (!activationDate) {
    return {
      disabled: true,
      disabledReason: 'Reconciliation is disabled: EMAIL_INTEGRATION_ACTIVATION_TIMESTAMP is not configured. Historical backfill is blocked.',
      scanned: 0,
      alreadyQueued: 0,
      reconciled: 0,
      skipped: 0,
      errors: [],
    };
  }

  const limit = options.limit || 100;

  const summary: ReconciliationSummary = {
    scanned: 0,
    alreadyQueued: 0,
    reconciled: 0,
    skipped: 0,
    errors: [],
  };

  // 1. Fetch active PYQ purchases created on or after activation date
  const { data: purchases, error: pyqError } = await supabase
    .from('student_pyq_purchases')
    .select(`
      purchase_id,
      package_id,
      student_id,
      purchased_at,
      order_item_id,
      pyq_packages (
        name
      ),
      student_details (
        profile_id
      )
    `)
    .gte('purchased_at', activationDate.toISOString())
    .eq('is_active', true)
    .order('purchased_at', { ascending: true })
    .limit(limit);

  if (pyqError) {
    summary.errors.push({ id: 'fetch_pyq_purchases', error: pyqError.message });
    return summary;
  }

  if (!purchases || purchases.length === 0) {
    return summary;
  }

  summary.scanned = purchases.length;

  // 2. Check each purchase against email_queue idempotency keys
  for (const pur of purchases) {
    try {
      const idempotencyKey = `pyq_purchase:${pur.purchase_id}`;

      // Check existing queue job
      const { data: existingJob } = await supabase
        .from('email_queue')
        .select('queue_id, status')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();

      if (existingJob) {
        summary.alreadyQueued++;
        continue;
      }

      const studentDetails = Array.isArray(pur.student_details)
        ? pur.student_details[0]
        : pur.student_details;
      const profileId = studentDetails?.profile_id;

      if (!profileId) {
        summary.skipped++;
        summary.errors.push({
          id: pur.purchase_id,
          error: 'Missing profile_id for student details',
        });
        continue;
      }

      const packageData = Array.isArray(pur.pyq_packages) ? pur.pyq_packages[0] : pur.pyq_packages;
      const packageName = packageData?.name || 'PYQ Package Access';

      let orderAmount = 0;
      let orderId = 'N/A';
      if (pur.order_item_id) {
        const { data: itemData } = await supabase
          .from('order_items')
          .select('order_id, price')
          .eq('item_id', pur.order_item_id)
          .maybeSingle();
        if (itemData) {
          orderId = itemData.order_id || 'N/A';
          orderAmount = Number(itemData.price || 0);
        }
      }

      const enqueueRes = await enqueueEmailSafe(supabase, {
        recipientProfileId: profileId,
        studentId: pur.student_id,
        eventType: 'PAY-02',
        subject: `Access Granted: ${packageName} — Make Me Topper`,
        templateId: 'PAY-02',
        payload: {
          packageName,
          purchaseId: pur.purchase_id,
          orderId,
          amount: orderAmount,
          purchaseDate: new Date(pur.purchased_at).toLocaleDateString('en-IN', {
            dateStyle: 'medium',
          }),
        },
        priority: 'high',
        idempotencyKey,
      });

      if (enqueueRes.success) {
        summary.reconciled++;
      } else {
        summary.errors.push({
          id: pur.purchase_id,
          error: enqueueRes.error || 'Failed to enqueue reconciliation email',
        });
      }
    } catch (itemErr: any) {
      summary.errors.push({
        id: pur.purchase_id,
        error: itemErr instanceof Error ? itemErr.message : String(itemErr),
      });
    }
  }

  return summary;
}

/**
 * Executes full reconciliation across courses and PYQ packages.
 * Fails closed if activation timestamp is not explicitly provided.
 */
export async function reconcileAllUnqueuedTransactions(
  supabase: ReconciliationClient,
  options: ReconciliationOptions = {}
): Promise<{
  disabled?: boolean;
  disabledReason?: string;
  courses: ReconciliationSummary;
  pyq: ReconciliationSummary;
  totalReconciled: number;
}> {
  const activationDate = parseActivationTimestamp(options.activationTimestamp);
  if (!activationDate) {
    const disabledSummary: ReconciliationSummary = {
      disabled: true,
      disabledReason: 'Reconciliation is disabled: EMAIL_INTEGRATION_ACTIVATION_TIMESTAMP is not configured. Historical backfill is blocked.',
      scanned: 0,
      alreadyQueued: 0,
      reconciled: 0,
      skipped: 0,
      errors: [],
    };
    return {
      disabled: true,
      disabledReason: disabledSummary.disabledReason,
      courses: disabledSummary,
      pyq: disabledSummary,
      totalReconciled: 0,
    };
  }

  const courses = await reconcileUnqueuedCourseEnrollments(supabase, options);
  const pyq = await reconcileUnqueuedPyqPurchases(supabase, options);

  return {
    courses,
    pyq,
    totalReconciled: courses.reconciled + pyq.reconciled,
  };
}
