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

export interface LiveClassAttendanceSummary {
  classId: string;
  date: string;
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

export interface AdminTeacherAttendanceRow {
  teacherId: string;
  teacherName: string;
  batchCount: number;
  classesTaken: number;
  averageAttendancePercent: number;
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

      // Build class date map
      const classDateMap = new Map(
        (liveClasses ?? []).map((c: any) => [c.class_id, c.scheduled_at])
      );

      for (const rec of attendanceRecords ?? []) {
        const stats = studentStats.get(rec.student_id);
        if (!stats) continue;

        if (rec.attendance_status === 'present') stats.present++;
        else if (rec.attendance_status === 'partial') stats.partial++;
        else stats.absent++;

        const classDate = classDateMap.get(rec.class_id);
        if (classDate && (!stats.lastAttended || classDate > stats.lastAttended)) {
          stats.lastAttended = classDate;
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

      const studentName = studentDetail.profiles?.name ?? 'Unknown';

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

      // Compute per-batch stats
      const batchStats = new Map<string, { studentIds: Set<string>; present: number; partial: number; absent: number }>();
      for (const bid of batchIds) {
        batchStats.set(bid, { studentIds: new Set(), present: 0, partial: 0, absent: 0 });
      }

      for (const bs of batchStudents ?? []) {
        const stats = batchStats.get(bs.batch_id);
        if (stats) stats.studentIds.add(bs.student_id);
      }

      for (const rec of attendanceRecords ?? []) {
        // Find which batch this student belongs to
        for (const [bid, stats] of batchStats) {
          if (stats.studentIds.has(rec.student_id)) {
            if (rec.attendance_status === 'present') stats.present++;
            else if (rec.attendance_status === 'partial') stats.partial++;
            else stats.absent++;
            break;
          }
        }
      }

      return batchIds.map((bid) => {
        const stats = batchStats.get(bid)!;
        const totalRecords = stats.present + stats.partial + stats.absent;
        const avgPct = totalRecords > 0
          ? Math.round(((stats.present * 100 + stats.partial * 50) / totalRecords))
          : 0;

        return {
          batchId: bid,
          batchName: batchNameMap.get(bid) ?? 'Unknown',
          studentCount: stats.studentIds.size,
          averageAttendancePercent: avgPct,
          presentCount: stats.present,
          partialCount: stats.partial,
          absentCount: stats.absent,
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

      // Compute per-class stats
      const classStats = new Map<string, { present: number; partial: number; absent: number; students: Set<string> }>();

      for (const cid of classIds) {
        classStats.set(cid, { present: 0, partial: 0, absent: 0, students: new Set() });
      }

      for (const rec of attendanceRecords ?? []) {
        const stats = classStats.get(rec.class_id);
        if (!stats) continue;
        stats.students.add(rec.student_id);
        if (rec.attendance_status === 'present') stats.present++;
        else if (rec.attendance_status === 'partial') stats.partial++;
        else stats.absent++;
      }

      return (liveClasses ?? []).map((cls: any) => {
        const stats = classStats.get(cls.class_id) ?? { present: 0, partial: 0, absent: 0, students: new Set() };
        return {
          classId: cls.class_id,
          date: cls.scheduled_at,
          title: cls.title,
          totalStudents: stats.students.size,
          presentCount: stats.present,
          partialCount: stats.partial,
          absentCount: stats.absent,
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
      // Total students
      const { data: studentDetails } = await supabase
        .from('student_details')
        .select('student_id')
        .eq('institute_id', instituteId);

      const totalStudents = studentDetails?.length ?? 0;

      // Total completed live classes
      const { data: liveClasses } = await supabase
        .from('live_classes')
        .select('class_id')
        .eq('institute_id', instituteId)
        .eq('status', 'completed');

      const totalLiveClasses = liveClasses?.length ?? 0;
      const classIds = (liveClasses ?? []).map((c: any) => c.class_id);

      let overallAttendancePercent = 0;
      let studentsBelowThreshold = 0;

      if (classIds.length > 0 && totalStudents > 0) {
        // Get all attendance records
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
          overallAttendancePercent = Math.round(
            ((presentCount * 100 + partialCount * 50) / totalRecords)
          );
        }

        // Compute per-student attendance to find below-threshold students
        const studentStats = new Map<string, { present: number; partial: number; absent: number }>();
        for (const rec of attendanceRecords ?? []) {
          if (!studentStats.has(rec.student_id)) {
            studentStats.set(rec.student_id, { present: 0, partial: 0, absent: 0 });
          }
          const stats = studentStats.get(rec.student_id)!;
          if (rec.attendance_status === 'present') stats.present++;
          else if (rec.attendance_status === 'partial') stats.partial++;
          else stats.absent++;
        }

        for (const [, stats] of studentStats) {
          const total = stats.present + stats.partial + stats.absent;
          if (total > 0) {
            const pct = Math.round(((stats.present * 100 + stats.partial * 50) / total));
            if (pct < ATTENDANCE_THRESHOLD) studentsBelowThreshold++;
          }
        }
      }

      return {
        totalStudents,
        totalLiveClasses,
        overallAttendancePercent,
        studentsBelowThreshold,
      };
    } catch (err) {
      console.error('[AttendanceAnalytics] getAdminSummary error:', err);
      return { totalStudents: 0, totalLiveClasses: 0, overallAttendancePercent: 0, studentsBelowThreshold: 0 };
    }
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
      const { data } = await supabase
        .from('teacher_details')
        .select('teacher_id, profiles(name)')
        .eq('institute_id', instituteId);

      return (data ?? []).map((t: any) => ({
        teacherId: t.teacher_id,
        name: t.profiles?.name ?? 'Unknown Teacher',
      }));
    } catch {
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
    filters: { dateFrom?: string; dateTo?: string; teacherId?: string } = {},
  ): Promise<BatchAttendanceSummary[]> {
    try {
      const { data: batches } = await supabase
        .from('batches')
        .select('batch_id, name')
        .eq('institute_id', instituteId);

      const batchIds = (batches ?? []).map((b: any) => b.batch_id);
      if (batchIds.length === 0) return [];

      const batchNameMap = new Map((batches ?? []).map((b: any) => [b.batch_id, b.name]));

      // Get completed classes for these batches (via batch_subject_live_classes)
      const { data: classBSLinks } = await supabase
        .from('batch_subject_live_classes')
        .select(`
          class_id,
          batch_subjects!inner(batch_id)
        `)
        .in('batch_subjects.batch_id', batchIds);

      // Filter by teacher if specified
      let classIds = [...new Set((classBSLinks ?? []).map((l: any) => l.class_id))];

      if (filters.teacherId) {
        const { data: teacherClasses } = await supabase
          .from('live_classes')
          .select('class_id')
          .eq('teacher_id', filters.teacherId)
          .eq('status', 'completed')
          .in('class_id', classIds);
        const teacherClassIds = new Set((teacherClasses ?? []).map((c: any) => c.class_id));
        classIds = classIds.filter((cid) => teacherClassIds.has(cid));
      } else {
        const { data: completedClasses } = await supabase
          .from('live_classes')
          .select('class_id')
          .eq('institute_id', instituteId)
          .eq('status', 'completed')
          .in('class_id', classIds);
        const completedClassIds = new Set((completedClasses ?? []).map((c: any) => c.class_id));
        classIds = classIds.filter((cid) => completedClassIds.has(cid));
      }

      if (classIds.length === 0) return [];

      // Get attendance records
      const { data: attendanceRecords } = await supabase
        .from('attendance')
        .select('student_id, class_id, attendance_status')
        .in('class_id', classIds);

      // Map class_id to batch_id (deduplicated — one class may belong to multiple subjects in the same batch)
      const classBatchMap = new Map();
      for (const link of classBSLinks ?? []) {
        const batchSubjects = (link.batch_subjects ?? []) as Array<{ batch_id: string }>;
        const bid = batchSubjects[0]?.batch_id;
        if (bid && !classBatchMap.has(link.class_id)) {
          classBatchMap.set(link.class_id, bid);
        }
      }

      // Compute per-batch stats
      const batchStats = new Map<string, { present: number; partial: number; absent: number; students: Set<string> }>();
      for (const bid of batchIds) {
        batchStats.set(bid, { present: 0, partial: 0, absent: 0, students: new Set() });
      }

      for (const rec of attendanceRecords ?? []) {
        const bid = classBatchMap.get(rec.class_id);
        if (!bid) continue;
        const stats = batchStats.get(bid);
        if (!stats) continue;
        stats.students.add(rec.student_id);
        if (rec.attendance_status === 'present') stats.present++;
        else if (rec.attendance_status === 'partial') stats.partial++;
        else stats.absent++;
      }

      return batchIds.map((bid) => {
        const stats = batchStats.get(bid)!;
        const totalRecords = stats.present + stats.partial + stats.absent;
        const avgPct = totalRecords > 0
          ? Math.round(((stats.present * 100 + stats.partial * 50) / totalRecords))
          : 0;

        return {
          batchId: bid,
          batchName: batchNameMap.get(bid) ?? 'Unknown',
          studentCount: stats.students.size,
          averageAttendancePercent: avgPct,
          presentCount: stats.present,
          partialCount: stats.partial,
          absentCount: stats.absent,
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
      const { data: teachers } = await supabase
        .from('teacher_details')
        .select('teacher_id, profiles(name)')
        .eq('institute_id', instituteId);

      const teacherIds = (teachers ?? []).map((t: any) => t.teacher_id);
      if (teacherIds.length === 0) return [];

      const teacherNameMap = new Map(
        (teachers ?? []).map((t: any) => [t.teacher_id, t.profiles?.name ?? 'Unknown'])
      );

      const result: AdminTeacherAttendanceRow[] = [];

      for (const teacherId of teacherIds) {
        // Batch count
        // Get distinct batch_subject count via batch_subject_teachers
        const { data: bst } = await supabase
          .from('batch_subject_teachers')
          .select('batch_subject_id', { count: 'exact', head: true })
          .eq('teacher_id', teacherId);
        const batchCount = bst?.length ?? 0;

        // Completed classes
        let classQuery = supabase
          .from('live_classes')
          .select('class_id')
          .eq('teacher_id', teacherId)
          .eq('institute_id', instituteId)
          .eq('status', 'completed');

        if (filters.dateFrom) classQuery = classQuery.gte('scheduled_at', filters.dateFrom);
        if (filters.dateTo) classQuery = classQuery.lte('scheduled_at', filters.dateTo);

        const { data: liveClasses } = await classQuery;
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

        result.push({
          teacherId,
          teacherName: teacherNameMap.get(teacherId) ?? 'Unknown',
          batchCount,
          classesTaken,
          averageAttendancePercent: avgPct,
        });
      }

      return result.sort((a, b) => b.averageAttendancePercent - a.averageAttendancePercent);
    } catch (err) {
      console.error('[AttendanceAnalytics] getAdminTeacherAttendance error:', err);
      return [];
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
      // Search students by name via profiles
      const { data: profiles } = await supabase
        .from('profiles')
        .select('profile_id, name')
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
   * Get attendance summary per completed live class (institute-wide).
   */
  async getAdminLiveClassAttendance(
    instituteId: string,
    filters: { dateFrom?: string; dateTo?: string; teacherId?: string; batchId?: string } = {},
  ): Promise<(LiveClassAttendanceSummary & { teacherName: string; batchName: string })[]> {
    try {
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
        const { data: links } = await supabase
          .from('batch_subject_live_classes')
          .select(`
            class_id,
            batch_subjects!inner(batch_id)
          `)
          .eq('batch_subjects.batch_id', filters.batchId);
        const linkedIds = [...new Set((links ?? []).map((l: any) => l.class_id))];
        if (linkedIds.length === 0) return [];
        classQuery = classQuery.in('class_id', linkedIds);
      }

      const { data: liveClasses } = await classQuery;
      if (!liveClasses || liveClasses.length === 0) return [];

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
        (teacherDetails ?? []).map((t: any) => [t.teacher_id, t.profiles?.name ?? 'Unknown'])
      );

      // Get batch names per class (via batch_subject_live_classes → batch_subjects → batches)
      const { data: links } = await supabase
        .from('batch_subject_live_classes')
        .select(`
          class_id,
          batch_subjects!inner(
            batch_id,
            batches!inner(name)
          )
        `)
        .in('class_id', classIds);

      const { data: batches } = await supabase
        .from('batches')
        .select('batch_id, name');

      const batchNameMap = new Map((batches ?? []).map((b: any) => [b.batch_id, b.name]));
      const classBatchMap = new Map<string, string>();
      for (const link of links ?? []) {
        const batchSubjects = (link.batch_subjects ?? []) as Array<{ batch_id: string; batches?: Array<{ name: string }> }>;
        const bid = batchSubjects[0]?.batch_id;
        if (bid) {
          classBatchMap.set(link.class_id, bid);
        }
      }

      // Compute per-class stats
      const classStats = new Map<string, { present: number; partial: number; absent: number; students: Set<string> }>();
      for (const cid of classIds) {
        classStats.set(cid, { present: 0, partial: 0, absent: 0, students: new Set() });
      }
      for (const rec of attendanceRecords ?? []) {
        const stats = classStats.get(rec.class_id);
        if (!stats) continue;
        stats.students.add(rec.student_id);
        if (rec.attendance_status === 'present') stats.present++;
        else if (rec.attendance_status === 'partial') stats.partial++;
        else stats.absent++;
      }

      return liveClasses.map((cls: any) => {
        const stats = classStats.get(cls.class_id) ?? { present: 0, partial: 0, absent: 0, students: new Set() };
        const batchId = classBatchMap.get(cls.class_id);
        return {
          classId: cls.class_id,
          date: cls.scheduled_at,
          title: cls.title,
          teacherName: teacherNameMap.get(cls.teacher_id) ?? 'Unknown',
          batchName: batchId ? (batchNameMap.get(batchId) ?? 'Unknown') : 'Unknown',
          totalStudents: stats.students.size,
          presentCount: stats.present,
          partialCount: stats.partial,
          absentCount: stats.absent,
        };
      });
    } catch (err) {
      console.error('[AttendanceAnalytics] getAdminLiveClassAttendance error:', err);
      return [];
    }
  },
};
