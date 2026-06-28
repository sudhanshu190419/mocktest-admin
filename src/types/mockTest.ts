/**
 * Mock Test Engine Types
 *
 * Production-ready type definitions for the Assessment module — question
 * bank, test configuration, attempt engine, and result computation.
 *
 * These types mirror the PostgreSQL schema exactly (Domain 05 — Assessment
 * in the database schema specification), mapping snake_case database
 * columns to camelCase TypeScript properties.
 *
 * Dependencies:
 * - Consumed by mock test service layer, React Query hooks, and UI screens.
 * - Reuses shared types from src/types/academic.ts (ApiResponse,
 *   PaginatedResponse, PaginationParams, SortDirection).
 * - Compatible with Supabase JS client.
 *
 * @module types/mockTest
 */

import type {
  ApiResponse,
  PaginatedResponse,
  PaginationParams,
  SortDirection,
} from './academic';

// ─── Re-exports for consumer convenience ────────────────────────────────────
// Consumers import { MockTest, ApiResponse, PaginatedResponse, ... }
// from './mockTest' — no need to know the source.

export type { ApiResponse, PaginatedResponse, PaginationParams, SortDirection };

// ═══════════════════════════════════════════════════════════════════════════
//  Enums
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Discriminator for the type of question.
 *
 * Mirrors the `question_type` PostgreSQL enum.
 *
 * - `mcq`:        Single correct answer.
 * - `msq`:        Multiple correct answers.
 * - `numerical`:  Free-form numeric value (stored in question_explanations).
 * - `true_false`: Binary true/false choice.
 *
 * @see public.questions.question_type column
 */
export type QuestionType = 'mcq' | 'msq' | 'numerical' | 'true_false';

/**
 * Question difficulty level.
 *
 * Mirrors the `difficulty_level` PostgreSQL enum.
 *
 * - `easy`:   Basic recall / foundational questions.
 * - `medium`: Application-level questions (typical exam standard).
 * - `hard`:   Complex multi-step reasoning questions.
 *
 * @see public.questions.difficulty column
 */
export type DifficultyLevel = 'easy' | 'medium' | 'hard';

/**
 * Lifecycle status of a question in the question bank.
 *
 * Mirrors the `question_status` PostgreSQL enum.
 *
 * - `draft`:            Question created but not submitted for review.
 * - `pending_approval`: Question submitted, awaiting admin approval.
 * - `published`:        Question approved and available for use in tests.
 * - `archived`:         Question retired; excluded from test composition.
 *
 * Valid transitions:
 *   draft → pending_approval (teacher submits)
 *   pending_approval → published (admin approves)
 *   pending_approval → draft (admin rejects)
 *   published → archived (teacher/admin retires)
 *   draft → archived (teacher discards)
 *
 * @see public.questions.status column
 */
export type QuestionStatus = 'draft' | 'pending_approval' | 'published' | 'archived';

/**
 * Lifecycle status of a mock test.
 *
 * Mirrors the `mock_test_status` PostgreSQL enum.
 * Shares the same values as `QuestionStatus` but is a separate type for
 * clarity and future divergence.
 *
 * - `draft`:            Test created but not ready for students.
 * - `pending_approval`: Test submitted for admin review.
 * - `published`:        Test frozen and available for student attempts.
 * - `archived`:         Test retired; excluded from student view.
 *
 * @see public.mock_tests.status column
 */
export type MockTestStatus = 'draft' | 'pending_approval' | 'published' | 'archived';

/**
 * Status of a student's attempt at a mock test.
 *
 * Mirrors the `attempt_status` PostgreSQL enum.
 *
 * - `in_progress`: Student is actively taking the test.
 * - `submitted`:   Student explicitly submitted their answers.
 * - `timed_out`:   Timer expired; answers auto-submitted.
 * - `abandoned`:   Student closed without submitting; detected by timeout
 *                  background job after a grace period.
 *
 * @see public.mock_attempts.status column
 */
export type AttemptStatus = 'in_progress' | 'submitted' | 'timed_out' | 'abandoned';

// ═══════════════════════════════════════════════════════════════════════════
//  Snapshot & Breakdown Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Frozen option snapshot within a question snapshot.
 *
 * Contains the option data as it existed at test publish time.
 *
 * @see QuestionSnapshot.options
 */
export interface QuestionSnapshotOption {
  /** FK → question_options.option_id at snapshot time. */
  optionId: string;
  /** Option text in plain text or Markdown. */
  optionText: string;
  /** TRUE if this is a correct answer. */
  isCorrect: boolean;
  /** 1-indexed display order within the question. */
  orderSequence: number;
}

/**
 * Frozen copy of a question at test publish time.
 *
 * Serialised into `mock_test_questions.question_snapshot` by the publish
 * Edge Function. The test engine reads from this snapshot rather than the
 * live `questions` table, ensuring immutability for in-progress and future
 * attempts even if the underlying question is edited post-publish.
 *
 * Does NOT include explanation — that is served post-submission from
 * `question_explanations`.
 */
export interface QuestionSnapshot {
  /** Schema version for future migration support. Start at 1. */
  snapshotVersion: number;
  /** FK → questions.question_id at snapshot time. */
  questionId: string;
  /** The question stem in plain text or Markdown. */
  questionText: string;
  /** Question type discriminator. */
  questionType: QuestionType;
  /** Marks awarded for a correct answer. */
  marks: number;
  /** Negative marks deducted for a wrong answer. 0 means no negative marking. */
  negativeMarks: number;
  /** Frozen answer options (empty for numerical type). */
  options: QuestionSnapshotOption[];
  /** Correct answer value for numerical type questions. NULL for non-numerical. */
  correctNumericalAnswer: number | null;
  /** Acceptable margin of error for numerical answers. NULL = exact match. */
  numericalTolerance: number | null;
}

/**
 * Per-subject score breakdown within a result.
 *
 * Structure of each element in `MockResult.subjectBreakdown`.
 */
export interface SubjectBreakdownItem {
  /** FK → subjects.subject_id. */
  subjectId: string;
  /** Subject display name at result generation time. */
  subjectName: string;
  /** Number of correct answers. */
  correct: number;
  /** Number of incorrect answers (answered but wrong). */
  wrong: number;
  /** Number of skipped questions. */
  skipped: number;
  /** Aggregate score for this subject. */
  score: number;
  /** Maximum possible score for this subject. */
  maxScore: number;
}

/**
 * Per-chapter score breakdown within a result.
 *
 * Structure of each element in `MockResult.chapterBreakdown`.
 */
export interface ChapterBreakdownItem {
  /** FK → chapters.chapter_id. */
  chapterId: string;
  /** Chapter display name at result generation time. */
  chapterName: string;
  /** Number of correct answers. */
  correct: number;
  /** Number of incorrect answers (answered but wrong). */
  wrong: number;
  /** Number of skipped questions. */
  skipped: number;
  /** Aggregate score for this chapter. */
  score: number;
  /** Maximum possible score for this chapter. */
  maxScore: number;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Question
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Central content unit of the assessment system.
 *
 * Represents a single assessable item: a stem, type, difficulty, chapter
 * mapping, and lifecycle state. Questions are authored by teachers,
 * reviewed by admins, and shared across Mock Tests and PYQ papers.
 *
 * A question may appear in hundreds of tests; mutating or deleting it
 * after use is forbidden. Use `status = 'archived'` to retire.
 *
 * Versioning model: editing a `published` question creates a NEW row with
 * `version = old + 1` and `parentQuestionId = old questionId`. The old row
 * stays `published` for historical attempts.
 *
 * Mirrors the `questions` table in PostgreSQL.
 *
 * @see supabase/migrations/005_domain_05_assessment.sql
 */
export interface Question {
  /** Primary key. */
  questionId: string;
  /** Institute that owns this question (FK → public.institutes). Denormalized for RLS. */
  instituteId: string;
  /** Subject this question belongs to (FK → public.subjects). Drives analytics. */
  subjectId: string;
  /** Chapter this question belongs to (FK → public.chapters). Required. */
  chapterId: string;
  /** Teacher who authored this question version (FK → public.teacher_details). */
  createdBy: string;
  /** Admin who approved this question (FK → public.profiles). NULL until approved. */
  approvedBy: string | null;
  /**
   * Self-referencing FK → public.questions. NULL for original questions.
   * Set to the previous question's `questionId` when a new version is created.
   */
  parentQuestionId: string | null;
  /** Question type discriminator. Determines option rendering and scoring logic. */
  questionType: QuestionType;
  /** Difficulty level for test composition analytics and adaptive filtering. */
  difficulty: DifficultyLevel;
  /**
   * Lifecycle status. Only `published` questions may be added to a mock test.
   * Default: `'draft'`.
   */
  status: QuestionStatus;
  /**
   * Monotonically increasing integer. Starts at 1. Incremented each time the
   * stem, options, or explanation is substantively edited.
   */
  version: number;
  /** The question stem in plain text or Markdown. Minimum 10 characters. */
  questionText: string;
  /**
   * Default marks when added to a test. May be overridden per-test in
   * `mock_test_questions.marks`. Default: 1.
   */
  marks: number;
  /**
   * Default negative marks for a wrong answer. May be overridden per-test.
   * 0 means no negative marking.
   */
  negativeMarks: number;
  /**
   * Computed from `mock_answers.time_spent_seconds` across all attempts.
   * Updated by a nightly analytics job. NULL until sufficient data exists.
   */
  averageTimeSeconds: number | null;
  /**
   * Denormalized count of how many times this question has been answered in
   * a submitted attempt. Updated by the result-generation job.
   */
  timesAttempted: number;
  /** UTC timestamp of row creation. */
  createdAt: string;
  /** UTC timestamp of last modification. Trigger-maintained. */
  updatedAt: string;
  /**
   * UTC timestamp when the question was approved. NULL unless `status = 'published'`.
   * Set atomically with `approvedBy`.
   */
  approvedAt: string | null;
}

/**
 * Input required to create a new question.
 *
 * All required fields correspond to NOT NULL columns in the `questions` table.
 * Server-set fields (questionId, version, timesAttempted, averageTimeSeconds,
 * status, createdAt, updatedAt, approvedAt) are excluded — they have DB defaults
 * or are set by the server.
 */
export interface CreateQuestionInput {
  /** Institute that owns this question. */
  instituteId: string;
  /** Subject this question belongs to. */
  subjectId: string;
  /** Chapter this question belongs to. */
  chapterId: string;
  /** Teacher authoring this question. */
  createdBy: string;
  /**
   * For versioned edits: the question this revision supersedes.
   * NULL for the original question.
   */
  parentQuestionId?: string | null;
  /** Question type discriminator. Immutable after creation. */
  questionType: QuestionType;
  /** Difficulty level. */
  difficulty: DifficultyLevel;
  /** Defaults to `'draft'` when not provided. */
  status?: QuestionStatus;
  /** The question stem. Minimum 10 characters. */
  questionText: string;
  /** Defaults to `1` when not provided. */
  marks?: number;
  /** Defaults to `0` when not provided. */
  negativeMarks?: number;
}

/**
 * Input required to update an existing question.
 *
 * All fields are optional — only provided fields are included in the UPDATE.
 * Certain fields are immutable after creation (questionType).
 * Published questions with `timesAttempted > 0` block changes to
 * questionText, questionType, marks, and negativeMarks (enforced by
 * database trigger).
 */
export interface UpdateQuestionInput {
  subjectId?: string;
  chapterId?: string;
  /** Only mutable when status is `draft` or `pending_approval`. */
  parentQuestionId?: string | null;
  difficulty?: DifficultyLevel;
  /** Only mutable when status is `draft` or `pending_approval`. */
  status?: QuestionStatus;
  /** Only mutable when status is `draft` or `pending_approval`. */
  questionText?: string;
  /** Only mutable when status is `draft` or `pending_approval`. */
  marks?: number;
  /** Only mutable when status is `draft` or `pending_approval`. */
  negativeMarks?: number;
}

/**
 * Filters available when querying the questions list.
 */
export interface QuestionFilters {
  instituteId?: string;
  subjectId?: string;
  chapterId?: string;
  createdBy?: string;
  questionType?: QuestionType;
  difficulty?: DifficultyLevel;
  status?: QuestionStatus;
  /** Set to `true` to find questions that are the original (no parent). */
  isOriginal?: boolean;
  /** When `true`, filter for questions that have a parent (i.e. are a newer version). */
  hasParent?: boolean;
  /** Searches across questionText (case-insensitive LIKE). */
  search?: string;
  /** Filter by specific question IDs. */
  ids?: string[];
  /** Filter for questions with `timesAttempted` greater than this value. */
  minTimesAttempted?: number;
}

/**
 * Sort options for questions list queries.
 */
export interface QuestionSortOptions {
  sortBy?:
    | 'questionType'
    | 'difficulty'
    | 'status'
    | 'version'
    | 'marks'
    | 'timesAttempted'
    | 'createdAt'
    | 'updatedAt'
    | 'approvedAt';
  sortDirection?: SortDirection;
}

// ═══════════════════════════════════════════════════════════════════════════
//  QuestionOption
// ═══════════════════════════════════════════════════════════════════════════

/**
 * An answer choice for MCQ, MSQ, or True/False questions.
 *
 * Each row is one selectable option. For `numerical` questions this table
 * has no rows — the answer is stored in `question_explanations`.
 *
 * Option rows for a `published` question are immutable. Corrections require
 * creating a new question version.
 *
 * Mirrors the `question_options` table in PostgreSQL.
 */
export interface QuestionOption {
  /** Primary key. */
  optionId: string;
  /** Parent question (FK → public.questions). */
  questionId: string;
  /** Institute that owns this option (FK → public.institutes). Denormalized for RLS. */
  instituteId: string;
  /** The option content in plain text or Markdown. */
  optionText: string;
  /**
   * TRUE if this is a correct answer.
   * - MCQ:  exactly one option should have `isCorrect = TRUE`.
   * - MSQ:  one or more options have `isCorrect = TRUE`.
   * - True/False: exactly one of the two options is TRUE.
   */
  isCorrect: boolean;
  /**
   * 1-indexed display order within the question. Canonical authoring order.
   * When `mock_tests.shuffleOptions = TRUE`, the test engine randomizes
   * order at render time using a seeded randomizer.
   */
  orderSequence: number;
  /** UTC timestamp of row creation. */
  createdAt: string;
}

/**
 * Input required to create a new question option.
 */
export interface CreateQuestionOptionInput {
  /** Parent question ID. */
  questionId: string;
  /** Institute that owns this option. */
  instituteId: string;
  /** Option content in plain text or Markdown. */
  optionText: string;
  /** TRUE if this is a correct answer. */
  isCorrect?: boolean;
  /** 1-indexed display order. */
  orderSequence: number;
}

/**
 * Input required to update an existing question option.
 *
 * Options for `published` questions are immutable — changes require a new
 * question version.
 */
export interface UpdateQuestionOptionInput {
  optionText?: string;
  isCorrect?: boolean;
  orderSequence?: number;
}

/**
 * Filters available when querying question options.
 */
export interface QuestionOptionFilters {
  questionId?: string;
  isCorrect?: boolean;
  /** Filter by specific option IDs. */
  ids?: string[];
}

/**
 * Sort options for question options list queries.
 */
export interface QuestionOptionSortOptions {
  sortBy?: 'orderSequence' | 'createdAt';
  sortDirection?: SortDirection;
}

// ═══════════════════════════════════════════════════════════════════════════
//  QuestionExplanation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Solution walkthrough for a question. 1:1 relationship with questions.
 *
 * The explanation is intentionally separate from `questions` to keep the
 * question stem table lean and to allow the explanation to be fetched only
 * after submission (never during an active attempt, which would be cheating).
 *
 * For `numerical` questions, `correctNumericalAnswer` and `numericalTolerance`
 * define the accepted answer and acceptable margin of error.
 *
 * Mirrors the `question_explanations` table in PostgreSQL.
 */
export interface QuestionExplanation {
  /** Primary key. */
  explanationId: string;
  /** Parent question (FK → public.questions). Enforced 1:1 via UNIQUE constraint. */
  questionId: string;
  /** Institute that owns this explanation (FK → public.institutes). Denormalized for RLS. */
  instituteId: string;
  /**
   * Step-by-step solution in plain text or Markdown with LaTeX support.
   * NULL if the explanation has not been written yet (allowed for draft
   * questions; required before a question can be published).
   */
  explanationText: string | null;
  /**
   * Optional URL to a video solution walkthrough. May be a Supabase Storage
   * path (signed URL generated dynamically) or an external video link.
   */
  explanationVideoUrl: string | null;
  /**
   * The correct answer value for `numerical` type questions.
   * NULL for MCQ, MSQ, and True/False.
   */
  correctNumericalAnswer: number | null;
  /**
   * Acceptable margin of error for `numerical` questions.
   * A student answer is correct if `ABS(answer - correctNumericalAnswer) <= numericalTolerance`.
   * NULL means exact match required.
   */
  numericalTolerance: number | null;
  /** UTC timestamp of row creation. */
  createdAt: string;
  /** UTC timestamp of last modification. Trigger-maintained. */
  updatedAt: string;
}

/**
 * Input required to create a question explanation.
 *
 * A question may have at most one explanation row (enforced by UNIQUE
 * constraint on `questionId`).
 */
export interface CreateQuestionExplanationInput {
  /** Parent question ID. */
  questionId: string;
  /** Institute that owns this explanation. */
  instituteId: string;
  /** Step-by-step solution text. Required before publication. */
  explanationText?: string | null;
  /** Optional video solution URL. */
  explanationVideoUrl?: string | null;
  /** Correct answer for numerical questions. */
  correctNumericalAnswer?: number | null;
  /** Numerical tolerance for approximate matching. NULL = exact match. */
  numericalTolerance?: number | null;
}

/**
 * Input required to update a question explanation.
 *
 * Explanations for `published` questions are immutable — changes require a
 * new question version.
 */
export interface UpdateQuestionExplanationInput {
  explanationText?: string | null;
  explanationVideoUrl?: string | null;
  correctNumericalAnswer?: number | null;
  numericalTolerance?: number | null;
}

/**
 * Filters available when querying question explanations.
 */
export interface QuestionExplanationFilters {
  questionId?: string;
  /** Filter: has a non-null explanationText. */
  hasText?: boolean;
  /** Filter: has a non-null explanationVideoUrl. */
  hasVideo?: boolean;
}

/**
 * Sort options for question explanations list queries.
 */
export interface QuestionExplanationSortOptions {
  sortBy?: 'createdAt' | 'updatedAt';
  sortDirection?: SortDirection;
}

// ═══════════════════════════════════════════════════════════════════════════
//  QuestionImage
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Images associated with a question — diagrams, figures, graphs.
 *
 * 1:M relationship with questions. `imageRole` distinguishes whether the
 * image belongs in the stem, a specific option, or the explanation.
 *
 * Images are stored in Supabase Storage; this table stores metadata and
 * the storage path. Signed URLs are generated dynamically at serve time.
 *
 * Mirrors the `question_images` table in PostgreSQL.
 */
export interface QuestionImage {
  /** Primary key. */
  imageId: string;
  /** Parent question (FK → public.questions). */
  questionId: string;
  /** Institute that owns this image (FK → public.institutes). Denormalized for RLS. */
  instituteId: string;
  /** Supabase Storage bucket name. */
  storageBucket: string;
  /** Object path within `storageBucket`. Signed URL generated dynamically. */
  storagePath: string;
  /**
   * Describes where this image is used:
   * - `stem`:      Embedded in question text.
   * - `option_a`–`option_d`: Embedded in a specific option.
   * - `explanation`: Used in the solution walkthrough.
   */
  imageRole: string;
  /**
   * Accessibility description of the image. Required for WCAG 2.1 Level AA
   * compliance. Recommended to populate before publication.
   */
  altText: string | null;
  /**
   * Display order for questions with multiple stem images. 1-indexed.
   * Default: 1.
   */
  orderSequence: number;
  /** UTC timestamp of row creation. */
  createdAt: string;
}

/**
 * Input required to create a question image.
 */
export interface CreateQuestionImageInput {
  /** Parent question ID. */
  questionId: string;
  /** Institute that owns this image. */
  instituteId: string;
  /** Supabase Storage bucket name. */
  storageBucket: string;
  /** Object path within the bucket. */
  storagePath: string;
  /** Where this image is used (`stem`, `option_a`, etc.). */
  imageRole: string;
  /** Accessibility description. */
  altText?: string | null;
  /** Defaults to `1` when not provided. */
  orderSequence?: number;
}

/**
 * Input required to update a question image.
 */
export interface UpdateQuestionImageInput {
  storageBucket?: string;
  storagePath?: string;
  imageRole?: string;
  altText?: string | null;
  orderSequence?: number;
}

/**
 * Filters available when querying question images.
 */
export interface QuestionImageFilters {
  questionId?: string;
  imageRole?: string;
  /** Filter by specific image IDs. */
  ids?: string[];
}

/**
 * Sort options for question images list queries.
 */
export interface QuestionImageSortOptions {
  sortBy?: 'orderSequence' | 'createdAt';
  sortDirection?: SortDirection;
}

// ═══════════════════════════════════════════════════════════════════════════
//  MockTest
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A configured test that students can attempt.
 *
 * A `mock_test` is the product: a title, time limit, scoring configuration,
 * lifecycle state, and a set of questions assembled via `mock_test_questions`.
 * Supports chapter tests, full syllabus mocks, sectional tests, and PYQ-mapped
 * practice papers.
 *
 * Once published, the test configuration and question list are frozen via
 * `mock_test_questions.questionSnapshot`. Students will always see the same
 * questions and scoring rules, even if the underlying question bank changes.
 *
 * Mirrors the `mock_tests` table in PostgreSQL.
 */
export interface MockTest {
  /** Primary key. */
  testId: string;
  /** Institute that owns this test (FK → public.institutes). Denormalized for RLS. */
  instituteId: string;
  /** Teacher who authored and owns this test (FK → public.teacher_details). */
  teacherId: string;
  /** Exam stream this test is designed for (FK → public.streams). */
  streamId: string;
  /**
   * Subject this test covers. NULL for full-syllabus or multi-subject tests.
   * Set for single-subject chapter tests (FK → public.subjects).
   */
  subjectId: string | null;
  /** Display title shown to students. Minimum 3 characters. */
  title: string;
  /** Optional instructions shown on the test overview screen. */
  description: string | null;
  /** Total test duration in minutes. Range: 1–600. */
  durationMin: number;
  /**
   * Sum of all question marks. Computed and frozen at publish time.
   * Stored for fast display without aggregating the junction table.
   */
  totalMarks: number;
  /** Minimum score to pass. NULL if no pass/fail threshold applies. */
  passingMarks: number | null;
  /**
   * Default negative marks per wrong answer. Applied to questions that do
   * not have a per-question override in `mock_test_questions.negativeMarksOverride`.
   * 0 means no negative marking. Default: 0.
   */
  negativeMarking: number;
  /**
   * Maximum number of times a student may attempt this test.
   * NULL means unlimited.
   */
  attemptLimit: number | null;
  /**
   * When TRUE, questions are presented in a randomised order per attempt.
   * Order is seeded by `attemptId` for consistency on resume.
   * Default: FALSE.
   */
  shuffleQuestions: boolean;
  /**
   * When TRUE, MCQ/MSQ options are randomised per attempt.
   * Seeded by `attemptId + questionId` for consistent resume.
   * Default: FALSE.
   */
  shuffleOptions: boolean;
  /**
   * When TRUE, the test UI shows an on-screen scientific calculator.
   * Default: FALSE.
   */
  calculatorAllowed: boolean;
  /** Lifecycle status. Only `published` tests are visible to students. */
  status: MockTestStatus;
  /**
   * Categorises the test.
   * Values: `practice` (no ranking, instant result), `mock` (ranked, result
   * after window closes), `chapter_test`, `pyq_paper`.
   */
  testType: string;
  /**
   * Controls when the result is shown to the student.
   * Values: `immediate` (on submission), `scheduled` (at `resultReleaseAt`),
   * `manual` (admin releases).
   */
  resultReleaseMode: string;
  /**
   * UTC timestamp for scheduled result release.
   * NULL unless `resultReleaseMode = 'scheduled'`.
   */
  resultReleaseAt: string | null;
  /**
   * UTC timestamp from which students can start the test.
   * NULL means immediately available upon publication.
   */
  availableFrom: string | null;
  /**
   * UTC timestamp after which new attempts are blocked.
   * NULL means no expiry.
   */
  availableUntil: string | null;
  /** UTC timestamp of row creation. */
  createdAt: string;
  /** UTC timestamp of last modification. Trigger-maintained. */
  updatedAt: string;
  /** UTC timestamp when the test was published. NULL until published. */
  publishedAt: string | null;
}

/**
 * Input required to create a new mock test.
 */
export interface CreateMockTestInput {
  /** Institute that owns this test. */
  instituteId: string;
  /** Teacher creating this test. */
  teacherId: string;
  /** Exam stream this test is designed for. */
  streamId: string;
  /** Subject for single-subject tests. NULL for full-syllabus. */
  subjectId?: string | null;
  /** Display title. Minimum 3 characters. */
  title: string;
  /** Optional instructions. */
  description?: string | null;
  /** Total duration in minutes. Range: 1–600. */
  durationMin: number;
  /** Minimum score to pass. NULL = no threshold. */
  passingMarks?: number | null;
  /** Defaults to `0` when not provided. */
  negativeMarking?: number;
  /** NULL means unlimited attempts. */
  attemptLimit?: number | null;
  /** Defaults to `false` when not provided. */
  shuffleQuestions?: boolean;
  /** Defaults to `false` when not provided. */
  shuffleOptions?: boolean;
  /** Defaults to `false` when not provided. */
  calculatorAllowed?: boolean;
  /** Defaults to `'draft'` when not provided. */
  status?: MockTestStatus;
  /** Defaults to `'practice'` when not provided. */
  testType?: string;
  /** Defaults to `'immediate'` when not provided. */
  resultReleaseMode?: string;
  /** Required if `resultReleaseMode = 'scheduled'`. */
  resultReleaseAt?: string | null;
  /** UTC timestamp for test availability start. */
  availableFrom?: string | null;
  /** UTC timestamp for test availability end. */
  availableUntil?: string | null;
}

/**
 * Input required to update an existing mock test.
 *
 * Published and archived tests are immutable via teacher action. Only
 * status transitions to `archived` are permitted after publish.
 */
export interface UpdateMockTestInput {
  title?: string;
  description?: string | null;
  durationMin?: number;
  passingMarks?: number | null;
  negativeMarking?: number;
  attemptLimit?: number | null;
  shuffleQuestions?: boolean;
  shuffleOptions?: boolean;
  calculatorAllowed?: boolean;
  /** Only valid transitions: draft/pending_approval → published, any → archived. */
  status?: MockTestStatus;
  testType?: string;
  resultReleaseMode?: string;
  resultReleaseAt?: string | null;
  availableFrom?: string | null;
  availableUntil?: string | null;
}

/**
 * Filters available when querying the mock tests list.
 */
export interface MockTestFilters {
  instituteId?: string;
  teacherId?: string;
  streamId?: string;
  subjectId?: string;
  status?: MockTestStatus;
  testType?: string;
  /** Filter tests that are currently available (NOW() BETWEEN availableFrom AND availableUntil). */
  isAvailable?: boolean;
  /** Filter tests with result release mode. */
  resultReleaseMode?: string;
  /** Searches across title and description (case-insensitive LIKE). */
  search?: string;
  /** Filter by specific test IDs. */
  ids?: string[];
}

/**
 * Sort options for mock tests list queries.
 */
export interface MockTestSortOptions {
  sortBy?:
    | 'title'
    | 'durationMin'
    | 'totalMarks'
    | 'status'
    | 'testType'
    | 'createdAt'
    | 'updatedAt'
    | 'publishedAt'
    | 'availableFrom'
    | 'availableUntil';
  sortDirection?: SortDirection;
}

// ═══════════════════════════════════════════════════════════════════════════
//  MockTestQuestion (Junction)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Junction table linking a mock test to a question.
 *
 * Each row represents one question's inclusion in one test, carrying the
 * per-test scoring configuration and the frozen `questionSnapshot` at
 * publish time.
 *
 * The `questionSnapshot` JSONB is the immutability mechanism for the test
 * engine. During an attempt, the engine reads from the snapshot, not from
 * the live `questions` table.
 *
 * Once `mock_tests.status = 'published'`, all rows in this table are
 * immutable (INSERT, UPDATE, DELETE blocked by database trigger).
 *
 * Mirrors the `mock_test_questions` table in PostgreSQL.
 */
export interface MockTestQuestion {
  /** Parent test (FK → public.mock_tests). Part of composite PK. */
  testId: string;
  /** Parent question (FK → public.questions). Part of composite PK. */
  questionId: string;
  /**
   * 1-indexed display order within the test. Canonical order when
   * `shuffleQuestions = FALSE`.
   */
  orderSequence: number;
  /**
   * Marks awarded for a correct answer in this test.
   * May differ from `questions.marks` (the default).
   */
  marks: number;
  /**
   * Per-question negative marks override. When NULL, the test-level
   * `mock_tests.negativeMarking` applies. When set, this value takes
   * precedence for this question in this test.
   */
  negativeMarksOverride: number | null;
  /**
   * Optional section grouping for multi-section tests (e.g., NEET has
   * Physics, Chemistry, Biology sections). NULL for single-section tests.
   */
  sectionName: string | null;
  /**
   * Frozen copy of the question at publish time. Populated by the publish
   * Edge Function. NULL for draft tests (before publish).
   */
  questionSnapshot: QuestionSnapshot | null;
  /** UTC timestamp when this question was added to the test. */
  addedAt: string;
}

/**
 * Input required to add a question to a mock test.
 */
export interface CreateMockTestQuestionInput {
  /** Parent test ID. */
  testId: string;
  /** Question to add. */
  questionId: string;
  /** 1-indexed display order within the test. */
  orderSequence: number;
  /**
   * Marks for this question in this test. Defaults to the question's
   * `marks` value in the service layer.
   */
  marks: number;
  /**
   * Per-question negative marks override. NULL = use test-level default.
   */
  negativeMarksOverride?: number | null;
  /**
   * Optional section name for multi-section tests.
   */
  sectionName?: string | null;
}

/**
 * Input required to update a mock test question row.
 *
 * Once the parent test is `published`, these rows are immutable.
 */
export interface UpdateMockTestQuestionInput {
  orderSequence?: number;
  marks?: number;
  negativeMarksOverride?: number | null;
  sectionName?: string | null;
}

/**
 * Filters available when querying mock test questions.
 */
export interface MockTestQuestionFilters {
  testId?: string;
  questionId?: string;
  sectionName?: string;
  /** Filter by specific question IDs. */
  questionIds?: string[];
  /** Filter questions that have a snapshot (published tests). */
  hasSnapshot?: boolean;
}

/**
 * Sort options for mock test questions list queries.
 */
export interface MockTestQuestionSortOptions {
  sortBy?: 'orderSequence' | 'marks' | 'addedAt';
  sortDirection?: SortDirection;
}

// ═══════════════════════════════════════════════════════════════════════════
//  MockAttempt
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A student's single attempt at a mock test.
 *
 * A student who takes the same test twice has two `mockAttempt` rows.
 * Each attempt has its own timer, its own answer set, and its own result.
 *
 * This is a high-write table. The table is range-partitioned by `startedAt`
 * (monthly partitions) to handle scale.
 *
 * Mirrors the `mock_attempts` table in PostgreSQL.
 */
export interface MockAttempt {
  /** PK. Partitioned by `startedAt`. */
  attemptId: string;
  /** The test being attempted (FK → public.mock_tests). */
  testId: string;
  /** The student taking the attempt (FK → public.student_details). */
  studentId: string;
  /** Institute of the student (FK → public.institutes). Denormalized for RLS. */
  instituteId: string;
  /**
   * 1-indexed attempt counter per student per test.
   * `1` for the first attempt, `2` for the second, etc.
   */
  attemptNumber: number;
  /** Current status of the attempt. */
  status: AttemptStatus;
  /** UTC timestamp when the attempt was created (student clicked "Start Test"). */
  startedAt: string;
  /**
   * UTC timestamp when the attempt was finalised.
   * Set for `submitted` and `timed_out` statuses. NULL while in progress.
   */
  submittedAt: string | null;
  /**
   * Seconds remaining on the timer at the last sync.
   * Updated periodically by the client heartbeat. Used to resume the timer
   * correctly if the student's browser crashes. NULL after submission.
   */
  timeRemainingSeconds: number | null;
  /**
   * Client IP address at attempt start. Used for exam integrity monitoring
   * (same IP across accounts) and geo-analytics. PII — handle with care.
   */
  ipAddress: string | null;
  /**
   * Hashed device fingerprint at attempt start. Used for exam integrity
   * monitoring. Hashed at the Edge Function layer — always store hashed,
   * never raw fingerprint data.
   */
  deviceFingerprint: string | null;
  /** UTC timestamp of row creation. */
  createdAt: string;
  /** UTC timestamp of last modification. Trigger-maintained. Updated on auto-save. */
  updatedAt: string;
}

/**
 * Input required to create a new attempt.
 *
 * Attempt creation is atomic: must increment `attemptNumber`, write the
 * `mock_attempts` row, AND pre-populate `mock_answers` rows (one per
 * question, all `isAnswered = FALSE`) in a single transaction.
 */
export interface CreateMockAttemptInput {
  /** The test being attempted. */
  testId: string;
  /** The student taking the attempt. */
  studentId: string;
  /** Institute of the student. */
  instituteId: string;
  /** Client IP address at attempt start. */
  ipAddress?: string | null;
  /** Hashed device fingerprint. */
  deviceFingerprint?: string | null;
}

/**
 * Input required to update a mock attempt.
 *
 * Students may only update `timeRemainingSeconds` on their own in-progress
 * attempts. Status transitions are performed by Edge Functions only.
 */
export interface UpdateMockAttemptInput {
  /** Only updatable by the client heartbeat. */
  timeRemainingSeconds?: number | null;
  /** Status transitions performed by Edge Functions. */
  status?: AttemptStatus;
  /** Set by the submission/auto-timeout Edge Function. */
  submittedAt?: string | null;
}

/**
 * Filters available when querying mock attempts.
 */
export interface MockAttemptFilters {
  testId?: string;
  studentId?: string;
  status?: AttemptStatus;
  instituteId?: string;
  /** Only attempts started after this timestamp (inclusive). */
  startedAfter?: string;
  /** Only attempts started before this timestamp (inclusive). */
  startedBefore?: string;
  /** Filter by specific attempt IDs. */
  ids?: string[];
}

/**
 * Sort options for mock attempts list queries.
 */
export interface MockAttemptSortOptions {
  sortBy?:
    | 'attemptNumber'
    | 'status'
    | 'startedAt'
    | 'submittedAt'
    | 'createdAt'
    | 'updatedAt';
  sortDirection?: SortDirection;
}

// ═══════════════════════════════════════════════════════════════════════════
//  MockAnswer
// ═══════════════════════════════════════════════════════════════════════════

/**
 * One answer record per question per attempt.
 *
 * Every question in the test gets a `mockAnswer` row when the attempt is
 * created (pre-populated with `isAnswered = FALSE`). As the student selects
 * options, the row is updated in place.
 *
 * This is the highest-write table in the domain. Every option selection,
 * every review flag toggle, and every auto-save hits this table.
 *
 * Mirrors the `mock_answers` table in PostgreSQL.
 */
export interface MockAnswer {
  /** Primary key. */
  answerId: string;
  /** Parent attempt (FK → public.mock_attempts). */
  attemptId: string;
  /** Question being answered (FK → public.questions). Denormalized from mock_test_questions. */
  questionId: string;
  /** Institute (FK → public.institutes). Denormalized for RLS. */
  instituteId: string;
  /**
   * TRUE once the student has selected at least one option (or entered a
   * numerical value). FALSE for skipped/unattempted questions.
   * Pre-populated as FALSE at attempt creation.
   */
  isAnswered: boolean;
  /**
   * TRUE if the student has flagged this question for review before
   * submitting. Does not affect scoring. Used by the navigation panel
   * to highlight flagged questions.
   */
  isMarkedForReview: boolean;
  /**
   * Student's entered value for `numerical` type questions.
   * NULL for MCQ, MSQ, and True/False.
   */
  numericalAnswer: number | null;
  /**
   * NULL until scored. Set by the result-generation job.
   * TRUE if all correct options were selected and no incorrect options.
   * For numerical: TRUE if within tolerance.
   */
  isCorrect: boolean | null;
  /**
   * NULL until scored. Positive for correct, negative for wrong (negative
   * marking), 0 for skipped/unattempted. Set by the result-generation job.
   */
  marksAwarded: number | null;
  /**
   * Cumulative seconds the student spent with this question visible.
   * Updated on each auto-save as the client tracks active question time.
   */
  timeSpentSeconds: number;
  /**
   * UTC timestamp of the student's last interaction with this question
   * (last option selection or numerical entry). NULL for unattempted.
   */
  answeredAt: string | null;
  /** UTC timestamp of row creation. Set at attempt creation time. */
  createdAt: string;
  /** UTC timestamp of last modification. Trigger-maintained. Updated on auto-save. */
  updatedAt: string;
}

/**
 * Input required to create a mock answer row (pre-populated at attempt creation).
 */
export interface CreateMockAnswerInput {
  /** Parent attempt ID. */
  attemptId: string;
  /** Question being answered. */
  questionId: string;
  /** Institute. */
  instituteId: string;
}

/**
 * Input required to update a mock answer (auto-save payload).
 *
 * The client sends an auto-save payload every 30 seconds and on every
 * question navigation. The WHERE clause includes `attemptId` to prevent
 * cross-attempt contamination.
 */
export interface UpdateMockAnswerInput {
  isAnswered?: boolean;
  isMarkedForReview?: boolean;
  numericalAnswer?: number | null;
  /** Set to null the numerical answer (clear the field). */
  timeSpentSeconds?: number;
  answeredAt?: string | null;
}

/**
 * Filters available when querying mock answers.
 */
export interface MockAnswerFilters {
  attemptId?: string;
  questionId?: string;
  isAnswered?: boolean;
  isMarkedForReview?: boolean;
  /** Filter by scoring status. */
  isCorrect?: boolean | null;
  /** Filter by specific answer IDs. */
  ids?: string[];
}

/**
 * Sort options for mock answers list queries.
 */
export interface MockAnswerSortOptions {
  sortBy?:
    | 'timeSpentSeconds'
    | 'answeredAt'
    | 'createdAt'
    | 'updatedAt';
  sortDirection?: SortDirection;
}

// ═══════════════════════════════════════════════════════════════════════════
//  MockAnswerOption (Junction)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Junction table linking a mock answer to a selected question option.
 *
 * Each row records that a student selected a specific option.
 * For MCQ: exactly one row per answered `mockAnswer`.
 * For MSQ: one row per selected option.
 *
 * This table replaces the `selectedOptionIds TEXT` field with proper FK
 * rows, enabling referential integrity and direct SQL scoring queries.
 *
 * Mirrors the `mock_answer_options` table in PostgreSQL.
 */
export interface MockAnswerOption {
  /** Primary key. */
  answerOptionId: string;
  /** Parent answer (FK → public.mock_answers). */
  answerId: string;
  /** The specific option selected (FK → public.question_options). */
  optionId: string;
  /** UTC timestamp when this option was selected. */
  selectedAt: string;
}

/**
 * Input required to select an option (add a mock answer option row).
 *
 * For MCQ: selecting a new option must atomically DELETE any existing
 * rows for this `answerId` and INSERT the new row in a single transaction.
 * For MSQ: selecting inserts a row; deselecting deletes the row.
 */
export interface CreateMockAnswerOptionInput {
  /** Parent answer ID. */
  answerId: string;
  /** The option being selected. */
  optionId: string;
}

/**
 * Update input for mock_answer_options is intentionally not provided.
 *
 * The `mock_answer_options` table has no mutable columns beyond the
 * PK. Options are added (INSERT via `CreateMockAnswerOptionInput`) and
 * removed (DELETE) — they are never updated in place. To change a
 * selected option, delete the old row and insert a new one.
 */
export type UpdateMockAnswerOptionInput = never;

/**
 * Filters available when querying mock answer options.
 */
export interface MockAnswerOptionFilters {
  answerId?: string;
  optionId?: string;
  /** Filter by specific answer IDs. */
  answerIds?: string[];
}

/**
 * Sort options for mock answer options list queries.
 */
export interface MockAnswerOptionSortOptions {
  sortBy?: 'selectedAt';
  sortDirection?: SortDirection;
}

// ═══════════════════════════════════════════════════════════════════════════
//  MockResult
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The computed result record for one submitted attempt.
 *
 * One row per attempt, created by the result-generation job after
 * submission. Stores aggregate scores, rankings, time analytics, and
 * subject/chapter breakdowns in denormalised JSONB for fast dashboard
 * rendering.
 *
 * This is a read-optimised materialised summary — an intentional 3NF
 * deviation. All fields are computed from `mock_answers` at generation
 * time and stored here to avoid recomputing on every dashboard request.
 *
 * Mirrors the `mock_results` table in PostgreSQL.
 */
export interface MockResult {
  /** Primary key. */
  resultId: string;
  /** Parent attempt (FK → public.mock_attempts). Enforced 1:1. */
  attemptId: string;
  /** Test this result is for (FK → public.mock_tests). Denormalized. */
  testId: string;
  /** Student who took the attempt (FK → public.student_details). Denormalized. */
  studentId: string;
  /** Institute (FK → public.institutes). Denormalized for RLS. */
  instituteId: string;
  /** Aggregate score across all questions. Can be negative with severe negative marking. */
  totalScore: number;
  /** Maximum possible score. Copied from `mock_tests.totalMarks` at result generation time. */
  maxScore: number;
  /** `(totalScore / maxScore) * 100`. Capped at 0 in display if negative. */
  percentage: number;
  /**
   * Student's rank among all submitted attempts for this test.
   * NULL until rankings are computed (after result release window closes
   * for `mock`/`scheduled` tests). Immediately set for `practice`/`immediate`.
   */
  rank: number | null;
  /**
   * Percentage of students the student scored higher than.
   * NULL until rankings are computed.
   */
  percentile: number | null;
  /** Count of answers where `isCorrect = TRUE`. */
  correctCount: number;
  /** Count of answers where `isCorrect = FALSE AND isAnswered = TRUE`. */
  wrongCount: number;
  /** Count of answers where `isAnswered = FALSE`. */
  skippedCount: number;
  /** Total time spent on the attempt in seconds. */
  totalTimeSeconds: number;
  /** `totalTimeSeconds / totalQuestions`. Used in performance reports. */
  avgTimePerQuestion: number;
  /**
   * Per-subject score breakdown.
   * Structure: `SubjectBreakdownItem[]`. NULL for single-subject tests.
   */
  subjectBreakdown: SubjectBreakdownItem[] | null;
  /**
   * Per-chapter score breakdown.
   * Structure: `ChapterBreakdownItem[]`. Used to identify weak chapters
   * for the PerformanceReport.
   */
  chapterBreakdown: ChapterBreakdownItem[] | null;
  /**
   * FALSE until results are released to the student.
   * For `immediate` release, set to TRUE at generation time.
   * For `scheduled` or `manual` release, set to TRUE by the release job.
   */
  isReleased: boolean;
  /** UTC timestamp when the result was computed. */
  generatedAt: string;
  /**
   * UTC timestamp when the result was made visible to the student.
   * NULL until released.
   */
  releasedAt: string | null;
}

/**
 * Input for the result-generation job (service_role only).
 *
 * Result creation is triggered by:
 * - `mock_attempt.status` transitioning to `submitted` or `timed_out`
 * - The timeout background job after auto-submission
 *
 * This is an Edge Function operation, never a client-side insert.
 */
export interface CreateMockResultInput {
  /** Parent attempt ID. */
  attemptId: string;
  /** Test ID (denormalized). */
  testId: string;
  /** Student ID (denormalized). */
  studentId: string;
  /** Institute ID (denormalized). */
  instituteId: string;
  /** Computed aggregate score. */
  totalScore: number;
  /** Maximum possible score. */
  maxScore: number;
  /** Computed percentage. */
  percentage: number;
  /** Count of correct answers. */
  correctCount: number;
  /** Count of wrong answers. */
  wrongCount: number;
  /** Count of skipped answers. */
  skippedCount: number;
  /** Total time spent in seconds. */
  totalTimeSeconds: number;
  /** Average time per question. */
  avgTimePerQuestion: number;
  /** Per-subject breakdown (nullable). */
  subjectBreakdown?: SubjectBreakdownItem[] | null;
  /** Per-chapter breakdown (nullable). */
  chapterBreakdown?: ChapterBreakdownItem[] | null;
}

/**
 * Input for updating a mock result (Edge Function only).
 *
 * Permitted updates:
 * - Rank/percentile backfill by the ranking batch job.
 * - `isReleased`/`releasedAt` by the result release job/admin action.
 *
 * Students and teachers may not update results.
 */
export interface UpdateMockResultInput {
  /** Student's rank (set by ranking batch job). */
  rank?: number | null;
  /** Student's percentile (set by ranking batch job). */
  percentile?: number | null;
  /** TRUE once results are released to the student. */
  isReleased?: boolean;
  /** UTC timestamp when results were released. */
  releasedAt?: string | null;
}

/**
 * Filters available when querying mock results.
 */
export interface MockResultFilters {
  attemptId?: string;
  testId?: string;
  studentId?: string;
  instituteId?: string;
  isReleased?: boolean;
  /** Minimum score threshold. */
  minScore?: number;
  /** Maximum score threshold. */
  maxScore?: number;
  /** Minimum rank (lower number = better rank). */
  minRank?: number;
  /** Maximum rank. */
  maxRank?: number;
  /** Results generated after this timestamp. */
  generatedAfter?: string;
  /** Results generated before this timestamp. */
  generatedBefore?: string;
  /** Results released after this timestamp. */
  releasedAfter?: string;
  /** Filter by specific result IDs. */
  ids?: string[];
}

/**
 * Sort options for mock results list queries.
 */
export interface MockResultSortOptions {
  sortBy?:
    | 'totalScore'
    | 'percentage'
    | 'rank'
    | 'percentile'
    | 'correctCount'
    | 'totalTimeSeconds'
    | 'generatedAt'
    | 'releasedAt';
  sortDirection?: SortDirection;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Entity Lookup & Include Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Nested relation includes for mock test queries.
 *
 * Allows fetching related entities in a single request to avoid N+1 queries.
 * Each boolean flag, when `true`, instructs the service layer to JOIN
 * and populate the corresponding relation on the parent entity.
 */
export interface MockTestIncludes {
  /** Include questions in this test (mock_test_questions). */
  questions?: boolean;
  /** Include the teacher who created this test. */
  teacher?: boolean;
  /** Include the parent stream. */
  stream?: boolean;
  /** Include the parent subject (if set). */
  subject?: boolean;
  /** Include the approval request for this test. */
  approvalRequest?: boolean;
}

/**
 * Nested relation includes for question queries.
 */
export interface QuestionIncludes {
  /** Include answer options. */
  options?: boolean;
  /** Include the explanation. */
  explanation?: boolean;
  /** Include images. */
  images?: boolean;
  /** Include the parent question (previous version). */
  parentQuestion?: boolean;
  /** Include child versions (revisions that supersede this question). */
  childVersions?: boolean;
  /** Include the parent chapter. */
  chapter?: boolean;
  /** Include the parent subject. */
  subject?: boolean;
  /** Include the teacher who authored this question. */
  teacher?: boolean;
  /** Include the latest approval request for this question. */
  approvalRequest?: boolean;
}

/**
 * Nested relation includes for attempt queries.
 */
export interface AttemptIncludes {
  /** Include all answers for this attempt. */
  answers?: boolean;
  /** Include the result for this attempt. */
  result?: boolean;
  /** Include the test metadata. */
  test?: boolean;
}

/**
 * Nested relation includes for result queries.
 */
export interface ResultIncludes {
  /** Include the parent attempt. */
  attempt?: boolean;
  /** Include the test metadata. */
  test?: boolean;
  /** Include the student details. */
  student?: boolean;
}
