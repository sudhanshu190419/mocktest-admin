/**
 * Chapter Service
 *
 * Clean-architecture service layer encapsulating all Chapter CRUD operations.
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
 * 3. **Clean mapping layer.** A single `mapChapter` helper converts all
 *    snake_case database rows to camelCase TypeScript interfaces, avoiding
 *    duplication across functions.
 *
 * @module chapterService
 */

import { supabase } from '../../config/supabase';
import { validateUUID, extractErrorMessage, buildPagination } from '../../utils/supabase';
import { buildPaginatedResponse } from '../../utils/response';
import type {
  ApiResponse,
  PaginatedResponse,
  PaginationParams,
  SortDirection,
  Chapter,
  CreateChapterInput,
  UpdateChapterInput,
  ChapterFilters,
  ChapterSortOptions,
} from '../../types/academic';

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Maps camelCase sort keys to their snake_case database column names.
 * Unknown keys fall back to `display_order`.
 */
const SORT_FIELD_MAP: Record<string, string> = {
  name: 'name',
  displayOrder: 'display_order',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

// ─── Database Row Shape ────────────────────────────────────────────────────

/**
 * Raw snake_case shape of the `chapters` table returned by Supabase.
 *
 * This type is internal to the service layer and is never exported.
 * Consumers receive only the camelCase `Chapter` interface.
 */
interface DbChapter {
  chapter_id: string;
  subject_id: string;
  name: string;
  description: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

// ─── Mapping Helpers ────────────────────────────────────────────────────────

/**
 * Converts a raw snake_case database row into a camelCase `Chapter` interface.
 *
 * This is the single source of truth for the mapping. If the schema changes
 * or new fields are added, update this function in one place.
 */
function mapChapter(db: DbChapter): Chapter {
  return {
    chapterId: db.chapter_id,
    subjectId: db.subject_id,
    name: db.name,
    description: db.description,
    displayOrder: db.display_order,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
    createdBy: db.created_by,
    updatedBy: db.updated_by,
  };
}

/**
 * Converts a camelCase sort key from `ChapterSortOptions` to the
 * corresponding snake_case column name in the database.
 */
function mapSortField(sortBy: ChapterSortOptions['sortBy']): string {
  return SORT_FIELD_MAP[sortBy ?? 'displayOrder'] ?? 'display_order';
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch a paginated, filtered, and sorted list of chapters.
 *
 * All parameters are optional. Sensible defaults are applied:
 * - page: 1
 * - pageSize: 20
 * - sortBy: display_order (ascending)
 *
 * @param filters   - Optional filter criteria (subjectId, search, ids).
 * @param sort      - Optional sort configuration (sortBy, sortDirection).
 * @param pagination - Optional pagination parameters (page, pageSize).
 *
 * @example
 * const result = await getChapters(
 *   { subjectId: '...', search: 'laws' },
 *   { sortBy: 'displayOrder', sortDirection: 'asc' },
 *   { page: 1, pageSize: 10 },
 * );
 *
 * if (result.success) {
 *   console.log(result.data.data);    // Chapter[]
 *   console.log(result.data.count);   // total rows (for pagination)
 * }
 */
export async function getChapters(
  filters?: ChapterFilters,
  sort?: ChapterSortOptions,
  pagination?: PaginationParams,
): Promise<ApiResponse<PaginatedResponse<Chapter>>> {
  try {
    // ── Build query ────────────────────────────────────────────────────
    let query = supabase
      .from('chapters')
      .select('*', { count: 'exact' });

    // ── Apply filters ──────────────────────────────────────────────────
    if (filters?.subjectId) {
      validateUUID(filters.subjectId, 'subjectId');
      query = query.eq('subject_id', filters.subjectId);
    }

    if (filters?.search) {
      const searchTerm = `%${filters.search}%`;
      query = query.ilike('name', searchTerm);
    }

    if (filters?.ids && filters.ids.length > 0) {
      query = query.in('chapter_id', filters.ids);
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

    const chapters = (data ?? []).map(mapChapter);

    return {
      success: true,
      data: buildPaginatedResponse(chapters, count ?? 0, page, pageSize),
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Fetch a single chapter by its ID.
 *
 * @param chapterId - The UUID of the chapter to retrieve.
 *
 * @example
 * const result = await getChapterById('uuid-here');
 * if (result.success) {
 *   console.log(result.data.name);
 * }
 */
export async function getChapterById(chapterId: string): Promise<ApiResponse<Chapter>> {
  try {
    validateUUID(chapterId, 'chapterId');

    const { data, error } = await supabase
      .from('chapters')
      .select('*')
      .eq('chapter_id', chapterId)
      .single<DbChapter>();

    if (error) {
      // PGRST116 = "The result contains 0 rows" — chapter not found
      if (error.code === 'PGRST116') {
        return { success: false, error: `Chapter not found: ${chapterId}` };
      }

      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapChapter(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Create a new chapter.
 *
 * The `updated_by` is explicitly set to `null` on creation — only updates
 * populate this field.
 *
 * @param input - The chapter creation payload.
 *
 * @example
 * const result = await createChapter({
 *   subjectId: 'uuid-here',
 *   name: 'Laws of Motion',
 *   displayOrder: 10,
 * });
 */
export async function createChapter(input: CreateChapterInput): Promise<ApiResponse<Chapter>> {
  try {
    // ── Validate required fields ───────────────────────────────────────
    if (!input.subjectId) {
      return { success: false, error: 'subjectId is required.' };
    }

    if (!input.name?.trim()) {
      return { success: false, error: 'Chapter name is required.' };
    }

    validateUUID(input.subjectId, 'subjectId');

    if (input.createdBy) {
      validateUUID(input.createdBy, 'createdBy');
    }

    // ── Build DB record ────────────────────────────────────────────────
    const dbRecord = {
      subject_id: input.subjectId,
      name: input.name.trim(),
      description: input.description ?? null,
      display_order: input.displayOrder ?? 0,
      created_by: input.createdBy ?? null,
      updated_by: null,
    };

    // ── Insert ─────────────────────────────────────────────────────────
    const { data, error } = await supabase
      .from('chapters')
      .insert(dbRecord)
      .select()
      .single<DbChapter>();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapChapter(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Update an existing chapter.
 *
 * Only the fields provided in `input` are updated. Partial updates are
 * safe — omitted fields retain their current database values.
 *
 * @param chapterId - The UUID of the chapter to update.
 * @param input    - The fields to update (all optional).
 *
 * @example
 * const result = await updateChapter('uuid-here', {
 *   name: 'Laws of Motion I',
 *   displayOrder: 5,
 * });
 */
export async function updateChapter(
  chapterId: string,
  input: UpdateChapterInput,
): Promise<ApiResponse<Chapter>> {
  try {
    validateUUID(chapterId, 'chapterId');

    if (input.updatedBy) {
      validateUUID(input.updatedBy, 'updatedBy');
    }

    // ── Build update payload (only provided fields) ────────────────────
    const dbRecord: Record<string, unknown> = {};

    if (input.name !== undefined) {
      if (!input.name.trim()) {
        return { success: false, error: 'Chapter name cannot be empty.' };
      }
      dbRecord.name = input.name.trim();
    }

    if (input.description !== undefined) {
      dbRecord.description = input.description;
    }

    if (input.displayOrder !== undefined) {
      dbRecord.display_order = input.displayOrder;
    }

    if (input.updatedBy !== undefined) {
      dbRecord.updated_by = input.updatedBy;
    }

    // ── Update ─────────────────────────────────────────────────────────
    const { data, error } = await supabase
      .from('chapters')
      .update(dbRecord)
      .eq('chapter_id', chapterId)
      .select()
      .single<DbChapter>();

    if (error) {
      // PGRST116 = chapter not found
      if (error.code === 'PGRST116') {
        return { success: false, error: `Chapter not found: ${chapterId}` };
      }

      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapChapter(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Permanently delete a chapter.
 *
 * The `chapters` table has no `deleted_at` column, so this performs a hard
 * delete. If the chapter is referenced by foreign keys (topics),
 * the `ON DELETE RESTRICT` constraint in the database will prevent deletion
 * and return an error.
 *
 * @param chapterId - The UUID of the chapter to delete.
 *
 * @example
 * const result = await deleteChapter('uuid-here');
 * if (result.success) {
 *   // chapter permanently removed
 * }
 */
export async function deleteChapter(chapterId: string): Promise<ApiResponse<void>> {
  try {
    validateUUID(chapterId, 'chapterId');

    const { error } = await supabase
      .from('chapters')
      .delete()
      .eq('chapter_id', chapterId);

    if (error) {
      // Foreign-key violation (chapter has dependent rows)
      if (error.code === '23503') {
        return {
          success: false,
          error:
            'Cannot delete this chapter because it has associated topics. ' +
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
