'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { teacherService } from '@/services/teacherService';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchBar } from '@/components/ui/SearchBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import type { StudentRosterItem } from '@/data/mockData';

const PAGE_SIZE = 25;

export default function StudentListPage() {
  const router = useRouter();
  const { teacherProfile } = useAuth();
  const teacherId = teacherProfile?.id ?? '';

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [batchFilter, setBatchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Fetch teacher's batches
  const { data: batches, isLoading: batchesLoading } = useQuery({
    queryKey: ['teacher', 'batches', teacherId],
    queryFn: () => teacherService.getAssignedBatches(teacherId),
    enabled: !!teacherId,
  });

  // Fetch student rosters — either a specific batch or all batches
  const fetchBatchIds = useMemo(() => {
    if (batchFilter) return [batchFilter];
    return batches?.map((b) => b.id) ?? [];
  }, [batchFilter, batches]);

  const { data: allStudents, isLoading: studentsLoading } = useQuery({
    queryKey: ['teacher', 'students', ...fetchBatchIds],
    queryFn: async () => {
      const results: StudentRosterItem[] = [];
      for (const id of fetchBatchIds) {
        try {
          const roster = await teacherService.getStudentRoster(id);
          results.push(...roster);
        } catch {
          // Skip failed batch rosters
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
    enabled: fetchBatchIds.length > 0,
  });

  const isLoading = batchesLoading || studentsLoading;
  const students = allStudents ?? [];

  // Apply client-side filters
  const filtered = useMemo(() => {
    let result = students;

    // Search filter
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.rollNumber.toLowerCase().includes(q),
      );
    }

    // Status filter
    if (statusFilter) {
      if (statusFilter === 'present') {
        result = result.filter((s) => s.status === 'Present Live');
      } else if (statusFilter === 'recording') {
        result = result.filter((s) => s.status === 'Watched Recording');
      } else if (statusFilter === 'absent') {
        result = result.filter((s) => s.status === 'Absent');
      }
    }

    return result;
  }, [students, search, statusFilter]);

  // Paginate
  const totalCount = filtered.length;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Constants for rendering
  const STATUS_COLORS: Record<string, string> = {
    'Present Live': 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400',
    'Watched Recording': 'text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-400',
    'Absent': 'text-rose-600 bg-rose-50 dark:bg-rose-900/20 dark:text-rose-400',
  };

  const columns: Column<StudentRosterItem>[] = [
    {
      key: 'name',
      header: 'Student',
      render: (s) => (
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-xs font-bold text-white">
            {s.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="font-medium text-gray-900 dark:text-gray-100">{s.name}</p>
            <p className="text-xs text-gray-500">Roll: {s.rollNumber}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'avgScore',
      header: 'Avg Score',
      sortable: true,
      render: (s) => (
        <span className="font-semibold text-gray-900 dark:text-gray-100">{s.avgScore}</span>
      ),
    },
    {
      key: 'attendanceRate',
      header: 'Attendance',
      sortable: true,
      render: (s) => (
        <span className="text-sm text-gray-700 dark:text-gray-300">{s.attendanceRate}</span>
      ),
    },
    {
      key: 'rank',
      header: 'Rank',
      sortable: true,
      render: (s) => (
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">#{s.rank}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (s) => (
        <span
          className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
            STATUS_COLORS[s.status] ?? 'text-gray-600 bg-gray-50 dark:bg-gray-800/30 dark:text-gray-400'
          }`}
        >
          {s.status}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (s) => (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/teacher/students/${s.id}`);
            }}
            className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
          >
            View
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/teacher/students/${s.id}/results`);
            }}
            className="rounded px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
          >
            Results
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/teacher/students/${s.id}/analytics`);
            }}
            className="rounded px-2 py-1 text-xs font-medium text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20"
          >
            Analytics
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="All Students"
        description={isLoading ? 'Loading...' : `${totalCount} student${totalCount !== 1 ? 's' : ''}`}
        breadcrumbs={[
          { label: 'Students', href: '/teacher/students' },
          { label: 'All Students' },
        ]}
        actions={
          <Link
            href="/teacher/students"
            className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-300 dark:ring-gray-600 dark:hover:bg-gray-800"
          >
            Dashboard
          </Link>
        }
      />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <SearchBar
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Search by name or roll number..."
          />
        </div>
        <select
          value={batchFilter}
          onChange={(e) => {
            setBatchFilter(e.target.value);
            setPage(1);
          }}
          className="min-w-[150px] rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        >
          <option value="">All Batches</option>
          {batches?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="min-w-[140px] rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        >
          <option value="">All Status</option>
          <option value="present">Present Live</option>
          <option value="recording">Watched Recording</option>
          <option value="absent">Absent</option>
        </select>
      </div>

      {/* Table */}
      <DataTable<StudentRosterItem>
        columns={columns}
        data={paginated}
        keyExtractor={(s) => s.id}
        onRowClick={(s) => router.push(`/teacher/students/${s.id}`)}
        isLoading={false}
        sortable
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={totalCount}
        onPageChange={setPage}
        emptyState={
          isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No students found"
              description={
                search
                  ? `No students matching "${search}"`
                  : 'No students are assigned to your batches yet.'
              }
            />
          )
        }
      />
    </div>
  );
}
