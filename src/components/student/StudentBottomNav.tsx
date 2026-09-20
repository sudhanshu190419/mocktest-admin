'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CalendarCheck,
  BookOpen,
  Exam,
  ChatCircleDots,
} from '@phosphor-icons/react';
import { useNavBadgeCounts } from '@/hooks/student/useNavBadgeCounts';

/**
 * PRD §4.1 — persistent mobile bottom bar (<1024px).
 * 4 primary destinations: Today · Courses · Tests · Doubts.
 * 56px hit height, icon + 11px label, safe-area inset, apricot badges.
 * Everything else lives in the avatar menu + in-context links.
 */

const bottomNavItems = [
  { label: 'Today', href: '/student/overview', icon: CalendarCheck, isExact: true },
  { label: 'Courses', href: '/student/courses', icon: BookOpen },
  { label: 'Tests', href: '/student/tests', icon: Exam, badge: 'tests' as const },
  { label: 'Doubts', href: '/student/doubts', icon: ChatCircleDots, badge: 'doubts' as const },
];

export function StudentBottomNav() {
  const pathname = usePathname();
  const { testsDue, openDoubts } = useNavBadgeCounts();

  // Distraction-free surfaces: runner + live room
  if (
    pathname.includes('/runner') ||
    pathname.match(/\/student\/classes\/[^/]+$/)
  ) {
    return null;
  }

  return (
    <nav className="student-bottom-nav" aria-label="Primary destinations">
      {bottomNavItems.map((item) => {
        const isActive = item.isExact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        const count =
          item.badge === 'tests' ? testsDue : item.badge === 'doubts' ? openDoubts : 0;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`student-bottomnav-item ${isActive ? 'is-active' : ''}`}
            aria-current={isActive ? 'page' : undefined}
          >
            <Icon size={21} weight={isActive ? 'fill' : 'regular'} />
            <span className="student-bottomnav-label">{item.label}</span>
            {count > 0 && (
              <span className="student-bottomnav-badge" aria-label={`${count} pending`}>
                {count > 9 ? '9+' : count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
