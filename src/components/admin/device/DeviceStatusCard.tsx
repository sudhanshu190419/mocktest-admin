'use client';

import React from 'react';
import { ArrowClockwise, SignOut } from '@phosphor-icons/react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import type { DeviceInfo } from '@/types/trustedDevice';

/**
 * Shared device status card.
 *
 * Rendered by the four device status screens (pending / rejected / revoked /
 * expired). Follows the admin design system (matches the account-status
 * screens' card pattern) and shows the device info captured by AuthContext.
 *
 * Props:
 *   badge     – uppercase badge label (e.g. "Device Pending Approval")
 *   title     – heading
 *   message   – body copy
 *   accent    – tailwind color tokens for the illustration area + badge
 *   icon      – Phosphor icon node for the illustration circle
 *   deviceInfo– optional DeviceInfo (name, requestedAt, rejectionReason)
 *   children  – optional extra content (e.g. rejection reason block)
 *   onRefresh – refresh status handler (refreshing state handled internally)
 *   showRefresh – whether to render the Refresh Status button
 */
export default function DeviceStatusCard({
  badge,
  title,
  message,
  accent,
  icon,
  deviceInfo,
  children,
  onRefresh,
  showRefresh = true,
}: {
  badge: string;
  title: string;
  message: string;
  accent: {
    screen: string;
    illustration: string;
    circle: string;
    badgeBg: string;
    badgeBorder: string;
    badgeText: string;
  };
  icon: React.ReactNode;
  deviceInfo?: DeviceInfo | null;
  children?: React.ReactNode;
  onRefresh?: () => Promise<void>;
  showRefresh?: boolean;
}) {
  const { signOut } = useAuth();
  const router = useRouter();
  const [refreshing, setRefreshing] = React.useState(false);

  const handleRefresh = async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
    router.push('/');
  };

  return (
    <div
      className={`min-h-full w-full ${accent.screen} flex items-center justify-center p-4 sm:p-6`}
    >
      <div className="w-full max-w-md mx-auto">
        <div className="rounded-3xl bg-white shadow-2xl border border-slate-100 overflow-hidden">
          {/* Illustration area */}
          <div
            className={`h-48 ${accent.illustration} flex items-center justify-center relative overflow-hidden`}
          >
            <div className="absolute inset-0 opacity-10">
              <div
                className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 rounded-full ${accent.circle} blur-[80px]`}
              />
            </div>
            <div className="relative flex flex-col items-center gap-2">
              <div
                className={`w-20 h-20 rounded-full ${accent.circle} border-4 border-white/40 flex items-center justify-center bg-white/80`}
              >
                {icon}
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="p-8 pt-6 text-center space-y-4">
            {/* Badge */}
            <div
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full ${accent.badgeBg} border ${accent.badgeBorder}`}
            >
              <span
                className={`text-[11px] font-bold uppercase tracking-wider ${accent.badgeText}`}
              >
                {badge}
              </span>
            </div>

            {/* Title */}
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
              {title}
            </h1>

            {/* Message */}
            <p className="text-sm text-slate-500 leading-relaxed max-w-sm mx-auto">
              {message}
            </p>

            {/* Device info */}
            {deviceInfo && (
              <div className="text-left rounded-2xl bg-slate-50 border border-slate-100 divide-y divide-slate-100">
                {deviceInfo.deviceName && (
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-xs text-slate-400 font-medium">Device</span>
                    <span className="text-xs font-semibold text-slate-700">
                      {deviceInfo.deviceName}
                    </span>
                  </div>
                )}
                {deviceInfo.requestedAt && (
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-xs text-slate-400 font-medium">Requested</span>
                    <span className="text-xs font-semibold text-slate-700">
                      {new Date(deviceInfo.requestedAt).toLocaleString()}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-xs text-slate-400 font-medium">Status</span>
                  <span
                    className={`text-xs font-bold uppercase tracking-wider ${accent.badgeText}`}
                  >
                    {deviceInfo.status}
                  </span>
                </div>
              </div>
            )}

            {/* Extra content (e.g. rejection reason) */}
            {children}

            {/* Divider */}
            <div className="border-t border-slate-100 pt-4 space-y-3">
              <p className="text-xs text-slate-400">
                Need help? Contact your institute administrator.
              </p>

              <div className="flex items-center justify-center gap-3">
                {showRefresh && onRefresh && (
                  <button
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-sm font-medium transition-all active:scale-[0.98]"
                  >
                    <ArrowClockwise
                      size={16}
                      className={refreshing ? 'animate-spin' : ''}
                    />
                    <span>{refreshing ? 'Checking...' : 'Refresh Status'}</span>
                  </button>
                )}
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
        </div>

        <p className="text-center text-[11px] text-slate-500/60 mt-6 font-mono">
          EdTech Faculty Studio v2.4
        </p>
      </div>
    </div>
  );
}
