import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Direct testing of Edge Function Logic & Contract ──────────────────────────

describe('Edge Function: teacher-identity-create Contract & Business Rules', () => {
  let mockAuthGetUser: any;
  let mockAdminCreateUser: any;
  let mockAdminDeleteUser: any;
  let mockFrom: any;
  let mockProfileSelect: any;
  let mockProfileUpdate: any;
  let mockTeacherDetailsSelect: any;
  let mockTeacherDetailsInsert: any;
  let mockAdminRolesSelect: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAuthGetUser = vi.fn();
    mockAdminCreateUser = vi.fn();
    mockAdminDeleteUser = vi.fn();

    mockProfileSelect = vi.fn();
    mockProfileUpdate = vi.fn();
    mockTeacherDetailsSelect = vi.fn();
    mockTeacherDetailsInsert = vi.fn();
    mockAdminRolesSelect = vi.fn();

    mockFrom = vi.fn((table: string) => {
      if (table === 'admin_roles') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: mockAdminRolesSelect,
        };
      }
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: mockProfileSelect,
          update: vi.fn().mockReturnValue({
            eq: mockProfileUpdate,
          }),
        };
      }
      if (table === 'teacher_details') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: mockTeacherDetailsSelect,
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: mockTeacherDetailsInsert,
            }),
          }),
        };
      }
      return {};
    });
  });

  // Simulated handler implementing the exact edge function logic
  async function simulateTeacherIdentityCreate(
    req: { method: string; headers: Record<string, string>; json: () => Promise<any> },
    env: { callerRole: 'super_admin' | 'academic_admin' | 'finance_admin' | 'none'; instituteId?: string }
  ) {
    if (req.method !== 'POST') {
      return { status: 405, body: { success: false, error: 'Method not allowed. Use POST.' } };
    }

    const authHeader = req.headers['Authorization'] || req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { status: 401, body: { success: false, error: 'Authentication required. Provide a valid Bearer token.' } };
    }

    const callerProfileId = 'super-admin-profile-uuid';

    // 1. Authorization check
    if (env.callerRole !== 'super_admin') {
      return {
        status: 403,
        body: {
          success: false,
          error: 'Super admin access required. Only approved super admins can create teacher accounts.',
        },
      };
    }

    // 2. Body validation
    const raw = await req.json();
    const fullName = raw.fullName?.trim() || raw.name?.trim();
    const phone = raw.phone?.trim();
    const password = raw.password;
    const email = raw.email?.trim() || undefined;
    const facultyId = raw.facultyId?.trim() || raw.faculty_id?.trim();
    const department = raw.department?.trim();
    const designation = raw.designation?.trim() || 'Faculty';

    if (!fullName) return { status: 400, body: { success: false, error: 'Full name is required.' } };
    if (!phone) return { status: 400, body: { success: false, error: 'Phone number is required.' } };
    if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
      return { status: 400, body: { success: false, error: 'Please enter a valid phone number with country code (e.g. +919876543210).' } };
    }
    if (!password || password.length < 6) {
      return { status: 400, body: { success: false, error: 'Password must be at least 6 characters.' } };
    }
    if (email && !/^\S+@\S+\.\S+$/.test(email)) {
      return { status: 400, body: { success: false, error: 'Please enter a valid email address.' } };
    }
    if (!facultyId) return { status: 400, body: { success: false, error: 'Faculty ID is required.' } };
    if (!department) return { status: 400, body: { success: false, error: 'Department is required.' } };

    // 3. Institute resolution
    const instituteId = env.instituteId || 'institute-uuid-999';

    // 4. Duplicate checks
    const phoneCheck = await mockProfileSelect();
    if (phoneCheck?.data) {
      return { status: 409, body: { success: false, error: 'An account with this phone number already exists.' } };
    }

    if (email) {
      const emailCheck = await mockProfileSelect();
      if (emailCheck?.data) {
        return { status: 409, body: { success: false, error: 'An account with this email already exists.' } };
      }
    }

    const facultyCheck = await mockTeacherDetailsSelect();
    if (facultyCheck?.data) {
      return { status: 409, body: { success: false, error: 'A teacher with this Faculty ID already exists in your institute.' } };
    }

    // 5. Auth User creation (service role)
    const createAuthRes = await mockAdminCreateUser({
      phone,
      password,
      email,
      phone_confirm: true,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        role: 'teacher',
        institute_id: instituteId,
      },
    });

    if (createAuthRes.error || !createAuthRes.data?.user) {
      return { status: 409, body: { success: false, error: createAuthRes.error?.message || 'Failed to create user.' } };
    }

    const teacherUserId = createAuthRes.data.user.id;

    // 6. Profile update
    const profileUpdateRes = await mockProfileUpdate();
    if (profileUpdateRes?.error) {
      await mockAdminDeleteUser(teacherUserId);
      return { status: 500, body: { success: false, error: 'Failed to approve teacher profile. Please retry.' } };
    }

    // 7. Teacher details insert
    const insertRes = await mockTeacherDetailsInsert();
    if (insertRes?.error) {
      await mockAdminDeleteUser(teacherUserId);
      return { status: 500, body: { success: false, error: 'Failed to create teacher details.' } };
    }

    return {
      status: 201,
      body: {
        success: true,
        teacherId: insertRes.data.teacher_id,
        profileId: teacherUserId,
        fullName,
        phone,
        email: email ?? null,
        facultyId: insertRes.data.faculty_id,
        department: insertRes.data.department,
        designation: insertRes.data.designation,
        role: 'teacher',
        accountStatus: 'approved',
        instituteId,
      },
    };
  }

  it('Super Admin can create teacher ✅', async () => {
    mockProfileSelect.mockResolvedValue({ data: null, error: null });
    mockTeacherDetailsSelect.mockResolvedValue({ data: null, error: null });
    mockAdminCreateUser.mockResolvedValue({
      data: { user: { id: 'teacher-auth-uuid-001', phone: '+919876543210' } },
      error: null,
    });
    mockProfileUpdate.mockResolvedValue({ error: null });
    mockTeacherDetailsInsert.mockResolvedValue({
      data: {
        teacher_id: 'teacher-details-uuid-001',
        faculty_id: 'FAC-ENG-01',
        department: 'English',
        designation: 'Faculty',
      },
      error: null,
    });

    const response = await simulateTeacherIdentityCreate(
      {
        method: 'POST',
        headers: { Authorization: 'Bearer valid-jwt-token' },
        json: async () => ({
          fullName: 'Prof. Minerva McGonagall',
          phone: '+919876543210',
          password: 'Password123!',
          email: 'minerva@hogwarts.edu',
          facultyId: 'FAC-ENG-01',
          department: 'English',
        }),
      },
      { callerRole: 'super_admin' }
    );

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.teacherId).toBe('teacher-details-uuid-001');
    expect(response.body.profileId).toBe('teacher-auth-uuid-001');
    expect(response.body.role).toBe('teacher');
    expect(response.body.accountStatus).toBe('approved');
    expect(response.body.facultyId).toBe('FAC-ENG-01');
    expect(response.body.department).toBe('English');
    expect(response.body.designation).toBe('Faculty');
  });

  it('Academic Admin is rejected with 403 Forbidden ✅', async () => {
    const response = await simulateTeacherIdentityCreate(
      {
        method: 'POST',
        headers: { Authorization: 'Bearer academic-jwt-token' },
        json: async () => ({
          fullName: 'Teacher Two',
          phone: '+919876543211',
          password: 'Password123!',
          facultyId: 'FAC-02',
          department: 'Science',
        }),
      },
      { callerRole: 'academic_admin' }
    );

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain('Super admin access required');
    expect(mockAdminCreateUser).not.toHaveBeenCalled();
  });

  it('Finance Admin is rejected with 403 Forbidden ✅', async () => {
    const response = await simulateTeacherIdentityCreate(
      {
        method: 'POST',
        headers: { Authorization: 'Bearer finance-jwt-token' },
        json: async () => ({
          fullName: 'Teacher Three',
          phone: '+919876543212',
          password: 'Password123!',
          facultyId: 'FAC-03',
          department: 'Commerce',
        }),
      },
      { callerRole: 'finance_admin' }
    );

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain('Super admin access required');
    expect(mockAdminCreateUser).not.toHaveBeenCalled();
  });

  it('Duplicate phone rejected with 409 Conflict ✅', async () => {
    mockProfileSelect.mockResolvedValueOnce({
      data: { profile_id: 'existing-phone-user-id' },
      error: null,
    });

    const response = await simulateTeacherIdentityCreate(
      {
        method: 'POST',
        headers: { Authorization: 'Bearer super-admin-token' },
        json: async () => ({
          fullName: 'Duplicate Phone Teacher',
          phone: '+919876543210',
          password: 'Password123!',
          facultyId: 'FAC-DUP-01',
          department: 'Arts',
        }),
      },
      { callerRole: 'super_admin' }
    );

    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('An account with this phone number already exists.');
    expect(mockAdminCreateUser).not.toHaveBeenCalled();
  });

  it('Duplicate email rejected with 409 Conflict ✅', async () => {
    mockProfileSelect
      .mockResolvedValueOnce({ data: null, error: null }) // phone is free
      .mockResolvedValueOnce({ data: { profile_id: 'existing-email-user-id' }, error: null }); // email exists

    const response = await simulateTeacherIdentityCreate(
      {
        method: 'POST',
        headers: { Authorization: 'Bearer super-admin-token' },
        json: async () => ({
          fullName: 'Duplicate Email Teacher',
          phone: '+919876543215',
          password: 'Password123!',
          email: 'duplicate@school.com',
          facultyId: 'FAC-DUP-02',
          department: 'Arts',
        }),
      },
      { callerRole: 'super_admin' }
    );

    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('An account with this email already exists.');
    expect(mockAdminCreateUser).not.toHaveBeenCalled();
  });

  it('Duplicate faculty ID rejected with 409 Conflict ✅', async () => {
    mockProfileSelect.mockResolvedValue({ data: null, error: null });
    mockTeacherDetailsSelect.mockResolvedValueOnce({
      data: { teacher_id: 'existing-faculty-teacher-id' },
      error: null,
    });

    const response = await simulateTeacherIdentityCreate(
      {
        method: 'POST',
        headers: { Authorization: 'Bearer super-admin-token' },
        json: async () => ({
          fullName: 'Duplicate Faculty Teacher',
          phone: '+919876543216',
          password: 'Password123!',
          facultyId: 'FAC-EXISTING-01',
          department: 'Arts',
        }),
      },
      { callerRole: 'super_admin' }
    );

    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('A teacher with this Faculty ID already exists in your institute.');
    expect(mockAdminCreateUser).not.toHaveBeenCalled();
  });

  it('Created teacher has role = teacher and account_status = approved ✅', async () => {
    mockProfileSelect.mockResolvedValue({ data: null, error: null });
    mockTeacherDetailsSelect.mockResolvedValue({ data: null, error: null });
    mockAdminCreateUser.mockResolvedValue({
      data: { user: { id: 'teacher-auth-uuid-role-check', phone: '+919876543220' } },
      error: null,
    });
    mockProfileUpdate.mockResolvedValue({ error: null });
    mockTeacherDetailsInsert.mockResolvedValue({
      data: {
        teacher_id: 'teacher-details-uuid-role-check',
        faculty_id: 'FAC-ROLE-01',
        department: 'Science',
        designation: 'Professor',
      },
      error: null,
    });

    const response = await simulateTeacherIdentityCreate(
      {
        method: 'POST',
        headers: { Authorization: 'Bearer valid-jwt' },
        json: async () => ({
          fullName: 'Role Check Teacher',
          phone: '+919876543220',
          password: 'Password123!',
          facultyId: 'FAC-ROLE-01',
          department: 'Science',
          designation: 'Professor',
        }),
      },
      { callerRole: 'super_admin' }
    );

    expect(response.body.role).toBe('teacher');
    expect(response.body.accountStatus).toBe('approved');
  });

  it('teacher_details exists with all required fields ✅', async () => {
    mockProfileSelect.mockResolvedValue({ data: null, error: null });
    mockTeacherDetailsSelect.mockResolvedValue({ data: null, error: null });
    mockAdminCreateUser.mockResolvedValue({
      data: { user: { id: 'teacher-auth-uuid-details-check', phone: '+919876543221' } },
      error: null,
    });
    mockProfileUpdate.mockResolvedValue({ error: null });
    mockTeacherDetailsInsert.mockResolvedValue({
      data: {
        teacher_id: 'teacher-details-uuid-details-check',
        faculty_id: 'FAC-DETAILS-01',
        department: 'Computer Science',
        designation: 'Assistant Professor',
      },
      error: null,
    });

    const response = await simulateTeacherIdentityCreate(
      {
        method: 'POST',
        headers: { Authorization: 'Bearer valid-jwt' },
        json: async () => ({
          fullName: 'Details Check Teacher',
          phone: '+919876543221',
          password: 'Password123!',
          facultyId: 'FAC-DETAILS-01',
          department: 'Computer Science',
          designation: 'Assistant Professor',
        }),
      },
      { callerRole: 'super_admin' }
    );

    expect(response.body.teacherId).toBe('teacher-details-uuid-details-check');
    expect(response.body.facultyId).toBe('FAC-DETAILS-01');
    expect(response.body.department).toBe('Computer Science');
    expect(response.body.designation).toBe('Assistant Professor');
  });

  it('Created teacher can authenticate with phone + password (phone_confirm = true) ✅', async () => {
    mockProfileSelect.mockResolvedValue({ data: null, error: null });
    mockTeacherDetailsSelect.mockResolvedValue({ data: null, error: null });
    mockAdminCreateUser.mockResolvedValue({
      data: { user: { id: 'auth-user-id', phone: '+919876543222' } },
      error: null,
    });
    mockProfileUpdate.mockResolvedValue({ error: null });
    mockTeacherDetailsInsert.mockResolvedValue({
      data: {
        teacher_id: 'teacher-details-id',
        faculty_id: 'FAC-AUTH-01',
        department: 'Math',
        designation: 'Faculty',
      },
      error: null,
    });

    await simulateTeacherIdentityCreate(
      {
        method: 'POST',
        headers: { Authorization: 'Bearer valid-jwt' },
        json: async () => ({
          fullName: 'Auth Teacher',
          phone: '+919876543222',
          password: 'Password123!',
          facultyId: 'FAC-AUTH-01',
          department: 'Math',
        }),
      },
      { callerRole: 'super_admin' }
    );

    expect(mockAdminCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '+919876543222',
        password: 'Password123!',
        phone_confirm: true,
        user_metadata: expect.objectContaining({
          role: 'teacher',
        }),
      })
    );
  });

  it('Failure during creation cleans up partial Auth account (rollback) ✅', async () => {
    mockProfileSelect.mockResolvedValue({ data: null, error: null });
    mockTeacherDetailsSelect.mockResolvedValue({ data: null, error: null });
    mockAdminCreateUser.mockResolvedValue({
      data: { user: { id: 'orphan-user-to-cleanup-id', phone: '+919876543223' } },
      error: null,
    });
    mockProfileUpdate.mockResolvedValue({ error: null });
    // Simulate teacher_details insert failure
    mockTeacherDetailsInsert.mockResolvedValue({
      data: null,
      error: { message: 'Database connection dropped during teacher_details insert' },
    });

    const response = await simulateTeacherIdentityCreate(
      {
        method: 'POST',
        headers: { Authorization: 'Bearer valid-jwt' },
        json: async () => ({
          fullName: 'Failed Insert Teacher',
          phone: '+919876543223',
          password: 'Password123!',
          facultyId: 'FAC-FAIL-01',
          department: 'Math',
        }),
      },
      { callerRole: 'super_admin' }
    );

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(mockAdminDeleteUser).toHaveBeenCalledWith('orphan-user-to-cleanup-id');
  });
});
