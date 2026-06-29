'use client';

import { usePathname } from 'next/navigation';

/**
 * Converts a path like /dev/academic/streams into breadcrumb segments.
 */
function buildBreadcrumbs(pathname: string): { label: string; href: string }[] {
  const segments = pathname.split('/').filter(Boolean);
  const crumbs: { label: string; href: string }[] = [];

  // Root
  crumbs.push({ label: 'Dev', href: '/dev' });

  let path = '';
  for (let i = 1; i < segments.length; i++) {
    path += `/${segments[i]}`;
    crumbs.push({
      label: segments[i].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      href: `/dev${path}`,
    });
  }

  return crumbs;
}

export default function DevHeader() {
  const pathname = usePathname();
  const breadcrumbs = buildBreadcrumbs(pathname);

  return (
    <header className="border-b border-gray-700 bg-gray-900/50 px-6 py-2.5">
      <div className="flex items-center justify-between">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-xs text-gray-400">
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb.href} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-gray-600">/</span>}
              <span className="hover:text-gray-200 transition-colors">{crumb.label}</span>
            </span>
          ))}
        </nav>

        {/* Status */}
        <div className="flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-wider text-gray-500 px-2 py-0.5 rounded border border-gray-700 bg-gray-800">
            Dev Mode
          </span>
        </div>
      </div>
    </header>
  );
}
