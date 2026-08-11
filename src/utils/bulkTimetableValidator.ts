/**
 * Bulk Timetable Import — Validator
 *
 * Phase 2 — PURE normalization → resolution → validation → grouping →
 * preview → payload. NO Supabase calls, NO React, NO side effects.
 *
 * The validator consumes `RawSheetRow[]` (from the parser) + `ReferenceData`
 * (preloaded by the service) and produces an `ImportPreview` with resolved
 * IDs, row/file-level issues, schedule groups (create/reuse/extend), exact
 * create/update plan counts, and — when zero blocking errors exist — the
 * exact `BulkImportPayload` (p_slots + p_plans) expected by migration 114.
 *
 * ## Rule parity with the backend
 *
 * - Slot identity & conflicts mirror `create_timetable_slot` /
 *   `find_timetable_slot_conflicts` (migration 108): teacher/batch overlaps
 *   require same day, overlapping HALF-OPEN time ranges, and overlapping
 *   inclusive validity windows; only `active` existing slots conflict.
 * - Reuse targets active OR paused existing slots with an identical
 *   schedule + overlapping validity; disjoint validity ⇒ new slot.
 * - Lesson plans are idempotent (slot + occurrence date); identical rows are
 *   deduped; conflicting duplicates are blocking.
 *
 * Frontend validation is ADVISORY — RPC 114 remains the final authority.
 *
 * @module utils/bulkTimetableValidator
 */

import { expandDateRange } from '@/utils/lessonOccurrences';
import { digitsOnly, indiaNationalKey, isPlaceholderMobile } from '@/utils/mobileNumber';
import type {
  BulkImportPayload,
  BulkPlanPayload,
  BulkSlotPayload,
  ImportGroup,
  ImportIssue,
  ImportPreview,
  ImportedRow,
  ImportSummary,
  RawSheetRow,
  ReferenceData,
  ReferenceTimetableSlot,
} from '@/types/bulkTimetableImport';

// ═══════════════════════════════════════════════════════════════════════════
//  Flexible date/time parsing
// ═══════════════════════════════════════════════════════════════════════════

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Excel epoch offset: 1899-12-30 (handles the 1900 leap-year bug). */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

/** True when `iso` is a real YYYY-MM-DD calendar date. */
function isRealIsoDate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const check = new Date(Date.UTC(y, mo - 1, d));
  return (
    check.getUTCFullYear() === y &&
    check.getUTCMonth() === mo - 1 &&
    check.getUTCDate() === d
  );
}

/** Format a UTC Date as YYYY-MM-DD (no local-tz shift). */
function utcToIso(date: Date): string {
  const y = String(date.getUTCFullYear()).padStart(4, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parse a spreadsheet date value into YYYY-MM-DD.
 *
 * Accepted: YYYY-MM-DD, DD-MMM-YY, DD-MMM-YYYY, DD/MM/YYYY, Excel serial
 * numbers. Timezone-independent (date-only values; serials are UTC days).
 *
 * @returns YYYY-MM-DD or null when unparseable.
 */
export function parseSpreadsheetDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;

  // Excel serial number (already converted by the parser; defensive here).
  // Math.floor keeps the calendar date stable even when the serial carries a
  // time fraction (e.g. 46244.75 must stay 2026-08-10, not round up a day).
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    const date = new Date(EXCEL_EPOCH_MS + Math.floor(value) * MS_PER_DAY);
    return utcToIso(date);
  }
  if (typeof value !== 'string') return null;

  const text = value.trim();
  if (!text) return null;

  // YYYY-MM-DD
  if (isRealIsoDate(text)) return text;

  // DD-MMM-YY / DD-MMM-YYYY (e.g. 10-Aug-26, 10-Aug-2026)
  const dmy = /^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/.exec(text);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = MONTHS[dmy[2].toLowerCase()];
    if (!month) return null;
    let year = Number(dmy[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000; // 2-digit year window
    const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return isRealIsoDate(iso) ? iso : null;
  }

  // DD/MM/YYYY (day-first, per the approved template)
  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (slashed) {
    const iso = `${slashed[3]}-${String(Number(slashed[2])).padStart(2, '0')}-${String(Number(slashed[1])).padStart(2, '0')}`;
    return isRealIsoDate(iso) ? iso : null;
  }

  return null;
}

/**
 * Parse a spreadsheet time value into HH:MM:SS.
 *
 * Accepted: HH:MM, HH:MM:SS, HH:MM[:SS] AM/PM (12h), Excel time serials.
 *
 * @returns HH:MM:SS or null when unparseable.
 */
export function parseSpreadsheetTime(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;

  // Excel time serial (fraction of a day).
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1) {
    const totalSec = Math.round(value * 86_400);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  if (typeof value !== 'string') return null;

  const text = value.trim().toUpperCase();
  if (!text) return null;

  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/.exec(text);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  const period = match[4];

  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  if (period === 'PM' && hours < 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** PostgreSQL isodow (1=Monday … 7=Sunday) for a YYYY-MM-DD date. */
export function isoDowOf(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  return dow === 0 ? 7 : dow;
}

/** Half-open time overlap: [aStart, aEnd) ∩ [bStart, bEnd) ≠ ∅ (HH:MM:SS). */
function timesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Inclusive validity overlap: [aFrom,aUntil] ∩ [bFrom,bUntil] ≠ ∅. */
function validityOverlap(aFrom: string, aUntil: string, bFrom: string, bUntil: string): boolean {
  return aFrom <= bUntil && bFrom <= aUntil;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Reference index (in-memory lookup maps — built ONCE per preview)
// ═══════════════════════════════════════════════════════════════════════════

interface ReferenceIndex {
  /** Full international mobile digits (E.164, no '+') → teacher. */
  teacherByMobile: Map<string, ReferenceData['teachers'][number]>;
  /** India convenience: 10-digit national key for 91 + 10-digit stored numbers. */
  teacherByNational10: Map<string, ReferenceData['teachers'][number]>;
  /** Mobile digit keys that match more than one teacher (blocking ambiguity). */
  duplicateMobileKeys: Set<string>;
  duplicateNationalKeys: Set<string>;
  batchByCode: Map<string, ReferenceData['batches'][number]>;
  subjectByStreamCode: Map<string, ReferenceData['subjects'][number]>;
  batchSubjectByKey: Map<string, ReferenceData['batchSubjects'][number]>;
  assignmentSet: Set<string>;
  chaptersBySubject: Map<string, ReferenceData['chapters']>;
  topicsByChapter: Map<string, ReferenceData['topics']>;
  batchIdByBatchSubject: Map<string, string>;
  planKeySet: Set<string>;
  holidaysSet: Set<string>;
  leavesByTeacher: Map<string, { startDate: string; endDate: string }[]>;
  /** ALL existing slots (reuse/extend classification). */
  existingSlots: ReferenceTimetableSlot[];
  /** Active existing slots (conflict targets) — never paused/cancelled. */
  activeSlots: ReferenceTimetableSlot[];
}

function buildReferenceIndex(reference: ReferenceData): ReferenceIndex {
  // Teachers without a usable phone cannot be selected by mobile import
  // (email is NEVER a fallback — phone-first accounts have no email).
  const teacherByMobile = new Map<string, ReferenceData['teachers'][number]>();
  const teacherByNational10 = new Map<string, ReferenceData['teachers'][number]>();
  const duplicateMobileKeys = new Set<string>();
  const duplicateNationalKeys = new Set<string>();
  for (const t of reference.teachers) {
    if (!t.phone) continue;
    const digits = digitsOnly(t.phone);
    // Placeholder backfill numbers (migrations 024/025) are not real phones
    // — a teacher with only a placeholder cannot be selected by mobile import.
    if (!digits || isPlaceholderMobile(digits)) continue;
    if (teacherByMobile.has(digits)) duplicateMobileKeys.add(digits);
    else teacherByMobile.set(digits, t);
    const national = indiaNationalKey(digits);
    if (national) {
      if (teacherByNational10.has(national)) duplicateNationalKeys.add(national);
      else teacherByNational10.set(national, t);
    }
  }

  const batchByCode = new Map<string, ReferenceData['batches'][number]>();
  for (const b of reference.batches) batchByCode.set(b.batchCode.toUpperCase(), b);

  const subjectByStreamCode = new Map<string, ReferenceData['subjects'][number]>();
  for (const s of reference.subjects) subjectByStreamCode.set(`${s.streamId}:${s.code.toUpperCase()}`, s);

  const batchSubjectByKey = new Map<string, ReferenceData['batchSubjects'][number]>();
  const batchIdByBatchSubject = new Map<string, string>();
  for (const bs of reference.batchSubjects) {
    batchSubjectByKey.set(`${bs.batchId}:${bs.subjectId}`, bs);
    batchIdByBatchSubject.set(bs.batchSubjectId, bs.batchId);
  }

  const assignmentSet = new Set<string>();
  for (const a of reference.assignments) assignmentSet.add(`${a.batchSubjectId}:${a.teacherId}`);

  const chaptersBySubject = new Map<string, ReferenceData['chapters']>();
  for (const c of reference.chapters) {
    const list = chaptersBySubject.get(c.subjectId) ?? [];
    list.push(c);
    chaptersBySubject.set(c.subjectId, list);
  }

  const topicsByChapter = new Map<string, ReferenceData['topics']>();
  for (const t of reference.topics) {
    const list = topicsByChapter.get(t.chapterId) ?? [];
    list.push(t);
    topicsByChapter.set(t.chapterId, list);
  }

  const planKeySet = new Set<string>();
  for (const p of reference.existingPlans) planKeySet.add(`${p.timetableSlotId}:${p.occurrenceDate}`);

  const holidaysSet = new Set(reference.holidays);

  const leavesByTeacher = new Map<string, { startDate: string; endDate: string }[]>();
  for (const l of reference.teacherLeaves) {
    const list = leavesByTeacher.get(l.teacherId) ?? [];
    list.push(l);
    leavesByTeacher.set(l.teacherId, list);
  }

  const activeSlots = reference.existingSlots.filter((s) => s.status === 'active');

  return {
    teacherByMobile,
    teacherByNational10,
    duplicateMobileKeys,
    duplicateNationalKeys,
    batchByCode,
    subjectByStreamCode,
    batchSubjectByKey,
    assignmentSet,
    chaptersBySubject,
    topicsByChapter,
    batchIdByBatchSubject,
    planKeySet,
    holidaysSet,
    leavesByTeacher,
    existingSlots: reference.existingSlots,
    activeSlots,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Row normalization + validation
// ═══════════════════════════════════════════════════════════════════════════

/** Case/whitespace-insensitive name comparison for chapters/topics. */
function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Resolve a chapter name within a subject; null + issue on failure. */
function resolveChapter(
  row: number,
  subjectId: string | null,
  chapterName: string,
  index: ReferenceIndex,
): { chapterId: string | null; issues: ImportIssue[] } {
  if (!subjectId) return { chapterId: null, issues: [] };
  const name = chapterName.trim();
  if (!name) return { chapterId: null, issues: [] };

  const candidates = (index.chaptersBySubject.get(subjectId) ?? []).filter(
    (c) => normalizeName(c.name) === normalizeName(name),
  );

  if (candidates.length === 0) {
    return {
      chapterId: null,
      issues: [{
        row, column: 'Chapter', value: chapterName,
        problem: `Chapter "${chapterName}" was not found under this subject.`,
        suggestion: 'Create the chapter first, then re-import.',
        severity: 'error',
      }],
    };
  }
  if (candidates.length > 1) {
    return {
      chapterId: null,
      issues: [{
        row, column: 'Chapter', value: chapterName,
        problem: `Multiple chapters match "${chapterName}".`,
        suggestion: 'Rename the chapter to be unique, then re-import.',
        severity: 'error',
      }],
    };
  }
  return { chapterId: candidates[0].chapterId, issues: [] };
}

/** Resolve a topic name within a chapter; null + issue on failure. */
function resolveTopic(
  row: number,
  chapterId: string | null,
  topicName: string,
  index: ReferenceIndex,
): { topicId: string | null; issues: ImportIssue[] } {
  const name = topicName.trim();
  if (!name) return { topicId: null, issues: [] }; // chapter-only lesson
  if (!chapterId) return { topicId: null, issues: [] };

  const candidates = (index.topicsByChapter.get(chapterId) ?? []).filter(
    (t) => normalizeName(t.name) === normalizeName(name),
  );

  if (candidates.length === 0) {
    return {
      topicId: null,
      issues: [{
        row, column: 'Topic', value: topicName,
        problem: `Topic "${topicName}" does not belong to the selected chapter.`,
        suggestion: 'Select a topic under this chapter, or leave Topic blank for a chapter-only lesson.',
        severity: 'error',
      }],
    };
  }
  if (candidates.length > 1) {
    return {
      topicId: null,
      issues: [{
        row, column: 'Topic', value: topicName,
        problem: `Multiple topics match "${topicName}".`,
        suggestion: 'Rename the topic to be unique, then re-import.',
        severity: 'error',
      }],
    };
  }
  return { topicId: candidates[0].topicId, issues: [] };
}

/**
 * Normalize + validate ONE spreadsheet row against the reference index.
 * Never throws — every problem becomes a row-level issue.
 */
function normalizeRow(
  raw: RawSheetRow,
  index: ReferenceIndex,
): ImportedRow {
  const issues: ImportIssue[] = [];
  const { row } = raw;

  // ── Date ─────────────────────────────────────────────────────────────
  const date = parseSpreadsheetDate(raw.date);
  if (!date) {
    issues.push({
      row, column: 'Date', value: raw.date,
      problem: `"${String(raw.date ?? '')}" is not a valid date.`,
      suggestion: 'Use YYYY-MM-DD (e.g. 2026-08-10), DD-MMM-YY, or DD/MM/YYYY.',
      severity: 'error',
    });
  }

  // ── Times ────────────────────────────────────────────────────────────
  const startTime = parseSpreadsheetTime(raw.startTime);
  if (!startTime) {
    issues.push({
      row, column: 'Start Time', value: raw.startTime,
      problem: `"${String(raw.startTime ?? '')}" is not a valid start time.`,
      suggestion: 'Use 24-hour HH:MM (e.g. 10:00) or 12-hour "10:00 AM".',
      severity: 'error',
    });
  }
  const endTime = parseSpreadsheetTime(raw.endTime);
  if (!endTime) {
    issues.push({
      row, column: 'End Time', value: raw.endTime,
      problem: `"${String(raw.endTime ?? '')}" is not a valid end time.`,
      suggestion: 'Use 24-hour HH:MM (e.g. 11:00) or 12-hour "11:00 AM".',
      severity: 'error',
    });
  }
  if (startTime && endTime && endTime <= startTime) {
    issues.push({
      row, column: 'End Time', value: raw.endTime,
      problem: 'End time must be after start time.',
      suggestion: 'Fix the times so the class ends after it starts.',
      severity: 'error',
    });
  }

  // ── Teacher (mobile is the stable identifier; name/email never match) ──
  let teacherId: string | null = null;
  let teacherName: string | null = null;
  const mobileDigits = digitsOnly(raw.teacherMobile);
  if (!mobileDigits) {
    issues.push({
      row, column: 'Teacher Mobile', value: raw.teacherMobile,
      problem: 'Teacher Mobile is required.',
      suggestion: 'Fill in the teacher\'s registered mobile number.',
      severity: 'error',
    });
  } else {
    // Exact full-international match first; a 10-digit input may also resolve
    // via the India national key (stored 91 + 10-digit numbers only).
    let teacher = index.teacherByMobile.get(mobileDigits) ?? null;
    let ambiguous = index.duplicateMobileKeys.has(mobileDigits);
    if (!teacher && mobileDigits.length === 10) {
      teacher = index.teacherByNational10.get(mobileDigits) ?? null;
      ambiguous = index.duplicateNationalKeys.has(mobileDigits);
    }
    if (ambiguous) {
      issues.push({
        row, column: 'Teacher Mobile', value: raw.teacherMobile,
        problem: `Multiple teachers match mobile number ${raw.teacherMobile}. Please contact the administrator.`,
        severity: 'error',
      });
    } else if (!teacher) {
      issues.push({
        row, column: 'Teacher Mobile', value: raw.teacherMobile,
        problem: `Teacher with mobile number ${raw.teacherMobile} was not found in this institute.`,
        suggestion: 'Check the mobile number, or add the teacher first.',
        severity: 'error',
      });
    } else {
      teacherId = teacher.teacherId;
      teacherName = teacher.name;
    }
  }

  // ── Batch (code is the stable identifier) ────────────────────────────
  let batchId: string | null = null;
  const batchCode = raw.batchCode.trim().toUpperCase();
  if (!batchCode) {
    issues.push({
      row, column: 'Batch Code', value: raw.batchCode,
      problem: 'Batch Code is required.',
      suggestion: 'Fill in the batch code (e.g. JEE-A).',
      severity: 'error',
    });
  } else {
    const batch = index.batchByCode.get(batchCode);
    if (!batch) {
      issues.push({
        row, column: 'Batch Code', value: raw.batchCode,
        problem: `Batch with code "${raw.batchCode}" was not found in your institute.`,
        suggestion: 'Check the batch code, or create the batch first.',
        severity: 'error',
      });
    } else {
      batchId = batch.batchId;
      if (batch.status !== 'active') {
        issues.push({
          row, column: 'Batch Code', value: raw.batchCode,
          problem: `Batch "${raw.batchCode}" is ${batch.status} — classes may not be generated.`,
          severity: 'warning',
        });
      }
    }
  }

  // ── Subject → batch_subject (batch + stream scoped) ─────────────────
  let subjectId: string | null = null;
  let batchSubjectId: string | null = null;
  const subjectCode = raw.subjectCode.trim().toUpperCase();
  if (!subjectCode) {
    issues.push({
      row, column: 'Subject Code', value: raw.subjectCode,
      problem: 'Subject Code is required.',
      suggestion: 'Fill in the subject code (e.g. PHY).',
      severity: 'error',
    });
  } else if (batchId) {
    const batch = index.batchByCode.get(batchCode);
    const subject = batch
      ? index.subjectByStreamCode.get(`${batch.streamId}:${subjectCode}`)
      : undefined;
    if (!subject) {
      issues.push({
        row, column: 'Subject Code', value: raw.subjectCode,
        problem: `Subject with code "${raw.subjectCode}" was not found in this batch's stream.`,
        suggestion: 'Check the subject code, or add the subject to the batch\'s stream first.',
        severity: 'error',
      });
    } else {
      subjectId = subject.subjectId;
      const batchSubject = index.batchSubjectByKey.get(`${batchId}:${subjectId}`);
      if (!batchSubject) {
        issues.push({
          row, column: 'Subject Code', value: raw.subjectCode,
          problem: `Subject "${raw.subjectCode}" is not taught in batch "${raw.batchCode}".`,
          suggestion: 'Add this subject to the batch first (Batch Management).',
          severity: 'error',
        });
      } else {
        batchSubjectId = batchSubject.batchSubjectId;
      }
    }
  }

  // ── Teacher assignment (batch_subject_teachers — authoritative) ─────
  if (teacherId && batchSubjectId && !index.assignmentSet.has(`${batchSubjectId}:${teacherId}`)) {
    issues.push({
      row, column: 'Teacher Mobile', value: raw.teacherMobile,
      problem: `${raw.teacherMobile || teacherName} is not assigned to ${raw.batchCode} / ${raw.subjectCode}.`,
      suggestion: 'Assign the teacher to this batch-subject first (Batch Management).',
      severity: 'error',
    });
  }

  // ── Chapter → topic (optional) ───────────────────────────────────────
  const chapterResolved = resolveChapter(row, subjectId, raw.chapter, index);
  const topicResolved = resolveTopic(row, chapterResolved.chapterId, raw.topic, index);
  const chapterId = chapterResolved.chapterId;
  const topicId = topicResolved.topicId;

  return {
    row,
    date: date ?? '',
    teacherId,
    teacherMobile: mobileDigits,
    teacherName,
    batchId,
    batchCode,
    subjectId,
    subjectCode,
    batchSubjectId,
    startTime: startTime ?? '',
    endTime: endTime ?? '',
    chapterId,
    topicId,
    notes: raw.notes.trim() || null,
    groupValidFrom: '',
    groupValidUntil: '',
    duplicateOfRow: null,
    issues: [
      ...issues,
      ...chapterResolved.issues,
      ...topicResolved.issues,
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Grouping
// ═══════════════════════════════════════════════════════════════════════════

/** Deterministic slot key (matches the RPC payload contract — no indexes). */
function groupKey(teacherId: string, batchSubjectId: string, dayOfWeek: number, start: string, end: string): string {
  return `${teacherId}|${batchSubjectId}|${dayOfWeek}|${start}|${end}`;
}

/** True when a row has no blocking error issues. */
function rowHasErrors(row: ImportedRow): boolean {
  return row.issues.some((i) => i.severity === 'error');
}

/**
 * Classify a group against existing slots: create | reuse | extend.
 *
 * Mirrors migration 114: reuse requires an active/paused existing slot with
 * an IDENTICAL schedule and OVERLAPPING validity; validity is extended when
 * the import window is wider (never shrunk). Disjoint validity ⇒ new slot.
 *
 * Candidates are ordered by validFrom ascending — mirroring migration 114's
 * `order by t.valid_from asc limit 1` — so the preview's classification is
 * deterministic and matches what the RPC will pick when several slots share
 * the schedule.
 */
function classifyGroup(
  teacherId: string,
  batchSubjectId: string,
  dayOfWeek: number,
  start: string,
  end: string,
  validFrom: string,
  validUntil: string,
  index: ReferenceIndex,
): { mode: ImportGroup['mode']; existingSlotId: string | null } {
  const candidates = index.existingSlots
    .filter(
      (s) =>
        s.teacherId === teacherId &&
        s.batchSubjectId === batchSubjectId &&
        s.dayOfWeek === dayOfWeek &&
        s.startTime === start &&
        s.endTime === end &&
        (s.status === 'active' || s.status === 'paused') &&
        validityOverlap(validFrom, validUntil, s.validFrom, s.validUntil),
    )
    .sort((a, b) => (a.validFrom < b.validFrom ? -1 : a.validFrom > b.validFrom ? 1 : 0));
  const existing = candidates[0] ?? null;

  if (!existing) return { mode: 'create', existingSlotId: null };

  const needsExtend =
    validFrom < existing.validFrom || validUntil > existing.validUntil;
  return { mode: needsExtend ? 'extend' : 'reuse', existingSlotId: existing.timetableSlotId };
}

/** Advisory conflict check for a group against ACTIVE existing slots. */
function existingSlotConflict(
  teacherId: string,
  batchSubjectId: string,
  dayOfWeek: number,
  start: string,
  end: string,
  validFrom: string,
  validUntil: string,
  excludeSlotId: string | null,
  index: ReferenceIndex,
): { kind: 'teacher' | 'batch' | null; detail: string } {
  const batchId = index.batchIdByBatchSubject.get(batchSubjectId) ?? null;
  for (const slot of index.activeSlots) {
    if (slot.timetableSlotId === excludeSlotId) continue;
    if (slot.dayOfWeek !== dayOfWeek) continue;
    if (!timesOverlap(start, end, slot.startTime, slot.endTime)) continue;
    if (!validityOverlap(validFrom, validUntil, slot.validFrom, slot.validUntil)) continue;
    if (slot.teacherId === teacherId) {
      return { kind: 'teacher', detail: `Teacher already has a class on this day/time (valid ${slot.validFrom} → ${slot.validUntil}).` };
    }
    if (batchId && index.batchIdByBatchSubject.get(slot.batchSubjectId) === batchId) {
      return { kind: 'batch', detail: `Batch already has a class on this day/time (valid ${slot.validFrom} → ${slot.validUntil}).` };
    }
  }
  return { kind: null, detail: '' };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build the full import preview from parsed rows + reference data.
 *
 * Pure — no network, no database. Errors collected across ALL rows so the
 * admin can fix multiple problems at once. Any error ⇒ the file cannot be
 * imported (`buildImportPayload` returns null).
 *
 * @param input - `{ rows, reference }`.
 * @returns The complete `ImportPreview`.
 */
export function buildImportPreview(
  input: { rows: RawSheetRow[]; reference: ReferenceData },
): ImportPreview {
  const { rows: rawRows, reference } = input;
  const index = buildReferenceIndex(reference);
  const rows: ImportedRow[] = rawRows.map((r) => normalizeRow(r, index));
  const fileIssues: ImportIssue[] = [];

  // ── Dedupe identical rows; conflict on same slot+date with a different lesson ──
  // key = slot identity + occurrence date (chapter/topic/notes compared separately)
  const seen = new Map<string, ImportedRow>();
  const dedupedRows: ImportedRow[] = [];

  for (const row of rows) {
    if (rowHasErrors(row)) {
      dedupedRows.push(row);
      continue;
    }
    const identityKey = groupKey(
      row.teacherId!,
      row.batchSubjectId!,
      isoDowOf(row.date),
      row.startTime,
      row.endTime,
    );
    const occurrenceKey = `${identityKey}|${row.date}`;
    const lessonKey = `${occurrenceKey}|${row.chapterId ?? ''}|${row.topicId ?? ''}|${row.notes ?? ''}`;
    const prior = seen.get(occurrenceKey);

    if (prior) {
      // Same slot + same date: identical → silent dedupe; different → blocking.
      const priorLessonKey = `${occurrenceKey}|${prior.chapterId ?? ''}|${prior.topicId ?? ''}|${prior.notes ?? ''}`;
      if (priorLessonKey === lessonKey) {
        row.issues.push({
          row: row.row, column: null, value: null,
          problem: `Duplicate row — identical lesson for ${row.date} was already provided on row ${prior.row}.`,
          suggestion: 'Remove the duplicate row from the file.',
          severity: 'info',
        });
        row.duplicateOfRow = prior.row;
        dedupedRows.push(row);
      } else {
        row.issues.push({
          row: row.row, column: 'Chapter', value: row.chapterId ?? null,
          problem: `Conflicting duplicate: row ${prior.row} already defines a different lesson for ${row.date}.`,
          suggestion: 'Remove one of the conflicting rows.',
          severity: 'error',
        });
        dedupedRows.push(row);
      }
      continue;
    }
    seen.set(occurrenceKey, row);
    dedupedRows.push(row);
  }

  // ── Group valid rows into schedule groups ─────────────────────────────
  // Silent duplicates (duplicateOfRow set) never enter a group — the first
  // occurrence is the canonical row.
  const groupByKey = new Map<string, ImportedRow[]>();
  for (const row of dedupedRows) {
    if (rowHasErrors(row)) continue;
    if (row.duplicateOfRow !== null) continue;
    if (!row.teacherId || !row.batchSubjectId || !row.date || !row.startTime || !row.endTime) continue;
    const day = isoDowOf(row.date);
    const key = groupKey(row.teacherId, row.batchSubjectId, day, row.startTime, row.endTime);
    const list = groupByKey.get(key) ?? [];
    list.push(row);
    groupByKey.set(key, list);
  }

  // ── Explicit validity overrides (Valid From / Valid Until columns) ────
  // Group validity = min/max of explicit overrides when ANY row provides
  // them; otherwise min/max of the group's dates.
  const groups: ImportGroup[] = [];
  for (const [key, groupRows] of groupByKey) {
    const teacherId = groupRows[0].teacherId!;
    const batchSubjectId = groupRows[0].batchSubjectId!;
    const dayOfWeek = isoDowOf(groupRows[0].date);
    const start = groupRows[0].startTime;
    const end = groupRows[0].endTime;

    const dates = [...new Set(groupRows.map((r) => r.date))].sort();
    const rawValidFroms = rawRows
      .filter((r) => groupRows.some((gr) => gr.row === r.row))
      .map((r) => parseSpreadsheetDate(r.validFrom))
      .filter((d): d is string => d !== null);
    const rawValidUntils = rawRows
      .filter((r) => groupRows.some((gr) => gr.row === r.row))
      .map((r) => parseSpreadsheetDate(r.validUntil))
      .filter((d): d is string => d !== null);

    const hasExplicit = rawValidFroms.length > 0 || rawValidUntils.length > 0;
    let validFrom = hasExplicit && rawValidFroms.length > 0 ? rawValidFroms[0] : dates[0];
    let validUntil = hasExplicit && rawValidUntils.length > 0 ? rawValidUntils[0] : dates[dates.length - 1];
    for (const d of rawValidFroms) if (d < validFrom) validFrom = d;
    for (const d of rawValidUntils) if (d > validUntil) validUntil = d;

    if (!validFrom || !validUntil) continue;
    if (validFrom > validUntil) {
      for (const r of groupRows) {
        r.issues.push({
          row: r.row, column: null, value: { validFrom, validUntil },
          problem: 'Valid From must be on or before Valid Until.',
          severity: 'error',
        });
      }
      continue;
    }

    // Every lesson date must fall within the group's effective validity.
    for (const r of groupRows) {
      r.groupValidFrom = validFrom;
      r.groupValidUntil = validUntil;
      if (r.date < validFrom || r.date > validUntil) {
        r.issues.push({
          row: r.row, column: 'Date', value: r.date,
          problem: `Date ${r.date} is outside the timetable validity (${validFrom} → ${validUntil}).`,
          severity: 'error',
        });
      }
    }

    const validGroupRows = groupRows.filter((r) => !rowHasErrors(r));
    if (validGroupRows.length === 0) continue;

    const { mode, existingSlotId } = classifyGroup(
      teacherId, batchSubjectId, dayOfWeek, start, end, validFrom, validUntil, index,
    );

    // Holiday / teacher-leave warnings (non-blocking — materializer skips).
    for (const r of validGroupRows) {
      if (index.holidaysSet.has(r.date)) {
        r.issues.push({
          row: r.row, column: 'Date', value: r.date,
          problem: `${r.date} is an institute holiday — the class will not be generated.`,
          severity: 'warning',
        });
      }
      const leaves = index.leavesByTeacher.get(r.teacherId ?? '') ?? [];
      if (leaves.some((l) => r.date >= l.startDate && r.date <= l.endDate)) {
        r.issues.push({
          row: r.row, column: null, value: r.date,
          problem: `${r.date} falls inside an active teacher leave — the class will not be generated.`,
          severity: 'warning',
        });
      }
    }

    // Validity-gap info: weekdays within the validity window that have no
    // planned lesson (holidays/breaks are skipped by the materializer, but
    // the admin should know the window is wider than the planned dates).
    const allOccurrences = expandDateRange(validFrom, validUntil).filter(
      (d) => isoDowOf(d) === dayOfWeek,
    );
    const unplanned = allOccurrences.filter((d) => !dates.includes(d));
    if (unplanned.length > 0 && unplanned.length <= 30) {
      fileIssues.push({
        row: null, column: null, value: unplanned.length,
        problem: `Timetable validity ${validFrom} → ${validUntil} contains ${unplanned.length} weekday(s) with no lesson plan (e.g. ${unplanned.slice(0, 3).join(', ')}).`,
        severity: 'info',
      });
    }

    // Advisory conflict check against ACTIVE existing slots (create only —
    // reuse/extend already targets its own slot; the RPC re-checks itself).
    if (mode === 'create') {
      const conflict = existingSlotConflict(
        teacherId, batchSubjectId, dayOfWeek, start, end, validFrom, validUntil, existingSlotId, index,
      );
      if (conflict.kind) {
        fileIssues.push({
          row: null, column: null, value: `${rawRows.find((r) => r.row === groupRows[0].row)?.teacherMobile ?? ''} / ${groupRows[0].batchCode} / ${groupRows[0].subjectCode}`,
          problem: `${conflict.kind === 'teacher' ? 'Teacher' : 'Batch'} conflict with an existing timetable slot: ${conflict.detail}`,
          suggestion: 'Adjust the day/time or validity, or update the existing timetable first.',
          severity: 'error',
        });
      }
    }

    groups.push({
      key,
      teacherId,
      batchSubjectId,
      dayOfWeek,
      startTime: start,
      endTime: end,
      validFrom,
      validUntil,
      dates,
      lessonCount: validGroupRows.length,
      mode,
      existingSlotId,
    });

    if (mode !== 'create') {
      fileIssues.push({
        row: null, column: null, value: groups[groups.length - 1].key,
        problem: `Existing timetable slot will be ${mode === 'extend' ? 'extended and ' : ''}reused (${existingSlotId}).`,
        severity: 'info',
      });
    }
  }

  // ── Within-file conflicts (teacher / batch, same day, half-open time, overlapping validity) ──
  for (let i = 0; i < groups.length; i += 1) {
    for (let j = i + 1; j < groups.length; j += 1) {
      const a = groups[i];
      const b = groups[j];
      if (a.dayOfWeek !== b.dayOfWeek) continue;
      if (!timesOverlap(a.startTime, a.endTime, b.startTime, b.endTime)) continue;
      if (!validityOverlap(a.validFrom, a.validUntil, b.validFrom, b.validUntil)) continue;

      if (a.teacherId === b.teacherId) {
        fileIssues.push({
          row: null, column: null, value: `${a.key} vs ${b.key}`,
          problem: `Teacher conflict within the file: two schedules on the same day overlap in time and validity.`,
          suggestion: 'Move one of the overlapping schedules to a different day/time.',
          severity: 'error',
        });
      }
      const aBatch = index.batchIdByBatchSubject.get(a.batchSubjectId);
      const bBatch = index.batchIdByBatchSubject.get(b.batchSubjectId);
      if (aBatch && aBatch === bBatch) {
        fileIssues.push({
          row: null, column: null, value: `${a.key} vs ${b.key}`,
          problem: `Batch conflict within the file: two schedules for the same batch overlap on the same day/time.`,
          suggestion: 'Move one of the overlapping schedules to a different day/time.',
          severity: 'error',
        });
      }
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────
  const errorRows = dedupedRows.filter((r) => rowHasErrors(r)).length;
  const duplicateCount = dedupedRows.filter((r) => r.duplicateOfRow !== null).length;
  const warningCount = dedupedRows.reduce((n, r) => n + r.issues.filter((i) => i.severity === 'warning').length, 0)
    + fileIssues.filter((i) => i.severity === 'warning').length;

  let plansToCreate = 0;
  let plansToUpdate = 0;
  for (const group of groups) {
    const groupValidRows = dedupedRows.filter(
      (r) => !rowHasErrors(r) && r.duplicateOfRow === null &&
        r.teacherId === group.teacherId &&
        r.batchSubjectId === group.batchSubjectId &&
        isoDowOf(r.date) === group.dayOfWeek &&
        r.startTime === group.startTime &&
        r.endTime === group.endTime,
    );
    for (const r of groupValidRows) {
      // A plan updates when its slot+date already exists in the DB.
      const existingSlotId = group.existingSlotId;
      const exists = existingSlotId !== null && index.planKeySet.has(`${existingSlotId}:${r.date}`);
      if (exists) plansToUpdate += 1;
      else plansToCreate += 1;
    }
  }

  const summary: ImportSummary = {
    totalRows: rawRows.length,
    validRows: dedupedRows.length - errorRows,
    errorRows,
    warningCount,
    duplicateCount,
    slotsToCreate: groups.filter((g) => g.mode === 'create').length,
    slotsToReuse: groups.filter((g) => g.mode === 'reuse').length,
    slotsToExtend: groups.filter((g) => g.mode === 'extend').length,
    plansToCreate,
    plansToUpdate,
  };

  return { rows: dedupedRows, groups, issues: fileIssues, summary };
}

/** True when the preview contains any blocking error (row or file-level). */
export function hasBlockingErrors(preview: ImportPreview): boolean {
  if (preview.issues.some((i) => i.severity === 'error')) return true;
  return preview.rows.some((r) => r.issues.some((i) => i.severity === 'error'));
}

/**
 * Build the exact `bulk_import_timetable` payload (p_slots + p_plans).
 *
 * Only call when `hasBlockingErrors(preview)` is false. Returns null when
 * there is nothing to import.
 */
export function buildImportPayload(preview: ImportPreview): BulkImportPayload | null {
  if (hasBlockingErrors(preview)) return null;
  if (preview.groups.length === 0) return null;

  const slots: BulkSlotPayload[] = preview.groups.map((g) => ({
    key: g.key,
    teacher_id: g.teacherId,
    batch_subject_id: g.batchSubjectId,
    day_of_week: g.dayOfWeek,
    start_time: g.startTime,
    end_time: g.endTime,
    valid_from: g.validFrom,
    valid_until: g.validUntil,
  }));

  const plans: BulkPlanPayload[] = [];
  for (const row of preview.rows) {
    if (rowHasErrors(row)) continue;
    if (row.duplicateOfRow !== null) continue;
    if (!row.teacherId || !row.batchSubjectId || !row.date) continue;
    const group = preview.groups.find(
      (g) =>
        g.teacherId === row.teacherId &&
        g.batchSubjectId === row.batchSubjectId &&
        g.dayOfWeek === isoDowOf(row.date) &&
        g.startTime === row.startTime &&
        g.endTime === row.endTime,
    );
    if (!group) continue;
    plans.push({
      slot_key: group.key,
      occurrence_date: row.date,
      chapter_id: row.chapterId,
      topic_id: row.topicId,
      notes: row.notes,
    });
  }

  if (plans.length === 0) return null;
  return { slots, plans };
}
