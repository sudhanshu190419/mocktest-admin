'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  List,
  MagnifyingGlass,
  Bell,
  User,
  CaretDown,
  SignOut,
  Sparkle,
  BookOpen,
  House,
  GraduationCap,
  SidebarSimple
} from '@phosphor-icons/react';
import { useAuth } from '@/context/AuthContext';
import { StudentNotificationCenter } from './StudentNotificationCenter';
import { fetchStudentUnreadNotificationCount } from '@/services/student/studentNotificationWebService';

interface StudentHeaderProps {
  onToggleMobile?: () => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  unreadCount?: number;
  streamName?: string;
}

export const StudentHeader: React.FC<StudentHeaderProps> = ({
  onToggleMobile,
  isSidebarCollapsed = false,
  onToggleSidebar,
  unreadCount: initialUnreadCount = 0,
  streamName = 'Target: NEET / JEE 2026',
}) => {
  const pathname = usePathname();
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
      const count = await fetchStudentUnreadNotificationCount(user?.id);
      if (mounted) {
        setLiveUnreadCount(count);
      }
    }
    loadCount();
    return () => {
      mounted = false;
    };
  }, [user?.id]);

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

  const navLinks = [
    { label: 'Home', href: '/' },
    { label: 'Courses', href: '/courses' },
    { label: 'PYQ Papers', href: '/pyq' },
    { label: 'My Courses', href: '/student/courses' },
  ];

  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-line/80 bg-white/95 px-4 sm:px-6 backdrop-blur-md">
      {/* Left: Mobile Toggle, Desktop Sidebar Toggle, Mobile Brand, & Primary Top Nav */}
      <div className="flex items-center gap-3 lg:gap-4">
        {onToggleMobile && (
          <button
            onClick={onToggleMobile}
            className="lg:hidden p-2 rounded-field text-ink-secondary hover:bg-paper transition-colors"
            aria-label="Toggle navigation"
          >
            <List size={22} weight="bold" />
          </button>
        )}

        {/* Desktop Sidebar Toggle */}
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className="hidden lg:flex items-center justify-center p-2 rounded-field text-ink-secondary hover:text-ink hover:bg-paper transition-colors"
            title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <SidebarSimple size={20} weight={isSidebarCollapsed ? 'bold' : 'regular'} />
          </button>
        )}

        {/* Mobile Brand Mark (shown when sidebar is hidden) */}
        <Link href="/" className="lg:hidden flex items-center">
          <Image
            src="/brand/logo-primary-horizontal.svg"
            alt="Make Me Topper"
            width={145}
            height={34}
            className="h-7 w-auto object-contain"
            priority
          />
        </Link>

        {/* Primary Desktop Top Nav */}
        <nav className="hidden md:flex items-center gap-1 font-body">
          {navLinks.map((link) => {
            const isActive =
              link.href === '/'
                ? pathname === '/'
                : pathname === link.href || pathname.startsWith(`${link.href}/`);

            return (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-sky-tint text-brand-hover font-bold shadow-xs'
                    : 'text-ink-secondary hover:text-ink hover:bg-paper/70'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Right: Target Stream Pill + Notifications + Profile Avatar Dropdown */}
      <div className="flex items-center gap-3 sm:gap-4">
        {/* Stream Badge */}
        <div className="hidden xl:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-sky-tint/80 border border-line/60 text-brand-hover text-xs font-bold font-body">
          <Sparkle size={14} weight="fill" className="text-brand" />
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
            className={`relative p-2 rounded-field transition-colors ${
              notificationCenterOpen
                ? 'bg-sky-tint text-brand-hover'
                : 'text-ink-secondary hover:bg-paper hover:text-ink'
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
            className="flex items-center gap-2.5 p-1 rounded-card hover:bg-paper/70 transition-colors"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-field bg-gradient-to-br bg-brand bg-brand-hover text-xs font-bold text-white shadow-xs font-display">
              {studentInitials}
            </div>
            <div className="hidden sm:block text-left">
              <span className="block text-xs font-bold text-ink leading-tight font-display">
                {studentName}
              </span>
              <span className="block text-caption font-medium text-ink-secondary capitalize">
                Student Account
              </span>
            </div>
            <CaretDown size={14} className="text-ink-muted" />
          </button>

          {/* Dropdown Menu */}
          {dropdownOpen && (
            <div className="absolute right-0 top-12 z-50 w-56 rounded-card bg-white p-1.5 border border-line shadow-xl shadow-card animate-fadeIn font-body">
              <div className="p-2.5 border-b border-line mb-1">
                <p className="text-xs font-bold text-ink leading-tight font-display">{studentName}</p>
                <p className="text-caption text-ink-secondary truncate">{user?.email}</p>
              </div>

              <div className="space-y-0.5">
                <Link
                  href="/student/profile"
                  onClick={() => setDropdownOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-ink rounded-field hover:bg-sky-tint hover:text-brand-hover transition-colors"
                >
                  <User size={16} />
                  <span>My Profile</span>
                </Link>

                <Link
                  href="/student/courses"
                  onClick={() => setDropdownOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-ink rounded-field hover:bg-sky-tint hover:text-brand-hover transition-colors"
                >
                  <BookOpen size={16} />
                  <span>Enrolled Courses</span>
                </Link>

                <Link
                  href="/courses"
                  onClick={() => setDropdownOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-ink rounded-field hover:bg-sky-tint hover:text-brand-hover transition-colors"
                >
                  <Sparkle size={16} />
                  <span>Explore Courses ↗</span>
                </Link>

                <Link
                  href="/pyq"
                  onClick={() => setDropdownOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-ink rounded-field hover:bg-sky-tint hover:text-brand-hover transition-colors"
                >
                  <GraduationCap size={16} />
                  <span>PYQ Store ↗</span>
                </Link>
              </div>

              <div className="pt-1 mt-1 border-t border-line">
                <button
                  onClick={async () => {
                    setDropdownOpen(false);
                    await signOut();
                    window.location.href = '/';
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-rose-600 rounded-field hover:bg-rose-50 transition-colors"
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
