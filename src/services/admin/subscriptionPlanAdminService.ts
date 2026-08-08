/**
 * Admin Subscription Plan Management Service
 *
 * Course-scoped subscription plan CRUD for the Admin Dashboard — powers the
 * Commerce → Subscription Plans module (Phase 11K.9).
 *
 * Business rules enforced by the database (and surfaced here as friendly
 * errors):
 *   • A plan belongs to exactly ONE course (subscription_plans.course_id).
 *   • One plan per billing cycle per course
 *     (uq_subscription_plans_course_billing_cycle).
 *   • Slugs are unique within a course (uq_subscription_plans_course_slug).
 *   • Plans are never hard-deleted — they are deactivated via is_active.
 *
 * All writes carry `created_by` / `updated_by` (profiles.profile_id) for
 * auditability, matching the schema.
 *
 * @module services/admin/subscriptionPlanAdminService
 */

import { supabase } from '@/config/supabase';
import { buildPagination, extractErrorMessage } from '@/utils/supabase';
import { buildPaginatedResponse } from '@/utils/response';
import type { ApiResponse, PaginatedResponse, PaginationParams } from '@/types/academic';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

export type PlanBillingCycle = 'monthly' | 'quarterly' | 'half_yearly' | 'yearly';

export const BILLING_CYCLE_DURATION_DAYS: Record<PlanBillingCycle, number> = {
  monthly: 30,
  quarterly: 90,
  half_yearly: 182,
  yearly: 365,
};

export const PLAN_BILLING_CYCLE_OPTIONS: { value: PlanBillingCycle; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'half_yearly', label: 'Half-Yearly' },
  { value: 'yearly', label: 'Yearly' },
];

export function getBillingCycleLabel(cycle: string | null | undefined): string {
  switch (cycle) {
    case 'monthly': return 'Monthly';
    case 'quarterly': return 'Quarterly';
    case 'half_yearly': return 'Half-Yearly';
    case 'yearly': return 'Yearly';
    case 'lifetime': return 'Lifetime';
    case 'custom': return 'Custom';
    default: return cycle ?? '—';
  }
}

export interface SubscriptionPlanListItem {
  planId: string;
  courseId: string | null;
  courseTitle: string | null;
  name: string;
  slug: string;
  description: string | null;
  price: number;
  currencyCode: string;
  billingCycle: string | null;
  durationDays: number;
  trialDays: number;
  maxStudents: number | null;
  isActive: boolean;
  isFeatured: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionPlanFilters {
  courseId?: string;
  billingCycle?: string;
  status?: 'active' | 'inactive';
  search?: string;
  instituteId?: string;
}

export interface SubscriptionPlanSortOptions {
  sortBy?: 'createdAt' | 'price' | 'billingCycle' | 'isActive';
  sortDirection?: 'asc' | 'desc';
}

export interface CreateSubscriptionPlanInput {
  instituteId: string;
  courseId: string;
  name: string;
  description?: string | null;
  price: number;
  currencyCode?: string;
  billingCycle: PlanBillingCycle;
  durationDays: number;
  trialDays?: number;
  maxStudents?: number | null;
  isActive?: boolean;
  isFeatured?: boolean;
  sortOrder?: number;
  /** profiles.profile_id of the acting admin. */
  createdBy: string;
}

export interface DuplicateSubscriptionPlanInput {
  /** Target course for the copy (defaults to the source plan's course). */
  courseId: string;
  /** Billing cycle for the copy — must be free in the target course. */
  billingCycle: PlanBillingCycle;
  /** profiles.profile_id of the acting admin. */
  updatedBy: string;
}

export interface UpdateSubscriptionPlanInput {
  courseId?: string;
  name?: string;
  description?: string | null;
  price?: number;
  currencyCode?: string;
  billingCycle?: PlanBillingCycle;
  durationDays?: number;
  trialDays?: number;
  maxStudents?: number | null;
  isActive?: boolean;
  isFeatured?: boolean;
  sortOrder?: number;
  /** profiles.profile_id of the acting admin. */
  updatedBy: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Row shape + helpers
// ═══════════════════════════════════════════════════════════════════════════

interface SubscriptionPlanRow {
  plan_id: string;
  course_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  price: string | number;
  currency_code: string | null;
  billing_cycle: string | null;
  duration_days: number;
  trial_days: number;
  max_students: number | null;
  is_active: boolean;
  is_featured: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  courses?: { course_id: string; title: string | null } | null;
}

function mapPlanRow(row: SubscriptionPlanRow): SubscriptionPlanListItem {
  return {
    planId: row.plan_id,
    courseId: row.courses?.course_id ?? row.course_id ?? null,
    courseTitle: row.courses?.title ?? null,
    name: row.name,
    slug: row.slug,
    description: row.description ?? null,
    price: parseFloat(String(row.price ?? 0)),
    currencyCode: row.currency_code?.trim() ?? 'INR',
    billingCycle: row.billing_cycle ?? null,
    durationDays: row.duration_days,
    trialDays: row.trial_days ?? 0,
    maxStudents: row.max_students ?? null,
    isActive: row.is_active ?? true,
    isFeatured: row.is_featured ?? false,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Slugify a plan name into a URL-safe identifier. */
export function slugifyPlanName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120) || 'plan';
}

/**
 * Generate a slug unique within the given course by appending -2, -3, ...
 * when the base slug is already taken (uq_subscription_plans_course_slug).
 */
async function generateUniqueSlug(courseId: string, baseName: string): Promise<string> {
  const base = slugifyPlanName(baseName);
  const { data, error } = await supabase
    .from('subscription_plans')
    .select('slug')
    .eq('course_id', courseId)
    .ilike('slug', `${base}%`);

  if (error) {
    // Fail open: return the base slug and let the unique constraint
    // surface a retryable error rather than blocking plan creation.
    return base;
  }

  const existing = new Set((data ?? []).map((r) => r.slug as string));
  if (!existing.has(base)) return base;

  let i = 2;
  let slug = `${base}-${i}`;
  while (existing.has(slug)) {
    i += 1;
    slug = `${base}-${i}`;
  }
  return slug;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Service
// ═══════════════════════════════════════════════════════════════════════════

export const subscriptionPlanAdminService = {
  // ─────────────────────────────────────────────────────────────────────────
  //  1. List
  // ─────────────────────────────────────────────────────────────────────────

  /** Get a paginated, filtered list of course-scoped subscription plans. */
  async getSubscriptionPlans(
    filters?: SubscriptionPlanFilters,
    sort?: SubscriptionPlanSortOptions,
    pagination?: PaginationParams,
  ): Promise<ApiResponse<PaginatedResponse<SubscriptionPlanListItem>>> {
    try {
      let query = supabase
        .from('subscription_plans')
        .select(
          `
          *,
          courses!fk_subscription_plans_course ( course_id, title )
        `,
          { count: 'exact' },
        );

      // ── Filters ─────────────────────────────────────────────────────
      if (filters?.instituteId) {
        query = query.eq('institute_id', filters.instituteId);
      }
      if (filters?.courseId) {
        query = query.eq('course_id', filters.courseId);
      }
      if (filters?.billingCycle) {
        query = query.eq('billing_cycle', filters.billingCycle);
      }
      if (filters?.status) {
        query = query.eq('is_active', filters.status === 'active');
      }
      if (filters?.search) {
        const term = `%${filters.search}%`;
        query = query.or(`name.ilike.${term},slug.ilike.${term},courses.title.ilike.${term}`);
      }

      // ── Sorting + Pagination ────────────────────────────────────────
      const SORT_MAP: Record<string, string> = {
        createdAt: 'created_at',
        price: 'price',
        billingCycle: 'billing_cycle',
        isActive: 'is_active',
      };
      const sortBy = SORT_MAP[sort?.sortBy ?? 'createdAt'] ?? 'created_at';
      const direction = sort?.sortDirection ?? 'desc';
      query = query.order(sortBy, { ascending: direction === 'asc' });

      const { page, pageSize, from, to } = buildPagination(pagination);
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const items = (data ?? []).map((row: SubscriptionPlanRow) => mapPlanRow(row));

      return {
        success: true,
        data: buildPaginatedResponse(items, count ?? 0, page, pageSize),
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  2. Create
  // ─────────────────────────────────────────────────────────────────────────

  /** Create a new course-scoped subscription plan. */
  async createPlan(
    input: CreateSubscriptionPlanInput,
  ): Promise<ApiResponse<SubscriptionPlanListItem>> {
    try {
      // ── Validate ────────────────────────────────────────────────────
      if (!input.instituteId) return { success: false, error: 'Institute is required.' };
      if (!input.courseId) return { success: false, error: 'Course is required.' };
      if (!input.createdBy) return { success: false, error: 'Creator identity is required.' };
      if (!input.name?.trim() || input.name.trim().length < 2) {
        return { success: false, error: 'Plan name must be at least 2 characters.' };
      }
      if (!input.billingCycle) return { success: false, error: 'Billing cycle is required.' };
      if (input.price === undefined || input.price === null || input.price <= 0) {
        return { success: false, error: 'Price must be greater than 0.' };
      }
      if (!input.durationDays || input.durationDays <= 0) {
        return { success: false, error: 'Duration must be greater than 0 days.' };
      }
      if (input.trialDays != null && input.trialDays < 0) {
        return { success: false, error: 'Trial days cannot be negative.' };
      }
      if (input.maxStudents != null && input.maxStudents < 0) {
        return { success: false, error: 'Max students cannot be negative.' };
      }

      // ── Slug (unique within the course) ─────────────────────────────
      const slug = await generateUniqueSlug(input.courseId, input.name.trim());

      // ── Insert ──────────────────────────────────────────────────────
      const { data, error } = await supabase
        .from('subscription_plans')
        .insert({
          institute_id: input.instituteId,
          course_id: input.courseId,
          name: input.name.trim(),
          slug,
          description: input.description ?? null,
          price: input.price,
          currency_code: input.currencyCode ?? 'INR',
          billing_cycle: input.billingCycle,
          duration_days: input.durationDays,
          trial_days: input.trialDays ?? 0,
          max_students: input.maxStudents ?? null,
          is_active: input.isActive ?? true,
          is_featured: input.isFeatured ?? false,
          sort_order: input.sortOrder ?? 0,
          created_by: input.createdBy,
        })
        .select(
          `
          *,
          courses!fk_subscription_plans_course ( course_id, title )
        `,
        )
        .single();

      if (error) {
        if (error.code === '23505') {
          return {
            success: false,
            error:
              'This course already has a plan for this billing cycle (or a plan with the same slug). Each course can have only one plan per billing cycle with a unique slug.',
          };
        }
        if (error.code === '23503') {
          return {
            success: false,
            error: 'Cannot create the plan. The referenced course or creator does not exist.',
          };
        }
        return { success: false, error: extractErrorMessage(error) };
      }

      return { success: true, data: mapPlanRow(data as SubscriptionPlanRow) };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  3. Update
  // ─────────────────────────────────────────────────────────────────────────

  /** Update fields of an existing plan. */
  async updatePlan(
    planId: string,
    input: UpdateSubscriptionPlanInput,
  ): Promise<ApiResponse<SubscriptionPlanListItem>> {
    try {
      if (!planId) return { success: false, error: 'Plan is required.' };
      if (!input.updatedBy) return { success: false, error: 'Actor identity is required.' };

      // ── Build update payload (only provided fields) ─────────────────
      const dbRecord: Record<string, unknown> = { updated_by: input.updatedBy };

      if (input.courseId !== undefined) dbRecord.course_id = input.courseId;
      if (input.name !== undefined) {
        if (input.name.trim().length < 2) {
          return { success: false, error: 'Plan name must be at least 2 characters.' };
        }
        dbRecord.name = input.name.trim();
      }
      if (input.description !== undefined) dbRecord.description = input.description;
      if (input.price !== undefined) {
        if (input.price <= 0) return { success: false, error: 'Price must be greater than 0.' };
        dbRecord.price = input.price;
      }
      if (input.currencyCode !== undefined) dbRecord.currency_code = input.currencyCode;
      if (input.billingCycle !== undefined) dbRecord.billing_cycle = input.billingCycle;
      if (input.durationDays !== undefined) {
        if (input.durationDays <= 0) {
          return { success: false, error: 'Duration must be greater than 0 days.' };
        }
        dbRecord.duration_days = input.durationDays;
      }
      if (input.trialDays !== undefined) {
        if (input.trialDays < 0) return { success: false, error: 'Trial days cannot be negative.' };
        dbRecord.trial_days = input.trialDays;
      }
      if (input.maxStudents !== undefined) dbRecord.max_students = input.maxStudents;
      if (input.isActive !== undefined) dbRecord.is_active = input.isActive;
      if (input.isFeatured !== undefined) dbRecord.is_featured = input.isFeatured;
      if (input.sortOrder !== undefined) dbRecord.sort_order = input.sortOrder;

      // ── Update ──────────────────────────────────────────────────────
      const { data, error } = await supabase
        .from('subscription_plans')
        .update(dbRecord)
        .eq('plan_id', planId)
        .select(
          `
          *,
          courses!fk_subscription_plans_course ( course_id, title )
        `,
        )
        .single();

      if (error) {
        if (error.code === '23505') {
          return {
            success: false,
            error:
              'This change conflicts with another plan — each course can have only one plan per billing cycle with a unique slug.',
          };
        }
        return { success: false, error: extractErrorMessage(error) };
      }

      return { success: true, data: mapPlanRow(data as SubscriptionPlanRow) };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  4. Duplicate
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Duplicate a plan into a chosen (course, billing cycle).
   *
   * Because the schema enforces one plan per billing cycle per course
   * (uq_subscription_plans_course_billing_cycle), the copy CANNOT keep both
   * the source course AND source cycle — the admin picks the target course
   * and cycle. The copy is created INACTIVE so it is never sold by accident.
   */
  async duplicatePlan(
    planId: string,
    input: DuplicateSubscriptionPlanInput,
  ): Promise<ApiResponse<SubscriptionPlanListItem>> {
    try {
      if (!planId) return { success: false, error: 'Plan is required.' };
      if (!input.courseId) return { success: false, error: 'Target course is required.' };
      if (!input.billingCycle) return { success: false, error: 'Billing cycle is required.' };
      if (!input.updatedBy) return { success: false, error: 'Actor identity is required.' };

      const { data: source, error: fetchError } = await supabase
        .from('subscription_plans')
        .select(
          `
          institute_id,
          name,
          description,
          price,
          currency_code,
          duration_days,
          trial_days,
          max_students
        `,
        )
        .eq('plan_id', planId)
        .single();

      if (fetchError) {
        return { success: false, error: extractErrorMessage(fetchError) };
      }

      const copyName = `${source.name} (Copy)`;
      const slug = await generateUniqueSlug(input.courseId, copyName);

      const { data, error } = await supabase
        .from('subscription_plans')
        .insert({
          institute_id: source.institute_id,
          course_id: input.courseId,
          name: copyName,
          slug,
          description: source.description,
          price: source.price,
          currency_code: source.currency_code ?? 'INR',
          billing_cycle: input.billingCycle,
          duration_days: source.duration_days,
          trial_days: source.trial_days ?? 0,
          max_students: source.max_students ?? null,
          is_active: false, // safety: never auto-activate a duplicate
          is_featured: false,
          sort_order: 0,
          created_by: input.updatedBy,
        })
        .select(
          `
          *,
          courses!fk_subscription_plans_course ( course_id, title )
        `,
        )
        .single();

      if (error) {
        if (error.code === '23505') {
          return {
            success: false,
            error:
              'The target course already has a plan for this billing cycle (or a plan with the same slug). Pick a different cycle or course.',
          };
        }
        return { success: false, error: extractErrorMessage(error) };
      }

      return { success: true, data: mapPlanRow(data as SubscriptionPlanRow) };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  5. Activate / Deactivate
  // ─────────────────────────────────────────────────────────────────────────

  /** Toggle is_active (soft delete / restore). */
  async setPlanActive(
    planId: string,
    isActive: boolean,
    updatedBy: string,
  ): Promise<ApiResponse<SubscriptionPlanListItem>> {
    try {
      if (!planId) return { success: false, error: 'Plan is required.' };
      if (!updatedBy) return { success: false, error: 'Actor identity is required.' };

      const { data, error } = await supabase
        .from('subscription_plans')
        .update({ is_active: isActive, updated_by: updatedBy })
        .eq('plan_id', planId)
        .select(
          `
          *,
          courses!fk_subscription_plans_course ( course_id, title )
        `,
        )
        .single();

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      return { success: true, data: mapPlanRow(data as SubscriptionPlanRow) };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },
};
