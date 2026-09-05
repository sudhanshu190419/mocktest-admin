'use client';

import { resolveTeacherIdentity } from '@/services/teacherIdentity';

import { useAuth } from '@/context/AuthContext';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/config/supabase';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { BookOpen, ClipboardText, FileText, Eye } from '@phosphor-icons/react';

// ═══════════════════════════════════════════════════════════════════════════
//  Teacher Batch Subject Dashboard
// ═══════════════════════════════════════════════════════════════════════════

interface TeacherSubjectItem {
  batchSubjectId: string;
  batchId: string;
  batchName: string;
  batchCode: string;
  subjectName: string;
  subjectCode: string;
  contentCount: number;
  mockTestCount: number;
}

/**
 * Teacher-facing page that shows only the batch subjects the teacher is
 * actually assigned to teach (via `batch_subject_teachers`).
 *
 * Uses RLS to scope queries: `batch_subject_teachers` has a policy allowing
 * teachers to read their own assignments (`teacher_id = get_my_teacher_id()`).
 */
export default function TeacherSubjectsPage() {
  const { instituteId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [allSubjects, setAllSubjects] = useState<TeacherSubjectItem[]>([]);

  // Fetch teacher's subject assignments via batch_subject_teachers
  useEffect(() => {
    async function fetchTeacherSubjects() {
      try {
        setLoading(true);

        // Resolve teacher identity
        const identity = await resolveTeacherIdentity();
        const myTeacherId = identity?.teacherId;
        if (!myTeacherId) {
          setLoading(false);
          return;
        }

        // Query batch_subject_teachers for this teacher, joined to batch_subjects and subjects
        // RLS policy ensures only this teacher's assignments are returned
        const { data: assignments, error: assignError } = await supabase
          .from('batch_subject_teachers')
          .select(`
            teacher_id,
            batch_subject_id,
            batch_subjects!inner (
              batch_subject_id,
              batch_id,
              is_active,
              subjects!inner (
                name,
                code
              ),
              batches!inner (
                name,
                batch_code
              )
            )
          `)
          .eq('teacher_id', myTeacherId);

        if (assignError) {
          console.error('Failed to fetch teacher assignments:', assignError);
          setLoading(false);
          return;
        }

        // Build subject list with content counts
        const results: TeacherSubjectItem[] = [];
        for (const row of (assignments ?? []) as any[]) {
          const bs = row.batch_subjects;
          if (!bs || !bs.is_active) continue;

          // Count content items for this batch subject
          const { count: contentCount } = await supabase
            .from('batch_subject_contents')
            .select('batch_subject_content_id', { count: 'exact', head: true })
            .eq('batch_subject_id', bs.batch_subject_id);

          // Count mock tests for this batch subject
          const { count: mockTestCount } = await supabase
            .from('batch_subject_mock_tests')
            .select('assignment_id', { count: 'exact', head: true })
            .eq('batch_subject_id', bs.batch_subject_id);

          results.push({
            batchSubjectId: bs.batch_subject_id,
            batchId: bs.batch_id,
            batchName: bs.batches?.name ?? 'Unknown Batch',
            batchCode: bs.batches?.batch_code ?? '',
            subjectName: bs.subjects?.name ?? 'Unknown Subject',
            subjectCode: bs.subjects?.code ?? '',
            contentCount: contentCount ?? 0,
            mockTestCount: mockTestCount ?? 0,
          });
        }

        setAllSubjects(results);
      } catch (err) {
        console.error('Failed to fetch teacher subjects:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchTeacherSubjects();
  }, []);

  // Group by batch
  const groupedByBatch = allSubjects.reduce((acc, subject) => {
    if (!acc[subject.batchId]) {
      acc[subject.batchId] = {
        batchName: subject.batchName,
        batchCode: subject.batchCode,
        subjects: [] as TeacherSubjectItem[],
      };
    }
    acc[subject.batchId].subjects.push(subject);
    return acc;
  }, {} as Record<string, { batchName: string; batchCode: string; subjects: TeacherSubjectItem[] }>);

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Subjects"
        description="Subjects you are assigned to teach across batches"
        breadcrumbs={[
          { label: 'Dashboard', href: '/teacher' },
          { label: 'My Subjects' },
        ]}
      />

      {loading && (
        <div className="space-y-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
              <Skeleton className="mb-4 h-5 w-48" />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, j) => (
                  <Skeleton key={j} className="h-28 w-full rounded-lg" />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && allSubjects.length === 0 && (
        <EmptyState
          icon={<BookOpen size={40} weight="thin" />}
          title="No subjects assigned"
          description="You haven't been assigned to teach any subjects yet. Contact your admin to get assigned."
          action={
            <Link
              href="/teacher/subjects"
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Go to My Content
            </Link>
          }
        />
      )}

      {!loading && Object.entries(groupedByBatch).map(([batchId, group]) => (
        <div
          key={batchId}
          className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900"
        >
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {group.batchName}
              </h3>
              <p className="text-xs text-gray-500">Code: {group.batchCode}</p>
            </div>
            <span className="text-xs text-gray-400">
              {group.subjects.length} subject{group.subjects.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.subjects.map((subject) => (
              <div
                key={subject.batchSubjectId}
                className="group relative rounded-lg border border-gray-200 bg-gray-50/50 p-4 transition-all hover:border-blue-300 hover:shadow-sm dark:border-gray-700 dark:bg-gray-800/20 dark:hover:border-blue-600"
              >
                <Link
                  href={`/teacher/subjects/${subject.batchSubjectId}/content`}
                  className="mb-2 flex items-center gap-2"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">
                    <BookOpen size={16} weight="duotone" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900 hover:text-blue-600 dark:text-gray-100 dark:hover:text-blue-400">
                      {subject.subjectName}
                    </p>
                    <p className="text-[10px] text-gray-500 uppercase">{subject.subjectCode}</p>
                  </div>
                </Link>

                <div className="flex items-center gap-3 text-xs">
                  <Link
                    href={`/teacher/subjects/${subject.batchSubjectId}/content`}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-gray-500 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/20 dark:hover:text-blue-400"
                  >
                    <FileText size={13} />
                    {subject.contentCount} content
                  </Link>
                  <Link
                    href={`/teacher/subjects/${subject.batchSubjectId}/mock-tests`}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-gray-500 transition-colors hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-900/20 dark:hover:text-indigo-400"
                  >
                    <ClipboardText size={13} />
                    {subject.mockTestCount} test{subject.mockTestCount !== 1 ? 's' : ''}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
