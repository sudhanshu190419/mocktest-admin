'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState, useRef, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  IconChevronDown,
  IconSpark,
  IconLibrary,
  IconGraduationCap,
  IconUser,
  IconSearch,
  IconPlay,
  IconCalendar,
  IconTest,
  IconProgress,
  IconLock,
  IconMenu,
  IconClose,
} from '@/components/icons/student-icons';
import { useAuth } from '@/context/AuthContext';
import { ToastProvider } from '@/components/ui/mmt';
import { StudentBellButton } from '@/components/student/StudentBellButton';
import { SiteFooter } from './SiteFooter';
import { isExamEnginePath } from '@/lib/routes';
import {
  fetchStudentBootstrap,
  studentDashboardKeys,
} from '@/services/student/studentDashboardWebService';

export function CourseStoreShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { user, teacherProfile, signOut } = useAuth();
  const loggedIn = !!user;
  const pathname = usePathname();
  const router = useRouter();
  const profileId = user?.id ?? null;

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

  // Close dropdown on click outside or Escape key
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProfileMenuOpen(false);
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
    { key: 'nav-pyq', href: '/pyq', label: 'PYQ Packages', current: pathname.startsWith('/pyq') },
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

  // PRD §4.2 — measure the sticky header into --shell-offset
  useEffect(() => {
    const header = document.querySelector('.store-header');
    if (!header || typeof ResizeObserver === 'undefined') return;
    const apply = () => {
      const h = header.getBoundingClientRect().height;
      if (h > 0) {
        document.documentElement.style.setProperty('--shell-offset', `${Math.round(h + 12)}px`);
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
          <Link href="/" className="store-logo flex items-center" aria-label="Make Me Topper home">
            <Image
              src="/brand/logo-primary-horizontal.svg"
              alt="Make Me Topper"
              width={165}
              height={38}
              className="h-8 md:h-9 w-auto object-contain"
              priority
            />
          </Link>
          <nav className="store-desktop-nav" aria-label="Main navigation">
            {links.map((link) => (
              <Link
                key={link.key}
                href={link.href}
                className={link.current ? 'is-current' : undefined}
                aria-current={link.current ? 'page' : undefined}
              >
                {link.label}
              </Link>
            ))}
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
                        <span>My Learning</span>
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
                        href="/student/tests"
                        onClick={() => setProfileMenuOpen(false)}
                        className="store-user-dropdown-item"
                        role="menuitem"
                      >
                        <IconGraduationCap size={15} />
                        <span>Mock Tests</span>
                      </Link>
                      <div className="store-user-dropdown-sep" role="separator" />
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
                        href="/student/timetable"
                        onClick={() => setProfileMenuOpen(false)}
                        className="store-user-dropdown-item"
                        role="menuitem"
                      >
                        <IconCalendar size={15} />
                        <span>Timetable</span>
                      </Link>
                      <Link
                        href="/student/results"
                        onClick={() => setProfileMenuOpen(false)}
                        className="store-user-dropdown-item"
                        role="menuitem"
                      >
                        <IconTest size={15} />
                        <span>Results</span>
                      </Link>
                      <Link
                        href="/student/analytics"
                        onClick={() => setProfileMenuOpen(false)}
                        className="store-user-dropdown-item"
                        role="menuitem"
                      >
                        <IconProgress size={15} />
                        <span>Analytics</span>
                      </Link>
                      <div className="store-user-dropdown-sep" role="separator" />
                      <Link
                        href="/student/profile"
                        onClick={() => setProfileMenuOpen(false)}
                        className="store-user-dropdown-item"
                        role="menuitem"
                      >
                        <IconUser size={15} />
                        <span>Profile & Settings</span>
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
              <div className="flex items-center gap-3">
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
                  className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-800 shadow-xs transition-all hover:border-slate-300 hover:bg-slate-50"
                >
                  Log in
                </Link>
                <Link
                  href={`/signup?next=${encodeURIComponent(pathname)}`}
                  className="inline-flex items-center justify-center gap-1.5 rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-xs transition-all hover:bg-blue-700"
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
            {links.map((link) => (
              <Link
                key={link.key}
                href={link.href}
                onClick={() => setMenuOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            {loggedIn ? (
              <>
                <Link
                  href="/student/recordings"
                  onClick={() => setMenuOpen(false)}
                  style={{ color: 'var(--color-store-muted)' }}
                >
                  Recordings
                </Link>
                <Link
                  href="/student/timetable"
                  onClick={() => setMenuOpen(false)}
                  style={{ color: 'var(--color-store-muted)' }}
                >
                  Timetable
                </Link>
                <Link
                  href="/student/results"
                  onClick={() => setMenuOpen(false)}
                  style={{ color: 'var(--color-store-muted)' }}
                >
                  Results & Scorecards
                </Link>
                <Link
                  href="/student/analytics"
                  onClick={() => setMenuOpen(false)}
                  style={{ color: 'var(--color-store-muted)' }}
                >
                  Performance Analytics
                </Link>
                <Link
                  href="/student/profile"
                  onClick={() => setMenuOpen(false)}
                  style={{ color: 'var(--color-store-muted)' }}
                >
                  Profile & Settings
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  style={{ textAlign: 'left', color: 'var(--color-error, #dc2626)', marginTop: '8px', fontWeight: 600 }}
                >
                  Sign out
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
      <SiteFooter />
    </ToastProvider>
  );
}

