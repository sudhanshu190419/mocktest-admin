'use client';

import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { Timer, ArrowClockwise } from '@phosphor-icons/react';
import DeviceStatusCard from '@/components/admin/device/DeviceStatusCard';

/**
 * Device Expired screen.
 *
 * Shown when an Academic/Finance Admin's trusted device has expired (or is
 * inactive). Offers a "Request new approval" action that clears the stored
 * device token and mints a NEW pending request for the Super Admin.
 */
export default function DeviceExpiredPage() {
  const { deviceStatus, deviceInfo, refreshDeviceStatus, requestNewDeviceApproval } =
    useAuth();
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);

  // If the status changes to trusted, proceed to the dashboard.
  React.useEffect(() => {
    if (deviceStatus === 'approved' || deviceStatus === 'bypass') {
      router.replace('/admin');
    }
  }, [deviceStatus, router]);

  const handleRequestNew = async () => {
    setSubmitting(true);
    try {
      await requestNewDeviceApproval();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DeviceStatusCard
      badge="Trusted Device Expired"
      title="Your trusted device has expired"
      message="Trusted access for this device is no longer valid. Request a new approval to continue using the admin workspace."
      accent={{
        screen: 'bg-gradient-to-br from-slate-900 via-sky-950 to-slate-900',
        illustration: 'bg-gradient-to-br from-sky-50 via-sky-100/50 to-blue-50',
        circle: 'bg-sky-400',
        badgeBg: 'bg-sky-50',
        badgeBorder: 'border-sky-200/60',
        badgeText: 'text-sky-700',
      }}
      icon={<Timer size={36} weight="duotone" className="text-sky-500" />}
      deviceInfo={deviceInfo}
      onRefresh={refreshDeviceStatus}
      showRefresh
    >
      <button
        onClick={handleRequestNew}
        disabled={submitting}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white text-sm font-medium transition-all active:scale-[0.98] w-full justify-center"
      >
        <ArrowClockwise size={16} className={submitting ? 'animate-spin' : ''} />
        <span>{submitting ? 'Requesting approval…' : 'Request New Approval'}</span>
      </button>
    </DeviceStatusCard>
  );
}
