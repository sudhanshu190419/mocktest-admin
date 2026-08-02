/**
 * PYQ Paper Service
 *
 * Single source of truth for all PYQ Paper operations in the
 * Teacher PYQ Paper Management module.
 *
 * Every public method returns a standardised `ApiResponse<T>` shape.
 * Follows the exact same architecture as `pyqPackageService.ts`.
 *
 * ## Scope
 *
 * This service manages the `pyq_papers` table only. It does NOT manage:
 * - Question mappings within a paper (see pyqQuestionMappingService — Phase 1C)
 * - Mock mappings (see pyqMockMappingService — Phase 1D)
 * - PDF file uploads (handled by storage services)
 *
 * ## Side Effects
 *
 * When a paper is created or deleted, this service updates the parent
 * package's `total_papers` count to maintain denormalised consistency.
 *
 * @module services/pyq/pyqPaperService
 */

import { supabase } from '@/config/supabase';
import { buildPagination, extractErrorMessage, validateUUID } from '@/utils/supabase';
import { buildPaginatedResponse } from '@/utils/response';
import { uploadResource } from '@/services/storage/storageService';
import { auditService } from '@/services/audit/auditService';
import {
  assertPaperOwnership,
  isCurrentUserSuperAdmin,
  resolveCurrentProfileId,
} from './pyqOwnershipGuard';
import type { ApiResponse, PaginatedResponse, PaginationParams, SortDirection } from '@/types/academic';
import type {
  PyqPaper,
  CreatePyqPaperInput,
  UpdatePyqPaperInput,
  PyqPaperFilters,
  PyqPaperSortOptions,
} from '@/types/pyq';

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

const SORT_FIELD_MAP: Record<string, string> = {
  title: 'title',
  examYear: 'exam_year',
  totalQuestions: 'total_questions',
  totalMarks: 'total_marks',
  durationMin: 'duration_min',
  isPublished: 'is_published',
  publishedAt: 'published_at',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function mapSortField(sortBy?: PyqPaperSortOptions['sortBy']): string {
  return SORT_FIELD_MAP[sortBy ?? 'examYear'] ?? 'exam_year';
}

/** Maps a raw Supabase row (pyq_papers) to PyqPaper. */
function toPyqPaper(row: any): PyqPaper {
  return {
    paperId: row.paper_id,
    packageId: row.package_id,
    instituteId: row.institute_id,
    streamId: row.stream_id,
    title: row.title,
    examYear: row.exam_year,
    examDate: row.exam_date ?? null,
    examSession: row.exam_session ?? null,
    totalQuestions: row.total_questions ?? 0,
    totalMarks: row.total_marks ?? null,
    durationMin: row.duration_min ?? null,
    pdfStorageBucket: row.pdf_storage_bucket ?? null,
    pdfStoragePath: row.pdf_storage_path ?? null,
    solutionPdfStorageBucket: row.solution_pdf_storage_bucket ?? null,
    solutionPdfStoragePath: row.solution_pdf_storage_path ?? null,
    isPublished: row.is_published ?? false,
    publishedAt: row.published_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Updates the parent package's `total_papers` count by counting published
 * papers only. This matches the planned DB trigger behaviour specified in
 * the schema docs.
 */
async function refreshPackagePaperCount(packageId: string): Promise<void> {
  try {
    const { count, error } = await supabase
      .from('pyq_papers')
      .select('paper_id', { count: 'exact', head: true })
      .eq('package_id', packageId)
      .eq('is_published', true)
      .is('deleted_at', null);

    if (error) {
      console.warn('Failed to refresh package paper count:', error.message);
      return;
    }

    await supabase
      .from('pyq_packages')
      .update({ total_papers: count ?? 0 })
      .eq('package_id', packageId);
  } catch (err) {
    console.warn('Failed to refresh package paper count:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Service
// ═══════════════════════════════════════════════════════════════════════════

export const pyqPaperService = {
  // ─────────────────────────────────────────────────────────────────────────
  //  1. Paper List
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a paginated, filtered, and sorted list of PYQ papers for a package.
   *
   * Supports search, exam year filter, published filter, pagination, and sorting.
   *
   * OWNERSHIP SCOPING: teachers only see their own papers (created_by ==
   * current profile); Super Admin sees all papers. This mirrors the Phase 9B
   * business rule and the ownership RLS planned for this phase.
   *
   * @param packageId - The parent package ID (required).
   */
  async getPapers(
    packageId: string,
    filters?: Omit<PyqPaperFilters, 'packageId'>,
    sort?: PyqPaperSortOptions,
    pagination?: PaginationParams,
  ): Promise<ApiResponse<PaginatedResponse<PyqPaper>>> {
    try {
      validateUUID(packageId, 'packageId');

      let query = supabase
        .from('pyq_papers')
        .select('*', { count: 'exact' })
        .eq('package_id', packageId)
        .is('deleted_at', null);

      // ── Ownership scoping: teachers see only their own papers ───────
      if (!(await isCurrentUserSuperAdmin())) {
        const profileId = await resolveCurrentProfileId();
        if (!profileId) {
          return { success: false, error: 'No authenticated user found.' };
        }
        query = query.eq('created_by', profileId);
      }

      // ── Filters ─────────────────────────────────────────────────────
      if (filters?.examYear) {
        query = query.eq('exam_year', filters.examYear);
      }

      if (filters?.isPublished !== undefined) {
        query = query.eq('is_published', filters.isPublished);
      }

      if (filters?.search) {
        const term = `%${filters.search}%`;
        query = query.ilike('title', term);
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

      const items = (data ?? []).map(toPyqPaper);

      return {
        success: true,
        data: buildPaginatedResponse(items, count ?? 0, page, pageSize),
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  2. Single Paper
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a single PYQ paper by its ID.
   *
   * OWNERSHIP SCOPING: teachers may only read their own papers; Super Admin
   * may read any paper. Soft-deleted papers are excluded.
   */
  async getPaper(paperId: string): Promise<ApiResponse<PyqPaper>> {
    try {
      validateUUID(paperId, 'paperId');

      const { data, error } = await supabase
        .from('pyq_papers')
        .select('*')
        .eq('paper_id', paperId)
        .is('deleted_at', null)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return { success: false, error: `PYQ paper not found: ${paperId}` };
        }
        return { success: false, error: extractErrorMessage(error) };
      }

      // ── Ownership scoping: teacher can only read their own paper ──
      if (!(await isCurrentUserSuperAdmin())) {
        const profileId = await resolveCurrentProfileId();
        if (!profileId || data.created_by !== profileId) {
          return {
            success: false,
            error:
              'You do not have permission to view this PYQ paper. Only the paper owner or a Super Admin can view it.',
          };
        }
      }

      return { success: true, data: toPyqPaper(data) };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  3. Create
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a new PYQ paper.
   *
   * Automatically populates `institute_id` and `stream_id` from the parent
   * package, and `created_by` / `updated_by` from the authenticated profile
   * (server-side — never trusted from client input). The parent package must
   * already exist (teachers cannot create packages — they create papers
   * inside Super Admin packages). Defaults: total_questions = 0,
   * is_published = false, published_at = null.
   *
   * After creation, refreshes the parent package's `total_papers` count.
   *
   * @param input - The paper creation payload.
   */
  async createPaper(input: CreatePyqPaperInput): Promise<ApiResponse<PyqPaper>> {
    try {
      // ── Resolve the authenticated creator (server-side) ────────────
      const creatorProfileId = await resolveCurrentProfileId();
      if (!creatorProfileId) {
        return { success: false, error: 'No authenticated user found.' };
      }

      // ── Resolve parent package details ──────────────────────────────
      validateUUID(input.packageId, 'packageId');

      const { data: pkg, error: pkgErr } = await supabase
        .from('pyq_packages')
        .select('institute_id, stream_id')
        .eq('package_id', input.packageId)
        .is('deleted_at', null)
        .single();

      if (pkgErr) {
        if (pkgErr.code === 'PGRST116') {
          return { success: false, error: `Parent package not found: ${input.packageId}` };
        }
        return { success: false, error: extractErrorMessage(pkgErr) };
      }

      // ── Validate required fields ─────────────────────────────────────
      if (!input.title?.trim()) {
        return { success: false, error: 'Paper title is required.' };
      }
      if (input.title.trim().length < 3) {
        return { success: false, error: 'Paper title must be at least 3 characters.' };
      }
      if (!input.examYear) {
        return { success: false, error: 'Exam year is required.' };
      }
      if (input.examYear < 1990 || input.examYear > 2100) {
        return { success: false, error: 'Exam year must be between 1990 and 2100.' };
      }

      // ── Validate total_marks ────────────────────────────────────────
      if (input.totalMarks !== null && input.totalMarks !== undefined && input.totalMarks <= 0) {
        return { success: false, error: 'Total marks must be greater than 0, or leave empty.' };
      }

      // ── Validate duration_min ────────────────────────────────────────
      if (input.durationMin !== null && input.durationMin !== undefined) {
        if (input.durationMin <= 0 || input.durationMin > 600) {
          return { success: false, error: 'Duration must be between 1 and 600 minutes.' };
        }
      }

      // ── Build DB record (without PDF storage — will populate after upload) ─
      // created_by / updated_by are stamped server-side with the authenticated
      // profile — ownership is never derived from client input.
      const dbRecord: Record<string, unknown> = {
        package_id: input.packageId,
        institute_id: pkg.institute_id,
        stream_id: pkg.stream_id,
        title: input.title.trim(),
        exam_year: input.examYear,
        exam_date: input.examDate ?? null,
        exam_session: input.examSession ?? null,
        total_questions: 0,
        total_marks: input.totalMarks ?? null,
        duration_min: input.durationMin ?? null,
        pdf_storage_bucket: null,
        pdf_storage_path: null,
        solution_pdf_storage_bucket: null,
        solution_pdf_storage_path: null,
        is_published: false,
        published_at: null,
        created_by: creatorProfileId,
        updated_by: creatorProfileId,
      };

      // ── Insert ───────────────────────────────────────────────────────
      const { data, error } = await supabase
        .from('pyq_papers')
        .insert(dbRecord)
        .select()
        .single();

      if (error) {
        if (error.code === '23503') {
          return {
            success: false,
            error:
              'Cannot create this paper. The referenced package does not exist.',
          };
        }
        if (error.code === '23505') {
          return {
            success: false,
            error:
              'A paper with this package, year, and session already exists.',
          };
        }
        return { success: false, error: extractErrorMessage(error) };
      }

      const paperId = data.paper_id;
      const instituteId = pkg.institute_id;

      // ── Audit: paper created ─────────────────────────────────────────
      // Logged immediately after the INSERT so the create event is recorded
      // even when a subsequent PDF upload fails (the row still exists).
      await auditService.logCreate({
        resourceType: 'pyq_papers',
        resourceId: paperId,
        metadata: { paperId, packageId: input.packageId, title: input.title.trim() },
      });

      // ── Upload PDFs after paper creation ────────────────────────────
      let pdfBucket: string | null = null;
      let pdfPath: string | null = null;
      let solBucket: string | null = null;
      let solPath: string | null = null;

      try {
        // Upload question paper PDF
        if (input.questionPdfFile) {
          const uploadResult = await uploadResource({
            file: input.questionPdfFile,
            resourceType: 'pyq_question_paper_pdf',
            pathParams: {
              instituteId,
              packageId: input.packageId,
              paperId,
            },
            onProgress: input.onProgress,
          });

          if (!uploadResult.success || !uploadResult.data) {
            throw new Error(`Question paper PDF upload failed: ${uploadResult.error ?? 'Upload failed.'}`);
          }

          pdfBucket = uploadResult.data.bucket;
          pdfPath = uploadResult.data.storagePath;
        }

        // Upload solution PDF
        if (input.solutionPdfFile) {
          const uploadResult = await uploadResource({
            file: input.solutionPdfFile,
            resourceType: 'pyq_solution_paper_pdf',
            pathParams: {
              instituteId,
              packageId: input.packageId,
              paperId,
            },
            onProgress: input.onProgress,
          });

          if (!uploadResult.success || !uploadResult.data) {
            throw new Error(`Solution PDF upload failed: ${uploadResult.error ?? 'Upload failed.'}`);
          }

          solBucket = uploadResult.data.bucket;
          solPath = uploadResult.data.storagePath;
        }

        // ── Update paper with storage paths ──────────────────────────────
        if (pdfBucket || solBucket) {
          const updateRecord: Record<string, unknown> = {};
          if (pdfBucket) {
            updateRecord.pdf_storage_bucket = pdfBucket;
            updateRecord.pdf_storage_path = pdfPath;
          }
          if (solBucket) {
            updateRecord.solution_pdf_storage_bucket = solBucket;
            updateRecord.solution_pdf_storage_path = solPath;
          }

          const { error: updateErr } = await supabase
            .from('pyq_papers')
            .update(updateRecord)
            .eq('paper_id', paperId);

          if (updateErr) {
            console.warn('Paper created but storage paths could not be saved:', updateErr.message);
          }
        }
      } catch (uploadErr: any) {
        // Paper was created, but uploads failed — return the paper with a warning
        console.warn('Paper created but PDF upload failed:', uploadErr.message);
        return {
          success: true,
          data: toPyqPaper({ ...data, pdf_storage_bucket: null, pdf_storage_path: null, solution_pdf_storage_bucket: null, solution_pdf_storage_path: null }),
        };
      }

      // ── Refresh parent package paper count ───────────────────────────
      await refreshPackagePaperCount(input.packageId);

      return {
        success: true,
        data: toPyqPaper({
          ...data,
          pdf_storage_bucket: pdfBucket,
          pdf_storage_path: pdfPath,
          solution_pdf_storage_bucket: solBucket,
          solution_pdf_storage_path: solPath,
        }),
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  4. Update
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Update an existing PYQ paper.
   *
   * OWNERSHIP: teachers may only edit their OWN papers (created_by ==
   * current profile); Super Admin overrides. `created_by` is NEVER
   * overwritten and `updated_by` is always stamped with the authenticated
   * profile.
   *
   * Only the fields provided in `input` are updated. Partial updates are
   * safe — omitted fields retain their current database values.
   *
   * @param paperId - The UUID of the paper to update.
   * @param input   - The fields to update (all optional).
   */
  async updatePaper(
    paperId: string,
    input: UpdatePyqPaperInput,
  ): Promise<ApiResponse<PyqPaper>> {
    try {
      validateUUID(paperId, 'paperId');

      // ── Ownership: owner or Super Admin (server-side) ──────────────
      const ownership = await assertPaperOwnership(paperId);
      if (!ownership.success || !ownership.data) {
        return { success: false, error: ownership.error ?? 'Could not verify paper ownership.' };
      }
      const actorProfileId = ownership.data.profileId;

      // ── Fetch current paper (needed for institute/package context for uploads) ─
      const { data: current, error: fetchErr } = await supabase
        .from('pyq_papers')
        .select('institute_id, package_id, pdf_storage_bucket, pdf_storage_path, solution_pdf_storage_bucket, solution_pdf_storage_path')
        .eq('paper_id', paperId)
        .is('deleted_at', null)
        .single();

      if (fetchErr) {
        if (fetchErr.code === 'PGRST116') {
          return { success: false, error: `PYQ paper not found: ${paperId}` };
        }
        return { success: false, error: extractErrorMessage(fetchErr) };
      }

      // ── Build update payload (only provided fields) ──────────────────
      const dbRecord: Record<string, unknown> = {};

      if (input.title !== undefined) {
        if (!input.title.trim()) {
          return { success: false, error: 'Paper title cannot be empty.' };
        }
        if (input.title.trim().length < 3) {
          return { success: false, error: 'Paper title must be at least 3 characters.' };
        }
        dbRecord.title = input.title.trim();
      }

      if (input.examYear !== undefined) {
        if (input.examYear < 1990 || input.examYear > 2100) {
          return { success: false, error: 'Exam year must be between 1990 and 2100.' };
        }
        dbRecord.exam_year = input.examYear;
      }

      if (input.examDate !== undefined) {
        dbRecord.exam_date = input.examDate;
      }

      if (input.examSession !== undefined) {
        dbRecord.exam_session = input.examSession;
      }

      if (input.totalMarks !== undefined) {
        if (input.totalMarks !== null && input.totalMarks <= 0) {
          return { success: false, error: 'Total marks must be greater than 0, or leave empty.' };
        }
        dbRecord.total_marks = input.totalMarks;
      }

      if (input.durationMin !== undefined) {
        if (input.durationMin !== null && (input.durationMin <= 0 || input.durationMin > 600)) {
          return { success: false, error: 'Duration must be between 1 and 600 minutes.' };
        }
        dbRecord.duration_min = input.durationMin;
      }

      // ── Handle question PDF file replacement ──────────────────────────
      if (input.questionPdfFile) {
        const uploadResult = await uploadResource({
          file: input.questionPdfFile,
          resourceType: 'pyq_question_paper_pdf',
          pathParams: {
            instituteId: current.institute_id,
            packageId: current.package_id,
            paperId,
          },
          onProgress: input.onProgress,
        });

        if (!uploadResult.success || !uploadResult.data) {
          return { success: false, error: `Question PDF upload failed: ${uploadResult.error ?? 'Upload failed.'}` };
        }

        dbRecord.pdf_storage_bucket = uploadResult.data.bucket;
        dbRecord.pdf_storage_path = uploadResult.data.storagePath;
      }

      // ── Handle solution PDF file replacement ──────────────────────────
      if (input.solutionPdfFile) {
        const uploadResult = await uploadResource({
          file: input.solutionPdfFile,
          resourceType: 'pyq_solution_paper_pdf',
          pathParams: {
            instituteId: current.institute_id,
            packageId: current.package_id,
            paperId,
          },
          onProgress: input.onProgress,
        });

        if (!uploadResult.success || !uploadResult.data) {
          return { success: false, error: `Solution PDF upload failed: ${uploadResult.error ?? 'Upload failed.'}` };
        }

        dbRecord.solution_pdf_storage_bucket = uploadResult.data.bucket;
        dbRecord.solution_pdf_storage_path = uploadResult.data.storagePath;
      }

      // ── If nothing to update, return current ──────────────────────────
      if (Object.keys(dbRecord).length === 0) {
        return this.getPaper(paperId);
      }

      // ── Always stamp the actor; NEVER touch created_by ────────────────
      if (actorProfileId) {
        dbRecord.updated_by = actorProfileId;
      }

      // ── Update ───────────────────────────────────────────────────────
      const { data, error } = await supabase
        .from('pyq_papers')
        .update(dbRecord)
        .eq('paper_id', paperId)
        .select()
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return { success: false, error: `PYQ paper not found: ${paperId}` };
        }
        if (error.code === '23505') {
          return {
            success: false,
            error:
              'A paper with this package, year, and session already exists.',
          };
        }
        return { success: false, error: extractErrorMessage(error) };
      }

      // ── Audit: paper updated ────────────────────────────────────────
      await auditService.logUpdate({
        resourceType: 'pyq_papers',
        resourceId: paperId,
        newValue: dbRecord as Record<string, unknown>,
        metadata: { paperId, packageId: current.package_id },
      });

      return { success: true, data: toPyqPaper(data) };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  5. Publish
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Publish a PYQ paper, making it visible to students who purchased the package.
   *
   * OWNERSHIP: paper owner or Super Admin only. Sets is_published = true and
   * published_at = NOW().
   *
   * @param paperId - The UUID of the paper to publish.
   */
  async publishPaper(paperId: string): Promise<ApiResponse<null>> {
    try {
      validateUUID(paperId, 'paperId');

      // ── Ownership: owner or Super Admin (server-side) ──────────────
      const ownership = await assertPaperOwnership(paperId);
      if (!ownership.success || !ownership.data) {
        return { success: false, error: ownership.error ?? 'Could not verify paper ownership.' };
      }
      const actorProfileId = ownership.data.profileId;

      // 1. Fetch current paper
      const { data: current, error: fetchErr } = await supabase
        .from('pyq_papers')
        .select('is_published, published_at')
        .eq('paper_id', paperId)
        .single();

      if (fetchErr) {
        if (fetchErr.code === 'PGRST116') {
          return { success: false, error: `PYQ paper not found: ${paperId}` };
        }
        return { success: false, error: extractErrorMessage(fetchErr) };
      }

      // 2. If already published, no-op
      if (current.is_published && current.published_at) {
        return { success: true, data: null };
      }

      // 3. Publish
      const { error } = await supabase
        .from('pyq_papers')
        .update({
          is_published: true,
          published_at: new Date().toISOString(),
          updated_by: actorProfileId,
        })
        .eq('paper_id', paperId);

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      // ── Audit: paper published ──────────────────────────────────────
      await auditService.logPublish({
        resourceType: 'pyq_papers',
        resourceId: paperId,
        metadata: { paperId },
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
   * Unpublish a PYQ paper, hiding it from students.
   *
   * OWNERSHIP: paper owner or Super Admin only. Sets is_published = false.
   * Preserves published_at for audit trail.
   *
   * @param paperId - The UUID of the paper to unpublish.
   */
  async unpublishPaper(paperId: string): Promise<ApiResponse<null>> {
    try {
      validateUUID(paperId, 'paperId');

      // ── Ownership: owner or Super Admin (server-side) ──────────────
      const ownership = await assertPaperOwnership(paperId);
      if (!ownership.success || !ownership.data) {
        return { success: false, error: ownership.error ?? 'Could not verify paper ownership.' };
      }
      const actorProfileId = ownership.data.profileId;

      // 1. Fetch current paper
      const { data: current, error: fetchErr } = await supabase
        .from('pyq_papers')
        .select('is_published')
        .eq('paper_id', paperId)
        .single();

      if (fetchErr) {
        if (fetchErr.code === 'PGRST116') {
          return { success: false, error: `PYQ paper not found: ${paperId}` };
        }
        return { success: false, error: extractErrorMessage(fetchErr) };
      }

      // 2. If already unpublished, no-op
      if (!current.is_published) {
        return { success: true, data: null };
      }

      // 3. Unpublish — keep published_at for audit trail
      const { error } = await supabase
        .from('pyq_papers')
        .update({
          is_published: false,
          updated_by: actorProfileId,
        })
        .eq('paper_id', paperId);

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      // ── Audit: paper unpublished ────────────────────────────────────
      await auditService.log({
        action: 'unpublish',
        resourceType: 'pyq_papers',
        resourceId: paperId,
        metadata: { paperId },
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
   * Soft-delete a PYQ paper (Enterprise Soft Delete — Phase 8/9B).
   *
   * OWNERSHIP: paper owner or Super Admin only. Only allowed when the paper
   * has no mapped questions (total_questions = 0). Sets deleted_at /
   * deleted_by / delete_reason — the row is never physically deleted and can
   * be restored from the Recycle Bin (Phase 9C).
   *
   * After deletion, refreshes the parent package's `total_papers` count.
   *
   * @param paperId - The UUID of the paper to delete.
   * @param reason  - Optional reason captured for audit / delete_reason.
   */
  async deletePaper(paperId: string, reason?: string): Promise<ApiResponse<null>> {
    try {
      validateUUID(paperId, 'paperId');

      // ── Ownership: owner or Super Admin (server-side) ──────────────
      const ownership = await assertPaperOwnership(paperId);
      if (!ownership.success || !ownership.data) {
        return { success: false, error: ownership.error ?? 'Could not verify paper ownership.' };
      }
      const actorProfileId = ownership.data.profileId;

      // 1. Fetch current paper to validate and get package_id
      const { data: current, error: fetchErr } = await supabase
        .from('pyq_papers')
        .select('total_questions, package_id')
        .eq('paper_id', paperId)
        .is('deleted_at', null)
        .single();

      if (fetchErr) {
        if (fetchErr.code === 'PGRST116') {
          return { success: false, error: `PYQ paper not found: ${paperId}` };
        }
        return { success: false, error: extractErrorMessage(fetchErr) };
      }

      if (current.total_questions > 0) {
        return {
          success: false,
          error: `Cannot delete this paper because it has ${current.total_questions} question(s) mapped. Remove all questions first.`,
        };
      }

      const packageId = current.package_id;

      // 2. Soft-delete (Enterprise Soft Delete — never a hard delete)
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('pyq_papers')
        .update({
          deleted_at: now,
          deleted_by: actorProfileId,
          delete_reason: reason ?? null,
        })
        .eq('paper_id', paperId);

      if (error) {
        if (error.code === '23503') {
          return {
            success: false,
            error:
              'Cannot delete this paper because it has dependent records (question mappings, solutions, or mock mappings).',
          };
        }
        return { success: false, error: extractErrorMessage(error) };
      }

      // ── Audit: paper soft-deleted ──────────────────────────────────
      await auditService.logSoftDelete({
        resourceType: 'pyq_papers',
        resourceId: paperId,
        metadata: { paperId, packageId, deletedAt: now, deletedBy: actorProfileId },
        reason,
      });

      // 3. Refresh parent package paper count
      await refreshPackagePaperCount(packageId);

      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  8. Paper Stats / Counts
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get PYQ paper counts for a given package.
   *
   * @param packageId - The parent package ID.
   */
  async getPaperStats(packageId: string): Promise<ApiResponse<{ total: number; published: number; unpublished: number }>> {
    try {
      validateUUID(packageId, 'packageId');

      const [total, published, unpublished] = await Promise.all([
        supabase
          .from('pyq_papers')
          .select('paper_id', { count: 'exact', head: true })
          .eq('package_id', packageId)
          .is('deleted_at', null),
        supabase
          .from('pyq_papers')
          .select('paper_id', { count: 'exact', head: true })
          .eq('package_id', packageId)
          .eq('is_published', true)
          .is('deleted_at', null),
        supabase
          .from('pyq_papers')
          .select('paper_id', { count: 'exact', head: true })
          .eq('package_id', packageId)
          .eq('is_published', false)
          .is('deleted_at', null),
      ]);

      return {
        success: true,
        data: {
          total: total.count ?? 0,
          published: published.count ?? 0,
          unpublished: unpublished.count ?? 0,
        },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },
};
