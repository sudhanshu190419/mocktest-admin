'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CourseStoreShell } from './CourseStoreShell';
import { HeroSection } from './HeroSection';
import { StudentHomeHero } from './StudentHomeHero';
import { StoreCourseCard } from './StoreCourseCard';
import { AppShowcaseSection } from './AppShowcaseSection';
import { FreeDemoSection } from './FreeDemoSection';
import { IconChevronLeft, IconChevronRight } from '@/components/icons/student-icons';
import { useAuth } from '@/context/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { getHomepageTrendingCourses } from '@/services/courseCatalogService';
import { useStudentPyqPurchases } from '@/hooks/student/useStudentPyqPurchases';
import { useStoreCarousel } from './useStoreCarousel';
import {
  fetchStudentBootstrap,
  studentDashboardKeys,
  type StudentEnrolledCourse,
} from '@/services/student/studentDashboardWebService';
import type { Course, CourseBatchItem } from '@/types/courseCatalog';
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

  // React Query: Student courses bootstrap
  const { data: bootstrapResult, isLoading: bootstrapLoading } = useQuery({
    queryKey: studentDashboardKeys.bootstrap(profileId),
    queryFn: () => fetchStudentBootstrap(),
    enabled: !!profileId,
    staleTime: 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  // React Query: Student PYQ purchases for hero workspace
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

  // Derive batches associated with the filtered courses (Section 4 & 6)
  // Preserves course context, deduplicates batch records, handles courses without batches gracefully
  const featuredBatches = useMemo(() => {
    const seenBatchIds = new Set<string>();
    const batchList: Array<{ course: Course; batch?: CourseBatchItem }> = [];

    for (const course of featuredCourses) {
      const activeBatches = (course.batches || []).filter((b) => b.isActive);
      if (activeBatches.length > 0) {
        for (const b of activeBatches) {
          if (!seenBatchIds.has(b.id)) {
            seenBatchIds.add(b.id);
            batchList.push({ course, batch: b });
          }
        }
      } else {
        const fallbackId = `course-batch-${course.courseId}`;
        if (!seenBatchIds.has(fallbackId)) {
          seenBatchIds.add(fallbackId);
          batchList.push({
            course,
            batch: {
              id: fallbackId,
              name: course.title,
              code: null,
              isActive: true,
              status: 'active',
            },
          });
        }
      }
    }

    return batchList.slice(0, 8);
  }, [featuredCourses]);

  const courseCarousel = useStoreCarousel(featuredBatches.length);

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
                <h2 id="home-goals-title">Our Courses</h2>
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
          </section>

          <section className="store-home-tint" aria-labelledby="home-courses-title">
            <div
              className="store-container store-home-section"
              id="home-courses"
            >
              <div className="store-section-heading">
                <div>
                  <h2 id="home-courses-title">Explore Batches</h2>
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
                </div>
              </div>
              {coursesLoading ? (
                <CatalogGridSkeleton />
              ) : featuredBatches.length > 0 ? (
                featuredBatches.length > 3 ? (
                  <div className="store-carousel-wrapper">
                    <div
                      ref={courseCarousel.trackRef}
                      className="store-carousel-track-scroll"
                      role="region"
                      aria-label={`${goal.label} courses carousel`}
                    >
                      {featuredBatches.map(({ course, batch }) => (
                        <div
                          key={batch ? `${course.courseId}-${batch.id}` : course.courseId}
                          className="store-carousel-slide-item"
                        >
                          <StoreCourseCard
                            course={course}
                            batch={batch}
                            isEnrolled={enrolledCourseIds.includes(course.courseId)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="store-related-grid">
                    {featuredBatches.map(({ course, batch }) => (
                      <StoreCourseCard
                        key={batch ? `${course.courseId}-${batch.id}` : course.courseId}
                        course={course}
                        batch={batch}
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
                    <p className="store-eyebrow">{goal.label.toUpperCase()} BATCHES</p>
                    <h3>No published batches here yet.</h3>
                    <p>
                      There are no {goal.label} batches published right now. Choose another goal above,
                      or explore the full catalog.
                    </p>
                    <Link className="store-text-link" href="/courses">
                      Explore all courses <span aria-hidden="true">↗</span>
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

