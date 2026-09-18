import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import { supabase } from '@/config/supabase';
import {
  mapNotificationReferenceType,
  resolveNotificationWebHref,
  fetchStudentNotifications,
  fetchStudentUnreadNotificationCount,
  markStudentNotificationAsRead,
  markAllStudentNotificationsAsRead,
} from '@/services/student/studentNotificationWebService';

describe('1. Mobile App Parity & Type Mapping', () => {
  it('maps all standard reference_types to correct actionTypes matching MockTestApp', () => {
    expect(mapNotificationReferenceType('mock_test')).toBe('mockTestDetails');
    expect(mapNotificationReferenceType('test_result')).toBe('testResult');
    expect(mapNotificationReferenceType('live_class')).toBe('liveClassDetails');
    expect(mapNotificationReferenceType('course')).toBe('courseDetails');
    expect(mapNotificationReferenceType('content')).toBe('courseDetails');
    expect(mapNotificationReferenceType('student_doubt')).toBe('doubtDetails');
    expect(mapNotificationReferenceType('order')).toBe('paymentDetails');
    expect(mapNotificationReferenceType('payment')).toBe('paymentDetails');
    expect(mapNotificationReferenceType('announcement')).toBe('announcementDetails');
    expect(mapNotificationReferenceType('profile')).toBe('profile');
    expect(mapNotificationReferenceType('deep_link')).toBe('deepLink');
    expect(mapNotificationReferenceType(null)).toBe('systemAlert');
  });

  it('resolves actionTypes to valid Student Web destination routes', () => {
    // Mock Tests
    expect(resolveNotificationWebHref('mockTestDetails', 'test-123')).toBe('/student/tests/test-123');
    expect(resolveNotificationWebHref('mockTestDetails')).toBe('/student/tests');

    // Test Results
    expect(resolveNotificationWebHref('testResult', 'res-456')).toBe('/student/tests/res-456/results');
    expect(resolveNotificationWebHref('testResult')).toBe('/student/tests');

    // Live Classes
    expect(resolveNotificationWebHref('liveClassDetails', 'class-789')).toBe('/student/classes');
    expect(resolveNotificationWebHref('liveClassDetails')).toBe('/student/classes');

    // Courses
    expect(resolveNotificationWebHref('courseDetails', 'course-101')).toBe('/student/courses/course-101');
    expect(resolveNotificationWebHref('courseDetails')).toBe('/student/courses');

    // Doubts
    expect(resolveNotificationWebHref('doubtDetails', 'doubt-555')).toBe('/student/doubts/doubt-555');
    expect(resolveNotificationWebHref('doubtDetails')).toBe('/student/doubts');

    // Announcements & Profile
    expect(resolveNotificationWebHref('announcementDetails')).toBe('/student/overview');
    expect(resolveNotificationWebHref('profile')).toBe('/student/profile');
    expect(resolveNotificationWebHref('deepLink', '/student/timetable')).toBe('/student/timetable');
  });
});

describe('2. Student Notification Web Service Layer', () => {
  const mockUserId = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    vi.restoreAllMocks();

    // Mock auth user
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({
      data: { user: { id: mockUserId } as any },
      error: null,
    });
  });

  it('fetchStudentNotifications queries notification_recipients joined with notifications and maps payload', async () => {
    const mockDbRows = [
      {
        recipient_id: 'rec-1',
        is_read: false,
        received_at: '2026-09-16T10:00:00Z',
        notifications: {
          notification_id: 'notif-1',
          title: 'NEET Grand Test 1 Assigned',
          body: 'Your instructor has assigned a new 180-question mock test.',
          event_type: 'mock_test_assigned',
          reference_type: 'mock_test',
          reference_id: 'test-ne-01',
          created_at: '2026-09-16T10:00:00Z',
        },
      },
      {
        recipient_id: 'rec-2',
        is_read: true,
        received_at: '2026-09-15T15:30:00Z',
        notifications: {
          notification_id: 'notif-2',
          title: 'Doubt Resolved by Faculty',
          body: 'Teacher Sharma answered your physics doubt.',
          event_type: 'student_doubt',
          reference_type: 'student_doubt',
          reference_id: 'd-999',
          created_at: '2026-09-15T15:30:00Z',
        },
      },
    ];

    const mockQuery: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: mockDbRows, error: null, count: 2 }),
    };

    const mockCountQuery: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockImplementation((col: string, val: any) => {
        if (col === 'is_read' && val === false) {
          return Promise.resolve({ count: 1, error: null });
        }
        return mockCountQuery;
      }),
    };

    vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      if (table === 'notification_recipients') {
        // Return appropriate mock query based on calls
        return mockQuery;
      }
      return mockQuery;
    });

    const res = await fetchStudentNotifications({ page: 1, pageSize: 20 });

    expect(res.data).toHaveLength(2);
    expect(res.data[0].title).toBe('NEET Grand Test 1 Assigned');
    expect(res.data[0].type).toBe('mock-test');
    expect(res.data[0].isRead).toBe(false);
    expect(res.data[0].href).toBe('/student/tests/test-ne-01');

    expect(res.data[1].type).toBe('doubt');
    expect(res.data[1].isRead).toBe(true);
    expect(res.data[1].href).toBe('/student/doubts/d-999');
  });

  it('fetchStudentUnreadNotificationCount queries exact unread count for current user', async () => {
    vi.spyOn(supabase, 'from').mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockImplementation((col: string, val: any) => {
        if (col === 'is_read' && val === false) {
          return Promise.resolve({ count: 4, error: null });
        }
        return {
          eq: vi.fn().mockResolvedValue({ count: 4, error: null }),
        };
      }),
    } as any);

    const unread = await fetchStudentUnreadNotificationCount();
    expect(unread).toBe(4);
  });

  it('markStudentNotificationAsRead updates is_read flag on notification_recipients', async () => {
    const updateSpy = vi.fn().mockReturnThis();
    const eqSpy = vi.fn().mockReturnThis();

    vi.spyOn(supabase, 'from').mockReturnValue({
      update: updateSpy,
      eq: eqSpy,
      or: vi.fn().mockResolvedValue({ error: null }),
    } as any);

    const res = await markStudentNotificationAsRead('rec-12345');
    expect(res.success).toBe(true);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ is_read: true })
    );
  });

  it('markAllStudentNotificationsAsRead marks all unread notifications read for student', async () => {
    const updateSpy = vi.fn().mockReturnThis();
    const eqSpy = vi.fn().mockImplementation((col: string, val: any) => {
      if (col === 'is_read' && val === false) {
        return Promise.resolve({ error: null });
      }
      return {
        eq: vi.fn().mockResolvedValue({ error: null }),
      };
    });

    vi.spyOn(supabase, 'from').mockReturnValue({
      update: updateSpy,
      eq: eqSpy,
    } as any);

    const res = await markAllStudentNotificationsAsRead();
    expect(res.success).toBe(true);
  });
});

describe('3. StudentHeader & Notification Center UI Contract Verification', () => {
  const headerContent = fs.readFileSync('C:/Projects/mocktest-admin/src/components/student/StudentHeader.tsx', 'utf8');
  const centerContent = fs.readFileSync('C:/Projects/mocktest-admin/src/components/student/StudentNotificationCenter.tsx', 'utf8');

  it('Notification bell does NOT link to /student/profile', () => {
    // Check that notification bell does not redirect to profile
    expect(headerContent).not.toMatch(/<Link[^>]+href="\/student\/profile"[^>]*title="Notifications"/);
    expect(headerContent).not.toMatch(/href="\/student\/profile"[^>]*<Bell/);
  });

  it('Notification bell renders accessible button attributes', () => {
    expect(headerContent).toContain('aria-label=');
    expect(headerContent).toContain('aria-expanded=');
    expect(headerContent).toContain('aria-haspopup="dialog"');
  });

  it('StudentHeader mounts StudentNotificationCenter popover', () => {
    expect(headerContent).toContain('<StudentNotificationCenter');
    expect(headerContent).toContain('notificationCenterOpen');
    expect(headerContent).toContain('unreadCount=');
  });

  it('StudentNotificationCenter contains required empty, error, filter, and mark-all states', () => {
    expect(centerContent).toContain("You're all caught up.");
    expect(centerContent).toContain('Mark all read');
    expect(centerContent).toContain('Retry');
    expect(centerContent).toContain('animate-pulse'); // Loading skeletons
    expect(centerContent).toContain('handleNotificationClick');
    expect(centerContent).toContain("e.key === 'Escape'"); // Keyboard accessibility
  });
});
