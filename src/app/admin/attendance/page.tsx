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

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { attendanceAnalyticsService } from '@/services/attendanceAnalyticsService';
import { liveClassAttendanceService } from '@/services/liveClassAttendanceService';
import type {
  AdminAttendanceSummary,
  BatchAttendanceSummary,
  AdminTeacherAttendanceRow,
  AdminStudentAttendanceDetail,
  LiveClassAttendanceSummary,
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
  const [entries, setEntries] = useState<{ studentName: string; status: string; duration: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      try {
        const records = await liveClassAttendanceService.getClassAttendance(classId);
        setEntries(
          records.map((r) => ({
            studentName: r.studentName ?? 'Unknown',
            status: r.attendanceStatus,
            duration: r.durationSeconds > 60
              ? `${Math.round(r.durationSeconds / 60)}m`
              : `${r.durationSeconds}s`,
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

export default function AdminAttendancePage() {
  const { instituteId } = useAuth();

  // ── State ────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<AdminTab>('batch');
  const [summary, setSummary] = useState<AdminAttendanceSummary | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterBatch, setFilterBatch] = useState('');
  const [filterTeacher, setFilterTeacher] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterStatus, setFilterStatus] = useState<AttendanceStatusFilter>('all');

  // Dropdown options
  const [batches, setBatches] = useState<{ batchId: string; name: string }[]>([]);
  const [teachers, setTeachers] = useState<{ teacherId: string; name: string }[]>([]);

  // Tab data
  const [batchAttendance, setBatchAttendance] = useState<BatchAttendanceSummary[]>([]);
  const [teacherAttendance, setTeacherAttendance] = useState<AdminTeacherAttendanceRow[]>([]);
  const [studentSearch, setStudentSearch] = useState('');
  const [studentResults, setStudentResults] = useState<AdminStudentAttendanceDetail[]>([]);
  const [liveClassAttendance, setLiveClassAttendance] = useState<(LiveClassAttendanceSummary & { teacherName: string; batchName: string })[]>([]);

  // Modals
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [selectedClassName, setSelectedClassName] = useState('');

  // ── Initial Data ────────────────────────────────────────────────────

  const fetchInitial = useCallback(async () => {
    if (!instituteId) return;
    setLoading(true);
    try {
      const [s, b, t] = await Promise.all([
        attendanceAnalyticsService.getAdminSummary(instituteId),
        attendanceAnalyticsService.getAdminBatches(instituteId),
        attendanceAnalyticsService.getAdminTeachers(instituteId),
      ]);
      setSummary(s);
      setBatches(b);
      setTeachers(t);
    } catch (err) {
      console.error('Failed to load admin attendance data:', err);
    } finally {
      setLoading(false);
    }
  }, [instituteId]);

  useEffect(() => {
    fetchInitial();
  }, [fetchInitial]);

  // ── Tab Data Fetching ───────────────────────────────────────────────

  const fetchBatchAttendance = useCallback(async () => {
    if (!instituteId) return;
    const data = await attendanceAnalyticsService.getAdminBatchAttendance(instituteId, {
      dateFrom: filterDateFrom || undefined,
      dateTo: filterDateTo || undefined,
      teacherId: filterTeacher || undefined,
    });
    setBatchAttendance(data);
  }, [instituteId, filterDateFrom, filterDateTo, filterTeacher]);

  const fetchTeacherAttendance = useCallback(async () => {
    if (!instituteId) return;
    const data = await attendanceAnalyticsService.getAdminTeacherAttendance(instituteId, {
      dateFrom: filterDateFrom || undefined,
      dateTo: filterDateTo || undefined,
    });
    setTeacherAttendance(data);
  }, [instituteId, filterDateFrom, filterDateTo]);

  const fetchStudentAttendance = useCallback(async () => {
    if (!instituteId || !studentSearch.trim()) return;
    const data = await attendanceAnalyticsService.getAdminStudentAttendance(instituteId, studentSearch.trim());
    setStudentResults(data);
  }, [instituteId, studentSearch]);

  const fetchLiveClassAttendance = useCallback(async () => {
    if (!instituteId) return;
    const data = await attendanceAnalyticsService.getAdminLiveClassAttendance(instituteId, {
      dateFrom: filterDateFrom || undefined,
      dateTo: filterDateTo || undefined,
      teacherId: filterTeacher || undefined,
      batchId: filterBatch || undefined,
    });
    setLiveClassAttendance(data);
  }, [instituteId, filterDateFrom, filterDateTo, filterTeacher, filterBatch]);

  useEffect(() => {
    if (activeTab === 'batch') fetchBatchAttendance();
    else if (activeTab === 'teacher') fetchTeacherAttendance();
    else if (activeTab === 'live-class') fetchLiveClassAttendance();
  }, [activeTab, fetchBatchAttendance, fetchTeacherAttendance, fetchLiveClassAttendance]);

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
      const headers = ['Teacher', 'Batches', 'Classes Taken', 'Avg Attendance %'];
      const rows = teacherAttendance.map((t) => [
        t.teacherName,
        String(t.batchCount),
        String(t.classesTaken),
        `${t.averageAttendancePercent}%`,
      ]);
      downloadCSV('teacher-attendance', headers, rows);
    } else if (activeTab === 'live-class') {
      const headers = ['Date', 'Teacher', 'Batch', 'Duration (min)', 'Present', 'Partial', 'Absent'];
      const rows = liveClassAttendance.map((c) => [
        new Date(c.date).toLocaleDateString('en-IN'),
        c.teacherName,
        c.batchName,
        '—',
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
                onChange={(e) => setFilterBatch(e.target.value)}
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
                onChange={(e) => setFilterTeacher(e.target.value)}
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
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Avg Attendance</p>
                  <PercentBar percent={batch.averageAttendancePercent} />
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
          Tab 2: Teacher Attendance
         ══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'teacher' && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-800/30">
                <th className="px-4 py-3 font-semibold text-gray-500">Teacher</th>
                <th className="px-4 py-3 font-semibold text-gray-500">Batch Count</th>
                <th className="px-4 py-3 font-semibold text-gray-500">Classes Taken</th>
                <th className="px-4 py-3 font-semibold text-gray-500">Average Attendance</th>
              </tr>
            </thead>
            <tbody>
              {teacherAttendance.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-400">
                    No teacher attendance data available.
                  </td>
                </tr>
              ) : (
                teacherAttendance.map((t) => (
                  <tr
                    key={t.teacherId}
                    className="border-b border-gray-50 transition-colors hover:bg-gray-50/50 dark:border-gray-800 dark:hover:bg-gray-800/20"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{t.teacherName}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{t.batchCount}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{t.classesTaken}</td>
                    <td className="px-4 py-3">
                      <PercentBar percent={t.averageAttendancePercent} />
                    </td>
                  </tr>
                ))
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
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-800/30">
                <th className="px-4 py-3 font-semibold text-gray-500">Date</th>
                <th className="px-4 py-3 font-semibold text-gray-500">Teacher</th>
                <th className="px-4 py-3 font-semibold text-gray-500">Batch</th>
                <th className="px-4 py-3 font-semibold text-gray-500">Duration</th>
                <th className="px-4 py-3 font-semibold text-gray-500">Present</th>
                <th className="px-4 py-3 font-semibold text-gray-500">Partial</th>
                <th className="px-4 py-3 font-semibold text-gray-500">Absent</th>
              </tr>
            </thead>
            <tbody>
              {liveClassAttendance.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">
                    No completed live classes found.
                  </td>
                </tr>
              ) : (
                liveClassAttendance.map((cls) => (
                  <tr
                    key={cls.classId}
                    onClick={() => { setSelectedClassId(cls.classId); setSelectedClassName(cls.title); }}
                    className="border-b border-gray-50 transition-colors hover:bg-blue-50/50 cursor-pointer dark:border-gray-800 dark:hover:bg-blue-900/10"
                  >
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {new Date(cls.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{cls.teacherName}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{cls.batchName}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">—</td>
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
