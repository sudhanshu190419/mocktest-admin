import { describe, it, expect } from 'vitest';
import { doubtErrorMessage } from '@/utils/doubtErrors';

describe('doubtErrorMessage', () => {
  it('maps permission errors to a friendly message', () => {
    expect(doubtErrorMessage('Only students can submit doubts.')).toBe(
      "You don't have permission to perform this action.",
    );
    expect(doubtErrorMessage('Only academic admins can assign teachers to doubts.')).toBe(
      "You don't have permission to perform this action.",
    );
    expect(doubtErrorMessage('Only academic admins can archive doubts.')).toBe(
      "You don't have permission to perform this action.",
    );
    expect(doubtErrorMessage('Only the doubt owner can accept an answer.')).toBe(
      "You don't have permission to perform this action.",
    );
    expect(doubtErrorMessage('You do not have access to this doubt.')).toBe(
      "You don't have permission to perform this action.",
    );
    expect(doubtErrorMessage('You do not have access to doubts in this institute.')).toBe(
      "You don't have permission to perform this action.",
    );
    expect(doubtErrorMessage('Authentication required.')).toBe(
      "You don't have permission to perform this action.",
    );
  });

  it('maps archived / terminal-state guards', () => {
    expect(doubtErrorMessage('This doubt is archived and can no longer be modified.')).toBe(
      'This doubt is archived and can no longer be modified.',
    );
    expect(doubtErrorMessage('Doubt is already archived.')).toBe(
      'This doubt is already archived.',
    );
    expect(doubtErrorMessage('Archived doubts cannot be assigned.')).toBe(
      'Archived doubts cannot be assigned.',
    );
    expect(doubtErrorMessage('Resolved doubts cannot be reassigned.')).toBe(
      'This doubt is already resolved and cannot be reassigned.',
    );
  });

  it('maps status-transition guards', () => {
    expect(doubtErrorMessage('Only resolved doubts can be reopened.')).toBe(
      'Only resolved doubts can be reopened.',
    );
    expect(doubtErrorMessage('This doubt has been reopened the maximum number of times.')).toBe(
      'This doubt has been reopened the maximum number of times (3).',
    );
    expect(doubtErrorMessage('Doubt cannot be resolved from its current state.')).toBe(
      'This doubt cannot be changed in its current state.',
    );
    expect(doubtErrorMessage('Doubt cannot be reopened from its current state.')).toBe(
      'This doubt cannot be changed in its current state.',
    );
  });

  it('maps submit validation messages', () => {
    expect(doubtErrorMessage('A subject is required for the doubt.')).toBe(
      'Please choose a subject for your doubt.',
    );
    expect(doubtErrorMessage('Doubt title must be 5-200 characters.')).toBe(
      'The doubt title must be between 5 and 200 characters.',
    );
    expect(doubtErrorMessage('Doubt description is required.')).toBe(
      'Please describe your doubt.',
    );
    expect(doubtErrorMessage('Reply text is required.')).toBe(
      'Please write a reply before submitting.',
    );
    expect(doubtErrorMessage('Topic requires a chapter.')).toBe(
      'Please choose a chapter before selecting a topic.',
    );
  });

  it('maps resource lookup / consistency messages', () => {
    expect(doubtErrorMessage('Subject not found.')).toBe(
      'The selected subject could not be found.',
    );
    expect(doubtErrorMessage('Chapter does not belong to the selected subject.')).toBe(
      'The selected chapter is not valid for this subject.',
    );
    expect(doubtErrorMessage('Topic does not belong to the selected chapter.')).toBe(
      'The selected topic is not valid for this chapter.',
    );
    expect(doubtErrorMessage('Batch subject does not belong to your institute.')).toBe(
      'The selected batch subject does not belong to your institute.',
    );
    expect(doubtErrorMessage('The subject does not match the selected batch subject.')).toBe(
      'The subject does not match the selected batch subject.',
    );
    expect(doubtErrorMessage('You are not enrolled in the batch for this subject.')).toBe(
      "You're not enrolled in the batch for this subject.",
    );
  });

  it('maps migration-118 academic-scope messages', () => {
    expect(doubtErrorMessage('Batch subject is not active.')).toBe(
      'This batch subject is currently inactive.',
    );
    expect(
      doubtErrorMessage('The selected subject is not part of any of your active batches.'),
    ).toBe('This subject is not available in any of your active batches.');
    expect(
      doubtErrorMessage(
        'The selected subject belongs to multiple of your batches. Please provide the specific batch subject.',
      ),
    ).toBe(
      'This subject belongs to multiple of your batches. Please choose the specific batch subject.',
    );
  });

  it('maps reply / answer validation messages', () => {
    expect(doubtErrorMessage('Reply does not belong to this doubt.')).toBe(
      'This reply does not belong to the doubt.',
    );
    expect(doubtErrorMessage("Only a teacher's answer can be accepted as the solution.")).toBe(
      "Only a teacher's answer can be accepted as the solution.",
    );
  });

  it('maps assignment validation messages', () => {
    expect(doubtErrorMessage('Teacher not found.')).toBe(
      'The selected teacher could not be found.',
    );
    expect(doubtErrorMessage('The selected teacher is not active.')).toBe(
      'The selected teacher is not active.',
    );
    expect(doubtErrorMessage('The selected teacher is not assigned to this subject/batch.')).toBe(
      'The selected teacher is not assigned to this subject or batch.',
    );
  });

  it('maps attachment validation messages', () => {
    expect(doubtErrorMessage('Unsupported file type. Only JPEG, PNG, WEBP and PDF are allowed.')).toBe(
      'Unsupported file type. Only JPEG, PNG, WEBP and PDF are allowed.',
    );
    expect(doubtErrorMessage('File must be between 1 byte and 25 MB.')).toBe(
      'Files must be between 1 byte and 25 MB.',
    );
  });

  it('maps not-found messages', () => {
    expect(doubtErrorMessage('Doubt not found.')).toBe(
      'The doubt could not be found. It may have been removed.',
    );
  });

  it('passes unknown messages through verbatim', () => {
    const unknown = 'Some unexpected RPC message.';
    expect(doubtErrorMessage(unknown)).toBe(unknown);
  });

  it('returns the fallback for empty messages', () => {
    expect(doubtErrorMessage('')).toBe('Something went wrong. Please try again.');
    expect(doubtErrorMessage('   ')).toBe('Something went wrong. Please try again.');
    expect(doubtErrorMessage(null as unknown as string)).toBe(
      'Something went wrong. Please try again.',
    );
  });
});
