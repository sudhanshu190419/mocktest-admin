/**
 * Teacher Profile Service
 *
 * Lightweight service layer for teacher profile operations.
 * Leverages existing authService, teacherService, and supabase directly
 * for operations that are not yet covered by existing services.
 *
 * Every public method returns a standardised `ApiResponse<T>` shape.
 *
 * @module services/profileService
 */

import { supabase } from '@/config/supabase';
import { updatePassword } from './authService';
import { extractErrorMessage } from '@/utils/supabase';
import { resolveTeacherIdentity } from './teacherIdentity';
import type { ApiResponse } from '@/types/academic';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
} from '@/types/profile';
import type {
  TeacherProfileData,
  BasicInfo,
  ProfessionalInfo,
  ContactInfo,
  ActivityEvent,
  NotificationPreferences,
} from '@/types/profile';

// ═══════════════════════════════════════════════════════════════════════════
//  Profile Data
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch the full teacher profile by loading from Supabase tables.
 *
 * Accepts either a `TeacherIdentity` (preferred) or individual IDs.
 * When only `teacherId` is provided, the function resolves the identity
 * from the session to get the correct `profileId` for profiles queries.
 */
export async function getFullTeacherProfile(
  teacherId: string,
  instituteId?: string | null,
): Promise<ApiResponse<TeacherProfileData>> {
  try {
    // Resolve identity to get the correct profileId for the profiles table
    const identity = await resolveTeacherIdentity();
    const profileId = identity?.profileId ?? teacherId;
    const resolvedInstituteId = instituteId ?? identity?.instituteId;

    // 1. Fetch profiles table (uses profileId = auth.users.id)
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('profile_id', profileId)
      .single();

    if (profileError && profileError.code !== 'PGRST116') {
      return { success: false, error: extractErrorMessage(profileError) };
    }

    // 2. Fetch teacher_details (uses resolved teacherId, not the passed parameter)
    const resolvedTeacherId = identity?.teacherId ?? teacherId;
    const { data: teacherDetails, error: detailsError } = await supabase
      .from('teacher_details')
      .select('*')
      .eq('teacher_id', resolvedTeacherId)
      .single();

    if (detailsError && detailsError.code !== 'PGRST116') {
      return { success: false, error: extractErrorMessage(detailsError) };
    }

    // 3. Fetch teacher_specializations with subject names
    const { data: specializations } = await supabase
      .from('teacher_specializations')
      .select('*, subjects(name)')
      .eq('teacher_id', teacherId);

    // 4. Fetch assigned batches via batch_teachers
    const { data: batchTeachers } = await supabase
      .from('batch_teachers')
      .select('*, batches(name, stream_id)')
      .eq('teacher_id', teacherId);

    // 5. Fetch institute name if instituteId provided
    let instituteName: string | undefined;
    if (instituteId) {
      const { data: institute } = await supabase
        .from('institutes')
        .select('name')
        .eq('institute_id', instituteId)
        .single();
      instituteName = institute?.name;
    }

    const subjects = specializations?.map((s: any) => s.subjects?.name ?? 'Unknown') ?? [];
    const batches = (batchTeachers ?? []).map((bt: any) => ({
      batchId: bt.batches?.batch_id ?? bt.batch_id ?? '',
      batchName: bt.batches?.name ?? 'Unknown Batch',
      streamName: bt.batches?.stream_id ?? undefined,
      studentCount: 0,
      status: 'active',
    }));

    const professional: ProfessionalInfo = {
      department: teacherDetails?.department ?? 'Not specified',
      designation: teacherDetails?.designation ?? 'Faculty',
      specialization: teacherDetails?.specialization ?? 'General',
      qualification: teacherDetails?.qualification ?? 'Not specified',
      experience: teacherDetails?.experience ?? 'Not specified',
    };

    // Build completion checklist
    const checklist = buildCompletionChecklist(
      profile, teacherDetails, subjects, batches,
    );
    const completedCount = checklist.filter((c) => c.completed).length;
    const completionPercentage = checklist.length > 0
      ? Math.round((completedCount / checklist.length) * 100)
      : 0;

    const profileData: TeacherProfileData = {
      basicInfo: {
        profileId: profileId,
        fullName: profile?.name ?? 'Teacher',
        displayName: profile?.name ?? undefined,
        email: profile?.email ?? '',
        phone: profile?.phone ?? teacherDetails?.phone ?? '',
        avatarUrl: profile?.avatar_url ?? null,
        role: profile?.role ?? 'teacher',
        accountStatus: profile?.account_status ?? 'approved',
        instituteId: resolvedInstituteId ?? profile?.institute_id ?? null,
        instituteName,
        employeeCode: teacherDetails?.employee_code ?? undefined,
        joiningDate: teacherDetails?.joining_date ?? undefined,
        phoneVerified: !!profile?.phone || !!teacherDetails?.phone,
        emailVerified: !!profile?.email,
      },
      professionalInfo: professional,
      teachingInfo: {
        assignedSubjects: subjects,
        assignedBatches: batches,
        assignedStreams: [],
      },
      contactInfo: {
        mobile: profile?.phone ?? teacherDetails?.phone ?? '',
        email: profile?.email ?? '',
      },
      bio: teacherDetails?.bio ?? undefined,
      completionPercentage,
      completionChecklist: checklist,
    };

    return { success: true, data: profileData };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

function buildCompletionChecklist(
  profile: any,
  details: any,
  subjects: string[],
  batches: any[],
): { key: string; label: string; completed: boolean; required: boolean }[] {
  return [
    { key: 'photo', label: 'Profile Photo', completed: !!profile?.avatar_url, required: true },
    { key: 'name', label: 'Full Name', completed: !!profile?.name, required: true },
    { key: 'phone', label: 'Phone Number', completed: !!profile?.phone || !!details?.phone, required: true },
    { key: 'email', label: 'Email Address', completed: !!profile?.email, required: true },
    { key: 'qualification', label: 'Qualification', completed: !!details?.qualification && details.qualification !== 'Not specified', required: true },
    { key: 'bio', label: 'Biography', completed: !!details?.bio, required: false },
    { key: 'specialization', label: 'Specialization', completed: !!details?.specialization && details.specialization !== 'General', required: true },
    { key: 'subjects', label: 'Assigned Subjects', completed: subjects.length > 0, required: true },
    { key: 'batches', label: 'Assigned Batches', completed: batches.length > 0, required: true },
    { key: 'experience', label: 'Experience Details', completed: !!details?.experience && details.experience !== 'Not specified', required: false },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
//  Profile Update
// ═══════════════════════════════════════════════════════════════════════════

interface UpdateProfileInput {
  fullName?: string;
  displayName?: string;
  bio?: string;
  qualification?: string;
  experience?: string;
  specialization?: string;
  department?: string;
  designation?: string;
  linkedIn?: string;
  website?: string;
  portfolio?: string;
}

/**
 * Update teacher profile information.
 *
 * Updates both:
 * - `profiles` table (using `profileId` = `auth.users.id`)
 * - `teacher_details` table (using `teacherId` = `teacher_details.teacher_id`)
 *
 * @param teacherId - The `teacher_details.teacher_id`. The `profileId` is resolved
 *                    from the session to ensure the correct profiles row is updated.
 */
export async function updateTeacherProfile(
  teacherId: string,
  input: UpdateProfileInput,
): Promise<ApiResponse<null>> {
  try {
    // Resolve identity to get the correct profileId for the profiles table
    const identity = await resolveTeacherIdentity();
    if (!identity) {
      return { success: false, error: 'No teacher identity found. Ensure you are logged in.' };
    }

    // Update profiles table (uses profileId = auth.users.id = profiles.profile_id)
    // Note: phone is intentionally excluded — it is fixed and not editable by teachers.
    const profileUpdates: Record<string, string> = {};
    if (input.fullName !== undefined) profileUpdates.name = input.fullName;

    if (Object.keys(profileUpdates).length > 0) {
      const { error: profileError } = await supabase
        .from('profiles')
        .update(profileUpdates)
        .eq('profile_id', identity.profileId);

      if (profileError) {
        return { success: false, error: extractErrorMessage(profileError) };
      }
    }

    // Update teacher_details table (uses teacherId = teacher_details.teacher_id)
    const detailsUpdates: Record<string, any> = {};
    if (input.bio !== undefined) detailsUpdates.bio = input.bio;
    if (input.qualification !== undefined) detailsUpdates.qualification = input.qualification;
    if (input.experience !== undefined) detailsUpdates.experience = input.experience;
    if (input.specialization !== undefined) detailsUpdates.specialization = input.specialization;
    if (input.department !== undefined) detailsUpdates.department = input.department;
    if (input.designation !== undefined) detailsUpdates.designation = input.designation;
    if (Object.keys(detailsUpdates).length > 0) {
      const { error: detailsError } = await supabase
        .from('teacher_details')
        .update(detailsUpdates)
        .eq('teacher_id', identity.teacherId);

      if (detailsError) {
        return { success: false, error: extractErrorMessage(detailsError) };
      }
    }

    return { success: true, data: null };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Upload a profile avatar/photo.
 */
export async function uploadProfileAvatar(
  teacherId: string,
  file: File,
): Promise<ApiResponse<string>> {
  try {
    const fileExt = file.name.split('.').pop();
    const filePath = `avatars/teacher_${teacherId}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from('profiles')
      .upload(filePath, file, { upsert: true });

    if (uploadError) {
      return { success: false, error: extractErrorMessage(uploadError) };
    }

    const { data: urlData } = supabase.storage
      .from('profiles')
      .getPublicUrl(filePath);

    const publicUrl = urlData?.publicUrl ?? '';

    // Resolve identity to get the correct profileId for the profiles table
    const identity = await resolveTeacherIdentity();
    const profileId = identity?.profileId ?? teacherId;

    // Update profile with new avatar URL (uses profileId, not teacherId)
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_url: publicUrl })
      .eq('profile_id', profileId);

    if (updateError) {
      return { success: false, error: extractErrorMessage(updateError) };
    }

    return { success: true, data: publicUrl };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Activity Timeline
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get teacher account activity timeline.
 * Uses existing mock_tests, questions, notifications tables
 * to build a chronological activity feed.
 */
export async function getTeacherActivity(
  teacherId: string,
): Promise<ApiResponse<ActivityEvent[]>> {
  try {
    const events: ActivityEvent[] = [];

    // Mock tests created by this teacher
    const { data: tests } = await supabase
      .from('mock_tests')
      .select('test_id, title, created_at')
      .eq('created_by', teacherId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (tests) {
      for (const test of tests) {
        events.push({
          id: `test-${test.test_id}`,
          type: 'mock_test_created',
          title: 'Mock Test Created',
          description: `Created test: ${test.title}`,
          timestamp: test.created_at,
          metadata: { testId: test.test_id },
        });
      }
    }

    // Questions added
    const { data: questions } = await supabase
      .from('questions')
      .select('question_id, question_text, created_at')
      .eq('created_by', teacherId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (questions) {
      for (const q of questions) {
        events.push({
          id: `q-${q.question_id}`,
          type: 'question_added',
          title: 'Question Added',
          description: `Added question: ${(q.question_text ?? '').slice(0, 80)}`,
          timestamp: q.created_at,
          metadata: { questionId: q.question_id },
        });
      }
    }

    // Notifications sent
    const { data: notifications } = await supabase
      .from('notifications')
      .select('notification_id, title, created_at')
      .eq('created_by', teacherId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (notifications) {
      for (const n of notifications) {
        events.push({
          id: `notif-${n.notification_id}`,
          type: 'notification_sent',
          title: 'Notification Sent',
          description: `Sent: ${n.title}`,
          timestamp: n.created_at,
          metadata: { notificationId: n.notification_id },
        });
      }
    }

    // Results released (from mock_results)
    const { data: results } = await supabase
      .from('mock_results')
      .select('result_id, generated_at')
      .eq('test_id', '')
      .order('generated_at', { ascending: false })
      .limit(20);

    // Profile updates from auth logs (placeholder — uses teacher_details updated_at)
    const { data: details } = await supabase
      .from('teacher_details')
      .select('updated_at, teacher_id')
      .eq('teacher_id', teacherId)
      .single();

    if (details?.updated_at) {
      events.push({
        id: 'profile-last-update',
        type: 'profile_update',
        title: 'Profile Updated',
        description: 'Teacher profile information was updated',
        timestamp: details.updated_at,
      });
    }

    // Sort all events by timestamp descending
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return { success: true, data: events.slice(0, 100) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Notification Preferences
// ═══════════════════════════════════════════════════════════════════════════

const NOTIFICATION_PREFS_KEY = 'EDTECH_NOTIFICATION_PREFS';

export function getNotificationPreferences(): NotificationPreferences {
  if (typeof window === 'undefined') {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }
  try {
    const stored = localStorage.getItem(NOTIFICATION_PREFS_KEY);
    if (stored) {
      return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...JSON.parse(stored) };
    }
  } catch {
    // ignore parse errors
  }
  return DEFAULT_NOTIFICATION_PREFERENCES;
}

export function saveNotificationPreferences(
  prefs: NotificationPreferences,
): ApiResponse<null> {
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify(prefs));
    }
    return { success: true, data: null };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

