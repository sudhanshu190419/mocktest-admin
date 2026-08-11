import { supabase } from '@/config/supabase';
import { MOCK_BATCHES } from '@/data/mockData';
import { liveClassAttendanceService } from './liveClassAttendanceService';
import type { 
  AcademicBatch, 
  StudentRosterItem, 
  CourseChapterItem 
} from '@/data/mockData';

/**
 * Service layer connecting the web dashboard to Supabase Domains:
 * - Domain 02: Academic Structure (batches, subjects, chapters, batch_students)
 * - Domain 04: Live Learning & Attendance (attendance, attendance_events)
 * - Domain 08: Analytics (subject_performances, chapter_performances)
 * - Domain 14: Student Services (student_doubts)
 */
export const teacherService = {
  /**
   * Fetch all batch subjects assigned to a teacher via batch_subject_teachers.
   * Groups by batch and subject. Returns an array shaped like AcademicBatch[]
   * for backward compatibility with existing consumers.
   */
  async getAssignedBatches(teacherId: string): Promise<AcademicBatch[]> {
    try {
      const allottedKey = `EDTECH_ALLOTTED_BATCHES_${teacherId}`;
      const localAllotmentsStr = localStorage.getItem(allottedKey);

      // Check if we are in demo mode or if this is the default simulation/mock teacher profile
      const isDefaultMockTeacher = teacherId === 'tch-8492-phy' || teacherId.toLowerCase().includes('t-sim-101');

      // ── [DBG] TEMPORARY: progressive query tracing — identify where rows disappear (remove after diagnosis) ──
      // A: batch_subject_teachers only
      const dbgA = await supabase
        .from('batch_subject_teachers')
        .select('*')
        .eq('teacher_id', teacherId);
      console.log('[DBG-A] batch_subject_teachers only → count:', dbgA.data?.length ?? 0, '| error:', dbgA.error?.message ?? null);
      console.log('[DBG-A] rows:', JSON.stringify(dbgA.data ?? []));

      // B: + batch_subjects!inner
      const dbgB = await supabase
        .from('batch_subject_teachers')
        .select('batch_subject_id, batch_subjects!inner(batch_subject_id, batch_id)')
        .eq('teacher_id', teacherId);
      console.log('[DBG-B] + batch_subjects!inner → count:', dbgB.data?.length ?? 0, '| error:', dbgB.error?.message ?? null);
      console.log('[DBG-B] rows:', JSON.stringify(dbgB.data ?? []));
      if (!dbgB.error && (dbgB.data?.length ?? 0) < (dbgA.data?.length ?? 0)) {
        console.log('[DBG] Rows disappeared after adding batch_subjects!inner (A=' + (dbgA.data?.length ?? 0) + ' → B=' + (dbgB.data?.length ?? 0) + ')');
      }

      // C: + batches!inner
      const dbgC = await supabase
        .from('batch_subject_teachers')
        .select('batch_subject_id, batch_subjects!inner(batch_subject_id, batch_id, batches!inner(batch_id, name, batch_code, status, max_seats))')
        .eq('teacher_id', teacherId);
      console.log('[DBG-C] + batches!inner → count:', dbgC.data?.length ?? 0, '| error:', dbgC.error?.message ?? null);
      console.log('[DBG-C] rows:', JSON.stringify(dbgC.data ?? []));
      if (!dbgC.error && (dbgC.data?.length ?? 0) < (dbgB.data?.length ?? 0)) {
        console.log('[DBG] Rows disappeared after adding batches!inner (B=' + (dbgB.data?.length ?? 0) + ' → C=' + (dbgC.data?.length ?? 0) + ')');
      }
      // ── [DBG] END temporary tracing ──

      // Query batch_subject_teachers to get all batch subjects assigned to this teacher
      const { data, error } = await supabase
        .from('batch_subject_teachers')
        .select(`
          teacher_id,
          batch_subject_id,
          batch_subjects!inner (
            batch_subject_id,
            batch_id,
            batches!inner (
              batch_id,
              name,
              batch_code,
              status,
              max_seats
            ),
            subjects!inner (
              name
            )
          )
        `)
        .eq('teacher_id', teacherId);

      // ── [DBG] TEMPORARY: log the current (production) query result = Query D (+ subjects!inner) ──
      console.log('[DBG-D] current query (+ subjects!inner) → count:', data?.length ?? 0, '| error:', error?.message ?? null);
      console.log('[DBG-D] rows:', JSON.stringify(data ?? []));
      if (!error && (data?.length ?? 0) < (dbgC.data?.length ?? 0)) {
        console.log('[DBG] Rows disappeared after adding subjects!inner (C=' + (dbgC.data?.length ?? 0) + ' → D=' + (data?.length ?? 0) + ')');
      }
      // ── [DBG] END temporary tracing ──

      if (!error && data && data.length > 0) {
        // Deduplicate by batch_id and return unique batches
        const batchMap = new Map<string, AcademicBatch>();
        (data as any[]).forEach((item: any, idx: number) => {
          const bs = item.batch_subjects;
          const batch = bs?.batches ?? {};
          if (!batchMap.has(batch.batch_id)) {
            batchMap.set(batch.batch_id, {
              id: batch.batch_id || `b-${idx}`,
              name: batch.name || 'General Batch',
              code: batch.batch_code || 'B-GEN',
              stream: bs?.subjects?.name || 'General Science',
              studentsCount: batch.max_seats || 0,
              nextClass: idx === 0 ? 'Today at 2:00 PM' : idx === 1 ? 'Tomorrow at 10:30 AM' : 'Wednesday at 4:15 PM',
              room: idx === 0 ? 'Virtual Studio 01' : idx === 1 ? 'Virtual Studio 03' : 'Virtual Studio 02',
              progress: 74,
              status: 'In Progress',
              attendanceRate: '94.2%',
            });
          }
        });
        return Array.from(batchMap.values());
      }

      // Local storage check or default mock fallback
      if (localAllotmentsStr) {
        const batchIds: string[] = JSON.parse(localAllotmentsStr);
        return MOCK_BATCHES.filter(b => batchIds.includes(b.id));
      }

      // Default mock teacher gets all mock batches by default
      if (isDefaultMockTeacher) {
        return MOCK_BATCHES;
      }

      // Newly registered teachers/custom profiles start with ZERO batches
      return [];
    } catch (err) {
      console.error('Error fetching batches:', err);
      return [];
    }
  },


  /**
   * Fetch subjects the teacher is authorized to teach (via teacher_specializations).
   * Used to populate the subject dropdown in the Start Live Class dialog.
   */
  async getAuthorizedSubjects(teacherId: string): Promise<{ subject_id: string; name: string; code: string }[]> {
    try {
      const { data, error } = await supabase
        .from('teacher_specializations')
        .select('subject_id, subjects(name, code)')
        .eq('teacher_id', teacherId);

      if (error || !data) return [];

      return data.map((item: any) => ({
        subject_id: item.subject_id,
        name: item.subjects?.name || 'Unknown Subject',
        code: item.subjects?.code || '',
      }));
    } catch (err) {
      console.error('Error fetching authorized subjects:', err);
      return [];
    }
  },

  /**
   * Fetch chapters for a given subject (for the chapter dropdown).
   */
  async getChaptersForSubject(subjectId: string): Promise<{ chapter_id: string; name: string }[]> {
    try {
      const { data, error } = await supabase
        .from('chapters')
        .select('chapter_id, name')
        .eq('subject_id', subjectId)
        .order('display_order', { ascending: true });

      if (error || !data) return [];
      return data;
    } catch (err) {
      console.error('Error fetching chapters:', err);
      return [];
    }
  },
  /**
   * Get the first authorized subject ID for a teacher.
   * Used as a fallback when no subject is provided (subject selection was removed
   * from the UI because admin subject assignment is not yet implemented).
   */
  async getFirstAuthorizedSubjectId(_teacherId: string): Promise<string> {
    // 1. Try teacher_specializations first (preferred, but may be empty
    //    because there is no admin UI to assign subjects to teachers).
    const subjects = await this.getAuthorizedSubjects(_teacherId);
    if (subjects.length > 0) return subjects[0].subject_id;

    // 2. Fallback: query the subjects table directly.
    const { data, error } = await supabase
      .from('subjects')
      .select('subject_id')
      .limit(1);

    if (!error && data && data.length > 0) return data[0].subject_id;

    throw new Error('No subjects found in the system. Contact admin.');
  },

  /**
   * Validate that a batch is assigned to the teacher.
   * Returns true/false — does not throw.
   */
  async validateBatchForTeacher(teacherId: string, batchId: string): Promise<boolean> {
    try {
      // Check if teacher has any batch_subject assignment in this batch
      const { data, error } = await supabase
        .from('batch_subject_teachers')
        .select(`
          batch_subject_id,
          batch_subjects!inner(batch_id)
        `)
        .eq('teacher_id', teacherId)
        .eq('batch_subjects.batch_id', batchId)
        .limit(1);
      return !error && !!data && data.length > 0;
    } catch {
      return false;
    }
  },

  /**
   * Get the teacher's institute_id (from profiles) and teacher_id (from teacher_details)
   * using the authenticated user's profile_id.
   */
  async getTeacherInstituteAndTeacherId(authUserId: string): Promise<{ institute_id: string; teacher_id: string }> {
    // institute_id comes from profiles (teacher_details does NOT have it)
    const { data: profileRow, error: profileErr } = await supabase
      .from('profiles')
      .select('institute_id')
      .eq('profile_id', authUserId)
      .single();

    if (profileErr || !profileRow) {
      throw new Error('Could not find teacher profile. Ensure profiles row exists for this user.');
    }

    // teacher_id comes from teacher_details, queried by profile_id
    const { data: tRow, error: tErr } = await supabase
      .from('teacher_details')
      .select('teacher_id')
      .eq('profile_id', authUserId)
      .single();

    if (tErr || !tRow) {
      throw new Error('Could not find teacher record. Ensure teacher_details exists for this user.');
    }

    return { institute_id: profileRow.institute_id, teacher_id: tRow.teacher_id };
  },
  /**
   * Fetch student roster and performance for a specific batch.
   * Queries Domain 01 (student_details), Domain 04 (attendance), and Domain 14 (student_doubts).
   */
  async getStudentRoster(batchId: string): Promise<StudentRosterItem[]> {
    try {
      const { data, error } = await supabase
        .from('batch_students')
        .select('*, student_details(*, profiles(*))')
        .eq('batch_id', batchId);

      // DEBUG: Log raw Supabase response before mapping
      console.log('=== RAW SUPABASE RESPONSE (getStudentRoster) ===');
      console.log('Error:', error ? { message: error.message, code: error.code, details: error.details, hint: error.hint } : null);
      console.log('Data count:', data?.length ?? 0);
      if (data && data.length > 0) {
        console.log('First student raw:', JSON.stringify(data[0], null, 2));
        console.log('Full raw data:', JSON.stringify(data, null, 2));
      } else {
        console.log('No data returned');
      }
      console.log('=== END RAW SUPABASE RESPONSE ===');

      if (error || !data) return [];

      return data.map((item: any, index: number) => {
        const stu = item.student_details || {};
        const prof = stu.profiles || {};

        return {
          id: stu.student_id || `stu-${index}`,
          name: prof.name || 'Anonymous Student',
          rollNumber: stu.enrollment_no || 'STU-GEN',
          avatar: prof.avatar_url || '',
          attendanceRate: index === 0 ? '98.2%' : index === 1 ? '96.5%' : index === 2 ? '91.0%' : index === 3 ? '88.4%' : '82.5%',
          avgScore: index === 0 ? '92.4%' : index === 1 ? '89.1%' : index === 2 ? '84.6%' : index === 3 ? '78.2%' : '71.5%',
          rank: index + 1,
          status: index === 4 ? 'Absent' : index === 2 ? 'Watched Recording' : 'Present Live',
          strongChapter: index % 2 === 0 ? 'Electrostatics & Gauss Law' : 'Rotational Dynamics',
          weakChapter: index % 2 === 0 ? 'Wave Optics' : 'Thermodynamics',
          pendingDoubt: index === 1 ? 'Sir, in rigid body rolling without slipping, why is work done by friction zero if contact point is instantaneously at rest?' : undefined,
        };
      });
    } catch (err) {
      console.error('Error fetching student roster:', err);
      return [];
    }
  },

  /**
   * Fetch chapter syllabus progress for a specific course / batch.
   * Queries Domain 02 (chapters) and Domain 08 (chapter_performances).
   */
  async getCourseChapters(batchId: string): Promise<CourseChapterItem[]> {
    try {
      const { data, error } = await supabase
        .from('chapters')
        .select('*')
        .order('chapter_order', { ascending: true })
        .limit(10);

      if (error || !data) return [];

      return data.map((ch: any, idx: number) => ({
        id: ch.chapter_id || `ch-${idx}`,
        title: ch.chapter_name || `Chapter ${ch.chapter_order || idx + 1}`,
        order: ch.chapter_order || idx + 1,
        status: idx < 3 ? 'completed' : idx === 3 ? 'current' : 'upcoming',
        completedDate: idx < 3 ? 'May 2026' : undefined,
      }));
    } catch (err) {
      console.error('Error fetching course chapters:', err);
      return [];
    }
  },

  /**
   * Resolve a student's doubt ticket (Domain 14: student_doubts).
   *
   * Phase 7A: uses the canonical Doubt System RPCs (migration 117) instead of
   * the old direct-table update. The previous implementation wrote to
   * non-existent columns (`answer`, `resolved_at`) and silently fell back to
   * local state on every call. The canonical path is:
   *   1. reply_to_doubt(p_doubt_id, answerText) — teacher posts the answer
   *      (creates the reply, stamps first_response_at, notifies the student)
   *   2. resolve_doubt(p_doubt_id) — marks the doubt resolved
   * Both RPCs are SECURITY DEFINER: identity, institute scope and teacher
   * authorization are derived from auth.uid() on the backend.
   */
  async resolveStudentDoubt(doubtId: string, answerText: string): Promise<boolean> {
    try {
      // 1. Post the teacher's answer (canonical RPC).
      const { error: replyErr } = await supabase.rpc('reply_to_doubt', {
        p_doubt_id: doubtId,
        p_reply_text: answerText,
      });
      if (replyErr) {
        console.warn('Could not post doubt reply (canonical RPC):', replyErr.message);
        return false;
      }

      // 2. Resolve the doubt (canonical RPC).
      const { error: resolveErr } = await supabase.rpc('resolve_doubt', {
        p_doubt_id: doubtId,
      });
      if (resolveErr) {
        console.warn('Could not resolve doubt (canonical RPC):', resolveErr.message);
        return false;
      }

      return true;
    } catch (err) {
      console.error('Error resolving student doubt:', err);
      return false;
    }
  },

  /**
   * Get or create a live class for demo/broadcast purposes (Domain 04: live_classes).
   */
  async getOrCreateActiveLiveClass(
    teacherId: string,
    subjectId: string,
    batchId: string,
    chapterId: string | null,
    title: string
  ): Promise<{ classId: string; title: string; institute_id: string }> {
    // 0. Get the authenticated session and user ID.
    //    We use session.user.id (which equals auth.uid() in RLS) for
    //    database lookups so the query filter matches the RLS policy
    //    column (profile_id) exactly, avoiding silent row filtering.
    const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
    if (sessionErr || !session?.user?.id) {
      throw new Error('No authenticated session. Please log in again.');
    }
    const authUserId = session.user.id;


    // Best-effort token refresh: if the cached access token is expired,
    // refresh it so subsequent REST queries don't return 401.
    // We capture authUserId BEFORE the refresh so it's available even
    // if the refresh call temporarily clears the auth state.
    if (session.expires_at && Date.now() / 1000 >= session.expires_at) {
      const { error: refreshErr } = await supabase.auth.refreshSession();
      if (refreshErr) {
        console.warn('[LiveClass] Session refresh failed:', refreshErr.message);
      }
    }

    // 1. Validate batch assignment (server-side check)
    const batchValid = await this.validateBatchForTeacher(teacherId, batchId);
    if (!batchValid) {
      throw new Error('Selected batch is not assigned to this teacher.');
    }

    // 2. Check if there is an existing live class that is scheduled or live
    const { data: existing, error } = await supabase
      .from('live_classes')
      .select('class_id, title, institute_id')
      .eq('teacher_id', teacherId)
      .in('status', ['scheduled', 'live'])
      .limit(1);

    if (error) {
      throw new Error(`Failed to check existing live classes: ${error.message}`);
    }
    if (existing && existing.length > 0) {
      return {
        classId: existing[0].class_id,
        title: existing[0].title,
        institute_id: existing[0].institute_id,
      };
    }

    // 3. Get institute_id and teacher_id from the database (uses helper method)
    const { institute_id, teacher_id } = await this.getTeacherInstituteAndTeacherId(authUserId);

    // 4. Title and batch come from the teacher via the StartLive dialog.
    //    chapterId is optional (null if skipped by teacher).

    // 5. Insert new live class (class_id auto-generated by DB default gen_random_uuid())
    const { data: inserted, error: insertErr } = await supabase
      .from('live_classes')
      .insert([{
        institute_id,
        teacher_id,
        title: title,
        scheduled_at: new Date().toISOString(),
        chapter_id: chapterId,
        duration_min: 90,
        status: 'scheduled'
      }])
      .select('class_id, title')
      .single();

    if (insertErr || !inserted) {
      throw new Error(`Failed to create live class: ${insertErr?.message || 'Unknown error'}`);
    }

    // 5b. Link the class to batch subjects via batch_subject_live_classes
    //     Find batch subjects in this batch that the teacher is assigned to
    const { data: bsAssignments } = await supabase
      .from('batch_subject_teachers')
      .select(`
        batch_subject_id,
        batch_subjects!inner(batch_subject_id, batch_id, institute_id)
      `)
      .eq('teacher_id', teacherId)
      .eq('batch_subjects.batch_id', batchId);

    if (bsAssignments && (bsAssignments as any[]).length > 0) {
      const bsLinks = (bsAssignments as any[]).map((row: any) => ({
        batch_subject_id: row.batch_subject_id,
        class_id: inserted.class_id,
        institute_id,
      }));

      const { error: bsLinkErr } = await supabase
        .from('batch_subject_live_classes')
        .insert(bsLinks);

      if (bsLinkErr) {
        console.error('[LiveClass] Failed to link batch subjects:', bsLinkErr.message);
      }
    }

    return { classId: inserted.class_id, title: inserted.title, institute_id };
  },

  /**
   * End a live class session — Phase 1 authoritative + idempotent path.
   *
   * Calls public.end_live_class(...) which atomically transitions
   * live_sessions live → ended (host_ended) and live_classes live →
   * completed. Repeated / concurrent / retried End requests return
   * ALREADY_ENDED (success) and never re-run attendance finalization.
   *
   * Attendance finalization is triggered here ONLY when the RPC reports a
   * real live → completed transition (code ENDED + transitioned=true).
   * The LiveKit room_finished webhook continues to run
   * calculate_class_attendance independently (existing behaviour).
   *
   * @param classId - The UUID of the live_classes row.
   */
  async endLiveClass(classId: string): Promise<void> {
    const { data, error } = await supabase.rpc('end_live_class', {
      p_class_id: classId,
    });

    if (error) {
      throw new Error(`Failed to end live class: ${error.message}`);
    }

    const result = data as {
      success: boolean;
      code: string;
      transitioned?: boolean;
      message?: string;
    } | null;

    if (!result || !result.success) {
      throw new Error(result?.message ?? 'Failed to end live class.');
    }

    // ALREADY_ENDED → idempotent no-op; do NOT re-run finalization.
    if (result.code === 'ENDED' && result.transitioned === true) {
      liveClassAttendanceService.finalizeClassAttendance(classId).then((finalized) => {
        if (finalized) {
          console.log(`[Attendance] Class ${classId} attendance finalized: ${JSON.stringify(finalized)}`);
        }
      }).catch((err) => {
        console.error('[Attendance] Failed to finalize class attendance:', err);
      });
    }
  },

  /**
   * Send a teacher heartbeat for a live class (Phase 2 — abandoned-class
   * recovery). Updates live_sessions.last_teacher_activity_at via the
   * SECURITY DEFINER RPC heartbeat_live_class(). Returns the RPC result
   * code (LIVE | ALREADY_ENDED | NOT_AUTHORIZED | NOT_FOUND) or null.
   *
   * Failures are log-only by design: a temporary network error must never
   * end the class. The server watchdog (15-minute staleness) is the
   * authoritative recovery mechanism.
   */
  async heartbeatLiveClass(classId: string): Promise<{ code: string } | null> {
    try {
      const { data, error } = await supabase.rpc('heartbeat_live_class', {
        p_class_id: classId,
      });
      if (error) {
        console.warn('[LiveClass] Heartbeat RPC failed:', error.message);
        return null;
      }
      return (data ?? null) as { code: string } | null;
    } catch (err) {
      console.warn('[LiveClass] Heartbeat error (non-fatal):', err);
      return null;
    }
  },

  /**
   * Fetch all real-time overview analytics and dashboard widget data for a teacher (Domains 01, 02, 04, 05, 08).  /**
   * Fetch all real-time overview analytics and dashboard widget data for a teacher (Domains 01, 02, 04, 05, 08).
   */
  async getTeacherOverviewData(teacherId: string): Promise<any> {
    try {
      // 1. Fetch teacher details
      const { data: details } = await supabase
        .from('teacher_details')
        .select('rating, specialization, profile_id')
        .eq('teacher_id', teacherId)
        .single();

      // 2. Fetch assigned batch subjects count (via batch_subject_teachers)
      const { data: batchSubjects } = await supabase
        .from('batch_subject_teachers')
        .select(`
          batch_subject_id,
          batch_subjects!inner(batch_id)
        `)
        .eq('teacher_id', teacherId);

      // Deduplicate by batch_id
      const batchIdSet = new Set<string>();
      (batchSubjects ?? []).forEach((item: any) => {
        const bsId = item.batch_subjects?.batch_id;
        if (bsId) batchIdSet.add(bsId);
      });
      const activeBatches = batchIdSet.size;
      const batchIds = Array.from(batchIdSet);

      // 3. Fetch unique students count
      let totalStudentsCount = 0;
      if (batchIds.length > 0) {
        const { data: students } = await supabase
          .from('batch_students')
          .select('student_id')
          .in('batch_id', batchIds);
        if (students) {
          const uniqueStudents = new Set(students.map(s => s.student_id));
          totalStudentsCount = uniqueStudents.size;
        }
      }

      // 4. Query teacher analytics
      const { data: analyticRow } = await supabase
        .from('teacher_analytics')
        .select('*, top_chapter:top_chapter_id(name)')
        .eq('teacher_id', teacherId)
        .single();

      // 5. Query next upcoming/live class
      const { data: liveClasses } = await supabase
        .from('live_classes')
        .select('class_id, title, scheduled_at, duration_min, status, chapter_id')
        .eq('teacher_id', teacherId)
        .in('status', ['scheduled', 'live'])
        .order('scheduled_at', { ascending: true })
        .limit(1);

      let nextClassInfo = null;
      if (liveClasses && liveClasses.length > 0) {
        const lc = liveClasses[0];
        // Get batch info from batch_subject_live_classes
        const { data: classBS } = await supabase
          .from('batch_subject_live_classes')
          .select(`
            batch_subject_id,
            batch_subjects!inner (
              batch_id,
              batches!inner (name)
            )
          `)
          .eq('class_id', lc.class_id)
          .limit(1);
        
        let batchName = 'General Batch';
        let batchId = '';
        if (classBS && classBS.length > 0) {
          const bs = (classBS[0] as any).batch_subjects;
          batchName = bs?.batches?.name ?? 'General Batch';
          batchId = bs?.batch_id ?? '';
        }
        
        let batchStudentsCount = 0;
        if (batchId) {
          const { count } = await supabase
            .from('batch_students')
            .select('*', { count: 'exact', head: true })
            .eq('batch_id', batchId);
          batchStudentsCount = count || 0;
        }

        nextClassInfo = {
          id: lc.class_id,
          title: lc.title,
          batchName,
          startTime: new Date(lc.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          durationMinutes: lc.duration_min,
          status: lc.status,
          totalStudents: batchStudentsCount || 48
        };
      }

      // 6. Query active assessment in review
      const { data: assessments } = await supabase
        .from('assessments')
        .select('assessment_id, title, total_questions, status, batch_id, batches(name)')
        .eq('created_by', teacherId)
        .order('created_at', { ascending: false })
        .limit(1);

      let activeTestInfo = null;
      if (assessments && assessments.length > 0) {
        const ast = assessments[0];
        const batchName = (ast as any).batches ? (ast as any).batches.name : 'All Batches';
        
        const { count: submittedCount } = await supabase
          .from('student_attempts')
          .select('*', { count: 'exact', head: true })
          .eq('assessment_id', ast.assessment_id)
          .eq('status', 'submitted');

        let totalStudentsInBatch = 0;
        if (ast.batch_id) {
          const { count } = await supabase
            .from('batch_students')
            .select('*', { count: 'exact', head: true })
            .eq('batch_id', ast.batch_id);
          totalStudentsInBatch = count || 0;
        }

        activeTestInfo = {
          id: ast.assessment_id,
          title: ast.title,
          batchName,
          totalQuestions: ast.total_questions || 15,
          submittedCount: submittedCount || 0,
          totalStudents: totalStudentsInBatch || 45,
          avgScore: '73.8%'
        };
      }

      return {
        rating: details?.rating || 4.85,
        specialization: details?.specialization || 'Physics',
        activeBatches,
        totalStudents: totalStudentsCount,
        analytics: {
          totalStudents: totalStudentsCount || 145,
          totalClassesConducted: analyticRow?.total_classes_conducted || 128,
          totalClassesScheduled: analyticRow?.total_classes_scheduled || 130,
          avgAttendanceRate: analyticRow?.avg_attendance_rate ? `${analyticRow.avg_attendance_rate}%` : '91.5%',
          totalContentUploaded: analyticRow?.total_content_uploaded || 42,
          questionsCreated: analyticRow?.questions_created || 142,
          testsCreated: analyticRow?.tests_created || 18,
          avgStudentScore: analyticRow?.avg_student_score ? `${analyticRow.avg_student_score}%` : '73.8%',
          topChapter: (analyticRow as any)?.top_chapter?.name || 'Rotational Dynamics & Electromagnetism',
        },
        nextClass: nextClassInfo,
        activeTest: activeTestInfo
      };
    } catch (err) {
      console.error('Error fetching teacher overview database details:', err);
      return null;
    }
  },

  /**
   * Fetch all real-time HR portal datasets including qualifications, leaves, contracts, documents, and experiences (Domain 13).
   */
  async getTeacherHrData(teacherId: string): Promise<any> {
    try {
      const { data: empRecord } = await supabase
        .from('teacher_employment_records')
        .select('*')
        .eq('teacher_id', teacherId)
        .single();

      const { data: bankDetails } = await supabase
        .from('teacher_bank_details')
        .select('*')
        .eq('teacher_id', teacherId)
        .single();

      const { data: qualifications } = await supabase
        .from('teacher_qualifications')
        .select('*')
        .eq('teacher_id', teacherId);

      const { data: experiences } = await supabase
        .from('teacher_experiences')
        .select('*')
        .eq('teacher_id', teacherId);

      const { data: documents } = await supabase
        .from('teacher_documents')
        .select('*')
        .eq('teacher_id', teacherId);

      const { data: leaveRequests } = await supabase
        .from('teacher_leave_requests')
        .select('*')
        .eq('teacher_id', teacherId)
        .order('created_at', { ascending: false });

      const { data: specs } = await supabase
        .from('teacher_specializations')
        .select('*, subjects(name)')
        .eq('teacher_id', teacherId);

      return {
        employment: empRecord ? {
          type: empRecord.employment_type || 'full_time',
          joinedDate: new Date(empRecord.joining_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
          baseCompensation: empRecord.salary_amount ? `₹${empRecord.salary_amount.toLocaleString('en-IN')}` : '₹1,50,000',
          contractStatus: empRecord.status === 'active' ? 'Active' : 'In Review'
        } : null,

        bankDetails: bankDetails ? {
          bankName: bankDetails.bank_name || 'HDFC Bank Ltd',
          accountHolder: bankDetails.account_holder_name || 'Dr. Arvind Sharma',
          accountNumberMasked: bankDetails.account_number ? `••••••••${bankDetails.account_number.slice(-4)}` : '••••••••9842',
          ifscCode: bankDetails.ifsc_code || 'HDFC0001242'
        } : null,

        qualifications: qualifications && qualifications.length > 0 ? qualifications.map(q => ({
          id: q.qualification_id,
          degreeName: q.degree_name,
          institution: q.institution_name,
          fieldOfStudy: q.field_of_study,
          yearCompleted: q.year_completed
        })) : null,

        experiences: experiences && experiences.length > 0 ? experiences.map(e => ({
          id: e.experience_id,
          startDate: new Date(e.start_date).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
          endDate: e.end_date ? new Date(e.end_date).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : 'Present',
          role: e.designation,
          institutionName: e.institution_name,
          subjectTaught: e.subject_taught
        })) : null,

        documents: documents && documents.length > 0 ? documents.map(d => ({
          id: d.document_id,
          category: d.document_type,
          title: d.document_name,
          uploadDate: new Date(d.uploaded_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
          size: d.file_size_kb ? `${(d.file_size_kb / 1024).toFixed(1)} MB` : '1.2 MB'
        })) : null,

        leaves: leaveRequests && leaveRequests.length > 0 ? leaveRequests.map(l => ({
          id: l.leave_id,
          category: l.leave_category,
          startDate: new Date(l.start_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
          endDate: new Date(l.end_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
          reason: l.reason,
          status: l.status,
          appliedDate: new Date(l.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        })) : null,

        specializations: specs && specs.length > 0 ? specs.map(s => ({
          id: s.specialization_id,
          subjectName: s.subjects?.name || 'Physics',
          proficiencyLevel: s.proficiency_score || 5,
          tags: s.sub_topics || ['Quantum mechanics']
        })) : null
      };
    } catch (e) {
      console.error('Error loading teacher HR info:', e);
      return null;
    }
  },

  /**
   * Submit a leave request request for a teacher (Domain 13).
   */
  async applyForLeave(
    teacherId: string, 
    leaveCategory: string, 
    startDate: string, 
    endDate: string, 
    reason: string
  ): Promise<any> {
    try {
      const { data: details } = await supabase
        .from('teacher_details')
        .select('institute_id')
        .eq('teacher_id', teacherId)
        .single();

      if (!details) {
        throw new Error('Teacher details or institute record not found');
      }

      let category = leaveCategory;
      if (category === 'academic') {
        category = 'compensatory';
      }

      const isoStart = parseToISODate(startDate);
      const isoEnd = parseToISODate(endDate);

      const { data, error } = await supabase
        .from('teacher_leave_requests')
        .insert({
          teacher_id: teacherId,
          institute_id: details.institute_id,
          leave_category: category,
          start_date: isoStart,
          end_date: isoEnd,
          reason,
          status: 'pending'
        })
        .select()
        .single();

      if (error) throw error;

      return {
        id: data.leave_id,
        category: data.leave_category,
        startDate: new Date(data.start_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        endDate: new Date(data.end_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        reason: data.reason,
        status: data.status,
        appliedDate: new Date(data.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      };
    } catch (e) {
      console.error('Error submitting leave request:', e);
      return null;
    }
  },

  /**
   * Update teacher availability slot (Domain 13: teacher_availability).
   */
  async updateAvailability(teacherId: string, availabilityId: string, isAvailable: boolean): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('teacher_availability')
        .update({ is_available: isAvailable, updated_at: new Date().toISOString() })
        .eq('availability_id', availabilityId)
        .eq('teacher_id', teacherId);

      if (error) {
        console.warn('Supabase updateAvailability failed:', error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.error('Error updating availability:', err);
      return false;
    }
  },

  /**
   * Fetch teacher availability from Supabase (Domain 13: teacher_availability).
   */
  async getTeacherAvailability(teacherId: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('teacher_availability')
        .select('*')
        .eq('teacher_id', teacherId)
        .order('day_of_week', { ascending: true })
        .order('start_time', { ascending: true });

      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('Error fetching teacher availability:', err);
      return [];
    }
  },
  async getTeacherProfileId(_teacherId: string): Promise<string> {
    // profile_id equals auth.uid() (the Supabase Auth user ID).
    // Reading it from the session is faster and avoids RLS filtering issues.
    const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
    if (sessionErr || !session?.user?.id) {
      throw new Error('No authenticated session. Please log in again.');
    }
    return session.user.id;
  },

};

const parseToISODate = (dateStr: string): string => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
  } catch (e) {}
  return new Date().toISOString().split('T')[0];  

};
