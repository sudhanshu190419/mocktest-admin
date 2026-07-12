'use client';

import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import {
  getSettings,
  updateSettings,
  resetSettings,
  clearAllLocalData,
} from '@/services/settings/settingsService';
import { PageHeader } from '@/components/ui/PageHeader';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  LANGUAGE_OPTIONS,
  TIMEZONE_OPTIONS,
  DATE_FORMAT_OPTIONS,
  TIME_FORMAT_OPTIONS,
} from '@/types/settings';
import type {
  TeacherSettings,
  ThemeMode,
  SupportedLanguage,
  TimeZone,
  DateFormat,
  TimeFormat,
} from '@/types/settings';
import Link from 'next/link';

type SettingsSection =
  | 'appearance'
  | 'language'
  | 'dashboard'
  | 'privacy'
  | 'session'
  | 'keys'
  | 'about'
  | 'advanced';

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') as SettingsSection | null;
  const { signOut } = useAuth();

  const [settings, setSettings] = useState<TeacherSettings>(getSettings);
  const [saved, setSaved] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSection>(tab ?? 'appearance');

  useEffect(() => {
    if (tab) setActiveSection(tab);
  }, [tab]);

  const updateAndSave = useCallback((partial: Partial<TeacherSettings>) => {
    const result = updateSettings(partial);
    if (result.success && result.data) {
      setSettings(result.data);
    } else {
      // Still update local state even if persistence fails
      setSettings((prev) => ({ ...prev, ...partial }));
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, []);

  // ── Appearance ────────────────────────────────────────────────────────

  const appearanceOptions: { value: ThemeMode; label: string; description: string; icon: string }[] = [
    { value: 'light', label: 'Light', description: 'Always light mode', icon: '☀️' },
    { value: 'dark', label: 'Dark', description: 'Always dark mode', icon: '🌙' },
    { value: 'system', label: 'System', description: 'Follow device preference', icon: '💻' },
  ];

  // ── Reset / Clear ─────────────────────────────────────────────────────

  const handleReset = () => {
    resetSettings();
    setSettings(getSettings());
    setShowResetConfirm(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleClearData = () => {
    clearAllLocalData();
    setSettings(getSettings());
    setShowClearConfirm(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // ── UI Shared ─────────────────────────────────────────────────────────

  const selectClass = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
  const cardClass = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900';
  const labelClass = 'mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400';
  const sectionTitleClass = 'mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100';
  const switchClass = 'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2';

  const toggleSwitch = ({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`${switchClass} ${checked ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'}`}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
    </button>
  );

  const SettingRow = ({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) => (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</p>
        {description && <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{description}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );

  const SettingDivider = () => <div className="h-px bg-gray-100 dark:bg-gray-700" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Configure your preferences, appearance, and account settings"
      />

      {/* Save indicator */}
      {saved && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-400">
          Settings saved.
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════ Appearance ═══ */}
      <div id="appearance" className={cardClass}>
        <h2 className={sectionTitleClass}>🎨 Appearance</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {appearanceOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => updateAndSave({ appearance: opt.value })}
              className={`rounded-xl border-2 p-4 text-left transition-all ${
                settings.appearance === opt.value
                  ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/20'
                  : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'
              }`}
              aria-pressed={settings.appearance === opt.value}
            >
              <span className="text-xl">{opt.icon}</span>
              <p className="mt-2 text-sm font-semibold text-gray-900 dark:text-gray-100">{opt.label}</p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{opt.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* ════════════════════════════════════════════════ Language & Locale ═══ */}
      <div id="language" className={cardClass}>
        <h2 className={sectionTitleClass}>🌐 Language & Locale</h2>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className={labelClass} htmlFor="lang">Language</label>
            <select
              id="lang"
              value={settings.language}
              onChange={(e) => updateAndSave({ language: e.target.value as SupportedLanguage })}
              className={selectClass}
            >
              {LANGUAGE_OPTIONS.map((l) => (
                <option key={l.value} value={l.value}>{l.nativeName} ({l.label})</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="tz">Time Zone</label>
            <select
              id="tz"
              value={settings.timeZone}
              onChange={(e) => updateAndSave({ timeZone: e.target.value as TimeZone })}
              className={selectClass}
            >
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz.value} value={tz.value}>{tz.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="dateFmt">Date Format</label>
            <select
              id="dateFmt"
              value={settings.dateFormat}
              onChange={(e) => updateAndSave({ dateFormat: e.target.value as DateFormat })}
              className={selectClass}
            >
              {DATE_FORMAT_OPTIONS.map((df) => (
                <option key={df.value} value={df.value}>{df.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="timeFmt">Time Format</label>
            <select
              id="timeFmt"
              value={settings.timeFormat}
              onChange={(e) => updateAndSave({ timeFormat: e.target.value as TimeFormat })}
              className={selectClass}
            >
              {TIME_FORMAT_OPTIONS.map((tf) => (
                <option key={tf.value} value={tf.value}>{tf.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ═════════════════════════════════════════════ Dashboard Prefs ═══ */}
      <div id="dashboard" className={cardClass}>
        <h2 className={sectionTitleClass}>📊 Dashboard Preferences</h2>
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          <SettingRow label="Show Upcoming Classes" description="Display upcoming classes on the dashboard">
            {toggleSwitch({ checked: settings.dashboard.showUpcomingClasses, onChange: (v) => updateAndSave({ dashboard: { ...settings.dashboard, showUpcomingClasses: v } }) })}
          </SettingRow>
          <SettingDivider />
          <SettingRow label="Show Pending Tasks" description="Display pending tasks and approvals">
            {toggleSwitch({ checked: settings.dashboard.showPendingTasks, onChange: (v) => updateAndSave({ dashboard: { ...settings.dashboard, showPendingTasks: v } }) })}
          </SettingRow>
          <SettingDivider />
          <SettingRow label="Show Quick Stats" description="Display quick statistics cards">
            {toggleSwitch({ checked: settings.dashboard.showQuickStats, onChange: (v) => updateAndSave({ dashboard: { ...settings.dashboard, showQuickStats: v } }) })}
          </SettingRow>
          <SettingDivider />
          <SettingRow label="Show Recent Activity" description="Display recent activity feed">
            {toggleSwitch({ checked: settings.dashboard.showRecentActivity, onChange: (v) => updateAndSave({ dashboard: { ...settings.dashboard, showRecentActivity: v } }) })}
          </SettingRow>
          <SettingDivider />
          <SettingRow label="Default View" description="Default calendar view">
            <select
              value={settings.dashboard.defaultView}
              onChange={(e) => updateAndSave({ dashboard: { ...settings.dashboard, defaultView: e.target.value as 'weekly' | 'monthly' } })}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            >
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </SettingRow>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════ Privacy ═══ */}
      <div id="privacy" className={cardClass}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className={sectionTitleClass}>🔐 Privacy</h2>
          <Link
            href="/teacher/profile/security"
            className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            Security Settings →
          </Link>
        </div>
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          <SettingRow label="Show Profile to Students" description="Allow students to view your teacher profile">
            {toggleSwitch({ checked: settings.privacy.showProfileToStudents, onChange: (v) => updateAndSave({ privacy: { ...settings.privacy, showProfileToStudents: v } }) })}
          </SettingRow>
          <SettingDivider />
          <SettingRow label="Show Email to Students" description="Display your email address on your profile">
            {toggleSwitch({ checked: settings.privacy.showEmailToStudents, onChange: (v) => updateAndSave({ privacy: { ...settings.privacy, showEmailToStudents: v } }) })}
          </SettingRow>
          <SettingDivider />
          <SettingRow label="Show Phone to Students" description="Display your phone number on your profile">
            {toggleSwitch({ checked: settings.privacy.showPhoneToStudents, onChange: (v) => updateAndSave({ privacy: { ...settings.privacy, showPhoneToStudents: v } }) })}
          </SettingRow>
          <SettingDivider />
          <SettingRow label="Allow Student Messages" description="Let students send you direct messages">
            {toggleSwitch({ checked: settings.privacy.allowStudentMessages, onChange: (v) => updateAndSave({ privacy: { ...settings.privacy, allowStudentMessages: v } }) })}
          </SettingRow>
          <SettingDivider />
          <SettingRow label="Share Analytics with Institute" description="Share your performance data with institute administration">
            {toggleSwitch({ checked: settings.privacy.shareAnalyticsWithInstitute, onChange: (v) => updateAndSave({ privacy: { ...settings.privacy, shareAnalyticsWithInstitute: v } }) })}
          </SettingRow>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════ Session ═══ */}
      <div id="session" className={cardClass}>
        <h2 className={sectionTitleClass}>🔑 Session Management</h2>
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          <SettingRow label="Remember Me" description="Stay signed in across browser sessions">
            {toggleSwitch({ checked: settings.session.rememberMe, onChange: (v) => updateAndSave({ session: { ...settings.session, rememberMe: v } }) })}
          </SettingRow>
          <SettingDivider />
          <SettingRow label="Login Notifications" description="Get notified when a new device signs in to your account">
            {toggleSwitch({ checked: settings.session.loginNotifications, onChange: (v) => updateAndSave({ session: { ...settings.session, loginNotifications: v } }) })}
          </SettingRow>
          <SettingDivider />
          <SettingRow label="Auto Logout" description="Automatically sign out after inactivity">
            <select
              value={settings.session.autoLogoutMinutes}
              onChange={(e) => updateAndSave({ session: { ...settings.session, autoLogoutMinutes: Number(e.target.value) } })}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            >
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={60}>1 hour</option>
              <option value={120}>2 hours</option>
              <option value={0}>Never</option>
            </select>
          </SettingRow>
          <SettingDivider />
          <SettingRow label="Active Sessions" description="Manage devices signed into your account">
            <Link
              href="/teacher/profile/security"
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Manage
            </Link>
          </SettingRow>
        </div>
      </div>

      {/* ═══════════════════════════════════════ Connected Accounts ═══ */}
      <div id="advanced" className={cardClass}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className={sectionTitleClass}>🔗 Connected Accounts</h2>
          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-600 dark:bg-amber-950/30 dark:text-amber-400">Future Ready</span>
        </div>
        <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
          Connect your account with third-party services for enhanced functionality.
        </p>
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          <SettingRow label="Google Workspace" description="Sync calendar, drive, and classroom">
            <span className="rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-xs text-gray-400 dark:border-gray-600">Coming Soon</span>
          </SettingRow>
          <SettingDivider />
          <SettingRow label="Microsoft 365" description="Sync Outlook calendar and Teams">
            <span className="rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-xs text-gray-400 dark:border-gray-600">Coming Soon</span>
          </SettingRow>
          <SettingDivider />
          <SettingRow label="Zoom" description="Integrate Zoom for live classes">
            <span className="rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-xs text-gray-400 dark:border-gray-600">Coming Soon</span>
          </SettingRow>
        </div>
      </div>

      {/* ═══════════════════════════════════ Keyboard Shortcuts ═══ */}
      <div id="keys" className={cardClass}>
        <h2 className={sectionTitleClass}>⌨️ Keyboard Shortcuts</h2>
        <SettingRow label="Enable Keyboard Shortcuts" description="Use keyboard shortcuts for common actions (?, /, g+d, etc.)">
          {toggleSwitch({ checked: settings.keyboardShortcutsEnabled, onChange: (v) => updateAndSave({ keyboardShortcutsEnabled: v }) })}
        </SettingRow>
        {settings.keyboardShortcutsEnabled && (
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { keys: '?', action: 'Show keyboard shortcuts' },
              { keys: '/', action: 'Focus search' },
              { keys: 'g + d', action: 'Go to Dashboard' },
              { keys: 'g + q', action: 'Go to Questions' },
              { keys: 'g + t', action: 'Go to Mock Tests' },
              { keys: 'g + s', action: 'Go to Students' },
              { keys: 'g + r', action: 'Go to Results' },
              { keys: 'g + a', action: 'Go to Analytics' },
              { keys: 'g + n', action: 'Go to Notifications' },
              { keys: 'n', action: 'Create New' },
              { keys: 'e', action: 'Export current view' },
              { keys: 'Esc', action: 'Close dialog / cancel' },
            ].map((shortcut) => (
              <div key={shortcut.keys} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800/50">
                <span className="text-xs text-gray-600 dark:text-gray-400">{shortcut.action}</span>
                <kbd className="rounded border border-gray-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-medium text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300">
                  {shortcut.keys}
                </kbd>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════ About & Version ═══ */}
      <div id="about" className={cardClass}>
        <h2 className={sectionTitleClass}>ℹ️ About & Version</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-gray-400">Application</span>
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">MockTest Teacher Dashboard</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-gray-400">Version</span>
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">1.0.0-beta</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-gray-400">Build</span>
            <span className="text-sm font-mono text-gray-500">2025.07.07.001</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-gray-400">Environment</span>
            <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
              {process.env.NODE_ENV}
            </span>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════ Support & Feedback ═══ */}
      <div id="support" className={cardClass}>
        <h2 className={sectionTitleClass}>💬 Support & Feedback</h2>
        <div className="space-y-3">
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); window.alert('Support email: support@mocktest.app (placeholder)'); }}
            className="flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">📧 Email Support</span>
            <span className="text-xs text-gray-400">support@mocktest.app</span>
          </a>
          <div className="h-px bg-gray-100 dark:bg-gray-700" />
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); window.alert('Documentation link (placeholder)'); }}
            className="flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">📚 Documentation</span>
            <span className="text-xs text-blue-600 dark:text-blue-400">View →</span>
          </a>
          <div className="h-px bg-gray-100 dark:bg-gray-700" />
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); window.alert('Report issue form (placeholder)'); }}
            className="flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">🐛 Report an Issue</span>
            <span className="text-xs text-blue-600 dark:text-blue-400">Open →</span>
          </a>
        </div>
      </div>

      {/* ═══════════════════════════════════ Data & Storage ═══ */}
      <div id="advanced" className={cardClass}>
        <h2 className={sectionTitleClass}>💾 Data & Storage Preferences</h2>
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          <SettingRow label="Cache Results" description="Cache test results locally for faster loading">
            {toggleSwitch({ checked: settings.dataStorage.cacheResults, onChange: (v) => updateAndSave({ dataStorage: { ...settings.dataStorage, cacheResults: v } }) })}
          </SettingRow>
          <SettingDivider />
          <SettingRow label="Auto-Download Reports" description="Automatically download generated reports">
            {toggleSwitch({ checked: settings.dataStorage.autoDownloadReports, onChange: (v) => updateAndSave({ dataStorage: { ...settings.dataStorage, autoDownloadReports: v } }) })}
          </SettingRow>
          <SettingDivider />
          <SettingRow label="Cache Duration" description="How long to keep cached data">
            <select
              value={settings.dataStorage.cacheDurationHours}
              onChange={(e) => updateAndSave({ dataStorage: { ...settings.dataStorage, cacheDurationHours: Number(e.target.value) } })}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            >
              <option value={1}>1 hour</option>
              <option value={6}>6 hours</option>
              <option value={12}>12 hours</option>
              <option value={24}>24 hours</option>
              <option value={48}>48 hours</option>
              <option value={72}>72 hours</option>
            </select>
          </SettingRow>
        </div>
      </div>

      {/* ═══════════════════════════════════ Danger Zone ═══ */}
      <div className="rounded-xl border border-rose-200 bg-white p-5 dark:border-rose-800 dark:bg-gray-900">
        <h2 className="mb-4 text-sm font-semibold text-rose-600 dark:text-rose-400">⚠️ Danger Zone</h2>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setShowResetConfirm(true)}
            className="rounded-lg border border-rose-300 px-4 py-2 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-50 dark:border-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/20"
          >
            Reset All Settings
          </button>
          <button
            type="button"
            onClick={() => setShowClearConfirm(true)}
            className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-rose-700"
          >
            Clear Local Data
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        onConfirm={handleReset}
        title="Reset All Settings"
        message="This will reset all your preferences to their default values. Your account data and profile will not be affected."
        confirmLabel="Reset Settings"
        variant="danger"
      />

      <ConfirmDialog
        open={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={handleClearData}
        title="Clear Local Data"
        message="This will remove all locally stored data including settings, preferences, and cached data. You may need to sign in again."
        confirmLabel="Clear All Data"
        variant="danger"
      />
    </div>
  );
}
