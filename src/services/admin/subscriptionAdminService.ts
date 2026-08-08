/**
 * Admin Subscription Management Service
 *
 * Read-only subscription operations for the Admin Dashboard — powers the
 * Commerce → Subscriptions module (Phase 11K.8).
 *
 * Everything here is backed by live Supabase data and follows the exact
 * conventions of `commerceService.ts` (ApiResponse envelope, buildPagination,
 * buildPaginatedResponse, extractErrorMessage, joined selects).
 *
 * ## Data Sources
 *
 * | Section                 | Source Table(s)                                          |
 * |-------------------------|----------------------------------------------------------|
 * | Metrics                 | student_subscriptions, course_enrollments,              |
 * |                         | subscription_history, orders (duplicate/refund flags)   |
 * | Subscriptions           | student_subscriptions + subscription_plans + courses +  |
 * |                         | student_details → profiles                              |
 * | Permanent Owners        | course_enrollments (enrollment_type='purchase') +       |
 * |                         | courses + student_details → profiles                    |
 * | Duplicate / Refund Flags| orders.notes (JSON text written by Phase 11K.6) +       |
 * |                         | profiles                                                |
 * | Subscription Detail     | student_subscriptions + plan + course + student         |
 * | Subscription Payments   | payments → orders → order_items (plan-scoped)           |
 * | Subscription History    | subscription_history (change_reason + metadata)         |
 *
 * @module services/admin/subscriptionAdminService
 */

import { supabase } from '@/config/supabase';
import { buildPagination, extractErrorMessage } from '@/utils/supabase';
import { buildPaginatedResponse } from '@/utils/response';
import type { ApiResponse, PaginatedResponse, PaginationParams, SortDirection } from '@/types/academic';

// ═══════════════════════════════════════════════════════════════════════════
//  Types — Subscription
// ═══════════════════════════════════════════════════════════════════════════

export type SubscriptionStatus =
  | 'pending'
  | 'active'
  | 'grace'
  | 'expired'
  | 'cancelled'
  | 'refunded';

export interface SubscriptionListItem {
  subscriptionId: string;
  studentId: string;
  studentName: string | null;
  studentPhone: string | null;
  courseId: string | null;
  courseTitle: string | null;
  planId: string;
  planName: string | null;
  billingCycle: string | null;
  planPrice: number | null;
  planCurrency: string;
  status: SubscriptionStatus;
  startDate: string;
  endDate: string;
  graceEndDate: string | null;
  contentAccessEndDate: string | null;
  isTrial: boolean;
  isAutoRenew: boolean;
  orderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionFilters {
  status?: SubscriptionStatus;
  courseId?: string;
  billingCycle?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  instituteId?: string;
}

export interface SubscriptionSortOptions {
  sortBy?: 'createdAt' | 'startDate' | 'endDate' | 'status';
  sortDirection?: SortDirection;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Types — Permanent Owners
// ═══════════════════════════════════════════════════════════════════════════

export interface PermanentOwnerListItem {
  enrollmentId: string;
  studentId: string;
  studentName: string | null;
  studentPhone: string | null;
  courseId: string | null;
  courseTitle: string | null;
  enrolledAt: string;
  isActive: boolean;
}

export interface PermanentOwnerFilters {
  courseId?: string;
  search?: string;
  instituteId?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Types — Duplicate / Refund Flags (orders.notes JSON text from 11K.6)
// ═══════════════════════════════════════════════════════════════════════════

export interface FlaggedOrderListItem {
  orderId: string;
  studentName: string | null;
  studentPhone: string | null;
  totalAmount: number;
  currency: string;
  status: string;
  placedAt: string;
  duplicateOfOrderId: string | null;
  duplicateKind: string | null;
  flaggedForRefund: boolean;
  conversion: boolean;
}

export interface FlaggedOrderFilters {
  search?: string;
  instituteId?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Types — Subscription Detail
// ═══════════════════════════════════════════════════════════════════════════

export interface SubscriptionPaymentItem {
  paymentId: string;
  orderId: string;
  gatewayPaymentId: string | null;
  gatewayOrderId: string | null;
  amount: number;
  currency: string;
  status: string;
  gateway: string;
  failureReason: string | null;
  paidAt: string | null;
  refundedAt: string | null;
  refundAmount: number | null;
  createdAt: string;
  /** Phase 11K.6 duplicate-payment markers carried on the parent order. */
  duplicateOfOrderId: string | null;
  duplicateKind: string | null;
  flaggedForRefund: boolean;
}

export interface SubscriptionHistoryItem {
  historyId: string;
  changeReason: string;
  statusBefore: string | null;
  statusAfter: string | null;
  paymentReference: string | null;
  metadata: Record<string, unknown> | null;
  changedByRole: string | null;
  occurredAt: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Types — Metrics
// ═══════════════════════════════════════════════════════════════════════════

export interface SubscriptionMetrics {
  active: number;
  grace: number;
  expired: number;
  pending: number;
  permanentOwners: number;
  renewals: number;
  conversions: number;
  flaggedForRefund: number;
  duplicateOrders: number;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Types — Export + Filter dropdown
// ═══════════════════════════════════════════════════════════════════════════

/** Result of a CSV export fetch — carries the total count for truncation warnings. */
export interface ExportResult<T> {
  data: T[];
  /** Total matching rows before any export cap. */
  count: number;
}

/** Hard cap for one export fetch — the UI warns when more rows match. */
const EXPORT_PAGE_SIZE = 5000;

export interface SubscriptionCourseOption {
  courseId: string;
  title: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

const SORT_FIELD_MAP_SUBSCRIPTIONS: Record<string, string> = {
  createdAt: 'created_at',
  startDate: 'start_date',
  endDate: 'end_date',
  status: 'status',
};

function mapSubscriptionSortField(
  sortBy?: SubscriptionSortOptions['sortBy'],
): string {
  return SORT_FIELD_MAP_SUBSCRIPTIONS[sortBy ?? 'createdAt'] ?? 'created_at';
}

/**
 * Parse an order's `notes` column (JSON text written by Phase 11K.6).
 * Returns an empty object for NULL / malformed values so callers never crash.
 */
function parseOrderNotes(notes: string | null): Record<string, unknown> {
  if (!notes) return {};
  try {
    const parsed = JSON.parse(notes) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Shape of the joined `student_subscriptions` row returned by Supabase. */
interface SubscriptionPlansJoin {
  plan_id: string;
  name: string | null;
  billing_cycle: string | null;
  price: string | number | null;
  currency_code: string | null;
  duration_days: number | null;
}

interface StudentProfilesJoin {
  profiles?: { name: string | null; phone: string | null } | null;
}

interface SubscriptionJoinRow {
  subscription_id: string;
  student_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  start_date: string;
  end_date: string;
  grace_end_date: string | null;
  content_access_end_date: string | null;
  is_trial: boolean;
  is_auto_renew: boolean;
  order_id: string | null;
  created_at: string;
  updated_at: string;
  course_id: string | null;
  subscription_plans?: SubscriptionPlansJoin | null;
  student_details?: StudentProfilesJoin | null;
  courses?: { course_id: string; title: string | null } | null;
}

function mapSubscriptionRow(row: SubscriptionJoinRow): SubscriptionListItem {
  const plan = row.subscription_plans ?? null;
  const student = row.student_details ?? null;
  const course = row.courses ?? null;
  return {
    subscriptionId: row.subscription_id,
    studentId: row.student_id,
    studentName: student?.profiles?.name ?? null,
    studentPhone: student?.profiles?.phone ?? null,
    courseId: course?.course_id ?? row.course_id ?? null,
    courseTitle: course?.title ?? null,
    planId: plan?.plan_id ?? row.plan_id,
    planName: plan?.name ?? null,
    billingCycle: plan?.billing_cycle ?? null,
    planPrice: plan?.price != null ? parseFloat(String(plan.price)) : null,
    planCurrency: plan?.currency_code?.trim() ?? 'INR',
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    graceEndDate: row.grace_end_date ?? null,
    contentAccessEndDate: row.content_access_end_date ?? null,
    isTrial: row.is_trial ?? false,
    isAutoRenew: row.is_auto_renew ?? true,
    orderId: row.order_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Shape of the joined `course_enrollments` row (permanent owners). */
interface PermanentOwnerRow {
  enrollment_id: string;
  student_id: string;
  course_id: string | null;
  enrolled_at: string;
  is_active: boolean;
  courses?: { course_id: string; title: string | null } | null;
  student_details?: StudentProfilesJoin | null;
}

/** Shape of an `orders` row carrying Phase 11K.6 notes flags. */
interface FlaggedOrderRow {
  order_id: string;
  total_amount: string | number | null;
  currency: string;
  status: string;
  placed_at: string;
  notes: string | null;
  profiles?: { name: string | null; phone: string | null } | null;
}

/** Shape of a `payments` row joined to its parent `orders`. */
interface PaymentRow {
  payment_id: string;
  order_id: string;
  gateway_payment_id: string | null;
  gateway_order_id: string | null;
  amount: string | number | null;
  currency: string;
  status: string;
  gateway: string;
  failure_reason: string | null;
  paid_at: string | null;
  refunded_at: string | null;
  refund_amount: string | number | null;
  created_at: string;
  orders?: { order_id: string; notes: string | null } | null;
}

/** Shape of a `subscription_history` row. */
interface HistoryRow {
  history_id: string;
  change_reason: string;
  status_before: string | null;
  status_after: string | null;
  payment_reference: string | null;
  metadata: Record<string, unknown> | null;
  changed_by_role: string | null;
  occurred_at: string;
}

/** Shape of a `courses` row (filter dropdown). */
interface CourseRow {
  course_id: string;
  title: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Service
// ═══════════════════════════════════════════════════════════════════════════

export const subscriptionAdminService = {
  // ─────────────────────────────────────────────────────────────────────────
  //  1. Dashboard Metrics
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Aggregate subscription metrics for the Commerce dashboard.
   */
  async getSubscriptionMetrics(
    instituteId?: string | null,
  ): Promise<ApiResponse<SubscriptionMetrics>> {
    try {
      const base = instituteId ? { institute_id: instituteId } : {};

      const [active, grace, expired, pending, owners, renewals, conversions, flagged, duplicates] =
        await Promise.allSettled([
          supabase
            .from('student_subscriptions')
            .select('subscription_id', { count: 'exact', head: true })
            .eq('status', 'active')
            .match(base),
          supabase
            .from('student_subscriptions')
            .select('subscription_id', { count: 'exact', head: true })
            .eq('status', 'grace')
            .match(base),
          supabase
            .from('student_subscriptions')
            .select('subscription_id', { count: 'exact', head: true })
            .eq('status', 'expired')
            .match(base),
          supabase
            .from('student_subscriptions')
            .select('subscription_id', { count: 'exact', head: true })
            .eq('status', 'pending')
            .match(base),
          supabase
            .from('course_enrollments')
            .select('enrollment_id', { count: 'exact', head: true })
            .eq('enrollment_type', 'purchase')
            .eq('is_active', true)
            .match(base),
          supabase
            .from('subscription_history')
            .select('history_id', { count: 'exact', head: true })
            .eq('change_reason', 'renewal')
            .match(base),
          supabase
            .from('subscription_history')
            .select('history_id', { count: 'exact', head: true })
            // The enrichment in complete-course-purchase writes
            // metadata.reason = 'full_course_conversion' AND sets
            // change_reason='cancellation'. Keying on the metadata marker
            // alone stays correct even if that enrichment ever fails and the
            // trigger row keeps change_reason='system_action'.
            .eq('metadata->>reason', 'full_course_conversion')
            .match(base),
          supabase
            .from('orders')
            .select('order_id', { count: 'exact', head: true })
            .ilike('notes', '%flagged_for_refund%')
            .match(base),
          supabase
            .from('orders')
            .select('order_id', { count: 'exact', head: true })
            .ilike('notes', '%duplicate_of_order_id%')
            .match(base),
        ]);

      const countOf = (r: PromiseSettledResult<{ count: number | null } | null>) =>
        r.status === 'fulfilled' && r.value ? (r.value.count ?? 0) : 0;

      const metrics: SubscriptionMetrics = {
        active: countOf(active),
        grace: countOf(grace),
        expired: countOf(expired),
        pending: countOf(pending),
        permanentOwners: countOf(owners),
        renewals: countOf(renewals),
        conversions: countOf(conversions),
        flaggedForRefund: countOf(flagged),
        duplicateOrders: countOf(duplicates),
      };

      return { success: true, data: metrics };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  2. Subscriptions List
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a paginated, filtered list of student subscriptions.
   * Joins student_details → profiles, subscription_plans, and courses.
   */
  async getSubscriptions(
    filters?: SubscriptionFilters,
    sort?: SubscriptionSortOptions,
    pagination?: PaginationParams,
  ): Promise<ApiResponse<PaginatedResponse<SubscriptionListItem>>> {
    try {
      let query = supabase
        .from('student_subscriptions')
        .select(
          `
          *,
          student_details!inner (
            student_id,
            profiles!inner ( name, phone )
          ),
          subscription_plans!inner (
            plan_id,
            name,
            billing_cycle,
            price,
            currency_code,
            duration_days
          ),
          courses!fk_student_subscriptions_course ( course_id, title )
        `,
          { count: 'exact' },
        );

      // ── Filters ─────────────────────────────────────────────────────
      if (filters?.instituteId) {
        query = query.eq('institute_id', filters.instituteId);
      }
      if (filters?.status) {
        query = query.eq('status', filters.status);
      }
      if (filters?.courseId) {
        query = query.eq('course_id', filters.courseId);
      }
      if (filters?.billingCycle) {
        query = query.eq('subscription_plans.billing_cycle', filters.billingCycle);
      }
      if (filters?.dateFrom) {
        query = query.gte('created_at', filters.dateFrom);
      }
      if (filters?.dateTo) {
        query = query.lte('created_at', filters.dateTo);
      }
      if (filters?.search) {
        const term = `%${filters.search}%`;
        query = query.or(
          `student_details.profiles.name.ilike.${term},student_details.profiles.phone.ilike.${term}`,
        );
      }

      // ── Sorting + Pagination ────────────────────────────────────────
      const sortBy = mapSubscriptionSortField(sort?.sortBy);
      const direction = sort?.sortDirection ?? 'desc';
      query = query.order(sortBy, { ascending: direction === 'asc' });

      const { page, pageSize, from, to } = buildPagination(pagination);
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const items = (data ?? []).map(mapSubscriptionRow);

      return {
        success: true,
        data: buildPaginatedResponse(items, count ?? 0, page, pageSize),
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  /** All matching subscriptions (no pagination) — used for CSV export. */
  async exportSubscriptions(
    filters?: SubscriptionFilters,
  ): Promise<ApiResponse<ExportResult<SubscriptionListItem>>> {
    try {
      const result = await subscriptionAdminService.getSubscriptions(filters, undefined, {
        page: 1,
        pageSize: EXPORT_PAGE_SIZE,
      });
      if (!result.success) {
        return { success: false, error: result.error };
      }
      return {
        success: true,
        data: { data: result.data!.data, count: result.data!.count },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  3. Permanent Owners (one-time course purchases)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a paginated list of permanent owners — students with a one-time
   * course purchase (course_enrollments.enrollment_type = 'purchase').
   */
  async getPermanentOwners(
    filters?: PermanentOwnerFilters,
    pagination?: PaginationParams,
  ): Promise<ApiResponse<PaginatedResponse<PermanentOwnerListItem>>> {
    try {
      let query = supabase
        .from('course_enrollments')
        .select(
          `
          *,
          courses!inner ( course_id, title ),
          student_details!inner ( profile_id, profiles!inner ( name, phone ) )
        `,
          { count: 'exact' },
        )
        .eq('enrollment_type', 'purchase')
        .eq('is_active', true);

      // ── Filters ─────────────────────────────────────────────────────
      if (filters?.instituteId) {
        query = query.eq('institute_id', filters.instituteId);
      }
      if (filters?.courseId) {
        query = query.eq('course_id', filters.courseId);
      }
      if (filters?.search) {
        const term = `%${filters.search}%`;
        query = query.or(
          `student_details.profiles.name.ilike.${term},student_details.profiles.phone.ilike.${term}`,
        );
      }

      // ── Sorting + Pagination ────────────────────────────────────────
      query = query.order('enrolled_at', { ascending: false });
      const { page, pageSize, from, to } = buildPagination(pagination);
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const items: PermanentOwnerListItem[] = (data ?? []).map((row: PermanentOwnerRow) => ({
        enrollmentId: row.enrollment_id,
        studentId: row.student_id,
        studentName: row.student_details?.profiles?.name ?? null,
        studentPhone: row.student_details?.profiles?.phone ?? null,
        courseId: row.courses?.course_id ?? row.course_id ?? null,
        courseTitle: row.courses?.title ?? null,
        enrolledAt: row.enrolled_at,
        isActive: row.is_active ?? true,
      }));

      return {
        success: true,
        data: buildPaginatedResponse(items, count ?? 0, page, pageSize),
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  /** All permanent owners (no pagination) — used for CSV export. */
  async exportPermanentOwners(
    filters?: PermanentOwnerFilters,
  ): Promise<ApiResponse<ExportResult<PermanentOwnerListItem>>> {
    try {
      const result = await subscriptionAdminService.getPermanentOwners(filters, {
        page: 1,
        pageSize: EXPORT_PAGE_SIZE,
      });
      if (!result.success) {
        return { success: false, error: result.error };
      }
      return {
        success: true,
        data: { data: result.data!.data, count: result.data!.count },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  4. Duplicate / Refund Flags (orders.notes JSON text)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get orders carrying Phase 11K.6 duplicate-payment or refund-flag markers
   * (stored as JSON text inside orders.notes).
   */
  async getFlaggedOrders(
    filters?: FlaggedOrderFilters,
    pagination?: PaginationParams,
  ): Promise<ApiResponse<PaginatedResponse<FlaggedOrderListItem>>> {
    try {
      let query = supabase
        .from('orders')
        .select(
          `
          *,
          profiles!fk_orders_profile ( name, phone )
        `,
          { count: 'exact' },
        )
        .or(
          'notes.ilike.%duplicate_of_order_id%,notes.ilike.%flagged_for_refund%,notes.ilike.%conversion%',
        );

      // ── Filters ─────────────────────────────────────────────────────
      if (filters?.instituteId) {
        query = query.eq('institute_id', filters.instituteId);
      }
      if (filters?.search) {
        const term = `%${filters.search}%`;
        query = query.or(
          `profiles.name.ilike.${term},profiles.phone.ilike.${term},order_id.ilike.${term}`,
        );
      }

      // ── Sorting + Pagination ────────────────────────────────────────
      query = query.order('placed_at', { ascending: false });
      const { page, pageSize, from, to } = buildPagination(pagination);
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const items: FlaggedOrderListItem[] = (data ?? []).map((row: FlaggedOrderRow) => {
        const notes = parseOrderNotes(row.notes);
        return {
          orderId: row.order_id,
          studentName: row.profiles?.name ?? null,
          studentPhone: row.profiles?.phone ?? null,
          totalAmount: parseFloat(String(row.total_amount ?? 0)),
          currency: row.currency,
          status: row.status,
          placedAt: row.placed_at,
          duplicateOfOrderId: (notes.duplicate_of_order_id as string) ?? null,
          duplicateKind: (notes.duplicate_kind as string) ?? null,
          flaggedForRefund: notes.flagged_for_refund === true,
          conversion: notes.conversion === 'true' || notes.conversion === true,
        };
      });

      return {
        success: true,
        data: buildPaginatedResponse(items, count ?? 0, page, pageSize),
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  /** All flagged orders (no pagination) — used for CSV export. */
  async exportFlaggedOrders(
    filters?: FlaggedOrderFilters,
  ): Promise<ApiResponse<ExportResult<FlaggedOrderListItem>>> {
    try {
      const result = await subscriptionAdminService.getFlaggedOrders(filters, {
        page: 1,
        pageSize: EXPORT_PAGE_SIZE,
      });
      if (!result.success) {
        return { success: false, error: result.error };
      }
      return {
        success: true,
        data: { data: result.data!.data, count: result.data!.count },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  5. Subscription Detail
  // ─────────────────────────────────────────────────────────────────────────

  /** Fetch a single subscription with its plan, course, and student joins. */
  async getSubscriptionDetail(
    subscriptionId: string,
  ): Promise<ApiResponse<SubscriptionListItem | null>> {
    try {
      const { data, error } = await supabase
        .from('student_subscriptions')
        .select(
          `
          *,
          student_details!inner (
            student_id,
            profile_id,
            profiles!inner ( name, phone )
          ),
          subscription_plans!inner (
            plan_id,
            name,
            slug,
            description,
            billing_cycle,
            price,
            currency_code,
            duration_days,
            trial_days,
            is_active,
            is_featured
          ),
          courses!fk_student_subscriptions_course ( course_id, title )
        `,
        )
        .eq('subscription_id', subscriptionId)
        .maybeSingle();

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      return {
        success: true,
        data: data ? mapSubscriptionRow(data) : null,
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  6. Subscription Payments
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Payment history for a subscription — every payment whose order contains a
   * `subscription_plan` line item for this student + plan. This captures the
   * initial purchase AND all renewals of the same plan (financial traceability
   * lives in orders; conversion orders are item_type='course' and are excluded).
   */
  async getSubscriptionPayments(
    subscriptionId: string,
  ): Promise<ApiResponse<SubscriptionPaymentItem[]>> {
    try {
      const { data: sub, error: subError } = await supabase
        .from('student_subscriptions')
        .select('plan_id, student_id')
        .eq('subscription_id', subscriptionId)
        .maybeSingle();

      if (subError) {
        return { success: false, error: extractErrorMessage(subError) };
      }
      if (!sub) {
        return { success: true, data: [] };
      }

      const { data, error } = await supabase
        .from('payments')
        .select(
          `
          *,
          orders!inner (
            order_id,
            total_amount,
            status,
            placed_at,
            notes,
            order_items ( item_id, item_type, plan_id )
          )
        `,
        )
        .eq('orders.order_items.plan_id', sub.plan_id)
        .eq('orders.order_items.item_type', 'subscription_plan')
        .eq('orders.student_id', sub.student_id)
        .order('paid_at', { ascending: false });

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const items: SubscriptionPaymentItem[] = (data ?? []).map((row: PaymentRow) => {
        const orderNotes = parseOrderNotes(row.orders?.notes ?? null);
        return {
          paymentId: row.payment_id,
          orderId: row.orders?.order_id ?? row.order_id,
          gatewayPaymentId: row.gateway_payment_id ?? null,
          gatewayOrderId: row.gateway_order_id ?? null,
          amount: parseFloat(String(row.amount ?? 0)),
          currency: row.currency,
          status: row.status,
          gateway: row.gateway,
          failureReason: row.failure_reason ?? null,
          paidAt: row.paid_at ?? null,
          refundedAt: row.refunded_at ?? null,
          refundAmount: row.refund_amount != null ? parseFloat(String(row.refund_amount)) : null,
          createdAt: row.created_at,
          duplicateOfOrderId: (orderNotes.duplicate_of_order_id as string) ?? null,
          duplicateKind: (orderNotes.duplicate_kind as string) ?? null,
          flaggedForRefund: orderNotes.flagged_for_refund === true,
        };
      });

      return { success: true, data: items };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  7. Subscription History
  // ─────────────────────────────────────────────────────────────────────────

  /** Immutable audit trail for a subscription (subscription_history). */
  async getSubscriptionHistory(
    subscriptionId: string,
  ): Promise<ApiResponse<SubscriptionHistoryItem[]>> {
    try {
      const { data, error } = await supabase
        .from('subscription_history')
        .select('*')
        .eq('subscription_id', subscriptionId)
        .order('occurred_at', { ascending: false });

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const items: SubscriptionHistoryItem[] = (data ?? []).map((row: HistoryRow) => ({
        historyId: row.history_id,
        changeReason: row.change_reason,
        statusBefore: row.status_before ?? null,
        statusAfter: row.status_after ?? null,
        paymentReference: row.payment_reference ?? null,
        metadata: row.metadata ?? null,
        changedByRole: row.changed_by_role ?? null,
        occurredAt: row.occurred_at,
      }));

      return { success: true, data: items };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  8. Courses filter dropdown
  // ─────────────────────────────────────────────────────────────────────────

  /** Courses for the institute (used by the filter dropdown). */
  async getSubscriptionCourses(
    instituteId?: string | null,
  ): Promise<ApiResponse<SubscriptionCourseOption[]>> {
    try {
      let query = supabase
        .from('courses')
        .select('course_id, title')
        .order('title', { ascending: true })
        .limit(200);

      if (instituteId) {
        query = query.eq('institute_id', instituteId);
      }

      const { data, error } = await query;

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const items: SubscriptionCourseOption[] = (data ?? []).map((row: CourseRow) => ({
        courseId: row.course_id,
        title: row.title,
      }));

      return { success: true, data: items };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },
};
