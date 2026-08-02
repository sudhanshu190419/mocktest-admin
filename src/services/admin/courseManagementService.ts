/**
 * Course Management Service
 *
 * Single source of truth for all course management operations in the
 * Admin Course Management module.
 *
 * Every public method returns a standardised `ApiResponse<T>` shape.
 * Follows the exact same architecture as `batchManagementService.ts`,
 * `mockTestManagementService.ts`, `teacherLifecycleService.ts`, and
 * `studentLifecycleService.ts`.
 *
 * ## Scope
 *
 * This service manages the lifecycle of courses via the `courses.status`
 * column.  It does NOT manage:
 * - Teacher assignment to a course (handled by courseTeacherService — Phase 2B)
 * - Batch assignment to a course (handled by courseBatchService — Phase 2B)
 * - Content assignment to a course (handled by courseContentService — Phase 2B)
 * - Enrollments (handled by courseEnrollmentService — future phase)
 * - Purchases (handled by commerce services)
 * - Reviews or analytics
 *
 * ## Status Transitions
 *
 * ```
 *                  ┌──────────────┐
 *                  │    draft     │
 *                  └──────┬───────┘
 *              ┌──────────┴──────────┐
 *              ▼                     ▼
 *         ┌──────────────┐    ┌──────────────┐
 *         │   published  │    │ pending_     │
 *         │              │    │ approval     │
 *         └──────┬───────┘    └──────┬───────┘
 *                ▼                    │
 *         ┌──────────────┐            ▼
 *         │   archived   │    ┌──────────────┐
 *         └──────┬───────┘    │  approved   │
 *                ▼            └──────┬───────┘
 *         ┌──────────────┐           ▼
 *         │   published  │    ┌──────────────┐
 *         └──────────────┘    │   published  │
 *                              └──────────────┘
 * ```
 *
 * @module services/admin/courseManagementService
 */

import { supabase } from '@/config/supabase';
import { buildPagination, extractErrorMessage, validateUUID } from '@/utils/supabase';
import { buildPaginatedResponse } from '@/utils/response';
import { auditService } from '@/services/audit/auditService';
import type { ApiResponse, PaginatedResponse, PaginationParams, SortDirection } from '@/types/academic';
import { canApproveAcademicResources, approvalPermissionDenied } from './approvalGuard';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

/** All possible course status values from the course_status PostgreSQL enum. */
export type CourseStatus = 'draft' | 'pending_approval' | 'approved' | 'published' | 'archived';

/** Dashboard counts grouped by course status. */
export interface CourseManagementCounts {
  draft: number;
  pendingApproval: number;
  approved: number;
  published: number;
  archived: number;
  /** Sum of all statuses above. */
  total: number;
}

/** A single course row in the admin course list. */
export interface CourseListItem {
  courseId: string;
  title: string;
  slug: string;
  shortDescription: string | null;
  thumbnailBucket: string | null;
  thumbnailPath: string | null;
  language: string | null;
  difficultyLevel: string | null;
  duration: number | null;
  originalPrice: number;
  discountedPrice: number | null;
  currency: string;
  status: CourseStatus;
  featured: boolean;
  trending: boolean;
  sortOrder: number;
  streamId: string;
  streamName: string | null;
  teachersCount: number;
  batchesCount: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Detailed course for the detail view. */
export interface CourseManagementDetail extends CourseListItem {
  /** Full marketing description. */
  description: string | null;
  bannerBucket: string | null;
  bannerPath: string | null;
  /** Admin who created this course. */
  createdBy: string | null;
  /** Admin who last updated this course. */
  updatedBy: string | null;
  /** Soft-delete timestamp. */
  deletedAt: string | null;
  /** Number of content items assigned to this course. */
  contentCount: number;
  /** Number of enrollments (active). */
  enrollmentCount: number;
  /** List of teachers assigned to this course (basic info). */
  teachers: {
    teacherId: string;
    name: string;
    role: string | null;
  }[];
  /** List of batches assigned to this course (basic info). */
  batches: {
    batchId: string;
    name: string;
    batchCode: string;
  }[];
}

/** Statistics for the course management dashboard. */
export interface CourseManagementStats {
  /** Count of courses grouped by stream. */
  byStream: { streamName: string; count: number }[];
  /** Count of courses grouped by status. */
  byStatus: { status: string; count: number }[];
  /** Most recently created courses (last 10). */
  newestCourses: CourseListItem[];
  /** Courses with the highest enrollment count (top 10). */
  mostEnrolled: CourseListItem[];
  /** Pricing overview across all published courses. */
  pricingOverview: {
    /** Average original price of published courses. */
    avgOriginalPrice: number;
    /** Average discounted price of published courses with discounts. */
    avgDiscountedPrice: number;
    /** Count of free courses (original_price = 0). */
    freeCourseCount: number;
  };
}

/** Filters for the course list query. */
export interface CourseManagementFilters {
  instituteId?: string;
  /** Filter by course status (comma-separated for multiple). */
  status?: string;
  /** Filter by stream ID. */
  streamId?: string;
  /** Filter by teacher ID (via course_teachers junction). */
  teacherId?: string;
  /** Filter featured courses only. */
  featured?: boolean;
  /** Filter trending courses only. */
  trending?: boolean;
  /** Search across title, slug, and short_description (case-insensitive). */
  search?: string;
}

/** Sort options for the course list query. */
export interface CourseManagementSortOptions {
  sortBy?: 'title' | 'status' | 'featured' | 'trending' | 'originalPrice' | 'discountedPrice' | 'duration' | 'createdAt' | 'updatedAt' | 'publishedAt';
  sortDirection?: SortDirection;
}

/** Input for creating a new course. */
export interface CreateCourseInput {
  instituteId: string;
  streamId: string;
  title: string;
  slug?: string;
  shortDescription?: string | null;
  description?: string | null;
  language?: string | null;
  difficultyLevel?: string | null;
  duration?: number | null;
  originalPrice: number;
  discountedPrice?: number | null;
  currency?: string;
  featured?: boolean;
  trending?: boolean;
  sortOrder?: number;
  createdBy?: string | null;
}

/** Input for updating an existing course. */
export interface UpdateCourseInput {
  title?: string;
  slug?: string;
  shortDescription?: string | null;
  description?: string | null;
  language?: string | null;
  difficultyLevel?: string | null;
  duration?: number | null;
  originalPrice?: number;
  discountedPrice?: number | null;
  currency?: string;
  featured?: boolean;
  trending?: boolean;
  sortOrder?: number;
  streamId?: string;
  updatedBy?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

const SORT_FIELD_MAP: Record<string, string> = {
  title: 'title',
  status: 'status',
  featured: 'featured',
  trending: 'trending',
  originalPrice: 'original_price',
  discountedPrice: 'discounted_price',
  duration: 'duration',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  publishedAt: 'published_at',
};

/** Valid lifecycle status transitions for courses in admin management. */
const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ['published', 'pending_approval', 'archived'],
  pending_approval: ['published', 'draft'],
  approved: ['published', 'draft'],
  published: ['archived', 'draft'],
  archived: ['published'],
};

/** Slug generation: lowercases, replaces spaces with hyphens, removes special chars. */
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 300) || 'untitled';
}

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function mapSortField(sortBy?: CourseManagementSortOptions['sortBy']): string {
  return SORT_FIELD_MAP[sortBy ?? 'createdAt'] ?? 'created_at';
}

/**
 * Validates that a status transition is allowed.
 * Returns an error message if invalid, or null if allowed.
 */
function validateTransition(currentStatus: string, newStatus: string): string | null {
  const allowed = VALID_TRANSITIONS[currentStatus];
  if (!allowed) {
    return `Unknown current status: "${currentStatus}".`;
  }
  if (!allowed.includes(newStatus)) {
    return `Invalid status transition: "${currentStatus}" → "${newStatus}". Allowed: ${allowed.join(', ')}`;
  }
  return null;
}

/** Maps a raw Supabase row (courses JOIN streams) to CourseListItem. */
function toCourseListItem(row: any): CourseListItem {
  return {
    courseId: row.course_id,
    title: row.title,
    slug: row.slug,
    shortDescription: row.short_description ?? null,
    thumbnailBucket: row.thumbnail_bucket ?? null,
    thumbnailPath: row.thumbnail_path ?? null,
    language: row.language ?? null,
    difficultyLevel: row.difficulty_level ?? null,
    duration: row.duration ?? null,
    originalPrice: parseFloat(row.original_price ?? 0),
    discountedPrice: row.discounted_price !== null ? parseFloat(row.discounted_price) : null,
    currency: row.currency ?? 'INR',
    status: row.status as CourseStatus,
    featured: row.featured ?? false,
    trending: row.trending ?? false,
    sortOrder: row.sort_order ?? 0,
    streamId: row.stream_id,
    streamName: row.streams?.name ?? null,
    teachersCount: typeof row.teachers_count === 'number' ? row.teachers_count : 0,
    batchesCount: typeof row.batches_count === 'number' ? row.batches_count : 0,
    publishedAt: row.published_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Service
// ═══════════════════════════════════════════════════════════════════════════

export const courseManagementService = {
  // ─────────────────────────────────────────────────────────────────────────
  //  1. Dashboard Counts
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get course management dashboard counts grouped by status.
   */
  async getCounts(instituteId?: string | null): Promise<ApiResponse<CourseManagementCounts>> {
    try {
      const makeQuery = (status: CourseStatus) => {
        let q = supabase
          .from('courses')
          .select('course_id', { count: 'exact', head: true })
          .eq('status', status)
          .is('deleted_at', null);
        if (instituteId) {
          q = q.eq('institute_id', instituteId);
        }
        return q;
      };

      const [draft, pendingApproval, approved, published, archived] = await Promise.all([
        makeQuery('draft'),
        makeQuery('pending_approval'),
        makeQuery('approved'),
        makeQuery('published'),
        makeQuery('archived'),
      ]);

      const counts: CourseManagementCounts = {
        draft: draft.count ?? 0,
        pendingApproval: pendingApproval.count ?? 0,
        approved: approved.count ?? 0,
        published: published.count ?? 0,
        archived: archived.count ?? 0,
        total: 0,
      };
      counts.total = counts.draft + counts.pendingApproval + counts.approved + counts.published + counts.archived;

      return { success: true, data: counts };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  2. Course List
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a paginated, filtered, and sorted list of courses.
   *
   * Joins `courses` with `streams` and includes counts for teachers and
   * batches via subqueries.  Supports search, status filter, stream filter,
   * teacher filter, featured/trending filter, pagination, and sorting.
   *
   * Soft-deleted courses (deleted_at IS NOT NULL) are excluded by default.
   */
  async getList(
    filters?: CourseManagementFilters,
    sort?: CourseManagementSortOptions,
    pagination?: PaginationParams,
  ): Promise<ApiResponse<PaginatedResponse<CourseListItem>>> {
    try {
      let query = supabase
        .from('courses')
        .select(
          `
          *,
          streams!left (
            name
          )
        `,
          { count: 'exact' },
        )
        .is('deleted_at', null);

      // ── Filters ─────────────────────────────────────────────────────
      if (filters?.instituteId) {
        query = query.eq('institute_id', filters.instituteId);
      }

      if (filters?.status) {
        const statuses = filters.status.split(',').map((s) => s.trim());
        if (statuses.length === 1) {
          query = query.eq('status', statuses[0]);
        } else {
          query = query.in('status', statuses);
        }
      }

      if (filters?.streamId) {
        query = query.eq('stream_id', filters.streamId);
      }

      if (filters?.teacherId) {
        // Filter via course_teachers junction
        const { data: courseIds } = await supabase
          .from('course_teachers')
          .select('course_id')
          .eq('teacher_id', filters.teacherId);

        const ids = (courseIds ?? []).map((r: any) => r.course_id);
        if (ids.length === 0) {
          return {
            success: true,
            data: buildPaginatedResponse([], 0, pagination?.page ?? 1, pagination?.pageSize ?? 20),
          };
        }
        query = query.in('course_id', ids);
      }

      if (filters?.featured !== undefined) {
        query = query.eq('featured', filters.featured);
      }

      if (filters?.trending !== undefined) {
        query = query.eq('trending', filters.trending);
      }

      if (filters?.search) {
        const term = `%${filters.search}%`;
        query = query.or(
          `title.ilike.${term},slug.ilike.${term},short_description.ilike.${term}`,
        );
      }

      // ── Sorting ────────────────────────────────────────────────────
      const sortBy = mapSortField(sort?.sortBy);
      const direction = sort?.sortDirection ?? 'desc';
      query = query.order(sortBy, { ascending: direction === 'asc' });

      // ── Pagination ──────────────────────────────────────────────────
      const { page, pageSize, from, to } = buildPagination(pagination);
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      // Build items with teacher/batch counts from separate queries
      const courseIdList = (data ?? []).map((row: any) => row.course_id);

      // Fetch teacher and batch counts in parallel for all courses
      let teachersCountMap = new Map<string, number>();
      let batchesCountMap = new Map<string, number>();

      if (courseIdList.length > 0) {
        const [teachersRes, batchesRes] = await Promise.allSettled([
          // Teacher counts per course
          supabase
            .from('course_teachers')
            .select('course_id, count:teacher_id', { count: 'exact' })
            .in('course_id', courseIdList),
          // Batch counts per course
          supabase
            .from('course_batches')
            .select('course_id, count:batch_id', { count: 'exact' })
            .in('course_id', courseIdList),
        ]);

        if (teachersRes.status === 'fulfilled' && teachersRes.value.data) {
          for (const row of teachersRes.value.data as any[]) {
            teachersCountMap.set(row.course_id, typeof row.count === 'number' ? row.count : 0);
          }
        }
        if (batchesRes.status === 'fulfilled' && batchesRes.value.data) {
          for (const row of batchesRes.value.data as any[]) {
            batchesCountMap.set(row.course_id, typeof row.count === 'number' ? row.count : 0);
          }
        }
      }

      const items = (data ?? []).map((row: any) => ({
        ...toCourseListItem(row),
        teachersCount: teachersCountMap.get(row.course_id) ?? 0,
        batchesCount: batchesCountMap.get(row.course_id) ?? 0,
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
  //  3. Course Detail
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the full details for a single course, including teacher info,
   * batch info, content count, enrollment count, and metadata.
   */
  async getDetail(courseId: string): Promise<ApiResponse<CourseManagementDetail>> {
    try {
      validateUUID(courseId, 'courseId');

      // 1. Fetch course with stream join
      const { data: course, error: courseErr } = await supabase
        .from('courses')
        .select(
          `
          *,
          streams!left (
            name
          )
        `,
        )
        .eq('course_id', courseId)
        .single();

      if (courseErr) {
        if (courseErr.code === 'PGRST116') {
          return { success: false, error: `Course not found: ${courseId}` };
        }
        return { success: false, error: extractErrorMessage(courseErr) };
      }

      // 2. Fetch related data in parallel
      const [teachersRes, batchesRes, contentRes, enrollmentsRes] = await Promise.allSettled([
        // Teachers assigned to this course
        supabase
          .from('course_teachers')
          .select(
            `
            teacher_id,
            role,
            teacher_details!inner (
              teacher_id,
              profiles!inner (
                name
              )
            )
          `,
          )
          .eq('course_id', courseId),

        // Batches assigned to this course
        supabase
          .from('course_batches')
          .select(
            `
            batch_id,
            batches!inner (
              batch_id,
              name,
              batch_code
            )
          `,
          )
          .eq('course_id', courseId),

        // Content items count
        supabase
          .from('course_content')
          .select('content_id', { count: 'exact', head: true })
          .eq('course_id', courseId),

        // Active enrollment count
        supabase
          .from('course_enrollments')
          .select('enrollment_id', { count: 'exact', head: true })
          .eq('course_id', courseId)
          .eq('is_active', true),
      ]);

      // Process teachers
      const teacherData = teachersRes.status === 'fulfilled' ? teachersRes.value.data ?? [] : [];
      const teachers = (Array.isArray(teacherData) ? teacherData : []).map((row: any) => ({
        teacherId: row.teacher_details?.teacher_id ?? row.teacher_id,
        name: row.teacher_details?.profiles?.name ?? 'Unknown',
        role: row.role ?? null,
      }));

      // Process batches
      const batchData = batchesRes.status === 'fulfilled' ? batchesRes.value.data ?? [] : [];
      const batches = (Array.isArray(batchData) ? batchData : []).map((row: any) => ({
        batchId: row.batches?.batch_id ?? row.batch_id,
        name: row.batches?.name ?? 'Unknown',
        batchCode: row.batches?.batch_code ?? '',
      }));

      // Process counts
      const contentCount = contentRes.status === 'fulfilled' ? (contentRes.value.count ?? 0) : 0;
      const enrollmentCount = enrollmentsRes.status === 'fulfilled' ? (enrollmentsRes.value.count ?? 0) : 0;

      const baseItem = toCourseListItem(course);

      const detail: CourseManagementDetail = {
        ...baseItem,
        description: course.description ?? null,
        bannerBucket: course.banner_bucket ?? null,
        bannerPath: course.banner_path ?? null,
        createdBy: course.created_by,
        updatedBy: course.updated_by,
        deletedAt: course.deleted_at ?? null,
        contentCount,
        enrollmentCount,
        teachers,
        batches,
      };

      return { success: true, data: detail };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  4. Create
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a new course.
   *
   * Validates required fields, auto-generates a slug from the title,
   * and delegates to the courses table.
   *
   * @param input - The course creation payload.
   */
  async createCourse(input: CreateCourseInput): Promise<ApiResponse<CourseListItem>> {
    try {
      // ── Validate required fields ───────────────────────────────────────
      if (!input.instituteId) {
        return { success: false, error: 'instituteId is required.' };
      }
      if (!input.streamId) {
        return { success: false, error: 'streamId is required.' };
      }
      if (!input.title?.trim()) {
        return { success: false, error: 'title is required.' };
      }
      if (input.title.trim().length < 3) {
        return { success: false, error: 'title must be at least 3 characters.' };
      }
      if (input.originalPrice === undefined || input.originalPrice === null) {
        return { success: false, error: 'originalPrice is required.' };
      }
      if (input.originalPrice < 0) {
        return { success: false, error: 'originalPrice must be >= 0.' };
      }
      if (input.discountedPrice !== undefined && input.discountedPrice !== null && input.discountedPrice < 0) {
        return { success: false, error: 'discountedPrice must be >= 0.' };
      }
      if (input.discountedPrice !== undefined && input.discountedPrice !== null && input.discountedPrice > input.originalPrice) {
        return { success: false, error: 'discountedPrice cannot exceed originalPrice.' };
      }

      // ── Validate UUID formats ──────────────────────────────────────────
      validateUUID(input.instituteId, 'instituteId');
      validateUUID(input.streamId, 'streamId');

      // ── Generate slug if not provided ──────────────────────────────────
      const slug = input.slug?.trim() ? input.slug.trim() : generateSlug(input.title);

      // ── Build DB record ────────────────────────────────────────────────
      const dbRecord: Record<string, unknown> = {
        institute_id: input.instituteId,
        stream_id: input.streamId,
        title: input.title.trim(),
        slug,
        short_description: input.shortDescription ?? null,
        description: input.description ?? null,
        language: input.language ?? null,
        difficulty_level: input.difficultyLevel ?? null,
        duration: input.duration ?? null,
        original_price: input.originalPrice,
        discounted_price: input.discountedPrice ?? null,
        currency: input.currency ?? 'INR',
        featured: input.featured ?? false,
        trending: input.trending ?? false,
        sort_order: input.sortOrder ?? 0,
        created_by: input.createdBy ?? null,
      };

      // ── Insert ─────────────────────────────────────────────────────────
      const { data, error } = await supabase
        .from('courses')
        .insert(dbRecord)
        .select(
          `
          *,
          streams!left (
            name
          )
        `,
        )
        .single();

      if (error) {
        if (error.code === '23503') {
          return {
            success: false,
            error: 'Cannot create this course. The referenced institute, stream, or creator does not exist.',
          };
        }
        if (error.code === '23505') {
          return {
            success: false,
            error: `A course with slug "${slug}" already exists in this institute. Please use a different title.`,
          };
        }
        return { success: false, error: extractErrorMessage(error) };
      }

      return {
        success: true,
        data: toCourseListItem({ ...data, teachers_count: 0, batches_count: 0 }),
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  5. Update
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Update an existing course.
   *
   * Only the fields provided in `input` are updated. Partial updates are
   * safe — omitted fields retain their current database values.
   *
   * @param courseId - The UUID of the course to update.
   * @param input    - The fields to update (all optional).
   */
  async updateCourse(
    courseId: string,
    input: UpdateCourseInput,
  ): Promise<ApiResponse<CourseListItem>> {
    try {
      validateUUID(courseId, 'courseId');

      // ── Build update payload (only provided fields) ────────────────────
      const dbRecord: Record<string, unknown> = {};

      if (input.title !== undefined) {
        if (!input.title.trim()) {
          return { success: false, error: 'title cannot be empty.' };
        }
        if (input.title.trim().length < 3) {
          return { success: false, error: 'title must be at least 3 characters.' };
        }
        dbRecord.title = input.title.trim();

        // Auto-regenerate slug when title changes and slug not explicitly provided
        if (input.slug === undefined) {
          dbRecord.slug = generateSlug(input.title);
        }
      }

      if (input.slug !== undefined) {
        if (!input.slug.trim()) {
          return { success: false, error: 'slug cannot be empty.' };
        }
        dbRecord.slug = input.slug.trim();
      }

      if (input.shortDescription !== undefined) {
        dbRecord.short_description = input.shortDescription;
      }

      if (input.description !== undefined) {
        dbRecord.description = input.description;
      }

      if (input.language !== undefined) {
        dbRecord.language = input.language;
      }

      if (input.difficultyLevel !== undefined) {
        dbRecord.difficulty_level = input.difficultyLevel;
      }

      if (input.duration !== undefined) {
        dbRecord.duration = input.duration;
      }

      if (input.originalPrice !== undefined) {
        if (input.originalPrice < 0) {
          return { success: false, error: 'originalPrice must be >= 0.' };
        }
        dbRecord.original_price = input.originalPrice;
      }

      if (input.discountedPrice !== undefined) {
        dbRecord.discounted_price = input.discountedPrice;
      }

      if (input.currency !== undefined) {
        dbRecord.currency = input.currency;
      }

      if (input.featured !== undefined) {
        dbRecord.featured = input.featured;
      }

      if (input.trending !== undefined) {
        dbRecord.trending = input.trending;
      }

      if (input.sortOrder !== undefined) {
        dbRecord.sort_order = input.sortOrder;
      }

      if (input.streamId !== undefined) {
        validateUUID(input.streamId, 'streamId');
        dbRecord.stream_id = input.streamId;
      }

      if (input.updatedBy !== undefined) {
        dbRecord.updated_by = input.updatedBy;
      }

      // ── If nothing to update, return current ────────────────────────────
      if (Object.keys(dbRecord).length === 0) {
        const existing = await this.getDetail(courseId);
        if (!existing.success || !existing.data) {
          return { success: false, error: `Course not found: ${courseId}` };
        }
        return {
          success: true,
          data: {
            courseId: existing.data.courseId,
            title: existing.data.title,
            slug: existing.data.slug,
            shortDescription: existing.data.shortDescription,
            thumbnailBucket: existing.data.thumbnailBucket,
            thumbnailPath: existing.data.thumbnailPath,
            language: existing.data.language,
            difficultyLevel: existing.data.difficultyLevel,
            duration: existing.data.duration,
            originalPrice: existing.data.originalPrice,
            discountedPrice: existing.data.discountedPrice,
            currency: existing.data.currency,
            status: existing.data.status,
            featured: existing.data.featured,
            trending: existing.data.trending,
            sortOrder: existing.data.sortOrder,
            streamId: existing.data.streamId,
            streamName: existing.data.streamName,
            teachersCount: existing.data.teachersCount,
            batchesCount: existing.data.batchesCount,
            publishedAt: existing.data.publishedAt,
            createdAt: existing.data.createdAt,
            updatedAt: existing.data.updatedAt,
          },
        };
      }

      // ── Update ─────────────────────────────────────────────────────────
      const { data, error } = await supabase
        .from('courses')
        .update(dbRecord)
        .eq('course_id', courseId)
        .select(
          `
          *,
          streams!left (
            name
          )
        `,
        )
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return { success: false, error: `Course not found: ${courseId}` };
        }
        if (error.code === '23505') {
          return {
            success: false,
            error: `A course with this slug already exists in this institute.`,
          };
        }
        return { success: false, error: extractErrorMessage(error) };
      }

      return {
        success: true,
        data: toCourseListItem({ ...data, teachers_count: 0, batches_count: 0 }),
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  6–9. Status Mutations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Update a course's status with validation.
   *
   * All single-course status mutations (publish, archive, restore)
   * funnel through this internal pipeline.
   *
   * @param courseId  - The `courses.course_id` of the course.
   * @param newStatus - The target status.
   */
  async updateStatus(
    courseId: string,
    newStatus: CourseStatus,
  ): Promise<ApiResponse<null>> {
    try {
      // ── Authorization: only super/academic admins may publish ──────────
      if (!(await canApproveAcademicResources())) {
        return approvalPermissionDenied();
      }

      validateUUID(courseId, 'courseId');

      // 1. Fetch current course to validate transition
      const { data: current, error: fetchErr } = await supabase
        .from('courses')
        .select('status')
        .eq('course_id', courseId)
        .single();

      if (fetchErr) {
        if (fetchErr.code === 'PGRST116') {
          return { success: false, error: `Course not found: ${courseId}` };
        }
        return { success: false, error: extractErrorMessage(fetchErr) };
      }

      // 2. Validate transition
      const transitionError = validateTransition(current.status, newStatus);
      if (transitionError) {
        return { success: false, error: transitionError };
      }

      // 3. Update — the DB trigger handles published_at automatically
      const { error } = await supabase
        .from('courses')
        .update({ status: newStatus })
        .eq('course_id', courseId);

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  /** Publish (draft/pending_approval/approved → published). */
  async publish(courseId: string): Promise<ApiResponse<null>> {
    return this.updateStatus(courseId, 'published');
  },

  /** Archive (published → archived). Preserves published_at for audit trail. */
  async archive(courseId: string): Promise<ApiResponse<null>> {
    return this.updateStatus(courseId, 'archived');
  },

  /** Restore (archived → published). */
  async restore(courseId: string): Promise<ApiResponse<null>> {
    return this.updateStatus(courseId, 'published');
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  10. Delete
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Soft-delete a course.
   *
   * Only allowed when:
   * - No active enrollments exist
   * - No content is assigned
   *
   * Returns a friendly error message if the course has dependencies.
   *
   * @param courseId - The UUID of the course to delete.
   * @param reason   - Optional reason captured for audit / delete_reason.
   */
  async delete(courseId: string, reason?: string): Promise<ApiResponse<null>> {
    try {
      validateUUID(courseId, 'courseId');

      // 1. Check for active enrollments
      const { count: enrollmentCount, error: enrollmentErr } = await supabase
        .from('course_enrollments')
        .select('enrollment_id', { count: 'exact', head: true })
        .eq('course_id', courseId)
        .eq('is_active', true);

      if (enrollmentErr) {
        return { success: false, error: extractErrorMessage(enrollmentErr) };
      }

      if (enrollmentCount && enrollmentCount > 0) {
        return {
          success: false,
          error: `Cannot delete this course because it has ${enrollmentCount} active enrollment(s). Archive the course instead.`,
        };
      }

      // 2. Check for assigned content
      const { count: contentCount, error: contentErr } = await supabase
        .from('course_content')
        .select('content_id', { count: 'exact', head: true })
        .eq('course_id', courseId);

      if (contentErr) {
        console.warn('Could not check course_content:', contentErr.message);
      }

      if (contentCount && contentCount > 0) {
        return {
          success: false,
          error: `Cannot delete this course because it has ${contentCount} content item(s) assigned. Remove all content first.`,
        };
      }

      // 3. Soft-delete: set deleted_at / deleted_by / delete_reason
      // Also clear published_at since the course is no longer published
      const { data: { user } } = await supabase.auth.getUser();
      const deletedBy = user?.id ?? null;
      const now = new Date().toISOString();

      const { error } = await supabase
        .from('courses')
        .update({
          deleted_at: now,
          deleted_by: deletedBy,
          delete_reason: reason ?? null,
          published_at: null,
          status: 'archived',
        })
        .eq('course_id', courseId);

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      // ── Audit (non-strict: never breaks the operation) ────────────────
      await auditService.logSoftDelete({
        resourceType: 'courses',
        resourceId: courseId,
        newValue: { deletedAt: now, deletedBy },
        metadata: { courseId },
        reason,
      });

      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  11. Statistics
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get course statistics for the admin course management dashboard.
   *
   * Returns:
   * - Count by stream
   * - Count by status
   * - Newest courses (last 10)
   * - Most enrolled courses (top 10)
   * - Pricing overview (average prices, free course count)
   */
  async getStats(instituteId?: string | null): Promise<ApiResponse<CourseManagementStats>> {
    try {
      const instituteScope = instituteId ? { institute_id: instituteId } : {};

      // 1. Count by stream
      const { data: streamData } = await supabase
        .from('courses')
        .select(
          `
          stream_id,
          streams!inner (
            name
          ),
          count:course_id
        `,
        )
        .is('deleted_at', null)
        .match(instituteScope)
        .order('count', { ascending: false })
        .limit(10);

      const byStream = (streamData ?? []).map((row: any) => ({
        streamName: row.streams?.name ?? 'Unknown',
        count: typeof row.count === 'number' ? row.count : 0,
      }));

      // 2. Count by status — use getCounts and transform
      const countsRes = await this.getCounts(instituteId);
      const counts = countsRes.data;
      const byStatus = counts
        ? [
            { status: 'draft', count: counts.draft },
            { status: 'pending_approval', count: counts.pendingApproval },
            { status: 'approved', count: counts.approved },
            { status: 'published', count: counts.published },
            { status: 'archived', count: counts.archived },
          ]
        : [];

      // 3. Newest courses (last 10)
      let newestQuery = supabase
        .from('courses')
        .select(
          `
          *,
          streams!left (
            name
          )
        `,
        )
        .is('deleted_at', null)
        .match(instituteScope)
        .order('created_at', { ascending: false })
        .limit(10);

      const { data: newestData } = await newestQuery;
      const newestCourses = (newestData ?? []).map(toCourseListItem);

      // 4. Most enrolled courses (top 10)
      // Get enrollment counts via course_enrollments
      const { data: enrollmentData } = await supabase
        .from('course_enrollments')
        .select('course_id, count:enrollment_id', { count: 'exact' })
        .eq('is_active', true);

      const enrollmentCountMap = new Map<string, number>();
      if (enrollmentData) {
        for (const row of enrollmentData as any[]) {
          enrollmentCountMap.set(row.course_id, typeof row.count === 'number' ? row.count : 0);
        }
      }

      // Sort by enrollment count descending, take top 10 course IDs
      const sortedByEnrollments = [...enrollmentCountMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([courseId]) => courseId);

      let mostEnrolled: CourseListItem[] = [];
      if (sortedByEnrollments.length > 0) {
        const { data: topData } = await supabase
          .from('courses')
          .select(
            `
            *,
            streams!left (
              name
            )
          `,
          )
          .is('deleted_at', null)
          .in('course_id', sortedByEnrollments);

        mostEnrolled = (topData ?? [])
          .map(toCourseListItem)
          .sort((a, b) => {
            const aCount = enrollmentCountMap.get(a.courseId) ?? 0;
            const bCount = enrollmentCountMap.get(b.courseId) ?? 0;
            return bCount - aCount;
          })
          .slice(0, 10);
      }

      // 5. Pricing overview
      const { data: priceData } = await supabase
        .from('courses')
        .select('original_price, discounted_price')
        .is('deleted_at', null)
        .match({ ...instituteScope, status: 'published' });

      const publishedCourses = priceData ?? [];
      const totalCourses = publishedCourses.length;
      let totalOriginalPrice = 0;
      let totalDiscountedPrice = 0;
      let discountCount = 0;
      let freeCount = 0;

      for (const row of publishedCourses as any[]) {
        const orig = parseFloat(row.original_price ?? 0);
        totalOriginalPrice += orig;
        if (orig === 0) freeCount++;

        if (row.discounted_price !== null) {
          totalDiscountedPrice += parseFloat(row.discounted_price);
          discountCount++;
        }
      }

      const pricingOverview = {
        avgOriginalPrice: totalCourses > 0 ? Math.round((totalOriginalPrice / totalCourses) * 100) / 100 : 0,
        avgDiscountedPrice: discountCount > 0 ? Math.round((totalDiscountedPrice / discountCount) * 100) / 100 : 0,
        freeCourseCount: freeCount,
      };

      return {
        success: true,
        data: {
          byStream,
          byStatus,
          newestCourses,
          mostEnrolled,
          pricingOverview,
        },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },
};
