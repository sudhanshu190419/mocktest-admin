'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import {
  List,
  MagnifyingGlass,
  Bell,
  User,
  CaretDown,
  SignOut,
  Sparkle,
  Gear,
  Receipt,
  BookOpen
} from '@phosphor-icons/react';
import { useAuth } from '@/context/AuthContext';
import { StudentNotificationCenter } from './StudentNotificationCenter';
import { fetchStudentUnreadNotificationCount } from '@/services/student/studentNotificationWebService';

interface StudentHeaderProps {
  onToggleMobile?: () => void;
  unreadCount?: number;
  streamName?: string;
}

export const StudentHeader: React.FC<StudentHeaderProps> = ({
  onToggleMobile,
  unreadCount: initialUnreadCount = 0,
  streamName = 'Target: NEET / JEE 2026',
}) => {
  const { teacherProfile, user, signOut } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
  const [liveUnreadCount, setLiveUnreadCount] = useState(initialUnreadCount);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const notificationContainerRef = useRef<HTMLDivElement>(null);

  const studentName = teacherProfile?.name || user?.email?.split('@')[0] || 'Student';
  const studentInitials = studentName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();

  // Load initial unread count on mount if not provided via props
  useEffect(() => {
    let mounted = true;
    async function loadCount() {
      const count = await fetchStudentUnreadNotificationCount();
      if (mounted) {
        setLiveUnreadCount(count);
      }
    }
    loadCount();
    return () => {
      mounted = false;
    };
  }, []);

  // Synchronize when prop changes
  useEffect(() => {
    if (initialUnreadCount !== undefined) {
      setLiveUnreadCount(initialUnreadCount);
    }
  }, [initialUnreadCount]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-sky-100 bg-white/90 px-4 sm:px-6 backdrop-blur-md">
      {/* Left: Mobile Toggle & Search */}
      <div className="flex items-center gap-3 sm:gap-4 flex-1 max-w-xl">
        {onToggleMobile && (
          <button
            onClick={onToggleMobile}
            className="lg:hidden p-2 rounded-xl text-slate-600 hover:bg-slate-100 transition-colors"
            aria-label="Toggle navigation"
          >
            <List size={22} weight="bold" />
          </button>
        )}

        <div className="relative w-full hidden sm:block">
          <MagnifyingGlass size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search study material, video lectures, mock tests..."
            className="w-full rounded-2xl bg-slate-50 pl-10 pr-4 py-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 border border-slate-200/80 outline-none focus:border-sky-500 focus:bg-white transition-all font-sans"
          />
        </div>
      </div>

      {/* Right: Target Stream Pill + Notifications + Profile Avatar Dropdown */}
      <div className="flex items-center gap-3 sm:gap-4">
        {/* Stream Badge */}
        <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-sky-50 border border-sky-200/70 text-sky-800 text-xs font-bold">
          <Sparkle size={14} weight="fill" className="text-sky-600" />
          <span>{streamName}</span>
        </div>

        {/* Notification Bell & Notification Center Popover */}
        <div className="relative" ref={notificationContainerRef}>
          <button
            type="button"
            onClick={() => setNotificationCenterOpen(!notificationCenterOpen)}
            aria-label={`Notifications${liveUnreadCount > 0 ? `, ${liveUnreadCount} unread` : ''}`}
            aria-expanded={notificationCenterOpen}
            aria-haspopup="dialog"
            className={`relative p-2 rounded-xl transition-colors ${
              notificationCenterOpen
                ? 'bg-sky-50 text-sky-700'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
            title="Notifications"
          >
            <Bell size={20} weight={notificationCenterOpen ? 'fill' : 'duotone'} />
            {liveUnreadCount > 0 && (
              <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-black text-white ring-2 ring-white">
                {liveUnreadCount > 9 ? '9+' : liveUnreadCount}
              </span>
            )}
          </button>

          {/* Popover */}
          <StudentNotificationCenter
            isOpen={notificationCenterOpen}
            onClose={() => setNotificationCenterOpen(false)}
            unreadCount={liveUnreadCount}
            onUnreadCountChange={setLiveUnreadCount}
          />
        </div>

        {/* Profile Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-2.5 p-1.5 rounded-2xl hover:bg-slate-50 transition-colors"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-600 to-indigo-700 text-xs font-bold text-white shadow-sm">
              {studentInitials}
            </div>
            <div className="hidden sm:block text-left">
              <span className="block text-xs font-bold text-slate-900 leading-tight">
                {studentName}
              </span>
              <span className="block text-[10px] font-semibold text-slate-500 capitalize">
                Student Account
              </span>
            </div>
            <CaretDown size={14} className="text-slate-400" />
          </button>

          {/* Dropdown Menu */}
          {dropdownOpen && (
            <div className="absolute right-0 top-12 z-50 w-56 rounded-2xl bg-white p-1.5 border border-slate-200/90 shadow-xl shadow-slate-900/10 animate-fadeIn">
              <div className="p-2.5 border-b border-slate-100 mb-1">
                <p className="text-xs font-bold text-slate-900 leading-tight">{studentName}</p>
                <p className="text-[11px] text-slate-500 truncate">{user?.email}</p>
              </div>

              <div className="space-y-0.5">
                <Link
                  href="/student/profile"
                  onClick={() => setDropdownOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-slate-700 rounded-xl hover:bg-sky-50 hover:text-sky-700 transition-colors"
                >
                  <User size={16} />
                  <span>My Profile</span>
                </Link>

                <Link
                  href="/student/courses"
                  onClick={() => setDropdownOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-slate-700 rounded-xl hover:bg-sky-50 hover:text-sky-700 transition-colors"
                >
                  <BookOpen size={16} />
                  <span>Enrolled Courses</span>
                </Link>
              </div>

              <div className="pt-1 mt-1 border-t border-slate-100">
                <button
                  onClick={() => {
                    setDropdownOpen(false);
                    signOut();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-rose-600 rounded-xl hover:bg-rose-50 transition-colors"
                >
                  <SignOut size={16} />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
