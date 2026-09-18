/**
 * Student Doubt Academic Service
 *
 * Provides batch-scoped academic context for the Student Web Ask Doubt flow.
 * Aligned with migration 117/118 authority:
 *   student -> active batch (batch_students.status = 'active')
 *           -> batch_subjects (is_active = true)
 *           -> subjects -> chapters -> topics
 *
 * Students only see academic items within their enrolled active batches.
 *
 * @module services/student/studentDoubtAcademicService
 */

import { supabase } from '@/config/supabase';
import { extractErrorMessage, validateUUID } from '@/utils/supabase';
import { resolveCurrentStudentId } from '@/services/student/studentCourseWebService';
import { getChapters } from '@/services/academic/chapterService';
import { getTopics } from '@/services/academic/topicService';
import { doubtErrorMessage } from '@/utils/doubtErrors';
import type { ApiResponse, Chapter, Topic } from '@/types/academic';
import type { DoubtResourceType, SubmitDoubtInput } from '@/types/doubt';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface StudentBatchSubject {
  batchSubjectId: string;
  batchId: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
}

export interface StudentBatchContext {
  batchId: string;
  batchName: string;
  courseId: string | null;
  courseName: string | null;
  subjects: StudentBatchSubject[];
}

export interface DoubtAcademicSelection {
  batchId: string | null;
  subjectId: string | null;
  chapterId: string | null;
  topicId: string | null;
}

export interface ContextualDoubtParams {
  batchId?: string | null;
  subjectId?: string | null;
  chapterId?: string | null;
  topicId?: string | null;
  batchSubjectId?: string | null;
  relatedResourceType?: DoubtResourceType | null;
  relatedResourceId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  subjectName?: string | null;
  chapterName?: string | null;
  topicName?: string | null;
  prefillTitle?: string | null;
  title?: string | null;
}

// ─── Resource Normalization & Display ───────────────────────────────────────

/**
 * Normalizes frontend / domain resource types to the Postgres
 * resource_category_type enum accepted by submit_student_doubt RPC:
 *   - 'recorded_class' -> 'live_class'
 *   - 'study_material' -> 'content'
 */
export function normalizeDoubtResourceType(
  type?: string | null,
): DoubtResourceType | null {
  if (!type) return null;
  if (type === 'recorded_class') return 'live_class';
  if (type === 'study_material') return 'content';
  if (type === 'test') return 'mock_test';
  if (['content', 'question', 'live_class', 'pyq_paper', 'mock_test', 'teacher'].includes(type)) {
    return type as DoubtResourceType;
  }
  return null;
}

/**
 * Returns human-readable label and icon category for a resource type.
 */
export function getDoubtResourceDisplay(
  type?: string | null,
): { label: string; icon: 'video' | 'book' | 'question' | 'award' | 'content' } {
  switch (type) {
    case 'recorded_class':
      return { label: 'Recorded Class', icon: 'video' };
    case 'live_class':
      return { label: 'Live Class', icon: 'video' };
    case 'question':
      return { label: 'Question Review', icon: 'question' };
    case 'test':
    case 'mock_test':
      return { label: 'Mock Test', icon: 'award' };
    case 'study_material':
    case 'content':
      return { label: 'Course Material', icon: 'content' };
    case 'pyq_paper':
      return { label: 'PYQ Paper', icon: 'book' };
    default:
      return { label: 'Linked Resource', icon: 'question' };
  }
}

/**
 * Generates a clean URL for opening /student/doubts with contextual params.
 */
export function createContextQueryUrl(params: ContextualDoubtParams): string {
  const q = new URLSearchParams();
  q.set('new', 'true');

  if (params.batchId) q.set('batchId', params.batchId);
  if (params.subjectId) q.set('subjectId', params.subjectId);
  if (params.chapterId) q.set('chapterId', params.chapterId);
  if (params.topicId) q.set('topicId', params.topicId);
  if (params.batchSubjectId) q.set('batchSubjectId', params.batchSubjectId);
  if (params.subjectName) q.set('subjectName', params.subjectName);

  const rawResType = (params.relatedResourceType || params.resourceType) as DoubtResourceType | null | undefined;
  const normalizedResType = normalizeDoubtResourceType(rawResType);
  if (normalizedResType) q.set('resourceType', normalizedResType);

  const resId = params.relatedResourceId || params.resourceId;
  if (resId) q.set('resourceId', resId);

  const titleText = params.prefillTitle || params.title;
  if (titleText) q.set('title', titleText);

  return `/student/doubts?${q.toString()}`;
}

// ─── Pure Selection Helpers ──────────────────────────────────────────────────

export function createEmptySelection(): DoubtAcademicSelection {
  return {
    batchId: null,
    subjectId: null,
    chapterId: null,
    topicId: null,
  };
}

export function selectBatch(
  selection: DoubtAcademicSelection,
  batchId: string | null,
): DoubtAcademicSelection {
  return {
    batchId,
    subjectId: null,
    chapterId: null,
    topicId: null,
  };
}

export function selectSubject(
  selection: DoubtAcademicSelection,
  subjectId: string | null,
): DoubtAcademicSelection {
  return {
    ...selection,
    subjectId,
    chapterId: null,
    topicId: null,
  };
}

export function selectChapter(
  selection: DoubtAcademicSelection,
  chapterId: string | null,
): DoubtAcademicSelection {
  return {
    ...selection,
    chapterId,
    topicId: null,
  };
}

export function selectTopic(
  selection: DoubtAcademicSelection,
  topicId: string | null,
): DoubtAcademicSelection {
  return {
    ...selection,
    topicId,
  };
}

/** Subjects available for a specific batch. */
export function subjectsForBatch(
  contexts: StudentBatchContext[],
  batchId: string | null,
): StudentBatchSubject[] {
  if (!batchId) {
    if (contexts.length === 1) return contexts[0].subjects;
    return [];
  }
  const match = contexts.find((c) => c.batchId === batchId);
  return match ? match.subjects : [];
}

/** True when the student is enrolled in more than one active batch. */
export function needsBatchSelector(contexts: StudentBatchContext[]): boolean {
  return contexts.length > 1;
}

/** Resolve the exact batch_subject_id for the current selection. */
export function resolveBatchSubjectId(
  contexts: StudentBatchContext[],
  selection: DoubtAcademicSelection,
): string | null {
  const subjects = subjectsForBatch(contexts, selection.batchId);
  const match = subjects.find((s) => s.subjectId === selection.subjectId);
  return match ? match.batchSubjectId : null;
}

/** Display label for Course / Batch picker options. */
export function batchOptionLabel(context: StudentBatchContext): string {
  return context.courseName
    ? `${context.courseName} • ${context.batchName}`
    : context.batchName;
}

/**
 * Pre-selects academic context based on contextual parameters safely.
 */
export function preselectAcademicContext(
  contexts: StudentBatchContext[],
  currentSelection: DoubtAcademicSelection,
  params?: ContextualDoubtParams | null,
): DoubtAcademicSelection {
  if (contexts.length === 0) {
    return currentSelection;
  }

  // 1. If batchSubjectId is provided, find its batch and subject
  if (params?.batchSubjectId) {
    for (const ctx of contexts) {
      const matched = ctx.subjects.find((s) => s.batchSubjectId === params.batchSubjectId);
      if (matched) {
        return {
          batchId: ctx.batchId,
          subjectId: matched.subjectId,
          chapterId: params.chapterId || null,
          topicId: params.topicId || null,
        };
      }
    }
  }

  // 2. If subjectId and batchId are provided
  if (params?.subjectId && params?.batchId) {
    const ctx = contexts.find((c) => c.batchId === params.batchId);
    if (ctx) {
      const hasSubject = ctx.subjects.some((s) => s.subjectId === params.subjectId);
      if (hasSubject) {
        return {
          batchId: ctx.batchId,
          subjectId: params.subjectId,
          chapterId: params.chapterId || null,
          topicId: params.topicId || null,
        };
      }
    }
  }

  // 3. If subjectName and batchId are provided (name match within batch)
  if (params?.subjectName && params?.batchId) {
    const ctx = contexts.find((c) => c.batchId === params.batchId);
    if (ctx) {
      const targetName = params.subjectName.trim().toLowerCase();
      const matchedSubject = ctx.subjects.find(
        (s) => s.subjectName.toLowerCase() === targetName || s.subjectCode.toLowerCase() === targetName,
      );
      if (matchedSubject) {
        return {
          batchId: ctx.batchId,
          subjectId: matchedSubject.subjectId,
          chapterId: params.chapterId || null,
          topicId: params.topicId || null,
        };
      }
    }
  }

  // 4. If subjectId only is provided
  if (params?.subjectId) {
    for (const ctx of contexts) {
      const hasSubject = ctx.subjects.some((s) => s.subjectId === params.subjectId);
      if (hasSubject) {
        return {
          batchId: ctx.batchId,
          subjectId: params.subjectId,
          chapterId: params.chapterId || null,
          topicId: params.topicId || null,
        };
      }
    }
  }

  // 5. If subjectName only is provided (match across any enrolled batch)
  if (params?.subjectName) {
    const targetName = params.subjectName.trim().toLowerCase();
    for (const ctx of contexts) {
      const matchedSubject = ctx.subjects.find(
        (s) => s.subjectName.toLowerCase() === targetName || s.subjectCode.toLowerCase() === targetName,
      );
      if (matchedSubject) {
        return {
          batchId: ctx.batchId,
          subjectId: matchedSubject.subjectId,
          chapterId: params.chapterId || null,
          topicId: params.topicId || null,
        };
      }
    }
  }

  // 6. If batchId only is provided
  if (params?.batchId) {
    const ctx = contexts.find((c) => c.batchId === params.batchId);
    if (ctx) {
      return selectBatch(currentSelection, ctx.batchId);
    }
  }

  // 7. Fallback: single active batch auto-selection
  if (contexts.length === 1 && !currentSelection.batchId) {
    return selectBatch(currentSelection, contexts[0].batchId);
  }

  return currentSelection;
}

/** Builds the canonical SubmitDoubtInput for submit_student_doubt RPC. */
export function buildSubmitDoubtInput(
  contexts: StudentBatchContext[],
  selection: DoubtAcademicSelection,
  payload: {
    title: string;
    description: string;
    relatedResourceType?: DoubtResourceType | null;
    relatedResourceId?: string | null;
  },
): SubmitDoubtInput {
  return {
    subjectId: selection.subjectId ?? '',
    chapterId: selection.chapterId || null,
    topicId: selection.topicId || null,
    batchSubjectId: resolveBatchSubjectId(contexts, selection),
    title: payload.title.trim(),
    description: payload.description.trim(),
    relatedResourceType: normalizeDoubtResourceType(payload.relatedResourceType),
    relatedResourceId: payload.relatedResourceId || null,
  };
}

// ─── Data Fetchers ───────────────────────────────────────────────────────────

/**
 * Fetch the authenticated student's batch-scoped academic contexts.
 */
export async function getStudentBatchContexts(): Promise<ApiResponse<StudentBatchContext[]>> {
  try {
    const studentId = await resolveCurrentStudentId();
    if (!studentId) {
      return { success: false, error: 'No student profile was found for this account.' };
    }

    // 1. Get active student batches
    const { data: batchRows, error: batchError } = await supabase
      .from('batch_students')
      .select('batch_id, batches!inner(name)')
      .eq('student_id', studentId)
      .eq('status', 'active');

    if (batchError) {
      return { success: false, error: extractErrorMessage(batchError) };
    }

    const rawBatches = (batchRows ?? []) as unknown as Array<{
      batch_id: string;
      batches: { name: string } | null;
    }>;

    const batchIds = [...new Set(rawBatches.map((r) => r.batch_id))];
    if (batchIds.length === 0) {
      return { success: true, data: [] };
    }

    // 2. Active batch_subjects for those batches
    const { data: subjectRows, error: subjectError } = await supabase
      .from('batch_subjects')
      .select(
        `
        batch_subject_id,
        batch_id,
        subject_id,
        name,
        subjects!inner(name, code)
      `,
      )
      .in('batch_id', batchIds)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (subjectError) {
      return { success: false, error: extractErrorMessage(subjectError) };
    }

    const rawSubjects = (subjectRows ?? []) as unknown as Array<{
      batch_subject_id: string;
      batch_id: string;
      subject_id: string;
      name: string | null;
      subjects: { name: string; code: string } | null;
    }>;

    // 3. Best-effort course mapping
    const courseByBatch = new Map<string, { courseId: string; courseName: string | null }>();
    try {
      const { data: courseRows } = await supabase
        .from('course_batches')
        .select('batch_id, course_id, courses!inner(title)')
        .in('batch_id', batchIds);

      for (const row of (courseRows ?? []) as unknown as Array<{
        batch_id: string;
        course_id: string;
        courses: { title: string } | null;
      }>) {
        if (!courseByBatch.has(row.batch_id)) {
          courseByBatch.set(row.batch_id, {
            courseId: row.course_id,
            courseName: row.courses?.title ?? null,
          });
        }
      }
    } catch {
      // Non-fatal
    }

    // 4. Assemble contexts
    const contexts: StudentBatchContext[] = batchIds.map((batchId) => {
      const batch = rawBatches.find((r) => r.batch_id === batchId)?.batches;
      const course = courseByBatch.get(batchId);
      return {
        batchId,
        batchName: batch?.name ?? 'Batch',
        courseId: course?.courseId ?? null,
        courseName: course?.courseName ?? null,
        subjects: rawSubjects
          .filter((r) => r.batch_id === batchId)
          .map((r) => ({
            batchSubjectId: r.batch_subject_id,
            batchId: r.batch_id,
            subjectId: r.subject_id,
            subjectName: r.name ?? r.subjects?.name ?? 'Subject',
            subjectCode: r.subjects?.code ?? '',
          })),
      };
    });

    return { success: true, data: contexts };
  } catch (err) {
    return { success: false, error: doubtErrorMessage(extractErrorMessage(err)) };
  }
}

/**
 * Fetch chapters for a given subject.
 */
export async function fetchChaptersForSubject(
  subjectId: string,
): Promise<ApiResponse<Chapter[]>> {
  try {
    validateUUID(subjectId, 'subjectId');
    const result = await getChapters(
      { subjectId },
      { sortBy: 'displayOrder', sortDirection: 'asc' },
      { page: 1, pageSize: 200 },
    );
    if (!result.success || !result.data) {
      return { success: false, error: result.error ?? 'Failed to load chapters.' };
    }
    return { success: true, data: result.data.data };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Fetch topics for a given chapter.
 */
export async function fetchTopicsForChapter(
  chapterId: string,
): Promise<ApiResponse<Topic[]>> {
  try {
    validateUUID(chapterId, 'chapterId');
    const result = await getTopics(
      { chapterId },
      { sortBy: 'displayOrder', sortDirection: 'asc' },
      { page: 1, pageSize: 200 },
    );
    if (!result.success || !result.data) {
      return { success: false, error: result.error ?? 'Failed to load topics.' };
    }
    return { success: true, data: result.data.data };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

export const studentDoubtAcademicService = {
  getStudentBatchContexts,
  fetchChaptersForSubject,
  fetchTopicsForChapter,
  createEmptySelection,
  selectBatch,
  selectSubject,
  selectChapter,
  selectTopic,
  subjectsForBatch,
  needsBatchSelector,
  resolveBatchSubjectId,
  batchOptionLabel,
  preselectAcademicContext,
  buildSubmitDoubtInput,
  normalizeDoubtResourceType,
  getDoubtResourceDisplay,
  createContextQueryUrl,
};
