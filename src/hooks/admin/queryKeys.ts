/**
 * Admin Query Key Factory
 *
 * Centralised, stable query key definitions for the Admin Dashboard module.
 * Every hook in this module derives its keys from this factory so that
 * cache invalidation is always consistent.
 *
 * Follows the same pattern as hooks/mockTest/queryKeys.ts.
 *
 * @module hooks/admin/queryKeys
 */

// ═══════════════════════════════════════════════════════════════════════════
//  adminKeys — Admin Dashboard
// ═══════════════════════════════════════════════════════════════════════════

export const adminKeys = {
  all: ['admin'] as const,

  // ═════════════════════════════════════════════════════════════════════════
  //  Timetable (admin Timetable module)
  // ═════════════════════════════════════════════════════════════════════════

  timetable: {
    /** Root key for all timetable queries. */
    all: () => [...adminKeys.all, 'timetable'] as const,

    /** Key for every timetable list query (broad invalidation). */
    lists: () => [...adminKeys.timetable.all(), 'list'] as const,

    /** Key for a specific paginated timetable slot list. */
    list: (filters?: Record<string, unknown>, pagination?: Record<string, unknown>) =>
      [...adminKeys.timetable.lists(), filters, pagination] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Lesson Plans (admin Lesson Planner module)
  // ═════════════════════════════════════════════════════════════════════════

  lessonPlans: {
    /** Root key for all lesson-plan queries. */
    all: () => [...adminKeys.all, 'lessonPlans'] as const,

    /** Key for every lesson-plan range query (broad invalidation). */
    lists: () => [...adminKeys.lessonPlans.all(), 'list'] as const,

    /** Key for a specific slot × date-range lesson-plan query. */
    list: (timetableSlotId?: string, from?: string, to?: string) =>
      [...adminKeys.lessonPlans.lists(), timetableSlotId, from, to] as const,

    /** Class-status projection for a slot × date range. */
    classStatuses: {
      /** Root key for all class-status queries. */
      all: () => [...adminKeys.lessonPlans.all(), 'classStatuses'] as const,

      /** Key for a specific slot × date-range class-status query. */
      list: (timetableSlotId?: string, from?: string, to?: string) =>
        [...adminKeys.lessonPlans.classStatuses.all(), timetableSlotId, from, to] as const,
    },

    /** Subject resolution for a batch_subject (chapter/topic scoping). */
    subject: (batchSubjectId?: string) =>
      [...adminKeys.lessonPlans.all(), 'subject', batchSubjectId] as const,

    /** Holiday/teacher-leave skip dates for a slot's teacher × date range. */
    skips: {
      /** Root key for all skip queries. */
      all: () => [...adminKeys.lessonPlans.all(), 'skips'] as const,

      /** Key for a specific institute × teacher × date-range skip query. */
      list: (instituteId?: string, teacherId?: string, from?: string, to?: string) =>
        [...adminKeys.lessonPlans.skips.all(), instituteId, teacherId, from, to] as const,
    },

    /** Earliest future lesson plan per slot (admin Timetable next-lesson badge). */
    next: {
      /** Root key for all next-lesson queries. */
      all: () => [...adminKeys.lessonPlans.all(), 'next'] as const,

      /** Key for a specific set of slots × from date. */
      list: (slotIds: string[], from?: string) =>
        [...adminKeys.lessonPlans.next.all(), slotIds, from] as const,
    },
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Dashboard
  // ═════════════════════════════════════════════════════════════════════════

  dashboard: {
    /** Root key for all dashboard queries. */
    all: () => [...adminKeys.all, 'dashboard'] as const,

    /** Key for every dashboard data query (broad invalidation). */
    lists: () => [...adminKeys.dashboard.all(), 'list'] as const,

    /** Key for a specific dashboard data query (keyed by instituteId). */
    list: (instituteId?: string | null) =>
      [...adminKeys.dashboard.lists(), instituteId] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Demo Classes (admin Demo Classes module)
  // ═════════════════════════════════════════════════════════════════════════

  demoClasses: {
    /** Root key for all demo class queries. */
    all: () => [...adminKeys.all, 'demoClasses'] as const,

    /** Key for every demo class list query (broad invalidation). */
    lists: () => [...adminKeys.demoClasses.all(), 'list'] as const,

    /** Key for a specific paginated demo class list. */
    list: (filters?: Record<string, unknown>, pagination?: Record<string, unknown>) =>
      [...adminKeys.demoClasses.lists(), filters, pagination] as const,

    /** Key for every demo class detail query. */
    details: () => [...adminKeys.demoClasses.all(), 'detail'] as const,

    /** Key for a single demo class detail by demoClassId. */
    detail: (demoClassId: string) =>
      [...adminKeys.demoClasses.details(), demoClassId] as const,

    /** Key for signed URL of a demo class video. */
    signedUrl: (demoClassId: string) =>
      [...adminKeys.demoClasses.all(), 'signedUrl', demoClassId] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Teachers (admin view)
  // ═════════════════════════════════════════════════════════════════════════

  teachers: {
    all: () => [...adminKeys.all, 'teachers'] as const,
    lists: () => [...adminKeys.teachers.all(), 'list'] as const,
    list: (filters?: Record<string, unknown>) =>
      [...adminKeys.teachers.lists(), filters] as const,
    details: () => [...adminKeys.teachers.all(), 'detail'] as const,
    detail: (id: string) => [...adminKeys.teachers.details(), id] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Students (admin view)
  // ═════════════════════════════════════════════════════════════════════════

  students: {
    all: () => [...adminKeys.all, 'students'] as const,
    lists: () => [...adminKeys.students.all(), 'list'] as const,
    list: (filters?: Record<string, unknown>) =>
      [...adminKeys.students.lists(), filters] as const,
    details: () => [...adminKeys.students.all(), 'detail'] as const,
    detail: (id: string) => [...adminKeys.students.details(), id] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Approvals (admin view)
  // ═════════════════════════════════════════════════════════════════════════

  approvals: {
    all: () => [...adminKeys.all, 'approvals'] as const,
    lists: () => [...adminKeys.approvals.all(), 'list'] as const,
    list: (filters?: Record<string, unknown>) =>
      [...adminKeys.approvals.lists(), filters] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Live Classes (admin view)
  // ═════════════════════════════════════════════════════════════════════════

  liveClasses: {
    all: () => [...adminKeys.all, 'liveClasses'] as const,
    lists: () => [...adminKeys.liveClasses.all(), 'list'] as const,
    list: (filters?: Record<string, unknown>) =>
      [...adminKeys.liveClasses.lists(), filters] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Question Approval (admin Question Approval module)
  // ═════════════════════════════════════════════════════════════════════════

  questionApproval: {
    /** Root key for all question approval queries. */
    all: () => [...adminKeys.all, 'questionApproval'] as const,

    /** Key for every question approval list query (broad invalidation). */
    lists: () => [...adminKeys.questionApproval.all(), 'list'] as const,

    /** Key for a specific paginated question approval list. */
    list: (filters?: Record<string, unknown>, pagination?: Record<string, unknown>) =>
      [...adminKeys.questionApproval.lists(), filters, pagination] as const,

    /** Key for every question approval detail query. */
    details: () => [...adminKeys.questionApproval.all(), 'detail'] as const,

    /** Key for a single question approval detail by questionId. */
    detail: (questionId: string) =>
      [...adminKeys.questionApproval.details(), questionId] as const,

    /** Key for dashboard counts. */
    counts: () => [...adminKeys.questionApproval.all(), 'counts'] as const,

    /** Key for statistics. */
    stats: () => [...adminKeys.questionApproval.all(), 'stats'] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Teacher Lifecycle (admin Teacher Management)
  // ═════════════════════════════════════════════════════════════════════════

  teacherLifecycle: {
    /** Root key for all teacher lifecycle queries. */
    all: () => [...adminKeys.all, 'teacherLifecycle'] as const,

    /** Key for every teacher lifecycle list query (broad invalidation). */
    lists: () => [...adminKeys.teacherLifecycle.all(), 'list'] as const,

    /** Key for a specific paginated teacher list. */
    list: (filters?: Record<string, unknown>, pagination?: Record<string, unknown>) =>
      [...adminKeys.teacherLifecycle.lists(), filters, pagination] as const,

    /** Key for every teacher lifecycle detail query. */
    details: () => [...adminKeys.teacherLifecycle.all(), 'detail'] as const,

    /** Key for a single teacher detail by profileId. */
    detail: (profileId: string) =>
      [...adminKeys.teacherLifecycle.details(), profileId] as const,

    /** Key for dashboard counts. */
    counts: () => [...adminKeys.teacherLifecycle.all(), 'counts'] as const,

    /** Key for statistics. */
    stats: () => [...adminKeys.teacherLifecycle.all(), 'stats'] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Student Lifecycle (admin Student Management)
  // ═════════════════════════════════════════════════════════════════════════

  studentLifecycle: {
    /** Root key for all student lifecycle queries. */
    all: () => [...adminKeys.all, 'studentLifecycle'] as const,

    /** Key for every student lifecycle list query (broad invalidation). */
    lists: () => [...adminKeys.studentLifecycle.all(), 'list'] as const,

    /** Key for a specific paginated student list. */
    list: (filters?: Record<string, unknown>, pagination?: Record<string, unknown>) =>
      [...adminKeys.studentLifecycle.lists(), filters, pagination] as const,

    /** Key for every student lifecycle detail query. */
    details: () => [...adminKeys.studentLifecycle.all(), 'detail'] as const,

    /** Key for a single student detail by profileId. */
    detail: (profileId: string) =>
      [...adminKeys.studentLifecycle.details(), profileId] as const,

    /** Key for dashboard counts. */
    counts: () => [...adminKeys.studentLifecycle.all(), 'counts'] as const,

    /** Key for statistics. */
    stats: () => [...adminKeys.studentLifecycle.all(), 'stats'] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Batch Student Assignment (admin Batch Student Assignment module)
  // ═════════════════════════════════════════════════════════════════════════

  batchStudentAssignment: {
    /** Root key for all batch student assignment queries. */
    all: () => [...adminKeys.all, 'batchStudentAssignment'] as const,

    /** Key for every assigned-students list query (broad invalidation). */
    assigned: () => [...adminKeys.batchStudentAssignment.all(), 'assigned'] as const,

    /** Key for assigned students of a specific batch. */
    assignedList: (batchId: string) =>
      [...adminKeys.batchStudentAssignment.assigned(), batchId] as const,

    /** Key for every available-students list query. */
    available: () => [...adminKeys.batchStudentAssignment.all(), 'available'] as const,

    /** Key for available students for a specific batch. */
    availableList: (batchId: string) =>
      [...adminKeys.batchStudentAssignment.available(), batchId] as const,

    /** Key for every batch assignment stats query. */
    stats: () => [...adminKeys.batchStudentAssignment.all(), 'stats'] as const,

    /** Key for assignment stats of a specific batch. */
    statsList: (batchId: string) =>
      [...adminKeys.batchStudentAssignment.stats(), batchId] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Batch Management (admin Batch Management module)
  // ═════════════════════════════════════════════════════════════════════════

  batchManagement: {
    /** Root key for all batch management queries. */
    all: () => [...adminKeys.all, 'batchManagement'] as const,

    /** Key for every batch list query (broad invalidation). */
    lists: () => [...adminKeys.batchManagement.all(), 'list'] as const,

    /** Key for a specific paginated batch list. */
    list: (filters?: Record<string, unknown>, pagination?: Record<string, unknown>) =>
      [...adminKeys.batchManagement.lists(), filters, pagination] as const,

    /** Key for every batch detail query. */
    details: () => [...adminKeys.batchManagement.all(), 'detail'] as const,

    /** Key for a single batch detail by batchId. */
    detail: (batchId: string) =>
      [...adminKeys.batchManagement.details(), batchId] as const,

    /** Key for dashboard counts. */
    counts: () => [...adminKeys.batchManagement.all(), 'counts'] as const,

    /** Key for statistics. */
    stats: () => [...adminKeys.batchManagement.all(), 'stats'] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Mock Test Management (admin Mock Test Management module)
  // ═════════════════════════════════════════════════════════════════════════

  // ═════════════════════════════════════════════════════════════════════════
  //  Mock Test Assignment (admin Mock Test Assignment module)
  // ═════════════════════════════════════════════════════════════════════════

  mockTestAssignment: {
    /** Root key for all mock test assignment queries. */
    all: () => [...adminKeys.all, 'mockTestAssignment'] as const,

    /** Key for every assigned-tests list query (broad invalidation). */
    assigned: () => [...adminKeys.mockTestAssignment.all(), 'assigned'] as const,

    /** Key for assigned tests of a specific batch. */
    assignedTests: (batchId: string) =>
      [...adminKeys.mockTestAssignment.assigned(), batchId] as const,

    /** Key for every available-tests list query. */
    available: () => [...adminKeys.mockTestAssignment.all(), 'available'] as const,

    /** Key for available tests for a specific batch. */
    availableTests: (batchId: string) =>
      [...adminKeys.mockTestAssignment.available(), batchId] as const,

    /** Key for assignment stats of a specific batch. */
    stats: (batchId: string) =>
      [...adminKeys.mockTestAssignment.all(), 'stats', batchId] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Mock Test Management (admin Mock Test Management module)
  // ═════════════════════════════════════════════════════════════════════════

  mockTestManagement: {
    /** Root key for all mock test management queries. */
    all: () => [...adminKeys.all, 'mockTestManagement'] as const,

    /** Key for every mock test list query (broad invalidation). */
    lists: () => [...adminKeys.mockTestManagement.all(), 'list'] as const,

    /** Key for a specific paginated mock test list. */
    list: (filters?: Record<string, unknown>, pagination?: Record<string, unknown>) =>
      [...adminKeys.mockTestManagement.lists(), filters, pagination] as const,

    /** Key for every mock test detail query. */
    details: () => [...adminKeys.mockTestManagement.all(), 'detail'] as const,

    /** Key for a single mock test detail by testId. */
    detail: (testId: string) =>
      [...adminKeys.mockTestManagement.details(), testId] as const,

    /** Key for dashboard counts. */
    counts: () => [...adminKeys.mockTestManagement.all(), 'counts'] as const,

    /** Key for statistics. */
    stats: () => [...adminKeys.mockTestManagement.all(), 'stats'] as const,

    /** Key for every test questions query (broad invalidation). */
    questions: (testId: string) =>
      [...adminKeys.mockTestManagement.detail(testId), 'questions'] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Course Management (admin Course Management module)
  // ═════════════════════════════════════════════════════════════════════════

  courseManagement: {
    /** Root key for all course management queries. */
    all: () => [...adminKeys.all, 'courseManagement'] as const,

    /** Key for every course list query (broad invalidation). */
    lists: () => [...adminKeys.courseManagement.all(), 'list'] as const,

    /** Key for a specific paginated course list. */
    list: (filters?: Record<string, unknown>, pagination?: Record<string, unknown>) =>
      [...adminKeys.courseManagement.lists(), filters, pagination] as const,

    /** Key for every course detail query. */
    details: () => [...adminKeys.courseManagement.all(), 'detail'] as const,

    /** Key for a single course detail by courseId. */
    detail: (courseId: string) =>
      [...adminKeys.courseManagement.details(), courseId] as const,

    /** Key for dashboard counts. */
    counts: () => [...adminKeys.courseManagement.all(), 'counts'] as const,

    /** Key for statistics. */
    stats: () => [...adminKeys.courseManagement.all(), 'stats'] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Course Teacher Assignment (admin Course Teacher Assignment module)
  // ═════════════════════════════════════════════════════════════════════════

  // ═════════════════════════════════════════════════════════════════════════
  //  Course Batch Assignment (admin Course Batch Assignment module)
  // ═════════════════════════════════════════════════════════════════════════

  courseBatchAssignment: {
    /** Root key for all course batch assignment queries. */
    all: () => [...adminKeys.all, 'courseBatchAssignment'] as const,

    /** Key for every assigned-batches list query (broad invalidation). */
    assigned: () => [...adminKeys.courseBatchAssignment.all(), 'assigned'] as const,

    /** Key for assigned batches of a specific course. */
    assignedBatches: (courseId: string) =>
      [...adminKeys.courseBatchAssignment.assigned(), courseId] as const,

    /** Key for every available-batches list query. */
    available: () => [...adminKeys.courseBatchAssignment.all(), 'available'] as const,

    /** Key for available batches for a specific course. */
    availableBatches: (courseId: string) =>
      [...adminKeys.courseBatchAssignment.available(), courseId] as const,

    /** Key for assignment stats of a specific course. */
    stats: (courseId: string) =>
      [...adminKeys.courseBatchAssignment.all(), 'stats', courseId] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Course Content Assignment (admin Course Content Assignment module)
  //  ── DEPRECATED in favor of batchContentAssignment below.
  //  Kept for backward compatibility during migration phase.
  //  Will be removed in Phase 2 after full verification.
  // ═════════════════════════════════════════════════════════════════════════

  courseContentAssignment: {
    /** Root key for all course content assignment queries. */
    all: () => [...adminKeys.all, 'courseContentAssignment'] as const,

    /** Key for every assigned-content list query (broad invalidation). */
    assigned: () => [...adminKeys.courseContentAssignment.all(), 'assigned'] as const,

    /** Key for assigned content of a specific course. */
    assignedContent: (courseId: string) =>
      [...adminKeys.courseContentAssignment.assigned(), courseId] as const,

    /** Key for every available-content list query. */
    available: () => [...adminKeys.courseContentAssignment.all(), 'available'] as const,

    /** Key for available content for a specific course. */
    availableContent: (courseId: string) =>
      [...adminKeys.courseContentAssignment.available(), courseId] as const,

    /** Key for assignment stats of a specific course. */
    stats: (courseId: string) =>
      [...adminKeys.courseContentAssignment.all(), 'stats', courseId] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Batch Content Assignment (admin Batch Content Assignment module)
  // ═════════════════════════════════════════════════════════════════════════

  batchContentAssignment: {
    /** Root key for all batch content assignment queries. */
    all: () => [...adminKeys.all, 'batchContentAssignment'] as const,

    /** Key for every assigned-content list query (broad invalidation). */
    assigned: () => [...adminKeys.batchContentAssignment.all(), 'assigned'] as const,

    /** Key for assigned content of a specific batch. */
    assignedContent: (batchId: string) =>
      [...adminKeys.batchContentAssignment.assigned(), batchId] as const,

    /** Key for every available-content list query. */
    available: () => [...adminKeys.batchContentAssignment.all(), 'available'] as const,

    /** Key for available content for a specific batch. */
    availableContent: (batchId: string) =>
      [...adminKeys.batchContentAssignment.available(), batchId] as const,

    /** Key for assignment stats of a specific batch. */
    stats: (batchId: string) =>
      [...adminKeys.batchContentAssignment.all(), 'stats', batchId] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Batch Subject Mock Test Assignment (admin Batch Subject Mock Test module)
  // ═════════════════════════════════════════════════════════════════════════

  batchSubjectMockTestAssignment: {
    /** Root key for all batch subject mock test assignment queries. */
    all: () => [...adminKeys.all, 'batchSubjectMockTestAssignment'] as const,

    /** Key for every assigned-tests list query (broad invalidation). */
    assigned: () =>
      [...adminKeys.batchSubjectMockTestAssignment.all(), 'assigned'] as const,

    /** Key for assigned tests of a specific batch subject. */
    assignedTests: (batchSubjectId: string) =>
      [...adminKeys.batchSubjectMockTestAssignment.assigned(), batchSubjectId] as const,

    /** Key for every available-tests list query. */
    available: () =>
      [...adminKeys.batchSubjectMockTestAssignment.all(), 'available'] as const,

    /** Key for available tests for a specific batch subject. */
    availableTests: (batchSubjectId: string) =>
      [...adminKeys.batchSubjectMockTestAssignment.available(), batchSubjectId] as const,

    /** Key for assignment stats of a specific batch subject. */
    stats: (batchSubjectId: string) =>
      [...adminKeys.batchSubjectMockTestAssignment.all(), 'stats', batchSubjectId] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Batch Subject Content Assignment (admin Batch Subject Content module)
  // ═════════════════════════════════════════════════════════════════════════

  batchSubjectContentAssignment: {
    /** Root key for all batch subject content assignment queries. */
    all: () => [...adminKeys.all, 'batchSubjectContentAssignment'] as const,

    /** Key for every assigned-content list query (broad invalidation). */
    assigned: () =>
      [...adminKeys.batchSubjectContentAssignment.all(), 'assigned'] as const,

    /** Key for assigned content of a specific batch subject. */
    assignedContent: (batchSubjectId: string) =>
      [...adminKeys.batchSubjectContentAssignment.assigned(), batchSubjectId] as const,

    /** Key for every available-content list query. */
    available: () =>
      [...adminKeys.batchSubjectContentAssignment.all(), 'available'] as const,

    /** Key for available content for a specific batch subject. */
    availableContent: (batchSubjectId: string) =>
      [...adminKeys.batchSubjectContentAssignment.available(), batchSubjectId] as const,

    /** Key for assignment stats of a specific batch subject. */
    stats: (batchSubjectId: string) =>
      [...adminKeys.batchSubjectContentAssignment.all(), 'stats', batchSubjectId] as const,

    /** Key for batch subject detail. */
    detail: (batchSubjectId: string) =>
      [...adminKeys.batchSubjectContentAssignment.all(), 'detail', batchSubjectId] as const,

    /** Key for batch subjects list (subjects within a batch). */
    subjectsList: (batchId: string) =>
      [...adminKeys.batchSubjectContentAssignment.all(), 'subjects', batchId] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Batch Subject Assignment (admin Batch Subject management — assign/remove
  //  subjects to/from a batch at the batch level)
  // ═════════════════════════════════════════════════════════════════════════

  batchSubjectAssignment: {
    /** Root key for all batch subject assignment queries. */
    all: () => [...adminKeys.all, 'batchSubjectAssignment'] as const,

    /** Key for every assigned-subjects list query (broad invalidation). */
    assigned: () => [...adminKeys.batchSubjectAssignment.all(), 'assigned'] as const,

    /** Key for assigned subjects of a specific batch. */
    assignedSubjects: (batchId: string) =>
      [...adminKeys.batchSubjectAssignment.assigned(), batchId] as const,

    /** Key for every available-subjects list query. */
    available: () => [...adminKeys.batchSubjectAssignment.all(), 'available'] as const,

    /** Key for available subjects for a specific batch. */
    availableSubjects: (batchId: string) =>
      [...adminKeys.batchSubjectAssignment.available(), batchId] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Batch Subject Teacher Assignment (admin Batch Subject Teacher Assignment)
  // ═════════════════════════════════════════════════════════════════════════

  batchSubjectTeacherAssignment: {
    /** Root key for all batch subject teacher assignment queries. */
    all: () => [...adminKeys.all, 'batchSubjectTeacherAssignment'] as const,

    /** Key for every batch-subject-teacher summary query (broad invalidation). */
    summary: () =>
      [...adminKeys.batchSubjectTeacherAssignment.all(), 'summary'] as const,

    /** Key for teacher summary of a specific batch. */
    batchSummary: (batchId: string) =>
      [...adminKeys.batchSubjectTeacherAssignment.summary(), batchId] as const,

    /** Key for assigned teachers of a specific batch subject. */
    assignedTeachers: (batchSubjectId: string) =>
      [...adminKeys.batchSubjectTeacherAssignment.all(), 'assigned', batchSubjectId] as const,

    /** Key for available teachers. */
    available: () =>
      [...adminKeys.batchSubjectTeacherAssignment.all(), 'available'] as const,

    /** Key for available teachers for a specific institute. */
    availableTeachers: (instituteId: string, search?: string) =>
      [...adminKeys.batchSubjectTeacherAssignment.available(), instituteId, search] as const,

    /** Key for stats. */
    stats: (instituteId: string) =>
      [...adminKeys.batchSubjectTeacherAssignment.all(), 'stats', instituteId] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Approval Workspace (admin centralized review hub)
  // ═════════════════════════════════════════════════════════════════════════

  approvalWorkspace: {
    /** Root key for all approval workspace queries. */
    all: () => [...adminKeys.all, 'approvalWorkspace'] as const,

    /** Key for the aggregated workspace statistics (keyed by instituteId). */
    stats: (instituteId?: string | null) =>
      [...adminKeys.approvalWorkspace.all(), 'stats', instituteId] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Teacher Leave (admin Teacher Leave Requests + Class Resolution module)
  // ═════════════════════════════════════════════════════════════════════════

  leaveRequests: {
    /** Root key for all teacher-leave queries. */
    all: () => [...adminKeys.all, 'leaveRequests'] as const,

    /** Key for every leave-request list query (broad invalidation). */
    lists: () => [...adminKeys.leaveRequests.all(), 'list'] as const,

    /** Key for a specific paginated + filtered leave-request list. */
    list: (filters?: Record<string, unknown>, pagination?: Record<string, unknown>) =>
      [...adminKeys.leaveRequests.lists(), filters, pagination] as const,

    /** Key for every leave-request detail query (broad invalidation). */
    details: () => [...adminKeys.leaveRequests.all(), 'detail'] as const,

    /** Key for a single leave-request detail by leaveId. */
    detail: (leaveId: string) =>
      [...adminKeys.leaveRequests.details(), leaveId] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Admin Management (admin Admin Management module — super admin only)
  // ═════════════════════════════════════════════════════════════════════════

  adminManagement: {
    /** Root key for all admin management queries. */
    all: () => [...adminKeys.all, 'adminManagement'] as const,

    /** Key for every admin users list query (broad invalidation). */
    lists: () => [...adminKeys.adminManagement.all(), 'list'] as const,

    /** Key for the admin users list (keyed by instituteId + search). */
    list: (instituteId: string | null, search?: string) =>
      [...adminKeys.adminManagement.lists(), instituteId, search] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Audit Logs (admin Audit Log Management — super admin only)
  // ═════════════════════════════════════════════════════════════════════════

  auditLogs: {
    /** Root key for all audit log queries. */
    all: () => [...adminKeys.all, 'auditLogs'] as const,

    /** Key for every audit log list query (broad invalidation). */
    lists: () => [...adminKeys.auditLogs.all(), 'list'] as const,

    /** Key for a specific paginated + filtered audit log list. */
    list: (
      instituteId: string | null,
      filters?: Record<string, unknown>,
      sort?: Record<string, unknown>,
      pagination?: Record<string, unknown>,
    ) =>
      [...adminKeys.auditLogs.lists(), instituteId, filters, sort, pagination] as const,

    /** Key for every audit log detail query. */
    details: () => [...adminKeys.auditLogs.all(), 'detail'] as const,

    /** Key for a single audit log detail by logId. */
    detail: (logId: string) =>
      [...adminKeys.auditLogs.details(), logId] as const,

    /** Key for dashboard summary counts. */
    summary: () => [...adminKeys.auditLogs.all(), 'summary'] as const,

    /** Key for a specific summary (keyed by instituteId). */
    summaryList: (instituteId: string | null) =>
      [...adminKeys.auditLogs.summary(), instituteId] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Trusted Devices (admin Trusted Device Management — super admin only)
  // ═════════════════════════════════════════════════════════════════════════

  trustedDevices: {
    /** Root key for all trusted device queries. */
    all: () => [...adminKeys.all, 'trustedDevices'] as const,

    /** Key for the pending approval queue (broad invalidation). */
    pending: () => [...adminKeys.trustedDevices.all(), 'pending'] as const,

    /** Key for the approved devices list. */
    approved: () => [...adminKeys.trustedDevices.all(), 'approved'] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Commerce (admin Commerce Verification module)
  // ═════════════════════════════════════════════════════════════════════════

  commerce: {
    /** Root key for all commerce queries. */
    all: () => [...adminKeys.all, 'commerce'] as const,

    /** Key for every commerce metrics query. */
    metrics: () => [...adminKeys.commerce.all(), 'metrics'] as const,

    /** Key for a specific commerce metrics query (keyed by instituteId). */
    metricsList: (instituteId?: string | null) =>
      [...adminKeys.commerce.metrics(), instituteId] as const,

    /** Key for every orders list query. */
    orders: () => [...adminKeys.commerce.all(), 'orders'] as const,

    /** Key for a specific paginated orders list. */
    ordersList: (filters?: Record<string, unknown>, pagination?: Record<string, unknown>) =>
      [...adminKeys.commerce.orders(), filters, pagination] as const,

    /** Key for every payments list query. */
    payments: () => [...adminKeys.commerce.all(), 'payments'] as const,

    /** Key for a specific paginated payments list. */
    paymentsList: (filters?: Record<string, unknown>, pagination?: Record<string, unknown>) =>
      [...adminKeys.commerce.payments(), filters, pagination] as const,

    /** Key for every course purchases list query. */
    coursePurchases: () => [...adminKeys.commerce.all(), 'coursePurchases'] as const,

    /** Key for a specific paginated course purchases list. */
    coursePurchasesList: (filters?: Record<string, unknown>, pagination?: Record<string, unknown>) =>
      [...adminKeys.commerce.coursePurchases(), filters, pagination] as const,

    /** Key for every PYQ purchases list query. */
    pyqPurchases: () => [...adminKeys.commerce.all(), 'pyqPurchases'] as const,

    /** Key for a specific paginated PYQ purchases list. */
    pyqPurchasesList: (filters?: Record<string, unknown>, pagination?: Record<string, unknown>) =>
      [...adminKeys.commerce.pyqPurchases(), filters, pagination] as const,

    /** Key for every student commerce query. */
    student: () => [...adminKeys.commerce.all(), 'student'] as const,

    /** Key for a specific student commerce query. */
    studentDetail: (profileId: string) =>
      [...adminKeys.commerce.student(), profileId] as const,

    /** Key for global search. */
    search: () => [...adminKeys.commerce.all(), 'search'] as const,

    /** Key for a specific global search query. */
    searchQuery: (query: string) =>
      [...adminKeys.commerce.search(), query] as const,

    /** Key for order detail. */
    orderDetail: () => [...adminKeys.commerce.all(), 'orderDetail'] as const,

    /** Key for a specific order detail. */
    orderDetailItem: (orderId: string) =>
      [...adminKeys.commerce.orderDetail(), orderId] as const,

    // ── Subscription Management (Phase 11K.8) ─────────────────────────

    // ── Subscription Plan Management (Phase 11K.9) ───────────────────

    /** Key for every subscription plan list query. */
    subscriptionPlans: () => [...adminKeys.commerce.all(), 'subscriptionPlans'] as const,

    /** Key for a specific paginated subscription plan list. */
    subscriptionPlansList: (filters?: Record<string, unknown>, pagination?: Record<string, unknown>) =>
      [...adminKeys.commerce.subscriptionPlans(), filters, pagination] as const,

    /** Key for every subscription metrics query. */
    subscriptionMetrics: () => [...adminKeys.commerce.all(), 'subscriptionMetrics'] as const,

    /** Key for a specific subscription metrics query (keyed by instituteId). */
    subscriptionMetricsList: (instituteId?: string | null) =>
      [...adminKeys.commerce.subscriptionMetrics(), instituteId] as const,

    /** Key for every subscriptions list query. */
    subscriptions: () => [...adminKeys.commerce.all(), 'subscriptions'] as const,

    /** Key for a specific paginated subscriptions list. */
    subscriptionsList: (filters?: Record<string, unknown>, pagination?: Record<string, unknown>) =>
      [...adminKeys.commerce.subscriptions(), filters, pagination] as const,

    /** Key for every permanent owners list query. */
    permanentOwners: () => [...adminKeys.commerce.all(), 'permanentOwners'] as const,

    /** Key for a specific paginated permanent owners list. */
    permanentOwnersList: (filters?: Record<string, unknown>, pagination?: Record<string, unknown>) =>
      [...adminKeys.commerce.permanentOwners(), filters, pagination] as const,

    /** Key for every flagged orders list query. */
    flaggedOrders: () => [...adminKeys.commerce.all(), 'flaggedOrders'] as const,

    /** Key for a specific paginated flagged orders list. */
    flaggedOrdersList: (filters?: Record<string, unknown>, pagination?: Record<string, unknown>) =>
      [...adminKeys.commerce.flaggedOrders(), filters, pagination] as const,

    /** Key for a single subscription detail. */
    subscriptionDetail: () => [...adminKeys.commerce.all(), 'subscriptionDetail'] as const,

    /** Key for a specific subscription detail. */
    subscriptionDetailItem: (subscriptionId: string) =>
      [...adminKeys.commerce.subscriptionDetail(), subscriptionId] as const,

    /** Key for a subscription's payment history. */
    subscriptionPayments: (subscriptionId: string) =>
      [...adminKeys.commerce.all(), 'subscriptionPayments', subscriptionId] as const,

    /** Key for a subscription's audit history. */
    subscriptionHistory: (subscriptionId: string) =>
      [...adminKeys.commerce.all(), 'subscriptionHistory', subscriptionId] as const,

    /** Key for the courses filter dropdown. */
    subscriptionCourses: (instituteId?: string | null) =>
      [...adminKeys.commerce.all(), 'subscriptionCourses', instituteId] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Recycle Bin / Trash (admin Recycle Bin — super admin only)
  // ═════════════════════════════════════════════════════════════════════════

  trash: {
    /** Root key for all Recycle Bin queries. */
    all: () => [...adminKeys.all, 'trash'] as const,

    /** Key for every trash list query (broad invalidation). */
    lists: () => [...adminKeys.trash.all(), 'list'] as const,

    /** Key for a specific paginated + filtered trash list. */
    list: (
      filters?: Record<string, unknown>,
      sort?: Record<string, unknown>,
      pagination?: Record<string, unknown>,
    ) =>
      [...adminKeys.trash.lists(), filters, sort, pagination] as const,

    /** Key for every trash item detail query. */
    details: () => [...adminKeys.trash.all(), 'detail'] as const,

    /** Key for a single deleted item detail (keyed by resource type + id). */
    detail: (resourceType: string, resourceId: string) =>
      [...adminKeys.trash.details(), resourceType, resourceId] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Bulk Timetable Import (admin one-file timetable + lesson-plan import)
  // ═════════════════════════════════════════════════════════════════════════

  bulkImport: {
    /** Root key for all bulk-import queries. */
    all: () => [...adminKeys.all, 'bulkImport'] as const,

    /** Key for the institute-scoped reference-data fetch. */
    reference: (instituteId?: string | null) =>
      [...adminKeys.bulkImport.all(), 'reference', instituteId] as const,
  },
};
