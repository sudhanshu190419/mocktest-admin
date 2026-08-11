import { describe, it, expect } from 'vitest';
import { leaveRequestErrorMessage } from '@/utils/teacherLeaveErrors';

describe('leaveRequestErrorMessage', () => {
  it('maps permission errors to a friendly message', () => {
    expect(leaveRequestErrorMessage('Only teachers can submit leave requests.')).toBe(
      "You don't have permission to perform this action.",
    );
    expect(leaveRequestErrorMessage('Only academic or super admins can review leave requests.')).toBe(
      "You don't have permission to perform this action.",
    );
    expect(leaveRequestErrorMessage('Leave requests can only be reviewed for your own institute.')).toBe(
      "You don't have permission to perform this action.",
    );
    expect(
      leaveRequestErrorMessage('Timetable slot abc is not an active slot of yours in this institute.'),
    ).toBe("You don't have permission to perform this action.");
    expect(leaveRequestErrorMessage('You can only cancel your own leave requests.')).toBe(
      "You don't have permission to perform this action.",
    );
  });

  it('maps already-started / live / completed errors', () => {
    expect(
      leaveRequestErrorMessage('Leave cannot cover a class that has already started on 2026-08-10.'),
    ).toBe('This class can no longer be changed — it has already started or finished.');
    expect(
      leaveRequestErrorMessage('The class on 2026-08-10 has already started; the request cannot be approved.'),
    ).toBe('This class can no longer be changed — it has already started or finished.');
    expect(
      leaveRequestErrorMessage('The affected class has already started; it cannot be substituted.'),
    ).toBe('This class can no longer be changed — it has already started or finished.');
    expect(
      leaveRequestErrorMessage('The affected class is not in a scheduled state; it cannot be substituted.'),
    ).toBe('This class is no longer in a scheduled state and cannot be changed.');
  });

  it('maps leave-cannot-cover-live-completed distinctly', () => {
    expect(
      leaveRequestErrorMessage('Leave cannot cover a live or completed class on 2026-08-10.'),
    ).toBe('Leave cannot cover a class that is already live or completed.');
    expect(
      leaveRequestErrorMessage('Occurrence 2026-08-10 now has a live/completed class; the request cannot be approved.'),
    ).toBe('This class can no longer be changed — it has already started or finished.');
  });

  it('maps already-handled request/resolution errors', () => {
    expect(
      leaveRequestErrorMessage('Only pending leave requests can be reviewed (current status: approved).'),
    ).toBe('This request has already been handled.');
    expect(leaveRequestErrorMessage('Resolution is not pending (current status: resolved).')).toBe(
      'This class has already been handled.',
    );
    expect(
      leaveRequestErrorMessage('Another active resolution already exists for the target date.'),
    ).toBe('This class has already been handled.');
  });

  it('maps no-upcoming-classes errors', () => {
    expect(leaveRequestErrorMessage('No timetable slots found for the requested date range.')).toBe(
      'No upcoming classes were found for the selected dates.',
    );
    expect(
      leaveRequestErrorMessage(
        'No class occurrences fall inside the requested date range for your timetable slots.',
      ),
    ).toBe('No upcoming classes were found for the selected dates.');
  });

  it('maps substitute-teacher availability errors', () => {
    expect(leaveRequestErrorMessage('Teacher is not assigned to this batch subject.')).toBe(
      'The selected teacher is not assigned to this batch subject.',
    );
    expect(leaveRequestErrorMessage('Teacher is on leave on this date.')).toBe(
      'The selected teacher is unavailable at this time.',
    );
    expect(leaveRequestErrorMessage('Teacher conflict (teacher busy).')).toBe(
      'The selected teacher is unavailable at this time.',
    );
    expect(leaveRequestErrorMessage('Substitute teacher not found in this institute.')).toBe(
      'The selected teacher is unavailable at this time.',
    );
  });

  it('maps batch and holiday conflicts', () => {
    expect(leaveRequestErrorMessage('The batch already has a live class in this time window.')).toBe(
      'The batch already has another class at this time.',
    );
    expect(leaveRequestErrorMessage('The occurrence date is an institute holiday.')).toBe(
      'The chosen time falls on a holiday or teacher leave.',
    );
  });

  it('maps validation and resource-lookup errors', () => {
    expect(leaveRequestErrorMessage('Mock test not found or not published in this institute.')).toBe(
      'The selected mock test is not available in this institute.',
    );
    expect(leaveRequestErrorMessage('Recording not found or not ready in this institute.')).toBe(
      'The selected recording is not available in this institute.',
    );
    expect(leaveRequestErrorMessage('A valid leave date range (start <= end) is required.')).toBe(
      'Please choose a valid date range (start on or before end).',
    );
    expect(leaveRequestErrorMessage('Leave request not found.')).toBe(
      'The record could not be found. It may have been removed.',
    );
  });

  it('passes unknown user-safe messages through verbatim', () => {
    expect(leaveRequestErrorMessage("Decision must be 'approve' or 'reject'.")).toBe(
      "Decision must be 'approve' or 'reject'.",
    );
  });

  it('falls back for empty messages', () => {
    expect(leaveRequestErrorMessage('')).toBe('Something went wrong. Please try again.');
    expect(leaveRequestErrorMessage('   ')).toBe('Something went wrong. Please try again.');
  });
});
