/**
 * Admin Commerce Verification Service
 *
 * Single source of truth for all commerce verification operations in the
 * Admin Dashboard. Provides queries for orders, payments, course enrollments,
 * and PYQ purchases — all using live Supabase data.
 *
 * ## Data Sources
 *
 * | Section             | Source Table(s)                                      |
 * |---------------------|------------------------------------------------------|
 * | Orders              | orders + profiles + order_items                      |
 * | Payments            | payments + orders + profiles                          |
 * | Course Purchases    | course_enrollments + courses + profiles               |
 * | PYQ Purchases       | student_pyq_purchases + pyq_packages + profiles       |
 * | Dashboard Metrics   | Aggregated counts from all commerce tables            |
 * | Global Search       | profiles, orders, payments (fuzzy match)              |
 *
 * @module services/admin/commerceService
 */

import { supabase } from '@/config/supabase';
import { buildPagination, extractErrorMessage } from '@/utils/supabase';
import { buildPaginatedResponse } from '@/utils/response';
import type { ApiResponse, PaginatedResponse, PaginationParams, SortDirection } from '@/types/academic';

// ═══════════════════════════════════════════════════════════════════════════
//  Types — Orders
// ═══════════════════════════════════════════════════════════════════════════

export type OrderStatus = 'pending' | 'confirmed' | 'cancelled' | 'refunded';
export type PaymentStatus = 'pending' | 'captured' | 'failed' | 'refunded' | 'partially_refunded';
export type ItemType = 'subscription_plan' | 'pyq_package' | 'course';

export interface OrderListItem {
  orderId: string;
  studentName: string | null;
  studentPhone: string | null;
  studentProfileId: string | null;
  productType: string;
  productName: string | null;
  status: OrderStatus;
  currency: string;
  totalAmount: number;
  placedAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  refundedAt: string | null;
  createdAt: string;
}

export interface OrderFilters {
  status?: OrderStatus;
  productType?: ItemType;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  instituteId?: string;
}

export interface OrderSortOptions {
  sortBy?: 'placedAt' | 'totalAmount' | 'status' | 'confirmedAt';
  sortDirection?: SortDirection;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Types — Payments
// ═══════════════════════════════════════════════════════════════════════════

export interface PaymentListItem {
  paymentId: string;
  orderId: string;
  razorpayPaymentId: string | null;
  razorpayOrderId: string | null;
  orderStudentName: string | null;
  orderTotalAmount: number | null;
  amount: number;
  currency: string;
  status: PaymentStatus;
  gateway: string;
  failureReason: string | null;
  paidAt: string | null;
  refundedAt: string | null;
  refundAmount: number | null;
  createdAt: string;
}

export interface PaymentFilters {
  status?: PaymentStatus;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  instituteId?: string;
}

export interface PaymentSortOptions {
  sortBy?: 'paidAt' | 'amount' | 'status' | 'createdAt';
  sortDirection?: SortDirection;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Types — Course Purchases (Enrollments)
// ═══════════════════════════════════════════════════════════════════════════

export interface CoursePurchaseListItem {
  enrollmentId: string;
  studentId: string;
  studentName: string | null;
  studentPhone: string | null;
  courseId: string;
  courseTitle: string | null;
  enrolledAt: string;
  isActive: boolean;
  orderId: string | null;
  orderStatus: string | null;
}

export interface CoursePurchaseFilters {
  search?: string;
  isActive?: boolean;
  instituteId?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Types — PYQ Purchases
// ═══════════════════════════════════════════════════════════════════════════

export interface PyqPurchaseListItem {
  purchaseId: string;
  studentId: string;
  studentName: string | null;
  studentPhone: string | null;
  packageId: string;
  packageName: string | null;
  purchasedAt: string;
  isActive: boolean;
  accessType: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  orderItemId: string | null;
}

export interface PyqPurchaseFilters {
  search?: string;
  isActive?: boolean;
  accessType?: string;
  instituteId?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Types — Dashboard Metrics
// ═══════════════════════════════════════════════════════════════════════════

export interface CommerceDashboardMetrics {
  totalOrders: number;
  totalRevenue: number;
  capturedPayments: number;
  pendingPayments: number;
  courseEnrollments: number;
  pyqPurchases: number;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Types — Global Search
// ═══════════════════════════════════════════════════════════════════════════

export interface GlobalSearchResult {
  type: 'student' | 'order' | 'payment';
  id: string;
  label: string;
  subtitle: string | null;
  href: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Types — Student Commerce
// ═══════════════════════════════════════════════════════════════════════════

export interface StudentCommerceData {
  purchasedCourses: {
    enrollmentId: string;
    courseId: string;
    courseTitle: string | null;
    enrolledAt: string;
    isActive: boolean;
  }[];
  purchasedPyqPackages: {
    purchaseId: string;
    packageId: string;
    packageName: string | null;
    purchasedAt: string;
    isActive: boolean;
    accessType: string;
  }[];
  orderHistory: OrderListItem[];
  paymentHistory: PaymentListItem[];
}

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

const SORT_FIELD_MAP_ORDERS: Record<string, string> = {
  placedAt: 'placed_at',
  totalAmount: 'total_amount',
  status: 'status',
  confirmedAt: 'confirmed_at',
};

const SORT_FIELD_MAP_PAYMENTS: Record<string, string> = {
  paidAt: 'paid_at',
  amount: 'amount',
  status: 'status',
  createdAt: 'created_at',
};

function mapOrderSortField(sortBy?: OrderSortOptions['sortBy']): string {
  return SORT_FIELD_MAP_ORDERS[sortBy ?? 'placedAt'] ?? 'placed_at';
}

function mapPaymentSortField(sortBy?: PaymentSortOptions['sortBy']): string {
  return SORT_FIELD_MAP_PAYMENTS[sortBy ?? 'createdAt'] ?? 'created_at';
}

// ═══════════════════════════════════════════════════════════════════════════
//  Service
// ═══════════════════════════════════════════════════════════════════════════

export const commerceService = {
  // ─────────────────────────────────────────────────────────────────────────
  //  1. Dashboard Metrics
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Fetch aggregate commerce metrics for the admin dashboard.
   */
  async getDashboardMetrics(instituteId?: string | null): Promise<ApiResponse<CommerceDashboardMetrics>> {
    try {
      const baseFilter = instituteId ? { institute_id: instituteId } : {};

      const [
        ordersRes,
        capturedPaymentsRes,
        pendingPaymentsRes,
        courseEnrollmentsRes,
        pyqPurchasesRes,
      ] = await Promise.allSettled([
        // Total Orders
        supabase
          .from('orders')
          .select('total_amount', { count: 'exact' })
          .match(baseFilter),

        // Captured Payments
        supabase
          .from('payments')
          .select('payment_id', { count: 'exact', head: true })
          .eq('status', 'captured')
          .match(baseFilter),

        // Pending Payments
        supabase
          .from('payments')
          .select('payment_id', { count: 'exact', head: true })
          .eq('status', 'pending')
          .match(baseFilter),

        // Course Enrollments
        supabase
          .from('course_enrollments')
          .select('enrollment_id', { count: 'exact', head: true })
          .match(baseFilter),

        // PYQ Purchases
        supabase
          .from('student_pyq_purchases')
          .select('purchase_id', { count: 'exact', head: true })
          .eq('is_active', true)
          .match(baseFilter),
      ]);

      // Calculate total revenue from confirmed orders
      let totalRevenue = 0;
      if (ordersRes.status === 'fulfilled' && ordersRes.value.data) {
        totalRevenue = ordersRes.value.data
          .filter((o: any) => o.status === 'confirmed')
          .reduce((sum: number, o: any) => sum + parseFloat(o.total_amount ?? 0), 0);
      }

      const metrics: CommerceDashboardMetrics = {
        totalOrders: ordersRes.status === 'fulfilled' ? (ordersRes.value.count ?? 0) : 0,
        totalRevenue,
        capturedPayments: capturedPaymentsRes.status === 'fulfilled' ? (capturedPaymentsRes.value.count ?? 0) : 0,
        pendingPayments: pendingPaymentsRes.status === 'fulfilled' ? (pendingPaymentsRes.value.count ?? 0) : 0,
        courseEnrollments: courseEnrollmentsRes.status === 'fulfilled' ? (courseEnrollmentsRes.value.count ?? 0) : 0,
        pyqPurchases: pyqPurchasesRes.status === 'fulfilled' ? (pyqPurchasesRes.value.count ?? 0) : 0,
      };

      return { success: true, data: metrics };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  2. Orders List
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a paginated, filtered list of orders.
   * Joins profiles and order_items to show student info and product details.
   */
  async getOrders(
    filters?: OrderFilters,
    sort?: OrderSortOptions,
    pagination?: PaginationParams,
  ): Promise<ApiResponse<PaginatedResponse<OrderListItem>>> {
    try {
      const instituteFilter = filters?.instituteId ? { institute_id: filters.instituteId } : {};
      let query = supabase
        .from('orders')
        .select(`
          *,
          profiles!fk_orders_profile (
            name,
            phone
          ),
          order_items (
            item_type,
            item_name,
            course:courses!fk_order_items_course (title),
            package:pyq_packages!fk_order_items_package (name)
          )
        `, { count: 'exact' })
        .match(instituteFilter);

      // ── Filters ─────────────────────────────────────────────────────
      if (filters?.status) {
        query = query.eq('status', filters.status);
      }

      if (filters?.productType) {
        // Filter orders that have an order_item of the given type
        // Filter orders that have order_items of the given type
        // Uses PostgREST's embedded filter syntax via `order_items.item_type.eq.`
        query = query.eq('order_items.item_type', filters.productType);
      }

      if (filters?.dateFrom) {
        query = query.gte('placed_at', filters.dateFrom);
      }
      if (filters?.dateTo) {
        query = query.lte('placed_at', filters.dateTo);
      }

      if (filters?.search) {
        const term = `%${filters.search}%`;
        // Search by student name via profile join
        query = query.or(`profiles.name.ilike.${term},profiles.phone.ilike.${term},order_id.ilike.${term}`);
      }

      // ── Sorting ────────────────────────────────────────────────────
      const sortBy = mapOrderSortField(sort?.sortBy);
      const direction = sort?.sortDirection ?? 'desc';
      query = query.order(sortBy, { ascending: direction === 'asc' });

      // ── Pagination ──────────────────────────────────────────────────
      const { page, pageSize, from, to } = buildPagination(pagination);
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const items: OrderListItem[] = (data ?? []).map((row: any) => {
        const items = row.order_items ?? [];
        const firstItem = items[0];
        let productType = firstItem?.item_type ?? 'unknown';
        let productName = firstItem?.item_name ?? null;

        // Resolve product name from polymorphic FK
        if (firstItem?.course) {
          productName = firstItem.course.title;
        } else if (firstItem?.package) {
          productName = firstItem.package.name;
        }

        return {
          orderId: row.order_id,
          studentName: row.profiles?.name ?? null,
          studentPhone: row.profiles?.phone ?? null,
          studentProfileId: row.profile_id ?? null,
          productType,
          productName,
          status: row.status,
          currency: row.currency,
          totalAmount: parseFloat(row.total_amount ?? 0),
          placedAt: row.placed_at,
          confirmedAt: row.confirmed_at ?? null,
          cancelledAt: row.cancelled_at ?? null,
          refundedAt: row.refunded_at ?? null,
          createdAt: row.created_at,
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

  // ─────────────────────────────────────────────────────────────────────────
  //  3. Payments List
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a paginated, filtered list of payments.
   * Joins orders and profiles to show order context.
   */
  async getPayments(
    filters?: PaymentFilters,
    sort?: PaymentSortOptions,
    pagination?: PaginationParams,
  ): Promise<ApiResponse<PaginatedResponse<PaymentListItem>>> {
    try {
      const instituteFilter = filters?.instituteId ? { institute_id: filters.instituteId } : {};
      let query = supabase
        .from('payments')
        .select(`
          *,
          orders!inner (
            order_id,
            total_amount,
            status,
            currency,
            profile_id,
            profiles!fk_orders_profile (
              name,
              phone
            )
          )
        `, { count: 'exact' })
        .match(instituteFilter);

      // ── Filters ─────────────────────────────────────────────────────
      if (filters?.status) {
        query = query.eq('status', filters.status);
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
          `orders.profiles.name.ilike.${term},orders.profiles.phone.ilike.${term},payment_id.ilike.${term},gateway_payment_id.ilike.${term},gateway_order_id.ilike.${term}`
        );
      }

      // ── Sorting ────────────────────────────────────────────────────
      const sortBy = mapPaymentSortField(sort?.sortBy);
      const direction = sort?.sortDirection ?? 'desc';
      query = query.order(sortBy, { ascending: direction === 'asc' });

      // ── Pagination ──────────────────────────────────────────────────
      const { page, pageSize, from, to } = buildPagination(pagination);
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const items: PaymentListItem[] = (data ?? []).map((row: any) => {
        const orderProfiles = Array.isArray(row.orders?.profiles) ? row.orders.profiles[0] : row.orders?.profiles;
        return {
          paymentId: row.payment_id,
          orderId: row.orders?.order_id ?? row.order_id,
          razorpayPaymentId: row.gateway_payment_id ?? null,
          razorpayOrderId: row.gateway_order_id ?? null,
          orderStudentName: orderProfiles?.name ?? null,
          orderTotalAmount: row.orders?.total_amount ? parseFloat(row.orders.total_amount) : null,
          amount: parseFloat(row.amount ?? 0),
          currency: row.currency,
          status: row.status,
          gateway: row.gateway,
          failureReason: row.failure_reason ?? null,
          paidAt: row.paid_at ?? null,
          refundedAt: row.refunded_at ?? null,
          refundAmount: row.refund_amount ? parseFloat(row.refund_amount) : null,
          createdAt: row.created_at,
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

  // ─────────────────────────────────────────────────────────────────────────
  //  4. Course Purchases (via course_enrollments)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a paginated list of course enrollments/purchases.
   * Joins courses and profiles to show student and course info.
   */
  async getCoursePurchases(
    filters?: CoursePurchaseFilters,
    pagination?: PaginationParams,
  ): Promise<ApiResponse<PaginatedResponse<CoursePurchaseListItem>>> {
    try {
      const instituteFilter = filters?.instituteId ? { institute_id: filters.instituteId } : {};
      let query = supabase
        .from('course_enrollments')
        .select(`
          *,
          courses!inner (
            course_id,
            title
          ),
          student_details!inner (
            profile_id,
            profiles!inner (
              name,
              phone
            )
          )
        `, { count: 'exact' })
        .match(instituteFilter);

      // ── Filters ─────────────────────────────────────────────────────
      if (filters?.isActive !== undefined) {
        query = query.eq('is_active', filters.isActive);
      }

      if (filters?.search) {
        const term = `%${filters.search}%`;
        query = query.or(
          `student_details.profiles.name.ilike.${term},student_details.profiles.phone.ilike.${term}`
        );
      }

      query = query.order('enrolled_at', { ascending: false });

      const { page, pageSize, from, to } = buildPagination(pagination);
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      // We also need to find related order info. For each enrollment, try to find the order
      // by matching the student's profile_id and course item_type
      const items: CoursePurchaseListItem[] = (data ?? []).map((row: any) => ({
        enrollmentId: row.enrollment_id,
        studentId: row.student_id,
        studentName: row.student_details?.profiles?.name ?? null,
        studentPhone: row.student_details?.profiles?.phone ?? null,
        courseId: row.courses?.course_id ?? row.course_id,
        courseTitle: row.courses?.title ?? null,
        enrolledAt: row.enrolled_at,
        isActive: row.is_active ?? true,
        orderId: null, // Will be populated if we add a join to order_items
        orderStatus: null,
      }));

      return {
        success: true,
        data: buildPaginatedResponse(items, count ?? 0, page, pageSize),
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  5. PYQ Purchases
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a paginated list of PYQ package purchases.
   * Joins pyq_packages and profiles to show student and package info.
   */
  async getPyqPurchases(
    filters?: PyqPurchaseFilters,
    pagination?: PaginationParams,
  ): Promise<ApiResponse<PaginatedResponse<PyqPurchaseListItem>>> {
    try {
      const instituteFilter = filters?.instituteId ? { institute_id: filters.instituteId } : {};
      let query = supabase
        .from('student_pyq_purchases')
        .select(`
          *,
          pyq_packages!inner (
            name
          ),
          student_details!inner (
            profile_id,
            profiles!inner (
              name,
              phone
            )
          )
        `, { count: 'exact' })
        .match(instituteFilter);

      // ── Filters ─────────────────────────────────────────────────────
      if (filters?.isActive !== undefined) {
        query = query.eq('is_active', filters.isActive);
      }

      if (filters?.accessType) {
        query = query.eq('access_type', filters.accessType);
      }

      if (filters?.search) {
        const term = `%${filters.search}%`;
        query = query.or(
          `student_details.profiles.name.ilike.${term},student_details.profiles.phone.ilike.${term}`
        );
      }

      query = query.order('purchased_at', { ascending: false });

      const { page, pageSize, from, to } = buildPagination(pagination);
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const items: PyqPurchaseListItem[] = (data ?? []).map((row: any) => ({
        purchaseId: row.purchase_id,
        studentId: row.student_id,
        studentName: row.student_details?.profiles?.name ?? null,
        studentPhone: row.student_details?.profiles?.phone ?? null,
        packageId: row.package_id,
        packageName: row.pyq_packages?.name ?? null,
        purchasedAt: row.purchased_at,
        isActive: row.is_active ?? true,
        accessType: row.access_type ?? 'purchase',
        expiresAt: row.expires_at ?? null,
        revokedAt: row.revoked_at ?? null,
        revokedReason: row.revoked_reason ?? null,
        orderItemId: row.order_item_id ?? null,
      }));

      return {
        success: true,
        data: buildPaginatedResponse(items, count ?? 0, page, pageSize),
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  6. Student Commerce Data
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Fetch all commerce data for a single student by profile_id.
   * Returns purchased courses, PYQ packages, order history, and payment history.
   */
  async getStudentCommerce(profileId: string): Promise<ApiResponse<StudentCommerceData>> {
    try {
      // First, find the student_details record
      const { data: studentDetails, error: sdErr } = await supabase
        .from('student_details')
        .select('student_id, institute_id')
        .eq('profile_id', profileId)
        .maybeSingle();

      const studentId = studentDetails?.student_id;
      const instituteId = studentDetails?.institute_id;

      const [
        coursesRes,
        pyqRes,
        ordersRes,
      ] = await Promise.allSettled([
        // Course enrollments for this student
        studentId
          ? supabase
              .from('course_enrollments')
              .select(`
                *,
                courses!inner (title)
              `)
              .eq('student_id', studentId)
              .order('enrolled_at', { ascending: false })
          : Promise.resolve({ data: [], error: null }),

        // PYQ purchases for this student
        studentId
          ? supabase
              .from('student_pyq_purchases')
              .select(`
                *,
                pyq_packages!inner (name)
              `)
              .eq('student_id', studentId)
              .order('purchased_at', { ascending: false })
          : Promise.resolve({ data: [], error: null }),

        // Orders for this student (by profile_id or student_id)
        supabase
          .from('orders')
          .select(`
            *,
            order_items (
              item_type,
              item_name,
              course:courses!fk_order_items_course (title),
              package:pyq_packages!fk_order_items_package (name)
            )
          `)
          .or(`profile_id.eq.${profileId}${studentId ? `,student_id.eq.${studentId}` : ''}`)
          .order('placed_at', { ascending: false }),
      ]);

      // Process course enrollments
      const courseData = coursesRes.status === 'fulfilled' ? (coursesRes.value.data ?? []) : [];
      const purchasedCourses = (Array.isArray(courseData) ? courseData : []).map((row: any) => ({
        enrollmentId: row.enrollment_id,
        courseId: row.course_id,
        courseTitle: row.courses?.title ?? null,
        enrolledAt: row.enrolled_at,
        isActive: row.is_active ?? true,
      }));

      // Process PYQ purchases
      const pyqData = pyqRes.status === 'fulfilled' ? (pyqRes.value.data ?? []) : [];
      const purchasedPyqPackages = (Array.isArray(pyqData) ? pyqData : []).map((row: any) => ({
        purchaseId: row.purchase_id,
        packageId: row.package_id,
        packageName: row.pyq_packages?.name ?? null,
        purchasedAt: row.purchased_at,
        isActive: row.is_active ?? true,
        accessType: row.access_type,
      }));

      // Process orders into order history
      const orderData = ordersRes.status === 'fulfilled' ? (ordersRes.value.data ?? []) : [];
      const orderHistory: OrderListItem[] = (Array.isArray(orderData) ? orderData : []).map((row: any) => {
        const items = row.order_items ?? [];
        const firstItem = items[0];
        let productName = firstItem?.item_name ?? null;
        if (firstItem?.course) productName = firstItem.course.title;
        else if (firstItem?.package) productName = firstItem.package.name;

        return {
          orderId: row.order_id,
          studentName: null,
          studentPhone: null,
          studentProfileId: row.profile_id,
          productType: firstItem?.item_type ?? 'unknown',
          productName,
          status: row.status,
          currency: row.currency,
          totalAmount: parseFloat(row.total_amount ?? 0),
          placedAt: row.placed_at,
          confirmedAt: row.confirmed_at ?? null,
          cancelledAt: row.cancelled_at ?? null,
          refundedAt: row.refunded_at ?? null,
          createdAt: row.created_at,
        };
      });

      // Fetch payment history for all these orders
      const orderIds = orderHistory.map(o => o.orderId);
      let paymentHistory: PaymentListItem[] = [];

      if (orderIds.length > 0) {
        const { data: paymentsData } = await supabase
          .from('payments')
          .select(`
            *,
            orders!inner (
              total_amount,
              currency,
              profile_id
            )
          `)
          .in('order_id', orderIds)
          .order('created_at', { ascending: false });

        if (paymentsData) {
          paymentHistory = paymentsData.map((row: any) => ({
            paymentId: row.payment_id,
            orderId: row.order_id,
            razorpayPaymentId: row.gateway_payment_id ?? null,
            razorpayOrderId: row.gateway_order_id ?? null,
            orderStudentName: null,
            orderTotalAmount: row.orders?.total_amount ? parseFloat(row.orders.total_amount) : null,
            amount: parseFloat(row.amount ?? 0),
            currency: row.currency,
            status: row.status,
            gateway: row.gateway,
            failureReason: row.failure_reason ?? null,
            paidAt: row.paid_at ?? null,
            refundedAt: row.refunded_at ?? null,
            refundAmount: row.refund_amount ? parseFloat(row.refund_amount) : null,
            createdAt: row.created_at,
          }));
        }
      }

      return {
        success: true,
        data: {
          purchasedCourses,
          purchasedPyqPackages,
          orderHistory,
          paymentHistory,
        },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  7. Global Search
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Global search across students, orders, and payments.
   * Searches by student name, phone, order ID, payment ID, and Razorpay payment ID.
   */
  async globalSearch(query: string, instituteId?: string | null): Promise<ApiResponse<GlobalSearchResult[]>> {
    if (!query || query.trim().length < 2) {
      return { success: true, data: [] };
    }

    try {
      const term = `%${query.trim()}%`;
      const instituteFilter = instituteId ? { institute_id: instituteId } : {};
      const results: GlobalSearchResult[] = [];

      // Search profiles (students)
      const { data: profiles } = await supabase
        .from('profiles')
        .select('profile_id, name, phone, email, role')
        .or(`name.ilike.${term},phone.ilike.${term},email.ilike.${term}`)
        .eq('role', 'student')
        .limit(10);

      if (profiles) {
        for (const p of profiles) {
          results.push({
            type: 'student',
            id: p.profile_id,
            label: p.name ?? 'Unknown',
            subtitle: p.phone ?? p.email ?? null,
            href: `/admin/students/${p.profile_id}`,
          });
        }
      }

      // Search orders by order_id
      const { data: orders } = await supabase
        .from('orders')
        .select('order_id, total_amount, status, profiles!fk_orders_profile(name)')
        .or(`order_id.ilike.${term},profiles.name.ilike.${term},profiles.phone.ilike.${term}`)
        .match(instituteFilter)
        .limit(10);

      if (orders) {
        for (const o of orders) {
          const profile = Array.isArray(o.profiles) ? o.profiles[0] : o.profiles;
          results.push({
            type: 'order',
            id: o.order_id,
            label: `Order #${o.order_id.slice(0, 8)}`,
            subtitle: `${profile?.name ?? 'Unknown'} · ₹${parseFloat(o.total_amount ?? 0).toLocaleString()} · ${o.status}`,
            href: `/admin/commerce/orders`,
          });
        }
      }

      // Search payments by payment_id, gateway_payment_id, gateway_order_id
      const { data: payments } = await supabase
        .from('payments')
        .select(`
          payment_id,
          gateway_payment_id,
          gateway_order_id,
          amount,
          status,
          orders!inner (
            profiles!fk_orders_profile (
              name
            )
          )
        `)
        .or(
          `payment_id.ilike.${term},gateway_payment_id.ilike.${term},gateway_order_id.ilike.${term}`
        )
        .match(instituteFilter)
        .limit(10);

      if (payments) {
        for (const p of payments) {
          const pOrder = Array.isArray(p.orders) ? p.orders[0] : p.orders;
          const orderProfiles = Array.isArray(pOrder?.profiles) ? pOrder.profiles[0] : pOrder?.profiles;
          results.push({
            type: 'payment',
            id: p.payment_id,
            label: `Payment #${p.payment_id.slice(0, 8)}`,
            subtitle: `${orderProfiles?.name ?? 'Unknown'} · ₹${parseFloat(p.amount ?? 0).toLocaleString()} · ${p.status}${p.gateway_payment_id ? ` · ${p.gateway_payment_id}` : ''}`,
            href: `/admin/commerce/payments`,
          });
        }
      }

      // Sort: students first, then orders, then payments; limit total
      const sorted = results
        .sort((a, b) => {
          const order = { student: 0, order: 1, payment: 2 };
          return order[a.type] - order[b.type];
        })
        .slice(0, 20);

      return { success: true, data: sorted };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  8. Order Detail (single)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a single order with all related data (items, payments).
   */
  async getOrderDetail(orderId: string): Promise<ApiResponse<{
    order: OrderListItem;
    items: any[];
    payments: PaymentListItem[];
  }>> {
    try {
      const [orderRes, paymentsRes] = await Promise.allSettled([
        supabase
          .from('orders')
          .select(`
            *,
            profiles!fk_orders_profile (name, phone),
            order_items (
              item_id,
              item_type,
              item_name,
              unit_price,
              quantity,
              discount_amount,
              line_total,
              course:courses!fk_order_items_course (course_id, title),
              package:pyq_packages!fk_order_items_package (package_id, name)
            )
          `)
          .eq('order_id', orderId)
          .single(),

        supabase
          .from('payments')
          .select(`
            *,
            orders!inner (total_amount, currency, profile_id)
          `)
          .eq('order_id', orderId)
          .order('created_at', { ascending: false }),
      ]);

      if (orderRes.status === 'rejected' || (orderRes.status === 'fulfilled' && orderRes.value.error)) {
        const err = orderRes.status === 'fulfilled' ? orderRes.value.error : orderRes.reason;
        return { success: false, error: extractErrorMessage(err) };
      }

      const orderRow = orderRes.status === 'fulfilled' ? orderRes.value.data : null;
      const paymentsData = paymentsRes.status === 'fulfilled' ? (paymentsRes.value.data ?? []) : [];

      if (!orderRow) {
        return { success: false, error: 'Order not found.' };
      }

      const items = (orderRow.order_items ?? []).map((item: any) => ({
        itemId: item.item_id,
        itemType: item.item_type,
        itemName: item.course?.title ?? item.package?.name ?? item.item_name,
        unitPrice: parseFloat(item.unit_price ?? 0),
        quantity: item.quantity,
        discountAmount: parseFloat(item.discount_amount ?? 0),
        lineTotal: parseFloat(item.line_total ?? 0),
      }));

      const firstItem = orderRow.order_items?.[0];
      let productName = firstItem?.item_name ?? null;
      if (firstItem?.course) productName = firstItem.course.title;
      else if (firstItem?.package) productName = firstItem.package.name;

      const order: OrderListItem = {
        orderId: orderRow.order_id,
        studentName: orderRow.profiles?.name ?? null,
        studentPhone: orderRow.profiles?.phone ?? null,
        studentProfileId: orderRow.profile_id ?? null,
        productType: firstItem?.item_type ?? 'unknown',
        productName,
        status: orderRow.status,
        currency: orderRow.currency,
        totalAmount: parseFloat(orderRow.total_amount ?? 0),
        placedAt: orderRow.placed_at,
        confirmedAt: orderRow.confirmed_at ?? null,
        cancelledAt: orderRow.cancelled_at ?? null,
        refundedAt: orderRow.refunded_at ?? null,
        createdAt: orderRow.created_at,
      };

      const payments: PaymentListItem[] = (Array.isArray(paymentsData) ? paymentsData : []).map((row: any) => ({
        paymentId: row.payment_id,
        orderId: row.order_id,
        razorpayPaymentId: row.gateway_payment_id ?? null,
        razorpayOrderId: row.gateway_order_id ?? null,
        orderStudentName: null,
        orderTotalAmount: row.orders?.total_amount ? parseFloat(row.orders.total_amount) : null,
        amount: parseFloat(row.amount ?? 0),
        currency: row.currency,
        status: row.status,
        gateway: row.gateway,
        failureReason: row.failure_reason ?? null,
        paidAt: row.paid_at ?? null,
        refundedAt: row.refunded_at ?? null,
        refundAmount: row.refund_amount ? parseFloat(row.refund_amount) : null,
        createdAt: row.created_at,
      }));

      return { success: true, data: { order, items, payments } };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },
};
