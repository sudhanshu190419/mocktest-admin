'use client';

import { useState, useCallback } from 'react';
import {
  getSettings,
  updateSettings,
  resetSettings,
  clearAllLocalData,
} from '@/services/settings/settingsService';
import { PageHeader } from '@/components/ui/PageHeader';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type {
  TeacherSettings,
  ThemeMode,
} from '@/types/settings';

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<TeacherSettings>(getSettings);
  const [saved, setSaved] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

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

  const cardClass = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900';
  const sectionTitleClass = 'mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Configure your appearance and system preferences"
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
        message="This will reset all your preferences to their default values."
        confirmLabel="Reset Settings"
        variant="danger"
      />

      <ConfirmDialog
        open={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={handleClearData}
        title="Clear Local Data"
        message="This will remove all locally stored data including settings, preferences, and cached data."
        confirmLabel="Clear All Data"
        variant="danger"
      />
    </div>
  );
}
