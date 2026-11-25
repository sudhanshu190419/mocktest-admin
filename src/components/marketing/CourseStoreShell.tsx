'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState, useRef, useEffect, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { getPublicNavStreams, type NavStreamItem } from '@/services/courseCatalogService';
import {
  IconChevronDown,
  IconSpark,
  IconLibrary,
  IconGraduationCap,
  IconUser,
  IconSearch,
  IconPlay,
  IconVideo,
  IconCalendar,
  IconTest,
  IconProgress,
  IconLock,
  IconMenu,
  IconClose,
  IconDoubt,
  IconLifeBuoy,
  IconPyq,
  IconBookOpen,
  IconStethoscope,
  IconAtom,
  IconLandmark,
  IconLayers,
} from '@/components/icons/student-icons';
import { useAuth } from '@/context/AuthContext';
import { ToastProvider } from '@/components/ui/mmt';
import { StudentBellButton } from '@/components/student/StudentBellButton';
import { SiteFooter } from './SiteFooter';
import { isExamEnginePath } from '@/lib/routes';
import { StudentBottomNav } from '@/components/student/StudentBottomNav';
import '@/app/courses/courses.css';
import {
  fetchStudentBootstrap,
  studentDashboardKeys,
} from '@/services/student/studentDashboardWebService';

export function CourseStoreShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [coursesMenuOpen, setCoursesMenuOpen] = useState(false);
  const [mobileCoursesOpen, setMobileCoursesOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const coursesDropdownRef = useRef<HTMLDivElement>(null);
  const coursesHoverTimerRef = useRef<NodeJS.Timeout | null>(null);
  const { user, teacherProfile, signOut } = useAuth();
  const loggedIn = !!user;
  const pathname = usePathname();
  const router = useRouter();
  const profileId = user?.id ?? null;

  const isAuthPage =
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/forgot-password') ||
    pathname.startsWith('/onboarding');

  // Frontend-only enrollment read for Demo visibility:
  // show Demo in navbar only when the student has no purchased course.
  // PYQ-only buyers still see Demo; course buyers do not.
  const { data: bootstrapResult } = useQuery({
    queryKey: studentDashboardKeys.bootstrap(profileId),
    queryFn: () => fetchStudentBootstrap(),
    enabled: !!profileId,
    staleTime: 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const enrolledCourses = bootstrapResult?.data?.enrolled_courses ?? [];
  const hasPurchasedCourse = Array.isArray(enrolledCourses) && enrolledCourses.length > 0;

  // Read verified public streams from backend public.streams table
  const { data: dbStreams = [] } = useQuery<NavStreamItem[]>({
    queryKey: ['public-nav-streams'],
    queryFn: () => getPublicNavStreams(),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  // Map backend streams to client labels where verified relationship exists
  const navStreamItems = useMemo(() => {
    return (dbStreams || []).map((stream) => {
      const code = stream.code.toUpperCase();
      let label = stream.name;
      let sublabel = 'Academic Program';
      let IconComponent = IconBookOpen;

      if (code === 'NEET' || stream.name.toUpperCase().includes('NEET')) {
        label = 'NEET';
        sublabel = 'Medical Entrance Prep';
        IconComponent = IconStethoscope;
      } else if (code === 'CUET' || stream.name.toUpperCase().includes('CUET')) {
        label = 'CUET';
        sublabel = 'University Entrance Prep';
        IconComponent = IconGraduationCap;
      } else if (code === '10TH' || stream.name.toLowerCase().includes('10th')) {
        label = '8–10th Grade';
        sublabel = 'Foundation Science & Maths';
        IconComponent = IconBookOpen;
      } else if (code === '12TH' || stream.name.toLowerCase().includes('12th')) {
        label = '11–12th Grade';
        sublabel = 'Senior Secondary & Boards';
        IconComponent = IconLayers;
      } else if (code === 'JEE' || stream.name.toUpperCase().includes('JEE')) {
        label = 'JEE';
        sublabel = 'Engineering Entrance Prep';
        IconComponent = IconAtom;
      } else if (code === 'UPSC' || stream.name.toUpperCase().includes('UPSC')) {
        label = 'UPSC';
        sublabel = 'Civil Services Exam';
        IconComponent = IconLandmark;
      }

      return {
        ...stream,
        label,
        sublabel,
        IconComponent,
      };
    });
  }, [dbStreams]);

  // Close dropdown on click outside or Escape key
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setProfileMenuOpen(false);
      }
      if (coursesDropdownRef.current && !coursesDropdownRef.current.contains(event.target as Node)) {
        setCoursesMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProfileMenuOpen(false);
        setCoursesMenuOpen(false);
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Close dropdown on route transition
  useEffect(() => {
    setCoursesMenuOpen(false);
    setMenuOpen(false);
  }, [pathname]);

  const handleCoursesMouseEnter = () => {
    if (coursesHoverTimerRef.current) clearTimeout(coursesHoverTimerRef.current);
    setCoursesMenuOpen(true);
  };

  const handleCoursesMouseLeave = () => {
    coursesHoverTimerRef.current = setTimeout(() => {
      setCoursesMenuOpen(false);
    }, 180);
  };

  const handleLogout = async () => {
    setMenuOpen(false);
    setProfileMenuOpen(false);
    try {
      await signOut();
      router.push('/');
      router.refresh();
    } catch {
      // Ignored
    }
  };

  const rawName = teacherProfile?.name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Student';
  const studentName = rawName
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

  const initials = rawName
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((w: string) => w[0]?.toUpperCase())
    .slice(0, 2)
    .join('') || 'ST';

  const baseLinks = [
    { key: 'nav-home', href: '/', label: 'Home', current: pathname === '/' },
    { key: 'nav-courses', href: '/courses', label: 'Courses', current: pathname.startsWith('/courses') },
    { key: 'nav-pyq', href: '/pyq', label: 'PYQ & Mock Test', current: pathname.startsWith('/pyq') },
    ...(!loggedIn || !hasPurchasedCourse
      ? [{ key: 'nav-live', href: '/demo-class', label: 'Demo', current: pathname.startsWith('/demo-class') }]
      : []),
    { key: 'nav-blog', href: '/blog', label: 'Blog', current: pathname.startsWith('/blog') },
  ];

  const links = loggedIn
    ? [
        ...baseLinks,
        { key: 'nav-learning', href: '/student/overview', label: 'My Learning', current: pathname.startsWith('/student') },
      ]
    : baseLinks;

  // PRD §4.2 — measure the sticky header into --shell-offset and --store-header-height
  useEffect(() => {
    const header = document.querySelector('.store-header');
    if (!header || typeof ResizeObserver === 'undefined') return;
    const apply = () => {
      const h = header.getBoundingClientRect().height;
      if (h > 0) {
        document.documentElement.style.setProperty('--shell-offset', `${Math.round(h + 12)}px`);
        document.documentElement.style.setProperty('--store-header-height', `${Math.round(h)}px`);
      }
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);

  if (isExamEnginePath(pathname)) {
    return <ToastProvider>{children}</ToastProvider>;
  }

  return (
    <ToastProvider>
      <a className="store-skip" href="#store-main">
        Skip to content
      </a>
      <header className="store-header">
        <div className="store-container store-header-inner">
          <Link href="/" className="store-logo flex items-center shrink-0" aria-label="Make Me Topper home">
            <Image
              src="/brand/logo-primary-horizontal.svg"
              alt="Make Me Topper"
              width={210}
              height={50}
              className="h-9 sm:h-10 md:h-11 lg:h-12 w-auto object-contain shrink-0"
              priority
            />
          </Link>
          <nav className="store-desktop-nav" aria-label="Main navigation">
            {links.map((link) => {
              if (link.key === 'nav-courses') {
                return (
                  <div
                    key={link.key}
                    ref={coursesDropdownRef}
                    className="store-nav-item-dropdown relative"
                    onMouseEnter={handleCoursesMouseEnter}
                    onMouseLeave={handleCoursesMouseLeave}
                  >
                    <button
                      type="button"
                      className={`store-nav-link-btn flex items-center gap-1 ${link.current ? 'is-current' : ''}`}
                      onClick={() => setCoursesMenuOpen((prev) => !prev)}
                      aria-expanded={coursesMenuOpen}
                      aria-haspopup="menu"
                      aria-label="Courses menu"
                    >
                      <span>Courses</span>
                      <IconChevronDown
                        size={12}
                        className="store-nav-caret transition-transform duration-200"
                        style={{ transform: coursesMenuOpen ? 'rotate(180deg)' : 'none' }}
                      />
                    </button>
                    {coursesMenuOpen && (
                      <div className="store-courses-dropdown animate-fadeIn" role="menu" aria-label="Course categories">
                        <div className="store-courses-dropdown-header">
                          <span>Explore Streams</span>
                        </div>
                        <div className="store-courses-dropdown-list">
                          <Link
                            href="/courses"
                            onClick={() => setCoursesMenuOpen(false)}
                            className="store-courses-dropdown-item font-semibold"
                            role="menuitem"
                          >
                            <span className="store-courses-dropdown-icon">
                              <IconLibrary size={18} className="text-blue-600" />
                            </span>
                            <div>
                              <strong>All Courses & Batches</strong>
                              <small>Browse all available programs</small>
                            </div>
                          </Link>
                          {navStreamItems.map((item) => {
                            const ItemIcon = item.IconComponent;
                            return (
                              <Link
                                key={item.streamId}
                                href={`/courses?stream=${encodeURIComponent(item.code)}`}
                                onClick={() => setCoursesMenuOpen(false)}
                                className="store-courses-dropdown-item"
                                role="menuitem"
                              >
                                <span className="store-courses-dropdown-icon">
                                  <ItemIcon size={18} className="text-blue-600" />
                                </span>
                                <div>
                                  <strong>{item.label}</strong>
                                  <small>{item.sublabel}</small>
                                </div>
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <Link
                  key={link.key}
                  href={link.href}
                  className={link.current ? 'is-current' : undefined}
                  aria-current={link.current ? 'page' : undefined}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
          <div className="store-header-actions">
            {loggedIn && <StudentBellButton />}
            {loggedIn ? (
              <div className="relative" ref={dropdownRef}>
                <button
                  type="button"
                  className="store-user-btn"
                  onClick={() => setProfileMenuOpen(!profileMenuOpen)}
                  aria-expanded={profileMenuOpen}
                  aria-haspopup="menu"
                  aria-label={`Student menu: ${studentName}`}
                >
                  <span className="store-user-avatar" aria-hidden="true">
                    {initials}
                  </span>
                  <span className="store-user-name">
                    {studentName}
                  </span>
                  <IconChevronDown
                    size={12}
                    className="store-user-caret transition-transform duration-200"
                    style={{ transform: profileMenuOpen ? 'rotate(180deg)' : 'none' }}
                  />
                </button>
                {profileMenuOpen && (
                  <div className="store-user-dropdown" role="menu">
                    <div className="store-user-dropdown-header">
                      <p className="store-user-dropdown-name">{studentName}</p>
                      <p className="store-user-dropdown-email">{user?.email}</p>
                      <span className="store-user-dropdown-badge">Student Portal</span>
                    </div>
                    <div className="store-user-dropdown-links">
                      <Link
                        href="/student/overview"
                        onClick={() => setProfileMenuOpen(false)}
                        className="store-user-dropdown-item"
                        role="menuitem"
                      >
                        <IconSpark size={15} />
                        <span>Dashboard</span>
                      </Link>
                      <Link
                        href="/student/courses"
                        onClick={() => setProfileMenuOpen(false)}
                        className="store-user-dropdown-item"
                        role="menuitem"
                      >
                        <IconLibrary size={15} />
                        <span>My Courses</span>
                      </Link>
                      <Link
                        href="/student/timetable"
                        onClick={() => setProfileMenuOpen(false)}
                        className="store-user-dropdown-item"
                        role="menuitem"
                      >
                        <IconCalendar size={15} />
                        <span>Time Table</span>
                      </Link>
                      <Link
                        href="/student/classes"
                        onClick={() => setProfileMenuOpen(false)}
                        className="store-user-dropdown-item"
                        role="menuitem"
                      >
                        <IconVideo size={15} />
                        <span>Live Classes</span>
                      </Link>
                      <Link
                        href="/student/recordings"
                        onClick={() => setProfileMenuOpen(false)}
                        className="store-user-dropdown-item"
                        role="menuitem"
                      >
                        <IconPlay size={15} />
                        <span>Recordings</span>
                      </Link>
                      <Link
                        href="/pyq"
                        onClick={() => setProfileMenuOpen(false)}
                        className="store-user-dropdown-item"
                        role="menuitem"
                      >
                        <IconPyq size={15} />
                        <span>PYQ & Sample Paper</span>
                      </Link>
                      <Link
                        href="/student/tests"
                        onClick={() => setProfileMenuOpen(false)}
                        className="store-user-dropdown-item"
                        role="menuitem"
                      >
                        <IconTest size={15} />
                        <span>Class Test</span>
                      </Link>
                      <Link
                        href="/student/doubts"
                        onClick={() => setProfileMenuOpen(false)}
                        className="store-user-dropdown-item"
                        role="menuitem"
                      >
                        <IconDoubt size={15} />
                        <span>My Doubts</span>
                      </Link>
                      <Link
                        href="/student/analytics"
                        onClick={() => setProfileMenuOpen(false)}
                        className="store-user-dropdown-item"
                        role="menuitem"
                      >
                        <IconProgress size={15} />
                        <span>My Performance</span>
                      </Link>
                      <Link
                        href="/student/results"
                        onClick={() => setProfileMenuOpen(false)}
                        className="store-user-dropdown-item"
                        role="menuitem"
                      >
                        <IconGraduationCap size={15} />
                        <span>Results</span>
                      </Link>
                      <div className="store-user-dropdown-sep" role="separator" />
                      <Link
                        href="/student/profile"
                        onClick={() => setProfileMenuOpen(false)}
                        className="store-user-dropdown-item"
                        role="menuitem"
                      >
                        <IconUser size={15} />
                        <span>Profile</span>
                      </Link>
                      <Link
                        href="/#contact"
                        onClick={() => setProfileMenuOpen(false)}
                        className="store-user-dropdown-item"
                        role="menuitem"
                      >
                        <IconLifeBuoy size={15} />
                        <span>Contact & Help</span>
                      </Link>
                    </div>
                    <div className="store-user-dropdown-footer">
                      <button
                        type="button"
                        onClick={handleLogout}
                        className="store-user-dropdown-logout"
                        role="menuitem"
                      >
                        <IconLock size={15} />
                        <span>Sign Out</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 sm:gap-3">
                <button
                  type="button"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-blue-600"
                  aria-label="Search courses and tests"
                  onClick={() => router.push('/courses')}
                >
                  <IconSearch size={18} />
                </button>
                <Link
                  href={`/login?next=${encodeURIComponent(pathname)}`}
                  className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3.5 sm:px-5 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold text-slate-800 shadow-xs transition-all hover:border-slate-300 hover:bg-slate-50 active:scale-95"
                >
                  Log in
                </Link>
                <Link
                  href={`/signup?next=${encodeURIComponent(pathname)}`}
                  className="hidden md:inline-flex items-center justify-center gap-1.5 rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-xs transition-all hover:bg-blue-700"
                >
                  Get Started <span aria-hidden="true">→</span>
                </Link>
              </div>
            )}
            <button
              className="store-menu-toggle flex items-center justify-center"
              aria-expanded={menuOpen}
              aria-controls="store-mobile-nav"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {menuOpen ? <IconClose size={20} /> : <IconMenu size={20} />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav
            id="store-mobile-nav"
            className="store-mobile-nav animate-fadeIn"
            aria-label="Mobile navigation"
          >
            {links.map((link) => {
              if (link.key === 'nav-courses') {
                return (
                  <div key={link.key} className="store-mobile-nav-group py-1">
                    <button
                      type="button"
                      className="store-mobile-nav-toggle flex items-center justify-between w-full font-semibold text-slate-800 py-2"
                      onClick={() => setMobileCoursesOpen((prev) => !prev)}
                      aria-expanded={mobileCoursesOpen}
                      aria-label="Toggle courses categories"
                    >
                      <span>Courses</span>
                      <IconChevronDown
                        size={15}
                        className="transition-transform duration-200 text-slate-500"
                        style={{ transform: mobileCoursesOpen ? 'rotate(180deg)' : 'none' }}
                      />
                    </button>
                    {mobileCoursesOpen && (
                      <div className="store-mobile-subnav flex flex-col pl-3 py-1 gap-1.5 border-l-2 border-blue-200 ml-1.5 my-1">
                        <Link
                          href="/courses"
                          onClick={() => {
                            setMenuOpen(false);
                            setMobileCoursesOpen(false);
                          }}
                          className="text-sm py-1 font-bold text-blue-600 flex items-center gap-2"
                        >
                          <IconLibrary size={16} className="text-blue-600 shrink-0" />
                          <span>All Courses & Batches</span>
                        </Link>
                        {navStreamItems.map((item) => {
                          const ItemIcon = item.IconComponent;
                          return (
                            <Link
                              key={item.streamId}
                              href={`/courses?stream=${encodeURIComponent(item.code)}`}
                              onClick={() => {
                                setMenuOpen(false);
                                setMobileCoursesOpen(false);
                              }}
                              className="text-sm py-1 text-slate-700 hover:text-blue-600 flex items-center justify-between"
                            >
                              <span className="flex items-center gap-2">
                                <ItemIcon size={15} className="text-blue-500 shrink-0" />
                                <span>{item.label}</span>
                              </span>
                              <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-mono">
                                {item.code}
                              </span>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <Link
                  key={link.key}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                >
                  {link.label}
                </Link>
              );
            })}
            {loggedIn ? (
              <>
                <Link
                  href="/student/overview"
                  onClick={() => setMenuOpen(false)}
                  style={{ color: 'var(--color-store-muted)' }}
                >
                  Dashboard
                </Link>
                <Link
                  href="/student/courses"
                  onClick={() => setMenuOpen(false)}
                  style={{ color: 'var(--color-store-muted)' }}
                >
                  My Courses
                </Link>
                <Link
                  href="/student/timetable"
                  onClick={() => setMenuOpen(false)}
                  style={{ color: 'var(--color-store-muted)' }}
                >
                  Time Table
                </Link>
                <Link
                  href="/student/classes"
                  onClick={() => setMenuOpen(false)}
                  style={{ color: 'var(--color-store-muted)' }}
                >
                  Live Classes
                </Link>
                <Link
                  href="/student/recordings"
                  onClick={() => setMenuOpen(false)}
                  style={{ color: 'var(--color-store-muted)' }}
                >
                  Recordings
                </Link>
                <Link
                  href="/pyq"
                  onClick={() => setMenuOpen(false)}
                  style={{ color: 'var(--color-store-muted)' }}
                >
                  PYQ & Sample Paper
                </Link>
                <Link
                  href="/student/tests"
                  onClick={() => setMenuOpen(false)}
                  style={{ color: 'var(--color-store-muted)' }}
                >
                  Class Test
                </Link>
                <Link
                  href="/student/doubts"
                  onClick={() => setMenuOpen(false)}
                  style={{ color: 'var(--color-store-muted)' }}
                >
                  My Doubts
                </Link>
                <Link
                  href="/student/analytics"
                  onClick={() => setMenuOpen(false)}
                  style={{ color: 'var(--color-store-muted)' }}
                >
                  My Performance
                </Link>
                <Link
                  href="/student/results"
                  onClick={() => setMenuOpen(false)}
                  style={{ color: 'var(--color-store-muted)' }}
                >
                  Results
                </Link>
                <Link
                  href="/student/profile"
                  onClick={() => setMenuOpen(false)}
                  style={{ color: 'var(--color-store-muted)' }}
                >
                  Profile
                </Link>
                <Link
                  href="/#contact"
                  onClick={() => setMenuOpen(false)}
                  style={{ color: 'var(--color-store-muted)' }}
                >
                  Contact & Help
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  style={{ textAlign: 'left', color: 'var(--color-error, #dc2626)', marginTop: '8px', fontWeight: 600 }}
                >
                  Sign Out
                </button>
              </>
            ) : (
              <div className="flex flex-col gap-2 pt-3 mt-2 border-t border-line">
                <Link
                  href={`/login?next=${encodeURIComponent(pathname)}`}
                  onClick={() => setMenuOpen(false)}
                  className="px-4 py-2.5 rounded-button text-center font-bold text-sm bg-paper text-ink border border-line"
                >
                  Log In
                </Link>
                <Link
                  href={`/signup?next=${encodeURIComponent(pathname)}`}
                  onClick={() => setMenuOpen(false)}
                  className="px-4 py-2.5 rounded-button text-center font-bold text-sm bg-brand text-white"
                >
                  Get Started Free
                </Link>
              </div>
            )}
          </nav>
        )}
      </header>
      {children}
      {!isAuthPage && <SiteFooter />}
      {!isAuthPage && <StudentBottomNav />}
    </ToastProvider>
  );
}

