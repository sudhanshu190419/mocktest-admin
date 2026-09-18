/**
 * Student Recorded Classes Web Service
 *
 * Dedicated data service for the Student Recorded Classes Hub (/student/recordings).
 * Resolves student batch assignments authoritatively from Supabase:
 *   auth.uid()
 *   → public.student_details
 *   → public.batch_students (active / approved)
 *   → public.batch_subjects (is_active = true)
 *   → public.batch_subject_recordings
 *   → public.recordings (status = 'completed', is_deleted = false)
 *   + public.live_classes (title, description, teacher_id, scheduled_at)
 *   + public.teacher_details / profiles (teacher display names)
 *   + public.student_viewing_history (viewing progress & completion status)
 *
 * Security & Architecture Rules:
 *   - No student_id or batch_id claims accepted from the UI or query parameters.
 *   - Deduplicates recordings assigned to multiple batch subjects in memory.
 *   - Zero N+1 queries — uses batched lookups for teachers and viewing history.
 *   - Zero playback URL requests — playback URLs belong strictly to the Player route.
 *   - No imports from teacher/admin recording services or hooks.
 *
 * @module services/student/studentRecordingWebService
 */

import { supabase } from '@/config/supabase';
import { resolveCurrentStudentId, isUuidString } from './studentCourseWebService';
import {
  fetchBatchRecordingProgress,
  fetchSingleRecordingProgress,
  type StudentRecordingProgress,
} from './studentRecordingProgressWebService';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

export interface StudentRecording {
  recordingId: string;
  classId: string | null;
  title: string;
  description: string | null;
  teacherName: string | null;
  subjectName: string | null;
  batchName: string | null;
  batchId: string | null;
  courseName: string | null;
  thumbnailPath: string | null;
  durationSeconds: number;
  scheduledAt: string | null;
  createdAt: string;
  progress: StudentRecordingProgress | null;
}

export interface StudentPlaybackUrlResult {
  playbackUrl: string;
  expiresAt: string | null;
  durationSeconds?: number | null;
}

export interface StudentRecordingsHubData {
  recordings: StudentRecording[];
  availableSubjects: string[];
  availableBatches: Array<{ batchId: string; batchName: string }>;
  totalCount: number;
  completedCount: number;
  inProgressCount: number;
  unwatchedCount: number;
}

export type WatchStatusFilter = 'all' | 'not_started' | 'in_progress' | 'completed';
export type RecordingSortOption = 'newest' | 'oldest' | 'duration_desc' | 'duration_asc';

export interface StudentRecordingFilterOptions {
  searchQuery?: string;
  subject?: string;
  batchId?: string;
  watchStatus?: WatchStatusFilter;
  sortBy?: RecordingSortOption;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Internal Helpers
// ═══════════════════════════════════════════════════════════════════════════

interface TeacherProfileLookupRow {
  teacher_id: string;
  profiles: {
    name: string | null;
  } | null;
}

/**
 * Batched teacher profile lookup.
 * Query pattern: teacher_details -> profiles (name)
 */
async function buildTeacherNameMap(teacherIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const validIds = teacherIds.filter(isUuidString);
  if (validIds.length === 0) return map;

  try {
    const { data, error } = await supabase
      .from('teacher_details')
      .select('teacher_id, profiles!inner (name)')
      .in('teacher_id', validIds);

    if (error) {
      console.warn('[studentRecordingWebService] Teacher name lookup error:', error);
      return map;
    }

    const rows = (data as unknown as TeacherProfileLookupRow[] | null) ?? [];
    for (const row of rows) {
      if (row.teacher_id && row.profiles?.name) {
        map.set(row.teacher_id, row.profiles.name);
      }
    }
  } catch (err) {
    console.warn('[studentRecordingWebService] Unexpected error fetching teacher names:', err);
  }

  return map;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Formatters & Display Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Formats duration in seconds into human-readable text (e.g. "1 hr 25 mins" or "45 mins").
 */
export function formatRecordingDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '0 mins';
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;

  if (hours > 0 && mins > 0) {
    return `${hours} hr ${mins} mins`;
  }
  if (hours > 0) {
    return `${hours} hr${hours > 1 ? 's' : ''}`;
  }
  return `${mins} min${mins !== 1 ? 's' : ''}`;
}

/**
 * Formats a recording date into "MMM D, YYYY" or fallback string.
 */
export function formatRecordingDate(dateStr: string | null): string {
  if (!dateStr) return 'Recorded';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Recorded';
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return 'Recorded';
  }
}

/**
 * Color mapping consistent with the Student Web Portal design system.
 */
export function getRecordingSubjectColor(subjectName?: string | null): {
  bg: string;
  text: string;
  border: string;
  badge: string;
  accent: string;
  gradient: string;
} {
  const s = (subjectName || '').toLowerCase();
  if (s.includes('physic')) {
    return {
      bg: 'bg-indigo-50',
      text: 'text-indigo-700',
      border: 'border-indigo-200',
      badge: 'bg-indigo-500',
      accent: 'text-indigo-600',
      gradient: 'from-indigo-600 to-indigo-800',
    };
  }
  if (s.includes('chem')) {
    return {
      bg: 'bg-emerald-50',
      text: 'text-emerald-700',
      border: 'border-emerald-200',
      badge: 'bg-emerald-500',
      accent: 'text-emerald-600',
      gradient: 'from-emerald-600 to-emerald-800',
    };
  }
  if (s.includes('math')) {
    return {
      bg: 'bg-amber-50',
      text: 'text-amber-800',
      border: 'border-amber-200',
      badge: 'bg-amber-500',
      accent: 'text-amber-600',
      gradient: 'from-amber-600 to-amber-800',
    };
  }
  if (s.includes('bio') || s.includes('botany') || s.includes('zoolog')) {
    return {
      bg: 'bg-teal-50',
      text: 'text-teal-700',
      border: 'border-teal-200',
      badge: 'bg-teal-500',
      accent: 'text-teal-600',
      gradient: 'from-teal-600 to-teal-800',
    };
  }
  return {
    bg: 'bg-sky-50',
    text: 'text-sky-700',
    border: 'border-sky-200',
    badge: 'bg-sky-500',
    accent: 'text-sky-600',
    gradient: 'from-sky-600 to-sky-800',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main Hub Service Operation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch all completed, accessible recorded classes for the authenticated student.
 *
 * @param userId - Optional Supabase auth user UUID. If omitted, resolved from session.
 *
 * @returns Result with StudentRecordingsHubData on success, or error string on failure.
 */
export async function fetchStudentRecordingsHubData(
  userId?: string,
): Promise<{ data: StudentRecordingsHubData | null; error: string | null }> {
  try {
    // 1. Authoritatively resolve the current student record
    const studentId = await resolveCurrentStudentId(userId);
    if (!studentId) {
      return { data: null, error: 'Student authentication required to view recorded classes.' };
    }

    // 2. Discover active batch IDs for this student
    const { data: batchStudentRows, error: bsErr } = await supabase
      .from('batch_students')
      .select('batch_id')
      .eq('student_id', studentId)
      .in('status', ['active', 'approved']);

    if (bsErr) {
      console.error('[studentRecordingWebService] Error fetching batch_students:', bsErr);
      return { data: null, error: bsErr.message || 'Failed to verify student batch enrollments.' };
    }

    const batchIds: string[] = [];
    for (const row of (batchStudentRows ?? []) as any[]) {
      if (row.batch_id && isUuidString(row.batch_id)) {
        batchIds.push(row.batch_id);
      }
    }

    if (batchIds.length === 0) {
      // Student has no active batches — return empty data
      return {
        data: {
          recordings: [],
          availableSubjects: [],
          availableBatches: [],
          totalCount: 0,
          completedCount: 0,
          inProgressCount: 0,
          unwatchedCount: 0,
        },
        error: null,
      };
    }

    // 3. Resolve batch_subjects for the student's active batches
    const { data: batchSubjectsData, error: batchSubjectsErr } = await supabase
      .from('batch_subjects')
      .select(`
        batch_subject_id,
        batch_id,
        name,
        batches!inner (name),
        subjects (name)
      `)
      .in('batch_id', batchIds)
      .eq('is_active', true);

    if (batchSubjectsErr) {
      console.error('[studentRecordingWebService] Error fetching batch_subjects:', batchSubjectsErr);
      return { data: null, error: batchSubjectsErr.message || 'Failed to load batch subjects.' };
    }

    const bsRows = (batchSubjectsData ?? []) as any[];
    if (bsRows.length === 0) {
      return {
        data: {
          recordings: [],
          availableSubjects: [],
          availableBatches: [],
          totalCount: 0,
          completedCount: 0,
          inProgressCount: 0,
          unwatchedCount: 0,
        },
        error: null,
      };
    }

    const batchSubjectIds: string[] = [];
    const bsInfoMap = new Map<
      string,
      { batchId: string; batchName: string | null; subjectName: string | null }
    >();
    const batchMap = new Map<string, string>();
    const subjectSet = new Set<string>();

    for (const bs of bsRows) {
      const bsId = bs.batch_subject_id;
      if (!bsId) continue;
      batchSubjectIds.push(bsId);

      const batchName = bs.batches?.name ?? 'Batch';
      const subjectName = bs.name || bs.subjects?.name || 'General';

      bsInfoMap.set(bsId, {
        batchId: bs.batch_id,
        batchName,
        subjectName,
      });

      if (bs.batch_id && batchName) {
        batchMap.set(bs.batch_id, batchName);
      }
      if (subjectName) {
        subjectSet.add(subjectName);
      }
    }

    // 4. Query batch_subject_recordings joining completed, non-deleted recordings
    const { data: bsrData, error: bsrErr } = await supabase
      .from('batch_subject_recordings')
      .select(`
        recording_id,
        batch_subject_id,
        recordings!inner (
          recording_id,
          class_id,
          teacher_id,
          status,
          duration_seconds,
          thumbnail_path,
          created_at,
          is_deleted,
          live_classes!left (
            class_id,
            title,
            description,
            teacher_id,
            scheduled_at
          )
        )
      `)
      .in('batch_subject_id', batchSubjectIds)
      .eq('recordings.status', 'completed')
      .eq('recordings.is_deleted', false);

    if (bsrErr) {
      console.error('[studentRecordingWebService] Error fetching recordings:', bsrErr);
      return { data: null, error: bsrErr.message || 'Failed to query recorded classes.' };
    }

    const bsrRows = (bsrData ?? []) as any[];
    if (bsrRows.length === 0) {
      return {
        data: {
          recordings: [],
          availableSubjects: Array.from(subjectSet).sort(),
          availableBatches: Array.from(batchMap.entries()).map(([batchId, batchName]) => ({
            batchId,
            batchName,
          })),
          totalCount: 0,
          completedCount: 0,
          inProgressCount: 0,
          unwatchedCount: 0,
        },
        error: null,
      };
    }

    // 5. Collect unique teacher IDs for batched profile resolution
    const teacherIdSet = new Set<string>();
    for (const row of bsrRows) {
      const rec = row.recordings;
      const teacherId = rec?.teacher_id || rec?.live_classes?.teacher_id;
      if (teacherId && isUuidString(teacherId)) {
        teacherIdSet.add(teacherId);
      }
    }

    const teacherNameMap = await buildTeacherNameMap(Array.from(teacherIdSet));

    // 6. Deduplicate recordings in memory by recording_id
    const recordingMap = new Map<string, StudentRecording>();
    const durationsMap = new Map<string, number>();

    for (const row of bsrRows) {
      const rec = row.recordings;
      if (!rec || rec.is_deleted || rec.status !== 'completed') continue;

      const recordingId = rec.recording_id;
      if (!recordingId || recordingMap.has(recordingId)) {
        continue;
      }

      const bsInfo = bsInfoMap.get(row.batch_subject_id);
      const teacherId = rec.teacher_id || rec.live_classes?.teacher_id;
      const teacherName = teacherId ? (teacherNameMap.get(teacherId) ?? null) : null;
      const durationSeconds = typeof rec.duration_seconds === 'number' ? Math.max(0, rec.duration_seconds) : 0;
      const title = rec.live_classes?.title || 'Recorded Class';
      const description = rec.live_classes?.description || null;
      const scheduledAt = rec.live_classes?.scheduled_at || null;

      durationsMap.set(recordingId, durationSeconds);

      recordingMap.set(recordingId, {
        recordingId,
        classId: rec.class_id || rec.live_classes?.class_id || null,
        title,
        description,
        teacherName,
        subjectName: bsInfo?.subjectName ?? null,
        batchName: bsInfo?.batchName ?? null,
        batchId: bsInfo?.batchId ?? null,
        courseName: null,
        thumbnailPath: rec.thumbnail_path || null,
        durationSeconds,
        scheduledAt,
        createdAt: rec.created_at || new Date().toISOString(),
        progress: null,
      });
    }

    const visibleRecordingIds = Array.from(recordingMap.keys());

    // 7. Batched fetch of viewing history
    const progressResult = await fetchBatchRecordingProgress(visibleRecordingIds, {
      studentId,
      durationsMap,
    });

    if (progressResult.error) {
      console.warn('[studentRecordingWebService] Warning: Could not load viewing progress:', progressResult.error);
    }

    const progressMap = progressResult.data;

    // 8. Merge progress and compute counters
    let completedCount = 0;
    let inProgressCount = 0;
    let unwatchedCount = 0;

    const normalizedRecordings: StudentRecording[] = [];

    for (const rec of recordingMap.values()) {
      const progress = progressMap?.get(rec.recordingId) ?? null;
      rec.progress = progress;

      if (progress?.isCompleted) {
        completedCount++;
      } else if (progress && progress.lastPositionSeconds > 0) {
        inProgressCount++;
      } else {
        unwatchedCount++;
      }

      normalizedRecordings.push(rec);
    }

    // Default sort: newest first
    normalizedRecordings.sort((a, b) => {
      const timeA = new Date(a.scheduledAt || a.createdAt).getTime();
      const timeB = new Date(b.scheduledAt || b.createdAt).getTime();
      return timeB - timeA;
    });

    return {
      data: {
        recordings: normalizedRecordings,
        availableSubjects: Array.from(subjectSet).sort(),
        availableBatches: Array.from(batchMap.entries()).map(([batchId, batchName]) => ({
          batchId,
          batchName,
        })),
        totalCount: normalizedRecordings.length,
        completedCount,
        inProgressCount,
        unwatchedCount,
      },
      error: null,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unexpected error loading recorded classes.';
    console.error('[studentRecordingWebService] Unexpected error in fetchStudentRecordingsHubData:', err);
    return { data: null, error: message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Client-Side In-Memory Filter Function
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Filters and sorts recordings completely in-memory without making database queries.
 */
export function filterStudentRecordings(
  recordings: StudentRecording[],
  options?: StudentRecordingFilterOptions,
): StudentRecording[] {
  if (!recordings || recordings.length === 0) {
    return [];
  }

  let result = [...recordings];

  // 1. Search Query Filter (Title, Teacher, Subject, Batch, Description)
  if (options?.searchQuery && options.searchQuery.trim().length > 0) {
    const q = options.searchQuery.trim().toLowerCase();
    result = result.filter((rec) => {
      const titleMatch = rec.title.toLowerCase().includes(q);
      const teacherMatch = rec.teacherName?.toLowerCase().includes(q) ?? false;
      const subjectMatch = rec.subjectName?.toLowerCase().includes(q) ?? false;
      const batchMatch = rec.batchName?.toLowerCase().includes(q) ?? false;
      const descMatch = rec.description?.toLowerCase().includes(q) ?? false;
      return titleMatch || teacherMatch || subjectMatch || batchMatch || descMatch;
    });
  }

  // 2. Subject Filter
  if (options?.subject && options.subject !== 'all') {
    const targetSubject = options.subject.toLowerCase();
    result = result.filter(
      (rec) => rec.subjectName && rec.subjectName.toLowerCase() === targetSubject,
    );
  }

  // 3. Batch Filter
  if (options?.batchId && options.batchId !== 'all') {
    result = result.filter((rec) => rec.batchId === options.batchId);
  }

  // 4. Watch Status Filter
  if (options?.watchStatus && options.watchStatus !== 'all') {
    result = result.filter((rec) => {
      const p = rec.progress;
      if (options.watchStatus === 'completed') {
        return p?.isCompleted === true;
      }
      if (options.watchStatus === 'in_progress') {
        return !!p && !p.isCompleted && p.lastPositionSeconds > 0;
      }
      if (options.watchStatus === 'not_started') {
        return !p || (!p.isCompleted && p.lastPositionSeconds === 0);
      }
      return true;
    });
  }

  // 5. Sorting
  const sortBy = options?.sortBy ?? 'newest';
  result.sort((a, b) => {
    if (sortBy === 'newest') {
      const timeA = new Date(a.scheduledAt || a.createdAt).getTime();
      const timeB = new Date(b.scheduledAt || b.createdAt).getTime();
      return timeB - timeA;
    }
    if (sortBy === 'oldest') {
      const timeA = new Date(a.scheduledAt || a.createdAt).getTime();
      const timeB = new Date(b.scheduledAt || b.createdAt).getTime();
      return timeA - timeB;
    }
    if (sortBy === 'duration_desc') {
      return b.durationSeconds - a.durationSeconds;
    }
    if (sortBy === 'duration_asc') {
      return a.durationSeconds - b.durationSeconds;
    }
    return 0;
  });

  return result;
}


// ═══════════════════════════════════════════════════════════════════════════
//  Single Recording Fetch & Authorization Verification
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch a single recording's metadata and viewing progress for the authenticated student.
 * Authoritatively verifies that the recording belongs to an active batch subject
 * enrolled by the student.
 *
 * @param recordingId - The UUID of the recording to fetch.
 * @param userId      - Optional Supabase auth user UUID. If omitted, resolved from session.
 *
 * @returns Result with StudentRecording on success, or error string on failure.
 */
export async function fetchStudentRecordingById(
  recordingId: string,
  userId?: string,
): Promise<{ data: StudentRecording | null; error: string | null }> {
  if (!recordingId || !isUuidString(recordingId)) {
    return { data: null, error: 'Invalid recording ID format.' };
  }

  try {
    // 1. Authoritatively resolve the current student record
    const studentId = await resolveCurrentStudentId(userId);
    if (!studentId) {
      return { data: null, error: 'Student authentication required to view this recording.' };
    }

    // 2. Discover active batch IDs for this student
    const { data: batchStudentRows, error: bsErr } = await supabase
      .from('batch_students')
      .select('batch_id')
      .eq('student_id', studentId)
      .in('status', ['active', 'approved']);

    if (bsErr) {
      console.error('[studentRecordingWebService] Error fetching batch_students:', bsErr);
      return { data: null, error: bsErr.message || 'Failed to verify student batch enrollments.' };
    }

    const batchIds: string[] = [];
    for (const row of (batchStudentRows ?? []) as any[]) {
      if (row.batch_id && isUuidString(row.batch_id)) {
        batchIds.push(row.batch_id);
      }
    }

    if (batchIds.length === 0) {
      return { data: null, error: 'You are not enrolled in any active batch for this recording.' };
    }

    // 3. Resolve batch_subjects for the student's active batches
    const { data: batchSubjectsData, error: batchSubjectsErr } = await supabase
      .from('batch_subjects')
      .select(`
        batch_subject_id,
        batch_id,
        name,
        batches!inner (name),
        subjects (name)
      `)
      .in('batch_id', batchIds)
      .eq('is_active', true);

    if (batchSubjectsErr) {
      console.error('[studentRecordingWebService] Error fetching batch_subjects:', batchSubjectsErr);
      return { data: null, error: batchSubjectsErr.message || 'Failed to load batch subjects.' };
    }

    const bsRows = (batchSubjectsData ?? []) as any[];
    if (bsRows.length === 0) {
      return { data: null, error: 'No active subjects found for this recording.' };
    }

    const batchSubjectIds: string[] = [];
    const bsInfoMap = new Map<
      string,
      { batchId: string; batchName: string | null; subjectName: string | null }
    >();

    for (const bs of bsRows) {
      const bsId = bs.batch_subject_id;
      if (!bsId) continue;
      batchSubjectIds.push(bsId);

      const batchName = bs.batches?.name ?? 'Batch';
      const subjectName = bs.subjects?.name ?? bs.name ?? 'Subject';
      bsInfoMap.set(bsId, {
        batchId: bs.batch_id,
        batchName,
        subjectName,
      });
    }

    // 4. Query recording in batch_subject_recordings
    const { data: bsrData, error: bsrErr } = await supabase
      .from('batch_subject_recordings')
      .select(`
        batch_subject_id,
        recordings!inner (
          recording_id,
          class_id,
          teacher_id,
          duration_seconds,
          thumbnail_path,
          status,
          is_deleted,
          created_at,
          live_classes (
            class_id,
            title,
            description,
            teacher_id,
            scheduled_at
          )
        )
      `)
      .in('batch_subject_id', batchSubjectIds)
      .eq('recording_id', recordingId)
      .eq('recordings.status', 'completed')
      .eq('recordings.is_deleted', false);

    if (bsrErr) {
      console.error('[studentRecordingWebService] Error fetching recording:', bsrErr);
      return { data: null, error: bsrErr.message || 'Failed to query recording details.' };
    }

    const bsrRows = (bsrData ?? []) as any[];
    if (bsrRows.length === 0) {
      return { data: null, error: 'Recording not found or you do not have permission to view it.' };
    }

    // Extract first matching row
    const row = bsrRows[0];
    const rec = row.recordings;
    const bsInfo = bsInfoMap.get(row.batch_subject_id);

    const teacherId = rec.teacher_id || rec.live_classes?.teacher_id;
    let teacherName: string | null = null;
    if (teacherId && isUuidString(teacherId)) {
      const teacherNameMap = await buildTeacherNameMap([teacherId]);
      teacherName = teacherNameMap.get(teacherId) ?? null;
    }

    const durationSeconds = typeof rec.duration_seconds === 'number' ? Math.max(0, rec.duration_seconds) : 0;
    const title = rec.live_classes?.title || 'Recorded Class';
    const description = rec.live_classes?.description || null;
    const scheduledAt = rec.live_classes?.scheduled_at || null;

    // 5. Fetch viewing progress
    const progressResult = await fetchSingleRecordingProgress(recordingId, durationSeconds, {
      studentId,
    });

    const progress = progressResult.data;

    const studentRecording: StudentRecording = {
      recordingId,
      classId: rec.class_id || rec.live_classes?.class_id || null,
      title,
      description,
      teacherName,
      subjectName: bsInfo?.subjectName ?? null,
      batchName: bsInfo?.batchName ?? null,
      batchId: bsInfo?.batchId ?? null,
      courseName: null,
      thumbnailPath: rec.thumbnail_path || null,
      durationSeconds,
      scheduledAt,
      createdAt: rec.created_at || new Date().toISOString(),
      progress,
    };

    return { data: studentRecording, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unexpected error loading recording.';
    console.error('[studentRecordingWebService] Unexpected error in fetchStudentRecordingById:', err);
    return { data: null, error: msg };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Presigned Playback URL Fetcher
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Request a short-lived presigned playback URL from the recording-playback-url Edge Function.
 * The Edge Function verifies course/batch enrollment server-side and returns a signed Cloudflare R2 URL.
 *
 * @param recordingId - The UUID of the recording to play.
 *
 * @returns Result with StudentPlaybackUrlResult on success, or error string on failure.
 */
export async function getStudentPlaybackUrl(
  recordingId: string,
): Promise<{ data: StudentPlaybackUrlResult | null; error: string | null }> {
  if (!recordingId || !isUuidString(recordingId)) {
    return { data: null, error: 'Invalid recording ID format.' };
  }

  try {
    const { data, error } = await supabase.functions.invoke<{
      url?: string;
      expiresAt?: string;
      durationSeconds?: number;
    }>('recording-playback-url', {
      body: {
        recordingId,
        expirySeconds: 300,
      },
    });

    if (error) {
      console.error('[studentRecordingWebService] Playback URL Edge Function error:', error);
      return { data: null, error: error.message || 'Failed to generate playback URL.' };
    }

    if (!data?.url) {
      return { data: null, error: 'No playback URL returned by server.' };
    }

    return {
      data: {
        playbackUrl: data.url,
        expiresAt: data.expiresAt ?? null,
        durationSeconds: data.durationSeconds ?? null,
      },
      error: null,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unexpected error requesting playback URL.';
    console.error('[studentRecordingWebService] Playback URL unexpected error:', err);
    return { data: null, error: msg };
  }
}
