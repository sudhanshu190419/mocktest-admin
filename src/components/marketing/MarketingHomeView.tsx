'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { CourseStoreShell } from './CourseStoreShell';
import { StudentHomeHero } from './StudentHomeHero';
import { StoreCourseCard } from './StoreCourseCard';
import { PYQPackageCard } from './PYQCatalog';
import { AppShowcaseSection } from './AppShowcaseSection';
import { FreeDemoSection } from './FreeDemoSection';
import { IconChevronLeft, IconChevronRight } from '@/components/icons/student-icons';
import { useAuth } from '@/context/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { getHomepageTrendingCourses } from '@/services/courseCatalogService';
import { getPYQPackages } from '@/services/pyqCatalogService';
import { useStudentPyqPurchases } from '@/hooks/student/useStudentPyqPurchases';
import { useStoreCarousel } from './useStoreCarousel';
import {
  fetchStudentBootstrap,
  studentDashboardKeys,
  type StudentEnrolledCourse,
} from '@/services/student/studentDashboardWebService';
import type { Course } from '@/types/courseCatalog';
import type { PYQPackage } from '@/types/pyqCatalog';
import '@/app/courses/courses.css';

const GOALS = [
  { code: 'NEET', label: 'NEET', copy: 'Medical entrance', symbol: 'M' },
  { code: 'UPSC', label: 'UPSC', copy: 'Civil services', symbol: 'U' },
  { code: 'JEE', label: 'JEE', copy: 'Engineering entrance', symbol: 'J' },
  { code: 'K12', label: 'K–12', copy: 'School learning', symbol: 'K' },
  { code: 'CUET', label: 'CUET', copy: 'University entrance', symbol: 'C' },
  { code: 'FOUNDATION', label: 'Foundation', copy: 'Class 8–10 science', symbol: 'F' },
] as const;

function CatalogGridSkeleton() {
  return (
    <div className="store-related-grid" aria-hidden="true">
      {[1, 2, 3].map((idx) => (
        <div
          key={idx}
          className="store-course-card rounded-[18px] bg-white border border-slate-200/80 p-5 flex flex-col justify-between animate-pulse min-h-[380px]"
        >
          <div>
            <div className="w-full h-40 bg-slate-100 rounded-xl mb-4" />
            <div className="flex gap-2 mb-3">
              <div className="w-16 h-4 bg-slate-100 rounded-md" />
              <div className="w-20 h-4 bg-slate-100 rounded-md" />
            </div>
            <div className="w-3/4 h-6 bg-slate-100 rounded-md mb-2" />
            <div className="w-full h-4 bg-slate-100 rounded-md mb-1" />
            <div className="w-2/3 h-4 bg-slate-100 rounded-md" />
          </div>
          <div className="pt-4 border-t border-slate-100 flex justify-between items-center">
            <div className="w-20 h-5 bg-slate-100 rounded-md" />
            <div className="w-24 h-8 bg-slate-100 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function MarketingHomeView() {
  const { user, teacherProfile, loading: authLoading } = useAuth();
  const profileId = user?.id ?? null;
  const [selectedGoal, setSelectedGoal] = useState<string>('NEET');

  // React Query: Public homepage trending course collection
  const { data: courses = [], isLoading: coursesLoading } = useQuery({
    queryKey: ['catalog', 'homepage-trending-courses'],
    queryFn: () => getHomepageTrendingCourses(),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });

  // React Query: Public PYQ packages collection
  const { data: pyqPackages = [], isLoading: pyqLoading } = useQuery({
    queryKey: ['catalog', 'pyq-packages'],
    queryFn: () => getPYQPackages(),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });

  // React Query: Student courses bootstrap
  const { data: bootstrapResult, isLoading: bootstrapLoading } = useQuery({
    queryKey: studentDashboardKeys.bootstrap(profileId),
    queryFn: () => fetchStudentBootstrap(),
    enabled: !!profileId,
    staleTime: 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  // React Query: Student PYQ purchases
  const { purchases: pyqPurchases, isLoading: pyqPurchasesLoading } = useStudentPyqPurchases(profileId);

  const bootstrapData = bootstrapResult?.data ?? null;
  const enrolledCourses: StudentEnrolledCourse[] = bootstrapData?.enrolled_courses || [];
  const enrolledCourseIds = enrolledCourses.map((c) => c.course_id);
  const studentStream = bootstrapData?.selected_stream?.name;

  // Sync selected goal if student has a selected stream
  useEffect(() => {
    if (studentStream) {
      const matched = GOALS.find((g) =>
        studentStream.toUpperCase().includes(g.code)
      );
      if (matched) {
        setSelectedGoal(matched.code);
      }
    }
  }, [studentStream]);

  const rawName =
    bootstrapData?.profile?.name ||
    teacherProfile?.name ||
    user?.user_metadata?.full_name ||
    user?.email?.split('@')[0] ||
    'Student';
  const studentName = rawName
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

  const goal = GOALS.find((item) => item.code === selectedGoal) ?? GOALS[0];
  const featuredCourses = courses
    .filter((course) => course.trending && course.streamCode === goal.code)
    .sort((a, b) => {
      if (a.featured !== b.featured) {
        return a.featured ? -1 : 1;
      }
      const timeA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const timeB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return timeB - timeA;
    })
    .slice(0, 8);
  const featuredPyq = pyqPackages
    .filter((item) => item.streamCode === goal.code)
    .slice(0, 8);

  const courseCarousel = useStoreCarousel(featuredCourses.length);
  const pyqCarousel = useStoreCarousel(featuredPyq.length);

  return (
    <div className="course-store store-home">
      <CourseStoreShell>
        <main id="store-main">
          <h1 className="sr-only">MakeMeTopper — Learn with structure. Practise with intent.</h1>

          {/* 5-Variant State-Aware Hero */}
          {authLoading ? (
            <StudentHomeHero
              studentName=""
              data={null}
              loading={true}
            />
          ) : user ? (
            <StudentHomeHero
              studentName={studentName}
              streamName={studentStream}
              data={{ enrolledCourses, pyqPurchases }}
              loading={(bootstrapLoading && !bootstrapData) || pyqPurchasesLoading}
            />
          ) : (
            <StudentHomeHero
              isGuest={true}
              loading={false}
            />
          )}

          <section
            className="store-container store-home-goals"
            id="home-goals"
            aria-labelledby="home-goals-title"
          >
            <div className="store-section-heading">
              <div>
                <p className="store-eyebrow">FIRST, YOUR DIRECTION</p>
                <h2 id="home-goals-title">What are you working towards?</h2>
              </div>
              <p>Choose a goal to shape the courses and practice papers below.</p>
            </div>
            <nav
              className="store-home-stream-strip"
              aria-label="Filter homepage collections by goal"
            >
              {GOALS.map((item) => (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => setSelectedGoal(item.code)}
                  className="store-stream-card"
                  aria-current={goal.code === item.code ? 'true' : undefined}
                >
                  <span className="store-stream-monogram" aria-hidden="true">
                    {item.symbol}
                    <span>↗</span>
                  </span>
                  <span className="store-stream-card-name">{item.label}</span>
                  <span className="store-stream-card-copy">{item.copy}</span>
                  <span className="store-stream-selection">
                    {goal.code === item.code ? 'Selected' : 'Explore'}
                    <span aria-hidden="true">{goal.code === item.code ? '✓' : '→'}</span>
                  </span>
                </button>
              ))}
            </nav>
            <p className="store-home-filter-note">
              Showing <strong>{goal.label}</strong> offerings.
            </p>
          </section>

          <section
            className="store-container store-home-section"
            id="home-courses"
            aria-labelledby="home-courses-title"
          >
            <div className="store-section-heading">
              <div>
                <p className="store-eyebrow">THE COURSE COLLECTION · {goal.label.toUpperCase()}</p>
                <h2 id="home-courses-title">Make room for your ambition.</h2>
                <p className="store-home-section-copy">
                  Explore {goal.label} curriculum outlines, subjects, and batch formats.
                </p>
              </div>
              <div className="store-section-heading-actions">
                {courseCarousel.showControls && (
                  <div className="store-carousel-nav-arrows" aria-label="Course collection carousel navigation">
                    <button
                      type="button"
                      className="store-carousel-arrow-btn"
                      onClick={courseCarousel.scrollPrev}
                      disabled={courseCarousel.isAtStart}
                      aria-label="Previous courses"
                    >
                      <IconChevronLeft size={16} />
                    </button>
                    <button
                      type="button"
                      className="store-carousel-arrow-btn"
                      onClick={courseCarousel.scrollNext}
                      disabled={courseCarousel.isAtEnd}
                      aria-label="Next courses"
                    >
                      <IconChevronRight size={16} />
                    </button>
                  </div>
                )}
                <Link className="store-text-link" href="/courses">
                  All courses, all goals <span aria-hidden="true">↗</span>
                </Link>
              </div>
            </div>
            {coursesLoading ? (
              <CatalogGridSkeleton />
            ) : featuredCourses.length > 0 ? (
              featuredCourses.length > 3 ? (
                <div className="store-carousel-wrapper">
                  <div
                    ref={courseCarousel.trackRef}
                    className="store-carousel-track-scroll"
                    role="region"
                    aria-label={`${goal.label} courses carousel`}
                  >
                    {featuredCourses.map((course) => (
                      <div key={course.courseId} className="store-carousel-slide-item">
                        <StoreCourseCard
                          course={course}
                          isEnrolled={enrolledCourseIds.includes(course.courseId)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="store-related-grid">
                  {featuredCourses.map((course) => (
                    <StoreCourseCard
                      key={course.courseId}
                      course={course}
                      isEnrolled={enrolledCourseIds.includes(course.courseId)}
                    />
                  ))}
                </div>
              )
            ) : (
              <div className="store-home-empty">
                <span className="store-home-empty-mark" aria-hidden="true">
                  {goal.symbol}
                </span>
                <div>
                  <p className="store-eyebrow">{goal.label.toUpperCase()} COLLECTION</p>
                  <h3>No published courses here yet.</h3>
                  <p>
                    There are no {goal.label} courses published right now. Choose another goal above,
                    or explore the full catalog.
                  </p>
                  <Link className="store-text-link" href="/courses">
                    Explore all courses <span aria-hidden="true">↗</span>
                  </Link>
                </div>
              </div>
            )}
          </section>

          <section className="store-home-tint" aria-labelledby="home-pyq-title">
            <div className="store-container store-home-section" id="home-pyq">
              <div className="store-section-heading">
                <div>
                  <p className="store-eyebrow">
                    THE PRACTICE COLLECTION · {goal.label.toUpperCase()}
                  </p>
                  <h2 id="home-pyq-title">A fresh look at past papers.</h2>
                  <p className="store-home-section-copy">
                    Find your next practice direction in the {goal.label} PYQ collection.
                  </p>
                </div>
                <div className="store-section-heading-actions">
                  {pyqCarousel.showControls && (
                    <div className="store-carousel-nav-arrows" aria-label="PYQ collection carousel navigation">
                      <button
                        type="button"
                        className="store-carousel-arrow-btn"
                        onClick={pyqCarousel.scrollPrev}
                        disabled={pyqCarousel.isAtStart}
                        aria-label="Previous PYQ packages"
                      >
                        <IconChevronLeft size={16} />
                      </button>
                      <button
                        type="button"
                        className="store-carousel-arrow-btn"
                        onClick={pyqCarousel.scrollNext}
                        disabled={pyqCarousel.isAtEnd}
                        aria-label="Next PYQ packages"
                      >
                        <IconChevronRight size={16} />
                      </button>
                    </div>
                  )}
                  <Link className="store-text-link" href="/pyq">
                    All PYQ packages <span aria-hidden="true">↗</span>
                  </Link>
                </div>
              </div>
              {pyqLoading ? (
                <CatalogGridSkeleton />
              ) : featuredPyq.length > 0 ? (
                featuredPyq.length > 3 ? (
                  <div className="store-carousel-wrapper">
                    <div
                      ref={pyqCarousel.trackRef}
                      className="store-carousel-track-scroll"
                      role="region"
                      aria-label={`${goal.label} PYQ packages carousel`}
                    >
                      {featuredPyq.map((item) => (
                        <div key={item.packageId} className="store-carousel-slide-item">
                          <PYQPackageCard item={item} />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="store-related-grid">
                    {featuredPyq.map((item) => (
                      <PYQPackageCard key={item.packageId} item={item} />
                    ))}
                  </div>
                )
              ) : (
                <div className="store-home-empty">
                  <span className="store-home-empty-mark" aria-hidden="true">
                    ↗
                  </span>
                  <div>
                    <p className="store-eyebrow">{goal.label.toUpperCase()} PRACTICE</p>
                    <h3>No past paper packages here yet.</h3>
                    <p>
                      Official papers for {goal.label} are being prepared. Explore our full library of
                      mock tests.
                    </p>
                    <Link className="store-text-link" href="/pyq">
                      Explore all packages <span aria-hidden="true">↗</span>
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </section>

          <AppShowcaseSection />

          {(!user || enrolledCourses.length === 0) && <FreeDemoSection />}
        </main>
      </CourseStoreShell>
    </div>
  );
}

