'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { Button } from './Button';
import { StoreCourseCard } from './StoreCourseCard';
import {
  IconSearch,
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

const CATEGORIES = [
  {
    id: 'ALL',
    streamCode: 'ALL',
    label: 'All Courses',
    icon: (
      <svg className="w-5 h-5 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    id: 'JEE',
    streamCode: 'JEE',
    label: 'Engineering',
    icon: (
      <svg className="w-5 h-5 text-slate-600 group-hover:text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
  {
    id: 'NEET',
    streamCode: 'NEET',
    label: 'Medical',
    icon: (
      <svg className="w-5 h-5 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3" />
        <path d="M8 15v1a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6v-4" />
        <circle cx="20" cy="10" r="2" />
      </svg>
    ),
  },
  {
    id: 'COMMERCE',
    streamCode: 'COMMERCE',
    label: 'Commerce',
    icon: (
      <svg className="w-5 h-5 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
  {
    id: 'GOVERNMENT',
    streamCode: 'CUET',
    label: 'Government',
    icon: (
      <svg className="w-5 h-5 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="3" y1="21" x2="21" y2="21" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <polyline points="5 10 5 21" />
        <polyline points="19 10 19 21" />
        <polyline points="10 10 10 21" />
        <polyline points="14 10 14 21" />
        <polygon points="12 2 2 7 22 7 12 2" />
      </svg>
    ),
  },
  {
    id: 'FOUNDATION',
    streamCode: 'FOUNDATION',
    label: 'Foundation',
    icon: (
      <svg className="w-5 h-5 text-purple-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      </svg>
    ),
  },
];

export function CourseCatalog({ courses }: { courses: Course[] }) {
  const { user } = useAuth();
  const profileId = user?.id ?? null;

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

  const [stream, setStream] = useState('ALL');
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState('all');
  const [sort, setSort] = useState('featured');
  const streams = ['ALL', 'NEET', 'JEE', 'CUET', 'FOUNDATION'];

  const filtered = useMemo(
    () =>
      courses
        .filter((course) => {
          const sc = course.streamCode as string;
          return (
            (stream === 'ALL' ||
              sc === stream ||
              (stream === 'JEE' && (sc === 'JEE' || sc === 'ENGINEERING')) ||
              (stream === 'NEET' && (sc === 'NEET' || sc === 'MEDICAL')) ||
              (stream === 'COMMERCE' && (sc === 'COMMERCE' || sc === 'COMM')) ||
              (stream === 'CUET' && (sc === 'CUET' || sc === 'UPSC' || sc === 'GOVERNMENT')) ||
              (stream === 'FOUNDATION' && (sc === 'FOUNDATION' || sc === 'CLASS_10' || sc === 'CLASS_9'))) &&
            (level === 'all' || course.difficultyLevel.toLowerCase() === level.toLowerCase()) &&
            `${course.title} ${course.presentation.subjects.join(' ')}`
              .toLowerCase()
              .includes(search.trim().toLowerCase())
          );
        })
        .sort((a, b) =>
          sort === 'price-low'
            ? (a.discountedPrice ?? a.originalPrice) - (b.discountedPrice ?? b.originalPrice)
            : sort === 'price-high'
            ? (b.discountedPrice ?? b.originalPrice) - (a.discountedPrice ?? a.originalPrice)
            : Number(b.featured) - Number(a.featured) || a.sortOrder - b.sortOrder
        ),
    [courses, stream, search, level, sort]
  );

  function resetFilters() {
    setStream('ALL');
    setSearch('');
    setLevel('all');
    setSort('featured');
  }

  return (
    <main id="store-main">
      {/* ── 1. Top Hero Section Exactly Matching Design ────────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-b from-sky-50/40 via-white to-white pt-4 pb-6 sm:pt-8 sm:pb-8 lg:pt-12 lg:pb-10">
        <div className="store-container grid lg:grid-cols-12 gap-6 sm:gap-8 lg:gap-8 items-center">
          {/* Left Column: Eyebrow, Heading, Subtitle, Search bar & Category Pills */}
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

            {/* Search Input Bar */}
            <div className="relative w-full max-w-md lg:max-w-xl mx-auto lg:mx-0">
              <div className="relative flex items-center">
                <div className="pointer-events-none absolute left-4 flex items-center text-blue-600">
                  <IconSearch size={18} />
                </div>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search for courses (e.g. JEE, NEET, CUET...)"
                  className="w-full rounded-full border border-slate-200 bg-white py-3 sm:py-3.5 pl-11 sm:pl-12 pr-12 text-xs xs:text-sm sm:text-base text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100 transition-all"
                />
                <button
                  type="button"
                  onClick={() => {
                    const el = document.getElementById('course-catalog');
                    if (el) el.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="absolute right-1.5 sm:right-2 flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm hover:bg-blue-700 active:scale-95 transition-all cursor-pointer"
                  aria-label="Submit search"
                >
                  <span aria-hidden="true" className="text-sm sm:text-base font-bold">→</span>
                </button>
              </div>
            </div>

            {/* Category Filter Pills: 3-col x 2-row on mobile, flex row on desktop */}
            <div className="w-full max-w-md lg:max-w-none pt-1">
              <div className="grid grid-cols-3 lg:flex lg:flex-row gap-2 xs:gap-2.5">
                {CATEGORIES.map((cat) => {
                  const isActive = stream === cat.streamCode;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => {
                        setStream(cat.streamCode);
                      }}
                      className={`group flex flex-col items-center justify-center py-2.5 px-2 xs:px-3 sm:px-3.5 rounded-2xl border transition-all cursor-pointer active:scale-95 ${
                        isActive
                          ? 'bg-sky-50/90 border-blue-400 text-blue-700 shadow-xs ring-2 ring-blue-100'
                          : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50 shadow-2xs'
                      }`}
                    >
                      <div className="flex h-6 w-6 xs:h-7 xs:w-7 items-center justify-center">
                        {cat.icon}
                      </div>
                      <span className="text-[10.5px] xs:text-[11.5px] sm:text-xs font-bold leading-tight mt-1 truncate max-w-full">
                        {cat.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
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

        {/* Bottom 4-Item Value Banner: 4-column row on mobile and desktop */}
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

      {/* ── 2. Course Catalog Section ──────────────────────────────────── */}
      <section id="course-catalog" className="store-container store-catalog-section">
        <div className="store-section-heading">
          <div>
            <p className="store-eyebrow">FIND YOUR FOCUS</p>
            <h2>There’s a course for your next step.</h2>
          </div>
          <p>
            One goal or a whole new direction.
            <br />
            Start with what matters to you.
          </p>
        </div>
        <div className="store-catalog-controls">
          <div className="store-stream-filters" role="group" aria-label="Filter by exam">
            {streams.map((item) => (
              <button
                key={item}
                onClick={() => setStream(item)}
                aria-pressed={stream === item}
                className={stream === item ? 'selected' : ''}
              >
                {item === 'ALL' ? 'All courses' : item === 'FOUNDATION' ? 'Foundation' : item}
                {item === 'ALL' && <span className="tabular-nums">{courses.length}</span>}
              </button>
            ))}
          </div>
          <label className="store-search">
            <IconSearch size={16} aria-hidden="true" />
            <span className="sr-only">Search courses or subjects</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search courses or subjects"
            />
          </label>
        </div>
        <div className="store-results-bar">
          <p role="status">
            <b className="tabular-nums">{filtered.length}</b> courses to explore
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
            <p>Try clearing your filters to see all available courses.</p>
            <Button onClick={resetFilters}>Clear filters</Button>
          </div>
        )}
      </section>
      <section className="store-container store-choice-section">
        <div>
          <p className="store-eyebrow">YOUR LEARNING. YOUR CHOICE.</p>
          <h2>
            A commitment to learning.
            <br />
            <span>Structured batches, live mentors, and mock tests.</span>
          </h2>
        </div>
        <div className="store-choice-item">
          <span className="store-choice-number">01</span>
          <h3>Live and recorded classes</h3>
          <p>Interactive sessions on LiveKit with session recordings available on demand.</p>
        </div>
        <div className="store-choice-item">
          <span className="store-choice-number">02</span>
          <h3>Examination readiness</h3>
          <p>Full-length test engine with timer, analytics, and chapter-wise performance drilldown.</p>
        </div>
      </section>
    </main>
  );
}
