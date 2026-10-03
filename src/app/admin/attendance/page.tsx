'use client';

/**
 * Admin Attendance Dashboard
 *
 * Institute-wide read-only attendance analytics with 4 tabs:
 *   1. Batch Attendance
 *   2. Teacher Attendance
 *   3. Student Attendance (search)
 *   4. Live Class Attendance
 *
 * Export: CSV, Excel, PDF (admin-only)
 *
 * @module app/admin/attendance/page
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  useAdminAttendanceSummary,
  useAdminAttendanceBatches,
  useAdminAttendanceTeachers,
  useAdminBatchAttendance,
  useAdminTeacherAttendance,
  useAdminTeacherBatches,
  useAdminTeacherBatchClasses,
  useAdminLiveClassAttendance,
  useClassAttendance,
} from '@/hooks/admin/useAttendanceAnalytics';
import { useAuth } from '@/context/AuthContext';
import { attendanceAnalyticsService } from '@/services/attendanceAnalyticsService';
import { liveClassAttendanceService } from '@/services/liveClassAttendanceService';
import type {
  AdminAttendanceSummary,
  BatchAttendanceSummary,
  AdminTeacherAttendanceRow,
  AdminStudentAttendanceDetail,
  LiveClassAttendanceSummary,
  AdminLiveClassAttendanceItem,
} from '@/services/attendanceAnalyticsService';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/LoadingSkeleton';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

type AdminTab = 'batch' | 'teacher' | 'student' | 'live-class';
type AttendanceStatusFilter = 'all' | 'present' | 'partial' | 'absent';

// ═══════════════════════════════════════════════════════════════════════════
// Shared Sub-Components
// ═══════════════════════════════════════════════════════════════════════════

function SummaryCard({
  label,
  value,
  subtext,
  color,
}: {
  label: string;
  value: string | number;
  subtext?: string;
  color: 'blue' | 'emerald' | 'amber' | 'purple' | 'rose' | 'cyan';
}) {
  const colors: Record<string, string> = {
    blue: 'text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-400',
    emerald: 'text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-400',
    amber: 'text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-400',
    purple: 'text-purple-600 bg-purple-50 border-purple-200 dark:bg-purple-900/20 dark:border-purple-800 dark:text-purple-400',
    rose: 'text-rose-600 bg-rose-50 border-rose-200 dark:bg-rose-900/20 dark:border-rose-800 dark:text-rose-400',
    cyan: 'text-cyan-600 bg-cyan-50 border-cyan-200 dark:bg-cyan-900/20 dark:border-cyan-800 dark:text-cyan-400',
  };

  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <p className="text-[11px] font-medium uppercase tracking-wider opacity-70">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {subtext && <p className="mt-0.5 text-xs opacity-60">{subtext}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    present: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800',
    partial: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800',
    absent: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-400 dark:border-rose-800',
    excused: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700',
  };

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${colors[status] ?? colors.absent}`}>
      {status}
    </span>
  );
}

/**
 * Format the scheduled live-class time range, e.g. "10:30 AM – 11:30 AM".
 *
 * Source: live_classes.scheduled_at (+ duration_min for the end time).
 * Returns "—" for an invalid date; start time only when duration is missing.
 * (Same en-IN / hour12 convention as the Teacher Attendance implementation.)
 */
function formatClassTimeRange(dateIso: string, durationMin?: number | null): string {
  const start = new Date(dateIso);
  if (Number.isNaN(start.getTime())) return '—';

  const fmt = (d: Date) =>
    d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

  if (typeof durationMin !== 'number' || !Number.isFinite(durationMin) || durationMin <= 0) {
    return fmt(start);
  }

  const end = new Date(start.getTime() + durationMin * 60_000);
  if (Number.isNaN(end.getTime())) return fmt(start);

  return `${fmt(start)} – ${fmt(end)}`;
}

function PercentBar({ percent }: { percent: number }) {
  const color = percent >= 75 ? 'bg-emerald-500' : percent >= 25 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
      <span className="text-xs font-semibold tabular-nums">{percent}%</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Admin Attendance Sheet Modal
// ═══════════════════════════════════════════════════════════════════════════

function AdminAttendanceSheet({
  classId,
  className,
  onClose,
}: {
  classId: string;
  className: string;
  onClose: () => void;
}) {
  const { data: records, isLoading: loading } = useClassAttendance(classId);

  const entries = useMemo(() => {
    return (records ?? []).map((r) => ({
      studentName: r.studentName ?? 'Unknown',
      status: r.attendanceStatus,
      duration: r.durationSeconds > 60
        ? `${Math.round(r.durationSeconds / 60)}m`
        : `${r.durationSeconds}s`,
    }));
  }, [records]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-gray-950 border border-gray-200 dark:border-gray-800">
        <div className="sticky top-0 flex items-center justify-between border-b border-gray-200 bg-white/90 backdrop-blur-sm px-6 py-4 dark:border-gray-800 dark:bg-gray-950/90">
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Attendance Sheet</h3>
            <p className="text-xs text-gray-500">{className}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-6">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No records found.</p>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center gap-3 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                <span className="flex-1">Student</span>
                <span className="w-20 text-center">Status</span>
                <span className="w-16 text-right">Duration</span>
              </div>
              {entries.map((e, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/30">
                  <span className="flex-1 text-xs font-medium text-gray-900 dark:text-gray-100">{e.studentName}</span>
                  <div className="w-20 text-center"><StatusBadge status={e.status} /></div>
                  <span className="w-16 text-right text-xs tabular-nums text-gray-600 dark:text-gray-400">{e.duration}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Export Helpers
// ═══════════════════════════════════════════════════════════════════════════

function downloadCSV(filename: string, headers: string[], rows: string[][]) {
  const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Admin Attendance Page
// ═══════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════════
// Teacher Drilldown Panel: Teacher → Batch List → Classes (Lazy Scalable UX)
// ═══════════════════════════════════════════════════════════════════════════════

function TeacherDrilldownPanel({
  instituteId,
  teacherId,
  teacherName,
  dateFrom,
  dateTo,
  onOpenSheet,
}: {
  instituteId: string;
  teacherId: string;
  teacherName: string;
  dateFrom?: string;
  dateTo?: string;
  onOpenSheet: (classId: string, className: string) => void;
}) {
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [selectedBatchName, setSelectedBatchName] = useState<string | null>(null);
  const [page, setPage] = useState<number>(1);
  const pageSize = 10;

  // Level 2: Fetch batches for teacher
  const { data: batches = [], isLoading: batchesLoading } = useAdminTeacherBatches(
    instituteId,
    teacherId,
    { dateFrom, dateTo },
    { enabled: Boolean(instituteId && teacherId) },
  );

  // Level 3: Fetch classes for selected batch (lazy)
  const { data: classesResult, isLoading: classesLoading } = useAdminTeacherBatchClasses(
    instituteId,
    teacherId,
    selectedBatchId,
    { dateFrom, dateTo, page, pageSize },
    { enabled: Boolean(instituteId && teacherId && selectedBatchId) },
  );

  const classes = classesResult?.classes ?? [];
  const total = classesResult?.total ?? 0;
  const totalPages = classesResult?.totalPages ?? 1;

  return (
    <div className="rounded-xl border border-gray-200/80 bg-white p-4 shadow-xs dark:border-gray-800 dark:bg-gray-900">
      {/* Level 2: Batch List */}
      {!selectedBatchId ? (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-gray-800 dark:text-gray-200">
                Batches Assigned to {teacherName}
              </span>
              <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-semibold text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
                {batches.length} {batches.length === 1 ? 'Batch' : 'Batches'}
              </span>
            </div>
            <span className="text-[11px] text-gray-400">
              Click a batch to view its class-level attendance
            </span>
          </div>

          {batchesLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-20 animate-pulse rounded-xl border border-gray-100 bg-gray-50/70 p-3 dark:border-gray-800 dark:bg-gray-800/40" />
              ))}
            </div>
          ) : batches.length === 0 ? (
            <p className="py-4 text-center text-xs text-gray-400">
              No batches or classes found for this teacher in the selected date range.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {batches.map((b) => (
                <div
                  key={b.batchId}
                  onClick={() => {
                    setSelectedBatchId(b.batchId);
                    setSelectedBatchName(b.batchName);
                    setPage(1);
                  }}
                  className="group cursor-pointer rounded-xl border border-gray-200 bg-white p-3.5 shadow-2xs transition-all hover:border-primary-400 hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-primary-600"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h5 className="text-xs font-bold text-gray-900 group-hover:text-primary-600 dark:text-gray-100 dark:group-hover:text-primary-400">
                        {b.batchName}
                      </h5>
                      <p className="mt-0.5 text-[11px] text-gray-500">
                        {b.classesAssigned} {b.classesAssigned === 1 ? 'class' : 'classes'} assigned
                      </p>
                    </div>
                    <span className="text-gray-400 group-hover:translate-x-0.5 group-hover:text-primary-600 transition-transform text-xs font-bold">
                      →
                    </span>
                  </div>
                  <div className="mt-2.5 flex items-center gap-2 pt-2 border-t border-gray-100 dark:border-gray-800/60 text-[10px]">
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      {b.classesTaken} Taken
                    </span>
                    <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                      {b.classesNotTaken} Not Taken
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Level 3: Classes for Selected Batch */
        <div>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <button
                onClick={() => {
                  setSelectedBatchId(null);
                  setSelectedBatchName(null);
                  setPage(1);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 shadow-2xs hover:bg-gray-50 hover:text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
                Back to Batches
              </button>
              <span className="text-gray-300 dark:text-gray-700">|</span>
              <span className="text-xs font-bold text-gray-900 dark:text-gray-100">
                {selectedBatchName}
              </span>
              <span className="text-[11px] text-gray-400">
                ({total} {total === 1 ? 'class' : 'classes'} total)
              </span>
            </div>
          </div>

          {classesLoading ? (
            <div className="space-y-2 py-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-9 animate-pulse rounded-lg bg-gray-100/70 dark:bg-gray-800/40" />
              ))}
            </div>
          ) : classes.length === 0 ? (
            <p className="py-4 text-center text-xs text-gray-400">
              No classes found for this batch in the selected date range.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 text-[11px] font-semibold text-gray-400 dark:border-gray-800">
                      <th className="pb-2 pr-4">Class / Lecture Name</th>
                      <th className="pb-2 pr-4">Date & Time</th>
                      <th className="pb-2 pr-4">Status</th>
                      <th className="pb-2 pr-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-800/60">
                    {classes.map((cls) => (
                      <tr
                        key={cls.classId}
                        className="hover:bg-gray-50/40 dark:hover:bg-gray-800/20"
                      >
                        <td className="py-2.5 pr-4 font-medium text-gray-900 dark:text-gray-100">
                          {cls.title}
                        </td>
                        <td className="py-2.5 pr-4 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                          <div>
                            {new Date(cls.scheduledAt).toLocaleDateString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </div>
                          <div className="text-[11px] text-gray-400">
                            {formatClassTimeRange(cls.scheduledAt, cls.durationMin)}
                          </div>
                        </td>
                        <td className="py-2.5 pr-4 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                              cls.status === 'Taken'
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                cls.status === 'Taken' ? 'bg-emerald-500' : 'bg-gray-400'
                              }`}
                            />
                            {cls.status}
                          </span>
                        </td>
                        <td className="py-2.5 pr-2 text-right whitespace-nowrap">
                          {cls.status === 'Taken' ? (
                            <button
                              onClick={() => onOpenSheet(cls.classId, cls.title)}
                              className="rounded-md border border-primary-200 bg-primary-50 px-2 py-1 text-[11px] font-semibold text-primary-700 hover:bg-primary-100 dark:border-primary-800 dark:bg-primary-900/30 dark:text-primary-300 dark:hover:bg-primary-900/50"
                            >
                              View Sheet
                            </button>
                          ) : (
                            <span className="text-[11px] text-gray-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-2.5 dark:border-gray-800">
                  <span className="text-[11px] text-gray-500">
                    Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total} classes
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="rounded-md border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      Previous
                    </button>
                    <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-400">
                      Page {page} of {totalPages}
                    </span>
                    <button
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      className="rounded-md border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminAttendancePage() {
  const { instituteId } = useAuth();

  // ── State ────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<AdminTab>('batch');

  // Filters
  const [filterBatch, setFilterBatch] = useState('');
  const [filterTeacher, setFilterTeacher] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterStatus, setFilterStatus] = useState<AttendanceStatusFilter>('all');

  // Tab 3: Student search state
  const [studentSearch, setStudentSearch] = useState('');
  const [studentResults, setStudentResults] = useState<AdminStudentAttendanceDetail[]>([]);

  // Tab 4: Live Class pagination & search state
  const [liveClassPage, setLiveClassPage] = useState(1);
  const [liveClassPageSize, setLiveClassPageSize] = useState(10);
  const [liveClassSearch, setLiveClassSearch] = useState('');

  // Modals
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [selectedClassName, setSelectedClassName] = useState('');
  // Tab 2: Expanded teacher rows state
  const [expandedTeacherIds, setExpandedTeacherIds] = useState<Set<string>>(new Set());

  const toggleTeacherExpand = useCallback((teacherId: string) => {
    setExpandedTeacherIds((prev) => {
      const next = new Set(prev);
      if (next.has(teacherId)) {
        next.delete(teacherId);
      } else {
        next.add(teacherId);
      }
      return next;
    });
  }, []);

  // ── React Query Cached Data ──────────────────────────────────────────
  const { data: summary, isLoading: summaryLoading } = useAdminAttendanceSummary(instituteId);
  const loading = summaryLoading;

  const { data: batchesData } = useAdminAttendanceBatches(instituteId);
  const batches = useMemo(() => batchesData ?? [], [batchesData]);

  const { data: teachersData } = useAdminAttendanceTeachers(instituteId);
  const teachers = useMemo(() => teachersData ?? [], [teachersData]);

  const { data: batchAttendanceData } = useAdminBatchAttendance(
    instituteId,
    {
      dateFrom: filterDateFrom || undefined,
      dateTo: filterDateTo || undefined,
      teacherId: filterTeacher || undefined,
      batchId: filterBatch || undefined,
    },
    { enabled: activeTab === 'batch' },
  );
  const batchAttendance = useMemo(() => batchAttendanceData ?? [], [batchAttendanceData]);

  const { data: teacherAttendanceData } = useAdminTeacherAttendance(
    instituteId,
    {
      dateFrom: filterDateFrom || undefined,
      dateTo: filterDateTo || undefined,
    },
    { enabled: activeTab === 'teacher' },
  );
  const teacherAttendance = useMemo(() => teacherAttendanceData ?? [], [teacherAttendanceData]);

  const { data: liveClassAttendanceData, isLoading: liveClassLoading } = useAdminLiveClassAttendance(
    instituteId,
    {
      dateFrom: filterDateFrom || undefined,
      dateTo: filterDateTo || undefined,
      teacherId: filterTeacher || undefined,
      batchId: filterBatch || undefined,
      search: liveClassSearch.trim() || undefined,
      page: liveClassPage,
      pageSize: liveClassPageSize,
    },
    { enabled: activeTab === 'live-class' },
  );
  const liveClassAttendance = useMemo(() => liveClassAttendanceData?.classes ?? [], [liveClassAttendanceData]);
  const liveClassTotal = liveClassAttendanceData?.total ?? 0;
  const liveClassTotalPages = liveClassAttendanceData?.totalPages ?? 0;

  // ── On-demand Student Search (Tab 3) ─────────────────────────────────
  const fetchStudentAttendance = useCallback(async () => {
    if (!instituteId || !studentSearch.trim()) return;
    const data = await attendanceAnalyticsService.getAdminStudentAttendance(instituteId, studentSearch.trim());
    setStudentResults(data);
  }, [instituteId, studentSearch]);

  // ── Export Handlers ─────────────────────────────────────────────────

  const handleExportCSV = useCallback(() => {
    if (activeTab === 'batch') {
      const headers = ['Batch Name', 'Students', 'Avg Attendance %', 'Present', 'Partial', 'Absent'];
      const rows = batchAttendance.map((b) => [
        b.batchName,
        String(b.studentCount),
        `${b.averageAttendancePercent}%`,
        String(b.presentCount),
        String(b.partialCount),
        String(b.absentCount),
      ]);
      downloadCSV('batch-attendance', headers, rows);
    } else if (activeTab === 'teacher') {
      const headers = ['Teacher', 'Batches', 'Classes Assigned', 'Classes Taken', 'Avg Attendance %'];
      const rows = teacherAttendance.map((t) => [
        t.teacherName,
        String(t.batchCount),
        String(t.classesAssigned),
        String(t.classesTaken),
        `${t.averageAttendancePercent}%`,
      ]);
      downloadCSV('teacher-attendance', headers, rows);
    } else if (activeTab === 'live-class') {
      const headers = ['Date', 'Time', 'Teacher', 'Batch', 'Present', 'Partial', 'Absent'];
      const rows = liveClassAttendance.map((c: AdminLiveClassAttendanceItem) => [
        new Date(c.date).toLocaleDateString('en-IN'),
        formatClassTimeRange(c.date, c.durationMin),
        c.teacherName,
        c.batchName,
        String(c.presentCount),
        String(c.partialCount),
        String(c.absentCount),
      ]);
      downloadCSV('live-class-attendance', headers, rows);
    }
  }, [activeTab, batchAttendance, teacherAttendance, liveClassAttendance]);

  // ── Render ──────────────────────────────────────────────────────────

  if (!instituteId) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-gray-400">Please log in as admin.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance Management"
        description="Institute-wide attendance overview and analytics."
      />

      {/* ── Summary Cards ── */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
              <Skeleton className="mb-2 h-3 w-20" />
              <Skeleton className="h-7 w-16" />
            </div>
          ))}
        </div>
      ) : summary ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard label="Total Students" value={summary.totalStudents} color="blue" />
          <SummaryCard label="Total Live Classes" value={summary.totalLiveClasses} color="emerald" />
          <SummaryCard label="Overall Attendance" value={`${summary.overallAttendancePercent}%`} color="amber" />
          <SummaryCard
            label="Below Threshold"
            value={summary.studentsBelowThreshold}
            subtext={`< ${75}% attendance`}
            color={summary.studentsBelowThreshold > 0 ? 'rose' : 'cyan'}
          />
        </div>
      ) : null}

      {/* ── Tabs ── */}
      <div className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white p-1 dark:border-gray-700 dark:bg-gray-900">
        {([
          { key: 'batch' as AdminTab, label: 'Batch Attendance' },
          { key: 'teacher' as AdminTab, label: 'Teacher Attendance' },
          { key: 'student' as AdminTab, label: 'Student Attendance' },
          { key: 'live-class' as AdminTab, label: 'Live Class Attendance' },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 rounded-lg px-4 py-2 text-xs font-semibold transition-all ${
              activeTab === tab.key
                ? 'bg-amber-500 text-white shadow-sm'
                : 'text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Filters Row (conditional per tab) ── */}
      {activeTab !== 'student' && (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          {activeTab !== 'teacher' && (
            <div className="min-w-[180px]">
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">Batch</label>
              <select
                value={filterBatch}
                onChange={(e) => { setFilterBatch(e.target.value); setLiveClassPage(1); }}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
              >
                <option value="">All Batches</option>
                {batches.map((b) => (
                  <option key={b.batchId} value={b.batchId}>{b.name}</option>
                ))}
              </select>
            </div>
          )}
          {activeTab !== 'batch' && (
            <div className="min-w-[180px]">
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">Teacher</label>
              <select
                value={filterTeacher}
                onChange={(e) => { setFilterTeacher(e.target.value); setLiveClassPage(1); }}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
              >
                <option value="">All Teachers</option>
                {teachers.map((t) => (
                  <option key={t.teacherId} value={t.teacherId}>{t.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="min-w-[160px]">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">From</label>
            <input
              type="date"
              value={filterDateFrom}
              onChange={(e) => { setFilterDateFrom(e.target.value); setLiveClassPage(1); }}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
            />
          </div>
          <div className="min-w-[160px]">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">To</label>
            <input
              type="date"
              value={filterDateTo}
              onChange={(e) => { setFilterDateTo(e.target.value); setLiveClassPage(1); }}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
            />
          </div>

          {/* Tab 4: Search input */}
          {activeTab === 'live-class' && (
            <div className="min-w-[200px] flex-1">
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">Search</label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search class title or teacher..."
                  value={liveClassSearch}
                  onChange={(e) => {
                    setLiveClassSearch(e.target.value);
                    setLiveClassPage(1);
                  }}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 placeholder-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:placeholder-gray-500"
                />
                {liveClassSearch && (
                  <button
                    type="button"
                    onClick={() => {
                      setLiveClassSearch('');
                      setLiveClassPage(1);
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xs"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Export Buttons (not for student tab) */}
          <div className="flex items-end gap-2 ml-auto">
            <button
              onClick={handleExportCSV}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Export CSV
            </button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          Tab 1: Batch Attendance
         ══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'batch' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {batchAttendance.length === 0 ? (
            <div className="col-span-full flex h-32 items-center justify-center rounded-xl border border-dashed border-gray-300 dark:border-gray-600">
              <p className="text-sm text-gray-400">No batch attendance data available.</p>
            </div>
          ) : (
            batchAttendance.map((batch) => {
              const totalClasses = (batch as any).totalClasses ?? (
                batch.studentCount > 0
                  ? Math.round((batch.presentCount + batch.partialCount + batch.absentCount) / batch.studentCount)
                  : 0
              );

              return (
                <div
                  key={batch.batchId}
                  className="rounded-xl border border-gray-200 bg-white p-5 transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-900"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">{batch.batchName}</h4>
                    <span className="text-xs text-gray-500">{batch.studentCount} students</span>
                  </div>
                  <div className="mb-3 flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-800/50">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-0.5">Total Classes</p>
                      <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{totalClasses}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Avg Attendance</p>
                      <PercentBar percent={batch.averageAttendancePercent} />
                    </div>
                  </div>
                  <div className="flex gap-3 text-xs">
                    <div className="flex-1 rounded-lg bg-emerald-50 p-2 text-center dark:bg-emerald-900/20">
                      <p className="text-lg font-bold text-emerald-600">{batch.presentCount}</p>
                      <p className="text-[10px] text-emerald-700 dark:text-emerald-400">Present</p>
                    </div>
                    <div className="flex-1 rounded-lg bg-amber-50 p-2 text-center dark:bg-amber-900/20">
                      <p className="text-lg font-bold text-amber-600">{batch.partialCount}</p>
                      <p className="text-[10px] text-amber-700 dark:text-amber-400">Partial</p>
                    </div>
                    <div className="flex-1 rounded-lg bg-rose-50 p-2 text-center dark:bg-rose-900/20">
                      <p className="text-lg font-bold text-rose-600">{batch.absentCount}</p>
                      <p className="text-[10px] text-rose-700 dark:text-rose-400">Absent</p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          Tab 2: Teacher Attendance
         ══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'teacher' && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-800/30">
                <th className="px-4 py-3 font-semibold text-gray-500">Teacher</th>
                <th className="px-4 py-3 font-semibold text-gray-500">Batch Count</th>
                <th className="px-4 py-3 font-semibold text-gray-500">Classes Assigned</th>
                <th className="px-4 py-3 font-semibold text-gray-500">Classes Taken</th>
                <th className="px-4 py-3 font-semibold text-gray-500">Average Attendance</th>
              </tr>
            </thead>
            <tbody>
              {teacherAttendance.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">
                    No teacher attendance data available.
                  </td>
                </tr>
              ) : (
                teacherAttendance.map((t) => {
                  const isExpanded = expandedTeacherIds.has(t.teacherId);
                  const classList = t.classes ?? [];

                  return (
                    <React.Fragment key={t.teacherId}>
                      <tr
                        onClick={() => toggleTeacherExpand(t.teacherId)}
                        className={`cursor-pointer border-b border-gray-50 transition-colors hover:bg-gray-50/60 dark:border-gray-800 dark:hover:bg-gray-800/20 ${
                          isExpanded ? 'bg-gray-50/30 dark:bg-gray-800/10' : ''
                        }`}
                        title="Click to view assigned classes"
                      >
                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-gray-400 transition-transform duration-150 ${
                                isExpanded ? 'rotate-90 text-primary-600' : ''
                              }`}
                            >
                              <svg
                                className="h-4 w-4"
                                fill="none"
                                viewBox="0 0 24 24"
                                strokeWidth={2}
                                stroke="currentColor"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                              </svg>
                            </span>
                            <span>{t.teacherName}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{t.batchCount}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{t.classesAssigned}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{t.classesTaken}</td>
                        <td className="px-4 py-3">
                          <PercentBar percent={t.averageAttendancePercent} />
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="border-b border-gray-100 bg-gray-50/40 dark:border-gray-800 dark:bg-gray-900/50">
                          <td colSpan={5} className="px-5 py-3">
                            <TeacherDrilldownPanel
                              instituteId={instituteId ?? ''}
                              teacherId={t.teacherId}
                              teacherName={t.teacherName}
                              dateFrom={filterDateFrom || undefined}
                              dateTo={filterDateTo || undefined}
                              onOpenSheet={(classId, className) => {
                                setSelectedClassId(classId);
                                setSelectedClassName(className);
                              }}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          Tab 3: Student Attendance (Search)
         ══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'student' && (
        <div className="space-y-6">
          {/* Search */}
          <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
            <input
              type="text"
              placeholder="Search by student name..."
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') fetchStudentAttendance(); }}
              className="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 placeholder:text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
            />
            <button
              onClick={fetchStudentAttendance}
              className="rounded-lg bg-amber-500 px-5 py-2 text-xs font-bold text-white transition-colors hover:bg-amber-400"
            >
              Search
            </button>
          </div>

          {/* Results */}
          {studentResults.length > 0 && (
            <div className="space-y-6">
              {studentResults.map((student) => (
                <div
                  key={student.studentId}
                  className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900"
                >
                  {/* Student Info Header */}
                  <div className="mb-4 flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-orange-600 text-sm font-bold text-white">
                      {student.studentName.charAt(0)}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{student.studentName}</p>
                      <p className="text-xs text-gray-500">{student.batchName}</p>
                    </div>
                    <div className="ml-auto flex items-center gap-4">
                      <div className="text-center">
                        <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">{student.overallAttendancePercent}%</p>
                        <p className="text-[10px] text-gray-500 uppercase tracking-wider">Overall</p>
                      </div>
                      <div className="text-center">
                        <p className="text-lg font-bold text-emerald-600">{student.presentClasses}</p>
                        <p className="text-[10px] text-gray-500 uppercase tracking-wider">Present</p>
                      </div>
                      <div className="text-center">
                        <p className="text-lg font-bold text-amber-600">{student.partialClasses}</p>
                        <p className="text-[10px] text-gray-500 uppercase tracking-wider">Partial</p>
                      </div>
                      <div className="text-center">
                        <p className="text-lg font-bold text-rose-600">{student.absentClasses}</p>
                        <p className="text-[10px] text-gray-500 uppercase tracking-wider">Absent</p>
                      </div>
                    </div>
                  </div>

                  {/* Attendance History */}
                  <div>
                    <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Attendance History</h4>
                    {student.history.length === 0 ? (
                      <p className="text-xs text-gray-400">No attendance history.</p>
                    ) : (
                      <div className="space-y-1">
                        <div className="flex items-center gap-3 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                          <span className="w-24">Date</span>
                          <span className="flex-1">Class</span>
                          <span className="w-16 text-center">Status</span>
                          <span className="w-16 text-right">%</span>
                        </div>
                        {student.history.map((h, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/30"
                          >
                            <span className="w-24 text-xs text-gray-600 dark:text-gray-400">
                              {new Date(h.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                            </span>
                            <span className="flex-1 text-xs font-medium text-gray-900 dark:text-gray-100 truncate">{h.classTitle} ({student.batchName})</span>
                            <div className="w-16 text-center"><StatusBadge status={h.attendanceStatus} /></div>
                            <span className="w-16 text-right text-xs font-semibold tabular-nums text-gray-700 dark:text-gray-300">{h.attendancePercent}%</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {studentSearch.trim() && studentResults.length === 0 && (
            <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-gray-300 dark:border-gray-600">
              <p className="text-sm text-gray-400">No students found matching &quot;{studentSearch}&quot;</p>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          Tab 4: Live Class Attendance
         ══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'live-class' && (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-800/30">
                  <th className="px-4 py-3 font-semibold text-gray-500">Date</th>
                  <th className="px-4 py-3 font-semibold text-gray-500">Time</th>
                  <th className="px-4 py-3 font-semibold text-gray-500">Class</th>
                  <th className="px-4 py-3 font-semibold text-gray-500">Teacher</th>
                  <th className="px-4 py-3 font-semibold text-gray-500">Batch</th>
                  <th className="px-4 py-3 font-semibold text-gray-500">Present</th>
                  <th className="px-4 py-3 font-semibold text-gray-500">Partial</th>
                  <th className="px-4 py-3 font-semibold text-gray-500">Absent</th>
                </tr>
              </thead>
              <tbody>
                {liveClassLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-50 dark:border-gray-800">
                      <td colSpan={8} className="px-4 py-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    </tr>
                  ))
                ) : liveClassAttendance.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">
                      {liveClassSearch.trim() || filterBatch || filterTeacher || filterDateFrom || filterDateTo ? (
                        <div className="space-y-1.5">
                          <p>No completed live classes found matching the selected filters.</p>
                          <button
                            type="button"
                            onClick={() => {
                              setFilterBatch('');
                              setFilterTeacher('');
                              setFilterDateFrom('');
                              setFilterDateTo('');
                              setLiveClassSearch('');
                              setLiveClassPage(1);
                            }}
                            className="text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
                          >
                            Clear all filters
                          </button>
                        </div>
                      ) : (
                        'No completed live classes found.'
                      )}
                    </td>
                  </tr>
                ) : (
                  liveClassAttendance.map((cls: AdminLiveClassAttendanceItem) => (
                    <tr
                      key={cls.classId}
                      onClick={() => { setSelectedClassId(cls.classId); setSelectedClassName(cls.title); }}
                      className="border-b border-gray-50 transition-colors hover:bg-blue-50/50 cursor-pointer dark:border-gray-800 dark:hover:bg-blue-900/10"
                    >
                      <td className="px-4 py-3 whitespace-nowrap text-gray-600 dark:text-gray-400">
                        {new Date(cls.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap tabular-nums text-gray-600 dark:text-gray-400">
                        {formatClassTimeRange(cls.date, cls.durationMin)}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                        {cls.title}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-600 dark:text-gray-400">{cls.teacherName}</td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{cls.batchName}</td>
                      <td className="px-4 py-3 whitespace-nowrap font-medium text-emerald-600">{cls.presentCount}</td>
                      <td className="px-4 py-3 whitespace-nowrap font-medium text-amber-600">{cls.partialCount}</td>
                      <td className="px-4 py-3 whitespace-nowrap font-medium text-rose-600">{cls.absentCount}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {liveClassTotal > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-gray-100 bg-gray-50/50 px-4 py-3 dark:border-gray-800 dark:bg-gray-800/30">
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Showing {(liveClassPage - 1) * liveClassPageSize + 1} to{' '}
                  {Math.min(liveClassPage * liveClassPageSize, liveClassTotal)} of {liveClassTotal} classes
                </span>
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span>Per page:</span>
                  <select
                    value={liveClassPageSize}
                    onChange={(e) => {
                      setLiveClassPageSize(Number(e.target.value));
                      setLiveClassPage(1);
                    }}
                    className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  disabled={liveClassPage <= 1}
                  onClick={() => setLiveClassPage((p) => Math.max(1, p - 1))}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  Previous
                </button>
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                  Page {liveClassPage} of {Math.max(liveClassTotalPages, 1)}
                </span>
                <button
                  disabled={liveClassPage >= liveClassTotalPages}
                  onClick={() => setLiveClassPage((p) => Math.min(liveClassTotalPages, p + 1))}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Attendance Sheet Modal ── */}
      {selectedClassId && (
        <AdminAttendanceSheet
          classId={selectedClassId}
          className={selectedClassName}
          onClose={() => setSelectedClassId(null)}
        />
      )}
    </div>
  );
}
