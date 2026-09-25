'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  IconHome,
  IconLibrary,
  IconTest,
  IconPyq,
  IconUser,
} from '@/components/icons/student-icons';
import { useNavBadgeCounts } from '@/hooks/student/useNavBadgeCounts';
import { isExamEnginePath } from '@/lib/routes';

import { useAuth } from '@/context/AuthContext';

/**
 * PRD §4.1 — persistent mobile bottom bar (<1024px for logged-in students).
 * 5 primary destinations: Home · Courses · Tests · PYQ · Me
 * >=44px hit targets, custom vector icons, token-driven badge indicators.
 */

interface BottomNavItemConfig {
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  badge?: 'tests';
  matches: (pathname: string) => boolean;
}

export const bottomNavItems: BottomNavItemConfig[] = [
  {
    label: 'Home',
    href: '/',
    icon: IconHome,
    matches: (pathname: string) => pathname === '/',
  },
  {
    label: 'Courses',
    href: '/courses',
    icon: IconLibrary,
    matches: (pathname: string) =>
      pathname === '/courses' ||
      pathname.startsWith('/courses/') ||
      pathname === '/student/courses' ||
      pathname.startsWith('/student/courses/'),
  },
  {
    label: 'Tests',
    href: '/student/tests',
    icon: IconTest,
    badge: 'tests',
    matches: (pathname: string) => pathname.startsWith('/student/tests'),
  },
  {
    label: 'PYQ',
    href: '/pyq',
    icon: IconPyq,
    matches: (pathname: string) => pathname === '/pyq' || pathname.startsWith('/pyq/'),
  },
  {
    label: 'Me',
    href: '/student/overview',
    icon: IconUser,
    matches: (pathname: string) =>
      pathname.startsWith('/student') &&
      !pathname.startsWith('/student/tests') &&
      !pathname.startsWith('/student/courses'),
  },
];

export const guestBottomNavItems: BottomNavItemConfig[] = [
  {
    label: 'Home',
    href: '/',
    icon: IconHome,
    matches: (pathname: string) => pathname === '/',
  },
  {
    label: 'Courses',
    href: '/courses',
    icon: IconLibrary,
    matches: (pathname: string) => pathname === '/courses' || pathname.startsWith('/courses/'),
  },
  {
    label: 'Tests',
    href: '/login?next=/student/tests',
    icon: IconTest,
    matches: (pathname: string) => pathname.startsWith('/student/tests'),
  },
  {
    label: 'PYQ',
    href: '/pyq',
    icon: IconPyq,
    matches: (pathname: string) => pathname === '/pyq' || pathname.startsWith('/pyq/'),
  },
  {
    label: 'Sign In',
    href: '/login',
    icon: IconUser,
    matches: (pathname: string) => pathname === '/login' || pathname === '/signup',
  },
];

export function StudentBottomNav() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { testsDue } = useNavBadgeCounts();

  // Distraction-free surfaces: exam engine + runner + live room
  if (
    isExamEnginePath(pathname) ||
    pathname.includes('/runner') ||
    pathname.includes('/student/runner') ||
    pathname.match(/\/student\/classes\/[^/]+$/)
  ) {
    return null;
  }

  const items = user ? bottomNavItems : guestBottomNavItems;

  return (
    <nav className="student-bottom-nav" aria-label="Primary mobile navigation">
      {items.map((item) => {
        const isActive = item.matches(pathname);
        const Icon = item.icon;
        const count = user && item.badge === 'tests' ? testsDue : 0;

        return (
          <Link
            key={item.label}
            href={item.href}
            className={`student-bottomnav-item ${isActive ? 'is-active' : ''}`}
            aria-current={isActive ? 'page' : undefined}
          >
            <Icon size={20} className="shrink-0" />
            <span className="student-bottomnav-label">{item.label}</span>
            {count > 0 && (
              <span className="student-bottomnav-badge" aria-label={`${count} due tests`}>
                {count > 9 ? '9+' : count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

