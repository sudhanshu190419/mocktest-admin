/**
 * Bulk Question Import Service
 *
 * Orchestrates preloading reference data, chunking, and executing atomic
 * bulk question creation via `public.bulk_import_questions_atomic` RPC.
 *
 * @module services/admin/bulkQuestionImportService
 */

import { supabase } from '@/config/supabase';
import { canApproveAcademicResources, approvalPermissionDenied } from './approvalGuard';
import { extractErrorMessage } from '@/utils/supabase';
import type { ApiResponse } from '@/types/academic';
import type {
  BulkQuestionImportRpcResult,
  QuestionImportPayloadItem,
  QuestionReferenceData,
} from '@/types/bulkQuestionImport';
import type { Chapter, Subject, Topic } from '@/types/academic';

const BATCH_CHUNK_SIZE = 250;

/**
 * Preload all reference data needed for in-memory question validation.
 */
export async function fetchQuestionReferenceData(
  instituteId: string,
): Promise<ApiResponse<QuestionReferenceData>> {
  try {
    if (!instituteId) {
      return { success: false, error: 'Institute ID is required.' };
    }

    // 1. Fetch Subjects, Chapters, Topics, and Existing Questions in parallel
    const [subjectsRes, chaptersRes, topicsRes, questionsRes] = await Promise.all([
      supabase.from('subjects').select('*'),
      supabase.from('chapters').select('*'),
      supabase.from('topics').select('*'),
      supabase
        .from('questions')
        .select('question_text')
        .eq('institute_id', instituteId)
        .is('deleted_at', null),
    ]);

    if (subjectsRes.error) return { success: false, error: extractErrorMessage(subjectsRes.error) };
    if (chaptersRes.error) return { success: false, error: extractErrorMessage(chaptersRes.error) };
    if (topicsRes.error) return { success: false, error: extractErrorMessage(topicsRes.error) };
    if (questionsRes.error) return { success: false, error: extractErrorMessage(questionsRes.error) };

    const subjects: Subject[] = (subjectsRes.data ?? []).map((s) => ({
      subjectId: s.subject_id,
      streamId: s.stream_id,
      name: s.name,
      code: s.code,
      displayOrder: s.display_order ?? 0,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
      createdBy: s.created_by ?? null,
      updatedBy: s.updated_by ?? null,
    }));

    const chapters: Chapter[] = (chaptersRes.data ?? []).map((c) => ({
      chapterId: c.chapter_id,
      subjectId: c.subject_id,
      name: c.name,
      description: c.description ?? null,
      displayOrder: c.display_order ?? 0,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      createdBy: c.created_by ?? null,
      updatedBy: c.updated_by ?? null,
    }));

    const topics: Topic[] = (topicsRes.data ?? []).map((t) => ({
      topicId: t.topic_id,
      chapterId: t.chapter_id,
      name: t.name,
      displayOrder: t.display_order ?? 0,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      createdBy: t.created_by ?? null,
      updatedBy: t.updated_by ?? null,
    }));

    const existingQuestionTexts = new Set<string>();
    for (const q of questionsRes.data ?? []) {
      if (q.question_text) {
        const norm = q.question_text
          .toLowerCase()
          .replace(/[^\w\s]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (norm) existingQuestionTexts.add(norm);
      }
    }

    return {
      success: true,
      data: {
        subjects,
        chapters,
        topics,
        existingQuestionTexts,
      },
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Execute atomic bulk import of validated questions in batches of 250.
 */
export async function importBulkQuestions(
  instituteId: string,
  payload: QuestionImportPayloadItem[],
  onProgress?: (completed: number, total: number) => void,
): Promise<ApiResponse<BulkQuestionImportRpcResult>> {
  try {
    if (!instituteId) {
      return { success: false, error: 'Institute ID is required.' };
    }

    if (!payload.length) {
      return { success: false, error: 'No valid questions to import.' };
    }

    // RBAC verification
    const isAuthorized = await canApproveAcademicResources();
    if (!isAuthorized) {
      return approvalPermissionDenied();
    }

    const totalQuestions = payload.length;
    let importedTotal = 0;
    const allCreatedIds: string[] = [];

    // Chunk into batches of BATCH_CHUNK_SIZE
    const chunks: QuestionImportPayloadItem[][] = [];
    for (let i = 0; i < totalQuestions; i += BATCH_CHUNK_SIZE) {
      chunks.push(payload.slice(i, i + BATCH_CHUNK_SIZE));
    }

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const { data, error } = await supabase.rpc('bulk_import_questions_atomic', {
        p_institute_id: instituteId,
        p_questions: chunk,
      });

      if (error) {
        return {
          success: false,
          error: `Import failed on batch ${i + 1} of ${chunks.length}: ${extractErrorMessage(error)}`,
        };
      }

      const result = data as BulkQuestionImportRpcResult;
      if (!result.success) {
        return {
          success: false,
          error: `Import failed on batch ${i + 1} of ${chunks.length}: ${result.error ?? 'Unknown error'}`,
        };
      }

      importedTotal += result.imported_count ?? chunk.length;
      if (result.question_ids) {
        allCreatedIds.push(...result.question_ids);
      }

      if (onProgress) {
        onProgress(importedTotal, totalQuestions);
      }
    }

    return {
      success: true,
      data: {
        success: true,
        imported_count: importedTotal,
        question_ids: allCreatedIds,
      },
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}
