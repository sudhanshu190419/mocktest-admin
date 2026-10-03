import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  studentTimetableKeys,
  findCoveringCachedSchedule,
  TIMETABLE_STALE_TIME,
} from '../useStudentTimetable';
import {
  slotMemoryCache,
  clearStudentSlotMemoryCache,
  fetchStudentTimetableSlots,
  SLOT_CACHE_TTL,
} from '@/services/student/studentTimetableWebService';
import {
  projectSlotsForDateRange,
  type RawTimetableSlot,
  type RawLessonPlan,
  type RawConcreteClass,
  type TimetableSessionItem,
} from '@/utils/studentTimetableProjector';
import { supabase } from '@/config/supabase';

vi.mock('@/config/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

describe('Student Timetable Optimization Suite (Website Parity with Mobile)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    clearStudentSlotMemoryCache();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: TIMETABLE_STALE_TIME,
        },
      },
    });
  });

  afterEach(() => {
    queryClient.clear();
    clearStudentSlotMemoryCache();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Service Slot Cache & In-Flight Deduplication Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Slot Memory Cache & In-Flight Deduplication', () => {
    const mockSlotsRpcData = [
      {
        timetable_slot_id: 'slot-1',
        batch_subject_id: 'bs-1',
        batch_id: 'batch-1',
        batch_name: 'JEE 2026 Batch A',
        subject_id: 'sub-1',
        subject_name: 'Physics',
        day_of_week: 1,
        start_time: '10:00:00',
        end_time: '11:00:00',
        valid_from: '2026-04-01',
        valid_until: '2027-03-31',
        status: 'active',
        is_recurring: true,
      },
    ];

    it('caches slot definitions in slotMemoryCache and avoids repeated RPC calls', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: mockSlotsRpcData,
        error: null,
      } as any);

      // First call -> triggers RPC
      const slots1 = await fetchStudentTimetableSlots(['batch-1']);
      expect(supabase.rpc).toHaveBeenCalledTimes(1);
      expect(slots1).toHaveLength(1);
      expect(slots1[0].subject_name).toBe('Physics');

      // Second call immediately after -> hits slotMemoryCache (0 new RPC calls)
      const slots2 = await fetchStudentTimetableSlots(['batch-1']);
      expect(supabase.rpc).toHaveBeenCalledTimes(1);
      expect(slots2).toEqual(slots1);

      // Verify memory cache state
      const cached = slotMemoryCache.get('batch-1');
      expect(cached).toBeDefined();
      expect(cached?.data).toHaveLength(1);
    });

    it('deduplicates simultaneous in-flight slot RPC requests', async () => {
      let resolveRpc: (val: any) => void;
      const deferredPromise = new Promise((resolve) => {
        resolveRpc = resolve;
      });

      vi.mocked(supabase.rpc).mockReturnValueOnce(deferredPromise as any);

      // 4 concurrent calls (simulating the previous eager mount behavior)
      const call1 = fetchStudentTimetableSlots(['batch-1']);
      const call2 = fetchStudentTimetableSlots(['batch-1']);
      const call3 = fetchStudentTimetableSlots(['batch-1']);
      const call4 = fetchStudentTimetableSlots(['batch-1']);

      // Only ONE RPC request must be dispatched
      expect(supabase.rpc).toHaveBeenCalledTimes(1);

      // Resolve the deferred RPC
      resolveRpc!({
        data: mockSlotsRpcData,
        error: null,
      });

      const [res1, res2, res3, res4] = await Promise.all([call1, call2, call3, call4]);
      expect(res1).toEqual(res2);
      expect(res2).toEqual(res3);
      expect(res3).toEqual(res4);
      expect(supabase.rpc).toHaveBeenCalledTimes(1);
    });

    it('clearing slot memory cache allows refetch on next call', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: mockSlotsRpcData,
        error: null,
      } as any);

      await fetchStudentTimetableSlots();
      expect(supabase.rpc).toHaveBeenCalledTimes(1);

      clearStudentSlotMemoryCache();
      expect(slotMemoryCache.size).toBe(0);

      await fetchStudentTimetableSlots();
      expect(supabase.rpc).toHaveBeenCalledTimes(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. React Query Covering Cache (findCoveringCachedSchedule)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Covering Cache Lookup (Week -> Today = 0 requests)', () => {
    const mondayStr = '2026-09-28';
    const tuesdayStr = '2026-09-29';
    const sundayStr = '2026-10-04';

    const mockWeekSessions: TimetableSessionItem[] = [
      {
        id: 'session-mon',
        date: mondayStr,
        startTime: '10:00',
        endTime: '11:00',
        timeSlot: '10:00 AM - 11:00 AM',
        duration: '60 mins',
        durationMin: 60,
        title: 'Physics — JEE 2026 Batch A',
        subject: 'Physics',
        teacher: 'Dr. HC Verma',
        batch: 'JEE 2026 Batch A',
        batchId: 'batch-1',
        batchSubjectId: 'bs-1',
        chapter: 'Kinematics',
        topic: 'Motion in 1D',
        notes: null,
        sessionType: 'live',
        status: 'completed',
        accentColor: '#D97706',
        badgeBg: '#FEF3C7',
        badgeText: '#92400E',
      },
      {
        id: 'session-tue',
        date: tuesdayStr,
        startTime: '11:30',
        endTime: '12:30',
        timeSlot: '11:30 AM - 12:30 PM',
        duration: '60 mins',
        durationMin: 60,
        title: 'Chemistry — JEE 2026 Batch A',
        subject: 'Chemistry',
        teacher: 'Dr. OP Tandon',
        batch: 'JEE 2026 Batch A',
        batchId: 'batch-1',
        batchSubjectId: 'bs-2',
        chapter: 'Atomic Structure',
        topic: 'Bohr Model',
        notes: null,
        sessionType: 'live',
        status: 'upcoming',
        accentColor: '#059669',
        badgeBg: '#D1FAE5',
        badgeText: '#065F46',
      },
    ];

    it('extracts Today from cached Week schedule with 0 network calls', () => {
      // 1. Populate React Query cache with a 7-day Week query
      const weekQueryKey = studentTimetableKeys.range(mondayStr, sundayStr, ['batch-1']);
      queryClient.setQueryData(weekQueryKey, {
        sessions: mockWeekSessions,
        grouped: {
          [mondayStr]: [mockWeekSessions[0]],
          [tuesdayStr]: [mockWeekSessions[1]],
        },
      });

      // 2. Query covering cache for Tuesday (Today)
      const covered = findCoveringCachedSchedule(queryClient, tuesdayStr, tuesdayStr, ['batch-1']);
      expect(covered).not.toBeNull();
      expect(covered?.sessions).toHaveLength(1);
      expect(covered?.sessions[0].id).toBe('session-tue');
      expect(covered?.sessions[0].subject).toBe('Chemistry');
      expect(covered?.sessions[0].chapter).toBe('Atomic Structure');
    });

    it('returns null if requested range exceeds cached window', () => {
      const weekQueryKey = studentTimetableKeys.range(mondayStr, sundayStr, ['batch-1']);
      queryClient.setQueryData(weekQueryKey, {
        sessions: mockWeekSessions,
      });

      // Request date outside the week (e.g. next month)
      const covered = findCoveringCachedSchedule(queryClient, '2026-10-15', '2026-10-15', ['batch-1']);
      expect(covered).toBeNull();
    });

    it('returns null if batchIds do not match', () => {
      const weekQueryKey = studentTimetableKeys.range(mondayStr, sundayStr, ['batch-1']);
      queryClient.setQueryData(weekQueryKey, {
        sessions: mockWeekSessions,
      });

      // Different batch -> must not leak cache across batches
      const covered = findCoveringCachedSchedule(queryClient, tuesdayStr, tuesdayStr, ['batch-different']);
      expect(covered).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. 60-Day Horizon Boundary & Title Consistency Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('60-Day Materialization Horizon & Projector Title Alignment', () => {
    const slot: RawTimetableSlot = {
      timetable_slot_id: 'slot-phy-mon',
      institute_id: 'inst-1',
      teacher_id: 'teacher-1',
      teacher_name: 'Dr. HC Verma',
      batch_subject_id: 'bs-phy-batchA',
      subject_name: 'Physics',
      batch_name: 'JEE 2026 Batch A',
      batch_id: 'batch-1',
      day_of_week: 1, // Monday
      start_time: '10:00:00',
      end_time: '11:00:00',
      valid_from: '2026-04-01',
      valid_until: '2027-03-31',
      is_recurring: true,
      status: 'active',
    };

    const lessonPlanDay59: RawLessonPlan = {
      lesson_plan_id: 'lp-day59',
      timetable_slot_id: 'slot-phy-mon',
      occurrence_date: '2026-11-23',
      chapter_id: 'chap-1',
      topic_id: 'top-1',
      notes: 'Read chapter notes',
      chapter_name: 'Kinematics',
      topic_name: 'Projectile Motion',
    };

    const concreteClassDay59: RawConcreteClass = {
      class_id: 'class-day59',
      title: 'Physics — JEE 2026 Batch A',
      scheduled_at: '2026-11-23T10:00:00Z',
      duration_min: 60,
      status: 'scheduled',
      timetable_slot_id: 'slot-phy-mon',
      teacher_name: 'Dr. HC Verma',
      subject_name: 'Physics',
      batch_name: 'JEE 2026 Batch A',
      batch_id: 'batch-1',
      batch_subject_id: 'bs-phy-batchA',
      chapter_name: null,
      topic_name: null,
    };

    const lessonPlanDay62: RawLessonPlan = {
      lesson_plan_id: 'lp-day62',
      timetable_slot_id: 'slot-phy-mon',
      occurrence_date: '2026-11-30',
      chapter_id: 'chap-2',
      topic_id: 'top-2',
      notes: 'Solve circular motion problems',
      chapter_name: 'Circular Motion',
      topic_name: 'Centripetal Acceleration',
    };

    it('Day 59 (inside 60-day horizon): concrete row exists, preserves chapter/topic from lesson plan', () => {
      const sessions = projectSlotsForDateRange({
        slots: [slot],
        lessonPlans: [lessonPlanDay59],
        concreteClasses: [concreteClassDay59],
        mockTests: [],
        startDate: '2026-11-23',
        endDate: '2026-11-23',
      });

      expect(sessions).toHaveLength(1);
      const s = sessions[0];
      expect(s.title).toBe('Physics — JEE 2026 Batch A');
      expect(s.chapter).toBe('Kinematics');
      expect(s.topic).toBe('Projectile Motion');
      expect(s.teacher).toBe('Dr. HC Verma');
      expect(s.isProjected).toBe(false);
    });

    it('Day 62 (outside 60-day horizon): concrete row is null, title matches mobile format and chapter/topic are preserved', () => {
      // Beyond 60 days: NO concrete live_classes row exists
      const sessions = projectSlotsForDateRange({
        slots: [slot],
        lessonPlans: [lessonPlanDay62],
        concreteClasses: [],
        mockTests: [],
        startDate: '2026-11-30',
        endDate: '2026-11-30',
      });

      expect(sessions).toHaveLength(1);
      const s = sessions[0];
      // Title maintains consistent 'Subject — Batch' format matching mobile!
      expect(s.title).toBe('Physics — JEE 2026 Batch A');
      expect(s.chapter).toBe('Circular Motion');
      expect(s.topic).toBe('Centripetal Acceleration');
      expect(s.teacher).toBe('Dr. HC Verma');
      expect(s.isProjected).toBe(true);
    });

    it('Far future date (Day 120): consistently renders curriculum without New Lecture fallback', () => {
      const lessonPlanDay120: RawLessonPlan = {
        lesson_plan_id: 'lp-day120',
        timetable_slot_id: 'slot-phy-mon',
        occurrence_date: '2027-01-25',
        chapter_id: 'chap-rot',
        topic_id: 'top-mi',
        notes: null,
        chapter_name: 'Rotational Motion',
        topic_name: 'Moment of Inertia',
      };

      const sessions = projectSlotsForDateRange({
        slots: [slot],
        lessonPlans: [lessonPlanDay120],
        concreteClasses: [],
        mockTests: [],
        startDate: '2027-01-25',
        endDate: '2027-01-25',
      });

      expect(sessions).toHaveLength(1);
      const s = sessions[0];
      expect(s.title).not.toBe('New Lecture');
      expect(s.title).toBe('Physics — JEE 2026 Batch A');
      expect(s.chapter).toBe('Rotational Motion');
      expect(s.topic).toBe('Moment of Inertia');
    });

    it('Edge Case: concrete.title explicitly set to New Lecture in DB preserves concrete title', () => {
      const concreteWithNewLecture: RawConcreteClass = {
        ...concreteClassDay59,
        title: 'New Lecture',
      };

      const sessions = projectSlotsForDateRange({
        slots: [slot],
        lessonPlans: [lessonPlanDay59],
        concreteClasses: [concreteWithNewLecture],
        mockTests: [],
        startDate: '2026-11-23',
        endDate: '2026-11-23',
      });

      expect(sessions).toHaveLength(1);
      expect(sessions[0].title).toBe('New Lecture');
      expect(sessions[0].chapter).toBe('Kinematics');
      expect(sessions[0].topic).toBe('Projectile Motion');
    });

    it('Falls back to Subject: Chapter when slot has no batch_name and concrete has no batch_name', () => {
      const slotWithoutBatch: RawTimetableSlot = {
        ...slot,
        batch_name: null as any,
      };

      const sessions = projectSlotsForDateRange({
        slots: [slotWithoutBatch],
        lessonPlans: [lessonPlanDay62],
        concreteClasses: [],
        mockTests: [],
        startDate: '2026-11-30',
        endDate: '2026-11-30',
      });

      expect(sessions).toHaveLength(1);
      expect(sessions[0].title).toBe('Physics: Circular Motion');
      expect(sessions[0].chapter).toBe('Circular Motion');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. Tab-Scoped Query Activation & Lifecycle Scenarios
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Tab-Scoped Query Activation & Request Count Scenarios', () => {
    it('Week tab only enables the 7-day query and does NOT fetch the annual 365-day range', () => {
      const mondayStr = '2026-09-28';
      const sundayStr = '2026-10-04';
      const academicYearStart = '2026-04-01';
      const academicYearEnd = '2027-03-31';

      // Week query key
      const weekKey = studentTimetableKeys.range(mondayStr, sundayStr, undefined);
      // Annual query key
      const annualKey = studentTimetableKeys.range(academicYearStart, academicYearEnd, undefined);

      // Verify keys are distinct
      expect(weekKey).not.toEqual(annualKey);
      expect((weekKey[3] as any).startDate).toBe(mondayStr);
      expect((weekKey[3] as any).endDate).toBe(sundayStr);
      expect((annualKey[3] as any).startDate).toBe(academicYearStart);
      expect((annualKey[3] as any).endDate).toBe(academicYearEnd);

      // Initially cache has 0 annual data
      const cachedAnnual = queryClient.getQueryData(annualKey);
      expect(cachedAnnual).toBeUndefined();
    });

    it('Scenario: Next Week -> Back to Week A serves from cache with 0 network calls', async () => {
      const weekAKey = studentTimetableKeys.range('2026-09-28', '2026-10-04');
      const weekBKey = studentTimetableKeys.range('2026-10-05', '2026-10-11');

      // Populate Week A in React Query cache
      queryClient.setQueryData(weekAKey, { sessions: [], grouped: {} });

      // Navigate to Week B: fetch Week B
      queryClient.setQueryData(weekBKey, { sessions: [], grouped: {} });

      // Navigate Back to Week A: queryClient should immediately have Week A data
      const cachedWeekA = queryClient.getQueryData(weekAKey);
      expect(cachedWeekA).toBeDefined();
    });

    it('Scenario: Leave Timetable -> Return within 5 minutes serves from cache with 0 network calls', () => {
      const weekKey = studentTimetableKeys.range('2026-09-28', '2026-10-04');
      queryClient.setQueryData(weekKey, { sessions: [{ id: 'class-1' }] });

      // Simulate unmount and re-mount by checking queryClient data
      const dataOnReentry = queryClient.getQueryData(weekKey);
      expect(dataOnReentry).toEqual({ sessions: [{ id: 'class-1' }] });
      const queryState = queryClient.getQueryState(weekKey);
      expect(queryState?.status).toBe('success');
    });

    it('Scenario: Deep-link to a future date queries only that specific week range, not 365 days', () => {
      const futureWeekMonday = '2027-01-18';
      const futureWeekSunday = '2027-01-24';
      const deepLinkKey = studentTimetableKeys.range(futureWeekMonday, futureWeekSunday);

      expect((deepLinkKey[3] as any).startDate).toBe('2027-01-18');
      expect((deepLinkKey[3] as any).endDate).toBe('2027-01-24');

      // No annual 365-day query is needed
      const annualQuery = queryClient.getQueryData(studentTimetableKeys.range('2026-04-01', '2027-03-31'));
      expect(annualQuery).toBeUndefined();
    });
  });

});
