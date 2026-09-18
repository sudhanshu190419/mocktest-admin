'use client';

import React, { useState } from 'react';
import RoleGuard from '@/components/auth/RoleGuard';
import { StudentSidebar } from '@/components/student/StudentSidebar';
import { StudentHeader } from '@/components/student/StudentHeader';

export default function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <RoleGuard
      allowedRoles={['student', 'user', 'admin']}
      allowedAccountStatuses={['approved']}
    >
      <div className="flex h-screen overflow-hidden bg-[#F0F9FF]">
        {/* Desktop Fixed Sidebar */}
        <div className="hidden lg:flex w-64 flex-shrink-0">
          <StudentSidebar />
        </div>

        {/* Mobile Backdrop & Drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div
              className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity"
              onClick={() => setMobileMenuOpen(false)}
            />
            <div className="fixed inset-y-0 left-0 w-72 max-w-full bg-white shadow-2xl z-50 animate-slideRight">
              <StudentSidebar onCloseMobile={() => setMobileMenuOpen(false)} />
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <StudentHeader onToggleMobile={() => setMobileMenuOpen(true)} />
          <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-[#F0F9FF]">
            <div className="max-w-7xl mx-auto w-full">
              {children}
            </div>
          </main>
        </div>
      </div>
    </RoleGuard>
  );
}
