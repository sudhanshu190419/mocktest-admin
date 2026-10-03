import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getNotifications, getUnreadNotifications } from '../notificationService';
import { supabase } from '@/config/supabase';

vi.mock('@/config/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

describe('Notification Service Phase 4 Optimizations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reuses the exact count when filtering isRead: false and avoids redundant getUnreadCount query', async () => {
    const validUuid = '11111111-1111-4111-8111-111111111111';
    const mockQueryBuilder: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({
        data: [
          {
            recipient_id: '11111111-1111-4111-8111-111111111112',
            profile_id: validUuid,
            is_read: false,
            read_at: null,
            received_at: '2026-09-29T10:00:00Z',
            notification: {
              notification_id: '11111111-1111-4111-8111-111111111113',
              institute_id: '11111111-1111-4111-8111-111111111114',
              template_id: null,
              title: 'Test Notification',
              body: 'Test Body',
              channel: 'in_app',
              event_type: 'general',
              triggered_by: null,
              reference_type: null,
              reference_id: null,
              total_recipients: 1,
              dispatched_at: '2026-09-29T10:00:00Z',
              is_deleted: false,
              deleted_at: null,
              created_at: '2026-09-29T10:00:00Z',
              updated_at: '2026-09-29T10:00:00Z',
            },
          },
        ],
        error: null,
        count: 7, // 7 unread notifications
      }),
    };

    vi.mocked(supabase.from).mockReturnValue(mockQueryBuilder);

    const result = await getNotifications(validUuid, { isRead: false });

    expect(result.success).toBe(true);
    expect(result.data?.unreadCount).toBe(7);
    expect(result.data?.total).toBe(7);

    // Ensure supabase.from was called only ONCE for the main query, NOT twice (avoiding redundant getUnreadCount round trip)
    expect(supabase.from).toHaveBeenCalledTimes(1);
    expect(supabase.from).toHaveBeenCalledWith('notification_recipients');
  });
});
