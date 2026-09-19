'use client';

import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { getPostLoginDestination } from '@/lib/auth/routing';
import { LoginView } from '@/views/LoginView';
import { CircleNotch } from '@phosphor-icons/react';

export function StaffLoginClient() {
  const { teacherProfile, loading } = useAuth();
  const router = useRouter();
  const [redirected, setRedirected] = React.useState(false);

  React.useEffect(() => {
    if (loading || redirected) return;

    if (teacherProfile) {
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

  if (loading || redirected) {
    return (
      <div className="min-h-screen w-full bg-navy-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <CircleNotch size={36} className="animate-spin text-amber-400" />
          <p className="text-sm font-mono tracking-widest uppercase text-blue-200">
            Authorizing session...
          </p>
        </div>
      </div>
    );
  }

  return <LoginView />;
}
