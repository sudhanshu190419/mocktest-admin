'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { label: 'Authentication', href: '/dev/authentication', icon: '🔐' },
  { label: 'Academic', href: '/dev/academic', icon: '📚' },
  { label: 'Content', href: '/dev/content', icon: '📄' },
  { label: 'Storage', href: '/dev/storage', icon: '💾' },
  { label: 'Question Bank', href: '/dev/question-bank', icon: '❓' },
  { label: 'Mock Tests', href: '/dev/mock-tests', icon: '📝' },
  { label: 'Attempts', href: '/dev/attempts', icon: '🔄' },
  { label: 'Results', href: '/dev/results', icon: '📊' },
  { label: 'Analytics', href: '/dev/analytics', icon: '📈' },
  { label: 'Notifications', href: '/dev/notifications', icon: '🔔' },
  { label: 'Settings', href: '/dev/settings', icon: '⚙️' },
];

export default function DevSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 shrink-0 border-r border-gray-700 bg-gray-900 flex flex-col">
      {/* Sidebar header */}
      <div className="px-4 py-3 border-b border-gray-700">
        <Link href="/dev" className="flex items-center gap-2">
          <span className="text-lg">🛠️</span>
          <span className="font-semibold text-gray-100 text-sm">Dev Console</span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2">
        <ul className="space-y-0.5 px-2">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-2.5 rounded px-3 py-2 text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-300 hover:bg-gray-800 hover:text-gray-100'
                  }`}
                >
                  <span className="text-sm">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-gray-700 space-y-1">
        <div className="text-[10px] uppercase tracking-wider text-gray-500">Environment</div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
          <span className="text-xs text-gray-400">Development</span>
        </div>
        <div className="text-[10px] text-gray-600">v0.1.0-dev</div>
      </div>
    </aside>
  );
}
