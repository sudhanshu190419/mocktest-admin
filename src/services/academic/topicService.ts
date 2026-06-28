/**
 * Topic Service
 *
 * Clean-architecture service layer encapsulating all Topic CRUD operations.
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
 * 3. **Clean mapping layer.** A single `mapTopic` helper converts all
 *    snake_case database rows to camelCase TypeScript interfaces, avoiding
 *    duplication across functions.
 *
 * @module topicService
 */

import { supabase } from '../../config/supabase';
import { validateUUID, extractErrorMessage, buildPagination } from '../../utils/supabase';
import { buildPaginatedResponse } from '../../utils/response';
import type {
  ApiResponse,
  PaginatedResponse,
  PaginationParams,
  SortDirection,
  Topic,
  CreateTopicInput,
  UpdateTopicInput,
  TopicFilters,
  TopicSortOptions,
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
 * Raw snake_case shape of the `topics` table returned by Supabase.
 *
 * This type is internal to the service layer and is never exported.
 * Consumers receive only the camelCase `Topic` interface.
 */
interface DbTopic {
  topic_id: string;
  chapter_id: string;
  name: string;
  display_order: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

// ─── Mapping Helpers ────────────────────────────────────────────────────────

/**
 * Converts a raw snake_case database row into a camelCase `Topic` interface.
 *
 * This is the single source of truth for the mapping. If the schema changes
 * or new fields are added, update this function in one place.
 */
function mapTopic(db: DbTopic): Topic {
  return {
    topicId: db.topic_id,
    chapterId: db.chapter_id,
    name: db.name,
    displayOrder: db.display_order,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
    createdBy: db.created_by,
    updatedBy: db.updated_by,
  };
}

/**
 * Converts a camelCase sort key from `TopicSortOptions` to the
 * corresponding snake_case column name in the database.
 */
function mapSortField(sortBy: TopicSortOptions['sortBy']): string {
  return SORT_FIELD_MAP[sortBy ?? 'displayOrder'] ?? 'display_order';
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch a paginated, filtered, and sorted list of topics.
 *
 * All parameters are optional. Sensible defaults are applied:
 * - page: 1
 * - pageSize: 20
 * - sortBy: display_order (ascending)
 *
 * @param filters   - Optional filter criteria (chapterId, search, ids).
 * @param sort      - Optional sort configuration (sortBy, sortDirection).
 * @param pagination - Optional pagination parameters (page, pageSize).
 *
 * @example
 * const result = await getTopics(
 *   { chapterId: '...', search: 'newton' },
 *   { sortBy: 'displayOrder', sortDirection: 'asc' },
 *   { page: 1, pageSize: 10 },
 * );
 *
 * if (result.success) {
 *   console.log(result.data.data);    // Topic[]
 *   console.log(result.data.count);   // total rows (for pagination)
 * }
 */
export async function getTopics(
  filters?: TopicFilters,
  sort?: TopicSortOptions,
  pagination?: PaginationParams,
): Promise<ApiResponse<PaginatedResponse<Topic>>> {
  try {
    // ── Build query ────────────────────────────────────────────────────
    let query = supabase
      .from('topics')
      .select('*', { count: 'exact' });

    // ── Apply filters ──────────────────────────────────────────────────
    if (filters?.chapterId) {
      validateUUID(filters.chapterId, 'chapterId');
      query = query.eq('chapter_id', filters.chapterId);
    }

    if (filters?.search) {
      const searchTerm = `%${filters.search}%`;
      query = query.ilike('name', searchTerm);
    }

    if (filters?.ids && filters.ids.length > 0) {
      query = query.in('topic_id', filters.ids);
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

    const topics = (data ?? []).map(mapTopic);

    return {
      success: true,
      data: buildPaginatedResponse(topics, count ?? 0, page, pageSize),
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Fetch a single topic by its ID.
 *
 * @param topicId - The UUID of the topic to retrieve.
 *
 * @example
 * const result = await getTopicById('uuid-here');
 * if (result.success) {
 *   console.log(result.data.name);
 * }
 */
export async function getTopicById(topicId: string): Promise<ApiResponse<Topic>> {
  try {
    validateUUID(topicId, 'topicId');

    const { data, error } = await supabase
      .from('topics')
      .select('*')
      .eq('topic_id', topicId)
      .single<DbTopic>();

    if (error) {
      // PGRST116 = "The result contains 0 rows" — topic not found
      if (error.code === 'PGRST116') {
        return { success: false, error: `Topic not found: ${topicId}` };
      }

      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapTopic(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Create a new topic.
 *
 * The `updated_by` is explicitly set to `null` on creation — only updates
 * populate this field.
 *
 * @param input - The topic creation payload.
 *
 * @example
 * const result = await createTopic({
 *   chapterId: 'uuid-here',
 *   name: "Newton's First Law",
 *   displayOrder: 10,
 * });
 */
export async function createTopic(input: CreateTopicInput): Promise<ApiResponse<Topic>> {
  try {
    // ── Validate required fields ───────────────────────────────────────
    if (!input.chapterId) {
      return { success: false, error: 'chapterId is required.' };
    }

    if (!input.name?.trim()) {
      return { success: false, error: 'Topic name is required.' };
    }

    validateUUID(input.chapterId, 'chapterId');

    if (input.createdBy) {
      validateUUID(input.createdBy, 'createdBy');
    }

    // ── Build DB record ────────────────────────────────────────────────
    const dbRecord = {
      chapter_id: input.chapterId,
      name: input.name.trim(),
      display_order: input.displayOrder ?? 0,
      created_by: input.createdBy ?? null,
      updated_by: null,
    };

    // ── Insert ─────────────────────────────────────────────────────────
    const { data, error } = await supabase
      .from('topics')
      .insert(dbRecord)
      .select()
      .single<DbTopic>();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapTopic(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Update an existing topic.
 *
 * Only the fields provided in `input` are updated. Partial updates are
 * safe — omitted fields retain their current database values.
 *
 * @param topicId - The UUID of the topic to update.
 * @param input   - The fields to update (all optional).
 *
 * @example
 * const result = await updateTopic('uuid-here', {
 *   name: "Newton's First Law of Motion",
 *   displayOrder: 5,
 * });
 */
export async function updateTopic(
  topicId: string,
  input: UpdateTopicInput,
): Promise<ApiResponse<Topic>> {
  try {
    validateUUID(topicId, 'topicId');

    if (input.updatedBy) {
      validateUUID(input.updatedBy, 'updatedBy');
    }

    // ── Build update payload (only provided fields) ────────────────────
    const dbRecord: Record<string, unknown> = {};

    if (input.name !== undefined) {
      if (!input.name.trim()) {
        return { success: false, error: 'Topic name cannot be empty.' };
      }
      dbRecord.name = input.name.trim();
    }

    if (input.displayOrder !== undefined) {
      dbRecord.display_order = input.displayOrder;
    }

    if (input.updatedBy !== undefined) {
      dbRecord.updated_by = input.updatedBy;
    }

    // ── Update ─────────────────────────────────────────────────────────
    const { data, error } = await supabase
      .from('topics')
      .update(dbRecord)
      .eq('topic_id', topicId)
      .select()
      .single<DbTopic>();

    if (error) {
      // PGRST116 = topic not found
      if (error.code === 'PGRST116') {
        return { success: false, error: `Topic not found: ${topicId}` };
      }

      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapTopic(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Permanently delete a topic.
 *
 * The `topics` table has no `deleted_at` column, so this performs a hard
 * delete. If the topic is referenced by foreign keys (content, questions),
 * the `ON DELETE RESTRICT` constraint in the database will prevent deletion
 * and return an error.
 *
 * @param topicId - The UUID of the topic to delete.
 *
 * @example
 * const result = await deleteTopic('uuid-here');
 * if (result.success) {
 *   // topic permanently removed
 * }
 */
export async function deleteTopic(topicId: string): Promise<ApiResponse<void>> {
  try {
    validateUUID(topicId, 'topicId');

    const { error } = await supabase
      .from('topics')
      .delete()
      .eq('topic_id', topicId);

    if (error) {
      // Foreign-key violation (topic has dependent rows)
      if (error.code === '23503') {
        return {
          success: false,
          error:
            'Cannot delete this topic because it has associated content or questions. ' +
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
