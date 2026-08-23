import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFrom, mockGetCurrentAdminRoles, mockIsSuperAdmin, mockAuditLog, mockGetUser } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockGetCurrentAdminRoles: vi.fn(),
  mockIsSuperAdmin: vi.fn(),
  mockAuditLog: vi.fn().mockResolvedValue({ success: true, logId: 'log-1' }),
  mockGetUser: vi.fn(),
}));

vi.mock('@/config/supabase', () => ({
  supabase: {
    from: mockFrom,
    auth: {
      getUser: mockGetUser,
    },
  },
}));

vi.mock('@/services/admin/adminRoleService', () => ({
  adminRoleService: {
    getCurrentAdminRoles: mockGetCurrentAdminRoles,
    isSuperAdmin: mockIsSuperAdmin,
  },
}));

vi.mock('@/services/audit/auditService', () => ({
  auditService: {
    log: mockAuditLog,
    logCreate: mockAuditLog,
    logUpdate: mockAuditLog,
    logPublish: mockAuditLog,
    logSoftDelete: mockAuditLog,
  },
}));

import { pyqPackageService } from '../pyqPackageService';
import { pyqPaperService } from '../pyqPaperService';

function mockChain(data: any = null, error: any = null, count?: number) {
  const result = { data, error, count };
  const c: Record<string, any> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.insert = vi.fn().mockReturnValue(c);
  c.update = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.is = vi.fn().mockReturnValue(c);
  c.ilike = vi.fn().mockReturnValue(c);
  c.order = vi.fn().mockReturnValue(c);
  c.range = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue(result);
  c.maybeSingle = vi.fn().mockResolvedValue(result);
  c.then = (onFulfilled: any, onRejected?: any) => {
    if (error && onRejected) return onRejected(error);
    return onFulfilled(result);
  };
  return c;
}

const INSTITUTE_ID = '11111111-1111-4111-8111-111111111111';
const STREAM_ID = '22222222-2222-4222-8222-222222222222';
const PACKAGE_ID = '33333333-3333-4333-8333-333333333333';
const PAPER_ID = '44444444-4444-4444-8444-444444444444';

describe('PYQ Domain Role Authorization Model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('PYQ Packages — Super Admin & Academic Admin Allowed', () => {
    it('allows Super Admin to create a package', async () => {
      mockGetCurrentAdminRoles.mockResolvedValue({
        success: true,
        data: [{ adminRole: 'super_admin', accessStatus: 'approved' }],
      });
      mockGetUser.mockResolvedValue({ data: { user: { id: 'super-1' } } });

      const createdRow = {
        package_id: PACKAGE_ID,
        institute_id: INSTITUTE_ID,
        stream_id: STREAM_ID,
        name: 'JEE Main 2025 PYQ Package',
        price: '999.00',
        currency: 'INR',
        is_active: false,
        total_papers: 0,
        created_at: '2026-08-22T10:00:00Z',
        updated_at: '2026-08-22T10:00:00Z',
        streams: { name: 'Engineering' },
      };

      mockFrom.mockImplementation((table: string) => {
        if (table === 'profiles') return mockChain({ institute_id: INSTITUTE_ID });
        if (table === 'pyq_packages') return mockChain(createdRow);
        return mockChain(null);
      });

      const result = await pyqPackageService.createPackage({
        name: 'JEE Main 2025 PYQ Package',
        streamId: STREAM_ID,
        price: 999,
        instituteId: INSTITUTE_ID,
      });

      expect(result.success).toBe(true);
      expect(result.data?.packageId).toBe(PACKAGE_ID);
    });

    it('allows Academic Admin to create a package', async () => {
      mockGetCurrentAdminRoles.mockResolvedValue({
        success: true,
        data: [{ adminRole: 'academic_admin', accessStatus: 'approved' }],
      });
      mockGetUser.mockResolvedValue({ data: { user: { id: 'academic-1' } } });

      const createdRow = {
        package_id: PACKAGE_ID,
        institute_id: INSTITUTE_ID,
        stream_id: STREAM_ID,
        name: 'NEET 2025 PYQ Package',
        price: '799.00',
        currency: 'INR',
        is_active: false,
        total_papers: 0,
        created_at: '2026-08-22T10:00:00Z',
        updated_at: '2026-08-22T10:00:00Z',
        streams: { name: 'Medical' },
      };

      mockFrom.mockImplementation((table: string) => {
        if (table === 'profiles') return mockChain({ institute_id: INSTITUTE_ID });
        if (table === 'pyq_packages') return mockChain(createdRow);
        return mockChain(null);
      });

      const result = await pyqPackageService.createPackage({
        name: 'NEET 2025 PYQ Package',
        streamId: STREAM_ID,
        price: 799,
        instituteId: INSTITUTE_ID,
      });

      expect(result.success).toBe(true);
      expect(result.data?.packageId).toBe(PACKAGE_ID);
    });

    it('allows Academic Admin to update package metadata', async () => {
      mockGetCurrentAdminRoles.mockResolvedValue({
        success: true,
        data: [{ adminRole: 'academic_admin', accessStatus: 'approved' }],
      });
      mockGetUser.mockResolvedValue({ data: { user: { id: 'academic-1' } } });

      const updatedRow = {
        package_id: PACKAGE_ID,
        institute_id: INSTITUTE_ID,
        stream_id: STREAM_ID,
        name: 'NEET 2025 PYQ Package (Revised)',
        price: '899.00',
        currency: 'INR',
        is_active: false,
        total_papers: 0,
        created_at: '2026-08-22T10:00:00Z',
        updated_at: '2026-08-22T10:00:00Z',
        streams: { name: 'Medical' },
      };

      mockFrom.mockReturnValue(mockChain(updatedRow));

      const result = await pyqPackageService.updatePackage(PACKAGE_ID, {
        name: 'NEET 2025 PYQ Package (Revised)',
        price: 899,
      });

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('NEET 2025 PYQ Package (Revised)');
    });
  });

  describe('PYQ Packages — Finance Admin, Teacher, Student Denied', () => {
    it('denies Finance Admin from creating packages', async () => {
      mockGetCurrentAdminRoles.mockResolvedValue({
        success: true,
        data: [{ adminRole: 'finance_admin', accessStatus: 'approved' }],
      });

      const result = await pyqPackageService.createPackage({
        name: 'Finance Attempt Package',
        streamId: STREAM_ID,
        price: 499,
        instituteId: INSTITUTE_ID,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Only a Super Admin or Academic Admin can create PYQ packages');
    });

    it('denies Teacher from creating packages', async () => {
      mockGetCurrentAdminRoles.mockResolvedValue({
        success: true,
        data: [],
      });

      const result = await pyqPackageService.createPackage({
        name: 'Teacher Attempt Package',
        streamId: STREAM_ID,
        price: 499,
        instituteId: INSTITUTE_ID,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Only a Super Admin or Academic Admin can create PYQ packages');
    });

    it('denies Finance Admin from deleting packages', async () => {
      mockGetCurrentAdminRoles.mockResolvedValue({
        success: true,
        data: [{ adminRole: 'finance_admin', accessStatus: 'approved' }],
      });

      const result = await pyqPackageService.deletePackage(PACKAGE_ID);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Only a Super Admin or Academic Admin can delete PYQ packages');
    });
  });

  describe('PYQ Papers — Super Admin & Academic Admin Allowed', () => {
    it('allows Super Admin to create a paper', async () => {
      mockGetCurrentAdminRoles.mockResolvedValue({
        success: true,
        data: [{ adminRole: 'super_admin', accessStatus: 'approved' }],
      });
      mockGetUser.mockResolvedValue({ data: { user: { id: 'super-1' } } });

      const pkgRow = { institute_id: INSTITUTE_ID, stream_id: STREAM_ID };
      const paperRow = {
        paper_id: PAPER_ID,
        package_id: PACKAGE_ID,
        institute_id: INSTITUTE_ID,
        stream_id: STREAM_ID,
        title: 'JEE Advanced 2024 Paper 1',
        exam_year: 2024,
        total_questions: 0,
        is_published: false,
        created_at: '2026-08-22T10:00:00Z',
        updated_at: '2026-08-22T10:00:00Z',
      };

      mockFrom.mockImplementation((table: string) => {
        if (table === 'pyq_packages') return mockChain(pkgRow);
        if (table === 'pyq_papers') return mockChain(paperRow);
        return mockChain(null);
      });

      const result = await pyqPaperService.createPaper({
        packageId: PACKAGE_ID,
        title: 'JEE Advanced 2024 Paper 1',
        examYear: 2024,
      });

      expect(result.success).toBe(true);
      expect(result.data?.paperId).toBe(PAPER_ID);
    });

    it('allows Academic Admin to create a paper and override another author', async () => {
      mockGetCurrentAdminRoles.mockResolvedValue({
        success: true,
        data: [{ adminRole: 'academic_admin', accessStatus: 'approved' }],
      });
      mockGetUser.mockResolvedValue({ data: { user: { id: 'academic-1' } } });

      const pkgRow = { institute_id: INSTITUTE_ID, stream_id: STREAM_ID };
      const paperRow = {
        paper_id: PAPER_ID,
        package_id: PACKAGE_ID,
        institute_id: INSTITUTE_ID,
        stream_id: STREAM_ID,
        title: 'NEET 2024 Official Paper',
        exam_year: 2024,
        created_by: 'teacher-other-user',
        total_questions: 0,
        is_published: false,
        created_at: '2026-08-22T10:00:00Z',
        updated_at: '2026-08-22T10:00:00Z',
      };

      mockFrom.mockImplementation((table: string) => {
        if (table === 'pyq_packages') return mockChain(pkgRow);
        if (table === 'pyq_papers') return mockChain(paperRow);
        return mockChain(null);
      });

      const result = await pyqPaperService.createPaper({
        packageId: PACKAGE_ID,
        title: 'NEET 2024 Official Paper',
        examYear: 2024,
      });

      expect(result.success).toBe(true);
      expect(result.data?.paperId).toBe(PAPER_ID);
    });
  });

  describe('PYQ Papers — Teacher & Finance Admin Denied', () => {
    it('denies Teacher from creating papers', async () => {
      mockGetCurrentAdminRoles.mockResolvedValue({
        success: true,
        data: [],
      });
      mockGetUser.mockResolvedValue({ data: { user: { id: 'teacher-1' } } });

      const result = await pyqPaperService.createPaper({
        packageId: PACKAGE_ID,
        title: 'Teacher Created Paper',
        examYear: 2024,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Only a Super Admin or Academic Admin can create PYQ papers');
    });

    it('denies Teacher from modifying papers even if created_by matches', async () => {
      mockGetCurrentAdminRoles.mockResolvedValue({
        success: true,
        data: [],
      });
      mockGetUser.mockResolvedValue({ data: { user: { id: 'teacher-1' } } });

      const result = await pyqPaperService.updatePaper(PAPER_ID, {
        title: 'Teacher Renamed Paper',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Only a Super Admin or Academic Admin can manage PYQ papers');
    });

    it('denies Finance Admin from deleting or publishing papers', async () => {
      mockGetCurrentAdminRoles.mockResolvedValue({
        success: true,
        data: [{ adminRole: 'finance_admin', accessStatus: 'approved' }],
      });
      mockGetUser.mockResolvedValue({ data: { user: { id: 'finance-1' } } });

      const result = await pyqPaperService.deletePaper(PAPER_ID);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Only a Super Admin or Academic Admin can manage PYQ papers');
    });
  });
});
