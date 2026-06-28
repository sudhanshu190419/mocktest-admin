/**
 * Stream Service
 *
 * Clean-architecture service layer encapsulating all Stream CRUD operations.
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
 * 3. **Clean mapping layer.** A single `mapStream` helper converts all
 *    snake_case database rows to camelCase TypeScript interfaces, avoiding
 *    duplication across functions.
 *
 * @module streamService
 */

import { supabase } from '../../config/supabase';
import { validateUUID, extractErrorMessage, buildPagination } from '../../utils/supabase';
import { buildPaginatedResponse } from '../../utils/response';
import type {
  ApiResponse,
  PaginatedResponse,
  PaginationParams,
  SortDirection,
  Stream,
  CreateStreamInput,
  UpdateStreamInput,
  StreamFilters,
  StreamSortOptions,
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
 * Raw snake_case shape of the `streams` table returned by Supabase.
 *
 * This type is internal to the service layer and is never exported.
 * Consumers receive only the camelCase `Stream` interface.
 */
interface DbStream {
  stream_id: string;
  institute_id: string;
  name: string;
  code: string;
  description: string | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

// ─── Mapping Helpers ────────────────────────────────────────────────────────

/**
 * Converts a raw snake_case database row into a camelCase `Stream` interface.
 *
 * This is the single source of truth for the mapping. If the schema changes
 * or new fields are added, update this function in one place.
 */
function mapStream(db: DbStream): Stream {
  return {
    streamId: db.stream_id,
    instituteId: db.institute_id,
    name: db.name,
    code: db.code,
    description: db.description,
    isActive: db.is_active,
    displayOrder: db.display_order,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
    createdBy: db.created_by,
    updatedBy: db.updated_by,
  };
}

/**
 * Converts a camelCase sort key from `StreamSortOptions` to the
 * corresponding snake_case column name in the database.
 */
function mapSortField(sortBy: StreamSortOptions['sortBy']): string {
  return SORT_FIELD_MAP[sortBy ?? 'displayOrder'] ?? 'display_order';
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch a paginated, filtered, and sorted list of streams.
 *
 * All parameters are optional. Sensible defaults are applied:
 * - page: 1
 * - pageSize: 20
 * - sortBy: display_order (ascending)
 *
 * @param filters   - Optional filter criteria (instituteId, isActive, search, ids).
 * @param sort      - Optional sort configuration (sortBy, sortDirection).
 * @param pagination - Optional pagination parameters (page, pageSize).
 *
 * @example
 * const result = await getStreams(
 *   { instituteId: '...', isActive: true },
 *   { sortBy: 'displayOrder', sortDirection: 'asc' },
 *   { page: 1, pageSize: 10 },
 * );
 *
 * if (result.success) {
 *   console.log(result.data.data);    // Stream[]
 *   console.log(result.data.count);   // total rows (for pagination)
 * }
 */
export async function getStreams(
  filters?: StreamFilters,
  sort?: StreamSortOptions,
  pagination?: PaginationParams,
): Promise<ApiResponse<PaginatedResponse<Stream>>> {
  try {
    // ── Build query ────────────────────────────────────────────────────
    let query = supabase
      .from('streams')
      .select('*', { count: 'exact' });

    // ── Apply filters ──────────────────────────────────────────────────
    if (filters?.instituteId) {
      validateUUID(filters.instituteId, 'instituteId');
      query = query.eq('institute_id', filters.instituteId);
    }

    if (filters?.isActive !== undefined) {
      query = query.eq('is_active', filters.isActive);
    }

    if (filters?.search) {
      const searchTerm = `%${filters.search}%`;
      query = query.or(`name.ilike.${searchTerm},code.ilike.${searchTerm}`);
    }

    if (filters?.ids && filters.ids.length > 0) {
      query = query.in('stream_id', filters.ids);
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

    const streams = (data ?? []).map(mapStream);

    return {
      success: true,
      data: buildPaginatedResponse(streams, count ?? 0, page, pageSize),
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Fetch a single stream by its ID.
 *
 * @param streamId - The UUID of the stream to retrieve.
 *
 * @example
 * const result = await getStreamById('uuid-here');
 * if (result.success) {
 *   console.log(result.data.name);
 * }
 */
export async function getStreamById(streamId: string): Promise<ApiResponse<Stream>> {
  try {
    validateUUID(streamId, 'streamId');

    const { data, error } = await supabase
      .from('streams')
      .select('*')
      .eq('stream_id', streamId)
      .single<DbStream>();

    if (error) {
      // PGRST116 = "The result contains 0 rows" — stream not found
      if (error.code === 'PGRST116') {
        return { success: false, error: `Stream not found: ${streamId}` };
      }

      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapStream(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Create a new stream.
 *
 * The `code` is automatically uppercased to match the database constraint
 * (`ck_streams_code_format`). The `updated_by` is explicitly set to `null`
 * on creation — only updates populate this field.
 *
 * @param input - The stream creation payload.
 *
 * @example
 * const result = await createStream({
 *   instituteId: 'uuid-here',
 *   name: 'NEET',
 *   code: 'NEET',
 *   displayOrder: 10,
 * });
 */
export async function createStream(input: CreateStreamInput): Promise<ApiResponse<Stream>> {
  try {
    // ── Validate required fields ───────────────────────────────────────
    if (!input.instituteId) {
      return { success: false, error: 'instituteId is required.' };
    }

    if (!input.name?.trim()) {
      return { success: false, error: 'Stream name is required.' };
    }

    if (!input.code?.trim()) {
      return { success: false, error: 'Stream code is required.' };
    }

    validateUUID(input.instituteId, 'instituteId');

    if (input.createdBy) {
      validateUUID(input.createdBy, 'createdBy');
    }

    // ── Build DB record ────────────────────────────────────────────────
    const dbRecord = {
      institute_id: input.instituteId,
      name: input.name.trim(),
      code: input.code.trim().toUpperCase(),
      description: input.description ?? null,
      is_active: input.isActive ?? true,
      display_order: input.displayOrder ?? 0,
      created_by: input.createdBy ?? null,
      updated_by: null,
    };

    // ── Insert ─────────────────────────────────────────────────────────
    const { data, error } = await supabase
      .from('streams')
      .insert(dbRecord)
      .select()
      .single<DbStream>();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapStream(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Update an existing stream.
 *
 * Only the fields provided in `input` are updated. Partial updates are
 * safe — omitted fields retain their current database values.
 *
 * @param streamId - The UUID of the stream to update.
 * @param input    - The fields to update (all optional).
 *
 * @example
 * const result = await updateStream('uuid-here', {
 *   name: 'NEET UG',
 *   displayOrder: 5,
 * });
 */
export async function updateStream(
  streamId: string,
  input: UpdateStreamInput,
): Promise<ApiResponse<Stream>> {
  try {
    validateUUID(streamId, 'streamId');

    if (input.updatedBy) {
      validateUUID(input.updatedBy, 'updatedBy');
    }

    // ── Build update payload (only provided fields) ────────────────────
    const dbRecord: Record<string, unknown> = {};

    if (input.name !== undefined) {
      if (!input.name.trim()) {
        return { success: false, error: 'Stream name cannot be empty.' };
      }
      dbRecord.name = input.name.trim();
    }

    if (input.code !== undefined) {
      if (!input.code.trim()) {
        return { success: false, error: 'Stream code cannot be empty.' };
      }
      dbRecord.code = input.code.trim().toUpperCase();
    }

    if (input.description !== undefined) {
      dbRecord.description = input.description;
    }

    if (input.isActive !== undefined) {
      dbRecord.is_active = input.isActive;
    }

    if (input.displayOrder !== undefined) {
      dbRecord.display_order = input.displayOrder;
    }

    if (input.updatedBy !== undefined) {
      dbRecord.updated_by = input.updatedBy;
    }

    // ── Update ─────────────────────────────────────────────────────────
    const { data, error } = await supabase
      .from('streams')
      .update(dbRecord)
      .eq('stream_id', streamId)
      .select()
      .single<DbStream>();

    if (error) {
      // PGRST116 = stream not found
      if (error.code === 'PGRST116') {
        return { success: false, error: `Stream not found: ${streamId}` };
      }

      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapStream(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Permanently delete a stream.
 *
 * The `streams` table has no `deleted_at` column, so this performs a hard
 * delete. If the stream is referenced by foreign keys (subjects, batches),
 * the `ON DELETE RESTRICT` constraint in the database will prevent deletion
 * and return an error.
 *
 * @param streamId - The UUID of the stream to delete.
 *
 * @example
 * const result = await deleteStream('uuid-here');
 * if (result.success) {
 *   // stream permanently removed
 * }
 */
export async function deleteStream(streamId: string): Promise<ApiResponse<void>> {
  try {
    validateUUID(streamId, 'streamId');

    const { error } = await supabase
      .from('streams')
      .delete()
      .eq('stream_id', streamId);

    if (error) {
      // Foreign-key violation (stream has dependent rows)
      if (error.code === '23503') {
        return {
          success: false,
          error:
            'Cannot delete this stream because it has associated subjects or batches. ' +
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
