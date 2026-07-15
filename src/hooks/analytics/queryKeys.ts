/**
 * Analytics Query Key Factory
 *
 * Centralised, stable query key definitions for the Analytics module.
 *
 * Every hook in this module derives its keys from this factory so that
 * cache invalidation is always consistent.
 *
 * ## Structure
 *
 * Each entity follows the same hierarchy:
 * ```
 * <keys>.<entity>.all        → root for the entity
 * <keys>.<entity>.lists()     → all list-type queries
 * <keys>.<entity>.list(id)    → specific list query (keyed by parent ID)
 * <keys>.<entity>.details()   → all detail-type queries
 * <keys>.<entity>.detail(id)  → single item query
 * ```
 *
 * @module hooks/analytics/queryKeys
 */

export const analyticsKeys = {
  all: ['analytics'] as const,

  /** Analytics root for a specific entity type and ID. */
  entity: (type: string, id: string) => [...analyticsKeys.all, type, id] as const,

  /** Generic list query keyed by a parent ID. */
  list: (type: string, id: string) => [...analyticsKeys.entity(type, id), 'list'] as const,

  // ═══════════════════════════════════════════════════════════════════════
  //  Specific Analytics Types
  // ═══════════════════════════════════════════════════════════════════════

  student: {
    all: (studentId: string) => analyticsKeys.entity('student', studentId),
    analytics: (studentId: string) => [...analyticsKeys.student.all(studentId), 'analytics'] as const,
    subject: (studentId: string) => [...analyticsKeys.student.all(studentId), 'subject'] as const,
    chapter: (studentId: string) => [...analyticsKeys.student.all(studentId), 'chapter'] as const,
    trend: (studentId: string) => [...analyticsKeys.student.all(studentId), 'trend'] as const,
    activity: (studentId: string) => [...analyticsKeys.student.all(studentId), 'activity'] as const,
  },

  teacher: {
    all: (teacherId: string) => analyticsKeys.entity('teacher', teacherId),
    analytics: (teacherId: string) => [...analyticsKeys.teacher.all(teacherId), 'analytics'] as const,
  },

  institute: {
    all: (instituteId: string) => analyticsKeys.entity('institute', instituteId),
    analytics: (instituteId: string) => [...analyticsKeys.institute.all(instituteId), 'analytics'] as const,
  },

  mockTest: {
    all: (testId: string) => analyticsKeys.entity('mockTest', testId),
    analytics: (testId: string) => [...analyticsKeys.mockTest.all(testId), 'analytics'] as const,
  },

  dashboard: {
    all: () => [...analyticsKeys.all, 'dashboard'] as const,
    analytics: () => [...analyticsKeys.dashboard.all(), 'analytics'] as const,
  },

  summary: {
    all: () => [...analyticsKeys.all, 'summary'] as const,
    dashboard: () => [...analyticsKeys.summary.all(), 'dashboard'] as const,
  },

  weakChapters: {
    all: () => [...analyticsKeys.all, 'weakChapters'] as const,
    list: () => [...analyticsKeys.weakChapters.all(), 'list'] as const,
  },

  strongChapters: {
    all: () => [...analyticsKeys.all, 'strongChapters'] as const,
    list: () => [...analyticsKeys.strongChapters.all(), 'list'] as const,
  },

  scoreTrend: {
    all: () => [...analyticsKeys.all, 'scoreTrend'] as const,
    list: () => [...analyticsKeys.scoreTrend.all(), 'list'] as const,
  },
};
