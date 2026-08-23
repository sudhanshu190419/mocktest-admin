/**
 * Bulk Timetable Import Types
 *
 * Phase 2 — data model for the one-file Excel/CSV bulk import that creates
 * recurring `timetable_slots` + date-specific `lesson_plans` through the
 * `public.bulk_import_timetable` RPC (migration 114).
 *
 * ## Data flow
 *
 * ```
 * File (XLSX/CSV)
 *   └─ src/utils/bulkTimetableParser.ts   → RawSheetRow[] (cell values)
 *   └─ src/utils/bulkTimetableValidator.ts→ ImportPreview (resolved + validated)
 *   └─ buildImportPayload()               → BulkImportPayload (p_slots + p_plans)
 *   └─ src/services/admin/bulkTimetableImportService.ts
 *   └─ public.bulk_import_timetable(...)  → BulkImportRpcResult
 * ```
 *
 * The parser/validator are PURE — they never touch the network or the
 * database. All reference lookups run against preloaded in-memory maps
 * (`ReferenceData`) fetched by the service in ONE batched phase.
 *
 * @module types/bulkTimetableImport
 */

// ═══════════════════════════════════════════════════════════════════════════
//  Template constants
// ═══════════════════════════════════════════════════════════════════════════
//  Centralised header spelling/casing — the parser and the template exporter
//  MUST both use these constants so header strings never drift.

/** The only supported template version. */
export const BULK_TIMETABLE_TEMPLATE_VERSION = 'BULK_TIMETABLE_V2';

/** Exact canonical header row of the official template (order matters). */
export const BULK_TIMETABLE_HEADERS = [
  'Date',
  'Teacher Mobile',
  'Teacher Name',
  'Batch Code',
  'Subject Code',
  'Start Time',
  'End Time',
  'Chapter',
  'Topic',
  'Notes',
  'Valid From',
  'Valid Until',
] as const;

export type BulkTimetableHeader = (typeof BULK_TIMETABLE_HEADERS)[number];

/** Headers that MUST be present in the uploaded file. */
export const BULK_TIMETABLE_REQUIRED_HEADERS = new Set<string>([
  'Date',
  'Teacher Mobile',
  'Batch Code',
  'Subject Code',
  'Start Time',
  'End Time',
]);

/** Maximum accepted file size in bytes (10 MB). */
export const BULK_IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Maximum accepted data rows (mirrors migration 114's payload guard). */
export const BULK_IMPORT_MAX_ROWS = 5000;

/** Allowed upload extensions (case-insensitive). */
export const BULK_IMPORT_ALLOWED_EXTENSIONS = ['.xlsx', '.csv'] as const;

// ═══════════════════════════════════════════════════════════════════════════
//  Issue model
// ═══════════════════════════════════════════════════════════════════════════

/** Severity of an import issue. `error` blocks the whole import. */
export type ImportSeverity = 'error' | 'warning' | 'info';

/**
 * A single import issue attached to a spreadsheet row (or the whole file when
 * `row` is null).
 *
 * - `error`   — blocking. Any error ⇒ the file cannot be imported.
 * - `warning` — non-blocking concern (inactive batch, holiday, leave, …).
 * - `info`    — non-blocking information (reuse of an existing slot, …).
 */
export interface ImportIssue {
  /** 1-based spreadsheet row the issue belongs to (null = file-level). */
  row: number | null;
  /** Template column the issue belongs to (null = file-level/general). */
  column: string | null;
  /** The offending value, verbatim where available. */
  value: unknown;
  /** Human-readable problem description. */
  problem: string;
  /** Optional actionable suggestion. */
  suggestion?: string;
  severity: ImportSeverity;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Raw sheet model (parser output)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A spreadsheet cell value as produced by the parser. Date/time cells that
 * Excel stores as serial numbers are already converted to ISO strings by the
 * parser; plain text cells are passed through trimmed (empty string = blank).
 */
export type SheetCellValue = string | number | boolean | null;

/**
 * One normalized spreadsheet row — BEFORE master-data resolution. All values
 * are raw cell values (string | number | boolean | null); the validator
 * converts them to IDs + canonical ISO values.
 */
export interface RawSheetRow {
  /** 1-based spreadsheet row number (for error reporting). */
  row: number;
  /** Date column — ISO date string when parseable, raw value otherwise. */
  date: SheetCellValue;
  /** Teacher Mobile column — the stable teacher identifier (digits-normalized). */
  teacherMobile: string;
  /** Teacher Name column — informational only (never used for matching). */
  teacherName: string;
  /** Batch Code column. */
  batchCode: string;
  /** Subject Code column (unique within the batch's stream). */
  subjectCode: string;
  /** Start Time column — HH:MM:SS when parseable, raw value otherwise. */
  startTime: SheetCellValue;
  /** End Time column — HH:MM:SS when parseable, raw value otherwise. */
  endTime: SheetCellValue;
  /** Chapter column (name, informational only for matching). */
  chapter: string;
  /** Topic column (name; blank = chapter-only lesson). */
  topic: string;
  /** Notes column (free-form). */
  notes: string;
  /** Valid From column — optional explicit validity override. */
  validFrom: SheetCellValue;
  /** Valid Until column — optional explicit validity override. */
  validUntil: SheetCellValue;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Reference data (service fetch — ONE batched phase)
// ═══════════════════════════════════════════════════════════════════════════

/** Teacher reference: teacher_details row joined with its profile identity. */
export interface ReferenceTeacher {
  teacherId: string;
  /** profiles.profile_id of the teacher's account. */
  profileId: string;
  /** profiles.email — informational only (nullable; phone-first accounts have none). */
  email: string | null;
  /** profiles.phone — the stable identifier used by the importer (E.164 digits, no '+'). */
  phone: string | null;
  /** profiles.name — informational. */
  name: string | null;
  /** profiles.institute_id — institute scope guard. */
  instituteId: string;
}

/** Batch reference (batches table, institute-scoped, non-deleted). */
export interface ReferenceBatch {
  batchId: string;
  instituteId: string;
  streamId: string;
  name: string;
  batchCode: string;
  /** batch_status: 'upcoming' | 'active' | 'completed' | 'archived'. */
  status: string;
}

/** Subject reference (subjects table; unique per stream by code). */
export interface ReferenceSubject {
  subjectId: string;
  streamId: string;
  name: string;
  code: string;
}

/** Stream reference — links a batch to its subjects (stream_id). */
export interface ReferenceStream {
  streamId: string;
  instituteId: string;
  name: string;
  code: string;
}

/**
 * batch_subjects reference — the timetable's actual subject container.
 * The slot stores batch_subject_id (NEVER batch + subject independently).
 */
export interface ReferenceBatchSubject {
  batchSubjectId: string;
  batchId: string;
  subjectId: string;
  instituteId: string;
  /** Display-name override (nullable — global subjects.name applies). */
  name: string | null;
}

/**
 * Authoritative teacher↔batch-subject assignment
 * (batch_subject_teachers — NEVER batch_teachers).
 */
export interface ReferenceAssignment {
  batchSubjectId: string;
  teacherId: string;
}

/** Chapter reference (chapters table, non-deleted). */
export interface ReferenceChapter {
  chapterId: string;
  subjectId: string;
  name: string;
}

/** Topic reference (topics table, non-deleted). */
export interface ReferenceTopic {
  topicId: string;
  chapterId: string;
  name: string;
}

/** Existing timetable slot (for reuse/extend classification + conflicts). */
export interface ReferenceTimetableSlot {
  timetableSlotId: string;
  teacherId: string;
  batchSubjectId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  validFrom: string;
  validUntil: string;
  status: string;
}

/**
 * Everything the validator needs to resolve + validate a spreadsheet.
 * Fetched in ONE batched phase by `fetchBulkImportReferenceData`.
 */
export interface ReferenceData {
  instituteId: string;
  /** institutes.timezone (default Asia/Kolkata) — for date semantics. */
  timezone: string;
  teachers: ReferenceTeacher[];
  batches: ReferenceBatch[];
  streams: ReferenceStream[];
  subjects: ReferenceSubject[];
  batchSubjects: ReferenceBatchSubject[];
  assignments: ReferenceAssignment[];
  chapters: ReferenceChapter[];
  topics: ReferenceTopic[];
  existingSlots: ReferenceTimetableSlot[];
  /**
   * Existing lesson plans (timetable_slot_id + occurrence_date) — lets the
   * preview classify each planned date as create vs update EXACTLY.
   */
  existingPlans: { timetableSlotId: string; occurrenceDate: string }[];
  /** YYYY-MM-DD dates that are institute holidays. */
  holidays: string[];
  /** Active teacher leaves (teacher_id + inclusive range). */
  teacherLeaves: { teacherId: string; startDate: string; endDate: string }[];
}

// ═══════════════════════════════════════════════════════════════════════════
//  Imported row model (validator output — resolved + validated)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * One validated spreadsheet row with resolved IDs. `teacherId`, `batchId`,
 * `subjectId`, `batchSubjectId`, `chapterId`, `topicId` are null when the row
 * failed to resolve (the corresponding issue is recorded in `issues`).
 */
export interface ImportedRow {
  /** 1-based spreadsheet row number. */
  row: number;
  /** Canonical occurrence date YYYY-MM-DD ('' when unparseable). */
  date: string;
  /** teacher_details.teacher_id (null = unresolved). */
  teacherId: string | null;
  /** The normalized mobile digits used for matching. */
  teacherMobile: string;
  teacherName: string | null;
  /** batches.batch_id (null = unresolved). */
  batchId: string | null;
  batchCode: string;
  /** subjects.subject_id (null = unresolved). */
  subjectId: string | null;
  subjectCode: string;
  /** batch_subjects.batch_subject_id (null = unresolved). */
  batchSubjectId: string | null;
  /** Canonical HH:MM:SS start time ('' when unparseable). */
  startTime: string;
  /** Canonical HH:MM:SS end time ('' when unparseable). */
  endTime: string;
  /** chapters.chapter_id (null = none/unresolved). */
  chapterId: string | null;
  /** topics.topic_id (null = chapter-only lesson). */
  topicId: string | null;
  notes: string | null;
  /** Effective validity for this row's group (computed at grouping time). */
  groupValidFrom: string;
  groupValidUntil: string;
  /**
   * Set to the row number of the first identical row when this row is a
   * silent duplicate. Duplicate rows are excluded from grouping, plan
   * counts, and the import payload (the first occurrence wins).
   */
  duplicateOfRow: number | null;
  /** Row-level issues collected during validation. */
  issues: ImportIssue[];
}

// ═══════════════════════════════════════════════════════════════════════════
//  Group model (validator output)
// ═══════════════════════════════════════════════════════════════════════════

/** How an import group maps to existing timetable data. */
export type ImportGroupMode = 'create' | 'reuse' | 'extend';

/**
 * A timetable-slot group: one recurring schedule rule derived from all rows
 * sharing the same (teacher, batch_subject, day_of_week, start, end).
 */
export interface ImportGroup {
  /** Deterministic slot key sent to the RPC (also referenced by p_plans). */
  key: string;
  teacherId: string;
  batchSubjectId: string;
  /** isodow 1..7 derived from the occurrence dates (1 = Monday). */
  dayOfWeek: number;
  /** Canonical HH:MM:SS. */
  startTime: string;
  /** Canonical HH:MM:SS. */
  endTime: string;
  validFrom: string;
  validUntil: string;
  /** Sorted occurrence dates (YYYY-MM-DD) of the group's lesson plans. */
  dates: string[];
  lessonCount: number;
  mode: ImportGroupMode;
  /**
   * The existing slot id when mode is reuse/extend — lets the RPC be told
   * "use this existing slot" without creating a duplicate.
   */
  existingSlotId: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Preview model
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Aggregate counts for the import preview.
 *
 * `plansToCreate` / `plansToUpdate` are computed exactly from the resolved
 * rows + the reference data's existing slots (a plan updates when the same
 * slot + occurrence date already exists) — never guessed.
 */
export interface ImportSummary {
  totalRows: number;
  validRows: number;
  errorRows: number;
  warningCount: number;
  /** Silent duplicates removed before grouping (identical rows). */
  duplicateCount: number;
  slotsToCreate: number;
  slotsToReuse: number;
  slotsToExtend: number;
  plansToCreate: number;
  plansToUpdate: number;
}

export interface MissingSubjectItem {
  rawName: string;
  rowNumbers: number[];
}

export interface MissingChapterItem {
  rawSubject: string;
  rawChapter: string;
  resolvedSubjectId: string | null;
  resolvedSubjectName: string | null;
  rowNumbers: number[];
}

export interface MissingTopicItem {
  rawChapter: string;
  rawTopic: string;
  resolvedChapterId: string | null;
  resolvedChapterName: string | null;
  rowNumbers: number[];
}

export interface MissingAcademicReferences {
  subjects: MissingSubjectItem[];
  chapters: MissingChapterItem[];
  topics: MissingTopicItem[];
}

/** The complete validated import preview consumed by the Phase 3 UI. */
export interface ImportPreview {
  rows: ImportedRow[];
  groups: ImportGroup[];
  issues: ImportIssue[];
  summary: ImportSummary;
  missingReferences?: MissingAcademicReferences;
}

// ═══════════════════════════════════════════════════════════════════════════
//  RPC payload + result
// ═══════════════════════════════════════════════════════════════════════════

/** One `p_slots` entry — EXACTLY as migration 114 expects. */
export interface BulkSlotPayload {
  key: string;
  teacher_id: string;
  batch_subject_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  valid_from: string;
  valid_until: string;
}

/** One `p_plans` entry — EXACTLY as migration 114 expects. */
export interface BulkPlanPayload {
  slot_key: string;
  occurrence_date: string;
  chapter_id: string | null;
  topic_id: string | null;
  notes: string | null;
}

/** The full payload sent to `public.bulk_import_timetable`. */
export interface BulkImportPayload {
  slots: BulkSlotPayload[];
  plans: BulkPlanPayload[];
}

/** Structured result returned by `bulk_import_timetable` (migration 114). */
export interface BulkImportRpcResult {
  success: boolean;
  slotsCreated: number;
  slotsReused: number;
  slotsExtended: number;
  plansCreated: number;
  plansUpdated: number;
}
