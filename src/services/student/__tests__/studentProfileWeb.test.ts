import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import { supabase } from '@/config/supabase';
import {
  fetchStudentFullProfile,
  updateStudentPersonalInfo,
  updateStudentPassword,
} from '@/services/student/studentProfileWebService';

describe('Student Profile Web Service & Mobile Parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── 1. fetchStudentFullProfile ─────────────────────────────────────────────
  describe('fetchStudentFullProfile', () => {
    it('fetches full student profile with institute, student_details, batches, and courses', async () => {
      // Mock getUser
      vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({
        data: { user: { id: 'std-user-1', email: 'student@example.com' } as any },
        error: null,
      });

      // Mock bootstrap RPC
      vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: {
          success: true,
          selected_stream: { name: 'JEE Advanced 2026' },
          active_batches: [
            { batch_id: 'b-1', name: 'JEE Droppers Alpha', batch_code: 'JEE-A1', stream_name: 'JEE Advanced' },
          ],
          enrolled_courses: [
            { course_id: 'c-1', title: 'Complete Physics Mastery', category: 'Physics', thumbnail_path: '/img/phy.png' },
          ],
        },
        error: null,
      } as any);

      // Mock from('profiles')
      const mockProfileQuery: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            profile_id: 'std-user-1',
            institute_id: 'inst-99',
            name: 'Rohit Sharma',
            email: 'rohit@example.com',
            phone: '+919876543210',
            avatar_url: 'https://cdn.example.com/avatar.jpg',
            role: 'student',
            is_active: true,
            created_at: '2026-01-01T00:00:00Z',
            selected_stream_id: 'stream-1',
          },
          error: null,
        }),
      };

      // Mock from('institutes')
      const mockInstQuery: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { name: 'Apex Premier Institute', code: 'APEX-01' },
          error: null,
        }),
      };

      // Mock from('student_details')
      const mockStudentDetailsQuery: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            student_id: 'sd-101',
            enrollment_no: 'ENR-2026-0042',
            dob: '2008-05-15',
            target_year: '2026',
            enrolled_on: '2026-01-10',
            guardian_name: 'Suresh Sharma',
            guardian_mobile: '+919876500000',
            guardian_email: 'suresh@example.com',
            selected_stream_id: 'stream-1',
          },
          error: null,
        }),
      };

      vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
        if (table === 'profiles') return mockProfileQuery;
        if (table === 'institutes') return mockInstQuery;
        if (table === 'student_details') return mockStudentDetailsQuery;
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as any;
      });

      const res = await fetchStudentFullProfile('std-user-1');

      expect(res.error).toBeNull();
      expect(res.data).toBeDefined();
      expect(res.data?.name).toBe('Rohit Sharma');
      expect(res.data?.email).toBe('rohit@example.com');
      expect(res.data?.phone).toBe('+919876543210');
      expect(res.data?.instituteName).toBe('Apex Premier Institute');
      expect(res.data?.enrollmentNo).toBe('ENR-2026-0042');
      expect(res.data?.dob).toBe('2008-05-15');
      expect(res.data?.targetYear).toBe('2026');
      expect(res.data?.guardianName).toBe('Suresh Sharma');
      expect(res.data?.streamName).toBe('JEE Advanced 2026');
      expect(res.data?.activeBatches).toHaveLength(1);
      expect(res.data?.activeBatches[0].batchCode).toBe('JEE-A1');
      expect(res.data?.enrolledCourses).toHaveLength(1);
      expect(res.data?.enrolledCourses[0].title).toBe('Complete Physics Mastery');
    });

    it('prioritizes auth user phone over stale profiles.phone', async () => {
      vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({
        data: { user: { id: 'std-user-1', phone: '+919999999999' } as any },
        error: null,
      });

      vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: { success: true, active_batches: [], enrolled_courses: [] },
        error: null,
      } as any);

      const mockProfileUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          then: vi.fn().mockResolvedValue({ error: null }),
        }),
      });

      vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                profile_id: 'std-user-1',
                name: 'Test Student',
                email: 'test@example.com',
                phone: '+918888888888', // Stale phone in profiles table
                role: 'student',
                is_active: true,
              },
              error: null,
            }),
            update: mockProfileUpdate,
          } as any;
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as any;
      });

      const res = await fetchStudentFullProfile('std-user-1');

      expect(res.error).toBeNull();
      // Must return auth user phone (+919999999999), NOT stale profiles.phone (+918888888888)
      expect(res.data?.phone).toBe('+919999999999');
    });

    it('handles missing optional fields cleanly with nulls and fallbacks', async () => {
      vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({
        data: { user: { id: 'std-user-minimal' } as any },
        error: null,
      });

      vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: { success: true, active_batches: [], enrolled_courses: [] },
        error: null,
      } as any);

      vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                profile_id: 'std-user-minimal',
                institute_id: null,
                name: 'New Student',
                email: 'new@student.com',
                phone: null,
                avatar_url: null,
                role: 'student',
                is_active: true,
                created_at: '2026-02-01T00:00:00Z',
                selected_stream_id: null,
              },
              error: null,
            }),
          } as any;
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as any;
      });

      const res = await fetchStudentFullProfile('std-user-minimal');

      expect(res.error).toBeNull();
      expect(res.data?.phone).toBeNull();
      expect(res.data?.avatarUrl).toBeNull();
      expect(res.data?.instituteName).toBeNull();
      expect(res.data?.enrollmentNo).toBeNull();
      expect(res.data?.dob).toBeNull();
      expect(res.data?.guardianName).toBeNull();
      expect(res.data?.activeBatches).toEqual([]);
      expect(res.data?.enrolledCourses).toEqual([]);
    });

    it('returns error when user session is not available', async () => {
      vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({
        data: { user: null },
        error: { message: 'No session' } as any,
      });

      const res = await fetchStudentFullProfile();

      expect(res.data).toBeNull();
      expect(res.error).toContain('User session not found');
    });
  });

  // ─── 2. updateStudentPersonalInfo ───────────────────────────────────────────
  describe('updateStudentPersonalInfo', () => {
    it('updates name and phone successfully on public.profiles', async () => {
      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      vi.spyOn(supabase, 'from').mockReturnValue({
        update: mockUpdate,
      } as any);

      const res = await updateStudentPersonalInfo('std-1', {
        name: 'Aarav Patel',
        phone: '+919988776655',
      });

      expect(res.error).toBeNull();
      expect(res.data?.name).toBe('Aarav Patel');
      expect(res.data?.phone).toBe('+919988776655');
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Aarav Patel',
          phone: '+919988776655',
        })
      );
    });

    it('rejects empty name input with validation error', async () => {
      const res = await updateStudentPersonalInfo('std-1', {
        name: '   ',
      });

      expect(res.data).toBeNull();
      expect(res.error).toBe('Full name cannot be empty.');
    });

    it('rejects invalid phone format', async () => {
      const res = await updateStudentPersonalInfo('std-1', {
        name: 'Valid Name',
        phone: 'invalid-phone-abc',
      });

      expect(res.data).toBeNull();
      expect(res.error).toBe('Please provide a valid phone number.');
    });
  });

  // ─── 3. updateStudentPassword ───────────────────────────────────────────────
  describe('updateStudentPassword', () => {
    it('updates password via supabase.auth.updateUser', async () => {
      vi.spyOn(supabase.auth, 'updateUser').mockResolvedValue({
        data: { user: { id: 'std-1' } as any },
        error: null,
      });

      const res = await updateStudentPassword('newSecretPassword123');

      expect(res.error).toBeNull();
      expect(res.data).toBe(true);
      expect(supabase.auth.updateUser).toHaveBeenCalledWith({
        password: 'newSecretPassword123',
      });
    });

    it('rejects passwords shorter than 6 characters', async () => {
      const res = await updateStudentPassword('12345');

      expect(res.data).toBeNull();
      expect(res.error).toBe('Password must be at least 6 characters long.');
    });
  });

  // ─── 4. initiatePhoneChange ─────────────────────────────────────────────────
  describe('initiatePhoneChange', () => {
    it('validates password, formats phone, and requests updateUser', async () => {
      vi.spyOn(supabase.auth, 'signInWithPassword').mockResolvedValue({
        data: { user: { id: 'std-1' } as any, session: {} as any },
        error: null,
      });

      vi.spyOn(supabase.auth, 'updateUser').mockResolvedValue({
        data: { user: { id: 'std-1' } as any },
        error: null,
      });

      const { initiatePhoneChange } = await import('@/services/student/studentProfileWebService');

      const res = await initiatePhoneChange({
        newPhone: '9876543210',
        currentPassword: 'currentPassword123',
        currentPhone: '+919999999999',
      });

      expect(res.error).toBeNull();
      expect(res.data).toBe(true);
      expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
        phone: '+919999999999',
        password: 'currentPassword123',
      });
      expect(supabase.auth.updateUser).toHaveBeenCalledWith({
        phone: '+919876543210',
      });
    });

    it('rejects if current password is wrong', async () => {
      vi.spyOn(supabase.auth, 'signInWithPassword').mockResolvedValue({
        data: { user: null, session: null },
        error: { message: 'Invalid credentials' } as any,
      });

      const { initiatePhoneChange } = await import('@/services/student/studentProfileWebService');

      const res = await initiatePhoneChange({
        newPhone: '9876543210',
        currentPassword: 'wrongPassword',
        currentPhone: '+919999999999',
      });

      expect(res.data).toBeNull();
      expect(res.error).toBe('Incorrect current password. Please try again.');
    });

    it('rejects if new phone is the same as current phone', async () => {
      const { initiatePhoneChange } = await import('@/services/student/studentProfileWebService');

      const res = await initiatePhoneChange({
        newPhone: '+919999999999',
        currentPassword: 'password123',
        currentPhone: '+919999999999',
      });

      expect(res.data).toBeNull();
      expect(res.error).toBe('New mobile number cannot be the same as your current mobile number.');
    });

    it('handles duplicate phone error with friendly message', async () => {
      vi.spyOn(supabase.auth, 'signInWithPassword').mockResolvedValue({
        data: { user: { id: 'std-1' } as any, session: {} as any },
        error: null,
      });

      vi.spyOn(supabase.auth, 'updateUser').mockResolvedValue({
        data: { user: null },
        error: { message: 'A user with this phone number already exists', code: 'phone_exists' } as any,
      });

      const { initiatePhoneChange } = await import('@/services/student/studentProfileWebService');

      const res = await initiatePhoneChange({
        newPhone: '9876543210',
        currentPassword: 'correctPassword',
        currentPhone: '+919999999999',
      });

      expect(res.data).toBeNull();
      expect(res.error).toBe('This mobile number is already registered to another account.');
    });
  });

  // ─── 5. verifyPhoneChangeOtp & resendPhoneChangeOtp ─────────────────────────
  describe('verifyPhoneChangeOtp & resendPhoneChangeOtp', () => {
    it('verifies OTP and syncs public.profiles.phone', async () => {
      vi.spyOn(supabase.auth, 'verifyOtp').mockResolvedValue({
        data: { user: { id: 'std-1', phone: '+919876543210' } as any, session: {} as any },
        error: null,
      });

      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });
      vi.spyOn(supabase, 'from').mockReturnValue({
        update: mockUpdate,
      } as any);

      const { verifyPhoneChangeOtp } = await import('@/services/student/studentProfileWebService');

      const res = await verifyPhoneChangeOtp({
        userId: 'std-1',
        newPhone: '9876543210',
        token: '123456',
      });

      expect(res.error).toBeNull();
      expect(res.data?.phone).toBe('+919876543210');
      expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({
        phone: '+919876543210',
        token: '123456',
        type: 'phone_change',
      });
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          phone: '+919876543210',
        })
      );
    });

    it('reports error when profile sync fails during verifyPhoneChangeOtp', async () => {
      vi.spyOn(supabase.auth, 'verifyOtp').mockResolvedValue({
        data: { user: { id: 'std-1', phone: '+919876543210' } as any, session: {} as any },
        error: null,
      });

      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: { message: 'RLS permission denied on profiles' } }),
      });
      vi.spyOn(supabase, 'from').mockReturnValue({
        update: mockUpdate,
      } as any);

      const { verifyPhoneChangeOtp } = await import('@/services/student/studentProfileWebService');

      const res = await verifyPhoneChangeOtp({
        userId: 'std-1',
        newPhone: '9876543210',
        token: '123456',
      });

      expect(res.data).toBeNull();
      expect(res.error).toContain('failed to sync profile');
      expect(res.error).toContain('RLS permission denied on profiles');
    });

    it('rejects invalid or expired OTP with error', async () => {
      vi.spyOn(supabase.auth, 'verifyOtp').mockResolvedValue({
        data: { user: null, session: null },
        error: { message: 'Token has expired or is invalid' } as any,
      });

      const { verifyPhoneChangeOtp } = await import('@/services/student/studentProfileWebService');

      const res = await verifyPhoneChangeOtp({
        userId: 'std-1',
        newPhone: '9876543210',
        token: '000000',
      });

      expect(res.data).toBeNull();
      expect(res.error).toContain('Token has expired or is invalid');
    });

    it('resends OTP via updateUser', async () => {
      vi.spyOn(supabase.auth, 'updateUser').mockResolvedValue({
        data: { user: { id: 'std-1' } as any },
        error: null,
      });

      const { resendPhoneChangeOtp } = await import('@/services/student/studentProfileWebService');

      const res = await resendPhoneChangeOtp('9876543210');
      expect(res.error).toBeNull();
      expect(res.data).toBe(true);
      expect(supabase.auth.updateUser).toHaveBeenCalledWith({
        phone: '+919876543210',
      });
    });
  });

  // ─── 4. UI Parity & Component Verification ──────────────────────────────────
  describe('Student Profile UI Component Contracts', () => {
    const viewContent = fs.readFileSync('src/components/student/StudentProfileView.tsx', 'utf8');
    const pageContent = fs.readFileSync('src/app/student/profile/page.tsx', 'utf8');

    it('page mounts StudentProfileView', () => {
      expect(pageContent).toContain('StudentProfileView');
    });

    it('StudentProfileView displays all mobile parity sections and fields', () => {
      // Identity & Hero
      expect(viewContent).toContain('Student Profile & Account');
      expect(viewContent).toContain('Verified Student');
      expect(viewContent).toContain('Active Account');

      // Personal Information
      expect(viewContent).toContain('Personal Information');
      expect(viewContent).toContain('Full Name');
      expect(viewContent).toContain('Phone Number');
      expect(viewContent).toContain('Email Address (Managed)');
      expect(viewContent).toContain('Official Student ID');
      expect(viewContent).not.toContain('Target Year');
      expect(viewContent).not.toContain('Date of Birth');

      // Course Enrollments
      expect(viewContent).toContain('Course Enrollments');
      expect(viewContent).toContain('Enrolled Courses');

      // Account & Security
      expect(viewContent).toContain('Account & Security');
      expect(viewContent).toContain('Change Password');

      // Sign Out
      expect(viewContent).toContain('Sign Out Account');
      expect(viewContent).toContain('Confirm Sign Out');
    });

    it('maintains read-only integrity for managed and system-controlled fields', () => {
      // Email is disabled in form
      expect(viewContent).toContain('disabled');
      expect(viewContent).toContain('Account login email is managed by your institute administrator.');
    });

    it('implements loading skeletons, error retry, and empty enrollment messaging', () => {
      expect(viewContent).toContain('animate-pulse');
      expect(viewContent).toContain('Retry Loading');
      expect(viewContent).toContain('No course enrollments found.');
    });
  });
});
