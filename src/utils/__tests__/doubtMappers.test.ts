import { describe, it, expect } from 'vitest';
import {
  mapDoubtRow,
  mapDoubtReplyRow,
  mapDoubtAttachmentRow,
  mapSubmitDoubtResult,
  mapReplyToDoubtResult,
  mapDoubtStatusResult,
  mapAssignDoubtResult,
  mapAttachDoubtFileResult,
  mergeDoubtTeacherOptions,
  pickOne,
} from '@/utils/doubtMappers';
import type {
  DbDoubtAttachmentRow,
  DbDoubtReplyRow,
  DbStudentDoubtRow,
} from '@/utils/doubtMappers';

describe('mapDoubtRow', () => {
  it('maps all snake_case fields to camelCase', () => {
    const row: DbStudentDoubtRow = {
      doubt_id: 'd-1',
      student_id: 'stu-1',
      subject_id: 'subj-1',
      chapter_id: 'ch-1',
      topic_id: 'tp-1',
      batch_subject_id: 'bs-1',
      related_resource_type: 'mock_test',
      related_resource_id: 'mt-1',
      title: 'Friction in rolling motion?',
      description: 'Why is work done by friction zero in pure rolling?',
      image_url: null,
      status: 'in_progress',
      assigned_to: 't-1',
      assigned_at: '2026-08-10T09:00:00Z',
      first_response_at: '2026-08-10T10:00:00Z',
      resolved_at: null,
      resolved_by: null,
      reopened_count: 0,
      created_at: '2026-08-10T08:00:00Z',
      updated_at: '2026-08-10T10:00:00Z',
    };

    const mapped = mapDoubtRow(row);

    expect(mapped.doubtId).toBe('d-1');
    expect(mapped.studentId).toBe('stu-1');
    expect(mapped.subjectId).toBe('subj-1');
    expect(mapped.chapterId).toBe('ch-1');
    expect(mapped.topicId).toBe('tp-1');
    expect(mapped.batchSubjectId).toBe('bs-1');
    expect(mapped.relatedResourceType).toBe('mock_test');
    expect(mapped.relatedResourceId).toBe('mt-1');
    expect(mapped.status).toBe('in_progress');
    expect(mapped.assignedTo).toBe('t-1');
    expect(mapped.firstResponseAt).toBe('2026-08-10T10:00:00Z');
    expect(mapped.reopenedCount).toBe(0);
  });

  it('unwraps embedded names (object + array forms)', () => {
    const row: DbStudentDoubtRow = {
      doubt_id: 'd-1', student_id: 's1', subject_id: 'subj-1',
      chapter_id: null, topic_id: null, batch_subject_id: null,
      related_resource_type: null, related_resource_id: null,
      title: 'Question', description: 'Details', image_url: null,
      status: 'open', assigned_to: null, assigned_at: null,
      first_response_at: null, resolved_at: null, resolved_by: null,
      reopened_count: 0, created_at: '2026-08-10T08:00:00Z',
      updated_at: '2026-08-10T08:00:00Z',
      subject: { name: 'Physics' },
      chapter: [{ name: 'Laws of Motion' }],
      topic: null,
      batch_subject: {
        batch_subject_id: 'bs-1',
        batches: [
          {
            name: 'JEE Batch A',
            course_batches: [
              { course: { title: 'JEE Main 2026' } },
            ],
          },
        ],
        subjects: { name: 'Physics' },
      },
      assigned_teacher: {
        teacher_id: 't-1',
        profile: { profile_id: 'p-1', name: 'Rahul Sharma' },
      },
      student: {
        student_id: 's1',
        enrollment_no: '2501920700087',
        profile: [{ profile_id: 'p-2', name: 'Arjun Mehta' }],
      },
    };

    const mapped = mapDoubtRow(row);
    expect(mapped.subjectName).toBe('Physics');
    expect(mapped.chapterName).toBe('Laws of Motion');
    expect(mapped.batchName).toBe('JEE Batch A');
    expect(mapped.courseName).toBe('JEE Main 2026');
    expect(mapped.assignedTeacherName).toBe('Rahul Sharma');
    expect(mapped.studentName).toBe('Arjun Mehta');
    expect(mapped.enrollmentNo).toBe('2501920700087');
  });

  it('maps course name via a nested course_batches embed', () => {
    const row: DbStudentDoubtRow = {
      doubt_id: 'd-1', student_id: 's1', subject_id: 'subj-1',
      chapter_id: null, topic_id: null, batch_subject_id: 'bs-1',
      related_resource_type: null, related_resource_id: null,
      title: 'Question', description: 'Details', image_url: null,
      status: 'open', assigned_to: null, assigned_at: null,
      first_response_at: null, resolved_at: null, resolved_by: null,
      reopened_count: 0, created_at: '2026-08-10T08:00:00Z',
      updated_at: '2026-08-10T08:00:00Z',
      batch_subject: {
        batch_subject_id: 'bs-1',
        batches: [
          {
            name: 'Batch B',
            course_batches: [{ course: { title: 'NEET 2026' } }],
          },
        ],
        subjects: { name: 'Chemistry' },
      },
      student: { student_id: 's1', enrollment_no: 'E-9', profile: null },
    };

    const mapped = mapDoubtRow(row);
    expect(mapped.batchName).toBe('Batch B');
    expect(mapped.courseName).toBe('NEET 2026');
    expect(mapped.enrollmentNo).toBe('E-9');
  });

  it('maps nested replies + attachments on detail reads', () => {
    const row: DbStudentDoubtRow = {
      doubt_id: 'd-1', student_id: 's1', subject_id: 'subj-1',
      chapter_id: null, topic_id: null, batch_subject_id: null,
      related_resource_type: null, related_resource_id: null,
      title: 'Question', description: 'Details', image_url: null,
      status: 'open', assigned_to: null, assigned_at: null,
      first_response_at: null, resolved_at: null, resolved_by: null,
      reopened_count: 0, created_at: '2026-08-10T08:00:00Z',
      updated_at: '2026-08-10T08:00:00Z',
      replies: [
        {
          reply_id: 'r-1', doubt_id: 'd-1', author_profile_id: 'p-1',
          reply_text: 'Answer', image_url: null, is_accepted_answer: true,
          created_at: '2026-08-10T09:00:00Z', updated_at: '2026-08-10T09:00:00Z',
        },
      ],
      attachments: [
        {
          attachment_id: 'a-1', doubt_id: 'd-1', reply_id: null,
          uploaded_by: 'p-1', bucket: 'doubt-attachments',
          storage_path: 'inst-1/d-1/question.jpg',
          mime_type: 'image/jpeg', size_bytes: 2048,
          created_at: '2026-08-10T08:30:00Z',
        },
      ],
    };

    const mapped = mapDoubtRow(row);
    expect(mapped.replies).toHaveLength(1);
    expect(mapped.replies?.[0].replyText).toBe('Answer');
    expect(mapped.attachments).toHaveLength(1);
    expect(mapped.attachments?.[0].storagePath).toBe('inst-1/d-1/question.jpg');
  });

  it('handles nullable display fields', () => {
    const row: DbStudentDoubtRow = {
      doubt_id: 'd-1', student_id: 's1', subject_id: 'subj-1',
      chapter_id: null, topic_id: null, batch_subject_id: null,
      related_resource_type: null, related_resource_id: null,
      title: 'Question', description: 'Details', image_url: null,
      status: 'open', assigned_to: null, assigned_at: null,
      first_response_at: null, resolved_at: null, resolved_by: null,
      reopened_count: null, created_at: '2026-08-10T08:00:00Z',
      updated_at: '2026-08-10T08:00:00Z',
    };

    const mapped = mapDoubtRow(row);
    expect(mapped.subjectName).toBeNull();
    expect(mapped.chapterName).toBeNull();
    expect(mapped.studentName).toBeNull();
    expect(mapped.assignedTeacherName).toBeNull();
    expect(mapped.batchName).toBeNull();
    expect(mapped.courseName).toBeNull();
    expect(mapped.enrollmentNo).toBeNull();
    expect(mapped.reopenedCount).toBe(0);
    expect(mapped.replies).toBeUndefined();
  });
});

describe('mapDoubtReplyRow', () => {
  it('maps reply fields + unwraps author', () => {
    const row: DbDoubtReplyRow = {
      reply_id: 'r-1', doubt_id: 'd-1', author_profile_id: 'p-1',
      reply_text: 'The answer is 4.', image_url: 'img.png',
      is_accepted_answer: false, created_at: '2026-08-10T09:00:00Z',
      updated_at: '2026-08-10T09:00:00Z',
      author: [{ profile_id: 'p-1', name: 'Rahul Sharma', role: 'teacher' }],
    };

    const mapped = mapDoubtReplyRow(row);
    expect(mapped.replyId).toBe('r-1');
    expect(mapped.authorProfileId).toBe('p-1');
    expect(mapped.replyText).toBe('The answer is 4.');
    expect(mapped.isAcceptedAnswer).toBe(false);
    expect(mapped.authorName).toBe('Rahul Sharma');
    expect(mapped.authorRole).toBe('teacher');
  });
});

describe('mapDoubtAttachmentRow', () => {
  it('maps attachment fields', () => {
    const row: DbDoubtAttachmentRow = {
      attachment_id: 'a-1', doubt_id: 'd-1', reply_id: 'r-1',
      uploaded_by: 'p-1', bucket: 'doubt-attachments',
      storage_path: 'inst-1/d-1/solution.pdf',
      mime_type: 'application/pdf', size_bytes: 123456,
      created_at: '2026-08-10T09:30:00Z',
    };

    const mapped = mapDoubtAttachmentRow(row);
    expect(mapped.attachmentId).toBe('a-1');
    expect(mapped.replyId).toBe('r-1');
    expect(mapped.storagePath).toBe('inst-1/d-1/solution.pdf');
    expect(mapped.mimeType).toBe('application/pdf');
    expect(mapped.sizeBytes).toBe(123456);
    expect(mapped.signedUrl).toBeUndefined();
  });
});

describe('pickOne', () => {
  it('handles object, array, null and undefined forms', () => {
    expect(pickOne({ a: 1 })).toEqual({ a: 1 });
    expect(pickOne([{ a: 1 }])).toEqual({ a: 1 });
    expect(pickOne(null)).toBeNull();
    expect(pickOne(undefined)).toBeNull();
    expect(pickOne([])).toBeNull();
  });
});

describe('RPC result mappers', () => {
  it('maps the submit result', () => {
    expect(mapSubmitDoubtResult({ success: true, doubt_id: 'd-1', status: 'open' })).toEqual({
      success: true,
      doubtId: 'd-1',
      status: 'open',
    });
  });

  it('maps the reply result', () => {
    expect(mapReplyToDoubtResult({ success: true, reply_id: 'r-1' })).toEqual({
      success: true,
      replyId: 'r-1',
    });
  });

  it('maps status results (accept/resolve/reopen/archive)', () => {
    expect(mapDoubtStatusResult({ success: true, status: 'resolved' })).toEqual({
      success: true,
      status: 'resolved',
    });
    expect(mapDoubtStatusResult({ success: true, status: 'open' })).toEqual({
      success: true,
      status: 'open',
    });
  });

  it('maps the assign result', () => {
    expect(
      mapAssignDoubtResult({
        success: true,
        doubt_id: 'd-1',
        assigned_to: 't-2',
        reassigned: true,
      }),
    ).toEqual({ success: true, doubtId: 'd-1', assignedTo: 't-2', reassigned: true });
  });

  it('maps the attach result', () => {
    expect(mapAttachDoubtFileResult({ success: true, attachment_id: 'a-1' })).toEqual({
      success: true,
      attachmentId: 'a-1',
    });
  });
});

describe('mergeDoubtTeacherOptions (Phase 7F)', () => {
  it('dedupes teachers across both sources and flags batch-subject assignment', () => {
    const merged = mergeDoubtTeacherOptions([
      { teacherId: 't-1', name: 'Rahul', source: 'batch_subject' },
      { teacherId: 't-2', name: 'Amit', source: 'specialization' },
      { teacherId: 't-1', name: 'Rahul', source: 'specialization' },
    ]);

    expect(merged).toHaveLength(2);
    const t1 = merged.find((t) => t.teacherId === 't-1');
    const t2 = merged.find((t) => t.teacherId === 't-2');
    expect(t1?.isBatchSubjectAssigned).toBe(true);
    expect(t2?.isBatchSubjectAssigned).toBe(false);
  });

  it('orders batch-subject teachers first', () => {
    const merged = mergeDoubtTeacherOptions([
      { teacherId: 't-1', name: 'Specialist Only', source: 'specialization' },
      { teacherId: 't-2', name: 'Batch Teacher', source: 'batch_subject' },
    ]);
    expect(merged[0].teacherId).toBe('t-2');
  });

  it('keeps the first non-null name when a null name appears first', () => {
    const merged = mergeDoubtTeacherOptions([
      { teacherId: 't-1', name: null, source: 'batch_subject' },
      { teacherId: 't-1', name: 'Rahul', source: 'specialization' },
    ]);
    expect(merged[0]).toEqual({
      teacherId: 't-1',
      name: 'Rahul',
      isBatchSubjectAssigned: true,
    });
  });

  it('returns an empty list for no candidates', () => {
    expect(mergeDoubtTeacherOptions([])).toEqual([]);
  });
});
