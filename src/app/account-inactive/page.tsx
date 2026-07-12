'use client';

import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { Power, SignOut, ShieldCheck } from '@phosphor-icons/react';

export default function AccountInactivePage() {
  const { signOut } = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    await signOut();
    router.push('/');
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md mx-auto">
        {/* Card */}
        <div className="rounded-3xl bg-white shadow-2xl border border-slate-100 overflow-hidden">
          {/* Illustration area */}
          <div className="h-48 bg-gradient-to-br from-slate-50 via-slate-100/50 to-gray-50 flex items-center justify-center relative overflow-hidden">
            <div className="absolute inset-0 opacity-10">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 rounded-full bg-slate-400 blur-[80px]" />
            </div>
            <div className="relative flex flex-col items-center gap-2">
              <div className="w-20 h-20 rounded-full bg-slate-100 border-4 border-slate-200 flex items-center justify-center">
                <Power size={36} weight="duotone" className="text-slate-500" />
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="p-8 pt-6 text-center space-y-4">
            {/* Badge */}
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-50 border border-slate-200/60">
              <ShieldCheck size={14} weight="fill" className="text-slate-500" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                Account Inactive
              </span>
            </div>

            {/* Title */}
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
              Your account is currently inactive.
            </h1>

            {/* Message */}
            <p className="text-sm text-slate-500 leading-relaxed max-w-sm mx-auto">
              Please contact your institute administrator.
            </p>

            {/* Divider */}
            <div className="border-t border-slate-100 pt-4">
              <p className="text-xs text-slate-400 mb-3">
                Need help? Contact your institute administrator.
              </p>

              {/* Logout button */}
              <button
                onClick={handleLogout}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-700 text-sm font-medium transition-all active:scale-[0.98]"
              >
                <SignOut size={16} />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-[11px] text-slate-500/60 mt-6 font-mono">
          EdTech Faculty Studio v2.4
        </p>
      </div>
    </div>
  );
}
