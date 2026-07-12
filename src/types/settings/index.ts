/**
 * Teacher Settings Types
 *
 * @module types/settings
 */

// ═══════════════════════════════════════════════════════════════════════════
//  Appearance
// ═══════════════════════════════════════════════════════════════════════════

export type ThemeMode = 'light' | 'dark' | 'system';

// ═══════════════════════════════════════════════════════════════════════════
//  Language & Locale
// ═══════════════════════════════════════════════════════════════════════════

export type SupportedLanguage = 'en' | 'hi' | 'gu' | 'mr' | 'bn' | 'ta' | 'te';
export type TimeZone = string;
export type DateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
export type TimeFormat = '12h' | '24h';

// ═══════════════════════════════════════════════════════════════════════════
//  Dashboard Preferences
// ═══════════════════════════════════════════════════════════════════════════

export interface DashboardPreferences {
  showUpcomingClasses: boolean;
  showPendingTasks: boolean;
  showQuickStats: boolean;
  showRecentActivity: boolean;
  defaultView: 'weekly' | 'monthly';
  itemsPerPage: number;
}

export const DEFAULT_DASHBOARD_PREFERENCES: DashboardPreferences = {
  showUpcomingClasses: true,
  showPendingTasks: true,
  showQuickStats: true,
  showRecentActivity: true,
  defaultView: 'weekly',
  itemsPerPage: 20,
};

// ═══════════════════════════════════════════════════════════════════════════
//  Privacy Settings
// ═══════════════════════════════════════════════════════════════════════════

export interface PrivacySettings {
  showProfileToStudents: boolean;
  showEmailToStudents: boolean;
  showPhoneToStudents: boolean;
  allowStudentMessages: boolean;
  shareAnalyticsWithInstitute: boolean;
}

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  showProfileToStudents: true,
  showEmailToStudents: false,
  showPhoneToStudents: false,
  allowStudentMessages: true,
  shareAnalyticsWithInstitute: true,
};

// ═══════════════════════════════════════════════════════════════════════════
//  Session Management
// ═══════════════════════════════════════════════════════════════════════════

export interface SessionSettings {
  rememberMe: boolean;
  autoLogoutMinutes: number;
  loginNotifications: boolean;
}

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  rememberMe: true,
  autoLogoutMinutes: 60,
  loginNotifications: true,
};

// ═══════════════════════════════════════════════════════════════════════════
//  Data & Storage
// ═══════════════════════════════════════════════════════════════════════════

export interface DataStoragePreferences {
  cacheResults: boolean;
  cacheDurationHours: number;
  autoDownloadReports: boolean;
  keepLocalBackups: boolean;
}

export const DEFAULT_DATA_STORAGE: DataStoragePreferences = {
  cacheResults: true,
  cacheDurationHours: 24,
  autoDownloadReports: false,
  keepLocalBackups: false,
};

// ═══════════════════════════════════════════════════════════════════════════
//  Complete Settings
// ═══════════════════════════════════════════════════════════════════════════

export interface TeacherSettings {
  appearance: ThemeMode;
  language: SupportedLanguage;
  timeZone: TimeZone;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  dashboard: DashboardPreferences;
  privacy: PrivacySettings;
  session: SessionSettings;
  dataStorage: DataStoragePreferences;
  connectedAccounts: {
    google: boolean;
    microsoft: boolean;
    zoom: boolean;
  };
  keyboardShortcutsEnabled: boolean;
}

export const DEFAULT_TEACHER_SETTINGS: TeacherSettings = {
  appearance: 'system',
  language: 'en',
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
  dateFormat: 'DD/MM/YYYY',
  timeFormat: '12h',
  dashboard: DEFAULT_DASHBOARD_PREFERENCES,
  privacy: DEFAULT_PRIVACY_SETTINGS,
  session: DEFAULT_SESSION_SETTINGS,
  dataStorage: DEFAULT_DATA_STORAGE,
  connectedAccounts: {
    google: false,
    microsoft: false,
    zoom: false,
  },
  keyboardShortcutsEnabled: true,
};

// ═══════════════════════════════════════════════════════════════════════════
//  Language Options
// ═══════════════════════════════════════════════════════════════════════════

export interface LanguageOption {
  value: SupportedLanguage;
  label: string;
  nativeName: string;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: 'en', label: 'English', nativeName: 'English' },
  { value: 'hi', label: 'Hindi', nativeName: 'हिन्दी' },
  { value: 'gu', label: 'Gujarati', nativeName: 'ગુજરાતી' },
  { value: 'mr', label: 'Marathi', nativeName: 'मराठी' },
  { value: 'bn', label: 'Bengali', nativeName: 'বাংলা' },
  { value: 'ta', label: 'Tamil', nativeName: 'தமிழ்' },
  { value: 'te', label: 'Telugu', nativeName: 'తెలుగు' },
];

// ═══════════════════════════════════════════════════════════════════════════
//  Time Zone Options (common Indian + global)
// ═══════════════════════════════════════════════════════════════════════════

export const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: 'Asia/Kolkata', label: 'India Standard Time (IST) +05:30' },
  { value: 'Asia/Dubai', label: 'Gulf Standard Time (GST) +04:00' },
  { value: 'Asia/Singapore', label: 'Singapore Time (SGT) +08:00' },
  { value: 'America/New_York', label: 'Eastern Time (ET) -05:00' },
  { value: 'America/Chicago', label: 'Central Time (CT) -06:00' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT) -08:00' },
  { value: 'Europe/London', label: 'Greenwich Mean Time (GMT) +00:00' },
  { value: 'Europe/Berlin', label: 'Central European Time (CET) +01:00' },
  { value: 'Australia/Sydney', label: 'Australian Eastern Time (AET) +10:00' },
  { value: 'Pacific/Auckland', label: 'New Zealand Time (NZT) +12:00' },
  { value: 'UTC', label: 'Coordinated Universal Time (UTC)' },
];

export const DATE_FORMAT_OPTIONS: { value: DateFormat; label: string }[] = [
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY (31/12/2025)' },
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY (12/31/2025)' },
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (2025-12-31)' },
];

export const TIME_FORMAT_OPTIONS: { value: TimeFormat; label: string }[] = [
  { value: '12h', label: '12-hour (2:30 PM)' },
  { value: '24h', label: '24-hour (14:30)' },
];
