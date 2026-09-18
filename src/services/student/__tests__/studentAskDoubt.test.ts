import { describe, it, expect } from 'vitest';
import {
  studentDoubtAcademicService,
  type StudentBatchContext,
  type DoubtAcademicSelection,
} from '@/services/student/studentDoubtAcademicService';
import {
  validatePickedFile,
  resolvePickedMime,
  formatFileSize,
  MAX_ATTACHMENT_SIZE_BYTES,
  MAX_IMAGE_ATTACHMENT_SIZE_BYTES,
  MAX_PDF_ATTACHMENT_SIZE_BYTES,
} from '@/utils/doubtFileValidation';
import { doubtErrorMessage } from '@/utils/doubtErrors';
import { doubtKeys } from '@/hooks/doubt/queryKeys';

describe('Student Ask Doubt Flow Test Suite (Phase 3)', () => {
  // ─── 1. Academic Hierarchy & Selection State ──────────────────────────────
  describe('1. Academic Hierarchy & Cascading Reset Behavior', () => {
    const mockBatchContexts: StudentBatchContext[] = [
      {
        batchId: 'batch-1',
        batchName: 'Batch Alpha (JEE 2026)',
        courseId: 'course-1',
        courseName: 'Complete JEE Physics',
        subjects: [
          {
            batchSubjectId: 'bs-101',
            batchId: 'batch-1',
            subjectId: 'sub-phy',
            subjectName: 'Physics',
            subjectCode: 'PHY',
          },
          {
            batchSubjectId: 'bs-102',
            batchId: 'batch-1',
            subjectId: 'sub-chem',
            subjectName: 'Chemistry',
            subjectCode: 'CHE',
          },
        ],
      },
      {
        batchId: 'batch-2',
        batchName: 'Batch Beta (NEET 2026)',
        courseId: 'course-2',
        courseName: 'Target NEET Biology',
        subjects: [
          {
            batchSubjectId: 'bs-201',
            batchId: 'batch-2',
            subjectId: 'sub-bio',
            subjectName: 'Biology',
            subjectCode: 'BIO',
          },
        ],
      },
    ];

    it('determines if batch selector is needed based on active batch count', () => {
      expect(studentDoubtAcademicService.needsBatchSelector(mockBatchContexts)).toBe(true);
      expect(studentDoubtAcademicService.needsBatchSelector([mockBatchContexts[0]])).toBe(false);
      expect(studentDoubtAcademicService.needsBatchSelector([])).toBe(false);
    });

    it('returns available subjects strictly for the selected batch', () => {
      const batch1Subjects = studentDoubtAcademicService.subjectsForBatch(
        mockBatchContexts,
        'batch-1',
      );
      expect(batch1Subjects).toHaveLength(2);
      expect(batch1Subjects.map((s) => s.subjectId)).toEqual(['sub-phy', 'sub-chem']);

      const batch2Subjects = studentDoubtAcademicService.subjectsForBatch(
        mockBatchContexts,
        'batch-2',
      );
      expect(batch2Subjects).toHaveLength(1);
      expect(batch2Subjects[0].subjectId).toBe('sub-bio');
    });

    it('resets subject, chapter and topic when batch selection changes', () => {
      const initial: DoubtAcademicSelection = {
        batchId: 'batch-1',
        subjectId: 'sub-phy',
        chapterId: 'chap-1',
        topicId: 'topic-1',
      };

      const updated = studentDoubtAcademicService.selectBatch(initial, 'batch-2');
      expect(updated.batchId).toBe('batch-2');
      expect(updated.subjectId).toBeNull();
      expect(updated.chapterId).toBeNull();
      expect(updated.topicId).toBeNull();
    });

    it('resets chapter and topic when subject selection changes', () => {
      const initial: DoubtAcademicSelection = {
        batchId: 'batch-1',
        subjectId: 'sub-phy',
        chapterId: 'chap-1',
        topicId: 'topic-1',
      };

      const updated = studentDoubtAcademicService.selectSubject(initial, 'sub-chem');
      expect(updated.batchId).toBe('batch-1');
      expect(updated.subjectId).toBe('sub-chem');
      expect(updated.chapterId).toBeNull();
      expect(updated.topicId).toBeNull();
    });

    it('resets topic when chapter selection changes', () => {
      const initial: DoubtAcademicSelection = {
        batchId: 'batch-1',
        subjectId: 'sub-phy',
        chapterId: 'chap-1',
        topicId: 'topic-1',
      };

      const updated = studentDoubtAcademicService.selectChapter(initial, 'chap-2');
      expect(updated.batchId).toBe('batch-1');
      expect(updated.subjectId).toBe('sub-phy');
      expect(updated.chapterId).toBe('chap-2');
      expect(updated.topicId).toBeNull();
    });

    it('resolves the exact batch_subject_id from the selection', () => {
      const selection: DoubtAcademicSelection = {
        batchId: 'batch-1',
        subjectId: 'sub-phy',
        chapterId: 'chap-1',
        topicId: 'topic-1',
      };

      const batchSubjectId = studentDoubtAcademicService.resolveBatchSubjectId(
        mockBatchContexts,
        selection,
      );
      expect(batchSubjectId).toBe('bs-101');
    });
  });

  // ─── 2. Payload Construction & Validation ──────────────────────────────────
  describe('2. Payload Construction & Form Validation', () => {
    const mockBatchContexts: StudentBatchContext[] = [
      {
        batchId: 'batch-1',
        batchName: 'Batch Alpha',
        courseId: 'course-1',
        courseName: 'Complete Physics',
        subjects: [
          {
            batchSubjectId: 'bs-101',
            batchId: 'batch-1',
            subjectId: 'sub-phy',
            subjectName: 'Physics',
            subjectCode: 'PHY',
          },
        ],
      },
    ];

    it('constructs complete SubmitDoubtInput payload', () => {
      const selection: DoubtAcademicSelection = {
        batchId: 'batch-1',
        subjectId: 'sub-phy',
        chapterId: 'chap-10',
        topicId: 'topic-20',
      };

      const payload = studentDoubtAcademicService.buildSubmitDoubtInput(
        mockBatchContexts,
        selection,
        {
          title: '  Query on Lenz law sign convention  ',
          description: '  Why is the induced EMF opposing the flux change?  ',
          relatedResourceType: 'live_class',
          relatedResourceId: 'rec-1234',
        },
      );

      expect(payload.subjectId).toBe('sub-phy');
      expect(payload.batchSubjectId).toBe('bs-101');
      expect(payload.chapterId).toBe('chap-10');
      expect(payload.topicId).toBe('topic-20');
      expect(payload.title).toBe('Query on Lenz law sign convention');
      expect(payload.description).toBe('Why is the induced EMF opposing the flux change?');
      expect(payload.relatedResourceType).toBe('live_class');
      expect(payload.relatedResourceId).toBe('rec-1234');
    });

    it('enforces sensible field constraints on title and description', () => {
      const validateTitle = (t: string) => t.trim().length >= 5 && t.trim().length <= 200;
      const validateDesc = (d: string) => d.trim().length >= 1 && d.trim().length <= 5000;

      expect(validateTitle('1234')).toBe(false);
      expect(validateTitle('Valid title for doubt')).toBe(true);
      expect(validateTitle('a'.repeat(201))).toBe(false);

      expect(validateDesc('')).toBe(false);
      expect(validateDesc('   ')).toBe(false);
      expect(validateDesc('Detailed description here')).toBe(true);
      expect(validateDesc('a'.repeat(5001))).toBe(false);
    });
  });

  // ─── 3. Attachment Validation & MIME Handling ───────────────────────────────
  describe('3. File Attachment MIME & Size Validation', () => {
    it('accepts valid JPEG, PNG, WEBP and PDF files within size limits', () => {
      expect(
        validatePickedFile({
          name: 'notes.pdf',
          type: 'application/pdf',
          size: 5 * 1024 * 1024, // 5MB
        }),
      ).toBeNull();

      expect(
        validatePickedFile({
          name: 'diagram.png',
          type: 'image/png',
          size: 2 * 1024 * 1024, // 2MB
        }),
      ).toBeNull();

      expect(
        validatePickedFile({
          name: 'screenshot.jpg',
          type: 'image/jpeg',
          size: 1 * 1024 * 1024, // 1MB
        }),
      ).toBeNull();

      expect(
        validatePickedFile({
          name: 'chart.webp',
          type: 'image/webp',
          size: 500 * 1024, // 500KB
        }),
      ).toBeNull();
    });

    it('rejects unsupported file formats', () => {
      expect(
        validatePickedFile({
          name: 'script.exe',
          type: 'application/x-msdownload',
          size: 1024,
        }),
      ).toBe('Unsupported file type. Only JPEG, PNG, WEBP and PDF are allowed.');

      expect(
        validatePickedFile({
          name: 'video.mp4',
          type: 'video/mp4',
          size: 10240,
        }),
      ).toBe('Unsupported file type. Only JPEG, PNG, WEBP and PDF are allowed.');

      expect(
        validatePickedFile({
          name: 'document.docx',
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          size: 10240,
        }),
      ).toBe('Unsupported file type. Only JPEG, PNG, WEBP and PDF are allowed.');
    });

    it('rejects oversized images and PDFs according to specific limits', () => {
      // Images max 5MB
      expect(
        validatePickedFile({
          name: 'large_photo.png',
          type: 'image/png',
          size: 6 * 1024 * 1024,
        }),
      ).toBe('Images must be 5 MB or smaller.');

      // PDFs max 10MB
      expect(
        validatePickedFile({
          name: 'heavy_book.pdf',
          type: 'application/pdf',
          size: 12 * 1024 * 1024,
        }),
      ).toBe('PDF files must be 10 MB or smaller.');

      // Overall max 25MB
      expect(
        validatePickedFile({
          name: 'giant.pdf',
          type: 'application/pdf',
          size: 30 * 1024 * 1024,
        }),
      ).toBe('Files must be between 1 byte and 25 MB.');
    });

    it('resolves MIME type from filename extension when type header is missing', () => {
      expect(resolvePickedMime('photo.JPEG', '')).toBe('image/jpeg');
      expect(resolvePickedMime('document.pdf', null)).toBe('application/pdf');
      expect(resolvePickedMime('capture.PNG', '')).toBe('image/png');
      expect(resolvePickedMime('image.webp', '')).toBe('image/webp');
      expect(resolvePickedMime('unknown.xyz', '')).toBe('');
    });

    it('formats file sizes accurately into human-readable strings', () => {
      expect(formatFileSize(0)).toBe('0 B');
      expect(formatFileSize(512)).toBe('512 B');
      expect(formatFileSize(1024)).toBe('1.0 KB');
      expect(formatFileSize(1024 * 1024 * 2.5)).toBe('2.5 MB');
    });
  });

  // ─── 4. Query Keys & Error Handling ─────────────────────────────────────────
  describe('4. Query Keys Invalidation & Error Mapping', () => {
    it('provides correct doubt query keys for lists and invalidation', () => {
      expect(doubtKeys.lists()).toEqual(['doubts', 'list']);
      expect(doubtKeys.list('student')).toEqual(['doubts', 'list', 'student', undefined, undefined]);
      expect(doubtKeys.details()).toEqual(['doubts', 'detail']);
    });

    it('translates student submission RPC errors to safe user-friendly text', () => {
      expect(doubtErrorMessage('A subject is required for the doubt.')).toBe(
        'Please choose a subject for your doubt.',
      );
      expect(doubtErrorMessage('Doubt title must be 5-200 characters.')).toBe(
        'The doubt title must be between 5 and 200 characters.',
      );
      expect(doubtErrorMessage('Doubt description is required.')).toBe(
        'Please describe your doubt.',
      );
      expect(doubtErrorMessage('Only students can submit doubts.')).toBe(
        "You don't have permission to perform this action.",
      );
    });
  });
});
