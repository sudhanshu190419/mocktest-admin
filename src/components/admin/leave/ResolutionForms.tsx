'use client';

/**
 * Resolution Forms (Phase 2F)
 *
 * The five occurrence-level resolution forms hosted by `ResolutionDialog`:
 *
 *   - SubstituteTeacherForm  → resolve_class_with_substitute
 *   - RescheduleForm         → reschedule_class_occurrence
 *   - RecordedClassForm      → assign_recorded_class
 *   - MockTestForm           → assign_mock_test_to_class
 *   - CancelClassForm        → cancel_class_occurrence
 *
 * Each form is PURE DATA ENTRY: it only validates that the admin has filled
 * the required fields and emits a `ResolveClassInput` payload. Whether an
 * action is actually allowed (started classes, conflicts, availability,
 * institute scope) is decided exclusively by migration 115 — the forms never
 * pre-approve or block an action, they only require the fields the RPC needs.
 *
 * Picker hooks reused from the existing assignment flows:
 *   - substitute:   useBSTAvailableTeachers(instituteId)
 *   - recordings:   useRecordings({ batchSubjectId, status: 'completed' })
 *   - mock tests:   useBSAvailableMockTests(batchSubjectId, subjectId)
 *
 * @module components/admin/leave/ResolutionForms
 */

import { useEffect, useState } from 'react';
import {
  CircleNotch,
  PlayCircle,
  Exam,
  CalendarDots,
  UserSwitch,
  XCircle,
} from '@phosphor-icons/react';
import { useBSTAvailableTeachers } from '@/hooks/admin/useBatchSubjectTeacherAssignment';
import { useBSAvailableMockTests } from '@/hooks/admin/useBatchSubjectMockTestAssignment';
import { useRecordings } from '@/hooks/recording/useRecordings';
import { Select } from '@/components/ui/Select';
import type { LeaveOccurrence, ResolveClassInput } from '@/types/teacherLeave';

// ─── Shared ─────────────────────────────────────────────────────────────────

interface BaseFormProps {
  resolutionId: string;
  occurrence: LeaveOccurrence;
  /** Emit the current payload, or null while the form is incomplete. */
  onPayloadChange: (payload: ResolveClassInput | null) => void;
}

const inputCls =
  'w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100';

const labelCls =
  'mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400';

/** "HH:MM:SS" → "HH:MM" for <input type="time">. */
function toHHMM(time: string | null | undefined): string {
  return (time ?? '').slice(0, 5);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  );
}

function LoadingSelect({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="space-y-1">
      <p className={labelCls}>{label}</p>
      {children}
    </div>
  );
}

// ─── 1. Substitute Teacher ─────────────────────────────────────────────────

export function SubstituteTeacherForm({
  resolutionId,
  instituteId,
  onPayloadChange,
}: BaseFormProps & { instituteId: string }) {
  const { data: teachers = [], isLoading } = useBSTAvailableTeachers(instituteId);
  const [teacherId, setTeacherId] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!teacherId) {
      onPayloadChange(null);
      return;
    }
    onPayloadChange({
      action: 'substitute_teacher',
      resolutionId,
      teacherId,
      notes: notes.trim() || null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherId, notes]);

  const options = teachers.map((t) => ({
    value: t.teacherId,
    label: `${t.teacherName}${t.department ? ` — ${t.department}` : ''}`,
  }));

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Pick a substitute for this single occurrence. The system checks their availability,
        conflicts, and assignments.
      </p>
      {isLoading ? (
        <LoadingSelect label="Substitute teacher">
          <div className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-400 dark:border-gray-700">
            <CircleNotch size={15} className="animate-spin text-blue-600" />
            Loading teachers…
          </div>
        </LoadingSelect>
      ) : (
        <Select
          label="Substitute teacher"
          value={teacherId}
          onChange={setTeacherId}
          options={options}
          placeholder={options.length === 0 ? 'No teachers available' : 'Select a teacher'}
        />
      )}
      <Field label="Notes (optional)">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="Handover notes for the substitute…"
          className={`${inputCls} resize-none`}
        />
      </Field>
    </div>
  );
}

// ─── 2. Reschedule ─────────────────────────────────────────────────────────

export function RescheduleForm({
  resolutionId,
  occurrence,
  instituteId,
  onPayloadChange,
}: BaseFormProps & { instituteId: string }) {
  const { data: teachers = [], isLoading } = useBSTAvailableTeachers(instituteId);
  const [newDate, setNewDate] = useState(occurrence.occurrenceDate);
  const [newStart, setNewStart] = useState(toHHMM(occurrence.startTime));
  const [newEnd, setNewEnd] = useState(toHHMM(occurrence.endTime));
  const [newTeacherId, setNewTeacherId] = useState('');

  useEffect(() => {
    if (!newDate || !newStart || !newEnd) {
      onPayloadChange(null);
      return;
    }
    onPayloadChange({
      action: 'reschedule',
      resolutionId,
      newDate,
      newStart,
      newEnd,
      newTeacherId: newTeacherId || null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newDate, newStart, newEnd, newTeacherId]);

  const options = [
    { value: '', label: 'Keep the same teacher' },
    ...teachers.map((t) => ({
      value: t.teacherId,
      label: `${t.teacherName}${t.department ? ` — ${t.department}` : ''}`,
    })),
  ];

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Choose a new date/time for this occurrence. The system validates conflicts, holidays,
        and availability before applying.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="New date">
          <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Start time">
          <input type="time" value={newStart} onChange={(e) => setNewStart(e.target.value)} className={inputCls} />
        </Field>
        <Field label="End time">
          <input type="time" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} className={inputCls} />
        </Field>
      </div>
      {isLoading ? (
        <LoadingSelect label="Teacher">
          <div className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-400 dark:border-gray-700">
            <CircleNotch size={15} className="animate-spin text-blue-600" />
            Loading teachers…
          </div>
        </LoadingSelect>
      ) : (
        <Select
          label="Teacher"
          value={newTeacherId}
          onChange={setNewTeacherId}
          options={options}
        />
      )}
    </div>
  );
}

// ─── 3. Recorded Class ─────────────────────────────────────────────────────

export function RecordedClassForm({
  resolutionId,
  occurrence,
  onPayloadChange,
}: BaseFormProps) {
  const { data, isLoading } = useRecordings(
    { batchSubjectId: occurrence.batchSubjectId ?? undefined, status: 'completed' },
    undefined,
    { page: 1, pageSize: 50 },
  );
  // useRecordings returns ApiResponse<RecordingListResponse> (not unwrapped).
  const recordings = data?.data?.recordings ?? [];
  const [recordingId, setRecordingId] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!recordingId) {
      onPayloadChange(null);
      return;
    }
    onPayloadChange({
      action: 'recorded_class',
      resolutionId,
      recordingId,
      notes: notes.trim() || null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingId, notes]);

  const options = recordings.map((r) => ({
    value: r.recordingId,
    label: r.title,
  }));

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Replace the live class with an existing completed recording for this batch-subject.
      </p>
      {isLoading ? (
        <LoadingSelect label="Recording">
          <div className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-400 dark:border-gray-700">
            <CircleNotch size={15} className="animate-spin text-blue-600" />
            Loading recordings…
          </div>
        </LoadingSelect>
      ) : (
        <Select
          label="Recording"
          value={recordingId}
          onChange={setRecordingId}
          options={options}
          placeholder={options.length === 0 ? 'No completed recordings found' : 'Select a recording'}
        />
      )}
      <Field label="Notes (optional)">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="Optional note for students…"
          className={`${inputCls} resize-none`}
        />
      </Field>
    </div>
  );
}

// ─── 4. Mock Test ──────────────────────────────────────────────────────────

export function MockTestForm({ resolutionId, occurrence, onPayloadChange }: BaseFormProps) {
  const { data: tests = [], isLoading } = useBSAvailableMockTests(
    occurrence.batchSubjectId ?? '',
    occurrence.subjectId ?? '',
  );
  const [testId, setTestId] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!testId) {
      onPayloadChange(null);
      return;
    }
    onPayloadChange({
      action: 'mock_test',
      resolutionId,
      testId,
      notes: notes.trim() || null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testId, notes]);

  const options = tests.map((t) => ({
    value: t.testId,
    label: `${t.title} (${t.durationMin} min${t.totalMarks ? ` · ${t.totalMarks} marks` : ''})`,
  }));

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Assign a mock test to the batch instead of the live class. The system checks the test
        is published and compatible with the batch.
      </p>
      {isLoading ? (
        <LoadingSelect label="Mock test">
          <div className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-400 dark:border-gray-700">
            <CircleNotch size={15} className="animate-spin text-blue-600" />
            Loading mock tests…
          </div>
        </LoadingSelect>
      ) : (
        <Select
          label="Mock test"
          value={testId}
          onChange={setTestId}
          options={options}
          placeholder={options.length === 0 ? 'No available mock tests' : 'Select a mock test'}
        />
      )}
      <Field label="Notes (optional)">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="Optional note for students…"
          className={`${inputCls} resize-none`}
        />
      </Field>
    </div>
  );
}

// ─── 5. Cancel Class ───────────────────────────────────────────────────────

export function CancelClassForm({ resolutionId, onPayloadChange }: BaseFormProps) {
  const [reason, setReason] = useState('');

  useEffect(() => {
    onPayloadChange({
      action: 'cancelled',
      resolutionId,
      reason: reason.trim() || null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reason]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-rose-600 dark:text-rose-400">
        Cancel ONLY this occurrence. The recurring timetable rule and all future classes remain
        untouched.
      </p>
      <Field label="Reason (optional)">
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="Why is this class cancelled? Shown to students…"
          className={`${inputCls} resize-none`}
        />
      </Field>
    </div>
  );
}

// ─── Option metadata (shared with the dialog) ──────────────────────────────

export const RESOLUTION_OPTIONS: {
  action: 'substitute_teacher' | 'reschedule' | 'recorded_class' | 'mock_test' | 'cancelled';
  label: string;
  description: string;
  icon: React.ReactNode;
}[] = [
  {
    action: 'substitute_teacher',
    label: 'Substitute Teacher',
    description: 'Assign another teacher for this class',
    icon: <UserSwitch size={18} />,
  },
  {
    action: 'reschedule',
    label: 'Reschedule Class',
    description: 'Move to a new date or time',
    icon: <CalendarDots size={18} />,
  },
  {
    action: 'recorded_class',
    label: 'Recorded Class',
    description: 'Replace with an existing recording',
    icon: <PlayCircle size={18} />,
  },
  {
    action: 'mock_test',
    label: 'Assign Mock Test',
    description: 'Give the batch a mock test instead',
    icon: <Exam size={18} />,
  },
  {
    action: 'cancelled',
    label: 'Cancel Class',
    description: 'Cancel this occurrence only',
    icon: <XCircle size={18} />,
  },
];

