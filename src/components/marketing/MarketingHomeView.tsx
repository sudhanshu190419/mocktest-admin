'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { CourseStoreShell } from './CourseStoreShell';
import { HeroSection } from './HeroSection';
import { StudentHomeHero } from './StudentHomeHero';
import { StoreCourseCard } from './StoreCourseCard';
import { PYQPackageCard } from './PYQCatalog';
import { AppShowcaseSection } from './AppShowcaseSection';
import { FreeDemoSection } from './FreeDemoSection';
import { useAuth } from '@/context/AuthContext';
import { getCourses } from '@/services/courseCatalogService';
import { getPYQPackages } from '@/services/pyqCatalogService';
import {
  fetchCompleteStudentDashboard,
  type StudentDashboardSummary,
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

export function MarketingHomeView() {
  const { user, teacherProfile } = useAuth();
  const [selectedGoal, setSelectedGoal] = useState<string>('NEET');
  const [courses, setCourses] = useState<Course[]>([]);
  const [pyqPackages, setPyqPackages] = useState<PYQPackage[]>([]);
  const [, setLoading] = useState(true);

  // Student specific dashboard state
  const [dashboardData, setDashboardData] = useState<StudentDashboardSummary | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(!!user);

  useEffect(() => {
    let isMounted = true;
    Promise.all([getCourses(), getPYQPackages()])
      .then(([c, p]) => {
        if (isMounted) {
          setCourses(c);
          setPyqPackages(p);
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // Fetch student dashboard if user is authenticated
  useEffect(() => {
    let isMounted = true;
    if (user) {
      setDashboardLoading(true);
      fetchCompleteStudentDashboard()
        .then((data) => {
          if (isMounted) {
            setDashboardData(data);
            // If student has a selected stream matching one of our goals, sync selectedGoal
            const studentStream = data?.selectedStreamName;
            if (studentStream) {
              const matched = GOALS.find((g) =>
                studentStream.toUpperCase().includes(g.code)
              );
              if (matched) {
                setSelectedGoal(matched.code);
              }
            }
          }
        })
        .catch(() => {
          // Fallback gracefully
        })
        .finally(() => {
          if (isMounted) setDashboardLoading(false);
        });
    } else {
      setDashboardData(null);
      setDashboardLoading(false);
    }

    return () => {
      isMounted = false;
    };
  }, [user]);

  const rawName = dashboardData?.profile?.name || teacherProfile?.name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Student';
  const studentName = rawName
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

  const enrolledCourseIds = (dashboardData?.enrolledCourses || []).map((c) => c.course_id);
  const hasEnrolledCourses = enrolledCourseIds.length > 0;

  const goal = GOALS.find((item) => item.code === selectedGoal) ?? GOALS[0];
  const featuredCourses = courses.filter((course) => course.streamCode === goal.code).slice(0, 3);
  const featuredPyq = pyqPackages.filter((item) => item.streamCode === goal.code).slice(0, 3);

  return (
    <div className="course-store store-home">
      <CourseStoreShell>
        <main id="store-main">
          <h1 className="sr-only">MakeMeTopper — Learn with structure. Practise with intent.</h1>

          {/* Dual-Mode Hero: Personalized Student Hero only when enrolled in 1+ courses, Visitor/Discovery Carousel for guests & new students */}
          {user && hasEnrolledCourses ? (
            <StudentHomeHero
              studentName={studentName}
              streamName={dashboardData?.selectedStreamName}
              data={dashboardData}
              loading={dashboardLoading}
            />
          ) : (
            <HeroSection />
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
              <Link className="store-text-link" href="/courses">
                All courses, all goals <span aria-hidden="true">↗</span>
              </Link>
            </div>
            {featuredCourses.length > 0 ? (
              <div className="store-related-grid">
                {featuredCourses.map((course) => (
                  <StoreCourseCard
                    key={course.courseId}
                    course={course}
                    isEnrolled={enrolledCourseIds.includes(course.courseId)}
                  />
                ))}
              </div>
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
                <Link className="store-text-link" href="/pyq">
                  All PYQ packages <span aria-hidden="true">↗</span>
                </Link>
              </div>
              {featuredPyq.length > 0 ? (
                <div className="store-related-grid">
                  {featuredPyq.map((item) => (
                    <PYQPackageCard key={item.packageId} item={item} />
                  ))}
                </div>
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

          <section
            className="store-container store-home-section store-home-method"
            aria-labelledby="home-method-title"
          >
            <div className="store-home-method-intro">
              <p className="store-eyebrow">A NOTE FOR YOUR STUDY DESK</p>
              <h2 id="home-method-title">
                Small steps.
                <br />A clearer direction.
              </h2>
              <p>A simple rhythm to bring to your preparation, whichever goal you choose.</p>
              <span className="store-home-method-signature">Keep a little room for curiosity.</span>
            </div>
            <ol className="store-pillars">
              {[
                [
                  '01',
                  'Understand the idea.',
                  'Start with one concept. Put it into your own words before moving to the next.',
                ],
                [
                  '02',
                  'Put it to the test.',
                  'Work through a question without your notes. Notice where you hesitate, not just where you finish.',
                ],
                [
                  '03',
                  'Return with a reason.',
                  'Keep a note of what tripped you up. Let that guide your next revision session.',
                ],
              ].map(([num, title, copy]) => (
                <li key={num} className="store-pillar">
                  <span className="store-pillar-num tabular-nums">{num}</span>
                  <div>
                    <h3>{title}</h3>
                    <p>{copy}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <AppShowcaseSection />

          <FreeDemoSection />
        </main>
      </CourseStoreShell>
    </div>
  );
}
