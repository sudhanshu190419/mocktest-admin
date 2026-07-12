'use client';

import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { getPostLoginDestination } from '@/lib/auth/routing';
import FacultyDashboard from '@/components/dashboard/FacultyDashboard';
import { CircleNotch } from '@phosphor-icons/react';

/**
 * Home page — root redirector.
 *
 * After auth initialises, redirects the user to the correct destination
 * based on their role and account_status.  While loading a minimal splash
 * is shown to prevent a flash of the wrong content.
 *
 * Once redirected, the target page (e.g. /teacher, /admin, /pending-approval)
 * is the stable entry point for that role/status combination.
 */
export default function Home() {
  const { teacherProfile, loading } = useAuth();
  const router = useRouter();
  const [redirected, setRedirected] = React.useState(false);

  React.useEffect(() => {
    // Wait for auth to finish loading
    if (loading || redirected) return;

    if (teacherProfile) {
      const destination = getPostLoginDestination(
        teacherProfile.role,
        teacherProfile.accountStatus,
      );

      // Only redirect if the destination is different from current path
      if (destination !== '/') {
        setRedirected(true);
        router.replace(destination);
      }
    }
    // If no teacherProfile (not logged in), FacultyDashboard handles login UI
  }, [teacherProfile, loading, router, redirected]);

  // Show loading splash while auth or redirect is pending
  if (loading || redirected) {
    return (
      <div className="min-h-screen w-full bg-gradient-to-br from-slate-900 via-navy-900 to-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <CircleNotch size={32} className="animate-spin text-amber-400" />
          <p className="text-sm text-slate-400 font-mono">
            {loading ? 'Verifying credentials...' : 'Redirecting...'}
          </p>
        </div>
      </div>
    );
  }

  // No authenticated profile — render the login / landing view
  // (FacultyDashboard handles the full login + registration UI flow)
  return <FacultyDashboard />;
}
