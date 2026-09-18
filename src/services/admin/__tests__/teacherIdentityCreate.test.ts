import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── E.164 and Email regex mirrors for pure validator testing ─────────────────
const PHONE_REGEX = /^\+[1-9]\d{6,14}$/;
const EMAIL_REGEX = /^\S+@\S+\.\S+$/;

function validateRequestBody(raw: Record<string, unknown>):
  | { ok: true; body: any }
  | { ok: false; error: string } {
  const fullName =
    typeof raw.fullName === 'string' && raw.fullName.trim()
      ? raw.fullName.trim()
      : typeof raw.name === 'string' && raw.name.trim()
      ? raw.name.trim()
      : '';
  const phone = typeof raw.phone === 'string' ? raw.phone.trim() : '';
  const password = typeof raw.password === 'string' ? raw.password : '';
  const email =
    typeof raw.email === 'string' && raw.email.trim() ? raw.email.trim() : undefined;
  const facultyId =
    typeof raw.facultyId === 'string' && raw.facultyId.trim()
      ? raw.facultyId.trim()
      : typeof raw.faculty_id === 'string' && raw.faculty_id.trim()
      ? raw.faculty_id.trim()
      : '';
  const department = typeof raw.department === 'string' ? raw.department.trim() : '';
  const designation =
    typeof raw.designation === 'string' && raw.designation.trim()
      ? raw.designation.trim()
      : undefined;

  if (!fullName) {
    return { ok: false, error: 'Full name is required.' };
  }
  if (!phone) {
    return { ok: false, error: 'Phone number is required.' };
  }
  if (!PHONE_REGEX.test(phone)) {
    return {
      ok: false,
      error: 'Please enter a valid phone number with country code (e.g. +919876543210).',
    };
  }
  if (!password || password.length < 6) {
    return { ok: false, error: 'Password must be at least 6 characters.' };
  }
  if (email && !EMAIL_REGEX.test(email)) {
    return { ok: false, error: 'Please enter a valid email address.' };
  }
  if (!facultyId) {
    return { ok: false, error: 'Faculty ID is required.' };
  }
  if (!department) {
    return { ok: false, error: 'Department is required.' };
  }

  return {
    ok: true,
    body: {
      fullName,
      phone,
      password,
      email,
      facultyId,
      department,
      designation: designation || 'Faculty',
    },
  };
}

// ─── Mocks for Service Tests ──────────────────────────────────────────────────
const { mockFunctionsInvoke, mockIsSuperAdmin, mockAuditLogCreate } = vi.hoisted(() => ({
  mockFunctionsInvoke: vi.fn(),
  mockIsSuperAdmin: vi.fn(),
  mockAuditLogCreate: vi.fn(),
}));

vi.mock('@/config/supabase', () => ({
  supabase: {
    functions: {
      invoke: mockFunctionsInvoke,
    },
  },
}));

vi.mock('../adminRoleService', () => ({
  adminRoleService: {
    isSuperAdmin: mockIsSuperAdmin,
  },
}));

vi.mock('@/services/audit/auditService', () => ({
  auditService: {
    logCreate: mockAuditLogCreate,
  },
}));

import { teacherLifecycleService, CreateTeacherInput } from '../teacherLifecycleService';
import { isSuperAdmin as checkIsSuperAdmin, isAcademicAdmin as checkIsAcademicAdmin, isFinanceAdmin as checkIsFinanceAdmin } from '../permissionService';
import type { AdminRoleAssignment } from '@/types/adminRoles';

describe('teacher-identity-create: Request Body Validation', () => {
  it('validates a complete and valid payload', () => {
    const validPayload = {
      fullName: 'Dr. John Doe',
      phone: '+919876543210',
      password: 'SecurePassword123',
      email: 'john.doe@example.com',
      facultyId: 'FAC-MATH-001',
      department: 'Mathematics',
      designation: 'Senior Professor',
    };

    const res = validateRequestBody(validPayload);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.body.fullName).toBe('Dr. John Doe');
      expect(res.body.phone).toBe('+919876543210');
      expect(res.body.password).toBe('SecurePassword123');
      expect(res.body.email).toBe('john.doe@example.com');
      expect(res.body.facultyId).toBe('FAC-MATH-001');
      expect(res.body.department).toBe('Mathematics');
      expect(res.body.designation).toBe('Senior Professor');
    }
  });

  it('supports alias fields name and faculty_id, and defaults designation to Faculty', () => {
    const aliasPayload = {
      name: 'Jane Smith',
      phone: '+919876543211',
      password: 'Password123',
      faculty_id: 'FAC-PHY-002',
      department: 'Physics',
    };

    const res = validateRequestBody(aliasPayload);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.body.fullName).toBe('Jane Smith');
      expect(res.body.facultyId).toBe('FAC-PHY-002');
      expect(res.body.designation).toBe('Faculty');
      expect(res.body.email).toBeUndefined();
    }
  });

  it('rejects missing full name', () => {
    const res = validateRequestBody({
      phone: '+919876543210',
      password: 'password123',
      facultyId: 'FAC001',
      department: 'Chemistry',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('Full name is required.');
    }
  });

  it('rejects missing or invalid phone number format', () => {
    const resMissing = validateRequestBody({
      fullName: 'Test User',
      password: 'password123',
      facultyId: 'FAC001',
      department: 'Chemistry',
    });
    expect(resMissing.ok).toBe(false);
    if (!resMissing.ok) {
      expect(resMissing.error).toBe('Phone number is required.');
    }

    const resInvalid = validateRequestBody({
      fullName: 'Test User',
      phone: '9876543210', // Missing + country code
      password: 'password123',
      facultyId: 'FAC001',
      department: 'Chemistry',
    });
    expect(resInvalid.ok).toBe(false);
    if (!resInvalid.ok) {
      expect(resInvalid.error).toContain('Please enter a valid phone number with country code');
    }
  });

  it('rejects passwords shorter than 6 characters', () => {
    const res = validateRequestBody({
      fullName: 'Test User',
      phone: '+919876543210',
      password: '123',
      facultyId: 'FAC001',
      department: 'Chemistry',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('Password must be at least 6 characters.');
    }
  });

  it('rejects invalid email formats when email is provided', () => {
    const res = validateRequestBody({
      fullName: 'Test User',
      phone: '+919876543210',
      password: 'password123',
      email: 'invalid-email-address',
      facultyId: 'FAC001',
      department: 'Chemistry',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('Please enter a valid email address.');
    }
  });

  it('rejects missing faculty ID', () => {
    const res = validateRequestBody({
      fullName: 'Test User',
      phone: '+919876543210',
      password: 'password123',
      department: 'Chemistry',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('Faculty ID is required.');
    }
  });

  it('rejects missing department', () => {
    const res = validateRequestBody({
      fullName: 'Test User',
      phone: '+919876543210',
      password: 'password123',
      facultyId: 'FAC001',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('Department is required.');
    }
  });
});

describe('Super Admin UI Authorization & Permissions Guard', () => {
  const superAdminRoles: AdminRoleAssignment[] = [
    {
      adminRoleId: 'r1',
      profileId: 'p1',
      instituteId: 'i1',
      adminRole: 'super_admin',
      accessStatus: 'approved',
      grantedBy: null,
      accessGrantedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  const academicAdminRoles: AdminRoleAssignment[] = [
    {
      adminRoleId: 'r2',
      profileId: 'p2',
      instituteId: 'i1',
      adminRole: 'academic_admin',
      accessStatus: 'approved',
      grantedBy: 'p1',
      accessGrantedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  const financeAdminRoles: AdminRoleAssignment[] = [
    {
      adminRoleId: 'r3',
      profileId: 'p3',
      instituteId: 'i1',
      adminRole: 'finance_admin',
      accessStatus: 'approved',
      grantedBy: 'p1',
      accessGrantedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  it('identifies Super Admin correctly for rendering Add Teacher action ✅', () => {
    expect(checkIsSuperAdmin(superAdminRoles)).toBe(true);
  });

  it('blocks Academic Admin from Add Teacher action ✅', () => {
    expect(checkIsSuperAdmin(academicAdminRoles)).toBe(false);
    expect(checkIsAcademicAdmin(academicAdminRoles)).toBe(true);
  });

  it('blocks Finance Admin from Add Teacher action ✅', () => {
    expect(checkIsSuperAdmin(financeAdminRoles)).toBe(false);
    expect(checkIsFinanceAdmin(financeAdminRoles)).toBe(true);
  });
});

describe('teacherLifecycleService.createTeacher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleInput: CreateTeacherInput = {
    fullName: 'Professor Albus',
    phone: '+919988776655',
    password: 'SecretPassword99',
    email: 'albus@hogwarts.edu',
    facultyId: 'FAC-ALBUS-01',
    department: 'Transfiguration',
    designation: 'Headmaster',
  };

  it('rejects non-super-admin callers before invoking edge function', async () => {
    mockIsSuperAdmin.mockResolvedValue(false);

    const result = await teacherLifecycleService.createTeacher(sampleInput);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Only a super admin can create teacher accounts.');
    expect(mockFunctionsInvoke).not.toHaveBeenCalled();
  });

  it('successfully creates teacher when caller is super admin', async () => {
    mockIsSuperAdmin.mockResolvedValue(true);
    mockFunctionsInvoke.mockResolvedValue({
      data: {
        success: true,
        teacherId: 'teacher-uuid-111',
        profileId: 'user-uuid-222',
        fullName: 'Professor Albus',
        phone: '+919988776655',
        email: 'albus@hogwarts.edu',
        facultyId: 'FAC-ALBUS-01',
        department: 'Transfiguration',
        designation: 'Headmaster',
        role: 'teacher',
        accountStatus: 'approved',
        instituteId: 'inst-uuid-333',
      },
      error: null,
    });
    mockAuditLogCreate.mockResolvedValue({ success: true });

    const result = await teacherLifecycleService.createTeacher(sampleInput);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.teacherId).toBe('teacher-uuid-111');
    expect(result.data?.profileId).toBe('user-uuid-222');
    expect(result.data?.role).toBe('teacher');
    expect(result.data?.accountStatus).toBe('approved');
    expect(result.data?.facultyId).toBe('FAC-ALBUS-01');
    expect(result.data?.department).toBe('Transfiguration');
    expect(result.data?.designation).toBe('Headmaster');

    expect(mockFunctionsInvoke).toHaveBeenCalledWith(
      'teacher-identity-create',
      expect.objectContaining({
        body: {
          fullName: 'Professor Albus',
          email: 'albus@hogwarts.edu',
          phone: '+919988776655',
          password: 'SecretPassword99',
          facultyId: 'FAC-ALBUS-01',
          department: 'Transfiguration',
          designation: 'Headmaster',
        },
      }),
    );

    expect(mockAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'profiles',
        resourceId: 'user-uuid-222',
        metadata: expect.objectContaining({
          role: 'teacher',
          accountStatus: 'approved',
          facultyId: 'FAC-ALBUS-01',
        }),
      }),
      { strict: true },
    );
  });

  it('surfaces error from edge function if duplicate phone/email/facultyId is returned', async () => {
    mockIsSuperAdmin.mockResolvedValue(true);
    mockFunctionsInvoke.mockResolvedValue({
      data: {
        success: false,
        error: 'A teacher with this Faculty ID already exists in your institute.',
      },
      error: null,
    });

    const result = await teacherLifecycleService.createTeacher(sampleInput);
    expect(result.success).toBe(false);
    expect(result.error).toBe('A teacher with this Faculty ID already exists in your institute.');
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });
});
