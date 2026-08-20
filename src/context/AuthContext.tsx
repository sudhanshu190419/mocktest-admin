import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { AuthError, PostgrestError } from '@supabase/supabase-js';
import { supabase } from '@/config/supabase';
import { EMPTY_TEACHER } from '@/data/mockData';
import { setCachedIdentity, clearTeacherIdentityCache } from '@/services/teacherIdentity';
import type { TeacherProfile } from '@/data/mockData';
import type { AdminRoleAssignment, DbAdminRole } from '@/types/adminRoles';
import { trustedDeviceService } from '@/services/security/trustedDeviceService';
import { computeDeviceFingerprint } from '@/services/security/fingerprintService';
import {
  clearStoredDeviceToken,
  getStoredDeviceToken,
  storeDeviceToken,
} from '@/lib/trustedDeviceCookie';
import {
  isBlockingDeviceStatus,
} from '@/types/trustedDevice';
import type {
  DeviceCheckState,
  DeviceInfo,
  DeviceTrustStatus,
} from '@/types/trustedDevice';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  teacherProfile: TeacherProfile | null;
  instituteId: string | null;
  loading: boolean;
  needsOtpVerification: boolean;
  pendingPhone: string | null;
  signIn: (phone: string, pass: string) => Promise<{ error: string | null }>;
  registerTeacher: (phone: string, pass: string, facultyId: string, fullName: string, department: string) => Promise<{ error: string | null }>;
  verifyRegistrationOtp: (token: string) => Promise<{ error: string | null }>;
  resendRegistrationOtp: () => Promise<{ error: string | null }>;
  cancelOtpVerification: () => void;
  signOut: () => Promise<void>;
  updateSpecialization: (specialization: string) => void;
  completeOnboarding: (onboardingData: { qualification: string; institution: string; year: string; accountHolder: string; bankName: string; accountNumber: string; ifscCode: string; }) => Promise<void>;
  skipOnboarding: () => void;

  // ── Trusted Device (Phase 7D) ──────────────────────────────────────
  deviceStatus: DeviceCheckState;
  deviceInfo: DeviceInfo | null;
  refreshDeviceStatus: () => Promise<void>;
  requestNewDeviceApproval: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [teacherProfile, setTeacherProfile] = useState<TeacherProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [instituteId, setInstituteId] = useState<string | null>(null);

  // Trusted Device state (Phase 7D). Defaults to 'bypass' (non-blocking)
  // so teachers / students / super admins are unaffected.
  const [deviceStatus, setDeviceStatus] = useState<DeviceCheckState>('bypass');
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);

  // In-flight guard for the trusted-device CHALLENGE phase only (Bug 1 fix):
  // signIn(), the onAuthStateChange handler and React Strict Mode can all fire
  // evaluateDeviceTrust() for the same login. A shared in-flight promise
  // coalesces them into ONE challengeDevice() call → one pending row.
  // RACE FIX: the ref covers ONLY the challenge — it is cleared as soon as
  // the challenge settles (not while deviceInfo loads), so a duplicate load
  // can never hang onto a completed challenge.
  const deviceChallengeInFlightRef = useRef<Promise<void> | null>(null);

  // In-flight guard for profile loading (Bug 1 fix): signIn() AND the
  // onAuthStateChange handler both trigger loadTeacherProfileDetails for the
  // same login. Only the first invocation proceeds.
  const profileLoadInFlightRef = useRef<string | null>(null);

  // RACE FIX: records the userId whose device trust has been evaluated (or is
  // currently being evaluated) so duplicate profile loads cannot restart the
  // verification. Reset on sign-out so a new login re-evaluates the device.
  const deviceEvaluatedRef = useRef<string | null>(null);

  // ═══════════════════════════════════════════════════════════════════════
  //  TEMPORARY DEVICE DEBUG LOGGING — remove after diagnosis
  // ═══════════════════════════════════════════════════════════════════════
  // Logs every deviceStatus / deviceInfo transition so the stuck-spinner
  // issue (never leaves 'checking') can be traced in the browser console.
  useEffect(() => {
    console.log('[TD-state] deviceStatus =', deviceStatus, '| deviceInfo =', deviceInfo);
  }, [deviceStatus, deviceInfo]);

  // OTP Verification State
  const [needsOtpVerification, setNeedsOtpVerification] = useState(false);
  const [pendingPhone, setPendingPhone] = useState<string | null>(null);
  const [pendingRegistration, setPendingRegistration] = useState<{
    phone: string;
    password: string;
    facultyId: string;
    fullName: string;
    department: string;
  } | null>(null);

  // ─── Error Extraction ────────────────────────────────────────────────

  /**
   * Safely extracts a human-readable message from any error value.
   * Normalises AuthError, PostgrestError, and plain Error instances.
   */
  const extractErrorMessage = (error: unknown): string => {
    if (error instanceof AuthError) {
      return error.message;
    }
    if (error instanceof PostgrestError) {
      return error.message;
    }
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'object' && error !== null) {
      const obj = error as Record<string, unknown>;
      if (typeof obj.message === 'string') {
        return obj.message;
      }
      // Fallback: stringify the error object itself
      try {
        return JSON.stringify(error);
      } catch {
        return String(error);
      }
    }
    return String(error) || 'An unexpected authentication error occurred.';
  };

  // ─── Trusted Device helpers (Phase 7D) ───────────────────────────────

  /**
   * Best-effort human-readable device name derived from the User-Agent.
   * Sent to the device-challenge edge function as `deviceName`.
   */
  const deriveDeviceName = (): string => {
    if (typeof navigator === 'undefined') return 'Unknown device';
    const ua = navigator.userAgent;
    const os = /Windows/i.test(ua)
      ? 'Windows'
      : /Mac OS X/i.test(ua)
        ? 'macOS'
        : /Android/i.test(ua)
          ? 'Android'
          : /iPhone|iPad/i.test(ua)
            ? 'iOS'
            : /Linux/i.test(ua)
              ? 'Linux'
              : 'Unknown OS';
    const browser = /Edg\//i.test(ua)
      ? 'Edge'
      : /Chrome\//i.test(ua)
        ? 'Chrome'
        : /Firefox\//i.test(ua)
          ? 'Firefox'
          : /Safari/i.test(ua)
            ? 'Safari'
            : 'Browser';
    return `${browser} on ${os}`;
  };

  /**
   * Evaluate whether the authenticated user's device is trusted.
   *
   * Runs AFTER the Supabase session + profile + admin roles are loaded.
   *
   * Rules (client-side short-circuit; the edge function re-enforces):
   *   - non-admin (teacher, student)                   → bypass
   *   - admin with approved super_admin role             → bypass
   *   - academic / finance admin                         → challenge
   *
   * For challengers, reads the `td_device` cookie token (if present), calls
   * the edge function, persists any newly minted token, and stores the
   * resolved status + device info for the guards / status screens.
   *
   * @param role       - The profile role (profiles.role).
   * @param adminRoles - The admin role assignments (Domain 18).
   */
  const evaluateDeviceTrust = async (
    role: string | undefined,
    adminRoles: AdminRoleAssignment[] | undefined,
    options?: { forceNewRequest?: boolean },
  ): Promise<void> => {
    // TEMP DEBUG: entry point
    console.log('[TD-eval] ENTER evaluateDeviceTrust', {
      role,
      approvedRoles: (adminRoles ?? []).filter((r) => r.accessStatus === 'approved').map((r) => r.adminRole),
      inFlightRefSet: Boolean(deviceChallengeInFlightRef.current),
    });

    // Non-admins always bypass the device system.
    if (role !== 'admin') {
      console.log('[TD-eval] → bypass (non-admin)');
      setDeviceStatus('bypass');
      setDeviceInfo(null);
      return;
    }

    const approvedRoles = (adminRoles ?? [])
      .filter((r) => r.accessStatus === 'approved')
      .map((r) => r.adminRole);

    // Super admins bypass the approval workflow entirely.
    if (approvedRoles.includes('super_admin')) {
      console.log('[TD-eval] → bypass (super_admin)');
      setDeviceStatus('bypass');
      setDeviceInfo(null);
      return;
    }

    // Academic / Finance admin — run the challenge.
    // Coalesce concurrent executions (Bug 1 fix): signIn(), the
    // onAuthStateChange handler and React Strict Mode can all fire this for
    // the same login. A shared in-flight promise guarantees a single
    // challengeDevice() call → a single pending row.
    if (deviceChallengeInFlightRef.current) {
      console.log('[TD-eval] → COALESCED into existing in-flight challenge (no new challenge)');
      return deviceChallengeInFlightRef.current;
    }

    // If already showing a blocking status screen (e.g. a 60s auto-refresh),
    // keep that status visible instead of flashing the 'checking' spinner.
    setDeviceStatus((prev) => {
      console.log('[TD-eval] setDeviceStatus BEFORE challenge →', isBlockingDeviceStatus(prev) ? prev : 'checking', '(prev =', prev + ')');
      return isBlockingDeviceStatus(prev) ? prev : 'checking';
    });

    // Phase 7E: compute the machine fingerprint ONCE per evaluation and reuse
    // it for every retry in this challenge. Best-effort — a null fingerprint
    // (fingerprint generation failed) must never block login; the token path
    // still works and the edge function simply skips fingerprint lookup.
    const fingerprint = await computeDeviceFingerprint();
    console.log('[TD-eval] fingerprint:', fingerprint ? 'computed' : 'null (best-effort)');

    const runChallenge = (async () => {
      try {
        const storedToken = await getStoredDeviceToken();
        console.log('[TD-eval] storedToken from cookie:', storedToken ? 'present' : 'null');
        const result = await trustedDeviceService.challengeDevice({
          deviceToken: storedToken ?? undefined,
          fingerprint: fingerprint ?? undefined,
          deviceName: deriveDeviceName(),
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
          // Phase 7F: revoked/expired screens' "request approval again" mints a
          // fresh request — skip the fingerprint auto-match so the old row's
          // status is not surfaced again.
          forceNewRequest: options?.forceNewRequest ?? false,
        });

        if (!result.success || !result.data) {
          // FAIL CLOSED: a security gate must never silently grant access.
          // If the challenge cannot be resolved, block to the waiting screen
          // (session stays alive; the user can retry via Refresh Status).
          // Never surface the raw edge function error to the UI.
          console.warn('[TrustedDevice] challenge failed, blocking access:', result.error);
          console.log('[TD-eval] challenge failed → setDeviceStatus("pending")');
          setDeviceStatus('pending');
          setDeviceInfo({
            deviceId: '',
            deviceName: deriveDeviceName(),
            status: 'pending',
            requestedAt: new Date().toISOString(),
            rejectionReason: null,
          });
          return;
        }

        const { status, deviceToken, deviceId } = result.data;

        // Persist a newly minted token (or the reused one) so future
        // challenges present the SAME token and match the stored hash.
        // SURFACE cookie-write failures loudly: a token that cannot persist
        // makes every challenge mint a NEW token and stack pending rows.
        if (deviceToken && deviceToken !== storedToken) {
          const persisted = await storeDeviceToken(deviceToken);
          if (!persisted) {
            console.warn(
              '[TrustedDevice] FAILED to persist the device token cookie. ' +
                'Every challenge will now mint a new token and create duplicate ' +
                'pending requests. Serve the app over https (or http://localhost) ' +
                'so the Secure cookie can be written.',
            );
          }
        }

        const resolved: DeviceTrustStatus =
          status === 'bypass' ? 'bypass' : status;
        console.log('[TD-eval] challenge SUCCESS → setDeviceStatus(', resolved, ')');
        setDeviceStatus(resolved);

        if (resolved === 'bypass' || resolved === 'approved') {
          setDeviceInfo(null);
        } else {
          // Blocking status — resolve device info for the status screens.
          // RACE FIX: the challenge phase and the device-info phase are
          // separate concerns. The challenge is now complete (status set) —
          // load the device info DETACHED so this closure resolves immediately
          // and the in-flight ref clears, instead of being held open by a
          // second edge-function call (device-list) that let a duplicate
          // profile load clobber the resolved status back to 'checking'.
          void resolveDeviceInfo(resolved, deviceId).then(setDeviceInfo);
        }
      } catch (err) {
        console.warn('[TrustedDevice] unexpected challenge error, blocking access:', err);
        console.log('[TD-eval] challenge THREW → setDeviceStatus("pending")');
        setDeviceStatus('pending');
        setDeviceInfo({
          deviceId: '',
          deviceName: deriveDeviceName(),
          status: 'pending',
          requestedAt: new Date().toISOString(),
          rejectionReason: null,
        });
      }
    })();

    deviceChallengeInFlightRef.current = runChallenge;
    try {
      await runChallenge;
    } finally {
      deviceChallengeInFlightRef.current = null;
      console.log('[TD-eval] in-flight ref cleared (challenge settled)');
    }
    console.log('[TD-eval] EXIT evaluateDeviceTrust');
  };

  /**
   * Fetch the REAL device row from the backend for a blocking status.
   *
   * Uses `trustedDeviceService.getMyDevices()` (the `device-list` edge
   * function, owner-scoped) and picks the row matching the challenge result.
   * Falls back to a minimal derived shape when the list query fails.
   */
  const resolveDeviceInfo = async (
    status: DeviceTrustStatus,
    deviceId?: string,
  ): Promise<DeviceInfo> => {
    const fallback: DeviceInfo = {
      deviceId: deviceId ?? '',
      deviceName: deriveDeviceName(),
      status,
      requestedAt: new Date().toISOString(),
      rejectionReason: null,
    };

    try {
      const list = await trustedDeviceService.getMyDevices();
      if (!list.success || !list.data || list.data.length === 0) return fallback;

      const device =
        list.data.find((d) => deviceId && d.deviceId === deviceId) ??
        list.data.find((d) => d.status === status) ??
        list.data[0];

      if (!device) return fallback;

      return {
        deviceId: device.deviceId,
        deviceName: device.deviceName || fallback.deviceName,
        status: device.status as DeviceTrustStatus,
        requestedAt: device.requestedAt ?? fallback.requestedAt,
        rejectionReason: device.rejectionReason ?? null,
      };
    } catch (err) {
      console.warn('[TrustedDevice] could not resolve device info:', err);
      return fallback;
    }
  };

  /**
   * Public refresh — re-runs the device challenge for the current profile.
   * Used by the status screens' "Refresh Status" button.
   */
  const refreshDeviceStatus = async (): Promise<void> => {
    // teacherProfile already carries role + adminRoles (loaded at login).
    await evaluateDeviceTrust(teacherProfile?.role, teacherProfile?.adminRoles);
  };

  /**
   * Clear the stored device token and re-challenge in "new request" mode —
   * used by the expired screen's "Request new approval" and the revoked
   * screen's "Request Approval Again" actions. A fresh token mints a NEW
   * pending request for the super admin to approve (or reuses an existing
   * pending request for this profile — never a duplicate).
   */
  const requestNewDeviceApproval = async (): Promise<void> => {
    await clearStoredDeviceToken();
    await evaluateDeviceTrust(teacherProfile?.role, teacherProfile?.adminRoles, {
      forceNewRequest: true,
    });
  };

  /**
   * Fetches admin role assignments for a profile (Domain 18).
   *
   * Only called for admins (profiles.role = 'admin'). Returns an empty
   * array when the query fails so admin login is never blocked by a roles
   * fetch error — the user still authenticates; they simply have no roles
   * attached (permission fallback grants full access in that case).
   */
  const fetchAdminRoles = async (profileId: string): Promise<AdminRoleAssignment[]> => {
    try {
      const { data, error } = await supabase
        .from('admin_roles')
        .select('*')
        .eq('profile_id', profileId)
        .order('created_at', { ascending: true });

      if (error) {
        console.warn('[Auth] fetchAdminRoles failed:', error.message);
        return [];
      }

      return ((data as DbAdminRole[] | null) ?? []).map((row) => ({
        adminRoleId: row.admin_role_id,
        profileId: row.profile_id,
        instituteId: row.institute_id,
        adminRole: row.admin_role,
        accessStatus: row.access_status,
        grantedBy: row.granted_by,
        accessGrantedAt: row.access_granted_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    } catch (err) {
      console.warn('[Auth] fetchAdminRoles unexpected error:', err);
      return [];
    }
  };

  const loadTeacherProfileDetails = async (userId: string) => {
    // De-dupe (Bug 1 fix): signIn() AND the onAuthStateChange handler both
    // trigger this for the same login. Only the first invocation proceeds —
    // otherwise the profile loads twice and the device challenge fires twice.
    if (profileLoadInFlightRef.current === userId) {
      return;
    }
    profileLoadInFlightRef.current = userId;

    try {
      // 1. Fetch public profile
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('profile_id', userId)
        .single();

      if (profileData) {
        setInstituteId(profileData.institute_id ?? null);
      }

      // 1b. Load admin roles for admin users (Domain 18). Loaded before the
      // profile is set so the first render already carries them.
      // NOTE: deviceStatus is deliberately NOT touched here. Ownership of the
      // device lifecycle (checking → challenge → resolved) belongs exclusively
      // to evaluateDeviceTrust(), which writes 'checking' only when a real
      // challenge is about to run. A redundant profile load (auth events,
      // initAuth re-run) must never overwrite an existing device state — the
      // RACE FIX lives in evaluateDeviceTrust, not here.
      const adminRoles =
        profileData && profileData.role === 'admin'
          ? await fetchAdminRoles(userId)
          : undefined;

      // Clear any stale identity cache before re-resolving
      clearTeacherIdentityCache();

      if (profileData && profileData.role !== 'teacher') {
        console.warn(`User role is ${profileData?.role}, not teacher!`);
      }

      // Fetch teacher_details domain table
      const { data: teacherData, error: teacherErr } = await supabase
        .from('teacher_details')
        .select('*')
        .eq('profile_id', userId)
        .single();

      const baseProfile = EMPTY_TEACHER;

      if (teacherErr || !teacherData) {
        // Fallback to empty/default profile if teacher_details record is not seeded yet
        // Use the auth user ID as a fallback so content creation (createdBy) still works
        setTeacherProfile({
          ...baseProfile,
          id: userId,
          role: profileData?.role || 'teacher',
          accountStatus: profileData?.account_status || 'approved',
          name: profileData?.name || baseProfile.name,
          email: profileData?.email || baseProfile.email,
          adminRoles,
        });

        // Cache identity with profileId only (no teacher_details record yet)
        if (userId) {
          setCachedIdentity({
            profileId: userId,
            teacherId: userId,
            instituteId: profileData?.institute_id ?? null,
          });
        }
      } else {
        // Map backend schema to TeacherProfile shape
        setTeacherProfile({
          ...baseProfile,
          id: teacherData.teacher_id,
          role: profileData?.role || 'teacher',
          accountStatus: profileData?.account_status || 'approved',
          name: profileData?.name || teacherData.teacher_id,
          department: teacherData.department || baseProfile.department,
          designation: teacherData.designation || baseProfile.designation,
          bio: teacherData.bio || baseProfile.bio,
          adminRoles,
        });

        // Cache the full teacher identity for all downstream services
        setCachedIdentity({
          profileId: userId,
          teacherId: teacherData.teacher_id,
          instituteId: teacherData.institute_id ?? profileData?.institute_id ?? null,
        });
      }

      // Trusted Device check (Phase 7D) — runs after profile + admin roles
      // are loaded, so the guards can enforce the device status immediately.
      // Non-admins and super admins resolve to 'bypass' instantly; academic
      // / finance admins run the edge-function challenge.
      // RACE FIX: only evaluate ONCE per auth session per user. Redundant
      // loads (signIn + onAuthStateChange + initAuth re-run) must not restart
      // verification while the device is already evaluated / being evaluated.
      if (deviceEvaluatedRef.current !== userId) {
        deviceEvaluatedRef.current = userId;
        console.log('[TD-load] firing void evaluateDeviceTrust (fire-and-forget)');
        void evaluateDeviceTrust(profileData?.role, adminRoles);
      } else {
        console.log('[TD-load] skipping re-evaluation (device already evaluated for this user)');
      }
    } catch (err) {
      console.error('Error fetching teacher details:', err);
      setTeacherProfile(EMPTY_TEACHER);
      // Profile load failed — reset device state to a safe, non-blocking
      // default so the guards never strand the user.
      console.log('[TD-load] profile load FAILED → setDeviceStatus("bypass")');
      setDeviceStatus('bypass');
      setDeviceInfo(null);
    } finally {
      profileLoadInFlightRef.current = null;
    }
  };

  const signIn = async (phone: string, pass: string): Promise<{ error: string | null }> => {
    setLoading(true);

    let result: { data: any; error: any };
    try {
      result = await supabase.auth.signInWithPassword({
        phone,
        password: pass,
      });
    } catch (netError: any) {
      setLoading(false);
      return { error: 'Network error. Please check your connection and try again.' };
    }

    const { data, error } = result;

    if (error) {
      setLoading(false);
      return { error: extractErrorMessage(error) };
    }

    if (data.session) {
      setSession(data.session);
      setUser(data.session.user);
      await loadTeacherProfileDetails(data.session.user.id);
    }
    setLoading(false);
    return { error: null };
  };

  const registerTeacher = async (
    phone: string,
    pass: string,
    facultyId: string,
    fullName: string,
    department: string
  ): Promise<{ error: string | null }> => {
    setLoading(true);
    try {
      let result;
      try {
        result = await supabase.auth.signUp({
          phone,
          password: pass,
          options: {
            data: {
              full_name: fullName,
              role: 'teacher',
              faculty_id: facultyId,
              department: department
            }
          }
        });
      } catch (signUpNetErr: any) {
        setLoading(false);
        return { error: 'Network error. Please check your connection and try again.' };
      }

      const { data, error } = result;

      if (error) {
        const errorMsg = extractErrorMessage(error);
        console.error('Registration failed:', errorMsg, error);
        setLoading(false);
        return { error: errorMsg };
      }

      // SignUp succeeded — store pending data for OTP verification
      // Don't insert teacher_details yet; wait for OTP verification
      setPendingRegistration({ phone, password: pass, facultyId, fullName, department });
      setPendingPhone(phone);
      setNeedsOtpVerification(true);
      
      setLoading(false);
      return { error: null };
    } catch (err: any) {
      setLoading(false);
      return { error: extractErrorMessage(err) };
    }
  };

  /**
   * Verify the SMS OTP to complete registration.
   * After verification, inserts the teacher_details record and loads the profile.
   */
  const verifyRegistrationOtp = async (token: string): Promise<{ error: string | null }> => {
    if (!pendingRegistration) {
      return { error: 'No pending registration found. Please register again.' };
    }

    const { phone, password, facultyId, fullName, department } = pendingRegistration;

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        phone,
        token,
        type: 'sms',
      });

      if (error) {
        setLoading(false);
        return { error: extractErrorMessage(error) };
      }

      if (!data.user) {
        setLoading(false);
        return { error: 'Verification succeeded but no user data was returned.' };
      }

      // OTP verified — now insert teacher_details
      // Store faculty_id, department, and designation in their dedicated
      // columns.  specialization is left NULL for its actual purpose
      // (subject expertise, not organisational department).
      console.log('[verifyRegistrationOtp] Entering teacher_details INSERT block');
      const insertPayload = {
        profile_id: data.user.id,
        faculty_id: facultyId,
        department: department,
        designation: 'Senior Faculty Mentor',
        qualification: 'Not specified'
      };
      console.log('[verifyRegistrationOtp] Payload:', JSON.stringify(insertPayload, null, 2));

      let insertResult;
      try {
        insertResult = await supabase
          .from('teacher_details')
          .insert(insertPayload);
        console.log('[verifyRegistrationOtp] Supabase response:', JSON.stringify(insertResult, null, 2));

        if (insertResult.error) {
          console.error('[verifyRegistrationOtp] ❌ Postgrest error on INSERT:', {
            message: insertResult.error.message,
            details: insertResult.error.details,
            hint: insertResult.error.hint,
            code: insertResult.error.code
          });
        } else {
          console.log('[verifyRegistrationOtp] ✅ teacher_details INSERT succeeded');
        }
      } catch (dbErr: any) {
        console.error('[verifyRegistrationOtp] ❌ Network/exception error on INSERT:', {
          name: dbErr.name,
          message: dbErr.message,
          stack: dbErr.stack,
          cause: dbErr.cause
        });
      }

      // Set the session and load profile
      setSession(data.session ?? null);
      setUser(data.user);

      await loadTeacherProfileDetails(data.user.id);

      // Clear pending state
      setNeedsOtpVerification(false);
      setPendingPhone(null);
      setPendingRegistration(null);
      setLoading(false);
      return { error: null };
    } catch (err: any) {
      setLoading(false);
      return { error: extractErrorMessage(err) };
    }
  };

  /**
   * Resend the SMS OTP.
   */
  const resendRegistrationOtp = async (): Promise<{ error: string | null }> => {
    if (!pendingPhone) {
      return { error: 'No phone number found. Please register again.' };
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone: pendingPhone,
        options: { shouldCreateUser: false },
      });

      if (error) {
        setLoading(false);
        return { error: extractErrorMessage(error) };
      }

      setLoading(false);
      return { error: null };
    } catch (err: any) {
      setLoading(false);
      return { error: extractErrorMessage(err) };
    }
  };

  /**
   * Cancel OTP verification and go back to registration.
   */
  const cancelOtpVerification = () => {
    setNeedsOtpVerification(false);
    setPendingPhone(null);
    setPendingRegistration(null);
  };

  const signOut = async () => {
    setLoading(true);
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setTeacherProfile(null);
    // Reset device trust state (logout only removes the session — the
    // td_device cookie is deliberately kept, per Phase 7D spec).
    console.log('[TD-signOut] setDeviceStatus("bypass")');
    setDeviceStatus('bypass');
    setDeviceInfo(null);
    // Allow a future login (same or different user) to re-evaluate the device.
    deviceEvaluatedRef.current = null;
    // Clear the teacher identity cache so downstream services re-resolve
    clearTeacherIdentityCache();
    setLoading(false);
  };

  const updateSpecialization = (specialization: string) => {
    if (teacherProfile) {
      const baseProfile = EMPTY_TEACHER;
      const updated = {
        ...teacherProfile,
        department: specialization || baseProfile.department,
      };
      setTeacherProfile(updated);
    }
  };

  const completeOnboarding = async (onboardingData: {
    qualification: string;
    institution: string;
    year: string;
    accountHolder: string;
    bankName: string;
    accountNumber: string;
    ifscCode: string;
  }) => {
    if (!teacherProfile) return;

    const baseProfile = EMPTY_TEACHER;
    const updatedProfile: TeacherProfile = {
      ...teacherProfile,
      needsOnboarding: false,
      bankDetails: {
        accountHolder: onboardingData.accountHolder || baseProfile.bankDetails.accountHolder,
        bankName: onboardingData.bankName || baseProfile.bankDetails.bankName,
        accountNumberMasked: onboardingData.accountNumber ? `••••${onboardingData.accountNumber.slice(-4)}` : baseProfile.bankDetails.accountNumberMasked,
        ifscCode: onboardingData.ifscCode || baseProfile.bankDetails.ifscCode,
        status: 'pending'
      },
      documents: onboardingData.qualification ? [
        {
          id: 'doc-degree',
          title: `Degree: ${onboardingData.qualification} (${onboardingData.institution})`,
          category: 'education_cert' as const,
          uploadDate: new Date().toISOString().slice(0, 10),
          status: 'pending' as const,
          size: '1.2 MB'
        }
      ] : []
    };

    setTeacherProfile(updatedProfile);

    try {
      if (onboardingData.qualification) {
        await supabase
          .from('teacher_documents')
          .insert([{
            teacher_id: teacherProfile.id,
            document_type: 'degree',
            document_url: 'https://example.com/degree.pdf',
            verification_status: 'pending'
          }]);
      }
      await supabase
        .from('teacher_details')
        .update({
          bio: `Specialized in ${teacherProfile.department}. Qualifications: ${onboardingData.qualification} from ${onboardingData.institution} (${onboardingData.year})`
        })
        .eq('teacher_id', teacherProfile.id);
    } catch (e) {
      console.warn('Database onboarding sync skipped/failed:', e);
    }
  };

  const skipOnboarding = () => {
    if (!teacherProfile) return;
    setTeacherProfile({
      ...teacherProfile,
      needsOnboarding: false
    });
  };

  useEffect(() => {
    const initAuth = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setSession(data.session);
        setUser(data.session.user);
        await loadTeacherProfileDetails(data.session.user.id);
      }
      setLoading(false);
    };

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (newSession) {
        setSession(newSession);
        setUser(newSession.user);
        await loadTeacherProfileDetails(newSession.user.id);
      } else {
        setSession(null);
        setUser(null);
        setTeacherProfile(null);
      }
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{
      session,
      user,
      teacherProfile,
      instituteId,
      loading,
      needsOtpVerification,
      pendingPhone,
      signIn,
      registerTeacher,
      verifyRegistrationOtp,
      resendRegistrationOtp,
      cancelOtpVerification,
      signOut,
      updateSpecialization,
      completeOnboarding,
      skipOnboarding,
      deviceStatus,
      deviceInfo,
      refreshDeviceStatus,
      requestNewDeviceApproval,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
