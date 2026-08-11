/**
 * Doubt Service
 *
 * Phase 7B — the Doubt module's single Supabase interaction point.
 *
 * ## Authority
 *
 * All writes go through the migration-117 SECURITY DEFINER RPCs, which
 * derive identity from `auth.uid()` and institute scope from trusted
 * relationships — the frontend never sends `instituteId` or authorization
 * decisions. Reads use the authenticated client + RLS (student: own doubts;
 * teacher: institute-scoped via doubt_visible_to_me; admin: institute-scoped).
 *
 * The RPCs are authoritative for ownership, status transitions, teacher
 * eligibility, and attachment validation. The service only passes entity IDs
 * required by the RPC contracts and exposes the RPC result/error.
 *
 * @module services/doubtService
 */

import { supabase } from '@/config/supabase';
import { extractErrorMessage, validateUUID } from '@/utils/supabase';
import { buildPaginatedResponse } from '@/utils/response';
import { doubtErrorMessage } from '@/utils/doubtErrors';
import {
  mapAssignDoubtResult,
  mapAttachDoubtFileResult,
  mapDoubtRow,
  mapDoubtStatusResult,
  mapReplyToDoubtResult,
  mapSubmitDoubtResult,
  mergeDoubtTeacherOptions,
  type DbDoubtTeacherOptionRow,
} from '@/utils/doubtMappers';
import type {
  DbAssignDoubtResult,
  DbAttachDoubtFileResult,
  DbDoubtStatusResult,
  DbReplyToDoubtResult,
  DbStudentDoubtRow,
  DbSubmitDoubtResult,
} from '@/utils/doubtMappers';
import type { ApiResponse, PaginatedResponse, PaginationParams } from '@/types/academic';
import type {
  AcceptDoubtAnswerInput,
  ArchiveDoubtInput,
  AssignDoubtInput,
  AssignDoubtResult,
  AttachDoubtFileInput,
  AttachDoubtFileResult,
  DoubtFilters,
  DoubtListScope,
  DoubtTeacherOption,
  ReplyToDoubtInput,
  ReplyToDoubtResult,
  ReopenDoubtInput,
  ResolveDoubtInput,
  StudentDoubt,
  StudentDoubtDetail,
  SubmitDoubtInput,
  SubmitDoubtResult,
} from '@/types/doubt';

// ═══════════════════════════════════════════════════════════════════════════
//  Selects (RLS-scoped; FK-hinted embeds follow the project convention)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * List projection: doubt + subject/chapter/topic/batch/course names +
 * assigned teacher + student name/enrollment.
 *
 * NOTE: the `student` embed resolves through student_details, for which
 * migration 082 grants teachers RLS-scoped read access for students in
 * their assigned batches (via batch_subject_teachers) — so teachers receive
 * the student name + enrollment_no ONLY for their own batch students
 * (RLS-authoritative). Admins and the owning student see the name.
 */
const DOUBT_LIST_SELECT = `*,
  subject:subjects!fk_student_doubts_subject(name),
  chapter:chapters!fk_student_doubts_chapter(name),
  topic:topics!fk_student_doubts_topic(name),
  batch_subject:batch_subjects!fk_student_doubts_batch_subject(
    batch_subject_id,
    batches!fk_batch_subjects_batch(
      name,
      course_batches!fk_course_batches_batch(
        course:courses!fk_course_batches_course(title)
      )
    ),
    subjects!fk_batch_subjects_subject(name)
  ),
  assigned_teacher:teacher_details!fk_student_doubts_assigned_to(
    teacher_id,
    profile:profiles!fk_teacher_details_profile(profile_id, name)
  ),
  student:student_details!fk_student_doubts_student(
    student_id,
    enrollment_no,
    profile:profiles!fk_student_details_profile(profile_id, name)
  )`;

/**
 * Detail projection: list fields + full reply conversation (with author
 * display data) + attachments.
 */
const DOUBT_DETAIL_SELECT = `${DOUBT_LIST_SELECT},
  replies:doubt_replies!fk_doubt_replies_doubt(
    reply_id, doubt_id, author_profile_id, reply_text, image_url,
    is_accepted_answer, created_at, updated_at,
    author:profiles!fk_doubt_replies_author(profile_id, name, role),
    attachments:doubt_attachments!fk_doubt_attachments_reply(
      attachment_id, doubt_id, reply_id, uploaded_by, bucket, storage_path,
      mime_type, size_bytes, created_at
    )
  ),
  attachments:doubt_attachments!fk_doubt_attachments_doubt(
    attachment_id, doubt_id, reply_id, uploaded_by, bucket, storage_path,
    mime_type, size_bytes, created_at
  )`;

// ═══════════════════════════════════════════════════════════════════════════
//  Reads (RLS-scoped — the database decides what each role can see)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Shared list query used by all three roles. The ROLE determines the RLS
 * view the database applies — the client never filters by institute.
 *
 * @param scope      - 'student' | 'teacher' | 'admin' (drives the query key).
 * @param filters    - Optional DoubtFilters (status/subject/batch/teacher/search/date).
 * @param pagination - Optional page/pageSize (default 1 / 20).
 */
async function queryDoubts(
  scope: DoubtListScope,
  filters: DoubtFilters = {},
  pagination: PaginationParams = {},
): Promise<ApiResponse<PaginatedResponse<StudentDoubt>>> {
  try {
    const page = Math.max(1, pagination.page ?? 1);
    const pageSize = Math.max(1, pagination.pageSize ?? 20);

    let query = supabase
      .from('student_doubts')
      .select(DOUBT_LIST_SELECT, { count: 'exact' });

    if (filters.status) {
      query = query.eq('status', filters.status);
    }
    if (filters.subjectId) {
      validateUUID(filters.subjectId, 'filters.subjectId');
      query = query.eq('subject_id', filters.subjectId);
    }
    if (filters.batchSubjectId) {
      validateUUID(filters.batchSubjectId, 'filters.batchSubjectId');
      query = query.eq('batch_subject_id', filters.batchSubjectId);
    }
    if (filters.assignedTeacherId) {
      validateUUID(filters.assignedTeacherId, 'filters.assignedTeacherId');
      query = query.eq('assigned_to', filters.assignedTeacherId);
    }
    if (filters.unassigned) {
      // Teacher inbox "Unassigned" segment: routed but not yet owned.
      query = query.is('assigned_to', null);
    }
    if (filters.fromDate) {
      // Doubts created on/after fromDate (00:00 UTC).
      query = query.gte('created_at', `${filters.fromDate}T00:00:00Z`);
    }
    if (filters.toDate) {
      // Doubts created on/before toDate (23:59 UTC).
      query = query.lte('created_at', `${filters.toDate}T23:59:59Z`);
    }
    if (filters.search) {
      // pg_trgm GIN indexes (migration 117) power ILIKE '%term%'.
      // Sanitise the term so it cannot break the PostgREST or() grammar.
      const term = sanitizeSearchTerm(filters.search);
      query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%`);
    }

    query = query.order('created_at', { ascending: false });

    const from = (page - 1) * pageSize;
    query = query.range(from, from + pageSize - 1);

    const { data, error, count } = await query;

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    const items = ((data as DbStudentDoubtRow[] | null) ?? []).map(mapDoubtRow);

    return {
      success: true,
      data: buildPaginatedResponse(items, count ?? items.length, page, pageSize),
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Shared detail read: one doubt + full reply conversation + attachments.
 * RLS (doubt_visible_to_me) governs which roles can load a given doubt —
 * the same query serves the owning student, an authorized teacher, and an
 * admin of the same institute.
 *
 * @param doubtId - student_doubts.doubt_id.
 */
async function queryDoubtDetail(doubtId: string): Promise<ApiResponse<StudentDoubtDetail>> {
  try {
    validateUUID(doubtId, 'doubtId');

    const { data, error } = await supabase
      .from('student_doubts')
      .select(DOUBT_DETAIL_SELECT)
      .eq('doubt_id', doubtId)
      .single();

    if (error) {
      // Route through doubtErrorMessage so RLS-filtered reads (PGRST116 on
      // `.single()`) surface a friendly message instead of the raw PostgREST
      // "multiple (or no) rows returned" text.
      return { success: false, error: doubtErrorMessage(extractErrorMessage(error)) };
    }

    const row = data as DbStudentDoubtRow;
    const doubt = mapDoubtRow(row);

    return {
      success: true,
      data: {
        doubt,
        replies: doubt.replies ?? [],
        attachments: doubt.attachments ?? [],
      },
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ── Role-scoped public reads ────────────────────────────────────────────────

/** Student's own doubts (RLS: "Students have full access to their own doubts"). */
export async function getMyDoubts(
  filters?: DoubtFilters,
  pagination?: PaginationParams,
): Promise<ApiResponse<PaginatedResponse<StudentDoubt>>> {
  return queryDoubts('student', filters, pagination);
}

/** Teacher doubt inbox (RLS: institute-scoped + routing/specialization). */
export async function getTeacherDoubts(
  filters?: DoubtFilters,
  pagination?: PaginationParams,
): Promise<ApiResponse<PaginatedResponse<StudentDoubt>>> {
  return queryDoubts('teacher', filters, pagination);
}

/** Admin doubt management list (RLS: institute-scoped). */
export async function getAdminDoubts(
  filters?: DoubtFilters,
  pagination?: PaginationParams,
): Promise<ApiResponse<PaginatedResponse<StudentDoubt>>> {
  return queryDoubts('admin', filters, pagination);
}

/**
 * Subjects visible to the current teacher for the inbox subject filter.
 *
 * Scoped by RLS to the teacher's own batch_subject_teachers assignments
 * UNION their own teacher_specializations (migration 021 grants teachers
 * select on their own specializations; doubt_visible_to_me falls back to
 * specializations for legacy batch-less doubts, so the filter covers the
 * same visibility surface). Returns distinct subject id + name — never an
 * institute-wide subject list.
 */
export async function getTeacherDoubtSubjects(): Promise<
  ApiResponse<{ subjectId: string; name: string }[]>
> {
  try {
    const { data: teacherId, error: teacherError } = await supabase.rpc('get_my_teacher_id');
    if (teacherError || !teacherId) {
      return { success: false, error: extractErrorMessage(teacherError) };
    }

    const seen = new Map<string, string>();

    // 1. Subjects via batch_subject_teachers (current routing authority).
    const { data: assignments, error: assignError } = await supabase
      .from('batch_subject_teachers')
      .select(
        `
        batch_subject_id,
        batch_subjects!inner (
          subjects!inner (subject_id, name)
        )
      `,
      )
      .eq('teacher_id', teacherId);

    if (assignError) {
      return { success: false, error: extractErrorMessage(assignError) };
    }

    // Inner embeds return arrays (to-many PostgREST relations).
    type SubjectOptionRow = {
      batch_subjects: { subjects: { subject_id: string; name: string }[] }[];
    };
    for (const row of (assignments as unknown as SubjectOptionRow[] | null) ?? []) {
      const subject = row.batch_subjects?.[0]?.subjects?.[0];
      if (subject?.subject_id && !seen.has(subject.subject_id)) {
        seen.set(subject.subject_id, subject.name);
      }
    }

    // 2. Subjects via teacher_specializations (legacy/fallback visibility).
    const { data: specializations, error: specError } = await supabase
      .from('teacher_specializations')
      .select('subject_id, subjects!inner(name)')
      .eq('teacher_id', teacherId);

    if (specError) {
      return { success: false, error: extractErrorMessage(specError) };
    }

    type SpecializationRow = {
      subject_id: string;
      subjects: { name: string } | { name: string }[];
    };
    for (const row of (specializations as unknown as SpecializationRow[] | null) ?? []) {
      const name = Array.isArray(row.subjects) ? row.subjects[0]?.name : row.subjects?.name;
      if (row.subject_id && name && !seen.has(row.subject_id)) {
        seen.set(row.subject_id, name);
      }
    }

    return {
      success: true,
      data: Array.from(seen, ([subjectId, name]) => ({ subjectId, name })),
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/** Detail for one doubt (any authorized role). */
export async function getDoubtDetail(
  doubtId: string,
): Promise<ApiResponse<StudentDoubtDetail>> {
  return queryDoubtDetail(doubtId);
}

/**
 * Candidate teachers the admin may assign to a doubt (assign_doubt picker).
 *
 * Mirrors the RPC's eligibility check: teachers assigned to the doubt's
 * batch_subject (batch_subject_teachers) ∪ teachers with a specialization
 * matching the doubt's subject (teacher_specializations). RLS is
 * admin-institute-scoped; the assign_doubt RPC re-validates institute +
 * eligibility before writing, so this list is a UI convenience only.
 *
 * @param params - batchSubjectId (nullable) + subjectId of the doubt.
 */
export async function getDoubtAssignableTeachers(params: {
  batchSubjectId: string | null;
  subjectId: string;
}): Promise<ApiResponse<DoubtTeacherOption[]>> {
  try {
    const rows: DbDoubtTeacherOptionRow[] = [];

    // 1. Teachers assigned to the exact batch_subject (routing authority).
    if (params.batchSubjectId) {
      validateUUID(params.batchSubjectId, 'batchSubjectId');
      const { data, error } = await supabase
        .from('batch_subject_teachers')
        .select(
          `teacher_id,
           teacher:teacher_details!fk_bst_teacher(
             teacher_id,
             profile:profiles!fk_teacher_details_profile(profile_id, name, account_status)
           )`,
        )
        .eq('batch_subject_id', params.batchSubjectId);

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      // PostgREST may return to-one FK embeds as 1-element arrays — normalize
      // both shapes defensively (same pattern as getTeacherDoubtSubjects).
      type TeacherEmbedRow = {
        teacher_id: string;
        teacher: { teacher_id: string; profile: { name: string; account_status: string }[] }[];
      };
      for (const row of (data as unknown as TeacherEmbedRow[] | null) ?? []) {
        const teacher = Array.isArray(row.teacher) ? row.teacher[0] : undefined;
        const profile = teacher ? (Array.isArray(teacher.profile) ? teacher.profile[0] : undefined) : undefined;
        // Only approved teachers are assignable (assign_doubt enforces this).
        if (profile && profile.account_status !== 'approved') continue;
        rows.push({
          teacherId: teacher?.teacher_id ?? row.teacher_id,
          name: profile?.name ?? null,
          source: 'batch_subject',
        });
      }
    }

    // 2. Teachers with a specialization matching the doubt's subject
    //    (legacy/fallback eligibility — also accepted by assign_doubt).
    validateUUID(params.subjectId, 'subjectId');
    const { data: specs, error: specError } = await supabase
      .from('teacher_specializations')        .select(
          `teacher_id,
           teacher:teacher_details!fk_teacher_specializations_teacher(
             teacher_id,
             profile:profiles!fk_teacher_details_profile(profile_id, name, account_status)
           )`,
        )
        .eq('subject_id', params.subjectId);

    if (specError) {
      return { success: false, error: extractErrorMessage(specError) };
    }

    type SpecializationRow = {
      teacher_id: string;
      teacher: { teacher_id: string; profile: { name: string; account_status: string }[] }[];
    };
    for (const row of (specs as unknown as SpecializationRow[] | null) ?? []) {
      const teacher = Array.isArray(row.teacher) ? row.teacher[0] : undefined;
      const profile = teacher ? (Array.isArray(teacher.profile) ? teacher.profile[0] : undefined) : undefined;
      // Only approved teachers are assignable (assign_doubt enforces this).
      if (profile && profile.account_status !== 'approved') continue;
      rows.push({
        teacherId: teacher?.teacher_id ?? row.teacher_id,
        name: profile?.name ?? null,
        source: 'specialization',
      });
    }

    return { success: true, data: mergeDoubtTeacherOptions(rows) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Writes (migration-117 RPCs only)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Student submits a doubt (submit_student_doubt).
 *
 * @param params - subjectId + optional chapter/topic/batchSubject + title/
 *                 description + optional related resource context.
 */
export async function submitDoubt(
  params: SubmitDoubtInput,
): Promise<ApiResponse<SubmitDoubtResult>> {
  try {
    validateUUID(params.subjectId, 'subjectId');
    if (params.chapterId) validateUUID(params.chapterId, 'chapterId');
    if (params.topicId) validateUUID(params.topicId, 'topicId');
    if (params.batchSubjectId) validateUUID(params.batchSubjectId, 'batchSubjectId');
    if (params.relatedResourceId) validateUUID(params.relatedResourceId, 'relatedResourceId');

    const { data, error } = await supabase.rpc('submit_student_doubt', {
      p_subject_id: params.subjectId,
      p_chapter_id: params.chapterId ?? null,
      p_topic_id: params.topicId ?? null,
      p_batch_subject_id: params.batchSubjectId ?? null,
      p_title: params.title,
      p_description: params.description,
      p_related_resource_type: params.relatedResourceType ?? null,
      p_related_resource_id: params.relatedResourceId ?? null,
    });

    if (error) {
      return { success: false, error: doubtErrorMessage(extractErrorMessage(error)) };
    }

    return { success: true, data: mapSubmitDoubtResult(data as DbSubmitDoubtResult) };
  } catch (err) {
    return { success: false, error: doubtErrorMessage(extractErrorMessage(err)) };
  }
}

/**
 * Reply to a doubt — student follow-up, teacher answer, or admin reply
 * (reply_to_doubt). The RPC derives the author role and drives status +
 * notifications.
 *
 * @param params - doubtId + replyText + optional imageUrl.
 */
export async function replyToDoubt(
  params: ReplyToDoubtInput,
): Promise<ApiResponse<ReplyToDoubtResult>> {
  try {
    validateUUID(params.doubtId, 'doubtId');

    const { data, error } = await supabase.rpc('reply_to_doubt', {
      p_doubt_id: params.doubtId,
      p_reply_text: params.replyText,
      p_image_url: params.imageUrl ?? null,
    });

    if (error) {
      return { success: false, error: doubtErrorMessage(extractErrorMessage(error)) };
    }

    return { success: true, data: mapReplyToDoubtResult(data as DbReplyToDoubtResult) };
  } catch (err) {
    return { success: false, error: doubtErrorMessage(extractErrorMessage(err)) };
  }
}

/**
 * Student accepts a teacher/admin reply as the solution
 * (accept_doubt_answer). Resolves the doubt via the auto-resolve trigger.
 *
 * @param params - doubtId + replyId.
 */
export async function acceptDoubtAnswer(
  params: AcceptDoubtAnswerInput,
): Promise<ApiResponse<{ success: boolean; status: string }>> {
  try {
    validateUUID(params.doubtId, 'doubtId');
    validateUUID(params.replyId, 'replyId');

    const { data, error } = await supabase.rpc('accept_doubt_answer', {
      p_doubt_id: params.doubtId,
      p_reply_id: params.replyId,
    });

    if (error) {
      return { success: false, error: doubtErrorMessage(extractErrorMessage(error)) };
    }

    return { success: true, data: mapDoubtStatusResult(data as DbDoubtStatusResult) };
  } catch (err) {
    return { success: false, error: doubtErrorMessage(extractErrorMessage(err)) };
  }
}

/**
 * Resolve a doubt directly (resolve_doubt) — student owner, authorized
 * teacher, or admin. No accepted answer required.
 *
 * @param params - doubtId.
 */
export async function resolveDoubt(
  params: ResolveDoubtInput,
): Promise<ApiResponse<{ success: boolean; status: string }>> {
  try {
    validateUUID(params.doubtId, 'doubtId');

    const { data, error } = await supabase.rpc('resolve_doubt', {
      p_doubt_id: params.doubtId,
    });

    if (error) {
      return { success: false, error: doubtErrorMessage(extractErrorMessage(error)) };
    }

    return { success: true, data: mapDoubtStatusResult(data as DbDoubtStatusResult) };
  } catch (err) {
    return { success: false, error: doubtErrorMessage(extractErrorMessage(err)) };
  }
}

/**
 * Reopen a resolved doubt (reopen_doubt) — student owner (capped at 3) or
 * admin.
 *
 * @param params - doubtId.
 */
export async function reopenDoubt(
  params: ReopenDoubtInput,
): Promise<ApiResponse<{ success: boolean; status: string }>> {
  try {
    validateUUID(params.doubtId, 'doubtId');

    const { data, error } = await supabase.rpc('reopen_doubt', {
      p_doubt_id: params.doubtId,
    });

    if (error) {
      return { success: false, error: doubtErrorMessage(extractErrorMessage(error)) };
    }

    return { success: true, data: mapDoubtStatusResult(data as DbDoubtStatusResult) };
  } catch (err) {
    return { success: false, error: doubtErrorMessage(extractErrorMessage(err)) };
  }
}

/**
 * Academic admin assigns (or reassigns) a teacher to a doubt (assign_doubt).
 *
 * @param params - doubtId + teacherId.
 */
export async function assignDoubt(
  params: AssignDoubtInput,
): Promise<ApiResponse<AssignDoubtResult>> {
  try {
    validateUUID(params.doubtId, 'doubtId');
    validateUUID(params.teacherId, 'teacherId');

    const { data, error } = await supabase.rpc('assign_doubt', {
      p_doubt_id: params.doubtId,
      p_teacher_id: params.teacherId,
    });

    if (error) {
      return { success: false, error: doubtErrorMessage(extractErrorMessage(error)) };
    }

    return { success: true, data: mapAssignDoubtResult(data as DbAssignDoubtResult) };
  } catch (err) {
    return { success: false, error: doubtErrorMessage(extractErrorMessage(err)) };
  }
}

/**
 * Academic admin archives a doubt (archive_doubt) — terminal state.
 *
 * @param params - doubtId.
 */
export async function archiveDoubt(
  params: ArchiveDoubtInput,
): Promise<ApiResponse<{ success: boolean; status: string }>> {
  try {
    validateUUID(params.doubtId, 'doubtId');

    const { data, error } = await supabase.rpc('archive_doubt', {
      p_doubt_id: params.doubtId,
    });

    if (error) {
      return { success: false, error: doubtErrorMessage(extractErrorMessage(error)) };
    }

    return { success: true, data: mapDoubtStatusResult(data as DbDoubtStatusResult) };
  } catch (err) {
    return { success: false, error: doubtErrorMessage(extractErrorMessage(err)) };
  }
}

/**
 * Records an attachment (attach_doubt_file) AFTER the file has been
 * uploaded to the doubt-attachments bucket. See doubtAttachmentService for
 * the combined upload → attach flow.
 *
 * @param params - doubtId + storagePath + mimeType + sizeBytes + optional replyId.
 */
export async function attachDoubtFile(
  params: AttachDoubtFileInput,
): Promise<ApiResponse<AttachDoubtFileResult>> {
  try {
    validateUUID(params.doubtId, 'doubtId');
    if (params.replyId) validateUUID(params.replyId, 'replyId');

    const { data, error } = await supabase.rpc('attach_doubt_file', {
      p_doubt_id: params.doubtId,
      p_storage_path: params.storagePath,
      p_mime_type: params.mimeType,
      p_size_bytes: params.sizeBytes,
      p_reply_id: params.replyId ?? null,
    });

    if (error) {
      return { success: false, error: doubtErrorMessage(extractErrorMessage(error)) };
    }

    return { success: true, data: mapAttachDoubtFileResult(data as DbAttachDoubtFileResult) };
  } catch (err) {
    return { success: false, error: doubtErrorMessage(extractErrorMessage(err)) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sanitise a search term for the PostgREST `or()` grammar. Commas separate
 * conditions and `%` is the ILIKE wildcard — both must not be user-injectable.
 * Replaces them with spaces (pg_trgm GIN still matches multi-word phrases).
 */
function sanitizeSearchTerm(term: string): string {
  return term.trim().replace(/[,%]/g, ' ').replace(/\s+/g, ' ').slice(0, 120);
}

/** Service object (matches the `xxxService` convention). */
export const doubtService = {
  getMyDoubts,
  getTeacherDoubts,
  getAdminDoubts,
  getTeacherDoubtSubjects,
  getDoubtAssignableTeachers,
  getDoubtDetail,
  submitDoubt,
  replyToDoubt,
  acceptDoubtAnswer,
  resolveDoubt,
  reopenDoubt,
  assignDoubt,
  archiveDoubt,
  attachDoubtFile,
};
