import { describe, it, expect, vi, beforeEach } from 'vitest';
import { doubtService } from '@/services/doubtService';
import { doubtKeys } from '@/hooks/doubt/queryKeys';
import { doubtErrorMessage } from '@/utils/doubtErrors';
import { mapDoubtRow } from '@/utils/doubtMappers';
import type { StudentDoubt, DoubtStatus, DoubtResourceType } from '@/types/doubt';
import type { DbStudentDoubtRow } from '@/utils/doubtMappers';

describe('Student Doubts Hub (Phase 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Doubt Query Keys & Scope Isolation', () => {
    it('generates role-isolated query keys for student scope', () => {
      const key = doubtKeys.list('student', { status: 'open' }, { page: 1, pageSize: 12 });
      expect(key).toEqual([
        'doubts',
        'list',
        'student',
        { status: 'open' },
        { page: 1, pageSize: 12 },
      ]);
    });

    it('separates student scope from teacher and admin scopes', () => {
      const studentKey = doubtKeys.list('student', undefined, undefined);
      const teacherKey = doubtKeys.list('teacher', undefined, undefined);
      const adminKey = doubtKeys.list('admin', undefined, undefined);

      expect(studentKey).not.toEqual(teacherKey);
      expect(studentKey).not.toEqual(adminKey);
      expect(studentKey[2]).toBe('student');
    });
  });

  describe('2. Stats Calculation & Subject Extraction Logic', () => {
    const mockDoubts: StudentDoubt[] = [
      {
        doubtId: '11111111-1111-1111-1111-111111111111',
        studentId: 'student-1',
        subjectId: 'sub-phy',
        subjectName: 'Physics',
        chapterId: 'chap-1',
        chapterName: 'Mechanics',
        topicId: null,
        topicName: null,
        batchSubjectId: 'bs-1',
        relatedResourceType: 'recorded_class' as DoubtResourceType,
        relatedResourceId: 'rec-1',
        title: 'Rotational motion torque query',
        description: 'How is torque calculated about a non-inertial axis?',
        imageUrl: null,
        status: 'open',
        assignedTo: 'teacher-1',
        assignedAt: '2026-09-10T10:00:00Z',
        firstResponseAt: null,
        resolvedAt: null,
        resolvedBy: null,
        reopenedCount: 0,
        createdAt: '2026-09-10T09:00:00Z',
        updatedAt: '2026-09-10T09:00:00Z',
        replies: [],
        attachments: [],
      },
      {
        doubtId: '22222222-2222-2222-2222-222222222222',
        studentId: 'student-1',
        subjectId: 'sub-chem',
        subjectName: 'Chemistry',
        chapterId: 'chap-2',
        chapterName: 'Organic Reaction Mechanism',
        topicId: null,
        topicName: null,
        batchSubjectId: 'bs-2',
        relatedResourceType: 'study_material' as DoubtResourceType,
        relatedResourceId: 'content-1',
        title: 'SN1 vs SN2 transition state',
        description: 'Why does polar protic solvent favor SN1 mechanism?',
        imageUrl: 'https://example.com/photo.jpg',
        status: 'in_progress',
        assignedTo: 'teacher-2',
        assignedAt: '2026-09-11T10:00:00Z',
        firstResponseAt: '2026-09-11T12:00:00Z',
        resolvedAt: null,
        resolvedBy: null,
        reopenedCount: 1,
        createdAt: '2026-09-11T08:00:00Z',
        updatedAt: '2026-09-11T12:00:00Z',
        replies: [{ replyId: 'rep-1', doubtId: '22222222-2222-2222-2222-222222222222', authorProfileId: 'prof-2', replyText: 'Solvent polarity stabilizes carbocation', imageUrl: null, isAcceptedAnswer: false, createdAt: '2026-09-11T12:00:00Z', updatedAt: '2026-09-11T12:00:00Z' }],
        attachments: [],
      },
      {
        doubtId: '33333333-3333-3333-3333-333333333333',
        studentId: 'student-1',
        subjectId: 'sub-phy',
        subjectName: 'Physics',
        chapterId: 'chap-3',
        chapterName: 'Optics',
        topicId: null,
        topicName: null,
        batchSubjectId: 'bs-1',
        relatedResourceType: 'question' as DoubtResourceType,
        relatedResourceId: 'q-99',
        title: 'Focal length calculation error',
        description: 'Need clarification on sign convention for convex mirror.',
        imageUrl: null,
        status: 'resolved',
        assignedTo: 'teacher-1',
        assignedAt: '2026-09-12T10:00:00Z',
        firstResponseAt: '2026-09-12T11:00:00Z',
        resolvedAt: '2026-09-12T14:00:00Z',
        resolvedBy: 'student-1',
        reopenedCount: 0,
        createdAt: '2026-09-12T09:00:00Z',
        updatedAt: '2026-09-12T14:00:00Z',
        replies: [],
        attachments: [],
      },
    ];

    it('correctly calculates counts for total, open, in-progress, and resolved doubts', () => {
      const total = mockDoubts.length;
      const openCount = mockDoubts.filter((d) => d.status === 'open').length;
      const inProgressCount = mockDoubts.filter((d) => d.status === 'in_progress').length;
      const resolvedCount = mockDoubts.filter((d) => d.status === 'resolved').length;

      expect(total).toBe(3);
      expect(openCount).toBe(1);
      expect(inProgressCount).toBe(1);
      expect(resolvedCount).toBe(1);
      expect(openCount + inProgressCount).toBe(2);
    });

    it('extracts unique available subjects from doubts without duplicates', () => {
      const map = new Map<string, string>();
      mockDoubts.forEach((d) => {
        if (d.subjectId && d.subjectName && !map.has(d.subjectId)) {
          map.set(d.subjectId, d.subjectName);
        }
      });
      const subjects = Array.from(map.entries()).map(([id, name]) => ({ id, name }));

      expect(subjects).toHaveLength(2);
      expect(subjects).toEqual([
        { id: 'sub-phy', name: 'Physics' },
        { id: 'sub-chem', name: 'Chemistry' },
      ]);
    });
  });

  describe('3. Row Mapping & Academic Hierarchy', () => {
    it('maps database snake_case row to camelCase StudentDoubt with joins', () => {
      const rawRow: DbStudentDoubtRow = {
        doubt_id: '550e8400-e29b-41d4-a716-446655440000',
        student_id: '11111111-1111-1111-1111-111111111111',
        subject_id: '22222222-2222-2222-2222-222222222222',
        chapter_id: '33333333-3333-3333-3333-333333333333',
        topic_id: '44444444-4444-4444-4444-444444444444',
        batch_subject_id: '55555555-5555-5555-5555-555555555555',
        related_resource_type: 'live_class',
        related_resource_id: '66666666-6666-6666-6666-666666666666',
        title: 'Electromagnetic induction Lenz law',
        description: 'Direction of induced current query in changing magnetic field',
        image_url: null,
        status: 'open',
        assigned_to: '77777777-7777-7777-7777-777777777777',
        assigned_at: '2026-09-15T08:00:00Z',
        first_response_at: null,
        resolved_at: null,
        resolved_by: null,
        reopened_count: 0,
        created_at: '2026-09-15T07:30:00Z',
        updated_at: '2026-09-15T07:30:00Z',
        subject: { name: 'Physics' },
        chapter: { name: 'Electromagnetism' },
        topic: { name: 'Lenz Law' },
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
      };

      const mapped = mapDoubtRow(rawRow);

      expect(mapped.doubtId).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(mapped.subjectName).toBe('Physics');
      expect(mapped.chapterName).toBe('Electromagnetism');
      expect(mapped.topicName).toBe('Lenz Law');
      expect(mapped.batchName).toBe('Target NEET 2026 Batch A');
      expect(mapped.courseName).toBe('Complete NEET Physics');
      expect(mapped.assignedTeacherName).toBe('Dr. Sharma');
      expect(mapped.status).toBe('open');
      expect(mapped.relatedResourceType).toBe('live_class');
    });
  });

  describe('4. Error Mapping & Security Fallback', () => {
    it('translates permissions errors to safe user-friendly strings', () => {
      expect(doubtErrorMessage('you do not have access to this doubt')).toBe(
        "You don't have permission to perform this action.",
      );
      expect(doubtErrorMessage('only students can submit doubts')).toBe(
        "You don't have permission to perform this action.",
      );
    });

    it('translates archived/resolved errors appropriately', () => {
      expect(doubtErrorMessage('only resolved doubts can be reopened')).toBe(
        'Only resolved doubts can be reopened.',
      );
      expect(doubtErrorMessage('reopened the maximum number of times')).toBe(
        'This doubt has been reopened the maximum number of times (3).',
      );
    });
  });
});
