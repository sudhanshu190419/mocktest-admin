import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}));

vi.mock('@/config/supabase', () => ({
  supabase: {
    from: mockFrom,
  },
}));

import { batchStudentAssignmentService } from '../batchStudentAssignmentService';

const BATCH_ID = '11111111-1111-4111-8111-111111111111';
const INSTITUTE_ID = '22222222-2222-4222-8222-222222222222';

describe('batchStudentAssignmentService.getAvailableStudents Search & Filter', () => {
  let mockProfiles: any[];
  let mockStudentDetails: any[];
  let mockBatchStudents: any[];

  beforeEach(() => {
    vi.clearAllMocks();

    mockProfiles = [
      {
        profile_id: 'prof-kdoeomm',
        name: 'Kdoeomm',
        email: 'kdoeomm@test.com',
        phone: '+919999999991',
        role: 'student',
        is_active: true,
        account_status: 'approved',
        institute_id: INSTITUTE_ID,
        student_details: {
          student_id: 'stu-kdoeomm',
          enrollment_no: 'ENR-2024-001',
          target_year: '2025',
        },
      },
      {
        profile_id: 'prof-alice',
        name: 'Alice Johnson',
        email: 'alice@test.com',
        phone: '+919999999992',
        role: 'student',
        is_active: true,
        account_status: 'approved',
        institute_id: INSTITUTE_ID,
        student_details: {
          student_id: 'stu-alice',
          enrollment_no: 'ENR-2024-002',
          target_year: '2025',
        },
      },
      {
        profile_id: 'prof-bob',
        name: 'Bob Williams',
        email: 'bob@test.com',
        phone: '+919999999993',
        role: 'student',
        is_active: true,
        account_status: 'approved',
        institute_id: INSTITUTE_ID,
        student_details: {
          student_id: 'stu-bob',
          enrollment_no: 'KDOE-SPECIAL',
          target_year: '2026',
        },
      },
    ];

    mockStudentDetails = [
      {
        student_id: 'stu-kdoeomm',
        profile_id: 'prof-kdoeomm',
        institute_id: INSTITUTE_ID,
        enrollment_no: 'ENR-2024-001',
      },
      {
        student_id: 'stu-alice',
        profile_id: 'prof-alice',
        institute_id: INSTITUTE_ID,
        enrollment_no: 'ENR-2024-002',
      },
      {
        student_id: 'stu-bob',
        profile_id: 'prof-bob',
        institute_id: INSTITUTE_ID,
        enrollment_no: 'KDOE-SPECIAL',
      },
    ];

    mockBatchStudents = [];

    mockFrom.mockImplementation((table: string) => {
      if (table === 'batches') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { institute_id: INSTITUTE_ID },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === 'batch_students') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: mockBatchStudents,
              error: null,
            }),
          }),
        };
      }

      if (table === 'student_details') {
        return {
          select: vi.fn().mockImplementation((fields: string) => ({
            eq: vi.fn().mockImplementation((col: string, val: string) => ({
              ilike: vi.fn().mockImplementation((col2: string, term: string) => {
                const searchStr = term.replace(/%/g, '').toLowerCase();
                const matched = mockStudentDetails.filter((sd) =>
                  sd.enrollment_no?.toLowerCase().includes(searchStr),
                );
                return Promise.resolve({
                  data: matched.map((m) => ({ profile_id: m.profile_id })),
                  error: null,
                });
              }),
            })),
            in: vi.fn().mockImplementation((col: string, vals: string[]) => ({
              data: mockStudentDetails.filter((sd) => vals.includes(sd.student_id)),
              error: null,
            })),
          })),
        };
      }

      if (table === 'profiles') {
        let currentData = [...mockProfiles];

        const queryObj: any = {
          eq: vi.fn().mockImplementation((col: string, val: any) => {
            currentData = currentData.filter((p) => (p as any)[col] === val);
            return queryObj;
          }),
          not: vi.fn().mockImplementation((col: string, op: string, val: string) => {
            return queryObj;
          }),
          ilike: vi.fn().mockImplementation((col: string, term: string) => {
            const searchStr = term.replace(/%/g, '').toLowerCase();
            currentData = currentData.filter((p) =>
              (p as any)[col]?.toLowerCase().includes(searchStr),
            );
            return queryObj;
          }),
          or: vi.fn().mockImplementation((expr: string) => {
            // expr shape: `name.ilike.%term%,profile_id.in.(id1,id2)`
            const nameMatch = expr.match(/name\.ilike\.%([^%]+)%/);
            const idMatch = expr.match(/profile_id\.in\.\(([^)]+)\)/);

            const nameTerm = nameMatch ? nameMatch[1].toLowerCase() : '';
            const allowedIds = idMatch ? idMatch[1].split(',') : [];

            currentData = currentData.filter((p) => {
              const matchesName = nameTerm ? p.name?.toLowerCase().includes(nameTerm) : false;
              const matchesId = allowedIds.includes(p.profile_id);
              return matchesName || matchesId;
            });
            return queryObj;
          }),
          order: vi.fn().mockImplementation(() => queryObj),
          then: (resolve: any) => resolve({ data: currentData, error: null }),
        };

        return {
          select: vi.fn().mockReturnValue(queryObj),
        };
      }

      return {};
    });
  });

  it('1. returns all available students when search is empty or undefined', async () => {
    const res = await batchStudentAssignmentService.getAvailableStudents(BATCH_ID);
    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(3);
    const names = res.data?.map((s) => s.studentName);
    expect(names).toContain('Kdoeomm');
    expect(names).toContain('Alice Johnson');
    expect(names).toContain('Bob Williams');
  });

  it('2. finds student "Kdoeomm" by exact name search', async () => {
    const res = await batchStudentAssignmentService.getAvailableStudents(BATCH_ID, 'Kdoeomm');
    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(1);
    expect(res.data?.[0].studentName).toBe('Kdoeomm');
    expect(res.data?.[0].studentId).toBe('stu-kdoeomm');
    expect(res.data?.[0].enrollmentNo).toBe('ENR-2024-001');
  });

  it('3. finds student "Kdoeomm" by lowercase name search', async () => {
    const res = await batchStudentAssignmentService.getAvailableStudents(BATCH_ID, 'kdoeomm');
    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(1);
    expect(res.data?.[0].studentName).toBe('Kdoeomm');
  });

  it('4. finds student "Kdoeomm" by partial name search ("doe")', async () => {
    const res = await batchStudentAssignmentService.getAvailableStudents(BATCH_ID, 'doe');
    expect(res.success).toBe(true);
    // Matches Kdoeomm by name and Bob Williams by enrollment (KDOE-SPECIAL)
    const names = res.data?.map((s) => s.studentName);
    expect(names).toContain('Kdoeomm');
  });

  it('5. finds student by enrollment number search ("ENR-2024-001")', async () => {
    const res = await batchStudentAssignmentService.getAvailableStudents(BATCH_ID, 'ENR-2024-001');
    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(1);
    expect(res.data?.[0].studentName).toBe('Kdoeomm');
    expect(res.data?.[0].enrollmentNo).toBe('ENR-2024-001');
  });

  it('6. finds student by partial enrollment number search ("002")', async () => {
    const res = await batchStudentAssignmentService.getAvailableStudents(BATCH_ID, '002');
    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(1);
    expect(res.data?.[0].studentName).toBe('Alice Johnson');
    expect(res.data?.[0].enrollmentNo).toBe('ENR-2024-002');
  });

  it('7. returns empty list when no student matches search', async () => {
    const res = await batchStudentAssignmentService.getAvailableStudents(BATCH_ID, 'NonExistentXYZ');
    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(0);
  });

  it('8. returns error when student_details query fails', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'batches') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { institute_id: INSTITUTE_ID },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'batch_students') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      if (table === 'student_details') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              ilike: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Database connection failed' },
              }),
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  then: (resolve: any) => resolve({ data: [], error: null }),
                }),
              }),
            }),
          }),
        }),
      };
    });

    const res = await batchStudentAssignmentService.getAvailableStudents(BATCH_ID, 'test');
    expect(res.success).toBe(false);
    expect(res.error).toBe('Database connection failed');
  });
});
