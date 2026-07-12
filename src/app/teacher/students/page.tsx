'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { teacherService } from '@/services/teacherService';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import type { StudentRosterItem } from '@/data/mockData';

export default function StudentDashboardPage() {
  const { teacherProfile } = useAuth();
  const teacherId = teacherProfile?.id ?? '';

  const { data: batches, isLoading: batchesLoading } = useQuery({
    queryKey: ['teacher', 'batches', teacherId],
    queryFn: () => teacherService.getAssignedBatches(teacherId),
    enabled: !!teacherId,
  });

  const batchIds = useMemo(() => batches?.map((b) => b.id) ?? [], [batches]);

  const { data: allStudents, isLoading: studentsLoading } = useQuery({
    queryKey: ['teacher', 'students', ...batchIds],
    queryFn: async () => {
      const results: StudentRosterItem[] = [];
      for (const id of batchIds) {
        try {
          const roster = await teacherService.getStudentRoster(id);
          results.push(...roster);
        } catch {
          // skip failed batch rosters
        }
      }
      // Deduplicate by student ID
      const seen = new Set<string>();
      return results.filter((s) => {
        if (seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
      });
    },
    enabled: batchIds.length > 0,
  });

  const isLoading = batchesLoading || studentsLoading;
  const students = allStudents ?? [];

  const stats = useMemo(() => {
    const total = students.length;
    const active = students.filter((s) => s.status === 'Present Live' || s.status === 'Watched Recording').length;
    const inactive = total - active;

    // Parse avgScore percentages
    const scores = students
      .map((s) => parseFloat(s.avgScore?.replace('%', '') ?? '0'))
      .filter((s) => !isNaN(s));
    const avgScore = scores.length > 0
      ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)
      : '0';

    // Attendance
    const attendance = students
      .map((s) => parseFloat(s.attendanceRate?.replace('%', '') ?? '0'))
      .filter((a) => !isNaN(a));
    const avgAttendance = attendance.length > 0
      ? (attendance.reduce((a, b) => a + b, 0) / attendance.length).toFixed(1)
      : '0';

    const batchCount = batches?.length ?? 0;

    return { total, active, inactive, avgScore, avgAttendance, batchCount };
  }, [students, batches]);

  const recentStudents = useMemo(() => {
    return students.slice(0, 8);
  }, [students]);

  const statCards = [
    {
      label: 'Total Students',
      value: stats.total,
      subtext: `across ${stats.batchCount} batches`,
      color: 'text-blue-600',
      bg: 'bg-blue-50 dark:bg-blue-900/20',
      border: 'border-blue-200 dark:border-blue-800',
    },
    {
      label: 'Active Students',
      value: stats.active,
      subtext: `${((stats.active / (stats.total || 1)) * 100).toFixed(0)}% of total`,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50 dark:bg-emerald-900/20',
      border: 'border-emerald-200 dark:border-emerald-800',
    },
    {
      label: 'Average Score',
      value: `${stats.avgScore}%`,
      subtext: 'across all tests',
      color: stats.total > 0 ? (parseFloat(stats.avgScore) >= 60 ? 'text-emerald-600' : 'text-amber-600') : 'text-gray-400',
      bg: 'bg-gray-50 dark:bg-gray-800/30',
      border: 'border-gray-200 dark:border-gray-700',
    },
    {
      label: 'Avg Attendance',
      value: `${stats.avgAttendance}%`,
      subtext: 'overall rate',
      color: parseFloat(stats.avgAttendance) >= 80 ? 'text-emerald-600' : 'text-amber-600',
      bg: 'bg-purple-50 dark:bg-purple-900/20',
      border: 'border-purple-200 dark:border-purple-800',
    },
    {
      label: 'Batches',
      value: stats.batchCount,
      subtext: 'assigned to you',
      color: 'text-indigo-600',
      bg: 'bg-indigo-50 dark:bg-indigo-900/20',
      border: 'border-indigo-200 dark:border-indigo-800',
    },
  ];

  const quickActions = [
    {
      title: 'View All Students',
      description: 'Browse, filter, and search your students',
      href: '/teacher/students/list',
      icon: '👥',
      color: 'bg-blue-600',
    },
    {
      title: 'View Results',
      description: 'Review student test results and performance',
      href: '/teacher/results',
      icon: '📊',
      color: 'bg-emerald-600',
    },
  ];

  return (
    <div>
      <PageHeader
        title="Students"
        description={`Manage your ${stats.total} students across ${stats.batchCount} batches`}
        actions={
          <Link
            href="/teacher/students/list"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            View All Students
          </Link>
        }
      />

      {/* Stats Cards */}
      {isLoading ? (
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-200 p-5 dark:border-gray-700">
              <Skeleton className="mb-2 h-3 w-20" />
              <Skeleton className="h-7 w-16" />
              <Skeleton className="mt-1 h-3 w-24" />
            </div>
          ))}
        </div>
      ) : (
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {statCards.map((stat) => (
            <div
              key={stat.label}
              className={`rounded-xl border ${stat.border} ${stat.bg} p-5 transition-shadow hover:shadow-md`}
            >
              <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">
                {stat.label}
              </p>
              <p className={`mt-1.5 text-3xl font-bold ${stat.color}`}>{stat.value}</p>
              <p className="mt-0.5 text-xs text-gray-400">{stat.subtext}</p>
            </div>
          ))}
        </div>
      )}

      {/* Recent Students */}
      <div className="mb-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Recent Students</h2>
          <Link
            href="/teacher/students/list"
            className="text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            View all
          </Link>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : recentStudents.length === 0 ? (
          <EmptyState
            title="No students found"
            description="Students will appear here once they are assigned to your batches."
          />
        ) : (
          <div className="space-y-2">
            {recentStudents.map((student) => (
              <Link
                key={student.id}
                href={`/teacher/students/${student.id}`}
                className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600"
              >
                {/* Avatar */}
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-xs font-bold text-white">
                  {student.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                    {student.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    Roll: {student.rollNumber} · Rank #{student.rank}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {student.avgScore}
                  </p>
                  <p className="text-xs text-gray-400">{student.attendanceRate} attendance</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <h2 className="mb-4 text-base font-semibold text-gray-900 dark:text-gray-100">Quick Actions</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {quickActions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="group rounded-xl border border-gray-200 bg-white p-5 transition-all hover:border-gray-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-900"
          >
            <div
              className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg text-lg text-white shadow-sm"
              style={{ backgroundColor: action.color }}
            >
              {action.icon}
            </div>
            <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 dark:text-gray-100">
              {action.title}
            </h3>
            <p className="mt-1 text-sm text-gray-500">{action.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
