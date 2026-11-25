'use client';

import { useMemo, useState, useEffect } from 'react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { Button } from './Button';
import { StoreCourseCard } from './StoreCourseCard';
import {
  IconLibrary,
  IconUser,
  IconFileText,
  IconSpark,
} from '@/components/icons/student-icons';
import { useAuth } from '@/context/AuthContext';
import { useQuery } from '@tanstack/react-query';
import {
  fetchStudentBootstrap,
  studentDashboardKeys,
  type StudentEnrolledCourse,
} from '@/services/student/studentDashboardWebService';
import type { Course } from '@/types/courseCatalog';

export function CourseCatalog({ courses }: { courses: Course[] }) {
  const { user } = useAuth();
  const profileId = user?.id ?? null;
  const searchParams = useSearchParams();
  const urlStream = searchParams.get('stream') || searchParams.get('goal') || searchParams.get('category');

  const { data: bootstrapResult } = useQuery({
    queryKey: studentDashboardKeys.bootstrap(profileId),
    queryFn: () => fetchStudentBootstrap(),
    enabled: !!profileId,
    staleTime: 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  const enrolledCourses: StudentEnrolledCourse[] = bootstrapResult?.data?.enrolled_courses || [];
  const enrolledCourseIds = enrolledCourses.map((c) => c.course_id);

  const [stream, setStream] = useState<string>('ALL');
  const [level, setLevel] = useState('all');
  const [sort, setSort] = useState('featured');

  // Synchronize stream filter with incoming URL search parameters
  useEffect(() => {
    if (urlStream) {
      setStream(urlStream.toUpperCase());
    } else {
      setStream('ALL');
    }
  }, [urlStream]);

  // Distinct verified stream options derived from published courses
  const streams = useMemo(() => {
    const list = ['ALL'];
    if (courses.some((c) => (c.streamCode as string) === 'NEET' || (c.streamCode as string) === 'MEDICAL')) list.push('NEET');
    if (courses.some((c) => (c.streamCode as string) === '10TH' || (c.streamCode as string) === 'FOUNDATION')) list.push('10TH');
    if (courses.some((c) => (c.streamCode as string) === '12TH' || (c.streamCode as string) === 'K12')) list.push('12TH');
    if (courses.some((c) => (c.streamCode as string) === 'CUET')) list.push('CUET');
    if (courses.some((c) => (c.streamCode as string) === 'JEE' || c.title.toUpperCase().includes('JEE'))) list.push('JEE');

    courses.forEach((c) => {
      const code = (c.streamCode as string)?.toUpperCase();
      if (code && !list.includes(code) && code !== 'NEN') {
        list.push(code);
      }
    });
    return list;
  }, [courses]);

  const getStreamLabel = (item: string) => {
    if (item === 'ALL') return 'All Batches';
    if (item === '10TH' || item === 'FOUNDATION') return '8–10th Grade';
    if (item === '12TH' || item === 'K12') return '11–12th Grade';
    if (item === 'FOR') return 'Special Batches';
    return item;
  };

  const filtered = useMemo(
    () =>
      courses
        .filter((course) => {
          // Strictly show published, non-deleted offerings
          if (course.status !== 'published' || course.deletedAt) return false;

          const sc = (course.streamCode || '').toUpperCase();
          const sid = course.streamId;
          const st = stream.toUpperCase();

          const matchesStream =
            st === 'ALL' ||
            sc === st ||
            sid === stream ||
            (st === 'NEET' && (sc === 'NEET' || sc === 'MEDICAL')) ||
            (st === 'CUET' && (sc === 'CUET' || sc === 'UPSC' || sc === 'GOVERNMENT')) ||
            (st === 'FOUNDATION' && (sc === 'FOUNDATION' || sc === '10TH' || sc === 'CLASS_10' || sc === 'CLASS_9')) ||
            (st === '10TH' && (sc === '10TH' || sc === 'FOUNDATION' || sc === 'CLASS_10' || sc === 'CLASS_9')) ||
            (st === '12TH' && (sc === '12TH' || sc === 'K12' || sc === 'CLASS_12' || sc === 'CLASS_11')) ||
            (st === 'K12' && (sc === 'K12' || sc === '12TH' || sc === 'CLASS_12' || sc === 'CLASS_11')) ||
            (st === 'JEE' && (sc === 'JEE' || sc === 'ENGINEERING' || course.title.toUpperCase().includes('JEE')));

          const matchesLevel =
            level === 'all' || course.difficultyLevel.toLowerCase() === level.toLowerCase();

          return matchesStream && matchesLevel;
        })
        .sort((a, b) =>
          sort === 'price-low'
            ? (a.discountedPrice ?? a.originalPrice) - (b.discountedPrice ?? b.originalPrice)
            : sort === 'price-high'
            ? (b.discountedPrice ?? b.originalPrice) - (a.discountedPrice ?? a.originalPrice)
            : Number(b.featured) - Number(a.featured) || a.sortOrder - b.sortOrder
        ),
    [courses, stream, level, sort]
  );

  // Truthful batch count calculation:
  // If actual linked batches exist, count them; otherwise accurately represent available course offerings.
  const actualBatchesCount = useMemo(() => {
    return filtered.reduce((total, course) => {
      const active = (course.batches || []).filter((b) => b.isActive);
      return total + active.length;
    }, 0);
  }, [filtered]);

  function resetFilters() {
    setStream('ALL');
    setLevel('all');
    setSort('featured');
  }

  return (
    <main id="store-main">
      {/* ── 1. Top Hero Section with Key Features Preserved ─────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-b from-sky-50/40 via-white to-white pt-4 pb-6 sm:pt-8 sm:pb-8 lg:pt-12 lg:pb-10">
        <div className="store-container grid lg:grid-cols-12 gap-6 sm:gap-8 lg:gap-8 items-center">
          {/* Left Column: Eyebrow, Heading, Subtitle */}
          <div className="lg:col-span-6 xl:col-span-6 space-y-4 sm:space-y-6 text-center lg:text-left flex flex-col items-center lg:items-start">
            {/* Eyebrow Badge */}
            <div className="inline-flex items-center gap-1.5 sm:gap-2 rounded-full border border-sky-200/90 bg-sky-50 px-3 py-1 sm:px-3.5 sm:py-1.5 text-[10px] xs:text-[11px] sm:text-xs font-extrabold tracking-[0.1em] text-sky-800 uppercase shadow-2xs">
              <span role="img" aria-label="books">📚</span>
              <span>COURSES THAT CREATE OPPORTUNITIES</span>
            </div>

            {/* Main Headline */}
            <h1 className="text-[32px] xs:text-[38px] sm:text-5xl lg:text-[54px] font-black text-slate-900 tracking-tight leading-[1.12]">
              Find the Right <br />
              Course for{' '}
              <span className="relative inline-block text-blue-600">
                Your Goals.
                <svg
                  className="absolute -bottom-1.5 sm:-bottom-2 left-0 w-full text-blue-400/80 pointer-events-none"
                  viewBox="0 0 250 14"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  preserveAspectRatio="none"
                >
                  <path
                    d="M3 10.5C55 3.5 145 2.5 247 11.5"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            </h1>

            {/* Subtitle */}
            <p className="text-slate-500 text-[13px] xs:text-sm sm:text-base lg:text-[16.5px] font-normal leading-relaxed max-w-md lg:max-w-xl mx-auto lg:mx-0">
              Explore expert-led courses, practice tests, PYQ packages and live classes — all in one place.
            </p>
          </div>

          {/* Right Column: Hero Graphic */}
          <div className="lg:col-span-6 xl:col-span-6 relative flex justify-center lg:justify-end mt-2 sm:mt-4 lg:mt-0">
            <div className="relative w-full max-w-[420px] sm:max-w-[500px] lg:max-w-[600px]">
              {/* Desktop optimized image */}
              <Image
                src="/courses-desktop.webp"
                alt="Find the Right Course for Your Goals"
                width={1536}
                height={1024}
                priority
                sizes="(min-width: 1024px) 50vw, 0vw"
                className="hidden lg:block w-full h-auto object-contain select-none drop-shadow-sm"
              />
              {/* Mobile optimized image */}
              <Image
                src="/courses-mobile.webp"
                alt="Find the Right Course for Your Goals"
                width={840}
                height={560}
                priority
                sizes="(max-width: 1023px) 90vw, 0vw"
                className="block lg:hidden w-full h-auto object-contain select-none drop-shadow-sm"
              />
            </div>
          </div>
        </div>

        {/* Bottom 4-Item Value Banner: Section 3 Mandatory Key Features (PRESERVED UNCHANGED) */}
        <div className="store-container mt-6 sm:mt-10 lg:mt-12">
          <div className="rounded-2xl sm:rounded-3xl border border-slate-200/80 bg-white/90 shadow-sm p-3 xs:p-4 sm:p-6 grid grid-cols-4 items-center">
            {/* 1000+ Video Lessons */}
            <div className="flex flex-col md:flex-row items-center justify-center md:justify-start gap-1.5 sm:gap-3.5 border-r border-slate-100 sm:border-slate-200/80 px-1 sm:pr-4 text-center md:text-left">
              <div className="flex h-8 w-8 xs:h-9 xs:w-9 sm:h-12 sm:w-12 items-center justify-center rounded-xl sm:rounded-2xl bg-sky-50 text-blue-600 shrink-0 shadow-2xs">
                <IconLibrary size={18} className="sm:w-6 sm:h-6" />
              </div>
              <div>
                <h3 className="text-[11px] xs:text-xs sm:text-lg font-black text-slate-900 leading-tight">1000+</h3>
                <p className="text-[8.5px] xs:text-[9.5px] sm:text-[13px] text-slate-500 font-medium leading-tight mt-0.5">Video Lessons</p>
              </div>
            </div>

            {/* Expert Faculty Support */}
            <div className="flex flex-col md:flex-row items-center justify-center md:justify-start gap-1.5 sm:gap-3.5 border-r border-slate-100 sm:border-slate-200/80 px-1 sm:pr-4 text-center md:text-left">
              <div className="flex h-8 w-8 xs:h-9 xs:w-9 sm:h-12 sm:w-12 items-center justify-center rounded-xl sm:rounded-2xl bg-emerald-50 text-emerald-600 shrink-0 shadow-2xs">
                <IconUser size={18} className="sm:w-6 sm:h-6" />
              </div>
              <div>
                <h3 className="text-[11px] xs:text-xs sm:text-lg font-black text-slate-900 leading-tight">Expert</h3>
                <p className="text-[8.5px] xs:text-[9.5px] sm:text-[13px] text-slate-500 font-medium leading-tight mt-0.5">Faculty Support</p>
              </div>
            </div>

            {/* PYQ Practice Tests */}
            <div className="flex flex-col md:flex-row items-center justify-center md:justify-start gap-1.5 sm:gap-3.5 border-r border-slate-100 sm:border-slate-200/80 px-1 sm:pr-4 text-center md:text-left">
              <div className="flex h-8 w-8 xs:h-9 xs:w-9 sm:h-12 sm:w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 shrink-0 shadow-2xs">
                <IconFileText size={18} className="sm:w-6 sm:h-6" />
              </div>
              <div>
                <h3 className="text-[11px] xs:text-xs sm:text-lg font-black text-slate-900 leading-tight">PYQ</h3>
                <p className="text-[8.5px] xs:text-[9.5px] sm:text-[13px] text-slate-500 font-medium leading-tight mt-0.5">Practice Tests</p>
              </div>
            </div>

            {/* Personalized Learning Journey */}
            <div className="flex flex-col md:flex-row items-center justify-center md:justify-start gap-1.5 sm:gap-3.5 px-1 text-center md:text-left">
              <div className="flex h-8 w-8 xs:h-9 xs:w-9 sm:h-12 sm:w-12 items-center justify-center rounded-2xl bg-purple-50 text-purple-600 shrink-0 shadow-2xs">
                <IconSpark size={18} className="sm:w-6 sm:h-6" />
              </div>
              <div>
                <h3 className="text-[11px] xs:text-xs sm:text-lg font-black text-slate-900 leading-tight">Personalized</h3>
                <p className="text-[8.5px] xs:text-[9.5px] sm:text-[13px] text-slate-500 font-medium leading-tight mt-0.5">Learning Journey</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 2. Explore Batches Catalog Section ──────────────────────────── */}
      <section id="course-catalog" className="store-container store-catalog-section">
        {/* Section Heading: "Explore Batches" */}
        <div className="store-section-heading mb-6">
          <div>
            <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">Explore Batches</h2>
          </div>
        </div>

        {/* Filter Controls: Stream selection and sort dropdowns */}
        <div className="store-catalog-controls">
          <div className="store-stream-filters" role="group" aria-label="Filter by stream">
            {streams.map((item) => (
              <button
                key={item}
                onClick={() => setStream(item)}
                aria-pressed={stream === item}
                className={stream === item ? 'selected' : ''}
              >
                {getStreamLabel(item)}
                {item === 'ALL' && <span className="tabular-nums">{courses.length}</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Results Bar: Truthful batch count & level/sort controls */}
        <div className="store-results-bar">
          <p role="status">
            {actualBatchesCount > 0 ? (
              <>
                <b className="tabular-nums">{actualBatchesCount}</b> batches to explore
              </>
            ) : (
              <>
                <b className="tabular-nums">{filtered.length}</b> courses to explore
              </>
            )}
          </p>
          <div>
            <label>
              Level{' '}
              <select value={level} onChange={(event) => setLevel(event.target.value)}>
                <option value="all">All levels</option>
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </label>
            <label>
              Sort by{' '}
              <select value={sort} onChange={(event) => setSort(event.target.value)}>
                <option value="featured">Featured</option>
                <option value="price-low">Price: low to high</option>
                <option value="price-high">Price: high to low</option>
              </select>
            </label>
          </div>
        </div>

        {/* Course Card Grid */}
        {filtered.length ? (
          <div className="store-course-grid">
            {filtered.map((course) => (
              <StoreCourseCard
                key={course.courseId}
                course={course}
                isEnrolled={enrolledCourseIds.includes(course.courseId)}
              />
            ))}
          </div>
        ) : (
          <div className="store-empty">
            <span aria-hidden="true">⌕</span>
            <h3>No courses found.</h3>
            <p>Try clearing your filters to see all available offerings.</p>
            <Button onClick={resetFilters}>Clear filters</Button>
          </div>
        )}
      </section>
    </main>
  );
}
