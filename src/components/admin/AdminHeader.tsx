'use client';

import { useAuth } from '@/context/AuthContext';
import { usePathname, useRouter } from 'next/navigation';

export function AdminHeader() {
  const { teacherProfile, isDemoMode, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

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
        {/* Notification bell */}
        <button
          type="button"
          className="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
          title="Notifications"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
          </svg>
        </button>

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
