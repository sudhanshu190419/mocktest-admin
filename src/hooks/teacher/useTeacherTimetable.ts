'use client';

/**
 * Teacher Timetable Hooks
 *
 * Phase 2B — React Query hooks for the teacher timetable/calendar page.
 * Server state is owned by React Query (no Redux), matching the rest of the
 * app. Both queries are read-only and RLS-scoped to the current teacher.
 *
 * @module hooks/teacher/useTeacherTimetable
 */

import { useQuery } from '@tanstack/react-query';
import {
  getTeacherClassesInRange,
  getTeacherTimetableSlots,
} from '@/services/teacher/teacherTimetableService';
import type { LiveClassListItem } from '@/services/teacherLiveClassService';
import type { TimetableSlot } from '@/types/timetable';

// ═══════════════════════════════════════════════════════════════════════════
//  Query Keys
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Teacher timetable query keys.
 *
 * - `slots`   — recurring timetable rules for the teacher (rarely changes).
 * - `classes` — actual materialized/manual live_classes in a date window.
 *
 * Prefix invalidation (`{ queryKey: ['teacher-timetable', 'classes', teacherId] }`)
 * is used after a class starts so the calendar statuses refresh.
 */
export const teacherTimetableKeys = {
  slots: (teacherId: string) => ['teacher-timetable', 'slots', teacherId] as const,
  classes: (teacherId: string, fromIso: string, toIso: string) =>
    ['teacher-timetable', 'classes', teacherId, fromIso, toIso] as const,
};

// ═══════════════════════════════════════════════════════════════════════════
//  Hooks
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch the teacher's recurring timetable slots (Monday-first order).
 *
 * Only runs when a teacher id is available (authenticated teacher context).
 *
 * @param teacherId - teacher_details.teacher_id (from useAuth().teacherProfile).
 */
export function useTeacherTimetableSlots(teacherId: string | undefined) {
  return useQuery<TimetableSlot[]>({
    queryKey: teacherTimetableKeys.slots(teacherId ?? 'none'),
    queryFn: () => getTeacherTimetableSlots(teacherId as string),
    enabled: Boolean(teacherId),
    // Recurring rules change rarely (admin-side edits); 60s is safe.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Fetch the teacher's actual classes (all statuses) inside an ISO window.
 *
 * @param teacherId - teacher_details.teacher_id (from useAuth().teacherProfile).
 * @param fromIso   - Inclusive window start (e.g. Monday 00:00 local → ISO).
 * @param toIso     - Inclusive window end (e.g. Sunday 23:59:59 local → ISO).
 */
export function useTeacherClassesInRange(
  teacherId: string | undefined,
  fromIso: string,
  toIso: string,
) {
  return useQuery<LiveClassListItem[]>({
    queryKey: teacherTimetableKeys.classes(teacherId ?? 'none', fromIso, toIso),
    queryFn: () => getTeacherClassesInRange(teacherId as string, fromIso, toIso),
    enabled: Boolean(teacherId),
    // Class statuses change when the teacher starts/ends a class; keep fresh.
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}
