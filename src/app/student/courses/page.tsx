'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  IconSearch,
  IconArrowRight,
  IconRefresh,
  IconSpark,
  IconLibrary,
} from '@/components/icons/student-icons';
import { Receipt, CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { StudentCourseCard } from '@/components/student/StudentCourseCard';
import {
  fetchStudentCourseHubData,
  isUuidString,
  type StudentCourseHubItem,
} from '@/services/student/studentCourseWebService';
import { EmptyState, ErrorState, Skeleton, ButtonLink } from '@/components/ui/mmt';

type CourseFilterTab = 'all' | 'installments' | 'settled';

function StudentCoursesContent() {
  const searchParams = useSearchParams();
  const deepCourseId = searchParams.get('courseId');
  const shouldOpenInstallments = searchParams.get('openInstallments') === 'true';

  const [courses, setCourses] = useState<StudentCourseHubItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeTab, setActiveTab] = useState<CourseFilterTab>('all');

  // Track which course cards have their installment schedule expanded
  const [expandedCourseIds, setExpandedCourseIds] = useState<Set<string>>(new Set());

  // Deep-link auto-expansion and highlight state (§9)
  const [highlightedCourseId, setHighlightedCourseId] = useState<string | null>(null);
  const hasAppliedDeepLinkRef = useRef<boolean>(false);

  const loadCourses = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { courses: fetchedCourses, error: fetchErr } = await fetchStudentCourseHubData();
      if (fetchErr) {
        setError(fetchErr);
      } else {
        setCourses(fetchedCourses);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load courses');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCourses();
  }, [loadCourses]);

  // Deep-link handler: auto-expand and scroll to course card (§9)
  useEffect(() => {
    if (isLoading || courses.length === 0 || hasAppliedDeepLinkRef.current) return;

    if (deepCourseId && isUuidString(deepCourseId)) {
      const matchingCourse = courses.find((c) => c.courseId === deepCourseId);
      if (matchingCourse) {
        hasAppliedDeepLinkRef.current = true;

        if (shouldOpenInstallments && matchingCourse.acquisitionType === 'installment') {
          // 1. Expand the schedule
          setExpandedCourseIds((prev) => new Set(prev).add(deepCourseId));
          // 2. Set temporary highlight
          setHighlightedCourseId(deepCourseId);

          // 3. Scroll card into view smoothly after DOM renders
          setTimeout(() => {
            const cardElement = document.getElementById(`course-card-${deepCourseId}`);
            if (cardElement) {
              cardElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }, 200);

          // 4. Clear highlight after 5 seconds
          const timer = setTimeout(() => {
            setHighlightedCourseId(null);
          }, 5000);

          return () => clearTimeout(timer);
        }
      }
    }
  }, [isLoading, courses, deepCourseId, shouldOpenInstallments]);

  // Toggle individual course schedule expansion
  const handleToggleSchedule = (courseId: string) => {
    setExpandedCourseIds((prev) => {
      const next = new Set(prev);
      if (next.has(courseId)) {
        next.delete(courseId);
      } else {
        next.add(courseId);
      }
      return next;
    });
  };

  // Counts for filter pills
  const installmentCount = useMemo(
    () => courses.filter((c) => c.acquisitionType === 'installment').length,
    [courses]
  );
  const settledCount = useMemo(
    () =>
      courses.filter(
        (c) => c.acquisitionType === 'one_time' || c.financialSummary?.isFullyPaid
      ).length,
    [courses]
  );

  // Filter courses by search query and active tab
  const filteredCourses = useMemo(() => {
    return courses.filter((c) => {
      // Tab filter
      if (activeTab === 'installments' && c.acquisitionType !== 'installment') {
        return false;
      }
      if (activeTab === 'settled') {
        const isOneTime = c.acquisitionType === 'one_time';
        const isInstallmentSettled = c.acquisitionType === 'installment' && c.financialSummary?.isFullyPaid;
        if (!isOneTime && !isInstallmentSettled) return false;
      }

      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = c.title.toLowerCase().includes(q);
        const matchesBatch = c.batchName.toLowerCase().includes(q);
        const matchesDesc = c.description ? c.description.toLowerCase().includes(q) : false;
        const matchesCategory = c.category ? c.category.toLowerCase().includes(q) : false;
        const matchesSubjects = c.subjects.some((s) => s.subjectName.toLowerCase().includes(q));

        if (!matchesTitle && !matchesBatch && !matchesDesc && !matchesCategory && !matchesSubjects) {
          return false;
        }
      }

      return true;
    });
  }, [courses, searchQuery, activeTab]);

  return (
    <div className="store-container space-y-7 pb-16 max-w-7xl mx-auto">
      {/* ── Breadcrumb & Top Bar ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <nav className="store-breadcrumb" aria-label="Breadcrumb">
          <Link href="/student/overview">My Learning</Link>
          <span aria-hidden="true">/</span>
          <span>My Courses</span>
        </nav>

        <button
          onClick={loadCourses}
          disabled={isLoading}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-field border border-line bg-surface px-3 py-1.5 text-body font-semibold text-ink-secondary hover:bg-paper disabled:opacity-50 transition-colors shadow-xs"
        >
          <IconRefresh className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* ── Page Header Banner (§3) ─────────────────────────────────────────── */}
      <section className="rounded-card border border-line bg-surface p-6 sm:p-8 shadow-card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div className="max-w-2xl space-y-2">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-sky-tint px-3 py-1 text-caption font-bold text-brand-hover border border-line">
              <IconSpark className="h-3.5 w-3.5" />
              <span>Enrolled Learning Programs & Installments</span>
            </div>
            <h1 className="text-2xl sm:text-display font-extrabold tracking-tight text-ink">
              My Courses
            </h1>
            <p className="text-body text-ink-secondary leading-relaxed">
              View your courses, track your learning, and manage installment payments.
            </p>
          </div>

          <div className="shrink-0">
            <Link
              href="/courses"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-field bg-brand px-4 py-2.5 text-body font-bold text-white shadow-xs hover:bg-brand-hover transition-colors"
            >
              <span>Explore All Courses</span>
              <IconArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Search & Filter Tabs Bar (§3) ──────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-card border border-line bg-surface p-3 shadow-xs">
        {/* Search Input */}
        <div className="relative flex-1">
          <IconSearch className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input
            type="text"
            placeholder="Search courses, batches, or subjects..."
            aria-label="Search courses, batches, or subjects"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full min-h-[44px] rounded-field border border-line bg-paper pl-9 pr-4 py-2 text-body font-medium text-ink placeholder:text-ink-muted focus:border-brand focus:bg-surface focus:outline-none transition-all"
          />
        </div>

        {/* Filter Tabs: All Courses, Installment Plans, Fully Settled */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`min-h-[44px] rounded-field px-3.5 py-1.5 text-body font-semibold transition-colors shrink-0 ${
              activeTab === 'all'
                ? 'bg-brand text-white shadow-xs'
                : 'bg-paper text-ink-secondary hover:bg-sky-tint'
            }`}
          >
            All Courses ({courses.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('installments')}
            className={`inline-flex items-center gap-1.5 min-h-[44px] rounded-field px-3.5 py-1.5 text-body font-semibold transition-colors shrink-0 ${
              activeTab === 'installments'
                ? 'bg-brand text-white shadow-xs'
                : 'bg-paper text-ink-secondary hover:bg-sky-tint'
            }`}
          >
            <Receipt size={14} weight="bold" />
            <span>Installment Plans ({installmentCount})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('settled')}
            className={`inline-flex items-center gap-1.5 min-h-[44px] rounded-field px-3.5 py-1.5 text-body font-semibold transition-colors shrink-0 ${
              activeTab === 'settled'
                ? 'bg-brand text-white shadow-xs'
                : 'bg-paper text-ink-secondary hover:bg-sky-tint'
            }`}
          >
            <CheckCircle size={14} weight="bold" />
            <span>Fully Settled ({settledCount})</span>
          </button>
        </div>
      </div>

      {/* ── Content Grid / States (§3, §10) ─────────────────────────────────── */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[1, 2].map((n) => (
            <div
              key={n}
              className="rounded-card border border-line bg-surface p-6 shadow-card space-y-4 h-80"
            >
              <Skeleton className="h-6 w-36 rounded-full" />
              <Skeleton className="h-7 w-3/4" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-2 w-full rounded-full" />
              <Skeleton className="h-10 w-full rounded-field mt-auto" />
            </div>
          ))}
        </div>
      ) : error ? (
        <ErrorState
          title="Failed to load courses"
          detail={error}
          onRetry={loadCourses}
        />
      ) : filteredCourses.length === 0 ? (
        <EmptyState
          icon={IconLibrary}
          title={searchQuery || activeTab !== 'all' ? 'No courses match your filter' : 'No Enrolled Courses Found'}
          detail={
            searchQuery || activeTab !== 'all'
              ? 'Try adjusting your search terms or switching the tab filter above.'
              : 'You have not enrolled in any courses yet. Explore our targeted programs designed for NEET, JEE, and foundation prep.'
          }
          action={
            <ButtonLink href="/courses" size="md">
              <span>Explore Course Catalog</span>
              <IconArrowRight size={16} />
            </ButtonLink>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredCourses.map((course) => (
            <StudentCourseCard
              key={course.courseId}
              course={course}
              isScheduleExpanded={expandedCourseIds.has(course.courseId)}
              onToggleSchedule={() => handleToggleSchedule(course.courseId)}
              highlightOverdue={highlightedCourseId === course.courseId}
              onPaymentSettled={loadCourses}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function StudentCoursesPage() {
  return (
    <React.Suspense
      fallback={
        <div className="space-y-6">
          <Skeleton className="h-10 w-64 rounded-field" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Skeleton className="h-64 rounded-card" />
            <Skeleton className="h-64 rounded-card" />
          </div>
        </div>
      }
    >
      <StudentCoursesContent />
    </React.Suspense>
  );
}
