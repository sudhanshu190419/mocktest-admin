/**
 * Bulk Question Import Types
 *
 * Data model for Excel/CSV bulk import for text-only questions that creates
 * `questions`, `question_options`, and `question_explanations` through the
 * `public.bulk_import_questions_atomic` RPC (Migration 124).
 *
 * @module types/bulkQuestionImport
 */

import type { QuestionType, DifficultyLevel } from './mockTest';
import type { Subject, Chapter, Topic } from './academic';

// ═══════════════════════════════════════════════════════════════════════════
//  Template Constants
// ═══════════════════════════════════════════════════════════════════════════

/** Canonical template version. */
export const BULK_QUESTION_TEMPLATE_VERSION = 'BULK_QUESTION_V1';

/** Exact canonical header row of the official template. */
export const BULK_QUESTION_HEADERS = [
  'Question Text',
  'Question Type',
  'Subject',
  'Chapter',
  'Topic',
  'Difficulty',
  'Marks',
  'Negative Marks',
  'Option A',
  'Option B',
  'Option C',
  'Option D',
  'Correct Answer',
  'Numerical Answer',
  'Tolerance',
  'Explanation',
] as const;

export type BulkQuestionHeader = (typeof BULK_QUESTION_HEADERS)[number];

/** Headers that MUST be present in the uploaded file. */
export const BULK_QUESTION_REQUIRED_HEADERS = new Set<string>([
  'Question Text',
  'Question Type',
  'Subject',
  'Chapter',
  'Difficulty',
  'Marks',
  'Correct Answer',
]);

/** Maximum accepted file size in bytes (10 MB). */
export const BULK_QUESTION_MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Maximum accepted data rows. */
export const BULK_QUESTION_MAX_ROWS = 5000;

/** Allowed upload extensions. */
export const BULK_QUESTION_ALLOWED_EXTENSIONS = ['.xlsx', '.csv'] as const;

// ═══════════════════════════════════════════════════════════════════════════
//  Issue Model
// ═══════════════════════════════════════════════════════════════════════════

export type QuestionImportSeverity = 'error' | 'warning' | 'info';

export interface QuestionImportIssue {
  /** 1-based spreadsheet row (null = file-level). */
  row: number | null;
  /** Template column (null = general). */
  column: string | null;
  /** Offending value. */
  value: unknown;
  /** Problem description. */
  problem: string;
  /** Actionable suggestion. */
  suggestion?: string;
  severity: QuestionImportSeverity;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Parser & Sheet Raw Types
// ═══════════════════════════════════════════════════════════════════════════

export type SheetCellValue = string | number | boolean | null;

export interface RawQuestionSheetRow {
  /** 1-based line number in spreadsheet. */
  rowNumber: number;
  questionText: string | null;
  questionType: string | null;
  subject: string | null;
  chapter: string | null;
  topic: string | null;
  difficulty: string | null;
  marks: SheetCellValue;
  negativeMarks: SheetCellValue;
  optionA: string | null;
  optionB: string | null;
  optionC: string | null;
  optionD: string | null;
  correctAnswer: string | null;
  numericalAnswer: SheetCellValue;
  tolerance: SheetCellValue;
  explanation: string | null;
  rawCells: Record<string, SheetCellValue>;
}

// ═══════════════════════════════════════════════════════════════════════════
//  In-Memory Reference Data
// ═══════════════════════════════════════════════════════════════════════════

export interface QuestionReferenceData {
  subjects: Subject[];
  chapters: Chapter[];
  topics: Topic[];
  /** Set of normalized existing question texts to detect duplicates. */
  existingQuestionTexts: Set<string>;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Validated Row & Payload
// ═══════════════════════════════════════════════════════════════════════════

export interface QuestionOptionPayload {
  option_text: string;
  is_correct: boolean;
  order_sequence: number;
}

export interface QuestionImportPayloadItem {
  subject_id: string;
  chapter_id: string;
  question_text: string;
  question_type: QuestionType;
  difficulty: DifficultyLevel;
  marks: number;
  negative_marks: number;
  options?: QuestionOptionPayload[];
  explanation_text?: string | null;
  correct_numerical_answer?: number | null;
  numerical_tolerance?: number | null;
  correct_text_answer?: string | null;
}

export interface QuestionImportPreviewRow {
  rowNumber: number;
  questionText: string;
  questionType: QuestionType;
  difficulty: DifficultyLevel;
  subjectName: string;
  chapterName: string;
  topicName?: string | null;
  marks: number;
  negativeMarks: number;
  correctAnswer: string;
  optionsSummary?: string;
  isValid: boolean;
  issues: QuestionImportIssue[];
  payload?: QuestionImportPayloadItem;
}

export interface QuestionImportSummary {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  warningRows: number;
  questionTypesCount: Record<string, number>;
}

export interface MissingSubjectRef {
  rawName: string;
  rowNumbers: number[];
}

export interface MissingChapterRef {
  rawSubject: string;
  rawChapter: string;
  resolvedSubjectId: string | null;
  resolvedSubjectName: string | null;
  rowNumbers: number[];
}

export interface MissingTopicRef {
  rawChapter: string;
  rawTopic: string;
  resolvedChapterId: string | null;
  resolvedChapterName: string | null;
  rowNumbers: number[];
}

export interface MissingAcademicReferences {
  subjects: MissingSubjectRef[];
  chapters: MissingChapterRef[];
  topics: MissingTopicRef[];
}

export interface QuestionImportPreview {
  ok: boolean;
  fileIssues: QuestionImportIssue[];
  rowIssues: QuestionImportIssue[];
  rows: QuestionImportPreviewRow[];
  summary: QuestionImportSummary;
  /** Validated payloads ready for atomic submission. */
  validPayloads: QuestionImportPayloadItem[];
  /** Detected missing academic entities for dynamic resolution. */
  missingReferences: MissingAcademicReferences;
}

export interface BulkQuestionImportRpcResult {
  success: boolean;
  imported_count?: number;
  question_ids?: string[];
  error?: string;
}
