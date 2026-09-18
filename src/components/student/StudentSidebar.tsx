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
  SignOut,
  GraduationCap,
  Sparkle,
  Question,
  X
} from '@phosphor-icons/react';
import { useAuth } from '@/context/AuthContext';

interface StudentSidebarProps {
  onCloseMobile?: () => void;
}

export const StudentSidebar: React.FC<StudentSidebarProps> = ({ onCloseMobile }) => {
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
    <aside className="flex h-full w-full flex-col justify-between bg-white border-r border-sky-100/80 p-4 select-none">
      <div>
        {/* Brand Header */}
        <div className="flex items-center justify-between px-3 py-3 mb-4">
          <Link href="/student/overview" className="flex items-center gap-3 group">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-sky-600 text-white shadow-md shadow-sky-500/20 group-hover:scale-105 transition-transform">
              <GraduationCap size={22} weight="duotone" />
            </div>
            <div>
              <span className="text-base font-extrabold tracking-tight text-slate-900 font-sans block leading-tight">
                MockPrep
              </span>
              <span className="text-[11px] font-bold uppercase tracking-wider text-sky-600 flex items-center gap-1">
                <Sparkle size={10} weight="fill" /> Student Portal
              </span>
            </div>
          </Link>
          {onCloseMobile && (
            <button
              onClick={onCloseMobile}
              className="lg:hidden p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Navigation List */}
        <nav className="space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/student/overview' && pathname.startsWith(item.href));
            const IconComponent = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onCloseMobile}
                className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 ${
                  isActive
                    ? 'bg-sky-50 text-sky-700 font-bold shadow-sm shadow-sky-500/5'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <div className="flex items-center gap-3">
                  <IconComponent
                    size={19}
                    weight={isActive ? 'fill' : 'regular'}
                    className={isActive ? 'text-sky-600' : 'text-slate-400'}
                  />
                  <span>{item.label}</span>
                </div>

                {item.badge && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500 text-white animate-pulse">
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Footer Support Card & Sign Out */}
      <div className="space-y-3 pt-4 border-t border-slate-100">
        <div className="p-3.5 rounded-2xl bg-gradient-to-br from-sky-50/80 to-blue-50/50 border border-sky-100/60">
          <div className="flex items-center gap-2 text-sky-800 text-xs font-bold mb-1">
            <Question size={16} weight="duotone" className="text-sky-600" />
            <span>Need Assistance?</span>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed mb-2">
            Ask faculty doubts or contact student support 24/7.
          </p>
          <Link
            href="/student/doubts"
            className="inline-block text-[11px] font-bold text-sky-700 hover:text-sky-800 hover:underline"
          >
            Ask a Doubt &rarr;
          </Link>
        </div>

        <button
          type="button"
          onClick={() => signOut()}
          className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors"
        >
          <SignOut size={18} />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
};
