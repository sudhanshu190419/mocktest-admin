'use client';

import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { updatePassword } from '@/services/authService';
import { PageHeader } from '@/components/ui/PageHeader';
import { SecurityCard } from '@/components/profile/SecurityCard';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

export default function SecurityPage() {
  const { signOut } = useAuth();
  const [passwordForm, setPasswordForm] = useState({ current: '', newPass: '', confirm: '' });
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(false);

    if (passwordForm.newPass.length < 6) {
      setPasswordError('New password must be at least 6 characters.');
      return;
    }
    if (passwordForm.newPass !== passwordForm.confirm) {
      setPasswordError('Passwords do not match.');
      return;
    }

    setSavingPassword(true);
    const result = await updatePassword(passwordForm.newPass);
    if (result.success) {
      setPasswordSuccess(true);
      setPasswordForm({ current: '', newPass: '', confirm: '' });
      setTimeout(() => setShowPasswordForm(false), 2000);
    } else {
      setPasswordError(result.error ?? 'Failed to update password.');
    }
    setSavingPassword(false);
  };

  const handleLogoutAll = async () => {
    setLoggingOut(true);
    await signOut();
    // After sign out, the user will be redirected to login
  };

  const inputClass = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-600';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security"
        description="Manage your account security settings and password"
      />

      {/* Password Section */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Password</h3>
            <p className="mt-0.5 text-xs text-gray-500">Last changed: Not tracked locally</p>
          </div>
          <button
            type="button"
            onClick={() => setShowPasswordForm(!showPasswordForm)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700"
          >
            {showPasswordForm ? 'Cancel' : 'Change Password'}
          </button>
        </div>

        {showPasswordForm && (
          <form onSubmit={handlePasswordChange} className="space-y-4 border-t border-gray-100 pt-4 dark:border-gray-700">
            {passwordSuccess && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-400">
                Password updated successfully!
              </div>
            )}
            {passwordError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/20 dark:text-rose-400">
                {passwordError}
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400" htmlFor="current-pass">Current Password</label>
                <input id="current-pass" type="password" value={passwordForm.current} onChange={(e) => setPasswordForm((p) => ({ ...p, current: e.target.value }))} className={inputClass} placeholder="Enter current password" required />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400" htmlFor="new-pass">New Password</label>
                <input id="new-pass" type="password" value={passwordForm.newPass} onChange={(e) => setPasswordForm((p) => ({ ...p, newPass: e.target.value }))} className={inputClass} placeholder="Min 6 characters" required minLength={6} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400" htmlFor="confirm-pass">Confirm Password</label>
                <input id="confirm-pass" type="password" value={passwordForm.confirm} onChange={(e) => setPasswordForm((p) => ({ ...p, confirm: e.target.value }))} className={inputClass} placeholder="Re-enter new password" required />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingPassword}
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {savingPassword ? 'Updating...' : 'Update Password'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Security Cards */}
      <div className="grid grid-cols-1 gap-4">
        <SecurityCard
          title="Active Sessions"
          status="warning"
          description="Sessions are managed server-side. Sign out from all devices if you suspect unauthorized access."
          action={{
            label: 'Logout All Devices',
            onClick: () => setShowLogoutConfirm(true),
            variant: 'danger',
          }}
        />
      </div>

      <ConfirmDialog
        open={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        onConfirm={handleLogoutAll}
        title="Logout All Devices"
        message="This will sign you out of all active sessions. You will need to sign in again on all devices."
        confirmLabel={loggingOut ? 'Logging out...' : 'Logout All'}
        variant="danger"
        loading={loggingOut}
      />
    </div>
  );
}
