'use client';

import { useState, useCallback } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { NotificationToggle } from '@/components/profile/NotificationToggle';
import { getNotificationPreferences, saveNotificationPreferences } from '@/services/profileService';
import { NOTIFICATION_PREFERENCE_ITEMS } from '@/types/profile';
import type { NotificationPreferences } from '@/types/profile';

export default function PreferencesPage() {
  const [prefs, setPrefs] = useState<NotificationPreferences>(getNotificationPreferences);
  const [saved, setSaved] = useState(false);

  const handleToggle = useCallback((key: keyof NotificationPreferences) => {
    const updated = { ...prefs, [key]: !prefs[key] };
    setPrefs(updated);
    const result = saveNotificationPreferences(updated);
    setSaved(result.success);
    setTimeout(() => setSaved(false), 2000);
  }, [prefs]);

  const channelItems = NOTIFICATION_PREFERENCE_ITEMS.filter((i) => i.category === 'channel');
  const alertItems = NOTIFICATION_PREFERENCE_ITEMS.filter((i) => i.category === 'alert');
  const marketingItems = NOTIFICATION_PREFERENCE_ITEMS.filter((i) => i.category === 'marketing');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notification Preferences"
        description="Manage how and when you receive notifications"
      />

      {/* Save indicator */}
      {saved && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-400">
          Preferences saved automatically.
        </div>
      )}

      {/* Notification Channels */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
        <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">Notification Channels</h3>
        <p className="mb-4 text-xs text-gray-500">Choose how you receive notifications</p>
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {channelItems.map((item) => (
            <NotificationToggle
              key={item.key}
              label={item.label}
              description={item.description}
              checked={prefs[item.key]}
              onChange={() => handleToggle(item.key)}
            />
          ))}
        </div>
      </div>

      {/* Alert Preferences */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
        <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">Alert Preferences</h3>
        <p className="mb-4 text-xs text-gray-500">Choose which alerts you want to receive</p>
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {alertItems.map((item) => (
            <NotificationToggle
              key={item.key}
              label={item.label}
              description={item.description}
              checked={prefs[item.key]}
              onChange={() => handleToggle(item.key)}
            />
          ))}
        </div>
      </div>

      {/* Marketing */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
        <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">Marketing</h3>
        <p className="mb-4 text-xs text-gray-500">Product updates and announcements</p>
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {marketingItems.map((item) => (
            <NotificationToggle
              key={item.key}
              label={item.label}
              description={item.description}
              checked={prefs[item.key]}
              onChange={() => handleToggle(item.key)}
            />
          ))}
        </div>
      </div>

      {/* Future-ready note */}
      <div className="rounded-xl border border-dashed border-blue-200 bg-blue-50/50 p-4 text-center dark:border-blue-700 dark:bg-blue-900/10">
        <p className="text-xs text-blue-600 dark:text-blue-400">
          💡 Notification preferences are currently stored locally. Server-side sync will be available in a future release.
        </p>
      </div>
    </div>
  );
}
