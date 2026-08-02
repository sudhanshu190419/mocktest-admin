/**
 * Batch Management Service
 *
 * Single source of truth for all batch management operations in the
 * Admin Batch Management module.
 *
 * Every public method returns a standardised `ApiResponse<T>` shape.
 * Follows the exact same architecture as `teacherLifecycleService.ts`,
 * `studentLifecycleService.ts`, and `mockTestManagementService.ts`.
 *
 * ## Scope
 *
 * This service manages the lifecycle of batches via the `batches.status`
 * column.  It does NOT manage:
 * - Student enrollment within a batch (handled by batchStudentService)
 * - Teacher assignment to a batch (handled by batchTeacherService)
 * - Mock tests assigned to a batch
 *
 * ## Status Transitions
 *
 * ```
 *                  ┌──────────────┐
 *                  │   upcoming   │
 *                  └──────┬───────┘
 *                         ▼
 *                  ┌──────────────┐
 *            ┌─────│    active    │─────┐
 *            │     └──────┬───────┘     │
 *            ▼            ▼             ▼
 *     ┌──────────┐  ┌──────────┐  ┌──────────┐
 *     │ completed│  │ archived │  │ completed│
 *     └──────────┘  └──────────┘  └──────────┘
 *           │
 *           ▼
 *     ┌──────────┐
 *     │  active  │  (restore from completed)
 *     └──────────┘
 * ```
 *
 * @module services/admin/batchManagementService
 */

import { supabase } from '@/config/supabase';
import { buildPagination, extractErrorMessage, validateUUID } from '@/utils/supabase';
import { buildPaginatedResponse } from '@/utils/response';
import { auditService } from '@/services/audit/auditService';
import type { ApiResponse, PaginatedResponse, PaginationParams, SortDirection } from '@/types/academic';
import type { BatchStatus } from '@/types/academic';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

/** Dashboard counts grouped by batch status. */
export interface BatchManagementCounts {
  total: number;
  active: number;
  inactive: number;
  archived: number;
  full: number;
  availableSeats: number;
}

/** A single batch row in the admin batch list. */
export interface BatchListItem {
  batchId: string;
  batchCode: string;
  batchName: string;
  teacherId: string | null;
  teacherName: string | null;
  streamId: string;
  streamName: string | null;
  subjectId: string | null;
  subjectName: string | null;
  capacity: number | null;
  studentCount: number;
  availableSeats: number | null;
  status: BatchStatus;
  createdAt: string;
  updatedAt: string;
}

/** Detailed batch for the detail view. */
export interface BatchManagementDetail extends BatchListItem {
  /** Teacher information (from batch_subject_teachers). */
  teacher: {
    teacherId: string;
    name: string;
    email: string | null;
    phone: string | null;
  } | null;
  /** Number of mock tests assigned to this batch. */
  mockTestCount: number;
  /** List of students assigned to this batch. */
  assignedStudents: {
    studentId: string;
    name: string;
    email: string | null;
    enrolledOn: string;
  }[];
  /** Admin who created the batch. */
  createdBy: string | null;
  /** Batch notes or description from the name/description field. */
  notes: string | null;
  /** Academic year (e.g. "2025-26"). */
  academicYear: string;
  /** Batch start date. */
  startDate: string;
  /** Batch end date. */
  endDate: string;
  /** Max seats / capacity. */
  maxSeats: number | null;
}

/** Statistics for the batch management dashboard. */
export interface BatchManagementStats {
  /** Count of batches grouped by stream. */
  byStream: { streamName: string; count: number }[];
  /** Count of batches grouped by teacher. */
  byTeacher: { teacherName: string; count: number }[];
  /** Most recently created batches (last 10). */
  newestBatches: BatchListItem[];
  /** Batches with the highest student count (top 10). */
  largestBatches: BatchListItem[];
  /** Capacity utilisation across all batches. */
  utilization: {
    /** Total capacity across all batches with max_seats set. */
    totalCapacity: number;
    /** Total students enrolled across all batches. */
    totalStudents: number;
    /** Percentage utilisation (totalStudents / totalCapacity * 100). */
    utilizationPercent: number;
  };
}

/** Filters for the batch list query. */
export interface BatchManagementFilters {
  instituteId?: string;
  /** Filter by batch status (comma-separated for multiple). */
  status?: string;
  /** Filter by stream ID. */
  streamId?: string;
  /** Filter by subject ID. */
  subjectId?: string;
  /** Filter by teacher ID. */
  teacherId?: string;
  /** Search across name and batch code (case-insensitive). */
  search?: string;
}

/** Sort options for the batch list query. */
export interface BatchManagementSortOptions {
  sortBy?: 'name' | 'createdAt' | 'studentCount' | 'capacity' | 'teacherName';
  sortDirection?: SortDirection;
}

/** Input for creating a new batch. */
export interface CreateBatchInput {
  instituteId: string;
  streamId: string;
  name: string;
  batchCode: string;
  academicYear: string;
  startDate: string;
  endDate: string;
  maxSeats?: number | null;
  status?: BatchStatus;
}

/** Input for updating an existing batch. */
export interface UpdateBatchInput {
  name?: string;
  batchCode?: string;
  academicYear?: string;
  startDate?: string;
  endDate?: string;
  maxSeats?: number | null;
  status?: BatchStatus;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

const SORT_FIELD_MAP: Record<string, string> = {
  name: 'name',
  createdAt: 'created_at',
  studentCount: 'student_count',
  capacity: 'max_seats',
  teacherName: 'teacher_name',
};

/** Valid lifecycle status transitions for batches in admin management. */
const VALID_TRANSITIONS: Record<string, string[]> = {
  upcoming: ['active'],
  active: ['completed', 'archived'],
  completed: ['active'],
  archived: ['active'],
};

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function mapSortField(sortBy?: BatchManagementSortOptions['sortBy']): string {
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

/** Maps a raw Supabase row (batches JOIN streams) to BatchListItem. */
function toBatchListItem(row: any): BatchListItem {
  // Compute available seats
  const capacity = row.max_seats ?? null;
  const studentCount = typeof row.student_count === 'number' ? row.student_count : 0;
  const availableSeats = capacity !== null ? Math.max(0, capacity - studentCount) : null;

  return {
    batchId: row.batch_id,
    batchCode: row.batch_code,
    batchName: row.name,
    teacherId: row.teacher_id ?? null,
    teacherName: row.teacher_name ?? null,
    streamId: row.stream_id,
    streamName: row.streams?.name ?? null,
    subjectId: null,
    subjectName: null,
    capacity,
    studentCount,
    availableSeats,
    status: row.status as BatchStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Service
// ═══════════════════════════════════════════════════════════════════════════

export const batchManagementService = {
  // ─────────────────────────────────────────────────────────────────────────
  //  1. Dashboard Counts
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get batch management dashboard counts.
   *
   * Returns total, active, inactive (upcoming + completed), archived,
   * full (batches at capacity), and total available seats.
   */
  async getCounts(instituteId?: string | null): Promise<ApiResponse<BatchManagementCounts>> {
    try {
      const makeQuery = (status: BatchStatus) => {
        let q = supabase
          .from('batches')
          .select('batch_id', { count: 'exact', head: true })
          .eq('status', status)
          .is('deleted_at', null);
        if (instituteId) {
          q = q.eq('institute_id', instituteId);
        }
        return q;
      };

      const [active, upcoming, completed, archived] = await Promise.all([
        makeQuery('active'),
        makeQuery('upcoming'),
        makeQuery('completed'),
        makeQuery('archived'),
      ]);

      const activeCount = active.count ?? 0;
      const upcomingCount = upcoming.count ?? 0;
      const completedCount = completed.count ?? 0;
      const archivedCount = archived.count ?? 0;
      const inactiveCount = upcomingCount + completedCount;

      // Full batches: where deleted_at is null and student count >= max_seats
      let fullCount = 0;
      let availableSeatsSum = 0;

      // Fetch all non-deleted batches with max_seats and student counts
      let batchesQuery = supabase
        .from('batches')
        .select(
          `
          batch_id,
          max_seats,
          status,
          student_count:batch_students!inner(count)
        `,
        )
        .is('deleted_at', null);

      if (instituteId) {
        batchesQuery = batchesQuery.eq('institute_id', instituteId);
      }

      const { data: allBatches } = await batchesQuery;

      if (allBatches) {
        for (const batch of allBatches as any[]) {
          const maxSeats = batch.max_seats;
          const studentCount = batch.batch_students?.[0]?.count ?? 0;

          if (maxSeats !== null && maxSeats > 0) {
            if (studentCount >= maxSeats) {
              fullCount++;
            }
            availableSeatsSum += Math.max(0, maxSeats - studentCount);
          }
        }
      }

      const total = activeCount + inactiveCount + archivedCount;

      return {
        success: true,
        data: {
          total,
          active: activeCount,
          inactive: inactiveCount,
          archived: archivedCount,
          full: fullCount,
          availableSeats: availableSeatsSum,
        },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  2. Batch List
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a paginated, filtered, and sorted list of batches.
   *
   * Joins `batches` with `streams` and `batch_students` to include display
   * names and counts. Teacher info is resolved separately from
   * `batch_subject_teachers`. Supports search, status filter, stream filter,
   * teacher filter, pagination, and sorting.
   *
   * Soft-deleted batches (deleted_at IS NOT NULL) are excluded by default.
   */
  async getList(
    filters?: BatchManagementFilters,
    sort?: BatchManagementSortOptions,
    pagination?: PaginationParams,
  ): Promise<ApiResponse<PaginatedResponse<BatchListItem>>> {
    try {
      // Build a base query that gets batch info with related data.
      // We use a subquery approach to get student counts per batch.
      let query = supabase
        .from('batches')
        .select(
          `
          *,
          streams!left (
            name
          ),
          batch_students!left (
            student_id,
            status
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
        // Filter via batch_subject_teachers junction (deduplicate by batch_id)
        const { data: bstData } = await supabase
          .from('batch_subject_teachers')
          .select('batch_subjects!inner(batch_id)')
          .eq('teacher_id', filters.teacherId);

        const batchIdSet = new Set<string>();
        (bstData ?? []).forEach((item: any) => {
          const bid = item.batch_subjects?.batch_id;
          if (bid) batchIdSet.add(bid);
        });
        const ids = Array.from(batchIdSet);

        if (ids.length === 0) {
          return {
            success: true,
            data: buildPaginatedResponse([], 0, pagination?.page ?? 1, pagination?.pageSize ?? 20),
          };
        }
        query = query.in('batch_id', ids);
      }

      if (filters?.search) {
        const term = `%${filters.search}%`;
        query = query.or(`name.ilike.${term},batch_code.ilike.${term}`);
      }

      // ── Sorting ────────────────────────────────────────────────────
      const sortBy = mapSortField(sort?.sortBy);
      const direction = sort?.sortDirection ?? 'desc';

      // For computed fields (studentCount, teacherName), we sort client-side
      if (sort?.sortBy === 'studentCount' || sort?.sortBy === 'teacherName') {
        // Default to created_at for server sort, then client-sort after mapping
        query = query.order('created_at', { ascending: false });
      } else {
        query = query.order(sortBy, { ascending: direction === 'asc' });
      }

      // ── Pagination ──────────────────────────────────────────────────
      const { page, pageSize, from, to } = buildPagination(pagination);
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      // Fetch teacher info separately via batch_subject_teachers
      const batchIds = (data ?? []).map((r: any) => r.batch_id);
      const teacherByBatchMap = new Map<string, { teacherId: string; name: string }>();
      if (batchIds.length > 0) {
        const { data: bstData } = await supabase
          .from('batch_subject_teachers')
          .select(`
            teacher_id,
            batch_subjects!inner(batch_id),
            teacher_details!inner (
              profiles!inner (
                name
              )
            )
          `)
          .in('batch_subjects.batch_id', batchIds);

        // Get first teacher per batch (for backward compatibility)
        const firstTeacherPerBatch = new Map<string, { teacherId: string; name: string }>();
        (bstData ?? []).forEach((item: any) => {
          const bid = item.batch_subjects?.batch_id;
          if (bid && !firstTeacherPerBatch.has(bid) && item.teacher_details?.profiles?.name) {
            firstTeacherPerBatch.set(bid, {
              teacherId: item.teacher_id,
              name: item.teacher_details.profiles.name,
            });
          }
        });
        for (const [bid, info] of firstTeacherPerBatch) {
          teacherByBatchMap.set(bid, info);
        }
      }

      let items = (data ?? []).map((row: any) => {
        // Compute student count: count batch_students with active status
        const students = row.batch_students ?? [];
        const studentCount = Array.isArray(students)
          ? students.filter((s: any) => !s.status || s.status === 'active').length
          : 0;

        // Get teacher info from batch_subject_teachers
        const tInfo = teacherByBatchMap.get(row.batch_id);

        // Compute available seats
        const capacity = row.max_seats ?? null;
        const availableSeats = capacity !== null ? Math.max(0, capacity - studentCount) : null;

        return {
          batchId: row.batch_id,
          batchCode: row.batch_code,
          batchName: row.name,
          teacherId: tInfo?.teacherId ?? null,
          teacherName: tInfo?.name ?? null,
          streamId: row.stream_id,
          streamName: row.streams?.name ?? null,
          subjectId: null,
          subjectName: null,
          capacity,
          studentCount,
          availableSeats,
          status: row.status as BatchStatus,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      });

      // Client-side sort for computed fields
      if (sort?.sortBy === 'studentCount') {
        items.sort((a, b) =>
          direction === 'asc' ? a.studentCount - b.studentCount : b.studentCount - a.studentCount,
        );
      } else if (sort?.sortBy === 'teacherName') {
        items.sort((a, b) => {
          const aName = a.teacherName ?? '';
          const bName = b.teacherName ?? '';
          return direction === 'asc' ? aName.localeCompare(bName) : bName.localeCompare(aName);
        });
      }

      return {
        success: true,
        data: buildPaginatedResponse(items, count ?? 0, page, pageSize),
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  3. Batch Detail
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the full details for a single batch, including teacher info,
   * student count, capacity, remaining seats, assigned mock tests count,
   * and creation/update timestamps.
   */
  async getDetail(batchId: string): Promise<ApiResponse<BatchManagementDetail>> {
    try {
      validateUUID(batchId, 'batchId');

      // 1. Fetch batch with joins
      const { data: batch, error: batchErr } = await supabase
        .from('batches')
        .select(
          `
          *,
          streams!left (
            name
          )
        `,
        )
        .eq('batch_id', batchId)
        .single();

      if (batchErr) {
        if (batchErr.code === 'PGRST116') {
          return { success: false, error: `Batch not found: ${batchId}` };
        }
        return { success: false, error: extractErrorMessage(batchErr) };
      }

      // 2. Fetch related data in parallel
      const [teachersRes, studentsRes, studentProfilesRes] = await Promise.allSettled([
        // Teacher info (via batch_subject_teachers -> batch_subjects)
        // First get batch_subject_ids for this batch
        (async () => {
          const { data: bsIds } = await supabase
            .from('batch_subjects')
            .select('batch_subject_id')
            .eq('batch_id', batchId);
          const ids = (bsIds ?? []).map((r: any) => r.batch_subject_id);
          if (ids.length === 0) return { data: [], error: null };
          return supabase
            .from('batch_subject_teachers')
            .select(`
              teacher_id,
              teacher_details!inner (
                teacher_id,
                profiles!inner (
                  name,
                  email,
                  phone
                )
              )
            `)
            .in('batch_subject_id', ids);
        })(),

        // Student count
        supabase
          .from('batch_students')
          .select('student_id', { count: 'exact', head: true })
          .eq('batch_id', batchId)
          .eq('status', 'active'),

        // Student profiles for assigned students
        supabase
          .from('batch_students')
          .select(
            `
            student_id,
            enrolled_on,
            student_details!inner (
              student_id,
              profiles!inner (
                name,
                email
              )
            )
          `,
          )
          .eq('batch_id', batchId)
          .eq('status', 'active')
          .order('enrolled_on', { ascending: true }),
      ]);

      // Process teacher info
      const teacherData = teachersRes.status === 'fulfilled' ? teachersRes.value.data ?? [] : [];
      const teacherInfo = Array.isArray(teacherData) && teacherData.length > 0
        ? {
            teacherId: (teacherData[0] as any).teacher_details?.teacher_id ?? '',
            name: (teacherData[0] as any).teacher_details?.profiles?.name ?? 'Unknown',
            email: (teacherData[0] as any).teacher_details?.profiles?.email ?? null,
            phone: (teacherData[0] as any).teacher_details?.profiles?.phone ?? null,
          }
        : null;

      // Process student count
      const studentCount = studentsRes.status === 'fulfilled' ? (studentsRes.value.count ?? 0) : 0;

      // Mock test count: There is no direct FK from batches to mock_tests in the current
      // schema.  This field is reserved for a future relationship (e.g. batch_mock_tests
      // junction table or a batch_id FK on mock_tests).  For now it remains 0.
      const mockTestCount = 0;

      // Process assigned students
      const studentProfiles = studentProfilesRes.status === 'fulfilled'
        ? (studentProfilesRes.value.data ?? [])
        : [];
      const assignedStudents = (Array.isArray(studentProfiles) ? studentProfiles : []).map((row: any) => ({
        studentId: row.student_details?.student_id ?? row.student_id,
        name: row.student_details?.profiles?.name ?? 'Unknown',
        email: row.student_details?.profiles?.email ?? null,
        enrolledOn: row.enrolled_on ?? '',
      }));

      // Compute available seats
      const capacity = batch.max_seats ?? null;
      const availableSeats = capacity !== null ? Math.max(0, capacity - studentCount) : null;

      const detail: BatchManagementDetail = {
        batchId: batch.batch_id,
        batchCode: batch.batch_code,
        batchName: batch.name,
        teacherId: teacherInfo?.teacherId ?? null,
        teacherName: teacherInfo?.name ?? null,
        streamId: batch.stream_id,
        streamName: batch.streams?.name ?? null,
        subjectId: null,
        subjectName: null,
        capacity,
        studentCount,
        availableSeats,
        status: batch.status as BatchStatus,
        createdAt: batch.created_at,
        updatedAt: batch.updated_at,
        teacher: teacherInfo,
        mockTestCount,
        assignedStudents,
        createdBy: batch.created_by,
        notes: null,
        academicYear: batch.academic_year,
        startDate: batch.start_date,
        endDate: batch.end_date,
        maxSeats: batch.max_seats,
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
   * Create a new batch.
   *
   * Validates required fields and delegates to the batches table.
   *
   * @param input - The batch creation payload.
   */
  async createBatch(input: CreateBatchInput): Promise<ApiResponse<BatchListItem>> {
    try {
      // ── Validate required fields ───────────────────────────────────────
      if (!input.instituteId) {
        return { success: false, error: 'instituteId is required.' };
      }
      if (!input.streamId) {
        return { success: false, error: 'streamId is required.' };
      }
      if (!input.name?.trim()) {
        return { success: false, error: 'name is required.' };
      }
      if (!input.batchCode?.trim()) {
        return { success: false, error: 'batchCode is required.' };
      }
      if (!input.academicYear?.trim()) {
        return { success: false, error: 'academicYear is required.' };
      }
      if (!input.startDate) {
        return { success: false, error: 'startDate is required.' };
      }
      if (!input.endDate) {
        return { success: false, error: 'endDate is required.' };
      }
      if (input.name.trim().length < 3) {
        return { success: false, error: 'name must be at least 3 characters.' };
      }
      if (input.batchCode.trim().length < 2) {
        return { success: false, error: 'batchCode must be at least 2 characters.' };
      }

      // ── Validate UUID formats ──────────────────────────────────────────
      validateUUID(input.instituteId, 'instituteId');
      validateUUID(input.streamId, 'streamId');

      // ── Build DB record ────────────────────────────────────────────────
      const dbRecord: Record<string, unknown> = {
        institute_id: input.instituteId,
        stream_id: input.streamId,
        name: input.name.trim(),
        batch_code: input.batchCode.trim().toUpperCase(),
        academic_year: input.academicYear.trim(),
        start_date: input.startDate,
        end_date: input.endDate,
        max_seats: input.maxSeats ?? null,
        status: input.status ?? 'upcoming',
      };

      // ── Insert ─────────────────────────────────────────────────────────
      const { data, error } = await supabase
        .from('batches')
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
            error: 'Cannot create this batch. The referenced institute or stream does not exist.',
          };
        }
        if (error.code === '23505') {
          return {
            success: false,
            error: `A batch with code "${input.batchCode.toUpperCase()}" already exists in this institute.`,
          };
        }
        return { success: false, error: extractErrorMessage(error) };
      }

      return {
        success: true,
        data: toBatchListItem({ ...data, student_count: 0 }),
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  5. Update
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Update an existing batch.
   *
   * Only the fields provided in `input` are updated. Partial updates are
   * safe — omitted fields retain their current database values.
   *
   * @param batchId - The UUID of the batch to update.
   * @param input   - The fields to update (all optional).
   */
  async updateBatch(
    batchId: string,
    input: UpdateBatchInput,
  ): Promise<ApiResponse<BatchListItem>> {
    try {
      validateUUID(batchId, 'batchId');

      // ── Build update payload (only provided fields) ────────────────────
      const dbRecord: Record<string, unknown> = {};

      if (input.name !== undefined) {
        if (!input.name.trim()) {
          return { success: false, error: 'name cannot be empty.' };
        }
        if (input.name.trim().length < 3) {
          return { success: false, error: 'name must be at least 3 characters.' };
        }
        dbRecord.name = input.name.trim();
      }

      if (input.batchCode !== undefined) {
        if (!input.batchCode.trim()) {
          return { success: false, error: 'batchCode cannot be empty.' };
        }
        if (input.batchCode.trim().length < 2) {
          return { success: false, error: 'batchCode must be at least 2 characters.' };
        }
        dbRecord.batch_code = input.batchCode.trim().toUpperCase();
      }

      if (input.academicYear !== undefined) {
        dbRecord.academic_year = input.academicYear.trim();
      }

      if (input.startDate !== undefined) {
        dbRecord.start_date = input.startDate;
      }

      if (input.endDate !== undefined) {
        dbRecord.end_date = input.endDate;
      }

      if (input.maxSeats !== undefined) {
        dbRecord.max_seats = input.maxSeats;
      }

      if (input.status !== undefined) {
        dbRecord.status = input.status;
      }

      // ── If nothing to update, return current ────────────────────────────
      if (Object.keys(dbRecord).length === 0) {
        const existing = await this.getDetail(batchId);
        if (!existing.success || !existing.data) {
          return { success: false, error: `Batch not found: ${batchId}` };
        }
        return {
          success: true,
          data: {
            batchId: existing.data.batchId,
            batchCode: existing.data.batchCode,
            batchName: existing.data.batchName,
            teacherId: existing.data.teacherId,
            teacherName: existing.data.teacherName,
            streamId: existing.data.streamId,
            streamName: existing.data.streamName,
            subjectId: existing.data.subjectId,
            subjectName: existing.data.subjectName,
            capacity: existing.data.capacity,
            studentCount: existing.data.studentCount,
            availableSeats: existing.data.availableSeats,
            status: existing.data.status,
            createdAt: existing.data.createdAt,
            updatedAt: existing.data.updatedAt,
          },
        };
      }

      // ── Update ─────────────────────────────────────────────────────────
      const { data, error } = await supabase
        .from('batches')
        .update(dbRecord)
        .eq('batch_id', batchId)
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
          return { success: false, error: `Batch not found: ${batchId}` };
        }
        if (error.code === '23505') {
          return {
            success: false,
            error: `A batch with this code already exists in this institute.`,
          };
        }
        return { success: false, error: extractErrorMessage(error) };
      }

      return {
        success: true,
        data: toBatchListItem({ ...data, student_count: 0 }),
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  6–10. Status Mutations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Update a batch's status with validation.
   *
   * All single-batch status mutations (archive, restore, activate, deactivate)
   * funnel through this internal pipeline.
   *
   * @param batchId   - The `batches.batch_id` of the batch.
   * @param newStatus - The target status.
   */
  async updateStatus(
    batchId: string,
    newStatus: BatchStatus,
  ): Promise<ApiResponse<null>> {
    try {
      validateUUID(batchId, 'batchId');

      // 1. Fetch current batch to validate transition
      const { data: current, error: fetchErr } = await supabase
        .from('batches')
        .select('status')
        .eq('batch_id', batchId)
        .single();

      if (fetchErr) {
        if (fetchErr.code === 'PGRST116') {
          return { success: false, error: `Batch not found: ${batchId}` };
        }
        return { success: false, error: extractErrorMessage(fetchErr) };
      }

      // 2. Validate transition
      const transitionError = validateTransition(current.status, newStatus);
      if (transitionError) {
        return { success: false, error: transitionError };
      }

      // 3. Update
      const { error } = await supabase
        .from('batches')
        .update({ status: newStatus })
        .eq('batch_id', batchId);

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  /** Archive (active → archived). */
  async archive(batchId: string): Promise<ApiResponse<null>> {
    return this.updateStatus(batchId, 'archived');
  },

  /** Restore (archived → active). */
  async restore(batchId: string): Promise<ApiResponse<null>> {
    return this.updateStatus(batchId, 'active');
  },

  /** Activate (inactive states → active). */
  async activate(batchId: string): Promise<ApiResponse<null>> {
    return this.updateStatus(batchId, 'active');
  },

  /** Deactivate (active → completed). */
  async deactivate(batchId: string): Promise<ApiResponse<null>> {
    return this.updateStatus(batchId, 'completed');
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  11. Delete
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Soft-delete a batch.
   *
   * Only allowed when:
   * - No students are assigned
   * - No mock tests are scheduled for this batch
   *
   * Returns a friendly error message if the batch has dependencies.
   *
   * @param batchId - The UUID of the batch to delete.
   * @param reason  - Optional reason captured for audit / delete_reason.
   */
  async delete(batchId: string, reason?: string): Promise<ApiResponse<null>> {
    try {
      validateUUID(batchId, 'batchId');

      // 1. Check for active students
      const { count: studentCount, error: studentErr } = await supabase
        .from('batch_students')
        .select('student_id', { count: 'exact', head: true })
        .eq('batch_id', batchId)
        .eq('status', 'active');

      if (studentErr) {
        return { success: false, error: extractErrorMessage(studentErr) };
      }

      if (studentCount && studentCount > 0) {
        return {
          success: false,
          error: `Cannot delete this batch because it has ${studentCount} active student(s) assigned. Remove all students first.`,
        };
      }

      // 2. Check for scheduled live classes (via batch_subject_live_classes → batch_subjects)
      const { data: classBSData, error: classErr } = await supabase
        .from('batch_subject_live_classes')
        .select('class_id')
        .eq('batch_subjects.batch_id', batchId);

      if (classErr) {
        console.warn('Could not check batch_subject_live_classes:', classErr.message);
      }
      const classCount = classBSData?.length ?? 0;

      if (classCount && classCount > 0) {
        return {
          success: false,
          error: `Cannot delete this batch because it has scheduled live classes. Remove the batch from all classes first.`,
        };
      }

      // 3. Soft-delete with full metadata (deleted_at / deleted_by / delete_reason)
      const { data: { user } } = await supabase.auth.getUser();
      const deletedBy = user?.id ?? null;
      const now = new Date().toISOString();

      const { error } = await supabase
        .from('batches')
        .update({
          deleted_at: now,
          deleted_by: deletedBy,
          delete_reason: reason ?? null,
        })
        .eq('batch_id', batchId);

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      // ── Audit (non-strict: never breaks the operation) ────────────────
      await auditService.logSoftDelete({
        resourceType: 'batches',
        resourceId: batchId,
        metadata: { batchId, deletedAt: now, deletedBy },
        reason,
      });

      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  12. Statistics
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get batch statistics for the admin batch management dashboard.
   *
   * Returns:
   * - Batches grouped by stream
   * - Batches grouped by teacher
   * - Largest batches (top 10 by student count)
   * - Recently created batches (last 10)
   * - Capacity utilization across all batches
   */
  async getStats(instituteId?: string | null): Promise<ApiResponse<BatchManagementStats>> {
    try {
      const instituteScope = instituteId ? { institute_id: instituteId } : {};

      // 1. Count by stream
      const { data: streamData } = await supabase
        .from('batches')
        .select(
          `
          stream_id,
          streams!inner (
            name
          ),
          count:batch_id
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

      // 2. Count by teacher (via batch_subject_teachers)
      const { data: bstAll } = await supabase
        .from('batch_subject_teachers')
        .select(`
          teacher_id,
          batch_subject_id,
          teacher_details!inner (
            profiles!inner (
              name
            )
          )
        `);

      // Group by teacher and count distinct batch_subjects
      const teacherCountMap = new Map<string, { name: string; count: number }>();
      (bstAll ?? []).forEach((item: any) => {
        const tid = item.teacher_id;
        if (tid) {
          if (!teacherCountMap.has(tid)) {
            teacherCountMap.set(tid, {
              name: item.teacher_details?.profiles?.name ?? 'Unknown',
              count: 0,
            });
          }
          teacherCountMap.get(tid)!.count++;
        }
      });

      // Sort by count descending, take top 10
      const byTeacher = [...teacherCountMap.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10)
        .map(([, v]) => ({ teacherName: v.name, count: v.count }));

      // 3. Newest batches (last 10)
      let newestQuery = supabase
        .from('batches')
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

      // Batch-fetch teacher info for all newest batches
      const newestBatchIds = (newestData ?? []).map((r: any) => r.batch_id);
      const newestTeacherMap = new Map<string, string>();
      if (newestBatchIds.length > 0) {
        const { data: bstNew } = await supabase
          .from('batch_subject_teachers')
          .select(`
            teacher_id,
            batch_subjects!inner(batch_id),
            teacher_details!inner (
              profiles!inner (name)
            )
          `)
          .in('batch_subjects.batch_id', newestBatchIds);

        (bstNew ?? []).forEach((item: any) => {
          const bid = item.batch_subjects?.batch_id;
          if (bid && !newestTeacherMap.has(bid) && item.teacher_details?.profiles?.name) {
            newestTeacherMap.set(bid, item.teacher_details.profiles.name);
          }
        });
      }

      // Build newest batches with student counts
      const newestBatches = await Promise.all(
        (newestData ?? []).map(async (row: any) => {
          const { count: sCount } = await supabase
            .from('batch_students')
            .select('student_id', { count: 'exact', head: true })
            .eq('batch_id', row.batch_id)
            .eq('status', 'active');

          return toBatchListItem({ ...row, student_count: sCount ?? 0, teacher_name: newestTeacherMap.get(row.batch_id) ?? null });
        }),
      );

      // 4. Largest batches (top 10 by student count)
      // Fetch all batches with student counts and sort client-side
      const { data: allBatchData } = await supabase
        .from('batches')
        .select('batch_id')
        .is('deleted_at', null)
        .match(instituteScope);

      const allBatchIds = (allBatchData ?? []).map((r: any) => r.batch_id);

      // Get student counts for all batches
      const studentCountPromises = allBatchIds.map(async (id: string) => {
        const { count } = await supabase
          .from('batch_students')
          .select('student_id', { count: 'exact', head: true })
          .eq('batch_id', id)
          .eq('status', 'active');
        return { batchId: id, count: count ?? 0 };
      });

      const studentCounts = await Promise.all(studentCountPromises);
      const studentCountMap = new Map(studentCounts.map((s: any) => [s.batchId, s.count]));

      // Sort by count descending, take top 10
      const topBatchIds = studentCounts
        .sort((a: any, b: any) => b.count - a.count)
        .slice(0, 10)
        .map((s: any) => s.batchId);

      const { data: topData } = await supabase
        .from('batches')
        .select(
          `
          *,
          streams!left (
            name
          )
        `,
        )
        .is('deleted_at', null)
        .in('batch_id', topBatchIds);

      // Batch-fetch teacher info for largest batches
      const topTeacherMap = new Map<string, string>();
      if (topBatchIds.length > 0) {
        const { data: bstTop } = await supabase
          .from('batch_subject_teachers')
          .select(`
            teacher_id,
            batch_subjects!inner(batch_id),
            teacher_details!inner (
              profiles!inner (name)
            )
          `)
          .in('batch_subjects.batch_id', topBatchIds);

        (bstTop ?? []).forEach((item: any) => {
          const bid = item.batch_subjects?.batch_id;
          if (bid && !topTeacherMap.has(bid) && item.teacher_details?.profiles?.name) {
            topTeacherMap.set(bid, item.teacher_details.profiles.name);
          }
        });
      }

      const largestBatches = (topData ?? []).map((row: any) => {
        return toBatchListItem({
          ...row,
          student_count: studentCountMap.get(row.batch_id) ?? 0,
          teacher_name: topTeacherMap.get(row.batch_id) ?? null,
        });
      }).sort((a: BatchListItem, b: BatchListItem) => b.studentCount - a.studentCount);

      // 5. Capacity utilization
      const { data: capacityData } = await supabase
        .from('batches')
        .select('max_seats')
        .is('deleted_at', null)
        .match(instituteScope)
        .not('max_seats', 'is', null);

      const totalCapacity = (capacityData ?? []).reduce(
        (sum: number, row: any) => sum + (row.max_seats ?? 0),
        0,
      );

      // Get total students across all batches with capacity
      const batchIdsWithCapacity = (capacityData ?? []).map((r: any) => r.batch_id);
      let totalStudents = 0;

      if (batchIdsWithCapacity.length > 0) {
        const capStudentPromises = batchIdsWithCapacity.map(async (id: string) => {
          const { count } = await supabase
            .from('batch_students')
            .select('student_id', { count: 'exact', head: true })
            .eq('batch_id', id)
            .eq('status', 'active');
          return count ?? 0;
        });

        const counts = await Promise.all(capStudentPromises);
        totalStudents = counts.reduce((sum, c) => sum + c, 0);
      }

      const utilization = {
        totalCapacity,
        totalStudents,
        utilizationPercent: totalCapacity > 0
          ? Math.round((totalStudents / totalCapacity) * 100 * 100) / 100
          : 0,
      };

      return {
        success: true,
        data: {
          byStream,
          byTeacher,
          newestBatches,
          largestBatches,
          utilization,
        },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },
};
