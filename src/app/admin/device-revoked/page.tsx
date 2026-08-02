'use client';

import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { ShieldSlash, PaperPlaneRight } from '@phosphor-icons/react';
import DeviceStatusCard from '@/components/admin/device/DeviceStatusCard';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

/**
 * Device Revoked screen.
 *
 * Shown when an Academic/Finance Admin's previously approved trusted device
 * was revoked by the Super Admin. Advises contacting the Super Admin and
 * offers "Request Approval Again": clears the device token cookie and mints
 * a FRESH pending request (Phase 7F). Once approved, the currently approved
 * device is revoked (one-approved-device rule) and this device takes over.
 */
export default function DeviceRevokedPage() {
  const {
    deviceStatus,
    deviceInfo,
    refreshDeviceStatus,
    requestNewDeviceApproval,
  } = useAuth();
  const router = useRouter();
  const [refreshing, setRefreshing] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // If the status changes to trusted, proceed to the dashboard.
  React.useEffect(() => {
    if (deviceStatus === 'approved' || deviceStatus === 'bypass') {
      router.replace('/admin');
    }
    // Phase 7F: after a successful re-request the challenge resolves to
    // 'pending' — RoleGuard redirects to /admin/device-pending automatically,
    // so no navigation is needed here.
  }, [deviceStatus, router]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshDeviceStatus();
    } finally {
      setRefreshing(false);
    }
  };

  const handleRequestAgain = async () => {
    // Prevent duplicate submissions while the request is in flight.
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setSubmitted(false);
    try {
      await requestNewDeviceApproval();
      // The challenge resolves to 'pending' → RoleGuard navigates to
      // /admin/device-pending. Mark success so a fast re-render before the
      // redirect never shows a stale error state.
      setSubmitted(true);
      setConfirmOpen(false);
    } catch (err) {
      setError('Could not send the approval request. Please try again.');
      console.warn('[DeviceRevoked] request approval again failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <DeviceStatusCard
        badge="Device Access Revoked"
        title="Your trusted device has been revoked"
        message="A Super Admin revoked trusted access for this device. You can request approval again — the Super Admin will review the request and approve it if appropriate."
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
        {/* Phase 7F: primary re-request action */}
        <button
          onClick={() => setConfirmOpen(true)}
          disabled={submitting}
          className="inline-flex items-center justify-center gap-2 w-full px-5 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-500 disabled:opacity-60 text-white text-sm font-medium transition-all active:scale-[0.98]"
        >
          <PaperPlaneRight size={16} className={submitting ? 'animate-pulse' : ''} />
          <span>
            {submitting
              ? 'Sending request…'
              : submitted
                ? 'Request sent — waiting for approval'
                : 'Request Approval Again'}
          </span>
        </button>

        {error && (
          <p className="text-xs text-red-500 font-medium">{error}</p>
        )}
        {submitted && !error && (
          <p className="text-xs text-emerald-600 font-medium">
            Approval request sent. You will be taken to the waiting screen.
          </p>
        )}
        {refreshing && <p className="text-xs text-slate-400">Refreshing status…</p>}
      </DeviceStatusCard>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => {
          if (!submitting) setConfirmOpen(false);
        }}
        onConfirm={handleRequestAgain}
        title="Request Approval Again?"
        message="This account already has another approved device. If this request is approved, the currently approved device will be revoked and signed out. Do you want to send a new approval request?"
        confirmLabel="Send Request"
        cancelLabel="Cancel"
        variant="warning"
        loading={submitting}
      />
    </>
  );
}
