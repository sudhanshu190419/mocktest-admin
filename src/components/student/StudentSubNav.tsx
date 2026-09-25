'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  IconHome,
  IconLibrary,
  IconVideo,
  IconFilm,
  IconTest,
  IconCalendar,
  IconDoubt,
  IconProgress,
  IconTrophy,
  IconUser,
} from '@/components/icons/student-icons';
import { useNavBadgeCounts } from '@/hooks/student/useNavBadgeCounts';
import { isExamEnginePath } from '@/lib/routes';

export interface StudentSubNavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  badge?: 'tests' | 'doubts';
  matches: (pathname: string) => boolean;
}

export const STUDENT_NAV_ITEMS: StudentSubNavItem[] = [
  {
    label: 'Dashboard',
    href: '/student/overview',
    icon: IconHome,
    matches: (pathname: string) =>
      pathname === '/student/overview' || pathname === '/student',
  },
  {
    label: 'My Courses',
    href: '/student/courses',
    icon: IconLibrary,
    matches: (pathname: string) =>
      pathname === '/student/courses' || pathname.startsWith('/student/courses/'),
  },
  {
    label: 'Live Classes',
    href: '/student/classes',
    icon: IconVideo,
    matches: (pathname: string) =>
      pathname === '/student/classes' || pathname.startsWith('/student/classes/'),
  },
  {
    label: 'Recordings',
    href: '/student/recordings',
    icon: IconFilm,
    matches: (pathname: string) =>
      pathname === '/student/recordings' || pathname.startsWith('/student/recordings/'),
  },
  {
    label: 'Mock Tests',
    href: '/student/tests',
    icon: IconTest,
    badge: 'tests',
    matches: (pathname: string) =>
      pathname === '/student/tests' || pathname.startsWith('/student/tests/'),
  },
  {
    label: 'Timetable',
    href: '/student/timetable',
    icon: IconCalendar,
    matches: (pathname: string) =>
      pathname === '/student/timetable' || pathname.startsWith('/student/timetable/'),
  },
  {
    label: 'My Doubts',
    href: '/student/doubts',
    icon: IconDoubt,
    badge: 'doubts',
    matches: (pathname: string) =>
      pathname === '/student/doubts' || pathname.startsWith('/student/doubts/'),
  },
  {
    label: 'Analytics',
    href: '/student/analytics',
    icon: IconProgress,
    matches: (pathname: string) =>
      pathname === '/student/analytics' || pathname.startsWith('/student/analytics/'),
  },
  {
    label: 'Results',
    href: '/student/results',
    icon: IconTrophy,
    matches: (pathname: string) =>
      pathname === '/student/results' || pathname.startsWith('/student/results/'),
  },
  {
    label: 'Profile',
    href: '/student/profile',
    icon: IconUser,
    matches: (pathname: string) =>
      pathname === '/student/profile' || pathname.startsWith('/student/profile/'),
  },
];

export function StudentSubNav() {
  const pathname = usePathname();
  const navRef = React.useRef<HTMLElement>(null);
  const { testsDue, openDoubts } = useNavBadgeCounts();

  React.useEffect(() => {
    if (!navRef.current) return;
    const activeEl = navRef.current.querySelector<HTMLElement>('.student-subnav-pill.is-active');
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
    }
  }, [pathname]);

  // Distraction-free surfaces: exam engine + runner + live room
  if (
    isExamEnginePath(pathname) ||
    pathname.includes('/runner') ||
    pathname.includes('/student/runner') ||
    pathname.match(/\/student\/classes\/[^/]+$/)
  ) {
    return null;
  }

  return (
    <div className="student-subnav-strip">
      <div className="store-container student-subnav-container">
        <nav ref={navRef} className="student-subnav-inner" aria-label="Student Portal Navigation">
          {STUDENT_NAV_ITEMS.map((item) => {
            const isActive = item.matches(pathname);
            const Icon = item.icon;
            const badgeCount =
              item.badge === 'tests'
                ? testsDue
                : item.badge === 'doubts'
                  ? openDoubts
                  : 0;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`student-subnav-pill ${isActive ? 'is-active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon size={16} className="student-subnav-icon shrink-0" />
                <span className="student-subnav-label">{item.label}</span>
                {badgeCount > 0 && (
                  <span
                    className="student-subnav-badge"
                    aria-label={`${badgeCount} ${item.label}`}
                  >
                    {badgeCount > 9 ? '9+' : badgeCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
