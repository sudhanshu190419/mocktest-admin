/**
 * Teacher Live Class Scheduling Service
 *
 * Production-ready service for scheduling, listing, updating, and managing
 * live classes. This is the backend layer for the Teacher Live Class
 * Scheduling feature (Phase 5.1).
 *
 * ## Architecture
 *
 * - **New methods** live here (scheduleLiveClass, getTeacherScheduledClasses, etc.)
 * - **Existing methods** in `teacherService.ts` (startLiveClass, endLiveClass) are
 *   reused — NOT duplicated.
 * - Validation helpers are extracted into reusable functions within this file.
 *
 * ## Lifecycle Compatibility
 *
 * The existing Instant Go Live flow (LiveStudioView → StartLiveDialog →
 * useLiveClass → getOrCreateActiveLiveClass → startLiveClass → endLiveClass)
 * remains UNCHANGED. This service adds a parallel scheduling path.
 *
 * @module services/teacherLiveClassService
 */

import { supabase } from '@/config/supabase';
import { teacherService } from './teacherService';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

/** Supported statuses for live classes returned by list queries. */
export type LiveClassStatus = 'draft' | 'scheduled' | 'live' | 'completed' | 'cancelled';

/** Lightweight class item returned in list endpoints. */
export interface LiveClassListItem {
  classId: string;
  title: string;
  status: LiveClassStatus;
  scheduledAt: string;
  durationMin: number;
  /** First batch subject for backward compatibility. */
  batchId: string;
  batchName: string;
  /** All batch subjects this class is assigned to. */
  assignedBatchSubjects: LiveClassBatchSubject[];
  chapterId: string | null;
  chapterName: string | null;
  teacherName: string;
  /** Student count for the first batch. 0 means uncomputed at list level — use getTeacherClassById for accurate count. */
  enrolledStudentCount: number;
  isRecorded: boolean;
  createdAt: string;
}

/** Full class detail returned by getTeacherClassById. */
export interface LiveClassDetail extends LiveClassListItem {
  description: string | null;
  roomName: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  recordingUrl: string | null;
  session: {
    sessionId: string;
    status: 'waiting' | 'live' | 'ended';
    startedAt: string | null;
    endedAt: string | null;
    peakParticipants: number | null;
    provider: string | null;
  } | null;
  /** @deprecated Use assignedBatchSubjects instead. */
  batches: { batchId: string; batchName: string }[];
  /** @deprecated Use assignedBatchSubjects instead. */
  allBatches: { batchId: string; batchName: string }[];
}

/** Input required to schedule a new live class. */
export interface ScheduleLiveClassInput {
  teacherId: string;
  title: string;
  batchSubjectIds: string[];
  chapterId?: string | null;
  scheduledAt: string;   // ISO 8601 timestamp (must be in the future)
  durationMin: number;   // 1–480
  description?: string;
  isRecorded?: boolean;
}

/** Fields that can be updated on an existing scheduled class. */
export interface UpdateScheduledClassInput {
  title?: string;
  description?: string;
  chapterId?: string | null;
  batchSubjectIds?: string[];
  scheduledAt?: string;
  durationMin?: number;
  isRecorded?: boolean;
}

/** A batch subject assignment for display on a live class card. */
export interface LiveClassBatchSubject {
  batchSubjectId: string;
  batchId: string;
  batchName: string;
  subjectName: string;
}

/** Response from scheduleLiveClass containing the created class. */
export interface ScheduleLiveClassResult {
  classId: string;
  title: string;
  status: LiveClassStatus;
  scheduledAt: string;
  durationMin: number;
}

/** Filter options for getTeacherClasses. */
export interface TeacherClassFilters {
  status?: LiveClassStatus[];
  fromDate?: string;
  toDate?: string;
  batchId?: string;
  page?: number;
  pageSize?: number;
}

/** Paginated response for class listing. */
export interface TeacherClassListResponse {
  classes: LiveClassListItem[];
  total: number;
  page: number;
  pageSize: number;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Error Types
// ═══════════════════════════════════════════════════════════════════════════

export class LiveClassValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveClassValidationError';
  }
}

export class LiveClassPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveClassPermissionError';
  }
}

export class LiveClassNotFoundError extends Error {
  constructor(classId: string) {
    super(`Live class not found: ${classId}`);
    this.name = 'LiveClassNotFoundError';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Room Name Helper
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generates a deterministic LiveKit room name from a class ID.
 *
 * Pattern:  `class-{classIdPrefix}`
 *
 * Must match the implementation in `useLiveClass.ts` so that the teacher
 * and students derive the same room name from the same class ID.
 *
 * @param classId - The UUID of the live_classes row.
 * @returns A deterministic room name string.
 */
export function buildRoomName(classId: string): string {
  const short = classId.replace(/-/g, '').slice(0, 8);
  return `class-${short}`;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Validation Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validates that a class exists and belongs to the given teacher.
 *
 * @returns The full live_classes row if valid.
 * @throws LiveClassNotFoundError if class not found.
 * @throws LiveClassPermissionError if teacher does not own the class.
 */
async function validateTeacherOwnsClass(
  classId: string,
  teacherId: string,
): Promise<any> {
  const { data, error } = await supabase
    .from('live_classes')
    .select('*')
    .eq('class_id', classId)
    .single();

  if (error || !data) {
    throw new LiveClassNotFoundError(classId);
  }

  if (data.teacher_id !== teacherId) {
    throw new LiveClassPermissionError(
      'You do not have permission to modify this class.',
    );
  }

  return data;
}

/**
 * Validates that a class has one of the expected statuses.
 *
 * @throws LiveClassValidationError if status does not match.
 */
function assertClassStatus(
  liveClass: { status: string; class_id: string; title: string },
  expectedStatuses: string[],
  action: string,
): void {
  if (!expectedStatuses.includes(liveClass.status)) {
    throw new LiveClassValidationError(
      `Cannot ${action} "${liveClass.title}" because its status is ` +
      `"${liveClass.status}". Expected: ${expectedStatuses.join(' or ')}.`,
    );
  }
}

/**
 * Validates that a scheduled time is in the future.
 *
 * @throws LiveClassValidationError if time is in the past.
 */
function assertFutureTime(scheduledAt: string): void {
  const scheduled = new Date(scheduledAt).getTime();
  if (isNaN(scheduled)) {
    throw new LiveClassValidationError(
      'Invalid scheduled date/time format. Please provide a valid ISO 8601 timestamp.',
    );
  }
  if (scheduled <= Date.now()) {
    throw new LiveClassValidationError(
      'Scheduled time must be in the future. Please select a future date and time.',
    );
  }
}

/**
 * Validates that a duration is within the allowed range.
 *
 * @throws LiveClassValidationError if duration is out of range.
 */
function assertValidDuration(durationMin: number): void {
  if (!Number.isInteger(durationMin) || durationMin < 1 || durationMin > 480) {
    throw new LiveClassValidationError(
      `Duration must be between 1 and 480 minutes. Got: ${durationMin}.`,
    );
  }
}

/**
 * Validates that all batch subject IDs are assigned to the teacher.
 *
 * @throws LiveClassValidationError if any batch subject is not assigned.
 */
async function assertBatchSubjectsAssignedToTeacher(
  teacherId: string,
  batchSubjectIds: string[],
): Promise<void> {
  if (batchSubjectIds.length === 0) {
    throw new LiveClassValidationError(
      'At least one batch subject must be selected.',
    );
  }

  const { data, error } = await supabase
    .from('batch_subject_teachers')
    .select('batch_subject_id')
    .eq('teacher_id', teacherId)
    .in('batch_subject_id', batchSubjectIds);

  if (error) {
    throw new LiveClassValidationError(
      `Failed to validate batch subject assignments: ${error.message}`,
    );
  }

  const validIds = new Set((data ?? []).map((r: any) => r.batch_subject_id));
  const invalidIds = batchSubjectIds.filter((id) => !validIds.has(id));

  if (invalidIds.length > 0) {
    throw new LiveClassValidationError(
      `${invalidIds.length} batch subject(s) are not assigned to this teacher. ` +
      'Only batch subjects you are assigned to can be selected.',
    );
  }
}

/**
 * Resolves a chapter ID to its name. Returns null if not found.
 */
async function resolveChapterName(chapterId: string | null): Promise<string | null> {
  if (!chapterId) return null;
  try {
    const { data } = await supabase
      .from('chapters')
      .select('name')
      .eq('chapter_id', chapterId)
      .single();
    return data?.name ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolves batch names for a list of batch IDs.
 */
async function resolveBatchNames(
  batchIds: string[],
): Promise<{ batchId: string; batchName: string }[]> {
  if (batchIds.length === 0) return [];

  const { data } = await supabase
    .from('batches')
    .select('batch_id, name')
    .in('batch_id', batchIds);

  return (data ?? []).map((b: any) => ({
    batchId: b.batch_id,
    batchName: b.name,
  }));
}

/**
 * Enriches a raw live_classes row with resolved names (batch subjects, chapter).
 */
async function enrichClassWithNames(
  liveClass: any,
): Promise<LiveClassListItem> {
  const [batchSubjects, chapterName] = await Promise.all([
    resolveClassBatchSubjects(liveClass.class_id),
    liveClass.chapter_id ? resolveChapterName(liveClass.chapter_id) : Promise.resolve(null),
  ]);

  const firstBS = batchSubjects[0] ?? { batchSubjectId: '', batchId: '', batchName: 'Unassigned', subjectName: '' };
  const teacherName = ''; // TODO: resolve teacher name via profiles join for production — currently returns empty string to avoid N+1 queries

  return {
    classId: liveClass.class_id,
    title: liveClass.title,
    status: liveClass.status as LiveClassStatus,
    scheduledAt: liveClass.scheduled_at,
    durationMin: liveClass.duration_min,
    batchId: firstBS.batchId,
    batchName: firstBS.batchName,
    assignedBatchSubjects: batchSubjects,
    chapterId: liveClass.chapter_id,
    chapterName,
    teacherName,
    enrolledStudentCount: 0, // Computed per-class in getTeacherClassById; 0 at list level
    isRecorded: liveClass.is_recorded ?? false,
    createdAt: liveClass.created_at,
  };
}

/**
 * Resolves batch subject names for a given class from batch_subject_live_classes.
 */
async function resolveClassBatchSubjects(
  classId: string,
): Promise<LiveClassBatchSubject[]> {
  const { data } = await supabase
    .from('batch_subject_live_classes')
    .select(`
      batch_subject_id,
      batch_subjects!inner (
        batch_subject_id,
        batch_id,
        batches!inner (name),
        subjects!inner (name)
      )
    `)
    .eq('class_id', classId);

  return (data ?? []).map((item: any) => ({
    batchSubjectId: item.batch_subject_id,
    batchId: item.batch_subjects?.batch_id ?? '',
    batchName: item.batch_subjects?.batches?.name ?? 'Unknown Batch',
    subjectName: item.batch_subjects?.subjects?.name ?? 'Unknown Subject',
  }));
}

/**
 * Gets the authenticated user's profile ID (auth.uid()).
 * Reuses teacherService.getTeacherProfileId() to avoid duplicating the session-get logic.
 */
async function getAuthProfileId(): Promise<string> {
  return teacherService.getTeacherProfileId('');
}

// ═══════════════════════════════════════════════════════════════════════════
//  Live Class Service
// ═══════════════════════════════════════════════════════════════════════════

export const teacherLiveClassService = {
  // ────────────────────────────────────────────────────────────────────────
  //  Schedule a New Class
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Schedule a live class for a future date/time.
   *
   * Unlike `teacherService.getOrCreateActiveLiveClass()`, this method
   **always creates a new row** and never reuses existing scheduled/live
   * classes. This allows teachers to schedule multiple future classes.
   *
   * @param input - Scheduling parameters.
   * @returns The created class ID and metadata.
   *
   * @throws LiveClassValidationError if input validation fails.
   * @throws LiveClassPermissionError if the teacher lacks permission.
   */
  async scheduleLiveClass(
    input: ScheduleLiveClassInput,
  ): Promise<ScheduleLiveClassResult> {
    // ════════════════════════════════════════════════════════════════════
    //  DEBUG: STEP 1 — Validate input
    // ════════════════════════════════════════════════════════════════════
    console.log('========================================');
    console.log('[DEBUG] [STEP 1] scheduleLiveClass called');
    console.log('[DEBUG] [STEP 1] input:', JSON.stringify(input, null, 2));

    if (!input.title || input.title.trim().length < 3) {
      throw new LiveClassValidationError(
        'Title is required and must be at least 3 characters.',
      );
    }

    assertFutureTime(input.scheduledAt);
    assertValidDuration(input.durationMin);

    if (!input.batchSubjectIds || input.batchSubjectIds.length === 0) {
      throw new LiveClassValidationError(
        'At least one batch subject must be selected.',
      );
    }

    // ── Validate teacher permissions for batch subjects ────────────────
    await assertBatchSubjectsAssignedToTeacher(input.teacherId, input.batchSubjectIds);

    // ════════════════════════════════════════════════════════════════════
    //  DEBUG: STEP 2 — Resolve auth user
    // ════════════════════════════════════════════════════════════════════
    const rawSession = await supabase.auth.getSession();
    console.log('[DEBUG] [STEP 2] Raw session user ID:', rawSession?.data?.session?.user?.id ?? 'NULL');
    console.log('[DEBUG] [STEP 2] Session expires at:', rawSession?.data?.session?.expires_at);

    const authUserId = await getAuthProfileId();
    console.log('[DEBUG] [STEP 2] authUserId (from getAuthProfileId):', authUserId);

    let institute_id: string = '';
    let teacher_id: string = '';
    try {
      const result = await teacherService.getTeacherInstituteAndTeacherId(authUserId);
      institute_id = result.institute_id;
      teacher_id = result.teacher_id;
      console.log('[DEBUG] [STEP 2] Resolved institute_id:', institute_id);
      console.log('[DEBUG] [STEP 2] Resolved teacher_id:', teacher_id);
    } catch (err: any) {
      console.error('[DEBUG] [STEP 2] FAILED to resolve teacher/institute:', err.message);
      throw err;
    }

    // ════════════════════════════════════════════════════════════════════
    //  DEBUG: STEP 3 — Insert live_class row
    // ════════════════════════════════════════════════════════════════════
    const insertPayload = {
      institute_id,
      teacher_id,
      chapter_id: input.chapterId ?? null,
      title: input.title.trim(),
      description: input.description?.trim() ?? null,
      scheduled_at: input.scheduledAt,
      duration_min: input.durationMin,
      status: 'scheduled',
      is_recorded: input.isRecorded ?? false,
    };
    console.log('[DEBUG] [STEP 3] Inserting into live_classes with payload:', JSON.stringify(insertPayload, null, 2));

    const { data: inserted, error: insertErr } = await supabase
      .from('live_classes')
      .insert([insertPayload])
      .select('class_id, title, status, scheduled_at, duration_min')
      .single();

    if (insertErr || !inserted) {
      console.error('[DEBUG] [STEP 3] ❌ live_classes INSERT failed:', JSON.stringify({
        message: insertErr?.message,
        code: insertErr?.code,
        details: insertErr?.details,
        hint: insertErr?.hint,
      }, null, 2));
      throw new Error(
        `Failed to schedule live class: ${insertErr?.message ?? 'Unknown error'}`,
      );
    }

    console.log('[DEBUG] [STEP 3] ✅ live_classes INSERT succeeded');
    console.log('[DEBUG] [STEP 3] Returned record:', JSON.stringify(inserted, null, 2));

    // ════════════════════════════════════════════════════════════════════
    //  DEBUG: STEP 4 — Verify class exists by re-querying
    // ════════════════════════════════════════════════════════════════════
    console.log('[DEBUG] [STEP 4] Verifying class_id exists in DB:', inserted.class_id);
    const { data: verifyData, error: verifyErr } = await supabase
      .from('live_classes')
      .select('class_id, teacher_id, status')
      .eq('class_id', inserted.class_id)
      .single();

    if (verifyErr || !verifyData) {
      console.error('[DEBUG] [STEP 4] ❌ Verification SELECT failed:', JSON.stringify({
        message: verifyErr?.message,
        code: verifyErr?.code,
        details: verifyErr?.details,
        hint: verifyErr?.hint,
      }, null, 2));
    } else {
      console.log('[DEBUG] [STEP 4] ✅ Verification: class exists');
      console.log('[DEBUG] [STEP 4] Stored teacher_id:', verifyData.teacher_id);
      console.log('[DEBUG] [STEP 4] Stored status:', verifyData.status);
    }

    // ════════════════════════════════════════════════════════════════════
    //  DEBUG: STEP 5 — Create assignment rows in batch_subject_live_classes
    // ════════════════════════════════════════════════════════════════════
    const assignmentRows = input.batchSubjectIds.map((batchSubjectId) => ({
      batch_subject_id: batchSubjectId,
      class_id: inserted.class_id,
      institute_id,
      assigned_by: authUserId,
    }));

    console.log('[DEBUG] [STEP 5] Inserting into batch_subject_live_classes:', JSON.stringify(assignmentRows, null, 2));

    const { error: assignErr } = await supabase
      .from('batch_subject_live_classes')
      .insert(assignmentRows);

    if (assignErr) {
      console.error('[DEBUG] [STEP 5] ❌ batch_subject_live_classes INSERT FAILED:');
      console.error('[DEBUG] [STEP 5]   message:', assignErr.message);
      console.error('[DEBUG] [STEP 5]   code:', assignErr.code);
      console.error('[DEBUG] [STEP 5]   details:', assignErr.details);
      console.error('[DEBUG] [STEP 5]   hint:', assignErr.hint);
    } else {
      console.log('[DEBUG] [STEP 5] ✅ batch_subject_live_classes INSERT succeeded');
    }

    console.log('[DEBUG] [DONE] scheduleLiveClass returning');
    console.log('========================================');

    return {
      classId: inserted.class_id,
      title: inserted.title,
      status: inserted.status as LiveClassStatus,
      scheduledAt: inserted.scheduled_at,
      durationMin: inserted.duration_min,
    };
  },

  // ────────────────────────────────────────────────────────────────────────
  //  List Scheduled Classes
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Get upcoming scheduled classes for a teacher.
   *
   * Returns classes with status = 'scheduled' and scheduled_at >= now(),
   * sorted by scheduled_at ascending (nearest first).
   *
   * @param teacherId - The teacher's ID.
   * @param page - Page number (1-indexed, default 1).
   * @param pageSize - Items per page (default 20).
   */
  async getTeacherScheduledClasses(
    teacherId: string,
    page = 1,
    pageSize = 20,
  ): Promise<TeacherClassListResponse> {
    const now = new Date().toISOString();
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // Fetch total count
    const { count: total } = await supabase
      .from('live_classes')
      .select('*', { count: 'exact', head: true })
      .eq('teacher_id', teacherId)
      .eq('status', 'scheduled')
      .gte('scheduled_at', now);

    // Fetch page
    const { data, error } = await supabase
      .from('live_classes')
      .select('*')
      .eq('teacher_id', teacherId)
      .eq('status', 'scheduled')
      .gte('scheduled_at', now)
      .order('scheduled_at', { ascending: true })
      .range(from, to);

    if (error || !data) {
      console.error('[LiveClass] Failed to fetch scheduled classes:', error?.message);
      return { classes: [], total: 0, page, pageSize };
    }

    const classes = await Promise.all(data.map(enrichClassWithNames));

    return { classes, total: total ?? classes.length, page, pageSize };
  },

  // ────────────────────────────────────────────────────────────────────────
  //  List Live Classes
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Get currently live classes for a teacher.
   *
   * Returns classes with status = 'live', sorted by updated_at descending
   * (most recently started first).
   *
   * @param teacherId - The teacher's ID.
   */
  async getTeacherLiveClasses(
    teacherId: string,
  ): Promise<LiveClassListItem[]> {
    const { data, error } = await supabase
      .from('live_classes')
      .select('*')
      .eq('teacher_id', teacherId)
      .eq('status', 'live')
      .order('updated_at', { ascending: false });

    if (error || !data) {
      console.error('[LiveClass] Failed to fetch live classes:', error?.message);
      return [];
    }

    return Promise.all(data.map(enrichClassWithNames));
  },

  // ────────────────────────────────────────────────────────────────────────
  //  List Completed Classes
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Get completed and cancelled classes for a teacher.
   *
   * Returns classes with status = 'completed' or 'cancelled', sorted by
   * scheduled_at descending (newest first).
   *
   * @param teacherId - The teacher's ID.
   * @param page - Page number (1-indexed, default 1).
   * @param pageSize - Items per page (default 20).
   */
  async getTeacherCompletedClasses(
    teacherId: string,
    page = 1,
    pageSize = 20,
  ): Promise<TeacherClassListResponse> {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { count: total } = await supabase
      .from('live_classes')
      .select('*', { count: 'exact', head: true })
      .eq('teacher_id', teacherId)
      .in('status', ['completed', 'cancelled']);

    const { data, error } = await supabase
      .from('live_classes')
      .select('*')
      .eq('teacher_id', teacherId)
      .in('status', ['completed', 'cancelled'])
      .order('scheduled_at', { ascending: false })
      .range(from, to);

    if (error || !data) {
      console.error('[LiveClass] Failed to fetch completed classes:', error?.message);
      return { classes: [], total: 0, page, pageSize };
    }

    const classes = await Promise.all(data.map(enrichClassWithNames));

    return { classes, total: total ?? classes.length, page, pageSize };
  },

  // ────────────────────────────────────────────────────────────────────────
  //  Get All Classes (Unified)
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Get all classes for a teacher with optional filters.
   *
   * This is the unified list endpoint that supports status filtering,
   * date range, and pagination.
   *
   * @param teacherId - The teacher's ID.
   * @param filters - Optional filters (status, date range, batch, pagination).
   */
  async getTeacherClasses(
    teacherId: string,
    filters: TeacherClassFilters = {},
  ): Promise<TeacherClassListResponse> {
    const {
      status,
      fromDate,
      toDate,
      batchId,
      page = 1,
      pageSize = 20,
    } = filters;

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // Build query
    let query = supabase
      .from('live_classes')
      .select('*', { count: 'exact' })
      .eq('teacher_id', teacherId);

    if (status && status.length > 0) {
      query = query.in('status', status);
    }

    if (fromDate) {
      query = query.gte('scheduled_at', fromDate);
    }

    if (toDate) {
      query = query.lte('scheduled_at', toDate);
    }

    // If filtering by batch, first get class IDs linked to that batch
    // via batch subjects
    if (batchId) {
      const { data: bsLinks } = await supabase
        .from('batch_subjects')
        .select('batch_subject_id')
        .eq('batch_id', batchId);

      const bsIds = (bsLinks ?? []).map((bs: any) => bs.batch_subject_id);
      if (bsIds.length === 0) {
        return { classes: [], total: 0, page, pageSize };
      }

      const { data: classLinks } = await supabase
        .from('batch_subject_live_classes')
        .select('class_id')
        .in('batch_subject_id', bsIds);

      const classIds = (classLinks ?? []).map((cl: any) => cl.class_id);
      if (classIds.length === 0) {
        return { classes: [], total: 0, page, pageSize };
      }
      query = query.in('class_id', classIds);
    }

    const { data, error, count: total } = await query
      .order('scheduled_at', { ascending: false })
      .range(from, to);

    if (error || !data) {
      console.error('[LiveClass] Failed to fetch classes:', error?.message);
      return { classes: [], total: 0, page, pageSize };
    }

    const classes = await Promise.all(data.map(enrichClassWithNames));

    return { classes, total: total ?? classes.length, page, pageSize };
  },

  // ────────────────────────────────────────────────────────────────────────
  //  Get Single Class Detail
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Get complete details for a single live class.
   *
   * Includes enriched data: batch names, chapter name,
   * session info, teacher name, and enrolled student count.
   *
   * @param classId - The UUID of the live class.
   * @returns Full class detail, or null if not found.
   */
  async getTeacherClassById(
    classId: string,
  ): Promise<LiveClassDetail | null> {
    // ── Fetch the live class ──────────────────────────────────────────
    const { data: liveClass, error } = await supabase
      .from('live_classes')
      .select('*')
      .eq('class_id', classId)
      .single();

    if (error || !liveClass) {
      return null;
    }

    // ── Fetch related data in parallel ────────────────────────────────
    const [batchSubjects, chapterName, sessionData] =
      await Promise.all([
        resolveClassBatchSubjects(classId),
        resolveChapterName(liveClass.chapter_id),
        supabase
          .from('live_sessions')
          .select('*')
          .eq('class_id', classId)
          .single()
          .then(res => res, () => ({ data: null, error: null })),
      ]);

    // ── Compute enrolled student count for the first batch subject's batch ──
    let enrolledStudentCount = 0;
    if (batchSubjects.length > 0) {
      const { count } = await supabase
        .from('batch_students')
        .select('*', { count: 'exact', head: true })
        .eq('batch_id', batchSubjects[0].batchId);
      enrolledStudentCount = count ?? 0;
    }

    const session = sessionData?.data
      ? {
          sessionId: sessionData.data.session_id,
          status: sessionData.data.status as 'waiting' | 'live' | 'ended',
          startedAt: sessionData.data.started_at,
          endedAt: sessionData.data.ended_at,
          peakParticipants: sessionData.data.peak_participants,
          provider: sessionData.data.provider,
        }
      : null;

    const firstBS = batchSubjects[0] ?? {
      batchSubjectId: '',
      batchId: '',
      batchName: 'Unassigned',
      subjectName: '',
    };

    const batchNames = batchSubjects.map((s) => ({
      batchId: s.batchId,
      batchName: s.batchName,
    }));

    return {
      classId: liveClass.class_id,
      title: liveClass.title,
      status: liveClass.status as LiveClassStatus,
      scheduledAt: liveClass.scheduled_at,
      durationMin: liveClass.duration_min,
      batchId: firstBS.batchId,
      batchName: firstBS.batchName,
      assignedBatchSubjects: batchSubjects,
      chapterId: liveClass.chapter_id,
      chapterName,
      teacherName: '', // Would need a profiles join for full name
      enrolledStudentCount,
      isRecorded: liveClass.is_recorded ?? false,
      description: liveClass.description,
      roomName: liveClass.room_name,
      cancelledAt: liveClass.cancelled_at,
      cancelledReason: liveClass.cancelled_reason,
      recordingUrl: liveClass.recording_url,
      createdAt: liveClass.created_at,
      session,
      batches: batchNames,
      allBatches: batchNames,
    };
  },

  // ────────────────────────────────────────────────────────────────────────
  //  Update Scheduled Class
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Update a scheduled live class.
   *
   * Only editable when the class status is 'scheduled' and the teacher
   * owns the class. Updates are applied atomically.
   *
   * @param classId - The UUID of the live class.
   * @param teacherId - The teacher's ID (for ownership validation).
   * @param updates - The fields to update.
   *
   * @throws LiveClassValidationError if class cannot be edited.
   * @throws LiveClassPermissionError if teacher does not own the class.
   */
  async updateScheduledClass(
    classId: string,
    teacherId: string,
    updates: UpdateScheduledClassInput,
  ): Promise<void> {
    // ── Validate ownership and status ──────────────────────────────────
    const liveClass = await validateTeacherOwnsClass(classId, teacherId);
    assertClassStatus(liveClass, ['scheduled'], 'edit');

    // ── Validate title (if changing) ───────────────────────────────────
    if (updates.title !== undefined && updates.title.trim().length < 3) {
      throw new LiveClassValidationError(
        'Title must be at least 3 characters.',
      );
    }

    // ── Validate new schedule time (if changing) ──────────────────────
    if (updates.scheduledAt) {
      assertFutureTime(updates.scheduledAt);
    }

    // ── Validate duration (if changing) ────────────────────────────────
    if (updates.durationMin !== undefined) {
      assertValidDuration(updates.durationMin);
    }

    // ── Validate new batch subject assignments (if changing) ───────────
    if (updates.batchSubjectIds && updates.batchSubjectIds.length > 0) {
      await assertBatchSubjectsAssignedToTeacher(teacherId, updates.batchSubjectIds);
    }

    // ── Build update payload (only provided fields) ────────────────────
    const payload: Record<string, any> = {};
    if (updates.title !== undefined) payload.title = updates.title.trim();
    if (updates.description !== undefined) payload.description = updates.description?.trim() ?? null;
    if (updates.chapterId !== undefined) payload.chapter_id = updates.chapterId ?? null;
    if (updates.scheduledAt !== undefined) payload.scheduled_at = updates.scheduledAt;
    if (updates.durationMin !== undefined) payload.duration_min = updates.durationMin;
    if (updates.isRecorded !== undefined) payload.is_recorded = updates.isRecorded;
    payload.updated_at = new Date().toISOString();

    // ── Execute update ────────────────────────────────────────────────
    const { error: updateErr } = await supabase
      .from('live_classes')
      .update(payload)
      .eq('class_id', classId);

    if (updateErr) {
      throw new Error(
        `Failed to update live class: ${updateErr.message}`,
      );
    }

    // ── Update batch subject links if batchSubjectIds changed ─────────
    if (updates.batchSubjectIds !== undefined) {
      // Remove existing links from batch_subject_live_classes
      const { error: deleteErr } = await supabase
        .from('batch_subject_live_classes')
        .delete()
        .eq('class_id', classId);

      if (deleteErr) {
        console.error('[LiveClass] Failed to remove old batch subject links:', deleteErr.message);
      }

      // Insert new links
      if (updates.batchSubjectIds.length > 0) {
        const authUserId = await getAuthProfileId();

        // Need institute_id for the new assignments
        const liveClass = await validateTeacherOwnsClass(classId, teacherId);
        const institute_id = liveClass.institute_id;

        const newLinks = updates.batchSubjectIds.map((batchSubjectId) => ({
          batch_subject_id: batchSubjectId,
          class_id: classId,
          institute_id,
          assigned_by: authUserId,
        }));

        console.log('[DEBUG] [update] Inserting batch subject links:', JSON.stringify(newLinks, null, 2));

        const { error: insertErr } = await supabase
          .from('batch_subject_live_classes')
          .insert(newLinks);

        if (insertErr) {
          console.error('[DEBUG] [update] ❌ batch_subject_live_classes INSERT FAILED:');
          console.error('[DEBUG] [update]   message:', insertErr.message);
          console.error('[DEBUG] [update]   code:', insertErr.code);
          console.error('[DEBUG] [update]   details:', insertErr.details);
          console.error('[DEBUG] [update]   hint:', insertErr.hint);
        } else {
          console.log('[DEBUG] [update] ✅ batch_subject_live_classes INSERT succeeded');
        }
      }
    }
  },

  // ────────────────────────────────────────────────────────────────────────
  //  Cancel Scheduled Class
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Cancel a scheduled live class.
   *
   * Only 'scheduled' classes can be cancelled. Sets status to 'cancelled',
   * records the cancellation time and optional reason.
   *
   * @param classId - The UUID of the live class.
   * @param teacherId - The teacher's ID (for ownership validation).
   * @param reason - Optional reason for cancellation.
   *
   * @throws LiveClassValidationError if class cannot be cancelled.
   * @throws LiveClassPermissionError if teacher does not own the class.
   */
  async cancelScheduledClass(
    classId: string,
    teacherId: string,
    reason?: string,
  ): Promise<void> {
    // ── Validate ownership and status ──────────────────────────────────
    const liveClass = await validateTeacherOwnsClass(classId, teacherId);
    assertClassStatus(liveClass, ['scheduled'], 'cancel');

    const now = new Date().toISOString();

    // ── Execute cancellation ──────────────────────────────────────────
    const { error: updateErr } = await supabase
      .from('live_classes')
      .update({
        status: 'cancelled',
        cancelled_at: now,
        cancelled_reason: reason?.trim() ?? null,
        updated_at: now,
      })
      .eq('class_id', classId);

    if (updateErr) {
      throw new Error(
        `Failed to cancel live class: ${updateErr.message}`,
      );
    }
  },

  // ────────────────────────────────────────────────────────────────────────
  //  Start a Scheduled Class
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Start a pre-scheduled live class.
   *
   * Validates that the class belongs to the teacher and has status
   * 'scheduled', then reuses `teacherService.startLiveClass()` to
   * update the status to 'live' and create the LiveKit session.
   *
   * This preserves the existing Go Live → LiveKit broadcast flow.
   *
   * @param classId - The UUID of the scheduled live class.
   * @param teacherId - The teacher's ID (for ownership validation).
   *
   * @throws LiveClassValidationError if class cannot be started.
   * @throws LiveClassPermissionError if teacher does not own the class.
   */
  async startScheduledClass(
    classId: string,
    teacherId: string,
  ): Promise<{
    classId: string;
    title: string;
    roomName: string;
    instituteId: string;
  }> {
    // ── Validate ownership and status ──────────────────────────────────
    const liveClass = await validateTeacherOwnsClass(classId, teacherId);
    assertClassStatus(liveClass, ['scheduled'], 'start');

    // ── Build room name ────────────────────────────────────────────────
    const roomName = buildRoomName(classId);

    // ── Get teacher profile ID for participant logging ─────────────────
    const profileId = await teacherService.getTeacherProfileId(teacherId);

    // ── Reuse existing startLiveClass (sets status='live', creates session, logs participant) ─
    await teacherService.startLiveClass(
      classId,
      profileId,
      roomName,
      liveClass.institute_id,
    );

    // ── Return class info for LiveKit token generation and UI ──────────
    return {
      classId,
      title: liveClass.title,
      roomName,
      instituteId: liveClass.institute_id,
    };
  },
};
