'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
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
  SignOut,
  Sparkle,
  Question,
  X,
  CaretLeft,
  CaretRight,
  SidebarSimple
} from '@phosphor-icons/react';
import { useAuth } from '@/context/AuthContext';

interface StudentSidebarProps {
  onCloseMobile?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const StudentSidebar: React.FC<StudentSidebarProps> = ({
  onCloseMobile,
  isCollapsed = false,
  onToggleCollapse,
}) => {
  const pathname = usePathname();
  const { signOut } = useAuth();

  const navItems = [
    { label: 'Dashboard', href: '/student/overview', icon: SquaresFour },
    { label: 'My Courses', href: '/student/courses', icon: BookOpen },
    { label: 'Live Classes', href: '/student/classes', icon: VideoCamera, badge: 'Live' },
    { label: 'Recorded Classes', href: '/student/recordings', icon: FilmSlate },
    { label: 'Mock Tests', href: '/student/tests', icon: Exam },
    { label: 'My Test Results', href: '/student/results', icon: Trophy },
    { label: 'Timetable', href: '/student/timetable', icon: CalendarBlank },
    { label: 'My Doubts', href: '/student/doubts', icon: ChatCircleDots },
    { label: 'Analytics', href: '/student/analytics', icon: ChartLineUp },
    { label: 'Profile & Account', href: '/student/profile', icon: User },
  ];

  return (
    <aside
      className={`flex h-full w-full flex-col justify-between bg-white border-r border-line/80 select-none font-body transition-all duration-300 ${
        isCollapsed ? 'px-2 py-4 items-center' : 'p-4'
      }`}
    >
      <div className="w-full">
        {/* Brand Header */}
        <div
          className={`flex items-center mb-4 border-b border-line ${
            isCollapsed
              ? 'justify-center pb-3'
              : 'justify-between px-2 py-3'
          }`}
        >
          {isCollapsed ? (
            <Link
              href="/student/overview"
              className="flex h-9 w-9 items-center justify-center rounded-field bg-slate-50 hover:bg-slate-100 p-1 transition-all hover:scale-105 shadow-sm"
              title="Make Me Topper — Student Studio"
            >
              <Image
                src="/brand/logo-submark.svg"
                alt="Make Me Topper"
                width={28}
                height={28}
                className="h-7 w-auto object-contain"
              />
            </Link>
          ) : (
            <Link href="/student/overview" className="flex items-center gap-2.5 group">
              <Image
                src="/brand/logo-submark.svg"
                alt="Make Me Topper"
                width={36}
                height={36}
                className="h-9 w-auto object-contain group-hover:scale-105 transition-transform"
              />
              <div>
                <span className="text-[15px] font-black tracking-tight text-ink font-display block leading-tight">
                  MAKE ME TOPPER
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-ink-secondary flex items-center gap-1">
                  <Sparkle size={10} weight="fill" className="text-brand" /> Student Studio
                </span>
              </div>
            </Link>
          )}

          {/* Mobile close button */}
          {onCloseMobile && (
            <button
              onClick={onCloseMobile}
              className="lg:hidden p-1.5 rounded-field text-ink-muted hover:text-ink hover:bg-paper"
              aria-label="Close menu"
            >
              <X size={18} />
            </button>
          )}

          {/* Desktop collapse toggle button in expanded header */}
          {!isCollapsed && onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              className="hidden lg:flex p-1.5 rounded-lg text-ink-muted hover:text-ink hover:bg-paper transition-colors"
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
            >
              <CaretLeft size={16} weight="bold" />
            </button>
          )}
        </div>

        {/* Navigation List */}
        <nav className="space-y-1 w-full">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== '/student/overview' && pathname.startsWith(item.href));
            const IconComponent = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onCloseMobile}
                title={isCollapsed ? item.label : undefined}
                className={`relative flex items-center rounded-field text-xs transition-all duration-200 ${
                  isCollapsed
                    ? 'justify-center p-2.5 mx-auto'
                    : 'justify-between px-3.5 py-2.5'
                } ${
                  isActive
                    ? 'bg-sky-tint/90 text-brand-hover font-bold shadow-xs'
                    : 'text-ink-secondary hover:bg-paper hover:text-ink font-medium'
                }`}
              >
                <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'}`}>
                  <IconComponent
                    size={isCollapsed ? 20 : 18}
                    weight={isActive ? 'fill' : 'regular'}
                    className={isActive ? 'text-brand' : 'text-ink-muted'}
                  />
                  {!isCollapsed && <span>{item.label}</span>}
                </div>

                {/* Badge */}
                {item.badge && (
                  isCollapsed ? (
                    <span
                      className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-emerald-500"
                      title={item.badge}
                    />
                  ) : (
                    <span className="px-2 py-0.5 text-caption font-extrabold uppercase tracking-wider rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200/60">
                      {item.badge}
                    </span>
                  )
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Sidebar Footer */}
      <div className={`space-y-2 pt-3 border-t border-line w-full ${isCollapsed ? 'flex flex-col items-center' : ''}`}>
        {/* Assistance Help Card */}
        {isCollapsed ? (
          <Link
            href="/student/doubts"
            className="flex h-10 w-10 items-center justify-center rounded-field text-brand bg-sky-tint hover:bg-sky-tint transition-colors"
            title="Need Assistance? Ask a Doubt"
          >
            <Question size={20} weight="duotone" />
          </Link>
        ) : (
          <div className="p-3.5 rounded-card bg-gradient-to-br bg-sky-tint/70 bg-paper border border-line/80">
            <div className="flex items-center gap-2 text-brand-hover font-bold text-xs mb-1 font-display">
              <Question size={16} weight="duotone" className="text-brand" />
              <span>Need Assistance?</span>
            </div>
            <p className="text-caption text-ink-secondary leading-relaxed mb-2.5">
              Ask faculty doubts or contact student support 24/7.
            </p>
            <Link
              href="/student/doubts"
              className="inline-flex items-center gap-1.5 text-caption font-bold text-brand hover:text-brand-hover"
            >
              <span>Ask a Doubt</span>
              <span>&rarr;</span>
            </Link>
          </div>
        )}

        {/* Expand Toggle Button in Collapsed Mode */}
        {isCollapsed && onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="flex h-10 w-10 items-center justify-center rounded-field text-ink-secondary hover:bg-paper hover:text-ink transition-colors"
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <CaretRight size={18} weight="bold" />
          </button>
        )}

        {/* Quick Sign Out Action */}
        <button
          onClick={async () => {
            await signOut();
            window.location.href = '/';
          }}
          title={isCollapsed ? 'Sign Out' : undefined}
          className={`flex items-center rounded-field text-xs font-semibold text-ink-secondary hover:bg-rose-50 hover:text-rose-600 transition-colors ${
            isCollapsed
              ? 'h-10 w-10 justify-center'
              : 'w-full gap-2 px-3 py-2'
          }`}
        >
          <SignOut size={18} />
          {!isCollapsed && <span>Sign Out</span>}
        </button>
      </div>
    </aside>
  );
};
