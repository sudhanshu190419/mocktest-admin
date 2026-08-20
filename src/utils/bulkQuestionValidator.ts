/**
 * Bulk Question Import — Pure Validator
 *
 * Validates parsed question rows against preloaded in-memory reference data.
 * Pure business logic — NO network calls, NO database access, NO React.
 *
 * @module utils/bulkQuestionValidator
 */

import type {
  QuestionImportIssue,
  QuestionImportPayloadItem,
  QuestionImportPreview,
  QuestionImportPreviewRow,
  QuestionOptionPayload,
  QuestionReferenceData,
  RawQuestionSheetRow,
} from '@/types/bulkQuestionImport';
import type { QuestionType, DifficultyLevel } from '@/types/mockTest';
import type { Chapter, Subject, Topic } from '@/types/academic';

/** Regular expression detecting unsupported embedded images. */
const IMAGE_EMBED_REGEX = /<img\b|data:image\/|!\[.*?\]\(.*?\)|<figure\b/i;

/** Normalize text for fuzzy matching. */
function normalizeText(text: string | null | undefined): string {
  return (text ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Normalize question stems for duplicate comparison (removes punctuation and extra whitespace). */
function normalizeStem(stem: string | null | undefined): string {
  return (stem ?? '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Maps raw type string to canonical QuestionType.
 */
function normalizeQuestionType(raw: string | null): QuestionType | null {
  if (!raw) return null;
  const cleaned = raw.toLowerCase().trim().replace(/[\s_-]+/g, '');
  if (cleaned === 'mcq' || cleaned === 'singlechoice' || cleaned === 'singlecorrect') return 'mcq';
  if (cleaned === 'msq' || cleaned === 'multiplechoice' || cleaned === 'multiplecorrect') return 'msq';
  if (cleaned === 'numerical' || cleaned === 'integer' || cleaned === 'numeric') return 'numerical';
  if (cleaned === 'truefalse' || cleaned === 'tf' || cleaned === 'boolean') return 'true_false';
  if (cleaned === 'textbased' || cleaned === 'text' || cleaned === 'shortanswer' || cleaned === 'sa') return 'text_based';
  return null;
}

/**
 * Maps raw difficulty string to canonical DifficultyLevel.
 */
function normalizeDifficulty(raw: string | null): DifficultyLevel | null {
  if (!raw) return null;
  const cleaned = raw.toLowerCase().trim();
  if (cleaned === 'easy' || cleaned === 'e' || cleaned === 'low') return 'easy';
  if (cleaned === 'medium' || cleaned === 'med' || cleaned === 'm' || cleaned === 'moderate') return 'medium';
  if (cleaned === 'hard' || cleaned === 'h' || cleaned === 'difficult' || cleaned === 'high') return 'hard';
  return null;
}

/**
 * Parse correct answer letters (e.g. "A, C" or "A,B,D" or "True").
 */
function parseCorrectLetters(raw: string | null): string[] {
  if (!raw) return [];
  const cleaned = raw.toUpperCase().replace(/\bAND\b/g, ',');
  const matches = cleaned.match(/[A-D]/g);
  return matches ? [...new Set(matches)] : [];
}

/**
 * Pure validator function.
 */
export function validateQuestionImportRows(
  rows: RawQuestionSheetRow[],
  ref: QuestionReferenceData,
  fileIssues: QuestionImportIssue[] = [],
): QuestionImportPreview {
  const allRowIssues: QuestionImportIssue[] = [];
  const previewRows: QuestionImportPreviewRow[] = [];
  const validPayloads: QuestionImportPayloadItem[] = [];

  // Lookup maps
  const subjectByCode = new Map<string, Subject>();
  const subjectByName = new Map<string, Subject>();
  for (const s of ref.subjects) {
    if (s.code) subjectByCode.set(s.code.toLowerCase().trim(), s);
    subjectByName.set(s.name.toLowerCase().trim(), s);
  }

  // Chapters grouped by subject_id -> chapterName -> Chapter
  const chaptersBySubjectAndName = new Map<string, Map<string, Chapter>>();
  for (const c of ref.chapters) {
    let map = chaptersBySubjectAndName.get(c.subjectId);
    if (!map) {
      map = new Map<string, Chapter>();
      chaptersBySubjectAndName.set(c.subjectId, map);
    }
    map.set(c.name.toLowerCase().trim(), c);
  }

  // Topics grouped by chapter_id -> topicName -> Topic
  const topicsByChapterAndName = new Map<string, Map<string, Topic>>();
  for (const t of ref.topics) {
    let map = topicsByChapterAndName.get(t.chapterId);
    if (!map) {
      map = new Map<string, Topic>();
      topicsByChapterAndName.set(t.chapterId, map);
    }
    map.set(t.name.toLowerCase().trim(), t);
  }

  // In-file duplicate tracking: Map<normalizedStem, rowNumbers[]>
  const inFileStems = new Map<string, number[]>();
  for (const r of rows) {
    if (r.questionText) {
      const stem = normalizeStem(r.questionText);
      if (stem.length > 5) {
        const existing = inFileStems.get(stem) ?? [];
        existing.push(r.rowNumber);
        inFileStems.set(stem, existing);
      }
    }
  }

  // Missing entity tracking
  const missingSubjectsMap = new Map<string, { rawName: string; rowNumbers: number[] }>();
  const missingChaptersMap = new Map<string, { rawSubject: string; rawChapter: string; resolvedSubjectId: string | null; resolvedSubjectName: string | null; rowNumbers: number[] }>();
  const missingTopicsMap = new Map<string, { rawChapter: string; rawTopic: string; resolvedChapterId: string | null; resolvedChapterName: string | null; rowNumbers: number[] }>();

  const typeCounts: Record<string, number> = {
    mcq: 0,
    msq: 0,
    numerical: 0,
    true_false: 0,
  };

  let validCount = 0;
  let warningCount = 0;

  for (const raw of rows) {
    const issues: QuestionImportIssue[] = [];
    const rNum = raw.rowNumber;

    // ── 1. Question Text ───────────────────────────────────────────────────
    const rawText = raw.questionText?.trim() ?? '';
    if (!rawText) {
      issues.push({
        row: rNum,
        column: 'Question Text',
        value: null,
        problem: 'Question text is required.',
        suggestion: 'Provide question stem text (minimum 10 characters).',
        severity: 'error',
      });
    } else if (rawText.length < 10) {
      issues.push({
        row: rNum,
        column: 'Question Text',
        value: rawText,
        problem: `Question text must be at least 10 characters (got ${rawText.length}).`,
        suggestion: 'Expand the question text to meet the minimum character requirement.',
        severity: 'error',
      });
    } else if (IMAGE_EMBED_REGEX.test(rawText)) {
      issues.push({
        row: rNum,
        column: 'Question Text',
        value: rawText.slice(0, 40) + '...',
        problem: 'Embedded images (<img>, data URI, or markdown image syntax) are not supported.',
        suggestion: 'Remove image tags. For diagram questions, create them individually using the Question Form.',
        severity: 'error',
      });
    }

    // ── 2. Question Type ───────────────────────────────────────────────────
    const qType = normalizeQuestionType(raw.questionType);
    if (!qType) {
      issues.push({
        row: rNum,
        column: 'Question Type',
        value: raw.questionType,
        problem: `Invalid question type "${raw.questionType ?? ''}".`,
        suggestion: 'Allowed types: MCQ, MSQ, NUMERICAL, TRUE_FALSE.',
        severity: 'error',
      });
    }

    // ── 3. Difficulty ──────────────────────────────────────────────────────
    const difficulty = normalizeDifficulty(raw.difficulty);
    if (!difficulty) {
      issues.push({
        row: rNum,
        column: 'Difficulty',
        value: raw.difficulty,
        problem: `Invalid difficulty "${raw.difficulty ?? ''}".`,
        suggestion: 'Allowed values: Easy, Medium, Hard.',
        severity: 'error',
      });
    }

    // ── 4. Marks & Negative Marks ──────────────────────────────────────────
    let marks = 4;
    if (raw.marks !== null && raw.marks !== undefined && raw.marks !== '') {
      const num = Number(raw.marks);
      if (!Number.isFinite(num) || num <= 0) {
        issues.push({
          row: rNum,
          column: 'Marks',
          value: raw.marks,
          problem: 'Marks must be a positive number greater than 0.',
          severity: 'error',
        });
      } else {
        marks = num;
      }
    }

    let negativeMarks = 1;
    if (raw.negativeMarks !== null && raw.negativeMarks !== undefined && raw.negativeMarks !== '') {
      const num = Number(raw.negativeMarks);
      if (!Number.isFinite(num) || num < 0) {
        issues.push({
          row: rNum,
          column: 'Negative Marks',
          value: raw.negativeMarks,
          problem: 'Negative marks must be a non-negative number (>= 0).',
          severity: 'error',
        });
      } else {
        negativeMarks = num;
      }
    }

    // ── 5. Subject Resolution ──────────────────────────────────────────────
    const rawSub = (raw.subject ?? '').trim();
    let resolvedSubject: Subject | null = null;
    if (!rawSub) {
      issues.push({
        row: rNum,
        column: 'Subject',
        value: null,
        problem: 'Subject is required.',
        suggestion: 'Enter an active subject code or name.',
        severity: 'error',
      });
    } else {
      resolvedSubject = subjectByCode.get(rawSub.toLowerCase()) ?? subjectByName.get(rawSub.toLowerCase()) ?? null;
      if (!resolvedSubject) {
        issues.push({
          row: rNum,
          column: 'Subject',
          value: rawSub,
          problem: `Subject "${rawSub}" was not found in your institute.`,
          suggestion: 'Check the subject code/name or create the missing subject.',
          severity: 'error',
        });

        const subKey = rawSub.toLowerCase();
        const existingSub = missingSubjectsMap.get(subKey);
        if (existingSub) {
          existingSub.rowNumbers.push(rNum);
        } else {
          missingSubjectsMap.set(subKey, { rawName: rawSub, rowNumbers: [rNum] });
        }
      }
    }

    // ── 6. Chapter Resolution ──────────────────────────────────────────────
    const rawChap = (raw.chapter ?? '').trim();
    let resolvedChapter: Chapter | null = null;
    if (!rawChap) {
      issues.push({
        row: rNum,
        column: 'Chapter',
        value: null,
        problem: 'Chapter is required.',
        suggestion: 'Enter an existing chapter name under the subject.',
        severity: 'error',
      });
    } else if (resolvedSubject) {
      const subjectChapters = chaptersBySubjectAndName.get(resolvedSubject.subjectId);
      resolvedChapter = subjectChapters?.get(rawChap.toLowerCase()) ?? null;
      if (!resolvedChapter) {
        issues.push({
          row: rNum,
          column: 'Chapter',
          value: rawChap,
          problem: `Chapter "${rawChap}" does not exist under subject "${resolvedSubject.name}".`,
          suggestion: 'Ensure the chapter is created under this subject.',
          severity: 'error',
        });

        const chapKey = `${resolvedSubject.subjectId}:::${rawChap.toLowerCase()}`;
        const existingChap = missingChaptersMap.get(chapKey);
        if (existingChap) {
          existingChap.rowNumbers.push(rNum);
        } else {
          missingChaptersMap.set(chapKey, {
            rawSubject: resolvedSubject.name,
            rawChapter: rawChap,
            resolvedSubjectId: resolvedSubject.subjectId,
            resolvedSubjectName: resolvedSubject.name,
            rowNumbers: [rNum],
          });
        }
      }
    } else if (rawSub && rawChap) {
      // Missing subject also makes chapter missing
      const chapKey = `${rawSub.toLowerCase()}:::${rawChap.toLowerCase()}`;
      const existingChap = missingChaptersMap.get(chapKey);
      if (existingChap) {
        existingChap.rowNumbers.push(rNum);
      } else {
        missingChaptersMap.set(chapKey, {
          rawSubject: rawSub,
          rawChapter: rawChap,
          resolvedSubjectId: null,
          resolvedSubjectName: null,
          rowNumbers: [rNum],
        });
      }
    }

    // ── 7. Topic Resolution (Optional, blocking if non-empty topic provided)
    const rawTopic = (raw.topic ?? '').trim();
    let resolvedTopic: Topic | null = null;
    if (rawTopic && resolvedChapter) {
      const chapterTopics = topicsByChapterAndName.get(resolvedChapter.chapterId);
      resolvedTopic = chapterTopics?.get(rawTopic.toLowerCase()) ?? null;
      if (!resolvedTopic) {
        issues.push({
          row: rNum,
          column: 'Topic',
          value: rawTopic,
          problem: `Topic "${rawTopic}" not found under chapter "${resolvedChapter.name}".`,
          suggestion: 'Create this topic or leave topic blank.',
          severity: 'error',
        });

        const topKey = `${resolvedChapter.chapterId}:::${rawTopic.toLowerCase()}`;
        const existingTop = missingTopicsMap.get(topKey);
        if (existingTop) {
          existingTop.rowNumbers.push(rNum);
        } else {
          missingTopicsMap.set(topKey, {
            rawChapter: resolvedChapter.name,
            rawTopic: rawTopic,
            resolvedChapterId: resolvedChapter.chapterId,
            resolvedChapterName: resolvedChapter.name,
            rowNumbers: [rNum],
          });
        }
      }
    } else if (rawTopic && rawChap) {
      const topKey = `${rawChap.toLowerCase()}:::${rawTopic.toLowerCase()}`;
      const existingTop = missingTopicsMap.get(topKey);
      if (existingTop) {
        existingTop.rowNumbers.push(rNum);
      } else {
        missingTopicsMap.set(topKey, {
          rawChapter: rawChap,
          rawTopic: rawTopic,
          resolvedChapterId: null,
          resolvedChapterName: null,
          rowNumbers: [rNum],
        });
      }
    }

    // ── 8. Options, Answers & Explanations ──────────────────────────────────
    const optionsPayload: QuestionOptionPayload[] = [];
    let correctNumAnswer: number | null = null;
    let numTolerance: number | null = null;
    let explanationText = (raw.explanation ?? '').trim() || null;

    if (explanationText && IMAGE_EMBED_REGEX.test(explanationText)) {
      issues.push({
        row: rNum,
        column: 'Explanation',
        value: explanationText.slice(0, 30) + '...',
        problem: 'Explanation text contains unsupported image embeds.',
        severity: 'error',
      });
    }

    const rawCorrect = (raw.correctAnswer ?? '').trim();

    if (qType === 'mcq' || qType === 'msq') {
      const optA = (raw.optionA ?? '').trim();
      const optB = (raw.optionB ?? '').trim();
      const optC = (raw.optionC ?? '').trim();
      const optD = (raw.optionD ?? '').trim();

      const rawOpts = [
        { letter: 'A', text: optA, order: 1 },
        { letter: 'B', text: optB, order: 2 },
        { letter: 'C', text: optC, order: 3 },
        { letter: 'D', text: optD, order: 4 },
      ];

      const validOpts = rawOpts.filter((o) => o.text.length > 0);
      if (validOpts.length < 2) {
        issues.push({
          row: rNum,
          column: 'Option A / Option B',
          value: null,
          problem: `${qType.toUpperCase()} questions require at least 2 non-empty options (Options A & B).`,
          severity: 'error',
        });
      }

      // Check image embeds in options
      for (const o of validOpts) {
        if (IMAGE_EMBED_REGEX.test(o.text)) {
          issues.push({
            row: rNum,
            column: `Option ${o.letter}`,
            value: o.text.slice(0, 20) + '...',
            problem: `Option ${o.letter} contains unsupported image embeds.`,
            severity: 'error',
          });
        }
      }

      const correctLetters = parseCorrectLetters(rawCorrect);
      if (correctLetters.length === 0) {
        issues.push({
          row: rNum,
          column: 'Correct Answer',
          value: rawCorrect,
          problem: `Valid correct answer is required (e.g. "A", "B", "C", or "D").`,
          severity: 'error',
        });
      } else if (qType === 'mcq' && correctLetters.length > 1) {
        issues.push({
          row: rNum,
          column: 'Correct Answer',
          value: rawCorrect,
          problem: `Single-choice MCQ must have exactly one correct option (found: ${correctLetters.join(', ')}). Use MSQ for multiple correct answers.`,
          severity: 'error',
        });
      } else {
        // Verify chosen letters match non-empty options
        const validLetters = new Set(validOpts.map((o) => o.letter));
        for (const lettr of correctLetters) {
          if (!validLetters.has(lettr)) {
            issues.push({
              row: rNum,
              column: 'Correct Answer',
              value: lettr,
              problem: `Correct answer references Option ${lettr}, but Option ${lettr} is empty.`,
              severity: 'error',
            });
          }
        }
      }

      for (const o of validOpts) {
        optionsPayload.push({
          option_text: o.text,
          is_correct: correctLetters.includes(o.letter),
          order_sequence: o.order,
        });
      }
    } else if (qType === 'true_false') {
      const cleanedAns = rawCorrect.toLowerCase();
      let isTrueCorrect: boolean | null = null;
      if (cleanedAns === 'true' || cleanedAns === 't' || cleanedAns === 'a') {
        isTrueCorrect = true;
      } else if (cleanedAns === 'false' || cleanedAns === 'f' || cleanedAns === 'b') {
        isTrueCorrect = false;
      } else {
        issues.push({
          row: rNum,
          column: 'Correct Answer',
          value: rawCorrect,
          problem: 'Correct answer for True/False must be "True", "False", "A" (True), or "B" (False).',
          severity: 'error',
        });
      }

      const optAText = (raw.optionA ?? '').trim() || 'True';
      const optBText = (raw.optionB ?? '').trim() || 'False';

      optionsPayload.push({
        option_text: optAText,
        is_correct: isTrueCorrect === true,
        order_sequence: 1,
      });
      optionsPayload.push({
        option_text: optBText,
        is_correct: isTrueCorrect === false,
        order_sequence: 2,
      });
    } else if (qType === 'numerical') {
      if (raw.numericalAnswer === null || raw.numericalAnswer === undefined || raw.numericalAnswer === '') {
        issues.push({
          row: rNum,
          column: 'Numerical Answer',
          value: null,
          problem: 'Numerical Answer is required for NUMERICAL question type.',
          severity: 'error',
        });
      } else {
        const num = Number(raw.numericalAnswer);
        if (!Number.isFinite(num)) {
          issues.push({
            row: rNum,
            column: 'Numerical Answer',
            value: raw.numericalAnswer,
            problem: `Numerical Answer "${raw.numericalAnswer}" is not a valid number.`,
            severity: 'error',
          });
        } else {
          correctNumAnswer = num;
        }
      }

      if (raw.tolerance !== null && raw.tolerance !== undefined && raw.tolerance !== '') {
        const tol = Number(raw.tolerance);
        if (!Number.isFinite(tol) || tol < 0) {
          issues.push({
            row: rNum,
            column: 'Tolerance',
            value: raw.tolerance,
            problem: 'Tolerance must be a non-negative number (>= 0).',
            severity: 'error',
          });
        } else {
          numTolerance = tol;
        }
      }
    } else if (qType === 'text_based') {
      if (!rawCorrect) {
        issues.push({
          row: rNum,
          column: 'Correct Answer',
          value: null,
          problem: 'Accepted answer is required in "Correct Answer" column for TEXT_BASED / SHORT_ANSWER questions.',
          severity: 'error',
        });
      } else if (rawCorrect.length > 250) {
        issues.push({
          row: rNum,
          column: 'Correct Answer',
          value: rawCorrect.slice(0, 30) + '...',
          problem: 'Text answer exceeds the maximum allowed length (250 characters).',
          severity: 'error',
        });
      }

      if ((raw.optionA ?? '').trim() || (raw.optionB ?? '').trim() || (raw.optionC ?? '').trim() || (raw.optionD ?? '').trim()) {
        issues.push({
          row: rNum,
          column: 'Option A',
          value: null,
          problem: 'Options A-D must be left empty for TEXT_BASED questions.',
          severity: 'warning',
        });
      }

      if (raw.numericalAnswer !== null && raw.numericalAnswer !== undefined && raw.numericalAnswer !== '') {
        issues.push({
          row: rNum,
          column: 'Numerical Answer',
          value: raw.numericalAnswer,
          problem: 'Numerical Answer must be left empty for TEXT_BASED questions.',
          severity: 'error',
        });
      }
    }

    // ── 9. Duplicate Checks ────────────────────────────────────────────────
    if (rawText) {
      const stem = normalizeStem(rawText);
      const dupeRows = inFileStems.get(stem);
      if (dupeRows && dupeRows.length > 1 && dupeRows[0] !== rNum) {
        issues.push({
          row: rNum,
          column: 'Question Text',
          value: rawText.slice(0, 30) + '...',
          problem: `Duplicate question text found within this file (matches row ${dupeRows[0]}).`,
          severity: 'warning',
        });
      }

      if (ref.existingQuestionTexts.has(stem)) {
        issues.push({
          row: rNum,
          column: 'Question Text',
          value: rawText.slice(0, 30) + '...',
          problem: 'A question with identical text already exists in your Question Bank.',
          severity: 'warning',
        });
      }
    }

    // ── 10. Finalize Row Outcome ───────────────────────────────────────────
    const hasError = issues.some((i) => i.severity === 'error');
    const hasWarning = issues.some((i) => i.severity === 'warning');

    if (hasWarning) warningCount++;

    let payloadItem: QuestionImportPayloadItem | undefined;

    if (!hasError && resolvedSubject && resolvedChapter && qType && difficulty) {
      validCount++;
      if (qType in typeCounts) {
        typeCounts[qType]++;
      }

      payloadItem = {
        subject_id: resolvedSubject.subjectId,
        chapter_id: resolvedChapter.chapterId,
        question_text: rawText,
        question_type: qType,
        difficulty: difficulty,
        marks: marks,
        negative_marks: negativeMarks,
        options: optionsPayload.length > 0 ? optionsPayload : undefined,
        explanation_text: explanationText,
        correct_numerical_answer: correctNumAnswer,
        numerical_tolerance: numTolerance,
        correct_text_answer: qType === 'text_based' ? rawCorrect || null : null,
      };

      validPayloads.push(payloadItem);
    }

    allRowIssues.push(...issues);

    let optSummary = '';
    if (optionsPayload.length > 0) {
      optSummary = optionsPayload.map((o) => `${o.is_correct ? '✓' : '•'} ${o.option_text}`).join(' | ');
    } else if (correctNumAnswer !== null) {
      optSummary = `Ans: ${correctNumAnswer}${numTolerance ? ` (±${numTolerance})` : ''}`;
    } else if (qType === 'text_based' && rawCorrect) {
      optSummary = `Ans: "${rawCorrect}"`;
    }

    previewRows.push({
      rowNumber: rNum,
      questionText: rawText,
      questionType: qType ?? 'mcq',
      difficulty: difficulty ?? 'medium',
      subjectName: resolvedSubject?.name ?? rawSub,
      chapterName: resolvedChapter?.name ?? rawChap,
      topicName: rawTopic || null,
      marks: marks,
      negativeMarks: negativeMarks,
      correctAnswer: rawCorrect,
      optionsSummary: optSummary,
      isValid: !hasError,
      issues,
      payload: payloadItem,
    });
  }

  const allIssues = [...fileIssues, ...allRowIssues];
  const hasFileErrors = fileIssues.some((i) => i.severity === 'error');

  const missingReferences = {
    subjects: Array.from(missingSubjectsMap.values()),
    chapters: Array.from(missingChaptersMap.values()),
    topics: Array.from(missingTopicsMap.values()),
  };

  return {
    ok: !hasFileErrors && validCount > 0,
    fileIssues,
    rowIssues: allRowIssues,
    rows: previewRows,
    summary: {
      totalRows: rows.length,
      validRows: validCount,
      invalidRows: rows.length - validCount,
      warningRows: warningCount,
      questionTypesCount: typeCounts,
    },
    validPayloads,
    missingReferences,
  };
}
