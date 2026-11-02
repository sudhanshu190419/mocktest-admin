/**
 * Admin Course Installment Plan Management Service
 *
 * Provides CRUD operations for public.course_installment_plans in the
 * Admin Panel Commerce module.
 *
 * Adheres strictly to database-level protections:
 *   - Migration 219 (Schema & ON DELETE RESTRICT on financial history)
 *   - Migration 220 (RLS: authenticated students read active plans; admins manage all)
 *   - Migration 221 (Immutability: financial terms locked once agreements exist;
 *     FOR SHARE locking; exact rounding reconciliation)
 *
 * @module services/admin/installmentPlanAdminService
 */

import { supabase } from '@/config/supabase';
import { buildPagination, extractErrorMessage } from '@/utils/supabase';
import { buildPaginatedResponse } from '@/utils/response';
import type { ApiResponse, PaginatedResponse, PaginationParams } from '@/types/academic';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

export interface CourseInstallmentPlan {
  planId: string;
  courseId: string;
  planName: string;
  totalFee: number;
  numberOfInstallments: number;
  intervalMonths: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  courseTitle?: string | null;
  agreementsCount?: number;
}

export type InstallmentPlanListItem = CourseInstallmentPlan;

export interface CreateInstallmentPlanInput {
  courseId: string;
  planName: string;
  totalFee: number;
  numberOfInstallments: number;
  intervalMonths: number;
  isActive?: boolean;
}

export interface UpdateInstallmentPlanInput {
  planName?: string;
  isActive?: boolean;
  courseId?: string;
  totalFee?: number;
  numberOfInstallments?: number;
  intervalMonths?: number;
}

export interface InstallmentPlanFilters {
  courseId?: string;
  status?: 'active' | 'inactive';
  search?: string;
  instituteId?: string;
}

export interface InstallmentPlanSortOptions {
  sortBy: 'createdAt' | 'totalFee' | 'planName' | 'numberOfInstallments' | 'intervalMonths' | 'isActive';
  sortDirection: 'asc' | 'desc';
}

interface CourseInstallmentPlanRow {
  plan_id: string;
  course_id: string;
  plan_name: string;
  total_fee: number | string;
  number_of_installments: number;
  interval_months: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  courses?: {
    course_id: string;
    title: string;
  } | null;
  student_course_agreements?: { count: number }[] | null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function mapRowToPlan(row: CourseInstallmentPlanRow): InstallmentPlanListItem {
  const agreements = row.student_course_agreements;
  const agreementsCount = Array.isArray(agreements) && agreements.length > 0
    ? agreements[0].count
    : 0;

  return {
    planId: row.plan_id,
    courseId: row.course_id,
    planName: row.plan_name,
    totalFee: Number(row.total_fee),
    numberOfInstallments: Number(row.number_of_installments),
    intervalMonths: Number(row.interval_months),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    courseTitle: row.courses?.title ?? null,
    agreementsCount,
  };
}

/**
 * Calculates a preview of installment schedule tranches according to
 * Migration 221 remainder-absorption rules:
 *   - Tranches 1 through N-1: ROUND(totalFee / N, 2)
 *   - Tranche N: totalFee - (standardTranche * (N - 1))
 */
export function calculateInstallmentSchedulePreview(
  totalFee: number,
  numberOfInstallments: number,
  intervalMonths: number = 1,
): { index: number; amountDue: number; isRemainderAbsorber: boolean; monthOffset: number }[] {
  if (!totalFee || totalFee <= 0 || !numberOfInstallments || numberOfInstallments < 1) {
    return [];
  }

  const standardTranche = Math.round((totalFee / numberOfInstallments) * 100) / 100;
  const finalTranche = Math.round((totalFee - standardTranche * (numberOfInstallments - 1)) * 100) / 100;

  const schedule = [];
  for (let i = 1; i <= numberOfInstallments; i++) {
    const isFinal = i === numberOfInstallments;
    schedule.push({
      index: i,
      amountDue: isFinal ? finalTranche : standardTranche,
      isRemainderAbsorber: isFinal && finalTranche !== standardTranche,
      monthOffset: (i - 1) * intervalMonths,
    });
  }
  return schedule;
}

export function formatIntervalLabel(intervalMonths: number): string {
  if (intervalMonths === 1) return 'Monthly';
  if (intervalMonths === 2) return 'Bi-Monthly (Every 2 months)';
  if (intervalMonths === 3) return 'Quarterly (Every 3 months)';
  if (intervalMonths === 6) return 'Half-Yearly (Every 6 months)';
  if (intervalMonths === 12) return 'Annually (Every 12 months)';
  return `Every ${intervalMonths} months`;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Service
// ═══════════════════════════════════════════════════════════════════════════

export const installmentPlanAdminService = {
  /**
   * Retrieves a paginated list of installment plans.
   */
  async getInstallmentPlans(
    filters?: InstallmentPlanFilters,
    sort?: InstallmentPlanSortOptions,
    pagination?: PaginationParams,
  ): Promise<ApiResponse<PaginatedResponse<InstallmentPlanListItem>>> {
    try {
      let query = supabase
        .from('course_installment_plans')
        .select(
          `
          *,
          courses ( course_id, title ),
          student_course_agreements ( count )
        `,
          { count: 'exact' },
        );

      if (filters?.courseId) {
        query = query.eq('course_id', filters.courseId);
      }
      if (filters?.status) {
        query = query.eq('is_active', filters.status === 'active');
      }
      if (filters?.search) {
        const term = `%${filters.search}%`;
        query = query.ilike('plan_name', term);
      }

      // Sorting
      const SORT_MAP: Record<string, string> = {
        createdAt: 'created_at',
        totalFee: 'total_fee',
        planName: 'plan_name',
        numberOfInstallments: 'number_of_installments',
        intervalMonths: 'interval_months',
        isActive: 'is_active',
      };
      const sortBy = SORT_MAP[sort?.sortBy ?? 'createdAt'] ?? 'created_at';
      const direction = sort?.sortDirection ?? 'desc';
      query = query.order(sortBy, { ascending: direction === 'asc' });

      // Pagination
      const { from, to, page, pageSize } = buildPagination(pagination);
      query = query.range(from, to);

      const { data, count, error } = await query;

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const items: InstallmentPlanListItem[] = (data ?? []).map((row: unknown) =>
        mapRowToPlan(row as CourseInstallmentPlanRow),
      );

      return {
        success: true,
        data: buildPaginatedResponse(items, count ?? 0, page, pageSize),
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  /**
   * Retrieves a single installment plan with course and agreement count.
   */
  async getInstallmentPlan(planId: string): Promise<ApiResponse<InstallmentPlanListItem>> {
    try {
      const { data, error } = await supabase
        .from('course_installment_plans')
        .select(
          `
          *,
          courses ( course_id, title ),
          student_course_agreements ( count )
        `,
        )
        .eq('plan_id', planId)
        .single();

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }
      if (!data) {
        return { success: false, error: 'Installment plan not found.' };
      }

      return { success: true, data: mapRowToPlan(data as CourseInstallmentPlanRow) };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  /**
   * Checks whether a plan is referenced by any student course agreements.
   * Useful for informing the admin UI before attempting edits.
   */
  async checkPlanHasAgreements(planId: string): Promise<ApiResponse<boolean>> {
    try {
      const { count, error } = await supabase
        .from('student_course_agreements')
        .select('*', { count: 'exact', head: true })
        .eq('plan_id', planId);

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      return { success: true, data: (count ?? 0) > 0 };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  /**
   * Creates a new course installment plan.
   */
  async createInstallmentPlan(
    input: CreateInstallmentPlanInput,
  ): Promise<ApiResponse<CourseInstallmentPlan>> {
    try {
      if (!input.courseId || !input.courseId.trim()) {
        return { success: false, error: 'A course must be selected.' };
      }
      const planName = input.planName?.trim() ?? '';
      if (!planName || planName.length < 2) {
        return { success: false, error: 'Plan name must be at least 2 characters.' };
      }
      const totalFee = Number(input.totalFee);
      if (!Number.isFinite(totalFee) || totalFee <= 0) {
        return { success: false, error: 'Total fee must be a positive number greater than 0.' };
      }
      const numberOfInstallments = Number(input.numberOfInstallments);
      if (
        !Number.isFinite(numberOfInstallments) ||
        !Number.isInteger(numberOfInstallments) ||
        numberOfInstallments < 1 ||
        numberOfInstallments > 32767
      ) {
        return {
          success: false,
          error: 'Number of installments must be an integer from 1 through 32767.',
        };
      }
      const intervalMonths = Number(input.intervalMonths);
      if (
        !Number.isFinite(intervalMonths) ||
        !Number.isInteger(intervalMonths) ||
        intervalMonths < 1 ||
        intervalMonths > 32767
      ) {
        return {
          success: false,
          error: 'Interval in months must be an integer from 1 through 32767.',
        };
      }

      const payload = {
        course_id: input.courseId,
        plan_name: planName,
        total_fee: Math.round(totalFee * 100) / 100,
        number_of_installments: numberOfInstallments,
        interval_months: intervalMonths,
        is_active: input.isActive ?? true,
      };

      const { data, error } = await supabase
        .from('course_installment_plans')
        .insert(payload)
        .select('*, courses ( course_id, title )')
        .single();

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      return { success: true, data: mapRowToPlan(data as CourseInstallmentPlanRow) };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  /**
   * Updates an installment plan.
   *
   * Migration 221 Database Trigger trg_enforce_installment_plan_immutability
   * prohibits modifying financial parameters (course_id, total_fee,
   * number_of_installments, interval_months) if student agreements already exist.
   * Plan name and active status are always editable.
   */
  async updateInstallmentPlan(
    planId: string,
    input: UpdateInstallmentPlanInput,
  ): Promise<ApiResponse<CourseInstallmentPlan>> {
    try {
      const payload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (input.planName !== undefined) {
        const planName = input.planName.trim();
        if (!planName || planName.length < 2) {
          return { success: false, error: 'Plan name must be at least 2 characters.' };
        }
        payload.plan_name = planName;
      }

      if (input.isActive !== undefined) {
        payload.is_active = Boolean(input.isActive);
      }

      if (input.courseId !== undefined) {
        if (!input.courseId.trim()) {
          return { success: false, error: 'Course cannot be empty.' };
        }
        payload.course_id = input.courseId;
      }

      if (input.totalFee !== undefined) {
        const totalFee = Number(input.totalFee);
        if (!Number.isFinite(totalFee) || totalFee <= 0) {
          return { success: false, error: 'Total fee must be a positive number greater than 0.' };
        }
        payload.total_fee = Math.round(totalFee * 100) / 100;
      }

      if (input.numberOfInstallments !== undefined) {
        const numberOfInstallments = Number(input.numberOfInstallments);
        if (
          !Number.isFinite(numberOfInstallments) ||
          !Number.isInteger(numberOfInstallments) ||
          numberOfInstallments < 1 ||
          numberOfInstallments > 32767
        ) {
          return {
            success: false,
            error: 'Number of installments must be an integer from 1 through 32767.',
          };
        }
        payload.number_of_installments = numberOfInstallments;
      }

      if (input.intervalMonths !== undefined) {
        const intervalMonths = Number(input.intervalMonths);
        if (
          !Number.isFinite(intervalMonths) ||
          !Number.isInteger(intervalMonths) ||
          intervalMonths < 1 ||
          intervalMonths > 32767
        ) {
          return {
            success: false,
            error: 'Interval in months must be an integer from 1 through 32767.',
          };
        }
        payload.interval_months = intervalMonths;
      }

      const { data, error } = await supabase
        .from('course_installment_plans')
        .update(payload)
        .eq('plan_id', planId)
        .select('*, courses ( course_id, title ), student_course_agreements ( count )')
        .single();

      if (error) {
        const msg = extractErrorMessage(error);
        if (msg.includes('Cannot modify financial parameters') || error.code === '23514') {
          return {
            success: false,
            error:
              'Financial terms (course, total fee, installments, interval) cannot be modified because student agreements already reference this plan. To change terms, deactivate this plan and create a new plan.',
          };
        }
        return { success: false, error: msg };
      }

      return { success: true, data: mapRowToPlan(data as CourseInstallmentPlanRow) };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  /**
   * Deactivates or activates an installment plan.
   * Plan deactivation is non-destructive and preserves all existing agreements.
   */
  async setInstallmentPlanActive(
    planId: string,
    isActive: boolean,
  ): Promise<ApiResponse<CourseInstallmentPlan>> {
    return this.updateInstallmentPlan(planId, { isActive });
  },
};
