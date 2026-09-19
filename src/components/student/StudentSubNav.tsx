'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  SquaresFour,
  BookOpen,
  VideoCamera,
  FilmSlate,
  Exam,
  Trophy,
  CalendarBlank,
  ChatCircleDots,
  ChartLineUp,
  User,
} from '@phosphor-icons/react';

interface SubNavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  isExact?: boolean;
}

const navItems: SubNavItem[] = [
  { label: 'Overview', href: '/student/overview', icon: SquaresFour, isExact: true },
  { label: 'My Courses', href: '/student/courses', icon: BookOpen },
  { label: 'Live Classes', href: '/student/classes', icon: VideoCamera },
  { label: 'Recordings', href: '/student/recordings', icon: FilmSlate },
  { label: 'Mock Tests', href: '/student/tests', icon: Exam },
  { label: 'Results', href: '/student/results', icon: Trophy },
  { label: 'Timetable', href: '/student/timetable', icon: CalendarBlank },
  { label: 'My Doubts', href: '/student/doubts', icon: ChatCircleDots },
  { label: 'Analytics', href: '/student/analytics', icon: ChartLineUp },
  { label: 'Profile', href: '/student/profile', icon: User },
];

export function StudentSubNav() {
  const pathname = usePathname();

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
          {navItems.map((item) => {
            const isActive = item.isExact
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`student-subnav-pill ${isActive ? 'is-active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon size={16} weight={isActive ? 'fill' : 'bold'} className="student-subnav-icon" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
