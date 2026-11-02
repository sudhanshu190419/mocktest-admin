// ============================================================================
// Edge Function: complete-installment-purchase
//
// PostgreSQL 16 | Supabase Edge Runtime | Production Ready
//
// Orchestrates installment activation and database settlement after a
// verified Razorpay payment capture. This is an internal-only function
// callable strictly by the razorpay-webhook using service-role credentials.
//
// Architectural Responsibilities:
//   1. Verifies service-role authentication (Authorization header)
//   2. Validates request body (planId, orderId, profileId, paymentId)
//   3. Upgrades profile role from 'user' to 'student' (idempotent)
//   4. Ensures student_details row exists (create_student_after_purchase RPC)
//   5. Resolves or inserts student_course_agreements (status='pending_initial_payment')
//   6. Validates context and establishes order linkages (orders.student_id & order_items.agreement_id) pre-settlement
//   7. Invokes public.process_installment_payment() with internal payments.payment_id UUID
//   8. Calls syncCourseEnrollment() with enrollment_type = 'subscription'
//   9. Returns discriminated result: 'success' | 'requires_review' | 'error'
//
// @module edge-functions/complete-installment-purchase
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { syncCourseEnrollment } from '../_shared/courseEnrollment.ts';
import { isServiceRoleCall } from '../_shared/serviceRoleAuth.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  planId: string;
  orderId: string;
  profileId: string;
  paymentId: string; // Internal payments.payment_id UUID
  guardianName?: string | null;
  guardianMobile?: string | null;
  guardianEmail?: string | null;
  targetYear?: string | null;
  dob?: string | null;
  internal?: boolean;
}

interface SuccessResponse {
  success: true;
  status: 'success';
  studentId: string;
  agreementId: string;
  enrollmentId?: string;
  settlement: Record<string, unknown>;
}

interface ReviewResponse {
  success: false;
  status: 'requires_review';
  reason: string;
  details?: string;
  agreementId?: string;
}

interface ErrorResponse {
  success: false;
  status: 'error';
  error: string;
  details?: string;
}

type FunctionResponse = SuccessResponse | ReviewResponse | ErrorResponse;

function jsonResponse(body: FunctionResponse, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

function structuredLog(event: string, data: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      level: 'info',
      timestamp: new Date().toISOString(),
      service: 'complete-installment-purchase',
      event,
      ...data,
    }),
  );
}

function structuredError(event: string, data: Record<string, unknown>): void {
  console.error(
    JSON.stringify({
      level: 'error',
      timestamp: new Date().toISOString(),
      service: 'complete-installment-purchase',
      event,
      ...data,
    }),
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  // 1. Enforce Service-Role Authorization
  const authHeader = req.headers.get('Authorization');
  const srCheck = isServiceRoleCall(authHeader);
  if (!srCheck.ok) {
    structuredError('AUTH_REJECTED', { ...srCheck });
    return jsonResponse(
      { success: false, status: 'error', error: 'Unauthorized: internal service-role required' },
      403,
    );
  }

  let body: RequestBody;
  try {
    const raw = await req.json();
    body = {
      planId: raw.planId,
      orderId: raw.orderId,
      profileId: raw.profileId,
      paymentId: raw.paymentId,
      guardianName: raw.guardianName ?? null,
      guardianMobile: raw.guardianMobile ?? null,
      guardianEmail: raw.guardianEmail ?? null,
      targetYear: raw.targetYear ?? null,
      dob: raw.dob ?? null,
      internal: raw.internal === true,
    };

    if (!body.planId || !body.orderId || !body.profileId || !body.paymentId) {
      return jsonResponse(
        { success: false, status: 'error', error: 'Missing required parameters (planId, orderId, profileId, paymentId)' },
        400,
      );
    }
  } catch (_e) {
    return jsonResponse({ success: false, status: 'error', error: 'Invalid JSON body' }, 400);
  }

  structuredLog('FULFILLMENT_STARTED', {
    orderId: body.orderId,
    planId: body.planId,
    profileId: body.profileId,
    paymentId: body.paymentId,
  });

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 2. Upgrade profile role from 'user' to 'student'
  const { data: profileRow, error: profileError } = await serviceClient
    .from('profiles')
    .select('role')
    .eq('profile_id', body.profileId)
    .single();

  if (profileError || !profileRow) {
    return jsonResponse({ success: false, status: 'error', error: 'Profile not found' }, 404);
  }

  if (profileRow.role === 'user') {
    await serviceClient
      .from('profiles')
      .update({ role: 'student' })
      .eq('profile_id', body.profileId);
  }

  // 3. Ensure student_details row exists
  const { data: existingStudent } = await serviceClient
    .from('student_details')
    .select('student_id')
    .eq('profile_id', body.profileId)
    .maybeSingle();

  let studentId: string | null = existingStudent?.student_id ?? null;

  if (!studentId) {
    structuredLog('CREATING_STUDENT_RECORD', { profileId: body.profileId });
    const { data: rpcResult, error: rpcError } = await serviceClient.rpc(
      'create_student_after_purchase',
      {
        p_profile_id: body.profileId,
        p_guardian_name: body.guardianName,
        p_guardian_mobile: body.guardianMobile,
        p_guardian_email: body.guardianEmail,
        p_target_year: body.targetYear,
        p_dob: body.dob,
      },
    );

    if (rpcError) {
      structuredError('CREATE_STUDENT_FAILED', { error: rpcError.message });
      return jsonResponse(
        { success: false, status: 'error', error: `Student onboarding failed: ${rpcError.message}` },
        500,
      );
    }

    const parsedResult = typeof rpcResult === 'string' ? JSON.parse(rpcResult) : rpcResult;
    studentId = parsedResult?.student_id;
    if (!studentId) {
      return jsonResponse(
        { success: false, status: 'error', error: 'Failed to obtain student_id from onboarding RPC' },
        500,
      );
    }
  }

  // 4. Load & Validate Installment Plan
  const { data: plan, error: planError } = await serviceClient
    .from('course_installment_plans')
    .select('plan_id, course_id, plan_name, total_fee, number_of_installments, interval_months, is_active')
    .eq('plan_id', body.planId)
    .single();

  if (planError || !plan) {
    return jsonResponse(
      { success: false, status: 'requires_review', reason: 'PLAN_NOT_FOUND', details: planError?.message },
      200,
    );
  }

  const courseId = plan.course_id;

  // Resolve institute_id from course
  const { data: courseRow } = await serviceClient
    .from('courses')
    .select('institute_id')
    .eq('course_id', courseId)
    .single();

  const instituteId = courseRow?.institute_id;
  if (!instituteId) {
    return jsonResponse(
      { success: false, status: 'error', error: 'Course missing institute association' },
      500,
    );
  }

  // 5. Resolve or Insert Student Course Agreement
  const { data: existingAgreement } = await serviceClient
    .from('student_course_agreements')
    .select('agreement_id, plan_id, agreement_status, total_fee, requires_admin_review')
    .eq('student_id', studentId)
    .eq('course_id', courseId)
    .maybeSingle();

  let agreementId: string;

  if (existingAgreement) {
    // Conflict detection: does the existing agreement reference a different plan?
    if (existingAgreement.plan_id !== plan.plan_id) {
      structuredError('AGREEMENT_PLAN_CONFLICT', {
        studentId,
        courseId,
        existingPlanId: existingAgreement.plan_id,
        paymentPlanId: plan.plan_id,
      });

      return jsonResponse(
        {
          success: false,
          status: 'requires_review',
          reason: 'PAYMENT_ON_SUPERSEDED_ORDER_CONFLICT',
          details: `Student already has an agreement under Plan ${existingAgreement.plan_id}, but payment was captured for Plan ${plan.plan_id}.`,
          agreementId: existingAgreement.agreement_id,
        },
        200,
      );
    }

    agreementId = existingAgreement.agreement_id;
    structuredLog('REUSING_EXISTING_AGREEMENT', { agreementId });
  } else {
    // Plan active check for new agreement creation
    if (!plan.is_active) {
      structuredError('PLAN_INACTIVE_FOR_NEW_AGREEMENT', { planId: plan.plan_id });
      return jsonResponse(
        {
          success: false,
          status: 'requires_review',
          reason: 'PLAN_DEACTIVATED_IN_FLIGHT',
          details: 'Installment plan was deactivated before agreement could be created.',
        },
        200,
      );
    }

    // Insert new agreement in pending_initial_payment status
    const { data: newAgreement, error: insertAgrError } = await serviceClient
      .from('student_course_agreements')
      .insert({
        student_id: studentId,
        course_id: courseId,
        plan_id: plan.plan_id,
        total_fee: plan.total_fee,
        outstanding_balance: plan.total_fee,
        overdue_balance: 0.00,
        agreement_status: 'pending_initial_payment',
      })
      .select('agreement_id')
      .single();

    if (insertAgrError || !newAgreement) {
      structuredError('AGREEMENT_INSERT_FAILED', { error: insertAgrError?.message });
      return jsonResponse(
        {
          success: false,
          status: 'requires_review',
          reason: 'AGREEMENT_CREATION_FAILED',
          details: insertAgrError?.message,
        },
        200,
      );
    }

    agreementId = newAgreement.agreement_id;
    structuredLog('AGREEMENT_CREATED', { agreementId });
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 6: Validate Context & Establish Pre-Settlement Order Linkages
  // ═════════════════════════════════════════════════════════════════════
  // The settlement RPC (public.process_installment_payment) joins orders
  // and order_items to verify payment context and synchronize student_subscriptions.
  // Establishing the verified student_id on orders and agreement_id on order_items
  // prior to settlement prevents NULL student constraint violations and ensures
  // atomic idempotency on retries.

  // 6a. Load authoritative order record and validate student context
  const { data: orderRow, error: orderFetchErr } = await serviceClient
    .from('orders')
    .select('order_id, student_id, institute_id, status')
    .eq('order_id', body.orderId)
    .single();

  if (orderFetchErr || !orderRow) {
    structuredError('ORDER_FETCH_FAILED', {
      orderId: body.orderId,
      error: orderFetchErr?.message,
    });
    return jsonResponse(
      { success: false, status: 'error', error: `Order ${body.orderId} not found: ${orderFetchErr?.message}` },
      500,
    );
  }

  // Fail closed if orders.student_id already has a value that mismatches resolved studentId
  if (orderRow.student_id && orderRow.student_id !== studentId) {
    structuredError('ORDER_STUDENT_MISMATCH', {
      orderId: body.orderId,
      existingStudentId: orderRow.student_id,
      resolvedStudentId: studentId,
    });
    return jsonResponse(
      {
        success: false,
        status: 'requires_review',
        reason: 'ORDER_STUDENT_MISMATCH',
        details: `Order belongs to student ${orderRow.student_id}, but fulfillment resolved student ${studentId}.`,
        agreementId,
      },
      200,
    );
  }

  // 6b. Load matching installment order item and validate course & plan context
  const { data: orderItems, error: itemsFetchErr } = await serviceClient
    .from('order_items')
    .select('item_id, item_type, course_id, installment_plan_id, agreement_id')
    .eq('order_id', body.orderId)
    .eq('item_type', 'installment');

  if (itemsFetchErr) {
    structuredError('INSTALLMENT_ORDER_ITEM_FETCH_FAILED', {
      orderId: body.orderId,
      error: itemsFetchErr.message,
      code: itemsFetchErr.code,
      details: itemsFetchErr.details,
    });
    return jsonResponse(
      {
        success: false,
        status: 'error',
        error: `Database error querying installment item for order ${body.orderId}: ${itemsFetchErr.message}`,
      },
      500,
    );
  }

  if (!orderItems || orderItems.length === 0) {
    structuredError('INSTALLMENT_ORDER_ITEM_NOT_FOUND', {
      orderId: body.orderId,
    });
    return jsonResponse(
      { success: false, status: 'error', error: `No installment item found for order ${body.orderId}` },
      500,
    );
  }

  const installmentItem = orderItems[0];

  // Validate course alignment
  if (installmentItem.course_id && installmentItem.course_id !== courseId) {
    structuredError('ORDER_ITEM_COURSE_MISMATCH', {
      orderId: body.orderId,
      itemCourseId: installmentItem.course_id,
      planCourseId: courseId,
    });
    return jsonResponse(
      {
        success: false,
        status: 'requires_review',
        reason: 'ORDER_COURSE_MISMATCH',
        details: `Order item course ${installmentItem.course_id} does not match plan course ${courseId}.`,
        agreementId,
      },
      200,
    );
  }

  // Validate plan alignment if specified on the order item
  if (installmentItem.installment_plan_id && installmentItem.installment_plan_id !== plan.plan_id) {
    structuredError('ORDER_ITEM_PLAN_MISMATCH', {
      orderId: body.orderId,
      itemPlanId: installmentItem.installment_plan_id,
      paymentPlanId: plan.plan_id,
    });
    return jsonResponse(
      {
        success: false,
        status: 'requires_review',
        reason: 'ORDER_PLAN_MISMATCH',
        details: `Order item plan ${installmentItem.installment_plan_id} does not match agreement plan ${plan.plan_id}.`,
        agreementId,
      },
      200,
    );
  }

  // Idempotent agreement linkage check:
  // If already linked to a DIFFERENT agreement, fail closed for admin review.
  // If already linked to the same agreement, reuse that link.
  if (installmentItem.agreement_id && installmentItem.agreement_id !== agreementId) {
    structuredError('ORDER_ITEM_AGREEMENT_CONFLICT', {
      orderId: body.orderId,
      existingAgreementId: installmentItem.agreement_id,
      resolvedAgreementId: agreementId,
    });
    return jsonResponse(
      {
        success: false,
        status: 'requires_review',
        reason: 'ORDER_ITEM_AGREEMENT_CONFLICT',
        details: `Order item is already linked to agreement ${installmentItem.agreement_id}; cannot overwrite with ${agreementId}.`,
        agreementId: installmentItem.agreement_id,
      },
      200,
    );
  }

  // 6c. Update orders.student_id where NULL
  if (!orderRow.student_id) {
    const { error: updateOrderErr } = await serviceClient
      .from('orders')
      .update({ student_id: studentId })
      .eq('order_id', body.orderId)
      .is('student_id', null);

    if (updateOrderErr) {
      structuredError('ORDER_STUDENT_LINK_FAILED', {
        orderId: body.orderId,
        studentId,
        error: updateOrderErr.message,
      });
      return jsonResponse(
        { success: false, status: 'error', error: `Failed to link student to order: ${updateOrderErr.message}` },
        500,
      );
    }

    structuredLog('ORDER_STUDENT_LINKED_PRE_SETTLEMENT', {
      orderId: body.orderId,
      studentId,
    });
  }

  // 6d. Link matching installment order_items row to agreement_id if not already linked
  if (!installmentItem.agreement_id) {
    const { error: updateItemErr } = await serviceClient
      .from('order_items')
      .update({ agreement_id: agreementId })
      .eq('item_id', installmentItem.item_id)
      .is('agreement_id', null);

    if (updateItemErr) {
      structuredError('ORDER_ITEM_AGREEMENT_LINK_FAILED', {
        orderItemId: installmentItem.item_id,
        agreementId,
        error: updateItemErr.message,
      });
      return jsonResponse(
        { success: false, status: 'error', error: `Failed to link agreement to order item: ${updateItemErr.message}` },
        500,
      );
    }

    structuredLog('ORDER_ITEM_AGREEMENT_LINKED_PRE_SETTLEMENT', {
      orderItemId: installmentItem.item_id,
      agreementId,
    });
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 7: Execute Database Settlement Engine (public.process_installment_payment)
  // ═════════════════════════════════════════════════════════════════════
  structuredLog('INVOKING_SETTLEMENT_ENGINE', {
    paymentId: body.paymentId,
    agreementId,
  });

  const { data: settlementResult, error: settlementRpcError } = await serviceClient.rpc(
    'process_installment_payment',
    {
      p_payment_id: body.paymentId,
      p_agreement_id: agreementId,
    },
  );

  if (settlementRpcError) {
    structuredError('SETTLEMENT_RPC_ERROR', { error: settlementRpcError.message });
    return jsonResponse(
      {
        success: false,
        status: 'error',
        error: `Settlement RPC error: ${settlementRpcError.message}`,
      },
      500,
    );
  }

  const parsedSettlement = typeof settlementResult === 'string'
    ? JSON.parse(settlementResult)
    : settlementResult;

  if (!parsedSettlement?.success) {
    structuredError('SETTLEMENT_FAILED', { result: parsedSettlement });
    if (parsedSettlement?.requires_admin_review) {
      return jsonResponse(
        {
          success: false,
          status: 'requires_review',
          reason: parsedSettlement.code ?? 'SETTLEMENT_REVIEW_REQUIRED',
          details: parsedSettlement.error,
          agreementId,
        },
        200,
      );
    }

    return jsonResponse(
      {
        success: false,
        status: 'error',
        error: parsedSettlement?.error ?? 'Installment payment processing failed',
      },
      500,
    );
  }

  structuredLog('SETTLEMENT_SUCCEEDED', {
    allocatedAmount: parsedSettlement.allocated_amount,
    outstandingBalance: parsedSettlement.outstanding_balance,
    consecutiveMilestone: parsedSettlement.consecutively_funded_milestone,
  });

  // 8. Synchronize Course Enrollment (Phase 11I.2 pattern: subscription type, NOT purchase)
  // Note: order linkages (orders.student_id & order_items.agreement_id) were validated
  // and established pre-settlement in Step 6.
  const enrollResult = await syncCourseEnrollment(serviceClient, {
    studentId,
    courseId,
    instituteId,
    enrollmentType: 'subscription', // Retains subscription semantics; NEVER permanent purchase
  });

  structuredLog('ENROLLMENT_SYNC_COMPLETE', {
    enrollResult,
    note: 'Course visible on student home screen; batch_students not touched (manual admin batch assignment retained)',
  });

  return jsonResponse({
    success: true,
    status: 'success',
    studentId,
    agreementId,
    enrollmentId: enrollResult?.enrollmentId,
    settlement: parsedSettlement,
  });
});
