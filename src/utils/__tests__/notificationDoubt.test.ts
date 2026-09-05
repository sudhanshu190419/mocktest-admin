import { describe, it, expect } from 'vitest';
import {
  notificationIcon,
  notificationTypeLabel,
  buildActionUrl,
} from '@/utils/notification';

describe('doubt notification mapping (Phase 7E)', () => {
  it('maps every doubt event to an icon', () => {
    expect(notificationIcon('doubt_submitted')).toBe('❓');
    expect(notificationIcon('doubt_assigned')).toBe('📥');
    expect(notificationIcon('doubt_answered')).toBe('✅');
    expect(notificationIcon('doubt_follow_up')).toBe('💬');
    expect(notificationIcon('doubt_resolved')).toBe('🎉');
    expect(notificationIcon('doubt_reopened')).toBe('🔄');
    expect(notificationIcon('doubt_unassigned')).toBe('⚠️');
  });

  it('maps every doubt event to a human label', () => {
    expect(notificationTypeLabel('doubt_submitted')).toBe('New Doubt');
    expect(notificationTypeLabel('doubt_assigned')).toBe('Doubt Assigned');
    expect(notificationTypeLabel('doubt_answered')).toBe('Doubt Answered');
    expect(notificationTypeLabel('doubt_follow_up')).toBe('Doubt Follow-up');
    expect(notificationTypeLabel('doubt_resolved')).toBe('Doubt Resolved');
    expect(notificationTypeLabel('doubt_reopened')).toBe('Doubt Reopened');
    expect(notificationTypeLabel('doubt_unassigned')).toBe('Doubt Needs Assignment');
  });

  it('deep-links student_doubt notifications to the teacher doubt detail', () => {
    expect(buildActionUrl('student_doubt', 'd-123')).toBe('/teacher/doubts/d-123');
    expect(buildActionUrl('student_doubt', null)).toBeNull();
    expect(buildActionUrl(null, 'd-123')).toBeNull();
  });

  it('deep-links doubt notifications to the admin page for the admin audience (Phase 7F)', () => {
    expect(buildActionUrl('student_doubt', 'd-123', 'admin')).toBe('/admin/doubts/d-123');
    // Default audience stays the teacher page (backward compatible).
    expect(buildActionUrl('student_doubt', 'd-123', 'teacher')).toBe('/teacher/doubts/d-123');
  });

  it('routes Admin reference types to correct Admin-scoped routes', () => {
    expect(buildActionUrl('mock_test', 'mt-1', 'admin')).toBe('/admin/mock-tests/mt-1');
    expect(buildActionUrl('content', 'c-1', 'admin')).toBe('/admin/content/review/c-1');
    expect(buildActionUrl('student_doubt', 'd-1', 'admin')).toBe('/admin/doubts/d-1');
    expect(buildActionUrl('order', 'o-1', 'admin')).toBe('/admin/commerce/orders');
    expect(buildActionUrl('live_class', 'lc-1', 'admin')).toBe('/admin/demo-classes/lc-1');
    expect(buildActionUrl('pyq_package', 'p-1', 'admin')).toBe('/admin/pyq-packages/p-1');
    expect(buildActionUrl('question', 'q-1', 'admin')).toBe('/admin/questions/q-1');
    expect(buildActionUrl('course', 'crs-1', 'admin')).toBe('/admin/courses/crs-1');
    expect(buildActionUrl('batch', 'b-1', 'admin')).toBe('/admin/batches/b-1');
    expect(buildActionUrl('trusted_devices', '39b3969a-ff86-4078-92b8-16cdb6738e2e', 'admin')).toBe('/admin/devices');
    expect(buildActionUrl('trusted_device', '39b3969a-ff86-4078-92b8-16cdb6738e2e', 'admin')).toBe('/admin/devices');
    expect(buildActionUrl('device', '39b3969a-ff86-4078-92b8-16cdb6738e2e', 'admin')).toBe('/admin/devices');
    expect(buildActionUrl('teacher_leave_request', 'leave-123', 'admin')).toBe('/admin/leave-requests/leave-123');
    expect(buildActionUrl('leave_request', 'leave-123', 'admin')).toBe('/admin/leave-requests/leave-123');
    expect(buildActionUrl('leave', 'leave-123', 'admin')).toBe('/admin/leave-requests/leave-123');
    expect(buildActionUrl('subscription', 'sub-123', 'admin')).toBe('/admin/commerce/subscriptions/sub-123');
    expect(buildActionUrl('subscription_plan', 'plan-123', 'admin')).toBe('/admin/commerce/subscription-plans');
  });

  it('routes Teacher reference types to correct Teacher-scoped routes', () => {
    expect(buildActionUrl('mock_test', 'mt-1', 'teacher')).toBe('/teacher/mock-tests/mt-1');
    expect(buildActionUrl('content', 'c-1', 'teacher')).toBe('/admin/content/review/c-1');
    expect(buildActionUrl('student_doubt', 'd-1', 'teacher')).toBe('/teacher/doubts/d-1');
    expect(buildActionUrl('live_class', 'lc-1', 'teacher')).toBe('/teacher/timetable');
    expect(buildActionUrl('question', 'q-1', 'teacher')).toBe('/teacher/questions/q-1');
    expect(buildActionUrl('teacher_leave_request', 'leave-123', 'teacher')).toBe('/teacher/leave');
    expect(buildActionUrl('leave_request', 'leave-123', 'teacher')).toBe('/teacher/leave');
    expect(buildActionUrl('leave', 'leave-123', 'teacher')).toBe('/teacher/leave');
  });
});
