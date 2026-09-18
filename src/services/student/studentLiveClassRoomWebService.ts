/**
 * Student Live Classroom Web Service
 *
 * Bridge service for the Student Interactive LiveKit Classroom (/student/classes/[classId]).
 *
 * Responsibilities:
 *   - Verifies student entitlement for a specific live class ID.
 *   - Obtains ephemeral LiveKit Access Token from the authoritative `livekit-token` Edge Function.
 *   - Queries lightweight session and class status for lifecycle reconciliation.
 *
 * Security Rule:
 *   - The browser never creates LiveKit tokens locally.
 *   - The browser never makes attendance or session writes directly.
 *   - All access is authorized through `authorize_live_class_access` RPC inside `livekit-token`.
 *
 * @module services/student/studentLiveClassRoomWebService
 */

import { supabase } from '@/config/supabase';
import { resolveCurrentStudentId, isUuidString } from './studentCourseWebService';
import type { StudentLiveClassStatus, LiveSessionStatus } from './studentLiveClassWebService';

export interface AuthorizedLiveClassRoomData {
  classId: string;
  title: string;
  status: StudentLiveClassStatus;
  subjectName: string;
  subjectCode: string | null;
  teacherName: string | null;
  teacherId: string | null;
  batchName: string;
  batchId: string;
  scheduledAt: string;
  durationMin: number;
  roomName: string | null;
  isRecorded: boolean;
  chapterName: string | null;
  topicName: string | null;
  description: string | null;
  canJoin: boolean;
  sessionStatus: LiveSessionStatus;
}

export interface LiveKitTokenResponse {
  token: string;
  url: string;
}

// ─── 1. Fetch Authorized Class by ID ───────────────────────────────────────

/**
 * Validates that the current authenticated student is actively enrolled
 * in a batch that is assigned to this specific class_id.
 */
export async function fetchStudentAuthorizedLiveClass(
  classId: string,
  userId?: string
): Promise<{ data: AuthorizedLiveClassRoomData | null; error: string | null }> {
  if (!isUuidString(classId)) {
    return { data: null, error: 'Invalid class identifier format.' };
  }

  try {
    // 1. Resolve student ID
    const studentId = await resolveCurrentStudentId(userId);
    if (!studentId) {
      return { data: null, error: 'Student authentication required.' };
    }

    // 2. Discover active batch IDs for this student
    const batchIds: string[] = [];

    const { data: batchStudentRows, error: bsErr } = await supabase
      .from('batch_students')
      .select('batch_id')
      .eq('student_id', studentId)
      .eq('status', 'active');

    if (bsErr) {
      console.error('[studentLiveClassRoomWebService] batch_students query error:', bsErr);
      return { data: null, error: 'Failed to verify batch memberships.' };
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
      return { data: null, error: 'You are not actively enrolled in any batches.' };
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
      console.error('[studentLiveClassRoomWebService] batch_subjects query error:', bSubErr);
      return { data: null, error: 'Failed to resolve batch subjects.' };
    }

    const batchSubjectList = batchSubjectsData || [];
    const batchSubjectIds = batchSubjectList.map((bs: any) => bs.batch_subject_id).filter(isUuidString);

    if (batchSubjectIds.length === 0) {
      return { data: null, error: 'No subjects assigned to your batches.' };
    }

    // 4. Verify class assignment for this classId
    const { data: assignmentRows, error: assignErr } = await supabase
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
      .eq('class_id', classId)
      .in('batch_subject_id', batchSubjectIds)
      .neq('live_classes.status', 'draft')
      .limit(1);

    if (assignErr) {
      console.error('[studentLiveClassRoomWebService] batch_subject_live_classes query error:', assignErr);
      return { data: null, error: 'Failed to verify class authorization.' };
    }

    if (!assignmentRows || assignmentRows.length === 0) {
      return { data: null, error: 'You do not have access to this live class.' };
    }

    const row = assignmentRows[0];
    const c = Array.isArray(row.live_classes) ? row.live_classes[0] : row.live_classes;
    if (!c) {
      return { data: null, error: 'Class information not found.' };
    }

    // Resolve batch subject metadata
    const matchingBs = batchSubjectList.find((bs: any) => bs.batch_subject_id === row.batch_subject_id);
    const s = matchingBs?.subjects ? (Array.isArray(matchingBs.subjects) ? matchingBs.subjects[0] : matchingBs.subjects) : null;
    const b = matchingBs?.batches ? (Array.isArray(matchingBs.batches) ? matchingBs.batches[0] : matchingBs.batches) : null;

    const subjectName = s?.name || 'Subject';
    const subjectCode = s?.code || null;
    const batchName = b?.name || 'Batch';
    const batchId = matchingBs?.batch_id || b?.batch_id || '';

    // 5. Resolve teacher name in parallel with live session status
    let teacherName: string | null = null;
    let sessionStatus: LiveSessionStatus = null;

    const promises: Promise<void>[] = [];

    if (c.teacher_id && isUuidString(c.teacher_id)) {
      promises.push(
        (async () => {
          try {
            const { data: tData } = await supabase
              .from('teacher_details')
              .select('teacher_id, profiles!inner (name)')
              .eq('teacher_id', c.teacher_id)
              .maybeSingle();
            if (tData?.profiles) {
              const p = Array.isArray(tData.profiles) ? tData.profiles[0] : tData.profiles;
              teacherName = p?.name || null;
            }
          } catch (tErr) {
            console.warn('[studentLiveClassRoomWebService] Teacher resolution failed:', tErr);
          }
        })()
      );
    }

    promises.push(
      (async () => {
        try {
          const { data: sData } = await supabase
            .from('live_sessions')
            .select('class_id, status')
            .eq('class_id', classId)
            .order('started_at', { ascending: false })
            .limit(1);
          if (sData && sData.length > 0) {
            sessionStatus = sData[0].status as LiveSessionStatus;
          }
        } catch (sErr) {
          console.warn('[studentLiveClassRoomWebService] Session resolution failed:', sErr);
        }
      })()
    );

    await Promise.all(promises);

    const chapterName = (c as any).chapters
      ? (Array.isArray((c as any).chapters) ? (c as any).chapters[0]?.name : (c as any).chapters.name)
      : null;
    const topicName = (c as any).topics
      ? (Array.isArray((c as any).topics) ? (c as any).topics[0]?.name : (c as any).topics.name)
      : null;

    const status = (c.status || 'scheduled') as StudentLiveClassStatus;
    const canJoin = status === 'live';

    return {
      data: {
        classId: c.class_id,
        title: c.title || 'Live Class',
        status,
        subjectName,
        subjectCode,
        teacherName,
        teacherId: c.teacher_id || null,
        batchName,
        batchId,
        scheduledAt: c.scheduled_at,
        durationMin: Number(c.duration_min) ?? 0,
        roomName: c.room_name || null,
        isRecorded: Boolean(c.is_recorded),
        chapterName: chapterName || null,
        topicName: topicName || null,
        description: c.description || null,
        canJoin,
        sessionStatus,
      },
      error: null,
    };
  } catch (err: any) {
    console.error('[studentLiveClassRoomWebService] fetchStudentAuthorizedLiveClass exception:', err);
    return { data: null, error: err?.message || 'Failed to verify class authorization.' };
  }
}

// ─── 2. Request Ephemeral LiveKit Token ────────────────────────────────────

/**
 * Invokes the existing Supabase `livekit-token` Edge Function.
 * Passes only { classId, participantName } along with authenticated user JWT.
 */
export async function requestStudentLiveKitToken(
  classId: string,
  participantName?: string
): Promise<{ data: LiveKitTokenResponse | null; error: string | null }> {
  if (!isUuidString(classId)) {
    return { data: null, error: 'Invalid class ID format.' };
  }

  try {
    const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
    if (sessionErr || !sessionData?.session?.access_token) {
      return { data: null, error: 'User is not authenticated. Please log in.' };
    }

    const accessToken = sessionData.session.access_token;
    const user = sessionData.session.user;
    const resolvedName = participantName?.trim() || user?.user_metadata?.name || user?.user_metadata?.full_name || user?.email || "Student";

    // Invoke Edge Function via Supabase functions.invoke or native fetch
    const { data, error } = await supabase.functions.invoke<LiveKitTokenResponse>(
      'livekit-token',
      {
        body: {
          classId,
          participantName: resolvedName,
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (error) {
      console.error('[studentLiveClassRoomWebService] livekit-token function error:', error);
      return { data: null, error: error.message || 'Unable to join classroom. Please try again.' };
    }

    if (!data?.token || !data?.url) {
      return { data: null, error: 'Invalid response from token service.' };
    }

    return { data, error: null };
  } catch (err: any) {
    console.error('[studentLiveClassRoomWebService] requestStudentLiveKitToken exception:', err);
    return { data: null, error: err?.message || 'Connection to classroom server failed.' };
  }
}

// ─── 3. Lightweight Live Class Status Checker ──────────────────────────────

/**
 * Lightweight poll to check if scheduled class went live or live class ended.
 */
export async function checkLiveClassStatus(
  classId: string
): Promise<{ status: StudentLiveClassStatus | null; sessionStatus: LiveSessionStatus | null }> {
  if (!isUuidString(classId)) {
    return { status: null, sessionStatus: null };
  }

  try {
    const { data: classRow } = await supabase
      .from('live_classes')
      .select('status')
      .eq('class_id', classId)
      .maybeSingle();

    const { data: sessionRows } = await supabase
      .from('live_sessions')
      .select('status')
      .eq('class_id', classId)
      .order('started_at', { ascending: false })
      .limit(1);

    const status = (classRow?.status || null) as StudentLiveClassStatus | null;
    const sessionStatus = (sessionRows?.[0]?.status || null) as LiveSessionStatus | null;

    return { status, sessionStatus };
  } catch {
    return { status: null, sessionStatus: null };
  }
}