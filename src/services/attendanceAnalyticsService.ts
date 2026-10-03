/**
 * Attendance Analytics Service
 *
 * Provides read-only attendance analytics queries for the Teacher and Admin
 * Attendance dashboards. All queries use the existing tables:
 *   - attendance
 *   - attendance_events
 *   - live_classes
 *   - live_sessions
 *   - batch_subject_live_classes
 *   - batch_students
 *   - batches
 *   - batch_subject_teachers
 *   - student_details
 *   - teacher_details
 *   - profiles
 *
 * IMPORTANT: This module is strictly read-only. Attendance is system-generated
 * from LiveKit sessions. No manual editing is allowed.
 *
 * @module services/attendanceAnalyticsService
 */

import { supabase } from '@/config/supabase';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface TeacherAttendanceSummary {
  totalStudents: number;
  totalLiveClasses: number;
  averageAttendancePercent: number;
  todayAttendancePercent: number;
}

export interface TeacherAttendanceRecord {
  studentId: string;
  studentName: string;
  batchName: string;
  attendancePercent: number;
  presentCount: number;
  partialCount: number;
  absentCount: number;
  lastAttended: string | null;
}

export interface StudentAttendanceHistoryItem {
  date: string;
  classTitle: string;
  durationMinutes: number;
  attendancePercent: number;
  attendanceStatus: string;
  classId: string;
}

export interface StudentAttendanceDetail {
  studentId: string;
  studentName: string;
  batchName: string;
  overallAttendancePercent: number;
  history: StudentAttendanceHistoryItem[];
}

export interface BatchAttendanceSummary {
  batchId: string;
  batchName: string;
  studentCount: number;
  averageAttendancePercent: number;
  presentCount: number;
  partialCount: number;
  absentCount: number;
}

export interface LiveClassAttendanceFilter {
  dateFrom?: string;
  dateTo?: string;
  teacherId?: string;
  batchId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface AdminLiveClassAttendanceItem {
  classId: string;
  date: string;
  durationMin?: number | null;
  title: string;
  teacherId: string;
  teacherName: string;
  batchName: string;
  totalStudents: number;
  presentCount: number;
  partialCount: number;
  absentCount: number;
}

export interface PaginatedAdminLiveClassAttendanceResult {
  classes: AdminLiveClassAttendanceItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface LiveClassAttendanceSummary {
  classId: string;
  date: string;
  /** Scheduled class duration in minutes (live_classes.duration_min). */
  durationMin?: number | null;
  title: string;
  totalStudents: number;
  presentCount: number;
  partialCount: number;
  absentCount: number;
}

export interface AdminAttendanceSummary {
  totalStudents: number;
  totalLiveClasses: number;
  overallAttendancePercent: number;
  studentsBelowThreshold: number;
}

export interface TeacherAssignedClassDetail {
  classId: string;
  title: string;
  scheduledAt: string;
  durationMin?: number | null;
  batchName: string;
  status: 'Taken' | 'Not Taken';
  rawStatus: string;
}

export interface AdminTeacherBatchItem {
  batchId: string;
  batchName: string;
  classesAssigned: number;
  classesTaken: number;
  classesNotTaken: number;
}

export interface AdminTeacherBatchClassItem {
  classId: string;
  title: string;
  scheduledAt: string;
  durationMin?: number | null;
  status: 'Taken' | 'Not Taken';
  rawStatus: string;
}

export interface AdminTeacherBatchClassesResult {
  classes: AdminTeacherBatchClassItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AdminTeacherAttendanceRow {
  teacherId: string;
  teacherName: string;
  batchCount: number;
  classesAssigned: number;
  classesTaken: number;
  averageAttendancePercent: number;
  classes?: TeacherAssignedClassDetail[];
}

export interface AdminStudentAttendanceDetail {
  studentId: string;
  studentName: string;
  batchName: string;
  overallAttendancePercent: number;
  presentClasses: number;
  partialClasses: number;
  absentClasses: number;
  history: StudentAttendanceHistoryItem[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const ATTENDANCE_THRESHOLD = 75; // percentage

// ═══════════════════════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════════════════════

export const attendanceAnalyticsService = {
  // ════════════════════════════════════════════════════════════════════════
  //  Teacher: Summary Cards
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Get attendance summary cards for a teacher.
   */
  async getTeacherSummary(teacherId: string): Promise<TeacherAttendanceSummary> {
    try {
      // 1. Get teacher's batch IDs via batch_subject_teachers
      const { data: bsTeachers } = await supabase
        .from('batch_subject_teachers')
        .select(`
          batch_subject_id,
          batch_subjects!inner(batch_id)
        `)
        .eq('teacher_id', teacherId);

      // Deduplicate by batch_id
      const batchIdSet = new Set<string>();
      (bsTeachers ?? []).forEach((item: any) => {
        const bid = item.batch_subjects?.batch_id;
        if (bid) batchIdSet.add(bid);
      });
      const batchIds = Array.from(batchIdSet);

      // 2. Total students across all batches
      let totalStudents = 0;
      let totalLiveClasses = 0;
      let avgAttendancePercent = 0;
      let todayAttendancePercent = 0;

      if (batchIds.length > 0) {
        // Total students (deduplicated)
        const { data: batchStudents } = await supabase
          .from('batch_students')
          .select('student_id')
          .in('batch_id', batchIds);

        const uniqueStudents = new Set((batchStudents ?? []).map((s: any) => s.student_id));
        totalStudents = uniqueStudents.size;

        // 3. Teacher's completed live classes
        const { data: liveClasses } = await supabase
          .from('live_classes')
          .select('class_id, scheduled_at')
          .eq('teacher_id', teacherId)
          .eq('status', 'completed');

        totalLiveClasses = liveClasses?.length ?? 0;
        const classIds = (liveClasses ?? []).map((c: any) => c.class_id);

        if (classIds.length > 0 && totalStudents > 0) {
          // 4. Average attendance percentage across all completed classes
          const { data: attendanceRecords } = await supabase
            .from('attendance')
            .select('student_id, attendance_status')
            .in('class_id', classIds);

          const totalRecords = attendanceRecords?.length ?? 0;
          if (totalRecords > 0) {
            const presentCount = attendanceRecords!.filter(
              (a: any) => a.attendance_status === 'present'
            ).length;
            const partialCount = attendanceRecords!.filter(
              (a: any) => a.attendance_status === 'partial'
            ).length;
            const weightedSum = presentCount * 100 + partialCount * 50;
            avgAttendancePercent = Math.round(weightedSum / totalRecords);
          }

          // 5. Today's attendance
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          const todayEnd = new Date();
          todayEnd.setHours(23, 59, 59, 999);

          const todaysClasses = (liveClasses ?? []).filter((c: any) => {
            const d = new Date(c.scheduled_at);
            return d >= todayStart && d <= todayEnd;
          });
          const todayClassIds = todaysClasses.map((c: any) => c.class_id);

          if (todayClassIds.length > 0) {
            const { data: todayAttendance } = await supabase
              .from('attendance')
              .select('student_id, attendance_status')
              .in('class_id', todayClassIds);

            const todayRecords = todayAttendance?.length ?? 0;
            if (todayRecords > 0) {
              const todayPresent = todayAttendance!.filter(
                (a: any) => a.attendance_status === 'present'
              ).length;
              const todayPartial = todayAttendance!.filter(
                (a: any) => a.attendance_status === 'partial'
              ).length;
              todayAttendancePercent = Math.round(
                ((todayPresent * 100 + todayPartial * 50) / todayRecords)
              );
            }
          }
        }
      }

      return {
        totalStudents,
        totalLiveClasses,
        averageAttendancePercent: avgAttendancePercent,
        todayAttendancePercent,
      };
    } catch (err) {
      console.error('[AttendanceAnalytics] getTeacherSummary error:', err);
      return { totalStudents: 0, totalLiveClasses: 0, averageAttendancePercent: 0, todayAttendancePercent: 0 };
    }
  },

  // ════════════════════════════════════════════════════════════════════════
  //  Teacher: Batch List (for filter dropdown)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Get list of batches assigned to a teacher (for filter dropdown).
   */
  async getTeacherBatches(teacherId: string): Promise<{ batchId: string; name: string }[]> {
    try {
      const { data } = await supabase
        .from('batch_subject_teachers')
        .select(`
          batch_subject_id,
          batch_subjects!inner(
            batch_id,
            batches!inner(name)
          )
        `)
        .eq('teacher_id', teacherId);

      // Deduplicate by batch_id
      const batchMap = new Map<string, string>();
      (data ?? []).forEach((item: any) => {
        const bs = item.batch_subjects;
        if (bs?.batch_id && !batchMap.has(bs.batch_id)) {
          batchMap.set(bs.batch_id, bs.batches?.name ?? 'Unknown Batch');
        }
      });
      return Array.from(batchMap.entries()).map(([batchId, name]) => ({
        batchId,
        name,
      }));
    } catch {
      return [];
    }
  },

  // ════════════════════════════════════════════════════════════════════════
  //  Teacher: Student Attendance Records Table
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Get attendance records for the teacher's students, with optional filters.
   */
  async getTeacherAttendanceRecords(
    teacherId: string,
    filters: {
      batchId?: string;
      dateFrom?: string;
      dateTo?: string;
      status?: string;
    } = {},
  ): Promise<TeacherAttendanceRecord[]> {
    try {
      // Get teacher's batch IDs
      let batchIds: string[];
      if (filters.batchId) {
        batchIds = [filters.batchId];
      } else {
        const { data: batchTeachers } = await supabase
          .from('batch_subject_teachers')
          .select('batch_subjects!inner(batch_id)')
          .eq('teacher_id', teacherId);
        // Deduplicate by batch_id
        const bsSet = new Set<string>();
        (batchTeachers ?? []).forEach((item: any) => {
          const bid = item.batch_subjects?.batch_id;
          if (bid) bsSet.add(bid);
        });
        batchIds = Array.from(bsSet);
      }

      if (batchIds.length === 0) return [];

      // Get teacher's completed class IDs
      let classQuery = supabase
        .from('live_classes')
        .select('class_id, title, scheduled_at')
        .eq('teacher_id', teacherId)
        .eq('status', 'completed');

      if (filters.dateFrom) {
        classQuery = classQuery.gte('scheduled_at', filters.dateFrom);
      }
      if (filters.dateTo) {
        classQuery = classQuery.lte('scheduled_at', filters.dateTo);
      }

      const { data: liveClasses } = await classQuery;
      const classIds = (liveClasses ?? []).map((c: any) => c.class_id);

      if (classIds.length === 0) return [];

      // Get all students in teacher's batches (deduplicated)
      const { data: batchStudents } = await supabase
        .from('batch_students')
        .select('student_id, batch_id')
        .in('batch_id', batchIds);

      // Deduplicate students (a student might be in multiple batches)
      const studentBatchMap = new Map<string, string>();
      for (const bs of batchStudents ?? []) {
        if (!studentBatchMap.has(bs.student_id)) {
          studentBatchMap.set(bs.student_id, bs.batch_id);
        }
      }

      const studentIds = [...studentBatchMap.keys()];
      if (studentIds.length === 0) return [];

      // Get batch names
      const { data: batches } = await supabase
        .from('batches')
        .select('batch_id, name')
        .in('batch_id', batchIds);

      const batchNameMap = new Map((batches ?? []).map((b: any) => [b.batch_id, b.name]));

      // Get student names
      const { data: studentDetails } = await supabase
        .from('student_details')
        .select('student_id, profiles(name)')
        .in('student_id', studentIds);

      const studentNameMap = new Map(
        (studentDetails ?? []).map((s: any) => [
          s.student_id,
          s.profiles?.name ?? 'Unknown',
        ])
      );

      // Get all attendance records for these students and classes
      let attendanceQuery = supabase
        .from('attendance')
        .select('student_id, class_id, attendance_status')
        .in('class_id', classIds)
        .in('student_id', studentIds);

      const { data: attendanceRecords } = await attendanceQuery;

      // Compute per-student attendance stats
      const studentStats = new Map<
        string,
        { present: number; partial: number; absent: number; lastAttended: string | null }
      >();

      for (const studentId of studentIds) {
        studentStats.set(studentId, { present: 0, partial: 0, absent: 0, lastAttended: null });
      }

      // Link completed classes to batches
      const { data: classBSLinks } = await supabase
        .from('batch_subject_live_classes')
        .select(`
          class_id,
          batch_subjects!inner(batch_id)
        `)
        .in('class_id', classIds);

      const batchCompletedClassesMap = new Map<string, Set<string>>();
      for (const bid of batchIds) {
        batchCompletedClassesMap.set(bid, new Set<string>());
      }
      for (const link of classBSLinks ?? []) {
        const bs = (link as any).batch_subjects;
        const bid = Array.isArray(bs) ? bs[0]?.batch_id : bs?.batch_id;
        if (bid && batchCompletedClassesMap.has(bid)) {
          batchCompletedClassesMap.get(bid)!.add(link.class_id);
        }
      }

      // Build class date map
      const classDateMap = new Map(
        (liveClasses ?? []).map((c: any) => [c.class_id, c.scheduled_at])
      );

      const attendanceMap = new Map<string, string>();
      for (const rec of attendanceRecords ?? []) {
        attendanceMap.set(`${rec.class_id}:${rec.student_id}`, rec.attendance_status);
        const stats = studentStats.get(rec.student_id);
        if (stats && (rec.attendance_status === 'present' || rec.attendance_status === 'partial')) {
          const classDate = classDateMap.get(rec.class_id);
          if (classDate && (!stats.lastAttended || classDate > stats.lastAttended)) {
            stats.lastAttended = classDate;
          }
        }
      }

      // Compute stats per student across all completed classes for their batch
      for (const sid of studentIds) {
        const batchId = studentBatchMap.get(sid);
        const completedClassesForStudent = (batchId ? batchCompletedClassesMap.get(batchId) : null) ?? new Set<string>();
        const stats = studentStats.get(sid)!;

        for (const cid of completedClassesForStudent) {
          const status = attendanceMap.get(`${cid}:${sid}`);
          if (status === 'present') stats.present++;
          else if (status === 'partial') stats.partial++;
          else stats.absent++;
        }
      }

      // Apply status filter if specified
      const filteredStudentIds = filters.status && filters.status !== 'all'
        ? studentIds.filter((sid) => {
            const stats = studentStats.get(sid)!;
            const total = stats.present + stats.partial + stats.absent;
            if (total === 0) return filters.status === 'absent';
            const pct = Math.round(((stats.present * 100 + stats.partial * 50) / total));
            if (filters.status === 'present') return pct >= ATTENDANCE_THRESHOLD;
            if (filters.status === 'partial') return pct >= 25 && pct < ATTENDANCE_THRESHOLD;
            if (filters.status === 'absent') return pct < 25;
            return true;
          })
        : studentIds;

      return filteredStudentIds.map((sid) => {
        const stats = studentStats.get(sid)!;
        const batchId = studentBatchMap.get(sid)!;
        const total = stats.present + stats.partial + stats.absent;
        const avgPct = total > 0
          ? Math.round(((stats.present * 100 + stats.partial * 50) / total))
          : 0;

        return {
          studentId: sid,
          studentName: studentNameMap.get(sid) ?? 'Unknown',
          batchName: batchNameMap.get(batchId) ?? 'Unknown',
          attendancePercent: avgPct,
          presentCount: stats.present,
          partialCount: stats.partial,
          absentCount: stats.absent,
          lastAttended: stats.lastAttended,
        };
      }).sort((a, b) => a.attendancePercent - b.attendancePercent);
    } catch (err) {
      console.error('[AttendanceAnalytics] getTeacherAttendanceRecords error:', err);
      return [];
    }
  },

  // ════════════════════════════════════════════════════════════════════════
  //  Teacher: Student Attendance Detail
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Get detailed attendance for a single student.
   */
  async getStudentAttendanceDetail(
    teacherId: string,
    studentId: string,
  ): Promise<StudentAttendanceDetail | null> {
    try {
      // Get student name
      const { data: studentDetail } = await supabase
        .from('student_details')
        .select('student_id, profiles(name)')
        .eq('student_id', studentId)
        .maybeSingle();

      if (!studentDetail) return null;

      const profile = Array.isArray(studentDetail.profiles) ? studentDetail.profiles[0] : studentDetail.profiles;
      const studentName = profile?.name ?? 'Unknown';

      // Get teacher's completed classes
      const { data: liveClasses } = await supabase
        .from('live_classes')
        .select('class_id, title, scheduled_at, duration_min')
        .eq('teacher_id', teacherId)
        .eq('status', 'completed')
        .order('scheduled_at', { ascending: false });

      const classIds = (liveClasses ?? []).map((c: any) => c.class_id);

      // Get student's batch via batch_subject_teachers
      const { data: bstData } = await supabase
        .from('batch_subject_teachers')
        .select('batch_subjects!inner(batch_id)')
        .eq('teacher_id', teacherId);

      // Deduplicate by batch_id
      const bsSet = new Set<string>();
      (bstData ?? []).forEach((item: any) => {
        const bid = item.batch_subjects?.batch_id;
        if (bid) bsSet.add(bid);
      });
      const batchIds = Array.from(bsSet);

      const { data: batchStudents } = await supabase
        .from('batch_students')
        .select('batch_id')
        .in('batch_id', batchIds)
        .eq('student_id', studentId)
        .limit(1);

      let batchName = 'Unknown';
      if (batchStudents && batchStudents.length > 0) {
        const { data: batch } = await supabase
          .from('batches')
          .select('name')
          .eq('batch_id', batchStudents[0].batch_id)
          .single();
        batchName = batch?.name ?? 'Unknown';
      }

      // Get attendance records
      const { data: attendanceRecords } = await supabase
        .from('attendance')
        .select('class_id, attendance_status, duration_seconds')
        .in('class_id', classIds)
        .eq('student_id', studentId);

      // Batch-fetch all session durations to avoid N+1 queries
      const { data: sessions } = await supabase
        .from('live_sessions')
        .select('class_id, started_at, ended_at')
        .in('class_id', classIds)
        .eq('status', 'ended');

      const sessionDurationMap = new Map<string, number>();
      for (const s of sessions ?? []) {
        if (s.started_at && s.ended_at) {
          const totalSecs = (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 1000;
          sessionDurationMap.set(s.class_id, totalSecs > 0 ? totalSecs : 1);
        }
      }

      // Compute overall percentage
      let totalPresent = 0;
      let totalPartial = 0;
      let totalAbsent = 0;

      const history: StudentAttendanceHistoryItem[] = [];

      for (const cls of liveClasses ?? []) {
        const rec = (attendanceRecords ?? []).find(
          (a: any) => a.class_id === cls.class_id
        );

        let status = 'absent';
        let attendancePct = 0;

        if (rec) {
          status = rec.attendance_status;
          const totalSecs = sessionDurationMap.get(cls.class_id);
          if (totalSecs && totalSecs > 0) {
            attendancePct = Math.round((rec.duration_seconds / totalSecs) * 100);
          }

          if (status === 'present') totalPresent++;
          else if (status === 'partial') totalPartial++;
          else totalAbsent++;
        } else {
          totalAbsent++;
        }

        history.push({
          date: cls.scheduled_at,
          classTitle: cls.title,
          durationMinutes: cls.duration_min ?? 0,
          attendancePercent: attendancePct,
          attendanceStatus: status,
          classId: cls.class_id,
        });
      }

      const totalClasses = history.length;
      const overallPct = totalClasses > 0
        ? Math.round(((totalPresent * 100 + totalPartial * 50) / totalClasses))
        : 0;

      return {
        studentId,
        studentName,
        batchName,
        overallAttendancePercent: overallPct,
        history,
      };
    } catch (err) {
      console.error('[AttendanceAnalytics] getStudentAttendanceDetail error:', err);
      return null;
    }
  },

  // ════════════════════════════════════════════════════════════════════════
  //  Teacher: Batch Attendance Summary
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Get attendance summary grouped by batch for a teacher.
   */
  async getTeacherBatchAttendance(
    teacherId: string,
    filters: { dateFrom?: string; dateTo?: string; status?: string } = {},
  ): Promise<BatchAttendanceSummary[]> {
    try {
      // Get teacher's batch IDs via batch_subject_teachers (deduplicated)
      const { data: bst } = await supabase
        .from('batch_subject_teachers')
        .select('batch_subjects!inner(batch_id)')
        .eq('teacher_id', teacherId);
      const bsSet = new Set<string>();
      (bst ?? []).forEach((item: any) => {
        const bid = item.batch_subjects?.batch_id;
        if (bid) bsSet.add(bid);
      });
      const batchIds = Array.from(bsSet);

      if (batchIds.length === 0) return [];

      // Get batch names
      const { data: batches } = await supabase
        .from('batches')
        .select('batch_id, name')
        .in('batch_id', batchIds);

      const batchNameMap = new Map((batches ?? []).map((b: any) => [b.batch_id, b.name]));

      // Get teacher's completed classes
      let classQuery = supabase
        .from('live_classes')
        .select('class_id')
        .eq('teacher_id', teacherId)
        .eq('status', 'completed');

      if (filters.dateFrom) classQuery = classQuery.gte('scheduled_at', filters.dateFrom);
      if (filters.dateTo) classQuery = classQuery.lte('scheduled_at', filters.dateTo);

      const { data: liveClasses } = await classQuery;
      const classIds = (liveClasses ?? []).map((c: any) => c.class_id);

      // Get attendance records
      const { data: attendanceRecords } = await supabase
        .from('attendance')
        .select('student_id, class_id, attendance_status')
        .in('class_id', classIds);

      // Get batch-student mappings
      const { data: batchStudents } = await supabase
        .from('batch_students')
        .select('student_id, batch_id')
        .in('batch_id', batchIds);

      // Link completed classes to batches via batch_subject_live_classes
      const batchCompletedClassesMap = new Map<string, Set<string>>();
      for (const bid of batchIds) {
        batchCompletedClassesMap.set(bid, new Set<string>());
      }

      if (classIds.length > 0) {
        const { data: classBSLinks } = await supabase
          .from('batch_subject_live_classes')
          .select(`
            class_id,
            batch_subjects!inner(batch_id)
          `)
          .in('class_id', classIds);

        for (const link of classBSLinks ?? []) {
          const bs = (link as any).batch_subjects;
          const bid = Array.isArray(bs) ? bs[0]?.batch_id : bs?.batch_id;
          if (bid && batchCompletedClassesMap.has(bid)) {
            batchCompletedClassesMap.get(bid)!.add(link.class_id);
          }
        }
      }

      const batchEnrolledStudentsMap = new Map<string, Set<string>>();
      for (const bid of batchIds) {
        batchEnrolledStudentsMap.set(bid, new Set<string>());
      }
      for (const bs of batchStudents ?? []) {
        batchEnrolledStudentsMap.get(bs.batch_id)?.add(bs.student_id);
      }

      const attendanceMap = new Map<string, string>();
      for (const rec of attendanceRecords ?? []) {
        attendanceMap.set(`${rec.class_id}:${rec.student_id}`, rec.attendance_status);
      }

      return batchIds.map((bid) => {
        const enrolledStudents = batchEnrolledStudentsMap.get(bid) ?? new Set<string>();
        const completedBatchClassIds = batchCompletedClassesMap.get(bid) ?? new Set<string>();

        let present = 0;
        let partial = 0;
        let absent = 0;

        if (completedBatchClassIds.size > 0) {
          for (const cid of completedBatchClassIds) {
            for (const sid of enrolledStudents) {
              const status = attendanceMap.get(`${cid}:${sid}`);
              if (status === 'present') present++;
              else if (status === 'partial') partial++;
              else absent++;
            }
          }
        }

        const totalEvaluations = present + partial + absent;
        const avgPct = totalEvaluations > 0
          ? Math.round(((present * 100 + partial * 50) / totalEvaluations))
          : 0;

        return {
          batchId: bid,
          batchName: batchNameMap.get(bid) ?? 'Unknown',
          studentCount: enrolledStudents.size,
          averageAttendancePercent: avgPct,
          presentCount: present,
          partialCount: partial,
          absentCount: absent,
        };
      });
    } catch (err) {
      console.error('[AttendanceAnalytics] getTeacherBatchAttendance error:', err);
      return [];
    }
  },

  // ════════════════════════════════════════════════════════════════════════
  //  Teacher: Live Class Attendance Summary
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Get attendance summary per completed live class for a teacher.
   */
  async getTeacherLiveClassAttendance(
    teacherId: string,
    filters: { dateFrom?: string; dateTo?: string; batchId?: string } = {},
  ): Promise<LiveClassAttendanceSummary[]> {
    try {
      let classQuery = supabase
        .from('live_classes')
        .select('class_id, title, scheduled_at, duration_min')
        .eq('teacher_id', teacherId)
        .eq('status', 'completed')
        .order('scheduled_at', { ascending: false });

      if (filters.dateFrom) classQuery = classQuery.gte('scheduled_at', filters.dateFrom);
      if (filters.dateTo) classQuery = classQuery.lte('scheduled_at', filters.dateTo);
      if (filters.batchId) {
        // Filter classes that have the given batch linked (via batch_subject_live_classes → batch_subjects)
        const { data: links } = await supabase
          .from('batch_subject_live_classes')
          .select(`
            class_id,
            batch_subjects!inner(batch_id)
          `)
          .eq('batch_subjects.batch_id', filters.batchId);
        const linkedClassIds = [...new Set((links ?? []).map((l: any) => l.class_id))];
        if (linkedClassIds.length === 0) return [];
        classQuery = classQuery.in('class_id', linkedClassIds);
      }

      const { data: liveClasses } = await classQuery;
      const classIds = (liveClasses ?? []).map((c: any) => c.class_id);

      if (classIds.length === 0) return [];

      // Get attendance records for these classes
      const { data: attendanceRecords } = await supabase
        .from('attendance')
        .select('class_id, student_id, attendance_status')
        .in('class_id', classIds);

      // Link classes to all enrolled batch students
      const { data: links } = await supabase
        .from('batch_subject_live_classes')
        .select(`
          class_id,
          batch_subjects!inner(batch_id)
        `)
        .in('class_id', classIds);

      const classBatchIdsMap = new Map<string, Set<string>>();
      for (const cid of classIds) {
        classBatchIdsMap.set(cid, new Set<string>());
      }
      for (const link of links ?? []) {
        const bs = (link as any).batch_subjects;
        const bid = Array.isArray(bs) ? bs[0]?.batch_id : bs?.batch_id;
        if (bid) classBatchIdsMap.get(link.class_id)?.add(bid);
      }

      const allLinkedBatchIds = [...new Set((links ?? []).map((l: any) => {
        const bs = l.batch_subjects;
        return Array.isArray(bs) ? bs[0]?.batch_id : bs?.batch_id;
      }).filter(Boolean))];

      const { data: batchStudents } = await supabase
        .from('batch_students')
        .select('student_id, batch_id')
        .in('batch_id', allLinkedBatchIds);

      const batchStudentsMap = new Map<string, Set<string>>();
      for (const bid of allLinkedBatchIds) {
        batchStudentsMap.set(bid, new Set<string>());
      }
      for (const bs of batchStudents ?? []) {
        batchStudentsMap.get(bs.batch_id)?.add(bs.student_id);
      }

      const classEnrolledStudentsMap = new Map<string, Set<string>>();
      for (const cid of classIds) {
        const studentSet = new Set<string>();
        const batchIdsForClass = classBatchIdsMap.get(cid) ?? new Set<string>();
        for (const bid of batchIdsForClass) {
          const sids = batchStudentsMap.get(bid) ?? new Set<string>();
          for (const sid of sids) {
            studentSet.add(sid);
          }
        }
        classEnrolledStudentsMap.set(cid, studentSet);
      }

      const attendanceMap = new Map<string, string>();
      for (const rec of attendanceRecords ?? []) {
        attendanceMap.set(`${rec.class_id}:${rec.student_id}`, rec.attendance_status);
      }

      return (liveClasses ?? []).map((cls: any) => {
        const enrolledStudents = classEnrolledStudentsMap.get(cls.class_id) ?? new Set<string>();

        let present = 0;
        let partial = 0;
        let absent = 0;

        for (const sid of enrolledStudents) {
          const status = attendanceMap.get(`${cls.class_id}:${sid}`);
          if (status === 'present') present++;
          else if (status === 'partial') partial++;
          else absent++;
        }

        return {
          classId: cls.class_id,
          date: cls.scheduled_at,
          durationMin: cls.duration_min ?? null,
          title: cls.title,
          totalStudents: enrolledStudents.size,
          presentCount: present,
          partialCount: partial,
          absentCount: absent,
        };
      });
    } catch (err) {
      console.error('[AttendanceAnalytics] getTeacherLiveClassAttendance error:', err);
      return [];
    }
  },

  // ════════════════════════════════════════════════════════════════════════
  //  Admin: Summary Cards
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Get institute-wide attendance summary for admin.
   */
  async getAdminSummary(instituteId: string): Promise<AdminAttendanceSummary> {
    try {
      // 1. Try consolidated RPC
      const { data, error } = await supabase.rpc('get_admin_attendance_summary', {
        p_institute_id: instituteId,
        p_threshold: ATTENDANCE_THRESHOLD,
      });

      if (!error && data) {
        return {
          totalStudents: Number(data.totalStudents ?? 0),
          totalLiveClasses: Number(data.totalLiveClasses ?? 0),
          overallAttendancePercent: Number(data.overallAttendancePercent ?? 0),
          studentsBelowThreshold: Number(data.studentsBelowThreshold ?? 0),
        };
      }

      if (error) {
        console.warn('[AttendanceAnalytics] RPC get_admin_attendance_summary error, falling back:', error.message);
      }

      // 2. Fallback to client-side queries
      return await this._getAdminSummaryFallback(instituteId);
    } catch (err) {
      console.error('[AttendanceAnalytics] getAdminSummary error:', err);
      return { totalStudents: 0, totalLiveClasses: 0, overallAttendancePercent: 0, studentsBelowThreshold: 0 };
    }
  },

  /**
   * Fallback client-side aggregation for getAdminSummary.
   * @internal
   */
  async _getAdminSummaryFallback(instituteId: string): Promise<AdminAttendanceSummary> {
    // Total students
    const { data: studentDetails } = await supabase
      .from('student_details')
      .select('student_id')
      .eq('institute_id', instituteId);

    const totalStudents = studentDetails?.length ?? 0;

    // Total completed live classes
    const { data: liveClasses } = await supabase
      .from('live_classes')
      .select('class_id, scheduled_at')
      .eq('institute_id', instituteId)
      .eq('status', 'completed');

    const totalLiveClasses = liveClasses?.length ?? 0;
    const classIds = (liveClasses ?? []).map((c: any) => c.class_id);

    let overallAttendancePercent = 0;
    let studentsBelowThreshold = 0;

    if (classIds.length > 0 && totalStudents > 0) {
      // 1. Fetch valid non-deleted batches in institute
      const { data: batches } = await supabase
        .from('batches')
        .select('batch_id')
        .eq('institute_id', instituteId)
        .is('deleted_at', null);

      const batchIds = (batches ?? []).map((b: any) => b.batch_id);

      if (batchIds.length > 0) {
        // 2. Fetch batch-class mappings via both relationship paths
        const [bslcRes, directRes] = await Promise.all([
          supabase
            .from('batch_subject_live_classes')
            .select('class_id, batch_subjects!inner(batch_id)')
            .in('batch_subjects.batch_id', batchIds)
            .in('class_id', classIds),
          supabase
            .from('live_class_batch')
            .select('class_id, batch_id')
            .in('batch_id', batchIds)
            .in('class_id', classIds),
        ]);

        const classBatchMap = new Map<string, Set<string>>();
        for (const link of bslcRes.data ?? []) {
          const bs = (link as any).batch_subjects;
          const bid = Array.isArray(bs) ? bs[0]?.batch_id : bs?.batch_id;
          if (bid && link.class_id) {
            if (!classBatchMap.has(link.class_id)) classBatchMap.set(link.class_id, new Set());
            classBatchMap.get(link.class_id)!.add(bid);
          }
        }
        for (const link of directRes.data ?? []) {
          if (link.batch_id && link.class_id) {
            if (!classBatchMap.has(link.class_id)) classBatchMap.set(link.class_id, new Set());
            classBatchMap.get(link.class_id)!.add(link.batch_id);
          }
        }

        // 3. Fetch active enrolled students with enrolled_on date
        const allLinkedBatchIds = Array.from(
          new Set(Array.from(classBatchMap.values()).flatMap((s) => Array.from(s)))
        );

        const { data: batchStudents } = allLinkedBatchIds.length > 0
          ? await supabase
              .from('batch_students')
              .select('student_id, batch_id, enrolled_on')
              .in('batch_id', allLinkedBatchIds)
              .eq('status', 'active')
          : { data: [] };

        const batchStudentsMap = new Map<string, Array<{ studentId: string; enrolledOn: string }>>();
        for (const bs of batchStudents ?? []) {
          if (!batchStudentsMap.has(bs.batch_id)) batchStudentsMap.set(bs.batch_id, []);
          batchStudentsMap.get(bs.batch_id)!.push({ studentId: bs.student_id, enrolledOn: bs.enrolled_on });
        }

        // 4. Construct deduplicated expected student-class pairs
        const expectedStudentClassPairs = new Set<string>();
        for (const cls of liveClasses ?? []) {
          const classDate = cls.scheduled_at ? cls.scheduled_at.split('T')[0] : '';
          const batchIdsForClass = classBatchMap.get(cls.class_id) ?? new Set();
          const studentsForClass = new Set<string>();

          for (const bid of batchIdsForClass) {
            for (const stu of batchStudentsMap.get(bid) ?? []) {
              const enrolledDate = stu.enrolledOn ? stu.enrolledOn.split('T')[0] : '';
              if (enrolledDate && classDate && enrolledDate <= classDate) {
                studentsForClass.add(stu.studentId);
              }
            }
          }

          for (const sid of studentsForClass) {
            expectedStudentClassPairs.add(`${cls.class_id}:${sid}`);
          }
        }

        // 5. Fetch actual attendance records
        const { data: attendanceRecords } = await supabase
          .from('attendance')
          .select('class_id, student_id, attendance_status')
          .in('class_id', classIds);

        const attendanceStatusMap = new Map<string, string>();
        for (const rec of attendanceRecords ?? []) {
          attendanceStatusMap.set(`${rec.class_id}:${rec.student_id}`, rec.attendance_status);
        }

        // 6. Compute attendance across expected pairs
        let presentCount = 0;
        let partialCount = 0;
        const studentOpportunities = new Map<string, { present: number; partial: number; total: number }>();

        for (const pair of expectedStudentClassPairs) {
          const [, sid] = pair.split(':');
          const status = attendanceStatusMap.get(pair) ?? 'absent';
          if (status === 'present') presentCount++;
          else if (status === 'partial') partialCount++;

          if (!studentOpportunities.has(sid)) {
            studentOpportunities.set(sid, { present: 0, partial: 0, total: 0 });
          }
          const stats = studentOpportunities.get(sid)!;
          stats.total++;
          if (status === 'present') stats.present++;
          else if (status === 'partial') stats.partial++;
        }

        const totalExpected = expectedStudentClassPairs.size;
        if (totalExpected > 0) {
          overallAttendancePercent = Math.round(
            ((presentCount * 100 + partialCount * 50) / totalExpected)
          );
        }

        for (const [, stats] of studentOpportunities) {
          if (stats.total > 0) {
            const pct = Math.round(((stats.present * 100 + stats.partial * 50) / stats.total));
            if (pct < ATTENDANCE_THRESHOLD) {
              studentsBelowThreshold++;
            }
          }
        }
      }
    }

    return {
      totalStudents,
      totalLiveClasses,
      overallAttendancePercent,
      studentsBelowThreshold,
    };
  },

  // ════════════════════════════════════════════════════════════════════════
  //  Admin: Filters
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Get all batches in the institute (for admin filter dropdown).
   */
  async getAdminBatches(instituteId: string): Promise<{ batchId: string; name: string }[]> {
    try {
      const { data } = await supabase
        .from('batches')
        .select('batch_id, name')
        .eq('institute_id', instituteId)
        .order('name', { ascending: true });

      return (data ?? []).map((b: any) => ({ batchId: b.batch_id, name: b.name }));
    } catch {
      return [];
    }
  },

  /**
   * Get all teachers in the institute (for admin filter dropdown).
   */
  async getAdminTeachers(instituteId: string): Promise<{ teacherId: string; name: string }[]> {
    try {
      const { data, error } = await supabase
        .from('teacher_details')
        .select('teacher_id, profiles!inner(name, institute_id)')
        .eq('profiles.institute_id', instituteId);

      if (error) {
        console.error('[AttendanceAnalytics] getAdminTeachers error:', error);
        return [];
      }

      return (data ?? []).map((t: any) => {
        const profile = Array.isArray(t.profiles) ? t.profiles[0] : t.profiles;
        return {
          teacherId: t.teacher_id,
          name: profile?.name ?? 'Unknown Teacher',
        };
      });
    } catch (err) {
      console.error('[AttendanceAnalytics] getAdminTeachers exception:', err);
      return [];
    }
  },

  // ════════════════════════════════════════════════════════════════════════
  //  Admin: Tab 1 — Batch Attendance
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Get batch-level attendance summary for admin.
   */
  async getAdminBatchAttendance(
    instituteId: string,
    filters: { dateFrom?: string; dateTo?: string; teacherId?: string; batchId?: string } = {},
  ): Promise<BatchAttendanceSummary[]> {
    try {
      // 1. Try consolidated RPC
      const dateFromIso = filters.dateFrom
        ? (filters.dateFrom.includes('T') ? filters.dateFrom : `${filters.dateFrom}T00:00:00.000Z`)
        : null;
      const dateToIso = filters.dateTo
        ? (filters.dateTo.includes('T') ? filters.dateTo : `${filters.dateTo}T23:59:59.999Z`)
        : null;

      const { data, error } = await supabase.rpc('get_admin_batch_attendance_summary', {
        p_institute_id: instituteId,
        p_date_from: dateFromIso,
        p_date_to: dateToIso,
        p_teacher_id: filters.teacherId || null,
      });

      if (!error && Array.isArray(data)) {
        let results = data.map((b: any) => ({
          batchId: b.batchId,
          batchName: b.batchName,
          studentCount: Number(b.studentCount ?? 0),
          averageAttendancePercent: Number(b.averageAttendancePercent ?? 0),
          presentCount: Number(b.presentCount ?? 0),
          partialCount: Number(b.partialCount ?? 0),
          absentCount: Number(b.absentCount ?? 0),
        }));

        if (filters.batchId) {
          results = results.filter((b) => b.batchId === filters.batchId);
        }

        return results;
      }

      if (error) {
        console.warn('[AttendanceAnalytics] RPC get_admin_batch_attendance_summary error, falling back:', error.message);
      }

      // 2. Fallback to client-side 5-step query
      return await this._getAdminBatchAttendanceFallback(instituteId, filters);
    } catch (err) {
      console.error('[AttendanceAnalytics] getAdminBatchAttendance error:', err);
      return [];
    }
  },

  /**
   * Fallback client-side aggregation for getAdminBatchAttendance.
   * @internal
   */
  async _getAdminBatchAttendanceFallback(
    instituteId: string,
    filters: { dateFrom?: string; dateTo?: string; teacherId?: string; batchId?: string } = {},
  ): Promise<BatchAttendanceSummary[]> {
    try {
      let batchesQuery = supabase
        .from('batches')
        .select('batch_id, name')
        .eq('institute_id', instituteId);

      if (filters.batchId) {
        batchesQuery = batchesQuery.eq('batch_id', filters.batchId);
      }

      const { data: batches } = await batchesQuery;

      const batchIds = (batches ?? []).map((b: any) => b.batch_id);
      if (batchIds.length === 0) return [];

      const batchNameMap = new Map((batches ?? []).map((b: any) => [b.batch_id, b.name]));

      // 1. Fetch enrolled student counts from batch_students
      const { data: batchStudents } = await supabase
        .from('batch_students')
        .select('student_id, batch_id')
        .in('batch_id', batchIds);

      const batchEnrolledCountMap = new Map<string, number>();
      for (const bid of batchIds) {
        batchEnrolledCountMap.set(bid, 0);
      }
      for (const bs of batchStudents ?? []) {
        const currentCount = batchEnrolledCountMap.get(bs.batch_id) ?? 0;
        batchEnrolledCountMap.set(bs.batch_id, currentCount + 1);
      }

      // 2. Get completed classes for these batches (via batch_subject_live_classes AND live_class_batch)
      const [bslcRes, directRes] = await Promise.all([
        supabase
          .from('batch_subject_live_classes')
          .select(`
            class_id,
            batch_subjects!inner(batch_id)
          `)
          .in('batch_subjects.batch_id', batchIds),
        supabase
          .from('live_class_batch')
          .select('class_id, batch_id')
          .in('batch_id', batchIds),
      ]);

      const batchClassPairs = new Set<string>();
      const allClassIdSet = new Set<string>();

      for (const link of bslcRes.data ?? []) {
        const bs = (link as any).batch_subjects;
        const bid = Array.isArray(bs) ? bs[0]?.batch_id : bs?.batch_id;
        if (bid && link.class_id) {
          batchClassPairs.add(`${bid}:${link.class_id}`);
          allClassIdSet.add(link.class_id);
        }
      }

      for (const link of directRes.data ?? []) {
        if (link.batch_id && link.class_id) {
          batchClassPairs.add(`${link.batch_id}:${link.class_id}`);
          allClassIdSet.add(link.class_id);
        }
      }

      // Filter by teacher and date range if specified
      let classIds = Array.from(allClassIdSet);

      if (classIds.length > 0) {
        if (filters.teacherId) {
          let teacherClassQuery = supabase
            .from('live_classes')
            .select('class_id')
            .eq('teacher_id', filters.teacherId)
            .eq('status', 'completed')
            .in('class_id', classIds);

          if (filters.dateFrom) teacherClassQuery = teacherClassQuery.gte('scheduled_at', filters.dateFrom);
          if (filters.dateTo) teacherClassQuery = teacherClassQuery.lte('scheduled_at', filters.dateTo);

          const { data: teacherClasses } = await teacherClassQuery;
          const teacherClassIds = new Set((teacherClasses ?? []).map((c: any) => c.class_id));
          classIds = classIds.filter((cid) => teacherClassIds.has(cid));
        } else {
          let completedClassQuery = supabase
            .from('live_classes')
            .select('class_id')
            .eq('institute_id', instituteId)
            .eq('status', 'completed')
            .in('class_id', classIds);

          if (filters.dateFrom) completedClassQuery = completedClassQuery.gte('scheduled_at', filters.dateFrom);
          if (filters.dateTo) completedClassQuery = completedClassQuery.lte('scheduled_at', filters.dateTo);

          const { data: completedClasses } = await completedClassQuery;
          const completedClassIds = new Set((completedClasses ?? []).map((c: any) => c.class_id));
          classIds = classIds.filter((cid) => completedClassIds.has(cid));
        }
      }

      // 3. Map batch_id to its completed class_ids
      const batchCompletedClassesMap = new Map<string, Set<string>>();
      for (const bid of batchIds) {
        batchCompletedClassesMap.set(bid, new Set<string>());
      }

      const validClassIdSet = new Set(classIds);
      for (const pair of batchClassPairs) {
        const [bid, cid] = pair.split(':');
        if (validClassIdSet.has(cid) && batchCompletedClassesMap.has(bid)) {
          batchCompletedClassesMap.get(bid)!.add(cid);
        }
      }

      // 4. Map batch_id to enrolled students
      const batchEnrolledStudentsMap = new Map<string, Set<string>>();
      for (const bid of batchIds) {
        batchEnrolledStudentsMap.set(bid, new Set<string>());
      }
      for (const bs of batchStudents ?? []) {
        batchEnrolledStudentsMap.get(bs.batch_id)?.add(bs.student_id);
      }

      // 5. Fetch existing attendance records
      const attendanceMap = new Map<string, string>();
      if (classIds.length > 0) {
        const { data: attendanceRecords } = await supabase
          .from('attendance')
          .select('student_id, class_id, attendance_status')
          .in('class_id', classIds);

        for (const rec of attendanceRecords ?? []) {
          attendanceMap.set(`${rec.class_id}:${rec.student_id}`, rec.attendance_status);
        }
      }

      // 6. Compute per-batch stats across all enrolled students and completed classes
      return batchIds.map((bid) => {
        const enrolledStudents = batchEnrolledStudentsMap.get(bid) ?? new Set<string>();
        const completedBatchClassIds = batchCompletedClassesMap.get(bid) ?? new Set<string>();

        let present = 0;
        let partial = 0;
        let absent = 0;

        if (completedBatchClassIds.size > 0) {
          for (const cid of completedBatchClassIds) {
            for (const sid of enrolledStudents) {
              const status = attendanceMap.get(`${cid}:${sid}`);
              if (status === 'present') present++;
              else if (status === 'partial') partial++;
              else absent++;
            }
          }
        }

        const totalEvaluations = present + partial + absent;
        const avgPct = totalEvaluations > 0
          ? Math.round(((present * 100 + partial * 50) / totalEvaluations))
          : 0;

        return {
          batchId: bid,
          batchName: batchNameMap.get(bid) ?? 'Unknown',
          studentCount: enrolledStudents.size,
          averageAttendancePercent: avgPct,
          presentCount: present,
          partialCount: partial,
          absentCount: absent,
        };
      });
    } catch (err) {
      console.error('[AttendanceAnalytics] getAdminBatchAttendance error:', err);
      return [];
    }
  },

  // ════════════════════════════════════════════════════════════════════════
  //  Admin: Tab 2 — Teacher Attendance
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Get teacher-level attendance summary for admin.
   */
  async getAdminTeacherAttendance(
    instituteId: string,
    filters: { dateFrom?: string; dateTo?: string } = {},
  ): Promise<AdminTeacherAttendanceRow[]> {
    try {
      const { data: teachers, error } = await supabase
        .from('teacher_details')
        .select('teacher_id, profiles!inner(name, institute_id)')
        .eq('profiles.institute_id', instituteId);

      if (error) {
        console.error('[AttendanceAnalytics] getAdminTeacherAttendance error:', error);
        return [];
      }

      const teacherIds = (teachers ?? []).map((t: any) => t.teacher_id);
      if (teacherIds.length === 0) return [];

      const teacherNameMap = new Map(
        (teachers ?? []).map((t: any) => {
          const profile = Array.isArray(t.profiles) ? t.profiles[0] : t.profiles;
          return [t.teacher_id, profile?.name ?? 'Unknown'];
        })
      );

      const result: AdminTeacherAttendanceRow[] = [];

      for (const teacherId of teacherIds) {
        // Distinct batch count via batch_subject_teachers -> batch_subjects
        const { data: bstRows } = await supabase
          .from('batch_subject_teachers')
          .select('batch_subjects!inner(batch_id)')
          .eq('teacher_id', teacherId);

        const distinctBatchIds = new Set(
          (bstRows ?? [])
            .map((r: any) => {
              const bs = Array.isArray(r.batch_subjects) ? r.batch_subjects[0] : r.batch_subjects;
              return bs?.batch_id;
            })
            .filter(Boolean)
        );
        const batchCount = distinctBatchIds.size;

        // Classes assigned / scheduled to teacher for selected date range
        let assignedClassQuery = supabase
          .from('live_classes')
          .select('class_id, title, scheduled_at, duration_min, status')
          .eq('teacher_id', teacherId)
          .eq('institute_id', instituteId)

        if (filters.dateFrom) assignedClassQuery = assignedClassQuery.gte('scheduled_at', filters.dateFrom);
        if (filters.dateTo) assignedClassQuery = assignedClassQuery.lte('scheduled_at', filters.dateTo);

        const { data: assignedClasses } = await assignedClassQuery;
        const allClasses = (assignedClasses ?? []).slice().sort((a: any, b: any) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime());
        const classesAssigned = allClasses.length;

        // Completed classes (classes taken by teacher in date range)
        let completedClassQuery = supabase
          .from('live_classes')
          .select('class_id')
          .eq('teacher_id', teacherId)
          .eq('institute_id', instituteId)
          .eq('status', 'completed');

        if (filters.dateFrom) completedClassQuery = completedClassQuery.gte('scheduled_at', filters.dateFrom);
        if (filters.dateTo) completedClassQuery = completedClassQuery.lte('scheduled_at', filters.dateTo);

        const { data: liveClasses } = await completedClassQuery;
        const classIds = (liveClasses ?? []).map((c: any) => c.class_id);
        const classesTaken = classIds.length;

        let avgPct = 0;
        if (classIds.length > 0) {
          const { data: attendanceRecords } = await supabase
            .from('attendance')
            .select('attendance_status')
            .in('class_id', classIds);

          const totalRecords = attendanceRecords?.length ?? 0;
          if (totalRecords > 0) {
            const presentCount = attendanceRecords!.filter(
              (a: any) => a.attendance_status === 'present'
            ).length;
            const partialCount = attendanceRecords!.filter(
              (a: any) => a.attendance_status === 'partial'
            ).length;
            avgPct = Math.round(((presentCount * 100 + partialCount * 50) / totalRecords));
          }
        }

        // Resolve batch names for assigned classes across both relationship paths
        let teacherClassDetails: TeacherAssignedClassDetail[] = [];
        if (allClasses.length > 0) {
          try {
            const allTeacherClassIds = allClasses.map((c: any) => c.class_id);
            const [bslcRes, directRes, batchesRes] = await Promise.all([
              supabase
                .from('batch_subject_live_classes')
                ?.select('class_id, batch_subjects!inner(batch_id)')
                ?.in('class_id', allTeacherClassIds),
              supabase
                .from('live_class_batch')
                ?.select('class_id, batch_id')
                ?.in('class_id', allTeacherClassIds),
              supabase
                .from('batches')
                ?.select('batch_id, name'),
            ]);

            const batchNameMap = new Map((batchesRes?.data ?? []).map((b: any) => [b.batch_id, b.name]));
            const classBatchIdsMap = new Map<string, Set<string>>();
            for (const cid of allTeacherClassIds) {
              classBatchIdsMap.set(cid, new Set<string>());
            }
            for (const link of bslcRes?.data ?? []) {
              const bs = (link as any).batch_subjects;
              const bid = Array.isArray(bs) ? bs[0]?.batch_id : bs?.batch_id;
              if (bid && link.class_id) classBatchIdsMap.get(link.class_id)?.add(bid);
            }
            for (const link of directRes?.data ?? []) {
              if (link.batch_id && link.class_id) {
                classBatchIdsMap.get(link.class_id)?.add(link.batch_id);
              }
            }

            teacherClassDetails = allClasses.map((c: any) => {
              const bIds = classBatchIdsMap.get(c.class_id);
              const batchNames = bIds ? Array.from(bIds).map((id) => batchNameMap.get(id)).filter(Boolean) : [];
              const batchName = batchNames.length > 0 ? batchNames.join(', ') : '—';
              const isCompleted = c.status === 'completed';
              return {
                classId: c.class_id,
                title: c.title || 'Untitled Class',
                scheduledAt: c.scheduled_at,
                durationMin: c.duration_min,
                batchName,
                status: isCompleted ? 'Taken' : 'Not Taken',
                rawStatus: c.status,
              };
            });
          } catch {
            teacherClassDetails = allClasses.map((c: any) => ({
              classId: c.class_id,
              title: c.title || 'Untitled Class',
              scheduledAt: c.scheduled_at,
              durationMin: c.duration_min,
              batchName: '—',
              status: c.status === 'completed' ? 'Taken' : 'Not Taken',
              rawStatus: c.status,
            }));
          }
        }

        result.push({
          teacherId,
          teacherName: teacherNameMap.get(teacherId) ?? 'Unknown',
          batchCount,
          classesAssigned,
          classesTaken,
          averageAttendancePercent: avgPct,
          classes: teacherClassDetails,
        });
      }

      return result.sort((a, b) => b.averageAttendancePercent - a.averageAttendancePercent);
    } catch (err) {
      console.error('[AttendanceAnalytics] getAdminTeacherAttendance error:', err);
      return [];
    }
  },

  /**
   * Get batch breakdown for a specific teacher with class counts (Level 2 drill-down).
   */
  async getAdminTeacherBatches(
    instituteId: string,
    teacherId: string,
    filters: { dateFrom?: string; dateTo?: string } = {},
  ): Promise<AdminTeacherBatchItem[]> {
    try {
      // 1. Fetch batches officially assigned to the teacher via batch_subject_teachers
      const { data: bstRows } = await supabase
        .from('batch_subject_teachers')
        .select('batch_subjects!inner(batch_id, batches!inner(batch_id, name))')
        .eq('teacher_id', teacherId);

      const batchMap = new Map<string, string>();
      for (const r of bstRows ?? []) {
        const bs = Array.isArray(r.batch_subjects) ? r.batch_subjects[0] : r.batch_subjects;
        const b = Array.isArray(bs?.batches) ? bs.batches[0] : bs?.batches;
        if (b?.batch_id && b?.name) {
          batchMap.set(b.batch_id, b.name);
        }
      }

      // 2. Fetch classes assigned to this teacher in the institute & date range
      let assignedQuery = supabase
        .from('live_classes')
        .select('class_id, status')
        .eq('teacher_id', teacherId)
        .eq('institute_id', instituteId);

      if (filters.dateFrom) assignedQuery = assignedQuery.gte('scheduled_at', filters.dateFrom);
      if (filters.dateTo) assignedQuery = assignedQuery.lte('scheduled_at', filters.dateTo);

      const { data: assignedClasses } = await assignedQuery;
      const allClasses = assignedClasses ?? [];
      const classIds = allClasses.map((c: any) => c.class_id);

      // 3. Resolve batch links for these classes across both relationship paths
      const classToBatchIdsMap = new Map<string, Set<string>>();
      for (const cid of classIds) {
        classToBatchIdsMap.set(cid, new Set<string>());
      }

      if (classIds.length > 0) {
        const [bslcRes, directRes, batchesRes] = await Promise.all([
          supabase
            .from('batch_subject_live_classes')
            .select('class_id, batch_subjects!inner(batch_id)')
            .in('class_id', classIds),
          supabase
            .from('live_class_batch')
            .select('class_id, batch_id')
            .in('class_id', classIds),
          supabase
            .from('batches')
            .select('batch_id, name')
            .eq('institute_id', instituteId),
        ]);

        for (const b of batchesRes?.data ?? []) {
          batchMap.set(b.batch_id, b.name);
        }

        for (const link of bslcRes?.data ?? []) {
          const bs = (link as any).batch_subjects;
          const bid = Array.isArray(bs) ? bs[0]?.batch_id : bs?.batch_id;
          if (bid && link.class_id) {
            classToBatchIdsMap.get(link.class_id)?.add(bid);
            if (!batchMap.has(bid)) {
              batchMap.set(bid, 'Batch ' + bid.substring(0, 6));
            }
          }
        }

        for (const link of directRes?.data ?? []) {
          if (link.batch_id && link.class_id) {
            classToBatchIdsMap.get(link.class_id)?.add(link.batch_id);
            if (!batchMap.has(link.batch_id)) {
              batchMap.set(link.batch_id, 'Batch ' + link.batch_id.substring(0, 6));
            }
          }
        }
      }

      // 4. Compute counts per batch
      const batchStatsMap = new Map<string, { assigned: number; taken: number }>();
      for (const [batchId] of batchMap.entries()) {
        batchStatsMap.set(batchId, { assigned: 0, taken: 0 });
      }

      let unassignedAssigned = 0;
      let unassignedTaken = 0;

      for (const c of allClasses) {
        const linkedBatchIds = classToBatchIdsMap.get(c.class_id);
        const isCompleted = c.status === 'completed';

        if (!linkedBatchIds || linkedBatchIds.size === 0) {
          unassignedAssigned++;
          if (isCompleted) unassignedTaken++;
        } else {
          for (const bid of linkedBatchIds) {
            if (!batchStatsMap.has(bid)) {
              batchStatsMap.set(bid, { assigned: 0, taken: 0 });
            }
            const stats = batchStatsMap.get(bid)!;
            stats.assigned++;
            if (isCompleted) stats.taken++;
          }
        }
      }

      const result: AdminTeacherBatchItem[] = [];
      for (const [batchId, stats] of batchStatsMap.entries()) {
        const name = batchMap.get(batchId) || 'Unknown Batch';
        result.push({
          batchId,
          batchName: name,
          classesAssigned: stats.assigned,
          classesTaken: stats.taken,
          classesNotTaken: stats.assigned - stats.taken,
        });
      }

      if (unassignedAssigned > 0) {
        result.push({
          batchId: 'unassigned',
          batchName: 'Direct / Unassigned Classes',
          classesAssigned: unassignedAssigned,
          classesTaken: unassignedTaken,
          classesNotTaken: unassignedAssigned - unassignedTaken,
        });
      }

      return result.sort((a, b) => {
        if (a.batchId === 'unassigned') return 1;
        if (b.batchId === 'unassigned') return -1;
        return a.batchName.localeCompare(b.batchName);
      });
    } catch (err) {
      console.error('[AttendanceAnalytics] getAdminTeacherBatches error:', err);
      return [];
    }
  },

  /**
   * Get paginated class list for a teacher and specific batch (Level 3 drill-down).
   */
  async getAdminTeacherBatchClasses(
    instituteId: string,
    teacherId: string,
    batchId: string,
    filters: { dateFrom?: string; dateTo?: string; page?: number; pageSize?: number } = {},
  ): Promise<AdminTeacherBatchClassesResult> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.max(1, Math.min(100, filters.pageSize ?? 10));
    try {

      if (batchId === 'unassigned') {
        let allQuery = supabase
          .from('live_classes')
          .select('class_id, title, scheduled_at, duration_min, status')
          .eq('teacher_id', teacherId)
          .eq('institute_id', instituteId);

        if (filters.dateFrom) allQuery = allQuery.gte('scheduled_at', filters.dateFrom);
        if (filters.dateTo) allQuery = allQuery.lte('scheduled_at', filters.dateTo);
        allQuery = allQuery.order('scheduled_at', { ascending: false });

        const { data: allClasses } = await allQuery;
        const classList = allClasses ?? [];
        if (classList.length === 0) {
          return { classes: [], total: 0, page, pageSize, totalPages: 0 };
        }

        const allClassIds = classList.map((c: any) => c.class_id);
        const [bslcRes, directRes] = await Promise.all([
          supabase
            .from('batch_subject_live_classes')
            .select('class_id')
            .in('class_id', allClassIds),
          supabase
            .from('live_class_batch')
            .select('class_id')
            .in('class_id', allClassIds),
        ]);

        const linkedClassIds = new Set<string>();
        for (const r of bslcRes?.data ?? []) if (r.class_id) linkedClassIds.add(r.class_id);
        for (const r of directRes?.data ?? []) if (r.class_id) linkedClassIds.add(r.class_id);

        const unassignedClasses = classList.filter((c: any) => !linkedClassIds.has(c.class_id));
        const total = unassignedClasses.length;
        const from = (page - 1) * pageSize;
        const paginatedRows = unassignedClasses.slice(from, from + pageSize);

        const classes: AdminTeacherBatchClassItem[] = paginatedRows.map((c: any) => ({
          classId: c.class_id,
          title: c.title || 'Untitled Class',
          scheduledAt: c.scheduled_at,
          durationMin: c.duration_min,
          status: c.status === 'completed' ? 'Taken' : 'Not Taken',
          rawStatus: c.status,
        }));

        return {
          classes,
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        };
      }

      // Normal batch: Find class_ids linked to batchId via both paths
      const [bslcRes, directRes] = await Promise.all([
        supabase
          .from('batch_subject_live_classes')
          .select('class_id, batch_subjects!inner(batch_id)')
          .eq('batch_subjects.batch_id', batchId),
        supabase
          .from('live_class_batch')
          .select('class_id')
          .eq('batch_id', batchId),
      ]);

      const batchClassIds = new Set<string>();
      for (const r of bslcRes?.data ?? []) {
        if (r.class_id) batchClassIds.add(r.class_id);
      }
      for (const r of directRes?.data ?? []) {
        if (r.class_id) batchClassIds.add(r.class_id);
      }

      if (batchClassIds.size === 0) {
        return { classes: [], total: 0, page, pageSize, totalPages: 0 };
      }

      const classIdArray = Array.from(batchClassIds);

      let query = supabase
        .from('live_classes')
        .select('class_id, title, scheduled_at, duration_min, status', { count: 'exact' })
        .eq('teacher_id', teacherId)
        .eq('institute_id', instituteId)
        .in('class_id', classIdArray);

      if (filters.dateFrom) query = query.gte('scheduled_at', filters.dateFrom);
      if (filters.dateTo) query = query.lte('scheduled_at', filters.dateTo);

      query = query.order('scheduled_at', { ascending: false });

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      const { data, count, error } = await query;
      if (error) {
        console.error('[AttendanceAnalytics] getAdminTeacherBatchClasses error:', error);
        return { classes: [], total: 0, page, pageSize, totalPages: 0 };
      }

      const total = count ?? (data?.length ?? 0);
      const classes: AdminTeacherBatchClassItem[] = (data ?? []).map((c: any) => ({
        classId: c.class_id,
        title: c.title || 'Untitled Class',
        scheduledAt: c.scheduled_at,
        durationMin: c.duration_min,
        status: c.status === 'completed' ? 'Taken' : 'Not Taken',
        rawStatus: c.status,
      }));

      return {
        classes,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    } catch (err) {
      console.error('[AttendanceAnalytics] getAdminTeacherBatchClasses error:', err);
      return { classes: [], total: 0, page, pageSize, totalPages: 0 };
    }
  },

  // ════════════════════════════════════════════════════════════════════════
  //  Admin: Tab 3 — Student Attendance (search)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Search students by name and get their attendance details.
   */
  async getAdminStudentAttendance(
    instituteId: string,
    searchQuery: string,
  ): Promise<AdminStudentAttendanceDetail[]> {
    try {
      // Search students by name via profiles (strictly scoped to current institute)
      const { data: profiles } = await supabase
        .from('profiles')
        .select('profile_id, name')
        .eq('institute_id', instituteId)
        .ilike('name', `%${searchQuery}%`)
        .limit(20);

      if (!profiles || profiles.length === 0) return [];

      const profileIds = profiles.map((p: any) => p.profile_id);

      // Get student_details
      const { data: studentDetails } = await supabase
        .from('student_details')
        .select('student_id, profile_id')
        .in('profile_id', profileIds)
        .eq('institute_id', instituteId);

      if (!studentDetails || studentDetails.length === 0) return [];

      const studentIds = studentDetails.map((s: any) => s.student_id);
      const studentProfileMap = new Map(
        studentDetails.map((s: any) => [s.student_id, s.profile_id])
      );

      // Get completed classes
      const { data: liveClasses } = await supabase
        .from('live_classes')
        .select('class_id, title, scheduled_at, duration_min')
        .eq('institute_id', instituteId)
        .eq('status', 'completed')
        .order('scheduled_at', { ascending: false });

      const classIds = (liveClasses ?? []).map((c: any) => c.class_id);

      // Get attendance records for these students
      const { data: attendanceRecords } = await supabase
        .from('attendance')
        .select('student_id, class_id, attendance_status, duration_seconds')
        .in('class_id', classIds)
        .in('student_id', studentIds);

      // Build result per student
      const results: AdminStudentAttendanceDetail[] = [];

      for (const studentId of studentIds) {
        const profileId = studentProfileMap.get(studentId);
        const profile = profiles.find((p: any) => p.profile_id === profileId);
        const studentName = profile?.name ?? 'Unknown';

        // Get student's batch
        const { data: batchStudents } = await supabase
          .from('batch_students')
          .select('batch_id')
          .eq('student_id', studentId)
          .limit(1);

        let batchName = 'Unknown';
        if (batchStudents && batchStudents.length > 0) {
          const { data: batch } = await supabase
            .from('batches')
            .select('name')
            .eq('batch_id', batchStudents[0].batch_id)
            .single();
          batchName = batch?.name ?? 'Unknown';
        }

        const studentAttendance = (attendanceRecords ?? []).filter(
          (a: any) => a.student_id === studentId
        );

        let presentClasses = 0;
        let partialClasses = 0;
        let absentClasses = 0;

        // Batch-fetch session durations to avoid N+1 queries
        const { data: sessions } = await supabase
          .from('live_sessions')
          .select('class_id, started_at, ended_at')
          .in('class_id', classIds)
          .eq('status', 'ended');

        const sessionDurationMap = new Map<string, number>();
        for (const s of sessions ?? []) {
          if (s.started_at && s.ended_at) {
            const totalSecs = (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 1000;
            sessionDurationMap.set(s.class_id, totalSecs > 0 ? totalSecs : 1);
          }
        }

        const history: StudentAttendanceHistoryItem[] = [];

        for (const cls of liveClasses ?? []) {
          const rec = studentAttendance.find((a: any) => a.class_id === cls.class_id);
          let status = 'absent';
          let pct = 0;

          if (rec) {
            status = rec.attendance_status;
            if (status === 'present') presentClasses++;
            else if (status === 'partial') partialClasses++;
            else absentClasses++;

            const totalSecs = sessionDurationMap.get(cls.class_id);
            if (totalSecs && totalSecs > 0) {
              pct = Math.round((rec.duration_seconds / totalSecs) * 100);
            }
          } else {
            absentClasses++;
          }

          history.push({
            date: cls.scheduled_at,
            classTitle: cls.title,
            durationMinutes: cls.duration_min ?? 0,
            attendancePercent: pct,
            attendanceStatus: status,
            classId: cls.class_id,
          });
        }

        const total = presentClasses + partialClasses + absentClasses;
        const overallPct = total > 0
          ? Math.round(((presentClasses * 100 + partialClasses * 50) / total))
          : 0;

        results.push({
          studentId,
          studentName,
          batchName,
          overallAttendancePercent: overallPct,
          presentClasses,
          partialClasses,
          absentClasses,
          history,
        });
      }

      return results;
    } catch (err) {
      console.error('[AttendanceAnalytics] getAdminStudentAttendance error:', err);
      return [];
    }
  },

  // ════════════════════════════════════════════════════════════════════════
  //  Admin: Tab 4 — Live Class Attendance
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Fetch live class attendance summary (Tab 4).
   * Calls the consolidated `get_admin_live_class_attendance_paginated` RPC.
   * If the RPC fails or is unavailable, falls back to `_getAdminLiveClassAttendanceFallback`.
   *
   * @param instituteId - Scope to institute.
   * @param filters - Optional date range, teacher, batch, search, page, and pageSize.
   */
  async getAdminLiveClassAttendance(
    instituteId: string,
    filters: LiveClassAttendanceFilter = {},
  ): Promise<PaginatedAdminLiveClassAttendanceResult> {
    try {
      const page = Math.max(filters.page ?? 1, 1);
      const pageSize = Math.min(Math.max(filters.pageSize ?? 10, 1), 100);

      let pDateFrom: string | null = null;
      if (filters.dateFrom) {
        pDateFrom = filters.dateFrom.includes('T')
          ? filters.dateFrom
          : new Date(`${filters.dateFrom}T00:00:00.000Z`).toISOString();
      }

      let pDateTo: string | null = null;
      if (filters.dateTo) {
        pDateTo = filters.dateTo.includes('T')
          ? filters.dateTo
          : new Date(`${filters.dateTo}T23:59:59.999Z`).toISOString();
      }

      const rpcRes = await supabase.rpc('get_admin_live_class_attendance_paginated', {
        p_institute_id: instituteId || null,
        p_page: page,
        p_page_size: pageSize,
        p_date_from: pDateFrom,
        p_date_to: pDateTo,
        p_teacher_id: filters.teacherId || null,
        p_batch_id: filters.batchId || null,
        p_search: filters.search ? filters.search.trim() : null,
      });

      if (!rpcRes || rpcRes.error) {
        if (rpcRes?.error) {
          console.warn(
            '[AttendanceAnalytics] RPC get_admin_live_class_attendance_paginated error, falling back:',
            rpcRes.error.message,
          );
        }
        return await this._getAdminLiveClassAttendanceFallback(instituteId, filters);
      }

      const data = rpcRes.data;
      if (data && typeof data === 'object' && Array.isArray((data as any).classes)) {
        const d = data as any;
        return {
          classes: (d.classes ?? []).map((c: any) => ({
            classId: c.classId,
            date: c.date,
            durationMin: c.durationMin ?? null,
            title: c.title,
            teacherId: c.teacherId,
            teacherName: c.teacherName ?? 'Unknown',
            batchName: c.batchName ?? 'No Batch Assigned',
            totalStudents: Number(c.totalStudents ?? 0),
            presentCount: Number(c.presentCount ?? 0),
            partialCount: Number(c.partialCount ?? 0),
            absentCount: Number(c.absentCount ?? 0),
          })),
          total: Number(d.total ?? 0),
          page: Number(d.page ?? page),
          pageSize: Number(d.pageSize ?? pageSize),
          totalPages: Number(d.totalPages ?? 0),
        };
      }

      return await this._getAdminLiveClassAttendanceFallback(instituteId, filters);
    } catch (err) {
      console.error('[AttendanceAnalytics] getAdminLiveClassAttendance error:', err);
      try {
        return await this._getAdminLiveClassAttendanceFallback(instituteId, filters);
      } catch (fallbackErr) {
        return {
          classes: [],
          total: 0,
          page: filters.page ?? 1,
          pageSize: filters.pageSize ?? 10,
          totalPages: 0,
        };
      }
    }
  },

  /**
   * Client-side fallback for getAdminLiveClassAttendance.
   */
  async _getAdminLiveClassAttendanceFallback(
    instituteId: string,
    filters: LiveClassAttendanceFilter = {},
  ): Promise<PaginatedAdminLiveClassAttendanceResult> {
    try {
      const page = Math.max(filters.page ?? 1, 1);
      const pageSize = Math.min(Math.max(filters.pageSize ?? 10, 1), 100);

      let classQuery = supabase
        .from('live_classes')
        .select('class_id, title, scheduled_at, duration_min, teacher_id')
        .eq('institute_id', instituteId)
        .eq('status', 'completed')
        .order('scheduled_at', { ascending: false });

      if (filters.dateFrom) classQuery = classQuery.gte('scheduled_at', filters.dateFrom);
      if (filters.dateTo) classQuery = classQuery.lte('scheduled_at', filters.dateTo);
      if (filters.teacherId) classQuery = classQuery.eq('teacher_id', filters.teacherId);

      if (filters.batchId) {
        const [bsLinksRes, directLinksRes] = await Promise.all([
          supabase
            .from('batch_subject_live_classes')
            .select(`
              class_id,
              batch_subjects!inner(batch_id)
            `)
            .eq('batch_subjects.batch_id', filters.batchId),
          supabase
            .from('live_class_batch')
            .select('class_id')
            .eq('batch_id', filters.batchId),
        ]);
        const linkedIds = Array.from(
          new Set([
            ...(bsLinksRes.data ?? []).map((l: any) => l.class_id),
            ...(directLinksRes.data ?? []).map((l: any) => l.class_id),
          ])
        );
        if (linkedIds.length === 0) {
          return { classes: [], total: 0, page, pageSize, totalPages: 0 };
        }
        classQuery = classQuery.in('class_id', linkedIds);
      }

      const { data: liveClasses } = await classQuery;
      if (!liveClasses || liveClasses.length === 0) {
        return { classes: [], total: 0, page, pageSize, totalPages: 0 };
      }

      const classIds = liveClasses.map((c: any) => c.class_id);

      // Get attendance records
      const { data: attendanceRecords } = await supabase
        .from('attendance')
        .select('class_id, student_id, attendance_status')
        .in('class_id', classIds);

      // Get teacher names
      const teacherIds = [...new Set(liveClasses.map((c: any) => c.teacher_id))];
      const { data: teacherDetails } = await supabase
        .from('teacher_details')
        .select('teacher_id, profiles(name)')
        .in('teacher_id', teacherIds);

      const teacherNameMap = new Map(
        (teacherDetails ?? []).map((t: any) => {
          const prof = Array.isArray(t.profiles) ? t.profiles[0] : t.profiles;
          return [t.teacher_id, prof?.name ?? 'Unknown'];
        })
      );

      // Get batch names per class (via batch_subject_live_classes AND live_class_batch)
      const [bslcRes, directRes, batchesRes] = await Promise.all([
        supabase
          .from('batch_subject_live_classes')
          .select(`
            class_id,
            batch_subjects!inner(batch_id)
          `)
          .in('class_id', classIds),
        supabase
          .from('live_class_batch')
          .select('class_id, batch_id')
          .in('class_id', classIds),
        supabase
          .from('batches')
          .select('batch_id, name'),
      ]);

      const batchNameMap = new Map((batchesRes.data ?? []).map((b: any) => [b.batch_id, b.name]));

      // Link classes to all enrolled batch students across both relationship paths
      const classBatchIdsMap = new Map<string, Set<string>>();
      for (const cid of classIds) {
        classBatchIdsMap.set(cid, new Set<string>());
      }
      for (const link of bslcRes.data ?? []) {
        const bs = (link as any).batch_subjects;
        const bid = Array.isArray(bs) ? bs[0]?.batch_id : bs?.batch_id;
        if (bid) classBatchIdsMap.get(link.class_id)?.add(bid);
      }
      for (const link of directRes.data ?? []) {
        if (link.batch_id) {
          classBatchIdsMap.get(link.class_id)?.add(link.batch_id);
        }
      }

      const allLinkedBatchIds = Array.from(
        new Set(
          Array.from(classBatchIdsMap.values()).flatMap((batchSet) => Array.from(batchSet))
        )
      );

      const { data: batchStudents } = allLinkedBatchIds.length > 0
        ? await supabase
            .from('batch_students')
            .select('student_id, batch_id')
            .in('batch_id', allLinkedBatchIds)
        : { data: [] };

      const batchStudentsMap = new Map<string, Set<string>>();
      for (const bid of allLinkedBatchIds) {
        batchStudentsMap.set(bid, new Set<string>());
      }
      for (const bs of batchStudents ?? []) {
        batchStudentsMap.get(bs.batch_id)?.add(bs.student_id);
      }

      const classEnrolledStudentsMap = new Map<string, Set<string>>();
      for (const cid of classIds) {
        const studentSet = new Set<string>();
        const batchIdsForClass = classBatchIdsMap.get(cid) ?? new Set<string>();
        for (const bid of batchIdsForClass) {
          const sids = batchStudentsMap.get(bid) ?? new Set<string>();
          for (const sid of sids) {
            studentSet.add(sid);
          }
        }
        classEnrolledStudentsMap.set(cid, studentSet);
      }

      const attendanceMap = new Map<string, string>();
      for (const rec of attendanceRecords ?? []) {
        attendanceMap.set(`${rec.class_id}:${rec.student_id}`, rec.attendance_status);
      }

      let aggregated = liveClasses.map((cls: any) => {
        const enrolledStudents = classEnrolledStudentsMap.get(cls.class_id) ?? new Set<string>();
        const batchIdsForClass = classBatchIdsMap.get(cls.class_id) ?? new Set<string>();
        const batchNames = [...batchIdsForClass]
          .map((bid) => batchNameMap.get(bid))
          .filter(Boolean) as string[];
        const batchName = batchNames.length > 0
          ? batchNames.join(', ')
          : 'No Batch Assigned';

        let present = 0;
        let partial = 0;
        let absent = 0;

        for (const sid of enrolledStudents) {
          const status = attendanceMap.get(`${cls.class_id}:${sid}`);
          if (status === 'present') present++;
          else if (status === 'partial') partial++;
          else absent++;
        }

        return {
          classId: cls.class_id,
          date: cls.scheduled_at,
          durationMin: cls.duration_min ?? null,
          title: cls.title,
          teacherId: cls.teacher_id,
          teacherName: teacherNameMap.get(cls.teacher_id) ?? 'Unknown',
          batchName,
          totalStudents: enrolledStudents.size,
          presentCount: present,
          partialCount: partial,
          absentCount: absent,
        };
      });

      if (filters.search && filters.search.trim()) {
        const q = filters.search.trim().toLowerCase();
        aggregated = aggregated.filter(
          (c) => c.title.toLowerCase().includes(q) || c.teacherName.toLowerCase().includes(q)
        );
      }

      const total = aggregated.length;
      const totalPages = Math.ceil(total / pageSize);
      const paginatedClasses = aggregated.slice((page - 1) * pageSize, page * pageSize);

      return {
        classes: paginatedClasses,
        total,
        page,
        pageSize,
        totalPages,
      };
    } catch (err) {
      console.error('[AttendanceAnalytics] _getAdminLiveClassAttendanceFallback error:', err);
      return {
        classes: [],
        total: 0,
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 10,
        totalPages: 0,
      };
    }
  },
};
