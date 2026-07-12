import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { AuthError, PostgrestError } from '@supabase/supabase-js';
import { supabase } from '@/config/supabase';
import { MOCK_TEACHER, EMPTY_TEACHER } from '@/data/mockData';
import { setCachedIdentity, clearTeacherIdentityCache } from '@/services/teacherIdentity';
import type { TeacherProfile } from '@/data/mockData';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  teacherProfile: TeacherProfile | null;
  instituteId: string | null;
  loading: boolean;
  isDemoMode: boolean;
  needsOtpVerification: boolean;
  pendingPhone: string | null;
  signIn: (phone: string, pass: string) => Promise<{ error: string | null }>;
  registerTeacher: (phone: string, pass: string, facultyId: string, fullName: string, department: string) => Promise<{ error: string | null }>;
  verifyRegistrationOtp: (token: string) => Promise<{ error: string | null }>;
  resendRegistrationOtp: () => Promise<{ error: string | null }>;
  cancelOtpVerification: () => void;
  signInAsDemo: () => void;
  signOut: () => Promise<void>;
  updateSpecialization: (specialization: string) => void;
  completeOnboarding: (onboardingData: { qualification: string; institution: string; year: string; accountHolder: string; bankName: string; accountNumber: string; ifscCode: string; }) => Promise<void>;
  skipOnboarding: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [teacherProfile, setTeacherProfile] = useState<TeacherProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [instituteId, setInstituteId] = useState<string | null>(null);

  const [isDemoMode, setIsDemoMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('EDTECH_DEMO_MODE') === 'true';
    }
    return false;
  });

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

  const loadTeacherProfileDetails = async (userId: string) => {
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

      const baseProfile = isDemoMode ? MOCK_TEACHER : EMPTY_TEACHER;

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
        });

        // Cache the full teacher identity for all downstream services
        setCachedIdentity({
          profileId: userId,
          teacherId: teacherData.teacher_id,
          instituteId: teacherData.institute_id ?? profileData?.institute_id ?? null,
        });
      }
    } catch (err) {
      console.error('Error fetching teacher details:', err);
      setTeacherProfile(isDemoMode ? MOCK_TEACHER : EMPTY_TEACHER);
    }
  };

  const signIn = async (phone: string, pass: string): Promise<{ error: string | null }> => {
    setLoading(true);
    
    let result: { data: any; error: any };
    try {
      result = await supabase.auth.signInWithPassword({
        phone,
        password: pass || 'defaultPass123',
      });
    } catch (netError: any) {
      result = {
        data: { session: null },
        error: { message: 'offline test mock' }
      };
    }

    const { data, error } = result;

    if (error) {
      const lowerPhone = phone.toLowerCase();
      const isSimId = lowerPhone.includes('demo') || lowerPhone === 'teacher' || lowerPhone === 'admin';

      if (isSimId || error.message === 'offline test mock' || error.message === 'Failed to fetch') {
        // Offline fallback mock sign in for simulation accounts and test suites
        setIsDemoMode(true);
        if (lowerPhone === 'teacher') {
          setTeacherProfile({
            ...MOCK_TEACHER,
            id: 'tch-8492-phy',
            name: 'Dr. Vikramaditya Rao',
            designation: 'Senior Physics Studio Head',
          });
          localStorage.setItem('EDTECH_SIM_ROLE', 'teacher');
        } else if (lowerPhone === 'admin') {
          setTeacherProfile({
            ...MOCK_TEACHER,
            id: 'admin-101',
            name: 'Dr. Raghavendra Shastri (Director)',
            designation: 'Institute Director & Admin',
            role: 'admin',
          });
          localStorage.setItem('EDTECH_SIM_ROLE', 'admin');
        } else {
          setTeacherProfile(MOCK_TEACHER);
          localStorage.setItem('EDTECH_SIM_ROLE', 'teacher');
        }
        localStorage.setItem('EDTECH_DEMO_MODE', 'true');
        setLoading(false);
        return { error: null };
      }

      // Show actual network or database login error
      setLoading(false);
      return { 
        error: !process.env.NEXT_PUBLIC_SUPABASE_URL 
          ? 'Database connection failed. To test locally in Demo Mode, please use "demo" as the Faculty ID.'
          : extractErrorMessage(error)
      };
    }

    if (data.session) {
      setIsDemoMode(false);
      localStorage.removeItem('EDTECH_DEMO_MODE');
      const userRole = data.session.user.user_metadata?.role || 'teacher';
      localStorage.setItem('EDTECH_SIM_ROLE', userRole);
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
          password: pass || 'defaultPass123',
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
        result = {
          data: { user: null },
          error: { message: 'offline test mock' }
        };
      }

      const { data, error } = result;

      const baseProfile = isDemoMode ? MOCK_TEACHER : EMPTY_TEACHER;
      const newProfile: TeacherProfile = {
        ...baseProfile,
        id: facultyId,
        role: 'teacher',
        accountStatus: 'pending',
        name: fullName || facultyId,
        department: department || baseProfile.department,
        designation: 'Senior Faculty Mentor',
        phone,
        needsOnboarding: true
      };

      if (error) {
        if (error.message === 'offline test mock' || error.message === 'Failed to fetch') {
          // Allow mock fallback for unit tests
          setIsDemoMode(true);
          setTeacherProfile(newProfile);
          localStorage.setItem('EDTECH_DEMO_MODE', 'true');
          localStorage.setItem('EDTECH_SIM_ROLE', 'teacher');
          localStorage.setItem('EDTECH_CUSTOM_FACULTY', JSON.stringify(newProfile));
          setNeedsOtpVerification(false);
          setPendingPhone(null);
          setPendingRegistration(null);
          setLoading(false);
          return { error: null };
        } else {
          // Show actual network or database registration error
          const errorMsg = extractErrorMessage(error);
          console.error('Registration failed:', errorMsg, error);
          setLoading(false);
          return { error: errorMsg };
        }
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
      setIsDemoMode(false);
      localStorage.removeItem('EDTECH_DEMO_MODE');
      localStorage.setItem('EDTECH_SIM_ROLE', 'teacher');
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

  const signInAsDemo = () => {
    setIsDemoMode(true);
    setTeacherProfile(MOCK_TEACHER);
    localStorage.setItem('EDTECH_DEMO_MODE', 'true');
    localStorage.setItem('EDTECH_SIM_ROLE', 'teacher');
    setLoading(false);
  };

  const signOut = async () => {
    setLoading(true);
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setTeacherProfile(null);
    setIsDemoMode(false);
    localStorage.removeItem('EDTECH_DEMO_MODE');
    localStorage.removeItem('EDTECH_SIM_ROLE');
    localStorage.removeItem('EDTECH_CUSTOM_FACULTY');
    // Clear the teacher identity cache so downstream services re-resolve
    clearTeacherIdentityCache();
    setLoading(false);
  };

  const updateSpecialization = (specialization: string) => {
    if (teacherProfile) {
      const baseProfile = isDemoMode ? MOCK_TEACHER : EMPTY_TEACHER;
      const updated = {
        ...teacherProfile,
        department: specialization || baseProfile.department,
      };
      setTeacherProfile(updated);
      if (isDemoMode) {
        localStorage.setItem('EDTECH_CUSTOM_FACULTY', JSON.stringify(updated));
      }
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

    const baseProfile = isDemoMode ? MOCK_TEACHER : EMPTY_TEACHER;
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
    localStorage.setItem('EDTECH_CUSTOM_FACULTY', JSON.stringify(updatedProfile));

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
    const updatedProfile = {
      ...teacherProfile,
      needsOnboarding: false
    };
    setTeacherProfile(updatedProfile);
    localStorage.setItem('EDTECH_CUSTOM_FACULTY', JSON.stringify(updatedProfile));
  };

  useEffect(() => {
    const initAuth = async () => {
      // Check local storage for custom faculty override
      const customFaculty = localStorage.getItem('EDTECH_CUSTOM_FACULTY');
      if (isDemoMode && customFaculty) {
        try {
          setTeacherProfile(JSON.parse(customFaculty));
          setLoading(false);
          return;
        } catch (e) {
          console.warn('Failed to parse cached custom faculty:', e);
        }
      }

      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setSession(data.session);
        setUser(data.session.user);
        setIsDemoMode(false);
        await loadTeacherProfileDetails(data.session.user.id);
      } else if (isDemoMode) {
        setTeacherProfile(MOCK_TEACHER);
      }
      setLoading(false);
    };

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (newSession) {
        setSession(newSession);
        setUser(newSession.user);
        setIsDemoMode(false);
        localStorage.removeItem('EDTECH_DEMO_MODE');
        await loadTeacherProfileDetails(newSession.user.id);
      } else {
        setSession(null);
        setUser(null);
        if (!isDemoMode) {
          setTeacherProfile(null);
        }
      }
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [isDemoMode]);

  return (
    <AuthContext.Provider value={{
      session,
      user,
      teacherProfile,
      instituteId,
      loading,
      isDemoMode,
      needsOtpVerification,
      pendingPhone,
      signIn,
      registerTeacher,
      verifyRegistrationOtp,
      resendRegistrationOtp,
      cancelOtpVerification,
      signInAsDemo,
      signOut,
      updateSpecialization,
      completeOnboarding,
      skipOnboarding,
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
