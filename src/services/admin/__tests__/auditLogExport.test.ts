import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFrom, mockAuditLog } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockAuditLog: vi.fn().mockResolvedValue({ success: true, logId: 'log-1' }),
}));

vi.mock('@/config/supabase', () => ({
  supabase: {
    from: mockFrom,
  },
}));

vi.mock('@/services/audit/auditService', () => ({
  auditService: {
    log: mockAuditLog,
  },
}));

import { auditLogService } from '../auditLogService';

function mockChain(data: any = null, error: any = null) {
  const result = { data, error };
  const c: Record<string, any> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.gte = vi.fn().mockReturnValue(c);
  c.lte = vi.fn().mockReturnValue(c);
  c.or = vi.fn().mockReturnValue(c);
  c.order = vi.fn().mockReturnValue(c);
  c.limit = vi.fn().mockResolvedValue(result);
  c.then = (onFulfilled: any, onRejected?: any) => {
    if (error && onRejected) return onRejected(error);
    return onFulfilled(result);
  };
  return c;
}

const INSTITUTE_ID = '11111111-1111-4111-8111-111111111111';

describe('auditLogService - CSV Export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports matching audit records to formatted CSV and redacts secrets', async () => {
    const mockRows = [
      {
        log_id: 'log-1',
        institute_id: INSTITUTE_ID,
        profile_id: 'user-1',
        actor_role: 'super_admin',
        action: 'create',
        resource_type: 'mock_tests',
        resource_id: 'test-uuid-1',
        ip_address: '192.168.1.1',
        metadata: {
          title: 'NEET Mock Test 2025',
          secret_token: 'superSecretToken123',
          passwordHash: 'hash1234',
        },
        performed_at: '2026-08-22T10:00:00Z',
        outcome: 'success',
        reason: 'Initial creation',
        profiles: {
          name: 'Super Admin User',
          email: 'admin@institute.com',
        },
        institutes: {
          name: 'Apex Institute',
        },
      },
    ];

    mockFrom.mockReturnValue(mockChain(mockRows, null));

    const result = await auditLogService.exportLogs(
      INSTITUTE_ID,
      { action: 'create', resourceType: 'mock_tests' },
      { sortDirection: 'desc' }
    );

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.rowCount).toBe(1);
    expect(result.data?.fileName).toMatch(/^audit_logs_export_\d{4}-\d{2}-\d{2}\.csv$/);

    const csv = result.data?.csv ?? '';
    expect(csv).toContain('"Timestamp (ISO)","Action","Resource Type","Resource ID","Entity Name"');
    expect(csv).toContain('"NEET Mock Test 2025"');
    expect(csv).toContain('"Super Admin User"');
    expect(csv).toContain('"admin@institute.com"');

    // Verify secrets are redacted
    expect(csv).not.toContain('superSecretToken123');
    expect(csv).not.toContain('hash1234');
    expect(csv).toContain('[REDACTED]');

    // Verify audit log for export was emitted
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'export',
        resourceType: 'audit_logs',
        metadata: expect.objectContaining({
          rowCount: 1,
        }),
      })
    );
  });

  it('guards against CSV formula injection', async () => {
    const mockRows = [
      {
        log_id: 'log-2',
        institute_id: INSTITUTE_ID,
        profile_id: 'user-2',
        actor_role: 'teacher',
        action: 'update',
        resource_type: 'questions',
        resource_id: 'q-uuid-2',
        ip_address: '10.0.0.1',
        metadata: {
          title: '=CMD|calc.exe',
        },
        performed_at: '2026-08-22T11:00:00Z',
        outcome: 'success',
        reason: '+SUM(A1:A10)',
        profiles: {
          name: '@Hacker',
          email: '-malicious@test.com',
        },
      },
    ];

    mockFrom.mockReturnValue(mockChain(mockRows, null));

    const result = await auditLogService.exportLogs(INSTITUTE_ID);
    expect(result.success).toBe(true);

    const csv = result.data?.csv ?? '';
    expect(csv).toContain("'=CMD|calc.exe");
    expect(csv).toContain("'+SUM(A1:A10)");
    expect(csv).toContain("'@Hacker");
    expect(csv).toContain("'-malicious@test.com");
  });
});