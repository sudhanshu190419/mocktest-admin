import { supabase } from '@/config/supabase';

declare global {
  interface Window {
    Razorpay?: any;
  }
}

export interface CreatePaymentOrderInput {
  courseId?: string;
  packageId?: string;
  planId?: string;
  conversion?: boolean;
  studentId: string;
  instituteId?: string;
}

export interface RazorpayOrderData {
  orderId: string;
  razorpayOrderId: string;
  amount: number; // in paise
  currency: string;
  courseName?: string;
  description?: string;
  razorpayKey: string;
}

export interface PaymentOrderResult {
  success: boolean;
  data?: RazorpayOrderData;
  error?: string;
  code?: 'ALREADY_SUBSCRIBED' | 'ALREADY_OWNED' | 'CONVERSION_NOT_ELIGIBLE' | 'CONVERSION_FULLY_PAID' | 'SERVER' | 'NETWORK';
}

/**
 * Dynamically loads the Razorpay checkout.js script if not already present on the page.
 */
export async function loadRazorpayScript(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (window.Razorpay) return true;

  return new Promise((resolve) => {
    const existingScript = document.getElementById('razorpay-checkout-script');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(true));
      existingScript.addEventListener('error', () => resolve(false));
      return;
    }

    const script = document.createElement('script');
    script.id = 'razorpay-checkout-script';
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

/**
 * Resolves the student_id for a given auth user profile.
 * Falls back to profileId if student_details has not been created yet.
 */
export async function resolveStudentId(profileId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from('student_details')
      .select('student_id')
      .eq('profile_id', profileId)
      .maybeSingle();

    return data?.student_id || profileId;
  } catch {
    return profileId;
  }
}

/**
 * Invokes the `create-payment-order` Supabase Edge Function to generate a verified Razorpay order.
 */
export async function createPaymentOrder(
  input: CreatePaymentOrderInput
): Promise<PaymentOrderResult> {
  try {
    const defaultInstituteId =
      input.instituteId ||
      process.env.NEXT_PUBLIC_INSTITUTE_ID ||
      'e97ebfd2-ca4d-4637-a583-1078568f1b2f';

    // Normalize planId: remove synthetic/fallback string IDs per website handoff rule
    let cleanPlanId = input.planId;
    if (cleanPlanId && (cleanPlanId.startsWith('full-course-') || !cleanPlanId.includes('-') || cleanPlanId.length < 30)) {
      cleanPlanId = undefined;
    }

    const payload: Record<string, any> = {
      studentId: input.studentId,
      instituteId: defaultInstituteId,
    };

    if (input.courseId) payload.courseId = input.courseId;
    if (input.packageId) payload.packageId = input.packageId;
    if (cleanPlanId) payload.planId = cleanPlanId;
    if (input.conversion) payload.conversion = true;

    const { data, error } = await supabase.functions.invoke('create-payment-order', {
      body: payload,
    });

    if (error) {
      // In supabase-js v2, non-2xx status returns a FunctionsHttpError with context response
      let errorBody: any = null;
      let status = 500;
      try {
        const resp = (error as any).context as Response | undefined;
        if (resp) {
          status = resp.status;
          errorBody = await resp.clone().json().catch(() => null);
        }
      } catch {
        // Fallback
      }

      const details = errorBody?.details || errorBody?.code || errorBody?.error;

      if (status === 409 || details === 'ALREADY_OWNED') {
        return {
          success: false,
          code: 'ALREADY_OWNED',
          error: 'You already have permanent access to this course.',
        };
      }
      if (details === 'ALREADY_SUBSCRIBED') {
        return {
          success: false,
          code: 'ALREADY_SUBSCRIBED',
          error: 'You already have an active subscription for this course.',
        };
      }
      if (details === 'CONVERSION_NOT_ELIGIBLE') {
        return {
          success: false,
          code: 'CONVERSION_NOT_ELIGIBLE',
          error: 'Full-course conversion is not eligible for this account.',
        };
      }
      if (details === 'CONVERSION_FULLY_PAID') {
        return {
          success: false,
          code: 'CONVERSION_FULLY_PAID',
          error: 'Your subscription spend has already covered full course ownership.',
        };
      }

      return {
        success: false,
        code: 'SERVER',
        error: errorBody?.error || errorBody?.message || error.message || 'Unable to create payment order.',
      };
    }

    if (!data || (!data.razorpayOrderId && !data.orderId && !data.razorpay_order_id)) {
      return {
        success: false,
        code: 'SERVER',
        error: 'Invalid order response received from the payment gateway.',
      };
    }

    return {
      success: true,
      data: {
        orderId: data.orderId || data.order_id,
        razorpayOrderId: data.razorpayOrderId || data.razorpay_order_id || data.orderId,
        amount: data.amount,
        currency: data.currency || 'INR',
        courseName: data.courseName || data.name,
        description: data.description,
        razorpayKey: data.razorpayKey || data.razorpay_key || 'rzp_test_MakeMeTopper',
      },
    };
  } catch (err: any) {
    return {
      success: false,
      code: 'NETWORK',
      error: err?.message || 'Network error while contacting payment service.',
    };
  }
}

/**
 * Polls `course_enrollments` for server-side grant confirmation after successful payment.
 */
export async function pollCourseEnrollment(
  courseId: string,
  studentId: string,
  timeoutMs: number = 60000,
  intervalMs: number = 2500
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const { count, error } = await supabase
        .from('course_enrollments')
        .select('enrollment_id', { count: 'exact', head: true })
        .eq('course_id', courseId)
        .eq('student_id', studentId)
        .eq('is_active', true);

      if (!error && (count ?? 0) > 0) {
        return true;
      }
    } catch {
      // Ignore polling errors and continue retry
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return false;
}

/**
 * Polls `student_pyq_purchases` for server-side grant confirmation after successful payment.
 */
export async function pollPYQEnrollment(
  packageId: string,
  studentId: string,
  timeoutMs: number = 60000,
  intervalMs: number = 2500
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const { count, error } = await supabase
        .from('student_pyq_purchases')
        .select('purchase_id', { count: 'exact', head: true })
        .eq('package_id', packageId)
        .eq('student_id', studentId)
        .eq('is_active', true);

      if (!error && (count ?? 0) > 0) {
        return true;
      }
    } catch {
      // Ignore polling errors and continue retry
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return false;
}
