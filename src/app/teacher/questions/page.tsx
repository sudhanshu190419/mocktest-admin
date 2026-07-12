'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuestions } from '@/hooks/mockTest/useQuestions';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatsCardSkeleton } from '@/components/ui/LoadingSkeleton';

export default function QuestionBankDashboardPage() {
  const { data: questionsData, isLoading } = useQuestions({}, { sortBy: 'createdAt', sortDirection: 'desc' }, { page: 1, pageSize: 1000 });

  const stats = useMemo(() => {
    if (!questionsData?.data) {
      return { total: 0, draft: 0, pending_approval: 0, published: 0, archived: 0 };
    }
    const qs = questionsData.data;
    return {
      total: qs.length,
      draft: qs.filter((q) => q.status === 'draft').length,
      pending_approval: qs.filter((q) => q.status === 'pending_approval').length,
      published: qs.filter((q) => q.status === 'published').length,
      archived: qs.filter((q) => q.status === 'archived').length,
    };
  }, [questionsData]);

  const statCards = [
    { label: 'Total Questions', value: stats.total, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-200 dark:border-blue-800' },
    { label: 'Published', value: stats.published, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20', border: 'border-emerald-200 dark:border-emerald-800' },
    { label: 'Draft', value: stats.draft, color: 'text-gray-600', bg: 'bg-gray-50 dark:bg-gray-800/30', border: 'border-gray-200 dark:border-gray-700' },
    { label: 'Pending Approval', value: stats.pending_approval, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200 dark:border-amber-800' },
    { label: 'Archived', value: stats.archived, color: 'text-rose-600', bg: 'bg-rose-50 dark:bg-rose-900/20', border: 'border-rose-200 dark:border-rose-800' },
  ];

  const quickActions = [
    {
      title: 'Create Question',
      description: 'Add a new question to the bank',
      href: '/teacher/questions/create',
      icon: '＋',
      color: 'bg-blue-600',
    },
    {
      title: 'Browse Questions',
      description: 'View, filter, and manage all questions',
      href: '/teacher/questions/list',
      icon: '📋',
      color: 'bg-emerald-600',
    },
    {
      title: 'Bulk Import',
      description: 'Import questions from Excel, CSV, or JSON',
      href: '/teacher/questions/import',
      icon: '📥',
      color: 'bg-amber-600',
    },
  ];

  return (
    <div>
      <PageHeader
        title="Question Bank"
        description="Manage your question bank — create, edit, organize, and import questions"
      />

      {isLoading ? (
        <StatsCardSkeleton count={5} />
      ) : (
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {statCards.map((stat) => (
            <div
              key={stat.label}
              className={`rounded-xl border ${stat.border} ${stat.bg} p-5 transition-shadow hover:shadow-md`}
            >
              <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {stat.label}
              </p>
              <p className={`mt-1.5 text-3xl font-bold ${stat.color}`}>
                {stat.value}
              </p>
            </div>
          ))}
        </div>
      )}

      <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
        Quick Actions
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {quickActions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="group rounded-xl border border-gray-200 bg-white p-5 transition-all hover:border-gray-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-900"
          >
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg text-lg text-white shadow-sm" style={{ backgroundColor: action.color }}>
              {action.icon}
            </div>
            <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 dark:text-gray-100">
              {action.title}
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {action.description}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
