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

  it('keeps unrelated reference types unchanged', () => {
    expect(buildActionUrl('live_class', 'lc-1')).toBe('/live-classes/lc-1');
    expect(buildActionUrl('live_class', 'lc-1', 'admin')).toBe('/live-classes/lc-1');
  });
});
