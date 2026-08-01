'use client';

import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { XCircle } from '@phosphor-icons/react';
import DeviceStatusCard from '@/components/admin/device/DeviceStatusCard';

/**
 * Device Rejected screen.
 *
 * Shown when an Academic/Finance Admin's device request was rejected by the
 * Super Admin. Displays the rejection reason (when provided) and advises
 * contacting the Super Admin. The Supabase session stays alive.
 */
export default function DeviceRejectedPage() {
  const { deviceStatus, deviceInfo, refreshDeviceStatus } = useAuth();
  const router = useRouter();
  const [refreshing, setRefreshing] = React.useState(false);

  // If the status changes to trusted, proceed to the dashboard.
  React.useEffect(() => {
    if (deviceStatus === 'approved' || deviceStatus === 'bypass') {
      router.replace('/admin');
    }
  }, [deviceStatus, router]);

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
      badge="Device Request Rejected"
      title="Your device was not approved"
      message="The Super Admin rejected this device request. Please contact the Super Admin to resolve the issue before trying again."
      accent={{
        screen: 'bg-gradient-to-br from-slate-900 via-red-950 to-slate-900',
        illustration: 'bg-gradient-to-br from-red-50 via-red-100/50 to-rose-50',
        circle: 'bg-red-400',
        badgeBg: 'bg-red-50',
        badgeBorder: 'border-red-200/60',
        badgeText: 'text-red-700',
      }}
      icon={<XCircle size={36} weight="duotone" className="text-red-500" />}
      deviceInfo={deviceInfo}
      onRefresh={handleRefresh}
      showRefresh
    >
      {deviceInfo?.rejectionReason ? (
        <div className="text-left rounded-2xl bg-red-50 border border-red-100 p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-red-500 mb-1">
            Rejection Reason
          </p>
          <p className="text-sm text-slate-700 leading-relaxed">
            {deviceInfo.rejectionReason}
          </p>
        </div>
      ) : (
        <p className="text-xs text-slate-400">
          No rejection reason was provided.
        </p>
      )}
      {refreshing && <p className="text-xs text-slate-400">Refreshing status…</p>}
    </DeviceStatusCard>
  );
}
