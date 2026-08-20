import { describe, it, expect } from 'vitest';
import { validateQuestionImportRows } from '../bulkQuestionValidator';
import type {
  QuestionReferenceData,
  RawQuestionSheetRow,
} from '@/types/bulkQuestionImport';
import type { Chapter, Subject, Topic } from '@/types/academic';

describe('validateQuestionImportRows', () => {
  const mockSubjects: Subject[] = [
    {
      subjectId: 'sub-1',
      streamId: 'stream-1',
      name: 'Physics',
      code: 'PHY',
      displayOrder: 1,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      createdBy: null,
      updatedBy: null,
    },
    {
      subjectId: 'sub-2',
      streamId: 'stream-1',
      name: 'Chemistry',
      code: 'CHE',
      displayOrder: 2,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      createdBy: null,
      updatedBy: null,
    },
  ];

  const mockChapters: Chapter[] = [
    {
      chapterId: 'chap-1',
      subjectId: 'sub-1',
      name: 'Kinematics',
      description: null,
      displayOrder: 1,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      createdBy: null,
      updatedBy: null,
    },
    {
      chapterId: 'chap-2',
      subjectId: 'sub-2',
      name: 'Periodic Table',
      description: null,
      displayOrder: 1,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      createdBy: null,
      updatedBy: null,
    },
  ];

  const mockTopics: Topic[] = [
    {
      topicId: 'top-1',
      chapterId: 'chap-1',
      name: 'Motion Under Gravity',
      displayOrder: 1,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      createdBy: null,
      updatedBy: null,
    },
  ];

  const mockRef: QuestionReferenceData = {
    subjects: mockSubjects,
    chapters: mockChapters,
    topics: mockTopics,
    existingQuestionTexts: new Set(['existing question stem in question bank']),
  };

  it('validates a valid single-choice MCQ question row', () => {
    const rawRows: RawQuestionSheetRow[] = [
      {
        rowNumber: 2,
        questionText: 'What is the velocity of a falling stone after 2 seconds?',
        questionType: 'MCQ',
        subject: 'PHY',
        chapter: 'Kinematics',
        topic: 'Motion Under Gravity',
        difficulty: 'Medium',
        marks: 4,
        negativeMarks: 1,
        optionA: '9.8 m/s',
        optionB: '19.6 m/s',
        optionC: '29.4 m/s',
        optionD: '39.2 m/s',
        correctAnswer: 'B',
        numericalAnswer: null,
        tolerance: null,
        explanation: 'v = u + gt => v = 0 + 9.8 * 2 = 19.6 m/s',
        rawCells: {},
      },
    ];

    const result = validateQuestionImportRows(rawRows, mockRef);
    expect(result.ok).toBe(true);
    expect(result.summary.validRows).toBe(1);
    expect(result.summary.invalidRows).toBe(0);
    expect(result.validPayloads.length).toBe(1);

    const payload = result.validPayloads[0];
    expect(payload.subject_id).toBe('sub-1');
    expect(payload.chapter_id).toBe('chap-1');
    expect(payload.question_type).toBe('mcq');
    expect(payload.difficulty).toBe('medium');
    expect(payload.options?.length).toBe(4);
    expect(payload.options?.find((o) => o.order_sequence === 2)?.is_correct).toBe(true);
  });

  it('validates a valid multiple-correct MSQ question row', () => {
    const rawRows: RawQuestionSheetRow[] = [
      {
        rowNumber: 2,
        questionText: 'Which of the following elements belong to the halogen group?',
        questionType: 'MSQ',
        subject: 'Chemistry',
        chapter: 'Periodic Table',
        topic: null,
        difficulty: 'Hard',
        marks: 4,
        negativeMarks: 1,
        optionA: 'Chlorine',
        optionB: 'Fluorine',
        optionC: 'Sodium',
        optionD: 'Argon',
        correctAnswer: 'A, B',
        numericalAnswer: null,
        tolerance: null,
        explanation: 'Chlorine and Fluorine are Group 17 halogens.',
        rawCells: {},
      },
    ];

    const result = validateQuestionImportRows(rawRows, mockRef);
    expect(result.ok).toBe(true);
    expect(result.summary.validRows).toBe(1);
    expect(result.validPayloads[0].options?.filter((o) => o.is_correct).length).toBe(2);
  });

  it('validates a valid numerical question row', () => {
    const rawRows: RawQuestionSheetRow[] = [
      {
        rowNumber: 2,
        questionText: 'Calculate the total displacement in meters over 5 seconds.',
        questionType: 'NUMERICAL',
        subject: 'PHY',
        chapter: 'Kinematics',
        topic: null,
        difficulty: 'Easy',
        marks: 3,
        negativeMarks: 0,
        optionA: null,
        optionB: null,
        optionC: null,
        optionD: null,
        correctAnswer: null,
        numericalAnswer: 122.5,
        tolerance: 0.5,
        explanation: 's = 0.5 * g * t^2',
        rawCells: {},
      },
    ];

    const result = validateQuestionImportRows(rawRows, mockRef);
    expect(result.ok).toBe(true);
    expect(result.validPayloads[0].correct_numerical_answer).toBe(122.5);
    expect(result.validPayloads[0].numerical_tolerance).toBe(0.5);
  });

  it('flags error when question text is less than 10 characters', () => {
    const rawRows: RawQuestionSheetRow[] = [
      {
        rowNumber: 2,
        questionText: 'Short',
        questionType: 'MCQ',
        subject: 'PHY',
        chapter: 'Kinematics',
        topic: null,
        difficulty: 'Easy',
        marks: 4,
        negativeMarks: 1,
        optionA: 'A',
        optionB: 'B',
        optionC: null,
        optionD: null,
        correctAnswer: 'A',
        numericalAnswer: null,
        tolerance: null,
        explanation: null,
        rawCells: {},
      },
    ];

    const result = validateQuestionImportRows(rawRows, mockRef);
    expect(result.ok).toBe(false);
    expect(result.summary.invalidRows).toBe(1);
    expect(result.rowIssues.some((i) => i.problem.includes('at least 10 characters'))).toBe(true);
  });

  it('flags error when embedded images are detected', () => {
    const rawRows: RawQuestionSheetRow[] = [
      {
        rowNumber: 2,
        questionText: 'Look at the diagram <img src="diagram.png" /> and find acceleration.',
        questionType: 'MCQ',
        subject: 'PHY',
        chapter: 'Kinematics',
        topic: null,
        difficulty: 'Easy',
        marks: 4,
        negativeMarks: 1,
        optionA: '5',
        optionB: '10',
        optionC: null,
        optionD: null,
        correctAnswer: 'A',
        numericalAnswer: null,
        tolerance: null,
        explanation: null,
        rawCells: {},
      },
    ];

    const result = validateQuestionImportRows(rawRows, mockRef);
    expect(result.ok).toBe(false);
    expect(result.rowIssues.some((i) => i.problem.includes('Embedded images'))).toBe(true);
  });

  it('flags error for unknown subject or mismatched chapter', () => {
    const rawRows: RawQuestionSheetRow[] = [
      {
        rowNumber: 2,
        questionText: 'What is the molecular formula of benzene?',
        questionType: 'MCQ',
        subject: 'PHY', // Chapter "Periodic Table" is in Chemistry, not PHY!
        chapter: 'Periodic Table',
        topic: null,
        difficulty: 'Easy',
        marks: 4,
        negativeMarks: 1,
        optionA: 'C6H6',
        optionB: 'CH4',
        optionC: null,
        optionD: null,
        correctAnswer: 'A',
        numericalAnswer: null,
        tolerance: null,
        explanation: null,
        rawCells: {},
      },
    ];

    const result = validateQuestionImportRows(rawRows, mockRef);
    expect(result.ok).toBe(false);
    expect(result.rowIssues.some((i) => i.problem.includes('does not exist under subject'))).toBe(true);
  });

  it('flags warning for duplicate question stems within the file and database', () => {
    const rawRows: RawQuestionSheetRow[] = [
      {
        rowNumber: 2,
        questionText: 'Existing question stem in question bank.',
        questionType: 'MCQ',
        subject: 'PHY',
        chapter: 'Kinematics',
        topic: null,
        difficulty: 'Easy',
        marks: 4,
        negativeMarks: 1,
        optionA: '1',
        optionB: '2',
        optionC: null,
        optionD: null,
        correctAnswer: 'A',
        numericalAnswer: null,
        tolerance: null,
        explanation: null,
        rawCells: {},
      },
    ];

    const result = validateQuestionImportRows(rawRows, mockRef);
    // Warnings do not block the row from being valid
    expect(result.ok).toBe(true);
    expect(result.summary.validRows).toBe(1);
    expect(result.rowIssues.some((i) => i.severity === 'warning' && i.problem.includes('already exists'))).toBe(true);
  });

  it('aggregates missing subjects and chapters into missingReferences without duplicating across rows', () => {
    const rawRows: RawQuestionSheetRow[] = [
      {
        rowNumber: 2,
        questionText: 'Question 1 referencing missing subject Biology and Genetics.',
        questionType: 'MCQ',
        subject: 'Biology',
        chapter: 'Genetics',
        topic: null,
        difficulty: 'Easy',
        marks: 4,
        negativeMarks: 1,
        optionA: 'A',
        optionB: 'B',
        optionC: null,
        optionD: null,
        correctAnswer: 'A',
        numericalAnswer: null,
        tolerance: null,
        explanation: null,
        rawCells: {},
      },
      {
        rowNumber: 3,
        questionText: 'Question 2 also referencing missing subject Biology and Genetics.',
        questionType: 'MCQ',
        subject: 'Biology',
        chapter: 'Genetics',
        topic: null,
        difficulty: 'Easy',
        marks: 4,
        negativeMarks: 1,
        optionA: 'A',
        optionB: 'B',
        optionC: null,
        optionD: null,
        correctAnswer: 'A',
        numericalAnswer: null,
        tolerance: null,
        explanation: null,
        rawCells: {},
      },
    ];

    const result = validateQuestionImportRows(rawRows, mockRef);
    expect(result.ok).toBe(false);
    expect(result.missingReferences.subjects.length).toBe(1);
    expect(result.missingReferences.subjects[0].rawName).toBe('Biology');
    expect(result.missingReferences.subjects[0].rowNumbers).toEqual([2, 3]);

    // Now simulate creating Biology & Genetics and revalidating:
    const updatedRef: QuestionReferenceData = {
      ...mockRef,
      subjects: [
        ...mockRef.subjects,
        {
          subjectId: 'sub-bio',
          streamId: 'stream-1',
          name: 'Biology',
          code: 'BIO',
          displayOrder: 3,
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
          createdBy: null,
          updatedBy: null,
        },
      ],
      chapters: [
        ...mockRef.chapters,
        {
          chapterId: 'chap-gen',
          subjectId: 'sub-bio',
          name: 'Genetics',
          description: null,
          displayOrder: 1,
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
          createdBy: null,
          updatedBy: null,
        },
      ],
    };

    const revalidatedResult = validateQuestionImportRows(rawRows, updatedRef);
    expect(revalidatedResult.ok).toBe(true);
    expect(revalidatedResult.summary.validRows).toBe(2);
    expect(revalidatedResult.missingReferences.subjects.length).toBe(0);
    expect(revalidatedResult.missingReferences.chapters.length).toBe(0);
  });

  it('validates and builds valid payload for TEXT_BASED question type', () => {
    const rawRows: RawQuestionSheetRow[] = [
      {
        rowNumber: 2,
        questionText: 'What is the SI unit of force in classical mechanics?',
        questionType: 'TEXT_BASED',
        subject: 'PHY',
        chapter: 'Kinematics',
        topic: 'Motion Under Gravity',
        difficulty: 'Easy',
        marks: 4,
        negativeMarks: 1,
        optionA: null,
        optionB: null,
        optionC: null,
        optionD: null,
        correctAnswer: 'Newton | N',
        numericalAnswer: null,
        tolerance: null,
        explanation: 'The SI unit of force is the Newton (N).',
        rawCells: {},
      },
    ];

    const result = validateQuestionImportRows(rawRows, mockRef);
    expect(result.ok).toBe(true);
    expect(result.summary.validRows).toBe(1);
    expect(result.validPayloads[0].question_type).toBe('text_based');
    expect(result.validPayloads[0].correct_text_answer).toBe('Newton | N');
    expect(result.validPayloads[0].options).toBeUndefined();
    expect(result.validPayloads[0].correct_numerical_answer).toBeNull();
  });

  it('rejects TEXT_BASED question if Correct Answer column is empty or numericalAnswer is provided', () => {
    const rawRows: RawQuestionSheetRow[] = [
      {
        rowNumber: 2,
        questionText: 'Name the process of cell division in somatic cells.',
        questionType: 'SHORT_ANSWER',
        subject: 'PHY',
        chapter: 'Kinematics',
        topic: null,
        difficulty: 'Medium',
        marks: 4,
        negativeMarks: 1,
        optionA: null,
        optionB: null,
        optionC: null,
        optionD: null,
        correctAnswer: '',
        numericalAnswer: 12.5,
        tolerance: null,
        explanation: null,
        rawCells: {},
      },
    ];

    const result = validateQuestionImportRows(rawRows, mockRef);
    expect(result.ok).toBe(false);
    expect(result.summary.invalidRows).toBe(1);
    expect(result.rowIssues.some((i) => i.column === 'Correct Answer' && i.problem.includes('Accepted answer is required'))).toBe(true);
    expect(result.rowIssues.some((i) => i.column === 'Numerical Answer' && i.problem.includes('must be left empty'))).toBe(true);
  });
});

