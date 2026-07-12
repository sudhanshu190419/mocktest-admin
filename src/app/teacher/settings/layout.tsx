'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';

const settingsTabs = [
  { label: 'General', href: '/teacher/settings', icon: '⚙️' },
  { label: 'Appearance', href: '/teacher/settings?tab=appearance', icon: '🎨' },
  { label: 'Privacy', href: '/teacher/settings?tab=privacy', icon: '🔐' },
  { label: 'Advanced', href: '/teacher/settings?tab=advanced', icon: '🛠️' },
];

function SettingsNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentTab = searchParams.get('tab');

  return (
    <nav
      className="flex min-w-max gap-1 rounded-xl border border-gray-200 bg-white p-1.5 dark:border-gray-700 dark:bg-gray-900"
      role="tablist"
      aria-label="Settings sections"
    >
      {settingsTabs.map((tab) => {
        const tabParam = tab.href.match(/tab=(\w+)/)?.[1];
        const isActive = tabParam
          ? currentTab === tabParam
          : !currentTab && pathname === tab.href;

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
  );
}

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      {/* Sub-navigation tabs (wrapped in Suspense for useSearchParams) */}
      <div className="overflow-x-auto">
        <Suspense
          fallback={
            <div className="flex min-w-max gap-1 rounded-xl border border-gray-200 bg-white p-1.5 dark:border-gray-700 dark:bg-gray-900">
              {settingsTabs.map((tab) => (
                <div
                  key={tab.href}
                  className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-gray-400"
                >
                  <span className="text-xs">{tab.icon}</span>
                  <span>{tab.label}</span>
                </div>
              ))}
            </div>
          }
        >
          <SettingsNav />
        </Suspense>
      </div>

      {/* Page content (wrapped in Suspense because page uses useSearchParams) */}
      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />}>
        <div>{children}</div>
      </Suspense>
    </div>
  );
}
