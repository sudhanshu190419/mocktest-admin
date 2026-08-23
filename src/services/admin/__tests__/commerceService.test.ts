import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}));

vi.mock('@/config/supabase', () => ({
  supabase: {
    from: mockFrom,
  },
}));

import { commerceService } from '../commerceService';

const INSTITUTE_ID = '11111111-1111-4111-8111-111111111111';

describe('commerceService.getDashboardMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calculates totalRevenue only from confirmed orders and excludes pending/cancelled/refunded', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'orders') {
        return {
          select: vi.fn().mockReturnValue({
            match: vi.fn().mockResolvedValue({
              data: [
                { total_amount: 1200, status: 'confirmed' },
                { total_amount: 800, status: 'confirmed' },
                { total_amount: 500, status: 'pending' },
                { total_amount: 300, status: 'cancelled' },
                { total_amount: 400, status: 'refunded' },
              ],
              count: 5,
              error: null,
            }),
          }),
        };
      }
      if (table === 'payments') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation((col: string, val: string) => ({
              match: vi.fn().mockResolvedValue({
                count: val === 'captured' ? 2 : 1,
                error: null,
              }),
            })),
          }),
        };
      }
      if (table === 'course_enrollments') {
        return {
          select: vi.fn().mockReturnValue({
            match: vi.fn().mockResolvedValue({
              count: 4,
              error: null,
            }),
          }),
        };
      }
      if (table === 'student_pyq_purchases') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              match: vi.fn().mockResolvedValue({
                count: 7,
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          match: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
        }),
      };
    });

    const result = await commerceService.getDashboardMetrics(INSTITUTE_ID);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    // Confirmed orders: 1200 + 800 = 2000
    expect(result.data?.totalRevenue).toBe(2000);
    expect(result.data?.totalOrders).toBe(5);
    expect(result.data?.capturedPayments).toBe(2);
    expect(result.data?.pendingPayments).toBe(1);
    expect(result.data?.courseEnrollments).toBe(4);
    expect(result.data?.pyqPurchases).toBe(7);
  });

  it('returns 0 revenue when there are no orders or no confirmed orders', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'orders') {
        return {
          select: vi.fn().mockReturnValue({
            match: vi.fn().mockResolvedValue({
              data: [
                { total_amount: 500, status: 'pending' },
                { total_amount: 300, status: 'cancelled' },
              ],
              count: 2,
              error: null,
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            match: vi.fn().mockResolvedValue({ count: 0, error: null }),
          }),
          match: vi.fn().mockResolvedValue({ count: 0, error: null }),
        }),
      };
    });

    const result = await commerceService.getDashboardMetrics(INSTITUTE_ID);

    expect(result.success).toBe(true);
    expect(result.data?.totalRevenue).toBe(0);
    expect(result.data?.totalOrders).toBe(2);
  });
});
