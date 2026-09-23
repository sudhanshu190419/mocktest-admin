'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState, useRef, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  CaretDown,
  Sparkle,
  BookOpen,
  GraduationCap,
  User,
  SignOut,
  FilmSlate,
  CalendarBlank,
  Trophy,
  ChartLineUp,
  MagnifyingGlass,
} from '@phosphor-icons/react';
import { ButtonLink } from './Button';
import { useAuth } from '@/context/AuthContext';
import { ToastProvider } from '@/components/ui/mmt';
import { StudentBellButton } from '@/components/student/StudentBellButton';
import { SiteFooter } from './SiteFooter';

export function CourseStoreShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { user, teacherProfile, signOut } = useAuth();
  const loggedIn = !!user;
  const pathname = usePathname();
  const router = useRouter();

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
    { key: 'nav-courses', href: '/courses', label: 'Courses', current: pathname.startsWith('/courses') && !pathname.includes('mock') },
    { key: 'nav-tests', href: '/courses#home-courses', label: 'Mock Tests', current: pathname.includes('mock') || pathname.includes('test') },
    { key: 'nav-pyq', href: '/pyq', label: 'PYQ Packages', current: pathname.startsWith('/pyq') },
    { key: 'nav-live', href: '/demo-class', label: 'Live Classes', current: pathname.startsWith('/demo-class') },
    { key: 'nav-blog', href: '/blog', label: 'Blog', current: pathname.startsWith('/blog') },
  ];

  const links = loggedIn
    ? [
        ...baseLinks,
        { key: 'nav-learning', href: '/student/overview', label: 'My Learning', current: pathname.startsWith('/student') },
      ]
    : baseLinks;

  const isStudentRoute = pathname.startsWith('/student');

  // PRD §4.2 — measure the sticky header into --shell-offset; any sticky
  // element (e.g. the student sub-nav) consumes it. Kills the 65/75/85px
  // magic numbers.
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
            {loggedIn && isStudentRoute && <StudentBellButton />}
            {loggedIn ? (
              <div className="relative" ref={dropdownRef}>
                <button
                  type="button"
                  className="store-user-btn"
                  onClick={() => setProfileMenuOpen(!profileMenuOpen)}
                  aria-expanded={profileMenuOpen}
                  aria-haspopup="menu"
                >
                  <span className="store-user-avatar" aria-hidden="true">
                    {initials}
                  </span>
                  <span className="store-user-name">
                    {studentName}
                  </span>
                  <CaretDown
                    size={12}
                    weight="bold"
                    className="store-user-caret"
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
                        <Sparkle size={15} weight="duotone" />
                        <span>My Learning</span>
                      </Link>
                      <Link
                        href="/student/courses"
                        onClick={() => setProfileMenuOpen(false)}
                        className="store-user-dropdown-item"
                        role="menuitem"
                      >
                        <BookOpen size={15} weight="duotone" />
                        <span>My Courses</span>
                      </Link>
                      <Link
                        href="/student/tests"
                        onClick={() => setProfileMenuOpen(false)}
                        className="store-user-dropdown-item"
                        role="menuitem"
                      >
                        <GraduationCap size={15} weight="duotone" />
                        <span>Mock Tests</span>
                      </Link>
                      <Link
                        href="/student/profile"
                        onClick={() => setProfileMenuOpen(false)}
                        className="store-user-dropdown-item"
                        role="menuitem"
                      >
                        <User size={15} weight="duotone" />
                        <span>Profile & Settings</span>
                      </Link>
                      {isStudentRoute && (
                        <>
                          <div className="store-user-dropdown-sep" role="separator" />
                          <Link
                            href="/student/recordings"
                            onClick={() => setProfileMenuOpen(false)}
                            className="store-user-dropdown-item"
                            role="menuitem"
                          >
                            <FilmSlate size={15} weight="duotone" />
                            <span>Recordings</span>
                          </Link>
                          <Link
                            href="/student/timetable"
                            onClick={() => setProfileMenuOpen(false)}
                            className="store-user-dropdown-item"
                            role="menuitem"
                          >
                            <CalendarBlank size={15} weight="duotone" />
                            <span>Timetable</span>
                          </Link>
                          <Link
                            href="/student/results"
                            onClick={() => setProfileMenuOpen(false)}
                            className="store-user-dropdown-item"
                            role="menuitem"
                          >
                            <Trophy size={15} weight="duotone" />
                            <span>Results</span>
                          </Link>
                          <Link
                            href="/student/analytics"
                            onClick={() => setProfileMenuOpen(false)}
                            className="store-user-dropdown-item"
                            role="menuitem"
                          >
                            <ChartLineUp size={15} weight="duotone" />
                            <span>Analytics</span>
                          </Link>
                        </>
                      )}
                    </div>
                    <div className="store-user-dropdown-footer">
                      <button
                        type="button"
                        onClick={handleLogout}
                        className="store-user-dropdown-logout"
                        role="menuitem"
                      >
                        <SignOut size={15} weight="bold" />
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
                  <MagnifyingGlass size={19} weight="bold" />
                </button>
                <Link
                  href={`/login?next=${encodeURIComponent(pathname)}`}
                  className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-800 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50"
                >
                  Log in
                </Link>
                <Link
                  href={`/signup?next=${encodeURIComponent(pathname)}`}
                  className="inline-flex items-center justify-center gap-1.5 rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-blue-600/20 transition-all hover:bg-blue-700"
                >
                  Get Started <span aria-hidden="true">→</span>
                </Link>
              </div>
            )}
            <button
              className="store-menu-toggle"
              aria-expanded={menuOpen}
              aria-controls="store-mobile-nav"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {menuOpen ? 'Close' : 'Menu'}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav
            id="store-mobile-nav"
            className="store-mobile-nav"
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
            {loggedIn && (
              <>
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
                  style={{ textAlign: 'left', color: 'var(--color-error)', marginTop: '6px', fontWeight: 600 }}
                >
                  Sign out
                </button>
              </>
            )}
          </nav>
        )}
      </header>
      {children}
      <SiteFooter />
    </ToastProvider>
  );
}
