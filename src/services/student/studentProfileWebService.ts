/**
 * Student Profile Web Service
 *
 * Dedicated service layer for the Student Web Profile & Account page.
 * Maintains behavioral parity with the mobile app (MockTestApp PersonalInfoScreen & ProfileTabScreen).
 *
 * Capabilities:
 *   - Fetches authoritative student profile, institute, student_details, active batches, and enrolled courses.
 *   - Scoped strictly to authenticated student (auth.uid()).
 *   - Safely updates supported editable fields (name, phone) on public.profiles.
 *   - Updates student account password via supabase.auth.updateUser.
 *   - Provides clean neutral fallbacks for missing or unpopulated fields.
 *
 * @module services/student/studentProfileWebService
 */

import { supabase } from '@/config/supabase';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface StudentActiveBatchItem {
  batchId: string;
  name: string;
  batchCode: string;
  streamName?: string;
}

export interface StudentEnrolledCourseItem {
  courseId: string;
  title: string;
  thumbnailUrl?: string | null;
  category?: string;
  enrolledAt?: string | null;
  source?: string;
}

export interface StudentFullProfile {
  profileId: string;
  name: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  role: string;
  isActive: boolean;
  createdAt: string;

  // Institute details
  instituteId: string | null;
  instituteName: string | null;
  instituteCode: string | null;

  // Student details (Domain 01 / Domain 14)
  studentId: string | null;
  enrollmentNo: string | null;
  dob: string | null;
  targetYear: string | null;
  enrolledOn: string | null;

  // Guardian details (Domain 01 / 040 migration)
  guardianName: string | null;
  guardianMobile: string | null;
  guardianEmail: string | null;

  // Academic stream / target exam
  streamId: string | null;
  streamName: string | null;

  // Enrollments
  activeBatches: StudentActiveBatchItem[];
  enrolledCourses: StudentEnrolledCourseItem[];
}

export interface UpdatePersonalInfoInput {
  name: string;
  phone?: string | null;
}

export interface InitiatePhoneChangeInput {
  newPhone: string;
  currentPassword: string;
  currentPhone?: string | null;
  currentEmail?: string | null;
}

export interface VerifyPhoneChangeOtpInput {
  userId: string;
  newPhone: string;
  token: string;
}

export interface ServiceResult<T> {
  data: T | null;
  error: string | null;
}

/**
 * Normalizes phone number into standard E.164 format (+91XXXXXXXXXX by default for 10-digit Indian numbers).
 */
export function normalizePhoneNumber(rawPhone: string): string {
  const trimmed = rawPhone.trim().replace(/[\s-]/g, '');
  if (!trimmed) return '';

  if (trimmed.startsWith('+')) {
    return trimmed;
  }

  // 10-digit number assumed to be India (+91)
  if (/^\d{10}$/.test(trimmed)) {
    return `+91${trimmed}`;
  }

  // If already starts with 91 followed by 10 digits
  if (/^91\d{10}$/.test(trimmed)) {
    return `+${trimmed}`;
  }

  return trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
}

// ─── Service Methods ────────────────────────────────────────────────────────

/**
 * Fetches the complete student profile from Supabase.
 * Integrates get_home_screen_bootstrap with direct public.profiles / student_details / institutes queries.
 */
export async function fetchStudentFullProfile(userId?: string): Promise<ServiceResult<StudentFullProfile>> {
  try {
    let resolvedUserId = userId;
    let authUserPhone: string | null = null;

    // Get current auth user session
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userData?.user) {
      if (!resolvedUserId) {
        resolvedUserId = userData.user.id;
      }
      if (userData.user.id === resolvedUserId) {
        authUserPhone = userData.user.phone || null;
      }
    } else if (!resolvedUserId) {
      return { data: null, error: 'User session not found. Please log in again.' };
    }

    // 1. Fetch bootstrap for composite batches, courses, stream
    let bootstrapData: any = null;
    try {
      const { data: bData } = await supabase.rpc('get_home_screen_bootstrap');
      if (bData && typeof bData === 'object' && bData.success !== false) {
        bootstrapData = bData;
      }
    } catch {
      // Non-fatal, fallback to direct queries below
    }

    // 2. Fetch direct profile record
    const { data: profileRow, error: profileError } = await supabase
      .from('profiles')
      .select('profile_id, institute_id, name, email, phone, avatar_url, role, is_active, created_at, selected_stream_id')
      .eq('profile_id', resolvedUserId)
      .maybeSingle();

    if (profileError || !profileRow) {
      return {
        data: null,
        error: profileError?.message || 'Student profile not found in database.',
      };
    }

    // Auto-heal profiles.phone if authUserPhone exists and differs from profiles.phone
    if (authUserPhone && profileRow.phone !== authUserPhone) {
      Promise.resolve(
        supabase
          .from('profiles')
          .update({
            phone: authUserPhone,
            updated_at: new Date().toISOString(),
          })
          .eq('profile_id', resolvedUserId)
      )
        .then(({ error: healError }) => {
          if (healError) {
            console.warn('[studentProfileWebService] Auto-heal profiles.phone notice:', healError.message);
          }
        })
        .catch(() => {});
    }

    // 3. Fetch institute details if institute_id exists
    let instituteName: string | null = null;
    let instituteCode: string | null = null;

    if (profileRow.institute_id) {
      const { data: instData } = await supabase
        .from('institutes')
        .select('name, code')
        .eq('institute_id', profileRow.institute_id)
        .maybeSingle();

      if (instData) {
        instituteName = instData.name || null;
        instituteCode = instData.code || null;
      }
    }

    // 4. Fetch student_details (enrollment_no, dob, target_year, guardian info)
    let studentId: string | null = null;
    let enrollmentNo: string | null = null;
    let dob: string | null = null;
    let targetYear: string | null = null;
    let enrolledOn: string | null = null;
    let guardianName: string | null = null;
    let guardianMobile: string | null = null;
    let guardianEmail: string | null = null;
    let studentStreamId: string | null = null;

    const { data: studentDetails } = await supabase
      .from('student_details')
      .select('student_id, enrollment_no, dob, target_year, enrolled_on, guardian_name, guardian_mobile, guardian_email, selected_stream_id')
      .eq('profile_id', resolvedUserId)
      .maybeSingle();

    if (studentDetails) {
      studentId = studentDetails.student_id || null;
      enrollmentNo = studentDetails.enrollment_no || null;
      dob = studentDetails.dob || null;
      targetYear = studentDetails.target_year || null;
      enrolledOn = studentDetails.enrolled_on || null;
      guardianName = studentDetails.guardian_name || null;
      guardianMobile = studentDetails.guardian_mobile || null;
      guardianEmail = studentDetails.guardian_email || null;
      studentStreamId = studentDetails.selected_stream_id || null;
    }

    // 5. Resolve stream name
    const effectiveStreamId = profileRow.selected_stream_id || studentStreamId || bootstrapData?.stream_id || null;
    let streamName: string | null = bootstrapData?.selected_stream?.name || null;

    if (!streamName && effectiveStreamId) {
      const { data: streamData } = await supabase
        .from('streams')
        .select('name')
        .eq('stream_id', effectiveStreamId)
        .maybeSingle();

      if (streamData) {
        streamName = streamData.name || null;
      }
    }

    // 6. Resolve active batches
    const rawBatches: any[] = bootstrapData?.active_batches || [];
    const activeBatches: StudentActiveBatchItem[] = rawBatches.map((b) => ({
      batchId: b.batch_id,
      name: b.name || 'Batch',
      batchCode: b.batch_code || '--',
      streamName: b.stream_name || streamName || undefined,
    }));

    // 7. Resolve enrolled courses
    const rawCourses: any[] = bootstrapData?.enrolled_courses || [];
    const enrolledCourses: StudentEnrolledCourseItem[] = rawCourses.map((c) => ({
      courseId: c.course_id,
      title: c.title || 'Course',
      thumbnailUrl: c.thumbnail_path || c.thumbnail_url || null,
      category: c.category || c.stream_name || streamName || 'Academic Course',
      enrolledAt: c.enrolled_at || null,
      source: c.source || 'direct',
    }));

    const result: StudentFullProfile = {
      profileId: profileRow.profile_id,
      name: profileRow.name || 'Student',
      email: profileRow.email || '',
      phone: authUserPhone ?? profileRow.phone ?? null,
      avatarUrl: profileRow.avatar_url || null,
      role: profileRow.role || 'student',
      isActive: profileRow.is_active ?? true,
      createdAt: profileRow.created_at || new Date().toISOString(),

      instituteId: profileRow.institute_id || null,
      instituteName,
      instituteCode,

      studentId,
      enrollmentNo,
      dob,
      targetYear,
      enrolledOn,

      guardianName,
      guardianMobile,
      guardianEmail,

      streamId: effectiveStreamId,
      streamName,

      activeBatches,
      enrolledCourses,
    };

    return { data: result, error: null };
  } catch (err: any) {
    console.error('[studentProfileWebService] Failed to fetch student full profile:', err);
    return { data: null, error: err?.message || 'An unexpected error occurred while loading profile.' };
  }
}

/**
 * Updates editable student personal information (name, phone) on public.profiles.
 * Reuses the exact update contract from mobile PersonalInfoScreen.tsx.
 */
export async function updateStudentPersonalInfo(
  userId: string,
  input: UpdatePersonalInfoInput
): Promise<ServiceResult<{ name: string; phone: string | null }>> {
  try {
    const trimmedName = input.name.trim();
    if (!trimmedName) {
      return { data: null, error: 'Full name cannot be empty.' };
    }

    const updatePayload: Record<string, any> = {
      name: trimmedName,
      updated_at: new Date().toISOString(),
    };

    let resolvedPhone: string | null | undefined = undefined;
    if (input.phone !== undefined) {
      const trimmedPhone = input.phone?.trim() || null;
      if (trimmedPhone && !/^\+?[0-9\s-]{7,20}$/.test(trimmedPhone)) {
        return { data: null, error: 'Please provide a valid phone number.' };
      }
      updatePayload.phone = trimmedPhone;
      resolvedPhone = trimmedPhone;
    }

    const { error: updateError } = await supabase
      .from('profiles')
      .update(updatePayload)
      .eq('profile_id', userId);

    if (updateError) {
      return { data: null, error: updateError.message || 'Failed to update profile information.' };
    }

    return {
      data: {
        name: trimmedName,
        phone: resolvedPhone !== undefined ? resolvedPhone : null,
      },
      error: null,
    };
  } catch (err: any) {
    console.error('[studentProfileWebService] Error updating personal info:', err);
    return { data: null, error: err?.message || 'Failed to update personal info.' };
  }
}

/**
 * Updates the student's password using Supabase Auth.
 */
export async function updateStudentPassword(password: string): Promise<ServiceResult<boolean>> {
  try {
    if (!password || password.length < 6) {
      return { data: null, error: 'Password must be at least 6 characters long.' };
    }

    const { error } = await supabase.auth.updateUser({
      password,
    });

    if (error) {
      return { data: null, error: error.message || 'Failed to update password.' };
    }

    return { data: true, error: null };
  } catch (err: any) {
    console.error('[studentProfileWebService] Error updating password:', err);
    return { data: null, error: err?.message || 'Failed to update password.' };
  }
}

/**
 * Initiates a secure Mobile Number Change flow.
 * 1. Re-authenticates current password to ensure user ownership.
 * 2. Formats and validates the new phone number.
 * 3. Triggers Supabase auth.updateUser({ phone: newPhone }), which sends an SMS OTP to the new number.
 */
export async function initiatePhoneChange(
  input: InitiatePhoneChangeInput
): Promise<ServiceResult<boolean>> {
  try {
    const { currentPassword, newPhone, currentPhone, currentEmail } = input;

    if (!currentPassword?.trim()) {
      return { data: null, error: 'Current password is required to change mobile number.' };
    }

    const formattedNewPhone = normalizePhoneNumber(newPhone);
    const phoneRegex = /^\+[1-9]\d{6,14}$/;
    if (!phoneRegex.test(formattedNewPhone)) {
      return {
        data: null,
        error: 'Please enter a valid 10-digit mobile number with country code (e.g. +919876543210).',
      };
    }

    const formattedCurrentPhone = currentPhone ? normalizePhoneNumber(currentPhone) : null;
    if (formattedCurrentPhone && formattedCurrentPhone === formattedNewPhone) {
      return { data: null, error: 'New mobile number cannot be the same as your current mobile number.' };
    }

    // 1. Re-authenticate current password
    let reauthSuccess = false;

    // Try current phone first if available
    if (formattedCurrentPhone) {
      const { error: phoneAuthError } = await supabase.auth.signInWithPassword({
        phone: formattedCurrentPhone,
        password: currentPassword,
      });
      if (!phoneAuthError) {
        reauthSuccess = true;
      }
    }

    // If phone auth did not succeed and email is available, try email
    if (!reauthSuccess && currentEmail) {
      const { error: emailAuthError } = await supabase.auth.signInWithPassword({
        email: currentEmail,
        password: currentPassword,
      });
      if (!emailAuthError) {
        reauthSuccess = true;
      }
    }

    if (!reauthSuccess) {
      return { data: null, error: 'Incorrect current password. Please try again.' };
    }

    // 2. Request phone change via Supabase Auth (sends OTP to newPhone)
    const { error: updateError } = await supabase.auth.updateUser({
      phone: formattedNewPhone,
    });

    if (updateError) {
      const msg = updateError.message || '';
      if (
        (updateError as any).code === 'phone_exists' ||
        msg.toLowerCase().includes('already exists') ||
        msg.toLowerCase().includes('already registered')
      ) {
        return {
          data: null,
          error: 'This mobile number is already registered to another account.',
        };
      }
      return { data: null, error: msg || 'Failed to send OTP to new mobile number.' };
    }

    return { data: true, error: null };
  } catch (err: any) {
    console.error('[studentProfileWebService] Error initiating phone change:', err);
    return { data: null, error: err?.message || 'Failed to initiate mobile number change.' };
  }
}

/**
 * Resends the SMS OTP for the pending phone change to the new mobile number.
 */
export async function resendPhoneChangeOtp(newPhone: string): Promise<ServiceResult<boolean>> {
  try {
    const formattedNewPhone = normalizePhoneNumber(newPhone);
    const { error } = await supabase.auth.updateUser({
      phone: formattedNewPhone,
    });

    if (error) {
      return { data: null, error: error.message || 'Failed to resend OTP. Please try again shortly.' };
    }

    return { data: true, error: null };
  } catch (err: any) {
    console.error('[studentProfileWebService] Error resending phone change OTP:', err);
    return { data: null, error: err?.message || 'Failed to resend OTP.' };
  }
}

/**
 * Verifies the OTP sent to the new mobile number during phone change.
 * On success:
 * 1. Supabase auth updates auth.users.phone.
 * 2. Synchronizes public.profiles.phone for the user.
 */
export async function verifyPhoneChangeOtp(
  input: VerifyPhoneChangeOtpInput
): Promise<ServiceResult<{ phone: string }>> {
  try {
    const { userId, newPhone, token } = input;
    const formattedNewPhone = normalizePhoneNumber(newPhone);
    const trimmedToken = token.trim();

    if (!trimmedToken || trimmedToken.length < 4 || trimmedToken.length > 8) {
      return { data: null, error: 'Please enter a valid OTP code.' };
    }

    // 1. Verify OTP with Supabase Auth using type: 'phone_change'
    const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
      phone: formattedNewPhone,
      token: trimmedToken,
      type: 'phone_change',
    });

    if (verifyError || !verifyData?.user) {
      return {
        data: null,
        error: verifyError?.message || 'Invalid or expired OTP. Please check the code and try again.',
      };
    }

    // 2. Synchronize public.profiles.phone
    const resolvedUserId = userId || verifyData.user.id;
    const verifiedAuthPhone = verifyData.user.phone || formattedNewPhone;

    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        phone: verifiedAuthPhone,
        updated_at: new Date().toISOString(),
      })
      .eq('profile_id', resolvedUserId);

    if (profileError) {
      console.error('[studentProfileWebService] Profile phone sync error:', profileError.message);
      return {
        data: null,
        error: `Mobile number verified in auth, but failed to sync profile: ${profileError.message}`,
      };
    }

    return {
      data: {
        phone: verifiedAuthPhone,
      },
      error: null,
    };
  } catch (err: any) {
    console.error('[studentProfileWebService] Error verifying phone change OTP:', err);
    return { data: null, error: err?.message || 'Failed to verify OTP.' };
  }
}
