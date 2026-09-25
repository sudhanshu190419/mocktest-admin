'use client';

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import {
  IconLibrary,
  IconSearch,
  IconSpark,
  IconRefresh,
  IconArrowRight,
} from '@/components/icons/student-icons';
import {
  fetchStudentEnrolledCourses,
  type EnrolledCourseCardItem,
} from '@/services/student/studentCourseWebService';
import { StudentCourseCard } from '@/components/student/StudentCourseCard';
import { Skeleton, ErrorState, EmptyState, ButtonLink } from '@/components/ui/mmt';

export default function StudentCoursesPage() {
  const [courses, setCourses] = useState<EnrolledCourseCardItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const loadCourses = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { courses: fetchedCourses, error: fetchErr } = await fetchStudentEnrolledCourses();
      if (fetchErr) {
        setError(fetchErr);
      } else {
        setCourses(fetchedCourses);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load enrolled courses');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCourses();
  }, []);

  // Filter courses by search query and category
  const categories = useMemo(() => {
    const set = new Set<string>();
    courses.forEach((c) => {
      if (c.category) set.add(c.category);
      if (c.streamName) set.add(c.streamName);
    });
    return Array.from(set);
  }, [courses]);

  const filteredCourses = useMemo(() => {
    return courses.filter((c) => {
      const matchesSearch =
        c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.batchName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.description && c.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
        c.subjects.some((s) => s.subjectName.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesCat =
        selectedCategory === 'all' ||
        c.category === selectedCategory ||
        c.streamName === selectedCategory;

      return matchesSearch && matchesCat;
    });
  }, [courses, searchQuery, selectedCategory]);

  return (
    <div className="store-container space-y-7 pb-12">
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

      {/* ── Page Header Banner (Design A) ─────────────── */}
      <section className="rounded-card border border-line bg-surface p-6 sm:p-8 shadow-card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div className="max-w-2xl space-y-2">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-sky-tint px-3 py-1 text-caption font-bold text-brand-hover border border-line">
              <IconSpark className="h-3.5 w-3.5" />
              <span>Enrolled Learning Programs</span>
            </div>
            <h1 className="text-2xl sm:text-display font-extrabold tracking-tight text-ink">
              My Enrolled Courses & Batches
            </h1>
            <p className="text-body text-ink-secondary leading-relaxed">
              Access your course curriculum, video lectures, revision PDFs, and assigned mock test series.
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

      {/* ── Search & Category Filter Bar ───────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-card border border-line bg-surface p-3 shadow-xs">
        {/* Search Input */}
        <div className="relative flex-1">
          <IconSearch className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input
            type="text"
            placeholder="Search enrolled courses, batches, or subjects..."
            aria-label="Search enrolled courses, batches, or subjects"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full min-h-[44px] rounded-field border border-line bg-paper pl-9 pr-4 py-2 text-body font-medium text-ink placeholder:text-ink-muted focus:border-brand focus:bg-surface focus:outline-none transition-all"
          />
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`min-h-[44px] rounded-field px-3.5 py-1.5 text-body font-semibold transition-colors ${
              selectedCategory === 'all'
                ? 'bg-brand text-white shadow-xs'
                : 'bg-paper text-ink-secondary hover:bg-sky-tint'
            }`}
          >
            All Courses ({courses.length})
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`min-h-[44px] rounded-field px-3.5 py-1.5 text-body font-semibold transition-colors ${
                selectedCategory === cat
                  ? 'bg-brand text-white shadow-xs'
                  : 'bg-paper text-ink-secondary hover:bg-sky-tint'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content Grid / States ───────────────────────────────────────────── */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((n) => (
            <div key={n} className="rounded-card border border-line bg-surface p-6 shadow-card space-y-4 h-72">
              <Skeleton className="h-6 w-32 rounded-full" />
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-1.5 w-full rounded-full" />
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
          title={searchQuery ? 'No courses match your search' : 'No Enrolled Courses Found'}
          detail={
            searchQuery
              ? 'Try adjusting your search terms or selecting a different category filter.'
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredCourses.map((course) => (
            <StudentCourseCard key={course.courseId} course={course} />
          ))}
        </div>
      )}
    </div>
  );
}
