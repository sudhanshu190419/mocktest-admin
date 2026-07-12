'use client';

import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';

export function TeacherHeader() {
  const { teacherProfile, isDemoMode, signOut } = useAuth();

  return (
    <header className="flex h-14 items-center justify-between border-b border-gray-200 bg-white/80 px-6 backdrop-blur-sm dark:border-gray-800 dark:bg-gray-950/80">
      <div className="flex items-center gap-3">
        {isDemoMode && (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            Demo Mode
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          className="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
          </svg>
        </button>

        {/* User info */}
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {teacherProfile?.name ?? 'Teacher'}
            </p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {teacherProfile?.designation ?? ''}
            </p>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
            {teacherProfile?.name?.charAt(0) ?? 'T'}
          </div>
        </div>
      </div>
    </header>
  );
}
