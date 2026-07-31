/**
 * Live Class Attendance Service
 *
 * Production-ready service for automatic attendance tracking during live classes.
 *
 * ## Architecture
 *
 * This service is event-sourced. Every student join/leave is recorded as an
 * immutable event in `attendance_events`. The `attendance` table is a computed
 * summary that is finalized when the class ends.
 *
 * ## Flow
 *
 *   Student joins LiveKit room
 *     → recordJoin() called (via webhook or API)
 *     → Upserts attendance row (sets joined_at on first join, increments join_count)
 *     → Inserts JOIN event
 *
 *   Student leaves LiveKit room
 *     → recordLeave() called
 *     → Computes duration delta from last JOIN event
 *     → Accumulates duration_seconds, updates left_at
 *     → Inserts LEAVE event
 *
 *   Teacher ends class
 *     → finalizeClassAttendance() called from teacherService.endLiveClass()
 *     → Records synthetic LEAVE for any still-connected students
 *     → Computes attendance_status from percentage of class attended
 *
 * ## Attendance Status Thresholds
 *
 *   >= 75% of class duration  → present
 *   25% – 74%                 → partial
 *   < 25%                     → absent
 *
 * @module services/liveClassAttendanceService
 */

import { supabase } from '@/config/supabase';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export type AttendanceStatus = 'present' | 'partial' | 'absent' | 'excused';

export interface AttendanceRecord {
  attendanceId: string;
  classId: string;
  studentId: string;
  instituteId: string;
  joinedAt: string | null;
  leftAt: string | null;
  durationSeconds: number;
  attendanceStatus: AttendanceStatus;
  joinCount: number;
  isManualOverride: boolean;
  overrideBy: string | null;
  overrideReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AttendanceEvent {
  eventId: string;
  attendanceId: string;
  classId: string;
  studentId: string;
  instituteId: string;
  eventType: 'join' | 'leave';
  eventTimestamp: string;
  createdAt: string;
}

/** Result returned by finalizeClassAttendance. */
export interface FinalizeResult {
  totalStudents: number;
  present: number;
  partial: number;
  absent: number;
  excused: number;
  finalized: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolve a profile_id to a student_id by querying student_details.
 */
async function resolveStudentId(profileId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('student_details')
      .select('student_id')
      .eq('profile_id', profileId)
      .maybeSingle();

    if (error || !data) return null;
    return data.student_id;
  } catch {
    return null;
  }
}

/**
 * Resolve a LiveKit room name to a live_classes class_id.
 * The room_name column on live_classes stores the deterministic room name.
 */
async function resolveClassIdFromRoomName(roomName: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('live_classes')
      .select('class_id')
      .eq('room_name', roomName)
      .limit(1);

    if (error || !data || data.length === 0) return null;
    return data[0].class_id;
  } catch {
    return null;
  }
}

/**
 * Get the institute_id for a class.
 */
async function getInstituteId(classId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('live_classes')
      .select('institute_id')
      .eq('class_id', classId)
      .single();

    if (error || !data) return null;
    return data.institute_id;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Attendance Service
// ═══════════════════════════════════════════════════════════════════════════

export const liveClassAttendanceService = {
  // ────────────────────────────────────────────────────────────────────────
  //  Record Join
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Record a student joining a live class.
   *
   * Creates an attendance record if one does not already exist, or updates
   * the existing record:
   *   - `joined_at` is set only on the student's very first join (never updated)
   *   - `join_count` is incremented on every join
   *   - A JOIN event is inserted into `attendance_events`
   *
   * @param classId   - The UUID of the live_classes row.
   * @param studentId - The UUID of the student (student_details.student_id).
   *
   * @returns The attendance_id, or null on failure.
   */
  async recordJoin(
    classId: string,
    studentId: string,
  ): Promise<string | null> {
    try {
      // 1. Resolve institute_id
      const instituteId = await getInstituteId(classId);
      if (!instituteId) {
        console.error('[Attendance] Class not found:', classId);
        return null;
      }

      const now = new Date().toISOString();

      // 2. Check if attendance record exists (two-step approach for correct joined_at handling)
      const { data: existing } = await supabase
        .from('attendance')
        .select('attendance_id, joined_at, join_count')
        .eq('class_id', classId)
        .eq('student_id', studentId)
        .maybeSingle();

      let attendanceId: string;
      let isFirstJoin = false;

      if (existing) {
        // Record exists — increment join_count, do NOT update joined_at
        attendanceId = existing.attendance_id;
        isFirstJoin = !existing.joined_at;

        const { error: updateErr } = await supabase
          .from('attendance')
          .update({
            join_count: (existing.join_count || 0) + 1,
            updated_at: now,
          })
          .eq('attendance_id', attendanceId);

        if (updateErr) {
          console.error('[Attendance] Failed to update join_count:', updateErr.message);
          return null;
        }
      } else {
        // No record — create one with joined_at = now, join_count = 1
        isFirstJoin = true;

        const { data: inserted, error: insertErr } = await supabase
          .from('attendance')
          .insert({
            class_id: classId,
            student_id: studentId,
            institute_id: instituteId,
            joined_at: now,
            join_count: 1,
            attendance_status: 'absent', // Will be finalized when class ends
            duration_seconds: 0,
          })
          .select('attendance_id')
          .single();

        if (insertErr || !inserted) {
          console.error('[Attendance] Failed to insert record:', insertErr?.message);
          return null;
        }

        attendanceId = inserted.attendance_id;
      }

      // 3. Insert JOIN event into attendance_events
      const { error: eventErr } = await supabase
        .from('attendance_events')
        .insert({
          attendance_id: attendanceId,
          class_id: classId,
          student_id: studentId,
          institute_id: instituteId,
          event_type: 'join',
          event_timestamp: now,
        });

      if (eventErr) {
        console.error('[Attendance] Failed to insert JOIN event:', eventErr.message);
        // Non-critical — attendance record already created/updated
      }

      console.log(`[Attendance] Student ${studentId} joined class ${classId} ` +
        `(join #${(existing?.join_count || 0) + 1}, firstJoin: ${isFirstJoin})`);

      return attendanceId;
    } catch (err) {
      console.error('[Attendance] recordJoin error:', err);
      return null;
    }
  },

  // ────────────────────────────────────────────────────────────────────────
  //  Record Leave
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Record a student leaving a live class.
   *
   * Computes the duration increment from the student's last JOIN event to now
   * and accumulates it into `duration_seconds`. Updates `left_at` to now.
   * Inserts a LEAVE event into `attendance_events`.
   *
   * @param classId   - The UUID of the live_classes row.
   * @param studentId - The UUID of the student (student_details.student_id).
   *
   * @returns true if successful, false otherwise.
   */
  async recordLeave(
    classId: string,
    studentId: string,
  ): Promise<boolean> {
    try {
      // 1. Find the attendance record
      const { data: attendance, error: findErr } = await supabase
        .from('attendance')
        .select('attendance_id, joined_at, left_at, duration_seconds, institute_id')
        .eq('class_id', classId)
        .eq('student_id', studentId)
        .maybeSingle();

      if (findErr || !attendance) {
        console.error('[Attendance] No attendance record found for leave:', { classId, studentId });
        return false;
      }

      // 2. Find the student's last JOIN event (to compute this session's duration)
      const { data: lastJoinEvent } = await supabase
        .from('attendance_events')
        .select('event_timestamp')
        .eq('attendance_id', attendance.attendance_id)
        .eq('event_type', 'join')
        .order('event_timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

      const now = new Date();
      const nowIso = now.toISOString();

      // 3. Calculate duration increment
      let durationIncrement = 0;
      if (lastJoinEvent?.event_timestamp) {
        const joinTime = new Date(lastJoinEvent.event_timestamp).getTime();
        durationIncrement = Math.round((now.getTime() - joinTime) / 1000);
        // Guard against negative duration (clock skew)
        if (durationIncrement < 0) durationIncrement = 0;
      }

      // 4. Update attendance record
      const newDuration = (attendance.duration_seconds || 0) + durationIncrement;

      const { error: updateErr } = await supabase
        .from('attendance')
        .update({
          left_at: nowIso,
          duration_seconds: newDuration,
          updated_at: nowIso,
        })
        .eq('attendance_id', attendance.attendance_id);

      if (updateErr) {
        console.error('[Attendance] Failed to update leave:', updateErr.message);
        return false;
      }

      // 5. Insert LEAVE event
      const { error: eventErr } = await supabase
        .from('attendance_events')
        .insert({
          attendance_id: attendance.attendance_id,
          class_id: classId,
          student_id: studentId,
          institute_id: attendance.institute_id,
          event_type: 'leave',
          event_timestamp: nowIso,
        });

      if (eventErr) {
        console.error('[Attendance] Failed to insert LEAVE event:', eventErr.message);
        // Non-critical
      }

      console.log(`[Attendance] Student ${studentId} left class ${classId} ` +
        `(duration +${durationIncrement}s, total: ${newDuration}s)`);

      return true;
    } catch (err) {
      console.error('[Attendance] recordLeave error:', err);
      return false;
    }
  },

  // ────────────────────────────────────────────────────────────────────────
  //  Record Join by Room Name (for LiveKit webhook)
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Record a student join using a LiveKit room name instead of a class ID.
   * Convenience wrapper for the LiveKit webhook handler.
   *
   * @param roomName    - The LiveKit room name (e.g. "class-abc12345").
   * @param studentId   - The UUID of the student (student_details.student_id).
   *
   * @returns The attendance_id, or null on failure.
   */
  async recordJoinByRoomName(
    roomName: string,
    studentId: string,
  ): Promise<string | null> {
    const classId = await resolveClassIdFromRoomName(roomName);
    if (!classId) {
      console.error('[Attendance] Cannot resolve room name to class:', roomName);
      return null;
    }
    return this.recordJoin(classId, studentId);
  },

  // ────────────────────────────────────────────────────────────────────────
  //  Record Leave by Room Name (for LiveKit webhook)
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Record a student leave using a LiveKit room name instead of a class ID.
   * Convenience wrapper for the LiveKit webhook handler.
   *
   * @param roomName    - The LiveKit room name (e.g. "class-abc12345").
   * @param studentId   - The UUID of the student (student_details.student_id).
   *
   * @returns true if successful.
   */
  async recordLeaveByRoomName(
    roomName: string,
    studentId: string,
  ): Promise<boolean> {
    const classId = await resolveClassIdFromRoomName(roomName);
    if (!classId) {
      console.error('[Attendance] Cannot resolve room name to class:', roomName);
      return false;
    }
    return this.recordLeave(classId, studentId);
  },

  // ────────────────────────────────────────────────────────────────────────
  //  Create Absent Records for Missing Students
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Creates 'absent' attendance records for every enrolled student who
   * never joined the live class.
   *
   * Fetches all students assigned to the class's batches via
   * batch_subject_live_classes → batch_subjects → batch_students, compares with existing attendance
   * records, and inserts absent records for any missing students.
   *
   * Respects the unique constraint (class_id, student_id) — uses ON CONFLICT
   * DO NOTHING to avoid duplicates from race conditions.
   *
   * @param classId - The UUID of the live_classes row.
   * @returns Number of absent records created.
   */
  async createAbsentRecordsForMissingStudents(classId: string): Promise<number> {
    try {
      console.log(`[Attendance] Checking for enrolled students without attendance records for class ${classId}...`);

      // 1. Get the institute_id for this class
      const instituteId = await getInstituteId(classId);
      if (!instituteId) {
        console.error('[Attendance] Cannot resolve institute_id for class:', classId);
        return 0;
      }

      // 2. Get all batch IDs linked to this class via batch_subject_live_classes
      const { data: bsLinks, error: bsErr } = await supabase
        .from('batch_subject_live_classes')
        .select(`
          batch_subject_id,
          batch_subjects!inner(batch_id)
        `)
        .eq('class_id', classId);

      if (bsErr) {
        console.error('[Attendance] Failed to fetch batch subject links:', bsErr.message);
        return 0;
      }

      if (!bsLinks || bsLinks.length === 0) {
        console.log('[Attendance] No batch subjects linked to this class — skipping absent creation.');
        return 0;
      }

      // Deduplicate by batch_id (a class may be assigned to multiple subjects in the same batch)
      const batchIdSet = new Set<string>();
      (bsLinks ?? []).forEach((item: any) => {
        const bid = item.batch_subjects?.batch_id;
        if (bid) batchIdSet.add(bid);
      });
      const batchIds = Array.from(batchIdSet);

      // 3. Get all enrolled student IDs for those batches
      const { data: enrolledStudents, error: enrolledErr } = await supabase
        .from('batch_students')
        .select('student_id')
        .in('batch_id', batchIds);

      if (enrolledErr) {
        console.error('[Attendance] Failed to fetch enrolled students:', enrolledErr.message);
        return 0;
      }

      if (!enrolledStudents || enrolledStudents.length === 0) {
        console.log('[Attendance] No students enrolled in the linked batches.');
        return 0;
      }

      // 4. Get existing attendance student IDs for this class
      const { data: existingAttendance, error: existingErr } = await supabase
        .from('attendance')
        .select('student_id')
        .eq('class_id', classId);

      if (existingErr) {
        console.error('[Attendance] Failed to fetch existing attendance:', existingErr.message);
        return 0;
      }

      // 5. Build a Set of student IDs that already have attendance records
      const existingStudentIds = new Set(
        (existingAttendance || []).map((a: any) => a.student_id)
      );

      // 6. Filter to students who are enrolled but have NO attendance record.
      //    Use a Set to deduplicate — a student may be enrolled in multiple
      //    batches linked to the same class.
      const missingStudentIdsSet = new Set(
        (enrolledStudents as Array<{ student_id: string }>)
          .map((s) => s.student_id)
          .filter((sid) => !existingStudentIds.has(sid))
      );
      const missingStudentIds = [...missingStudentIdsSet];

      if (missingStudentIds.length === 0) {
        console.log('[Attendance] All enrolled students already have attendance records.');
        return 0;
      }

      console.log(`[Attendance] Creating absent records for ${missingStudentIds.length} students who never joined...`);

      // 7. Insert absent records for all missing students in bulk
      //    Using ON CONFLICT DO NOTHING to respect the unique constraint
      //    and avoid duplicates from any race conditions.
      const absentRecords = missingStudentIds.map((studentId) => ({
        class_id: classId,
        student_id: studentId,
        institute_id: instituteId,
        joined_at: null,
        left_at: null,
        duration_seconds: 0,
        join_count: 0,
        attendance_status: 'absent',
        is_manual_override: false,
      }));

      const { error: insertErr } = await supabase
        .from('attendance')
        .insert(absentRecords, { onConflict: 'class_id, student_id', ignoreDuplicates: true });

      if (insertErr) {
        console.error('[Attendance] Failed to insert absent records:', insertErr.message);
        return 0;
      }

      console.log(`[Attendance] ✅ Created ${missingStudentIds.length} absent attendance records.`);
      return missingStudentIds.length;
    } catch (err) {
      console.error('[Attendance] createAbsentRecordsForMissingStudents error:', err);
      return 0;
    }
  },

  // ────────────────────────────────────────────────────────────────────────
  //  Finalize Class Attendance
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Finalize attendance for a class when the session ends.
   *
   * This function:
   *   1. Creates 'absent' records for enrolled students who never joined
   *   2. Records synthetic LEAVE events for any students still connected
   *   3. Calls the database function `calculate_class_attendance()` which
   *      computes attendance_status for all students based on the percentage
   *      of class duration attended:
   *        >= 75%  → present
   *        25-74%  → partial
   *        < 25%   → absent
   *      Manual overrides (is_manual_override = true) are preserved.
   *
   * This is called automatically from `teacherService.endLiveClass()`.
   *
   * @param classId - The UUID of the live_classes row.
   *
   * @returns Summary of the finalization, or null on failure.
   */
  async finalizeClassAttendance(classId: string): Promise<FinalizeResult | null> {
    try {
      console.log(`[Attendance] Finalizing attendance for class ${classId}...`);

      // ── Step 1: Create absent records for enrolled students who never joined ─
      const recordsCreated = await this.createAbsentRecordsForMissingStudents(classId);
      if (recordsCreated > 0) {
        console.log(`[Attendance] Created ${recordsCreated} absent records for students who never joined.`);
      }

      // ── Step 2: Record LEAVE for any still-connected students ─────────
      //    Only students with join_count > 0 are considered "connected" —
      //    absent students (join_count = 0) are excluded to avoid creating
      //    spurious LEAVE events for students who never joined.
      const { data: connectedStudents, error: connectedErr } = await supabase
        .from('attendance')
        .select('student_id')
        .eq('class_id', classId)
        .is('left_at', null)
        .gt('join_count', 0);

      if (connectedErr) {
        console.error('[Attendance] Failed to find connected students:', connectedErr.message);
      } else if (connectedStudents && connectedStudents.length > 0) {
        console.log(`[Attendance] Recording LEAVE for ${connectedStudents.length} still-connected students...`);
        await Promise.all(
          connectedStudents.map((s: any) => this.recordLeave(classId, s.student_id))
        );
      }

      // ── Step 3: Call the database function to compute attendance_status ─
      const { data: results, error: fnErr } = await supabase
        .rpc('calculate_class_attendance', {
          p_class_id: classId,
          p_present_threshold: 75.0,
          p_partial_threshold: 25.0,
        });

      if (fnErr) {
        console.error('[Attendance] calculate_class_attendance failed:', fnErr.message);
        return null;
      }

      // ── Step 4: Compute summary ──────────────────────────────────────
      const rows = (results || []) as Array<{
        student_id: string;
        old_status: string;
        new_status: string;
        duration_seconds: number;
        pct_attended: number;
      }>;

      const summary: FinalizeResult = {
        totalStudents: rows.length,
        present: rows.filter((r) => r.new_status === 'present').length,
        partial: rows.filter((r) => r.new_status === 'partial').length,
        absent: rows.filter((r) => r.new_status === 'absent').length,
        excused: rows.filter((r) => r.new_status === 'excused').length,
        finalized: true,
      };

      console.log(`[Attendance] Class ${classId} finalized:`, summary);

      return summary;
    } catch (err) {
      console.error('[Attendance] finalizeClassAttendance error:', err);
      return null;
    }
  },

  // ────────────────────────────────────────────────────────────────────────
  //  Get Attendance Records
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Get all attendance records for a class.
   *
   * @param classId - The UUID of the live_classes row.
   *
   * @returns Array of attendance records with student names resolved.
   */
  async getClassAttendance(
    classId: string,
  ): Promise<(AttendanceRecord & { studentName?: string })[]> {
    try {
      const { data, error } = await supabase
        .from('attendance')
        .select(`
          *,
          student_details(
            profiles(name)
          )
        `)
        .eq('class_id', classId)
        .order('updated_at', { ascending: false });

      if (error || !data) {
        console.error('[Attendance] Failed to fetch class attendance:', error?.message);
        return [];
      }

      return (data as any[]).map((row: any) => ({
        attendanceId: row.attendance_id,
        classId: row.class_id,
        studentId: row.student_id,
        instituteId: row.institute_id,
        joinedAt: row.joined_at,
        leftAt: row.left_at,
        durationSeconds: row.duration_seconds ?? 0,
        attendanceStatus: (row.attendance_status || 'absent') as AttendanceStatus,
        joinCount: row.join_count ?? 0,
        isManualOverride: row.is_manual_override ?? false,
        overrideBy: row.override_by,
        overrideReason: row.override_reason,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        studentName: row.student_details?.profiles?.name ?? 'Unknown',
      }));
    } catch (err) {
      console.error('[Attendance] getClassAttendance error:', err);
      return [];
    }
  },

  // ────────────────────────────────────────────────────────────────────────
  //  Get Student Attendance
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Get a single student's attendance record for a class.
   *
   * @param classId   - The UUID of the live_classes row.
   * @param studentId - The UUID of the student (student_details.student_id).
   *
   * @returns The attendance record, or null if not found.
   */
  async getStudentAttendance(
    classId: string,
    studentId: string,
  ): Promise<AttendanceRecord | null> {
    try {
      const { data, error } = await supabase
        .from('attendance')
        .select('*')
        .eq('class_id', classId)
        .eq('student_id', studentId)
        .maybeSingle();

      if (error || !data) return null;

      return {
        attendanceId: data.attendance_id,
        classId: data.class_id,
        studentId: data.student_id,
        instituteId: data.institute_id,
        joinedAt: data.joined_at,
        leftAt: data.left_at,
        durationSeconds: data.duration_seconds ?? 0,
        attendanceStatus: (data.attendance_status || 'absent') as AttendanceStatus,
        joinCount: data.join_count ?? 0,
        isManualOverride: data.is_manual_override ?? false,
        overrideBy: data.override_by,
        overrideReason: data.override_reason,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    } catch (err) {
      console.error('[Attendance] getStudentAttendance error:', err);
      return null;
    }
  },

  // ────────────────────────────────────────────────────────────────────────
  //  Update Attendance Status (Manual Override)
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Manually override a student's attendance status.
   * Used by teachers/admins to mark excused absences or correct automatic
   * calculations.
   *
   * @param attendanceId - The UUID of the attendance record.
   * @param status       - The new attendance status.
   * @param overrideBy   - The profile_id of the teacher/admin making the change.
   * @param reason       - Optional reason for the override.
   *
   * @returns true if successful.
   */
  async overrideAttendanceStatus(
    attendanceId: string,
    status: AttendanceStatus,
    overrideBy: string,
    reason?: string,
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('attendance')
        .update({
          attendance_status: status,
          is_manual_override: true,
          override_by: overrideBy,
          override_reason: reason?.trim() ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('attendance_id', attendanceId);

      if (error) {
        console.error('[Attendance] Failed to override status:', error.message);
        return false;
      }

      return true;
    } catch (err) {
      console.error('[Attendance] overrideAttendanceStatus error:', err);
      return false;
    }
  },
};
