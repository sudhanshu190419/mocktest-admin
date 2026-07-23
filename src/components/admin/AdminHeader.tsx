'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { usePathname, useRouter } from 'next/navigation';
import {
  useUnreadNotifications,
  useMarkAsRead,
} from '@/hooks/notification/useNotifications';
import {
  notificationIcon,
  formatNotificationTime,
} from '@/utils/notification';

export function AdminHeader() {
  const { user, teacherProfile, isDemoMode, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const userId = user?.id;

  const [showNotifications, setShowNotifications] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data: unreadData, isLoading: notifLoading } = useUnreadNotifications(
    userId,
    { page: 1, pageSize: 5 },
  );

  const markAsRead = useMarkAsRead();

  const unreadNotifications = unreadData?.notifications ?? [];
  const unreadCount = unreadData?.unreadCount ?? 0;

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    await signOut();
    router.push('/');
  };

  // Build breadcrumb segments from the current path
  const segments = pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => ({
      label: segment
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase()),
      href: segment,
    }));

  return (
    <header className="flex h-14 items-center justify-between border-b border-gray-200 bg-white/80 px-6 backdrop-blur-sm dark:border-gray-800 dark:bg-gray-950/80">
      {/* Left: Breadcrumbs + Demo badge */}
      <div className="flex items-center gap-3">
        {isDemoMode && (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            Demo Mode
          </span>
        )}
        {segments.length > 0 && (
          <nav className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            {segments.map((seg, i) => (
              <span key={seg.label} className="flex items-center gap-1.5">
                {i > 0 && (
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                )}
                <span className={i === segments.length - 1 ? 'text-gray-900 dark:text-gray-100 font-medium' : ''}>
                  {seg.label}
                </span>
              </span>
            ))}
          </nav>
        )}
      </div>

      {/* Right: Notifications + Profile + Logout */}
      <div className="flex items-center gap-4">
        {/* Notification bell with dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
            title="Notifications"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
            </svg>
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white ring-2 ring-white dark:ring-gray-950">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 z-50 mt-2 w-80 rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-700">
                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Notifications
                </span>
                {unreadCount > 0 && (
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">
                    {unreadCount} new
                  </span>
                )}
              </div>

              {/* List */}
              <div className="max-h-80 overflow-y-auto">
                {notifLoading ? (
                  <div className="space-y-2 p-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
                    ))}
                  </div>
                ) : unreadNotifications.length === 0 ? (
                  <div className="flex flex-col items-center px-4 py-8 text-center">
                    <span className="text-2xl">🔔</span>
                    <p className="mt-2 text-xs font-medium text-gray-900 dark:text-gray-100">No new notifications</p>
                    <p className="mt-0.5 text-[10px] text-gray-400">You're all caught up!</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-gray-700">
                    {unreadNotifications.map((n) => (
                      <div
                        key={n.id}
                        className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/30 cursor-pointer"
                        onClick={() => {
                          markAsRead.mutate(n.id);
                          setShowNotifications(false);
                          router.push(`/admin/notifications/${n.id}`);
                        }}
                      >
                        <span className="mt-0.5 text-base">{notificationIcon(n.type)}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-gray-900 dark:text-gray-100">
                            {n.title}
                          </p>
                          <p className="mt-0.5 line-clamp-1 text-[10px] text-gray-500">
                            {n.message}
                          </p>
                          <p className="mt-0.5 text-[9px] text-gray-400">
                            {formatNotificationTime(n.receivedAt)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="border-t border-gray-100 px-4 py-2.5 dark:border-gray-700">
                <Link
                  href="/admin/notifications"
                  onClick={() => setShowNotifications(false)}
                  className="block text-center text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
                >
                  View all notifications
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* Profile info */}
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {teacherProfile?.name ?? 'Admin'}
            </p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {teacherProfile?.designation ?? 'Institute Admin'}
            </p>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            {teacherProfile?.name?.charAt(0) ?? 'A'}
          </div>
        </div>

        {/* Logout button */}
        <button
          type="button"
          onClick={handleLogout}
          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-600 dark:hover:bg-gray-800"
          title="Sign out"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
          </svg>
        </button>
      </div>
    </header>
  );
}
