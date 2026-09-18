'use client';

/**
 * Student My Courses Page (/student/courses)
 *
 * Lists all purchased/enrolled courses for the logged-in student.
 * Uses real bootstrap and get_courses_content_summary data.
 *
 * @module app/student/courses/page
 */

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import {
  BookOpen,
  MagnifyingGlass,
  GraduationCap,
  Sparkle,
  ArrowsClockwise,
  Warning,
  CaretRight
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
    <div className="space-y-6">
      {/* ── Breadcrumb & Top Bar ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
          <Link href="/student/overview" className="hover:text-sky-600 transition-colors">
            Student Portal
          </Link>
          <CaretRight className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-slate-900">My Courses</span>
        </div>

        <button
          onClick={loadCourses}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50 transition-colors"
        >
          <ArrowsClockwise className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* ── Page Header Banner ──────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-sky-600 via-sky-700 to-indigo-700 p-6 sm:p-8 text-white shadow-sm">
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur-md">
            <GraduationCap className="h-3.5 w-3.5 text-sky-200" />
            <span>Enrolled Academic Portal</span>
          </div>
          <h1 className="mt-3 text-2xl sm:text-3xl font-extrabold tracking-tight">
            My Enrolled Courses & Batches
          </h1>
          <p className="mt-2 text-sm text-sky-100/90 leading-relaxed">
            Access your course curriculum, video lectures, revision PDFs, and assigned mock test series.
          </p>
        </div>

        {/* Decorative background glow */}
        <div className="absolute right-0 top-0 -mt-10 -mr-10 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
      </div>

      {/* ── Search & Category Filter Bar ───────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
        {/* Search Input */}
        <div className="relative flex-1">
          <MagnifyingGlass className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search enrolled courses, batches, or subjects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50/70 pl-9 pr-4 py-2 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-100 transition-all"
          />
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold whitespace-nowrap transition-colors ${
              selectedCategory === 'all'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All Courses ({courses.length})
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`rounded-xl px-3 py-1.5 text-xs font-bold whitespace-nowrap transition-colors ${
                selectedCategory === cat
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
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
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm animate-pulse space-y-4"
            >
              <div className="flex justify-between">
                <div className="h-5 w-24 rounded-full bg-slate-200" />
                <div className="h-5 w-20 rounded-md bg-slate-200" />
              </div>
              <div className="h-6 w-3/4 rounded bg-slate-200" />
              <div className="h-14 rounded-xl bg-slate-100" />
              <div className="h-8 rounded bg-slate-100" />
              <div className="h-10 rounded-xl bg-slate-200" />
            </div>
          ))}
        </div>
      ) : error ? (
        /* Error State */
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-100 text-rose-600">
            <Warning className="h-6 w-6" />
          </div>
          <h3 className="mt-3 text-base font-bold text-slate-900">Failed to load courses</h3>
          <p className="mt-1 text-xs text-slate-600 max-w-sm mx-auto">{error}</p>
          <button
            onClick={loadCourses}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700 transition-colors"
          >
            <ArrowsClockwise className="h-3.5 w-3.5" />
            Try Again
          </button>
        </div>
      ) : filteredCourses.length === 0 ? (
        /* Empty State */
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
            <BookOpen className="h-8 w-8" />
          </div>
          <h3 className="mt-4 text-lg font-bold text-slate-900">
            {searchQuery ? 'No courses match your search' : 'No Enrolled Courses Found'}
          </h3>
          <p className="mt-1.5 text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
            {searchQuery
              ? 'Try adjusting your search terms or selecting a different category filter.'
              : 'You are not currently enrolled in any courses. Please check back once your academic administrator assigns your batch.'}
          </p>
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory('all');
              }}
              className="mt-4 text-xs font-bold text-sky-600 hover:text-sky-700 underline"
            >
              Clear filters
            </button>
          )}
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
