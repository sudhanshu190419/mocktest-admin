/**
 * Batch Service
 *
 * Clean-architecture service layer encapsulating all Batch CRUD operations.
 *
 * Every public method returns a standardised `ApiResponse<T>` shape so that
 * consumers (hooks, screens, etc.) never need to handle raw Supabase
 * exceptions or error formats.
 *
 * ## Architecture decisions
 *
 * 1. **RLS is respected.** This service uses the anon key — all queries run
 *    within the context of the authenticated user. RLS policies in the
 *    database control what rows each user can see, insert, update, or delete.
 *
 * 2. **No service_role key.** This service never bypasses RLS. Row-level
 *    security is the sole access control mechanism.
 *
 * 3. **Clean mapping layer.** A single `mapBatch` helper converts all
 *    snake_case database rows to camelCase TypeScript interfaces, avoiding
 *    duplication across functions.
 *
 * 4. **Soft delete.** The `batches` table has a `deleted_at` column. The
 *    `deleteBatch` function performs a soft delete by setting `deleted_at`
 *    to the current timestamp. List queries exclude soft-deleted rows by
 *    default; pass `includeDeleted: true` in filters to include them.
 *
 * 5. **Future expansion.** Placeholder functions for teacher/student
 *    assignment, batch closure, and archiving are declared at the bottom
 *    of this module. They throw descriptive errors until implemented.
 *
 * @module batchService
 */

import { supabase } from '../../config/supabase';
import { validateUUID, extractErrorMessage, buildPagination } from '../../utils/supabase';
import { buildPaginatedResponse } from '../../utils/response';
import type {
  ApiResponse,
  PaginatedResponse,
  PaginationParams,
  SortDirection,
  Batch,
  BatchStatus,
  CreateBatchInput,
  UpdateBatchInput,
  BatchFilters,
  BatchSortOptions,
} from '../../types/academic';

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Maps camelCase sort keys to their snake_case database column names.
 * Unknown keys fall back to `created_at`.
 */
const SORT_FIELD_MAP: Record<string, string> = {
  name: 'name',
  batchCode: 'batch_code',
  academicYear: 'academic_year',
  startDate: 'start_date',
  endDate: 'end_date',
  status: 'status',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

// ─── Database Row Shape ────────────────────────────────────────────────────

/**
 * Raw snake_case shape of the `batches` table returned by Supabase.
 *
 * This type is internal to the service layer and is never exported.
 * Consumers receive only the camelCase `Batch` interface.
 */
interface DbBatch {
  batch_id: string;
  institute_id: string;
  stream_id: string;
  name: string;
  batch_code: string;
  academic_year: string;
  start_date: string;
  end_date: string;
  max_seats: number | null;
  status: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  deleted_at: string | null;
}

// ─── Validation Helpers ─────────────────────────────────────────────────────

/**
 * Validates that `startDate` is not after `endDate`.
 *
 * Both values are expected as ISO-8601 date strings (e.g. "2025-04-01").
 *
 * @throws An `Error` if startDate is strictly after endDate.
 */
function validateDateRange(startDate: string, endDate: string): void {
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (Number.isNaN(start.getTime())) {
    throw new Error(`Invalid startDate: "${startDate}" is not a valid date.`);
  }

  if (Number.isNaN(end.getTime())) {
    throw new Error(`Invalid endDate: "${endDate}" is not a valid date.`);
  }

  if (start > end) {
    throw new Error('startDate must be on or before endDate.');
  }
}

/**
 * Validates that `value` is either `null`, `undefined`, or a positive integer.
 *
 * @throws An `Error` if maxSeats is provided and is not a positive number.
 */
function validateMaxSeats(value: unknown): void {
  if (value === null || value === undefined) {
    return;
  }

  const num = Number(value);

  if (!Number.isInteger(num) || num <= 0) {
    throw new Error('maxSeats must be a positive integer or null (unlimited).');
  }
}

// ─── Mapping Helpers ────────────────────────────────────────────────────────

/**
 * Converts a raw snake_case database row into a camelCase `Batch` interface.
 *
 * This is the single source of truth for the mapping. If the schema changes
 * or new fields are added, update this function in one place.
 */
function mapBatch(db: DbBatch): Batch {
  return {
    batchId: db.batch_id,
    instituteId: db.institute_id,
    streamId: db.stream_id,
    name: db.name,
    batchCode: db.batch_code,
    academicYear: db.academic_year,
    startDate: db.start_date,
    endDate: db.end_date,
    maxSeats: db.max_seats,
    status: db.status as BatchStatus,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
    createdBy: db.created_by,
    updatedBy: db.updated_by,
    deletedAt: db.deleted_at,
  };
}

/**
 * Converts a camelCase sort key from `BatchSortOptions` to the
 * corresponding snake_case column name in the database.
 */
function mapSortField(sortBy: BatchSortOptions['sortBy']): string {
  return SORT_FIELD_MAP[sortBy ?? 'createdAt'] ?? 'created_at';
}

/**
 * Validates that one date does not exceed the other by fetching
 * the missing boundary from the database when only one is provided.
 *
 * This is used by `updateBatch` to ensure partial date updates
 * remain consistent with the existing stored value.
 *
 * @param batchId    - The UUID of the batch to check.
 * @param startDate  - The new start date being set (undefined = unchanged).
 * @param endDate    - The new end date being set (undefined = unchanged).
 *
 * @returns An error message string, or `null` if validation passes.
 */
async function validatePartialDateRange(
  batchId: string,
  startDate: string | undefined,
  endDate: string | undefined,
): Promise<string | null> {
  // If both or neither are provided, validation is handled elsewhere
  if (
    (startDate !== undefined && endDate !== undefined) ||
    (startDate === undefined && endDate === undefined)
  ) {
    return null;
  }

  // Fetch the existing date that is not being updated
  const { data, error } = await supabase
    .from('batches')
    .select('start_date, end_date')
    .eq('batch_id', batchId)
    .single<{ start_date: string; end_date: string }>();

  if (error) {
    if (error.code === 'PGRST116') {
      return `Batch not found: ${batchId}`;
    }
    return extractErrorMessage(error);
  }

  const effectiveStart = startDate ?? data.start_date;
  const effectiveEnd = endDate ?? data.end_date;

  try {
    validateDateRange(effectiveStart, effectiveEnd);
  } catch (err) {
    return extractErrorMessage(err);
  }

  return null;
}

// ─── Public API — Core CRUD ─────────────────────────────────────────────────

/**
 * Fetch a paginated, filtered, and sorted list of batches.
 *
 * Soft-deleted rows are excluded by default. Pass `includeDeleted: true`
 * in filters to include them.
 *
 * All parameters are optional. Sensible defaults are applied:
 * - page: 1
 * - pageSize: 20
 * - sortBy: created_at (ascending)
 *
 * @param filters   - Optional filter criteria (instituteId, streamId, academicYear, status, search, ids, includeDeleted).
 * @param sort      - Optional sort configuration (sortBy, sortDirection).
 * @param pagination - Optional pagination parameters (page, pageSize).
 *
 * @example
 * const result = await getBatches(
 *   { streamId: '...', status: 'active' },
 *   { sortBy: 'startDate', sortDirection: 'desc' },
 *   { page: 1, pageSize: 10 },
 * );
 *
 * if (result.success) {
 *   console.log(result.data.data);    // Batch[]
 *   console.log(result.data.count);   // total rows (for pagination)
 * }
 */
export async function getBatches(
  filters?: BatchFilters,
  sort?: BatchSortOptions,
  pagination?: PaginationParams,
): Promise<ApiResponse<PaginatedResponse<Batch>>> {
  try {
    // ── Build query ────────────────────────────────────────────────────
    let query = supabase
      .from('batches')
      .select('*', { count: 'exact' });

    // ── Apply filters ──────────────────────────────────────────────────
    // Exclude soft-deleted rows unless explicitly requested
    if (!filters?.includeDeleted) {
      query = query.is('deleted_at', null);
    }

    if (filters?.instituteId) {
      validateUUID(filters.instituteId, 'instituteId');
      query = query.eq('institute_id', filters.instituteId);
    }

    if (filters?.streamId) {
      validateUUID(filters.streamId, 'streamId');
      query = query.eq('stream_id', filters.streamId);
    }

    if (filters?.academicYear) {
      query = query.eq('academic_year', filters.academicYear);
    }

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    if (filters?.search) {
      const searchTerm = `%${filters.search}%`;
      query = query.or(
        `name.ilike.${searchTerm},batch_code.ilike.${searchTerm}`,
      );
    }

    if (filters?.ids && filters.ids.length > 0) {
      query = query.in('batch_id', filters.ids);
    }

    // ── Apply sorting ──────────────────────────────────────────────────
    const sortBy = mapSortField(sort?.sortBy);
    const sortDirection: SortDirection = sort?.sortDirection ?? 'asc';
    query = query.order(sortBy, { ascending: sortDirection === 'asc' });

    // ── Apply pagination ───────────────────────────────────────────────
    const { page, pageSize, from, to } = buildPagination(pagination);
    query = query.range(from, to);

    // ── Execute ────────────────────────────────────────────────────────
    const { data, error, count } = await query;

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    const batches = (data ?? []).map(mapBatch);

    return {
      success: true,
      data: buildPaginatedResponse(batches, count ?? 0, page, pageSize),
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Fetch a single batch by its ID.
 *
 * Soft-deleted batches can still be retrieved by ID — use this endpoint
 * for detail views even after deletion.
 *
 * @param batchId - The UUID of the batch to retrieve.
 *
 * @example
 * const result = await getBatchById('uuid-here');
 * if (result.success) {
 *   console.log(result.data.name);
 * }
 */
export async function getBatchById(batchId: string): Promise<ApiResponse<Batch>> {
  try {
    validateUUID(batchId, 'batchId');

    const { data, error } = await supabase
      .from('batches')
      .select('*')
      .eq('batch_id', batchId)
      .single<DbBatch>();

    if (error) {
      // PGRST116 = "The result contains 0 rows" — batch not found
      if (error.code === 'PGRST116') {
        return { success: false, error: `Batch not found: ${batchId}` };
      }

      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapBatch(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Create a new batch.
 *
 * The `batch_code` is automatically uppercased. The `updated_by` is
 * explicitly set to `null` on creation — only updates populate this field.
 *
 * @param input - The batch creation payload.
 *
 * @example
 * const result = await createBatch({
 *   instituteId: 'uuid-here',
 *   streamId: 'uuid-here',
 *   name: 'NEET 2026 Morning',
 *   batchCode: 'NEET26-MOR-A',
 *   academicYear: '2025-26',
 *   startDate: '2025-04-01',
 *   endDate: '2026-03-31',
 * });
 */
export async function createBatch(input: CreateBatchInput): Promise<ApiResponse<Batch>> {
  try {
    // ── Validate required fields ───────────────────────────────────────
    if (!input.instituteId) {
      return { success: false, error: 'instituteId is required.' };
    }

    if (!input.streamId) {
      return { success: false, error: 'streamId is required.' };
    }

    if (!input.name?.trim()) {
      return { success: false, error: 'Batch name is required.' };
    }

    if (!input.batchCode?.trim()) {
      return { success: false, error: 'Batch code is required.' };
    }

    if (!input.academicYear?.trim()) {
      return { success: false, error: 'Academic year is required.' };
    }

    if (!input.startDate) {
      return { success: false, error: 'Start date is required.' };
    }

    if (!input.endDate) {
      return { success: false, error: 'End date is required.' };
    }

    // ── Validate field formats ─────────────────────────────────────────
    validateUUID(input.instituteId, 'instituteId');
    validateUUID(input.streamId, 'streamId');
    validateDateRange(input.startDate, input.endDate);
    validateMaxSeats(input.maxSeats);

    if (input.createdBy) {
      validateUUID(input.createdBy, 'createdBy');
    }

    // ── Build DB record ────────────────────────────────────────────────
    const dbRecord = {
      institute_id: input.instituteId,
      stream_id: input.streamId,
      name: input.name.trim(),
      batch_code: input.batchCode.trim().toUpperCase(),
      academic_year: input.academicYear.trim(),
      start_date: input.startDate,
      end_date: input.endDate,
      max_seats: input.maxSeats ?? null,
      status: input.status ?? 'upcoming',
      created_by: input.createdBy ?? null,
      updated_by: null,
    };

    // ── Insert ─────────────────────────────────────────────────────────
    const { data, error } = await supabase
      .from('batches')
      .insert(dbRecord)
      .select()
      .single<DbBatch>();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapBatch(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Update an existing batch.
 *
 * Only the fields provided in `input` are updated. Partial updates are
 * safe — omitted fields retain their current database values.
 *
 * When both `startDate` and `endDate` are provided, the range is validated.
 * When only one date is provided, the existing stored date is fetched and
 * the range is validated against it to ensure consistency.
 *
 * @param batchId - The UUID of the batch to update.
 * @param input   - The fields to update (all optional).
 *
 * @example
 * const result = await updateBatch('uuid-here', {
 *   name: 'NEET 2026 Evening',
 *   maxSeats: 120,
 *   updatedBy: 'uuid-here',
 * });
 */
export async function updateBatch(
  batchId: string,
  input: UpdateBatchInput,
): Promise<ApiResponse<Batch>> {
  try {
    validateUUID(batchId, 'batchId');

    if (input.updatedBy) {
      validateUUID(input.updatedBy, 'updatedBy');
    }

    // ── Build update payload (only provided fields) ────────────────────
    const dbRecord: Record<string, unknown> = {};

    if (input.name !== undefined) {
      if (!input.name.trim()) {
        return { success: false, error: 'Batch name cannot be empty.' };
      }
      dbRecord.name = input.name.trim();
    }

    if (input.batchCode !== undefined) {
      if (!input.batchCode.trim()) {
        return { success: false, error: 'Batch code cannot be empty.' };
      }
      dbRecord.batch_code = input.batchCode.trim().toUpperCase();
    }

    if (input.academicYear !== undefined) {
      if (!input.academicYear.trim()) {
        return { success: false, error: 'Academic year cannot be empty.' };
      }
      dbRecord.academic_year = input.academicYear.trim();
    }

    if (input.startDate !== undefined) {
      dbRecord.start_date = input.startDate;
    }

    if (input.endDate !== undefined) {
      dbRecord.end_date = input.endDate;
    }

    // Validate date range
    if (input.startDate !== undefined && input.endDate !== undefined) {
      validateDateRange(input.startDate, input.endDate);
    } else if (input.startDate !== undefined || input.endDate !== undefined) {
      const dateError = await validatePartialDateRange(
        batchId,
        input.startDate,
        input.endDate,
      );
      if (dateError) {
        return { success: false, error: dateError };
      }
    }

    if (input.maxSeats !== undefined) {
      validateMaxSeats(input.maxSeats);
      dbRecord.max_seats = input.maxSeats;
    }

    if (input.status !== undefined) {
      dbRecord.status = input.status;
    }

    if (input.updatedBy !== undefined) {
      dbRecord.updated_by = input.updatedBy;
    }

    // ── Update ─────────────────────────────────────────────────────────
    const { data, error } = await supabase
      .from('batches')
      .update(dbRecord)
      .eq('batch_id', batchId)
      .select()
      .single<DbBatch>();

    if (error) {
      // PGRST116 = batch not found
      if (error.code === 'PGRST116') {
        return { success: false, error: `Batch not found: ${batchId}` };
      }

      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapBatch(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Soft-delete a batch by setting its `deleted_at` timestamp.
 *
 * The row remains in the database and can be recovered by an admin.
 * List queries exclude soft-deleted rows by default.
 *
 * If the batch is referenced by foreign keys that use `ON DELETE RESTRICT`,
 * the database will prevent deletion and return an error.
 *
 * @param batchId - The UUID of the batch to soft-delete.
 *
 * @example
 * const result = await deleteBatch('uuid-here');
 * if (result.success) {
 *   // batch.deletedAt is now set
 * }
 */
export async function deleteBatch(batchId: string): Promise<ApiResponse<void>> {
  try {
    validateUUID(batchId, 'batchId');

    // Soft delete: set deleted_at to current timestamp
    const { error } = await supabase
      .from('batches')
      .update({ deleted_at: new Date().toISOString() })
      .eq('batch_id', batchId);

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Future Expansion — Teacher Assignment
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Assign a teacher to this batch.
 *
 * @todo Implement in a future iteration.
 *
 * @param batchId   - The UUID of the batch.
 * @param teacherId - The UUID of the teacher profile.
 *
 * @throws Always throws — not yet implemented.
 */
export async function assignTeacher(
  batchId: string,
  teacherId: string,
): Promise<ApiResponse<void>> {
  void batchId;
  void teacherId;

  return {
    success: false,
    error:
      'assignTeacher is not yet implemented. It will be available in a future release.',
  };
}

/**
 * Remove a teacher from this batch.
 *
 * @todo Implement in a future iteration.
 *
 * @param batchId   - The UUID of the batch.
 * @param teacherId - The UUID of the teacher profile.
 *
 * @throws Always throws — not yet implemented.
 */
export async function removeTeacher(
  batchId: string,
  teacherId: string,
): Promise<ApiResponse<void>> {
  void batchId;
  void teacherId;

  return {
    success: false,
    error:
      'removeTeacher is not yet implemented. It will be available in a future release.',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Future Expansion — Student Assignment
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Assign one or more students to this batch.
 *
 * @todo Implement in a future iteration.
 *
 * @param batchId    - The UUID of the batch.
 * @param studentIds - Array of student profile UUIDs.
 *
 * @throws Always throws — not yet implemented.
 */
export async function assignStudents(
  batchId: string,
  studentIds: string[],
): Promise<ApiResponse<void>> {
  void batchId;
  void studentIds;

  return {
    success: false,
    error:
      'assignStudents is not yet implemented. It will be available in a future release.',
  };
}

/**
 * Remove a student from this batch.
 *
 * @todo Implement in a future iteration.
 *
 * @param batchId   - The UUID of the batch.
 * @param studentId - The UUID of the student profile.
 *
 * @throws Always throws — not yet implemented.
 */
export async function removeStudent(
  batchId: string,
  studentId: string,
): Promise<ApiResponse<void>> {
  void batchId;
  void studentId;

  return {
    success: false,
    error:
      'removeStudent is not yet implemented. It will be available in a future release.',
  };
}

/**
 * Fetch all students enrolled in this batch.
 *
 * @todo Implement in a future iteration.
 *
 * @param batchId - The UUID of the batch.
 *
 * @throws Always throws — not yet implemented.
 */
export async function getBatchStudents(
  batchId: string,
): Promise<ApiResponse<unknown[]>> {
  void batchId;

  return {
    success: false,
    error:
      'getBatchStudents is not yet implemented. It will be available in a future release.',
  };
}

/**
 * Fetch all teachers assigned to this batch.
 *
 * @todo Implement in a future iteration.
 *
 * @param batchId - The UUID of the batch.
 *
 * @throws Always throws — not yet implemented.
 */
export async function getBatchTeachers(
  batchId: string,
): Promise<ApiResponse<unknown[]>> {
  void batchId;

  return {
    success: false,
    error:
      'getBatchTeachers is not yet implemented. It will be available in a future release.',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Future Expansion — Batch Lifecycle
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Close a batch, preventing further enrollments or modifications.
 *
 * Sets `status` to `'completed'`.
 *
 * @todo Implement in a future iteration.
 *
 * @param batchId - The UUID of the batch to close.
 *
 * @throws Always throws — not yet implemented.
 */
export async function closeBatch(batchId: string): Promise<ApiResponse<void>> {
  void batchId;

  return {
    success: false,
    error:
      'closeBatch is not yet implemented. It will be available in a future release.',
  };
}

/**
 * Archive a batch for historical reference.
 *
 * Sets `status` to `'archived'`.
 *
 * @todo Implement in a future iteration.
 *
 * @param batchId - The UUID of the batch to archive.
 *
 * @throws Always throws — not yet implemented.
 */
export async function archiveBatch(
  batchId: string,
): Promise<ApiResponse<void>> {
  void batchId;

  return {
    success: false,
    error:
      'archiveBatch is not yet implemented. It will be available in a future release.',
  };
}
