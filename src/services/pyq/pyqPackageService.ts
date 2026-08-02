/**
 * PYQ Package Service
 *
 * Single source of truth for all PYQ Package operations in the
 * Teacher PYQ Package Management module.
 *
 * Every public method returns a standardised `ApiResponse<T>` shape.
 * Follows the exact same architecture as `courseManagementService.ts`,
 * `mockTestManagementService.ts`, and the mockTest `mockTestService.ts`.
 *
 * ## Scope
 *
 * This service manages the `pyq_packages` table only. It does NOT manage:
 * - Papers within a package (see pyqPaperService — Phase 1B)
 * - Question mappings (see pyqQuestionMappingService — Phase 1C)
 * - Mock mappings (see pyqMockMappingService — Phase 1D)
 * - Student purchases (see commerce services)
 *
 * ## Status Transitions
 *
 * A PYQ Package switches between two lifecycle states:
 * - **Unpublished** (is_active = false, published_at = null): visible only to
 *   teachers/admins, not available for purchase.
 * - **Published** (is_active = true, published_at IS NOT NULL): visible to
 *   students and available for purchase.
 *
 * @module services/pyq/pyqPackageService
 */

import { supabase } from '@/config/supabase';
import { buildPagination, extractErrorMessage, validateUUID } from '@/utils/supabase';
import { buildPaginatedResponse } from '@/utils/response';
import { auditService } from '@/services/audit/auditService';
import {
  isCurrentUserSuperAdmin,
  resolveCurrentProfileId,
} from './pyqOwnershipGuard';
import type { ApiResponse, PaginatedResponse, PaginationParams, SortDirection } from '@/types/academic';
import type {
  PyqPackage,
  CreatePyqPackageInput,
  UpdatePyqPackageInput,
  PyqPackageFilters,
  PyqPackageSortOptions,
  PyqPackageCounts,
} from '@/types/pyq';

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

const SORT_FIELD_MAP: Record<string, string> = {
  name: 'name',
  price: 'price',
  totalPapers: 'total_papers',
  isActive: 'is_active',
  publishedAt: 'published_at',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function mapSortField(sortBy?: PyqPackageSortOptions['sortBy']): string {
  return SORT_FIELD_MAP[sortBy ?? 'createdAt'] ?? 'created_at';
}

/** Maps a raw Supabase row (pyq_packages JOIN streams) to PyqPackage. */
function toPyqPackage(row: any): PyqPackage {
  return {
    packageId: row.package_id,
    instituteId: row.institute_id,
    streamId: row.stream_id,
    name: row.name,
    description: row.description ?? null,
    price: parseFloat(row.price ?? 0),
    currency: row.currency ?? 'INR',
    thumbnailPath: row.thumbnail_path ?? null,
    yearFrom: row.year_from ?? null,
    yearTo: row.year_to ?? null,
    totalPapers: row.total_papers ?? 0,
    isActive: row.is_active ?? false,
    publishedAt: row.published_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    streamName: row.streams?.name ?? null,
  };
}

/**
 * Validates that a package can be published.
 * Returns an error message if invalid, or null if allowed.
 */
function validatePublishRequirements(name: string, price: number): string | null {
  if (!name?.trim() || name.trim().length < 3) {
    return 'Package name must be at least 3 characters.';
  }
  if (price < 0) {
    return 'Price must be 0 or greater.';
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Service
// ═══════════════════════════════════════════════════════════════════════════

export const pyqPackageService = {
  // ─────────────────────────────────────────────────────────────────────────
  //  1. Package List
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a paginated, filtered, and sorted list of PYQ packages.
   *
   * Joins `pyq_packages` with `streams` to include the stream display name.
   * Supports search, stream filter, status filter, pagination, and sorting.
   *
   * Read access is open to authenticated users (teachers browse packages to
   * create papers inside them) — only MUTATIONS are Super Admin gated.
   */
  async getPackages(
    filters?: PyqPackageFilters,
    sort?: PyqPackageSortOptions,
    pagination?: PaginationParams,
  ): Promise<ApiResponse<PaginatedResponse<PyqPackage>>> {
    try {
      let query = supabase
        .from('pyq_packages')
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

      if (filters?.streamId) {
        query = query.eq('stream_id', filters.streamId);
      }

      if (filters?.isActive !== undefined) {
        query = query.eq('is_active', filters.isActive);
      }

      if (filters?.isPublished !== undefined) {
        if (filters.isPublished) {
          query = query.not('published_at', 'is', null);
        } else {
          query = query.is('published_at', null);
        }
      }

      if (filters?.search) {
        const term = `%${filters.search}%`;
        query = query.ilike('name', term);
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

      const items = (data ?? []).map(toPyqPackage);

      return {
        success: true,
        data: buildPaginatedResponse(items, count ?? 0, page, pageSize),
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  2. Single Package
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a single PYQ package by its ID, including the stream name.
   */
  async getPackage(packageId: string): Promise<ApiResponse<PyqPackage>> {
    try {
      validateUUID(packageId, 'packageId');

      const { data, error } = await supabase
        .from('pyq_packages')
        .select(
          `
          *,
          streams!left (
            name
          )
        `,
        )
        .eq('package_id', packageId)
        .is('deleted_at', null)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return { success: false, error: `PYQ package not found: ${packageId}` };
        }
        return { success: false, error: extractErrorMessage(error) };
      }

      return { success: true, data: toPyqPackage(data) };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  3. Create
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a new PYQ package.
   *
   * SUPER ADMIN ONLY — teachers cannot create packages (Phase 9B business
   * rule). Automatically populates `institute_id` from the authenticated
   * profile (packages are institute-owned), or from `input.instituteId` when
   * provided. Defaults: is_active = false, published_at = null, total_papers = 0.
   *
   * @param input - The package creation payload.
   */
  async createPackage(input: CreatePyqPackageInput): Promise<ApiResponse<PyqPackage>> {
    try {
      // ── Authorization: Super Admin only ────────────────────────────
      if (!(await isCurrentUserSuperAdmin())) {
        return {
          success: false,
          error: 'Only a Super Admin can create PYQ packages.',
        };
      }

      // ── Resolve institute from current profile (institute-owned) ──
      const profileId = await resolveCurrentProfileId();
      const { data: profile } = profileId
        ? await supabase
            .from('profiles')
            .select('institute_id')
            .eq('profile_id', profileId)
            .maybeSingle()
        : { data: null };

      const instituteId = input.instituteId ?? profile?.institute_id ?? null;
      if (!instituteId) {
        return {
          success: false,
          error:
            'Cannot create a PYQ package: no institute found for the current user. ' +
            'Ensure the authenticated profile has an institute assigned.',
        };
      }

      // ── Validate required fields ─────────────────────────────────────
      if (!input.name?.trim()) {
        return { success: false, error: 'Package name is required.' };
      }
      if (input.name.trim().length < 3) {
        return { success: false, error: 'Package name must be at least 3 characters.' };
      }
      if (!input.streamId) {
        return { success: false, error: 'Stream is required.' };
      }
      if (input.price === undefined || input.price === null) {
        return { success: false, error: 'Price is required.' };
      }
      if (input.price < 0) {
        return { success: false, error: 'Price must be 0 or greater.' };
      }

      // ── Validate UUIDs ───────────────────────────────────────────────
      validateUUID(instituteId, 'instituteId');
      validateUUID(input.streamId, 'streamId');

      // ── Validate year range ──────────────────────────────────────────
      if (input.yearFrom !== null && input.yearFrom !== undefined) {
        if (input.yearFrom < 1990 || input.yearFrom > 2100) {
          return { success: false, error: 'yearFrom must be between 1990 and 2100.' };
        }
      }
      if (input.yearTo !== null && input.yearTo !== undefined) {
        if (input.yearTo < 1990 || input.yearTo > 2100) {
          return { success: false, error: 'yearTo must be between 1990 and 2100.' };
        }
      }
      if (
        input.yearFrom !== null && input.yearFrom !== undefined &&
        input.yearTo !== null && input.yearTo !== undefined &&
        input.yearTo < input.yearFrom
      ) {
        return { success: false, error: 'yearTo must be greater than or equal to yearFrom.' };
      }

      // ── Build DB record ──────────────────────────────────────────────
      const dbRecord: Record<string, unknown> = {
        institute_id: instituteId,
        stream_id: input.streamId,
        name: input.name.trim(),
        description: input.description ?? null,
        price: input.price,
        currency: input.currency ?? 'INR',
        thumbnail_path: input.thumbnailPath ?? null,
        year_from: input.yearFrom ?? null,
        year_to: input.yearTo ?? null,
        is_active: false,
        published_at: null,
        total_papers: 0,
      };

      // ── Insert ───────────────────────────────────────────────────────
      const { data, error } = await supabase
        .from('pyq_packages')
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
            error:
              'Cannot create this package. The referenced stream or institute does not exist.',
          };
        }
        return { success: false, error: extractErrorMessage(error) };
      }

      // ── Audit: package created ─────────────────────────────────────
      await auditService.logCreate({
        resourceType: 'pyq_packages',
        resourceId: data.package_id,
        metadata: { packageId: data.package_id, name: data.name },
      });

      return { success: true, data: toPyqPackage(data) };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  4. Update
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Update an existing PYQ package.
   *
   * SUPER ADMIN ONLY — teachers cannot edit package metadata (Phase 9B
   * business rule). Only the fields provided in `input` are updated. Partial
   * updates are safe — omitted fields retain their current database values.
   *
   * @param packageId - The UUID of the package to update.
   * @param input     - The fields to update (all optional).
   */
  async updatePackage(
    packageId: string,
    input: UpdatePyqPackageInput,
  ): Promise<ApiResponse<PyqPackage>> {
    try {
      validateUUID(packageId, 'packageId');

      // ── Authorization: Super Admin only ────────────────────────────
      if (!(await isCurrentUserSuperAdmin())) {
        return {
          success: false,
          error: 'Only a Super Admin can edit PYQ packages.',
        };
      }

      // ── Build update payload (only provided fields) ──────────────────
      const dbRecord: Record<string, unknown> = {};

      if (input.name !== undefined) {
        if (!input.name.trim()) {
          return { success: false, error: 'Package name cannot be empty.' };
        }
        if (input.name.trim().length < 3) {
          return { success: false, error: 'Package name must be at least 3 characters.' };
        }
        dbRecord.name = input.name.trim();
      }

      if (input.description !== undefined) {
        dbRecord.description = input.description;
      }

      if (input.streamId !== undefined) {
        validateUUID(input.streamId, 'streamId');
        dbRecord.stream_id = input.streamId;
      }

      if (input.price !== undefined) {
        if (input.price < 0) {
          return { success: false, error: 'Price must be 0 or greater.' };
        }
        dbRecord.price = input.price;
      }

      if (input.currency !== undefined) {
        dbRecord.currency = input.currency;
      }

      if (input.thumbnailPath !== undefined) {
        dbRecord.thumbnail_path = input.thumbnailPath;
      }

      if (input.yearFrom !== undefined) {
        if (input.yearFrom !== null && (input.yearFrom < 1990 || input.yearFrom > 2100)) {
          return { success: false, error: 'yearFrom must be between 1990 and 2100.' };
        }
        dbRecord.year_from = input.yearFrom;
      }

      if (input.yearTo !== undefined) {
        if (input.yearTo !== null && (input.yearTo < 1990 || input.yearTo > 2100)) {
          return { success: false, error: 'yearTo must be between 1990 and 2100.' };
        }
        dbRecord.year_to = input.yearTo;
      }

      // Validate year range if both are provided or being updated
      if (dbRecord.year_from !== undefined && dbRecord.year_to !== undefined) {
        if (dbRecord.year_from !== null && dbRecord.year_to !== null && dbRecord.year_to < dbRecord.year_from) {
          return { success: false, error: 'yearTo must be greater than or equal to yearFrom.' };
        }
      }

      // ── If nothing to update, return current ──────────────────────────
      if (Object.keys(dbRecord).length === 0) {
        return this.getPackage(packageId);
      }

      // ── Update ───────────────────────────────────────────────────────
      const { data, error } = await supabase
        .from('pyq_packages')
        .update(dbRecord)
        .eq('package_id', packageId)
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
          return { success: false, error: `PYQ package not found: ${packageId}` };
        }
        if (error.code === '23503') {
          return {
            success: false,
            error: 'Cannot update this package. The referenced stream does not exist.',
          };
        }
        return { success: false, error: extractErrorMessage(error) };
      }

      // ── Audit: package updated ─────────────────────────────────────
      await auditService.logUpdate({
        resourceType: 'pyq_packages',
        resourceId: packageId,
        newValue: dbRecord as Record<string, unknown>,
      });

      return { success: true, data: toPyqPackage(data) };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  5. Publish
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Publish a PYQ package, making it active and available for purchase.
   *
   * SUPER ADMIN ONLY. Sets is_active = true and published_at = NOW().
   *
   * @param packageId - The UUID of the package to publish.
   */
  async publishPackage(packageId: string): Promise<ApiResponse<null>> {
    try {
      validateUUID(packageId, 'packageId');

      // ── Authorization: Super Admin only ────────────────────────────
      if (!(await isCurrentUserSuperAdmin())) {
        return { success: false, error: 'Only a Super Admin can publish PYQ packages.' };
      }

      // 1. Fetch current package to validate
      const { data: current, error: fetchErr } = await supabase
        .from('pyq_packages')
        .select('name, price, is_active, published_at')
        .eq('package_id', packageId)
        .single();

      if (fetchErr) {
        if (fetchErr.code === 'PGRST116') {
          return { success: false, error: `PYQ package not found: ${packageId}` };
        }
        return { success: false, error: extractErrorMessage(fetchErr) };
      }

      // 2. Validate publish requirements
      const validationError = validatePublishRequirements(current.name, parseFloat(current.price));
      if (validationError) {
        return { success: false, error: validationError };
      }

      // 3. If already published, no-op
      if (current.is_active && current.published_at) {
        return { success: true, data: null };
      }

      // 4. Publish
      const { error } = await supabase
        .from('pyq_packages')
        .update({
          is_active: true,
          published_at: new Date().toISOString(),
        })
        .eq('package_id', packageId);

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      // ── Audit: package published ────────────────────────────────────
      await auditService.logPublish({
        resourceType: 'pyq_packages',
        resourceId: packageId,
      });

      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  6. Unpublish
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Unpublish a PYQ package, hiding it from the store.
   *
   * SUPER ADMIN ONLY. Sets is_active = false. Preserves published_at for
   * audit trail.
   *
   * @param packageId - The UUID of the package to unpublish.
   */
  async unpublishPackage(packageId: string): Promise<ApiResponse<null>> {
    try {
      validateUUID(packageId, 'packageId');

      // ── Authorization: Super Admin only ────────────────────────────
      if (!(await isCurrentUserSuperAdmin())) {
        return { success: false, error: 'Only a Super Admin can unpublish PYQ packages.' };
      }

      // 1. Fetch current package
      const { data: current, error: fetchErr } = await supabase
        .from('pyq_packages')
        .select('is_active')
        .eq('package_id', packageId)
        .single();

      if (fetchErr) {
        if (fetchErr.code === 'PGRST116') {
          return { success: false, error: `PYQ package not found: ${packageId}` };
        }
        return { success: false, error: extractErrorMessage(fetchErr) };
      }

      // 2. If already inactive, no-op
      if (!current.is_active) {
        return { success: true, data: null };
      }

      // 3. Unpublish — keep published_at for audit trail
      const { error } = await supabase
        .from('pyq_packages')
        .update({ is_active: false })
        .eq('package_id', packageId);

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      // ── Audit: package unpublished ─────────────────────────────────
      await auditService.log({
        action: 'unpublish',
        resourceType: 'pyq_packages',
        resourceId: packageId,
      });

      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  7. Delete
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Soft-delete a PYQ package (Enterprise Soft Delete — Phase 8/9B).
   *
   * SUPER ADMIN ONLY. Only allowed when the package has no papers
   * (total_papers = 0). Returns a friendly error message if the package has
   * papers. Sets deleted_at / deleted_by / delete_reason — the row is never
   * physically deleted and can be restored from the Recycle Bin (Phase 9C).
   *
   * @param packageId - The UUID of the package to delete.
   * @param reason    - Optional reason captured for audit / delete_reason.
   */
  async deletePackage(packageId: string, reason?: string): Promise<ApiResponse<null>> {
    try {
      validateUUID(packageId, 'packageId');

      // ── Authorization: Super Admin only ────────────────────────────
      if (!(await isCurrentUserSuperAdmin())) {
        return { success: false, error: 'Only a Super Admin can delete PYQ packages.' };
      }

      // 1. Check for existing papers
      const { data: current, error: fetchErr } = await supabase
        .from('pyq_packages')
        .select('total_papers')
        .eq('package_id', packageId)
        .single();

      if (fetchErr) {
        if (fetchErr.code === 'PGRST116') {
          return { success: false, error: `PYQ package not found: ${packageId}` };
        }
        return { success: false, error: extractErrorMessage(fetchErr) };
      }

      if (current.total_papers > 0) {
        return {
          success: false,
          error: `Cannot delete this package because it contains ${current.total_papers} paper(s). Remove all papers first.`,
        };
      }

      // 2. Soft-delete (Enterprise Soft Delete — never a hard delete)
      const now = new Date().toISOString();
      const profileId = await resolveCurrentProfileId();

      const { error } = await supabase
        .from('pyq_packages')
        .update({
          deleted_at: now,
          deleted_by: profileId,
          delete_reason: reason ?? null,
        })
        .eq('package_id', packageId);

      if (error) {
        if (error.code === '23503') {
          return {
            success: false,
            error:
              'Cannot delete this package because it has dependent records (purchases, unlocks, or papers).',
          };
        }
        return { success: false, error: extractErrorMessage(error) };
      }

      // ── Audit: package soft-deleted ────────────────────────────────
      await auditService.logSoftDelete({
        resourceType: 'pyq_packages',
        resourceId: packageId,
        metadata: { deletedAt: now, deletedBy: profileId },
        reason,
      });

      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  8. Package Stats / Counts
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get PYQ package dashboard counts grouped by active/published status.
   *
   * @param instituteId - Optional institute scope.
   */
  async getPackageStats(instituteId?: string | null): Promise<ApiResponse<PyqPackageCounts>> {
    try {
      const makeQuery = (isActive: boolean) => {
        let q = supabase
          .from('pyq_packages')
          .select('package_id', { count: 'exact', head: true })
          .eq('is_active', isActive)
          .is('deleted_at', null);
        if (instituteId) {
          q = q.eq('institute_id', instituteId);
        }
        return q;
      };

      const makePublishedQuery = () => {
        let q = supabase
          .from('pyq_packages')
          .select('package_id', { count: 'exact', head: true })
          .not('published_at', 'is', null)
          .is('deleted_at', null);
        if (instituteId) {
          q = q.eq('institute_id', instituteId);
        }
        return q;
      };

      const makeUnpublishedQuery = () => {
        let q = supabase
          .from('pyq_packages')
          .select('package_id', { count: 'exact', head: true })
          .is('published_at', null)
          .is('deleted_at', null);
        if (instituteId) {
          q = q.eq('institute_id', instituteId);
        }
        return q;
      };

      const [total, active, inactive, published, unpublished] = await Promise.all([
        supabase
          .from('pyq_packages')
          .select('package_id', { count: 'exact', head: true })
          .is('deleted_at', null),
        makeQuery(true),
        makeQuery(false),
        makePublishedQuery(),
        makeUnpublishedQuery(),
      ]);

      const counts: PyqPackageCounts = {
        total: total.count ?? 0,
        active: active.count ?? 0,
        inactive: inactive.count ?? 0,
        published: published.count ?? 0,
        unpublished: unpublished.count ?? 0,
      };

      return { success: true, data: counts };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },
};
