/**
 * Teacher Settings Service
 *
 * Persists teacher preferences to localStorage with a future-ready
 * structure for server-side sync.
 *
 * Every public method returns a standardised `ApiResponse<T>` shape.
 *
 * @module services/settings/settingsService
 */

import { extractErrorMessage } from '@/utils/supabase';
import type { ApiResponse } from '@/types/academic';
import {
  DEFAULT_TEACHER_SETTINGS,
} from '@/types/settings';
import type {
  TeacherSettings,
  ThemeMode,
  SupportedLanguage,
  TimeZone,
  DateFormat,
  TimeFormat,
  DashboardPreferences,
  PrivacySettings,
  SessionSettings,
  DataStoragePreferences,
} from '@/types/settings';

const SETTINGS_KEY = 'EDTECH_TEACHER_SETTINGS';

// ═══════════════════════════════════════════════════════════════════════════
//  Read / Write
// ═══════════════════════════════════════════════════════════════════════════

function loadRawSettings(): Partial<TeacherSettings> {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // ignore parse errors
  }
  return {};
}

function persistSettings(settings: TeacherSettings): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // localStorage full or unavailable
  }
}

/**
 * Get all teacher settings, merging stored values with defaults.
 */
export function getSettings(): TeacherSettings {
  const stored = loadRawSettings();
  return { ...DEFAULT_TEACHER_SETTINGS, ...stored };
}

/**
 * Save a complete settings object.
 */
export function saveSettings(settings: TeacherSettings): ApiResponse<null> {
  try {
    persistSettings(settings);
    applyTheme(settings.appearance);
    return { success: true, data: null };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Update partial settings (merges with current).
 */
export function updateSettings(
  partial: Partial<TeacherSettings>,
): ApiResponse<TeacherSettings> {
  try {
    const current = getSettings();
    const updated = { ...current, ...partial };
    persistSettings(updated);

    // Apply theme immediately if appearance changed
    if (partial.appearance) {
      applyTheme(partial.appearance);
    }

    return { success: true, data: updated };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Individual Setting Helpers
// ═══════════════════════════════════════════════════════════════════════════

export function getAppearance(): ThemeMode {
  return getSettings().appearance;
}

export function updateAppearance(mode: ThemeMode): ApiResponse<TeacherSettings> {
  return updateSettings({ appearance: mode });
}

export function getLanguage(): SupportedLanguage {
  return getSettings().language;
}

export function updateLanguage(language: SupportedLanguage): ApiResponse<TeacherSettings> {
  return updateSettings({ language });
}

export function updateDashboardPreferences(
  prefs: Partial<DashboardPreferences>,
): ApiResponse<TeacherSettings> {
  const current = getSettings();
  return updateSettings({
    dashboard: { ...current.dashboard, ...prefs },
  });
}

export function updatePrivacySettings(
  prefs: Partial<PrivacySettings>,
): ApiResponse<TeacherSettings> {
  const current = getSettings();
  return updateSettings({
    privacy: { ...current.privacy, ...prefs },
  });
}

export function updateSessionSettings(
  prefs: Partial<SessionSettings>,
): ApiResponse<TeacherSettings> {
  const current = getSettings();
  return updateSettings({
    session: { ...current.session, ...prefs },
  });
}

export function updateDataStoragePrefs(
  prefs: Partial<DataStoragePreferences>,
): ApiResponse<TeacherSettings> {
  const current = getSettings();
  return updateSettings({
    dataStorage: { ...current.dataStorage, ...prefs },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Theme Application
// ═══════════════════════════════════════════════════════════════════════════

function applyTheme(mode: ThemeMode): void {
  if (typeof window === 'undefined') return;

  const root = document.documentElement;

  if (mode === 'dark') {
    root.classList.add('dark');
  } else if (mode === 'light') {
    root.classList.remove('dark');
  } else {
    // system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }
}

/**
 * Initialize theme on app load.
 * Call this once during app initialization.
 */
export function initializeTheme(): void {
  const settings = getSettings();
  applyTheme(settings.appearance);

  // Listen for system preference changes in "system" mode
  if (typeof window !== 'undefined' && settings.appearance === 'system') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (getSettings().appearance === 'system') {
        applyTheme(e.matches ? 'dark' : 'light');
      }
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Reset / Clear
// ═══════════════════════════════════════════════════════════════════════════

export function resetSettings(): ApiResponse<null> {
  try {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(SETTINGS_KEY);
    }
    return { success: true, data: null };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

export function clearAllLocalData(): ApiResponse<null> {
  try {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(SETTINGS_KEY);
      localStorage.removeItem('EDTECH_NOTIFICATION_PREFS');
      localStorage.removeItem('EDTECH_DEMO_MODE');
      localStorage.removeItem('EDTECH_SIM_ROLE');
      localStorage.removeItem('EDTECH_CUSTOM_FACULTY');
    }
    return { success: true, data: null };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}
