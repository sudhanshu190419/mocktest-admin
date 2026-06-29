import type { ReactNode } from 'react';
import DevSidebar from '@/components/dev/DevSidebar';
import DevHeader from '@/components/dev/DevHeader';

export const metadata = {
  title: 'Dev Console — MockTest Admin',
  description: 'Internal developer console for backend testing and QA',
};

/**
 * Developer Console Layout
 *
 * Provides the dev-only sidebar, header, and a prominent warning banner
 * indicating this is NOT the production admin portal.
 *
 * The entire /dev tree can be safely deleted without affecting any
 * production code or business logic.
 */
export default function DevLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* ── Warning Banner ─────────────────────────────────────────────── */}
      <div className="bg-amber-900/30 border-b border-amber-700/50 px-6 py-2">
        <div className="flex items-center justify-center gap-3">
          <span className="text-lg">⚠️</span>
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-wider text-amber-400">
              Developer Console — Internal Backend Testing Only
            </p>
            <p className="text-[10px] text-amber-600/80">
              Not Production UI · Safe to Delete
            </p>
          </div>
          <span className="text-lg">⚠️</span>
        </div>
      </div>

      {/* ── Body: Sidebar + Content ─────────────────────────────────────── */}
      <div className="flex flex-1">
        <DevSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <DevHeader />
          <main className="flex-1 p-6 overflow-y-auto">{children}</main>
        </div>
      </div>
    </div>
  );
}
