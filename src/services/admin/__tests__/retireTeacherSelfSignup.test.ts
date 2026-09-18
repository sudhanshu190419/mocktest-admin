import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('Retire Public Teacher Self-Signup & Role Hardening Verification', () => {
  it('Migration 084 & Migration 156 hardcode role = user and account_status = approved in handle_new_user()', () => {
    const migMockTestApp = fs.readFileSync(
      'C:/Projects/MockTestApp/supabase/migrations/084_harden_handle_new_user_public_role.sql',
      'utf8'
    );
    const migAdmin = fs.readFileSync(
      'C:/Projects/mocktest-admin/supabase/migrations/156_harden_handle_new_user_public_role.sql',
      'utf8'
    );

    for (const sql of [migMockTestApp, migAdmin]) {
      expect(sql).toContain("v_role := 'user'::public.user_role;");
      expect(sql).toContain("'approved'::public.account_status");
      // The function must not assign role from raw_user_meta_data
      expect(sql).not.toContain("(new.raw_user_meta_data ->> 'role')::public.user_role");
      // Must preserve institute resolution
      expect(sql).toContain('public.institutes');
      expect(sql).toContain('on conflict (profile_id) do nothing;');
    }
  });

  it('LoginView.tsx does not contain teacher registration UI or registration OTP states', () => {
    const loginViewContent = fs.readFileSync(
      'C:/Projects/mocktest-admin/src/views/LoginView.tsx',
      'utf8'
    );

    expect(loginViewContent).not.toContain('Register Faculty ID');
    expect(loginViewContent).not.toContain('registerTeacher');
    expect(loginViewContent).not.toContain('verifyRegistrationOtp');
    expect(loginViewContent).not.toContain('resendRegistrationOtp');
    expect(loginViewContent).not.toContain('cancelOtpVerification');
    expect(loginViewContent).not.toContain('handleAutoGenId');
    expect(loginViewContent).not.toContain('Register New Faculty ID');
    // Must contain clean signIn
    expect(loginViewContent).toContain('signIn(phoneNumber.trim(), password)');
    expect(loginViewContent).toContain('Faculty & Admin Access');
    expect(loginViewContent).toContain('Sign In to Portal');
  });

  it('AuthContext.tsx does not export teacher registration functions or direct teacher_details insert', () => {
    const authContextContent = fs.readFileSync(
      'C:/Projects/mocktest-admin/src/context/AuthContext.tsx',
      'utf8'
    );

    expect(authContextContent).not.toContain('registerTeacher');
    expect(authContextContent).not.toContain('verifyRegistrationOtp');
    expect(authContextContent).not.toContain('resendRegistrationOtp');
    expect(authContextContent).not.toContain('cancelOtpVerification');
    expect(authContextContent).not.toContain('needsOtpVerification');
    expect(authContextContent).not.toContain('pendingRegistration');
    // Must preserve essential auth methods
    expect(authContextContent).toContain('signIn');
    expect(authContextContent).toContain('signOut');
    expect(authContextContent).toContain('loadTeacherProfileDetails');
  });

  it('teacher-identity-create Edge Function remains intact and is the exclusive teacher creator', () => {
    const edgeFunctionContent = fs.readFileSync(
      'C:/Projects/mocktest-admin/supabase/functions/teacher-identity-create/index.ts',
      'utf8'
    );

    expect(edgeFunctionContent).toContain("role: 'teacher'");
    expect(edgeFunctionContent).toContain("account_status: 'approved'");
    expect(edgeFunctionContent).toContain("from('teacher_details')");
    expect(edgeFunctionContent).toContain("isApprovedSuperAdmin");
  });

  it('MockTestApp authService does not pass role metadata during signup', () => {
    const authServiceContent = fs.readFileSync(
      'C:/Projects/MockTestApp/src/services/authService.ts',
      'utf8'
    );

    expect(authServiceContent).toContain('supabase.auth.signUp');
    expect(authServiceContent).not.toContain("role: 'teacher'");
    expect(authServiceContent).not.toContain("role: 'student'");
  });
});
