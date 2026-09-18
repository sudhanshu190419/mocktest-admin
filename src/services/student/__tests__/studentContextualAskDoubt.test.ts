import fs from 'fs';
/**
 * Student Contextual "Ask a Doubt" Entry Points & Preselection Test Suite (Phase 4)
 *
 * Validates:
 *   1. Resource type normalization (recorded_class -> live_class, study_material -> content, test -> mock_test)
 *   2. Resource display metadata (label & icon mappings)
 *   3. Clean URL query generator for /student/doubts?new=true
 *   4. Academic context preselection (batchSubjectId, subjectId, subjectName, batchId, single-batch fallback)
 *   5. Recorded Class contextual launch (batch, subject, live_class resource type & ID)
 *   6. Live Classroom contextual launch (batch, subject, chapter/topic, live_class resource type & class ID)
 *   7. Test & Question Review contextual launch (question/mock_test resource type & ID)
 *   8. Detaching / clearing contextual resources
 *   9. Graceful fallback on missing/invalid academic data
 *  10. Standard doubt creation without context (Phase 3 regression protection)
 *
 * @module services/student/__tests__/studentContextualAskDoubt.test
 */

import { describe, it, expect } from 'vitest';
import {
  studentDoubtAcademicService,
  normalizeDoubtResourceType,
  getDoubtResourceDisplay,
  createContextQueryUrl,
  preselectAcademicContext,
  buildSubmitDoubtInput,
  type StudentBatchContext,
  type DoubtAcademicSelection,
} from '@/services/student/studentDoubtAcademicService';

// ─── Mock Academic Batch Contexts ─────────────────────────────────────────────

const mockContexts: StudentBatchContext[] = [
  {
    batchId: 'batch-jee-2026',
    batchName: 'JEE Main & Advanced 2026',
    courseId: 'course-jee',
    courseName: 'Complete JEE 2-Year Program',
    subjects: [
      {
        batchSubjectId: 'bs-phy-01',
        batchId: 'batch-jee-2026',
        subjectId: 'sub-physics',
        subjectName: 'Physics',
        subjectCode: 'PHY',
      },
      {
        batchSubjectId: 'bs-chem-01',
        batchId: 'batch-jee-2026',
        subjectId: 'sub-chemistry',
        subjectName: 'Chemistry',
        subjectCode: 'CHE',
      },
      {
        batchSubjectId: 'bs-math-01',
        batchId: 'batch-jee-2026',
        subjectId: 'sub-mathematics',
        subjectName: 'Mathematics',
        subjectCode: 'MTH',
      },
    ],
  },
  {
    batchId: 'batch-neet-2026',
    batchName: 'NEET Dropper 2026',
    courseId: 'course-neet',
    courseName: 'Target NEET Program',
    subjects: [
      {
        batchSubjectId: 'bs-bio-01',
        batchId: 'batch-neet-2026',
        subjectId: 'sub-biology',
        subjectName: 'Biology (Botany & Zoology)',
        subjectCode: 'BIO',
      },
      {
        batchSubjectId: 'bs-phy-neet',
        batchId: 'batch-neet-2026',
        subjectId: 'sub-physics',
        subjectName: 'Physics',
        subjectCode: 'PHY',
      },
    ],
  },
];

describe('Phase 4: Contextual "Ask a Doubt" Entry Points', () => {
  // ─── 1. Resource Normalization ──────────────────────────────────────────────
  describe('normalizeDoubtResourceType', () => {
    it('normalizes recorded_class to live_class', () => {
      expect(normalizeDoubtResourceType('recorded_class')).toBe('live_class');
    });

    it('normalizes study_material to content', () => {
      expect(normalizeDoubtResourceType('study_material')).toBe('content');
    });

    it('normalizes test to mock_test', () => {
      expect(normalizeDoubtResourceType('test')).toBe('mock_test');
    });

    it('preserves native backend enum values', () => {
      expect(normalizeDoubtResourceType('live_class')).toBe('live_class');
      expect(normalizeDoubtResourceType('question')).toBe('question');
      expect(normalizeDoubtResourceType('mock_test')).toBe('mock_test');
      expect(normalizeDoubtResourceType('content')).toBe('content');
      expect(normalizeDoubtResourceType('pyq_paper')).toBe('pyq_paper');
      expect(normalizeDoubtResourceType('teacher')).toBe('teacher');
    });

    it('returns null for null, undefined, or unknown types', () => {
      expect(normalizeDoubtResourceType(null)).toBeNull();
      expect(normalizeDoubtResourceType(undefined)).toBeNull();
      expect(normalizeDoubtResourceType('unknown_resource_type')).toBeNull();
    });
  });

  // ─── 2. Resource Display Helpers ────────────────────────────────────────────
  describe('getDoubtResourceDisplay', () => {
    it('provides clear labels and icons for learning surfaces', () => {
      expect(getDoubtResourceDisplay('recorded_class')).toEqual({
        label: 'Recorded Class',
        icon: 'video',
      });
      expect(getDoubtResourceDisplay('live_class')).toEqual({
        label: 'Live Class',
        icon: 'video',
      });
      expect(getDoubtResourceDisplay('question')).toEqual({
        label: 'Question Review',
        icon: 'question',
      });
      expect(getDoubtResourceDisplay('test')).toEqual({
        label: 'Mock Test',
        icon: 'award',
      });
      expect(getDoubtResourceDisplay('mock_test')).toEqual({
        label: 'Mock Test',
        icon: 'award',
      });
      expect(getDoubtResourceDisplay('study_material')).toEqual({
        label: 'Course Material',
        icon: 'content',
      });
      expect(getDoubtResourceDisplay('pyq_paper')).toEqual({
        label: 'PYQ Paper',
        icon: 'book',
      });
      expect(getDoubtResourceDisplay(null)).toEqual({
        label: 'Linked Resource',
        icon: 'question',
      });
    });
  });

  // ─── 3. URL Query Generator ─────────────────────────────────────────────────
  describe('createContextQueryUrl', () => {
    it('generates standard /student/doubts?new=true without params', () => {
      const url = createContextQueryUrl({});
      expect(url).toBe('/student/doubts?new=true');
    });

    it('encodes minimal IDs and safe parameters cleanly', () => {
      const url = createContextQueryUrl({
        batchId: 'batch-jee-2026',
        subjectId: 'sub-physics',
        chapterId: 'chap-electromagnetism',
        topicId: 'top-faraday-law',
        relatedResourceType: 'live_class',
        relatedResourceId: 'class-999',
        prefillTitle: 'Doubt on Faraday Law',
      });

      expect(url).toContain('/student/doubts?new=true');
      expect(url).toContain('batchId=batch-jee-2026');
      expect(url).toContain('subjectId=sub-physics');
      expect(url).toContain('chapterId=chap-electromagnetism');
      expect(url).toContain('topicId=top-faraday-law');
      expect(url).toContain('resourceType=live_class');
      expect(url).toContain('resourceId=class-999');
      expect(url).toContain('title=Doubt+on+Faraday+Law');
    });

    it('supports alias property names gracefully', () => {
      const url = createContextQueryUrl({
        batchId: 'batch-jee-2026',
        resourceType: 'recorded_class',
        resourceId: 'rec-555',
        title: 'Recording review question',
        subjectName: 'Physics',
      });

      expect(url).toContain('/student/doubts?new=true');
      expect(url).toContain('batchId=batch-jee-2026');
      expect(url).toContain('resourceType=live_class'); // Normalized!
      expect(url).toContain('resourceId=rec-555');
      expect(url).toContain('title=Recording+review+question');
      expect(url).toContain('subjectName=Physics');
    });
  });

  // ─── 4. Context Preselection ────────────────────────────────────────────────
  describe('preselectAcademicContext', () => {
    const emptySelection: DoubtAcademicSelection = {
      batchId: null,
      subjectId: null,
      chapterId: null,
      topicId: null,
    };

    it('preselects batch and subject when batchSubjectId is provided', () => {
      const result = preselectAcademicContext(mockContexts, emptySelection, {
        batchSubjectId: 'bs-chem-01',
        chapterId: 'chap-thermodynamics',
        topicId: 'top-entropy',
      });

      expect(result).toEqual({
        batchId: 'batch-jee-2026',
        subjectId: 'sub-chemistry',
        chapterId: 'chap-thermodynamics',
        topicId: 'top-entropy',
      });
    });

    it('preselects batch and subject when batchId and subjectId are provided', () => {
      const result = preselectAcademicContext(mockContexts, emptySelection, {
        batchId: 'batch-neet-2026',
        subjectId: 'sub-biology',
      });

      expect(result).toEqual({
        batchId: 'batch-neet-2026',
        subjectId: 'sub-biology',
        chapterId: null,
        topicId: null,
      });
    });

    it('preselects batch and subject when batchId and subjectName are provided', () => {
      const result = preselectAcademicContext(mockContexts, emptySelection, {
        batchId: 'batch-jee-2026',
        subjectName: 'Mathematics',
      });

      expect(result).toEqual({
        batchId: 'batch-jee-2026',
        subjectId: 'sub-mathematics',
        chapterId: null,
        topicId: null,
      });
    });

    it('preselects by subjectId across enrolled batches if batchId not specified', () => {
      const result = preselectAcademicContext(mockContexts, emptySelection, {
        subjectId: 'sub-chemistry',
      });

      expect(result).toEqual({
        batchId: 'batch-jee-2026',
        subjectId: 'sub-chemistry',
        chapterId: null,
        topicId: null,
      });
    });

    it('preselects by subjectName case-insensitively across enrolled batches', () => {
      const result = preselectAcademicContext(mockContexts, emptySelection, {
        subjectName: 'physics',
      });

      expect(result.subjectId).toBe('sub-physics');
      expect(result.batchId).toBe('batch-jee-2026');
    });

    it('auto-selects batch if student has exactly 1 enrolled batch', () => {
      const singleBatchList = [mockContexts[0]];
      const result = preselectAcademicContext(singleBatchList, emptySelection, null);

      expect(result.batchId).toBe('batch-jee-2026');
      expect(result.subjectId).toBeNull();
    });

    it('falls back safely to current selection if context params are invalid/unmatched', () => {
      const result = preselectAcademicContext(mockContexts, emptySelection, {
        batchId: 'non-existent-batch',
        subjectId: 'non-existent-subject',
      });

      expect(result).toEqual(emptySelection);
    });
  });

  // ─── 5. Entry Point 1: Recorded Classes ─────────────────────────────────────
  describe('Entry Point: Recorded Classes', () => {
    it('creates correct launch URL and submit payload for a recorded class', () => {
      const recordingData = {
        recordingId: 'rec-electro-01',
        classId: 'class-live-101',
        title: 'Electromagnetic Induction Session 1',
        batchId: 'batch-jee-2026',
        subjectName: 'Physics',
      };

      const url = createContextQueryUrl({
        batchId: recordingData.batchId,
        relatedResourceType: 'live_class',
        relatedResourceId: recordingData.classId,
        prefillTitle: `Doubt regarding recording: ${recordingData.title}`,
        subjectName: recordingData.subjectName,
      });

      expect(url).toContain('/student/doubts?new=true');
      expect(url).toContain('resourceType=live_class');
      expect(url).toContain('resourceId=class-live-101');
      expect(url).toContain('batchId=batch-jee-2026');
      expect(url).toContain('subjectName=Physics');

      // Academic preselection from these params
      const selection = preselectAcademicContext(mockContexts, {
        batchId: null,
        subjectId: null,
        chapterId: null,
        topicId: null,
      }, {
        batchId: recordingData.batchId,
        subjectName: recordingData.subjectName,
      });

      expect(selection.batchId).toBe('batch-jee-2026');
      expect(selection.subjectId).toBe('sub-physics');

      // Build submit input
      const payload = buildSubmitDoubtInput(mockContexts, selection, {
        title: `Doubt regarding recording: ${recordingData.title}`,
        description: 'How is the flux calculated through the loop?',
        relatedResourceType: 'live_class',
        relatedResourceId: recordingData.classId,
      });

      expect(payload.batchSubjectId).toBe('bs-phy-01');
      expect(payload.subjectId).toBe('sub-physics');
      expect(payload.relatedResourceType).toBe('live_class');
      expect(payload.relatedResourceId).toBe('class-live-101');
    });
  });

  // ─── 6. Entry Point 2: Live Classroom ───────────────────────────────────────
  describe('Entry Point: Live Classroom', () => {
    it('creates correct launch parameters and submit payload for a live class', () => {
      const liveClassData = {
        classId: 'live-class-777',
        title: 'Organic Reaction Mechanisms - Electrophilic Addition',
        batchId: 'batch-jee-2026',
        subjectName: 'Chemistry',
        chapterName: 'Organic Chemistry',
        topicName: 'Electrophilic Addition',
      };

      const selection = preselectAcademicContext(mockContexts, {
        batchId: null,
        subjectId: null,
        chapterId: null,
        topicId: null,
      }, {
        batchId: liveClassData.batchId,
        subjectName: liveClassData.subjectName,
      });

      expect(selection.batchId).toBe('batch-jee-2026');
      expect(selection.subjectId).toBe('sub-chemistry');

      const payload = buildSubmitDoubtInput(mockContexts, selection, {
        title: `Doubt regarding live class: ${liveClassData.title}`,
        description: 'Why does Markovnikov rule favor the secondary carbocation here?',
        relatedResourceType: 'live_class',
        relatedResourceId: liveClassData.classId,
      });

      expect(payload.batchSubjectId).toBe('bs-chem-01');
      expect(payload.subjectId).toBe('sub-chemistry');
      expect(payload.relatedResourceType).toBe('live_class');
      expect(payload.relatedResourceId).toBe('live-class-777');
    });
  });

  // ─── 7. Entry Point 3: Mock Test / Question Review ──────────────────────────
  describe('Entry Point: Mock Test & Question Review', () => {
    it('creates correct launch URL and payload for a question review', () => {
      const questionData = {
        questionId: 'q-math-calculus-42',
        index: 12,
        testTitle: 'JEE Advanced Mock Test 04',
        sectionName: 'Mathematics',
      };

      const url = createContextQueryUrl({
        relatedResourceType: 'question',
        relatedResourceId: questionData.questionId,
        prefillTitle: `Question ${questionData.index}: Doubt in ${questionData.testTitle}`,
        subjectName: questionData.sectionName,
      });

      expect(url).toContain('/student/doubts?new=true');
      expect(url).toContain('resourceType=question');
      expect(url).toContain('resourceId=q-math-calculus-42');
      expect(url).toContain('subjectName=Mathematics');

      const selection = preselectAcademicContext(mockContexts, {
        batchId: null,
        subjectId: null,
        chapterId: null,
        topicId: null,
      }, {
        subjectName: questionData.sectionName,
      });

      expect(selection.batchId).toBe('batch-jee-2026');
      expect(selection.subjectId).toBe('sub-mathematics');

      const payload = buildSubmitDoubtInput(mockContexts, selection, {
        title: `Question ${questionData.index}: Doubt in ${questionData.testTitle}`,
        description: 'Why is L Hospital rule not applicable at x=0 for this limit?',
        relatedResourceType: 'question',
        relatedResourceId: questionData.questionId,
      });

      expect(payload.batchSubjectId).toBe('bs-math-01');
      expect(payload.subjectId).toBe('sub-mathematics');
      expect(payload.relatedResourceType).toBe('question');
      expect(payload.relatedResourceId).toBe('q-math-calculus-42');
    });

    it('creates correct payload for a full test level doubt', () => {
      const selection: DoubtAcademicSelection = {
        batchId: 'batch-jee-2026',
        subjectId: 'sub-physics',
        chapterId: null,
        topicId: null,
      };

      const payload = buildSubmitDoubtInput(mockContexts, selection, {
        title: 'Discrepancy in Question 15 answer key',
        description: 'The answer key marks option B as correct, but the textbook formula yields option C.',
        relatedResourceType: 'test' as any,
        relatedResourceId: 'test-jee-adv-04',
      });

      expect(payload.relatedResourceType).toBe('mock_test'); // Normalized!
      expect(payload.relatedResourceId).toBe('test-jee-adv-04');
    });
  });

  // ─── 8. Detaching / Clearing Context ─────────────────────────────────────────
  describe('Detaching Contextual Resources', () => {
    it('generates a clean general doubt payload when student detaches contextual resource', () => {
      const selection: DoubtAcademicSelection = {
        batchId: 'batch-jee-2026',
        subjectId: 'sub-physics',
        chapterId: null,
        topicId: null,
      };

      // Student detached context -> relatedResourceType and relatedResourceId become null/undefined
      const payload = buildSubmitDoubtInput(mockContexts, selection, {
        title: 'General question on rotational dynamics',
        description: 'Can angular momentum be conserved when torque is non-zero in another axis?',
        relatedResourceType: null,
        relatedResourceId: null,
      });

      expect(payload.subjectId).toBe('sub-physics');
      expect(payload.batchSubjectId).toBe('bs-phy-01');
      expect(payload.relatedResourceType).toBeNull();
      expect(payload.relatedResourceId).toBeNull();
    });
  });

  // ─── 9. Phase 3 Regression Protection ───────────────────────────────────────
  describe('Phase 3 Regression Protection (No Context)', () => {
    it('creates empty selection and standard payload when no context is provided', () => {
      const empty = studentDoubtAcademicService.createEmptySelection();
      expect(empty).toEqual({
        batchId: null,
        subjectId: null,
        chapterId: null,
        topicId: null,
      });

      const selectionWithManualPick: DoubtAcademicSelection = {
        batchId: 'batch-neet-2026',
        subjectId: 'sub-biology',
        chapterId: 'chap-genetics',
        topicId: 'top-mendel-laws',
      };

      const payload = buildSubmitDoubtInput(mockContexts, selectionWithManualPick, {
        title: 'Dihybrid cross ratio exception',
        description: 'What causes the 9:7 ratio instead of 9:3:3:1?',
      });

      expect(payload.subjectId).toBe('sub-biology');
      expect(payload.batchSubjectId).toBe('bs-bio-01');
      expect(payload.chapterId).toBe('chap-genetics');
      expect(payload.topicId).toBe('top-mendel-laws');
      expect(payload.relatedResourceType).toBeNull();
      expect(payload.relatedResourceId).toBeNull();
    });
  });
  // ─── 10. Subject Learning Workspace Content Context ─────────────────────────
  describe('Subject Learning Workspace Content Ask Doubt Navigation', () => {
    it('generates standardized contextual URL for course/subject content item', () => {
      const url = createContextQueryUrl({
        relatedResourceType: 'content',
        relatedResourceId: 'cnt-wave-optics-01',
        subjectId: 'sub-physics',
        batchSubjectId: 'bs-phy-01',
        subjectName: 'Physics',
        prefillTitle: 'Doubt regarding Wave Optics Lecture 1',
      });

      expect(url).toContain('/student/doubts?new=true');
      expect(url).toContain('resourceType=content');
      expect(url).toContain('resourceId=cnt-wave-optics-01');
      expect(url).toContain('subjectId=sub-physics');
      expect(url).toContain('batchSubjectId=bs-phy-01');
      expect(url).toContain('subjectName=Physics');
      expect(url).toContain('title=Doubt+regarding+Wave+Optics+Lecture+1');

      // Crucial: verify absence of legacy parameters
      expect(url).not.toContain('refContentId');
      expect(url).not.toContain('refTitle');
    });

    it('verifies Subject Learning Workspace source code uses standardized helper without legacy params', () => {
      const pageSource = fs.readFileSync(
        'src/app/student/courses/[courseId]/subjects/[subjectId]/page.tsx',
        'utf8'
      );

      expect(pageSource).toContain('createContextQueryUrl');
      expect(pageSource).toContain("relatedResourceType: 'content'");
      expect(pageSource).toContain('prefillTitle: `Doubt regarding ${title}`');
      expect(pageSource).not.toContain('refContentId');
      expect(pageSource).not.toContain('refTitle');
    });

    it('builds valid SubmitDoubtInput with content resource type from subject workspace', () => {
      const selection: DoubtAcademicSelection = {
        batchId: 'batch-jee-2026',
        subjectId: 'sub-physics',
        chapterId: null,
        topicId: null,
      };

      const payload = buildSubmitDoubtInput(mockContexts, selection, {
        title: 'Doubt regarding Wave Optics Lecture 1',
        description: 'Why is central maximum fringe width twice the secondary fringe width?',
        relatedResourceType: 'content',
        relatedResourceId: 'cnt-wave-optics-01',
      });

      expect(payload.subjectId).toBe('sub-physics');
      expect(payload.batchSubjectId).toBe('bs-phy-01');
      expect(payload.relatedResourceType).toBe('content');
      expect(payload.relatedResourceId).toBe('cnt-wave-optics-01');
      expect(payload.title).toBe('Doubt regarding Wave Optics Lecture 1');
    });
  });
});
