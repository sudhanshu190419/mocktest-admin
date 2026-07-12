/**
 * PYQ Module Types
 *
 * Production-ready type definitions for the PYQ (Previous Year Questions) module.
 *
 * These types mirror the PostgreSQL schema exactly (Domain 06 — PYQ in
 * supabase/migrations/007_domain_06_pyq.sql), mapping snake_case database
 * columns to camelCase TypeScript properties.
 *
 * ## Scope
 *
 * Phase 1A covers only `pyq_packages`.  Paper types (pyq_papers, etc.)
 * will be added in Phase 1B.
 *
 * @module types/pyq
 */

import type { PaginationParams, SortDirection } from './academic';

// ═══════════════════════════════════════════════════════════════════════════
//  PYQ Package
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A PYQ Package — the top-level sellable unit of PYQ content.
 *
 * Mirrors the `pyq_packages` table in PostgreSQL.
 *
 * @see supabase/migrations/007_domain_06_pyq.sql
 */
export interface PyqPackage {
  /** Primary key. */
  packageId: string;
  /** Institute that owns this package (FK → public.institutes). */
  instituteId: string;
  /** Exam stream (FK → public.streams). A package is scoped to exactly one stream. */
  streamId: string;
  /** Display name (e.g. "NEET PYQ 2015–2024 Complete Bundle"). */
  name: string;
  /** Marketing description shown on the package detail page. */
  description: string | null;
  /** Listed price in the configured currency. 0.00 for free packages. */
  price: number;
  /** ISO 4217 currency code (default INR). */
  currency: string;
  /** Supabase Storage path for the package cover image. NULL until uploaded. */
  thumbnailPath: string | null;
  /** Earliest exam year covered by papers in this package. */
  yearFrom: number | null;
  /** Latest exam year covered by papers in this package. */
  yearTo: number | null;
  /** Denormalized count of published papers in this package. */
  totalPapers: number;
  /** When FALSE, the package is hidden from the store. */
  isActive: boolean;
  /** UTC timestamp when the package was first published. NULL until published. */
  publishedAt: string | null;
  /** UTC creation timestamp. */
  createdAt: string;
  /** UTC last-modified timestamp. */
  updatedAt: string;
  /** Resolved stream name for display (joined from `streams`). */
  streamName?: string | null;
}

/**
 * Input required to create a new PYQ package.
 *
 * `instituteId` is optional — when omitted, the service populates it
 * automatically from the current teacher's identity resolution.
 */
export interface CreatePyqPackageInput {
  /**
   * Institute that owns this package.
   * When omitted, the service populates this server-side from the
   * authenticated teacher's identity.
   */
  instituteId?: string;
  /** Exam stream this package covers. */
  streamId: string;
  /** Display name. Minimum 3 characters. */
  name: string;
  /** Marketing description (optional). */
  description?: string | null;
  /** Listed price (0 for free packages). */
  price: number;
  /** ISO 4217 currency code (default 'INR'). */
  currency?: string;
  /** Storage path for the thumbnail image (optional). */
  thumbnailPath?: string | null;
  /** Earliest exam year (optional). Valid range: 1990–2100. */
  yearFrom?: number | null;
  /** Latest exam year (optional). Must be ≥ yearFrom if both set. */
  yearTo?: number | null;
}

/**
 * Input required to update an existing PYQ package.
 *
 * All fields are optional — only provided fields are included in the UPDATE.
 */
export interface UpdatePyqPackageInput {
  name?: string;
  description?: string | null;
  streamId?: string;
  price?: number;
  currency?: string;
  thumbnailPath?: string | null;
  yearFrom?: number | null;
  yearTo?: number | null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Filters & Sorting
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Filters available when querying the PYQ packages list.
 */
export interface PyqPackageFilters {
  instituteId?: string;
  streamId?: string;
  /**
   * Filter by active status.
   * - `true`: only active packages
   * - `false`: only inactive packages
   * - `undefined`: all packages
   */
  isActive?: boolean;
  /**
   * Filter by published status.
   * - `true`: only published packages (published_at IS NOT NULL)
   * - `false`: only unpublished packages (published_at IS NULL)
   * - `undefined`: all packages
   */
  isPublished?: boolean;
  /** Searches across name (case-insensitive LIKE). */
  search?: string;
}

/**
 * Sort options for PYQ packages list queries.
 */
export interface PyqPackageSortOptions {
  sortBy?: 'name' | 'price' | 'totalPapers' | 'isActive' | 'publishedAt' | 'createdAt' | 'updatedAt';
  sortDirection?: SortDirection;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Dashboard / Stats
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Summary counts for the PYQ packages dashboard.
 */
export interface PyqPackageCounts {
  total: number;
  active: number;
  inactive: number;
  published: number;
  unpublished: number;
}

// ═══════════════════════════════════════════════════════════════════════════
//  PYQ Paper
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A PYQ Paper — one row per official exam paper.
 *
 * Mirrors the `pyq_papers` table in PostgreSQL.
 *
 * @see supabase/migrations/007_domain_06_pyq.sql
 */
export interface PyqPaper {
  /** Primary key. */
  paperId: string;
  /** Parent package (FK → pyq_packages). */
  packageId: string;
  /** Institute that owns this paper (FK → public.institutes). */
  instituteId: string;
  /** Exam stream (FK → public.streams). Must match the parent package's stream. */
  streamId: string;
  /** Display title (e.g. "NEET 2023 Official Paper"). */
  title: string;
  /** The calendar year the exam was held. */
  examYear: number;
  /** The specific date the exam was held, if known. */
  examDate: string | null;
  /** Session or shift identifier (e.g. "January Session 1", "Morning Shift"). */
  examSession: string | null;
  /** Denormalized count of questions mapped to this paper. */
  totalQuestions: number;
  /** Total marks of the official paper. */
  totalMarks: number | null;
  /** Official exam duration in minutes. */
  durationMin: number | null;
  /** Supabase Storage bucket for the question paper PDF. */
  pdfStorageBucket: string | null;
  /** Storage path within pdfStorageBucket. */
  pdfStoragePath: string | null;
  /** Supabase Storage bucket for the solutions PDF. */
  solutionPdfStorageBucket: string | null;
  /** Storage path within solutionPdfStorageBucket. */
  solutionPdfStoragePath: string | null;
  /** When TRUE, the paper is visible to students who purchased the package. */
  isPublished: boolean;
  /** UTC timestamp when this paper was first published. NULL until published. */
  publishedAt: string | null;
  /** UTC creation timestamp. */
  createdAt: string;
  /** UTC last-modified timestamp. */
  updatedAt: string;
}

/**
 * Input required to create a new PYQ paper.
 *
 * Teachers provide PDF files directly; the service handles upload and
 * automatically populates `pdfStorageBucket`, `pdfStoragePath`,
 * `solutionPdfStorageBucket`, and `solutionPdfStoragePath`.
 */
export interface CreatePyqPaperInput {
  /** Parent package ID (auto-populated). */
  packageId: string;
  /** Display title. Minimum 3 characters. */
  title: string;
  /** The calendar year the exam was held. Valid range: 1990–2100. */
  examYear: number;
  /** The specific date the exam was held (optional). */
  examDate?: string | null;
  /** Session or shift identifier (optional). */
  examSession?: string | null;
  /** Total marks of the official paper (optional). */
  totalMarks?: number | null;
  /** Official exam duration in minutes (optional). Max 600. */
  durationMin?: number | null;
  /**
   * Question paper PDF file. When provided, the service uploads it and
   * populates `pdfStorageBucket` & `pdfStoragePath` automatically.
   */
  questionPdfFile?: File | Blob | ArrayBuffer;
  /**
   * Solution PDF file. When provided, the service uploads it and
   * populates `solutionPdfStorageBucket` & `solutionPdfStoragePath` automatically.
   */
  solutionPdfFile?: File | Blob | ArrayBuffer;
  /** Storage bucket for the question paper PDF (optional, populated by service). */
  pdfStorageBucket?: string | null;
  /** Storage path for the question paper PDF (optional, populated by service). */
  pdfStoragePath?: string | null;
  /** Storage bucket for the solutions PDF (optional, populated by service). */
  solutionPdfStorageBucket?: string | null;
  /** Storage path for the solutions PDF (optional, populated by service). */
  solutionPdfStoragePath?: string | null;
  /**
   * Progress callback for upload operations.
   * Receives (loadedBytes, totalBytes) during file uploads.
   */
  onProgress?: (loaded: number, total: number) => void;
}

/**
 * Input required to update an existing PYQ paper.
 *
 * All fields are optional — only provided fields are included in the UPDATE.
 * For PDF files, provide the file directly; the service handles upload and
 * updates storage fields automatically.
 */
export interface UpdatePyqPaperInput {
  title?: string;
  examYear?: number;
  examDate?: string | null;
  examSession?: string | null;
  totalMarks?: number | null;
  durationMin?: number | null;
  /**
   * New question paper PDF file to replace the existing one.
   * When provided, the service uploads it and updates storage fields.
   */
  questionPdfFile?: File | Blob | ArrayBuffer;
  /**
   * New solution PDF file to replace the existing one.
   * When provided, the service uploads it and updates storage fields.
   */
  solutionPdfFile?: File | Blob | ArrayBuffer;
  pdfStorageBucket?: string | null;
  pdfStoragePath?: string | null;
  solutionPdfStorageBucket?: string | null;
  solutionPdfStoragePath?: string | null;
  /**
   * Progress callback for upload operations.
   */
  onProgress?: (loaded: number, total: number) => void;
}

/**
 * Filters available when querying the PYQ papers list.
 */
export interface PyqPaperFilters {
  packageId?: string;
  /** Filter by exam year. */
  examYear?: number;
  /**
   * Filter by published status.
   * - `true`: only published papers (published_at IS NOT NULL)
   * - `false`: only unpublished papers (published_at IS NULL)
   * - `undefined`: all papers
   */
  isPublished?: boolean;
  /** Searches across title (case-insensitive LIKE). */
  search?: string;
}

/**
 * Sort options for PYQ papers list queries.
 */
export interface PyqPaperSortOptions {
  sortBy?: 'title' | 'examYear' | 'totalQuestions' | 'totalMarks' | 'durationMin' | 'isPublished' | 'publishedAt' | 'createdAt' | 'updatedAt';
  sortDirection?: SortDirection;
}

// ═══════════════════════════════════════════════════════════════════════════
//  PYQ Question Mapping
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A PYQ Question Mapping — links a question from the shared question bank
 * to a specific PYQ paper at a specific position.
 *
 * Mirrors the `pyq_question_mappings` table in PostgreSQL.
 *
 * @see supabase/migrations/007_domain_06_pyq.sql
 */
export interface PyqQuestionMapping {
  /** Primary key. */
  mappingId: string;
  /** Parent paper (FK → pyq_papers). */
  paperId: string;
  /** Linked question (FK → public.questions). */
  questionId: string;
  /** Institute that owns this mapping. */
  instituteId: string;
  /** 1-indexed position within the paper (question number in the official exam). */
  orderSequence: number;
  /** Section label for multi-section papers (e.g. 'Physics', 'Section A'). */
  sectionName: string | null;
  /** Official marks for a correct answer. May differ from question default. */
  officialMarks: number | null;
  /** Official negative marks per wrong answer. May differ from question default. */
  officialNegativeMarks: number | null;
  /** UTC timestamp when this mapping was created. */
  addedAt: string;
}

/**
 * Input required to create a new PYQ question mapping.
 */
export interface CreatePyqQuestionMappingInput {
  /** Parent paper ID. */
  paperId: string;
  /** The question to assign. */
  questionId: string;
  /** 1-indexed position within the paper. Auto-assigned if not provided. */
  orderSequence?: number;
  /** Section label for multi-section papers (optional). */
  sectionName?: string | null;
  /** Official marks override (optional). */
  officialMarks?: number | null;
  /** Official negative marks override (optional). */
  officialNegativeMarks?: number | null;
}

/**
 * Assignment descriptor for bulk question operations.
 */
export interface PyqQuestionAssignment {
  /** The question to assign. */
  questionId: string;
  /** 1-indexed position within the paper. */
  orderSequence: number;
  /** Section label for multi-section papers (optional). */
  sectionName?: string | null;
  /** Official marks override (optional). */
  officialMarks?: number | null;
  /** Official negative marks override (optional). */
  officialNegativeMarks?: number | null;
}

/**
 * Item descriptor for reorder operations.
 */
export interface PyqReorderItem {
  /** The question ID to reorder. */
  questionId: string;
  /** New 1-indexed display order. */
  orderSequence: number;
}

/**
 * Filters available when querying PYQ question mappings.
 */
export interface PyqQuestionMappingFilters {
  paperId?: string;
  questionId?: string;
  sectionName?: string;
}

/**
 * Sort options for PYQ question mappings list queries.
 */
export interface PyqQuestionMappingSortOptions {
  sortBy?: 'orderSequence' | 'officialMarks' | 'addedAt';
  sortDirection?: SortDirection;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Re-export common types for convenience
// ═══════════════════════════════════════════════════════════════════════════

export type { PaginationParams, SortDirection };
