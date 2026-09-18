/**
 * Student Live Classes Web Service
 *
 * Clean-architecture service bridge for the Student Live Classes Hub (/student/classes).
 * Adapts and normalizes live-class data from Supabase backend tables:
 *   - public.batch_students / public.course_enrollments (Student entitlement boundary)
 *   - public.batch_subjects (Batch to subject mapping)
 *   - public.batch_subject_live_classes (Assigned live classes per batch subject)
 *   - public.live_classes (Authoritative title, status, timestamps, duration, room_name)
 *   - public.teacher_details / public.profiles (Teacher display names)
 *   - public.live_sessions (Live room session status: waiting | live | ended)
 *   - public.recordings (Completed recording availability for past classes)
 *   - public.chapters / public.topics (Lesson planning metadata)
 *
 * Access rule:
 * Authenticated user -> student_details -> active batch_students -> batch_subjects -> batch_subject_live_classes -> live_classes (excluding draft)
 *
 * @module services/student/studentLiveClassWebService
 */

import { supabase } from '@/config/supabase';
import { resolveCurrentStudentId, isUuidString } from './studentCourseWebService';

export type StudentLiveClassStatus = 'draft' | 'scheduled' | 'live' | 'completed' | 'cancelled';
export type LiveSessionStatus = 'waiting' | 'live' | 'ended' | null;

export interface StudentLiveClassItem {
  classId: string;
  title: string;
  status: StudentLiveClassStatus;
  subjectName: string;
  subjectCode: string | null;
  teacherName: string | null;
  batchName: string;
  batchId: string;
  courseName: string | null;
  scheduledAt: string;
  durationMin: number;
  sessionStatus: LiveSessionStatus;
  roomName: string | null;
  isRecorded: boolean;
  hasRecordingAvailable: boolean;
  recordingId: string | null;
  chapterName: string | null;
  topicName: string | null;
  description: string | null;
  canJoin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StudentLiveClassesData {
  liveNow: StudentLiveClassItem[];
  upcoming: StudentLiveClassItem[];
  completed: StudentLiveClassItem[];
  allClasses: StudentLiveClassItem[];
  subjects: string[];
  batches: string[];
  summary: {
    totalLive: number;
    totalUpcoming: number;
    totalCompleted: number;
    totalAssigned: number;
    totalSubjects: number;
  };
}

export interface LiveClassFilters {
  searchQuery?: string;
  selectedSubject?: string | null;
  selectedBatch?: string | null;
}

// ─── Teacher Resolution Helper ──────────────────────────────────────────────

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
      console.warn('[studentLiveClassWebService] buildTeacherNameMap query warning:', error.message);
      return map;
    }

    if (data) {
      for (const row of data as any[]) {
        const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
        map.set(row.teacher_id, p?.name || 'Faculty');
      }
    }
  } catch (err) {
    console.warn('[studentLiveClassWebService] buildTeacherNameMap failed:', err);
  }

  return map;
}

// ─── Live Sessions Resolution Helper ────────────────────────────────────────

async function buildLiveSessionStatusMap(liveClassIds: string[]): Promise<Map<string, LiveSessionStatus>> {
  const map = new Map<string, LiveSessionStatus>();
  const validIds = liveClassIds.filter(isUuidString);
  if (validIds.length === 0) return map;

  try {
    const { data, error } = await supabase
      .from('live_sessions')
      .select('class_id, status')
      .in('class_id', validIds)
      .order('started_at', { ascending: false });

    if (error) {
      console.warn('[studentLiveClassWebService] live_sessions query warning:', error.message);
      return map;
    }

    if (data) {
      for (const session of data as any[]) {
        if (!map.has(session.class_id)) {
          map.set(session.class_id, session.status as LiveSessionStatus);
        }
      }
    }
  } catch (err) {
    console.warn('[studentLiveClassWebService] buildLiveSessionStatusMap failed:', err);
  }

  return map;
}

// ─── Completed Recordings Resolution Helper ─────────────────────────────────

async function buildRecordingsMap(completedClassIds: string[]): Promise<Map<string, { recordingId: string; isReady: boolean }>> {
  const map = new Map<string, { recordingId: string; isReady: boolean }>();
  const validIds = completedClassIds.filter(isUuidString);
  if (validIds.length === 0) return map;

  try {
    const { data, error } = await supabase
      .from('recordings')
      .select('recording_id, class_id, status')
      .in('class_id', validIds);

    if (error) {
      console.warn('[studentLiveClassWebService] recordings query warning:', error.message);
      return map;
    }

    if (data) {
      for (const rec of data as any[]) {
        if (rec.class_id && !map.has(rec.class_id)) {
          const isReady = rec.status === 'completed' || rec.status === 'ready';
          map.set(rec.class_id, {
            recordingId: rec.recording_id,
            isReady,
          });
        }
      }
    }
  } catch (err) {
    console.warn('[studentLiveClassWebService] buildRecordingsMap failed:', err);
  }

  return map;
}

// ─── Main Hub Data Fetcher ──────────────────────────────────────────────────

/**
 * Fetches all live classes for the authenticated student across active enrolled batches.
 * Returns normalized items partitioned by status (liveNow, upcoming, completed)
 * along with filter options and KPI counts.
 */
export async function fetchStudentLiveClassesHubData(
  userId?: string
): Promise<{ data: StudentLiveClassesData | null; error: string | null }> {
  try {
    // 1. Resolve student ID
    const studentId = await resolveCurrentStudentId(userId);
    if (!studentId) {
      return {
        data: {
          liveNow: [],
          upcoming: [],
          completed: [],
          allClasses: [],
          subjects: [],
          batches: [],
          summary: { totalLive: 0, totalUpcoming: 0, totalCompleted: 0, totalAssigned: 0, totalSubjects: 0 },
        },
        error: null,
      };
    }

    // 2. Discover active enrolled batch IDs
    const batchIds: string[] = [];

    // Direct active batch enrollments
    const { data: batchStudentRows, error: bsErr } = await supabase
      .from('batch_students')
      .select('batch_id')
      .eq('student_id', studentId)
      .eq('status', 'active');

    if (bsErr) {
      console.error('[studentLiveClassWebService] batch_students error:', bsErr);
      return { data: null, error: 'Failed to resolve student batch memberships' };
    }

    if (batchStudentRows) {
      batchStudentRows.forEach((r: any) => {
        if (r.batch_id && isUuidString(r.batch_id)) batchIds.push(r.batch_id);
      });
    }

    // Direct course enrollments -> batch mappings
    const { data: courseEnrollRows } = await supabase
      .from('course_enrollments')
      .select('course_id')
      .eq('student_id', studentId)
      .eq('is_active', true);

    if (courseEnrollRows && courseEnrollRows.length > 0) {
      const courseIds = courseEnrollRows.map((r: any) => r.course_id).filter(isUuidString);
      if (courseIds.length > 0) {
        const { data: courseBatchRows } = await supabase
          .from('course_batches')
          .select('batch_id')
          .in('course_id', courseIds);

        if (courseBatchRows) {
          courseBatchRows.forEach((r: any) => {
            if (r.batch_id && isUuidString(r.batch_id)) batchIds.push(r.batch_id);
          });
        }
      }
    }

    const uniqueBatchIds = Array.from(new Set(batchIds));
    if (uniqueBatchIds.length === 0) {
      return {
        data: {
          liveNow: [],
          upcoming: [],
          completed: [],
          allClasses: [],
          subjects: [],
          batches: [],
          summary: { totalLive: 0, totalUpcoming: 0, totalCompleted: 0, totalAssigned: 0, totalSubjects: 0 },
        },
        error: null,
      };
    }

    // 3. Resolve batch_subjects for student batches
    const { data: batchSubjectsData, error: bSubErr } = await supabase
      .from('batch_subjects')
      .select(`
        batch_subject_id,
        batch_id,
        subject_id,
        subjects:subject_id (
          subject_id,
          name,
          code
        ),
        batches:batch_id (
          batch_id,
          name,
          batch_code
        )
      `)
      .in('batch_id', uniqueBatchIds);

    if (bSubErr) {
      console.error('[studentLiveClassWebService] batch_subjects error:', bSubErr);
      return { data: null, error: 'Failed to resolve batch subjects' };
    }

    const batchSubjectList = batchSubjectsData || [];
    const batchSubjectIds = batchSubjectList.map((bs: any) => bs.batch_subject_id).filter(isUuidString);

    if (batchSubjectIds.length === 0) {
      return {
        data: {
          liveNow: [],
          upcoming: [],
          completed: [],
          allClasses: [],
          subjects: [],
          batches: [],
          summary: { totalLive: 0, totalUpcoming: 0, totalCompleted: 0, totalAssigned: 0, totalSubjects: 0 },
        },
        error: null,
      };
    }

    // Build lookup maps for batch_subject details
    const batchSubjectMetaMap = new Map<string, {
      subjectName: string;
      subjectCode: string | null;
      batchName: string;
      batchId: string;
    }>();

    batchSubjectList.forEach((bs: any) => {
      const s = Array.isArray(bs.subjects) ? bs.subjects[0] : bs.subjects;
      const b = Array.isArray(bs.batches) ? bs.batches[0] : bs.batches;
      batchSubjectMetaMap.set(bs.batch_subject_id, {
        subjectName: s?.name || 'General Subject',
        subjectCode: s?.code || null,
        batchName: b?.name || 'Assigned Batch',
        batchId: bs.batch_id || b?.batch_id || '',
      });
    });

    // 4. Query batch_subject_live_classes and join live_classes (excluding 'draft')
    const { data: assignedClassRows, error: assignErr } = await supabase
      .from('batch_subject_live_classes')
      .select(`
        batch_subject_id,
        class_id,
        live_classes!inner (
          class_id,
          title,
          status,
          scheduled_at,
          duration_min,
          description,
          is_recorded,
          room_name,
          teacher_id,
          created_at,
          updated_at,
          chapter_id,
          topic_id,
          chapters (name),
          topics (name)
        )
      `)
      .in('batch_subject_id', batchSubjectIds)
      .neq('live_classes.status', 'draft');

    if (assignErr) {
      console.error('[studentLiveClassWebService] batch_subject_live_classes error:', assignErr);
      return { data: null, error: 'Failed to fetch assigned live classes' };
    }

    if (!assignedClassRows || assignedClassRows.length === 0) {
      return {
        data: {
          liveNow: [],
          upcoming: [],
          completed: [],
          allClasses: [],
          subjects: [],
          batches: [],
          summary: { totalLive: 0, totalUpcoming: 0, totalCompleted: 0, totalAssigned: 0, totalSubjects: 0 },
        },
        error: null,
      };
    }

    // 5. Deduplicate live classes by class_id and collect teacher IDs
    const classMap = new Map<string, {
      rawClass: any;
      batchSubjectId: string;
    }>();
    const teacherIdSet = new Set<string>();
    const liveClassIdSet = new Set<string>();
    const completedClassIdSet = new Set<string>();

    assignedClassRows.forEach((row: any) => {
      const c = Array.isArray(row.live_classes) ? row.live_classes[0] : row.live_classes;
      if (!c || !c.class_id) return;

      if (!classMap.has(c.class_id)) {
        classMap.set(c.class_id, {
          rawClass: c,
          batchSubjectId: row.batch_subject_id,
        });

        if (c.teacher_id) teacherIdSet.add(c.teacher_id);
        if (c.status === 'live') liveClassIdSet.add(c.class_id);
        if (c.status === 'completed') completedClassIdSet.add(c.class_id);
      }
    });

    // 6. Batched supplementary lookups (teachers, live sessions, recordings) in parallel
    const [teacherNameMap, sessionStatusMap, recordingsMap] = await Promise.all([
      buildTeacherNameMap(Array.from(teacherIdSet)),
      buildLiveSessionStatusMap(Array.from(liveClassIdSet)),
      buildRecordingsMap(Array.from(completedClassIdSet)),
    ]);

    // 7. Normalize all items
    const allItems: StudentLiveClassItem[] = [];
    const subjectsSet = new Set<string>();
    const batchesSet = new Set<string>();

    Array.from(classMap.entries()).forEach(([classId, { rawClass: c, batchSubjectId }]) => {
      const meta = batchSubjectMetaMap.get(batchSubjectId);
      const subjectName = meta?.subjectName || 'General Subject';
      const subjectCode = meta?.subjectCode || null;
      const batchName = meta?.batchName || 'Assigned Batch';
      const batchId = meta?.batchId || '';

      if (subjectName) subjectsSet.add(subjectName);
      if (batchName) batchesSet.add(batchName);

      const teacherName = c.teacher_id ? teacherNameMap.get(c.teacher_id) || 'Faculty' : null;
      const sessionStatus = sessionStatusMap.get(classId) || null;
      const recMeta = recordingsMap.get(classId);

      const chapterName = c.chapters
        ? Array.isArray(c.chapters) ? c.chapters[0]?.name : c.chapters.name
        : null;
      const topicName = c.topics
        ? Array.isArray(c.topics) ? c.topics[0]?.name : c.topics.name
        : null;

      const status = (c.status || 'scheduled') as StudentLiveClassStatus;
      const canJoin = status === 'live';

      allItems.push({
        classId: c.class_id,
        title: c.title || 'Live Class Session',
        status,
        subjectName,
        subjectCode,
        teacherName,
        batchName,
        batchId,
        courseName: null,
        scheduledAt: c.scheduled_at,
        durationMin: Number(c.duration_min) || 60,
        sessionStatus,
        roomName: c.room_name || null,
        isRecorded: Boolean(c.is_recorded),
        hasRecordingAvailable: Boolean(recMeta?.isReady),
        recordingId: recMeta?.recordingId || null,
        chapterName: chapterName || null,
        topicName: topicName || null,
        description: c.description || null,
        canJoin,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      });
    });

    // 8. Partition and sort classes
    const liveNow: StudentLiveClassItem[] = [];
    const upcoming: StudentLiveClassItem[] = [];
    const completed: StudentLiveClassItem[] = [];

    allItems.forEach((item) => {
      if (item.status === 'live') {
        liveNow.push(item);
      } else if (item.status === 'scheduled') {
        upcoming.push(item);
      } else if (item.status === 'completed' || item.status === 'cancelled') {
        completed.push(item);
      }
    });

    // Sort live classes: newest started first
    liveNow.sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());

    // Sort upcoming classes: soonest first
    upcoming.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

    // Sort completed/cancelled classes: most recent first
    completed.sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());

    return {
      data: {
        liveNow,
        upcoming,
        completed,
        allClasses: allItems,
        subjects: Array.from(subjectsSet).sort(),
        batches: Array.from(batchesSet).sort(),
        summary: {
          totalLive: liveNow.length,
          totalUpcoming: upcoming.length,
          totalCompleted: completed.length,
          totalAssigned: allItems.length,
          totalSubjects: subjectsSet.size,
        },
      },
      error: null,
    };
  } catch (err: any) {
    console.error('[studentLiveClassWebService] fetchStudentLiveClassesHubData unexpected error:', err);
    return { data: null, error: err?.message || 'An unexpected error occurred while loading live classes' };
  }
}

// ─── Filtering & Formatting Helpers ─────────────────────────────────────────

export function filterStudentLiveClasses(
  classes: StudentLiveClassItem[],
  filters: LiveClassFilters
): StudentLiveClassItem[] {
  return classes.filter((item) => {
    // 1. Search Query
    if (filters.searchQuery && filters.searchQuery.trim() !== '') {
      const q = filters.searchQuery.toLowerCase().trim();
      const matchTitle = item.title.toLowerCase().includes(q);
      const matchSubject = item.subjectName.toLowerCase().includes(q);
      const matchTeacher = item.teacherName ? item.teacherName.toLowerCase().includes(q) : false;
      const matchChapter = item.chapterName ? item.chapterName.toLowerCase().includes(q) : false;
      const matchTopic = item.topicName ? item.topicName.toLowerCase().includes(q) : false;

      if (!matchTitle && !matchSubject && !matchTeacher && !matchChapter && !matchTopic) {
        return false;
      }
    }

    // 2. Selected Subject Filter
    if (filters.selectedSubject && filters.selectedSubject !== 'all') {
      if (item.subjectName.toLowerCase() !== filters.selectedSubject.toLowerCase()) {
        return false;
      }
    }

    // 3. Selected Batch Filter
    if (filters.selectedBatch && filters.selectedBatch !== 'all') {
      if (item.batchName.toLowerCase() !== filters.selectedBatch.toLowerCase()) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Formats a scheduled ISO timestamp into a student-friendly local date/time string.
 * Example: 'Today, 4:00 PM', 'Tomorrow, 10:30 AM', 'Sep 22, 3:00 PM'
 */
export function formatClassTimeDisplay(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return 'Scheduled';

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const targetDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());

    const diffDays = Math.round((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (diffDays === 0) {
      return `Today, ${timeStr}`;
    } else if (diffDays === 1) {
      return `Tomorrow, ${timeStr}`;
    } else if (diffDays === -1) {
      return `Yesterday, ${timeStr}`;
    } else {
      const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      return `${dateStr}, ${timeStr}`;
    }
  } catch {
    return 'Scheduled';
  }
}

/**
 * Formats a relative time description for badges or info boxes.
 * Example: 'Started 15m ago', 'Starts in 2h', 'Ended'
 */
export function formatRelativeClassTime(isoString: string, status: StudentLiveClassStatus): string {
  if (status === 'completed') return 'Completed';
  if (status === 'cancelled') return 'Cancelled';

  try {
    const d = new Date(isoString);
    const now = new Date();
    const diffMs = d.getTime() - now.getTime();
    const diffMinutes = Math.round(diffMs / (1000 * 60));

    if (status === 'live') {
      const startedMinutes = Math.abs(diffMinutes);
      if (startedMinutes < 1) return 'Started just now';
      if (startedMinutes < 60) return `Started ${startedMinutes}m ago`;
      const startedHours = Math.floor(startedMinutes / 60);
      return `Started ${startedHours}h ${startedMinutes % 60}m ago`;
    }

    // Scheduled
    if (diffMinutes <= 0) return 'Starting soon';
    if (diffMinutes < 60) return `Starts in ${diffMinutes}m`;
    const hours = Math.floor(diffMinutes / 60);
    const mins = diffMinutes % 60;
    if (hours < 24) return mins > 0 ? `Starts in ${hours}h ${mins}m` : `Starts in ${hours}h`;
    const days = Math.floor(hours / 24);
    return `Starts in ${days}d`;
  } catch {
    return 'Scheduled';
  }
}

/**
 * Returns color tokens for subject badge styling
 */
export function getClassSubjectColor(subjectName: string): {
  bg: string;
  text: string;
  border: string;
  badge: string;
} {
  const s = (subjectName || '').toLowerCase();
  if (s.includes('physic')) {
    return { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-100', badge: 'bg-indigo-500' };
  }
  if (s.includes('chem')) {
    return { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-100', badge: 'bg-emerald-500' };
  }
  if (s.includes('math')) {
    return { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-100', badge: 'bg-amber-500' };
  }
  if (s.includes('bio') || s.includes('botany') || s.includes('zoolog')) {
    return { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-100', badge: 'bg-teal-500' };
  }
  return { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-100', badge: 'bg-sky-500' };
}