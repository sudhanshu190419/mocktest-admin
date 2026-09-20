'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  SquaresFour,
  BookOpen,
  VideoCamera,
  Exam,
  ChatCircleDots,
} from '@phosphor-icons/react';
import { useNavBadgeCounts } from '@/hooks/student/useNavBadgeCounts';

/**
 * PRD §4.1 — section nav (desktop ≥1024px).
 * Primary 5 only: Today · Courses · Classes · Tests · Doubts.
 * Secondary destinations (Recordings · Timetable · Results · Analytics ·
 * Profile) live in the header avatar menu. Badge counts (apricot, C6) on
 * Tests (due this week) and Doubts (open + in progress).
 * Hidden entirely below 1024px — the mobile bottom bar takes over.
 */

interface SubNavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  isExact?: boolean;
  badge?: 'tests' | 'doubts';
}

const primaryNavItems: SubNavItem[] = [
  { label: 'Today', href: '/student/overview', icon: SquaresFour, isExact: true },
  { label: 'My Courses', href: '/student/courses', icon: BookOpen },
  { label: 'Live Classes', href: '/student/classes', icon: VideoCamera },
  { label: 'Mock Tests', href: '/student/tests', icon: Exam, badge: 'tests' },
  { label: 'My Doubts', href: '/student/doubts', icon: ChatCircleDots, badge: 'doubts' },
];

export function StudentSubNav() {
  const pathname = usePathname();
  const { testsDue, openDoubts } = useNavBadgeCounts();

  // Do not render sub-nav in distraction-free immersive test runner or active live room
  if (
    pathname.includes('/runner') ||
    pathname.match(/\/student\/classes\/[^/]+$/)
  ) {
    return null;
  }

  return (
    <nav className="student-subnav-wrapper" aria-label="Student sections navigation">
      <div className="store-container">
        <div className="student-subnav-inner">
          {primaryNavItems.map((item) => {
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
                className={`student-subnav-pill ${isActive ? 'is-active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon size={16} weight={isActive ? 'fill' : 'bold'} className="student-subnav-icon" />
                <span>{item.label}</span>
                {count > 0 && (
                  <span className="student-subnav-badge" aria-label={`${count} pending`}>
                    {count > 9 ? '9+' : count}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
