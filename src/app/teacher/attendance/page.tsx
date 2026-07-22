'use client';

/**
 * Teacher Attendance Dashboard
 *
 * Read-only attendance analytics for the teacher's own batches and live classes.
 *
 * @module app/teacher/attendance/page
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { attendanceAnalyticsService } from '@/services/attendanceAnalyticsService';
import { liveClassAttendanceService } from '@/services/liveClassAttendanceService';
import type {
  TeacherAttendanceSummary,
  TeacherAttendanceRecord,
  StudentAttendanceDetail,
  BatchAttendanceSummary,
  LiveClassAttendanceSummary,
} from '@/services/attendanceAnalyticsService';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/LoadingSkeleton';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

type ViewMode = 'summary' | 'batch' | 'live-class';
type AttendanceStatusFilter = 'all' | 'present' | 'partial' | 'absent';

// ═══════════════════════════════════════════════════════════════════════════
// Sub-Components
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
  color: 'blue' | 'emerald' | 'amber' | 'purple' | 'rose';
}) {
  const colorClasses: Record<string, string> = {
    blue: 'text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-400',
    emerald: 'text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-400',
    amber: 'text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-400',
    purple: 'text-purple-600 bg-purple-50 border-purple-200 dark:bg-purple-900/20 dark:border-purple-800 dark:text-purple-400',
    rose: 'text-rose-600 bg-rose-50 border-rose-200 dark:bg-rose-900/20 dark:border-rose-800 dark:text-rose-400',
  };

  return (
    <div className={`rounded-xl border p-4 ${colorClasses[color]}`}>
      <p className="text-[11px] font-medium uppercase tracking-wider opacity-70">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {subtext && <p className="mt-0.5 text-xs opacity-60">{subtext}</p>}
    </div>
  );
}

function AttendanceStatusBadge({ status }: { status: string }) {
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

function AttendancePercentBar({ percent }: { percent: number }) {
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
// Student Detail Drawer
// ═══════════════════════════════════════════════════════════════════════════

function StudentDetailDrawer({
  student,
  onClose,
}: {
  student: StudentAttendanceDetail | null;
  onClose: () => void;
}) {
  if (!student) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white dark:bg-gray-950 shadow-2xl overflow-y-auto animate-slide-in-right border-l border-gray-200 dark:border-gray-800">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white/90 backdrop-blur-sm px-6 py-4 dark:border-gray-800 dark:bg-gray-950/90">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Student Attendance</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Student Info */}
        <div className="p-6 space-y-6">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/50">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-sm font-bold text-white">
                {student.studentName.charAt(0)}
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{student.studentName}</p>
                <p className="text-xs text-gray-500">{student.batchName}</p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-2xl font-bold tabular-nums text-blue-600 dark:text-blue-400">
                  {student.overallAttendancePercent}%
                </p>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Overall</p>
              </div>
            </div>
          </div>

          {/* Attendance History */}
          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Attendance History</h4>
            {student.history.length === 0 ? (
              <p className="text-sm text-gray-400">No attendance records found.</p>
            ) : (
              <div className="space-y-2">
                {student.history.map((h, i) => (
                  <div
                    key={`${h.classId}-${i}`}
                    className="flex items-center gap-3 rounded-lg border border-gray-100 px-3 py-2.5 dark:border-gray-800"
                  >
                    <AttendanceStatusBadge status={h.attendanceStatus} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-gray-900 dark:text-gray-100">
                        {h.classTitle}
                      </p>
                      <p className="text-[10px] text-gray-500">
                        {new Date(h.date).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                        {h.durationMinutes > 0 && ` · ${h.durationMinutes} min`}
                      </p>
                    </div>
                    <span className="text-xs font-semibold tabular-nums text-gray-700 dark:text-gray-300">
                      {h.attendancePercent}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Live Class Attendance Sheet Modal
// ═══════════════════════════════════════════════════════════════════════════

interface AttendanceSheetEntry {
  studentName: string;
  attendanceStatus: string;
  durationSeconds: number;
}

function LiveClassAttendanceSheet({
  classId,
  className,
  onClose,
}: {
  classId: string;
  className: string;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<AttendanceSheetEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      try {
        const records = await liveClassAttendanceService.getClassAttendance(classId);
        setEntries(
          records.map((r) => ({
            studentName: r.studentName ?? 'Unknown',
            attendanceStatus: r.attendanceStatus,
            durationSeconds: r.durationSeconds,
          }))
        );
      } catch (err) {
        console.error('Failed to load attendance sheet:', err);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [classId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-gray-950 border border-gray-200 dark:border-gray-800">
        {/* Header */}
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

        {/* Body */}
        <div className="p-6">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No attendance records found.</p>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center gap-3 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                <span className="flex-1">Student</span>
                <span className="w-20 text-center">Status</span>
                <span className="w-16 text-right">Duration</span>
              </div>
              {entries.map((e, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/30"
                >
                  <span className="flex-1 text-xs font-medium text-gray-900 dark:text-gray-100">{e.studentName}</span>
                  <div className="w-20 text-center">
                    <AttendanceStatusBadge status={e.attendanceStatus} />
                  </div>
                  <span className="w-16 text-right text-xs tabular-nums text-gray-600 dark:text-gray-400">
                    {e.durationSeconds > 60
                      ? `${Math.round(e.durationSeconds / 60)}m`
                      : `${e.durationSeconds}s`}
                  </span>
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
// Main View
// ═══════════════════════════════════════════════════════════════════════════

export default function TeacherAttendancePage() {
  const { teacherProfile } = useAuth();
  const teacherId = teacherProfile?.id ?? '';

  // ── State ────────────────────────────────────────────────────────────
  const [summary, setSummary] = useState<TeacherAttendanceSummary | null>(null);
  const [records, setRecords] = useState<TeacherAttendanceRecord[]>([]);
  const [batchAttendance, setBatchAttendance] = useState<BatchAttendanceSummary[]>([]);
  const [liveClassAttendance, setLiveClassAttendance] = useState<LiveClassAttendanceSummary[]>([]);
  const [batches, setBatches] = useState<{ batchId: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [viewMode, setViewMode] = useState<ViewMode>('summary');
  const [filterBatch, setFilterBatch] = useState<string>('');
  const [filterDateFrom, setFilterDateFrom] = useState<string>('');
  const [filterDateTo, setFilterDateTo] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<AttendanceStatusFilter>('all');

  // Detail drawer
  const [selectedStudent, setSelectedStudent] = useState<StudentAttendanceDetail | null>(null);

  // Live class attendance sheet
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [selectedClassName, setSelectedClassName] = useState('');

  // ── Data Fetching ────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    if (!teacherId) return;
    setLoading(true);
    try {
      const [summaryData, batchList, batchData] = await Promise.all([
        attendanceAnalyticsService.getTeacherSummary(teacherId),
        attendanceAnalyticsService.getTeacherBatches(teacherId),
        attendanceAnalyticsService.getTeacherBatchAttendance(teacherId),
      ]);

      setSummary(summaryData);
      setBatches(batchList);
      setBatchAttendance(batchData);
    } catch (err) {
      console.error('Failed to load attendance data:', err);
    } finally {
      setLoading(false);
    }
  }, [teacherId]);

  const fetchRecords = useCallback(async () => {
    if (!teacherId) return;
    try {
      const data = await attendanceAnalyticsService.getTeacherAttendanceRecords(teacherId, {
        batchId: filterBatch || undefined,
        dateFrom: filterDateFrom || undefined,
        dateTo: filterDateTo || undefined,
        status: filterStatus !== 'all' ? filterStatus : undefined,
      });
      setRecords(data);
    } catch (err) {
      console.error('Failed to load attendance records:', err);
    }
  }, [teacherId, filterBatch, filterDateFrom, filterDateTo, filterStatus]);

  const fetchLiveClassAttendance = useCallback(async () => {
    if (!teacherId) return;
    try {
      const data = await attendanceAnalyticsService.getTeacherLiveClassAttendance(teacherId, {
        dateFrom: filterDateFrom || undefined,
        dateTo: filterDateTo || undefined,
        batchId: filterBatch || undefined,
      });
      setLiveClassAttendance(data);
    } catch (err) {
      console.error('Failed to load live class attendance:', err);
    }
  }, [teacherId, filterDateFrom, filterDateTo, filterBatch]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (viewMode === 'summary') fetchRecords();
    else if (viewMode === 'live-class') fetchLiveClassAttendance();
  }, [viewMode, fetchRecords, fetchLiveClassAttendance]);

  // ── Handlers ─────────────────────────────────────────────────────────

  const handleStudentClick = useCallback(async (studentId: string) => {
    if (!teacherId) return;
    const detail = await attendanceAnalyticsService.getStudentAttendanceDetail(teacherId, studentId);
    setSelectedStudent(detail);
  }, [teacherId]);

  const handleClassClick = useCallback((classId: string, title: string) => {
    setSelectedClassId(classId);
    setSelectedClassName(title);
  }, []);

  // ── Render ───────────────────────────────────────────────────────────

  if (!teacherId) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-gray-400">Please log in to view attendance.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        description="View student attendance analytics for your batches and live classes."
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
          <SummaryCard label="Live Classes Conducted" value={summary.totalLiveClasses} color="emerald" />
          <SummaryCard label="Average Attendance" value={`${summary.averageAttendancePercent}%`} color="amber" />
          <SummaryCard label="Today's Attendance" value={`${summary.todayAttendancePercent}%`} color="purple" />
        </div>
      ) : null}

      {/* ── View Mode Tabs ── */}
      <div className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white p-1 dark:border-gray-700 dark:bg-gray-900">
        {([
          { key: 'summary' as ViewMode, label: 'Student Attendance' },
          { key: 'batch' as ViewMode, label: 'Batch View' },
          { key: 'live-class' as ViewMode, label: 'Live Class View' },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setViewMode(tab.key)}
            className={`flex-1 rounded-lg px-4 py-2 text-xs font-semibold transition-all ${
              viewMode === tab.key
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Filters ── */}
      {viewMode !== 'batch' && (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          {/* Batch Filter */}
          <div className="min-w-[180px]">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">Batch</label>
            <select
              value={filterBatch}
              onChange={(e) => setFilterBatch(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
            >
              <option value="">All Batches</option>
              {batches.map((b) => (
                <option key={b.batchId} value={b.batchId}>{b.name}</option>
              ))}
            </select>
          </div>

          {/* Date Range */}
          <div className="min-w-[160px]">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">From</label>
            <input
              type="date"
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
            />
          </div>
          <div className="min-w-[160px]">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">To</label>
            <input
              type="date"
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
            />
          </div>

          {/* Status Filter — only for summary view */}
          {viewMode === 'summary' && (
            <div className="min-w-[140px]">
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">Status</label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as AttendanceStatusFilter)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
              >
                <option value="all">All</option>
                <option value="present">Present</option>
                <option value="partial">Partial</option>
                <option value="absent">Absent</option>
              </select>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          View: Student Attendance Table
         ══════════════════════════════════════════════════════════════════ */}
      {viewMode === 'summary' && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-800/30">
                <th className="px-4 py-3 font-semibold text-gray-500">Student</th>
                <th className="px-4 py-3 font-semibold text-gray-500">Batch</th>
                <th className="px-4 py-3 font-semibold text-gray-500">Attendance %</th>
                <th className="px-4 py-3 font-semibold text-gray-500">Present</th>
                <th className="px-4 py-3 font-semibold text-gray-500">Partial</th>
                <th className="px-4 py-3 font-semibold text-gray-500">Absent</th>
                <th className="px-4 py-3 font-semibold text-gray-500">Last Attended</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">
                    No attendance records found.
                  </td>
                </tr>
              ) : (
                records.map((rec) => (
                  <tr
                    key={rec.studentId}
                    onClick={() => handleStudentClick(rec.studentId)}
                    className="border-b border-gray-50 transition-colors hover:bg-blue-50/50 cursor-pointer dark:border-gray-800 dark:hover:bg-blue-900/10"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                      <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-[9px] font-bold text-white">
                          {rec.studentName.charAt(0)}
                        </div>
                        <span>{rec.studentName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{rec.batchName}</td>
                    <td className="px-4 py-3">
                      <AttendancePercentBar percent={rec.attendancePercent} />
                    </td>
                    <td className="px-4 py-3 font-medium text-emerald-600">{rec.presentCount}</td>
                    <td className="px-4 py-3 font-medium text-amber-600">{rec.partialCount}</td>
                    <td className="px-4 py-3 font-medium text-rose-600">{rec.absentCount}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {rec.lastAttended
                        ? new Date(rec.lastAttended).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                          })
                        : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          View: Batch Attendance
         ══════════════════════════════════════════════════════════════════ */}
      {viewMode === 'batch' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {batchAttendance.length === 0 ? (
            <div className="col-span-full flex h-32 items-center justify-center rounded-xl border border-dashed border-gray-300 dark:border-gray-600">
              <p className="text-sm text-gray-400">No batch attendance data available.</p>
            </div>
          ) : (
            batchAttendance.map((batch) => (
              <div
                key={batch.batchId}
                className="rounded-xl border border-gray-200 bg-white p-5 transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-900"
              >
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">{batch.batchName}</h4>
                  <span className="text-xs text-gray-500">{batch.studentCount} students</span>
                </div>
                <div className="mb-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Average Attendance</p>
                  <AttendancePercentBar percent={batch.averageAttendancePercent} />
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
            ))
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          View: Live Class Attendance
         ══════════════════════════════════════════════════════════════════ */}
      {viewMode === 'live-class' && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-800/30">
                <th className="px-4 py-3 font-semibold text-gray-500">Date</th>
                <th className="px-4 py-3 font-semibold text-gray-500">Live Class</th>
                <th className="px-4 py-3 font-semibold text-gray-500">Students</th>
                <th className="px-4 py-3 font-semibold text-gray-500">Present</th>
                <th className="px-4 py-3 font-semibold text-gray-500">Partial</th>
                <th className="px-4 py-3 font-semibold text-gray-500">Absent</th>
              </tr>
            </thead>
            <tbody>
              {liveClassAttendance.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">
                    No completed live classes found.
                  </td>
                </tr>
              ) : (
                liveClassAttendance.map((cls) => (
                  <tr
                    key={cls.classId}
                    onClick={() => handleClassClick(cls.classId, cls.title)}
                    className="border-b border-gray-50 transition-colors hover:bg-blue-50/50 cursor-pointer dark:border-gray-800 dark:hover:bg-blue-900/10"
                  >
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {new Date(cls.date).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{cls.title}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{cls.totalStudents}</td>
                    <td className="px-4 py-3 font-medium text-emerald-600">{cls.presentCount}</td>
                    <td className="px-4 py-3 font-medium text-amber-600">{cls.partialCount}</td>
                    <td className="px-4 py-3 font-medium text-rose-600">{cls.absentCount}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Student Detail Drawer ── */}
      <StudentDetailDrawer
        student={selectedStudent}
        onClose={() => setSelectedStudent(null)}
      />

      {/* ── Live Class Attendance Sheet Modal ── */}
      {selectedClassId && (
        <LiveClassAttendanceSheet
          classId={selectedClassId}
          className={selectedClassName}
          onClose={() => setSelectedClassId(null)}
        />
      )}
    </div>
  );
}
