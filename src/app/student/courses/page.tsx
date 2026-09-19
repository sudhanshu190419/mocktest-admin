'use client';

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import {
  BookOpen,
  MagnifyingGlass,
  Sparkle,
  ArrowsClockwise,
  Warning,
  CaretRight,
  ArrowSquareOut
} from '@phosphor-icons/react';
import {
  fetchStudentEnrolledCourses,
  type EnrolledCourseCardItem,
} from '@/services/student/studentCourseWebService';
import { StudentCourseCard } from '@/components/student/StudentCourseCard';

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
          <Link href="/">MakeMeTopper</Link>
          <span aria-hidden="true">/</span>
          <Link href="/student/overview">Student Hub</Link>
          <span aria-hidden="true">/</span>
          <span>My Courses</span>
        </nav>

        <button
          onClick={loadCourses}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50 transition-colors shadow-xs"
        >
          <ArrowsClockwise className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* ── Page Header Banner (Design A) ─────────────── */}
      <section className="student-hero-banner">
        <div className="student-hero-header">
          <div className="max-w-2xl space-y-2">
            <div className="student-pill student-pill-sky">
              <Sparkle className="h-3.5 w-3.5" />
              <span>Enrolled Learning Programs</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
              My Enrolled Courses & Batches
            </h1>
            <p className="student-hero-lead">
              Access your course curriculum, video lectures, revision PDFs, and assigned mock test series.
            </p>
          </div>

          <div className="student-hero-actions">
            <Link
              href="/courses"
              className="inline-flex items-center gap-2 rounded-xl text-white px-4 py-2.5 text-xs font-bold hover:opacity-90 transition-colors shadow-xs"
              style={{ backgroundColor: 'var(--color-store-blue)' }}
            >
              <span>Explore All Courses</span>
              <ArrowSquareOut size={15} />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Search & Category Filter Bar ───────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-xs">
        {/* Search Input */}
        <div className="relative flex-1">
          <MagnifyingGlass className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search enrolled courses, batches, or subjects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50/70 pl-9 pr-4 py-2 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none transition-all"
          />
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`student-filter-btn ${selectedCategory === 'all' ? 'active' : ''}`}
          >
            All Courses ({courses.length})
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`student-filter-btn ${selectedCategory === cat ? 'active' : ''}`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content Grid / States ───────────────────────────────────────────── */}
      {isLoading ? (
        /* Loading Skeletons */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="student-card animate-pulse space-y-4 h-72"
            />
          ))}
        </div>
      ) : error ? (
        /* Error State */
        <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-100 text-rose-600">
            <Warning className="h-6 w-6" />
          </div>
          <h3 className="mt-3 text-base font-bold text-slate-900">Failed to load courses</h3>
          <p className="mt-1 text-xs text-slate-600 max-w-sm mx-auto">{error}</p>
          <button
            onClick={loadCourses}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700 transition-colors shadow-xs"
          >
            <ArrowsClockwise className="h-3.5 w-3.5" />
            Try Again
          </button>
        </div>
      ) : filteredCourses.length === 0 ? (
        /* Empty State */
        <div className="student-card text-center p-12">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl" style={{ background: 'var(--color-store-sky)', color: 'var(--color-store-blue)' }}>
            <BookOpen className="h-8 w-8" />
          </div>
          <h3 className="mt-4 text-lg font-extrabold text-slate-900">
            {searchQuery ? 'No courses match your search' : 'No Enrolled Courses Found'}
          </h3>
          <p className="mt-1.5 text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
            {searchQuery
              ? 'Try adjusting your search terms or selecting a different category filter.'
              : 'You have not enrolled in any courses yet. Explore our targeted programs designed for NEET, JEE, and foundation prep.'}
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/courses"
              className="inline-flex items-center gap-2 rounded-xl text-white px-5 py-2.5 text-xs font-bold hover:opacity-90 transition-colors shadow-xs"
              style={{ backgroundColor: 'var(--color-store-blue)' }}
            >
              <span>Explore Course Catalog</span>
              <ArrowSquareOut size={15} />
            </Link>
            <Link
              href="/pyq"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <span>View PYQ Store</span>
            </Link>
          </div>
        </div>
      ) : (
        /* Courses Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredCourses.map((course) => (
            <StudentCourseCard key={course.courseId} course={course} />
          ))}
        </div>
      )}
    </div>
  );
}
