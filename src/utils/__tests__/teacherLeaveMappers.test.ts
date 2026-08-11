import { describe, it, expect } from 'vitest';
import {
  mapClassResolutionRow,
  mapLeaveOccurrenceRow,
  mapResolutionResult,
  mapReviewLeaveResult,
  mapCancelLeaveResult,
  mapSubmitLeaveResult,
  mapTeacherLeaveRequestRow,
} from '@/utils/teacherLeaveMappers';
import type {
  DbClassResolutionRow,
  DbLeaveOccurrenceRow,
  DbTeacherLeaveRequestRow,
} from '@/utils/teacherLeaveMappers';

describe('mapTeacherLeaveRequestRow', () => {
  it('maps all snake_case fields to camelCase', () => {
    const row: DbTeacherLeaveRequestRow = {
      leave_id: 'leave-1',
      teacher_id: 'teacher-1',
      institute_id: 'inst-1',
      leave_category: 'casual',
      start_date: '2026-08-10',
      end_date: '2026-08-12',
      reason: 'Family function',
      status: 'pending',
      is_emergency: true,
      time_until_class: '1 day 02:00:00',
      affected_occurrences: 3,
      reviewed_by: null,
      reviewed_at: null,
      reviewer_remarks: null,
      created_at: '2026-08-09T10:00:00Z',
      updated_at: '2026-08-09T10:00:00Z',
    };

    const mapped = mapTeacherLeaveRequestRow(row);

    expect(mapped.leaveId).toBe('leave-1');
    expect(mapped.teacherId).toBe('teacher-1');
    expect(mapped.leaveCategory).toBe('casual');
    expect(mapped.startDate).toBe('2026-08-10');
    expect(mapped.endDate).toBe('2026-08-12');
    expect(mapped.status).toBe('pending');
    expect(mapped.isEmergency).toBe(true);
    expect(mapped.timeUntilClass).toBe('1 day 02:00:00');
    expect(mapped.affectedOccurrences).toBe(3);
    expect(mapped.pendingResolutions).toBe(0);
    expect(mapped.teacherName).toBeNull();
  });

  it('unwraps the teacher name embed (object and array forms)', () => {
    const objectRow: DbTeacherLeaveRequestRow = {
      leave_id: 'l1', teacher_id: 't1', institute_id: 'i1', leave_category: 'sick',
      start_date: '2026-08-10', end_date: '2026-08-10', reason: null, status: 'approved',
      is_emergency: false, time_until_class: null, affected_occurrences: 1,
      reviewed_by: 'admin-1', reviewed_at: '2026-08-09T10:00:00Z', reviewer_remarks: 'ok',
      created_at: '2026-08-09T09:00:00Z', updated_at: '2026-08-09T10:00:00Z',
      teacher: {
        teacher_id: 't1',
        department: 'Physics',
        profile: { profile_id: 'p1', name: 'Rahul Sharma' },
      },
    };

    expect(mapTeacherLeaveRequestRow(objectRow).teacherName).toBe('Rahul Sharma');
    expect(mapTeacherLeaveRequestRow(objectRow).teacherDepartment).toBe('Physics');

    const arrayRow: DbTeacherLeaveRequestRow = {
      ...objectRow,
      teacher: {
        teacher_id: 't1',
        profile: [{ profile_id: 'p1', name: 'Rahul Sharma' }],
      },
    };
    expect(mapTeacherLeaveRequestRow(arrayRow).teacherName).toBe('Rahul Sharma');
  });

  it('counts pending resolutions from the lite embed', () => {
    const row: DbTeacherLeaveRequestRow = {
      leave_id: 'l1', teacher_id: 't1', institute_id: 'i1', leave_category: 'casual',
      start_date: '2026-08-10', end_date: '2026-08-10', reason: null, status: 'approved',
      is_emergency: false, time_until_class: null, affected_occurrences: 3,
      reviewed_by: null, reviewed_at: null, reviewer_remarks: null,
      created_at: '2026-08-09T09:00:00Z', updated_at: '2026-08-09T10:00:00Z',
      resolutions: [
        { status: 'pending', resolution_type: 'cancelled' },
        { status: 'resolved', resolution_type: 'substitute_teacher' },
        { status: 'pending', resolution_type: 'cancelled' },
      ],
    };

    const mapped = mapTeacherLeaveRequestRow(row);
    expect(mapped.pendingResolutions).toBe(2);
    expect(mapped.resolutions).toBeUndefined();
  });

  it('maps full resolution rows when embedded on a detail read', () => {
    const row: DbTeacherLeaveRequestRow = {
      leave_id: 'l1', teacher_id: 't1', institute_id: 'i1', leave_category: 'casual',
      start_date: '2026-08-10', end_date: '2026-08-10', reason: null, status: 'approved',
      is_emergency: false, time_until_class: null, affected_occurrences: 1,
      reviewed_by: null, reviewed_at: null, reviewer_remarks: null,
      created_at: '2026-08-09T09:00:00Z', updated_at: '2026-08-09T10:00:00Z',
      resolutions: [
        {
          resolution_id: 'r1', institute_id: 'i1', leave_request_id: 'l1',
          timetable_slot_id: 's1', occurrence_date: '2026-08-10', class_id: 'c1',
          resolution_type: 'reschedule', status: 'resolved',
          prev_teacher_id: 't1', new_teacher_id: 't2', new_scheduled_at: '2026-08-11T10:00:00Z',
          new_duration_min: 60, recording_id: null, mock_test_id: null,
          reason: null, notes: 'moved', resolved_by: 'admin-1', resolved_at: '2026-08-09T11:00:00Z',
          created_at: '2026-08-09T10:30:00Z', updated_at: '2026-08-09T11:00:00Z',
        },
      ],
    };

    const mapped = mapTeacherLeaveRequestRow(row);
    expect(mapped.resolutions).toHaveLength(1);
    expect(mapped.resolutions?.[0].resolutionType).toBe('reschedule');
    expect(mapped.resolutions?.[0].newScheduledAt).toBe('2026-08-11T10:00:00Z');
  });
});

describe('mapLeaveOccurrenceRow', () => {
  it('maps occurrence fields and unwraps batch/subject names', () => {
    const row: DbLeaveOccurrenceRow = {
      leave_request_occurrence_id: 'occ-1',
      leave_request_id: 'l1',
      timetable_slot_id: 's1',
      occurrence_date: '2026-08-10',
      created_at: '2026-08-09T09:00:00Z',
      slot: {
        timetable_slot_id: 's1',
        day_of_week: 1,
        start_time: '10:00:00',
        end_time: '11:00:00',
        batch_subject_id: 'bs1',
        batch_subjects: {
          batch_subject_id: 'bs1',
          batch_id: 'b1',
          subject_id: 'subj1',
          batches: [{ name: 'JEE Batch A' }],
          subjects: [{ name: 'Physics' }],
        },
      },
    };

    const mapped = mapLeaveOccurrenceRow(row);

    expect(mapped.leaveRequestOccurrenceId).toBe('occ-1');
    expect(mapped.occurrenceDate).toBe('2026-08-10');
    expect(mapped.dayOfWeek).toBe(1);
    expect(mapped.startTime).toBe('10:00:00');
    expect(mapped.endTime).toBe('11:00:00');
    expect(mapped.batchSubjectId).toBe('bs1');
    expect(mapped.batchId).toBe('b1');
    expect(mapped.subjectId).toBe('subj1');
    expect(mapped.batchName).toBe('JEE Batch A');
    expect(mapped.subjectName).toBe('Physics');
  });

  it('handles a slot without batch_subjects embed', () => {
    const row: DbLeaveOccurrenceRow = {
      leave_request_occurrence_id: 'occ-1',
      leave_request_id: 'l1',
      timetable_slot_id: 's1',
      occurrence_date: '2026-08-10',
      created_at: '2026-08-09T09:00:00Z',
    };

    const mapped = mapLeaveOccurrenceRow(row);
    expect(mapped.batchSubjectId).toBeNull();
    expect(mapped.batchName).toBeNull();
    expect(mapped.subjectName).toBeNull();
    expect(mapped.subjectId).toBeNull();
    expect(mapped.dayOfWeek).toBeUndefined();
  });
});

describe('mapClassResolutionRow', () => {
  it('maps resolution fields and joined display data', () => {
    const row: DbClassResolutionRow = {
      resolution_id: 'r1', institute_id: 'i1', leave_request_id: 'l1',
      timetable_slot_id: 's1', occurrence_date: '2026-08-10', class_id: 'c1',
      resolution_type: 'substitute_teacher', status: 'resolved',
      prev_teacher_id: 't1', new_teacher_id: 't2',
      new_scheduled_at: null, new_duration_min: null,
      recording_id: null, mock_test_id: null,
      reason: null, notes: null,
      resolved_by: 'admin-1', resolved_at: '2026-08-09T11:00:00Z',
      created_at: '2026-08-09T10:30:00Z', updated_at: '2026-08-09T11:00:00Z',
      prev_teacher: { teacher_id: 't1', profile: { profile_id: 'p1', name: 'Rahul Sharma' } },
      new_teacher: { teacher_id: 't2', profile: { profile_id: 'p2', name: 'Amit Verma' } },
      resolved_by_profile: [{ profile_id: 'admin-1', name: 'Admin User' }],
      live_class: { class_id: 'c1', status: 'scheduled' },
    };

    const mapped = mapClassResolutionRow(row);

    expect(mapped.resolutionId).toBe('r1');
    expect(mapped.resolutionType).toBe('substitute_teacher');
    expect(mapped.status).toBe('resolved');
    expect(mapped.prevTeacherName).toBe('Rahul Sharma');
    expect(mapped.newTeacherName).toBe('Amit Verma');
    expect(mapped.resolvedByName).toBe('Admin User');
    expect(mapped.classStatus).toBe('scheduled');
    expect(mapped.className).toBeNull();
  });

  it('maps recorded/mock-test display titles', () => {
    const row: DbClassResolutionRow = {
      resolution_id: 'r2', institute_id: 'i1', leave_request_id: 'l1',
      timetable_slot_id: 's1', occurrence_date: '2026-08-10', class_id: null,
      resolution_type: 'mock_test', status: 'resolved',
      prev_teacher_id: 't1', new_teacher_id: null,
      new_scheduled_at: null, new_duration_min: null,
      recording_id: null, mock_test_id: 'mt1',
      reason: null, notes: null, resolved_by: 'admin-1', resolved_at: '2026-08-09T11:00:00Z',
      created_at: '2026-08-09T10:30:00Z', updated_at: '2026-08-09T11:00:00Z',
      mock_test: { test_id: 'mt1', title: 'Physics Weekly Test' },
    };

    const mapped = mapClassResolutionRow(row);
    expect(mapped.mockTestTitle).toBe('Physics Weekly Test');
    expect(mapped.recordingTitle).toBeNull();
  });

  it('maps the recorded-class title from the source class embed (live recordings table has no title column)', () => {
    const base: DbClassResolutionRow = {
      resolution_id: 'r3', institute_id: 'i1', leave_request_id: 'l1',
      timetable_slot_id: 's1', occurrence_date: '2026-08-10', class_id: null,
      resolution_type: 'recorded_class', status: 'resolved',
      prev_teacher_id: 't1', new_teacher_id: null,
      new_scheduled_at: null, new_duration_min: null,
      recording_id: 'rec-1', mock_test_id: null,
      reason: null, notes: null, resolved_by: 'admin-1', resolved_at: '2026-08-09T11:00:00Z',
      created_at: '2026-08-09T10:30:00Z', updated_at: '2026-08-09T11:00:00Z',
    };

    const sourceTitle = 'Physics \u2014 Laws of Motion';

    // Object form (PostgREST to-one embed).
    const objectRow: DbClassResolutionRow = {
      ...base,
      recording: { recording_id: 'rec-1', source_class: { title: sourceTitle } },
    };
    expect(mapClassResolutionRow(objectRow).recordingTitle).toBe(sourceTitle);

    // Array form (PostgREST sometimes returns 1-element arrays).
    const arrayRow: DbClassResolutionRow = {
      ...base,
      recording: { recording_id: 'rec-1', source_class: [{ title: sourceTitle }] },
    };
    expect(mapClassResolutionRow(arrayRow).recordingTitle).toBe(sourceTitle);

    // Uploaded recording without a source class → null title.
    const noClassRow: DbClassResolutionRow = {
      ...base,
      recording: { recording_id: 'rec-2', source_class: null },
    };
    expect(mapClassResolutionRow(noClassRow).recordingTitle).toBeNull();
  });
});

describe('RPC result mappers', () => {
  it('maps the submit result', () => {
    const result = mapSubmitLeaveResult({
      success: true,
      leave_id: 'l1',
      is_emergency: true,
      affected_occurrences: 3,
      time_until_class: '05:00:00',
    });

    expect(result).toEqual({
      success: true,
      leaveId: 'l1',
      isEmergency: true,
      affectedOccurrences: 3,
      timeUntilClass: '05:00:00',
    });
  });

  it('maps cancel/review results', () => {
    expect(mapCancelLeaveResult({ success: true, leave_id: 'l1', status: 'cancelled' })).toEqual({
      success: true,
      leaveId: 'l1',
      status: 'cancelled',
    });
    expect(mapReviewLeaveResult({ success: true, leave_id: 'l1', status: 'approved' })).toEqual({
      success: true,
      leaveId: 'l1',
      status: 'approved',
    });
  });

  it('maps resolution results including optional fields', () => {
    const reschedule = mapResolutionResult({
      success: true,
      resolution_id: 'r1',
      type: 'reschedule',
      class_id: 'c2',
      new_scheduled_at: '2026-08-11T14:00:00Z',
    });
    expect(reschedule.resolutionType).toBe('reschedule');
    expect(reschedule.classId).toBe('c2');
    expect(reschedule.newScheduledAt).toBe('2026-08-11T14:00:00Z');
    expect(reschedule.testId).toBeNull();

    const cancel = mapResolutionResult({
      success: true,
      resolution_id: 'r2',
      type: 'cancelled',
    });
    expect(cancel.resolutionType).toBe('cancelled');
    expect(cancel.classId).toBeNull();
  });
});
