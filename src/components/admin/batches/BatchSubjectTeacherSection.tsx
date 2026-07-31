'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import {
  useBatchSubjectTeacherSummary,
  useBSTAvailableTeachers,
  useBSTAssignTeacher,
  useBSTRemoveTeacher,
} from '@/hooks/admin/useBatchSubjectTeacherAssignment';
import { SearchBar } from '@/components/ui/SearchBar';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  UserPlus,
  BookOpen,
  FileText,
  PencilSimpleLine,
  CheckCircle,
  XCircle,
} from '@phosphor-icons/react';

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Props
// ═══════════════════════════════════════════════════════════════════════════

interface BatchSubjectTeacherSectionProps {
  batchId: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════════════════

export default function BatchSubjectTeacherSection({
  batchId,
}: BatchSubjectTeacherSectionProps) {
  const { instituteId } = useAuth();

  // ── State ───────────────────────────────────────────────────────────
  const [selectedSubject, setSelectedSubject] = useState<{
    batchSubjectId: string;
    subjectName: string;
  } | null>(null);

  const [teacherSearch, setTeacherSearch] = useState('');
  const [debouncedTeacherSearch, setDebouncedTeacherSearch] = useState('');
  const searchRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [confirmAction, setConfirmAction] = useState<{
    type: 'assign' | 'remove';
    batchSubjectId: string;
    subjectName: string;
    teacherId: string;
    teacherName: string;
  } | null>(null);

  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const clearFeedback = useCallback(() => {
    if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    feedbackTimeoutRef.current = setTimeout(() => setFeedback(null), 4000);
  }, []);

  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => setDebouncedTeacherSearch(teacherSearch), 400);
    return () => {
      if (searchRef.current) clearTimeout(searchRef.current);
    };
  }, [teacherSearch]);

  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    };
  }, []);

  // ── Queries ─────────────────────────────────────────────────────────
  const {
    data: batchSubjects,
    isLoading: subjectsLoading,
  } = useBatchSubjectTeacherSummary(batchId, instituteId ?? undefined);

  const {
    data: availableTeachers,
    isLoading: teachersLoading,
  } = useBSTAvailableTeachers(instituteId ?? '', debouncedTeacherSearch || undefined);

  // ── Mutations ───────────────────────────────────────────────────────
  const assignMutation = useBSTAssignTeacher(batchId);
  const removeMutation = useBSTRemoveTeacher(batchId);

  // ── Handlers ────────────────────────────────────────────────────────
  const handleAssignTeacher = async () => {
    if (!confirmAction) return;

    const result = await assignMutation.mutateAsync({
      batchSubjectId: confirmAction.batchSubjectId,
      teacherId: confirmAction.teacherId,
    });

    if (result.success) {
      setFeedback({
        type: 'success',
        message: `"${confirmAction.teacherName}" assigned to ${confirmAction.subjectName}.`,
      });
    } else {
      setFeedback({
        type: 'error',
        message: result.error ?? 'Failed to assign teacher.',
      });
    }
    setConfirmAction(null);
    clearFeedback();
  };

  const handleRemoveTeacher = async () => {
    if (!confirmAction) return;

    const result = await removeMutation.mutateAsync({
      batchSubjectId: confirmAction.batchSubjectId,
      teacherId: confirmAction.teacherId,
    });

    if (result.success) {
      setFeedback({
        type: 'success',
        message: `"${confirmAction.teacherName}" removed from ${confirmAction.subjectName}.`,
      });
    } else {
      setFeedback({
        type: 'error',
        message: result.error ?? 'Failed to remove teacher.',
      });
    }
    setConfirmAction(null);
    clearFeedback();
  };

  const handleConfirm = async () => {
    if (!confirmAction) return;
    if (confirmAction.type === 'assign') {
      await handleAssignTeacher();
    } else {
      await handleRemoveTeacher();
    }
  };

  const getConfirmDialogProps = () => {
    if (!confirmAction) {
      return { open: false, title: '', message: '', confirmLabel: '', variant: 'default' as const };
    }
    if (confirmAction.type === 'assign') {
      return {
        open: true,
        title: 'Assign Teacher',
        message: `Assign "${confirmAction.teacherName}" to ${confirmAction.subjectName}?`,
        confirmLabel: 'Assign',
        variant: 'default' as const,
      };
    }
    return {
      open: true,
      title: 'Remove Teacher',
      message: `Remove "${confirmAction.teacherName}" from ${confirmAction.subjectName}? The teacher will no longer have access to this subject.`,
      confirmLabel: 'Remove',
      variant: 'danger' as const,
    };
  };

  const confirmProps = getConfirmDialogProps();
  const isConfirmLoading =
    (confirmAction?.type === 'assign' && assignMutation.isPending) ||
    (confirmAction?.type === 'remove' && removeMutation.isPending);

  // ── Render: Loading ──────────────────────────────────────────────────
  if (subjectsLoading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
        <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
          Batch Subjects
        </h3>
        <p className="mb-4 text-xs text-gray-500">Manage subject resources, mock tests, and teachers</p>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </div>
    );
  }

  // ── Render: Main ─────────────────────────────────────────────────────
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
            Batch Subjects
          </h3>
          <p className="text-xs text-gray-500">
            Manage content, mock tests, and teachers for each subject
          </p>
        </div>
        <Link
          href={`/admin/batches/${batchId}/subjects`}
          className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          <BookOpen size={14} />
          Manage Subjects
        </Link>
      </div>

      {/* Feedback Toast */}
      {feedback && (
        <div
          className={`mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${
            feedback.type === 'success'
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
              : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle size={14} weight="fill" />
          ) : (
            <XCircle size={14} weight="fill" />
          )}
          {feedback.message}
        </div>
      )}

      {/* Subject Cards */}
      {!batchSubjects || batchSubjects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center dark:border-gray-700">
          <BookOpen size={28} className="mx-auto mb-2 text-gray-300 dark:text-gray-600" />
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            No subjects assigned to this batch yet
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            Add subjects first, then manage content, mock tests, and teachers
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {batchSubjects.map((subject) => (
            <div
              key={subject.batchSubjectId}
              className="rounded-lg border border-gray-100 bg-gray-50/50 p-3 dark:border-gray-700 dark:bg-gray-800/20"
            >
              {/* Subject Header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-blue-500 to-indigo-600 text-[9px] font-bold text-white">
                    {getInitials(subject.subjectName)}
                  </div>
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {subject.subjectName}
                  </span>
                </div>

                {/* Action Buttons Row */}
                <div className="flex items-center gap-1.5">
                  {/* Content */}
                  <Link
                    href={`/admin/batches/${batchId}/subjects/${subject.batchSubjectId}/content`}
                    className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-emerald-600 transition-colors hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
                  >
                    <FileText size={14} />
                    Content
                  </Link>

                  {/* Mock Tests */}
                  <Link
                    href={`/admin/batches/${batchId}/subjects/${subject.batchSubjectId}/mock-tests`}
                    className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-amber-600 transition-colors hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20"
                  >
                    <PencilSimpleLine size={14} />
                    Mock Tests
                  </Link>

                  {/* Assign Teacher toggle */}
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedSubject(
                        selectedSubject?.batchSubjectId === subject.batchSubjectId
                          ? null
                          : {
                              batchSubjectId: subject.batchSubjectId,
                              subjectName: subject.subjectName,
                            },
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
                  >
                    <UserPlus size={14} />
                    {selectedSubject?.batchSubjectId === subject.batchSubjectId
                      ? 'Done'
                      : 'Teachers'}
                  </button>
                </div>
              </div>

              {/* Assigned Teachers */}
              {subject.teachers.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {subject.teachers.map((teacher) => (
                    <div
                      key={teacher.assignmentId}
                      className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-gray-700 shadow-sm ring-1 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700"
                    >
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-pink-600 text-[8px] font-bold text-white">
                        {getInitials(teacher.teacherName)}
                      </div>
                      <span>{teacher.teacherName}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmAction({
                            type: 'remove',
                            batchSubjectId: subject.batchSubjectId,
                            subjectName: subject.subjectName,
                            teacherId: teacher.teacherId,
                            teacherName: teacher.teacherName,
                          })
                        }
                        disabled={removeMutation.isPending}
                        className="ml-0.5 rounded-full p-0.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                      >
                        <XCircle size={12} weight="fill" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 italic">
                  No teachers assigned yet
                </p>
              )}

              {/* Assign Teacher Panel (shown when "Teachers" is clicked) */}
              {selectedSubject?.batchSubjectId === subject.batchSubjectId && (
                <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-700">
                  <div className="mb-2">
                    <SearchBar
                      placeholder="Search teachers by name..."
                      value={teacherSearch}
                      onChange={setTeacherSearch}
                    />
                  </div>
                  {teachersLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                    </div>
                  ) : !availableTeachers || availableTeachers.length === 0 ? (
                    <p className="py-2 text-center text-xs text-gray-400">
                      {debouncedTeacherSearch
                        ? 'No teachers match your search'
                        : 'No teachers available for assignment'}
                    </p>
                  ) : (
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {availableTeachers.map((teacher) => {
                        const alreadyAssigned = subject.teachers.some(
                          (t) => t.teacherId === teacher.teacherId,
                        );
                        return (
                          <div
                            key={teacher.teacherId}
                            className={`flex items-center justify-between rounded-md px-3 py-1.5 text-xs ${
                              alreadyAssigned
                                ? 'bg-gray-50 text-gray-400 dark:bg-gray-800/10'
                                : 'hover:bg-gray-50 dark:hover:bg-gray-800/20'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gray-400 to-gray-500 text-[7px] font-bold text-white">
                                {getInitials(teacher.teacherName)}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate font-medium text-gray-700 dark:text-gray-300">
                                  {teacher.teacherName}
                                </p>
                                {teacher.department && (
                                  <p className="truncate text-[10px] text-gray-400">
                                    {teacher.department}
                                    {teacher.designation ? ` · ${teacher.designation}` : ''}
                                  </p>
                                )}
                              </div>
                            </div>
                            {alreadyAssigned ? (
                              <span className="shrink-0 rounded bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800">
                                Assigned
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmAction({
                                    type: 'assign',
                                    batchSubjectId: subject.batchSubjectId,
                                    subjectName: subject.subjectName,
                                    teacherId: teacher.teacherId,
                                    teacherName: teacher.teacherName,
                                  })
                                }
                                disabled={assignMutation.isPending}
                                className="shrink-0 inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-[10px] font-medium text-blue-600 transition-colors hover:bg-blue-100 disabled:opacity-50 dark:bg-blue-900/20 dark:text-blue-400"
                              >
                                <UserPlus size={10} />
                                Assign
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={confirmProps.open}
        title={confirmProps.title}
        message={confirmProps.message}
        confirmLabel={confirmProps.confirmLabel}
        variant={confirmProps.variant}
        onConfirm={handleConfirm}
        onClose={() => setConfirmAction(null)}
        loading={isConfirmLoading}
      />
    </div>
  );
}
