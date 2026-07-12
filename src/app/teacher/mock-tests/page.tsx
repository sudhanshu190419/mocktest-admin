'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useMockTests } from '@/hooks/mockTest/useMockTests';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatsCardSkeleton } from '@/components/ui/LoadingSkeleton';

export default function MockTestDashboardPage() {
  const { data: testsData, isLoading } = useMockTests({}, {}, { page: 1, pageSize: 1000 });

  const stats = useMemo(() => {
    if (!testsData?.data) {
      return { total: 0, draft: 0, pending_approval: 0, published: 0, archived: 0 };
    }
    const ts = testsData.data;
    return {
      total: ts.length,
      draft: ts.filter((t) => t.status === 'draft').length,
      pending_approval: ts.filter((t) => t.status === 'pending_approval').length,
      published: ts.filter((t) => t.status === 'published').length,
      archived: ts.filter((t) => t.status === 'archived').length,
    };
  }, [testsData]);

  const statCards = [
    { label: 'Total Tests', value: stats.total, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-200 dark:border-blue-800' },
    { label: 'Published', value: stats.published, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20', border: 'border-emerald-200 dark:border-emerald-800' },
    { label: 'Draft', value: stats.draft, color: 'text-gray-600', bg: 'bg-gray-50 dark:bg-gray-800/30', border: 'border-gray-200 dark:border-gray-700' },
    { label: 'Pending Approval', value: stats.pending_approval, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200 dark:border-amber-800' },
    { label: 'Archived', value: stats.archived, color: 'text-rose-600', bg: 'bg-rose-50 dark:bg-rose-900/20', border: 'border-rose-200 dark:border-rose-800' },
  ];

  const quickActions = [
    {
      title: 'Create Mock Test',
      description: 'Set up a new test with questions from the bank',
      href: '/teacher/mock-tests/create',
      icon: '＋',
      color: 'bg-blue-600',
    },
    {
      title: 'Browse Tests',
      description: 'View, filter, and manage all mock tests',
      href: '/teacher/mock-tests/list',
      icon: '📋',
      color: 'bg-emerald-600',
    },
  ];

  return (
    <div>
      <PageHeader title="Mock Tests" description="Create, manage, and publish mock tests for your students" />

      {isLoading ? (
        <StatsCardSkeleton count={5} />
      ) : (
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {statCards.map((stat) => (
            <div key={stat.label} className={`rounded-xl border ${stat.border} ${stat.bg} p-5 transition-shadow hover:shadow-md`}>
              <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">{stat.label}</p>
              <p className={`mt-1.5 text-3xl font-bold ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      <h2 className="mb-4 text-lg font-semibold text-gray-900">Quick Actions</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {quickActions.map((action) => (
          <Link key={action.href} href={action.href}
            className="group rounded-xl border border-gray-200 bg-white p-5 transition-all hover:border-gray-300 hover:shadow-md">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg text-lg text-white shadow-sm" style={{ backgroundColor: action.color }}>
              {action.icon}
            </div>
            <h3 className="font-semibold text-gray-900 group-hover:text-blue-600">{action.title}</h3>
            <p className="mt-1 text-sm text-gray-500">{action.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
