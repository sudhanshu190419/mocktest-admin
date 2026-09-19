'use client';

import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { getPostLoginDestination } from '@/lib/auth/routing';
import { MarketingHomeView } from '@/components/marketing/MarketingHomeView';
import { CircleNotch } from '@phosphor-icons/react';

/**
 * Home page — multi-state root:
 * - Unauthenticated visitors see the public marketing storefront.
 * - Logged-in students see the student home variation (hero + personalized workspace & catalog).
 * - Admin and Teacher roles are redirected to their management portals.
 */
export default function Home() {
  const { teacherProfile, loading } = useAuth();
  const router = useRouter();
  const [redirected, setRedirected] = React.useState(false);

  React.useEffect(() => {
    if (loading || redirected) return;

    // Only redirect admin and teacher users to their backend management dashboards
    if (teacherProfile && (teacherProfile.role === 'admin' || teacherProfile.role === 'teacher')) {
      const destination = getPostLoginDestination(
        teacherProfile.role,
        teacherProfile.accountStatus,
      );

      if (destination !== '/') {
        setRedirected(true);
        router.replace(destination);
      }
    }
  }, [teacherProfile, loading, router, redirected]);

  if (redirected && teacherProfile && (teacherProfile.role === 'admin' || teacherProfile.role === 'teacher')) {
    return (
      <div className="min-h-screen w-full bg-[#f3f8fc] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <CircleNotch size={28} className="animate-spin text-blue-600" />
          <p className="text-xs font-semibold text-slate-500 font-display">
            Redirecting to management portal...
          </p>
        </div>
      </div>
    );
  }

  return <MarketingHomeView />;
}

