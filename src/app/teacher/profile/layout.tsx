'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const profileTabs = [
  { label: 'Profile', href: '/teacher/profile', icon: '👤' },
  { label: 'Activity', href: '/teacher/profile/activity', icon: '📋' },
  { label: 'Security', href: '/teacher/profile/security', icon: '🔒' },
  { label: 'Preferences', href: '/teacher/profile/preferences', icon: '⚙️' },
];

export default function ProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      {/* Sub-navigation tabs */}
      <div className="overflow-x-auto">
        <nav
          className="flex min-w-max gap-1 rounded-xl border border-gray-200 bg-white p-1.5 dark:border-gray-700 dark:bg-gray-900"
          role="tablist"
          aria-label="Profile sections"
        >
          {profileTabs.map((tab) => {
            const isActive = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                role="tab"
                aria-selected={isActive}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200',
                )}
              >
                <span className="text-xs">{tab.icon}</span>
                <span>{tab.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Page content */}
      <div>{children}</div>
    </div>
  );
}
