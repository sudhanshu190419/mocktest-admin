/**
 * Subject Service
 *
 * Clean-architecture service layer encapsulating all Subject CRUD operations.
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
 * 3. **Clean mapping layer.** A single `mapSubject` helper converts all
 *    snake_case database rows to camelCase TypeScript interfaces, avoiding
 *    duplication across functions.
 *
 * @module subjectService
 */

import { supabase } from '../../config/supabase';
import { validateUUID, extractErrorMessage, buildPagination } from '../../utils/supabase';
import { buildPaginatedResponse } from '../../utils/response';
import type {
  ApiResponse,
  PaginatedResponse,
  PaginationParams,
  SortDirection,
  Subject,
  CreateSubjectInput,
  UpdateSubjectInput,
  SubjectFilters,
  SubjectSortOptions,
} from '../../types/academic';

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Maps camelCase sort keys to their snake_case database column names.
 * Unknown keys fall back to `display_order`.
 */
const SORT_FIELD_MAP: Record<string, string> = {
  name: 'name',
  code: 'code',
  displayOrder: 'display_order',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

// ─── Database Row Shape ────────────────────────────────────────────────────

/**
 * Raw snake_case shape of the `subjects` table returned by Supabase.
 *
 * This type is internal to the service layer and is never exported.
 * Consumers receive only the camelCase `Subject` interface.
 */
interface DbSubject {
  subject_id: string;
  stream_id: string;
  name: string;
  code: string;
  display_order: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

// ─── Mapping Helpers ────────────────────────────────────────────────────────

/**
 * Converts a raw snake_case database row into a camelCase `Subject` interface.
 *
 * This is the single source of truth for the mapping. If the schema changes
 * or new fields are added, update this function in one place.
 */
function mapSubject(db: DbSubject): Subject {
  return {
    subjectId: db.subject_id,
    streamId: db.stream_id,
    name: db.name,
    code: db.code,
    displayOrder: db.display_order,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
    createdBy: db.created_by,
    updatedBy: db.updated_by,
  };
}

/**
 * Converts a camelCase sort key from `SubjectSortOptions` to the
 * corresponding snake_case column name in the database.
 */
function mapSortField(sortBy: SubjectSortOptions['sortBy']): string {
  return SORT_FIELD_MAP[sortBy ?? 'displayOrder'] ?? 'display_order';
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch a paginated, filtered, and sorted list of subjects.
 *
 * All parameters are optional. Sensible defaults are applied:
 * - page: 1
 * - pageSize: 20
 * - sortBy: display_order (ascending)
 *
 * @param filters   - Optional filter criteria (streamId, search, ids).
 * @param sort      - Optional sort configuration (sortBy, sortDirection).
 * @param pagination - Optional pagination parameters (page, pageSize).
 *
 * @example
 * const result = await getSubjects(
 *   { streamId: '...', search: 'phy' },
 *   { sortBy: 'displayOrder', sortDirection: 'asc' },
 *   { page: 1, pageSize: 10 },
 * );
 *
 * if (result.success) {
 *   console.log(result.data.data);    // Subject[]
 *   console.log(result.data.count);   // total rows (for pagination)
 * }
 */
export async function getSubjects(
  filters?: SubjectFilters,
  sort?: SubjectSortOptions,
  pagination?: PaginationParams,
): Promise<ApiResponse<PaginatedResponse<Subject>>> {
  try {
    // ── Build query ────────────────────────────────────────────────────
    let query = supabase
      .from('subjects')
      .select('*', { count: 'exact' });

    // ── Apply filters ──────────────────────────────────────────────────
    if (filters?.streamId) {
      validateUUID(filters.streamId, 'streamId');
      query = query.eq('stream_id', filters.streamId);
    }

    if (filters?.search) {
      const searchTerm = `%${filters.search}%`;
      query = query.or(`name.ilike.${searchTerm},code.ilike.${searchTerm}`);
    }

    if (filters?.ids && filters.ids.length > 0) {
      query = query.in('subject_id', filters.ids);
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

    const subjects = (data ?? []).map(mapSubject);

    return {
      success: true,
      data: buildPaginatedResponse(subjects, count ?? 0, page, pageSize),
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Fetch a single subject by its ID.
 *
 * @param subjectId - The UUID of the subject to retrieve.
 *
 * @example
 * const result = await getSubjectById('uuid-here');
 * if (result.success) {
 *   console.log(result.data.name);
 * }
 */
export async function getSubjectById(subjectId: string): Promise<ApiResponse<Subject>> {
  try {
    validateUUID(subjectId, 'subjectId');

    const { data, error } = await supabase
      .from('subjects')
      .select('*')
      .eq('subject_id', subjectId)
      .single<DbSubject>();

    if (error) {
      // PGRST116 = "The result contains 0 rows" — subject not found
      if (error.code === 'PGRST116') {
        return { success: false, error: `Subject not found: ${subjectId}` };
      }

      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapSubject(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Create a new subject.
 *
 * The `code` is automatically uppercased to match the database constraint
 * (`ck_subjects_code_format`). The `updated_by` is explicitly set to `null`
 * on creation — only updates populate this field.
 *
 * @param input - The subject creation payload.
 *
 * @example
 * const result = await createSubject({
 *   streamId: 'uuid-here',
 *   name: 'Physics',
 *   code: 'PHY',
 *   displayOrder: 10,
 * });
 */
export async function createSubject(input: CreateSubjectInput): Promise<ApiResponse<Subject>> {
  try {
    // ── Validate required fields ───────────────────────────────────────
    if (!input.streamId) {
      return { success: false, error: 'streamId is required.' };
    }

    if (!input.name?.trim()) {
      return { success: false, error: 'Subject name is required.' };
    }

    if (!input.code?.trim()) {
      return { success: false, error: 'Subject code is required.' };
    }

    validateUUID(input.streamId, 'streamId');

    if (input.createdBy) {
      validateUUID(input.createdBy, 'createdBy');
    }

    // ── Build DB record ────────────────────────────────────────────────
    const dbRecord = {
      stream_id: input.streamId,
      name: input.name.trim(),
      code: input.code.trim().toUpperCase(),
      display_order: input.displayOrder ?? 0,
      created_by: input.createdBy ?? null,
      updated_by: null,
    };

    // ── Insert ─────────────────────────────────────────────────────────
    const { data, error } = await supabase
      .from('subjects')
      .insert(dbRecord)
      .select()
      .single<DbSubject>();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapSubject(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Update an existing subject.
 *
 * Only the fields provided in `input` are updated. Partial updates are
 * safe — omitted fields retain their current database values.
 *
 * @param subjectId - The UUID of the subject to update.
 * @param input    - The fields to update (all optional).
 *
 * @example
 * const result = await updateSubject('uuid-here', {
 *   name: 'Physics I',
 *   displayOrder: 5,
 * });
 */
export async function updateSubject(
  subjectId: string,
  input: UpdateSubjectInput,
): Promise<ApiResponse<Subject>> {
  try {
    validateUUID(subjectId, 'subjectId');

    if (input.updatedBy) {
      validateUUID(input.updatedBy, 'updatedBy');
    }

    // ── Build update payload (only provided fields) ────────────────────
    const dbRecord: Record<string, unknown> = {};

    if (input.name !== undefined) {
      if (!input.name.trim()) {
        return { success: false, error: 'Subject name cannot be empty.' };
      }
      dbRecord.name = input.name.trim();
    }

    if (input.code !== undefined) {
      if (!input.code.trim()) {
        return { success: false, error: 'Subject code cannot be empty.' };
      }
      dbRecord.code = input.code.trim().toUpperCase();
    }

    if (input.displayOrder !== undefined) {
      dbRecord.display_order = input.displayOrder;
    }

    if (input.updatedBy !== undefined) {
      dbRecord.updated_by = input.updatedBy;
    }

    // ── Update ─────────────────────────────────────────────────────────
    const { data, error } = await supabase
      .from('subjects')
      .update(dbRecord)
      .eq('subject_id', subjectId)
      .select()
      .single<DbSubject>();

    if (error) {
      // PGRST116 = subject not found
      if (error.code === 'PGRST116') {
        return { success: false, error: `Subject not found: ${subjectId}` };
      }

      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapSubject(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Permanently delete a subject.
 *
 * The `subjects` table has no `deleted_at` column, so this performs a hard
 * delete. If the subject is referenced by foreign keys (chapters),
 * the `ON DELETE RESTRICT` constraint in the database will prevent deletion
 * and return an error.
 *
 * @param subjectId - The UUID of the subject to delete.
 *
 * @example
 * const result = await deleteSubject('uuid-here');
 * if (result.success) {
 *   // subject permanently removed
 * }
 */
export async function deleteSubject(subjectId: string): Promise<ApiResponse<void>> {
  try {
    validateUUID(subjectId, 'subjectId');

    const { error } = await supabase
      .from('subjects')
      .delete()
      .eq('subject_id', subjectId);

    if (error) {
      // Foreign-key violation (subject has dependent rows)
      if (error.code === '23503') {
        return {
          success: false,
          error:
            'Cannot delete this subject because it has associated chapters. ' +
            'Remove or reassign them first.',
        };
      }

      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}
