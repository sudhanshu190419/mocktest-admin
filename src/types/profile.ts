/**
 * Teacher Profile Module Types
 *
 * Extends existing auth and teacher types with profile-specific data
 * structures for the Teacher Profile module.
 *
 * @module types/profile
 */

import type { UserProfile, AccountStatus } from './auth';

// ═══════════════════════════════════════════════════════════════════════════
//  Teacher Profile (Extended)
// ═══════════════════════════════════════════════════════════════════════════

export interface TeacherProfileData {
  /** Core identity (merged from auth + profile table) */
  basicInfo: BasicInfo;
  /** Professional details */
  professionalInfo: ProfessionalInfo;
  /** Teaching details */
  teachingInfo: TeachingInfo;
  /** Contact info */
  contactInfo: ContactInfo;
  /** Biography */
  bio?: string;
  /** Profile completion percentage (0–100) */
  completionPercentage: number;
  /** Profile completion checklist */
  completionChecklist: CompletionChecklistItem[];
}

export interface BasicInfo {
  profileId: string;
  fullName: string;
  displayName?: string;
  email: string;
  phone: string;
  avatarUrl: string | null;
  role: string;
  /** Account lifecycle status from profiles.account_status */
  accountStatus: AccountStatus;
  instituteId: string | null;
  instituteName?: string;
  employeeCode?: string;
  joiningDate?: string;
  /** Whether phone is verified */
  phoneVerified: boolean;
  /** Whether email is verified */
  emailVerified: boolean;
}

export interface ProfessionalInfo {
  department: string;
  designation: string;
  specialization: string;
  qualification: string;
  experience: string;
}

export interface TeachingInfo {
  assignedSubjects: string[];
  assignedBatches: BatchInfo[];
  assignedStreams: string[];
}

export interface BatchInfo {
  batchId: string;
  batchName: string;
  streamName?: string;
  studentCount?: number;
  status?: string;
}

export interface ContactInfo {
  mobile: string;
  email: string;
  linkedIn?: string;
  website?: string;
  portfolio?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Profile Completion
// ═══════════════════════════════════════════════════════════════════════════

export interface CompletionChecklistItem {
  key: string;
  label: string;
  completed: boolean;
  required: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Account Activity
// ═══════════════════════════════════════════════════════════════════════════

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  title: string;
  description: string;
  timestamp: string;
  metadata?: Record<string, string | number>;
}

export type ActivityEventType =
  | 'login'
  | 'password_change'
  | 'profile_update'
  | 'mock_test_created'
  | 'question_added'
  | 'notification_sent'
  | 'result_released'
  | 'account_update'
  | 'batch_assigned'
  | 'other';

// ═══════════════════════════════════════════════════════════════════════════
//  Security
// ═══════════════════════════════════════════════════════════════════════════

export interface SecurityInfo {
  passwordLastChanged: string | null;
  mfaEnabled: boolean;
  activeSessions: ActiveSession[];
  recentDevices: RecentDevice[];
}

export interface ActiveSession {
  id: string;
  deviceName: string;
  browser: string;
  os: string;
  ipAddress: string;
  location?: string;
  lastActive: string;
  isCurrent: boolean;
}

export interface RecentDevice {
  id: string;
  deviceName: string;
  browser: string;
  os: string;
  lastUsed: string;
  isTrusted: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Notification Preferences
// ═══════════════════════════════════════════════════════════════════════════

export interface NotificationPreferences {
  inApp: boolean;
  email: boolean;
  sms: boolean;
  mockTestAlerts: boolean;
  resultAlerts: boolean;
  studentActivityAlerts: boolean;
  liveClassAlerts: boolean;
  marketingNotifications: boolean;
}

export interface NotificationPreferenceItem {
  key: keyof NotificationPreferences;
  label: string;
  description: string;
  category: 'channel' | 'alert' | 'marketing';
}

export const NOTIFICATION_PREFERENCE_ITEMS: NotificationPreferenceItem[] = [
  { key: 'inApp', label: 'In-App Notifications', description: 'Receive notifications within the application', category: 'channel' },
  { key: 'email', label: 'Email Notifications', description: 'Receive notifications via email', category: 'channel' },
  { key: 'sms', label: 'SMS Notifications', description: 'Receive notifications via SMS', category: 'channel' },
  { key: 'mockTestAlerts', label: 'Mock Test Alerts', description: 'Get notified when mock tests are created or updated', category: 'alert' },
  { key: 'resultAlerts', label: 'Result Alerts', description: 'Get notified when test results are released', category: 'alert' },
  { key: 'studentActivityAlerts', label: 'Student Activity Alerts', description: 'Get notified about important student activity', category: 'alert' },
  { key: 'liveClassAlerts', label: 'Live Class Alerts', description: 'Get notified about upcoming live classes', category: 'alert' },
  { key: 'marketingNotifications', label: 'Marketing Notifications', description: 'Receive product updates and announcements', category: 'marketing' },
];

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  inApp: true,
  email: true,
  sms: false,
  mockTestAlerts: true,
  resultAlerts: true,
  studentActivityAlerts: true,
  liveClassAlerts: true,
  marketingNotifications: false,
};
