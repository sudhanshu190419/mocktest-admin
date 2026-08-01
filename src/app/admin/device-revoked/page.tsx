'use client';

import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { ShieldSlash } from '@phosphor-icons/react';
import DeviceStatusCard from '@/components/admin/device/DeviceStatusCard';

/**
 * Device Revoked screen.
 *
 * Shown when an Academic/Finance Admin's previously approved trusted device
 * was revoked by the Super Admin. Advises contacting the Super Admin and
 * signing in again once resolved.
 */
export default function DeviceRevokedPage() {
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
      badge="Device Access Revoked"
      title="Your trusted device has been revoked"
      message="A Super Admin revoked trusted access for this device. Please contact the Super Admin, then sign in again after the issue is resolved."
      accent={{
        screen: 'bg-gradient-to-br from-slate-900 via-orange-950 to-slate-900',
        illustration: 'bg-gradient-to-br from-orange-50 via-orange-100/50 to-amber-50',
        circle: 'bg-orange-400',
        badgeBg: 'bg-orange-50',
        badgeBorder: 'border-orange-200/60',
        badgeText: 'text-orange-700',
      }}
      icon={<ShieldSlash size={36} weight="duotone" className="text-orange-500" />}
      deviceInfo={deviceInfo}
      onRefresh={handleRefresh}
      showRefresh
    >
      {refreshing && <p className="text-xs text-slate-400">Refreshing status…</p>}
    </DeviceStatusCard>
  );
}
