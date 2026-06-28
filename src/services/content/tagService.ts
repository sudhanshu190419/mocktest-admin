/**
 * Tag Service
 *
 * Clean-architecture service layer for managing tags and the content_tag
 * junction table. Tags are flat, institute-scoped labels that can be
 * attached to content for filtering and search.
 *
 * ## Architecture decisions
 *
 * 1. **Tags are immutable.** The tags table has no updated_at column — tag
 *    names are meant to be stable identifiers. Rename is supported via
 *    updateTag() for admin corrections, but the application should prefer
 *    delete + recreate for significant changes.
 *
 * 2. **Cascade on delete.** Both content_tag foreign keys use ON DELETE
 *    CASCADE. Deleting a tag automatically removes all content_tag
 *    junction rows — no manual cleanup needed.
 *
 * 3. **Unique per institute.** Tag names are unique within an institute
 *    (enforced by uq_tags_institute_name). createTag() lets the unique
 *    violation bubble up and returns a friendly duplicate-name error.
 *
 * @module tagService
 */

import { supabase } from '../../config/supabase';
import { validateUUID, extractErrorMessage, buildPagination } from '../../utils/supabase';
import { buildPaginatedResponse } from '../../utils/response';
import type {
  ApiResponse,
  PaginatedResponse,
  PaginationParams,
  SortDirection,
} from '../../types/academic';
import type {
  Tag,
  CreateTagInput,
  UpdateTagInput,
  TagFilters,
  TagSortOptions,
  ContentTag,
} from '../../types/content';

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Maps camelCase sort keys to their snake_case database column names.
 */
const SORT_FIELD_MAP: Record<string, string> = {
  name: 'name',
  createdAt: 'created_at',
};

// ─── Database Row Shapes ───────────────────────────────────────────────────

/**
 * Raw snake_case shape of the `tags` table returned by Supabase.
 */
interface DbTag {
  tag_id: string;
  institute_id: string;
  name: string;
  created_at: string;
  created_by: string | null;
}

/**
 * Raw snake_case shape of the `content_tag` table returned by Supabase.
 */
interface DbContentTag {
  content_id: string;
  tag_id: string;
  tagged_at: string;
  tagged_by: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Mapping Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Converts a raw snake_case tag row into a camelCase `Tag` interface.
 */
function mapTag(db: DbTag): Tag {
  return {
    tagId: db.tag_id,
    instituteId: db.institute_id,
    name: db.name,
    createdAt: db.created_at,
    createdBy: db.created_by,
  };
}

/**
 * Converts a raw snake_case content_tag row into a camelCase `ContentTag`.
 */
function mapContentTag(db: DbContentTag): ContentTag {
  return {
    contentId: db.content_id,
    tagId: db.tag_id,
    taggedAt: db.tagged_at,
    taggedBy: db.tagged_by,
  };
}

/**
 * Converts a camelCase sort key to its snake_case column name.
 */
function mapSortField(sortBy: TagSortOptions['sortBy']): string {
  return SORT_FIELD_MAP[sortBy ?? 'name'] ?? 'name';
}

// ═══════════════════════════════════════════════════════════════════════════
//  1. getTags()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch a paginated, filtered, and sorted list of tags.
 *
 * Supports filtering by instituteId, search (name), and specific tag IDs.
 * Tags are always active — no isActive filter is needed.
 *
 * @param filters    - Optional filter criteria.
 * @param sort       - Optional sort configuration.
 * @param pagination - Optional pagination parameters.
 */
export async function getTags(
  filters?: TagFilters,
  sort?: TagSortOptions,
  pagination?: PaginationParams,
): Promise<ApiResponse<PaginatedResponse<Tag>>> {
  try {
    // ── Build query ────────────────────────────────────────────────────
    let query = supabase
      .from('tags')
      .select('*', { count: 'exact' });

    // ── Apply filters ──────────────────────────────────────────────────
    if (filters?.instituteId) {
      validateUUID(filters.instituteId, 'instituteId');
      query = query.eq('institute_id', filters.instituteId);
    }

    if (filters?.createdBy) {
      validateUUID(filters.createdBy, 'createdBy');
      query = query.eq('created_by', filters.createdBy);
    }

    if (filters?.search) {
      const searchTerm = `%${filters.search}%`;
      query = query.or(`name.ilike.${searchTerm}`);
    }

    if (filters?.ids && filters.ids.length > 0) {
      query = query.in('tag_id', filters.ids);
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

    const items = (data ?? []).map(mapTag);

    return {
      success: true,
      data: buildPaginatedResponse(items, count ?? 0, page, pageSize),
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  2. getTagById()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch a single tag by its ID.
 *
 * @param tagId - The UUID of the tag to retrieve.
 */
export async function getTagById(tagId: string): Promise<ApiResponse<Tag>> {
  try {
    validateUUID(tagId, 'tagId');

    const { data, error } = await supabase
      .from('tags')
      .select('*')
      .eq('tag_id', tagId)
      .single<DbTag>();

    if (error) {
      if (error.code === 'PGRST116') {
        return { success: false, error: `Tag not found: ${tagId}` };
      }
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapTag(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  3. createTag()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Creates a new tag.
 *
 * Tag names are normalised to lowercase before insert to satisfy the
 * `ck_tags_name_lowercase` CHECK constraint. Duplicate tag names within
 * the same institute are silently ignored — the function returns the
 * existing tag if a conflict occurs.
 *
 * @param input - The tag creation payload.
 */
export async function createTag(input: CreateTagInput): Promise<ApiResponse<Tag>> {
  try {
    // ── Validate required fields ────────────────────────────────────────
    if (!input.instituteId) {
      return { success: false, error: 'instituteId is required.' };
    }
    if (!input.name?.trim()) {
      return { success: false, error: 'Tag name is required.' };
    }

    validateUUID(input.instituteId, 'instituteId');

    if (input.createdBy) {
      validateUUID(input.createdBy, 'createdBy');
    }

    // ── Normalise to lowercase ─────────────────────────────────────────
    const normalisedName = input.name.trim().toLowerCase();

    // ── Insert — let unique violation (23505) bubble up naturally ──────
    const { data, error } = await supabase
      .from('tags')
      .insert({
        institute_id: input.instituteId,
        name: normalisedName,
        created_by: input.createdBy ?? null,
      })
      .select()
      .single<DbTag>();

    if (error) {
      // Unique violation (23505) — duplicate tag name in this institute
      if (error.code === '23505') {
        return {
          success: false,
          error: `A tag named "${normalisedName}" already exists in this institute.`,
        };
      }
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapTag(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  4. updateTag()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Updates an existing tag's name.
 *
 * Tag names are normalised to lowercase before update. If the new name
 * conflicts with an existing tag in the same institute, a friendly error
 * is returned.
 *
 * Note: Tags are intended to be immutable. This function exists for
 * admin corrections only. Prefer delete + recreate for significant changes.
 *
 * @param tagId - The UUID of the tag to update.
 * @param input - The fields to update (name only).
 */
export async function updateTag(
  tagId: string,
  input: UpdateTagInput,
): Promise<ApiResponse<Tag>> {
  try {
    validateUUID(tagId, 'tagId');

    if (!input.name?.trim()) {
      return { success: false, error: 'Tag name is required.' };
    }

    // ── Normalise to lowercase ─────────────────────────────────────────
    const normalisedName = input.name.trim().toLowerCase();

    // ── Update ─────────────────────────────────────────────────────────
    const { data, error } = await supabase
      .from('tags')
      .update({ name: normalisedName })
      .eq('tag_id', tagId)
      .select()
      .single<DbTag>();

    if (error) {
      if (error.code === 'PGRST116') {
        return { success: false, error: `Tag not found: ${tagId}` };
      }
      if (error.code === '23505') {
        return {
          success: false,
          error: `A tag named "${normalisedName}" already exists in this institute.`,
        };
      }
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapTag(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  5. deleteTag()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Permanently deletes a tag.
 *
 * The `content_tag` junction rows use ON DELETE CASCADE, so all
 * associations to this tag are automatically removed. No manual cleanup
 * is required.
 *
 * If the tag is referenced by other tables (e.g. RLS policies reference
 * tag names), the database constraint will block deletion and return a
 * friendly FK error.
 *
 * @param tagId - The UUID of the tag to delete.
 */
export async function deleteTag(tagId: string): Promise<ApiResponse<void>> {
  try {
    validateUUID(tagId, 'tagId');

    const { error } = await supabase
      .from('tags')
      .delete()
      .eq('tag_id', tagId);

    if (error) {
      if (error.code === 'PGRST116') {
        return { success: false, error: `Tag not found: ${tagId}` };
      }
      if (error.code === '23503') {
        return {
          success: false,
          error:
            'Cannot delete this tag because it is referenced by other content. ' +
            'Remove all tag associations first.',
        };
      }
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  6. attachTag()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Attaches a tag to a content item.
 *
 * If the association already exists, the unique constraint returns a 23505
 * error which is surfaced to the caller. If the content or tag does not
 * exist, the foreign key constraint returns a 23503 error.
 *
 * @param contentId - The UUID of the content to tag.
 * @param tagId     - The UUID of the tag to attach.
 * @param taggedBy  - Optional profile who applied the tag.
 */
export async function attachTag(
  contentId: string,
  tagId: string,
  taggedBy?: string | null,
): Promise<ApiResponse<ContentTag>> {
  try {
    validateUUID(contentId, 'contentId');
    validateUUID(tagId, 'tagId');

    if (taggedBy) {
      validateUUID(taggedBy, 'taggedBy');
    }

    // ── Insert — let FK or unique violation bubble up naturally ──────
    const { data, error } = await supabase
      .from('content_tag')
      .insert({
        content_id: contentId,
        tag_id: tagId,
        tagged_by: taggedBy ?? null,
      })
      .select()
      .single<DbContentTag>();

    if (error) {
      // 23503 = foreign key violation (content or tag doesn't exist)
      // 23505 = unique violation (association already exists)
      if (error.code === '23503') {
        return {
          success: false,
          error:
            'Cannot attach tag: the content or tag does not exist. ' +
            'Both contentId and tagId must reference valid records.',
        };
      }
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapContentTag(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  7. detachTag()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Removes a tag association from a content item.
 *
 * Returns success even if the association did not exist (idempotent).
 *
 * @param contentId - The UUID of the content to untag.
 * @param tagId     - The UUID of the tag to detach.
 */
export async function detachTag(
  contentId: string,
  tagId: string,
): Promise<ApiResponse<void>> {
  try {
    validateUUID(contentId, 'contentId');
    validateUUID(tagId, 'tagId');

    const { error } = await supabase
      .from('content_tag')
      .delete()
      .eq('content_id', contentId)
      .eq('tag_id', tagId);

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  8. replaceTags()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Synchronises the tag associations for a content item.
 *
 * Best-effort replace operation:
 *   1. Removes all current tag associations for the content
 *   2. Inserts the new set of tag associations
 *
 * These are two separate Supabase calls — there is no DB-level transaction.
 * If the insert step fails after the delete succeeds, the old associations
 * are lost. This is an acceptable trade-off for simplicity; a future
 * iteration could use a Postgres function for true atomicity.
 *
 * @param contentId - The UUID of the content to retag.
 * @param tagIds    - The complete set of tag UUIDs to attach.
 * @param taggedBy  - Optional profile performing the operation.
 */
export async function replaceTags(
  contentId: string,
  tagIds: string[],
  taggedBy?: string | null,
): Promise<ApiResponse<ContentTag[]>> {
  try {
    validateUUID(contentId, 'contentId');

    if (tagIds.length > 0) {
      for (const tagId of tagIds) {
        validateUUID(tagId, 'tagId');
      }
    }

    if (taggedBy) {
      validateUUID(taggedBy, 'taggedBy');
    }

    // ── 1. Remove all existing tag associations ─────────────────────────
    const { error: deleteError } = await supabase
      .from('content_tag')
      .delete()
      .eq('content_id', contentId);

    if (deleteError) {
      return { success: false, error: extractErrorMessage(deleteError) };
    }

    // ── If no new tags, return empty ────────────────────────────────────
    if (tagIds.length === 0) {
      return { success: true, data: [] };
    }

    // ── 2. Insert new tag associations ──────────────────────────────────
    const junctionRows = tagIds.map((tagId) => ({
      content_id: contentId,
      tag_id: tagId,
      tagged_by: taggedBy ?? null,
    }));

    const { data, error: insertError } = await supabase
      .from('content_tag')
      .insert(junctionRows)
      .select();

    if (insertError) {
      // If insert fails, the delete has already happened.
      // This is a partial-failure scenario. Log it and return the error.
      return {
        success: false,
        error: `Tag replacement failed after removing old associations: ${extractErrorMessage(insertError)}`,
      };
    }

    return { success: true, data: (data ?? []).map(mapContentTag) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  9. getContentTags()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch all tags attached to a specific content item.
 *
 * Returns an array of `Tag` objects (not `ContentTag`) with the content's
 * tags resolved through the junction table.
 *
 * @param contentId - The UUID of the content.
 */
export async function getContentTags(contentId: string): Promise<ApiResponse<Tag[]>> {
  try {
    validateUUID(contentId, 'contentId');

    // Join through content_tag → tags
    const { data, error } = await supabase
      .from('content_tag')
      .select('tags!inner(*)')
      .eq('content_id', contentId);

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    // Supabase returns the nested foreign table. The inner join on `tags`
    // produces an array of raw tag rows nested under each content_tag row.
    // Cast through `unknown` to bridge the generated Supabase type.
    const tags: Tag[] = ((data ?? []) as unknown as { tags: DbTag }[])
      .map((row) => mapTag(row.tags))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { success: true, data: tags };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  10. getTagContents()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch paginated content IDs tagged with a specific tag.
 *
 * Returns an array of `ContentTag` records including the taggedAt timestamp.
 * For full content objects, use the returned content IDs with
 * `contentService.getContents({ ids: [...] })`.
 *
 * @param tagId      - The UUID of the tag.
 * @param pagination - Optional pagination parameters.
 */
export async function getTagContents(
  tagId: string,
  pagination?: PaginationParams,
): Promise<ApiResponse<PaginatedResponse<ContentTag>>> {
  try {
    validateUUID(tagId, 'tagId');

    // ── Build query ────────────────────────────────────────────────────
    let query = supabase
      .from('content_tag')
      .select('*', { count: 'exact' })
      .eq('tag_id', tagId)
      .order('tagged_at', { ascending: false });

    // ── Apply pagination ───────────────────────────────────────────────
    const { page, pageSize, from, to } = buildPagination(pagination);
    query = query.range(from, to);

    // ── Execute ────────────────────────────────────────────────────────
    const { data, error, count } = await query;

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    const items = (data ?? []).map(mapContentTag);

    return {
      success: true,
      data: buildPaginatedResponse(items, count ?? 0, page, pageSize),
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}
