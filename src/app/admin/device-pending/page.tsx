'use client';

import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { Hourglass, ShieldCheck } from '@phosphor-icons/react';
import DeviceStatusCard from '@/components/admin/device/DeviceStatusCard';

/**
 * Device Pending Approval screen.
 *
 * Shown when an Academic/Finance Admin logs in from an unknown device that
 * is awaiting Super Admin approval. The Supabase session stays alive — only
 * admin routes are blocked (enforced by AdminRouteGuard / RoleGuard).
 *
 * Auto-refreshes every 60 seconds and redirects to /admin as soon as the
 * device is approved.
 */
export default function DevicePendingPage() {
  const { deviceStatus, deviceInfo, refreshDeviceStatus } = useAuth();
  const router = useRouter();
  const [refreshing, setRefreshing] = React.useState(false);

  // Redirect to the dashboard once the device becomes trusted.
  React.useEffect(() => {
    if (deviceStatus === 'approved' || deviceStatus === 'bypass') {
      router.replace('/admin');
    }
  }, [deviceStatus, router]);

  // Optional auto-refresh every 60 seconds (no aggressive polling).
  React.useEffect(() => {
    const id = setInterval(() => {
      void refreshDeviceStatus();
    }, 60_000);
    return () => clearInterval(id);
  }, [refreshDeviceStatus]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshDeviceStatus();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <DeviceStatusCard
      badge="Device Pending Approval"
      title="Waiting for Super Admin approval"
      message="This browser isn't registered as a trusted device yet. The Super Admin must approve it before you can continue. If your request can't be verified, press Refresh Status to try again — or contact your Super Admin."
      accent={{
        screen: 'bg-gradient-to-br from-slate-900 via-amber-950 to-slate-900',
        illustration: 'bg-gradient-to-br from-amber-50 via-amber-100/50 to-orange-50',
        circle: 'bg-amber-400',
        badgeBg: 'bg-amber-50',
        badgeBorder: 'border-amber-200/60',
        badgeText: 'text-amber-700',
      }}
      icon={<Hourglass size={36} weight="duotone" className="text-amber-600" />}
      deviceInfo={deviceInfo}
      onRefresh={handleRefresh}
      showRefresh
    >
      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200/60">
        <ShieldCheck size={14} weight="fill" className="text-emerald-600" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
          Session kept alive — status refreshes automatically
        </span>
      </div>
      {refreshing && (
        <p className="text-xs text-slate-400">Refreshing status…</p>
      )}
    </DeviceStatusCard>
  );
}
