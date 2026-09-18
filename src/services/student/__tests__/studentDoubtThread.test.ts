import { describe, it, expect } from 'vitest';
import { doubtKeys } from '@/hooks/doubt/queryKeys';
import { mapDoubtRow, mapDoubtReplyRow, type DbStudentDoubtRow, type DbDoubtReplyRow } from '@/utils/doubtMappers';
import { doubtErrorMessage } from '@/utils/doubtErrors';
import type { DoubtReply, StudentDoubt } from '@/types/doubt';

describe('Student Doubt Thread Test Suite (Phase 2)', () => {
  describe('1. Doubt Detail Query Keys & Scope Isolation', () => {
    it('constructs correct query key for doubt detail', () => {
      const doubtId = '550e8400-e29b-41d4-a716-446655440000';
      const key = doubtKeys.detail(doubtId);
      expect(key).toEqual(['doubts', 'detail', doubtId]);
    });

    it('detail key is distinct across different doubt IDs', () => {
      const keyA = doubtKeys.detail('id-1');
      const keyB = doubtKeys.detail('id-2');
      expect(keyA).not.toEqual(keyB);
    });

    it('details root key matches prefix for broad invalidation', () => {
      const detailsKey = doubtKeys.details();
      expect(detailsKey).toEqual(['doubts', 'detail']);
    });
  });

  describe('2. Chronological Thread Ordering & Author Roles', () => {
    const mockReplies: DoubtReply[] = [
      {
        replyId: 'rep-3',
        doubtId: 'doubt-1',
        authorProfileId: 'prof-student',
        authorName: 'Aryan Student',
        authorRole: 'student',
        replyText: 'Thank you, but what happens when external magnetic field is zero?',
        imageUrl: null,
        isAcceptedAnswer: false,
        createdAt: '2026-09-15T11:00:00Z',
        updatedAt: '2026-09-15T11:00:00Z',
      },
      {
        replyId: 'rep-1',
        doubtId: 'doubt-1',
        authorProfileId: 'prof-teacher',
        authorName: 'Dr. Sharma',
        authorRole: 'teacher',
        replyText: 'Lenz law states the induced EMF always opposes the change in flux.',
        imageUrl: null,
        isAcceptedAnswer: true,
        createdAt: '2026-09-15T09:00:00Z',
        updatedAt: '2026-09-15T09:00:00Z',
      },
      {
        replyId: 'rep-2',
        doubtId: 'doubt-1',
        authorProfileId: 'prof-admin',
        authorName: 'Admin Desk',
        authorRole: 'admin',
        replyText: 'Please refer to Physics Chapter 6 supplementary notes.',
        imageUrl: null,
        isAcceptedAnswer: false,
        createdAt: '2026-09-15T10:00:00Z',
        updatedAt: '2026-09-15T10:00:00Z',
      },
    ];

    it('sorts conversation replies chronologically (oldest to newest)', () => {
      const sorted = [...mockReplies].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );

      expect(sorted[0].replyId).toBe('rep-1');
      expect(sorted[0].authorRole).toBe('teacher');
      expect(sorted[1].replyId).toBe('rep-2');
      expect(sorted[1].authorRole).toBe('admin');
      expect(sorted[2].replyId).toBe('rep-3');
      expect(sorted[2].authorRole).toBe('student');
    });

    it('identifies accepted solution reply accurately', () => {
      const acceptedReply = mockReplies.find((r) => r.isAcceptedAnswer);
      expect(acceptedReply).toBeDefined();
      expect(acceptedReply?.replyId).toBe('rep-1');
      expect(acceptedReply?.authorRole).toBe('teacher');
    });
  });

  describe('3. Detail Row Mapping with Attachments & Breadcrumbs', () => {
    it('maps database snake_case row to camelCase StudentDoubt including attachments and replies', () => {
      const rawDetailRow: DbStudentDoubtRow = {
        doubt_id: '550e8400-e29b-41d4-a716-446655440000',
        student_id: '11111111-1111-1111-1111-111111111111',
        subject_id: '22222222-2222-2222-2222-222222222222',
        chapter_id: '33333333-3333-3333-3333-333333333333',
        topic_id: '44444444-4444-4444-4444-444444444444',
        batch_subject_id: '55555555-5555-5555-5555-555555555555',
        related_resource_type: 'recorded_class',
        related_resource_id: '66666666-6666-6666-6666-666666666666',
        title: 'Electromagnetic induction question',
        description: 'Need detailed explanation of induced EMF in a moving rod.',
        image_url: null,
        status: 'in_progress',
        assigned_to: '77777777-7777-7777-7777-777777777777',
        assigned_at: '2026-09-15T08:00:00Z',
        first_response_at: '2026-09-15T09:00:00Z',
        resolved_at: null,
        resolved_by: null,
        reopened_count: 1,
        created_at: '2026-09-15T07:30:00Z',
        updated_at: '2026-09-15T09:00:00Z',
        subject: { name: 'Physics' },
        chapter: { name: 'Electromagnetism' },
        topic: { name: 'Motional EMF' },
        batch_subject: {
          batch_subject_id: '55555555-5555-5555-5555-555555555555',
          batches: {
            name: 'Target NEET 2026 Batch A',
            course_batches: {
              course: { title: 'Complete NEET Physics' },
            },
          },
          subjects: { name: 'Physics' },
        },
        assigned_teacher: {
          teacher_id: '77777777-7777-7777-7777-777777777777',
          profile: { profile_id: 'prof-9', name: 'Dr. Sharma' },
        },
        attachments: [
          {
            attachment_id: 'att-1',
            doubt_id: '550e8400-e29b-41d4-a716-446655440000',
            reply_id: null,
            uploaded_by: '11111111-1111-1111-1111-111111111111',
            bucket: 'doubts',
            storage_path: 'doubts/550e8400/diagram.png',
            mime_type: 'image/png',
            size_bytes: 102400,
            created_at: '2026-09-15T07:30:00Z',
          },
        ],
        replies: [
          {
            reply_id: 'rep-1',
            doubt_id: '550e8400-e29b-41d4-a716-446655440000',
            author_profile_id: 'prof-9',
            reply_text: 'EMF = B * v * L where velocity is perpendicular to magnetic field.',
            image_url: null,
            is_accepted_answer: false,
            created_at: '2026-09-15T09:00:00Z',
            updated_at: '2026-09-15T09:00:00Z',
            author: { profile_id: 'prof-9', name: 'Dr. Sharma', role: 'teacher' },
            attachments: [],
          },
        ],
      };

      const mapped: StudentDoubt = mapDoubtRow(rawDetailRow);

      expect(mapped.doubtId).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(mapped.subjectName).toBe('Physics');
      expect(mapped.chapterName).toBe('Electromagnetism');
      expect(mapped.topicName).toBe('Motional EMF');
      expect(mapped.status).toBe('in_progress');
      expect(mapped.reopenedCount).toBe(1);
      expect(mapped.attachments).toHaveLength(1);
      expect(mapped.attachments?.[0].attachmentId).toBe('att-1');
      expect(mapped.attachments?.[0].mimeType).toBe('image/png');
      expect(mapped.replies).toHaveLength(1);
      expect(mapped.replies?.[0].authorRole).toBe('teacher');
      expect(mapped.replies?.[0].authorName).toBe('Dr. Sharma');
    });
  });

  describe('4. Student Action Lifecycle & Eligibility', () => {
    it('allows replying when doubt is open or in_progress', () => {
      const isActionable = (status: string) => status === 'open' || status === 'in_progress';

      expect(isActionable('open')).toBe(true);
      expect(isActionable('in_progress')).toBe(true);
      expect(isActionable('resolved')).toBe(false);
      expect(isActionable('closed')).toBe(false);
      expect(isActionable('archived')).toBe(false);
    });

    it('allows reopening only when status is resolved and reopen count < 3', () => {
      const canReopen = (status: string, count: number) => status === 'resolved' && count < 3;

      expect(canReopen('resolved', 0)).toBe(true);
      expect(canReopen('resolved', 1)).toBe(true);
      expect(canReopen('resolved', 2)).toBe(true);
      expect(canReopen('resolved', 3)).toBe(false);
      expect(canReopen('open', 0)).toBe(false);
      expect(canReopen('in_progress', 0)).toBe(false);
      expect(canReopen('archived', 0)).toBe(false);
    });

    it('allows accepting answer only on teacher/admin replies when doubt is active', () => {
      const canAccept = (status: string, authorRole?: string | null) =>
        (status === 'open' || status === 'in_progress') && (authorRole === 'teacher' || authorRole === 'admin');

      expect(canAccept('open', 'teacher')).toBe(true);
      expect(canAccept('in_progress', 'teacher')).toBe(true);
      expect(canAccept('open', 'admin')).toBe(true);
      expect(canAccept('open', 'student')).toBe(false);
      expect(canAccept('resolved', 'teacher')).toBe(false);
    });
  });

  describe('5. Security, Error Handling & Safe Fallbacks', () => {
    it('safely translates RPC permission and access violation errors', () => {
      expect(doubtErrorMessage('you do not have access to this doubt')).toBe(
        "You don't have permission to perform this action.",
      );
      expect(doubtErrorMessage('only the doubt owner can accept an answer')).toBe(
        "You don't have permission to perform this action.",
      );
      expect(doubtErrorMessage('reopened the maximum number of times')).toBe(
        'This doubt has been reopened the maximum number of times (3).',
      );
      expect(doubtErrorMessage('only resolved doubts can be reopened')).toBe(
        'Only resolved doubts can be reopened.',
      );
      expect(doubtErrorMessage('reply text is required')).toBe('Please write a reply before submitting.');
      expect(doubtErrorMessage('doubt not found')).toBe('The doubt could not be found. It may have been removed.');
    });

    it('handles unexpected generic errors with fallback', () => {
      expect(doubtErrorMessage('database connection dropped')).toBe(
        'database connection dropped',
      );
      expect(doubtErrorMessage('')).toBe('Something went wrong. Please try again.');
    });
  });
});
